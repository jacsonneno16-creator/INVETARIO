// Devoluções unificadas (2026-10-13): confirmação atômica de recebimento,
// compartilhada entre Coletor e Analista — os dois bundles carregam este
// arquivo e chamam a MESMA função, rodando a MESMA transação client-side
// (nunca um callable: nem Coletor nem este fluxo específico do Analista
// precisam de BigQuery, e o Coletor em campo já evita qualquer ida a uma
// Cloud Function pra não somar mais uma superfície de falha de rede em
// cima da própria escrita no Firestore — ver confirmarRecebimentoDevolucao
// em functions/index.js, mantido como equivalente server-side pra uso
// administrativo/scripts, não chamado por nenhuma tela hoje).
//
// Garantia real de "nunca dois primeiros recebimentos pra mesma chave":
// devolucoes_recebimentos/{chave} só é criado via tx.create() DENTRO de
// uma transação que leu o doc antes — se duas confirmações (Coletor e
// Analista, ou dois cliques) disputarem a MESMA chave, o Firestore
// serializa e só uma das transações comita; a outra se repete sozinha
// (o SDK já faz isso), lê o doc agora existente e cai no ramo jaRecebida,
// sem nunca lançar erro nem criar um segundo doc. As regras do Firestore
// (firestore.rules, devolucoes_notas/devolucoes_recebimentos) são só
// AUTORIZAÇÃO — quem pode tentar — a atomicidade real é da transação.
(function (global) {
  'use strict';

  // confirmadoPor: e-mail/identificação de quem está confirmando (Analista
  // logado, ou e-mail/uid do operador do Coletor). origem: 'ANALISTA'|'COLETOR'.
  // relatorioId: só faz sentido vindo do Analista (bipagem de um relatório
  // em andamento); o Coletor sempre passa null.
  async function confirmarRecebimentoDevolucaoClient(db, lojaId, chave, opts) {
    opts = opts || {};
    const origem = opts.origem === 'COLETOR' ? 'COLETOR' : 'ANALISTA';
    const confirmadoPor = String(opts.confirmadoPor || '').trim();
    const relatorioId = opts.relatorioId || null;
    if (!lojaId) throw new Error('Loja não informada.');
    if (!/^\d{44}$/.test(String(chave || ''))) throw new Error('Chave de acesso inválida — precisa ter 44 dígitos.');

    const notaRef = db.collection('lojas').doc(lojaId).collection('devolucoes_notas').doc(chave);
    const recRef = db.collection('lojas').doc(lojaId).collection('devolucoes_recebimentos').doc(chave);
    const agora = new Date().toISOString();

    return db.runTransaction(async tx => {
      const [notaSnap, recSnap] = await Promise.all([tx.get(notaRef), tx.get(recRef)]);
      if (!notaSnap.exists) throw new Error('Nota de devolução não encontrada no catálogo fiscal — atualize do BI e tente de novo.');
      const notaDados = notaSnap.data() || {};
      if (String(notaDados.lojaId || lojaId) !== String(lojaId)) throw new Error('Esta nota pertence a outra loja.');
      if (recSnap.exists) return { jaRecebida: true, recebimento: recSnap.data() };
      const recebimento = { chave, lojaId, confirmadoEm: agora, confirmadoPor, origem, relatorioId };
      tx.set(recRef, recebimento);
      tx.set(notaRef, { estado: 'RECEBIDA', atualizadoEm: agora, recebidoEm: agora, recebidoPor: confirmadoPor, origemRecebimento: origem }, { merge: true });
      return { jaRecebida: false, recebimento };
    });
  }

  global.confirmarRecebimentoDevolucaoClient = confirmarRecebimentoDevolucaoClient;
})(window);
