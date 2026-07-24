(function (global) {
    function cloneValue(value) {
        if (Array.isArray(value))
            return value.slice();
        if (value instanceof Set)
            return new Set(Array.from(value));
        if (value && typeof value === 'object')
            return Object.assign({}, value);
        return value;
    }
    function getByPath(obj, path) {
        return String(path || '').split('.').filter(Boolean).reduce(function (acc, key) { return acc == null ? undefined : acc[key]; }, obj);
    }
    function setByPath(obj, path, value) {
        var keys = String(path || '').split('.').filter(Boolean);
        if (!keys.length)
            return obj;
        var root = cloneValue(obj);
        var cursor = root;
        var sourceCursor = obj;
        for (var i = 0; i < keys.length - 1; i++) {
            var key = keys[i];
            var nextSource = sourceCursor ? sourceCursor[key] : undefined;
            var nextCloned = cloneValue(nextSource);
            cursor[key] = nextCloned;
            cursor = nextCloned;
            sourceCursor = nextSource;
        }
        cursor[keys[keys.length - 1]] = value;
        return root;
    }
    var initialState = {
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
    function upsertById(list, entity) {
        var next = list.slice();
        var idx = next.findIndex(function (item) { return item && entity && item.id === entity.id; });
        if (idx >= 0)
            next[idx] = entity;
        else
            next.push(entity);
        return next;
    }
    function removeById(list, entity) {
        return list.filter(function (item) { return item && entity && item.id !== entity.id; });
    }
    function rootReducer(state, action) {
        var _a, _b, _c;
        if (state === void 0) { state = initialState; }
        if (!action || !action.type)
            return state;
        switch (action.type) {
            case 'BATCH': {
                return (action.actions || []).reduce(function (acc, inner) { return rootReducer(acc, inner); }, state);
            }
            case 'HYDRATE_CACHE': {
                var payload = action.payload || {};
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
                if (!action.slice || !(action.slice in state))
                    return state;
                return Object.assign({}, state, (_a = {}, _a[action.slice] = cloneValue(action.payload), _a));
            }
            case 'UPSERT_ENTITY': {
                var slice = action.slice;
                if (!slice || !Array.isArray(state[slice]))
                    return state;
                return Object.assign({}, state, (_b = {}, _b[slice] = upsertById(state[slice], action.payload), _b));
            }
            case 'REMOVE_ENTITY': {
                var slice = action.slice;
                if (!slice || !Array.isArray(state[slice]))
                    return state;
                return Object.assign({}, state, (_c = {}, _c[slice] = removeById(state[slice], action.payload), _c));
            }
            default:
                return state;
        }
    }
    global.AnalistaReducers = {
        initialState: initialState,
        rootReducer: rootReducer,
        getByPath: getByPath,
        setByPath: setByPath,
        cloneValue: cloneValue
    };
})(window);
