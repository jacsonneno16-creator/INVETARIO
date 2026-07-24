// ═══════════════════════════════════════════════════
//  INVENTÁRIOS  (Firestore)
// ═══════════════════════════════════════════════════
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
function abrirModoInventario() {
    APP.modoAcesso = 'inventario';
    APP.modoPendente = 'inventario';
    goScreen('inventarios');
    carregarInventarios();
}
function abrirModoAuditoria() {
    APP.modoAcesso = 'auditoria';
    APP.modoPendente = 'auditoria';
    goScreen('auditorias');
    carregarAuditoriasMenu();
}
function _extrairLojasDoInventario(inv) {
    var lojas = [];
    var principal = String((inv === null || inv === void 0 ? void 0 : inv.loja_principal) || '').trim();
    if (principal)
        lojas.push(principal);
    var espelho = Array.isArray(inv === null || inv === void 0 ? void 0 : inv.lojas_espelho) ? inv.lojas_espelho : [];
    espelho.forEach(function (loja) {
        loja = String(loja || '').trim();
        if (loja && !lojas.includes(loja))
            lojas.push(loja);
    });
    return lojas;
}
function _getOperadorLojasPermitidas() {
    var op = APP.operador || {};
    var raw = op.lojas_permitidas || op.lojasPermitidas || [];
    if (!Array.isArray(raw))
        return [];
    return __spreadArray([], new Set(raw.map(function (v) { return String(v || '').trim(); }).filter(Boolean)), true);
}
function _operadorTemAcessoTotalLojas() {
    var op = APP.operador || {};
    return op.acesso_todas_lojas === true || op.acessoTodasLojas === true;
}
function _filtrarInventariosPorAcessoOperador(lista) {
    var base = Array.isArray(lista) ? lista : [];
    if (_operadorTemAcessoTotalLojas())
        return base;
    var permitidas = _getOperadorLojasPermitidas();
    if (!permitidas.length)
        return base;
    return base.filter(function (inv) { return _extrairLojasDoInventario(inv).some(function (loja) { return permitidas.includes(loja); }); });
}
function _popularSelectLojasColetor(lista, selectId, valorAtual) {
    var sel = document.getElementById(selectId);
    if (!sel)
        return;
    var acessiveis = _filtrarInventariosPorAcessoOperador(lista || []);
    var lojas = __spreadArray([], new Set(acessiveis.flatMap(_extrairLojasDoInventario).filter(Boolean)), true).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    sel.innerHTML = '<option value="">Todas as lojas</option>' + lojas.map(function (loja) { return "<option value=\"".concat(escHTML(loja), "\">").concat(escHTML(loja), "</option>"); }).join('');
    sel.value = lojas.includes(valorAtual) ? valorAtual : '';
}
function _filtrarInventariosPorLoja(lista, loja) {
    var alvo = String(loja || '').trim();
    if (!alvo)
        return lista || [];
    return (lista || []).filter(function (inv) { return _extrairLojasDoInventario(inv).includes(alvo); });
}
function aplicarFiltroLojaInventario(loja) {
    APP.lojaFiltroInventario = String(loja || '').trim();
    renderListaInventarios(APP.inventariosDisponiveis || []);
}
function _ajustarVisibilidadeFiltroLoja(cardId, lista) {
    var card = document.getElementById(cardId);
    if (!card)
        return;
    var acessiveis = _filtrarInventariosPorAcessoOperador(lista || []);
    var lojas = __spreadArray([], new Set(acessiveis.flatMap(_extrairLojasDoInventario).filter(Boolean)), true);
    card.style.display = lojas.length > 1 ? '' : 'none';
}
function carregarInventarios() {
    var el = document.getElementById('inv-list');
    el.innerHTML = '<div class="empty-inv"><div class="empty-inv-icon" style="font-size:1.5rem">⏳</div><div>Carregando inventários…</div></div>';
    if (!navigator.onLine) {
        var cache = invCacheLoad().filter(function (i) {
            var s = (i.status || '').toUpperCase();
            return s === 'ATIVO' || s === 'PAUSADO';
        });
        APP.inventariosDisponiveis = cache;
        renderListaInventarios(cache);
        return;
    }
    FS.collection(FCOL.inventarios)
        .where('status', 'in', ['ATIVO', 'PAUSADO', 'Ativo', 'Pausado'])
        .get()
        .then(function (snap) {
        dbg('[Firestore] inventários encontrados:', snap.size);
        var lista = snap.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); })
            .filter(function (i) { return !i.oculto_coletor; }); // 🙈 ocultos pelo analista não aparecem
        APP.inventariosDisponiveis = lista;
        invCacheSave(lista);
        limparInventariosObsoletos(lista.map(function (i) { return i.id; })); // 🗑 remove cache de inv. excluídos
        renderListaInventarios(lista);
    })
        .catch(function (err) {
        console.error('[Firestore] erro:', err.code, err.message);
        // Tentar sem filtro para diagnóstico
        FS.collection(FCOL.inventarios).limit(5).get()
            .then(function (snap2) {
            dbg('[Firestore] sem filtro:', snap2.size, 'docs');
            var lista2 = snap2.docs.map(function (d) { return (__assign({ id: d.id }, d.data())); });
            if (lista2.length) {
                // Coleção existe mas ou regra bloqueou a query com where, ou status difere
                var ativos = lista2.filter(function (i) { return i.status === 'ATIVO'; });
                if (ativos.length) {
                    APP.inventariosDisponiveis = ativos;
                    renderListaInventarios(ativos);
                    return;
                }
                // Mostrar o que existe para diagnóstico
                var statusList = lista2.map(function (i) { return i.status || '?'; }).join(', ');
                el.innerHTML = "<div class=\"empty-inv\" style=\"gap:8px\">\n              <div class=\"empty-inv-icon\">\u26A0\uFE0F</div>\n              <div style=\"font-size:.85rem;font-weight:600\">Nenhum invent\u00E1rio com status ATIVO</div>\n              <div style=\"font-size:.72rem;color:var(--muted);text-align:center\">Encontrados ".concat(lista2.length, " doc(s) com status: ").concat(statusList, "</div>\n              <div style=\"font-size:.72rem;color:var(--muted);text-align:center\">Pe\u00E7a ao analista para clicar em \"\uD83D\uDD25 Sync Firebase\"</div>\n            </div>");
            }
            else {
                el.innerHTML = "<div class=\"empty-inv\" style=\"gap:8px\">\n              <div class=\"empty-inv-icon\">\u274C</div>\n              <div style=\"font-size:.85rem;font-weight:600\">Erro de conex\u00E3o com Firebase</div>\n              <div style=\"font-size:.72rem;color:#f87171;text-align:center;word-break:break-all\">".concat(err.code || err.message, "</div>\n              <div style=\"font-size:.72rem;color:var(--muted);text-align:center;margin-top:4px\">Verifique as regras de seguran\u00E7a do Firestore ou a conex\u00E3o</div>\n              <button onclick=\"carregarInventarios()\" style=\"margin-top:8px;background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:.8rem;cursor:pointer\">Tentar novamente</button>\n            </div>");
            }
        })
            .catch(function (err2) {
            // Fallback para cache local
            var cache = invCacheLoad().filter(function (i) {
                var s = (i.status || '').toUpperCase();
                return s === 'ATIVO' || s === 'PAUSADO';
            });
            APP.inventariosDisponiveis = cache;
            if (cache.length) {
                renderListaInventarios(cache);
                toast('Carregado do cache local (offline)', 'w');
            }
            else {
                el.innerHTML = "<div class=\"empty-inv\" style=\"gap:8px\">\n              <div class=\"empty-inv-icon\">\u274C</div>\n              <div style=\"font-size:.85rem;font-weight:600\">Sem acesso ao Firebase</div>\n              <div style=\"font-size:.72rem;color:#f87171;text-align:center\">".concat(err2.code, ": ").concat(err2.message, "</div>\n              <button onclick=\"carregarInventarios()\" style=\"margin-top:8px;background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:.8rem;cursor:pointer\">Tentar novamente</button>\n            </div>");
            }
        });
    });
}
function renderListaInventarios(lista) {
    var el = document.getElementById('inv-list');
    _ajustarVisibilidadeFiltroLoja('inv-loja-card', lista);
    _popularSelectLojasColetor(lista, 'inv-loja-select', APP.lojaFiltroInventario);
    lista = _filtrarInventariosPorAcessoOperador(lista);
    lista = _filtrarInventariosPorLoja(lista, APP.lojaFiltroInventario);
    if (!lista.length) {
        el.innerHTML = "\n      <div class=\"empty-inv\">\n        <div class=\"empty-inv-icon\">\uD83D\uDCE6</div>\n        <div style=\"font-size:.9rem;font-weight:600\">Nenhum invent\u00E1rio ativo</div>\n        <div style=\"font-size:.78rem;margin-top:6px\">Aguarde o analista abrir um invent\u00E1rio</div>\n      </div>";
        return;
    }
    el.innerHTML = lista.map(function (inv) { return "\n    <div class=\"inv-card\" onclick=\"selecionarInventario('".concat(inv.id, "','inventario')\">\n      <div class=\"inv-card-code\">").concat(escHTML(inv.codigo || inv.id), "</div>\n      <div class=\"inv-card-name\">").concat(escHTML(inv.nome), "</div>\n      <div class=\"inv-card-meta\">\n        <span class=\"badge badge-ok\">\u25CF ATIVO</span>\n        <span class=\"badge badge-info\">").concat(inv.total_registros || 0, " registros</span>\n        <span class=\"badge badge-muted\">").concat(inv.data_inicio || '', "</span>\n        ").concat(inv.total_enderecos ? "<span class=\"badge badge-muted\">\uD83D\uDCCD ".concat(inv.total_enderecos, " end.</span>") : '', "\n      </div>\n    </div>\n  "); }).join('');
}
// ─── Versão/timestamp da base no Firestore ──────────────────
function _invBaseVer(docData) {
    // Usar updated_at, data_atualizacao, base_version ou total_registros como proxy de versão
    return String(docData.updated_at || docData.data_atualizacao ||
        docData.base_version || docData.base_chunks || docData.total_registros || '');
}
function selecionarInventario(id, modo) {
    if (modo === void 0) { modo = 'inventario'; }
    APP.modoPendente = modo || 'inventario';
    var inv = (APP.inventariosDisponiveis || []).find(function (i) { return i.id === id; });
    if (!inv) {
        toast('Inventário não encontrado', 'e');
        return;
    }
    // ── Melhoria 5: verificar se base local já existe e está atualizada ──
    var metaLocal = baseMetaLoad(id);
    var verLocal = bVerLoad(id);
    var verServidor = _invBaseVer(inv);
    var baseLocal = metaLocal ? baseLoad(id) : null;
    var capLocal = endCapLoad(id);
    var cacheValido = (baseLocal &&
        baseLocal.length > 0 &&
        // Cache é válido se a versão bate OU se não há versão para comparar
        (verServidor === '' || verLocal === verServidor));
    if (cacheValido) {
        // ── Usar cache local — sem download ──────────────────────
        dbg('[cache] base local válida —', baseLocal.length, 'registros, ver:', verLocal);
        APP.inventario = inv;
        APP.base = baseLocal;
        // Capacidade: começar com o que a base tem, depois sobrepor com dt_locais (fonte principal)
        var capMapa_1 = _recalcularEndCap(baseLocal);
        try {
            var cached = localStorage.getItem(LS_LOCAIS);
            if (cached) {
                var locaisMap = JSON.parse(cached);
                Object.entries(locaisMap).forEach(function (_a) {
                    var k = _a[0], v = _a[1];
                    if (v > 0)
                        capMapa_1[k] = v;
                });
                dbg('[dt_locais cache] mesclado:', Object.values(capMapa_1).filter(function (v) { return v > 0; }).length, 'com cap');
            }
        }
        catch (e) { }
        APP.endCapacidade = capMapa_1;
        endCapSave(id, capMapa_1);
        // Restaurar set de endereços válidos do cache
        try {
            var cs = localStorage.getItem(LS_LOCAIS + '_set');
            APP.locaisAtivos = cs ? new Set(JSON.parse(cs)) : new Set(baseLocal.map(function (r) { return r._end; }).filter(Boolean));
        }
        catch (e) {
            APP.locaisAtivos = new Set(baseLocal.map(function (r) { return r._end; }).filter(Boolean));
        }
        APP.proximoCapa = calcularProximoCapa();
        _aplicarInventario(inv, APP.modoPendente || 'inventario');
        toast("\u2705 Base local carregada (".concat(baseLocal.length, " registros)"), 's');
        return;
    }
    // ── Precisa baixar: sem cache ou versão desatualizada ─────
    dbg('[cache] download necessário — cacheValido:', cacheValido, 'ver local:', verLocal, 'servidor:', verServidor);
    _iniciarTelaDowload(inv);
}
function _iniciarTelaDowload(inv) {
    document.getElementById('dl-inv-nome').textContent = inv.nome || inv.id;
    document.getElementById('dl-status-txt').textContent = 'Preparando download…';
    document.getElementById('dl-bar-fg').style.width = '0%';
    document.getElementById('dl-pct').textContent = '0%';
    document.getElementById('dl-steps').innerHTML = '';
    var btnEntrar = document.getElementById('dl-btn-entrar');
    var btnCancel = document.getElementById('dl-btn-cancel');
    var dlErro = document.getElementById('dl-erro');
    if (btnEntrar)
        btnEntrar.style.display = 'none';
    if (btnCancel)
        btnCancel.style.display = '';
    if (dlErro)
        dlErro.style.display = 'none';
    document.getElementById('dl-icon').textContent = '📦';
    goScreen('download');
    _executarDownload(inv).catch(function (err) { return _dlSetErro('Falha: ' + (err.message || err)); });
}
function _atualizarHintCapa() {
    var hintEl = document.getElementById('cp-proximo-hint');
    if (!hintEl)
        return;
    var range = APP.capaRange;
    hintEl.textContent = ((range === null || range === void 0 ? void 0 : range.min) && (range === null || range === void 0 ? void 0 : range.max))
        ? "Range: ".concat(range.min, "\u2013").concat(range.max, " \u00B7 Pr\u00F3ximo: ").concat(APP.proximoCapa)
        : 'Próximo disponível: ' + APP.proximoCapa;
}
function _chaveOperadorCapa() {
    var op = APP.operador || {};
    return String(op.uid || op.id || op.email || op.name || '').trim().toLowerCase();
}
function _rangePertenceOperador(r, chave, nome, email) {
    if (!r)
        return false;
    var rk = String(r.operador_chave || r.operador_uid || r.operador_email || '').trim().toLowerCase();
    if (rk && chave && rk === chave)
        return true;
    var re = String(r.operador_email || '').trim().toLowerCase();
    if (re && email && re === email)
        return true;
    return String(r.operador || '').trim() === nome;
}
function garantirRangeCapaOperador(inv) {
    return __awaiter(this, void 0, void 0, function () {
        var op, nomeOp, emailOp, chaveOp, inicioBase, lotePorOperador, listaAtual, meuRange, ref_1, rangeGerado_1, e_1;
        var _this = this;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    op = APP.operador || {};
                    nomeOp = String(op.name || op.email || '').trim();
                    emailOp = String(op.email || '').trim().toLowerCase();
                    chaveOp = _chaveOperadorCapa();
                    inicioBase = Math.max(1, parseInt((_b = (_a = inv === null || inv === void 0 ? void 0 : inv.capa_inicio_base) !== null && _a !== void 0 ? _a : inv === null || inv === void 0 ? void 0 : inv.capa_inicio) !== null && _b !== void 0 ? _b : 1) || 1);
                    lotePorOperador = 200;
                    listaAtual = Array.isArray(inv === null || inv === void 0 ? void 0 : inv.capa_ranges) ? inv.capa_ranges.slice() : [];
                    meuRange = listaAtual.find(function (r) { return _rangePertenceOperador(r, chaveOp, nomeOp, emailOp); });
                    if (meuRange) {
                        APP.capaRange = { min: parseInt(meuRange.min) || inicioBase, max: parseInt(meuRange.max) || (inicioBase + 199) };
                        APP.proximoCapa = calcularProximoCapa();
                        _atualizarHintCapa();
                        return [2 /*return*/, APP.capaRange];
                    }
                    if (!(inv === null || inv === void 0 ? void 0 : inv.id) || !chaveOp || !navigator.onLine) {
                        APP.capaRange = null;
                        APP.proximoCapa = calcularProximoCapa();
                        _atualizarHintCapa();
                        return [2 /*return*/, null];
                    }
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    ref_1 = FS.collection(FCOL.inventarios).doc(inv.id);
                    rangeGerado_1 = null;
                    return [4 /*yield*/, FS.runTransaction(function (tx) { return __awaiter(_this, void 0, void 0, function () {
                            var snap, data, ranges, existente, maiorFim, min, max;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, tx.get(ref_1)];
                                    case 1:
                                        snap = _a.sent();
                                        data = snap.exists ? (snap.data() || {}) : {};
                                        ranges = Array.isArray(data.capa_ranges) ? data.capa_ranges.slice() : [];
                                        existente = ranges.find(function (r) { return _rangePertenceOperador(r, chaveOp, nomeOp, emailOp); });
                                        if (existente) {
                                            rangeGerado_1 = existente;
                                            return [2 /*return*/];
                                        }
                                        maiorFim = ranges.reduce(function (acc, r) { return Math.max(acc, parseInt(r === null || r === void 0 ? void 0 : r.max) || 0); }, inicioBase - 1);
                                        min = Math.max(inicioBase, maiorFim + 1);
                                        max = min + 199;
                                        rangeGerado_1 = {
                                            operador: nomeOp,
                                            operador_chave: chaveOp,
                                            operador_uid: String(op.uid || op.id || ''),
                                            operador_email: emailOp,
                                            min: min,
                                            max: max,
                                            lote: 200,
                                            criado_em: new Date().toISOString()
                                        };
                                        ranges.push(rangeGerado_1);
                                        tx.set(ref_1, {
                                            capa_ranges: ranges,
                                            capa_inicio_base: inicioBase,
                                            capa_lote_por_operador: 200,
                                            atualizado_em: new Date()
                                        }, { merge: true });
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 2:
                    _c.sent();
                    if (rangeGerado_1) {
                        inv.capa_ranges = Array.isArray(inv.capa_ranges) ? inv.capa_ranges : [];
                        if (!inv.capa_ranges.some(function (r) { return _rangePertenceOperador(r, chaveOp, nomeOp, emailOp); }))
                            inv.capa_ranges.push(rangeGerado_1);
                        APP.capaRange = { min: parseInt(rangeGerado_1.min) || inicioBase, max: parseInt(rangeGerado_1.max) || (inicioBase + 199) };
                    }
                    else
                        APP.capaRange = null;
                    return [3 /*break*/, 4];
                case 3:
                    e_1 = _c.sent();
                    console.warn('[capa] Falha ao reservar range automático:', (e_1 === null || e_1 === void 0 ? void 0 : e_1.message) || e_1);
                    APP.capaRange = null;
                    return [3 /*break*/, 4];
                case 4:
                    APP.proximoCapa = calcularProximoCapa();
                    _atualizarHintCapa();
                    return [2 /*return*/, APP.capaRange];
            }
        });
    });
}
function _aplicarInventario(inv_1) {
    return __awaiter(this, arguments, void 0, function (inv, modo) {
        var tabs, el, audTab, contTab;
        if (modo === void 0) { modo = 'inventario'; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    document.getElementById('app-inv-name').textContent = inv.nome || inv.id;
                    APP.contagens = [];
                    APP.contagensOutros = [];
                    APP.recontagens = [];
                    APP.divergenciasAtribuidas = [];
                    APP.modoRecontagem = null;
                    APP.recPalletAtual = 1;
                    APP.sessionStart = new Date();
                    APP.sessaoId = gerarUUID();
                    _recJaAtivouAba = false;
                    // Carregar / reservar range de capa palete do inventário
                    return [4 /*yield*/, garantirRangeCapaOperador(inv)];
                case 1:
                    // Carregar / reservar range de capa palete do inventário
                    _a.sent();
                    APP.modoAcesso = modo || 'inventario';
                    // No modo inventário, auditoriaBase fica vazio (aba auditoria oculta no modo inventário)
                    APP.auditoriaBase = [];
                    // Iniciar listener de recontagens em tempo real
                    setTimeout(function () { return iniciarListenerRecontagens(inv.id); }, 0);
                    setTimeout(function () { return iniciarListenerAuditoria(inv.id); }, 0);
                    tabs = {
                        contar: document.getElementById('tab-contar'),
                        historico: document.getElementById('tab-historico'),
                        recontagens: document.getElementById('tab-recontagens'),
                        estorno: document.getElementById('tab-estorno'),
                        auditoria: document.getElementById('tab-auditoria'),
                        status: document.getElementById('tab-status')
                    };
                    if (APP.modoAcesso === 'auditoria') {
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
                    }
                    else {
                        if (tabs.contar)
                            tabs.contar.style.display = '';
                        if (tabs.historico)
                            tabs.historico.style.display = '';
                        if (tabs.recontagens)
                            tabs.recontagens.style.display = '';
                        if (tabs.estorno)
                            tabs.estorno.style.display = '';
                        // Aba de auditoria sempre oculta no modo inventário — só aparece no modo auditoria
                        if (tabs.auditoria)
                            tabs.auditoria.style.display = 'none';
                        if (tabs.status)
                            tabs.status.style.display = '';
                    }
                    resetContagem();
                    updateStats();
                    atualizarBarraStatus();
                    el = document.getElementById('st-inicio');
                    if (el)
                        el.textContent = fmtTime(APP.sessionStart);
                    goScreen('app');
                    if (APP.modoAcesso === 'auditoria') {
                        audTab = document.getElementById('tab-auditoria');
                        if (audTab)
                            showView('auditoria', audTab);
                        renderAuditoriaColetor();
                    }
                    else {
                        contTab = document.getElementById('tab-contar');
                        if (contTab)
                            showView('contar', contTab);
                    }
                    return [2 /*return*/];
            }
        });
    });
}
// ─── Cancelar / Entrar após download ─────────────────────────
var _dlCancelado = false;
function cancelarDownload() {
    _dlCancelado = true;
    APP.inventario = null;
    if (APP.modoPendente === 'auditoria') {
        goScreen('auditorias');
    }
    else {
        goScreen('inventarios');
    }
}
function entrarInventario() {
    _aplicarInventario(APP.inventario, APP.modoPendente || APP.modoAcesso || 'inventario');
}
// ─── Motor de download ────────────────────────────────────────
function _executarDownload(inv) {
    return __awaiter(this, void 0, void 0, function () {
        var invId, baseLocal, docData, snap, e_2, nChunks, baseRaw, cSnap, total, i, itens, pct, e_3, baseNorm, endCapMapa, _forceLocaisRefresh, versaoServidor, metaDoc, e_4, versaoLocal, _cacheValido, raw, rawSet, motivo, locaisSet_1, chunksSnap, docsUsar, e_5, raw, rawSet, comLimite;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    invId = inv.id;
                    _dlCancelado = false;
                    baseLocal = baseLoad(invId);
                    if (!navigator.onLine && baseLocal && baseLocal.length > 0) {
                        _dlStep('offline', '💾', 'Modo offline', baseLocal.length + ' registros do cache', 'ok');
                        _dlProg(100, 'Pronto (offline)');
                        APP.inventario = inv;
                        APP.base = baseLocal;
                        APP.endCapacidade = _recalcularEndCap(baseLocal);
                        endCapSave(invId, APP.endCapacidade);
                        _concluirDownload(baseLocal.length);
                        return [2 /*return*/];
                    }
                    // Etapa 1: metadados
                    _dlProg(10, 'Baixando metadados…');
                    _dlStep('meta', '📋', 'Metadados', 'Carregando…', 'run');
                    if (_dlCancelado)
                        return [2 /*return*/];
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, FS.collection(FCOL.inventarios).doc(invId).get()];
                case 2:
                    snap = _c.sent();
                    if (!snap.exists)
                        throw new Error('Inventário não encontrado');
                    docData = __assign({ id: snap.id }, snap.data());
                    return [3 /*break*/, 4];
                case 3:
                    e_2 = _c.sent();
                    _dlStep('meta', '📋', 'Metadados', 'Erro: ' + e_2.message, 'err');
                    if (baseLocal && baseLocal.length > 0) {
                        APP.base = baseLocal;
                        APP.endCapacidade = _recalcularEndCap(baseLocal);
                        endCapSave(invId, APP.endCapacidade);
                        _dlProg(100, 'Usando cache local');
                        _concluirDownload(baseLocal.length);
                        return [2 /*return*/];
                    }
                    throw e_2;
                case 4:
                    _dlStep('meta', '📋', 'Metadados', (docData.total_registros || '?') + ' registros · ' + (docData.total_enderecos || '?') + ' endereços', 'ok');
                    _dlProg(20);
                    if (_dlCancelado)
                        return [2 /*return*/];
                    // Etapa 2: base de produtos (chunks)
                    _dlProg(25, 'Baixando base de produtos…');
                    _dlStep('base', '📦', 'Base de produtos', 'Carregando…', 'run');
                    nChunks = docData.base_chunks || 0;
                    baseRaw = [];
                    if (!(nChunks > 0)) return [3 /*break*/, 9];
                    _c.label = 5;
                case 5:
                    _c.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, FS.collection(FCOL.inventarios).doc(invId)
                            .collection('base_chunks').orderBy('parte').get()];
                case 6:
                    cSnap = _c.sent();
                    total = cSnap.docs.length;
                    for (i = 0; i < total; i++) {
                        if (_dlCancelado)
                            return [2 /*return*/];
                        itens = cSnap.docs[i].data().itens || cSnap.docs[i].data().registros || [];
                        baseRaw = baseRaw.concat(itens);
                        pct = 25 + Math.round(60 * (i + 1) / total);
                        _dlProg(pct, "Chunk ".concat(i + 1, "/").concat(total, " \u2014 ").concat(baseRaw.length, " registros"));
                        _dlStep('base', '📦', 'Base de produtos', baseRaw.length + ' registros…', 'run');
                    }
                    return [3 /*break*/, 8];
                case 7:
                    e_3 = _c.sent();
                    _dlStep('base', '📦', 'Base de produtos', 'Erro: ' + e_3.message, 'err');
                    if (baseLocal && baseLocal.length > 0) {
                        APP.base = baseLocal;
                        APP.endCapacidade = _recalcularEndCap(baseLocal);
                        endCapSave(invId, APP.endCapacidade);
                        _concluirDownload(baseLocal.length);
                        return [2 /*return*/];
                    }
                    throw e_3;
                case 8: return [3 /*break*/, 10];
                case 9:
                    if (Array.isArray(docData.base)) {
                        baseRaw = docData.base;
                        _dlProg(85, baseRaw.length + ' registros no documento');
                    }
                    else {
                        _dlStep('base', '📦', 'Base de produtos', 'Base não encontrada no servidor!', 'err');
                        _dlSetErro('A base deste inventário não foi publicada ainda. Peça ao analista para publicar o inventário no sistema.');
                        return [2 /*return*/]; // bloquear entrada sem base
                    }
                    _c.label = 10;
                case 10:
                    // ── NORMALIZAR A BASE (melhoria 1+2) ──
                    _dlStep('norm', '🔧', 'Normalizando campos', 'Padronizando nomes de colunas…', 'run');
                    _dlProg(87, 'Normalizando…');
                    baseNorm = normalizarBase(baseRaw);
                    _dlStep('norm', '🔧', 'Normalizando campos', "".concat(baseNorm.length, " registros normalizados"), 'ok');
                    _dlStep('base', '📦', 'Base de produtos', baseNorm.length + ' registros', 'ok');
                    _dlProg(90);
                    if (_dlCancelado)
                        return [2 /*return*/];
                    // ──────────────────────────────────────────────────────────────────────────
                    // Etapa 3: dt_locais — cache versionado
                    //
                    // Fluxo:
                    //   1. Lê 1 doc "dt_locais_meta/versao" (doc pequeno, 1 leitura)
                    //   2. Compara com versão salva em localStorage
                    //   3. Cache válido → usa localStorage, zero leituras adicionais
                    //   4. Cache inválido ou forceRefresh → baixa dt_locais e persiste cache
                    //
                    // O operador pode forçar atualização via botão na tela de status
                    // que chama atualizarCacheLocais() — seta LS_LOCAIS_VER = '' e recarrega.
                    // ──────────────────────────────────────────────────────────────────────────
                    _dlProg(92, 'Carregando capacidade dos endereços…');
                    _dlStep('cap', '🏷️', 'Capacidade de pallets', 'Verificando cache…', 'run');
                    endCapMapa = {};
                    _forceLocaisRefresh = !!window._locaisForceRefresh;
                    window._locaisForceRefresh = false;
                    versaoServidor = null;
                    _c.label = 11;
                case 11:
                    _c.trys.push([11, 13, , 14]);
                    return [4 /*yield*/, FS.collection('dt_locais_meta').doc('versao').get()];
                case 12:
                    metaDoc = _c.sent();
                    if (metaDoc.exists)
                        versaoServidor = String((_b = (_a = metaDoc.data()) === null || _a === void 0 ? void 0 : _a.versao) !== null && _b !== void 0 ? _b : '');
                    dbg('[dt_locais] versão servidor:', versaoServidor);
                    return [3 /*break*/, 14];
                case 13:
                    e_4 = _c.sent();
                    dbg('[dt_locais] config/locais_meta inacessível — forçará download:', e_4.message);
                    return [3 /*break*/, 14];
                case 14:
                    versaoLocal = null;
                    try {
                        versaoLocal = localStorage.getItem(LS_LOCAIS_VER);
                    }
                    catch (e) { }
                    _cacheValido = !_forceLocaisRefresh && versaoServidor !== null && versaoLocal === versaoServidor;
                    if (!_cacheValido) return [3 /*break*/, 15];
                    // ✅ Cache válido — restaurar do localStorage, ZERO leituras de dt_locais
                    dbg('[dt_locais] cache válido (ver=' + versaoLocal + ') — sem download');
                    _dlStep('cap', '🏷️', 'Capacidade de pallets', 'Cache local ✓', 'ok');
                    try {
                        raw = localStorage.getItem(LS_LOCAIS);
                        if (raw)
                            Object.assign(endCapMapa, JSON.parse(raw));
                    }
                    catch (e) { }
                    try {
                        rawSet = localStorage.getItem(LS_LOCAIS_SET);
                        if (rawSet) {
                            APP.locaisAtivos = new Set(JSON.parse(rawSet));
                            APP._locaisDoFirebase = true;
                        }
                        else {
                            APP.locaisAtivos = new Set(baseNorm.map(function (r) { return r._end; }).filter(Boolean));
                            APP._locaisDoFirebase = false;
                        }
                    }
                    catch (e) {
                        APP.locaisAtivos = new Set(baseNorm.map(function (r) { return r._end; }).filter(Boolean));
                    }
                    return [3 /*break*/, 19];
                case 15:
                    motivo = _forceLocaisRefresh ? 'atualização manual' : ('local=' + versaoLocal + ' servidor=' + versaoServidor);
                    dbg('[dt_locais] download necessário —', motivo);
                    _dlStep('cap', '🏷️', 'Capacidade de pallets', _forceLocaisRefresh ? 'Atualizando endereços…' : 'Baixando endereços…', 'run');
                    locaisSet_1 = new Set();
                    _c.label = 16;
                case 16:
                    _c.trys.push([16, 18, , 19]);
                    // v15: leitura principal por chunks de 1000 endereços.
                    // Reduz leituras de N endereços para aproximadamente N/1000 documentos.
                    if (!versaoServidor)
                        throw new Error('Versão da Base Geral de Endereços não encontrada.');
                    return [4 /*yield*/, FS.collection('dt_locais_chunks').where('versao', '==', versaoServidor).get()];
                case 17:
                    chunksSnap = _c.sent();
                    if (chunksSnap.empty)
                        throw new Error('Base de endereços em chunks não publicada para a versão atual.');
                    docsUsar = chunksSnap.docs.slice().sort(function (a, b) { return Number((a.data() || {}).parte || 0) - Number((b.data() || {}).parte || 0); });
                    docsUsar.forEach(function (chunkDoc) {
                        var dados = chunkDoc.data().dados || chunkDoc.data().itens || [];
                        dados.forEach(function (d) {
                            var _a, _b, _c, _d, _e, _f;
                            if (d.ativo === false)
                                return;
                            var end = _normStr(d.endereco || '');
                            if (!end)
                                return;
                            locaisSet_1.add(end);
                            var cap = parseInt((_f = (_e = (_d = (_c = (_b = (_a = d.capacidade_paletes) !== null && _a !== void 0 ? _a : d.capacidade_pallets) !== null && _b !== void 0 ? _b : d.capacidade_palete) !== null && _c !== void 0 ? _c : d.capacidade_pallet) !== null && _d !== void 0 ? _d : d.capacidade) !== null && _e !== void 0 ? _e : d.max_pallets) !== null && _f !== void 0 ? _f : 0);
                            if (cap > 0)
                                endCapMapa[end] = cap;
                        });
                    });
                    // Persistir cache + versão
                    try {
                        localStorage.setItem(LS_LOCAIS, JSON.stringify(endCapMapa));
                        localStorage.setItem(LS_LOCAIS_SET, JSON.stringify(__spreadArray([], locaisSet_1, true)));
                        if (versaoServidor)
                            localStorage.setItem(LS_LOCAIS_VER, versaoServidor);
                    }
                    catch (e) { }
                    APP.locaisAtivos = locaisSet_1;
                    APP._locaisDoFirebase = true;
                    dbg('[dt_locais] baixado:', locaisSet_1.size, 'endereços | cap:', Object.keys(endCapMapa).length, '| ver:', versaoServidor);
                    return [3 /*break*/, 19];
                case 18:
                    e_5 = _c.sent();
                    console.warn('[dt_locais] falha no download — restaurando cache:', e_5.message);
                    try {
                        raw = localStorage.getItem(LS_LOCAIS);
                        if (raw)
                            Object.assign(endCapMapa, JSON.parse(raw));
                    }
                    catch (e2) { }
                    try {
                        rawSet = localStorage.getItem(LS_LOCAIS_SET);
                        APP.locaisAtivos = rawSet
                            ? new Set(JSON.parse(rawSet))
                            : new Set(baseNorm.map(function (r) { return r._end; }).filter(Boolean));
                    }
                    catch (e2) {
                        APP.locaisAtivos = new Set(baseNorm.map(function (r) { return r._end; }).filter(Boolean));
                    }
                    if (!Object.keys(endCapMapa).length)
                        endCapMapa = _recalcularEndCap(baseNorm);
                    return [3 /*break*/, 19];
                case 19:
                    comLimite = Object.values(endCapMapa).filter(function (v) { return v > 0; }).length;
                    _dlStep('cap', '🏷️', 'Capacidade de pallets', Object.keys(endCapMapa).length + ' endereços · ' + comLimite + ' c/ limite', 'ok');
                    _dlProg(95);
                    // Etapa 4: salvar localmente
                    _dlStep('save', '💾', 'Cache local', 'Salvando…', 'run');
                    baseSave(invId, baseNorm);
                    endCapSave(invId, endCapMapa);
                    bVerSave(invId, _invBaseVer(docData));
                    _dlStep('save', '💾', 'Cache local', 'Dados salvos para uso offline', 'ok');
                    _dlProg(100, 'Download concluído!');
                    APP.inventario = __assign(__assign({}, inv), docData);
                    APP.base = baseNorm;
                    APP.endCapacidade = endCapMapa;
                    atualizarInventarioColetor(); // 📡 atualiza inventário no doc do coletor
                    _concluirDownload(baseNorm.length);
                    return [2 /*return*/];
            }
        });
    });
}
function _concluirDownload(totalReg) {
    if (_dlCancelado)
        return;
    document.getElementById('dl-icon').textContent = '✅';
    document.getElementById('dl-status-txt').textContent = "Pronto! ".concat(totalReg, " registros carregados");
    var btnEntrar = document.getElementById('dl-btn-entrar');
    var btnCancel = document.getElementById('dl-btn-cancel');
    if (btnEntrar)
        btnEntrar.style.display = '';
    if (btnCancel)
        btnCancel.style.display = 'none';
    // Auto-entrar
    setTimeout(function () { if (!_dlCancelado)
        entrarInventario(); }, 800);
}
function _dlSetErro(msg) {
    document.getElementById('dl-status-txt').textContent = 'Erro no download';
    document.getElementById('dl-icon').textContent = '❌';
    var dlErro = document.getElementById('dl-erro');
    if (dlErro) {
        dlErro.style.display = '';
        dlErro.textContent = msg;
    }
}
function _dlStep(id, icon, label, sub, estado) {
    var existing = document.getElementById('dl-step-' + id);
    if (existing) {
        existing.className = 'dl-step ' + estado;
        existing.querySelector('.dl-step-ic').textContent = estado === 'ok' ? '✅' : estado === 'err' ? '❌' : '⏳';
        existing.querySelector('.dl-step-lbl').textContent = label;
        existing.querySelector('.dl-step-sub').textContent = sub || '';
    }
    else {
        var d = document.createElement('div');
        d.id = 'dl-step-' + id;
        d.className = 'dl-step ' + estado;
        d.innerHTML = "\n      <span class=\"dl-step-ic\">".concat(estado === 'ok' ? '✅' : estado === 'err' ? '❌' : '⏳', "</span>\n      <div class=\"dl-step-body\">\n        <div class=\"dl-step-lbl\">").concat(label, "</div>\n        <div class=\"dl-step-sub\">").concat(sub || '', "</div>\n      </div>");
        document.getElementById('dl-steps').appendChild(d);
    }
}
function _dlProg(pct, txt) {
    document.getElementById('dl-bar-fg').style.width = pct + '%';
    document.getElementById('dl-pct').textContent = Math.round(pct) + '%';
    if (txt)
        document.getElementById('dl-status-txt').textContent = txt;
}
function voltarInventarios() {
    var pendFila = FILA_ENVIO.length;
    var msg = 'Trocar de inventário?';
    if (APP.contagens.length > 0 && pendFila > 0)
        msg = "Tem ".concat(APP.contagens.length, " contagem(ns) nesta sess\u00E3o (").concat(pendFila, " na fila de envio). Voltar mesmo assim?");
    else if (APP.contagens.length > 0)
        msg = "Tem ".concat(APP.contagens.length, " contagem(ns) nesta sess\u00E3o. Voltar mesmo assim?");
    if (APP.contagens.length > 0) {
        showConfirm(msg, _voltarInventarioConfirmado, { title: 'Voltar ao menu', icon: '↩️', okLabel: 'Voltar mesmo assim', okColor: '#ffb300' });
        return;
    }
    _voltarInventarioConfirmado();
}
function _voltarInventarioConfirmado() {
    if (_recListener) {
        try {
            _recListener();
        }
        catch (e) { }
        _recListener = null;
    }
    if (_auditoriaListener) {
        try {
            _auditoriaListener();
        }
        catch (e) { }
        _auditoriaListener = null;
    }
    APP.inventario = null;
    APP.base = [];
    APP.auditorias = [];
    APP.contagens = [];
    APP.recontagens = [];
    APP.divergenciasAtribuidas = [];
    APP.modoRecontagem = null;
    resetContagem();
    goScreen('inventarios');
}
// Funções específicas de Auditoria são definidas somente em 17-auditoria-meta.js.
// Este arquivo permanece responsável apenas por Inventário.
