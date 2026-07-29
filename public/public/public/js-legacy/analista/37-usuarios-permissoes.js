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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
// Configuração global de usuários e permissões por loja.
(function (global) {
    'use strict';
    var raw = function () { return global.getDTRawFirestore(); };
    var ACCESS = 'usuarios_acessos';
    var usuarios = [];
    var editando = null;
    var lojasCache = [];
    var esc = function (v) { return String(v !== null && v !== void 0 ? v : '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); };
    var emailId = function (email) { return String(email || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_'); };
    function carregarLojas() {
        return __awaiter(this, void 0, void 0, function () { return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, global.DTLoja.garantirLojaInicial()];
                case 1:
                    lojasCache = _a.sent();
                    return [2 /*return*/, lojasCache];
            }
        }); });
    }
    function lojasLabels(ids) {
        var arr = Array.isArray(ids) ? ids : [];
        if (!arr.length)
            return '<span class="badge badge-red">Sem loja</span>';
        return arr.map(function (id) { var l = lojasCache.find(function (x) { return x.id === id; }); return "<span class=\"badge badge-blue\" style=\"margin:2px\">".concat(esc((l === null || l === void 0 ? void 0 : l.nome) || id), "</span>"); }).join('');
    }
    function coletarUsuariosExistentes() {
        return __awaiter(this, void 0, void 0, function () {
            var mapa, accessSnap, _loop_1, _i, lojasCache_1, loja, atual, k;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, carregarLojas()];
                    case 1:
                        _b.sent();
                        mapa = new Map();
                        return [4 /*yield*/, raw().collection(ACCESS).get().catch(function () { return ({ docs: [] }); })];
                    case 2:
                        accessSnap = _b.sent();
                        accessSnap.docs.forEach(function (d) { var x = __assign({ id: d.id }, d.data()); mapa.set(x.uid || x.email || d.id, x); });
                        _loop_1 = function (loja) {
                            var snap, e_1;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        _c.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, raw().collection('lojas').doc(loja.id).collection('dt_operadores').limit(500).get()];
                                    case 1:
                                        snap = _c.sent();
                                        snap.docs.forEach(function (d) {
                                            var o = __assign({ id: d.id }, d.data());
                                            var k = o.uid || o.email || d.id;
                                            var atual = mapa.get(k) || {};
                                            mapa.set(k, __assign(__assign(__assign({}, o), atual), { uid: atual.uid || o.uid || d.id, email: atual.email || o.email || '', nome: atual.nome || o.nome || o.name || '', _lojasEncontradas: __spreadArray([], new Set(__spreadArray(__spreadArray([], (atual._lojasEncontradas || []), true), [loja.id], false)), true) }));
                                        });
                                        return [3 /*break*/, 3];
                                    case 2:
                                        e_1 = _c.sent();
                                        console.warn('[Usuários] Loja', loja.id, e_1.message);
                                        return [3 /*break*/, 3];
                                    case 3: return [2 /*return*/];
                                }
                            });
                        };
                        _i = 0, lojasCache_1 = lojasCache;
                        _b.label = 3;
                    case 3:
                        if (!(_i < lojasCache_1.length)) return [3 /*break*/, 6];
                        loja = lojasCache_1[_i];
                        return [5 /*yield**/, _loop_1(loja)];
                    case 4:
                        _b.sent();
                        _b.label = 5;
                    case 5:
                        _i++;
                        return [3 /*break*/, 3];
                    case 6:
                        atual = global._currentAnalistaUser;
                        if (atual) {
                            k = atual.uid || atual.email;
                            if (!mapa.has(k))
                                mapa.set(k, { uid: atual.uid, email: atual.email, nome: atual.displayName || ((_a = atual.email) === null || _a === void 0 ? void 0 : _a.split('@')[0]), perfil: 'analista', acesso_todas_lojas: true, lojas_permitidas: [] });
                        }
                        usuarios = __spreadArray([], mapa.values(), true).sort(function (a, b) { return String(a.nome || a.email).localeCompare(String(b.nome || b.email), 'pt-BR'); });
                        return [2 /*return*/, usuarios];
                }
            });
        });
    }
    function listarOperadores() {
        return __awaiter(this, void 0, void 0, function () {
            var wrap, e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        wrap = document.getElementById('op-lista-wrap');
                        if (!wrap)
                            return [2 /*return*/];
                        wrap.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando usuários…</div></div>';
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, coletarUsuariosExistentes()];
                    case 2:
                        _a.sent();
                        renderUsuarios();
                        opCarregarOperadoresParaFiltro();
                        return [3 /*break*/, 4];
                    case 3:
                        e_2 = _a.sent();
                        wrap.innerHTML = "<div class=\"empty\"><div class=\"empty-title\">Erro ao carregar usu\u00E1rios</div><div class=\"empty-sub\">".concat(esc(e_2.message), "</div></div>");
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function renderUsuarios() {
        var _a;
        var wrap = document.getElementById('op-lista-wrap');
        if (!wrap)
            return;
        var q = String(((_a = document.getElementById('op-busca')) === null || _a === void 0 ? void 0 : _a.value) || '').toLowerCase();
        var lista = usuarios.filter(function (u) { return "".concat(u.nome || '', " ").concat(u.email || '', " ").concat(u.perfil || u.tipo || '').toLowerCase().includes(q); });
        if (!lista.length) {
            wrap.innerHTML = '<div class="empty"><div class="empty-icon">👤</div><div class="empty-title">Nenhum usuário encontrado</div></div>';
            return;
        }
        wrap.innerHTML = "<div style=\"overflow:auto\"><table><thead><tr><th>Usu\u00E1rio</th><th>Perfil</th><th>Lojas permitidas</th><th>Status</th><th>A\u00E7\u00E3o</th></tr></thead><tbody>".concat(lista.map(function (u, i) {
            var all = u.acesso_todas_lojas === true;
            return "<tr><td><b>".concat(esc(u.nome || u.name || 'Sem nome'), "</b><div style=\"font-size:.72rem;color:var(--muted)\">").concat(esc(u.email || '—'), "</div></td><td>").concat(esc(u.perfil || u.tipo || 'operador'), "</td><td>").concat(all ? '<span class="badge badge-green">Todas as lojas</span>' : lojasLabels(u.lojas_permitidas || u.lojasPermitidas), "</td><td>").concat(u.ativo === false ? '<span class="badge badge-red">Bloqueado</span>' : '<span class="badge badge-green">Ativo</span>', "</td><td><button class=\"btn btn-primary btn-sm\" onclick=\"opEditarUsuario(").concat(i, ")\">\u2699\uFE0F Configurar</button></td></tr>");
        }).join(''), "</tbody></table></div>");
    }
    function opFiltrarLista() { renderUsuarios(); }
    function montarChecks(containerId, selecionadas) {
        var box = document.getElementById(containerId);
        if (!box)
            return;
        var set = new Set(selecionadas || []);
        box.innerHTML = lojasCache.map(function (l) { return "<label style=\"display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;cursor:pointer\"><input type=\"checkbox\" value=\"".concat(esc(l.id), "\" ").concat(set.has(l.id) ? 'checked' : '', " style=\"accent-color:var(--accent)\"><span>").concat(esc(l.nome || l.id), "</span></label>"); }).join('');
    }
    function setModo(prefix, modo) {
        document.querySelectorAll("input[name=\"op-lojas-".concat(prefix, "-modo\"]")).forEach(function (r) { return r.checked = r.value === modo; });
        var box = document.getElementById("op-lojas-".concat(prefix, "-box"));
        if (box)
            box.style.display = modo === 'selecionadas' ? 'block' : 'none';
    }
    function opSetModoLojasCriar(m) { setModo('criar', m); }
    function opSetModoLojasEditar(m) { setModo('editar', m); }
    function opEditarUsuario(index) {
        return __awaiter(this, void 0, void 0, function () {
            var all;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        editando = usuarios[index];
                        if (!editando)
                            return [2 /*return*/];
                        return [4 /*yield*/, carregarLojas()];
                    case 1:
                        _a.sent();
                        document.getElementById('opedit-nome').value = editando.nome || editando.name || '';
                        document.getElementById('opedit-cargo').value = editando.perfil || editando.tipo || editando.cargo || 'operador';
                        document.getElementById('opedit-setor').value = editando.setor || '';
                        document.getElementById('opedit-senha').value = '';
                        all = editando.acesso_todas_lojas === true;
                        montarChecks('op-lojas-editar-lista', editando.lojas_permitidas || editando.lojasPermitidas || []);
                        opSetModoLojasEditar(all ? 'todas' : 'selecionadas');
                        document.getElementById('op-modal-bg').style.display = 'flex';
                        return [2 /*return*/];
                }
            });
        });
    }
    function opFecharModal() { var el = document.getElementById('op-modal-bg'); if (el)
        el.style.display = 'none'; editando = null; }
    function opSalvarEdicao() {
        return __awaiter(this, void 0, void 0, function () {
            var modo, selecionadas, uid, data, _i, lojasCache_2, loja, ref, existe, e_3;
            var _a, _b, _c, _d, _e;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        if (!editando)
                            return [2 /*return*/];
                        modo = ((_a = document.querySelector('input[name="op-lojas-editar-modo"]:checked')) === null || _a === void 0 ? void 0 : _a.value) || 'todas';
                        selecionadas = __spreadArray([], document.querySelectorAll('#op-lojas-editar-lista input:checked'), true).map(function (x) { return x.value; });
                        if (modo === 'selecionadas' && !selecionadas.length) {
                            (_b = global.showToast) === null || _b === void 0 ? void 0 : _b.call(global, 'Selecione ao menos uma loja', 'error');
                            return [2 /*return*/];
                        }
                        uid = editando.uid || editando.id || emailId(editando.email);
                        data = { uid: uid, email: String(editando.email || '').toLowerCase(), nome: document.getElementById('opedit-nome').value.trim(), perfil: document.getElementById('opedit-cargo').value.trim() || 'operador', setor: document.getElementById('opedit-setor').value.trim(), ativo: editando.ativo !== false, acesso_todas_lojas: modo === 'todas', lojas_permitidas: modo === 'todas' ? [] : selecionadas, atualizado_em: new Date().toISOString(), atualizado_por: ((_c = global._currentAnalistaUser) === null || _c === void 0 ? void 0 : _c.email) || '' };
                        _f.label = 1;
                    case 1:
                        _f.trys.push([1, 9, , 10]);
                        return [4 /*yield*/, raw().collection(ACCESS).doc(uid).set(data, { merge: true })];
                    case 2:
                        _f.sent();
                        _i = 0, lojasCache_2 = lojasCache;
                        _f.label = 3;
                    case 3:
                        if (!(_i < lojasCache_2.length)) return [3 /*break*/, 7];
                        loja = lojasCache_2[_i];
                        ref = raw().collection('lojas').doc(loja.id).collection('dt_operadores').doc(uid);
                        return [4 /*yield*/, ref.get().catch(function () { return null; })];
                    case 4:
                        existe = _f.sent();
                        if (!((existe === null || existe === void 0 ? void 0 : existe.exists) || data.acesso_todas_lojas || selecionadas.includes(loja.id))) return [3 /*break*/, 6];
                        return [4 /*yield*/, ref.set(data, { merge: true })];
                    case 5:
                        _f.sent();
                        _f.label = 6;
                    case 6:
                        _i++;
                        return [3 /*break*/, 3];
                    case 7:
                        (_d = global.showToast) === null || _d === void 0 ? void 0 : _d.call(global, 'Permissões de lojas salvas', 'success');
                        opFecharModal();
                        return [4 /*yield*/, listarOperadores()];
                    case 8:
                        _f.sent();
                        return [3 /*break*/, 10];
                    case 9:
                        e_3 = _f.sent();
                        (_e = global.showToast) === null || _e === void 0 ? void 0 : _e.call(global, 'Erro ao salvar permissões: ' + e_3.message, 'error');
                        return [3 /*break*/, 10];
                    case 10: return [2 /*return*/];
                }
            });
        });
    }
    function opAbrirModalCriar() {
        carregarLojas().then(function () { montarChecks('op-lojas-criar-lista', []); opSetModoLojasCriar('todas'); document.getElementById('op-modal-criar-bg').style.display = 'flex'; });
    }
    function opFecharModalCriar() { document.getElementById('op-modal-criar-bg').style.display = 'none'; }
    function opSelecionarTipo(tipo) { document.querySelectorAll('input[name="op-tipo"]').forEach(function (r) { return r.checked = r.value === tipo; }); }
    function opGerarUsername() { var _a; var n = (_a = document.getElementById('op-nome')) === null || _a === void 0 ? void 0 : _a.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean); if ((n === null || n === void 0 ? void 0 : n.length) >= 2)
        document.getElementById('op-username').value = n[0] + '.' + n[n.length - 1]; }
    function opGerarSenha() { var s = Math.random().toString(36).slice(-4).toUpperCase() + Math.floor(1000 + Math.random() * 9000); document.getElementById('op-senha').value = s; }
    function toggleOpSenha() { var e = document.getElementById('op-senha'); e.type = e.type === 'password' ? 'text' : 'password'; }
    function toggleOpeditSenha() { var e = document.getElementById('opedit-senha'); e.type = e.type === 'password' ? 'text' : 'password'; }
    function opValidarUsername() { }
    function opValidarSenha() { }
    function criarOperador() {
        return __awaiter(this, void 0, void 0, function () {
            var nome, login, senha, email, modo, selecionadas, app, cred, tipo, data_1, _i, _a, loja, e_4;
            var _b, _c, _d, _e, _f, _g;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        nome = document.getElementById('op-nome').value.trim(), login = document.getElementById('op-username').value.trim().toLowerCase(), senha = document.getElementById('op-senha').value;
                        if (!nome || !login || senha.length < 6) {
                            (_b = global.showToast) === null || _b === void 0 ? void 0 : _b.call(global, 'Preencha nome, login e senha com no mínimo 6 caracteres', 'error');
                            return [2 /*return*/];
                        }
                        email = login.includes('@') ? login : login + '@daterrinhaalimentos.com.br';
                        modo = ((_c = document.querySelector('input[name="op-lojas-criar-modo"]:checked')) === null || _c === void 0 ? void 0 : _c.value) || 'todas';
                        selecionadas = __spreadArray([], document.querySelectorAll('#op-lojas-criar-lista input:checked'), true).map(function (x) { return x.value; });
                        if (modo === 'selecionadas' && !selecionadas.length) {
                            (_d = global.showToast) === null || _d === void 0 ? void 0 : _d.call(global, 'Selecione ao menos uma loja', 'error');
                            return [2 /*return*/];
                        }
                        _h.label = 1;
                    case 1:
                        _h.trys.push([1, 11, , 12]);
                        app = void 0;
                        try {
                            app = firebase.app('dt-user-admin');
                        }
                        catch (_) {
                            app = firebase.initializeApp(global.DT_FIREBASE_CFG, 'dt-user-admin');
                        }
                        return [4 /*yield*/, app.auth().createUserWithEmailAndPassword(email, senha)];
                    case 2:
                        cred = _h.sent();
                        return [4 /*yield*/, cred.user.updateProfile({ displayName: nome })];
                    case 3:
                        _h.sent();
                        tipo = ((_e = document.querySelector('input[name="op-tipo"]:checked')) === null || _e === void 0 ? void 0 : _e.value) || 'operador';
                        data_1 = { uid: cred.user.uid, email: email, nome: nome, perfil: tipo, ativo: true, acesso_todas_lojas: modo === 'todas', lojas_permitidas: modo === 'todas' ? [] : selecionadas, criado_em: new Date().toISOString() };
                        return [4 /*yield*/, raw().collection(ACCESS).doc(cred.user.uid).set(data_1)];
                    case 4:
                        _h.sent();
                        _i = 0, _a = lojasCache.filter(function (l) { return data_1.acesso_todas_lojas || selecionadas.includes(l.id); });
                        _h.label = 5;
                    case 5:
                        if (!(_i < _a.length)) return [3 /*break*/, 8];
                        loja = _a[_i];
                        return [4 /*yield*/, raw().collection('lojas').doc(loja.id).collection('dt_operadores').doc(cred.user.uid).set(data_1, { merge: true })];
                    case 6:
                        _h.sent();
                        _h.label = 7;
                    case 7:
                        _i++;
                        return [3 /*break*/, 5];
                    case 8: return [4 /*yield*/, app.auth().signOut()];
                    case 9:
                        _h.sent();
                        opFecharModalCriar();
                        (_f = global.showToast) === null || _f === void 0 ? void 0 : _f.call(global, 'Usuário criado e permissões salvas', 'success');
                        return [4 /*yield*/, listarOperadores()];
                    case 10:
                        _h.sent();
                        return [3 /*break*/, 12];
                    case 11:
                        e_4 = _h.sent();
                        (_g = global.showToast) === null || _g === void 0 ? void 0 : _g.call(global, 'Erro ao criar usuário: ' + e_4.message, 'error');
                        return [3 /*break*/, 12];
                    case 12: return [2 /*return*/];
                }
            });
        });
    }
    function oplSetTab(tab) {
        var op = tab === 'operadores';
        document.getElementById('opl-page-operadores').style.display = op ? 'block' : 'none';
        document.getElementById('opl-page-lojas').style.display = op ? 'none' : 'block';
        var a = document.getElementById('opl-tab-operadores'), b = document.getElementById('opl-tab-lojas');
        if (a) {
            a.style.background = op ? 'var(--green,#1E6F4E)' : 'transparent';
            a.style.color = op ? '#fff' : 'var(--muted)';
        }
        if (b) {
            b.style.background = !op ? 'var(--green,#1E6F4E)' : 'transparent';
            b.style.color = !op ? '#fff' : 'var(--muted)';
        }
        if (op)
            listarOperadores();
        else if (global.renderGestaoLojas)
            global.renderGestaoLojas();
    }
    function opCarregarOperadoresParaFiltro() { var s = document.getElementById('op-rec-filtro-operador'); if (!s)
        return; s.innerHTML = '<option value="">Selecione um operador…</option>' + usuarios.map(function (u) { return "<option value=\"".concat(esc(u.uid || u.id), "\">").concat(esc(u.nome || u.email), "</option>"); }).join(''); }
    function opVerificarMinhaConta() { }
    Object.assign(global, { listarOperadores: listarOperadores, opFiltrarLista: opFiltrarLista, opEditarUsuario: opEditarUsuario, opSalvarEdicao: opSalvarEdicao, opFecharModal: opFecharModal, opAbrirModalCriar: opAbrirModalCriar, opFecharModalCriar: opFecharModalCriar, opSetModoLojasCriar: opSetModoLojasCriar, opSetModoLojasEditar: opSetModoLojasEditar, opSelecionarTipo: opSelecionarTipo, opGerarUsername: opGerarUsername, opGerarSenha: opGerarSenha, toggleOpSenha: toggleOpSenha, toggleOpeditSenha: toggleOpeditSenha, opValidarUsername: opValidarUsername, opValidarSenha: opValidarSenha, criarOperador: criarOperador, oplSetTab: oplSetTab, opCarregarOperadoresParaFiltro: opCarregarOperadoresParaFiltro, opVerificarMinhaConta: opVerificarMinhaConta });
})(window);
