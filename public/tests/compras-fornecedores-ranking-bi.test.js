// PEDIDO AO VIVO (2026-08-28): "ranking de fornecedores que você não
// aplicou lá no Compras" — bi_fornecedores_agregado (sincronizado pelo
// servidor a partir de fornecedores_agregado.json) passa a aparecer de
// verdade na aba Fornecedores, além da tabela derivada de requisição
// manual que já existia (não substitui, complementa).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/121-compras-profissional.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }), doc: () => ({ set: async () => {} }), where: () => ({ get: async () => ({ docs: [] }) }) };
}

function carregarPagina(fornecedoresBi) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-fornecedores"></div><div id="nav-compras-fornecedores" class="nav-item on"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.showToast = () => {};
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com' };
  win.getDTFirestore = () => ({ collection: () => mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'bi_fornecedores_agregado' ? mockColecao(fornecedoresBi) : mockColecao([]) });
  win.eval(code);
  return { win, document: win.document };
}

test('Fornecedores: mostra o ranking real vindo do BI (materia-prima e produto acabado), ordenado por valor', async () => {
  const fornecedoresBi = [
    { id: 'materia_prima_2026', data: { categoria: 'materia_prima', ano: '2026', top: [{ f: '2JM AMIDOS', valor: 36469509, kg: 13946096, caixas: 0 }, { f: 'TERRAFEC', valor: 27767071, kg: 10519299, caixas: 0 }] } },
    { id: 'produto_acabado_2026', data: { categoria: 'produto_acabado', ano: '2026', top: [{ f: 'OKKER', valor: 500000, kg: 1000, caixas: 200 }] } },
  ];
  const { win, document } = carregarPagina(fornecedoresBi);
  await win.renderComprasProfissional('fornecedores');
  const html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.match(html, /Ranking real de fornecedores/);
  assert.match(html, /2JM AMIDOS/);
  assert.match(html, /Matéria-prima/);
  assert.match(html, /OKKER/);
  assert.match(html, /Produto acabado/);
  // ordenado por valor dentro do mesmo ano: 2JM (36M) antes de TERRAFEC (27M)
  assert.ok(html.indexOf('2JM AMIDOS') < html.indexOf('TERRAFEC'));
});

test('Fornecedores: sem dado do BI, não mostra a seção de ranking (mas a tabela manual continua)', async () => {
  const { win, document } = carregarPagina([]);
  await win.renderComprasProfissional('fornecedores');
  const html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.doesNotMatch(html, /Ranking real de fornecedores/);
  assert.match(html, /Compras registradas manualmente/);
});

// PEDIDO AO VIVO (2026-08-28): "a quantidade que usa de cada insumo, você
// não aplicou" — bi_consumo_insumos_resumo cruzado no Produto 360°.
test('Produto 360°: mostra "Consumo médio mensal (BI)" quando o código do produto bate com bi_consumo_insumos_resumo', async () => {
  const dom = new (require('jsdom').JSDOM)('<!doctype html><html><body><div id="page-compras-produtos"></div><div id="nav-compras-produtos" class="nav-item on"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.showToast = () => {};
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com' };
  const requests = mockColecao([{ id: 'r1', data: { produto: 'Farinha de Trigo', prodKey: '500', quantidadeComprada: 10, precoUnitario: 2, valorTotal: 20, compradoEm: '2026-08-01', fornecedor: 'F1' } }]);
  win.getDTFirestore = () => ({ collection: (nome) => nome === 'pcp_requisicoes_compra' ? requests : mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'bi_consumo_insumos_resumo' ? mockColecao([{ id: '500', data: { sku: '500', produto: 'Farinha', mediaMensal: 850.5 } }]) : mockColecao([]) });
  win.eval(code);
  await win.renderComprasProfissional('produtos');
  win.comprasSetProduto('500');
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const html = dom.window.document.getElementById('page-compras-produtos').innerHTML;
  assert.match(html, /Consumo médio mensal \(BI\)/);
  assert.match(html, /850,5/);
});

// PEDIDO AO VIVO (2026-08-28): "nos produtos também quando vão circular no
// compras lá... ele vai mostrar todo esse resumo" — o Produto 360° do
// Compras reaproveita o mesmo _pcpCortesInternals da aba Cortes do PCP.
test('Produto 360° (Compras): mostra "Cortes e faturamento por mês" quando o código bate com o histórico do PCP', async () => {
  const dom = new (require('jsdom').JSDOM)('<!doctype html><html><body><div id="page-compras-produtos"></div><div id="nav-compras-produtos" class="nav-item on"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.showToast = () => {};
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com' };
  const requests = mockColecao([{ id: 'r1', data: { produto: 'Tapioca 1kg', prodKey: '304', quantidadeComprada: 10, precoUnitario: 2, valorTotal: 20, compradoEm: '2026-08-01', fornecedor: 'F1' } }]);
  win.getDTFirestore = () => ({ collection: (nome) => nome === 'pcp_requisicoes_compra' ? requests : mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: () => mockColecao([]) });
  win._pcpCortesInternals = { buscarHistoricoProduto: async (produtoKey) => produtoKey === '304' ? [{ mes: '2026-07', produtoKey: '304', quantidadePedidaCx: 80, quantidadeFaturadaCx: 60, corteRoteiroCx: 20, faturamentoRs: 600 }] : [] };
  win.eval(code);
  await win.renderComprasProfissional('produtos');
  win.comprasSetProduto('304');
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const html = dom.window.document.getElementById('page-compras-produtos').innerHTML;
  assert.match(html, /Cortes e faturamento por mês/);
  assert.match(html, /07\/2026/);
  assert.match(html, /75(,0)?%/);
});
