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
// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
function fmtTime(d) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
// Enter handler — movido para a seção de scanner de hardware acima
// ── Init ──
updateSteps();
// ServiceWorker não necessário — Firebase SDK gerencia offline
// ── Sincronização unificada e silenciosa ────────────────────────────────────
// Contagens e auditorias usam armazenamentos diferentes, mas para o operador
// existe uma única fila lógica. A reconexão apenas dispara os envios; nunca
// recarrega a página e nunca bloqueia a operação atual.
var _syncTudoPromise = null;
function sincronizarTudoEmSegundoPlano() {
    return __awaiter(this, arguments, void 0, function (origem) {
        if (origem === void 0) { origem = 'automatico'; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!navigator.onLine)
                        return [2 /*return*/, { contagens: 0, auditorias: 0, offline: true }];
                    if (_syncTudoPromise)
                        return [2 /*return*/, _syncTudoPromise];
                    _syncTudoPromise = (function () {
                        return __awaiter(this, void 0, void 0, function () {
                            var erros, pendentes, e_1, e_2, e_3;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        erros = [];
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 5, , 6]);
                                        if (!(typeof idbGetPendentes === 'function' && typeof enviarFilaPendente === 'function')) return [3 /*break*/, 4];
                                        return [4 /*yield*/, idbGetPendentes()];
                                    case 2:
                                        pendentes = _a.sent();
                                        FILA_ENVIO = Array.isArray(pendentes) ? pendentes : [];
                                        filaSave(FILA_ENVIO);
                                        if (!FILA_ENVIO.length) return [3 /*break*/, 4];
                                        return [4 /*yield*/, enviarFilaPendente()];
                                    case 3:
                                        _a.sent();
                                        _a.label = 4;
                                    case 4: return [3 /*break*/, 6];
                                    case 5:
                                        e_1 = _a.sent();
                                        erros.push(e_1);
                                        console.warn('[SYNC] Contagens permanecem pendentes:', e_1);
                                        return [3 /*break*/, 6];
                                    case 6:
                                        _a.trys.push([6, 9, , 10]);
                                        if (!(typeof window.sincronizarFilaAuditoria === 'function')) return [3 /*break*/, 8];
                                        return [4 /*yield*/, window.sincronizarFilaAuditoria()];
                                    case 7:
                                        _a.sent();
                                        _a.label = 8;
                                    case 8: return [3 /*break*/, 10];
                                    case 9:
                                        e_2 = _a.sent();
                                        erros.push(e_2);
                                        console.warn('[SYNC] Auditorias permanecem pendentes:', e_2);
                                        return [3 /*break*/, 10];
                                    case 10:
                                        _a.trys.push([10, 12, , 13]);
                                        return [4 /*yield*/, atualizarFilaStatus()];
                                    case 11:
                                        _a.sent();
                                        return [3 /*break*/, 13];
                                    case 12:
                                        e_3 = _a.sent();
                                        return [3 /*break*/, 13];
                                    case 13:
                                        try {
                                            if (typeof atualizarBarraStatus === 'function')
                                                atualizarBarraStatus();
                                        }
                                        catch (e) { }
                                        return [2 /*return*/, { origem: origem, erros: erros.length }];
                                }
                            });
                        });
                    })();
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 3, 4]);
                    return [4 /*yield*/, _syncTudoPromise];
                case 2: return [2 /*return*/, _a.sent()];
                case 3:
                    _syncTudoPromise = null;
                    return [7 /*endfinally*/];
                case 4: return [2 /*return*/];
            }
        });
    });
}
window.sincronizarTudoEmSegundoPlano = sincronizarTudoEmSegundoPlano;
// Um único listener de reconexão para disparar todas as filas sem reload.
window.addEventListener('online', function () {
    setTimeout(function () { sincronizarTudoEmSegundoPlano('online').catch(function () { }); }, 250);
});
/** Botão manual para enviar fila (aba STATUS) */
function enviarFilaManual() {
    return __awaiter(this, void 0, void 0, function () {
        var contagens, _a, auditorias, _b, e_4, total;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!navigator.onLine) {
                        toast('📶 Sem internet — os registros continuam salvos no aparelho', 'w');
                        return [2 /*return*/];
                    }
                    toast('⬆️ Sincronizando contagens e auditorias em segundo plano…', 'w');
                    return [4 /*yield*/, sincronizarTudoEmSegundoPlano('manual')];
                case 1:
                    _c.sent();
                    updateStats();
                    return [4 /*yield*/, atualizarFilaStatus()];
                case 2:
                    _c.sent();
                    if (!(typeof idbGetPendentes === 'function')) return [3 /*break*/, 4];
                    return [4 /*yield*/, idbGetPendentes()];
                case 3:
                    _a = (_c.sent()).length;
                    return [3 /*break*/, 5];
                case 4:
                    _a = 0;
                    _c.label = 5;
                case 5:
                    contagens = _a;
                    auditorias = 0;
                    _c.label = 6;
                case 6:
                    _c.trys.push([6, 10, , 11]);
                    if (!window.DTAuditoriaStorage) return [3 /*break*/, 8];
                    return [4 /*yield*/, window.DTAuditoriaStorage.filaAll()];
                case 7:
                    _b = (_c.sent()).length;
                    return [3 /*break*/, 9];
                case 8:
                    _b = 0;
                    _c.label = 9;
                case 9:
                    auditorias = _b;
                    return [3 /*break*/, 11];
                case 10:
                    e_4 = _c.sent();
                    return [3 /*break*/, 11];
                case 11:
                    total = contagens + auditorias;
                    if (total === 0)
                        toast('✅ Contagens e auditorias enviadas com sucesso!', 's');
                    else
                        toast("\u26A0\uFE0F ".concat(total, " registro(s) ainda pendente(s) \u2014 nova tentativa ser\u00E1 autom\u00E1tica"), 'w');
                    return [2 /*return*/];
            }
        });
    });
}
/** Atualiza o indicador de fila na aba STATUS */
function atualizarFilaStatus() {
    return __awaiter(this, void 0, void 0, function () {
        var el, n, pendentes, e_5, auditorias, _a, e_6, total, net;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    el = document.getElementById('st-fila');
                    if (!el) return [3 /*break*/, 11];
                    n = FILA_ENVIO.length;
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, idbGetPendentes()];
                case 2:
                    pendentes = _b.sent();
                    n = pendentes.length;
                    FILA_ENVIO = pendentes;
                    filaSave(FILA_ENVIO);
                    return [3 /*break*/, 4];
                case 3:
                    e_5 = _b.sent();
                    return [3 /*break*/, 4];
                case 4:
                    auditorias = 0;
                    _b.label = 5;
                case 5:
                    _b.trys.push([5, 9, , 10]);
                    if (!window.DTAuditoriaStorage) return [3 /*break*/, 7];
                    return [4 /*yield*/, window.DTAuditoriaStorage.filaAll()];
                case 6:
                    _a = (_b.sent()).length;
                    return [3 /*break*/, 8];
                case 7:
                    _a = 0;
                    _b.label = 8;
                case 8:
                    auditorias = _a;
                    return [3 /*break*/, 10];
                case 9:
                    e_6 = _b.sent();
                    return [3 /*break*/, 10];
                case 10:
                    total = n + auditorias;
                    el.textContent = total > 0 ? total + ' pendente(s) (' + n + ' contagem(ns), ' + auditorias + ' auditoria(s))' : '✓ Tudo enviado';
                    el.style.color = total > 0 ? 'var(--warn)' : 'var(--success)';
                    _b.label = 11;
                case 11:
                    net = document.getElementById('net-status');
                    if (net)
                        net.textContent = navigator.onLine ? '🔥 Firebase' : '📵 Offline';
                    // Manter pill sempre atualizado
                    atualizarBarraStatus();
                    return [2 /*return*/];
            }
        });
    });
}
// Atualiza indicador a cada 5s
setInterval(atualizarFilaStatus, 5000);
