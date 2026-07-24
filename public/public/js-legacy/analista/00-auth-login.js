// ══════════════════════════════════════════════════════════════════════
//  00-AUTH-LOGIN.JS (VERSÃO AJUSTADA E ESTÁVEL)
// ══════════════════════════════════════════════════════════════════════
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
function state() { return window.AnalistaStore.getState(); }
// ── FIREBASE ─────────────────────────────────────────────────────────
getDTFirebaseApp();
var FS_AN = getDTFirestore();
var AUTH_AN = getDTAuth();
// Exposto explicitamente em window pois firebaseService.js acessa via global.FS_AN
window.FS_AN = FS_AN;
window.AUTH_AN = AUTH_AN;
window._currentAnalistaUser = null;
var _loginSolicitadoPeloUsuario = false;
var DT_LOGIN_MEM_KEY = 'dt_analista_login_lembrado_v1';
function _normalizarEmailAnalista(valor) {
    // Mantém exatamente o e-mail cadastrado no Firebase Authentication.
    // Apenas remove espaços e converte para minúsculas.
    return String(valor || '').trim().toLowerCase().replace(/\s+/g, '');
}
function _carregarLoginLembrado() {
    try {
        var salvo = JSON.parse(localStorage.getItem(DT_LOGIN_MEM_KEY) || 'null');
        if (!salvo || !salvo.email || !salvo.senha)
            return;
        var email = document.getElementById('an-email');
        var senha = document.getElementById('an-pass');
        var lembrar = document.getElementById('an-remember');
        if (email)
            email.value = salvo.email;
        if (senha)
            senha.value = salvo.senha;
        if (lembrar)
            lembrar.checked = true;
    }
    catch (_) { }
}
function _salvarOuLimparLogin(email, senha) {
    var _a;
    var lembrar = ((_a = document.getElementById('an-remember')) === null || _a === void 0 ? void 0 : _a.checked) === true;
    try {
        if (lembrar)
            localStorage.setItem(DT_LOGIN_MEM_KEY, JSON.stringify({ email: email, senha: senha }));
        else
            localStorage.removeItem(DT_LOGIN_MEM_KEY);
    }
    catch (_) { }
}
// ── LOGIN ────────────────────────────────────────────────────────────
function doLoginAnalista() {
    var _a, _b, _c;
    var email = _normalizarEmailAnalista(((_a = document.getElementById('an-email')) === null || _a === void 0 ? void 0 : _a.value) || '');
    var senha = ((_b = document.getElementById('an-pass')) === null || _b === void 0 ? void 0 : _b.value) || '';
    _clearLoginErro();
    if (!email)
        return _setLoginErro('Informe o e-mail.');
    if (!senha)
        return _setLoginErro('Informe a senha.');
    _salvarOuLimparLogin(email, senha);
    _loginSolicitadoPeloUsuario = true;
    AUTH_AN.setPersistence((((_c = document.getElementById('an-remember')) === null || _c === void 0 ? void 0 : _c.checked) === true)
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION)
        .then(function () { return AUTH_AN.signInWithEmailAndPassword(email, senha); })
        .catch(function (err) { _loginSolicitadoPeloUsuario = false; _setLoginErro(_traduzirErroLoginAnalista(err)); });
}
function doLogoutAnalista() {
    _loginSolicitadoPeloUsuario = false;
    AUTH_AN.signOut().then(function () {
        window._currentAnalistaUser = null;
        _mostrarLogin();
    });
}
function togglePassAnalista() {
    var f = document.getElementById('an-pass');
    if (f)
        f.type = f.type === 'password' ? 'text' : 'password';
}
function _traduzirErroLoginAnalista(err) {
    var code = (err === null || err === void 0 ? void 0 : err.code) || '';
    var mensagens = {
        'auth/invalid-credential': 'E-mail ou senha incorretos. Digite exatamente o mesmo e-mail cadastrado no Firebase Authentication.',
        'auth/invalid-email': 'O e-mail informado é inválido.',
        'auth/user-disabled': 'Este usuário está desativado no Firebase.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
        'auth/network-request-failed': 'Não foi possível conectar ao Firebase. Verifique a internet.'
    };
    return mensagens[code] || (err === null || err === void 0 ? void 0 : err.message) || 'Não foi possível realizar o login.';
}
function _setLoginErro(msg) {
    var el = document.getElementById('login-error-msg');
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
    }
}
function _clearLoginErro() {
    var el = document.getElementById('login-error-msg');
    if (el) {
        el.textContent = '';
        el.classList.remove('show');
    }
}
// ── LOGIN OK ─────────────────────────────────────────────────────────
function _onAnalistaLogado(user) {
    return __awaiter(this, void 0, void 0, function () {
        var nome, elNome, elAvatar, raw, acc, acesso, permitidas, atual_1, correcao, e_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    window._currentAnalistaUser = user;
                    if (window.AnalistaStore) {
                        window.AnalistaStore.dispatch(window.AnalistaActions.setCurrentUser(user));
                    }
                    nome = user.displayName || user.email.split('@')[0];
                    elNome = document.getElementById('user-name-display');
                    elAvatar = document.getElementById('avatar-initials');
                    if (elNome)
                        elNome.textContent = nome;
                    if (elAvatar)
                        elAvatar.textContent = nome.slice(0, 2).toUpperCase();
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 8, , 10]);
                    raw = window.getDTRawFirestore();
                    return [4 /*yield*/, raw.collection('usuarios_acessos').doc(user.uid).get()];
                case 2:
                    acc = _b.sent();
                    acesso = acc.exists ? __assign({ uid: user.uid }, acc.data()) : null;
                    return [4 /*yield*/, window.DTLoja.bootstrapAdministrador(user, acesso)];
                case 3:
                    // Bootstrap e autorrecuperação do administrador mestre.
                    // Em instalação nova cria Loja Matriz e a própria permissão automaticamente.
                    acesso = _b.sent();
                    // Usuários antigos sem cadastro continuam compatíveis; usuários comuns já
                    // cadastrados continuam obedecendo às lojas definidas pelo administrador.
                    window.DT_USUARIO_ACESSO_ATUAL = acesso || {
                        uid: user.uid, email: user.email, acesso_todas_lojas: true, lojas_permitidas: []
                    };
                    return [4 /*yield*/, window.DTLoja.garantirLojaInicial()];
                case 4:
                    permitidas = _b.sent();
                    if (!permitidas.length)
                        throw new Error('Este login não possui acesso a nenhuma loja. Solicite a liberação ao administrador.');
                    atual_1 = window.getDTLojaAtiva();
                    if (atual_1 && !permitidas.some(function (l) { return l.id === atual_1; }))
                        window.setDTLojaAtiva('');
                    return [4 /*yield*/, window.DTLoja.selecionarInterativamente('Selecione a loja do inventário')];
                case 5:
                    _b.sent();
                    if (!(typeof window.corrigirIsolamentoLojaAtual === 'function')) return [3 /*break*/, 7];
                    return [4 /*yield*/, window.corrigirIsolamentoLojaAtual()];
                case 6:
                    correcao = _b.sent();
                    if (correcao && correcao.corrigido)
                        console.info('[Multiloja] Isolamento corrigido:', correcao.total);
                    _b.label = 7;
                case 7: return [3 /*break*/, 10];
                case 8:
                    e_1 = _b.sent();
                    _setLoginErro('Não foi possível preparar o ambiente da loja: ' + e_1.message);
                    return [4 /*yield*/, AUTH_AN.signOut()];
                case 9:
                    _b.sent();
                    return [2 /*return*/];
                case 10:
                    _mostrarApp();
                    atualizarIndicadorLojaAtual();
                    // 🔥 CHAMADA SEGURA DO INIT
                    if ((_a = window.AnalistaBootstrap) === null || _a === void 0 ? void 0 : _a.initApp) {
                        window.AnalistaBootstrap.initApp();
                    }
                    else if (window.initApp) {
                        window.initApp();
                    }
                    else {
                        console.error('[Auth] initApp não disponível');
                    }
                    logSistema('SISTEMA', 'Login realizado', { email: user.email });
                    if (typeof window.sincronizarDadosLegadosAutomaticamente === 'function') {
                        setTimeout(function () {
                            window.sincronizarDadosLegadosAutomaticamente().then(function (migracao) {
                                if (migracao && migracao.executado) {
                                    console.info('[Multiloja] Migração legada concluída:', migracao.total);
                                    try {
                                        showToast('Dados antigos carregados na loja atual.', 'success');
                                    }
                                    catch (_) { }
                                }
                            }).catch(function (error) {
                                console.error('[Multiloja] Falha na migração controlada:', error);
                                try {
                                    showToast('Não foi possível concluir a migração dos dados antigos. Tente novamente pela Gestão de Lojas.', 'error');
                                }
                                catch (_) { }
                            });
                        }, 1200);
                    }
                    return [2 /*return*/];
            }
        });
    });
}
// ── UI ───────────────────────────────────────────────────────────────
function _mostrarApp() {
    var _a, _b;
    (_a = document.getElementById('screen-login')) === null || _a === void 0 ? void 0 : _a.style.setProperty('display', 'none');
    (_b = document.getElementById('app-main')) === null || _b === void 0 ? void 0 : _b.style.setProperty('display', 'flex');
}
function _mostrarLogin() {
    var _a, _b;
    (_a = document.getElementById('app-main')) === null || _a === void 0 ? void 0 : _a.style.setProperty('display', 'none');
    (_b = document.getElementById('screen-login')) === null || _b === void 0 ? void 0 : _b.style.setProperty('display', 'flex');
}
// ── SESSION ──────────────────────────────────────────────────────────
// Nunca reaproveita sessão anterior. Só abre o painel depois que o usuário
// clicar em Entrar ou pressionar Enter com e-mail e senha preenchidos.
function _iniciarAuthAnalista() {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            _loginSolicitadoPeloUsuario = false;
            _mostrarLogin();
            _carregarLoginLembrado();
            AUTH_AN.onAuthStateChanged(function (user) { return __awaiter(_this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (!user) return [3 /*break*/, 2];
                            _loginSolicitadoPeloUsuario = false;
                            return [4 /*yield*/, _onAnalistaLogado(user)];
                        case 1:
                            _a.sent();
                            return [2 /*return*/];
                        case 2:
                            _mostrarLogin();
                            return [2 /*return*/];
                    }
                });
            }); });
            return [2 /*return*/];
        });
    });
}
_iniciarAuthAnalista();
// ── UTIL ─────────────────────────────────────────────────────────────
// ── TOAST (feedback visual real, usa a <div id="toast"> já existente no HTML) ──
var _toastTimer;
function showToast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) {
        console.log('[Toast]', msg);
        return;
    }
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    void el.offsetWidth; // força reflow para reiniciar a animação
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { return el.classList.remove('show'); }, 3200);
}
// ── MODAL GENÉRICO (abre/fecha qualquer .modal-bg pelo id) ──
// Antes desta correção, openModal/closeModal eram CHAMADAS em ~20 lugares do
// app mas nunca haviam sido definidas — todo modal (login rápido de operador,
// simular coletor, importar endereços etc.) simplesmente não abria.
function openModal(id) {
    var el = document.getElementById(id);
    if (el)
        el.classList.add('open');
}
function closeModal(id) {
    var el = document.getElementById(id);
    if (el)
        el.classList.remove('open');
}
// ── CONFIRMAÇÃO CUSTOMIZADA (substitui o confirm() nativo) ──
function showConfirm(msg, onOk, opts) {
    opts = opts || {};
    var modalId = 'modal-confirm-generico';
    var modal = document.getElementById(modalId);
    if (!modal) {
        if (confirm(msg))
            onOk();
        return;
    } // fallback de segurança
    document.getElementById('mcg-icon').textContent = opts.icon || '⚠️';
    document.getElementById('mcg-title').textContent = opts.title || 'Confirmar';
    document.getElementById('mcg-msg').textContent = msg;
    var btnOk = document.getElementById('mcg-ok');
    btnOk.textContent = opts.okLabel || 'Confirmar';
    btnOk.className = 'btn ' + (opts.okClass || 'btn-danger');
    btnOk.style.background = opts.okColor || '';
    btnOk.onclick = function () { closeModal(modalId); onOk(); };
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
            var user = window._currentAnalistaUser;
            window.FS_AN.collection('dt_logs_analista').add({
                tipo: tipo || 'SISTEMA',
                descricao: descricao || '',
                dados: dados !== undefined ? dados : null,
                usuario: user ? (user.displayName || user.email) : null,
                criado_em: new Date().toISOString(),
            }).catch(function (e) { return console.warn('[logAuditoria]', e.message); });
        }
    }
    catch (e) {
        console.warn('[logAuditoria]', e);
    }
    console.log('[LOG]', tipo, descricao, dados);
}
function logSistema(tipo, desc, dados) { return logAuditoria(tipo, desc, dados); }
function atualizarBadgesNav() { }
function updateStaticTexts() { }
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
function atualizarIndicadorLojaAtual() {
    return __awaiter(this, void 0, void 0, function () {
        var lojas, id_1, loja, el, _1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, window.DTLoja.listar(false)];
                case 1:
                    lojas = _a.sent(), id_1 = window.getDTLojaAtiva();
                    loja = lojas.find(function (x) { return x.id === id_1; });
                    el = document.getElementById('dt-loja-atual-label');
                    if (el)
                        el.textContent = (loja && loja.nome) || id_1 || 'Sem loja';
                    return [2 /*return*/, lojas];
                case 2:
                    _1 = _a.sent();
                    return [2 /*return*/, []];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function fecharMenuLojasAnalista() {
    var menu = document.getElementById('dt-loja-switcher-menu');
    var btn = document.getElementById('dt-loja-switcher-btn');
    if (menu)
        menu.style.display = 'none';
    if (btn)
        btn.setAttribute('aria-expanded', 'false');
}
function aplicarTrocaLojaAnalista(novaLojaId) {
    return __awaiter(this, void 0, void 0, function () {
        var anterior, nova, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    anterior = window.getDTLojaAtiva();
                    nova = String(novaLojaId || '').trim();
                    fecharMenuLojasAnalista();
                    if (!nova || nova === anterior)
                        return [2 /*return*/, false];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 7, , 8]);
                    if (window.AnalistaFirebaseService && window.AnalistaFirebaseService.stop) {
                        window.AnalistaFirebaseService.stop();
                    }
                    if (typeof window.encerrarListenerAuditoriaPorTrocaLoja === 'function') {
                        window.encerrarListenerAuditoriaPorTrocaLoja();
                    }
                    window.setDTLojaAtiva(nova);
                    return [4 /*yield*/, atualizarIndicadorLojaAtual()];
                case 2:
                    _a.sent();
                    // Recarrega somente o estado e os listeners da loja, sem recarregar a página
                    // e sem tocar na sessão autenticada do Firebase.
                    if (window.AnalistaBootstrap && window.AnalistaBootstrap.loadAll) {
                        window.AnalistaBootstrap.loadAll();
                    }
                    if (window.AnalistaFirebaseService && window.AnalistaFirebaseService.refreshFromCache) {
                        window.AnalistaFirebaseService.refreshFromCache();
                    }
                    if (window.AnalistaBootstrap && window.AnalistaBootstrap.renderAll) {
                        window.AnalistaBootstrap.renderAll();
                    }
                    if (!(window.AnalistaFirebaseService && window.AnalistaFirebaseService.start)) return [3 /*break*/, 4];
                    return [4 /*yield*/, window.AnalistaFirebaseService.start()];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4:
                    if (!(typeof window.recarregarAuditoriaAposTrocaLoja === 'function')) return [3 /*break*/, 6];
                    return [4 /*yield*/, window.recarregarAuditoriaAposTrocaLoja()];
                case 5:
                    _a.sent();
                    _a.label = 6;
                case 6:
                    if (window.AnalistaNavigation && window.AnalistaNavigation.renderCurrentPage) {
                        window.AnalistaNavigation.renderCurrentPage();
                    }
                    if (typeof window.atualizarBadgesNav === 'function')
                        window.atualizarBadgesNav();
                    if (typeof window.showToast === 'function')
                        window.showToast('Loja alterada com sucesso.', 'success');
                    return [2 /*return*/, true];
                case 7:
                    e_2 = _a.sent();
                    console.error('[Lojas] Falha ao trocar ambiente:', e_2);
                    if (typeof window.showToast === 'function')
                        window.showToast('Não foi possível trocar de loja: ' + e_2.message, 'error');
                    return [2 /*return*/, false];
                case 8: return [2 /*return*/];
            }
        });
    });
}
function montarMenuLojasAnalista() {
    return __awaiter(this, void 0, void 0, function () {
        var menu, lojas, atual;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    menu = document.getElementById('dt-loja-switcher-menu');
                    if (!menu)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, window.DTLoja.listar(true)];
                case 1:
                    lojas = _a.sent();
                    atual = window.getDTLojaAtiva();
                    if (!lojas.length) {
                        menu.innerHTML = '<div style="padding:10px;font-size:.78rem;color:var(--muted)">Nenhuma loja disponível.</div>';
                        return [2 /*return*/, lojas];
                    }
                    menu.innerHTML = lojas.map(function (loja) {
                        var ativa = loja.id === atual;
                        return '<button type="button" data-trocar-loja="' + String(loja.id).replace(/"/g, '&quot;') + '" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;border:0;border-radius:8px;background:' + (ativa ? 'rgba(30,111,78,.12)' : 'transparent') + ';color:var(--text,#17202a);cursor:pointer;text-align:left;font-family:inherit">' +
                            '<span><strong style="display:block;font-size:.82rem">' + String(loja.nome || loja.id).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</strong>' +
                            '<span style="font-size:.67rem;color:var(--muted)">' + String(loja.codigo || loja.id).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</span></span>' +
                            (ativa ? '<span style="font-size:.72rem;color:var(--accent,#1e6f4e);font-weight:800">ATUAL</span>' : '') +
                            '</button>';
                    }).join('');
                    return [2 /*return*/, lojas];
            }
        });
    });
}
function trocarLojaInventario(event) {
    return __awaiter(this, void 0, void 0, function () {
        var menu, btn, abrindo;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (event) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                    menu = document.getElementById('dt-loja-switcher-menu');
                    btn = document.getElementById('dt-loja-switcher-btn');
                    if (!menu)
                        return [2 /*return*/];
                    abrindo = menu.style.display === 'none' || !menu.style.display;
                    if (!abrindo) {
                        fecharMenuLojasAnalista();
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, montarMenuLojasAnalista()];
                case 1:
                    _a.sent();
                    menu.style.display = 'block';
                    if (btn)
                        btn.setAttribute('aria-expanded', 'true');
                    return [2 /*return*/];
            }
        });
    });
}
if (!window.__dtLojaSwitcherBound) {
    window.__dtLojaSwitcherBound = true;
    document.addEventListener('click', function (event) {
        var alvo = event.target && event.target.closest ? event.target.closest('[data-trocar-loja]') : null;
        if (alvo) {
            event.preventDefault();
            event.stopPropagation();
            aplicarTrocaLojaAnalista(alvo.getAttribute('data-trocar-loja'));
            return;
        }
        var wrap = document.getElementById('dt-loja-switcher');
        if (wrap && !wrap.contains(event.target))
            fecharMenuLojasAnalista();
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape')
        fecharMenuLojasAnalista(); });
}
window.aplicarTrocaLojaAnalista = aplicarTrocaLojaAnalista;
window.trocarLojaInventario = trocarLojaInventario;
