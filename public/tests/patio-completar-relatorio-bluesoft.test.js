// Pátio em Tempo Real — completar notas com os relatórios "Monitoramento
// Geral" da Bluesoft (105-recebimento-patio-tempo-real.js). Só preenche
// campo vazio; nunca troca valor já gravado; NF repetida com dado diferente
// vira conflito e não é usada.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const patioCode = fs.readFileSync(path.join(__dirname, '../js/analista/105-recebimento-patio-tempo-real.js'), 'utf8');

// Objetos criados dentro do JSDOM têm outro realm: comparo como JSON.
const igual = (real, esperado) => assert.equal(JSON.stringify(real), JSON.stringify(esperado));

function carregarPatio() {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-patio-tempo-real"></div></body></html>', { runScripts: 'outside-only' });
  dom.window.getDTFirestore = () => ({ collection: () => ({}) });
  dom.window.getDTRawFirestore = () => ({});
  dom.window.eval(patioCode);
  return { window: dom.window, internals: dom.window._recebimentoPatioTempoRealInternals, close: () => dom.window.close() };
}

// Linhas no formato de sheet_to_json(header:'A'), com as colunas reais
// da planilha Monitoramento Geral (A viagem, L NF-série, M valor, O destinatário).
function linha(nf, valor, destinatario, viagem = 435370) {
  return { A: viagem, B: 'SP - REGIAO SUL - 04', L: nf, M: valor, O: destinatario };
}
const JE = 'J E COMERCIO E REPRESENTACOES LTDA';

test('índice lê NF-série, valor e destinatário das colunas certas', () => {
  const { internals, close } = carregarPatio();
  try {
    const indice = internals.indiceRelatoriosBluesoft([[linha('181357-1', 3420, JE), linha('182724-1', 72470.86, JE, 436425)]]);
    assert.equal(indice.linhasNf, 2);
    igual(internals.achaNotaNoRelatorio(indice, { numeroNota: '181357', serie: '1' }), { destinatario: JE, valor: 3420, conflito: false });
  } finally { close(); }
});

test('ignora linhas de cabeçalho e filtros (sem NF-série válida)', () => {
  const { internals, close } = carregarPatio();
  try {
    const indice = internals.indiceRelatoriosBluesoft([[{ A: 'Filial', L: 'TODAS' }, { A: 435370, L: 'NF-série' }, linha('181357-1', 3420, JE)]]);
    assert.equal(indice.linhasNf, 1);
  } finally { close(); }
});

test('zero-à-esquerda e série em texto casam com a nota do pátio', () => {
  const { internals, close } = carregarPatio();
  try {
    const indice = internals.indiceRelatoriosBluesoft([[linha('000181357-2', 100, JE)]]);
    assert.equal(internals.achaNotaNoRelatorio(indice, { numeroNota: '181357', serie: '2' }).valor, 100);
    assert.equal(internals.achaNotaNoRelatorio(indice, { numeroNota: '181357', serie: '1' }), null);
  } finally { close(); }
});

test('NF repetida nos 3 arquivos com mesmo dado não vira conflito', () => {
  const { internals, close } = carregarPatio();
  try {
    const indice = internals.indiceRelatoriosBluesoft([[linha('181357-1', 3420, JE)], [linha('181357-1', 3420, JE)]]);
    assert.equal(internals.achaNotaNoRelatorio(indice, { numeroNota: '181357', serie: '1' }).conflito, false);
  } finally { close(); }
});

test('NF repetida com valor diferente vira conflito e não é usada', () => {
  const { internals, close } = carregarPatio();
  try {
    const indice = internals.indiceRelatoriosBluesoft([[linha('181357-1', 3420, JE)], [linha('181357-1', 3500, JE)]]);
    igual(internals.achaNotaNoRelatorio(indice, { numeroNota: '181357', serie: '1' }), { conflito: true });
  } finally { close(); }
});

test('nota sem série: usa o número só quando existe uma única série no relatório', () => {
  const { internals, close } = carregarPatio();
  try {
    const unica = internals.indiceRelatoriosBluesoft([[linha('181357-1', 3420, JE)]]);
    assert.equal(internals.achaNotaNoRelatorio(unica, { numeroNota: '181357' }).valor, 3420);
    const duas = internals.indiceRelatoriosBluesoft([[linha('181357-1', 3420, JE), linha('181357-2', 90, 'OUTRO')]]);
    igual(internals.achaNotaNoRelatorio(duas, { numeroNota: '181357' }), { conflito: true });
  } finally { close(); }
});

test('nota fora do relatório devolve null', () => {
  const { internals, close } = carregarPatio();
  try {
    const indice = internals.indiceRelatoriosBluesoft([[linha('181357-1', 3420, JE)]]);
    assert.equal(internals.achaNotaNoRelatorio(indice, { numeroNota: '999999', serie: '1' }), null);
    assert.equal(internals.achaNotaNoRelatorio(indice, { numeroNota: '', serie: '1' }), null);
  } finally { close(); }
});

test('planejar: preenche só o que está vazio na nota', () => {
  const { internals, close } = carregarPatio();
  try {
    const achada = { destinatario: JE, valor: 3420, conflito: false };
    igual(internals.planejarCompletarNota({}, { numeroNota: '181357' }, achada), { destinatario: JE, valorTotal: 3420 });
    igual(internals.planejarCompletarNota({}, { destinatario: 'JA TEM', valorTotal: 500 }, achada), {});
  } finally { close(); }
});

test('planejar: valor zero conta como vazio, e herança do documento vale', () => {
  const { internals, close } = carregarPatio();
  try {
    const achada = { destinatario: JE, valor: 3420, conflito: false };
    igual(internals.planejarCompletarNota({ valorTotal: 0 }, { numeroNota: '1' }, achada), { destinatario: JE, valorTotal: 3420 });
    igual(internals.planejarCompletarNota({ destinatario: 'DO DOCUMENTO', valorTotal: 800 }, { numeroNota: '1' }, achada), {});
  } finally { close(); }
});
