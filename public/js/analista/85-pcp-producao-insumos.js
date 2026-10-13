// PCP — Fase 9: Insumos da Produção. Cruza a programação de produção (via
// calcularNecessidadeInsumosPorOPs, em 65-producao-insumos.js — o MRP já
// existente, não um motor novo) com producao_insumos_estoque; onde faltar,
// gera requisição de compra pelo MESMO fluxo/coleção que o PCP já usa pra
// produto acabado (pcp_requisicoes_compra), só marcada tipoSolicitacao:'insumo'.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const CREQ = 'pcp_requisicoes_compra';
  const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  // PEDIDO AO VIVO (2026-09-04): "esses que estão escritos unidades, pode
  // deixar só o valor" — "unidade"/"unidades" não agrega informação (é só
  // uma contagem), diferente de kg/ml/etc que dizem o que está sendo
  // medido; some só esse rótulo específico, mantém os outros (kg, ml...).
  const unidadeExibivel = u => (u && !/^unidades?$/i.test(String(u).trim())) ? ' ' + esc(u) : '';

  let _horizonteDias = 30;
  let _ultimoCalculo = { porInsumo: [], porOP: [] };

  function fs() { return global.getDTFirestore(); }
  function tem(acao) { return typeof global.temPermissao !== 'function' || global.temPermissao('pcp-central', acao); }
  function hojeIso() { return new Date().toISOString().slice(0, 10); }
  function maisIso(dias) { const d = new Date(); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); }

  // BUG AO VIVO REAL (2026-09-04): "os insumos não tá atualizando certo" —
  // comparado com dados-insumos.json (o mesmo BI que a aba Insumos de
  // 78-pcp-central.js já usa), producao_insumos_estoque (Firestore) estava
  // muito desatualizado: FUBA MEDIO KG mostrava 0 disponível na tela,
  // enquanto o BI trazia 28.191 kg reais em estoque. Essa coleção só é
  // alimentada por um sync direto da Bluesoft (90-bluesoft-service.js) que
  // raramente roda; o BI (dados-insumos.json) é a fonte fresca de verdade,
  // já usada em Insumos. Casa primeiro pelo CÓDIGO (bluesoftProdutoKey da
  // ficha técnica, agora carregado por calcularNecessidadeInsumosPorOPs —
  // ver 65-producao-insumos.js), com nome normalizado só como último
  // recurso pra insumo sem código cadastrado na ficha.
  async function _calcular() {
    if (typeof global.carregarProducaoInsumos === 'function') await global.carregarProducaoInsumos();
    const internos = global._producaoInsumosInternals || {};
    const registros = internos.getRegistros?.() || [];
    const fichas = internos.getFichas?.() || [];
    const resultado = global.calcularNecessidadeInsumosPorOPs
      ? global.calcularNecessidadeInsumosPorOPs(registros, fichas, hojeIso(), maisIso(_horizonteDias))
      : { porInsumo: [], porOP: [] };
    const insumosBi = global._pcpInternals?.getInsumosBi?.() || [];
    // PEDIDO AO VIVO (2026-09-04): "vai no arquivo e vê se estão com as
    // quantidades corretas" — comparado com dados-insumos.json, "FUBA
    // MEDIO"/"SUSPENSÃO OLEOSA URUCUM" continuavam em 0: o nome do insumo
    // na ficha técnica guarda um traço (–) corrompido/diferente do usado no
    // BI, e o norm() daqui só tirava acento — não tocava em pontuação, então
    // "MP – FUBA..." nunca batia com "MP - FUBA...". canonInsumo()
    // (65-producao-insumos.js, já usada ali dentro pra achar estoque por
    // nome) tira TUDO que não é letra/número — traço de qualquer tipo,
    // caractere corrompido, "MP "/"MATÉRIA PRIMA " no início — então
    // "FUBA MEDIO KG" bate dos dois lados não importa como o traço foi
    // digitado.
    const canon = internos.canonInsumo || norm;
    const porCod = new Map(insumosBi.filter(x => x.cod).map(x => [String(x.cod), x]));
    const porNome = new Map(insumosBi.map(x => [canon(x.produto), x]));
    const porInsumo = resultado.porInsumo.map(x => {
      const est = (x.cod && porCod.get(String(x.cod))) || porNome.get(canon(x.insumo));
      const disponivel = n(est?.estoque);
      const saldo = disponivel - x.necessidade;
      // PEDIDO AO VIVO (2026-09-04): "vai no arquivo e vê se estão com as
      // quantidades corretas" — sem nenhum match no BI (nem código, nem
      // nome — ex.: insumo que o BI genuinamente não rastreia, tipo "ÁGUA
      // PRODUÇÃO"), "0 disponível" ficava idêntico a um insumo que
      // realmente está zerado. Marca esse caso separado, pra tela avisar
      // "sem dado no BI" em vez de fingir que é zero de verdade.
      return { ...x, disponivel, unidade: est?.unidade || '', saldo, status: saldo < 0 ? 'falta' : 'suficiente', semDadoBi: !est };
    }).sort((a, b) => a.saldo - b.saldo);
    _ultimoCalculo = { porInsumo, porOP: resultado.porOP };
    return _ultimoCalculo;
  }
  async function _buscarInsumosBiEAtualizar(btn) {
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Buscando...'; }
    try {
      if (typeof global._pcpInternals?.buscarInsumosBi === 'function') await global._pcpInternals.buscarInsumosBi();
      await renderPCPProducaoInsumos();
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = original || '📊 Buscar do BI'; }
    }
  }

  async function renderPCPProducaoInsumos() {
    const pagina = document.getElementById('page-pcp-producao-insumo');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try {
      await global._pcpInternals?.carregar?.();
      const { porInsumo, porOP } = await _calcular();
      _desenhar(porInsumo, porOP);
    } catch (e) {
      pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>';
    }
  }

  function _textoUltimaBuscaBi() { return global._pcpInternals?.getUltimaBuscaInsumosBi?.() || ''; }
  function _desenhar(porInsumo, porOP) {
    const pagina = document.getElementById('page-pcp-producao-insumo');
    if (!pagina) return;
    const emFalta = porInsumo.filter(x => x.status === 'falta');
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">🧪 Insumos da Produção Programada</div><div style="font-size:.74rem;color:var(--muted)">Cruza a produção programada com o estoque de insumos e sinaliza o que precisa ser comprado${_textoUltimaBuscaBi() ? ' · ' + esc(_textoUltimaBuscaBi()) : ''}</div></div>
        <div style="display:flex;gap:8px;align-items:center">
          ${global.DTBiPastaLocal?.suportado?.() ? '<button class="btn btn-ghost btn-sm" data-pcppi-buscar-bi>📊 Buscar do BI</button>' : ''}
          <select id="pcppi-horizonte" class="field" style="max-width:170px">
            ${[7, 15, 30, 45, 60, 90].map(d => `<option value="${d}" ${d === _horizonteDias ? 'selected' : ''}>Próximos ${d} dias</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${porInsumo.length}</div><div class="kpi-lbl">Insumos necessários</div></div>
        <div class="kpi ${emFalta.length ? 'red' : 'green'}"><div class="kpi-val">${emFalta.length}</div><div class="kpi-lbl">Em falta</div></div>
        <div class="kpi purple"><div class="kpi-val">${porOP.length}</div><div class="kpi-lbl">OPs programadas no período</div></div>
      </div>
      <div class="tc"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Categoria</th><th>Insumo</th><th>Necessário</th><th>Disponível</th><th>Saldo</th><th>Status</th><th></th></tr></thead>
        <tbody>${porInsumo.length ? porInsumo.map(x => `<tr><td>${esc(x.categoria)}</td><td><b>${esc(x.insumo)}</b></td><td>${x.necessidade.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td><td>${x.disponivel.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${unidadeExibivel(x.unidade)}${x.semDadoBi ? ' <span style="color:var(--muted);font-size:.7rem" title="Sem correspondência no BI — nem por código, nem por nome. Confira o vínculo (bluesoftProdutoKey) desse insumo na Ficha Técnica.">(sem dado no BI)</span>' : ''}</td><td style="color:${x.saldo < 0 ? '#D92020' : 'inherit'};font-weight:700">${x.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td><td><span class="badge ${x.status === 'falta' ? 'b-red' : 'b-green'}">${x.status === 'falta' ? 'em falta' : 'suficiente'}</span></td><td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-pcp-insumo-360="${esc(x.cod || x.insumo)}" data-pcp-insumo-nome="${esc(x.insumo)}">360°</button>${x.status === 'falta' && tem('criar') ? ` <button class="btn btn-ghost btn-sm" data-pcppi-gerar="${esc(x.insumo)}|${esc(x.categoria)}|${esc(x.unidade)}|${Math.ceil(Math.max(0, -x.saldo))}">Gerar necessidade</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7">Nenhum insumo necessário no período — sem produção programada com ficha técnica.</td></tr>'}</tbody>
      </table></div></div>
      <div class="tc" style="margin-top:14px;padding:12px">
        <b>Ordens de produção no período</b>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Produto</th><th>Máquina</th><th>Data</th><th>Caixas restantes</th><th>Insumos</th></tr></thead><tbody>
        ${porOP.length ? porOP.map(op => `<tr><td><b>${esc(op.produto)}</b></td><td>${esc(op.maquina)}</td><td>${esc(op.data)}</td><td>${op.qntCaixas.toLocaleString('pt-BR')}</td><td style="font-size:.72rem;color:var(--muted)">${op.insumos.map(i => esc(i.insumo)).join(', ')}</td></tr>`).join('') : '<tr><td colspan="5">Nenhuma OP no período.</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  async function pcppiGerarNecessidade(token) {
    if (!tem('criar')) return;
    const [insumo, categoria, unidade, quantidade] = token.split('|');
    const roteamento = global._pcpInternals?.resolverComprador?.({ categoria }) || {};
    const agora = new Date().toISOString();
    try {
      await fs().collection(CREQ).add({
        tipoSolicitacao: 'insumo', produto: insumo, insumo, categoria, unidade,
        quantidade: Math.max(1, Number(quantidade) || 1), dataNecessaria: '', destino: '',
        prioridade: 'alta', motivo: 'Insumo insuficiente para atender a produção programada',
        status: roteamento.compradorUid ? 'solicitada' : 'sem_comprador', origem: 'PCP-INSUMO',
        criadoEm: agora, criadoPor: global._currentAnalistaUser?.email || '', pcpResponsavel: global._currentAnalistaUser?.email || '',
        ...roteamento,
      });
      global.showToast?.('Necessidade de compra de insumo gerada.', 'success');
      renderPCPProducaoInsumos();
    } catch (e) { global.showToast?.('Erro ao gerar necessidade: ' + (e.message || e), 'error'); }
  }

  global.pcpRegistrarPagina?.('producao-insumo', { elId: 'page-pcp-producao-insumo', render: 'renderPCPProducaoInsumos', titulo: 'Insumos da Produção' });
  global.renderPCPProducaoInsumos = renderPCPProducaoInsumos;
  global._pcpProducaoInsumosInternals = { _calcular, setHorizonte: v => { _horizonteDias = Number(v) || 30; }, getHorizonte: () => _horizonteDias, getUltimoCalculo: () => _ultimoCalculo, unidadeExibivel };

  document.addEventListener('click', function (event) {
    const gerar = event.target.closest('[data-pcppi-gerar]');
    if (gerar) { pcppiGerarNecessidade(gerar.getAttribute('data-pcppi-gerar')); return; }
    const buscar = event.target.closest('[data-pcppi-buscar-bi]');
    if (buscar) { _buscarInsumosBiEAtualizar(buscar); }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pcppi-horizonte') { _horizonteDias = Number(event.target.value) || 30; renderPCPProducaoInsumos(); }
  });
})(window);
