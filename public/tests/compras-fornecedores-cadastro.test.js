// Fase 1A — Seção D: tela de Fornecedores como cadastro mestre real
// (Lista/Cadastro/360°/Bloqueio/Conciliação). Testa só a camada de UI
// (121-compras-profissional.js) com um _fornecedoresService MOCKADO —
// o serviço real já é coberto por compras-fornecedores-service.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/121-compras-profissional.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }), doc: () => ({ set: async () => {} }), where: () => ({ get: async () => ({ docs: [] }) }) };
}

function criarServicoMock(overrides) {
  const chamadas = [];
  const base = {
    pesquisarPorNome: async () => [
      { fornecedorId: 'f1', nomeFantasia: 'Fornecedor A', razaoSocial: 'Fornecedor A Ltda', cnpjFormatado: '11.222.333/0001-81', situacao: 'ativo', homologacao: { status: 'homologado' }, leadTimePadraoDias: 5, categorias: ['materia_prima'] },
      { fornecedorId: 'f2', nomeFantasia: 'Fornecedor B', razaoSocial: 'Fornecedor B Ltda', situacao: 'bloqueado', homologacao: { status: 'nao_homologado' }, leadTimePadraoDias: 0, categorias: [] },
    ],
    buscarPorId: async (id) => ({ fornecedorId: id, nomeFantasia: 'Fornecedor A', razaoSocial: 'Fornecedor A Ltda', situacao: 'ativo', homologacao: { status: 'homologado' }, leadTimePadraoDias: 5, contatos: [{ nome: 'João', telefone: '11999999999', email: 'joao@ex.com' }], observacoes: '', bloqueios: [] }),
    listarProdutosDoFornecedor: async () => [{ produtoId: '500', produtoNomeSnapshot: 'Farinha', codigoNoFornecedor: 'X1', precoReferencia: 2.5, quantidadeMinima: 10, leadTimeDias: 5, homologado: true }],
    normalizarNomeFornecedor: (v) => String(v || '').toLowerCase().trim(),
    estaBloqueado: (f) => f.situacao === 'bloqueado',
    criarFornecedor: async (dados) => { chamadas.push({ acao: 'criar', dados }); return { fornecedorId: 'novo1', ...dados }; },
    atualizarFornecedor: async (id, dados) => { chamadas.push({ acao: 'atualizar', id, dados }); return { fornecedorId: id, ...dados }; },
    bloquearFornecedor: async (id, motivo) => { chamadas.push({ acao: 'bloquear', id, motivo }); return {}; },
    desbloquearFornecedor: async (id, motivo) => { chamadas.push({ acao: 'desbloquear', id, motivo }); return {}; },
    vincularProdutoFornecedor: async (payload) => { chamadas.push({ acao: 'vincular', payload }); return payload; },
    removerVinculoProduto: async (fornecedorId, produtoId) => { chamadas.push({ acao: 'removerVinculo', fornecedorId, produtoId }); },
    simularConciliacaoLegado: async () => ({ exato: [{ nomeLegado: 'X', candidatos: [{ nomeFantasia: 'Fornecedor A' }] }], provavel: [], ambiguo: [], semCorrespondencia: [{ nomeLegado: 'Y', candidatos: [] }] }),
  };
  return Object.assign(base, overrides, { _chamadas: chamadas });
}

function carregarPagina({ fornecedoresBi = [], servico, temPermissao, produtosBi, schedules = [], requests = [] } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-fornecedores"></div><div id="nav-compras-fornecedores" class="nav-item on"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const toasts = [];
  win.showToast = (msg, tipo) => toasts.push({ msg, tipo });
  win.confirm = () => true;
  win.temPermissao = temPermissao || (() => true);
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com' };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  win.getDTFirestore = () => ({ collection: (nome) => {
    if (nome === 'pcp_agendamentos') return mockColecao(schedules);
    if (nome === 'pcp_requisicoes_compra') return mockColecao(requests);
    return mockColecao([]);
  } });
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'bi_fornecedores_agregado' ? mockColecao(fornecedoresBi) : mockColecao([]) });
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => nome === 'buscarResumoProdutosComprasBigQuery' ? { data: { produtos: produtosBi || [] } } : { data: {} } }) }) };
  win._fornecedoresService = servico || criarServicoMock();
  win.listarAuditoria = async () => [];
  win.eval(code);
  return { win, document: win.document, toasts };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('Fornecedores › Lista: mostra o cadastro mestre (não mais o texto livre) com situação e homologação', async () => {
  const { win, document } = carregarPagina();
  await win.renderComprasProfissional('fornecedores');
  const html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.match(html, /Fornecedor A/);
  assert.match(html, /Fornecedor B/);
  assert.match(html, /homologado/);
  assert.match(html, /bloqueado/);
  // Ranking (BI) continua presente, mas como seção analítica separada.
  assert.match(html, /seção analítica/);
});

