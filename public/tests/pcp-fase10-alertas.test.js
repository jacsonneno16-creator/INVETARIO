const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'87-pcp-alertas.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');

function load(mockInternals){
  const document={addEventListener:()=>{}};
  const window={_pcpInternals:mockInternals,pcpRegistrarPagina:()=>{}};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Map,Set});
  return window;
}

test('calcularAlertas detecta sem estoque, compra atrasada e compra insuficiente, ordenados por severidade',async()=>{
  const w=load({
    carregar:async()=>{},
    construirVisao:()=>[{key:'X',produto:'Produto X',estoqueAtual:0,coberturaDias:null,coberturaProjetadaDias:null,diasAlvo:10}],
    getReqs:()=>[{prodKey:'X',produto:'Produto X',status:'comprada',quantidade:100,quantidadeComprada:50}],
    getAgend:()=>[{produto:'Produto X',dataPrevista:'2020-01-01',status:'prevista'}],
    keyOf:x=>String(x.prodKey||x.cod||''),
  });
  const alertas=await w._pcpAlertasInternals.calcularAlertas();
  assert.ok(alertas.some(a=>a.tipo==='sem_estoque'));
  assert.ok(alertas.some(a=>a.tipo==='compra_atrasada'));
  assert.ok(alertas.some(a=>a.tipo==='compra_insuficiente'));
  assert.equal(alertas[0].cor,'red');
});

test('calcularAlertas fica vazio quando não há nenhum problema',async()=>{
  const w=load({
    carregar:async()=>{},
    construirVisao:()=>[{key:'Y',produto:'Produto Y',estoqueAtual:500,coberturaDias:30,coberturaProjetadaDias:30,diasAlvo:10}],
    getReqs:()=>[],
    getAgend:()=>[],
    keyOf:x=>String(x.prodKey||x.cod||''),
  });
  const alertas=await w._pcpAlertasInternals.calcularAlertas();
  assert.equal(alertas.length,0);
});

test('Alertas do PCP estão registrados dinamicamente e clicáveis',()=>{
  assert.match(code,/pcpRegistrarPagina\?\.\('alertas'/);
  assert.match(code,/data-pcpal-ir/);
  assert.match(code,/pcpIrParaAba\?\./);
  assert.match(htmlCode,/id="page-pcp-alertas"/);
  assert.match(htmlCode,/87-pcp-alertas\.js/);
});
