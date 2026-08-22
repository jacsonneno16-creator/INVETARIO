// PCP — Fase 9: Produto 360°. Página de drill-down (sem item fixo na
// sidebar — aberta a partir de qualquer tabela do PCP), 100% derivada de
// dados já carregados: construirVisao(), memoriaDeCalculo(), a linha do
// tempo (83) e as requisições de compra já existentes (78). Não busca nada
// que essas telas não busquem, só reorganiza por produto.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const charts = [];

  let _produtoKey = '';

  function _destruirGraficos() { while (charts.length) charts.pop().destroy(); }

  async function abrirProduto360(key) {
    _produtoKey = key;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('on'));
    const pageEl = document.getElementById('page-pcp-produto-360'); if (pageEl) pageEl.classList.add('on');
    const tituloEl = document.getElementById('page-title'); if (tituloEl) tituloEl.textContent = 'PCP · Produto 360°';
    await renderPCPProduto360();
  }

  async function renderPCPProduto360() {
    const pagina = document.getElementById('page-pcp-produto-360');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await global._pcpInternals.carregar(); _desenhar(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; }
  }

  function _desenhar() {
    const pagina = document.getElementById('page-pcp-produto-360');
    if (!pagina) return;
    const internos = global._pcpInternals;
    const visao = internos.construirVisao();
    const item = visao.find(x => x.key === _produtoKey);
    if (!item) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Produto não encontrado</div><div class="empty-sub">Volte e selecione um produto em qualquer tabela do PCP.</div></div>'; return; }
    const produtoCad = (internos.getProdutos?.() || []).find(p => internos.keyOf(p) === _produtoKey) || {};
    const projecaoRec = (internos.getProjecao?.() || []).find(p => internos.keyOf(p) === _produtoKey) || {};
    const historico = (internos.getReqs?.() || [])
      .filter(r => internos.keyOf(r) === _produtoKey && n(r.quantidadeComprada) > 0)
      .sort((a, b) => String(b.compradoEm || '').localeCompare(String(a.compradoEm || '')));
    const precos = historico.map(h => n(h.precoUnitario)).filter(p => p > 0);
    const precoUltimo = precos[0] ?? null;
    const precoMedio = precos.length ? precos.reduce((s, p) => s + p, 0) / precos.length : null;
    const precoMaior = precos.length ? Math.max(...precos) : null;
    const precoMenor = precos.length ? Math.min(...precos) : null;
    const passos = internos.memoriaDeCalculo(item);
    const marcos = global._pcpTimelineInternals?.construirLinhaDoTempo?.(item, 90) || [];
    const proximaCompraSugerida = item.necessidade > 0 ? Math.ceil(item.necessidade / Math.max(1, n(produtoCad.multiploCompra) || 1)) * Math.max(1, n(produtoCad.multiploCompra) || 1) : 0;
    const marcoIdeal = marcos.find(m => m.estado === 'abaixo_minimo' || m.estado === 'critico' || m.estado === 'ruptura');

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.2rem">🔎 ${esc(item.produto)}</div><div style="font-size:.74rem;color:var(--muted)">Cód. ${esc(item.cod || '—')} · ${esc(produtoCad.categoria || 'Sem categoria')}</div></div>
        <button type="button" class="acao-lapis" title="Memória de cálculo completa" data-pcp-memoria="${esc(item.key)}">🧮 Memória de cálculo</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
        <div class="tc" style="padding:12px">
          <b>📦 Estoque</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Estoque atual</td><td style="text-align:right">${item.estoqueAtual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>
            <tr><td>Disponível</td><td style="text-align:right">${item.estoqueDisponivel.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>
            <tr><td>Comprometido</td><td style="text-align:right">${item.estoqueComprometido.toLocaleString('pt-BR')}</td></tr>
            <tr><td>Em trânsito (entradas previstas)</td><td style="text-align:right">${item.entradasPrevistas.toLocaleString('pt-BR')}</td></tr>
            <tr><td>Projetado (saldo)</td><td style="text-align:right"><b>${item.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</b></td></tr>
            <tr><td>Cobertura atual</td><td style="text-align:right">${item.coberturaDias == null ? '—' : item.coberturaDias.toFixed(1) + 'd'}</td></tr>
            <tr><td>Cobertura desejada</td><td style="text-align:right">${item.diasAlvo}d</td></tr>
            <tr><td>Mínimo / Máximo / Segurança</td><td style="text-align:right">${esc(produtoCad.estoqueMinimo ?? '—')} / ${esc(produtoCad.estoqueMaximo ?? '—')} / ${esc(produtoCad.estoqueSeguranca ?? '—')}</td></tr>
          </tbody></table>
        </div>
        <div class="tc" style="padding:12px">
          <b>📈 Consumo</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Consumo diário estimado</td><td style="text-align:right">${item.consumoDia.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>Consumo semanal</td><td style="text-align:right">${(item.consumoDia * 7).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>
            <tr><td>Venda mês 1 / 2 / 3</td><td style="text-align:right">${n(projecaoRec.venda_m1).toLocaleString('pt-BR')} / ${n(projecaoRec.venda_m2).toLocaleString('pt-BR')} / ${n(projecaoRec.venda_m3).toLocaleString('pt-BR')}</td></tr>
            <tr><td>Tendência (m1→m3)</td><td style="text-align:right">${n(projecaoRec.venda_m1) > 0 ? (((n(projecaoRec.venda_m3) - n(projecaoRec.venda_m1)) / n(projecaoRec.venda_m1) * 100).toFixed(1) + '%') : '—'}</td></tr>
          </tbody></table>
        </div>
        <div class="tc" style="padding:12px">
          <b>🛒 Compras</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Compras registradas</td><td style="text-align:right">${historico.length}</td></tr>
            <tr><td>Quantidade total comprada</td><td style="text-align:right">${historico.reduce((s, h) => s + n(h.quantidadeComprada), 0).toLocaleString('pt-BR')}</td></tr>
            <tr><td>Último preço</td><td style="text-align:right">${precoUltimo == null ? '—' : precoUltimo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>
            <tr><td>Preço médio</td><td style="text-align:right">${precoMedio == null ? '—' : precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>
            <tr><td>Maior / Menor preço</td><td style="text-align:right">${precoMaior == null ? '—' : precoMaior.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} / ${precoMenor == null ? '—' : precoMenor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>
            <tr><td>Fornecedor preferencial</td><td style="text-align:right">${esc(produtoCad.fornecedorPadrao || '—')}</td></tr>
          </tbody></table>
        </div>
        <div class="tc" style="padding:12px">
          <b>🗓️ Planejamento</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Necessidade atual</td><td style="text-align:right">${item.necessidade.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td></tr>
            <tr><td>Próxima compra sugerida</td><td style="text-align:right"><b>${proximaCompraSugerida.toLocaleString('pt-BR')}</b></td></tr>
            <tr><td>Data ideal da compra</td><td style="text-align:right">${marcoIdeal ? esc(marcoIdeal.data) : 'sem urgência nos próximos 90 dias'}</td></tr>
            <tr><td>Lead time</td><td style="text-align:right">${esc(produtoCad.leadTimeDias ?? '—')} dias</td></tr>
            <tr><td>Criticidade</td><td style="text-align:right">${esc(produtoCad.criticidade || 'baixa')}</td></tr>
          </tbody></table>
        </div>
      </div>
      <div class="tc" style="padding:12px;margin-top:14px">
        <b>💰 Evolução de preço</b>
        <div style="height:200px;margin-top:8px">${precos.length >= 2 ? '<canvas id="pcp360-precos"></canvas>' : '<div class="empty" style="padding:10px"><div class="empty-sub">Sem histórico de preço suficiente ainda para o gráfico.</div></div>'}</div>
      </div>
      <div class="tc" style="padding:12px;margin-top:14px">
        <b>Histórico de compras</b>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Data</th><th>Fornecedor</th><th>Qtd</th><th>Preço unit.</th><th>Valor total</th><th>Comprador</th></tr></thead><tbody>
        ${historico.length ? historico.map(h => `<tr><td>${esc(String(h.compradoEm || '').slice(0, 10))}</td><td>${esc(h.fornecedor || '')}</td><td>${n(h.quantidadeComprada).toLocaleString('pt-BR')}</td><td>${h.precoUnitario ? n(h.precoUnitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td><td>${h.valorTotal ? n(h.valorTotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td><td>${esc(h.compradorNome || h.compradorEmail || '')}</td></tr>`).join('') : '<tr><td colspan="6">Nenhuma compra registrada ainda.</td></tr>'}
        </tbody></table></div>
      </div>`;

    _destruirGraficos();
    if (global.Chart && precos.length >= 2) {
      const ctx = document.getElementById('pcp360-precos');
      if (ctx) {
        const ordenado = historico.slice().filter(h => n(h.precoUnitario) > 0).sort((a, b) => String(a.compradoEm || '').localeCompare(String(b.compradoEm || '')));
        charts.push(new global.Chart(ctx, {
          type: 'line',
          data: { labels: ordenado.map(h => String(h.compradoEm || '').slice(0, 10)), datasets: [{ label: 'Preço unitário (R$)', data: ordenado.map(h => n(h.precoUnitario)), borderColor: '#f59e0b' }] },
          options: { responsive: true, maintainAspectRatio: false },
        }));
      }
    }
  }

  global.pcpRegistrarPagina?.('produto-360', { elId: 'page-pcp-produto-360', render: 'renderPCPProduto360', titulo: 'Produto 360°' });
  global.abrirProduto360 = abrirProduto360;
  global.renderPCPProduto360 = renderPCPProduto360;

  document.addEventListener('click', function (event) {
    const el = event.target.closest('[data-pcp-360]');
    if (el) abrirProduto360(el.getAttribute('data-pcp-360'));
  });
})(window);
