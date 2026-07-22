// ══════════════════════════════════════════════════════════════════════
//  00-AUTH-LOGIN.JS (VERSÃO AJUSTADA E ESTÁVEL)
// ══════════════════════════════════════════════════════════════════════

function state(){ return window.AnalistaStore.getState(); }

// ── FIREBASE ─────────────────────────────────────────────────────────
getDTFirebaseApp();
const FS_AN   = getDTFirestore();
const AUTH_AN = getDTAuth();
window.FS_AN = FS_AN;
window.AUTH_AN = AUTH_AN;

window._currentAnalistaUser = null;
let _loginSolicitadoPeloUsuario = false;

// ── LOGIN ────────────────────────────────────────────────────────────

function doLoginAnalista() {
  const email = (document.getElementById('an-email')?.value || '').trim().toLowerCase();
  const senha = document.getElementById('an-pass')?.value || '';

  _clearLoginErro();

  if (!email) return _setLoginErro('Informe o e-mail.');
  if (!senha) return _setLoginErro('Informe a senha.');

  _loginSolicitadoPeloUsuario = true;
  AUTH_AN.setPersistence(firebase.auth.Auth.Persistence.NONE)
    .then(() => AUTH_AN.signInWithEmailAndPassword(email, senha))
    .catch(err => { _loginSolicitadoPeloUsuario = false; _setLoginErro(err.message); });
}

function doLogoutAnalista() {
  _loginSolicitadoPeloUsuario = false;
  AUTH_AN.signOut().then(() => {
    window._currentAnalistaUser = null;
let _loginSolicitadoPeloUsuario = false;
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

async function _onAnalistaLogado(user) {
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

  // Garante que o token de autenticação já esteja válido antes das leituras.
  try { await user.getIdToken(true); } catch(e) { console.warn('[Auth] Token:', e.message); }

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
// Nunca reaproveita sessão anterior. Só abre o painel depois que o usuário
// clicar em Entrar ou pressionar Enter com e-mail e senha preenchidos.
async function _iniciarAuthAnalista() {
  _loginSolicitadoPeloUsuario = false;
  _mostrarLogin();

  const email = document.getElementById('an-email');
  const senha = document.getElementById('an-pass');
  if (email) email.value = '';
  if (senha) senha.value = '';

  try {
    await AUTH_AN.setPersistence(firebase.auth.Auth.Persistence.NONE);
    await AUTH_AN.signOut();
  } catch (e) {
    console.warn('[Auth] Limpeza da sessão anterior:', e.message);
  }

  AUTH_AN.onAuthStateChanged(async user => {
    if (user && _loginSolicitadoPeloUsuario) {
      _loginSolicitadoPeloUsuario = false;
      _onAnalistaLogado(user);
      return;
    }
    if (user && !_loginSolicitadoPeloUsuario) {
      // Proteção extra contra login restaurado pelo navegador/Firebase.
      try { await AUTH_AN.signOut(); } catch (_) {}
    }
    _mostrarLogin();
  });
}

_iniciarAuthAnalista();

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