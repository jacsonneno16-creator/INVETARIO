(function(global){
  const Actions           = global.AnalistaActions;
  const InventarioService = global.AnalistaInventarioService;

  const state = {
    started: false,
    currentInventoryIds: [],
    unsubscribers: { contagens: [], vazios: [], recontagens: [], coletores: null }
  };

  function _emitSync(ok, message, extra){
    global.AnalistaStore.dispatch(Actions.setSyncStatus(Object.assign({
      ok,
      message:    message || '',
      started:    state.started,
      lastSyncAt: new Date().toISOString(),
      source:     ok ? 'firebase' : 'cache'
    }, extra || {})));

    const updateUI = global.AnalistaBootstrap?.updateSyncUI;
    if (typeof updateUI === 'function') {
      updateUI(ok, message || new Date().toLocaleTimeString('pt-BR'));
    }
  }

  function _getActiveInventoryIds(){
    return InventarioService.getInventariosAtivosIds(global.AnalistaStore.getState().inventarios);
  }

  function _handleCollectionChange(collection, docChange){
    const raw        = { id: docChange.doc.id, ...docChange.doc.data() };
    const normalized = collection === 'recontagens'
      ? raw
      : InventarioService.normalizarContagem(raw);
    const slice = collection === 'vazios' ? 'contagens' : collection;
    if (docChange.type === 'removed') {
      global.AnalistaStore.dispatch(Actions.removeEntity(slice, normalized, { source: 'firebase', collection }));
    } else {
      global.AnalistaStore.dispatch(Actions.upsertEntity(slice, normalized, { source: 'firebase', collection }));
    }
  }

  
  function _listenEnderecos(){
    if (!navigator.onLine) return null;

    return global.FS_AN.collection('dt_enderecos')
      .onSnapshot(snapshot => {

        const docs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        global.AnalistaStore.dispatch(
          Actions.replaceSlice('enderecosLista', docs, {
            source: 'firebase'
          })
        );

        // formato correto esperado pela UI:
        // { SETOR: [enderecos] }
        const agrupados = (global.agruparEnderecosPorSetor)
          ? global.agruparEnderecosPorSetor(docs)
          : docs.reduce((acc, item) => {
              const setor = item?.setor || item?.local || item?.nome_local || 'SEM_SETOR';
              if (!acc[setor]) acc[setor] = [];
              acc[setor].push(item);
              return acc;
            }, {});

        global.AnalistaStore.dispatch(
          Actions.setPath('enderecosPorSetor', agrupados, {
            source: 'firebase'
          })
        );

        // Atualizar KPIs e tabela de endereços após carregar dados do Firebase
        if (typeof global.atualizarEnderecos === 'function') {
          global.atualizarEnderecos();
        }

      }, err => {
        console.warn('[FirebaseService] enderecos:', err.message);
      });
  }


  function _listenCollection(collection, path){
    const ids = _getActiveInventoryIds();
    if (!ids.length || !navigator.onLine) return [];
    const chunks = InventarioService.chunkIds(ids, 10);
    return chunks.map(chunk =>
      global.FS_AN.collection(path)
        .where('inventario_id', 'in', chunk)
        .onSnapshot(snapshot => {
          let changed = false;
          snapshot.docChanges().forEach(change => {
            _handleCollectionChange(collection, change);
            changed = true;
          });
          if (changed) _emitSync(true, 'Tempo real ativo');
        }, err => {
          console.warn(`[FirebaseService] ${collection}:`, err.message);
          _emitSync(false, `Falha na escuta de ${collection}`);
        })
    );
  }

  // Listener sem filtro de inventário — usado quando nenhum inventário está ativo no cache
  function _listenCollectionAll(collection, path){
    if (!navigator.onLine) return [];
    const unsub = global.FS_AN.collection(path)
      .orderBy('criado_em', 'desc')
      .limit(500)
      .onSnapshot(snapshot => {
        let changed = false;
        snapshot.docChanges().forEach(change => {
          _handleCollectionChange(collection, change);
          changed = true;
        });
        if (changed) _emitSync(true, 'Tempo real ativo');
      }, err => {
        console.warn(`[FirebaseService] ${collection} (all):`, err.message);
      });
    return [unsub];
  }

  // ── Listener de coletores (sem filtro por inventario_id) ─────────────────────
  function _listenColetores(){
    if (!navigator.onLine) return null;
    return global.FS_AN.collection('dt_coletores')
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          const doc = { id: change.doc.id, ...change.doc.data() };
          if (change.type === 'removed') {
            global.AnalistaStore.dispatch(Actions.removeEntity('coletores', doc, { source: 'firebase', collection: 'coletores' }));
          } else {
            global.AnalistaStore.dispatch(Actions.upsertEntity('coletores', doc, { source: 'firebase', collection: 'coletores' }));
          }
        });
        // Persistir no cache para uso offline
        const Storage = global.AnalistaStorage;
        if (Storage?.storageSave && Storage?.KEYS?.coletores) {
          Storage.storageSave(Storage.KEYS.coletores, global.AnalistaStore.getState().coletores);
        }
      }, err => {
        console.warn('[FirebaseService] coletores:', err.message);
      });
  }

  // ── Carrega inventários do Firestore se o cache estiver vazio ────────────────
  async function _carregarInventariosSeNecessario(){
    const ids = _getActiveInventoryIds();
    if (ids.length) return; // cache já tem dados, não precisa buscar
    try {
      const snap = await global.FS_AN.collection('dt_inventarios').get();
      if (snap.empty) return;
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      global.AnalistaStore.dispatch(Actions.replaceSlice('inventarios', docs, { source: 'firebase-init' }));
      const Storage = global.AnalistaStorage;
      if (Storage?.storageSave && Storage?.KEYS?.inventarios) {
        Storage.storageSave(Storage.KEYS.inventarios, docs);
      }
    } catch(e) {
      console.warn('[FirebaseService] Falha ao carregar inventários:', e.message);
    }
  }

  function _pararColetores(){
    if (state.unsubscribers.coletores) {
      try { state.unsubscribers.coletores(); } catch(_) {}
      state.unsubscribers.coletores = null;
    }
  }

  function stop(){
    Object.keys(state.unsubscribers).forEach(collection => {
      if (collection === 'coletores') return; // tratado separadamente
      (state.unsubscribers[collection] || []).forEach(unsub => { try { unsub(); } catch(_) {} });
      state.unsubscribers[collection] = [];
    });
    _pararColetores();
    state.started = false;
    state.currentInventoryIds = [];
    _emitSync(false, 'Escutas pausadas', { started: false });
  }

  async function start(){
    if (!navigator.onLine) {
      _emitSync(false, 'Offline — usando cache local', { started: false, source: 'cache' });
      return false;
    }

    // Sempre garantir listener de coletores ativo (independe de inventários)
    if (!state.unsubscribers.coletores) {
      state.unsubscribers.coletores = _listenColetores();
    }

    // Carregar inventários do Firebase se o cache estiver vazio
    await _carregarInventariosSeNecessario();

    const ids = _getActiveInventoryIds();
    if (!ids.length) {
      // Sem inventários ativos no cache — criar listener sem filtro para capturar contagens recentes
      if (!state.started) {
        state.unsubscribers.contagens = _listenCollectionAll('contagens', 'dt_contagens');
        state.unsubscribers.vazios    = _listenCollectionAll('vazios',    'dt_vazios');
        state.started = true;
        state.currentInventoryIds = [];
      }
      _emitSync(true, 'Coletores em tempo real. Aguardando inventário ativo.', { started: true, source: 'firebase' });
      return true;
    }

    const fingerprint = ids.join('|');
    if (state.started && state.currentInventoryIds.join('|') === fingerprint) {
      _emitSync(true, 'Tempo real ativo', { started: true });
      return true;
    }

    // Parar listeners de contagens antes de reiniciar
    ['contagens', 'vazios', 'recontagens'].forEach(collection => {
      (state.unsubscribers[collection] || []).forEach(unsub => { try { unsub(); } catch(_) {} });
      state.unsubscribers[collection] = [];
    });

    state.unsubscribers.contagens   = _listenCollection('contagens',   'dt_contagens');
    state.unsubscribers.vazios      = _listenCollection('vazios',      'dt_vazios');
    state.unsubscribers.recontagens = _listenCollection('recontagens', 'dt_recontagens');
    state.unsubscribers.enderecos = _listenEnderecos();
    state.started = true;
    state.currentInventoryIds = ids.slice();
    _emitSync(true, 'Tempo real ativo', { started: true });
    return true;
  }

  function refreshFromCache(){
    const Storage = global.AnalistaStorage;
    global.AnalistaStore.dispatch(Actions.hydrateCache({
      inventarios:       Storage.storageLoad(Storage.KEYS.inventarios)      || [],
      contagens:         Storage.storageLoad(Storage.KEYS.contagens)        || [],
      divergencias:      Storage.storageLoad(Storage.KEYS.divergencias)     || [],
      recontagens:       Storage.storageLoad(Storage.KEYS.recontagens)      || [],
      logs:              Storage.storageLoad(Storage.KEYS.logs)             || [],
      auditorias:        Storage.storageLoad(Storage.KEYS.auditorias)       || [],
      auditoria_imports: Storage.storageLoad(Storage.KEYS.auditoria_imports) || [],
      coletores:         Storage.storageLoad(Storage.KEYS.coletores)        || [],
      enderecosLista:    Storage.storageLoad(Storage.KEYS.enderecos)        || [],
      enderecosPorSetor: {},
      enderecosExpandidos: new Set(),
      enderecosTemp:     []
    }));
    _emitSync(true, 'Cache local recarregado', { started: false, source: 'cache' });
  }

  global.AnalistaFirebaseService = { start, stop, refreshFromCache, state };
})(window);
