// ═══════════════════════════════════════════════════
//  LOGIN  (Firebase Auth)
// ═══════════════════════════════════════════════════

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

function doLogin() {
  const login = (document.getElementById('l-login')?.value || '').trim().toLowerCase();
  const pass  = document.getElementById('l-pass')?.value || '';

  if (!login) { toast('Informe o login', 'e'); return; }
  if (!pass)  { toast('Informe a senha', 'e'); return; }

  // Regex permissiva: aceita qualquer login com pelo menos um ponto
  // ex: joao.silva, joao.da.silva, maria.souza2, etc.
  if (!/^[a-z0-9._-]+\.[a-z0-9._-]+$/.test(login)) {
    toast('Login inválido — use o formato nome.sobrenome', 'e');
    return;
  }

  const email    = _montarEmail(login);
  const btnLogin = document.getElementById('btn-login');
  const fbLogin  = document.getElementById('fb-login-erro'); // div de feedback opcional

  const _setBtn = (txt, disabled) => {
    if (btnLogin) { btnLogin.disabled = disabled; btnLogin.textContent = txt; }
  };
  const _setFb = (msg, tipo) => {
    if (fbLogin) { fbLogin.innerHTML = msg ? `<div class="fb ${tipo}" style="margin-top:8px">${msg}</div>` : ''; }
    if (msg) toast(msg, tipo === 'err' ? 'e' : 'w');
  };

  _setBtn('Entrando…', true);
  _setFb('', '');

  // Timeout de segurança: reabilita o botão se Firebase demorar demais
  const _tid = setTimeout(() => {
    _setBtn('ENTRAR', false);
    _setFb('⏱ Conexão lenta — verifique a internet e tente novamente', 'warn');
  }, 15000);

  AUTH.setPersistence(firebase.auth.Auth.Persistence.NONE)
    .then(() => AUTH.signInWithEmailAndPassword(email, pass))
    .then(async cred => {
      clearTimeout(_tid);
      const user = cred.user;
      const name = user.displayName || _nomeDisplay(login);

      _setBtn('Verificando aparelho…', true);

      let status;
      try {
        status = await registrarColetorNoFirestore({ email: user.email, name, uid: user.uid });
      } catch(e) {
        status = 'erro';
      }

      if (status === 'bloqueado') {
        AUTH.signOut();
        _setBtn('ENTRAR', false);
        _mostrarTelaBloqueado();
        return;
      }

      if (status === 'pendente' || status === 'erro') {
        AUTH.signOut();
        _setBtn('ENTRAR', false);
        _mostrarTelaAguardandoAprovacao(name);
        return;
      }

      // ── Aprovado — liberar acesso ──
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

      // Atualizar nome em todos os elementos (com guards — nem todos existem na tela de login)
      ['op-name-inv','op-name-app','op-name-mode','op-name-aud'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = name;
      });
      const stOp     = document.getElementById('st-op');     if (stOp)     stOp.textContent     = name;
      const stInicio = document.getElementById('st-inicio'); if (stInicio) stInicio.textContent = fmtTime(APP.sessionStart);

      _setBtn('ENTRAR', false);
      goScreen('mode');
      APP.modoAcesso = 'inventario';
      APP.modoPendente = 'inventario';
      carregarInventarios();
      carregarAuditoriasMenu();
      iniciarSyncBackground();
      toast('Bem-vindo, ' + name + '!', 's');
    })
    .catch(err => {
      clearTimeout(_tid);
      _setBtn('ENTRAR', false);
      const msg = traduzirErroAuth(err.code);
      _setFb('✗ ' + msg, 'err');
    });
}

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




// Segurança de sessão: sempre exigir login ao abrir ou recarregar o coletor.
AUTH.setPersistence(firebase.auth.Auth.Persistence.NONE)
  .then(() => AUTH.signOut().catch(() => {}))
  .finally(() => {
    APP.operador = null;
    goScreen('login');
    const login = document.getElementById('l-login');
    const pass = document.getElementById('l-pass');
    if (login) login.value = '';
    if (pass) pass.value = '';
  });
