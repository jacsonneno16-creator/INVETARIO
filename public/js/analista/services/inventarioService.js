(function(global){
  const InventarioService = {
    getInventariosAtivosIds(inventarios){
      return (inventarios || []).filter(i => i && i.status === 'ATIVO').map(i => i.id).filter(Boolean);
    },
    chunkIds(ids, size = 10){
      const out = [];
      for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
      return out;
    },
    normalizarContagem(doc){
      if (!doc) return doc;
      return typeof global._normalizarContagem === 'function' ? global._normalizarContagem(doc) : doc;
    }
  };
  global.AnalistaInventarioService = InventarioService;
})(window);
