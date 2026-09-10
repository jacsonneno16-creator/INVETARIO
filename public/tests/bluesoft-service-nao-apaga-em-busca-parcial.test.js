'use strict';
// PEDIDO AO VIVO (2026-08-23, "ainda no pcp compras e produção ta falhando
// o api"): investigando o motivo, achado um bug de segurança real —
// sincronizarProdutosBluesoft()/sincronizarEstoqueBluesoft()/
// sincronizarInsumosBluesoft() reconciliam (APAGAM) qualquer produto já
// sincronizado antes que não voltou "nesta rodada". Antes desta correção,
// se a busca vinha PARCIAL (uma página não voltou mesmo após tentar de
// novo — ver _paginarTudo em 90-bluesoft-service.js), um produto que só
// não apareceu por causa dessa falha era confundido com "perdeu o estoque
// de verdade" e APAGADO — cada tentativa que esbarrava numa instabilidade
// da Bluesoft piorava a base em vez de só deixar de atualizar. Trava que
// a reconciliação (remoção) só roda quando a busca terminou SEM falhas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const servicoCode = fs.readFileSync(path.join(base, '90-bluesoft-service.js'), 'utf8');

function mockRawFirestore(loja) {
  return {
    collection: (nome) => {
      if (nome === 'lojas') return { doc: () => ({ get: async () => ({ exists: true, data: () => loja }), collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }) };
      if (nome === 'dt_config') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ token: 'tok', url_hml: 'https://hml.exemplo', ambiente: 'homologacao', timeout: 30 }) }) }) };
      return { doc: () => ({ get: async () => ({ exists: false }) }) };
    },
    batch: () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
  };
}
function loadServico(fetchMock, loja, firestoreMock) {
  const document = { addEventListener: () => {} };
  const window = {
    fetch: fetchMock,
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'idtoken' } }) },
    getDTRawFirestore: () => mockRawFirestore(loja),
    getDTFirestore: () => firestoreMock,
    getDTLojaAtiva: () => 'loja1',
  };
  vm.runInNewContext(servicoCode, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, URLSearchParams, JSON, AbortController, setTimeout, clearTimeout }, { filename: '90-bluesoft-service.js' });
  return window;
}
function respostaJson(status, corpo) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(corpo) }; }

test('sincronizarProdutosBluesoft: busca de estoque com falha (500 persistente numa página) NÃO apaga produto já sincronizado que simplesmente não voltou nesta rodada', async () => {
  const loja = { nome: 'Loja 1', bluesoft_loja_key: 'LK1' };
  const fetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.path.startsWith('/api/comercial/estoques')) {
      const qs = new URLSearchParams(body.path.split('?')[1] || '');
      const page = Number(qs.get('currentPage'));
      // página 0 sempre falha (500 persistente) — obterEstoqueBluesoft
      // precisa devolver .falhas não-vazio, não lançar exceção.
      if (page === 0) return respostaJson(500, { message: 'Ocorreu um erro inesperado.' });
      return respostaJson(200, { currentPage: page, pageSize: 200, data: [] });
    }
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
  };
  const excluidos = [];
  const firestoreMock = {
    collection: (nome) => {
      if (nome === 'producao_produtos') return { get: async () => ({ docs: [{ id: 'doc-existente', data: () => ({ bluesoftProdutoKey: 42, bluesoftTipoProduto: 'VENDA', cod: '42' }) }] }), doc: (id) => ({ id: id || 'novo', delete: () => excluidos.push(id) }) };
      return { get: async () => ({ docs: [] }), doc: (id) => ({ id: id || 'novo', delete: () => excluidos.push(id) }) };
    },
  };
  const w = loadServico(fetchMock, loja, firestoreMock);
  const r = await w.sincronizarProdutosBluesoft({ tipos: ['VENDA'] });
  assert.ok(r.falhas.length > 0, 'a busca de estoque falhou — isso precisa aparecer em .falhas');
  assert.equal(r.removidos, 0, 'busca incompleta nunca pode disparar remoção — o produto 42 pode muito bem ainda ter estoque de verdade');
});

