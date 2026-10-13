'use strict';
// PEDIDO AO VIVO (2026-10-02): "tem que fazer logout com 40m sem uso, e
// sumir o nome daqui" (tela Coletores, Configurações do Sistema) — o
// Coletor já tinha um logout automático por inatividade
// (iniciarTimeoutInatividadeColetor, 04-auth-login.js), só que armado pra
// 60 minutos; baixado pra 40. marcarColetorOffline() já zera
// operador_atual/sessao no Firestore (02-sync-dispositivo.js), que é o que
// faz o nome sumir (vira "Nenhum") na tela Coletores do Analista
// (35-coletores-render.js:196) — só o limite de tempo precisou mudar.
//
// Carrega só o IIFE do timeout (isolado por slice de texto, não o arquivo
// inteiro) — 04-auth-login.js de ponta a ponta depende de AUTH/FS/APP reais
// inicializados em outros arquivos do bundle do Coletor; o próprio timeout
// só referencia globais (APP, AUTH, marcarColetorOffline, goScreen, toast)
// dentro de uma função chamada bem depois, então isolar o bloco evita ter
// que simular o app inteiro só pra testar um setTimeout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const codigoCompleto = fs.readFileSync(path.join(__dirname, '../js/coletor/04-auth-login.js'), 'utf8');
const inicio = codigoCompleto.indexOf('// Logout automático após 40 minutos sem interação no Coletor.');
assert.ok(inicio > -1, 'não encontrei o bloco do timeout de inatividade — ajuste este teste se o comentário-âncora mudou');
const fim = codigoCompleto.indexOf('\n})();', inicio) + '\n})();'.length;
const blocoTimeout = codigoCompleto.slice(inicio, fim);

function montarContexto() {
  const chamadas = [];
  const ctx = {
    APP: { operador: { name: 'Maria Operadora' } },
    AUTH: { signOut: async () => { chamadas.push('signOut'); } },
    marcarColetorOffline: async () => { chamadas.push('marcarColetorOffline'); },
    goScreen: (tela) => { chamadas.push('goScreen:' + tela); },
    toast: (msg) => { chamadas.push('toast:' + msg); },
    document: { addEventListener: () => {} }, // só pra não quebrar o .forEach de binds de evento
    setTimeout, clearTimeout,
    console,
  };
  ctx.window = ctx; // o bloco real atribui via `window.iniciarTimeoutInatividadeColetor=armar`
  vm.createContext(ctx);
  vm.runInContext(blocoTimeout, ctx);
  return { ctx, chamadas };
}

test('iniciarTimeoutInatividadeColetor: NÃO desloga antes de 40 minutos', () => {
  const { ctx } = montarContexto();
  const timers = { setTimeout: [] };
  ctx.setTimeout = (fn, ms) => { timers.setTimeout.push({ fn, ms }); return 1; };
  ctx.clearTimeout = () => {};
  vm.runInContext(blocoTimeout, ctx); // re-roda com o setTimeout espião já no lugar
  ctx.iniciarTimeoutInatividadeColetor();
  assert.equal(timers.setTimeout.length, 1);
  assert.equal(timers.setTimeout[0].ms, 40 * 60 * 1000, 'o limite precisa ser 40 minutos, não mais 60');
});

test('iniciarTimeoutInatividadeColetor: ao estourar o limite, desloga e ZERA o operador (o que faz o nome sumir no Analista)', async () => {
  const { ctx, chamadas } = montarContexto();
  let callback = null;
  ctx.setTimeout = (fn) => { callback = fn; return 1; };
  ctx.clearTimeout = () => {};
  vm.runInContext(blocoTimeout, ctx);
  ctx.iniciarTimeoutInatividadeColetor();
  assert.ok(callback, 'o setTimeout deveria ter sido armado');

  await callback();
  await new Promise(r => setImmediate(r)); // deixa o .finally() da Promise real resolver

  assert.deepEqual(chamadas, ['marcarColetorOffline', 'signOut', 'goScreen:login', 'toast:Sessão encerrada após 40 minutos sem uso.']);
  assert.equal(ctx.APP.operador, null);
});

test('iniciarTimeoutInatividadeColetor: sem operador logado, nem arma o timer (nada pra encerrar)', () => {
  const { ctx } = montarContexto();
  ctx.APP.operador = null;
  const timers = [];
  ctx.setTimeout = (fn, ms) => { timers.push(ms); return 1; };
  ctx.clearTimeout = () => {};
  vm.runInContext(blocoTimeout, ctx);
  ctx.iniciarTimeoutInatividadeColetor();
  assert.equal(timers.length, 0);
});
