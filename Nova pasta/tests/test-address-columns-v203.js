const fs=require('fs'),vm=require('vm'),assert=require('assert');
const context={window:{},console,Intl};vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/../public/js/shared/address-state-engine.js','utf8'),context);
const E=context.window.InventoryAddressState;
function inv(base){return {id:'INV1',codigo:'AUD-1',nome:'Teste',base};}
function state(base,contagens=[],divergencias=[],recontagens=[]){return {inventarios:[inv(base)],contagens,divergencias,recontagens};}
const base=[
 {id:'b1',endereco:'A1',codigo_produto:'P1',descricao_produto:'Produto 1',quantidade:150,palete:'PA'},
 {id:'b2',endereco:'A1',codigo_produto:'P2',descricao_produto:'Produto 2',quantidade:1000,palete:'PB'}
];
let s=state(base,[
 {id:'c1',inventario_id:'INV1',endereco:'A1',codigo_produto:'P1',quantidade:150,operador:'José'},
 {id:'c2',inventario_id:'INV1',endereco:'A1',codigo_produto:'P2',quantidade:900,operador:'José'}
]);
let x=E.consolidate({state:s,record:s.contagens[0]});
assert.equal(x.esperado,1150);assert.equal(x.primeira,1050);assert.equal(x.status,'DIVERGENTE');assert.equal(x.rodadas[0].itens.length,2);
// Segunda rodada em vários pallets/produtos deve somar o endereço inteiro.
s.contagens.push(
 {id:'r1',inventario_id:'INV1',endereco:'A1',tipo_contagem:'RECONTAGEM',numero_recontagem:1,codigo_produto:'P1',quantidade:150,operador:'Maria'},
 {id:'r2',inventario_id:'INV1',endereco:'A1',tipo_contagem:'RECONTAGEM',numero_recontagem:1,codigo_produto:'P2',quantidade:1000,operador:'Maria'}
);
x=E.consolidate({state:s,record:s.contagens[0]});assert.equal(x.segunda,1150);assert.equal(x.status,'RESOLVIDA');assert.equal(x.avaliacao.rodada,2);
// Linhas idênticas sem ID são pallets reais e não podem desaparecer.
let sameBase=[{endereco:'B1',codigo_produto:'PX',quantidade:100},{endereco:'B1',codigo_produto:'PX',quantidade:100}];
let sb=state(sameBase,[{id:'cb',inventario_id:'INV1',endereco:'B1',codigo_produto:'PX',quantidade:200}]);
let xb=E.consolidate({state:sb,record:sb.contagens[0]});assert.equal(xb.esperado,200);assert.equal(xb.status,'RESOLVIDA');
// Duplicata com o mesmo ID deve ser eliminada.
let dupBase=[{id:'z',endereco:'C1',codigo_produto:'PZ',quantidade:50},{id:'z',endereco:'C1',codigo_produto:'PZ',quantidade:50}];
let sc=state(dupBase,[{id:'cc',inventario_id:'INV1',endereco:'C1',codigo_produto:'PZ',quantidade:50}]);assert.equal(E.consolidate({state:sc,record:sc.contagens[0]}).esperado,50);
// Sem base não pode virar OK zero.
let sd=state([], [{id:'cd',inventario_id:'INV1',endereco:'D1',codigo_produto:'PD',quantidade:0}]);let xd=E.consolidate({state:sd,record:sd.contagens[0]});assert.equal(xd.esperado,null);assert.equal(xd.status,'SEM_BASE');
// Mesma fonte de verdade em list e decorate.
let listed=E.list(s).find(v=>v.endereco==='A1');let decorated=E.decorate(s.contagens[0],s);assert.equal(listed.status,decorated.status);assert.equal(listed.segunda,decorated.qtd_segunda);
console.log('OK v203: colunas, totais, pallets, base ausente e estado único validados.');
