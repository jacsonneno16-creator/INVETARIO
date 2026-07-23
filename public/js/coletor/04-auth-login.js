// ═══════════════════════════════════════════════════
//  LOGIN  (Firebase Auth)
// ═══════════════════════════════════════════════════


const DT_COLETOR_LOGIN_MEM_KEY = 'dt_coletor_login_lembrado_v1';
function _carregarLoginColetorLembrado(){
  try{
    const salvo=JSON.parse(localStorage.getItem(DT_COLETOR_LOGIN_MEM_KEY)||'null');
    if(!salvo?.login)return;
    const l=document.getElementById('l-login'),p=document.getElementById('l-pass'),r=document.getElementById('l-remember');
    if(l)l.value=salvo.login;if(p)p.value='';if(r)r.checked=true;
  }catch(_){}
}
function _salvarOuLimparLoginColetor(login,senha){
  try{
    if(document.getElementById('l-remember')?.checked) localStorage.setItem(DT_COLETOR_LOGIN_MEM_KEY,JSON.stringify({login}));
    else localStorage.removeItem(DT_COLETOR_LOGIN_MEM_KEY);
  }catch(_){}
}
window.addEventListener('DOMContentLoaded',_carregarLoginColetorLembrado);

// Monta email interno a partir do login (ex: jacson.souza → jacson.souza@daterrinhaalimentos.com.br)
function _montarEmail(login) {
  const v=login.trim().toLowerCase().replace(/\s+/g, ''); return v.includes('@') ? v : v + '@daterrinhaalimentos.com.br';
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
    .then(async cred => {
      const displayName = _nomeDisplay(login);
      await cred.user.updateProfile({ displayName }).catch(() => {});

      // Primeiro acesso também precisa registrar e aguardar aprovação do aparelho.
      // Antes, a criação de conta entrava direto no sistema e nunca criava o
      // documento em dt_coletores, por isso nada aparecia para o analista.
      let status = 'erro';
      try {
        status = await registrarColetorNoFirestore({
          email: cred.user.email,
          name: displayName,
          uid: cred.user.uid
        });
      } catch (e) {
        console.error('[Coletor] Falha ao registrar aparelho no primeiro acesso:', e);
      }

      if (status === 'bloqueado') {
        _mostrarTelaBloqueado();
        return;
      }
      if (status === 'pendente') {
        _mostrarTelaAguardandoAprovacao(displayName);
        if (typeof iniciarListenerAprovacaoColetor === 'function') {
          iniciarListenerAprovacaoColetor({ email: cred.user.email, name: displayName, uid: cred.user.uid });
        }
        toast('Conta criada. Aguarde a aprovação deste aparelho pelo analista.', 'w');
        return;
      }
      if (status !== 'aprovado') {
        toast('Conta criada, mas não foi possível registrar o aparelho. Verifique a conexão e tente entrar novamente.', 'e');
        return;
      }

      // Caso o aparelho já estivesse previamente aprovado.
      APP.operador = { email: cred.user.email, name: displayName, uid: cred.user.uid, acesso_todas_lojas: false, lojas_permitidas: [] };
      APP.uid = cred.user.uid;
      ['op-name-inv','op-name-app','op-name-mode','op-name-aud'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = displayName;
      });
      toast('✅ Conta criada! Bem-vindo, ' + displayName + '!', 's');
      goScreen('mode');
      carregarInventarios();
      carregarAuditoriasMenu();
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


function _atualizarLojaColetorUI(lojas) {
  lojas = Array.isArray(lojas) ? lojas : (window.DT_LOJAS_USUARIO_ATUAL || []);
  const atual = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
  const loja = lojas.find(function(item){ return item && item.id === atual; }) || null;
  const card = document.getElementById('coletor-loja-card');
  const nome = document.getElementById('coletor-loja-nome');
  const trocar = document.getElementById('coletor-trocar-loja');
  if (card) card.style.display = loja ? '' : 'none';
  if (nome) nome.textContent = loja ? (loja.nome || loja.id) : '—';
  if (trocar) trocar.style.display = lojas.length > 1 ? '' : 'none';
}

async function trocarLojaColetor() {
  const lojas = window.DT_LOJAS_USUARIO_ATUAL || [];
  if (lojas.length <= 1) {
    toast('Este login possui acesso somente a uma loja.', 'w');
    return;
  }
  const anterior = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
  try {
    const selecionada = await window.DTLoja.selecionarInterativamente('Escolha a loja para trabalhar', true);
    if (!selecionada) return;
    _atualizarLojaColetorUI(lojas);
    if (selecionada !== anterior) {
      APP.inventario = null;
      APP.auditoria = null;
      APP.lojaFiltroInventario = '';
      APP.lojaFiltroAuditoria = '';
      if (window.DTProdutos && typeof window.DTProdutos.limparCache === 'function') window.DTProdutos.limparCache();
      goScreen('mode');
      carregarInventarios();
      carregarAuditoriasMenu();
      toast('Loja alterada para ' + ((lojas.find(function(x){return x.id===selecionada;}) || {}).nome || selecionada) + '.', 's');
    }
  } catch (e) {
    toast('Não foi possível trocar a loja: ' + (e.message || e), 'e');
  }
}
window.trocarLojaColetor = trocarLojaColetor;

async function doLogin() {
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

  _salvarOuLimparLoginColetor(login, pass);
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

  try { await (window.DT_AUTH_READY || Promise.resolve()); } catch(_) {}

  AUTH.signInWithEmailAndPassword(email, pass)
    .then(async cred => {
      clearTimeout(_tid);
      const user = cred.user;
      const name = user.displayName || _nomeDisplay(login);

      _setBtn('Carregando lojas…', true);

      // A loja é escolhida somente depois da autenticação. Assim o login pode
      // ser validado primeiro e a lista exibida já respeita as permissões do usuário.
      let acessoGlobal = null;
      try {
        const acc = await window.getDTRawFirestore().collection('usuarios_acessos').doc(user.uid).get();
        if (acc.exists) acessoGlobal = { uid:user.uid, ...acc.data() };
      } catch (e) { console.warn('[Coletor] Falha ao carregar permissões globais:', e.message); }
      window.DT_USUARIO_ACESSO_ATUAL = acessoGlobal || {
        uid:user.uid, email:user.email, acesso_todas_lojas:true, lojas_permitidas:[]
      };

      // Carrega as lojas permitidas. Uma única loja entra direto; duas ou
      // mais exibem o seletor antes do menu principal.
      window.setDTLojaAtiva('');
      let lojaSelecionada = '';
      let lojasPermitidas = [];
      try {
        lojasPermitidas = await window.DTLoja.listar(true);
        window.DT_LOJAS_USUARIO_ATUAL = lojasPermitidas;
        if (!lojasPermitidas.length) throw new Error('Este login não possui acesso a nenhuma loja.');
        if (lojasPermitidas.length === 1) {
          lojaSelecionada = window.setDTLojaAtiva(lojasPermitidas[0].id);
        } else {
          lojaSelecionada = await window.DTLoja.selecionarInterativamente('Selecione a loja para trabalhar', true);
        }
      } catch (e) {
        _setBtn('ENTRAR', false);
        await AUTH.signOut().catch(()=>{});
        _setFb('Não foi possível carregar as lojas: ' + e.message, 'err');
        return;
      }
      if (!lojaSelecionada) {
        _setBtn('ENTRAR', false);
        await AUTH.signOut().catch(()=>{});
        _setFb('Selecione uma loja para continuar.', 'err');
        return;
      }

      _setBtn('Verificando aparelho…', true);
      let status;
      try {
        status = await registrarColetorNoFirestore({ email: user.email, name, uid: user.uid });
      } catch(e) {
        status = 'erro';
      }

      if (status === 'bloqueado') {
        _setBtn('ENTRAR', false);
        _mostrarTelaBloqueado();
        return;
      }

      if (status === 'pendente') {
        _setBtn('AGUARDANDO APROVAÇÃO', true);
        _mostrarTelaAguardandoAprovacao(name);
        if (typeof iniciarListenerAprovacaoColetor === 'function') iniciarListenerAprovacaoColetor({ email:user.email, name, uid:user.uid });
        return;
      }
      if (status === 'erro') {
        _setBtn('ENTRAR', false);
        _setFb('Não foi possível registrar o aparelho no Firebase. Abra ⋮ → Diagnóstico.', 'err');
        return;
      }

      // ── Aprovado — liberar acesso ──
      let opDoc = acessoGlobal;
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
      _atualizarLojaColetorUI(window.DT_LOJAS_USUARIO_ATUAL || []);
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


