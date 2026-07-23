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
    try {
      const Storage = global.AnalistaStorage;
      const st = global.AnalistaStore.getState();
      if (Storage?.storageSave) {
        if (slice === 'contagens') Storage.storageSave(Storage.KEYS.contagens, st.contagens || []);
        if (slice === 'recontagens') Storage.storageSave(Storage.KEYS.recontagens, st.recontagens || []);
      }
      if (typeof global.atualizarBadgesNav === 'function') global.atualizarBadgesNav();
      const page = global.AnalistaStore.getState()?.ui?.currentPage;
      if (['contagens','pendencias','divergencias','recontagens','acompanhamento'].includes(page)) {
        global.AnalistaNavigation?.renderCurrentPage?.();
      }
    } catch (_) {}
  }

  
  function _listenEnderecos(){
    if (!navigator.onLine) return null;

    const aplicar = docs => {
      global.AnalistaStore.dispatch(
        Actions.replaceSlice('enderecosLista', docs, { source: 'firebase' })
      );
      const agrupados = global.AnalistaBootstrap?.agruparEnderecosPorSetor
        ? global.AnalistaBootstrap.agruparEnderecosPorSetor(docs)
        : docs.reduce((acc, item) => {
            const setor = item?.setor || item?.local || item?.nome_local || 'SEM_SETOR';
            if (!acc[setor]) acc[setor] = [];
            acc[setor].push(item);
            return acc;
          }, {});
      global.AnalistaStore.dispatch(
        Actions.setPath('enderecosPorSetor', agrupados, { source: 'firebase' })
      );
      const Storage = global.AnalistaStorage;
      if (Storage?.storageSave && Storage?.KEYS?.enderecos) {
        Storage.storageSave(Storage.KEYS.enderecos, docs);
      }
      if (typeof global.atualizarEnderecos === 'function') global.atualizarEnderecos();
      _emitSync(true, `${docs.length} endereços carregados do Firebase`);
    };

    // A publicação atual grava os endereços em dt_locais_chunks.
    return global.FS_AN.collection('dt_locais_chunks')
      .orderBy('parte')
      .onSnapshot(async snapshot => {
        const docs = [];
        snapshot.docs.forEach(doc => {
          const data = doc.data() || {};
          const itens = Array.isArray(data.dados) ? data.dados
                     : Array.isArray(data.itens) ? data.itens : [];
          itens.forEach((item, index) => docs.push({
            id: item.id || `${doc.id}_${index}`,
            ...item
          }));
        });

        // Se dt_locais_chunks não existir ou estiver vazio, ler a coleção real
        // mostrada no Firebase Console: dt_locais.
        if (!docs.length) {
          try {
            const snap = await global.FS_AN.collection('dt_locais').get();
            aplicar(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            return;
          } catch (fallbackErr) {
            console.warn('[FirebaseService] dt_locais fallback vazio:', fallbackErr.message);
          }
        }
        aplicar(docs);
      }, async err => {
        console.warn('[FirebaseService] dt_locais_chunks:', err.message);
        // Compatibilidade com bases antigas publicadas documento a documento.
        try {
          const snap = await global.FS_AN.collection('dt_locais').get();
          aplicar(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (fallbackErr) {
          console.warn('[FirebaseService] dt_locais fallback:', fallbackErr.message);
          _emitSync(false, 'Falha ao carregar endereços do Firebase');
        }
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
  let _coletoresFingerprint = '';

  function _normalizarColetores(snapshot){
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.excluido !== true && d.aprovado !== 'revogado');
  }

  function _fingerprintColetores(docs){
    return JSON.stringify(docs.map(item => ({
      id: item.id,
      aprovado: item.aprovado || 'pendente',
      bloqueado: item.bloqueado === true,
      ativo: item.ativo !== false,
      status: item.status || 'offline',
      nome_exibicao: item.nome_exibicao || item.nome_coletor || '',
      operador_atual: item.operador_atual || '',
      ultimo_ping: item.ultimo_ping || '',
      sessao: item.sessao || null,
      contagens_enviadas: item.contagens_enviadas || 0,
      contagens_pendentes: item.contagens_pendentes || 0
    })));
  }

  function _aplicarSnapshotColetores(snapshot, source){
    const docs = _normalizarColetores(snapshot);
    const fingerprint = _fingerprintColetores(docs);

    // Um mesmo snapshot chegava por refresh + onSnapshot e era renderizado duas
    // vezes: diretamente aqui e novamente pelo subscriber do Store. Agora o
    // Store é o único responsável por solicitar a renderização e snapshots
    // idênticos são ignorados.
    if (fingerprint === _coletoresFingerprint) return docs;
    _coletoresFingerprint = fingerprint;

    global.AnalistaStore.dispatch(Actions.replaceSlice('coletores', docs, {
      source: source || 'firebase', collection: 'coletores'
    }));
    const Storage = global.AnalistaStorage;
    if (Storage?.storageSave && Storage?.KEYS?.coletores) {
      Storage.storageSave(Storage.KEYS.coletores, docs);
    }
    return docs;
  }

  async function refreshColetores(){
    if (!navigator.onLine) return global.AnalistaStore.getState().coletores || [];
    try {
      const snapshot = await global.FS_AN.collection('dt_coletores').get();
      return _aplicarSnapshotColetores(snapshot, 'firebase-refresh-coletores');
    } catch (err) {
      console.warn('[FirebaseService] refresh coletores:', err.message);
      throw err;
    }
  }

  function _listenColetores(){
    if (!navigator.onLine) return null;
    return global.FS_AN.collection('dt_coletores')
      .onSnapshot(snapshot => {
        _aplicarSnapshotColetores(snapshot, 'firebase-listener-coletores');
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

  async function start(){
    if (!navigator.onLine) {
      _emitSync(false, 'Offline — usando cache local', { started: false, source: 'cache' });
      return false;
    }

    // Sempre garantir listener de coletores ativo (independe de inventários)
    if (!state.unsubscribers.coletores) {
      state.unsubscribers.coletores = _listenColetores();
    }

    // Carregar inventários e catálogo de endereços do Firebase.
    await _carregarInventariosSeNecessario();
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

  global.AnalistaFirebaseService = { start, stop, refreshFromCache, refreshColetores, state };
})(window);
