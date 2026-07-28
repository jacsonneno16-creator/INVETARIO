(function (global) {
    var InventarioService = {
        getInventariosAtivosIds: function (inventarios) {
            var ativos = new Set(['ATIVO', 'ABERTO', 'PUBLICADO', 'LIBERADO', 'EM_ANDAMENTO', 'PAUSADO']);
            var aliases = [];
            (inventarios || []).filter(function (i) { return i && ativos.has(String(i.status || '').toUpperCase()); }).forEach(function (i) {
                [i.id, i.codigo, i.nome, i.inventario_id, i.inventarioId]
                    .filter(function (v) { return v != null && String(v).trim(); })
                    .forEach(function (v) { aliases.push(String(v).trim()); });
            });
            return Array.from(new Set(aliases));
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
