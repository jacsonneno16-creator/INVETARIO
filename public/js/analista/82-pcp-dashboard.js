// PCP — Fase 8: Dashboard. Lê exclusivamente construirVisao() (o único
// motor de cálculo de estoque/necessidade/cobertura, em 78-pcp-central.js)
// mais as coleções que o próprio PCP já carrega — nenhum cálculo paralelo
// é feito aqui, isto é 100% camada de apresentação.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_SNAP = 'pcp_snapshots_diarios';
  const charts = [];
  let _snapshotGravadoDia = '';

  function fs() { return global.getDTFirestore(); }
  function hoje() { return new Date().toISOString().slice(0, 10); }

  // Snapshot agregado (não por produto — evita explosão de documentos),
  // gravado de forma passiva: só quando o dashboard é aberto e o snapshot
  // do dia ainda não existe. Alimenta o gráfico de evolução.
  async function _garantirSnapshotHoje(visao, reqs) {
    try {
      const hojeStr = hoje();
      if (_snapshotGravadoDia === hojeStr) return;
      const ref = fs().collection(COL_SNAP).doc(hojeStr);
      const estoqueTotalCx = visao.reduce((s, x) => s + x.estoqueAtual, 0);
      const coberturas = visao
        .map(x => Number(x.coberturaDias))
        .filter(v => Number.isFinite(v) && v >= 0)
        .sort((a, b) => a - b);
      // A mediana representa melhor a cobertura típica do portfólio: um SKU
      // de giro quase zero pode ter centenas/milhares de dias e distorcer a
      // média aritmética sem representar a saúde do estoque como um todo.
      let coberturaMedianaDias = 0;
      if (coberturas.length) {
        const meio = Math.floor(coberturas.length / 2);
        coberturaMedianaDias = coberturas.length % 2
          ? coberturas[meio]
          : (coberturas[meio - 1] + coberturas[meio]) / 2;
      }
      const produtosCriticos = visao.filter(_itemCritico).length;
      const produtosAbaixoMinimo = visao.filter(x => x.estoqueMinimo > 0 && x.estoqueAtual < x.estoqueMinimo).length;
      const abertas = (reqs || []).filter(x => !/final|cancel|rejeit/i.test(String(x.status || '')));
      const comprasAbertasQtd = abertas.length;
      const agora = new Date().toISOString();
      await ref.set({ data: hojeStr, estoqueTotalCx, coberturaMedianaDias, produtosCriticos, produtosAbaixoMinimo, comprasAbertasQtd, atualizadoEm: agora }, { merge: true });
      _snapshotGravadoDia = hojeStr;
    } catch (e) { console.warn('[pcp-dashboard] snapshot diário:', e); }
  }

  async function _carregarSnapshots(dias) {
    const limite = Math.max(1, Number(dias) || 30);
    const col = fs().collection(COL_SNAP);
    let snap;
    try {
      // Esta coleção cresce 1 documento por dia. Antes o Dashboard lia TODO
      // o histórico e só então fazia slice(30) no navegador. O resultado é
      // idêntico, mas o Firestore agora entrega apenas os últimos N dias.
      if (col && typeof col.orderBy === 'function') snap = await col.orderBy('data', 'desc').limit(limite).get();
      else snap = await col.get(); // compatibilidade com mocks/SDKs antigos
    } catch (_) {
      snap = await col.get().catch(() => ({ docs: [] }));
    }
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a, b) => String(a.data).localeCompare(String(b.data)))
      .slice(-limite);
  }

  function _itemCritico(item) {
    // A definição oficial fica no motor central para Dashboard e Planejamento
    // nunca divergirem sobre o mesmo produto.
    if (global._pcpInternals?.itemCriticoPlanejamento) {
      return global._pcpInternals.itemCriticoPlanejamento(item);
    }
    // Fallback apenas para compatibilidade durante carregamento/versões antigas.
    const cobertura = item.coberturaProjetadaDias != null ? item.coberturaProjetadaDias : item.coberturaDias;
    const temDemanda = Number(item.consumoDia||0)>0 || Number(item.necessidade||0)>0 || Number(item.estoqueComprometido||0)>0;
    return (item.estoqueDisponivel <= 0 && temDemanda) || !!item.rupturaEm ||
      (cobertura != null && item.leadTimeDias > 0 && cobertura < item.leadTimeDias);
  }

  function _prioridadeExcecao(excecao) {
    const cor = String(excecao?.cor || '').trim().toLowerCase();
    if (cor === 'red' || cor === 'vermelho') return 'critica';
    if (cor === 'orange' || cor === 'laranja') return 'alta';
    return 'normal';
  }

  function _destruirGraficos() { while (charts.length) charts.pop().destroy(); }

  // PEDIDO AO VIVO (2026-09-18): "Compras por mês (quantidade) parece estar
  // baseado em solicitações do PCP, deveria ser no que realmente foi
  // comprado" — o card somava quantidadeComprada de pcp_requisicoes_compra
  // (preenchida manualmente, só existe pro que passou pelo fluxo do PCP).
  // Agora reaproveita o MESMO resumo mensal real do Dashboard de Compras
  // (buscarResumoComprasDashboardBigQuery, histórico de verdade). Falha
  // aqui não pode travar o resto do Dashboard — devolve null, e o gráfico
  // simplesmente fica sem dado em vez de mostrar o número errado de novo.
  async function _carregarComprasPorMesBi() {
    if (!global.firebase || !global.firebase.app) return null;
    try {
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarResumoComprasDashboardBigQuery');
      const resp = await callable({});
      return resp?.data?.resumo?.porMes || null;
    } catch (e) { console.warn('[pcp-dashboard] Compras por mês (BI):', e && e.message ? e.message : e); return null; }
  }

  // PEDIDO AO VIVO (2026-10-01): "não tem como vir a estrutura e depois as
  // informações carregarem" — pinta a mesma moldura que _desenhar() monta
  // (cabeçalho/botão, os 6 cartões de KPI, o card "Ações prioritárias" com
  // o <thead> real, os 2 cards de gráfico com os <canvas> vazios) com "…"
  // no lugar dos números, de forma síncrona, antes do primeiro await da
  // cadeia de carregamento — _desenhar() (inalterada) sobrescreve isso
  // assim que os dados chegam. Se o <thead>/as colunas de _desenhar()
  // mudarem, ajustar aqui também.
  function _shellDashboard() {
    return `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📊 Dashboard do PCP</div><div style="font-size:.74rem;color:var(--muted)">O que precisa da sua atenção hoje. Detalhes de estoque e cobertura ficam em Planejamento.</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-pcp-dash-refresh>↻ Atualizar</button>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        ${_kpi('green','…','Críticos')}
        ${_kpi('green','…','Ações de compra')}
        ${_kpi('green','…','Ações de produção')}
        ${_kpi('green','…','Transferências sugeridas')}
        ${_kpi('green','…','Revisar excesso')}
        ${_kpi('teal','…','Solicitações abertas')}
      </div>
      <div class="tc" style="padding:12px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>⚡ Ações prioritárias</b><button class="btn btn-ghost btn-sm" data-pcp-dash-ir="planejamento">Abrir Planejamento</button></div>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Produto</th><th>Ação</th><th>Motivo</th><th>Data limite</th></tr></thead><tbody>
        <tr><td colspan="4" style="text-align:center;color:var(--muted)">Carregando…</td></tr>
        </tbody></table></div>
      </div>
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:12px"><b>📈 Evolução — estoque total × cobertura típica (mediana)</b><div style="height:220px;margin-top:8px"><canvas id="pcpd-evolucao"></canvas></div></div>
        <div class="tc" style="padding:12px"><b>🛒 Compras reais da empresa por mês</b><div style="font-size:.68rem;color:var(--muted)">Quantidade faturada no BigQuery — inclui matéria-prima, embalagens e produto acabado; exclui departamentos MRO e Logística. Exibe os 12 meses mais recentes.</div><div style="height:220px;margin-top:8px"><canvas id="pcpd-compras-mes"></canvas></div></div>
      </div>`;
  }

  async function renderPCPDashboard() {
    const pagina = document.getElementById('page-pcp-dashboard');
    if (!pagina) return;
    pagina.innerHTML = _shellDashboard();
    try {
      await global._pcpInternals.carregar();
      // PEDIDO AO VIVO (2026-09-02): "maior consumo diário tá calculando
      // errado" — investigado via console real do usuário: o Dashboard só
      // usa o BI (plano da escadinha, fonte certa) quando _estoqueBi já
      // estava em memória; se ninguém tinha clicado em "Buscar do BI" na
      // aba Estoque/Pedidos x Estoque nesta sessão, ele caía no fallback
      // (venda_m1/m2/m3 de producao_projecao) — que fica velho quando
      // ninguém reimporta e pode ficar bem abaixo da demanda real (caso
      // real confirmado: CANJICA mostrava 55/dia calculado a partir de
      // venda_m1/m2/m3 desatualizados, contra 200/dia do plano do BI atual
      // pro mesmo produto). DTBiPastaLocal.lerJson chama uma Cloud Function
      // (Graph API/SharePoint), não pede permissão de pasta local — seguro
      // buscar sozinho, sem exigir clique antes de abrir o Dashboard.
      if (!global._pcpInternals.getEstoqueBi?.() && global.DTBiPastaLocal?.suportado?.()) {
        await global._pcpInternals.buscarEstoqueBi?.().catch(() => {});
      }
      // Correção de desempenho: sem deduplicar produtos multi-loja antes de
      // chamar construirVisao(), o motor caía no pior caso (recalcula a
      // visão inteira por loja pra cada produto presente em mais de uma) —
      // medido em ~293s com o catálogo real, contra ~2s deduplicado.
      const visaoCrua = global._pcpInternals.construirVisao({ ...(global._pcpInternals.dadosConsolidadosTodasLojas?.() || {}), estoqueBi: global._pcpInternals.getEstoqueBi?.() });
      // Usa a mesma regra estrutural do Planejamento sem herdar filtros de tela
      // (loja/busca/ação) deixados pelo usuário em outra aba.
      const visao = global._pcpInternals.filtrarProdutosPlanejaveis
        ? global._pcpInternals.filtrarProdutosPlanejaveis(visaoCrua)
        : visaoCrua;
      const reqs = global._pcpInternals.getReqs();
      const agend = global._pcpInternals.getAgend();
      await _garantirSnapshotHoje(visao, reqs);
      const snapshots = await _carregarSnapshots(30);
      const comprasPorMesBi = await _carregarComprasPorMesBi();
      // A Central de Exceções também contém problemas que não nascem de um
      // único item da visão (compra atrasada, compra insuficiente, insumo não
      // comprado, produção sem insumo). O Dashboard precisa usar a lista
      // completa para cumprir o papel de "o que precisa da sua atenção hoje".
      const alertasCompletos = await global._pcpAlertasInternals?.calcularAlertas?.().catch?.(() => null) || null;
      _desenhar(visao, reqs, agend, snapshots, comprasPorMesBi, alertasCompletos);
    } catch (e) {
      pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>';
    }
  }

  function _kpi(cor, valor, label, aba, filtroAcao) {
    return `<div class="kpi ${cor}"${aba ? ` style="cursor:pointer" data-pcp-dash-ir="${aba}"${filtroAcao ? ` data-pcp-dash-acao="${filtroAcao}"` : ''}` : ''}><div class="kpi-val">${valor}</div><div class="kpi-lbl">${label}</div></div>`;
  }

  function _desenhar(visao, reqs, agend, snapshots, comprasPorMesBi, alertasCompletos) {
    const pagina = document.getElementById('page-pcp-dashboard');
    if (!pagina) return;
    const produzidoInternamente = global._pcpInternals.produzidoInternamente || (() => false);
    const acoes=[];
    const transf=global._pcpInternals.calcularSugestoesTransferencia?.()||[];
    if(Array.isArray(alertasCompletos)){
      alertasCompletos.filter(e=>String(e?.cor||'')!=='green').forEach(e=>acoes.push({
        item:{key:e.key||'',produto:String(e.titulo||'').replace(/^[^:]+:\s*/, '')||e.key||''},
        acao:String(e.acao||e.tipo||'REVISAR').toUpperCase(),motivo:e.detalhe||e.tipo||'',
        prioridade:_prioridadeExcecao(e),data:e.dataAcao||e.dataNecessaria||''
      }));
    }else{
      (visao||[]).forEach(item=>{
        try{
          const ex=global._pcpAlertasInternals?.excecoesDoProduto?.(item,produzidoInternamente)||[];
          ex.forEach(e=>acoes.push({item,acao:String(e.acao||e.tipo||'REVISAR').toUpperCase(),motivo:e.detalhe||e.tipo||'',prioridade:_prioridadeExcecao(e),data:e.dataAcao||e.dataNecessaria||''}));
        }catch(_){}
      });
      transf.forEach(t=>acoes.push({item:{key:t.key,produto:t.produto},acao:'TRANSFERIR',motivo:`${t.origemLojaNome} → ${t.destinoLojaNome} · ${Math.ceil(t.quantidade).toLocaleString('pt-BR')} cx`,prioridade:n(t.necessidadeRestante)>0?'alta':'normal',data:t.dataAcao||''}));
    }
    const unicas=[];const vistos=new Set();
    acoes.sort((a,b)=>(a.prioridade==='critica'?-1:a.prioridade==='alta'?0:1)-(b.prioridade==='critica'?-1:b.prioridade==='alta'?0:1));
    acoes.forEach(a=>{const k=(a.item?.key||'')+'|'+a.acao;if(!vistos.has(k)){vistos.add(k);unicas.push(a);}});
    // Não mistura ações de falta com revisão de excesso. "REVISAR COMPRA"
    // e "REVISAR PRODUÇÃO" têm sentido oposto a comprar/produzir agora e
    // ficam representadas pelo KPI de excesso/revisão, não pelos KPIs de ação.
    const compra=unicas.filter(a=>!/REVISAR/.test(a.acao)&&(/COMPR/.test(a.acao)||/ANTECIPAR ENTREGA/.test(a.acao))).length;
    const producao=unicas.filter(a=>!/REVISAR/.test(a.acao)&&(/PRODU/.test(a.acao)||/ANTECIPAR PRODUÇÃO/.test(a.acao))).length;
    const criticos=(visao||[]).filter(_itemCritico).length;
    const excesso=(visao||[]).filter(x=>x.excesso>0).length;
    const abertas=(reqs||[]).filter(x=>!/final|cancel|rejeit/i.test(String(x.status||''))).length;
    const prioritarias=unicas.slice(0,15);
    pagina.innerHTML=`
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📊 Dashboard do PCP</div><div style="font-size:.74rem;color:var(--muted)">O que precisa da sua atenção hoje. Detalhes de estoque e cobertura ficam em Planejamento.</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-pcp-dash-refresh>↻ Atualizar</button>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        ${_kpi(criticos?'red':'green',criticos,'Críticos','planejamento','critico')}
        ${_kpi(compra?'orange':'green',compra,'Ações de compra','planejamento','comprar')}
        ${_kpi(producao?'purple':'green',producao,'Ações de produção','planejamento','produzir')}
        ${_kpi(transf.length?'blue':'green',transf.length,'Transferências sugeridas','planejamento','transferir')}
        ${_kpi(excesso?'orange':'green',excesso,'Revisar excesso','planejamento','excesso')}
        ${_kpi('teal',abertas,'Solicitações abertas','pedidos')}
      </div>
      <div class="tc" style="padding:12px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>⚡ Ações prioritárias</b><button class="btn btn-ghost btn-sm" data-pcp-dash-ir="planejamento">Abrir Planejamento</button></div>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Produto</th><th>Ação</th><th>Motivo</th><th>Data limite</th></tr></thead><tbody>
        ${prioritarias.length?prioritarias.map(a=>`<tr><td><b style="cursor:pointer" data-pcp-360="${esc(a.item?.key||'')}">${esc(a.item?.produto||'')}</b></td><td><span class="badge ${a.prioridade==='critica'?'b-red':a.prioridade==='alta'?'b-orange':'b-blue'}">${esc(a.acao)}</span></td><td>${esc(a.motivo)}</td><td>${esc(a.data||'—')}</td></tr>`).join(''):'<tr><td colspan="4">Nenhuma ação prioritária no momento.</td></tr>'}
        </tbody></table></div>
      </div>
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:12px"><b>📈 Evolução — estoque total × cobertura típica (mediana)</b><div style="height:220px;margin-top:8px"><canvas id="pcpd-evolucao"></canvas></div></div>
        <div class="tc" style="padding:12px"><b>🛒 Compras reais da empresa por mês</b><div style="font-size:.68rem;color:var(--muted)">Quantidade faturada no BigQuery — inclui matéria-prima, embalagens e produto acabado; exclui departamentos MRO e Logística. Exibe os 12 meses mais recentes.</div><div style="height:220px;margin-top:8px"><canvas id="pcpd-compras-mes"></canvas></div></div>
      </div>`;
    _desenharGraficos(snapshots, comprasPorMesBi);
  }

  function _desenharGraficos(snapshots, comprasPorMesBi) {
    _destruirGraficos();
    if (!global.Chart) return;
    const ctxEvo = document.getElementById('pcpd-evolucao');
    if (ctxEvo) {
      charts.push(new global.Chart(ctxEvo, {
        type: 'line',
        data: {
          labels: snapshots.map(s => s.data),
          datasets: [
            { label: 'Estoque total (cx)', data: snapshots.map(s => s.estoqueTotalCx), borderColor: '#3b82f6', yAxisID: 'y' },
            { label: 'Cobertura típica — mediana (d)', data: snapshots.map(s => s.coberturaMedianaDias != null ? s.coberturaMedianaDias : s.coberturaMediaDias), borderColor: '#14b8a6', yAxisID: 'y1' },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } } },
      }));
    }
    const ctxCompras = document.getElementById('pcpd-compras-mes');
    if (ctxCompras) {
      // PEDIDO AO VIVO (2026-09-18): sempre o histórico REAL (BigQuery),
      // nunca mais soma quantidadeComprada de pcp_requisicoes_compra —
      // sem o BI disponível, o gráfico fica vazio em vez de mostrar o
      // número da solicitação manual de novo.
      const meses = (comprasPorMesBi || []).slice()
        .sort((a, b) => String(a.mes || '').localeCompare(String(b.mes || '')))
        .slice(-12);
      charts.push(new global.Chart(ctxCompras, {
        type: 'bar',
        data: { labels: meses.map(m => m.mes), datasets: [{ label: 'Quantidade comprada', data: meses.map(m => Number(m.qtd) || 0), backgroundColor: '#f59e0b' }] },
        options: { responsive: true, maintainAspectRatio: false },
      }));
    }
  }

  global.pcpRegistrarPagina?.('dashboard', { elId: 'page-pcp-dashboard', render: 'renderPCPDashboard', titulo: 'Dashboard' });
  global.renderPCPDashboard = renderPCPDashboard;

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-pcp-dash-refresh]')) { renderPCPDashboard(); return; }
    const ir = event.target.closest('[data-pcp-dash-ir]');
    if (ir) {
      const aba = ir.getAttribute('data-pcp-dash-ir');
      const acao = ir.getAttribute('data-pcp-dash-acao') || '';
      const navId = 'nav-pcp-' + aba;
      global.pcpIrParaAba?.(aba, document.getElementById(navId), acao ? { loja:'', busca:'', marca:'', categoria:'', situacao:'', acao, ocultarZerados:false } : undefined);
    }
  });
})(window);
