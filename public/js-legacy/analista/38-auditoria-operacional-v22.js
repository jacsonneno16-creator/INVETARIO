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
// AUDITORIA OPERACIONAL V22 — módulo isolado do Inventário
// Importação: Endereço + GTIN/EAN + Produto. Comparação pelos códigos cadastrados.
(function () {
    'use strict';
    var DB = function () { return window.FS_AN || (window.getDTFirestore && window.getDTFirestore()); };
    var STATUS = ['PENDENTE', 'OK', 'DIVERGENTE', 'ENDERECO_VAZIO'];
    var auditoriaAtual = '';
    var metaAtual = null;
    var itensAtuais = [];
    var unsubscribeItens = null;
    var unsubscribeMetas = null;
    var assinaturaAnterior = '';
    var importacaoPendente = null;
    var criacaoToken = 0;
    var criacaoAberta = false;
    var criacaoPromise = null;
    function comTimeout(promise, ms, fallback) {
        return Promise.race([
            Promise.resolve(promise).catch(function () { return fallback; }),
            new Promise(function (resolve) { setTimeout(function () { resolve(fallback); }, ms); })
        ]);
    }
    var configuracaoNova = null;
    function ruaDoEndereco(v) { var _a; return (((_a = window.DTEnderecos) === null || _a === void 0 ? void 0 : _a.partes(v).rua) || ''); }
    function enderecosGerais() {
        return __awaiter(this, void 0, void 0, function () {
            var chunks, out_1, e_1, snap, e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, DB().collection('dt_locais_chunks').orderBy('parte').get()];
                    case 1:
                        chunks = _a.sent();
                        out_1 = [];
                        chunks.docs.forEach(function (d) { var x = d.data(); out_1 = out_1.concat(x.itens || x.enderecos || x.lista || []); });
                        if (out_1.length)
                            return [2 /*return*/, out_1.map(function (x) { return typeof x === 'string' ? { endereco: x } : x; })];
                        return [3 /*break*/, 3];
                    case 2:
                        e_1 = _a.sent();
                        return [3 /*break*/, 3];
                    case 3:
                        _a.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, DB().collection('dt_locais').get()];
                    case 4:
                        snap = _a.sent();
                        return [2 /*return*/, snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); })];
                    case 5:
                        e_2 = _a.sent();
                        return [2 /*return*/, []];
                    case 6: return [2 /*return*/];
                }
            });
        });
    }
    function abrirCriacaoAuditoria() {
        return __awaiter(this, void 0, void 0, function () {
            var modalExistente, campo, meuToken, carregando, cancelar;
            var _a;
            return __generator(this, function (_b) {
                modalExistente = document.getElementById('modal-nova-aud-v39');
                if (modalExistente) {
                    modalExistente.classList.add('on');
                    campo = modalExistente.querySelector('#aud39-nome');
                    if (campo)
                        campo.focus();
                    return [2 /*return*/];
                }
                if (criacaoAberta && criacaoPromise)
                    return [2 /*return*/, criacaoPromise];
                criacaoAberta = true;
                meuToken = ++criacaoToken;
                (_a = document.getElementById('aud-v52-loading')) === null || _a === void 0 ? void 0 : _a.remove();
                carregando = document.createElement('div');
                carregando.id = 'aud-v52-loading';
                carregando.className = 'modal-bg on';
                carregando.innerHTML = '<div class="modal" style="max-width:420px;text-align:center;padding:28px"><div style="font-size:2rem">⏳</div><div class="modal-title" style="margin-top:10px">Preparando nova auditoria…</div><div class="sec-sub">Carregando produtos e endereços apenas uma vez.</div><div class="modal-actions" style="justify-content:center"><button type="button" class="btn btn-ghost" id="aud39-cancelar-loading">Cancelar</button></div></div>';
                document.body.appendChild(carregando);
                cancelar = function () { if (meuToken === criacaoToken)
                    ++criacaoToken; criacaoAberta = false; carregando.remove(); };
                carregando.querySelector('#aud39-cancelar-loading').onclick = cancelar;
                criacaoPromise = (function () {
                    return __awaiter(this, void 0, void 0, function () {
                        var familias_1, ends, ruas, cardsFamilia, html, modal_1, arquivoSelecionado_1, fechar_1, tipo_1, busca, inputArquivo_1;
                        var _this = this;
                        var _a, _b, _c, _d;
                        return __generator(this, function (_e) {
                            switch (_e.label) {
                                case 0:
                                    _e.trys.push([0, , 4, 5]);
                                    if (!(window.DTProdutos && typeof window.DTProdutos.carregar === 'function')) return [3 /*break*/, 2];
                                    return [4 /*yield*/, comTimeout(window.DTProdutos.carregar(false), 8000, [])];
                                case 1:
                                    _e.sent();
                                    _e.label = 2;
                                case 2:
                                    if (meuToken !== criacaoToken)
                                        return [2 /*return*/];
                                    familias_1 = (((_b = (_a = window.DTProdutos) === null || _a === void 0 ? void 0 : _a.familias) === null || _b === void 0 ? void 0 : _b.call(_a)) || []).filter(function (f) { return f && f.produtos && f.produtos.length; });
                                    return [4 /*yield*/, comTimeout(enderecosGerais(), 8000, [])];
                                case 3:
                                    ends = _e.sent();
                                    if (meuToken !== criacaoToken)
                                        return [2 /*return*/];
                                    ruas = __spreadArray([], new Set(ends.map(function (e) { return ruaDoEndereco(e.endereco || e.codigo || e.id); }).filter(Boolean)), true).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
                                    carregando.remove();
                                    cardsFamilia = familias_1.map(function (f) { return "<button type=\"button\" class=\"aud39-familia-card\" data-familia-id=\"".concat(esc(f.id), "\" data-familia-nome=\"").concat(esc(f.nome), "\" style=\"width:100%;text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--card);cursor:pointer;margin-bottom:6px\">").concat(esc(f.nome), "</button>"); }).join('');
                                    html = "<div id=\"modal-nova-aud-v39\" class=\"modal-bg on\"><div class=\"modal\" style=\"max-width:760px\"><div class=\"modal-hdr\"><div><div class=\"modal-title\">Criar nova auditoria</div><div class=\"sec-sub\">Informe o nome, escolha o tipo e carregue a base antes de criar.</div></div><button class=\"modal-close\" data-fechar-aud-v39>\u2715</button></div><div class=\"fg\"><div class=\"fi full\"><div class=\"fl\">Nome da auditoria *</div><input id=\"aud39-nome\" placeholder=\"Ex.: Auditoria Rua 14\"></div><div class=\"fi full\"><div class=\"fl\">Como deseja auditar?</div><select id=\"aud39-tipo\"><option value=\"rua\">Por rua</option><option value=\"produto\">Por produto</option></select></div><div class=\"fi full\" id=\"aud39-box-rua\"><div class=\"fl\">Ruas</div><select id=\"aud39-ruas\" multiple size=\"7\">".concat(ruas.map(function (r) { return "<option value=\"".concat(esc(r), "\">Rua ").concat(esc(r), "</option>"); }).join(''), "</select><div class=\"sec-sub\">Use Ctrl para selecionar mais de uma rua.</div></div><div class=\"fi full\" id=\"aud39-box-prod\" style=\"display:none\"><div class=\"fl\">Fam\u00EDlia de produtos</div><input id=\"aud39-busca-prod\" placeholder=\"Pesquisar fam\u00EDlia...\" autocomplete=\"off\"><input type=\"hidden\" id=\"aud39-prod\"><div id=\"aud39-familias-lista\" style=\"max-height:250px;overflow:auto;margin-top:8px\">").concat(cardsFamilia || '<div class="empty-sub">Nenhuma família com produto UND encontrada.</div>', "</div><div id=\"aud39-familia-selecionada\" class=\"sec-sub\" style=\"margin-top:8px\">Nenhuma fam\u00EDlia selecionada.</div></div><div class=\"fi full\"><div class=\"fl\">Base da auditoria *</div><div style=\"display:flex;gap:10px;align-items:center;flex-wrap:wrap\"><button type=\"button\" class=\"btn btn-ghost\" id=\"aud39-escolher-arquivo\">\u2B06 Selecionar arquivo</button><span id=\"aud39-arquivo-nome\" class=\"sec-sub\">Nenhum arquivo selecionado</span><input id=\"aud39-arquivo\" type=\"file\" accept=\".csv,.xlsx,.xls\" style=\"display:none\"></div><div id=\"aud39-arquivo-status\" style=\"margin-top:10px\"></div></div></div><div class=\"modal-actions\"><button class=\"btn btn-ghost\" data-fechar-aud-v39>Cancelar</button><button class=\"btn btn-primary\" id=\"aud39-criar\">Criar e importar auditoria</button></div></div></div>");
                                    document.body.insertAdjacentHTML('beforeend', html);
                                    modal_1 = document.getElementById('modal-nova-aud-v39');
                                    arquivoSelecionado_1 = null;
                                    // Bloqueia handlers delegados da página atrás do modal.
                                    ['click', 'mousedown', 'pointerdown', 'change', 'input'].forEach(function (evt) { return modal_1.addEventListener(evt, function (e) { return e.stopPropagation(); }); });
                                    fechar_1 = function () { ++criacaoToken; criacaoAberta = false; modal_1.remove(); };
                                    modal_1.querySelectorAll('[data-fechar-aud-v39]').forEach(function (b) { return b.onclick = fechar_1; });
                                    tipo_1 = modal_1.querySelector('#aud39-tipo');
                                    tipo_1.onchange = function () { modal_1.querySelector('#aud39-box-rua').style.display = tipo_1.value === 'rua' ? '' : 'none'; modal_1.querySelector('#aud39-box-prod').style.display = tipo_1.value === 'produto' ? '' : 'none'; };
                                    busca = modal_1.querySelector('#aud39-busca-prod');
                                    busca.oninput = function () { var q = txt(this.value).toLowerCase(); modal_1.querySelectorAll('.aud39-familia-card').forEach(function (o) { o.style.display = !q || txt(o.dataset.familiaNome).toLowerCase().includes(q) ? 'block' : 'none'; }); };
                                    modal_1.querySelectorAll('.aud39-familia-card').forEach(function (card) { return card.onclick = function () {
                                        modal_1.querySelectorAll('.aud39-familia-card').forEach(function (x) { x.style.outline = ''; x.setAttribute('aria-selected', 'false'); });
                                        card.style.outline = '2px solid var(--primary)';
                                        card.setAttribute('aria-selected', 'true');
                                        modal_1.querySelector('#aud39-prod').value = card.dataset.familiaId || '';
                                        modal_1.querySelector('#aud39-familia-selecionada').textContent = 'Selecionada: ' + (card.dataset.familiaNome || '');
                                    }; });
                                    inputArquivo_1 = modal_1.querySelector('#aud39-arquivo');
                                    modal_1.querySelector('#aud39-escolher-arquivo').onclick = function () { return inputArquivo_1.click(); };
                                    inputArquivo_1.onchange = function () {
                                        arquivoSelecionado_1 = inputArquivo_1.files && inputArquivo_1.files[0] || null;
                                        modal_1.querySelector('#aud39-arquivo-nome').textContent = arquivoSelecionado_1 ? arquivoSelecionado_1.name : 'Nenhum arquivo selecionado';
                                        modal_1.querySelector('#aud39-arquivo-status').innerHTML = arquivoSelecionado_1 ? '<div class="alert info"><div>📄</div><div>Arquivo selecionado. A validação será feita ao criar a auditoria.</div></div>' : '';
                                    };
                                    modal_1.querySelector('#aud39-criar').onclick = function () { return __awaiter(_this, void 0, void 0, function () {
                                        var nome, modo, selecao, v, familia, cfg, btn, preparada, id, sel, e_3, status_1;
                                        return __generator(this, function (_a) {
                                            switch (_a.label) {
                                                case 0:
                                                    nome = txt(modal_1.querySelector('#aud39-nome').value);
                                                    if (!nome)
                                                        return [2 /*return*/, toast('Informe o nome da auditoria.', 'w')];
                                                    if (!arquivoSelecionado_1)
                                                        return [2 /*return*/, toast('Selecione a base da auditoria.', 'w')];
                                                    modo = tipo_1.value;
                                                    selecao = [];
                                                    if (modo === 'rua')
                                                        selecao = __spreadArray([], modal_1.querySelector('#aud39-ruas').selectedOptions, true).map(function (o) { return o.value; });
                                                    else {
                                                        v = modal_1.querySelector('#aud39-prod').value;
                                                        if (v)
                                                            selecao = [v];
                                                    }
                                                    if (!selecao.length)
                                                        return [2 /*return*/, toast(modo === 'rua' ? 'Selecione ao menos uma rua.' : 'Selecione uma família de produtos.', 'w')];
                                                    familia = modo === 'produto' ? familias_1.find(function (f) { return f.id === selecao[0]; }) : null;
                                                    cfg = { tipoAuditoria: modo, ruas: modo === 'rua' ? selecao : [], familiaId: (familia === null || familia === void 0 ? void 0 : familia.id) || '', familiaNome: (familia === null || familia === void 0 ? void 0 : familia.nome) || '' };
                                                    btn = modal_1.querySelector('#aud39-criar');
                                                    btn.disabled = true;
                                                    btn.textContent = 'Criando...';
                                                    _a.label = 1;
                                                case 1:
                                                    _a.trys.push([1, 7, , 8]);
                                                    return [4 /*yield*/, prepararImportacao(arquivoSelecionado_1, cfg)];
                                                case 2:
                                                    preparada = _a.sent();
                                                    if (!preparada.validos.length)
                                                        throw new Error('Nenhuma linha válida foi encontrada para esta auditoria.');
                                                    id = "AUD-".concat(Date.now());
                                                    return [4 /*yield*/, DB().collection('dt_auditorias').doc(id).set(__assign(__assign({ nome: nome, loja: loja() }, cfg), { familiaCodigos: familia ? familia.produtos.map(function (p) { return p.codigoInterno; }) : [], status: 'RASCUNHO', totalItens: 0, totalPendentes: 0, totalOk: 0, totalDivergentes: 0, totalVazios: 0, criadoEm: agora(), criadoPor: usuario() }))];
                                                case 3:
                                                    _a.sent();
                                                    auditoriaAtual = id;
                                                    metaAtual = __assign(__assign({ id: id, nome: nome }, cfg), { status: 'RASCUNHO' });
                                                    importacaoPendente = __assign({ file: arquivoSelecionado_1 }, preparada);
                                                    return [4 /*yield*/, gravarImportacao()];
                                                case 4:
                                                    _a.sent();
                                                    fechar_1();
                                                    return [4 /*yield*/, popularSelect()];
                                                case 5:
                                                    _a.sent();
                                                    sel = document.getElementById('aud-op-auditoria');
                                                    if (sel)
                                                        sel.value = id;
                                                    return [4 /*yield*/, selecionarAuditoria(id)];
                                                case 6:
                                                    _a.sent();
                                                    toast("Auditoria criada com ".concat(preparada.validos.length, " item(ns). Agora ela pode ser liberada para os coletores."), 's');
                                                    return [3 /*break*/, 8];
                                                case 7:
                                                    e_3 = _a.sent();
                                                    console.error('[AUDITORIA] criação:', e_3);
                                                    status_1 = modal_1.querySelector('#aud39-arquivo-status');
                                                    if (status_1)
                                                        status_1.innerHTML = "<div class=\"alert error\"><div>\u26A0\uFE0F</div><div>".concat(esc(e_3.message || 'Falha ao criar auditoria.'), "</div></div>");
                                                    btn.disabled = false;
                                                    btn.textContent = 'Criar e importar auditoria';
                                                    return [3 /*break*/, 8];
                                                case 8: return [2 /*return*/];
                                            }
                                        });
                                    }); };
                                    (_c = modal_1.querySelector('#aud39-nome')) === null || _c === void 0 ? void 0 : _c.focus();
                                    return [3 /*break*/, 5];
                                case 4:
                                    (_d = document.getElementById('aud-v52-loading')) === null || _d === void 0 ? void 0 : _d.remove();
                                    if (meuToken === criacaoToken) {
                                        criacaoPromise = null;
                                        if (!document.getElementById('modal-nova-aud-v39'))
                                            criacaoAberta = false;
                                    }
                                    return [7 /*endfinally*/];
                                case 5: return [2 /*return*/];
                            }
                        });
                    });
                })();
                return [2 /*return*/, criacaoPromise];
            });
        });
    }
    var txt = function (v) { return String(v == null ? '' : v).trim(); };
    var esc = function (v) { return txt(v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); };
    var semAcento = function (v) { return txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
    var cab = function (v) { return semAcento(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    var dun = function (v) { return txt(v).replace(/[^0-9A-Za-z]/g, '').toUpperCase(); };
    var endNorm = function (v) { return txt(v).toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9.\-_/]/g, ''); };
    var agora = function () { return new Date().toISOString(); };
    var usuario = function () { var _a; return ((_a = window._currentAnalistaUser) === null || _a === void 0 ? void 0 : _a.email) || localStorage.getItem('dt_analista_email') || 'analista'; };
    var loja = function () { var _a, _b, _c, _d, _e; return ((_c = (_b = (_a = window.DTMultiStore) === null || _a === void 0 ? void 0 : _a.getLojaAtual) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.id) || ((_e = (_d = window.getLojaAtual) === null || _d === void 0 ? void 0 : _d.call(window)) === null || _e === void 0 ? void 0 : _e.id) || localStorage.getItem('dt_loja_atual') || ''; };
    var docId = function (auditoriaId, endereco, codigo, sequencia) {
        if (codigo === void 0) { codigo = ''; }
        if (sequencia === void 0) { sequencia = ''; }
        return "".concat(auditoriaId, "__").concat(endNorm(endereco).replace(/[^A-Z0-9]/g, '_'), "__").concat(dun(codigo) || 'VAZIO', "__").concat(txt(sequencia) || '0');
    };
    var fmt = function (v) {
        if (!v)
            return '—';
        var d = (v === null || v === void 0 ? void 0 : v.toDate) ? v.toDate() : new Date(v);
        return isNaN(d) ? txt(v) : d.toLocaleString('pt-BR');
    };
    var toast = function (m, t) {
        if (t === void 0) { t = 'i'; }
        return typeof window.showToast === 'function' ? window.showToast(m, t) : alert(m);
    };
    function normalizarItem(raw, id) {
        var _a, _b;
        var statusRaw = txt(raw.status || 'PENDENTE').toUpperCase();
        var compatStatus = statusRaw === 'VAZIO' ? 'ENDERECO_VAZIO' :
            ['CONFIRMADO_SEM_AJUSTE', 'APROVADO', 'CORRETO', 'CONFERIDO', 'FINALIZADO'].includes(statusRaw) ? 'OK' :
                ['CONFIRMADO_COM_AJUSTE', 'ERRO'].includes(statusRaw) ? 'DIVERGENTE' : statusRaw;
        return {
            id: id,
            auditoriaId: txt(raw.auditoriaId || raw.auditoria_id || auditoriaAtual),
            endereco: txt(raw.endereco || raw.local || raw.posicao),
            dunEsperado: txt(raw.dunEsperado || raw.dun_esperado || raw.dun || raw.codigoProduto || raw.codigo_produto || raw.gtin),
            produtoEsperado: txt(raw.produtoEsperado || raw.produto_esperado || raw.descricaoProdutoEsperado || raw.produto_nome || raw.descricao || raw.produto),
            dunLido: raw.dunLido == null ? txt(raw.dun_lido || raw.produtoEncontrado || raw.produto_encontrado || raw.codigoLido) || null : txt(raw.dunLido) || null,
            produtoLido: raw.produtoLido == null ? (txt(raw.produto_lido || raw.descricaoProdutoLido) || ((_b = (_a = window.DTProdutos) === null || _a === void 0 ? void 0 : _a.buscarSync(raw.dunLido || raw.dun_lido || raw.codigoLido)) === null || _b === void 0 ? void 0 : _b.nomeProduto) || null) : txt(raw.produtoLido) || null,
            status: STATUS.includes(compatStatus) ? compatStatus : 'PENDENTE',
            operadorId: txt(raw.operadorId || raw.operador_id || raw.usuario) || null,
            operadorNome: txt(raw.operadorNome || raw.operador_nome || raw.operador || raw.confirmado_por) || null,
            lidoEm: raw.lidoEm || raw.lido_em || raw.dataHora || raw.data_hora || null,
            loja: txt(raw.loja || loja()),
            disponivel_coletor: raw.disponivel_coletor !== false
        };
    }
    function resumo(lista) {
        if (lista === void 0) { lista = itensAtuais; }
        var r = { total: lista.length, PENDENTE: 0, OK: 0, DIVERGENTE: 0, ENDERECO_VAZIO: 0 };
        lista.forEach(function (i) { return r[i.status]++; });
        r.auditados = r.OK + r.DIVERGENTE + r.ENDERECO_VAZIO;
        r.percentual = r.total ? Math.round((r.auditados / r.total) * 100) : 0;
        return r;
    }
    function assinatura(lista) {
        return JSON.stringify(lista.map(function (i) { var _a; return [i.id, i.status, i.dunLido, i.produtoLido, i.operadorNome, ((_a = i.lidoEm) === null || _a === void 0 ? void 0 : _a.seconds) || i.lidoEm || '']; }));
    }
    function ambienteAuditoriaPronto() {
        var _a;
        var user = ((_a = window.AUTH_AN) === null || _a === void 0 ? void 0 : _a.currentUser) || window._currentAnalistaUser;
        var db = DB();
        var app = document.getElementById('app-main');
        return !!(user && db && (!app || app.style.display !== 'none'));
    }
    function listarMetas() {
        return __awaiter(this, void 0, void 0, function () {
            var db, snap;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!ambienteAuditoriaPronto())
                            return [2 /*return*/, []];
                        db = DB();
                        if (!db || typeof db.collection !== 'function')
                            return [2 /*return*/, []];
                        return [4 /*yield*/, db.collection('dt_auditorias').get()];
                    case 1:
                        snap = _a.sent();
                        return [2 /*return*/, snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); }).sort(function (a, b) { return txt(b.criadoEm || b.importado_em).localeCompare(txt(a.criadoEm || a.importado_em)); })];
                }
            });
        });
    }
    function resolverAuditoriaSelecionada() {
        if (auditoriaAtual)
            return auditoriaAtual;
        var sel = document.getElementById('aud-op-auditoria');
        var valor = txt(sel === null || sel === void 0 ? void 0 : sel.value);
        if (valor) {
            auditoriaAtual = valor;
            return valor;
        }
        var opcoes = sel ? __spreadArray([], sel.options, true).filter(function (o) { return o.value; }) : [];
        if (opcoes.length === 1) {
            sel.value = opcoes[0].value;
            auditoriaAtual = opcoes[0].value;
            return auditoriaAtual;
        }
        return '';
    }
    function atualizarAcoesAuditoria() {
        var tem = !!resolverAuditoriaSelecionada();
        var btn = document.getElementById('btn-aud-atualizar-base');
        var excluir = document.getElementById('btn-aud-excluir');
        if (btn)
            btn.style.display = tem ? '' : 'none';
        if (excluir)
            excluir.style.display = tem ? '' : 'none';
    }
    function importarBaseSelecionada() {
        return __awaiter(this, void 0, void 0, function () {
            var input;
            return __generator(this, function (_a) {
                if (!auditoriaAtual)
                    return [2 /*return*/, toast('Crie ou selecione uma auditoria antes de atualizar a base.', 'w')];
                input = document.getElementById('auditoria-file');
                if (input)
                    input.click();
                return [2 /*return*/];
            });
        });
    }
    function popularSelect() {
        return __awaiter(this, void 0, void 0, function () {
            var sel, atual, metas, visiveis, e_4, semLogin;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        sel = document.getElementById('aud-op-auditoria');
                        if (!sel)
                            return [2 /*return*/, []];
                        atual = auditoriaAtual || sel.value;
                        if (!ambienteAuditoriaPronto()) {
                            sel.disabled = false;
                            sel.innerHTML = '<option value="">Selecione uma auditoria...</option>';
                            return [2 /*return*/, []];
                        }
                        sel.disabled = true;
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, listarMetas()];
                    case 2:
                        metas = _b.sent();
                        visiveis = metas;
                        sel.innerHTML = '<option value="">Selecione uma auditoria...</option>' + visiveis.map(function (m) {
                            var st = txt(m.status || 'RASCUNHO').toUpperCase();
                            return "<option value=\"".concat(esc(m.id), "\">").concat(esc(m.nome || m.auditoria_nome || m.id), " \u2014 ").concat(esc(st), "</option>");
                        }).join('');
                        if (atual && __spreadArray([], sel.options, true).some(function (o) { return o.value === atual; }))
                            sel.value = atual;
                        else if (visiveis.length === 1) {
                            sel.value = visiveis[0].id;
                            auditoriaAtual = visiveis[0].id;
                        }
                        atualizarAcoesAuditoria();
                        return [2 /*return*/, visiveis];
                    case 3:
                        e_4 = _b.sent();
                        console.error('[AUDITORIA] listar auditorias:', e_4);
                        semLogin = !((_a = window.AUTH_AN) === null || _a === void 0 ? void 0 : _a.currentUser) && !window._currentAnalistaUser;
                        if (semLogin) {
                            sel.innerHTML = '<option value="">Selecione uma auditoria...</option>';
                        }
                        else {
                            sel.innerHTML = '<option value="">Falha ao carregar auditorias — clique em Atualizar</option>';
                            toast('Não foi possível carregar a lista de auditorias: ' + (e_4.message || e_4), 'e');
                        }
                        return [2 /*return*/, []];
                    case 4:
                        sel.disabled = false;
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    }
    function encerrarListener() {
        if (unsubscribeMetas) {
            try {
                unsubscribeMetas();
            }
            catch (e) { }
        }
        unsubscribeMetas = null;
        if (unsubscribeItens) {
            try {
                unsubscribeItens();
            }
            catch (e) { }
        }
        unsubscribeItens = null;
        assinaturaAnterior = '';
    }
    function selecionarAuditoria(id) {
        return __awaiter(this, void 0, void 0, function () {
            var ref, metaSnap;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        encerrarListener();
                        auditoriaAtual = txt(id);
                        itensAtuais = [];
                        metaAtual = null;
                        atualizarAcoesAuditoria();
                        renderizar();
                        if (!auditoriaAtual)
                            return [2 /*return*/];
                        ref = DB().collection('dt_auditorias').doc(auditoriaAtual);
                        return [4 /*yield*/, ref.get()];
                    case 1:
                        metaSnap = _a.sent();
                        metaAtual = metaSnap.exists ? __assign({ id: metaSnap.id }, metaSnap.data()) : null;
                        if (!!metaAtual) return [3 /*break*/, 3];
                        toast('A auditoria selecionada não existe mais. Atualizando a lista.', 'w');
                        auditoriaAtual = '';
                        return [4 /*yield*/, popularSelect()];
                    case 2:
                        _a.sent();
                        renderizar();
                        return [2 /*return*/];
                    case 3:
                        unsubscribeMetas = ref.onSnapshot(function (ms) {
                            if (!ms.exists) {
                                auditoriaAtual = '';
                                metaAtual = null;
                                itensAtuais = [];
                                popularSelect();
                                renderizar();
                                return;
                            }
                            metaAtual = __assign({ id: ms.id }, ms.data());
                            atualizarAcoesAuditoria();
                        });
                        atualizarAcoesAuditoria();
                        unsubscribeItens = ref.collection('enderecos').onSnapshot(function (snap) {
                            var nova = snap.docs.map(function (d) { return normalizarItem(d.data(), d.id); });
                            var sig = assinatura(nova);
                            if (sig === assinaturaAnterior)
                                return;
                            assinaturaAnterior = sig;
                            itensAtuais = nova;
                            renderizar();
                            sincronizarResumoMeta().catch(function (e) { return console.warn('[AUDITORIA] resumo:', e); });
                        }, function (error) {
                            console.error('[AUDITORIA] listener:', error);
                            toast('Não foi possível acompanhar os resultados da auditoria.', 'e');
                        });
                        return [2 /*return*/];
                }
            });
        });
    }
    function sincronizarResumoMeta() {
        return __awaiter(this, void 0, void 0, function () {
            var r, statusAtual, status;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!auditoriaAtual)
                            return [2 /*return*/];
                        r = resumo();
                        statusAtual = txt((metaAtual === null || metaAtual === void 0 ? void 0 : metaAtual.status) || 'RASCUNHO').toUpperCase();
                        status = statusAtual === 'FINALIZADA' ? 'FINALIZADA' : (r.auditados ? 'EM_ANDAMENTO' : statusAtual);
                        return [4 /*yield*/, DB().collection('dt_auditorias').doc(auditoriaAtual).set({
                                totalItens: r.total, totalPendentes: r.PENDENTE, totalOk: r.OK, totalDivergentes: r.DIVERGENTE, totalVazios: r.ENDERECO_VAZIO,
                                status: status,
                                atualizadoEm: agora()
                            }, { merge: true })];
                    case 1:
                        _a.sent();
                        metaAtual = __assign(__assign({}, metaAtual), { totalItens: r.total, totalPendentes: r.PENDENTE, totalOk: r.OK, totalDivergentes: r.DIVERGENTE, totalVazios: r.ENDERECO_VAZIO, status: status });
                        return [2 /*return*/];
                }
            });
        });
    }
    function filtros() {
        var _a, _b, _c, _d, _e, _f;
        return {
            status: txt((_a = document.getElementById('aud-op-status')) === null || _a === void 0 ? void 0 : _a.value).toUpperCase(),
            busca: txt((_b = document.getElementById('aud-op-busca')) === null || _b === void 0 ? void 0 : _b.value).toLowerCase(),
            dunEsperado: txt((_c = document.getElementById('aud-f-dun-esperado')) === null || _c === void 0 ? void 0 : _c.value).toLowerCase(),
            dunLido: txt((_d = document.getElementById('aud-f-dun-lido')) === null || _d === void 0 ? void 0 : _d.value).toLowerCase(),
            operador: txt((_e = document.getElementById('aud-f-operador')) === null || _e === void 0 ? void 0 : _e.value).toLowerCase(),
            data: txt((_f = document.getElementById('aud-f-data')) === null || _f === void 0 ? void 0 : _f.value)
        };
    }
    function aplicarFiltros(lista) {
        var f = filtros();
        return lista.filter(function (i) {
            var _a;
            if (f.status && i.status !== f.status)
                return false;
            if (f.dunEsperado && !i.dunEsperado.toLowerCase().includes(f.dunEsperado))
                return false;
            if (f.dunLido && !txt(i.dunLido).toLowerCase().includes(f.dunLido))
                return false;
            if (f.operador && !txt(i.operadorNome).toLowerCase().includes(f.operador))
                return false;
            if (f.data && i.lidoEm) {
                var d = ((_a = i.lidoEm) === null || _a === void 0 ? void 0 : _a.toDate) ? i.lidoEm.toDate() : new Date(i.lidoEm);
                if (!isNaN(d) && d.toISOString().slice(0, 10) !== f.data)
                    return false;
            }
            else if (f.data && !i.lidoEm)
                return false;
            if (f.busca) {
                var hay = [i.endereco, i.dunEsperado, i.produtoEsperado, i.dunLido, i.produtoLido, i.operadorNome, i.status].join(' ').toLowerCase();
                if (!hay.includes(f.busca))
                    return false;
            }
            return true;
        });
    }
    function rotuloStatus(s) { return ({ PENDENTE: 'Pendente', OK: 'OK', DIVERGENTE: 'Divergente', ENDERECO_VAZIO: 'Endereço vazio' })[s] || s; }
    function classeStatus(s) { return s === 'OK' ? 'ok' : s === 'DIVERGENTE' ? 'err' : s === 'ENDERECO_VAZIO' ? 'warn' : 'pending'; }
    function renderizar() {
        var r = resumo();
        var set = function (id, v) { var e = document.getElementById(id); if (e)
            e.textContent = v; };
        set('audop-k-total', r.total);
        set('audop-k-auditados', r.auditados);
        set('audop-k-pend', r.PENDENTE);
        set('audop-k-ok', r.OK);
        set('audop-k-div', r.DIVERGENTE);
        set('audop-k-vaz', r.ENDERECO_VAZIO);
        set('audop-k-perc', "".concat(r.percentual, "%"));
        var tbody = document.getElementById('auditoria-op-tbody');
        if (!tbody)
            return;
        var lista = aplicarFiltros(itensAtuais);
        tbody.innerHTML = lista.length ? lista.map(function (i) { return "<tr>\n      <td class=\"mono\">".concat(esc(i.endereco), "</td>\n      <td class=\"mono\">").concat(esc(i.dunEsperado), "</td>\n      <td>").concat(esc(i.produtoEsperado), "</td>\n      <td class=\"mono\">").concat(esc(i.dunLido || '—'), "</td>\n      <td>").concat(esc(i.produtoLido || '—'), "</td>\n      <td><span class=\"badge ").concat(classeStatus(i.status), "\">").concat(esc(rotuloStatus(i.status)), "</span></td>\n      <td>").concat(esc(i.operadorNome || '—'), "</td>\n      <td>").concat(esc(fmt(i.lidoEm)), "</td>\n    </tr>"); }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">Nenhum item encontrado.</td></tr>';
        var resumoFinal = document.getElementById('auditoria-resumo-finalizacao');
        if (resumoFinal)
            resumoFinal.textContent = "Total ".concat(r.total, " \u00B7 OK ").concat(r.OK, " \u00B7 Divergentes ").concat(r.DIVERGENTE, " \u00B7 Vazios ").concat(r.ENDERECO_VAZIO, " \u00B7 Pendentes ").concat(r.PENDENTE);
    }
    function detectarColunas(headers) {
        var lista = (headers || []).map(function (original) {
            return { original: original, normal: cab(original) };
        });
        function achar(exatos, contem) {
            var ex = (exatos || []).map(cab);
            for (var _i = 0, lista_1 = lista; _i < lista_1.length; _i++) {
                var h = lista_1[_i];
                if (ex.indexOf(h.normal) >= 0)
                    return h.original;
            }
            for (var _a = 0, lista_2 = lista; _a < lista_2.length; _a++) {
                var h = lista_2[_a];
                for (var _b = 0, _c = (contem || []).map(cab); _b < _c.length; _b++) {
                    var termo = _c[_b];
                    if (termo && h.normal.indexOf(termo) >= 0)
                        return h.original;
                }
            }
            return null;
        }
        return {
            endereco: achar(['ENDEREÇO', 'ENDERECO', 'LOCAL', 'POSIÇÃO', 'POSICAO', 'LOCALIZAÇÃO', 'LOCALIZACAO', 'ADDRESS'], ['ENDERECO', 'POSICAO', 'LOCALIZACAO']),
            dun: achar(['GTIN', 'EAN', 'GTIN/EAN', 'EAN/GTIN', 'GTIN EAN', 'EAN GTIN', 'GTIN PRINCIPAL', 'EAN PRINCIPAL', 'DUN', 'DUN14', 'EAN14', 'GTIN14', 'CÓDIGO DE BARRAS', 'CODIGO DE BARRAS', 'COD BARRAS', 'BARCODE', 'CÓDIGO DO PRODUTO', 'CODIGO DO PRODUTO'], ['GTINEAN', 'EANGTIN', 'GTIN', 'EAN', 'DUN', 'CODIGODEBARRAS', 'CODBARRAS', 'BARCODE']),
            produto: achar(['PRODUTO', 'DESCRIÇÃO', 'DESCRICAO', 'NOME DO PRODUTO', 'DESCRIÇÃO DO PRODUTO', 'DESCRICAO DO PRODUTO', 'ITEM'], ['PRODUTO', 'DESCRICAO', 'NOMEITEM'])
        };
    }
    function lerArquivo(file) {
        return __awaiter(this, void 0, void 0, function () {
            var buffer, wb, ws;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, file.arrayBuffer()];
                    case 1:
                        buffer = _a.sent();
                        wb = XLSX.read(new Uint8Array(buffer), { type: 'array', raw: false });
                        ws = wb.Sheets[wb.SheetNames[0]];
                        return [2 /*return*/, XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })];
                }
            });
        });
    }
    function prepararImportacao(file, cfg) {
        return __awaiter(this, void 0, void 0, function () {
            var rows, col, ausentes, erros, validos, selecionados, fam, codigos_1, ruasSet_1, existentes_1, gerais;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, lerArquivo(file)];
                    case 1:
                        rows = _c.sent();
                        if (!rows.length)
                            throw new Error('O arquivo não possui linhas de dados.');
                        col = detectarColunas(Object.keys(rows[0]));
                        ausentes = [!col.endereco && 'Endereço', !col.dun && 'GTIN/EAN/DUN', !col.produto && 'Produto'].filter(Boolean);
                        if (ausentes.length)
                            throw new Error("Colunas obrigat\u00F3rias ausentes: ".concat(ausentes.join(', '), ". Cabe\u00E7alhos encontrados: ").concat(Object.keys(rows[0]).join(' | ')));
                        erros = [];
                        validos = [];
                        rows.forEach(function (r, idx) {
                            var linha = idx + 2, endereco = txt(r[col.endereco]), dunEsperado = txt(r[col.dun]), produtoEsperado = txt(r[col.produto]);
                            var motivos = [];
                            if (!endereco)
                                motivos.push('endereço vazio');
                            if (!dunEsperado)
                                motivos.push('GTIN/EAN vazio');
                            if (!produtoEsperado)
                                motivos.push('nome do produto vazio');
                            if (motivos.length)
                                erros.push({ linha: linha, endereco: endereco || '—', dunEsperado: dunEsperado, produtoEsperado: produtoEsperado, motivo: motivos.join('; ') });
                            else
                                validos.push({ endereco: endereco, dunEsperado: dunEsperado, produtoEsperado: produtoEsperado, _linha: linha, _seq: idx });
                        });
                        selecionados = validos;
                        cfg = cfg || metaAtual || configuracaoNova || {};
                        if (cfg.tipoAuditoria === 'produto' && cfg.familiaId) {
                            fam = (((_b = (_a = window.DTProdutos) === null || _a === void 0 ? void 0 : _a.familias) === null || _b === void 0 ? void 0 : _b.call(_a)) || []).find(function (f) { return f.id === cfg.familiaId; });
                            codigos_1 = new Set(((fam === null || fam === void 0 ? void 0 : fam.produtos) || []).flatMap(function (p) { return [dun(p.codigoInterno), dun(p.dun), dun(p.gtin)]; }).filter(Boolean));
                            selecionados = validos.filter(function (r) { return codigos_1.has(dun(r.dunEsperado)) || txt(r.produtoEsperado).toLowerCase().includes(txt(cfg.familiaNome).toLowerCase()); });
                        }
                        if (!(cfg.tipoAuditoria === 'rua' && (cfg.ruas || []).length)) return [3 /*break*/, 3];
                        ruasSet_1 = new Set(cfg.ruas.map(txt));
                        selecionados = validos.filter(function (r) { return ruasSet_1.has(ruaDoEndereco(r.endereco)); });
                        existentes_1 = new Set(selecionados.map(function (r) { return endNorm(r.endereco); }));
                        return [4 /*yield*/, enderecosGerais()];
                    case 2:
                        gerais = _c.sent();
                        gerais.forEach(function (e) { var endereco = txt(e.endereco || e.codigo || e.id); if (endereco && ruasSet_1.has(ruaDoEndereco(endereco)) && !existentes_1.has(endNorm(endereco)))
                            selecionados.push({ endereco: endereco, dunEsperado: '', produtoEsperado: 'ENDEREÇO PREVISTO VAZIO', previstoVazio: true }); });
                        _c.label = 3;
                    case 3:
                        if (!selecionados.length)
                            erros.push({ linha: '—', endereco: '—', dunEsperado: '', produtoEsperado: '', motivo: 'Nenhum item da base corresponde ao tipo selecionado para esta auditoria' });
                        return [2 /*return*/, { validos: selecionados, erros: erros }];
                }
            });
        });
    }
    function processarArquivo(file) {
        return __awaiter(this, void 0, void 0, function () {
            var preparada, e_5;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!file)
                            return [2 /*return*/];
                        if (!auditoriaAtual)
                            return [2 /*return*/, toast('Crie ou selecione uma auditoria antes de atualizar a base.', 'w')];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, prepararImportacao(file, metaAtual || {})];
                    case 2:
                        preparada = _a.sent();
                        if (!preparada.validos.length)
                            throw new Error('Nenhuma linha válida foi encontrada.');
                        importacaoPendente = __assign({ file: file }, preparada);
                        return [4 /*yield*/, gravarImportacao()];
                    case 3:
                        _a.sent();
                        toast("Base atualizada com ".concat(preparada.validos.length, " item(ns)."), 's');
                        return [3 /*break*/, 5];
                    case 4:
                        e_5 = _a.sent();
                        console.error(e_5);
                        toast(e_5.message || 'Erro ao ler arquivo.', 'e');
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    }
    function gravarImportacao() {
        return __awaiter(this, void 0, void 0, function () {
            var ref, itensRef, old, _loop_1, i, lista, _loop_2, i, status, preview, actions;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!importacaoPendente || !importacaoPendente.validos.length)
                            return [2 /*return*/];
                        if (!auditoriaAtual)
                            throw new Error('Nenhuma auditoria selecionada.');
                        ref = DB().collection('dt_auditorias').doc(auditoriaAtual);
                        itensRef = ref.collection('enderecos');
                        return [4 /*yield*/, itensRef.get()];
                    case 1:
                        old = _a.sent();
                        _loop_1 = function (i) {
                            var b;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        b = DB().batch();
                                        old.docs.slice(i, i + 350).forEach(function (d) { return b.delete(d.ref); });
                                        return [4 /*yield*/, b.commit()];
                                    case 1:
                                        _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < old.docs.length)) return [3 /*break*/, 5];
                        return [5 /*yield**/, _loop_1(i)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        i += 350;
                        return [3 /*break*/, 2];
                    case 5:
                        lista = importacaoPendente.validos;
                        _loop_2 = function (i) {
                            var b;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        b = DB().batch();
                                        lista.slice(i, i + 350).forEach(function (row) {
                                            var id = docId(auditoriaAtual, row.endereco, row.dunEsperado, String(row._seq == null ? '' : row._seq));
                                            b.set(itensRef.doc(id), {
                                                auditoriaId: auditoriaAtual, endereco: row.endereco, dunEsperado: row.dunEsperado, produtoEsperado: row.produtoEsperado,
                                                previstoVazio: row.previstoVazio === true, dunLido: null, produtoLido: null, status: 'PENDENTE', operadorId: null, operadorNome: null, lidoEm: null, loja: loja(), disponivel_coletor: false
                                            });
                                        });
                                        return [4 /*yield*/, b.commit()];
                                    case 1:
                                        _c.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 6;
                    case 6:
                        if (!(i < lista.length)) return [3 /*break*/, 9];
                        return [5 /*yield**/, _loop_2(i)];
                    case 7:
                        _a.sent();
                        _a.label = 8;
                    case 8:
                        i += 350;
                        return [3 /*break*/, 6];
                    case 9: return [4 /*yield*/, ref.set({ status: 'RASCUNHO', totalItens: lista.length, totalPendentes: lista.length, totalOk: 0, totalDivergentes: 0, totalVazios: 0, arquivo: importacaoPendente.file.name, importadoEm: agora(), importadoPor: usuario() }, { merge: true })];
                    case 10:
                        _a.sent();
                        importacaoPendente = null;
                        status = document.getElementById('auditoria-import-status');
                        if (status)
                            status.innerHTML = '';
                        preview = document.getElementById('auditoria-import-preview');
                        if (preview) {
                            preview.innerHTML = '';
                            preview.style.display = 'none';
                        }
                        actions = document.getElementById('auditoria-import-actions');
                        if (actions)
                            actions.style.display = 'none';
                        return [2 /*return*/];
                }
            });
        });
    }
    function criarNova() {
        return __awaiter(this, void 0, void 0, function () { var e_6, l; return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, abrirCriacaoAuditoria()];
                case 1: return [2 /*return*/, _a.sent()];
                case 2:
                    e_6 = _a.sent();
                    l = document.getElementById('aud-v52-loading');
                    if (l)
                        l.remove();
                    console.error('[AUDITORIA] abrir criação:', e_6);
                    toast('Não foi possível abrir a criação da auditoria: ' + (e_6.message || e_6), 'e');
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        }); });
    }
    function confirmarImportacao() {
        return __awaiter(this, void 0, void 0, function () {
            var e_7;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, gravarImportacao()];
                    case 1:
                        _a.sent();
                        toast('Base importada com sucesso.', 's');
                        return [3 /*break*/, 3];
                    case 2:
                        e_7 = _a.sent();
                        console.error(e_7);
                        toast(e_7.message || 'Falha ao importar a base.', 'e');
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    }
    function liberar() {
        return __awaiter(this, void 0, void 0, function () {
            var id, ref, snap, _loop_3, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        id = resolverAuditoriaSelecionada();
                        if (!id)
                            return [2 /*return*/, toast('Selecione uma auditoria na lista acima.', 'w')];
                        if (!(id !== auditoriaAtual || !metaAtual)) return [3 /*break*/, 2];
                        return [4 /*yield*/, selecionarAuditoria(id)];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2:
                        if (!itensAtuais.length)
                            return [2 /*return*/, toast('Importe uma base válida antes de liberar.', 'w')];
                        ref = DB().collection('dt_auditorias').doc(auditoriaAtual);
                        return [4 /*yield*/, ref.collection('enderecos').get()];
                    case 3:
                        snap = _a.sent();
                        _loop_3 = function (i) {
                            var b;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        b = DB().batch();
                                        snap.docs.slice(i, i + 350).forEach(function (d) { return b.set(d.ref, { disponivel_coletor: true }, { merge: true }); });
                                        return [4 /*yield*/, b.commit()];
                                    case 1:
                                        _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 4;
                    case 4:
                        if (!(i < snap.docs.length)) return [3 /*break*/, 7];
                        return [5 /*yield**/, _loop_3(i)];
                    case 5:
                        _a.sent();
                        _a.label = 6;
                    case 6:
                        i += 350;
                        return [3 /*break*/, 4];
                    case 7: return [4 /*yield*/, ref.set({ status: 'LIBERADA', liberada_coletor: true, liberadaEm: agora(), liberadaPor: usuario() }, { merge: true })];
                    case 8:
                        _a.sent();
                        metaAtual = __assign(__assign({}, metaAtual), { status: 'LIBERADA' });
                        toast('Auditoria liberada para os coletores.', 's');
                        return [2 /*return*/];
                }
            });
        });
    }
    function finalizar() {
        return __awaiter(this, void 0, void 0, function () {
            var id, r;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        id = resolverAuditoriaSelecionada();
                        if (!id)
                            return [2 /*return*/, toast('Selecione uma auditoria na lista acima.', 'w')];
                        if (!(id !== auditoriaAtual || !metaAtual)) return [3 /*break*/, 2];
                        return [4 /*yield*/, selecionarAuditoria(id)];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2:
                        r = resumo();
                        if (r.PENDENTE > 0)
                            return [2 /*return*/, toast("N\u00E3o \u00E9 poss\u00EDvel finalizar. Ainda faltam ".concat(r.PENDENTE, " item(ns)."), 'w')];
                        if (!r.total)
                            return [2 /*return*/, toast('A auditoria não possui itens.', 'w')];
                        if (!confirm("Finalizar auditoria?\nTotal: ".concat(r.total, "\nOK: ").concat(r.OK, "\nDivergentes: ").concat(r.DIVERGENTE, "\nVazios: ").concat(r.ENDERECO_VAZIO)))
                            return [2 /*return*/];
                        return [4 /*yield*/, DB().collection('dt_auditorias').doc(auditoriaAtual).set({ status: 'FINALIZADA', finalizadaEm: agora(), finalizadaPor: usuario(), liberada_coletor: false }, { merge: true })];
                    case 3:
                        _a.sent();
                        metaAtual = __assign(__assign({}, metaAtual), { status: 'FINALIZADA' });
                        toast('Auditoria finalizada.', 's');
                        return [2 /*return*/];
                }
            });
        });
    }
    function excluir() {
        return __awaiter(this, void 0, void 0, function () {
            var id, ref, snap, _loop_4, i, sel, e_8;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        id = resolverAuditoriaSelecionada();
                        if (!id)
                            return [2 /*return*/, toast('Selecione uma auditoria na lista acima.', 'w')];
                        if (!confirm('Excluir esta auditoria e todos os seus resultados? Esta ação não pode ser desfeita.'))
                            return [2 /*return*/];
                        ref = DB().collection('dt_auditorias').doc(id);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 9, , 10]);
                        encerrarListener();
                        return [4 /*yield*/, ref.collection('enderecos').get()];
                    case 2:
                        snap = _a.sent();
                        _loop_4 = function (i) {
                            var b;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        b = DB().batch();
                                        snap.docs.slice(i, i + 350).forEach(function (d) { return b.delete(d.ref); });
                                        return [4 /*yield*/, b.commit()];
                                    case 1:
                                        _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 3;
                    case 3:
                        if (!(i < snap.docs.length)) return [3 /*break*/, 6];
                        return [5 /*yield**/, _loop_4(i)];
                    case 4:
                        _a.sent();
                        _a.label = 5;
                    case 5:
                        i += 350;
                        return [3 /*break*/, 3];
                    case 6: return [4 /*yield*/, ref.delete()];
                    case 7:
                        _a.sent();
                        auditoriaAtual = '';
                        metaAtual = null;
                        itensAtuais = [];
                        sel = document.getElementById('aud-op-auditoria');
                        if (sel)
                            sel.value = '';
                        return [4 /*yield*/, popularSelect()];
                    case 8:
                        _a.sent();
                        renderizar();
                        atualizarAcoesAuditoria();
                        toast('Auditoria excluída. Ela não aparecerá mais nos coletores.', 's');
                        return [3 /*break*/, 10];
                    case 9:
                        e_8 = _a.sent();
                        console.error('[AUDITORIA] excluir:', e_8);
                        toast('Falha ao excluir a auditoria: ' + (e_8.message || e_8), 'e');
                        return [3 /*break*/, 10];
                    case 10: return [2 /*return*/];
                }
            });
        });
    }
    function atualizarListaAuditorias() {
        return __awaiter(this, void 0, void 0, function () {
            var metas, sel;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, popularSelect()];
                    case 1:
                        metas = _a.sent();
                        sel = document.getElementById('aud-op-auditoria');
                        if (!(sel === null || sel === void 0 ? void 0 : sel.value)) return [3 /*break*/, 3];
                        return [4 /*yield*/, selecionarAuditoria(sel.value)];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        if (!metas.length)
                            renderizar();
                        _a.label = 4;
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function exportar() {
        var id = resolverAuditoriaSelecionada();
        if (!id || !itensAtuais.length)
            return toast('Selecione uma auditoria com dados.', 'w');
        var rows = aplicarFiltros(itensAtuais).map(function (i) { return ({
            Auditoria: (metaAtual === null || metaAtual === void 0 ? void 0 : metaAtual.nome) || (metaAtual === null || metaAtual === void 0 ? void 0 : metaAtual.auditoria_nome) || auditoriaAtual, Loja: i.loja || (metaAtual === null || metaAtual === void 0 ? void 0 : metaAtual.loja) || loja(), Endereço: i.endereco,
            'GTIN/EAN esperado': i.dunEsperado, 'Produto esperado': i.produtoEsperado, 'GTIN/EAN lido': i.dunLido || '', 'Produto lido': i.produtoLido || '',
            Resultado: rotuloStatus(i.status), Operador: i.operadorNome || '', 'Data e hora': fmt(i.lidoEm)
        }); });
        var ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
        XLSX.writeFile(wb, "auditoria-".concat(auditoriaAtual, ".xlsx"));
    }
    // Sobrescreve apenas as funções públicas da aba Auditoria.
    window.detectarColunasAuditoria = detectarColunas;
    window.processFileAuditoria = processarArquivo;
    window.importarBaseAuditoriaSelecionada = importarBaseSelecionada;
    window.confirmarImportAuditoria = confirmarImportacao;
    window.criarNovaAuditoriaStandalone = criarNova;
    window.liberarAuditoriaColetores = liberar;
    window.finalizarAuditoriaOperacional = finalizar;
    window.excluirAuditoriaOperacional = excluir;
    window.atualizarListaAuditorias = atualizarListaAuditorias;
    window.exportarAuditoriaOperacional = exportar;
    window.renderAuditoriaOperacional = function () {
        renderizar();
        if (!window.__auditoriaRefreshTimer) {
            window.__auditoriaRefreshTimer = setTimeout(function () {
                return __awaiter(this, void 0, void 0, function () {
                    var page;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                window.__auditoriaRefreshTimer = null;
                                page = document.getElementById('page-auditoria');
                                if (!(page && page.classList.contains('active'))) return [3 /*break*/, 2];
                                return [4 /*yield*/, popularSelect()];
                            case 1:
                                _a.sent();
                                _a.label = 2;
                            case 2: return [2 /*return*/];
                        }
                    });
                });
            }, 120);
        }
    };
    window.encerrarListenerAuditoriaPorTrocaLoja = function () {
        encerrarListener();
        auditoriaAtual = '';
        metaAtual = null;
        itensAtuais = [];
        atualizarAcoesAuditoria();
    };
    window.recarregarAuditoriaAposTrocaLoja = function () {
        return __awaiter(this, void 0, void 0, function () {
            var sel, first;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        encerrarListener();
                        auditoriaAtual = '';
                        metaAtual = null;
                        itensAtuais = [];
                        atualizarAcoesAuditoria();
                        return [4 /*yield*/, popularSelect()];
                    case 1:
                        _a.sent();
                        sel = document.getElementById('aud-op-auditoria');
                        first = (sel && sel.value) || '';
                        if (!first) return [3 /*break*/, 3];
                        return [4 /*yield*/, selecionarAuditoria(first)];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        renderizar();
                        _a.label = 4;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    document.addEventListener('DOMContentLoaded', function () {
        var sel = document.getElementById('aud-op-auditoria');
        if (sel) {
            sel.onchange = function () { return selecionarAuditoria(sel.value); };
        }
        ['aud-op-status', 'aud-op-busca', 'aud-f-dun-esperado', 'aud-f-dun-lido', 'aud-f-operador', 'aud-f-data'].forEach(function (id) {
            var e = document.getElementById(id);
            if (e)
                e.addEventListener(e.tagName === 'SELECT' ? 'change' : 'input', renderizar);
        });
        // Não consultar o Firestore na tela de login. A lista será carregada somente
        // quando a aba Auditoria for aberta após autenticação e seleção da loja.
        renderizar();
    });
    window.addEventListener('beforeunload', encerrarListener);
})();
