// Fase 1A — Seção F: regras de segurança das 4 coleções novas do
// fornecedor mestre. Mesmo padrão de teste (regex direto em
// firestore.rules) já usado em pcp-compras-fase3.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

test('compras_fornecedores: leitura/escrita exigem permissão de compras-central, exclusão lógica só (delete sempre false)', () => {
  const bloco = rules.match(/match \/compras_fornecedores\/\{docId\}[\s\S]*?\n {4}\}/)[0];
  assert.match(bloco, /allow read: if hasPermission\('compras-central', 'visualizar'\)/);
  assert.match(bloco, /allow create, update: if hasPermission\('compras-central', 'editar'\)/);
  assert.match(bloco, /allow delete: if false/);
});

test('compras_fornecedores_resumo: PCP/Produção (canUseAnalista) leem, só Compras escreve — nenhum campo de preço aparece na regra', () => {
  const bloco = rules.match(/match \/compras_fornecedores_resumo\/\{docId\}[\s\S]*?\n {4}\}/)[0];
  assert.match(bloco, /allow read: if canUseAnalista\(\)/);
  assert.match(bloco, /allow write: if hasPermission\('compras-central', 'editar'\)/);
  assert.doesNotMatch(bloco, /preco|precoReferencia|condicaoPagamento/i);
});

test('compras_fornecedor_produtos: leitura/escrita restritas a compras-central (preço/condição comercial não vaza pra PCP)', () => {
  const bloco = rules.match(/match \/compras_fornecedor_produtos\/\{docId\}[\s\S]*?\n {4}\}/)[0];
  assert.match(bloco, /allow read: if hasPermission\('compras-central', 'visualizar'\)/);
  assert.match(bloco, /allow write: if hasPermission\('compras-central', 'editar'\)/);
  assert.doesNotMatch(bloco, /canUseAnalista/);
});

test('compras_fornecedores_auditoria: append-only (só create), nunca update/delete', () => {
  const bloco = rules.match(/match \/compras_fornecedores_auditoria\/\{docId\}[\s\S]*?\n {4}\}/)[0];
  assert.match(bloco, /allow read: if hasPermission\('compras-central', 'configurar'\)/);
  assert.match(bloco, /allow create: if hasPermission\('compras-central', 'editar'\)/);
  assert.match(bloco, /allow update, delete: if false/);
});

test('nenhuma das 4 coleções novas ficou aberta para qualquer usuário autenticado (sem hasPermission/canUseAnalista)', () => {
  ['compras_fornecedores', 'compras_fornecedores_resumo', 'compras_fornecedor_produtos', 'compras_fornecedores_auditoria'].forEach(colecao => {
    const bloco = rules.match(new RegExp('match /' + colecao + '/\\{docId\\}[\\s\\S]*?\\n {4}\\}'))[0];
    assert.doesNotMatch(bloco, /allow (read|write|create|update): if (true|signedIn\(\)|active\(\))[\s,;]/, colecao + ' não pode ficar liberado para qualquer usuário logado');
  });
});
