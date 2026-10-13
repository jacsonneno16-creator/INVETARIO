'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'../js/analista');
const engine=fs.readFileSync(path.join(base,'120-pcp-demand-engine.js'),'utf8');
const central=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
const relatorios=fs.readFileSync(path.join(base,'88-pcp-relatorios.js'),'utf8');
const p360=fs.readFileSync(path.join(base,'86-pcp-produto-360.js'),'utf8');
const i360=fs.readFileSync(path.join(base,'122-pcp-insumo-360.js'),'utf8');
const alertas=fs.readFileSync(path.join(base,'87-pcp-alertas.js'),'utf8');
const parametros=fs.readFileSync(path.join(base,'81-pcp-parametros.js'),'utf8');
const acompanhamento=fs.readFileSync(path.join(base,'84-pcp-compras-acompanhamento.js'),'utf8');
function load(){
  const document={addEventListener(){},getElementById(){return null;},querySelectorAll(){return [];}};
  const window={getDTLojaAtiva:()=>''};
  const ctx={window,document,console,Date,Math,Number,String,Array,Object,Map,Set,Promise,setTimeout,clearTimeout};
  vm.runInNewContext(engine,ctx,{filename:'120-pcp-demand-engine.js'});
  vm.runInNewContext(central,ctx,{filename:'78-pcp-central.js'});
  return window;
}
test('SKU zerado sem demanda não é crítico',()=>{
  const i=load()._pcpInternals;
  assert.equal(i.itemCriticoPlanejamento({estoqueDisponivel:0,consumoDia:0,necessidade:0,estoqueComprometido:0,leadTimeDias:7,alertasCalculo:[]}),false);
  assert.equal(i.itemCriticoPlanejamento({estoqueDisponivel:0,consumoDia:1,necessidade:0,estoqueComprometido:0,leadTimeDias:7,alertasCalculo:[]}),true);
  assert.equal(i._acaoPlanejamento({key:'SEM',estoqueDisponivel:0,consumoDia:0,necessidade:0,estoqueComprometido:0,excesso:0,leadTimeDias:7,alertasCalculo:[]}).chave,'ok');
});
test('cor de cobertura de insumo respeita meta fixa de 30 dias',()=>{
  const i=load()._pcpInternals;
  assert.equal(i.riscoCoberturaInsumo(10),'b-red');
  assert.equal(i.riscoCoberturaInsumo(20),'b-orange');
  assert.equal(i.riscoCoberturaInsumo(29),'b-yellow');
  assert.equal(i.riscoCoberturaInsumo(30),'b-green');
});
test('produção consolidada arredonda cada loja antes de somar',()=>{
  const w=load(),i=w._pcpInternals;
  i.setProdutos([
    {lojaId:'A',cod:'P1',nome:'P1',maquina:'M1',producaoMinima:100,multiploProducao:50},
    {lojaId:'B',cod:'P1',nome:'P1',maquina:'M2',producaoMinima:80,multiploProducao:20},
  ]);
  const item={key:'P1',_consolidadoLojas:true,_lojasDetalhe:[{key:'P1',lojaId:'A',necessidade:120},{key:'P1',lojaId:'B',necessidade:81}]};
  const a=i._quantidadeProducaoAjustada(item);
  assert.equal(a.quantidade,250); // 150 + 100
  assert.equal(a.necessidade,201);
  assert.equal(a.multiploTexto,'Por loja');
});
test('cenário consolidado simula loja a loja antes de consolidar',()=>{
  const w=load();
  vm.runInNewContext(relatorios,{window:w,document:{addEventListener(){},getElementById(){return null;}},console,Date,Math,Number,String,Array,Object,Map,Set,Promise,setTimeout,clearTimeout},{filename:'88-pcp-relatorios.js'});
  const item={key:'P2',produto:'P2',_consolidadoLojas:true,_lojasDetalhe:[
    {key:'P2',lojaId:'A',produto:'P2',estoqueAtual:0,estoqueComprometido:0,estoqueDisponivel:0,consumoDia:10,consumoMensal:300,previsaoMensal:300,diasAlvo:5,estoqueMinimo:0,estoqueSeguranca:0,leadTimeDias:7,eventos:[],necessidade:50},
    {key:'P2',lojaId:'B',produto:'P2',estoqueAtual:0,estoqueComprometido:0,estoqueDisponivel:0,consumoDia:10,consumoMensal:300,previsaoMensal:300,diasAlvo:30,estoqueMinimo:0,estoqueSeguranca:0,leadTimeDias:7,eventos:[],necessidade:300},
  ]};
  w._pcpInternals.setProdutos([
    {lojaId:'A',cod:'P2',nome:'P2',loteMinimoCompra:50,multiploCompra:50},
    {lojaId:'B',cod:'P2',nome:'P2',loteMinimoCompra:200,multiploCompra:200},
  ]);
  const sim=w._pcpRelatoriosInternals.aplicarCenarioItem(item,{demandaPct:0,producaoPct:0,atrasoFornecedorDias:0,coberturaDias:0});
  assert.equal(sim._consolidadoLojas,true);
  assert.equal(sim._lojasDetalhe.length,2);
  assert.equal(sim.quantidadeSugerida,sim._lojasDetalhe.reduce((sum,x)=>sum+Number(x.quantidadeSugerida||0),0));
  assert.equal(sim._lojasDetalhe[0].quantidadeSugerida%50,0);
  assert.equal(sim._lojasDetalhe[1].quantidadeSugerida%200,0);
});

