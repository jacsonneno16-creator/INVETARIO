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
(function (global) {
    // ── Referências ao store / actions ──────────────────────────────────────────
    var Store = global.AnalistaStore;
    var Actions = global.AnalistaActions;
    var DivSvc = global.AnalistaDivergenciaService;
    function state() { return Store.getState(); }
    // Constante local alinhada com o serviço
    var MAX_CONTAGENS = DivSvc.MAX_CONTAGENS;
    // Meta padrão para dispatches de lógica de negócio — impede re-trigger do AppController
    var BIZMETA = { source: 'business-reprocess' };
    // Persistência canônica. Estas funções eram chamadas em todo o fluxo, mas não
    // possuíam implementação carregada, fazendo o processamento parar justamente
    // quando encontrava a primeira divergência real.
    function fsSalvarDivergencia(div) {
        return __awaiter(this, void 0, void 0, function () {
            var payload;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!div || !div.id)
                            return [2 /*return*/, false];
                        if (!navigator.onLine || !global.FS_AN)
                            return [2 /*return*/, false];
                        payload = Object.assign({}, div, { atualizado_em: new Date().toISOString() });
                        return [4 /*yield*/, global.FS_AN.collection('dt_divergencias').doc(String(div.id)).set(payload, { merge: true })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, true];
                }
            });
        });
    }
    function fsSalvarRecontagem(rec) {
        return __awaiter(this, void 0, void 0, function () {
            var payload;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!rec || !rec.id)
                            return [2 /*return*/, false];
                        if (!navigator.onLine || !global.FS_AN)
                            return [2 /*return*/, false];
                        payload = Object.assign({}, rec, { atualizado_em: new Date().toISOString() });
                        return [4 /*yield*/, global.FS_AN.collection('dt_recontagens').doc(String(rec.id)).set(payload, { merge: true })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, true];
                }
            });
        });
    }
    global.fsSalvarDivergencia = fsSalvarDivergencia;
    global.fsSalvarRecontagem = fsSalvarRecontagem;
    // ── Helpers de normalização ─────────────────────────────────────────────────
    var _nd = function (v) { return String(v || '').trim().toUpperCase(); };
    // Identificadores equivalentes do mesmo produto. A contagem pode chegar com
    // GTIN/EAN/DUN, enquanto a base do inventário normalmente guarda código interno.
    function _idsProduto(obj) {
        var _a, _b;
        var vals = [
            obj === null || obj === void 0 ? void 0 : obj.codigo_produto,
            obj === null || obj === void 0 ? void 0 : obj.codigoProduto,
            obj === null || obj === void 0 ? void 0 : obj.produto,
            obj === null || obj === void 0 ? void 0 : obj.produto_id,
            obj === null || obj === void 0 ? void 0 : obj.codigo_interno,
            obj === null || obj === void 0 ? void 0 : obj.codigoInterno,
            obj === null || obj === void 0 ? void 0 : obj.sku,
            obj === null || obj === void 0 ? void 0 : obj.gtin,
            obj === null || obj === void 0 ? void 0 : obj.ean,
            obj === null || obj === void 0 ? void 0 : obj.dun,
            obj === null || obj === void 0 ? void 0 : obj.gtin_bipado,
            obj === null || obj === void 0 ? void 0 : obj.codigo_lido,
            obj === null || obj === void 0 ? void 0 : obj.codigoLido
        ].map(_nd).filter(Boolean);
        var lido = vals[0] || '';
        var geral = (_b = (_a = global.DTProdutos) === null || _a === void 0 ? void 0 : _a.buscarSync) === null || _b === void 0 ? void 0 : _b.call(_a, lido);
        if (geral === null || geral === void 0 ? void 0 : geral.encontrado) {
            vals.push(_nd(geral.codigoInterno), _nd(geral.gtin), _nd(geral.dun), _nd(geral.produtoId));
        }
        return __spreadArray([], new Set(vals.filter(Boolean)), true);
    }
    function _produtoGeral(obj) {
        var _a, _b;
        for (var _i = 0, _c = _idsProduto(obj); _i < _c.length; _i++) {
            var id = _c[_i];
            var ach = (_b = (_a = global.DTProdutos) === null || _a === void 0 ? void 0 : _a.buscarSync) === null || _b === void 0 ? void 0 : _b.call(_a, id);
            if (ach === null || ach === void 0 ? void 0 : ach.encontrado)
                return ach;
        }
        return null;
    }
    function _descricaoProduto(item, cont) {
        var _a;
        return String((item === null || item === void 0 ? void 0 : item.descricao_produto) || (item === null || item === void 0 ? void 0 : item.descricaoProduto) || (item === null || item === void 0 ? void 0 : item.descricao) ||
            (cont === null || cont === void 0 ? void 0 : cont.descricao_produto) || (cont === null || cont === void 0 ? void 0 : cont.descricaoProduto) || (cont === null || cont === void 0 ? void 0 : cont.descricao) ||
            ((_a = _produtoGeral(cont || item)) === null || _a === void 0 ? void 0 : _a.nomeProduto) || '').trim();
    }
    function _idPrincipalBase(item) {
        return _nd((item === null || item === void 0 ? void 0 : item.codigo_produto) || (item === null || item === void 0 ? void 0 : item.codigoProduto) || (item === null || item === void 0 ? void 0 : item.codigo_interno) || (item === null || item === void 0 ? void 0 : item.codigoInterno) || (item === null || item === void 0 ? void 0 : item.gtin) || (item === null || item === void 0 ? void 0 : item.ean) || (item === null || item === void 0 ? void 0 : item.dun));
    }
    function _mesmoProduto(a, b) {
        var aa = new Set(_idsProduto(a));
        return _idsProduto(b).some(function (x) { return aa.has(x); });
    }
    // ─────────────────────────────────────────────────────────────────────────────
    //  9. LÓGICA DE DIVERGÊNCIAS
    // ─────────────────────────────────────────────────────────────────────────────
    function _divExistente(invId, endereco, produto, tipo) {
        var endN = _nd(endereco);
        if (tipo === 'VAZIO_COM_PRODUTO_NA_BASE') {
            return state().divergencias.find(function (d) {
                return String(d.inventario_id || d.inventarioId || d.inventario || d.inv_id || '') === String(invId) && _nd(d.endereco) === endN &&
                    d.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE';
            }) || null;
        }
        var prodN = _nd(produto);
        return state().divergencias.find(function (d) {
            return String(d.inventario_id || d.inventarioId || d.inventario || d.inv_id || '') === String(invId) && _nd(d.endereco) === endN &&
                _nd(d.produto) === prodN && d.tipo_divergencia === tipo;
        }) || null;
    }
    /**
     * Atualiza o status das contagens vinculadas a uma divergência (via dispatch imutável).
     */
    function _atualizarStatusContagensRec(divergenciaId, novoStatus) {
        var div = state().divergencias.find(function (d) { return d.id === divergenciaId; });
        if (!div)
            return;
        var houve = false;
        var updated = state().contagens.map(function (c) {
            if (String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') !== String(div.inventario_id || div.inventarioId || div.inventario || div.inv_id || ''))
                return c;
            if (_nd(c.endereco) !== _nd(div.endereco))
                return c;
            if (c.status === novoStatus)
                return c;
            houve = true;
            return Object.assign({}, c, { status: novoStatus });
        });
        if (houve)
            Store.dispatch(Actions.replaceSlice('contagens', updated, BIZMETA));
    }
    /**
     * Marca divergência como PERSISTENTE e encerra todas as recontagens abertas.
     * Usa dispatch imutável — sem mutação direta de objetos do state.
     */
    function finalizarComoPersistente(rec, agora) {
        var _a, _b, _c, _d;
        agora = agora || new Date().toISOString();
        var div = state().divergencias.find(function (d) { return d.id === rec.divergencia_id; });
        var nd = _nd;
        var updatedRec = Object.assign({}, rec, {
            status: 'CONCLUIDA',
            status_recontagem: 'persistente',
            status_bloqueio: 'PERSISTENTE_BLOQUEADO',
            concluida_em: agora,
            resultado_final: div ? ((_a = div.qtd_resultado_final) !== null && _a !== void 0 ? _a : null) : null,
            divergencia_resolvida: false
        });
        var batchActions = [];
        if (div) {
            var qtdFinal = (_d = (_c = (_b = rec.qtd_terceira) !== null && _b !== void 0 ? _b : rec.qtd_segunda) !== null && _c !== void 0 ? _c : rec.qtd_primeira) !== null && _d !== void 0 ? _d : null;
            var updatedDiv = Object.assign({}, div, {
                status: 'PERSISTENTE',
                status_bloqueio: 'PERSISTENTE_BLOQUEADO',
                status_recontagem: 'concluida',
                resolvida_em: agora,
                qtd_resultado_final: qtdFinal,
                contagem_aceita: 'TERCEIRA_SEM_CONSENSO'
            });
            fsSalvarDivergencia(updatedDiv);
            dbg('[Max] Divergência finalizada como PERSISTENTE:', updatedDiv.endereco);
            // Cancelar todas as outras recontagens pendentes do mesmo endereço
            var updatedRecontagens = state().recontagens.map(function (r) {
                if (r.id === rec.id)
                    return updatedRec;
                if (r.inventario_id !== div.inventario_id)
                    return r;
                if (nd(r.endereco) !== nd(div.endereco))
                    return r;
                if (r.status === 'CONCLUIDA' || r.status === 'CANCELADA')
                    return r;
                var cancelada = Object.assign({}, r, {
                    status: 'CANCELADA',
                    status_recontagem: 'cancelada',
                    cancelada_em: agora,
                    cancelada_motivo: 'PERSISTENTE_BLOQUEADO'
                });
                fsSalvarRecontagem(cancelada);
                dbg('[Max] Recontagem extra cancelada:', cancelada.id, cancelada.endereco);
                return cancelada;
            });
            batchActions.push(Actions.upsertEntity('divergencias', updatedDiv, BIZMETA), Actions.replaceSlice('recontagens', updatedRecontagens, BIZMETA), Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA));
        }
        else {
            batchActions.push(Actions.upsertEntity('recontagens', updatedRec, BIZMETA), Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA));
        }
        fsSalvarRecontagem(updatedRec);
        Store.dispatch(Actions.batch(batchActions, BIZMETA));
        _atualizarStatusContagensRec(rec.divergencia_id, 'DIVERGENTE');
    }
    // ── Helpers de quantidade ────────────────────────────────────────────────────
    function _qtdEmUnidades(c) {
        var fator = parseFloat(c.fator_caixa) || 1;
        var qtdCx = parseFloat(c.qtd_caixas);
        if (!isNaN(qtdCx) && qtdCx > 0 && fator > 1)
            return qtdCx * fator;
        return parseFloat(c.quantidade) || 0;
    }
    function _isVazio(c) {
        return c.tipo_contagem === 'VAZIO' || c.tipo === 'VAZIO_CONFIRMADO';
    }
    // ─────────────────────────────────────────────────────────────────────────────
    //  processarDivergencias — lógica de cruzamento com dispatch imutável
    // ─────────────────────────────────────────────────────────────────────────────
    function processarDivergencias(_a) {
        var _b;
        var _c = _a === void 0 ? {} : _a, _d = _c.criarRecontagens, criarRecontagens = _d === void 0 ? true : _d;
        var invId = ((_b = document.getElementById('div-sel-inv')) === null || _b === void 0 ? void 0 : _b.value) || '';
        var statusAtivos = new Set(['ATIVO', 'ABERTO', 'PUBLICADO', 'LIBERADO', 'EM_ANDAMENTO', 'PAUSADO']);
        var inventarios = invId
            ? [state().inventarios.find(function (i) { return String(i.id) === String(invId); })].filter(Boolean)
            : state().inventarios.filter(function (i) { return i && (statusAtivos.has(String(i.status || '').toUpperCase()) || (Array.isArray(i.base) && i.base.length)); });
        var novos = 0;
        // Acumuladores para batch final
        var novasDivs = []; // divergências novas a upsert
        var novasRecs = []; // recontagens novas a upsert
        var divsUpdate = []; // divergências existentes a atualizar
        // Map de contagens a atualizar: uuid/id → objeto atualizado
        var contagensMap = new Map();
        inventarios.forEach(function (inv) {
            var _a;
            if (!((_a = inv.base) === null || _a === void 0 ? void 0 : _a.length))
                return;
            var conts = state().contagens.filter(function (c) {
                return String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') === String(inv.id) &&
                    c.tipo_contagem !== 'RECONTAGEM' &&
                    !c._excluida &&
                    c.status !== 'ESTORNADA' &&
                    c.status !== 'EXCLUIDA' &&
                    !_isVazio(c);
            });
            var _normKey = function (end, prod) { return "".concat(_nd(end), "||").concat(_nd(prod)); };
            var basePorEndereco = new Map();
            var basePorId = new Map();
            var mapaBase = {};
            inv.base.forEach(function (item, idx) {
                var end = _nd(item.endereco);
                var key = "".concat(end, "||BASE_").concat(idx);
                item.__dtKey = key;
                item.__dtIds = _idsProduto(item);
                if (!basePorEndereco.has(end))
                    basePorEndereco.set(end, []);
                basePorEndereco.get(end).push(item);
                item.__dtIds.forEach(function (id) {
                    if (!basePorId.has(id))
                        basePorId.set(id, []);
                    basePorId.get(id).push(item);
                });
                mapaBase[key] = item;
            });
            function localizarItemBase(cont, somenteEndereco) {
                if (somenteEndereco === void 0) { somenteEndereco = true; }
                var candidatos = somenteEndereco
                    ? (basePorEndereco.get(_nd(cont.endereco)) || [])
                    : inv.base;
                return candidatos.find(function (item) { return _mesmoProduto(item, cont); }) || null;
            }
            // Deduplicação de contagens
            var _seenConts = new Set();
            var contsUnicas = [];
            conts.forEach(function (c) {
                var dedupKey = c.uuid
                    ? String(c.uuid).trim()
                    : [c.inventario_id, _nd(c.endereco), _nd(c.capa), _idsProduto(c).join(','),
                        Number(c.quantidade || 0), _nd(c.operador), _nd(c.tipo_contagem),
                        String(c.criado_em || c.dataHora || '').slice(0, 16)].join('|');
                if (_seenConts.has(dedupKey)) {
                    dbg('[Dedup] Contagem duplicada ignorada:', dedupKey);
                    return;
                }
                _seenConts.add(dedupKey);
                contsUnicas.push(c);
            });
            var mapaConts = {};
            var infoContagem = new Map();
            contsUnicas.forEach(function (c) {
                var itemBase = localizarItemBase(c, true);
                var geral = _produtoGeral(c);
                var key = (itemBase === null || itemBase === void 0 ? void 0 : itemBase.__dtKey) || _normKey(c.endereco, _idsProduto(c)[0] || 'SEM_PRODUTO');
                mapaConts[key] = (mapaConts[key] || 0) + _qtdEmUnidades(c);
                infoContagem.set(c, { itemBase: itemBase, geral: geral, key: key });
            });
            // ── Atualizar status de contagens normais ──
            contsUnicas.forEach(function (c) {
                var _a;
                var info = infoContagem.get(c) || {};
                var itemBase = info.itemBase || null;
                var qtdCont = (_a = mapaConts[info.key]) !== null && _a !== void 0 ? _a : null;
                var novoStatus = !itemBase ? 'DIVERGENTE'
                    : ((qtdCont === (parseFloat(itemBase.quantidade_esperada) || 0)) ? 'PROCESSADO' : 'DIVERGENTE');
                var descricao = _descricaoProduto(itemBase, c);
                var codigoBase = _idPrincipalBase(itemBase);
                if (c.status !== novoStatus || (descricao && !c.descricao) || (codigoBase && !c.codigo_produto)) {
                    var updated = Object.assign({}, c, {
                        status: novoStatus,
                        descricao: descricao || c.descricao || '',
                        descricao_produto: descricao || c.descricao_produto || '',
                        codigo_produto: codigoBase || c.codigo_produto || c.gtin || ''
                    });
                    contagensMap.set(c.uuid || c.id, updated);
                    var docId = c.uuid || String(c.id);
                    if (navigator.onLine)
                        FS_AN.collection('dt_contagens').doc(docId).set({
                            status: novoStatus,
                            descricao: updated.descricao,
                            descricao_produto: updated.descricao_produto,
                            codigo_produto: updated.codigo_produto
                        }, { merge: true }).catch(function () { });
                }
            });
            // ── Atualizar status de RECONTAGEMs ──
            state().contagens.filter(function (c) {
                return String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') === String(inv.id) && c.tipo_contagem === 'RECONTAGEM' &&
                    !c._excluida && c.status !== 'ESTORNADA';
            }).forEach(function (c) {
                var divRef = c.divergencia_id
                    ? state().divergencias.find(function (d) { return d.id === c.divergencia_id; })
                    : state().divergencias.find(function (d) {
                        return d.inventario_id === c.inventario_id &&
                            _nd(d.endereco) === _nd(c.endereco);
                    });
                var novoStatus = !divRef ? 'PROCESSADO'
                    : divRef.status === 'RESOLVIDA' ? 'PROCESSADO'
                        : divRef.status === 'PERSISTENTE' ? 'DIVERGENTE'
                            : 'DIVERGENTE';
                if (c.status !== novoStatus) {
                    contagensMap.set(c.uuid || c.id, Object.assign({}, c, { status: novoStatus }));
                    var docId = c.uuid || String(c.id);
                    if (navigator.onLine)
                        FS_AN.collection('dt_contagens').doc(docId).update({ status: novoStatus }).catch(function () { });
                }
            });
            // Repara divergências antigas criadas como "produto não identificado" quando
            // o GTIN/DUN pertence a um produto cadastrado e também existe na base do inventário.
            contsUnicas.forEach(function (c) {
                var info = infoContagem.get(c) || {};
                if (!info.itemBase)
                    return;
                var antigos = state().divergencias.filter(function (d) {
                    return String(d.inventario_id || d.inventarioId || '') === String(inv.id) &&
                        _nd(d.endereco) === _nd(c.endereco) &&
                        d.tipo_divergencia === 'PRODUTO_NAO_IDENTIFICADO' &&
                        (!d.contagem_uuid || !c.uuid || String(d.contagem_uuid) === String(c.uuid));
                });
                antigos.forEach(function (d) {
                    var qtdEsp = parseFloat(info.itemBase.quantidade_esperada) || 0;
                    var qtdCont = mapaConts[info.key] || 0;
                    var diferenca = qtdCont - qtdEsp;
                    var atualizado = Object.assign({}, d, {
                        produto: _idPrincipalBase(info.itemBase),
                        produto_contado: _idsProduto(c)[0] || d.produto_contado,
                        descricao: _descricaoProduto(info.itemBase, c),
                        qtd_esperada: qtdEsp,
                        qtd_contada: qtdCont,
                        diferenca: diferenca,
                        tipo_divergencia: 'QUANTIDADE_DIFERENTE',
                        motivos_divergencia: ['QUANTIDADE_DIFERENTE'],
                        status: diferenca === 0 ? 'RESOLVIDA' : 'EM_RECONTAGEM',
                        precisa_recontagem: diferenca !== 0,
                        corrigida_em: new Date().toISOString()
                    });
                    divsUpdate.push(atualizado);
                    fsSalvarDivergencia(atualizado);
                });
            });
            // ── 1a. Divergências de quantidade ──
            inv.base.forEach(function (item) {
                var key = item.__dtKey;
                var qtdEsp = parseFloat(item.quantidade_esperada) || 0;
                var qtdCont = mapaConts[key] !== undefined ? mapaConts[key] : null;
                if (qtdCont === null)
                    return;
                var produtoBase = _idPrincipalBase(item);
                var descricaoBase = _descricaoProduto(item, item);
                var diferenca = qtdCont - qtdEsp;
                if (diferenca === 0) {
                    var divExistente = state().divergencias.find(function (d) {
                        return String(d.inventario_id || d.inventarioId || '') === String(inv.id) &&
                            _nd(d.endereco) === _nd(item.endereco) && _mesmoProduto(d, item) &&
                            ['ABERTA', 'EM_RECONTAGEM'].includes(d.status);
                    });
                    if (divExistente) {
                        var updatedDiv = Object.assign({}, divExistente, {
                            produto: produtoBase, descricao: descricaoBase,
                            qtd_esperada: qtdEsp, qtd_contada: qtdCont, diferenca: 0,
                            status: 'RESOLVIDA', resolvida_em: new Date().toISOString(), resolvida_por: 'sistema (correção)'
                        });
                        divsUpdate.push(updatedDiv);
                        fsSalvarDivergencia(updatedDiv);
                    }
                    return;
                }
                var existente = state().divergencias.find(function (d) {
                    return String(d.inventario_id || d.inventarioId || '') === String(inv.id) &&
                        _nd(d.endereco) === _nd(item.endereco) && _mesmoProduto(d, item) &&
                        ['QUANTIDADE_DIFERENTE', 'PRODUTO_NAO_IDENTIFICADO'].includes(d.tipo_divergencia);
                });
                if (existente) {
                    var atualizado = Object.assign({}, existente, {
                        produto: produtoBase, descricao: descricaoBase,
                        qtd_esperada: qtdEsp, qtd_contada: qtdCont,
                        diferenca: diferenca,
                        tipo_divergencia: 'QUANTIDADE_DIFERENTE', motivos_divergencia: ['QUANTIDADE_DIFERENTE'],
                        status: existente.status === 'PERSISTENTE' ? 'PERSISTENTE' : 'EM_RECONTAGEM',
                        precisa_recontagem: true
                    });
                    divsUpdate.push(atualizado);
                    fsSalvarDivergencia(atualizado);
                    return;
                }
                var div = {
                    id: gerarId('DIV'), inventario_id: inv.id, inventario_nome: inv.nome,
                    endereco: item.endereco, produto: produtoBase, descricao: descricaoBase,
                    qtd_esperada: qtdEsp, qtd_contada: qtdCont,
                    diferenca: diferenca,
                    tipo_divergencia: 'QUANTIDADE_DIFERENTE', motivos_divergencia: ['QUANTIDADE_DIFERENTE'],
                    status: 'EM_RECONTAGEM', precisa_recontagem: true,
                    criada_em: new Date().toISOString(), criada_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'sistema',
                };
                novasDivs.push(div);
                fsSalvarDivergencia(div);
                novos++;
                if (criarRecontagens)
                    _criarRecontagemParaDivergencia(div, inv, qtdCont, novasRecs);
            });
            // ── 1b. Produto realmente não identificado ──
            contsUnicas.forEach(function (c) {
                var info = infoContagem.get(c) || {};
                if (info.itemBase || info.geral)
                    return;
                var prodCod = _idsProduto(c)[0] || '';
                if (_divExistente(inv.id, c.endereco, prodCod, 'PRODUTO_NAO_IDENTIFICADO'))
                    return;
                var div = {
                    id: gerarId('DIV'), inventario_id: inv.id, inventario_nome: inv.nome,
                    endereco: c.endereco, produto: prodCod, produto_contado: prodCod,
                    descricao: _descricaoProduto(null, c) || 'Produto não identificado', gtin_bipado: _nd(c.gtin || prodCod),
                    qtd_esperada: null, qtd_contada: _qtdEmUnidades(c), diferenca: null,
                    tipo_divergencia: 'PRODUTO_NAO_IDENTIFICADO', motivos_divergencia: ['PRODUTO_NAO_IDENTIFICADO'],
                    contagem_uuid: c.uuid, operador: c.operador,
                    status: 'ABERTA', precisa_recontagem: true,
                    criada_em: new Date().toISOString(), criada_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'sistema',
                };
                novasDivs.push(div);
                fsSalvarDivergencia(div);
                novos++;
                if (criarRecontagens)
                    _criarRecontagemParaDivergencia(div, inv, _qtdEmUnidades(c), novasRecs);
            });
            // ── 1c. Produto cadastrado, porém fora do endereço correto ──
            contsUnicas.forEach(function (c) {
                var info = infoContagem.get(c) || {};
                if (info.itemBase)
                    return;
                var itemEmOutroEndereco = localizarItemBase(c, false);
                if (!itemEmOutroEndereco && !info.geral)
                    return;
                var prodCod = _idPrincipalBase(itemEmOutroEndereco) || _idsProduto(c)[0] || '';
                if (_divExistente(inv.id, c.endereco, prodCod, 'PRODUTO_FORA_ENDERECO'))
                    return;
                var qtdEsp = itemEmOutroEndereco ? (parseFloat(itemEmOutroEndereco.quantidade_esperada) || 0) : null;
                var div = {
                    id: gerarId('DIV'), inventario_id: inv.id, inventario_nome: inv.nome,
                    endereco: c.endereco, endereco_correto: (itemEmOutroEndereco === null || itemEmOutroEndereco === void 0 ? void 0 : itemEmOutroEndereco.endereco) || null,
                    produto: prodCod, produto_contado: _idsProduto(c)[0] || prodCod,
                    descricao: _descricaoProduto(itemEmOutroEndereco, c), qtd_esperada: qtdEsp,
                    qtd_contada: _qtdEmUnidades(c), diferenca: qtdEsp == null ? null : (_qtdEmUnidades(c) - qtdEsp),
                    tipo_divergencia: 'PRODUTO_FORA_ENDERECO', motivos_divergencia: ['PRODUTO_FORA_ENDERECO'],
                    contagem_uuid: c.uuid, operador: c.operador,
                    status: 'ABERTA', precisa_recontagem: true,
                    criada_em: new Date().toISOString(), criada_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'sistema',
                };
                novasDivs.push(div);
                fsSalvarDivergencia(div);
                novos++;
                if (criarRecontagens)
                    _criarRecontagemParaDivergencia(div, inv, _qtdEmUnidades(c), novasRecs);
            });
            // ── 1d. Endereço vazio mas base espera produto ──
            state().contagens.filter(function (c) {
                return String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') === String(inv.id) && _isVazio(c) && !c._excluida &&
                    c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA';
            }).forEach(function (vazio) {
                var _a;
                var itensEsperados = inv.base.filter(function (item) {
                    return _nd(item.endereco) === _nd(vazio.endereco);
                });
                if (!itensEsperados.length)
                    return;
                if (_divExistente(inv.id, vazio.endereco, '', 'VAZIO_COM_PRODUTO_NA_BASE'))
                    return;
                var produtosEsperados = itensEsperados.map(function (i) {
                    return "".concat(i.codigo_produto).concat(i.descricao_produto ? ' — ' + i.descricao_produto : '');
                }).join('; ');
                var div = {
                    id: gerarId('DIV'), inventario_id: inv.id, inventario_nome: inv.nome,
                    endereco: vazio.endereco, produto: ((_a = itensEsperados[0]) === null || _a === void 0 ? void 0 : _a.codigo_produto) || '',
                    descricao: "Endere\u00E7o vazio, mas base esperava: ".concat(produtosEsperados),
                    qtd_esperada: itensEsperados.reduce(function (s, i) { return s + (parseFloat(i.quantidade_esperada) || 0); }, 0),
                    qtd_contada: 0, diferenca: null,
                    tipo_divergencia: 'VAZIO_COM_PRODUTO_NA_BASE', motivos_divergencia: ['VAZIO_COM_PRODUTO_NA_BASE'],
                    contagem_uuid: vazio.uuid, operador: vazio.operador,
                    itens_esperados: itensEsperados.map(function (i) { return ({
                        codigo_produto: i.codigo_produto, descricao_produto: i.descricao_produto,
                        quantidade_esperada: i.quantidade_esperada,
                    }); }),
                    status: 'ABERTA', precisa_recontagem: true,
                    criada_em: new Date().toISOString(), criada_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'sistema',
                };
                novasDivs.push(div);
                fsSalvarDivergencia(div);
                novos++;
                if (criarRecontagens)
                    _criarRecontagemParaDivergencia(div, inv, 0, novasRecs);
            });
        });
        // ── Garantia: toda divergência aberta deve possuir recontagem pendente ──
        if (criarRecontagens) {
            var candidatas = __spreadArray(__spreadArray(__spreadArray([], state().divergencias, true), novasDivs, true), divsUpdate, true);
            var vistos_1 = new Set();
            candidatas.forEach(function (div) {
                if (!div || vistos_1.has(div.id))
                    return;
                vistos_1.add(div.id);
                var st = String(div.status || 'ABERTA').toUpperCase();
                if (st === 'RESOLVIDA' || st === 'PERSISTENTE' || div.precisa_recontagem === false)
                    return;
                var jaExiste = __spreadArray(__spreadArray([], state().recontagens, true), novasRecs, true).some(function (r) {
                    return String(r.divergencia_id || '') === String(div.id) &&
                        !['CONCLUIDA', 'CANCELADA'].includes(String(r.status || '').toUpperCase());
                });
                if (jaExiste)
                    return;
                var inv = inventarios.find(function (i) { return String(i.id) === String(div.inventario_id || div.inventarioId || ''); });
                if (!inv)
                    return;
                _criarRecontagemParaDivergencia(div, inv, Number(div.qtd_contada || 0), novasRecs);
            });
        }
        // ── Deduplicação final de divergências ──
        var _seenDiv = new Set();
        var todasDivs = __spreadArray(__spreadArray(__spreadArray([], state().divergencias, true), novasDivs, true), divsUpdate.map(function (d) {
            // divsUpdate já foram computadas mas precisam sobrescrever o state atual
            return d;
        }), true);
        // Reconstituir lista completa com atualizações e dedup
        var divsById = new Map();
        // Prioridade: atualizações > novas > existentes
        state().divergencias.forEach(function (d) { return divsById.set(d.id, d); });
        divsUpdate.forEach(function (d) { return divsById.set(d.id, d); });
        novasDivs.forEach(function (d) { return divsById.set(d.id, d); });
        var divergenciasDedupe = Array.from(divsById.values()).filter(function (d) {
            if (d.status === 'RESOLVIDA' || d.status === 'PERSISTENTE')
                return true;
            var prodKey = d.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE' ? '' : _nd(d.produto);
            var key = "".concat(d.inventario_id, "|").concat(_nd(d.endereco), "|").concat(prodKey, "|").concat(d.tipo_divergencia);
            if (_seenDiv.has(key)) {
                dbg('[Dedup] div duplicada removida:', key);
                return false;
            }
            _seenDiv.add(key);
            return true;
        });
        // ── Aplicar contagens atualizadas ──
        var finalContagens = state().contagens;
        if (contagensMap.size > 0) {
            finalContagens = state().contagens.map(function (c) { return contagensMap.get(c.uuid || c.id) || c; });
        }
        // ── Batch final ──
        var batchActions = [
            Actions.replaceSlice('divergencias', divergenciasDedupe, BIZMETA),
        ];
        if (contagensMap.size > 0)
            batchActions.push(Actions.replaceSlice('contagens', finalContagens, BIZMETA));
        // Propagar produto/descrição/quantidade esperada corrigidos para recontagens
        // já existentes. Assim registros antigos deixam de exibir null e código sem cadastro.
        var divAtualPorId = new Map(divergenciasDedupe.map(function (d) { return [String(d.id), d]; }));
        var houveRecAtualizada = false;
        var recsFinais = state().recontagens.map(function (r) {
            var d = divAtualPorId.get(String(r.divergencia_id || ''));
            if (!d)
                return r;
            var atualizado = Object.assign({}, r, {
                produto: d.produto || r.produto || '',
                descricao: d.descricao || r.descricao || '',
                qtd_esperada: d.qtd_esperada != null ? d.qtd_esperada : r.qtd_esperada,
                qtd_primeira: d.qtd_contada != null ? d.qtd_contada : r.qtd_primeira
            });
            if (JSON.stringify(atualizado) !== JSON.stringify(r)) {
                houveRecAtualizada = true;
                fsSalvarRecontagem(atualizado);
            }
            return atualizado;
        });
        novasRecs.forEach(function (r) {
            var idx = recsFinais.findIndex(function (x) { return x.id === r.id; });
            if (idx >= 0)
                recsFinais[idx] = r;
            else
                recsFinais.push(r);
        });
        if (novasRecs.length > 0 || houveRecAtualizada) {
            batchActions.push(Actions.replaceSlice('recontagens', recsFinais, BIZMETA));
        }
        Store.dispatch(Actions.batch(batchActions, BIZMETA));
        if (typeof logSistema === 'function')
            logSistema('DIVERGENCIA', "".concat(novos, " diverg\u00EAncias processadas"), { inventario_id: invId });
        if (typeof showToast === 'function')
            showToast(novos > 0 ? "\u26A0\uFE0F ".concat(novos, " diverg\u00EAncias encontradas!") : '✅ Nenhuma nova divergência encontrada', novos > 0 ? 'w' : 's');
        return novos;
    }
    // ── Helper: criar recontagem para divergência (sem mutação, acumula em array) ──
    function _criarRecontagemParaDivergencia(div, inv, qtdCont, novasRecs) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        if (DivSvc.isFluxoEncerrado(div)) {
            dbg('[Rec] Criação bloqueada — fluxo encerrado:', div.endereco, div.status);
            return;
        }
        if (DivSvc.obterRecontagemAtivaPorDivergencia(div.id)) {
            dbg('[Rec] Bloqueado — rec ativa já existe:', div.endereco);
            return;
        }
        var recsAnt = state().recontagens
            .filter(function (r) { return r.divergencia_id === div.id && r.status === 'CONCLUIDA'; })
            .sort(function (a, b) { return (a.numero_recontagem || 1) - (b.numero_recontagem || 1); });
        var ultimaRec = recsAnt[recsAnt.length - 1] || null;
        var numeroNovaRec = ultimaRec ? (ultimaRec.numero_recontagem || 1) + 1 : 1;
        if (numeroNovaRec > MAX_CONTAGENS) {
            dbg('[Rec] Bloqueado — MAX_CONTAGENS atingido:', div.endereco, numeroNovaRec);
            return;
        }
        var qtd1 = (_a = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.qtd_primeira) !== null && _a !== void 0 ? _a : qtdCont;
        var prod1 = (_b = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.produto_primeira) !== null && _b !== void 0 ? _b : (div.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE' ? 'VAZIO' : _nd(div.produto));
        var rec = {
            id: gerarId('REC'), divergencia_id: div.id,
            inventario_id: inv.id, inventario_nome: inv.nome,
            endereco: div.endereco, produto: div.produto, descricao: div.descricao,
            qtd_esperada: div.qtd_esperada,
            qtd_primeira: qtd1, produto_primeira: prod1,
            qtd_segunda: (_c = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.qtd_segunda) !== null && _c !== void 0 ? _c : null, produto_segunda: (_d = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.produto_segunda) !== null && _d !== void 0 ? _d : null,
            qtd_terceira: null, produto_terceira: null,
            operador_primeira: (_e = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.operador_primeira) !== null && _e !== void 0 ? _e : null,
            operador_segunda: (_f = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.operador_segunda) !== null && _f !== void 0 ? _f : null,
            operador_terceira: null,
            data_primeira: (_g = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.data_primeira) !== null && _g !== void 0 ? _g : null,
            data_segunda: (_h = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.data_segunda) !== null && _h !== void 0 ? _h : null,
            data_terceira: null,
            numero_recontagem: numeroNovaRec,
            historico_recontagens: __spreadArray([], ((ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.historico_recontagens) || []), true),
            contagem_original_uuid: (_j = ultimaRec === null || ultimaRec === void 0 ? void 0 : ultimaRec.contagem_original_uuid) !== null && _j !== void 0 ? _j : null,
            qtd_recontagem: null, produto_recontagem: null, operador: null,
            status: 'PENDENTE', status_recontagem: 'pendente',
            criada_em: new Date().toISOString(), concluida_em: null, observacao: '',
            criada_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'sistema',
        };
        // Vincular contagem original
        var contOriginal = state().contagens.find(function (c) {
            return String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') === String(inv.id) &&
                _nd(c.endereco) === _nd(div.endereco) &&
                (_nd(c.codigo_produto) === _nd(div.produto) || _nd(c.gtin) === _nd(div.produto)) &&
                !c._excluida && c.status !== 'ESTORNADA';
        });
        if (contOriginal) {
            rec.contagem_original_uuid = contOriginal.uuid || String(contOriginal.id);
            rec.operador_primeira = contOriginal.operador || null;
            rec.coletor_id_primeira = contOriginal.coletor_id || null;
            rec.data_primeira = contOriginal.dataHora || contOriginal.criado_em || null;
        }
        novasRecs.push(rec);
        fsSalvarRecontagem(rec);
    }
    // ─────────────────────────────────────────────────────────────────────────────
    //  corrigirOrfas — remove recontagens sem divergência vinculada
    // ─────────────────────────────────────────────────────────────────────────────
    function corrigirOrfas() {
        var divIds = new Set(state().divergencias.map(function (d) { return d.id; }));
        var orfas = state().recontagens.filter(function (r) { return r.divergencia_id && !divIds.has(r.divergencia_id); });
        if (!orfas.length)
            return 0;
        var novasRecs = state().recontagens.filter(function (r) { return !orfas.includes(r); });
        Store.dispatch(Actions.replaceSlice('recontagens', novasRecs, BIZMETA));
        dbg('[CorrigirOrfas] removidas:', orfas.length);
        return orfas.length;
    }
    // ─────────────────────────────────────────────────────────────────────────────
    //  10. RECONTAGENS
    // ─────────────────────────────────────────────────────────────────────────────
    function abrirRegistrarRecontagem(recId) {
        return __awaiter(this, void 0, void 0, function () {
            var recontagemCtx, _numAtual, _fmt, _row, ctx, historico, _recProdEl, _recProdInfo, selOp, opt;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        recontagemCtx = state().recontagens.find(function (r) { return r.id === recId; }) || null;
                        Store.dispatch(Actions.setPath('ui.recontagemCtx', recontagemCtx, { source: 'abrirRegistrarRecontagem' }));
                        if (!recontagemCtx)
                            return [2 /*return*/];
                        if (DivSvc.isFluxoEncerrado(recontagemCtx)) {
                            showToast('🔒 Fluxo encerrado — não é possível registrar nova contagem para este endereço.', 'e');
                            return [2 /*return*/];
                        }
                        _numAtual = recontagemCtx.numero_recontagem || 1;
                        if (_numAtual >= MAX_CONTAGENS && recontagemCtx.qtd_terceira != null) {
                            showToast("\u26D4 Limite de ".concat(MAX_CONTAGENS, " contagens atingido para este endere\u00E7o. Diverg\u00EAncia finalizada."), 'w');
                            return [2 /*return*/];
                        }
                        _fmt = function (v) { return (v != null) ? "<b style=\"color:var(--warn)\">".concat(v, "</b>") : "<span style=\"color:var(--muted)\">\u2014</span>"; };
                        _row = function (label, val, op) { return "\n      <div style=\"display:flex;justify-content:space-between;align-items:flex-start;padding:6px 10px;background:var(--card);border-radius:8px;gap:8px\">\n        <span style=\"font-size:.68rem;color:var(--muted);text-transform:uppercase;font-weight:700;white-space:nowrap\">".concat(label, "</span>\n        <span style=\"font-family:var(--mono);font-weight:800;font-size:.95rem\">").concat(_fmt(val), "</span>\n        ").concat(op ? "<span style=\"font-size:.68rem;color:var(--muted);white-space:nowrap\">\uD83D\uDC64 ".concat(op, "</span>") : '', "\n      </div>"); };
                        ctx = state().ui.recontagemCtx;
                        historico = (ctx.historico_recontagens || []).map(function (h, i) { return _row("Contagem ".concat(i + 2), h.qtd, h.operador); }).join('');
                        document.getElementById('rec-modal-info').innerHTML = "\n      <div style=\"display:flex;flex-direction:column;gap:5px;margin-bottom:6px\">\n        <div style=\"display:grid;grid-template-columns:1fr 1fr;gap:6px\">\n          <div><div style=\"font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--muted)\">Endere\u00E7o</div>\n               <div style=\"font-family:var(--mono);font-weight:700\">".concat(ctx.endereco, "</div></div>\n          <div><div style=\"font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--muted)\">Produto</div>\n               <div style=\"font-weight:600;font-size:.82rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">").concat(ctx.produto, "</div></div>\n        </div>\n        <div style=\"border-top:1px solid var(--border);padding-top:6px;display:flex;flex-direction:column;gap:4px\">\n          <div style=\"font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:2px\">Hist\u00F3rico de contagens</div>\n          ").concat(_row('Sistema (esperado)', ctx.qtd_esperada), "\n          ").concat(_row('1ª Contagem', ctx.qtd_primeira, ctx.operador_primeira), "\n          ").concat(ctx.qtd_segunda != null ? _row('2ª Contagem', ctx.qtd_segunda, ctx.operador_segunda) : '', "\n          ").concat(ctx.qtd_terceira != null ? _row('3ª Contagem', ctx.qtd_terceira, ctx.operador_terceira) : '', "\n          ").concat(historico, "\n        </div>\n        ").concat(ctx.operador ? "<div style=\"padding:5px 10px;background:rgba(232,117,26,.08);border-radius:8px;font-size:.72rem\">\uD83D\uDC64 Atribu\u00EDdo para: <b>".concat(ctx.operador, "</b></div>") : '', "\n        ").concat(ctx.observacao_atribuicao ? "<div style=\"padding:5px 10px;background:rgba(255,179,0,.06);border:1px solid rgba(255,179,0,.2);border-radius:8px;font-size:.72rem;color:#fbbf24\">\uD83D\uDCAC ".concat(ctx.observacao_atribuicao, "</div>") : '', "\n      </div>");
                        _recProdEl = document.getElementById('rec-produto');
                        if (_recProdEl) {
                            _recProdEl.value = '';
                            _recProdEl.placeholder = ctx.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE'
                                ? 'VAZIO' : _nd(ctx.produto) || 'Código do produto bipado';
                        }
                        _recProdInfo = document.getElementById('rec-produto-info');
                        if (_recProdInfo) {
                            _recProdInfo.textContent = ctx.produto
                                ? "Esperado: ".concat(_nd(ctx.produto)).concat(ctx.descricao ? ' — ' + ctx.descricao : '') : '';
                        }
                        openModal('modal-reg-recontagem');
                        document.getElementById('rec-qtd').value = '';
                        document.getElementById('rec-obs').value = ctx.observacao || '';
                        return [4 /*yield*/, divPopularSelectOperadores('rec-operador')];
                    case 1:
                        _a.sent();
                        selOp = document.getElementById('rec-operador');
                        if (selOp && ctx.operador) {
                            opt = __spreadArray([], selOp.options, true).find(function (o) { return o.value === ctx.operador; });
                            if (opt)
                                selOp.value = ctx.operador;
                        }
                        return [2 /*return*/];
                }
            });
        });
    }
    // ── Helpers de validação ─────────────────────────────────────────────────────
    var _PROD_VAZIO = 'VAZIO';
    function _normProduto(v) {
        return String(v || '').trim().toUpperCase().replace(/\s+/g, ' ') || null;
    }
    function _normQtd(v) {
        var n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    function _resolveDivergenciaCompleta(novaQtd, novoProduto, recCtx) {
        var qtdAtual = _normQtd(novaQtd);
        var prodAtual = _normProduto(novoProduto);
        if (qtdAtual === null || !prodAtual)
            return { resolveu: false, referencia: null };
        var referencias = __spreadArray([
            { origem: 'SISTEMA', qtd: _normQtd(recCtx.qtd_esperada), produto: _normProduto(recCtx.produto) },
            { origem: 'CONTAGEM_1', qtd: _normQtd(recCtx.qtd_primeira), produto: _normProduto(recCtx.produto_primeira || recCtx.produto) },
            { origem: 'CONTAGEM_2', qtd: _normQtd(recCtx.qtd_segunda), produto: _normProduto(recCtx.produto_segunda) },
            { origem: 'CONTAGEM_3', qtd: _normQtd(recCtx.qtd_terceira), produto: _normProduto(recCtx.produto_terceira) }
        ], (recCtx.historico_recontagens || []).map(function (h, i) { return ({
            origem: "HISTORICO_".concat(i + 1), qtd: _normQtd(h.qtd), produto: _normProduto(h.produto),
        }); }), true).filter(function (r) { return r.qtd !== null && r.produto; });
        for (var _i = 0, referencias_1 = referencias; _i < referencias_1.length; _i++) {
            var ref = referencias_1[_i];
            if (qtdAtual === ref.qtd && prodAtual === ref.produto) {
                dbg('[Resolve] ✅ Bate com', ref.origem, '| qtd=', qtdAtual, 'prod=', prodAtual);
                return { resolveu: true, referencia: ref.origem };
            }
        }
        dbg('[Resolve] ❌ Não resolve | qtd=', qtdAtual, 'prod=', prodAtual);
        return { resolveu: false, referencia: null };
    }
    // ── aplicarResultadoRecontagem — imutável ────────────────────────────────────
    function aplicarResultadoRecontagem(recCtx, qtd, produto, operador, agora, decisao) {
        var numeroAtual = Number(recCtx.numero_recontagem || 1);
        // Campos comuns da rodada
        var updatedRec = Object.assign({}, recCtx, {
            qtd_recontagem: qtd, produto_recontagem: produto,
            operador: operador,
            status: 'CONCLUIDA', concluida_em: agora, status_recontagem: 'concluida',
            operador_recontagem: operador || recCtx.operador_recontagem || ''
        });
        if (numeroAtual === 1) {
            updatedRec = Object.assign({}, updatedRec, { qtd_segunda: qtd, produto_segunda: produto, operador_segunda: operador, data_segunda: agora });
        }
        else if (numeroAtual >= 2) {
            updatedRec = Object.assign({}, updatedRec, { qtd_terceira: qtd, produto_terceira: produto, operador_terceira: operador, data_terceira: agora });
        }
        var div = state().divergencias.find(function (d) { return d.id === recCtx.divergencia_id; });
        if (!div) {
            fsSalvarRecontagem(updatedRec);
            Store.dispatch(Actions.batch([
                Actions.upsertEntity('recontagens', updatedRec, BIZMETA),
                Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
            ], BIZMETA));
            return;
        }
        var updatedDiv = Object.assign({}, div, { qtd_recontagem: qtd, produto_recontagem: produto });
        if (numeroAtual === 1) {
            updatedDiv = Object.assign({}, updatedDiv, { qtd_segunda: qtd, produto_segunda: produto, operador_segunda: operador, data_segunda: agora });
        }
        else if (numeroAtual >= 2) {
            updatedDiv = Object.assign({}, updatedDiv, { qtd_terceira: qtd, produto_terceira: produto, operador_terceira: operador, data_terceira: agora });
        }
        // ── RESOLVIDA ──
        if (decisao.resolveu) {
            updatedDiv = Object.assign({}, updatedDiv, {
                status: 'RESOLVIDA', status_recontagem: 'sem_divergencia',
                resolvida_em: agora, resolvida_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'Analista',
                qtd_resultado_final: qtd, produto_resultado_final: produto,
                contagem_aceita: decisao.referencia,
                divergencia_resolvida: true, encerrada_definitivamente: true,
                operador_responsavel: null, status_bloqueio: null
            });
            updatedRec = Object.assign({}, updatedRec, {
                divergencia_resolvida: true, encerrada_definitivamente: true,
                contagem_aceita: decisao.referencia, status_recontagem: 'sem_divergencia', operador: null
            });
            fsSalvarDivergencia(updatedDiv);
            fsSalvarRecontagem(updatedRec);
            Store.dispatch(Actions.batch([
                Actions.upsertEntity('divergencias', updatedDiv, BIZMETA),
                Actions.upsertEntity('recontagens', updatedRec, BIZMETA),
                Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
            ], BIZMETA));
            showToast('✅ Divergência resolvida — contagem confirmada!', 's');
            return;
        }
        // ── PERSISTENTE (3ª rodada sem consenso) ──
        if (numeroAtual >= 2) {
            updatedDiv = Object.assign({}, updatedDiv, {
                status: 'PERSISTENTE', status_bloqueio: 'PERSISTENTE_BLOQUEADO', status_recontagem: 'concluida',
                divergencia_resolvida: false, encerrada_definitivamente: true,
                resolvida_em: agora, resolvida_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'Analista',
                qtd_resultado_final: qtd, contagem_aceita: 'TERCEIRA_SEM_CONSENSO'
            });
            updatedRec = Object.assign({}, updatedRec, {
                divergencia_resolvida: false, encerrada_definitivamente: true, contagem_aceita: 'TERCEIRA_SEM_CONSENSO'
            });
            var updatedRecontagens = state().recontagens.map(function (r) {
                if (r.id === updatedRec.id)
                    return updatedRec;
                if (r.inventario_id !== div.inventario_id)
                    return r;
                if (_nd(r.endereco) !== _nd(div.endereco))
                    return r;
                if (r.status === 'CONCLUIDA' || r.status === 'CANCELADA')
                    return r;
                var cancelada = Object.assign({}, r, {
                    status: 'CANCELADA', status_recontagem: 'cancelada',
                    cancelada_em: agora, cancelada_motivo: 'PERSISTENTE_BLOQUEADO'
                });
                fsSalvarRecontagem(cancelada);
                return cancelada;
            });
            fsSalvarDivergencia(updatedDiv);
            Store.dispatch(Actions.batch([
                Actions.upsertEntity('divergencias', updatedDiv, BIZMETA),
                Actions.replaceSlice('recontagens', updatedRecontagens, BIZMETA),
                Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
            ], BIZMETA));
            showToast("\uD83D\uDD34 Diverg\u00EAncia PERSISTENTE em ".concat(div.endereco, ". Nenhuma das ").concat(numeroAtual + 1, " contagens chegou a consenso."), 'e');
            return;
        }
        // ── 2ª rodada sem consenso → criar 3ª recontagem ──
        updatedDiv = Object.assign({}, updatedDiv, {
            status_recontagem: 'aguardando_analista', operador_responsavel: null, status: 'EM_RECONTAGEM',
            qtd_segunda: qtd, produto_segunda: produto, operador_segunda: operador, data_segunda: agora
        });
        var _proxNum = numeroAtual + 1;
        if (_proxNum <= MAX_CONTAGENS) {
            var qtdEspLog = Number(recCtx.qtd_esperada);
            var qtdPrimLog = Number(recCtx.qtd_primeira);
            var rec3_1 = {
                id: gerarId('REC'), divergencia_id: div.id,
                inventario_id: recCtx.inventario_id, inventario_nome: recCtx.inventario_nome,
                endereco: recCtx.endereco, produto: recCtx.produto, descricao: recCtx.descricao,
                qtd_esperada: recCtx.qtd_esperada,
                qtd_primeira: recCtx.qtd_primeira, produto_primeira: _nd(recCtx.produto_primeira || recCtx.produto),
                qtd_segunda: qtd, produto_segunda: produto,
                qtd_terceira: null, produto_terceira: null,
                operador_primeira: recCtx.operador_primeira, operador_segunda: operador, operador_terceira: null,
                data_segunda: agora, data_terceira: null,
                numero_recontagem: _proxNum, tipo: _proxNum >= MAX_CONTAGENS ? 'TERCEIRA_CONTAGEM' : 'RECONTAGEM',
                historico_recontagens: __spreadArray(__spreadArray([], (recCtx.historico_recontagens || []), true), [
                    { numero: 1, qtd: qtd, produto: produto, operador: operador, data: agora },
                ], false),
                contagem_original_uuid: recCtx.contagem_original_uuid,
                qtd_recontagem: null, produto_recontagem: null, operador: null,
                status: 'PENDENTE', status_recontagem: 'pendente',
                criada_em: agora, concluida_em: null,
                observacao: "".concat(_proxNum, "\u00AA contagem necess\u00E1ria \u2014 2\u00AA n\u00E3o confirmou. 1\u00AA=").concat(isFinite(qtdPrimLog) ? qtdPrimLog : '—', "(").concat(_nd(recCtx.produto_primeira || recCtx.produto), ") | 2\u00AA=").concat(qtd, "(").concat(produto, ") | sistema=").concat(isFinite(qtdEspLog) ? qtdEspLog : '—', "(").concat(_nd(recCtx.produto), ")"),
                criada_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'analista',
            };
            var recsAtualizadas = state().recontagens.map(function (r) { return r.id === updatedRec.id ? updatedRec : r; });
            if (!recsAtualizadas.find(function (r) { return r.id === rec3_1.id; }))
                recsAtualizadas.push(rec3_1);
            fsSalvarRecontagem(rec3_1);
            fsSalvarDivergencia(updatedDiv);
            Store.dispatch(Actions.batch([
                Actions.upsertEntity('divergencias', updatedDiv, BIZMETA),
                Actions.replaceSlice('recontagens', recsAtualizadas, BIZMETA),
                Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
            ], BIZMETA));
            showToast("\u26A0\uFE0F 2\u00AA contagem (".concat(qtd, ") sem consenso. ").concat(_proxNum, "\u00AA recontagem criada!"), 'w');
        }
        else {
            finalizarComoPersistente(updatedRec, agora);
            showToast("\uD83D\uDD34 Limite de ".concat(MAX_CONTAGENS, " contagens atingido \u2014 diverg\u00EAncia finalizada como PERSISTENTE."), 'w');
        }
        fsSalvarDivergencia(updatedDiv);
    }
    // ── confirmarRecontagem ──────────────────────────────────────────────────────
    function confirmarRecontagem() {
        var _a, _b;
        var ctx = state().ui.recontagemCtx;
        if (!ctx)
            return;
        if (DivSvc.isFluxoEncerrado(ctx)) {
            showToast('🔒 Endereço com fluxo encerrado — não é possível registrar nova contagem.', 'e');
            closeModal('modal-reg-recontagem');
            return;
        }
        var _numManual = ctx.numero_recontagem || 1;
        if (_numManual > MAX_CONTAGENS) {
            showToast("\u26D4 Limite de ".concat(MAX_CONTAGENS, " contagens atingido. Registre como PERSISTENTE."), 'w');
            closeModal('modal-reg-recontagem');
            finalizarComoPersistente(ctx);
            return;
        }
        var selOp = document.getElementById('rec-operador');
        var operador = ((selOp === null || selOp === void 0 ? void 0 : selOp.value) || ((_a = selOp === null || selOp === void 0 ? void 0 : selOp.querySelector('option:checked')) === null || _a === void 0 ? void 0 : _a.text) || '').trim();
        var qtd = parseFloat(document.getElementById('rec-qtd').value);
        var produto = (((_b = document.getElementById('rec-produto')) === null || _b === void 0 ? void 0 : _b.value) || '').trim().toUpperCase();
        if (!operador) {
            showToast('Selecione o operador', 'e');
            return;
        }
        if (isNaN(qtd)) {
            showToast('Informe a quantidade', 'e');
            return;
        }
        if (!produto) {
            showToast('Informe o código do produto bipado', 'e');
            return;
        }
        var agora = new Date().toISOString();
        // Passo 1: capturar decisão ANTES de qualquer escrita
        var decisao = _resolveDivergenciaCompleta(qtd, produto, ctx);
        // Passo 2: guardar histórico da rodada anterior
        var historicoAtual = Array.isArray(ctx.historico_recontagens) ? __spreadArray([], ctx.historico_recontagens, true) : [];
        if (ctx.qtd_recontagem != null) {
            historicoAtual.push({
                numero: ctx.numero_recontagem, qtd: ctx.qtd_recontagem,
                produto: ctx.produto_recontagem || null,
                operador: ctx.operador, data: ctx.concluida_em || agora,
            });
        }
        // Atualizar histórico e observação no ctx antes de passar para aplicarResultado
        var ctxComHistorico = Object.assign({}, ctx, {
            historico_recontagens: historicoAtual,
            observacao: document.getElementById('rec-obs').value.trim()
        });
        Store.dispatch(Actions.setPath('ui.recontagemCtx', ctxComHistorico, BIZMETA));
        // Passo 3: aplicar resultado (despacha as alterações finais)
        aplicarResultadoRecontagem(ctxComHistorico, qtd, produto, operador, agora, decisao);
        // Log e fechar modal — salvamento de cache fica a cargo do AppController
        if (typeof logSistema === 'function') {
            var rec = state().ui.recontagemCtx;
            logSistema('RECONTAGEM_CONCLUIDA', "Recontagem ".concat(rec.id, " \u2014 qtd: ").concat(qtd, " prod: ").concat(produto, " \u2014 resolveu: ").concat(decisao.resolveu), {
                id: rec.id, divergencia_id: rec.divergencia_id, endereco: rec.endereco,
                produto_esperado: rec.produto, produto_contado: produto,
                qtd_esperada: rec.qtd_esperada, resultado_final: rec.resultado_final,
                numero_recontagem: _numManual, resolve: decisao.resolveu,
                operador: operador,
            });
        }
        closeModal('modal-reg-recontagem');
    }
    // ─────────────────────────────────────────────────────────────────────────────
    //  atribuirRecontagemSegura (migrado de 01-core-base-storage)
    //  Usa dispatch imutável — sem mutação direta em d ou recAtiva.
    // ─────────────────────────────────────────────────────────────────────────────
    function atribuirRecontagemSegura(d, operador, atribPor, obs, agora) {
        var _a, _b;
        if (!d)
            return null;
        agora = agora || new Date().toISOString();
        if (DivSvc.isFluxoEncerrado(d)) {
            showToast("\uD83D\uDD12 ".concat(d.endereco, " j\u00E1 est\u00E1 encerrado. N\u00E3o \u00E9 poss\u00EDvel atribuir."), 'e');
            return null;
        }
        var recAtiva = DivSvc.obterRecontagemAtivaPorDivergencia(d.id);
        if (recAtiva) {
            if (!recAtiva.operador) {
                var updatedRecAtiva = Object.assign({}, recAtiva, {
                    operador: operador,
                    atribuido_por: atribPor, atribuido_em: agora,
                    status_recontagem: 'pendente', observacao_atribuicao: obs || ''
                });
                var updatedD_1 = Object.assign({}, d, {
                    operador_responsavel: operador, atribuido_por: atribPor,
                    atribuido_em: agora, status_recontagem: 'pendente'
                });
                fsSalvarRecontagem(updatedRecAtiva).catch(function () { });
                fsSalvarDivergencia(updatedD_1).catch(function () { });
                Store.dispatch(Actions.batch([
                    Actions.upsertEntity('recontagens', updatedRecAtiva, { source: 'atribuirRecontagemSegura' }),
                    Actions.upsertEntity('divergencias', updatedD_1, { source: 'atribuirRecontagemSegura' })
                ], { source: 'atribuirRecontagemSegura' }));
                dbg('[Atribuir] Operador atribuído ao rec existente:', updatedRecAtiva.id, operador);
                return updatedRecAtiva;
            }
            showToast("\u26A0\uFE0F ".concat(d.endereco, " j\u00E1 possui recontagem pendente atribu\u00EDda a ").concat(recAtiva.operador, ". Aguarde a conclus\u00E3o."), 'w');
            return null;
        }
        var recConcluida = state().recontagens.find(function (r) {
            return r.divergencia_id === d.id && r.status === 'CONCLUIDA' && !DivSvc.isFluxoEncerrado(r);
        });
        if (recConcluida && d.status_recontagem !== 'aguardando_analista') {
            showToast("\uD83D\uDD12 ".concat(d.endereco, " j\u00E1 possui recontagem conclu\u00EDda. O analista deve decidir manualmente o pr\u00F3ximo passo."), 'e');
            return null;
        }
        var numeroAtualRec = Number(state().recontagens.filter(function (r) { return r.divergencia_id === d.id; })
            .reduce(function (max, r) { return Math.max(max, r.numero_recontagem || 1); }, 0));
        if (numeroAtualRec >= MAX_CONTAGENS) {
            showToast("\uD83D\uDD12 ".concat(d.endereco, " j\u00E1 atingiu o limite de ").concat(MAX_CONTAGENS, " contagens."), 'e');
            return null;
        }
        var updatedD = Object.assign({}, d, {
            operador_responsavel: operador,
            atribuido_por: atribPor,
            atribuido_em: agora,
            status: d.status === 'ABERTA' ? 'EM_RECONTAGEM' : d.status,
            status_recontagem: 'pendente',
            observacao_atribuicao: obs || ''
        });
        var rec = {
            id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            divergencia_id: d.id, inventario_id: d.inventario_id, inventario_nome: d.inventario_nome,
            endereco: d.endereco, produto: d.produto, descricao: d.descricao,
            qtd_esperada: d.qtd_esperada,
            qtd_primeira: d.qtd_contada,
            produto_primeira: _nd(d.produto_contado || d.produto),
            qtd_segunda: (_a = d.qtd_segunda) !== null && _a !== void 0 ? _a : null, produto_segunda: (_b = d.produto_segunda) !== null && _b !== void 0 ? _b : null,
            operador_primeira: d.operador || null, operador_segunda: d.operador_segunda || null,
            data_segunda: d.data_segunda || null,
            qtd_recontagem: null, produto_recontagem: null,
            operador: operador,
            atribuido_por: atribPor, atribuido_em: agora,
            status: 'PENDENTE', status_recontagem: 'pendente',
            observacao_atribuicao: obs || '',
            criada_em: agora, numero_recontagem: numeroAtualRec + 1,
        };
        Store.dispatch(Actions.batch([
            Actions.upsertEntity('divergencias', updatedD, { source: 'atribuirRecontagemSegura' }),
            Actions.upsertEntity('recontagens', rec, { source: 'atribuirRecontagemSegura' })
        ], { source: 'atribuirRecontagemSegura' }));
        fsSalvarDivergencia(updatedD).catch(function () { });
        fsSalvarRecontagem(rec).catch(function () { });
        return rec;
    }
    // ─────────────────────────────────────────────────────────────────────────────
    //  Registro do runtime — ativa o DivergenciaService.processarDivergencias
    // ─────────────────────────────────────────────────────────────────────────────
    global.AnalistaDivergenciasRuntime = {
        processar: processarDivergencias,
        corrigirOrfas: corrigirOrfas
    };
    // Exportações globais para chamadas via onclick no HTML e outros módulos
    global.processarDivergencias = processarDivergencias;
    global.confirmarRecontagem = confirmarRecontagem;
    global.abrirRegistrarRecontagem = abrirRegistrarRecontagem;
    global.atribuirRecontagemSegura = atribuirRecontagemSegura;
    global.finalizarComoPersistente = finalizarComoPersistente;
    // Registrar AnalistaRecontagemService para o alias em 01-core-base-storage
    global.AnalistaRecontagemService = { atribuirRecontagemSegura: atribuirRecontagemSegura };
})(window);
