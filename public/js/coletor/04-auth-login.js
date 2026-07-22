// ═══════════════════════════════════════════════════
//  LOGIN  (Firebase Auth)
// ═══════════════════════════════════════════════════


const DT_COLETOR_LOGIN_MEM_KEY = 'dt_coletor_login_lembrado_v1';
function _carregarLoginColetorLembrado(){
  try{
    const salvo=JSON.parse(localStorage.getItem(DT_COLETOR_LOGIN_MEM_KEY)||'null');
    if(!salvo?.login||!salvo?.senha)return;
    const l=document.getElementById('l-login'),p=document.getElementById('l-pass'),r=document.getElementById('l-remember');
    if(l)l.value=salvo.login;if(p)p.value=salvo.senha;if(r)r.checked=true;
  }catch(_){}
}
function _salvarOuLimparLoginColetor(login,senha){
  try{
    if(document.getElementById('l-remember')?.checked) localStorage.setItem(DT_COLETOR_LOGIN_MEM_KEY,JSON.stringify({login,senha}));
    else localStorage.removeItem(DT_COLETOR_LOGIN_MEM_KEY);
  }catch(_){}
}
window.addEventListener('DOMContentLoaded',_carregarLoginColetorLembrado);

// Monta email interno a partir do login (ex: jacson.souza → jacson.souza@daterrinhaalimentos.com.br)
function _montarEmail(login) {
  return login.trim().toLowerCase().replace(/\s+/g, '') + '@daterrinhaalimentos.com.br';
}

// Monta nome de exibição a partir do login (ex: jacson.souza → Jacson Souza)
function _nomeDisplay(login) {
  return login.trim().split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function doCriarConta() {
  const login = (document.getElementById('l-login')?.value || '').trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  if (!login || !pass) { toast('Preencha o login e a senha para criar conta', 'w'); return; }
  if (!/^[a-z]+\.[a-z]+$/.test(login)) { toast('Login deve ser no formato primeironome.ultimonome', 'e'); return; }
  if (pass.length < 6) { toast('Senha deve ter no mínimo 6 caracteres', 'e'); return; }
  const email = _montarEmail(login);
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = 'Criando conta...';
  AUTH.createUserWithEmailAndPassword(email, pass)
    .then(cred => {
      const displayName = _nomeDisplay(login);
      cred.user.updateProfile({ displayName }).catch(() => {});
      APP.operador = displayName;
      APP.uid      = cred.user.uid;
      document.getElementById('op-name-inv').textContent = displayName;
      toast('✅ Conta criada! Bem-vindo, ' + displayName + '!', 's');
      carregarInventarios();
      goScreen('inventarios');
    })
    .catch(err => {
      const msgs = {
        'auth/email-already-in-use': 'Login já cadastrado — use a opção Entrar',
        'auth/weak-password': 'Senha fraca — use ao menos 6 caracteres',
      };
      toast(msgs[err.code] || err.message, 'e');
    })
    .finally(() => { btn.disabled = false; btn.textContent = 'ENTRAR'; });
}

let _listenerAprovacaoLogin = null;

function _normalizarLoginEmail(valor) {
  const v = String(valor || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!v) return [];
  if (v.includes('@')) return [v];
  return [
    v + '@daterrinhaalimentos.com.br',
    v + '@daterrinhaalimnentos.com.br'
  ];
}

async function _configurarPersistenciaLogin() {
  try { await (window.DT_AUTH_READY || Promise.resolve()); } catch (_) {}
  const lembrar = document.getElementById('l-remember')?.checked === true;
  try {
    await AUTH.setPersistence(lembrar
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION);
  } catch (e) {
    console.warn('[Coletor] Persistência não suportada:', e.message);
  }
}

async function _liberarAcessoColetor(user, login, name) {
  let opDoc = null;
  try {
    const opSnap = await FS.collection('dt_operadores').doc(user.uid).get();
    if (opSnap.exists) opDoc = opSnap.data() || null;
  } catch (e) {
    console.warn('[Coletor] Falha ao carregar acesso do operador:', e.message);
  }

  APP.operador = {
    email: user.email,
    name,
    uid: user.uid,
    acesso_todas_lojas: opDoc?.acesso_todas_lojas === true,
    lojas_permitidas: Array.isArray(opDoc?.lojas_permitidas) ? opDoc.lojas_permitidas : []
  };
  APP.lojaFiltroInventario = '';
  APP.lojaFiltroAuditoria = '';

  ['op-name-inv','op-name-app','op-name-mode','op-name-aud'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = name;
  });
  const stOp = document.getElementById('st-op'); if (stOp) stOp.textContent = name;
  const stInicio = document.getElementById('st-inicio');
  if (stInicio && typeof fmtTime === 'function') stInicio.textContent = fmtTime(APP.sessionStart);

  _fecharTelaAprovacao();
  goScreen('mode');
  APP.modoAcesso = 'inventario';
  APP.modoPendente = 'inventario';
  carregarInventarios();
  if (typeof carregarAuditoriasMenu === 'function') carregarAuditoriasMenu();
  if (typeof iniciarSyncBackground === 'function') iniciarSyncBackground();
  toast('Bem-vindo, ' + name + '!', 's');
}