// BUG AO VIVO REAL (2026-09-06): "lá em compras tem um que não está
// mostrando nenhuma informação, clica atualizar e a tela só pisca" —
// compras_fornecedores (firestore.rules) exige 'compras-central':'visualizar',
// diferente das outras abas do mesmo módulo. Sem essa permissão, a leitura
// era negada e o .catch(()=>[]) escondia isso: lista vazia e sem permissão
// ficavam visualmente idênticos. Agora mostra um aviso específico.
test('Fornecedores › sem a permissão "compras-central:visualizar", mostra aviso claro em vez de fingir lista vazia', async () => {
  const temPermissao = (modulo, acao) => !(modulo === 'compras-central' && acao === 'visualizar');
  const { win, document } = carregarPagina({ temPermissao });
  await win.renderComprasProfissional('fornecedores');
  const html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.match(html, /Sem permissão para ver o cadastro de fornecedores/i);
  assert.match(html, /Compras · Central de Compras/);
  assert.doesNotMatch(html, /Nenhum fornecedor cadastrado/i, 'não pode parecer que é só uma lista vazia');
});

test('Fornecedores › com a permissão certa, continua mostrando a lista normalmente (sem aviso)', async () => {
  const { win, document } = carregarPagina({ temPermissao: () => true });
  await win.renderComprasProfissional('fornecedores');
  const html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.doesNotMatch(html, /Sem permissão para ver o cadastro de fornecedores/i);
  assert.match(html, /Fornecedor A/);
});

test('Fornecedores › Cadastro: "+ Novo fornecedor" abre modal; salvar chama criarFornecedor com os dados do formulário', async () => {
  const servico = criarServicoMock();
  const { win, document } = carregarPagina({ servico });
  await win.renderComprasProfissional('fornecedores');
  document.querySelector('[data-cf-novo]').click();
  document.getElementById('cf-razao').value = 'Nova Distribuidora Ltda';
  document.getElementById('cf-fantasia').value = 'Nova Distribuidora';
  document.getElementById('cf-cnpj').value = '11.222.333/0001-81';
  document.querySelector('[data-cf-salvar]').click();
  await tick(); await tick();
  assert.equal(servico._chamadas.length, 1);
  assert.equal(servico._chamadas[0].acao, 'criar');
  assert.equal(servico._chamadas[0].dados.razaoSocial, 'Nova Distribuidora Ltda');
  assert.equal(servico._chamadas[0].dados.nomeFantasia, 'Nova Distribuidora');
});

test('Fornecedores › 360°: mostra produtos vinculados; bloquear exige justificativa (modal, não prompt do navegador)', async () => {
  const servico = criarServicoMock();
  const { win, document, toasts } = carregarPagina({ servico });
  await win.renderComprasProfissional('fornecedores');
  document.querySelector('[data-cf-detalhe]').click();
  await tick(); await tick();
  let html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.match(html, /Farinha/);
  assert.match(html, /Produtos fornecidos/);

  document.querySelector('[data-cf-bloquear]').click();
  await tick();
  html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.match(html, /Justificativa/);

  document.querySelector('[data-cf-confirmar-bloqueio]').click();
  await tick();
  assert.equal(servico._chamadas.filter(c => c.acao === 'bloquear').length, 0, 'sem justificativa não deve chamar o serviço');
  assert.ok(toasts.some(t => /justificativa/i.test(t.msg)));

  document.getElementById('cf-bloqueio-motivo').value = 'Atraso recorrente em entregas.';
  document.querySelector('[data-cf-confirmar-bloqueio]').click();
  await tick(); await tick();
  const chamada = servico._chamadas.find(c => c.acao === 'bloquear');
  assert.ok(chamada);
  assert.equal(chamada.motivo, 'Atraso recorrente em entregas.');
});

