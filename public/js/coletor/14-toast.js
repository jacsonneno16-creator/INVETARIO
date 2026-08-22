// ═══════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════
let toastT;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.className = 'toast' + (type?' '+type:'');
  el.textContent = msg;
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(()=>el.classList.remove('show'), 2800);
}

// ── Modal de Confirmação customizado (substitui confirm() nativo) ────
// `onCancel` (opcional) — botão "Cancelar" só fechava o modal antes;
// agora também avisa quem chamou, pra fluxos que precisam saber que o
// operador desistiu (não só ignorar em silêncio). Sobrescreve o
// onclick a cada chamada, então chamadas antigas sem onCancel continuam
// funcionando exatamente igual (fecha e não faz nada).
function showConfirm(msg, onOk, { title = 'Confirmar', icon = '⚠️', okLabel = 'Confirmar', okColor = '#ff4757', onCancel } = {}) {
  const modal = document.getElementById('modal-confirm');
  document.getElementById('mc-icon').textContent  = icon;
  document.getElementById('mc-title').textContent = title;
  document.getElementById('mc-msg').textContent   = msg;
  const btnOk = document.getElementById('mc-ok');
  btnOk.textContent       = okLabel;
  btnOk.style.background  = okColor;
  btnOk.style.color       = '#fff';
  btnOk.onclick = () => { modal.style.display = 'none'; onOk(); };
  const btnCancel = document.getElementById('mc-cancel');
  if (btnCancel) btnCancel.onclick = () => { modal.style.display = 'none'; if (typeof onCancel === 'function') onCancel(); };
  modal.style.display = 'flex';
}

