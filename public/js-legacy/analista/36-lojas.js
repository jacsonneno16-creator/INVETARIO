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
    var raw = function () { return global.getDTRawFirestore(); };
    function esc(v) { return String(v !== null && v !== void 0 ? v : '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); }
    function renderGestaoLojas() {
        return __awaiter(this, void 0, void 0, function () {
            var box, lojas, ativa_1, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        box = document.getElementById('lojas-lista');
                        if (!box)
                            return [2 /*return*/];
                        box.innerHTML = '<div class="empty">Carregando lojas...</div>';
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, global.DTLoja.garantirLojaInicial()];
                    case 2:
                        lojas = _a.sent(), ativa_1 = global.getDTLojaAtiva();
                        box.innerHTML = "<div class=\"table-card\"><table><thead><tr><th>Loja</th><th>C\u00F3digo</th><th>Status</th><th>Ambiente atual</th><th>A\u00E7\u00F5es</th></tr></thead><tbody>".concat(lojas.map(function (l) { return "<tr>\n        <td><b>".concat(esc(l.nome || l.id), "</b><div style=\"font-size:.7rem;color:var(--muted)\">").concat(esc(l.id), "</div></td>\n        <td>").concat(esc(l.codigo || '—'), "</td><td><span class=\"badge ").concat(l.ativa === false ? 'badge-red' : 'badge-green', "\">").concat(l.ativa === false ? 'Inativa' : 'Ativa', "</span></td>\n        <td>").concat(l.id === ativa_1 ? '✅ Em uso' : '—', "</td><td style=\"white-space:nowrap\"><button class=\"btn btn-ghost btn-sm\" onclick='editarLoja(").concat(JSON.stringify(JSON.stringify(l)), ")'>Editar</button> <button class=\"btn btn-ghost btn-sm\" onclick=\"usarLoja('").concat(esc(l.id), "')\">Usar</button></td>\n      </tr>"); }).join(''), "</tbody></table></div>");
                        return [3 /*break*/, 4];
                    case 3:
                        e_1 = _a.sent();
                        box.innerHTML = "<div class=\"empty\">Erro ao carregar lojas: ".concat(esc(e_1.message), "</div>");
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function abrirCadastroLoja() {
        document.getElementById('ml-id').value = '';
        document.getElementById('ml-nome').value = '';
        document.getElementById('ml-codigo').value = '';
        document.getElementById('ml-ativa').value = 'true';
        document.getElementById('ml-title').textContent = 'Cadastrar loja';
        openModal('modal-loja-cadastro');
    }
    function editarLoja(json) { var l = JSON.parse(json); document.getElementById('ml-id').value = l.id; document.getElementById('ml-nome').value = l.nome || ''; document.getElementById('ml-codigo').value = l.codigo || ''; document.getElementById('ml-ativa').value = String(l.ativa !== false); document.getElementById('ml-title').textContent = 'Editar loja'; openModal('modal-loja-cadastro'); }
    function salvarLoja() {
        return __awaiter(this, void 0, void 0, function () {
            var nome, codigo, atualId, id, e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        nome = document.getElementById('ml-nome').value.trim(), codigo = document.getElementById('ml-codigo').value.trim().toUpperCase();
                        if (!nome) {
                            showToast('Informe o nome da loja', 'error');
                            return [2 /*return*/];
                        }
                        atualId = document.getElementById('ml-id').value, id = atualId || global.DTLoja.slug(codigo || nome);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, raw().collection('lojas').doc(id).set(__assign({ nome: nome, codigo: codigo, ativa: document.getElementById('ml-ativa').value === 'true', atualizada_em: new Date().toISOString() }, (atualId ? {} : { criada_em: new Date().toISOString() })), { merge: true })];
                    case 2:
                        _a.sent();
                        closeModal('modal-loja-cadastro');
                        showToast('Loja salva com sucesso', 'success');
                        renderGestaoLojas();
                        return [3 /*break*/, 4];
                    case 3:
                        e_2 = _a.sent();
                        showToast('Erro ao salvar loja: ' + e_2.message, 'error');
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function usarLoja(id) {
        return __awaiter(this, void 0, void 0, function () { return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (id === global.getDTLojaAtiva())
                        return [2 /*return*/];
                    if (!(typeof global.aplicarTrocaLojaAnalista === 'function')) return [3 /*break*/, 3];
                    return [4 /*yield*/, global.aplicarTrocaLojaAnalista(id)];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, renderGestaoLojas()];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
                case 3:
                    global.setDTLojaAtiva(id);
                    return [4 /*yield*/, renderGestaoLojas()];
                case 4:
                    _a.sent();
                    return [2 /*return*/];
            }
        }); });
    }
    function _pausarMigracao(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }
    function _commitMigracaoControlado(batch, ops) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!ops)
                            return [2 /*return*/];
                        return [4 /*yield*/, batch.commit()];
                    case 1:
                        _a.sent();
                        // WebViews e conexões lentas podem saturar o write stream quando muitos
                        // commits são enfileirados em sequência. Uma pausa curta mantém apenas um
                        // lote ativo por vez e evita resource-exhausted.
                        return [4 /*yield*/, _pausarMigracao(120)];
                    case 2:
                        // WebViews e conexões lentas podem saturar o write stream quando muitos
                        // commits são enfileirados em sequência. Uma pausa curta mantém apenas um
                        // lote ativo por vez e evita resource-exhausted.
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    }
    function _copiarColecaoLegada(nome, lojaId, progresso) {
        return __awaiter(this, void 0, void 0, function () {
            function gravar(ref, dados) {
                return __awaiter(this, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                batch.set(ref, dados, { merge: true });
                                ops++;
                                if (!(ops >= LIMITE_LOTE)) return [3 /*break*/, 2];
                                return [4 /*yield*/, _commitMigracaoControlado(batch, ops)];
                            case 1:
                                _a.sent();
                                batch = raw().batch();
                                ops = 0;
                                _a.label = 2;
                            case 2: return [2 /*return*/];
                        }
                    });
                });
            }
            var origem, total, batch, ops, LIMITE_LOTE, _i, _a, d, _b, _c, sub, ss, _d, _e, sd, _1;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0: return [4 /*yield*/, raw().collection(nome).get()];
                    case 1:
                        origem = _f.sent();
                        if (origem.empty)
                            return [2 /*return*/, 0];
                        total = 0, batch = raw().batch(), ops = 0;
                        LIMITE_LOTE = 120;
                        _i = 0, _a = origem.docs;
                        _f.label = 2;
                    case 2:
                        if (!(_i < _a.length)) return [3 /*break*/, 15];
                        d = _a[_i];
                        return [4 /*yield*/, gravar(raw().collection('lojas').doc(lojaId).collection(nome).doc(d.id), d.data())];
                    case 3:
                        _f.sent();
                        total++;
                        if (!['dt_inventarios', 'dt_auditorias'].includes(nome)) return [3 /*break*/, 13];
                        _b = 0, _c = ['base_chunks', 'enderecos'];
                        _f.label = 4;
                    case 4:
                        if (!(_b < _c.length)) return [3 /*break*/, 13];
                        sub = _c[_b];
                        _f.label = 5;
                    case 5:
                        _f.trys.push([5, 11, , 12]);
                        return [4 /*yield*/, d.ref.collection(sub).get()];
                    case 6:
                        ss = _f.sent();
                        _d = 0, _e = ss.docs;
                        _f.label = 7;
                    case 7:
                        if (!(_d < _e.length)) return [3 /*break*/, 10];
                        sd = _e[_d];
                        return [4 /*yield*/, gravar(raw().collection('lojas').doc(lojaId).collection(nome).doc(d.id).collection(sub).doc(sd.id), sd.data())];
                    case 8:
                        _f.sent();
                        _f.label = 9;
                    case 9:
                        _d++;
                        return [3 /*break*/, 7];
                    case 10: return [3 /*break*/, 12];
                    case 11:
                        _1 = _f.sent();
                        return [3 /*break*/, 12];
                    case 12:
                        _b++;
                        return [3 /*break*/, 4];
                    case 13:
                        if (progresso)
                            progresso(nome, total);
                        _f.label = 14;
                    case 14:
                        _i++;
                        return [3 /*break*/, 2];
                    case 15:
                        if (!ops) return [3 /*break*/, 17];
                        return [4 /*yield*/, _commitMigracaoControlado(batch, ops)];
                    case 16:
                        _f.sent();
                        _f.label = 17;
                    case 17: return [2 /*return*/, total];
                }
            });
        });
    }
    var COLECOES_LEGADAS = ['dt_inventarios', 'dt_contagens', 'dt_vazios', 'dt_recontagens', 'dt_divergencias', 'dt_locais', 'dt_locais_chunks', 'dt_locais_meta', 'dt_produtos', 'dt_auditorias', 'dt_auditoria_imports', 'dt_auditoria_meta', 'dt_operadores', 'dt_analistas', 'dt_logs_analista', 'dt_logs_coletor', 'dt_ranking_operadores'];
    var COLECOES_OPERACIONAIS_LOJA = COLECOES_LEGADAS.slice();
    function sincronizarDadosLegadosAutomaticamente() {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (global.__dtMigracaoLegadaPromise)
                            return [2 /*return*/, global.__dtMigracaoLegadaPromise];
                        global.__dtMigracaoLegadaPromise = (function () {
                            return __awaiter(this, void 0, void 0, function () {
                                var lojaId, acesso, usuario, lojaRef, lojaSnap, loja, verificacoes, destinoVazio, raizPossuiDados, total, _i, COLECOES_LEGADAS_1, c, snapAtual, dadosAtual, concluidas, _a, error_1;
                                return __generator(this, function (_b) {
                                    switch (_b.label) {
                                        case 0:
                                            lojaId = global.getDTLojaAtiva();
                                            acesso = global.DT_USUARIO_ACESSO_ATUAL || {};
                                            usuario = null;
                                            try {
                                                usuario = global.firebase && global.firebase.auth ? global.firebase.auth().currentUser : null;
                                            }
                                            catch (_) { }
                                            if (!usuario || !lojaId || (acesso.perfil !== 'administrador' && acesso.admin_mestre !== true && acesso.administrador_mestre !== true)) {
                                                return [2 /*return*/, { executado: false, total: 0 }];
                                            }
                                            // Dados legados pertencem exclusivamente à Loja Matriz. Nunca copiar a
                                            // raiz automaticamente para filiais, pois isso mistura endereços,
                                            // produtos, inventários e auditorias entre ambientes.
                                            if (lojaId !== 'loja_matriz')
                                                return [2 /*return*/, { executado: false, total: 0, isolado: true }];
                                            lojaRef = raw().collection('lojas').doc(lojaId);
                                            return [4 /*yield*/, lojaRef.get()];
                                        case 1:
                                            lojaSnap = _b.sent();
                                            loja = lojaSnap.exists ? (lojaSnap.data() || {}) : {};
                                            if (loja.migracao_legada_concluida === true)
                                                return [2 /*return*/, { executado: false, total: Number(loja.migracao_documentos || 0) }];
                                            // Evita duas abas/navegadores executarem a mesma migração ao mesmo tempo.
                                            if (loja.migracao_legada_status === 'EM_ANDAMENTO' && loja.migracao_legada_uid && loja.migracao_legada_uid !== usuario.uid) {
                                                return [2 /*return*/, { executado: false, total: Number(loja.migracao_documentos || 0), emAndamento: true }];
                                            }
                                            return [4 /*yield*/, Promise.all([
                                                    lojaRef.collection('dt_locais').limit(1).get(),
                                                    lojaRef.collection('dt_inventarios').limit(1).get(),
                                                    lojaRef.collection('dt_operadores').limit(1).get(),
                                                    raw().collection('dt_locais').limit(1).get(),
                                                    raw().collection('dt_inventarios').limit(1).get(),
                                                    raw().collection('dt_operadores').limit(1).get()
                                                ])];
                                        case 2:
                                            verificacoes = _b.sent();
                                            destinoVazio = verificacoes[0].empty && verificacoes[1].empty && verificacoes[2].empty;
                                            raizPossuiDados = !verificacoes[3].empty || !verificacoes[4].empty || !verificacoes[5].empty;
                                            if (!(!destinoVazio || !raizPossuiDados)) return [3 /*break*/, 4];
                                            return [4 /*yield*/, lojaRef.set({ migracao_legada_concluida: true, migracao_legada_status: 'CONCLUIDA', migracao_legada_em: new Date().toISOString(), migracao_documentos: 0 }, { merge: true })];
                                        case 3:
                                            _b.sent();
                                            return [2 /*return*/, { executado: false, total: 0 }];
                                        case 4: return [4 /*yield*/, lojaRef.set({
                                                migracao_legada_status: 'EM_ANDAMENTO',
                                                migracao_legada_uid: usuario.uid,
                                                migracao_legada_inicio: new Date().toISOString()
                                            }, { merge: true })];
                                        case 5:
                                            _b.sent();
                                            total = 0;
                                            _b.label = 6;
                                        case 6:
                                            _b.trys.push([6, 15, , 17]);
                                            _i = 0, COLECOES_LEGADAS_1 = COLECOES_LEGADAS;
                                            _b.label = 7;
                                        case 7:
                                            if (!(_i < COLECOES_LEGADAS_1.length)) return [3 /*break*/, 13];
                                            c = COLECOES_LEGADAS_1[_i];
                                            return [4 /*yield*/, lojaRef.get()];
                                        case 8:
                                            snapAtual = _b.sent();
                                            dadosAtual = snapAtual.exists ? (snapAtual.data() || {}) : {};
                                            concluidas = Array.isArray(dadosAtual.migracao_colecoes_concluidas) ? dadosAtual.migracao_colecoes_concluidas : [];
                                            if (concluidas.indexOf(c) >= 0)
                                                return [3 /*break*/, 12];
                                            _a = total;
                                            return [4 /*yield*/, _copiarColecaoLegada(c, lojaId)];
                                        case 9:
                                            total = _a + _b.sent();
                                            return [4 /*yield*/, lojaRef.set({
                                                    migracao_documentos: total,
                                                    migracao_colecoes_concluidas: concluidas.concat([c]),
                                                    migracao_ultima_colecao: c,
                                                    migracao_atualizada_em: new Date().toISOString()
                                                }, { merge: true })];
                                        case 10:
                                            _b.sent();
                                            return [4 /*yield*/, _pausarMigracao(200)];
                                        case 11:
                                            _b.sent();
                                            _b.label = 12;
                                        case 12:
                                            _i++;
                                            return [3 /*break*/, 7];
                                        case 13: return [4 /*yield*/, lojaRef.set({
                                                migracao_legada_concluida: true,
                                                migracao_legada_status: 'CONCLUIDA',
                                                migracao_legada_em: new Date().toISOString(),
                                                migracao_documentos: total,
                                                migracao_origem: 'COLECOES_RAIZ'
                                            }, { merge: true })];
                                        case 14:
                                            _b.sent();
                                            return [2 /*return*/, { executado: true, total: total }];
                                        case 15:
                                            error_1 = _b.sent();
                                            return [4 /*yield*/, lojaRef.set({
                                                    migracao_legada_status: 'ERRO',
                                                    migracao_legada_erro: String(error_1 && error_1.message || error_1),
                                                    migracao_atualizada_em: new Date().toISOString()
                                                }, { merge: true }).catch(function () { })];
                                        case 16:
                                            _b.sent();
                                            throw error_1;
                                        case 17: return [2 /*return*/];
                                    }
                                });
                            });
                        })();
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, , 3, 4]);
                        return [4 /*yield*/, global.__dtMigracaoLegadaPromise];
                    case 2: return [2 /*return*/, _a.sent()];
                    case 3:
                        global.__dtMigracaoLegadaPromise = null;
                        return [7 /*endfinally*/];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function _excluirColecaoLojaControlado(lojaId, nome) {
        return __awaiter(this, void 0, void 0, function () {
            var ref, total, snap, batch, _i, _a, d, _b, _c, sub, ss, sb, n, _d, _e, sd, _2;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        ref = raw().collection('lojas').doc(lojaId).collection(nome);
                        total = 0;
                        _f.label = 1;
                    case 1:
                        if (!true) return [3 /*break*/, 21];
                        return [4 /*yield*/, ref.limit(100).get()];
                    case 2:
                        snap = _f.sent();
                        if (snap.empty)
                            return [3 /*break*/, 21];
                        batch = raw().batch();
                        _i = 0, _a = snap.docs;
                        _f.label = 3;
                    case 3:
                        if (!(_i < _a.length)) return [3 /*break*/, 18];
                        d = _a[_i];
                        if (!(nome === 'dt_inventarios' || nome === 'dt_auditorias')) return [3 /*break*/, 16];
                        _b = 0, _c = ['base_chunks', 'enderecos'];
                        _f.label = 4;
                    case 4:
                        if (!(_b < _c.length)) return [3 /*break*/, 16];
                        sub = _c[_b];
                        _f.label = 5;
                    case 5:
                        _f.trys.push([5, 14, , 15]);
                        return [4 /*yield*/, d.ref.collection(sub).get()];
                    case 6:
                        ss = _f.sent();
                        if (!!ss.empty) return [3 /*break*/, 13];
                        sb = raw().batch(), n = 0;
                        _d = 0, _e = ss.docs;
                        _f.label = 7;
                    case 7:
                        if (!(_d < _e.length)) return [3 /*break*/, 11];
                        sd = _e[_d];
                        sb.delete(sd.ref);
                        n++;
                        if (!(n >= 100)) return [3 /*break*/, 10];
                        return [4 /*yield*/, sb.commit()];
                    case 8:
                        _f.sent();
                        return [4 /*yield*/, _pausarMigracao(100)];
                    case 9:
                        _f.sent();
                        sb = raw().batch();
                        n = 0;
                        _f.label = 10;
                    case 10:
                        _d++;
                        return [3 /*break*/, 7];
                    case 11:
                        if (!n) return [3 /*break*/, 13];
                        return [4 /*yield*/, sb.commit()];
                    case 12:
                        _f.sent();
                        _f.label = 13;
                    case 13: return [3 /*break*/, 15];
                    case 14:
                        _2 = _f.sent();
                        return [3 /*break*/, 15];
                    case 15:
                        _b++;
                        return [3 /*break*/, 4];
                    case 16:
                        batch.delete(d.ref);
                        total++;
                        _f.label = 17;
                    case 17:
                        _i++;
                        return [3 /*break*/, 3];
                    case 18: return [4 /*yield*/, batch.commit()];
                    case 19:
                        _f.sent();
                        return [4 /*yield*/, _pausarMigracao(140)];
                    case 20:
                        _f.sent();
                        return [3 /*break*/, 1];
                    case 21: return [2 /*return*/, total];
                }
            });
        });
    }
    function corrigirIsolamentoLojaAtual() {
        return __awaiter(this, void 0, void 0, function () {
            var lojaId, lojaRef, snap, loja, total, _i, COLECOES_OPERACIONAIS_LOJA_1, nome, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        lojaId = global.getDTLojaAtiva();
                        if (!lojaId || lojaId === 'loja_matriz')
                            return [2 /*return*/, { corrigido: false, total: 0 }];
                        lojaRef = raw().collection('lojas').doc(lojaId);
                        return [4 /*yield*/, lojaRef.get()];
                    case 1:
                        snap = _b.sent();
                        loja = snap.exists ? (snap.data() || {}) : {};
                        if (loja.isolamento_corrigido_v33 === true)
                            return [2 /*return*/, { corrigido: false, total: 0 }];
                        if (!(loja.migracao_origem !== 'COLECOES_RAIZ' || loja.migracao_legada_concluida !== true)) return [3 /*break*/, 3];
                        return [4 /*yield*/, lojaRef.set({ isolamento_corrigido_v33: true, isolamento_verificado_em: new Date().toISOString() }, { merge: true })];
                    case 2:
                        _b.sent();
                        return [2 /*return*/, { corrigido: false, total: 0 }];
                    case 3:
                        total = 0;
                        _i = 0, COLECOES_OPERACIONAIS_LOJA_1 = COLECOES_OPERACIONAIS_LOJA;
                        _b.label = 4;
                    case 4:
                        if (!(_i < COLECOES_OPERACIONAIS_LOJA_1.length)) return [3 /*break*/, 7];
                        nome = COLECOES_OPERACIONAIS_LOJA_1[_i];
                        _a = total;
                        return [4 /*yield*/, _excluirColecaoLojaControlado(lojaId, nome)];
                    case 5:
                        total = _a + _b.sent();
                        _b.label = 6;
                    case 6:
                        _i++;
                        return [3 /*break*/, 4];
                    case 7: return [4 /*yield*/, lojaRef.set({
                            isolamento_corrigido_v33: true,
                            isolamento_corrigido_em: new Date().toISOString(),
                            isolamento_documentos_removidos: total,
                            migracao_legada_concluida: false,
                            migracao_legada_status: 'CANCELADA_POR_ISOLAMENTO',
                            migracao_origem: firebase.firestore.FieldValue.delete(),
                            migracao_colecoes_concluidas: firebase.firestore.FieldValue.delete()
                        }, { merge: true })];
                    case 8:
                        _b.sent();
                        // Limpa somente o cache local da filial atual.
                        try {
                            Object.values(global.KEYS || {}).forEach(function (k) { localStorage.removeItem(k + '__' + lojaId); });
                            localStorage.removeItem('invcount_auditoria_metas__' + lojaId);
                            localStorage.removeItem('dt_produtos_cache__' + lojaId);
                        }
                        catch (_) { }
                        return [2 /*return*/, { corrigido: true, total: total }];
                }
            });
        });
    }
    function migrarDadosLegadosParaLojaAtual() {
        return __awaiter(this, void 0, void 0, function () {
            var lojaId, colecoes, total, _i, colecoes_1, c, _a, e_3;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        lojaId = global.getDTLojaAtiva();
                        if (!lojaId) {
                            showToast('Selecione uma loja', 'error');
                            return [2 /*return*/];
                        }
                        colecoes = COLECOES_LEGADAS;
                        if (!confirm('Copiar os dados antigos da raiz do Firebase para a loja atual? Os dados originais não serão apagados.'))
                            return [2 /*return*/];
                        total = 0;
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 7, , 8]);
                        showToast('Migração iniciada. Não feche a página.', 'success');
                        _i = 0, colecoes_1 = colecoes;
                        _b.label = 2;
                    case 2:
                        if (!(_i < colecoes_1.length)) return [3 /*break*/, 5];
                        c = colecoes_1[_i];
                        _a = total;
                        return [4 /*yield*/, _copiarColecaoLegada(c, lojaId)];
                    case 3:
                        total = _a + _b.sent();
                        _b.label = 4;
                    case 4:
                        _i++;
                        return [3 /*break*/, 2];
                    case 5: return [4 /*yield*/, raw().collection('lojas').doc(lojaId).set({ migracao_legada_em: new Date().toISOString(), migracao_documentos: total }, { merge: true })];
                    case 6:
                        _b.sent();
                        showToast("Migra\u00E7\u00E3o conclu\u00EDda: ".concat(total, " documentos copiados."), 'success');
                        setTimeout(function () { return location.reload(); }, 1200);
                        return [3 /*break*/, 8];
                    case 7:
                        e_3 = _b.sent();
                        showToast('Erro na migração: ' + e_3.message, 'error');
                        console.error(e_3);
                        return [3 /*break*/, 8];
                    case 8: return [2 /*return*/];
                }
            });
        });
    }
    Object.assign(global, { renderGestaoLojas: renderGestaoLojas, abrirCadastroLoja: abrirCadastroLoja, editarLoja: editarLoja, salvarLoja: salvarLoja, usarLoja: usarLoja, migrarDadosLegadosParaLojaAtual: migrarDadosLegadosParaLojaAtual, sincronizarDadosLegadosAutomaticamente: sincronizarDadosLegadosAutomaticamente, corrigirIsolamentoLojaAtual: corrigirIsolamentoLojaAtual });
})(window);
