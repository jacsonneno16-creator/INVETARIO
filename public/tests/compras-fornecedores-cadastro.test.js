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
    simularConciliacaoLegado: async () => ({ exato: [{ nomeLegado: 'X', candidatos: [{ nomeFantasia: 'Fornecedor A' }] }], provavel: [], ambiguo: [], semCorrespondencia: [{ nomeLegado: 'Y', candidatos: [] }] }),
  };
  return Object.assign(base, overrides, { _chamadas: chamadas });
}

function carregarPagina({ fornecedoresBi = [], servico, temPermissao } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-fornecedores"></div><div id="nav-compras-fornecedores" class="nav-item on"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const toasts = [];
  win.showToast = (msg, tipo) => toasts.push({ msg, tipo });
  win.temPermissao = temPermissao || (() => true);
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com' };
  win.getDTFirestore = () => ({ collection: () => mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'bi_fornecedores_agregado' ? mockColecao(fornecedoresBi) : mockColecao([]) });
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
