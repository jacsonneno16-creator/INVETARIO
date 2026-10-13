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
  const chamadas=[]; let i=0;
  return {_chamadas:chamadas, query:async opts=>{chamadas.push(opts); return [respostas[i++]||[]];}};
}
const row=(id,data)=>({document_id:id,data:JSON.stringify(data)});

test('Notas Recebimento BigQuery: pagina no backend, devolve total e mantém limite 50', async()=>{
  const {_buscarNotasRecebimentoPaginadasBigQueryInterno}=carregar();
  const bq=bqFake([
    [row('n51',{notaFiscalKey:51,numeroNota:'51',fornecedorNome:'Fornecedor A',processamento:'2026-09-20'})],
    [{total:101}],
    [{fornecedores:['Fornecedor A','Fornecedor B'],status:['FINALIZADA'],naturezas:['Compra']}],
  ]);
  const r=await _buscarNotasRecebimentoPaginadasBigQueryInterno({pagina:2,limite:50,periodo:'2026-09',fornecedor:'Fornecedor A',categoria:'FORNECEDOR',incluirOpcoes:true},{email:'x'},bq);
  assert.equal(r.total,101);
  assert.equal(r.pagina,2);
  assert.equal(r.limite,50);
  assert.equal(r.linhas.length,1);
  assert.equal(r.linhas[0]._id,'n51');
  assert.deepEqual(r.opcoes.fornecedores,['Fornecedor A','Fornecedor B']);
  assert.equal(bq._chamadas.length,3);
  assert.match(bq._chamadas[0].query,/LIMIT @limite OFFSET @offset/);
  assert.match(bq._chamadas[0].query,/recebimento_notas_raw_latest/);
  assert.equal(bq._chamadas[0].params.offset,50);
  assert.equal(bq._chamadas[0].params.limite,50);
  assert.equal(bq._chamadas[0].params.periodo,'2026-09');
  assert.equal(bq._chamadas[0].params.fornecedor,'Fornecedor A');
});

test('Notas Recebimento BigQuery: não recalcula opções em toda troca de página', async()=>{
  const {_buscarNotasRecebimentoPaginadasBigQueryInterno}=carregar();
  const bq=bqFake([[row('n1',{numeroNota:'1'})],[{total:1}]]);
  const r=await _buscarNotasRecebimentoPaginadasBigQueryInterno({pagina:1,limite:50,categoria:'TODAS',incluirOpcoes:false},{email:'x'},bq);
  assert.equal(r.total,1);
  assert.equal(r.opcoes,null);
  assert.equal(bq._chamadas.length,2);
  assert.equal(bq._chamadas[0].params.categoria,'TODAS');
});
