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
    // ── Constante de negócio ────────────────────────────────────────────────────
    // MAX_CONTAGENS também está em AnalistaDivergenciaService — mantida aqui para
    // compatibilidade com chamadas legadas em arquivos não migrados.
    var MAX_CONTAGENS = 3;
    // ── Chaves do localStorage ──────────────────────────────────────────────────
    var KEYS = {
        inventarios: 'invcount_inventarios',
        contagens: 'invcount_contagens',
        divergencias: 'invcount_divergencias',
        recontagens: 'invcount_recontagens',
        enderecos: 'invcount_enderecos',
        logs: 'invcount_logs',
        auditorias: 'invcount_auditorias',
        auditoria_imports: 'invcount_auditoria_imports',
        config: 'invcount_config',
        coletores: 'dt_db_coletores',
    };
    // ── Storage ─────────────────────────────────────────────────────────────────
    function scopedKey(key) { var loja = (window.getDTLojaAtiva && window.getDTLojaAtiva()) || 'sem_loja'; return "".concat(key, "__").concat(loja); }
    /** Salva dado com timestamp (para detectar mudanças externas) */
    function storageSave(key, data) {
        try {
            if (key === KEYS.auditorias && Array.isArray(data)) {
                var slim = data.slice(-2000).map(function (a) { return ({
                    id: a.id,
                    auditoria_id: a.auditoria_id || '',
                    auditoria_nome: a.auditoria_nome || '',
                    endereco: a.endereco || '',
                    endereco_norm: a.endereco_norm || '',
                    rua: a.rua || '',
                    itens_count: Array.isArray(a.itens) ? a.itens.length : 0,
                    itens_confirmados_count: Array.isArray(a.itens_confirmados) ? a.itens_confirmados.length : 0,
                    status: a.status || 'PENDENTE',
                    importado_em: a.importado_em || '',
                    importado_por: a.importado_por || '',
                    confirmado_em: a.confirmado_em || '',
                    confirmado_por: a.confirmado_por || '',
                    com_ajuste: !!a.com_ajuste,
                    reaberto_por_alteracao_base: !!a.reaberto_por_alteracao_base,
                    liberada_coletor: !!a.liberada_coletor,
                    disponivel_coletor: !!a.disponivel_coletor,
                    origem: a.origem || '',
                    local_estoque_auditoria: a.local_estoque_auditoria || '',
                    assinatura_base: a.assinatura_base || ''
                }); });
                localStorage.setItem(scopedKey(key), JSON.stringify({ v: slim, ts: Date.now() }));
                return;
            }
            if (key === KEYS.inventarios && Array.isArray(data)) {
                data.forEach(function (inv) {
                    var _a;
                    if ((_a = inv.base) === null || _a === void 0 ? void 0 : _a.length) {
                        try {
                            localStorage.setItem("invcount_base_".concat((window.getDTLojaAtiva && window.getDTLojaAtiva()) || 'sem_loja', "_").concat(inv.id), JSON.stringify({ v: inv.base, ts: Date.now() }));
                        }
                        catch (e) {
                            console.warn('[Storage] Falha ao salvar base do inventário', inv.id, e);
                        }
                    }
                });
                var semBase = data.map(function (inv) { var base = inv.base, rest = __rest(inv, ["base"]); return rest; });
                localStorage.setItem(scopedKey(key), JSON.stringify({ v: semBase, ts: Date.now() }));
                return;
            }
            localStorage.setItem(scopedKey(key), JSON.stringify({ v: data, ts: Date.now() }));
        }
        catch (e) {
            console.error('[Storage] Erro ao salvar', key, e);
        }
    }
    /** Carrega dado; retorna null se não existir */
    function storageLoad(key) {
        try {
            var raw = localStorage.getItem(scopedKey(key));
            if (!raw)
                return null;
            var parsed = JSON.parse(raw);
            var data = parsed && 'v' in parsed ? parsed.v : parsed;
            if (key === KEYS.inventarios && Array.isArray(data)) {
                data.forEach(function (inv) {
                    var _a;
                    if (!((_a = inv.base) === null || _a === void 0 ? void 0 : _a.length)) {
                        try {
                            var rawBase = localStorage.getItem("invcount_base_".concat((window.getDTLojaAtiva && window.getDTLojaAtiva()) || 'sem_loja', "_").concat(inv.id));
                            if (rawBase) {
                                var parsedBase = JSON.parse(rawBase);
                                inv.base = parsedBase && 'v' in parsedBase ? parsedBase.v : parsedBase;
                            }
                        }
                        catch (e) { /* base não disponível */ }
                    }
                });
            }
            return data;
        }
        catch (e) {
            return null;
        }
    }
    /** Retorna o timestamp da última gravação de uma chave */
    function storageTs(key) {
        try {
            var raw = localStorage.getItem(scopedKey(key));
            if (!raw)
                return 0;
            var parsed = JSON.parse(raw);
            return (parsed === null || parsed === void 0 ? void 0 : parsed.ts) || 0;
        }
        catch (e) {
            return 0;
        }
    }
    // ── Exportação do módulo ────────────────────────────────────────────────────
    var AnalistaStorage = { KEYS: KEYS, storageSave: storageSave, storageLoad: storageLoad, storageTs: storageTs, MAX_CONTAGENS: MAX_CONTAGENS };
    global.AnalistaStorage = AnalistaStorage;
    // Aliases globais mantidos para compatibilidade com módulos ainda não migrados
    // (09-fs-publicar, 10-inventarios-negocio, 21-divergencias-recontagens, etc.)
    global.KEYS = KEYS;
    global.storageSave = storageSave;
    global.storageLoad = storageLoad;
    global.storageTs = storageTs;
    global.MAX_CONTAGENS = MAX_CONTAGENS;
    // _isFluxoEncerrado e obterRecontagemAtivaPorDivergencia foram movidos para
    // AnalistaDivergenciaService — aliases para compatibilidade com chamadas legadas
    global._isFluxoEncerrado = function (divOuRec) {
        var _a, _b;
        return (_b = (_a = global.AnalistaDivergenciaService) === null || _a === void 0 ? void 0 : _a.isFluxoEncerrado(divOuRec)) !== null && _b !== void 0 ? _b : false;
    };
    global._isPersistenteBloqueado = global._isFluxoEncerrado;
    global.obterRecontagemAtivaPorDivergencia = function (divergenciaId) {
        var _a, _b;
        return (_b = (_a = global.AnalistaDivergenciaService) === null || _a === void 0 ? void 0 : _a.obterRecontagemAtivaPorDivergencia(divergenciaId)) !== null && _b !== void 0 ? _b : null;
    };
    // atribuirRecontagemSegura foi movido para AnalistaRecontagemService (módulo próprio).
    // O alias abaixo garante que chamadas legadas continuem funcionando.
    global.atribuirRecontagemSegura = function (d, operador, atribPor, obs, agora) {
        var _a, _b;
        return (_b = (_a = global.AnalistaRecontagemService) === null || _a === void 0 ? void 0 : _a.atribuirRecontagemSegura(d, operador, atribPor, obs, agora)) !== null && _b !== void 0 ? _b : null;
    };
})(window);
