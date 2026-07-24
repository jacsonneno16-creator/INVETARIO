// ═══════════════════════════════════════════════════
//  HISTÓRICO
// ═══════════════════════════════════════════════════
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
function _audNorm(v) {
    return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toUpperCase();
}
function _audEndNorm(v) {
    return _audNorm(v).replace(/[^A-Z0-9]/g, '');
}
function _escapeAttr(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function toggleAuditoriaRua(rua) {
    var bodies = __spreadArray([], document.querySelectorAll('[id^="aud-rua-body-"]'), true);
    bodies.forEach(function (el, i) {
        if (el.getAttribute('data-rua') === rua) {
            var abrir = el.style.display === 'none';
            el.style.display = abrir ? 'block' : 'none';
            var icon = document.getElementById('aud-rua-icon-' + i);
            if (icon)
                icon.textContent = abrir ? '▾' : '▸';
        }
    });
}
function toggleAuditoriaEndereco(id) {
    var el = document.getElementById('aud-item-body-' + id);
    var icon = document.getElementById('aud-item-icon-' + id);
    if (!el)
        return;
    var abrir = el.style.display === 'none';
    el.style.display = abrir ? 'block' : 'none';
    if (icon)
        icon.textContent = abrir ? '▴' : '▾';
}
function renderHistorico() {
    var el = document.getElementById('hist-list');
    if (!APP.contagens.length) {
        el.innerHTML = "<div class=\"empty\"><div class=\"ei\">\uD83D\uDCCB</div><p>Nenhuma contagem nesta sess\u00E3o.</p></div>";
        return;
    }
    var total = APP.contagens.length;
    var divs = APP.contagens.filter(function (c) { return c.divergente; }).length;
    var resumoBar = "\n    <div style=\"display:flex;gap:8px;align-items:center;padding:8px 0 10px;flex-wrap:wrap\">\n      <span style=\"font-size:.72rem;color:var(--muted)\">Total: <b style=\"color:var(--text)\">".concat(total, "</b></span>\n      <span style=\"font-size:.72rem;color:var(--muted)\">\u00B7</span>\n      <span style=\"font-size:.72rem;color:var(--success)\">\u2713 OK: <b>").concat(total - divs, "</b></span>\n      ").concat(divs ? "<span style=\"font-size:.72rem;color:var(--muted)\">\u00B7</span>\n      <span style=\"font-size:.72rem;color:var(--warn)\">\u26A0 Diverg\u00EAncias: <b>".concat(divs, "</b></span>") : '', "\n    </div>");
    el.innerHTML = resumoBar + APP.contagens.slice(0, 100).map(function (c, i) {
        var hora = new Date(typeof c.dataHora === 'string' ? c.dataHora : c.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        var div = c.divergente;
        return "\n    <div style=\"\n      display:flex;align-items:flex-start;gap:10px;\n      padding:10px 12px;\n      background:".concat(div ? 'rgba(255,179,0,.06)' : 'var(--card)', ";\n      border:1px solid ").concat(div ? 'rgba(255,179,0,.3)' : 'var(--border)', ";\n      border-left:3px solid ").concat(div ? 'var(--warn)' : 'var(--success)', ";\n      border-radius:10px;margin-bottom:6px\">\n      <div style=\"font-size:1.1rem;margin-top:1px\">").concat(div ? '⚠️' : '✅', "</div>\n      <div style=\"flex:1;min-width:0\">\n        <div style=\"font-size:.82rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">").concat(c.descricao, "</div>\n        <div style=\"font-size:.68rem;color:var(--muted);margin-top:2px\">\n          \uD83D\uDCCD ").concat(c.endereco, " &nbsp;\u00B7&nbsp; CP ").concat(c.capa, " &nbsp;\u00B7&nbsp; Val ").concat(c.validade, "\n        </div>\n        ").concat(div ? "<div style=\"font-size:.68rem;color:var(--warn);margin-top:2px\">Esperado: ".concat(c.quantidade_esperada, " \u00B7 Contado: ").concat(c.quantidade, "</div>") : '', "\n        ").concat(c.bateu_auditoria ? "<div style=\"font-size:.68rem;color:var(--success);margin-top:2px;font-weight:700\">\u2705 Bateu com auditoria</div>" : '', "\n      </div>\n      <div style=\"text-align:right;flex-shrink:0\">\n        <div style=\"font-size:1.1rem;font-weight:800;font-family:var(--mono);color:").concat(div ? 'var(--warn)' : 'var(--accent)', "\">").concat(c.quantidade, "</div>\n        <div style=\"font-size:.6rem;color:var(--muted)\">").concat(hora, "</div>\n      </div>\n    </div>");
    }).join('');
}
// ═══════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════
function updateStats() {
    var _a, _b, _c;
    // Contagens ativas da sessão (excluindo estornadas)
    var ativas = APP.contagens.filter(function (c) { return !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA'; });
    var total = ativas.length;
    var enviadas = total - FILA_ENVIO.filter(function (c) { return !c._excluida && c.status !== 'ESTORNADA'; }).length;
    var pendentes = FILA_ENVIO.length;
    // Divergências potenciais = contagens com _alertaQtd (apenas informativo)
    // c.divergente sempre false desde que o analista decide a divergência real
    var divs = 0; // reservado — divergência é calculada pelo analista
    var s = function (id, v) { var el = document.getElementById(id); if (el)
        el.textContent = v; };
    s('st-total', total);
    s('st-enviadas', Math.max(0, enviadas));
    s('st-pendentes', pendentes);
    s('st-div', divs);
    // Campos de sessão
    s('st-op', ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || '—');
    s('st-inv', ((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.nome) || '—');
    s('st-base', APP.base.length ? APP.base.length + ' registros' : '—');
    s('st-net', navigator.onLine ? '🟢 Online' : '🔴 Offline');
    s('st-coletor', ((_c = localStorage.getItem('dt_device_id')) === null || _c === void 0 ? void 0 : _c.slice(0, 20)) || '—');
    var _locVer = localStorage.getItem('col_locais_ver');
    s('st-locais-ver', _locVer ? ('v' + _locVer.slice(0, 12) + (_locVer.length > 12 ? '…' : '')) : 'sem cache');
    var stAud = document.getElementById('st-aud');
    if (stAud)
        stAud.textContent = (APP.auditorias || []).length;
    // Fila (barra de status)
    atualizarBarraStatus();
}
// ── Forçar atualização do cache de endereços (dt_locais) ─────────────────
// Chamado pelo botão "Atualizar endereços" na aba Status.
// Limpa a versão salva para que o próximo carregamento de inventário
// faça um download fresco do dt_locais — sem precisar relogar.
function atualizarCacheLocais() {
    return __awaiter(this, void 0, void 0, function () {
        var btn, versaoServidor, metaDoc, e_1, versaoLocal, locaisSet_1, endCapMapa_1, chunksSnap, docsUsar, verStr, el, e_2;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    btn = document.getElementById('btn-refresh-locais');
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = '⏳ Atualizando…';
                    }
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 7, 8, 9]);
                    // Verificar conexão
                    if (!navigator.onLine) {
                        toast('Sem conexão — impossível atualizar endereços', 'e');
                        return [2 /*return*/];
                    }
                    versaoServidor = null;
                    _c.label = 2;
                case 2:
                    _c.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, FS.collection('dt_locais_meta').doc('versao').get()];
                case 3:
                    metaDoc = _c.sent();
                    if (metaDoc.exists)
                        versaoServidor = String((_b = (_a = metaDoc.data()) === null || _a === void 0 ? void 0 : _a.versao) !== null && _b !== void 0 ? _b : '');
                    return [3 /*break*/, 5];
                case 4:
                    e_1 = _c.sent();
                    toast('Erro ao verificar versão: ' + e_1.message, 'e');
                    return [2 /*return*/];
                case 5:
                    versaoLocal = localStorage.getItem('col_locais_ver');
                    if (versaoServidor && versaoLocal === versaoServidor) {
                        toast('✅ Endereços já estão atualizados (v' + versaoServidor.slice(0, 10) + ')', 's');
                        return [2 /*return*/];
                    }
                    locaisSet_1 = new Set();
                    endCapMapa_1 = {};
                    if (!versaoServidor)
                        throw new Error('Versão da Base Geral de Endereços não encontrada.');
                    return [4 /*yield*/, FS.collection('dt_locais_chunks').where('versao', '==', versaoServidor).get()];
                case 6:
                    chunksSnap = _c.sent();
                    if (chunksSnap.empty)
                        throw new Error('Base de endereços em chunks não publicada para a versão atual.');
                    docsUsar = chunksSnap.docs.slice().sort(function (a, b) { return Number((a.data() || {}).parte || 0) - Number((b.data() || {}).parte || 0); });
                    docsUsar.forEach(function (chunkDoc) {
                        var dados = chunkDoc.data().dados || chunkDoc.data().itens || [];
                        dados.forEach(function (d) {
                            var _a, _b, _c, _d, _e, _f;
                            if (d.ativo === false)
                                return;
                            var end = _normStr ? _normStr(d.endereco || '') : String(d.endereco || '').trim().toUpperCase().replace(/\s+/g, ' ');
                            if (!end)
                                return;
                            locaisSet_1.add(end);
                            var cap = parseInt((_f = (_e = (_d = (_c = (_b = (_a = d.capacidade_paletes) !== null && _a !== void 0 ? _a : d.capacidade_pallets) !== null && _b !== void 0 ? _b : d.capacidade_palete) !== null && _c !== void 0 ? _c : d.capacidade_pallet) !== null && _d !== void 0 ? _d : d.capacidade) !== null && _e !== void 0 ? _e : d.max_pallets) !== null && _f !== void 0 ? _f : 0);
                            if (cap > 0)
                                endCapMapa_1[end] = cap;
                        });
                    });
                    // Salvar cache
                    try {
                        localStorage.setItem('col_locais', JSON.stringify(endCapMapa_1));
                        localStorage.setItem('col_locais_set', JSON.stringify(__spreadArray([], locaisSet_1, true)));
                        if (versaoServidor)
                            localStorage.setItem('col_locais_ver', versaoServidor);
                    }
                    catch (e) { }
                    // Atualizar APP em memória (sem precisar recarregar inventário)
                    APP.locaisAtivos = locaisSet_1;
                    APP._locaisDoFirebase = true;
                    if (APP.endCapacidade)
                        Object.assign(APP.endCapacidade, endCapMapa_1);
                    verStr = versaoServidor ? ('v' + versaoServidor.slice(0, 12)) : 'sem versão';
                    el = document.getElementById('st-locais-ver');
                    if (el)
                        el.textContent = verStr;
                    toast('✅ ' + locaisSet_1.size + ' endereços atualizados (' + verStr + ')', 's');
                    dbg('[dt_locais] atualização manual: ' + locaisSet_1.size + ' ends | ver:', versaoServidor);
                    return [3 /*break*/, 9];
                case 7:
                    e_2 = _c.sent();
                    toast('Erro ao atualizar endereços: ' + e_2.message, 'e');
                    console.warn('[dt_locais] atualizarCacheLocais erro:', e_2);
                    return [3 /*break*/, 9];
                case 8:
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = '🔄 Atualizar endereços';
                    }
                    return [7 /*endfinally*/];
                case 9: return [2 /*return*/];
            }
        });
    });
}
