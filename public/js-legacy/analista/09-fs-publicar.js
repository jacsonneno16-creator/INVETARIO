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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
(function (global) {
    function state() { return global.AnalistaStore.getState(); }
    // ── PUBLICAÇÃO NO FIRESTORE (analista → coletor) ────────────────────
    // Estas funções publicam dados do analista no Firestore para que os
    // coletores possam baixá-los. Chamadas após criação/atualização de dados.
    /**
     * Publica um inventário no Firestore (dt_inventarios).
     * O coletor baixa esta coleção para listar inventários disponíveis.
     */
    function fsPublicarInventario(inv) {
        return __awaiter(this, void 0, void 0, function () {
            var base, invSemBase, _baseLen, _baseChunkSize, CHUNK, chunksColl, oldChunks, _loop_1, i, i, batch, chunkRef, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!navigator.onLine || !inv || !inv.id)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 13, , 14]);
                        base = inv.base, invSemBase = __rest(inv, ["base"]);
                        _baseLen = Array.isArray(base) ? base.length : 0;
                        _baseChunkSize = 1000;
                        return [4 /*yield*/, FS_AN.collection('dt_inventarios').doc(inv.id).set(__assign(__assign({}, invSemBase), { base_chunks: _baseLen ? Math.ceil(_baseLen / _baseChunkSize) : (invSemBase.base_chunks || 0), base_chunk_size: _baseChunkSize, base_publicada_em: new Date() }), { merge: true })];
                    case 2:
                        _a.sent();
                        if (!(Array.isArray(base) && base.length > 0)) return [3 /*break*/, 12];
                        CHUNK = 1000;
                        chunksColl = FS_AN.collection('dt_inventarios').doc(inv.id).collection('base_chunks');
                        return [4 /*yield*/, chunksColl.get().catch(function () { return null; })];
                    case 3:
                        oldChunks = _a.sent();
                        if (!(oldChunks && !oldChunks.empty)) return [3 /*break*/, 7];
                        _loop_1 = function (i) {
                            var delBatch;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        delBatch = FS_AN.batch();
                                        oldChunks.docs.slice(i, i + 400).forEach(function (doc) { return delBatch.delete(doc.ref); });
                                        return [4 /*yield*/, delBatch.commit()];
                                    case 1:
                                        _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 4;
                    case 4:
                        if (!(i < oldChunks.docs.length)) return [3 /*break*/, 7];
                        return [5 /*yield**/, _loop_1(i)];
                    case 5:
                        _a.sent();
                        _a.label = 6;
                    case 6:
                        i += 400;
                        return [3 /*break*/, 4];
                    case 7:
                        i = 0;
                        _a.label = 8;
                    case 8:
                        if (!(i < Math.ceil(base.length / CHUNK))) return [3 /*break*/, 11];
                        batch = FS_AN.batch();
                        chunkRef = chunksColl.doc(String(i).padStart(4, '0'));
                        batch.set(chunkRef, { itens: base.slice(i * CHUNK, (i + 1) * CHUNK), parte: i, chunk: i, chunk_size: CHUNK });
                        return [4 /*yield*/, batch.commit()];
                    case 9:
                        _a.sent();
                        _a.label = 10;
                    case 10:
                        i++;
                        return [3 /*break*/, 8];
                    case 11:
                        dbg('[fsPublicarInventario] base publicada:', base.length, 'registros em', Math.ceil(base.length / CHUNK), 'chunks');
                        _a.label = 12;
                    case 12:
                        dbg('[fsPublicarInventario] ✅', inv.id, inv.nome);
                        return [3 /*break*/, 14];
                    case 13:
                        e_1 = _a.sent();
                        console.error('[fsPublicarInventario] erro:', e_1.message);
                        throw e_1;
                    case 14: return [2 /*return*/];
                }
            });
        });
    }
    /**
     * Publica endereços do ENDDB no Firestore (dt_locais).
     * Usa batch para eficiência (max 500 ops por batch).
     */
    function fsPublicarEnderecos() {
        return __awaiter(this, void 0, void 0, function () {
            var lista, CHUNK_SIZE, chunksColl, listaNormalizada, oldLocalChunks, _loop_2, i, i, parte, BATCH_SIZE, _loop_3, i, versao, e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!navigator.onLine)
                            return [2 /*return*/];
                        lista = state().enderecosLista || [];
                        if (!lista.length)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 16, , 17]);
                        CHUNK_SIZE = 1000;
                        chunksColl = FS_AN.collection('dt_locais_chunks');
                        listaNormalizada = lista
                            .filter(function (end) { return end && end.endereco; })
                            .map(function (end) {
                            var _a;
                            return ({
                                endereco: end.endereco,
                                ativo: end.ativo !== false,
                                capacidade_paletes: (_a = end.capacidade_paletes) !== null && _a !== void 0 ? _a : null,
                                nome_local: end.nome_local || end.local || '',
                                setor: end.setor || end.local || '',
                                tipo: end.tipo || '',
                                rua: end.rua || '',
                            });
                        });
                        return [4 /*yield*/, chunksColl.get().catch(function () { return null; })];
                    case 2:
                        oldLocalChunks = _a.sent();
                        if (!(oldLocalChunks && !oldLocalChunks.empty)) return [3 /*break*/, 6];
                        _loop_2 = function (i) {
                            var delBatch;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        delBatch = FS_AN.batch();
                                        oldLocalChunks.docs.slice(i, i + 400).forEach(function (doc) { return delBatch.delete(doc.ref); });
                                        return [4 /*yield*/, delBatch.commit()];
                                    case 1:
                                        _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 3;
                    case 3:
                        if (!(i < oldLocalChunks.docs.length)) return [3 /*break*/, 6];
                        return [5 /*yield**/, _loop_2(i)];
                    case 4:
                        _a.sent();
                        _a.label = 5;
                    case 5:
                        i += 400;
                        return [3 /*break*/, 3];
                    case 6:
                        i = 0;
                        _a.label = 7;
                    case 7:
                        if (!(i < listaNormalizada.length)) return [3 /*break*/, 10];
                        parte = Math.floor(i / CHUNK_SIZE);
                        return [4 /*yield*/, chunksColl.doc(String(parte).padStart(4, '0')).set({
                                parte: parte,
                                chunk_size: CHUNK_SIZE,
                                total_registros: listaNormalizada.length,
                                dados: listaNormalizada.slice(i, i + CHUNK_SIZE),
                                atualizado_em: new Date()
                            }, { merge: true })];
                    case 8:
                        _a.sent();
                        _a.label = 9;
                    case 9:
                        i += CHUNK_SIZE;
                        return [3 /*break*/, 7];
                    case 10:
                        BATCH_SIZE = 400;
                        _loop_3 = function (i) {
                            var lote, batch;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        lote = listaNormalizada.slice(i, i + BATCH_SIZE);
                                        batch = FS_AN.batch();
                                        lote.forEach(function (end) {
                                            var ref = FS_AN.collection('dt_locais').doc(String(end.endereco).trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '_'));
                                            batch.set(ref, end, { merge: true });
                                        });
                                        return [4 /*yield*/, batch.commit()];
                                    case 1:
                                        _c.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 11;
                    case 11:
                        if (!(i < listaNormalizada.length)) return [3 /*break*/, 14];
                        return [5 /*yield**/, _loop_3(i)];
                    case 12:
                        _a.sent();
                        _a.label = 13;
                    case 13:
                        i += BATCH_SIZE;
                        return [3 /*break*/, 11];
                    case 14:
                        versao = String(Date.now());
                        return [4 /*yield*/, FS_AN.collection('dt_locais_meta').doc('versao').set({
                                versao: versao,
                                atualizado_em: new Date(),
                                chunk_size: CHUNK_SIZE,
                                chunks: Math.ceil(listaNormalizada.length / CHUNK_SIZE),
                                total: listaNormalizada.length,
                                origem: 'dt_locais_chunks'
                            })];
                    case 15:
                        _a.sent();
                        dbg('[fsPublicarEnderecos] ✅', listaNormalizada.length, 'endereços publicados em chunks de', CHUNK_SIZE, 'ver:', versao);
                        return [3 /*break*/, 17];
                    case 16:
                        e_2 = _a.sent();
                        console.error('[fsPublicarEnderecos] erro:', e_2.message);
                        return [3 /*break*/, 17];
                    case 17: return [2 /*return*/];
                }
            });
        });
    }
    /**
     * Publica lista de produtos no Firestore (dt_produtos).
     * O coletor usa esta coleção para identificar GTINs/códigos.
     */
    function fsPublicarProdutos(produtos) {
        return __awaiter(this, void 0, void 0, function () {
            var BATCH_SIZE, _loop_4, i, e_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!navigator.onLine || !Array.isArray(produtos) || !produtos.length)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 6, , 7]);
                        BATCH_SIZE = 400;
                        _loop_4 = function (i) {
                            var lote, batch;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        lote = produtos.slice(i, i + BATCH_SIZE);
                                        batch = FS_AN.batch();
                                        lote.forEach(function (prod) {
                                            var cod = String(prod.codigo_produto || prod.gtin || '').trim();
                                            if (!cod)
                                                return;
                                            var ref = FS_AN.collection('dt_produtos').doc(cod);
                                            batch.set(ref, {
                                                codigo_produto: prod.codigo_produto || cod,
                                                descricao_produto: prod.descricao_produto || prod.descricao || '',
                                                gtin: prod.gtin || '',
                                                fator_caixa: prod.fator_caixa || 1,
                                                unidade: prod.unidade || '',
                                            }, { merge: true });
                                        });
                                        return [4 /*yield*/, batch.commit()];
                                    case 1:
                                        _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < produtos.length)) return [3 /*break*/, 5];
                        return [5 /*yield**/, _loop_4(i)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        i += BATCH_SIZE;
                        return [3 /*break*/, 2];
                    case 5:
                        dbg('[fsPublicarProdutos] ✅', produtos.length, 'produtos publicados');
                        return [3 /*break*/, 7];
                    case 6:
                        e_3 = _a.sent();
                        console.error('[fsPublicarProdutos] erro:', e_3.message);
                        return [3 /*break*/, 7];
                    case 7: return [2 /*return*/];
                }
            });
        });
    }
    // Exportar para acesso global (chamados de 10-inventarios-negocio e outros módulos)
    global.fsPublicarInventario = fsPublicarInventario;
    global.fsPublicarEnderecos = fsPublicarEnderecos;
    global.fsPublicarProdutos = fsPublicarProdutos;
})(window);
