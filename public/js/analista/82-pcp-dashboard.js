// PCP — Fase 8: Dashboard. Lê exclusivamente construirVisao() (o único
// motor de cálculo de estoque/necessidade/cobertura, em 78-pcp-central.js)
// mais as coleções que o próprio PCP já carrega — nenhum cálculo paralelo
// é feito aqui, isto é 100% camada de apresentação.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_SNAP = 'pcp_snapshots_diarios';
  const charts = [];

  function fs() { return global.getDTFirestore(); }
  function hoje() { return new Date().toISOString().slice(0, 10); }

  // Snapshot agregado (não por produto — evita explosão de documentos),
  // gravado de forma passiva: só quando o dashboard é aberto e o snapshot
  // do dia ainda não existe. Alimenta o gráfico de evolução.
  async function _garantirSnapshotHoje(visao, reqs) {
    try {
      const ref = fs().collection(COL_SNAP).doc(hoje());
      const snap = await ref.get();
      if (snap.exists) return;
      const estoqueTotalCx = visao.reduce((s, x) => s + x.estoqueAtual, 0);
      const comCobertura = visao.filter(x => x.coberturaDias != null);
      const coberturaMediaDias = comCobertura.length ? comCobertura.reduce((s, x) => s + x.coberturaDias, 0) / comCobertura.length : 0;
      const produtosCriticos = visao.filter(x => x.coberturaDias != null && x.coberturaDias <= 3).length;
      const produtosAbaixoMinimo = visao.filter(x => x.estoqueMinimo > 0 && x.estoqueAtual < x.estoqueMinimo).length;
      const abertas = (reqs || []).filter(x => !/final|cancel|rejeit/i.test(String(x.status || '')));
      const comprasAbertasQtd = abertas.length;
      const agora = new Date().toISOString();
      await ref.set({ data: hoje(), estoqueTotalCx, coberturaMediaDias, produtosCriticos, produtosAbaixoMinimo, comprasAbertasQtd, criadoEm: agora, atualizadoEm: agora }, { merge: true });
    } catch (e) { console.warn('[pcp-dashboard] snapshot diário:', e); }
  }

  async function _carregarSnapshots(dias) {
    const snap = await fs().collection(COL_SNAP).get().catch(() => ({ docs: [] }));
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a, b) => String(a.data).localeCompare(String(b.data)))
      .slice(-(dias || 30));
  }

  function _destruirGraficos() { while (charts.length) charts.pop().destroy(); }

  async function renderPCPDashboard() {
    const pagina = document.getElementById('page-pcp-dashboard');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando dashboard...</div></div>';
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
      const visao = global._pcpInternals.construirVisao({ estoqueBi: global._pcpInternals.getEstoqueBi?.() });
      const reqs = global._pcpInternals.getReqs();
      const agend = global._pcpInternals.getAgend();
      await _garantirSnapshotHoje(visao, reqs);
      const snapshots = await _carregarSnapshots(30);
      _desenhar(visao, reqs, agend, snapshots);
    } catch (e) {
      pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>';
    }
  }

  function _kpi(cor, valor, label, aba) {
    return `<div class="kpi ${cor}"${aba ? ` style="cursor:pointer" data-pcp-dash-ir="${aba}"` : ''}><div class="kpi-val">${valor}</div><div class="kpi-lbl">${label}</div></div>`;
  }

  function _desenhar(visao, reqs, agend, snapshots) {
    const pagina = document.getElementById('page-pcp-dashboard');
    if (!pagina) return;
    const hojeStr = hoje();
    const estoqueTotal = visao.reduce((s, x) => s + x.estoqueAtual, 0);
    const comCobertura = visao.filter(x => x.coberturaDias != null);
    const coberturaMedia = comCobertura.length ? comCobertura.reduce((s, x) => s + x.coberturaDias, 0) / comCobertura.length : 0;
    const abaixoMinimo = visao.filter(x => x.estoqueMinimo > 0 && x.estoqueAtual < x.estoqueMinimo);
    const criticos = visao.filter(x => x.coberturaDias != null && x.coberturaDias <= 3);
    const proxRuptura = visao.filter(x => x.rupturaEm && x.rupturaEm !== 'sem data');
    const excesso = visao.filter(x => x.excesso > 0);
    // PEDIDO AO VIVO (2026-09-02): "todo produto cadastrado na produção não
    // é feito compra" — produto produzido internamente (empresaProdutoraId)
    // nunca deve contar como "necessidade de COMPRA" (mesmo filtro que
    // comprasHtml já aplica em 78-pcp-central.js, faltava aqui).
    const produzidoInternamente = global._pcpInternals.produzidoInternamente || (() => false);
    const necessidades = visao.filter(x => x.necessidade > 0 && !produzidoInternamente(x.key));
    const necessidadeTotalCx = necessidades.reduce((s, x) => s + x.necessidade, 0);
    const abertas = (reqs || []).filter(x => !/final|cancel|rejeit/i.test(String(x.status || '')));
    const atrasadas = (agend || []).filter(x => x.dataPrevista && x.dataPrevista < hojeStr && !/final/i.test(String(x.status || '')));
    const produtosComProducao = visao.filter(x => x.producaoProgramada > 0).length;
    const maiorConsumo = visao.slice().sort((a, b) => b.consumoDia - a.consumoDia).filter(x => x.consumoDia > 0).slice(0, 6);

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📊 Dashboard do PCP</div><div style="font-size:.74rem;color:var(--muted)">Visão consolidada de estoque, cobertura, necessidades e compras</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-pcp-dash-refresh>↻ Atualizar</button>
      </div>
      <div class="kpi-grid" style="margin-bottom:10px">
        ${_kpi('blue', estoqueTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), 'Estoque atual (cx)', 'estoque')}
        ${_kpi('teal', coberturaMedia.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'd', 'Cobertura média', 'estoque')}
        ${_kpi(abaixoMinimo.length ? 'orange' : 'green', abaixoMinimo.length, 'Abaixo do mínimo', 'estoque')}
        ${_kpi(criticos.length ? 'red' : 'green', criticos.length, 'Produtos críticos (≤3d)', 'estoque')}
        ${_kpi(proxRuptura.length ? 'red' : 'green', proxRuptura.length, 'Próx. de ruptura', 'pedidos-estoque')}
        ${_kpi('purple', excesso.length, 'Em excesso', 'estoque')}
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        ${_kpi('orange', necessidadeTotalCx.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), 'Necessidade de compra (cx)', 'compras')}
        ${_kpi('blue', abertas.length, 'Requisições abertas', 'compras')}
        ${_kpi(atrasadas.length ? 'red' : 'green', atrasadas.length, 'Compras atrasadas', 'agendamentos')}
        ${_kpi('teal', agend.filter(x => !/final|cancel/i.test(String(x.status || ''))).length, 'Entregas previstas', 'agendamentos')}
        ${_kpi('purple', produtosComProducao, 'Produtos com produção programada', 'producao')}
      </div>
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:12px">
          <b>📈 Evolução — estoque total × cobertura média</b>
          <div style="height:220px;margin-top:8px"><canvas id="pcpd-evolucao"></canvas></div>
        </div>
        <div class="tc" style="padding:12px">
          <b>🛒 Compras por mês (quantidade)</b>
          <div style="height:220px;margin-top:8px"><canvas id="pcpd-compras-mes"></canvas></div>
        </div>
      </div>
      <div class="tc" style="padding:12px">
        <b>🔥 Maior consumo diário</b>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Produto</th><th>Consumo/dia</th><th>Cobertura</th><th>Necessidade</th><th></th></tr></thead><tbody>
        ${maiorConsumo.length ? maiorConsumo.map(x => `<tr><td><b style="cursor:pointer" data-pcp-360="${esc(x.key)}">${esc(x.produto)}</b></td><td>${x.consumoDia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td><td>${x.coberturaDias == null ? '—' : x.coberturaDias.toFixed(1) + 'd'}</td><td>${x.necessidade.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td><td><button class="acao-lapis" title="Ver memória de cálculo" data-pcp-memoria="${esc(x.key)}">🧮</button></td></tr>`).join('') : '<tr><td colspan="5">Sem dados de consumo ainda.</td></tr>'}
        </tbody></table></div>
      </div>`;

    _desenharGraficos(snapshots, reqs);
  }

  function _desenharGraficos(snapshots, reqs) {
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
            { label: 'Cobertura média (d)', data: snapshots.map(s => s.coberturaMediaDias), borderColor: '#14b8a6', yAxisID: 'y1' },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } } },
      }));
    }
    const ctxCompras = document.getElementById('pcpd-compras-mes');
    if (ctxCompras) {
      const porMes = new Map();
      (reqs || []).filter(x => x.compradoEm).forEach(x => {
        const mes = String(x.compradoEm).slice(0, 7);
        porMes.set(mes, (porMes.get(mes) || 0) + (Number(x.quantidadeComprada) || 0));
      });
      const meses = [...porMes.keys()].sort();
      charts.push(new global.Chart(ctxCompras, {
        type: 'bar',
        data: { labels: meses, datasets: [{ label: 'Quantidade comprada', data: meses.map(m => porMes.get(m)), backgroundColor: '#f59e0b' }] },
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
      const navId = 'nav-pcp-' + (aba === 'pedidos-estoque' ? 'cruzamento' : aba);
      global.pcpIrParaAba?.(aba, document.getElementById(navId));
    }
  });
})(window);
