(function(global){
  const Actions           = global.AnalistaActions;
  const InventarioService = global.AnalistaInventarioService;

  const state = {
    started: false,
    currentInventoryIds: [],
    unsubscribers: { contagens: [], vazios: [], divergencias: [], recontagens: [], coletores: null, enderecos: null }
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

  function _normalizarMudanca(collection, change){
    const raw = { id: change.doc.id, ...change.doc.data() };
    const normalized = (collection === 'recontagens' || collection === 'divergencias')
      ? raw
      : InventarioService.normalizarContagem(raw);
    return { type: change.type, entity: normalized };
  }

  function _persistirSlice(slice){
    try {
      const Storage = global.AnalistaStorage;
      const st = global.AnalistaStore.getState();
      if (!Storage?.storageSave) return;
      if (slice === 'contagens') Storage.storageSave(Storage.KEYS.contagens, st.contagens || []);
      if (slice === 'recontagens') Storage.storageSave(Storage.KEYS.recontagens, st.recontagens || []);
      if (slice === 'divergencias') Storage.storageSave(Storage.KEYS.divergencias, st.divergencias || []);
    } catch (err) {
      console.warn('[FirebaseService] cache da coleção:', err?.message || err);
    }
  }

  // Aplica todo o snapshot em uma única ação. O subscriber do AppController é o
  // único responsável por solicitar renderização e atualização dos badges.
  function _applyCollectionChanges(collection, docChanges){
    const changes = (docChanges || []).map(change => _normalizarMudanca(collection, change));
    if (!changes.length) return false;

    const slice = collection === 'vazios' ? 'contagens' : collection;
    const atual = Array.isArray(global.AnalistaStore.getState()[slice])
      ? global.AnalistaStore.getState()[slice]
      : [];
    const byId = new Map(atual.map(item => [String(item?.id || ''), item]));

    changes.forEach(({ type, entity }) => {
      const id = String(entity?.id || '');
      if (!id) return;
      if (type === 'removed') byId.delete(id);
      else byId.set(id, entity);
    });

    global.AnalistaStore.dispatch(Actions.replaceSlice(slice, Array.from(byId.values()), {
      source: 'firebase-batch',
      collection,
      changes: changes.length
    }));
    _persistirSlice(slice);
    return true;
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
          const changed = _applyCollectionChanges(collection, snapshot.docChanges());
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
    // Nem todas as coleções usam o mesmo campo de data (criado_em/criada_em).
    // Evitar orderBy aqui impede que a escuta falhe por campo ausente ou índice.
    const unsub = global.FS_AN.collection(path)
      .limit(1000)
      .onSnapshot(snapshot => {
        const changed = _applyCollectionChanges(collection, snapshot.docChanges());
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

  function _normalizarItemBase(item){
    const x=Object.assign({},item||{});
    const qtd=x.quantidade_esperada ?? x.quantidadeEsperada ?? x.qtd_esperada ?? x.qtdEsperada ?? x.quantidade_sistema ?? x.quantidadeSistema ?? x.quantidade;
    const cod=x.codigo_produto ?? x.codigoProduto ?? x.codigo_interno ?? x.codigoInterno ?? x.sku ?? x.gtin ?? x.ean ?? x.dun ?? '';
    const desc=x.descricao_produto ?? x.descricaoProduto ?? x.descricao ?? x.produto_nome ?? x.nomeProduto ?? x.produto ?? '';
    return Object.assign({},x,{
      endereco:String(x.endereco ?? x.localizacao ?? x.posicao ?? '').trim(),
      codigo_produto:String(cod??'').trim(),
      descricao_produto:String(desc??'').trim(),
      quantidade_esperada:Number.isFinite(Number(qtd))?Number(qtd):0
    });
  }

  async function _carregarBaseInventario(inv, force=false){
    if (!inv || !inv.id) return inv;
    if (!force && Array.isArray(inv.base) && inv.base.length) return inv;
    try{
      const snap = await global.FS_AN.collection('dt_inventarios').doc(String(inv.id))
        .collection('base_chunks').orderBy('parte').get();
      let base=[];
      snap.docs.forEach(d=>{
        const x=d.data()||{};
        const itens=Array.isArray(x.itens)?x.itens:(Array.isArray(x.dados)?x.dados:[]);
        base=base.concat(itens.map(_normalizarItemBase));
      });
      return Object.assign({},inv,{base,base_carregada_em:new Date().toISOString(),base_total:base.length});
    }catch(e){
      console.warn('[FirebaseService] Falha ao carregar base do inventário',inv.id,e.message);
      return inv;
    }
  }

  // Carrega os metadados e enriquece os inventários com os base_chunks reais.
  // Isso não depende mais do localStorage, que possui quota pequena.
  async function _carregarInventariosSeNecessario(){
    try {
      const snap = await global.FS_AN.collection('dt_inventarios').get();
      if (snap.empty) {
        global.AnalistaStore.dispatch(Actions.batch([
          Actions.replaceSlice('inventarios', [], {source:'firebase-no-inventories'}),
          Actions.replaceSlice('contagens', [], {source:'firebase-no-inventories'}),
          Actions.replaceSlice('vazios', [], {source:'firebase-no-inventories'}),
          Actions.replaceSlice('divergencias', [], {source:'firebase-no-inventories'}),
          Actions.replaceSlice('recontagens', [], {source:'firebase-no-inventories'})
        ], {source:'firebase-no-inventories'}));
        const Storage=global.AnalistaStorage;
        ['inventarios','contagens','divergencias','recontagens'].forEach(function(k){
          if(Storage?.storageSave&&Storage?.KEYS?.[k])Storage.storageSave(Storage.KEYS[k],[]);
        });
        return [];
      }
      const atuais = global.AnalistaStore.getState().inventarios || [];
      const atuaisPorId = new Map(atuais.map(i=>[String(i.id),i]));
      let docs = snap.docs.map(d => Object.assign({},atuaisPorId.get(String(d.id))||{},d.data(),{id:d.id}));
      const statusAtivos=new Set(['ATIVO','ABERTO','PUBLICADO','LIBERADO','EM_ANDAMENTO','PAUSADO']);
      const idsNecessarios=new Set();
      const st=global.AnalistaStore.getState();
      ['contagens','divergencias','recontagens'].forEach(slice=>(st[slice]||[]).forEach(x=>{
        const id=x.inventario_id||x.inventarioId||x.inventario||x.inv_id;
        if(id!=null&&String(id))idsNecessarios.add(String(id));
      }));
      docs = await Promise.all(docs.map(inv=>{
        const aliases=[inv.id,inv.codigo,inv.nome,inv.inventario_id,inv.inventarioId].filter(v=>v!=null).map(v=>String(v));
        const precisa=statusAtivos.has(String(inv.status||'').toUpperCase())||aliases.some(a=>idsNecessarios.has(a));
        return precisa?_carregarBaseInventario(inv,true):inv;
      }));
      global.AnalistaStore.dispatch(Actions.replaceSlice('inventarios', docs, { source: 'firebase-init-bases' }));
      const aliasesValidos=new Set();
      docs.forEach(function(inv){[inv.id,inv.codigo,inv.nome,inv.inventario_id,inv.inventarioId].filter(function(v){return v!=null&&String(v).trim();}).forEach(function(v){aliasesValidos.add(String(v).trim());});});
      ['contagens','vazios','divergencias','recontagens'].forEach(function(slice){
        const atual=global.AnalistaStore.getState()[slice]||[];
        const limpo=atual.filter(function(x){const id=x.inventario_id??x.inventarioId??x.inventario??x.inv_id;return id!=null&&aliasesValidos.has(String(id).trim());});
        if(limpo.length!==atual.length)global.AnalistaStore.dispatch(Actions.replaceSlice(slice,limpo,{source:'firebase-prune-orfaos'}));
      });
      const Storage = global.AnalistaStorage;
      if (Storage?.storageSave && Storage?.KEYS?.inventarios) {
        const metadados=docs.map(inv=>{const c=Object.assign({},inv);delete c.base;return c;});
        Storage.storageSave(Storage.KEYS.inventarios, metadados);
      }
      global.dispatchEvent(new CustomEvent('dt-inventarios-bases-atualizadas',{detail:{total:docs.length}}));
    } catch(e) {
      console.warn('[FirebaseService] Falha ao carregar inventários:', e.message);
    }
  }

  async function refreshBasesRelacionadas(){
    await _carregarInventariosSeNecessario();
    try{ await global.DTProdutos?.carregar?.(true); }catch(e){ console.warn('[FirebaseService] Atualização de produtos:',e.message); }
    try{ global.AnalistaDivergenciaService?.processarDivergencias?.({criarRecontagens:true,source:'bases-refresh',force:true}); }catch(e){ console.warn('[FirebaseService] Reprocessamento de bases:',e.message); }
    return true;
  }

  if(!global.__dtBasesProdutoListener){
    global.__dtBasesProdutoListener=true;
    global.addEventListener('dt-produtos-atualizados',function(){
      clearTimeout(global.__dtBasesProdutoTid);
      global.__dtBasesProdutoTid=setTimeout(function(){
        _carregarInventariosSeNecessario().then(function(){
          try{global.AnalistaDivergenciaService?.processarDivergencias?.({criarRecontagens:true,source:'produtos-atualizados',force:true});}catch(e){console.warn('[FirebaseService] Reprocessar produtos:',e.message);}
        });
      },120);
    });
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
    try{
      if(global.DTProdutos?.carregar) await global.DTProdutos.carregar(false);
    }catch(e){ console.warn('[FirebaseService] Falha ao carregar Base de Produtos:',e.message); }
    // Reprocessar registros antigos depois que a base do inventário e o catálogo
    // de produtos estiverem disponíveis. Isso corrige automaticamente registros
    // que antes apareciam como "Código sem cadastro" e qtd sistema null.
    try{
      global.AnalistaDivergenciaService?.processarDivergencias?.({criarRecontagens:true,source:'bases-carregadas',force:true});
    }catch(e){ console.warn('[FirebaseService] Reprocessamento após carregar bases:',e.message); }
    if (!state.unsubscribers.enderecos) state.unsubscribers.enderecos = _listenEnderecos();

    const ids = _getActiveInventoryIds();
    if (!ids.length) {
      ['contagens','vazios','divergencias','recontagens'].forEach(function(collection){
        (state.unsubscribers[collection]||[]).forEach(function(unsub){try{unsub();}catch(_e){}});
        state.unsubscribers[collection]=[];
      });
      state.started=false;state.currentInventoryIds=[];
      _emitSync(true, 'Sem inventário ativo — dados operacionais limpos.', { started: false, source: 'firebase' });
      return true;
    }

    const fingerprint = ids.join('|');
    if (state.started && state.currentInventoryIds.join('|') === fingerprint) {
      _emitSync(true, 'Tempo real ativo', { started: true });
      return true;
    }

    // Parar listeners de contagens antes de reiniciar
    ['contagens', 'vazios', 'divergencias', 'recontagens'].forEach(collection => {
      (state.unsubscribers[collection] || []).forEach(unsub => { try { unsub(); } catch(_) {} });
      state.unsubscribers[collection] = [];
    });

    state.unsubscribers.contagens   = _listenCollection('contagens',   'dt_contagens');
    state.unsubscribers.vazios      = _listenCollection('vazios',      'dt_vazios');
    state.unsubscribers.divergencias = _listenCollection('divergencias', 'dt_divergencias');
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

  global.AnalistaFirebaseService = { start, stop, refreshFromCache, refreshColetores, refreshBasesRelacionadas, state };
})(window);
