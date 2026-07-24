(function(global){
  const t = {
    HYDRATE_CACHE: 'HYDRATE_CACHE',
    SET_PATH: 'SET_PATH',
    SET_SYNC_STATUS: 'SET_SYNC_STATUS',
    SET_CURRENT_USER: 'SET_CURRENT_USER',
    UPSERT_ENTITY: 'UPSERT_ENTITY',
    REMOVE_ENTITY: 'REMOVE_ENTITY',
    REPLACE_SLICE: 'REPLACE_SLICE',
    BATCH: 'BATCH'
  };

  const Actions = {
    types: t,
    hydrateCache: (payload) => ({ type: t.HYDRATE_CACHE, payload }),
    setPath: (path, payload, meta) => ({ type: t.SET_PATH, path, payload, meta }),
    setSyncStatus: (payload) => ({ type: t.SET_SYNC_STATUS, payload }),
    setCurrentUser: (payload) => ({ type: t.SET_CURRENT_USER, payload }),
    upsertEntity: (slice, payload, meta) => ({ type: t.UPSERT_ENTITY, slice, payload, meta }),
    removeEntity: (slice, payload, meta) => ({ type: t.REMOVE_ENTITY, slice, payload, meta }),
    replaceSlice: (slice, payload, meta) => ({ type: t.REPLACE_SLICE, slice, payload, meta }),
    batch: (actions, meta) => ({ type: t.BATCH, actions, meta })
  };

  global.AnalistaActions = Actions;
})(window);
