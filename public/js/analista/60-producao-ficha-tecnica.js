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

  // Junta produtos + fichas — produto sem ficha ainda entra com insumos
  // vazios (mesma lógica do getFichaTecnicaMerged original).
  function getProducaoFichaTecnicaMerged() {
    const porCod = new Map();
    _fichas.forEach(f => porCod.set(String(f.cod), f));
    return _produtos.map(p => {
      const ficha = porCod.get(String(p.cod));
      if (ficha) return ficha;
      return { cod: p.cod, desc: p.nome || p.desc || '', unid: p.unid || 1, pc_min: p.pc_min || 0, maquina: p.maquina || '', insumos: [], _semFicha: true, _produtoId: p._firestoreId };
    });
  }

  async function renderProducaoFichaTecnica() {
    const pagina = document.getElementById('page-producao-ficha-tecnica');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoDados(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoFichaTecnica();
  }

  function _desenharProducaoFichaTecnica() {
    const pagina = document.getElementById('page-producao-ficha-tecnica');
    if (!pagina) return;
    const busca = String(document.getElementById('pft-busca')?.value || '').trim().toLowerCase();
    const linhas = getProducaoFichaTecnicaMerged()
      .filter(f => !busca || String(f.cod).includes(busca) || String(f.desc || '').toLowerCase().includes(busca))
      .sort((a, b) => String(a.cod).localeCompare(String(b.cod), 'pt-BR', { numeric: true }));

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">🏭 Ficha Técnica</div>
          <div style="font-size:.72rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} produto(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pft-busca" placeholder="Buscar código ou descrição..." value="${esc(busca)}" class="field" style="min-width:220px">
          <button type="button" class="btn btn-primary btn-sm" data-pft-novo="1">+ Novo Produto</button>
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

  function _abrirModalPft(item) {
    document.getElementById('pft-title').textContent = item._novo ? 'Novo produto' : 'Editar ficha técnica';
    document.getElementById('pft-doc-id').value = item._firestoreId || '';
    document.getElementById('pft-cod').value = item.cod ?? '';
    document.getElementById('pft-cod').disabled = !item._novo;
    document.getElementById('pft-desc').value = item.desc || '';
    document.getElementById('pft-unid').value = item.unid || 1;
    document.getElementById('pft-pcmin').value = item.pc_min || 0;
    document.getElementById('pft-maquina').value = item.maquina || '';
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
    _abrirModalPft({ _novo: true, cod: '', desc: '', unid: 1, pc_min: 0, maquina: '', insumos: [] });
  }

  async function pftSalvar() {
    const cod = String(document.getElementById('pft-cod').value || '').trim();
    const desc = String(document.getElementById('pft-desc').value || '').trim();
    if (!cod || !desc) { global.showToast?.('Informe código e descrição.', 'error'); return; }
    const unid = Math.max(1, Number(document.getElementById('pft-unid').value) || 1);
    const pc_min = Math.max(0, Number(document.getElementById('pft-pcmin').value) || 0);
    const maquina = String(document.getElementById('pft-maquina').value || '').trim();
    const insumos = _insumosEditando.filter(i => i.insumo);
    const agora = new Date().toISOString();
    const docIdFicha = document.getElementById('pft-doc-id').value || '';

    try {
      const produtoExistente = _produtos.find(p => String(p.cod) === cod);
      const payloadProduto = { cod, nome: desc, unid, pc_min, maquina, ativo: true, atualizadoEm: agora };
      if (produtoExistente) {
        await fs().collection(COL_PRODUTOS).doc(produtoExistente._firestoreId).set(payloadProduto, { merge: true });
      } else {
        payloadProduto.criadoEm = agora;
        await fs().collection(COL_PRODUTOS).add(payloadProduto);
      }

      const payloadFicha = { cod, desc, unid, pc_min, maquina, insumos, atualizadoEm: agora };
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

  global.renderProducaoFichaTecnica = renderProducaoFichaTecnica;
  global._desenharProducaoFichaTecnica = _desenharProducaoFichaTecnica;
  global.pftAdicionarInsumo = pftAdicionarInsumo;
  global.pftRemoverInsumo = pftRemoverInsumo;
  global.pftInsumoAlterado = pftInsumoAlterado;
  global.pftEditar = pftEditar;
  global.pftNovoProduto = pftNovoProduto;
  global.pftSalvar = pftSalvar;
  global.pftExcluir = pftExcluir;

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
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pft-busca') _desenharProducaoFichaTecnica();
  });
  document.addEventListener('change', function (event) {
    const campo = event.target.closest('[data-pft-campo]');
    if (campo) pftInsumoAlterado(Number(campo.getAttribute('data-pft-idx')), campo.getAttribute('data-pft-campo'), campo.value);
  });
})(window);
