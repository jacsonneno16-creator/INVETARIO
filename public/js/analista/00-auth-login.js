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
window.FS = window.FS || FS_AN;
window.AUTH = window.AUTH || AUTH_AN;

window._currentAnalistaUser = null;
let _loginSolicitadoPeloUsuario = false;
const DT_LOGIN_MEM_KEY = 'dt_analista_login_lembrado_v1';

function _normalizarEmailAnalista(valor) {
  // Mantém exatamente o e-mail cadastrado no Firebase Authentication.
  // Apenas remove espaços e converte para minúsculas.
  return String(valor || '').trim().toLowerCase().replace(/\s+/g, '');
}

function _carregarLoginLembrado() {
  try {
    const salvo = JSON.parse(localStorage.getItem(DT_LOGIN_MEM_KEY) || 'null');
    if (!salvo || !salvo.email || !salvo.senha) return;
    const email = document.getElementById('an-email');
    const senha = document.getElementById('an-pass');
    const lembrar = document.getElementById('an-remember');
    if (email) email.value = salvo.email;
    if (senha) senha.value = salvo.senha;
    if (lembrar) lembrar.checked = true;
  } catch (_) {}
}

function _salvarOuLimparLogin(email, senha) {
  const lembrar = document.getElementById('an-remember')?.checked === true;
  try {
    if (lembrar) localStorage.setItem(DT_LOGIN_MEM_KEY, JSON.stringify({ email, senha }));
    else localStorage.removeItem(DT_LOGIN_MEM_KEY);
  } catch (_) {}
}

// ── LOGIN ────────────────────────────────────────────────────────────

function doLoginAnalista() {
  const email = _normalizarEmailAnalista(document.getElementById('an-email')?.value || '');
  const senha = document.getElementById('an-pass')?.value || '';

  _clearLoginErro();

  if (!email) return _setLoginErro('Informe o e-mail.');
  if (!senha) return _setLoginErro('Informe a senha.');

  _salvarOuLimparLogin(email, senha);
  _loginSolicitadoPeloUsuario = true;
  AUTH_AN.setPersistence(firebase.auth.Auth.Persistence.NONE)
    .then(() => AUTH_AN.signInWithEmailAndPassword(email, senha))
    .catch(err => { _loginSolicitadoPeloUsuario = false; _setLoginErro(_traduzirErroLoginAnalista(err)); });
}

function doLogoutAnalista() {
  _loginSolicitadoPeloUsuario = false;
  AUTH_AN.signOut().then(() => {
    window._currentAnalistaUser = null;
    _mostrarLogin();
  });
}

function togglePassAnalista() {
  const f = document.getElementById('an-pass');
  if (f) f.type = f.type === 'password' ? 'text' : 'password';
}

function _traduzirErroLoginAnalista(err) {
  const code = err?.code || '';
  const mensagens = {
    'auth/invalid-credential': 'E-mail ou senha incorretos. Digite exatamente o mesmo e-mail cadastrado no Firebase Authentication.',
    'auth/invalid-email': 'O e-mail informado é inválido.',
    'auth/user-disabled': 'Este usuário está desativado no Firebase.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    'auth/network-request-failed': 'Não foi possível conectar ao Firebase. Verifique a internet.'
  };
  return mensagens[code] || err?.message || 'Não foi possível realizar o login.';
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
// Nunca reaproveita sessão anterior. Só abre o painel depois que o usuário
// clicar em Entrar ou pressionar Enter com e-mail e senha preenchidos.
async function _iniciarAuthAnalista() {
  _loginSolicitadoPeloUsuario = false;
  _mostrarLogin();

  const email = document.getElementById('an-email');
  const senha = document.getElementById('an-pass');
  if (email) email.value = '';
  if (senha) senha.value = '';
  _carregarLoginLembrado();

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