// PEDIDO AO VIVO (auditoria 2ª rodada, seção 14): "Processos de Produção"
// em Configurações chamava openModalProcesso() no original — função que
// não existe em NENHUM arquivo JS do sistema original (confirmado via
// grep completo em public/js e public/pages), então a tela sempre ficou
// vazia lá. Em vez de reproduzir esse bug, implementado um CRUD real
// (nome + tipo) numa coleção própria (producao_processos_tipos). Este
// teste dirige o render real e o fluxo completo de cadastro/edição/
// exclusão via Firestore mockado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/77-producao-config.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({
      id,
      get: async () => ({ exists: registro.has(id), data: () => registro.get(id) }),
      set: async (payload, opts) => { const a = (opts && opts.merge) ? (registro.get(id) || {}) : {}; registro.set(id, { ...a, ...payload }); },
      delete: async () => { registro.delete(id); },
    }),
    add: async (payload) => { const id = 'novo' + registro.size; registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}

function carregarPagina(procsTipos) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-config"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const colProcs = mockColecao(procsTipos);
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_processos_tipos: colProcs,
    }[nome] || mockColecao([])),
  });
  win.DTProducao = { registrarInvalidacao: () => {} };
  win.eval(code);
  return { win, document, colProcs };
}

test('Processos: entra em SEM_TELA de "não implementado"? Não — tem tela própria agora', async () => {
  const { win, document } = carregarPagina([]);
  await win.renderProducaoConfig();
  document.querySelector('[data-pcfg-secao="processos"]').click();
  const html = document.getElementById('page-producao-config').innerHTML;
  assert.doesNotMatch(html, /ainda não foi implementado/);
  assert.match(html, /Processos de Produção/);
  assert.match(html, /\+ Novo Processo/);
});

test('Processos: cadastrar um novo processo grava nome+tipo+ativo no Firestore', async () => {
  const { win, document, colProcs } = carregarPagina([]);
  await win.renderProducaoConfig();
  document.querySelector('[data-pcfg-secao="processos"]').click();

  let chamadas = 0;
  win.prompt = (msg) => { chamadas++; return chamadas === 1 ? 'Mistura Farinha A' : 'mistura'; };
  win.confirm = () => true;
  document.querySelector('[data-pcfg-proc-new]').click();
  await new Promise(r => setTimeout(r, 0));

  const salvos = [...colProcs._registro.values()];
  assert.equal(salvos.length, 1);
  assert.equal(salvos[0].nome, 'Mistura Farinha A');
  assert.equal(salvos[0].tipo, 'mistura');
  assert.equal(salvos[0].ativo, true);
});

test('Processos: excluir remove do Firestore e some da lista', async () => {
  const { win, document, colProcs } = carregarPagina([{ id: 'p1', data: { nome: 'Envase Garrafa', tipo: 'envase', ativo: true } }]);
  await win.renderProducaoConfig();
  document.querySelector('[data-pcfg-secao="processos"]').click();
  let html = document.getElementById('page-producao-config').innerHTML;
  assert.match(html, /Envase Garrafa/);

  win.confirm = () => true;
  document.querySelector('[data-pcfg-proc-del="p1"]').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(colProcs._registro.has('p1'), false);
  html = document.getElementById('page-producao-config').innerHTML;
  assert.doesNotMatch(html, /Envase Garrafa/);
});
