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
// Usuários, canais de acesso e autorização detalhada por módulo.
(function (global) {
    'use strict';
    var raw = function () { return global.getDTRawFirestore(); };
    var ACCESS = 'usuarios_acessos';
    var usuarios = [], editando = null, lojasCache = [];
    var esc = function (v) { return String(v !== null && v !== void 0 ? v : '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); };
    var emailId = function (email) { return String(email || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_'); };
    var MODULOS = [
        { id: 'dashboard', nome: 'Dashboard', acoes: ['visualizar', 'atualizar'] },
        { id: 'inventarios', nome: 'Inventários', acoes: ['visualizar', 'criar', 'editar', 'excluir', 'importar', 'exportar', 'publicar', 'finalizar'] },
        { id: 'acompanhamento', nome: 'Acompanhamento', acoes: ['visualizar', 'atualizar', 'exportar'] },
        { id: 'auditoria', nome: 'Auditoria', acoes: ['visualizar', 'criar', 'editar', 'excluir', 'importar', 'exportar', 'publicar', 'finalizar'] },
        { id: 'contagens', nome: 'Contagens', acoes: ['visualizar', 'editar', 'excluir', 'exportar'] },
        { id: 'pendencias', nome: 'Pendências', acoes: ['visualizar', 'editar', 'exportar'] },
        { id: 'divergencias', nome: 'Em Conflito', acoes: ['visualizar', 'editar', 'excluir', 'exportar'] },
        { id: 'recontagens', nome: 'Rodadas', acoes: ['visualizar', 'criar', 'editar', 'excluir', 'exportar'] },
        { id: 'rel-divergencias', nome: 'Relatório de Conflitos', acoes: ['visualizar', 'exportar'] },
        { id: 'capas-duplicadas', nome: 'Capas Duplicadas', acoes: ['visualizar', 'editar', 'excluir', 'exportar'] },
        { id: 'produtividade', nome: 'Produtividade', acoes: ['visualizar', 'exportar'] },
        { id: 'enderecos', nome: 'Endereços', acoes: ['visualizar', 'criar', 'editar', 'excluir', 'importar', 'exportar'] },
        { id: 'produtos', nome: 'Produtos', acoes: ['visualizar', 'criar', 'editar', 'excluir', 'importar', 'exportar', 'atualizar'] },
        { id: 'coletores', nome: 'Coletores', acoes: ['visualizar', 'criar', 'editar', 'excluir', 'aprovar', 'bloquear'] },
        { id: 'operadores', nome: 'Usuários e Permissões', acoes: ['visualizar', 'criar', 'editar', 'excluir'] },
        { id: 'lojas', nome: 'Lojas', acoes: ['visualizar', 'criar', 'editar', 'excluir', 'importar'] },
        { id: 'rastreabilidade', nome: 'Rastreabilidade', acoes: ['visualizar', 'excluir', 'exportar'] },
        { id: 'importar-exportar', nome: 'Importar / Exportar / API', acoes: ['visualizar', 'importar', 'exportar', 'configurar', 'executar', 'excluir'] }
    ];
    var ROTULOS = { visualizar: 'Visualizar', criar: 'Criar', editar: 'Editar', excluir: 'Excluir', importar: 'Importar', exportar: 'Exportar', publicar: 'Liberar/Publicar', finalizar: 'Finalizar', atualizar: 'Atualizar', aprovar: 'Aprovar', bloquear: 'Bloquear', configurar: 'Configurar', executar: 'Executar/Enviar' };
    var todos = function () { return Object.fromEntries(MODULOS.map(function (m) { return [m.id, Object.fromEntries(m.acoes.map(function (a) { return [a, true]; }))]; })); };
    var normalizar = function (p, legadoTotal) {
        if (!p || typeof p !== 'object')
            return legadoTotal ? todos() : {};
        var out = {};
        MODULOS.forEach(function (m) { out[m.id] = {}; m.acoes.forEach(function (a) { var _a; return out[m.id][a] = ((_a = p[m.id]) === null || _a === void 0 ? void 0 : _a[a]) === true; }); });
        return out;
    };
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
    function lojasLabels(ids) { var a = Array.isArray(ids) ? ids : []; if (!a.length)
        return '<span class="badge badge-red">Sem loja</span>'; return a.map(function (id) { var _a; return "<span class=\"badge badge-blue\" style=\"margin:2px\">".concat(esc(((_a = lojasCache.find(function (x) { return x.id === id; })) === null || _a === void 0 ? void 0 : _a.nome) || id), "</span>"); }).join(''); }
    function canais(u) { var c = u.canais_acesso || {}; return "".concat(c.coletor !== false ? '📱 Coletor ' : '').concat(c.analista === true || u.perfil === 'analista' ? '🖥️ Analista' : '').trim() || 'Sem acesso'; }
    function coletarUsuariosExistentes() {
        return __awaiter(this, void 0, void 0, function () {
            var mapa, snap, _loop_1, _i, lojasCache_1, loja, atual, k;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, carregarLojas()];
                    case 1:
                        _b.sent();
                        mapa = new Map();
                        return [4 /*yield*/, raw().collection(ACCESS).get().catch(function () { return ({ docs: [] }); })];
                    case 2:
                        snap = _b.sent();
                        snap.docs.forEach(function (d) { var x = __assign({ id: d.id }, d.data()); mapa.set(x.uid || x.email || d.id, x); });
                        _loop_1 = function (loja) {
                            var s, e_1;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        _c.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, raw().collection('lojas').doc(loja.id).collection('dt_operadores').limit(500).get()];
                                    case 1:
                                        s = _c.sent();
                                        s.docs.forEach(function (d) { var o = __assign({ id: d.id }, d.data()), k = o.uid || o.email || d.id, a = mapa.get(k) || {}; mapa.set(k, __assign(__assign(__assign({}, o), a), { uid: a.uid || o.uid || d.id, email: a.email || o.email || '', nome: a.nome || o.nome || o.name || '', _lojasEncontradas: __spreadArray([], new Set(__spreadArray(__spreadArray([], (a._lojasEncontradas || []), true), [loja.id], false)), true) })); });
                                        return [3 /*break*/, 3];
                                    case 2:
                                        e_1 = _c.sent();
                                        console.warn('[Usuários]', e_1.message);
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
                                mapa.set(k, { uid: atual.uid, email: atual.email, nome: atual.displayName || ((_a = atual.email) === null || _a === void 0 ? void 0 : _a.split('@')[0]), perfil: 'analista', acesso_todas_lojas: true, lojas_permitidas: [], canais_acesso: { coletor: true, analista: true }, permissoes: todos() });
                        }
                        usuarios = __spreadArray([], mapa.values(), true).sort(function (a, b) { return String(a.nome || a.email).localeCompare(String(b.nome || b.email), 'pt-BR'); });
                        return [2 /*return*/, usuarios];
                }
            });
        });
    }
    function listarOperadores() {
        return __awaiter(this, void 0, void 0, function () { var w, e_2; return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    w = document.getElementById('op-lista-wrap');
                    if (!w)
                        return [2 /*return*/];
                    w.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando usuários…</div></div>';
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
                    w.innerHTML = "<div class=\"empty\"><div class=\"empty-title\">Erro ao carregar usu\u00E1rios</div><div class=\"empty-sub\">".concat(esc(e_2.message), "</div></div>");
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        }); });
    }
    function usuarioProtegido(u) {
        var atual = global._currentAnalistaUser;
        return !(u === null || u === void 0 ? void 0 : u.uid) || u.uid === (atual === null || atual === void 0 ? void 0 : atual.uid) || u.admin_mestre === true || u.administrador_mestre === true;
    }
    function renderUsuarios() { var _a; var w = document.getElementById('op-lista-wrap'); if (!w)
        return; var q = String(((_a = document.getElementById('op-busca')) === null || _a === void 0 ? void 0 : _a.value) || '').toLowerCase(), lista = usuarios.filter(function (u) { return "".concat(u.nome || '', " ").concat(u.email || '', " ").concat(u.perfil || '').toLowerCase().includes(q); }); if (!lista.length) {
        w.innerHTML = '<div class="empty"><div class="empty-title">Nenhum usuário encontrado</div></div>';
        return;
    } w.innerHTML = "<div style=\"overflow:auto\"><table><thead><tr><th>Usu\u00E1rio</th><th>Acesso</th><th>Lojas</th><th>Status</th><th>A\u00E7\u00F5es</th></tr></thead><tbody>".concat(lista.map(function (u, i) { return "<tr><td><b>".concat(esc(u.nome || u.name || 'Sem nome'), "</b><div style=\"font-size:.72rem;color:var(--muted)\">").concat(esc(u.email || '—'), "</div></td><td>").concat(esc(canais(u)), "</td><td>").concat(u.acesso_todas_lojas === true ? '<span class="badge badge-green">Todas</span>' : lojasLabels(u.lojas_permitidas || u.lojasPermitidas), "</td><td>").concat(u.ativo === false ? '<span class="badge badge-red">Bloqueado</span>' : '<span class="badge badge-green">Ativo</span>', "</td><td><div style=\"display:flex;gap:6px;flex-wrap:wrap\"><button class=\"btn btn-primary btn-sm\" onclick=\"opEditarUsuario(").concat(i, ")\">\u2699\uFE0F Configurar</button>").concat(usuarioProtegido(u) ? '<span class="badge badge-blue" title="A própria conta e o administrador mestre não podem ser excluídos">Protegido</span>' : "<button class=\"btn btn-danger btn-sm\" onclick=\"opExcluirUsuario(".concat(i, ")\">\uD83D\uDDD1 Excluir</button>"), "</div></td></tr>"); }).join(''), "</tbody></table></div>"); }
    function opFiltrarLista() { renderUsuarios(); }
    function montarChecks(id, sel) { var b = document.getElementById(id); if (!b)
        return; var s = new Set(sel || []); b.innerHTML = lojasCache.map(function (l) { return "<label style=\"display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;cursor:pointer\"><input type=\"checkbox\" value=\"".concat(esc(l.id), "\" ").concat(s.has(l.id) ? 'checked' : '', "><span>").concat(esc(l.nome || l.id), "</span></label>"); }).join(''); }
    function setModo(p, m) { document.querySelectorAll("input[name=\"op-lojas-".concat(p, "-modo\"]")).forEach(function (r) { return r.checked = r.value === m; }); var b = document.getElementById("op-lojas-".concat(p, "-box")); if (b)
        b.style.display = m === 'selecionadas' ? 'block' : 'none'; }
    function renderCanais(prefix, c) {
        var _a;
        if (c === void 0) { c = {}; }
        var b = document.getElementById("op-canais-".concat(prefix));
        if (!b)
            return;
        b.innerHTML = [['coletor', '📱 Coletor'], ['analista', '🖥️ Analista']].map(function (_a) {
            var id = _a[0], n = _a[1];
            return "<label style=\"padding:10px 13px;border:1px solid var(--border);border-radius:10px;cursor:pointer\"><input type=\"checkbox\" data-canal=\"".concat(id, "\" ").concat(c[id] === true ? 'checked' : '', "> ").concat(n, "</label>");
        }).join('');
        (_a = b.querySelector('[data-canal="analista"]')) === null || _a === void 0 ? void 0 : _a.addEventListener('change', function (e) { var p = document.getElementById("op-permissoes-".concat(prefix)); if (p)
            p.style.display = e.target.checked ? 'block' : 'none'; });
    }
    function renderPermissoes(prefix, p) { var b = document.getElementById("op-permissoes-".concat(prefix)); if (!b)
        return; var perms = normalizar(p, false); b.innerHTML = "<div style=\"display:flex;gap:6px;margin-bottom:8px\"><button type=\"button\" class=\"btn btn-ghost btn-sm\" onclick=\"opMarcarPermissoes('".concat(prefix, "',true)\">Marcar tudo</button><button type=\"button\" class=\"btn btn-ghost btn-sm\" onclick=\"opMarcarPermissoes('").concat(prefix, "',false)\">Limpar</button></div><div style=\"border:1px solid var(--border);border-radius:12px;overflow:hidden\">").concat(MODULOS.map(function (m, i) { return "<div style=\"padding:10px 12px;background:".concat(i % 2 ? 'var(--surface-2)' : 'var(--surface)', "\"><div style=\"font-weight:700;font-size:.8rem;margin-bottom:7px\">").concat(esc(m.nome), "</div><div style=\"display:flex;gap:8px;flex-wrap:wrap\">").concat(m.acoes.map(function (a) { var _a; return "<label style=\"font-size:.72rem;cursor:pointer\"><input type=\"checkbox\" data-modulo=\"".concat(m.id, "\" data-acao=\"").concat(a, "\" ").concat(((_a = perms[m.id]) === null || _a === void 0 ? void 0 : _a[a]) ? 'checked' : '', "> ").concat(ROTULOS[a], "</label>"); }).join(''), "</div></div>"); }).join(''), "</div>"); }
    function opMarcarPermissoes(prefix, v) { document.querySelectorAll("#op-permissoes-".concat(prefix, " input[type=checkbox]")).forEach(function (x) { return x.checked = v; }); }
    function lerCanais(prefix) { var o = { coletor: false, analista: false }; document.querySelectorAll("#op-canais-".concat(prefix, " [data-canal]")).forEach(function (x) { return o[x.dataset.canal] = x.checked; }); return o; }
    function lerPermissoes(prefix) { var p = {}; MODULOS.forEach(function (m) { return p[m.id] = {}; }); document.querySelectorAll("#op-permissoes-".concat(prefix, " [data-modulo]")).forEach(function (x) { return p[x.dataset.modulo][x.dataset.acao] = x.checked; }); return p; }
    function validarAcesso(prefix) { var _a, _b; var c = lerCanais(prefix); if (!c.coletor && !c.analista) {
        (_a = global.showToast) === null || _a === void 0 ? void 0 : _a.call(global, 'Libere Coletor e/ou Analista', 'error');
        return false;
    } if (c.analista && !MODULOS.some(function (m) { var _a; return (_a = lerPermissoes(prefix)[m.id]) === null || _a === void 0 ? void 0 : _a.visualizar; })) {
        (_b = global.showToast) === null || _b === void 0 ? void 0 : _b.call(global, 'Libere ao menos uma aba do Analista', 'error');
        return false;
    } return true; }
    function opSetModoLojasCriar(m) { setModo('criar', m); }
    function opSetModoLojasEditar(m) { setModo('editar', m); }
    function opEditarUsuario(i) {
        return __awaiter(this, void 0, void 0, function () { var legadoAnalista; var _a; return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    editando = usuarios[i];
                    if (!editando)
                        return [2 /*return*/];
                    return [4 /*yield*/, carregarLojas()];
                case 1:
                    _b.sent();
                    document.getElementById('opedit-nome').value = editando.nome || editando.name || '';
                    document.getElementById('opedit-cargo').value = editando.perfil || editando.tipo || 'operador';
                    document.getElementById('opedit-setor').value = editando.setor || '';
                    document.getElementById('opedit-senha').value = '';
                    montarChecks('op-lojas-editar-lista', editando.lojas_permitidas || []);
                    setModo('editar', editando.acesso_todas_lojas === true ? 'todas' : 'selecionadas');
                    legadoAnalista = editando.perfil === 'analista' && !editando.canais_acesso;
                    renderCanais('editar', editando.canais_acesso || { coletor: true, analista: legadoAnalista });
                    renderPermissoes('editar', normalizar(editando.permissoes, legadoAnalista));
                    document.getElementById('op-permissoes-editar').style.display = (((_a = editando.canais_acesso) === null || _a === void 0 ? void 0 : _a.analista) === true || legadoAnalista) ? 'block' : 'none';
                    document.getElementById('op-modal-bg').style.display = 'flex';
                    return [2 /*return*/];
            }
        }); });
    }
    function opFecharModal() { document.getElementById('op-modal-bg').style.display = 'none'; editando = null; }
    function opSalvarEdicao() {
        return __awaiter(this, void 0, void 0, function () { var modo, sel, uid, c, data, _i, lojasCache_2, l, ref, ex, e_3; var _a, _b, _c, _d, _e; return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    if (!editando || !validarAcesso('editar'))
                        return [2 /*return*/];
                    modo = ((_a = document.querySelector('input[name="op-lojas-editar-modo"]:checked')) === null || _a === void 0 ? void 0 : _a.value) || 'todas', sel = __spreadArray([], document.querySelectorAll('#op-lojas-editar-lista input:checked'), true).map(function (x) { return x.value; });
                    if (modo === 'selecionadas' && !sel.length)
                        return [2 /*return*/, (_b = global.showToast) === null || _b === void 0 ? void 0 : _b.call(global, 'Selecione ao menos uma loja', 'error')];
                    uid = editando.uid || editando.id || emailId(editando.email), c = lerCanais('editar'), data = { uid: uid, email: String(editando.email || '').toLowerCase(), nome: document.getElementById('opedit-nome').value.trim(), perfil: c.analista ? 'analista' : 'operador', setor: document.getElementById('opedit-setor').value.trim(), ativo: editando.ativo !== false, canais_acesso: c, permissoes: lerPermissoes('editar'), acesso_todas_lojas: modo === 'todas', lojas_permitidas: modo === 'todas' ? [] : sel, atualizado_em: new Date().toISOString(), atualizado_por: ((_c = global._currentAnalistaUser) === null || _c === void 0 ? void 0 : _c.email) || '' };
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
                    l = lojasCache_2[_i];
                    ref = raw().collection('lojas').doc(l.id).collection('dt_operadores').doc(uid);
                    return [4 /*yield*/, ref.get().catch(function () { return null; })];
                case 4:
                    ex = _f.sent();
                    if (!((ex === null || ex === void 0 ? void 0 : ex.exists) || data.acesso_todas_lojas || sel.includes(l.id))) return [3 /*break*/, 6];
                    return [4 /*yield*/, ref.set(data, { merge: true })];
                case 5:
                    _f.sent();
                    _f.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 3];
                case 7:
                    (_d = global.showToast) === null || _d === void 0 ? void 0 : _d.call(global, 'Acessos e permissões salvos', 'success');
                    opFecharModal();
                    return [4 /*yield*/, listarOperadores()];
                case 8:
                    _f.sent();
                    return [3 /*break*/, 10];
                case 9:
                    e_3 = _f.sent();
                    (_e = global.showToast) === null || _e === void 0 ? void 0 : _e.call(global, 'Erro ao salvar: ' + e_3.message, 'error');
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/];
            }
        }); });
    }
    function opAbrirModalCriar() { carregarLojas().then(function () { montarChecks('op-lojas-criar-lista', []); setModo('criar', 'todas'); renderCanais('criar', { coletor: true, analista: false }); renderPermissoes('criar', {}); document.getElementById('op-permissoes-criar').style.display = 'none'; document.getElementById('op-modal-criar-bg').style.display = 'flex'; }); }
    function opFecharModalCriar() { document.getElementById('op-modal-criar-bg').style.display = 'none'; }
    function opSelecionarTipo(tipo) { document.querySelectorAll('input[name="op-tipo"]').forEach(function (r) { return r.checked = r.value === tipo; }); var an = tipo === 'analista'; var ac = document.querySelector('#op-canais-criar [data-canal="analista"]'), co = document.querySelector('#op-canais-criar [data-canal="coletor"]'); if (ac)
        ac.checked = an; if (co)
        co.checked = true; var p = document.getElementById('op-permissoes-criar'); if (p)
        p.style.display = an ? 'block' : 'none'; }
    function opGerarUsername() { var _a; var n = (_a = document.getElementById('op-nome')) === null || _a === void 0 ? void 0 : _a.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean); if ((n === null || n === void 0 ? void 0 : n.length) >= 2)
        document.getElementById('op-username').value = n[0] + '.' + n[n.length - 1]; }
    function opGerarSenha() { document.getElementById('op-senha').value = Math.random().toString(36).slice(-4).toUpperCase() + Math.floor(1000 + Math.random() * 9000); }
    function toggleOpSenha() { var e = document.getElementById('op-senha'); e.type = e.type === 'password' ? 'text' : 'password'; }
    function toggleOpeditSenha() { var e = document.getElementById('opedit-senha'); e.type = e.type === 'password' ? 'text' : 'password'; }
    function opValidarUsername() { }
    function opValidarSenha() { }
    function criarOperador() {
        return __awaiter(this, void 0, void 0, function () { var nome, login, senha, email, modo, sel, app, cred, c, data_1, _i, _a, l, e_4; var _b, _c, _d, _e, _f; return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    nome = document.getElementById('op-nome').value.trim(), login = document.getElementById('op-username').value.trim().toLowerCase(), senha = document.getElementById('op-senha').value;
                    if (!nome || !login || senha.length < 6)
                        return [2 /*return*/, (_b = global.showToast) === null || _b === void 0 ? void 0 : _b.call(global, 'Preencha nome, login e senha com no mínimo 6 caracteres', 'error')];
                    if (!validarAcesso('criar'))
                        return [2 /*return*/];
                    email = login.includes('@') ? login : login + '@daterrinhaalimentos.com.br', modo = ((_c = document.querySelector('input[name="op-lojas-criar-modo"]:checked')) === null || _c === void 0 ? void 0 : _c.value) || 'todas', sel = __spreadArray([], document.querySelectorAll('#op-lojas-criar-lista input:checked'), true).map(function (x) { return x.value; });
                    if (modo === 'selecionadas' && !sel.length)
                        return [2 /*return*/, (_d = global.showToast) === null || _d === void 0 ? void 0 : _d.call(global, 'Selecione ao menos uma loja', 'error')];
                    _g.label = 1;
                case 1:
                    _g.trys.push([1, 11, , 12]);
                    app = void 0;
                    try {
                        app = firebase.app('dt-user-admin');
                    }
                    catch (_) {
                        app = firebase.initializeApp(global.DT_FIREBASE_CFG, 'dt-user-admin');
                    }
                    return [4 /*yield*/, app.auth().createUserWithEmailAndPassword(email, senha)];
                case 2:
                    cred = _g.sent();
                    return [4 /*yield*/, cred.user.updateProfile({ displayName: nome })];
                case 3:
                    _g.sent();
                    c = lerCanais('criar'), data_1 = { uid: cred.user.uid, email: email, nome: nome, perfil: c.analista ? 'analista' : 'operador', ativo: true, canais_acesso: c, permissoes: lerPermissoes('criar'), acesso_todas_lojas: modo === 'todas', lojas_permitidas: modo === 'todas' ? [] : sel, criado_em: new Date().toISOString() };
                    return [4 /*yield*/, raw().collection(ACCESS).doc(cred.user.uid).set(data_1)];
                case 4:
                    _g.sent();
                    _i = 0, _a = lojasCache.filter(function (l) { return data_1.acesso_todas_lojas || sel.includes(l.id); });
                    _g.label = 5;
                case 5:
                    if (!(_i < _a.length)) return [3 /*break*/, 8];
                    l = _a[_i];
                    return [4 /*yield*/, raw().collection('lojas').doc(l.id).collection('dt_operadores').doc(cred.user.uid).set(data_1, { merge: true })];
                case 6:
                    _g.sent();
                    _g.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 5];
                case 8: return [4 /*yield*/, app.auth().signOut()];
                case 9:
                    _g.sent();
                    opFecharModalCriar();
                    (_e = global.showToast) === null || _e === void 0 ? void 0 : _e.call(global, 'Usuário criado com permissões detalhadas', 'success');
                    return [4 /*yield*/, listarOperadores()];
                case 10:
                    _g.sent();
                    return [3 /*break*/, 12];
                case 11:
                    e_4 = _g.sent();
                    (_f = global.showToast) === null || _f === void 0 ? void 0 : _f.call(global, 'Erro ao criar usuário: ' + e_4.message, 'error');
                    return [3 /*break*/, 12];
                case 12: return [2 /*return*/];
            }
        }); });
    }
    function opExcluirUsuario(i) {
        return __awaiter(this, void 0, void 0, function () {
            var u, nome, callable, resposta, e_5, codigo, msg;
            var _a, _b, _c, _d, _e, _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        u = usuarios[i];
                        if (!u || usuarioProtegido(u))
                            return [2 /*return*/, (_a = global.showToast) === null || _a === void 0 ? void 0 : _a.call(global, 'Esta conta é protegida e não pode ser excluída', 'error')];
                        if (!temPermissao('operadores', 'excluir'))
                            return [2 /*return*/, (_b = global.showToast) === null || _b === void 0 ? void 0 : _b.call(global, 'Seu login não possui permissão para excluir usuários', 'error')];
                        nome = u.nome || u.email || 'este usuário';
                        if (!global.confirm("Excluir permanentemente ".concat(nome, "?\n\nO login ser\u00E1 removido do Firebase Authentication e os acessos ser\u00E3o apagados de todas as lojas. Esta a\u00E7\u00E3o n\u00E3o pode ser desfeita.")))
                            return [2 /*return*/];
                        _g.label = 1;
                    case 1:
                        _g.trys.push([1, 4, , 5]);
                        (_c = global.showToast) === null || _c === void 0 ? void 0 : _c.call(global, 'Excluindo usuário do Firebase…', 'info');
                        callable = firebase.app().functions('southamerica-east1').httpsCallable('excluirUsuario');
                        return [4 /*yield*/, callable({ uid: u.uid })];
                    case 2:
                        resposta = _g.sent();
                        if (!((_d = resposta === null || resposta === void 0 ? void 0 : resposta.data) === null || _d === void 0 ? void 0 : _d.ok))
                            throw new Error('O Firebase não confirmou a exclusão');
                        (_e = global.showToast) === null || _e === void 0 ? void 0 : _e.call(global, 'Usuário excluído do Firebase e de todas as lojas', 'success');
                        return [4 /*yield*/, listarOperadores()];
                    case 3:
                        _g.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        e_5 = _g.sent();
                        console.error('[Usuários] Falha ao excluir', e_5);
                        codigo = String((e_5 === null || e_5 === void 0 ? void 0 : e_5.code) || '').replace('functions/', '');
                        msg = codigo === 'not-found' ? 'Publique também as funções do Firebase antes de usar a exclusão.' : ((e_5 === null || e_5 === void 0 ? void 0 : e_5.message) || 'Falha desconhecida');
                        (_f = global.showToast) === null || _f === void 0 ? void 0 : _f.call(global, 'Erro ao excluir usuário: ' + msg, 'error');
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    }
    function temPermissao(modulo, acao) {
        var _a, _b;
        if (acao === void 0) { acao = 'visualizar'; }
        var a = global.DT_USUARIO_ACESSO_ATUAL;
        if (!a || !a.permissoes)
            return true;
        return ((_b = (_a = a.permissoes) === null || _a === void 0 ? void 0 : _a[modulo]) === null || _b === void 0 ? void 0 : _b[acao]) === true;
    }
    function aplicarPermissoesAnalista() {
        var _a;
        var a = global.DT_USUARIO_ACESSO_ATUAL;
        if (!a)
            return;
        var legado = !a.permissoes;
        if (legado)
            return;
        MODULOS.forEach(function (m) { var nav = document.getElementById('nav-' + m.id), page = document.getElementById('page-' + m.id), ver = temPermissao(m.id); if (nav)
            nav.style.display = ver ? '' : 'none'; if (page && !ver)
            page.classList.remove('on'); });
        document.querySelectorAll('[onclick],[onchange]').forEach(function (el) { var _a, _b; var txt = (el.getAttribute('onclick') || el.getAttribute('onchange') || '').toLowerCase(), page = (_b = (_a = el.closest('.page')) === null || _a === void 0 ? void 0 : _a.id) === null || _b === void 0 ? void 0 : _b.replace(/^page-/, ''); if (!page || !MODULOS.some(function (m) { return m.id === page; }))
            return; var acao = 'visualizar'; if (/exclu|limpar|cancelar.*recont/.test(txt))
            acao = 'excluir';
        else if (/export|baixar|download/.test(txt))
            acao = 'exportar';
        else if (/import|processfile|handlefile/.test(txt))
            acao = 'importar';
        else if (/criar|novo|adicionar|registrar/.test(txt))
            acao = 'criar';
        else if (/public|liberar/.test(txt))
            acao = 'publicar';
        else if (/finaliz|fecharinvent|encerrar/.test(txt))
            acao = 'finalizar';
        else if (/aprovar/.test(txt))
            acao = 'aprovar';
        else if (/bloquear/.test(txt))
            acao = 'bloquear';
        else if (/salvarconfig|apiset|mapeamento/.test(txt))
            acao = 'configurar';
        else if (/enviar|executar/.test(txt))
            acao = 'executar';
        else if (/salvar|editar|reatrib|confirmar/.test(txt))
            acao = 'editar';
        else if (/atualizar|refresh/.test(txt))
            acao = 'atualizar'; if (acao !== 'visualizar' && !temPermissao(page, acao))
            el.style.display = 'none'; });
        var primeira = MODULOS.find(function (m) { return temPermissao(m.id); });
        if (!document.querySelector('.page.on') && primeira)
            (_a = global.goPage) === null || _a === void 0 ? void 0 : _a.call(global, primeira.id, document.getElementById('nav-' + primeira.id));
    }
    var timerPermissoes = null;
    document.addEventListener('DOMContentLoaded', function () {
        new MutationObserver(function () {
            var _a;
            if (!((_a = global.DT_USUARIO_ACESSO_ATUAL) === null || _a === void 0 ? void 0 : _a.permissoes))
                return;
            clearTimeout(timerPermissoes);
            timerPermissoes = setTimeout(aplicarPermissoesAnalista, 40);
        }).observe(document.body, { childList: true, subtree: true });
    });
    function oplSetTab(tab) { var _a; var op = tab === 'operadores'; document.getElementById('opl-page-operadores').style.display = op ? 'block' : 'none'; document.getElementById('opl-page-lojas').style.display = op ? 'none' : 'block'; if (op)
        listarOperadores();
    else
        (_a = global.renderGestaoLojas) === null || _a === void 0 ? void 0 : _a.call(global); }
    function opCarregarOperadoresParaFiltro() { var s = document.getElementById('op-rec-filtro-operador'); if (s)
        s.innerHTML = '<option value="">Selecione um operador…</option>' + usuarios.map(function (u) { return "<option value=\"".concat(esc(u.uid || u.id), "\">").concat(esc(u.nome || u.email), "</option>"); }).join(''); }
    function opVerificarMinhaConta() { }
    Object.assign(global, { DT_MODULOS_PERMISSOES: MODULOS, temPermissao: temPermissao, aplicarPermissoesAnalista: aplicarPermissoesAnalista, listarOperadores: listarOperadores, opFiltrarLista: opFiltrarLista, opEditarUsuario: opEditarUsuario, opExcluirUsuario: opExcluirUsuario, opSalvarEdicao: opSalvarEdicao, opFecharModal: opFecharModal, opAbrirModalCriar: opAbrirModalCriar, opFecharModalCriar: opFecharModalCriar, opSetModoLojasCriar: opSetModoLojasCriar, opSetModoLojasEditar: opSetModoLojasEditar, opSelecionarTipo: opSelecionarTipo, opGerarUsername: opGerarUsername, opGerarSenha: opGerarSenha, toggleOpSenha: toggleOpSenha, toggleOpeditSenha: toggleOpeditSenha, opValidarUsername: opValidarUsername, opValidarSenha: opValidarSenha, criarOperador: criarOperador, oplSetTab: oplSetTab, opCarregarOperadoresParaFiltro: opCarregarOperadoresParaFiltro, opVerificarMinhaConta: opVerificarMinhaConta, opMarcarPermissoes: opMarcarPermissoes });
})(window);
