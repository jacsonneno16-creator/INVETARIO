// Setor Produção — Funcionários, mão-de-obra "sem login" (fase 3d da
// unificação com o Sistema de Produção). CRUD simples + "desativar
// temporariamente" (ausência com data de retorno e motivo).
//
// Corrigido em relação à original: escopado por loja
// (lojas/{lojaId}/producao_funcionarios) — a original guardava isso numa
// coleção GLOBAL sem loja, o que não faz sentido agora que várias plantas
// têm equipes diferentes. Sem campo de custo/salário (a original também não
// tinha). Sem os stubs/wrappers mortos identificados na investigação.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_FUNC = 'producao_funcionarios';
  const COL_MAQUINAS = 'producao_maquinas';

  let _funcionarios = [];
  let _maquinas = [];
  let _carregado = false;
  let _maquinasEditando = [];

  function fs() { return global.getDTFirestore(); }

  async function carregarProducaoFuncionarios(forcar) {
    if (_carregado && !forcar) return;
    const [snapFunc, snapMaq] = await Promise.all([
      fs().collection(COL_FUNC).get(),
      fs().collection(COL_MAQUINAS).get(),
    ]);
    _funcionarios = snapFunc.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  function _estaAusente(f) { if (f.ativo === false) return true; if (!f.deactivatedUntil) return false; if (f.deactivatedUntil === 'indefinido') return true; const t = new Date(String(f.deactivatedUntil) + (String(f.deactivatedUntil).length === 10 ? 'T23:59:59' : '')).getTime(); return Number.isFinite(t) && t > Date.now(); }

  let _containerFunc = 'page-producao-funcionarios';
  async function renderProducaoFuncionarios(containerId) {
    _containerFunc = containerId || 'page-producao-funcionarios';
    const pagina = document.getElementById(_containerFunc);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoFuncionarios(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoFuncionarios();
  }

  function _desenharProducaoFuncionarios() {
    const pagina = document.getElementById(_containerFunc);
    if (!pagina) return;
    const busca = String(document.getElementById('pfunc-busca')?.value || '').trim().toLowerCase();
    const linhas = _funcionarios
      .filter(f => !busca || String(f.nome || '').toLowerCase().includes(busca) || String(f.setor || '').toLowerCase().includes(busca))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    // PEDIDO AO VIVO (comparação com o original achou isso diferente): a
    // original mostra "Funcionários da Produção" com badge "Sem login" e
    // lista de CARTÕES (avatar + nome + setor·função·turno + máquinas +
    // status), não tabela — e o botão diz só "Adicionar".
    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">👷 Funcionários da Produção <span class="badge b-gray" style="font-size:.6rem;vertical-align:middle">Sem login</span></div>
          <div style="font-size:.72rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} funcionário(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pfunc-busca" placeholder="Buscar nome ou setor..." value="${esc(busca)}" class="field" style="min-width:220px">
          <button type="button" class="btn btn-primary btn-sm" data-pfunc-novo="1">Adicionar</button>
        </div>
      </div>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:14px">👷 Cadastro de pessoas que trabalham na produção. Não precisam ter login no sistema.</div>
      ${linhas.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
        ${linhas.map(f => {
          const ausente = _estaAusente(f);
          const inicial = (String(f.nome || '?').trim()[0] || '?').toUpperCase();
          const statusInfo = f.ativo === false ? { cor: 'var(--danger)', texto: 'Inativo' } : (ausente ? { cor: 'var(--warn)', texto: 'Ausente ' + (f.deactivatedUntil === 'indefinido' ? 'por prazo indefinido' : 'até ' + esc(f.deactivatedUntil)) } : { cor: 'var(--success)', texto: 'Ativo' });
          return `
          <div class="tc" style="padding:14px;display:flex;flex-direction:column;gap:8px;${ausente ? 'opacity:.65' : ''}">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:38px;height:38px;border-radius:50%;background:var(--orange);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${esc(inicial)}</div>
              <div style="min-width:0;flex:1">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.nome)}</div>
                <div style="font-size:.7rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.setor || '—')} · ${esc(f.funcao || '—')} · ${esc(f.turno || '—')}</div>
              </div>
            </div>
            <div style="font-size:.7rem;color:var(--muted)">🏭 ${(f.maquinas || []).join(', ') || 'Nenhuma máquina'}</div>
            <div style="display:flex;align-items:center;gap:5px;font-size:.7rem"><span style="width:7px;height:7px;border-radius:50%;background:${statusInfo.cor};display:inline-block"></span><span style="color:${statusInfo.cor}">${statusInfo.texto}</span></div>
            <div style="display:flex;justify-content:flex-end;gap:2px;margin-top:2px">
              ${ausente && f.ativo !== false ? `<button type="button" class="acao-lapis" title="Reativar" data-pfunc-reativar="${esc(f._firestoreId)}">▶️</button>` : `<button type="button" class="acao-lapis" title="Desativar temporariamente" data-pfunc-desativar="${esc(f._firestoreId)}">⏸️</button>`}
              <button type="button" class="acao-lapis" title="Editar" data-pfunc-editar="${esc(f._firestoreId)}">✏️</button>
              <button type="button" class="acao-lapis" title="Excluir" data-pfunc-excluir="${esc(f._firestoreId)}">🗑️</button>
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div class="empty"><div class="empty-icon">👷</div><div class="empty-title">Nenhum funcionário cadastrado</div></div>`}`;
  }

  // PEDIDO AO VIVO: original usa <select multiple> ("Segure Ctrl para
  // selecionar várias"), não checkboxes.
  function _redesenharMaquinasEditando() {
    const sel = document.getElementById('pfunc-maquinas-list');
    if (!sel) return;
    sel.innerHTML = _maquinas.map(m => `<option value="${esc(m.nome)}" ${_maquinasEditando.includes(m.nome) ? 'selected' : ''}>${esc(m.nome)}</option>`).join('') || '<option disabled>Nenhuma máquina cadastrada ainda.</option>';
  }

  function _abrirModalPfunc(item) {
    // PEDIDO AO VIVO: título do original é "Novo Funcionário da Produção" /
    // "Editar Funcionário", não "Novo funcionário" genérico.
    document.getElementById('pfunc-title').textContent = item._novo ? 'Novo Funcionário da Produção' : 'Editar Funcionário';
    document.getElementById('pfunc-doc-id').value = item._firestoreId || '';
    document.getElementById('pfunc-nome').value = item.nome || '';
    document.getElementById('pfunc-setor').value = item.setor || '';
    document.getElementById('pfunc-funcao').value = item.funcao || '';
    document.getElementById('pfunc-turno').value = item.turno || '';
    const ativoEl = document.getElementById('pfunc-ativo'); if (ativoEl) ativoEl.value = item.ativo === false ? 'false' : 'true';
    document.getElementById('pfunc-obs').value = item.obs || '';
    _maquinasEditando = Array.isArray(item.maquinas) ? item.maquinas.slice() : [];
    _redesenharMaquinasEditando();
    global.openModal?.('modal-pfunc');
  }

  function pfuncMaquinasSelecionadas(selectEl) {
    _maquinasEditando = Array.from(selectEl.selectedOptions).map(o => o.value);
  }

  function pfuncEditar(docId) {
    const item = _funcionarios.find(f => f._firestoreId === docId);
    if (!item) return;
    _abrirModalPfunc(item);
  }
  function pfuncNovoFuncionario() { _abrirModalPfunc({ _novo: true }); }

  async function pfuncSalvar() {
    const nome = String(document.getElementById('pfunc-nome').value || '').trim();
    if (!nome) { global.showToast?.('Informe o nome.', 'error'); return; }
    const setor = String(document.getElementById('pfunc-setor').value || '').trim();
    const funcao = String(document.getElementById('pfunc-funcao').value || '').trim();
    const turno = document.getElementById('pfunc-turno').value || '';
    const obs = String(document.getElementById('pfunc-obs').value || '').trim();
    const ativo = document.getElementById('pfunc-ativo')?.value !== 'false';
    const agora = new Date().toISOString();
    const docId = document.getElementById('pfunc-doc-id').value || '';
    const payload = { nome, setor, funcao, turno, maquinas: _maquinasEditando, obs, ativo, atualizadoEm: agora }; if (ativo && docId) { payload.deactivatedUntil = null; payload.motivo = ''; }

    try {
      if (docId) {
        await fs().collection(COL_FUNC).doc(docId).set(payload, { merge: true });
      } else {
        payload.criadoEm = agora;
        await fs().collection(COL_FUNC).add(payload);
      }
      global.closeModal?.('modal-pfunc');
      global.showToast?.('Funcionário salvo.', 'success');
      await carregarProducaoFuncionarios(true);
      _desenharProducaoFuncionarios();
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  async function pfuncExcluir(docId) {
    const item = _funcionarios.find(f => f._firestoreId === docId);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_FUNC).doc(docId).delete();
        global.showToast?.('Funcionário excluído.', 'success');
        await carregarProducaoFuncionarios(true);
        _desenharProducaoFuncionarios();
      } catch (e) {
        global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error');
      }
    };
    if (global.showConfirm) global.showConfirm('Excluir o funcionário "' + item.nome + '"?', executar, { title: 'Excluir funcionário', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir o funcionário "' + item.nome + '"?')) await executar();
  }

  function pfuncAbrirDesativar(docId) {
    document.getElementById('pfuncd-doc-id').value = docId;
    document.getElementById('pfuncd-ate').value = '';
    document.getElementById('pfuncd-motivo').value = '';
    global.openModal?.('modal-pfunc-desativar');
  }

  async function pfuncConfirmarDesativar() {
    const docId = document.getElementById('pfuncd-doc-id').value;
    const ate = document.getElementById('pfuncd-ate').value || '';
    const motivo = String(document.getElementById('pfuncd-motivo').value || '').trim();
    try {
      await fs().collection(COL_FUNC).doc(docId).set({ deactivatedUntil: ate || 'indefinido', motivo, atualizadoEm: new Date().toISOString() }, { merge: true });
      global.closeModal?.('modal-pfunc-desativar');
      global.showToast?.('Funcionário desativado temporariamente.', 'success');
      await carregarProducaoFuncionarios(true);
      _desenharProducaoFuncionarios();
    } catch (e) {
      global.showToast?.('Erro: ' + (e.message || e), 'error');
    }
  }

  async function pfuncReativar(docId) {
    try {
      await fs().collection(COL_FUNC).doc(docId).set({ deactivatedUntil: null, motivo: '', atualizadoEm: new Date().toISOString() }, { merge: true });
      global.showToast?.('Funcionário reativado.', 'success');
      await carregarProducaoFuncionarios(true);
      _desenharProducaoFuncionarios();
    } catch (e) {
      global.showToast?.('Erro: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoFuncionarios = renderProducaoFuncionarios;
  global.pfuncEditar = pfuncEditar;
  global.pfuncNovoFuncionario = pfuncNovoFuncionario;
  global.pfuncSalvar = pfuncSalvar;
  global.pfuncExcluir = pfuncExcluir;
  global.pfuncConfirmarDesativar = pfuncConfirmarDesativar;

  document.addEventListener('click', function (event) {
    const novo = event.target.closest('[data-pfunc-novo]');
    if (novo) { pfuncNovoFuncionario(); return; }
    const editar = event.target.closest('[data-pfunc-editar]');
    if (editar) { pfuncEditar(editar.getAttribute('data-pfunc-editar')); return; }
    const excluir = event.target.closest('[data-pfunc-excluir]');
    if (excluir) { pfuncExcluir(excluir.getAttribute('data-pfunc-excluir')); return; }
    const desativar = event.target.closest('[data-pfunc-desativar]');
    if (desativar) { pfuncAbrirDesativar(desativar.getAttribute('data-pfunc-desativar')); return; }
    const reativar = event.target.closest('[data-pfunc-reativar]');
    if (reativar) { pfuncReativar(reativar.getAttribute('data-pfunc-reativar')); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pfunc-busca') _desenharProducaoFuncionarios();
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pfunc-maquinas-list') pfuncMaquinasSelecionadas(event.target);
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _funcionarios=[]; _maquinas=[]; _maquinasEditando=[]; });
})(window);
