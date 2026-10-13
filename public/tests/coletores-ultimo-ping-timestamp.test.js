'use strict';
// BUG AO VIVO REAL (2026-10-02): "Invalid Date" na coluna Últ. Atividade da
// tela Coletores, e o logout automático por inatividade nunca disparava de
// verdade (sessões com ultimo_ping de DIAS/SEMANAS atrás continuavam
// "Online" com o nome do operador). Raiz: `ultimo_ping` é gravado com
// firebase.firestore.FieldValue.serverTimestamp() (02-sync-dispositivo.js)
// e chegava ao Analista como um objeto Timestamp cru — `new Date(obj)`
// (usado tanto pra exibir quanto pra calcular inatividade) sempre virava
// Invalid Date/NaN, e qualquer comparação `(agora - NaN) > limite` é
// sempre false. firebaseService.js/_normalizarColetores() agora converte
// pra ISO string na entrada dos dados, uma vez só.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function carregar() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.AnalistaActions = {};
  win.AnalistaInventarioService = {};
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', 'firebaseService.js'), 'utf8');
  win.eval(codigo);
  return win;
}

test('_normalizarColetores: converte ultimo_ping de Timestamp do Firestore (objeto com .toDate()) pra string ISO', () => {
  const win = carregar();
  const dataReal = new Date('2026-09-01T12:00:00.000Z');
  const snapshotFake = {
    docs: [
      { id: 'col1', data: () => ({ operador_atual: 'Ana', ultimo_ping: { toDate: () => dataReal } }) },
    ],
  };
  const resultado = win._firebaseServiceInternals.normalizarColetores(snapshotFake);
  assert.equal(resultado[0].ultimo_ping, '2026-09-01T12:00:00.000Z');
  assert.ok(!isNaN(new Date(resultado[0].ultimo_ping).getTime()), 'precisa virar uma data válida, nunca mais Invalid Date');
});

test('_normalizarColetores: ultimo_ping ausente não quebra (vira string vazia, não undefined/erro)', () => {
  const win = carregar();
  const snapshotFake = { docs: [{ id: 'col1', data: () => ({ operador_atual: 'Ana' }) }] };
  const resultado = win._firebaseServiceInternals.normalizarColetores(snapshotFake);
  assert.equal(resultado[0].ultimo_ping, '');
});

test('_normalizarColetores: ultimo_ping já em string (caminho legado/local) passa direto, sem tentar converter de novo', () => {
  const win = carregar();
  const snapshotFake = { docs: [{ id: 'col1', data: () => ({ ultimo_ping: '2026-10-01T10:00:00.000Z' }) }] };
  const resultado = win._firebaseServiceInternals.normalizarColetores(snapshotFake);
  assert.equal(resultado[0].ultimo_ping, '2026-10-01T10:00:00.000Z');
});
