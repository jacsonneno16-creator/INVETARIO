// ═══════════════════════════════════════════════════
//  LOGIN  (Firebase Auth)
// ═══════════════════════════════════════════════════
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
var DT_COLETOR_LOGIN_MEM_KEY = 'dt_coletor_login_lembrado_v1';
function _carregarLoginColetorLembrado() {
    try {
        var salvo = JSON.parse(localStorage.getItem(DT_COLETOR_LOGIN_MEM_KEY) || 'null');
        if (!(salvo === null || salvo === void 0 ? void 0 : salvo.login))
            return;
        var l = document.getElementById('l-login'), p = document.getElementById('l-pass'), r = document.getElementById('l-remember');
        if (l)
            l.value = salvo.login;
        if (p)
            p.value = '';
        if (r)
            r.checked = true;
    }
    catch (_) { }
}
function _salvarOuLimparLoginColetor(login, senha) {
    var _a;
    try {
        if ((_a = document.getElementById('l-remember')) === null || _a === void 0 ? void 0 : _a.checked)
            localStorage.setItem(DT_COLETOR_LOGIN_MEM_KEY, JSON.stringify({ login: login }));
        else
            localStorage.removeItem(DT_COLETOR_LOGIN_MEM_KEY);
    }
    catch (_) { }
}
window.addEventListener('DOMContentLoaded', _carregarLoginColetorLembrado);
// Monta email interno a partir do login (ex: jacson.souza → jacson.souza@daterrinhaalimentos.com.br)
function _montarEmail(login) {
    var v = login.trim().toLowerCase().replace(/\s+/g, '');
    return v.includes('@') ? v : v + '@daterrinhaalimentos.com.br';
}
// Monta nome de exibição a partir do login (ex: jacson.souza → Jacson Souza)
function _nomeDisplay(login) {
    return login.trim().split('.').map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');
}
function doCriarConta() {
    var _this = this;
    var _a;
    var login = (((_a = document.getElementById('l-login')) === null || _a === void 0 ? void 0 : _a.value) || '').trim().toLowerCase();
    var pass = document.getElementById('l-pass').value;
    if (!login || !pass) {
        toast('Preencha o login e a senha para criar conta', 'w');
        return;
    }
    if (!/^[a-z]+\.[a-z]+$/.test(login)) {
        toast('Login deve ser no formato primeironome.ultimonome', 'e');
        return;
    }
    if (pass.length < 6) {
        toast('Senha deve ter no mínimo 6 caracteres', 'e');
        return;
    }
    var email = _montarEmail(login);
    var btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Criando conta...';
    AUTH.createUserWithEmailAndPassword(email, pass)
        .then(function (cred) { return __awaiter(_this, void 0, void 0, function () {
        var displayName, status, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    displayName = _nomeDisplay(login);
                    return [4 /*yield*/, cred.user.updateProfile({ displayName: displayName }).catch(function () { })];
                case 1:
                    _a.sent();
                    status = 'erro';
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, registrarColetorNoFirestore({
                            email: cred.user.email,
                            name: displayName,
                            uid: cred.user.uid
                        })];
                case 3:
                    status = _a.sent();
                    return [3 /*break*/, 5];
                case 4:
                    e_1 = _a.sent();
                    console.error('[Coletor] Falha ao registrar aparelho no primeiro acesso:', e_1);
                    return [3 /*break*/, 5];
                case 5:
                    if (status === 'bloqueado') {
                        _mostrarTelaBloqueado();
                        return [2 /*return*/];
                    }
                    if (status === 'pendente') {
                        _mostrarTelaAguardandoAprovacao(displayName);
                        if (typeof iniciarListenerAprovacaoColetor === 'function') {
                            iniciarListenerAprovacaoColetor({ email: cred.user.email, name: displayName, uid: cred.user.uid });
                        }
                        toast('Conta criada. Aguarde a aprovação deste aparelho pelo analista.', 'w');
                        return [2 /*return*/];
                    }
                    if (status !== 'aprovado') {
                        toast('Conta criada, mas não foi possível registrar o aparelho. Verifique a conexão e tente entrar novamente.', 'e');
                        return [2 /*return*/];
                    }
                    // Caso o aparelho já estivesse previamente aprovado.
                    APP.operador = { email: cred.user.email, name: displayName, uid: cred.user.uid, acesso_todas_lojas: false, lojas_permitidas: [] };
                    APP.uid = cred.user.uid;
                    ['op-name-inv', 'op-name-app', 'op-name-mode', 'op-name-aud'].forEach(function (id) {
                        var el = document.getElementById(id);
                        if (el)
                            el.textContent = displayName;
                    });
                    toast('✅ Conta criada! Bem-vindo, ' + displayName + '!', 's');
                    goScreen('mode');
                    carregarInventarios();
                    carregarAuditoriasMenu();
                    return [2 /*return*/];
            }
        });
    }); })
        .catch(function (err) {
        var msgs = {
            'auth/email-already-in-use': 'Login já cadastrado — use a opção Entrar',
            'auth/weak-password': 'Senha fraca — use ao menos 6 caracteres',
        };
        toast(msgs[err.code] || err.message, 'e');
    })
        .finally(function () { btn.disabled = false; btn.textContent = 'ENTRAR'; });
}
function doLogin() {
    return __awaiter(this, void 0, void 0, function () {
        var lojaSelecionada, login, pass, email, btnLogin, fbLogin, _setBtn, _setFb, _tid, _1;
        var _this = this;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    lojaSelecionada = ((_a = document.getElementById('l-loja')) === null || _a === void 0 ? void 0 : _a.value) || window.getDTLojaAtiva();
                    if (!lojaSelecionada) {
                        toast('Selecione a loja antes de entrar', 'e');
                        return [2 /*return*/];
                    }
                    window.setDTLojaAtiva(lojaSelecionada);
                    login = (((_b = document.getElementById('l-login')) === null || _b === void 0 ? void 0 : _b.value) || '').trim().toLowerCase();
                    pass = ((_c = document.getElementById('l-pass')) === null || _c === void 0 ? void 0 : _c.value) || '';
                    if (!login) {
                        toast('Informe o login', 'e');
                        return [2 /*return*/];
                    }
                    if (!pass) {
                        toast('Informe a senha', 'e');
                        return [2 /*return*/];
                    }
                    // Regex permissiva: aceita qualquer login com pelo menos um ponto
                    // ex: joao.silva, joao.da.silva, maria.souza2, etc.
                    if (!/^[a-z0-9._-]+\.[a-z0-9._-]+$/.test(login)) {
                        toast('Login inválido — use o formato nome.sobrenome', 'e');
                        return [2 /*return*/];
                    }
                    _salvarOuLimparLoginColetor(login, pass);
                    email = _montarEmail(login);
                    btnLogin = document.getElementById('btn-login');
                    fbLogin = document.getElementById('fb-login-erro');
                    _setBtn = function (txt, disabled) {
                        if (btnLogin) {
                            btnLogin.disabled = disabled;
                            btnLogin.textContent = txt;
                        }
                    };
                    _setFb = function (msg, tipo) {
                        if (fbLogin) {
                            fbLogin.innerHTML = msg ? "<div class=\"fb ".concat(tipo, "\" style=\"margin-top:8px\">").concat(msg, "</div>") : '';
                        }
                        if (msg)
                            toast(msg, tipo === 'err' ? 'e' : 'w');
                    };
                    _setBtn('Entrando…', true);
                    _setFb('', '');
                    _tid = setTimeout(function () {
                        _setBtn('ENTRAR', false);
                        _setFb('⏱ Conexão lenta — verifique a internet e tente novamente', 'warn');
                    }, 15000);
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (window.DT_AUTH_READY || Promise.resolve())];
                case 2:
                    _d.sent();
                    return [3 /*break*/, 4];
                case 3:
                    _1 = _d.sent();
                    return [3 /*break*/, 4];
                case 4:
                    AUTH.signInWithEmailAndPassword(email, pass)
                        .then(function (cred) { return __awaiter(_this, void 0, void 0, function () {
                        var user, name, status, e_2, acessoGlobal, acc, e_3, permitidas, opDoc, opSnap, e_4, stOp, stInicio;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    clearTimeout(_tid);
                                    user = cred.user;
                                    name = user.displayName || _nomeDisplay(login);
                                    _setBtn('Verificando aparelho…', true);
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, registrarColetorNoFirestore({ email: user.email, name: name, uid: user.uid })];
                                case 2:
                                    status = _a.sent();
                                    return [3 /*break*/, 4];
                                case 3:
                                    e_2 = _a.sent();
                                    status = 'erro';
                                    return [3 /*break*/, 4];
                                case 4:
                                    if (status === 'bloqueado') {
                                        _setBtn('ENTRAR', false);
                                        _mostrarTelaBloqueado();
                                        return [2 /*return*/];
                                    }
                                    if (status === 'pendente') {
                                        _setBtn('AGUARDANDO APROVAÇÃO', true);
                                        _mostrarTelaAguardandoAprovacao(name);
                                        if (typeof iniciarListenerAprovacaoColetor === 'function')
                                            iniciarListenerAprovacaoColetor({ email: user.email, name: name, uid: user.uid });
                                        return [2 /*return*/];
                                    }
                                    if (status === 'erro') {
                                        _setBtn('ENTRAR', false);
                                        _setFb('Não foi possível registrar o aparelho no Firebase. Abra ⋮ → Diagnóstico.', 'err');
                                        return [2 /*return*/];
                                    }
                                    acessoGlobal = null;
                                    _a.label = 5;
                                case 5:
                                    _a.trys.push([5, 7, , 8]);
                                    return [4 /*yield*/, window.getDTRawFirestore().collection('usuarios_acessos').doc(user.uid).get()];
                                case 6:
                                    acc = _a.sent();
                                    if (acc.exists)
                                        acessoGlobal = acc.data() || null;
                                    return [3 /*break*/, 8];
                                case 7:
                                    e_3 = _a.sent();
                                    console.warn('[Coletor] Falha ao carregar permissões globais:', e_3.message);
                                    return [3 /*break*/, 8];
                                case 8:
                                    if (!(acessoGlobal && acessoGlobal.acesso_todas_lojas !== true)) return [3 /*break*/, 10];
                                    permitidas = Array.isArray(acessoGlobal.lojas_permitidas) ? acessoGlobal.lojas_permitidas : [];
                                    if (!!permitidas.includes(lojaSelecionada)) return [3 /*break*/, 10];
                                    _setBtn('ENTRAR', false);
                                    return [4 /*yield*/, AUTH.signOut().catch(function () { })];
                                case 9:
                                    _a.sent();
                                    _setFb('Este login não possui acesso à loja selecionada.', 'err');
                                    return [2 /*return*/];
                                case 10:
                                    opDoc = acessoGlobal;
                                    _a.label = 11;
                                case 11:
                                    _a.trys.push([11, 13, , 14]);
                                    return [4 /*yield*/, FS.collection('dt_operadores').doc(user.uid).get()];
                                case 12:
                                    opSnap = _a.sent();
                                    if (opSnap.exists)
                                        opDoc = opSnap.data() || null;
                                    return [3 /*break*/, 14];
                                case 13:
                                    e_4 = _a.sent();
                                    console.warn('[Coletor] Falha ao carregar acesso do operador:', e_4.message);
                                    return [3 /*break*/, 14];
                                case 14:
                                    APP.operador = {
                                        email: user.email,
                                        name: name,
                                        uid: user.uid,
                                        acesso_todas_lojas: (opDoc === null || opDoc === void 0 ? void 0 : opDoc.acesso_todas_lojas) === true,
                                        lojas_permitidas: Array.isArray(opDoc === null || opDoc === void 0 ? void 0 : opDoc.lojas_permitidas) ? opDoc.lojas_permitidas : []
                                    };
                                    APP.lojaFiltroInventario = '';
                                    APP.lojaFiltroAuditoria = '';
                                    // Atualizar nome em todos os elementos (com guards — nem todos existem na tela de login)
                                    ['op-name-inv', 'op-name-app', 'op-name-mode', 'op-name-aud'].forEach(function (id) {
                                        var el = document.getElementById(id);
                                        if (el)
                                            el.textContent = name;
                                    });
                                    stOp = document.getElementById('st-op');
                                    if (stOp)
                                        stOp.textContent = name;
                                    stInicio = document.getElementById('st-inicio');
                                    if (stInicio)
                                        stInicio.textContent = fmtTime(APP.sessionStart);
                                    _setBtn('ENTRAR', false);
                                    goScreen('mode');
                                    APP.modoAcesso = 'inventario';
                                    APP.modoPendente = 'inventario';
                                    carregarInventarios();
                                    carregarAuditoriasMenu();
                                    iniciarSyncBackground();
                                    toast('Bem-vindo, ' + name + '!', 's');
                                    return [2 /*return*/];
                            }
                        });
                    }); })
                        .catch(function (err) {
                        clearTimeout(_tid);
                        _setBtn('ENTRAR', false);
                        var msg = traduzirErroAuth(err.code);
                        _setFb('✗ ' + msg, 'err');
                    });
                    return [2 /*return*/];
            }
        });
    });
}
function _mostrarTelaAguardandoAprovacao(nome) {
    var box = document.getElementById('login-aprovacao-box');
    var msg = document.getElementById('login-aprovacao-msg');
    if (msg)
        msg.textContent = nome ? 'Olá, ' + nome + '! ' : '';
    if (box)
        box.style.display = 'flex';
}
function _mostrarTelaBloqueado() {
    var box = document.getElementById('login-bloqueado-box');
    if (box)
        box.style.display = 'flex';
}
function _fecharTelaAprovacao() {
    var b1 = document.getElementById('login-aprovacao-box');
    var b2 = document.getElementById('login-bloqueado-box');
    if (b1)
        b1.style.display = 'none';
    if (b2)
        b2.style.display = 'none';
}
function traduzirErroAuth(code) {
    var msgs = {
        'auth/invalid-email': 'Email inválido',
        'auth/user-not-found': 'Usuário não encontrado',
        'auth/wrong-password': 'Senha incorreta',
        'auth/invalid-credential': 'Credenciais inválidas',
        'auth/too-many-requests': 'Muitas tentativas — aguarde',
        'auth/network-request-failed': 'Sem conexão com a internet',
    };
    return msgs[code] || code;
}
function togglePass() {
    var f = document.getElementById('l-pass');
    f.type = f.type === 'password' ? 'text' : 'password';
}
function doLogout() {
    showConfirm('Sair do sistema?', _doLogoutConfirmado, { title: 'Sair', icon: '👋', okLabel: 'Sair', okColor: '#ff4757' });
}
function _doLogoutConfirmado() {
    if (_heartbeatInterval) {
        clearInterval(_heartbeatInterval);
        _heartbeatInterval = null;
    }
    if (_syncInterval) {
        clearInterval(_syncInterval);
        _syncInterval = null;
    }
    if (_invListener) {
        _invListener();
        _invListener = null;
    } // cancela polling
    if (_invPollInterval) {
        clearInterval(_invPollInterval);
        _invPollInterval = null;
    }
    // Marca coletor offline e limpa sessão antes de sair
    marcarColetorOffline().finally(function () {
        if (FILA_ENVIO.length > 0 && navigator.onLine) {
            enviarFilaPendente().finally(function () { AUTH.signOut(); APP.operador = null; goScreen('login'); });
        }
        else {
            AUTH.signOut();
            APP.operador = null;
            goScreen('login');
        }
    });
}
