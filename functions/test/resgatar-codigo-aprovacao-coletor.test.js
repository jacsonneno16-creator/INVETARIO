// PEDIDO AO VIVO (2026-09-04): "no lugar de ficar entrando no coletor e
// ficar indo no analista aprovar... quero que no analista cadastre o ID do
// coletor e na hora que abrir o aplicativo ele já peça o id pra aprovar, e
// depois fique aprovado" — o Analista pré-gera um código em
// dt_codigos_coletor; o operador digita esse código na tela "aguardando
// aprovação" do Coletor e o aparelho já entra aprovado, sem o Analista
// precisar abrir a lista de coletores e clicar em Aprovar. As regras do
// Firestore (dt_coletores) IMPEDEM o próprio aparelho de se auto-aprovar —
// só esta Cloud Function (Admin SDK, roda dentro de uma transação) pode.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function criarFirestoreFake(seed) {
  const dados = new Map(Object.entries(seed || {}));
  const chave = (colecao, id) => colecao + '/' + id;
  const colecaoApi = (nomeColecao) => ({ doc: (id) => ({ _colecao: nomeColecao, _id: id }) });
  return {
    fake: {
      collection: colecaoApi,
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => {
            const k = chave(ref._colecao, ref._id);
            return dados.has(k) ? { exists: true, data: () => dados.get(k) } : { exists: false, data: () => undefined };
          },
          set: (ref, payload, opts) => {
            const k = chave(ref._colecao, ref._id);
            const atual = dados.get(k) || {};
            dados.set(k, (opts && opts.merge) ? { ...atual, ...payload } : { ...payload });
          },
        };
        return fn(tx);
      },
    },
    dados,
  };
}

function carregarComFirestoreFake(seed) {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  const { fake, dados } = criarFirestoreFake(seed);
  const firestoreFn = () => fake;
  firestoreFn.FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', { value: firestoreFn, configurable: true });
  const indexModule = require(path.join(__dirname, '..', 'index.js'));
  return { internal: indexModule._resgatarCodigoAprovacaoColetorInterno, dados };
}

test('código válido e não usado: aprova o aparelho, herda o nome do cadastro do Analista, marca o código como usado', async () => {
  const { internal, dados } = carregarComFirestoreFake({
    'dt_codigos_coletor/AB12CD': { codigo: 'AB12CD', nome_coletor: 'Coletor Câmara Fria', usado: false },
  });
  const resultado = await internal({ codigo: 'ab12cd', deviceId: 'dt_xyz123', uid: 'uid1', email: 'joao@empresa.com', nomeExibicao: 'João' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.nome_coletor, 'Coletor Câmara Fria');
  const device = dados.get('dt_coletores/dt_xyz123');
  assert.equal(device.aprovado, 'aprovado');
  assert.equal(device.nome_coletor, 'Coletor Câmara Fria');
  assert.equal(device.uid, 'uid1');
  assert.equal(device.operador_email, 'joao@empresa.com');
  assert.equal(device.aprovado_via_codigo, 'AB12CD', 'código é normalizado pra maiúsculo (mesmo formato do doc id gerado pelo Analista)');
  const cod = dados.get('dt_codigos_coletor/AB12CD');
  assert.equal(cod.usado, true, 'código marcado como usado — não pode ser reaproveitado');
  assert.equal(cod.usado_por_device_id, 'dt_xyz123');
});

test('código já usado: rejeita, não aprova o aparelho', async () => {
  const { internal, dados } = carregarComFirestoreFake({
    'dt_codigos_coletor/AB12CD': { codigo: 'AB12CD', nome_coletor: 'X', usado: true, usado_por_device_id: 'outro_aparelho' },
  });
  await assert.rejects(() => internal({ codigo: 'AB12CD', deviceId: 'dt_novo', uid: 'uid2', email: 'a@b.com' }), /já foi usado/);
  assert.equal(dados.has('dt_coletores/dt_novo'), false, 'aparelho não pode ter sido aprovado');
});

test('código inexistente: rejeita com mensagem clara', async () => {
  const { internal } = carregarComFirestoreFake({});
  await assert.rejects(() => internal({ codigo: 'ZZZZZZ', deviceId: 'dt_1', uid: 'uid3', email: 'a@b.com' }), /Código inválido/);
});

test('aparelho já bloqueado pelo Analista: um código não consegue reverter o bloqueio', async () => {
  const { internal, dados } = carregarComFirestoreFake({
    'dt_codigos_coletor/AB12CD': { codigo: 'AB12CD', nome_coletor: 'X', usado: false },
    'dt_coletores/dt_bloqueado': { aprovado: 'bloqueado', device_id: 'dt_bloqueado' },
  });
  await assert.rejects(() => internal({ codigo: 'AB12CD', deviceId: 'dt_bloqueado', uid: 'uid4', email: 'a@b.com' }), /bloqueado/);
  assert.equal(dados.get('dt_coletores/dt_bloqueado').aprovado, 'bloqueado', 'continua bloqueado — o código não sobrescreve');
  assert.equal(dados.get('dt_codigos_coletor/AB12CD').usado, false, 'código não é consumido quando a aprovação falha');
});

test('código sem informar: rejeita antes de tocar no banco', async () => {
  const { internal, dados } = carregarComFirestoreFake({});
  await assert.rejects(() => internal({ codigo: '', deviceId: 'dt_1', uid: 'uid5', email: 'a@b.com' }), /Informe o código/);
});

test('deviceId ausente: rejeita — aparelho não identificado', async () => {
  const { internal } = carregarComFirestoreFake({
    'dt_codigos_coletor/AB12CD': { codigo: 'AB12CD', nome_coletor: 'X', usado: false },
  });
  await assert.rejects(() => internal({ codigo: 'AB12CD', deviceId: '', uid: 'uid6', email: 'a@b.com' }), /não identificado/);
});

test('aparelho reaproveitado (já existia, offline, com histórico de contagens) preserva contagens_enviadas/pendentes e data_registro originais', async () => {
  const { internal, dados } = carregarComFirestoreFake({
    'dt_codigos_coletor/AB12CD': { codigo: 'AB12CD', nome_coletor: 'Novo Nome', usado: false },
    'dt_coletores/dt_existente': { device_id: 'dt_existente', aprovado: 'revogado', excluido: true, contagens_enviadas: 42, contagens_pendentes: 3, data_registro: 'ORIGINAL' },
  });
  await internal({ codigo: 'AB12CD', deviceId: 'dt_existente', uid: 'uid7', email: 'a@b.com' });
  const device = dados.get('dt_coletores/dt_existente');
  assert.equal(device.aprovado, 'aprovado');
  assert.equal(device.contagens_enviadas, 42);
  assert.equal(device.contagens_pendentes, 3);
  assert.equal(device.data_registro, 'ORIGINAL');
  assert.equal(device.excluido, false, 'reaprovar via código reverte a exclusão/revogação anterior');
});