// PEDIDO AO VIVO (2026-09-18): "monta um cadastro de fornecedor→produto,
// tipo o modal de máquina da Programação Produção" — vincularProdutoFornecedor
// já existia (Fase 1A) mas nenhuma tela chamava; o 360° só EXIBIA vínculos,
// nunca deixava criar um novo nem desfazer um errado.
test('Fornecedores › 360°: vincular produto chama o serviço com o produtoKey certo (escolhido da lista, não texto livre)', async () => {
  const servico = criarServicoMock();
  const { win, document, toasts } = carregarPagina({ servico, produtosBi: [
    { produtoKey: '700', descricao: 'Batata Palha 1kg', numCompras: 3, ultimaData: '2026-09-01', ultimoFornecedor: 'X', ultimoPreco: 5 },
  ] });
  await win.renderComprasProfissional('fornecedores');
  document.querySelector('[data-cf-detalhe]').click();
  await tick(); await tick();
  assert.match(document.getElementById('page-compras-fornecedores').innerHTML, /Vincular produto a este fornecedor/);

  document.getElementById('cf-vinc-produto').value = 'Batata Palha 1kg';
  document.getElementById('cf-vinc-codigo').value = 'COD-BP1';
  document.getElementById('cf-vinc-preco').value = '5.90';
  document.querySelector('[data-cf-vincular]').click();
  await tick(); await tick();

  const chamada = servico._chamadas.find(c => c.acao === 'vincular');
  assert.ok(chamada, 'chamou vincularProdutoFornecedor');
  assert.equal(chamada.payload.produtoId, '700');
  assert.equal(chamada.payload.produtoNomeSnapshot, 'Batata Palha 1kg');
  assert.equal(chamada.payload.codigoNoFornecedor, 'COD-BP1');
  assert.equal(chamada.payload.precoReferencia, 5.9);
});

test('Fornecedores › 360°: vincular sem escolher da lista de sugestões (texto digitado livre) recusa e não chama o serviço', async () => {
  const servico = criarServicoMock();
  const { win, document, toasts } = carregarPagina({ servico, produtosBi: [
    { produtoKey: '700', descricao: 'Batata Palha 1kg', numCompras: 3, ultimaData: '2026-09-01', ultimoFornecedor: 'X', ultimoPreco: 5 },
  ] });
  await win.renderComprasProfissional('fornecedores');
  document.querySelector('[data-cf-detalhe]').click();
  await tick(); await tick();

  document.getElementById('cf-vinc-produto').value = 'coisa que não existe na lista';
  document.querySelector('[data-cf-vincular]').click();
  await tick(); await tick();
  assert.equal(servico._chamadas.filter(c => c.acao === 'vincular').length, 0);
  assert.ok(toasts.some(t => /não encontrado/i.test(t.msg)));
});

test('Fornecedores › 360°: remover vínculo chama o serviço com fornecedor+produto certos', async () => {
  const servico = criarServicoMock();
  const { win, document } = carregarPagina({ servico });
  await win.renderComprasProfissional('fornecedores');
  document.querySelector('[data-cf-detalhe]').click();
  await tick(); await tick();
  document.querySelector('[data-cf-remover-vinculo]').click();
  await tick(); await tick();
  const chamada = servico._chamadas.find(c => c.acao === 'removerVinculo');
  assert.ok(chamada);
  assert.equal(chamada.fornecedorId, 'f1');
  assert.equal(chamada.produtoId, '500');
});

test('Fornecedores › Conciliação: só aparece pra quem pode configurar; "Rodar simulação" mostra os grupos classificados (sem gravar nada)', async () => {
  const servico = criarServicoMock();
  const { win, document } = carregarPagina({ servico });
  await win.renderComprasProfissional('fornecedores');
  document.querySelector('[data-cf-subtab="conciliacao"]').click();
  await tick(); await tick();
  let html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.match(html, /Rodar simulação/);
  assert.doesNotMatch(html, /criarFornecedor|atualizarFornecedor/);

  document.querySelector('[data-cf-rodar-conciliacao]').click();
  await tick(); await tick();
  html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.match(html, /Correspondência exata \(1\)/);
  assert.match(html, /Sem correspondência \(1\)/);
  assert.equal(servico._chamadas.length, 0, 'conciliação é só leitura — nenhuma chamada de escrita deve ter acontecido');
});

