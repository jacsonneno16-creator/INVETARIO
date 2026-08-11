// Setor Produção — Projeção de Vendas (fase 3d da unificação com o Sistema
// de Produção). Entrada manual por produto (venda dos últimos 3 meses, em
// caixas) + estoque atual opcional, pra calcular cobertura e risco de
// ruptura. Simplificação deliberada: só média simples dos 3 meses (a
// original tinha também média ponderada e um modo "manual" via dropdown —
// não essencial pra validar o cálculo). Firestore-backed (a original era só
// localStorage, sem sincronizar entre usuários — mesma correção já aplicada
// em Turnos na fase 3c).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_PROJECAO = 'producao_projecao';

  let _projecao = [];
  let _carregado = false;

  function fs() { return global.getDTFirestore(); }

  async function carregarProducaoProjecao(forcar) {
    if (_carregado && !forcar) return;
    const snap = await fs().collection(COL_PROJECAO).get();
    _projecao = snap.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  // Reusada pela Programação Automática (fase 3d) pra decidir o que sugerir.
  // metodo: 'simples' (média dos 3 meses) ou 'ponderada' (peso maior pro mês
  // mais recente, m3) — mesmas duas opções reais da original (a original
  // também tinha um 3º modo "manual" que não é necessário aqui, já que a
  // tela já é 100% CRUD manual por natureza).
  function calcularProjecaoComRisco(metodo) {
    return _projecao.map(p => {
      const m1 = Number(p.venda_m1) || 0, m2 = Number(p.venda_m2) || 0, m3 = Number(p.venda_m3) || 0;
      const projMensal = metodo === 'ponderada' ? (m1 * 1 + m2 * 2 + m3 * 3) / 6 : (m1 + m2 + m3) / 3;
      const projSemanal = projMensal / 4.33;
      const estoque = Number(p.estoqueAtual) || 0;
      const coberturaDias = projSemanal > 0 ? (estoque / projSemanal) * 7 : null;
      let risco = 'nd';
      if (coberturaDias != null) {
        risco = coberturaDias <= 3 ? 'critico' : coberturaDias <= 7 ? 'alto' : coberturaDias <= 14 ? 'medio' : 'ok';
      }
      return { ...p, projMensal, projSemanal, coberturaDias, risco };
    });
  }

  const RISCO_INFO = {
    critico: { label: 'Crítico', cor: 'b-red' },
    alto: { label: 'Alto', cor: 'b-orange' },
    medio: { label: 'Médio', cor: 'b-yellow' },
    ok: { label: 'OK', cor: 'b-green' },
    nd: { label: 'Sem dados', cor: 'b-gray' },
  };

  async function renderProducaoProjecao() {
    const pagina = document.getElementById('page-producao-projecao');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoProjecao(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoProjecao();
  }

  function _desenharProducaoProjecao() {
    const pagina = document.getElementById('page-producao-projecao');
    if (!pagina) return;
    const busca = String(document.getElementById('pproj-busca')?.value || '').trim().toLowerCase();
    const metodo = document.getElementById('pproj-metodo')?.value || 'simples';
    const linhas = calcularProjecaoComRisco(metodo)
      .filter(p => !busca || String(p.produto || '').toLowerCase().includes(busca) || String(p.cod).includes(busca))
      .sort((a, b) => (a.coberturaDias ?? 9999) - (b.coberturaDias ?? 9999));

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">📈 Projeção de Vendas</div>
          <div style="font-size:.72rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} produto(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pproj-busca" placeholder="Buscar código ou produto..." value="${esc(busca)}" class="field" style="min-width:220px">
          <select id="pproj-metodo" class="field" title="Método de cálculo da projeção">
            <option value="simples" ${metodo === 'simples' ? 'selected' : ''}>Média simples</option>
            <option value="ponderada" ${metodo === 'ponderada' ? 'selected' : ''}>Média ponderada</option>
          </select>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">📥 Excel<input type="file" id="pproj-excel-input" accept=".xlsx,.xls" style="display:none"></label>
          <button type="button" class="btn btn-primary btn-sm" data-pproj-novo="1">+ Novo Produto</button>
        </div>
      </div>
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Cód.</th><th>Produto</th><th>M1</th><th>M2</th><th>M3</th><th>Proj. semanal</th><th>Estoque</th><th>Cobertura</th><th>Risco</th><th></th></tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(p => {
                const risco = RISCO_INFO[p.risco];
                return `
                <tr>
                  <td class="mono">${esc(p.cod)}</td>
                  <td><b>${esc(p.produto)}</b></td>
                  <td>${esc(p.venda_m1)}</td>
                  <td>${esc(p.venda_m2)}</td>
                  <td>${esc(p.venda_m3)}</td>
                  <td>${p.projSemanal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                  <td>${esc(p.estoqueAtual ?? '—')}</td>
                  <td>${p.coberturaDias != null ? p.coberturaDias.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'd' : '—'}</td>
                  <td><span class="badge ${risco.cor}">${risco.label}</span></td>
                  <td style="text-align:right;white-space:nowrap">
                    <button type="button" class="acao-lapis" title="Editar" data-pproj-editar="${esc(p._firestoreId)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-pproj-excluir="${esc(p._firestoreId)}">🗑️</button>
                  </td>
                </tr>`;
              }).join('') : `<tr><td colspan="10"><div class="empty"><div class="empty-icon">📈</div><div class="empty-title">Nenhum produto cadastrado</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function _abrirModalPproj(item) {
    document.getElementById('pproj-title').textContent = item._novo ? 'Novo produto' : 'Editar projeção';
    document.getElementById('pproj-doc-id').value = item._firestoreId || '';
    document.getElementById('pproj-cod').value = item.cod ?? '';
    document.getElementById('pproj-produto').value = item.produto || '';
    document.getElementById('pproj-m1').value = item.venda_m1 ?? 0;
    document.getElementById('pproj-m2').value = item.venda_m2 ?? 0;
    document.getElementById('pproj-m3').value = item.venda_m3 ?? 0;
    document.getElementById('pproj-estoque').value = item.estoqueAtual ?? '';
    global.openModal?.('modal-pproj');
  }

  function pprojEditar(docId) {
    const item = _projecao.find(p => p._firestoreId === docId);
    if (!item) return;
    _abrirModalPproj(item);
  }
  function pprojNovoProduto() { _abrirModalPproj({ _novo: true }); }

  async function pprojSalvar() {
    const cod = String(document.getElementById('pproj-cod').value || '').trim();
    const produto = String(document.getElementById('pproj-produto').value || '').trim();
    if (!cod || !produto) { global.showToast?.('Informe código e produto.', 'error'); return; }
    const venda_m1 = Number(document.getElementById('pproj-m1').value) || 0;
    const venda_m2 = Number(document.getElementById('pproj-m2').value) || 0;
    const venda_m3 = Number(document.getElementById('pproj-m3').value) || 0;
    const estoqueVal = document.getElementById('pproj-estoque').value;
    const estoqueAtual = estoqueVal === '' ? null : (Number(estoqueVal) || 0);
    const agora = new Date().toISOString();
    const docId = document.getElementById('pproj-doc-id').value || '';
    const payload = { cod, produto, venda_m1, venda_m2, venda_m3, estoqueAtual, atualizadoEm: agora };

    try {
      if (docId) {
        await fs().collection(COL_PROJECAO).doc(docId).set(payload, { merge: true });
      } else {
        payload.criadoEm = agora;
        await fs().collection(COL_PROJECAO).add(payload);
      }
      global.closeModal?.('modal-pproj');
      global.showToast?.('Projeção salva.', 'success');
      await carregarProducaoProjecao(true);
      _desenharProducaoProjecao();
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  async function pprojExcluir(docId) {
    const item = _projecao.find(p => p._firestoreId === docId);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_PROJECAO).doc(docId).delete();
        global.showToast?.('Projeção excluída.', 'success');
        await carregarProducaoProjecao(true);
        _desenharProducaoProjecao();
      } catch (e) {
        global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error');
      }
    };
    if (global.showConfirm) global.showConfirm('Excluir a projeção do produto "' + item.produto + '"?', executar, { title: 'Excluir projeção', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir a projeção do produto "' + item.produto + '"?')) await executar();
  }

  // Import Excel — colunas esperadas: cod, produto, venda_m1, venda_m2,
  // venda_m3. Upsert por `cod` (não apaga o que já existe e não está na
  // planilha, ao contrário do import destrutivo da original).
  async function importarProjecaoExcel(file) {
    if (!file) return;
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    try {
      const bytes = await file.arrayBuffer();
      const book = global.XLSX.read(bytes, { type: 'array', raw: false, cellText: true });
      const linhas = global.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
      const agora = new Date().toISOString();
      let criados = 0, atualizados = 0;

      for (const r of linhas) {
        const cod = String(r.cod ?? '').trim();
        const produtoNome = String(r.produto ?? '').trim();
        if (!cod || !produtoNome) continue;
        const payload = { cod, produto: produtoNome, venda_m1: Number(r.venda_m1) || 0, venda_m2: Number(r.venda_m2) || 0, venda_m3: Number(r.venda_m3) || 0, atualizadoEm: agora };
        const existente = _projecao.find(p => String(p.cod) === cod);
        if (existente) { await fs().collection(COL_PROJECAO).doc(existente._firestoreId).set(payload, { merge: true }); atualizados++; }
        else { await fs().collection(COL_PROJECAO).add({ ...payload, estoqueAtual: null, criadoEm: agora }); criados++; }
      }
      global.showToast?.(criados + ' criado(s), ' + atualizados + ' atualizado(s).', 'success');
      await carregarProducaoProjecao(true);
      _desenharProducaoProjecao();
    } catch (e) {
      global.showToast?.('Erro ao importar: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoProjecao = renderProducaoProjecao;
  global.importarProjecaoExcel = importarProjecaoExcel;
  global.carregarProducaoProjecao = carregarProducaoProjecao;
  global.calcularProjecaoComRisco = calcularProjecaoComRisco;
  global.pprojEditar = pprojEditar;
  global.pprojNovoProduto = pprojNovoProduto;
  global.pprojSalvar = pprojSalvar;
  global.pprojExcluir = pprojExcluir;

  document.addEventListener('click', function (event) {
    const novo = event.target.closest('[data-pproj-novo]');
    if (novo) { pprojNovoProduto(); return; }
    const editar = event.target.closest('[data-pproj-editar]');
    if (editar) { pprojEditar(editar.getAttribute('data-pproj-editar')); return; }
    const excluir = event.target.closest('[data-pproj-excluir]');
    if (excluir) { pprojExcluir(excluir.getAttribute('data-pproj-excluir')); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pproj-busca') _desenharProducaoProjecao();
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pproj-metodo') { _desenharProducaoProjecao(); return; }
    if (event.target && event.target.id === 'pproj-excel-input') {
      const file = event.target.files && event.target.files[0];
      importarProjecaoExcel(file);
      event.target.value = '';
    }
  });
})(window);
