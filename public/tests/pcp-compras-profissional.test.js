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

function _mockColVazio() { return { get: async () => ({ docs: [] }), where: () => _mockColVazio() }; }
function _carregarPaginaProdutos(win, { resumoProdutos, historicoLinhas } = {}) {
  win.getDTFirestore = () => ({ collection: () => _mockColVazio() });
  win.getDTRawFirestore = () => ({ collection: () => _mockColVazio() });
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com', nome: 'Comprador' };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => {
    if (nome === 'buscarResumoProdutosComprasBigQuery') return { data: { produtos: resumoProdutos || [] } };
    if (nome === 'buscarHistoricoComprasBigQuery') return { data: { linhas: historicoLinhas || [] } };
    return { data: {} };
  } }) }) };
  win.eval(read('js/analista/121-compras-profissional.js'));
}

// PEDIDO AO VIVO (2026-09-18): "só mostra produto de produção, não mostra
// matéria-prima comprada... os números têm que ser do arquivo real, não da
// solicitação do PCP" — Produtos 360° agora lista TUDO que já foi comprado
// de verdade (histórico real, BigQuery), matéria-prima/embalagem inclusos,
// nunca mais depende de estar cadastrado em Produção nem de ter passado
// pela solicitação manual do PCP.
test('página Produtos (121-compras-profissional): lista vem do histórico REAL de compras (BigQuery) — matéria-prima/embalagem aparecem normalmente', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-produtos"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _carregarPaginaProdutos(win, { resumoProdutos: [
    { produtoKey: '200', descricao: 'Especiaria do Fornecedor', numCompras: 4, ultimaData: '2026-09-10', ultimoFornecedor: 'Fornecedor Y', ultimoPreco: 12.5 },
    { produtoKey: '300', descricao: 'Embalagem Plástica 1kg', numCompras: 9, ultimaData: '2026-09-12', ultimoFornecedor: 'Embalagens SA', ultimoPreco: 0.8 },
  ] });
  await win.renderComprasProfissional('produtos');
  const html = win.document.getElementById('page-compras-produtos').innerHTML;
  assert.match(html, /Especiaria do Fornecedor/);
  assert.match(html, /Embalagem Plástica 1kg/, 'matéria-prima/embalagem comprada aparece — não fica restrito a produto "de produção"');
  assert.match(html, /12,50/);
});

test('página Produtos: erro ao consultar o BigQuery mostra a falha, não finge lista vazia', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-produtos"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTFirestore = () => ({ collection: () => _mockColVazio() });
  win.getDTRawFirestore = () => ({ collection: () => _mockColVazio() });
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1' };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: () => async () => { throw new Error('BigQuery indisponível'); } }) }) };
  win.eval(read('js/analista/121-compras-profissional.js'));
  await win.renderComprasProfissional('produtos');
  assert.match(win.document.getElementById('page-compras-produtos').innerHTML, /BigQuery indisponível/);
});

// PEDIDO AO VIVO (2026-09-18): "cada comprador só vai poder pesquisar os
// seus produtos... isso vai servir pra tudo dentro da parte de compras" —
// Produtos 360° manda o filtro de comprador pro PRÓPRIO BigQuery (lista E
// detalhe), não só esconde depois no navegador.
test('Produtos 360°: lista e detalhe mandam o filtro de comprador pro BigQuery (lista) e usam produtoKey exato (detalhe)', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-produtos"></div><div id="setor-compras-shell"><div class="nav-item on" id="nav-compras-produtos"></div></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTFirestore = () => ({ collection: () => _mockColVazio() });
  win.getDTRawFirestore = () => ({ collection: () => _mockColVazio() });
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1' };
  win.DT_USUARIO_ACESSO_ATUAL = { papelCompras: 'comprador', nome: 'Fabricio Silva' };
  const chamadas = [];
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async payload => {
    chamadas.push({ nome, payload });
    if (nome === 'buscarResumoProdutosComprasBigQuery') return { data: { produtos: [{ produtoKey: '200', descricao: 'Especiaria do Fornecedor', numCompras: 1, ultimaData: '2026-09-10', ultimoFornecedor: 'F', ultimoPreco: 1 }] } };
    if (nome === 'buscarHistoricoComprasBigQuery') return { data: { linhas: [] } };
    return { data: {} };
  } }) }) };
  win.eval(read('js/analista/121-compras-profissional.js'));
  await win.renderComprasProfissional('produtos');
  const listaCall = chamadas.find(c => c.nome === 'buscarResumoProdutosComprasBigQuery');
  assert.deepEqual(Array.from(listaCall.payload.compradores || []), ['fabricio silva']);

  win.comprasSetProduto('200');
  await new Promise(r => setTimeout(r, 0));
  const detalheCall = chamadas.find(c => c.nome === 'buscarHistoricoComprasBigQuery');
  assert.equal(detalheCall.payload.produtoKey, '200', 'detalhe busca por produtoKey exato, nunca por texto solto');
  assert.deepEqual(Array.from(detalheCall.payload.compradores || []), ['fabricio silva']);
});

