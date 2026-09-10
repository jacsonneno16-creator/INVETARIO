// PCP — Cortes. PEDIDO AO VIVO (2026-08-28): "eu quero uma aba de cortes,
// que mostra os cortes de todos os produtos. Só puxe o total, não puxe
// tudo... vai somar o que aconteceu, vai colocar por mês. Aí quando eu
// clicar no mês vai mostrar tudo: a quantidade total de cada produto,
// valor, porcentagem faturada da porcentagem pedida (solicitada)" —
// dados_cortes.json (53 mil linhas) já vem agregado por mês+produto pelo
// servidor (functions/index.js, sincronizarCortesMensalBiAgendado), gravado
// em bi_cortes_mensal (1 doc por mês, GLOBAL — por isso getDTRawFirestore,
// não getDTFirestore). Esta tela só lê os documentos já prontos.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const money = v => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  let _meses = []; // [{mes, itens}], mais recente primeiro
  let _mesAtivo = '';
  let _carregado = false;

  async function _carregar(forcar) {
    if (_carregado && !forcar) return;
    if (typeof global.getDTRawFirestore !== 'function') { _meses = []; _carregado = true; return; }
    const snap = await global.getDTRawFirestore().collection('bi_cortes_mensal').get().catch(() => ({ docs: [] }));
    _meses = snap.docs.map(d => d.data()).sort((a, b) => String(b.mes || '').localeCompare(String(a.mes || '')));
    if (!_mesAtivo || !_meses.some(m => m.mes === _mesAtivo)) _mesAtivo = _meses[0]?.mes || '';
    _carregado = true;
  }

  function _itensMesAtivo() {
    return (_meses.find(m => m.mes === _mesAtivo) || {}).itens || [];
  }

  function _linha(item) {
    const atingimento = item.quantidadePedidaCx > 0 ? (item.quantidadeFaturadaCx / item.quantidadePedidaCx) * 100 : null;
    return `<tr><td><b>${esc(item.descricao || item.produtoKey)}</b><div style="font-size:.66rem;color:var(--muted)">${esc(item.produtoKey)}</div></td>` +
      `<td>${n(item.quantidadePedidaCx).toLocaleString('pt-BR')}</td>` +
      `<td>${n(item.quantidadeFaturadaCx).toLocaleString('pt-BR')}</td>` +
      `<td><span class="badge ${item.corteRoteiroCx > 0 ? 'b-red' : 'b-green'}">${n(item.corteRoteiroCx).toLocaleString('pt-BR')}</span></td>` +
      `<td>${money(item.valorPedidoTotal)}</td><td>${money(item.faturamentoRs)}</td>` +
      `<td>${atingimento == null ? '—' : atingimento.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'}</td></tr>`;
  }

  function _desenhar() {
    const p = document.getElementById('page-pcp-cortes');
    if (!p) return;
    const itens = _itensMesAtivo().slice().sort((a, b) => b.corteRoteiroCx - a.corteRoteiroCx);
    const totalPedida = itens.reduce((s, x) => s + n(x.quantidadePedidaCx), 0);
    const totalFaturada = itens.reduce((s, x) => s + n(x.quantidadeFaturadaCx), 0);
    const totalCorte = itens.reduce((s, x) => s + n(x.corteRoteiroCx), 0);
    const rotuloMes = m => { const [ano, mes] = String(m || '').split('-'); return mes && ano ? mes + '/' + ano : (m || '—'); };
    p.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">✂️ Cortes</div><div style="font-size:.74rem;color:var(--muted)">Corte do roteiro de produção contra o que foi pedido, por mês — resumo já compilado (sem linha crua).</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-pcpc-refresh>↻ Atualizar</button>
      </div>
      <div class="tc" style="padding:10px 12px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-size:.72rem;color:var(--muted)">MÊS</div>
        <select class="field" id="pcpc-mes-sel" style="max-width:180px">${_meses.map(m => `<option value="${esc(m.mes)}" ${m.mes === _mesAtivo ? 'selected' : ''}>${esc(rotuloMes(m.mes))}</option>`).join('') || '<option value="">Sem dados ainda</option>'}</select>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${totalPedida.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Total pedido (cx)</div></div>
        <div class="kpi teal"><div class="kpi-val">${totalFaturada.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Total faturado (cx)</div></div>
        <div class="kpi ${totalCorte > 0 ? 'red' : 'green'}"><div class="kpi-val">${totalCorte.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Total cortado (cx)</div></div>
        <div class="kpi orange"><div class="kpi-val">${itens.length}</div><div class="kpi-lbl">Produtos no mês</div></div>
      </div>
      <div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Pedida (cx)</th><th>Faturada (cx)</th><th>Corte (cx)</th><th>Valor Pedido</th><th>Faturamento</th><th>% Atingimento</th></tr></thead><tbody>${itens.length ? itens.map(_linha).join('') : `<tr><td colspan="7">${_meses.length ? 'Sem produtos neste mês.' : 'Nenhum dado sincronizado ainda.'}</td></tr>`}</tbody></table></div></div>`;
  }

  async function renderPCPCortes() {
    const p = document.getElementById('page-pcp-cortes');
    if (!p) return;
    p.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando cortes...</div></div>';
    try { await _carregar(); _desenhar(); }
    catch (e) { p.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; }
  }

  // PEDIDO AO VIVO (2026-08-28): "nos produtos também quando vão circular
  // no compras lá quando clicar naquele cálculo lá que eu tinha falado, ele
  // vai mostrar todo esse resumo" — o "Relatório do Produto" (antiga
  // Memória de Cálculo, 78-pcp-central.js) reaproveita o mesmo cache desta
  // tela, sem duplicar a leitura de bi_cortes_mensal.
  async function buscarHistoricoProduto(produtoKey) {
    await _carregar();
    const key = String(produtoKey || '');
    if (!key) return [];
    const resultado = [];
    _meses.forEach(m => { (m.itens || []).forEach(it => { if (String(it.produtoKey) === key) resultado.push(Object.assign({ mes: m.mes }, it)); }); });
    return resultado.sort((a, b) => String(b.mes).localeCompare(String(a.mes)));
  }

  global.pcpRegistrarPagina?.('cortes', { elId: 'page-pcp-cortes', render: 'renderPCPCortes', titulo: 'Cortes' });
  global.renderPCPCortes = renderPCPCortes;
  global._pcpCortesInternals = { _carregar, _itensMesAtivo, getMesAtivo: () => _mesAtivo, buscarHistoricoProduto };

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-pcpc-refresh]')) { _carregar(true).then(_desenhar); }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pcpc-mes-sel') { _mesAtivo = event.target.value; _desenhar(); }
  });
})(window);
