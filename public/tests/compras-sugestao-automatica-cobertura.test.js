// PEDIDO AO VIVO (2026-09-18): duas correções sobre a mesma conversa —
// (1) "não quero pegar produto por produto, tem mais de mil... pega o
// histórico e cadastra automático no nome de quem mais compra" (por
// fornecedor E por produto, sincronizando sozinho quando o comprador real
// muda) e (2) "o gerente vai poder pegar o login de uma pessoa que vai sair
// de férias e unificar na outra... os pedidos dela aparecem TAMBÉM pra
// quem tá cobrindo, sem ficar parado — e o produto continua aparecendo pro
// comprador REGISTRADO, não pra quem fez o pedido."
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '79-compras-central.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const snapshot = entries => ({ docs: entries.map(([id, data]) => ({ id, data: () => data })) });
  function comFiltros(filtros) {
    return {
      where: (campo, op, valor) => comFiltros([...filtros, { campo, valor }]),
      get: async () => snapshot([...registro.entries()].filter(([, data]) => filtros.every(f => data && data[f.campo] === f.valor))),
    };
  }
  return {
    get: async () => snapshot([...registro.entries()]),
    where: (campo, op, valor) => comFiltros([{ campo, valor }]),
    doc: id => {
      const docId = id || ('novo' + (seq++));
      return {
        id: docId,
        get: async () => { const data = registro.get(docId); return { exists: data !== undefined, id: docId, data: () => data }; },
        set: async (p, opts) => { const a = registro.get(docId) || {}; registro.set(docId, (opts && opts.merge) ? { ...a, ...p } : p); },
        delete: async () => { registro.delete(docId); },
      };
    },
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    _registro: registro,
  };
}

function carregarPagina({ requests, regrasCol, usuariosCol, coberturaCol, firebaseMock, acesso } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-central"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.showToast = () => {};
  win.confirm = () => true;
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u-admin', email: 'admin@daterrinhaalimentos.com.br', nome: 'Admin' };
  win.DT_USUARIO_ACESSO_ATUAL = acesso || {};
  const fsCols = {
    pcp_requisicoes_compra: requests || mockColecao([]),
    compras_regras_comprador: regrasCol || mockColecao([]),
    producao_produtos: mockColecao([]),
    pcp_agendamentos: mockColecao([]),
  };
  const rawCols = {
    usuarios_acessos: usuariosCol || mockColecao([]),
    compras_cobertura_temporaria: coberturaCol || mockColecao([]),
  };
  win.getDTFirestore = () => ({ collection: nome => fsCols[nome] || mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: nome => rawCols[nome] || mockColecao([]) });
  win.firebase = firebaseMock || { app: () => ({ functions: () => ({ httpsCallable: () => async () => ({ data: {} }) }) }) };
  win.eval(code);
  return { win, document, fsCols, rawCols };
}

async function abrirAbaRegras(win) {
  win.comprasSetAbaCentral('regras');
  await win.renderComprasCentral();
}

const USUARIOS = mockColecao([
  { id: 'a1', data: { uid: 'u-fabricio', nome: 'Fabricio Silva', email: 'fabricio@daterrinhaalimentos.com.br', ativo: true, setores_permitidos: { compras: true } } },
  { id: 'a2', data: { uid: 'u-dilma', nome: 'Dilma Souza', email: 'dilma@daterrinhaalimentos.com.br', ativo: true, setores_permitidos: { compras: true } } },
  { id: 'a3', data: { uid: 'u-marta', nome: 'Marta Lima', email: 'marta@daterrinhaalimentos.com.br', ativo: true, setores_permitidos: { compras: true } } },
]);

test('datalist do campo de valor da regra reflete produto/categoria/fornecedor reais (bug: antes só tinha comprador BlueSoft)', async () => {
  const produtosCol = mockColecao([{ id: 'p1', data: { cod: '30421', nome: 'Fubá Mimoso', fornecedor: 'Ebrali Embalagens', categoria: 'Secos' } }]);
  const { win, document } = carregarPagina({ usuariosCol: USUARIOS });
  win.getDTFirestore = () => ({ collection: nome => (nome === 'producao_produtos' ? produtosCol : mockColecao([])) });
  await abrirAbaRegras(win);
  let opcoes = [...document.querySelectorAll('#comp-reg-valores option')].map(o => o.value);
  assert.ok(opcoes.includes('30421') || opcoes.includes('Fubá Mimoso'), 'tipo inicial (produto) mostra código/nome do produto real');

  document.getElementById('comp-reg-tipo').value = 'fornecedor';
  document.getElementById('comp-reg-tipo').dispatchEvent(new win.Event('change', { bubbles: true }));
  opcoes = [...document.querySelectorAll('#comp-reg-valores option')].map(o => o.value);
  assert.ok(opcoes.includes('Ebrali Embalagens'), 'ao trocar pra fornecedor, o datalist atualiza sozinho pro fornecedor real');
});

