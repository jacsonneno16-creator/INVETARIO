// Setor Produção — Dashboard (fase 3f da unificação com o Sistema de
// Produção). PEDIDO AO VIVO (auditoria RELATORIO-COMPARACAO-PRODUCAO.md,
// item 3 da execução): a tela real ativa no original não é o esqueleto
// estático de index.html (4 cards + tabela) — é js/dashboard-enhanced.js
// (o único dos 3 arquivos "dashboard*" realmente carregado; js/dashboard.js
// e pages/dashboard.js são código morto, nunca referenciados em index.html)
// que SUBSTITUI panel-dashboard inteiro por um HTML bem mais rico:
// cabeçalho "Central de Comando" + indicador ao vivo, 4 KPIs com
// sparkline, gráfico de fluxo por máquina, donut de status, top produtos,
// métricas rápidas, grade de máquinas e barras + tabela recente no rodapé.
// Essa estrutura foi copiada literalmente aqui (textos, ordem, cores hex
// exatas do tema escuro, inclusive uma inconsistência real do original: a
// legenda da grade de máquinas diz "Com OP ativa"/verde mas o card em si
// nunca usa essa cor — reproduzido como está, não corrigido).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_REGISTROS = 'producao_registros';
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_APONTAMENTOS = 'producao_apontamentos';
  const COL_SETUP = 'producao_setup';
  const STATUS_INFO = {
    pendente: { label: 'Pendente', cor: 'b-orange' },
    em_andamento: { label: 'Em Andamento', cor: 'b-blue' },
    concluido: { label: 'Concluído', cor: 'b-green' },
  };
  // Cores hexa exatas do original (dashboard-enhanced.js: renderStatusChart/
  // renderFluxoChart — Pendente #b89030, Em Andamento #e07020, Concluído
  // #5ab848), não mais os tokens claros do resto do sistema.
  const COR_STATUS_HEX = { pendente: '#b89030', em_andamento: '#e07020', concluido: '#5ab848' };
  const COR_MUTED = '#6a9058';
  const COR_BORDER = 'rgba(34,48,30,0.5)';

  let _registros = [];
  let _maquinas = [];
  let _apontamentos = [];
  let _setups = [];
  let _carregado = false;
  let _dashModoFluxo = 'caixas'; // 'caixas' | 'ops'
  let _chartFluxoDash = null;
  let _chartStatusDash = null;
  let _chartTopProdDash = null;

  function fs() { return global.getDTFirestore(); }
  function _domingoDaSemana(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); r.setDate(r.getDate() - r.getDay()); return r; }
  function _isoData(d) { return d.toISOString().slice(0, 10); }

  async function carregarProducaoDashboard(forcar) {
    if (_carregado && !forcar) return;
    const [snapReg, snapMaq, snapApon, snapSetup] = await Promise.all([
      fs().collection(COL_REGISTROS).get(),
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_APONTAMENTOS).get(),
      fs().collection(COL_SETUP).get(),
    ]);
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _apontamentos = snapApon.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _setups = snapSetup.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  async function renderProducaoDashboard() {
    const pagina = document.getElementById('page-producao-dashboard');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoDashboard(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoDashboard();
  }

  function _desenharProducaoDashboard() {
    const pagina = document.getElementById('page-producao-dashboard');
    if (!pagina) return;

    const total = _registros.length;
    const pend = _registros.filter(r => r.status === 'pendente' || !r.status).length;
    const and = _registros.filter(r => r.status === 'em_andamento').length;
    const ok = _registros.filter(r => r.status === 'concluido').length;
    const totalCx = _registros.reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
    const pendCx = _registros.filter(r => r.status === 'pendente' || !r.status).reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
    const andCx = _registros.filter(r => r.status === 'em_andamento').reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
    const okCx = _registros.filter(r => r.status === 'concluido').reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);

    const recentes = [..._registros]
      .sort((a, b) => (b.atualizadoEm || b.criadoEm || '').localeCompare(a.atualizadoEm || a.criadoEm || ''))
      .slice(0, 8);

    // PEDIDO AO VIVO (auditoria, item 3): estrutura, textos e ordem
    // copiados literalmente de buildDashHTML() em dashboard-enhanced.js —
    // header "Central de Comando" com indicador ao vivo, 4 KPIs+sparkline,
    // fluxo por máquina + donut de status, top produtos + métricas
    // rápidas, grade de máquinas, e barras + tabela recente no rodapé
    // (nessa ordem exata — não mais uma tabela/ocupação extra no topo).
    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:10px">
        <div>
          <h1 style="font-size:1.4rem;font-weight:700;color:var(--text);letter-spacing:-.4px;line-height:1;margin:0">Central de Comando</h1>
          <p style="font-size:.75rem;color:var(--muted);margin-top:4px">Visão consolidada da produção</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:.68rem;color:var(--muted)">
            <div style="width:6px;height:6px;border-radius:50%;background:var(--success);box-shadow:0 0 8px var(--success)"></div>
            <span id="pdash-ultima-att">Atualizando…</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-pdash-atualizar>↺ Atualizar</button>
        </div>
      </div>

      <div class="dash-row" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
        <div class="dc dc-cyan"><div class="dc-lbl">📋 Total de OPs</div><div class="dc-num" id="pdash-kpi-total">${total.toLocaleString('pt-BR')}</div><div class="dash-kpi-sub" id="pdash-kpi-total-sub">caixas programadas</div><canvas id="pdash-spark-total" height="32" style="margin-top:8px;opacity:.6"></canvas></div>
        <div class="dc dc-orange"><div class="dc-lbl">⏳ Pendentes</div><div class="dc-num" id="pdash-kpi-pend">${pend.toLocaleString('pt-BR')}</div><div class="dash-kpi-sub" id="pdash-kpi-pend-sub">aguardando início</div><canvas id="pdash-spark-pend" height="32" style="margin-top:8px;opacity:.6"></canvas></div>
        <div class="dc dc-purple"><div class="dc-lbl">⚙️ Em Andamento</div><div class="dc-num" id="pdash-kpi-and">${and.toLocaleString('pt-BR')}</div><div class="dash-kpi-sub" id="pdash-kpi-and-sub">em produção agora</div><canvas id="pdash-spark-and" height="32" style="margin-top:8px;opacity:.6"></canvas></div>
        <div class="dc dc-green"><div class="dc-lbl">✅ Concluídos</div><div class="dc-num" id="pdash-kpi-ok">${ok.toLocaleString('pt-BR')}</div><div class="dash-kpi-sub" id="pdash-kpi-ok-sub">finalizados</div><canvas id="pdash-spark-ok" height="32" style="margin-top:8px;opacity:.6"></canvas></div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px" class="pdash-grid">
        <div class="dc" style="padding:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div style="font-weight:700;font-size:.85rem">Programação por Máquina</div>
            <div style="display:flex;gap:4px">
              <button type="button" class="btn ${_dashModoFluxo === 'caixas' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pdash-fluxo-modo="caixas">Caixas</button>
              <button type="button" class="btn ${_dashModoFluxo === 'ops' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pdash-fluxo-modo="ops">OPs</button>
            </div>
          </div>
          <div style="height:220px;position:relative"><canvas id="pdash-chart-fluxo"></canvas></div>
        </div>
        <div class="dc" style="padding:20px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:12px">Status das OPs</div>
          <div style="height:160px;position:relative;display:flex;align-items:center;justify-content:center">
            <canvas id="pdash-chart-status"></canvas>
            <div style="position:absolute;text-align:center;pointer-events:none">
              <div style="font-size:1.3rem;font-weight:700;color:var(--text)" id="pdash-donut-pct">${total > 0 ? Math.round(ok / total * 100) : 0}%</div>
              <div style="font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">concluído</div>
            </div>
          </div>
          <div id="pdash-status-legend" style="display:flex;flex-direction:column;gap:5px;margin-top:10px"></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:3fr 2fr;gap:16px;margin-bottom:16px" class="pdash-grid">
        <div class="dc" style="padding:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-weight:700;font-size:.85rem">Top Produtos Programados</div>
            <div style="font-size:.65rem;color:var(--muted)">por caixas</div>
          </div>
          <div style="height:180px;position:relative"><canvas id="pdash-chart-top-prod"></canvas></div>
        </div>
        <div class="dc" style="padding:20px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">Métricas Rápidas</div>
          <div id="pdash-metricas-wrap" style="display:flex;flex-direction:column;gap:9px"></div>
        </div>
      </div>

      <div class="dc" style="padding:20px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div style="font-weight:700;font-size:.85rem">Status por Máquina</div>
          <div style="display:flex;gap:10px;font-size:.65rem">
            <span style="display:flex;align-items:center;gap:4px;color:var(--success)"><span style="width:7px;height:7px;border-radius:50%;background:var(--success);display:inline-block"></span>Com OP ativa</span>
            <span style="display:flex;align-items:center;gap:4px;color:var(--warn)"><span style="width:7px;height:7px;border-radius:50%;background:var(--warn);display:inline-block"></span>Pendente</span>
            <span style="display:flex;align-items:center;gap:4px;color:var(--muted)"><span style="width:7px;height:7px;border-radius:50%;background:var(--muted);display:inline-block"></span>Livre</span>
          </div>
        </div>
        <div id="pdash-maquinas-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="pdash-grid">
        <div class="dc" style="padding:20px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:4px">Caixas por Máquina</div>
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:12px">programado vs. concluído</div>
          <div id="pdash-maq-bars-wrap" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto"></div>
        </div>
        <div class="dc" style="padding:20px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:12px">Últimas Solicitações</div>
          <div id="pdash-recent" style="overflow-x:auto">
            ${recentes.length ? '' : '<div style="text-align:center;padding:22px;color:var(--muted);font-size:.72rem">📋 Nenhuma solicitação ainda</div>'}
          </div>
        </div>
      </div>
    `;

    _desenharTabelaRecenteDash(recentes);
    _desenharGraficosDashboardExtra(total, pend, and, ok, totalCx, pendCx, andCx, okCx);
  }
  function _desenharTabelaRecenteDash(recentes) {
    const el = document.getElementById('pdash-recent');
    if (!el || !recentes.length) return;
    const statusCor = { pendente: 'var(--warn)', em_andamento: 'var(--orange)', concluido: 'var(--success)' };
    const statusBg = { pendente: 'rgba(184,144,48,.12)', em_andamento: 'rgba(224,112,32,.12)', concluido: 'rgba(90,184,72,.12)' };
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.72rem">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="padding:6px 8px;text-align:left;font-size:.58rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600">Produto</th>
        <th style="padding:6px 8px;text-align:left;font-size:.58rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600">Máq.</th>
        <th style="padding:6px 8px;text-align:right;font-size:.58rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600">Cxs</th>
        <th style="padding:6px 8px;text-align:center;font-size:.58rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600">Status</th>
      </tr></thead>
      <tbody>${recentes.map((r, i) => {
        const st = STATUS_INFO[r.status] || STATUS_INFO.pendente, key = statusCor[r.status] ? r.status : 'pendente';
        return `<tr style="border-bottom:1px solid var(--border)${i % 2 ? ';background:rgba(255,255,255,.01)' : ''}">
          <td style="padding:7px 8px;color:var(--text);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.produto)}">${esc(r.produto) || '—'}</td>
          <td style="padding:7px 8px;font-size:.66rem;color:var(--orange)">${esc(r.maquina) || '—'}</td>
          <td style="padding:7px 8px;text-align:right;color:var(--muted)">${(Number(r.qntCaixas) || 0).toLocaleString('pt-BR')}</td>
          <td style="padding:7px 8px;text-align:center"><span style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:.6rem;font-weight:700;color:${statusCor[key]};background:${statusBg[key]}">${esc(st.label)}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  // ── Sparkline decorativa (tendência simulada terminando no valor real —
  // a original também não tinha histórico real aqui, só uma curva visual
  // crescente até o número atual) ──────────────────────────────────────
  function _sparkDataDash(val, n) {
    const arr = [];
    for (let i = 0; i < n - 1; i++) arr.push(Math.round(val * (0.4 + 0.5 * i / (n - 2)) * (0.85 + Math.random() * 0.3)));
    arr.push(val);
    return arr;
  }
  function _desenharSparklineDash(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.getContext) return;
    const W = canvas.parentElement ? canvas.parentElement.clientWidth || 140 : 140;
    const H = 28;
    canvas.width = W; canvas.height = H;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return; // jsdom sem o pacote `canvas` não implementa 2D — navegador real sempre tem
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(...data, 1);
    const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * W, y: H - (v / max) * (H - 4) - 2 }));
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }

  function _animNumDash(el, target) {
    if (!el) return;
    const start = parseInt(String(el.textContent).replace(/\D/g, '')) || 0;
    const t0 = (global.performance || Date).now();
    function tick(now) {
      const p = Math.min((now - t0) / 700, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (target - start) * ease).toLocaleString('pt-BR');
      if (p < 1) (global.requestAnimationFrame || (f => setTimeout(f, 16)))(tick);
    }
    (global.requestAnimationFrame || (f => setTimeout(f, 16)))(tick);
  }

  function _destruirChartDash(inst) { try { if (inst) inst.destroy(); } catch (e) {} return null; }

  function _opcoesChartDash(yLabel) {
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: COR_BORDER }, ticks: { color: COR_MUTED, font: { size: 10 } }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: COR_MUTED, font: { size: 10 } }, border: { display: false } },
      },
    };
  }

  function _desenharGraficoFluxoDash() {
    const canvas = document.getElementById('pdash-chart-fluxo');
    if (!canvas || typeof global.Chart !== 'function') return;
    _chartFluxoDash = _destruirChartDash(_chartFluxoDash);
    const maqs = [...new Set(_registros.map(r => r.maquina).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!maqs.length) { canvas.parentElement.innerHTML = '<div style="height:220px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.75rem">Nenhuma OP cadastrada</div>'; return; }
    const statusList = ['pendente', 'em_andamento', 'concluido'];
    const datasets = statusList.map(st => ({
      label: STATUS_INFO[st].label,
      data: maqs.map(m => _registros.filter(r => r.maquina === m && (r.status === st || (st === 'pendente' && !r.status)))
        .reduce((s, r) => s + (_dashModoFluxo === 'caixas' ? (Number(r.qntCaixas) || 0) : 1), 0)),
      backgroundColor: COR_STATUS_HEX[st] + 'cc',
      borderColor: COR_STATUS_HEX[st], borderWidth: 1, borderRadius: 4,
    }));
    const opts = _opcoesChartDash();
    opts.plugins.legend = { display: true, position: 'bottom', labels: { color: COR_MUTED, font: { size: 10 }, boxWidth: 10, padding: 10 } };
    opts.scales.x.stacked = true; opts.scales.y.stacked = true;
    _chartFluxoDash = new global.Chart(canvas.getContext('2d'), { type: 'bar', data: { labels: maqs, datasets }, options: opts });
  }

  function _desenharGraficoStatusDash(total, pend, and, ok) {
    const canvas = document.getElementById('pdash-chart-status');
    if (!canvas || typeof global.Chart !== 'function') return;
    _chartStatusDash = _destruirChartDash(_chartStatusDash);
    const labels = ['Pendente', 'Em andamento', 'Concluído'];
    const data = [pend, and, ok];
    const cores = [COR_STATUS_HEX.pendente, COR_STATUS_HEX.em_andamento, COR_STATUS_HEX.concluido];
    _chartStatusDash = new global.Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data: total ? data : [1], backgroundColor: total ? cores.map(c => c + 'cc') : ['#DDE3EC'], borderColor: total ? cores : ['#DDE3EC'], borderWidth: total ? 2 : 1, hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => total ? ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed / total * 100)}%)` : '' } } } },
    });
    const leg = document.getElementById('pdash-status-legend');
    if (leg) leg.innerHTML = labels.map((l, i) => `<div style="display:flex;align-items:center;justify-content:space-between;font-size:.68rem">
      <span style="display:flex;align-items:center;gap:5px;color:var(--muted)"><span style="width:8px;height:8px;border-radius:50%;background:${cores[i]};display:inline-block"></span>${l}</span>
      <span style="font-family:monospace;font-weight:700;color:${cores[i]}">${data[i]}</span>
    </div>`).join('');
  }

  function _desenharGraficoTopProdutosDash() {
    const canvas = document.getElementById('pdash-chart-top-prod');
    if (!canvas || typeof global.Chart !== 'function') return;
    _chartTopProdDash = _destruirChartDash(_chartTopProdDash);
    if (!_registros.length) { canvas.parentElement.innerHTML = '<div style="height:180px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.75rem">Sem dados</div>'; return; }
    const mapa = {};
    _registros.forEach(r => {
      const produto = String(r.produto || '').trim();
      if (!produto) return;
      const nome = produto.length > 28 ? produto.slice(0, 28) + '…' : produto;
      mapa[nome] = (mapa[nome] || 0) + (Number(r.qntCaixas) || 0);
    });
    const sorted = Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const paleta = sorted.map((_, i) => `hsl(${25 + i * 22}, 70%, 55%)`);
    const paletaFill = paleta.map(p => p.replace('hsl', 'hsla').replace(')', ', 0.8)'));
    _chartTopProdDash = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: sorted.map(x => x[0]), datasets: [{ label: 'Caixas', data: sorted.map(x => x[1]), backgroundColor: paletaFill, borderColor: paleta, borderWidth: 1, borderRadius: 4 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + ctx.parsed.x.toLocaleString('pt-BR') + ' caixas' } } },
        scales: { x: { grid: { color: COR_BORDER }, ticks: { color: COR_MUTED, font: { size: 9 } }, border: { display: false } }, y: { grid: { display: false }, ticks: { color: COR_MUTED, font: { size: 10 } }, border: { display: false } } },
      },
    });
  }

  function _desenharMetricasRapidasDash(total, ok, and, totalCx, okCx) {
    const wrap = document.getElementById('pdash-metricas-wrap');
    if (!wrap) return;
    const maqsAtivas = [...new Set(_registros.map(r => r.maquina).filter(Boolean))].length;
    const pctConc = total > 0 ? Math.round(ok / total * 100) : 0;
    const pctCx = totalCx > 0 ? Math.round(okCx / totalCx * 100) : 0;
    // PEDIDO AO VIVO (auditoria, item 3): valores/cores/rótulos exatos de
    // renderEficienciaGauge() no original — inclusive a barra "Máquinas
    // ativas" (maqs*10, só escondida com 0 máquinas) e "Total de caixas"
    // sem barra nenhuma (não é maqsAtivas/totalCx que ficam sem barra, é
    // literalmente assim no original).
    const metricas = [
      { label: 'Conclusão (OPs)', val: pctConc + '%', bar: pctConc, cor: '#5ab848' },
      { label: 'Conclusão (Caixas)', val: pctCx + '%', bar: pctCx, cor: '#e07020' },
      { label: 'Máquinas ativas', val: maqsAtivas + ' máq.', bar: maqsAtivas === 0 ? null : maqsAtivas * 10, cor: '#b89030' },
      { label: 'Total de caixas', val: totalCx.toLocaleString('pt-BR'), bar: null, cor: '#5090c0' },
      { label: 'Em andamento', val: and + ' OPs', bar: total > 0 ? Math.round(and / total * 100) : 0, cor: '#e07020' },
    ];
    wrap.innerHTML = metricas.map(m => `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <span style="font-size:.72rem;color:var(--muted)">${esc(m.label)}</span>
          <span style="font-size:.74rem;font-weight:700;color:${m.cor};font-family:monospace">${esc(m.val)}</span>
        </div>
        ${m.bar != null ? `<div style="height:4px;background:var(--surface-2);border-radius:2px;overflow:hidden"><div style="height:100%;width:${Math.min(m.bar, 100)}%;background:${m.cor};border-radius:2px"></div></div>` : ''}
      </div>`).join('');
  }

  function _desenharGradeMaquinasDash() {
    const grid = document.getElementById('pdash-maquinas-grid');
    if (!grid) return;
    const maqs = [...new Set(_registros.map(r => r.maquina).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!maqs.length) { grid.innerHTML = '<div style="color:var(--muted);font-size:.72rem;padding:10px">Nenhuma máquina com OP cadastrada.</div>'; return; }
    grid.innerHTML = maqs.map(m => {
      const mRegs = _registros.filter(r => r.maquina === m);
      const andReg = mRegs.find(r => r.status === 'em_andamento');
      const pendRegs = mRegs.filter(r => r.status === 'pendente' || !r.status);
      const totalCxM = mRegs.reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
      const okCxM = mRegs.filter(r => r.status === 'concluido').reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
      const pct = totalCxM > 0 ? Math.round(okCxM / totalCxM * 100) : 0;
      let cor = 'var(--muted)', label = 'Livre';
      if (andReg) { cor = 'var(--orange)'; label = 'Em produção'; }
      else if (pendRegs.length) { cor = 'var(--warn)'; label = pendRegs.length + ' pend.'; }
      const curProduto = andReg ? String(andReg.produto || '').slice(0, 22) : '—';
      return `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${cor}"></div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="width:7px;height:7px;border-radius:50%;background:${cor};display:inline-block"></span>
          <span style="font-size:.74rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m)}</span>
        </div>
        <div style="font-size:.62rem;color:${cor};font-weight:600;margin-bottom:5px">${esc(label)}</div>
        <div style="font-size:.62rem;color:var(--muted);margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(andReg ? andReg.produto : '')}">${esc(curProduto)}</div>
        <div style="display:flex;justify-content:space-between;font-size:.6rem;color:var(--muted);margin-bottom:3px">
          <span>${okCxM.toLocaleString('pt-BR')} / ${totalCxM.toLocaleString('pt-BR')} cx</span><span style="font-weight:700;color:${pct >= 80 ? 'var(--success)' : 'var(--muted)'}">${pct}%</span>
        </div>
        <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${pct >= 80 ? 'var(--success)' : 'var(--orange)'};border-radius:2px"></div></div>
      </div>`;
    }).join('');
  }

  function _desenharBarrasCaixasMaquinaDash() {
    const wrap = document.getElementById('pdash-maq-bars-wrap');
    if (!wrap) return;
    const maqs = [...new Set(_registros.map(r => r.maquina).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!maqs.length) { wrap.innerHTML = '<div style="color:var(--muted);font-size:.72rem;padding:10px">Sem dados</div>'; return; }
    const maxCx = Math.max(...maqs.map(m => _registros.filter(r => r.maquina === m).reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0)), 1);
    wrap.innerHTML = maqs.map(m => {
      const mRegs = _registros.filter(r => r.maquina === m);
      const totalM = mRegs.reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
      const okM = mRegs.filter(r => r.status === 'concluido').reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
      const pctBar = totalM / maxCx * 100;
      const pctOk = totalM > 0 ? okM / totalM * 100 : 0;
      return `<div title="${esc(m)}: ${okM.toLocaleString('pt-BR')} / ${totalM.toLocaleString('pt-BR')} caixas concluídas">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:.68rem;color:var(--muted);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m)}</span>
          <span style="font-size:.62rem;font-family:monospace;color:var(--muted)">${totalM.toLocaleString('pt-BR')} cx</span>
        </div>
        <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden;position:relative">
          <div style="position:absolute;top:0;left:0;height:100%;width:${pctBar}%;background:rgba(224,112,32,.25);border-radius:4px"></div>
          <div style="position:absolute;top:0;left:0;height:100%;width:${pctOk * pctBar / 100}%;background:var(--success);border-radius:4px"></div>
        </div>
      </div>`;
    }).join('');
  }

  function _desenharGraficosDashboardExtra(total, pend, and, ok, totalCx, pendCx, andCx, okCx) {
    _animNumDash(document.getElementById('pdash-kpi-total'), total);
    _animNumDash(document.getElementById('pdash-kpi-pend'), pend);
    _animNumDash(document.getElementById('pdash-kpi-and'), and);
    _animNumDash(document.getElementById('pdash-kpi-ok'), ok);
    // PEDIDO AO VIVO (auditoria, item 3): cores exatas de renderKPIs() no
    // original — cada sparkline tem sua própria cor fixa, não reaproveita
    // as cores de status (repare que "pend" usa vermelho/#cc2800, não a
    // cor de status "pendente"; é assim no original).
    _desenharSparklineDash('pdash-spark-total', _sparkDataDash(total, 8), '#e07020');
    _desenharSparklineDash('pdash-spark-pend', _sparkDataDash(pend, 8), '#cc2800');
    _desenharSparklineDash('pdash-spark-and', _sparkDataDash(and, 8), '#b89030');
    _desenharSparklineDash('pdash-spark-ok', _sparkDataDash(ok, 8), '#5ab848');
    _desenharGraficoFluxoDash();
    _desenharGraficoStatusDash(total, pend, and, ok);
    _desenharGraficoTopProdutosDash();
    _desenharMetricasRapidasDash(total, ok, and, totalCx, okCx);
    _desenharGradeMaquinasDash();
    _desenharBarrasCaixasMaquinaDash();
    const ts = document.getElementById('pdash-ultima-att');
    if (ts) ts.textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  document.addEventListener('click', function (event) {
    const modo = event.target.closest('[data-pdash-fluxo-modo]');
    if (modo) { _dashModoFluxo = modo.getAttribute('data-pdash-fluxo-modo'); _desenharProducaoDashboard(); }
    if (event.target.closest('[data-pdash-atualizar]')) { carregarProducaoDashboard(true).then(_desenharProducaoDashboard); }
  });

  global.renderProducaoDashboard = renderProducaoDashboard;
  global._desenharProducaoDashboard = _desenharProducaoDashboard;
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _registros=[]; _apontamentos=[]; _maquinas=[]; _setups=[]; });
})(window);
