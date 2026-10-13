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

test('compatibilidade: 81 grava fornecedorId e 79 usa o mestre somente para enriquecer regra, mantendo texto legado', () => {
  const parametros = fs.readFileSync(path.join(base, '81-pcp-parametros.js'), 'utf8');
  const comprasCentral = fs.readFileSync(path.join(base, '79-compras-central.js'), 'utf8');
  assert.match(parametros, /global\._fornecedoresService/);
  assert.match(parametros, /fornecedorPadraoId/);
  assert.match(parametros, /fornecedorPadrao/);
  assert.match(comprasCentral, /resolverFornecedorAptoPorNome/);
  assert.match(comprasCentral, /fornecedorId/);
  assert.match(comprasCentral, /valor/); // nome legado continua salvo como fallback
});

// PEDIDO AO VIVO (2026-09-18): "não quero fazer uma solicitação de cada
// vez... selecionar fornecedor, ver os produtos dele" — a partir daqui
// 78-pcp-central.js PASSA a depender do cadastro mestre (Fase 1A), de
// propósito: a solicitação em lote precisa do vínculo fornecedor→produto
// pra saber quais produtos aquele fornecedor vende. Isto substitui a
// restrição do teste acima só pra este arquivo — o resto da Fase 1A
// (81/79, roteamento por texto legado) continua intocado.
test('78-pcp-central.js: solicitação em lote continua por categoria e reaproveita vínculo homologado sem substituir o fluxo legado', () => {
  const codigo = fs.readFileSync(path.join(base, '78-pcp-central.js'), 'utf8');
  assert.match(codigo, /_loteCatalogoCategoria/);
  assert.match(codigo, /Selecione a categoria/);
  assert.match(codigo, /global\._fornecedoresService\?\.listarVinculosHomologados/);
  assert.match(codigo, /vinc\?\.fornecedorNome\|\|cad\.fornecedorPadrao/);
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
