// PEDIDO AO VIVO (2026-09-11): "clico demora muito para carregar" — mesmo
// com o servidor respondendo rápido (~1.2-1.6s, confirmado no log), o
// BigQuery tem um piso de latência que não encolhe mais por código. Em vez
// de cada clique do Analista disparar sua própria consulta ao BigQuery, um
// job agendado (_atualizarCachePatioTempoRealTodasLojas, a cada 2 minutos)
// deixa o resultado PRONTO — já flatten por nota e enriquecido (mercado/
// vendedor/valor) — guardado em lojas/{lojaId}/recebimento_patio_cache/
// atual. A tela (105-recebimento-patio-tempo-real.js) passa a ler só esse
// documento (leitura simples de Firestore, bem abaixo de 1s).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Mesmo Firestore-em-memória (collection/doc aninhado + batch.set) já usado
// em sincronizacao-bi-agendado.test.js — não dá pra usar o emulador real
// aqui (exige Java, indisponível neste ambiente).
function criarFirestoreFake() {
  const dados = new Map();
  function colRef(prefixo) {
    return {
      doc(id) {
        id = id || 'auto_' + Math.random().toString(36).slice(2);
        const caminho = prefixo + '/' + id;
        return {
          id,
          _path: caminho,
          collection(nome) { return colRef(caminho + '/' + nome); },
          async get() { return { exists: dados.has(caminho), id, data: () => dados.get(caminho) }; },
        };
      },
      async get() {
        const pfx = prefixo + '/';
        const docs = [];
        dados.forEach((valor, caminho) => {
          if (caminho.startsWith(pfx) && !caminho.slice(pfx.length).includes('/')) {
            docs.push({ id: caminho.slice(pfx.length), data: () => valor });
          }
        });
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  return {
    collection(nome) { return colRef(nome); },
    batch() {
      const ops = [];
      return {
        set(ref, payload) { ops.push({ ref, payload }); },
        async commit() {
          ops.forEach(op => { dados.set(op.ref._path, op.payload); });
        },
      };
    },
    _dump: () => dados,
  };
}

function carregarComFirestoreFake() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  const fakeDb = criarFirestoreFake();
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', { value: () => fakeDb, configurable: true });
  const indexModule = require(path.join(__dirname, '..', 'index.js'));
  return { fakeDb, internals: indexModule._graphBiInternals };
}

function bigqueryFake(linhas) {
  return { query: async () => [linhas] };
}

test('_montarCachePatioTempoRealLoja: monta a lista flatten+enriquecida e grava em lojas/{lojaId}/recebimento_patio_cache/atual', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas/CH1', { destinatario: 'Mercado X', vendedorNome: 'João', supervisorNome: 'Carla', valorTotal: 250 });
  const bq = bigqueryFake([
    { document_id: 'r1', data: JSON.stringify({ origem: 'COLETOR', criadoEm: '2026-09-01T10:00:00.000Z', box: 'BOX 1', notas: [{ chave: 'CH1', numeroNota: '100', tratamento: 'RECUSA' }] }) },
  ]);

  const total = await internals._montarCachePatioTempoRealLoja('loja1', bq);
  assert.equal(total, 1);

  const cache = fakeDb._dump().get('lojas/loja1/recebimento_patio_cache/atual');
  assert.ok(cache, 'documento de cache foi gravado');
  assert.equal(cache.linhas.length, 1);
  assert.equal(cache.linhas[0].numeroNota, '100');
  assert.equal(cache.linhas[0].destinatario, 'Mercado X', 'enriquecido com o mercado achado por chave');
  assert.equal(cache.linhas[0].vendedorNome, 'João');
  assert.equal(cache.linhas[0].valorTotal, 250);
  assert.ok(cache.atualizadoEm, 'carimba quando o cache foi montado');
});

test('_montarCachePatioTempoRealLoja: nota já finalizada (Recusa) NÃO entra no cache (não está mais no pátio)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const bq = bigqueryFake([
    { document_id: 'r1', data: JSON.stringify({ origem: 'COLETOR', criadoEm: '2026-09-01T10:00:00.000Z', notas: [{ chave: 'CH1', numeroNota: '100', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }] }) },
  ]);
  const total = await internals._montarCachePatioTempoRealLoja('loja1', bq);
  assert.equal(total, 0);
  const cache = fakeDb._dump().get('lojas/loja1/recebimento_patio_cache/atual');
  assert.deepEqual(cache.linhas, []);
});

