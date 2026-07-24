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
    // ── Carrega inventários do Firestore se o cache estiver vazio ────────────────
    function _carregarInventariosSeNecessario() {
        return __awaiter(this, void 0, void 0, function () {
            var ids, snap, docs, Storage_2, e_1;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        ids = _getActiveInventoryIds();
                        if (ids.length)
                            return [2 /*return*/]; // cache já tem dados, não precisa buscar
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, global.FS_AN.collection('dt_inventarios').get()];
                    case 2:
                        snap = _b.sent();
                        if (snap.empty)
                            return [2 /*return*/];
                        docs = snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); });
                        global.AnalistaStore.dispatch(Actions.replaceSlice('inventarios', docs, { source: 'firebase-init' }));
                        Storage_2 = global.AnalistaStorage;
                        if ((Storage_2 === null || Storage_2 === void 0 ? void 0 : Storage_2.storageSave) && ((_a = Storage_2 === null || Storage_2 === void 0 ? void 0 : Storage_2.KEYS) === null || _a === void 0 ? void 0 : _a.inventarios)) {
                            Storage_2.storageSave(Storage_2.KEYS.inventarios, docs);
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        e_1 = _b.sent();
                        console.warn('[FirebaseService] Falha ao carregar inventários:', e_1.message);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
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
            var ids, fingerprint;
            return __generator(this, function (_a) {
                switch (_a.label) {
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
                        _a.sent();
                        if (!state.unsubscribers.enderecos)
                            state.unsubscribers.enderecos = _listenEnderecos();
                        ids = _getActiveInventoryIds();
                        if (!ids.length) {
                            // Sem inventários ativos no cache — criar listener sem filtro para capturar contagens recentes
                            if (!state.started) {
                                state.unsubscribers.contagens = _listenCollectionAll('contagens', 'dt_contagens');
                                state.unsubscribers.vazios = _listenCollectionAll('vazios', 'dt_vazios');
                                state.unsubscribers.divergencias = _listenCollectionAll('divergencias', 'dt_divergencias');
                                state.unsubscribers.recontagens = _listenCollectionAll('recontagens', 'dt_recontagens');
                                state.started = true;
                                state.currentInventoryIds = [];
                            }
                            _emitSync(true, 'Coletores em tempo real. Aguardando inventário ativo.', { started: true, source: 'firebase' });
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
    global.AnalistaFirebaseService = { start: start, stop: stop, refreshFromCache: refreshFromCache, refreshColetores: refreshColetores, state: state };
})(window);
