(function(global){
  // ── 8. SINCRONIZAÇÃO DE CONTAGENS ──────────────────────────────────────────
  const Storage = global.AnalistaStorage;
  const Actions = global.AnalistaActions;

  /** Recarrega contagens do Firestore (se online) ou do cache local */
  async function sincronizarContagens() {
    const dotEl = document.getElementById('sync-dot');
    if (dotEl) dotEl.className = 'sync-dot sync';

    if (navigator.onLine && global.AnalistaFirebaseService?.start) {
      try {
        global.AnalistaFirebaseService.start();
        global.AnalistaNavigation?.renderCurrentPage?.();
        if (typeof global.atualizarBadgesNav === 'function') global.atualizarBadgesNav();
        global.AnalistaBootstrap.updateSyncUI(true, new Date().toLocaleTimeString('pt-BR'));
        showToast('🔄 Sincronização em tempo real reativada!', 's');
        return;
      } catch(e) {
        dbg('[sync] Falha ao reativar realtime Firebase:', e.message);
      }
    }

    if (global.AnalistaFirebaseService?.refreshFromCache) {
      global.AnalistaFirebaseService.refreshFromCache();
    } else {
      global.AnalistaState.batch([
        Actions.replaceSlice('contagens',   Storage.storageLoad(Storage.KEYS.contagens)   || [], { source: 'manual-cache-refresh' }),
        Actions.replaceSlice('divergencias',Storage.storageLoad(Storage.KEYS.divergencias)|| [], { source: 'manual-cache-refresh' }),
        Actions.replaceSlice('recontagens', Storage.storageLoad(Storage.KEYS.recontagens) || [], { source: 'manual-cache-refresh' })
      ]);
      global.AnalistaNavigation?.renderCurrentPage?.();
      if (typeof global.atualizarBadgesNav === 'function') global.atualizarBadgesNav();
      global.AnalistaBootstrap.updateSyncUI(true, new Date().toLocaleTimeString('pt-BR'));
    }
    showToast('🔄 Cache local recarregado.', 'i');
  }

  // Exportar para chamadas de botões na UI
  global.sincronizarContagens = sincronizarContagens;
})(window);
