function state(){ return window.AnalistaStore.getState(); }
function setLegacyText(id,value){ const el=document.getElementById(id); if(el) el.textContent=value; }
// ───────────────────────────────────────────────────────────────────
//  18. RENDERIZAÇÃO — ENDEREÇOS
// ───────────────────────────────────────────────────────────────────

function atualizarEnderecos(renderToo = true) {
  if (document.getElementById('v287-e-table')) { window.renderCadastrosV291?.(); return; }
  const setores  = Object.keys(state().enderecosPorSetor);
  const ativos   = state().enderecosLista.filter(e => e.ativo).length;
  const inativos = state().enderecosLista.filter(e => !e.ativo).length;
  const capZero  = state().enderecosLista.filter(e => e.capacidade_paletes === 0).length;

  // Calcular endereços com limite atingido no inventário ativo atual
  const invAtivo = getInventariosAtivos()[0] || null;
  let bloqueados = 0;
  if (invAtivo) {
    state().enderecosLista.filter(e => e.ativo && e.capacidade_paletes !== null && e.capacidade_paletes > 0).forEach(e => {
      const usados = getPaletesUsados(invAtivo.id, e.endereco);
      if (usados >= e.capacidade_paletes) bloqueados++;
    });
  }

  setLegacyText('ek-total', state().enderecosLista.length.toLocaleString('pt-BR'));
  setLegacyText('ek-locais', setores.length);
  setLegacyText('ek-ativos', ativos.toLocaleString('pt-BR'));
  setLegacyText('ek-inativos', inativos.toLocaleString('pt-BR'));
  setLegacyText('ek-bloqueados', bloqueados.toLocaleString('pt-BR'));
  setLegacyText('ek-bloqueados-sub', invAtivo ? `Em: ${invAtivo.codigo}` : 'Nenhum inv. ativo');
  setLegacyText('ek-cap-zero', capZero.toLocaleString('pt-BR'));
  setLegacyText('nb-enderecos', state().enderecosLista.length);

  // Badge capas duplicadas
  const _capaDupCount = _agruparCapasDuplicadas('').length;
  const _badgeCap = document.getElementById('nb-capas-dup');
  if (_badgeCap) {
    _badgeCap.textContent    = _capaDupCount;
    _badgeCap.style.display  = _capaDupCount > 0 ? '' : 'none';
  }

  const fLocal = document.getElementById('end-flocal');
  if (fLocal) {
    const cur = fLocal.value;
    fLocal.innerHTML = '<option value="">Todos os Locais de Estoque</option>' +
      setores.sort().map(s => `<option value="${s}" ${s === cur ? 'selected' : ''}>${s} (${state().enderecosPorSetor[s].length})</option>`).join('');
  }
  if (renderToo) renderEnderecos();
}

// v296.2 — A renderização em tabela/accordion antiga (linhas, grupos por local,
// badges de capacidade) foi removida daqui: a tela de Endereços hoje é 100%
// desenhada por js/analista/52-cadastros-v287.js (renderAddresses/initAddresses),
// que lê os mesmos dados via window.AnalistaStore.getState().enderecosLista.
// Esta função só existe para compatibilidade com quem ainda chama
// window.renderEnderecos() diretamente — ela delega para a tela nova.
function renderEnderecos() {
  window.renderCadastrosV291?.();
}

// ⚠️ Atenção (não corrigido automaticamente): a tela nova de Endereços não tem,
// no momento, campos de "capacidade de paletes" nem de "loja vinculada" no
// modal de edição — funcionalidades que existiam na tela antiga (editarCapacidade,
// endVincularLoja, bloqueio de endereço por limite de paletes no inventário ativo).
// As funções abaixo foram mantidas (não apagadas) porque contêm essa regra de
// negócio, mas hoje não há nenhum botão na tela nova que as chame. Se essas
// funcionalidades ainda forem necessárias, elas precisam ser reincorporadas ao
// modal/tabela do 52-cadastros-v287.js — isso é uma decisão de produto, não algo
// que deveria ser resolvido silenciosamente numa limpeza de código.

/**
 * Abre prompt inline para editar a capacidade de paletes de um endereço.
 */
function editarCapacidade(endCod) {
  const end = state().enderecosLista.find(e => e.endereco === endCod);
  if (!end) return;
  const atual = end.capacidade_paletes !== null ? String(end.capacidade_paletes) : '';
  const nova = prompt(`Capacidade de paletes para ${endCod}:\n(0 = inativo, vazio = sem limite)`, atual);
  if (nova === null) return; // cancelou
  if (nova.trim() === '') {
    salvarCapacidade(endCod, null);
    return;
  }
  salvarCapacidade(endCod, nova.trim());
}

// Sobrescreve salvarCapacidade para aceitar null (sem limite)
function salvarCapacidade(endCod, novaCap) {
  const result = dtSalvarCapacidadeEndereco(endCod, novaCap, {
    allowNull: true,
    refresh(cap) {
      atualizarEnderecos();
      logSistema('ENDERECO', `Capacidade de ${endCod} alterada para ${cap ?? 'sem limite'}`, { endCod, cap });
      showToast(`✅ Capacidade de ${endCod}: ${cap !== null ? cap + ' palete(s)' : 'sem limite'}`, 's');
    }
  });
  if (!result.ok) { showToast('Capacidade inválida', 'e'); return; }
}

// ───────────────────────────────────────────────────────────────────
//  18b. EXCLUSÃO DE ENDEREÇOS
// ───────────────────────────────────────────────────────────────────

