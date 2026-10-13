// PEDIDO AO VIVO (2026-08-27): "compras por mês... tem que levar em conta
// a data que foi entregue. Comprou no mês 1, mas foi entregue no mês 2,
// coloca no mês 2 o valor" + "as barrinha... só tem que vir o mês e o ano,
// não precisa vir a data completa". A data real de entrega vive no
// agendamento ligado à requisição (pcp_agendamentos.recebidoEm), não na
// própria requisição de compra.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/89-compras-dashboard.js'), 'utf8');
// Arrays vindos de um window de jsdom (outro realm) nunca são reference-equal
// pro assert.deepEqual do Node, mesmo com valores idênticos — compara via
// JSON.stringify (mesmo padrão já usado no resto da suíte pra esse caso).
function assertIgual(a, b, msg) { assert.equal(JSON.stringify(a), JSON.stringify(b), msg); }

function carregarPagina(historico, agendamentos, registrosReaisBi, opts) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-dashboard"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const chamadasChart = [];
  win.Chart = function (ctx, cfg) { chamadasChart.push(cfg); return { destroy() {} }; };
  win._comprasInternals = {
    carregar: async () => {},
    historicoCompras: () => historico,
    historicoBase: () => historico,
    agruparHistorico: () => [],
    agendamentos: () => agendamentos || [],
  };
  const chamadasHistoricoBi = [];
  // PEDIDO AO VIVO (2026-08-28): "não precisa nem ser puxado direto de
  // novo... o todo já foi carregado nas outras abas" — o dashboard agora
  // reaproveita obterHistoricoComprasRealBi (101-relatorios-bi.js) em vez
  // de buscar o Firestore por conta própria.
  if (registrosReaisBi === 'ERRO') {
    win.obterHistoricoComprasRealBi = async (forcar) => { chamadasHistoricoBi.push(forcar); throw new Error('Falha de conexão simulada'); };
  } else if (registrosReaisBi) {
    win.obterHistoricoComprasRealBi = async (forcar) => { chamadasHistoricoBi.push(forcar); return registrosReaisBi; };
  }
  win.showToast = () => {};
  if (opts && opts.firebase) win.firebase = opts.firebase;
  win.eval(code);
  return { win, document, chamadasChart, chamadasHistoricoBi };
}

test('Compras por mês: usa a data de recebimento do agendamento vinculado, não a data da compra', async () => {
  const historico = [
    { _id: 'req1', compradoEm: '2026-06-15', valorTotal: 1000, quantidadeComprada: 1 },
  ];
  const agendamentos = [
    { requisicaoId: 'req1', recebidoEm: '2026-07-20T00:00:00.000Z' },
  ];
  const { win, chamadasChart } = carregarPagina(historico, agendamentos);
  await win.renderComprasDashboard('page-compras-dashboard');
  const cfgMes = chamadasChart.find(c => c.type === 'bar' && c.data.datasets[0].data.includes(1000));
  assert.ok(cfgMes, 'gráfico de compras por mês deve existir');
  assertIgual(cfgMes.data.labels, ['07/2026'], 'entrou no mês 07 (recebimento), não no mês 06 (compra)');
});

test('Compras por mês: sem agendamento vinculado, cai de volta pra data da compra', async () => {
  const historico = [{ _id: 'req2', compradoEm: '2026-05-01', valorTotal: 500, quantidadeComprada: 1 }];
  const { win, chamadasChart } = carregarPagina(historico, []);
  await win.renderComprasDashboard('page-compras-dashboard');
  const cfgMes = chamadasChart.find(c => c.type === 'bar' && c.data.datasets[0].data.includes(500));
  assertIgual(cfgMes.data.labels, ['05/2026']);
});

test('Compras por mês: rótulos do eixo são "mês/ano", nunca a data completa', async () => {
  const historico = [
    { _id: 'a', compradoEm: '2026-01-10', valorTotal: 100, quantidadeComprada: 1 },
    { _id: 'b', compradoEm: '2026-02-10', valorTotal: 200, quantidadeComprada: 1 },
  ];
  const { win, chamadasChart } = carregarPagina(historico, []);
  await win.renderComprasDashboard('page-compras-dashboard');
  const cfgMes = chamadasChart.find(c => c.type === 'bar' && c.data.datasets[0].data.length === 2);
  assertIgual(cfgMes.data.labels, ['01/2026', '02/2026']);
  cfgMes.data.labels.forEach(l => assert.doesNotMatch(l, /\d{4}-\d{2}-\d{2}/, 'não pode ser data completa'));
});