test('lojaContexto filtra todos os fluxos e não mistura pedido/entrada de outra loja',()=>{
  const w=load(),i=w._pcpInternals;
  const produtos=[{lojaId:'A',cod:'PX',nome:'PX',metaCoberturaDias:30},{lojaId:'B',cod:'PX',nome:'PX',metaCoberturaDias:30}];
  const projecao=[{lojaId:'A',cod:'PX',produto:'PX',estoqueAtual:100,venda_m1:30,venda_m2:30,venda_m3:30},{lojaId:'B',cod:'PX',produto:'PX',estoqueAtual:1000,venda_m1:300,venda_m2:300,venda_m3:300}];
  const pedidos=[{lojaId:'A',cod:'PX',quantidade:10,status:'aberto'},{lojaId:'B',cod:'PX',quantidade:500,status:'aberto'}];
  const ag=[{lojaId:'A',cod:'PX',quantidade:20,quantidadeRecebida:0,status:'aberto'},{lojaId:'B',cod:'PX',quantidade:700,quantidadeRecebida:0,status:'aberto'}];
  i.setProdutos(produtos);
  const a=i.construirVisao({produtos,projecao,pedidos,agendamentos:ag,lojaContexto:'A'})[0];
  assert.equal(a.estoqueAtual,100);
  assert.equal(a.estoqueComprometido,10);
  assert.equal(a.entradasPrevistas,20);
});

test('Produto 360 filtra histórico pelo contexto de loja',()=>{ assert.match(p360,/String\(r\.lojaId\|\|r\.origemLojaId\|\|''\) === lojaContexto/); });
test('Alertas de insumo reaproveitam o cálculo BI-aware da aba de insumos',()=>{ assert.match(alertas,/_pcpProducaoInsumosInternals\?\._calcular/); assert.doesNotMatch(alertas,/const estoque = internosIns\.getEstoque/); });
test('Insumo 360 volta para a aba Insumos e usa a mesma cor da meta de 30 dias',()=>{ assert.match(i360,/pcpIrParaAba\('insumos'/); assert.match(i360,/riscoCoberturaInsumo/); });
test('Criticidade vazia aparece como não configurada',()=>{ assert.match(parametros,/Não configurada<\/span>/); assert.doesNotMatch(parametros,/esc\(c \|\| 'baixa'\)/); });
test('Acompanhamento reutiliza a mesma lista no filtro e não recalcula visão duas vezes',()=>{ assert.match(acompanhamento,/_filtradas\(todasLinhas\)/); });
test('Sugestão de produção não promete início garantido sem capacidade',()=>{ assert.match(central,/data necessária de referência/); assert.match(central,/_dataNecessariaProducao/); assert.doesNotMatch(central,/Início sugerido: próximo dia útil/); });

test('Timeline não chama saldo zero de ruptura quando não existe demanda',()=>{
  const timeline=fs.readFileSync(path.join(base,'83-pcp-timeline.js'),'utf8');
  assert.match(timeline,/saldo <= 0 && \(Number\(consumoDia\)>0 \|\| Number\(item\.estoqueComprometido\)>0 \|\| Number\(item\.necessidade\)>0\)/);
});

test('Dashboard fallback de crítico também exige demanda para estoque zerado',()=>{
  const dashboard=fs.readFileSync(path.join(base,'82-pcp-dashboard.js'),'utf8');
  assert.match(dashboard,/temDemanda/);
  assert.match(dashboard,/item\.estoqueDisponivel\s*<=\s*0\s*&&\s*temDemanda/);
});

test('Compras Acompanhamento usa o detalhe da loja da própria requisição quando a visão é consolidada',()=>{
  assert.match(acompanhamento,/_lojasDetalhe/);
  assert.match(acompanhamento,/origemLojaId/);
});
