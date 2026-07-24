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
(function (global) {
    'use strict';
    var cache = { lista: [], porDun: new Map(), porGtin: new Map(), porCodigo: new Map(), porTodos: new Map(), ambiguos: new Map(), carregado: false, carregando: null, loja: '', versao: '', ultimaVerificacao: 0 };
    function texto(v) { return String(v == null ? '' : v).trim(); }
    function codigo(v) { return texto(v).replace(/[\s.\-\/()]/g, '').toUpperCase(); }
    function inferirFamilia(nome, unidade) {
        var n = texto(nome).replace(/\s+-\s+(CX|FD|FARDO|UND|UNIDADE)(?:\s+\d+)?\s*$/i, '').trim();
        var m = n.match(/^(\d{4,6})\s+(.+)$/);
        return { familiaCodigo: m ? m[1] : '', familiaNome: n, embalagem: inferirEmbalagem(nome, unidade) };
    }
    function inferirEmbalagem(nome, unidade) {
        var u = texto(unidade).toUpperCase();
        var n = texto(nome).toUpperCase();
        if (/(^|\s)(UND|UNIDADE)(\s|$)/.test(u + ' ' + n))
            return 'UND';
        if (/(^|\s)(FD|FARDO)(\s|$)/.test(u + ' ' + n))
            return 'FD';
        if (/(^|\s)(CX|CAIXA)(\s|$)/.test(u + ' ' + n))
            return 'CX';
        return u || 'OUTRO';
    }
    function produto(raw, id) {
        var nome = texto(raw.nomeProduto || raw.nome_produto || raw.produto || raw.descricao);
        var unidade = texto(raw.unidade || raw.un || raw.embalagem);
        var fam = inferirFamilia(nome, unidade);
        var gtin = texto(raw.gtin || raw.ean || raw.gtin_principal || raw.gtinPrincipal || raw.gtin_ean || raw.ean_gtin || raw.codigo_barras || raw.codigo_de_barras || raw.codigoBarras || raw.barcode);
        var dun = texto(raw.dun || raw.dun14 || raw.dun_14 || raw.codigo_dun || raw.codigoDun);
        var interno = texto(raw.codigoInterno || raw.codigo_interno || raw.codigo_produto || raw.codigoProduto || raw.codigo || raw.sku || raw.cod_interno);
        var extras = [raw.gtin, raw.ean, raw.gtin_principal, raw.gtinPrincipal, raw.gtin_ean, raw.ean_gtin, raw.codigo_barras, raw.codigo_de_barras, raw.codigoBarras, raw.barcode, raw.dun, raw.dun14, raw.dun_14, raw.codigo_dun, raw.codigoDun, raw.codigoInterno, raw.codigo_interno, raw.codigo_produto, raw.codigoProduto, raw.codigo, raw.sku, raw.cod_interno].map(texto).filter(Boolean);
        return { id: id || raw.id || '', produtoId: id || raw.produtoId || raw.produto_id || raw.id || '', codigoInterno: interno, nomeProduto: nome, dun: dun, gtin: gtin, codigosExtras: extras, unidade: unidade, embalagem: texto(raw.embalagem) || fam.embalagem, familiaCodigo: texto(raw.familiaCodigo || raw.familia_codigo) || fam.familiaCodigo, familiaNome: texto(raw.familiaNome || raw.familia_nome || raw.produtoPrincipal) || fam.familiaNome, produtoPrincipal: texto(raw.produtoPrincipal) || texto(raw.familiaNome) || fam.familiaNome, ativo: raw.ativo !== false, criadoEm: raw.criadoEm || raw.criado_em || null, atualizadoEm: raw.atualizadoEm || raw.atualizado_em || null };
    }
    function atualizarContadorNav(total) {
        var el = global.document && global.document.getElementById('nb-produtos');
        if (el)
            el.textContent = Number(total || 0).toLocaleString('pt-BR');
    }
    function indexar(lista) {
        var _a;
        cache.lista = (lista || []).map(function (x) { return produto(x, x.id); });
        cache.porDun.clear();
        cache.porGtin.clear();
        cache.porCodigo.clear();
        cache.porTodos.clear();
        cache.ambiguos.clear();
        function addCodigo(valor, p, tipo) {
            var k = codigo(valor);
            if (!k)
                return;
            var arr = cache.porTodos.get(k) || [];
            if (!arr.some(function (x) { return String(x.produtoId || x.id || '') === String(p.produtoId || p.id || '') && x.nomeProduto === p.nomeProduto; }))
                arr.push(p);
            cache.porTodos.set(k, arr);
            if (tipo === 'dun')
                cache.porDun.set(k, p);
            else if (tipo === 'gtin')
                cache.porGtin.set(k, p);
            else
                cache.porCodigo.set(k, p);
        }
        cache.lista.forEach(function (p) {
            if (!p.ativo)
                return;
            addCodigo(p.dun, p, 'dun');
            addCodigo(p.gtin, p, 'gtin');
            addCodigo(p.codigoInterno, p, 'interno');
            (p.codigosExtras || []).forEach(function (x) { addCodigo(x, p, 'extra'); });
        });
        cache.porTodos.forEach(function (arr, k) { if (arr.length > 1)
            cache.ambiguos.set(k, arr.slice()); });
        cache.carregado = true;
        cache.loja = ((_a = global.getDTLojaAtiva) === null || _a === void 0 ? void 0 : _a.call(global)) || '';
        try {
            localStorage.setItem('dt_produtos_cache__' + cache.loja, JSON.stringify(cache.lista));
        }
        catch (e) { }
        atualizarContadorNav(cache.lista.length);
        global.dispatchEvent(new CustomEvent('dt-produtos-atualizados', { detail: { total: cache.lista.length, ambiguos: cache.ambiguos.size } }));
        return cache.lista;
    }
    function carregarLocal() { var _a; var loja = ((_a = global.getDTLojaAtiva) === null || _a === void 0 ? void 0 : _a.call(global)) || ''; try {
        var raw = localStorage.getItem('dt_produtos_cache__' + loja);
        if (raw)
            indexar(JSON.parse(raw));
    }
    catch (e) { } }
    function carregar() {
        return __awaiter(this, arguments, void 0, function (force) {
            var loja;
            var _this = this;
            var _a;
            if (force === void 0) { force = false; }
            return __generator(this, function (_b) {
                loja = ((_a = global.getDTLojaAtiva) === null || _a === void 0 ? void 0 : _a.call(global)) || '';
                if (cache.carregando)
                    return [2 /*return*/, cache.carregando];
                if (!navigator.onLine) {
                    if (!cache.carregado || cache.loja !== loja)
                        carregarLocal();
                    return [2 /*return*/, cache.lista];
                }
                cache.carregando = (function () { return __awaiter(_this, void 0, void 0, function () {
                    var fs, versaoKey, versaoServidor, meta, _e_1, versaoLocal, chunks, docs, rows_1, result, e_1;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                _a.trys.push([0, 6, 7, 8]);
                                fs = global.getDTFirestore();
                                versaoKey = 'dt_produtos_versao__' + loja;
                                versaoServidor = '';
                                _a.label = 1;
                            case 1:
                                _a.trys.push([1, 3, , 4]);
                                return [4 /*yield*/, fs.collection('dt_produtos_meta').doc('versao').get()];
                            case 2:
                                meta = _a.sent();
                                if (meta.exists)
                                    versaoServidor = texto(meta.data().versao || meta.data().atualizadoEm || '');
                                return [3 /*break*/, 4];
                            case 3:
                                _e_1 = _a.sent();
                                return [3 /*break*/, 4];
                            case 4:
                                versaoLocal = localStorage.getItem(versaoKey) || cache.versao || '';
                                cache.ultimaVerificacao = Date.now();
                                if (!force && cache.carregado && cache.loja === loja && versaoServidor && versaoLocal === versaoServidor) {
                                    cache.versao = versaoServidor;
                                    return [2 /*return*/, cache.lista];
                                }
                                if (!versaoServidor) {
                                    console.warn('[Produtos] Metadado de versão ausente; mantendo cache local.');
                                    if (!cache.carregado || cache.loja !== loja)
                                        carregarLocal();
                                    return [2 /*return*/, cache.lista];
                                }
                                return [4 /*yield*/, Promise.race([
                                        fs.collection('dt_produtos_chunks').where('versao', '==', versaoServidor).get(),
                                        new Promise(function (_, reject) { setTimeout(function () { reject(new Error('Tempo excedido ao carregar chunks de produtos')); }, 30000); })
                                    ])];
                            case 5:
                                chunks = _a.sent();
                                docs = (chunks.docs || []).slice().sort(function (a, b) { return Number((a.data() || {}).parte || 0) - Number((b.data() || {}).parte || 0); });
                                rows_1 = [];
                                docs.forEach(function (d) { var x = d.data() || {}; var itens = x.itens || x.dados || x.registros || []; rows_1 = rows_1.concat(itens); });
                                console.log('[Produtos] Base atualizada somente por chunks:', docs.length, 'documentos /', rows_1.length, 'produtos / versão', versaoServidor);
                                result = indexar(rows_1);
                                cache.versao = versaoServidor;
                                if (versaoServidor)
                                    try {
                                        localStorage.setItem(versaoKey, versaoServidor);
                                    }
                                    catch (_e) { }
                                return [2 /*return*/, result];
                            case 6:
                                e_1 = _a.sent();
                                console.warn('[Produtos] Falha ao atualizar base:', e_1);
                                if (!cache.carregado || cache.loja !== loja)
                                    carregarLocal();
                                return [2 /*return*/, cache.lista];
                            case 7:
                                cache.carregando = null;
                                return [7 /*endfinally*/];
                            case 8: return [2 /*return*/];
                        }
                    });
                }); })();
                return [2 /*return*/, cache.carregando];
            });
        });
    }
    function buscarSync(valor) {
        var c = codigo(valor);
        if (!c)
            return { encontrado: false, codigoLido: texto(valor) };
        var arr = (cache.porTodos.get(c) || []).slice();
        if (!arr.length)
            return { encontrado: false, codigoLido: texto(valor) };
        if (arr.length > 1)
            return { encontrado: false, ambiguo: true, codigoLido: texto(valor), candidatos: arr.map(function (p) { return { produtoId: p.produtoId, codigoInterno: p.codigoInterno, nomeProduto: p.nomeProduto, gtin: p.gtin, dun: p.dun }; }) };
        return __assign({ encontrado: true }, arr[0]);
    }
    function buscar(valor) {
        return __awaiter(this, void 0, void 0, function () { var _a; return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!(!cache.carregado || cache.loja !== (((_a = global.getDTLojaAtiva) === null || _a === void 0 ? void 0 : _a.call(global)) || ''))) return [3 /*break*/, 2];
                    return [4 /*yield*/, carregar()];
                case 1:
                    _b.sent();
                    _b.label = 2;
                case 2: return [2 /*return*/, buscarSync(valor)];
            }
        }); });
    }
    function enriquecer(reg) { var r = __assign({}, reg); var atual = texto(r.produtoLidoNome || r.produtoLido); var placeholder = !atual || /^(PRODUTO NAO IDENTIFICADO|PRODUTO NÃO IDENTIFICADO|PRODUTO NAO CADASTRADO|PRODUTO NÃO CADASTRADO|CODIGO SEM CADASTRO|CÓDIGO SEM CADASTRO)$/i.test(atual); if (!placeholder)
        return r; var cod = r.dunLido || r.gtinLido || r.codigoLido || r.gtin_bipado || r.gtin; var ach = buscarSync(cod); if (ach.encontrado) {
        r.produtoLidoNome = ach.nomeProduto;
        r.produtoLido = ach.nomeProduto;
        r.produtoLidoId = ach.produtoId;
    } return r; }
    carregarLocal();
    if (global.document) {
        if (global.document.readyState === 'loading')
            global.document.addEventListener('DOMContentLoaded', function () { atualizarContadorNav(cache.lista.length); });
        else
            atualizarContadorNav(cache.lista.length);
    }
    if (!global.__dtProdutosPreloadLoja) {
        global.__dtProdutosPreloadLoja = true;
        global.addEventListener('dt-loja-alterada', function () {
            limparCache();
            atualizarContadorNav(0);
            setTimeout(function () { var _a; if (((_a = global.getDTLojaAtiva) === null || _a === void 0 ? void 0 : _a.call(global)) && global.getDTFirestore)
                carregar(true).catch(function (e) { console.warn('[Produtos] Pré-carga após troca de loja:', e); }); }, 250);
        });
    }
    function familias() { var mapa = {}; cache.lista.forEach(function (p) { if (!p.ativo)
        return; var k = p.familiaCodigo || p.familiaNome; if (!k)
        return; if (!mapa[k])
        mapa[k] = { id: k, nome: p.familiaNome || p.produtoPrincipal || p.nomeProduto, codigo: p.familiaCodigo, produtos: [], unidade: null }; mapa[k].produtos.push(p); if (p.embalagem === 'UND')
        mapa[k].unidade = p; }); return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return a.nome.localeCompare(b.nome); }); }
    function limparCache() { cache.lista = []; cache.porDun.clear(); cache.porGtin.clear(); cache.porCodigo.clear(); cache.porTodos.clear(); cache.ambiguos.clear(); cache.carregado = false; cache.carregando = null; cache.loja = ''; cache.versao = ''; cache.ultimaVerificacao = 0; }
    global.DTProdutos = { cache: cache, normalizarCodigo: codigo, normalizarProduto: produto, indexar: indexar, carregar: carregar, buscar: buscar, buscarSync: buscarSync, enriquecer: enriquecer, familias: familias, inferirFamilia: inferirFamilia, inferirEmbalagem: inferirEmbalagem, limparCache: limparCache, atualizarContador: atualizarContadorNav };
    global.buscarProdutoPorCodigo = buscar;
    global.enriquecerProdutoLido = enriquecer;
})(window);
