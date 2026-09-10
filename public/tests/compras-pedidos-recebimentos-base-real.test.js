// PEDIDO AO VIVO (2026-08-27): "em pedidos... elas têm que mostrar os
// pedidos que vêm da base, da pasta lá — não pedidos do PCP. Os pedidos do
// PCP vai mostrar lá em solicitações PCP" + "em agendamento vai ficar todos
// os pedidos mostrando os que está agendado e os que não está agendado" —
// Pedidos e Recebimentos passam a ler de recebimento_agendamentos (BI:
// compras_a_receber.json), nunca de pcp_requisicoes_compra (essa é só de
// Solicitações PCP).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/121-compras-profissional.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, set: async () => {} }),
    where: () => ({ get: async () => ({ docs: [] }) }),
    _registro: registro,
  };
}

function carregarPagina(pagina, colecoes) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="page-compras-${pagina}"></div><div id="nav-compras-${pagina}" class="nav-item on"></div></body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.showToast = () => {};
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com', nome: 'Comprador' };
  const cols = {
    pcp_requisicoes_compra: colecoes.requests || mockColecao([]),
    producao_produtos: mockColecao([]),
    pcp_agendamentos: mockColecao([]),
    compras_regras_comprador: mockColecao([]),
    recebimento_agendamentos: colecoes.receiptAgenda || mockColecao([]),
  };
  win.getDTFirestore = () => ({ collection: (nome) => cols[nome] || mockColecao([]) });
  win.eval(code);
  return { win, document, cols };
}

test('Pedidos: mostra os pedidos vindos da base (recebimento_agendamentos), agrupados por número de pedido', async () => {
  const receiptAgenda = mockColecao([{ id: 'p1', data: {
    numeroPedido: '555', fornecedorNome: 'Fornecedor Alfa', compradorNome: 'João (ERP)',
    dataPrevista: '2026-09-05', dataEntregaFinal: '2026-09-10', dataAgendada: '',
    itensPedido: [{ produto: 'Farinha de Trigo', quantidadePendente: 200 }, { produto: 'Fécula', quantidadePendente: 50 }],
  } }]);
  const { win, document } = carregarPagina('pedidos', { receiptAgenda });
  await win.renderComprasProfissional('pedidos');
  const html = document.getElementById('page-compras-pedidos').innerHTML;
  assert.match(html, /555/);
  assert.match(html, /Fornecedor Alfa/);
  assert.match(html, /João \(ERP\)/);
  assert.match(html, /2 itens/);
  assert.match(html, /Aguardando agendamento/);
});

test('Pedidos: requisição do PCP (pcp_requisicoes_compra) NUNCA aparece aqui — só em Solicitações PCP', async () => {
  const requests = mockColecao([{ id: 'r1', data: { produto: 'Produto do PCP', quantidade: 10, status: 'solicitada', numeroCompra: 'DO-PCP-1' } }]);
  const { win, document } = carregarPagina('pedidos', { requests });
  await win.renderComprasProfissional('pedidos');
  const html = document.getElementById('page-compras-pedidos').innerHTML;
  assert.doesNotMatch(html, /Produto do PCP/);
  assert.doesNotMatch(html, /DO-PCP-1/);
  assert.match(html, /Nenhum pedido encontrado na base/);
});

test('Recebimentos: mostra cada item do pedido numa linha, marcando agendado (com data) e não agendado', async () => {
  const receiptAgenda = mockColecao([
    { id: 'p1', data: { numeroPedido: '10', fornecedorNome: 'Fornecedor A', compradorNome: 'Maria', dataPrevista: '2026-09-01', dataAgendada: '2026-09-03', itensPedido: [{ produto: 'Embalagem 1kg', quantidadePendente: 300 }] } },
    { id: 'p2', data: { numeroPedido: '11', fornecedorNome: 'Fornecedor B', compradorNome: 'Carlos', dataPrevista: '2026-09-08', dataAgendada: '', itensPedido: [{ produto: 'Fita adesiva', quantidadePendente: 40 }] } },
  ]);
  const { win, document } = carregarPagina('recebimentos', { receiptAgenda });
  await win.renderComprasProfissional('recebimentos');
  const html = document.getElementById('page-compras-recebimentos').innerHTML;
  assert.match(html, /Embalagem 1kg/);
  assert.match(html, /2026-09-03/);
  assert.match(html, /Fita adesiva/);
  assert.match(html, /Não agendado/);
});

