// PEDIDO AO VIVO (2026-08-27): "Minhas requisições" (Central de Compras)
// e "Solicitações" mostravam a mesma coisa — consolidadas aqui como
// "Solicitações PCP", com a ação de registrar compra que antes só existia
// em "Minhas requisições".
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
    doc: (id) => ({
      id,
      set: async (payload, opts) => { const atual = registro.get(id) || {}; registro.set(id, (opts && opts.merge) ? { ...atual, ...payload } : payload); },
    }),
    where: () => ({ get: async () => ({ docs: [] }) }),
    _registro: registro,
  };
}

function carregarPagina(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-solicitacoes"></div><div id="nav-compras-solicitacoes" class="nav-item on"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.showToast = () => {};
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com', nome: 'Comprador' };
  const cols = {
    pcp_requisicoes_compra: colecoes.requests,
    producao_produtos: mockColecao([]),
    pcp_agendamentos: colecoes.schedules || mockColecao([]),
    compras_regras_comprador: mockColecao([]),
    recebimento_agendamentos: mockColecao([]),
  };
  win.getDTFirestore = () => ({ collection: (nome) => cols[nome] || mockColecao([]) });
  win._fornecedoresService = {
    normalizarNomeFornecedor: v => String(v||'').trim().toLowerCase(),
    listarHomologadosPorProduto: async produtoId => [{ fornecedorId:'f1', fornecedorNome:'Fornecedor X', produtoId:String(produtoId), homologado:true }],
    buscarPorId: async () => ({ fornecedorId:'f1', nomeFantasia:'Fornecedor X', situacao:'ativo', homologacao:{status:'homologado'}, documentos:[] }),
    estaBloqueado: () => false,
    documentosVencidos: () => [],
  };
  win.eval(code);
  return { win, document, cols };
}

test('Solicitações PCP: mostra destino, motivo e o botão de registrar compra pra pedido em aberto', async () => {
  const requests = mockColecao([{ id: 'r1', data: { produto: 'Farinha', quantidade: 100, dataNecessaria: '2026-09-01', destino: 'Matriz', motivo: 'Estoque baixo', prioridade: 'alta', status: 'solicitada', compradorNome: 'Comprador' } }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('solicitacoes');
  const html = document.getElementById('page-compras-solicitacoes').innerHTML;
  assert.match(html, /Solicitações PCP/);
  assert.match(html, /Matriz/);
  assert.match(html, /Estoque baixo/);
  assert.match(html, /data-cp-req-comprar="r1"/);
  assert.match(html, /data-cp-req-analise="r1"/);
});

test('Solicitações PCP: pedido já comprado não mostra mais os botões de ação', async () => {
  const requests = mockColecao([{ id: 'r2', data: { produto: 'Açúcar', quantidade: 50, status: 'comprada', numeroCompra: 'PC-9' } }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('solicitacoes');
  const html = document.getElementById('page-compras-solicitacoes').innerHTML;
  assert.doesNotMatch(html, /data-cp-req-comprar="r2"/);
  assert.match(html, /PC-9/);
});

test('clicar em "Registrar compra" abre o modal, e salvar grava a requisição E o agendamento vinculado', async () => {
  const requests = mockColecao([{ id: 'r3', data: { produto: 'Sal', quantidade: 30, status: 'solicitada', prodKey: '999', destino: 'Filial' } }]);
  const schedules = mockColecao([]);
  const { win, document, cols } = carregarPagina({ requests, schedules });
  await win.renderComprasProfissional('solicitacoes');
  document.querySelector('[data-cp-req-comprar="r3"]').click();
  assert.ok(document.getElementById('cp-req-modal-host').innerHTML.includes('Registrar compra'));

  document.getElementById('cp-req-num').value = 'PC-100';
  document.getElementById('cp-req-forn').value = 'Fornecedor X';
  document.getElementById('cp-req-qtd').value = '30';
  document.getElementById('cp-req-preco').value = '2.50';
  document.getElementById('cp-req-prev').value = '2026-09-10';
  document.querySelector('[data-cp-req-save="r3"]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  const reqDepois = requests._registro.get('r3');
  assert.equal(reqDepois.status, 'comprada');
  assert.equal(reqDepois.numeroCompra, 'PC-100');
  assert.equal(reqDepois.valorTotal, 75);

  const agendamento = schedules._registro.get('req_r3');
  assert.ok(agendamento, 'deve criar o agendamento vinculado à requisição, igual "Minhas requisições" já fazia');
  assert.equal(agendamento.requisicaoId, 'r3');
  assert.equal(agendamento.fornecedor, 'Fornecedor X');
  assert.equal(agendamento.destino, 'Filial');
});

test('clicar em "Em análise" muda o status sem abrir modal', async () => {
  const requests = mockColecao([{ id: 'r4', data: { produto: 'Pimenta', quantidade: 10, status: 'solicitada' } }]);
  const { win, document } = carregarPagina({ requests });
  await win.renderComprasProfissional('solicitacoes');
  document.querySelector('[data-cp-req-analise="r4"]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(requests._registro.get('r4').status, 'em_analise');
});

test('compra parcial: uma solicitação aceita vários pedidos, preserva o comprador responsável e registra quem executou', async () => {
  const requests = mockColecao([{ id: 'rp', data: { produto: 'Sal', quantidade: 30, status: 'solicitada', prodKey: '999', destino: 'Filial', compradorUid:'u-original', compradorNome:'Comprador Original', compradorEmail:'original@empresa.com' } }]);
  const schedules = mockColecao([]);
  const { win, document } = carregarPagina({ requests, schedules });
  await win.renderComprasProfissional('solicitacoes');
  document.querySelector('[data-cp-req-comprar="rp"]').click();
  document.getElementById('cp-req-num').value = 'PC-1';
  document.getElementById('cp-req-forn').value = 'Fornecedor X';
  document.getElementById('cp-req-qtd').value = '10';
  document.getElementById('cp-req-preco').value = '2';
  document.getElementById('cp-req-prev').value = '2026-09-10';
  document.querySelector('[data-cp-req-save="rp"]').click();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  let req=requests._registro.get('rp');
  assert.equal(req.status,'parcialmente_comprada');
  assert.equal(req.quantidadeComprada,10);
  assert.equal(req.saldoComprar,20);
  assert.equal(req.pedidosCompra.length,1);
  let ag=schedules._registro.get('req_rp');
  assert.equal(ag.compradorUid,'u-original','cobertura/execução não transfere a carteira');
  assert.equal(ag.registradoPorUid,'u1','ator real fica separado para auditoria');

  await win.renderComprasProfissional('solicitacoes');
  document.querySelector('[data-cp-req-comprar="rp"]').click();
  document.getElementById('cp-req-num').value = 'PC-2';
  document.getElementById('cp-req-forn').value = 'Fornecedor X';
  document.getElementById('cp-req-qtd').value = '20';
  document.getElementById('cp-req-preco').value = '2.5';
  document.getElementById('cp-req-prev').value = '2026-09-11';
  document.querySelector('[data-cp-req-save="rp"]').click();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  req=requests._registro.get('rp');
  assert.equal(req.status,'comprada');
  assert.equal(req.quantidadeComprada,30);
  assert.equal(req.saldoComprar,0);
  assert.equal(req.pedidosCompra.length,2);
  assert.ok(schedules._registro.get('req_rp_PC-2'),'segundo pedido ganha agendamento próprio, sem sobrescrever o primeiro');
});
