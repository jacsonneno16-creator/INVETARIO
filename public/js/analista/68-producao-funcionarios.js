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

  async function renderProducaoFuncionarios() {
    const pagina = document.getElementById('page-producao-funcionarios');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoFuncionarios(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoFuncionarios();
  }

  function _desenharProducaoFuncionarios() {
    const pagina = document.getElementById('page-producao-funcionarios');
    if (!pagina) return;
    const busca = String(document.getElementById('pfunc-busca')?.value || '').trim().toLowerCase();
    const linhas = _funcionarios
      .filter(f => !busca || String(f.nome || '').toLowerCase().includes(busca) || String(f.setor || '').toLowerCase().includes(busca))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">👷 Funcionários</div>
          <div style="font-size:.72rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} funcionário(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pfunc-busca" placeholder="Buscar nome ou setor..." value="${esc(busca)}" class="field" style="min-width:220px">
          <button type="button" class="btn btn-primary btn-sm" data-pfunc-novo="1">+ Novo Funcionário</button>
        </div>
      </div>
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Nome</th><th>Setor</th><th>Função</th><th>Turno</th><th>Máquinas</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(f => {
                const ausente = _estaAusente(f);
                return `
                <tr${ausente ? ' style="opacity:.55"' : ''}>
                  <td><b>${esc(f.nome)}</b></td>
                  <td>${esc(f.setor || '—')}</td>
                  <td>${esc(f.funcao || '—')}</td>
                  <td>${esc(f.turno || '—')}</td>
                  <td style="font-size:.72rem;color:var(--muted)">${(f.maquinas || []).join(', ') || '—'}</td>
                  <td>${f.ativo === false ? '<span class="badge b-red">Inativo</span>' : (_estaAusente(f) ? `<span class="badge b-yellow">Ausente ${f.deactivatedUntil==='indefinido'?'por prazo indefinido':'até '+esc(f.deactivatedUntil)}</span>` : '<span class="badge b-green">Ativo</span>')}</td>
                  <td style="text-align:right;white-space:nowrap">
                    ${_estaAusente(f) && f.ativo !== false ? `<button type="button" class="acao-lapis" title="Reativar" data-pfunc-reativar="${esc(f._firestoreId)}">▶️</button>` : `<button type="button" class="acao-lapis" title="Desativar temporariamente" data-pfunc-desativar="${esc(f._firestoreId)}">⏸️</button>`}
                    <button type="button" class="acao-lapis" title="Editar" data-pfunc-editar="${esc(f._firestoreId)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-pfunc-excluir="${esc(f._firestoreId)}">🗑️</button>
                  </td>
                </tr>`;
              }).join('') : `<tr><td colspan="7"><div class="empty"><div class="empty-icon">👷</div><div class="empty-title">Nenhum funcionário cadastrado</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function _redesenharMaquinasEditando() {
    const wrap = document.getElementById('pfunc-maquinas-list');
    if (!wrap) return;
    wrap.innerHTML = _maquinas.map(m => `
      <label style="display:flex;align-items:center;gap:6px;font-size:.8rem">
        <input type="checkbox" data-pfunc-maquina-check="${esc(m.nome)}" ${_maquinasEditando.includes(m.nome) ? 'checked' : ''}> ${esc(m.nome)}
      </label>`).join('') || '<div style="font-size:.75rem;color:var(--muted)">Nenhuma máquina cadastrada ainda.</div>';
  }

  function _abrirModalPfunc(item) {
    document.getElementById('pfunc-title').textContent = item._novo ? 'Novo funcionário' : 'Editar funcionário';
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

  function pfuncMaquinaToggle(nome, marcado) {
    _maquinasEditando = marcado ? [...new Set([..._maquinasEditando, nome])] : _maquinasEditando.filter(n => n !== nome);
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
    const maq = event.target.closest('[data-pfunc-maquina-check]');
    if (maq) pfuncMaquinaToggle(maq.getAttribute('data-pfunc-maquina-check'), maq.checked);
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _funcionarios=[]; _maquinas=[]; _maquinasEditando=[]; });
})(window);
