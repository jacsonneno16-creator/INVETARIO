(function(global){
  const { rootReducer, initialState, getByPath } = global.AnalistaReducers;
  const Actions = global.AnalistaActions;

  function createStore(reducer, preloadedState){
    let state = preloadedState;
    const listeners = new Set();
    return {
      getState(){ return state; },
      subscribe(listener){ listeners.add(listener); return () => listeners.delete(listener); },
      dispatch(action){
        const prev = state;
        state = reducer(state, action);
        listeners.forEach(fn => {
          try { fn(state, action, prev); } catch (err) { console.error('[AnalistaStore] subscriber', err); }
        });
        return action;
      }
    };
  }

  const store = createStore(rootReducer, initialState);

  const StateApi = {
    getState: () => store.getState(),
    select(path, fallback){
      const value = getByPath(store.getState(), path);
      return value === undefined ? fallback : value;
    },
    dispatch(action){ return store.dispatch(action); },
    replaceSlice(slice, payload, meta){ return store.dispatch(Actions.replaceSlice(slice, payload, meta)); },
    set(path, payload, meta){ return store.dispatch(Actions.setPath(path, payload, meta)); },
    update(path, updater, meta){
      const current = getByPath(store.getState(), path);
      const next = updater(current);
      return store.dispatch(Actions.setPath(path, next, meta));
    },
    upsert(slice, payload, meta){ return store.dispatch(Actions.upsertEntity(slice, payload, meta)); },
    remove(slice, payload, meta){ return store.dispatch(Actions.removeEntity(slice, payload, meta)); },
    batch(actions, meta){ return store.dispatch(Actions.batch(actions, meta)); }
  };

  global.AnalistaStore = store;
  global.AnalistaState = StateApi;
})(window);
