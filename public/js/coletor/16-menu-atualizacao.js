// ══════════════════════════════════════════════════════════
//  MENU TRÊS PONTOS — toque único, compatível com coletor físico
// ══════════════════════════════════════════════════════════
let _menuAbertoId = null;
function _posicionarMenu(btn,dd){
  const r=btn.getBoundingClientRect();
  dd.style.position='fixed';
  dd.style.top=Math.max(8,r.bottom+6)+'px';
  dd.style.right=Math.max(8,window.innerWidth-r.right)+'px';
  dd.style.left='auto';
  dd.style.zIndex='2147483647';
}
function _toggleMenu(btnId,ddId,ev){
  if(ev){ ev.preventDefault(); ev.stopPropagation(); }
  const btn=document.getElementById(btnId),dd=document.getElementById(ddId); if(!btn||!dd)return;
  const abrir=dd.style.display==='none'||getComputedStyle(dd).display==='none';
  _fecharTodosMenus();
  if(abrir){ _posicionarMenu(btn,dd); dd.style.display='block'; btn.classList.add('aberto'); _menuAbertoId=ddId; }
}
function toggleMenu3pts(ev){ _toggleMenu('btn-menu3pts','menu3pts-dropdown',ev); }
function toggleMenu3ptsLogin(ev){ _toggleMenu('btn-menu3pts-login','menu3pts-dropdown-login',ev); }
function _fecharTodosMenus(){
  [['btn-menu3pts','menu3pts-dropdown'],['btn-menu3pts-login','menu3pts-dropdown-login']].forEach(([b,d])=>{const be=document.getElementById(b),de=document.getElementById(d);if(de)de.style.display='none';if(be)be.classList.remove('aberto');});
  _menuAbertoId=null;
}
function _fecharMenu3pts(){_fecharTodosMenus();}
function _fecharMenu3ptsLogin(){_fecharTodosMenus();}

function _bindMenuColetor(){
  const bind=(id,fn)=>{ const el=document.getElementById(id); if(!el||el.dataset.dtBound)return; el.dataset.dtBound='1'; el.addEventListener('click',fn,false); };
  bind('btn-menu3pts',e=>toggleMenu3pts(e));
  bind('btn-menu3pts-login',e=>toggleMenu3ptsLogin(e));
  document.addEventListener('click',e=>{ if(_menuAbertoId && !e.target.closest('.menu3pts-dropdown') && !e.target.closest('.btn-menu3pts')) _fecharTodosMenus(); },true);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape')_fecharTodosMenus(); });
}
window.addEventListener('DOMContentLoaded',_bindMenuColetor);



// ══════════════════════════════════════════════════════════
//  MENU TRÊS PONTOS  (melhoria 3)
// ══════════════════════════════════════════════════════════
function toggleMenu3pts() {
  const dd  = document.getElementById('menu3pts-dropdown');
  const btn = document.getElementById('btn-menu3pts');
  if (!dd) return;
  const aberto = dd.style.display !== 'none';
  dd.style.display = aberto ? 'none' : 'block';
  if (btn) btn.classList.toggle('aberto', !aberto);
  // Fechar ao clicar fora
  if (!aberto) {
    setTimeout(() => {
      document.addEventListener('click', _fecharMenu3pts, { once: true });
    }, 0);
  }
}

function toggleMenu3ptsLogin() {
  const dd  = document.getElementById('menu3pts-dropdown-login');
  const btn = document.getElementById('btn-menu3pts-login');
  if (!dd) return;
  const aberto = dd.style.display !== 'none';
  dd.style.display = aberto ? 'none' : 'block';
  if (btn) btn.classList.toggle('aberto', !aberto);
  if (!aberto) {
    setTimeout(() => {
      document.addEventListener('click', _fecharMenu3ptsLogin, { once: true });
    }, 0);
  }
}

function _fecharMenu3ptsLogin(e) {
  const dd = document.getElementById('menu3pts-dropdown-login');
  if (dd) dd.style.display = 'none';
  const btn = document.getElementById('btn-menu3pts-login');
  if (btn) btn.classList.remove('aberto');
}

