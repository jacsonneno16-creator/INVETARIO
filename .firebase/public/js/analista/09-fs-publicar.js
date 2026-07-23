(function(global){
  function state(){ return global.AnalistaStore.getState(); }

  // ── PUBLICAÇÃO NO FIRESTORE (analista → coletor) ────────────────────
  // Estas funções publicam dados do analista no Firestore para que os
  // coletores possam baixá-los. Chamadas após criação/atualização de dados.

  /**
   * Publica um inventário no Firestore (dt_inventarios).
   * O coletor baixa esta coleção para listar inventários disponíveis.
   */
  async function fsPublicarInventario(inv) {
    if (!navigator.onLine || !inv || !inv.id) return;
    try {
      const { base, ...invSemBase } = inv;
      const _baseLen = Array.isArray(base) ? base.length : 0;
      const _baseChunkSize = 1000;
      await FS_AN.collection('dt_inventarios').doc(inv.id).set({
        ...invSemBase,
        base_chunks: _baseLen ? Math.ceil(_baseLen / _baseChunkSize) : (invSemBase.base_chunks || 0),
        base_chunk_size: _baseChunkSize,
        base_publicada_em: new Date()
      }, { merge: true });

      if (Array.isArray(base) && base.length > 0) {
        const CHUNK = 1000;
        const chunksColl = FS_AN.collection('dt_inventarios').doc(inv.id).collection('base_chunks');
        const oldChunks = await chunksColl.get().catch(() => null);
        if (oldChunks && !oldChunks.empty) {
          for (let i = 0; i < oldChunks.docs.length; i += 400) {
            const delBatch = FS_AN.batch();
            oldChunks.docs.slice(i, i + 400).forEach(doc => delBatch.delete(doc.ref));
            await delBatch.commit();
          }
        }
        for (let i = 0; i < Math.ceil(base.length / CHUNK); i++) {
          const batch = FS_AN.batch();
          const chunkRef = chunksColl.doc(String(i).padStart(4, '0'));
          batch.set(chunkRef, { itens: base.slice(i * CHUNK, (i + 1) * CHUNK), parte: i, chunk: i, chunk_size: CHUNK });
          await batch.commit();
        }
        dbg('[fsPublicarInventario] base publicada:', base.length, 'registros em', Math.ceil(base.length / CHUNK), 'chunks');
      }
      dbg('[fsPublicarInventario] ✅', inv.id, inv.nome);
    } catch(e) {
      console.error('[fsPublicarInventario] erro:', e.message);
      throw e;
    }
  }

  /**
   * Publica endereços do ENDDB no Firestore (dt_locais).
   * Usa batch para eficiência (max 500 ops por batch).
   */
  async function fsPublicarEnderecos() {
    if (!navigator.onLine) return;
    const lista = state().enderecosLista || [];
    if (!lista.length) return;
    try {
      // v15: catálogo de endereços publicado em chunks de 1000 para reduzir
      // drasticamente leituras no coletor/inventário/auditoria/recontagem.
      // O coletor passa a ler dt_locais_chunks (1 leitura por até 1000 endereços),
      // em vez de ler 1 documento por endereço em dt_locais.
      const CHUNK_SIZE = 1000;
      const chunksColl = FS_AN.collection('dt_locais_chunks');
      const listaNormalizada = lista
        .filter(end => end && end.endereco)
        .map(end => ({
          endereco:           end.endereco,
          ativo:              end.ativo !== false,
          capacidade_paletes: end.capacidade_paletes ?? null,
          nome_local:         end.nome_local || end.local || '',
          setor:              end.setor || end.local || '',
          tipo:               end.tipo || '',
          rua:                end.rua || '',
        }));

      const oldLocalChunks = await chunksColl.get().catch(() => null);
      if (oldLocalChunks && !oldLocalChunks.empty) {
        for (let i = 0; i < oldLocalChunks.docs.length; i += 400) {
          const delBatch = FS_AN.batch();
          oldLocalChunks.docs.slice(i, i + 400).forEach(doc => delBatch.delete(doc.ref));
          await delBatch.commit();
        }
      }

      for (let i = 0; i < listaNormalizada.length; i += CHUNK_SIZE) {
        const parte = Math.floor(i / CHUNK_SIZE);
        await chunksColl.doc(String(parte).padStart(4, '0')).set({
          parte,
          chunk_size: CHUNK_SIZE,
          total_registros: listaNormalizada.length,
          dados: listaNormalizada.slice(i, i + CHUNK_SIZE),
          atualizado_em: new Date()
        }, { merge: true });
      }

      // Mantém dt_locais individual somente como compatibilidade/fallback de consulta pontual.
      // A leitura principal não usa mais esta coleção completa.
      const BATCH_SIZE = 400;
      for (let i = 0; i < listaNormalizada.length; i += BATCH_SIZE) {
        const lote = listaNormalizada.slice(i, i + BATCH_SIZE);
        const batch = FS_AN.batch();
        lote.forEach(end => {
          const ref = FS_AN.collection('dt_locais').doc(
            String(end.endereco).trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '_')
          );
          batch.set(ref, end, { merge: true });
        });
        await batch.commit();
      }

      const versao = String(Date.now());
      await FS_AN.collection('dt_locais_meta').doc('versao').set({
        versao,
        atualizado_em: new Date(),
        chunk_size: CHUNK_SIZE,
        chunks: Math.ceil(listaNormalizada.length / CHUNK_SIZE),
        total: listaNormalizada.length,
        origem: 'dt_locais_chunks'
      });
      dbg('[fsPublicarEnderecos] ✅', listaNormalizada.length, 'endereços publicados em chunks de', CHUNK_SIZE, 'ver:', versao);
    } catch(e) {
      console.error('[fsPublicarEnderecos] erro:', e.message);
    }
  }

  /**
   * Publica lista de produtos no Firestore (dt_produtos).
   * O coletor usa esta coleção para identificar GTINs/códigos.
   */
  async function fsPublicarProdutos(produtos) {
    if (!navigator.onLine || !Array.isArray(produtos) || !produtos.length) return;
    try {
      const BATCH_SIZE = 400;
      for (let i = 0; i < produtos.length; i += BATCH_SIZE) {
        const lote = produtos.slice(i, i + BATCH_SIZE);
        const batch = FS_AN.batch();
        lote.forEach(prod => {
          const cod = String(prod.codigo_produto || prod.gtin || '').trim();
          if (!cod) return;
          const ref = FS_AN.collection('dt_produtos').doc(cod);
          batch.set(ref, {
            codigo_produto:    prod.codigo_produto || cod,
            descricao_produto: prod.descricao_produto || prod.descricao || '',
            gtin:              prod.gtin || '',
            fator_caixa:       prod.fator_caixa || 1,
            unidade:           prod.unidade || '',
          }, { merge: true });
        });
        await batch.commit();
      }
      dbg('[fsPublicarProdutos] ✅', produtos.length, 'produtos publicados');
    } catch(e) {
      console.error('[fsPublicarProdutos] erro:', e.message);
    }
  }

  // Exportar para acesso global (chamados de 10-inventarios-negocio e outros módulos)
  global.fsPublicarInventario = fsPublicarInventario;
  global.fsPublicarEnderecos  = fsPublicarEnderecos;
  global.fsPublicarProdutos   = fsPublicarProdutos;
})(window);
