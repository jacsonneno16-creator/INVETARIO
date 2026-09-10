const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
const dashboardCode=fs.readFileSync(path.join(base,'82-pcp-dashboard.js'),'utf8');
const timelineCode=fs.readFileSync(path.join(base,'83-pcp-timeline.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');

function load(calc=[]){const document={addEventListener:()=>{},getElementById:()=>null};const window={calcularProjecaoComRisco:()=>calc,getParametrosProducaoProjecao:()=>({}),temPermissao:()=>true};vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,confirm:()=>true,prompt:()=>null});return window._pcpInternals;}

test('construirVisao expõe diasAlvo e a necessidade bate algebricamente com estoqueAlvo-saldo',()=>{
  const h=load([{cod:'X',produto:'Produto X',estoqueNormalizado:1000,projFinal:700,projSemanal:700}]);
  const v=h.construirVisao({produtos:[{cod:'X',nome:'Produto X',metaCoberturaDias:30}],projecao:[{cod:'X',produto:'Produto X'}],pedidos:[],ops:[],agendamentos:[],requisicoes:[]})[0];
  assert.equal(v.diasAlvo,30);
  assert.equal(v.necessidade,Math.max(0,v.estoqueAlvo-v.saldo));
});

test('memoriaDeCalculo expõe os passos na mesma matemática de construirVisao (Estoque atual e Necessidade batem)',()=>{
  const h=load([{cod:'X',produto:'Produto X',estoqueNormalizado:1000,projFinal:700,projSemanal:700}]);
  const v=h.construirVisao({produtos:[{cod:'X',nome:'Produto X',metaCoberturaDias:30}],projecao:[{cod:'X',produto:'Produto X'}],pedidos:[],ops:[],agendamentos:[],requisicoes:[]})[0];
  const passos=h.memoriaDeCalculo(v);
  assert.equal(passos.find(p=>p.passo==='Estoque atual').valor,v.estoqueAtual);
  assert.equal(passos.find(p=>p.passo==='= Saldo projetado').valor,v.saldo);
  assert.equal(passos.find(p=>p.passo==='= Necessidade').valor,v.necessidade);
});

test('PCP tem Dashboard e Linha do Tempo ligados ao registro dinâmico de páginas, sidebar e rules do snapshot',()=>{
  assert.match(dashboardCode,/pcpRegistrarPagina\?\.\('dashboard'/);
  assert.match(timelineCode,/pcpRegistrarPagina\?\.\('timeline'/);
  assert.match(rules,/match \/pcp_snapshots_diarios/);
  assert.match(htmlCode,/id="page-pcp-dashboard"/);
  assert.match(htmlCode,/id="page-pcp-timeline"/);
  assert.match(htmlCode,/82-pcp-dashboard\.js/);
  assert.match(htmlCode,/83-pcp-timeline\.js/);
  assert.match(htmlCode,/id="pcp-modal-host"/);
});