function _fecharMenu3pts(e) {
  const dd = document.getElementById('menu3pts-dropdown');
  if (dd) dd.style.display = 'none';
  const btn = document.getElementById('btn-menu3pts');
  if (btn) btn.classList.remove('aberto');
}

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

  // Mostrar modal de verificação
  _showUpdateModal({
    icon: '🔄', title: 'Verificando atualização…',
    msg: 'Buscando a versão mais recente do aplicativo…',
    ver: 'v' + APP_VERSION,
    barPct: 20, showBtns: false
  });

  // Verificar SW registrado
  if (!('serviceWorker' in navigator)) {
    _showUpdateModal({
      icon: '⚠️', title: 'Service Worker não disponível',
      msg: 'Para atualizar, feche e reabra o aplicativo no navegador ou recarregue a página.',
      ver: 'v' + APP_VERSION, barPct: 0, showBtns: true,
      btnOk: 'Recarregar', onOk: () => location.reload(true),
      btnCancel: 'Fechar',  onCancel: _hideUpdateModal
    });
    return;
  }

  try {
    _updateModalProgress(40, 'Contactando servidor…');
    const regs = await navigator.serviceWorker.getRegistrations();

    if (regs.length > 0) {
      // Forçar check de atualização em todos os SWs registrados
      await Promise.all(regs.map(r => r.update()));
      _updateModalProgress(70, 'Verificando nova versão…');
      await new Promise(r => setTimeout(r, 600)); // pequeno delay

      const waiting = regs.some(r => r.waiting);
      if (waiting) {
        _updateModalProgress(100, 'Nova versão encontrada!');
        _showUpdateModal({
          icon: '🚀', title: 'Nova versão disponível!',
          msg: 'Uma nova versão do aplicativo está pronta para ser instalada.',
          ver: 'Atualizando…', barPct: 100, showBtns: true,
          btnOk: 'Instalar agora', onOk: () => {
            regs.forEach(r => r.waiting?.postMessage({ type: 'SKIP_WAITING' }));
            setTimeout(() => location.reload(true), 500);
          },
          btnCancel: 'Depois', onCancel: _hideUpdateModal
        });
        return;
      }
    }

    // Verificar pelo cache do navegador comparando header Last-Modified / ETag
    _updateModalProgress(85, 'Verificando cache…');
    let novaVersaoRemota = false;
    try {
      const resp = await fetch(location.href, {
        method: 'HEAD', cache: 'no-cache',
        headers: { 'Cache-Control': 'no-cache' }
      });
      const etag       = resp.headers.get('ETag') || '';
      const lastMod    = resp.headers.get('Last-Modified') || '';
      const chaveLocal = localStorage.getItem(LS_APP_VER) || '';
      const chaveRemota = etag || lastMod;
      if (chaveRemota && chaveRemota !== chaveLocal) {
        novaVersaoRemota = true;
        localStorage.setItem(LS_APP_VER, chaveRemota);
      }
    } catch(e) { /* offline ou CORS */ }

    _updateModalProgress(100);

    if (novaVersaoRemota) {
      _showUpdateModal({
        icon: '🚀', title: 'Nova versão disponível!',
        msg: 'Atualizando para a versão mais recente do aplicativo…',
        ver: 'Recarregando…', barPct: 100, showBtns: true,
        btnOk: 'Recarregar agora', onOk: () => location.reload(true),
        btnCancel: 'Depois', onCancel: _hideUpdateModal
      });
    } else {
      _showUpdateModal({
        icon: '✅', title: 'Aplicativo atualizado!',
        msg: 'Você já está usando a versão mais recente do aplicativo.',
        ver: 'v' + APP_VERSION, barPct: 100, showBtns: true,
        btnOk: 'OK', onOk: _hideUpdateModal,
        btnCancel: null
      });
    }
  } catch(e) {
    _showUpdateModal({
      icon: '❌', title: 'Erro ao verificar',
      msg: 'Não foi possível verificar atualizações: ' + (e.message || e),
      ver: 'v' + APP_VERSION, barPct: 0, showBtns: true,
      btnOk: 'Fechar', onOk: _hideUpdateModal, btnCancel: null
    });
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

// ── SERVICE WORKER REAL ──
(function(){
  if(!('serviceWorker' in navigator)||!window.isSecureContext)return;
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw-coletor.js',{scope:'/'}).then(reg=>reg.update()).catch(e=>console.warn('[SW]',e.message)));
})();

// ── INSTALL BANNER (A2HS) ──
let _deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPrompt = e;
  // Mostrar banner, botão e as opções dentro dos menus de três pontos
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
  const btnInst = document.getElementById('btn-instalar-pwa');
  if (btnInst) btnInst.style.display = 'inline-block';
  ['menu-instalar-pwa-login', 'menu-instalar-pwa-app'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
  });
});

function instalarPWA() {
  if (!_deferredPrompt) {
    _fecharTodosMenus();
    const msg = 'Para instalar: abra este endereço no Chrome do coletor, toque nos 3 pontos do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”.';
    if (typeof showConfirm === 'function') showConfirm(msg, () => {}, {title:'📲 Instalar aplicativo',icon:'📲',okLabel:'Entendi'});
    else alert(msg);
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
    ['menu-instalar-pwa-login', 'menu-instalar-pwa-app'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
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
  const btnInst = document.getElementById('btn-instalar-pwa');
  if (btnInst) btnInst.style.display = 'none';
  ['menu-instalar-pwa-login', 'menu-instalar-pwa-app'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
  });
});
