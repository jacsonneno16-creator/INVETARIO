// ═══════════════════════════════════════════════════
// LOGIN DO COLETOR — fluxo único, sem logout concorrente
// ═══════════════════════════════════════════════════
var DT_COLETOR_LOGIN_MEM_KEY = 'dt_coletor_login_lembrado_v1';
var _dtAprovacaoUnsub = null;
var _dtLoginEmAndamento = false;

function _dtEl(id){ return document.getElementById(id); }
function _dtCarregarLoginLembrado(){
  try {
    var salvo = JSON.parse(localStorage.getItem(DT_COLETOR_LOGIN_MEM_KEY) || 'null');
    if (!salvo || !salvo.login) return;
    if (_dtEl('l-login')) _dtEl('l-login').value = salvo.login;
    if (_dtEl('l-remember')) _dtEl('l-remember').checked = true;
    // Segurança: versões antigas salvavam a senha. Ela é removida na primeira abertura.
    if (salvo.senha) localStorage.setItem(DT_COLETOR_LOGIN_MEM_KEY, JSON.stringify({login: salvo.login}));
  } catch(e) {}
}
function _dtSalvarLogin(login){
  try {
    if (_dtEl('l-remember') && _dtEl('l-remember').checked) {
      localStorage.setItem(DT_COLETOR_LOGIN_MEM_KEY, JSON.stringify({login:login}));
    } else localStorage.removeItem(DT_COLETOR_LOGIN_MEM_KEY);
  } catch(e) {}
}
function _dtEmail(login){
  var v = String(login || '').trim().toLowerCase().replace(/\s+/g,'');
  return v.indexOf('@') >= 0 ? v : v + '@daterrinhaalimentos.com.br';
}
function _dtEmailsPossiveis(login){
  var v=String(login||'').trim().toLowerCase().replace(/\s+/g,'');
  if(v.indexOf('@')>=0) return [v];
  return [v+'@daterrinhaalimentos.com.br', v+'@daterrinhaalimnentos.com.br'];
}
async function _dtAutenticar(login, pass){
  var emails=_dtEmailsPossiveis(login), ultimoErro=null;
  for(var i=0;i<emails.length;i++){
    try { return await AUTH.signInWithEmailAndPassword(emails[i],pass); }
    catch(e){ ultimoErro=e; if(e && !['auth/user-not-found','auth/invalid-credential','auth/wrong-password'].includes(e.code)) throw e; }
  }
  throw ultimoErro || new Error('Login ou senha incorretos');
}
function _dtNome(login){
  var base = String(login || '').split('@')[0];
  return base.split('.').map(function(p){ return p ? p.charAt(0).toUpperCase()+p.slice(1) : ''; }).join(' ');
}
function _dtSetBtn(txt, disabled){ var b=_dtEl('btn-login'); if(b){b.disabled=!!disabled;b.textContent=txt;} }
function _dtFeedback(msg, tipo){
  var f=_dtEl('fb-login-erro');
  if(f) f.innerHTML = msg ? '<div class="fb '+(tipo||'err')+'" style="margin-top:8px">'+msg+'</div>' : '';
  if(msg && typeof toast==='function') toast(msg, tipo==='warn'?'w':'e');
}
function _dtTraduzir(code){
  var m={
    'auth/invalid-email':'Login/e-mail inválido',
    'auth/user-not-found':'Usuário não encontrado',
    'auth/wrong-password':'Senha incorreta',
    'auth/invalid-credential':'Login ou senha incorretos',
    'auth/too-many-requests':'Muitas tentativas. Aguarde alguns minutos.',
    'auth/network-request-failed':'Sem conexão com o Firebase',
    'permission-denied':'Sem permissão para registrar este coletor'
  };
  return m[code] || code || 'Não foi possível entrar';
}

