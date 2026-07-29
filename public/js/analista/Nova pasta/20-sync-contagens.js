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
    // ── 8. SINCRONIZAÇÃO DE CONTAGENS ──────────────────────────────────────────
    var Storage = global.AnalistaStorage;
    var Actions = global.AnalistaActions;
    /** Recarrega contagens do Firestore (se online) ou do cache local */
    function sincronizarContagens() {
        return __awaiter(this, void 0, void 0, function () {
            var dotEl;
            var _a, _b, _c, _d, _e, _f;
            return __generator(this, function (_g) {
                dotEl = document.getElementById('sync-dot');
                if (dotEl)
                    dotEl.className = 'sync-dot sync';
                if (navigator.onLine && ((_a = global.AnalistaFirebaseService) === null || _a === void 0 ? void 0 : _a.start)) {
                    try {
                        global.AnalistaFirebaseService.start();
                        (_c = (_b = global.AnalistaNavigation) === null || _b === void 0 ? void 0 : _b.renderCurrentPage) === null || _c === void 0 ? void 0 : _c.call(_b);
                        if (typeof global.atualizarBadgesNav === 'function')
                            global.atualizarBadgesNav();
                        global.AnalistaBootstrap.updateSyncUI(true, new Date().toLocaleTimeString('pt-BR'));
                        showToast('🔄 Sincronização em tempo real reativada!', 's');
                        return [2 /*return*/];
                    }
                    catch (e) {
                        dbg('[sync] Falha ao reativar realtime Firebase:', e.message);
                    }
                }
                if ((_d = global.AnalistaFirebaseService) === null || _d === void 0 ? void 0 : _d.refreshFromCache) {
                    global.AnalistaFirebaseService.refreshFromCache();
                }
                else {
                    global.AnalistaState.batch([
                        Actions.replaceSlice('contagens', Storage.storageLoad(Storage.KEYS.contagens) || [], { source: 'manual-cache-refresh' }),
                        Actions.replaceSlice('divergencias', Storage.storageLoad(Storage.KEYS.divergencias) || [], { source: 'manual-cache-refresh' }),
                        Actions.replaceSlice('recontagens', Storage.storageLoad(Storage.KEYS.recontagens) || [], { source: 'manual-cache-refresh' })
                    ]);
                    (_f = (_e = global.AnalistaNavigation) === null || _e === void 0 ? void 0 : _e.renderCurrentPage) === null || _f === void 0 ? void 0 : _f.call(_e);
                    if (typeof global.atualizarBadgesNav === 'function')
                        global.atualizarBadgesNav();
                    global.AnalistaBootstrap.updateSyncUI(true, new Date().toLocaleTimeString('pt-BR'));
                }
                showToast('🔄 Cache local recarregado.', 'i');
                return [2 /*return*/];
            });
        });
    }
    // Exportar para chamadas de botões na UI
    global.sincronizarContagens = sincronizarContagens;
})(window);
