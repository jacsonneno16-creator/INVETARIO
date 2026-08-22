// Setor Produção — Tempos de Setup (fase 3e da unificação com o Sistema de
// Produção). Tempo de troca de produto por máquina (origem→destino),
// consumido pelo motor de agenda (`63-producao-agenda.js`) quando a fila de
// uma máquina muda de produto. Sem tempo cadastrado, o motor usa
// `setupPadraoMin` da própria máquina; sem os dois, 0min (comportamento de
// antes desta fase).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_SETUP = 'producao_setup';
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_PRODUTOS = 'producao_produtos';

  // Compatibilidade com o projeto de Produção original: registros antigos usam
  // produto_origem/produto_destino/tempo_setup, enquanto a integração passou a
  // usar produtoOrigem/produtoDestino/minutos. Normalizamos na leitura e gravamos
  // os dois formatos para que Agenda/Gantt e dados legados funcionem juntos.
  function normalizarSetup(x) {
    return {
      ...x,
      produtoOrigem: x.produtoOrigem ?? x.produto_origem ?? '',
      produtoDestino: x.produtoDestino ?? x.produto_destino ?? '',
      minutos: Number(x.minutos ?? x.tempo_setup ?? 0) || 0,
    };
  }

  let _setups = [];
  let _maquinas = [];
  let _produtos = [];
  let _carregado = false;

  function fs() { return global.getDTFirestore(); }

  async function carregarProducaoSetup(forcar) {
    if (_carregado && !forcar) return;
    const [snapSetup, snapMaq, snapProd] = await Promise.all([
      fs().collection(COL_SETUP).get(),
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_PRODUTOS).get(),
    ]);
    _setups = snapSetup.docs.map(d => normalizarSetup({ _firestoreId: d.id, ...d.data() }));
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _produtos = snapProd.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  function _corTempo(min) {
    if (min <= 0) return 'b-gray';
    if (min <= 15) return 'b-blue';
    if (min <= 30) return 'b-yellow';
    return 'b-red';
  }

  let _containerSetup = 'page-producao-setup';
  async function renderProducaoSetup(containerId) {
    _containerSetup = containerId || 'page-producao-setup';
    const pagina = document.getElementById(_containerSetup);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoSetup(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoSetup();
  }

  function _desenharProducaoSetup() {
    const pagina = document.getElementById(_containerSetup);
    if (!pagina) return;
    const filtroMaquina = String(document.getElementById('psetup-filtro-maquina')?.value || '');
    const linhas = _setups
      .filter(s => !filtroMaquina || s.maquina === filtroMaquina)
      .sort((a, b) => (a.maquina || '').localeCompare(b.maquina || '', 'pt-BR') || (a.produtoOrigem || '').localeCompare(b.produtoOrigem || '', 'pt-BR'));
    const opcoesMaquinas = _maquinas.map(m => `<option value="${esc(m.nome)}" ${filtroMaquina === m.nome ? 'selected' : ''}>${esc(m.nome)}</option>`).join('');

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">🔧 Tempos de Setup</div>
          <div style="font-size:.72rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} tempo(s) cadastrado(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="psetup-filtro-maquina" class="field"><option value="">Todas as máquinas</option>${opcoesMaquinas}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-psetup-recarregar="1">🔄 Recarregar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pexcel-template-baixar="1">📄 Template/Backup</button>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">📥 Importar Excel<input type="file" id="pexcel-template-input" accept=".xlsx,.xls" style="display:none"></label>
          <button type="button" class="btn btn-primary btn-sm" data-psetup-novo="1">+ Novo Tempo de Setup</button>
        </div>
      </div>
      <div style="font-size:.7rem;color:var(--muted);margin-bottom:10px">Tempo em minutos · 0 = sem setup</div>
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Máquina</th><th>Produto Origem</th><th>Produto Destino</th><th>Minutos</th><th></th></tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(s => `
                <tr>
                  <td><b>${esc(s.maquina)}</b></td>
                  <td>${esc(s.produtoOrigem)}</td>
                  <td>${esc(s.produtoDestino)}</td>
                  <td><span class="badge ${_corTempo(Number(s.minutos) || 0)}">${esc(s.minutos)} min</span></td>
                  <td style="text-align:right;white-space:nowrap">
                    <button type="button" class="acao-lapis" title="Editar" data-psetup-editar="${esc(s._firestoreId)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-psetup-excluir="${esc(s._firestoreId)}">🗑️</button>
                  </td>
                </tr>`).join('') : `<tr><td colspan="5"><div class="empty"><div class="empty-icon">🔧</div><div class="empty-title">Nenhum tempo de setup cadastrado</div><div class="empty-sub">Sem cadastro, o motor de agenda usa o "Tempo de Setup Padrão" da máquina (ou 0min)</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function _popularSelectsProduto(maquinaNome, origemSel, destinoSel) {
    const maquina = _maquinas.find(m => m.nome === maquinaNome);
    let produtos = (maquina?.produtosCompativeis || []).map(p => p.produto).filter(Boolean);
    if (!produtos.length) produtos = _produtos.filter(p => !maquinaNome || !p.maquina || p.maquina === maquinaNome).map(p => p.nome || p.descricao || p.produto).filter(Boolean);
    if (!produtos.length) produtos = _produtos.map(p => p.nome || p.descricao || p.produto).filter(Boolean);
    produtos = [...new Set(produtos)].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
    const opcoes = produtos.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('') || '<option value="">Nenhum produto cadastrado</option>';
    document.getElementById(origemSel).innerHTML = opcoes;
    document.getElementById(destinoSel).innerHTML = opcoes;
  }

  function _abrirModalPsetup(item) {
    document.getElementById('psetup-title').textContent = item._novo ? 'Novo Tempo de Setup' : 'Editar Tempo de Setup';
    document.getElementById('psetup-doc-id').value = item._firestoreId || '';
    const selMaquina = document.getElementById('psetup-maquina');
    selMaquina.innerHTML = _maquinas.map(m => `<option value="${esc(m.nome)}">${esc(m.nome)}</option>`).join('') || '<option value="">Nenhuma máquina cadastrada</option>';
    selMaquina.value = item.maquina || '';
    _popularSelectsProduto(selMaquina.value, 'psetup-origem', 'psetup-destino');
    document.getElementById('psetup-origem').value = item.produtoOrigem || '';
    document.getElementById('psetup-destino').value = item.produtoDestino || '';
    document.getElementById('psetup-minutos').value = item.minutos ?? 15;
    global.openModal?.('modal-psetup');
  }

  function psetupEditar(docId) {
    const item = _setups.find(s => s._firestoreId === docId);
    if (!item) return;
    _abrirModalPsetup(item);
  }
  function psetupNovo() {
    if (!_maquinas.length) { global.showToast?.('Cadastre ao menos uma máquina com produtos compatíveis antes.', 'error'); return; }
    _abrirModalPsetup({ _novo: true });
  }

  async function psetupSalvar() {
    const maquina = document.getElementById('psetup-maquina').value;
    const produtoOrigem = document.getElementById('psetup-origem').value;
    const produtoDestino = document.getElementById('psetup-destino').value;
    const minutos = Math.max(0, Number(document.getElementById('psetup-minutos').value) || 0);
    if (!maquina || !produtoOrigem || !produtoDestino) { global.showToast?.('Selecione máquina, produto de origem e de destino.', 'error'); return; }
    if (produtoOrigem === produtoDestino) { global.showToast?.('Origem e destino precisam ser produtos diferentes.', 'error'); return; }
    const agora = new Date().toISOString();
    const docId = document.getElementById('psetup-doc-id').value || '';
    const payload = { maquina, produtoOrigem, produtoDestino, minutos, produto_origem: produtoOrigem, produto_destino: produtoDestino, tempo_setup: minutos, atualizadoEm: agora };

    try {
      if (docId) {
        await fs().collection(COL_SETUP).doc(docId).set(payload, { merge: true });
      } else {
        payload.criadoEm = agora;
        await fs().collection(COL_SETUP).add(payload);
      }
      global.closeModal?.('modal-psetup');
      global.showToast?.('Tempo de setup salvo.', 'success');
      await carregarProducaoSetup(true);
      _desenharProducaoSetup();
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  async function psetupExcluir(docId) {
    const item = _setups.find(s => s._firestoreId === docId);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_SETUP).doc(docId).delete();
        global.showToast?.('Tempo de setup excluído.', 'success');
        await carregarProducaoSetup(true);
        _desenharProducaoSetup();
      } catch (e) {
        global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error');
      }
    };
    const msg = 'Excluir o tempo de setup de "' + item.produtoOrigem + '" → "' + item.produtoDestino + '" (' + item.maquina + ')?';
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Excluir tempo de setup', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm(msg)) await executar();
  }

  global.renderProducaoSetup = renderProducaoSetup;
  global.psetupEditar = psetupEditar;
  global.psetupNovo = psetupNovo;
  global.psetupSalvar = psetupSalvar;
  global.psetupExcluir = psetupExcluir;

  document.addEventListener('click', function (event) {
    const novo = event.target.closest('[data-psetup-novo]');
    if (novo) { psetupNovo(); return; }
    const recarregar = event.target.closest('[data-psetup-recarregar]');
    if (recarregar) { carregarProducaoSetup(true).then(_desenharProducaoSetup); return; }
    const editar = event.target.closest('[data-psetup-editar]');
    if (editar) { psetupEditar(editar.getAttribute('data-psetup-editar')); return; }
    const excluir = event.target.closest('[data-psetup-excluir]');
    if (excluir) { psetupExcluir(excluir.getAttribute('data-psetup-excluir')); return; }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'psetup-filtro-maquina') { _desenharProducaoSetup(); return; }
    if (event.target && event.target.id === 'psetup-maquina') _popularSelectsProduto(event.target.value, 'psetup-origem', 'psetup-destino');
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _setups=[]; _maquinas=[]; _produtos=[]; });
})(window);
