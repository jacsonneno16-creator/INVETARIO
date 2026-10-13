// ═══════════════════════════════════════════════════
//  RECEBIMENTO — Ledger de Paletes (Disponível / Em Trânsito / Total)
//  Fonte de verdade do saldo de paletes por loja, alimentada por TODA
//  movimentação (Saída/Retorno externo em 25-recebimento-paletes.js,
//  Expedição/Recebimento de carga em 26-recebimento-cargas.js,
//  Transferência entre lojas em 27-transferencia-paletes.js). A contagem
//  manual diária (recebimento_paletes_estoque) continua existindo só como
//  CONFERÊNCIA — nunca ajusta este ledger sozinha.
//
//  Utilitário PURO, sem UI, sem tela própria — só `_aplicarMovimentoLedger`
//  e um getter. Usa `getDTRawFirestore()` (não o proxy `FS`, que só sabe
//  escrever na loja ATIVA) porque a escrita às vezes é cross-loja: quem bipa
//  a chegada de uma carga na loja destino também precisa debitar
//  `emTransito` na loja de ORIGEM, e vice-versa numa transferência — mesmo
//  padrão de `_refRecCrossLoja` em 22-recebimento.js:113.
//
//  Doc único por loja (id fixo 'atual'). O log de movimentos é gravado
//  ANTES do increment no ledger, de propósito: se a rede cair entre as
//  duas escritas, o log sozinho já basta pra reconciliar manualmente
//  depois — mesmo espírito da fila offline de 23-recebimento-offline.js.
//  Sem transação distribuída (Cloud Function) por decisão explícita do
//  plano desta feature: sem precedente no domínio Recebimento, e
//  `increment()` já evita corrida sem precisar ler o saldo antes de gravar.
// ═══════════════════════════════════════════════════

const COL_PALETES_LEDGER = 'recebimento_paletes_ledger';
const COL_PALETES_MOVIMENTOS = 'recebimento_paletes_movimentos';
const PALETES_LEDGER_DOC_ID = 'atual';

function _refPaletesLedger(lojaId) {
  return getDTRawFirestore().collection('lojas').doc(lojaId).collection(COL_PALETES_LEDGER).doc(PALETES_LEDGER_DOC_ID);
}
function _refPaletesMovimentos(lojaId) {
  return getDTRawFirestore().collection('lojas').doc(lojaId).collection(COL_PALETES_MOVIMENTOS);
}

// tipo: 'TRANSBORDO_EXPEDICAO' | 'TRANSBORDO_RECEBIMENTO' |
//       'TRANSFERENCIA_EXPEDICAO' | 'TRANSFERENCIA_RECEBIMENTO' |
//       'SAIDA_EXTERNA' | 'RETORNO_EXTERNO'
// deltas: { disponivelDelta, emTransitoDelta } — cada um pode ser
// positivo, negativo ou omitido (vira 0). `total` é sempre a soma dos dois,
// nunca informado separado, pra nunca ficar inconsistente com os outros 2.
// referencia: { colecao, id } — pra rastrear qual documento gerou o
// movimento (não obrigatório, mas fortemente recomendado pelos chamadores).
// NÃO captura erro — propaga pro chamador decidir (o documento principal já
// foi salvo antes desta chamada; uma falha aqui não deve ser tratada como
// "operação inteira falhou", só avisada).
async function _aplicarMovimentoLedger(lojaId, tipo, deltas, referencia) {
  if (!lojaId) throw new Error('_aplicarMovimentoLedger: lojaId é obrigatório');
  if (!tipo) throw new Error('_aplicarMovimentoLedger: tipo é obrigatório');
  const disponivelDelta = (deltas && Number.isFinite(deltas.disponivelDelta)) ? deltas.disponivelDelta : 0;
  const emTransitoDelta = (deltas && Number.isFinite(deltas.emTransitoDelta)) ? deltas.emTransitoDelta : 0;
  const totalDelta = disponivelDelta + emTransitoDelta;
  const agora = new Date().toISOString();
  // PEDIDO AO VIVO (2026-09-06): "quero excluir uma viagem errada" na tela
  // de Paletes — Monitoramento do Analista precisa desfazer o efeito dela
  // no ledger, reaproveitando esta MESMA função (script agora carregado
  // também em analista.html) — daí o fallback pra window._currentAnalistaUser
  // (convenção do Analista, ver 00-auth-login.js), já que `APP.operador` só
  // existe no Coletor.
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || (typeof window !== 'undefined' && window._currentAnalistaUser && window._currentAnalistaUser.email) || '';

  await _refPaletesMovimentos(lojaId).add({
    tipo: tipo,
    disponivelDelta: disponivelDelta,
    emTransitoDelta: emTransitoDelta,
    totalDelta: totalDelta,
    referenciaColecao: (referencia && referencia.colecao) || '',
    referenciaId: (referencia && referencia.id) || '',
    criadoEm: agora,
    criadoPor: autor
  });

  const FV = firebase.firestore.FieldValue;
  await _refPaletesLedger(lojaId).set({
    disponivel: FV.increment(disponivelDelta),
    emTransito: FV.increment(emTransitoDelta),
    total: FV.increment(totalDelta),
    atualizadoEm: agora,
    atualizadoPor: autor
  }, { merge: true });
}

