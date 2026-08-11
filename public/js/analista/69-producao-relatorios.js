// Setor Produção — Relatórios, bem simplificado (fase 3d da unificação com
// o Sistema de Produção). A original tinha TRÊS implementações concorrentes
// do mesmo painel (uma delas morta na prática) e um relatório "Por
// Funcionário" que nunca teve dado real (o campo usado nunca era gravado no
// apontamento, mesmo na original). Aqui: um painel único, 100% derivado do
// motor de agenda (fase 3c) — sem depender de Apontamento (que ainda não
// existe), mostrando só "Programado", nunca um falso "Realizado = 0%" como
// a original fazia silenciosamente.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_REGISTROS = 'producao_registros';

  const DIA_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  let _maquinas = [];
  let _registros = [];
  let _carregado = false;
  let _aba = 'maquina';
  let _tipoDia = 'bar';
  let _tipoCategoria = 'doughnut';
  const _charts = [];

  function fs() { return global.getDTFirestore(); }
  function _domingoDaSemana(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); r.setDate(r.getDate() - r.getDay()); return r; }

  async function carregarProducaoRelatorios(forcar) {
    if (_carregado && !forcar) return;
    const [snapMaq, snapReg] = await Promise.all([
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_REGISTROS).get(),
    ]);
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  async function renderProducaoRelatorios() {
    const pagina = document.getElementById('page-producao-relatorios');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try {
      await carregarProducaoRelatorios();
      await global.carregarProducaoInsumos?.();
    } catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoRelatorios();
  }

  function _tabelaPorMaquina() {
    if (typeof global.buildProducaoSchedule !== 'function') return '<div class="empty"><div class="empty-title">Motor de agenda não carregado</div></div>';
    const maquinasPorNome = {}; _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const resultado = global.buildProducaoSchedule(_domingoDaSemana(new Date()), _registros, maquinasPorNome);
    const nomes = Object.keys(resultado.porMaquina).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!nomes.length) return '<div class="empty"><div class="empty-icon">🏭</div><div class="empty-title">Nenhuma OP programada nesta semana</div></div>';
    return `<div class="tc"><div style="overflow:auto"><table class="dt-table">
      <thead><tr><th>Máquina</th><th>Ocupação da semana</th></tr></thead>
      <tbody>${nomes.map(nome => {
        const d = resultado.porMaquina[nome];
        const oc = d.capacidadeMinutosSemana > 0 ? Math.round((d.totalMinutosUsados / d.capacidadeMinutosSemana) * 100) : 0;
        return `<tr><td><b>${esc(nome)}</b></td><td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:6px;border-radius:4px;background:var(--border);overflow:hidden;max-width:200px"><div style="height:100%;width:${oc}%;background:var(--orange)"></div></div>
            <span style="font-size:.72rem;color:var(--muted)">${oc}%</span>
          </div></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
  }

  function _tabelaPorProduto() {
    if (typeof global.buildProducaoSchedule !== 'function') return '<div class="empty"><div class="empty-title">Motor de agenda não carregado</div></div>';
    const maquinasPorNome = {}; _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const resultado = global.buildProducaoSchedule(_domingoDaSemana(new Date()), _registros, maquinasPorNome);
    const porProduto = {};
    Object.values(resultado.porMaquina).forEach(dados => dados.porDia.forEach(segs => segs.forEach(s => {
      porProduto[s.produto] = (porProduto[s.produto] || 0) + s.caixasNoDia;
    })));
    const produtos = Object.keys(porProduto).sort((a, b) => porProduto[b] - porProduto[a]);
    if (!produtos.length) return '<div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Nenhuma OP programada nesta semana</div></div>';
    const maximo = porProduto[produtos[0]] || 1;
    return `<div class="tc"><div style="overflow:auto"><table class="dt-table">
      <thead><tr><th>Produto</th><th>Caixas programadas na semana</th></tr></thead>
      <tbody>${produtos.map(p => `<tr><td><b>${esc(p)}</b></td><td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;border-radius:4px;background:var(--border);overflow:hidden;max-width:200px"><div style="height:100%;width:${Math.round(porProduto[p] / maximo * 100)}%;background:var(--green-mid)"></div></div>
          <span style="font-size:.72rem;color:var(--muted)">${porProduto[p].toLocaleString('pt-BR')}</span>
        </div></td></tr>`).join('')}</tbody>
      </table></div></div>`;
  }

  function _tabelaInsumos() {
    if (typeof global.calcularConsumoInsumosSemana !== 'function') return '<div class="empty"><div class="empty-title">Módulo de Insumos não carregado</div></div>';
    const { geral } = global.calcularConsumoInsumosSemana(_domingoDaSemana(new Date()));
    const categorias = Object.keys(geral).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!categorias.length) return '<div class="empty"><div class="empty-icon">🧪</div><div class="empty-title">Nenhum insumo calculado para esta semana</div></div>';
    return `<div class="tc"><div style="overflow:auto"><table class="dt-table">
      <thead><tr><th>Categoria</th><th>Insumo</th><th>Total na semana</th></tr></thead>
      <tbody>${categorias.map(cat => Object.keys(geral[cat]).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(ins => `<tr><td>${esc(cat)}</td><td>${esc(ins)}</td><td>${geral[cat][ins].toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td></tr>`).join('')).join('')}</tbody>
      </table></div></div>`;
  }

  function _kpisSemana() {
    if (typeof global.buildProducaoSchedule !== 'function') return { totalCaixas: 0, maquinasAtivas: 0, produtoTop: '—' };
    const maquinasPorNome = {}; _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const resultado = global.buildProducaoSchedule(_domingoDaSemana(new Date()), _registros, maquinasPorNome);
    let totalCaixas = 0; const porProduto = {};
    Object.values(resultado.porMaquina).forEach(d => d.porDia.forEach(segs => segs.forEach(s => {
      totalCaixas += s.caixasNoDia;
      porProduto[s.produto] = (porProduto[s.produto] || 0) + s.caixasNoDia;
    })));
    const maquinasAtivas = Object.values(resultado.porMaquina).filter(d => d.porDia.some(dia => dia.length)).length;
    const produtoTop = Object.keys(porProduto).sort((a, b) => porProduto[b] - porProduto[a])[0] || '—';
    return { totalCaixas, maquinasAtivas, produtoTop };
  }

  function _destruirGraficos() {
    while (_charts.length) { try { _charts.pop().destroy(); } catch (e) { /* canvas já removido */ } }
  }

  function _dadosSemana() {
    const maquinasPorNome = {}; _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const resultado = global.buildProducaoSchedule?.(_domingoDaSemana(new Date()), _registros, maquinasPorNome) || { porMaquina: {} };
    return { resultado, maquinasPorNome };
  }

  function _blocoGraficos() {
    if (typeof global.Chart !== 'function') return '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Chart.js não carregado</div></div>';
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px">
        <div class="tc" style="padding:14px">
          <div style="font-weight:700;margin-bottom:8px">Programado por Máquina</div>
          <canvas id="pgraf-maquina" height="220"></canvas>
        </div>
        <div class="tc" style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-weight:700">Evolução Diária</div>
            <div style="display:flex;gap:4px">
              <button type="button" class="btn ${_tipoDia === 'bar' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="padding:2px 8px" data-prel-tipo-dia="bar">Barras</button>
              <button type="button" class="btn ${_tipoDia === 'line' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="padding:2px 8px" data-prel-tipo-dia="line">Linha</button>
            </div>
          </div>
          <canvas id="pgraf-dia" height="220"></canvas>
        </div>
        <div class="tc" style="padding:14px">
          <div style="font-weight:700;margin-bottom:8px">Ocupação por Máquina (meta 85%)</div>
          <canvas id="pgraf-ocupacao" height="220"></canvas>
        </div>
        <div class="tc" style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-weight:700">Mix por Categoria</div>
            <div style="display:flex;gap:4px">
              <button type="button" class="btn ${_tipoCategoria === 'doughnut' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="padding:2px 8px" data-prel-tipo-cat="doughnut">Rosca</button>
              <button type="button" class="btn ${_tipoCategoria === 'pie' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="padding:2px 8px" data-prel-tipo-cat="pie">Pizza</button>
              <button type="button" class="btn ${_tipoCategoria === 'bar' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="padding:2px 8px" data-prel-tipo-cat="bar">Barras</button>
            </div>
          </div>
          <canvas id="pgraf-categoria" height="220"></canvas>
        </div>
      </div>
      <div class="empty" style="display:flex;padding:10px 16px;margin-top:14px;text-align:left;flex-direction:row;gap:10px;align-items:center">
        <div class="empty-icon" style="margin:0;font-size:1.2rem">ℹ️</div>
        <div class="empty-sub" style="margin:0">Sem série "Realizado" ainda — entra quando a fase de Apontamento existir. Por enquanto todos os gráficos mostram só o <b>Programado</b>.</div>
      </div>
    `;
  }

  function _renderGraficos() {
    if (typeof global.Chart !== 'function') return;
    _destruirGraficos();
    const { resultado, maquinasPorNome } = _dadosSemana();
    const nomes = Object.keys(resultado.porMaquina).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    // 1. Programado por Máquina
    const caixasPorMaquina = nomes.map(n => resultado.porMaquina[n].porDia.reduce((s, dia) => s + dia.reduce((s2, seg) => s2 + (seg.tipo === 'producao' ? seg.caixasNoDia : 0), 0), 0));
    const c1 = document.getElementById('pgraf-maquina');
    if (c1) _charts.push(new global.Chart(c1, { type: 'bar', data: { labels: nomes, datasets: [{ label: 'Caixas programadas', data: caixasPorMaquina, backgroundColor: '#E8751A' }] }, options: { responsive: true, plugins: { legend: { display: false } } } }));

    // 2. Evolução Diária
    const caixasPorDia = DIA_LABEL.map((_, dayIdx) => nomes.reduce((s, n) => s + resultado.porMaquina[n].porDia[dayIdx].reduce((s2, seg) => s2 + (seg.tipo === 'producao' ? seg.caixasNoDia : 0), 0), 0));
    const c2 = document.getElementById('pgraf-dia');
    if (c2) _charts.push(new global.Chart(c2, { type: _tipoDia, data: { labels: DIA_LABEL, datasets: [{ label: 'Caixas programadas', data: caixasPorDia, backgroundColor: '#1E56D4', borderColor: '#1E56D4', fill: _tipoDia === 'line' ? false : true }] }, options: { responsive: true, plugins: { legend: { display: false } } } }));

    // 3. Ocupação por Máquina + meta 85%
    const ocupacoes = nomes.map(n => { const d = resultado.porMaquina[n]; return d.capacidadeMinutosSemana > 0 ? Math.round((d.totalMinutosUsados / d.capacidadeMinutosSemana) * 100) : 0; });
    const c3 = document.getElementById('pgraf-ocupacao');
    if (c3) _charts.push(new global.Chart(c3, { type: 'bar', data: { labels: nomes, datasets: [{ label: 'Ocupação %', data: ocupacoes, backgroundColor: ocupacoes.map(o => o >= 85 ? '#D92020' : '#15803D') }, { label: 'Meta (85%)', data: nomes.map(() => 85), type: 'line', borderColor: '#8A5C00', borderDash: [6, 4], pointRadius: 0 }] }, options: { responsive: true, scales: { y: { max: 100 } } } }));

    // 4. Mix por Categoria
    const porCategoria = {};
    nomes.forEach((n, idx) => { const cat = maquinasPorNome[n]?.categoria || 'Sem categoria'; porCategoria[cat] = (porCategoria[cat] || 0) + caixasPorMaquina[idx]; });
    const catLabels = Object.keys(porCategoria);
    const c4 = document.getElementById('pgraf-categoria');
    if (c4) _charts.push(new global.Chart(c4, { type: _tipoCategoria, data: { labels: catLabels, datasets: [{ data: catLabels.map(c => porCategoria[c]), backgroundColor: ['#E8751A', '#1E56D4', '#15803D', '#8A5C00', '#5B21B6', '#0A5E56', '#9E1A1A'] }] }, options: { responsive: true } }));
  }

  function _desenharProducaoRelatorios() {
    const pagina = document.getElementById('page-producao-relatorios');
    if (!pagina) return;
    _destruirGraficos();
    const kpis = _kpisSemana();
    const conteudo = _aba === 'maquina' ? _tabelaPorMaquina() : _aba === 'produto' ? _tabelaPorProduto() : _aba === 'insumos' ? _tabelaInsumos() : _blocoGraficos();
    pagina.innerHTML = `
      <div style="margin-bottom:16px">
        <div class="page-title" style="font-size:1.1rem">📊 Relatórios</div>
        <div style="font-size:.72rem;color:var(--muted)">Semana atual — baseado no que está programado (Programação/Gantt)</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:14px">
        <div class="tc" style="padding:12px 16px"><div style="font-size:.68rem;color:var(--muted)">Caixas programadas</div><div style="font-size:1.3rem;font-weight:700">${kpis.totalCaixas.toLocaleString('pt-BR')}</div></div>
        <div class="tc" style="padding:12px 16px"><div style="font-size:.68rem;color:var(--muted)">Máquinas ativas</div><div style="font-size:1.3rem;font-weight:700">${kpis.maquinasAtivas}</div></div>
        <div class="tc" style="padding:12px 16px"><div style="font-size:.68rem;color:var(--muted)">Produto mais programado</div><div style="font-size:.95rem;font-weight:700">${esc(kpis.produtoTop)}</div></div>
      </div>
      ${_aba !== 'graficos' ? `<div class="empty" style="display:flex;padding:10px 16px;margin-bottom:14px;text-align:left;flex-direction:row;gap:10px;align-items:center">
        <div class="empty-icon" style="margin:0;font-size:1.2rem">ℹ️</div>
        <div class="empty-sub" style="margin:0">Comparação com produção realizada entra quando a fase de Apontamento existir. Por enquanto, os números abaixo são só o que está <b>programado</b>.</div>
      </div>` : ''}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button type="button" class="btn ${_aba === 'maquina' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-prel-aba="maquina">Por Máquina</button>
        <button type="button" class="btn ${_aba === 'produto' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-prel-aba="produto">Por Produto</button>
        <button type="button" class="btn ${_aba === 'insumos' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-prel-aba="insumos">Insumos</button>
        <button type="button" class="btn ${_aba === 'graficos' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-prel-aba="graficos">📊 Gráficos</button>
      </div>
      ${conteudo}
    `;
    if (_aba === 'graficos') _renderGraficos();
  }

  function prelAba(aba) { _aba = aba; _desenharProducaoRelatorios(); }
  function prelTipoDia(tipo) { _tipoDia = tipo; _desenharProducaoRelatorios(); }
  function prelTipoCategoria(tipo) { _tipoCategoria = tipo; _desenharProducaoRelatorios(); }

  global.renderProducaoRelatorios = renderProducaoRelatorios;
  global.prelAba = prelAba;
  global.prelTipoDia = prelTipoDia;
  global.prelTipoCategoria = prelTipoCategoria;

  document.addEventListener('click', function (event) {
    const aba = event.target.closest('[data-prel-aba]');
    if (aba) { prelAba(aba.getAttribute('data-prel-aba')); return; }
    const tipoDia = event.target.closest('[data-prel-tipo-dia]');
    if (tipoDia) { prelTipoDia(tipoDia.getAttribute('data-prel-tipo-dia')); return; }
    const tipoCat = event.target.closest('[data-prel-tipo-cat]');
    if (tipoCat) { prelTipoCategoria(tipoCat.getAttribute('data-prel-tipo-cat')); return; }
  });
})(window);
