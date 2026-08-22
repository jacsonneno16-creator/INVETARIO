// ═══════════════════════════════════════════════════
//  RECEBIMENTO — fila offline dos bips de Transbordo (fase 4c)
//  Mesmo padrão de fila usado pras contagens (IndexedDB `dt_coletor_db`,
//  store irmã `recebimento_bips_pendentes` criada em
//  01-core-firebase-cache.js), mas com uma diferença importante: ao
//  sincronizar, revalida a guarda contra o status ATUAL do servidor (pode
//  ter mudado enquanto o aparelho estava offline — outro aparelho ou o
//  Analista podem ter avançado a carga) — se não bater mais, marca conflito
//  em vez de gravar por cima e corromper o estado.
// ═══════════════════════════════════════════════════

let PENDENTES_REC_MAP = {}; // recebimentoId -> {status_sync:'pendente'|'conflito', operacao, motivoConflito?}
let _enviandoFilaRecebimentoEmAndamento = false;
let _recSeqCounter = 0; // desempate de ordenação quando dois bips caem no mesmo milissegundo (só ocorre dentro da mesma sessão)

// Enfileira um bip que não pôde ser aplicado ao vivo (sem internet). Guarda
// o timestamp ORIGINAL do bip (o momento em que o operador tocou/bipou),
// não o da sincronização — extraído do próprio `proximo.mudancas`, que já
// foi calculado com `new Date()` no instante do toque, antes de cair aqui.
async function enfileirarBipRecebimento(r, proximo) {
  const uuid = (typeof gerarUUID === 'function' ? gerarUUID() : ('rec_' + Date.now() + '_' + Math.random().toString(36).slice(2)));
  const campoHora = Object.keys(proximo.mudancas).find(k => k.startsWith('hora'));
  const bip = {
    uuid,
    recebimentoId: r._id,
    lojaId: r._lojaId || (typeof getDTLojaAtiva === 'function' ? getDTLojaAtiva() : ''),
    operacao: proximo.operacao,
    mudancas: proximo.mudancas,
    timestampBip: campoHora ? proximo.mudancas[campoHora] : new Date().toISOString(),
    status_sync: 'pendente',
    tentativas: 0,
    criado_em: new Date().toISOString(),
    seq: _recSeqCounter++,
  };
  await recIdbPut(bip);

  // Reflexo otimista imediato na cache em memória — a lista "em andamento"
  // e a tela de confirmação já mostram o novo estado sem esperar a
  // sincronização (o operador não fica sem feedback só porque está offline).
  const idx = RECEBIMENTOS_CACHE.findIndex(x => x._id === r._id);
  const mesclado = { ...r, ...proximo.mudancas };
  if (idx >= 0) RECEBIMENTOS_CACHE[idx] = mesclado; else RECEBIMENTOS_CACHE.push(mesclado);

  await atualizarIndicadorPendenciasRecebimento();
  return bip;
}

// Recarrega o mapa de pendências/conflitos do IDB e redesenha a lista —
// chamado após enfileirar, depois de cada tentativa de sincronização, e ao
// carregar o hub.
async function atualizarIndicadorPendenciasRecebimento() {
  const todos = await recIdbGetAll();
  const mapa = {};
  todos.forEach(b => {
    mapa[b.recebimentoId] = { status_sync: b.status_sync, operacao: b.operacao, motivoConflito: b.motivoConflito };
  });
  PENDENTES_REC_MAP = mapa;
  if (typeof _desenharListaRecebimento === 'function') _desenharListaRecebimento();
}

