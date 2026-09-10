'use strict';
/**
 * Unidade de 90-bluesoft-service.js::buscarPedidoCompraBluesoftPorNumero —
 * a busca real que a aba Agendamentos do PCP usa pra achar UM pedido pelo
 * número (filtro numeroDoPedido, confirmado no schema oficial da Bluesoft:
 * GET /api/compras/pedidos-de-compra?request=PedidoCompraConsultarRequest).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const servicoCode = fs.readFileSync(path.join(base, '90-bluesoft-service.js'), 'utf8');

function mockConfigFs() {
  return { collection: (nome) => {
    if (nome === 'lojas') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ nome: 'Loja 1', bluesoft_loja_key: 'LK1' }) }), collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }) };
    return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ token: 'tok', url_hml: 'https://hml.exemplo', ambiente: 'homologacao', timeout: 30 }) }) }) };
  } };
}

function loadServico({ fetchMock, produtosLocais = [] }) {
  const document = { addEventListener: () => {} };
  const window = {
    fetch: fetchMock,
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'idtoken' } }) },
    getDTRawFirestore: () => mockConfigFs(),
    getDTFirestore: () => ({ collection: (nome) => nome === 'producao_produtos'
      ? { get: async () => ({ docs: produtosLocais.map((p, i) => ({ id: 'p' + i, data: () => p })) }) }
      : { get: async () => ({ docs: [] }) } }),
    getDTLojaAtiva: () => 'loja1',
  };
  vm.runInNewContext(servicoCode, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, URLSearchParams, JSON, AbortController, setTimeout, clearTimeout }, { filename: '90-bluesoft-service.js' });
  return window;
}

function mockFetchPedido({ numeroPedidoEsperado, pedido, fornecedores = [] }) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.path.startsWith('/api/compras/pedidos-de-compra')) {
      const qs = new URLSearchParams(body.path.split('?')[1] || '');
      assert.equal(qs.get('numeroDoPedido'), String(numeroPedidoEsperado), 'a busca real tem que filtrar por numeroDoPedido — sem isso pagina o catálogo inteiro de pedidos só pra achar um');
      const page = Number(qs.get('currentPage'));
      const data = page === 0 ? [pedido] : [];
      return { ok: true, text: async () => JSON.stringify({ currentPage: page, pageSize: 200, data }) };
    }
    if (body.path.startsWith('/api/fornecedores')) {
      const page = Number(new URLSearchParams(body.path.split('?')[1] || '').get('currentPage'));
      return { ok: true, text: async () => JSON.stringify({ currentPage: page, pageSize: 200, data: page === 0 ? fornecedores : [] }) };
    }
    return { ok: true, text: async () => JSON.stringify({ currentPage: 0, pageSize: 200, data: [] }) };
  };
}

test('busca com numeroDoPedido, resolve nome do fornecedor e marca cadastradoNaProducao pra item já registrado', async () => {
  const pedido = {
    numeroPedido: '4521', fornecedorKey: 77, dataEntregaInicial: '2026-09-01', dataEntregaFinal: '2026-09-02', entregaPendente: true,
    itens: [{ itemPedidoKey: 1, produtoKey: 101, quantidadePedida: 50, quantidadePendente: 50 }],
  };
  const w = loadServico({
    fetchMock: mockFetchPedido({ numeroPedidoEsperado: '4521', pedido, fornecedores: [{ fornecedorKey: 77, nomeFantasia: 'Distribuidora Trigo LTDA', ativa: true }] }),
    produtosLocais: [{ cod: '101', nome: 'Farinha Especial' }],
  });
  const r = await w.buscarPedidoCompraBluesoftPorNumero('4521');
  assert.equal(r.numeroPedido, '4521');
  assert.equal(r.fornecedorNome, 'Distribuidora Trigo LTDA');
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].cadastradoNaProducao, true);
  assert.equal(r.itens[0].produtoNome, 'Farinha Especial');
  assert.equal(r.itens[0].quantidadePendente, 50);
});

test('item cujo produtoKey não existe em producao_produtos vem com cadastradoNaProducao=false', async () => {
  const pedido = { numeroPedido: '4522', fornecedorKey: 1, entregaPendente: true, itens: [{ itemPedidoKey: 1, produtoKey: 999, quantidadePedida: 5, quantidadePendente: 5 }] };
  const w = loadServico({ fetchMock: mockFetchPedido({ numeroPedidoEsperado: '4522', pedido, fornecedores: [] }), produtosLocais: [] });
  const r = await w.buscarPedidoCompraBluesoftPorNumero('4522');
  assert.equal(r.itens[0].cadastradoNaProducao, false);
  assert.equal(r.itens[0].produtoNome, null);
});

test('pedido inexistente pra este número: erro claro, não um objeto vazio silencioso', async () => {
  const wSemPedido = loadServico({
    fetchMock: async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.path.startsWith('/api/compras/pedidos-de-compra')) return { ok: true, text: async () => JSON.stringify({ currentPage: 0, pageSize: 200, data: [] }) };
      return { ok: true, text: async () => JSON.stringify({ currentPage: 0, pageSize: 200, data: [] }) };
    },
  });
  await assert.rejects(() => wSemPedido.buscarPedidoCompraBluesoftPorNumero('9999'), /não encontrado/);
});
