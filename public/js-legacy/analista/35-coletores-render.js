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
var _abaColetoresInicializada = false;
var _acoesColetoresEmAndamento = new Set();
function inicializarAbaColetores() {
    if (_abaColetoresInicializada)
        return;
    _abaColetoresInicializada = true;
    ['col-painel-cards', 'col-cadastro-wrap'].forEach(function (id) {
        var container = document.getElementById(id);
        if (!container || container.dataset.eventosColetores === '1')
            return;
        container.dataset.eventosColetores = '1';
        container.addEventListener('click', tratarCliqueAcaoColetor);
    });
}
window.inicializarAbaColetores = inicializarAbaColetores;
function tratarCliqueAcaoColetor(event) {
    return __awaiter(this, void 0, void 0, function () {
        var botao, acao, coletorId, botoesDoColetor, textosOriginais, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    botao = event.target.closest('[data-acao-coletor]');
                    if (!botao)
                        return [2 /*return*/];
                    event.preventDefault();
                    event.stopPropagation();
                    acao = botao.dataset.acaoColetor;
                    coletorId = botao.dataset.coletorId;
                    if (!acao || !coletorId || _acoesColetoresEmAndamento.has(coletorId))
                        return [2 /*return*/];
                    if (acao === 'editar') {
                        editarNomeColetor(coletorId);
                        return [2 /*return*/];
                    }
                    if (acao === 'logout') {
                        logoutOperadorColetor(coletorId);
                        return [2 /*return*/];
                    }
                    botoesDoColetor = document.querySelectorAll("[data-coletor-id=\"".concat(CSS.escape(coletorId), "\"]"));
                    textosOriginais = new Map();
                    botoesDoColetor.forEach(function (btn) {
                        textosOriginais.set(btn, btn.innerHTML);
                        btn.disabled = true;
                        btn.setAttribute('aria-busy', 'true');
                    });
                    botao.innerHTML = '⏳ Processando…';
                    _acoesColetoresEmAndamento.add(coletorId);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 12, 13, 14]);
                    if (!(acao === 'aprovar')) return [3 /*break*/, 3];
                    return [4 /*yield*/, aprovarColetor(coletorId)];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 11];
                case 3:
                    if (!(acao === 'reprovar')) return [3 /*break*/, 5];
                    return [4 /*yield*/, reprovarColetor(coletorId)];
                case 4:
                    _a.sent();
                    return [3 /*break*/, 11];
                case 5:
                    if (!(acao === 'bloquear')) return [3 /*break*/, 7];
                    return [4 /*yield*/, bloquearColetor(coletorId)];
                case 6:
                    _a.sent();
                    return [3 /*break*/, 11];
                case 7:
                    if (!(acao === 'desbloquear')) return [3 /*break*/, 9];
                    return [4 /*yield*/, desbloquearColetor(coletorId)];
                case 8:
                    _a.sent();
                    return [3 /*break*/, 11];
                case 9:
                    if (!(acao === 'excluir')) return [3 /*break*/, 11];
                    return [4 /*yield*/, excluirColetor(coletorId)];
                case 10:
                    _a.sent();
                    _a.label = 11;
                case 11: return [3 /*break*/, 14];
                case 12:
                    error_1 = _a.sent();
                    console.error("[Coletores] Falha na a\u00E7\u00E3o ".concat(acao, ":"), error_1);
                    return [3 /*break*/, 14];
                case 13:
                    _acoesColetoresEmAndamento.delete(coletorId);
                    botoesDoColetor.forEach(function (btn) {
                        if (!btn.isConnected)
                            return;
                        btn.disabled = false;
                        btn.removeAttribute('aria-busy');
                        if (textosOriginais.has(btn))
                            btn.innerHTML = textosOriginais.get(btn);
                    });
                    return [7 /*endfinally*/];
                case 14: return [2 /*return*/];
            }
        });
    });
}
// Busca direta usada pelo botão Atualizar e ao abrir a aba.
function atualizarAbaColetores() {
    return __awaiter(this, void 0, void 0, function () {
        var btn, e_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    btn = document.activeElement;
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 5, , 6]);
                    if (!((_a = window.AnalistaFirebaseService) === null || _a === void 0 ? void 0 : _a.refreshColetores)) return [3 /*break*/, 3];
                    return [4 /*yield*/, window.AnalistaFirebaseService.refreshColetores()];
                case 2:
                    _b.sent();
                    return [3 /*break*/, 4];
                case 3:
                    renderColetores();
                    _b.label = 4;
                case 4: return [3 /*break*/, 6];
                case 5:
                    e_1 = _b.sent();
                    renderColetores();
                    if (typeof showToast === 'function')
                        showToast('Não foi possível atualizar os coletores: ' + e_1.message, 'e');
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
window.atualizarAbaColetores = atualizarAbaColetores;
// ── RENDER PRINCIPAL ─────────────────────────────────────────────────
function renderColetores() {
    var _a;
    inicializarAbaColetores();
    var fInv = ((_a = document.getElementById('col-sel-inv')) === null || _a === void 0 ? void 0 : _a.value) || '';
    // Apenas contagens ativas (excluindo estornadas/excluídas)
    var conts = state().contagens.filter(function (c) { return !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA'; });
    if (fInv)
        conts = conts.filter(function (c) { return c.inventario_id === fInv; });
    var porOp = {};
    conts.forEach(function (c) {
        var op = c.operador || 'Desconhecido';
        if (!porOp[op])
            porOp[op] = { total: 0, divergentes: 0, ultima: '', ultimaLeitura: '', enderecos: new Set() };
        porOp[op].total++;
        if (c.divergente === true)
            porOp[op].divergentes++;
        if (c.timestamp > porOp[op].ultima) {
            porOp[op].ultima = c.timestamp;
            porOp[op].ultimaLeitura = c.endereco || '—';
        }
        porOp[op].enderecos.add(c.endereco);
    });
    var operadores = Object.entries(porOp).sort(function (a, b) { return b[1].total - a[1].total; });
    var cols = state().coletores;
    if (fInv)
        cols = cols.filter(function (c) { return !c.sessao || c.sessao.inventario_id === fInv; });
    var online = cols.filter(function (c) { return c.status === 'online'; }).length;
    var totalPendentes = cols.reduce(function (s, c) { return s + (c.contagens_pendentes || 0); }, 0);
    var pendAprovacao = state().coletores.filter(function (c) { return (c.aprovado || 'pendente') === 'pendente'; }).length;
    var bloqueados2 = state().coletores.filter(function (c) { return c.aprovado === 'bloqueado'; }).length;
    document.getElementById('col-kpis').innerHTML = "\n    <div class=\"kpi blue\"><span class=\"kpi-icon\">\uD83D\uDCF1</span><div class=\"kpi-val\">".concat(state().coletores.length, "</div><div class=\"kpi-lbl\">Dispositivos Registrados</div></div>\n    <div class=\"kpi green\"><span class=\"kpi-icon\">\uD83D\uDFE2</span><div class=\"kpi-val\">").concat(online, "</div><div class=\"kpi-lbl\">Online Agora</div></div>\n    <div class=\"kpi yellow\"><span class=\"kpi-icon\">\u23F3</span><div class=\"kpi-val\" style=\"color:").concat(pendAprovacao > 0 ? '#d97706' : 'inherit', "\">").concat(pendAprovacao, "</div><div class=\"kpi-lbl\">Aguard. Aprova\u00E7\u00E3o</div></div>\n    <div class=\"kpi red\"><span class=\"kpi-icon\">\uD83D\uDEAB</span><div class=\"kpi-val\">").concat(bloqueados2, "</div><div class=\"kpi-lbl\">Bloqueados</div></div>\n    <div class=\"kpi purple\"><span class=\"kpi-icon\">\uD83D\uDCCB</span><div class=\"kpi-val\">").concat(conts.length.toLocaleString('pt-BR'), "</div><div class=\"kpi-lbl\">Total Contagens</div></div>\n    <div class=\"kpi orange\"><span class=\"kpi-icon\">\u26A0\uFE0F</span><div class=\"kpi-val\">").concat(conts.filter(function (c) { return c.divergente === true; }).length, "</div><div class=\"kpi-lbl\">Com Diverg\u00EAncia</div></div>");
    _renderPainelVisualColetores(cols);
    _renderTabelaColetores(cols);
    // Produtividade por operador — melhorada
    if (!operadores.length) {
        document.getElementById('col-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDC64</div><div class=\"empty-title\">Nenhum operador com contagens</div><div class=\"empty-sub\">As contagens aparecer\u00E3o aqui conforme os operadores registrarem</div></div>";
    }
    else {
        document.getElementById('col-table-wrap').innerHTML = "\n      <div class=\"tbl-wrap\"><table>\n        <thead><tr>\n          <th>Operador</th><th>Coletor Atual</th>\n          <th>End. Contados</th><th>Total Contagens</th>\n          <th>Rodadas</th><th>Em Conflito</th>\n          <th>Prod./hora</th><th>Tempo M\u00E9dio/end</th>\n          <th>\u00DAltima Atividade</th>\n        </tr></thead>\n        <tbody>".concat(operadores.map(function (_a) {
            var _b;
            var op = _a[0], d = _a[1];
            var colAtual = state().coletores.find(function (c) { var _a; return ((_a = c.sessao) === null || _a === void 0 ? void 0 : _a.operador) === op && c.status === 'online'; });
            // Calcular produtividade/hora
            var prodHz = '—', tempoMedio = '—';
            try {
                var allConts = conts.filter(function (c) { return (c.operador || 'Desconhecido') === op; });
                var timestamps = allConts.map(function (c) { return new Date(c.timestamp).getTime(); }).filter(function (t) { return !isNaN(t); }).sort();
                if (timestamps.length >= 2) {
                    var diffMs = timestamps[timestamps.length - 1] - timestamps[0];
                    if (diffMs > 60000) {
                        var hrs = diffMs / 3600000;
                        prodHz = (d.enderecos.size / hrs).toFixed(1) + '/h';
                        var avgSec = diffMs / 1000 / d.enderecos.size;
                        tempoMedio = avgSec < 60 ? Math.round(avgSec) + 's' : Math.round(avgSec / 60) + 'min';
                    }
                }
            }
            catch (e) { }
            var recOp = state().recontagens.filter(function (r) { return r.operador === op; }).length;
            return "<tr>\n            <td><div style=\"display:flex;align-items:center;gap:8px\">\n              <div class=\"u-avatar\" style=\"width:28px;height:28px;font-size:.72rem;flex-shrink:0\">".concat(((_b = op[0]) === null || _b === void 0 ? void 0 : _b.toUpperCase()) || '?', "</div>\n              <span style=\"font-weight:600\">").concat(op, "</span>\n            </div></td>\n            <td class=\"mono\">").concat(colAtual ? "\uD83D\uDFE2 Coletor ".concat(colAtual.numero) : '<span style="color:var(--muted)">—</span>', "</td>\n            <td class=\"mono\" style=\"font-weight:700\">").concat(d.enderecos.size.toLocaleString('pt-BR'), "</td>\n            <td class=\"mono\">").concat(d.total.toLocaleString('pt-BR'), "</td>\n            <td class=\"mono\">").concat(recOp, "</td>\n            <td class=\"mono\" style=\"color:").concat(d.divergentes > 0 ? 'var(--danger)' : 'var(--muted)', "\">").concat(d.divergentes, "</td>\n            <td class=\"mono\" style=\"color:var(--accent);font-weight:700\">").concat(prodHz, "</td>\n            <td class=\"mono\">").concat(tempoMedio, "</td>\n            <td style=\"font-size:.75rem;color:var(--muted)\">").concat(fmtTs(d.ultima), "</td>\n          </tr>");
        }).join(''), "</tbody>\n      </table></div>");
    }
    document.getElementById('col-painel-ultima-atualizacao').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
}
// ── Painel de cards visuais ──────────────────────────────────────────
function _renderPainelVisualColetores(cols) {
    var el = document.getElementById('col-painel-cards');
    if (!cols.length) {
        el.innerHTML = "<div class=\"empty\" style=\"padding:20px;width:100%\">\n      <div class=\"empty-icon\">\uD83D\uDCE1</div><div class=\"empty-title\">Nenhum coletor registrado</div>\n      <div class=\"empty-sub\">Coletores s\u00E3o registrados automaticamente quando um aparelho acessa o sistema</div>\n      <button class=\"btn btn-warn btn-sm coletor-acao-btn\" style=\"margin-top:12px\" onclick=\"abrirModalSimularColetor()\">\uD83E\uDDEA Simular acesso de coletor</button>\n    </div>";
        return;
    }
    el.innerHTML = cols.map(function (col) {
        var isOnline = col.status === 'online';
        var ap = col.aprovado || 'pendente';
        var op = col.sessao;
        var invNomeDisplay = (op === null || op === void 0 ? void 0 : op.inventario_nome) || ((op === null || op === void 0 ? void 0 : op.inventario_id) ? '(inv. ' + op.inventario_id.slice(-6) + ')' : '—');
        var pendentes = col.contagens_pendentes || 0;
        var turnoEncerrado = col.turno_encerrado === true;
        var tempoOnline = isOnline && op ? _calcTempoOnline(op.login_em) : null;
        var apBg = ap === 'aprovado' ? (isOnline ? '#f0fdf4' : 'var(--surface-2)') : (ap === 'bloqueado' || ap === 'reprovado') ? '#fff5f5' : '#fffbeb';
        var apBord = ap === 'aprovado' ? (isOnline ? 'var(--success)' : 'var(--border)') : (ap === 'bloqueado' || ap === 'reprovado') ? '#fca5a5' : '#fcd34d';
        var apBadge = ap === 'aprovado'
            ? "<span style=\"font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(34,197,94,.12);color:var(--success);font-weight:700\">\u2713 Aprovado</span>"
            : ap === 'bloqueado'
                ? "<span style=\"font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(255,71,87,.12);color:var(--danger);font-weight:700\">\uD83D\uDEAB Bloqueado</span>"
                : ap === 'reprovado'
                    ? "<span style=\"font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(255,71,87,.12);color:var(--danger);font-weight:700\">\u274C Reprovado</span>"
                    : "<span style=\"font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(251,191,36,.15);color:#d97706;font-weight:700\">\u23F3 Pendente</span>";
        return "<div class=\"coletor-card\" data-coletor-card=\"".concat(col.id, "\" style=\"\n      background:").concat(apBg, ";\n      border:2px solid ").concat(apBord, ";\n      border-radius:14px;padding:14px 16px;min-width:210px;flex:1;max-width:280px;\n      box-shadow:").concat(isOnline && ap === 'aprovado' ? '0 2px 12px rgba(34,197,94,.15)' : 'none', ";position:relative;\n    \">\n      <div style=\"display:flex;align-items:center;gap:8px;margin-bottom:6px\">\n        <div style=\"width:10px;height:10px;border-radius:50%;background:").concat(isOnline && ap === 'aprovado' ? 'var(--success)' : '#94a3b8', ";flex-shrink:0;").concat(isOnline && ap === 'aprovado' ? 'box-shadow:0 0 0 3px rgba(34,197,94,.25);animation:pulse 2s infinite' : '', "\"></div>\n        <span style=\"font-weight:800;font-size:1rem;font-family:var(--mono)\">").concat(col.nome_exibicao || ('Coletor ' + col.numero), "</span>\n        ").concat(apBadge, "\n        ").concat(turnoEncerrado ? "<span style=\"font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(14,165,233,.15);color:#0ea5e9;font-weight:700;margin-left:4px\">\uD83D\uDD12 Encerrado</span>" : '', "\n        <button data-acao-coletor=\"editar\" data-coletor-id=\"").concat(col.id, "\" title=\"Editar nome\" style=\"margin-left:auto;background:none;border:none;cursor:pointer;font-size:.85rem;opacity:.5;padding:2px 4px;flex-shrink:0\" title=\"Renomear\">\u270F\uFE0F</button>\n      </div>\n      <div style=\"margin-bottom:8px\">\n        <div style=\"font-size:.72rem;font-weight:600;color:var(--text);margin-bottom:2px\">\n          \uD83D\uDC64 ").concat(col.operador_atual || (op === null || op === void 0 ? void 0 : op.operador) || '<span style="color:var(--muted);font-style:italic">Sem operador</span>', "\n        </div>\n        ").concat(op && ap === 'aprovado' ? "\n          <div style=\"font-size:.68rem;color:var(--muted);margin-bottom:2px\">\uD83D\uDD50 Login: ".concat(new Date(op.login_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), "</div>\n          <div style=\"font-size:.68rem;color:var(--muted)\">\uD83D\uDCE6 ").concat(invNomeDisplay, "</div>\n        ") : '', "\n        ").concat(ap === 'pendente' ? '<div style="font-size:.7rem;color:#d97706;margin-top:4px">Aguardando aprovação do analista</div>' : '', "\n        ").concat(ap === 'bloqueado' ? '<div style="font-size:.7rem;color:var(--danger);margin-top:4px">Acesso bloqueado</div>' : '').concat(ap === 'reprovado' ? '<div style="font-size:.7rem;color:var(--danger);margin-top:4px">Solicitação reprovada</div>' : '', "\n      </div>\n      ").concat(ap === 'aprovado' ? "\n      <div style=\"display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px\">\n        <div style=\"background:#fff;border:1px solid var(--border);border-radius:8px;padding:5px 10px;text-align:center;flex:1\">\n          <div style=\"font-size:.58rem;color:var(--muted);font-weight:700;text-transform:uppercase\">Enviadas</div>\n          <div style=\"font-family:var(--mono);font-weight:700;font-size:.9rem\">".concat(col.contagens_enviadas || 0, "</div>\n        </div>\n        <div style=\"background:").concat(pendentes > 0 ? '#fef2f2' : '#fff', ";border:1px solid ").concat(pendentes > 0 ? '#fecaca' : 'var(--border)', ";border-radius:8px;padding:5px 10px;text-align:center;flex:1\">\n          <div style=\"font-size:.58rem;color:").concat(pendentes > 0 ? 'var(--danger)' : 'var(--muted)', ";font-weight:700;text-transform:uppercase\">Pendentes</div>\n          <div style=\"font-family:var(--mono);font-weight:700;font-size:.9rem;color:").concat(pendentes > 0 ? 'var(--danger)' : 'inherit', "\">").concat(pendentes, "</div>\n        </div>\n      </div>\n      ").concat(isOnline && tempoOnline ? "<div style=\"font-size:.63rem;color:var(--muted);text-align:center;margin-bottom:6px\">\u23F1 Online h\u00E1 ".concat(tempoOnline, "</div>") : '', "\n      ") : '', "\n      <div style=\"font-size:.58rem;color:#94a3b8;margin-bottom:8px;word-break:break-all\">\uD83D\uDD11 ").concat(col.device_id.slice(0, 22), "</div>\n      <div style=\"display:flex;gap:4px;flex-wrap:wrap\">\n        ").concat(ap === 'pendente'
            ? "<button class=\"btn btn-success btn-sm coletor-acao-btn\" style=\"flex:1;font-size:.68rem\" data-acao-coletor=\"aprovar\" data-coletor-id=\"".concat(col.id, "\">\u2705 Aprovar</button>\n             <button class=\"btn btn-danger btn-sm coletor-acao-btn\" style=\"font-size:.68rem\" data-acao-coletor=\"reprovar\" data-coletor-id=\"").concat(col.id, "\">\u274C Reprovar</button>")
            : (ap === 'bloqueado' || ap === 'reprovado')
                ? "<button class=\"btn btn-success btn-sm coletor-acao-btn\" style=\"flex:1;font-size:.68rem\" data-acao-coletor=\"desbloquear\" data-coletor-id=\"".concat(col.id, "\">\uD83D\uDD13 Desbloquear</button>\n             <button class=\"btn btn-danger btn-sm coletor-acao-btn\" style=\"font-size:.68rem\" data-acao-coletor=\"excluir\" data-coletor-id=\"").concat(col.id, "\">\uD83D\uDDD1</button>")
                : "".concat(op && isOnline
                    ? "<button class=\"btn btn-ghost btn-sm coletor-acao-btn\" style=\"flex:1;font-size:.68rem\" data-acao-coletor=\"logout\" data-coletor-id=\"".concat(col.id, "\">\uD83D\uDEAA Logout</button>")
                    : "<span style=\"flex:1\"></span>", "\n             <button class=\"btn btn-warn btn-sm coletor-acao-btn\" style=\"font-size:.68rem\" data-acao-coletor=\"bloquear\" data-coletor-id=\"").concat(col.id, "\">\uD83D\uDEAB Bloquear</button>\n             <button class=\"btn btn-danger btn-sm coletor-acao-btn\" style=\"font-size:.68rem\" data-acao-coletor=\"excluir\" data-coletor-id=\"").concat(col.id, "\">\uD83D\uDDD1</button>"), "\n      </div>\n    </div>");
    }).join('') + "\n    <div style=\"border:2px dashed var(--border);border-radius:14px;padding:14px 16px;min-width:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;opacity:.6\" onclick=\"abrirModalSimularColetor()\">\n      <div style=\"font-size:1.4rem\">\uD83D\uDCF1</div><div style=\"font-size:.75rem;font-weight:600;text-align:center\">Simular novo coletor</div>\n    </div>";
}
function abrirLoginRapidoColetor(colId) {
    abrirModalLoginOperador();
    setTimeout(function () { var s = document.getElementById('lop-coletor-sel'); if (s) {
        s.value = colId;
        verificarColetorDisponivel();
    } }, 100);
}
// ── Tabela detalhada ─────────────────────────────────────────────────
function _renderTabelaColetores(cols) {
    var el = document.getElementById('col-cadastro-wrap');
    if (!cols.length) {
        el.innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDCF1</div><div class=\"empty-title\">Nenhum dispositivo registrado</div>\n      <div class=\"empty-sub\">Os coletores aparecem automaticamente quando um aparelho acessa o sistema</div>\n      <button class=\"btn btn-warn btn-sm coletor-acao-btn\" style=\"margin-top:12px\" onclick=\"abrirModalSimularColetor()\">\uD83E\uDDEA Simular acesso de coletor</button></div>";
        return;
    }
    el.innerHTML = "<div class=\"tbl-wrap\"><table>\n    <thead><tr><th>Coletor</th><th>Device ID</th><th>Status</th><th>Operador Logado</th><th>Login</th><th>Invent\u00E1rio</th><th>\u00DAlt. Atividade</th><th>Enviadas</th><th>Pendentes</th><th>A\u00E7\u00F5es</th></tr></thead>\n    <tbody>".concat(cols.sort(function (a, b) { return a.numero.localeCompare(b.numero); }).map(function (col) {
        var isOnline = col.status === 'online';
        var op = col.sessao;
        var invNomeDisplay = (op === null || op === void 0 ? void 0 : op.inventario_nome) || ((op === null || op === void 0 ? void 0 : op.inventario_id) ? '(inv. ' + op.inventario_id.slice(-6) + ')' : '—');
        var pendentes = col.contagens_pendentes || 0;
        return "<tr>\n        <td><div style=\"font-weight:800;font-family:var(--mono);font-size:.9rem\">".concat(col.nome_exibicao || ('Coletor ' + col.numero), "</div>").concat(col.apelido ? "<div style=\"font-size:.68rem;color:var(--muted)\">".concat(col.apelido, "</div>") : '', "<button data-acao-coletor=\"editar\" data-coletor-id=\"").concat(col.id, "\" style=\"background:none;border:none;cursor:pointer;font-size:.72rem;color:var(--muted);padding:2px 0;margin-top:2px\">\u270F\uFE0F renomear</button></td>\n        <td><span class=\"mono\" style=\"font-size:.62rem;color:var(--muted)\">").concat(col.device_id.slice(0, 18), "\u2026</span></td>\n        <td><span class=\"badge ").concat((col.aprovado || 'pendente') === 'aprovado' ? (isOnline ? 'b-green' : 'b-gray') : (col.aprovado === 'bloqueado' ? 'b-red' : 'b-yellow'), "\">").concat((col.aprovado || 'pendente') === 'aprovado' ? (isOnline ? '🟢 Online' : '✓ Aprovado') : (col.aprovado === 'bloqueado' ? '🚫 Bloqueado' : '⏳ Pendente'), "</span></td>\n        <td>").concat(col.operador_atual ? "<div style=\"font-weight:600;font-size:.82rem\">".concat(col.operador_atual, "</div>").concat(op ? "<div style=\"font-size:.67rem;color:var(--muted)\">Sess\u00E3o ativa</div>" : '') : '<span style="color:var(--muted);font-size:.78rem;font-style:italic">Nenhum</span>', "</td>\n        <td style=\"font-size:.73rem;color:var(--muted)\">").concat(op ? new Date(op.login_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—', "</td>\n        <td style=\"font-size:.78rem\">").concat((op === null || op === void 0 ? void 0 : op.inventario_nome) || '<span style="color:var(--muted)">—</span>', "</td>\n        <td style=\"font-size:.73rem;color:var(--muted)\">").concat(col.ultimo_ping ? new Date(col.ultimo_ping).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—', "</td>\n        <td class=\"mono\" style=\"text-align:center;font-weight:700\">").concat(col.contagens_enviadas || 0, "</td>\n        <td class=\"mono\" style=\"text-align:center\">").concat(pendentes > 0 ? "<span class=\"badge b-red\">".concat(pendentes, "</span>") : '0', "</td>\n        <td><div style=\"display:flex;gap:4px\">\n          ").concat((col.aprovado || 'pendente') === 'pendente'
            ? "<button class=\"btn btn-success btn-sm coletor-acao-btn\" style=\"font-size:.65rem\" data-acao-coletor=\"aprovar\" data-coletor-id=\"".concat(col.id, "\">\u2705 Aprovar</button><button class=\"btn btn-danger btn-sm coletor-acao-btn\" style=\"font-size:.65rem\" data-acao-coletor=\"reprovar\" data-coletor-id=\"").concat(col.id, "\">\u274C Reprovar</button>")
            : (col.aprovado === 'bloqueado' || col.aprovado === 'reprovado')
                ? "<button class=\"btn btn-success btn-sm coletor-acao-btn\" style=\"font-size:.65rem\" data-acao-coletor=\"desbloquear\" data-coletor-id=\"".concat(col.id, "\">\uD83D\uDD13 Desbloquear</button>")
                : "".concat(op && isOnline ? "<button class=\"btn btn-ghost btn-sm coletor-acao-btn\" style=\"font-size:.65rem\" data-acao-coletor=\"logout\" data-coletor-id=\"".concat(col.id, "\">\uD83D\uDEAA Logout</button>") : '', "<button class=\"btn btn-warn btn-sm coletor-acao-btn\" style=\"font-size:.65rem\" data-acao-coletor=\"bloquear\" data-coletor-id=\"").concat(col.id, "\">\uD83D\uDEAB</button>"), "\n          <button class=\"btn btn-danger btn-sm coletor-acao-btn\" style=\"font-size:.68rem\" data-acao-coletor=\"excluir\" data-coletor-id=\"").concat(col.id, "\">\uD83D\uDDD1</button>\n        </div></td>\n      </tr>");
    }).join(''), "</tbody>\n  </table></div>\n  ").concat(window._filaOffline.length > 0 ? "\n    <div class=\"status-box warn\" style=\"margin:12px 16px\">\n      <span class=\"sb-icon\">\u26A0\uFE0F</span>\n      <div><div class=\"sb-text\">".concat(window._filaOffline.length, " contagem(ns) aguardando sincroniza\u00E7\u00E3o</div>\n      <div class=\"sb-sub\">Salvas localmente. Ser\u00E3o enviadas quando a internet voltar.</div></div>\n      <button class=\"btn btn-primary btn-sm\" onclick=\"sincronizarFilaOffline()\">\uD83D\uDD04 Sincronizar agora</button>\n    </div>") : '');
}
function _calcTempoOnline(horaLogin) {
    if (!horaLogin)
        return null;
    var diff = Date.now() - new Date(horaLogin).getTime();
    var min = Math.floor(diff / 60000);
    if (min < 1)
        return 'menos de 1 min';
    if (min < 60)
        return "".concat(min, "min");
    var h = Math.floor(min / 60), m = min % 60;
    return "".concat(h, "h").concat(m > 0 ? " ".concat(m, "min") : '');
}
// ── Editar nome do coletor ────────────────────────────────────────────
function editarNomeColetor(colId) {
    var _this = this;
    var col = state().coletores.find(function (c) { return c.id === colId; });
    if (!col)
        return;
    var nomeAtual = col.nome_exibicao || ('Coletor ' + col.numero);
    // Modal inline
    var modal = document.createElement('div');
    modal.style.cssText = "\n    position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;\n    display:flex;align-items:center;justify-content:center;padding:20px;\n  ";
    modal.innerHTML = "\n    <div style=\"\n      background:#fff;border-radius:14px;padding:24px 22px;\n      max-width:360px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);\n    \">\n      <div style=\"font-weight:800;font-size:1rem;margin-bottom:4px\">\u270F\uFE0F Renomear Coletor</div>\n      <div style=\"font-size:.75rem;color:var(--muted);margin-bottom:16px\">N\u00FAmero: ".concat(col.numero, " \u00B7 ID: ").concat(col.device_id.slice(0, 18), "\u2026</div>\n      <label style=\"font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);display:block;margin-bottom:6px\">Novo nome</label>\n      <input id=\"modal-nome-coletor-input\" type=\"text\" value=\"").concat(nomeAtual, "\"\n        style=\"width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;\n               font-size:.95rem;font-family:var(--sans);outline:none;margin-bottom:16px\"\n        placeholder=\"Ex: Coletor C\u00E2mara Fria\"\n        onfocus=\"this.style.borderColor='var(--orange)'\"\n        onblur=\"this.style.borderColor='var(--border)'\"\n      />\n      <div style=\"display:flex;gap:8px\">\n        <button id=\"btn-modal-cancelar-nome\" style=\"\n          flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);\n          background:transparent;color:var(--muted);font-size:.85rem;cursor:pointer;font-family:var(--sans)\n        \">Cancelar</button>\n        <button id=\"btn-modal-salvar-nome\" style=\"\n          flex:1;padding:10px;border-radius:8px;border:none;\n          background:var(--orange);color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;font-family:var(--sans)\n        \">\uD83D\uDCBE Salvar</button>\n      </div>\n    </div>");
    document.body.appendChild(modal);
    var input = document.getElementById('modal-nome-coletor-input');
    input.focus();
    input.select();
    var fechar = function () { return modal.remove(); };
    document.getElementById('btn-modal-cancelar-nome').onclick = fechar;
    modal.addEventListener('click', function (e) { if (e.target === modal)
        fechar(); });
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter')
            document.getElementById('btn-modal-salvar-nome').click();
        if (e.key === 'Escape')
            fechar();
    });
    document.getElementById('btn-modal-salvar-nome').onclick = function () { return __awaiter(_this, void 0, void 0, function () {
        var novoNome, btn, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    novoNome = input.value.trim();
                    if (!novoNome) {
                        input.style.borderColor = 'var(--danger)';
                        input.focus();
                        return [2 /*return*/];
                    }
                    btn = document.getElementById('btn-modal-salvar-nome');
                    btn.disabled = true;
                    btn.textContent = 'Salvando…';
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    // Salvar no Firestore
                    return [4 /*yield*/, FS_AN.collection('dt_coletores').doc(colId).update({
                            nome_exibicao: novoNome,
                            nome_coletor: novoNome, // compatibilidade com o coletor.html
                        })];
                case 2:
                    // Salvar no Firestore
                    _a.sent();
                    // Atualizar DB local
                    col.nome_exibicao = novoNome;
                    col.nome_coletor = novoNome;
                    salvarDB_coletores();
                    fechar();
                    renderColetores();
                    showToast("\u270F\uFE0F Coletor renomeado para \"".concat(novoNome, "\""), 's');
                    logAuditoria('SISTEMA', "Coletor ".concat(col.numero, " renomeado para \"").concat(novoNome, "\""), { id: colId });
                    return [3 /*break*/, 4];
                case 3:
                    e_2 = _a.sent();
                    // Se offline, salva só local e marca para sync
                    col.nome_exibicao = novoNome;
                    col.nome_coletor = novoNome;
                    salvarDB_coletores();
                    fechar();
                    renderColetores();
                    showToast("\u270F\uFE0F Nome salvo localmente (sincronizar\u00E1 quando online)", 'w');
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    }); };
}
(function () {
    // ── Guarda de segurança: expõe processFileAuditoria imediatamente ──
    // Caso o IIFE lance erro antes de chegar na definição real (linha ~748),
    // o input[onchange] do HTML não ficará com ReferenceError.
    window.processFileAuditoria = window.processFileAuditoria || function (file) {
        if (!file)
            return;
        // Aguarda 300ms para o script terminar de executar e tenta de novo
        setTimeout(function () {
            if (typeof window._processFileAuditoriaReal === 'function') {
                window._processFileAuditoriaReal(file);
            }
            else {
                if (typeof showToast === 'function')
                    showToast('Módulo de auditoria ainda carregando. Tente novamente.', 'w');
            }
        }, 300);
    };
    window.esc = window.esc || function (s) {
        try {
            return (typeof escapeHTML === 'function') ? escapeHTML(String(s !== null && s !== void 0 ? s : '')) : String(s !== null && s !== void 0 ? s : '');
        }
        catch (e) {
            return String(s !== null && s !== void 0 ? s : '');
        }
    };
    var __origStorageSave = window.storageSave;
    if (typeof __origStorageSave === 'function') {
        window.storageSave = function (key, data) {
            return __origStorageSave(key, data);
        };
    }
    function __aClean(v) { return String(v == null ? '' : v).replace(/^\uFEFF/, '').replace(/[\r\n]+/g, ' ').trim(); }
    function __aAlias(v) { return __aClean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_'); }
    function __aGet(row, aliases) {
        var want = new Set((aliases || []).map(__aAlias));
        for (var _i = 0, _a = Object.keys(row || {}); _i < _a.length; _i++) {
            var k = _a[_i];
            if (want.has(__aAlias(k)))
                return row[k];
        }
        return '';
    }
    function __aSep(line) {
        var s = String(line || '');
        var cands = [';', '	', ',', '|'];
        var best = ';', score = -1;
        for (var _i = 0, cands_1 = cands; _i < cands_1.length; _i++) {
            var c = cands_1[_i];
            var n = s.split(c).length;
            if (n > score) {
                score = n;
                best = c;
            }
        }
        return best;
    }
    function __aCSV(line, sep) {
        var out = [];
        var cur = '';
        var q = false;
        line = String(line || '');
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') {
                if (q && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                }
                else
                    q = !q;
            }
            else if (ch === sep && !q) {
                out.push(cur);
                cur = '';
            }
            else
                cur += ch;
        }
        out.push(cur);
        return out.map(__aClean);
    }
    function __aAddress(row) {
        return __aClean(__aGet(row, [
            'endereco_logistico_descritivo', 'endereco_logistico_key', 'end_logistico',
            'localizacao', 'localizacao_estoque', 'endereco', 'endereço', 'codigo_endereco',
            'cod_endereco', 'cod_end', 'end', 'address'
        ])).toUpperCase();
    }
    function __aLocal(row) {
        return __aClean(__aGet(row, [
            'descricao_local_estoque', 'local_de_estoque', 'local_estoque',
            'deposito', 'depósito', 'armazem', 'armazém', 'local'
        ]));
    }
    function __aDate(v) {
        v = __aClean(v);
        if (!v)
            return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(v))
            return v.slice(0, 10);
        return v;
    }
    function __aPick(row, aliases) {
        var val = __aGet(row, aliases);
        return __aClean(val);
    }
    function __aIsBarcodeLike(v) { return /^\d{13,14}$/.test(String(v || '').replace(/\D/g, '')); }
    function __aItem(row) {
        // Mapeamento da Auditoria por nome de coluna, não por posição.
        // Assim cada dado cai na coluna correta mesmo que a planilha venha reordenada.
        var codigoProduto = __aPick(row, [
            'produto_key', 'produto_caixa_key', 'codigo_produto', 'cod_produto', 'codigo_item',
            'cod_item', 'item_key', 'codigo', 'código', 'sku', 'cod', 'item'
        ]);
        var descricaoProduto = __aPick(row, [
            'descricao_ficha_estq_detalhe', 'descricao_produto', 'desc_produto', 'nome_produto',
            'produto', 'descricao_item', 'descrição_item', 'descricao', 'descrição', 'description', 'desc',
            'nome_abreviado'
        ]);
        var rawDun = __aPick(row, [
            'dun', 'dun14', 'dun_14', 'cod_dun', 'codigo_dun', 'codigo_barras_dun',
            'dun_produto', 'gtin14', 'gtin_14', 'ean14', 'ean_14',
            'quantidade_dun', 'qtd_dun', 'qtde_dun', 'dun_produto_key'
        ]);
        var rawGtin = __aPick(row, [
            'gtin', 'ean', 'ean13', 'ean_13', 'barcode', 'codigo_barras', 'cod_barras'
        ]);
        var capaPalete = __aPick(row, [
            'palete_key', 'palete', 'pallet_key', 'capa_palete', 'capa', 'capa_pallet',
            'pallete_ou_capa', 'pallete', 'pallet', 'numero_palete', 'num_palete'
        ]);
        var dataValidade = __aDate(__aGet(row, [
            'data_de_validade', 'data_validade', 'validade', 'dt_validade', 'vencimento',
            'data', 'dt', 'bb'
        ]));
        var rawQtd = __aPick(row, [
            'estoque_total_unidades', 'estoque_unidades', 'total_unidades_estoque',
            'quantidade_enderecada', 'qtd_enderecada', 'quantidade_estoque', 'qtd_estoque',
            'quantidade_esperada', 'qtd_esperada', 'saldo_estoque', 'saldo', 'saldo_erp',
            'qtd_sistema', 'estoque_total', 'total_unidades', 'quantidade', 'qtd', 'qtde', 'qty',
            'estoque'
        ]);
        var codigoPareceDun = __aIsBarcodeLike(codigoProduto);
        var qtdPareceDun = __aIsBarcodeLike(rawQtd);
        var dunFinal = rawDun || (codigoPareceDun ? codigoProduto : '');
        var gtinFinal = (!dunFinal && rawGtin && !codigoPareceDun) ? rawGtin : rawGtin;
        var capaFinal = (dunFinal && capaPalete.replace(/\s/g, '') === dunFinal.replace(/\s/g, '')) ? '' : capaPalete;
        var qtdFinal = qtdPareceDun ? '' : rawQtd;
        return {
            codigo_produto: codigoPareceDun ? '' : codigoProduto,
            produto_nome: descricaoProduto,
            gtin: gtinFinal,
            capa_palete: capaFinal,
            data: dataValidade,
            dun: dunFinal,
            quantidade_estoque: qtdFinal,
            quantidade: qtdFinal,
            quantidade_dun: qtdFinal
        };
    }
    function __aSig(items) {
        var norm = window._audNorm || (function (v) { return String(v || '').trim().toUpperCase(); });
        return (items || []).map(function (it) { return [norm(it.codigo_produto), norm(it.produto_nome), norm(it.dun), norm(it.capa_palete), norm(it.data), String((it.quantidade || it.quantidade_dun) || '').trim()].join('|'); }).sort().join('||');
    }
    function __aRua(row, endereco, endCad) {
        var direta = __aClean(__aGet(row, ['rua', 'logradouro', 'setor_armazenagem', 'descricao_setor_armazenagem', 'corredor']));
        if (direta)
            return direta;
        if (endCad && endCad.rua)
            return __aClean(endCad.rua);
        var end = __aClean(endereco).toUpperCase();
        var parts = end.split('.').filter(Boolean);
        if (parts.length >= 4)
            return parts[3];
        if (parts.length >= 2)
            return parts[1];
        return '';
    }
    function __aGroup(rows, info) {
        var normEnd = window._audEnderecoNorm || (function (v) { return String(v || '').replace(/[^A-Z0-9]/g, ''); });
        var lista = [];
        (rows || []).forEach(function (r, idx) {
            var _a;
            var endereco = __aAddress(r);
            var endNorm = normEnd(endereco);
            if (!endNorm)
                return;
            var endCad = (state().enderecosLista || []).find(function (e) { return normEnd(e.endereco) === endNorm; }) || {};
            var item = __aItem(r);
            // IMPORTANTE:
            // A auditoria deve gerar uma linha por produto.
            // Mesmo que o endereço se repita, não agrupamos vários produtos
            // dentro do mesmo registro/endereço, porque a tela deve exibir
            // o endereço novamente para cada produto.
            var prodKey = [
                item.codigo_produto,
                item.produto_nome,
                item.dun,
                item.capa_palete,
                item.data,
                item.quantidade_estoque || item.quantidade_dun,
                idx
            ].map(function (v) { return String(v || '').replace(/[^A-Z0-9]/gi, '').toUpperCase(); }).join('__');
            lista.push({
                id: "".concat(info.auditoria_id, "__").concat(endNorm, "__").concat(prodKey || idx),
                auditoria_id: info.auditoria_id,
                auditoria_nome: info.auditoria_nome,
                endereco: endereco,
                endereco_norm: endNorm,
                rua: __aRua(r, endereco, endCad),
                itens: [item],
                itens_confirmados: [],
                status: 'PENDENTE',
                importado_em: new Date().toISOString(),
                importado_por: ((_a = window._currentAnalistaUser) === null || _a === void 0 ? void 0 : _a.email) || 'analista',
                batch_id: window.audBatchId,
                confirmado_em: '',
                confirmado_por: '',
                com_ajuste: false,
                reaberto_por_alteracao_base: false,
                liberada_coletor: false,
                disponivel_coletor: false,
                origem: 'IMPORTACAO_AUDITORIA_STANDALONE',
                local_estoque_auditoria: __aLocal(r)
            });
        });
        return lista.map(function (g) { return (__assign(__assign({}, g), { assinatura_base: __aSig(g.itens) })); });
    }
    window._audFormatRua = function (row, endCad, endereco) { return __aRua(row, endereco, endCad); };
    window._audGetLocalEstoque = function (row) { return __aLocal(row); };
    window._audRowsFiltradasPorLocal = function (rows) {
        var _a;
        var filtro = ((_a = document.getElementById('aud-op-local-estoque')) === null || _a === void 0 ? void 0 : _a.value) || '';
        return !filtro ? (rows || []) : (rows || []).filter(function (r) { return __aLocal(r) === filtro; });
    };
    window._audMontarSelectLocal = function (rows) {
        var sel = document.getElementById('aud-op-local-estoque');
        if (!sel)
            return;
        var atual = sel.value || '';
        var locais = __spreadArray([], new Set((rows || []).map(__aLocal).filter(Boolean)), true).sort(function (a, b) { return String(a).localeCompare(String(b)); });
        sel.innerHTML = '<option value="">Todos</option>' + locais.map(function (v) { return "<option value=\"".concat(String(v).replace(/"/g, '&quot;'), "\">").concat(window.esc(v), "</option>"); }).join('');
        if (atual && locais.includes(atual))
            sel.value = atual;
    };
    var esc2 = function (v) { return window.esc(v == null ? '' : String(v)); };
    var statusLabel = function (st) {
        var s = String(st || 'PENDENTE').trim().toUpperCase();
        if (s === 'CONFIRMADO_SEM_AJUSTE')
            return 'Confirmado';
        if (s === 'CONFIRMADO_COM_AJUSTE')
            return 'Confirmado c/ ajuste';
        if (s === 'REABERTO_ALTERACAO_BASE')
            return 'Reaberto';
        if (s === 'LIBERADA' || s === 'LIBERADO')
            return 'Liberada';
        return 'Pendente';
    };
    var statusBadge = function (st) {
        var s = String(st || 'PENDENTE').trim().toUpperCase();
        if (s === 'CONFIRMADO_SEM_AJUSTE')
            return 'b-green';
        if (s === 'CONFIRMADO_COM_AJUSTE')
            return 'b-yellow';
        if (s === 'REABERTO_ALTERACAO_BASE')
            return 'b-orange';
        if (s === 'LIBERADA' || s === 'LIBERADO')
            return 'b-blue';
        return 'b-gray';
    };
    var availableAudits = function () {
        var grupos = new Map();
        (state().auditorias || []).forEach(function (a) {
            var id = String((a === null || a === void 0 ? void 0 : a.auditoria_id) || '').trim();
            if (!id)
                return;
            if (!grupos.has(id))
                grupos.set(id, { id: id, nome: a.auditoria_nome || a.base_arquivo || id, ts: a.importado_em || '' });
        });
        (state().auditoria_metas || []).forEach(function (m) {
            var id = String((m === null || m === void 0 ? void 0 : m.auditoria_id) || (m === null || m === void 0 ? void 0 : m.id) || '').trim();
            if (!id)
                return;
            grupos.set(id, { id: id, nome: m.auditoria_nome || m.nome || id, ts: m.importado_em || m.updated_at || '' });
        });
        (state().auditoria_imports || []).forEach(function (i) {
            var id = String((i === null || i === void 0 ? void 0 : i.auditoria_id) || '').trim();
            if (!id)
                return;
            if (!grupos.has(id))
                grupos.set(id, { id: id, nome: i.auditoria_nome || i.arquivo || id, ts: i.importado_em || '' });
        });
        return __spreadArray([], grupos.values(), true).sort(function (a, b) { return String(b.ts || '').localeCompare(String(a.ts || '')); });
    };
    var auditId = function () {
        var _a;
        var selVal = String(((_a = document.getElementById('aud-op-auditoria')) === null || _a === void 0 ? void 0 : _a.value) || '').trim();
        if (selVal)
            return selVal;
        var savedVal = String(window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '').trim();
        if (savedVal)
            return savedVal;
        var manual = String(window.__auditoriaNomeManual || '').trim();
        if (manual)
            return manual;
        return 'AUD-' + Date.now();
    };
    var auditName = function () {
        var _a, _b;
        var sel = document.getElementById('aud-op-auditoria');
        var txt = String(((_b = (_a = sel === null || sel === void 0 ? void 0 : sel.selectedOptions) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.textContent) || '').trim();
        if (txt && txt !== 'Selecione…')
            return txt;
        var saved = String(window.__auditoriaNomeManual || window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '').trim();
        if (saved)
            return saved;
        return auditId();
    };
    var selectedLocalRows = function (rows) {
        return window._audRowsFiltradasPorLocal(Array.isArray(rows) ? rows : []);
    };
    var groupRows = function (rows, info) {
        return __aGroup(Array.isArray(rows) ? rows : [], info || {});
    };
    window.mountLocalSelect = function (rows) {
        return window._audMontarSelectLocal(Array.isArray(rows) ? rows : []);
    };
    var audBatchId = window.audBatchId || ('AUDBATCH-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase());
    window.audBatchId = audBatchId;
    window._popularSelectAuditorias = function () {
        var sel = document.getElementById('aud-op-auditoria');
        if (!sel)
            return;
        var atual = sel.value || '';
        var grupos = new Map();
        (state().auditorias || []).forEach(function (a) {
            var id = String(a.auditoria_id || '').trim();
            if (!id)
                return;
            if (!grupos.has(id))
                grupos.set(id, { id: id, nome: a.auditoria_nome || a.base_arquivo || id, ts: a.importado_em || '' });
        });
        (state().auditoria_metas || []).forEach(function (m) {
            var id = String(m.auditoria_id || m.id || '').trim();
            if (!id)
                return;
            grupos.set(id, { id: id, nome: m.auditoria_nome || m.nome || id, ts: m.importado_em || m.updated_at || '' });
        });
        (state().auditoria_imports || []).forEach(function (i) {
            var id = String(i.auditoria_id || '').trim();
            if (!id)
                return;
            if (!grupos.has(id))
                grupos.set(id, { id: id, nome: i.auditoria_nome || i.arquivo || id, ts: i.importado_em || '' });
        });
        var lista = __spreadArray([], grupos.values(), true).sort(function (a, b) { return String(b.ts || '').localeCompare(String(a.ts || '')); });
        sel.innerHTML = '<option value="">Selecione…</option>' + lista.map(function (x) { return "<option value=\"".concat(x.id, "\">").concat(window.esc(x.nome || x.id), "</option>"); }).join('');
        if (atual && __spreadArray([], sel.options, true).some(function (o) { return o.value === atual; }))
            sel.value = atual;
        else if (!sel.value && lista.length === 1)
            sel.value = lista[0].id;
    };
    var __audImportando = false;
    var AUDITORIA_UI_STATE_KEY = 'dt_auditoria_ui_state_v2';
    function loadAuditoriaUiState() {
        try {
            var raw = localStorage.getItem(AUDITORIA_UI_STATE_KEY);
            return raw ? JSON.parse(raw) : {};
        }
        catch (e) {
            return {};
        }
    }
    function saveAuditoriaUiState(extra) {
        try {
            var base = loadAuditoriaUiState();
            var next = __assign(__assign(__assign({}, base), extra), { updated_at: new Date().toISOString() });
            localStorage.setItem(AUDITORIA_UI_STATE_KEY, JSON.stringify(next));
            return next;
        }
        catch (e) {
            return null;
        }
    }
    function hydrateAuditoriaUiState() {
        var state = loadAuditoriaUiState();
        if (!window.__ultimaAuditoriaSelecionada && state.auditoria_id)
            window.__ultimaAuditoriaSelecionada = state.auditoria_id;
        if (!window.__ultimaAuditoriaImportada && state.auditoria_id)
            window.__ultimaAuditoriaImportada = state.auditoria_id;
        if (!window.__auditoriaNomeManual && state.auditoria_nome)
            window.__auditoriaNomeManual = state.auditoria_nome;
    }
    function _deleteCollectionDocs(collRef) {
        return __awaiter(this, void 0, void 0, function () {
            var snap, total, _loop_1, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, collRef.get()];
                    case 1:
                        snap = _a.sent();
                        if (!snap || snap.empty)
                            return [2 /*return*/, 0];
                        total = 0;
                        _loop_1 = function (i) {
                            var batch;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        batch = FS_AN.batch();
                                        snap.docs.slice(i, i + 300).forEach(function (doc) { return batch.delete(doc.ref); });
                                        return [4 /*yield*/, batch.commit()];
                                    case 1:
                                        _b.sent();
                                        total += Math.min(300, snap.docs.length - i);
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < snap.docs.length)) return [3 /*break*/, 5];
                        return [5 /*yield**/, _loop_1(i)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        i += 300;
                        return [3 /*break*/, 2];
                    case 5: return [2 /*return*/, total];
                }
            });
        });
    }
    function buildAuditoriaMeta(auditoriaId, auditoriaNome, lista, importMeta, extra) {
        var _a, _b, _c, _d;
        var rows = Array.isArray(lista) ? lista : [];
        var lojas = __spreadArray([], new Set(rows.map(function (r) { return String(r.local_estoque_auditoria || '').trim(); }).filter(Boolean)), true).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
        var ts = new Date().toISOString();
        return __assign({ auditoria_id: auditoriaId, auditoria_nome: auditoriaNome || auditoriaId, total_registros: rows.length, total_pendentes: rows.filter(function (r) { return String(r.status || 'PENDENTE').toUpperCase() === 'PENDENTE'; }).length, total_confirmados_sem_ajuste: rows.filter(function (r) { return String(r.status || '').toUpperCase() === 'CONFIRMADO_SEM_AJUSTE'; }).length, total_confirmados_com_ajuste: rows.filter(function (r) { return String(r.status || '').toUpperCase() === 'CONFIRMADO_COM_AJUSTE'; }).length, total_reabertos: rows.filter(function (r) { return String(r.status || '').toUpperCase() === 'REABERTO_ALTERACAO_BASE'; }).length, lojas: lojas, importado_em: (importMeta === null || importMeta === void 0 ? void 0 : importMeta.importado_em) || ((_a = rows[0]) === null || _a === void 0 ? void 0 : _a.importado_em) || ts, importado_por: (importMeta === null || importMeta === void 0 ? void 0 : importMeta.importado_por) || ((_b = rows[0]) === null || _b === void 0 ? void 0 : _b.importado_por) || (((_c = window._currentAnalistaUser) === null || _c === void 0 ? void 0 : _c.email) || 'analista'), arquivo: (importMeta === null || importMeta === void 0 ? void 0 : importMeta.arquivo) || window._auditoriaImportFileName || '', origem: (importMeta === null || importMeta === void 0 ? void 0 : importMeta.origem) || ((_d = rows[0]) === null || _d === void 0 ? void 0 : _d.origem) || 'IMPORTACAO_AUDITORIA_STANDALONE', batch_id: (importMeta === null || importMeta === void 0 ? void 0 : importMeta.batch_id) || window.audBatchId || '', base_chunks: Math.ceil(rows.length / 1000) || 0, updated_at: ts }, extra);
    }
    function publishAuditoriaToFirestore(lista, importMeta) {
        return __awaiter(this, void 0, void 0, function () {
            var auditoriaId, auditoriaNome, audRef, endRef, chunkRef, chunkSize, _loop_2, i;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        if (!navigator.onLine || typeof FS_AN === 'undefined' || !FS_AN || !Array.isArray(lista) || !lista.length)
                            return [2 /*return*/, false];
                        auditoriaId = String((importMeta === null || importMeta === void 0 ? void 0 : importMeta.auditoria_id) || ((_a = lista[0]) === null || _a === void 0 ? void 0 : _a.auditoria_id) || '').trim();
                        if (!auditoriaId)
                            throw new Error('auditoria_id ausente');
                        auditoriaNome = String((importMeta === null || importMeta === void 0 ? void 0 : importMeta.auditoria_nome) || ((_b = lista[0]) === null || _b === void 0 ? void 0 : _b.auditoria_nome) || auditoriaId).trim();
                        audRef = FS_AN.collection('dt_auditorias').doc(auditoriaId);
                        endRef = audRef.collection('enderecos');
                        chunkRef = audRef.collection('base_chunks');
                        return [4 /*yield*/, audRef.set(buildAuditoriaMeta(auditoriaId, auditoriaNome, lista, importMeta, {
                                liberada_coletor: lista.some(function (x) { return x.liberada_coletor === true; }),
                                disponivel_coletor: lista.some(function (x) { return x.disponivel_coletor !== false; })
                            }), { merge: true })];
                    case 1:
                        _c.sent();
                        return [4 /*yield*/, Promise.all([
                                _deleteCollectionDocs(endRef),
                                _deleteCollectionDocs(chunkRef)
                            ])];
                    case 2:
                        _c.sent();
                        chunkSize = 1000;
                        _loop_2 = function (i) {
                            var fatia, batch;
                            return __generator(this, function (_d) {
                                switch (_d.label) {
                                    case 0:
                                        fatia = lista.slice(i, i + chunkSize);
                                        batch = FS_AN.batch();
                                        fatia.forEach(function (item) {
                                            batch.set(endRef.doc(String(item.id || "".concat(auditoriaId, "__").concat(i))), __assign(__assign({}, item), { auditoria_id: auditoriaId, auditoria_nome: auditoriaNome, salvo_em: new Date() }), { merge: true });
                                        });
                                        batch.set(chunkRef.doc("chunk_".concat(String(i / chunkSize).padStart(4, '0'))), {
                                            auditoria_id: auditoriaId,
                                            auditoria_nome: auditoriaNome,
                                            parte: i / chunkSize,
                                            total_partes: Math.ceil(lista.length / chunkSize),
                                            total_registros: fatia.length,
                                            dados: fatia,
                                            salvo_em: new Date()
                                        }, { merge: true });
                                        return [4 /*yield*/, batch.commit()];
                                    case 1:
                                        _d.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _c.label = 3;
                    case 3:
                        if (!(i < lista.length)) return [3 /*break*/, 6];
                        return [5 /*yield**/, _loop_2(i)];
                    case 4:
                        _c.sent();
                        _c.label = 5;
                    case 5:
                        i += chunkSize;
                        return [3 /*break*/, 3];
                    case 6:
                        if (!importMeta) return [3 /*break*/, 8];
                        return [4 /*yield*/, FS_AN.collection('dt_auditoria_imports').doc(String(importMeta.id || ('AUDIMP-' + Date.now()))).set(__assign(__assign({}, importMeta), { salvo_em: new Date() }), { merge: true })];
                    case 7:
                        _c.sent();
                        _c.label = 8;
                    case 8: return [2 /*return*/, true];
                }
            });
        });
    }
    function _listarAuditoriasMeta() {
        return __awaiter(this, arguments, void 0, function (limit) {
            var snap;
            if (limit === void 0) { limit = 50; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (typeof window.getDTLojaAtiva === 'function' && !window.getDTLojaAtiva())
                            return [2 /*return*/, []];
                        return [4 /*yield*/, FS_AN.collection('dt_auditorias').limit(limit).get()];
                    case 1:
                        snap = _a.sent();
                        return [2 /*return*/, (snap.docs || []).map(function (doc) { return (__assign({ id: doc.id }, doc.data())); })];
                }
            });
        });
    }
    function _auditoriaPodeAcessarFirestore() {
        var autenticado = false;
        try {
            autenticado = !!((typeof AUTH_AN !== 'undefined' && AUTH_AN && AUTH_AN.currentUser) ||
                (window.firebase && window.firebase.auth && window.firebase.auth().currentUser));
        }
        catch (_) {
            autenticado = false;
        }
        if (!autenticado)
            return false;
        if (typeof window.getDTLojaAtiva === 'function' && !window.getDTLojaAtiva())
            return false;
        return true;
    }
    function reloadAuditoriaFromFirestore(preferredAuditoriaId) {
        return __awaiter(this, void 0, void 0, function () {
            var auditoriaId_1, imports, metas, auditorias, _a, metaSnap, endSnap, impSnap, _b, metaDocs, impSnap, atuaisAuditorias, atuaisImports, atuaisMetas, existemDadosRemotos, e_3;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        if (!navigator.onLine || typeof FS_AN === 'undefined' || !FS_AN)
                            return [2 /*return*/, false];
                        if (!_auditoriaPodeAcessarFirestore()) {
                            console.info('[AUDITORIA] Recarga adiada: autenticação ou loja ainda não disponível.');
                            return [2 /*return*/, false];
                        }
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 6, , 7]);
                        auditoriaId_1 = String(preferredAuditoriaId || '').trim();
                        imports = [];
                        metas = [];
                        auditorias = [];
                        if (!auditoriaId_1) return [3 /*break*/, 3];
                        return [4 /*yield*/, Promise.all([
                                FS_AN.collection('dt_auditorias').doc(auditoriaId_1).get(),
                                FS_AN.collection('dt_auditorias').doc(auditoriaId_1).collection('enderecos').get(),
                                FS_AN.collection('dt_auditoria_imports').where('auditoria_id', '==', auditoriaId_1).limit(20).get().catch(function () { return ({ docs: [] }); })
                            ])];
                    case 2:
                        _a = _c.sent(), metaSnap = _a[0], endSnap = _a[1], impSnap = _a[2];
                        metas = metaSnap.exists ? [__assign({ id: metaSnap.id }, metaSnap.data())] : [];
                        auditorias = (endSnap.docs || []).map(function (doc) { return (__assign({ id: doc.id }, doc.data())); });
                        imports = (impSnap.docs || []).map(function (doc) { return (__assign({ id: doc.id }, doc.data())); });
                        return [3 /*break*/, 5];
                    case 3: return [4 /*yield*/, Promise.all([
                            _listarAuditoriasMeta(50),
                            FS_AN.collection('dt_auditoria_imports').limit(50).get().catch(function () { return ({ docs: [] }); })
                        ])];
                    case 4:
                        _b = _c.sent(), metaDocs = _b[0], impSnap = _b[1];
                        metas = metaDocs;
                        imports = (impSnap.docs || []).map(function (doc) { return (__assign({ id: doc.id }, doc.data())); });
                        _c.label = 5;
                    case 5:
                        imports = imports.sort(function (a, b) { return String(b.importado_em || '').localeCompare(String(a.importado_em || '')); });
                        atuaisAuditorias = Array.isArray(state().auditorias) ? state().auditorias : [];
                        atuaisImports = Array.isArray(state().auditoria_imports) ? state().auditoria_imports : [];
                        atuaisMetas = Array.isArray(state().auditoria_metas) ? state().auditoria_metas : [];
                        if (auditoriaId_1) {
                            existemDadosRemotos = (auditorias && auditorias.length) || (metas && metas.length) || (imports && imports.length);
                            // Não apaga a Auditoria já carregada/local quando o Firestore não retorna dados.
                            // Isso preserva bases importadas antes do ajuste ou quando o usuário está offline/sem sync completo.
                            if (!existemDadosRemotos) {
                                console.warn('[AUDITORIA] Nenhum dado remoto encontrado; mantendo auditoria local carregada:', auditoriaId_1);
                                window.__ultimaAuditoriaSelecionada = auditoriaId_1;
                                window.__ultimaAuditoriaImportada = auditoriaId_1;
                                saveAuditoriaUiState({
                                    auditoria_id: auditoriaId_1,
                                    auditoria_nome: window.__auditoriaNomeManual || '',
                                    ultimo_sync_em: new Date().toISOString()
                                });
                                return [2 /*return*/, false];
                            }
                            window.AnalistaState.batch([
                                window.AnalistaActions.replaceSlice('auditorias', __spreadArray(__spreadArray([], atuaisAuditorias.filter(function (a) { return String((a === null || a === void 0 ? void 0 : a.auditoria_id) || '') !== auditoriaId_1; }), true), auditorias, true), { source: 'auditoria-import' }),
                                window.AnalistaActions.replaceSlice('auditoria_imports', __spreadArray(__spreadArray([], imports, true), atuaisImports.filter(function (i) { return String((i === null || i === void 0 ? void 0 : i.auditoria_id) || '') !== auditoriaId_1; }), true).sort(function (a, b) { return String(b.importado_em || '').localeCompare(String(a.importado_em || '')); }), { source: 'auditoria-import' }),
                                window.AnalistaActions.replaceSlice('auditoria_metas', __spreadArray(__spreadArray([], atuaisMetas.filter(function (m) { return String((m === null || m === void 0 ? void 0 : m.auditoria_id) || (m === null || m === void 0 ? void 0 : m.id) || '') !== auditoriaId_1; }), true), metas, true), { source: 'auditoria-import' })
                            ]);
                            window.__ultimaAuditoriaSelecionada = auditoriaId_1;
                            window.__ultimaAuditoriaImportada = auditoriaId_1;
                        }
                        else {
                            window.AnalistaState.batch([
                                window.AnalistaActions.replaceSlice('auditoria_imports', imports, { source: 'auditoria-import' }),
                                window.AnalistaActions.replaceSlice('auditoria_metas', metas, { source: 'auditoria-import' }),
                                window.AnalistaActions.replaceSlice('auditorias', Array.isArray(state().auditorias) ? state().auditorias : [], { source: 'auditoria-import' })
                            ]);
                        }
                        saveAuditoriaUiState({
                            auditoria_id: auditoriaId_1 || window.__ultimaAuditoriaSelecionada || '',
                            auditoria_nome: window.__auditoriaNomeManual || '',
                            ultimo_sync_em: new Date().toISOString()
                        });
                        return [2 /*return*/, true];
                    case 6:
                        e_3 = _c.sent();
                        console.warn('[AUDITORIA] Falha ao recarregar Firestore:', (e_3 === null || e_3 === void 0 ? void 0 : e_3.message) || e_3);
                        return [2 /*return*/, false];
                    case 7: return [2 /*return*/];
                }
            });
        });
    }
    function __parseCsvRows(text) {
        var lines = String(text || '').split(/\r?\n/).filter(function (l) { return String(l).trim(); });
        if (!lines.length)
            return [];
        var sep = __aSep(lines[0]);
        var header = __aCSV(lines.shift(), sep);
        return lines.map(function (line) {
            var cols = __aCSV(line, sep);
            var row = {};
            header.forEach(function (h, i) { var _a; return row[String(h || '').trim()] = (_a = cols[i]) !== null && _a !== void 0 ? _a : ''; });
            return row;
        });
    }
    function __readRowsFromFile(file) {
        return __awaiter(this, void 0, void 0, function () {
            var name, text, buf, wb, ws;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        name = String((file === null || file === void 0 ? void 0 : file.name) || '').toLowerCase();
                        if (!file)
                            return [2 /*return*/, []];
                        if (!name.endsWith('.csv')) return [3 /*break*/, 2];
                        return [4 /*yield*/, file.text()];
                    case 1:
                        text = _a.sent();
                        return [2 /*return*/, __parseCsvRows(text)];
                    case 2: return [4 /*yield*/, file.arrayBuffer()];
                    case 3:
                        buf = _a.sent();
                        wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true, raw: false });
                        ws = wb.Sheets[wb.SheetNames[0]];
                        return [2 /*return*/, XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })];
                }
            });
        });
    }
    window.processFileAuditoria = window._processFileAuditoriaReal = function (file) {
        return __awaiter(this, void 0, void 0, function () {
            var rows, status_1, locais, actionsPanel, e_4;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!file)
                            return [2 /*return*/];
                        if (__audImportando)
                            return [2 /*return*/];
                        __audImportando = true;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, __readRowsFromFile(file)];
                    case 2:
                        rows = _a.sent();
                        if (!Array.isArray(rows) || !rows.length) {
                            showToast('Arquivo sem linhas válidas para auditoria', 'w');
                            return [2 /*return*/];
                        }
                        window._auditoriaImportPreview = rows;
                        window._auditoriaImportFileName = file.name || 'auditoria';
                        if (!window.__auditoriaNomeManual)
                            window.__auditoriaNomeManual = String(file.name || 'Auditoria').replace(/\.[^.]+$/, '');
                        if (typeof window.mountLocalSelect === 'function')
                            window.mountLocalSelect(rows);
                        status_1 = document.getElementById('auditoria-import-status');
                        if (status_1) {
                            locais = __spreadArray([], new Set(rows.map(function (r) { return __aLocal(r); }).filter(Boolean)), true);
                            status_1.innerHTML = "<div class=\"status-box ok\"><div class=\"sb-icon\">\uD83D\uDCC2</div><div><div class=\"sb-text\">Arquivo carregado: ".concat(esc2(file.name || ''), "</div><div class=\"sb-sub\">").concat(rows.length, " linha(s) \u00B7 ").concat(locais.length, " local(is) identificado(s)</div></div></div>");
                        }
                        actionsPanel = document.getElementById('auditoria-import-actions');
                        if (actionsPanel)
                            actionsPanel.style.display = 'flex';
                        showToast('Arquivo carregado — processando auditoria...', 's');
                        // Confirmar importação automaticamente após carregar o arquivo
                        setTimeout(function () { return __awaiter(_this, void 0, void 0, function () {
                            var e_5;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        _a.trys.push([0, 3, , 4]);
                                        if (!(typeof window.confirmarImportAuditoria === 'function')) return [3 /*break*/, 2];
                                        return [4 /*yield*/, window.confirmarImportAuditoria()];
                                    case 1:
                                        _a.sent();
                                        _a.label = 2;
                                    case 2: return [3 /*break*/, 4];
                                    case 3:
                                        e_5 = _a.sent();
                                        console.error('[AUDITORIA] Erro ao confirmar importação automática:', e_5);
                                        showToast('Erro ao processar auditoria: ' + ((e_5 === null || e_5 === void 0 ? void 0 : e_5.message) || e_5), 'e');
                                        return [3 /*break*/, 4];
                                    case 4: return [2 /*return*/];
                                }
                            });
                        }); }, 100);
                        return [3 /*break*/, 5];
                    case 3:
                        e_4 = _a.sent();
                        console.error('[AUDITORIA] Erro ao ler arquivo:', e_4);
                        showToast('Erro ao ler arquivo da auditoria: ' + ((e_4 === null || e_4 === void 0 ? void 0 : e_4.message) || e_4), 'e');
                        return [3 /*break*/, 5];
                    case 4:
                        __audImportando = false;
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    window.criarNovaAuditoriaStandalone = function () {
        var nomeAtual = String(window.__auditoriaNomeManual || '').trim();
        var nome = prompt('Nome da nova auditoria:', nomeAtual || "AUD-".concat(new Date().toLocaleString('pt-BR')));
        if (nome == null)
            return;
        var limpo = String(nome || '').trim();
        if (!limpo) {
            showToast('Informe um nome para a auditoria', 'w');
            return;
        }
        window.__auditoriaNomeManual = limpo;
        window.__ultimaAuditoriaSelecionada = '';
        var input = document.getElementById('auditoria-file');
        if (input)
            input.click();
    };
    window.exportarAuditoriaOperacional = function () {
        var _a, _b;
        var audId = ((_a = document.getElementById('aud-op-auditoria')) === null || _a === void 0 ? void 0 : _a.value) || window.__ultimaAuditoriaSelecionada || '';
        var lista = (state().auditorias || []).filter(function (a) { return !audId || String(a.auditoria_id || '') === String(audId); });
        if (!lista.length) {
            showToast('Nenhuma auditoria carregada para exportar', 'w');
            return;
        }
        var rows = [];
        lista.forEach(function (a) {
            var _a;
            var itens = (((_a = a.itens_confirmados) === null || _a === void 0 ? void 0 : _a.length) ? a.itens_confirmados : a.itens || []);
            if (!itens.length)
                rows.push({ auditoria_id: a.auditoria_id, auditoria_nome: a.auditoria_nome, rua: a.rua, endereco: a.endereco, status: a.status, confirmado_por: a.confirmado_por, confirmado_em: a.confirmado_em });
            itens.forEach(function (it) { return rows.push({
                auditoria_id: a.auditoria_id,
                auditoria_nome: a.auditoria_nome,
                rua: a.rua,
                endereco: a.endereco,
                status: a.status,
                confirmado_por: a.confirmado_por,
                confirmado_em: a.confirmado_em,
                codigo_produto: it.codigo_produto || '',
                produto_nome: it.produto_nome || '',
                dun: it.dun || '',
                capa_palete: it.capa_palete || '',
                data: it.data || '',
                quantidade: it.quantidade || it.quantidade_estoque || it.quantidade_dun || ''
            }); });
        });
        var ws = XLSX.utils.json_to_sheet(rows);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
        var nome = String((((_b = lista[0]) === null || _b === void 0 ? void 0 : _b.auditoria_nome) || audId || 'auditoria')).replace(/[^a-z0-9-_]+/gi, '_');
        XLSX.writeFile(wb, "".concat(nome, ".xlsx"));
    };
    window.confirmarImportAuditoria = function () {
        return __awaiter(this, void 0, void 0, function () {
            var preview, auditoria_id, auditoria_nome, novosGrupos, importMeta, sel, status, actionsPanel;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        preview = window._auditoriaImportPreview || [];
                        audBatchId = window.audBatchId || audBatchId || ('AUDBATCH-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase());
                        window.audBatchId = audBatchId;
                        if (!preview.length) {
                            showToast('Importe uma base primeiro', 'w');
                            return [2 /*return*/];
                        }
                        auditoria_id = auditId();
                        auditoria_nome = auditName();
                        novosGrupos = groupRows(selectedLocalRows(preview), { auditoria_id: auditoria_id, auditoria_nome: auditoria_nome });
                        if (!novosGrupos.length) {
                            showToast('Nenhum endereço válido encontrado na base', 'w');
                            return [2 /*return*/];
                        }
                        importMeta = {
                            id: typeof gerarId === 'function' ? gerarId('AUDIMP') : ('AUDIMP-' + Date.now()),
                            auditoria_id: auditoria_id,
                            auditoria_nome: auditoria_nome,
                            arquivo: window._auditoriaImportFileName || '',
                            total_registros: novosGrupos.length,
                            iguais: 0,
                            novos: novosGrupos.length,
                            alterados: 0,
                            reabertos: 0,
                            importado_em: new Date().toISOString(),
                            importado_por: ((_a = window._currentAnalistaUser) === null || _a === void 0 ? void 0 : _a.email) || 'analista',
                            origem: 'IMPORTACAO_AUDITORIA_STANDALONE',
                            batch_id: window.audBatchId
                        };
                        window.AnalistaState.batch([
                            window.AnalistaActions.replaceSlice('auditorias', __spreadArray(__spreadArray([], (state().auditorias || []).filter(function (a) { return String(a.auditoria_id || '') !== String(auditoria_id); }), true), novosGrupos, true), { source: 'auditoria-standalone-import' }),
                            window.AnalistaActions.replaceSlice('auditoria_imports', __spreadArray([importMeta], (state().auditoria_imports || []).filter(function (i) { return String(i.id || '') !== String(importMeta.id); }), true), { source: 'auditoria-standalone-import' })
                        ]);
                        window.__ultimaAuditoriaImportada = auditoria_id;
                        window.__ultimaAuditoriaSelecionada = auditoria_id;
                        window.__auditoriaNomeManual = auditoria_nome;
                        saveAuditoriaUiState({ auditoria_id: auditoria_id, auditoria_nome: auditoria_nome, ultimo_import_em: importMeta.importado_em });
                        return [4 /*yield*/, publishAuditoriaToFirestore(novosGrupos, importMeta)];
                    case 1:
                        _b.sent();
                        return [4 /*yield*/, reloadAuditoriaFromFirestore(auditoria_id).catch(function () { return false; })];
                    case 2:
                        _b.sent();
                        if (typeof _popularSelectAuditorias === 'function')
                            _popularSelectAuditorias();
                        sel = document.getElementById('aud-op-auditoria');
                        if (sel)
                            sel.value = auditoria_id;
                        status = document.getElementById('auditoria-import-status');
                        if (status)
                            status.innerHTML = "<div class=\"status-box ok\"><div class=\"sb-icon\">\u2705</div><div><div class=\"sb-text\">Base da auditoria importada com sucesso</div><div class=\"sb-sub\">".concat(novosGrupos.length, " linha(s)/produto(s) em ").concat(esc2(auditoria_nome), "</div></div></div>");
                        actionsPanel = document.getElementById('auditoria-import-actions');
                        if (actionsPanel)
                            actionsPanel.style.display = 'none';
                        if (typeof renderAuditoriaOperacional === 'function')
                            renderAuditoriaOperacional();
                        if (typeof renderRastreabilidade === 'function')
                            renderRastreabilidade();
                        showToast('✅ Base da auditoria importada', 's');
                        return [2 /*return*/];
                }
            });
        });
    };
    window.liberarAuditoriaColetores = function () {
        return __awaiter(this, void 0, void 0, function () {
            var lista, auditoriaId, itens;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        lista = availableAudits();
                        auditoriaId = ((_a = document.getElementById('aud-op-auditoria')) === null || _a === void 0 ? void 0 : _a.value) || window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '';
                        if (!auditoriaId && lista.length === 1)
                            auditoriaId = lista[0].id;
                        if (!auditoriaId) {
                            showToast('Selecione uma auditoria', 'w');
                            return [2 /*return*/];
                        }
                        itens = (state().auditorias || []).filter(function (a) { return String(a.auditoria_id || '') === String(auditoriaId); }).map(function (a) {
                            var disp = !['CONFIRMADO_SEM_AJUSTE', 'CONFIRMADO_COM_AJUSTE'].includes(String(a.status || '').toUpperCase());
                            return __assign(__assign({}, a), { liberada_coletor: true, disponivel_coletor: disp });
                        });
                        if (!itens.length) {
                            showToast('Essa auditoria não possui endereços para liberação', 'w');
                            return [2 /*return*/];
                        }
                        window.AnalistaState.replaceSlice('auditorias', (state().auditorias || []).map(function (a) { return String(a.auditoria_id || '') === String(auditoriaId) ? (itens.find(function (x) { return x.id === a.id; }) || a) : a; }), { source: 'liberarAuditoriaColetores' });
                        window.__ultimaAuditoriaSelecionada = auditoriaId;
                        window.__ultimaAuditoriaImportada = auditoriaId;
                        saveAuditoriaUiState({ auditoria_id: auditoriaId, auditoria_nome: (((_b = itens[0]) === null || _b === void 0 ? void 0 : _b.auditoria_nome) || ''), ultima_liberacao_em: new Date().toISOString() });
                        return [4 /*yield*/, publishAuditoriaToFirestore(itens, null)];
                    case 1:
                        _c.sent();
                        return [4 /*yield*/, reloadAuditoriaFromFirestore(auditoriaId).catch(function () { return false; })];
                    case 2:
                        _c.sent();
                        try {
                            if (typeof logSistema === 'function')
                                logSistema('LIBERACAO', 'Auditoria liberada para os coletores', { auditoria_id: auditoriaId, registros: itens.length });
                        }
                        catch (e) { }
                        if (typeof renderAuditoriaOperacional === 'function')
                            renderAuditoriaOperacional();
                        showToast('📲 Auditoria liberada para os coletores', 's');
                        return [2 /*return*/];
                }
            });
        });
    };
    window.renderAuditoriaOperacional = function () {
        var _a, _b, _c;
        updateStaticTexts();
        if (typeof window._popularSelectAuditorias === 'function')
            window._popularSelectAuditorias();
        var audId = ((_a = document.getElementById('aud-op-auditoria')) === null || _a === void 0 ? void 0 : _a.value) || '';
        var fStatus = ((_b = document.getElementById('aud-op-status')) === null || _b === void 0 ? void 0 : _b.value) || '';
        var busca = String(((_c = document.getElementById('aud-op-busca')) === null || _c === void 0 ? void 0 : _c.value) || '').trim().toLowerCase();
        var todos = (state().auditorias || []).filter(function (a) { return !audId || String(a.auditoria_id || '') === String(audId); });
        if (fStatus)
            todos = todos.filter(function (a) { return String(a.status || '').toUpperCase() === String(fStatus).toUpperCase(); });
        if (busca) {
            todos = todos.filter(function (a) { return __spreadArray([a.auditoria_nome, a.rua, a.endereco, a.confirmado_por], (a.itens || []).flatMap(function (i) { return [i.produto_nome, i.codigo_produto, i.gtin, i.capa_palete, i.data, i.quantidade_dun]; }), true).join(' ').toLowerCase().includes(busca); });
        }
        todos.sort(function (a, b) { return String(a.rua || '').localeCompare(String(b.rua || '')) || String(a.endereco || '').localeCompare(String(b.endereco || '')); });
        var setTxt = function (id, val) { var el = document.getElementById(id); if (el)
            el.textContent = String(val); };
        setTxt('audop-k-total', todos.length);
        setTxt('audop-k-pend', todos.filter(function (a) { return String(a.status || '').toUpperCase() === 'PENDENTE'; }).length);
        setTxt('audop-k-ok', todos.filter(function (a) { return String(a.status || '').toUpperCase() === 'CONFIRMADO_SEM_AJUSTE'; }).length);
        setTxt('audop-k-aj', todos.filter(function (a) { return String(a.status || '').toUpperCase() === 'CONFIRMADO_COM_AJUSTE'; }).length);
        setTxt('audop-k-re', todos.filter(function (a) { return String(a.status || '').toUpperCase() === 'REABERTO_ALTERACAO_BASE'; }).length);
        var tbody = document.getElementById('auditoria-op-tbody');
        if (tbody) {
            tbody.innerHTML = !todos.length
                ? "<tr><td colspan=\"10\" style=\"text-align:center;color:var(--muted);padding:18px\">Nenhum endere\u00E7o da auditoria foi encontrado para os filtros atuais.</td></tr>"
                : todos.flatMap(function (a) {
                    var itensOriginais = Array.isArray(a.itens) ? a.itens : [];
                    var itensConfirmados = Array.isArray(a.itens_confirmados) ? a.itens_confirmados : [];
                    var maxItens = Math.max(itensOriginais.length, itensConfirmados.length, 1);
                    var linhasExibir = Array.from({ length: maxItens }, function (_, idx) { return ({
                        base: itensOriginais[idx] || {},
                        conf: itensConfirmados[idx] || {}
                    }); });
                    // Rua: segundo segmento do endereço (ex: LOJA.RUA.COL.NIV)
                    var endParts = String(a.endereco || '').split('.');
                    var ruaExibir = a.rua || (endParts.length >= 2 ? endParts[1] : endParts[0]) || '—';
                    // A base antiga gravou alguns campos com nomes trocados
                    // (ex.: DUN dentro de quantidade_estoque/quantidade_dun). Por isso
                    // a tela normaliza pelo FORMATO do valor antes de imprimir a coluna.
                    var onlyDigits = function (v) { return String(v !== null && v !== void 0 ? v : '').replace(/\D/g, ''); };
                    var isBar = function (v) {
                        var d = onlyDigits(v);
                        // DUN/EAN/GTIN normalmente vem com 12, 13 ou 14 dígitos na base do WMS.
                        return d.length >= 12 && d.length <= 14;
                    };
                    var hasLetters = function (v) { return /[A-Za-zÀ-ÿ]/.test(String(v !== null && v !== void 0 ? v : '')); };
                    var firstVal = function () {
                        var vals = [];
                        for (var _i = 0; _i < arguments.length; _i++) {
                            vals[_i] = arguments[_i];
                        }
                        return vals.map(function (v) { return String(v !== null && v !== void 0 ? v : '').trim(); }).find(function (v) { return v && v !== '0'; }) || '';
                    };
                    var firstText = function () {
                        var vals = [];
                        for (var _i = 0; _i < arguments.length; _i++) {
                            vals[_i] = arguments[_i];
                        }
                        return vals.map(function (v) { return String(v !== null && v !== void 0 ? v : '').trim(); }).find(function (v) { return v && hasLetters(v); }) || '';
                    };
                    var firstBarcode = function () {
                        var vals = [];
                        for (var _i = 0; _i < arguments.length; _i++) {
                            vals[_i] = arguments[_i];
                        }
                        return vals.map(function (v) { return String(v !== null && v !== void 0 ? v : '').trim(); }).find(function (v) { return v && isBar(v); }) || '';
                    };
                    var firstQtd = function () {
                        var vals = [];
                        for (var _i = 0; _i < arguments.length; _i++) {
                            vals[_i] = arguments[_i];
                        }
                        return vals.map(function (v) { return String(v !== null && v !== void 0 ? v : '').trim(); }).find(function (v) {
                            if (!v || isBar(v))
                                return false;
                            var n = Number(String(v).replace(',', '.'));
                            return Number.isFinite(n);
                        }) || '';
                    };
                    var qtdEstoqueDe = function (base) { return firstQtd(base.quantidade_estoque, base.qtd_estoque, base.quantidade_esperada, base.qtd_esperada, base.estoque, base.saldo, base.quantidade, base.qtd, base.quantidade_dun); };
                    var dunDe = function (base, conf) { return firstBarcode(base.dun, conf.dun, base.gtin, conf.gtin, base.quantidade_estoque, base.quantidade_dun, conf.quantidade_dun, base.capa_palete, conf.capa_palete, base.codigo_produto, conf.codigo_produto); };
                    var capaDe = function (base, conf, dunVal) {
                        var cand = firstVal(conf.capa_palete, conf.capa, base.capa_palete, base.capa, base.palete_key, conf.palete_key);
                        if (!cand)
                            return '';
                        // Quando a capa veio igual ao DUN/GTIN, não é capa: é coluna trocada.
                        if (dunVal && onlyDigits(cand) === onlyDigits(dunVal))
                            return '';
                        // Evita repetir DUN/EAN na coluna Capa.
                        if (isBar(cand))
                            return '';
                        return cand;
                    };
                    var qtdConfirmadaDe = function (conf) { return firstQtd(conf.quantidade_contada, conf.qtd_contada, conf.quantidade, conf.qtd, conf.qtde, conf.qty, conf.quantidade_dun); };
                    // Qtd. Contada: primeiro usa contagens reais; se não houver, usa o valor confirmado na auditoria.
                    var contagens = (state().contagens || []).filter(function (c) {
                        return c.endereco && a.endereco &&
                            String(c.endereco).toUpperCase().replace(/\s/g, '') === String(a.endereco).toUpperCase().replace(/\s/g, '') &&
                            !c._excluida && c.status !== 'ESTORNADA';
                    });
                    return linhasExibir.map(function (_a) {
                        var base = _a.base, conf = _a.conf;
                        var prodNome = firstText(base.produto_nome, base.descricao_produto, base.produto, conf.produto_nome, conf.descricao_produto, conf.produto) || firstVal(base.produto_nome, conf.produto_nome, base.codigo_produto, conf.codigo_produto);
                        var codProduto = firstVal(base.codigo_produto, conf.codigo_produto);
                        var dataVal = firstVal(conf.data, base.data);
                        var dunVal = dunDe(base, conf);
                        var capaVal = capaDe(base, conf, dunVal);
                        var qtdEstoque = qtdEstoqueDe(base);
                        var qtdConfirmada = qtdConfirmadaDe(conf);
                        var qtdContadaHtml;
                        if (contagens.length > 0) {
                            var qtdTotal = contagens.reduce(function (acc, c) { return acc + (parseFloat(c.quantidade) || 0); }, 0);
                            var qtdEstNum = parseFloat(String(qtdEstoque || '').replace(',', '.'));
                            var cor = (Number.isFinite(qtdEstNum) && qtdEstNum > 0 && qtdTotal !== qtdEstNum) ? 'var(--warning,#f59e0b)' : 'var(--success,#22c55e)';
                            qtdContadaHtml = "<span style=\"font-weight:800;font-size:.9rem;color:".concat(cor, "\">").concat(qtdTotal, "</span><div style=\"font-size:.63rem;color:var(--muted);margin-top:1px\">").concat(contagens.length, " contagem(ns)</div>");
                        }
                        else if (qtdConfirmada) {
                            var qtdEstNum = parseFloat(String(qtdEstoque || '').replace(',', '.'));
                            var qtdConfNum = parseFloat(String(qtdConfirmada || '').replace(',', '.'));
                            var cor = (Number.isFinite(qtdEstNum) && Number.isFinite(qtdConfNum) && qtdEstNum !== qtdConfNum) ? 'var(--warning,#f59e0b)' : 'var(--success,#22c55e)';
                            qtdContadaHtml = "<span style=\"font-weight:800;font-size:.9rem;color:".concat(cor, "\">").concat(esc2(qtdConfirmada), "</span>");
                        }
                        else {
                            qtdContadaHtml = "<span style=\"color:var(--muted);font-style:italic;font-size:.75rem\">N\u00E3o contado</span>";
                        }
                        return "<tr style=\"".concat(a.liberada_coletor ? 'background:rgba(232,117,26,.03)' : '', "\">\n              <td style=\"font-size:.78rem;font-weight:700\">").concat(esc2(ruaExibir), "</td>\n              <td class=\"mono\" style=\"font-size:.78rem;font-weight:700;color:var(--text)\">").concat(esc2(String(a.endereco || '')), "</td>\n              <td><div style=\"font-size:.78rem;font-weight:600\">").concat(esc2((prodNome && !isBar(prodNome)) ? prodNome : '—'), "</div>").concat(codProduto && !isBar(codProduto) ? "<div class=\"mono\" style=\"font-size:.66rem;color:var(--muted);margin-top:2px\">".concat(esc2(codProduto), "</div>") : '', "</td>\n              <td><div class=\"mono\" style=\"font-size:.75rem\">").concat(esc2(dataVal || '—'), "</div></td>\n              <td><div class=\"mono\" style=\"font-size:.75rem\">").concat(esc2(capaVal || '—'), "</div></td>\n              <td><div class=\"mono\" style=\"font-size:.72rem;color:var(--muted)\">").concat(esc2(dunVal || '—'), "</div></td>\n              <td><div class=\"mono\" style=\"font-size:.75rem\">").concat(esc2(qtdEstoque || '—'), "</div></td>\n              <td>").concat(qtdContadaHtml, "</td>\n              <td><span class=\"badge ").concat(statusBadge(a.status), "\">").concat(statusLabel(a.status), "</span>").concat(a.liberada_coletor ? '<div style="font-size:.62rem;color:var(--orange);font-weight:700;margin-top:3px">Liberada</div>' : '', "</td>\n              <td style=\"font-size:.78rem\">").concat(esc2(a.confirmado_por || '—'), "</td>\n            </tr>");
                    });
                }).join('');
        }
        var list = document.getElementById('auditoria-import-list');
        if (list) {
            var hist = (state().auditoria_imports || []).filter(function (i) { return !audId || String(i.auditoria_id || '') === String(audId); });
            list.innerHTML = hist.length ? hist.slice(0, 20).map(function (i) { return "<div class=\"log-item\"><div class=\"log-dot info\"></div><div class=\"log-content\"><div class=\"log-action\">".concat(esc2(i.auditoria_nome || i.arquivo || 'base'), "</div><div class=\"log-desc\">Importa\u00E7\u00E3o da auditoria</div><div style=\"display:flex;gap:6px;flex-wrap:wrap;margin-top:4px\"><span class=\"chip\">\uD83D\uDCCD ").concat(i.total_registros || 0, " end.</span><span class=\"chip\">\uD83C\uDD95 ").concat(i.novos || 0, "</span></div></div><div class=\"log-time\">").concat(typeof fmtTs === 'function' ? fmtTs(i.importado_em) : esc2(i.importado_em || ''), "</div></div>"); }).join('') : "<div class=\"empty\" style=\"padding:18px 10px\"><div class=\"empty-title\">Nenhuma importa\u00E7\u00E3o ainda</div></div>";
        }
    };
    document.addEventListener('DOMContentLoaded', function () {
        updateStaticTexts();
        hydrateAuditoriaUiState();
        setTimeout(function () {
            try {
                window.mountLocalSelect(window._auditoriaImportPreview || []);
            }
            catch (e) { }
            try {
                window._popularSelectAuditorias();
            }
            catch (e) { }
            try {
                window.renderAuditoriaOperacional();
            }
            catch (e) { }
            var recarregarQuandoLojaPronta = function () {
                if (!_auditoriaPodeAcessarFirestore())
                    return;
                reloadAuditoriaFromFirestore(window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '').then(function (ok) {
                    if (!ok)
                        return;
                    try {
                        window._popularSelectAuditorias();
                    }
                    catch (e) { }
                    var sel = document.getElementById('aud-op-auditoria');
                    var alvo = window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '';
                    if (sel && alvo)
                        sel.value = alvo;
                    try {
                        window.renderAuditoriaOperacional();
                    }
                    catch (e) { }
                }).catch(function (error) {
                    console.error('[AUDITORIA] Falha ao recarregar após seleção da loja:', error);
                });
            };
            recarregarQuandoLojaPronta();
            if (!window.__auditoriaListenerLojaRegistrado) {
                window.__auditoriaListenerLojaRegistrado = true;
                window.addEventListener('dt-loja-alterada', function () {
                    setTimeout(recarregarQuandoLojaPronta, 0);
                });
            }
        }, 0);
    });
})();
