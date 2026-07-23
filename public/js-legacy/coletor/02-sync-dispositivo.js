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
// ═══════════════════════════════════════════════════
//  SYNC AUTOMÁTICO A CADA 10 MIN EM BACKGROUND
//  Envia fila pendente sem travar o operador
// ═══════════════════════════════════════════════════
var _syncInterval = null;
// ═══════════════════════════════════════════════════
//  IDENTIFICAÇÃO DO DISPOSITIVO (coletor)
//  Estrutura no Firestore: dt_coletores/{device_id}
//  {
//    device_id, apelido, numero,
//    criado_em, ultimo_ping, status,
//    sessao: { operador, email, inventario_id,
//              inventario_nome, login_em } | null
//  }
// ═══════════════════════════════════════════════════
var ST = firebase.firestore.FieldValue.serverTimestamp;
var FV_DELETE = firebase.firestore.FieldValue.delete;
/** Gera fingerprint estável do aparelho (canvas + screen + userAgent).
 *  Mesmo que o localStorage seja limpo, o mesmo aparelho gera o mesmo ID. */
/**
 * IDENTIFICAÇÃO DO APARELHO
 * Regra: 1 aparelho físico = 1 device_id = 1 registro no Firestore.
 *
 * Estratégia de persistência (em ordem de prioridade):
 *   1. localStorage 'dt_device_id'  → fonte principal (sempre lido primeiro)
 *   2. sessionStorage               → fallback se LS bloqueado
 *   3. fingerprint determinístico   → gerado UMA vez se nenhum storage tiver ID
 *
 * O fingerprint combina dados estáveis do hardware/browser para minimizar
 * colisões entre aparelhos diferentes e maximizar estabilidade no mesmo aparelho.
 * Troca de usuário / logout / limpeza de cache NÃO devem mudar o device_id.
 */
var _LS_KEY = 'dt_device_id';
var _SS_KEY = 'dt_device_id_ss';
function _djb2(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++)
        h = Math.imul(h, 33) ^ str.charCodeAt(i);
    return (h >>> 0).toString(36);
}
function _gerarFingerprint() {
    var _a;
    var parts = [];
    // 1. User-Agent (estável no mesmo browser/versão)
    parts.push(navigator.userAgent);
    // 2. Resolução + color depth
    parts.push(screen.width + 'x' + screen.height + ':' + screen.colorDepth);
    // 3. Fuso horário
    try {
        parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
    catch (e) { }
    // 4. Idioma
    parts.push(navigator.language || '');
    // 5. Número de núcleos lógicos (hardware)
    parts.push(String(navigator.hardwareConcurrency || 0));
    // 6. Canvas fingerprint (rendering engine)
    try {
        var cv = document.createElement('canvas');
        var cx = cv.getContext('2d');
        cx.textBaseline = 'alphabetic';
        cx.font = '16px Arial';
        cx.fillStyle = '#f00';
        cx.fillText('DT_inv', 2, 14);
        cx.fillStyle = 'rgba(0,255,0,0.5)';
        cx.fillRect(2, 0, 30, 5);
        parts.push(cv.toDataURL().slice(-32));
    }
    catch (e) {
        parts.push('nocanvas');
    }
    // 7. Plugins (browsers desktop)
    try {
        parts.push(String(((_a = navigator.plugins) === null || _a === void 0 ? void 0 : _a.length) || 0));
    }
    catch (e) { }
    return 'dt_' + _djb2(parts.join('|'));
}
/**
 * Retorna o device_id deste aparelho. ÚNICA função que deve ser chamada.
 * Gera e persiste o ID na primeira vez; nas seguintes, apenas lê do storage.
 */
function obterDeviceId() {
    // 1. Tentar localStorage (persistente entre sessões)
    try {
        var did_1 = localStorage.getItem(_LS_KEY);
        if (did_1 && did_1.startsWith('dt_')) {
            // Espelhar no sessionStorage como backup
            try {
                sessionStorage.setItem(_SS_KEY, did_1);
            }
            catch (e) { }
            return did_1;
        }
    }
    catch (e) { }
    // 2. Tentar sessionStorage (caso LS bloqueado)
    try {
        var did_2 = sessionStorage.getItem(_SS_KEY);
        if (did_2 && did_2.startsWith('dt_')) {
            try {
                localStorage.setItem(_LS_KEY, did_2);
            }
            catch (e) { }
            return did_2;
        }
    }
    catch (e) { }
    // 3. Gerar fingerprint e persistir
    var did = _gerarFingerprint();
    try {
        localStorage.setItem(_LS_KEY, did);
    }
    catch (e) { }
    try {
        sessionStorage.setItem(_SS_KEY, did);
    }
    catch (e) { }
    dbg('[DeviceID] Novo ID gerado e salvo:', did);
    return did;
}
/** Obtém o IP público do aparelho via API gratuita */
function obterIPPublico() {
    return __awaiter(this, void 0, void 0, function () {
        var r, j, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) })];
                case 1:
                    r = _b.sent();
                    return [4 /*yield*/, r.json()];
                case 2:
                    j = _b.sent();
                    return [2 /*return*/, j.ip || null];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 4: return [2 /*return*/];
            }
        });
    });
}
var _heartbeatInterval = null;
/**
 * Registra ou atualiza o aparelho no Firestore após login Firebase bem-sucedido.
 *
 * FLUXO:
 *   Aparelho novo  → cria doc com aprovado='pendente' → retorna 'pendente'
 *   Aprovado       → atualiza operador_atual + ultimo_ping → retorna 'aprovado'
 *   Bloqueado      → não altera nada → retorna 'bloqueado'
 *   Pendente       → não altera nada → retorna 'pendente'
 *
 * GARANTIA: usa o deviceId como chave do documento (doc(deviceId)).
 * Nunca cria mais de um documento para o mesmo aparelho.
 */
