var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
// ══════════════════════════════════════════════════════════
//  MENU TRÊS PONTOS  (melhoria 3)
// ══════════════════════════════════════════════════════════
function toggleMenu3pts() {
    var dd = document.getElementById('menu3pts-dropdown');
    var btn = document.getElementById('btn-menu3pts');
    if (!dd)
        return;
    var aberto = dd.style.display !== 'none';
    dd.style.display = aberto ? 'none' : 'block';
    if (btn)
        btn.classList.toggle('aberto', !aberto);
    // Fechar ao clicar fora
    if (!aberto) {
        setTimeout(function () {
            document.addEventListener('click', _fecharMenu3pts, { once: true });
        }, 0);
    }
}
function toggleMenu3ptsLogin() {
    var dd = document.getElementById('menu3pts-dropdown-login');
    var btn = document.getElementById('btn-menu3pts-login');
    if (!dd)
        return;
    var aberto = dd.style.display !== 'none';
    dd.style.display = aberto ? 'none' : 'block';
    if (btn)
        btn.classList.toggle('aberto', !aberto);
    if (!aberto) {
        setTimeout(function () {
            document.addEventListener('click', _fecharMenu3ptsLogin, { once: true });
        }, 0);
    }
}
function _fecharMenu3ptsLogin(e) {
    var dd = document.getElementById('menu3pts-dropdown-login');
    if (dd)
        dd.style.display = 'none';
    var btn = document.getElementById('btn-menu3pts-login');
    if (btn)
        btn.classList.remove('aberto');
}
function _fecharMenu3pts(e) {
    var dd = document.getElementById('menu3pts-dropdown');
    if (dd)
        dd.style.display = 'none';
    var btn = document.getElementById('btn-menu3pts');
    if (btn)
        btn.classList.remove('aberto');
}
// ── Mostrar versão no menu ──
window.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('app-ver-label');
    if (el)
        el.textContent = APP_VERSION;
    var elLogin = document.getElementById('login-ver-label');
    if (elLogin)
        elLogin.textContent = APP_VERSION;
    // Mostrar device_id no painel de aprovacao
    var elDev = document.getElementById('login-aprovacao-device');
    if (elDev)
        elDev.textContent = 'ID: ' + obterDeviceId();
});
// ══════════════════════════════════════════════════════════
//  ATUALIZAR APLICATIVO  (melhoria 4: verificação inteligente)
// ══════════════════════════════════════════════════════════
// Chave localStorage para versão confirmada pelo usuário
var LS_APP_VER = 'col_app_ver_confirmada';
function atualizarAplicativo() {
    return __awaiter(this, void 0, void 0, function () {
        var regs_1, waiting, novaVersaoRemota, resp, etag, lastMod, chaveLocal, chaveRemota, e_1, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
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
                            btnOk: 'Recarregar', onOk: function () { return location.reload(true); },
                            btnCancel: 'Fechar', onCancel: _hideUpdateModal
                        });
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 10, , 11]);
                    _updateModalProgress(40, 'Contactando servidor…');
                    return [4 /*yield*/, navigator.serviceWorker.getRegistrations()];
                case 2:
                    regs_1 = _a.sent();
                    if (!(regs_1.length > 0)) return [3 /*break*/, 5];
                    // Forçar check de atualização em todos os SWs registrados
                    return [4 /*yield*/, Promise.all(regs_1.map(function (r) { return r.update(); }))];
                case 3:
                    // Forçar check de atualização em todos os SWs registrados
                    _a.sent();
                    _updateModalProgress(70, 'Verificando nova versão…');
                    return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 600); })];
                case 4:
                    _a.sent(); // pequeno delay
                    waiting = regs_1.some(function (r) { return r.waiting; });
                    if (waiting) {
                        _updateModalProgress(100, 'Nova versão encontrada!');
                        _showUpdateModal({
                            icon: '🚀', title: 'Nova versão disponível!',
                            msg: 'Uma nova versão do aplicativo está pronta para ser instalada.',
                            ver: 'Atualizando…', barPct: 100, showBtns: true,
                            btnOk: 'Instalar agora', onOk: function () {
                                regs_1.forEach(function (r) { var _a; return (_a = r.waiting) === null || _a === void 0 ? void 0 : _a.postMessage({ type: 'SKIP_WAITING' }); });
                                setTimeout(function () { return location.reload(true); }, 500);
                            },
                            btnCancel: 'Depois', onCancel: _hideUpdateModal
                        });
                        return [2 /*return*/];
                    }
                    _a.label = 5;
                case 5:
                    // Verificar pelo cache do navegador comparando header Last-Modified / ETag
                    _updateModalProgress(85, 'Verificando cache…');
                    novaVersaoRemota = false;
                    _a.label = 6;
                case 6:
                    _a.trys.push([6, 8, , 9]);
                    return [4 /*yield*/, fetch(location.href, {
                            method: 'HEAD', cache: 'no-cache',
                            headers: { 'Cache-Control': 'no-cache' }
                        })];
                case 7:
                    resp = _a.sent();
                    etag = resp.headers.get('ETag') || '';
                    lastMod = resp.headers.get('Last-Modified') || '';
                    chaveLocal = localStorage.getItem(LS_APP_VER) || '';
                    chaveRemota = etag || lastMod;
                    if (chaveRemota && chaveRemota !== chaveLocal) {
                        novaVersaoRemota = true;
                        localStorage.setItem(LS_APP_VER, chaveRemota);
                    }
                    return [3 /*break*/, 9];
                case 8:
                    e_1 = _a.sent();
                    return [3 /*break*/, 9];
                case 9:
                    _updateModalProgress(100);
                    if (novaVersaoRemota) {
                        _showUpdateModal({
                            icon: '🚀', title: 'Nova versão disponível!',
                            msg: 'Atualizando para a versão mais recente do aplicativo…',
                            ver: 'Recarregando…', barPct: 100, showBtns: true,
                            btnOk: 'Recarregar agora', onOk: function () { return location.reload(true); },
                            btnCancel: 'Depois', onCancel: _hideUpdateModal
                        });
                    }
                    else {
                        _showUpdateModal({
                            icon: '✅', title: 'Aplicativo atualizado!',
                            msg: 'Você já está usando a versão mais recente do aplicativo.',
                            ver: 'v' + APP_VERSION, barPct: 100, showBtns: true,
                            btnOk: 'OK', onOk: _hideUpdateModal,
                            btnCancel: null
                        });
                    }
                    return [3 /*break*/, 11];
                case 10:
                    e_2 = _a.sent();
                    _showUpdateModal({
                        icon: '❌', title: 'Erro ao verificar',
                        msg: 'Não foi possível verificar atualizações: ' + (e_2.message || e_2),
                        ver: 'v' + APP_VERSION, barPct: 0, showBtns: true,
                        btnOk: 'Fechar', onOk: _hideUpdateModal, btnCancel: null
                    });
                    return [3 /*break*/, 11];
                case 11: return [2 /*return*/];
            }
        });
    });
}
// ── Forçar atualização da base do inventário ────────────────
function atualizarBase() {
    return __awaiter(this, void 0, void 0, function () {
        var invId;
        return __generator(this, function (_a) {
            _fecharMenu3pts();
            if (!APP.inventario) {
                toast('Selecione um inventário primeiro', 'w');
                return [2 /*return*/];
            }
            invId = APP.inventario.id;
            bVerSave(invId, ''); // zerar versão → forçará download na próxima vez
            showConfirm("Atualizar base do invent\u00E1rio \"".concat(escHTML(APP.inventario.nome), "\"? As contagens desta sess\u00E3o ser\u00E3o mantidas."), function () { _iniciarTelaDowload(APP.inventario); }, { title: '🔄 Atualizar base', icon: '🔄', okLabel: 'Atualizar', okColor: '#00d68f' });
            return [2 /*return*/];
        });
    });
}
// ── Helpers do modal de atualização ────────────────────────
var _updateOkFn = null, _updateCancelFn = null;
function _showUpdateModal(_a) {
    var icon = _a.icon, title = _a.title, msg = _a.msg, ver = _a.ver, barPct = _a.barPct, showBtns = _a.showBtns, btnOk = _a.btnOk, onOk = _a.onOk, btnCancel = _a.btnCancel, onCancel = _a.onCancel;
    var overlay = document.getElementById('update-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'update-overlay';
        overlay.className = 'update-overlay';
        overlay.innerHTML = "\n      <div class=\"update-card\">\n        <div class=\"update-icon\" id=\"upd-icon\">\uD83D\uDD04</div>\n        <div class=\"update-title\" id=\"upd-title\"></div>\n        <div class=\"update-msg\" id=\"upd-msg\"></div>\n        <div class=\"update-ver\" id=\"upd-ver\"></div>\n        <div class=\"update-bar-wrap\">\n          <div class=\"update-bar-bg\"><div class=\"update-bar-fg\" id=\"upd-bar\"></div></div>\n        </div>\n        <div class=\"update-btns\" id=\"upd-btns\" style=\"display:none\">\n          <button class=\"update-btn-cancel\" id=\"upd-btn-cancel\" style=\"display:none\"></button>\n          <button class=\"update-btn-ok\" id=\"upd-btn-ok\"></button>\n        </div>\n      </div>";
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    document.getElementById('upd-icon').textContent = icon;
    document.getElementById('upd-title').textContent = title;
    document.getElementById('upd-msg').textContent = msg;
    document.getElementById('upd-ver').textContent = ver;
    document.getElementById('upd-bar').style.width = barPct + '%';
    document.getElementById('upd-btns').style.display = showBtns ? 'flex' : 'none';
    if (showBtns) {
        var ok = document.getElementById('upd-btn-ok');
        var ca = document.getElementById('upd-btn-cancel');
        ok.textContent = btnOk || 'OK';
        _updateOkFn = onOk || _hideUpdateModal;
        ok.onclick = function () { return _updateOkFn(); };
        if (btnCancel) {
            ca.style.display = '';
            ca.textContent = btnCancel;
            _updateCancelFn = onCancel || _hideUpdateModal;
            ca.onclick = function () { return _updateCancelFn(); };
        }
        else {
            ca.style.display = 'none';
        }
    }
}
function _updateModalProgress(pct, msg) {
    var bar = document.getElementById('upd-bar');
    if (bar)
        bar.style.width = pct + '%';
    if (msg) {
        var el = document.getElementById('upd-msg');
        if (el)
            el.textContent = msg;
    }
}
function _hideUpdateModal() {
    var overlay = document.getElementById('update-overlay');
    if (overlay)
        overlay.style.display = 'none';
}
// ── SERVICE WORKER via <script type="text/js-worker"> ──
// O arquivo é servido via link direto — registrar SW via URL do próprio HTML com parâmetro ?sw=1
(function () {
    if (!('serviceWorker' in navigator))
        return;
    // Detectar a URL base do próprio app
    var selfUrl = location.href.split('?')[0].split('#')[0];
    window.addEventListener('load', function () {
        // Verificar se há um SW já registrado para este escopo
        navigator.serviceWorker.getRegistration(selfUrl).then(function (reg) {
            if (reg) {
                dbg('[SW] já registrado:', reg.scope);
                return;
            }
            // Tentar registrar — só funciona se o servidor retornar JS com Content-Type correto
            // Como é um arquivo .html, o SW não pode ser registrado normalmente.
            // Para instalação PWA, tentamos via importScripts workaround.
            dbg('[SW] arquivo HTML — instalação via "Adicionar à tela inicial" disponível');
        }).catch(function () { });
    });
    // Mostrar instruções de instalação manual para iOS (Safari não tem beforeinstallprompt)
    var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var isInStandalone = window.navigator.standalone;
    if (isIos && !isInStandalone) {
        // Mostrar banner iOS após 3s
        setTimeout(function () {
            var banner = document.getElementById('pwa-ios-banner');
            if (banner)
                banner.style.display = 'flex';
        }, 3000);
    }
})();
// ── INSTALL BANNER (A2HS) ──
var _deferredPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    _deferredPrompt = e;
    // Mostrar banner, botão e as opções dentro dos menus de três pontos
    var banner = document.getElementById('pwa-install-banner');
    if (banner)
        banner.style.display = 'flex';
    var btnInst = document.getElementById('btn-instalar-pwa');
    if (btnInst)
        btnInst.style.display = 'inline-block';
    ['menu-instalar-pwa-login', 'menu-instalar-pwa-app'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.style.display = 'block';
    });
});
function instalarPWA() {
    if (!_deferredPrompt) {
        toast('Use o menu do navegador > "Adicionar à tela inicial"', 'w');
        return;
    }
    _deferredPrompt.prompt();
    _deferredPrompt.userChoice.then(function (result) {
        if (result.outcome === 'accepted') {
            toast('✅ App instalado com sucesso!', 's');
        }
        _deferredPrompt = null;
        var banner = document.getElementById('pwa-install-banner');
        if (banner)
            banner.style.display = 'none';
        var btnInst = document.getElementById('btn-instalar-pwa');
        if (btnInst)
            btnInst.style.display = 'none';
        ['menu-instalar-pwa-login', 'menu-instalar-pwa-app'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el)
                el.style.display = 'none';
        });
    });
}
function diagnosticoFirebase() {
    return __awaiter(this, void 0, void 0, function () {
        var el, user, uid, snap, docs, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    el = document.getElementById('inv-list');
                    el.innerHTML = '<div class="empty-inv"><div style="font-size:1.5rem">🔍</div><div>Verificando Firebase…</div></div>';
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    user = AUTH.currentUser;
                    uid = user ? user.uid : 'NÃO AUTENTICADO';
                    return [4 /*yield*/, FS.collection(FCOL.inventarios).limit(10).get()];
                case 2:
                    snap = _a.sent();
                    docs = snap.docs.map(function (d) {
                        var data = d.data();
                        return "<div style=\"border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;font-size:.72rem\">\n        <b style=\"color:var(--primary)\">".concat(d.id, "</b><br>\n        nome: ").concat(data.nome || '?', " | status: <b>").concat(data.status || '?', "</b> | registros: ").concat(data.total_registros || 0, "\n      </div>");
                    });
                    el.innerHTML = "<div style=\"font-size:.75rem;padding:8px;gap:8px;display:flex;flex-direction:column\">\n      <div style=\"background:rgba(30,111,78,.15);border-radius:8px;padding:10px\">\n        <b style=\"color:var(--primary)\">\u2705 Firebase OK</b><br>\n        Usu\u00E1rio: ".concat(uid, "<br>\n        Documentos em dt_inventarios: ").concat(snap.size, "\n      </div>\n      ").concat(docs.length ? docs.join('') : '<div style="color:var(--muted)">Coleção vazia — clique em 🔥 Sync Firebase no analista</div>', "\n      <button onclick=\"carregarInventarios()\" style=\"background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px;font-size:.78rem;cursor:pointer\">\u2190 Voltar</button>\n    </div>");
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _a.sent();
                    el.innerHTML = "<div style=\"font-size:.75rem;padding:12px;gap:8px;display:flex;flex-direction:column\">\n      <div style=\"background:rgba(248,113,113,.1);border-radius:8px;padding:10px\">\n        <b style=\"color:#f87171\">\u274C Erro Firebase</b><br>\n        C\u00F3digo: ".concat(err_1.code || 'desconhecido', "<br>\n        <span style=\"color:var(--muted);word-break:break-all\">").concat(err_1.message, "</span>\n      </div>\n      <div style=\"color:var(--muted);font-size:.7rem\">\n        ").concat(err_1.code === 'permission-denied'
                        ? '⚠️ Regras do Firestore estão bloqueando. Ajuste em Firebase Console > Firestore > Rules para permitir leitura autenticada.'
                        : err_1.code === 'unavailable'
                            ? '📶 Sem conexão com o Firebase. Verifique internet.'
                            : 'Verifique o console do navegador para mais detalhes.', "\n      </div>\n      <button onclick=\"carregarInventarios()\" style=\"background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px;font-size:.78rem;cursor:pointer\">\u2190 Voltar</button>\n    </div>");
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function fecharBannerPWA() {
    var banner = document.getElementById('pwa-install-banner');
    if (banner)
        banner.style.display = 'none';
}
// Detectar se já está instalado (standalone)
if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    dbg('[PWA] rodando em modo standalone (instalado)');
}
// Ouvir mensagem do SW quando voltar online
navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', function (event) {
    var _a;
    if (((_a = event.data) === null || _a === void 0 ? void 0 : _a.type) === 'BACK_ONLINE') {
        toast('🌐 Conexão restaurada — enviando pendentes...', 's');
        setTimeout(function () { if (typeof enviarFilaPendente === 'function')
            enviarFilaPendente(); }, 1000);
    }
});
window.addEventListener('appinstalled', function () {
    toast('🎉 DT Coletor instalado!', 's');
    var banner = document.getElementById('pwa-install-banner');
    if (banner)
        banner.style.display = 'none';
    var btnInst = document.getElementById('btn-instalar-pwa');
    if (btnInst)
        btnInst.style.display = 'none';
    ['menu-instalar-pwa-login', 'menu-instalar-pwa-app'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.style.display = 'none';
    });
});
