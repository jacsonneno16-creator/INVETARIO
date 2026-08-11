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

  let _registros = [];
  let _maquinas = [];
  let _apontamentos = [];
  let _setups = [];
  let _carregado = false;

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
        <div class="kpi blue"><span class="kpi-icon">📋</span><div class="kpi-val">${total.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Total de OPs</div></div>
        <div class="kpi orange"><span class="kpi-icon">⏳</span><div class="kpi-val">${pend.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Pendentes</div></div>
        <div class="kpi yellow"><span class="kpi-icon">⚙️</span><div class="kpi-val">${and.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Em andamento</div></div>
        <div class="kpi green"><span class="kpi-icon">✅</span><div class="kpi-val">${ok.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Concluídas</div></div>
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
    `;
  }

  global.renderProducaoDashboard = renderProducaoDashboard;
  global._desenharProducaoDashboard = _desenharProducaoDashboard;
})(window);
