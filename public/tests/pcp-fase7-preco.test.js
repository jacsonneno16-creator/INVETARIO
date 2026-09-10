const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const base=path.join(__dirname,'../js/analista');
const compras=fs.readFileSync(path.join(base,'79-compras-central.js'),'utf8');
const comprasProfissional=fs.readFileSync(path.join(base,'121-compras-profissional.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

// PEDIDO AO VIVO (2026-08-27): registrar compra migrou de "Minhas
// requisições" (79) pra "Solicitações PCP" (121-compras-profissional.js).
test('registrar compra captura preço unitário e calcula valor total',()=>{
  assert.match(comprasProfissional,/id="cp-req-preco"/);
  assert.match(comprasProfissional,/precoUnitario=Math\.max\(0,n\(document\.getElementById\('cp-req-preco'\)\?\.value\)\)/);
  assert.match(comprasProfissional,/valorTotal=precoUnitario\*quantidadeComprada/);
  assert.match(comprasProfissional,/precoUnitario,valorTotal/);
});

test('agendamento gerado pela compra também carrega o preço (base do histórico/360°)',()=>{
  assert.match(comprasProfissional,/collections\.schedules\)\.doc\('req_'\+id\)\.set\(\{[^}]*precoUnitario,valorTotal/s);
});

test('_comprasInternals promove historicoCompras/agruparHistorico pra reuso (Produto 360°, Dashboard de Compras)',()=>{
  assert.match(compras,/global\._comprasInternals\s*=\s*\{reprocessarSemComprador,historicoCompras,agruparHistorico,historicoBase,carregar,agendamentos:\(\)=>agendamentos\}/);
});

// PEDIDO AO VIVO (2026-08-27): "cotacoes" precisa estar no allowlist —
// adicionar/remover propostas de cotação e marcar "em análise" gravam
// nesse campo pelo mesmo caminho (compras-central:editar, dono da
// requisição), senão a regra do Firestore rejeitaria a escrita.
test('Firestore permite comprador gravar preço e cotações na própria requisição',()=>{
  assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['status','numeroCompra','fornecedor','quantidadeComprada','precoUnitario','valorTotal','dataPrevista','observacaoCompras','compradoEm','compradoPor','atualizadoEm','atualizadoPor','cotacoes'\]\)/);
});
