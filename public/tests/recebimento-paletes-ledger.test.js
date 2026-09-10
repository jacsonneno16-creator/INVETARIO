// Coletor > Recebimento > Ledger de Paletes (Disponível / Em Trânsito / Total).
// Utilitário puro (28-recebimento-paletes-ledger.js) — sem UI própria, usado
// por 25/26/27 pra alimentar o saldo de paletes a cada movimentação. Escrita
// SEMPRE via getDTRawFirestore() (nunca o proxy FS, que só escreve na loja
// ATIVA) porque a escrita pode ser cross-loja (quem confirma a chegada numa
// loja debita `emTransito` na loja de ORIGEM).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../js/coletor/28-recebimento-paletes-ledger.js'), 'utf8');

// obterLedgerPaletes() roda dentro do win.eval() (JSDOM) e devolve um objeto
// literal construído no realm da JSDOM — assert.deepEqual contra um literal
// do realm do Node rejeita mesmo com conteúdo idêntico (gotcha de
// identidade cross-realm já visto nesta sessão, ver
// recebimento-paletes-monitoramento.test.js). Compara campo a campo.
function assertLedgerIgual(ledger, esperado) {
  assert.equal(ledger.disponivel, esperado.disponivel);
  assert.equal(ledger.emTransito, esperado.emTransito);
  assert.equal(ledger.total, esperado.total);
}

const INCREMENT = Symbol('increment');

// Mock mínimo de getDTRawFirestore() cobrindo só o que o ledger usa:
// lojas/{lojaId}/recebimento_paletes_ledger/atual (doc único, set com merge
// + FieldValue.increment) e lojas/{lojaId}/recebimento_paletes_movimentos
// (collection só de `add`, log de auditoria).
function mockRawFirestore(estadoInicial) {
  const ledgers = new Map(Object.keys(estadoInicial || {}).map(lojaId => [lojaId, Object.assign({}, estadoInicial[lojaId])]));
  const movimentos = new Map(); // lojaId -> array de payloads gravados
  function aplicarSet(lojaId, payload) {
    const atual = ledgers.get(lojaId) || {};
    const novo = Object.assign({}, atual);
    Object.keys(payload).forEach(k => {
      const v = payload[k];
      if (v && v[INCREMENT] !== undefined) {
        novo[k] = (typeof atual[k] === 'number' ? atual[k] : 0) + v[INCREMENT];
      } else {
        novo[k] = v;
      }
    });
    ledgers.set(lojaId, novo);
    return novo;
  }
  return {
    _ledgers: ledgers,
    _movimentos: movimentos,
    collection: nome => {
      if (nome !== 'lojas') return { get: async () => ({ docs: [] }) };
      return {
        doc: lojaId => ({
          collection: sub => {
            if (sub === 'recebimento_paletes_ledger') {
              return {
                doc: id => ({
                  get: async () => {
                    const dados = ledgers.get(lojaId);
                    return { exists: dados !== undefined, data: () => dados };
                  },
                  set: async (payload) => { aplicarSet(lojaId, payload); },
                }),
              };
            }
            if (sub === 'recebimento_paletes_movimentos') {
              return {
                add: async (payload) => {
                  const lista = movimentos.get(lojaId) || [];
                  lista.push(payload);
                  movimentos.set(lojaId, lista);
                  return { id: 'mov' + lista.length };
                },
              };
            }
            throw new Error('subcoleção inesperada: ' + sub);
          },
        }),
      };
    },
  };
}

function carregarLedger(estadoInicial, opts) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const raw = mockRawFirestore(estadoInicial);
  win.getDTRawFirestore = () => raw;
  win.APP = { operador: { email: (opts && opts.autor) || 'operador@daterrinha.com' } };
  win.firebase = { firestore: { FieldValue: { increment: n => ({ [INCREMENT]: n }) } } };
  win.eval(code);
  return { win, raw };
}

test('_aplicarMovimentoLedger: primeiro movimento numa loja sem ledger ainda cria o doc do zero (increment em campo ausente vira o próprio delta)', async () => {
  const { win, raw } = carregarLedger({});
  await win._aplicarMovimentoLedger('loja1', 'SAIDA_EXTERNA', { disponivelDelta: -20, emTransitoDelta: 20 }, { colecao: 'recebimento_paletes', id: 'p1' });

  const ledger = await win.obterLedgerPaletes('loja1');
  assertLedgerIgual(ledger, { disponivel: -20, emTransito: 20, total: 0 });
});

