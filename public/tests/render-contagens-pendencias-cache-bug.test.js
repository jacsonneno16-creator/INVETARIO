'use strict';
// BUG AO VIVO REAL (2026-10-03): "Cannot read properties of null (reading
// 'get')" ao abrir a aba Pendências do Inventário (_pendProdutosEndereco,
// 31-render-contagens-pendencias.js). Causa: o cache de índice por
// endereço (_pendBaseCacheArr/_pendBaseCacheMapa) começava os dois como
// `null` — na 1ª chamada, se inv.base não for array (vira `base = null`),
// `base !== _pendBaseCacheArr` era `null !== null` = false, o cache nunca
// era inicializado, e `.get()` era chamado num Map ainda null.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '31-render-contagens-pendencias.js'), 'utf8');

function montarAmbiente() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.AnalistaStore = { getState: () => ({}) };
  win.eval(CODIGO);
  return win;
}

test('_pendProdutosEndereco: inv.base ausente/não-array na 1ª chamada da página não lança TypeError (cache começava null+null)', () => {
  const win = montarAmbiente();
  // Primeira chamada de TODA a página, exatamente como renderPendencias()
  // faz pra cada endereço da lista — inv sem .base (ainda não carregada).
  assert.doesNotThrow(() => win._pendProdutosEndereco({ id: 'inv1' }, 'A-01-01'));
  // Array.from: o array devolvido vem do realm do jsdom (criado dentro do
  // win.eval), deepEqual contra um array-literal do Node falha por não
  // serem reference-equal mesmo com valores idênticos — gotcha já
  // documentado neste projeto.
  assert.deepEqual(Array.from(win._pendProdutosEndereco({ id: 'inv1' }, 'A-01-01')), []);
});

test('_pendIndiceBase: devolve um Map utilizável mesmo quando inv.base é null/undefined', () => {
  const win = montarAmbiente();
  const indice = win._pendIndiceBase({ base: null });
  assert.ok(indice instanceof win.Map);
  assert.equal(indice.get('QUALQUER'), undefined);
});

test('_pendProdutosEndereco: com base real, agrupa os itens do endereço certo e ignora os outros', () => {
  const win = montarAmbiente();
  const inv = {
    base: [
      { endereco: 'A-01-01', codigo_produto: 'P1', descricao: 'Produto 1', quantidade: 10 },
      { endereco: 'A-01-01', codigo_produto: 'P1', descricao: 'Produto 1', quantidade: 5 },
      { endereco: 'A-02-02', codigo_produto: 'P2', descricao: 'Produto 2', quantidade: 3 },
    ],
  };
  const produtos = win._pendProdutosEndereco(inv, 'A-01-01');
  assert.equal(produtos.length, 1, 'só 1 produto distinto no endereço A-01-01');
  assert.equal(produtos[0].quantidade_total, 15, 'soma as 2 linhas do mesmo produto/endereço');
  const produtosOutroEndereco = win._pendProdutosEndereco(inv, 'A-02-02');
  assert.equal(produtosOutroEndereco.length, 1);
});

test('_pendProdutosEndereco: trocar de inventário (nova referência de base) reconstrói o índice em vez de reusar o cache antigo', () => {
  const win = montarAmbiente();
  const inv1 = { base: [{ endereco: 'A-01-01', codigo_produto: 'P1', descricao: 'Produto 1', quantidade: 1 }] };
  const inv2 = { base: [{ endereco: 'A-01-01', codigo_produto: 'P2', descricao: 'Produto 2', quantidade: 1 }] };
  const doInv1 = win._pendProdutosEndereco(inv1, 'A-01-01');
  const doInv2 = win._pendProdutosEndereco(inv2, 'A-01-01');
  assert.equal(doInv1[0].codigo, 'P1');
  assert.equal(doInv2[0].codigo, 'P2', 'índice precisa ter sido reconstruído pro novo inv.base, não reusar o do inv1');
});
