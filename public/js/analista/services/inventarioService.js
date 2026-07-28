(function(global){
  const InventarioService = {
    getInventariosAtivosIds(inventarios){
      const ativos = new Set(['ATIVO','ABERTO','PUBLICADO','LIBERADO','EM_ANDAMENTO','PAUSADO']);
      // Os registros operacionais antigos podem guardar o inventário pelo ID
      // técnico, código curto ou nome. Consultar apenas i.id fazia a tela não
      // carregar divergências/recontagens gravadas com outro alias e, por isso,
      // a Contagem podia aparecer como OK mesmo havendo recontagem aberta.
      const aliases = [];
      (inventarios || []).filter(i => i && ativos.has(String(i.status || '').toUpperCase())).forEach(i => {
        [i.id, i.codigo, i.nome, i.inventario_id, i.inventarioId]
          .filter(v => v != null && String(v).trim())
          .forEach(v => aliases.push(String(v).trim()));
      });
      return [...new Set(aliases)];
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
