// Setor Produção — Dashboard (fase 3f da unificação com o Sistema de
// Produção). A original mostrava 4 cards (total/pendente/andamento/
// concluído) + tabela de últimas solicitações, e delegava o resto pro
// painel de Relatório (já coberto por 69-producao-relatorios.js, então não
// duplicado aqui). Esta versão soma: Programado vs Realizado da semana
// (usa o apontamento da fase 3f) e ocupação de máquinas na semana (reusa o
// motor de agenda da fase 3c) — dado que a original não tinha, porque não
// existia visão unificada de capacidade antes desta unificação.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_REGISTROS = 'producao_registros';
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_APONTAMENTOS = 'producao_apontamentos';
  const COL_SETUP = 'producao_setup';
  const STATUS_INFO = {
    pendente: { label: 'Pendente', cor: 'b-orange' },
    em_andamento: { label: 'Em andamento', cor: 'b-blue' },
    concluido: { label: 'Concluído', cor: 'b-green' },
  };
  // Cores hexa (Chart.js/canvas não lê classe .badge) — mesmos tokens da
  // paleta clara do sistema (analista.css), pra bater com o resto da tela.
  const COR_STATUS_HEX = { pendente: '#C97A06', em_andamento: '#E8751A', concluido: '#15803D' };
  const COR_MUTED = '#5A6B80';
  const COR_BORDER = '#DDE3EC';

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

    const weekStart = _domingoDaSemana(new Date());
    const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
    const datasSemana = dias.map(_isoData);

    const progSemana = _registros.filter(r => datasSemana.includes(r.data)).reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
    const realSemana = _apontamentos.filter(a => datasSemana.includes(a.data)).reduce((s, a) => s + (Number(a.qntCaixas) || 0), 0);
    const pctSemana = progSemana > 0 ? Math.min(100, Math.round((realSemana / progSemana) * 100)) : 0;

    // Ocupação de máquinas na semana — reusa o motor de agenda já usado
    // pelo Gantt/Insumos/Relatórios (fase 3c).
    let ocupacao = [];
    if (typeof global.buildProducaoSchedule === 'function') {
      const maquinasPorNome = {};
      _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
      const agenda = global.buildProducaoSchedule(weekStart, _registros, maquinasPorNome, _setups);
      ocupacao = _maquinas.map(m => {
        const info = agenda.porMaquina[m.nome];
        const usado = info ? info.totalMinutosUsados : 0;
        const capacidade = info ? info.capacidadeMinutosSemana : 0;
        const pct = capacidade > 0 ? Math.min(100, Math.round((usado / capacidade) * 100)) : 0;
        return { nome: m.nome, pct, capacidade };
      }).filter(m => m.capacidade > 0).sort((a, b) => b.pct - a.pct);
    }

    const recentes = [..._registros]
      .sort((a, b) => (b.atualizadoEm || b.criadoEm || '').localeCompare(a.atualizadoEm || a.criadoEm || ''))
      .slice(0, 8);

    pagina.innerHTML = `
      <div style="margin-bottom:16px">
        <div class="page-title" style="font-size:1.1rem">📊 Dashboard — Produção</div>
        <div style="font-size:.72rem;color:var(--muted)">Visão geral das ordens de produção</div>
      </div>

      <div class="kpi-grid" style="margin-bottom:16px">
        <div class="kpi blue"><span class="kpi-icon">📋</span><div class="kpi-val" id="pdash-kpi-total">${total.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Total de OPs</div><div class="kpi-sub">${totalCx.toLocaleString('pt-BR')} caixas programadas</div><canvas id="pdash-spark-total" height="28" style="margin-top:8px;opacity:.65;width:100%"></canvas></div>
        <div class="kpi orange"><span class="kpi-icon">⏳</span><div class="kpi-val" id="pdash-kpi-pend">${pend.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Pendentes</div><div class="kpi-sub">${pendCx.toLocaleString('pt-BR')} caixas aguardando</div><canvas id="pdash-spark-pend" height="28" style="margin-top:8px;opacity:.65;width:100%"></canvas></div>
        <div class="kpi yellow"><span class="kpi-icon">⚙️</span><div class="kpi-val" id="pdash-kpi-and">${and.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Em andamento</div><div class="kpi-sub">${andCx.toLocaleString('pt-BR')} caixas em prod.</div><canvas id="pdash-spark-and" height="28" style="margin-top:8px;opacity:.65;width:100%"></canvas></div>
        <div class="kpi green"><span class="kpi-icon">✅</span><div class="kpi-val" id="pdash-kpi-ok">${ok.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Concluídas</div><div class="kpi-sub">${okCx.toLocaleString('pt-BR')} caixas finalizadas</div><canvas id="pdash-spark-ok" height="28" style="margin-top:8px;opacity:.65;width:100%"></canvas></div>
      </div>

      <div class="kpi-grid" style="margin-bottom:16px">
        <div class="kpi teal"><span class="kpi-icon">📦</span><div class="kpi-val">${progSemana.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Programado (cx) — semana</div></div>
        <div class="kpi lime"><span class="kpi-icon">🏭</span><div class="kpi-val">${realSemana.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Realizado (cx) — semana</div></div>
        <div class="kpi ${pctSemana >= 100 ? 'teal' : pctSemana > 0 ? 'yellow' : 'purple'}"><span class="kpi-icon">📈</span><div class="kpi-val">${pctSemana}%</div><div class="kpi-lbl">% da semana concluído</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:16px;align-items:start" class="pdash-grid">
        <div class="tc">
          <div style="padding:10px 14px;font-weight:700;font-size:.85rem;border-bottom:1px solid var(--border)">🕒 Últimas OPs atualizadas</div>
          <div style="overflow:auto">
            <table class="dt-table">
              <thead><tr><th>Produto</th><th>Máquina</th><th style="text-align:right">Caixas</th><th>Status</th><th>Data</th></tr></thead>
              <tbody>
                ${recentes.length ? recentes.map(r => {
                  const status = STATUS_INFO[r.status] || STATUS_INFO.pendente;
                  return `<tr>
                    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(r.produto)}</b></td>
                    <td>${esc(r.maquina)}</td>
                    <td style="text-align:right">${esc(r.qntCaixas)}</td>
                    <td><span class="badge ${status.cor}">${status.label}</span></td>
                    <td style="color:var(--muted);font-size:.75rem">${esc(r.data || '—')}</td>
                  </tr>`;
                }).join('') : `<tr><td colspan="5"><div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma OP cadastrada ainda</div></div></td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="tc" style="padding:14px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">🏭 Ocupação de máquinas — semana</div>
          ${ocupacao.length ? ocupacao.map(m => `
            <div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:3px">
                <span>${esc(m.nome)}</span><span style="color:var(--muted)">${m.pct}%</span>
              </div>
              <div style="height:8px;background:var(--surface-2);border-radius:99px;overflow:hidden">
                <div style="height:100%;width:${m.pct}%;background:${m.pct >= 90 ? 'var(--red, #e11d48)' : m.pct >= 60 ? 'var(--cyan)' : 'var(--info)'};transition:width .2s"></div>
              </div>
            </div>
          `).join('') : '<div class="empty"><div class="empty-icon">🏭</div><div class="empty-title">Sem máquinas com turno configurado</div></div>'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-top:16px" class="pdash-grid">
        <div class="tc" style="padding:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div style="font-weight:700;font-size:.85rem">📊 Programação por Máquina</div>
            <div style="display:flex;gap:4px">
              <button type="button" class="btn ${_dashModoFluxo === 'caixas' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pdash-fluxo-modo="caixas">Caixas</button>
              <button type="button" class="btn ${_dashModoFluxo === 'ops' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pdash-fluxo-modo="ops">OPs</button>
            </div>
          </div>
          <div style="height:220px;position:relative"><canvas id="pdash-chart-fluxo"></canvas></div>
        </div>
        <div class="tc" style="padding:14px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:12px">🥯 Status das OPs</div>
          <div style="height:150px;position:relative;display:flex;align-items:center;justify-content:center">
            <canvas id="pdash-chart-status"></canvas>
            <div style="position:absolute;text-align:center;pointer-events:none">
              <div style="font-size:1.3rem;font-weight:700;color:var(--text)" id="pdash-donut-pct">${total > 0 ? Math.round(ok / total * 100) : 0}%</div>
              <div style="font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">concluído</div>
            </div>
          </div>
          <div id="pdash-status-legend" style="display:flex;flex-direction:column;gap:5px;margin-top:10px"></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:3fr 2fr;gap:16px;margin-top:16px" class="pdash-grid">
        <div class="tc" style="padding:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-weight:700;font-size:.85rem">🏆 Top Produtos Programados</div>
            <div style="font-size:.65rem;color:var(--muted)">por caixas</div>
          </div>
          <div style="height:180px;position:relative"><canvas id="pdash-chart-top-prod"></canvas></div>
        </div>
        <div class="tc" style="padding:14px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">📈 Métricas Rápidas</div>
          <div id="pdash-metricas-wrap" style="display:flex;flex-direction:column;gap:9px"></div>
        </div>
      </div>

      <div class="tc" style="padding:14px;margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div style="font-weight:700;font-size:.85rem">🏭 Status por Máquina</div>
          <div style="display:flex;gap:10px;font-size:.65rem">
            <span style="display:flex;align-items:center;gap:4px;color:var(--orange)"><span style="width:7px;height:7px;border-radius:50%;background:var(--orange);display:inline-block"></span>Em produção</span>
            <span style="display:flex;align-items:center;gap:4px;color:var(--info)"><span style="width:7px;height:7px;border-radius:50%;background:var(--info);display:inline-block"></span>Pendente</span>
            <span style="display:flex;align-items:center;gap:4px;color:var(--muted)"><span style="width:7px;height:7px;border-radius:50%;background:var(--muted);display:inline-block"></span>Livre</span>
          </div>
        </div>
        <div id="pdash-maquinas-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px"></div>
      </div>

      <div class="tc" style="padding:14px;margin-top:16px">
        <div style="font-weight:700;font-size:.85rem;margin-bottom:2px">📦 Caixas por Máquina</div>
        <div style="font-size:.65rem;color:var(--muted);margin-bottom:12px">programado vs. concluído (total de todas as OPs)</div>
        <div id="pdash-maq-bars-wrap" style="display:flex;flex-direction:column;gap:7px;max-height:240px;overflow-y:auto"></div>
      </div>
    `;

    _desenharGraficosDashboardExtra(total, pend, and, ok, totalCx, pendCx, andCx, okCx);
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
      const nome = produto.length > 26 ? produto.slice(0, 26) + '…' : produto;
      mapa[nome] = (mapa[nome] || 0) + (Number(r.qntCaixas) || 0);
    });
    const sorted = Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const paleta = sorted.map((_, i) => `hsl(${25 + i * 22}, 65%, 48%)`);
    _chartTopProdDash = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: sorted.map(x => x[0]), datasets: [{ label: 'Caixas', data: sorted.map(x => x[1]), backgroundColor: paleta, borderColor: paleta, borderWidth: 1, borderRadius: 4 }] },
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
    const metricas = [
      { label: 'Conclusão (OPs)', val: pctConc + '%', bar: pctConc, cor: 'var(--success)' },
      { label: 'Conclusão (Caixas)', val: pctCx + '%', bar: pctCx, cor: 'var(--orange)' },
      { label: 'Máquinas ativas', val: maqsAtivas + ' máq.', bar: null, cor: 'var(--warn)' },
      { label: 'Total de caixas', val: totalCx.toLocaleString('pt-BR'), bar: null, cor: 'var(--info)' },
      { label: 'Em andamento', val: and + ' OPs', bar: total > 0 ? Math.round(and / total * 100) : 0, cor: 'var(--orange)' },
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
      else if (pendRegs.length) { cor = 'var(--info)'; label = pendRegs.length + ' pend.'; }
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
          <div style="position:absolute;top:0;left:0;height:100%;width:${pctBar}%;background:rgba(232,117,26,.22);border-radius:4px"></div>
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
    _desenharSparklineDash('pdash-spark-total', _sparkDataDash(total, 8), COR_STATUS_HEX.em_andamento);
    _desenharSparklineDash('pdash-spark-pend', _sparkDataDash(pend, 8), COR_STATUS_HEX.pendente);
    _desenharSparklineDash('pdash-spark-and', _sparkDataDash(and, 8), COR_STATUS_HEX.em_andamento);
    _desenharSparklineDash('pdash-spark-ok', _sparkDataDash(ok, 8), COR_STATUS_HEX.concluido);
    _desenharGraficoFluxoDash();
    _desenharGraficoStatusDash(total, pend, and, ok);
    _desenharGraficoTopProdutosDash();
    _desenharMetricasRapidasDash(total, ok, and, totalCx, okCx);
    _desenharGradeMaquinasDash();
    _desenharBarrasCaixasMaquinaDash();
  }

  document.addEventListener('click', function (event) {
    const modo = event.target.closest('[data-pdash-fluxo-modo]');
    if (modo) { _dashModoFluxo = modo.getAttribute('data-pdash-fluxo-modo'); _desenharProducaoDashboard(); }
  });

  global.renderProducaoDashboard = renderProducaoDashboard;
  global._desenharProducaoDashboard = _desenharProducaoDashboard;
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _registros=[]; _apontamentos=[]; _maquinas=[]; _setups=[]; });
})(window);