function excluirEndereco(endCod) {
  showConfirm(`Excluir o endereço ${escHTML(endCod)}? Esta ação não pode ser desfeita.`, () => _excluirEnderecoConfirmado(endCod), { title: 'Excluir endereço', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' }); return;
}

async function _excluirEnderecoConfirmado(endCod) {
  const setor = state().enderecosLista.find(e => e.endereco === endCod)?.setor || 'SEM LOCAL';
  const lista = (state().enderecosLista || []).filter(e => e.endereco !== endCod);
  const porSetor = { ...(state().enderecosPorSetor || {}) };
  if (porSetor[setor]) {
    porSetor[setor] = porSetor[setor].filter(e => e.endereco !== endCod);
    if (!porSetor[setor].length) delete porSetor[setor];
  }
  window.AnalistaState.batch([
    window.AnalistaActions.replaceSlice('enderecosLista', lista, { source: 'excluirEndereco' }),
    window.AnalistaActions.replaceSlice('enderecosPorSetor', porSetor, { source: 'excluirEndereco' })
  ]);
  storageSave(KEYS.enderecos, lista);
  atualizarEnderecos();
  try { await window.fsPublicarEnderecos(); } catch (e) { console.error('[Endereços] Falha ao republicar chunks:', e); showToast('Endereço removido localmente, mas houve falha ao atualizar o Firebase.', 'e'); return; }
  logSistema('ENDERECO', `Endereço ${endCod} excluído e base republicada em chunks`, { endCod });
  showToast(`🗑 Endereço ${endCod} excluído e base atualizada`, 's');
}

function excluirTodosEnderecos() {
  const total = state().enderecosLista.length;
  if (!total) { showToast('Nenhum endereço para excluir', 'w'); return; }
  showConfirm(`Excluir TODOS os ${total.toLocaleString('pt-BR')} endereços cadastrados? Esta ação não pode ser desfeita.`, () => _excluirTodosEnderecosConfirmado(), { title: 'Excluir todos os endereços', icon: '🗑️', okLabel: 'Excluir tudo', okClass: 'btn-danger' }); return;
}

async function _excluirTodosEnderecosConfirmado() {
  const total = state().enderecosLista.length;
  window.AnalistaState.batch([
    window.AnalistaActions.replaceSlice('enderecosLista', [], { source: 'excluirTodosEnderecos' }),
    window.AnalistaActions.replaceSlice('enderecosPorSetor', {}, { source: 'excluirTodosEnderecos' })
  ]);
  storageSave(KEYS.enderecos, []);
  atualizarEnderecos();
  try { await window.fsPublicarEnderecos(); } catch (e) { console.error('[Endereços] Falha ao limpar chunks:', e); showToast('A tela foi limpa, mas houve falha ao apagar a base publicada no Firebase.', 'e'); return; }
  logSistema('ENDERECO', `Todos os ${total} endereços foram excluídos e os chunks zerados`, {});
  showToast(`🗑 ${total.toLocaleString('pt-BR')} endereços excluídos do sistema e do Firebase`, 's');
}

// ───────────────────────────────────────────────────────────────────
//  18c. FILTRO POR LOJA — popular select dinamicamente
// ───────────────────────────────────────────────────────────────────
let _endLojaSelectPopulado = false;

function _popularEndLojaSelect() {
  const sel = document.getElementById('end-floja');
  if (!sel) return;

  // Recalcular sempre que a lista mudar (flag resetada em atualizarEnderecos)
  const lojas = [...new Set(
    (state().enderecosLista || []).map(e => (e.loja || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // Só re-renderiza se o conteúdo realmente mudou
  const hash = lojas.join('|');
  if (sel.dataset.lojasHash === hash) return;
  sel.dataset.lojasHash = hash;

  const cur = sel.value;
  sel.innerHTML =
    '<option value="">Todas as Lojas</option>' +
    '<option value="__sem_loja__">⚠ Sem loja vinculada</option>' +
    lojas.map(l => `<option value="${escHTML(l)}" ${l === cur ? 'selected' : ''}>${escHTML(l)}</option>`).join('');
}

// ───────────────────────────────────────────────────────────────────
//  18d. VINCULAR ENDEREÇO A UMA LOJA
// ───────────────────────────────────────────────────────────────────
function endVincularLoja(endCod) {
  const end = state().enderecosLista.find(e => e.endereco === endCod);
  if (!end) { showToast('Endereço não encontrado', 'e'); return; }

  const lojas = [...new Set(
    (state().enderecosLista || []).map(e => (e.loja || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const dica = lojas.length
    ? `Lojas cadastradas: ${lojas.join(', ')}\n\n`
    : '';

  const novaLoja = prompt(
    `🏪 Vincular endereço "${endCod}" a qual loja?\n\n` +
    dica +
    `Digite o código da loja ou deixe em branco para remover o vínculo.`,
    end.loja || ''
  );

  if (novaLoja === null) return; // usuário cancelou

  end.loja = novaLoja.trim();

  // Invalidar hash do select para forçar re-popular
  const sel = document.getElementById('end-floja');
  if (sel) sel.dataset.lojasHash = '';

  storageSave(KEYS.enderecos, state().enderecosLista);
  atualizarEnderecos();

  if (end.loja) {
    showToast(`🏪 Loja "${escHTML(end.loja)}" vinculada a ${endCod}`, 's');
    logSistema('ENDERECO', `Loja de ${endCod} alterada para "${end.loja}"`, { endCod, loja: end.loja });
  } else {
    showToast(`🏪 Vínculo de loja removido de ${endCod}`, 's');
    logSistema('ENDERECO', `Loja de ${endCod} removida`, { endCod });
  }
}