function registrarColetorNoFirestore(operadorInfo) {
    return __awaiter(this, void 0, void 0, function () {
        var deviceId, ref, ip, snap, lojas, _i, lojas_1, loja, antiga, legado, compatError_1, numero, dados, e_1;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    deviceId = obterDeviceId();
                    ref = FS.collection(FCOL.coletores).doc(deviceId);
                    ip = null;
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 20, , 21]);
                    return [4 /*yield*/, ref.get()];
                case 2:
                    snap = _c.sent();
                    if (!!snap.exists) return [3 /*break*/, 14];
                    _c.label = 3;
                case 3:
                    _c.trys.push([3, 13, , 14]);
                    lojas = Array.isArray(window.DT_LOJAS_USUARIO_ATUAL) ? window.DT_LOJAS_USUARIO_ATUAL : [];
                    _i = 0, lojas_1 = lojas;
                    _c.label = 4;
                case 4:
                    if (!(_i < lojas_1.length)) return [3 /*break*/, 12];
                    loja = lojas_1[_i];
                    return [4 /*yield*/, window.getDTRawFirestore().collection('lojas').doc(loja.id).collection(FCOL.coletores).doc(deviceId).get()];
                case 5:
                    antiga = _c.sent();
                    if (!antiga.exists)
                        return [3 /*break*/, 11];
                    legado = antiga.data() || {};
                    if (!(legado.aprovado === 'aprovado' || legado.status === 'aprovado')) return [3 /*break*/, 8];
                    return [4 /*yield*/, ref.set(Object.assign({}, legado, {
                            device_id: deviceId,
                            aprovado: 'aprovado',
                            status: 'online',
                            migrado_aprovacao_global_em: ST()
                        }), { merge: true })];
                case 6:
                    _c.sent();
                    return [4 /*yield*/, ref.get()];
                case 7:
                    snap = _c.sent();
                    return [3 /*break*/, 12];
                case 8:
                    if (!(legado.aprovado === 'bloqueado')) return [3 /*break*/, 11];
                    return [4 /*yield*/, ref.set(Object.assign({}, legado, { device_id: deviceId, aprovado: 'bloqueado' }), { merge: true })];
                case 9:
                    _c.sent();
                    return [4 /*yield*/, ref.get()];
                case 10:
                    snap = _c.sent();
                    return [3 /*break*/, 12];
                case 11:
                    _i++;
                    return [3 /*break*/, 4];
                case 12: return [3 /*break*/, 14];
                case 13:
                    compatError_1 = _c.sent();
                    console.warn('[Coletor] Não foi possível consultar aprovação antiga:', compatError_1.message);
                    return [3 /*break*/, 14];
                case 14:
                    if (!!snap.exists) return [3 /*break*/, 16];
                    numero = deviceId.slice(-4).toUpperCase();
                    return [4 /*yield*/, ref.set({
                            device_id: deviceId,
                            nome_coletor: 'Coletor ' + numero,
                            numero: numero,
                            operador_atual: operadorInfo.name,
                            operador_email: operadorInfo.email || null,
                            operador_uid: operadorInfo.uid || null,
                            status: 'pendente',
                            aprovado: 'pendente',
                            data_registro: ST(),
                            ultimo_ping: ST(),
                            sessao: null,
                            contagens_enviadas: 0,
                            contagens_pendentes: 0,
                            versao_app: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '2.0.0')
                        }, { merge: true })];
                case 15:
                    _c.sent();
                    // IP é enriquecimento opcional e assíncrono; nunca bloqueia o login.
                    obterIPPublico().then(function (v) { return v && ref.set({ ip: v }, { merge: true }); }).catch(function () { });
                    dbg('[Coletor] Novo aparelho registrado como Coletor', numero, '— pendente — ID:', deviceId);
                    return [2 /*return*/, 'pendente'];
                case 16:
                    dados = snap.data();
                    if (dados.aprovado === 'bloqueado') {
                        console.warn('[Coletor] Aparelho bloqueado — acesso negado.');
                        return [2 /*return*/, 'bloqueado'];
                    }
                    if (!(dados.aprovado !== 'aprovado')) return [3 /*break*/, 18];
                    // Atualiza operador_atual e ping mesmo estando pendente (analista vê quem tentou)
                    return [4 /*yield*/, ref.set({ operador_atual: operadorInfo.name, operador_email: operadorInfo.email || null, operador_uid: operadorInfo.uid || null, ultimo_ping: ST() }, { merge: true })];
                case 17:
                    // Atualiza operador_atual e ping mesmo estando pendente (analista vê quem tentou)
                    _c.sent();
                    dbg('[Coletor] Aparelho pendente — acesso aguardando aprovacao.');
                    return [2 /*return*/, 'pendente'];
                case 18: 
                // APROVADO: atualizar operador e sessão (nunca cria novo doc)
                return [4 /*yield*/, ref.set({
                        operador_atual: operadorInfo.name,
                        ultimo_ping: ST(),
                        status: 'online',
                        sessao: {
                            operador: operadorInfo.name,
                            email: operadorInfo.email,
                            inventario_id: ((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.id) || null,
                            inventario_nome: ((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.nome) || null,
                            login_em: ST(),
                        },
                    }, { merge: true })];
                case 19:
                    // APROVADO: atualizar operador e sessão (nunca cria novo doc)
                    _c.sent();
                    obterIPPublico().then(function (v) { return v && ref.set({ ip: v }, { merge: true }); }).catch(function () { });
                    dbg('[Coletor] Sessao atualizada —', operadorInfo.name, '— aprovado — ID:', deviceId);
                    return [2 /*return*/, 'aprovado'];
                case 20:
                    e_1 = _c.sent();
                    console.warn('[Coletor] registrarColetorNoFirestore falhou:', e_1.message);
                    // Em caso de erro de rede, permitir acesso se já tinha sessão local
                    return [2 /*return*/, 'erro'];
                case 21: return [2 /*return*/];
            }
        });
    });
}
var _aprovacaoListener = null;
function iniciarListenerAprovacaoColetor(operadorInfo) {
    var _this = this;
    if (_aprovacaoListener) {
        try {
            _aprovacaoListener();
        }
        catch (_) { }
    }
    var ref = FS.collection(FCOL.coletores).doc(obterDeviceId());
    _aprovacaoListener = ref.onSnapshot(function (snap) { return __awaiter(_this, void 0, void 0, function () {
        var d, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!snap.exists)
                        return [2 /*return*/];
                    d = snap.data() || {};
                    if (d.aprovado === 'bloqueado') {
                        if (typeof _mostrarTelaBloqueado === 'function')
                            _mostrarTelaBloqueado();
                        return [2 /*return*/];
                    }
                    if (d.aprovado !== 'aprovado')
                        return [2 /*return*/];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, ref.set({ status: 'online', operador_atual: operadorInfo.name, operador_email: operadorInfo.email, operador_uid: operadorInfo.uid, ultimo_ping: ST() }, { merge: true })];
                case 2:
                    _a.sent();
                    if (_aprovacaoListener) {
                        _aprovacaoListener();
                        _aprovacaoListener = null;
                    }
                    location.reload();
                    return [3 /*break*/, 4];
                case 3:
                    e_2 = _a.sent();
                    console.error('[Aprovação] Falha ao liberar coletor:', e_2);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    }); }, function (err) { return console.error('[Aprovação] Listener:', err); });
}
window.iniciarListenerAprovacaoColetor = iniciarListenerAprovacaoColetor;
/**
 * Atualiza apenas o inventário dentro da sessão.
 * Chamado quando o operador seleciona/baixa um inventário.
 */
