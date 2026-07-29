(function (global) {
    var MAX_CONTAGENS = 3;
    function isFluxoEncerrado(divOuRec) {
        if (!divOuRec)
            return false;
        var status = String(divOuRec.status || '').toUpperCase();
        var bloqueio = String(divOuRec.status_bloqueio || '').toUpperCase();
        var statusRec = String(divOuRec.status_recontagem || '').toLowerCase();
        if (status === 'RESOLVIDA' || status === 'PERSISTENTE')
            return true;
        if (bloqueio === 'PERSISTENTE_BLOQUEADO')
            return true;
        if (divOuRec.divergencia_resolvida === true || divOuRec.encerrada_definitivamente === true)
            return true;
        if (statusRec === 'sem_divergencia')
            return true;
        if (divOuRec.divergencia_id) {
            var st = global.AnalistaStore && typeof global.AnalistaStore.getState === 'function' ? global.AnalistaStore.getState() : null;
            var lista = st && Array.isArray(st.divergencias) ? st.divergencias : [];
            var div = null;
            for (var i = 0; i < lista.length; i++) {
                if (lista[i].id === divOuRec.divergencia_id) { div = lista[i]; break; }
            }
            if (div) {
                var ds = String(div.status || '').toUpperCase();
                var db = String(div.status_bloqueio || '').toUpperCase();
                if (ds === 'RESOLVIDA' || ds === 'PERSISTENTE' || db === 'PERSISTENTE_BLOQUEADO')
                    return true;
                if (div.divergencia_resolvida === true || div.encerrada_definitivamente === true)
                    return true;
            }
        }
        return false;
    }
    function obterRecontagemAtivaPorDivergencia(divergenciaId) {
        var st = global.AnalistaStore && typeof global.AnalistaStore.getState === 'function' ? global.AnalistaStore.getState() : null;
        var lista = st && Array.isArray(st.recontagens) ? st.recontagens : [];
        for (var i = 0; i < lista.length; i++) {
            var r = lista[i];
            if (r.divergencia_id === divergenciaId && !isFluxoEncerrado(r) &&
                String(r.status || '').toUpperCase() !== 'CONCLUIDA' &&
                String(r.status_recontagem || '').toLowerCase() !== 'cancelada' &&
                String(r.status || '').toUpperCase() !== 'CANCELADA')
                return r;
        }
        return null;
    }
    var DivergenciaService = {
        MAX_CONTAGENS: MAX_CONTAGENS,
        isFluxoEncerrado: isFluxoEncerrado,
        obterRecontagemAtivaPorDivergencia: obterRecontagemAtivaPorDivergencia,
        deveReprocessar: function (actionType) {
            return ['UPSERT_ENTITY', 'REMOVE_ENTITY', 'SET_PATH', 'HYDRATE_CACHE', 'REPLACE_SLICE', 'BATCH'].indexOf(actionType) >= 0;
        },
        afetaFluxoDeContagem: function (action) {
            var slice = action && action.slice;
            var path = String((action && action.path) || '');
            return ['contagens', 'recontagens', 'divergencias'].indexOf(slice) >= 0 || path === 'contagens' || path === 'recontagens' || path === 'divergencias';
        },
        processarDivergencias: function (options) {
            if (global.AnalistaDivergenciasRuntime && typeof global.AnalistaDivergenciasRuntime.processar === 'function')
                return global.AnalistaDivergenciasRuntime.processar(options);
            if (typeof global.processarDivergencias === 'function')
                return global.processarDivergencias(options);
            return 0;
        },
        corrigirOrfas: function () {
            if (global.AnalistaDivergenciasRuntime && typeof global.AnalistaDivergenciasRuntime.corrigirOrfas === 'function')
                return global.AnalistaDivergenciasRuntime.corrigirOrfas();
            if (typeof global.corrigirDivsOrfas === 'function')
                return global.corrigirDivsOrfas();
            return 0;
        }
    };
    global.AnalistaDivergenciaService = DivergenciaService;
})(window);