function _dtPreencherOperador(user, nome, opDoc){
  APP.operador = {
    email:user.email, name:nome, uid:user.uid,
    acesso_todas_lojas: !!(opDoc && opDoc.acesso_todas_lojas === true),
    lojas_permitidas: opDoc && Array.isArray(opDoc.lojas_permitidas) ? opDoc.lojas_permitidas : []
  };
  APP.uid=user.uid; APP.lojaFiltroInventario=''; APP.lojaFiltroAuditoria='';
  ['op-name-inv','op-name-app','op-name-mode','op-name-aud'].forEach(function(id){var el=_dtEl(id);if(el)el.textContent=nome;});
  var st=_dtEl('st-op'); if(st) st.textContent=nome;
  var si=_dtEl('st-inicio'); if(si && typeof fmtTime==='function') si.textContent=fmtTime(APP.sessionStart);
}
async function _dtLiberarAcesso(user, nome){
  var opDoc=null;
  try { var s=await FS.collection('dt_operadores').doc(user.uid).get(); if(s.exists) opDoc=s.data()||null; } catch(e) {}
  _dtPreencherOperador(user,nome,opDoc);
  _dtSetBtn('ENTRAR',false); _fecharTelaAprovacao();
  if(typeof goScreen==='function') goScreen('mode');
  APP.modoAcesso='inventario'; APP.modoPendente='inventario';
  if(typeof carregarInventarios==='function') carregarInventarios();
  if(typeof carregarAuditoriasMenu==='function') carregarAuditoriasMenu();
  if(typeof iniciarSyncBackground==='function') iniciarSyncBackground();
  if(typeof toast==='function') toast('Bem-vindo, '+nome+'!','s');
}
function _dtOuvirAprovacao(user, nome){
  if(_dtAprovacaoUnsub){try{_dtAprovacaoUnsub();}catch(e){} _dtAprovacaoUnsub=null;}
  var did=obterDeviceId();
  var dev=_dtEl('login-aprovacao-device'); if(dev)dev.textContent='ID: '+did;
  _dtAprovacaoUnsub=FS.collection(FCOL.coletores).doc(did).onSnapshot(function(snap){
    if(!snap.exists)return;
    var d=snap.data()||{};
    if(d.aprovado==='aprovado'){
      try{_dtAprovacaoUnsub();}catch(e){} _dtAprovacaoUnsub=null;
      registrarColetorNoFirestore({email:user.email,name:nome,uid:user.uid}).catch(function(){}).then(function(){_dtLiberarAcesso(user,nome);});
    } else if(d.aprovado==='bloqueado') {
      _mostrarTelaBloqueado();
    }
  },function(err){ _dtFeedback('Falha ao acompanhar aprovação: '+_dtTraduzir(err.code),'err'); });
}

async function doLogin(){
  if(_dtLoginEmAndamento)return;
  var login=(_dtEl('l-login')?_dtEl('l-login').value:'').trim().toLowerCase();
  var pass=_dtEl('l-pass')?_dtEl('l-pass').value:'';
  if(!login){_dtFeedback('Informe o login','err');return;}
  if(!pass){_dtFeedback('Informe a senha','err');return;}
  _dtLoginEmAndamento=true; _dtSalvarLogin(login); _dtSetBtn('Entrando…',true); _dtFeedback('','');
  try {
    var remember=!!(_dtEl('l-remember')&&_dtEl('l-remember').checked);
    var mode=remember?firebase.auth.Auth.Persistence.LOCAL:firebase.auth.Auth.Persistence.SESSION;
    try{await AUTH.setPersistence(mode);}catch(e){await AUTH.setPersistence(firebase.auth.Auth.Persistence.NONE);}
    if(window.DT_COLETOR_AUTH_READY) await window.DT_COLETOR_AUTH_READY.catch(function(){});
    var cred=await _dtAutenticar(login,pass);
    var user=cred.user, nome=user.displayName||_dtNome(login);
    _dtSetBtn('Registrando aparelho…',true);
    var status=await registrarColetorNoFirestore({email:user.email,name:nome,uid:user.uid});
    if(status==='aprovado'){ await _dtLiberarAcesso(user,nome); }
    else if(status==='bloqueado'){ _dtSetBtn('ENTRAR',false); _mostrarTelaBloqueado(); }
    else if(status==='pendente'){
      _dtSetBtn('AGUARDANDO APROVAÇÃO',true);
      _mostrarTelaAguardandoAprovacao(nome);
      _dtOuvirAprovacao(user,nome); // permanece autenticado para receber a aprovação
    } else throw new Error('Não foi possível registrar o aparelho no Firebase');
  } catch(err){
    console.error('[Login coletor]',err);
    _dtSetBtn('ENTRAR',false);
    _dtFeedback('✗ '+_dtTraduzir(err.code||err.message),'err');
  } finally { _dtLoginEmAndamento=false; }
}

