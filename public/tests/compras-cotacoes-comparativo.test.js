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
    add: async payload => { const id = 'novo_' + (registro.size + 1); registro.set(id, payload); return { id }; },
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
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
  win._fornecedoresService = {
    normalizarNomeFornecedor: norm,
    listarHomologadosPorProduto: async produtoId => {
      const nomes = new Set();
      for (const r of colecoes.requests?._registro?.values?.() || []) {
        for (const c of (r.cotacoes || [])) if (c.fornecedor) nomes.add(c.fornecedor);
        if (r.fornecedor) nomes.add(r.fornecedor);
      }
      ['Fornecedor A','Fornecedor B','Fornecedor Pontual','Fornecedor Atrasado','Fornecedor Completo','Caro e lento','Barato e rápido'].forEach(x=>nomes.add(x));
      return [...nomes].map((nome,i)=>({fornecedorId:'f'+i,fornecedorNome:nome,produtoId,homologado:true}));
    },
    resolverFornecedorAptoPorNome: async nome => ({fornecedorId:'f_'+norm(nome),fornecedorNome:nome}),
    buscarPorId: async id => ({fornecedorId:id,situacao:'ativo',homologacao:{status:'homologado'},documentos:[]}),
    estaBloqueado: () => false,
    documentosVencidos: () => [],
  };
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async payload => colecoes.callableRespostas?.[nome]?.(payload) || { data: {} } }) }), auth: () => ({ currentUser: { uid: 'u1' } }) };
  const cols = {
    pcp_requisicoes_compra: colecoes.requests,
    producao_produtos: mockColecao([]),
    pcp_agendamentos: colecoes.schedules || mockColecao([]),
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
  assert.match(html, /Barato e rápido[\s\S]*recomendada/);
});

