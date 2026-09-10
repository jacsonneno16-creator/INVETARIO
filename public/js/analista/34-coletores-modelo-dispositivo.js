function state(){ return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  19. RENDERIZAÇÃO — COLETORES
// ═══════════════════════════════════════════════════════════════════
//  COLETORES — Modelo correto: Dispositivo ≠ Operador
//  - Coletor = aparelho físico, identificado por device_id único
//  - Operador = pessoa que faz login no coletor
//  - Um coletor pode ter vários operadores ao longo do tempo
//  - O coletor persiste mesmo após logout do operador
// ═══════════════════════════════════════════════════════════════════

const FS_COL_COLETORES = (window.DT_FCOL && window.DT_FCOL.coletores) || 'dt_coletores';
const OFFLINE_TIMEOUT_MS = 2 * 60 * 1000;

if (!Array.isArray(state().coletores)) window.AnalistaState.replaceSlice('coletores', [], { source: 'coletores-init' });
if (!window._coletorHeartbeats) window._coletorHeartbeats = {};
if (!window._filaOffline) window._filaOffline = JSON.parse(localStorage.getItem('dt_fila_offline') || '[]');

function salvarDB_coletores() {
  localStorage.setItem('dt_db_coletores', JSON.stringify(Array.isArray(state().coletores) ? state().coletores : []));
}
function carregarDB_coletores() {
  try { const r = localStorage.getItem('dt_db_coletores'); if (r) window.AnalistaState.replaceSlice('coletores', JSON.parse(r), { source: 'coletores-cache-load' }); } catch(e){ console.warn("[Erro tratado]", e); }
}
carregarDB_coletores();

// ── IDENTIFICAÇÃO AUTOMÁTICA DO DISPOSITIVO ─────────────────────────
function obterDeviceId() {
  let did = localStorage.getItem('dt_device_id');
  if (!did) {
    did = 'DEV-' + Date.now() + '-' + Math.random().toString(36).slice(2,8).toUpperCase();
    localStorage.setItem('dt_device_id', did);
  }
  return did;
}

// Registra este aparelho como coletor se ainda não existir.
function registrarDispositivoComoColetorSeNecessario(deviceId, apelido) {
  let col = state().coletores.find(c => c.device_id === deviceId);
  if (!col) {
    const seq = state().coletores.length + 1;
    col = {
      id:                 'COL-' + Date.now(),
      device_id:          deviceId,
      numero:             String(seq).padStart(2, '0'),
      apelido:            apelido || '',
      criado_em:          new Date().toISOString(),
      ultima_atividade:   new Date().toISOString(),
      status:             'offline',
      sessao:             null,
      contagens_enviadas: 0,
      contagens_pendentes: 0,
    };
    window.AnalistaState.replaceSlice('coletores', [...(state().coletores || []), col], { source: 'registrarColetor' });
    salvarDB_coletores();
    logAuditoria('SISTEMA', `Coletor ${col.numero} registrado automaticamente`, `Device ID: ${deviceId}`);
    showToast(`📱 Coletor ${col.numero} registrado automaticamente`, 'i');
    renderColetores();
  }
  return col;
}

// ── LOGIN DE OPERADOR NO COLETOR ────────────────────────────────────
function abrirModalLoginOperador() {
  const selCol = document.getElementById('lop-coletor-sel');
  if (selCol) {
    selCol.innerHTML = '<option value="">Selecione o coletor...</option>' +
      state().coletores.map(c => {
        const op = c.sessao ? ` — ${escapeHTML(c.sessao.operador)} (em uso)` : ' — livre';
        return `<option value="${c.id}">Coletor ${c.numero}${c.apelido ? ' · ' + escapeHTML(c.apelido) : ''}${op}</option>`;
      }).join('');
  }
  const selInv = document.getElementById('lop-inv');
  if (selInv) {
    selInv.innerHTML = '<option value="">Selecione o inventário...</option>' +
      state().inventarios.filter(i => i.status !== 'Fechado')
        .map(i => `<option value="${i.id}">${i.nome}</option>`).join('');
  }
  document.getElementById('lop-nome').value = '';
  document.getElementById('lop-login').value = '';
  document.getElementById('lop-coletor-aviso').style.display = 'none';
  openModal('modal-login-operador');
}

function verificarColetorDisponivel() {
  const id = document.getElementById('lop-coletor-sel')?.value;
  const aviso = document.getElementById('lop-coletor-aviso');
  const btnConfirmar = document.getElementById('btn-confirmar-login-op');
  if (!id || !aviso) return;
  const col = state().coletores.find(c => c.id === id);
  if (!col) { aviso.style.display = 'none'; return; }
  if (col.sessao && col.status === 'online') {
    aviso.style.display = 'block';
    aviso.style.color = 'var(--danger)';
    aviso.innerHTML = `⛔ Este coletor está em uso por <strong>${escapeHTML(col.sessao.operador)}</strong> desde ${new Date(col.sessao.hora_login).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}. Não é possível fazer login simultâneo.`;
    if (btnConfirmar) btnConfirmar.disabled = true;
  } else if (col.sessao && col.status === 'offline') {
    aviso.style.display = 'block';
    aviso.style.color = 'var(--warn)';
    aviso.innerHTML = `⚠️ Último operador: <strong>${escapeHTML(col.sessao.operador)}</strong> (coletor offline). Confirmar para assumir sessão.`;
    if (btnConfirmar) btnConfirmar.disabled = false;
  } else {
    aviso.style.display = 'none';
    if (btnConfirmar) btnConfirmar.disabled = false;
  }
}

function confirmarLoginOperador() {
  const colId = document.getElementById('lop-coletor-sel')?.value;
  const nome  = (document.getElementById('lop-nome')?.value || '').trim();
  const login = (document.getElementById('lop-login')?.value || '').trim();
  const invId = document.getElementById('lop-inv')?.value || '';
  if (!colId) { showToast('Selecione o coletor', 'w'); return; }
  if (!nome)  { showToast('Informe o nome do operador', 'w'); return; }
  const col = state().coletores.find(c => c.id === colId);
  if (!col) return;
  if (col.sessao && col.status === 'online') {
    showToast(`⛔ Coletor ${col.numero} já está em uso por ${col.sessao.operador}`, 'e');
    return;
  }
  const inv = state().inventarios.find(i => i.id === invId);
  if (inv && (inv.status === 'FECHADO' || inv.status === 'Fechado')) {
    showToast('⛔ Inventário finalizado. Não é possível iniciar sessão.', 'e');
    return;
  }
  const invNomeDisplay = inv ? inv.nome : 'N/A';
  col.sessao = { operador: nome, login, inventario_id: invId, hora_login: new Date().toISOString() };
  col.status = 'online';
  col.ultimo_ping = new Date().toISOString();
  window._coletorHeartbeats[colId] = Date.now();
  salvarDB_coletores();
  closeModal('modal-login-operador');
  renderColetores();
  logAuditoria('SISTEMA', `Operador ${nome} fez login no Coletor ${col.numero}`, `Inventário: ${invNomeDisplay}`);
  showToast(`🟢 ${nome} está operando o Coletor ${col.numero}`, 's');
}

// ── LOGOUT — coletor permanece, só a sessão é removida ───────────────
// BUG AO VIVO REAL (relatado pelo usuário: "fica com o nome da pessoa o
// tempo todo... quando não tiver ninguém logado tem que ficar vazio") —
// esta função só mexia no estado local (col.sessao/col.status), nunca
// escrevia no Firestore. A coluna "Operador Logado" da tabela lê
// `operador_atual` (gravado pelo próprio Coletor no login), que nunca era
// limpo por aqui — o nome "fantasma" sobrevivia à próxima leitura do
// Firestore, sobrescrevendo o que este botão tinha acabado de zerar
// localmente.
async function logoutOperadorColetor(colId) {
  const col = state().coletores.find(c => c.id === colId);
  if (!col) return;
  const nomeOp = col.sessao?.operador || col.operador_atual || 'Operador';
  try {
    await FS_AN.collection(FS_COL_COLETORES).doc(colId).set({
      sessao: null, status: 'offline',
      operador_atual: null, operador_email: null, operador_uid: null,
    }, { merge: true });
  } catch (e) {
    console.warn('[Coletores] Falha ao gravar logout forçado:', e.message);
  }
  col.sessao = null;
  col.status = 'offline';
  col.operador_atual = null;
  delete window._coletorHeartbeats[colId];
  salvarDB_coletores();
  renderColetores();
  logAuditoria('SISTEMA', `Operador ${nomeOp} fez logout do Coletor ${col.numero}`, '');
  showToast(`🔴 ${nomeOp} saiu do Coletor ${col.numero}`, 'w');
}

async function excluirColetor(id) {
  const col = state().coletores.find(c => c.id === id);
  const nome = col ? (col.nome_exibicao || `Coletor ${col.numero}`) : id;
  if (!window.confirm(`Remover ${nome} do sistema? O histórico de contagens será mantido.`)) return false;
  return _removerColetorConfirmado(id);
}

async function _removerColetorConfirmado(coletorId) {
  try {
    const raw = window.getDTRawFirestore ? window.getDTRawFirestore() : FS_AN;

    // Mantém um marcador invisível no mesmo documento. Isso revoga a aprovação
    // sem depender de outra coleção e impede o Coletor de recuperar aprovações
    // antigas existentes dentro das lojas. No próximo login o aparelho volta
    // como pendente e precisa ser aprovado novamente.
    await raw.collection(FS_COL_COLETORES).doc(coletorId).set({
      aprovado: 'revogado',
      status: 'revogado',
      ativo: false,
      bloqueado: false,
      excluido: true,
      sessao: null,
      revogado_em: firebase.firestore.FieldValue.serverTimestamp(),
      revogado_por: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'analista'
    }, { merge: true });

    try {
      const lojasSnap = await raw.collection('lojas').get();
      for (const lojaDoc of lojasSnap.docs) {
        await raw.collection('lojas').doc(lojaDoc.id).collection(FS_COL_COLETORES).doc(coletorId).delete().catch(function(error){ console.warn("[Falha assíncrona]", error); });
      }
    } catch(_){ console.warn("[Erro tratado]", _); }

    // BUG AO VIVO REAL: "fala que foi excluído mas não some" — a escrita no
    // Firestore acontecia normal, mas a tela só se atualizava esperando o
    // onSnapshot em tempo real voltar (mesma classe de bug já corrigida em
    // logoutOperadorColetor() acima, que já atualiza o estado local +
    // renderColetores() na hora, sem depender do round-trip). Remove do
    // estado local IMEDIATAMENTE, com o mesmo filtro que
    // _normalizarColetores() já aplica pro snapshot real (excluido/revogado
    // somem da lista) — quando o snapshot chegar, é uma no-op.
    window.AnalistaState.replaceSlice(
      'coletores',
      state().coletores.filter(c => c.id !== coletorId),
      { source: 'excluir-coletor' }
    );
    salvarDB_coletores();
    renderColetores();
    showToast('🗑️ Coletor removido. O aparelho precisará de nova aprovação.', 'i');
    logAuditoria('SISTEMA', 'Coletor removido e aprovação revogada', coletorId);
    return true;
  } catch (e) {
    console.error('[Coletores] Erro ao remover:', e);
    showToast('Erro ao remover coletor: ' + e.message, 'e');
    throw e;
  }
}

async function aprovarColetor(id) {
  const col = state().coletores.find(c => c.id === id);
  const nome = col ? (col.nome_exibicao || `Coletor ${col.numero}`) : id;
  try {
    await FS_AN.collection(FS_COL_COLETORES).doc(id).set({
      aprovado: 'aprovado',
      bloqueado: false,
      ativo: true,
      status: 'offline',
      aprovado_em: firebase.firestore.FieldValue.serverTimestamp(),
      reprovado_em: firebase.firestore.FieldValue.delete(),
      bloqueado_em: firebase.firestore.FieldValue.delete()
    }, { merge: true });
    // BUG AO VIVO REAL (mesma classe do "excluir" acima): atualiza o estado
    // local na hora, sem esperar o onSnapshot voltar — mesmo padrão de
    // logoutOperadorColetor().
    if (col) {
      col.aprovado = 'aprovado'; col.bloqueado = false; col.ativo = true; col.status = 'offline';
      delete col.reprovado_em; delete col.bloqueado_em;
      salvarDB_coletores();
      renderColetores();
    }
    showToast('✅ ' + nome + ' aprovado!', 's');
    logAuditoria('SISTEMA', 'Coletor aprovado: ' + nome, id);
    return true;
  } catch (e) {
    console.error('[Coletores] Erro ao aprovar:', e);
    showToast('Erro ao aprovar: ' + e.message, 'e');
    throw e;
  }
}

async function reprovarColetor(id) {
  const col = state().coletores.find(c => c.id === id);
  const nome = col ? (col.nome_exibicao || `Coletor ${col.numero}`) : id;
  if (!window.confirm(`Reprovar a solicitação de ${nome}?`)) return false;
  try {
    await FS_AN.collection(FS_COL_COLETORES).doc(id).set({
      aprovado: 'reprovado',
      bloqueado: false,
      ativo: false,
      status: 'offline',
      sessao: null,
      reprovado_em: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    if (col) {
      col.aprovado = 'reprovado'; col.bloqueado = false; col.ativo = false; col.status = 'offline'; col.sessao = null;
      salvarDB_coletores();
      renderColetores();
    }
    showToast('❌ ' + nome + ' reprovado.', 'w');
    logAuditoria('SISTEMA', 'Coletor reprovado: ' + nome, id);
    return true;
  } catch (e) {
    console.error('[Coletores] Erro ao reprovar:', e);
    showToast('Erro ao reprovar: ' + e.message, 'e');
    throw e;
  }
}

async function bloquearColetor(id) {
  const col = state().coletores.find(c => c.id === id);
  const nome = col ? (col.nome_exibicao || `Coletor ${col.numero}`) : id;
  if (!window.confirm(`Bloquear ${nome}? Ninguém conseguirá entrar neste aparelho.`)) return false;
  return _bloquearColetorConfirmado(id, nome);
}

async function _bloquearColetorConfirmado(coletorId, nome) {
  try {
    await FS_AN.collection(FS_COL_COLETORES).doc(coletorId).set({
      aprovado: 'bloqueado',
      bloqueado: true,
      ativo: false,
      status: 'offline',
      sessao: null,
      bloqueado_em: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const col = state().coletores.find(c => c.id === coletorId);
    if (col) {
      col.aprovado = 'bloqueado'; col.bloqueado = true; col.ativo = false; col.status = 'offline'; col.sessao = null;
      salvarDB_coletores();
      renderColetores();
    }
    showToast('🚫 ' + nome + ' bloqueado.', 'w');
    logAuditoria('SISTEMA', 'Coletor bloqueado: ' + nome, coletorId);
    return true;
  } catch (e) {
    console.error('[Coletores] Erro ao bloquear:', e);
    showToast('Erro ao bloquear: ' + e.message, 'e');
    throw e;
  }
}

async function desbloquearColetor(id) {
  const col = state().coletores.find(c => c.id === id);
  const nome = col ? (col.nome_exibicao || `Coletor ${col.numero}`) : id;
  try {
    await FS_AN.collection(FS_COL_COLETORES).doc(id).set({
      aprovado: 'aprovado',
      bloqueado: false,
      ativo: true,
      status: 'offline',
      desbloqueado_em: firebase.firestore.FieldValue.serverTimestamp(),
      bloqueado_em: firebase.firestore.FieldValue.delete()
    }, { merge: true });
    if (col) {
      col.aprovado = 'aprovado'; col.bloqueado = false; col.ativo = true; col.status = 'offline';
      delete col.bloqueado_em;
      salvarDB_coletores();
      renderColetores();
    }
    showToast('🔓 ' + nome + ' desbloqueado.', 's');
    logAuditoria('SISTEMA', 'Coletor desbloqueado: ' + nome, id);
    return true;
  } catch (e) {
    console.error('[Coletores] Erro ao desbloquear:', e);
    showToast('Erro ao desbloquear: ' + e.message, 'e');
    throw e;
  }
}

// Reabre o turno de UM único coletor (sem precisar fechar o inventário
// inteiro). Usado quando o operador encerrou o turno por engano ou
// precisa continuar contando antes do inventário ser fechado.
async function reabrirTurnoColetor(id) {
  const col = state().coletores.find(c => c.id === id);
  const nome = col ? (col.nome_exibicao || `Coletor ${col.numero}`) : id;
  if (!window.confirm(`Reabrir o turno de ${nome}? O operador poderá voltar a fazer contagens neste coletor.`)) return false;
  try {
    await FS_AN.collection(FS_COL_COLETORES).doc(id).set({
      turno_encerrado: false,
      turno_reaberto_em: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    if (col) {
      col.turno_encerrado = false;
      salvarDB_coletores();
      renderColetores();
    }
    showToast('🔓 Turno de ' + nome + ' reaberto.', 's');
    logAuditoria('SISTEMA', 'Turno reaberto manualmente: ' + nome, id);
    return true;
  } catch (e) {
    console.error('[Coletores] Erro ao reabrir turno:', e);
    showToast('Erro ao reabrir turno: ' + e.message, 'e');
    throw e;
  }
}

// ── CÓDIGO DE APROVAÇÃO (pré-cadastro de um coletor novo) ────────────
// PEDIDO AO VIVO (2026-09-04): "no lugar de ficar entrando no coletor e
// ficar indo no analista aprovar... quero que no analista cadastre o ID do
// coletor e na hora que abrir o aplicativo ele já peça o id pra aprovar, e
// depois fique aprovado" — o Analista gera um código aqui (dt_codigos_coletor,
// doc id = o próprio código) com o nome/apelido já escolhido pro aparelho;
// o operador digita esse código na tela "aguardando aprovação" do Coletor
// e o aparelho entra aprovado na hora (via a Cloud Function
// resgatarCodigoAprovacaoColetor — as regras do Firestore não deixam o
// próprio Coletor se auto-aprovar, então o código é validado no servidor).
const FS_COL_CODIGOS = 'dt_codigos_coletor';
const _ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0/I/1 — evita confusão ao digitar
function _gerarCodigoAprovacaoAleatorio(tamanho) {
  let s = '';
  for (let i = 0; i < tamanho; i++) s += _ALFABETO_CODIGO[Math.floor(Math.random() * _ALFABETO_CODIGO.length)];
  return s;
}
async function gerarCodigoAprovacaoColetor(nomeColetor) {
  const nome = (nomeColetor || '').trim();
  if (!nome) { showToast('Dê um nome pro coletor antes de gerar o código.', 'w'); return null; }
  const raw = window.getDTRawFirestore ? window.getDTRawFirestore() : FS_AN;
  let codigo, ref, snap, tentativas = 0;
  do {
    codigo = _gerarCodigoAprovacaoAleatorio(6);
    ref = raw.collection(FS_COL_CODIGOS).doc(codigo);
    snap = await ref.get();
    tentativas++;
  } while (snap.exists && tentativas < 5);
  try {
    await ref.set({
      codigo, nome_coletor: nome,
      criado_em: firebase.firestore.FieldValue.serverTimestamp(),
      criado_por: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'analista',
      usado: false, usado_em: null, usado_por_device_id: null, usado_por_uid: null,
    });
    logAuditoria('SISTEMA', 'Código de aprovação gerado para novo coletor: ' + nome, codigo);
    return codigo;
  } catch (e) {
    console.error('[Coletores] Erro ao gerar código de aprovação:', e);
    showToast('Erro ao gerar código: ' + e.message, 'e');
    return null;
  }
}
async function carregarCodigosAprovacaoColetorPendentes() {
  try {
    const raw = window.getDTRawFirestore ? window.getDTRawFirestore() : FS_AN;
    const snap = await raw.collection(FS_COL_CODIGOS).where('usado', '==', false).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  } catch (e) {
    console.warn('[Coletores] Falha ao carregar códigos pendentes:', e.message);
    return [];
  }
}
async function cancelarCodigoAprovacaoColetor(codigo) {
  if (!window.confirm('Cancelar este código? Ele não poderá mais ser usado.')) return false;
  try {
    const raw = window.getDTRawFirestore ? window.getDTRawFirestore() : FS_AN;
    await raw.collection(FS_COL_CODIGOS).doc(codigo).delete();
    showToast('Código cancelado.', 'i');
    return true;
  } catch (e) {
    console.error('[Coletores] Erro ao cancelar código:', e);
    showToast('Erro ao cancelar código: ' + e.message, 'e');
    return false;
  }
}

// ── HEARTBEAT / STATUS AUTOMÁTICO ───────────────────────────────────
function atualizarHeartbeat(coletorId) {
  window._coletorHeartbeats[coletorId] = Date.now();
  const col = state().coletores.find(c => c.id === coletorId);
  if (col) { col.ultimo_ping = new Date().toISOString(); col.status = 'online'; salvarDB_coletores(); }
}

function verificarStatusColetores() {
  // Status real vem do Firebase via onSnapshot.
  // Fallback local: marca offline coletores sem ping há +2 min.
  const agora = Date.now();
  let mudou = false;
  const coletoresAtuais = Array.isArray(state().coletores) ? state().coletores : [];
  coletoresAtuais.forEach(col => {
    const ref = col.ultimo_ping ? new Date(col.ultimo_ping).getTime() : null;
    if (ref && (agora - ref) > OFFLINE_TIMEOUT_MS && col.status === 'online') {
      col.status = 'offline'; mudou = true;
    }
  });
  if (mudou && document.getElementById('page-coletores')?.classList.contains('on')) renderColetores();
}
setInterval(verificarStatusColetores, 15000);

// ── SIMULAÇÃO (testes) ───────────────────────────────────────────────
function abrirModalSimularColetor() {
  document.getElementById('sim-dev-nome').value = '';
  openModal('modal-simular-coletor');
}
function executarSimularColetor() {
  const apelido = (document.getElementById('sim-dev-nome')?.value || '').trim();
  const fakeDevId = 'DEV-SIM-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
  registrarDispositivoComoColetorSeNecessario(fakeDevId, apelido);
  closeModal('modal-simular-coletor');
}

// ── SINCRONIZAÇÃO OFFLINE ────────────────────────────────────────────
function registrarContagemOffline(contagem) {
  window._filaOffline.push({ ...contagem, _offline: true, _ts: Date.now() });
  localStorage.setItem('dt_fila_offline', JSON.stringify(window._filaOffline));
  const col = state().coletores.find(c => c.id === contagem.coletor_id);
  if (col) { col.contagens_pendentes = (col.contagens_pendentes||0) + 1; salvarDB_coletores(); }
}
function sincronizarFilaOffline() {
  if (!navigator.onLine || !window._filaOffline.length) return;
  const total = window._filaOffline.length;
  window._filaOffline.forEach(cnt => {
    const col = state().coletores.find(c => c.id === cnt.coletor_id);
    if (col) { col.contagens_enviadas = (col.contagens_enviadas||0)+1; col.contagens_pendentes = Math.max(0,(col.contagens_pendentes||0)-1); }
  });
  window._filaOffline = [];
  localStorage.setItem('dt_fila_offline', '[]');
  salvarDB_coletores();
  showToast(`🔄 ${total} contagem(ns) sincronizada(s)!`, 's');
  renderColetores();
}
window.addEventListener('online', sincronizarFilaOffline);

