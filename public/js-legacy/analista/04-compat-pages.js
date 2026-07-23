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
// Compatibilidade e implementações essenciais das páginas administrativas.
(function () {
    'use strict';
    var db = function () { return window.FS_AN || (window.getDTFirestore && getDTFirestore()); };
    var esc = function (v) { return String(v !== null && v !== void 0 ? v : '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); };
    window.abrirAjuda = window.abrirAjuda || function () { window.open('ajuda.html', '_blank', 'noopener'); };
    window.opVerificarMinhaConta = window.opVerificarMinhaConta || function () { };
    window.opCarregarOperadoresParaFiltro = window.opCarregarOperadoresParaFiltro || function () { };
    window.ieAbrirPagina = window.ieAbrirPagina || function () {
        var _a;
        var p = document.getElementById('page-importar-exportar');
        if (!p)
            return;
        var first = p.querySelector('[data-ie-tab], .ie-tab, input[type=file], button');
        if (first)
            (_a = first.focus) === null || _a === void 0 ? void 0 : _a.call(first);
    };
    window.listarOperadores = window.listarOperadores || function () {
        return __awaiter(this, void 0, void 0, function () {
            var page, target, snap, rows, html, count, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        page = document.getElementById('page-operadores');
                        if (!page)
                            return [2 /*return*/];
                        target = page.querySelector('#op-lista, #op-tbody, tbody');
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, db().collection((window.DT_FCOL || {}).operadores || 'dt_operadores').limit(500).get()];
                    case 2:
                        snap = _a.sent();
                        rows = snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); });
                        if (target) {
                            html = rows.map(function (o) { return "<tr><td>".concat(esc(o.nome || o.name || '—'), "</td><td>").concat(esc(o.email || '—'), "</td><td>").concat(esc(o.perfil || o.tipo || 'Operador'), "</td><td>").concat(o.ativo === false ? 'Bloqueado' : 'Ativo', "</td></tr>"); }).join('');
                            target.innerHTML = html || '<tr><td colspan="4" style="text-align:center;padding:24px">Nenhum operador cadastrado</td></tr>';
                        }
                        count = page.querySelector('[data-op-count]');
                        if (count)
                            count.textContent = String(rows.length);
                        return [3 /*break*/, 4];
                    case 3:
                        e_1 = _a.sent();
                        console.error('[Operadores]', e_1);
                        if (target)
                            target.innerHTML = '<tr><td colspan="4">Erro ao carregar: ' + esc(e_1.message) + '</td></tr>';
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    window.renderRastreabilidade = window.renderRastreabilidade || function () {
        return __awaiter(this, void 0, void 0, function () {
            var page, target, snap, rows, e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        page = document.getElementById('page-rastreabilidade');
                        if (!page)
                            return [2 /*return*/];
                        target = page.querySelector('#rast-resultados, #rast-tbody, tbody');
                        if (!target)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, db().collection((window.DT_FCOL || {}).contagens || 'dt_contagens').orderBy('criado_em', 'desc').limit(100).get().catch(function () { return db().collection('dt_contagens').limit(100).get(); })];
                    case 2:
                        snap = _a.sent();
                        rows = snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); });
                        target.innerHTML = rows.map(function (x) { var _a; return "<tr><td>".concat(esc(x.endereco || '—'), "</td><td>").concat(esc(x.produto || x.gtin || x.dun || '—'), "</td><td>").concat(esc(x.operador || x.operador_nome || '—'), "</td><td>").concat(esc((_a = x.quantidade) !== null && _a !== void 0 ? _a : '—'), "</td></tr>"); }).join('') || '<tr><td colspan="4" style="text-align:center;padding:24px">Nenhuma movimentação encontrada</td></tr>';
                        return [3 /*break*/, 4];
                    case 3:
                        e_2 = _a.sent();
                        console.error('[Rastreabilidade]', e_2);
                        target.innerHTML = '<tr><td colspan="4">Erro ao carregar: ' + esc(e_2.message) + '</td></tr>';
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    // Evita ReferenceError em botões de módulos ainda não implementados; exibe uma mensagem útil.
    var optional = ['ieAbrirImportBase', 'ieExportarBluesoft', 'ieExportarProdutos', 'ieSetTab', 'oplSetTab', 'opAbrirModalCriar', 'opFecharModal', 'opFecharModalCriar', 'opGerarSenha', 'opSalvarEdicao', 'opSelecionarTipo', 'opSetModoLojasCriar', 'opSetModoLojasEditar', 'toggleOpSenha', 'toggleOpeditSenha'];
    optional.forEach(function (n) { if (typeof window[n] !== 'function')
        window[n] = function () { var _a; console.warn('[Módulo opcional]', n); (_a = window.showToast) === null || _a === void 0 ? void 0 : _a.call(window, 'Função em revisão: ' + n, 'w'); }; });
})();
