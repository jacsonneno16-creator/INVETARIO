// PCP — Fase 8: Linha do Tempo (planejamento futuro +7/+15/+30/+45/+60/+90
// dias). Construída SOBRE o resultado de construirVisao() (mesmo motor
// único de cálculo) — só abre o passo-a-passo dia a dia que já existe de
// forma resumida em `eventos[]`/`rupturaEm`, sem recalcular estoque/consumo
// por conta própria.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MARCOS = [7, 15, 30, 45, 60, 90];
  const ESTADO_INFO = {
    ruptura: { label: 'Ruptura', cor: 'b-red' },
    critico: { label: 'Crítico', cor: 'b-red' },
    abaixo_minimo: { label: 'Abaixo do mín.', cor: 'b-orange' },
    ok: { label: 'OK', cor: 'b-yellow' },
    ideal: { label: 'Ideal', cor: 'b-green' },
  };

  let _busca = '';

  function _estadoNoDia(saldo, item) {
    if (saldo <= 0) return 'ruptura';
    if (item.consumoDia > 0 && saldo / item.consumoDia <= 3) return 'critico';
    if (item.estoqueMinimo > 0 && saldo < item.estoqueMinimo) return 'abaixo_minimo';
    if (item.estoqueAlvo > 0 && saldo >= item.estoqueAlvo) return 'ideal';
    return 'ok';
  }

  // Caminha dia a dia a partir do estoque atual, descontando o consumo
  // diário estimado (linear) e aplicando os eventos discretos (pedidos,
  // produção, entradas) exatamente nas datas em que `construirVisao()` já
  // os posicionou. Retorna só os marcos pedidos, não os 90 dias inteiros.
  function construirLinhaDoTempo(item, horizonteDias) {
    horizonteDias = horizonteDias || 90;
    const marcos = MARCOS.filter(d => d <= horizonteDias);
    const eventosPorData = new Map();
    (item.eventos || []).forEach(ev => {
      if (!ev.data) return;
      const arr = eventosPorData.get(ev.data) || [];
      arr.push(ev);
      eventosPorData.set(ev.data, arr);
    });
    const hojeD = new Date(); hojeD.setHours(0, 0, 0, 0);
    let saldo = item.estoqueAtual;
    const resultado = [];
    for (let d = 0; d <= horizonteDias; d++) {
      const data = new Date(hojeD); data.setDate(data.getDate() + d);
      const iso = data.toISOString().slice(0, 10);
      if (d > 0) saldo -= item.consumoDia;
      (eventosPorData.get(iso) || []).forEach(ev => { saldo += ev.delta; });
      if (marcos.includes(d)) {
        resultado.push({
          dia: d, data: iso, saldoProjetado: saldo,
          coberturaDias: item.consumoDia > 0 ? Math.max(0, saldo) / item.consumoDia : null,
          estado: _estadoNoDia(saldo, item),
        });
      }
    }
    return resultado;
  }

  async function renderPCPTimeline() {
    const pagina = document.getElementById('page-pcp-timeline');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando linha do tempo...</div></div>';
    try {
      await global._pcpInternals.carregar();
      _desenhar();
    } catch (e) {
      pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>';
    }
  }

  function _desenhar() {
    const pagina = document.getElementById('page-pcp-timeline');
    if (!pagina) return;
    const busca = _busca.trim().toLowerCase();
    const visao = global._pcpInternals.construirVisao()
      .filter(x => x.consumoDia > 0 || x.estoqueAtual > 0)
      .filter(x => !busca || String(x.produto || '').toLowerCase().includes(busca));
    const linhas = visao.map(item => ({ item, marcos: construirLinhaDoTempo(item, 90) }));
    // Ordena pelos que ficam críticos/rompem mais cedo primeiro.
    linhas.sort((a, b) => {
      const pa = a.marcos.findIndex(m => m.estado === 'ruptura' || m.estado === 'critico');
      const pb = b.marcos.findIndex(m => m.estado === 'ruptura' || m.estado === 'critico');
      const da = pa === -1 ? 999 : pa, db = pb === -1 ? 999 : pb;
      return da - db;
    });

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">🗓️ Linha do Tempo — Planejamento Futuro</div><div style="font-size:.74rem;color:var(--muted)">Projeção de estoque em +7/+15/+30/+45/+60/+90 dias, considerando consumo diário e eventos já programados</div></div>
        <input id="pcptl-busca" class="field" placeholder="Buscar produto..." value="${esc(_busca)}" style="min-width:220px">
      </div>
      <div class="tc"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Produto</th><th>Hoje</th>${MARCOS.map(d => `<th>+${d}d</th>`).join('')}</tr></thead>
        <tbody>
        ${linhas.length ? linhas.map(({ item, marcos }) => `
          <tr>
            <td><b>${esc(item.produto)}</b></td>
            <td>${item.estoqueAtual.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
            ${marcos.map(m => {
              const info = ESTADO_INFO[m.estado] || ESTADO_INFO.ok;
              return `<td style="cursor:pointer" title="${esc(m.data)} — ${info.label}" data-pcptl-memoria="${esc(item.key)}"><span class="badge ${info.cor}">${m.saldoProjetado.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span></td>`;
            }).join('')}
          </tr>`).join('') : `<tr><td colspan="8"><div class="empty"><div class="empty-title">Nenhum produto com consumo/estoque para projetar</div></div></td></tr>`}
        </tbody>
      </table></div></div>`;
  }

  global.pcpRegistrarPagina?.('timeline', { elId: 'page-pcp-timeline', render: 'renderPCPTimeline', titulo: 'Linha do Tempo' });
  global.renderPCPTimeline = renderPCPTimeline;
  global._pcpTimelineInternals = { construirLinhaDoTempo };

  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pcptl-busca') { _busca = event.target.value; _desenhar(); }
  });
  document.addEventListener('click', function (event) {
    const cel = event.target.closest('[data-pcptl-memoria]');
    if (cel) { global.modalMemoria?.(cel.getAttribute('data-pcptl-memoria')); }
  });
})(window);