function atualizarInventarioColetor() {
    return __awaiter(this, void 0, void 0, function () {
        var deviceId, e_3;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (!APP.operador)
                        return [2 /*return*/];
                    deviceId = obterDeviceId();
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS.collection(FCOL.coletores).doc(deviceId).update({
                            'sessao.inventario_id': ((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.id) || null,
                            'sessao.inventario_nome': ((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.nome) || null,
                            ultimo_ping: ST(),
                        })];
                case 2:
                    _d.sent();
                    dbg('[Coletor] Inventário atualizado:', ((_c = APP.inventario) === null || _c === void 0 ? void 0 : _c.nome) || '—');
                    return [3 /*break*/, 4];
                case 3:
                    e_3 = _d.sent();
                    console.warn('[Coletor] atualizarInventario falhou:', e_3.message);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Heartbeat a cada 120s — mantém status online visível no analista (intervalo aumentado para reduzir leituras Firebase).
 * Atualiza também contagens_pendentes para o analista ver a fila.
 */
function enviarHeartbeat() {
    return __awaiter(this, void 0, void 0, function () {
        var deviceId, e_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!APP.operador)
                        return [2 /*return*/];
                    deviceId = obterDeviceId();
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS.collection(FCOL.coletores).doc(deviceId).update({
                            ultimo_ping: ST(),
                            status: 'online',
                            contagens_pendentes: FILA_ENVIO.length,
                        })];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    e_4 = _a.sent();
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
var _coletorListener = null;
/**
 * Listener em tempo real no documento deste coletor.
 * Detecta bloqueio/remoção feitos pelo analista e desconecta imediatamente.
 */
function iniciarListenerColetor() {
    if (_coletorListener) {
        _coletorListener();
        _coletorListener = null;
    }
    var deviceId = obterDeviceId();
    try {
        _coletorListener = FS.collection(FCOL.coletores).doc(deviceId)
            .onSnapshot(function (snap) {
            if (!APP.operador)
                return; // já deslogado, ignorar
            if (!snap.exists)
                return; // doc ainda não existe (primeiro cadastro)
            var dados = snap.data();
            if (!dados)
                return;
            if (dados.aprovado === 'bloqueado') {
                // Analista bloqueou — forçar logout e mostrar tela de bloqueio
                console.warn('[Coletor] Bloqueado pelo analista em tempo real.');
                AUTH.signOut().catch(function () { });
                APP.operador = null;
                if (_heartbeatInterval) {
                    clearInterval(_heartbeatInterval);
                    _heartbeatInterval = null;
                }
                if (typeof _coletorListener === 'function') {
                    _coletorListener();
                    _coletorListener = null;
                }
                if (_coletorListener) {
                    _coletorListener();
                    _coletorListener = null;
                }
                goScreen('login');
                // Mostrar tela vermelha com hora do bloqueio
                var agora = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                var box = document.getElementById('login-bloqueado-box');
                if (box) {
                    // Atualizar mensagem com a hora
                    var msg = box.querySelector('div[style*="font-size:.78rem"]');
                    if (msg)
                        msg.innerHTML = "Este aparelho foi bloqueado pelo analista.<br>Sess\u00E3o encerrada \u00E0s <b>".concat(agora, "</b>.<br>Entre em contato com o respons\u00E1vel.");
                    box.style.display = 'flex';
                }
            }
            else if (dados.aprovado === 'pendente') {
                // Analista removeu aprovação (edge case) — forçar logout e tela amarela
                console.warn('[Coletor] Aprovação revogada — retornando para tela de espera.');
                AUTH.signOut().catch(function () { });
                APP.operador = null;
                if (_heartbeatInterval) {
                    clearInterval(_heartbeatInterval);
                    _heartbeatInterval = null;
                }
                if (_coletorListener) {
                    _coletorListener();
                    _coletorListener = null;
                }
                goScreen('login');
                _mostrarTelaAguardandoAprovacao('');
            }
        }, function (err) {
            console.warn('[ListenerColetor] erro:', err.message);
        });
    }
    catch (e) {
        console.warn('[ListenerColetor] não iniciado:', e.message);
    }
}
/**
 * Logout: marca offline e limpa APENAS a sessão.
 * O documento do coletor permanece intacto.
 */
function marcarColetorOffline() {
    return __awaiter(this, void 0, void 0, function () {
        var deviceId, updateData, e_5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    deviceId = obterDeviceId();
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    updateData = {
                        status: 'offline',
                        ultimo_ping: ST(),
                    };
                    // Se o turno foi encerrado, limpamos a sessão no Firebase para o analista ver
                    if (APP.turnoEncerrado) {
                        updateData.sessao = null;
                    }
                    return [4 /*yield*/, FS.collection(FCOL.coletores).doc(deviceId).update(updateData)];
                case 2:
                    _a.sent();
                    dbg('[Coletor] Marcado offline.');
                    return [3 /*break*/, 4];
                case 3:
                    e_5 = _a.sent();
                    console.warn('[Coletor] marcarOffline falhou:', e_5.message);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Encerra o turno do operador: envia tudo, marca como encerrado e faz logout.
 * O analista só consegue fechar o inventário se todos os coletores encerrarem.
 */
function encerrarTurnoColetor() {
    return __awaiter(this, void 0, void 0, function () {
        var pendentes, aindaPendentes, _statusEncerradosRec, recsPendentes;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (APP.turnoEncerrado)
                        return [2 /*return*/];
                    return [4 /*yield*/, idbGetPendentes()];
                case 1:
                    pendentes = _a.sent();
                    if (!(pendentes.length > 0)) return [3 /*break*/, 4];
                    if (!navigator.onLine) {
                        toast('⚠️ Sem Conexão: Você possui contagens pendentes. Conecte-se para enviar antes de encerrar.', 'e');
                        return [2 /*return*/];
                    }
                    toast('Enviando contagens pendentes antes de encerrar...', 'i');
                    return [4 /*yield*/, enviarFilaPendente()];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, idbGetPendentes()];
                case 3:
                    aindaPendentes = _a.sent();
                    if (aindaPendentes.length > 0) {
                        toast('Falha ao enviar algumas contagens. Tente novamente.', 'e');
                        return [2 /*return*/];
                    }
                    _a.label = 4;
                case 4:
                    _statusEncerradosRec = ['concluida', 'sem_divergencia', 'resolvida', 'aguardando_analista', 'cancelada'];
                    recsPendentes = (APP.recontagens || [])
                        .filter(function (r) { return !_statusEncerradosRec.includes((r.status_recontagem || 'pendente').toLowerCase()); });
                    if (recsPendentes.length > 0) {
                        toast('🚫 Você possui ' + recsPendentes.length + ' recontagem(ns) pendente(s). Finalize todas antes de encerrar o turno.', 'e');
                        showView('recontagens', document.getElementById('tab-recontagens'));
                        return [2 /*return*/];
                    }
                    // ── 3. Confirmação de encerramento ───────────────────────────────────────
                    showConfirm('Deseja encerrar seu turno? Após encerrar, você não poderá realizar novas contagens neste inventário.', function () { return __awaiter(_this, void 0, void 0, function () {
                        var deviceId, e_6;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 2, , 3]);
                                    APP.turnoEncerrado = true;
                                    deviceId = obterDeviceId();
                                    // Marcar no Firebase que este coletor encerrou o turno com sucesso
                                    return [4 /*yield*/, FS.collection(FCOL.coletores).doc(deviceId).update({
                                            status: 'offline',
                                            turno_encerrado: true,
                                            turno_encerrado_em: ST(),
                                            contagens_pendentes: 0,
                                            sessao: null
                                        })];
                                case 1:
                                    // Marcar no Firebase que este coletor encerrou o turno com sucesso
                                    _a.sent();
                                    toast('✅ Turno encerrado com sucesso!', 's');
                                    setTimeout(function () {
                                        AUTH.signOut();
                                        APP.operador = null;
                                        APP.turnoEncerrado = false; // reset para próximo login
                                        goScreen('login');
                                    }, 2000);
                                    return [3 /*break*/, 3];
                                case 2:
                                    e_6 = _a.sent();
                                    APP.turnoEncerrado = false;
                                    toast('Erro ao encerrar turno: ' + e_6.message, 'e');
                                    return [3 /*break*/, 3];
                                case 3: return [2 /*return*/];
                            }
                        });
                    }); }, { title: 'Encerrar Turno', icon: '🔒', okLabel: 'Encerrar Agora', okColor: 'var(--danger)' });
                    return [2 /*return*/];
            }
        });
    });
}
function iniciarSyncBackground() {
    var _this = this;
    // ── Inicializar IDB e migrar dados legados ──────────────────
    idbInit().then(function () {
        // Após IDB pronto, tentar enviar imediatamente se online
        if (navigator.onLine && FILA_ENVIO.length > 0) {
            enviarFilaPendente().catch(function () { });
        }
        atualizarBarraStatus();
    });
    // Heartbeat a cada 5 minutos → analista detecta online/offline
    // [OTIMIZADO] Aumentado de 2 min → 5 min: -60% de escritas de heartbeat.
    // O _coletorListener (onSnapshot no doc do coletor) já cobre bloqueios em tempo real.
    if (_heartbeatInterval)
        clearInterval(_heartbeatInterval);
    _heartbeatInterval = setInterval(enviarHeartbeat, 300000); // 5 min — era 2 min
    enviarHeartbeat(); // imediato
    // Listener em tempo real — detecta bloqueio/remoção pelo analista instantaneamente
    iniciarListenerColetor();
    // Tenta imediatamente ao entrar online
    window.addEventListener('online', function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    atualizarBarraStatus();
                    // ⚠️ Verificar inventário ANTES de enviar a fila.
                    // Se o analista fechou o inventário enquanto o operador estava offline,
                    // as contagens pendentes não devem ser enviadas (evita poluir inventário fechado).
                    return [4 /*yield*/, verificarInventarioAtivo()];
                case 1:
                    // ⚠️ Verificar inventário ANTES de enviar a fila.
                    // Se o analista fechou o inventário enquanto o operador estava offline,
                    // as contagens pendentes não devem ser enviadas (evita poluir inventário fechado).
                    _a.sent();
                    if (APP.inventario) {
                        enviarFilaPendente().catch(function () { });
                    }
                    return [2 /*return*/];
            }
        });
    }); });
    window.addEventListener('offline', function () {
        atualizarBarraStatus();
    });
    // Loop a cada 30 segundos — sync robusto automático
    // [OTIMIZADO] Intervalo aumentado de 10s → 30s: reduz leituras em 3× sem impacto operacional.
    // verificarInventarioAtivo() só ocorre a cada 10 min (20 ciclos × 30s) para não gerar
    // leitura extra a cada envio de fila — o onSnapshot do inventário já cobre atualizações urgentes.
    var _syncCiclo = 0;
    _syncInterval = setInterval(function () { return __awaiter(_this, void 0, void 0, function () {
        var pendentes;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!navigator.onLine) return [3 /*break*/, 2];
                    return [4 /*yield*/, idbGetPendentes()];
                case 1:
                    pendentes = _a.sent();
                    if (pendentes.length > 0) {
                        FILA_ENVIO = pendentes;
                        enviarFilaPendente().catch(function () { });
                    }
                    // Verifica inventário ativo só a cada ~10 min (20 ciclos × 30s)
                    _syncCiclo++;
                    if (_syncCiclo >= 20) {
                        _syncCiclo = 0;
                        verificarInventarioAtivo().catch(function () { });
                    }
                    _a.label = 2;
                case 2:
                    atualizarBarraStatus(); // mantém UI atualizada
                    return [2 /*return*/];
            }
        });
    }); }, 30 * 1000); // 30s — era 10s
    // 🔍 Polling a cada 60s para detectar inventários excluídos/encerrados pelo analista
    iniciarListenerInventarios();
}
// ─── Polling de inventários (substitui listener em tempo real) ──────────────
// Troca o onSnapshot por verificação a cada 60s.
// Motivo: o listener dispara em TODOS os 30 aparelhos a cada mudança do analista
// → gera 30 leituras simultâneas por atualização.
// Com polling de 60s: máximo 1 leitura/min/aparelho, mesmo com muitas atualizações.
// Impacto operacional: operador leva até 60s para ver encerramento — aceitável
// porque o analista sempre avisa antes de encerrar (rádio/WhatsApp).
var _invListener = null; // mantida para compatibilidade com logout (linha _invListener())
var _invPollInterval = null; // intervalo do polling
function iniciarListenerInventarios() {
    // Cancela polling anterior se existir
    if (_invPollInterval) {
        clearInterval(_invPollInterval);
        _invPollInterval = null;
    }
    // _invListener vira no-op (logout continua chamando _invListener() sem erro)
    _invListener = function () { if (_invPollInterval) {
        clearInterval(_invPollInterval);
        _invPollInterval = null;
    } };
    // Função de poll — executa imediatamente e depois a cada 3 min
    function _pollInventarios() {
        return __awaiter(this, void 0, void 0, function () {
            var screenInv, screenColeta, dentroInventario, snap, idsAtivos, lista, screenInv_1, e_7;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!navigator.onLine || !APP.operador)
                            return [2 /*return*/];
                        screenInv = document.getElementById('screen-inventarios');
                        screenColeta = document.getElementById('screen-coleta') || document.getElementById('screen-app');
                        dentroInventario = APP.inventario && screenColeta && screenColeta.classList.contains('ativo');
                        if (dentroInventario)
                            return [2 /*return*/]; // economiza leitura — syncInterval cobre esse caso
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, FS.collection(FCOL.inventarios)
                                .where('status', '==', 'ATIVO')
                                .get()];
                    case 2:
                        snap = _a.sent();
                        idsAtivos = snap.docs.map(function (d) { return d.id; });
                        lista = snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); });
                        APP.inventariosDisponiveis = lista;
                        invCacheSave(lista);
                        limparInventariosObsoletos(idsAtivos);
                        screenInv_1 = document.getElementById('screen-inventarios');
                        if (screenInv_1 && screenInv_1.classList.contains('ativo')) {
                            renderListaInventarios(lista);
                        }
                        // Se operador está dentro de um inventário, verifica se ainda está ativo
                        if (APP.inventario && !idsAtivos.includes(APP.inventario.id)) {
                            toast('⚠️ Este inventário foi encerrado. Retornando à seleção...', 'w');
                            APP.inventario = null;
                            APP.base = [];
                            setTimeout(function () { return voltarInventarios(); }, 2200);
                        }
                        dbg('[Poll] inventários:', lista.length, 'ativos');
                        return [3 /*break*/, 4];
                    case 3:
                        e_7 = _a.sent();
                        console.warn('[Poll] Erro ao verificar inventários:', e_7.message);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    _pollInventarios(); // executa imediatamente ao entrar
    _invPollInterval = setInterval(_pollInventarios, 180 * 1000); // era 60s → 3 min
}
/** Verifica se o inventário atual ainda existe/está ativo no Firestore */
function verificarInventarioAtivo() {
    return __awaiter(this, void 0, void 0, function () {
        var doc, status_1, e_8;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!APP.inventario || !navigator.onLine)
                        return [2 /*return*/];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS.collection(FCOL.inventarios).doc(APP.inventario.id).get()];
                case 2:
                    doc = _b.sent();
                    status_1 = (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.status;
                    if (!doc.exists || status_1 === 'FECHADO' || status_1 === 'Fechado' || status_1 === 'CANCELADO') {
                        toast('⚠️ Este inventário foi encerrado ou excluído. Retornando à seleção...', 'w');
                        APP.inventario = null;
                        APP.base = [];
                        setTimeout(function () { return voltarInventarios(); }, 2200);
                    }
                    return [3 /*break*/, 4];
                case 3:
                    e_8 = _b.sent();
                    console.warn('[verif] Não foi possível verificar inventário:', e_8.message);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/** Envia todas as contagens pendentes em background (não bloqueia UI) */
function enviarFilaPendente() {
    return __awaiter(this, void 0, void 0, function () {
        var pendentes, statusInv, enviados, falhas, erroConexao, _i, pendentes_1, c, docId, colecaoDestino, err_1, deviceId, bar_1, barText;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!navigator.onLine)
                        return [2 /*return*/];
                    return [4 /*yield*/, idbGetPendentes()];
                case 1:
                    pendentes = _c.sent();
                    if (!pendentes.length)
                        return [2 /*return*/];
                    statusInv = (((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.status) || '').toUpperCase();
                    if (APP.inventario && (statusInv === 'FECHADO' || statusInv === 'CANCELADO')) {
                        console.warn('[fila] Inventário não está ATIVO (' + statusInv + ') — envio bloqueado.');
                        toast('⚠️ Inventário encerrado. Contagens pendentes não enviadas.', 'e');
                        return [2 /*return*/];
                    }
                    // Bloquear envio se o inventário estiver PAUSADO
                    if (APP.inventario && statusInv === 'PAUSADO') {
                        console.warn('[fila] Inventário PAUSADO — envio aguardando reativação.');
                        toast('⏸ Inventário pausado. O envio será retomado quando for reativado.', 'w');
                        return [2 /*return*/];
                    }
                    atualizarBarraStatus();
                    enviados = [];
                    falhas = [];
                    erroConexao = false;
                    _i = 0, pendentes_1 = pendentes;
                    _c.label = 2;
                case 2:
                    if (!(_i < pendentes_1.length)) return [3 /*break*/, 9];
                    c = pendentes_1[_i];
                    if (erroConexao)
                        return [3 /*break*/, 9]; // abandona lote se conexão caiu no meio
                    _c.label = 3;
                case 3:
                    _c.trys.push([3, 6, , 8]);
                    docId = c.uuid || String(c.id);
                    colecaoDestino = c._destino || FCOL.contagens;
                    return [4 /*yield*/, FS.collection(colecaoDestino).doc(docId).set(__assign(__assign({}, c), { dataHora: c.dataHora
                                ? (typeof c.dataHora === 'string' ? new Date(c.dataHora) : c.dataHora)
                                : new Date(), enviado_em: new Date(), status_sync: 'sincronizado' }))];
                case 4:
                    _c.sent();
                    // Remove do IDB e marca localmente
                    return [4 /*yield*/, idbDelete(c.uuid)];
                case 5:
                    // Remove do IDB e marca localmente
                    _c.sent();
                    enviados.push(c.uuid || c.id);
                    return [3 /*break*/, 8];
                case 6:
                    err_1 = _c.sent();
                    console.warn('[Firebase] Erro ao enviar', c.uuid, err_1.message);
                    falhas.push(c.uuid || c.id);
                    // Incrementa tentativas no IDB
                    return [4 /*yield*/, idbPut(__assign(__assign({}, c), { tentativas: (c.tentativas || 0) + 1, ultimo_erro: err_1.message, status_sync: 'pendente' }))];
                case 7:
                    // Incrementa tentativas no IDB
                    _c.sent();
                    if (err_1.code === 'unavailable' || err_1.code === 'failed-precondition' ||
                        !navigator.onLine || ((_b = err_1.message) === null || _b === void 0 ? void 0 : _b.includes('network'))) {
                        erroConexao = true;
                    }
                    return [3 /*break*/, 8];
                case 8:
                    _i++;
                    return [3 /*break*/, 2];
                case 9:
                    if (!(enviados.length > 0)) return [3 /*break*/, 11];
                    return [4 /*yield*/, idbGetPendentes()];
                case 10:
                    // Rebuild FILA_ENVIO do IDB (fonte de verdade)
                    FILA_ENVIO = _c.sent();
                    filaSave(FILA_ENVIO); // espelho LS
                    atualizarBarraStatus();
                    updateStats();
                    // Atualiza doc do coletor no Firestore
                    try {
                        deviceId = obterDeviceId();
                        FS.collection(FCOL.coletores).doc(deviceId).update({
                            contagens_enviadas: firebase.firestore.FieldValue.increment(enviados.length),
                            contagens_pendentes: FILA_ENVIO.length,
                            ultimo_ping: firebase.firestore.FieldValue.serverTimestamp(),
                        }).catch(function () { });
                    }
                    catch (e) { }
                    if (FILA_ENVIO.length === 0) {
                        bar_1 = document.getElementById('sync-bar');
                        if (bar_1) {
                            bar_1.style.display = 'flex';
                            bar_1.style.background = 'linear-gradient(90deg,#14532d,#166534)';
                            barText = document.getElementById('sync-bar-text');
                            if (barText)
                                barText.textContent = "\u2705 ".concat(enviados.length, " contagem(ns) enviadas ao Firebase!");
                            setTimeout(function () { if (bar_1 && FILA_ENVIO.length === 0)
                                bar_1.style.display = 'none'; }, 3000);
                        }
                    }
                    _c.label = 11;
                case 11: return [2 /*return*/];
            }
        });
    });
}
/** Adiciona contagem à fila IDB + espelho LS e tenta enviar se online */
function enfileirarContagem(contagem) {
    return __awaiter(this, void 0, void 0, function () {
        var uuid, record, existe;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    uuid = contagem.uuid || gerarUUID();
                    record = __assign(__assign({}, contagem), { uuid: uuid, status_sync: 'pendente', tentativas: 0, criado_em: contagem.criado_em || contagem.dataHora || new Date().toISOString() });
                    return [4 /*yield*/, idbExists(uuid)];
                case 1:
                    existe = _a.sent();
                    if (existe) {
                        console.warn('[fila] Contagem já existe no IDB, ignorando duplicata:', uuid);
                        return [2 /*return*/];
                    }
                    // 1️⃣ Salvar no IDB (fonte de verdade — sobrevive a reload e fechamento)
                    return [4 /*yield*/, idbPut(record)];
                case 2:
                    // 1️⃣ Salvar no IDB (fonte de verdade — sobrevive a reload e fechamento)
                    _a.sent();
                    return [4 /*yield*/, idbGetPendentes()];
                case 3:
                    // 2️⃣ Atualizar espelho localStorage (backup de emergência)
                    FILA_ENVIO = _a.sent();
                    filaSave(FILA_ENVIO);
                    // 3️⃣ Atualizar UI imediatamente — operador não espera Firebase
                    atualizarBarraStatus();
                    // 4️⃣ Tentar enviar em background (sem bloquear o fluxo do operador)
                    if (navigator.onLine) {
                        enviarFilaPendente().catch(function () { });
                    }
                    return [2 /*return*/];
            }
        });
    });
}
