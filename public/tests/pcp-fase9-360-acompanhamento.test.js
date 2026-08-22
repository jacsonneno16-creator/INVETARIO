const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const base=path.join(__dirname,'../js/analista');
const pcp360=fs.readFileSync(path.join(base,'86-pcp-produto-360.js'),'utf8');
const acompanhamento=fs.readFileSync(path.join(base,'84-pcp-compras-acompanhamento.js'),'utf8');
const pcpCentral=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');

test('Produto 360° é 100% derivado — sem coleção nova, reaproveita construirVisao/memoriaDeCalculo/timeline',()=>{
  assert.match(pcp360,/global\._pcpInternals\.carregar/);
  assert.match(pcp360,/internos\.construirVisao\(\)/);
  assert.match(pcp360,/internos\.memoriaDeCalculo\(item\)/);
  assert.match(pcp360,/_pcpTimelineInternals\?\.construirLinhaDoTempo/);
  assert.match(pcp360,/pcpRegistrarPagina\?\.\('produto-360'/);
  assert.doesNotMatch(pcp360,/fs\(\)\.collection/);
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
