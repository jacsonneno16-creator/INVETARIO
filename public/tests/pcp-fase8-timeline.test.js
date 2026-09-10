const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'83-pcp-timeline.js'),'utf8');

function load(){
  const document={addEventListener:()=>{}};
  const window={};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Map});
  return window._pcpTimelineInternals;
}

test('construirLinhaDoTempo detecta ruptura no marco em que o consumo esgota o estoque',()=>{
  const h=load();
  const item={estoqueAtual:70,consumoDia:10,estoqueMinimo:20,estoqueAlvo:300,eventos:[]};
  const marcos=h.construirLinhaDoTempo(item,90);
  const m7=marcos.find(m=>m.dia===7);
  assert.equal(m7.saldoProjetado,0);
  assert.equal(m7.estado,'ruptura');
  const m15=marcos.find(m=>m.dia===15);
  assert.ok(m15.saldoProjetado<0);
  assert.equal(m15.estado,'ruptura');
});

test('construirLinhaDoTempo aplica eventos futuros (entrada de compra) na data exata',()=>{
  const h=load();
  const hojeIso=new Date().toISOString().slice(0,10);
  // Normaliza pra meia-noite LOCAL antes de somar os dias — mesma conta que
  // a função faz internamente (hojeD.setHours(0,0,0,0)). Sem isso, o teste
  // usava a hora ATUAL (new Date(), sem zerar), e horário de Brasília
  // (UTC-3) à noite já cai no dia seguinte em UTC — o .toISOString() do
  // teste ficava um dia à frente do que a função calculava por dentro,
  // fazendo o evento "não bater" com dia nenhum. Bug de fuso do TESTE, não
  // do código (achado ao vivo, rodando às 21h de Brasília).
  const dataEm15=new Date();dataEm15.setHours(0,0,0,0);dataEm15.setDate(dataEm15.getDate()+15);
  const item={estoqueAtual:100,consumoDia:10,estoqueMinimo:10,estoqueAlvo:200,eventos:[{data:dataEm15.toISOString().slice(0,10),tipo:'entrada',delta:500}]};
  const marcos=h.construirLinhaDoTempo(item,30);
  const m15=marcos.find(m=>m.dia===15);
  // sem a entrada seria 100-150=-50; com a entrada de +500 na data exata, fica positivo e alto
  assert.ok(m15.saldoProjetado>400);
  assert.notEqual(m15.estado,'ruptura');
});

test('produtos sem estoque/consumo ficam ideal quando saldo já está no alvo',()=>{
  const h=load();
  const item={estoqueAtual:500,consumoDia:0,estoqueMinimo:50,estoqueAlvo:400,eventos:[]};
  const marcos=h.construirLinhaDoTempo(item,7);
  assert.equal(marcos[0].estado,'ideal');
});

// PEDIDO AO VIVO (2026-09-02): "a linha do tempo pode usar a escadinha pra
// saber até quando vai durar" — consumo de cada dia passa a depender do
// plano[] do MÊS em que aquele dia cai, não uma taxa fixa nos 90 dias
// inteiros (importa quando a caminhada atravessa virada de mês).
test('_consumoDiaNaData: usa o plano[] do mês em que a data cai, dividido pelos dias reais daquele mês',()=>{
  const h=load();
  // plano: Jan=310 (31 dias), Fev=280 (28 dias em ano não-bissexto)
  const item={consumoDia:999,planoEscadinha:[310,280,0,0,0,0,0,0,0,0,0,0]};
  const dataJan=new Date(2027,0,15); // ano não-bissexto
  const dataFev=new Date(2027,1,10);
  assert.equal(h._consumoDiaNaData(item,dataJan),310/31);
  assert.equal(h._consumoDiaNaData(item,dataFev),280/28);
});
test('_consumoDiaNaData: sem planoEscadinha (produto fora dos 81 do BI), cai pro consumoDia de sempre',()=>{
  const h=load();
  const item={consumoDia:12.5,planoEscadinha:null};
  assert.equal(h._consumoDiaNaData(item,new Date(2027,3,1)),12.5);
});
test('construirLinhaDoTempo: com planoEscadinha, o saldo projetado muda de ritmo quando a caminhada cruza um mês com plano diferente',()=>{
  const h=load();
  // mês atual com plano baixo (10/dia), mês seguinte com plano bem mais alto — o saldo cai mais rápido depois da virada.
  const hoje=new Date();
  const plano=new Array(12).fill(0);
  const mesAtual=hoje.getMonth(), mesSeguinte=(mesAtual+1)%12;
  const diasMesAtual=new Date(hoje.getFullYear(),mesAtual+1,0).getDate();
  plano[mesAtual]=diasMesAtual*10; // 10/dia no mês atual
  plano[mesSeguinte]=diasMesAtual*100; // consumo bem mais alto no mês seguinte
  const item={estoqueAtual:100000,estoqueMinimo:0,estoqueAlvo:0,consumoDia:10,planoEscadinha:plano,eventos:[]};
  const marcos=h.construirLinhaDoTempo(item,60);
  const antes=marcos.find(m=>m.dia===7), depois=marcos.find(m=>m.dia===60);
  const quedaAntesDaVirada=100000-antes.saldoProjetado;
  const quedaDepoisNoTotal=antes.saldoProjetado-depois.saldoProjetado;
  assert.ok(quedaDepoisNoTotal>quedaAntesDaVirada,'consumo por dia deveria ficar bem mais rápido depois de entrar no mês com plano alto');
});

