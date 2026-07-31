function state(){ return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  7-A. CAMADA DE VALIDAÇÃO OPERACIONAL
//  Centraliza todas as regras de bloqueio de contagem.
//  !! PREPARADA PARA FIREBASE: basta substituir state().enderecosLista / state().contagens
//     por leituras do Firestore e a lógica permanece idêntica. !!
// ───────────────────────────────────────────────────────────────────

/**
 * Busca o objeto de endereço cadastrado pelo código.
 * @param {string} endCod — ex: "01.02.03.04.05.01"
 * @returns {object|null}
 */
function getEnderecoInfo(endCod) {
  return state().enderecosLista.find(e => e.endereco === endCod) || null;
}

/**
 * Retorna as contagens ativas (não excluídas) de um endereço em um inventário.
 * Exclui recontagens (elas não contam para o bloqueio "já contado").
 * @param {string} inventarioId
 * @param {string} endCod
 * @param {boolean} incluirRecontagem — se true, inclui também contagens tipo RECONTAGEM
 * @returns {Array}
 */
function getContagensAtivas(inventarioId, endCod, incluirRecontagem = false) {
  return state().contagens.filter(c =>
    c.inventario_id === inventarioId &&
    c.endereco === endCod &&
    !c._excluida &&
    (incluirRecontagem || c.tipo_contagem !== 'RECONTAGEM')
  );
}

/**
 * Conta quantos paletes já foram registrados para um endereço em um inventário.
 * Cada contagem de tipo PRIMEIRA = 1 palete (independente da quantidade de itens).
 */
function getPaletesUsados(inventarioId, endCod) {
  return state().contagens.filter(c =>
    c.inventario_id === inventarioId &&
    c.endereco === endCod &&
    !c._excluida &&
    c.tipo_contagem !== 'RECONTAGEM'
  ).length;
}

/**
 * VALIDAÇÃO PRINCIPAL — chamada antes de aceitar qualquer contagem.
 *
 * Retorna um objeto:
 *   { ok: true }  → contagem permitida
 *   { ok: false, motivo: 'INATIVO'|'JA_CONTADO'|'LIMITE_PALETES', msg: string }
 *
 * @param {string} inventarioId
 * @param {string} endCod
 * @param {string} tipoContagem — 'PRIMEIRA' | 'RECONTAGEM'
 * @param {boolean} recontagemAutorizada — true se o analista autorizou explicitamente
 */
function validarContagem(inventarioId, endCod, tipoContagem = 'PRIMEIRA', recontagemAutorizada = false) {
  const end = getEnderecoInfo(endCod);

  // ── 1. ENDEREÇO INATIVO ────────────────────────────────────────────
  // Endereço inativo (ativo=false) não pode receber NENHUMA contagem,
  // nem mesmo recontagem autorizada — precisa ser reativado primeiro.
  if (end && end.ativo === false) {
    return {
      ok: false,
      motivo: 'INATIVO',
      msg: 'Endereço inativo, contagem não permitida.',
    };
  }

  // ── 2. JÁ CONTADO (apenas para PRIMEIRA contagem) ─────────────────
  // Se o endereço já tem pelo menos 1 contagem ativa do tipo PRIMEIRA,
  // bloquear nova contagem — salvo se for uma RECONTAGEM autorizada
  // (gerada pelo fluxo de divergências) ou se a anterior foi excluída.
  if (tipoContagem !== 'RECONTAGEM') {
    const contagensAtuais = getContagensAtivas(inventarioId, endCod, false);
    if (contagensAtuais.length > 0 && !recontagemAutorizada) {
      return {
        ok: false,
        motivo: 'JA_CONTADO',
        msg: 'Endereço já contado. Exclua a contagem anterior ou solicite uma recontagem.',
      };
    }
  }

  // ── 3. LIMITE DE PALETES ───────────────────────────────────────────
  // Só aplica quando capacidade_paletes está definida (≥ 1).
  // Recontagem não consome vaga de palete (é uma conferência, não nova entrada).
  if (end && end.capacidade_paletes !== null && end.capacidade_paletes > 0 && tipoContagem !== 'RECONTAGEM') {
    const usados = getPaletesUsados(inventarioId, endCod);
    if (usados >= end.capacidade_paletes) {
      return {
        ok: false,
        motivo: 'LIMITE_PALETES',
        msg: `Limite de paletes atingido para este endereço (cap: ${end.capacidade_paletes}, usados: ${usados}).`,
      };
    }
  }

  return { ok: true };
}


// Esta validação não deve rejeitar documentos recebidos do coletor: o coletor é quem
// executa a validação operacional ao vivo e também suporta modo offline. Mantemos esta
// camada como contrato reutilizável para futuros lançamentos manuais no Analista e para
// diagnósticos, sem apagar código nem criar uma segunda fonte de bloqueio.
window.DTValidacaoOperacional = Object.assign(window.DTValidacaoOperacional || {}, {
  getEnderecoInfo,
  getContagensAtivas,
  getPaletesUsados,
  validarContagem,
});

/**
 * Exclui uma contagem (marca como _excluida=true para preservar histórico).
 * Libera a vaga de palete correspondente.
 * Registra no log de auditoria.
 * @param {string} contId
 */
function excluirContagem(contId) {
  const cont = state().contagens.find(c => c.id === contId);
  if (!cont) return;
  showConfirm(`Excluir a contagem do endereço ${escHTML(cont.endereco)}? Isso liberará a vaga de palete e permitirá nova contagem.`, () => _excluirContagemConfirmado(cont), { title: 'Excluir contagem', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' }); return;

}

function _excluirContagemConfirmado(cont) {
  const agora        = new Date().toISOString();
  const emailAnalista = _currentAnalistaUser?.email || '';
  const nomeAnalista  = _currentAnalistaUser?.displayName || emailAnalista;

  cont._excluida          = true;
  cont._excluida_em       = agora;
  cont._excluida_por      = nomeAnalista;
  cont._excluida_por_email = emailAnalista;
  cont._motivo_estorno    = 'EXCLUSAO_ANALISTA';
  cont.status             = 'EXCLUIDA';
  cont.estorno_origem     = 'ANALISTA';

  saveAll();

  // ✅ Persistir no Firestore — rotear para dt_vazios se for VAZIO
  const docId = cont.uuid || String(cont.id);
  const _colExcluir = cont.tipo_contagem === 'VAZIO' ? 'dt_vazios' : 'dt_contagens';
  if (navigator.onLine) {
    FS_AN.collection(_colExcluir).doc(docId).update({
      _excluida:           true,
      status:              'EXCLUIDA',
      _excluida_em:        agora,
      _excluida_por:       nomeAnalista,
      _excluida_por_email: emailAnalista,
      _motivo_estorno:     'EXCLUSAO_ANALISTA',
      estorno_origem:      'ANALISTA',
    }).catch(e => console.warn('[FS] Erro ao persistir exclusão:', e.message));
  }

  renderContagens();
  atualizarBadgesNav();
  logSistema('EXCLUSAO', `Contagem ${contId} excluída — endereço ${cont.endereco} liberado`, {
    contId,
    uuid:          cont.uuid,
    endereco:      cont.endereco,
    produto:       cont.codigo_produto,
    quantidade:    cont.quantidade,
    tipo_contagem: cont.tipo_contagem || 'PRIMEIRA',
    inventario_id: cont.inventario_id,
    excluida_por:  nomeAnalista,
    excluida_por_email: emailAnalista,
  });
  showToast(`🗑 Contagem excluída. Endereço ${cont.endereco} liberado para nova contagem.`, 'w');
}

/**
 * Restaura uma contagem excluída (desfaz a exclusão).
 * @param {string} contId
 */
function restaurarContagem(contId) {
  const cont = state().contagens.find(c => c.id === contId);
  if (!cont || !cont._excluida) return;
  // Validar se restaurar seria possível (pode ter outra contagem agora)
  const val = validarContagem(cont.inventario_id, cont.endereco, cont.tipo_contagem, false);
  if (!val.ok) { showToast(`⚠️ Não é possível restaurar: ${val.msg}`, 'e'); return; }

  const emailAnalista = _currentAnalistaUser?.email || '';
  const nomeAnalista  = _currentAnalistaUser?.displayName || emailAnalista;
  const agora         = new Date().toISOString();

  // Limpar flags de exclusão
  delete cont._excluida;
  delete cont._excluida_em;
  delete cont._excluida_por;
  delete cont._excluida_por_email;
  delete cont._motivo_estorno;
  delete cont.estorno_origem;
  cont.status       = 'PROCESSADO';
  cont.restaurada_em = agora;
  cont.restaurada_por = nomeAnalista;
  cont.restaurada_por_email = emailAnalista;

  saveAll();

  // ✅ Persistir restauração no Firestore — rotear para dt_vazios se for VAZIO
  const docId = cont.uuid || String(cont.id);
  const _colRest = cont.tipo_contagem === 'VAZIO' ? 'dt_vazios' : 'dt_contagens';
  if (navigator.onLine) {
    FS_AN.collection(_colRest).doc(docId).update({
      _excluida:            firebase.firestore.FieldValue.delete(),
      _excluida_em:         firebase.firestore.FieldValue.delete(),
      _excluida_por:        firebase.firestore.FieldValue.delete(),
      _excluida_por_email:  firebase.firestore.FieldValue.delete(),
      _motivo_estorno:      firebase.firestore.FieldValue.delete(),
      estorno_origem:       firebase.firestore.FieldValue.delete(),
      status:               'PROCESSADO',
      restaurada_em:        agora,
      restaurada_por:       nomeAnalista,
      restaurada_por_email: emailAnalista,
    }).catch(e => console.warn('[FS] Erro ao persistir restauração:', e.message));
  }

  renderContagens();
  atualizarBadgesNav();
  logSistema('RESTAURACAO', `Contagem ${contId} restaurada — endereço ${cont.endereco}`, {
    contId,
    uuid:           cont.uuid,
    endereco:       cont.endereco,
    produto:        cont.codigo_produto,
    inventario_id:  cont.inventario_id,
    restaurada_por: nomeAnalista,
    restaurada_por_email: emailAnalista,
  });
  showToast(`✅ Contagem ${contId} restaurada!`, 's');
}

/**
 * Toggle ativo/inativo de um endereço pelo analista.
 * Endereço com capacidade_paletes = 0 pode ser manualmente reativado aqui,
 * mas o sistema emitirá um aviso pois a capacidade ainda é 0.
 * @param {string} endCod
 */
function toggleAtivacaoEndereco(endCod) {
  const end = state().enderecosLista.find(e => e.endereco === endCod);
  if (!end) return;

  const novoEstado = !end.ativo;

  // Aviso adicional se estiver reativando endereço de capacidade 0
  if (novoEstado && end.capacidade_paletes === 0) {
    showConfirm(`O endereço "${escHTML(endCod)}" tem capacidade_paletes = 0. Reativá-lo sem ajustar a capacidade pode causar inconsistências. Deseja continuar assim mesmo?`, () => _toggleEnderecoCapZero(endCod, novoEstado), { title: "⚠️ Capacidade zero", icon: "⚠️", okLabel: "Continuar mesmo assim", okClass: "btn-danger" }); return;
  }

  const acao = novoEstado ? 'ativado' : 'desativado';
  showConfirm(`${novoEstado ? 'Ativar' : 'Desativar'} o endereço "${escHTML(endCod)}"?`, () => _toggleEnderecoConfirmado(endCod, novoEstado), { title: novoEstado ? '✅ Ativar endereço' : '⛔ Desativar endereço', icon: novoEstado ? '✅' : '⛔', okLabel: novoEstado ? 'Ativar' : 'Desativar', okClass: novoEstado ? 'btn-success' : 'btn-danger' }); return;
}

// ── Alias: prosseguir toggle mesmo com capacidade zero ──
function _toggleEnderecoCapZero(endCod, novoEstado) {
  _toggleEnderecoConfirmado(endCod, novoEstado);
}

function _toggleEnderecoConfirmado(endCod, novoEstado) {

  // Atualizar na lista flat
  end.ativo = novoEstado;
  // Atualizar no porSetor
  const setor = end.setor || end.local_area || 'SEM LOCAL';
  if (state().enderecosPorSetor[setor]) {
    const e2 = state().enderecosPorSetor[setor].find(x => x.endereco === endCod);
    if (e2) e2.ativo = novoEstado;
  }

  storageSave(KEYS.enderecos, state().enderecosLista);
  atualizarEnderecos();
  atualizarBadgesNav();
  logSistema('ENDERECO', `Endereço ${endCod} ${acao} manualmente`, { endCod, ativo: novoEstado });
  showToast(`${novoEstado ? '✅ Endereço ativado' : '⛔ Endereço desativado'}: ${endCod}`, novoEstado ? 's' : 'w');
}

/**
 * Atualiza manualmente a capacidade de paletes de um endereço.
 * Chamada do inline edit na tabela de endereços.
 * @param {string} endCod
 * @param {number} novaCap
 */
function salvarCapacidade(endCod, novaCap) {
  const result = dtSalvarCapacidadeEndereco(endCod, novaCap, {
    allowNull: false,
    refresh(cap) {
      atualizarEnderecos();
      logSistema('ENDERECO', `Capacidade de paletes de ${endCod} alterada para ${cap}`, { endCod, cap });
      showToast(`✅ Capacidade de ${endCod} atualizada para ${cap} palete(s)`, 's');
    }
  });
  if (!result.ok) { showToast('Capacidade inválida', 'e'); return; }
}


// ───────────────────────────────────────────────────────────────────
// ESTORNO COMPLETO DO ENDEREÇO
// O botão da aba Contagens estorna a fotografia física inteira do endereço,
// incluindo 1ª/2ª/3ª rodadas, preservando o histórico e liberando uma nova
// primeira contagem. Não remove documentos do Firebase.
// ───────────────────────────────────────────────────────────────────
let _estornoContagemSelecionadaId = '';

function abrirEstorno(contId) {
  const cont = state().contagens.find(c => String(c.id || c.uuid) === String(contId));
  if (!cont) {
    showToast('Contagem não encontrada para estorno.', 'e');
    return;
  }
  _estornoContagemSelecionadaId = String(cont.id || cont.uuid || contId);
  const info = document.getElementById('estorno-info');
  if (info) info.innerHTML = `<b>Endereço:</b> ${escHTML(cont.endereco || '—')}<br><span>O estorno será aplicado a todas as rodadas e paletes ativos deste endereço. O histórico será mantido.</span>`;
  const operador = document.getElementById('estorno-operador');
  if (operador && !operador.value) operador.value = _currentAnalistaUser?.displayName || _currentAnalistaUser?.email || '';
  const motivo = document.getElementById('estorno-motivo');
  const obs = document.getElementById('estorno-obs');
  if (motivo) motivo.value = '';
  if (obs) obs.value = '';
  openModal('modal-estorno');
}

async function confirmarEstorno() {
  const cont = state().contagens.find(c => String(c.id || c.uuid) === String(_estornoContagemSelecionadaId));
  if (!cont) return showToast('Contagem não encontrada para estorno.', 'e');
  const operador = String(document.getElementById('estorno-operador')?.value || '').trim();
  const motivo = String(document.getElementById('estorno-motivo')?.value || '').trim();
  const observacao = String(document.getElementById('estorno-obs')?.value || '').trim();
  if (!operador) return showToast('Informe o operador responsável pelo estorno.', 'w');
  if (!motivo) return showToast('Selecione o motivo do estorno.', 'w');

  const invId = String(cont.inventario_id || cont.inventarioId || '');
  const endereco = String(cont.endereco || '').trim().toUpperCase();
  const agora = new Date().toISOString();
  const analistaEmail = _currentAnalistaUser?.email || '';
  const mesmas = state().contagens.filter(c =>
    String(c.inventario_id || c.inventarioId || '') === invId &&
    String(c.endereco || '').trim().toUpperCase() === endereco &&
    !c._excluida && !['ESTORNADA','EXCLUIDA'].includes(String(c.status || '').toUpperCase())
  );
  if (!mesmas.length) return showToast('Não há contagens ativas neste endereço.', 'w');

  mesmas.forEach(c => {
    c.status = 'ESTORNADA';
    c._excluida = true;
    c._excluida_em = agora;
    c._excluida_por = operador;
    c._excluida_por_email = analistaEmail;
    c._motivo_estorno = motivo;
    c.estorno_observacao = observacao;
    c.estorno_origem = 'ANALISTA';
  });

  const divs = (state().divergencias || []).filter(d =>
    String(d.inventario_id || d.inventarioId || '') === invId &&
    String(d.endereco || '').trim().toUpperCase() === endereco &&
    !['CANCELADA','EXCLUIDA','ESTORNADA','RESOLVIDA'].includes(String(d.status || '').toUpperCase())
  );
  divs.forEach(d => {
    d.status = 'CANCELADA';
    d.status_recontagem = 'CANCELADA';
    d.cancelada_em = agora;
    d.cancelada_motivo = 'CONTAGEM_ESTORNADA_ANALISTA';
  });
  const divIds = new Set(divs.map(d => String(d.id || d.divergencia_id || '')));
  const recs = (state().recontagens || []).filter(r =>
    (String(r.inventario_id || r.inventarioId || '') === invId && String(r.endereco || '').trim().toUpperCase() === endereco) ||
    divIds.has(String(r.divergencia_id || ''))
  ).filter(r => !['CONCLUIDA','CONCLUÍDA','CANCELADA','EXCLUIDA'].includes(String(r.status || r.status_recontagem || '').toUpperCase()));
  recs.forEach(r => {
    r.status = 'CANCELADA';
    r.status_recontagem = 'CANCELADA';
    r.cancelada_em = agora;
    r.cancelada_motivo = 'CONTAGEM_ESTORNADA_ANALISTA';
  });

  saveAll();
  try {
    if (navigator.onLine && window.FS_AN) {
      const updates = [];
      mesmas.forEach(c => {
        const docId = String(c.uuid || c.id || '');
        if (!docId) return;
        const col = String(c.tipo_contagem || '').toUpperCase() === 'VAZIO' ? 'dt_vazios' : 'dt_contagens';
        updates.push(FS_AN.collection(col).doc(docId).set({
          status:'ESTORNADA', _excluida:true, _excluida_em:agora,
          _excluida_por:operador, _excluida_por_email:analistaEmail,
          _motivo_estorno:motivo, estorno_observacao:observacao,
          estorno_origem:'ANALISTA'
        }, {merge:true}));
      });
      divs.forEach(d => {
        const id = String(d.id || d.divergencia_id || '');
        if (id) updates.push(FS_AN.collection('dt_divergencias').doc(id).set({status:'CANCELADA',status_recontagem:'CANCELADA',cancelada_em:agora,cancelada_motivo:'CONTAGEM_ESTORNADA_ANALISTA'}, {merge:true}));
      });
      recs.forEach(r => {
        const id = String(r.id || r.recontagem_id || '');
        if (id) updates.push(FS_AN.collection('dt_recontagens').doc(id).set({status:'CANCELADA',status_recontagem:'CANCELADA',cancelada_em:agora,cancelada_motivo:'CONTAGEM_ESTORNADA_ANALISTA'}, {merge:true}));
      });
      await Promise.all(updates);
    }
  } catch (e) {
    console.warn('[Estorno] Persistência parcial:', e);
    showToast('Estorno aplicado localmente, mas houve falha ao sincronizar parte dos dados.', 'w');
  }

  closeModal('modal-estorno');
  _estornoContagemSelecionadaId = '';
  renderContagens();
  if (typeof renderRecontagens === 'function') renderRecontagens();
  atualizarBadgesNav();
  logSistema('ESTORNO_ENDERECO', `Endereço ${cont.endereco} estornado pelo analista`, {
    inventario_id:invId, endereco:cont.endereco, registros:mesmas.length,
    divergencias_canceladas:divs.length, recontagens_canceladas:recs.length,
    motivo, observacao, operador
  });
  showToast(`Endereço ${cont.endereco} liberado para uma nova contagem.`, 's');
}

window.abrirEstorno = abrirEstorno;
window.confirmarEstorno = confirmarEstorno;
