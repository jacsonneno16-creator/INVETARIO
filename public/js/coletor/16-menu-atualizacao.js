
// ══════════════════════════════════════════════════════════
// MENU TRÊS PONTOS — compatível com toque, caneta e gatilho
// ══════════════════════════════════════════════════════════
function _setMenu3pts(tipo, abrir){
  const login=tipo==='login';
  const dd=document.getElementById(login?'menu3pts-dropdown-login':'menu3pts-dropdown');
  const btn=document.getElementById(login?'btn-menu3pts-login':'btn-menu3pts');
  if(!dd)return;
  dd.style.display=abrir?'block':'none';
  dd.hidden=!abrir;
  if(btn){btn.classList.toggle('aberto',abrir);btn.setAttribute('aria-expanded',String(abrir));}
}
function toggleMenu3pts(e){if(e){e.preventDefault();e.stopPropagation()}const d=document.getElementById('menu3pts-dropdown');_setMenu3pts('app',!(d&&d.style.display==='block'));}
function toggleMenu3ptsLogin(e){if(e){e.preventDefault();e.stopPropagation()}const d=document.getElementById('menu3pts-dropdown-login');_setMenu3pts('login',!(d&&d.style.display==='block'));}
function _fecharMenu3pts(){_setMenu3pts('app',false)}
function _fecharMenu3ptsLogin(){_setMenu3pts('login',false)}

