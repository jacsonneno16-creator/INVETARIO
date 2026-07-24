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
function showConfirm(msg, onOk, { title = 'Confirmar', icon = '⚠️', okLabel = 'Confirmar', okColor = '#ff4757' } = {}) {
  const modal = document.getElementById('modal-confirm');
  document.getElementById('mc-icon').textContent  = icon;
  document.getElementById('mc-title').textContent = title;
  document.getElementById('mc-msg').textContent   = msg;
  const btnOk = document.getElementById('mc-ok');
  btnOk.textContent       = okLabel;
  btnOk.style.background  = okColor;
  btnOk.style.color       = '#fff';
  btnOk.onclick = () => { modal.style.display = 'none'; onOk(); };
  modal.style.display = 'flex';
}