// PEDIDO AO VIVO (2026-09-07): "eu queria que somasse e colocasse a data
// necessária de umas três compras futuras pros produtos que realmente vai
// precisar de compras que não são produzidos... quando o estoque for
// baixar pra vinte e nove dias, ele tem que estar chegando um pedido, pra
// ficar sempre dentro dos trinta dias. calculus de sempre três pedidos, e
// isso fosse sempre ajustável" — reaproveita a mesma caminhada de
// construirLinhaDoTempo, mas continua andando (em vez de parar em marcos
// fixos) até achar a data em que a cobertura cai pra (diasAlvo-1).
test('calcularProximasDatasCompra: acha a data em que a cobertura cai pra diasAlvo-1 e simula a chegada do pedido pra achar a próxima',()=>{
  const h=load();
  // consumoDia=10, diasAlvo=30 -> estoqueAlvo=300 (30d), gatilho=29d (saldo 290).
  // estoqueAtual=1000 -> leva 71 dias pra cair até 290 (1000-71*10=290).
  const item={estoqueAtual:1000,consumoDia:10,diasAlvo:30,estoqueAlvo:300,estoqueMinimo:0,eventos:[]};
  const compras=h.calcularProximasDatasCompra(item,3);
  assert.equal(compras.length,3,'sempre 3 compras (quando o horizonte é suficiente)');
  const hoje=new Date();hoje.setHours(0,0,0,0);
  const dataEsperada=new Date(hoje);dataEsperada.setDate(dataEsperada.getDate()+71);
  assert.equal(compras[0].dataNecessaria,dataEsperada.toISOString().slice(0,10),'1ª compra no dia 71 (quando o saldo cai a 290 = 29 dias de cobertura)');
  assert.equal(compras[0].saldoNoGatilho,290);
  assert.equal(compras[0].quantidadeSugerida,310,'repõe pro DOBRO do estoqueAlvo (600), não só até 300 — 600-290=310');
  // depois de repor pro dobro (600), o próximo gatilho (290) só chega depois
  // de consumir a "segunda metade" (310 unidades = 31 dias) — nunca um
  // intervalo de só 1 dia entre compras.
  const d1=new Date(compras[0].dataNecessaria),d2=new Date(compras[1].dataNecessaria);
  const intervaloDias=Math.round((d2-d1)/86400000);
  assert.ok(intervaloDias>=25,`intervalo entre a 1ª e a 2ª compra deveria ser perto de 30 dias (o tempo de esgotar a reposição), veio ${intervaloDias} dias`);
});

test('calcularProximasDatasCompra: sem consumo nenhum (consumoDia=0 e sem planoEscadinha), nunca trava — retorna lista vazia',()=>{
  const h=load();
  const item={estoqueAtual:100,consumoDia:0,diasAlvo:30,estoqueAlvo:300,eventos:[]};
  const compras=h.calcularProximasDatasCompra(item,3,30); // horizonte curto de propósito, só pra garantir que termina rápido
  assert.equal(compras.length,0); // deepEqual([],[]) falha aqui — array vem de outro realm (vm.runInNewContext)
});

test('calcularProximasDatasCompra: pedido pendente já conhecido (evento) atrasa a data da 1ª compra futura',()=>{
  const h=load();
  const hoje=new Date();hoje.setHours(0,0,0,0);
  const dataEntradaFutura=new Date(hoje);dataEntradaFutura.setDate(dataEntradaFutura.getDate()+10);
  const item={estoqueAtual:1000,consumoDia:10,diasAlvo:30,estoqueAlvo:300,eventos:[{data:dataEntradaFutura.toISOString().slice(0,10),tipo:'entrada',delta:500}]};
  const semEvento=h.calcularProximasDatasCompra({...item,eventos:[]},1);
  const comEvento=h.calcularProximasDatasCompra(item,1);
  assert.ok(new Date(comEvento[0].dataNecessaria)>new Date(semEvento[0].dataNecessaria),'com uma entrada de 500 já programada no meio do caminho, a 1ª compra futura precisa demorar mais pra ser necessária');
});
