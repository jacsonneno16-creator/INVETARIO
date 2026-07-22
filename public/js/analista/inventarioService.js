(function(global){
  const InventarioService = {
    getInventariosAtivosIds(inventarios){
      return (inventarios || []).filter(i => { if(!i) return false; const st=String(i.status||'').toUpperCase(); return i.ativo===true || ['ATIVO','ABERTO','EM_ANDAMENTO','LIBERADO'].includes(st); }).map(i => i.id).filter(Boolean);
    },

    chunkIds(ids, size = 10){
      const out = [];
      for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
      return out;
    },

    /**
     * Verifica se um registro de contagem representa um endereço vazio.
     * Aceita formato do coletor novo (tipo_contagem === 'VAZIO')
     * e formato legado do analista (tipo === 'VAZIO_CONFIRMADO').
     */
    isVazio(c){
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
    normalizarContagem(doc){
      if (!doc) return doc;
      const norm = Object.assign({}, doc);

      // Mapear dataHora → timestamp quando timestamp ausente
      if (!norm.timestamp && norm.dataHora) {
        const dh = norm.dataHora;
        if (dh && typeof dh.toDate === 'function') {
          norm.timestamp = dh.toDate().toISOString();
        } else if (dh instanceof Date) {
          norm.timestamp = dh.toISOString();
        } else if (typeof dh === 'string') {
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
