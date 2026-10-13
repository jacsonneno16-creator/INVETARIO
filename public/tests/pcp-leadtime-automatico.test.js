'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const engine=fs.readFileSync(path.join(base,'120-pcp-demand-engine.js'),'utf8');
const central=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
function load(){
  const document={addEventListener:()=>{},getElementById:()=>null};
  const window={calcularProjecaoComRisco:()=>[],getParametrosProducaoProjecao:()=>({}),temPermissao:()=>true,getDTLojaAtiva:()=>''};
  const ctx={window,document,console,Date,Math,Number,String,Array,Object,Set,Map,confirm:()=>true,prompt:()=>null};
  vm.runInNewContext(engine,ctx);vm.runInNewContext(central,ctx);return window;
}
function historico(dias){
  const reqs=[],ag=[];
  dias.forEach((d,i)=>{
    const id='r'+i,ini=new Date(Date.UTC(2026,0,1+i*3)),fim=new Date(ini.getTime()+d*86400000);
    reqs.push({_id:id,cod:'100',produto:'Produto 100',compradoEm:ini.toISOString(),lojaId:'L1'});
    ag.push({_id:'a'+i,requisicaoId:id,cod:'100',produto:'Produto 100',quantidade:10,quantidadeRecebida:10,status:'finalizada',recebidoEm:fim.toISOString(),lojaId:'L1'});
  });
  return {reqs,ag};
}
test('lead time manual sempre vence o histórico',()=>{
  const w=load(),h=w._pcpInternals;h.setProdutos([{cod:'100',lojaId:'L1',leadTimeDias:9}]);
  const x=historico([3,4,5,6]);
  const r=h.resolverLeadTimeProduto('100',{produto:{cod:'100',lojaId:'L1',leadTimeDias:9},agendamentos:x.ag,requisicoes:x.reqs,lojaId:'L1'});
  assert.equal(r.dias,9);assert.equal(r.fonte,'manual');
});
test('sem manual, usa mediana do histórico real com pelo menos 3 recebimentos',()=>{
  const w=load(),h=w._pcpInternals;h.setProdutos([{cod:'100',lojaId:'L1'}]);
  const x=historico([5,6,6,7,18]);
  const r=h.resolverLeadTimeProduto('100',{produto:{cod:'100',lojaId:'L1'},agendamentos:x.ag,requisicoes:x.reqs,lojaId:'L1'});
  assert.equal(r.dias,6);assert.equal(r.fonte,'historico_fornecedor');assert.equal(r.amostras,5);assert.match(r.rotulo,/mediana de 5 recebimentos/);
});
test('histórico insuficiente cai no padrão operacional global',()=>{
  const w=load(),h=w._pcpInternals;h.setProdutos([{cod:'100',lojaId:'L1'}]);
  const x=historico([5,6]);
  const r=h.resolverLeadTimeProduto('100',{produto:{cod:'100',lojaId:'L1'},agendamentos:x.ag,requisicoes:x.reqs,lojaId:'L1'});
  assert.equal(r.dias,7);assert.equal(r.fonte,'padrao');assert.match(r.rotulo,/histórico(?:\/fornecedor)? insuficiente/);
});
test('produto produzido internamente não herda lead time de compra',()=>{
  const w=load(),h=w._pcpInternals;h.setProdutos([{cod:'100',lojaId:'L1',maquina:'M1'}]);
  const x=historico([3,4,5,6]);
  const r=h.resolverLeadTimeProduto('100',{produto:{cod:'100',lojaId:'L1',maquina:'M1'},agendamentos:x.ag,requisicoes:x.reqs,lojaId:'L1'});
  assert.equal(r.dias,7);assert.equal(r.fonte,'padrao');assert.match(r.rotulo,/produção/);
});
test('construirVisao propaga o mesmo lead time e sua origem para todas as telas consumidoras',()=>{
  const w=load(),h=w._pcpInternals;const x=historico([5,6,6,7]);
  h.setProdutos([{cod:'100',nome:'Produto 100',lojaId:'L1',metaCoberturaDias:30}]);
  const v=h.construirVisao({produtos:[{cod:'100',nome:'Produto 100',lojaId:'L1',metaCoberturaDias:30}],projecao:[{cod:'100',lojaId:'L1',venda_m1:300,venda_m2:300,venda_m3:300}],agendamentos:x.ag,requisicoes:x.reqs,lojaContexto:'L1'});
  assert.equal(v[0].leadTimeDias,6);assert.equal(v[0].leadTimeFonte,'historico_fornecedor');assert.match(v[0].leadTimeRotulo,/mediana/);
});
