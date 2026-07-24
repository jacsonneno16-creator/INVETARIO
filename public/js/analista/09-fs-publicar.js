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
    if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
    const lista = state().enderecosLista || [];
    const CHUNK_SIZE = 1000;
    const chunksColl = FS_AN.collection('dt_locais_chunks');
    const metaRef = FS_AN.collection('dt_locais_meta').doc('versao');
    const versao = String(Date.now());
    const listaNormalizada = lista
      .filter(end => end && end.endereco)
      .map(end => ({
        endereco:           String(end.endereco || '').trim(),
        ativo:              end.ativo !== false,
        capacidade_paletes: end.capacidade_paletes ?? null,
        nome_local:         end.nome_local || end.local || '',
        setor:              end.setor || end.local || '',
        tipo:               end.tipo || '',
        rua:                end.rua || '',
        loja:               end.loja || window.getDTLojaAtiva?.() || ''
      }));

    const totalChunks = Math.ceil(listaNormalizada.length / CHUNK_SIZE);
    const idsAtuais = new Set();

    try {
      // 1) Grava toda a nova versão em chunks de no máximo 1.000.
      for (let parte = 0; parte < totalChunks; parte++) {
        const id = `v${versao}_${String(parte).padStart(4, '0')}`;
        idsAtuais.add(id);
        const dados = listaNormalizada.slice(parte * CHUNK_SIZE, (parte + 1) * CHUNK_SIZE);
        await chunksColl.doc(id).set({
          versao,
          parte,
          chunk_size: CHUNK_SIZE,
          total_registros: listaNormalizada.length,
          quantidade: dados.length,
          dados,
          atualizado_em: new Date()
        });
      }

      // 2) Confere a versão recém-gravada ANTES de ativá-la no metadado.
      let totalVerificado = 0;
      let chunksVerificados = 0;
      if (totalChunks > 0) {
        const verif = await chunksColl.where('versao', '==', versao).get();
        chunksVerificados = verif.size;
        verif.docs.forEach(doc => {
          const data = doc.data() || {};
          const itens = Array.isArray(data.dados) ? data.dados : [];
          if (itens.length > CHUNK_SIZE) throw new Error(`Chunk ${doc.id} excedeu 1.000 registros.`);
          totalVerificado += itens.length;
        });
      }
      if (chunksVerificados !== totalChunks || totalVerificado !== listaNormalizada.length) {
        throw new Error(`Publicação incompleta: esperado ${listaNormalizada.length} em ${totalChunks} chunks; confirmado ${totalVerificado} em ${chunksVerificados}.`);
      }

      // 3) Só depois da conferência troca a versão ativa usada por cards, Auditoria e coletores.
      await metaRef.set({
        versao,
        atualizado_em: new Date(),
        chunk_size: CHUNK_SIZE,
        chunks: totalChunks,
        total: listaNormalizada.length,
        ativos: listaNormalizada.filter(x => x.ativo !== false).length,
        inativos: listaNormalizada.filter(x => x.ativo === false).length,
        loja: window.getDTLojaAtiva?.() || '',
        origem: 'dt_locais_chunks'
      });

      // 4) Lê o metadado de volta. Sem isso, a tela não pode anunciar sucesso.
      const metaConfirmado = await metaRef.get();
      const meta = metaConfirmado.exists ? (metaConfirmado.data() || {}) : {};
      if (String(meta.versao || '') !== versao || Number(meta.total || -1) !== listaNormalizada.length) {
        throw new Error('O Firebase não confirmou a nova versão da Base Geral de Endereços.');
      }

      // 5) Limpa versões antigas somente após a nova estar ativa e confirmada.
      const todos = await chunksColl.get();
      const antigos = todos.docs.filter(doc => !idsAtuais.has(doc.id));
      for (let i = 0; i < antigos.length; i += 400) {
        const delBatch = FS_AN.batch();
        antigos.slice(i, i + 400).forEach(doc => delBatch.delete(doc.ref));
        await delBatch.commit();
      }

      dbg('[fsPublicarEnderecos] ✅', listaNormalizada.length, 'endereços confirmados em', totalChunks, 'chunks; versão', versao);
      window.dispatchEvent(new CustomEvent('dt-base-enderecos-publicada', { detail: { versao, total: listaNormalizada.length, chunks: totalChunks } }));
      return { versao, total: listaNormalizada.length, chunks: totalChunks };
    } catch(e) {
      console.error('[fsPublicarEnderecos] erro:', e);
      // Fundamental: propaga o erro. Antes ele era engolido e a importação mostrava sucesso falso.
      throw e;
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
