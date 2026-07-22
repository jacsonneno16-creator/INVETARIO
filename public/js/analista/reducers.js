(function(global){
  function cloneValue(value){
    if (Array.isArray(value)) return value.slice();
    if (value instanceof Set) return new Set(Array.from(value));
    if (value && typeof value === 'object') return Object.assign({}, value);
    return value;
  }

  function getByPath(obj, path){
    return String(path || '').split('.').filter(Boolean).reduce((acc, key) => acc == null ? undefined : acc[key], obj);
  }

  function setByPath(obj, path, value){
    const keys = String(path || '').split('.').filter(Boolean);
    if (!keys.length) return obj;
    const root = cloneValue(obj);
    let cursor = root;
    let sourceCursor = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const nextSource = sourceCursor ? sourceCursor[key] : undefined;
      const nextCloned = cloneValue(nextSource);
      cursor[key] = nextCloned;
      cursor = nextCloned;
      sourceCursor = nextSource;
    }
    cursor[keys[keys.length - 1]] = value;
    return root;
  }

  const initialState = {
    inventarios: [],
    contagens: [],
    divergencias: [],
    recontagens: [],
    logs: [],
    auditorias: [],
    auditoria_imports: [],
    auditoria_metas: [],
    coletores: [],
    enderecosLista: [],
    enderecosPorSetor: {},
    enderecosExpandidos: [],
    enderecosTemp: [],
    ui: {
      selecionadosSetores: new Set(),
      inventarioImportCtx: null,
      inventarioFecharId: null,
      recontagemCtx: null,
      acompanhamentoInventarioId: null,
      filtroInventarioTexto: '',
      filtroInventarioStatus: '',
      currentUser: null,
      currentPage: 'dashboard',
      initialized: false
    },
    sync: {
      ok: false,
      message: '',
      started: false,
      lastSyncAt: null,
      source: 'cache'
    }
  };

  function upsertById(list, entity){
    const next = list.slice();
    const idx = next.findIndex(item => item && entity && item.id === entity.id);
    if (idx >= 0) next[idx] = entity;
    else next.push(entity);
    return next;
  }

  function removeById(list, entity){
    return list.filter(item => item && entity && item.id !== entity.id);
  }

  function rootReducer(state = initialState, action){
    if (!action || !action.type) return state;
    switch(action.type){
      case 'BATCH': {
        return (action.actions || []).reduce((acc, inner) => rootReducer(acc, inner), state);
      }
      case 'HYDRATE_CACHE': {
        const payload = action.payload || {};
        return Object.assign({}, state, {
          inventarios: payload.inventarios || [],
          contagens: payload.contagens || [],
          divergencias: payload.divergencias || [],
          recontagens: payload.recontagens || [],
          logs: payload.logs || [],
          auditorias: payload.auditorias || [],
          auditoria_imports: payload.auditoria_imports || [],
          auditoria_metas: payload.auditoria_metas || [],
          coletores: payload.coletores || [],
          enderecosLista: payload.enderecosLista || [],
          enderecosPorSetor: payload.enderecosPorSetor || {},
          enderecosExpandidos: Array.isArray(payload.enderecosExpandidos) ? payload.enderecosExpandidos.slice() : [],
          enderecosTemp: payload.enderecosTemp || [],
          ui: Object.assign({}, state.ui, payload.ui || {}, { initialized: true }),
          sync: Object.assign({}, state.sync, payload.sync || {})
        });
      }
      case 'SET_CURRENT_USER':
        return Object.assign({}, state, { ui: Object.assign({}, state.ui, { currentUser: action.payload || null }) });
      case 'SET_SYNC_STATUS':
        return Object.assign({}, state, { sync: Object.assign({}, state.sync, action.payload || {}) });
      case 'SET_PATH':
        return setByPath(state, action.path, action.payload);
      case 'REPLACE_SLICE': {
        if (!action.slice || !(action.slice in state)) return state;
        return Object.assign({}, state, { [action.slice]: cloneValue(action.payload) });
      }
      case 'UPSERT_ENTITY': {
        const slice = action.slice;
        if (!slice || !Array.isArray(state[slice])) return state;
        return Object.assign({}, state, { [slice]: upsertById(state[slice], action.payload) });
      }
      case 'REMOVE_ENTITY': {
        const slice = action.slice;
        if (!slice || !Array.isArray(state[slice])) return state;
        return Object.assign({}, state, { [slice]: removeById(state[slice], action.payload) });
      }
      default:
        return state;
    }
  }

  global.AnalistaReducers = {
    initialState,
    rootReducer,
    getByPath,
    setByPath,
    cloneValue
  };
})(window);
