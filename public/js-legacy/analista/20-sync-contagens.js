/* ============================================================================
 * ANALISTA — SINCRONIZACAO CANONICA
 * ----------------------------------------------------------------------------
 * Substitui sincronizarContagens().
 *
 * Requisitos do AnalistaFirebaseService:
 * - start() deve ser idempotente OU expor isStarted()/started.
 * - Preferencialmente deve retornar uma Promise resolvida apos o primeiro
 *   snapshot consistente das colecoes obrigatorias.
 * - refreshFromCache() pode retornar payload ou atualizar a Store internamente.
 *
 * Este modulo:
 * - aguarda operacoes assincronas;
 * - impede cliques concorrentes;
 * - nao cria listeners repetidos quando o servico informa que ja esta ativo;
 * - diferencia Firebase confirmado de cache local;
 * - nao informa sucesso antes da conclusao;
 * - sempre restaura o indicador visual;
 * - retorna um resultado estruturado para testes e logs.
 * ========================================================================== */

(function (global) {
  'use strict';

  var Storage = global.AnalistaStorage;
  var Actions = global.AnalistaActions;

  var syncInFlight = null;
  var localRealtimeStarted = false;

  function getStore() {
    return global.AnalistaStore || global.AnalistaState || null;
  }

  function getState() {
    var store = getStore();
    if (store && typeof store.getState === 'function') return store.getState();
    return {};
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function nowLabel() {
    return new Date().toLocaleTimeString('pt-BR');
  }

  function debug() {
    if (typeof global.dbg === 'function') {
      global.dbg.apply(global, arguments);
    } else {
      console.debug.apply(console, arguments);
    }
  }

  function toast(message, type) {
    if (typeof global.showToast === 'function') {
      global.showToast(message, type || 'i');
    } else {
      console.log(message);
    }
  }

  function setSyncDot(mode) {
    var dot = document.getElementById('sync-dot');
    if (!dot) return;

    if (mode === 'syncing') dot.className = 'sync-dot sync';
    else if (mode === 'error') dot.className = 'sync-dot error';
    else if (mode === 'offline') dot.className = 'sync-dot offline';
    else dot.className = 'sync-dot online';
  }

  function setSyncButtonsDisabled(disabled) {
    var selectors = [
      '[data-action="sync"]',
      '#btn-sync',
      '#btn-sincronizar',
      'button[onclick*="sincronizarContagens"]'
    ];

    document.querySelectorAll(selectors.join(',')).forEach(function (button) {
      button.disabled = Boolean(disabled);
      button.setAttribute('aria-busy', disabled ? 'true' : 'false');
    });
  }

  function updateSyncUI(status, label, source) {
    var bootstrap = global.AnalistaBootstrap;
    if (!bootstrap || typeof bootstrap.updateSyncUI !== 'function') return;

    /*
     * Compatibilidade:
     * - true somente para dados remotos confirmados;
     * - false para cache/offline/erro.
     */
    bootstrap.updateSyncUI(status === 'remote', label || nowLabel(), source || status);
  }

  function normalizeArray(value, name) {
    if (value === undefined || value === null) {
      throw new Error('Cache ausente para ' + name + '.');
    }
    if (!Array.isArray(value)) {
      throw new Error('Cache invalido para ' + name + '.');
    }
    return value;
  }

  function loadCachePayload() {
    if (!Storage || typeof Storage.storageLoad !== 'function' || !Storage.KEYS) {
      throw new Error('AnalistaStorage indisponivel.');
    }

    var contagens = Storage.storageLoad(Storage.KEYS.contagens);
    var divergencias = Storage.storageLoad(Storage.KEYS.divergencias);
    var recontagens = Storage.storageLoad(Storage.KEYS.recontagens);

    return {
      contagens: normalizeArray(contagens, 'contagens'),
      divergencias: normalizeArray(divergencias, 'divergencias'),
      recontagens: normalizeArray(recontagens, 'recontagens')
    };
  }

  function dispatchActions(actions) {
    var store = getStore();

    if (global.AnalistaState && typeof global.AnalistaState.batch === 'function') {
      global.AnalistaState.batch(actions);
      return;
    }

    if (store && typeof store.dispatch === 'function') {
      if (Actions && typeof Actions.batch === 'function') {
        store.dispatch(Actions.batch(actions, { source: 'manual-sync-cache' }));
      } else {
        actions.forEach(function (action) {
          store.dispatch(action);
        });
      }
      return;
    }

    throw new Error('Store sem suporte a batch ou dispatch.');
  }

  function replaceSlicesFromCache(payload) {
    if (!Actions || typeof Actions.replaceSlice !== 'function') {
      throw new Error('AnalistaActions.replaceSlice indisponivel.');
    }

    dispatchActions([
      Actions.replaceSlice('contagens', payload.contagens, {
        source: 'manual-cache-refresh'
      }),
      Actions.replaceSlice('divergencias', payload.divergencias, {
        source: 'manual-cache-refresh'
      }),
      Actions.replaceSlice('recontagens', payload.recontagens, {
        source: 'manual-cache-refresh'
      })
    ]);
  }

  function renderCurrentState() {
    var navigation = global.AnalistaNavigation;

    if (navigation && typeof navigation.renderCurrentPage === 'function') {
      navigation.renderCurrentPage();
    } else {
      /*
       * Fallback seguro. Executa apenas a tela visivel quando possivel.
       */
      var active = document.querySelector('[data-page].active, .page.active');
      var page = active && active.dataset ? active.dataset.page : '';

      if (page === 'contagens' && typeof global.renderContagens === 'function') {
        global.renderContagens();
      } else if (page === 'pendencias' && typeof global.renderPendencias === 'function') {
        global.renderPendencias();
      } else if (page === 'divergencias' && typeof global.renderDivergencias === 'function') {
        global.renderDivergencias();
      } else if (page === 'recontagens' && typeof global.renderRecontagens === 'function') {
        global.renderRecontagens();
      }
    }

    if (typeof global.atualizarBadgesNav === 'function') {
      global.atualizarBadgesNav();
    }
  }

  function serviceAlreadyStarted(service) {
    if (!service) return false;

    if (typeof service.isStarted === 'function') {
      try {
        return Boolean(service.isStarted());
      } catch (error) {
        debug('[sync] isStarted falhou:', error);
      }
    }

    if (typeof service.isRunning === 'function') {
      try {
        return Boolean(service.isRunning());
      } catch (error) {
        debug('[sync] isRunning falhou:', error);
      }
    }

    return Boolean(
      service.started ||
      service.running ||
      service.active ||
      localRealtimeStarted
    );
  }

  function signature() {
    var st = getState();
    return [
      Array.isArray(st.contagens) ? st.contagens.length : -1,
      Array.isArray(st.divergencias) ? st.divergencias.length : -1,
      Array.isArray(st.recontagens) ? st.recontagens.length : -1,
      st.lastFirebaseSync || st._lastFirebaseSync || ''
    ].join('|');
  }

  function waitForFirstConfirmedUpdate(before, timeoutMs) {
    var store = getStore();
    timeoutMs = timeoutMs || 12000;

    return new Promise(function (resolve, reject) {
      var finished = false;
      var unsubscribe = null;
      var timer = null;

      function cleanup() {
        if (typeof unsubscribe === 'function') unsubscribe();
        if (timer) clearTimeout(timer);
      }

      function done() {
        if (finished) return;
        finished = true;
        cleanup();
        resolve();
      }

      function fail() {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error('Tempo limite aguardando dados do Firebase.'));
      }

      if (store && typeof store.subscribe === 'function') {
        unsubscribe = store.subscribe(function () {
          if (signature() !== before) done();
        });
      }

      timer = setTimeout(fail, timeoutMs);

      /*
       * Caso start() tenha atualizado sincronicamente.
       */
      if (signature() !== before) done();
    });
  }

  async function startRemoteAndWait() {
    var service = global.AnalistaFirebaseService;

    if (!service || typeof service.start !== 'function') {
      throw new Error('AnalistaFirebaseService.start indisponivel.');
    }

    var before = signature();
    var alreadyStarted = serviceAlreadyStarted(service);
    var startResult;

    if (!alreadyStarted) {
      startResult = service.start();
      if (startResult && typeof startResult.then === 'function') {
        await startResult;
      }
      localRealtimeStarted = true;
    } else if (typeof service.refresh === 'function') {
      var refreshResult = service.refresh();
      if (refreshResult && typeof refreshResult.then === 'function') {
        await refreshResult;
      }
    } else if (typeof service.requestSnapshot === 'function') {
      var snapshotResult = service.requestSnapshot();
      if (snapshotResult && typeof snapshotResult.then === 'function') {
        await snapshotResult;
      }
    }

    /*
     * Se o proprio servico declara que o primeiro snapshot foi recebido,
     * nao precisamos aguardar mudanca de assinatura.
     */
    if (
      service.firstSnapshotReady === true ||
      service.synced === true ||
      service.ready === true
    ) {
      return;
    }

    /*
     * Se start/refresh retornou um resultado explicito de sincronizacao,
     * considera confirmado.
     */
    if (
      startResult &&
      typeof startResult === 'object' &&
      (startResult.synced === true || startResult.ready === true)
    ) {
      return;
    }

    /*
     * Aguarda uma mudanca efetiva na Store. Se o servico ja estava ativo e
     * nao possui metodo refresh/requestSnapshot, nao cria listener novo.
     */
    await waitForFirstConfirmedUpdate(before, 12000);
  }

  async function refreshCacheSafely() {
    var service = global.AnalistaFirebaseService;

    if (service && typeof service.refreshFromCache === 'function') {
      var result = service.refreshFromCache();
      if (result && typeof result.then === 'function') {
        result = await result;
      }

      /*
       * Se o servico devolveu payload, aplica atomicamente.
       * Se devolveu undefined, presume que atualizou a Store internamente.
       */
      if (result && typeof result === 'object') {
        var payload = {
          contagens: normalizeArray(result.contagens, 'contagens'),
          divergencias: normalizeArray(result.divergencias, 'divergencias'),
          recontagens: normalizeArray(result.recontagens, 'recontagens')
        };
        replaceSlicesFromCache(payload);
      }

      return;
    }

    replaceSlicesFromCache(loadCachePayload());
  }

  async function performSync(options) {
    options = options || {};
    var allowCacheFallback = options.allowCacheFallback !== false;
    var remoteError = null;

    setSyncDot('syncing');
    setSyncButtonsDisabled(true);

    try {
      if (navigator.onLine) {
        try {
          await startRemoteAndWait();

          renderCurrentState();
          setSyncDot('online');
          updateSyncUI('remote', nowLabel(), 'firebase');

          toast('Dados atualizados pelo Firebase.', 's');

          return {
            sucesso: true,
            origem: 'firebase',
            remotoConfirmado: true,
            cache: false,
            atualizadoEm: nowIso(),
            erro: null
          };
        } catch (error) {
          remoteError = error;
          debug('[sync] Falha na sincronizacao remota:', error);
        }
      } else {
        remoteError = new Error('Navegador offline.');
      }

      if (!allowCacheFallback) {
        throw remoteError || new Error('Sincronizacao remota indisponivel.');
      }

      await refreshCacheSafely();
      renderCurrentState();

      setSyncDot('offline');
      updateSyncUI('cache', nowLabel(), 'cache');

      toast(
        remoteError
          ? 'Firebase indisponivel. Exibindo o ultimo cache local valido.'
          : 'Cache local carregado.',
        'i'
      );

      return {
        sucesso: true,
        origem: 'cache',
        remotoConfirmado: false,
        cache: true,
        atualizadoEm: nowIso(),
        erroRemoto: remoteError ? String(remoteError.message || remoteError) : null,
        erro: null
      };
    } catch (error) {
      setSyncDot('error');
      updateSyncUI('error', nowLabel(), 'error');

      debug('[sync] Falha total:', error);
      toast(
        'Nao foi possivel atualizar os dados nem carregar um cache local valido.',
        'e'
      );

      return {
        sucesso: false,
        origem: 'nenhuma',
        remotoConfirmado: false,
        cache: false,
        atualizadoEm: nowIso(),
        erroRemoto: remoteError ? String(remoteError.message || remoteError) : null,
        erro: String(error && (error.message || error))
      };
    } finally {
      setSyncButtonsDisabled(false);
    }
  }

  function sincronizarContagens(options) {
    if (syncInFlight) {
      return syncInFlight;
    }

    syncInFlight = performSync(options)
      .finally(function () {
        syncInFlight = null;
      });

    return syncInFlight;
  }

  global.sincronizarContagens = sincronizarContagens;

  global.AnalistaSyncModule = Object.freeze({
    sincronizarContagens: sincronizarContagens,
    isSyncing: function () {
      return Boolean(syncInFlight);
    },
    resetRealtimeState: function () {
      localRealtimeStarted = false;
    }
  });
})(window);
