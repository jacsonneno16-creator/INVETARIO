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
var _divDadosFiltradosExport = [];
var _recDadosFiltradosExport = [];
function divPodeSelecionar(div) {
    var _a, _b;
    if (!div)
        return false;
    var status = String(div.status || '').toUpperCase();
    var statusRec = String(div.status_recontagem || '').toLowerCase();
    if (['RESOLVIDA', 'PERSISTENTE', 'CANCELADA'].includes(status))
        return false;
    if (['resolvida', 'sem_divergencia', 'cancelada', 'persistente'].includes(statusRec))
        return false;
    var recsValidas = (state().recontagens || []).filter(function (r) {
        return String(r.divergencia_id || '') === String(div.id || '') &&
            !['CANCELADA', 'EXCLUIDA'].includes(String(r.status || '').toUpperCase()) &&
            !['cancelada', 'excluida'].includes(String(r.status_recontagem || '').toLowerCase());
    });
    var concluidas = recsValidas.filter(function (r) {
        var st = String(r.status || '').toUpperCase();
        var sr = String(r.status_recontagem || '').toLowerCase();
        return st === 'CONCLUIDA' || sr === 'concluida' || Boolean(r.recontagem_concluida_em || r.concluida_em || r.finalizada_em);
    });
    if (concluidas.length >= 2 || div.qtd_terceira != null)
        return false;
    var avaliacao = (_b = (_a = window.AnalistaDivergenciasRuntime) === null || _a === void 0 ? void 0 : _a.avaliarEndereco) === null || _b === void 0 ? void 0 : _b.call(_a, div);
    if ((avaliacao === null || avaliacao === void 0 ? void 0 : avaliacao.estado) === 'RESOLVIDA' || (avaliacao === null || avaliacao === void 0 ? void 0 : avaliacao.estado) === 'PERSISTENTE')
        return false;
    // Divergência aberta ou aguardando analista deve continuar selecionável,
    // mesmo quando registros antigos deixaram flags inconsistentes de encerramento.
    if (['ABERTA', 'EM_RECONTAGEM', 'DIVERGENTE'].includes(status) ||
        ['', 'pendente', 'aguardando_analista', 'concluida'].includes(statusRec))
        return true;
    return !(typeof _isFluxoEncerrado === 'function' && _isFluxoEncerrado(div));
}
function divStatusBadge(status) {
    switch (String(status || '').toUpperCase()) {
        case 'ABERTA': return 'b-red';
        case 'EM_RECONTAGEM': return 'b-orange';
        case 'RESOLVIDA': return 'b-green';
        case 'PERSISTENTE': return 'b-gray';
        default: return 'b-gray';
    }
}
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
    var div = state().divergencias.find(function (d) { return d.id === id; });
    if (checked && divPodeSelecionar(div))
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
    var div = state().divergencias.find(function (d) { return d.id === divId; });
    var recontagensValidas = state().recontagens.filter(function (r) {
        return r.divergencia_id === divId &&
            !['CANCELADA', 'EXCLUIDA'].includes(String(r.status || '').toUpperCase()) &&
            !['cancelada', 'excluida'].includes(String(r.status_recontagem || '').toLowerCase());
    });
    var concluidas = recontagensValidas.filter(function (r) {
        return String(r.status || '').toUpperCase() === 'CONCLUIDA' ||
            String(r.status_recontagem || '').toLowerCase() === 'concluida' ||
            Boolean(r.recontagem_concluida_em || r.concluida_em || r.finalizada_em);
    }).length;
    if (!div || !divPodeSelecionar(div) || div.qtd_terceira != null || concluidas >= 2) {
        showToast('🔒 Esta atividade já atingiu o limite de contagens ou está encerrada.', 'e');
        return;
    }
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
                    _divSelecionadas = new Set(__spreadArray([], _divSelecionadas, true).filter(function (id) {
                        return divPodeSelecionar(state().divergencias.find(function (d) { return d.id === id; }));
                    }));
                    divAtualizarBarraSel();
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
        if (!divPodeSelecionar(d))
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
    // A Recontagem é um processo por endereço. Motivos diferentes detectados
    // no mesmo inventário/endereço devem ocupar uma única linha, sem esconder
    // o histórico das rodadas nem inflar os indicadores.
    var gruposPorEndereco = new Map();
    var divergenciasVisiveis = __spreadArray([], state().divergencias, true);
    // Uma rodada pode continuar existindo no Firebase mesmo quando a divergência
    // vinculada foi removida/arquivada por versões anteriores. O menu contava essa
    // rodada, mas a tela renderizava apenas divergências e, por isso, ficava vazia.
    // Recompõe um caso visual a partir da própria recontagem para não esconder a
    // atividade pendente do Analista.
    state().recontagens.forEach(function (r) {
        var _a, _b, _c;
        var vinculada = divergenciasVisiveis.some(function (d) {
            return ((r.divergencia_id && String(d.id) === String(r.divergencia_id)) ||
                (String(d.inventario_id || '') === String(r.inventario_id || r.inventarioId || '') &&
                    String(d.endereco || '').trim().toUpperCase() === String(r.endereco || '').trim().toUpperCase()));
        });
        if (vinculada)
            return;
        var statusRec = String(r.status_recontagem || r.status || '').toLowerCase();
        var concluida = ['concluida', 'resolvida'].includes(statusRec);
        var persistente = statusRec === 'persistente' ||
            String(r.status_bloqueio || '').toUpperCase() === 'PERSISTENTE_BLOQUEADO';
        divergenciasVisiveis.push(__assign(__assign({}, r), { id: r.divergencia_id || "recontagem-".concat(r.id), _recontagem_orfa_id: r.id, inventario_id: r.inventario_id || r.inventarioId || '', status: persistente ? 'PERSISTENTE' : (concluida ? 'RESOLVIDA' :
                (statusRec === 'aguardando_analista' ? 'ABERTA' : 'EM_RECONTAGEM')), status_recontagem: concluida ? 'concluida' : statusRec, operador_responsavel: r.operador_responsavel || r.operador || '', criada_em: r.criada_em || r.atribuido_em || r.data || '', tipo_divergencia: r.tipo_divergencia || 'RECONTAGEM_PENDENTE', motivos_divergencia: r.motivos_divergencia || ['Recontagem pendente'], produto: r.produto || r.gtin || r.codigo || '', quantidade_contada: (_c = (_b = (_a = r.quantidade_contada) !== null && _a !== void 0 ? _a : r.quantidade) !== null && _b !== void 0 ? _b : r.qtd) !== null && _c !== void 0 ? _c : null }));
    });
    var _invCanonicoHist = function (obj) {
        var bruto = String((obj === null || obj === void 0 ? void 0 : obj.inventario_id) || (obj === null || obj === void 0 ? void 0 : obj.inventarioId) || (obj === null || obj === void 0 ? void 0 : obj.inventario) || '').trim();
        var inv = (state().inventarios || []).find(function (i) {
            return [i.id, i.codigo, i.nome, i.inventario_id, i.inventarioId].filter(Boolean).map(String).includes(bruto);
        });
        return String((inv === null || inv === void 0 ? void 0 : inv.id) || bruto);
    };
    var _chaveHist = function (obj) {
        return "".concat(_invCanonicoHist(obj), "|").concat(String((obj === null || obj === void 0 ? void 0 : obj.endereco) || '').trim().toUpperCase());
    };
    divergenciasVisiveis.forEach(function (d) {
        var chave = _chaveHist(d);
        var grupo = gruposPorEndereco.get(chave) || [];
        grupo.push(d);
        gruposPorEndereco.set(chave, grupo);
    });
    var dados = __spreadArray([], gruposPorEndereco.values(), true).map(function (grupo) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        var ordenado = __spreadArray([], grupo, true).sort(function (a, b) {
            var ativaA = !['RESOLVIDA', 'PERSISTENTE', 'CANCELADA'].includes(String(a.status || '').toUpperCase());
            var ativaB = !['RESOLVIDA', 'PERSISTENTE', 'CANCELADA'].includes(String(b.status || '').toUpperCase());
            var pa = (ativaA ? 10 : 0) + (String(a.status_recontagem || '').toLowerCase() === 'aguardando_analista' ? 3
                : (a.operador_responsavel ? 2 : 1));
            var pb = (ativaB ? 10 : 0) + (String(b.status_recontagem || '').toLowerCase() === 'aguardando_analista' ? 3
                : (b.operador_responsavel ? 2 : 1));
            return pb - pa || String(b.criada_em || '').localeCompare(String(a.criada_em || ''));
        });
        var principal = Object.assign({}, ordenado[0]);
        var recsEndereco = (state().recontagens || [])
            .filter(function (r) { return _chaveHist(r) === _chaveHist(principal); })
            .sort(function (a, b) { return String(a.recontagem_concluida_em || a.concluida_em || a.criada_em || '')
            .localeCompare(String(b.recontagem_concluida_em || b.concluida_em || b.criada_em || '')); });
        var recsExecutadas = recsEndereco.filter(function (r) {
            return r.qtd_recontagem != null || r.qtd_segunda != null || r.qtd_terceira != null ||
                ['CONCLUIDA', 'RESOLVIDA'].includes(String(r.status || '').toUpperCase());
        });
        var segunda = recsExecutadas[0] || {};
        var terceira = recsExecutadas[1] || {};
        principal._divergencias_agrupadas = grupo.map(function (x) { return x.id; });
        principal.motivos_divergencia = __spreadArray([], new Set(grupo.flatMap(function (x) {
            return Array.isArray(x.motivos_divergencia) ? x.motivos_divergencia : [x.tipo_divergencia];
        }).filter(Boolean)), true);
        principal.itens_esperados = grupo.flatMap(function (x) { return Array.isArray(x.itens_esperados) ? x.itens_esperados : []; });
        ['qtd_segunda', 'produto_segunda', 'operador_segunda', 'data_segunda',
            'qtd_terceira', 'produto_terceira', 'operador_terceira', 'data_terceira',
            'qtd_resultado_final', 'produto_recontagem', 'operador_recontagem'].forEach(function (campo) {
            var origem = ordenado.find(function (x) { return x[campo] != null && x[campo] !== ''; });
            if (origem)
                principal[campo] = origem[campo];
        });
        principal.qtd_segunda = (_b = (_a = principal.qtd_segunda) !== null && _a !== void 0 ? _a : segunda.qtd_segunda) !== null && _b !== void 0 ? _b : segunda.qtd_recontagem;
        principal.produto_segunda = principal.produto_segunda || segunda.produto_segunda || segunda.produto_recontagem || segunda.produto || '';
        principal.operador_segunda = principal.operador_segunda || segunda.operador_segunda || segunda.operador_recontagem || segunda.operador || '';
        principal.data_segunda = principal.data_segunda || segunda.data_segunda || segunda.recontagem_concluida_em || segunda.concluida_em || '';
        principal.qtd_terceira = (_d = (_c = principal.qtd_terceira) !== null && _c !== void 0 ? _c : terceira.qtd_terceira) !== null && _d !== void 0 ? _d : terceira.qtd_recontagem;
        principal.produto_terceira = principal.produto_terceira || terceira.produto_terceira || terceira.produto_recontagem || terceira.produto || '';
        principal.operador_terceira = principal.operador_terceira || terceira.operador_terceira || terceira.operador_recontagem || terceira.operador || '';
        principal.data_terceira = principal.data_terceira || terceira.data_terceira || terceira.recontagem_concluida_em || terceira.concluida_em || '';
        principal._recontagens_endereco = recsEndereco;
        principal._vezes_contado = 1 + (principal.qtd_segunda != null ? 1 : 0) + (principal.qtd_terceira != null ? 1 : 0);
        // Nunca confiar cegamente no status legado. O resultado deve ser
        // recalculado pelas rodadas reais: só há OK quando produto e quantidade
        // coincidem com o sistema ou com uma contagem anterior.
        var avaliacaoAtual = (_f = (_e = window.AnalistaDivergenciasRuntime) === null || _e === void 0 ? void 0 : _e.avaliarHistorico) === null || _f === void 0 ? void 0 : _f.call(_e, principal);
        if ((avaliacaoAtual === null || avaliacaoAtual === void 0 ? void 0 : avaliacaoAtual.estado) === 'RESOLVIDA' || (avaliacaoAtual === null || avaliacaoAtual === void 0 ? void 0 : avaliacaoAtual.estado) === 'PERSISTENTE') {
            principal.status = avaliacaoAtual.estado;
            principal.status_recontagem = avaliacaoAtual.estado === 'RESOLVIDA' ? 'sem_divergencia' : 'concluida';
            principal.contagem_aceita = avaliacaoAtual.referencia;
            principal.qtd_resultado_final = (_h = (_g = avaliacaoAtual.resultado) === null || _g === void 0 ? void 0 : _g.qtd) !== null && _h !== void 0 ? _h : null;
            principal.produto_resultado_final = ((_j = avaliacaoAtual.resultado) === null || _j === void 0 ? void 0 : _j.produto) || '';
            principal.divergencia_resolvida = avaliacaoAtual.estado === 'RESOLVIDA';
            principal.encerrada_definitivamente = true;
            principal.operador_responsavel = null;
        }
        else if ((avaliacaoAtual === null || avaliacaoAtual === void 0 ? void 0 : avaliacaoAtual.estado) === 'AGUARDANDO_ANALISTA') {
            principal.status = 'ABERTA';
            principal.status_recontagem = 'aguardando_analista';
            principal.precisa_recontagem = true;
            principal.contagem_aceita = null;
            principal.qtd_resultado_final = null;
            principal.produto_resultado_final = '';
            principal.divergencia_resolvida = false;
            principal.encerrada_definitivamente = false;
            principal.resolvida_em = null;
            principal.finalizada_em = null;
            principal.operador_responsavel = null;
        }
        return principal;
    });
    if (fInv)
        dados = dados.filter(function (d) { return d.inventario_id === fInv; });
    if (fStatus) {
        dados = dados.filter(function (d) { return d.status === fStatus; });
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
    _divDadosFiltradosExport = dados.slice();
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
    // Os indicadores usam a mesma fonte consolidada da tabela, inclusive
    // recontagens órfãs recuperadas acima.
    var all = divergenciasVisiveis.filter(function (d) { return !fInv || d.inventario_id === fInv; });
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
    document.getElementById('div-table-wrap').innerHTML = "\n    <div class=\"tbl-wrap\"><table>\n      <thead><tr>\n        <th style=\"width:36px;padding:8px 10px\">\n          <input type=\"checkbox\" id=\"div-chk-all\" title=\"Selecionar todos\"\n            style=\"width:15px;height:15px;cursor:pointer;accent-color:var(--orange)\"\n            onchange=\"divToggleTodos(this.checked)\">\n        </th>\n        <th>Invent\u00E1rio</th><th>Rua</th><th>Endere\u00E7o</th><th>Vezes contado</th>\n        <th>Operador Contagem</th><th>Data</th><th>Tipo</th>\n        <th>Esperado no endere\u00E7o</th><th>1\u00AA Contagem</th>\n        <th>2\u00AA Contagem</th><th>3\u00AA Contagem</th><th>Resultado</th>\n        <th>Status</th><th>Status Recontagem</th><th>Atribu\u00EDdo para</th><th>Executado por</th><th>A\u00E7\u00F5es</th>\n      </tr></thead>\n      <tbody>\n        ".concat(dados.map(function (d) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        var difColor = d.diferenca > 0 ? 'var(--warn)' : d.diferenca < 0 ? 'var(--danger)' : 'var(--success)';
        var idsAgrupados = d._divergencias_agrupadas || [d.id];
        var rec = state().recontagens
            .filter(function (r) { return idsAgrupados.includes(r.divergencia_id); })
            .sort(function (a, b) { return (b.numero_recontagem || 1) - (a.numero_recontagem || 1); })[0] || null;
        var endInfo = getEnderecoInfo(d.endereco);
        var rua = (endInfo === null || endInfo === void 0 ? void 0 : endInfo.rua) || '—';
        var cont = state().contagens.find(function (c) { return c.inventario_id === d.inventario_id && c.endereco === d.endereco && !c._excluida; });
        var operador = d.operador || (cont === null || cont === void 0 ? void 0 : cont.operador) || '—';
        var podeSelecionar = divPodeSelecionar(d);
        if (!podeSelecionar)
            _divSelecionadas.delete(d.id);
        var selecionado = podeSelecionar && _divSelecionadas.has(d.id);
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
        var inventario = state().inventarios.find(function (i) {
            return String(i.id || '') === String(d.inventario_id || '') ||
                String(i.codigo || '') === String(d.inventario_id || '') ||
                String(i.nome || '') === String(d.inventario_id || '');
        });
        var esperadosDaBase = ((inventario === null || inventario === void 0 ? void 0 : inventario.base) || []).filter(function (item) {
            return String(item.endereco || '').trim().toUpperCase() === String(d.endereco || '').trim().toUpperCase();
        });
        var esperadosEndereco = esperadosDaBase.length
            ? esperadosDaBase
            : (Array.isArray(d.itens_esperados) ? d.itens_esperados : []);
        var _qtdEsperadaItem = function (item) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
            var bruto = (_q = (_p = (_o = (_m = (_l = (_k = (_j = (_h = (_g = (_f = (_e = (_d = (_c = (_b = (_a = item.quantidade_esperada) !== null && _a !== void 0 ? _a : item.quantidadeEsperada) !== null && _b !== void 0 ? _b : item.qtd_esperada) !== null && _c !== void 0 ? _c : item.qtdEsperada) !== null && _d !== void 0 ? _d : item.quantidade_enderecada) !== null && _e !== void 0 ? _e : item.qtd_enderecada) !== null && _f !== void 0 ? _f : item.saldo_estoque) !== null && _g !== void 0 ? _g : item.saldo) !== null && _h !== void 0 ? _h : item.saldo_erp) !== null && _j !== void 0 ? _j : item.qtd_sistema) !== null && _k !== void 0 ? _k : item.qtd_estoque) !== null && _l !== void 0 ? _l : item.estoque_total) !== null && _m !== void 0 ? _m : item.estoque) !== null && _o !== void 0 ? _o : item.quantidade) !== null && _p !== void 0 ? _p : item.qtd) !== null && _q !== void 0 ? _q : item.qtde;
            var numero = Number(String(bruto !== null && bruto !== void 0 ? bruto : '').replace(',', '.'));
            return Number.isFinite(numero) ? numero : 0;
        };
        var totalEsperadoEndereco = esperadosEndereco.length
            ? esperadosEndereco.reduce(function (total, item) { return total + _qtdEsperadaItem(item); }, 0)
            : Number(qtdEspTxt) || 0;
        var quantidadePaletes = esperadosEndereco.length || 1;
        var esperadoHtml = "<button type=\"button\" onclick=\"abrirDetalhePaletesEsperados(decodeURIComponent('".concat(encodeURIComponent(String(d.id || '')), "'))\"\n            title=\"Clique para visualizar os paletes\"\n            style=\"width:100%;min-width:145px;text-align:left;border:1px solid rgba(59,130,246,.28);background:rgba(59,130,246,.07);border-radius:10px;padding:8px 10px;cursor:pointer;color:inherit\">\n              <div class=\"mono\" style=\"font-weight:850;font-size:.78rem\">Total esperado: ").concat(escHTML(totalEsperadoEndereco), "</div>\n              <div style=\"font-size:.66rem;color:var(--muted);margin-top:3px\">\uD83D\uDCE6 ").concat(quantidadePaletes, " ").concat(quantidadePaletes === 1 ? 'palete' : 'paletes', " \u00B7 clique para detalhar</div>\n            </button>");
        var produtoBipado = d.produto_contado || d.gtin_bipado || d.produto || '—';
        var descricaoBipada = d.descricao_contada || d.descricao || '';
        // Status recontagem
        var statusRec = d.status_recontagem || (rec ? (rec.status === 'CONCLUIDA' ? 'concluida' : 'pendente') : '');
        var atribPara = d.operador_responsavel || (rec === null || rec === void 0 ? void 0 : rec.operador) || '';
        var executadoPor = (rec === null || rec === void 0 ? void 0 : rec.operador_recontagem) || d.operador_recontagem || '';
        var _produtoRodada = function (valor) {
            var partes = Array.isArray(valor) ? valor : String(valor || '').split(/[,;|]+/);
            var esperado = _produtoCanonicoRec(d);
            var limpas = partes.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
            var correspondente = limpas.find(function (v) { return _produtoCanonicoRec({ produto: v }) === esperado; });
            return correspondente || limpas[0] || d.produto_contado || d.produto || '—';
        };
        var _cellRodada = function (qtd, produto, operadorRodada, dataRodada, aguardando) {
            if (qtd == null) {
                return '<td><div style="color:var(--muted);font-size:.7rem;text-align:center">' + (aguardando ? 'Aguardando' : '—') + '</div></td>';
            }
            var codigo = _produtoRodada(produto);
            return '<td><div style="font-family:var(--mono);font-weight:800">' + escHTML(codigo) + ' · Qtd ' + escHTML(qtd) + '</div></td>';
        };
        return "<tr style=\"".concat(selecionado ? 'background:rgba(232,117,26,.06)' : '', "\">\n            <td style=\"padding:8px 10px\">\n              ").concat(podeSelecionar ? "<input type=\"checkbox\" class=\"div-row-chk\" data-id=\"".concat(d.id, "\"\n                style=\"width:15px;height:15px;cursor:pointer;accent-color:var(--orange)\"\n                ").concat(selecionado ? 'checked' : '', "\n                onchange=\"divToggleSel('").concat(d.id, "', this.checked)\">") : '', "\n            </td>\n            <td style=\"font-size:.75rem;color:var(--muted)\">").concat(d.inventario_nome || d.inventario_id, "</td>\n            <td class=\"mono\" style=\"font-weight:600\">").concat(rua, "</td>\n            <td class=\"mono\">").concat(escHTML(d.endereco)).concat(d.endereco_correto ? "<br><span style=\"font-size:.65rem;color:var(--muted)\">\u2192 ".concat(escHTML(d.endereco_correto), "</span>") : '', "</td>\n            <td style=\"text-align:center\"><span class=\"badge b-purple\" style=\"font-size:.76rem\">").concat(d._vezes_contado || 1, "x</span></td>\n            <td style=\"font-size:.8rem\">").concat(operador, "</td>\n            <td class=\"mono\" style=\"font-size:.72rem;color:var(--muted);white-space:nowrap\">").concat(fmtTs(d.criada_em), "</td>\n            <td><span class=\"badge ").concat(tipoCls, "\">").concat(tipoTxt, "</span></td>\n            <td>").concat(esperadoHtml, "</td>\n            ").concat((function () {
            var _qtdC1 = d.qtd_contada != null ? d.qtd_contada : '—';
            return '<td><div style="font-family:var(--mono);font-weight:800">' + escHTML(_produtoRodada(produtoBipado)) + ' · Qtd ' + escHTML(_qtdC1) + '</div></td>';
        })(), "\n            ").concat(_cellRodada((_a = rec === null || rec === void 0 ? void 0 : rec.qtd_segunda) !== null && _a !== void 0 ? _a : d.qtd_segunda, (_b = rec === null || rec === void 0 ? void 0 : rec.produto_segunda) !== null && _b !== void 0 ? _b : d.produto_segunda, (_c = rec === null || rec === void 0 ? void 0 : rec.operador_segunda) !== null && _c !== void 0 ? _c : d.operador_segunda, (_d = rec === null || rec === void 0 ? void 0 : rec.data_segunda) !== null && _d !== void 0 ? _d : d.data_segunda, statusRec === 'aguardando_analista' && ((_e = rec === null || rec === void 0 ? void 0 : rec.qtd_segunda) !== null && _e !== void 0 ? _e : d.qtd_segunda) == null), "\n            ").concat(_cellRodada((_f = rec === null || rec === void 0 ? void 0 : rec.qtd_terceira) !== null && _f !== void 0 ? _f : d.qtd_terceira, (_g = rec === null || rec === void 0 ? void 0 : rec.produto_terceira) !== null && _g !== void 0 ? _g : d.produto_terceira, (_h = rec === null || rec === void 0 ? void 0 : rec.operador_terceira) !== null && _h !== void 0 ? _h : d.operador_terceira, (_j = rec === null || rec === void 0 ? void 0 : rec.data_terceira) !== null && _j !== void 0 ? _j : d.data_terceira, false), "\n            ").concat((function () {
            var resolvida = String(d.status || '').toUpperCase() === 'RESOLVIDA' ||
                String(d.status_recontagem || '').toLowerCase() === 'sem_divergencia';
            return '<td><div style="font-family:var(--mono);font-weight:800;color:' + (resolvida ? 'var(--success)' : 'var(--danger)') + '">' + (resolvida ? '✅ Conferido' : '❌ Divergente') + '</div></td>';
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
    // Recria automaticamente vínculos ausentes antes de montar a fila. O botão
    // "Processar Contagens" continua disponível, mas não é mais necessário para
    // uma primeira divergência aparecer e poder ser atribuída.
    var faltaVinculo = (state().contagens || []).some(function (c) {
        if (String(c.tipo_contagem || '').toUpperCase() === 'RECONTAGEM' ||
            c.divergente !== true || c._excluida ||
            ['ESTORNADA', 'EXCLUIDA'].includes(String(c.status || '').toUpperCase()))
            return false;
        var id = String(c.inventario_id || c.inventarioId || '');
        var inv = (state().inventarios || []).find(function (i) {
            return [i.id, i.codigo, i.nome, i.inventario_id, i.inventarioId]
                .filter(Boolean).map(String).includes(id);
        });
        var aliases = inv
            ? [inv.id, inv.codigo, inv.nome, inv.inventario_id, inv.inventarioId].filter(Boolean).map(String)
            : [id];
        var end = String(c.endereco || '').trim().toUpperCase();
        var prod = _normRec(c.gtin || c.codigo_produto || c.codigoLido || c.produto || '');
        return !(state().divergencias || []).some(function (d) {
            return aliases.includes(String(d.inventario_id || d.inventarioId || '')) &&
                String(d.endereco || '').trim().toUpperCase() === end &&
                (!prod || _produtoCanonicoRec(d) === prod);
        });
    });
    if (faltaVinculo && typeof processarDivergencias === 'function') {
        processarDivergencias({ criarRecontagens: false, source: 'render-recontagens', force: true });
    }
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
    // A unidade operacional é inventário + endereço + produto. Agrupar somente
    // pelo endereço mistura produtos diferentes do mesmo picking, exibe totais
    // errados e faz uma recontagem pendente bloquear a criação das demais.
    var _normRec = function (v) { return String(v || '').trim().toUpperCase(); };
    var _inventarioCanonicoRec = function (obj) {
        var id = String((obj === null || obj === void 0 ? void 0 : obj.inventario_id) || (obj === null || obj === void 0 ? void 0 : obj.inventarioId) || (obj === null || obj === void 0 ? void 0 : obj.inventario) || '').trim();
        var inv = (state().inventarios || []).find(function (i) {
            return [i.id, i.codigo, i.nome, i.inventario_id, i.inventarioId]
                .filter(Boolean).map(String).includes(id);
        });
        return String((inv === null || inv === void 0 ? void 0 : inv.id) || id);
    };
    var _produtoCanonicoRec = function (obj) {
        var ids = [obj === null || obj === void 0 ? void 0 : obj.produto, obj === null || obj === void 0 ? void 0 : obj.produto_contado, obj === null || obj === void 0 ? void 0 : obj.produto_recontagem, obj === null || obj === void 0 ? void 0 : obj.produto_primeira, obj === null || obj === void 0 ? void 0 : obj.codigo_produto, obj === null || obj === void 0 ? void 0 : obj.gtin, obj === null || obj === void 0 ? void 0 : obj.ean, obj === null || obj === void 0 ? void 0 : obj.dun]
            .map(_normRec).filter(Boolean);
        return ids[0] || 'SEM_PRODUTO';
    };
    var _chaveEndereco = function (obj) {
        return "".concat(_inventarioCanonicoRec(obj), "|").concat(_normRec(obj === null || obj === void 0 ? void 0 : obj.endereco), "|").concat(_produtoCanonicoRec(obj));
    };
    var _gruposRec = new Map();
    var _adicionarGrupo = function (obj, tipo) {
        if (!obj || !_normRec(obj.endereco))
            return;
        var chave = _chaveEndereco(obj);
        var grupo = _gruposRec.get(chave) || { divergencias: [], recontagens: [] };
        grupo[tipo].push(obj);
        _gruposRec.set(chave, grupo);
    };
    state().divergencias.forEach(function (d) { return _adicionarGrupo(d, 'divergencias'); });
    state().recontagens.forEach(function (r) { return _adicionarGrupo(r, 'recontagens'); });
    state().contagens.filter(function (c) {
        return String(c.tipo_contagem || '').toUpperCase() !== 'RECONTAGEM' &&
            c.divergente === true && !c._excluida &&
            !['ESTORNADA', 'EXCLUIDA'].includes(String(c.status || '').toUpperCase());
    }).forEach(function (c) {
        var _a, _b, _c, _d, _e, _f, _g;
        var chave = _chaveEndereco(c);
        var grupo = _gruposRec.get(chave) || { divergencias: [], recontagens: [] };
        if (!grupo.divergencias.length) {
            grupo.divergencias.push({
                id: "contagem-".concat(c.uuid || c.id || chave),
                inventario_id: _inventarioCanonicoRec(c), endereco: c.endereco,
                produto: c.gtin || c.codigo_produto || c.codigoLido || '',
                descricao: c.descricao_produto || c.descricao || '',
                qtd_esperada: (_c = (_b = (_a = c.qtd_esperada) !== null && _a !== void 0 ? _a : c.quantidade_esperada) !== null && _b !== void 0 ? _b : c.qtd_sistema) !== null && _c !== void 0 ? _c : null,
                qtd_contada: (_e = (_d = c.quantidade) !== null && _d !== void 0 ? _d : c.qtd_caixas) !== null && _e !== void 0 ? _e : null,
                qtd_primeira: (_g = (_f = c.quantidade) !== null && _f !== void 0 ? _f : c.qtd_caixas) !== null && _g !== void 0 ? _g : null,
                produto_primeira: c.gtin || c.codigo_produto || c.codigoLido || '',
                operador_primeira: c.operador || c.operador_nome || '',
                data_primeira: c.timestamp || c.criado_em || c.dataHora || '',
                status: 'EM_RECONTAGEM', status_recontagem: 'aguardando_analista',
                precisa_recontagem: true, _virtual_de_contagem: true
            });
        }
        _gruposRec.set(chave, grupo);
    });
    var dados = __spreadArray([], _gruposRec.values(), true).map(function (grupo) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
        var divs = __spreadArray([], grupo.divergencias, true).sort(function (a, b) {
            return String(b.criada_em || '').localeCompare(String(a.criada_em || ''));
        });
        var recs = __spreadArray([], grupo.recontagens, true).sort(function (a, b) {
            return Number(a.numero_recontagem || 1) - Number(b.numero_recontagem || 1) ||
                String(a.criada_em || '').localeCompare(String(b.criada_em || ''));
        });
        var principal = Object.assign({}, recs[recs.length - 1] || divs[0] || {});
        var divPrincipal = divs.find(function (d) {
            return !['RESOLVIDA', 'PERSISTENTE', 'CANCELADA'].includes(String(d.status || '').toUpperCase());
        }) || divs[0] || {};
        // A primeira contagem nasce em dt_contagens/dt_divergencias. Ela precisa
        // aparecer mesmo antes de o Analista criar a segunda rodada.
        var contPrimeira = state().contagens
            .filter(function (c) {
            return _chaveEndereco(c) === _chaveEndereco(principal) &&
                String(c.tipo_contagem || '').toUpperCase() !== 'RECONTAGEM' &&
                !c._excluida && !['ESTORNADA', 'EXCLUIDA'].includes(String(c.status || '').toUpperCase());
        })
            .sort(function (a, b) { return String(a.criado_em || a.dataHora || '').localeCompare(String(b.criado_em || b.dataHora || '')); })[0];
        var recsConcluidas = recs.filter(function (r) { return r.qtd_recontagem != null; })
            .sort(function (a, b) { return String(a.recontagem_concluida_em || a.concluida_em || a.criada_em || '')
            .localeCompare(String(b.recontagem_concluida_em || b.concluida_em || b.criada_em || '')); });
        var recSegunda = recsConcluidas[0] || {};
        var recTerceira = recsConcluidas[1] || {};
        Object.assign(principal, {
            divergencia_id: divPrincipal.id || principal.divergencia_id,
            inventario_id: divPrincipal.inventario_id || principal.inventario_id,
            inventario_nome: divPrincipal.inventario_nome || principal.inventario_nome,
            endereco: divPrincipal.endereco || principal.endereco,
            produto: divPrincipal.produto || principal.produto || (contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.gtin) || (contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.codigo_produto) || '',
            descricao: divPrincipal.descricao || divPrincipal.descricao_produto || principal.descricao || (contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.descricao_produto) || '',
            qtd_esperada: (_a = divPrincipal.qtd_esperada) !== null && _a !== void 0 ? _a : principal.qtd_esperada,
            qtd_primeira: (_e = (_d = (_c = (_b = divPrincipal.qtd_primeira) !== null && _b !== void 0 ? _b : divPrincipal.qtd_contada) !== null && _c !== void 0 ? _c : principal.qtd_primeira) !== null && _d !== void 0 ? _d : contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.quantidade) !== null && _e !== void 0 ? _e : contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.qtd_caixas,
            produto_primeira: divPrincipal.produto_primeira || divPrincipal.produto_contado ||
                principal.produto_primeira || (contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.gtin) || (contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.codigo_produto) || '',
            operador_primeira: divPrincipal.operador_primeira || divPrincipal.operador ||
                principal.operador_primeira || (contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.operador) || '',
            data_primeira: divPrincipal.data_primeira || divPrincipal.criada_em ||
                principal.data_primeira || (contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.criado_em) || (contPrimeira === null || contPrimeira === void 0 ? void 0 : contPrimeira.dataHora) || '',
            qtd_segunda: (_h = (_g = (_f = recSegunda.qtd_segunda) !== null && _f !== void 0 ? _f : recSegunda.qtd_recontagem) !== null && _g !== void 0 ? _g : divPrincipal.qtd_segunda) !== null && _h !== void 0 ? _h : principal.qtd_segunda,
            produto_segunda: recSegunda.produto_segunda || recSegunda.produto_recontagem || divPrincipal.produto_segunda || principal.produto_segunda || '',
            operador_segunda: recSegunda.operador_segunda || recSegunda.operador_recontagem || divPrincipal.operador_segunda || principal.operador_segunda || '',
            data_segunda: recSegunda.data_segunda || recSegunda.recontagem_concluida_em || divPrincipal.data_segunda || principal.data_segunda || '',
            qtd_terceira: (_l = (_k = (_j = recTerceira.qtd_terceira) !== null && _j !== void 0 ? _j : recTerceira.qtd_recontagem) !== null && _k !== void 0 ? _k : divPrincipal.qtd_terceira) !== null && _l !== void 0 ? _l : principal.qtd_terceira,
            produto_terceira: recTerceira.produto_terceira || recTerceira.produto_recontagem || divPrincipal.produto_terceira || principal.produto_terceira || '',
            operador_terceira: recTerceira.operador_terceira || recTerceira.operador_recontagem || divPrincipal.operador_terceira || principal.operador_terceira || '',
            data_terceira: recTerceira.data_terceira || recTerceira.recontagem_concluida_em || divPrincipal.data_terceira || principal.data_terceira || '',
            status: divPrincipal.status || principal.status || 'ABERTA',
            status_recontagem: divPrincipal.status_recontagem || principal.status_recontagem || 'aguardando_analista',
            _somente_divergencia: recs.length === 0,
            _divergencias_agrupadas: divs.map(function (d) { return d.id; }),
            _recontagens_agrupadas: recs.map(function (r) { return r.id; })
        });
        var avaliacao = (_o = (_m = window.AnalistaDivergenciasRuntime) === null || _m === void 0 ? void 0 : _m.avaliarHistorico) === null || _o === void 0 ? void 0 : _o.call(_m, principal);
        if (avaliacao && (avaliacao.estado === 'RESOLVIDA' || avaliacao.estado === 'PERSISTENTE')) {
            principal.status = avaliacao.estado;
            principal.status_recontagem = avaliacao.estado === 'RESOLVIDA' ? 'sem_divergencia' : 'concluida';
            principal.contagem_aceita = avaliacao.referencia;
            principal.qtd_resultado_final = (_q = (_p = avaliacao.resultado) === null || _p === void 0 ? void 0 : _p.qtd) !== null && _q !== void 0 ? _q : null;
            principal.produto_resultado_final = ((_r = avaliacao.resultado) === null || _r === void 0 ? void 0 : _r.produto) || '';
            principal.encerrada_definitivamente = true;
            principal.operador_responsavel = null;
        }
        return principal;
    });
    dados = dados.filter(function (r) {
        var status = String(r.status || '').toUpperCase();
        var statusRec = String(r.status_recontagem || '').toLowerCase();
        return !['RESOLVIDA', 'CANCELADA'].includes(status) &&
            !['sem_divergencia', 'resolvida', 'cancelada'].includes(statusRec);
    });
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
    _recDadosFiltradosExport = dados.slice();
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
    // Indicadores e tabela usam exatamente os mesmos casos consolidados por
    // endereço. Assim o menu não mostra 1 enquanto a tabela mostra 0, nem conta
    // três documentos técnicos como três atividades operacionais.
    var allRec = dados.slice();
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
            if (qtd === null || qtd === undefined) return '<td style="color:var(--muted-2);font-size:.78rem;text-align:center">—</td>';
            var partes = Array.isArray(prodContado) ? prodContado : String(prodContado || r.produto || '').split(/[,;|]+/);
            var esperadoCanonico = _produtoCanonicoRec(r);
            var limpas = partes.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
            var produtoExibido = limpas.find(function (v) { return _produtoCanonicoRec({ produto: v }) === esperadoCanonico; }) || limpas[0] || r.produto || '—';
            return '<td><div style="font-family:var(--mono);font-weight:800">' + escHTML(produtoExibido) + ' · Qtd ' + escHTML(qtd) + '</div></td>';
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
            ? "<button class=\"btn btn-ghost btn-sm\" onclick=\"".concat(r._somente_divergencia
                ? "divAtribuirRapido('".concat(r.divergencia_id, "')")
                : "divAtribuirPorRec('".concat(r.id, "')"), "\" style=\"font-size:.72rem\" title=\"Atribuir a um operador\">\uD83D\uDC64 Atribuir</button>")
            : '', "\n              </div>\n            </td>\n          </tr>");
    }).join(''), "\n      </tbody>\n    </table></div>");
}
function _exportarXlsxAnalista(nomeArquivo, nomeAba, linhas) {
    if (!window.XLSX) {
        showToast('Biblioteca Excel não carregada. Atualize a página e tente novamente.', 'e');
        return;
    }
    if (!linhas || !linhas.length) {
        showToast('Não há dados nos filtros atuais para exportar.', 'w');
        return;
    }
    var ws = XLSX.utils.json_to_sheet(linhas);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nomeAba.substring(0, 31));
    XLSX.writeFile(wb, nomeArquivo);
}
function exportarDivergencias() {
    renderDivergencias();
    var linhas = _divDadosFiltradosExport.map(function (d) {
        var _a, _b, _c;
        var info = getEnderecoInfo(d.endereco) || {};
        var rec = state().recontagens.find(function (r) { return r.divergencia_id === d.id; }) || {};
        return {
            'Inventário': d.inventario_nome || d.inventario_id || '',
            'Rua': info.rua || '',
            'Endereço': d.endereco || '',
            'Produto': d.produto || d.descricao || '',
            'GTIN bipado': d.gtin_bipado || '',
            'Tipo': d.tipo_divergencia || d.tipo || '',
            'Quantidade esperada': (_a = d.qtd_esperada) !== null && _a !== void 0 ? _a : '',
            'Quantidade contada': (_b = d.qtd_contada) !== null && _b !== void 0 ? _b : '',
            'Diferença': (_c = d.diferenca) !== null && _c !== void 0 ? _c : '',
            'Status': d.status || '',
            'Status recontagem': d.status_recontagem || rec.status_recontagem || rec.status || '',
            'Operador da contagem': d.operador || '',
            'Atribuído para': d.operador_responsavel || rec.operador || '',
            'Executado por': rec.operador_recontagem || d.operador_recontagem || '',
            'Criada em': d.criada_em ? fmtTs(d.criada_em) : ''
        };
    });
    _exportarXlsxAnalista('divergencias-filtradas.xlsx', 'Divergências', linhas);
}
function exportarRecontagens() {
    renderRecontagens();
    var linhas = _recDadosFiltradosExport.map(function (r) {
        var _a, _b, _c, _d;
        var info = getEnderecoInfo(r.endereco) || {};
        var div = state().divergencias.find(function (d) { return d.id === r.divergencia_id; }) || {};
        return {
            'Inventário': r.inventario_nome || r.inventario_id || '',
            'Rua': info.rua || '',
            'Endereço': r.endereco || '',
            'Produto': r.produto || r.descricao || '',
            'Quantidade esperada': (_a = r.qtd_esperada) !== null && _a !== void 0 ? _a : '',
            '1ª contagem': (_b = r.qtd_primeira) !== null && _b !== void 0 ? _b : '',
            'Operador 1ª': r.operador_primeira || '',
            '2ª contagem': (_c = r.qtd_segunda) !== null && _c !== void 0 ? _c : '',
            'Operador 2ª': r.operador_segunda || '',
            '3ª contagem': (_d = r.qtd_terceira) !== null && _d !== void 0 ? _d : '',
            'Operador 3ª': r.operador_terceira || '',
            'Status': r.status_recontagem || div.status_recontagem || r.status || '',
            'Atribuído para': r.operador || div.operador_responsavel || '',
            'Executado por': r.operador_recontagem || div.operador_recontagem || '',
            'Atribuída em': r.atribuido_em ? fmtTs(r.atribuido_em) : '',
            'Concluída em': r.recontagem_concluida_em ? fmtTs(r.recontagem_concluida_em) : (r.concluida_em ? fmtTs(r.concluida_em) : '')
        };
    });
    _exportarXlsxAnalista('recontagens-filtradas.xlsx', 'Recontagens', linhas);
}
// Exibe a composição do total esperado em formato de lista de paletes.
function abrirDetalhePaletesEsperados(divId) {
    var _a;
    var d = state().divergencias.find(function (item) { return String(item.id || '') === String(divId || ''); });
    if (!d)
        return showToast('Não foi possível localizar essa divergência.', 'e');
    var inventario = state().inventarios.find(function (i) {
        return String(i.id || '') === String(d.inventario_id || '') ||
            String(i.codigo || '') === String(d.inventario_id || '') ||
            String(i.nome || '') === String(d.inventario_id || '');
    });
    var normEnd = function (valor) { return String(valor || '').trim().toUpperCase(); };
    var itens = ((inventario === null || inventario === void 0 ? void 0 : inventario.base) || []).filter(function (item) { return normEnd(item.endereco) === normEnd(d.endereco); });
    if (!itens.length && Array.isArray(d.itens_esperados))
        itens = d.itens_esperados;
    if (!itens.length)
        itens = [{ produto: d.produto, descricao: d.descricao, quantidade_esperada: d.qtd_esperada }];
    var obterQtd = function (item) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        var bruto = (_q = (_p = (_o = (_m = (_l = (_k = (_j = (_h = (_g = (_f = (_e = (_d = (_c = (_b = (_a = item.quantidade_esperada) !== null && _a !== void 0 ? _a : item.quantidadeEsperada) !== null && _b !== void 0 ? _b : item.qtd_esperada) !== null && _c !== void 0 ? _c : item.qtdEsperada) !== null && _d !== void 0 ? _d : item.quantidade_enderecada) !== null && _e !== void 0 ? _e : item.qtd_enderecada) !== null && _f !== void 0 ? _f : item.saldo_estoque) !== null && _g !== void 0 ? _g : item.saldo) !== null && _h !== void 0 ? _h : item.saldo_erp) !== null && _j !== void 0 ? _j : item.qtd_sistema) !== null && _k !== void 0 ? _k : item.qtd_estoque) !== null && _l !== void 0 ? _l : item.estoque_total) !== null && _m !== void 0 ? _m : item.estoque) !== null && _o !== void 0 ? _o : item.quantidade) !== null && _p !== void 0 ? _p : item.qtd) !== null && _q !== void 0 ? _q : item.qtde;
        var numero = Number(String(bruto !== null && bruto !== void 0 ? bruto : '').replace(',', '.'));
        return Number.isFinite(numero) ? numero : 0;
    };
    var total = itens.reduce(function (soma, item) { return soma + obterQtd(item); }, 0);
    var linhas = itens.map(function (item, indice) {
        var codigo = item.codigo_produto || item.codigoProduto || item.codigo_interno || item.codigoInterno || item.gtin || item.ean || item.dun || item.produto || '—';
        var nome = item.descricao_produto || item.descricaoProduto || item.descricao || item.nomeProduto || '';
        var identificador = item.palete || item.pallet || item.numero_palete || item.numeroPalete || item.sscc || item.lote || "Palete ".concat(indice + 1);
        var qtd = obterQtd(item);
        return "<div style=\"display:grid;grid-template-columns:minmax(90px,.7fr) minmax(170px,1.7fr) auto;gap:12px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--border)\">\n      <div><div style=\"font-size:.65rem;color:var(--muted)\">PALETE</div><div class=\"mono\" style=\"font-weight:800\">".concat(escHTML(identificador), "</div></div>\n      <div><div class=\"mono\" style=\"font-weight:800\">").concat(escHTML(codigo), "</div>").concat(nome ? "<div style=\"font-size:.69rem;color:var(--muted);margin-top:2px\">".concat(escHTML(nome), "</div>") : '', "</div>\n      <div style=\"text-align:right\"><div style=\"font-size:.65rem;color:var(--muted)\">QUANTIDADE</div><div class=\"mono\" style=\"font-size:1rem;font-weight:900\">").concat(escHTML(qtd), "</div></div>\n    </div>");
    }).join('');
    (_a = document.getElementById('modal-paletes-esperados-bg')) === null || _a === void 0 ? void 0 : _a.remove();
    document.body.insertAdjacentHTML('beforeend', "<div id=\"modal-paletes-esperados-bg\" class=\"modal-bg open\" style=\"display:flex;z-index:99999\" onclick=\"if(event.target===this) fecharDetalhePaletesEsperados()\">\n    <div class=\"modal\" style=\"max-width:720px;width:min(720px,94vw);padding:0;overflow:hidden\">\n      <div class=\"modal-hdr\" style=\"padding:18px 20px\">\n        <div><div class=\"modal-title\">\uD83D\uDCE6 Paletes do total esperado</div><div style=\"font-size:.72rem;color:var(--muted);margin-top:3px\">Endere\u00E7o ".concat(escHTML(d.endereco || '—'), " \u00B7 ").concat(itens.length, " ").concat(itens.length === 1 ? 'palete' : 'paletes', "</div></div>\n        <button class=\"modal-close\" onclick=\"fecharDetalhePaletesEsperados()\">\u2715</button>\n      </div>\n      <div style=\"max-height:60vh;overflow:auto;border-top:1px solid var(--border);border-bottom:1px solid var(--border)\">").concat(linhas, "</div>\n      <div style=\"display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:rgba(59,130,246,.07)\">\n        <div><div style=\"font-size:.68rem;color:var(--muted)\">TOTAL CONSOLIDADO DO ENDERE\u00C7O</div><div style=\"font-size:.72rem;color:var(--muted)\">Soma de todos os paletes listados acima</div></div>\n        <div class=\"mono\" style=\"font-size:1.35rem;font-weight:950\">").concat(escHTML(total), "</div>\n      </div>\n      <div class=\"modal-actions\" style=\"padding:14px 20px\"><button class=\"btn btn-primary\" onclick=\"fecharDetalhePaletesEsperados()\">Fechar</button></div>\n    </div>\n  </div>"));
}
function fecharDetalhePaletesEsperados() {
    var _a;
    (_a = document.getElementById('modal-paletes-esperados-bg')) === null || _a === void 0 ? void 0 : _a.remove();
}
