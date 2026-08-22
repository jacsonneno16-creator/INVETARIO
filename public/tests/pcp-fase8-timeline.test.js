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
