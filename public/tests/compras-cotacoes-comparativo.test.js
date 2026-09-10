// PEDIDO AO VIVO (2026-08-27): "duas, três empresas mandam cotação...
// tenho que colocar todos os dados de preço, produto... e ela vai ter que
// fazer todo um cálculo pra me dar um retorno de qual é a melhor pra fazer
// negócio... esses bônus, impostos, quanto tempo" + "pega todo o histórico
// que precisar pra aplicar neles também" — comparação ponderada por
// preço/prazo/pagamento/frete/histórico do fornecedor, sem nunca decidir
// sozinho (só ordena e destaca; "Usar esta" é sempre um clique manual).
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
    doc: (id) => ({ id, set: async (payload, opts) => { const atual = registro.get(id) || {}; registro.set(id, (opts && opts.merge) ? { ...atual, ...payload } : payload); } }),
    where: () => ({ get: async () => ({ docs: [] }) }),
    _registro: registro,
  };
}

function carregarPagina(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-cotacoes"></div><div id="nav-compras-cotacoes" class="nav-item on"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.showToast = () => {};
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com' };
  const cols = {
    pcp_requisicoes_compra: colecoes.requests,
    producao_produtos: mockColecao([]),
    pcp_agendamentos: mockColecao([]),
    compras_regras_comprador: mockColecao([]),
    recebimento_agendamentos: colecoes.receiptAgenda || mockColecao([]),
  };
  win.getDTFirestore = () => ({ collection: (nome) => cols[nome] || mockColecao([]) });
  win.eval(code);
  return { win, document };
}

test('Cotações: abrir "Cotar" mostra o formulário de nova proposta', async () => {
  const requests = mockColecao([{ id: 'r1', data: { produto: 'Farinha', quantidade: 100, status: 'solicitada' } }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  const html = document.getElementById('cp-cotacao-modal-host').innerHTML;
  assert.match(html, /Cotações — Farinha/);
  assert.match(html, /Nova proposta/);
});

test('Cotações: adicionar proposta grava no Firestore e muda status pra "em_cotacao"', async () => {
  const requests = mockColecao([{ id: 'r1', data: { produto: 'Farinha', quantidade: 100, status: 'solicitada' } }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  document.getElementById('cp-cot-forn').value = 'Fornecedor A';
  document.getElementById('cp-cot-preco').value = '10';
  document.getElementById('cp-cot-prazo').value = '5';
  document.querySelector('[data-cp-cotacao-add="r1"]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const salvo = requests._registro.get('r1');
  assert.equal(salvo.cotacoes.length, 1);
  assert.equal(salvo.cotacoes[0].fornecedor, 'Fornecedor A');
  assert.equal(salvo.status, 'em_cotacao');
});

test('Cotações: a proposta com melhor preço/prazo fica marcada como recomendada (score mais alto primeiro)', async () => {
  const requests = mockColecao([{
    id: 'r1', data: {
      produto: 'Farinha', quantidade: 100, status: 'em_cotacao',
      cotacoes: [
        { fornecedor: 'Caro e lento', precoUnitario: 20, prazoEntregaDias: 30, condicaoPagamentoDias: 0, freteIncluso: false },
        { fornecedor: 'Barato e rápido', precoUnitario: 10, prazoEntregaDias: 3, condicaoPagamentoDias: 60, freteIncluso: true },
      ],
    },
  }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  const html = document.getElementById('cp-cotacao-modal-host').innerHTML;
  const posBarato = html.indexOf('Barato e rápido');
  const posCaro = html.indexOf('Caro e lento');
  assert.ok(posBarato >= 0 && posCaro >= 0);
  assert.ok(posBarato < posCaro, 'a proposta melhor deve aparecer primeiro na tabela');
  assert.match(html.slice(posBarato, posBarato + 200), /recomendada/);
});

test('Cotações: histórico de atraso do fornecedor (recebimento_agendamentos) entra no score', async () => {
  const receiptAgenda = mockColecao([
    { id: 'ag1', data: { fornecedorNome: 'Fornecedor Pontual', dataPrevista: '2026-01-01', dataAgendada: '2026-01-01' } },
    { id: 'ag2', data: { fornecedorNome: 'Fornecedor Atrasado', dataPrevista: '2026-01-01', dataAgendada: '2026-01-15' } },
  ]);
  const requests = mockColecao([{
    id: 'r1', data: {
      produto: 'X', quantidade: 10, status: 'em_cotacao',
      cotacoes: [
        { fornecedor: 'Fornecedor Pontual', precoUnitario: 10, prazoEntregaDias: 5, condicaoPagamentoDias: 30, freteIncluso: false },
        { fornecedor: 'Fornecedor Atrasado', precoUnitario: 10, prazoEntregaDias: 5, condicaoPagamentoDias: 30, freteIncluso: false },
      ],
    },
  }]);
  const { win, document } = carregarPagina({ requests, receiptAgenda });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  const html = document.getElementById('cp-cotacao-modal-host').innerHTML;
  const posPontual = html.indexOf('Fornecedor Pontual');
  const posAtrasado = html.indexOf('Fornecedor Atrasado');
  assert.ok(posPontual < posAtrasado, 'com preço/prazo/pagamento idênticos, o fornecedor mais pontual no histórico deve vencer');
  assert.match(html, /14\.0d/, 'mostra o atraso médio real (14 dias) do fornecedor atrasado');
});

test('Cotações: "Usar esta" abre o modal de registrar compra pré-preenchido com fornecedor e preço da proposta', async () => {
  const requests = mockColecao([{
    id: 'r1', data: { produto: 'Farinha', quantidade: 50, status: 'em_cotacao', cotacoes: [{ fornecedor: 'Fornecedor A', precoUnitario: 12.5, prazoEntregaDias: 5, condicaoPagamentoDias: 30, freteIncluso: true }] },
  }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  document.querySelector('[data-cp-cotacao-usar="0"]').click();
  const html = document.getElementById('cp-req-modal-host').innerHTML;
  assert.match(html, /Registrar compra — Farinha/);
  assert.equal(document.getElementById('cp-req-forn').value, 'Fornecedor A');
  assert.equal(document.getElementById('cp-req-preco').value, '12.5');
});

test('Cotações: remover uma proposta tira ela da lista e do Firestore', async () => {
  const requests = mockColecao([{
    id: 'r1', data: { produto: 'Farinha', quantidade: 50, status: 'em_cotacao', cotacoes: [{ fornecedor: 'Fornecedor A', precoUnitario: 10 }, { fornecedor: 'Fornecedor B', precoUnitario: 20 }] },
  }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  document.querySelector('[data-cp-cotacao-remover="1"]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(requests._registro.get('r1').cotacoes.length, 1);
  assert.equal(requests._registro.get('r1').cotacoes[0].fornecedor, 'Fornecedor A');
});