function _aguardarAprovacaoEmTempoReal(user, login, name) {
  if (_listenerAprovacaoLogin) { try { _listenerAprovacaoLogin(); } catch (_) {} }
  const deviceId = obterDeviceId();
  _listenerAprovacaoLogin = FS.collection(FCOL.coletores).doc(deviceId).onSnapshot(async snap => {
    if (!snap.exists) return;
    const dados = snap.data() || {};
    if (dados.aprovado === 'aprovado') {
      try { _listenerAprovacaoLogin(); } catch (_) {}
      _listenerAprovacaoLogin = null;
      const status = await registrarColetorNoFirestore({ email:user.email, name, uid:user.uid });
      if (status === 'aprovado') await _liberarAcessoColetor(user, login, name);
    } else if (dados.aprovado === 'bloqueado') {
      try { _listenerAprovacaoLogin(); } catch (_) {}
      _listenerAprovacaoLogin = null;
      _fecharTelaAprovacao();
      _mostrarTelaBloqueado();
    }
  }, err => console.warn('[Coletor] Listener de aprovação:', err.message));
}

async function doLogin(ev) {
  if (ev?.preventDefault) ev.preventDefault();
  const login = (document.getElementById('l-login')?.value || '').trim().toLowerCase();
  const pass  = document.getElementById('l-pass')?.value || '';
  const btnLogin = document.getElementById('btn-login');
  const fbLogin = document.getElementById('fb-login-erro');
  const setBtn = (txt, disabled) => { if (btnLogin) { btnLogin.disabled=disabled; btnLogin.textContent=txt; } };
  const setFb = (msg, tipo='err') => {
    if (fbLogin) fbLogin.innerHTML = msg ? `<div class="fb ${tipo}" style="margin-top:8px">${msg}</div>` : '';
    if (msg) toast(msg.replace(/^✗\s*/, ''), tipo === 'err' ? 'e' : 'w');
  };

  if (!login) { setFb('✗ Informe o login'); return false; }
  if (!pass) { setFb('✗ Informe a senha'); return false; }
  const emails = _normalizarLoginEmail(login);
  if (!emails.length) { setFb('✗ Login inválido'); return false; }

  _salvarOuLimparLoginColetor(login, pass);
  setBtn('Entrando…', true); setFb('');
  try {
    await _configurarPersistenciaLogin();
    let cred = null, ultimoErro = null;
    for (const email of emails) {
      try { cred = await AUTH.signInWithEmailAndPassword(email, pass); break; }
      catch (e) { ultimoErro = e; }
    }
    if (!cred) throw ultimoErro || new Error('Falha ao autenticar');

    const user = cred.user;
    const baseLogin = String(user.email || login).split('@')[0];
    const name = user.displayName || _nomeDisplay(baseLogin);
    setBtn('Verificando aparelho…', true);
    const status = await registrarColetorNoFirestore({ email:user.email, name, uid:user.uid });

    if (status === 'bloqueado') {
      setBtn('ENTRAR', false); _mostrarTelaBloqueado(); return false;
    }
    if (status === 'pendente') {
      // Mantém a autenticação para o Firestore conseguir ouvir a aprovação.
      setBtn('ENTRAR', false);
      _mostrarTelaAguardandoAprovacao(name);
      _aguardarAprovacaoEmTempoReal(user, baseLogin, name);
      return false;
    }
    if (status === 'erro') throw new Error('Não foi possível consultar o cadastro deste coletor no Firebase.');

    setBtn('ENTRAR', false);
    await _liberarAcessoColetor(user, baseLogin, name);
  } catch (err) {
    setBtn('ENTRAR', false);
    setFb('✗ ' + traduzirErroAuth(err?.code || err?.message || String(err)));
  }
  return false;
}

window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-login');
  if (btn) btn.addEventListener('click', doLogin);
  const login = document.getElementById('l-login');
  const pass = document.getElementById('l-pass');
  [login, pass].filter(Boolean).forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.keyCode === 13) doLogin(e);
  }));
});

function _mostrarTelaAguardandoAprovacao(nome) {
  const box = document.getElementById('login-aprovacao-box');
  const msg = document.getElementById('login-aprovacao-msg');
  if (msg) msg.textContent = nome ? 'Olá, ' + nome + '! ' : '';
  if (box) box.style.display = 'flex';
}

function _mostrarTelaBloqueado() {
  const box = document.getElementById('login-bloqueado-box');
  if (box) box.style.display = 'flex';
}

function _fecharTelaAprovacao() {
  const b1 = document.getElementById('login-aprovacao-box');
  const b2 = document.getElementById('login-bloqueado-box');
  if (b1) b1.style.display = 'none';
  if (b2) b2.style.display = 'none';
}

function traduzirErroAuth(code) {
  const msgs = {
    'auth/invalid-email':          'Email inválido',
    'auth/user-not-found':         'Usuário não encontrado',
    'auth/wrong-password':         'Senha incorreta',
    'auth/invalid-credential':     'Credenciais inválidas',
    'auth/too-many-requests':      'Muitas tentativas — aguarde',
    'auth/network-request-failed': 'Sem conexão com a internet',
  };
  return msgs[code] || code;
}

function togglePass() {
  const f = document.getElementById('l-pass');
  f.type = f.type === 'password' ? 'text' : 'password';
}

function doLogout() {
  showConfirm('Sair do sistema?', _doLogoutConfirmado, { title: 'Sair', icon: '👋', okLabel: 'Sair', okColor: '#ff4757' });
}

function _doLogoutConfirmado() {
  if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
  if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
  if (_invListener)    { _invListener(); _invListener = null; }      // cancela polling
  if (_invPollInterval){ clearInterval(_invPollInterval); _invPollInterval = null; }
  // Marca coletor offline e limpa sessão antes de sair
  marcarColetorOffline().finally(() => {
    if (FILA_ENVIO.length > 0 && navigator.onLine) {
      enviarFilaPendente().finally(() => { AUTH.signOut(); APP.operador = null; goScreen('login'); });
    } else {
      AUTH.signOut();
      APP.operador = null;
      goScreen('login');
    }
  });
}


