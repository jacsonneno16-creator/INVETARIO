// Setor Produção — Insumos, visão "Por Máquina" e "Geral" (fase 3d da
// unificação com o Sistema de Produção). Só passou a ter o que mostrar
// depois do motor de agenda (fase 3c) existir — sem OPs agendadas na
// semana, ambas as visões ficam vazias (mesmo comportamento da original).
//
// Simplificações deliberadas: sem import de estoque de insumos (Excel,
// era só localStorage na original, sem sincronizar entre usuários) e sem
// coluna "Saldo" que dependia disso — só o cálculo de consumo semanal.
// Categoria vem de um campo opcional por insumo na Ficha Técnica (fallback
// "Outros"), sem o mapa hardcoded de ~380 produtos da original.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_REGISTROS = 'producao_registros';
  const COL_FICHAS = 'producao_ficha_tecnica';

  let _maquinas = [];
  let _registros = [];
  let _fichas = [];
  let _carregado = false;
  let _modo = 'maquina';
  let _weekStart = _domingoDaSemana(new Date());

  function fs() { return global.getDTFirestore(); }

  function _domingoDaSemana(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - r.getDay());
    return r;
  }
  function _fmtDataCurta(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }

  async function carregarProducaoInsumos(forcar) {
    if (_carregado && !forcar) return;
    const [snapMaq, snapReg, snapFicha] = await Promise.all([
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_REGISTROS).get(),
      fs().collection(COL_FICHAS).get(),
    ]);
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _fichas = snapFicha.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  async function renderProducaoInsumos() {
    const pagina = document.getElementById('page-producao-insumos');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoInsumos(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoInsumos();
  }

  // Retorna as linhas de consumo semanal, já agrupadas — reusado pelo
  // Relatórios (visão "Geral") pra não duplicar o cálculo.
  function calcularConsumoInsumosSemana(weekStart) {
    if (typeof global.buildProducaoSchedule !== 'function') return { porMaquina: {}, geral: {} };
    const maquinasPorNome = {};
    _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const registrosPorId = {};
    _registros.forEach(r => { registrosPorId[r._firestoreId] = r; });
    const fichasPorCod = {};
    _fichas.forEach(f => { fichasPorCod[String(f.cod)] = f; });

    const resultado = global.buildProducaoSchedule(weekStart, _registros, maquinasPorNome);
    const porMaquina = {}; // {maquina: {categoria: {insumo: total}}}
    const geral = {}; // {categoria: {insumo: total}}

    Object.keys(resultado.porMaquina).forEach(nomeMaquina => {
      resultado.porMaquina[nomeMaquina].porDia.forEach(segmentosDoDia => {
        segmentosDoDia.forEach(seg => {
          const registro = registrosPorId[seg.registroId];
          if (!registro) return;
          const ficha = fichasPorCod[String(registro.prodCod)];
          const insumos = (ficha && ficha.insumos) || [];
          insumos.forEach(ins => {
            const categoria = ins.categoria || 'Outros';
            const total = seg.caixasNoDia * (Number(ins.qty) || 0);
            if (total <= 0) return;
            porMaquina[nomeMaquina] = porMaquina[nomeMaquina] || {};
            porMaquina[nomeMaquina][categoria] = porMaquina[nomeMaquina][categoria] || {};
            porMaquina[nomeMaquina][categoria][ins.insumo] = (porMaquina[nomeMaquina][categoria][ins.insumo] || 0) + total;
            geral[categoria] = geral[categoria] || {};
            geral[categoria][ins.insumo] = (geral[categoria][ins.insumo] || 0) + total;
          });
        });
      });
    });
    return { porMaquina, geral };
  }

  function _desenharProducaoInsumos() {
    const pagina = document.getElementById('page-producao-insumos');
    if (!pagina) return;
    const { porMaquina, geral } = calcularConsumoInsumosSemana(_weekStart);
    const fimSemana = new Date(_weekStart); fimSemana.setDate(fimSemana.getDate() + 6);

    let corpoTabela = '';
    if (_modo === 'geral') {
      const categorias = Object.keys(geral).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      corpoTabela = categorias.length ? categorias.map(cat => {
        const insumosOrdenados = Object.keys(geral[cat]).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const subtotal = insumosOrdenados.reduce((soma, i) => soma + geral[cat][i], 0);
        return insumosOrdenados.map(insumo => `
          <tr><td>${esc(cat)}</td><td>${esc(insumo)}</td><td>${geral[cat][insumo].toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td></tr>
        `).join('') + `<tr style="background:var(--surface-2);font-weight:700"><td colspan="2">Subtotal — ${esc(cat)}</td><td>${subtotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td></tr>`;
      }).join('') : '';
    } else {
      const maquinasComDados = Object.keys(porMaquina).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      corpoTabela = maquinasComDados.length ? maquinasComDados.map(maq => Object.keys(porMaquina[maq]).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(cat => Object.keys(porMaquina[maq][cat]).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(insumo => `
        <tr><td>${esc(maq)}</td><td>${esc(cat)}</td><td>${esc(insumo)}</td><td>${porMaquina[maq][cat][insumo].toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td></tr>
      `).join('')).join('')).join('') : '';
    }

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">🧪 Insumos</div>
          <div style="font-size:.72rem;color:var(--muted)">${_fmtDataCurta(_weekStart)} a ${_fmtDataCurta(fimSemana)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn ${_modo === 'maquina' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pins-modo="maquina">Por Máquina</button>
          <button type="button" class="btn ${_modo === 'geral' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pins-modo="geral">Geral</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pins-semana="-1">‹ Semana anterior</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pins-hoje="1">Hoje</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pins-semana="1">Próxima semana ›</button>
        </div>
      </div>
      ${corpoTabela ? `
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr>${_modo === 'maquina' ? '<th>Máquina</th>' : ''}<th>Categoria</th><th>Insumo</th><th>Total na semana</th></tr></thead>
            <tbody>${corpoTabela}</tbody>
          </table>
        </div>
      </div>` : `<div class="empty"><div class="empty-icon">🧪</div><div class="empty-title">Nenhum insumo calculado para esta semana</div><div class="empty-sub">Precisa de OPs agendadas (Programação) com produtos que tenham insumos cadastrados na Ficha Técnica</div></div>`}
    `;
  }

  function pinsModo(modo) { _modo = modo; _desenharProducaoInsumos(); }
  function pinsSemana(dir) { _weekStart.setDate(_weekStart.getDate() + dir * 7); _desenharProducaoInsumos(); }
  function pinsHoje() { _weekStart = _domingoDaSemana(new Date()); _desenharProducaoInsumos(); }

  global.renderProducaoInsumos = renderProducaoInsumos;
  global.carregarProducaoInsumos = carregarProducaoInsumos;
  global.calcularConsumoInsumosSemana = calcularConsumoInsumosSemana;
  global.pinsModo = pinsModo;
  global.pinsSemana = pinsSemana;
  global.pinsHoje = pinsHoje;

  document.addEventListener('click', function (event) {
    const modo = event.target.closest('[data-pins-modo]');
    if (modo) { pinsModo(modo.getAttribute('data-pins-modo')); return; }
    const semana = event.target.closest('[data-pins-semana]');
    if (semana) { pinsSemana(Number(semana.getAttribute('data-pins-semana'))); return; }
    const hoje = event.target.closest('[data-pins-hoje]');
    if (hoje) { pinsHoje(); return; }
  });
})(window);
