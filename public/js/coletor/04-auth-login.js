// ═══════════════════════════════════════════════════
//  LOGIN  (Firebase Auth) — compatível com coletor físico
// ═══════════════════════════════════════════════════

const DT_COLETOR_LOGIN_MEM_KEY = 'dt_coletor_login_lembrado_v2';
let _loginEmAndamento = false;

function _carregarLoginColetorLembrado(){
  try{
    const salvo=JSON.parse(localStorage.getItem(DT_COLETOR_LOGIN_MEM_KEY)||'null');
    if(!salvo?.login)return;
    const l=document.getElementById('l-login'),p=document.getElementById('l-pass'),r=document.getElementById('l-remember');
    if(l)l.value=salvo.login;
    if(p && salvo.senha)p.value=salvo.senha;
    if(r)r.checked=true;
  }catch(_){ }
}
function _salvarOuLimparLoginColetor(login,senha){
  try{
    if(document.getElementById('l-remember')?.checked) localStorage.setItem(DT_COLETOR_LOGIN_MEM_KEY,JSON.stringify({login,senha}));
    else localStorage.removeItem(DT_COLETOR_LOGIN_MEM_KEY);
  }catch(_){ }
}

function _normalizarLogin(v){ return String(v||'').trim().toLowerCase().replace(/\s+/g,''); }
function _emailsPossiveis(login){
  const l=_normalizarLogin(login);
  if(l.includes('@')) return [l];
  return [
    l+'@daterrinhaalimentos.com.br',
    l+'@daterrinhaalimnentos.com.br'
  ];
}
function _nomeDisplay(login) {
  const base=_normalizarLogin(login).split('@')[0];
  return base.split('.').filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}
async function _definirPersistenciaAuth(){
  const lembrar=!!document.getElementById('l-remember')?.checked;
  const tipo=lembrar ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
  await AUTH.setPersistence(tipo);
}
function _setLoginBtn(txt,disabled){
  const b=document.getElementById('btn-login');
  if(b){ b.disabled=!!disabled; b.textContent=txt||'ENTRAR'; }
}
function _feedbackLogin(msg,tipo='warn'){
  const el=document.getElementById('fb-login-erro');
  if(el) el.innerHTML=msg?`<div class="fb ${tipo}" style="margin-top:8px">${msg}</div>`:'';
  if(msg && typeof toast==='function') toast(msg,tipo==='err'?'e':'w');
}

async function doCriarConta(){
  if(_loginEmAndamento)return;
  const login=_normalizarLogin(document.getElementById('l-login')?.value);
  const pass=document.getElementById('l-pass')?.value||'';
  if(!login||!pass){ toast('Preencha o login e a senha para criar conta','w'); return; }
  if(!login.includes('@') && !/^[a-z0-9._-]+\.[a-z0-9._-]+$/.test(login)){ toast('Login deve ser no formato nome.sobrenome','e'); return; }
  if(pass.length<6){ toast('Senha deve ter no mínimo 6 caracteres','e'); return; }
  _loginEmAndamento=true; _setLoginBtn('Criando conta…',true); _feedbackLogin('','');
  try{
    await _definirPersistenciaAuth();
    const email=_emailsPossiveis(login)[0];
    const cred=await AUTH.createUserWithEmailAndPassword(email,pass);
    const displayName=_nomeDisplay(login);
    await cred.user.updateProfile({displayName}).catch(()=>{});
    await _processarLoginAprovacao(cred.user,displayName,login,pass);
  }catch(err){
    const msgs={'auth/email-already-in-use':'Login já cadastrado — use Entrar','auth/weak-password':'Senha fraca — use ao menos 6 caracteres'};
    _feedbackLogin(msgs[err.code]||traduzirErroAuth(err.code)||err.message,'err');
  }finally{ _loginEmAndamento=false; _setLoginBtn('ENTRAR',false); }
}

async function doLogin(ev){
  if(ev?.preventDefault)ev.preventDefault();
  if(_loginEmAndamento)return false;
  const login=_normalizarLogin(document.getElementById('l-login')?.value);
  const pass=document.getElementById('l-pass')?.value||'';
  if(!login){ toast('Informe o login','e'); return false; }
  if(!pass){ toast('Informe a senha','e'); return false; }
  if(!login.includes('@') && !/^[a-z0-9._-]+\.[a-z0-9._-]+$/.test(login)){ toast('Login inválido — use nome.sobrenome','e'); return false; }

  _loginEmAndamento=true; _setLoginBtn('Entrando…',true); _feedbackLogin('','');
  try{
    await (window.DT_AUTH_READY||Promise.resolve());
    await _definirPersistenciaAuth();
    let cred=null, ultimoErro=null;
    for(const email of _emailsPossiveis(login)){
      try{ cred=await AUTH.signInWithEmailAndPassword(email,pass); break; }
      catch(e){ ultimoErro=e; if(!['auth/user-not-found','auth/invalid-credential','auth/wrong-password'].includes(e.code)) break; }
    }
    if(!cred) throw ultimoErro||new Error('Não foi possível autenticar');
    await _processarLoginAprovacao(cred.user,cred.user.displayName||_nomeDisplay(login),login,pass);
    return false;
  }catch(err){
    _feedbackLogin('✗ '+traduzirErroAuth(err.code||err.message),'err');
    return false;
  }finally{
    _loginEmAndamento=false; _setLoginBtn('ENTRAR',false);
  }
}

