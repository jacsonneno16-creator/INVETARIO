'use strict';
// Estoque · Operações via Arquivo — V12 (2026-10-08): endereçamento confere o
// destino sugerido pela própria BlueSoft (capacidade não é exposta por nenhuma
// API de leitura — confirmado na spec OpenAPI real); descarte reaproveita o
// Lote de Trocas filtrando motivos de nome descarte/perda/quebra; devoluções
// são só-leitura. Testes complementares ao mock entregue (estoque-v12.mock.test.js),
// no padrão node:test já usado no resto do projeto.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function carregar() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', {value: () => ({}), configurable: true});
  return require(path.join(__dirname, '..', 'index.js'))._estoqueBluesoftInternals;
}

function comFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { global.fetch = original; });
}

test('_eopConsultarPaletesPagina: para na 1ª página incompleta (<100) e marca completa=true', async () => {
  const {_eopConsultarPaletesPagina} = carregar();
  await comFetch(async () => ({ok: true, status: 200, text: async () => JSON.stringify({data: [{paleteKey: 1, enderecoDeDestinoKey: 10}, {paleteKey: 2, enderecoDeDestinoKey: 20}]})}), async () => {
    const r = await _eopConsultarPaletesPagina({ambiente: 'homologacao', url_hml: 'https://x', token: 't'}, '1', 50);
    assert.equal(r.completa, true);
    assert.equal(r.paletes.size, 2);
  });
});

test('_eopConsultarPaletesPagina: página cheia (100) sem sinal de última página não afirma completude', async () => {
  const {_eopConsultarPaletesPagina} = carregar();
  let chamadas = 0;
  await comFetch(async () => {
    chamadas++;
    const linha = Array.from({length: 100}, (_, i) => ({paleteKey: chamadas * 1000 + i, enderecoDeDestinoKey: 1}));
    return {ok: true, status: 200, text: async () => JSON.stringify({data: linha})};
  }, async () => {
    const r = await _eopConsultarPaletesPagina({ambiente: 'homologacao', url_hml: 'https://x', token: 't'}, '1', 2);
    assert.equal(r.completa, false, 'bateu no limite de páginas sem a BlueSoft confirmar fim da lista — nunca afirmar completa');
    assert.equal(chamadas, 2);
  });
});

test('_eopConsultarPaletesPagina: ignora item sem paleteKey numérico válido, sem derrubar a consulta', async () => {
  const {_eopConsultarPaletesPagina} = carregar();
  await comFetch(async () => ({ok: true, status: 200, text: async () => JSON.stringify({data: [{paleteKey: 'abc'}, {paleteKey: 5, enderecoDeDestinoKey: 1}]})}), async () => {
    const r = await _eopConsultarPaletesPagina({ambiente: 'homologacao', url_hml: 'https://x', token: 't'}, '1', 10);
    assert.equal(r.paletes.size, 1);
    assert.ok(r.paletes.has('5'));
  });
});

test('_eopConferirCadastroAntesPost(troca): recusa motivoTrocaKey que a BlueSoft não reconhece, sem fazer POST', async () => {
  const {_eopConferirCadastroAntesPost} = carregar();
  await comFetch(async () => ({ok: true, status: 200, text: async () => JSON.stringify([{motivoTrocaKey: 1, nome: 'Troca comercial'}])}), async () => {
    await assert.rejects(
      _eopConferirCadastroAntesPost([{motivoTrocaKey: 999}], 'troca', {ambiente: 'homologacao', url_hml: 'https://x', token: 't'}),
      /motivo de troca não confirmado/
    );
  });
});

test('_eopConferirCadastroAntesPost(troca): aceita quando o motivo existe na resposta real da BlueSoft', async () => {
  const {_eopConferirCadastroAntesPost} = carregar();
  await comFetch(async () => ({ok: true, status: 200, text: async () => JSON.stringify([{motivoTrocaKey: 1, nome: 'Descarte'}])}), async () => {
    await assert.doesNotReject(_eopConferirCadastroAntesPost([{motivoTrocaKey: 1}], 'troca', {ambiente: 'homologacao', url_hml: 'https://x', token: 't'}));
  });
});

test('_eopConferirCadastroAntesPost(transf): transformacaoKey ambíguo (produto com várias) é recusado antes do POST', async () => {
  const {_eopConferirCadastroAntesPost} = carregar();
  await comFetch(async () => ({ok: true, status: 200, text: async () => JSON.stringify([{transformacaoKey: 1}, {transformacaoKey: 2}])}), async () => {
    await assert.rejects(
      _eopConferirCadastroAntesPost([{produtoKey: 777}], 'transf', {ambiente: 'homologacao', url_hml: 'https://x', token: 't'}),
      /ambígua ou sem código válido/
    );
  });
});

test('_eopConferirCadastroAntesPost(transf): produto com transformação única preenche transformacaoKey na própria linha', async () => {
  const {_eopConferirCadastroAntesPost} = carregar();
  await comFetch(async () => ({ok: true, status: 200, text: async () => JSON.stringify([{transformacaoKey: 42}])}), async () => {
    const linha = {produtoKey: 777};
    await _eopConferirCadastroAntesPost([linha], 'transf', {ambiente: 'homologacao', url_hml: 'https://x', token: 't'});
    assert.equal(linha.transformacaoKey, 42);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Invariantes de contrato das 3 novas functions (consulta/estorno) — travam
// no próprio código-fonte que (1) devoluções é SÓ leitura (nunca _eopPost/
// _apBluesoftPost), (2) estorno exige a frase de confirmação explícita e
// nunca reenvia sem ela, (3) descarte filtra motivo por nome real da BlueSoft.
// ═══════════════════════════════════════════════════════════════════════
test('consultarDevolucoesEstoque: nunca chama _eopPost/_apBluesoftPost — é estritamente consulta', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const i = src.indexOf('exports.consultarDevolucoesEstoque');
  const fim = src.indexOf('\n});', i) + 4;
  const corpo = src.slice(i, fim);
  assert.doesNotMatch(corpo, /_eopPost\(|_apBluesoftPost\(/);
  assert.match(corpo, /_bluesoftGetSomenteLeitura/);
});

test('estornarTrocaDescarte: exige a frase exata de confirmação antes de chamar a BlueSoft', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const i = src.indexOf('exports.estornarTrocaDescarte');
  const fim = src.indexOf('\n});', i) + 4;
  const corpo = src.slice(i, fim);
  assert.match(corpo, /data\.confirmacao!==['"]CONFIRMO ESTORNO['"]/);
});

test('gerarLoteTrocasArquivo (finalidade descarte): só libera motivos cujo nome real contenha descarte/perda/quebra', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const i = src.indexOf('exports.gerarLoteTrocasArquivo');
  const fim = src.indexOf('\n});', i) + 4;
  const corpo = src.slice(i, fim);
  assert.match(corpo, /\/descarte\|perda\|quebra\/i\.test\(String\(m\.nome/);
  assert.match(corpo, /_bluesoftGetSomenteLeitura\('\/api\/estoque\/motivos-de-troca'/);
});
