// Setor Produção — Programação Automática, bem simplificada (fase 3d da
// unificação com o Sistema de Produção). A original tem ~1.870 linhas:
// simulação de 4 semanas, fila por prioridade dinâmica, scoring de máquina
// com 5 fatores (setup como fator dominante — dependência que já não existe
// no motor de agenda simplificado da fase 3c), e 3 fases de "equalização de
// carga". Deliberadamente NÃO portado — em vez disso: olha a Projeção,
// acha produtos com cobertura abaixo do mínimo configurado, sugere uma
// quantidade pra alcançar a cobertura-alvo na máquina compatível menos
// ocupada da semana atual. Sem simulação, sem scoring multi-fator. Nada é
// gravado até o usuário escolher e clicar em "Aplicar selecionadas".
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_PRODUTOS = 'producao_produtos';
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_REGISTROS = 'producao_registros';

  let _produtos = [];
  let _maquinas = [];
  let _registros = [];
  let _carregado = false;
  let _sugestoes = [];

  function fs() { return global.getDTFirestore(); }

  function _domingoDaSemana(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); r.setDate(r.getDate() - r.getDay()); return r; }

  async function carregarProgAutomatica(forcar) {
    if (_carregado && !forcar) return;
    await global.carregarProducaoProjecao?.(forcar);
    const [snapProd, snapMaq, snapReg] = await Promise.all([
      fs().collection(COL_PRODUTOS).get(),
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_REGISTROS).get(),
    ]);
    _produtos = snapProd.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  function _maquinaMenosOcupada(produto) {
    if (!produto) return null;
    const candidatas = _maquinas.filter(m => (m.produtosCompativeis || []).some(p => String(p.produto) === String(produto.nome)));
    const pool = candidatas.length ? candidatas : (produto.maquina ? _maquinas.filter(m => m.nome === produto.maquina) : []);
    if (!pool.length) return null;
    if (typeof global.buildProducaoSchedule !== 'function' || pool.length === 1) return pool[0];
    const maquinasPorNome = {}; _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const resultado = global.buildProducaoSchedule(_domingoDaSemana(new Date()), _registros, maquinasPorNome);
    return pool.slice().sort((a, b) => {
      const oa = resultado.porMaquina[a.nome], ob = resultado.porMaquina[b.nome];
      const pa = oa && oa.capacidadeMinutosSemana > 0 ? oa.totalMinutosUsados / oa.capacidadeMinutosSemana : 0;
      const pb = ob && ob.capacidadeMinutosSemana > 0 ? ob.totalMinutosUsados / ob.capacidadeMinutosSemana : 0;
      return pa - pb;
    })[0];
  }

  function _resolvePcMin(produto, maquina) {
    if (maquina && Array.isArray(maquina.produtosCompativeis)) {
      const compat = maquina.produtosCompativeis.find(p => String(p.produto) === String(produto?.nome));
      if (compat && Number(compat.velocidade) > 0) return Number(compat.velocidade);
    }
    if (produto && Number(produto.pc_min) > 0) return Number(produto.pc_min);
    return 0;
  }

  function gerarSugestoes() {
    const coberturaMin = Math.max(0, Number(document.getElementById('ppa-cobertura-min')?.value) || 10);
    const coberturaAlvo = Math.max(coberturaMin, Number(document.getElementById('ppa-cobertura-alvo')?.value) || 20);
    const projecao = global.calcularProjecaoComRisco?.() || [];

    _sugestoes = projecao
      .filter(p => p.coberturaDias != null && p.coberturaDias < coberturaMin)
      .map(p => {
        const produto = _produtos.find(pr => String(pr.cod) === String(p.cod));
        const maquina = _maquinaMenosOcupada(produto);
        const unidPorCx = Math.max(1, Number(produto?.unid) || 1);
        const estoqueAlvoCx = (p.projSemanal / 7) * coberturaAlvo;
        const qtyCaixas = Math.max(1, Math.ceil(estoqueAlvoCx - (Number(p.estoqueAtual) || 0)));
        return {
          cod: p.cod, produto: p.produto, coberturaAtual: p.coberturaDias, coberturaAlvo,
          qtyCaixas, maquina: maquina ? maquina.nome : null, pcMin: maquina ? _resolvePcMin(produto, maquina) : 0,
          unidPorCx, categoria: maquina?.categoria || '', semMaquina: !maquina,
        };
      });
    _desenharProgAutomatica();
  }

  async function renderProducaoProgAutomatica() {
    const pagina = document.getElementById('page-producao-prog-automatica');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProgAutomatica(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _sugestoes = [];
    _desenharProgAutomatica();
  }

  function _desenharProgAutomatica() {
    const pagina = document.getElementById('page-producao-prog-automatica');
    if (!pagina) return;
    const coberturaMin = document.getElementById('ppa-cobertura-min')?.value ?? 10;
    const coberturaAlvo = document.getElementById('ppa-cobertura-alvo')?.value ?? 20;

    pagina.innerHTML = `
      <div style="margin-bottom:16px">
        <div class="page-title" style="font-size:1.1rem">🤖 Programação Automática</div>
        <div style="font-size:.72rem;color:var(--muted)">Sugere OPs pra produtos com cobertura de estoque baixa, com base na Projeção de Vendas</div>
      </div>
      <div class="tc" style="padding:14px;margin-bottom:16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap">
        <div class="form-group" style="margin:0"><label>Cobertura mínima (dias)</label><input class="field" id="ppa-cobertura-min" type="number" min="0" value="${esc(coberturaMin)}" style="width:120px"></div>
        <div class="form-group" style="margin:0"><label>Cobertura alvo (dias)</label><input class="field" id="ppa-cobertura-alvo" type="number" min="0" value="${esc(coberturaAlvo)}" style="width:120px"></div>
        <button type="button" class="btn btn-primary" data-ppa-gerar="1">🤖 Gerar sugestões</button>
        ${_sugestoes.length ? `<button type="button" class="btn btn-primary" data-ppa-aplicar="1">✅ Aplicar selecionadas</button>` : ''}
      </div>
      ${_sugestoes.length ? `
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th><input type="checkbox" data-ppa-check-todos="1" checked></th><th>Produto</th><th>Cobertura atual</th><th>Sugestão (cx)</th><th>Máquina</th></tr></thead>
            <tbody>
              ${_sugestoes.map((s, i) => `
                <tr>
                  <td><input type="checkbox" data-ppa-check="${i}" ${s.semMaquina ? 'disabled' : 'checked'}></td>
                  <td><b>${esc(s.produto)}</b><div style="font-size:.62rem;color:var(--muted)">Cód. ${esc(s.cod)}</div></td>
                  <td>${s.coberturaAtual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d</td>
                  <td>${esc(s.qtyCaixas)}</td>
                  <td>${s.maquina ? esc(s.maquina) : '<span class="badge b-red">Sem máquina compatível</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : `<div class="empty"><div class="empty-icon">🤖</div><div class="empty-title">Clique em "Gerar sugestões" pra ver produtos com risco de ruptura</div></div>`}
    `;
  }

  async function aplicarSugestoesSelecionadas() {
    const checks = document.querySelectorAll('[data-ppa-check]:checked');
    if (!checks.length) { global.showToast?.('Selecione ao menos uma sugestão.', 'error'); return; }
    const agora = new Date().toISOString();
    const hojeStr = new Date().toISOString().slice(0, 10);
    try {
      for (const chk of checks) {
        const s = _sugestoes[Number(chk.getAttribute('data-ppa-check'))];
        if (!s || s.semMaquina) continue;
        await fs().collection(COL_REGISTROS).add({
          produto: s.produto, prodCod: s.cod, maquina: s.maquina, pcMin: s.pcMin, unidPorCx: s.unidPorCx,
          qntCaixas: s.qtyCaixas, qntUnid: s.qtyCaixas * s.unidPorCx, categoria: s.categoria,
          status: 'pendente', data: hojeStr, horaInicio: '', obs: 'Gerada pela Programação Automática',
          sortOrder: Date.now(), criadoEm: agora, atualizadoEm: agora,
        });
      }
      global.showToast?.('Sugestões aplicadas — vá em Programação/Gantt pra ajustar as datas.', 'success');
      _sugestoes = [];
      _desenharProgAutomatica();
    } catch (e) {
      global.showToast?.('Erro ao aplicar: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoProgAutomatica = renderProducaoProgAutomatica;

  document.addEventListener('click', function (event) {
    const gerar = event.target.closest('[data-ppa-gerar]');
    if (gerar) { gerarSugestoes(); return; }
    const aplicar = event.target.closest('[data-ppa-aplicar]');
    if (aplicar) { aplicarSugestoesSelecionadas(); return; }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.hasAttribute('data-ppa-check-todos')) {
      document.querySelectorAll('[data-ppa-check]').forEach(chk => { if (!chk.disabled) chk.checked = event.target.checked; });
    }
  });
})(window);
