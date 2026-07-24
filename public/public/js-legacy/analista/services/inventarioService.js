(function (global) {
    var InventarioService = {
        getInventariosAtivosIds: function (inventarios) {
            return (inventarios || []).filter(function (i) { return i && i.status === 'ATIVO'; }).map(function (i) { return i.id; }).filter(Boolean);
        },
        chunkIds: function (ids, size) {
            if (size === void 0) { size = 10; }
            var out = [];
            for (var i = 0; i < ids.length; i += size)
                out.push(ids.slice(i, i + size));
            return out;
        },
        normalizarContagem: function (doc) {
            if (!doc)
                return doc;
            return typeof global._normalizarContagem === 'function' ? global._normalizarContagem(doc) : doc;
        }
    };
    global.AnalistaInventarioService = InventarioService;
})(window);
