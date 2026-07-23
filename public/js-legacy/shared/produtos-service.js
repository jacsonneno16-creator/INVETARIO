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
    var cache = { lista: [], porDun: new Map(), porGtin: new Map(), porCodigo: new Map(), carregado: false, carregando: null, loja: '' };
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
        return { id: id || raw.id || '', produtoId: id || raw.produtoId || raw.id || '', codigoInterno: texto(raw.codigoInterno || raw.codigo_interno || raw.codigo || raw.sku), nomeProduto: nome, dun: texto(raw.dun), gtin: texto(raw.gtin || raw.ean), unidade: unidade, embalagem: texto(raw.embalagem) || fam.embalagem, familiaCodigo: texto(raw.familiaCodigo || raw.familia_codigo) || fam.familiaCodigo, familiaNome: texto(raw.familiaNome || raw.familia_nome || raw.produtoPrincipal) || fam.familiaNome, produtoPrincipal: texto(raw.produtoPrincipal) || texto(raw.familiaNome) || fam.familiaNome, ativo: raw.ativo !== false, criadoEm: raw.criadoEm || raw.criado_em || null, atualizadoEm: raw.atualizadoEm || raw.atualizado_em || null };
    }
    function indexar(lista) {
        var _a;
        cache.lista = (lista || []).map(function (x) { return produto(x, x.id); });
        cache.porDun.clear();
        cache.porGtin.clear();
        cache.porCodigo.clear();
        cache.lista.forEach(function (p) { if (!p.ativo)
            return; var d = codigo(p.dun), g = codigo(p.gtin), c = codigo(p.codigoInterno); if (d)
            cache.porDun.set(d, p); if (g)
            cache.porGtin.set(g, p); if (c)
            cache.porCodigo.set(c, p); });
        cache.carregado = true;
        cache.loja = ((_a = global.getDTLojaAtiva) === null || _a === void 0 ? void 0 : _a.call(global)) || '';
        try {
            localStorage.setItem('dt_produtos_cache__' + cache.loja, JSON.stringify(cache.lista));
        }
        catch (e) { }
        global.dispatchEvent(new CustomEvent('dt-produtos-atualizados', { detail: { total: cache.lista.length } }));
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
                if (!force && cache.carregado && cache.loja === loja)
                    return [2 /*return*/, cache.lista];
                if (cache.carregando)
                    return [2 /*return*/, cache.carregando];
                cache.carregando = (function () { return __awaiter(_this, void 0, void 0, function () { var fs, snap, e_1; return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, 3, 4]);
                            fs = global.getDTFirestore();
                            return [4 /*yield*/, fs.collection((global.DT_FCOL && global.DT_FCOL.produtos) || 'dt_produtos').get()];
                        case 1:
                            snap = _a.sent();
                            return [2 /*return*/, indexar(snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); }))];
                        case 2:
                            e_1 = _a.sent();
                            console.warn('[Produtos] Falha ao carregar base:', e_1);
                            carregarLocal();
                            return [2 /*return*/, cache.lista];
                        case 3:
                            cache.carregando = null;
                            return [7 /*endfinally*/];
                        case 4: return [2 /*return*/];
                    }
                }); }); })();
                return [2 /*return*/, cache.carregando];
            });
        });
    }
    function buscarSync(valor) { var c = codigo(valor); if (!c)
        return { encontrado: false, codigoLido: texto(valor) }; var p = cache.porDun.get(c) || cache.porGtin.get(c) || cache.porCodigo.get(c); return p ? __assign({ encontrado: true }, p) : { encontrado: false, codigoLido: texto(valor) }; }
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
    function enriquecer(reg) { var r = __assign({}, reg); if (r.produtoLidoNome || r.produtoLido)
        return r; var cod = r.dunLido || r.gtinLido || r.codigoLido || r.gtin_bipado || r.gtin; var ach = buscarSync(cod); if (ach.encontrado) {
        r.produtoLidoNome = ach.nomeProduto;
        r.produtoLido = ach.nomeProduto;
        r.produtoLidoId = ach.produtoId;
    } return r; }
    carregarLocal();
    function familias() { var mapa = {}; cache.lista.forEach(function (p) { if (!p.ativo)
        return; var k = p.familiaCodigo || p.familiaNome; if (!k)
        return; if (!mapa[k])
        mapa[k] = { id: k, nome: p.familiaNome || p.produtoPrincipal || p.nomeProduto, codigo: p.familiaCodigo, produtos: [], unidade: null }; mapa[k].produtos.push(p); if (p.embalagem === 'UND')
        mapa[k].unidade = p; }); return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return a.nome.localeCompare(b.nome); }); }
    global.DTProdutos = { cache: cache, normalizarCodigo: codigo, normalizarProduto: produto, indexar: indexar, carregar: carregar, buscar: buscar, buscarSync: buscarSync, enriquecer: enriquecer, familias: familias, inferirFamilia: inferirFamilia, inferirEmbalagem: inferirEmbalagem };
    global.buscarProdutoPorCodigo = buscar;
    global.enriquecerProdutoLido = enriquecer;
})(window);