async function doCriarConta(){
  var login=(_dtEl('l-login')?_dtEl('l-login').value:'').trim().toLowerCase();
  var pass=_dtEl('l-pass')?_dtEl('l-pass').value:'';
  if(!login||!pass){_dtFeedback('Preencha login e senha','err');return;}
  if(pass.length<6){_dtFeedback('A senha precisa ter pelo menos 6 caracteres','err');return;}
  _dtSetBtn('Criando conta…',true);
  try{
    await AUTH.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    var cred=await AUTH.createUserWithEmailAndPassword(_dtEmail(login),pass);
    var nome=_dtNome(login); try{await cred.user.updateProfile({displayName:nome});}catch(e){}
    _dtSetBtn('Registrando aparelho…',true);
    var status=await registrarColetorNoFirestore({email:cred.user.email,name:nome,uid:cred.user.uid});
    if(status==='aprovado') await _dtLiberarAcesso(cred.user,nome);
    else { _mostrarTelaAguardandoAprovacao(nome); _dtOuvirAprovacao(cred.user,nome); _dtSetBtn('AGUARDANDO APROVAÇÃO',true); }
  }catch(err){_dtSetBtn('ENTRAR',false);_dtFeedback('✗ '+_dtTraduzir(err.code||err.message),'err');}
}
function _mostrarTelaAguardandoAprovacao(nome){var b=_dtEl('login-aprovacao-box'),m=_dtEl('login-aprovacao-msg');if(m)m.textContent=nome?'Olá, '+nome+'! ':'';if(b)b.style.display='flex';}
function _mostrarTelaBloqueado(){var b=_dtEl('login-bloqueado-box');if(b)b.style.display='flex';}
function _fecharTelaAprovacao(){var a=_dtEl('login-aprovacao-box'),b=_dtEl('login-bloqueado-box');if(a)a.style.display='none';if(b)b.style.display='none';_dtSetBtn('ENTRAR',false);}
function togglePass(){var f=_dtEl('l-pass');if(f)f.type=f.type==='password'?'text':'password';}
function doLogout(){if(typeof showConfirm==='function')showConfirm('Sair do sistema?',_doLogoutConfirmado,{title:'Sair',icon:'👋',okLabel:'Sair',okColor:'#ff4757'});else _doLogoutConfirmado();}
function _doLogoutConfirmado(){
  if(_dtAprovacaoUnsub){try{_dtAprovacaoUnsub();}catch(e){} _dtAprovacaoUnsub=null;}
  try{if(_heartbeatInterval){clearInterval(_heartbeatInterval);_heartbeatInterval=null;}}catch(e){}
  Promise.resolve(typeof marcarColetorOffline==='function'?marcarColetorOffline():null).finally(function(){AUTH.signOut().finally(function(){APP.operador=null;if(typeof goScreen==='function')goScreen('login');});});
}

window.doLogin=doLogin; window.doCriarConta=doCriarConta; window.togglePass=togglePass; window.doLogout=doLogout;
window._fecharTelaAprovacao=_fecharTelaAprovacao;
window.addEventListener('DOMContentLoaded',function(){
  _dtCarregarLoginLembrado();
  var btn=_dtEl('btn-login'); if(btn){btn.type='button';btn.onclick=function(e){if(e)e.preventDefault();doLogin();};}
  var p=_dtEl('l-pass'); if(p)p.addEventListener('keydown',function(e){if(e.key==='Enter'||e.keyCode===13){e.preventDefault();doLogin();}});
  var l=_dtEl('l-login'); if(l)l.addEventListener('keydown',function(e){if(e.key==='Enter'||e.keyCode===13){e.preventDefault();doLogin();}});
});
