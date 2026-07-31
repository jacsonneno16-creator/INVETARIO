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
        /**
         * Verifica se um registro de contagem representa um endereço vazio.
         * Aceita formato do coletor novo (tipo_contagem === 'VAZIO')
         * e formato legado do analista (tipo === 'VAZIO_CONFIRMADO').
         */
        isVazio: function (c) {
            return c.tipo_contagem === 'VAZIO' || c.tipo === 'VAZIO_CONFIRMADO';
        },
        /**
         * Normaliza um registro de contagem vindo do Firebase para o formato
         * interno do analista. Inlinado diretamente — sem dependência de _normalizarContagem global.
         *
         * Garante que:
         *   - dataHora (ISO string ou Date ou Timestamp do Firestore) seja mapeado para timestamp
         *   - Vazios do coletor (tipo_contagem:'VAZIO') sejam marcados como VAZIO_CONFIRMADO
         */
        normalizarContagem: function (doc) {
            if (!doc)
                return doc;
            var norm = Object.assign({}, doc);
            // Mapear dataHora → timestamp quando timestamp ausente
            if (!norm.timestamp && norm.dataHora) {
                var dh = norm.dataHora;
                if (dh && typeof dh.toDate === 'function') {
                    norm.timestamp = dh.toDate().toISOString();
                }
                else if (dh instanceof Date) {
                    norm.timestamp = dh.toISOString();
                }
                else if (typeof dh === 'string') {
                    norm.timestamp = dh;
                }
            }
            // Fallback: usar criado_em se ambos ausentes
            if (!norm.timestamp && norm.criado_em) {
                norm.timestamp = norm.criado_em;
            }
            // Mapear tipo coletor → tipo analista
            if (norm.tipo_contagem === 'VAZIO') {
                norm.tipo = 'VAZIO_CONFIRMADO';
            }
            return norm;
        }
    };
    global.AnalistaInventarioService = InventarioService;
})(window);
