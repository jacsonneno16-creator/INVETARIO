'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function carregar() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', {value: () => ({}), configurable: true});
  return require(path.join(__dirname, '..', 'index.js'))._graphBiInternals;
}

function bqQueryFake(linhas) {
  const chamadas = [];
  return { _chamadas: chamadas, query: async opts => { chamadas.push(opts); return [linhas]; } };
}

test('Operação de Recebimento: lê somente a loja solicitada no BigQuery e mantém formato dos documentos', async () => {
  const {_buscarRecebimentosOperacaoBigQueryInterno} = carregar();
  const bq = bqQueryFake([{document_id:'r1', data: JSON.stringify({status:'CHEGOU', tipo:'FORNECEDOR'})}]);
  const acesso = {acesso_todas_lojas:true};
  const linhas = await _buscarRecebimentosOperacaoBigQueryInterno({lojaId:'loja-1'}, acesso, bq);
  assert.deepEqual(linhas, [{_id:'r1', _lojaId:'loja-1', status:'CHEGOU', tipo:'FORNECEDOR'}]);
  const c = bq._chamadas[0];
  assert.match(c.query, /recebimentos_raw_latest/);
  assert.match(c.query, /path_params/);
  assert.match(c.query, /@lojaId/);
  assert.equal(c.params.lojaId, 'loja-1');
});

test('Operação de Recebimento: bloqueia loja fora das permissões', async () => {
  const {_buscarRecebimentosOperacaoBigQueryInterno} = carregar();
  const bq = bqQueryFake([]);
  const acesso = {lojas:['loja-2']};
  await assert.rejects(
    () => _buscarRecebimentosOperacaoBigQueryInterno({lojaId:'loja-1'}, acesso, bq),
    /acesso a esta loja/i
  );
  assert.equal(bq._chamadas.length, 0);
});
