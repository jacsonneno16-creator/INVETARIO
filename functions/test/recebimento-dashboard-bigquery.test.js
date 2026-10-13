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

function bqFake(respostas) {
  const chamadas = [];
  let i = 0;
  return { _chamadas: chamadas, query: async opts => { chamadas.push(opts); return [respostas[i++] || []]; } };
}

const row = (id, data) => ({document_id:id, data:JSON.stringify(data)});

test('Dashboard Recebimento BigQuery: devolve somente resumo agregado e usa os dois espelhos raw_latest', async () => {
  const {_buscarResumoHistoricoRecebimentoBigQueryInterno} = carregar();
  const bq = bqFake([
    [
      row('n1',{fornecedorNome:'Fornecedor A', natureza:'Compra', valor:100, tempoLancamentoMin:10, comparavel:true, temDivergencia:false, processamento:'2026-09-01T10:00:00Z'}),
      row('n2',{fornecedorNome:'Fornecedor A', natureza:'Compra', valor:50, tempoLancamentoMin:20, comparavel:true, temDivergencia:true, processamento:'2026-09-02T10:00:00Z'}),
      row('n3',{fornecedorNome:'Loja X', natureza:'Transferência entre lojas', valor:70, processamento:'2026-09-03T10:00:00Z'}),
      row('n4',{fornecedorNome:'Cliente', natureza:'Dev. compra', valor:999, processamento:'2026-09-04T10:00:00Z'}),
    ],
    [row('c1',{dataGeracao:'2026-09-01T08:00:00Z',dataInicioRecebimento:'2026-09-01T09:00:00Z',dataFimRecebimento:'2026-09-01T10:30:00Z'})]
  ]);
  const r = await _buscarResumoHistoricoRecebimentoBigQueryInterno({periodo:'2026-09',categoria:'FORNECEDOR'}, {}, bq);
  assert.equal(r.totalNotas,2);
  assert.equal(r.fornecedoresDistintos,1);
  assert.equal(r.valorTotal,150);
  assert.equal(r.comDivergencia,1);
  assert.equal(r.comparaveis,2);
  assert.equal(r.transbordoNoPeriodo,1);
  assert.equal(r.devolucoesExcluidas,1);
  assert.equal(r.tempoMedioLancamento,15);
  assert.equal(r.tempoMedioEspera,60);
  assert.equal(r.tempoMedioConferencia,90);
  assert.equal(r.tempoMedioRecebimento,150);
  assert.deepEqual(r.rankingFornecedores,[{nome:'Fornecedor A',entregas:2,valor:150}]);
  assert.match(bq._chamadas[0].query,/recebimento_notas_raw_latest/);
  assert.match(bq._chamadas[1].query,/recebimento_cargas_raw_latest/);
  assert.equal(bq._chamadas[0].params.periodo,'2026-09');
});

test('Dashboard Recebimento BigQuery: TODAS inclui fornecedor+transbordo e continua excluindo devolução', async () => {
  const {_buscarResumoHistoricoRecebimentoBigQueryInterno} = carregar();
  const bq = bqFake([[
    row('n1',{fornecedorNome:'A', natureza:'Compra', valor:10}),
    row('n2',{fornecedorNome:'B', natureza:'Transferência entre lojas', valor:20}),
    row('n3',{fornecedorNome:'C', natureza:'Retorno de mercadoria', valor:30}),
  ],[]]);
  const r = await _buscarResumoHistoricoRecebimentoBigQueryInterno({categoria:'TODAS'}, {}, bq);
  assert.equal(r.totalNotas,2);
  assert.equal(r.valorTotal,30);
  assert.equal(r.devolucoesExcluidas,1);
});