test('Cotações: histórico usa recebimento REAL confirmado (pcp_agendamentos.recebidoEm), não data agendada', async () => {
  const schedules = mockColecao([
    { id: 'ag1', data: { fornecedor: 'Fornecedor Pontual', quantidade: 10, quantidadeRecebida: 10, status: 'finalizada', dataPrevista: '2026-01-01', recebidoEm: '2026-01-01T10:00:00.000Z' } },
    { id: 'ag2', data: { fornecedor: 'Fornecedor Atrasado', quantidade: 10, quantidadeRecebida: 10, status: 'finalizada', dataPrevista: '2026-01-01', recebidoEm: '2026-01-15T10:00:00.000Z' } },
  ]);
  const receiptAgenda = mockColecao([
    // Datas de agenda propositalmente invertidas: não podem influenciar o score.
    { id: 'ra1', data: { fornecedorNome: 'Fornecedor Pontual', dataPrevista: '2026-01-01', dataAgendada: '2026-01-20' } },
    { id: 'ra2', data: { fornecedorNome: 'Fornecedor Atrasado', dataPrevista: '2026-01-01', dataAgendada: '2026-01-01' } },
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
  const { win, document } = carregarPagina({ requests, receiptAgenda, schedules });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  const html = document.getElementById('cp-cotacao-modal-host').innerHTML;
  const posPontual = html.indexOf('Fornecedor Pontual');
  const posAtrasado = html.indexOf('Fornecedor Atrasado');
  assert.ok(posPontual < posAtrasado, 'com preço/prazo/pagamento idênticos, o fornecedor mais pontual no histórico deve vencer');
  assert.match(html, /0% no prazo · 14\.0d atraso médio/, 'mostra pontualidade e atraso calculados pela data REAL recebida');
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

test('Cotações profissional: mostra fluxo de trabalho, custo final e atendimento do prazo', async () => {
  const requests = mockColecao([{
    id: 'r1', data: {
      produto: 'Farinha', quantidade: 100, dataNecessaria: '2099-12-31', status: 'em_cotacao',
      cotacoes: [{ fornecedor: 'Fornecedor Completo', precoUnitario: 10, prazoEntregaDias: 5, condicaoPagamentoDias: 30, freteValor: 100, impostosPct: 10, descontoPct: 5, bonusValor: 50 }],
    },
  }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('cotacoes');
  assert.match(document.getElementById('page-compras-cotacoes').textContent, /Selecione o produto/);
  document.querySelector('[data-cp-cotar="r1"]').click();
  const texto = document.getElementById('cp-cotacao-modal-host').textContent.replace(/\s+/g, ' ');
  assert.match(texto, /Preço atual/);
  assert.match(texto, /R\$ 10,00/);
  assert.match(texto, /Preço projetado/);
  assert.match(texto, /lead time 5d/);
  assert.match(texto, /30 dias/);
});

test('Cotações profissional: permite editar uma proposta já cadastrada', async () => {
  const requests = mockColecao([{ id: 'r1', data: { produto: 'Farinha', quantidade: 50, status: 'em_cotacao', cotacoes: [{ fornecedor: 'Fornecedor A', precoUnitario: 10, prazoEntregaDias: 5 }] } }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  document.querySelector('[data-cp-cotacao-editar="0"]').click();
  assert.equal(document.getElementById('cp-cot-forn').value, 'Fornecedor A');
  document.getElementById('cp-cot-preco').value = '9.25';
  document.querySelector('[data-cp-cotacao-add="r1"]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(requests._registro.get('r1').cotacoes.length, 1);
  assert.equal(requests._registro.get('r1').cotacoes[0].precoUnitario, 9.25);
});

test('Cotações profissional: escolher proposta e confirmar gera pedido com rastreabilidade da vencedora', async () => {
  const requests = mockColecao([{ id: 'r1', data: { produto: 'Farinha', quantidade: 50, status: 'em_cotacao', cotacoes: [{ fornecedor: 'Fornecedor A', precoUnitario: 12.5, prazoEntregaDias: 5 }, { fornecedor: 'Fornecedor B', precoUnitario: 15, prazoEntregaDias: 2 }] } }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cotar="r1"]').click();
  document.querySelector('[data-cp-cotacao-usar="0"]').click();
  document.getElementById('cp-req-num').value = 'PED-9001';
  document.querySelector('[data-cp-req-save="r1"]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const salvo = requests._registro.get('r1');
  assert.equal(salvo.status, 'comprada');
  assert.equal(salvo.numeroCompra, 'PED-9001');
  assert.equal(salvo.fornecedor, 'Fornecedor A');
  assert.equal(salvo.cotacoes[0].selecionada, true);
  assert.equal(salvo.cotacoes[1].selecionada, false);
});

test('Cotações profissional: pesquisa produto por código e cria cotação sem solicitação prévia do PCP', async () => {
  const requests = mockColecao([]);
  const { win, document } = carregarPagina({
    requests,
    callableRespostas: {
      buscarProdutosComprasBigQuery: () => ({ data: { produtos: [] } }),
      buscarHistoricoComprasBigQuery: () => ({ data: { linhas: [{ produto_key: '00254', descricao: 'Batata Extra Fina' }] } }),
    },
  });
  await win.renderComprasProfissional('cotacoes');
  document.querySelector('[data-cp-cot-nova-abrir]').click();
  const busca = document.getElementById('cp-cot-produto-busca');
  busca.value = '00254';
  busca.dispatchEvent(new win.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350));
  assert.match(document.getElementById('cp-cot-produto-resultados').textContent, /Batata Extra Fina/);
  document.querySelector('[data-cp-cot-produto="00254"]').click();
  document.querySelector('[data-cp-cot-nova-salvar]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const criada = [...requests._registro.values()][0];
  assert.equal(criada.prodKey, '00254');
  assert.equal(criada.produto, 'Batata Extra Fina');
  assert.equal(criada.quantidade, 0);
  assert.equal(criada.origem, 'COMPRAS_COTACAO');
  assert.equal(criada.status, 'em_cotacao');
});
