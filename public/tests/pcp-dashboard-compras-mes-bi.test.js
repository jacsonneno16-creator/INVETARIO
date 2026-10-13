// PEDIDO AO VIVO (2026-09-18): "Compras por mês (quantidade) parece estar
// baseado em solicitações do PCP, deveria ser no que realmente foi
// comprado" — o card do Dashboard do PCP somava quantidadeComprada de
// pcp_requisicoes_compra (preenchida manualmente pelo PCP). Agora usa o
// MESMO resumo mensal real do Dashboard de Compras
// (buscarResumoComprasDashboardBigQuery), com a quantidade de verdade.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const codeCentral = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');
const codeDashboard = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '82-pcp-dashboard.js'), 'utf8');

function colecaoVazia() { return { get: async () => ({ docs: [] }), where: () => ({ get: async () => ({ docs: [] }) }), orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }) }) }; }

async function montarAmbiente(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="page-pcp-dashboard"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.calcularProjecaoComRisco = () => [];
  win.getParametrosProducaoProjecao = () => ({});
  win.getDTLojaAtiva = () => 'loja1';
  win.showToast = () => {};
  win.confirm = () => true;
  win._currentAnalistaUser = { email: 'pcp@teste.com' };
  const colReqs = { get: async () => ({ docs: (opts.reqs || []).map((p, i) => ({ id: 'r' + i, data: () => p })) }) };
  const colSnapshots = { get: async () => ({ docs: [] }) };
  const snapshotDoc = { get: async () => ({ exists: false }), set: async () => {} };
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      pcp_requisicoes_compra: colReqs,
      pcp_snapshots_diarios: { ...colecaoVazia(), doc: () => snapshotDoc },
    }[nome] || colecaoVazia()),
  });
  win.getDTRawFirestore = () => win.getDTFirestore();
  win.DTBiPastaLocal = undefined;
  const chamadas = [];
  win.firebase = opts.semFirebase ? undefined : { app: () => ({ functions: () => ({ httpsCallable: nome => async payload => {
    chamadas.push({ nome, payload });
    if (nome === 'buscarResumoComprasDashboardBigQuery') return { data: { resumo: { porMes: opts.porMesBi || [] } } };
    return { data: {} };
  } }) }) };
  const chartsCriados = [];
  win.Chart = function (ctx, config) { chartsCriados.push(config); return { destroy() {} }; };
  vm.runInContext(codeCentral, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  vm.runInContext(codeDashboard, dom.getInternalVMContext(), { filename: '82-pcp-dashboard.js' });
  if (opts.alertas) win._pcpAlertasInternals = { calcularAlertas: async () => opts.alertas, excecoesDoProduto: () => [] };
  await win.renderPCPDashboard();
  return { win, document: win.document, chamadas, chartsCriados };
}

test('Compras por mês (quantidade): usa o histórico REAL (BigQuery), não a soma de pcp_requisicoes_compra', async () => {
  const { chamadas, chartsCriados } = await montarAmbiente({
    reqs: [{ status: 'comprada', compradoEm: '2026-09-05', quantidadeComprada: 999 }], // se o gráfico usar isso, o teste falha
    porMesBi: [{ mes: '2026-08', valor: 4000, qtd: 120 }, { mes: '2026-09', valor: 5000, qtd: 150 }],
  });
  assert.ok(chamadas.some(c => c.nome === 'buscarResumoComprasDashboardBigQuery'), 'consultou o BigQuery real');
  const comprasChart = chartsCriados.find(c => c.data && c.data.datasets && c.data.datasets[0] && c.data.datasets[0].label === 'Quantidade comprada');
  assert.ok(comprasChart, 'o gráfico de compras por mês foi desenhado');
  assert.deepEqual(Array.from(comprasChart.data.labels), ['2026-08', '2026-09']);
  assert.deepEqual(Array.from(comprasChart.data.datasets[0].data), [120, 150], 'usa qtd do BigQuery (120/150), nunca os 999 de quantidadeComprada da requisição');
});

test('Compras por mês: sem BigQuery disponível (ou falha), o gráfico fica vazio — não volta a somar a requisição do PCP', async () => {
  const { chartsCriados } = await montarAmbiente({
    reqs: [{ status: 'comprada', compradoEm: '2026-09-05', quantidadeComprada: 999 }],
    semFirebase: true,
  });
  const comprasChart = chartsCriados.find(c => c.data && c.data.datasets && c.data.datasets[0] && c.data.datasets[0].label === 'Quantidade comprada');
  assert.ok(comprasChart);
  assert.deepEqual(Array.from(comprasChart.data.labels), []);
  assert.deepEqual(Array.from(comprasChart.data.datasets[0].data), []);
});


test('Dashboard usa a lista completa da Central de Exceções, inclusive alertas que não pertencem a um item isolado', async () => {
  const { document } = await montarAmbiente({
    alertas: [{ tipo:'compra_insuficiente', cor:'orange', acao:'COMPLEMENTAR COMPRA', titulo:'COMPLEMENTAR COMPRA: Produto X', detalhe:'Solicitado 100, comprado 60.', dataAcao:'2026-09-26' }],
    porMesBi: [],
  });
  const html=document.getElementById('page-pcp-dashboard').innerHTML;
  assert.match(html,/COMPLEMENTAR COMPRA/);
  assert.match(html,/Solicitado 100, comprado 60/);
});
