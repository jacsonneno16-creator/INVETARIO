(function (global) {
    var t = {
        HYDRATE_CACHE: 'HYDRATE_CACHE',
        SET_PATH: 'SET_PATH',
        SET_SYNC_STATUS: 'SET_SYNC_STATUS',
        SET_CURRENT_USER: 'SET_CURRENT_USER',
        UPSERT_ENTITY: 'UPSERT_ENTITY',
        REMOVE_ENTITY: 'REMOVE_ENTITY',
        REPLACE_SLICE: 'REPLACE_SLICE',
        BATCH: 'BATCH'
    };
    var Actions = {
        types: t,
        hydrateCache: function (payload) { return ({ type: t.HYDRATE_CACHE, payload: payload }); },
        setPath: function (path, payload, meta) { return ({ type: t.SET_PATH, path: path, payload: payload, meta: meta }); },
        setSyncStatus: function (payload) { return ({ type: t.SET_SYNC_STATUS, payload: payload }); },
        setCurrentUser: function (payload) { return ({ type: t.SET_CURRENT_USER, payload: payload }); },
        upsertEntity: function (slice, payload, meta) { return ({ type: t.UPSERT_ENTITY, slice: slice, payload: payload, meta: meta }); },
        removeEntity: function (slice, payload, meta) { return ({ type: t.REMOVE_ENTITY, slice: slice, payload: payload, meta: meta }); },
        replaceSlice: function (slice, payload, meta) { return ({ type: t.REPLACE_SLICE, slice: slice, payload: payload, meta: meta }); },
        batch: function (actions, meta) { return ({ type: t.BATCH, actions: actions, meta: meta }); }
    };
    global.AnalistaActions = Actions;
})(window);
