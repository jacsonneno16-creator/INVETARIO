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
//  ETAPA 1: ENDEREÇO
// ═══════════════════════════════════════════════════
// Timer para auto-avançar quando endereço não encontrado
var _enderecoNaoEncontradoTimer = null;
function onEnderecoInput() {
    var _this = this;
    var _a;
    var raw = document.getElementById('f-endereco').value;
    var valNorm = _normStr(raw);
    document.getElementById('f-endereco').value = raw.toUpperCase();
    var fb = document.getElementById('fb-endereco');
    if (_enderecoNaoEncontradoTimer) {
        clearTimeout(_enderecoNaoEncontradoTimer);
        _enderecoNaoEncontradoTimer = null;
    }
    // Limpar cache se mudou de endereço
    if (_endVerif && _endVerif.endereco !== valNorm)
        _endVerif = null;
    // Em modo recontagem: não verificar histórico do Firebase
    if (APP.modoRecontagem) {
        fb.innerHTML = '';
        APP.atual.enderecoValido = true;
        return;
    }
    if (!valNorm) {
        fb.innerHTML = '';
        APP.atual.enderecoValido = false;
        return;
    }
    // ── Verificação rápida local: endereço em recontagem? (resposta imediata) ──
    if (_enderecoEmRecontagem(valNorm)) {
        fb.innerHTML = "<div class=\"fb err\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n      <b>\uD83D\uDD12 Endere\u00E7o bloqueado para contagem normal</b>\n      <span style=\"font-size:.7rem;opacity:.9\">Este endere\u00E7o tem uma rodada em aberto \u2014 use a aba \uD83D\uDD04 RODADAS.</span>\n    </div>";
        document.getElementById('f-endereco').className = 'field field-err';
        APP.atual.enderecoValido = false;
        return;
    }
    if (!APP.base.length) {
        fb.innerHTML = "<div class=\"fb warn\" style=\"flex-direction:column;align-items:flex-start;gap:6px\">\n      <b>\u26A0 Base n\u00E3o carregada</b>\n      <span style=\"font-size:.72rem;opacity:.85\">O cadastro de endere\u00E7os n\u00E3o est\u00E1 na mem\u00F3ria. Volte e selecione o invent\u00E1rio novamente para baixar a base.</span>\n      <button onclick=\"voltarInventarios()\" style=\"margin-top:4px;padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer\">\u21A9 Recarregar base agora</button>\n    </div>";
        APP.atual.enderecoValido = true;
        _verificarEnderecoFirebase(valNorm);
        return;
    }
    var matches = APP.base.filter(function (r) { return r._end === valNorm; });
    // Endereço válido se existir na base de produtos OU em dt_locais (locaisAtivos)
    var naLocais = (_a = APP.locaisAtivos) === null || _a === void 0 ? void 0 : _a.has(valNorm);
    var endValido = matches.length > 0 || naLocais;
    if (endValido) {
        APP.atual._endNorm = valNorm;
        APP.atual.enderecoValido = true;
        document.getElementById('f-endereco').className = 'field field-ok';
        fb.innerHTML = "<div class=\"fb ok\">\u2713 ".concat(matches.length > 0 ? matches.length + ' produto(s) neste endereço' : 'Endereço confirmado', "</div>");
        var vaziow = document.getElementById('btn-vazio-wrap');
        if (vaziow)
            vaziow.style.display = '';
        _verificarEnderecoFirebase(valNorm);
    }
    else {
        // Endereço não encontrado na base
        APP.atual._endNorm = valNorm;
        APP.atual.enderecoValido = false;
        // Só mostrar erro e bloquear se o endereço tem o formato esperado (NN.NNNN.N.N.N.N.N)
        // Endereços com outro formato podem ser endereços de outra área — avisar mas não bloquear
        var formatoValido = /^\d{2}\.\d{4}(\.\d+){4,6}$/.test(valNorm);
        if (formatoValido) {
            // Cache local pode estar desatualizado — verificar no Firebase antes de bloquear
            fb.innerHTML = "<div class=\"fb info\">\uD83D\uDD0D Verificando endere\u00E7o na base\u2026</div>";
            var _chkLoc = function () { return __awaiter(_this, void 0, void 0, function () {
                var snap, naFirebase, byField, curVal, e_1, curVal;
                var _a, _b, _c, _d, _e;
                return __generator(this, function (_f) {
                    switch (_f.label) {
                        case 0:
                            _f.trys.push([0, 4, , 5]);
                            return [4 /*yield*/, FS.collection(FCOL.locais).doc(valNorm).get()];
                        case 1:
                            snap = _f.sent();
                            naFirebase = snap.exists && ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.ativo) !== false;
                            if (!!naFirebase) return [3 /*break*/, 3];
                            return [4 /*yield*/, FS.collection(FCOL.locais)
                                    .where('endereco', '==', valNorm).limit(1).get()];
                        case 2:
                            byField = _f.sent();
                            naFirebase = !byField.empty && ((_b = byField.docs[0].data()) === null || _b === void 0 ? void 0 : _b.ativo) !== false;
                            _f.label = 3;
                        case 3:
                            curVal = _normStr(((_c = document.getElementById('f-endereco')) === null || _c === void 0 ? void 0 : _c.value) || '');
                            if (curVal !== valNorm)
                                return [2 /*return*/]; // usuário já digitou outro valor
                            if (naFirebase) {
                                (_d = APP.locaisAtivos) === null || _d === void 0 ? void 0 : _d.add(valNorm); // atualizar cache local
                                APP.atual.enderecoValido = true;
                                document.getElementById('f-endereco').className = 'field field-ok';
                                fb.innerHTML = "<div class=\"fb ok\">\u2713 Endere\u00E7o confirmado</div>";
                                _verificarEnderecoFirebase(valNorm);
                            }
                            else {
                                APP.atual.enderecoValido = false;
                                fb.innerHTML = "<div class=\"fb err\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n              <b>\uD83D\uDEAB Endere\u00E7o n\u00E3o cadastrado na base</b>\n              <span style=\"font-size:.7rem;opacity:.85\">Verifique o endere\u00E7o e tente novamente.</span>\n            </div>";
                                document.getElementById('f-endereco').className = 'field field-err';
                                // beep só ao confirmar, não ao digitar
                            }
                            return [3 /*break*/, 5];
                        case 4:
                            e_1 = _f.sent();
                            curVal = _normStr(((_e = document.getElementById('f-endereco')) === null || _e === void 0 ? void 0 : _e.value) || '');
                            if (curVal !== valNorm)
                                return [2 /*return*/];
                            APP.atual.enderecoValido = true;
                            fb.innerHTML = "<div class=\"fb warn\">\u26A0 N\u00E3o foi poss\u00EDvel verificar o endere\u00E7o. Continue com cautela.</div>";
                            return [3 /*break*/, 5];
                        case 5: return [2 /*return*/];
                    }
                });
            }); };
            _chkLoc();
        }
        else {
            // Formato diferente — pode ser endereço de outra área, deixar passar com aviso
            fb.innerHTML = "<div class=\"fb warn\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n        <b>\u26A0 Endere\u00E7o n\u00E3o encontrado na base</b>\n        <span style=\"font-size:.7rem;opacity:.85\">Pressione Confirmar para registrar assim mesmo.</span>\n      </div>";
            document.getElementById('f-endereco').className = 'field field-warn';
            APP.atual.enderecoValido = true;
        }
    }
}
/**
 * Consulta o Firebase para verificar se o endereço já foi coletado.
 * Resultado é cacheado em _endVerif para uso em confirmarEndereco().
 */
/**
 * Verifica localmente se um endereço está em recontagem ativa.
 * Checa APP.recontagens e APP.divergenciasAtribuidas (dados carregados do Firestore).
 * Retorna true se o endereço deve ser bloqueado para contagem normal.
 */
/**
 * Retorna true se o endereço está (ou já esteve) em recontagem neste inventário.
 * Uma vez que entra em recontagem, o endereço fica bloqueado para contagem normal
 * permanentemente — só pode ser tratado pelo fluxo de recontagem.
 */
