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
// v52 — ações estáveis do Inventário: publicar, excluir e sincronizar com coletores.
(function (global) {
    'use strict';
    function state() { return global.AnalistaStore && global.AnalistaStore.getState ? global.AnalistaStore.getState() : {}; }
    function db() { return global.FS_AN || (global.getDTFirestore && global.getDTFirestore()) || (global.getDTRawFirestore && global.getDTRawFirestore()); }
    function coll() { return (global.DT_FCOL && global.DT_FCOL.inventarios) || 'dt_inventarios'; }
    function toast(m, t) { if (typeof global.showToast === 'function')
        global.showToast(m, t || 'i');
    else
        alert(m); }
    function invById(id) { return (state().inventarios || []).find(function (i) { return i.id === id; }) || null; }
    function refresh() {
        try {
            global.saveAll && global.saveAll();
        }
        catch (e) { }
        try {
            global.renderInvTable && global.renderInvTable();
        }
        catch (e) { }
        try {
            global.renderDashboard && global.renderDashboard();
        }
        catch (e) { }
        try {
            global.atualizarBadgesNav && global.atualizarBadgesNav();
        }
        catch (e) { }
        try {
            global.popularSelects && global.popularSelects();
        }
        catch (e) { }
    }
    function apagarColecaoEmLotes(ref) {
        return __awaiter(this, void 0, void 0, function () {
            var snap, docs, total, raw, i, batch;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, ref.get().catch(function () { return null; })];
                    case 1:
                        snap = _a.sent();
                        if (!snap || snap.empty)
                            return [2 /*return*/, 0];
                        docs = snap.docs || [], total = 0, raw = db();
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < docs.length)) return [3 /*break*/, 5];
                        batch = raw.batch();
                        docs.slice(i, i + 400).forEach(function (d) { batch.delete(d.ref); });
                        return [4 /*yield*/, batch.commit()];
                    case 3:
                        _a.sent();
                        total += Math.min(400, docs.length - i);
                        _a.label = 4;
                    case 4:
                        i += 400;
                        return [3 /*break*/, 2];
                    case 5: return [2 /*return*/, total];
                }
            });
        });
    }
    function aliasesInventario(inv) {
        return [inv && inv.id, inv && inv.codigo, inv && inv.nome, inv && inv.inventario_id, inv && inv.inventarioId]
            .filter(function (v) { return v != null && String(v).trim(); }).map(function (v) { return String(v).trim(); });
    }
    function apagarDocumentosRelacionados(inv) {
        return __awaiter(this, void 0, void 0, function () {
            var raw, aliases, refs, colecoes, campos, consultas, lista, i, b;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        raw = db(), aliases = aliasesInventario(inv), refs = new Map();
                        colecoes = ['dt_contagens', 'dt_vazios', 'dt_divergencias', 'dt_recontagens'];
                        campos = ['inventario_id', 'inventarioId'];
                        consultas = [];
                        colecoes.forEach(function (nome) {
                            campos.forEach(function (campo) {
                                aliases.forEach(function (alias) {
                                    consultas.push(raw.collection(nome).where(campo, '==', alias).get().then(function (s) {
                                        (s.docs || []).forEach(function (d) { refs.set(d.ref.path, d.ref); });
                                    }).catch(function (e) { console.warn('[Excluir inventário] consulta', nome, campo, alias, e.message); }));
                                });
                            });
                        });
                        return [4 /*yield*/, Promise.all(consultas)];
                    case 1:
                        _a.sent();
                        lista = Array.from(refs.values());
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < lista.length)) return [3 /*break*/, 5];
                        b = raw.batch();
                        lista.slice(i, i + 400).forEach(function (r) { b.delete(r); });
                        return [4 /*yield*/, b.commit()];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        i += 400;
                        return [3 /*break*/, 2];
                    case 5: return [2 /*return*/, lista.length];
                }
            });
        });
    }
    function republicarBaseInventario(id) {
        return __awaiter(this, void 0, void 0, function () {
            var inv, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        inv = invById(id);
                        if (!inv) {
                            toast('Inventário não encontrado. Atualize a página e tente novamente.', 'e');
                            return [2 /*return*/, false];
                        }
                        if (!navigator.onLine) {
                            toast('Sem internet. Conecte-se para publicar a base.', 'w');
                            return [2 /*return*/, false];
                        }
                        if (!Array.isArray(inv.base) || !inv.base.length) {
                            toast('Este inventário não possui base carregada. Use “Reimportar Base”.', 'w');
                            return [2 /*return*/, false];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        toast('Publicando inventário e base no Firebase…', 'i');
                        inv.status = String(inv.status || 'ATIVO').toUpperCase() === 'FECHADO' ? 'FECHADO' : (String(inv.status || 'ATIVO').toUpperCase() === 'PAUSADO' ? 'PAUSADO' : 'ATIVO');
                        inv.oculto_coletor = false;
                        inv.publicado_em = new Date().toISOString();
                        inv.total_registros = inv.base.length;
                        return [4 /*yield*/, global.fsPublicarInventario(inv)];
                    case 2:
                        _a.sent();
                        // Confirma o documento que o coletor consulta.
                        return [4 /*yield*/, db().collection(coll()).doc(inv.id).set({
                                id: inv.id,
                                nome: inv.nome || inv.codigo || inv.id,
                                codigo: inv.codigo || inv.id,
                                status: inv.status,
                                oculto_coletor: false,
                                total_registros: inv.total_registros,
                                total_enderecos: inv.total_enderecos || 0,
                                loja_principal: inv.loja_principal || '',
                                lojas_espelho: inv.lojas_espelho || [],
                                data_inicio: inv.data_inicio || '',
                                publicado_em: new Date(),
                                base_chunks: Math.ceil(inv.base.length / 1000),
                                base_chunk_size: 1000
                            }, { merge: true })];
                    case 3:
                        // Confirma o documento que o coletor consulta.
                        _a.sent();
                        refresh();
                        toast('✅ Base publicada. O inventário já está disponível para os coletores.', 's');
                        return [2 /*return*/, true];
                    case 4:
                        e_1 = _a.sent();
                        console.error('[v52 republicarBaseInventario]', e_1);
                        toast('Falha ao publicar no Firebase: ' + (e_1.message || e_1), 'e');
                        return [2 /*return*/, false];
                    case 5: return [2 /*return*/];
                }
            });
        });
    }
    function excluirInventario(id) {
        return __awaiter(this, void 0, void 0, function () {
            var inv, executar, msg;
            return __generator(this, function (_a) {
                inv = invById(id);
                if (!inv) {
                    toast('Inventário não encontrado.', 'e');
                    return [2 /*return*/, false];
                }
                executar = function () {
                    return __awaiter(this, void 0, void 0, function () {
                        var stAntes, aliases, novo, raw, ref, _a, _e_1, e_2, _b, _e_2;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    stAntes = state();
                                    _c.label = 1;
                                case 1:
                                    _c.trys.push([1, 9, , 15]);
                                    aliases = aliasesInventario(inv);
                                    novo = (stAntes.inventarios || []).filter(function (x) { return String(x.id) !== String(id); });
                                    if (global.AnalistaState && global.AnalistaState.replaceSlice)
                                        global.AnalistaState.replaceSlice('inventarios', novo, { source: 'excluirInventario-v80' });
                                    ['contagens', 'vazios', 'divergencias', 'recontagens'].forEach(function (chave) {
                                        var arr = (state()[chave] || []).filter(function (x) {
                                            var xids = [x.inventario_id, x.inventarioId, x.inventario, x.inv_id].filter(function (v) { return v != null; }).map(String);
                                            return !xids.some(function (v) { return aliases.includes(v); });
                                        });
                                        if (global.AnalistaState && global.AnalistaState.replaceSlice)
                                            global.AnalistaState.replaceSlice(chave, arr, { source: 'excluirInventario-v80' });
                                    });
                                    refresh();
                                    toast('Removendo inventário e dados relacionados…', 'i');
                                    raw = db();
                                    if (!(raw && navigator.onLine)) return [3 /*break*/, 4];
                                    ref = raw.collection(coll()).doc(id);
                                    // Excluir o documento principal primeiro tira o inventário dos coletores.
                                    return [4 /*yield*/, ref.delete().catch(function (e) { if (e && e.code !== 'not-found')
                                            throw e; })];
                                case 2:
                                    // Excluir o documento principal primeiro tira o inventário dos coletores.
                                    _c.sent();
                                    return [4 /*yield*/, Promise.all([
                                            apagarColecaoEmLotes(ref.collection('base_chunks')),
                                            apagarColecaoEmLotes(ref.collection('contagens')),
                                            apagarColecaoEmLotes(ref.collection('resultados')),
                                            apagarDocumentosRelacionados(inv)
                                        ])];
                                case 3:
                                    _c.sent();
                                    _c.label = 4;
                                case 4:
                                    _c.trys.push([4, 7, , 8]);
                                    _a = global.AnalistaFirebaseService && global.AnalistaFirebaseService.restart;
                                    if (!_a) return [3 /*break*/, 6];
                                    return [4 /*yield*/, global.AnalistaFirebaseService.restart()];
                                case 5:
                                    _a = (_c.sent());
                                    _c.label = 6;
                                case 6:
                                    _a;
                                    return [3 /*break*/, 8];
                                case 7:
                                    _e_1 = _c.sent();
                                    return [3 /*break*/, 8];
                                case 8:
                                    refresh();
                                    toast('🗑 Inventário e registros relacionados excluídos.', 's');
                                    return [2 /*return*/, true];
                                case 9:
                                    e_2 = _c.sent();
                                    console.error('[v80 excluirInventario]', e_2);
                                    _c.label = 10;
                                case 10:
                                    _c.trys.push([10, 13, , 14]);
                                    _b = global.AnalistaFirebaseService && global.AnalistaFirebaseService.restart;
                                    if (!_b) return [3 /*break*/, 12];
                                    return [4 /*yield*/, global.AnalistaFirebaseService.restart()];
                                case 11:
                                    _b = (_c.sent());
                                    _c.label = 12;
                                case 12:
                                    _b;
                                    return [3 /*break*/, 14];
                                case 13:
                                    _e_2 = _c.sent();
                                    return [3 /*break*/, 14];
                                case 14:
                                    toast('Não foi possível concluir a exclusão: ' + (e_2.message || e_2), 'e');
                                    return [2 /*return*/, false];
                                case 15: return [2 /*return*/];
                            }
                        });
                    });
                };
                msg = 'Excluir permanentemente o inventário “' + (inv.nome || inv.codigo || id) + '”? Esta ação remove também contagens, pendências, conflitos e recontagens relacionadas.';
                if (typeof global.showConfirm === 'function') {
                    global.showConfirm(msg, executar, { title: 'Excluir inventário', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
                    return [2 /*return*/, true];
                }
                if (confirm(msg))
                    return [2 /*return*/, executar()];
                return [2 /*return*/, false];
            });
        });
    }
    // Corrige a visibilidade usando a coleção certa (FS_COL antigo podia não existir).
    global.toggleInvVisibilidade = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            var inv, e_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        inv = invById(id);
                        if (!inv)
                            return [2 /*return*/];
                        inv.oculto_coletor = !inv.oculto_coletor;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        if (!(db() && navigator.onLine)) return [3 /*break*/, 3];
                        return [4 /*yield*/, db().collection(coll()).doc(id).set({ oculto_coletor: inv.oculto_coletor }, { merge: true })];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        refresh();
                        toast(inv.oculto_coletor ? '🙈 Inventário ocultado nos coletores' : '👁 Inventário visível nos coletores', inv.oculto_coletor ? 'w' : 's');
                        return [3 /*break*/, 5];
                    case 4:
                        e_3 = _a.sent();
                        inv.oculto_coletor = !inv.oculto_coletor;
                        refresh();
                        toast('Falha ao alterar visibilidade: ' + (e_3.message || e_3), 'e');
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    global.republicarBaseInventario = republicarBaseInventario;
    global.excluirInventario = excluirInventario;
})(window);
