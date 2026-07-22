(function(global){
  const Actions           = global.AnalistaActions;
  const InventarioService = global.AnalistaInventarioService;

  const state = {
    started: false,
    currentInventoryIds: [],
    unsubscribers: { contagens: [], vazios: [], recontagens: [], coletores: null, enderecos: null }
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

  
  function _normalizarEndereco(doc){
    const data = doc.data ? (doc.data() || {}) : (doc || {});
    const id = doc.id || data.id || data.endereco || data.endereco_completo || '';
    return { id, ...data, endereco: data.endereco || data.endereco_completo || id };
  }

  function _aplicarEnderecos(docs, origem){
    const limpos = (docs || []).filter(Boolean).map(item => ({
      ...item,
      id: item.id || item.endereco || item.endereco_completo,
      endereco: item.endereco || item.endereco_completo || item.id
    })).filter(item => item.endereco);
    global.AnalistaStore.dispatch(Actions.replaceSlice('enderecosLista', limpos, { source: origem || 'firebase' }));
    const agrupados = global.AnalistaBootstrap?.agruparEnderecosPorSetor
      ? global.AnalistaBootstrap.agruparEnderecosPorSetor(limpos)
      : {};
    global.AnalistaStore.dispatch(Actions.setPath('enderecosPorSetor', agrupados, { source: origem || 'firebase' }));
    const Storage = global.AnalistaStorage;
    if (Storage?.storageSave && Storage?.KEYS?.enderecos) Storage.storageSave(Storage.KEYS.enderecos, limpos);
    if (typeof global.atualizarEnderecos === 'function') global.atualizarEnderecos();
    _emitSync(true, `${limpos.length} endereços carregados de ${origem || 'Firebase'}`);
    return limpos;
  }

  async function _baixarEnderecosAgora(){
    // Fonte principal real: dt_locais, documento por endereço.
    try {
      const snap = await global.FS_AN.collection('dt_locais').get();
      if (!snap.empty) return _aplicarEnderecos(snap.docs.map(_normalizarEndereco), 'dt_locais');
    } catch (e) {
      console.error('[FirebaseService] dt_locais:', e);
      _emitSync(false, `Erro dt_locais: ${e.code || e.message}`);
    }
    // Compatibilidade com publicação em chunks.
    try {
      const snap = await global.FS_AN.collection('dt_locais_chunks').get();
      const docs=[];
      snap.docs.forEach(doc => {
        const data=doc.data()||{};
        const itens=Array.isArray(data.dados)?data.dados:(Array.isArray(data.itens)?data.itens:[]);
        itens.forEach((item,index)=>docs.push({id:item.id||`${doc.id}_${index}`,...item}));
      });
      if (docs.length) return _aplicarEnderecos(docs, 'dt_locais_chunks');
    } catch(e){
      console.error('[FirebaseService] dt_locais_chunks:', e);
      _emitSync(false, `Erro dt_locais_chunks: ${e.code || e.message}`);
    }
    _emitSync(false, 'Firebase conectado, mas nenhuma base de endereços foi encontrada.');
    return [];
  }

  function _listenEnderecos(){
    if (!navigator.onLine) return null;
    // Escuta a coleção que existe no console do usuário.
    return global.FS_AN.collection('dt_locais').onSnapshot(snapshot => {
      _aplicarEnderecos(snapshot.docs.map(_normalizarEndereco), 'dt_locais');
    }, err => {
      console.error('[FirebaseService] listener dt_locais:', err);
      _emitSync(false, `Falha ao ler dt_locais: ${err.code || err.message}`);
      _baixarEnderecosAgora();
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
    try {
      const snap = await global.FS_AN.collection('dt_inventarios').get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      global.AnalistaStore.dispatch(Actions.replaceSlice('inventarios', docs, { source: 'firebase-init' }));
      const Storage = global.AnalistaStorage;
      if (Storage?.storageSave && Storage?.KEYS?.inventarios) Storage.storageSave(Storage.KEYS.inventarios, docs);
      return docs;
    } catch(e) {
      console.error('[FirebaseService] Falha ao carregar inventários:', e);
      _emitSync(false, `Erro em dt_inventarios: ${e.code || e.message}`);
      return [];
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
      if (collection === 'coletores') return;
      if (collection === 'enderecos') {
        if (typeof state.unsubscribers.enderecos === 'function') {
          try { state.unsubscribers.enderecos(); } catch(_) {}
        }
        state.unsubscribers.enderecos = null;
        return;
      }
      (state.unsubscribers[collection] || []).forEach(unsub => { try { unsub(); } catch(_) {} });
      state.unsubscribers[collection] = [];
    });
    _pararColetores();
    state.started = false;
    state.currentInventoryIds = [];
    _emitSync(false, 'Escutas pausadas', { started: false });
  }

  async function _carregarColecaoCompleta(slice, path, normalizer){
    try {
      const snap = await global.FS_AN.collection(path).get();
      const docs = snap.docs.map(d => {
        const raw={id:d.id,...d.data()};
        return normalizer ? normalizer(raw) : raw;
      });
      global.AnalistaStore.dispatch(Actions.replaceSlice(slice, docs, {source:'firebase-init', collection:path}));
      return docs;
    } catch(e){
      console.error(`[FirebaseService] ${path}:`, e);
      _emitSync(false, `Erro em ${path}: ${e.code || e.message}`);
      return [];
    }
  }

  async function _cargaInicialCompleta(){
    if (!global.AUTH_AN?.currentUser && !global.firebase?.auth?.()?.currentUser) {
      throw new Error('Usuário ainda não autenticado no Firebase.');
    }
    await _carregarInventariosSeNecessario();
    await Promise.all([
      _baixarEnderecosAgora(),
      _carregarColecaoCompleta('contagens','dt_contagens', InventarioService.normalizarContagem),
      _carregarColecaoCompleta('recontagens','dt_recontagens'),
      _carregarColecaoCompleta('divergencias','dt_divergencias'),
      _carregarColecaoCompleta('coletores','dt_coletores'),
      _carregarColecaoCompleta('auditorias','dt_auditorias'),
      _carregarColecaoCompleta('auditoria_imports','dt_auditoria_imports')
    ]);
    global.AnalistaBootstrap?.saveAll?.();
    global.AnalistaNavigation?.renderCurrentPage?.();
  }

  async function start(){
    if (!navigator.onLine) {
      _emitSync(false, 'Offline — usando cache local', { started: false, source: 'cache' });
      return false;
    }

    if (!global.AUTH_AN?.currentUser) {
      _emitSync(false, 'Aguardando autenticação do Firebase');
      return false;
    }

    await _cargaInicialCompleta();

    // Sempre garantir listener de coletores ativo (independe de inventários)
    if (!state.unsubscribers.coletores) {
      state.unsubscribers.coletores = _listenColetores();
    }

    // Ativar atualização em tempo real depois da carga inicial.
    if (!state.unsubscribers.enderecos) state.unsubscribers.enderecos = _listenEnderecos();

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

  global.AnalistaFirebaseService = { start, stop, refreshFromCache, refreshFirebase: _cargaInicialCompleta, state };
})(window);
