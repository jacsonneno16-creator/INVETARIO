// PEDIDO AO VIVO (2026-09-11, Fase 2 do espelho BigQuery): Transbordo
// (95-recebimento-transbordo.js) e Cargas/Montagem
// (104-recebimento-cargas-cards.js) mostram TODAS as lojas de uma vez —
// buscarTransbordoTodasLojasBigQuery e buscarCargasTodasLojasBigQuery lêem
// dos espelhos "_raw_latest" de recebimentos/recebimento_transbordo_cargas
// respectivamente. Diferente das funções de loja única: aqui o filtro de
// permissão é aplicado NA CONSULTA (IN UNNEST das lojas permitidas), já
// que a função roda com uma conta de serviço que bypassa as regras do
// Firestore — precisa repetir o mesmo filtro que firestore.rules já aplica
// hoje pro cliente direto.
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
  return {_chamadas: chamadas, query: async (opts) => { chamadas.push(opts); return [linhas]; }};
}

const ACESSO_TODAS_LOJAS = {acesso_todas_lojas: true};
const ACESSO_DUAS_LOJAS = {lojas_permitidas: ['loja_matriz', 'loja_filial']};
const ACESSO_SEM_LOJA_NENHUMA = {lojas_permitidas: []};

test('_clausulaLojasPermitidas: acesso_todas_lojas/admin_mestre não restringe nada', () => {
  const {_clausulaLojasPermitidas} = carregarComFirestoreFake();
  assert.deepEqual(_clausulaLojasPermitidas(ACESSO_TODAS_LOJAS), {clausula: '', params: {}});
  assert.deepEqual(_clausulaLojasPermitidas({admin_mestre: true}), {clausula: '', params: {}});
});

test('_clausulaLojasPermitidas: login restrito gera cláusula IN UNNEST com as lojas dele', () => {
  const {_clausulaLojasPermitidas} = carregarComFirestoreFake();
  const r = _clausulaLojasPermitidas(ACESSO_DUAS_LOJAS);
  assert.match(r.clausula, /IN UNNEST\(@lojasPermitidas\)/);
  assert.deepEqual(r.params.lojasPermitidas.sort(), ['loja_filial', 'loja_matriz']);
});

test('_clausulaLojasPermitidas: sem NENHUMA loja permitida, marca semAcessoNenhum (nunca gera query sem filtro)', () => {
  const {_clausulaLojasPermitidas} = carregarComFirestoreFake();
  assert.equal(_clausulaLojasPermitidas(ACESSO_SEM_LOJA_NENHUMA).semAcessoNenhum, true);
});

test('buscarTransbordoTodasLojasBigQuery: monta a query certa (view recebimentos, tipo=TRANSBORDO) e devolve {_id, _lojaId, ...dados}', async () => {
  const {_buscarTransbordoTodasLojasBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([
    {document_id: 'r1', data: JSON.stringify({tipo: 'TRANSBORDO', status: 'AGUARDANDO'}), path_params: JSON.stringify({lojaId: 'loja_matriz'})},
  ]);
  const resultado = await _buscarTransbordoTodasLojasBigQueryInterno(ACESSO_TODAS_LOJAS, bq);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0]._id, 'r1');
  assert.equal(resultado[0]._lojaId, 'loja_matriz');
  assert.equal(resultado[0].status, 'AGUARDANDO');
  assert.match(bq._chamadas[0].query, /recebimentos_raw_latest/);
  assert.match(bq._chamadas[0].query, /TRANSBORDO/);
});

test('buscarTransbordoTodasLojasBigQuery: login restrito a 2 lojas aplica IN UNNEST na consulta', async () => {
  const {_buscarTransbordoTodasLojasBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([]);
  await _buscarTransbordoTodasLojasBigQueryInterno(ACESSO_DUAS_LOJAS, bq);
  assert.match(bq._chamadas[0].query, /IN UNNEST/);
  assert.deepEqual(bq._chamadas[0].params.lojasPermitidas.sort(), ['loja_filial', 'loja_matriz']);
});

test('buscarTransbordoTodasLojasBigQuery: sem loja nenhuma permitida, nem consulta o BigQuery — devolve vazio direto', async () => {
  const {_buscarTransbordoTodasLojasBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([{document_id: 'x', data: '{}', path_params: '{}'}]);
  const resultado = await _buscarTransbordoTodasLojasBigQueryInterno(ACESSO_SEM_LOJA_NENHUMA, bq);
  assert.deepEqual(resultado, []);
  assert.equal(bq._chamadas.length, 0);
});

test('buscarCargasTodasLojasBigQuery: por padrão só PENDENTE/EM_TRANSITO (não incluirFinalizadas)', async () => {
  const {_buscarCargasTodasLojasBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([
    {document_id: 'c1', data: JSON.stringify({status: 'PENDENTE', nomeCarga: 'Carga 1'}), path_params: JSON.stringify({lojaId: 'loja_matriz'})},
  ]);
  const resultado = await _buscarCargasTodasLojasBigQueryInterno({incluirFinalizadas: false}, ACESSO_TODAS_LOJAS, bq);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].lojaId, 'loja_matriz');
  assert.match(bq._chamadas[0].query, /PENDENTE.*EM_TRANSITO|EM_TRANSITO.*PENDENTE/s);
});

test('buscarCargasTodasLojasBigQuery: incluirFinalizadas=true não filtra por status (traz RECEBIDA/CANCELADA também)', async () => {
  const {_buscarCargasTodasLojasBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([]);
  await _buscarCargasTodasLojasBigQueryInterno({incluirFinalizadas: true}, ACESSO_TODAS_LOJAS, bq);
  assert.doesNotMatch(bq._chamadas[0].query, /PENDENTE/);
});

test('buscarCargasTodasLojasBigQuery: login restrito só vê as próprias lojas', async () => {
  const {_buscarCargasTodasLojasBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([]);
  await _buscarCargasTodasLojasBigQueryInterno({}, ACESSO_DUAS_LOJAS, bq);
  assert.match(bq._chamadas[0].query, /IN UNNEST/);
});
