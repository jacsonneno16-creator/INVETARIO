(function (global) {
    var DivergenciaService = {
        deveReprocessar: function (actionType) {
            return ['UPSERT_ENTITY', 'REMOVE_ENTITY', 'SET_PATH', 'HYDRATE_CACHE', 'REPLACE_SLICE', 'BATCH'].includes(actionType);
        },
        afetaFluxoDeContagem: function (action) {
            var slice = action === null || action === void 0 ? void 0 : action.slice;
            var path = String((action === null || action === void 0 ? void 0 : action.path) || '');
            return ['contagens', 'recontagens', 'divergencias'].includes(slice) ||
                path === 'contagens' || path === 'recontagens' || path === 'divergencias';
        },
        processarDivergencias: function (options) {
            var _a;
            if ((_a = global.AnalistaDivergenciasRuntime) === null || _a === void 0 ? void 0 : _a.processar)
                return global.AnalistaDivergenciasRuntime.processar(options);
            if (typeof global.processarDivergencias === 'function')
                return global.processarDivergencias(options);
            return 0;
        },
        corrigirOrfas: function () {
            var _a;
            if ((_a = global.AnalistaDivergenciasRuntime) === null || _a === void 0 ? void 0 : _a.corrigirOrfas)
                return global.AnalistaDivergenciasRuntime.corrigirOrfas();
            if (typeof global.corrigirDivsOrfas === 'function')
                return global.corrigirDivsOrfas();
            return 0;
        }
    };
    global.AnalistaDivergenciaService = DivergenciaService;
})(window);
