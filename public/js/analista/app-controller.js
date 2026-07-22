(function(global){
  const DivergenciaService = global.AnalistaDivergenciaService;
  let uiBound = false;
  let renderTid = null;
  let processTid = null;

  function scheduleRender(){
    clearTimeout(renderTid);
    renderTid = setTimeout(() => {
      global.AnalistaNavigation?.renderCurrentPage?.();
      if (typeof global.atualizarBadgesNav === 'function') global.atualizarBadgesNav();
      if (typeof global.updateStaticTexts === 'function') global.updateStaticTexts();
    }, 16);
  }

  function scheduleBusinessReprocess(){
    clearTimeout(processTid);
    processTid = setTimeout(() => {
      try { DivergenciaService.processarDivergencias({ criarRecontagens: true, source: 'store-reactive' }); }
      catch (err) { console.warn('[AppController] processarDivergencias', err); }
      try { DivergenciaService.corrigirOrfas(); }
      catch (err) { console.warn('[AppController] corrigirDivsOrfas', err); }
      global.AnalistaBootstrap?.saveAll?.();
      scheduleRender();
    }, 40);
  }

  function bindUI(){
    if (uiBound) return;
    uiBound = true;
    global.AnalistaStore.subscribe((state, action, prevState) => {
      const metaSource = action?.meta?.source;
      if (metaSource !== 'ui-render') scheduleRender();
      if (DivergenciaService.deveReprocessar(action?.type) && DivergenciaService.afetaFluxoDeContagem(action)) {
        const changed = prevState.contagens !== state.contagens || prevState.recontagens !== state.recontagens;
        if (changed && metaSource !== 'business-reprocess') scheduleBusinessReprocess();
      }
    });
  }

  global.AnalistaAppController = { bindUI };
})(window);
