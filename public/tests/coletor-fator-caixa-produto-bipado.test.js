// Bug ao vivo real (2026-10-07): bipar no Coletor um produto DIFERENTE do que
// a base esperava naquele endereço (produto errado no endereço, mas também
// vendido em caixa de 20 unidades) gravava fator_caixa:1 na contagem, em vez
// do fator real do produto bipado (20). Resultado: 48 caixas contadas viravam
// quantidade_unidades:48 (deveria ser 960), e a tela de Divergências
// comparava 48 contra os 960 esperados — "a quantidade que contei em caixa"
// nunca convertida, só porque o produto bipado não era o esperado ali.
//
// Causa raiz, em duas camadas:
// 1) produtos-service.js (catálogo global usado por DTProdutos.buscarSync)
//    descartava o campo fatorCaixa/fator_caixa ao indexar os produtos — mesmo
//    a Base de Produtos (39-base-produtos.js) gravando esse campo, ele nunca
//    chegava no resultado de buscarSync().
// 2) 08-etapas-produto-quantidade-salvamento.js só olhava o fator do item
//    ESPERADO no endereço (a.produtoAtual.fator_caixa), nunca o do produto
//    REALMENTE BIPADO — então, quando os dois eram produtos diferentes, não
//    havia de onde tirar o fator certo.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const srcProdutos = fs.readFileSync(path.join(__dirname, '../js/shared/produtos-service.js'), 'utf8');
const srcColetor = fs.readFileSync(path.join(__dirname, '../js/coletor/08-etapas-produto-quantidade-salvamento.js'), 'utf8');

test('produtos-service.js: o normalizador produto() carrega fatorCaixa/fator_caixa pro índice global (antes era descartado)', () => {
  const i = srcProdutos.indexOf('function produto(raw, id) {');
  assert.ok(i >= 0, 'função produto() não encontrada');
  const trecho = srcProdutos.slice(i, i + 2800);
  assert.match(trecho, /fatorCaixa: Math\.max\(1, Number\(raw\.fatorCaixa \|\| raw\.fator_caixa\) \|\| 1\)/);
  assert.match(trecho, /fator_caixa: Math\.max\(1, Number\(raw\.fatorCaixa \|\| raw\.fator_caixa\) \|\| 1\)/);
});

test('08-etapas-produto-quantidade-salvamento.js: _fatorCx prefere o fator do produto REALMENTE bipado (_produtoGlobal) ao do item esperado no endereço', () => {
  const iGlobal = srcColetor.indexOf('const _produtoGlobal = ');
  const iFator = srcColetor.indexOf('const _fatorCx = ');
  assert.ok(iGlobal >= 0 && iFator >= 0, 'declarações de _produtoGlobal/_fatorCx não encontradas');
  assert.ok(iGlobal < iFator, '_produtoGlobal precisa ser calculado ANTES de _fatorCx, pra poder usá-lo na prioridade do fator');
  const trecho = srcColetor.slice(iFator - 700, iFator + 300);
  assert.match(trecho, /_produtoGlobal\.encontrado \? _produtoGlobal\.fatorCaixa/);
  assert.match(trecho, /Number\.isFinite\(_fatorProdutoLido\) && _fatorProdutoLido > 0 \? _fatorProdutoLido : parseFloat\(_fatorEnderecoBruto\)/);
});

test('Coletor (arquivos tocados): continua sem optional chaining (?.) nem nullish coalescing (??) — WebView Memor K/Chromium 66 trava nisso', () => {
  assert.doesNotMatch(srcColetor, /\?\./);
  assert.doesNotMatch(srcColetor, /\?\?/);
  assert.doesNotMatch(srcProdutos, /\?\./);
  assert.doesNotMatch(srcProdutos, /\?\?/);
});
