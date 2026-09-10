// PEDIDO AO VIVO (2026-08-28): "nem vai chamar mais cálculo, coloca lá
// outro nome, relatório do produto... vai mostrar todo esse resumo" —
// a antiga "Memória de Cálculo" vira "Relatório do Produto" e ganha o
// histórico de cortes/faturamento por mês (mesmo cache da aba Cortes).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');

function colecaoVazia() { return { get: async () => ({ docs: [] }), where: () => ({ get: async () => ({ docs: [] }) }) }; }

async function montarAmbiente({ produtosCadastrados = [], historicoCortes } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.calcularProjecaoComRisco = () => [];
  win.getParametrosProducaoProjecao = () => ({});
  win.getDTLojaAtiva = () => 'loja1';
  win.showToast = () => {};
  win._currentAnalistaUser = { email: 'pcp@teste.com' };
  win.getDTFirestore = () => ({
    collection: (nome) => nome === 'producao_produtos'
      ? { get: async () => ({ docs: produtosCadastrados.map((p, i) => ({ id: 'p' + i, data: () => p })) }) }
      : colecaoVazia(),
  });
  win.getDTRawFirestore = () => ({ collection: () => colecaoVazia() });
  win._pcpCortesInternals = { buscarHistoricoProduto: async (produtoKey) => (historicoCortes || []).filter(h => String(h.produtoKey) === String(produtoKey)) };
  vm.runInContext(code, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  await win.renderPCPCentral();
  return { win };
}

test('Relatório do Produto: título não fala mais "Memória de cálculo", mostra o histórico de cortes/faturamento', async () => {
  const { win } = await montarAmbiente({
    produtosCadastrados: [{ cod: '100', nome: 'Tapioca 1kg', metaCoberturaDias: 10 }],
    historicoCortes: [
      { mes: '2026-07', produtoKey: '100', quantidadePedidaCx: 80, quantidadeFaturadaCx: 60, corteRoteiroCx: 20, faturamentoRs: 600 },
      { mes: '2026-06', produtoKey: '100', quantidadePedidaCx: 50, quantidadeFaturadaCx: 50, corteRoteiroCx: 0, faturamentoRs: 500 },
    ],
  });
  win.pcpIrParaAba('estoque');
  win.document.querySelector('[data-pcp-filtro-check="ocultarZerados"]').checked = false;
  win.document.querySelector('[data-pcp-filtro-check="ocultarZerados"]').dispatchEvent(new win.Event('change', { bubbles: true }));
  const key = win.document.querySelector('[data-pcp-memoria]')?.dataset.pcpMemoria;
  assert.ok(key, 'precisa existir ao menos um produto com botão de relatório');
  await win.modalMemoria(key);
  const html = win.document.getElementById('pcp-modal-host').innerHTML;
  assert.match(html, /Relatório do Produto/);
  assert.doesNotMatch(html, /Memória de cálculo/i);
  assert.match(html, /Cortes por mês/);
  assert.match(html, /07\/2026/);
  assert.match(html, /75(,0)?%/, '60/80 = 75% de atingimento em julho');
  assert.match(html, /06\/2026/);
});

test('Relatório do Produto: sem histórico de cortes pra esse produto, não mostra a seção (mas não quebra)', async () => {
  const { win } = await montarAmbiente({
    produtosCadastrados: [{ cod: '999', nome: 'Produto Sem Corte', metaCoberturaDias: 10 }],
    historicoCortes: [],
  });
  win.pcpIrParaAba('estoque');
  win.document.querySelector('[data-pcp-filtro-check="ocultarZerados"]').checked = false;
  win.document.querySelector('[data-pcp-filtro-check="ocultarZerados"]').dispatchEvent(new win.Event('change', { bubbles: true }));
  const key = win.document.querySelector('[data-pcp-memoria]')?.dataset.pcpMemoria;
  await win.modalMemoria(key);
  const html = win.document.getElementById('pcp-modal-host').innerHTML;
  assert.match(html, /Relatório do Produto/);
  assert.doesNotMatch(html, /Cortes por mês/);
});

test('Relatório do Produto: tooltip do botão também foi atualizado', () => {
  assert.doesNotMatch(code, /Ver memória de cálculo/);
  assert.match(code, /Ver relatório do produto/);
});
