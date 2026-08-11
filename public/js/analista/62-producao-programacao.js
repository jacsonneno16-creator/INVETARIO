// Setor Produção — Programação (fase 3b da unificação com o Sistema de
// Produção). Porta só a LISTA/CADASTRO de Ordens de Produção (CRUD puro),
// sem o Gantt visual nem o motor buildSchedule (rateio diário por turno) —
// esses ficam pra fases futuras. Tempo estimado e insumos são calculados
// on-the-fly a partir de Ficha Técnica/Máquinas já portadas, lendo sempre o
// dado atual (sem congelar snapshot histórico — simplificação deliberada
// desta fase).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_REGISTROS = 'producao_registros';
  const COL_PRODUTOS = 'producao_produtos';
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_FICHAS = 'producao_ficha_tecnica';

  const PAGE_SIZE = 15;

  let _registros = [];
  let _produtos = [];
  let _maquinas = [];
  let _fichas = [];
  let _carregado = false;
  let _pagina = 1;
  const _expandidos = new Set();

  function fs() { return global.getDTFirestore(); }

  async function carregarProducaoProgramacao(forcar) {
    if (_carregado && !forcar) return;
    const [snapReg, snapProd, snapMaq, snapFicha] = await Promise.all([
      fs().collection(COL_REGISTROS).get(),
      fs().collection(COL_PRODUTOS).get(),
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_FICHAS).get(),
    ]);
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _produtos = snapProd.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _fichas = snapFicha.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  const STATUS_INFO = {
    pendente: { label: 'Pendente', cor: 'b-orange' },
    em_andamento: { label: 'Em andamento', cor: 'b-blue' },
    concluido: { label: 'Concluído', cor: 'b-green' },
  };

  function _insumosDoProduto(prodCod) {
    const ficha = _fichas.find(f => String(f.cod) === String(prodCod));
    return (ficha && ficha.insumos) || [];
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

  async function renderProducaoProgramacao() {
    const pagina = document.getElementById('page-producao-programacao');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoProgramacao(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoProgramacao();
  }

  function _desenharProducaoProgramacao() {
    const pagina = document.getElementById('page-producao-programacao');
    if (!pagina) return;
    const busca = String(document.getElementById('pprog-busca')?.value || '').trim().toLowerCase();
    const filtroMaquina = String(document.getElementById('pprog-filtro-maquina')?.value || '');
    const filtroStatus = String(document.getElementById('pprog-filtro-status')?.value || '');
    const filtroDe = String(document.getElementById('pprog-filtro-de')?.value || '');
    const filtroAte = String(document.getElementById('pprog-filtro-ate')?.value || '');

    const linhasFiltradas = _registros
      .filter(r => !busca || String(r.produto || '').toLowerCase().includes(busca))
      .filter(r => !filtroMaquina || r.maquina === filtroMaquina)
      .filter(r => !filtroStatus || r.status === filtroStatus)
      .filter(r => !filtroDe || String(r.data || '') >= filtroDe)
      .filter(r => !filtroAte || String(r.data || '') <= filtroAte)
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
          <input id="pprog-filtro-de" type="date" class="field" title="Data de" value="${esc(filtroDe)}" style="max-width:135px">
          <input id="pprog-filtro-ate" type="date" class="field" title="Data até" value="${esc(filtroAte)}" style="max-width:135px">
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">📥 Excel<input type="file" id="pprog-excel-input" accept=".xlsx,.xls" style="display:none"></label>
          <button type="button" class="btn btn-primary btn-sm" data-pprog-novo="1">+ Nova OP</button>
        </div>
      </div>
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Produto</th><th>Máquina</th><th>Caixas</th><th>Unidades</th><th>Tempo est.</th><th>Data</th><th>Status</th><th>Insumos</th><th></th></tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(r => {
                const status = STATUS_INFO[r.status] || STATUS_INFO.pendente;
                const tempo = _calcTempoHoras(r.qntUnid, r.pcMin);
                const insumos = _insumosDoProduto(r.prodCod);
                const expandido = _expandidos.has(r._firestoreId);
                return `
                <tr>
                  <td><b>${esc(r.produto)}</b></td>
                  <td>${esc(r.maquina)}</td>
                  <td>${esc(r.qntCaixas)}</td>
                  <td>${esc(r.qntUnid)}</td>
                  <td>${tempo != null ? tempo.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'h' : '—'}</td>
                  <td>${esc(r.data)}</td>
                  <td><span class="badge ${status.cor}">${status.label}</span></td>
                  <td style="font-size:.75rem;color:var(--muted);cursor:${insumos.length ? 'pointer' : 'default'}" ${insumos.length ? `data-pprog-toggle-insumos="${esc(r._firestoreId)}"` : ''}>${insumos.length ? (expandido ? '▲ ' : '▼ ') + insumos.length + ' insumo(s)' : '—'}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button type="button" class="acao-lapis" title="Editar" data-pprog-editar="${esc(r._firestoreId)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-pprog-excluir="${esc(r._firestoreId)}">🗑️</button>
                  </td>
                </tr>
                ${expandido ? `<tr><td colspan="9" style="background:var(--surface-2);padding:8px 16px">
                  <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:.74rem">
                    ${insumos.map(i => `<div><b>${esc(i.insumo)}</b>: ${((Number(i.qty) || 0) * (Number(r.qntCaixas) || 0)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} (${esc(i.qty)}/cx × ${esc(r.qntCaixas)}cx)</div>`).join('')}
                  </div>
                </td></tr>` : ''}`;
              }).join('') : `<tr><td colspan="9"><div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma ordem de produção cadastrada</div><div class="empty-sub">Clique em "+ Nova OP" pra começar</div></div></td></tr>`}
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
    const categoria = maquina?.categoria || '';
    const agora = new Date().toISOString();
    const docId = document.getElementById('pprog-doc-id').value || '';
    const payload = {
      produto: produto?.nome || '', prodCod, maquina: maquinaNome, pcMin, unidPorCx,
      qntCaixas: caixas, qntUnid, categoria, status, data, horaInicio, obs,
      atualizadoEm: agora,
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
      let criadas = 0, ignoradas = 0;

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
        await fs().collection(COL_REGISTROS).add({
          produto: produto.nome, prodCod: produto.cod, maquina: maquinaNome, pcMin: _resolvePcMin(produto, maquina), unidPorCx,
          qntCaixas: caixas, qntUnid: caixas * unidPorCx, categoria: maquina.categoria || '',
          status: String(r.status || 'pendente'), data, horaInicio: '', obs: '',
          sortOrder: Date.now(), criadoEm: agora, atualizadoEm: agora,
        });
        criadas++;
      }
      global.showToast?.(criadas + ' OP(s) criada(s)' + (ignoradas ? ', ' + ignoradas + ' linha(s) ignorada(s) (produto/máquina/data não encontrados)' : '') + '.', 'success');
      await carregarProducaoProgramacao(true);
      _desenharProducaoProgramacao();
    } catch (e) {
      global.showToast?.('Erro ao importar: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoProgramacao = renderProducaoProgramacao;
  global.importarProgramacaoExcel = importarProgramacaoExcel;
  global._desenharProducaoProgramacao = _desenharProducaoProgramacao;
  global.pprogEditar = pprogEditar;
  global.pprogNovaOp = pprogNovaOp;
  global.pprogSalvar = pprogSalvar;
  global.pprogExcluir = pprogExcluir;

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
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pprog-busca') { _pagina = 1; _desenharProducaoProgramacao(); }
  });
  document.addEventListener('change', function (event) {
    if (event.target && ['pprog-filtro-maquina', 'pprog-filtro-status', 'pprog-filtro-de', 'pprog-filtro-ate'].includes(event.target.id)) { _pagina = 1; _desenharProducaoProgramacao(); return; }
    if (event.target && event.target.id === 'pprog-excel-input') {
      const file = event.target.files && event.target.files[0];
      importarProgramacaoExcel(file);
      event.target.value = '';
    }
  });
})(window);
