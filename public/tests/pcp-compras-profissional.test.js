'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('motor combina histórico e previsão e respeita múltiplo', () => {
  const context = { window:{} }; vm.createContext(context);
  vm.runInContext(read('js/analista/120-pcp-demand-engine.js'), context);
  const r = context.window.PCPDemandEngine.calculate({
    product:{leadTimeDias:10,metaCoberturaDias:30,multiploCompra:12,nivelServico:95},
    forecast:{venda_m1:310,venda_m2:300,venda_m3:310,previsao_m1:620,previsao_m2:600,previsao_m3:620},
    operational:{availableStock:100,inbound:20,production:0,committedDemand:10}
  });
  // Histórico (10/dia) e previsão (20/dia) combinados 50/50 (PEDIDO AO VIVO
  // 2026-09-07: "soma os dois resultados e divide por dois" — era 40/60).
  assert.equal(r.dailyDemand, 15);
  assert.equal(r.suggestedQuantity % 12, 0);
  assert.ok(r.targetStock > r.reorderPoint);
  assert.ok(Array.isArray(r.alerts));
});

test('motor usa os dias reais dos três meses passados e dos três meses futuros', () => {
  const context = { window:{} }; vm.createContext(context);
  vm.runInContext(read('js/analista/120-pcp-demand-engine.js'), context);
  const r = context.window.PCPDemandEngine.calculate({
    forecast:{
      venda_m1:310,venda_m2:280,venda_m3:310,
      historicoVendasMeses:['2026-07','2026-06','2026-05'],
      previsao_m1:300,previsao_m2:310,previsao_m3:300,
      previsaoMesesSelecionados:['2026-09','2026-10','2026-11']
    }
  });
  assert.deepEqual(Array.from(r.memory.historyDaily),[10,280/30,10]);
  assert.deepEqual(Array.from(r.memory.futureDaily),[10,10,10]);
});

test('PCP não renderiza, calcula nem exporta valores monetários', () => {
  const files=['78-pcp-central.js','82-pcp-dashboard.js','84-pcp-compras-acompanhamento.js','86-pcp-produto-360.js','87-pcp-alertas.js','88-pcp-relatorios.js','120-pcp-demand-engine.js'];
  const forbidden=/pre[cç]o|valorTotal|currency\s*:\s*['"]BRL|R\$/i;
  files.forEach(file=>assert.doesNotMatch(read('js/analista/'+file),forbidden,file));
});

test('Compras contém operação, análises, valores e produto 360', () => {
  const html=read('analista.html'), js=read('js/analista/121-compras-profissional.js');
  ['solicitacoes','cotacoes','pedidos','recebimentos','produtos','fornecedores','relatorios','administracao'].forEach(id=>assert.match(html,new RegExp('nav-compras-'+id)));
  assert.match(html,/Produtos 360°/); assert.match(js,/Preço médio/); assert.match(js,/Última compra/); assert.match(js,/Fornecedores/);
});

// PEDIDO AO VIVO (2026-09-02): "produtos cadastrado na produção ele nem
// tem, nem vai ter histórico de compras porque é produzido aqui" —
// completar a lista de Produtos com producao_produtos não pode trazer quem
// tem empresaProdutoraId (produzido internamente, nunca comprado).
test('página Produtos (121-compras-profissional): completa a lista com o cadastro, mas NUNCA com quem tem empresaProdutoraId', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-produtos"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const colecoes = {
    producao_produtos: [{ cod: '100', nome: 'Farinha Própria', empresaProdutoraId: 'lojaFilial' }, { cod: '200', nome: 'Especiaria do Fornecedor', fornecedorPadrao: 'Fornecedor Y' }],
  };
  const mockCol = nome => ({ get: async () => ({ docs: (colecoes[nome] || []).map((d, i) => ({ id: nome + i, data: () => d })) }), where: () => mockCol(nome) });
  win.getDTFirestore = () => ({ collection: mockCol });
  win.getDTRawFirestore = () => ({ collection: () => ({ get: async () => ({ docs: [] }) }) });
  win.temPermissao = () => true;
  win.eval(read('js/analista/121-compras-profissional.js'));
  await win.renderComprasProfissional('produtos');
  const html = win.document.getElementById('page-compras-produtos').innerHTML;
  assert.doesNotMatch(html, /Farinha Própria/, 'produzido internamente não pode aparecer na lista de Produtos de Compras');
  assert.match(html, /Especiaria do Fornecedor/, 'produto de fornecedor continua aparecendo normalmente');
});

test('nenhum módulo de Produção foi alterado durante esta entrega', () => {
  const checkpoint=path.resolve(root,'../../../../../checkpoints/pcp-compras-before-20260822');
  for(let id=62;id<=77;id++) {
    const current=fs.readdirSync(path.join(root,'js/analista')).find(f=>f.startsWith(id+'-producao-'));
    if(!current) continue;
    const before=path.join(checkpoint,'public/js/analista',current);
    if(fs.existsSync(before)) assert.equal(read('js/analista/'+current),fs.readFileSync(before,'utf8'),current);
  }
});
