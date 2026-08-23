// Setor Produção — Mapa da Fábrica (fase 3f da unificação com o Sistema de
// Produção). Na original, `mapaFabrica.js` calculava ocupação a partir de um
// `cargaMaquinas` estático passado por parâmetro e nunca chegou a ser
// chamado por nenhuma página (nem `router.js` nem `app.js` referenciam o
// módulo) — ou seja, existia no código mas nunca rodou de verdade. Aqui:
// visão só-leitura, agrupada por categoria (as "áreas" da fábrica), com
// ocupação real vinda do motor de agenda (fase 3c) — mesma fonte usada por
// Máquinas e Relatórios — navegável por semana como Insumos (fase 3d).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_REGISTROS = 'producao_registros';
  const COL_SETUP = 'producao_setup';

  let _maquinas = [];
  let _registros = [];
  let _setups = [];
  let _carregado = false;
  let _weekStart = _domingoDaSemana(new Date());

  function fs() { return global.getDTFirestore(); }

  function _domingoDaSemana(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - r.getDay());
    return r;
  }
  function _fmtDataCurta(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }

  const STATUS_INFO = {
    ativa: { label: 'Ativa', cor: 'b-green' },
    manutencao: { label: 'Em manutenção', cor: 'b-yellow' },
    inativa: { label: 'Inativa', cor: 'b-red' },
  };

  async function carregarProducaoMapaFabrica(forcar) {
    if (_carregado && !forcar) return;
    const [snapMaq, snapReg, snapSetup] = await Promise.all([
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_REGISTROS).get(),
      fs().collection(COL_SETUP).get(),
    ]);
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _setups = snapSetup.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  let _containerMapa = 'page-producao-mapa-fabrica';
  async function renderProducaoMapaFabrica(containerId) {
    _containerMapa = containerId || 'page-producao-mapa-fabrica';
    const pagina = document.getElementById(_containerMapa);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoMapaFabrica(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoMapaFabrica();
  }

  // Ocupação por máquina na semana selecionada, via motor de agenda (mesma
  // fonte que Máquinas e Relatórios) — nada de snapshot estático como na
  // original.
  function _gerarMapa() {
    if (typeof global.buildProducaoSchedule !== 'function') return null;
    const maquinasPorNome = {};
    _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const resultado = global.buildProducaoSchedule(_weekStart, _registros, maquinasPorNome, _setups);
    return _maquinas.map(m => {
      const d = resultado.porMaquina[m.nome];
      const usado = d?.totalMinutosUsados || 0;
      const capacidade = d?.capacidadeMinutosSemana || 0;
      const ocupacao = capacidade > 0 ? Math.min(100, Math.round((usado / capacidade) * 100)) : 0;
      return { maquina: m, ocupacao, usado, capacidade };
    });
  }

  function _corOcupacao(ocupacao) { return ocupacao >= 90 ? 'var(--danger)' : ocupacao >= 70 ? 'var(--orange)' : 'var(--green-mid)'; }

  function _desenharProducaoMapaFabrica() {
    const pagina = document.getElementById(_containerMapa);
    if (!pagina) return;
    const fimSemana = new Date(_weekStart); fimSemana.setDate(fimSemana.getDate() + 6);
    const cabecalho = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">🗺️ Mapa da Fábrica</div>
          <div style="font-size:.72rem;color:var(--muted)">${_fmtDataCurta(_weekStart)} a ${_fmtDataCurta(fimSemana)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pmf-busca" placeholder="Buscar nome ou categoria..." value="${esc(String(document.getElementById('pmf-busca')?.value || ''))}" class="field" style="min-width:220px">
          <button type="button" class="btn btn-ghost btn-sm" data-pmf-semana="-1">‹ Semana anterior</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pmf-hoje="1">Hoje</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pmf-semana="1">Próxima semana ›</button>
        </div>
      </div>
    `;

    if (!_maquinas.length) {
      pagina.innerHTML = cabecalho + '<div class="empty"><div class="empty-icon">🏭</div><div class="empty-title">Nenhuma máquina cadastrada</div><div class="empty-sub">Cadastre máquinas em Produção → Máquinas pra ver o mapa</div></div>';
      return;
    }
    const mapa = _gerarMapa();
    if (!mapa) {
      pagina.innerHTML = cabecalho + '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Motor de agenda não carregado</div></div>';
      return;
    }

    const busca = String(document.getElementById('pmf-busca')?.value || '').trim().toLowerCase();
    const filtrado = mapa.filter(x => !busca || String(x.maquina.nome || '').toLowerCase().includes(busca) || String(x.maquina.categoria || '').toLowerCase().includes(busca));

    const usadoTotal = mapa.reduce((s, x) => s + x.usado, 0);
    const capacidadeTotal = mapa.reduce((s, x) => s + x.capacidade, 0);
    const ocupacaoGeral = capacidadeTotal > 0 ? Math.round((usadoTotal / capacidadeTotal) * 100) : 0;
    const criticas = mapa.filter(x => x.ocupacao >= 90).length;
    const ociosas = mapa.filter(x => x.capacidade > 0 && x.ocupacao < 70).length;

    const kpis = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
        <div class="tc" style="padding:12px 16px"><div style="font-size:.68rem;color:var(--muted)">Ocupação geral da semana</div><div style="font-size:1.3rem;font-weight:700">${ocupacaoGeral}%</div></div>
        <div class="tc" style="padding:12px 16px"><div style="font-size:.68rem;color:var(--muted)">Máquinas em alerta (≥90%)</div><div style="font-size:1.3rem;font-weight:700;color:${criticas ? 'var(--danger)' : 'inherit'}">${criticas}</div></div>
        <div class="tc" style="padding:12px 16px"><div style="font-size:.68rem;color:var(--muted)">Máquinas ociosas (&lt;70%)</div><div style="font-size:1.3rem;font-weight:700">${ociosas}</div></div>
      </div>
    `;

    if (!filtrado.length) {
      pagina.innerHTML = cabecalho + kpis + '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">Nenhuma máquina encontrada</div></div>';
      return;
    }

    const porCategoria = {};
    filtrado.forEach(x => {
      const cat = x.maquina.categoria || 'Sem categoria';
      (porCategoria[cat] = porCategoria[cat] || []).push(x);
    });
    const categorias = Object.keys(porCategoria).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const secoes = categorias.map(cat => {
      const itens = porCategoria[cat].sort((a, b) => b.ocupacao - a.ocupacao);
      return `
        <div style="margin-bottom:20px">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">${esc(cat)} <span style="font-weight:400;color:var(--muted);font-size:.72rem">(${itens.length})</span></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
            ${itens.map(x => {
              const status = STATUS_INFO[x.maquina.status] || STATUS_INFO.ativa;
              const cor = _corOcupacao(x.ocupacao);
              return `
              <div class="tc" style="padding:14px;display:flex;flex-direction:column;gap:8px;${x.maquina.status === 'inativa' ? 'opacity:.6' : ''}">
                <div style="display:flex;align-items:start;justify-content:space-between;gap:8px">
                  <div style="font-weight:600">${esc(x.maquina.nome)}</div>
                  <span class="badge ${status.cor}" style="font-size:.62rem">${status.label}</span>
                </div>
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted);margin-bottom:3px">
                    <span>Ocupação da semana</span><span>${x.ocupacao}%</span>
                  </div>
                  <div style="height:8px;border-radius:4px;background:var(--border);overflow:hidden">
                    <div style="height:100%;width:${x.ocupacao}%;background:${cor}"></div>
                  </div>
                </div>
                <div style="font-size:.68rem;color:var(--muted)">Usado: ${Math.round(x.usado).toLocaleString('pt-BR')} min · Capacidade: ${Math.round(x.capacidade).toLocaleString('pt-BR')} min</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    pagina.innerHTML = cabecalho + kpis + secoes;
  }

  function pmfSemana(dir) { _weekStart.setDate(_weekStart.getDate() + dir * 7); _desenharProducaoMapaFabrica(); }
  function pmfHoje() { _weekStart = _domingoDaSemana(new Date()); _desenharProducaoMapaFabrica(); }

  global.renderProducaoMapaFabrica = renderProducaoMapaFabrica;
  global.pmfSemana = pmfSemana;
  global.pmfHoje = pmfHoje;

  document.addEventListener('click', function (event) {
    const semana = event.target.closest('[data-pmf-semana]');
    if (semana) { pmfSemana(Number(semana.getAttribute('data-pmf-semana'))); return; }
    const hoje = event.target.closest('[data-pmf-hoje]');
    if (hoje) { pmfHoje(); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pmf-busca') _desenharProducaoMapaFabrica();
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _maquinas=[]; _registros=[]; _setups=[]; });
})(window);
