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
(function (global) {
    var Actions = global.AnalistaActions;
    var InventarioService = global.AnalistaInventarioService;
    var state = {
        started: false,
        currentInventoryIds: [],
        unsubscribers: { contagens: [], vazios: [], divergencias: [], recontagens: [], coletores: null, enderecos: null }
    };
    function _emitSync(ok, message, extra) {
        var _a;
        global.AnalistaStore.dispatch(Actions.setSyncStatus(Object.assign({
            ok: ok,
            message: message || '',
            started: state.started,
            lastSyncAt: new Date().toISOString(),
            source: ok ? 'firebase' : 'cache'
        }, extra || {})));
        var updateUI = (_a = global.AnalistaBootstrap) === null || _a === void 0 ? void 0 : _a.updateSyncUI;
        if (typeof updateUI === 'function') {
            updateUI(ok, message || new Date().toLocaleTimeString('pt-BR'));
        }
    }
    function _getActiveInventoryIds() {
        return InventarioService.getInventariosAtivosIds(global.AnalistaStore.getState().inventarios);
    }
    function _normalizarMudanca(collection, change) {
        var raw = __assign({ id: change.doc.id }, change.doc.data());
        var normalized = (collection === 'recontagens' || collection === 'divergencias')
            ? raw
            : InventarioService.normalizarContagem(raw);
        return { type: change.type, entity: normalized };
    }
    function _persistirSlice(slice) {
        try {
            var Storage_1 = global.AnalistaStorage;
            var st = global.AnalistaStore.getState();
            if (!(Storage_1 === null || Storage_1 === void 0 ? void 0 : Storage_1.storageSave))
                return;
            if (slice === 'contagens')
                Storage_1.storageSave(Storage_1.KEYS.contagens, st.contagens || []);
            if (slice === 'recontagens')
                Storage_1.storageSave(Storage_1.KEYS.recontagens, st.recontagens || []);
            if (slice === 'divergencias')
                Storage_1.storageSave(Storage_1.KEYS.divergencias, st.divergencias || []);
        }
        catch (err) {
            console.warn('[FirebaseService] cache da coleção:', (err === null || err === void 0 ? void 0 : err.message) || err);
        }
    }
    // Aplica todo o snapshot em uma única ação. O subscriber do AppController é o
    // único responsável por solicitar renderização e atualização dos badges.
    function _applyCollectionChanges(collection, docChanges) {
        var changes = (docChanges || []).map(function (change) { return _normalizarMudanca(collection, change); });
        if (!changes.length)
            return false;
        var slice = collection === 'vazios' ? 'contagens' : collection;
        var atual = Array.isArray(global.AnalistaStore.getState()[slice])
            ? global.AnalistaStore.getState()[slice]
            : [];
        var byId = new Map(atual.map(function (item) { return [String((item === null || item === void 0 ? void 0 : item.id) || ''), item]; }));
        changes.forEach(function (_a) {
            var type = _a.type, entity = _a.entity;
            var id = String((entity === null || entity === void 0 ? void 0 : entity.id) || '');
            if (!id)
                return;
            if (type === 'removed')
                byId.delete(id);
            else
                byId.set(id, entity);
        });
        global.AnalistaStore.dispatch(Actions.replaceSlice(slice, Array.from(byId.values()), {
            source: 'firebase-batch',
            collection: collection,
            changes: changes.length
        }));
        _persistirSlice(slice);
        return true;
    }
    function _listenEnderecos() {
        var _this = this;
        if (!navigator.onLine)
            return null;
        var aplicar = function (docs) {
            var _a, _b;
            global.AnalistaStore.dispatch(Actions.replaceSlice('enderecosLista', docs, { source: 'firebase' }));
            var agrupados = ((_a = global.AnalistaBootstrap) === null || _a === void 0 ? void 0 : _a.agruparEnderecosPorSetor)
                ? global.AnalistaBootstrap.agruparEnderecosPorSetor(docs)
                : docs.reduce(function (acc, item) {
                    var setor = (item === null || item === void 0 ? void 0 : item.setor) || (item === null || item === void 0 ? void 0 : item.local) || (item === null || item === void 0 ? void 0 : item.nome_local) || 'SEM_SETOR';
                    if (!acc[setor])
                        acc[setor] = [];
                    acc[setor].push(item);
                    return acc;
                }, {});
            global.AnalistaStore.dispatch(Actions.setPath('enderecosPorSetor', agrupados, { source: 'firebase' }));
            var Storage = global.AnalistaStorage;
            if ((Storage === null || Storage === void 0 ? void 0 : Storage.storageSave) && ((_b = Storage === null || Storage === void 0 ? void 0 : Storage.KEYS) === null || _b === void 0 ? void 0 : _b.enderecos)) {
                Storage.storageSave(Storage.KEYS.enderecos, docs);
            }
            if (typeof global.atualizarEnderecos === 'function')
                global.atualizarEnderecos();
            _emitSync(true, "".concat(docs.length, " endere\u00E7os carregados do Firebase"));
        };
        // A publicação atual grava os endereços em dt_locais_chunks.
        return global.FS_AN.collection('dt_locais_chunks')
            .orderBy('parte')
            .onSnapshot(function (snapshot) { return __awaiter(_this, void 0, void 0, function () {
            var docs, snap, fallbackErr_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        docs = [];
                        snapshot.docs.forEach(function (doc) {
                            var data = doc.data() || {};
                            var itens = Array.isArray(data.dados) ? data.dados
                                : Array.isArray(data.itens) ? data.itens : [];
                            itens.forEach(function (item, index) { return docs.push(__assign({ id: item.id || "".concat(doc.id, "_").concat(index) }, item)); });
                        });
                        if (!!docs.length) return [3 /*break*/, 4];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, global.FS_AN.collection('dt_locais').get()];
                    case 2:
                        snap = _a.sent();
                        aplicar(snap.docs.map(function (doc) { return (__assign({ id: doc.id }, doc.data())); }));
                        return [2 /*return*/];
                    case 3:
                        fallbackErr_1 = _a.sent();
                        console.warn('[FirebaseService] dt_locais fallback vazio:', fallbackErr_1.message);
                        return [3 /*break*/, 4];
                    case 4:
                        aplicar(docs);
                        return [2 /*return*/];
                }
            });
        }); }, function (err) { return __awaiter(_this, void 0, void 0, function () {
            var snap, fallbackErr_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.warn('[FirebaseService] dt_locais_chunks:', err.message);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, global.FS_AN.collection('dt_locais').get()];
                    case 2:
                        snap = _a.sent();
                        aplicar(snap.docs.map(function (doc) { return (__assign({ id: doc.id }, doc.data())); }));
                        return [3 /*break*/, 4];
                    case 3:
                        fallbackErr_2 = _a.sent();
                        console.warn('[FirebaseService] dt_locais fallback:', fallbackErr_2.message);
                        _emitSync(false, 'Falha ao carregar endereços do Firebase');
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        }); });
    }
    function _listenCollection(collection, path) {
        var ids = _getActiveInventoryIds();
        if (!ids.length || !navigator.onLine)
            return [];
        var chunks = InventarioService.chunkIds(ids, 10);
        return chunks.map(function (chunk) {
            return global.FS_AN.collection(path)
                .where('inventario_id', 'in', chunk)
                .onSnapshot(function (snapshot) {
                var changed = _applyCollectionChanges(collection, snapshot.docChanges());
                if (changed)
                    _emitSync(true, 'Tempo real ativo');
            }, function (err) {
                console.warn("[FirebaseService] ".concat(collection, ":"), err.message);
                _emitSync(false, "Falha na escuta de ".concat(collection));
            });
        });
    }
    // Listener sem filtro de inventário — usado quando nenhum inventário está ativo no cache
    function _listenCollectionAll(collection, path) {
        if (!navigator.onLine)
            return [];
        // Nem todas as coleções usam o mesmo campo de data (criado_em/criada_em).
        // Evitar orderBy aqui impede que a escuta falhe por campo ausente ou índice.
        var unsub = global.FS_AN.collection(path)
            .limit(1000)
            .onSnapshot(function (snapshot) {
            var changed = _applyCollectionChanges(collection, snapshot.docChanges());
            if (changed)
                _emitSync(true, 'Tempo real ativo');
        }, function (err) {
            console.warn("[FirebaseService] ".concat(collection, " (all):"), err.message);
        });
        return [unsub];
    }
    // ── Listener de coletores (sem filtro por inventario_id) ─────────────────────
    var _coletoresFingerprint = '';
    function _normalizarColetores(snapshot) {
        return snapshot.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); }).filter(function (d) { return d.excluido !== true && d.aprovado !== 'revogado'; });
    }
    function _fingerprintColetores(docs) {
        return JSON.stringify(docs.map(function (item) { return ({
            id: item.id,
            aprovado: item.aprovado || 'pendente',
            bloqueado: item.bloqueado === true,
            ativo: item.ativo !== false,
            status: item.status || 'offline',
            nome_exibicao: item.nome_exibicao || item.nome_coletor || '',
            operador_atual: item.operador_atual || '',
            ultimo_ping: item.ultimo_ping || '',
            sessao: item.sessao || null,
            contagens_enviadas: item.contagens_enviadas || 0,
            contagens_pendentes: item.contagens_pendentes || 0
        }); }));
    }
    function _aplicarSnapshotColetores(snapshot, source) {
        var _a;
        var docs = _normalizarColetores(snapshot);
        var fingerprint = _fingerprintColetores(docs);
        // Um mesmo snapshot chegava por refresh + onSnapshot e era renderizado duas
        // vezes: diretamente aqui e novamente pelo subscriber do Store. Agora o
        // Store é o único responsável por solicitar a renderização e snapshots
        // idênticos são ignorados.
        if (fingerprint === _coletoresFingerprint)
            return docs;
        _coletoresFingerprint = fingerprint;
        global.AnalistaStore.dispatch(Actions.replaceSlice('coletores', docs, {
            source: source || 'firebase', collection: 'coletores'
        }));
        var Storage = global.AnalistaStorage;
        if ((Storage === null || Storage === void 0 ? void 0 : Storage.storageSave) && ((_a = Storage === null || Storage === void 0 ? void 0 : Storage.KEYS) === null || _a === void 0 ? void 0 : _a.coletores)) {
            Storage.storageSave(Storage.KEYS.coletores, docs);
        }
        return docs;
    }
    function refreshColetores() {
        return __awaiter(this, void 0, void 0, function () {
            var snapshot, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!navigator.onLine)
                            return [2 /*return*/, global.AnalistaStore.getState().coletores || []];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, global.FS_AN.collection('dt_coletores').get()];
                    case 2:
                        snapshot = _a.sent();
                        return [2 /*return*/, _aplicarSnapshotColetores(snapshot, 'firebase-refresh-coletores')];
                    case 3:
                        err_1 = _a.sent();
                        console.warn('[FirebaseService] refresh coletores:', err_1.message);
                        throw err_1;
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function _listenColetores() {
        if (!navigator.onLine)
            return null;
        return global.FS_AN.collection('dt_coletores')
            .onSnapshot(function (snapshot) {
            _aplicarSnapshotColetores(snapshot, 'firebase-listener-coletores');
        }, function (err) {
            console.warn('[FirebaseService] coletores:', err.message);
        });
    }
    function _normalizarItemBase(item) {
        var _a, _b, _c, _d, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
        var x = Object.assign({}, item || {});
        var qtd = (_g = (_f = (_d = (_c = (_b = (_a = x.quantidade_esperada) !== null && _a !== void 0 ? _a : x.quantidadeEsperada) !== null && _b !== void 0 ? _b : x.qtd_esperada) !== null && _c !== void 0 ? _c : x.qtdEsperada) !== null && _d !== void 0 ? _d : x.quantidade_sistema) !== null && _f !== void 0 ? _f : x.quantidadeSistema) !== null && _g !== void 0 ? _g : x.quantidade;
        var cod = (_q = (_p = (_o = (_m = (_l = (_k = (_j = (_h = x.codigo_produto) !== null && _h !== void 0 ? _h : x.codigoProduto) !== null && _j !== void 0 ? _j : x.codigo_interno) !== null && _k !== void 0 ? _k : x.codigoInterno) !== null && _l !== void 0 ? _l : x.sku) !== null && _m !== void 0 ? _m : x.gtin) !== null && _o !== void 0 ? _o : x.ean) !== null && _p !== void 0 ? _p : x.dun) !== null && _q !== void 0 ? _q : '';
        var desc = (_w = (_v = (_u = (_t = (_s = (_r = x.descricao_produto) !== null && _r !== void 0 ? _r : x.descricaoProduto) !== null && _s !== void 0 ? _s : x.descricao) !== null && _t !== void 0 ? _t : x.produto_nome) !== null && _u !== void 0 ? _u : x.nomeProduto) !== null && _v !== void 0 ? _v : x.produto) !== null && _w !== void 0 ? _w : '';
        return Object.assign({}, x, {
            endereco: String((_z = (_y = (_x = x.endereco) !== null && _x !== void 0 ? _x : x.localizacao) !== null && _y !== void 0 ? _y : x.posicao) !== null && _z !== void 0 ? _z : '').trim(),
            codigo_produto: String(cod !== null && cod !== void 0 ? cod : '').trim(),
            descricao_produto: String(desc !== null && desc !== void 0 ? desc : '').trim(),
            quantidade_esperada: Number.isFinite(Number(qtd)) ? Number(qtd) : 0
        });
    }
    function _carregarBaseInventario(inv_1) {
        return __awaiter(this, arguments, void 0, function (inv, force) {
            var snap, base_1, e_1;
            if (force === void 0) { force = false; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!inv || !inv.id)
                            return [2 /*return*/, inv];
                        if (!force && Array.isArray(inv.base) && inv.base.length)
                            return [2 /*return*/, inv];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, global.FS_AN.collection('dt_inventarios').doc(String(inv.id))
                                .collection('base_chunks').orderBy('parte').get()];
                    case 2:
                        snap = _a.sent();
                        base_1 = [];
                        snap.docs.forEach(function (d) {
                            var x = d.data() || {};
                            var itens = Array.isArray(x.itens) ? x.itens : (Array.isArray(x.dados) ? x.dados : []);
                            base_1 = base_1.concat(itens.map(_normalizarItemBase));
                        });
                        return [2 /*return*/, Object.assign({}, inv, { base: base_1, base_carregada_em: new Date().toISOString(), base_total: base_1.length })];
                    case 3:
                        e_1 = _a.sent();
                        console.warn('[FirebaseService] Falha ao carregar base do inventário', inv.id, e_1.message);
                        return [2 /*return*/, inv];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    // Carrega os metadados e enriquece os inventários com os base_chunks reais.
    // Isso não depende mais do localStorage, que possui quota pequena.
    function _carregarInventariosSeNecessario() {
        return __awaiter(this, void 0, void 0, function () {
            var snap, Storage_2, atuais, atuaisPorId_1, docs, statusAtivos_1, idsNecessarios_1, st_1, aliasesValidos_1, Storage_3, metadados, e_2;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, global.FS_AN.collection('dt_inventarios').get()];
                    case 1:
                        snap = _b.sent();
                        if (snap.empty) {
                            global.AnalistaStore.dispatch(Actions.batch([
                                Actions.replaceSlice('inventarios', [], { source: 'firebase-no-inventories' }),
                                Actions.replaceSlice('contagens', [], { source: 'firebase-no-inventories' }),
                                Actions.replaceSlice('vazios', [], { source: 'firebase-no-inventories' }),
                                Actions.replaceSlice('divergencias', [], { source: 'firebase-no-inventories' }),
                                Actions.replaceSlice('recontagens', [], { source: 'firebase-no-inventories' })
                            ], { source: 'firebase-no-inventories' }));
                            Storage_2 = global.AnalistaStorage;
                            ['inventarios', 'contagens', 'divergencias', 'recontagens'].forEach(function (k) {
                                var _a;
                                if ((Storage_2 === null || Storage_2 === void 0 ? void 0 : Storage_2.storageSave) && ((_a = Storage_2 === null || Storage_2 === void 0 ? void 0 : Storage_2.KEYS) === null || _a === void 0 ? void 0 : _a[k]))
                                    Storage_2.storageSave(Storage_2.KEYS[k], []);
                            });
                            return [2 /*return*/, []];
                        }
                        atuais = global.AnalistaStore.getState().inventarios || [];
                        atuaisPorId_1 = new Map(atuais.map(function (i) { return [String(i.id), i]; }));
                        docs = snap.docs.map(function (d) { return Object.assign({}, atuaisPorId_1.get(String(d.id)) || {}, d.data(), { id: d.id }); });
                        statusAtivos_1 = new Set(['ATIVO', 'ABERTO', 'PUBLICADO', 'LIBERADO', 'EM_ANDAMENTO', 'PAUSADO']);
                        idsNecessarios_1 = new Set();
                        st_1 = global.AnalistaStore.getState();
                        ['contagens', 'divergencias', 'recontagens'].forEach(function (slice) { return (st_1[slice] || []).forEach(function (x) {
                            var id = x.inventario_id || x.inventarioId || x.inventario || x.inv_id;
                            if (id != null && String(id))
                                idsNecessarios_1.add(String(id));
                        }); });
                        return [4 /*yield*/, Promise.all(docs.map(function (inv) {
                                var aliases = [inv.id, inv.codigo, inv.nome, inv.inventario_id, inv.inventarioId].filter(function (v) { return v != null; }).map(function (v) { return String(v); });
                                var precisa = statusAtivos_1.has(String(inv.status || '').toUpperCase()) || aliases.some(function (a) { return idsNecessarios_1.has(a); });
                                return precisa ? _carregarBaseInventario(inv, true) : inv;
                            }))];
                    case 2:
                        docs = _b.sent();
                        global.AnalistaStore.dispatch(Actions.replaceSlice('inventarios', docs, { source: 'firebase-init-bases' }));
                        aliasesValidos_1 = new Set();
                        docs.forEach(function (inv) { [inv.id, inv.codigo, inv.nome, inv.inventario_id, inv.inventarioId].filter(function (v) { return v != null && String(v).trim(); }).forEach(function (v) { aliasesValidos_1.add(String(v).trim()); }); });
                        ['contagens', 'vazios', 'divergencias', 'recontagens'].forEach(function (slice) {
                            var atual = global.AnalistaStore.getState()[slice] || [];
                            var limpo = atual.filter(function (x) { var _a, _b, _c; var id = (_c = (_b = (_a = x.inventario_id) !== null && _a !== void 0 ? _a : x.inventarioId) !== null && _b !== void 0 ? _b : x.inventario) !== null && _c !== void 0 ? _c : x.inv_id; return id != null && aliasesValidos_1.has(String(id).trim()); });
                            if (limpo.length !== atual.length)
                                global.AnalistaStore.dispatch(Actions.replaceSlice(slice, limpo, { source: 'firebase-prune-orfaos' }));
                        });
                        Storage_3 = global.AnalistaStorage;
                        if ((Storage_3 === null || Storage_3 === void 0 ? void 0 : Storage_3.storageSave) && ((_a = Storage_3 === null || Storage_3 === void 0 ? void 0 : Storage_3.KEYS) === null || _a === void 0 ? void 0 : _a.inventarios)) {
                            metadados = docs.map(function (inv) { var c = Object.assign({}, inv); delete c.base; return c; });
                            Storage_3.storageSave(Storage_3.KEYS.inventarios, metadados);
                        }
                        global.dispatchEvent(new CustomEvent('dt-inventarios-bases-atualizadas', { detail: { total: docs.length } }));
                        return [3 /*break*/, 4];
                    case 3:
                        e_2 = _b.sent();
                        console.warn('[FirebaseService] Falha ao carregar inventários:', e_2.message);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function refreshBasesRelacionadas() {
        return __awaiter(this, void 0, void 0, function () {
            var e_3;
            var _a, _b, _c, _d;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0: return [4 /*yield*/, _carregarInventariosSeNecessario()];
                    case 1:
                        _f.sent();
                        _f.label = 2;
                    case 2:
                        _f.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, ((_b = (_a = global.DTProdutos) === null || _a === void 0 ? void 0 : _a.carregar) === null || _b === void 0 ? void 0 : _b.call(_a, true))];
                    case 3:
                        _f.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        e_3 = _f.sent();
                        console.warn('[FirebaseService] Atualização de produtos:', e_3.message);
                        return [3 /*break*/, 5];
                    case 5:
                        try {
                            (_d = (_c = global.AnalistaDivergenciaService) === null || _c === void 0 ? void 0 : _c.processarDivergencias) === null || _d === void 0 ? void 0 : _d.call(_c, { criarRecontagens: true, source: 'bases-refresh', force: true });
                        }
                        catch (e) {
                            console.warn('[FirebaseService] Reprocessamento de bases:', e.message);
                        }
                        return [2 /*return*/, true];
                }
            });
        });
    }
    if (!global.__dtBasesProdutoListener) {
        global.__dtBasesProdutoListener = true;
        global.addEventListener('dt-produtos-atualizados', function () {
            clearTimeout(global.__dtBasesProdutoTid);
            global.__dtBasesProdutoTid = setTimeout(function () {
                _carregarInventariosSeNecessario().then(function () {
                    var _a, _b;
                    try {
                        (_b = (_a = global.AnalistaDivergenciaService) === null || _a === void 0 ? void 0 : _a.processarDivergencias) === null || _b === void 0 ? void 0 : _b.call(_a, { criarRecontagens: true, source: 'produtos-atualizados', force: true });
                    }
                    catch (e) {
                        console.warn('[FirebaseService] Reprocessar produtos:', e.message);
                    }
                });
            }, 120);
        });
    }
    function _pararColetores() {
        if (state.unsubscribers.coletores) {
            try {
                state.unsubscribers.coletores();
            }
            catch (_) { }
            state.unsubscribers.coletores = null;
        }
    }
    function stop() {
        Object.keys(state.unsubscribers).forEach(function (collection) {
            if (collection === 'coletores')
                return;
            if (collection === 'enderecos') {
                if (typeof state.unsubscribers.enderecos === 'function') {
                    try {
                        state.unsubscribers.enderecos();
                    }
                    catch (_) { }
                }
                state.unsubscribers.enderecos = null;
                return;
            }
            (state.unsubscribers[collection] || []).forEach(function (unsub) { try {
                unsub();
            }
            catch (_) { } });
            state.unsubscribers[collection] = [];
        });
        _pararColetores();
        state.started = false;
        state.currentInventoryIds = [];
        _emitSync(false, 'Escutas pausadas', { started: false });
    }
    function start() {
        return __awaiter(this, void 0, void 0, function () {
            var e_4, ids, fingerprint;
            var _a, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (!navigator.onLine) {
                            _emitSync(false, 'Offline — usando cache local', { started: false, source: 'cache' });
                            return [2 /*return*/, false];
                        }
                        // Sempre garantir listener de coletores ativo (independe de inventários)
                        if (!state.unsubscribers.coletores) {
                            state.unsubscribers.coletores = _listenColetores();
                        }
                        // Carregar inventários e catálogo de endereços do Firebase.
                        return [4 /*yield*/, _carregarInventariosSeNecessario()];
                    case 1:
                        // Carregar inventários e catálogo de endereços do Firebase.
                        _d.sent();
                        _d.label = 2;
                    case 2:
                        _d.trys.push([2, 5, , 6]);
                        if (!((_a = global.DTProdutos) === null || _a === void 0 ? void 0 : _a.carregar)) return [3 /*break*/, 4];
                        return [4 /*yield*/, global.DTProdutos.carregar(false)];
                    case 3:
                        _d.sent();
                        _d.label = 4;
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        e_4 = _d.sent();
                        console.warn('[FirebaseService] Falha ao carregar Base de Produtos:', e_4.message);
                        return [3 /*break*/, 6];
                    case 6:
                        // Reprocessar registros antigos depois que a base do inventário e o catálogo
                        // de produtos estiverem disponíveis. Isso corrige automaticamente registros
                        // que antes apareciam como "Código sem cadastro" e qtd sistema null.
                        try {
                            (_c = (_b = global.AnalistaDivergenciaService) === null || _b === void 0 ? void 0 : _b.processarDivergencias) === null || _c === void 0 ? void 0 : _c.call(_b, { criarRecontagens: true, source: 'bases-carregadas', force: true });
                        }
                        catch (e) {
                            console.warn('[FirebaseService] Reprocessamento após carregar bases:', e.message);
                        }
                        if (!state.unsubscribers.enderecos)
                            state.unsubscribers.enderecos = _listenEnderecos();
                        ids = _getActiveInventoryIds();
                        if (!ids.length) {
                            ['contagens', 'vazios', 'divergencias', 'recontagens'].forEach(function (collection) {
                                (state.unsubscribers[collection] || []).forEach(function (unsub) { try {
                                    unsub();
                                }
                                catch (_e) { } });
                                state.unsubscribers[collection] = [];
                            });
                            state.started = false;
                            state.currentInventoryIds = [];
                            _emitSync(true, 'Sem inventário ativo — dados operacionais limpos.', { started: false, source: 'firebase' });
                            return [2 /*return*/, true];
                        }
                        fingerprint = ids.join('|');
                        if (state.started && state.currentInventoryIds.join('|') === fingerprint) {
                            _emitSync(true, 'Tempo real ativo', { started: true });
                            return [2 /*return*/, true];
                        }
                        // Parar listeners de contagens antes de reiniciar
                        ['contagens', 'vazios', 'divergencias', 'recontagens'].forEach(function (collection) {
                            (state.unsubscribers[collection] || []).forEach(function (unsub) { try {
                                unsub();
                            }
                            catch (_) { } });
                            state.unsubscribers[collection] = [];
                        });
                        state.unsubscribers.contagens = _listenCollection('contagens', 'dt_contagens');
                        state.unsubscribers.vazios = _listenCollection('vazios', 'dt_vazios');
                        state.unsubscribers.divergencias = _listenCollection('divergencias', 'dt_divergencias');
                        state.unsubscribers.recontagens = _listenCollection('recontagens', 'dt_recontagens');
                        state.started = true;
                        state.currentInventoryIds = ids.slice();
                        _emitSync(true, 'Tempo real ativo', { started: true });
                        return [2 /*return*/, true];
                }
            });
        });
    }
    function refreshFromCache() {
        var Storage = global.AnalistaStorage;
        global.AnalistaStore.dispatch(Actions.hydrateCache({
            inventarios: Storage.storageLoad(Storage.KEYS.inventarios) || [],
            contagens: Storage.storageLoad(Storage.KEYS.contagens) || [],
            divergencias: Storage.storageLoad(Storage.KEYS.divergencias) || [],
            recontagens: Storage.storageLoad(Storage.KEYS.recontagens) || [],
            logs: Storage.storageLoad(Storage.KEYS.logs) || [],
            auditorias: Storage.storageLoad(Storage.KEYS.auditorias) || [],
            auditoria_imports: Storage.storageLoad(Storage.KEYS.auditoria_imports) || [],
            coletores: Storage.storageLoad(Storage.KEYS.coletores) || [],
            enderecosLista: Storage.storageLoad(Storage.KEYS.enderecos) || [],
            enderecosPorSetor: {},
            enderecosExpandidos: new Set(),
            enderecosTemp: []
        }));
        _emitSync(true, 'Cache local recarregado', { started: false, source: 'cache' });
    }
    global.AnalistaFirebaseService = { start: start, stop: stop, refreshFromCache: refreshFromCache, refreshColetores: refreshColetores, refreshBasesRelacionadas: refreshBasesRelacionadas, state: state };
})(window);
