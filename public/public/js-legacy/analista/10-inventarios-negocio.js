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
function state() { return window.AnalistaStore.getState(); }
//  5. LÓGICA DE NEGÓCIO — INVENTÁRIOS
// ───────────────────────────────────────────────────────────────────
function gerarId(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}
/**
 * Verifica se uma contagem é um registro de endereço vazio.
 * Aceita os dois formatos:
 *   - coletor novo:  tipo_contagem === 'VAZIO'
 *   - analista/legado: tipo === 'VAZIO_CONFIRMADO'
 */
function _isVazio(c) {
    // Verifica pelo campo original do coletor OU pelo campo normalizado (_normalizarContagem)
    return c.tipo_contagem === 'VAZIO' || c.tipo === 'VAZIO_CONFIRMADO';
}
/**
 * Normaliza um registro de contagem vindo do Firebase para o formato
 * interno do analista. Garante que vazios do coletor (tipo_contagem:'VAZIO')
 * sejam tratados como VAZIO_CONFIRMADO em toda a lógica do analista.
 */
function _normalizarContagem(c) {
    var norm = __assign({}, c);
    // Mapear dataHora → timestamp quando timestamp ausente
    // O coletor grava dataHora (ISO string ou Date); o analista usa timestamp.
    if (!norm.timestamp && norm.dataHora) {
        var dh = norm.dataHora;
        if (dh && typeof dh.toDate === 'function') {
            norm.timestamp = dh.toDate().toISOString();
        }
        else if (dh instanceof Date) {
            norm.timestamp = dh.toISOString();
        }
        else if (typeof dh === 'string') {
            norm.timestamp = dh;
        }
    }
    // Fallback: usar criado_em se ambos ausentes
    if (!norm.timestamp && norm.criado_em) {
        norm.timestamp = norm.criado_em;
    }
    if (norm.tipo_contagem === 'VAZIO') {
        norm.tipo = 'VAZIO_CONFIRMADO';
    }
    return norm;
}
function getInventariosAtivos() {
    return state().inventarios.filter(function (i) { return i.status === 'ATIVO'; });
}
function getInventarioPorId(id) {
    return state().inventarios.find(function (i) { return i.id === id; }) || null;
}
/** Abre modal para criar novo inventário */
function abrirNovoInventario() {
    ['inv-codigo', 'inv-nome', 'inv-resp', 'inv-setor', 'inv-loja-principal', 'inv-lojas-espelho'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.value = '';
    });
    document.getElementById('inv-data').value = new Date().toISOString().slice(0, 10);
    var elCapaInicio = document.getElementById('inv-capa-inicio');
    var elCapaLote = document.getElementById('inv-capa-lote');
    if (elCapaInicio)
        elCapaInicio.value = '1';
    if (elCapaLote)
        elCapaLote.value = '200';
    document.getElementById('inv-import-fb').innerHTML = '';
    document.getElementById('inv-end-sel-wrap').style.display = 'none';
    window.AnalistaState.batch([
        window.AnalistaActions.setPath('ui.inventarioImportCtx', null, { source: 'abrirModalInventario' }),
        window.AnalistaActions.setPath('ui.selecionadosSetores', new Set(), { source: 'abrirModalInventario' })
    ]);
    // Resetar file input — sem isso, selecionar o mesmo arquivo não dispara onchange
    var fi = document.getElementById('file-inv');
    if (fi)
        fi.value = '';
    habilitarBtnCriar();
    openModal('modal-inv');
}
function habilitarBtnCriar() {
    var _a;
    var nome = (_a = document.getElementById('inv-nome')) === null || _a === void 0 ? void 0 : _a.value.trim();
    var ok = nome && state().ui.inventarioImportCtx && state().ui.inventarioImportCtx.base.length > 0;
    var btn = document.getElementById('btn-criar-inv');
    if (btn) {
        btn.disabled = !ok;
    }
}
function criarInventario() {
    var _a, _b, _c;
    var nome = document.getElementById('inv-nome').value.trim();
    if (!nome) {
        showToast('Informe o nome do inventário', 'e');
        return;
    }
    if (!state().ui.inventarioImportCtx || !state().ui.inventarioImportCtx.base.length) {
        showToast('Importe a base de dados primeiro', 'e');
        return;
    }
    // Montar lista de endereços selecionados
    // Prioridade: seleção manual > endereços únicos da base
    var endsSelecionados = [];
    if (state().ui.selecionadosSetores.size > 0) {
        state().ui.selecionadosSetores.forEach(function (s) {
            if (state().enderecosPorSetor[s])
                endsSelecionados.push.apply(endsSelecionados, state().enderecosPorSetor[s]);
        });
    }
    else {
        // Usar endereços únicos da base importada
        var endsUnicos = __spreadArray([], new Set(state().ui.inventarioImportCtx.base.map(function (r) { return r.endereco; }).filter(Boolean)), true);
        endsSelecionados = endsUnicos.map(function (e) { return ({ endereco: e }); });
    }
    // ── VALIDAÇÃO v6: remover endereços inativos da seleção ──────────────
    // Endereços inativos (ativo=false) não participam do inventário operacional.
    // Eles permanecem no cadastro (ENDDB) para consulta, mas são excluídos da contagem.
    var endsSelecionadosAtivos = endsSelecionados.filter(function (e) {
        var info = getEnderecoInfo(e.endereco || e);
        return !info || info.ativo !== false; // sem cadastro → tratado como ativo (legado)
    });
    var qtdInativos = endsSelecionados.length - endsSelecionadosAtivos.length;
    endsSelecionados = endsSelecionadosAtivos;
    // ─────────────────────────────────────────────────────────────────────
    var codigo = document.getElementById('inv-codigo').value.trim() || ('INV-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(state().inventarios.length + 1).padStart(3, '0'));
    var lojaPrincipal = document.getElementById('inv-loja-principal').value.trim();
    var lojasEspelho = (document.getElementById('inv-lojas-espelho').value || '')
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean)
        .filter(function (v, i, arr) { return arr.indexOf(v) === i && v !== lojaPrincipal; });
    var capaInicioBase = Math.max(1, parseInt(document.getElementById('inv-capa-inicio').value || '1') || 1);
    var capaLotePorOperador = Math.max(1, parseInt(document.getElementById('inv-capa-lote').value || '200') || 200);
    var inv = {
        id: gerarId('INV'),
        codigo: codigo,
        nome: nome,
        data_inicio: document.getElementById('inv-data').value || new Date().toISOString().slice(0, 10),
        responsavel: document.getElementById('inv-resp').value.trim(),
        setor: document.getElementById('inv-setor').value.trim(),
        loja_principal: lojaPrincipal,
        lojas_espelho: lojasEspelho,
        capa_inicio_base: capaInicioBase,
        capa_lote_por_operador: capaLotePorOperador,
        capa_ranges: [],
        status: 'ATIVO',
        base: __spreadArray([], state().ui.inventarioImportCtx.base, true),
        total_registros: state().ui.inventarioImportCtx.base.length,
        arquivo: state().ui.inventarioImportCtx.arquivo,
        enderecos_selecionados: endsSelecionados,
        total_enderecos: endsSelecionados.length,
        locais_selecionados: __spreadArray([], state().ui.selecionadosSetores, true),
        // Rastreabilidade de criação
        criado_em: new Date().toISOString(),
        criado_por: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'analista',
        criado_por_nome: (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.displayName) || ((_a = _currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) === null || _a === void 0 ? void 0 : _a.split('@')[0]) || 'Analista',
        fechado_em: null,
        fechado_por: null,
        fechado_por_nome: null,
        snapshot_fechamento: null,
    };
    window.AnalistaState.replaceSlice('inventarios', __spreadArray([inv], (state().inventarios || []), true), { source: 'criarInventario' });
    saveAll();
    closeModal('modal-inv');
    renderInvTable();
    renderDashboard();
    atualizarBadgesNav();
    popularSelects();
    logSistema('INVENTARIO', "Invent\u00E1rio ".concat(inv.codigo, " criado por ").concat(inv.criado_por_nome), {
        id: inv.id,
        nome: inv.nome,
        codigo: inv.codigo,
        criado_por: inv.criado_por,
        criado_por_nome: inv.criado_por_nome,
        total_registros: inv.total_registros,
        total_enderecos: inv.total_enderecos,
        inativos_excluidos: qtdInativos,
    });
    logSistema('IMPORTACAO', "Base importada: ".concat(inv.arquivo || 'arquivo', " \u2014 ").concat(inv.total_registros, " registros"), {
        inventario_id: inv.id,
        arquivo: inv.arquivo,
        total: inv.total_registros,
    });
    var msgInativos = qtdInativos > 0 ? " (".concat(qtdInativos, " endere\u00E7o(s) inativo(s) exclu\u00EDdo(s))") : '';
    showToast("\u2705 Invent\u00E1rio \"".concat(inv.nome, "\" criado! Publicando no Firebase..."), 's');
    // Publicar no Firestore para o coletor enxergar
    fsPublicarInventario(inv).then(function () {
        showToast("\u2705 Invent\u00E1rio \"".concat(inv.nome, "\" publicado! Operadores j\u00E1 podem acess\u00E1-lo."), 's');
    });
    // Publicar base de endereços para o coletor validar endereços
    fsPublicarEnderecos();
    // Publicar base de produtos extraída da base do inventário
    // Garante que coletores identifiquem GTINs mesmo de endereços de outros inventários
    if (inv.base && inv.base.length) {
        // Deduplicar por codigo_produto para não enviar duplicatas
        var prodMap_1 = {};
        inv.base.forEach(function (r) {
            var cod = String(r.codigo_produto || r.gtin || '').trim();
            if (cod && !prodMap_1[cod])
                prodMap_1[cod] = r;
        });
        var produtosUnicos = Object.values(prodMap_1);
        if (produtosUnicos.length) {
            fsPublicarProdutos(produtosUnicos).catch(function (e) {
                return console.warn('[FS] Falha ao publicar produtos:', e.message);
            });
        }
    }
    document.getElementById('btn-inv-ativo').style.display = 'inline-flex';
    document.getElementById('inv-ativo-nome').textContent = inv.codigo;
    (_c = (_b = window.AnalistaFirebaseService) === null || _b === void 0 ? void 0 : _b.start) === null || _c === void 0 ? void 0 : _c.call(_b);
    goPage('inventarios', document.getElementById('nav-inventarios'));
}
function abrirFecharInventario(id) {
    var inv = getInventarioPorId(id);
    if (!inv)
        return;
    window.AnalistaState.set('ui.inventarioFecharId', id, { source: 'prepararFechamentoInventario' });
    // Calcular pendências e divergências
    // v6: excluir endereços inativos e com limite atingido da contagem de pendências
    var contsAtivas = state().contagens.filter(function (c) { return c.inventario_id === id && !c._excluida; });
    var endsContados = new Set(contsAtivas.filter(function (c) { return !_isVazio(c); }).map(function (c) { return c.endereco; }));
    var endsVaziosConf = new Set(contsAtivas.filter(function (c) { return _isVazio(c) && c.status !== 'ESTORNADA'; }).map(function (c) { return c.endereco; }));
    var endsConferidos = new Set(__spreadArray(__spreadArray([], endsContados, true), endsVaziosConf, true));
    // Usar state().enderecosLista como base oficial
    var pendentes = [], inativos = [], limiteAtingido = [];
    state().enderecosLista.forEach(function (e) {
        var _a;
        var cod = e.endereco;
        if (e.ativo === false) {
            inativos.push(cod);
            return;
        }
        var cap = (_a = e.capacidade_paletes) !== null && _a !== void 0 ? _a : null;
        if (cap !== null && cap > 0) {
            var usados = getPaletesUsados(id, cod);
            if (usados >= cap) {
                limiteAtingido.push(cod);
                return;
            }
        }
        if (!endsConferidos.has(cod))
            pendentes.push(cod);
    });
    var divsAbertas = state().divergencias.filter(function (d) { return d.inventario_id === id && d.status === 'ABERTA'; });
    var recPend = state().recontagens.filter(function (r) { return r.inventario_id === id && r.status === 'PENDENTE'; });
    // Verificar coletores vinculados a este inventário que não encerraram o turno
    // REGRA: qualquer coletor que participou deste inventário e não encerrou o turno bloqueia o fechamento
    var coletoresPendentes = state().coletores.filter(function (c) {
        var _a;
        return (((_a = c.sessao) === null || _a === void 0 ? void 0 : _a.inventario_id) === id || c.ultimo_inventario_id === id) &&
            !c.turno_encerrado;
    });
    var alertas = '';
    var bloqueioCritico = false;
    if (pendentes.length > 0) {
        alertas += "<div class=\"alert warn\" style=\"margin-bottom:10px\">\u26A0\uFE0F <strong>".concat(pendentes.length, " endere\u00E7o(s)</strong> ainda n\u00E3o foram contados!</div>");
    }
    if (divsAbertas.length > 0) {
        alertas += "<div class=\"alert danger\" style=\"margin-bottom:10px\">\uD83D\uDEAB <strong>".concat(divsAbertas.length, " diverg\u00EAncia(s)</strong> abertas! Resolva todas antes de fechar.</div>");
        bloqueioCritico = true;
    }
    if (recPend.length > 0) {
        alertas += "<div class=\"alert danger\" style=\"margin-bottom:10px\">\uD83D\uDEAB <strong>".concat(recPend.length, " recontagem(ns)</strong> pendentes! Finalize as rodadas antes de fechar.</div>");
        bloqueioCritico = true;
    }
    if (coletoresPendentes.length > 0) {
        alertas += "<div class=\"alert danger\" style=\"margin-bottom:10px\">\uD83D\uDEAB <strong>".concat(coletoresPendentes.length, " coletor(es)</strong> ainda n\u00E3o encerraram o turno! Todos os coletores devem encerrar o turno antes de fechar o invent\u00E1rio.</div>");
        bloqueioCritico = true;
    }
    if (!alertas) {
        alertas = "<div class=\"alert success\">\u2705 Tudo conferido! Invent\u00E1rio pode ser fechado com seguran\u00E7a.</div>";
    }
    // Desabilitar botão de fechamento se houver bloqueio crítico
    var btnFechar = document.getElementById('btn-confirmar-fechar');
    if (btnFechar) {
        btnFechar.disabled = bloqueioCritico;
        btnFechar.style.opacity = bloqueioCritico ? '0.5' : '1';
        btnFechar.title = bloqueioCritico ? 'Resolva as pendências críticas para habilitar o fechamento' : '';
    }
    document.getElementById('fechar-inv-alertas').innerHTML = alertas;
    document.getElementById('fechar-inv-resumo').innerHTML = "\n    <div style=\"background:#f8fafc;border-radius:8px;padding:14px;font-size:.83rem;margin-top:8px\">\n      <div style=\"font-weight:700;margin-bottom:8px\">Resumo \u2014 ".concat(escHTML(inv.nome), "</div>\n      <div style=\"display:grid;grid-template-columns:1fr 1fr;gap:6px\">\n        <div>\uD83D\uDCCD Endere\u00E7os: <strong>").concat(inv.total_enderecos || 0, "</strong></div>\n        <div>\u2705 Contados: <strong>").concat(endsContados.size, "</strong></div>\n        ").concat(endsVaziosConf.size > 0 ? "<div>\uD83D\uDD32 Vazios conf.: <strong>".concat(endsVaziosConf.size, "</strong></div>") : '', "\n        <div>\u23F3 Pendentes: <strong>").concat(pendentes.length, "</strong></div>\n        <div>\u26A0\uFE0F Em Conflito: <strong>").concat(divsAbertas.length, "</strong></div>\n        ").concat(inativos.length > 0 ? "<div>\uD83D\uDEAB Inativos: <strong>".concat(inativos.length, "</strong></div>") : '', "\n        ").concat(limiteAtingido.length > 0 ? "<div>\uD83D\uDD12 Limite: <strong>".concat(limiteAtingido.length, "</strong></div>") : '', "\n      </div>\n    </div>");
    openModal('modal-fechar-inv');
}
function confirmarFecharInventario() {
    var inv = getInventarioPorId(state().ui.inventarioFecharId);
    if (!inv)
        return;
    var agora = new Date().toISOString();
    var emailAnalista = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || 'analista';
    var nomeAnalista = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.displayName) || emailAnalista;
    inv.status = 'FECHADO';
    inv.fechado_em = agora;
    inv.fechado_por = emailAnalista;
    inv.fechado_por_nome = nomeAnalista;
    // Ao fechar o inventário, resetamos o status de turno dos coletores para o próximo
    state().coletores.forEach(function (c) {
        var _a;
        if (((_a = c.sessao) === null || _a === void 0 ? void 0 : _a.inventario_id) === inv.id || c.ultimo_inventario_id === inv.id) {
            c.turno_encerrado = false;
            FS_AN.collection(FS_COL_COLETORES).doc(c.id).update({ turno_encerrado: false }).catch(function () { });
        }
    });
    // Snapshot de fechamento para auditoria completa
    var contsInv = state().contagens.filter(function (c) { return c.inventario_id === inv.id; });
    var contsAtivas = contsInv.filter(function (c) { return !c._excluida && c.status !== 'ESTORNADA'; });
    var divsInv = state().divergencias.filter(function (d) { return d.inventario_id === inv.id; });
    var recsInv = state().recontagens.filter(function (r) { return r.inventario_id === inv.id; });
    inv.snapshot_fechamento = {
        total_contagens: contsAtivas.length,
        total_contagens_estornadas: contsInv.filter(function (c) { return c.status === 'ESTORNADA'; }).length,
        total_divergencias: divsInv.length,
        divergencias_abertas: divsInv.filter(function (d) { return d.status === 'ABERTA'; }).length,
        divergencias_resolvidas: divsInv.filter(function (d) { return d.status === 'RESOLVIDA'; }).length,
        total_recontagens: recsInv.length,
        recontagens_concluidas: recsInv.filter(function (r) { return r.status === 'CONCLUIDA'; }).length,
        recontagens_pendentes: recsInv.filter(function (r) { return r.status === 'PENDENTE'; }).length,
        total_vazios: contsAtivas.filter(function (c) { return _isVazio(c); }).length,
        operadores_envolvidos: __spreadArray([], new Set(contsAtivas.map(function (c) { return c.operador; }).filter(Boolean)), true),
        gerado_em: agora,
    };
    saveAll();
    closeModal('modal-fechar-inv');
    renderInvTable();
    renderDashboard();
    atualizarBadgesNav();
    logSistema('FECHAMENTO', "Invent\u00E1rio ".concat(inv.codigo, " fechado por ").concat(nomeAnalista), {
        id: inv.id,
        nome: inv.nome,
        codigo: inv.codigo,
        fechado_em: agora,
        fechado_por: emailAnalista,
        fechado_por_nome: nomeAnalista,
        snapshot: inv.snapshot_fechamento,
    });
    showToast("\uD83D\uDD12 Invent\u00E1rio \"".concat(inv.codigo, "\" encerrado! Novas contagens bloqueadas."), 'w');
    // Atualizar status + snapshot no Firestore
    fsAtualizarStatusInventario(inv);
    // Salvar ranking final do inventário encerrado
    setTimeout(function () { return fsSalvarRankingOperadores(); }, 1000);
}
function pausarInventario(id) {
    var _a, _b;
    var inv = getInventarioPorId(id);
    if (!inv)
        return;
    inv.status = inv.status === 'PAUSADO' ? 'ATIVO' : 'PAUSADO';
    saveAll();
    renderInvTable();
    logSistema('INVENTARIO', "Invent\u00E1rio ".concat(inv.codigo, " ").concat(inv.status === 'ATIVO' ? 'reativado' : 'pausado'), { id: id });
    showToast(inv.status === 'ATIVO' ? '▶️ Inventário reativado' : '⏸ Inventário pausado', 'w');
    // Sincronizar status no Firestore
    fsAtualizarStatusInventario(inv);
    (_b = (_a = window.AnalistaFirebaseService) === null || _a === void 0 ? void 0 : _a.start) === null || _b === void 0 ? void 0 : _b.call(_a);
}
function toggleInvVisibilidade(id) {
    return __awaiter(this, void 0, void 0, function () {
        var inv, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    inv = getInventarioPorId(id);
                    if (!inv)
                        return [2 /*return*/];
                    inv.oculto_coletor = !inv.oculto_coletor;
                    saveAll();
                    renderInvTable();
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS_AN.collection(FS_COL).doc(id).update({ oculto_coletor: inv.oculto_coletor })];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    e_1 = _a.sent();
                    console.warn('[Visibilidade]', e_1.message);
                    return [3 /*break*/, 4];
                case 4:
                    showToast(inv.oculto_coletor ? '🙈 Inventário ocultado nos coletores' : '👁 Inventário visível nos coletores', inv.oculto_coletor ? 'w' : 's');
                    logSistema('INVENTARIO', "Invent\u00E1rio ".concat(inv.codigo, " ").concat(inv.oculto_coletor ? 'ocultado' : 'mostrado', " no coletor"), { id: id });
                    return [2 /*return*/];
            }
        });
    });
}
function verBase(id) {
    var _a;
    var inv = getInventarioPorId(id);
    if (!inv || !((_a = inv.base) === null || _a === void 0 ? void 0 : _a.length)) {
        showToast('Base vazia ou não encontrada', 'w');
        return;
    }
    document.getElementById('modal-base-title').textContent = "\uD83D\uDCC2 Base da Auditoria \u2014 ".concat(inv.nome);
    var cols = ['endereco', 'codigo_produto', 'descricao_produto', 'quantidade_esperada', 'setor', 'pallete_ou_capa'];
    document.getElementById('modal-base-content').innerHTML = "\n    <div style=\"font-size:.78rem;color:var(--muted);margin-bottom:10px\">".concat(inv.base.length.toLocaleString('pt-BR'), " registros \u00B7 ").concat(inv.arquivo || 'Importado', "</div>\n    <div class=\"preview-wrap\" style=\"max-height:360px\">\n      <table class=\"preview-table\">\n        <thead><tr>").concat(cols.map(function (c) { return "<th>".concat(c.replace(/_/g, ' '), "</th>"); }).join(''), "</tr></thead>\n        <tbody>").concat(inv.base.slice(0, 200).map(function (r) { return "<tr>".concat(cols.map(function (c) { return "<td>".concat(r[c] || '—', "</td>"); }).join(''), "</tr>"); }).join(''), "</tbody>\n      </table>\n    </div>\n    ").concat(inv.base.length > 200 ? "<div style=\"text-align:center;padding:10px;font-size:.75rem;color:var(--muted)\">Exibindo primeiros 200 de ".concat(inv.base.length.toLocaleString('pt-BR'), " registros</div>") : '');
    window._baseExportInvId = id;
    openModal('modal-base');
}
function exportarBaseAtual() {
    var _a;
    var id = window._baseExportInvId;
    var inv = getInventarioPorId(id);
    if (!inv || !((_a = inv.base) === null || _a === void 0 ? void 0 : _a.length))
        return;
    exportCSVData(inv.base, "base_".concat(inv.codigo, ".csv"));
}
