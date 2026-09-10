const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const pcp360Code=fs.readFileSync(path.join(base,'86-pcp-produto-360.js'),'utf8');
const pcp360=pcp360Code;
const acompanhamento=fs.readFileSync(path.join(base,'84-pcp-compras-acompanhamento.js'),'utf8');
const pcpCentral=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');

test('Produto 360° reaproveita construirVisao/memoriaDeCalculo/timeline (só busca ficha técnica direto, pra seção de Insumos)',()=>{
  assert.match(pcp360,/global\._pcpInternals\.carregar/);
  assert.match(pcp360,/internos\.construirVisao\(\{/);
  assert.match(pcp360,/internos\.memoriaDeCalculo\(item\)/);
  assert.match(pcp360,/_pcpTimelineInternals\?\.construirLinhaDoTempo/);
  assert.match(pcp360,/pcpRegistrarPagina\?\.\('produto-360'/);
  assert.match(pcp360,/producao_ficha_tecnica/);
});

// PEDIDO AO VIVO (2026-09-02): "quando eu clico em ver relatório de
// produto, tem que trazer as informações de insumos que ele usa".
test('_buscarInsumosDoProduto: cruza a ficha técnica do produto com a lista de insumos do BI (por nome normalizado)',async()=>{
  const document={addEventListener:()=>{}};
  const window={
    _pcpInternals:{norm:v=>String(v||'').trim().toLowerCase(),getInsumosBi:()=>[{produto:'BOBINA FLOCAO MILHO DA TERRINHA 800 G',estoque:64.8,unidade:'kg',coberturaDias:5.2}]},
    getDTFirestore:()=>({collection:col=>{
      assert.equal(col,'producao_ficha_tecnica');
      return {get:async()=>({docs:[{data:()=>({cod:'304',insumos:[{insumo:'Bobina Flocao Milho da Terrinha 800 g',qty:0.05},{insumo:'Insumo sem correspondência no BI',qty:1}]})}]})};
    }}),
  };
  vm.runInNewContext(pcp360Code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Promise});
  const lista=await window._pcp360Internals._buscarInsumosDoProduto('304');
  assert.equal(lista.length,2);
  const comBi=lista.find(x=>x.insumo.includes('Bobina'));
  assert.equal(comBi.bi.estoque,64.8,'casou por nome normalizado (maiúscula/minúscula não importa)');
  const semBi=lista.find(x=>x.insumo.includes('sem correspondência'));
  assert.equal(semBi.bi,null,'insumo sem match no BI não quebra, só fica sem estoque/cobertura');
});

test('Compras/Necessidades e as tabelas do PCP têm drill-down pro Produto 360°',()=>{
  assert.match(pcpCentral,/data-pcp-360="\$\{esc\(x\.key\)\}"/);
  assert.match(acompanhamento,/data-pcp-360=/);
});

test('Acompanhamento de Compras cobre todos os filtros pedidos (produto/categoria/fornecedor/status/prioridade/período/comprador/atrasadas/críticas)',()=>{
  for(const id of ['pcpca-f-produto','pcpca-f-categoria','pcpca-f-fornecedor','pcpca-f-status','pcpca-f-prioridade','pcpca-f-comprador','pcpca-f-de','pcpca-f-ate','pcpca-f-atrasadas','pcpca-f-criticas']){
    assert.match(acompanhamento,new RegExp(id));
  }
  assert.match(acompanhamento,/pcpRegistrarPagina\?\.\('compras-acompanhamento'/);
});

test('PCP · Compras/Necessidades mostra solicitado × comprado × saldo pendente',()=>{
  assert.match(pcpCentral,/solicitado-comprado/);
  assert.match(pcpCentral,/Saldo pendente/);
});

test('HTML liga as páginas novas (Acompanhamento de Compras, Produto 360°) ao setor PCP',()=>{
  assert.match(htmlCode,/id="page-pcp-compras-acompanhamento"/);
  assert.match(htmlCode,/id="page-pcp-produto-360"/);
  assert.match(htmlCode,/nav-pcp-compras-acompanhamento/);
  assert.match(htmlCode,/84-pcp-compras-acompanhamento\.js/);
  assert.match(htmlCode,/86-pcp-produto-360\.js/);
});