test('Fornecedores › Conciliação: fica oculta para quem não tem permissão de configurar (só operação de Compras)', async () => {
  const { win, document } = carregarPagina({ temPermissao: (area, op) => op !== 'configurar' });
  await win.renderComprasProfissional('fornecedores');
  const html = document.getElementById('page-compras-fornecedores').innerHTML;
  assert.doesNotMatch(html, /Conciliação/);
  assert.doesNotMatch(html, /\+ Novo fornecedor/);
});


test('Fornecedores › desempenho real usa recebidoEm: mostra pontualidade, atraso e lead time sem usar dataAgendada', async () => {
  const schedules = [
    { id: 's1', data: { requisicaoId: 'r1', fornecedor: 'Fornecedor A', produto: 'Farinha', numeroCompra: 'P1', quantidade: 100, quantidadeRecebida: 100, status: 'finalizada', dataPrevista: '2026-09-10', recebidoEm: '2026-09-10T14:00:00.000Z' } },
    { id: 's2', data: { requisicaoId: 'r2', fornecedor: 'Fornecedor A', produto: 'Farinha', numeroCompra: 'P2', quantidade: 100, quantidadeRecebida: 100, status: 'finalizada', dataPrevista: '2026-09-10', recebidoEm: '2026-09-14T14:00:00.000Z' } },
    // Parcial ainda não concluído: não entra no KPI de entrega final.
    { id: 's3', data: { requisicaoId: 'r3', fornecedor: 'Fornecedor A', produto: 'Farinha', numeroCompra: 'P3', quantidade: 100, quantidadeRecebida: 50, status: 'parcial', dataPrevista: '2026-09-10', recebidoEm: '2026-09-20T14:00:00.000Z' } },
  ];
  const requests = [
    { id: 'r1', data: { fornecedor: 'Fornecedor A', numeroCompra: 'P1', compradoEm: '2026-09-05T08:00:00.000Z' } },
    { id: 'r2', data: { fornecedor: 'Fornecedor A', numeroCompra: 'P2', compradoEm: '2026-09-04T08:00:00.000Z' } },
    { id: 'r3', data: { fornecedor: 'Fornecedor A', numeroCompra: 'P3', compradoEm: '2026-09-01T08:00:00.000Z' } },
  ];
  const { win, document } = carregarPagina({ schedules, requests });
  await win.renderComprasProfissional('fornecedores');
  let html = document.getElementById('page-compras-fornecedores').textContent.replace(/\s+/g, ' ');
  assert.match(html, /50%/, '1 de 2 entregas finalizadas ficou no prazo');
  assert.match(html, /2 d/, 'atraso médio considera 0 e 4 dias = 2 dias');
  assert.match(html, /2/, 'duas entregas confirmadas entram no indicador');

  document.querySelector('[data-cf-detalhe="f1"]').click();
  await tick(); await tick();
  html = document.getElementById('page-compras-fornecedores').textContent.replace(/\s+/g, ' ');
  assert.match(html, /Desempenho real de entrega/);
  assert.match(html, /recebimento real confirmado/i);
  assert.match(html, /P1/);
  assert.match(html, /P2/);
  const blocoDesempenho = html.slice(html.indexOf('Desempenho real de entrega'), html.indexOf('Produtos fornecidos'));
  assert.doesNotMatch(blocoDesempenho, /P3/, 'recebimento parcial não é tratado como entrega final do fornecedor');
  assert.match(html, /50%/);
});

test('Fornecedores › desempenho real não adiciona leitura: usa pcp_agendamentos já carregado no load base', () => {
  assert.match(code, /const nomesBase=\['requests','products','schedules','rules'\]/);
  assert.match(code, /_desempenhoFornecedoresReais\(\)/);
  const bloco = code.slice(code.indexOf('function _desempenhoFornecedoresReais()'), code.indexOf('function _historicoFornecedores()'));
  assert.doesNotMatch(bloco, /\.collection\s*\(/);
  assert.doesNotMatch(bloco, /getDTFirestore|getDTRawFirestore/);
});
