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
function state() { return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  19. RENDERIZAÇÃO — COLETORES
// ═══════════════════════════════════════════════════════════════════
//  COLETORES — Modelo correto: Dispositivo ≠ Operador
//  - Coletor = aparelho físico, identificado por device_id único
//  - Operador = pessoa que faz login no coletor
//  - Um coletor pode ter vários operadores ao longo do tempo
//  - O coletor persiste mesmo após logout do operador
// ═══════════════════════════════════════════════════════════════════
var FS_COL_COLETORES = (window.DT_FCOL && window.DT_FCOL.coletores) || 'dt_coletores';
var OFFLINE_TIMEOUT_MS = 2 * 60 * 1000;
if (!Array.isArray(state().coletores))
    window.AnalistaState.replaceSlice('coletores', [], { source: 'coletores-init' });
if (!window._coletorHeartbeats)
    window._coletorHeartbeats = {};
if (!window._filaOffline)
    window._filaOffline = JSON.parse(localStorage.getItem('dt_fila_offline') || '[]');
function salvarDB_coletores() {
    localStorage.setItem('dt_db_coletores', JSON.stringify(Array.isArray(state().coletores) ? state().coletores : []));
}
function carregarDB_coletores() {
    try {
        var r = localStorage.getItem('dt_db_coletores');
        if (r)
            window.AnalistaState.replaceSlice('coletores', JSON.parse(r), { source: 'coletores-cache-load' });
    }
    catch (e) { }
}
carregarDB_coletores();
// ── IDENTIFICAÇÃO AUTOMÁTICA DO DISPOSITIVO ─────────────────────────
function obterDeviceId() {
    var did = localStorage.getItem('dt_device_id');
    if (!did) {
        did = 'DEV-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        localStorage.setItem('dt_device_id', did);
    }
    return did;
}
// Registra este aparelho como coletor se ainda não existir.
function registrarDispositivoComoColetorSeNecessario(deviceId, apelido) {
    var col = state().coletores.find(function (c) { return c.device_id === deviceId; });
    if (!col) {
        var seq = state().coletores.length + 1;
        col = {
            id: 'COL-' + Date.now(),
            device_id: deviceId,
            numero: String(seq).padStart(2, '0'),
            apelido: apelido || '',
            criado_em: new Date().toISOString(),
            ultima_atividade: new Date().toISOString(),
            status: 'offline',
            sessao: null,
            contagens_enviadas: 0,
            contagens_pendentes: 0,
        };
        window.AnalistaState.replaceSlice('coletores', __spreadArray(__spreadArray([], (state().coletores || []), true), [col], false), { source: 'registrarColetor' });
        salvarDB_coletores();
        logAuditoria('SISTEMA', "Coletor ".concat(col.numero, " registrado automaticamente"), "Device ID: ".concat(deviceId));
        showToast("\uD83D\uDCF1 Coletor ".concat(col.numero, " registrado automaticamente"), 'i');
        renderColetores();
    }
    return col;
}
// ── LOGIN DE OPERADOR NO COLETOR ────────────────────────────────────
function abrirModalLoginOperador() {
    var selCol = document.getElementById('lop-coletor-sel');
    if (selCol) {
        selCol.innerHTML = '<option value="">Selecione o coletor...</option>' +
            state().coletores.map(function (c) {
                var op = c.sessao ? " \u2014 ".concat(c.sessao.operador, " (em uso)") : ' — livre';
                return "<option value=\"".concat(c.id, "\">Coletor ").concat(c.numero).concat(c.apelido ? ' · ' + c.apelido : '').concat(op, "</option>");
            }).join('');
    }
    var selInv = document.getElementById('lop-inv');
    if (selInv) {
        selInv.innerHTML = '<option value="">Selecione o inventário...</option>' +
            state().inventarios.filter(function (i) { return i.status !== 'Fechado'; })
                .map(function (i) { return "<option value=\"".concat(i.id, "\">").concat(i.nome, "</option>"); }).join('');
    }
    document.getElementById('lop-nome').value = '';
    document.getElementById('lop-login').value = '';
    document.getElementById('lop-coletor-aviso').style.display = 'none';
    openModal('modal-login-operador');
}
function verificarColetorDisponivel() {
    var _a;
    var id = (_a = document.getElementById('lop-coletor-sel')) === null || _a === void 0 ? void 0 : _a.value;
    var aviso = document.getElementById('lop-coletor-aviso');
    var btnConfirmar = document.getElementById('btn-confirmar-login-op');
    if (!id || !aviso)
        return;
    var col = state().coletores.find(function (c) { return c.id === id; });
    if (!col) {
        aviso.style.display = 'none';
        return;
    }
    if (col.sessao && col.status === 'online') {
        aviso.style.display = 'block';
        aviso.style.color = 'var(--danger)';
        aviso.innerHTML = "\u26D4 Este coletor est\u00E1 em uso por <strong>".concat(escapeHTML(col.sessao.operador), "</strong> desde ").concat(new Date(col.sessao.hora_login).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), ". N\u00E3o \u00E9 poss\u00EDvel fazer login simult\u00E2neo.");
        if (btnConfirmar)
            btnConfirmar.disabled = true;
    }
    else if (col.sessao && col.status === 'offline') {
        aviso.style.display = 'block';
        aviso.style.color = 'var(--warn)';
        aviso.innerHTML = "\u26A0\uFE0F \u00DAltimo operador: <strong>".concat(escapeHTML(col.sessao.operador), "</strong> (coletor offline). Confirmar para assumir sess\u00E3o.");
        if (btnConfirmar)
            btnConfirmar.disabled = false;
    }
    else {
        aviso.style.display = 'none';
        if (btnConfirmar)
            btnConfirmar.disabled = false;
    }
}
function confirmarLoginOperador() {
    var _a, _b, _c, _d;
    var colId = (_a = document.getElementById('lop-coletor-sel')) === null || _a === void 0 ? void 0 : _a.value;
    var nome = (((_b = document.getElementById('lop-nome')) === null || _b === void 0 ? void 0 : _b.value) || '').trim();
    var login = (((_c = document.getElementById('lop-login')) === null || _c === void 0 ? void 0 : _c.value) || '').trim();
    var invId = ((_d = document.getElementById('lop-inv')) === null || _d === void 0 ? void 0 : _d.value) || '';
    if (!colId) {
        showToast('Selecione o coletor', 'w');
        return;
    }
    if (!nome) {
        showToast('Informe o nome do operador', 'w');
        return;
    }
    var col = state().coletores.find(function (c) { return c.id === colId; });
    if (!col)
        return;
    if (col.sessao && col.status === 'online') {
        showToast("\u26D4 Coletor ".concat(col.numero, " j\u00E1 est\u00E1 em uso por ").concat(col.sessao.operador), 'e');
        return;
    }
    var inv = state().inventarios.find(function (i) { return i.id === invId; });
    if (inv && (inv.status === 'FECHADO' || inv.status === 'Fechado')) {
        showToast('⛔ Inventário finalizado. Não é possível iniciar sessão.', 'e');
        return;
    }
    var invNomeDisplay = inv ? inv.nome : 'N/A';
    col.sessao = { operador: nome, login: login, inventario_id: invId, hora_login: new Date().toISOString() };
    col.status = 'online';
    col.ultimo_ping = new Date().toISOString();
    window._coletorHeartbeats[colId] = Date.now();
    salvarDB_coletores();
    closeModal('modal-login-operador');
    renderColetores();
    logAuditoria('SISTEMA', "Operador ".concat(nome, " fez login no Coletor ").concat(col.numero), "Invent\u00E1rio: ".concat(invNomeDisplay));
    showToast("\uD83D\uDFE2 ".concat(nome, " est\u00E1 operando o Coletor ").concat(col.numero), 's');
}
// ── LOGOUT — coletor permanece, só a sessão é removida ───────────────
function logoutOperadorColetor(colId) {
    var _a;
    var col = state().coletores.find(function (c) { return c.id === colId; });
    if (!col)
        return;
    var nomeOp = ((_a = col.sessao) === null || _a === void 0 ? void 0 : _a.operador) || 'Operador';
    col.sessao = null;
    col.status = 'offline';
    delete window._coletorHeartbeats[colId];
    salvarDB_coletores();
    renderColetores();
    logAuditoria('SISTEMA', "Operador ".concat(nomeOp, " fez logout do Coletor ").concat(col.numero), '');
    showToast("\uD83D\uDD34 ".concat(nomeOp, " saiu do Coletor ").concat(col.numero), 'w');
}
function excluirColetor(id) {
    return __awaiter(this, void 0, void 0, function () {
        var col, nome;
        return __generator(this, function (_a) {
            col = state().coletores.find(function (c) { return c.id === id; });
            nome = col ? (col.nome_exibicao || "Coletor ".concat(col.numero)) : id;
            if (!window.confirm("Remover ".concat(nome, " do sistema? O hist\u00F3rico de contagens ser\u00E1 mantido.")))
                return [2 /*return*/, false];
            return [2 /*return*/, _removerColetorConfirmado(id)];
        });
    });
}
function _removerColetorConfirmado(coletorId) {
    return __awaiter(this, void 0, void 0, function () {
        var raw, lojasSnap, _i, _a, lojaDoc, _1, e_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 10, , 11]);
                    raw = window.getDTRawFirestore ? window.getDTRawFirestore() : FS_AN;
                    // Mantém um marcador invisível no mesmo documento. Isso revoga a aprovação
                    // sem depender de outra coleção e impede o Coletor de recuperar aprovações
                    // antigas existentes dentro das lojas. No próximo login o aparelho volta
                    // como pendente e precisa ser aprovado novamente.
                    return [4 /*yield*/, raw.collection(FS_COL_COLETORES).doc(coletorId).set({
                            aprovado: 'revogado',
                            status: 'revogado',
                            ativo: false,
                            bloqueado: false,
                            excluido: true,
                            sessao: null,
                            revogado_em: firebase.firestore.FieldValue.serverTimestamp(),
                            revogado_por: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'analista'
                        }, { merge: true })];
                case 1:
                    // Mantém um marcador invisível no mesmo documento. Isso revoga a aprovação
                    // sem depender de outra coleção e impede o Coletor de recuperar aprovações
                    // antigas existentes dentro das lojas. No próximo login o aparelho volta
                    // como pendente e precisa ser aprovado novamente.
                    _b.sent();
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 8, , 9]);
                    return [4 /*yield*/, raw.collection('lojas').get()];
                case 3:
                    lojasSnap = _b.sent();
                    _i = 0, _a = lojasSnap.docs;
                    _b.label = 4;
                case 4:
                    if (!(_i < _a.length)) return [3 /*break*/, 7];
                    lojaDoc = _a[_i];
                    return [4 /*yield*/, raw.collection('lojas').doc(lojaDoc.id).collection(FS_COL_COLETORES).doc(coletorId).delete().catch(function () { })];
                case 5:
                    _b.sent();
                    _b.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 4];
                case 7: return [3 /*break*/, 9];
                case 8:
                    _1 = _b.sent();
                    return [3 /*break*/, 9];
                case 9:
                    showToast('🗑️ Coletor removido. O aparelho precisará de nova aprovação.', 'i');
                    logAuditoria('SISTEMA', 'Coletor removido e aprovação revogada', coletorId);
                    return [2 /*return*/, true];
                case 10:
                    e_1 = _b.sent();
                    console.error('[Coletores] Erro ao remover:', e_1);
                    showToast('Erro ao remover coletor: ' + e_1.message, 'e');
                    throw e_1;
                case 11: return [2 /*return*/];
            }
        });
    });
}
function aprovarColetor(id) {
    return __awaiter(this, void 0, void 0, function () {
        var col, nome, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    col = state().coletores.find(function (c) { return c.id === id; });
                    nome = col ? (col.nome_exibicao || "Coletor ".concat(col.numero)) : id;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS_AN.collection(FS_COL_COLETORES).doc(id).set({
                            aprovado: 'aprovado',
                            bloqueado: false,
                            ativo: true,
                            status: 'offline',
                            aprovado_em: firebase.firestore.FieldValue.serverTimestamp(),
                            reprovado_em: firebase.firestore.FieldValue.delete(),
                            bloqueado_em: firebase.firestore.FieldValue.delete()
                        }, { merge: true })];
                case 2:
                    _a.sent();
                    showToast('✅ ' + nome + ' aprovado!', 's');
                    logAuditoria('SISTEMA', 'Coletor aprovado: ' + nome, id);
                    return [2 /*return*/, true];
                case 3:
                    e_2 = _a.sent();
                    console.error('[Coletores] Erro ao aprovar:', e_2);
                    showToast('Erro ao aprovar: ' + e_2.message, 'e');
                    throw e_2;
                case 4: return [2 /*return*/];
            }
        });
    });
}
function reprovarColetor(id) {
    return __awaiter(this, void 0, void 0, function () {
        var col, nome, e_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    col = state().coletores.find(function (c) { return c.id === id; });
                    nome = col ? (col.nome_exibicao || "Coletor ".concat(col.numero)) : id;
                    if (!window.confirm("Reprovar a solicita\u00E7\u00E3o de ".concat(nome, "?")))
                        return [2 /*return*/, false];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS_AN.collection(FS_COL_COLETORES).doc(id).set({
                            aprovado: 'reprovado',
                            bloqueado: false,
                            ativo: false,
                            status: 'offline',
                            sessao: null,
                            reprovado_em: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true })];
                case 2:
                    _a.sent();
                    showToast('❌ ' + nome + ' reprovado.', 'w');
                    logAuditoria('SISTEMA', 'Coletor reprovado: ' + nome, id);
                    return [2 /*return*/, true];
                case 3:
                    e_3 = _a.sent();
                    console.error('[Coletores] Erro ao reprovar:', e_3);
                    showToast('Erro ao reprovar: ' + e_3.message, 'e');
                    throw e_3;
                case 4: return [2 /*return*/];
            }
        });
    });
}
function bloquearColetor(id) {
    return __awaiter(this, void 0, void 0, function () {
        var col, nome;
        return __generator(this, function (_a) {
            col = state().coletores.find(function (c) { return c.id === id; });
            nome = col ? (col.nome_exibicao || "Coletor ".concat(col.numero)) : id;
            if (!window.confirm("Bloquear ".concat(nome, "? Ningu\u00E9m conseguir\u00E1 entrar neste aparelho.")))
                return [2 /*return*/, false];
            return [2 /*return*/, _bloquearColetorConfirmado(id, nome)];
        });
    });
}
function _bloquearColetorConfirmado(coletorId, nome) {
    return __awaiter(this, void 0, void 0, function () {
        var e_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, FS_AN.collection(FS_COL_COLETORES).doc(coletorId).set({
                            aprovado: 'bloqueado',
                            bloqueado: true,
                            ativo: false,
                            status: 'offline',
                            sessao: null,
                            bloqueado_em: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true })];
                case 1:
                    _a.sent();
                    showToast('🚫 ' + nome + ' bloqueado.', 'w');
                    logAuditoria('SISTEMA', 'Coletor bloqueado: ' + nome, coletorId);
                    return [2 /*return*/, true];
                case 2:
                    e_4 = _a.sent();
                    console.error('[Coletores] Erro ao bloquear:', e_4);
                    showToast('Erro ao bloquear: ' + e_4.message, 'e');
                    throw e_4;
                case 3: return [2 /*return*/];
            }
        });
    });
}
function desbloquearColetor(id) {
    return __awaiter(this, void 0, void 0, function () {
        var col, nome, e_5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    col = state().coletores.find(function (c) { return c.id === id; });
                    nome = col ? (col.nome_exibicao || "Coletor ".concat(col.numero)) : id;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS_AN.collection(FS_COL_COLETORES).doc(id).set({
                            aprovado: 'aprovado',
                            bloqueado: false,
                            ativo: true,
                            status: 'offline',
                            desbloqueado_em: firebase.firestore.FieldValue.serverTimestamp(),
                            bloqueado_em: firebase.firestore.FieldValue.delete()
                        }, { merge: true })];
                case 2:
                    _a.sent();
                    showToast('🔓 ' + nome + ' desbloqueado.', 's');
                    logAuditoria('SISTEMA', 'Coletor desbloqueado: ' + nome, id);
                    return [2 /*return*/, true];
                case 3:
                    e_5 = _a.sent();
                    console.error('[Coletores] Erro ao desbloquear:', e_5);
                    showToast('Erro ao desbloquear: ' + e_5.message, 'e');
                    throw e_5;
                case 4: return [2 /*return*/];
            }
        });
    });
}
// ── HEARTBEAT / STATUS AUTOMÁTICO ───────────────────────────────────
function atualizarHeartbeat(coletorId) {
    window._coletorHeartbeats[coletorId] = Date.now();
    var col = state().coletores.find(function (c) { return c.id === coletorId; });
    if (col) {
        col.ultimo_ping = new Date().toISOString();
        col.status = 'online';
        salvarDB_coletores();
    }
}
function verificarStatusColetores() {
    var _a;
    // Status real vem do Firebase via onSnapshot.
    // Fallback local: marca offline coletores sem ping há +2 min.
    var agora = Date.now();
    var mudou = false;
    var coletoresAtuais = Array.isArray(state().coletores) ? state().coletores : [];
    coletoresAtuais.forEach(function (col) {
        var ref = col.ultimo_ping ? new Date(col.ultimo_ping).getTime() : null;
        if (ref && (agora - ref) > OFFLINE_TIMEOUT_MS && col.status === 'online') {
            col.status = 'offline';
            mudou = true;
        }
    });
    if (mudou && ((_a = document.getElementById('page-coletores')) === null || _a === void 0 ? void 0 : _a.classList.contains('on')))
        renderColetores();
}
setInterval(verificarStatusColetores, 15000);
// ── SIMULAÇÃO (testes) ───────────────────────────────────────────────
function abrirModalSimularColetor() {
    document.getElementById('sim-dev-nome').value = '';
    openModal('modal-simular-coletor');
}
function executarSimularColetor() {
    var _a;
    var apelido = (((_a = document.getElementById('sim-dev-nome')) === null || _a === void 0 ? void 0 : _a.value) || '').trim();
    var fakeDevId = 'DEV-SIM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    registrarDispositivoComoColetorSeNecessario(fakeDevId, apelido);
    closeModal('modal-simular-coletor');
}
// ── SINCRONIZAÇÃO OFFLINE ────────────────────────────────────────────
function registrarContagemOffline(contagem) {
    window._filaOffline.push(__assign(__assign({}, contagem), { _offline: true, _ts: Date.now() }));
    localStorage.setItem('dt_fila_offline', JSON.stringify(window._filaOffline));
    var col = state().coletores.find(function (c) { return c.id === contagem.coletor_id; });
    if (col) {
        col.contagens_pendentes = (col.contagens_pendentes || 0) + 1;
        salvarDB_coletores();
    }
}
function sincronizarFilaOffline() {
    if (!navigator.onLine || !window._filaOffline.length)
        return;
    var total = window._filaOffline.length;
    window._filaOffline.forEach(function (cnt) {
        var col = state().coletores.find(function (c) { return c.id === cnt.coletor_id; });
        if (col) {
            col.contagens_enviadas = (col.contagens_enviadas || 0) + 1;
            col.contagens_pendentes = Math.max(0, (col.contagens_pendentes || 0) - 1);
        }
    });
    window._filaOffline = [];
    localStorage.setItem('dt_fila_offline', '[]');
    salvarDB_coletores();
    showToast("\uD83D\uDD04 ".concat(total, " contagem(ns) sincronizada(s)!"), 's');
    renderColetores();
}
window.addEventListener('online', sincronizarFilaOffline);