// PEDIDO AO VIVO (2026-08-27): "trago os campos código do produto, valor,
// quantidade recebida pra dentro do pedido e do recebimento".
test('Pedidos: mostra qtd. recebida e valor pendente somados por pedido, e "Ver itens" abre o detalhe com código e custo unitário', async () => {
  const receiptAgenda = mockColecao([{ id: 'p1', data: {
    numeroPedido: '900', fornecedorNome: 'Fornecedor Beta', compradorNome: 'Vitor',
    dataPrevista: '2026-09-05', dataAgendada: '',
    itensPedido: [
      { produto: 'Bobina 70g', produtoKey: '72009', quantidadePendente: 800, quantidadeRecebida: 100, custoUnitario: 22.7, valorPendente: 18160 },
      { produto: 'Fita adesiva', produtoKey: '55001', quantidadePendente: 50, quantidadeRecebida: 0, custoUnitario: 3, valorPendente: 150 },
    ],
  } }]);
  const { win, document } = carregarPagina('pedidos', { receiptAgenda });
  await win.renderComprasProfissional('pedidos');
  let html = document.getElementById('page-compras-pedidos').innerHTML;
  assert.match(html, /100/, 'qtd. recebida total (100 + 0) aparece na linha do pedido');
  assert.match(html, /18\.310,00|18310/, 'valor pendente total (18160 + 150) aparece somado');

  document.querySelector('[data-cp-pedido-itens="p1"]').click();
  html = document.getElementById('cp-pedido-itens-modal-host').innerHTML;
  assert.match(html, /72009/);
  assert.match(html, /22,70|22\.70/);
  assert.match(html, /55001/);
});

test('Recebimentos: cada linha mostra código do produto, quantidade recebida e valor pendente do item', async () => {
  const receiptAgenda = mockColecao([{ id: 'p1', data: {
    numeroPedido: '901', fornecedorNome: 'Fornecedor Gama', dataPrevista: '2026-09-01', dataAgendada: '2026-09-02',
    itensPedido: [{ produto: 'Saco Pouch', produtoKey: '61002', quantidadePendente: 400, quantidadeRecebida: 400, custoUnitario: 1.5, valorPendente: 0 }],
  } }]);
  const { win, document } = carregarPagina('recebimentos', { receiptAgenda });
  await win.renderComprasProfissional('recebimentos');
  const html = document.getElementById('page-compras-recebimentos').innerHTML;
  assert.match(html, /61002/);
  assert.match(html, /Saco Pouch/);
  assert.match(html, /400/);
});

test('Recebimentos: filtro "Agendados" só mostra pedidos com dataAgendada preenchida', async () => {
  const receiptAgenda = mockColecao([
    { id: 'p1', data: { numeroPedido: '20', fornecedorNome: 'F1', dataPrevista: '2026-09-01', dataAgendada: '2026-09-02', itensPedido: [{ produto: 'Item Agendado', quantidadePendente: 5 }] } },
    { id: 'p2', data: { numeroPedido: '21', fornecedorNome: 'F2', dataPrevista: '2026-09-05', dataAgendada: '', itensPedido: [{ produto: 'Item Pendente', quantidadePendente: 8 }] } },
  ]);
  const { win, document } = carregarPagina('recebimentos', { receiptAgenda });
  await win.renderComprasProfissional('recebimentos');
  document.querySelector('[data-cp-rec-filter="agendado"]').value = 'sim';
  document.querySelector('[data-cp-rec-filter="agendado"]').dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-compras-recebimentos').innerHTML;
  assert.match(html, /<b>Item Agendado<\/b>/);
  // "Item Pendente" ainda aparece no <select> de filtro (lista todos os
  // produtos possíveis) — o que importa é sumir da LINHA da tabela.
  assert.doesNotMatch(html, /<b>Item Pendente<\/b>/);
});