(function prepararMenuColetorFisico(){
 const init=()=>{
  [['btn-menu3pts','app'],['btn-menu3pts-login','login']].forEach(([id,tipo])=>{
   const btn=document.getElementById(id);if(!btn)return;
   btn.type='button';btn.onclick=null;btn.style.touchAction='manipulation';
   const fn=e=>tipo==='login'?toggleMenu3ptsLogin(e):toggleMenu3pts(e);
   btn.addEventListener('pointerup',fn,{passive:false});
   btn.addEventListener('click',fn,{passive:false});
  });
  document.addEventListener('pointerup',e=>{
   if(!e.target.closest('#btn-menu3pts,#menu3pts-dropdown'))_fecharMenu3pts();
   if(!e.target.closest('#btn-menu3pts-login,#menu3pts-dropdown-login'))_fecharMenu3ptsLogin();
  });
  document.querySelectorAll('.menu3pts-item').forEach(b=>{b.type='button';b.style.touchAction='manipulation';});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

// ── Mostrar versão no menu ──
window.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('app-ver-label');
  if (el) el.textContent = APP_VERSION;
  const elLogin = document.getElementById('login-ver-label');
  if (elLogin) elLogin.textContent = APP_VERSION;
  // Mostrar device_id no painel de aprovacao
  const elDev = document.getElementById('login-aprovacao-device');
  if (elDev) elDev.textContent = 'ID: ' + obterDeviceId();
});

// ══════════════════════════════════════════════════════════
//  ATUALIZAR APLICATIVO  (melhoria 4: verificação inteligente)
// ══════════════════════════════════════════════════════════

// Chave localStorage para versão confirmada pelo usuário
const LS_APP_VER = 'col_app_ver_confirmada';

async function atualizarAplicativo() {
  _fecharMenu3pts();
  _fecharMenu3ptsLogin();
  _showUpdateModal({icon:'🔄',title:'Atualizando aplicativo…',msg:'Limpando a versão antiga e buscando todos os arquivos novamente.',ver:'v'+APP_VERSION,barPct:10,showBtns:false});
  try{
    _updateModalProgress(25,'Encerrando cache antigo…');
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      for(const reg of regs){
        try{await reg.update()}catch(_){}
        if(reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'});
      }
    }
    _updateModalProgress(45,'Limpando arquivos temporários…');
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
    // Limpa apenas caches de versão; mantém login lembrado, fila e bases offline.
    try{
      Object.keys(localStorage).filter(k=>/^col_app_ver|^dt_asset_ver/.test(k)).forEach(k=>localStorage.removeItem(k));
    }catch(_){}
    _updateModalProgress(70,'Baixando página mais recente…');
    const cleanUrl=location.origin+location.pathname+'?atualizar='+Date.now();
    const resp=await fetch(cleanUrl,{cache:'reload',headers:{'Cache-Control':'no-cache, no-store, must-revalidate'}});
    if(!resp.ok)throw new Error('Servidor respondeu '+resp.status);
    await resp.text();
    _updateModalProgress(100,'Atualização pronta. Reiniciando…');
    setTimeout(()=>location.replace(cleanUrl),450);
  }catch(e){
    _showUpdateModal({icon:'⚠️',title:'Atualização manual necessária',msg:'Não foi possível limpar tudo automaticamente. Feche o aplicativo e abra novamente. Detalhe: '+(e?.message||e),ver:'v'+APP_VERSION,barPct:0,showBtns:true,btnOk:'Tentar novamente',onOk:atualizarAplicativo,btnCancel:'Fechar',onCancel:_hideUpdateModal});
  }
}

// ── Forçar atualização da base do inventário ────────────────
async function atualizarBase() {
  _fecharMenu3pts();
  if (!APP.inventario) {
    toast('Selecione um inventário primeiro', 'w'); return;
  }
  // Apagar versão salva para forçar novo download
  const invId = APP.inventario.id;
  bVerSave(invId, ''); // zerar versão → forçará download na próxima vez

  showConfirm(`Atualizar base do inventário "${escHTML(APP.inventario.nome)}"? As contagens desta sessão serão mantidas.`, () => { _iniciarTelaDowload(APP.inventario); }, { title: '🔄 Atualizar base', icon: '🔄', okLabel: 'Atualizar', okColor: '#00d68f' }); return;
}

// ── Helpers do modal de atualização ────────────────────────
let _updateOkFn = null, _updateCancelFn = null;

function _showUpdateModal({ icon, title, msg, ver, barPct, showBtns, btnOk, onOk, btnCancel, onCancel }) {
  let overlay = document.getElementById('update-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'update-overlay';
    overlay.className = 'update-overlay';
    overlay.innerHTML = `
      <div class="update-card">
        <div class="update-icon" id="upd-icon">🔄</div>
        <div class="update-title" id="upd-title"></div>
        <div class="update-msg" id="upd-msg"></div>
        <div class="update-ver" id="upd-ver"></div>
        <div class="update-bar-wrap">
          <div class="update-bar-bg"><div class="update-bar-fg" id="upd-bar"></div></div>
        </div>
        <div class="update-btns" id="upd-btns" style="display:none">
          <button class="update-btn-cancel" id="upd-btn-cancel" style="display:none"></button>
          <button class="update-btn-ok" id="upd-btn-ok"></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  document.getElementById('upd-icon').textContent  = icon;
  document.getElementById('upd-title').textContent = title;
  document.getElementById('upd-msg').textContent   = msg;
  document.getElementById('upd-ver').textContent   = ver;
  document.getElementById('upd-bar').style.width   = barPct + '%';
  document.getElementById('upd-btns').style.display = showBtns ? 'flex' : 'none';
  if (showBtns) {
    const ok = document.getElementById('upd-btn-ok');
    const ca = document.getElementById('upd-btn-cancel');
    ok.textContent = btnOk || 'OK';
    _updateOkFn = onOk || _hideUpdateModal;
    ok.onclick = () => _updateOkFn();
    if (btnCancel) {
      ca.style.display = ''; ca.textContent = btnCancel;
      _updateCancelFn = onCancel || _hideUpdateModal;
      ca.onclick = () => _updateCancelFn();
    } else {
      ca.style.display = 'none';
    }
  }
}

function _updateModalProgress(pct, msg) {
  const bar = document.getElementById('upd-bar');
  if (bar) bar.style.width = pct + '%';
  if (msg) {
    const el = document.getElementById('upd-msg');
    if (el) el.textContent = msg;
  }
}

function _hideUpdateModal() {
  const overlay = document.getElementById('update-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ── SERVICE WORKER REAL ─────────────────────────────
(function registrarServiceWorkerColetor(){
 if(!('serviceWorker' in navigator))return;
 window.addEventListener('load',async()=>{
  try{
   const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/'});
   console.log('[PWA coletor] Service Worker ativo:',reg.scope);
   reg.update().catch(()=>{});
  }catch(e){console.warn('[PWA coletor] falha no Service Worker:',e?.message||e)}
 });
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(window.__DT_RECARREGANDO_SW)return;
  window.__DT_RECARREGANDO_SW=true;
  location.reload();
 });
})();

// ── INSTALL BANNER (A2HS) ──
let _deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPrompt = e;
  // Mostrar banner e botão
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
  const btnInst = document.getElementById('btn-instalar-pwa');
  if (btnInst) btnInst.style.display = 'inline-block';
});

function instalarPWA() {
  if (!_deferredPrompt) {
    toast('Use o menu do navegador > "Adicionar à tela inicial"', 'w');
    return;
  }
  _deferredPrompt.prompt();
  _deferredPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      toast('✅ App instalado com sucesso!', 's');
    }
    _deferredPrompt = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
    const btnInst = document.getElementById('btn-instalar-pwa');
    if (btnInst) btnInst.style.display = 'none';
  });
}

async function diagnosticoFirebase() {
  const el = document.getElementById('inv-list');
  el.innerHTML = '<div class="empty-inv"><div style="font-size:1.5rem">🔍</div><div>Verificando Firebase…</div></div>';
  try {
    const user = AUTH.currentUser;
    const uid = user ? user.uid : 'NÃO AUTENTICADO';
    // Tentar ler a coleção sem filtro
    const snap = await FS.collection(FCOL.inventarios).limit(10).get();
    const docs = snap.docs.map(d => {
      const data = d.data();
      return `<div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;font-size:.72rem">
        <b style="color:var(--primary)">${d.id}</b><br>
        nome: ${data.nome || '?'} | status: <b>${data.status || '?'}</b> | registros: ${data.total_registros || 0}
      </div>`;
    });
    el.innerHTML = `<div style="font-size:.75rem;padding:8px;gap:8px;display:flex;flex-direction:column">
      <div style="background:rgba(30,111,78,.15);border-radius:8px;padding:10px">
        <b style="color:var(--primary)">✅ Firebase OK</b><br>
        Usuário: ${uid}<br>
        Documentos em dt_inventarios: ${snap.size}
      </div>
      ${docs.length ? docs.join('') : '<div style="color:var(--muted)">Coleção vazia — clique em 🔥 Sync Firebase no analista</div>'}
      <button onclick="carregarInventarios()" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px;font-size:.78rem;cursor:pointer">← Voltar</button>
    </div>`;
  } catch(err) {
    el.innerHTML = `<div style="font-size:.75rem;padding:12px;gap:8px;display:flex;flex-direction:column">
      <div style="background:rgba(248,113,113,.1);border-radius:8px;padding:10px">
        <b style="color:#f87171">❌ Erro Firebase</b><br>
        Código: ${err.code || 'desconhecido'}<br>
        <span style="color:var(--muted);word-break:break-all">${err.message}</span>
      </div>
      <div style="color:var(--muted);font-size:.7rem">
        ${err.code === 'permission-denied'
          ? '⚠️ Regras do Firestore estão bloqueando. Ajuste em Firebase Console > Firestore > Rules para permitir leitura autenticada.'
          : err.code === 'unavailable'
          ? '📶 Sem conexão com o Firebase. Verifique internet.'
          : 'Verifique o console do navegador para mais detalhes.'}
      </div>
      <button onclick="carregarInventarios()" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px;font-size:.78rem;cursor:pointer">← Voltar</button>
    </div>`;
  }
}

function fecharBannerPWA() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'none';
}

// Detectar se já está instalado (standalone)
if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
  dbg('[PWA] rodando em modo standalone (instalado)');
}


// Ouvir mensagem do SW quando voltar online
navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'BACK_ONLINE') {
    toast('🌐 Conexão restaurada — enviando pendentes...', 's');
    setTimeout(() => { if (typeof enviarFilaPendente === 'function') enviarFilaPendente(); }, 1000);
  }
});

window.addEventListener('appinstalled', () => {
  toast('🎉 DT Coletor instalado!', 's');
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'none';
});
