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
//  16. RENDERIZAÇÃO — DIVERGÊNCIAS
// ───────────────────────────────────────────────────────────────────
function marcarDivergenciaResolvida(divId) {
    var div = state().divergencias.find(function (d) { return d.id === divId; });
    if (!div)
        return;
    showConfirm("Marcar a diverg\u00EAncia do endere\u00E7o ".concat(escHTML(div.endereco), " como RESOLVIDA?"), function () { return _marcarDivResolvida(divId); }, { title: '✅ Resolver divergência', icon: '✅', okLabel: 'Marcar resolvida', okClass: 'btn-success' });
    return;
}
function _marcarDivResolvida(divId) {
    div.status = 'RESOLVIDA';
    div.resolvida_em = new Date().toISOString();
    div.resolvida_por = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'Analista';
    // Marcar recontagem associada também
    var rec = state().recontagens.find(function (r) {
        return r.divergencia_id === divId ||
            (r.endereco === div.endereco && r.inventario_id === div.inventario_id);
    });
    if (rec) {
        rec.status = 'CONCLUIDA';
        rec.status_recontagem = 'concluida'; // ← campo que o coletor usa para filtrar
        rec.concluida_em = div.resolvida_em;
        rec.resolvida_por = div.resolvida_por;
        // ✅ Persistir recontagem no Firestore
        fsSalvarRecontagem(rec);
    }
    saveAll();
    // ✅ Persistir divergência atualizada no Firestore
    fsSalvarDivergencia(div);
    renderDivergencias();
    renderRecontagens();
    atualizarBadgesNav();
    logSistema('DIVERGENCIA', "Diverg\u00EAncia ".concat(divId, " marcada como resolvida pelo analista"), { divId: divId, endereco: div.endereco, inventario_id: div.inventario_id });
    showToast('✅ Divergência marcada como resolvida!', 's');
}
// ── Estado de seleção de divergências ──────────────────────────────────────
var _divSelecionadas = new Set();
function divAtualizarBarraSel() {
    var bar = document.getElementById('div-sel-bar');
    var cnt = document.getElementById('div-sel-count');
    if (!bar)
        return;
    if (_divSelecionadas.size > 0) {
        bar.style.display = 'flex';
        cnt.textContent = "".concat(_divSelecionadas.size, " endere\u00E7o").concat(_divSelecionadas.size !== 1 ? 's' : '', " selecionado").concat(_divSelecionadas.size !== 1 ? 's' : '');
    }
    else {
        bar.style.display = 'none';
    }
}
function divToggleSel(id, checked) {
    if (checked)
        _divSelecionadas.add(id);
    else
        _divSelecionadas.delete(id);
    divAtualizarBarraSel();
    // Atualizar checkbox master
    var chkAll = document.getElementById('div-chk-all');
    if (chkAll) {
        var total = document.querySelectorAll('.div-row-chk').length;
        chkAll.indeterminate = _divSelecionadas.size > 0 && _divSelecionadas.size < total;
        chkAll.checked = total > 0 && _divSelecionadas.size === total;
    }
}
function divToggleTodos(checked) {
    document.querySelectorAll('.div-row-chk').forEach(function (chk) {
        chk.checked = checked;
        var id = chk.dataset.id;
        if (checked)
            _divSelecionadas.add(id);
        else
            _divSelecionadas.delete(id);
    });
    divAtualizarBarraSel();
}
function divDeselecionarTodos() {
    _divSelecionadas.clear();
    document.querySelectorAll('.div-row-chk').forEach(function (c) { return c.checked = false; });
    var chkAll = document.getElementById('div-chk-all');
    if (chkAll) {
        chkAll.checked = false;
        chkAll.indeterminate = false;
    }
    divAtualizarBarraSel();
}
function divAtribuirRapido(divId) {
    _divSelecionadas.clear();
    _divSelecionadas.add(divId);
    divAtualizarBarraSel();
    abrirAtribuirRecontagem();
}
// Atribuir a partir da aba Recontagens (recebe rec.id, localiza divergência correspondente)
function divAtribuirPorRec(recId) {
    var rec = state().recontagens.find(function (r) { return r.id === recId; });
    if (!rec) {
        showToast('Recontagem não encontrada', 'e');
        return;
    }
    // Encontrar ou criar divergência correspondente
    var divId = rec.divergencia_id;
    if (!divId) {
        // Fallback: usar o id da recontagem como referência temporária
        divId = recId;
    }
    _divSelecionadas.clear();
    if (divId && state().divergencias.find(function (d) { return d.id === divId; })) {
        _divSelecionadas.add(divId);
    }
    else {
        // Sem divergência vinculada: atribuir direto na recontagem
        _recAtribuirDireto = rec;
        abrirAtribuirRecontagemDireto(rec);
        return;
    }
    divAtualizarBarraSel();
    abrirAtribuirRecontagem();
}
// Atribuição direta quando não há divergência vinculada (caso edge)
var _recAtribuirDireto = null;
function abrirAtribuirRecontagemDireto(rec) {
    return __awaiter(this, void 0, void 0, function () {
        var resumo;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    resumo = document.getElementById('atrib-resumo');
                    if (resumo) {
                        resumo.innerHTML = "<div style=\"font-weight:700;margin-bottom:8px;color:var(--text)\">\uD83D\uDCCD Recontagem: <span class=\"badge b-orange\" style=\"font-size:.72rem\">".concat(rec.endereco, "</span></div>\n      <div style=\"font-size:.78rem;color:var(--muted)\">").concat(rec.produto, "</div>");
                    }
                    openModal('modal-atribuir-recontagem');
                    document.getElementById('atrib-obs').value = '';
                    return [4 /*yield*/, divPopularSelectOperadores('atrib-operador')];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// ── Filtros rápidos ─────────────────────────────────────────────────────────
var _divFiltroRapidoAtivo = '';
function divFiltroRapido(tipo) {
    _divFiltroRapidoAtivo = _divFiltroRapidoAtivo === tipo ? '' : tipo;
    // Atualizar visual dos botões
    ['nao_atribuidas', 'minhas', 'pendentes', 'aguardando_analista', 'concluidas'].forEach(function (t) {
        var btn = document.getElementById('fq-' + t);
        if (btn)
            btn.style.background = _divFiltroRapidoAtivo === t ? 'var(--orange)' : '';
        if (btn)
            btn.style.color = _divFiltroRapidoAtivo === t ? '#fff' : '';
        if (btn)
            btn.style.borderColor = _divFiltroRapidoAtivo === t ? 'var(--orange)' : '';
    });
    if (tipo === 'limpar') {
        _divFiltroRapidoAtivo = '';
        // Limpar todos os filtros
        ['div-busca', 'div-frua', 'div-fnivel', 'div-fsetor', 'div-fproduto', 'div-foperador', 'div-fstatus-rec', 'div-fdata', 'div-ftipo', 'div-fstatus', 'div-ford', 'div-sel-inv'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el)
                el.value = '';
        });
    }
    renderDivergencias();
}
// ── Popula o select de operadores a partir da lista carregada do Firestore ──
function divPopularSelectOperadores(selectId) {
    return __awaiter(this, void 0, void 0, function () {
        var sel, cur, ops, snap, e_1, nomes;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sel = document.getElementById(selectId);
                    if (!sel)
                        return [2 /*return*/];
                    cur = sel.value;
                    // Mostrar loading
                    sel.innerHTML = "<option value=\"\">\u23F3 Carregando operadores...</option>";
                    sel.disabled = true;
                    ops = [];
                    // 1. Tentar usar _opListaCompleta já carregada
                    if (typeof _opListaCompleta !== 'undefined' && _opListaCompleta.length) {
                        ops = _opListaCompleta
                            .filter(function (o) { return o.ativo !== false && o.tipo !== 'analista'; })
                            .map(function (o) { return ({ id: o.id, nome: o.nome, cargo: o.cargo }); });
                    }
                    if (!(!ops.length && typeof FS_AN !== 'undefined')) return [3 /*break*/, 4];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS_AN.collection('dt_operadores')
                            .where('ativo', '==', true)
                            .orderBy('nome')
                            .get()];
                case 2:
                    snap = _a.sent();
                    if (!snap.empty) {
                        ops = snap.docs.map(function (d) {
                            var data = d.data();
                            return { id: d.id, nome: data.nome, cargo: data.cargo };
                        }).filter(function (o) { return o.nome; });
                        // Atualiza cache
                        if (typeof _opListaCompleta !== 'undefined') {
                            snap.docs.forEach(function (d) {
                                var existing = _opListaCompleta.find(function (x) { return x.id === d.id; });
                                if (!existing)
                                    _opListaCompleta.push(__assign({ id: d.id }, d.data()));
                            });
                        }
                    }
                    return [3 /*break*/, 4];
                case 3:
                    e_1 = _a.sent();
                    console.warn('[divPopularSelectOperadores] Firestore:', e_1.message);
                    return [3 /*break*/, 4];
                case 4:
                    // 3. Fallback: operadores únicos das contagens locais
                    if (!ops.length) {
                        nomes = __spreadArray([], new Set(__spreadArray(__spreadArray([], state().contagens.map(function (c) { return c.operador; }), true), state().recontagens.map(function (r) { return r.operador; }), true).filter(Boolean)), true).sort();
                        ops = nomes.map(function (n) { return ({ id: n, nome: n }); });
                    }
                    sel.disabled = false;
                    if (!ops.length) {
                        sel.innerHTML = "<option value=\"\">\u26A0\uFE0F Nenhum operador cadastrado</option>";
                        return [2 /*return*/];
                    }
                    sel.innerHTML = "<option value=\"\">Selecione o operador...</option>" +
                        ops.map(function (o) { return "<option value=\"".concat(o.nome || o.id, "\" ").concat((o.nome || o.id) === cur ? 'selected' : '', ">").concat(o.nome).concat(o.cargo ? " \u2014 ".concat(o.cargo) : '', "</option>"); }).join('');
                    if (cur)
                        sel.value = cur;
                    return [2 /*return*/];
            }
        });
    });
}
// ── Abrir modal de atribuição ────────────────────────────────────────────────
function abrirAtribuirRecontagem() {
    return __awaiter(this, void 0, void 0, function () {
        var resumo, lista, obs;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!_divSelecionadas.size) {
                        showToast('Selecione pelo menos um endereço', 'w');
                        return [2 /*return*/];
                    }
                    resumo = document.getElementById('atrib-resumo');
                    if (resumo) {
                        lista = __spreadArray([], _divSelecionadas, true).map(function (id) {
                            var d = state().divergencias.find(function (x) { return x.id === id; });
                            return d ? "<span class=\"badge b-orange\" style=\"font-size:.72rem\">".concat(escHTML(d.endereco), "</span>") : '';
                        }).join(' ');
                        resumo.innerHTML = "<div style=\"font-weight:700;margin-bottom:8px;color:var(--text)\">\uD83D\uDCCD ".concat(_divSelecionadas.size, " endere\u00E7o").concat(_divSelecionadas.size !== 1 ? 's' : '', " selecionado").concat(_divSelecionadas.size !== 1 ? 's' : '', ":</div><div style=\"display:flex;flex-wrap:wrap;gap:4px\">").concat(lista, "</div>");
                    }
                    // Abrir modal primeiro para feedback visual imediato
                    openModal('modal-atribuir-recontagem');
                    obs = document.getElementById('atrib-obs');
                    if (obs)
                        obs.value = '';
                    // Popular operadores de forma assíncrona (pode buscar do Firestore)
                    return [4 /*yield*/, divPopularSelectOperadores('atrib-operador')];
                case 1:
                    // Popular operadores de forma assíncrona (pode buscar do Firestore)
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// ── Confirmar atribuição ──────────────────────────────────────────────────────
function confirmarAtribuicao() {
    var _a, _b, _c, _d;
    var operador = (_b = (_a = document.getElementById('atrib-operador')) === null || _a === void 0 ? void 0 : _a.value) === null || _b === void 0 ? void 0 : _b.trim();
    var obs = (_d = (_c = document.getElementById('atrib-obs')) === null || _c === void 0 ? void 0 : _c.value) === null || _d === void 0 ? void 0 : _d.trim();
    if (!operador) {
        showToast('Selecione um operador', 'e');
        return;
    }
    var agora = new Date().toISOString();
    var atribPor = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.displayName) || (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'Analista';
    var count = 0;
    _divSelecionadas.forEach(function (id) {
        var d = state().divergencias.find(function (x) { return x.id === id; });
        if (!d)
            return;
        // ── Delegar toda a lógica de validação + criação para atribuirRecontagemSegura ──
        var rec = atribuirRecontagemSegura(d, operador, atribPor, obs, agora);
        if (!rec)
            return; // bloqueado — mensagem já exibida dentro da função
        count++;
    });
    saveAll();
    renderDivergencias();
    renderRecontagens();
    closeModal('modal-atribuir-recontagem');
    _divSelecionadas.clear();
    divAtualizarBarraSel();
    logSistema('ATRIBUIÇÃO_RECONTAGEM', "".concat(count, " recontagem(s) atribu\u00EDda(s) a ").concat(operador), { count: count, operador: operador, atribPor: atribPor, ts: agora });
    showToast("\u2705 ".concat(count, " recontagem").concat(count !== 1 ? 's' : '', " atribu\u00EDda").concat(count !== 1 ? 's' : '', " para ").concat(operador), 's');
}
// ── Desvincular recontagem — remove o operador, mantém divergência ABERTA ────
function desvincularRecontagem(divId) {
    return __awaiter(this, void 0, void 0, function () {
        var div, operadorAnterior, ok, recVinculada;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    div = state().divergencias.find(function (d) { return d.id === divId; });
                    if (!div)
                        return [2 /*return*/];
                    // Bloqueio PERSISTENTE — não é possível desvincular fluxo encerrado
                    if (_isPersistenteBloqueado(div)) {
                        showToast('🔒 Endereço PERSISTENTE — fluxo encerrado. Não é possível desvincular.', 'e');
                        return [2 /*return*/];
                    }
                    operadorAnterior = div.operador_responsavel || '—';
                    return [4 /*yield*/, new Promise(function (resolve) {
                            var modal = document.createElement('div');
                            modal.className = 'modal-bg';
                            modal.style.cssText = 'display:flex;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;background:rgba(0,0,0,.65)';
                            modal.innerHTML = "\n      <div style=\"background:var(--surface);border:1px solid var(--border);border-radius:14px;\n        padding:24px 28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)\">\n        <div style=\"font-size:1rem;font-weight:700;margin-bottom:8px;color:var(--text)\">\n          \uD83D\uDD13 Desvincular recontagem\n        </div>\n        <div style=\"font-size:.82rem;color:var(--muted);line-height:1.6;margin-bottom:16px\">\n          O operador <b style=\"color:var(--text)\">".concat(operadorAnterior, "</b> ser\u00E1 removido da recontagem do endere\u00E7o\n          <b style=\"color:var(--accent);font-family:var(--mono)\">").concat(div.endereco, "</b>.\n          <br><br>\n          A diverg\u00EAncia permanece <b style=\"color:var(--orange)\">ABERTA</b> e pode ser reatribu\u00EDda a outro operador.\n        </div>\n        <div style=\"display:flex;gap:8px;justify-content:flex-end\">\n          <button id=\"btn-desvincular-cancel\" style=\"padding:9px 18px;border-radius:8px;border:1px solid var(--border);\n            background:transparent;color:var(--muted);cursor:pointer;font-weight:600;font-size:.85rem\">\n            Cancelar\n          </button>\n          <button id=\"btn-desvincular-ok\" style=\"padding:9px 18px;border-radius:8px;border:none;\n            background:var(--danger,#ef4444);color:#fff;cursor:pointer;font-weight:700;font-size:.85rem\">\n            \uD83D\uDD13 Desvincular\n          </button>\n        </div>\n      </div>");
                            document.body.appendChild(modal);
                            modal.querySelector('#btn-desvincular-ok').onclick = function () { modal.remove(); resolve(true); };
                            modal.querySelector('#btn-desvincular-cancel').onclick = function () { modal.remove(); resolve(false); };
                            modal.onclick = function (e) { if (e.target === modal) {
                                modal.remove();
                                resolve(false);
                            } };
                        })];
                case 1:
                    ok = _a.sent();
                    if (!ok)
                        return [2 /*return*/];
                    // Limpar campos de atribuição na divergência local
                    div.operador_responsavel = null;
                    div.atribuido_por = null;
                    div.atribuido_em = null;
                    div.status_recontagem = null;
                    div.observacao_atribuicao = null;
                    // Status volta para ABERTA se estava EM_RECONTAGEM
                    if (div.status === 'EM_RECONTAGEM')
                        div.status = 'ABERTA';
                    // Persistir no Firestore
                    return [4 /*yield*/, fsSalvarDivergencia(div)];
                case 2:
                    // Persistir no Firestore
                    _a.sent();
                    recVinculada = state().recontagens.find(function (r) {
                        return r.divergencia_id === divId ||
                            (r.endereco === div.endereco && r.inventario_id === div.inventario_id &&
                                (r.status_recontagem === 'pendente' || r.status === 'PENDENTE'));
                    });
                    if (!recVinculada) return [3 /*break*/, 4];
                    recVinculada.status_recontagem = 'cancelada';
                    recVinculada.status = 'CANCELADA';
                    recVinculada.cancelada_em = new Date().toISOString();
                    recVinculada.cancelada_por = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'Analista';
                    return [4 /*yield*/, fsSalvarRecontagem(recVinculada)];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4: return [4 /*yield*/, saveAll()];
                case 5:
                    _a.sent();
                    renderDivergencias();
                    logSistema('DESVINCULAÇÃO_RECONTAGEM', "Recontagem desvinculada de ".concat(operadorAnterior), {
                        divergencia_id: divId, endereco: div.endereco,
                        operadorAnterior: operadorAnterior
                    });
                    showToast("\uD83D\uDD13 Recontagem desvinculada de ".concat(operadorAnterior, ". Diverg\u00EAncia continua ABERTA."), 's');
                    return [2 /*return*/];
            }
        });
    });
}
// ── Badge de status de recontagem ────────────────────────────────────────────
function recStatusBadge(statusRec) {
    switch ((statusRec || '').toLowerCase()) {
        case 'pendente': return 'b-yellow';
        case 'em_andamento': return 'b-orange';
        case 'concluida': return 'b-green';
        case 'sem_divergencia': return 'b-green';
        case 'resolvida': return 'b-green';
        case 'persistente': return 'b-red';
        case 'cancelada': return 'b-gray';
        case 'aguardando_analista': return 'b-purple';
        default: return 'b-gray';
    }
}
function recStatusLabel(statusRec) {
    switch ((statusRec || '').toLowerCase()) {
        case 'pendente': return '⏳ Pendente';
        case 'em_andamento': return '🔄 Em andamento';
        case 'concluida': return '✅ Concluída';
        case 'sem_divergencia': return '✅ Sem divergência';
        case 'resolvida': return '✅ Sem divergência';
        case 'persistente': return '🔴 Persistente';
        case 'cancelada': return '❌ Cancelada';
        case 'aguardando_analista': return '🔒 Aguard. analista';
        default: return '—';
    }
}
function renderDivergencias() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    var busca = (((_a = document.getElementById('div-busca')) === null || _a === void 0 ? void 0 : _a.value) || '').toLowerCase();
    var fInv = ((_b = document.getElementById('div-sel-inv')) === null || _b === void 0 ? void 0 : _b.value) || '';
    var fStatus = ((_c = document.getElementById('div-fstatus')) === null || _c === void 0 ? void 0 : _c.value) || '';
    var fTipo = ((_d = document.getElementById('div-ftipo')) === null || _d === void 0 ? void 0 : _d.value) || '';
    var ford = ((_e = document.getElementById('div-ford')) === null || _e === void 0 ? void 0 : _e.value) || '';
    var fRua = ((_f = document.getElementById('div-frua')) === null || _f === void 0 ? void 0 : _f.value) || '';
    var fNivel = ((_g = document.getElementById('div-fnivel')) === null || _g === void 0 ? void 0 : _g.value) || '';
    var fSetor = ((_h = document.getElementById('div-fsetor')) === null || _h === void 0 ? void 0 : _h.value) || '';
    var fProduto = ((_j = document.getElementById('div-fproduto')) === null || _j === void 0 ? void 0 : _j.value) || '';
    var fOperador = ((_k = document.getElementById('div-foperador')) === null || _k === void 0 ? void 0 : _k.value) || '';
    var fStatusRec = ((_l = document.getElementById('div-fstatus-rec')) === null || _l === void 0 ? void 0 : _l.value) || '';
    var fData = ((_m = document.getElementById('div-fdata')) === null || _m === void 0 ? void 0 : _m.value) || '';
    // Popular select inventários
    var selInv = document.getElementById('div-sel-inv');
    if (selInv) {
        var cur_1 = selInv.value;
        selInv.innerHTML = '<option value="">Todos os inventários</option>' +
            state().inventarios.map(function (i) { return "<option value=\"".concat(i.id, "\" ").concat(i.id === cur_1 ? 'selected' : '', ">").concat(i.codigo, " \u2014 ").concat(i.nome, "</option>"); }).join('');
        if (cur_1)
            selInv.value = cur_1;
    }
    var dados = state().divergencias;
    if (fInv)
        dados = dados.filter(function (d) { return d.inventario_id === fInv; });
    if (fStatus) {
        dados = dados.filter(function (d) { return d.status === fStatus; });
    }
    else {
        // Por padrão ocultar RESOLVIDA e PERSISTENTE — já encerradas, não precisam poluir a lista
        dados = dados.filter(function (d) { return d.status !== 'RESOLVIDA' && d.status !== 'PERSISTENTE'; });
    }
    if (fTipo === 'FALTA')
        dados = dados.filter(function (d) { return d.diferenca != null && d.diferenca < 0; });
    else if (fTipo === 'SOBRA')
        dados = dados.filter(function (d) { return d.diferenca != null && d.diferenca > 0; });
    else if (fTipo === 'PRODUTO_NAO_IDENTIFICADO')
        dados = dados.filter(function (d) { return d.tipo_divergencia === 'PRODUTO_NAO_IDENTIFICADO'; });
    else if (fTipo === 'PRODUTO_FORA_ENDERECO')
        dados = dados.filter(function (d) { return d.tipo_divergencia === 'PRODUTO_FORA_ENDERECO'; });
    else if (fTipo === 'VAZIO_COM_PRODUTO_NA_BASE')
        dados = dados.filter(function (d) { return d.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE'; });
    // Filtrar por rua
    if (fRua)
        dados = dados.filter(function (d) { var ei = getEnderecoInfo(d.endereco); return ((ei === null || ei === void 0 ? void 0 : ei.rua) || '') === fRua; });
    // Filtrar por nível
    if (fNivel)
        dados = dados.filter(function (d) { var ei = getEnderecoInfo(d.endereco); return ((ei === null || ei === void 0 ? void 0 : ei.nivel) || (ei === null || ei === void 0 ? void 0 : ei.andar) || '') === fNivel; });
    // Filtrar por setor
    if (fSetor)
        dados = dados.filter(function (d) { var ei = getEnderecoInfo(d.endereco); return ((ei === null || ei === void 0 ? void 0 : ei.setor) || (ei === null || ei === void 0 ? void 0 : ei.local) || (ei === null || ei === void 0 ? void 0 : ei.nome_local) || '') === fSetor; });
    // Filtrar por produto
    if (fProduto)
        dados = dados.filter(function (d) { return (d.produto || '') === fProduto; });
    // Filtrar por operador
    if (fOperador)
        dados = dados.filter(function (d) {
            var cont = state().contagens.find(function (c) { return c.inventario_id === d.inventario_id && c.endereco === d.endereco && !c._excluida; });
            var op = d.operador || (cont === null || cont === void 0 ? void 0 : cont.operador) || '';
            return op === fOperador;
        });
    // Filtrar por status de recontagem
    if (fStatusRec) {
        if (fStatusRec === 'nao_atribuida')
            dados = dados.filter(function (d) { return !d.atribuido_em && !d.operador_responsavel; });
        else
            dados = dados.filter(function (d) { return (d.status_recontagem || '') === fStatusRec; });
    }
    // Filtrar por data
    if (fData) {
        var agora_1 = new Date();
        dados = dados.filter(function (d) {
            if (!d.criada_em)
                return false;
            var dt = new Date(d.criada_em);
            if (fData === 'hoje')
                return dt.toDateString() === agora_1.toDateString();
            if (fData === '7d')
                return (agora_1 - dt) <= 7 * 24 * 3600 * 1000;
            if (fData === '30d')
                return (agora_1 - dt) <= 30 * 24 * 3600 * 1000;
            return true;
        });
    }
    // Filtros rápidos
    if (_divFiltroRapidoAtivo === 'nao_atribuidas')
        dados = dados.filter(function (d) { return !d.atribuido_em && !d.operador_responsavel; });
    else if (_divFiltroRapidoAtivo === 'minhas') {
        var eu_1 = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.displayName) || (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || '';
        dados = dados.filter(function (d) { return (d.atribuido_por || '') === eu_1; });
    }
    else if (_divFiltroRapidoAtivo === 'pendentes')
        dados = dados.filter(function (d) { return (d.status_recontagem || '') === 'pendente'; });
    else if (_divFiltroRapidoAtivo === 'aguardando_analista')
        dados = dados.filter(function (d) { return (d.status_recontagem || '') === 'aguardando_analista'; });
    else if (_divFiltroRapidoAtivo === 'concluidas')
        dados = dados.filter(function (d) { return (d.status_recontagem || '') === 'concluida'; });
    if (busca)
        dados = dados.filter(function (d) {
            return (d.endereco || '').toLowerCase().includes(busca) ||
                (d.produto || '').toLowerCase().includes(busca) ||
                (d.descricao || '').toLowerCase().includes(busca) ||
                (d.inventario_nome || '').toLowerCase().includes(busca) ||
                (d.operador || '').toLowerCase().includes(busca) ||
                (d.operador_responsavel || '').toLowerCase().includes(busca);
        });
    // Ordenação
    if (ford === 'maior_diff')
        dados = __spreadArray([], dados, true).sort(function (a, b) { return Math.abs(b.diferenca) - Math.abs(a.diferenca); });
    else if (ford === 'menor_diff')
        dados = __spreadArray([], dados, true).sort(function (a, b) { return Math.abs(a.diferenca) - Math.abs(b.diferenca); });
    else if (ford === 'endereco')
        dados = __spreadArray([], dados, true).sort(function (a, b) { return (a.endereco || '').localeCompare(b.endereco || ''); });
    else
        dados = __spreadArray([], dados, true).sort(function (a, b) { return (b.criada_em || '').localeCompare(a.criada_em || ''); });
    // Populat filtros dinâmicos (rua, nível, setor, produto, operador)
    var _popSel = function (id, valores, cur, emptyLabel) {
        var el = document.getElementById(id);
        if (!el)
            return;
        el.innerHTML = "<option value=\"\">".concat(emptyLabel, "</option>") +
            valores.map(function (v) { return "<option value=\"".concat(v, "\" ").concat(v === cur ? 'selected' : '', ">").concat(v, "</option>"); }).join('');
        if (cur)
            el.value = cur;
    };
    var todasRuas = __spreadArray([], new Set(state().divergencias.map(function (d) { var _a; return (_a = getEnderecoInfo(d.endereco)) === null || _a === void 0 ? void 0 : _a.rua; }).filter(Boolean)), true).sort();
    var todosNiveis = __spreadArray([], new Set(state().divergencias.map(function (d) { var i = getEnderecoInfo(d.endereco); return (i === null || i === void 0 ? void 0 : i.nivel) || (i === null || i === void 0 ? void 0 : i.andar) || ''; }).filter(Boolean)), true).sort();
    var todosSetores = __spreadArray([], new Set(state().divergencias.map(function (d) { var i = getEnderecoInfo(d.endereco); return (i === null || i === void 0 ? void 0 : i.setor) || (i === null || i === void 0 ? void 0 : i.local) || (i === null || i === void 0 ? void 0 : i.nome_local) || ''; }).filter(Boolean)), true).sort();
    var todosProds = __spreadArray([], new Set(state().divergencias.map(function (d) { return d.produto; }).filter(Boolean)), true).sort();
    var todosOps = __spreadArray([], new Set(state().divergencias.map(function (d) {
        var cont = state().contagens.find(function (c) { return c.inventario_id === d.inventario_id && c.endereco === d.endereco && !c._excluida; });
        return d.operador || (cont === null || cont === void 0 ? void 0 : cont.operador) || '';
    }).filter(Boolean)), true).sort();
    _popSel('div-frua', todasRuas, fRua, 'Todas as ruas');
    _popSel('div-fnivel', todosNiveis, fNivel, 'Todos os níveis');
    _popSel('div-fsetor', todosSetores, fSetor, 'Todos os setores');
    _popSel('div-fproduto', todosProds, fProduto, 'Todos os produtos');
    _popSel('div-foperador', todosOps, fOperador, 'Todos os operadores');
    // KPIs
    var all = state().divergencias.filter(function (d) { return !fInv || d.inventario_id === fInv; });
    var abertas = all.filter(function (d) { return d.status === 'ABERTA'; }).length;
    var emRec = all.filter(function (d) { return d.status === 'EM_RECONTAGEM'; }).length;
    var resolvidas = all.filter(function (d) { return d.status === 'RESOLVIDA'; }).length;
    var persistentes = all.filter(function (d) { return d.status === 'PERSISTENTE'; }).length;
    var naoIdent = all.filter(function (d) { return d.tipo_divergencia === 'PRODUTO_NAO_IDENTIFICADO'; }).length;
    var foraEnd = all.filter(function (d) { return d.tipo_divergencia === 'PRODUTO_FORA_ENDERECO'; }).length;
    var pendentes = all.filter(function (d) { return (d.status_recontagem || '') === 'pendente'; }).length;
    var aguardAnalista = all.filter(function (d) { return (d.status_recontagem || '') === 'aguardando_analista'; }).length;
    var total = all.length;
    var pctRes = total > 0 ? Math.round((resolvidas / total) * 100) : 0;
    var setEl = function (id, v) { var el = document.getElementById(id); if (el)
        el.textContent = v; };
    setEl('dk-abertas', abertas);
    setEl('dk-em-rec', emRec);
    setEl('dk-resolvidas', resolvidas);
    setEl('dk-pct', pctRes + '%');
    setEl('dk-nao-ident', naoIdent);
    setEl('dk-fora-end', foraEnd);
    setEl('dk-persistente', persistentes);
    setEl('dk-pendentes', pendentes);
    setEl('dk-aguard-analista', aguardAnalista);
    if (!dados.length) {
        document.getElementById('div-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\u2705</div><div class=\"empty-title\">Nenhum conflito encontrado</div><div class=\"empty-sub\">Clique em \"Processar Contagens\" para cruzar a base com as contagens recebidas</div></div>";
        return;
    }
    document.getElementById('div-table-wrap').innerHTML = "\n    <div class=\"tbl-wrap\"><table>\n      <thead><tr>\n        <th style=\"width:36px;padding:8px 10px\">\n          <input type=\"checkbox\" id=\"div-chk-all\" title=\"Selecionar todos\"\n            style=\"width:15px;height:15px;cursor:pointer;accent-color:var(--orange)\"\n            onchange=\"divToggleTodos(this.checked)\">\n        </th>\n        <th>Invent\u00E1rio</th><th>Rua</th><th>Endere\u00E7o</th><th>Produto</th>\n        <th>Operador Contagem</th><th>Data</th><th>Tipo</th>\n        <th>Sistema</th><th>1\u00AA Contagem</th><th>Resultado</th>\n        <th>Status</th><th>Status Recontagem</th><th>Atribu\u00EDdo para</th><th>Executado por</th><th>A\u00E7\u00F5es</th>\n      </tr></thead>\n      <tbody>\n        ".concat(dados.map(function (d) {
        var difColor = d.diferenca > 0 ? 'var(--warn)' : d.diferenca < 0 ? 'var(--danger)' : 'var(--success)';
        var rec = state().recontagens
            .filter(function (r) { return r.divergencia_id === d.id; })
            .sort(function (a, b) { return (b.numero_recontagem || 1) - (a.numero_recontagem || 1); })[0] || null;
        var endInfo = getEnderecoInfo(d.endereco);
        var rua = (endInfo === null || endInfo === void 0 ? void 0 : endInfo.rua) || '—';
        var cont = state().contagens.find(function (c) { return c.inventario_id === d.inventario_id && c.endereco === d.endereco && !c._excluida; });
        var operador = d.operador || (cont === null || cont === void 0 ? void 0 : cont.operador) || '—';
        var selecionado = _divSelecionadas.has(d.id);
        var tipoCls, tipoTxt;
        switch (d.tipo_divergencia) {
            case 'PRODUTO_NAO_IDENTIFICADO':
                tipoCls = 'b-red';
                tipoTxt = '❓ Prod. não ident.';
                break;
            case 'PRODUTO_FORA_ENDERECO':
                tipoCls = 'b-purple';
                tipoTxt = '📦 Fora endereço';
                break;
            case 'VAZIO_COM_PRODUTO_NA_BASE':
                tipoCls = 'b-yellow';
                tipoTxt = '📭 Vazio c/ produto';
                break;
            default:
                tipoCls = d.diferenca > 0 ? 'b-yellow' : 'b-red';
                tipoTxt = d.diferenca > 0 ? '📈 Sobra' : '📉 Falta';
        }
        var qtdEspTxt = d.qtd_esperada != null ? d.qtd_esperada : '—';
        var qtdContTxt = d.qtd_contada != null ? d.qtd_contada : '—';
        var difTxt = d.diferenca != null ? (d.diferenca > 0 ? '+' + d.diferenca : String(d.diferenca)) : '—';
        var difColorTxt = d.diferenca != null ? difColor : 'var(--muted)';
        // Status recontagem
        var statusRec = d.status_recontagem || (rec ? (rec.status === 'CONCLUIDA' ? 'concluida' : 'pendente') : '');
        var atribPara = d.operador_responsavel || (rec === null || rec === void 0 ? void 0 : rec.operador) || '';
        var executadoPor = (rec === null || rec === void 0 ? void 0 : rec.operador_recontagem) || d.operador_recontagem || '';
        return "<tr style=\"".concat(selecionado ? 'background:rgba(232,117,26,.06)' : '', "\">\n            <td style=\"padding:8px 10px\">\n              <input type=\"checkbox\" class=\"div-row-chk\" data-id=\"").concat(d.id, "\"\n                style=\"width:15px;height:15px;cursor:pointer;accent-color:var(--orange)\"\n                ").concat(selecionado ? 'checked' : '', "\n                onchange=\"divToggleSel('").concat(d.id, "', this.checked)\">\n            </td>\n            <td style=\"font-size:.75rem;color:var(--muted)\">").concat(d.inventario_nome || d.inventario_id, "</td>\n            <td class=\"mono\" style=\"font-weight:600\">").concat(rua, "</td>\n            <td class=\"mono\">").concat(escHTML(d.endereco)).concat(d.endereco_correto ? "<br><span style=\"font-size:.65rem;color:var(--muted)\">\u2192 ".concat(escHTML(d.endereco_correto), "</span>") : '', "</td>\n            <td>\n              <div style=\"font-weight:600;font-size:.82rem\">").concat(escHTML(d.produto), "</div>\n              <div style=\"font-size:.7rem;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">").concat(escHTML(d.descricao || ''), "</div>\n              ").concat(d.gtin_bipado ? "<div style=\"font-size:.65rem;color:var(--muted)\">GTIN: ".concat(d.gtin_bipado, "</div>") : '', "\n            </td>\n            <td style=\"font-size:.8rem\">").concat(operador, "</td>\n            <td class=\"mono\" style=\"font-size:.72rem;color:var(--muted);white-space:nowrap\">").concat(fmtTs(d.criada_em), "</td>\n            <td><span class=\"badge ").concat(tipoCls, "\">").concat(tipoTxt, "</span></td>\n            <td class=\"mono\" style=\"font-weight:700\">").concat(qtdEspTxt).concat(d.produto ? "<div style=\"font-size:.6rem;color:var(--muted);font-family:var(--mono)\">".concat(escHTML(d.produto), "</div>") : '', "</td>\n            ").concat((function () {
            // Reutilizável: renderiza célula de contagem com produto e cor
            var _ndpD = function (v) { return String(v || '').trim().toUpperCase(); };
            var prodEspD = _ndpD(d.produto);
            var _qtdC1 = d.qtd_contada != null ? d.qtd_contada : '—';
            var _qtdEsp = parseFloat(d.qtd_esperada);
            var _bateC1 = !isNaN(_qtdEsp) && d.qtd_contada === _qtdEsp;
            var _corC1 = _bateC1 ? 'var(--success)' : 'var(--danger)';
            var _c1Cell = "<td><div style=\"font-family:var(--mono);font-weight:800;color:".concat(_corC1, "\">").concat(_qtdC1, "</div>").concat(d.operador ? "<div style=\"font-size:.65rem;color:var(--muted)\">".concat(d.operador, "</div>") : '', "</td>");
            return _c1Cell;
        })(), "\n            ").concat((function () {
            var _a, _b, _c, _d;
            var recFinal = state().recontagens
                .filter(function (r) { return r.divergencia_id === d.id; })
                .sort(function (a, b) { return (b.numero_recontagem || 1) - (a.numero_recontagem || 1); })[0] || null;
            var qtdRes = (_d = (_c = (_b = (_a = d.qtd_resultado_final) !== null && _a !== void 0 ? _a : recFinal === null || recFinal === void 0 ? void 0 : recFinal.qtd_recontagem) !== null && _b !== void 0 ? _b : recFinal === null || recFinal === void 0 ? void 0 : recFinal.qtd_terceira) !== null && _c !== void 0 ? _c : recFinal === null || recFinal === void 0 ? void 0 : recFinal.qtd_segunda) !== null && _d !== void 0 ? _d : null;
            var opRes = (recFinal === null || recFinal === void 0 ? void 0 : recFinal.operador_segunda) || (recFinal === null || recFinal === void 0 ? void 0 : recFinal.operador) || '';
            var motivo = d.contagem_aceita || '';
            if (qtdRes == null)
                return '<td style="color:var(--muted);font-size:.75rem;text-align:center">—</td>';
            var qtdEspN = parseFloat(d.qtd_esperada);
            var bate = !isNaN(qtdEspN) && parseFloat(qtdRes) === qtdEspN;
            var cor = bate ? 'var(--success)' : 'var(--danger)';
            var icone = bate ? '✅' : '❌';
            var mTxt = motivo === 'SEGUNDA_CONTAGEM' ? '2ª bateu sistema'
                : motivo === 'TERCEIRA_SEM_CONSENSO' ? '3 rodadas sem consenso'
                    : motivo === 'LIBERACAO_ANALISTA' ? 'Liberado pelo analista'
                        : motivo ? motivo.replace(/_/g, ' ').toLowerCase() : '';
            var cell = '<td><div style="font-family:var(--mono);font-weight:800;color:' + cor + '">' + icone + ' ' + qtdRes + '</div>';
            if (opRes)
                cell += '<div style="font-size:.65rem;color:var(--muted)">' + opRes + '</div>';
            if (mTxt)
                cell += '<div style="font-size:.62rem;color:var(--muted);font-style:italic">' + mTxt + '</div>';
            cell += '</td>';
            return cell;
        })(), "\n                        <td><span class=\"badge ").concat(divStatusBadge(d.status), "\">").concat(d.status, "</span></td>\n            <td>\n              ").concat(statusRec
            ? "<span class=\"badge ".concat(recStatusBadge(statusRec), "\" style=\"font-size:.68rem\">").concat(recStatusLabel(statusRec), "</span>")
            : "<span style=\"font-size:.72rem;color:var(--muted-2)\">\u2014</span>", "\n            </td>\n            <td>\n              ").concat(atribPara
            ? "<div style=\"font-size:.78rem;font-weight:600;color:var(--text)\">".concat(escHTML(atribPara), "</div>\n                   ").concat(d.atribuido_em ? "<div style=\"font-size:.65rem;color:var(--muted)\">".concat(fmtTs(d.atribuido_em), "</div>") : '')
            : "<span style=\"font-size:.72rem;color:var(--muted-2)\">N\u00E3o atribu\u00EDdo</span>", "\n            </td>\n            <td>\n              ").concat(executadoPor
            ? "<div style=\"font-size:.78rem;font-weight:700;color:var(--success)\">".concat(escHTML(executadoPor), "</div>\n                   ").concat((rec === null || rec === void 0 ? void 0 : rec.recontagem_concluida_em) ? "<div style=\"font-size:.65rem;color:var(--muted)\">".concat(fmtTs(rec.recontagem_concluida_em), "</div>") : '')
            : "<span style=\"font-size:.72rem;color:var(--muted-2)\">\u2014</span>", "\n            </td>\n            <td style=\"white-space:nowrap\">\n              <div style=\"display:flex;gap:4px;flex-wrap:wrap\">\n                ").concat(d.status === 'PERSISTENTE'
            ? "<span style=\"font-size:.68rem;color:var(--danger);font-weight:700;padding:3px 8px;background:rgba(217,32,32,.10);border-radius:6px;border:1px solid rgba(217,32,32,.25)\">\uD83D\uDD12 Encerrado</span>"
            : d.status !== 'RESOLVIDA'
                ? "<button class=\"btn btn-success btn-sm\" onclick=\"marcarDivergenciaResolvida('".concat(d.id, "')\" title=\"Marcar como resolvida\" style=\"font-size:.7rem\">\u2713 Resolver</button>")
                : "<span style=\"font-size:.7rem;color:var(--muted)\">".concat(fmtTs(d.resolvida_em), "</span>"), "\n                ").concat((d.status !== 'RESOLVIDA' && d.status !== 'PERSISTENTE')
            ? (atribPara
                ? "<button class=\"btn btn-ghost btn-sm\" style=\"font-size:.7rem;color:var(--danger);border-color:var(--danger)\" onclick=\"desvincularRecontagem('".concat(d.id, "')\" title=\"Desvincular operador\">\uD83D\uDD13 Desvincular</button>")
                : (!_isFluxoEncerrado(d) ? "<button class=\"btn btn-ghost btn-sm\" style=\"font-size:.7rem\" onclick=\"divAtribuirRapido('".concat(d.id, "')\" title=\"Atribuir recontagem\">\uD83D\uDC64 Atribuir</button>") : ''))
            : '', "\n              </div>\n            </td>\n          </tr>");
    }).join(''), "\n      </tbody>\n    </table></div>");
}
// ───────────────────────────────────────────────────────────────────
//  17. RENDERIZAÇÃO — RECONTAGENS
// ───────────────────────────────────────────────────────────────────
function renderRecontagens() {
    var _a, _b, _c, _d, _e, _f, _g;
    var busca = (((_a = document.getElementById('rec-busca')) === null || _a === void 0 ? void 0 : _a.value) || '').toLowerCase();
    var fInv = ((_b = document.getElementById('rec-sel-inv')) === null || _b === void 0 ? void 0 : _b.value) || '';
    var fStatus = ((_c = document.getElementById('rec-fstatus')) === null || _c === void 0 ? void 0 : _c.value) || '';
    var fStatusRec = ((_d = document.getElementById('rec-fstatus-rec')) === null || _d === void 0 ? void 0 : _d.value) || '';
    var fOperador = ((_e = document.getElementById('rec-foperador')) === null || _e === void 0 ? void 0 : _e.value) || '';
    var fRua = ((_f = document.getElementById('rec-frua')) === null || _f === void 0 ? void 0 : _f.value) || '';
    var ford = ((_g = document.getElementById('rec-ford')) === null || _g === void 0 ? void 0 : _g.value) || '';
    // Popular select inventários
    var selInv = document.getElementById('rec-sel-inv');
    if (selInv) {
        var cur_2 = selInv.value;
        selInv.innerHTML = '<option value="">Todos os inventários</option>' +
            state().inventarios.map(function (i) { return "<option value=\"".concat(i.id, "\" ").concat(i.id === cur_2 ? 'selected' : '', ">").concat(i.codigo, " \u2014 ").concat(i.nome, "</option>"); }).join('');
        if (cur_2)
            selInv.value = cur_2;
    }
    // Por divergencia, mostrar apenas o rec com maior numero_recontagem (mais recente).
    // Evita linhas duplicadas quando há rec1 (CONCLUIDA) + rec3 (PENDENTE/CONCLUIDA).
    var _recPorDiv = {};
    state().recontagens.forEach(function (r) {
        var key = r.divergencia_id || r.id;
        var ex = _recPorDiv[key];
        if (!ex || (r.numero_recontagem || 1) > (ex.numero_recontagem || 1))
            _recPorDiv[key] = r;
    });
    var dados = Object.values(_recPorDiv);
    if (fInv)
        dados = dados.filter(function (r) { return String(r.inventario_id || r.inventarioId || '') === String(fInv); });
    if (fStatus)
        dados = dados.filter(function (r) { return r.status === fStatus; });
    if (fRua)
        dados = dados.filter(function (r) { var _a; return (((_a = getEnderecoInfo(r.endereco)) === null || _a === void 0 ? void 0 : _a.rua) || '—') === fRua; });
    // Filtro por status de recontagem (campo novo + derivado da divergência)
    if (fStatusRec) {
        dados = dados.filter(function (r) {
            var div = state().divergencias.find(function (d) { return d.id === r.divergencia_id; });
            var sr = r.status_recontagem || (div === null || div === void 0 ? void 0 : div.status_recontagem) || '';
            var temAtrib = r.operador || (div === null || div === void 0 ? void 0 : div.operador_responsavel);
            if (fStatusRec === 'nao_atribuida')
                return !temAtrib;
            return sr === fStatusRec;
        });
    }
    // Filtro por operador atribuído
    if (fOperador) {
        dados = dados.filter(function (r) {
            var div = state().divergencias.find(function (d) { return d.id === r.divergencia_id; });
            return (r.operador || (div === null || div === void 0 ? void 0 : div.operador_responsavel) || '') === fOperador || (r.operador_recontagem || (div === null || div === void 0 ? void 0 : div.operador_recontagem) || '') === fOperador;
        });
    }
    if (busca)
        dados = dados.filter(function (r) {
            return (r.endereco || '').toLowerCase().includes(busca) ||
                (r.produto || '').toLowerCase().includes(busca) ||
                (r.descricao || '').toLowerCase().includes(busca) ||
                (r.inventario_nome || '').toLowerCase().includes(busca) ||
                (r.operador || '').toLowerCase().includes(busca) ||
                (r.operador_recontagem || '').toLowerCase().includes(busca);
        });
    // Ordenação
    if (ford === 'maior_diff')
        dados = __spreadArray([], dados, true).sort(function (a, b) { return Math.abs(b.qtd_primeira - b.qtd_esperada) - Math.abs(a.qtd_primeira - a.qtd_esperada); });
    else if (ford === 'endereco')
        dados = __spreadArray([], dados, true).sort(function (a, b) { return (a.endereco || '').localeCompare(b.endereco || ''); });
    else if (ford === 'atribuicao')
        dados = __spreadArray([], dados, true).sort(function (a, b) {
            var da = state().divergencias.find(function (d) { return d.id === a.divergencia_id; });
            var db2 = state().divergencias.find(function (d) { return d.id === b.divergencia_id; });
            return (((db2 === null || db2 === void 0 ? void 0 : db2.atribuido_em) || b.atribuido_em || '').localeCompare((da === null || da === void 0 ? void 0 : da.atribuido_em) || a.atribuido_em || ''));
        });
    else
        dados = __spreadArray([], dados, true).sort(function (a, b) { return (b.criada_em || '').localeCompare(a.criada_em || ''); });
    // Popular filtros dinâmicos
    var selRua = document.getElementById('rec-frua');
    if (selRua) {
        var ruas = __spreadArray([], new Set(state().recontagens.map(function (r) { var _a; return ((_a = getEnderecoInfo(r.endereco)) === null || _a === void 0 ? void 0 : _a.rua) || '—'; })), true).sort();
        selRua.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(function (r) { return "<option value=\"".concat(r, "\" ").concat(r === fRua ? 'selected' : '', ">").concat(r, "</option>"); }).join('');
    }
    var selOp = document.getElementById('rec-foperador');
    if (selOp) {
        var cur_3 = selOp.value;
        var ops = __spreadArray([], new Set(state().recontagens.flatMap(function (r) {
            var div = state().divergencias.find(function (d) { return d.id === r.divergencia_id; });
            return [r.operador || (div === null || div === void 0 ? void 0 : div.operador_responsavel) || '', r.operador_recontagem || (div === null || div === void 0 ? void 0 : div.operador_recontagem) || ''];
        }).filter(Boolean)), true).sort();
        selOp.innerHTML = '<option value="">Todos os operadores</option>' + ops.map(function (o) { return "<option value=\"".concat(o, "\" ").concat(o === cur_3 ? 'selected' : '', ">").concat(o, "</option>"); }).join('');
        if (cur_3)
            selOp.value = cur_3;
    }
    // KPIs
    var allRec = state().recontagens.filter(function (r) { return !fInv || r.inventario_id === fInv; });
    var pendentes = allRec.filter(function (r) { return r.status === 'PENDENTE'; }).length;
    var concluidas = allRec.filter(function (r) { return r.status === 'CONCLUIDA'; }).length;
    var atribuidas = allRec.filter(function (r) {
        var div = state().divergencias.find(function (d) { return d.id === r.divergencia_id; });
        return r.operador || (div === null || div === void 0 ? void 0 : div.operador_responsavel);
    }).length;
    var naoAtribuidas = allRec.filter(function (r) {
        var div = state().divergencias.find(function (d) { return d.id === r.divergencia_id; });
        return !r.operador && !(div === null || div === void 0 ? void 0 : div.operador_responsavel);
    }).length;
    var pctRes = allRec.length > 0 ? Math.round((concluidas / allRec.length) * 100) : 0;
    var maiorDiff = allRec.length > 0
        ? Math.max.apply(Math, allRec.map(function (r) { return Math.abs((r.qtd_primeira || 0) - (r.qtd_esperada || 0)); })) : 0;
    var persistentesRec = allRec.filter(function (r) {
        return (r.status_recontagem || '') === 'persistente' ||
            (r.status_bloqueio || '') === 'PERSISTENTE_BLOQUEADO';
    }).length;
    var setK = function (id, v) { var el = document.getElementById(id); if (el)
        el.textContent = v; };
    setK('rk-pendentes', pendentes);
    setK('rk-concluidas', concluidas);
    setK('rk-atribuidas', atribuidas);
    setK('rk-nao-atribuidas', naoAtribuidas);
    setK('rk-persistentes', persistentesRec);
    setK('rk-maior-diff', maiorDiff || '—');
    setK('rk-pct', pctRes + '%');
    if (!dados.length) {
        document.getElementById('rec-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDD04</div><div class=\"empty-title\">Nenhuma recontagem encontrada</div><div class=\"empty-sub\">Recontagens s\u00E3o criadas ao processar diverg\u00EAncias. Use \"Atribuir Recontagem\" nas diverg\u00EAncias para distribuir para operadores.</div></div>";
        return;
    }
    document.getElementById('rec-table-wrap').innerHTML = "\n    <div class=\"tbl-wrap\"><table>\n      <thead><tr>\n        <th>Invent\u00E1rio</th><th>Rua</th><th>Endere\u00E7o</th><th>Produto</th>\n        <th>Qtd Sistema</th>\n        <th>Contagem 1</th><th>Contagem 2</th><th>Contagem 3</th>\n        <th>Atribu\u00EDdo para</th><th>Executado por</th>\n        <th>Status</th><th>A\u00E7\u00F5es</th>\n      </tr></thead>\n      <tbody>\n        ".concat(dados.map(function (r) {
        var _a;
        var endInfo = getEnderecoInfo(r.endereco);
        var rua = (endInfo === null || endInfo === void 0 ? void 0 : endInfo.rua) || '—';
        // Buscar divergência correspondente
        var div = state().divergencias.find(function (d) { return d.id === r.divergencia_id; });
        var atribPara = r.operador || (div === null || div === void 0 ? void 0 : div.operador_responsavel) || '—';
        var atribEm = r.atribuido_em || (div === null || div === void 0 ? void 0 : div.atribuido_em) || '';
        var atribPor = r.atribuido_por || (div === null || div === void 0 ? void 0 : div.atribuido_por) || '';
        var statusRec = r.status_recontagem || (div === null || div === void 0 ? void 0 : div.status_recontagem) || (r.status === 'CONCLUIDA' ? 'concluida' : 'pendente');
        var obsAtrib = r.observacao_atribuicao || (div === null || div === void 0 ? void 0 : div.observacao_atribuicao) || '';
        var naoAtribuido = atribPara === '—' || !atribPara;
        var executadoPor = r.operador_recontagem || (div === null || div === void 0 ? void 0 : div.operador_recontagem) || '';
        // ── Células das 3 contagens — exibe produto E quantidade ──
        var _ndp = function (v) { return String(v || '').trim().toUpperCase(); };
        var prodEsp = _ndp(r.produto);
        var _cellCont = function (qtd, op, data, prodContado) {
            if (qtd === null || qtd === undefined) {
                return "<td style=\"color:var(--muted-2);font-size:.78rem;text-align:center\">\u2014</td>";
            }
            var qtdEsp = parseFloat(r.qtd_esperada);
            var qtdBate = !isNaN(qtdEsp) && qtd === qtdEsp;
            var prodBate = !prodContado || _ndp(prodContado) === '' || _ndp(prodContado) === prodEsp;
            var tudoBate = qtdBate && prodBate;
            var corQtd = tudoBate ? 'var(--success)' : (qtdBate && !prodBate ? 'var(--warn)' : 'var(--danger)');
            var prodDivBadge = (!prodBate && prodContado)
                ? "<div style=\"font-size:.6rem;color:var(--danger);font-family:var(--mono);font-weight:700;background:rgba(217,32,32,.08);border-radius:3px;padding:1px 4px;margin-top:2px\" title=\"Produto diferente do esperado (".concat(prodEsp, ")\">\u26A0\uFE0F ").concat(_ndp(prodContado), "</div>")
                : '';
            return "<td>\n              <div style=\"font-family:var(--mono);font-weight:800;font-size:.92rem;color:".concat(corQtd, "\">").concat(qtd, "</div>\n              ").concat(prodDivBadge, "\n              ").concat(op ? "<div style=\"font-size:.65rem;color:var(--muted)\">".concat(op, "</div>") : '', "\n              ").concat(data ? "<div style=\"font-size:.6rem;color:var(--muted-2)\">".concat(fmtTs(data), "</div>") : '', "\n            </td>");
        };
        return "<tr>\n            <td style=\"font-size:.75rem;color:var(--muted)\">".concat(r.inventario_nome || r.inventario_id, "</td>\n            <td class=\"mono\" style=\"font-weight:600\">").concat(rua, "</td>\n            <td class=\"mono\">").concat(r.endereco, "</td>\n            <td>\n              <div style=\"font-weight:600;font-size:.82rem\">").concat(r.produto, "</div>\n              <div style=\"font-size:.7rem;color:var(--muted)\">").concat(r.descricao || '', "</div>\n            </td>\n            <td class=\"mono\" style=\"font-weight:700\">").concat((_a = r.qtd_esperada) !== null && _a !== void 0 ? _a : '—', "</td>\n            ").concat(_cellCont(r.qtd_primeira, r.operador_primeira, r.data_primeira, r.produto_primeira || r.produto), "\n            ").concat(_cellCont(r.qtd_segunda, r.operador_segunda, r.data_segunda, r.produto_segunda), "\n            ").concat(_cellCont(r.qtd_terceira, r.operador_terceira, r.data_terceira, r.produto_terceira), "\n            <td>\n              ").concat(naoAtribuido
            ? "<span style=\"font-size:.75rem;color:var(--muted-2)\">N\u00E3o atribu\u00EDdo</span>"
            : "<div style=\"font-weight:600;font-size:.82rem;color:var(--text)\">".concat(atribPara, "</div>\n                   ").concat(atribPor ? "<div style=\"font-size:.65rem;color:var(--muted)\">por ".concat(atribPor, "</div>") : '', "\n                   ").concat(obsAtrib ? "<div style=\"font-size:.68rem;color:var(--text-2);font-style:italic;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\" title=\"".concat(obsAtrib, "\">\uD83D\uDCAC ").concat(obsAtrib, "</div>") : ''), "\n            </td>\n            <td>\n              ").concat(executadoPor
            ? "<div style=\"font-weight:700;font-size:.82rem;color:var(--success)\">".concat(escHTML(executadoPor), "</div>\n                   ").concat(r.recontagem_concluida_em ? "<div style=\"font-size:.65rem;color:var(--muted)\">".concat(fmtTs(r.recontagem_concluida_em), "</div>") : '')
            : "<span style=\"font-size:.75rem;color:var(--muted-2)\">\u2014</span>", "\n            </td>\n            <td>\n              ").concat(statusRec
            ? "<span class=\"badge ".concat(recStatusBadge(statusRec), "\" style=\"font-size:.7rem\">").concat(recStatusLabel(statusRec), "</span>")
            : "<span class=\"badge b-yellow\" style=\"font-size:.7rem\">\u23F3 Pendente</span>", "\n            </td>\n            <td style=\"white-space:nowrap\">\n              <div style=\"display:flex;gap:4px;flex-wrap:wrap\">\n                ").concat(_isFluxoEncerrado(r)
            ? "<span style=\"font-size:.68rem;color:var(--danger);font-weight:700;padding:3px 8px;background:rgba(217,32,32,.10);border-radius:6px;border:1px solid rgba(217,32,32,.25)\">\uD83D\uDD12 Encerrado</span>"
            : r.status === 'PENDENTE'
                ? "<button class=\"btn btn-primary btn-sm\" onclick=\"abrirRegistrarRecontagem('".concat(r.id, "')\" style=\"font-size:.72rem\">\uD83D\uDCDD Registrar</button>")
                : "<span style=\"font-size:.72rem;color:var(--muted)\">".concat(fmtTs(r.concluida_em), "</span>"), "\n                ").concat((!_isFluxoEncerrado(r) && naoAtribuido)
            ? "<button class=\"btn btn-ghost btn-sm\" onclick=\"divAtribuirPorRec('".concat(r.id, "')\" style=\"font-size:.72rem\" title=\"Atribuir a um operador\">\uD83D\uDC64 Atribuir</button>")
            : '', "\n              </div>\n            </td>\n          </tr>");
    }).join(''), "\n      </tbody>\n    </table></div>");
}
