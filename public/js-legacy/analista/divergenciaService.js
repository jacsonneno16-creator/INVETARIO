(function (global) {
    // ─── Constante de negócio compartilhada ────────────────────────────────────
    var MAX_CONTAGENS = 3;
    // ─── Funções puras de domínio ───────────────────────────────────────────────
    /**
     * Retorna true se o fluxo da divergência/recontagem está encerrado.
     * Exportado para uso em outros módulos sem depender do global.
     */
    function isFluxoEncerrado(divOuRec) {
        var _a, _b;
        if (!divOuRec)
            return false;
        var status = String(divOuRec.status || '').toUpperCase();
        var bloqueio = String(divOuRec.status_bloqueio || '').toUpperCase();
        var statusRec = String(divOuRec.status_recontagem || '').toLowerCase();
        if (status === 'RESOLVIDA')
            return true;
        if (status === 'PERSISTENTE')
            return true;
        if (bloqueio === 'PERSISTENTE_BLOQUEADO')
            return true;
        if (divOuRec.divergencia_resolvida === true)
            return true;
        if (divOuRec.encerrada_definitivamente === true)
            return true;
        if (statusRec === 'sem_divergencia')
            return true;
        // Se for recontagem, validar também a divergência vinculada
        if (divOuRec.divergencia_id) {
            var st = (_b = (_a = global.AnalistaStore) === null || _a === void 0 ? void 0 : _a.getState) === null || _b === void 0 ? void 0 : _b.call(_a);
            var div = st ? st.divergencias.find(function (d) { return d.id === divOuRec.divergencia_id; }) : null;
            if (div) {
                var ds = String(div.status || '').toUpperCase();
                var db = String(div.status_bloqueio || '').toUpperCase();
                if (ds === 'RESOLVIDA' || ds === 'PERSISTENTE')
                    return true;
                if (db === 'PERSISTENTE_BLOQUEADO')
                    return true;
                if (div.divergencia_resolvida === true)
                    return true;
                if (div.encerrada_definitivamente === true)
                    return true;
            }
        }
        return false;
    }
    /**
     * Retorna a recontagem ATIVA (não encerrada, não cancelada) de uma divergência.
     * Lê do store — sem dependência de variável global de state.
     */
    function obterRecontagemAtivaPorDivergencia(divergenciaId) {
        var _a, _b;
        var st = (_b = (_a = global.AnalistaStore) === null || _a === void 0 ? void 0 : _a.getState) === null || _b === void 0 ? void 0 : _b.call(_a);
        if (!st)
            return null;
        return st.recontagens.find(function (r) {
            return r.divergencia_id === divergenciaId &&
                !isFluxoEncerrado(r) &&
                String(r.status || '').toUpperCase() !== 'CONCLUIDA' &&
                String(r.status_recontagem || '').toLowerCase() !== 'cancelada' &&
                String(r.status || '').toUpperCase() !== 'CANCELADA';
        }) || null;
    }
    // ─── Serviço ────────────────────────────────────────────────────────────────
    var DivergenciaService = {
        MAX_CONTAGENS: MAX_CONTAGENS,
        isFluxoEncerrado: isFluxoEncerrado,
        obterRecontagemAtivaPorDivergencia: obterRecontagemAtivaPorDivergencia,
        deveReprocessar: function (actionType) {
            return ['UPSERT_ENTITY', 'REMOVE_ENTITY', 'SET_PATH', 'HYDRATE_CACHE', 'REPLACE_SLICE', 'BATCH'].includes(actionType);
        },
        afetaFluxoDeContagem: function (action) {
            var slice = action === null || action === void 0 ? void 0 : action.slice;
            var path = String((action === null || action === void 0 ? void 0 : action.path) || '');
            return ['contagens', 'recontagens', 'divergencias'].includes(slice) ||
                path === 'contagens' || path === 'recontagens' || path === 'divergencias';
        },
        /**
         * Delega para o runtime registrado pelo módulo 21-divergencias-recontagens.
         * Nunca faz fallback para função global — o runtime é a única fonte.
         */
        processarDivergencias: function (options) {
            var _a;
            if ((_a = global.AnalistaDivergenciasRuntime) === null || _a === void 0 ? void 0 : _a.processar) {
                return global.AnalistaDivergenciasRuntime.processar(options);
            }
            console.warn('[DivergenciaService] AnalistaDivergenciasRuntime.processar não registrado ainda.');
            return 0;
        },
        corrigirOrfas: function () {
            var _a;
            if ((_a = global.AnalistaDivergenciasRuntime) === null || _a === void 0 ? void 0 : _a.corrigirOrfas) {
                return global.AnalistaDivergenciasRuntime.corrigirOrfas();
            }
            return 0;
        }
    };
    global.AnalistaDivergenciaService = DivergenciaService;
})(window);
