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
  function comFiltros(filtros) {
    return {
      where: (campo, op, valor) => comFiltros([...filtros, { campo, valor }]),
      get: async () => ({ docs: [...registro.entries()].filter(([, data]) => filtros.every(f => data && data[f.campo] === f.valor)).map(([id, data]) => ({ id, data: () => data })) }),
    };
  }
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, set: async () => {} }),
    where: (campo, op, valor) => comFiltros([{ campo, valor }]),
    _registro: registro,
  };
}

function carregarPagina(pagina, colecoes) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="page-compras-${pagina}"></div><div id="nav-compras-${pagina}" class="nav-item on"></div></body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.showToast = () => {};
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: (colecoes && colecoes.uid) || 'u1', email: 'comprador@empresa.com', nome: 'Comprador' };
  // Este arquivo testa exibição/agrupamento (colunas, filtros, soma de
  // itens), não o recorte por comprador — que tem cobertura própria em
  // compras-dashboard-papel-comprador.test.js. Sem isso, os fixtures abaixo
  // (compradorNome de outra pessoa) ficariam escondidos pelo novo filtro
  // "cada comprador só vê os seus produtos" (121-compras-profissional.js).
  win.DT_USUARIO_ACESSO_ATUAL = (colecoes && colecoes.acesso) || { admin_mestre: true };
  const cols = {
    pcp_requisicoes_compra: colecoes.requests || mockColecao([]),
    producao_produtos: mockColecao([]),
    pcp_agendamentos: mockColecao([]),
    compras_regras_comprador: mockColecao([]),
    recebimento_agendamentos: colecoes.receiptAgenda || mockColecao([]),
  };
  const rawCols = { compras_cobertura_temporaria: (colecoes && colecoes.coberturaCol) || mockColecao([]) };
  win.getDTFirestore = () => ({ collection: (nome) => cols[nome] || mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: (nome) => rawCols[nome] || mockColecao([]) });
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

// PEDIDO AO VIVO (2026-09-18): "cada comprador só vai poder pesquisar os
// seus produtos... isso vai servir pra tudo dentro da parte de compras" —
// Pedidos e Recebimentos também recortam por comprador (papelCompras),
// igual ao Dashboard (ver compras-dashboard-papel-comprador.test.js).
test('Recebimentos: um comprador comum só vê os pedidos com o próprio nome; gerente vê a equipe; admin vê tudo', async () => {
  const fixture = () => mockColecao([
    { id: 'p1', data: { numeroPedido: '30', fornecedorNome: 'F1', compradorNome: 'Dilma', dataPrevista: '2026-09-01', dataAgendada: '', itensPedido: [{ produto: 'Pedido da Dilma', quantidadePendente: 5 }] } },
    { id: 'p2', data: { numeroPedido: '31', fornecedorNome: 'F2', compradorNome: 'Fabricio', dataPrevista: '2026-09-05', dataAgendada: '', itensPedido: [{ produto: 'Pedido do Fabricio', quantidadePendente: 8 }] } },
  ]);

  const comprador = carregarPagina('recebimentos', { receiptAgenda: fixture() });
  comprador.win.DT_USUARIO_ACESSO_ATUAL = { nome: 'Dilma', papelCompras: 'comprador' };
  await comprador.win.renderComprasProfissional('recebimentos');
  let html = comprador.document.getElementById('page-compras-recebimentos').innerHTML;
  assert.match(html, /Pedido da Dilma/);
  assert.doesNotMatch(html, /Pedido do Fabricio/);

  const gerente = carregarPagina('recebimentos', { receiptAgenda: fixture() });
  gerente.win.DT_USUARIO_ACESSO_ATUAL = { nome: 'Gerente', papelCompras: 'gerente', compradoresGerenciados: ['Fabricio'] };
  await gerente.win.renderComprasProfissional('recebimentos');
  html = gerente.document.getElementById('page-compras-recebimentos').innerHTML;
  assert.doesNotMatch(html, /Pedido da Dilma/);
  assert.match(html, /Pedido do Fabricio/);

  const admin = carregarPagina('recebimentos', { receiptAgenda: fixture() });
  admin.win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  await admin.win.renderComprasProfissional('recebimentos');
  html = admin.document.getElementById('page-compras-recebimentos').innerHTML;
  assert.match(html, /Pedido da Dilma/);
  assert.match(html, /Pedido do Fabricio/);
});

// PEDIDO AO VIVO (2026-09-18): "o gerente vai poder pegar o login de uma
// pessoa que vai sair de férias e unificar na outra... os pedidos dela
// aparecem TAMBÉM pra quem tá cobrindo, pra não ficar parado."
test('Recebimentos: cobertura temporária ativa faz o substituto ver TAMBÉM os pedidos de quem ele está cobrindo (sem perder os próprios)', async () => {
  const receiptAgenda = mockColecao([
    { id: 'p1', data: { numeroPedido: '30', fornecedorNome: 'F1', compradorNome: 'Dilma', dataPrevista: '2026-09-01', dataAgendada: '', itensPedido: [{ produto: 'Pedido da Dilma', quantidadePendente: 5 }] } },
    { id: 'p2', data: { numeroPedido: '31', fornecedorNome: 'F2', compradorNome: 'Fabricio', dataPrevista: '2026-09-05', dataAgendada: '', itensPedido: [{ produto: 'Pedido do Fabricio', quantidadePendente: 8 }] } },
    { id: 'p3', data: { numeroPedido: '32', fornecedorNome: 'F3', compradorNome: 'Marta', dataPrevista: '2026-09-06', dataAgendada: '', itensPedido: [{ produto: 'Pedido da Marta', quantidadePendente: 3 }] } },
  ]);
  // Marta está cobrindo a Dilma (que saiu de férias) — a conta autenticada
  // aqui é a da Marta (uid 'u-marta', ver `uid` no fixture).
  const coberturaCol = mockColecao([{ id: 'c1', data: { origemUid: 'u-dilma', origemNome: 'Dilma', substitutoUid: 'u-marta', substitutoNome: 'Marta', ativo: true } }]);
  const { win, document } = carregarPagina('recebimentos', {
    receiptAgenda, coberturaCol, uid: 'u-marta',
    acesso: { nome: 'Marta', papelCompras: 'comprador' },
  });
  await win.renderComprasProfissional('recebimentos');
  const html = document.getElementById('page-compras-recebimentos').innerHTML;
  assert.match(html, /Pedido da Marta/, 'continua vendo os próprios pedidos');
  assert.match(html, /Pedido da Dilma/, 'e TAMBÉM os pedidos de quem está cobrindo (Dilma)');
  assert.doesNotMatch(html, /Pedido do Fabricio/, 'mas não os de quem ela não está cobrindo');
});
