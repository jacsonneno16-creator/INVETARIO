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
    try {
      const CHUNK_SIZE = 1000;
      const chunksColl = FS_AN.collection('dt_locais_chunks');
      const versao = String(Date.now());
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

      // Publicação atômica por versão: escreve toda a versão nova antes de torná-la ativa.
      const idsAtuais = new Set();
      for (let i = 0; i < listaNormalizada.length; i += CHUNK_SIZE) {
        const parte = Math.floor(i / CHUNK_SIZE);
        const id = `v${versao}_${String(parte).padStart(4, '0')}`;
        idsAtuais.add(id);
        await chunksColl.doc(id).set({
          versao,
          parte,
          chunk_size: CHUNK_SIZE,
          total_registros: listaNormalizada.length,
          dados: listaNormalizada.slice(i, i + CHUNK_SIZE),
          atualizado_em: new Date()
        });
      }

      // A Base Geral é publicada somente em chunks de até 1.000 registros.
      // Não gravar documento por endereço: isso aumenta leituras e deixa bases antigas residuais.

      // Só agora o coletor passa a enxergar a nova versão completa.
      await FS_AN.collection('dt_locais_meta').doc('versao').set({
        versao,
        atualizado_em: new Date(),
        chunk_size: CHUNK_SIZE,
        chunks: Math.ceil(listaNormalizada.length / CHUNK_SIZE),
        total: listaNormalizada.length,
        origem: 'dt_locais_chunks'
      });

      // Limpeza posterior: nunca existe uma janela sem uma versão completa publicada.
      const todos = await chunksColl.get().catch(() => null);
      if (todos && !todos.empty) {
        const antigos = todos.docs.filter(doc => !idsAtuais.has(doc.id));
        for (let i = 0; i < antigos.length; i += 400) {
          const delBatch = FS_AN.batch();
          antigos.slice(i, i + 400).forEach(doc => delBatch.delete(doc.ref));
          await delBatch.commit();
        }
      }

      // Limpa a coleção antiga documento a documento. Ela não é mais usada para download.
      // Isso ocorre somente ao publicar/substituir a base, nunca no carregamento do coletor.
      const legacy = await FS_AN.collection('dt_locais').get().catch(() => null);
      if (legacy && !legacy.empty) {
        for (let i = 0; i < legacy.docs.length; i += 400) {
          const delBatch = FS_AN.batch();
          legacy.docs.slice(i, i + 400).forEach(doc => delBatch.delete(doc.ref));
          await delBatch.commit();
        }
      }
      dbg('[fsPublicarEnderecos] ✅', listaNormalizada.length, 'endereços publicados em chunks na versão', versao);
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