test('Sugestão por histórico (fornecedor): abre modal, carrega do BigQuery, marcar/aplicar grava compras_regras_comprador', async () => {
  const regrasCol = mockColecao([]);
  const firebaseMock = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => {
    if (nome === 'sugerirRegrasCompradorPorFornecedorBigQuery') return { data: { fornecedores: [
      { fornecedor: 'Ebrali Embalagens', totalValor: 10000, totalQtd: 500, sugerido: { compradorChave: 'fabricio', compradorNome: 'Fabricio Silva', participacaoPct: 80 }, compradores: [] },
    ] } };
    return { data: {} };
  } }) }) };
  const { win, document } = carregarPagina({ regrasCol, usuariosCol: USUARIOS, firebaseMock });
  await abrirAbaRegras(win);
  document.querySelector('[data-comp-reg-sugestoes]').click();
  assert.match(document.getElementById('compras-modal-host').innerHTML, /Consultando o histórico/);
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('compras-modal-host').innerHTML;
  assert.match(html, /Ebrali Embalagens/);
  assert.match(html, /Fabricio Silva/);
  assert.match(html, />80%</);

  document.querySelector('[data-comp-sug-aplicar]').click();
  await new Promise(r => setTimeout(r, 0));
  const gravado = [...regrasCol._registro.values()][0];
  assert.equal(gravado.tipo, 'fornecedor');
  assert.equal(gravado.valor, 'Ebrali Embalagens');
  assert.equal(gravado.compradorUid, 'u-fabricio');
  assert.equal(gravado.origem, 'auto_historico');
});

test('Sincronizar automaticamente: cria regra nova, ATUALIZA regra auto desatualizada (comprador mudou), mas NUNCA mexe em regra manual', async () => {
  const regrasCol = mockColecao([
    { id: 'r-auto-antiga', data: { tipo: 'fornecedor', valor: 'Fornecedor Antigo Auto', compradorUid: 'u-dilma', compradorNome: 'Dilma Souza', origem: 'auto_historico', ativo: true } },
    { id: 'r-manual', data: { tipo: 'fornecedor', valor: 'Fornecedor Manual', compradorUid: 'u-dilma', compradorNome: 'Dilma Souza', ativo: true } },
  ]);
  const firebaseMock = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => {
    if (nome === 'sugerirRegrasCompradorPorFornecedorBigQuery') return { data: { fornecedores: [
      { fornecedor: 'Fornecedor Novo', totalValor: 1, sugerido: { compradorChave: 'fabricio', compradorNome: 'Fabricio Silva', participacaoPct: 100 } },
      // comprador desta regra JÁ EXISTENTE (auto) mudou de Dilma pra Marta:
      { fornecedor: 'Fornecedor Antigo Auto', totalValor: 1, sugerido: { compradorChave: 'marta', compradorNome: 'Marta Lima', participacaoPct: 90 } },
      { fornecedor: 'Fornecedor Manual', totalValor: 1, sugerido: { compradorChave: 'fabricio', compradorNome: 'Fabricio Silva', participacaoPct: 100 } },
    ] } };
    if (nome === 'sugerirRegrasCompradorPorProdutoBigQuery') return { data: { produtos: [] } };
    return { data: {} };
  } }) }) };
  const { win } = carregarPagina({ regrasCol, usuariosCol: USUARIOS, firebaseMock });
  await abrirAbaRegras(win);
  const r = await win._comprasInternals.sincronizarRegrasAutomaticamente();
  assert.equal(r.criadas, 1, 'Fornecedor Novo: cria');
  assert.equal(r.atualizadas, 1, 'Fornecedor Antigo Auto: era auto, comprador mudou -> atualiza');
  assert.equal(r.puladasManual, 1, 'Fornecedor Manual: NUNCA mexe (sem tag auto_historico)');

  const novo = [...regrasCol._registro.values()].find(x => x.valor === 'Fornecedor Novo');
  assert.equal(novo.compradorUid, 'u-fabricio');
  const atualizado = regrasCol._registro.get('r-auto-antiga');
  assert.equal(atualizado.compradorUid, 'u-marta', 'sincronização detectou e corrigiu sozinha (Dilma -> Marta)');
  const manual = regrasCol._registro.get('r-manual');
  assert.equal(manual.compradorUid, 'u-dilma', 'regra manual continua com o comprador original, intocada');
});

