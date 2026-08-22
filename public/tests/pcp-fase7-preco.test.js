const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const base=path.join(__dirname,'../js/analista');
const compras=fs.readFileSync(path.join(base,'79-compras-central.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

test('registrar compra captura preço unitário e calcula valor total',()=>{
  assert.match(compras,/id="comp-preco"/);
  assert.match(compras,/precoUnitario=Math\.max\(0,n\(document\.getElementById\('comp-preco'\)\?\.value\)\)/);
  assert.match(compras,/valorTotal=precoUnitario\*quantidadeComprada/);
  assert.match(compras,/precoUnitario,valorTotal/);
});

test('agendamento gerado pela compra também carrega o preço (base do histórico/360°)',()=>{
  assert.match(compras,/CAGE\)\.doc\('req_'\+id\)\.set\(\{[^}]*precoUnitario,valorTotal/s);
});

test('_comprasInternals promove historicoCompras/agruparHistorico pra reuso (Produto 360°, Dashboard de Compras)',()=>{
  assert.match(compras,/global\._comprasInternals\s*=\s*\{reprocessarSemComprador,historicoCompras,agruparHistorico,historicoBase,carregar\}/);
});

test('Firestore permite comprador gravar preço na própria requisição',()=>{
  assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['status','numeroCompra','fornecedor','quantidadeComprada','precoUnitario','valorTotal','dataPrevista','observacaoCompras','compradoEm','compradoPor','atualizadoEm','atualizadoPor'\]\)/);
});
