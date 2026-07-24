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
(function () {
    function _auditoriaMeta(lista) {
        return (lista || []).map(function (a) { return ({
            id: String(a.auditoria_id || a.id || '').trim(),
            auditoria_nome: a.nome || a.auditoria_nome || a.id || '',
            total_registros: Number(a.totalItens || a.total_registros || 0),
            lojas: Array.isArray(a.lojas) ? a.lojas : [],
            importado_em: a.importado_em || '',
            liberada: a.status === 'LIBERADA' || a.status === 'EM_ANDAMENTO' || !!a.liberada_coletor,
            tipoAuditoria: a.tipoAuditoria || a.tipo_auditoria || '',
            ruas: Array.isArray(a.ruas) ? a.ruas : [],
            familiaId: a.familiaId || a.familia_id || '',
            familiaNome: a.familiaNome || a.familia_nome || '',
            familiaCodigos: Array.isArray(a.familiaCodigos) ? a.familiaCodigos : [],
            disponivel_coletor: a.disponivel_coletor !== false
        }); }).filter(function (a) { return a.id && a.disponivel_coletor !== false && a.liberada; });
    }
    window._extrairLojasDaAuditoria = function (aud) { return Array.isArray(aud === null || aud === void 0 ? void 0 : aud.lojas) ? aud.lojas : []; };
    function _normalizarEnderecoGeral(valor) {
        var _a;
        return ((_a = window.DTEnderecos) === null || _a === void 0 ? void 0 : _a.chave(valor)) || String(valor == null ? '' : valor).trim().toUpperCase();
    }
    function _carregarBaseGeralEnderecosAuditoria(forcar) {
        return __awaiter(this, void 0, void 0, function () {
            var lojaId, cacheKey, locais, versaoServidor, meta, e_1, chunks, docsUsar, erro_1, cache;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
                        cacheKey = 'dt_auditoria_locais_' + lojaId;
                        if (!forcar && APP._locaisDoFirebase && APP.locaisAtivos && APP.locaisAtivos.size) {
                            return [2 /*return*/, APP.locaisAtivos];
                        }
                        locais = new Set();
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 7, , 8]);
                        versaoServidor = '';
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, FS.collection('dt_locais_meta').doc('versao').get()];
                    case 3:
                        meta = _a.sent();
                        if (meta.exists)
                            versaoServidor = String((meta.data() || {}).versao || '');
                        return [3 /*break*/, 5];
                    case 4:
                        e_1 = _a.sent();
                        return [3 /*break*/, 5];
                    case 5:
                        if (!versaoServidor)
                            throw new Error('Versão da Base Geral de Endereços não encontrada.');
                        return [4 /*yield*/, FS.collection('dt_locais_chunks').where('versao', '==', versaoServidor).get()];
                    case 6:
                        chunks = _a.sent();
                        if (chunks.empty)
                            throw new Error('Base Geral de Endereços em chunks não publicada para a versão atual.');
                        docsUsar = chunks.docs.slice().sort(function (a, b) { return Number((a.data() || {}).parte || 0) - Number((b.data() || {}).parte || 0); });
                        docsUsar.forEach(function (doc) {
                            var dados = doc.data() || {};
                            var itens = dados.dados || dados.itens || dados.registros || [];
                            itens.forEach(function (item) {
                                if (item && item.ativo === false)
                                    return;
                                var endereco = _normalizarEnderecoGeral(item && (item.endereco || item.endereco_norm || item.codigo_endereco));
                                if (endereco)
                                    locais.add(endereco);
                            });
                        });
                        APP.locaisAtivos = locais;
                        APP._locaisDoFirebase = true;
                        try {
                            localStorage.setItem(cacheKey, JSON.stringify(Array.from(locais)));
                        }
                        catch (e) { }
                        console.log('[AUDITORIA] Base Geral de Endereços carregada:', locais.size, 'loja:', lojaId);
                        return [2 /*return*/, locais];
                    case 7:
                        erro_1 = _a.sent();
                        console.warn('[AUDITORIA] Falha ao carregar Base Geral de Endereços:', erro_1);
                        try {
                            cache = JSON.parse(localStorage.getItem(cacheKey) || '[]');
                            APP.locaisAtivos = new Set(cache);
                        }
                        catch (e) {
                            APP.locaisAtivos = APP.locaisAtivos || new Set();
                        }
                        APP._locaisDoFirebase = false;
                        return [2 /*return*/, APP.locaisAtivos];
                    case 8: return [2 /*return*/];
                }
            });
        });
    }
    window._carregarBaseGeralEnderecosAuditoria = _carregarBaseGeralEnderecosAuditoria;
    function _carregarEnderecoAuditoria(auditoriaId) {
        return __awaiter(this, void 0, void 0, function () {
            var audRef, chunkSnap, rows_1, resultadosSnap, finalizados_1, pendentes, lojaId, snap, todos;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        audRef = FS.collection(FCOL.auditorias).doc(auditoriaId);
                        return [4 /*yield*/, audRef.collection('base_chunks').orderBy('parte').get()];
                    case 1:
                        chunkSnap = _a.sent();
                        if (!!chunkSnap.empty) return [3 /*break*/, 3];
                        rows_1 = [];
                        chunkSnap.docs.forEach(function (doc) {
                            var d = doc.data();
                            rows_1.push.apply(rows_1, (d.dados || d.itens || d.registros || []));
                        });
                        APP.auditoriaProdutosMap = APP.auditoriaProdutosMap || {};
                        rows_1.forEach(function (r) {
                            var codigo = String(r.gtinEsperado || r.gtin_esperado || r.eanEsperado || r.ean_esperado || r.ean || r.gtin || r.dunEsperado || r.dun_esperado || r.dun || r.codigo_produto || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                            var nome = String(r.produtoEsperado || r.produto_esperado || r.produto_nome || r.descricao || r.produto || '').trim();
                            if (codigo && nome)
                                APP.auditoriaProdutosMap[codigo] = nome;
                        });
                        return [4 /*yield*/, audRef.collection('enderecos').where('disponivel_coletor', '==', false).get()];
                    case 2:
                        resultadosSnap = _a.sent();
                        finalizados_1 = new Set();
                        resultadosSnap.docs.forEach(function (doc) {
                            var _a;
                            var d = doc.data() || {};
                            var status = String(d.status || '').toUpperCase();
                            if (['OK', 'DIVERGENTE', 'ENDERECO_VAZIO'].includes(status) || d.disponivel_coletor === false) {
                                finalizados_1.add(String(doc.id));
                                finalizados_1.add((((_a = window.DTEnderecos) === null || _a === void 0 ? void 0 : _a.chave(d.endereco)) || String(d.endereco || '').trim().toUpperCase()));
                            }
                        });
                        pendentes = rows_1.filter(function (a) {
                            var _a;
                            var status = String(a.status || '').toUpperCase();
                            var id = String(a.id || '');
                            var endereco = (((_a = window.DTEnderecos) === null || _a === void 0 ? void 0 : _a.chave(a.endereco)) || String(a.endereco || '').trim().toUpperCase());
                            return a.disponivel_coletor !== false &&
                                !['OK', 'DIVERGENTE', 'ENDERECO_VAZIO'].includes(status) &&
                                !finalizados_1.has(id) && !finalizados_1.has(endereco);
                        });
                        try {
                            lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
                            localStorage.setItem('dt_auditoria_cache_' + lojaId + '_' + auditoriaId, JSON.stringify(pendentes));
                        }
                        catch (e) { }
                        return [2 /*return*/, pendentes];
                    case 3: return [4 /*yield*/, audRef.collection('enderecos').get()];
                    case 4:
                        snap = _a.sent();
                        todos = snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); });
                        APP.auditoriaProdutosMap = {};
                        todos.forEach(function (r) {
                            var codigo = String(r.gtinEsperado || r.gtin_esperado || r.eanEsperado || r.ean_esperado || r.ean || r.gtin || r.dunEsperado || r.dun_esperado || r.dun || r.codigo_produto || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                            var nome = String(r.produtoEsperado || r.produto_esperado || r.produto_nome || r.descricao || r.produto || '').trim();
                            if (codigo && nome)
                                APP.auditoriaProdutosMap[codigo] = nome;
                        });
                        return [2 /*return*/, todos.filter(function (a) {
                                var status = String(a.status || '').toUpperCase();
                                return a.disponivel_coletor !== false && !['OK', 'DIVERGENTE', 'ENDERECO_VAZIO'].includes(status);
                            })];
                }
            });
        });
    }
    window._carregarEnderecoAuditoria = _carregarEnderecoAuditoria;
    window.carregarAuditoriasMenu = function () {
        var el = document.getElementById('aud-list-menu');
        if (!el)
            return;
        el.innerHTML = '<div class="empty-inv"><div class="empty-inv-icon" style="font-size:1.5rem">⏳</div><div>Carregando auditorias…</div></div>';
        var fromCache = function () {
            var cache = JSON.parse(localStorage.getItem('auditorias_menu_cache_v2') || '[]');
            APP.auditoriasMenu = cache;
            renderListaAuditorias(cache);
        };
        if (!navigator.onLine) {
            fromCache();
            return;
        }
        FS.collection(FCOL.auditorias)
            .where('liberada_coletor', '==', true)
            .get()
            .then(function (snap) {
            var docs = snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); });
            var grupos = _auditoriaMeta(docs);
            APP.auditoriasMenu = grupos;
            localStorage.setItem('auditorias_menu_cache_v2', JSON.stringify(grupos));
            renderListaAuditorias(grupos);
        })
            .catch(function () { return fromCache(); });
    };
    window.renderListaAuditorias = function (lista) {
        var el = document.getElementById('aud-list-menu');
        if (!el)
            return;
        lista = lista || APP.auditoriasMenu || [];
        var select = document.getElementById('aud-loja-select');
        var lojas = __spreadArray([], new Set((lista || []).flatMap(function (x) { return _extrairLojasDaAuditoria(x); }).filter(Boolean)), true).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
        if (select) {
            var atual = APP.lojaFiltroAuditoria || '';
            select.innerHTML = '<option value="">Todas as lojas</option>' + lojas.map(function (loja) { return "<option value=\"".concat(escHTML(loja), "\">").concat(escHTML(loja), "</option>"); }).join('');
            select.value = atual;
        }
        var card = document.getElementById('aud-loja-card');
        if (card)
            card.style.display = lojas.length > 1 ? '' : 'none';
        if (APP.lojaFiltroAuditoria)
            lista = (lista || []).filter(function (x) { return _extrairLojasDaAuditoria(x).includes(APP.lojaFiltroAuditoria); });
        if (!lista.length) {
            el.innerHTML = '<div class="empty-inv"><div class="empty-inv-icon">📝</div><div style="font-size:.9rem;font-weight:600">Nenhuma auditoria disponível</div><div style="font-size:.78rem;margin-top:6px">Aguarde o analista liberar a auditoria</div></div>';
            return;
        }
        el.innerHTML = lista.map(function (aud) {
            var _a;
            return "\n      <div class=\"inv-card\" onclick=\"selecionarAuditoriaMenu('".concat(aud.id, "')\">\n        <div class=\"inv-card-code\">").concat(escHTML(aud.id), "</div>\n        <div class=\"inv-card-name\">Auditoria \u2014 ").concat(escHTML(aud.auditoria_nome || aud.id), "</div>\n        <div class=\"inv-card-meta\">\n          <span class=\"badge badge-info\">\uD83D\uDCDD Auditoria</span>\n          <span class=\"badge badge-muted\">").concat(aud.total_registros || 0, " endere\u00E7os</span>\n          ").concat(((_a = aud.lojas) === null || _a === void 0 ? void 0 : _a[0]) ? "<span class=\"badge badge-muted\">".concat(escHTML(aud.lojas[0]), "</span>") : '', "\n        </div>\n      </div>\n    ");
        }).join('');
    };
    window.aplicarFiltroLojaAuditoria = function (loja) {
        APP.lojaFiltroAuditoria = String(loja || '').trim();
        renderListaAuditorias(APP.auditoriasMenu || []);
    };
    function _prepararTelaDownloadAuditoria(meta) {
        var nome = document.getElementById('dl-inv-nome');
        var icon = document.getElementById('dl-icon');
        var steps = document.getElementById('dl-steps');
        var erro = document.getElementById('dl-erro');
        var entrar = document.getElementById('dl-btn-entrar');
        var cancelar = document.getElementById('dl-btn-cancel');
        if (nome)
            nome.textContent = 'Auditoria — ' + (meta.auditoria_nome || meta.id || '');
        if (icon)
            icon.textContent = '📝';
        if (steps)
            steps.innerHTML = '';
        if (erro) {
            erro.style.display = 'none';
            erro.textContent = '';
        }
        if (entrar) {
            entrar.style.display = 'none';
            entrar.textContent = 'OK — iniciar auditoria';
            entrar.onclick = window.entrarAuditoriaCarregada;
        }
        if (cancelar) {
            cancelar.style.display = '';
            cancelar.textContent = 'Cancelar';
            cancelar.onclick = window.cancelarDownloadAuditoria;
        }
        if (typeof _dlProg === 'function')
            _dlProg(2, 'Preparando download da auditoria…');
        goScreen('download');
    }
    window.cancelarDownloadAuditoria = function () {
        APP._auditoriaCargaToken = (APP._auditoriaCargaToken || 0) + 1;
        APP._auditoriaCarregando = false;
        APP.modoAcesso = null;
        APP.modoPendente = null;
        APP.inventario = null;
        APP.auditorias = [];
        goScreen('auditorias');
    };
    window.entrarAuditoriaCarregada = function () {
        if (!APP._auditoriaPronta) {
            toast('Aguarde o carregamento completo da auditoria.', 'e');
            return;
        }
        var audTab = document.getElementById('tab-auditoria');
        if (audTab)
            audTab.style.display = '';
        goScreen('app');
        if (audTab)
            showView('auditoria', audTab);
        renderAuditoriaColetor();
    };
    window.selecionarAuditoriaMenu = function (auditoriaId) {
        return __awaiter(this, void 0, void 0, function () {
            var meta, token, produtos, totalProdutos, locais, totalLocais, _a, totalAud, entrar, cancelar, status_1, err_1, cancelar, entrar;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (APP._auditoriaCarregando)
                            return [2 /*return*/];
                        meta = (APP.auditoriasMenu || []).find(function (x) { return x.id === auditoriaId; });
                        if (!meta) {
                            toast('Auditoria não encontrada', 'e');
                            return [2 /*return*/];
                        }
                        APP._auditoriaCarregando = true;
                        APP._auditoriaPronta = false;
                        token = (APP._auditoriaCargaToken || 0) + 1;
                        APP._auditoriaCargaToken = token;
                        APP.modoPendente = 'auditoria';
                        APP.modoAcesso = 'auditoria';
                        APP.inventario = { id: auditoriaId, nome: meta.auditoria_nome || auditoriaId, status: 'ATIVO', auditoria_id: auditoriaId };
                        APP.base = [];
                        APP.auditoriaBase = [];
                        APP.contagens = [];
                        _prepararTelaDownloadAuditoria(meta);
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 11, 12, 13]);
                        if (typeof _dlStep === 'function')
                            _dlStep('aud-prod', '📦', 'Base Geral de Produtos', 'Baixando produtos, GTIN, EAN e DUN…', 'run');
                        if (typeof _dlProg === 'function')
                            _dlProg(10, 'Baixando Base Geral de Produtos…');
                        if (!window.DTProdutos || typeof window.DTProdutos.carregar !== 'function')
                            throw new Error('Serviço da Base Geral de Produtos não foi carregado.');
                        return [4 /*yield*/, window.DTProdutos.carregar(false)];
                    case 2:
                        produtos = _b.sent();
                        if (token !== APP._auditoriaCargaToken)
                            return [2 /*return*/];
                        totalProdutos = (produtos || []).filter(function (p) { return p && p.ativo !== false; }).length;
                        if (!!totalProdutos) return [3 /*break*/, 5];
                        // Uma falha passageira de rede pode ter derrubado o download antes da hora —
                        // tenta mais uma vez forçando atualização antes de dizer que está vazia.
                        if (typeof _dlStep === 'function')
                            _dlStep('aud-prod', '📦', 'Base Geral de Produtos', 'Nova tentativa…', 'run');
                        return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 1500); })];
                    case 3:
                        _b.sent();
                        return [4 /*yield*/, window.DTProdutos.carregar(true)];
                    case 4:
                        produtos = _b.sent();
                        if (token !== APP._auditoriaCargaToken)
                            return [2 /*return*/];
                        totalProdutos = (produtos || []).filter(function (p) { return p && p.ativo !== false; }).length;
                        _b.label = 5;
                    case 5:
                        if (!totalProdutos)
                            throw new Error('Não foi possível baixar a Base Geral de Produtos (verifique a conexão com a internet e tente novamente). Se o problema continuar, confirme com o analista se a base de produtos foi publicada.');
                        if (typeof _dlStep === 'function')
                            _dlStep('aud-prod', '📦', 'Base Geral de Produtos', totalProdutos + ' produtos carregados', 'ok');
                        if (typeof _dlStep === 'function')
                            _dlStep('aud-end', '📍', 'Base Geral de Endereços', 'Baixando endereços da loja…', 'run');
                        if (typeof _dlProg === 'function')
                            _dlProg(45, 'Baixando Base Geral de Endereços…');
                        return [4 /*yield*/, _carregarBaseGeralEnderecosAuditoria(false)];
                    case 6:
                        locais = _b.sent();
                        if (token !== APP._auditoriaCargaToken)
                            return [2 /*return*/];
                        totalLocais = locais && typeof locais.size === 'number' ? locais.size : 0;
                        if (!!totalLocais) return [3 /*break*/, 9];
                        // Idem: pode ser uma falha passageira de rede — tenta mais uma vez antes de desistir.
                        if (typeof _dlStep === 'function')
                            _dlStep('aud-end', '📍', 'Base Geral de Endereços', 'Nova tentativa…', 'run');
                        return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 1500); })];
                    case 7:
                        _b.sent();
                        return [4 /*yield*/, _carregarBaseGeralEnderecosAuditoria(true)];
                    case 8:
                        locais = _b.sent();
                        if (token !== APP._auditoriaCargaToken)
                            return [2 /*return*/];
                        totalLocais = locais && typeof locais.size === 'number' ? locais.size : 0;
                        _b.label = 9;
                    case 9:
                        if (!totalLocais)
                            throw new Error('Não foi possível baixar a Base Geral de Endereços (verifique a conexão com a internet e tente novamente). Se o problema continuar, confirme com o analista se os endereços foram publicados.');
                        if (typeof _dlStep === 'function')
                            _dlStep('aud-end', '📍', 'Base Geral de Endereços', totalLocais + ' endereços carregados', 'ok');
                        if (typeof _dlStep === 'function')
                            _dlStep('aud-base', '📝', 'Base da Auditoria', 'Baixando endereços pendentes…', 'run');
                        if (typeof _dlProg === 'function')
                            _dlProg(75, 'Baixando Base da Auditoria…');
                        _a = APP;
                        return [4 /*yield*/, _carregarEnderecoAuditoria(auditoriaId)];
                    case 10:
                        _a.auditorias = _b.sent();
                        if (token !== APP._auditoriaCargaToken)
                            return [2 /*return*/];
                        totalAud = (APP.auditorias || []).length;
                        if (typeof _dlStep === 'function')
                            _dlStep('aud-base', '📝', 'Base da Auditoria', totalAud + ' endereços pendentes', 'ok');
                        if (typeof _dlProg === 'function')
                            _dlProg(100, 'Todas as informações foram carregadas.');
                        APP._auditoriaPronta = true;
                        entrar = document.getElementById('dl-btn-entrar');
                        if (entrar) {
                            entrar.style.display = '';
                            entrar.textContent = 'OK — iniciar auditoria';
                            entrar.onclick = window.entrarAuditoriaCarregada;
                        }
                        cancelar = document.getElementById('dl-btn-cancel');
                        if (cancelar)
                            cancelar.style.display = 'none';
                        status_1 = document.getElementById('dl-status-txt');
                        if (status_1)
                            status_1.textContent = 'Carregamento concluído. Toque em OK para continuar.';
                        return [3 /*break*/, 13];
                    case 11:
                        err_1 = _b.sent();
                        console.error('[AUDITORIA] Falha ao preparar auditoria:', err_1);
                        APP._auditoriaPronta = false;
                        if (typeof _dlSetErro === 'function')
                            _dlSetErro(err_1.message || String(err_1));
                        else
                            toast('Erro ao abrir auditoria: ' + (err_1.message || err_1), 'e');
                        cancelar = document.getElementById('dl-btn-cancel');
                        if (cancelar) {
                            cancelar.style.display = '';
                            cancelar.textContent = 'Voltar';
                            cancelar.onclick = window.cancelarDownloadAuditoria;
                        }
                        entrar = document.getElementById('dl-btn-entrar');
                        if (entrar)
                            entrar.style.display = 'none';
                        return [3 /*break*/, 13];
                    case 12:
                        if (token === APP._auditoriaCargaToken)
                            APP._auditoriaCarregando = false;
                        return [7 /*endfinally*/];
                    case 13: return [2 /*return*/];
                }
            });
        });
    };
    var _oldVoltar = window._voltarInventarioConfirmado;
    window._voltarInventarioConfirmado = function () {
        var modo = APP.modoPendente;
        _oldVoltar && _oldVoltar();
        if (modo === 'auditoria')
            goScreen('auditorias');
    };
    document.addEventListener('DOMContentLoaded', function () {
        var subt = document.querySelector('#screen-auditorias .screen-sub');
        if (subt)
            subt.textContent = 'Selecione a auditoria liberada para conferência';
    });
})();

// v91: bloqueia download quando a sessão Firebase expirou.
(function(){var original=window.selecionarAuditoriaMenu;window.selecionarAuditoriaMenu=function(auditoriaId){if(!window.AUTH||!AUTH.currentUser){try{APP._auditoriaPronta=false;APP._auditoriaCarregando=false;APP.operador=null;}catch(e){}try{toast('Sua sessão expirou. Entre novamente para baixar a auditoria.','e');}catch(e){}try{goScreen('login');}catch(e){}return Promise.resolve();}return original.apply(this,arguments);};})();
