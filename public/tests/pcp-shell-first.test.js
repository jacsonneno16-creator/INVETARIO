// PEDIDO AO VIVO (2026-10-01): "não tem como vir a estrutura e ter um
// botão ali de buscar... vim toda a estrutura, não vim o estoque" — trava
// que, nas 4 telas do PCP (Planejamento/Insumos/Solicitação de Compra em
// 78-pcp-central.js + Dashboard em 82-pcp-dashboard.js), a "casca"
// (cabeçalho, grade de KPI, cabeçalho de tabela) aparece de forma SÍNCRONA
// antes do primeiro await da busca de dados, e a pintura real (inalterada)
// sobrescreve a casca assim que os dados chegam — nunca o contrário.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const codeCentral = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');
const codeDashboard = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '82-pcp-dashboard.js'), 'utf8');

function colecaoVazia() {
  return {
    get: async () => ({ docs: [] }),
    where: () => ({ get: async () => ({ docs: [] }) }),
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }) }),
    doc: () => ({ get: async () => ({ exists: false }), set: async () => {}, collection: () => colecaoVazia() }),
  };
}

// A coleção 'lojas' é sempre o 1º await dentro de carregar() — controlar só
// ela já basta pra segurar a cadeia inteira (lojas:[] faz o resto resolver
// quase instantaneamente assim que ela libera).
function montarAmbiente() {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="page-pcp-dashboard"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.calcularProjecaoComRisco = () => [];
  win.getParametrosProducaoProjecao = () => ({});
  win.getDTLojaAtiva = () => '';
  win.showToast = () => {};
  win.confirm = () => true;
  win._currentAnalistaUser = { email: 'pcp@teste.com' };
  let resolverLojas;
  const lojasPromise = new Promise((r) => { resolverLojas = () => r({ docs: [] }); });
  win.getDTFirestore = () => ({ collection: (nome) => (nome === 'lojas' ? { get: () => lojasPromise } : colecaoVazia()) });
  win.getDTRawFirestore = () => win.getDTFirestore();
  win.DTBiPastaLocal = undefined;
  win.firebase = undefined;
  win.Chart = function (ctx, config) { return { destroy() {} }; };
  vm.runInContext(codeCentral, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  vm.runInContext(codeDashboard, dom.getInternalVMContext(), { filename: '82-pcp-dashboard.js' });
  return { win, document: win.document, resolverLojas: () => resolverLojas() };
}

test('Planejamento: casca (cabeçalho/KPIs/colunas) pinta antes dos dados, pintura real sobrescreve depois', async () => {
  const { win, document, resolverLojas } = montarAmbiente();
  win._pcpInternals.setAba('planejamento');
  const p = win.renderPCPCentral();
  const antes = document.getElementById('page-pcp-central').innerHTML;
  assert.match(antes, /kpi-grid/);
  assert.match(antes, /Pedidos pendentes/);
  assert.match(antes, /Ação recomendada/, 'cabeçalho da tabela (th fixo) já presente');
  assert.match(antes, /Carregando…/);
  assert.doesNotMatch(antes, /Nenhum produto para os filtros selecionados\./, 'ainda não é a pintura real');
  resolverLojas();
  await p;
  const depois = document.getElementById('page-pcp-central').innerHTML;
  assert.match(depois, /Nenhum produto para os filtros selecionados\./, 'desenhar() real sobrescreveu a casca');
});

test('Insumos: casca pinta antes dos dados, pintura real sobrescreve depois', async () => {
  const { win, document, resolverLojas } = montarAmbiente();
  win._pcpInternals.setAba('insumos');
  const p = win.renderPCPCentral();
  const antes = document.getElementById('page-pcp-central').innerHTML;
  assert.match(antes, /Materiais/);
  assert.match(antes, /Consumo mensal/, 'cabeçalho da tabela já presente');
  assert.match(antes, /Carregando…/);
  assert.doesNotMatch(antes, /Nenhum material para os filtros selecionados\./);
  resolverLojas();
  await p;
  const depois = document.getElementById('page-pcp-central').innerHTML;
  assert.match(depois, /Nenhum material para os filtros selecionados\./);
});

test('Solicitação de Compra: casca pinta antes dos dados, pintura real sobrescreve depois', async () => {
  const { win, document, resolverLojas } = montarAmbiente();
  win._pcpInternals.setAba('pedidos');
  const p = win.renderPCPCentral();
  const antes = document.getElementById('page-pcp-central').innerHTML;
  assert.match(antes, /Solicitadas para este mês/);
  assert.match(antes, /Alteração PCP/, 'cabeçalho da tabela já presente');
  assert.match(antes, /Carregando…/);
  assert.doesNotMatch(antes, /Nenhuma solicitação encontrada nesta visão\./);
  resolverLojas();
  await p;
  const depois = document.getElementById('page-pcp-central').innerHTML;
  assert.match(depois, /Nenhuma solicitação encontrada nesta visão\./);
});

test('Dashboard: casca pinta antes dos dados, pintura real sobrescreve depois', async () => {
  const { win, document, resolverLojas } = montarAmbiente();
  const p = win.renderPCPDashboard();
  const antes = document.getElementById('page-pcp-dashboard').innerHTML;
  assert.match(antes, /kpi-grid/);
  assert.match(antes, /Ações prioritárias/);
  assert.match(antes, /pcpd-evolucao/);
  assert.match(antes, /pcpd-compras-mes/);
  assert.match(antes, /Carregando…/);
  assert.doesNotMatch(antes, /Nenhuma ação prioritária no momento\./);
  resolverLojas();
  await p;
  const depois = document.getElementById('page-pcp-dashboard').innerHTML;
  assert.match(depois, /Nenhuma ação prioritária no momento\./);
});

test('troca de aba já carregada continua instantânea, sem casca interposta (regressão)', async () => {
  const { win, document, resolverLojas } = montarAmbiente();
  win.pcpIrParaAba('planejamento', null);
  resolverLojas();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(document.getElementById('page-pcp-central').innerHTML, /Nenhum produto para os filtros selecionados\./, 'primeira visita: casca + carregamento concluídos');
  win.pcpIrParaAba('insumos', null);
  const imediato = document.getElementById('page-pcp-central').innerHTML;
  assert.match(imediato, /Nenhum material para os filtros selecionados\./, 'troca de aba já carregada pinta o resultado real na hora');
  assert.doesNotMatch(imediato, /Carregando…/, 'não passa pela casca numa troca de aba já carregada');
});
