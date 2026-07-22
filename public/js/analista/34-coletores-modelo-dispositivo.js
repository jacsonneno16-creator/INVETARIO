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

const OFFLINE_TIMEOUT_MS = 2 * 60 * 1000;

if (!Array.isArray(state().coletores)) window.AnalistaState.replaceSlice('coletores', [], { source: 'coletores-init' });
if (!window._coletorHeartbeats) window._coletorHeartbeats = {};
if (!window._filaOffline) window._filaOffline = JSON.parse(localStorage.getItem('dt_fila_offline') || '[]');

function salvarDB_coletores() {
  localStorage.setItem('dt_db_coletores', JSON.stringify(state().coletores));
}
function carregarDB_coletores() {
  try { const r = localStorage.getItem('dt_db_coletores'); if (r) window.AnalistaState.replaceSlice('coletores', JSON.parse(r), { source: 'coletores-cache-load' }); } catch(e){}
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
        const op = c.sessao ? ` — ${c.sessao.operador} (em uso)` : ' — livre';
        return `<option value="${c.id}">Coletor ${c.numero}${c.apelido ? ' · ' + c.apelido : ''}${op}</option>`;
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
function logoutOperadorColetor(colId) {
  const col = state().coletores.find(c => c.id === colId);
  if (!col) return;
  const nomeOp = col.sessao?.operador || 'Operador';
  col.sessao = null;
  col.status = 'offline';
  delete window._coletorHeartbeats[colId];
  salvarDB_coletores();
  renderColetores();
  logAuditoria('SISTEMA', `Operador ${nomeOp} fez logout do Coletor ${col.numero}`, '');
  showToast(`🔴 ${nomeOp} saiu do Coletor ${col.numero}`, 'w');
}

function excluirColetor(id) {
  showConfirm('Remover este coletor do sistema? O histórico de contagens é mantido.', () => _removerColetorConfirmado(id), { title: 'Remover coletor', icon: '🗑️', okLabel: 'Remover', okClass: 'btn-danger' }); return;
}

async function _removerColetorConfirmado(coletorId) {
  try {
    await FS_AN.collection('dt_coletores').doc(coletorId).delete();
    // Remoção local só acontece DEPOIS de confirmar sucesso no Firestore —
    // caso contrário o listener em tempo real poderia trazer o coletor de
    // volta e dar a impressão de que "não excluiu".
    window.AnalistaState.replaceSlice('coletores', (state().coletores || []).filter(c => c.id !== coletorId), { source: 'removerColetor' });
    salvarDB_coletores();
    renderColetores();
    showToast('🗑️ Coletor removido', 'i');
    logAuditoria('SISTEMA', 'Coletor removido', coletorId);
  } catch (e) {
    showToast('Erro ao remover coletor: ' + e.message, 'e');
  }
}

async function aprovarColetor(id) {
  const col = state().coletores.find(c => c.id === id);
  const nome = col ? 'Coletor ' + col.numero : id;
  try {
    await FS_AN.collection('dt_coletores').doc(id).set({ aprovado: 'aprovado', status: 'offline', aprovado_em: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (col) { col.aprovado='aprovado'; col.status='offline'; salvarDB_coletores(); renderColetores(); }
    showToast('✅ ' + nome + ' aprovado! O coletor será liberado automaticamente.', 's');
    logAuditoria('SISTEMA', 'Coletor aprovado: ' + nome, id);
  } catch(e) { showToast('Erro ao aprovar: ' + e.message, 'e'); }
}

async function bloquearColetor(id) {
  const col = state().coletores.find(c => c.id === id);
  const nome = col ? 'Coletor ' + col.numero : id;
  showConfirm(`Bloquear ${escHTML(nome)}? Ninguém conseguirá logar neste aparelho.`, () => _bloquearColetorConfirmado(id, nome), { title: 'Bloquear coletor', icon: '🔒', okLabel: 'Bloquear', okClass: 'btn-danger' }); return;
}

async function _bloquearColetorConfirmado(coletorId, nome) {
  try {
    await FS_AN.collection('dt_coletores').doc(coletorId).set({ aprovado: 'bloqueado', status: 'offline', sessao: null, bloqueado_em: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const c = state().coletores.find(x => x.id === coletorId); if (c) { c.aprovado='bloqueado'; c.status='offline'; c.sessao=null; salvarDB_coletores(); renderColetores(); }
    showToast('🚫 ' + nome + ' bloqueado.', 'w');
    logAuditoria('SISTEMA', 'Coletor bloqueado: ' + nome, coletorId);
  } catch(e) { showToast('Erro ao bloquear: ' + e.message, 'e'); }
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
  state().coletores.forEach(col => {
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


window.aprovarColetor=aprovarColetor; window.bloquearColetor=bloquearColetor; window.excluirColetor=excluirColetor; window._removerColetorConfirmado=_removerColetorConfirmado; window._bloquearColetorConfirmado=_bloquearColetorConfirmado;
