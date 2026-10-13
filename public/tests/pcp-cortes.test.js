// PCP — Cortes. PEDIDO AO VIVO (2026-08-28): "eu quero uma aba de cortes,
// que mostra os cortes de todos os produtos... só puxe o total... vai
// colocar por mês. Aí quando eu clicar no mês vai mostrar tudo: a
// quantidade total de cada produto, valor, porcentagem faturada".
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/pcp-cortes.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }) };
}

function carregarPagina(mesesDocs) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-cortes"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.pcpRegistrarPagina = () => {};
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'bi_cortes_mensal' ? mockColecao(mesesDocs) : mockColecao([]) });
  win.eval(code);
  return { win, document: win.document };
}

test('Cortes: mostra o mês mais recente por padrão, com os KPIs somados', async () => {
  const meses = [
    { id: '2026-07', data: { mes: '2026-07', itens: [
      { produtoKey: '100', descricao: 'Tapioca 1kg', quantidadePedidaCx: 80, quantidadeFaturadaCx: 75, corteRoteiroCx: 5, valorPedidoTotal: 800, faturamentoRs: 750 },
      { produtoKey: '200', descricao: 'Fecula', quantidadePedidaCx: 20, quantidadeFaturadaCx: 20, corteRoteiroCx: 0, valorPedidoTotal: 200, faturamentoRs: 200 },
    ] } },
    { id: '2026-06', data: { mes: '2026-06', itens: [{ produtoKey: '100', descricao: 'Tapioca 1kg', quantidadePedidaCx: 50, quantidadeFaturadaCx: 50, corteRoteiroCx: 0, valorPedidoTotal: 500, faturamentoRs: 500 }] } },
  ];
  const { win, document } = carregarPagina(meses);
  await win.renderPCPCortes();
  const html = document.getElementById('page-pcp-cortes').innerHTML;
  assert.match(html, /Tapioca 1kg/);
  assert.match(html, /Fecula/);
  assert.match(html, />100</, 'total pedido do mês mais recente (80+20)');
  assert.match(html, /selected/, 'mês mais recente vem pré-selecionado');
  assert.match(html, /07\/2026/);
});

test('Cortes: calcula % de atingimento (faturada/pedida) por produto', async () => {
  const meses = [{ id: '2026-07', data: { mes: '2026-07', itens: [
    { produtoKey: '100', descricao: 'Tapioca 1kg', quantidadePedidaCx: 80, quantidadeFaturadaCx: 60, corteRoteiroCx: 20, valorPedidoTotal: 800, faturamentoRs: 600 },
  ] } }];
  const { win, document } = carregarPagina(meses);
  await win.renderPCPCortes();
  const html = document.getElementById('page-pcp-cortes').innerHTML;
  assert.match(html, /75(,0)?%/, '60/80 = 75%');
});

test('Cortes: trocar o mês no seletor redesenha com os itens daquele mês', async () => {
  const meses = [
    { id: '2026-07', data: { mes: '2026-07', itens: [{ produtoKey: '100', descricao: 'Produto de Julho', quantidadePedidaCx: 10, quantidadeFaturadaCx: 10, corteRoteiroCx: 0, valorPedidoTotal: 100, faturamentoRs: 100 }] } },
    { id: '2026-06', data: { mes: '2026-06', itens: [{ produtoKey: '200', descricao: 'Produto de Junho', quantidadePedidaCx: 5, quantidadeFaturadaCx: 5, corteRoteiroCx: 0, valorPedidoTotal: 50, faturamentoRs: 50 }] } },
  ];
  const { win, document } = carregarPagina(meses);
  await win.renderPCPCortes();
  document.getElementById('pcpc-mes-sel').value = '2026-06';
  document.getElementById('pcpc-mes-sel').dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-pcp-cortes').innerHTML;
  assert.match(html, /Produto de Junho/);
  assert.doesNotMatch(html, /Produto de Julho/);
});

test('Cortes: sem nenhum dado sincronizado ainda, não quebra', async () => {
  const { win, document } = carregarPagina([]);
  await win.renderPCPCortes();
  const html = document.getElementById('page-pcp-cortes').innerHTML;
  assert.match(html, /Nenhum dado sincronizado ainda/);
});

// PEDIDO AO VIVO (2026-09-18): "dar pra procurar por produto".
test('Cortes: busca por produto filtra a tabela e os KPIs, por descrição ou código', async () => {
  const meses = [{ id: '2026-07', data: { mes: '2026-07', itens: [
    { produtoKey: '100', descricao: 'Tapioca 1kg', quantidadePedidaCx: 80, quantidadeFaturadaCx: 75, corteRoteiroCx: 5, valorPedidoTotal: 800, faturamentoRs: 750 },
    { produtoKey: '200', descricao: 'Fecula de Mandioca', quantidadePedidaCx: 20, quantidadeFaturadaCx: 20, corteRoteiroCx: 0, valorPedidoTotal: 200, faturamentoRs: 200 },
  ] } }];
  const { win, document } = carregarPagina(meses);
  await win.renderPCPCortes();

  const campo = document.getElementById('pcpc-busca');
  campo.value = 'tapi';
  campo.dispatchEvent(new win.Event('input', { bubbles: true }));
  let html = document.getElementById('page-pcp-cortes').innerHTML;
  assert.match(html, /Tapioca 1kg/);
  assert.doesNotMatch(html, /Fecula de Mandioca/);
  assert.match(html, />1<\/div><div class="kpi-lbl">Produtos no mês \(filtrado\)/, 'KPI de produtos no mês também reflete o filtro');
  assert.equal(document.activeElement.id, 'pcpc-busca', 'campo de busca mantém o foco depois de redesenhar');

  document.getElementById('pcpc-busca').value = '200';
  document.getElementById('pcpc-busca').dispatchEvent(new win.Event('input', { bubbles: true }));
  html = document.getElementById('page-pcp-cortes').innerHTML;
  assert.match(html, /Fecula de Mandioca/, 'busca também bate pelo código do produto');
  assert.doesNotMatch(html, /Tapioca 1kg/);

  document.getElementById('pcpc-busca').value = 'nada-disso-existe';
  document.getElementById('pcpc-busca').dispatchEvent(new win.Event('input', { bubbles: true }));
  html = document.getElementById('page-pcp-cortes').innerHTML;
  assert.match(html, /Nenhum produto encontrado/);
});
