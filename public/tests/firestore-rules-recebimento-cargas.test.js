// REGRESSÃO (regex contra o texto de firestore.rules, mesmo padrão de
// firestore-rules-recebimento-paletes.test.js — não é execução real da
// regra, só garante que o texto continua com a forma esperada).
//
// Cobre as 4 coleções novas da Montagem/Expedição de Carga + Transferência
// de Paletes + Ledger: `recebimento_transbordo_cargas` (+ subcoleção
// `itens`), `recebimento_transferencias_paletes`, `recebimento_paletes_ledger`,
// `recebimento_paletes_movimentos`. Decisão de engenharia desta etapa:
// REIRA as funções de permissão JÁ existentes (hasPermissionRecebimento/
// hasPermissionColetorRecebimento pras cargas — é um passo antes do
// transbordo de verdade; hasPermissionPaletes/hasPermissionColetorPaletes
// pra tudo que é saldo/movimento de palete) em vez de criar 4 funções novas
// — só 1 função nova (hasPermissionPaletesNaLoja) foi necessária, pro
// ÚNICO caso genuinamente novo: escrita cross-loja no ledger/log/transferência.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

test('hasPermissionPaletesNaLoja: função nova, isolada, mesma forma de hasPermissionRecebimentoQualquerCanalNaLoja mas pra área recebimento-paletes', () => {
  assert.match(rules, /function hasPermissionPaletesNaLoja\(operation, loja\)/);
  const inicio = rules.indexOf('function hasPermissionPaletesNaLoja');
  const fim = rules.indexOf('\n    }', inicio);
  const trecho = rules.slice(inicio, fim);
  assert.match(trecho, /loja in a\.lojas_permitidas/);
  assert.match(trecho, /a\.permissoes\.keys\(\)\.hasAny\(\['recebimento-paletes'\]\)/);
  assert.doesNotMatch(trecho, /recebimento-operacao|recebimento-transbordo/, 'hasPermissionPaletesNaLoja não pode herdar de operacao/transbordo — é a mesma área isolada de hasPermissionPaletes');
});

test('match /recebimento_transbordo_cargas/: reaproveita hasPermissionRecebimento/hasPermissionColetorRecebimento (não cria área nova), sem escape cross-loja', () => {
  const inicio = rules.indexOf('match /recebimento_transbordo_cargas/{cargaId}');
  assert.ok(inicio > -1, 'regra de recebimento_transbordo_cargas não encontrada');
  const fim = rules.indexOf('// Transferência de paletes entre lojas', inicio);
  assert.ok(fim > inicio, 'não encontrei o fim do bloco de cargas pra conferir');
  const trecho = rules.slice(inicio, fim);
  assert.match(trecho, /allow read: if canAccessStore\(lojaId\);/);
  assert.match(trecho, /allow create: if canAccessStore\(lojaId\) && \(hasPermissionRecebimento\('criar'\) \|\| hasPermissionColetorRecebimento\('criar'\)\);/);
  assert.match(trecho, /allow update: if canAccessStore\(lojaId\) && \(hasPermissionRecebimento\('editar'\) \|\| hasPermissionColetorRecebimento\('editar'\)\);/);
  assert.match(trecho, /allow delete: if canAccessStore\(lojaId\) && \(hasPermissionRecebimento\('excluir'\) \|\| hasPermissionColetorRecebimento\('excluir'\)\);/);
  assert.match(trecho, /match \/itens\/\{itemId\}/);
  assert.doesNotMatch(trecho, /hasPermissionPaletes|destinoLojaId/, 'cargas não deve usar permissão de paletes nem checagem cross-loja — é dentro-da-loja só');
});

// PEDIDO AO VIVO (2026-09-08): "no início a gente sempre faz testes... isso
// serve pra novas funções" — a tela de Cargas (Montagem/Expedição) ganhou um
// botão de excluir; antes a regra travava exclusão pra todo mundo
// (`if false`), mesmo bug já corrigido antes em recebimento_paletes.
test('REGRESSÃO: recebimento_transbordo_cargas não trava mais exclusão pra todo mundo (bug igual ao já corrigido em recebimento_paletes)', () => {
  const inicio = rules.indexOf('match /recebimento_transbordo_cargas/{cargaId}');
  const fim = rules.indexOf('// Transferência de paletes entre lojas', inicio);
  const trecho = rules.slice(inicio, fim);
  assert.doesNotMatch(trecho, /allow delete: if false;/, 'exclusão de carga não pode mais estar bloqueada pra todo mundo');
});

test('match /recebimento_transferencias_paletes/: leitura por permissão de qualquer canal, update de confirmação exige hasPermissionPaletesNaLoja escopado no destino', () => {
  const inicio = rules.indexOf('match /recebimento_transferencias_paletes/{docId}');
  assert.ok(inicio > -1, 'regra de recebimento_transferencias_paletes não encontrada');
  const fim = rules.indexOf('match /recebimento_paletes_ledger/', inicio);
  assert.ok(fim > inicio, 'não encontrei o fim do bloco de transferências pra conferir');
  const trecho = rules.slice(inicio, fim);
  assert.match(trecho, /allow read: if canAccessStore\(lojaId\) \|\| \(/);
  assert.match(trecho, /hasPermissionColetorPaletes\('editar'\) \|\| hasPermissionPaletes\('visualizar'\)/);
  assert.match(trecho, /hasPermissionPaletesNaLoja\('editar', resource\.data\.destinoLojaId\)/);
  assert.match(trecho, /allow delete: if false;/);
});

test('match /recebimento_paletes_ledger/ e /recebimento_paletes_movimentos/: escrita própria loja OU cross-loja escopada via hasPermissionPaletesNaLoja(lojaId), movimentos são imutáveis', () => {
  const inicioLedger = rules.indexOf('match /recebimento_paletes_ledger/{docId}');
  assert.ok(inicioLedger > -1, 'regra de recebimento_paletes_ledger não encontrada');
  const inicioMov = rules.indexOf('match /recebimento_paletes_movimentos/{docId}');
  assert.ok(inicioMov > inicioLedger, 'regra de recebimento_paletes_movimentos não encontrada depois do ledger');
  const fim = rules.indexOf('\n      }', inicioMov) + '\n      }'.length;
  const trecho = rules.slice(inicioLedger, fim);
  assert.match(trecho, /allow write: if canAccessStore\(lojaId\) \|\| \(active\(\) && hasPermissionPaletesNaLoja\('editar', lojaId\)\);/);
  assert.match(trecho, /allow create: if canAccessStore\(lojaId\) \|\| \(active\(\) && hasPermissionPaletesNaLoja\('criar', lojaId\)\);/);
  assert.match(trecho, /allow update, delete: if false;/);
});

test('REGRESSÃO: recebimento_paletes/recebimento_paletes_estoque continuam intocadas (sem hasPermissionPaletesNaLoja nelas)', () => {
  const inicio = rules.indexOf('match /recebimento_paletes/{docId}');
  const fim = rules.indexOf('match /recebimento_transbordo_cargas/', inicio);
  const trecho = rules.slice(inicio, fim);
  assert.doesNotMatch(trecho, /hasPermissionPaletesNaLoja|destinoLojaId/);
});
