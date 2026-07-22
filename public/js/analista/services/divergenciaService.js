(function(global){
  const DivergenciaService = {
    deveReprocessar(actionType){
      return ['UPSERT_ENTITY','REMOVE_ENTITY','SET_PATH','HYDRATE_CACHE','REPLACE_SLICE','BATCH'].includes(actionType);
    },
    afetaFluxoDeContagem(action){
      const slice = action?.slice;
      const path = String(action?.path || '');
      return ['contagens','recontagens','divergencias'].includes(slice) ||
             path === 'contagens' || path === 'recontagens' || path === 'divergencias';
    },
    processarDivergencias(options){
      if (global.AnalistaDivergenciasRuntime?.processar) return global.AnalistaDivergenciasRuntime.processar(options);
      if (typeof global.processarDivergencias === 'function') return global.processarDivergencias(options);
      return 0;
    },
    corrigirOrfas(){
      if (global.AnalistaDivergenciasRuntime?.corrigirOrfas) return global.AnalistaDivergenciasRuntime.corrigirOrfas();
      if (typeof global.corrigirDivsOrfas === 'function') return global.corrigirDivsOrfas();
      return 0;
    }
  };
  global.AnalistaDivergenciaService = DivergenciaService;
})(window);
