// PEDIDO AO VIVO (2026-09-11, Fase 2 do espelho BigQuery): Pátio em Tempo
// Real (105-recebimento-patio-tempo-real.js) busca por statusFisico=
// NO_PATIO, não por período — buscarPatioTempoRealBigQuery lê da mesma
// view "_raw_latest" que buscarIndicadoresRetornosBigQuery, com um filtro
// diferente, e devolve os documentos crus no mesmo formato {_id, ...dados}.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function carregarComFirestoreFake() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', {value: () => ({}), configurable: true});
  const indexModule = require(path.join(__dirname, '..', 'index.js'));
  return indexModule._graphBiInternals;
}

function bigqueryFake(linhas) {
  const chamadas = [];
  return {
    _chamadas: chamadas,
    query: async (opts) => { chamadas.push(opts); return [linhas]; },
  };
}

const ACESSO_TODAS_LOJAS = {acesso_todas_lojas: true};
const ACESSO_LOJA_MATRIZ = {lojas_permitidas: ['loja_matriz']};

test('busca por statusFisico=NO_PATIO: monta a query certa (view _raw_latest, filtro por loja e status físico) e devolve documentos no formato {_id, ...dados}', async () => {
  const {_buscarPatioTempoRealBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([
    {document_id: 'r1', data: JSON.stringify({statusFisico: 'NO_PATIO', box: 'BOX 1', tratamento: 'RECUSA'})},
  ]);
  const resultado = await _buscarPatioTempoRealBigQueryInterno({lojaId: 'loja_matriz'}, ACESSO_TODAS_LOJAS, bq);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0]._id, 'r1');
  assert.equal(resultado[0].box, 'BOX 1');

  const chamada = bq._chamadas[0];
  assert.match(chamada.query, /recebimento_recusas_raw_latest/);
  assert.match(chamada.query, /operation != 'DELETE'/);
  assert.match(chamada.query, /NO_PATIO/);
  assert.equal(chamada.params.lojaId, 'loja_matriz');
});

test('login sem acesso a esta loja: rejeita antes de consultar o BigQuery', async () => {
  const {_buscarPatioTempoRealBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([]);
  await assert.rejects(
    () => _buscarPatioTempoRealBigQueryInterno({lojaId: 'loja_filial'}, ACESSO_LOJA_MATRIZ, bq),
    /não tem acesso a esta loja/
  );
  assert.equal(bq._chamadas.length, 0);
});

test('sem lojaId: rejeita com mensagem clara', async () => {
  const {_buscarPatioTempoRealBigQueryInterno} = carregarComFirestoreFake();
  await assert.rejects(
    () => _buscarPatioTempoRealBigQueryInterno({lojaId: ''}, ACESSO_TODAS_LOJAS, bigqueryFake([])),
    /Loja não informada/
  );
});

test('sem nenhum documento no pátio: devolve lista vazia, não quebra', async () => {
  const {_buscarPatioTempoRealBigQueryInterno} = carregarComFirestoreFake();
  const resultado = await _buscarPatioTempoRealBigQueryInterno({lojaId: 'loja_matriz'}, ACESSO_TODAS_LOJAS, bigqueryFake([]));
  assert.deepEqual(resultado, []);
});
