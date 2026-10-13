'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'../js/analista');
const engine=fs.readFileSync(path.join(base,'120-pcp-demand-engine.js'),'utf8');
const central=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
const ficha=fs.readFileSync(path.join(base,'60-producao-ficha-tecnica.js'),'utf8');
const bluesoft=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');

function load(){
  const document={addEventListener(){},getElementById(){return null;},querySelectorAll(){return [];}};
  const window={getDTLojaAtiva:()=>''};
  const ctx={window,document,console,Date,Math,Number,String,Array,Object,Map,Set,Promise,setTimeout,clearTimeout};
  vm.runInNewContext(engine,ctx,{filename:'120-pcp-demand-engine.js'});
  vm.runInNewContext(central,ctx,{filename:'78-pcp-central.js'});
  return window;
}

function proj(loja,cod){return {lojaId:loja,cod,produto:'Produto '+cod,estoqueAtual:0,venda_m1:300,venda_m2:300,venda_m3:300,previsao_m1:300,previsao_m2:300,previsao_m3:300};}

test('visão consolidada soma necessidades calculadas por loja com parâmetros próprios',()=>{
  const w=load(),i=w._pcpInternals;
  const produtos=[
    {lojaId:'A',cod:'P1',nome:'Produto P1',metaCoberturaDias:5,loteMinimoCompra:0,multiploCompra:1},
    {lojaId:'B',cod:'P1',nome:'Produto P1',metaCoberturaDias:30,loteMinimoCompra:0,multiploCompra:1},
  ];
  const projecao=[proj('A','P1'),proj('B','P1')];
  i.setProdutos(produtos);
  const a=i.construirVisao({produtos:produtos.filter(x=>x.lojaId==='A'),projecao:projecao.filter(x=>x.lojaId==='A'),lojaContexto:'A'})[0];
  const b=i.construirVisao({produtos:produtos.filter(x=>x.lojaId==='B'),projecao:projecao.filter(x=>x.lojaId==='B'),lojaContexto:'B'})[0];
  const c=i.construirVisao({produtos,projecao})[0];
  assert.equal(c._consolidadoLojas,true);
  assert.equal(c.necessidade,a.necessidade+b.necessidade);
  assert.equal(c.estoqueAlvo,a.estoqueAlvo+b.estoqueAlvo);
  assert.ok(c.diasAlvo>5&&c.diasAlvo<30,'consolidado não escolhe arbitrariamente a meta de uma única loja');
});

test('produtos_mestre não sobrescreve parâmetros operacionais da loja',()=>{
  const w=load(),i=w._pcpInternals;
  i.setProdutos([{lojaId:'A',cod:'P2',nome:'Local',metaCoberturaDias:5,leadTimeDias:9,loteMinimoCompra:20}]);
  i.setProdutosMestre(new Map([['P2',{cod:'P2',nome:'Mestre',categoria:'CAT',metaCoberturaDias:99,leadTimeDias:88,loteMinimoCompra:777}]]));
  const p=i.resolverCadastroProduto('P2',{lojaId:'A'});
  assert.equal(p.nome,'Mestre');
  assert.equal(p.categoria,'CAT');
  assert.equal(p.metaCoberturaDias,5);
  assert.equal(p.leadTimeDias,9);
  assert.equal(p.loteMinimoCompra,20);
});

test('comprasProgramadas considera apenas saldo ainda não comprado',()=>{
  const w=load(),i=w._pcpInternals;
  const produtos=[{lojaId:'A',cod:'P3',nome:'P3',metaCoberturaDias:30}];
  const vis=i.construirVisao({produtos,projecao:[proj('A','P3')],requisicoes:[{lojaId:'A',cod:'P3',quantidade:100,quantidadeComprada:60,status:'aberta'}],lojaContexto:'A'});
  assert.equal(vis[0].comprasProgramadas,40);
});

test('memória reconhece coberturaMetaDias legado como configuração real e separa segurança configurada da usada',()=>{
  const w=load(),i=w._pcpInternals;
  i.setProdutos([{lojaId:'A',cod:'P4',nome:'P4',coberturaMetaDias:12,estoqueSeguranca:5}]);
  const passos=i.memoriaDeCalculo({key:'P4',demandaHistoricaDia:1,previsaoFuturaDia:1,consumoDia:1,estoqueAtual:1,estoqueComprometido:0,producaoProgramada:0,entradasPrevistas:0,saldo:1,leadTimeDias:7,leadTimeRotulo:'Padrão',estoqueSegurancaConfigurado:5,estoqueSeguranca:8,pontoPedido:15,diasAlvo:12,estoqueAlvo:20,necessidade:19});
  assert.match(passos.find(x=>x.passo==='Cobertura desejada').formula,/Parâmetro configurado/);
  assert.equal(passos.find(x=>x.passo==='Estoque de segurança configurado').valor,5);
  assert.equal(passos.find(x=>x.passo==='Estoque de segurança usado no cálculo').valor,8);
});

test('Ficha Técnica sincroniza cadastro mestre em importação e remove insumo que saiu da receita',()=>{
  assert.match(ficha,/_sincronizarProdutoMestreFicha/);
  assert.match(ficha,/snap\.docs\.forEach\(d=>\{if\(!desejados\.has\(d\.id\)\)ops\.push\(col\.doc\(d\.id\)\.delete\(\)\);\}\)/);
  assert.match(ficha,/await _sincronizarProdutoMestreFicha\(\{cod:f\.cod,desc:f\.desc,insumos:f\.insumos,agora\}\)/);
  assert.doesNotMatch(ficha,/produtos_mestre'[\s\S]{0,500}producaoMinima, multiploProducao, tipoMinimo, prioridadeProducao/);
});

test('reconciliação Bluesoft protege todos os parâmetros manuais adicionais do PCP',()=>{
  for(const campo of ['multiploCompra','capacidadePorCaminhao','maxCaminhoesPorEntrega','fornecedorPadrao']) assert.match(bluesoft,new RegExp("'"+campo+"'"));
});


test('Solicitação de Compra reaproveita vínculo homologado fornecedor→produto sem criar cadastro paralelo',()=>{
  const servico=fs.readFileSync(path.join(base,'compras-fornecedores-service.js'),'utf8');
  assert.match(servico,/async function listarVinculosHomologados/);
  assert.match(central,/listarVinculosHomologados/);
  assert.match(central,/vinc\?\.fornecedorNome\|\|cad\.fornecedorPadrao/);
  assert.match(central,/vinc\?\.quantidadeMinima\|\|cad\.loteMinimoCompra/);
  assert.match(central,/vinc\?\.multiplo\|\|cad\.multiploCompra/);
});
