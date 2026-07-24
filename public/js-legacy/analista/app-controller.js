(function (global) {
    var DivergenciaService = global.AnalistaDivergenciaService;
    var uiBound = false;
    var renderTid = null;
    var processTid = null;
    function scheduleRender() {
        clearTimeout(renderTid);
        renderTid = setTimeout(function () {
            var _a, _b;
            (_b = (_a = global.AnalistaNavigation) === null || _a === void 0 ? void 0 : _a.renderCurrentPage) === null || _b === void 0 ? void 0 : _b.call(_a);
            if (typeof global.atualizarBadgesNav === 'function')
                global.atualizarBadgesNav();
            if (typeof global.updateStaticTexts === 'function')
                global.updateStaticTexts();
        }, 16);
    }
    function scheduleBusinessReprocess() {
        clearTimeout(processTid);
        processTid = setTimeout(function () {
            var _a, _b;
            try {
                DivergenciaService.processarDivergencias({ criarRecontagens: true, source: 'store-reactive' });
            }
            catch (err) {
                console.warn('[AppController] processarDivergencias', err);
            }
            try {
                DivergenciaService.corrigirOrfas();
            }
            catch (err) {
                console.warn('[AppController] corrigirDivsOrfas', err);
            }
            (_b = (_a = global.AnalistaBootstrap) === null || _a === void 0 ? void 0 : _a.saveAll) === null || _b === void 0 ? void 0 : _b.call(_a);
            scheduleRender();
        }, 40);
    }
    function bindUI() {
        if (uiBound)
            return;
        uiBound = true;
        global.AnalistaStore.subscribe(function (state, action, prevState) {
            var _a;
            var metaSource = (_a = action === null || action === void 0 ? void 0 : action.meta) === null || _a === void 0 ? void 0 : _a.source;
            if (metaSource !== 'ui-render')
                scheduleRender();
            if (DivergenciaService.deveReprocessar(action === null || action === void 0 ? void 0 : action.type) && DivergenciaService.afetaFluxoDeContagem(action)) {
                var changed = prevState.contagens !== state.contagens;
                if (changed && metaSource !== 'business-reprocess')
                    scheduleBusinessReprocess();
            }
        });
    }
    global.AnalistaAppController = { bindUI: bindUI };
})(window);
