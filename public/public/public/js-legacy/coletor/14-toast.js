// ═══════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════
var toastT;
function toast(msg, type) {
    if (type === void 0) { type = ''; }
    var el = document.getElementById('toast');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { return el.classList.remove('show'); }, 2800);
}
// ── Modal de Confirmação customizado (substitui confirm() nativo) ────
function showConfirm(msg, onOk, _a) {
    var _b = _a === void 0 ? {} : _a, _c = _b.title, title = _c === void 0 ? 'Confirmar' : _c, _d = _b.icon, icon = _d === void 0 ? '⚠️' : _d, _e = _b.okLabel, okLabel = _e === void 0 ? 'Confirmar' : _e, _f = _b.okColor, okColor = _f === void 0 ? '#ff4757' : _f;
    var modal = document.getElementById('modal-confirm');
    document.getElementById('mc-icon').textContent = icon;
    document.getElementById('mc-title').textContent = title;
    document.getElementById('mc-msg').textContent = msg;
    var btnOk = document.getElementById('mc-ok');
    btnOk.textContent = okLabel;
    btnOk.style.background = okColor;
    btnOk.style.color = '#fff';
    btnOk.onclick = function () { modal.style.display = 'none'; onOk(); };
    modal.style.display = 'flex';
}
