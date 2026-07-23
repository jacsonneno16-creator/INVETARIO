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
// Importação: Endereço + DUN + Produto. Comparação e resultados pelo DUN.
(function () {
    'use strict';
    var _this = this;
    var DB = function () { return window.FS_AN || (window.getDTFirestore && window.getDTFirestore()); };
    var STATUS = ['PENDENTE', 'OK', 'DIVERGENTE', 'ENDERECO_VAZIO'];
    var auditoriaAtual = '';
    var metaAtual = null;
    var itensAtuais = [];
    var unsubscribeItens = null;
    var assinaturaAnterior = '';
    var importacaoPendente = null;
    var txt = function (v) { return String(v == null ? '' : v).trim(); };
    var esc = function (v) { return txt(v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); };
    var semAcento = function (v) { return txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
    var cab = function (v) { return semAcento(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    var dun = function (v) { return txt(v).replace(/[^0-9A-Za-z]/g, '').toUpperCase(); };
    var endNorm = function (v) { return txt(v).toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9.\-_/]/g, ''); };
    var agora = function () { return new Date().toISOString(); };
    var usuario = function () { var _a; return ((_a = window._currentAnalistaUser) === null || _a === void 0 ? void 0 : _a.email) || localStorage.getItem('dt_analista_email') || 'analista'; };
    var loja = function () { var _a, _b, _c, _d, _e; return ((_c = (_b = (_a = window.DTMultiStore) === null || _a === void 0 ? void 0 : _a.getLojaAtual) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.id) || ((_e = (_d = window.getLojaAtual) === null || _d === void 0 ? void 0 : _d.call(window)) === null || _e === void 0 ? void 0 : _e.id) || localStorage.getItem('dt_loja_atual') || ''; };
    var docId = function (auditoriaId, endereco) { return "".concat(auditoriaId, "__").concat(endNorm(endereco).replace(/[^A-Z0-9]/g, '_')); };
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
    function listarMetas() {
        return __awaiter(this, void 0, void 0, function () {
            var snap;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, DB().collection('dt_auditorias').get()];
                    case 1:
                        snap = _a.sent();
                        return [2 /*return*/, snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); }).sort(function (a, b) { return txt(b.criadoEm || b.importado_em).localeCompare(txt(a.criadoEm || a.importado_em)); })];
                }
            });
        });
    }
    function popularSelect() {
        return __awaiter(this, void 0, void 0, function () {
            var sel, atual, metas;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        sel = document.getElementById('aud-op-auditoria');
                        if (!sel)
                            return [2 /*return*/];
                        atual = auditoriaAtual || sel.value;
                        return [4 /*yield*/, listarMetas().catch(function () { return []; })];
                    case 1:
                        metas = _a.sent();
                        sel.innerHTML = '<option value="">Selecione uma auditoria...</option>' + metas.map(function (m) { return "<option value=\"".concat(esc(m.id), "\">").concat(esc(m.nome || m.auditoria_nome || m.id), "</option>"); }).join('');
                        if (atual && __spreadArray([], sel.options, true).some(function (o) { return o.value === atual; }))
                            sel.value = atual;
                        return [2 /*return*/];
                }
            });
        });
    }
    function encerrarListener() {
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
                        renderizar();
                        if (!auditoriaAtual)
                            return [2 /*return*/];
                        ref = DB().collection('dt_auditorias').doc(auditoriaAtual);
                        return [4 /*yield*/, ref.get()];
                    case 1:
                        metaSnap = _a.sent();
                        metaAtual = metaSnap.exists ? __assign({ id: metaSnap.id }, metaSnap.data()) : null;
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
        var map = {};
        headers.forEach(function (h) { return map[cab(h)] = h; });
        var escolher = function (nomes) { return nomes.map(cab).find(function (n) { return map[n]; }); };
        return {
            endereco: map[escolher(['ENDEREÇO', 'ENDERECO', 'LOCAL', 'POSIÇÃO', 'POSICAO'])],
            dun: map[escolher(['DUN', 'CÓDIGO DUN', 'CODIGO DUN', 'CÓDIGO DO PRODUTO', 'CODIGO DO PRODUTO'])],
            produto: map[escolher(['PRODUTO', 'DESCRIÇÃO', 'DESCRICAO', 'NOME DO PRODUTO'])]
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
    function processarArquivo(file) {
        return __awaiter(this, void 0, void 0, function () {
            var rows, col_1, ausentes, erros_1, vistos_1, validos_1, status_1, preview, actions, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!file)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, lerArquivo(file)];
                    case 2:
                        rows = _a.sent();
                        if (!rows.length)
                            throw new Error('O arquivo não possui linhas de dados.');
                        col_1 = detectarColunas(Object.keys(rows[0]));
                        ausentes = [!col_1.endereco && 'Endereço', !col_1.dun && 'DUN', !col_1.produto && 'Produto'].filter(Boolean);
                        if (ausentes.length)
                            throw new Error("Colunas obrigat\u00F3rias ausentes: ".concat(ausentes.join(', '), "."));
                        erros_1 = [];
                        vistos_1 = new Map();
                        validos_1 = [];
                        rows.forEach(function (r, idx) {
                            var linha = idx + 2, endereco = txt(r[col_1.endereco]), dunEsperado = txt(r[col_1.dun]), produtoEsperado = txt(r[col_1.produto]);
                            var motivos = [];
                            if (!endereco)
                                motivos.push('endereço vazio');
                            if (endereco && !/[0-9]/.test(endereco))
                                motivos.push('endereço inválido');
                            if (!dunEsperado)
                                motivos.push('DUN vazio');
                            if (!produtoEsperado)
                                motivos.push('nome do produto vazio');
                            var chave = endNorm(endereco);
                            if (chave && vistos_1.has(chave))
                                motivos.push("endere\u00E7o duplicado (tamb\u00E9m na linha ".concat(vistos_1.get(chave), ")"));
                            else if (chave)
                                vistos_1.set(chave, linha);
                            if (motivos.length)
                                erros_1.push({ linha: linha, endereco: endereco || '—', motivo: motivos.join('; ') });
                            else
                                validos_1.push({ endereco: endereco, dunEsperado: dunEsperado, produtoEsperado: produtoEsperado });
                        });
                        importacaoPendente = { file: file, validos: validos_1, erros: erros_1 };
                        status_1 = document.getElementById('auditoria-import-status');
                        preview = document.getElementById('auditoria-import-preview');
                        actions = document.getElementById('auditoria-import-actions');
                        if (status_1)
                            status_1.innerHTML = erros_1.length ? "<div class=\"alert error\"><div>\u26A0\uFE0F</div><div><b>Base inv\u00E1lida:</b> ".concat(erros_1.length, " erro(s). Corrija antes de importar.</div></div>") : "<div class=\"alert success\"><div>\u2705</div><div>".concat(validos_1.length, " linha(s) v\u00E1lidas prontas para importa\u00E7\u00E3o.</div></div>");
                        if (preview) {
                            preview.style.display = '';
                            preview.innerHTML = erros_1.length ? "<div class=\"tbl-wrap\"><table><thead><tr><th>Linha</th><th>Endere\u00E7o</th><th>Motivo</th></tr></thead><tbody>".concat(erros_1.map(function (e) { return "<tr><td>".concat(e.linha, "</td><td>").concat(esc(e.endereco), "</td><td>").concat(esc(e.motivo), "</td></tr>"); }).join(''), "</tbody></table></div>") : "<div class=\"alert info\"><div>\uD83D\uDCC4</div><div>Arquivo: <b>".concat(esc(file.name), "</b><br>Campos reconhecidos: Endere\u00E7o, DUN e Produto.</div></div>");
                        }
                        if (actions)
                            actions.style.display = erros_1.length ? 'none' : 'flex';
                        return [3 /*break*/, 4];
                    case 3:
                        e_1 = _a.sent();
                        console.error(e_1);
                        toast(e_1.message || 'Erro ao ler arquivo.', 'e');
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function criarNova() {
        return __awaiter(this, void 0, void 0, function () {
            var nome, id, sel;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        nome = txt(prompt('Nome da nova auditoria:'));
                        if (!nome)
                            return [2 /*return*/];
                        id = "AUD-".concat(Date.now());
                        return [4 /*yield*/, DB().collection('dt_auditorias').doc(id).set({
                                nome: nome,
                                loja: loja(), status: 'RASCUNHO', totalItens: 0, totalPendentes: 0, totalOk: 0, totalDivergentes: 0, totalVazios: 0, criadoEm: agora(), criadoPor: usuario()
                            })];
                    case 1:
                        _a.sent();
                        auditoriaAtual = id;
                        return [4 /*yield*/, popularSelect()];
                    case 2:
                        _a.sent();
                        sel = document.getElementById('aud-op-auditoria');
                        if (sel)
                            sel.value = id;
                        return [4 /*yield*/, selecionarAuditoria(id)];
                    case 3:
                        _a.sent();
                        toast('Auditoria criada. Agora importe a base.', 's');
                        return [2 /*return*/];
                }
            });
        });
    }
    function confirmarImportacao() {
        return __awaiter(this, void 0, void 0, function () {
            var ref, itensRef, old, _loop_1, i, lista, _loop_2, i, actions;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!importacaoPendente || importacaoPendente.erros.length)
                            return [2 /*return*/];
                        if (!auditoriaAtual)
                            return [2 /*return*/, toast('Crie ou selecione uma auditoria antes de importar.', 'w')];
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
                                            var id = docId(auditoriaAtual, row.endereco);
                                            b.set(itensRef.doc(id), {
                                                auditoriaId: auditoriaAtual, endereco: row.endereco, dunEsperado: row.dunEsperado, produtoEsperado: row.produtoEsperado,
                                                dunLido: null, produtoLido: null, status: 'PENDENTE', operadorId: null, operadorNome: null, lidoEm: null, loja: loja(), disponivel_coletor: false
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
                        actions = document.getElementById('auditoria-import-actions');
                        if (actions)
                            actions.style.display = 'none';
                        toast('Base importada com sucesso. Todos os itens estão PENDENTES.', 's');
                        return [2 /*return*/];
                }
            });
        });
    }
    function liberar() {
        return __awaiter(this, void 0, void 0, function () {
            var ref, snap, _loop_3, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!auditoriaAtual)
                            return [2 /*return*/, toast('Selecione uma auditoria.', 'w')];
                        if (!itensAtuais.length)
                            return [2 /*return*/, toast('Importe uma base válida antes de liberar.', 'w')];
                        ref = DB().collection('dt_auditorias').doc(auditoriaAtual);
                        return [4 /*yield*/, ref.collection('enderecos').get()];
                    case 1:
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
                        _a.label = 2;
                    case 2:
                        if (!(i < snap.docs.length)) return [3 /*break*/, 5];
                        return [5 /*yield**/, _loop_3(i)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        i += 350;
                        return [3 /*break*/, 2];
                    case 5: return [4 /*yield*/, ref.set({ status: 'LIBERADA', liberada_coletor: true, liberadaEm: agora(), liberadaPor: usuario() }, { merge: true })];
                    case 6:
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
            var r;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!auditoriaAtual)
                            return [2 /*return*/, toast('Selecione uma auditoria.', 'w')];
                        r = resumo();
                        if (r.PENDENTE > 0)
                            return [2 /*return*/, toast("N\u00E3o \u00E9 poss\u00EDvel finalizar. Ainda faltam ".concat(r.PENDENTE, " item(ns)."), 'w')];
                        if (!r.total)
                            return [2 /*return*/, toast('A auditoria não possui itens.', 'w')];
                        if (!confirm("Finalizar auditoria?\nTotal: ".concat(r.total, "\nOK: ").concat(r.OK, "\nDivergentes: ").concat(r.DIVERGENTE, "\nVazios: ").concat(r.ENDERECO_VAZIO)))
                            return [2 /*return*/];
                        return [4 /*yield*/, DB().collection('dt_auditorias').doc(auditoriaAtual).set({ status: 'FINALIZADA', finalizadaEm: agora(), finalizadaPor: usuario(), liberada_coletor: false }, { merge: true })];
                    case 1:
                        _a.sent();
                        metaAtual = __assign(__assign({}, metaAtual), { status: 'FINALIZADA' });
                        toast('Auditoria finalizada.', 's');
                        return [2 /*return*/];
                }
            });
        });
    }
    function exportar() {
        if (!auditoriaAtual || !itensAtuais.length)
            return toast('Selecione uma auditoria com dados.', 'w');
        var rows = aplicarFiltros(itensAtuais).map(function (i) { return ({
            Auditoria: (metaAtual === null || metaAtual === void 0 ? void 0 : metaAtual.nome) || (metaAtual === null || metaAtual === void 0 ? void 0 : metaAtual.auditoria_nome) || auditoriaAtual, Loja: i.loja || (metaAtual === null || metaAtual === void 0 ? void 0 : metaAtual.loja) || loja(), Endereço: i.endereco,
            'DUN esperado': i.dunEsperado, 'Produto esperado': i.produtoEsperado, 'DUN lido': i.dunLido || '', 'Produto lido': i.produtoLido || '',
            Resultado: rotuloStatus(i.status), Operador: i.operadorNome || '', 'Data e hora': fmt(i.lidoEm)
        }); });
        var ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
        XLSX.writeFile(wb, "auditoria-".concat(auditoriaAtual, ".xlsx"));
    }
    // Sobrescreve apenas as funções públicas da aba Auditoria.
    window.processFileAuditoria = processarArquivo;
    window.confirmarImportAuditoria = confirmarImportacao;
    window.criarNovaAuditoriaStandalone = criarNova;
    window.liberarAuditoriaColetores = liberar;
    window.finalizarAuditoriaOperacional = finalizar;
    window.exportarAuditoriaOperacional = exportar;
    window.renderAuditoriaOperacional = renderizar;
    window.encerrarListenerAuditoriaPorTrocaLoja = function () {
        encerrarListener();
        auditoriaAtual = '';
        metaAtual = null;
        itensAtuais = [];
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
    document.addEventListener('DOMContentLoaded', function () { return __awaiter(_this, void 0, void 0, function () {
        var sel, first;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sel = document.getElementById('aud-op-auditoria');
                    if (sel) {
                        sel.onchange = function () { return selecionarAuditoria(sel.value); };
                    }
                    ['aud-op-status', 'aud-op-busca', 'aud-f-dun-esperado', 'aud-f-dun-lido', 'aud-f-operador', 'aud-f-data'].forEach(function (id) {
                        var e = document.getElementById(id);
                        if (e)
                            e.addEventListener(e.tagName === 'SELECT' ? 'change' : 'input', renderizar);
                    });
                    return [4 /*yield*/, popularSelect()];
                case 1:
                    _a.sent();
                    first = (sel === null || sel === void 0 ? void 0 : sel.value) || '';
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
    }); });
    window.addEventListener('beforeunload', encerrarListener);
})();
