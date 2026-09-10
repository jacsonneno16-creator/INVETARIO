// PEDIDO AO VIVO (2026-08-27): "eu selecionei só analista, sem coletor...
// não precisa criar um login pra coletor. Caso eu coloque... e coloque
// coletor, aí sim coloque um login pra coletor" — criarUsuarioVinculado
// criava o login de Coletor SEMPRE, incondicionalmente (emailColetor era
// obrigatório e obterOuCriarUsuario(emailColetor,...) rodava sem checar
// nada). Corrigido: cada conta só é criada se explicitamente pedida
// (criarAnalista/criarColetor).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function criarAuthFake({ existentes } = {}) {
  const criados = [];
  const porEmail = new Map((existentes || []).map(u => [u.email, u]));
  let seq = 0;
  const deletados = [];
  return {
    fake: {
      getUserByEmail: async (email) => { const u = porEmail.get(email); if (!u) { const e = new Error('not found'); e.code = 'auth/user-not-found'; throw e; } return u; },
      createUser: async ({ email, password, displayName }) => { const user = { uid: 'novo_' + (++seq), email, displayName }; criados.push({ email, password, displayName }); porEmail.set(email, user); return user; },
      deleteUser: async (uid) => { deletados.push(uid); },
    },
    criados, deletados,
  };
}

function carregarComAuthFake(authExistentes) {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  const authFake = criarAuthFake({ existentes: authExistentes });
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', { value: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }), configurable: true });
  Object.defineProperty(admin, 'auth', { value: () => authFake.fake, configurable: true });
  const indexModule = require(path.join(__dirname, '..', 'index.js'));
  return { internal: indexModule._criarUsuarioVinculadoInterno, authFake };
}

test('criarColetor:false, criarAnalista:true — cria só a conta de Analista, coletor_uid vem null', async () => {
  const { internal, authFake } = carregarComAuthFake();
  const resultado = await internal({ nome: 'João Silva', senha: 'Senha1234', emailAnalista: 'joao@empresa.com.br', criarAnalista: true, criarColetor: false });
  assert.equal(resultado.ok, true);
  assert.ok(resultado.analista_uid, 'deveria ter criado a conta de analista');
  assert.equal(resultado.coletor_uid, null, 'não deveria ter criado nenhuma conta de coletor');
  assert.equal(authFake.criados.length, 1);
  assert.equal(authFake.criados[0].email, 'joao@empresa.com.br');
});

test('criarColetor:true, criarAnalista:false — cria só a conta de Coletor, analista_uid vem null', async () => {
  const { internal, authFake } = carregarComAuthFake();
  const resultado = await internal({ nome: 'Maria Souza', senha: 'Senha1234', emailColetor: 'maria.souza@empresa.com.br', criarAnalista: false, criarColetor: true });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.analista_uid, null, 'não deveria ter criado nenhuma conta de analista');
  assert.ok(resultado.coletor_uid, 'deveria ter criado a conta de coletor');
  assert.equal(authFake.criados.length, 1);
  assert.equal(authFake.criados[0].email, 'maria.souza@empresa.com.br');
});

test('criarColetor:true e criarAnalista:true — cria as duas contas vinculadas', async () => {
  const { internal, authFake } = carregarComAuthFake();
  const resultado = await internal({ nome: 'Ana Lima', senha: 'Senha1234', emailAnalista: 'ana@empresa.com.br', emailColetor: 'ana.lima@empresa.com.br', criarAnalista: true, criarColetor: true });
  assert.ok(resultado.analista_uid);
  assert.ok(resultado.coletor_uid);
  assert.equal(authFake.criados.length, 2);
});

test('nem criarAnalista nem criarColetor — rejeita, nenhuma conta é criada', async () => {
  const { internal, authFake } = carregarComAuthFake();
  await assert.rejects(() => internal({ nome: 'Pedro Alves', senha: 'Senha1234', criarAnalista: false, criarColetor: false }), /obrigatórios/);
  assert.equal(authFake.criados.length, 0);
});

test('criarAnalista:true sem emailAnalista informado — rejeita antes de criar qualquer conta', async () => {
  const { internal, authFake } = carregarComAuthFake();
  await assert.rejects(() => internal({ nome: 'Pedro Alves', senha: 'Senha1234', criarAnalista: true, emailAnalista: '' }), /E-mail inválido/);
  assert.equal(authFake.criados.length, 0);
});

// PEDIDO AO VIVO (2026-08-27): a causa raiz exata do bug original —
// emailNormalizado('') lançava erro incondicionalmente, mesmo quando esse
// e-mail nunca era necessário (criarColetor:false). Sem passar
// emailColetor NENHUM, criar só o Analista precisa funcionar liso.
test('criarAnalista:true e criarColetor:false, sem emailColetor nenhum — não quebra por causa de um e-mail que nunca era necessário', async () => {
  const { internal, authFake } = carregarComAuthFake();
  const resultado = await internal({ nome: 'João Silva', senha: 'Senha1234', emailAnalista: 'joao@empresa.com.br', criarAnalista: true, criarColetor: false });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.coletor_uid, null);
  assert.equal(authFake.criados.length, 1);
});
