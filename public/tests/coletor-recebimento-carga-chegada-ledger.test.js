// Coletor > Recebimento > Transbordo — gatilho de ledger de paletes na
// CHEGADA de um transbordo GERADO por uma carga (Montagem/Expedição,
// 26-recebimento-cargas.js). Hook dentro de _aplicarBipRecebimento
// (22-recebimento.js): quando o bip muda o status pra CHEGOU e o doc tem
// `cargaId`, debita `emTransito` na ORIGEM e credita `disponivel` no
// DESTINO — CHEGOU (não FINALIZADO) é o gatilho porque é onde o destino
// confirma posse física de verdade (decisão já validada no plano). Um
// transbordo AD-HOC (bip do QR do motorista, sem `cargaId`) nunca acorda
// esse hook — coberto pela suíte de regressão de coletor-fase4-recebimento.
//
// PEDIDO AO VIVO (2026-09-08): "se o palete tiver em trânsito ele tem que
// tá com o número na loja de destino, não da loja que tá saindo" — o
// Em Trânsito agora é lançado direto no DESTINO desde a expedição
// (26-recebimento-cargas.js), então a chegada só precisa fechar o ciclo
// NO DESTINO (tira do Em Trânsito, põe no Disponível) — a origem não
// carrega mais esse saldo, não há nada pra debitar lá.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const recCode = fs.readFileSync(path.join(__dirname, '../js/coletor/22-recebimento.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data, exists: true })) }),
    doc: id => ({
      id,
      get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; },
      update: async p => { const a = registro.get(id); if (a === undefined) throw new Error('NOT_FOUND'); registro.set(id, { ...a, ...p }); },
    }),
    _registro: registro,
  };
}

// lojasSub: { [lojaId]: { recebimentos: mockColecao(...), recebimento_transbordo_cargas: mockColecao(...) } }
function mockRawFirestore(lojasSub) {
  return {
    collection: nome => {
      if (nome !== 'lojas') return mockColecao([]);
      return {
        doc: lojaId => ({
          collection: sub => (lojasSub[lojaId] && lojasSub[lojaId][sub]) || mockColecao([]),
        }),
      };
    },
  };
}

function loadRecebimento(lojasSub, opts) {
  const chamadasLedger = [];
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.APP = { operador: { email: 'operador@daterrinha.com' } };
  win.toast = () => {};
  win.getDTLojaAtiva = () => (opts && opts.lojaAtivaId) || 'loja2'; // por padrão, o teste roda do lado do DESTINO bipando a chegada
  win.getDTRawFirestore = () => mockRawFirestore(lojasSub);
  win.FS = { collection: nome => (lojasSub[win.getDTLojaAtiva()] && lojasSub[win.getDTLojaAtiva()][nome]) || mockColecao([]) };
  win._aplicarMovimentoLedger = async function (lojaId, tipo, deltas, referencia) {
    chamadasLedger.push({ lojaId, tipo, deltas, referencia });
    if (opts && opts.ledgerFalha) throw new Error('Falha simulada no ledger');
  };
  win.eval(recCode);
  return { window: win, chamadasLedger };
}

const TRANSBORDO_DE_CARGA = {
  id: 'r1',
  data: {
    tipo: 'TRANSBORDO', status: 'EM_TRANSITO',
    origemLojaId: 'loja1', destinoLojaId: 'loja2',
    cargaId: 'c1', motoristaNome: 'Carlos',
    acesso_todas_lojas: true,
  },
};

test('bip de CHEGADA num transbordo COM cargaId: desconta emTransito e credita disponível, os dois no DESTINO, usando totalPaletesFisico da carga', async () => {
  const recebimentosOrigem = mockColecao([TRANSBORDO_DE_CARGA]);
  const cargasOrigem = mockColecao([{ id: 'c1', data: { totalPaletesFisico: 3 } }]);
  const { window, chamadasLedger } = loadRecebimento({
    loja1: { recebimentos: recebimentosOrigem, recebimento_transbordo_cargas: cargasOrigem },
  });

  const r = { _id: 'r1', _lojaId: 'loja1', ...TRANSBORDO_DE_CARGA.data };
  await window._aplicarBipRecebimento(r, 'CHEGADA_REGISTRADA', { status: 'CHEGOU', horaChegada: '2026-09-04T10:00:00.000Z' }, 'Chegada registrada', { silencioso: true });

  assert.equal(chamadasLedger.length, 1, 'Em Trânsito já mora no destino desde a expedição — a chegada só fecha o ciclo lá, uma chamada só');
  const destino = chamadasLedger[0];
  assert.equal(destino.lojaId, 'loja2', 'a única movimentação é no destino');
  assert.equal(destino.tipo, 'TRANSBORDO_RECEBIMENTO');
  assert.equal(destino.deltas.emTransitoDelta, -3);
  assert.equal(destino.deltas.disponivelDelta, 3);
  assert.equal(destino.referencia.id, 'r1');
  assert.equal(recebimentosOrigem._registro.get('r1').status, 'CHEGOU', 'o bip principal continua funcionando normalmente');
});

