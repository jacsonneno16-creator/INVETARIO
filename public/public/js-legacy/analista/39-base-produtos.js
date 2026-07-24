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
    var _this = this;
    var COL = function () { return global.getDTFirestore().collection(global.DT_FCOL.produtos || 'dt_produtos'); };
    var lista = [], listener = null, filtroStatus = '';
    var txt = function (v) { return String(v == null ? '' : v).trim(); };
    var esc = function (v) { return txt(v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); };
    var cab = function (v) { return txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' '); };
    var cod = function (v) { return global.DTProdutos.normalizarCodigo(v); };
    function idEstavel(p) { var base = cod(p.codigoInterno) || cod(p.dun) || cod(p.gtin); return base ? ('p_' + base.toLowerCase()) : ('p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)); }
    function normalizeRow(row) { var map = {}; Object.keys(row || {}).forEach(function (k) { return map[cab(k)] = row[k]; }); var pick = function (arr) { for (var _i = 0, arr_1 = arr; _i < arr_1.length; _i++) {
        var k = arr_1[_i];
        if (map[k] != null && txt(map[k]))
            return txt(map[k]);
    } return ''; }; return { codigoInterno: pick(['CODIGO', 'CODIGO INTERNO', 'SKU', 'PRODUTO ID']), nomeProduto: pick(['PRODUTO', 'DESCRICAO', 'NOME DO PRODUTO']), dun: pick(['DUN', 'CODIGO DUN']), gtin: pick(['GTIN', 'EAN', 'CODIGO DE BARRAS']), unidade: pick(['UNIDADE', 'UN', 'EMBALAGEM']), ativo: true }; }
    function validar(rows) { var erros = []; var vistos = { dun: new Map(), gtin: new Map(), codigo: new Map() }; rows.forEach(function (p, i) { var linha = i + 2; if (!p.nomeProduto)
        erros.push({ linha: linha, codigo: p.codigoInterno || p.dun || p.gtin, motivo: 'Nome do produto obrigatório' }); if (!p.codigoInterno && !p.dun && !p.gtin)
        erros.push({ linha: linha, codigo: '', motivo: 'Informe código interno, DUN ou GTIN' }); [['dun', p.dun], ['gtin', p.gtin], ['codigo', p.codigoInterno]].forEach(function (_a) {
        var tipo = _a[0], v = _a[1];
        var n = cod(v);
        if (!n)
            return;
        if (vistos[tipo].has(n))
            erros.push({ linha: linha, codigo: v, motivo: "".concat(tipo.toUpperCase(), " duplicado na linha ").concat(vistos[tipo].get(n)) });
        else
            vistos[tipo].set(n, linha);
    }); }); return erros; }
    function render() {
        var _a, _b;
        var busca = txt((_a = document.getElementById('prod-busca')) === null || _a === void 0 ? void 0 : _a.value).toLowerCase();
        var st = ((_b = document.getElementById('prod-status')) === null || _b === void 0 ? void 0 : _b.value) || '';
        var f = lista.filter(function (p) { return (!st || (st === 'ativo' ? p.ativo : p.ativo === false)) && (!busca || [p.codigoInterno, p.nomeProduto, p.dun, p.gtin, p.unidade].join(' ').toLowerCase().includes(busca)); });
        var set = function (id, v) { var e = document.getElementById(id); if (e)
            e.textContent = v; };
        set('prod-k-total', lista.length);
        set('prod-k-semdun', lista.filter(function (p) { return !p.dun; }).length);
        set('prod-k-semgtin', lista.filter(function (p) { return !p.gtin; }).length);
        set('nb-produtos', lista.length);
        var wrap = document.getElementById('prod-table-wrap');
        if (!wrap)
            return;
        if (!f.length) {
            wrap.innerHTML = '<div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Nenhum produto encontrado</div></div>';
            return;
        }
        wrap.innerHTML = "<table><thead><tr><th>C\u00F3digo interno</th><th>Produto</th><th>DUN</th><th>GTIN/EAN</th><th>Unidade</th><th>Status</th><th>Atualiza\u00E7\u00E3o</th><th>A\u00E7\u00F5es</th></tr></thead><tbody>".concat(f.map(function (p) { return "<tr><td class=\"mono\">".concat(esc(p.codigoInterno || '—'), "</td><td><b>").concat(esc(p.nomeProduto), "</b></td><td class=\"mono\">").concat(esc(p.dun || '—'), "</td><td class=\"mono\">").concat(esc(p.gtin || '—'), "</td><td>").concat(esc(p.unidade || '—'), "</td><td><span class=\"badge ").concat(p.ativo ? 'ok' : 'off', "\">").concat(p.ativo ? 'ATIVO' : 'INATIVO', "</span></td><td>").concat(esc(formatData(p.atualizadoEm)), "</td><td><div style=\"display:flex;gap:6px\"><button class=\"btn btn-ghost btn-sm\" data-prod-acao=\"editar\" data-id=\"").concat(esc(p.id), "\">\u270F\uFE0F</button><button class=\"btn btn-ghost btn-sm\" data-prod-acao=\"toggle\" data-id=\"").concat(esc(p.id), "\">").concat(p.ativo ? '⏸' : '▶', "</button><button class=\"btn btn-danger btn-sm\" data-prod-acao=\"excluir\" data-id=\"").concat(esc(p.id), "\">\uD83D\uDDD1</button></div></td></tr>"); }).join(''), "</tbody></table>");
    }
    function formatData(v) { try {
        var d = (v === null || v === void 0 ? void 0 : v.toDate) ? v.toDate() : new Date(v || 0);
        return isNaN(d) ? '—' : d.toLocaleString('pt-BR');
    }
    catch (e) {
        return '—';
    } }
    function iniciar() {
        return __awaiter(this, void 0, void 0, function () { return __generator(this, function (_a) {
            if (listener)
                listener();
            listener = COL().onSnapshot(function (s) { lista = s.docs.map(function (d) { return global.DTProdutos.normalizarProduto(d.data(), d.id); }); global.DTProdutos.indexar(lista); render(); }, function (e) { return console.error('[Base Produtos]', e); });
            return [2 /*return*/];
        }); });
    }
    function salvarProduto(p, id) {
        return __awaiter(this, void 0, void 0, function () { var agora, payload; var _a, _b; return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    agora = new Date().toISOString();
                    payload = { codigoInterno: txt(p.codigoInterno), nomeProduto: txt(p.nomeProduto), dun: txt(p.dun), gtin: txt(p.gtin), unidade: txt(p.unidade), ativo: p.ativo !== false, atualizadoEm: agora, atualizadoPor: ((_a = global.currentUser) === null || _a === void 0 ? void 0 : _a.email) || '' };
                    if (!id) {
                        payload.criadoEm = agora;
                        payload.criadoPor = ((_b = global.currentUser) === null || _b === void 0 ? void 0 : _b.email) || '';
                    }
                    return [4 /*yield*/, COL().doc(id || idEstavel(payload)).set(payload, { merge: true })];
                case 1:
                    _c.sent();
                    return [2 /*return*/];
            }
        }); });
    }
    function abrirModal(p) {
        var _this = this;
        if (p === void 0) { p = {}; }
        var html = "<div id=\"modal-produto-bg\" class=\"modal-bg on\"><div class=\"modal\"><div class=\"modal-hdr\"><div class=\"modal-title\">".concat(p.id ? 'Editar' : 'Novo', " produto</div><button class=\"modal-close\" data-prod-fechar>\u2715</button></div><div class=\"fg\"><div class=\"fi\"><div class=\"fl\">C\u00F3digo interno</div><input id=\"mp-cod\" value=\"").concat(esc(p.codigoInterno || ''), "\"></div><div class=\"fi full\"><div class=\"fl\">Produto *</div><input id=\"mp-nome\" value=\"").concat(esc(p.nomeProduto || ''), "\"></div><div class=\"fi\"><div class=\"fl\">DUN</div><input id=\"mp-dun\" value=\"").concat(esc(p.dun || ''), "\"></div><div class=\"fi\"><div class=\"fl\">GTIN/EAN</div><input id=\"mp-gtin\" value=\"").concat(esc(p.gtin || ''), "\"></div><div class=\"fi\"><div class=\"fl\">Unidade</div><input id=\"mp-un\" value=\"").concat(esc(p.unidade || ''), "\"></div></div><div class=\"modal-actions\"><button class=\"btn btn-ghost\" data-prod-fechar>Cancelar</button><button class=\"btn btn-primary\" id=\"mp-salvar\">Salvar</button></div></div></div>");
        document.body.insertAdjacentHTML('beforeend', html);
        document.querySelectorAll('[data-prod-fechar]').forEach(function (b) { return b.onclick = function () { var _a; return (_a = document.getElementById('modal-produto-bg')) === null || _a === void 0 ? void 0 : _a.remove(); }; });
        document.getElementById('mp-salvar').onclick = function () { return __awaiter(_this, void 0, void 0, function () { var obj, er; var _a; return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    obj = { codigoInterno: txt(document.getElementById('mp-cod').value), nomeProduto: txt(document.getElementById('mp-nome').value), dun: txt(document.getElementById('mp-dun').value), gtin: txt(document.getElementById('mp-gtin').value), unidade: txt(document.getElementById('mp-un').value), ativo: p.ativo !== false };
                    er = validar([obj]);
                    if (er.length)
                        return [2 /*return*/, alert(er[0].motivo)];
                    return [4 /*yield*/, salvarProduto(obj, p.id)];
                case 1:
                    _b.sent();
                    (_a = document.getElementById('modal-produto-bg')) === null || _a === void 0 ? void 0 : _a.remove();
                    return [2 /*return*/];
            }
        }); }); };
    }
    function importar(file) {
        return __awaiter(this, void 0, void 0, function () { var data, wb, rows, normalized, erros, ativos, _loop_1, i; return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!file)
                        return [2 /*return*/];
                    return [4 /*yield*/, file.arrayBuffer()];
                case 1:
                    data = _a.sent();
                    wb = XLSX.read(data, { type: 'array', raw: false });
                    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
                    normalized = rows.map(normalizeRow).filter(function (p) { return p.nomeProduto || p.codigoInterno || p.dun || p.gtin; });
                    erros = validar(normalized);
                    if (erros.length) {
                        alert('Base inválida:\n' + erros.slice(0, 20).map(function (e) { return "Linha ".concat(e.linha, " \u00B7 ").concat(e.codigo || 'sem código', " \u00B7 ").concat(e.motivo); }).join('\n'));
                        return [2 /*return*/];
                    }
                    ativos = lista.filter(function (p) { return p.ativo; });
                    _loop_1 = function (i) {
                        var p, existente;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    p = normalized[i];
                                    existente = ativos.find(function (x) { return (cod(p.codigoInterno) && cod(x.codigoInterno) === cod(p.codigoInterno)) || (cod(p.dun) && cod(x.dun) === cod(p.dun)) || (cod(p.gtin) && cod(x.gtin) === cod(p.gtin)); });
                                    return [4 /*yield*/, salvarProduto(p, existente === null || existente === void 0 ? void 0 : existente.id)];
                                case 1:
                                    _b.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _a.label = 2;
                case 2:
                    if (!(i < normalized.length)) return [3 /*break*/, 5];
                    return [5 /*yield**/, _loop_1(i)];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4:
                    i++;
                    return [3 /*break*/, 2];
                case 5:
                    alert("".concat(normalized.length, " produto(s) importado(s)/atualizado(s)."));
                    return [2 /*return*/];
            }
        }); });
    }
    function exportar() { var dados = lista.map(function (p) { return ({ 'Código interno': p.codigoInterno, 'Produto': p.nomeProduto, 'DUN': p.dun, 'GTIN/EAN': p.gtin, 'Unidade': p.unidade, 'Status': p.ativo ? 'ATIVO' : 'INATIVO' }); }); var ws = XLSX.utils.json_to_sheet(dados); var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Produtos'); XLSX.writeFile(wb, 'base_produtos.xlsx'); }
    function excluirTodos() {
        return __awaiter(this, void 0, void 0, function () {
            var total, executar;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        total = lista.length;
                        if (!total) {
                            if (global.showToast)
                                global.showToast('Não há produtos para excluir.', 'error');
                            return [2 /*return*/];
                        }
                        executar = function () {
                            return __awaiter(this, void 0, void 0, function () {
                                var excluidos, snap, docs, _loop_2, i, e_1;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            excluidos = 0;
                                            _a.label = 1;
                                        case 1:
                                            _a.trys.push([1, 7, , 8]);
                                            return [4 /*yield*/, COL().get()];
                                        case 2:
                                            snap = _a.sent();
                                            docs = snap.docs || [];
                                            _loop_2 = function (i) {
                                                var batch;
                                                return __generator(this, function (_b) {
                                                    switch (_b.label) {
                                                        case 0:
                                                            batch = global.getDTRawFirestore().batch();
                                                            docs.slice(i, i + 300).forEach(function (d) { batch.delete(d.ref); });
                                                            return [4 /*yield*/, batch.commit()];
                                                        case 1:
                                                            _b.sent();
                                                            excluidos += Math.min(300, docs.length - i);
                                                            return [2 /*return*/];
                                                    }
                                                });
                                            };
                                            i = 0;
                                            _a.label = 3;
                                        case 3:
                                            if (!(i < docs.length)) return [3 /*break*/, 6];
                                            return [5 /*yield**/, _loop_2(i)];
                                        case 4:
                                            _a.sent();
                                            _a.label = 5;
                                        case 5:
                                            i += 300;
                                            return [3 /*break*/, 3];
                                        case 6:
                                            lista = [];
                                            global.DTProdutos.indexar([]);
                                            render();
                                            if (global.showToast)
                                                global.showToast(excluidos + ' produto(s) excluído(s).', 'success');
                                            return [3 /*break*/, 8];
                                        case 7:
                                            e_1 = _a.sent();
                                            console.error('[Base Produtos] Erro ao excluir todos:', e_1);
                                            if (global.showToast)
                                                global.showToast('Erro ao excluir todos os produtos: ' + e_1.message, 'error');
                                            return [3 /*break*/, 8];
                                        case 8: return [2 /*return*/];
                                    }
                                });
                            });
                        };
                        if (!global.showConfirm) return [3 /*break*/, 1];
                        global.showConfirm('Excluir TODOS os ' + total.toLocaleString('pt-BR') + ' produtos desta loja? Esta ação não pode ser desfeita.', executar, { title: 'Excluir todos os produtos', icon: '🗑️', okLabel: 'Excluir tudo', okClass: 'btn-danger' });
                        return [3 /*break*/, 3];
                    case 1:
                        if (!confirm('Excluir TODOS os ' + total + ' produtos desta loja?')) return [3 /*break*/, 3];
                        return [4 /*yield*/, executar()];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3: return [2 /*return*/];
                }
            });
        });
    }
    function reiniciarAoTrocarLoja() {
        if (listener) {
            try {
                listener();
            }
            catch (_) { }
            listener = null;
        }
        lista = [];
        global.DTProdutos.indexar([]);
        render();
        iniciar();
    }
    function modelo() { var ws = XLSX.utils.json_to_sheet([{ 'CÓDIGO INTERNO': '000123', 'PRODUTO': 'PRODUTO EXEMPLO', 'DUN': '07890000000001', 'GTIN': '0789000000001', 'UNIDADE': 'CX' }]); var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Modelo'); XLSX.writeFile(wb, 'modelo_base_produtos.xlsx'); }
    document.addEventListener('click', function (e) { return __awaiter(_this, void 0, void 0, function () { var b, p; return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                b = e.target.closest('[data-prod-acao]');
                if (!b)
                    return [2 /*return*/];
                p = lista.find(function (x) { return x.id === b.dataset.id; });
                if (!p)
                    return [2 /*return*/];
                if (b.dataset.prodAcao === 'editar')
                    abrirModal(p);
                if (!(b.dataset.prodAcao === 'toggle')) return [3 /*break*/, 2];
                return [4 /*yield*/, salvarProduto(__assign(__assign({}, p), { ativo: !p.ativo }), p.id)];
            case 1:
                _a.sent();
                _a.label = 2;
            case 2:
                if (!(b.dataset.prodAcao === 'excluir' && confirm("Excluir ".concat(p.nomeProduto, "?")))) return [3 /*break*/, 4];
                return [4 /*yield*/, COL().doc(p.id).delete()];
            case 3:
                _a.sent();
                _a.label = 4;
            case 4: return [2 /*return*/];
        }
    }); }); });
    if (!global.__baseProdutosListenerLoja) {
        global.__baseProdutosListenerLoja = true;
        global.addEventListener('dt-loja-alterada', reiniciarAoTrocarLoja);
    }
    global.renderBaseProdutos = function () { render(); if (!listener)
        iniciar(); };
    global.produtoNovo = function () { return abrirModal(); };
    global.produtoImportar = importar;
    global.produtoExportar = exportar;
    global.produtoBaixarModelo = modelo;
    global.produtoExcluirTodos = excluirTodos;
})(window);
