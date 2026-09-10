// PEDIDO AO VIVO (2026-09-04): "no lugar de ficar entrando no coletor e
// ficar indo no analista aprovar... quero que no analista cadastre o ID do
// coletor e na hora que abrir o aplicativo ele já peça o id pra aprovar, e
// depois fique aprovado" — lado do Analista: gera um código em
// dt_codigos_coletor com o nome já escolhido pro aparelho, lista os
// códigos ainda não usados e permite cancelar um gerado por engano. O
// resgate de fato (transformar o código em aprovação) acontece só na Cloud
// Function resgatarCodigoAprovacaoColetor (não testada aqui — ver
// functions/test/resgatar-codigo-aprovacao-coletor.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const jsAnalista = path.join(__dirname, '..', 'js', 'analista');
const jsShared = path.join(__dirname, '..', 'js', 'shared');

function criarColecaoCodigos(seed) {
  const registro = new Map(Object.entries(seed || {}));
  return {
    _registro: registro,
    doc: (id) => ({
      get: async () => ({ exists: registro.has(id), data: () => registro.get(id) }),
      set: async (payload) => { registro.set(id, payload); },
      delete: async () => { registro.delete(id); },
    }),
    where: (campo, _op, valor) => ({
      get: async () => ({
        docs: [...registro.entries()].filter(([, d]) => d[campo] === valor).map(([id, d]) => ({ id, data: () => d })),
      }),
    }),
  };
}

function loadColetoresAnalista(seedCodigos) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const colecaoCodigos = criarColecaoCodigos(seedCodigos);
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'dt_codigos_coletor' ? colecaoCodigos : criarColecaoCodigos() });
  win.firebase = { auth: () => ({ currentUser: { email: 'analista@daterrinhaalimentos.com.br' } }), firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => 'FV_DELETE' } } };
  win.openModal = () => {}; win.closeModal = () => {};
  win.showToast = () => {};
  win.logAuditoria = () => {};
  win.renderColetores = () => {};
  win.confirm = () => true;
  const estado = { coletores: [], contagens: [], inventarios: [] };
  win.AnalistaStore = { getState: () => estado };
  win.AnalistaState = { replaceSlice: (chave, valor) => { estado[chave] = valor; } };
  win.localStorage = { getItem: () => null, setItem: () => {} };
  win.setInterval = () => 0; // ver comentário em coletores-operador-atual.test.js — evita travar o node --test
  // Evals separados: common-utils.js é 'use strict', e concatenado no mesmo
  // eval faz as funções de 34 pararem de virar propriedade de window.
  const commonUtils = fs.readFileSync(path.join(jsShared, 'common-utils.js'), 'utf8');
  const codigo34 = fs.readFileSync(path.join(jsAnalista, '34-coletores-modelo-dispositivo.js'), 'utf8');
  win.eval(commonUtils);
  win.eval(codigo34);
  return { window: win, colecaoCodigos };
}

test('gerarCodigoAprovacaoColetor: sem nome informado, não gera nada e avisa', async () => {
  const { window } = loadColetoresAnalista();
  const avisos = [];
  window.showToast = (msg) => avisos.push(msg);
  const codigo = await window.gerarCodigoAprovacaoColetor('   ');
  assert.equal(codigo, null);
  assert.match(avisos[0], /Dê um nome/);
});

test('gerarCodigoAprovacaoColetor: com nome, gera um código de 6 caracteres, grava usado:false e o nome do coletor', async () => {
  const { window, colecaoCodigos } = loadColetoresAnalista();
  const codigo = await window.gerarCodigoAprovacaoColetor('Coletor Câmara Fria');
  assert.equal(typeof codigo, 'string');
  assert.equal(codigo.length, 6);
  const gravado = colecaoCodigos._registro.get(codigo);
  assert.ok(gravado, 'o código vira o próprio id do documento');
  assert.equal(gravado.nome_coletor, 'Coletor Câmara Fria');
  assert.equal(gravado.usado, false);
  assert.equal(gravado.codigo, codigo);
});

test('gerarCodigoAprovacaoColetor: nunca usa caracteres ambíguos (O/0/I/1) — evita erro de digitação no aparelho', async () => {
  const { window } = loadColetoresAnalista();
  for (let i = 0; i < 30; i++) {
    const codigo = await window.gerarCodigoAprovacaoColetor('Teste ' + i);
    assert.doesNotMatch(codigo, /[O0I1]/);
  }
});

test('carregarCodigosAprovacaoColetorPendentes: lista só os códigos com usado:false, mais recente primeiro', async () => {
  const { window } = loadColetoresAnalista({
    AAA111: { codigo: 'AAA111', nome_coletor: 'Antigo', usado: false, criado_em: '2026-01-01T00:00:00.000Z' },
    BBB222: { codigo: 'BBB222', nome_coletor: 'Recente', usado: false, criado_em: '2026-02-01T00:00:00.000Z' },
    CCC333: { codigo: 'CCC333', nome_coletor: 'Já usado', usado: true, criado_em: '2026-03-01T00:00:00.000Z' },
  });
  const lista = await window.carregarCodigosAprovacaoColetorPendentes();
  assert.equal(lista.length, 2, 'código já usado não aparece na lista de pendentes');
  assert.equal(lista[0].id, 'BBB222', 'mais recente primeiro');
  assert.equal(lista[1].id, 'AAA111');
});

test('cancelarCodigoAprovacaoColetor: remove o código do banco quando confirmado', async () => {
  const { window, colecaoCodigos } = loadColetoresAnalista({
    AAA111: { codigo: 'AAA111', nome_coletor: 'X', usado: false },
  });
  window.confirm = () => true;
  const ok = await window.cancelarCodigoAprovacaoColetor('AAA111');
  assert.equal(ok, true);
  assert.equal(colecaoCodigos._registro.has('AAA111'), false);
});

test('cancelarCodigoAprovacaoColetor: cancelado o confirm(), não remove nada', async () => {
  const { window, colecaoCodigos } = loadColetoresAnalista({
    AAA111: { codigo: 'AAA111', nome_coletor: 'X', usado: false },
  });
  window.confirm = () => false;
  const ok = await window.cancelarCodigoAprovacaoColetor('AAA111');
  assert.equal(ok, false);
  assert.equal(colecaoCodigos._registro.has('AAA111'), true);
});