test('bip de CHEGADA num transbordo AD-HOC (sem cargaId): nunca aciona o ledger de paletes', async () => {
  const recebimentosOrigem = mockColecao([{ id: 'r2', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origemLojaId: 'loja1', destinoLojaId: 'loja2', acesso_todas_lojas: true } }]);
  const { window, chamadasLedger } = loadRecebimento({ loja1: { recebimentos: recebimentosOrigem } });

  const r = { _id: 'r2', _lojaId: 'loja1', tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origemLojaId: 'loja1', destinoLojaId: 'loja2', acesso_todas_lojas: true };
  await window._aplicarBipRecebimento(r, 'CHEGADA_REGISTRADA', { status: 'CHEGOU', horaChegada: '2026-09-04T10:00:00.000Z' }, 'Chegada registrada', { silencioso: true });

  assert.equal(chamadasLedger.length, 0, 'transbordo sem cargaId é o fluxo ad-hoc de sempre, não deve mexer no ledger de paletes');
});

test('bip de CHEGADA repetido (retry) no MESMO transbordo não conta o ledger 2 vezes (proteção contra corrida/reenvio)', async () => {
  const recebimentosOrigem = mockColecao([TRANSBORDO_DE_CARGA]);
  const cargasOrigem = mockColecao([{ id: 'c1', data: { totalPaletesFisico: 3 } }]);
  const { window, chamadasLedger } = loadRecebimento({
    loja1: { recebimentos: recebimentosOrigem, recebimento_transbordo_cargas: cargasOrigem },
  });

  const r = { _id: 'r1', _lojaId: 'loja1', ...TRANSBORDO_DE_CARGA.data };
  await window._aplicarBipRecebimento(r, 'CHEGADA_REGISTRADA', { status: 'CHEGOU', horaChegada: '2026-09-04T10:00:00.000Z' }, 'Chegada registrada', { silencioso: true });
  // 2ª tentativa (ex.: reenvio da fila offline, ou toque duplicado) — o
  // servidor já está em CHEGOU nesse ponto (releitura via atualSnap detecta).
  await window._aplicarBipRecebimento(r, 'CHEGADA_REGISTRADA', { status: 'CHEGOU', horaChegada: '2026-09-04T10:00:05.000Z' }, 'Chegada registrada', { silencioso: true });

  assert.equal(chamadasLedger.length, 1, 'só a 1ª aplicação deveria ter mexido no ledger (1 chamada, no destino), não 2');
});

test('carga sem totalPaletesFisico (montagem nunca finalizada) não aciona o ledger com 0 paletes', async () => {
  const recebimentosOrigem = mockColecao([TRANSBORDO_DE_CARGA]);
  const cargasOrigem = mockColecao([{ id: 'c1', data: { totalPaletesFisico: null } }]);
  const { window, chamadasLedger } = loadRecebimento({
    loja1: { recebimentos: recebimentosOrigem, recebimento_transbordo_cargas: cargasOrigem },
  });

  const r = { _id: 'r1', _lojaId: 'loja1', ...TRANSBORDO_DE_CARGA.data };
  await window._aplicarBipRecebimento(r, 'CHEGADA_REGISTRADA', { status: 'CHEGOU', horaChegada: '2026-09-04T10:00:00.000Z' }, 'Chegada registrada', { silencioso: true });

  assert.equal(chamadasLedger.length, 0);
});

test('falha no ledger (rede) não impede o bip de CHEGADA de ser salvo', async () => {
  const recebimentosOrigem = mockColecao([TRANSBORDO_DE_CARGA]);
  const cargasOrigem = mockColecao([{ id: 'c1', data: { totalPaletesFisico: 3 } }]);
  const { window } = loadRecebimento(
    { loja1: { recebimentos: recebimentosOrigem, recebimento_transbordo_cargas: cargasOrigem } },
    { ledgerFalha: true }
  );

  const r = { _id: 'r1', _lojaId: 'loja1', ...TRANSBORDO_DE_CARGA.data };
  await window._aplicarBipRecebimento(r, 'CHEGADA_REGISTRADA', { status: 'CHEGOU', horaChegada: '2026-09-04T10:00:00.000Z' }, 'Chegada registrada', { silencioso: true });

  assert.equal(recebimentosOrigem._registro.get('r1').status, 'CHEGOU', 'falha no ledger não pode impedir o bip principal de salvar');
});
