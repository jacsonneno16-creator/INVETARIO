// ══════════════════════════════════════════════════════════════════════
//  00-AUTH-LOGIN.JS (VERSÃO AJUSTADA E ESTÁVEL)
// ══════════════════════════════════════════════════════════════════════

function state(){ return window.AnalistaStore.getState(); }

// ── FIREBASE ─────────────────────────────────────────────────────────
getDTFirebaseApp();
const FS_AN   = getDTFirestore();
const AUTH_AN = getDTAuth();

window._currentAnalistaUser = null;

// ── LOGIN ────────────────────────────────────────────────────────────

function doLoginAnalista() {
  const email = (document.getElementById('an-email')?.value || '').trim().toLowerCase();
  const senha = document.getElementById('an-pass')?.value || '';

  _clearLoginErro();

  if (!email) return _setLoginErro('Informe o e-mail.');
  if (!senha) return _setLoginErro('Informe a senha.');

  AUTH_AN.setPersistence(firebase.auth.Auth.Persistence.NONE)
    .then(() => AUTH_AN.signInWithEmailAndPassword(email, senha))
    .catch(err => _setLoginErro(err.message));
}

function doLogoutAnalista() {
  AUTH_AN.signOut().then(() => {
    window._currentAnalistaUser = null;
    _mostrarLogin();
  });
}

function togglePassAnalista() {
  const f = document.getElementById('an-pass');
  if (f) f.type = f.type === 'password' ? 'text' : 'password';
}

function _setLoginErro(msg) {
  const el = document.getElementById('login-error-msg');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
}

function _clearLoginErro() {
  const el = document.getElementById('login-error-msg');
  if (el) {
    el.textContent = '';
    el.classList.remove('show');
  }
}

// ── LOGIN OK ─────────────────────────────────────────────────────────

function _onAnalistaLogado(user) {
  window._currentAnalistaUser = user;

  if (window.AnalistaStore) {
    window.AnalistaStore.dispatch(window.AnalistaActions.setCurrentUser(user));
  }

  const nome = user.displayName || user.email.split('@')[0];

  const elNome   = document.getElementById('user-name-display');
  const elAvatar = document.getElementById('avatar-initials');

  if (elNome)   elNome.textContent   = nome;
  if (elAvatar) elAvatar.textContent = nome.slice(0,2).toUpperCase();

  _mostrarApp();

  // 🔥 CHAMADA SEGURA DO INIT
  if (window.AnalistaBootstrap?.initApp) {
    window.AnalistaBootstrap.initApp();
  } else if (window.initApp) {
    window.initApp();
  } else {
    console.error('[Auth] initApp não disponível');
  }

  logSistema('SISTEMA', 'Login realizado', { email: user.email });
}

// ── UI ───────────────────────────────────────────────────────────────

function _mostrarApp() {
  document.getElementById('screen-login')?.style.setProperty('display','none');
  document.getElementById('app-main')?.style.setProperty('display','flex');
}

function _mostrarLogin() {
  document.getElementById('app-main')?.style.setProperty('display','none');
  document.getElementById('screen-login')?.style.setProperty('display','flex');
}

// ── SESSION ──────────────────────────────────────────────────────────

let _authAnalistaInicializado = false;
AUTH_AN.setPersistence(firebase.auth.Auth.Persistence.NONE)
  .then(() => AUTH_AN.signOut().catch(() => {}))
  .finally(() => {
    _authAnalistaInicializado = true;
    window._currentAnalistaUser = null;
    _mostrarLogin();
  });

AUTH_AN.onAuthStateChanged(user => {
  if (!_authAnalistaInicializado) return;
  if (user) _onAnalistaLogado(user);
  else _mostrarLogin();
});

// ── UTIL ─────────────────────────────────────────────────────────────

function showToast(msg) {
  console.log('[Toast]', msg);
}

function showConfirm(msg, ok) {
  if (confirm(msg)) ok();
}

function logSistema(tipo, desc, dados) {
  console.log('[LOG]', tipo, desc, dados);
}

function atualizarBadgesNav(){}

function updateStaticTexts(){}

// ── EXPORT GLOBAL (🔥 ESSENCIAL PRA NÃO DAR ERRO) ─────────────────────

window.doLoginAnalista = doLoginAnalista;
window.doLogoutAnalista = doLogoutAnalista;
window.togglePassAnalista = togglePassAnalista;

window.updateStaticTexts = updateStaticTexts;
window.atualizarBadgesNav = atualizarBadgesNav;

window.showToast = showToast;
window.showConfirm = showConfirm;
window.logSistema = logSistema;