// BUG AO VIVO REAL (2026-09-18): "apareceu uma setinha pra voltar" e "tenho
// que clicar de novo pra continuar digitando" — Produtos 360° não tinha
// botão de voltar (só dava pra sair clicando na aba de novo), e a busca
// perdia o foco a cada letra digitada (render() reconstrói o innerHTML
// inteiro, inclusive o próprio campo de busca).
test('Produtos 360°: tem botão de voltar pra lista, e a busca mantém o foco depois de cada letra digitada', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-produtos"></div><div id="setor-compras-shell"><div class="nav-item on" id="nav-compras-produtos"></div></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _carregarPaginaProdutos(win, { resumoProdutos: [{ produtoKey: '200', descricao: 'Especiaria do Fornecedor', numCompras: 4, ultimaData: '2026-09-10', ultimoFornecedor: 'Fornecedor Y', ultimoPreco: 12.5 }], historicoLinhas: [] });
  await win.renderComprasProfissional('produtos');

  win.comprasSetProduto('200');
  await new Promise(r => setTimeout(r, 0));
  let html = win.document.getElementById('page-compras-produtos').innerHTML;
  assert.match(html, /data-cp-produto-voltar/, 'entrando no 360° do produto, o botão de voltar aparece');

  win.document.querySelector('[data-cp-produto-voltar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  html = win.document.getElementById('page-compras-produtos').innerHTML;
  assert.doesNotMatch(html, /data-cp-produto-voltar/, 'clicar em voltar sai do 360° e volta pra lista');
  assert.match(html, /Especiaria do Fornecedor/, 'lista de produtos aparece de novo');

  const campo = win.document.querySelector('[data-cp-search]');
  campo.value = 'esp';
  campo.dispatchEvent(new win.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win.document.activeElement.getAttribute('data-cp-search') != null, true, 'campo de busca continua com o foco depois de digitar');
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

// PEDIDO AO VIVO (2026-09-18): "reconstrua usando os arquivos reais de BI
// que já existem hoje — a integração BlueSoft não vai acontecer" —
// Relatórios de Compras era um placeholder estático (KPIs zerados, aviso
// de "Próximas integrações BlueSoft"); agora reaproveita a MESMA consulta
// do Dashboard de Compras (buscarResumoComprasDashboardBigQuery), em
// formato tabular/detalhado.
test('Relatórios de Compras: mostra indicadores reais (BigQuery), não mais o placeholder estático de BlueSoft', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-relatorios"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const _mockColVazio = () => ({ get: async () => ({ docs: [] }), where: () => _mockColVazio() });
  win.getDTFirestore = () => ({ collection: () => _mockColVazio() });
  win.getDTRawFirestore = () => ({ collection: () => _mockColVazio() });
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1' };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  const resumo = {
    compradoNoMes: 5000, compradoNoAno: 60000, nPedidos: 12, valorTotal: 60000,
    porMes: [{ mes: '2026-09', valor: 5000 }, { mes: '2026-08', valor: 4000 }],
    topFornecedores: [{ fornecedor: 'Ebrali Embalagens', qtd: 100, valor: 3000 }],
    topProdutos: [{ produto: 'Fita Adesiva', qtd: 50, valor: 1000 }],
    maisSubiram: [{ produto: 'Farofa', variacaoPct: 12.5 }],
    maisCairam: [{ produto: 'Tapioca', variacaoPct: -8 }],
  };
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => nome === 'buscarResumoComprasDashboardBigQuery' ? { data: { resumo } } : { data: {} } }) }) };
  win.eval(read('js/analista/121-compras-profissional.js'));
  await win.renderComprasProfissional('relatorios');
  const html = win.document.getElementById('page-compras-relatorios').innerHTML;
  assert.doesNotMatch(html, /Próximas integrações BlueSoft/, 'placeholder antigo não pode mais aparecer');
  assert.match(html, /5\.000,00|5000,00/);
  assert.match(html, /Ebrali Embalagens/);
  assert.match(html, /Fita Adesiva/);
  assert.match(html, /Farofa/);
  assert.match(html, /12,5%/);
  assert.match(html, /Tapioca/);
  assert.match(html, /09\/2026/);
});

test('Relatórios de Compras: manda o filtro de comprador (papel comprador/gerente) pro mesmo BigQuery do Dashboard', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-relatorios"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const _mockColVazio = () => ({ get: async () => ({ docs: [] }), where: () => _mockColVazio() });
  win.getDTFirestore = () => ({ collection: () => _mockColVazio() });
  win.getDTRawFirestore = () => ({ collection: () => _mockColVazio() });
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1' };
  win.DT_USUARIO_ACESSO_ATUAL = { papelCompras: 'comprador', nome: 'Fabricio Silva' };
  let payloadRecebido = null;
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async payload => { if (nome === 'buscarResumoComprasDashboardBigQuery') payloadRecebido = payload; return { data: { resumo: {} } }; } }) }) };
  win.eval(read('js/analista/121-compras-profissional.js'));
  await win.renderComprasProfissional('relatorios');
  assert.deepEqual(Array.from(payloadRecebido.compradores || []), ['fabricio silva']);
});

test('Relatórios de Compras: falha ao consultar mostra o erro (não finge KPI zerado)', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-relatorios"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const _mockColVazio = () => ({ get: async () => ({ docs: [] }), where: () => _mockColVazio() });
  win.getDTFirestore = () => ({ collection: () => _mockColVazio() });
  win.getDTRawFirestore = () => ({ collection: () => _mockColVazio() });
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1' };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: () => async () => { throw new Error('BigQuery indisponível'); } }) }) };
  win.eval(read('js/analista/121-compras-profissional.js'));
  await win.renderComprasProfissional('relatorios');
  assert.match(win.document.getElementById('page-compras-relatorios').innerHTML, /BigQuery indisponível/);
});