test('sincronizarEstoqueBluesoft: busca incompleta não apaga producao_projecao já sincronizado', async () => {
  const loja = { nome: 'Loja 1', bluesoft_loja_key: 'LK1' };
  // Página 0 vem cheia e de verdade (totalRecebido>0 — não pode disparar o
  // fallback pra .../ficha-estoque, que mascararia a falha). Páginas
  // seguintes falham sempre (500 persistente) até esgotar as 5 rodadas sem
  // novidade — simula estoque real que só veio PARCIAL, não zero.
  const fetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.path.startsWith('/api/comercial/estoques/ficha-estoque')) return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
    if (body.path.startsWith('/api/comercial/estoques')) {
      const qs = new URLSearchParams(body.path.split('?')[1] || '');
      const page = Number(qs.get('currentPage'));
      if (page === 0) return respostaJson(200, { currentPage: 0, pageSize: 200, data: Array.from({ length: 200 }, (_, i) => ({ produtoKey: 100 + i, saldoFisico: 5 })) });
      return respostaJson(500, { message: 'Ocorreu um erro inesperado.' });
    }
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
  };
  const excluidos = [];
  const firestoreMock = {
    collection: (nome) => {
      if (nome === 'producao_projecao') return { get: async () => ({ docs: [{ id: 'proj-existente', data: () => ({ bluesoftSincronizadoEm: '2026-01-01', cod: '99' }) }] }), doc: (id) => ({ id: id || 'novo', delete: () => excluidos.push(id) }) };
      if (nome === 'producao_produtos') return { get: async () => ({ docs: [] }), doc: (id) => ({ id: id || 'novo' }) };
      return { get: async () => ({ docs: [] }), doc: (id) => ({ id: id || 'novo', delete: () => excluidos.push(id) }) };
    },
  };
  const w = loadServico(fetchMock, loja, firestoreMock);
  const r = await w.sincronizarEstoqueBluesoft({});
  assert.ok(r.falhas.length > 0);
  assert.equal(r.removidos, 0, 'produto 99 não pode sumir só porque a página 0 do estoque bateu num 500 persistente');
});

test('sincronizarProdutosBluesoft: busca SEM falhas continua reconciliando (removendo) normalmente — a trava é só pra busca incompleta', async () => {
  const loja = { nome: 'Loja 1', bluesoft_loja_key: 'LK1' };
  const fetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.path.startsWith('/api/comercial/estoques')) {
      const qs = new URLSearchParams(body.path.split('?')[1] || '');
      const page = Number(qs.get('currentPage'));
      return respostaJson(200, { currentPage: page, pageSize: 200, data: [] }); // loja sem NENHUM item relevante agora, mas SEM falha nenhuma
    }
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
  };
  const excluidos = [];
  const firestoreMock = {
    collection: (nome) => {
      if (nome === 'producao_produtos') return { get: async () => ({ docs: [{ id: 'doc-existente', data: () => ({ bluesoftProdutoKey: 42, bluesoftTipoProduto: 'VENDA', cod: '42' }) }] }), doc: (id) => ({ id: id || 'novo', delete: () => excluidos.push(id) }) };
      return { get: async () => ({ docs: [] }), doc: (id) => ({ id: id || 'novo', delete: () => excluidos.push(id) }) };
    },
  };
  const w = loadServico(fetchMock, loja, firestoreMock);
  const r = await w.sincronizarProdutosBluesoft({ tipos: ['VENDA'] });
  assert.equal(r.falhas.length, 0);
  assert.equal(r.removidos, 1, 'sem falha nenhuma, um produto que genuinamente não tem mais estoque relevante ainda precisa ser reconciliado (comportamento antigo preservado)');
});
