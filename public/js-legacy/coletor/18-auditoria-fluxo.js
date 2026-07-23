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
// ═══════════════════════════════════════════════════════════════
// AUDITORIA DO COLETOR — FLUXO ISOLADO E SIMPLIFICADO
// Endereço -> Produto OU Endereço vazio -> gravação -> próximo endereço
// Este arquivo não usa nem altera as funções de contagem do Inventário.
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var STATUS_OK = 'OK';
    var STATUS_DIVERGENTE = 'DIVERGENTE';
    var STATUS_VAZIO = 'ENDERECO_VAZIO';
    var STATUS_FINAIS = new Set([STATUS_OK, STATUS_DIVERGENTE, STATUS_VAZIO]);
    var estado = {
        etapa: 'endereco',
        item: null,
        processando: false,
        timerRetorno: null
    };
    function texto(v) { return String(v == null ? '' : v).trim(); }
    function normalizarEndereco(v) {
        return texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    function normalizarCodigo(v) {
        return texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    function escapar(v) {
        return texto(v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); });
    }
    function agoraISO() { return new Date().toISOString(); }
    function operadorNome() { var _a, _b; return ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || ((_b = APP.operador) === null || _b === void 0 ? void 0 : _b.nome) || ''; }
    function operadorUsuario() { var _a, _b, _c; return ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.email) || ((_b = APP.operador) === null || _b === void 0 ? void 0 : _b.usuario) || ((_c = APP.operador) === null || _c === void 0 ? void 0 : _c.login) || ''; }
    function lojaAtual() {
        var _a, _b, _c;
        return ((_a = APP.lojaAtual) === null || _a === void 0 ? void 0 : _a.id) || ((_b = APP.lojaAtual) === null || _b === void 0 ? void 0 : _b.nome) || APP.lojaId || ((_c = APP.inventario) === null || _c === void 0 ? void 0 : _c.loja) || '';
    }
    function auditoriaId() { var _a, _b; return ((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.auditoria_id) || ((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.id) || ''; }
    function listaAuditoria() {
        return (APP.auditorias || []).filter(function (item) {
            var status = texto(item.status).toUpperCase();
            return item.disponivel_coletor !== false && !STATUS_FINAIS.has(status);
        });
    }
    function dunEsperado(item) {
        return texto((item === null || item === void 0 ? void 0 : item.dunEsperado) || (item === null || item === void 0 ? void 0 : item.dun_esperado) || (item === null || item === void 0 ? void 0 : item.dun) || (item === null || item === void 0 ? void 0 : item.codigoProduto) || (item === null || item === void 0 ? void 0 : item.codigo_produto) || (item === null || item === void 0 ? void 0 : item.gtin));
    }
    function descricaoEsperada(item) {
        return texto((item === null || item === void 0 ? void 0 : item.produtoEsperado) || (item === null || item === void 0 ? void 0 : item.produto_esperado) || (item === null || item === void 0 ? void 0 : item.descricaoProdutoEsperado) || (item === null || item === void 0 ? void 0 : item.produto_nome) || (item === null || item === void 0 ? void 0 : item.descricao) || (item === null || item === void 0 ? void 0 : item.produto));
    }
    function localizarProdutoLido(codigoLido) {
        var _a, _b;
        var globalProduto = (_a = window.DTProdutos) === null || _a === void 0 ? void 0 : _a.buscarSync(codigoLido);
        if (globalProduto === null || globalProduto === void 0 ? void 0 : globalProduto.encontrado)
            return texto(globalProduto.nomeProduto);
        var alvo = normalizarCodigo(codigoLido);
        var nomeMapeado = (_b = APP.auditoriaProdutosMap) === null || _b === void 0 ? void 0 : _b[alvo];
        if (nomeMapeado)
            return texto(nomeMapeado);
        var encontrado = (APP.auditorias || []).find(function (item) { return normalizarCodigo(dunEsperado(item)) === alvo; });
        return encontrado ? descricaoEsperada(encontrado) : 'Produto não identificado';
    }
    function encontrarEndereco(valor) {
        var alvo = normalizarEndereco(valor);
        if (!alvo)
            return null;
        var previsto = listaAuditoria().find(function (item) { return normalizarEndereco(item.endereco || item.endereco_norm) === alvo; });
        if (previsto)
            return previsto;
        if (APP.locaisAtivos && APP.locaisAtivos.has(alvo))
            return { id: auditoriaId() + '__' + alvo, endereco: texto(valor), dunEsperado: '', produtoEsperado: 'ENDEREÇO PREVISTO VAZIO', previstoVazio: true, disponivel_coletor: true };
        return null;
    }
    function elementos() {
        return {
            titulo: document.getElementById('auditoria-titulo'),
            etapaEndereco: document.getElementById('auditoria-etapa-endereco'),
            etapaProduto: document.getElementById('auditoria-etapa-produto'),
            endereco: document.getElementById('auditoria-endereco'),
            produto: document.getElementById('auditoria-produto'),
            enderecoConfirmado: document.getElementById('auditoria-endereco-confirmado'),
            feedbackEndereco: document.getElementById('auditoria-feedback-endereco'),
            feedbackFinal: document.getElementById('auditoria-feedback-final'),
            btnEndereco: document.getElementById('auditoria-confirmar-endereco'),
            btnProduto: document.getElementById('auditoria-confirmar-produto'),
            btnVazio: document.getElementById('auditoria-endereco-vazio')
        };
    }
    function tocar(tipo) {
        try {
            if (tipo === 'erro' && typeof beepErr === 'function')
                beepErr();
            else if (tipo === 'vazio' && typeof beepSuave === 'function')
                beepSuave();
            else if (typeof beepOk === 'function')
                beepOk();
        }
        catch (e) {
            console.warn('[AUDITORIA] Falha ao tocar som:', e);
        }
    }
    function mostrarFeedbackEndereco(mensagem, erro) {
        var el = elementos().feedbackEndereco;
        if (!el)
            return;
        el.style.display = '';
        el.className = erro ? 'fb err' : 'fb ok';
        el.textContent = mensagem;
    }
    function mostrarResultado(mensagem, tipo) {
        var el = elementos().feedbackFinal;
        if (!el)
            return;
        el.style.display = '';
        el.className = tipo === 'erro' ? 'fb err' : (tipo === 'vazio' ? 'fb warn' : 'fb ok');
        el.textContent = mensagem;
    }
    function setProcessando(valor) {
        estado.processando = !!valor;
        var el = elementos();
        [el.btnEndereco, el.btnProduto, el.btnVazio].forEach(function (btn) { if (btn)
            btn.disabled = estado.processando; });
        if (el.endereco)
            el.endereco.disabled = estado.processando || estado.etapa !== 'endereco';
        if (el.produto)
            el.produto.disabled = estado.processando || estado.etapa !== 'produto';
    }
    function atualizarContadorTitulo() {
        var _a, _b;
        var el = elementos().titulo;
        if (!el)
            return;
        var nome = ((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.auditoria_nome) || ((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.nome) || auditoriaId() || 'Auditoria';
        el.textContent = "".concat(nome, " \u00B7 ").concat(listaAuditoria().length, " pendente(s)");
    }
    function irParaEndereco() {
        if (estado.timerRetorno)
            clearTimeout(estado.timerRetorno);
        estado = { etapa: 'endereco', item: null, processando: false, timerRetorno: null };
        var el = elementos();
        if (el.etapaEndereco)
            el.etapaEndereco.style.display = '';
        if (el.etapaProduto)
            el.etapaProduto.style.display = 'none';
        if (el.endereco) {
            el.endereco.disabled = false;
            el.endereco.value = '';
        }
        if (el.produto) {
            el.produto.disabled = true;
            el.produto.value = '';
        }
        if (el.feedbackEndereco) {
            el.feedbackEndereco.style.display = 'none';
            el.feedbackEndereco.textContent = '';
        }
        if (el.feedbackFinal) {
            el.feedbackFinal.style.display = 'none';
            el.feedbackFinal.textContent = '';
        }
        atualizarContadorTitulo();
        setTimeout(function () { var _a; return (_a = el.endereco) === null || _a === void 0 ? void 0 : _a.focus(); }, 60);
    }
    function irParaProduto(item) {
        estado.etapa = 'produto';
        estado.item = item;
        var el = elementos();
        if (el.etapaEndereco)
            el.etapaEndereco.style.display = 'none';
        if (el.etapaProduto)
            el.etapaProduto.style.display = '';
        if (el.enderecoConfirmado)
            el.enderecoConfirmado.textContent = texto(item.endereco);
        if (el.produto) {
            el.produto.disabled = false;
            el.produto.value = '';
        }
        if (el.feedbackFinal) {
            el.feedbackFinal.style.display = 'none';
            el.feedbackFinal.textContent = '';
        }
        setProcessando(false);
        setTimeout(function () { var _a; return (_a = el.produto) === null || _a === void 0 ? void 0 : _a.focus(); }, 60);
    }
    function consultarEnderecoNaBaseGeral(valor) {
        return __awaiter(this, void 0, void 0, function () {
            var alvo, snap, existe, consultas, i, q, erro_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        alvo = normalizarEndereco(valor);
                        if (!alvo)
                            return [2 /*return*/, false];
                        if (APP.locaisAtivos && APP.locaisAtivos.has(alvo))
                            return [2 /*return*/, true];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 7, , 8]);
                        return [4 /*yield*/, FS.collection(FCOL.locais).doc(alvo).get()];
                    case 2:
                        snap = _a.sent();
                        existe = snap.exists && (!snap.data() || snap.data().ativo !== false);
                        if (!!existe) return [3 /*break*/, 6];
                        consultas = ['endereco', 'endereco_norm', 'codigo_endereco'];
                        i = 0;
                        _a.label = 3;
                    case 3:
                        if (!(i < consultas.length && !existe)) return [3 /*break*/, 6];
                        return [4 /*yield*/, FS.collection(FCOL.locais).where(consultas[i], '==', valor).limit(1).get()];
                    case 4:
                        q = _a.sent();
                        if (!q.empty && q.docs[0].data().ativo !== false)
                            existe = true;
                        _a.label = 5;
                    case 5:
                        i++;
                        return [3 /*break*/, 3];
                    case 6:
                        if (existe) {
                            if (!APP.locaisAtivos)
                                APP.locaisAtivos = new Set();
                            APP.locaisAtivos.add(alvo);
                        }
                        return [2 /*return*/, existe];
                    case 7:
                        erro_1 = _a.sent();
                        console.warn('[AUDITORIA] Falha na consulta direta do endereço:', erro_1);
                        return [2 /*return*/, false];
                    case 8: return [2 /*return*/];
                }
            });
        });
    }
    function confirmarEnderecoAuditoria() {
        return __awaiter(this, void 0, void 0, function () {
            var el, valor, item, existeNaBaseGeral;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        if (estado.processando || estado.etapa !== 'endereco')
                            return [2 /*return*/];
                        el = elementos();
                        valor = texto((_a = el.endereco) === null || _a === void 0 ? void 0 : _a.value);
                        if (!valor) {
                            mostrarFeedbackEndereco('Bipe o endereço.', true);
                            tocar('erro');
                            (_b = el.endereco) === null || _b === void 0 ? void 0 : _b.focus();
                            return [2 /*return*/];
                        }
                        item = encontrarEndereco(valor);
                        if (!!item) return [3 /*break*/, 2];
                        mostrarFeedbackEndereco('Consultando a Base Geral de Endereços…', false);
                        return [4 /*yield*/, consultarEnderecoNaBaseGeral(valor)];
                    case 1:
                        existeNaBaseGeral = _c.sent();
                        if (existeNaBaseGeral) {
                            item = encontrarEndereco(valor) || {
                                id: auditoriaId() + '__' + normalizarEndereco(valor),
                                endereco: valor,
                                dunEsperado: '',
                                produtoEsperado: 'ENDEREÇO PREVISTO VAZIO',
                                previstoVazio: true,
                                disponivel_coletor: true
                            };
                        }
                        _c.label = 2;
                    case 2:
                        if (!item) {
                            mostrarFeedbackEndereco('Endereço não cadastrado na Base Geral de Endereços desta loja.', true);
                            tocar('erro');
                            if (el.endereco) {
                                el.endereco.select();
                                el.endereco.focus();
                            }
                            return [2 /*return*/];
                        }
                        mostrarFeedbackEndereco('Endereço confirmado.', false);
                        tocar('ok');
                        irParaProduto(item);
                        return [2 /*return*/];
                }
            });
        });
    }
    function documentoId(item) {
        return texto((item === null || item === void 0 ? void 0 : item.id) || "".concat(auditoriaId(), "__").concat(normalizarEndereco(item === null || item === void 0 ? void 0 : item.endereco)));
    }
    function salvarResultado(status, produtoLido) {
        return __awaiter(this, void 0, void 0, function () {
            var item, docId, momento, esperado, lido, nomeLido, payload, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (estado.processando || !estado.item)
                            return [2 /*return*/];
                        item = estado.item;
                        docId = documentoId(item);
                        if (!docId || !auditoriaId()) {
                            mostrarResultado('Não foi possível identificar a auditoria.', 'erro');
                            tocar('erro');
                            return [2 /*return*/];
                        }
                        setProcessando(true);
                        momento = agoraISO();
                        esperado = dunEsperado(item);
                        lido = status === STATUS_VAZIO ? null : texto(produtoLido);
                        nomeLido = status === STATUS_VAZIO ? null : localizarProdutoLido(lido);
                        payload = {
                            auditoriaId: auditoriaId(),
                            endereco: texto(item.endereco),
                            dunEsperado: esperado,
                            produtoEsperado: descricaoEsperada(item),
                            dunLido: lido,
                            dun_lido: lido,
                            codigoLido: lido,
                            produtoLido: nomeLido,
                            produto_lido: nomeLido,
                            produtoNaoCadastrado: status !== STATUS_VAZIO && !(window.DTProdutos && window.DTProdutos.buscarSync && window.DTProdutos.buscarSync(lido).encontrado),
                            status: status,
                            operadorId: operadorUsuario(),
                            operadorNome: operadorNome(),
                            lidoEm: momento,
                            lido_em: momento,
                            loja: lojaAtual(),
                            observacao: '',
                            disponivel_coletor: false,
                            atualizadoEm: momento
                        };
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, FS.collection(FCOL.auditorias)
                                .doc(auditoriaId())
                                .collection('enderecos')
                                .doc(docId)
                                .set(payload, { merge: true })];
                    case 2:
                        _a.sent();
                        APP.auditorias = (APP.auditorias || []).filter(function (a) { return documentoId(a) !== docId; });
                        atualizarContadorTitulo();
                        if (status === STATUS_OK) {
                            mostrarResultado('Auditoria concluída.', 'ok');
                            tocar('ok');
                        }
                        else if (status === STATUS_DIVERGENTE) {
                            mostrarResultado('Produto divergente.', 'erro');
                            tocar('erro');
                        }
                        else {
                            mostrarResultado('Endereço registrado como vazio.', 'vazio');
                            tocar('vazio');
                        }
                        estado.timerRetorno = setTimeout(irParaEndereco, 900);
                        return [3 /*break*/, 4];
                    case 3:
                        error_1 = _a.sent();
                        console.error('[AUDITORIA] Erro ao salvar resultado:', error_1);
                        try {
                            var chave = 'dt_auditoria_fila_' + lojaAtual();
                            var fila = JSON.parse(localStorage.getItem(chave) || '[]').filter(function (x) { return x.docId !== docId; });
                            fila.push({ docId: docId, auditoriaId: auditoriaId(), payload: payload });
                            localStorage.setItem(chave, JSON.stringify(fila));
                        } catch (e) {}
                        APP.auditorias = (APP.auditorias || []).filter(function (a) { return documentoId(a) !== docId; });
                        atualizarContadorTitulo();
                        mostrarResultado('Auditoria salva no coletor. Será enviada quando houver conexão.', 'vazio');
                        tocar('vazio');
                        estado.timerRetorno = setTimeout(irParaEndereco, 900);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    }
    function confirmarProdutoAuditoria() {
        var _a, _b;
        if (estado.processando || estado.etapa !== 'produto' || !estado.item)
            return;
        var el = elementos();
        var lido = texto((_a = el.produto) === null || _a === void 0 ? void 0 : _a.value);
        if (!lido) {
            mostrarResultado('Bipe o produto.', 'erro');
            tocar('erro');
            (_b = el.produto) === null || _b === void 0 ? void 0 : _b.focus();
            return;
        }
        if (!/^\d+$/.test(lido)) {
            mostrarResultado('Código inválido. Bipe somente números, sem pontos, barras, espaços ou letras.', 'erro');
            tocar('erro');
            el.produto.select();
            el.produto.focus();
            return;
        }
        var prod = window.DTProdutos && window.DTProdutos.buscarSync ? window.DTProdutos.buscarSync(lido) : { encontrado: false };
        var esperado = dunEsperado(estado.item);
        var correto = esperado && normalizarCodigo(lido) === normalizarCodigo(esperado);
        var meta = (APP.auditoriasMenu || []).find(function (x) { return x.id === auditoriaId(); }) || {};
        if (meta.tipoAuditoria === 'produto' && meta.familiaId) {
            correto = (prod.familiaCodigo || prod.familiaNome) === meta.familiaId || prod.familiaNome === meta.familiaNome;
        }
        if (!prod.encontrado)
            correto = false;
        if (estado.item.previstoVazio === true || !esperado)
            correto = false;
        if (!prod.encontrado)
            mostrarResultado('Produto não cadastrado. Será registrado como divergente.', 'erro');
        salvarResultado(correto ? STATUS_OK : STATUS_DIVERGENTE, lido);
    }
    function registrarEnderecoVazio() {
        if (estado.processando || estado.etapa !== 'produto' || !estado.item)
            return;
        salvarResultado(STATUS_VAZIO, '');
    }
    function renderAuditoriaColetor() {
        atualizarContadorTitulo();
        irParaEndereco();
    }
    window.renderAuditoriaColetor = renderAuditoriaColetor;
    window.confirmarEnderecoAuditoria = confirmarEnderecoAuditoria;
    window.confirmarProdutoAuditoria = confirmarProdutoAuditoria;
    window.registrarEnderecoVazioAuditoria = registrarEnderecoVazio;
    // Substitui somente a abertura de Auditoria. Não chama resetContagem(),
    // Não chama nenhuma rotina de confirmação ou gravação do Inventário.
    window.selecionarAuditoriaMenu = function (auditoriaSelecionadaId) {
        return __awaiter(this, void 0, void 0, function () {
            var meta, lojaId, cacheAuditoria, _a, tabs, error_2;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        meta = (APP.auditoriasMenu || []).find(function (x) { return x.id === auditoriaSelecionadaId; });
                        if (!meta) {
                            toast('Auditoria não encontrada', 'e');
                            return [2 /*return*/];
                        }
                        APP.modoPendente = 'auditoria';
                        APP.modoAcesso = 'auditoria';
                        APP.inventario = {
                            id: auditoriaSelecionadaId,
                            nome: meta.auditoria_nome || auditoriaSelecionadaId,
                            auditoria_nome: meta.auditoria_nome || auditoriaSelecionadaId,
                            status: 'ATIVO',
                            auditoria_id: auditoriaSelecionadaId,
                            tipoAuditoria: meta.tipoAuditoria || '', familiaId: meta.familiaId || '', familiaNome: meta.familiaNome || '', ruas: meta.ruas || []
                        };
                        APP.base = [];
                        APP.auditoriaBase = [];
                        APP.contagens = [];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 5, , 6]);
                        goScreen('app');
                        if (window._carregarBaseGeralEnderecosAuditoria)
                            window._carregarBaseGeralEnderecosAuditoria(false).catch(function () { });
                        lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
                        cacheAuditoria = [];
                        try {
                            cacheAuditoria = JSON.parse(localStorage.getItem('dt_auditoria_cache_' + lojaId + '_' + auditoriaSelecionadaId) || '[]');
                        }
                        catch (e) { }
                        if (!cacheAuditoria.length) return [3 /*break*/, 2];
                        APP.auditorias = cacheAuditoria;
                        return [3 /*break*/, 4];
                    case 2:
                        _a = APP;
                        return [4 /*yield*/, window._carregarEnderecoAuditoria(auditoriaSelecionadaId)];
                    case 3:
                        _a.auditorias = _b.sent();
                        _b.label = 4;
                    case 4:
                        tabs = {
                            contar: document.getElementById('tab-contar'),
                            historico: document.getElementById('tab-historico'),
                            recontagens: document.getElementById('tab-recontagens'),
                            estorno: document.getElementById('tab-estorno'),
                            auditoria: document.getElementById('tab-auditoria'),
                            status: document.getElementById('tab-status')
                        };
                        if (tabs.contar)
                            tabs.contar.style.display = 'none';
                        if (tabs.historico)
                            tabs.historico.style.display = 'none';
                        if (tabs.recontagens)
                            tabs.recontagens.style.display = 'none';
                        if (tabs.estorno)
                            tabs.estorno.style.display = 'none';
                        if (tabs.auditoria)
                            tabs.auditoria.style.display = '';
                        if (tabs.status)
                            tabs.status.style.display = '';
                        showView('auditoria', tabs.auditoria);
                        renderAuditoriaColetor();
                        if (cacheAuditoria.length) {
                            window._carregarEnderecoAuditoria(auditoriaSelecionadaId).then(function (lista) {
                                if (APP.modoAcesso === 'auditoria' && auditoriaId() === auditoriaSelecionadaId) {
                                    APP.auditorias = lista;
                                    atualizarContadorTitulo();
                                }
                            }).catch(function (erro) { console.warn('[AUDITORIA] Atualização em segundo plano falhou:', erro); });
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        error_2 = _b.sent();
                        console.error('[AUDITORIA] Erro ao abrir auditoria:', error_2);
                        toast('Erro ao abrir auditoria: ' + error_2.message, 'e');
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    function registrarEventosUmaVez() {
        if (window.__auditoriaFluxoEventosRegistrados)
            return;
        window.__auditoriaFluxoEventosRegistrados = true;
        document.addEventListener('click', function (event) {
            if (event.target.closest('#auditoria-confirmar-endereco'))
                confirmarEnderecoAuditoria();
            else if (event.target.closest('#auditoria-confirmar-produto'))
                confirmarProdutoAuditoria();
            else if (event.target.closest('#auditoria-endereco-vazio'))
                registrarEnderecoVazio();
        });
        document.addEventListener('keydown', function (event) {
            var _a;
            if (APP.modoAcesso !== 'auditoria' || event.key !== 'Enter')
                return;
            var id = (_a = document.activeElement) === null || _a === void 0 ? void 0 : _a.id;
            if (id === 'auditoria-endereco') {
                event.preventDefault();
                event.stopImmediatePropagation();
                confirmarEnderecoAuditoria();
            }
            else if (id === 'auditoria-produto') {
                event.preventDefault();
                event.stopImmediatePropagation();
                confirmarProdutoAuditoria();
            }
        }, true);
    }
    registrarEventosUmaVez();
})();