// Inventário finalizado: a contagem passa a ser o saldo absoluto disponível.
// Usa transação para não calcular delta sobre um saldo que possa mudar entre leitura e escrita.
async function _definirSaldoPaletesPorInventario(lojaId, novoDisponivel, referencia) {
  if (!lojaId) throw new Error('_definirSaldoPaletesPorInventario: lojaId é obrigatório');
  novoDisponivel = Math.max(0, Math.round(Number(novoDisponivel)));
  if (!Number.isFinite(novoDisponivel)) throw new Error('Saldo de inventário inválido');
  const db = getDTRawFirestore();
  const ledgerRef = _refPaletesLedger(lojaId);
  const movRef = _refPaletesMovimentos(lojaId).doc();
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || (typeof window !== 'undefined' && window._currentAnalistaUser && window._currentAnalistaUser.email) || '';
  await db.runTransaction(async function (tx) {
    const snap = await tx.get(ledgerRef);
    const atual = snap && snap.exists ? (snap.data() || {}) : {};
    const disponivelAnterior = Number.isFinite(atual.disponivel) ? atual.disponivel : 0;
    const emTransito = Number.isFinite(atual.emTransito) ? atual.emTransito : 0;
    const delta = novoDisponivel - disponivelAnterior;
    tx.set(movRef, {
      tipo: 'INVENTARIO_CONTAGEM', disponivelDelta: delta, emTransitoDelta: 0, totalDelta: delta,
      saldoAnterior: disponivelAnterior, saldoInventariado: novoDisponivel,
      referenciaColecao: (referencia && referencia.colecao) || '', referenciaId: (referencia && referencia.id) || '',
      criadoEm: agora, criadoPor: autor
    });
    tx.set(ledgerRef, {
      disponivel: novoDisponivel, emTransito: emTransito, total: novoDisponivel + emTransito,
      atualizadoEm: agora, atualizadoPor: autor, ultimoInventarioEm: agora
    }, { merge: true });
  });
}

async function obterLedgerPaletes(lojaId) {
  if (!lojaId) return null;
  const doc = await _refPaletesLedger(lojaId).get();
  if (!doc || !doc.exists) return { disponivel: 0, emTransito: 0, total: 0 };
  const dados = doc.data() || {};
  return {
    disponivel: Number.isFinite(dados.disponivel) ? dados.disponivel : 0,
    emTransito: Number.isFinite(dados.emTransito) ? dados.emTransito : 0,
    total: Number.isFinite(dados.total) ? dados.total : 0
  };
}

window._aplicarMovimentoLedger = _aplicarMovimentoLedger;
window._definirSaldoPaletesPorInventario = _definirSaldoPaletesPorInventario;
window.obterLedgerPaletes = obterLedgerPaletes;
window._recebimentoPaletesLedgerInternals = {
  refLedger: _refPaletesLedger,
  refMovimentos: _refPaletesMovimentos,
  definirSaldoInventario: _definirSaldoPaletesPorInventario
};