test('Compras por mês: duas compras recebidas no mesmo mês somam no mesmo rótulo', async () => {
  const historico = [
    { _id: 'req1', compradoEm: '2026-06-01', valorTotal: 300, quantidadeComprada: 1 },
    { _id: 'req2', compradoEm: '2026-06-05', valorTotal: 700, quantidadeComprada: 1 },
  ];
  const agendamentos = [
    { requisicaoId: 'req1', recebidoEm: '2026-08-01' },
    { requisicaoId: 'req2', recebidoEm: '2026-08-20' },
  ];
  const { win, chamadasChart } = carregarPagina(historico, agendamentos);
  await win.renderComprasDashboard('page-compras-dashboard');
  const cfgMes = chamadasChart.find(c => c.type === 'bar' && c.data.datasets[0].data.includes(1000));
  assertIgual(cfgMes.data.labels, ['08/2026']);
  assertIgual(cfgMes.data.datasets[0].data, [1000]);
});

// PEDIDO AO VIVO (2026-08-28): "atenção histórico de compra que você não
// está usando pra saber quanto que foi de cada mês" — segunda série no
// mesmo gráfico, vinda do histórico real de notas fiscais (compras_produto.json
// sincronizado em relatorios_bi_compras_historico_chunks), usando
// data_recebimento (mês que chegou de verdade).
test('Compras por mês: segunda série com o histórico REAL (notas fiscais), separado da requisição manual', async () => {
  const historico = [{ _id: 'req1', compradoEm: '2026-06-15', valorTotal: 1000, quantidadeComprada: 1 }];
  const registrosReaisBi = [
    { data_emissao: '2026-06-01', data_recebimento: '2026-06-05', Custo_liquido_total: 5000 },
    { data_emissao: '2026-06-10', data_recebimento: '2026-07-01', Custo_liquido_total: 3000 },
  ];
  const { win, chamadasChart } = carregarPagina(historico, [], registrosReaisBi);
  await win.renderComprasDashboard('page-compras-dashboard');
  const cfgMes = chamadasChart.find(c => c.type === 'bar' && c.data.datasets.length === 2);
  assert.ok(cfgMes, 'gráfico precisa ter as 2 séries quando há histórico real');
  const real = cfgMes.data.datasets.find(d => d.label === 'Histórico real (notas fiscais)');
  assert.ok(real, 'precisa ter a série do histórico real');
  const idxJun = cfgMes.data.labels.indexOf('06/2026'), idxJul = cfgMes.data.labels.indexOf('07/2026');
  assert.equal(real.data[idxJun], 5000, 'recebido em junho entra em junho');
  assert.equal(real.data[idxJul], 3000, 'recebido em julho entra em julho, mesmo emitido em junho');
});

test('Compras por mês: sem histórico real disponível, mostra só 1 série (não quebra)', async () => {
  const historico = [{ _id: 'req1', compradoEm: '2026-06-15', valorTotal: 1000, quantidadeComprada: 1 }];
  const { win, chamadasChart } = carregarPagina(historico, [], null);
  await win.renderComprasDashboard('page-compras-dashboard');
  const cfgMes = chamadasChart.find(c => c.type === 'bar');
  assert.equal(cfgMes.data.datasets.length, 1);
});

// PEDIDO AO VIVO (2026-08-28): "o dashboard não traz informação nenhuma"
// — os KPIs/tabelas viviam 100% de pcp_requisicoes_compra (quase sempre
// vazia). Agora usam o histórico REAL (30 mil linhas já sincronizadas)
// como fonte principal sempre que ele existir.
test('KPIs e top produtos/fornecedores usam o histórico REAL como fonte principal quando ele existe', async () => {
  const registrosReaisBi = [
    { nf_numero: 1, data_emissao: '2026-06-01', data_recebimento: '2026-06-05', produto_key: '304', descricao: 'Tapioca 1kg', quantidade_faturada: 100, custo_liq_unit: 2, Custo_liquido_total: 200, nome_abreviado: 'Fornecedor Real' },
  ];
  const { win, document, chamadasChart } = carregarPagina([], [], registrosReaisBi);
  await win.renderComprasDashboard('page-compras-dashboard');
  const html = document.getElementById('page-compras-dashboard').innerHTML;
  assert.match(html, /Tapioca 1kg/, 'top produtos precisa vir do histórico real, não da requisição manual (vazia)');
  assert.match(html, /nota\(s\) fiscal\(is\) de compra/);
  const cfgForn = chamadasChart.find(c => c.type === 'bar' && c.data.labels.includes('Fornecedor Real'));
  assert.ok(cfgForn, 'gráfico de fornecedores precisa vir do histórico real');
});

