(function(global){
  const InventarioService = {
    getInventariosAtivosIds(inventarios){
      const ativos = new Set(['ATIVO','ABERTO','PUBLICADO','LIBERADO','EM_ANDAMENTO','PAUSADO']);
      return (inventarios || []).filter(i => i && ativos.has(String(i.status || '').toUpperCase())).map(i => i.id).filter(Boolean);
    },
    chunkIds(ids, size = 10){
      const out = [];
      for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
      return out;
    },
    normalizarContagem(doc){
      if (!doc) return doc;
      const n = typeof global._normalizarContagem === 'function' ? global._normalizarContagem(doc) : Object.assign({}, doc);
      if (!n.inventario_id) n.inventario_id = n.inventarioId || n.inventario || n.inv_id || '';
      if (!n.operador) n.operador = n.operador_nome || n.usuario || n.email_operador || '';
      if (!n.endereco) n.endereco = n.local || n.posicao || '';
      if (!n.timestamp) n.timestamp = n.criado_em || n.data_hora || n.enviado_em || '';
      return n;
    },
    pertenceAoInventario(item, invId){
      if (!item || !invId) return false;
      return String(item.inventario_id || item.inventarioId || item.inventario || item.inv_id || '') === String(invId);
    }
  };
  global.AnalistaInventarioService = InventarioService;
})(window);