test('Sincronizar automaticamente: sugestão apontando pra alguém sem conta cadastrada em Compras fica sem aplicar (não trava, não inventa uid)', async () => {
  const regrasCol = mockColecao([]);
  const firebaseMock = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => {
    if (nome === 'sugerirRegrasCompradorPorFornecedorBigQuery') return { data: { fornecedores: [
      { fornecedor: 'Fornecedor Orfao', totalValor: 1, sugerido: { compradorChave: 'ninguem', compradorNome: 'Ninguém Cadastrado', participacaoPct: 100 } },
    ] } };
    if (nome === 'sugerirRegrasCompradorPorProdutoBigQuery') return { data: { produtos: [] } };
    return { data: {} };
  } }) }) };
  const { win } = carregarPagina({ regrasCol, usuariosCol: USUARIOS, firebaseMock });
  await abrirAbaRegras(win);
  const r = await win._comprasInternals.sincronizarRegrasAutomaticamente();
  assert.equal(r.semConta, 1);
  assert.equal(regrasCol._registro.size, 0);
});

// ── Cobertura temporária ────────────────────────────────────────────────
test('Cobertura temporária: ativar grava o par origem/substituto; recusa duplicar cobertura ativa pra quem já está coberto', async () => {
  const coberturaCol = mockColecao([]);
  const { win, document } = carregarPagina({ usuariosCol: USUARIOS, coberturaCol });
  await abrirAbaRegras(win);
  document.getElementById('comp-cob-origem').value = 'u-dilma';
  document.getElementById('comp-cob-substituto').value = 'u-marta';
  document.getElementById('comp-cob-motivo').value = 'férias';
  document.querySelector('[data-comp-cob-ativar]').click();
  await new Promise(r => setTimeout(r, 0));
  const gravado = [...coberturaCol._registro.values()][0];
  assert.equal(gravado.origemUid, 'u-dilma');
  assert.equal(gravado.substitutoUid, 'u-marta');
  assert.equal(gravado.motivo, 'férias');
  assert.equal(gravado.ativo, true);
  assert.match(document.getElementById('page-compras-central').innerHTML, /Dilma Souza/);

  // 2ª tentativa pra mesma origem (já coberta) é recusada, não duplica:
  document.getElementById('comp-cob-origem').value = 'u-dilma';
  document.getElementById('comp-cob-substituto').value = 'u-fabricio';
  document.querySelector('[data-comp-cob-ativar]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(coberturaCol._registro.size, 1, 'não cria uma 2ª cobertura ativa pra quem já tem uma');
});

test('Cobertura temporária: encerrar marca ativo:false (não apaga o histórico) e some da lista', async () => {
  const coberturaCol = mockColecao([{ id: 'c1', data: { origemUid: 'u-dilma', origemNome: 'Dilma Souza', substitutoUid: 'u-marta', substitutoNome: 'Marta Lima', ativo: true } }]);
  const { win, document } = carregarPagina({ usuariosCol: USUARIOS, coberturaCol });
  await abrirAbaRegras(win);
  assert.ok(document.querySelector('[data-comp-cob-encerrar="c1"]'), 'linha da cobertura ativa aparece na tabela');
  document.querySelector('[data-comp-cob-encerrar="c1"]').click();
  await new Promise(r => setTimeout(r, 0));
  const doc = coberturaCol._registro.get('c1');
  assert.equal(doc.ativo, false);
  assert.ok(doc.encerradoEm);
  // "Dilma Souza" continua aparecendo nos <select> de origem/substituto
  // (lista de compradores, sempre completa) — o que precisa sumir é a
  // LINHA da cobertura na tabela de coberturas ativas.
  assert.equal(document.querySelector('[data-comp-cob-encerrar="c1"]'), null);
  assert.match(document.getElementById('page-compras-central').innerHTML, /Nenhuma cobertura ativa/);
});

test('firestore.rules: compras_cobertura_temporaria é global (fora de lojas), leitura por visualizar e escrita só com configurar', () => {
  const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/compras_cobertura_temporaria\/\{docId\}/);
  const bloco = rules.slice(rules.indexOf('match /compras_cobertura_temporaria'), rules.indexOf('match /compras_cobertura_temporaria') + 400);
  assert.match(bloco, /hasPermission\('compras-central', 'visualizar'\)/);
  assert.match(bloco, /hasPermission\('compras-central', 'configurar'\)/);
});
