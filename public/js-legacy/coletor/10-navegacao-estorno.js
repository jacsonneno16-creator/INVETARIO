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
// ═══════════════════════════════════════════════════
//  NAVEGAÇÃO
// ═══════════════════════════════════════════════════
function goScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) { return s.classList.remove('active'); });
    var alvo = document.getElementById('screen-' + id);
    if (!alvo) { console.warn('[Navegacao] Tela inexistente:', id); return false; }
    alvo.classList.add('active');
    return true;
}
// ═══════════════════════════════════════════════════
//  ↩️  ESTORNO DE CONTAGENS
//  Regra: marca _excluida=true + status='ESTORNADA'
//  sem apagar o doc — liberando o endereço para recontagem.
// ═══════════════════════════════════════════════════
/**
 * Renderiza a lista de contagens estornáveis do operador atual
 * neste inventário. Mostra também estornadas (para histórico),
 * mas apenas as ativas têm botão de estornar.
 */
function renderEstorno() {
    return __awaiter(this, void 0, void 0, function () {
        var el, badge, invId, op, _a, snapConts, snapVazios, docsFirebase, uuidsFirebase_1, docsLocais, todas, ativas, estornadas, fmtData_1, renderCard_1, html, err_1;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    el = document.getElementById('estorno-list');
                    badge = document.getElementById('estorno-badge');
                    invId = (_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.id;
                    op = (_c = APP.operador) === null || _c === void 0 ? void 0 : _c.name;
                    if (!invId) {
                        el.innerHTML = "<div class=\"empty\"><div class=\"ei\">\uD83D\uDCE6</div><p>Selecione um invent\u00E1rio primeiro.</p></div>";
                        return [2 /*return*/];
                    }
                    el.innerHTML = "<div style=\"text-align:center;padding:24px;color:var(--muted);font-size:.8rem\">\u23F3 Carregando\u2026</div>";
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, Promise.all([
                            FS.collection(FCOL.contagens)
                                .where('inventario_id', '==', invId)
                                .where('operador', '==', op)
                                .get(),
                            FS.collection('dt_vazios')
                                .where('inventario_id', '==', invId)
                                .where('operador', '==', op)
                                .get(),
                        ])];
                case 2:
                    _a = _d.sent(), snapConts = _a[0], snapVazios = _a[1];
                    docsFirebase = __spreadArray(__spreadArray([], snapConts.docs.map(function (d) { return (__assign({ _docId: d.id, _colecao: 'dt_contagens' }, d.data())); }), true), snapVazios.docs.map(function (d) { return (__assign({ _docId: d.id, _colecao: 'dt_vazios' }, d.data())); }), true);
                    uuidsFirebase_1 = new Set(docsFirebase.map(function (d) { return d._docId || d.uuid; }));
                    docsLocais = APP.contagens
                        .filter(function (c) { return c.inventario_id === invId && c.operador === op && !uuidsFirebase_1.has(c.uuid); })
                        .map(function (c) { return (__assign({ _docId: c.uuid, _local: true }, c)); });
                    todas = __spreadArray(__spreadArray([], docsFirebase, true), docsLocais, true).sort(function (a, b) {
                        var _a, _b;
                        var ta = ((_a = a.dataHora) === null || _a === void 0 ? void 0 : _a.toDate) ? a.dataHora.toDate() : new Date(a.dataHora || 0);
                        var tb = ((_b = b.dataHora) === null || _b === void 0 ? void 0 : _b.toDate) ? b.dataHora.toDate() : new Date(b.dataHora || 0);
                        return tb - ta;
                    });
                    if (!todas.length) {
                        el.innerHTML = "<div class=\"empty\"><div class=\"ei\">\u2705</div><p>Nenhuma contagem neste invent\u00E1rio ainda.</p></div>";
                        if (badge)
                            badge.textContent = '';
                        return [2 /*return*/];
                    }
                    ativas = todas.filter(function (c) { return !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA'; });
                    estornadas = todas.filter(function (c) { return c._excluida || c.status === 'ESTORNADA' || c.status === 'EXCLUIDA'; });
                    if (badge)
                        badge.textContent = "".concat(ativas.length, " ativa(s) \u00B7 ").concat(estornadas.length, " estornada(s)");
                    fmtData_1 = function (dh) {
                        if (!dh)
                            return '—';
                        try {
                            var d = dh.toDate ? dh.toDate() : new Date(dh);
                            return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                        }
                        catch (e) {
                            return '—';
                        }
                    };
                    renderCard_1 = function (c, isEstornada) {
                        var isVazio = c.tipo_contagem === 'VAZIO';
                        var corBorda = isEstornada ? 'rgba(148,163,184,.3)' : isVazio ? 'rgba(100,116,139,.4)' : 'rgba(232,117,26,.2)';
                        var corBordaL = isEstornada ? '#475569' : isVazio ? '#64748b' : 'var(--accent)';
                        var opacidade = isEstornada ? 'opacity:.55' : '';
                        var icone = isVazio ? '📭' : '📦';
                        var labelTipo = isVazio
                            ? "<span style=\"font-size:.6rem;background:rgba(100,116,139,.2);color:#94a3b8;border-radius:4px;padding:1px 5px;margin-left:6px\">VAZIO</span>"
                            : '';
                        var labelLocal = c._local
                            ? "<span style=\"font-size:.6rem;background:rgba(255,179,0,.15);color:var(--warn);border-radius:4px;padding:1px 5px;margin-left:4px\">pendente</span>"
                            : '';
                        return "\n      <div style=\"\n        background:var(--card);border:1px solid ".concat(corBorda, ";border-left:3px solid ").concat(corBordaL, ";\n        border-radius:var(--r);padding:10px 12px;margin-bottom:6px;").concat(opacidade, "\n      \">\n        <div style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:8px\">\n          <div style=\"flex:1;min-width:0\">\n            <div style=\"display:flex;align-items:center;flex-wrap:wrap;gap:2px\">\n              <span style=\"font-size:.82rem;font-weight:700;font-family:var(--mono);color:").concat(isEstornada ? 'var(--muted)' : 'var(--accent)', "\">").concat(icone, " ").concat(c.endereco || '—', "</span>\n              ").concat(labelTipo).concat(labelLocal, "\n            </div>\n            <div style=\"font-size:.72rem;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">\n              ").concat(isVazio ? 'Endereço vazio confirmado' : (c.descricao || c.gtin || '—'), "\n            </div>\n            <div style=\"font-size:.68rem;color:var(--muted);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap\">\n              ").concat(!isVazio ? "<span>CP&nbsp;".concat(c.capa || '—', "</span><span>Qtd&nbsp;<b>").concat(c.quantidade, "</b></span><span>Val&nbsp;").concat(c.validade || '—', "</span>") : '', "\n              <span>\uD83D\uDD50&nbsp;").concat(fmtData_1(c.dataHora), "</span>\n            </div>\n            ").concat(isEstornada ? "<div style=\"font-size:.64rem;color:var(--muted);margin-top:4px;border-top:1px solid var(--border);padding-top:4px\">\n              \u21A9 Estornado por <b>".concat(c.estornada_por || '—', "</b> em ").concat(fmtData_1(c._excluida_em), "\n            </div>") : '', "\n          </div>\n          <div style=\"flex-shrink:0\">\n            ").concat(!isEstornada
                            ? "<button onclick=\"estornarContagem('".concat(c._docId, "', ").concat(!!c._local, ")\"\n                  style=\"background:rgba(255,71,87,.12);border:1px solid rgba(255,71,87,.3);color:#ff4757;\n                         border-radius:8px;padding:6px 12px;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap\">\n                  \u21A9 Estornar\n                </button>")
                            : "<span style=\"font-size:.65rem;color:var(--muted);font-weight:700\">ESTORNADA</span>", "\n          </div>\n        </div>\n      </div>");
                    };
                    html = '';
                    if (ativas.length) {
                        html += "<div style=\"font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px\">Contagens ativas</div>";
                        html += ativas.map(function (c) { return renderCard_1(c, false); }).join('');
                    }
                    if (estornadas.length) {
                        html += "<div style=\"font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:10px 0 6px\">Estornadas (hist\u00F3rico)</div>";
                        html += estornadas.map(function (c) { return renderCard_1(c, true); }).join('');
                    }
                    el.innerHTML = html;
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _d.sent();
                    console.error('[Estorno] renderEstorno:', err_1);
                    el.innerHTML = "<div class=\"fb err\" style=\"margin:0\">\u2717 Erro ao carregar contagens: ".concat(err_1.message, "</div>");
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Estorna uma contagem: marca _excluida=true + status='ESTORNADA'.
 * Não apaga o documento — libera o endereço para nova contagem.
 */
function estornarContagem(docId_1) {
    return __awaiter(this, arguments, void 0, function (docId, isLocal) {
        var op, confirmado, idx, filaAtual, reg, _docLocal, _colEstorno, idx, err_2;
        var _a;
        if (isLocal === void 0) { isLocal = false; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    op = ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || 'Operador';
                    return [4 /*yield*/, _confirmarEstorno(docId)];
                case 1:
                    confirmado = _b.sent();
                    if (!confirmado)
                        return [2 /*return*/];
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 9, , 10]);
                    if (!isLocal) return [3 /*break*/, 6];
                    idx = APP.contagens.findIndex(function (c) { return c.uuid === docId || c._docId === docId; });
                    if (idx >= 0) {
                        APP.contagens[idx]._excluida = true;
                        APP.contagens[idx].status = 'ESTORNADA';
                        APP.contagens[idx]._excluida_em = new Date().toISOString();
                        APP.contagens[idx].estornada_por = op;
                    }
                    return [4 /*yield*/, idbGetPendentes().catch(function () { return []; })];
                case 3:
                    filaAtual = _b.sent();
                    reg = filaAtual.find(function (c) { return c.uuid === docId; });
                    if (!reg) return [3 /*break*/, 5];
                    return [4 /*yield*/, idbPut(__assign(__assign({}, reg), { _excluida: true, status: 'ESTORNADA', _excluida_em: new Date().toISOString(), estornada_por: op }))];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5: return [3 /*break*/, 8];
                case 6:
                    _docLocal = APP.contagens.find(function (c) { return c.uuid === docId || c._docId === docId || c.id === docId; });
                    _colEstorno = ((_docLocal === null || _docLocal === void 0 ? void 0 : _docLocal.tipo_contagem) === 'VAZIO' || (_docLocal === null || _docLocal === void 0 ? void 0 : _docLocal._colecao) === 'dt_vazios')
                        ? 'dt_vazios' : FCOL.contagens;
                    return [4 /*yield*/, FS.collection(_colEstorno).doc(docId).update({
                            _excluida: true,
                            status: 'ESTORNADA',
                            _excluida_em: new Date().toISOString(),
                            estornada_por: op,
                        })];
                case 7:
                    _b.sent();
                    idx = APP.contagens.findIndex(function (c) { return c.uuid === docId || c._docId === docId || c.id === docId; });
                    if (idx >= 0) {
                        APP.contagens[idx]._excluida = true;
                        APP.contagens[idx].status = 'ESTORNADA';
                        APP.contagens[idx]._excluida_em = new Date().toISOString();
                        APP.contagens[idx].estornada_por = op;
                    }
                    _b.label = 8;
                case 8:
                    // Invalidar cache do endereço para liberar nova contagem
                    _endVerif = null;
                    toast('↩ Contagem estornada. Endereço liberado.', 's');
                    renderEstorno();
                    renderHistorico();
                    updateStats();
                    return [3 /*break*/, 10];
                case 9:
                    err_2 = _b.sent();
                    console.error('[Estorno] estornarContagem:', err_2);
                    toast('✗ Erro ao estornar: ' + err_2.message, 'e');
                    return [3 /*break*/, 10];
                case 10: return [2 /*return*/];
            }
        });
    });
}
/** Modal de confirmação inline (sem alert/confirm nativo) */
function _confirmarEstorno(docId) {
    return new Promise(function (resolve) {
        // Remove modal anterior se existir
        var old = document.getElementById('modal-estorno');
        if (old)
            old.remove();
        var modal = document.createElement('div');
        modal.id = 'modal-estorno';
        modal.style.cssText = "\n      position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);\n      display:flex;align-items:center;justify-content:center;padding:20px;\n    ";
        modal.innerHTML = "\n      <div style=\"\n        background:var(--surface);border:1px solid var(--border);border-radius:16px;\n        padding:24px;max-width:320px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5);\n      \">\n        <div style=\"font-size:1.4rem;text-align:center;margin-bottom:12px\">\u21A9\uFE0F</div>\n        <div style=\"font-weight:700;font-size:.92rem;text-align:center;margin-bottom:8px\">Confirmar estorno</div>\n        <div style=\"font-size:.78rem;color:var(--muted);text-align:center;margin-bottom:20px;line-height:1.5\">\n          Esta contagem ser\u00E1 marcada como <b>ESTORNADA</b>.<br>\n          O endere\u00E7o ficar\u00E1 liberado para nova contagem.<br>\n          <span style=\"color:var(--warn)\">O hist\u00F3rico n\u00E3o ser\u00E1 apagado.</span>\n        </div>\n        <div style=\"display:flex;gap:10px\">\n          <button id=\"btn-cancel-estorno\" style=\"\n            flex:1;padding:10px;border-radius:10px;border:1px solid var(--border);\n            background:transparent;color:var(--muted);font-size:.82rem;cursor:pointer\n          \">Cancelar</button>\n          <button id=\"btn-ok-estorno\" style=\"\n            flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,71,87,.4);\n            background:rgba(255,71,87,.15);color:#ff4757;font-size:.82rem;font-weight:700;cursor:pointer\n          \">\u21A9 Estornar</button>\n        </div>\n      </div>";
        document.body.appendChild(modal);
        document.getElementById('btn-ok-estorno').onclick = function () { modal.remove(); resolve(true); };
        document.getElementById('btn-cancel-estorno').onclick = function () { modal.remove(); resolve(false); };
        modal.addEventListener('click', function (e) { if (e.target === modal) {
            modal.remove();
            resolve(false);
        } });
    });
}
function showView(v, el) {
    document.querySelectorAll('.view').forEach(function (e) { return e.classList.remove('on'); });
    document.querySelectorAll('.nav-tab').forEach(function (e) { return e.classList.remove('on'); });
    document.getElementById('view-' + v).classList.add('on');
    if (el)
        el.classList.add('on');
    if (v === 'status')
        updateStats();
    if (v === 'estorno')
        renderEstorno();
    if (v === 'recontagens')
        renderRecontagensAtribuidas();
    if (v === 'auditoria')
        renderAuditoriaColetor();
}
