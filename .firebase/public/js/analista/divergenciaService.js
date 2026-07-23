(function(global){

  // ─── Constante de negócio compartilhada ────────────────────────────────────
  const MAX_CONTAGENS = 3;

  // ─── Funções puras de domínio ───────────────────────────────────────────────

  /**
   * Retorna true se o fluxo da divergência/recontagem está encerrado.
   * Exportado para uso em outros módulos sem depender do global.
   */
  function isFluxoEncerrado(divOuRec){
    if (!divOuRec) return false;
    const status    = String(divOuRec.status    || '').toUpperCase();
    const bloqueio  = String(divOuRec.status_bloqueio  || '').toUpperCase();
    const statusRec = String(divOuRec.status_recontagem || '').toLowerCase();

    if (status   === 'RESOLVIDA')              return true;
    if (status   === 'PERSISTENTE')            return true;
    if (bloqueio === 'PERSISTENTE_BLOQUEADO')  return true;
    if (divOuRec.divergencia_resolvida   === true) return true;
    if (divOuRec.encerrada_definitivamente === true) return true;
    if (statusRec === 'sem_divergencia')       return true;

    // Se for recontagem, validar também a divergência vinculada
    if (divOuRec.divergencia_id) {
      const st = global.AnalistaStore?.getState?.();
      const div = st ? st.divergencias.find(d => d.id === divOuRec.divergencia_id) : null;
      if (div) {
        const ds = String(div.status || '').toUpperCase();
        const db = String(div.status_bloqueio || '').toUpperCase();
        if (ds === 'RESOLVIDA' || ds === 'PERSISTENTE')   return true;
        if (db === 'PERSISTENTE_BLOQUEADO')               return true;
        if (div.divergencia_resolvida   === true)         return true;
        if (div.encerrada_definitivamente === true)       return true;
      }
    }
    return false;
  }

  /**
   * Retorna a recontagem ATIVA (não encerrada, não cancelada) de uma divergência.
   * Lê do store — sem dependência de variável global de state.
   */
  function obterRecontagemAtivaPorDivergencia(divergenciaId){
    const st = global.AnalistaStore?.getState?.();
    if (!st) return null;
    return st.recontagens.find(r =>
      r.divergencia_id === divergenciaId &&
      !isFluxoEncerrado(r) &&
      String(r.status || '').toUpperCase() !== 'CONCLUIDA' &&
      String(r.status_recontagem || '').toLowerCase() !== 'cancelada' &&
      String(r.status || '').toUpperCase() !== 'CANCELADA'
    ) || null;
  }

  // ─── Serviço ────────────────────────────────────────────────────────────────

  const DivergenciaService = {
    MAX_CONTAGENS,
    isFluxoEncerrado,
    obterRecontagemAtivaPorDivergencia,

    deveReprocessar(actionType){
      return ['UPSERT_ENTITY','REMOVE_ENTITY','SET_PATH','HYDRATE_CACHE','REPLACE_SLICE','BATCH'].includes(actionType);
    },

    afetaFluxoDeContagem(action){
      const slice = action?.slice;
      const path  = String(action?.path || '');
      return ['contagens','recontagens','divergencias'].includes(slice) ||
             path === 'contagens' || path === 'recontagens' || path === 'divergencias';
    },

    /**
     * Delega para o runtime registrado pelo módulo 21-divergencias-recontagens.
     * Nunca faz fallback para função global — o runtime é a única fonte.
     */
    processarDivergencias(options){
      if (global.AnalistaDivergenciasRuntime?.processar) {
        return global.AnalistaDivergenciasRuntime.processar(options);
      }
      console.warn('[DivergenciaService] AnalistaDivergenciasRuntime.processar não registrado ainda.');
      return 0;
    },

    corrigirOrfas(){
      if (global.AnalistaDivergenciasRuntime?.corrigirOrfas) {
        return global.AnalistaDivergenciasRuntime.corrigirOrfas();
      }
      return 0;
    }
  };

  global.AnalistaDivergenciaService = DivergenciaService;
})(window);
