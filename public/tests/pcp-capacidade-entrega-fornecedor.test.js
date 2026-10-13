'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = path.join(__dirname, '../js/analista');
const relatoriosCode = fs.readFileSync(path.join(base, '88-pcp-relatorios.js'), 'utf8');
const parametrosCode = fs.readFileSync(path.join(base, '81-pcp-parametros.js'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

function carregarRelatorios() {
  const document = { addEventListener: () => {} };
  const window = { document };
  vm.runInNewContext(relatoriosCode, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Blob: function () {}, URL: {} });
  return window._pcpRelatoriosInternals;
}

test('parâmetros tratam 2.880 como quantidade física, sem campo monetário', () => {
  assert.match(parametrosCode, /Quantidade por caminhão/);
  assert.match(parametrosCode, /capacidadePorCaminhao/);
  assert.match(parametrosCode, /maxCaminhoesPorEntrega/);
  assert.doesNotMatch(parametrosCode, /currency\s*:\s*['"]BRL|R\$/i);
  assert.match(rules, /'capacidadePorCaminhao','maxCaminhoesPorEntrega'/);
});

test('necessidades do mesmo fornecedor dividem os caminhões disponíveis no dia', () => {
  const { planejarLotesPorFornecedor } = carregarRelatorios();
  const produtos = [
    { cod: 'A', fornecedorPadrao: 'Arte Fritas', capacidadePorCaminhao: 2880, maxCaminhoesPorEntrega: 2 },
    { cod: 'B', fornecedorPadrao: 'Arte Fritas' },
  ];
  const itens = [
    { key: 'A', fornecedor: 'Arte Fritas', multiplo: 1, compras: [{ dataNecessaria: '2026-09-18', quantidadeSugerida: 35302 }] },
    { key: 'B', fornecedor: 'Arte Fritas', multiplo: 1, compras: [{ dataNecessaria: '2026-09-18', quantidadeSugerida: 4000 }] },
  ];
  const lotes = planejarLotesPorFornecedor(itens, produtos);
  assert.deepEqual({ ...lotes.get('A')[0] }, { dataNecessaria: '2026-09-18', quantidadeSugerida: 2880, ordemCompra: 0, limitada: true });
  assert.deepEqual({ ...lotes.get('B')[0] }, { dataNecessaria: '2026-09-18', quantidadeSugerida: 2880, ordemCompra: 0, limitada: true });
  assert.equal(lotes.get('A').length, 13, '35.302 unidades precisam ser quebradas em 13 caminhões de até 2.880');
  assert.ok(lotes.get('A').every(l => l.quantidadeSugerida <= 2880));
});

test('um único produto pode usar os dois caminhões quando nenhum outro produto concorre pela entrega', () => {
  const { planejarLotesPorFornecedor } = carregarRelatorios();
  const produtos = [{ cod: 'A', fornecedorPadrao: 'Arte Fritas', capacidadePorCaminhao: 2880, maxCaminhoesPorEntrega: 2 }];
  const itens = [{ key: 'A', fornecedor: 'arte fritas', multiplo: 1, compras: [{ dataNecessaria: '2026-09-18', quantidadeSugerida: 5760 }] }];
  const entregas = planejarLotesPorFornecedor(itens, produtos).get('A');
  assert.equal(entregas.length, 2);
  assert.equal(entregas[0].dataNecessaria, '2026-09-18');
  assert.equal(entregas[1].dataNecessaria, '2026-09-18');
  assert.equal(entregas[0].quantidadeSugerida + entregas[1].quantidadeSugerida, 5760);
});

test('fornecedor sem capacidade configurada mantém as compras projetadas originais', () => {
  const { planejarLotesPorFornecedor } = carregarRelatorios();
  const compras = [{ dataNecessaria: '2026-09-18', quantidadeSugerida: 35302 }];
  const entregas = planejarLotesPorFornecedor([{ key: 'A', fornecedor: 'Sem configuração', multiplo: 1, compras }], []).get('A');
  assert.equal(entregas.length, 1);
  assert.equal(entregas[0].quantidadeSugerida, 35302);
  assert.equal(entregas[0].limitada, false);
});