async function _processarLoginAprovacao(user,name,login,pass){
  _setLoginBtn('Verificando aparelho…',true);
  let status;
  try{ status=await registrarColetorNoFirestore({email:user.email,name,uid:user.uid}); }
  catch(e){ console.error('[Coletor] registro do aparelho:',e); status='erro'; }

  if(status==='bloqueado'){
    await AUTH.signOut().catch(()=>{}); _mostrarTelaBloqueado(); return;
  }
  if(status==='pendente'||status==='erro'){
    await AUTH.signOut().catch(()=>{}); _mostrarTelaAguardandoAprovacao(name); return;
  }

  _salvarOuLimparLoginColetor(login,pass);
  let opDoc=null;
  try{ const snap=await FS.collection('dt_operadores').doc(user.uid).get(); if(snap.exists)opDoc=snap.data()||null; }
  catch(e){ console.warn('[Coletor] acesso operador:',e.message); }

  APP.operador={email:user.email,name,uid:user.uid,acesso_todas_lojas:opDoc?.acesso_todas_lojas===true,lojas_permitidas:Array.isArray(opDoc?.lojas_permitidas)?opDoc.lojas_permitidas:[]};
  APP.lojaFiltroInventario=''; APP.lojaFiltroAuditoria='';
  ['op-name-inv','op-name-app','op-name-mode','op-name-aud'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=name; });
  const stOp=document.getElementById('st-op'); if(stOp)stOp.textContent=name;
  const stInicio=document.getElementById('st-inicio'); if(stInicio)stInicio.textContent=fmtTime(APP.sessionStart);
  goScreen('mode'); APP.modoAcesso='inventario'; APP.modoPendente='inventario';
  carregarInventarios(); carregarAuditoriasMenu(); iniciarSyncBackground();
  toast('Bem-vindo, '+name+'!','s');
}

function _mostrarTelaAguardandoAprovacao(nome){ const b=document.getElementById('login-aprovacao-box'),m=document.getElementById('login-aprovacao-msg'); if(m)m.textContent=nome?'Olá, '+nome+'! ':''; if(b)b.style.display='flex'; }
function _mostrarTelaBloqueado(){ const b=document.getElementById('login-bloqueado-box'); if(b)b.style.display='flex'; }
function _fecharTelaAprovacao(){ ['login-aprovacao-box','login-bloqueado-box'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';}); }
function traduzirErroAuth(code){
  const msgs={'auth/invalid-email':'E-mail inválido','auth/user-not-found':'Usuário não encontrado','auth/wrong-password':'Senha incorreta','auth/invalid-credential':'Login ou senha inválidos','auth/too-many-requests':'Muitas tentativas — aguarde','auth/network-request-failed':'Sem conexão com a internet','auth/operation-not-supported-in-this-environment':'Navegador do coletor não permite autenticação. Abra pelo Chrome do aparelho.'};
  return msgs[code]||String(code||'Erro de autenticação');
}
function togglePass(){ const f=document.getElementById('l-pass'); if(f)f.type=f.type==='password'?'text':'password'; }
function doLogout(){ showConfirm('Sair do sistema?',_doLogoutConfirmado,{title:'Sair',icon:'👋',okLabel:'Sair',okColor:'#ff4757'}); }
function _doLogoutConfirmado(){
  if(typeof _heartbeatInterval!=='undefined'&&_heartbeatInterval){clearInterval(_heartbeatInterval);_heartbeatInterval=null;}
  if(typeof _syncInterval!=='undefined'&&_syncInterval){clearInterval(_syncInterval);_syncInterval=null;}
  if(typeof _invListener!=='undefined'&&_invListener){try{_invListener();}catch(_){} _invListener=null;}
  if(typeof _invPollInterval!=='undefined'&&_invPollInterval){clearInterval(_invPollInterval);_invPollInterval=null;}
  Promise.resolve(typeof marcarColetorOffline==='function'?marcarColetorOffline():null).finally(async()=>{
    try{ if(typeof FILA_ENVIO!=='undefined'&&FILA_ENVIO.length>0&&navigator.onLine&&typeof enviarFilaPendente==='function')await enviarFilaPendente(); }catch(_){}
    await AUTH.signOut().catch(()=>{}); APP.operador=null; goScreen('login');
  });
}

window.addEventListener('DOMContentLoaded',()=>{
  _carregarLoginColetorLembrado();
  const form=document.getElementById('login-form');
  if(form) form.addEventListener('submit',doLogin);
  const btn=document.getElementById('btn-login');
  if(btn) btn.addEventListener('click',doLogin);
  const pass=document.getElementById('l-pass');
  if(pass) pass.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.keyCode===13){e.preventDefault();doLogin(e);} });
});
