// ───────────────────────────────────────────────────────────────────
//  02. BOOTSTRAP DE ESTADO / CACHE / CICLO DE VIDA
// ───────────────────────────────────────────────────────────────────
(function(global){
  const State = global.AnalistaState;
  const Actions = global.AnalistaActions;

  function getState(){ return State.getState(); }

  function agruparEnderecosPorSetor(lista){
    return (lista || []).reduce((acc, item) => {
      const setor = item?.setor || item?.local || item?.nome_local || 'SEM_SETOR';
      if (!acc[setor]) acc[setor] = [];
      acc[setor].push(item);
      return acc;
    }, {});
  }

  function snapshotForCache(){
    const state = getState();
    return {
      inventarios: state.inventarios,
      contagens: state.contagens,
      divergencias: state.divergencias,
      recontagens: state.recontagens,
      logs: state.logs,
      auditorias: state.auditorias,
      auditoria_imports: state.auditoria_imports,
      auditoria_metas: state.auditoria_metas,
      coletores: state.coletores,
      enderecosLista: state.enderecosLista,
      enderecosPorSetor: state.enderecosPorSetor,
      enderecosExpandidos: state.enderecosExpandidos,
      enderecosTemp: state.enderecosTemp,
      ui: state.ui,
      sync: state.sync
    };
  }

  function loadAll(){
    const inventarios     = global.storageLoad(global.KEYS.inventarios)      || [];
    const contagens       = global.storageLoad(global.KEYS.contagens)        || [];
    const divergencias    = global.storageLoad(global.KEYS.divergencias)     || [];
    const recontagens     = global.storageLoad(global.KEYS.recontagens)      || [];
    const logs            = global.storageLoad(global.KEYS.logs)             || [];
    const auditorias      = global.storageLoad(global.KEYS.auditorias)       || [];
    const auditoria_imports = global.storageLoad(global.KEYS.auditoria_imports) || [];
    const auditoria_metas = global.storageLoad('invcount_auditoria_metas')   || [];
    const coletores       = global.storageLoad(global.KEYS.coletores)        || [];
    const enderecosLista  = global.storageLoad(global.KEYS.enderecos)        || [];
    const enderecosPorSetor = agruparEnderecosPorSetor(enderecosLista || []);

    State.dispatch(Actions.hydrateCache({
      inventarios,
      contagens,
      divergencias,
      recontagens,
      logs,
      auditorias,
      auditoria_imports,
      auditoria_metas,
      coletores,
      enderecosLista,
      enderecosPorSetor,
      enderecosExpandidos: [],
      enderecosTemp: []
    }));
  }

  function saveAll(){
    const state = getState();
    global.storageSave(global.KEYS.inventarios,      state.inventarios);
    global.storageSave(global.KEYS.contagens,        state.contagens);
    global.storageSave(global.KEYS.divergencias,     state.divergencias);
    global.storageSave(global.KEYS.recontagens,      state.recontagens);
    global.storageSave(global.KEYS.logs,             state.logs);
    global.storageSave(global.KEYS.auditorias,       state.auditorias);
    global.storageSave(global.KEYS.auditoria_imports, state.auditoria_imports);
    global.storageSave('invcount_auditoria_metas',   state.auditoria_metas || []);
    global.storageSave(global.KEYS.enderecos,        state.enderecosLista);
    global.storageSave(global.KEYS.coletores,        state.coletores || []);
    return snapshotForCache();
  }

  function renderAll(){
    if (typeof global.renderDashboard === 'function') global.renderDashboard();
    if (typeof global.atualizarBadgesNav === 'function') global.atualizarBadgesNav();
    if (typeof global.atualizarEnderecos === 'function') global.atualizarEnderecos();
  }

  function updateSyncUI(ok, msg){
    const dot = document.getElementById('sync-dot');
    const txt = document.getElementById('sync-txt');
    if (dot) dot.className = 'sync-dot ' + (ok ? 'ok' : '');
    if (txt) txt.textContent = msg || (ok ? 'Sincronizado' : 'Aguardando...');
    const info = 'Última sync: ' + new Date().toLocaleTimeString('pt-BR');
    const contSync = document.getElementById('cont-sync-info');
    if (contSync) contSync.textContent = info;
    const acomp = document.getElementById('acomp-ultima-sync');
    if (acomp) acomp.textContent = info;
  }

  function setupStorageSync(){
    window.addEventListener('storage', e => {
      if (Object.values(global.KEYS).includes(e.key) || String(e.key || '').startsWith('invcount_base_') || e.key === 'invcount_auditoria_metas') {
        loadAll();
        if (global.AnalistaNavigation?.renderCurrentPage) global.AnalistaNavigation.renderCurrentPage();
        if (typeof global.atualizarBadgesNav === 'function') global.atualizarBadgesNav();
        updateSyncUI(true, 'Dados atualizados do cache secundário');
      }
    });
  }

  let pollingStarted = false;
  function startPolling(){
    if (pollingStarted) return;
    pollingStarted = true;
    let lastTs = global.storageTs(global.KEYS.contagens);
    setInterval(() => {
      const currentTs = global.storageTs(global.KEYS.contagens);
      if (currentTs && currentTs > lastTs && !global.AnalistaFirebaseService?.state?.started) {
        lastTs = currentTs;
        const contagens    = global.storageLoad(global.KEYS.contagens)    || [];
        const divergencias = global.storageLoad(global.KEYS.divergencias) || [];
        const recontagens  = global.storageLoad(global.KEYS.recontagens)  || [];
        const coletores    = global.storageLoad(global.KEYS.coletores)    || [];
        State.batch([
          Actions.replaceSlice('contagens',    contagens,    { source: 'polling-cache' }),
          Actions.replaceSlice('divergencias', divergencias, { source: 'polling-cache' }),
          Actions.replaceSlice('recontagens',  recontagens,  { source: 'polling-cache' }),
          Actions.replaceSlice('coletores',    coletores,    { source: 'polling-cache' })
        ]);
        if (global.AnalistaNavigation?.renderCurrentPage) global.AnalistaNavigation.renderCurrentPage();
        if (typeof global.atualizarBadgesNav === 'function') global.atualizarBadgesNav();
        updateSyncUI(true, new Date().toLocaleTimeString('pt-BR'));
      }
      lastTs = currentTs || lastTs;
    }, 5000);
  }

  async function initApp(){
    loadAll();
    setupStorageSync();
    startPolling();
    if (global.AnalistaAppController?.bindUI) global.AnalistaAppController.bindUI();
    renderAll();
    if (typeof global.logSistema === 'function') global.logSistema('SISTEMA', 'Painel do analista iniciado', {});
    updateSyncUI(true, 'Cache carregado');
    if (global.AnalistaFirebaseService?.start) {
      try {
        await global.AnalistaFirebaseService.start();
        renderAll();
      } catch(e) {
        console.warn('[Bootstrap] Erro ao iniciar Firebase:', e.message);
      }
    }
  }

  global.AnalistaBootstrap = {
    getState,
    loadAll,
    saveAll,
    renderAll,
    setupStorageSync,
    startPolling,
    initApp,
    updateSyncUI,
    agruparEnderecosPorSetor,
    snapshotForCache
  };
global.initApp = initApp;

  // updateSyncUI: mantido como global pois firebaseService.js o usa diretamente.
  // Todos os outros aliases foram removidos — usar global.AnalistaBootstrap.<método>.
  global.updateSyncUI = updateSyncUI;
})(window);
