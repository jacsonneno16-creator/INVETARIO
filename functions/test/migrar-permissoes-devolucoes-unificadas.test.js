// Devoluções unificadas (2026-10-13): testa a lógica pura de
// scripts/migrar-permissoes-devolucoes-unificadas.js (require() seguro —
// o script só toca admin.initializeApp()/Firestore quando rodado via CLI,
// atrás de `require.main === module`).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { calcularPlanoUsuario, ACOES_SEMPRE_FALSE } = require(path.join(__dirname, '..', '..', 'scripts', 'migrar-permissoes-devolucoes-unificadas.js'));

test('já tinha o módulo novo — pula, nunca sobrescreve', () => {
  const r = calcularPlanoUsuario({ permissoes: { 'recebimento-devolucoes': { visualizar: false } } });
  assert.equal(r.pulado, 'ja-tinha-modulo-novo');
  assert.equal(r.updates, undefined);
});

test('sem nenhum módulo antigo — pula, nada a migrar', () => {
  const r = calcularPlanoUsuario({ permissoes: { 'outra-coisa': { visualizar: true } } });
  assert.equal(r.pulado, 'sem-modulo-antigo');
});

test('visualizar = OR dos dois módulos antigos (só o 1º marcado)', () => {
  const r = calcularPlanoUsuario({ permissoes: { 'recebimento-consulta-notas': { visualizar: true } } });
  assert.equal(r.pulado, null);
  assert.equal(r.updates['permissoes.recebimento-devolucoes.visualizar'], true);
});

test('visualizar = OR dos dois módulos antigos (só o 2º marcado)', () => {
  const r = calcularPlanoUsuario({ permissoes: { 'recebimento-devolucoes-indicadores': { visualizar: true } } });
  assert.equal(r.updates['permissoes.recebimento-devolucoes.visualizar'], true);
});

test('visualizar = false quando nenhum dos dois antigos tinha true (só existiam, sem a chave)', () => {
  const r = calcularPlanoUsuario({ permissoes: { 'recebimento-consulta-notas': { visualizar: false }, 'recebimento-devolucoes-indicadores': {} } });
  assert.equal(r.updates['permissoes.recebimento-devolucoes.visualizar'], false);
});

test('importar/exportar copiados só do módulo recebimento-consulta-notas (o único que tinha essas ações)', () => {
  const r = calcularPlanoUsuario({ permissoes: { 'recebimento-consulta-notas': { visualizar: true, importar: true, exportar: false } } });
  assert.equal(r.updates['permissoes.recebimento-devolucoes.importar'], true);
  assert.equal(r.updates['permissoes.recebimento-devolucoes.exportar'], false);
});

test('confirmar/relatorio_criar/relatorio_finalizar/estornar/excluir nascem SEMPRE false, mesmo pra quem tinha importar=true', () => {
  const r = calcularPlanoUsuario({ permissoes: { 'recebimento-consulta-notas': { visualizar: true, importar: true, exportar: true } } });
  ACOES_SEMPRE_FALSE.forEach(acao => {
    assert.equal(r.updates['permissoes.recebimento-devolucoes.' + acao], false, acao + ' precisa nascer false');
  });
});

test('updates usam dotted-path (pra .update(), nunca .set com merge) — nenhuma chave aninhada de verdade', () => {
  const r = calcularPlanoUsuario({ permissoes: { 'recebimento-consulta-notas': { visualizar: true } } });
  Object.keys(r.updates).forEach(k => assert.match(k, /^permissoes\.recebimento-devolucoes\./));
});

test('main(): sanity check nunca excede o total de usuarios_acessos e grava só em --apply', async () => {
  const { main } = require(path.join(__dirname, '..', '..', 'scripts', 'migrar-permissoes-devolucoes-unificadas.js'));
  const usuarios = [
    { id: 'u1', data: { email: 'a@x.com', permissoes: { 'recebimento-consulta-notas': { visualizar: true, importar: true } } } },
    { id: 'u2', data: { email: 'b@x.com', permissoes: { 'recebimento-devolucoes-indicadores': { visualizar: true } } } },
    { id: 'u3', data: { email: 'c@x.com', permissoes: { 'recebimento-devolucoes': { visualizar: true } } } }, // já migrado
    { id: 'u4', data: { email: 'd@x.com', permissoes: {} } }, // sem módulo antigo nenhum
  ];
  const atualizacoes = [];
  const dbFake = {
    collection: () => ({
      get: async () => ({ size: usuarios.length, docs: usuarios.map(u => ({ id: u.id, data: () => u.data })) }),
      doc: (id) => ({ _id: id }),
    }),
    batch: () => ({ update: (ref, updates) => atualizacoes.push({ id: ref._id, updates }), commit: async () => {} }),
  };
  await main(dbFake, false); // dry-run
  assert.equal(atualizacoes.length, 0, 'dry-run nunca grava');
  await main(dbFake, true); // apply
  assert.equal(atualizacoes.length, 2, 'só u1 e u2 precisavam de migração');
  assert.ok(atualizacoes.some(a => a.id === 'u1'));
  assert.ok(atualizacoes.some(a => a.id === 'u2'));
});