test('KPIs excluem MRO\\/Logística e transferência\\/bonificação — só conta o que é COMPRA de verdade', async () => {
  const registrosReaisBi = [
    { nf_numero: 1, data_emissao: '2026-06-01', data_recebimento: '2026-06-01', produto_key: '1', descricao: 'Parafuso', departamento: 'MRO', tipo_operacao: 'COMPRA', Custo_liquido_total: 999999, quantidade_faturada: 1 },
    { nf_numero: 2, data_emissao: '2026-06-01', data_recebimento: '2026-06-01', produto_key: '2', descricao: 'Tapioca Transferida', departamento: 'PRODUTO DE VENDA', tipo_operacao: 'TRANSFERENCIA', Custo_liquido_total: 999999, quantidade_faturada: 1 },
    { nf_numero: 3, data_emissao: '2026-06-01', data_recebimento: '2026-06-01', produto_key: '3', descricao: 'Mandioca In Natura', departamento: 'COMPRAS', tipo_operacao: 'COMPRA', Custo_liquido_total: 500, quantidade_faturada: 10 },
  ];
  const { win, document } = carregarPagina([], [], registrosReaisBi);
  await win.renderComprasDashboard('page-compras-dashboard');
  const html = document.getElementById('page-compras-dashboard').innerHTML;
  assert.doesNotMatch(html, /Parafuso/, 'MRO não pode contar como compra');
  assert.doesNotMatch(html, /Tapioca Transferida/, 'transferência não é compra de verdade');
  assert.match(html, /Mandioca In Natura/);
  assert.match(html, /500,00/, 'comprado no mês precisa ser só os 500 da compra de verdade');
});

// PEDIDO AO VIVO (2026-08-28): "mexeu mexeu e não arrumou nada" — o
// catch() antigo engolia falha de rede/permissão e mostrava "sem dados"
// sem nenhum aviso. Agora tem que aparecer um alerta visível, nunca mudo.
test('Dashboard: se a leitura do histórico real falhar (rede/permissão), mostra um aviso visível — nunca falha muda', async () => {
  const historico = [{ _id: 'req1', compradoEm: '2026-06-15', valorTotal: 1000, quantidadeComprada: 1 }];
  const { win, document } = carregarPagina(historico, [], 'ERRO');
  await win.renderComprasDashboard('page-compras-dashboard');
  const html = document.getElementById('page-compras-dashboard').innerHTML;
  assert.match(html, /não pôde ser lido agora/);
  assert.match(html, /Falha de conexão simulada/);
  // mesmo com a falha, o resto do dashboard (fallback manual) continua aparecendo
  assert.match(html, /Comprado no mês/);
});

// BUG AO VIVO REAL (2026-09-06): "clico em atualizar, a tela só pisca de
// volta as mesmas informações — o BI está atualizado mas a informação que
// mostra na tela não". O "↻ Atualizar" só relia o Firestore, nunca pedia
// pro servidor buscar de novo do BI (isso só existia na tela separada
// "Relatórios BI"). Agora o Dashboard também tem um botão que chama a
// MESMA Cloud Function.
test('"🔄 Forçar sincronização com o BI": chama sincronizarComprasHistoricoBiAgora e depois consulta o resumo pronto no BigQuery', async () => {
  const funcoesChamadas = [];
  const firebase = { app: () => ({ functions: () => ({ httpsCallable: (nome) => { funcoesChamadas.push(nome); return async () => nome === 'buscarResumoComprasDashboardBigQuery' ? ({ data: { ok: true, resumo: { nPedidos: 1, compradoNoMes: 10, compradoNoAno: 10, valorTotal: 10, porMes: [], topProdutos: [], topFornecedores: [], maisSubiram: [], maisCairam: [] } } }) : ({ data: { ok: true } }); } }) }) };
  const { win, document } = carregarPagina([], [], [{ nf_numero: 1, data_emissao: '2026-06-01', data_recebimento: '2026-06-01', Custo_liquido_total: 10 }], { firebase });
  await win.renderComprasDashboard();
  document.querySelector('[data-compd-forcar-sync]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.ok(funcoesChamadas.includes('sincronizarComprasHistoricoBiAgora'));
  assert.ok(funcoesChamadas.filter(x => x === 'buscarResumoComprasDashboardBigQuery').length >= 2, 'render inicial e pós-sync consultam o resumo agregado');
});

test('"↻ Atualizar" normal também ignora o cache em memória (nunca só pisca com o mesmo dado antigo)', async () => {
  const { win, document, chamadasHistoricoBi } = carregarPagina([], [], [{ nf_numero: 1, data_emissao: '2026-06-01', data_recebimento: '2026-06-01', Custo_liquido_total: 10 }]);
  await win.renderComprasDashboard();
  document.querySelector('[data-compd-refresh]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chamadasHistoricoBi[chamadasHistoricoBi.length - 1], true);
});