function _enderecoEmRecontagem(endNorm) {
    var _a;
    if (!((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.id))
        return false;
    var nd = function (s) { return String(s || '').trim().toUpperCase(); };
    var endN = nd(endNorm);
    var invId = APP.inventario.id;
    // Bloquear se existir QUALQUER divergência para este endereço (independente do status)
    // Uma divergência gerada = endereço bloqueado permanentemente para contagem normal
    var temDiv = (APP.divergenciasAtribuidas || []).some(function (d) {
        return nd(d.endereco) === endN && d.inventario_id === invId;
    });
    if (temDiv)
        return true;
    // Bloquear se existir recontagem ativa (pendente/em andamento) para este endereço.
    // Recontagens encerradas (sem_divergencia, resolvida, persistente) não bloqueiam.
    var temRec = (APP.recontagens || []).some(function (r) {
        if (nd(r.endereco) !== endN || r.inventario_id !== invId)
            return false;
        var stRec = (r.status_recontagem || '').toLowerCase();
        if (stRec === 'cancelada')
            return false;
        if (stRec === 'sem_divergencia')
            return false;
        var st = (r.status || '').toUpperCase();
        if (st === 'RESOLVIDA' || st === 'PERSISTENTE')
            return false;
        if (r.divergencia_resolvida === true || r.encerrada_definitivamente === true)
            return false;
        return true;
    });
    return temRec;
}
function _verificarEnderecoFirebase(endNorm) {
    return __awaiter(this, void 0, void 0, function () {
        var _CACHE_END_TTL, snap, docsAtivos, emRecontagemLocal, emRecontagemFS, _a, snapDiv, snapRec, divAtiva, recAtiva, e_2, bloqueadoRecontagem, meuNome_1, temVazio, docsNaoVazio, docsMeus, docsOutros, status_1, fbEl, campoVal, err_1;
        var _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (!((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.id))
                        return [2 /*return*/];
                    _CACHE_END_TTL = 5 * 60 * 1000;
                    if ((_endVerif === null || _endVerif === void 0 ? void 0 : _endVerif.endereco) === endNorm && Date.now() - (_endVerif.checkedAt || 0) < _CACHE_END_TTL)
                        return [2 /*return*/];
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 7, , 8]);
                    return [4 /*yield*/, FS.collection(FCOL.contagens)
                            .where('inventario_id', '==', APP.inventario.id)
                            .where('endereco', '==', endNorm)
                            .get()];
                case 2:
                    snap = _e.sent();
                    docsAtivos = snap.docs
                        .map(function (d) { return (__assign({ _docId: d.id }, d.data())); })
                        .filter(function (c) { return !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA'; });
                    emRecontagemLocal = _enderecoEmRecontagem(endNorm);
                    emRecontagemFS = false;
                    if (!!emRecontagemLocal) return [3 /*break*/, 6];
                    _e.label = 3;
                case 3:
                    _e.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, Promise.all([
                            FS.collection('dt_divergencias')
                                .where('inventario_id', '==', APP.inventario.id)
                                .where('endereco', '==', endNorm)
                                .limit(5)
                                .get(),
                            FS.collection('dt_recontagens')
                                .where('inventario_id', '==', APP.inventario.id)
                                .where('endereco', '==', endNorm)
                                .limit(5)
                                .get(),
                        ])];
                case 4:
                    _a = _e.sent(), snapDiv = _a[0], snapRec = _a[1];
                    divAtiva = snapDiv.docs.find(function (d) {
                        var data = d.data();
                        var s = (data.status || '').toUpperCase();
                        var bloq = (data.status_bloqueio || '').toUpperCase();
                        var stRec = (data.status_recontagem || '').toLowerCase();
                        if (s === 'RESOLVIDA')
                            return false; // encerrada — não bloqueia
                        if (s === 'PERSISTENTE')
                            return false; // encerrada — não bloqueia
                        if (bloq === 'PERSISTENTE_BLOQUEADO')
                            return false;
                        if (stRec === 'sem_divergencia')
                            return false; // resolvida — não bloqueia
                        if (data.divergencia_resolvida === true)
                            return false;
                        if (data.encerrada_definitivamente === true)
                            return false;
                        return s !== ''; // div aberta/em_recontagem bloqueia
                    });
                    recAtiva = snapRec.docs.find(function (d) {
                        var sr = (d.data().status_recontagem || '').toLowerCase();
                        return sr !== 'cancelada';
                    });
                    emRecontagemFS = !!(divAtiva || recAtiva);
                    return [3 /*break*/, 6];
                case 5:
                    e_2 = _e.sent();
                    return [3 /*break*/, 6];
                case 6:
                    bloqueadoRecontagem = emRecontagemLocal || emRecontagemFS;
                    meuNome_1 = ((_c = APP.operador) === null || _c === void 0 ? void 0 : _c.name) || '';
                    temVazio = docsAtivos.some(function (c) { return c.tipo_contagem === 'VAZIO'; });
                    docsNaoVazio = docsAtivos.filter(function (c) { return c.tipo_contagem !== 'VAZIO'; });
                    docsMeus = docsNaoVazio.filter(function (c) { return c.operador === meuNome_1; });
                    docsOutros = docsNaoVazio.filter(function (c) { return c.operador !== meuNome_1; });
                    if (bloqueadoRecontagem)
                        status_1 = 'em_recontagem'; // novo status de bloqueio
                    else if (temVazio)
                        status_1 = 'encerrado';
                    else if (docsOutros.length > 0)
                        status_1 = 'outro';
                    else if (docsMeus.length > 0)
                        status_1 = 'proprio';
                    else
                        status_1 = 'livre';
                    _endVerif = { endereco: endNorm, status: status_1, docs: docsAtivos, docsMeus: docsMeus, docsOutros: docsOutros, checkedAt: Date.now() };
                    fbEl = document.getElementById('fb-endereco');
                    campoVal = _normStr(((_d = document.getElementById('f-endereco')) === null || _d === void 0 ? void 0 : _d.value) || '');
                    if (fbEl && campoVal === endNorm) {
                        _mostrarFeedbackVerificacao(fbEl, endNorm);
                    }
                    return [3 /*break*/, 8];
                case 7:
                    err_1 = _e.sent();
                    console.warn('[VerifEnd] Erro na consulta Firebase:', err_1.message);
                    // Em caso de erro, não bloquear — deixa o confirmarEndereco decidir
                    _endVerif = { endereco: endNorm, status: 'livre', docs: [], docsMeus: [], docsOutros: [], checkedAt: Date.now() };
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/];
            }
        });
    });
}
function _mostrarFeedbackVerificacao(fbEl, endNorm) {
    var _a;
    if (!_endVerif || _endVerif.endereco !== endNorm)
        return;
    var status = _endVerif.status, docsOutros = _endVerif.docsOutros, docsMeus = _endVerif.docsMeus;
    if (status === 'em_recontagem') {
        fbEl.innerHTML = "<div class=\"fb err\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n      <b>\uD83D\uDD12 Endere\u00E7o bloqueado para contagem normal</b>\n      <span style=\"font-size:.7rem;opacity:.9\">Este endere\u00E7o tem uma nova rodada solicitada.<br>A contagem normal est\u00E1 bloqueada.<br>Use a aba <b>\uD83D\uDD04 RODADAS</b> para trat\u00E1-lo.</span>\n    </div>";
        document.getElementById('f-endereco').className = 'field field-err';
        APP.atual.enderecoValido = false;
        // beep só ao confirmar
    }
    else if (status === 'encerrado') {
        fbEl.innerHTML = "<div class=\"fb err\">\n      \uD83D\uDEAB Endere\u00E7o encerrado (vazio confirmado) \u2014 estorne na aba \u21A9\uFE0F ESTORNO para liberar\n    </div>";
        document.getElementById('f-endereco').className = 'field field-err';
        APP.atual.enderecoValido = false;
    }
    else if (status === 'outro') {
        var quem = ((_a = docsOutros[0]) === null || _a === void 0 ? void 0 : _a.operador) || 'outro operador';
        fbEl.innerHTML = "<div class=\"fb err\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n      <b>\uD83D\uDEAB Endere\u00E7o j\u00E1 coletado por <span style=\"color:var(--warn)\">".concat(quem, "</span></b>\n      <span style=\"font-size:.7rem;opacity:.85\">Somente ").concat(quem, " pode estornar esta contagem.</span>\n    </div>");
        document.getElementById('f-endereco').className = 'field field-err';
        APP.atual.enderecoValido = false;
    }
    else if (status === 'proprio') {
        var qtd = docsMeus.length;
        fbEl.innerHTML = "<div class=\"fb warn\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n      <b>\u26A0 Voc\u00EA j\u00E1 contou ".concat(qtd, " pallet(s) neste endere\u00E7o</b>\n      <span style=\"font-size:.7rem;opacity:.85\">Confirme para adicionar mais pallets ou escolha \uD83D\uDCED VAZIO para encerrar.</span>\n    </div>");
    }
    // 'livre' — não sobrescreve o feedback padrão
}
/** Confirma endereço sem botão — usado no fluxo auto-avanço (endereço não encontrado na base). */
function confirmarEnderecoSilencioso() {
    var _a;
    var raw = document.getElementById('f-endereco').value;
    if (!raw.trim())
        return;
    var valNorm = _normStr(raw);
    var fb = document.getElementById('fb-endereco');
    // Em modo recontagem: sem verificações de histórico — sessão limpa
    if (APP.modoRecontagem) {
        _prosseguirComEndereco(valNorm);
        return;
    }
    var verifAtual = ((_endVerif === null || _endVerif === void 0 ? void 0 : _endVerif.endereco) === valNorm) ? _endVerif : null;
    var status = verifAtual === null || verifAtual === void 0 ? void 0 : verifAtual.status;
    if (status === 'em_recontagem') {
        fb.innerHTML = "<div class=\"fb err\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n      <b>\uD83D\uDD12 Endere\u00E7o bloqueado para contagem normal</b>\n      <span style=\"font-size:.7rem;opacity:.9\">Use a aba \uD83D\uDD04 RODADAS para tratar este endere\u00E7o.</span>\n    </div>";
        document.getElementById('f-endereco').className = 'field field-err';
        APP.atual.enderecoValido = false;
        beepErr();
        return;
    }
    if (status === 'encerrado') {
        fb.innerHTML = "<div class=\"fb err\">\uD83D\uDEAB Endere\u00E7o encerrado \u2014 estorne na aba \u21A9\uFE0F ESTORNO para liberar</div>";
        document.getElementById('f-endereco').className = 'field field-err';
        return;
    }
    if (status === 'outro') {
        _modalBloqueioOutroOperador(valNorm, verifAtual.docsOutros || []);
        return;
    }
    if (status === 'proprio') {
        _modalOpcoesProprio(valNorm, verifAtual.docsMeus || []);
        return;
    }
    // livre ou sem cache — prosseguir
    var cap = ((_a = APP.endCapacidade) === null || _a === void 0 ? void 0 : _a[valNorm]) || 0;
    APP.atual.capacidadeEnd = cap;
    APP.atual.endereco = valNorm;
    APP.atual._endNorm = valNorm;
    APP.atual.somentesDun = valNorm.includes('14.1520');
    APP.atual.step = 2;
    beepSuave();
    var range = APP.capaRange;
    var hintEl = document.getElementById('cp-proximo-hint');
    if (hintEl)
        hintEl.textContent = ((range === null || range === void 0 ? void 0 : range.min) && (range === null || range === void 0 ? void 0 : range.max))
            ? "Range: ".concat(range.min, "\u2013").concat(range.max, " \u00B7 Pr\u00F3ximo: ").concat(APP.proximoCapa)
            : 'Próximo disponível: ' + APP.proximoCapa;
    document.getElementById('f-capa').value = '';
    document.getElementById('fb-capa').innerHTML = '';
    updateSteps();
    setTimeout(function () { return document.getElementById('f-capa').focus(); }, 100);
}
function confirmarEndereco() {
    var _a, _b, _c;
    var raw = document.getElementById('f-endereco').value;
    if (!raw.trim()) {
        toast('Informe o endereço', 'e');
        return;
    }
    if (_enderecoNaoEncontradoTimer) {
        clearTimeout(_enderecoNaoEncontradoTimer);
        _enderecoNaoEncontradoTimer = null;
    }
    var valNorm = _normStr(raw);
    var fb = document.getElementById('fb-endereco');
    // ── Modo recontagem: validar endereço esperado ──
    if (APP.modoRecontagem) {
        var esperado = _normStr(APP.modoRecontagem.endereco || '');
        if (valNorm !== esperado) {
            fb.innerHTML = "<div class=\"fb err\">\uD83D\uDEAB Endere\u00E7o incorreto \u2014 esperado: <b>".concat(escHTML(APP.modoRecontagem.endereco), "</b></div>");
            document.getElementById('f-endereco').className = 'field field-err';
            beepErr();
            return;
        }
        _prosseguirComEndereco(valNorm);
        return;
    }
    // ── Bloqueio por status do inventário ──
    var statusInv = (((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.status) || '').toUpperCase();
    if (statusInv === 'PAUSADO') {
        toast('⏸ Inventário pausado pelo analista. Contagens bloqueadas.', 'w');
        beepErr();
        return;
    }
    if (statusInv === 'FECHADO' || statusInv === 'CANCELADO') {
        toast('🚫 Inventário encerrado. Retornando...', 'e');
        setTimeout(function () { return voltarInventarios(); }, 1500);
        beepErr();
        return;
    }
    // ── Bloqueio por turno encerrado ──
    if (APP.turnoEncerrado) {
        toast('🔒 Turno encerrado. Não é possível realizar novas contagens.', 'w');
        beepErr();
        return;
    }
    // ── Validar endereço contra base do inventário E catálogo geral (dt_locais) ──
    // APP._locaisDoFirebase = true somente quando locaisAtivos veio do dt_locais completo
    // Se veio só do CSV do inventário, não bloquear endereços que podem existir no armazém
    if (APP.base.length > 0 || ((_b = APP.locaisAtivos) === null || _b === void 0 ? void 0 : _b.size) > 0) {
        var naBase = APP.base.some(function (r) { return r._end === valNorm; });
        // Só usar locaisAtivos como critério de bloqueio se veio do Firebase (catálogo completo)
        var catalogoCompleto = !!APP._locaisDoFirebase;
        var naLocais = catalogoCompleto && ((_c = APP.locaisAtivos) === null || _c === void 0 ? void 0 : _c.has(valNorm));
        // APP.atual.enderecoValido pode ter sido atualizado pela verificação async do Firebase
        // no onEnderecoInput() — se sim, confiar nessa verificação e pular o cache local.
        if (!naBase && catalogoCompleto && !naLocais && !APP.atual.enderecoValido) {
            var formatoValido = /^\d{2}\.\d{4}(\.\d+){4,6}$/.test(valNorm);
            if (formatoValido) {
                fb.innerHTML = "<div class=\"fb err\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n          <b>\uD83D\uDEAB Endere\u00E7o n\u00E3o cadastrado na base</b>\n          <span style=\"font-size:.7rem;opacity:.85\">Verifique o endere\u00E7o e tente novamente.</span>\n        </div>";
                document.getElementById('f-endereco').className = 'field field-err';
                beepErr();
                return;
            }
            // Formato diferente: pode ser área especial — deixar prosseguir
        }
    }
    // ── Usar cache da verificação Firebase ──
    var verifAtual = ((_endVerif === null || _endVerif === void 0 ? void 0 : _endVerif.endereco) === valNorm) ? _endVerif : null;
    if (!verifAtual) {
        // Ainda não temos resultado — consultar e aguardar
        fb.innerHTML = "<div class=\"fb info\">\uD83D\uDD0D Verificando endere\u00E7o\u2026</div>";
        _verificarEnderecoFirebase(valNorm).then(function () { return confirmarEndereco(); });
        return;
    }
    var status = verifAtual.status, docsMeus = verifAtual.docsMeus, docsOutros = verifAtual.docsOutros;
    if (status === 'em_recontagem') {
        fb.innerHTML = "<div class=\"fb err\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n      <b>\uD83D\uDD12 Endere\u00E7o bloqueado para contagem normal</b>\n      <span style=\"font-size:.7rem;opacity:.9\">Este endere\u00E7o tem uma rodada em aberto \u2014 use a aba \uD83D\uDD04 RODADAS.</span>\n    </div>";
        document.getElementById('f-endereco').className = 'field field-err';
        APP.atual.enderecoValido = false;
        beepErr();
        return;
    }
    if (status === 'encerrado') {
        fb.innerHTML = "<div class=\"fb err\">\uD83D\uDEAB Endere\u00E7o encerrado \u2014 estorne na aba \u21A9\uFE0F ESTORNO para liberar</div>";
        document.getElementById('f-endereco').className = 'field field-err';
        beepErr();
        return;
    }
    if (status === 'outro') {
        // Bloquear — marcar campo como erro E mostrar modal (mesmo nível que em_recontagem)
        fb.innerHTML = "<div class=\"fb err\" style=\"flex-direction:column;align-items:flex-start;gap:3px\">\n      <b>\uD83D\uDEAB Endere\u00E7o ocupado por outro operador</b>\n      <span style=\"font-size:.7rem;opacity:.9\">Somente o operador respons\u00E1vel pode estornar.</span>\n    </div>";
        document.getElementById('f-endereco').className = 'field field-err';
        APP.atual.enderecoValido = false;
        _modalBloqueioOutroOperador(valNorm, docsOutros);
        beepErr();
        return;
    }
    if (status === 'proprio') {
        // Mesmo operador — mostrar opções: continuar ou estornar
        _modalOpcoesProprio(valNorm, docsMeus);
        return;
    }
    // 'livre' — prosseguir normalmente
    _prosseguirComEndereco(valNorm);
}
/** Prossegue para a etapa 2 após validar o endereço */
function _prosseguirComEndereco(valNorm) {
    var _a;
    var fb = document.getElementById('fb-endereco');
    var cap = ((_a = APP.endCapacidade) === null || _a === void 0 ? void 0 : _a[valNorm]) || 0;
    APP.atual.capacidadeEnd = cap;
    // ── DEBUG: mostrar capacidade detectada no feedback visual ──
    // (remover após confirmar que está funcionando)
    dbg('[LOTE DEBUG] endereço:', valNorm, '| cap:', cap, '| perguntaFeita:', APP.lotePerguntaFeita, '| endCapKeys:', Object.keys(APP.endCapacidade || {}).length);
    var capAmostra = Object.entries(APP.endCapacidade || {}).filter(function (_a) {
        var v = _a[1];
        return v > 0;
    }).slice(0, 3).map(function (_a) {
        var k = _a[0], v = _a[1];
        return k + '=' + v;
    }).join(', ');
    dbg('[LOTE DEBUG] amostra endCapacidade c/ cap>0:', capAmostra || '(nenhum)');
    // Em modo recontagem: nova sessão limpa — sem info de contagens anteriores
    if (APP.modoRecontagem) {
        fb.innerHTML = "<div class=\"fb ok\">\u2713 Endere\u00E7o confirmado \u2014 iniciando nova rodada</div>";
        APP.atual.endereco = valNorm;
        APP.atual._endNorm = valNorm;
        APP.atual.somentesDun = valNorm.includes('14.1520');
        APP.atual.step = 2;
        beepSuave();
        var el2_1 = document.getElementById('cp-proximo-hint');
        var el3_1 = document.getElementById('f-capa');
        var el4_1 = document.getElementById('fb-capa');
        if (el3_1)
            el3_1.value = '';
        if (el4_1)
            el4_1.innerHTML = '';
        updateSteps();
        setTimeout(function () { return el3_1 === null || el3_1 === void 0 ? void 0 : el3_1.focus(); }, 120);
        return;
    }
    // ── Verificar oferta de lançamento rápido (endereços grandes) ──
    // Só oferece se: cap >= 10, primeira vez neste endereço, não é recontagem
    APP.atual.endereco = valNorm;
    APP.atual._endNorm = valNorm;
    APP.atual.capacidadeEnd = cap;
    APP.atual.somentesDun = valNorm.includes('14.1520');
    // DEBUG visual — exibe cap detectada no feedback para confirmar no celular
    if (fb)
        fb.innerHTML = "<div class=\"fb info\" style=\"font-size:.68rem;line-height:1.5\">\n    \uD83D\uDD0D <b>cap:</b> ".concat(cap, " | min: ").concat(LOTE_CAP_MINIMA, " | pergunta: ").concat(APP.lotePerguntaFeita, "<br>\n    ends c/cap: ").concat(Object.values(APP.endCapacidade || {}).filter(function (v) { return v > 0; }).length, " / ").concat(Object.keys(APP.endCapacidade || {}).length, "<br>\n    <span style=\"opacity:.7\">").concat(capAmostra || '(sem cap>0)', "</span>\n  </div>");
    if (_loteVerificarOferta(valNorm, valNorm, cap))
        return; // painel lote assumiu o controle
    var palletsJaContados = _palletsNoEnderecoAtual(valNorm);
    var infoCapacidade = '';
    if (cap > 0) {
        var restantes = Math.max(0, cap - palletsJaContados);
        infoCapacidade = "<div class=\"fb info\" style=\"margin-top:6px\">\n      \uD83C\uDFF7\uFE0F Capacidade: <b>".concat(cap, "</b> pallets &nbsp;\u00B7&nbsp;\n      Contados: <b>").concat(palletsJaContados, "</b> &nbsp;\u00B7&nbsp;\n      Restantes: <b>").concat(restantes, "</b>\n    </div>");
    }
    else if (palletsJaContados > 0) {
        infoCapacidade = "<div class=\"fb info\" style=\"margin-top:6px\">\n      \uD83D\uDCE6 Pallets contados neste endere\u00E7o: <b>".concat(palletsJaContados, "</b>\n    </div>");
    }
    fb.innerHTML = (palletsJaContados > 0
        ? "<div class=\"fb ok\">\u2713 Continuando endere\u00E7o \u2014 pallet ".concat(palletsJaContados + 1, "</div>")
        : "<div class=\"fb ok\">\u2713 Endere\u00E7o confirmado</div>") + infoCapacidade;
    APP.atual.endereco = valNorm;
    APP.atual._endNorm = valNorm;
    APP.atual.somentesDun = valNorm.includes('14.1520');
    APP.atual.step = 2;
    beepSuave();
    var el2 = document.getElementById('cp-proximo-hint');
    var el3 = document.getElementById('f-capa');
    var el4 = document.getElementById('fb-capa');
    if (el2) {
        var range = APP.capaRange;
        el2.textContent = ((range === null || range === void 0 ? void 0 : range.min) && (range === null || range === void 0 ? void 0 : range.max))
            ? "Range: ".concat(range.min, "\u2013").concat(range.max, " \u00B7 Pr\u00F3ximo: ").concat(APP.proximoCapa)
            : 'Próximo disponível: ' + APP.proximoCapa;
    }
    if (el3)
        el3.value = '';
    if (el4)
        el4.innerHTML = '';
    updateSteps();
    // Garantir explicitamente que o botão VAZIO está visível após confirmar endereço
    var _vaziow = document.getElementById('btn-vazio-wrap');
    if (_vaziow && !APP.lote)
        _vaziow.style.display = '';
    setTimeout(function () { try {
        document.getElementById('f-capa').focus();
    }
    catch (e) { } }, 100);
}
/** Modal de bloqueio quando outro operador já coletou */
function _modalBloqueioOutroOperador(endNorm, docsOutros) {
    var _a;
    var quem = ((_a = docsOutros[0]) === null || _a === void 0 ? void 0 : _a.operador) || 'outro operador';
    var qtd = docsOutros.length;
    _criarModal({
        icone: '🚫',
        titulo: 'Endereço já coletado',
        corBorda: 'rgba(255,71,87,.5)',
        corpo: "\n      <div style=\"font-size:.82rem;color:var(--text);text-align:center;line-height:1.6\">\n        Endere\u00E7o <b style=\"font-family:var(--mono);color:var(--accent)\">".concat(endNorm, "</b> foi coletado por\n        <b style=\"color:var(--warn)\">").concat(quem, "</b>\n        <br><span style=\"font-size:.72rem;color:var(--muted)\">").concat(qtd, " pallet(s) registrado(s)</span>\n      </div>\n      <div style=\"margin-top:10px;padding:10px 12px;background:rgba(255,71,87,.08);border:1px solid rgba(255,71,87,.2);border-radius:8px;font-size:.75rem;color:var(--muted);text-align:center\">\n        Somente <b>").concat(quem, "</b> pode estornar esta contagem.\n      </div>"),
        botoes: [
            { label: '← Voltar', estilo: 'ghost', acao: null }
        ]
    });
}
/** Modal com opções quando o próprio operador já contou */
function _modalOpcoesProprio(endNorm, docsMeus) {
    var qtd = docsMeus.length;
    var docIds = docsMeus.map(function (c) { return c._docId || c.uuid; }).filter(Boolean);
    // ── Regra do 1 minuto: verificar tempo da contagem mais recente ──
    var agora = Date.now();
    var maisRecente = docsMeus.reduce(function (latest, c) {
        // criado_em pode ser string ISO, Timestamp Firebase ou Date — normalizar todos
        var raw = c.criado_em || c.dataHora || 0;
        var t = (raw === null || raw === void 0 ? void 0 : raw.toDate) ? raw.toDate().getTime()
            : (raw === null || raw === void 0 ? void 0 : raw.seconds) ? raw.seconds * 1000
                : new Date(raw).getTime();
        return (!isNaN(t) && t > latest) ? t : latest;
    }, 0);
    var segundosAtras = maisRecente ? Math.floor((agora - maisRecente) / 1000) : Infinity;
    var dentroDoTempo = segundosAtras <= 60;
    if (!dentroDoTempo) {
        // Fora do prazo — bloquear completamente
        _criarModal({
            icone: '🔒',
            titulo: 'Endereço bloqueado',
            corBorda: 'rgba(255,71,87,.5)',
            corpo: "\n        <div style=\"font-size:.82rem;color:var(--text);text-align:center;line-height:1.6\">\n          Endere\u00E7o <b style=\"font-family:var(--mono);color:var(--accent)\">".concat(endNorm, "</b>\n          <br><span style=\"font-size:.72rem;color:var(--muted)\">Contagem registrada h\u00E1 ").concat(segundosAtras, "s</span>\n        </div>\n        <div style=\"margin-top:10px;font-size:.78rem;color:#ff4757;text-align:center;line-height:1.5;padding:10px;background:rgba(255,71,87,.08);border-radius:8px;border:1px solid rgba(255,71,87,.2)\">\n          \u23F1 Tempo limite de corre\u00E7\u00E3o (1 min) expirado.<br>\n          Este endere\u00E7o est\u00E1 bloqueado.<br>\n          <b>Solicite nova rodada ao analista.</b>\n        </div>"),
            botoes: [
                { label: '← Voltar', estilo: 'ghost', acao: null },
            ]
        });
        document.getElementById('f-endereco').className = 'field field-err';
        APP.atual.enderecoValido = false;
        beepErr();
        return;
    }
    // Dentro do prazo (≤ 60s) — mostrar opções normais
    var tempoRestante = 60 - segundosAtras;
    _criarModal({
        icone: '⚠️',
        titulo: 'Você já contou este endereço',
        corBorda: 'rgba(255,179,0,.5)',
        corpo: "\n      <div style=\"font-size:.82rem;color:var(--text);text-align:center;line-height:1.6\">\n        Endere\u00E7o <b style=\"font-family:var(--mono);color:var(--accent)\">".concat(endNorm, "</b>\n        <br><span style=\"font-size:.72rem;color:var(--muted)\">").concat(qtd, " pallet(s) j\u00E1 registrado(s) por voc\u00EA</span>\n      </div>\n      <div style=\"margin-top:8px;font-size:.72rem;color:#00d68f;text-align:center;padding:6px;background:rgba(0,214,143,.08);border-radius:6px;border:1px solid rgba(0,214,143,.2)\">\n        \u2705 Corre\u00E7\u00E3o permitida \u2014 ").concat(tempoRestante, "s restantes\n      </div>\n      <div style=\"margin-top:8px;font-size:.72rem;color:var(--muted);text-align:center\">\n        O que deseja fazer?\n      </div>"),
        botoes: [
            { label: '← Voltar', estilo: 'ghost', acao: null },
            { label: '+ Adicionar pallet', estilo: 'primary', acao: function () { return _prosseguirComEndereco(endNorm); } },
            { label: '↩ Estornar e recontar', estilo: 'warn', acao: function () { return _estornarERecomecar(endNorm, docIds); } }
        ]
    });
}
/** Estorna todos os pallets do endereço e inicia nova contagem */
function _estornarERecomecar(endNorm, docIds) {
    return __awaiter(this, void 0, void 0, function () {
        var op, _loop_1, _i, docIds_1, id, err_2;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    op = ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || '';
                    toast('↩ Estornando contagens…', 'w');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 6, , 7]);
                    _loop_1 = function (id) {
                        var idx;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0: return [4 /*yield*/, FS.collection(FCOL.contagens).doc(id).update({
                                        _excluida: true,
                                        status: 'ESTORNADA',
                                        _excluida_em: new Date().toISOString(),
                                        estornada_por: op,
                                    })];
                                case 1:
                                    _c.sent();
                                    idx = APP.contagens.findIndex(function (c) { return (c.uuid === id || c._docId === id); });
                                    if (idx >= 0) {
                                        APP.contagens[idx]._excluida = true;
                                        APP.contagens[idx].status = 'ESTORNADA';
                                        APP.contagens[idx]._excluida_em = new Date().toISOString();
                                        APP.contagens[idx].estornada_por = op;
                                    }
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, docIds_1 = docIds;
                    _b.label = 2;
                case 2:
                    if (!(_i < docIds_1.length)) return [3 /*break*/, 5];
                    id = docIds_1[_i];
                    return [5 /*yield**/, _loop_1(id)];
                case 3:
                    _b.sent();
                    _b.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5:
                    // Invalidar cache do endereço
                    _endVerif = null;
                    renderHistorico();
                    updateStats();
                    toast('✓ Estornado. Pode recontar.', 's');
                    beepOk();
                    _prosseguirComEndereco(endNorm);
                    return [3 /*break*/, 7];
                case 6:
                    err_2 = _b.sent();
                    toast('✗ Erro ao estornar: ' + err_2.message, 'e');
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    });
}
/** Factory de modais reutilizável */
function _criarModal(_a) {
    var icone = _a.icone, titulo = _a.titulo, corBorda = _a.corBorda, corpo = _a.corpo, botoes = _a.botoes;
    var old = document.getElementById('_modal_end_bloq');
    if (old)
        old.remove();
    var modal = document.createElement('div');
    modal.id = '_modal_end_bloq';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    var botoesHtml = botoes.map(function (b, i) {
        var bg = b.estilo === 'primary' ? 'background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:800'
            : b.estilo === 'warn' ? 'background:rgba(255,71,87,.15);border:1px solid rgba(255,71,87,.4);color:#ff4757;font-weight:700'
                : 'background:transparent;border:1px solid var(--border);color:var(--muted)';
        return "<button id=\"_mbtn_".concat(i, "\" style=\"flex:1;padding:11px 8px;border-radius:10px;font-size:.82rem;font-family:var(--sans);cursor:pointer;border:none;").concat(bg, "\">").concat(b.label, "</button>");
    }).join('');
    modal.innerHTML = "\n    <div style=\"background:var(--surface);border:1.5px solid ".concat(corBorda, ";border-radius:18px;padding:24px 20px;max-width:340px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)\">\n      <div style=\"font-size:1.8rem;text-align:center;margin-bottom:8px\">").concat(icone, "</div>\n      <div style=\"font-weight:800;font-size:.95rem;text-align:center;margin-bottom:14px;color:var(--text)\">").concat(titulo, "</div>\n      ").concat(corpo, "\n      <div style=\"display:flex;gap:8px;margin-top:16px\">").concat(botoesHtml, "</div>\n    </div>");
    document.body.appendChild(modal);
    botoes.forEach(function (b, i) {
        document.getElementById("_mbtn_".concat(i)).onclick = function () {
            modal.remove();
            if (b.acao)
                b.acao();
        };
    });
    modal.addEventListener('click', function (e) { if (e.target === modal)
        modal.remove(); });
}
// ═══════════════════════════════════════════════════════════════════
//  LANÇAMENTO RÁPIDO EM LOTE
// ═══════════════════════════════════════════════════════════════════
var LOTE_CAP_MINIMA = 10; // capacidade mínima para oferecer o modo lote
/**
 * Retorna quantos pallets foram contados no endereço indicado,
 * excluindo registros do tipo VAZIO.
 *
 * Em modo recontagem: conta APENAS registros da sessão atual de
 * recontagem (tipo_contagem === 'RECONTAGEM'), ignorando os registros
 * da 1ª contagem para não bloquear o fluxo nem poluir contadores.
 */
