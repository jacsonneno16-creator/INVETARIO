// PCP — Central de Excecoes e Acoes. 100% derivada dos dados ja carregados
// pelo PCP: nao abre nenhuma leitura adicional para calcular prioridade,
// data limite ou acao sugerida.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const ORDEM_COR = { red: 0, orange: 1, yellow: 2, blue: 3, green: 4 };
  let _filtroAcao = '';
  let _busca = '';

  function _hojeStr() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 10); }
  function _diasAte(dataIso) {
    if (!dataIso) return null;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const alvo = new Date(String(dataIso) + 'T00:00:00');
    if (Number.isNaN(alvo.getTime())) return null;
    return Math.ceil((alvo.getTime() - hoje.getTime()) / 86400000);
  }
  function _rotuloPrazo(dataIso) {
    const dias = _diasAte(dataIso);
    if (dias == null) return 'Sem data calculada';
    if (dias < 0) return `Atrasada ${Math.abs(dias)}d`;
    if (dias === 0) return 'Agir hoje';
    if (dias === 1) return 'Agir amanhã';
    return `Agir em ${dias}d`;
  }
  function _primeiroSuprimento(item) {
    return (item.eventos || []).filter(ev => n(ev.delta) > 0 && ev.data).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)))[0] || null;
  }
  function _criarExcecao(base) {
    return {
      tipo: base.tipo || 'acao', cor: base.cor || 'yellow', icone: base.icone || '🟡',
      titulo: base.titulo || '', detalhe: base.detalhe || '', aba: base.aba || 'pedidos-estoque', key: base.key || '',
      acao: base.acao || 'REVISAR', dataAcao: base.dataAcao || '', dataNecessaria: base.dataNecessaria || '',
      responsavel: base.responsavel || 'PCP', quantidade: n(base.quantidade), origem: base.origem || 'PCP',
    };
  }

  // Transforma um item ja calculado pelo motor/timeline em uma acao operacional.
  // Nao busca nada: recebe o item pronto e apenas classifica a excecao.
  function _excecoesDoProduto(item, produzidoInternamente) {
    const risco = global._pcpTimelineInternals?.calcularRiscoTemporal?.(item, 365) || null;
    const cobertura = item.coberturaProjetadaDias != null ? item.coberturaProjetadaDias : item.coberturaDias;
    // PEDIDO AO VIVO (2026-10-01): item.coberturaDias/coberturaProjetadaDias
    // vêm floorados em 0 (construirVisao), de propósito, pra classificação
    // de risco (daqui pra baixo, usa `cobertura` normal); só o TEXTO do
    // alerta mostrado ao usuário (campo `detalhe`) usa a versão sem o piso,
    // pra mostrar os dias negativos de verdade quando já passou da ruptura.
    const coberturaProjetadaReal = item.consumoDia > 0 ? item.saldo / item.consumoDia : null;
    const coberturaReal = item.coberturaProjetadaDias != null ? coberturaProjetadaReal : (item.consumoDia > 0 ? item.estoqueDisponivel / item.consumoDia : null);
    const estoqueDisponivel = item.estoqueDisponivel != null ? item.estoqueDisponivel : item.estoqueAtual;
    const interno = !!produzidoInternamente?.(item.key);
    const acaoBase = interno ? 'PRODUZIR' : 'COMPRAR';
    const abaBase = interno ? 'producao' : 'compras';
    const primeiroSuprimento = _primeiroSuprimento(item);
    const temDemanda = n(item.consumoDia) > 0 || n(item.necessidade) > 0;
    const dataAcao = risco?.pontoPedidoEm || ((temDemanda && estoqueDisponivel <= 0) || (item.necessidade > 0 && cobertura != null && item.leadTimeDias > 0 && cobertura < item.leadTimeDias) ? _hojeStr() : '');
    const dataRuptura = risco?.rupturaEm || '';
    const alertasMotor = Array.isArray(item.alertasCalculo) ? item.alertasCalculo : [];
    const out = [];

    if (estoqueDisponivel <= 0 && temDemanda) {
      out.push(_criarExcecao({ tipo: 'sem_estoque', cor: 'red', icone: '🔴', key: item.key, aba: abaBase,
        acao: acaoBase, dataAcao: dataAcao || _hojeStr(), dataNecessaria: dataRuptura || '', quantidade: item.quantidadeSugerida || item.necessidade,
        titulo: `${acaoBase}: ${item.produto}`,
        detalhe: `Saldo disponível zerado ou negativo. ${_rotuloPrazo(dataAcao || _hojeStr())}${dataRuptura ? ` · ruptura projetada ${dataRuptura}` : ''}.` }));
      return out;
    }

    if (dataRuptura) {
      let acao = acaoBase;
      let detalheSuprimento = '';
      if (primeiroSuprimento && primeiroSuprimento.data > dataRuptura) {
        acao = primeiroSuprimento.tipo === 'producao' ? 'ANTECIPAR PRODUÇÃO' : 'ANTECIPAR ENTREGA';
        detalheSuprimento = ` Suprimento atual está previsto para ${primeiroSuprimento.data}, depois da ruptura.`;
      }
      out.push(_criarExcecao({ tipo: 'ruptura_prevista', cor: 'red', icone: '🔴', key: item.key, aba: abaBase,
        acao, dataAcao: dataAcao || _hojeStr(), dataNecessaria: dataRuptura, quantidade: item.quantidadeSugerida || item.necessidade,
        titulo: `${acao}: ${item.produto}`,
        detalhe: `Ruptura projetada em ${dataRuptura}. ${_rotuloPrazo(dataAcao || _hojeStr())}.${detalheSuprimento}` }));
      return out;
    }

    const coberturaMenorLead = alertasMotor.some(a => String(a.code || a.tipo || '').toUpperCase().includes('COBERTURA_MENOR_LEADTIME')) || (cobertura != null && item.leadTimeDias > 0 && cobertura < item.leadTimeDias);
    if (coberturaMenorLead) {
      out.push(_criarExcecao({ tipo: 'cobertura_menor_leadtime', cor: 'red', icone: '🔴', key: item.key, aba: abaBase,
        acao: acaoBase, dataAcao: dataAcao || _hojeStr(), quantidade: item.quantidadeSugerida || item.necessidade,
        titulo: `${acaoBase}: ${item.produto}`,
        detalhe: `Cobertura projetada ${Number(coberturaReal ?? 0).toFixed(1)}d, abaixo do lead time de ${Number(item.leadTimeDias || 0).toFixed(0)}d${item.leadTimeRotulo ? ' (' + item.leadTimeRotulo + ')' : ''}. ${_rotuloPrazo(dataAcao || _hojeStr())}.` }));
      return out;
    }

    if (item.necessidade > 0 && item.coberturaProjetadaDias != null && item.coberturaProjetadaDias < item.diasAlvo) {
      out.push(_criarExcecao({ tipo: 'abaixo_cobertura', cor: 'orange', icone: '🟠', key: item.key, aba: abaBase,
        acao: interno ? 'PLANEJAR PRODUÇÃO' : 'PLANEJAR COMPRA', dataAcao: dataAcao, quantidade: item.quantidadeSugerida || item.necessidade,
        titulo: `${interno ? 'Planejar produção' : 'Planejar compra'}: ${item.produto}`,
        detalhe: `Cobertura projetada ${(coberturaProjetadaReal ?? 0).toFixed(1)}d, meta ${item.diasAlvo}d.${dataAcao ? ` ${_rotuloPrazo(dataAcao)}.` : ''}` }));
    }

    // Excesso com suprimento ainda por chegar e uma excecao operacional: nao
    // cancela automaticamente, apenas pede revisao do que ja esta programado.
    if (item.excesso > 0 && primeiroSuprimento) {
      const acao = primeiroSuprimento.tipo === 'producao' ? 'REVISAR PRODUÇÃO' : 'REVISAR COMPRA';
      out.push(_criarExcecao({ tipo: 'excesso_com_suprimento', cor: 'yellow', icone: '🟡', key: item.key,
        aba: primeiroSuprimento.tipo === 'producao' ? 'producao' : 'agendamentos', acao, dataAcao: _hojeStr(), quantidade: item.excesso,
        titulo: `${acao}: ${item.produto}`,
        detalhe: `Saldo projetado excede o alvo em ${Math.ceil(item.excesso).toLocaleString('pt-BR')} e existe ${primeiroSuprimento.tipo === 'producao' ? 'produção' : 'entrada'} prevista para ${primeiroSuprimento.data}. Revisar antes de manter o suprimento.` }));
    }
    return out;
  }

  async function _calcularAlertas() {
    const internos = global._pcpInternals;
    await internos.carregar();
    // Correção de desempenho: sem deduplicar produtos multi-loja antes de
    // chamar construirVisao(), o motor caía no pior caso (recalcula a visão
    // inteira por loja pra cada produto presente em mais de uma) — medido em
    // ~293s com o catálogo real, contra ~2s deduplicado.
    const visaoCrua = internos.construirVisao({ ...(internos.dadosConsolidadosTodasLojas?.() || {}), estoqueBi: internos.getEstoqueBi?.() });
    const visaoBase = internos.filtrarProdutosPlanejaveis ? internos.filtrarProdutosPlanejaveis(visaoCrua) : visaoCrua;
    // Produto zerado e sem demanda não é ruptura operacional. Mantém itens com
    // estoque, consumo ou necessidade calculada e elimina descontinuados sem giro.
    const visao = visaoBase.filter(x => n(x.consumoDia) > 0 || n(x.estoqueAtual) > 0 || n(x.necessidade) > 0);
    const reqs = internos.getReqs?.() || [];
    const agend = internos.getAgend?.() || [];
    const hojeStr = _hojeStr();
    const alertas = [];
    const produzidoInternamente = internos.produzidoInternamente || (() => false);

    visao.forEach(item => alertas.push(..._excecoesDoProduto(item, produzidoInternamente)));

    // Fase 2.2: antes de recomendar uma compra local, sinaliza estoque que já
    // existe em outra loja e está acima da reserva operacional daquela origem.
    // O cálculo é 100% em memória; não cria transferência nem nova leitura.
    const transferencias = internos.calcularSugestoesTransferencia?.() || [];
    transferencias.forEach(t => {
      const residual = Math.max(0, n(t.necessidadeRestante));
      alertas.push(_criarExcecao({ tipo: 'transferencia_lojas', cor: residual > 0 ? 'orange' : 'blue', icone: '🔄', key: t.key, titulo: 'TRANSFERIR: ' + t.produto,
        detalhe: `${Math.ceil(n(t.quantidade)).toLocaleString('pt-BR')} cx disponíveis acima da reserva em ${t.origemLojaNome} para atender ${t.destinoLojaNome}.${residual > 0 ? ` Necessidade local restante após a transferência: ${Math.ceil(residual).toLocaleString('pt-BR')} cx.` : ' A transferência cobre a necessidade local calculada.'}`,
        aba: 'planejamento', acao: 'TRANSFERIR', dataAcao: t.dataAcao || hojeStr, quantidade: t.quantidade, responsavel: 'PCP/Logística' }));
    });

    agend.filter(a => a.dataPrevista && a.dataPrevista < hojeStr && !/final|cancel|rejeit/i.test(String(a.status || ''))).forEach(a => {
      alertas.push(_criarExcecao({ tipo: 'compra_atrasada', cor: 'red', icone: '🔴', key:a.produtoKey||a.prodKey||a.cod||'', titulo: 'COBRAR/REPROGRAMAR: ' + a.produto,
        detalhe: 'Entrega prevista para ' + a.dataPrevista + ' ainda não foi finalizada.', aba: 'pedidos', acao: 'COBRAR/REPROGRAMAR', dataAcao: hojeStr, dataNecessaria: a.dataPrevista, responsavel: 'Compras' }));
    });

    reqs.filter(r => r.status === 'comprada' && n(r.quantidadeComprada) < n(r.quantidade)).forEach(r => {
      alertas.push(_criarExcecao({ tipo: 'compra_insuficiente', key: String(r?.key||r?.prodKey||r?.cod||r?.produtoKey||r?.produto||''), cor: 'orange', icone: '🟠', titulo: 'COMPLEMENTAR COMPRA: ' + r.produto,
        detalhe: 'Solicitado ' + n(r.quantidade).toLocaleString('pt-BR') + ', comprado ' + n(r.quantidadeComprada).toLocaleString('pt-BR') + '.', aba: 'pedidos', acao: 'COMPLEMENTAR COMPRA', dataAcao: hojeStr, quantidade: n(r.quantidade) - n(r.quantidadeComprada), responsavel: 'Compras' }));
    });

    reqs.filter(r => r.tipoSolicitacao === 'insumo' && !(n(r.quantidadeComprada) > 0) && !/cancel|final/i.test(String(r.status || ''))).forEach(r => {
      alertas.push(_criarExcecao({ tipo: 'insumo_nao_comprado', key: String(r?.key||r?.prodKey||r?.cod||r?.produtoKey||r?.produto||''), cor: 'red', icone: '🔴', titulo: 'COMPRAR INSUMO: ' + r.produto,
        detalhe: 'Insumo solicitado para produção ainda não possui quantidade comprada.', aba: 'producao-insumo', acao: 'COMPRAR INSUMO', dataAcao: hojeStr, quantidade: r.quantidade, responsavel: 'Compras' }));
    });

    // Usa exatamente o MESMO calculo BI-aware da aba Insumos da Producao.
    // Evita comparar OPs contra `producao_insumos_estoque` antigo quando o
    // dados-insumos.json ja trouxe um saldo mais recente.
    try {
      const calcInsumos = global._pcpProducaoInsumosInternals?._calcular;
      if (typeof calcInsumos === 'function') {
        const resultadoInsumos = await calcInsumos();
        (resultadoInsumos?.porInsumo || []).filter(x=>x.status==='falta').forEach(x => {
          const falta=Math.max(0,-n(x.saldo));
          if(falta<=0)return;
          alertas.push(_criarExcecao({ tipo: 'producao_sem_insumo', key: String(x?.key||x?.prodKey||x?.cod||x?.produtoKey||x?.insumo||''), cor: 'yellow', icone: '🟡', titulo: 'COMPRAR INSUMO: ' + x.insumo,
            detalhe: 'Faltam ' + falta.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' ' + (x.unidade || '') + ' para a produção programada.', aba: 'producao-insumo', acao: 'COMPRAR INSUMO', dataAcao: hojeStr, quantidade: falta, responsavel: 'PCP/Compras' }));
        });
      }
    } catch (e) { console.warn('[pcp-alertas] insumos:', e); }

    const limite24h = Date.now() - 24 * 60 * 60 * 1000;
    agend.filter(a => a.recebidoEm && new Date(a.recebidoEm).getTime() > limite24h).forEach(a => {
      alertas.push(_criarExcecao({ tipo: 'compra_recebida', key: String(a?.key||a?.prodKey||a?.cod||a?.produtoKey||a?.produto||''), cor: 'green', icone: '🟢', titulo: 'RECEBIDO: ' + a.produto,
        detalhe: 'Recebido em ' + String(a.recebidoEm).slice(0, 16).replace('T', ' ') + '.', aba: 'agendamentos', acao: 'CONCLUÍDO', responsavel: 'Recebimento' }));
    });

    return alertas.sort((a, b) => {
      const sev = (ORDEM_COR[a.cor] ?? 9) - (ORDEM_COR[b.cor] ?? 9);
      if (sev) return sev;
      const da = _diasAte(a.dataAcao), db = _diasAte(b.dataAcao);
      return (da == null ? 999999 : da) - (db == null ? 999999 : db);
    });
  }

  async function renderPCPAlertas() {
    const pagina = document.getElementById('page-pcp-alertas');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Calculando ações...</div></div>';
    try { _desenhar(await _calcularAlertas()); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; }
  }

  function _desenhar(alertas) {
    const pagina = document.getElementById('page-pcp-alertas');
    if (!pagina) return;
    const criticos = alertas.filter(a => a.cor === 'red').length;
    const hoje = alertas.filter(a => a.dataAcao && _diasAte(a.dataAcao) <= 0 && a.cor !== 'green').length;
    const acoes = Array.from(new Set(alertas.filter(a => a.cor !== 'green').map(a => a.acao).filter(Boolean))).sort();
    const busca = norm(_busca);
    const filtrados = alertas.filter(a => (!_filtroAcao || a.acao === _filtroAcao) && (!busca || norm(`${a.titulo} ${a.detalhe} ${a.acao}`).includes(busca)));
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">🚨 Central de Exceções e Ações</div><div style="font-size:.74rem;color:var(--muted)">O que precisa ser feito, por quê e até quando · cálculo sobre os dados já carregados</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-pcpal-refresh>↻ Atualizar</button>
      </div>
      <div class="kpi-grid" style="margin-bottom:12px">
        <div class="kpi red"><div class="kpi-val">${criticos}</div><div class="kpi-lbl">Críticos</div></div>
        <div class="kpi orange"><div class="kpi-val">${hoje}</div><div class="kpi-lbl">Ações para hoje</div></div>
        <div class="kpi blue"><div class="kpi-val">${alertas.filter(a => a.cor !== 'green').length}</div><div class="kpi-lbl">Exceções abertas</div></div>
        <div class="kpi green"><div class="kpi-val">${alertas.filter(a => a.cor === 'green').length}</div><div class="kpi-lbl">Concluídas recentes</div></div>
      </div>
      <div class="tc" style="padding:10px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="field" id="pcpal-busca" style="max-width:300px" placeholder="Buscar produto, motivo ou ação" value="${esc(_busca)}">
        <select class="field" id="pcpal-filtro-acao" style="max-width:240px"><option value="">Todas as ações</option>${acoes.map(a => `<option value="${esc(a)}"${a===_filtroAcao?' selected':''}>${esc(a)}</option>`).join('')}</select>
        <span style="font-size:.72rem;color:var(--muted)">${filtrados.length} de ${alertas.length}</span>
      </div>
      <div style="overflow:auto"><table class="dt-table"><thead><tr><th>Prioridade</th><th>Ação sugerida</th><th>Produto / motivo</th><th>Data limite</th><th>Ruptura/necessidade</th><th>Qtd.</th><th></th></tr></thead><tbody>
        ${filtrados.length ? filtrados.map(a => `
          <tr data-pcpal-ir="${esc(a.aba)}" ${a.key ? `data-pcpal-key="${esc(a.key)}"` : ''} style="cursor:pointer">
            <td><span class="badge b-${a.cor === 'yellow' ? 'orange' : a.cor}">${a.icone} ${esc(a.tipo)}</span></td>
            <td><b>${esc(a.acao)}</b><div style="font-size:.68rem;color:var(--muted)">${esc(a.responsavel)}</div></td>
            <td><b>${esc(a.titulo.replace(/^.*?:\s*/, ''))}</b><div style="font-size:.71rem;color:var(--muted);max-width:520px">${esc(a.detalhe)}</div></td>
            <td>${a.dataAcao ? `<b>${esc(a.dataAcao)}</b><div style="font-size:.68rem;color:var(--muted)">${esc(_rotuloPrazo(a.dataAcao))}</div>` : '—'}</td>
            <td>${a.dataNecessaria ? esc(a.dataNecessaria) : '—'}</td>
            <td>${a.quantidade > 0 ? Math.ceil(a.quantidade).toLocaleString('pt-BR') : '—'}</td>
            <td>›</td>
          </tr>`).join('') : '<tr><td colspan="7"><div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Nenhuma exceção para os filtros</div></div></td></tr>'}
      </tbody></table></div>`;
  }

  global.pcpRegistrarPagina?.('alertas', { elId: 'page-pcp-alertas', render: 'renderPCPAlertas', titulo: 'Exceções e Ações' });
  global.renderPCPAlertas = renderPCPAlertas;
  global._pcpAlertasInternals = { calcularAlertas: _calcularAlertas, excecoesDoProduto: _excecoesDoProduto, diasAte: _diasAte, rotuloPrazo: _rotuloPrazo };

  document.addEventListener('input', function (event) {
    if (event.target?.id === 'pcpal-busca') { _busca = event.target.value || ''; renderPCPAlertas(); }
  });
  document.addEventListener('change', function (event) {
    if (event.target?.id === 'pcpal-filtro-acao') { _filtroAcao = event.target.value || ''; renderPCPAlertas(); }
  });
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-pcpal-refresh]')) { renderPCPAlertas(); return; }
    const card = event.target.closest('[data-pcpal-ir]');
    if (card) {
      const aba = card.getAttribute('data-pcpal-ir');
      const key = card.getAttribute('data-pcpal-key');
      const navMap = { planejamento:'nav-pcp-planejamento', compras:'nav-pcp-planejamento', 'pedidos-estoque':'nav-pcp-planejamento', pedidos:'nav-pcp-pedidos', agendamentos:'nav-pcp-pedidos', insumos:'nav-pcp-insumos', 'producao-insumo':'nav-pcp-insumos', producao:'nav-pcp-producao', parametros:'nav-pcp-parametros' };
      global.pcpIrParaAba?.(aba, document.getElementById(navMap[aba] || ''));
      if (key) setTimeout(() => global.modalMemoria?.(key), 60);
    }
  });
})(window);
