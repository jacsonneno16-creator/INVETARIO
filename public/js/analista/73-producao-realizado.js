// Setor Produção — Realizado / Apontamento (fase 3f da unificação com o
// Sistema de Produção). A original apontava produção em grade de HORA em
// HORA (7h–23h, ~17 colunas por dia, guardado em localStorage por
// dispositivo — nunca sincronizava entre operadores/telas). Aqui: apontamento
// por DIA (uma coluna por dia da semana), gravado direto no Firestore em
// `producao_apontamentos` — mesma granularidade diária já usada pelo motor
// de agenda (fase 3c) e por Relatórios/Gantt, e agora sim sincronizado entre
// todos os usuários. Cada doc é chaveado por `${registroId}_${data}`.
//
// Com este módulo existindo, Relatórios (fase 3d) passa a poder mostrar
// "Realizado" de verdade em vez de só "Programado" — ver nota no topo de
// 69-producao-relatorios.js.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_REGISTROS = 'producao_registros';
  const COL_APONTAMENTOS = 'producao_apontamentos';
  const DIA_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  let _registros = [];
  let _apontamentos = [];
  let _carregado = false;
  let _weekStart = _domingoDaSemana(new Date());
  let _salvando = new Set(); // chaves "registroId_data" em gravação, pra evitar corrida

  function fs() { return global.getDTFirestore(); }
  function podeEditar() { return typeof global.temPermissao !== 'function' || global.temPermissao('producao-realizado', 'editar'); }

  function _domingoDaSemana(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - r.getDay());
    return r;
  }
  function _isoData(d) { return d.toISOString().slice(0, 10); }
  function _fmtDataCurta(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
  function _fimSemana() { const f = new Date(_weekStart); f.setDate(f.getDate() + 6); return f; }
  function _diasDaSemana() { return Array.from({ length: 7 }, (_, i) => { const d = new Date(_weekStart); d.setDate(d.getDate() + i); return d; }); }

  async function carregarProducaoRealizado(forcar) {
    if (_carregado && !forcar) return;
    const [snapReg, snapApon] = await Promise.all([
      fs().collection(COL_REGISTROS).get(),
      fs().collection(COL_APONTAMENTOS).get(),
    ]);
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _apontamentos = snapApon.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  function _apontamentoDe(registroId, data) {
    return _apontamentos.find(a => a.registroId === registroId && a.data === data);
  }
  function _totalRealizado(registroId) {
    return _apontamentos.filter(a => a.registroId === registroId).reduce((s, a) => s + (Number(a.qntCaixas) || 0), 0);
  }
  function _totalRealizadoNaSemana(registroId, datasSemana) {
    return _apontamentos
      .filter(a => a.registroId === registroId && datasSemana.includes(a.data))
      .reduce((s, a) => s + (Number(a.qntCaixas) || 0), 0);
  }

  async function renderProducaoRealizado() {
    const pagina = document.getElementById('page-producao-realizado');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoRealizado(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoRealizado();
  }

  function _desenharProducaoRealizado() {
    const pagina = document.getElementById('page-producao-realizado');
    if (!pagina) return;
    const dias = _diasDaSemana();
    const datasSemana = dias.map(_isoData);
    const editavel = podeEditar();

    // OPs relevantes nesta semana: data desejada cai na semana OU já tem
    // algum apontamento gravado na semana (ex.: atrasada, mas foi produzida
    // agora) — assim uma OP não "some" da tela só porque passou do dia.
    const linhas = _registros
      .filter(r => datasSemana.includes(r.data) || _apontamentos.some(a => a.registroId === r._firestoreId && datasSemana.includes(a.data)))
      .sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.maquina || '').localeCompare(b.maquina || ''));

    let progTotal = 0, realTotal = 0, concluidasNaSemana = 0;
    linhas.forEach(r => {
      progTotal += Number(r.qntCaixas) || 0;
      realTotal += _totalRealizadoNaSemana(r._firestoreId, datasSemana);
      if (r.status === 'concluido') concluidasNaSemana++;
    });
    const pctSemana = progTotal > 0 ? Math.min(100, Math.round((realTotal / progTotal) * 100)) : 0;

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">✅ Realizado — Apontamento de Produção</div>
          <div style="font-size:.72rem;color:var(--muted)">${_fmtDataCurta(_weekStart)} a ${_fmtDataCurta(_fimSemana())}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" data-preal-semana="-1">‹ Semana anterior</button>
          <button type="button" class="btn btn-ghost btn-sm" data-preal-hoje="1">Hoje</button>
          <button type="button" class="btn btn-ghost btn-sm" data-preal-semana="1">Próxima semana ›</button>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:16px">
        <div class="kpi blue"><span class="kpi-icon">📋</span><div class="kpi-val">${progTotal.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Programado (cx) — semana</div></div>
        <div class="kpi green"><span class="kpi-icon">✅</span><div class="kpi-val">${realTotal.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Realizado (cx) — semana</div></div>
        <div class="kpi ${pctSemana >= 100 ? 'teal' : pctSemana > 0 ? 'yellow' : 'purple'}"><span class="kpi-icon">📊</span><div class="kpi-val">${pctSemana}%</div><div class="kpi-lbl">% da semana concluído</div></div>
        <div class="kpi lime"><span class="kpi-icon">🏁</span><div class="kpi-val">${concluidasNaSemana}</div><div class="kpi-lbl">OPs concluídas</div></div>
      </div>

      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr>
              <th>Produto</th><th>Máquina</th><th style="text-align:right">Program.</th>
              ${dias.map((d, i) => `<th style="text-align:center;min-width:64px">${DIA_LABEL[i]}<br><span style="font-weight:400;color:var(--muted)">${_fmtDataCurta(d)}</span></th>`).join('')}
              <th style="text-align:right">Total</th><th style="text-align:center">%</th><th></th>
            </tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(r => {
                const totalReal = _totalRealizado(r._firestoreId);
                const programado = Number(r.qntCaixas) || 0;
                const pct = programado > 0 ? Math.min(100, Math.round((totalReal / programado) * 100)) : 0;
                const corPct = pct >= 100 ? 'b-green' : pct > 0 ? 'b-blue' : 'b-orange';
                return `
                <tr data-preal-linha="${esc(r._firestoreId)}">
                  <td><b>${esc(r.produto)}</b></td>
                  <td>${esc(r.maquina)}</td>
                  <td style="text-align:right">${programado.toLocaleString('pt-BR')}</td>
                  ${datasSemana.map(ds => {
                    const apon = _apontamentoDe(r._firestoreId, ds);
                    const valor = apon ? Number(apon.qntCaixas) || 0 : '';
                    return `<td style="text-align:center">
                      <input type="number" min="0" step="1" class="field" style="width:64px;text-align:center;padding:4px 2px"
                        value="${valor}" ${editavel ? '' : 'disabled'}
                        data-preal-input="1" data-preal-registro="${esc(r._firestoreId)}" data-preal-data="${esc(ds)}">
                    </td>`;
                  }).join('')}
                  <td style="text-align:right;font-weight:700;color:var(--cyan)" data-preal-total="${esc(r._firestoreId)}">${totalReal.toLocaleString('pt-BR')}</td>
                  <td style="text-align:center"><span class="badge ${corPct}" data-preal-pct="${esc(r._firestoreId)}">${pct}%</span></td>
                  <td style="text-align:center;white-space:nowrap">
                    ${editavel && r.status !== 'concluido' ? `<button type="button" class="acao-lapis" title="Marcar como concluído" data-preal-concluir="${esc(r._firestoreId)}">🏁</button>` : (r.status === 'concluido' ? '<span class="badge b-green">Concluído</span>' : '')}
                  </td>
                </tr>`;
              }).join('') : `<tr><td colspan="12"><div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma OP nesta semana</div><div class="empty-sub">Cadastre ordens de produção em Programação, com data dentro deste intervalo.</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function prealSemana(dir) { _weekStart.setDate(_weekStart.getDate() + dir * 7); _desenharProducaoRealizado(); }
  function prealHoje() { _weekStart = _domingoDaSemana(new Date()); _desenharProducaoRealizado(); }

  async function _salvarApontamento(registroId, data, valorStr) {
    if (!podeEditar()) return;
    const chave = registroId + '_' + data;
    if (_salvando.has(chave)) return;
    _salvando.add(chave);
    try {
      const registro = _registros.find(r => r._firestoreId === registroId);
      const unidPorCx = Math.max(1, Number(registro && registro.unidPorCx) || 1);
      const qntCaixas = Math.max(0, Number(valorStr) || 0);
      const docId = chave;
      if (!valorStr && valorStr !== 0) {
        // campo limpo pelo usuário — remove o apontamento do dia
        await fs().collection(COL_APONTAMENTOS).doc(docId).delete().catch(() => {});
        _apontamentos = _apontamentos.filter(a => a._firestoreId !== docId);
      } else {
        const payload = {
          registroId, data, qntCaixas, qntUnid: qntCaixas * unidPorCx,
          atualizadoEm: new Date().toISOString(),
          atualizadoPor: global._currentAnalistaUser?.email || '',
        };
        await fs().collection(COL_APONTAMENTOS).doc(docId).set(payload, { merge: true });
        const idx = _apontamentos.findIndex(a => a._firestoreId === docId);
        if (idx >= 0) _apontamentos[idx] = { _firestoreId: docId, ...payload };
        else _apontamentos.push({ _firestoreId: docId, ...payload });
      }
      // Atualiza só a linha afetada, sem redesenhar a tela toda (evita
      // perder o foco do campo enquanto o usuário ainda está digitando).
      const totalCell = document.querySelector(`[data-preal-total="${CSS.escape(registroId)}"]`);
      const pctCell = document.querySelector(`[data-preal-pct="${CSS.escape(registroId)}"]`);
      const totalReal = _totalRealizado(registroId);
      const programado = Number(registro && registro.qntCaixas) || 0;
      const pct = programado > 0 ? Math.min(100, Math.round((totalReal / programado) * 100)) : 0;
      if (totalCell) totalCell.textContent = totalReal.toLocaleString('pt-BR');
      if (pctCell) {
        pctCell.textContent = pct + '%';
        pctCell.className = 'badge ' + (pct >= 100 ? 'b-green' : pct > 0 ? 'b-blue' : 'b-orange');
      }
    } catch (e) {
      global.showToast?.('Erro ao salvar apontamento: ' + (e.message || e), 'error');
    } finally {
      _salvando.delete(chave);
    }
  }

  async function prealConcluir(registroId) {
    const registro = _registros.find(r => r._firestoreId === registroId);
    if (!registro) return;
    const executar = async () => {
      try {
        await fs().collection(COL_REGISTROS).doc(registroId).set({ status: 'concluido', atualizadoEm: new Date().toISOString() }, { merge: true });
        registro.status = 'concluido';
        global.showToast?.('OP marcada como concluída.', 'success');
        _desenharProducaoRealizado();
      } catch (e) {
        global.showToast?.('Erro ao concluir: ' + (e.message || e), 'error');
      }
    };
    const msg = `Marcar a OP do produto "${registro.produto}" como concluída?`;
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Concluir OP', icon: '🏁', okLabel: 'Concluir' });
    else if (confirm(msg)) await executar();
  }

  global.renderProducaoRealizado = renderProducaoRealizado;
  global._desenharProducaoRealizado = _desenharProducaoRealizado;
  global.prealConcluir = prealConcluir;

  document.addEventListener('click', function (event) {
    if (!document.getElementById('page-producao-realizado')) return;
    const semana = event.target.closest('[data-preal-semana]');
    if (semana) { prealSemana(Number(semana.getAttribute('data-preal-semana'))); return; }
    const hoje = event.target.closest('[data-preal-hoje]');
    if (hoje) { prealHoje(); return; }
    const concluir = event.target.closest('[data-preal-concluir]');
    if (concluir) { prealConcluir(concluir.getAttribute('data-preal-concluir')); return; }
  });

  // Debounce por campo — evita disparar uma gravação a cada tecla.
  const _timers = {};
  document.addEventListener('input', function (event) {
    const input = event.target.closest('[data-preal-input]');
    if (!input) return;
    const chave = input.getAttribute('data-preal-registro') + '_' + input.getAttribute('data-preal-data');
    clearTimeout(_timers[chave]);
    _timers[chave] = setTimeout(() => {
      _salvarApontamento(input.getAttribute('data-preal-registro'), input.getAttribute('data-preal-data'), input.value);
    }, 500);
  });
})(window);
