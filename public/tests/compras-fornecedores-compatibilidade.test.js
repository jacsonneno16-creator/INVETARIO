// Fase 1A — Seção B: NENHUM campo legado de fornecedor-texto pode ser
// excluído, renomeado ou substituído; Solicitações/Cotações/Pedidos
// continuam funcionando exatamente como hoje. Este arquivo prova isso
// olhando o código real, não uma reimplementação em memória.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = path.join(__dirname, '../js/analista');

test('campos legados de fornecedor-texto continuam existindo sem alteração', () => {
  const parametros = fs.readFileSync(path.join(base, '81-pcp-parametros.js'), 'utf8');
  const comprasProfissional = fs.readFileSync(path.join(base, '121-compras-profissional.js'), 'utf8');
  const funcoesServidor = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');
  assert.match(parametros, /fornecedorPadrao/); // producao_produtos.fornecedorPadrao intacto
  assert.match(comprasProfissional, /fornecedor,quantidadeComprada,precoUnitario/); // pcp_requisicoes_compra.fornecedor ainda gravado como texto
  assert.match(comprasProfissional, /cotacoes=\[\.\.\.\(x\.cotacoes\|\|\[\]\),nova\]/); // cotacoes[].fornecedor ainda texto
  assert.match(funcoesServidor, /fornecedorNome/); // recebimento_agendamentos.fornecedorNome intacto (Cloud Function, fora do escopo da Fase 1A)
});

test('Fase 1A não mexe em Produção nem no roteamento/regras do PCP — 81, 78 e 79 não dependem do cadastro mestre', () => {
  ['81-pcp-parametros.js', '78-pcp-central.js', '79-compras-central.js'].forEach(arquivo => {
    const codigo = fs.readFileSync(path.join(base, arquivo), 'utf8');
    assert.doesNotMatch(codigo, /_fornecedoresService|compras_fornecedores/, arquivo + ' não deveria depender do cadastro mestre nesta fase');
  });
});

test('_rankingFornecedoresBiHtml continua intacta — a Fase 1A só reembute a função, não reescreve', () => {
  const codigo = fs.readFileSync(path.join(base, '121-compras-profissional.js'), 'utf8');
  assert.match(codigo, /Ranking real de fornecedores \(histórico de notas fiscais\)/);
  assert.match(codigo, /bi_fornecedores_agregado/);
});

test('registrarAuditoria sem `global` continua gravando em pcp_auditoria (comportamento antigo intacto); com global:true grava em compras_fornecedores_auditoria', async () => {
  const code = fs.readFileSync(path.join(base, '80-pcp-auditoria.js'), 'utf8');
  const chamadas = [];
  const window = {
    getDTFirestore: () => ({ collection: (nome) => ({ add: async (payload) => { chamadas.push({ nome, payload }); } }) }),
    getDTRawFirestore: () => ({ collection: (nome) => ({ add: async (payload) => { chamadas.push({ nome, payload }); } }) }),
    _currentAnalistaUser: { email: 'comprador@empresa.com' },
  };
  vm.runInNewContext(code, { window });
  await window.registrarAuditoria({ colecao: 'producao_produtos', docId: 'p1', antes: { fornecedorPadrao: 'A' }, depois: { fornecedorPadrao: 'B' }, camposRastreados: ['fornecedorPadrao'] });
  await window.registrarAuditoria({ colecao: 'compras_fornecedores', docId: 'f1', antes: { situacao: 'ativo' }, depois: { situacao: 'bloqueado' }, camposRastreados: ['situacao'], global: true });
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0].nome, 'pcp_auditoria');
  assert.equal(chamadas[1].nome, 'compras_fornecedores_auditoria');
});
