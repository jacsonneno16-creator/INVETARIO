'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname,'../js/coletor/30-recebimento-agenda.js'),'utf8');
function ambiente(docs){
  const dom=new JSDOM(`<!doctype html><body><input id="recebimento-agenda-data"><div id="recebimento-agenda-status"></div><div id="recebimento-agenda-lista"></div></body>`,{runScripts:'outside-only'});
  const w=dom.window; const telas=[];
  w.goScreen=id=>telas.push(id);
  w.FS={collection:()=>({where:(campo,op,valor)=>({get:async()=>({docs:(docs||[]).filter(x=>x.data.dataAgendada===valor).map(x=>({id:x.id,data:()=>x.data}))})})})};
  w.eval(code);
  return {w,document:w.document,telas};
}
test('Agenda do coletor: carrega somente o dia escolhido e lista o fornecedor',async()=>{
  const {w,document}=ambiente([
    {id:'a1',data:{fornecedorNome:'Fornecedor A',dataAgendada:'2026-09-14',tipoCarga:'PALETIZADA',itensPedido:[{produto:'Produto 1',quantidadePendente:10}]}},
    {id:'a2',data:{fornecedorNome:'Fornecedor B',dataAgendada:'2026-09-15',tipoCarga:'BATIDA'}}
  ]);
  await w.carregarAgendaEntregasColetor('2026-09-14');
  const html=document.getElementById('recebimento-agenda-lista').innerHTML;
  assert.match(html,/Fornecedor A/);
  assert.doesNotMatch(html,/Fornecedor B/);
  assert.match(html,/PALETIZADA/);
});
test('Agenda do coletor: carga BATIDA usa destaque vermelho e clique revela produtos/quantidades',async()=>{
  const {w,document}=ambiente([{id:'a1',data:{fornecedorNome:'Fornecedor Batida',dataAgendada:'2026-09-14',tipoCarga:'BATIDA',itensPedido:[{produto:'Farinha',quantidadePendente:25}]}}]);
  await w.carregarAgendaEntregasColetor('2026-09-14');
  const card=document.querySelector('[data-agenda-idx="0"]');
  assert.ok(card);
  assert.match(card.getAttribute('style'),/#d92d20/);
  assert.match(card.innerHTML,/BATIDA/);
  const det=document.getElementById('agenda-det-0');
  assert.equal(det.style.display,'none');
  card.dispatchEvent(new w.Event('click',{bubbles:true}));
  assert.equal(det.style.display,'block');
  assert.match(det.innerHTML,/Farinha/);
  assert.match(det.innerHTML,/25/);
});
