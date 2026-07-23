// ══════════════════════════════════════════════════════════════════════
//  00-AUTH-LOGIN.JS (VERSÃO AJUSTADA E ESTÁVEL)
// ══════════════════════════════════════════════════════════════════════

function state(){ return window.AnalistaStore.getState(); }

// ── FIREBASE ─────────────────────────────────────────────────────────
getDTFirebaseApp();
const FS_AN   = getDTFirestore();
const AUTH_AN = getDTAuth();
// Exposto explicitamente em window pois firebaseService.js acessa via global.FS_AN
window.FS_AN   = FS_AN;
window.AUTH_AN = AUTH_AN;

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
  AUTH_AN.setPersistence((document.getElementById('an-remember')?.checked === true)
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION)
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

  try {
    const raw = window.getDTRawFirestore();
    const acc = await raw.collection('usuarios_acessos').doc(user.uid).get();
    let acesso = acc.exists ? { uid:user.uid, ...acc.data() } : null;

    // Bootstrap e autorrecuperação do administrador mestre.
    // Em instalação nova cria Loja Matriz e a própria permissão automaticamente.
    acesso = await window.DTLoja.bootstrapAdministrador(user, acesso);

    // Usuários antigos sem cadastro continuam compatíveis; usuários comuns já
    // cadastrados continuam obedecendo às lojas definidas pelo administrador.
    window.DT_USUARIO_ACESSO_ATUAL = acesso || {
      uid:user.uid, email:user.email, acesso_todas_lojas:true, lojas_permitidas:[]
    };

    const permitidas = await window.DTLoja.garantirLojaInicial();
    if (!permitidas.length) throw new Error('Este login não possui acesso a nenhuma loja. Solicite a liberação ao administrador.');
    const atual = window.getDTLojaAtiva();
    if (atual && !permitidas.some(l=>l.id===atual)) window.setDTLojaAtiva('');
    await window.DTLoja.selecionarInterativamente('Selecione a loja do inventário');

    // A migração dos dados legados não deve bloquear o login nem iniciar
    // múltiplas filas de escrita. Ela é disparada depois que o painel abre,
    // com trava única, checkpoints e lotes pequenos.
  }
  catch(e){ _setLoginErro('Não foi possível preparar o ambiente da loja: '+e.message); await AUTH_AN.signOut(); return; }
  _mostrarApp();
  atualizarIndicadorLojaAtual();

  // 🔥 CHAMADA SEGURA DO INIT
  if (window.AnalistaBootstrap?.initApp) {
    window.AnalistaBootstrap.initApp();
  } else if (window.initApp) {
    window.initApp();
  } else {
    console.error('[Auth] initApp não disponível');
  }

  logSistema('SISTEMA', 'Login realizado', { email: user.email });

  if (typeof window.sincronizarDadosLegadosAutomaticamente === 'function') {
    setTimeout(function(){
      window.sincronizarDadosLegadosAutomaticamente().then(function(migracao){
        if (migracao && migracao.executado) {
          console.info('[Multiloja] Migração legada concluída:', migracao.total);
          try { showToast('Dados antigos carregados na loja atual.', 'success'); } catch (_) {}
        }
      }).catch(function(error){
        console.error('[Multiloja] Falha na migração controlada:', error);
        try { showToast('Não foi possível concluir a migração dos dados antigos. Tente novamente pela Gestão de Lojas.', 'error'); } catch (_) {}
      });
    }, 1200);
  }
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

// ── TOAST (feedback visual real, usa a <div id="toast"> já existente no HTML) ──
let _toastTimer;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) { console.log('[Toast]', msg); return; }
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  void el.offsetWidth; // força reflow para reiniciar a animação
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── MODAL GENÉRICO (abre/fecha qualquer .modal-bg pelo id) ──
// Antes desta correção, openModal/closeModal eram CHAMADAS em ~20 lugares do
// app mas nunca haviam sido definidas — todo modal (login rápido de operador,
// simular coletor, importar endereços etc.) simplesmente não abria.
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// ── CONFIRMAÇÃO CUSTOMIZADA (substitui o confirm() nativo) ──
function showConfirm(msg, onOk, opts) {
  opts = opts || {};
  const modalId = 'modal-confirm-generico';
  const modal = document.getElementById(modalId);
  if (!modal) { if (confirm(msg)) onOk(); return; } // fallback de segurança
  document.getElementById('mcg-icon').textContent  = opts.icon  || '⚠️';
  document.getElementById('mcg-title').textContent = opts.title || 'Confirmar';
  document.getElementById('mcg-msg').textContent   = msg;
  const btnOk = document.getElementById('mcg-ok');
  btnOk.textContent = opts.okLabel || 'Confirmar';
  btnOk.className   = 'btn ' + (opts.okClass || 'btn-danger');
  btnOk.style.background = opts.okColor || '';
  btnOk.onclick = () => { closeModal(modalId); onOk(); };
  openModal(modalId);
}

// ── LOG DE AUDITORIA (grava no Firestore; nunca lança erro) ──
// Antes desta correção, logAuditoria() era chamada dentro de aprovarColetor()
// e bloquearColetor() mas não existia — a função estourava um erro DEPOIS do
// Firestore já ter sido atualizado com sucesso, e esse erro caía no catch()
// da própria função, fazendo aparecer "Erro ao aprovar" mesmo quando a
// aprovação tinha funcionado.
function logAuditoria(tipo, descricao, dados) {
  try {
    if (window.FS_AN) {
      const user = window._currentAnalistaUser;
      window.FS_AN.collection('dt_logs_analista').add({
        tipo:       tipo || 'SISTEMA',
        descricao:  descricao || '',
        dados:      dados !== undefined ? dados : null,
        usuario:    user ? (user.displayName || user.email) : null,
        criado_em:  new Date().toISOString(),
      }).catch(e => console.warn('[logAuditoria]', e.message));
    }
  } catch (e) { console.warn('[logAuditoria]', e); }
  console.log('[LOG]', tipo, descricao, dados);
}
function logSistema(tipo, desc, dados) { return logAuditoria(tipo, desc, dados); }

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
window.logAuditoria = logAuditoria;
window.openModal = openModal;
window.closeModal = closeModal;

async function atualizarIndicadorLojaAtual(){
  try{
    const lojas=await window.DTLoja.listar(false), id=window.getDTLojaAtiva();
    const loja=lojas.find(x=>x.id===id);
    const el=document.getElementById('dt-loja-atual-label'); if(el) el.textContent=loja?.nome||id||'Sem loja';
  }catch(_){ }
}
async function trocarLojaInventario(){
  const anterior=window.getDTLojaAtiva();
  const nova=await window.DTLoja.selecionarInterativamente('Trocar ambiente de loja', true);
  if(!nova || nova===anterior)return;
  await atualizarIndicadorLojaAtual();
  location.reload();
}
window.trocarLojaInventario=trocarLojaInventario;