function _palletsNoEnderecoAtual(endNorm) {
    var endereco = endNorm || '';
    var locais = (APP.contagens || []).filter(function (c) {
        return c.endereco === endereco &&
            c.tipo_contagem !== 'VAZIO' &&
            !c._excluida &&
            c.status !== 'ESTORNADA' &&
            c.status !== 'EXCLUIDA' &&
            // Em recontagem: ignorar registros de contagem anterior (PRIMEIRA)
            (!APP.modoRecontagem || c.tipo_contagem === 'RECONTAGEM');
    });
    // _verificarEnderecoFirebase() consulta as contagens existentes no Firestore antes
    // de confirmar o endereço. Reaproveitar esses documentos evita que um reload do app
    // zere artificialmente a capacidade já ocupada no endereço.
    var remotos = (_endVerif && _endVerif.endereco === endereco ? (_endVerif.docs || []) : []).filter(function (c) {
        return c.tipo_contagem !== 'VAZIO' &&
            !c._excluida &&
            c.status !== 'ESTORNADA' &&
            c.status !== 'EXCLUIDA' &&
            (!APP.modoRecontagem || c.tipo_contagem === 'RECONTAGEM');
    });
    // União idempotente: a mesma contagem pode existir no array local e no snapshot.
    var unicos = new Map();
    var chave = function (c, i, origem) { return String(c.uuid || c._docId || c.id ||
        [origem, c.inventario_id || '', c.endereco || '', c.capa_palete || c.capa || '', c.criada_em || c.data_hora || '', i].join('|')); };
    remotos.forEach(function (c, i) { return unicos.set(chave(c, i, 'fs'), c); });
    locais.forEach(function (c, i) {
        var id = String(c.uuid || c._docId || c.id || '');
        if (id)
            unicos.set(id, c);
        else
            unicos.set(chave(c, i, 'local'), c);
    });
    return unicos.size;
}
/** Alias para uso interno do módulo lote */
function _lotePalletsJaUsados(endNorm) {
    var _a;
    return _palletsNoEnderecoAtual(endNorm || ((_a = APP.lote) === null || _a === void 0 ? void 0 : _a.endNorm) || '');
}
function _loteSetPainel(ativo) {
    var painel = document.getElementById('painel-lote');
    var steps = document.getElementById('steps');
    // step-fields que devem sumir quando lote estiver ativo
    var stepIds = ['step-capa', 'step-gtin', 'step-validade', 'step-quantidade', 'bloco-endereco-travado'];
    var btVazio = document.getElementById('btn-vazio-wrap');
    if (ativo) {
        if (painel)
            painel.style.display = '';
        stepIds.forEach(function (id) { var el = document.getElementById(id); if (el)
            el.style.display = 'none'; });
        // manter step-endereco visível mas congelado (sem interação)
        if (btVazio)
            btVazio.style.display = 'none';
    }
    else {
        if (painel)
            painel.style.display = 'none';
        stepIds.forEach(function (id) { var el = document.getElementById(id); if (el)
            el.style.display = ''; });
    }
}
/** Mostra apenas a tela indicada dentro do painel, esconde as demais */
function _loteShowTela(telaId) {
    ['oferta', 'gtin', 'qtd', 'total', 'capas', 'validade', 'continuar'].forEach(function (id) {
        var el = document.getElementById('lote-tela-' + id);
        if (el)
            el.style.display = (('lote-tela-' + id) === telaId || id === telaId) ? '' : 'none';
    });
    // alias curto: pode passar 'oferta' ou 'lote-tela-oferta'
    var el = document.getElementById('lote-tela-' + telaId) || document.getElementById(telaId);
    if (el)
        el.style.display = '';
    _loteAtualizarHeader();
}
function _loteAtualizarHeader() {
    var _a, _b;
    var l = APP.lote;
    if (!l)
        return;
    var hEnd = document.getElementById('lote-header-end');
    var hProg = document.getElementById('lote-header-prog');
    if (hEnd)
        hEnd.textContent = l.endExib || '';
    if (hProg) {
        if (l.totalPallets) {
            var lidos = ((_a = l.capasLidas) === null || _a === void 0 ? void 0 : _a.length) || 0;
            hProg.textContent = "Pallets: ".concat(lidos, " / ").concat(l.totalPallets, " \u00B7 Qtd padr\u00E3o: ").concat((_b = l.qtdPadrao) !== null && _b !== void 0 ? _b : '—');
        }
        else {
            var ja = _lotePalletsJaUsados(l.endNorm);
            var cap = l.cap || 0;
            hProg.textContent = cap > 0 ? "Capacidade: ".concat(cap, " \u00B7 Usados: ").concat(ja, " \u00B7 Restantes: ").concat(cap - ja) : '';
        }
    }
}
// ──────────────────────────────────────────────────────────────────
//  ENTRADA: chamado em _prosseguirComEndereco quando cap >= 10
// ──────────────────────────────────────────────────────────────────
function loteOferecer(endNorm, endExib, cap) {
    if (APP.modoRecontagem)
        return; // recontagem = sempre manual
    APP.lote = { endNorm: endNorm, endExib: endExib, cap: cap, gtin: null, codigoProduto: null,
        descricaoProduto: null, qtdPadrao: null, totalPallets: null,
        capasLidas: [], grupos: [], totalSalvos: 0 };
    APP.lotePerguntaFeita = true;
    _loteSetPainel(true);
    _loteShowTela('oferta');
    var jaUsados = _lotePalletsJaUsados(endNorm);
    var restantes = Math.max(0, cap - jaUsados);
    var txt = document.getElementById('lote-oferta-cap-txt');
    if (txt)
        txt.innerHTML = "Capacidade: <b>".concat(cap, " pallets</b>").concat(jaUsados > 0 ? " &nbsp;\u00B7&nbsp; J\u00E1 contados: <b>".concat(jaUsados, "</b> &nbsp;\u00B7&nbsp; Restantes: <b>").concat(restantes, "</b>") : '');
    var hdr = document.getElementById('lote-header');
    if (hdr)
        hdr.style.display = 'none'; // esconder cabeçalho na tela de oferta
}
function loteRecusar() {
    // Operador prefere modo manual — fechar painel e continuar fluxo normal
    APP.lote = null;
    _loteSetPainel(false);
    // Redirecionar para step 2 (capa)
    APP.atual.step = 2;
    updateSteps();
    var el = document.getElementById('f-capa');
    if (el) {
        el.value = '';
        el.disabled = false;
        setTimeout(function () { return el.focus(); }, 80);
    }
    // Mostrar botão vazio
    var vw = document.getElementById('btn-vazio-wrap');
    if (vw)
        vw.style.display = '';
}
function loteAceitar() {
    var hdr = document.getElementById('lote-header');
    if (hdr)
        hdr.style.display = '';
    _loteShowTela('gtin');
    setTimeout(function () { var _a; return (_a = document.getElementById('lote-f-gtin')) === null || _a === void 0 ? void 0 : _a.focus(); }, 120);
}
function loteAbortar() {
    var _a, _b, _c;
    var endNorm = (_a = APP.lote) === null || _a === void 0 ? void 0 : _a.endNorm;
    var cap = (_b = APP.lote) === null || _b === void 0 ? void 0 : _b.cap;
    var sonen = ((_c = APP.lote) === null || _c === void 0 ? void 0 : _c.somentesDun) || false;
    APP.lote = null;
    _loteSetPainel(false);
    if (endNorm) {
        // Se já salvou algum pallet, entrar no modo travado
        var j = _lotePalletsJaUsados(endNorm);
        if (j > 0) {
            _manterEnderecoAtivo(endNorm, endNorm, cap || 0, sonen);
        }
        else {
            resetContagem();
        }
    }
    else {
        resetContagem();
    }
}
// ──────────────────────────────────────────────────────────────────
//  TELA GTIN
// ──────────────────────────────────────────────────────────────────
function loteOnGtinInput() {
    var _a;
    var val = (((_a = document.getElementById('lote-f-gtin')) === null || _a === void 0 ? void 0 : _a.value) || '').trim();
    var fb = document.getElementById('lote-fb-gtin');
    if (!fb)
        return;
    if (!val) {
        fb.innerHTML = '';
        return;
    }
    var match = _buscarProduto(val); // reutiliza a lógica existente de busca de produto
    if (match) {
        fb.innerHTML = "<div class=\"fb ok\" style=\"font-size:.75rem\">\u2713 ".concat(escHTML(match.descricao_produto || match.codigo_produto), "</div>");
    }
    else {
        fb.innerHTML = "<div class=\"fb warn\" style=\"font-size:.75rem\">\u26A0 C\u00F3digo n\u00E3o encontrado na base \u2014 ser\u00E1 registrado assim mesmo</div>";
    }
}
function loteConfirmarGtin() {
    var _a;
    var val = (((_a = document.getElementById('lote-f-gtin')) === null || _a === void 0 ? void 0 : _a.value) || '').trim();
    var fb = document.getElementById('lote-fb-gtin');
    if (!val) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">Bipe ou digite o c\u00F3digo</div>";
        return;
    }
    if (!APP.lote)
        return;
    var match = _buscarProduto(val);
    APP.lote.gtin = normProd(val);
    APP.lote.codigoProduto = normProd((match === null || match === void 0 ? void 0 : match.codigo_produto) || val);
    APP.lote.descricaoProduto = (match === null || match === void 0 ? void 0 : match.descricao_produto) || 'Código sem cadastro';
    _loteShowTela('qtd');
    var resumoEl = document.getElementById('lote-prod-resumo');
    if (resumoEl)
        resumoEl.innerHTML = "<b>".concat(escHTML(APP.lote.descricaoProduto), "</b><br><span style=\"opacity:.7\">").concat(escHTML(APP.lote.gtin), "</span>");
    setTimeout(function () { var _a; return (_a = document.getElementById('lote-f-qtd-padrao')) === null || _a === void 0 ? void 0 : _a.focus(); }, 120);
}
/** Reutiliza a lógica de busca de produto do fluxo normal */
function _buscarProduto(gtin) {
    var _a, _b;
    if (!((_a = APP.base) === null || _a === void 0 ? void 0 : _a.length))
        return null;
    var endNorm = ((_b = APP.lote) === null || _b === void 0 ? void 0 : _b.endNorm) || APP.atual._endNorm || '';
    // Primeiro tenta pelo endereço + gtin
    var matchEnd = APP.base.find(function (r) { return r._end === endNorm && (r.gtin === gtin || r.codigo_produto === gtin); });
    if (matchEnd)
        return matchEnd;
    // Fallback: qualquer produto com esse código
    return APP.base.find(function (r) { return r.gtin === gtin || r.codigo_produto === gtin; }) || null;
}
// ──────────────────────────────────────────────────────────────────
//  TELA QTD PADRÃO
// ──────────────────────────────────────────────────────────────────
function loteConfirmarQtdPadrao() {
    var _a;
    var val = parseInt((_a = document.getElementById('lote-f-qtd-padrao')) === null || _a === void 0 ? void 0 : _a.value);
    var fb = document.getElementById('lote-fb-qtd');
    if (isNaN(val) || val <= 0) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">Informe uma quantidade v\u00E1lida</div>";
        return;
    }
    APP.lote.qtdPadrao = val;
    _loteShowTela('total');
    // Mostrar resumo + aviso de capacidade
    var jaUsados = _lotePalletsJaUsados(APP.lote.endNorm);
    var maxPoss = APP.lote.cap > 0 ? Math.max(0, APP.lote.cap - jaUsados) : 999;
    var resumoEl = document.getElementById('lote-total-resumo');
    if (resumoEl)
        resumoEl.innerHTML = "Produto: <b>".concat(escHTML(APP.lote.descricaoProduto), "</b><br>Qtd/pallet: <b>").concat(escHTML(String(val)), "</b>");
    var avisoEl = document.getElementById('lote-total-aviso-cap');
    if (avisoEl && APP.lote.cap > 0) {
        avisoEl.style.display = '';
        avisoEl.innerHTML = "\u26A0 Capacidade do endere\u00E7o: <b>".concat(escHTML(String(APP.lote.cap)), "</b> &nbsp;\u00B7&nbsp; J\u00E1 usados: <b>").concat(escHTML(String(jaUsados)), "</b> &nbsp;\u00B7&nbsp; M\u00E1ximo neste lote: <b>").concat(escHTML(String(maxPoss)), "</b>");
    }
    var fTotal = document.getElementById('lote-f-total');
    if (fTotal) {
        fTotal.max = String(maxPoss);
        fTotal.value = '';
    }
    setTimeout(function () { return fTotal === null || fTotal === void 0 ? void 0 : fTotal.focus(); }, 120);
}
// ──────────────────────────────────────────────────────────────────
//  TELA TOTAL DE PALLETS
// ──────────────────────────────────────────────────────────────────
function loteConfirmarTotal() {
    var _a;
    var val = parseInt((_a = document.getElementById('lote-f-total')) === null || _a === void 0 ? void 0 : _a.value);
    var fb = document.getElementById('lote-fb-total');
    var jaUsados = _lotePalletsJaUsados(APP.lote.endNorm);
    var maxPoss = APP.lote.cap > 0 ? Math.max(0, APP.lote.cap - jaUsados) : 9999;
    if (isNaN(val) || val <= 0) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">Informe uma quantidade v\u00E1lida</div>";
        return;
    }
    if (APP.lote.cap > 0 && val > maxPoss) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">M\u00E1ximo permitido: ".concat(maxPoss, " pallet(s)</div>");
        return;
    }
    APP.lote.totalPallets = val;
    APP.lote.capasLidas = [];
    _loteShowTela('capas');
    _loteAtualizarTelaCapa();
    setTimeout(function () { var _a; return (_a = document.getElementById('lote-f-capa')) === null || _a === void 0 ? void 0 : _a.focus(); }, 120);
}
// ──────────────────────────────────────────────────────────────────
//  TELA LEITURA DE CAPAS
// ──────────────────────────────────────────────────────────────────
function _loteAtualizarTelaCapa() {
    var l = APP.lote;
    var lidas = l.capasLidas.length;
    var total = l.totalPallets;
    var restante = total - lidas;
    var pct = total > 0 ? Math.round((lidas / total) * 100) : 0;
    var progEl = document.getElementById('lote-capas-prog');
    var barEl = document.getElementById('lote-capas-bar');
    var listaWrap = document.getElementById('lote-capas-lidas-wrap');
    var listaEl = document.getElementById('lote-capas-lidas-list');
    if (progEl)
        progEl.innerHTML = "Pallet <b>".concat(lidas + 1, "</b> de <b>").concat(total, "</b> &nbsp;\u00B7&nbsp; Restam: <b>").concat(restante, "</b>");
    if (barEl)
        barEl.style.width = pct + '%';
    if (listaWrap)
        listaWrap.style.display = lidas > 0 ? '' : 'none';
    if (listaEl)
        listaEl.innerHTML = l.capasLidas.map(function (c, i) {
            return "<span style=\"background:rgba(232,117,26,.12);border:1px solid rgba(232,117,26,.25);border-radius:6px;padding:2px 7px;font-family:var(--mono);font-size:.68rem;color:var(--accent)\">".concat(c, "</span>");
        }).join('');
    _loteAtualizarHeader();
}
function loteOnCapaInput() {
    var _a, _b;
    var val = ((_a = document.getElementById('lote-f-capa')) === null || _a === void 0 ? void 0 : _a.value) || '';
    var fb = document.getElementById('lote-fb-capa');
    if (!fb)
        return;
    if (val.length >= 7) {
        // Verificar duplicata
        if ((_b = APP.lote) === null || _b === void 0 ? void 0 : _b.capasLidas.includes(val)) {
            fb.innerHTML = "<div class=\"fb err\">\u26A0 Capa j\u00E1 lida neste lote</div>";
        }
        else {
            fb.innerHTML = "<div class=\"fb ok\" style=\"font-size:.75rem\">\u2713 ".concat(val, "</div>");
        }
    }
    else {
        fb.innerHTML = '';
    }
}
function loteConfirmarCapa() {
    var fCapa = document.getElementById('lote-f-capa');
    var fb = document.getElementById('lote-fb-capa');
    var val = ((fCapa === null || fCapa === void 0 ? void 0 : fCapa.value) || '').trim();
    if (!val || val.length < 7) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">M\u00EDnimo 7 d\u00EDgitos</div>";
        return;
    }
    if (APP.lote.capasLidas.includes(val)) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">Capa j\u00E1 lida \u2014 bipe a pr\u00F3xima</div>";
        return;
    }
    APP.lote.capasLidas.push(val);
    beepOk();
    var lidas = APP.lote.capasLidas.length;
    var total = APP.lote.totalPallets;
    if (lidas >= total) {
        // Todas as capas lidas — ir para validade
        _loteIniciarValidade();
    }
    else {
        // Próxima capa
        if (fCapa)
            fCapa.value = '';
        if (fb)
            fb.innerHTML = "<div class=\"fb ok\">\u2713 Capa ".concat(lidas, " registrada \u2014 leia a pr\u00F3xima</div>");
        _loteAtualizarTelaCapa();
        setTimeout(function () { (fCapa === null || fCapa === void 0 ? void 0 : fCapa.value) === '' && (fCapa === null || fCapa === void 0 ? void 0 : fCapa.focus()); }, 80);
    }
}
// ──────────────────────────────────────────────────────────────────
//  TELA VALIDADE POR GRUPO
// ──────────────────────────────────────────────────────────────────
function _loteIniciarValidade() {
    APP.lote.pendenciasValidade = __spreadArray([], APP.lote.capasLidas, true); // todas as capas ainda sem validade
    _loteShowTela('validade');
    _loteAtualizarTelaValidade();
    setTimeout(function () { var _a; return (_a = document.getElementById('lote-f-validade')) === null || _a === void 0 ? void 0 : _a.focus(); }, 120);
}
function _loteAtualizarTelaValidade() {
    var _a;
    var l = APP.lote;
    var pend = ((_a = l.pendenciasValidade) === null || _a === void 0 ? void 0 : _a.length) || 0;
    var txtEl = document.getElementById('lote-val-pendente-txt');
    var fValQtd = document.getElementById('lote-f-val-qtd');
    if (txtEl)
        txtEl.innerHTML = "Faltam definir validade de <b>".concat(pend, "</b> pallet(s)");
    if (fValQtd) {
        fValQtd.max = String(pend);
        fValQtd.value = pend === 1 ? '1' : '';
    }
}
function loteOnValidadeInput() {
    var _a;
    var val = ((_a = document.getElementById('lote-f-validade')) === null || _a === void 0 ? void 0 : _a.value) || '';
    var fb = document.getElementById('lote-fb-validade');
    if (!fb || !val) {
        if (fb)
            fb.innerHTML = '';
        return;
    }
    // Formato simples: aceitar MM/AAAA ou DD/MM/AAAA
    if (/^\d{2}\/\d{4}$/.test(val) || /^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
        fb.innerHTML = "<div class=\"fb ok\" style=\"font-size:.75rem\">\u2713 ".concat(val, "</div>");
    }
    else {
        fb.innerHTML = '';
    }
}
function loteConfirmarValidadeInput() {
    var _a;
    // Avança para o campo de qtd ao dar Enter na validade
    (_a = document.getElementById('lote-f-val-qtd')) === null || _a === void 0 ? void 0 : _a.focus();
}
function loteConfirmarValidade() {
    var _a, _b, _c;
    var validade = (((_a = document.getElementById('lote-f-validade')) === null || _a === void 0 ? void 0 : _a.value) || '').trim();
    var qtdPal = parseInt((_b = document.getElementById('lote-f-val-qtd')) === null || _b === void 0 ? void 0 : _b.value);
    var fb = document.getElementById('lote-fb-validade');
    var pend = ((_c = APP.lote.pendenciasValidade) === null || _c === void 0 ? void 0 : _c.length) || 0;
    if (!validade) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">Informe a validade</div>";
        return;
    }
    if (isNaN(qtdPal) || qtdPal <= 0) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">Informe quantos pallets</div>";
        return;
    }
    if (qtdPal > pend) {
        if (fb)
            fb.innerHTML = "<div class=\"fb err\">M\u00E1ximo: ".concat(pend, "</div>");
        return;
    }
    // Pegar as primeiras qtdPal capas das pendências
    var capasGrupo = APP.lote.pendenciasValidade.splice(0, qtdPal);
    APP.lote.grupos.push({ validade: validade, capas: capasGrupo });
    if (APP.lote.pendenciasValidade.length > 0) {
        // Ainda há pendências
        document.getElementById('lote-f-validade').value = '';
        _loteAtualizarTelaValidade();
        if (fb)
            fb.innerHTML = "<div class=\"fb ok\">\u2713 ".concat(qtdPal, " pallet(s) com validade ").concat(validade, " \u2014 defina a pr\u00F3xima</div>");
        setTimeout(function () { var _a; return (_a = document.getElementById('lote-f-validade')) === null || _a === void 0 ? void 0 : _a.focus(); }, 80);
    }
    else {
        // Tudo definido — salvar e ir para continuação
        _loteSalvarTudo();
    }
}
// ──────────────────────────────────────────────────────────────────
//  SALVAR TODOS OS PALLETS DO LOTE INDIVIDUALMENTE
// ──────────────────────────────────────────────────────────────────
function _loteSalvarTudo() {
    // ── Verificar status do inventário antes de salvar o lote ──
    if (!APP.inventario) {
        toast('⚠ Nenhum inventário ativo — selecione um inventário antes de contar.', 'e');
        return;
    }
    if (APP.inventario.status && APP.inventario.status !== 'ATIVO') {
        toast("\u26A0 Invent\u00E1rio \"".concat(APP.inventario.nome, "\" est\u00E1 ").concat(APP.inventario.status, ". Lote bloqueado."), 'e');
        APP.lote = null;
        _loteSetPainel(false);
        voltarInventarios();
        return;
    }
    var l = APP.lote;
    var agora = new Date();
    var saved = 0;
    // Para cada grupo de validade, salvar cada capa individualmente
    l.grupos.forEach(function (grupo) {
        grupo.capas.forEach(function (capa) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            var contagem = {
                id: Date.now() + Math.random(), // garante uniqueness em loop síncrono
                uuid: gerarUUID(),
                inventario_id: ((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.id) || 'local',
                inventario_nome: ((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.nome) || '',
                inventario_codigo: ((_c = APP.inventario) === null || _c === void 0 ? void 0 : _c.codigo) || '',
                endereco: l.endNorm,
                capa: capa,
                gtin: normProd(l.gtin),
                codigo_produto: normProd(l.codigoProduto),
                produto_codigo: l.codigoProduto,
                descricao: l.descricaoProduto,
                descricao_produto: l.descricaoProduto,
                validade: grupo.validade,
                quantidade: l.qtdPadrao,
                quantidade_esperada: '',
                divergente: false,
                operador: ((_d = APP.operador) === null || _d === void 0 ? void 0 : _d.name) || '',
                operador_id: ((_e = APP.operador) === null || _e === void 0 ? void 0 : _e.email) || ((_f = APP.operador) === null || _f === void 0 ? void 0 : _f.usuario) || ((_g = APP.operador) === null || _g === void 0 ? void 0 : _g.login) || '',
                operador_nome: ((_h = APP.operador) === null || _h === void 0 ? void 0 : _h.name) || ((_j = APP.operador) === null || _j === void 0 ? void 0 : _j.nome) || '',
                operador_email: ((_k = APP.operador) === null || _k === void 0 ? void 0 : _k.email) || '',
                coletor_id: localStorage.getItem('dt_device_id') || '',
                origem: 'COLETOR',
                tipo_contagem: 'PRIMEIRA',
                lancamento_rapido: true, // flag para rastreabilidade
                dataHora: agora,
                criado_em: agora.toISOString(),
                numero: APP.contagens.filter(function (c) { return c.endereco === l.endNorm; }).length + saved + 1,
            };
            APP.contagens.unshift(contagem);
            enfileirarContagem(__assign(__assign({}, contagem), { dataHora: agora.toISOString() }));
            saved++;
        });
    });
    l.totalSalvos = (l.totalSalvos || 0) + saved;
    if (!isNaN(l.qtdPadrao)) {
        var n = parseInt(l.capasLidas[l.capasLidas.length - 1]);
        if (!isNaN(n) && n >= APP.proximoCapa)
            APP.proximoCapa = n + 1;
    }
    renderHistorico();
    updateStats();
    beepOk();
    toast("\u2705 ".concat(saved, " pallets salvos em lote!"), 's');
    // ── Verificar capacidade após salvar batch ────────────────────────
    var _capLote = l.cap || 0;
    var _usadosLote = _lotePalletsJaUsados(l.endNorm);
    if (_capLote > 0 && _usadosLote >= _capLote) {
        // Capacidade atingida — encerrar imediatamente sem mostrar tela continuar
        toast("\u2705 Capacidade do endere\u00E7o atingida (".concat(_usadosLote, "/").concat(_capLote, ") \u2014 pr\u00F3ximo endere\u00E7o"), 's');
        APP.lote = null;
        _loteSetPainel(false);
        finalizarEnderecoAtual();
        return;
    }
    // Ainda há vaga → ir para tela de continuação
    _loteShowTela('continuar');
    var jaUsados = _lotePalletsJaUsados(l.endNorm);
    var restantes = l.cap > 0 ? Math.max(0, l.cap - jaUsados) : null;
    var resumoEl = document.getElementById('lote-cont-resumo');
    var capTxtEl = document.getElementById('lote-cont-cap-txt');
    if (resumoEl)
        resumoEl.innerHTML = "".concat(saved, " pallets salvos com sucesso!<br><span style=\"font-size:.78rem;color:var(--muted);font-weight:400\">").concat(l.descricaoProduto, " \u00B7 ").concat(l.qtdPadrao, " un/pallet</span>");
    if (capTxtEl && l.cap > 0)
        capTxtEl.innerHTML = "Capacidade: <b>".concat(l.cap, "</b> &nbsp;\u00B7&nbsp; J\u00E1 contados: <b>").concat(jaUsados, "</b> &nbsp;\u00B7&nbsp; Restantes: <b>").concat(restantes, "</b>");
    else if (capTxtEl)
        capTxtEl.innerHTML = "Total contado neste endere\u00E7o: <b>".concat(jaUsados, "</b>");
}
// ──────────────────────────────────────────────────────────────────
//  TELA CONTINUAR
// ──────────────────────────────────────────────────────────────────
function loteNovoBatch() {
    // Novo lote no mesmo endereço com o mesmo produto — reseta capas/grupos
    APP.lote.capasLidas = [];
    APP.lote.grupos = [];
    APP.lote.pendenciasValidade = [];
    APP.lote.qtdPadrao = null;
    APP.lote.totalPallets = null;
    // Volta para tela de qty padrão
    _loteShowTela('qtd');
    var resumoEl = document.getElementById('lote-prod-resumo');
    if (resumoEl)
        resumoEl.innerHTML = "<b>".concat(escHTML(APP.lote.descricaoProduto), "</b><br><span style=\"opacity:.7\">").concat(escHTML(APP.lote.gtin), "</span>");
    document.getElementById('lote-f-qtd-padrao').value = '';
    setTimeout(function () { var _a; return (_a = document.getElementById('lote-f-qtd-padrao')) === null || _a === void 0 ? void 0 : _a.focus(); }, 120);
}
function loteContinuarManual() {
    var _a, _b, _c;
    var endNorm = (_a = APP.lote) === null || _a === void 0 ? void 0 : _a.endNorm;
    var cap = ((_b = APP.lote) === null || _b === void 0 ? void 0 : _b.cap) || 0;
    var sonen = ((_c = APP.lote) === null || _c === void 0 ? void 0 : _c.somentesDun) || false;
    APP.lote = null;
    _loteSetPainel(false);
    // Entrar no modo travado (rebipar) — lógica existente
    var stepEnd = document.getElementById('step-endereco');
    if (stepEnd)
        stepEnd.style.display = 'none';
    _manterEnderecoAtivo(endNorm, endNorm, cap, sonen);
}
function loteEncerrar() {
    var _a;
    var endNorm = ((_a = APP.lote) === null || _a === void 0 ? void 0 : _a.endNorm) || '';
    APP.lote = null;
    _loteSetPainel(false);
    // Usar confirmarVazio somente se nenhum pallet foi contado,
    // caso contrário apenas encerrar (a divergência será detectada pelo analista)
    var j = _lotePalletsJaUsados(endNorm);
    if (j === 0 && endNorm) {
        _executarVazio(endNorm); // endereço realmente vazio — salvar vazio
    }
    else {
        finalizarEnderecoAtual(); // pallets já contados — apenas encerrar
        toast('✅ Endereço encerrado', 's');
    }
}
/** Chamado em _prosseguirComEndereco quando o endereço pode ser grande */
function _loteVerificarOferta(endNorm, endExib, capExplicita) {
    if (APP.modoRecontagem)
        return false; // recontagem = sempre manual
    if (APP.lotePerguntaFeita)
        return false; // já perguntou neste endereço
    var cap = capExplicita || 0;
    if (cap < LOTE_CAP_MINIMA)
        return false; // endereço pequeno — não oferecer
    loteOferecer(endNorm, endExib, cap);
    return true; // painel lote assumiu o controle
}
/** Deve ser chamado em resetContagem para limpar o estado lote */
function _loteReset() {
    APP.lote = null;
    APP.lotePerguntaFeita = false; // novo endereço → pode perguntar de novo
    _loteSetPainel(false);
}
/** Encerra o endereço como vazio — popup de confirmação obrigatório */
function confirmarVazio() {
    var _a, _b, _c, _d, _e;
    // Resolver o endereço por ordem de prioridade:
    // 1) modo recontagem  2) lote ativo  3) estado atual  4) campo de tela
    var raw = ((_a = document.getElementById('f-endereco')) === null || _a === void 0 ? void 0 : _a.value) || '';
    var endereco = ((_b = APP.modoRecontagem) === null || _b === void 0 ? void 0 : _b.endereco)
        || ((_c = APP.lote) === null || _c === void 0 ? void 0 : _c.endNorm)
        || APP.atual._endNorm
        || APP.atual._pendingEndereco
        || raw;
    if (!endereco.trim()) {
        toast('Informe o endereço primeiro', 'e');
        return;
    }
    var valNorm = _normStr(endereco);
    var cap = ((_d = APP.endCapacidade) === null || _d === void 0 ? void 0 : _d[valNorm]) || ((_e = APP.atual) === null || _e === void 0 ? void 0 : _e.capacidadeEnd) || 0;
    var palletsJaContados = _palletsNoEnderecoAtual(valNorm);
    // ── Modal de confirmação ──
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML = "\n    <div style=\"background:var(--surface);border:1.5px solid rgba(245,158,11,.5);border-radius:18px;padding:24px 20px;max-width:320px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)\">\n      <div style=\"font-size:1.8rem;text-align:center;margin-bottom:10px\">\uD83D\uDCED</div>\n      <div style=\"font-weight:800;font-size:.95rem;text-align:center;margin-bottom:6px;color:var(--text)\">Confirmar endere\u00E7o vazio?</div>\n      <div style=\"font-size:.78rem;color:var(--muted);text-align:center;margin-bottom:16px;line-height:1.5\">\n        Endere\u00E7o <b style=\"color:var(--warn);font-family:var(--mono)\">".concat(valNorm, "</b><br>\n        ").concat(palletsJaContados > 0
        ? "<span style=\"color:var(--text)\">".concat(palletsJaContados, " pallet(s) j\u00E1 contado(s)</span><br>")
        : '', "\n        ").concat(cap > 0 ? "Capacidade: <b>".concat(cap, "</b> pallets<br>") : '', "\n        <span style=\"color:var(--warn)\">Isso encerrar\u00E1 este endere\u00E7o.</span>\n      </div>\n      <div style=\"display:flex;gap:10px\">\n        <button id=\"btn-vazio-cancelar\" style=\"flex:1;padding:12px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:.88rem;cursor:pointer\">\u2717 Cancelar</button>\n        <button id=\"btn-vazio-ok\" style=\"flex:1;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-size:.88rem;font-weight:800;cursor:pointer\">\uD83D\uDCED Confirmar</button>\n      </div>\n    </div>");
    document.body.appendChild(modal);
    document.getElementById('btn-vazio-ok').onclick = function () {
        modal.remove();
        _executarVazio(valNorm);
    };
    document.getElementById('btn-vazio-cancelar').onclick = function () { return modal.remove(); };
    modal.addEventListener('click', function (e) { if (e.target === modal)
        modal.remove(); });
}
function _executarVazio(valNorm) {
    var _a, _b, _c, _d, _e, _f, _g;
    // Em recontagem: verificar apenas pallets da sessão atual (RECONTAGEM),
    // não os da 1ª contagem — o operador está confirmando o estado atual.
    // Fora de recontagem: verificar todos os pallets não-VAZIO do endereço.
    var palletsJaContados = _palletsNoEnderecoAtual(valNorm);
    if (palletsJaContados > 0) {
        // Já há pallets contados → NÃO enviar vazio, apenas encerrar o endereço.
        // "Endereço vazio" aqui significa: "não há mais pallets neste endereço".
        toast('📦 ' + palletsJaContados + ' pallet(s) registrado(s) — endereço encerrado', 's');
        beepOk();
        renderHistorico();
        updateStats();
        if (APP.modoRecontagem) {
            resetContagem();
            _concluirRecontagem();
            return;
        }
        finalizarEnderecoAtual();
        return;
    }
    // ── Nenhum pallet contado → salvar registro VAZIO normalmente ──
    // Se o painel lote estava ativo, fechar antes de gravar/resetar
    if (APP.lote) {
        APP.lote = null;
        _loteSetPainel(false);
    }
    // Em modo recontagem: marcar como RECONTAGEM (não VAZIO) para o analista processar
    // o resultado via sincronizarRecontagensComContagens. O produto 'VAZIO' sinaliza
    // que o operador confirmou o endereço vazio nesta rodada.
    var _emRec = !!APP.modoRecontagem;
    var contagem = {
        id: Date.now(),
        uuid: gerarUUID(),
        inventario_id: ((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.id) || 'local',
        inventario_nome: ((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.nome) || '',
        inventario_codigo: ((_c = APP.inventario) === null || _c === void 0 ? void 0 : _c.codigo) || '',
        endereco: valNorm,
        capa: '',
        gtin: PROD_VAZIO, // '__VAZIO__'
        codigo_produto: PROD_VAZIO,
        produto_codigo: PROD_VAZIO,
        descricao: 'ENDEREÇO VAZIO',
        descricao_produto: 'ENDEREÇO VAZIO',
        validade: '',
        quantidade: 0,
        quantidade_esperada: '',
        divergente: false,
        operador: ((_d = APP.operador) === null || _d === void 0 ? void 0 : _d.name) || '',
        operador_email: ((_e = APP.operador) === null || _e === void 0 ? void 0 : _e.email) || '',
        coletor_id: localStorage.getItem('dt_device_id') || '',
        origem: 'COLETOR',
        // Em recontagem: tipo_contagem='RECONTAGEM' para o analista processar o resultado
        tipo_contagem: _emRec ? 'RECONTAGEM' : 'VAZIO',
        _destino: _emRec ? 'dt_contagens' : 'dt_vazios',
        recontagem_id: ((_f = APP.modoRecontagem) === null || _f === void 0 ? void 0 : _f.id) || null,
        divergencia_id: ((_g = APP.modoRecontagem) === null || _g === void 0 ? void 0 : _g.divergencia_id) || null,
        dataHora: new Date(),
        criado_em: new Date().toISOString(),
        numero: 1,
    };
    APP.contagens.unshift(contagem);
    enfileirarContagem(__assign(__assign({}, contagem), { dataHora: contagem.dataHora.toISOString() }));
    renderHistorico();
    updateStats();
    toast('📭 Endereço vazio encerrado: ' + valNorm, 's');
    beepOk();
    if (APP.modoRecontagem) {
        finalizarEnderecoAtual();
        _concluirRecontagem();
        return;
    }
    finalizarEnderecoAtual();
}
/** Trocar endereço (botão 🔄 que aparece após confirmar) */
function resetEndereco() {
    // Em recontagem: sempre permitir reset (nova sessão limpa)
    if (APP.modoRecontagem) {
        resetContagem();
        return;
    }
    // Bloquear se já há pallets contados neste endereço — operador deve encerrar com VAZIO
    var endNorm = APP.atual._endNorm || APP.atual._pendingEndereco;
    if (endNorm) {
        var palletsContados = _palletsNoEnderecoAtual(endNorm);
        if (palletsContados > 0) {
            toast('Para sair deste endereço use 📭 ENDEREÇO VAZIO', 'w');
            return;
        }
    }
    // Sem pallets contados — permitir trocar endereço normalmente
    // Garantir que o bloco travado esteja oculto e o step-endereco visível
    var blocoTravado = document.getElementById('bloco-endereco-travado');
    if (blocoTravado)
        blocoTravado.style.display = 'none';
    var stepEnd = document.getElementById('step-endereco');
    if (stepEnd)
        stepEnd.style.display = '';
    APP.atual.step = 1;
    APP.atual.endereco = '';
    APP.atual._endNorm = '';
    APP.atual._pendingEndereco = null;
    APP.atual._pendingPallets = null;
    APP.atual.enderecoValido = false;
    APP.atual.capa = '';
    APP.atual.gtin = '';
    APP.atual.produtoAtual = null;
    APP.atual.validade = '';
    APP.atual.quantidade = 0;
    _endVerif = null;
    ['f-endereco', 'f-capa', 'f-gtin', 'f-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.disabled = false;
            el.className = el.className.replace(/\bfield-(ok|err|warn)\b/g, '').trim();
        }
    });
    ['fb-endereco', 'fb-capa', 'fb-gtin', 'fb-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.innerHTML = '';
    });
    ['sf-val-endereco', 'sf-val-capa', 'sf-val-gtin', 'sf-val-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.style.display = 'none';
        }
    });
    var vaziow = document.getElementById('btn-vazio-wrap');
    if (vaziow)
        vaziow.style.display = 'none';
    updateSteps();
    setTimeout(function () { var el = document.getElementById('f-endereco'); if (el)
        el.focus(); }, 80);
}
