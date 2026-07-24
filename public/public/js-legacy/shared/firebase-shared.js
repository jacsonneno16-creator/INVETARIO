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
// Configuração e bootstrap compartilhados do Firebase
window.DT_FIREBASE_CFG = {
    apiKey: "AIzaSyCpeTNeJUGgn5yEmIIM8aGos9VIN0VqcgA",
    authDomain: "daterrinha-inventario.firebaseapp.com",
    projectId: "daterrinha-inventario",
    storageBucket: "daterrinha-inventario.firebasestorage.app",
    messagingSenderId: "310264955486",
    appId: "1:310264955486:web:16f22d7b5db6f8f2b8a9b4"
};
window.DT_FCOL = {
    inventarios: 'dt_inventarios',
    contagens: 'dt_contagens',
    vazios: 'dt_vazios',
    recontagens: 'dt_recontagens',
    divergencias: 'dt_divergencias',
    coletores: 'dt_coletores',
    locais: 'dt_locais',
    auditorias: 'dt_auditorias',
    auditoriaMeta: 'dt_auditoria_meta',
    auditoriaImp: 'dt_auditoria_imports',
    operadores: 'dt_operadores',
    produtos: 'dt_produtos',
    analistas: 'dt_analistas',
};
window.getDTFirebaseApp = function () {
    if (!window.firebase)
        throw new Error('Firebase SDK não carregado.');
    try {
        return firebase.app();
    }
    catch (e) {
        return firebase.initializeApp(window.DT_FIREBASE_CFG);
    }
};
window.getDTRawFirestore = function () { return getDTFirebaseApp().firestore(); };
// Administradores mestres autorizados a inicializar e recuperar o ambiente multiloja.
// Após o primeiro acesso, a permissão também fica persistida em usuarios_acessos.
window.DT_ADMIN_MESTRE_EMAILS = window.DT_ADMIN_MESTRE_EMAILS || [
    'jacson@daterrinhaalimentos.com.br',
    'jacson.souza@daterrinhaalimentos.com.br'
];
window.isDTAdminMestre = function (user, acesso) {
    var email = String((user && user.email) || (acesso && acesso.email) || '').trim().toLowerCase();
    return !!(acesso && (acesso.admin_mestre === true || acesso.administrador_mestre === true)) ||
        window.DT_ADMIN_MESTRE_EMAILS.indexOf(email) >= 0;
};
// ── MULTILOJA ───────────────────────────────────────────────────────────────
// Coleções operacionais são automaticamente direcionadas para
// lojas/{lojaAtiva}/{colecao}. A coleção raiz "lojas" permanece global.
window.DT_LOJA_KEY = 'dt_loja_ativa_v1';
window.getDTLojaAtiva = function () { return localStorage.getItem(window.DT_LOJA_KEY) || ''; };
window.setDTLojaAtiva = function (id) {
    var lojaId = String(id || '').trim();
    if (lojaId)
        localStorage.setItem(window.DT_LOJA_KEY, lojaId);
    else
        localStorage.removeItem(window.DT_LOJA_KEY);
    window.dispatchEvent(new CustomEvent('dt-loja-alterada', { detail: { lojaId: lojaId } }));
    return lojaId;
};
window.getDTFirestore = function () {
    var raw = window.getDTRawFirestore();
    return new Proxy(raw, {
        get: function (target, prop) {
            if (prop === 'collection') {
                return function (nome) {
                    var path = String(nome || '');
                    // Coleções globais: cadastro de lojas, permissões de usuários e
                    // aprovação física dos dispositivos. A aprovação de um coletor é do
                    // navegador/aparelho, não da loja selecionada.
                    if (path === 'lojas' || path.startsWith('lojas/') || path === 'usuarios_acessos' || path === 'dt_coletores')
                        return raw.collection(path);
                    var lojaId = window.getDTLojaAtiva();
                    if (!lojaId)
                        throw new Error('Nenhuma loja selecionada. Selecione uma loja para continuar.');
                    return raw.collection('lojas').doc(lojaId).collection(path);
                };
            }
            var value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
};
window.getDTAuth = function () { return getDTFirebaseApp().auth(); };
window.DTLoja = {
    bootstrapAdministrador: function (user, acessoExistente) {
        return __awaiter(this, void 0, void 0, function () {
            var raw, acesso, primeiroSetup, resultados, _1, adminMestre, agora, lojaRef, lojaDoc, dadosAdmin;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        raw = window.getDTRawFirestore();
                        acesso = acessoExistente || null;
                        primeiroSetup = false;
                        if (!!acesso) return [3 /*break*/, 4];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, Promise.all([
                                raw.collection('lojas').limit(1).get(),
                                raw.collection('usuarios_acessos').limit(1).get()
                            ])];
                    case 2:
                        resultados = _a.sent();
                        primeiroSetup = resultados[0].empty && resultados[1].empty;
                        return [3 /*break*/, 4];
                    case 3:
                        _1 = _a.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        adminMestre = window.isDTAdminMestre(user, acesso) || primeiroSetup;
                        if (!adminMestre)
                            return [2 /*return*/, acesso];
                        agora = new Date().toISOString();
                        lojaRef = raw.collection('lojas').doc('loja_matriz');
                        return [4 /*yield*/, lojaRef.get()];
                    case 5:
                        lojaDoc = _a.sent();
                        if (!!lojaDoc.exists) return [3 /*break*/, 7];
                        return [4 /*yield*/, lojaRef.set({
                                nome: 'Loja Matriz', codigo: 'MATRIZ', ativa: true,
                                criada_em: agora, criada_por: user && user.email ? user.email : ''
                            }, { merge: true })];
                    case 6:
                        _a.sent();
                        _a.label = 7;
                    case 7:
                        dadosAdmin = {
                            uid: user.uid,
                            email: String(user.email || '').toLowerCase(),
                            nome: user.displayName || String(user.email || '').split('@')[0],
                            perfil: 'administrador',
                            ativo: true,
                            admin_mestre: true,
                            administrador_mestre: true,
                            acesso_todas_lojas: true,
                            lojas_permitidas: [],
                            atualizado_em: agora,
                            atualizado_por: 'BOOTSTRAP_AUTOMATICO'
                        };
                        if (!acesso)
                            dadosAdmin.criado_em = agora;
                        return [4 /*yield*/, raw.collection('usuarios_acessos').doc(user.uid).set(dadosAdmin, { merge: true })];
                    case 8:
                        _a.sent();
                        return [2 /*return*/, Object.assign({}, acesso || {}, dadosAdmin)];
                }
            });
        });
    },
    listar: function () {
        return __awaiter(this, arguments, void 0, function (apenasAtivas) {
            var raw, snap, acesso;
            if (apenasAtivas === void 0) { apenasAtivas = true; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        raw = window.getDTRawFirestore();
                        return [4 /*yield*/, raw.collection('lojas').get()];
                    case 1:
                        snap = _a.sent();
                        acesso = window.DT_USUARIO_ACESSO_ATUAL || null;
                        return [2 /*return*/, snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); })
                                .filter(function (x) { return !apenasAtivas || x.ativa !== false; })
                                .filter(function (x) { return !acesso || acesso.acesso_todas_lojas === true || (Array.isArray(acesso.lojas_permitidas) && acesso.lojas_permitidas.includes(x.id)); })
                                .sort(function (a, b) { return String(a.nome || a.id).localeCompare(String(b.nome || b.id), 'pt-BR'); })];
                }
            });
        });
    },
    slug: function (nome) {
        return String(nome || 'loja').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || ('loja_' + Date.now());
    },
    garantirLojaInicial: function () {
        return __awaiter(this, void 0, void 0, function () {
            var raw, lojas, id;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        raw = window.getDTRawFirestore();
                        return [4 /*yield*/, this.listar(false)];
                    case 1:
                        lojas = _a.sent();
                        if (lojas.length)
                            return [2 /*return*/, lojas];
                        id = 'loja_matriz';
                        return [4 /*yield*/, raw.collection('lojas').doc(id).set({ nome: 'Loja Matriz', codigo: 'MATRIZ', ativa: true, criada_em: new Date().toISOString() }, { merge: true })];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, [{ id: id, nome: 'Loja Matriz', codigo: 'MATRIZ', ativa: true }]];
                }
            });
        });
    },
    selecionarInterativamente: function () {
        return __awaiter(this, arguments, void 0, function (titulo, forcarEscolha) {
            var lojas, atual;
            if (titulo === void 0) { titulo = 'Selecione a loja'; }
            if (forcarEscolha === void 0) { forcarEscolha = false; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.garantirLojaInicial()];
                    case 1:
                        lojas = _a.sent();
                        atual = window.getDTLojaAtiva();
                        if (!forcarEscolha && atual && lojas.some(function (l) { return l.id === atual; }))
                            return [2 /*return*/, atual];
                        if (!forcarEscolha && lojas.length === 1) {
                            window.setDTLojaAtiva(lojas[0].id);
                            return [2 /*return*/, lojas[0].id];
                        }
                        return [4 /*yield*/, new Promise(function (resolve) {
                                var bg = document.getElementById('dt-loja-modal');
                                if (bg)
                                    bg.remove();
                                bg = document.createElement('div');
                                bg.id = 'dt-loja-modal';
                                bg.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(3,10,18,.86);display:flex;align-items:center;justify-content:center;padding:20px';
                                bg.innerHTML = "<div style=\"width:min(460px,95vw);background:#fff;color:#17202a;border-radius:16px;padding:24px;box-shadow:0 25px 70px rgba(0,0,0,.4)\">\n        <div style=\"font-size:1.15rem;font-weight:800;margin-bottom:6px\">\uD83C\uDFEA ".concat(titulo, "</div>\n        <div style=\"font-size:.82rem;color:#667085;margin-bottom:16px\">Cada loja possui invent\u00E1rios, coletores e dados separados.</div>\n        <select id=\"dt-loja-modal-select\" style=\"width:100%;padding:12px;border:1px solid #d0d5dd;border-radius:9px;font-size:.95rem\">").concat(lojas.map(function (l) { return "<option value=\"".concat(l.id, "\">").concat(l.nome || l.id).concat(l.codigo ? ' · ' + l.codigo : '', "</option>"); }).join(''), "</select>\n        <button id=\"dt-loja-modal-ok\" style=\"width:100%;margin-top:14px;padding:12px;border:0;border-radius:9px;background:#1e6f4e;color:#fff;font-weight:800;cursor:pointer\">ENTRAR NESTA LOJA</button>\n      </div>");
                                document.body.appendChild(bg);
                                var seletor = bg.querySelector('#dt-loja-modal-select');
                                if (atual && lojas.some(function (l) { return l.id === atual; }))
                                    seletor.value = atual;
                                bg.querySelector('#dt-loja-modal-ok').onclick = function () { var id = bg.querySelector('#dt-loja-modal-select').value; window.setDTLojaAtiva(id); bg.remove(); resolve(id); };
                            })];
                    case 2: return [2 /*return*/, _a.sent()];
                }
            });
        });
    },
    preencherSelect: function (selectId_1) {
        return __awaiter(this, arguments, void 0, function (selectId, incluirTodas) {
            var el, lojas, atual;
            if (incluirTodas === void 0) { incluirTodas = false; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        el = document.getElementById(selectId);
                        if (!el)
                            return [2 /*return*/, []];
                        return [4 /*yield*/, this.garantirLojaInicial()];
                    case 1:
                        lojas = _a.sent();
                        el.innerHTML = (incluirTodas ? '<option value="">Todas as lojas</option>' : '') + lojas.map(function (l) { return "<option value=\"".concat(l.id, "\">").concat(l.nome || l.id, "</option>"); }).join('');
                        atual = window.getDTLojaAtiva();
                        if (atual && lojas.some(function (l) { return l.id === atual; }))
                            el.value = atual;
                        else if (lojas[0]) {
                            el.value = lojas[0].id;
                            window.setDTLojaAtiva(lojas[0].id);
                        }
                        return [2 /*return*/, lojas];
                }
            });
        });
    }
};
