const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ws=fs.readFileSync(path.join(root,'js/analista/53-inventario-workspace-v4.js'),'utf8');
const prod=fs.readFileSync(path.join(root,'js/analista/50-inventario-classificacoes-v275.js'),'utf8');

test('Por produto existe somente no Resumo, não em Relatórios',()=>{
  assert.doesNotMatch(ws,/data-dt-inv-produto/);
  assert.match(prod,/Por Produto/);
});

test('workspace não duplica Divergências nem Histórico/Rastreabilidade do menu lateral',()=>{
  assert.doesNotMatch(ws,/data-dt-inv-page=\"recontagens\"/);
  assert.doesNotMatch(ws,/data-dt-inv-page=\"rastreabilidade\"/);
  assert.match(ws,/\['recontagens','rastreabilidade'\].*dt-inv-workspace/s);
});

test('ao alternar Resumo para Por Produto a barra superior do workspace permanece visível',()=>{
  assert.match(prod,/classList\?\.contains\('dt-inv-workspace'\)/);
});
