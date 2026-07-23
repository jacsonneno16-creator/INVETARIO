(function (global) {
    var _a = global.AnalistaReducers, rootReducer = _a.rootReducer, initialState = _a.initialState, getByPath = _a.getByPath;
    var Actions = global.AnalistaActions;
    function createStore(reducer, preloadedState) {
        var state = preloadedState;
        var listeners = new Set();
        return {
            getState: function () { return state; },
            subscribe: function (listener) { listeners.add(listener); return function () { return listeners.delete(listener); }; },
            dispatch: function (action) {
                var prev = state;
                state = reducer(state, action);
                listeners.forEach(function (fn) {
                    try {
                        fn(state, action, prev);
                    }
                    catch (err) {
                        console.error('[AnalistaStore] subscriber', err);
                    }
                });
                return action;
            }
        };
    }
    var store = createStore(rootReducer, initialState);
    var StateApi = {
        getState: function () { return store.getState(); },
        select: function (path, fallback) {
            var value = getByPath(store.getState(), path);
            return value === undefined ? fallback : value;
        },
        dispatch: function (action) { return store.dispatch(action); },
        replaceSlice: function (slice, payload, meta) { return store.dispatch(Actions.replaceSlice(slice, payload, meta)); },
        set: function (path, payload, meta) { return store.dispatch(Actions.setPath(path, payload, meta)); },
        update: function (path, updater, meta) {
            var current = getByPath(store.getState(), path);
            var next = updater(current);
            return store.dispatch(Actions.setPath(path, next, meta));
        },
        upsert: function (slice, payload, meta) { return store.dispatch(Actions.upsertEntity(slice, payload, meta)); },
        remove: function (slice, payload, meta) { return store.dispatch(Actions.removeEntity(slice, payload, meta)); },
        batch: function (actions, meta) { return store.dispatch(Actions.batch(actions, meta)); }
    };
    global.AnalistaStore = store;
    global.AnalistaState = StateApi;
})(window);
