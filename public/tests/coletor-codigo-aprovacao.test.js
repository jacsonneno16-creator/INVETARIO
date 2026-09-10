// PEDIDO AO VIVO (2026-09-04): "no lugar de ficar entrando no coletor e
// ficar indo no analista aprovar... quero que no analista cadastre o ID do
// coletor e na hora que abrir o aplicativo ele já peça o id pra aprovar, e
// depois fique aprovado" — resgatarCodigoAprovacaoColetor() (02-sync-
// dispositivo.js) é o lado do Coletor: chama a Cloud Function
// resgatarCodigoAprovacaoColetor com o código digitado + o device_id deste
// aparelho, e se der certo tenta entrar de novo automaticamente (reusa
// doLogin(), que já sabe seguir o fluxo normal pós-aprovação).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const syncCode = fs.readFileSync(path.join(__dirname, '../js/coletor/02-sync-dispositivo.js'), 'utf8');

function criarElemento() {
  return { value: '', textContent: '', style: {}, disabled: false };
}

function loadSync({ callableImpl, currentUser, doLoginImpl } = {}) {
  const localStore = {};
  const elementos = {
    'aprov-codigo-input': criarElemento(),
    'aprov-codigo-fb': criarElemento(),
    'aprov-codigo-btn': criarElemento(),
  };
  const chamadasCallable = [];
  const toasts = [];
  const doLoginChamadas = [];
  const context = {
    console,
    firebase: {
      firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => 'DELETE_FIELD' } },
      app: () => ({
        functions: (regiao) => ({
          httpsCallable: (nome) => async (payload) => {
            chamadasCallable.push({ nome, payload, regiao });
            return { data: await (callableImpl ? callableImpl(payload) : { ok: true }) };
          },
        }),
      }),
    },
    FCOL: { coletores: 'dt_coletores' },
    FS: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) },
    AUTH: { currentUser: currentUser === undefined ? { uid: 'u1', email: 'a@b.com' } : currentUser },
    getDTFirebaseApp: () => context.firebase.app(),
    APP: {},
    localStorage: {
      getItem: k => Object.prototype.hasOwnProperty.call(localStore, k) ? localStore[k] : null,
      setItem: (k, v) => { localStore[k] = v; },
      removeItem: k => { delete localStore[k]; },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: 'teste', onLine: true },
    screen: { width: 100, height: 100, colorDepth: 24 },
    Intl, Date, Math, JSON, String, Number, Array, Object, Set, Map, Promise, setTimeout, clearTimeout,
    fetch: async () => ({ json: async () => ({ ip: '0.0.0.0' }) }),
    dbg: () => {},
    document: {
      createElement: () => ({ getContext: () => ({ fillText() {}, fillRect() {} }), toDataURL: () => 'data:x' }),
      getElementById: id => elementos[id] || null,
    },
    toast: (msg, tipo) => toasts.push({ msg, tipo }),
    doLogin: (...args) => { doLoginChamadas.push(args); if (doLoginImpl) return doLoginImpl(...args); },
  };
  context.window = context;
  context.localStorage.setItem('dt_device_id', 'dt_teste123');
  vm.createContext(context);
  vm.runInContext(syncCode, context, { filename: '02-sync-dispositivo.js' });
  return { ctx: context, elementos, chamadasCallable, toasts, doLoginChamadas };
}

test('código digitado com sucesso: chama a Cloud Function com o código (maiúsculo) e o device_id deste aparelho, depois tenta logar de novo automaticamente', async () => {
  const { ctx, elementos, chamadasCallable, doLoginChamadas } = loadSync({ callableImpl: async () => ({ ok: true, nome_coletor: 'Coletor X' }) });
  elementos['aprov-codigo-input'].value = 'ab12cd';
  await ctx.resgatarCodigoAprovacaoColetor();
  assert.equal(chamadasCallable.length, 1);
  assert.equal(chamadasCallable[0].nome, 'resgatarCodigoAprovacaoColetor');
  assert.equal(chamadasCallable[0].payload.codigo, 'AB12CD');
  assert.equal(chamadasCallable[0].payload.deviceId, 'dt_teste123');
  assert.equal(chamadasCallable[0].regiao, 'southamerica-east1');
  assert.match(elementos['aprov-codigo-fb'].textContent, /aprovado/i);
  // doLogin() é chamado depois de um pequeno delay (setTimeout) — real no vm.
  await new Promise(r => setTimeout(r, 650));
  assert.equal(doLoginChamadas.length, 1, 'reusa doLogin() pra completar o fluxo normal pós-aprovação, em vez de duplicar a lógica de loja/APP.operador');
});

test('campo vazio: mostra erro e NÃO chama a Cloud Function', async () => {
  const { ctx, elementos, chamadasCallable } = loadSync();
  elementos['aprov-codigo-input'].value = '';
  await ctx.resgatarCodigoAprovacaoColetor();
  assert.equal(chamadasCallable.length, 0);
  assert.match(elementos['aprov-codigo-fb'].textContent, /Digite o código/);
});

test('sem sessão autenticada (AUTH.currentUser nulo): mostra erro e não tenta chamar a função', async () => {
  const { ctx, elementos, chamadasCallable } = loadSync({ currentUser: null });
  elementos['aprov-codigo-input'].value = 'AB12CD';
  await ctx.resgatarCodigoAprovacaoColetor();
  assert.equal(chamadasCallable.length, 0);
  assert.match(elementos['aprov-codigo-fb'].textContent, /Sessão expirada/);
});

test('código inválido/já usado (a função rejeita): mostra a mensagem de erro do servidor, não re-tenta login', async () => {
  const { ctx, elementos, doLoginChamadas } = loadSync({
    callableImpl: async () => { throw Object.assign(new Error('Esse código já foi usado. Peça um código novo ao Analista.'), { code: 'failed-precondition' }); },
  });
  elementos['aprov-codigo-input'].value = 'ZZZZZZ';
  await ctx.resgatarCodigoAprovacaoColetor();
  assert.match(elementos['aprov-codigo-fb'].textContent, /já foi usado/);
  await new Promise(r => setTimeout(r, 650));
  assert.equal(doLoginChamadas.length, 0, 'erro não pode disparar uma tentativa de login');
});

test('botão fica desabilitado durante a verificação e volta ao normal no final (sucesso ou erro)', async () => {
  const { ctx, elementos } = loadSync({ callableImpl: async () => ({ ok: true }) });
  elementos['aprov-codigo-input'].value = 'AB12CD';
  const promessa = ctx.resgatarCodigoAprovacaoColetor();
  assert.equal(elementos['aprov-codigo-btn'].disabled, true);
  await promessa;
  assert.equal(elementos['aprov-codigo-btn'].disabled, false);
});
