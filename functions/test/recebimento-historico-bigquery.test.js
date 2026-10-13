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
  const chamadas=[];
  return {_chamadas:chamadas, query:async opts=>{chamadas.push(opts);return [linhas];}};
}
function firestoreRotasFake(rotas) {
  return {
    collection: nome => {
      assert.equal(nome, 'recebimento_rotas_transbordo');
      return {
        where: (campo, op, valor) => {
          assert.equal(campo, 'destinoLojaId'); assert.equal(op, '=='); assert.equal(valor, 'loja-destino');
          return {get: async () => ({docs: rotas.map((r,i)=>({id:'r'+i,data:()=>r}))})};
        },
      };
    },
  };
}

test('Histórico de Recebimento: filtra status/período no BigQuery e cruza somente origens configuradas', async () => {
  const {_buscarHistoricoRecebimentosBigQueryInterno}=carregar();
  const bq=bqQueryFake([
    {document_id:'local1',loja_origem:'loja-destino',data:JSON.stringify({status:'FINALIZADO',tipo:'FORNECEDOR',horaChegada:'2026-09-02T08:00:00Z'})},
    {document_id:'tr1',loja_origem:'loja-origem',data:JSON.stringify({status:'FINALIZADO',tipo:'TRANSBORDO',destinoLojaId:'loja-destino',horaChegada:'2026-09-03T08:00:00Z'})},
    {document_id:'tr2',loja_origem:'loja-origem',data:JSON.stringify({status:'FINALIZADO',tipo:'TRANSBORDO',destinoLojaId:'outra-loja',horaChegada:'2026-09-03T08:00:00Z'})},
  ]);
  const db=firestoreRotasFake([{origemLojaId:'loja-origem',destinoLojaId:'loja-destino'}]);
  const linhas=await _buscarHistoricoRecebimentosBigQueryInterno({lojaId:'loja-destino',periodo:'2026-09'},{acesso_todas_lojas:true},bq,db);
  assert.equal(linhas.length,2);
  assert.deepEqual(linhas.map(x=>x._id).sort(),['local1','tr1']);
  const c=bq._chamadas[0];
  assert.match(c.query,/recebimentos_raw_latest/);
  assert.match(c.query,/FINALIZADO/);
  assert.match(c.query,/CANCELADO/);
  assert.match(c.query,/@periodo/);
  assert.match(c.query,/IN UNNEST\(@lojasBusca\)/);
  assert.deepEqual(c.params.lojasBusca,['loja-destino','loja-origem']);
  assert.equal(c.params.periodo,'2026-09');
});

test('Histórico de Recebimento: bloqueia loja sem permissão antes de consultar BigQuery', async () => {
  const {_buscarHistoricoRecebimentosBigQueryInterno}=carregar();
  const bq=bqQueryFake([]);
  await assert.rejects(
    ()=>_buscarHistoricoRecebimentosBigQueryInterno({lojaId:'loja-destino',periodo:''},{lojas:['outra']},bq,firestoreRotasFake([])),
    /acesso a esta loja/i
  );
  assert.equal(bq._chamadas.length,0);
});
