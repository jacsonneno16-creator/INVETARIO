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

test('Fornecedores Recebimento BigQuery: devolve somente contagem de divergências agrupada por fornecedor', async () => {
  const {_buscarDivergenciasFornecedoresRecebimentoBigQueryInterno} = carregar();
  const chamadas = [];
  const bq = {
    query: async opts => {
      chamadas.push(opts);
      return [[
        {fornecedor_chave: 'FORNECEDOR A', fornecedor: 'Fornecedor A', divergencias: 7},
        {fornecedor_chave: 'FORNECEDOR B', fornecedor: 'Fornecedor B', divergencias: {value: '3'}},
      ]];
    },
  };
  const r = await _buscarDivergenciasFornecedoresRecebimentoBigQueryInterno({}, {email:'x'}, bq);
  assert.deepEqual(r, [
    {fornecedor:'Fornecedor A', divergencias:7},
    {fornecedor:'Fornecedor B', divergencias:3},
  ]);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].query, /recebimento_notas_raw_latest/);
  assert.match(chamadas[0].query, /temDivergencia/);
  assert.match(chamadas[0].query, /GROUP BY fornecedor_chave/);
  assert.doesNotMatch(chamadas[0].query, /SELECT\s+document_id\s*,\s*data/i);
});
