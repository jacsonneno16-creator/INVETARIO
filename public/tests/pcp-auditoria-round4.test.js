
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const central=fs.readFileSync(path.join(__dirname,'../js/analista/78-pcp-central.js'),'utf8');
const rel=fs.readFileSync(path.join(__dirname,'../js/analista/88-pcp-relatorios.js'),'utf8');
const acomp=fs.readFileSync(path.join(__dirname,'../js/analista/84-pcp-compras-acompanhamento.js'),'utf8');

test('catálogo de produto acabado propaga lote mínimo e múltiplo para a sugestão inicial',()=>{
  assert.match(central,/loteMinimoCompra:Math\.max\(0,n\(vinc\?\.quantidadeMinima\|\|cad\.loteMinimoCompra\)\),multiploCompra:Math\.max\(1,n\(vinc\?\.multiplo\|\|cad\.multiploCompra\)\|\|1\)/);
});

test('preview do lote sinaliza datas fora de ordem antes do salvar',()=>{
  assert.match(central,/return \{erro:'datas_fora_ordem'\}/);
  assert.match(central,/⚠ datas fora de ordem/);
});

test('Relatório Cenários compara necessidade operacional arredondada dos dois lados',()=>{
  assert.match(rel,/const necessidade=sugerida;/);
  assert.match(rel,/necessidadeBruta/);
});

test('Relatórios usam dados filtrados por loja e o filtro estrutural do Planejamento',()=>{
  assert.match(rel,/internos\.dadosFiltrados\?\.\(\)/);
  assert.match(rel,/internos\.filtrarProdutosPlanejaveis\?internos\.filtrarProdutosPlanejaveis\(bruta\):bruta/);
});

test('buscas do acompanhamento preservam foco após redesenhar',()=>{
  assert.match(acomp,/_redesenharBuscaPreservandoFoco/);
  assert.match(acomp,/setSelectionRange\(pos,pos\)/);
});
