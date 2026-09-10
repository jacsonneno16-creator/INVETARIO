// REGRESSÃO (regex contra o texto de firestore.rules, mesmo padrão de
// pcp-compras-fase3.test.js — não é um teste de execução real da regra,
// só garante que o texto continua com a forma esperada).
//
// `recebimento_paletes` foi criada como coleção PRÓPRIA e SIMPLES,
// deliberadamente separada de `recebimentos` (que já documenta, no próprio
// arquivo, estouros reais do limite de 1000 sub-expressões do motor de
// regras em produção). Este teste garante duas coisas ao mesmo tempo:
// (1) a regra nova existe com o formato esperado; (2) a regra de
// `recebimentos` continua INTOCADA — nada de `tipo == 'PALETES'` foi
// encaixado ali.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

test('hasPermissionPaletes/hasPermissionColetorPaletes: funções novas, isoladas, checando só "recebimento-paletes"', () => {
  assert.match(rules, /function hasPermissionPaletes\(operation\)/);
  assert.match(rules, /function hasPermissionColetorPaletes\(operation\)/);
  const trechoAnalista = rules.slice(rules.indexOf('function hasPermissionPaletes'), rules.indexOf('function hasPermissionColetorPaletes'));
  assert.match(trechoAnalista, /a\.permissoes\.keys\(\)\.hasAny\(\['recebimento-paletes'\]\)/);
  assert.doesNotMatch(trechoAnalista, /recebimento-operacao|recebimento-transbordo/, 'hasPermissionPaletes não pode herdar de operacao/transbordo — é uma área isolada');
});

// PEDIDO AO VIVO (2026-09-08): "falando que eu to sem permissão, mas meu
// login é o mais ultra que tem" — a regra de exclusão ficou desatualizada
// de uma sessão anterior: o botão "excluir viagem" (Analista → Paletes →
// Monitoramento) foi construído no cliente sem nunca atualizar esta regra,
// que bloqueava `delete` pra QUALQUER usuário (`if false`, sem exceção nem
// pra admin — `hasPermissionPaletes`/`hasPermissionColetorPaletes` sempre
// liberam admin de cara, mas a regra antiga nem chegava a checar isso).
test('match /recebimento_paletes/: leitura por loja, criação/edição/exclusão exigem a permissão de qualquer canal (analista OU coletor), sem cross-loja', () => {
  const inicio = rules.indexOf('match /recebimento_paletes/{docId}');
  assert.ok(inicio > -1, 'regra de recebimento_paletes não encontrada');
  const trecho = rules.slice(inicio, inicio + 1400);
  assert.match(trecho, /allow read: if canAccessStore\(lojaId\);/);
  assert.match(trecho, /allow create: if canAccessStore\(lojaId\) && \(hasPermissionPaletes\('criar'\) \|\| hasPermissionColetorPaletes\('criar'\)\);/);
  assert.match(trecho, /allow update: if canAccessStore\(lojaId\) && \(hasPermissionPaletes\('editar'\) \|\| hasPermissionColetorPaletes\('editar'\)\);/);
  assert.match(trecho, /allow delete: if canAccessStore\(lojaId\) && \(hasPermissionPaletes\('excluir'\) \|\| hasPermissionColetorPaletes\('excluir'\)\);/);
  assert.doesNotMatch(trecho, /allow delete: if false;/, 'exclusão não pode mais estar bloqueada pra todo mundo');
  // Sem `.diff().affectedKeys()`, sem `destinoLojaId` — a regra mais simples
  // possível, sem a complexidade cross-loja que `recebimentos` precisa.
  assert.doesNotMatch(trecho, /affectedKeys|destinoLojaId/);
});

test('REGRESSÃO: a regra de `recebimentos` (Transbordo) continua sem nenhuma menção a PALETES — a coleção nova não foi encaixada ali', () => {
  const inicio = rules.indexOf('match /recebimentos/{docId}');
  assert.ok(inicio > -1, 'não encontrei o bloco de recebimentos pra conferir');
  // Fatia até o PRÓXIMO `match /` do arquivo (o bloco real é grande —
  // comentários extensos sobre o limite de 1000 sub-expressões — então não
  // dá pra supor uma distância fixa; e a ordem dos blocos no arquivo não é
  // a ordem em que foram citados nesta sessão).
  const fim = rules.indexOf('match /', inicio + 'match /recebimentos/{docId}'.length);
  assert.ok(fim > inicio, 'não encontrei o fim do bloco de recebimentos pra conferir');
  const trecho = rules.slice(inicio, fim);
  assert.doesNotMatch(trecho, /PALETES/);
});
