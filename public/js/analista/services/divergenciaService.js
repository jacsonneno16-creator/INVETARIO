(function(global){
  const MAX_CONTAGENS = 3;

  function isFluxoEncerrado(divOuRec){
    if (!divOuRec) return false;
    const status = String(divOuRec.status || '').toUpperCase();
    const bloqueio = String(divOuRec.status_bloqueio || '').toUpperCase();
    const statusRec = String(divOuRec.status_recontagem || '').toLowerCase();

    if (status === 'RESOLVIDA' || status === 'PERSISTENTE') return true;
    if (bloqueio === 'PERSISTENTE_BLOQUEADO') return true;
    if (divOuRec.divergencia_resolvida === true) return true;
    if (divOuRec.encerrada_definitivamente === true) return true;
    if (statusRec === 'sem_divergencia') return true;

    if (divOuRec.divergencia_id) {
      const st = global.AnalistaStore?.getState?.();
      const div = st?.divergencias?.find?.(d => d.id === divOuRec.divergencia_id);
      if (div) {
        const ds = String(div.status || '').toUpperCase();
        const db = String(div.status_bloqueio || '').toUpperCase();
        if (ds === 'RESOLVIDA' || ds === 'PERSISTENTE') return true;
        if (db === 'PERSISTENTE_BLOQUEADO') return true;
        if (div.divergencia_resolvida === true) return true;
        if (div.encerrada_definitivamente === true) return true;
      }
    }
    return false;
  }

  function obterRecontagemAtivaPorDivergencia(divergenciaId){
    const st = global.AnalistaStore?.getState?.();
    if (!st || !Array.isArray(st.recontagens)) return null;
    return st.recontagens.find(r =>
      r.divergencia_id === divergenciaId &&
      !isFluxoEncerrado(r) &&
      String(r.status || '').toUpperCase() !== 'CONCLUIDA' &&
      String(r.status_recontagem || '').toLowerCase() !== 'cancelada' &&
      String(r.status || '').toUpperCase() !== 'CANCELADA'
    ) || null;
  }

  const DivergenciaService = {
    MAX_CONTAGENS,
    isFluxoEncerrado,
    obterRecontagemAtivaPorDivergencia,
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
