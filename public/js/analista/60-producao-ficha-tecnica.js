// Setor Produção — Ficha Técnica (fase 2 da unificação com o Sistema de
// Produção). Porta a lógica de renderFichaTecnica/getFichaTecnicaMerged do
// app.js original, adaptada pro Firestore compat do Inventário e carregada
// sob demanda (não no boot do app inteiro).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_PRODUTOS = 'producao_produtos';
  const COL_FICHAS = 'producao_ficha_tecnica';

  let _produtos = [];
  let _fichas = [];
  let _carregado = false;
  let _insumosEditando = [];
  let _lojasProdutoras = [];

  function fs() { return global.getDTFirestore(); }

  async function carregarProducaoDados(forcar) {
    if (_carregado && !forcar) return;
    const [snapProdutos, snapFichas] = await Promise.all([
      fs().collection(COL_PRODUTOS).get(),
      fs().collection(COL_FICHAS).get(),
    ]);
    _produtos = snapProdutos.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _fichas = snapFichas.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  // PCP (fase 4) — empresa produtora do produto: qual loja/unidade
  // fabrica este item, usada pelo PCP pra rotear a solicitação de
  // produção pra loja certa (ao invés de texto solto que não bate com
  // nenhum ID real de loja).
  async function _carregarLojasProdutoras() {
    try { _lojasProdutoras = (await global.DTLoja?.listar(false)) || []; }
    catch (e) { _lojasProdutoras = []; }
  }
  function _empresaProdutoraOpts(sel) {
    const opts = _lojasProdutoras.map(l => `<option value="${esc(l.id)}" ${String(sel) === String(l.id) ? 'selected' : ''}>${esc(l.nome || l.id)}</option>`).join('');
    return `<option value="">— Não definida —</option>${opts}`;
  }

  // Junta produtos + fichas — produto sem ficha ainda entra com insumos
  // vazios (mesma lógica do getFichaTecnicaMerged original).
  function getProducaoFichaTecnicaMerged() {
    const porCod = new Map();
    _fichas.forEach(f => porCod.set(String(f.cod), f));
    return _produtos.map(p => {
      const ficha = porCod.get(String(p.cod));
      if (ficha) return { ...p, ...ficha, desc: ficha.desc || p.nome || p.desc || '', categoria: ficha.categoria || p.categoria || '', classificacao: ficha.classificacao || p.classificacao || '', metaCoberturaDias: Number(ficha.metaCoberturaDias ?? p.metaCoberturaDias ?? p.coberturaDias) || 0, producaoMinima: Number(ficha.producaoMinima ?? p.producaoMinima) || 0, multiploProducao: Number(ficha.multiploProducao ?? p.multiploProducao) || 0, tipoMinimo: ficha.tipoMinimo || p.tipoMinimo || '', prioridadeProducao: Number(ficha.prioridadeProducao ?? p.prioridadeProducao) || 2, alergenico: ficha.alergenico === true || p.alergenico === true };
      return { cod: p.cod, desc: p.nome || p.desc || '', unid: p.unid || 1, pc_min: p.pc_min || 0, maquina: p.maquina || '', categoria: p.categoria || '', classificacao: p.classificacao || '', metaCoberturaDias: Number(p.metaCoberturaDias ?? p.coberturaDias) || 0, producaoMinima: Number(p.producaoMinima) || 0, multiploProducao: Number(p.multiploProducao) || 0, tipoMinimo: p.tipoMinimo || '', prioridadeProducao: Number(p.prioridadeProducao) || 2, alergenico: p.alergenico === true, empresaProdutoraId: p.empresaProdutoraId || '', empresaProdutoraNome: p.empresaProdutoraNome || '', insumos: [], _semFicha: true, _produtoId: p._firestoreId };
    });
  }

  let _containerFicha = 'page-producao-ficha-tecnica';
  async function renderProducaoFichaTecnica(containerId) {
    _containerFicha = containerId || 'page-producao-ficha-tecnica';
    const pagina = document.getElementById(_containerFicha);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoDados(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoFichaTecnica();
  }

  function _desenharProducaoFichaTecnica() {
    const pagina = document.getElementById(_containerFicha);
    if (!pagina) return;
    const busca = String(document.getElementById('pft-busca')?.value || '').trim().toLowerCase();
    const linhas = getProducaoFichaTecnicaMerged()
      .filter(f => !busca || String(f.cod).includes(busca) || String(f.desc || '').toLowerCase().includes(busca))
      .sort((a, b) => String(a.cod).localeCompare(String(b.cod), 'pt-BR', { numeric: true }));

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.35rem">📦 Produtos & Ficha Técnica</div><div style="font-size:.78rem;color:var(--muted);margin-top:3px">Cadastro produtivo, cobertura, máquinas, velocidades e composição de insumos</div>
          <div style="font-size:.72rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} produto(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pft-busca" placeholder="Buscar código ou descrição..." value="${esc(busca)}" class="field" style="min-width:220px">
          <button type="button" class="btn btn-primary btn-sm" data-pft-novo="1">+ Novo Produto</button><button type="button" class="btn btn-ghost btn-sm" onclick="goPage('producao-maquinas',document.getElementById('nav-producao-maquinas'))">🏭 Máquinas</button><button type="button" class="btn btn-ghost btn-sm" onclick="goPage('producao-setup',document.getElementById('nav-producao-setup'))">🔧 Setup</button><button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger,#c0392b)" data-pft-apagar-tudo="1">🗑️ Apagar tudo</button>
        </div>
      </div>
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Cód.</th><th>Descrição</th><th>Unid/Cx</th><th>Peças/min</th><th>Máquina</th><th>Insumos</th><th></th></tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(f => `
                <tr>
                  <td class="mono">${esc(f.cod)}</td>
                  <td><b>${esc(f.desc)}</b>${f._semFicha ? ' <span class="badge b-yellow" style="font-size:.6rem">sem ficha</span>' : ''}</td>
                  <td>${esc(f.unid)}</td>
                  <td>${esc(f.pc_min)}</td>
                  <td>${esc(f.maquina)}</td>
                  <td style="font-size:.75rem;color:var(--muted)">${(f.insumos || []).length ? (f.insumos || []).map(i => esc(i.insumo) + ' (' + esc(i.qty) + ')').join(', ') : '—'}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button type="button" class="acao-lapis" title="Editar" data-pft-editar="${esc(f.cod)}">✏️</button>
                    ${f._semFicha ? '' : `<button type="button" class="acao-lapis" title="Excluir ficha" data-pft-excluir="${esc(f.cod)}">🗑️</button>`}
                  </td>
                </tr>`).join('') : `<tr><td colspan="7"><div class="empty"><div class="empty-icon">🏭</div><div class="empty-title">Nenhum produto cadastrado</div><div class="empty-sub">Clique em "+ Novo Produto" pra começar</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // PEDIDO AO VIVO (auditoria 2ª rodada, seção 14/15): no original,
  // "Cadastro de Produtos" (scontent-produtos, index.html:1143-1168) e
  // "Ficha Técnica" (scontent-ficha-tecnica-cfg, index.html:1123-1140)
  // são DUAS telas diferentes — Produtos é o CRUD completo (+Adicionar/
  // Importar/Exportar/Limpar), Ficha Técnica é só uma LISTA DE CONSULTA,
  // somente leitura ("Gerada automaticamente ao importar produtos" —
  // texto literal do original), sem nenhum botão de edição. Aqui as duas
  // rotas apontavam pra mesma função/tela; esta é a versão somente
  // leitura, reaproveitando os mesmos dados (getProducaoFichaTecnicaMerged)
  // sem duplicar a fonte de verdade.
  let _containerFichaRO = 'page-producao-ficha-tecnica';
  let _fichaROBusca = '';
  async function renderProducaoFichaTecnicaSomenteLeitura(containerId) {
    _containerFichaRO = containerId || 'page-producao-ficha-tecnica';
    const pagina = document.getElementById(_containerFichaRO);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoDados(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharFichaTecnicaSomenteLeitura();
  }
  function _desenharFichaTecnicaSomenteLeitura() {
    const pagina = document.getElementById(_containerFichaRO);
    if (!pagina) return;
    const busca = _fichaROBusca.trim().toLowerCase();
    const linhas = getProducaoFichaTecnicaMerged()
      .filter(f => !busca || String(f.cod).includes(busca) || String(f.desc || '').toLowerCase().includes(busca))
      .sort((a, b) => String(a.cod).localeCompare(String(b.cod), 'pt-BR', { numeric: true }));
    pagina.innerHTML = `
      <div class="tc" style="padding:0;overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:700">🏭 Ficha Técnica de Produtos</span>
            <span style="font-size:.72rem;color:var(--muted)">(${linhas.length.toLocaleString('pt-BR')} produtos)</span>
          </div>
          <span style="font-size:.68rem;color:var(--muted)">Gerada automaticamente ao importar produtos</span>
        </div>
        <div style="padding:8px 12px;border-bottom:1px solid var(--border)">
          <input id="pftro-busca" class="field" placeholder="Filtrar por código ou descrição..." value="${esc(_fichaROBusca)}" style="width:100%">
        </div>
        <div style="max-height:520px;overflow-y:auto">
          <table class="dt-table">
            <thead><tr><th>Cód.</th><th>Descrição</th><th>Unid/Cx</th><th>Peças/min</th><th>Máquina</th><th>Insumos</th></tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(f => `
                <tr>
                  <td class="mono">${esc(f.cod)}</td>
                  <td><b>${esc(f.desc)}</b>${f._semFicha ? ' <span class="badge b-yellow" style="font-size:.6rem">sem ficha</span>' : ''}</td>
                  <td>${esc(f.unid)}</td>
                  <td>${esc(f.pc_min)}</td>
                  <td>${esc(f.maquina)}</td>
                  <td style="font-size:.75rem;color:var(--muted)">${(f.insumos || []).length ? (f.insumos || []).map(i => esc(i.insumo) + ' (' + esc(i.qty) + ')').join(', ') : '—'}</td>
                </tr>`).join('') : `<tr><td colspan="6"><div class="empty"><div class="empty-icon">🏭</div><div class="empty-title">Nenhuma ficha técnica encontrada</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  }
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'pftro-busca') { _fichaROBusca = e.target.value || ''; _desenharFichaTecnicaSomenteLeitura(); const el = document.getElementById('pftro-busca'); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} } }
  });

  async function _abrirModalPft(item) {
    document.getElementById('pft-title').textContent = item._novo ? 'Novo produto' : 'Editar ficha técnica';
    document.getElementById('pft-doc-id').value = item._firestoreId || '';
    document.getElementById('pft-cod').value = item.cod ?? '';
    document.getElementById('pft-cod').disabled = !item._novo;
    document.getElementById('pft-desc').value = item.desc || '';
    document.getElementById('pft-unid').value = item.unid || 1;
    document.getElementById('pft-pcmin').value = item.pc_min || 0;
    document.getElementById('pft-maquina').value = item.maquina || '';
    document.getElementById('pft-categoria').value = item.categoria || '';
    document.getElementById('pft-classificacao').value = item.classificacao || '';
    document.getElementById('pft-cobertura').value = item.metaCoberturaDias || item.coberturaDias || '';
    document.getElementById('pft-prod-min').value = item.producaoMinima || '';
    document.getElementById('pft-multiplo').value = item.multiploProducao || '';
    document.getElementById('pft-tipo-min').value = item.tipoMinimo || '';
    document.getElementById('pft-prioridade').value = item.prioridadeProducao || 2;
    document.getElementById('pft-alergenico').value = item.alergenico === true ? 'true' : 'false';
    await _carregarLojasProdutoras();
    const selEmpresa = document.getElementById('pft-empresa-produtora');
    if (selEmpresa) { selEmpresa.innerHTML = _empresaProdutoraOpts(item.empresaProdutoraId || ''); }
    _insumosEditando = (item.insumos || []).map(i => ({ insumo: i.insumo || '', qty: i.qty || 0, categoria: i.categoria || '' }));
    _redesenharInsumosEditando();
    global.openModal?.('modal-pft');
  }

  function _redesenharInsumosEditando() {
    const wrap = document.getElementById('pft-insumos-list');
    if (!wrap) return;
    wrap.innerHTML = _insumosEditando.map((ins, i) => `
      <div style="display:flex;gap:6px;align-items:center">
        <input class="field" style="flex:2" placeholder="Insumo" value="${esc(ins.insumo)}" data-pft-campo="insumo" data-pft-idx="${i}">
        <input class="field" style="flex:1" type="number" step="any" min="0" placeholder="Qtd/caixa" value="${esc(ins.qty)}" data-pft-campo="qty" data-pft-idx="${i}">
        <input class="field" style="flex:1" placeholder="Categoria (opcional)" value="${esc(ins.categoria || '')}" data-pft-campo="categoria" data-pft-idx="${i}">
        <button type="button" class="btn btn-ghost btn-sm" data-pft-remover-insumo="${i}">✕</button>
      </div>`).join('') || '<div style="font-size:.75rem;color:var(--muted)">Nenhum insumo ainda.</div>';
  }

  function pftInsumoAlterado(i, campo, valor) {
    if (!_insumosEditando[i]) return;
    _insumosEditando[i][campo] = campo === 'qty' ? (parseFloat(String(valor).replace(',', '.')) || 0) : valor;
  }
  function pftAdicionarInsumo() { _insumosEditando.push({ insumo: '', qty: 0, categoria: '' }); _redesenharInsumosEditando(); }
  function pftRemoverInsumo(i) { _insumosEditando.splice(i, 1); _redesenharInsumosEditando(); }

  function pftEditar(cod) {
    const item = getProducaoFichaTecnicaMerged().find(f => String(f.cod) === String(cod));
    if (!item) return;
    _abrirModalPft(item);
  }

  function pftNovoProduto() {
    _abrirModalPft({ _novo: true, cod: '', desc: '', unid: 1, pc_min: 0, maquina: '', categoria: '', classificacao: '', metaCoberturaDias: 0, producaoMinima: 0, multiploProducao: 0, tipoMinimo: '', prioridadeProducao: 2, alergenico: false, insumos: [] });
  }

  async function _pftSincronizarProdutoNaMaquina(nomeMaquina, nomeProduto, velocidade) {
    if (!nomeMaquina || !nomeProduto) return;
    try {
      const snap = await fs().collection('producao_maquinas').where('nome', '==', nomeMaquina).limit(1).get();
      if (snap.empty) return;
      const doc = snap.docs[0];
      const dados = doc.data() || {};
      const lista = Array.isArray(dados.produtosCompativeis) ? dados.produtosCompativeis.slice() : [];
      const idx = lista.findIndex(p => String(p?.produto || '').trim().toLowerCase() === nomeProduto.trim().toLowerCase());
      const item = { produto: nomeProduto, velocidade: Number(velocidade) || 0 };
      if (idx >= 0) lista[idx] = { ...lista[idx], ...item };
      else lista.push(item);
      await fs().collection('producao_maquinas').doc(doc.id).set({ produtosCompativeis: lista, atualizadoEm: new Date().toISOString() }, { merge: true });
    } catch (e) {
      console.warn('[PRODUCAO][FICHA] Falha ao sincronizar produto na máquina:', e);
    }
  }

  async function pftSalvar() {
    const cod = String(document.getElementById('pft-cod').value || '').trim();
    const desc = String(document.getElementById('pft-desc').value || '').trim();
    if (!cod || !desc) { global.showToast?.('Informe código e descrição.', 'error'); return; }
    const unid = Math.max(1, Number(document.getElementById('pft-unid').value) || 1);
    const pc_min = Math.max(0, Number(document.getElementById('pft-pcmin').value) || 0);
    const maquina = String(document.getElementById('pft-maquina').value || '').trim();
    const categoria = String(document.getElementById('pft-categoria').value || '').trim();
    const classificacao = String(document.getElementById('pft-classificacao').value || '').trim();
    const metaCoberturaDias = Math.max(0, Number(document.getElementById('pft-cobertura').value) || 0);
    const producaoMinima = Math.max(0, Number(document.getElementById('pft-prod-min').value) || 0);
    const multiploProducao = Math.max(0, Number(document.getElementById('pft-multiplo').value) || 0);
    const tipoMinimo = String(document.getElementById('pft-tipo-min').value || '');
    const prioridadeProducao = Math.min(99, Math.max(1, Number(document.getElementById('pft-prioridade').value) || 2));
    const alergenico = document.getElementById('pft-alergenico').value === 'true';
    const empresaProdutoraId = String(document.getElementById('pft-empresa-produtora')?.value || '');
    const empresaProdutoraNome = empresaProdutoraId ? String(document.getElementById('pft-empresa-produtora')?.selectedOptions?.[0]?.textContent || '') : '';
    const insumos = _insumosEditando.filter(i => i.insumo);
    const agora = new Date().toISOString();
    const docIdFicha = document.getElementById('pft-doc-id').value || '';

    try {
      // Compatibilidade com o modelo da Produção original: além dos campos
      // usados pelo módulo integrado, persistimos os aliases que programação,
      // Gantt/importadores antigos esperam (descricao/velocidadePadrao/maquinaPadrao).
      // A Produção original permite o mesmo código em máquinas diferentes, então
      // a identidade do produto é código + máquina, e não apenas o código.
      const produtoExistente = _produtos.find(p => String(p.cod) === cod && String(p.maquina || p.maquinaPadrao || '') === maquina)
        || _produtos.find(p => String(p.cod) === cod && !String(p.maquina || p.maquinaPadrao || ''));
      const payloadProduto = {
        cod, nome: desc, descricao: desc, unid,
        pc_min, velocidadePadrao: pc_min,
        maquina, maquinaPadrao: maquina,
        categoria, classificacao,
        metaCoberturaDias, producaoMinima, multiploProducao, tipoMinimo, prioridadeProducao,
        alergenico, produtoAtivo: true,
        empresaProdutoraId, empresaProdutoraNome, ativo: true, atualizadoEm: agora
      };
      if (produtoExistente) {
        await fs().collection(COL_PRODUTOS).doc(produtoExistente._firestoreId).set(payloadProduto, { merge: true });
      } else {
        payloadProduto.criadoEm = agora;
        await fs().collection(COL_PRODUTOS).add(payloadProduto);
      }
      // Mantém o vínculo bidirecional Produto <-> Máquina existente no projeto
      // de Produção de referência. Sem isso a máquina pode ser cadastrada, mas
      // programação automática e seleção de compatibilidade ficam divergentes.
      await _pftSincronizarProdutoNaMaquina(maquina, desc, pc_min);

      const payloadFicha = { cod, desc, unid, pc_min, maquina, categoria, classificacao, metaCoberturaDias, producaoMinima, multiploProducao, tipoMinimo, prioridadeProducao, alergenico, insumos, atualizadoEm: agora };
      const fichaExistente = _fichas.find(f => String(f.cod) === cod);
      if (fichaExistente) {
        await fs().collection(COL_FICHAS).doc(fichaExistente._firestoreId).set(payloadFicha, { merge: true });
      } else {
        payloadFicha.criadoEm = agora;
        await fs().collection(COL_FICHAS).add(payloadFicha);
      }

      global.closeModal?.('modal-pft');
      global.showToast?.('Ficha técnica salva.', 'success');
      await carregarProducaoDados(true);
      _desenharProducaoFichaTecnica();
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  async function pftExcluir(cod) {
    const ficha = _fichas.find(f => String(f.cod) === String(cod));
    if (!ficha) return;
    const executar = async () => {
      try {
        await fs().collection(COL_FICHAS).doc(ficha._firestoreId).delete();
        global.showToast?.('Ficha excluída.', 'success');
        await carregarProducaoDados(true);
        _desenharProducaoFichaTecnica();
      } catch (e) {
        global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error');
      }
    };
    if (global.showConfirm) global.showConfirm('Excluir a ficha técnica do produto ' + cod + '?', executar, { title: 'Excluir ficha técnica', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir a ficha técnica do produto ' + cod + '?')) await executar();
  }

  // Apaga TUDO — produtos e fichas técnicas, sem distinguir origem (manual,
  // Excel ou Bluesoft). Ferramenta de reset explícito pedida pra zerar a
  // base de uma vez e recomeçar (via template Excel ou sincronização
  // Bluesoft), não uma limpeza seletiva como as de 90-bluesoft-service.js —
  // por isso exige o usuário digitar a confirmação, em vez de só um OK/Cancelar.
  async function pftApagarTudo() {
    await carregarProducaoDados(true);
    const totalProdutos = _produtos.length, totalFichas = _fichas.length;
    if (!totalProdutos && !totalFichas) { global.showToast?.('Nada para apagar — a base já está vazia.', 'success'); return; }
    const digitado = prompt('Isso vai apagar TODOS os ' + totalProdutos.toLocaleString('pt-BR') + ' produto(s) e ' + totalFichas.toLocaleString('pt-BR') + ' ficha(s) técnica(s) cadastrados — incluindo máquina, insumos e parâmetros de PCP configurados manualmente. Essa ação NÃO pode ser desfeita.\n\nDigite APAGAR TUDO para confirmar:');
    if (digitado !== 'APAGAR TUDO') { if (digitado != null) global.showToast?.('Texto não confere — nada foi apagado.', 'warning'); return; }
    try {
      const rawFs = global.getDTRawFirestore();
      const idsProdutos = _produtos.map(p => p._firestoreId);
      const idsFichas = _fichas.map(f => f._firestoreId);
      for (let i = 0; i < idsProdutos.length; i += 300) {
        const batch = rawFs.batch();
        idsProdutos.slice(i, i + 300).forEach(id => batch.delete(fs().collection(COL_PRODUTOS).doc(id)));
        await batch.commit();
      }
      for (let i = 0; i < idsFichas.length; i += 300) {
        const batch = rawFs.batch();
        idsFichas.slice(i, i + 300).forEach(id => batch.delete(fs().collection(COL_FICHAS).doc(id)));
        await batch.commit();
      }
      await carregarProducaoDados(true);
      _desenharProducaoFichaTecnica();
      global.showToast?.('Apagado: ' + totalProdutos.toLocaleString('pt-BR') + ' produto(s) e ' + totalFichas.toLocaleString('pt-BR') + ' ficha(s) técnica(s).', 'success');
    } catch (e) {
      global.showToast?.('Erro ao apagar tudo: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoFichaTecnica = renderProducaoFichaTecnica;
  global.renderProducaoFichaTecnicaSomenteLeitura = renderProducaoFichaTecnicaSomenteLeitura;
  global._desenharProducaoFichaTecnica = _desenharProducaoFichaTecnica;
  global.pftAdicionarInsumo = pftAdicionarInsumo;
  global.pftRemoverInsumo = pftRemoverInsumo;
  global.pftInsumoAlterado = pftInsumoAlterado;
  global.pftEditar = pftEditar;
  global.pftNovoProduto = pftNovoProduto;
  global.pftSalvar = pftSalvar;
  global.pftExcluir = pftExcluir;
  global.pftApagarTudo = pftApagarTudo;

  // Tudo abaixo é gerado via innerHTML (tabela, linhas de insumo) — usa
  // data-* + escutador delegado em vez de onclick/oninput/onchange inline,
  // que não dispara de forma confiável quando injetado dinamicamente.
  document.addEventListener('click', function (event) {
    const novo = event.target.closest('[data-pft-novo]');
    if (novo) { pftNovoProduto(); return; }
    const editar = event.target.closest('[data-pft-editar]');
    if (editar) { pftEditar(editar.getAttribute('data-pft-editar')); return; }
    const excluir = event.target.closest('[data-pft-excluir]');
    if (excluir) { pftExcluir(excluir.getAttribute('data-pft-excluir')); return; }
    const remover = event.target.closest('[data-pft-remover-insumo]');
    if (remover) { pftRemoverInsumo(Number(remover.getAttribute('data-pft-remover-insumo'))); return; }
    const apagarTudo = event.target.closest('[data-pft-apagar-tudo]');
    if (apagarTudo) { pftApagarTudo(); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pft-busca') _desenharProducaoFichaTecnica();
  });
  document.addEventListener('change', function (event) {
    const campo = event.target.closest('[data-pft-campo]');
    if (campo) pftInsumoAlterado(Number(campo.getAttribute('data-pft-idx')), campo.getAttribute('data-pft-campo'), campo.value);
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _produtos=[]; _fichas=[]; _insumosEditando=[]; _lojasProdutoras=[]; });
})(window);
