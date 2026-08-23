// Produção — Programação V341. CRUD de OPs, snapshot histórico de configuração,
// hora inicial, observações, insumos, paginação e importação Excel. O Gantt e
// o motor de agenda reutilizam os mesmos registros Firestore.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_REGISTROS = 'producao_registros';
  const COL_PRODUTOS = 'producao_produtos';
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_FICHAS = 'producao_ficha_tecnica';
  const COL_PCP = 'pcp_solicitacoes_producao_global';
  const COL_ESTOQUE = 'producao_insumos_estoque';

  const PAGE_SIZE = 15;

  let _registros = [];
  let _produtos = [];
  let _maquinas = [];
  let _fichas = [];
  let _estoqueIns = [];
  let _carregado = false;
  let _pagina = 1;
  const _expandidos = new Set();
  let _pcpSolic = [];
  let _pcpSolicCarregado = false;
  // PEDIDO AO VIVO (auditoria RELATORIO-COMPARACAO-PRODUCAO.md, item 4): o
  // original (index.html:223-227, tableWeekNav/tableWeekReset em app.js)
  // não tem filtro De/Até — a lista mostra TODAS as OPs por padrão
  // ("Todas as semanas") e um botão ‹/› avança por semana quando o usuário
  // quer restringir. null = sem filtro de semana.
  let _semanaFiltro = null;
  function _segundaDaSemana(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); const dia = x.getDay(); x.setDate(x.getDate() - (dia === 0 ? 6 : dia - 1)); return x; }
  function _isoData(d) { return d.toISOString().slice(0, 10); }
  function _fmtDataCurta(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }

  function fs() { return global.getDTFirestore(); }
  function _podeCriar() { return typeof global.temPermissao !== 'function' || global.temPermissao('producao-programacao', 'criar'); }

  // PCP (fase 4) — solicitações de produção roteadas pra esta loja como
  // unidade produtora (empresaProdutoraId). Coleção raiz (não escopada por
  // /lojas/{id}/) porque cruza a loja de origem do pedido com a loja que
  // produz, então filtra manualmente pela loja ativa.
  async function carregarPCPSolicitacoes(forcar) {
    if (_pcpSolicCarregado && !forcar) return;
    const lojaId = global.getDTLojaAtiva?.() || '';
    if (!lojaId) { _pcpSolic = []; _pcpSolicCarregado = true; return; }
    const raw = global.getDTRawFirestore();
    const snap = await raw.collection(COL_PCP).where('empresaProdutoraId','==',lojaId).get().catch(() => ({ docs: [] }));
    _pcpSolic = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    _pcpSolicCarregado = true;
  }

  // Recebe a solicitação do PCP e converte em OP oficial de Programação —
  // só quem tem permissão de criar OP (mesma do botão "+ Nova OP") pode
  // puxar trabalho externo pra fila de produção da loja.
  async function pprogReceberPCP(id){
    if(!_podeCriar())return;
    const r = _pcpSolic.find(x => x._id === id);
    if (!r || r.status !== 'solicitada') return;
    const produto = _produtos.find(p => String(p.cod) === String(r.prodKey || r.cod || '')) ||
      _produtos.find(p => String(p.nome || '').trim().toLowerCase() === String(r.produto || '').trim().toLowerCase());
    const unidPorCx = Math.max(1, Number(produto?.unid) || 1);
    const caixas = Math.max(1, Math.ceil(Number(r.quantidade) || 1));
    const agora = new Date().toISOString();
    const payload = {
      produto: r.produto || produto?.nome || '', prodCod: produto?.cod || r.prodKey || r.cod || '', maquina: '',
      pcMin: produto ? _resolvePcMin(produto, null) : 0, unidPorCx, qntCaixas: caixas, qntUnid: caixas * unidPorCx,
      categoria: produto?.categoria || '', status: 'pendente', data: r.dataProgramada || '', horaInicio: '', obs: r.observacao || '',
      pcpSolicitacaoId:id, sortOrder: Date.now(), criadoEm: agora, atualizadoEm: agora,
    };
    const ref = await fs().collection(COL_REGISTROS).add(payload);
    const raw = global.getDTRawFirestore();
    await raw.collection(COL_PCP).doc(id).set({
      status:'programada',opId:ref.id, opLojaId: global.getDTLojaAtiva() || '',
      recebidoEm: agora, recebidoPor: global._currentAnalistaUser?.email || '',
      programadoEm: agora, programadoPor: global._currentAnalistaUser?.email || '', atualizadoEm: agora,
    }, { merge: true });
    await carregarPCPSolicitacoes(true);
    await carregarProducaoProgramacao(true);
    _desenharProducaoProgramacao();
    global.showToast?.('Solicitação do PCP recebida e programada como OP.', 'success');
  }

  // Finaliza a solicitação depois que a OP foi produzida (Realizado já
  // sincronizou o status pra 'produzida' via syncPCP) — lança a entrada no
  // estoque uma única vez (idempotente por movimentoId) e fecha o ciclo.
  async function pprogFinalizarPCP(id) {
    if (!_podeCriar()) return;
    const r = _pcpSolic.find(x => x._id === id);
    if (!r || r.status !== 'produzida') return;
    const op = _registros.find(x => x._firestoreId === r.opId) || {};
    const qtdEntrada=Math.max(0,Number(op.realizadoCaixas)||0);
    if (typeof global.aplicarEntradaEstoqueProducao !== 'function') throw new Error('Motor de estoque da Produção indisponível.');
    await global.aplicarEntradaEstoqueProducao({ prodKey: r.prodKey || r.cod || '', produto: r.produto || '', qtdCx: qtdEntrada, movimentoId:'producao_pcp_'+id, tipo: 'producao_pcp', origemId: id });
    const raw = global.getDTRawFirestore();
    const agora = new Date().toISOString();
    await raw.collection(COL_PCP).doc(id).set({ status:'finalizada', estoqueEntradaCx:qtdEntrada, finalizadoEm: agora, finalizadoPor: global._currentAnalistaUser?.email || '', atualizadoEm: agora }, { merge: true });
    await carregarPCPSolicitacoes(true);
    _desenharProducaoProgramacao();
    global.showToast?.('Solicitação do PCP finalizada.', 'success');
  }

  function _pcpPainelHtml() {
    const pendentes = _pcpSolic.filter(r => r.status === 'solicitada');
    const produzidas = _pcpSolic.filter(r => r.status === 'produzida');
    if (!pendentes.length && !produzidas.length) return '';
    return `<div class="tc" style="padding:12px;margin-bottom:12px">
      <b>📥 Solicitações do PCP</b>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:8px">Pedidos de produção roteados pelo PCP pra esta unidade produtora.</div>
      ${pendentes.length ? `<div style="margin-bottom:8px"><div style="font-size:.72rem;color:var(--muted);margin-bottom:4px">Pendentes de recebimento</div><div style="display:flex;flex-wrap:wrap;gap:6px">${pendentes.map(r => `<button type="button" class="btn btn-ghost btn-sm" ${r.status==='solicitada'&&_podeCriar() ? `data-pprog-pcp-programar="${esc(r._id)}"` : 'disabled'}>${esc(r.produto)} · ${(Number(r.quantidade) || 0).toLocaleString('pt-BR')}cx${r.dataProgramada ? ' · ' + esc(r.dataProgramada) : ''}</button>`).join('')}</div></div>` : ''}
      ${produzidas.length ? `<div><div style="font-size:.72rem;color:var(--muted);margin-bottom:4px">Produzidas — aguardando finalização</div><div style="display:flex;flex-wrap:wrap;gap:6px">${produzidas.map(r => `<button type="button" class="btn btn-ghost btn-sm" ${_podeCriar() ? `data-pprog-pcp-finalizar="${esc(r._id)}"` : 'disabled'}>${esc(r.produto)} · finalizar</button>`).join('')}</div></div>` : ''}
    </div>`;
  }

  async function carregarProducaoProgramacao(forcar) {
    if (_carregado && !forcar) return;
    const [snapReg, snapProd, snapMaq, snapFicha, snapEstoque] = await Promise.all([
      fs().collection(COL_REGISTROS).get(),
      fs().collection(COL_PRODUTOS).get(),
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_FICHAS).get(),
      fs().collection(COL_ESTOQUE).get().catch(() => ({ docs: [] })),
    ]);
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _produtos = snapProd.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _fichas = snapFicha.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _estoqueIns = snapEstoque.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  const STATUS_INFO = {
    pendente: { label: 'Pendente', cor: 'b-orange' },
    em_andamento: { label: 'Em Andamento', cor: 'b-blue' },
    concluido: { label: 'Concluído', cor: 'b-green' },
  };

  function _insumosDoProduto(prodCod) {
    const ficha = _fichas.find(f => String(f.cod) === String(prodCod));
    return (ficha && ficha.insumos) || [];
  }

  function _normIns(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  // PEDIDO AO VIVO (comparação com o original achou isso faltando): a coluna
  // Insumos hoje só contava quantos insumos a ficha tem, sem checar se tem
  // matéria-prima suficiente. O original cruza necessário × estoque atual e
  // mostra falta/ok direto na tabela — reproduzido aqui.
  function _statusInsumosOP(r) {
    const insumos = _insumosDoProduto(r.prodCod);
    if (!insumos.length) return { tipo: 'nenhum', insumos };
    const caixas = Number(r.qntCaixas) || 0;
    let temDadosEstoque = false, falta = false;
    insumos.forEach(i => {
      const necessario = (Number(i.qty) || 0) * caixas;
      const item = _estoqueIns.find(e => _normIns(e.insumo || e.nome) === _normIns(i.insumo));
      if (item) { temDadosEstoque = true; if ((Number(item.quantidade ?? item.estoque) || 0) < necessario) falta = true; }
    });
    if (!temDadosEstoque) return { tipo: 'semdados', insumos };
    return { tipo: falta ? 'falta' : 'ok', insumos };
  }

  // Prioridade: produtosCompativeis[produto] da máquina > pc_min do produto > 0.
  function _resolvePcMin(produto, maquina) {
    if (maquina && Array.isArray(maquina.produtosCompativeis)) {
      const compat = maquina.produtosCompativeis.find(p => String(p.produto) === String(produto?.nome));
      if (compat && Number(compat.velocidade) > 0) return Number(compat.velocidade);
    }
    if (produto && Number(produto.pc_min) > 0) return Number(produto.pc_min);
    return 0;
  }

  function _calcTempoHoras(qntUnid, pcMin) {
    if (!pcMin || pcMin <= 0) return null;
    return qntUnid / pcMin / 60;
  }

  // Congela a configuracao usada pela OP. Isso evita que uma alteracao futura
  // de velocidade, unidade por caixa, categoria ou ficha tecnica reescreva o
  // passado dos relatorios/apontamentos.
  function _buildConfigSnapshot(produto, maquina, pcMin, unidPorCx) {
    const ficha = _fichas.find(f => String(f.cod) === String(produto?.cod));
    const compat = Array.isArray(maquina?.produtosCompativeis)
      ? maquina.produtosCompativeis.find(p => String(p.produto) === String(produto?.nome)) : null;
    return {
      version: 1,
      frozenAt: new Date().toISOString(),
      produto: {
        cod: produto?.cod ?? '', descricao: produto?.nome || '', unidPorCx,
        categoria: produto?.categoria || maquina?.categoria || '',
        classificacao: produto?.classificacao || '', alergenico: produto?.alergenico === true,
        metaCoberturaDias: Number(produto?.metaCoberturaDias || produto?.coberturaDias) || 0,
        producaoMinima: Number(produto?.producaoMinima) || 0, multiploProducao: Number(produto?.multiploProducao) || 0,
        tipoMinimo: produto?.tipoMinimo || '', prioridadeProducao: Number(produto?.prioridadeProducao) || 2,
        pcMinCatalogo: Number(produto?.pc_min) || 0,
      },
      maquina: {
        nome: maquina?.nome || '', categoria: maquina?.categoria || '',
        setupPadraoMin: Number(maquina?.setupPadraoMin) || 0,
      },
      velocidade: { valor: Number(pcMin) || 0, fonte: compat && Number(compat.velocidade) > 0 ? 'maquina_produto' : 'produto' },
      insumos: (ficha?.insumos || []).map(i => ({ insumo: i.insumo || '', qty: Number(i.qty) || 0, categoria: i.categoria || '' })),
    };
  }

  function _snapshotDoRegistro(r) { return r && r.configSnapshot && r.configSnapshot.version ? r.configSnapshot : null; }

  async function migrarSnapshotsProgramacao() {
    const legados = _registros.filter(r => r._firestoreId && !_snapshotDoRegistro(r));
    for (const r of legados) {
      const produto = _produtos.find(p => String(p.cod) === String(r.prodCod));
      const maquina = _maquinas.find(m => m.nome === r.maquina);
      if (!produto || !maquina) continue;
      const unidPorCx = Math.max(1, Number(r.unidPorCx) || Number(produto.unid) || 1);
      const pcMin = Number(r.pcMin) || _resolvePcMin(produto, maquina);
      const snap = _buildConfigSnapshot(produto, maquina, pcMin, unidPorCx);
      await fs().collection(COL_REGISTROS).doc(r._firestoreId).set({ configSnapshot: snap, pcMin, unidPorCx, atualizadoEm: new Date().toISOString() }, { merge: true });
      r.configSnapshot = snap; r.pcMin = pcMin; r.unidPorCx = unidPorCx;
    }
    return legados.length;
  }

  async function renderProducaoProgramacao() {
    const pagina = document.getElementById('page-producao-programacao');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try {
      await carregarProducaoProgramacao();
      try { await carregarPCPSolicitacoes(); } catch (e) { console.warn('[producao] solicitações PCP:', e); }
      if (typeof global.temPermissao === 'function' && global.temPermissao('producao-programacao', 'editar')) {
        try { await migrarSnapshotsProgramacao(); } catch (e) { console.warn('[producao] snapshot legado:', e); }
      }
    }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoProgramacao();
  }

  function _desenharProducaoProgramacao() {
    const pagina = document.getElementById('page-producao-programacao');
    if (!pagina) return;
    const busca = String(document.getElementById('pprog-busca')?.value || '').trim().toLowerCase();
    const filtroMaquina = String(document.getElementById('pprog-filtro-maquina')?.value || '');
    const filtroStatus = String(document.getElementById('pprog-filtro-status')?.value || '');
    const semanaIni = _semanaFiltro ? _isoData(_semanaFiltro) : null;
    const semanaFim = _semanaFiltro ? _isoData(new Date(new Date(_semanaFiltro).setDate(_semanaFiltro.getDate() + 6))) : null;

    const linhasFiltradas = _registros
      .filter(r => !busca || String(r.produto || '').toLowerCase().includes(busca))
      .filter(r => !filtroMaquina || r.maquina === filtroMaquina)
      .filter(r => !filtroStatus || r.status === filtroStatus)
      .filter(r => !semanaIni || (String(r.data || '') >= semanaIni && String(r.data || '') <= semanaFim))
      .sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));

    const totalPaginas = Math.max(1, Math.ceil(linhasFiltradas.length / PAGE_SIZE));
    if (_pagina > totalPaginas) _pagina = totalPaginas;
    const linhas = linhasFiltradas.slice((_pagina - 1) * PAGE_SIZE, _pagina * PAGE_SIZE);

    const opcoesMaquinas = _maquinas.map(m => `<option value="${esc(m.nome)}" ${filtroMaquina === m.nome ? 'selected' : ''}>${esc(m.nome)}</option>`).join('');

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">📋 Programação</div>
          <div style="font-size:.72rem;color:var(--muted)">${linhasFiltradas.length.toLocaleString('pt-BR')} ordem(ns) de produção</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pprog-busca" placeholder="Buscar produto..." value="${esc(busca)}" class="field" style="min-width:180px">
          <select id="pprog-filtro-maquina" class="field"><option value="">Todas as máquinas</option>${opcoesMaquinas}</select>
          <select id="pprog-filtro-status" class="field">
            <option value="">Todos os status</option>
            <option value="pendente" ${filtroStatus === 'pendente' ? 'selected' : ''}>Pendente</option>
            <option value="em_andamento" ${filtroStatus === 'em_andamento' ? 'selected' : ''}>Em andamento</option>
            <option value="concluido" ${filtroStatus === 'concluido' ? 'selected' : ''}>Concluído</option>
          </select>
          <div style="display:flex;align-items:center;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px 8px">
            <button type="button" data-pprog-semana="-1" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;padding:0 4px;line-height:1" title="Semana anterior">‹</button>
            <span data-pprog-semana-reset style="font-size:.72rem;color:var(--orange);white-space:nowrap;min-width:120px;text-align:center;cursor:pointer" title="Clique para ver todas">${_semanaFiltro ? `${_fmtDataCurta(_semanaFiltro)} – ${_fmtDataCurta(new Date(new Date(_semanaFiltro).setDate(_semanaFiltro.getDate() + 6)))}` : 'Todas as semanas'}</span>
            <button type="button" data-pprog-semana="1" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;padding:0 4px;line-height:1" title="Próxima semana">›</button>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-pprog-limpar-filtros>✕ Filtros</button>
          <button type="button" class="btn btn-sm" style="background:rgba(204,40,0,.12);border:1px solid rgba(204,40,0,.4);color:var(--danger)" data-pprog-limpar-tudo>🗑 Limpar Tudo</button>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0" title="Importar programação via Excel — colunas: Produto, Quantidade, Data">📥 Importar Excel<input type="file" id="pprog-excel-input" accept=".xlsx,.xls" style="display:none"></label>
          <button type="button" class="btn btn-ghost btn-sm" style="color:var(--muted)" data-pprog-template title="Baixar planilha modelo">⬇ Template</button>
          <button type="button" class="btn btn-primary btn-sm" data-pprog-novo="1">+ Nova</button>
        </div>
      </div>
      ${_pcpPainelHtml()}
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>#</th><th>Produto</th><th>Máquina</th><th>Caixas</th><th>Unidades</th><th>Tempo est.</th><th>Data</th><th>Status</th><th>Insumos</th><th></th></tr></thead>
            <tbody>
              ${linhas.length ? linhas.map((r, idx) => {
                const status = STATUS_INFO[r.status] || STATUS_INFO.pendente;
                const tempo = _calcTempoHoras(r.qntUnid, r.pcMin);
                const expandido = _expandidos.has(r._firestoreId);
                const statusIns = _statusInsumosOP(r);
                const insumos = statusIns.insumos;
                const badgeIns = { falta: { cor: 'b-red', texto: '⚠️ Falta MP' }, ok: { cor: 'b-green', texto: '✅ MP OK' }, semdados: { cor: 'b-gray', texto: '📋 Insumos' }, nenhum: { cor: '', texto: '—' } }[statusIns.tipo];
                return `
                <tr>
                  <td style="color:var(--muted)">${idx + 1}</td>
                  <td><b>${esc(r.produto)}</b>${r.obs ? `<div style="font-size:.68rem;color:var(--muted);margin-top:2px">${esc(r.obs)}</div>` : ''}</td>
                  <td><span class="badge b-purple">${esc(r.maquina)}</span></td>
                  <td>${esc(r.qntCaixas)}</td>
                  <td>${esc(r.qntUnid)}</td>
                  <td>${tempo != null ? tempo.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'h' : '—'}</td>
                  <td>${esc(r.data)}</td>
                  <td><span class="badge ${status.cor}">${status.label}</span></td>
                  <td style="cursor:${insumos.length ? 'pointer' : 'default'}" ${insumos.length ? `data-pprog-toggle-insumos="${esc(r._firestoreId)}"` : ''}>${statusIns.tipo === 'nenhum' ? '—' : `<span class="badge ${badgeIns.cor}">${badgeIns.texto}</span>`}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button type="button" class="acao-lapis" title="Editar" data-pprog-editar="${esc(r._firestoreId)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-pprog-excluir="${esc(r._firestoreId)}">🗑️</button>
                  </td>
                </tr>
                ${expandido ? `<tr><td colspan="10" style="background:var(--surface-2);padding:8px 16px">
                  <table style="width:100%;font-size:.74rem"><thead><tr><th style="text-align:left;color:var(--muted)">Insumo</th><th style="text-align:right;color:var(--muted)">Necessário</th><th style="text-align:right;color:var(--muted)">Estoque Atual</th><th style="text-align:right;color:var(--muted)">Saldo Final</th></tr></thead><tbody>
                    ${insumos.map(i => {
                      const necessario = (Number(i.qty) || 0) * (Number(r.qntCaixas) || 0);
                      const item = _estoqueIns.find(e => _normIns(e.insumo || e.nome) === _normIns(i.insumo));
                      const estoqueAtual = item ? (Number(item.quantidade ?? item.estoque) || 0) : null;
                      const saldo = estoqueAtual != null ? estoqueAtual - necessario : null;
                      return `<tr><td><b>${esc(i.insumo)}</b></td><td style="text-align:right">${necessario.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td><td style="text-align:right">${estoqueAtual != null ? estoqueAtual.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</td><td style="text-align:right;font-weight:700;color:${saldo != null && saldo < 0 ? 'var(--danger)' : 'inherit'}">${saldo != null ? saldo.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</td></tr>`;
                    }).join('')}
                  </tbody></table>
                </td></tr>` : ''}`;
              }).join('') : `<tr><td colspan="10"><div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma ordem de produção cadastrada</div><div class="empty-sub">Clique em "+ Nova OP" pra começar</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      ${linhasFiltradas.length > PAGE_SIZE ? `
      <div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:12px">
        <button type="button" class="btn btn-ghost btn-sm" data-pprog-pg="${_pagina - 1}" ${_pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
        <span style="font-size:.72rem;color:var(--muted)">Página ${_pagina} de ${totalPaginas}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-pprog-pg="${_pagina + 1}" ${_pagina >= totalPaginas ? 'disabled' : ''}>Próxima ›</button>
      </div>` : ''}
    `;
  }

  function _abrirModalPprog(item) {
    document.getElementById('pprog-title').textContent = item._novo ? 'Nova ordem de produção' : 'Editar ordem de produção';
    document.getElementById('pprog-doc-id').value = item._firestoreId || '';
    const selProduto = document.getElementById('pprog-produto');
    selProduto.innerHTML = _produtos.map(p => `<option value="${esc(p.cod)}">${esc(p.nome)}</option>`).join('') || '<option value="">Nenhum produto cadastrado</option>';
    selProduto.value = item.prodCod ?? '';
    const selMaquina = document.getElementById('pprog-maquina');
    selMaquina.innerHTML = _maquinas.map(m => `<option value="${esc(m.nome)}">${esc(m.nome)}</option>`).join('') || '<option value="">Nenhuma máquina cadastrada</option>';
    selMaquina.value = item.maquina || '';
    document.getElementById('pprog-caixas').value = item.qntCaixas || 1;
    document.getElementById('pprog-data').value = item.data || '';
    document.getElementById('pprog-hora').value = item.horaInicio || '';
    document.getElementById('pprog-status').value = item.status || 'pendente';
    document.getElementById('pprog-obs').value = item.obs || '';
    global.openModal?.('modal-pprog');
  }

  // Reaproveitada por outros módulos (ex.: Gantt, fase 3c) pra abrir a
  // mesma edição — pode ser chamada antes desta tela ter carregado seus
  // próprios dados, então garante o carregamento primeiro.
  async function pprogEditar(docId) {
    await carregarProducaoProgramacao();
    const item = _registros.find(r => r._firestoreId === docId);
    if (!item) return;
    _abrirModalPprog(item);
  }

  function pprogIrPara(pagina) { _pagina = Math.max(1, pagina); _desenharProducaoProgramacao(); }
  function pprogToggleInsumos(docId) {
    if (_expandidos.has(docId)) _expandidos.delete(docId); else _expandidos.add(docId);
    _desenharProducaoProgramacao();
  }

  function pprogNovaOp() {
    if (!_produtos.length || !_maquinas.length) {
      global.showToast?.('Cadastre ao menos um produto (Ficha Técnica) e uma máquina antes de criar uma OP.', 'error');
      return;
    }
    _abrirModalPprog({ _novo: true, status: 'pendente', qntCaixas: 1 });
  }

  async function pprogSalvar() {
    const prodCod = document.getElementById('pprog-produto').value;
    const maquinaNome = document.getElementById('pprog-maquina').value;
    const caixas = Math.max(1, Number(document.getElementById('pprog-caixas').value) || 1);
    const data = document.getElementById('pprog-data').value || '';
    const horaInicio = document.getElementById('pprog-hora').value || '';
    const status = document.getElementById('pprog-status').value || 'pendente';
    const obs = String(document.getElementById('pprog-obs').value || '').trim();
    if (!prodCod || !maquinaNome || !data) { global.showToast?.('Selecione produto, máquina e data.', 'error'); return; }

    const produto = _produtos.find(p => String(p.cod) === String(prodCod));
    const maquina = _maquinas.find(m => m.nome === maquinaNome);
    const unidPorCx = Math.max(1, Number(produto?.unid) || 1);
    const qntUnid = caixas * unidPorCx;
    const pcMin = _resolvePcMin(produto, maquina);
    // PEDIDO AO VIVO (comparação com o original encontrou isso como bug
    // silencioso): OP sem velocidade resolvida (pcMin<=0) nunca aparece no
    // Gantt/Insumos/Relatórios/Dashboard — todos usam buildProducaoSchedule,
    // que descarta esses registros sem aviso nenhum. Avisa aqui, no momento
    // de salvar, em vez de deixar o usuário descobrir sozinho depois.
    if (pcMin <= 0) global.showToast?.('⚠️ Produto sem velocidade cadastrada (nesta máquina nem no catálogo) — esta OP não vai aparecer no Gantt/Insumos/Relatórios até isso ser configurado.', 'error');
    const categoria = maquina?.categoria || '';
    const agora = new Date().toISOString();
    const docId = document.getElementById('pprog-doc-id').value || '';
    const payload = {
      produto: produto?.nome || '', prodCod, maquina: maquinaNome, pcMin, unidPorCx,
      qntCaixas: caixas, qntUnid, categoria, status, data, horaInicio, obs,
      // aliases do sistema de Produção original. Mantê-los evita quebrar
      // Gantt/relatórios/importações legadas durante a integração.
      dtSolicitacao: data, dtDesejada: data,
      configSnapshot: _buildConfigSnapshot(produto, maquina, pcMin, unidPorCx),
      atualizadoEm: agora, updatedAt: agora,
    };

    try {
      if (docId) {
        await fs().collection(COL_REGISTROS).doc(docId).set(payload, { merge: true });
      } else {
        payload.sortOrder = Date.now();
        payload.criadoEm = agora;
        await fs().collection(COL_REGISTROS).add(payload);
      }
      global.closeModal?.('modal-pprog');
      global.showToast?.('Ordem de produção salva.', 'success');
      await carregarProducaoProgramacao(true);
      _desenharProducaoProgramacao();
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  async function pprogExcluir(docId) {
    const item = _registros.find(r => r._firestoreId === docId);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_REGISTROS).doc(docId).delete();
        global.showToast?.('Ordem de produção excluída.', 'success');
        await carregarProducaoProgramacao(true);
        _desenharProducaoProgramacao();
      } catch (e) {
        global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error');
      }
    };
    if (global.showConfirm) global.showConfirm('Excluir a OP do produto "' + item.produto + '"?', executar, { title: 'Excluir ordem de produção', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir a OP do produto "' + item.produto + '"?')) await executar();
  }

  // PEDIDO AO VIVO (auditoria, item 4): "🗑 Limpar Tudo" (confirmClearAll no
  // original) — apaga TODAS as OPs cadastradas, não só a página filtrada.
  async function pprogLimparTudo() {
    if (!_registros.length) { global.showToast?.('Não há OPs cadastradas.', 'info'); return; }
    const executar = async () => {
      try {
        await Promise.all(_registros.map(r => fs().collection(COL_REGISTROS).doc(r._firestoreId).delete()));
        global.showToast?.('Todas as OPs foram excluídas.', 'success');
        await carregarProducaoProgramacao(true);
        _pagina = 1;
        _desenharProducaoProgramacao();
      } catch (e) { global.showToast?.('Erro ao limpar: ' + (e.message || e), 'error'); }
    };
    const msg = `Excluir TODAS as ${_registros.length} ordem(ns) de produção cadastradas? Essa ação não pode ser desfeita.`;
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Limpar toda a programação', icon: '🗑️', okLabel: 'Excluir tudo', okClass: 'btn-danger' });
    else if (confirm(msg)) await executar();
  }

  // PEDIDO AO VIVO (auditoria, item 4): "⬇ Template" — planilha modelo com
  // as colunas esperadas pela importação (mesmo padrão de download usado
  // em 71-producao-excel.js).
  function pprogTemplate() {
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    const wb = global.XLSX.utils.book_new();
    const ws = global.XLSX.utils.json_to_sheet([{ Produto: '', Maquina: '', Caixas: '', Data: '', Status: 'pendente' }]);
    global.XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
    global.XLSX.writeFile(wb, 'modelo_programacao_producao.xlsx');
  }

  // Import Excel — colunas esperadas: produto (nome ou código), maquina,
  // caixas, data (AAAA-MM-DD), status (opcional, default "pendente").
  // Sempre cria novas OPs (não há chave natural pra upsert numa OP).
  async function importarProgramacaoExcel(file) {
    if (!file) return;
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    try {
      await carregarProducaoProgramacao();
      const bytes = await file.arrayBuffer();
      const book = global.XLSX.read(bytes, { type: 'array', raw: false, cellText: true });
      const linhas = global.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
      const agora = new Date().toISOString();
      let criadas = 0, ignoradas = 0, semVelocidade = 0;

      for (const r of linhas) {
        const valorProduto = String(r.produto ?? r.cod ?? '').trim();
        if (!valorProduto) { ignoradas++; continue; }
        const produto = _produtos.find(p => String(p.cod) === valorProduto) || _produtos.find(p => String(p.nome).toLowerCase() === valorProduto.toLowerCase());
        const maquinaNome = String(r.maquina || '').trim();
        const maquina = _maquinas.find(m => m.nome === maquinaNome);
        const data = String(r.data || '').trim();
        if (!produto || !maquina || !data) { ignoradas++; continue; }
        const caixas = Math.max(1, Number(r.caixas) || 1);
        const unidPorCx = Math.max(1, Number(produto.unid) || 1);
        const pcMin = _resolvePcMin(produto, maquina);
        if (pcMin <= 0) semVelocidade++;
        await fs().collection(COL_REGISTROS).add({
          produto: produto.nome, prodCod: produto.cod, maquina: maquinaNome, pcMin, unidPorCx,
          qntCaixas: caixas, qntUnid: caixas * unidPorCx, categoria: maquina.categoria || '',
          status: String(r.status || 'pendente'), data, dtSolicitacao: data, dtDesejada: data, horaInicio: '', obs: '',
          configSnapshot: _buildConfigSnapshot(produto, maquina, pcMin, unidPorCx),
          sortOrder: Date.now(), criadoEm: agora, atualizadoEm: agora, updatedAt: agora,
        });
        criadas++;
      }
      // PEDIDO AO VIVO (comparação com o original encontrou isso como bug
      // silencioso): sem esse aviso, o toast dizia só "N OP(s) criada(s)" e
      // o usuário nunca saberia que parte delas nasceu sem velocidade —
      // some do Gantt/Insumos/Relatórios sem erro nenhum em lugar nenhum.
      global.showToast?.(criadas + ' OP(s) criada(s)' + (ignoradas ? ', ' + ignoradas + ' linha(s) ignorada(s) (produto/máquina/data não encontrados)' : '') + (semVelocidade ? ', ⚠️ ' + semVelocidade + ' sem velocidade cadastrada (não vão aparecer no Gantt/Insumos/Relatórios)' : '') + '.', semVelocidade ? 'error' : 'success');
      await carregarProducaoProgramacao(true);
      _desenharProducaoProgramacao();
    } catch (e) {
      global.showToast?.('Erro ao importar: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoProgramacao = renderProducaoProgramacao;
  global.migrarSnapshotsProgramacao = migrarSnapshotsProgramacao;
  global.buildProducaoConfigSnapshot = _buildConfigSnapshot;
  global.importarProgramacaoExcel = importarProgramacaoExcel;
  global._desenharProducaoProgramacao = _desenharProducaoProgramacao;
  global.pprogEditar = pprogEditar;
  global.pprogNovaOp = pprogNovaOp;
  global.pprogSalvar = pprogSalvar;
  global.pprogExcluir = pprogExcluir;
  global.carregarPCPSolicitacoes = carregarPCPSolicitacoes;
  global.pprogReceberPCP = pprogReceberPCP;
  global.pprogFinalizarPCP = pprogFinalizarPCP;

  // Tudo abaixo é gerado via innerHTML (tabela, filtros) — usa data-* +
  // escutador delegado em vez de onclick/oninput/onchange inline, mesma
  // correção obrigatória desde a Fase 2.
  document.addEventListener('click', function (event) {
    const novo = event.target.closest('[data-pprog-novo]');
    if (novo) { pprogNovaOp(); return; }
    const editar = event.target.closest('[data-pprog-editar]');
    if (editar) { pprogEditar(editar.getAttribute('data-pprog-editar')); return; }
    const excluir = event.target.closest('[data-pprog-excluir]');
    if (excluir) { pprogExcluir(excluir.getAttribute('data-pprog-excluir')); return; }
    const pg = event.target.closest('[data-pprog-pg]');
    if (pg) { pprogIrPara(Number(pg.getAttribute('data-pprog-pg'))); return; }
    const toggleInsumos = event.target.closest('[data-pprog-toggle-insumos]');
    if (toggleInsumos) { pprogToggleInsumos(toggleInsumos.getAttribute('data-pprog-toggle-insumos')); return; }
    const pcpRec = event.target.closest('[data-pprog-pcp-programar]');
    if (pcpRec) { pprogReceberPCP(pcpRec.getAttribute('data-pprog-pcp-programar')).catch(e => global.showToast?.(e.message || e, 'error')); return; }
    const pcpFin = event.target.closest('[data-pprog-pcp-finalizar]');
    if (pcpFin) { pprogFinalizarPCP(pcpFin.getAttribute('data-pprog-pcp-finalizar')).catch(e => global.showToast?.(e.message || e, 'error')); return; }
    const semNav = event.target.closest('[data-pprog-semana]');
    if (semNav) { const dir = Number(semNav.getAttribute('data-pprog-semana')); _semanaFiltro = _segundaDaSemana(_semanaFiltro || new Date()); _semanaFiltro.setDate(_semanaFiltro.getDate() + dir * 7); _pagina = 1; _desenharProducaoProgramacao(); return; }
    if (event.target.closest('[data-pprog-semana-reset]')) { _semanaFiltro = null; _pagina = 1; _desenharProducaoProgramacao(); return; }
    if (event.target.closest('[data-pprog-limpar-filtros]')) {
      const b = document.getElementById('pprog-busca'), m = document.getElementById('pprog-filtro-maquina'), s = document.getElementById('pprog-filtro-status');
      if (b) b.value = ''; if (m) m.value = ''; if (s) s.value = ''; _semanaFiltro = null; _pagina = 1; _desenharProducaoProgramacao(); return;
    }
    if (event.target.closest('[data-pprog-limpar-tudo]')) { pprogLimparTudo(); return; }
    if (event.target.closest('[data-pprog-template]')) { pprogTemplate(); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pprog-busca') { _pagina = 1; _desenharProducaoProgramacao(); }
  });
  document.addEventListener('change', function (event) {
    if (event.target && ['pprog-filtro-maquina', 'pprog-filtro-status'].includes(event.target.id)) { _pagina = 1; _desenharProducaoProgramacao(); return; }
    if (event.target && event.target.id === 'pprog-excel-input') {
      const file = event.target.files && event.target.files[0];
      importarProgramacaoExcel(file);
      event.target.value = '';
    }
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _registros=[]; _produtos=[]; _maquinas=[]; _fichas=[]; _pcpSolic=[]; _pcpSolicCarregado=false; _pagina=1; _expandidos.clear(); });
})(window);
