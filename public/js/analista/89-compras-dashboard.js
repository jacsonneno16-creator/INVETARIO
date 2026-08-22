// Compras — Fase 10: Dashboard. Reaproveita _comprasInternals (carregar,
// historicoCompras, agruparHistorico) já promovidos em 79-compras-central.js
// — mesma base de dados/escopo (própria ou "todos os compradores", conforme
// o toggle já existente na aba Histórico), nenhuma consulta nova.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const charts = [];

  function _destruirGraficos() { while (charts.length) charts.pop().destroy(); }

  async function renderComprasDashboard() {
    const pagina = document.getElementById('page-compras-dashboard');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando dashboard...</div></div>';
    try {
      await global._comprasInternals.carregar();
      _desenhar();
    } catch (e) {
      pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>';
    }
  }

  function _desenhar() {
    const pagina = document.getElementById('page-compras-dashboard');
    if (!pagina) return;
    const internos = global._comprasInternals;
    const historico = internos.historicoCompras(); // já filtrado: quantidadeComprada>0
    const base = internos.historicoBase(); // todas as requisições no escopo atual (não só compradas)
    const hoje = new Date(), anoAtual = hoje.getFullYear(), mesAtual = hoje.getMonth();
    const compradoNoMes = historico.filter(r => { const d = new Date(r.compradoEm); return d.getFullYear() === anoAtual && d.getMonth() === mesAtual; }).reduce((s, r) => s + n(r.valorTotal), 0);
    const compradoNoAno = historico.filter(r => new Date(r.compradoEm).getFullYear() === anoAtual).reduce((s, r) => s + n(r.valorTotal), 0);
    const abertas = base.filter(x => !/final|cancel|rejeit/i.test(String(x.status || '')));
    const atrasadas = base.filter(x => x.dataPrevista && x.dataPrevista < hoje.toISOString().slice(0, 10) && !/final/i.test(String(x.status || '')));
    const recebidas = base.filter(x => /final/i.test(String(x.status || '')));
    const pendentesPCP = base.filter(x => x.status === 'sem_comprador' || x.status === 'solicitada');
    const valorMedioPedido = historico.length ? historico.reduce((s, r) => s + n(r.valorTotal), 0) / historico.length : 0;

    // Agregações por produto/fornecedor (a própria dashboard, sem alterar
    // agruparHistorico que já é usado — e testado — pela aba Histórico).
    const porProduto = new Map(), porFornecedor = new Map(), porMes = new Map(), porCategoria = new Map();
    const precosPorProduto = new Map();
    historico.forEach(r => {
      const chave = String(r.prodKey || r.cod || r.produto || '').trim();
      const pp = porProduto.get(chave) || { produto: r.produto, qtd: 0, valor: 0 };
      pp.qtd += n(r.quantidadeComprada); pp.valor += n(r.valorTotal); porProduto.set(chave, pp);
      if (r.fornecedor) { const pf = porFornecedor.get(r.fornecedor) || { fornecedor: r.fornecedor, qtd: 0, valor: 0 }; pf.qtd += n(r.quantidadeComprada); pf.valor += n(r.valorTotal); porFornecedor.set(r.fornecedor, pf); }
      if (r.compradoEm) { const mes = String(r.compradoEm).slice(0, 7); porMes.set(mes, (porMes.get(mes) || 0) + n(r.valorTotal)); }
      if (n(r.precoUnitario) > 0) { const arr = precosPorProduto.get(chave) || []; arr.push(r); precosPorProduto.set(chave, arr); }
    });
    const topProdutosValor = [...porProduto.values()].sort((a, b) => b.valor - a.valor).slice(0, 10);
    const topFornecedores = [...porFornecedor.values()].sort((a, b) => b.valor - a.valor).slice(0, 10);
    const variacoes = [];
    precosPorProduto.forEach((lista, chave) => {
      if (lista.length < 2) return;
      const ordenada = lista.slice().sort((a, b) => String(a.compradoEm || '').localeCompare(String(b.compradoEm || '')));
      const primeiro = n(ordenada[0].precoUnitario), ultimo = n(ordenada[ordenada.length - 1].precoUnitario);
      if (primeiro > 0) variacoes.push({ produto: ordenada[0].produto, variacaoPct: (ultimo - primeiro) / primeiro * 100 });
    });
    const maisSubiram = variacoes.slice().sort((a, b) => b.variacaoPct - a.variacaoPct).slice(0, 10);
    const maisCairam = variacoes.slice().sort((a, b) => a.variacaoPct - b.variacaoPct).slice(0, 10);

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📊 Dashboard de Compras</div><div style="font-size:.74rem;color:var(--muted)">${historico.length.toLocaleString('pt-BR')} compra(s) registrada(s)</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-compd-refresh>↻ Atualizar</button>
      </div>
      <div class="kpi-grid" style="margin-bottom:10px">
        <div class="kpi blue"><div class="kpi-val">${compradoNoMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div><div class="kpi-lbl">Comprado no mês</div></div>
        <div class="kpi teal"><div class="kpi-val">${compradoNoAno.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div><div class="kpi-lbl">Comprado no ano</div></div>
        <div class="kpi purple"><div class="kpi-val">${historico.length}</div><div class="kpi-lbl">Nº de pedidos</div></div>
        <div class="kpi orange"><div class="kpi-val">${valorMedioPedido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div><div class="kpi-lbl">Valor médio/pedido</div></div>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${abertas.length}</div><div class="kpi-lbl">Pedidos em aberto</div></div>
        <div class="kpi ${atrasadas.length ? 'red' : 'green'}"><div class="kpi-val">${atrasadas.length}</div><div class="kpi-lbl">Atrasados</div></div>
        <div class="kpi green"><div class="kpi-val">${recebidas.length}</div><div class="kpi-lbl">Recebidos</div></div>
        <div class="kpi ${pendentesPCP.length ? 'orange' : 'green'}"><div class="kpi-val">${pendentesPCP.length}</div><div class="kpi-lbl">Demandas do PCP pendentes</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:12px"><b>📈 Compras por mês (valor)</b><div style="height:220px;margin-top:8px"><canvas id="compd-mes"></canvas></div></div>
        <div class="tc" style="padding:12px"><b>🏷️ Compras por fornecedor (top 10, valor)</b><div style="height:220px;margin-top:8px"><canvas id="compd-fornecedor"></canvas></div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="tc" style="padding:12px">
          <b>🔥 Top 10 produtos mais comprados</b>
          <table class="dt-table" style="margin-top:8px"><thead><tr><th>Produto</th><th>Qtd</th><th>Valor</th></tr></thead><tbody>
          ${topProdutosValor.length ? topProdutosValor.map(p => `<tr><td>${esc(p.produto)}</td><td>${p.qtd.toLocaleString('pt-BR')}</td><td>${p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`).join('') : '<tr><td colspan="3">Sem dados ainda.</td></tr>'}
          </tbody></table>
        </div>
        <div class="tc" style="padding:12px">
          <b>💹 Preço: maiores altas × maiores quedas</b>
          <table class="dt-table" style="margin-top:8px"><thead><tr><th>Subiram</th><th>%</th><th>Caíram</th><th>%</th></tr></thead><tbody>
          ${Math.max(maisSubiram.length, maisCairam.length) ? Array.from({ length: Math.max(maisSubiram.length, maisCairam.length) }).map((_, i) => `<tr><td>${esc(maisSubiram[i]?.produto || '')}</td><td style="color:#D92020">${maisSubiram[i] ? maisSubiram[i].variacaoPct.toFixed(1) + '%' : ''}</td><td>${esc(maisCairam[i]?.produto || '')}</td><td style="color:var(--green-mid)">${maisCairam[i] ? maisCairam[i].variacaoPct.toFixed(1) + '%' : ''}</td></tr>`).join('') : '<tr><td colspan="4">Sem histórico de preço suficiente ainda.</td></tr>'}
          </tbody></table>
        </div>
      </div>`;

    _destruirGraficos();
    if (global.Chart) {
      const ctxMes = document.getElementById('compd-mes');
      if (ctxMes) {
        const meses = [...porMes.keys()].sort();
        charts.push(new global.Chart(ctxMes, { type: 'bar', data: { labels: meses, datasets: [{ label: 'Valor (R$)', data: meses.map(m => porMes.get(m)), backgroundColor: '#3b82f6' }] }, options: { responsive: true, maintainAspectRatio: false } }));
      }
      const ctxForn = document.getElementById('compd-fornecedor');
      if (ctxForn) {
        charts.push(new global.Chart(ctxForn, { type: 'bar', data: { labels: topFornecedores.map(f => f.fornecedor), datasets: [{ label: 'Valor (R$)', data: topFornecedores.map(f => f.valor), backgroundColor: '#f59e0b' }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false } }));
      }
    }
  }

  global.renderComprasDashboard = renderComprasDashboard;

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-compd-refresh]')) renderComprasDashboard();
  });
})(window);
