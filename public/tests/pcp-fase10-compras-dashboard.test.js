const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const base=path.join(__dirname,'../js/analista');
const dashboard=fs.readFileSync(path.join(base,'89-compras-dashboard.js'),'utf8');
const compras=fs.readFileSync(path.join(base,'79-compras-central.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');

test('Dashboard de Compras reaproveita _comprasInternals (carregar/historicoCompras) sem consulta nova',()=>{
  assert.match(dashboard,/global\._comprasInternals\.carregar\(\)/);
  assert.match(dashboard,/internos\.historicoCompras\(\)/);
  assert.match(dashboard,/internos\.historicoBase\(\)/);
  assert.doesNotMatch(dashboard,/fs\(\)\.collection/);
});

test('Compras ganhou navegação própria pro Dashboard (comprasIrParaPagina) sem quebrar a Central existente',()=>{
  assert.match(compras,/function comprasIrParaPagina/);
  assert.match(compras,/global\.comprasIrParaPagina\s*=\s*comprasIrParaPagina/);
});

test('HTML liga o setor Compras ao Dashboard novo',()=>{
  assert.match(htmlCode,/id="page-compras-dashboard"/);
  assert.match(htmlCode,/nav-compras-dashboard/);
  assert.match(htmlCode,/comprasIrParaPagina\('dashboard',this\)/);
  assert.match(htmlCode,/89-compras-dashboard\.js/);
});
