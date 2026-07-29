(function(global){
  const InventarioService = {
    getInventariosAtivosIds(inventarios){
      const ativos = new Set(['ATIVO','ABERTO','PUBLICADO','LIBERADO','EM_ANDAMENTO','PAUSADO']);
      // Bases antigas gravaram o mesmo inventário ora pelo ID técnico, ora pelo
      // código/nome. A leitura operacional precisa consultar todos os aliases;
      // caso contrário a tela recebe a contagem, mas não recebe a divergência e
      // acaba exibindo OK 1ª indevidamente.
      const ids = [];
      (inventarios || []).filter(i => i && ativos.has(String(i.status || '').toUpperCase())).forEach(i => {
        [i.id, i.codigo, i.nome, i.inventario_id, i.inventarioId]
          .filter(Boolean).forEach(v => ids.push(String(v)));
      });
      return [...new Set(ids)];
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