// Envia a fila pendente em segundo plano, sem travar o operador. Cada item
// é revalidado contra o status ATUAL do servidor antes de ser aplicado —
// nunca aplica um bip cego só porque ele está na fila.
async function sincronizarFilaRecebimento() {
  if (_enviandoFilaRecebimentoEmAndamento) return;
  if (!navigator.onLine) return;
  const pendentes = await recIdbGetPendentes();
  if (!pendentes.length) return;
  // Ordem cronológica: se duas etapas da MESMA carga foram bipadas offline
  // em sequência (ex.: chegada e início de descarga), a ordem de leitura do
  // IDB não é garantida por data — sem isto, a 2ª poderia ser processada
  // antes da 1ª e cair em "conflito" à toa por não bater a guarda.
  pendentes.sort((a, b) => {
    const c = String(a.criado_em || '').localeCompare(String(b.criado_em || ''));
    return c !== 0 ? c : (a.seq || 0) - (b.seq || 0);
  });

  _enviandoFilaRecebimentoEmAndamento = true;
  try {
    for (const bip of pendentes) {
      try {
        // Criação de transbordo enfileirada (bug ao vivo: escrita sem
        // internet ficava PENDURADA pra sempre no SDK, sem erro nenhum —
        // ver comentário em _criarTransbordoPorMotorista/22-recebimento.js).
        // Sem `recebimentoId` (o doc ainda não existe), então não passa
        // pelo caminho normal de revalidação abaixo — só cria de verdade.
        if (bip.operacao === 'CRIAR_TRANSBORDO') {
          await FS.collection(COL_RECEBIMENTOS).add(bip.payload);
          await recIdbDelete(bip.uuid);
          continue;
        }
        const doc = await _refRecCrossLoja(bip.lojaId, bip.recebimentoId).get();
        if (!doc.exists) { await recIdbDelete(bip.uuid); continue; }
        const atual = { _id: bip.recebimentoId, _lojaId: bip.lojaId, ...doc.data() };

        const alvoStatus = bip.mudancas && bip.mudancas.status;
        if (atual.status === alvoStatus) {
          // Já foi aplicado numa sincronização anterior que gravou no
          // Firestore mas não conseguiu apagar da fila (ex.: app fechado no
          // meio) — idempotente: só limpa, sem reenviar nem marcar conflito.
          await recIdbDelete(bip.uuid);
          continue;
        }

        // `_proximoBipPara` aqui é usada só pra revalidar QUAL é a operação
        // válida a partir do status atual do servidor — a gravação em si usa
        // `bip.mudancas` (o que foi enfileirado de verdade), nunca um
        // `mudancas` recalculado, porque bips com dados extras (ex.: NF
        // confirmada na chegada) têm campos que `_proximoBipPara` sozinha
        // não reproduz.
        const esperado = _proximoBipPara(atual.status, bip.timestampBip);
        if (!esperado || esperado.operacao !== bip.operacao) {
          // Conflito real: a carga avançou pra um estado diferente do que
          // este bip espera enquanto o aparelho estava offline.
          await recIdbPut({
            ...bip, status_sync: 'conflito',
            motivoConflito: 'A carga já estava em "' + (REC_STATUS_LABEL[atual.status] || atual.status) + '" quando sincronizou.',
          });
          continue;
        }

        await _aplicarBipRecebimento(atual, bip.operacao, bip.mudancas, null, { silencioso: true });
        await recIdbDelete(bip.uuid);
      } catch (e) {
        // `posse-invalida` (checagem de posse dentro de _aplicarBipRecebimento,
        // revalidada contra o estado mais atual do servidor) é um conflito
        // real, igual ao de status acima — nunca vale a pena tentar de novo
        // sozinho, precisa ficar visível pro operador.
        if (e?.code === 'posse-invalida') {
          await recIdbPut({ ...bip, status_sync: 'conflito', motivoConflito: 'Esta carga não pertence mais a esta loja.' });
          continue;
        }
        await recIdbPut({ ...bip, tentativas: (bip.tentativas || 0) + 1, ultimo_erro: e?.message || String(e), status_sync: 'pendente' });
        if (!navigator.onLine || e?.code === 'unavailable') break; // sem conexão real: para o lote, tenta de novo depois
      }
    }
  } finally {
    _enviandoFilaRecebimentoEmAndamento = false;
    await atualizarIndicadorPendenciasRecebimento();
    if (typeof carregarRecebimentoColetor === 'function') carregarRecebimentoColetor();
  }
}
window.sincronizarFilaRecebimento = sincronizarFilaRecebimento;
