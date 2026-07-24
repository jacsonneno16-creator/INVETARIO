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
    var itensBrutosAtuais = [];
    var unsubscribeItens = null;
    var unsubscribeMetas = null;
    var assinaturaAnterior = '';
    var importacaoPendente = null;
    var criacaoToken = 0;
    var criacaoAberta = false;
    var criacaoPromise = null;
    var origemAuditoria = new Map();
    function colecaoAuditorias() { return DB().collection('dt_auditorias'); }
    function referenciaAuditoria(id) {
        if (origemAuditoria.get(String(id)) === 'raiz' && window.getDTRawFirestore)
            return window.getDTRawFirestore().collection('dt_auditorias').doc(String(id));
        return colecaoAuditorias().doc(String(id));
    }
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
            function renderFamilias() {
                var box = modal.querySelector('#aud72-familias-lista');
                var q = txt(modal.querySelector('#aud72-busca-prod').value).toLowerCase();
                var lista = familias.filter(function (f) { return !q || txt(f.nome).toLowerCase().includes(q); });
                box.innerHTML = lista.length ? lista.map(function (f) { return "<button type=\"button\" class=\"aud72-familia-card\" data-id=\"".concat(esc(f.id), "\" data-nome=\"").concat(esc(f.nome), "\" style=\"width:100%;text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--card);cursor:pointer;margin-bottom:6px\">").concat(esc(f.nome), "</button>"); }).join('') : '<div class="empty-sub">Nenhuma família encontrada.</div>';
                box.querySelectorAll('.aud72-familia-card').forEach(function (card) { return card.onclick = function () {
                    box.querySelectorAll('.aud72-familia-card').forEach(function (x) { return x.style.outline = ''; });
                    card.style.outline = '2px solid var(--primary)';
                    modal.querySelector('#aud72-prod').value = card.dataset.id || '';
                    modal.querySelector('#aud72-familia-selecionada').textContent = 'Selecionada: ' + (card.dataset.nome || '');
                }; });
            }
            var existente, token, html, modal, arquivoSelecionado, familias, fechar, tipo, inputArquivo;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        existente = document.getElementById('modal-nova-aud-v72');
                        if (existente) {
                            existente.classList.add('on');
                            (_a = existente.querySelector('#aud72-nome')) === null || _a === void 0 ? void 0 : _a.focus();
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, aguardarAmbienteAuditoria()];
                    case 1:
                        if (!(_b.sent()))
                            return [2 /*return*/, toast('Não foi possível identificar a loja ou a sessão do analista. Atualize a página e tente novamente.', 'w')];
                        token = ++criacaoToken;
                        criacaoAberta = true;
                        html = "<div id=\"modal-nova-aud-v72\" class=\"modal-bg on\"><div class=\"modal\" style=\"max-width:760px\">\n      <div class=\"modal-hdr\"><div><div class=\"modal-title\">Criar nova auditoria</div><div class=\"sec-sub\">O nome \u00E9 definido por voc\u00EA e n\u00E3o pelo nome do arquivo.</div></div><button type=\"button\" class=\"modal-close\" data-aud72-fechar>\u2715</button></div>\n      <div class=\"fg\">\n        <div class=\"fi full\"><div class=\"fl\">Nome da auditoria *</div><input id=\"aud72-nome\" maxlength=\"100\" placeholder=\"Ex.: Auditoria Rua 14 \u2014 Julho\"></div>\n        <div class=\"fi full\"><div class=\"fl\">Como deseja auditar?</div><select id=\"aud72-tipo\"><option value=\"rua\">Por rua</option><option value=\"produto\">Por produto/fam\u00EDlia</option></select></div>\n        <div class=\"fi full\" id=\"aud72-box-rua\"><div class=\"fl\">Ruas *</div><div id=\"aud72-ruas-status\" class=\"sec-sub\">Carregando ruas\u2026</div><select id=\"aud72-ruas\" multiple size=\"7\" style=\"display:none\"></select><div class=\"sec-sub\">Use Ctrl para selecionar mais de uma rua.</div></div>\n        <div class=\"fi full\" id=\"aud72-box-prod\" style=\"display:none\"><div class=\"fl\">Fam\u00EDlia de produtos *</div><input id=\"aud72-busca-prod\" placeholder=\"Pesquisar fam\u00EDlia...\" autocomplete=\"off\"><input type=\"hidden\" id=\"aud72-prod\"><div id=\"aud72-familias-lista\" style=\"max-height:250px;overflow:auto;margin-top:8px\"><div class=\"sec-sub\">Carregando fam\u00EDlias\u2026</div></div><div id=\"aud72-familia-selecionada\" class=\"sec-sub\" style=\"margin-top:8px\">Nenhuma fam\u00EDlia selecionada.</div></div>\n        <div class=\"fi full\"><div class=\"fl\">Base da auditoria *</div><div style=\"display:flex;gap:10px;align-items:center;flex-wrap:wrap\"><button type=\"button\" class=\"btn btn-ghost\" id=\"aud72-escolher-arquivo\">\u2B06 Selecionar arquivo</button><span id=\"aud72-arquivo-nome\" class=\"sec-sub\">Nenhum arquivo selecionado</span><input id=\"aud72-arquivo\" type=\"file\" accept=\".csv,.xlsx,.xls\" style=\"display:none\"></div><div id=\"aud72-arquivo-status\" style=\"margin-top:10px\"></div></div>\n      </div>\n      <div class=\"modal-actions\"><button type=\"button\" class=\"btn btn-ghost\" data-aud72-fechar>Cancelar</button><button type=\"button\" class=\"btn btn-primary\" id=\"aud72-criar\">Criar e importar auditoria</button></div>\n    </div></div>";
                        document.body.insertAdjacentHTML('beforeend', html);
                        modal = document.getElementById('modal-nova-aud-v72');
                        if (!modal)
                            throw new Error('Não foi possível abrir o formulário de criação.');
                        arquivoSelecionado = null;
                        familias = [];
                        fechar = function () { ++criacaoToken; criacaoAberta = false; criacaoPromise = null; modal.remove(); };
                        modal.querySelectorAll('[data-aud72-fechar]').forEach(function (b) { return b.onclick = fechar; });
                        modal.addEventListener('click', function (e) { if (e.target === modal)
                            fechar(); });
                        ['mousedown', 'pointerdown', 'change', 'input'].forEach(function (evt) { return modal.addEventListener(evt, function (e) { return e.stopPropagation(); }); });
                        tipo = modal.querySelector('#aud72-tipo');
                        tipo.onchange = function () {
                            modal.querySelector('#aud72-box-rua').style.display = tipo.value === 'rua' ? '' : 'none';
                            modal.querySelector('#aud72-box-prod').style.display = tipo.value === 'produto' ? '' : 'none';
                        };
                        inputArquivo = modal.querySelector('#aud72-arquivo');
                        modal.querySelector('#aud72-escolher-arquivo').onclick = function () { return inputArquivo.click(); };
                        inputArquivo.onchange = function () {
                            var _a;
                            arquivoSelecionado = ((_a = inputArquivo.files) === null || _a === void 0 ? void 0 : _a[0]) || null;
                            modal.querySelector('#aud72-arquivo-nome').textContent = arquivoSelecionado ? arquivoSelecionado.name : 'Nenhum arquivo selecionado';
                            modal.querySelector('#aud72-arquivo-status').innerHTML = arquivoSelecionado ? '<div class="alert info"><div>📄</div><div>Arquivo selecionado. O nome da auditoria continuará sendo o nome digitado acima.</div></div>' : '';
                        };
                        modal.querySelector('#aud72-busca-prod').oninput = renderFamilias;
                        criacaoPromise = (function () { return __awaiter(_this, void 0, void 0, function () {
                            var ends, ruas, sel, status_1, e_3;
                            var _a, _b, _c;
                            return __generator(this, function (_d) {
                                switch (_d.label) {
                                    case 0:
                                        _d.trys.push([0, 4, , 5]);
                                        if (!((_a = window.DTProdutos) === null || _a === void 0 ? void 0 : _a.carregar)) return [3 /*break*/, 2];
                                        return [4 /*yield*/, comTimeout(window.DTProdutos.carregar(false), 8000, [])];
                                    case 1:
                                        _d.sent();
                                        _d.label = 2;
                                    case 2:
                                        if (token !== criacaoToken || !document.body.contains(modal))
                                            return [2 /*return*/];
                                        familias = (((_c = (_b = window.DTProdutos) === null || _b === void 0 ? void 0 : _b.familias) === null || _c === void 0 ? void 0 : _c.call(_b)) || []).filter(function (f) { return f && f.produtos && f.produtos.length; });
                                        renderFamilias();
                                        return [4 /*yield*/, comTimeout(enderecosGerais(), 8000, [])];
                                    case 3:
                                        ends = _d.sent();
                                        if (token !== criacaoToken || !document.body.contains(modal))
                                            return [2 /*return*/];
                                        ruas = __spreadArray([], new Set(ends.map(function (e) { return ruaDoEndereco(e.endereco || e.codigo || e.id); }).filter(Boolean)), true).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
                                        sel = modal.querySelector('#aud72-ruas');
                                        status_1 = modal.querySelector('#aud72-ruas-status');
                                        sel.innerHTML = ruas.map(function (r) { return "<option value=\"".concat(esc(r), "\">Rua ").concat(esc(r), "</option>"); }).join('');
                                        sel.style.display = '';
                                        status_1.textContent = ruas.length ? "".concat(ruas.length, " rua(s) dispon\u00EDvel(is).") : 'Nenhuma rua foi encontrada na Base Geral de Endereços.';
                                        return [3 /*break*/, 5];
                                    case 4:
                                        e_3 = _d.sent();
                                        console.warn('[AUDITORIA] opções da criação:', e_3);
                                        return [3 /*break*/, 5];
                                    case 5: return [2 /*return*/];
                                }
                            });
                        }); })();
                        modal.querySelector('#aud72-criar').onclick = function () { return __awaiter(_this, void 0, void 0, function () {
                            var nome, modo, selecao, v, familia, cfg, btn, preparada, id, db, sel, e_4, status_2;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        nome = txt(modal.querySelector('#aud72-nome').value);
                                        if (!nome)
                                            return [2 /*return*/, toast('Digite o nome da auditoria.', 'w')];
                                        if (!arquivoSelecionado)
                                            return [2 /*return*/, toast('Selecione a base da auditoria.', 'w')];
                                        modo = tipo.value;
                                        selecao = [];
                                        if (modo === 'rua')
                                            selecao = __spreadArray([], modal.querySelector('#aud72-ruas').selectedOptions, true).map(function (o) { return o.value; });
                                        else {
                                            v = txt(modal.querySelector('#aud72-prod').value);
                                            if (v)
                                                selecao = [v];
                                        }
                                        if (!selecao.length)
                                            return [2 /*return*/, toast(modo === 'rua' ? 'Selecione ao menos uma rua.' : 'Selecione uma família de produtos.', 'w')];
                                        familia = modo === 'produto' ? familias.find(function (f) { return txt(f.id) === txt(selecao[0]); }) : null;
                                        cfg = { tipoAuditoria: modo, ruas: modo === 'rua' ? selecao : [], familiaId: (familia === null || familia === void 0 ? void 0 : familia.id) || '', familiaNome: (familia === null || familia === void 0 ? void 0 : familia.nome) || '' };
                                        btn = modal.querySelector('#aud72-criar');
                                        btn.disabled = true;
                                        btn.textContent = 'Criando...';
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 7, , 8]);
                                        return [4 /*yield*/, prepararImportacao(arquivoSelecionado, cfg)];
                                    case 2:
                                        preparada = _a.sent();
                                        if (!preparada.validos.length)
                                            throw new Error('Nenhuma linha válida foi encontrada para esta auditoria.');
                                        id = "AUD-".concat(Date.now());
                                        db = DB();
                                        if (!db)
                                            throw new Error('Firebase indisponível. Aguarde alguns segundos e tente novamente.');
                                        return [4 /*yield*/, db.collection('dt_auditorias').doc(id).set(__assign(__assign({ nome: nome, auditoria_nome: nome, loja: loja() }, cfg), { familiaCodigos: familia ? familia.produtos.map(function (p) { return p.codigoInterno; }) : [], status: 'RASCUNHO', liberada_coletor: false, totalItens: 0, totalPendentes: 0, totalOk: 0, totalDivergentes: 0, totalVazios: 0, arquivo_origem: arquivoSelecionado.name, criadoEm: agora(), criadoPor: usuario() }))];
                                    case 3:
                                        _a.sent();
                                        origemAuditoria.set(id, 'loja');
                                        auditoriaAtual = id;
                                        metaAtual = __assign(__assign({ id: id, nome: nome, auditoria_nome: nome }, cfg), { status: 'RASCUNHO' });
                                        importacaoPendente = __assign({ file: arquivoSelecionado }, preparada);
                                        return [4 /*yield*/, gravarImportacao()];
                                    case 4:
                                        _a.sent();
                                        fechar();
                                        return [4 /*yield*/, popularSelect()];
                                    case 5:
                                        _a.sent();
                                        sel = document.getElementById('aud-op-auditoria');
                                        if (sel)
                                            sel.value = id;
                                        return [4 /*yield*/, selecionarAuditoria(id)];
                                    case 6:
                                        _a.sent();
                                        toast("Auditoria \u201C".concat(nome, "\u201D criada com ").concat(preparada.validos.length, " item(ns)."), 's');
                                        return [3 /*break*/, 8];
                                    case 7:
                                        e_4 = _a.sent();
                                        console.error('[AUDITORIA] criação:', e_4);
                                        status_2 = modal.querySelector('#aud72-arquivo-status');
                                        if (status_2)
                                            status_2.innerHTML = "<div class=\"alert error\"><div>\u26A0\uFE0F</div><div>".concat(esc(e_4.message || 'Falha ao criar auditoria.'), "</div></div>");
                                        btn.disabled = false;
                                        btn.textContent = 'Criar e importar auditoria';
                                        return [3 /*break*/, 8];
                                    case 8: return [2 /*return*/];
                                }
                            });
                        }); };
                        modal.querySelector('#aud72-nome').focus();
                        return [2 /*return*/];
                }
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
    var loja = function () { var _a, _b, _c, _d, _e, _f; return ((_a = window.getDTLojaAtiva) === null || _a === void 0 ? void 0 : _a.call(window)) || ((_d = (_c = (_b = window.DTMultiStore) === null || _b === void 0 ? void 0 : _b.getLojaAtual) === null || _c === void 0 ? void 0 : _c.call(_b)) === null || _d === void 0 ? void 0 : _d.id) || ((_f = (_e = window.getLojaAtual) === null || _e === void 0 ? void 0 : _e.call(window)) === null || _f === void 0 ? void 0 : _f.id) || localStorage.getItem('dt_loja_atual') || ''; };
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
    function produtoPlaceholder(v) {
        var n = semAcento(txt(v)).toUpperCase();
        return !n || ['PRODUTO NAO IDENTIFICADO', 'PRODUTO NAO CADASTRADO', 'CODIGO SEM CADASTRO', 'NAO IDENTIFICADO', 'SEM CADASTRO'].includes(n);
    }
    function buscarProdutoPorCodigo(codigo) {
        var _a;
        var cod = txt(codigo);
        if (!cod || !((_a = window.DTProdutos) === null || _a === void 0 ? void 0 : _a.buscarSync))
            return null;
        var ach = window.DTProdutos.buscarSync(cod);
        return (ach === null || ach === void 0 ? void 0 : ach.encontrado) ? ach : null;
    }
    function normalizarItem(raw, id) {
        var statusRaw = txt(raw.status || 'PENDENTE').toUpperCase();
        var compatStatus = statusRaw === 'VAZIO' ? 'ENDERECO_VAZIO' :
            ['CONFIRMADO_SEM_AJUSTE', 'APROVADO', 'CORRETO', 'CONFERIDO', 'FINALIZADO'].includes(statusRaw) ? 'OK' :
                ['CONFIRMADO_COM_AJUSTE', 'ERRO'].includes(statusRaw) ? 'DIVERGENTE' : statusRaw;
        var dunEsperado = txt(raw.dunEsperado || raw.dun_esperado || raw.dun || raw.codigoProduto || raw.codigo_produto || raw.gtin || raw.ean || raw.gtin_principal || raw.codigo_barras || raw.codigo_de_barras);
        var dunLido = raw.dunLido == null ? txt(raw.dun_lido || raw.produtoEncontrado || raw.produto_encontrado || raw.codigoLido || raw.codigo_lido || raw.gtinLido || raw.gtin_lido || raw.eanLido || raw.ean_lido) || null : txt(raw.dunLido) || null;
        var esperadoCadastro = buscarProdutoPorCodigo(dunEsperado);
        var lidoCadastro = buscarProdutoPorCodigo(dunLido);
        var produtoEsperadoRaw = txt(raw.produtoEsperado || raw.produto_esperado || raw.descricaoProdutoEsperado || raw.produto_nome || raw.descricao || raw.produto);
        var produtoLidoRaw = txt(raw.produtoLido || raw.produto_lido || raw.descricaoProdutoLido || raw.produtoLidoNome || raw.produto_lido_nome);
        return {
            id: id,
            auditoriaId: txt(raw.auditoriaId || raw.auditoria_id || auditoriaAtual),
            endereco: txt(raw.endereco || raw.local || raw.posicao),
            dunEsperado: dunEsperado,
            produtoEsperado: produtoPlaceholder(produtoEsperadoRaw) ? ((esperadoCadastro === null || esperadoCadastro === void 0 ? void 0 : esperadoCadastro.nomeProduto) || produtoEsperadoRaw) : produtoEsperadoRaw,
            dunLido: dunLido,
            produtoLido: produtoPlaceholder(produtoLidoRaw) ? ((lidoCadastro === null || lidoCadastro === void 0 ? void 0 : lidoCadastro.nomeProduto) || produtoLidoRaw || null) : produtoLidoRaw,
            produtoLidoId: (lidoCadastro === null || lidoCadastro === void 0 ? void 0 : lidoCadastro.produtoId) || txt(raw.produtoLidoId || raw.produto_lido_id) || null,
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
        var db = DB();
        var lojaAtiva = loja();
        var identificacao = ((_a = window.AUTH_AN) === null || _a === void 0 ? void 0 : _a.currentUser) || window._currentAnalistaUser || localStorage.getItem('dt_analista_email');
        return !!(db && typeof db.collection === 'function' && lojaAtiva && identificacao);
    }
    function aguardarAmbienteAuditoria() {
        return __awaiter(this, arguments, void 0, function (ms) {
            var inicio;
            if (ms === void 0) { ms = 6000; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        inicio = Date.now();
                        _a.label = 1;
                    case 1:
                        if (!(Date.now() - inicio < ms)) return [3 /*break*/, 3];
                        if (ambienteAuditoriaPronto())
                            return [2 /*return*/, true];
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 120); })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 1];
                    case 3: return [2 /*return*/, ambienteAuditoriaPronto()];
                }
            });
        });
    }
    function listarMetas() {
        return __awaiter(this, void 0, void 0, function () {
            var db, docs, erroLoja, snap, e_5, atualLoja_1, raiz, e_6;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, aguardarAmbienteAuditoria()];
                    case 1:
                        if (!(_a.sent()))
                            return [2 /*return*/, []];
                        db = DB();
                        if (!db || typeof db.collection !== 'function')
                            return [2 /*return*/, []];
                        origemAuditoria.clear();
                        docs = [];
                        erroLoja = null;
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, colecaoAuditorias().get()];
                    case 3:
                        snap = _a.sent();
                        docs = snap.docs.map(function (d) { origemAuditoria.set(d.id, 'loja'); return __assign(__assign({ id: d.id }, d.data()), { _origemAuditoria: 'loja' }); });
                        return [3 /*break*/, 5];
                    case 4:
                        e_5 = _a.sent();
                        erroLoja = e_5;
                        console.warn('[AUDITORIA] coleção da loja:', e_5);
                        return [3 /*break*/, 5];
                    case 5:
                        if (!window.getDTRawFirestore) return [3 /*break*/, 9];
                        _a.label = 6;
                    case 6:
                        _a.trys.push([6, 8, , 9]);
                        atualLoja_1 = txt(loja());
                        return [4 /*yield*/, window.getDTRawFirestore().collection('dt_auditorias').get()];
                    case 7:
                        raiz = _a.sent();
                        raiz.docs.forEach(function (d) {
                            if (docs.some(function (x) { return x.id === d.id; }))
                                return;
                            var data = d.data() || {};
                            var docLoja = txt(data.loja || data.loja_id || data.lojaId);
                            var compativel = !docLoja || !atualLoja_1 || docLoja === atualLoja_1;
                            if (compativel) {
                                origemAuditoria.set(d.id, 'raiz');
                                docs.push(__assign(__assign({ id: d.id }, data), { _origemAuditoria: 'raiz' }));
                            }
                        });
                        return [3 /*break*/, 9];
                    case 8:
                        e_6 = _a.sent();
                        console.warn('[AUDITORIA] coleção legada da raiz:', e_6);
                        if (erroLoja && !docs.length)
                            throw erroLoja;
                        return [3 /*break*/, 9];
                    case 9:
                        if (erroLoja && !docs.length)
                            throw erroLoja;
                        return [2 /*return*/, docs.sort(function (a, b) {
                                var _a, _b, _c, _d, _e, _f;
                                var av = ((_b = (_a = a.criadoEm) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || ((_c = a.criadoEm) === null || _c === void 0 ? void 0 : _c.seconds) * 1000 || Date.parse(a.criadoEm || a.importado_em || 0) || 0;
                                var bv = ((_e = (_d = b.criadoEm) === null || _d === void 0 ? void 0 : _d.toMillis) === null || _e === void 0 ? void 0 : _e.call(_d)) || ((_f = b.criadoEm) === null || _f === void 0 ? void 0 : _f.seconds) * 1000 || Date.parse(b.criadoEm || b.importado_em || 0) || 0;
                                return bv - av;
                            })];
                }
            });
        });
    }
    function resolverAuditoriaSelecionada() {
        var sel = document.getElementById('aud-op-auditoria');
        var valor = txt(sel === null || sel === void 0 ? void 0 : sel.value);
        if (valor) {
            auditoriaAtual = valor;
            return valor;
        }
        if (auditoriaAtual)
            return auditoriaAtual;
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
            var sel, atual, metas, visiveis, e_7, semLogin;
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
                        e_7 = _b.sent();
                        console.error('[AUDITORIA] listar auditorias:', e_7);
                        semLogin = !((_a = window.AUTH_AN) === null || _a === void 0 ? void 0 : _a.currentUser) && !window._currentAnalistaUser;
                        if (semLogin) {
                            sel.innerHTML = '<option value="">Selecione uma auditoria...</option>';
                        }
                        else {
                            sel.innerHTML = '<option value="">Falha ao carregar auditorias — clique em Atualizar</option>';
                            toast('Não foi possível carregar as auditorias da loja atual: ' + (e_7.message || e_7), 'e');
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
                        itensBrutosAtuais = [];
                        metaAtual = null;
                        atualizarAcoesAuditoria();
                        renderizar();
                        if (!auditoriaAtual)
                            return [2 /*return*/];
                        ref = referenciaAuditoria(auditoriaAtual);
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
                            itensBrutosAtuais = snap.docs.map(function (d) { return ({ id: d.id, raw: d.data() }); });
                            var nova = itensBrutosAtuais.map(function (x) { return normalizarItem(x.raw, x.id); });
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
                        return [4 /*yield*/, referenciaAuditoria(auditoriaAtual).set({
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
            var preparada, e_8;
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
                        e_8 = _a.sent();
                        console.error(e_8);
                        toast(e_8.message || 'Erro ao ler arquivo.', 'e');
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
                        ref = referenciaAuditoria(auditoriaAtual);
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
        return __awaiter(this, void 0, void 0, function () { var e_9, l; return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, abrirCriacaoAuditoria()];
                case 1: return [2 /*return*/, _a.sent()];
                case 2:
                    e_9 = _a.sent();
                    l = document.getElementById('aud-v52-loading');
                    if (l)
                        l.remove();
                    console.error('[AUDITORIA] abrir criação:', e_9);
                    toast('Não foi possível abrir a criação da auditoria: ' + (e_9.message || e_9), 'e');
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        }); });
    }
    function confirmarImportacao() {
        return __awaiter(this, void 0, void 0, function () {
            var e_10;
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
                        e_10 = _a.sent();
                        console.error(e_10);
                        toast(e_10.message || 'Falha ao importar a base.', 'e');
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
                        ref = referenciaAuditoria(auditoriaAtual);
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
                        return [4 /*yield*/, referenciaAuditoria(auditoriaAtual).set({ status: 'FINALIZADA', finalizadaEm: agora(), finalizadaPor: usuario(), liberada_coletor: false }, { merge: true })];
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
            var sel, id, meta, ms, e_11, nome, mensagem, btn, ref, e_12;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        sel = document.getElementById('aud-op-auditoria');
                        id = txt((sel === null || sel === void 0 ? void 0 : sel.value) || auditoriaAtual);
                        if (!id)
                            return [2 /*return*/, toast('Selecione a auditoria que deseja excluir.', 'w')];
                        meta = metaAtual;
                        if (!(!meta || txt(meta.id) !== id)) return [3 /*break*/, 4];
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, referenciaAuditoria(id).get()];
                    case 2:
                        ms = _c.sent();
                        meta = ms.exists ? __assign({ id: ms.id }, ms.data()) : null;
                        return [3 /*break*/, 4];
                    case 3:
                        e_11 = _c.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        nome = txt((meta === null || meta === void 0 ? void 0 : meta.nome) || (meta === null || meta === void 0 ? void 0 : meta.auditoria_nome) || (((_b = (_a = sel === null || sel === void 0 ? void 0 : sel.selectedOptions) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.textContent) || id).split(' — ')[0] || id);
                        mensagem = "Excluir definitivamente a auditoria \u201C".concat(nome, "\u201D?\n\nTodos os endere\u00E7os e resultados dessa auditoria ser\u00E3o apagados, e ela deixar\u00E1 de aparecer nos coletores.");
                        if (!window.confirm(mensagem))
                            return [2 /*return*/];
                        btn = document.getElementById('btn-aud-excluir');
                        if (btn) {
                            btn.disabled = true;
                            btn.dataset.textoOriginal = btn.textContent;
                            btn.textContent = 'Excluindo...';
                        }
                        ref = referenciaAuditoria(id);
                        _c.label = 5;
                    case 5:
                        _c.trys.push([5, 8, 9, 10]);
                        encerrarListener();
                        // Excluir o documento principal primeiro remove a auditoria dos coletores e
                        // libera a interface imediatamente. A subcoleção é limpa em seguida.
                        return [4 /*yield*/, ref.delete()];
                    case 6:
                        // Excluir o documento principal primeiro remove a auditoria dos coletores e
                        // libera a interface imediatamente. A subcoleção é limpa em seguida.
                        _c.sent();
                        auditoriaAtual = '';
                        metaAtual = null;
                        itensAtuais = [];
                        itensBrutosAtuais = [];
                        assinaturaAnterior = '';
                        if (sel)
                            sel.value = '';
                        return [4 /*yield*/, popularSelect()];
                    case 7:
                        _c.sent();
                        renderizar();
                        atualizarAcoesAuditoria();
                        toast("Auditoria \u201C".concat(nome, "\u201D removida. Limpando os itens em segundo plano\u2026"), 's');
                        (function () {
                            return __awaiter(this, void 0, void 0, function () {
                                var snap, commits, _loop_4, i, cleanErr_1;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            _a.trys.push([0, 8, , 9]);
                                            return [4 /*yield*/, ref.collection('enderecos').get()];
                                        case 1:
                                            snap = _a.sent();
                                            commits = [];
                                            _loop_4 = function (i) {
                                                var b;
                                                return __generator(this, function (_b) {
                                                    switch (_b.label) {
                                                        case 0:
                                                            b = DB().batch();
                                                            snap.docs.slice(i, i + 350).forEach(function (d) { return b.delete(d.ref); });
                                                            commits.push(b.commit());
                                                            if (!(commits.length === 3)) return [3 /*break*/, 2];
                                                            return [4 /*yield*/, Promise.all(commits.splice(0))];
                                                        case 1:
                                                            _b.sent();
                                                            _b.label = 2;
                                                        case 2: return [2 /*return*/];
                                                    }
                                                });
                                            };
                                            i = 0;
                                            _a.label = 2;
                                        case 2:
                                            if (!(i < snap.docs.length)) return [3 /*break*/, 5];
                                            return [5 /*yield**/, _loop_4(i)];
                                        case 3:
                                            _a.sent();
                                            _a.label = 4;
                                        case 4:
                                            i += 350;
                                            return [3 /*break*/, 2];
                                        case 5:
                                            if (!commits.length) return [3 /*break*/, 7];
                                            return [4 /*yield*/, Promise.all(commits)];
                                        case 6:
                                            _a.sent();
                                            _a.label = 7;
                                        case 7: return [3 /*break*/, 9];
                                        case 8:
                                            cleanErr_1 = _a.sent();
                                            console.warn('[AUDITORIA] limpeza posterior:', cleanErr_1.message);
                                            return [3 /*break*/, 9];
                                        case 9: return [2 /*return*/];
                                    }
                                });
                            });
                        })();
                        return [3 /*break*/, 10];
                    case 8:
                        e_12 = _c.sent();
                        console.error('[AUDITORIA] excluir:', e_12);
                        toast('Falha ao excluir a auditoria: ' + (e_12.message || e_12), 'e');
                        return [3 /*break*/, 10];
                    case 9:
                        if (btn) {
                            btn.disabled = false;
                            btn.textContent = btn.dataset.textoOriginal || '🗑 Excluir';
                        }
                        return [7 /*endfinally*/];
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
        itensBrutosAtuais = [];
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
                        itensBrutosAtuais = [];
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
    function reprocessarItensComProdutos() {
        if (!itensBrutosAtuais.length)
            return;
        var nova = itensBrutosAtuais.map(function (x) { return normalizarItem(x.raw, x.id); });
        var sig = assinatura(nova);
        itensAtuais = nova;
        assinaturaAnterior = sig;
        renderizar();
    }
    window.addEventListener('dt-produtos-atualizados', reprocessarItensComProdutos);
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