test('_aplicarMovimentoLedger: acumula corretamente em movimentos sucessivos (increment, não sobrescreve)', async () => {
  const { win } = carregarLedger({ loja1: { disponivel: 100, emTransito: 0, total: 100 } });

  await win._aplicarMovimentoLedger('loja1', 'SAIDA_EXTERNA', { disponivelDelta: -30, emTransitoDelta: 30 }, {});
  await win._aplicarMovimentoLedger('loja1', 'RETORNO_EXTERNO', { disponivelDelta: 25, emTransitoDelta: -30 }, {});

  const ledger = await win.obterLedgerPaletes('loja1');
  // saiu 30 (disp 100->70, transito 0->30); voltou 25 de 30 (disp 70->95, transito 30->0)
  // -> 5 paletes "perdidos" ficam contando como emTransito pra sempre, igual saldoDe() do monitoramento já faz hoje
  assertLedgerIgual(ledger, { disponivel: 95, emTransito: 0, total: 95 });
});

test('_aplicarMovimentoLedger: total é sempre a soma dos dois deltas, nunca informado à parte', async () => {
  const { win, raw } = carregarLedger({});
  await win._aplicarMovimentoLedger('loja2', 'TRANSBORDO_EXPEDICAO', { disponivelDelta: -10, emTransitoDelta: 10 }, {});
  const dados = raw._ledgers.get('loja2');
  assert.equal(dados.total, 0);
  assert.equal(dados.disponivel, -10);
  assert.equal(dados.emTransito, 10);
});

test('_aplicarMovimentoLedger: escreve em loja diferente da "ativa" (cross-loja) — usa getDTRawFirestore, não um proxy de loja única', async () => {
  const { win } = carregarLedger({});
  await win._aplicarMovimentoLedger('loja-origem', 'TRANSBORDO_EXPEDICAO', { disponivelDelta: -5, emTransitoDelta: 5 }, {});
  await win._aplicarMovimentoLedger('loja-destino', 'TRANSBORDO_RECEBIMENTO', { emTransitoDelta: 0, disponivelDelta: 5 }, {});

  const origem = await win.obterLedgerPaletes('loja-origem');
  const destino = await win.obterLedgerPaletes('loja-destino');
  assertLedgerIgual(origem, { disponivel: -5, emTransito: 5, total: 0 });
  assertLedgerIgual(destino, { disponivel: 5, emTransito: 0, total: 5 });
});

test('_aplicarMovimentoLedger: grava o log de auditoria em recebimento_paletes_movimentos ANTES do increment, com tipo/deltas/referência', async () => {
  const { win, raw } = carregarLedger({});
  await win._aplicarMovimentoLedger('loja1', 'TRANSFERENCIA_EXPEDICAO', { disponivelDelta: -8, emTransitoDelta: 8 }, { colecao: 'recebimento_transferencias_paletes', id: 't1' });

  const lista = raw._movimentos.get('loja1');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].tipo, 'TRANSFERENCIA_EXPEDICAO');
  assert.equal(lista[0].disponivelDelta, -8);
  assert.equal(lista[0].emTransitoDelta, 8);
  assert.equal(lista[0].totalDelta, 0);
  assert.equal(lista[0].referenciaColecao, 'recebimento_transferencias_paletes');
  assert.equal(lista[0].referenciaId, 't1');
  assert.equal(lista[0].criadoPor, 'operador@daterrinha.com');
  assert.ok(lista[0].criadoEm);
});

test('_aplicarMovimentoLedger: rejeita chamada sem lojaId ou sem tipo (uso incorreto, não silencioso)', async () => {
  const { win } = carregarLedger({});
  await assert.rejects(() => win._aplicarMovimentoLedger('', 'SAIDA_EXTERNA', {}, {}));
  await assert.rejects(() => win._aplicarMovimentoLedger('loja1', '', {}, {}));
});

test('obterLedgerPaletes: loja sem nenhum movimento ainda retorna zerado, não null/undefined', async () => {
  const { win } = carregarLedger({});
  const ledger = await win.obterLedgerPaletes('loja-nunca-usada');
  assertLedgerIgual(ledger, { disponivel: 0, emTransito: 0, total: 0 });
});