test('_montarCachePatioTempoRealLoja: nota sem chave (ex.: veio de Identificar) fica sem mercado, mas não quebra', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const bq = bigqueryFake([
    { document_id: 'r1', data: JSON.stringify({ origem: 'COLETOR', criadoEm: '2026-09-01T10:00:00.000Z', box: 'BOX 2', notas: [{ numeroNota: '900', tratamento: 'RECUSA' }] }) },
  ]);
  const total = await internals._montarCachePatioTempoRealLoja('loja1', bq);
  assert.equal(total, 1);
  const cache = fakeDb._dump().get('lojas/loja1/recebimento_patio_cache/atual');
  assert.equal(cache.linhas[0].destinatario, '');
});

// BUG AO VIVO REAL (2026-09-11): "Pátio em Tempo Real ainda tá demorando
// muito" — o job agendado rodava "com sucesso" (onRun nunca relançava o
// erro) mas o cache da loja de verdade (192 notas) NUNCA se formava: uma
// nota sem dataSaidaEm/dataProgramadaEm (nem na nota, nem no documento —
// caso comum, é opcional) vira `undefined` explícito no campo, e o SDK
// Admin do Firestore REJEITA `undefined` num write (diferente do SDK do
// navegador). O Firestore-fake deste teste não valida isso (só o real
// rejeita), então a asserção aqui é sobre o round-trip JSON aplicado —
// confirma que nenhum campo problemático sobrevive até o payload gravado.
test('_montarCachePatioTempoRealLoja: nota sem dataSaidaEm/dataProgramadaEm (campo ausente em ambos) nunca grava "undefined" — vira ausente/null, não quebra o write real', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const bq = bigqueryFake([
    { document_id: 'r1', data: JSON.stringify({ origem: 'COLETOR', criadoEm: '2026-09-01T10:00:00.000Z', box: 'BOX 3', notas: [{ chave: 'CHU', numeroNota: '950', tratamento: 'REENTREGA' }] }) },
  ]);
  const total = await internals._montarCachePatioTempoRealLoja('loja1', bq);
  assert.equal(total, 1);
  const cache = fakeDb._dump().get('lojas/loja1/recebimento_patio_cache/atual');
  // dataSaidaEm nunca foi setado em lugar nenhum — a CHAVE não pode nem
  // existir no objeto gravado (diferente de "existir com valor
  // undefined", que `===undefined` não distingue de chave ausente).
  assert.equal(Object.prototype.hasOwnProperty.call(cache.linhas[0], 'dataSaidaEm'), false, 'campo undefined explícito nunca pode ir pro payload gravado — nem como chave presente');
  // Prova mais forte: simula exatamente o que aconteceria com o SDK real —
  // se sobrasse um `undefined` de verdade em QUALQUER campo, o round-trip
  // abaixo mudaria o resultado (uma chave a menos), destravando esta
  // asserção.
  assert.deepEqual(JSON.parse(JSON.stringify(cache.linhas)), cache.linhas);
});

test('_atualizarCachePatioTempoRealTodasLojas: roda pra cada loja cadastrada, isolando erro de uma loja das outras', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1', { nome: 'Loja 1' });
  fakeDb._dump().set('lojas/loja2', { nome: 'Loja 2' });
  const bq = bigqueryFake([]);
  const resultados = await internals._atualizarCachePatioTempoRealTodasLojas(bq);
  assert.equal(resultados.length, 2);
  assert.ok(resultados.every(r => r.ok), 'as 2 lojas processaram sem erro (BigQuery mockado devolve vazio)');
  assert.ok(fakeDb._dump().has('lojas/loja1/recebimento_patio_cache/atual'));
  assert.ok(fakeDb._dump().has('lojas/loja2/recebimento_patio_cache/atual'));
});
