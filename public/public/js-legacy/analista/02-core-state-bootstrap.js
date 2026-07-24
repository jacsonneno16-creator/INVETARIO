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
// ───────────────────────────────────────────────────────────────────
//  02. BOOTSTRAP DE ESTADO / CACHE / CICLO DE VIDA
// ───────────────────────────────────────────────────────────────────
(function (global) {
    var State = global.AnalistaState;
    var Actions = global.AnalistaActions;
    function getState() { return State.getState(); }
    function agruparEnderecosPorSetor(lista) {
        return (lista || []).reduce(function (acc, item) {
            var setor = (item === null || item === void 0 ? void 0 : item.setor) || (item === null || item === void 0 ? void 0 : item.local) || (item === null || item === void 0 ? void 0 : item.nome_local) || 'SEM_SETOR';
            if (!acc[setor])
                acc[setor] = [];
            acc[setor].push(item);
            return acc;
        }, {});
    }
    function snapshotForCache() {
        var state = getState();
        return {
            inventarios: state.inventarios,
            contagens: state.contagens,
            divergencias: state.divergencias,
            recontagens: state.recontagens,
            logs: state.logs,
            auditorias: state.auditorias,
            auditoria_imports: state.auditoria_imports,
            auditoria_metas: state.auditoria_metas,
            coletores: state.coletores,
            enderecosLista: state.enderecosLista,
            enderecosPorSetor: state.enderecosPorSetor,
            enderecosExpandidos: state.enderecosExpandidos,
            enderecosTemp: state.enderecosTemp,
            ui: state.ui,
            sync: state.sync
        };
    }
    function loadAll() {
        var inventarios = global.storageLoad(global.KEYS.inventarios) || [];
        var contagens = global.storageLoad(global.KEYS.contagens) || [];
        var divergencias = global.storageLoad(global.KEYS.divergencias) || [];
        var recontagens = global.storageLoad(global.KEYS.recontagens) || [];
        var logs = global.storageLoad(global.KEYS.logs) || [];
        var auditorias = global.storageLoad(global.KEYS.auditorias) || [];
        var auditoria_imports = global.storageLoad(global.KEYS.auditoria_imports) || [];
        var auditoria_metas = global.storageLoad('invcount_auditoria_metas') || [];
        var coletores = global.storageLoad(global.KEYS.coletores) || [];
        var enderecosLista = global.storageLoad(global.KEYS.enderecos) || [];
        var enderecosPorSetor = agruparEnderecosPorSetor(enderecosLista || []);
        State.dispatch(Actions.hydrateCache({
            inventarios: inventarios,
            contagens: contagens,
            divergencias: divergencias,
            recontagens: recontagens,
            logs: logs,
            auditorias: auditorias,
            auditoria_imports: auditoria_imports,
            auditoria_metas: auditoria_metas,
            coletores: coletores,
            enderecosLista: enderecosLista,
            enderecosPorSetor: enderecosPorSetor,
            enderecosExpandidos: [],
            enderecosTemp: []
        }));
    }
    function saveAll() {
        var state = getState();
        global.storageSave(global.KEYS.inventarios, state.inventarios);
        global.storageSave(global.KEYS.contagens, state.contagens);
        global.storageSave(global.KEYS.divergencias, state.divergencias);
        global.storageSave(global.KEYS.recontagens, state.recontagens);
        global.storageSave(global.KEYS.logs, state.logs);
        global.storageSave(global.KEYS.auditorias, state.auditorias);
        global.storageSave(global.KEYS.auditoria_imports, state.auditoria_imports);
        global.storageSave('invcount_auditoria_metas', state.auditoria_metas || []);
        global.storageSave(global.KEYS.enderecos, state.enderecosLista);
        global.storageSave(global.KEYS.coletores, state.coletores || []);
        return snapshotForCache();
    }
    function renderAll() {
        if (typeof global.renderDashboard === 'function')
            global.renderDashboard();
        if (typeof global.atualizarBadgesNav === 'function')
            global.atualizarBadgesNav();
        if (typeof global.atualizarEnderecos === 'function')
            global.atualizarEnderecos();
    }
    function updateSyncUI(ok, msg) {
        var dot = document.getElementById('sync-dot');
        var txt = document.getElementById('sync-txt');
        if (dot)
            dot.className = 'sync-dot ' + (ok ? 'ok' : '');
        if (txt)
            txt.textContent = msg || (ok ? 'Sincronizado' : 'Aguardando...');
        var info = 'Última sync: ' + new Date().toLocaleTimeString('pt-BR');
        var contSync = document.getElementById('cont-sync-info');
        if (contSync)
            contSync.textContent = info;
        var acomp = document.getElementById('acomp-ultima-sync');
        if (acomp)
            acomp.textContent = info;
    }
    function setupStorageSync() {
        window.addEventListener('storage', function (e) {
            var _a;
            if (Object.values(global.KEYS).includes(e.key) || String(e.key || '').startsWith('invcount_base_') || e.key === 'invcount_auditoria_metas') {
                loadAll();
                if ((_a = global.AnalistaNavigation) === null || _a === void 0 ? void 0 : _a.renderCurrentPage)
                    global.AnalistaNavigation.renderCurrentPage();
                if (typeof global.atualizarBadgesNav === 'function')
                    global.atualizarBadgesNav();
                updateSyncUI(true, 'Dados atualizados do cache secundário');
            }
        });
    }
    var pollingStarted = false;
    function startPolling() {
        if (pollingStarted)
            return;
        pollingStarted = true;
        var lastTs = global.storageTs(global.KEYS.contagens);
        setInterval(function () {
            var _a, _b, _c;
            var currentTs = global.storageTs(global.KEYS.contagens);
            if (currentTs && currentTs > lastTs && !((_b = (_a = global.AnalistaFirebaseService) === null || _a === void 0 ? void 0 : _a.state) === null || _b === void 0 ? void 0 : _b.started)) {
                lastTs = currentTs;
                var contagens = global.storageLoad(global.KEYS.contagens) || [];
                var divergencias = global.storageLoad(global.KEYS.divergencias) || [];
                var recontagens = global.storageLoad(global.KEYS.recontagens) || [];
                var coletores = global.storageLoad(global.KEYS.coletores) || [];
                State.batch([
                    Actions.replaceSlice('contagens', contagens, { source: 'polling-cache' }),
                    Actions.replaceSlice('divergencias', divergencias, { source: 'polling-cache' }),
                    Actions.replaceSlice('recontagens', recontagens, { source: 'polling-cache' }),
                    Actions.replaceSlice('coletores', coletores, { source: 'polling-cache' })
                ]);
                if ((_c = global.AnalistaNavigation) === null || _c === void 0 ? void 0 : _c.renderCurrentPage)
                    global.AnalistaNavigation.renderCurrentPage();
                if (typeof global.atualizarBadgesNav === 'function')
                    global.atualizarBadgesNav();
                updateSyncUI(true, new Date().toLocaleTimeString('pt-BR'));
            }
            lastTs = currentTs || lastTs;
        }, 5000);
    }
    function initApp() {
        return __awaiter(this, void 0, void 0, function () {
            var e_1;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        loadAll();
                        setupStorageSync();
                        startPolling();
                        if ((_a = global.AnalistaAppController) === null || _a === void 0 ? void 0 : _a.bindUI)
                            global.AnalistaAppController.bindUI();
                        renderAll();
                        if (typeof global.logSistema === 'function')
                            global.logSistema('SISTEMA', 'Painel do analista iniciado', {});
                        updateSyncUI(true, 'Cache carregado');
                        if (!((_b = global.AnalistaFirebaseService) === null || _b === void 0 ? void 0 : _b.start)) return [3 /*break*/, 4];
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, global.AnalistaFirebaseService.start()];
                    case 2:
                        _c.sent();
                        renderAll();
                        return [3 /*break*/, 4];
                    case 3:
                        e_1 = _c.sent();
                        console.warn('[Bootstrap] Erro ao iniciar Firebase:', e_1.message);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    global.AnalistaBootstrap = {
        getState: getState,
        loadAll: loadAll,
        saveAll: saveAll,
        renderAll: renderAll,
        setupStorageSync: setupStorageSync,
        startPolling: startPolling,
        initApp: initApp,
        updateSyncUI: updateSyncUI,
        agruparEnderecosPorSetor: agruparEnderecosPorSetor,
        snapshotForCache: snapshotForCache
    };
    global.initApp = initApp;
    // updateSyncUI: mantido como global pois firebaseService.js o usa diretamente.
    // Todos os outros aliases foram removidos — usar global.AnalistaBootstrap.<método>.
    global.updateSyncUI = updateSyncUI;
})(window);
