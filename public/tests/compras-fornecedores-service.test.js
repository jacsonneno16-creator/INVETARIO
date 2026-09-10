// Fase 1A — Fundação de Compras: funções puras e Firestore-backed do
// serviço compartilhado (compras-fornecedores-service.js). CNPJ real
// usado nos testes ("11222333000181") é um CNPJ de exemplo publicamente
// conhecido (dígito verificador válido), não pertence a empresa real.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/compras-fornecedores-service.js'), 'utf8');

// Mock mínimo do Firestore compat (batch/doc/where), em memória.
function criarFirestoreFake() {
  const dados = new Map();
  let autoIdSeq = 0;
  function bate(docData, filtros) { return filtros.every(([campo, op, valor]) => op === '==' && docData[campo] === valor); }
  function colecaoRef(nome) {
    const prefixo = nome + '/';
    function getComFiltros(filtros) {
      const docs = [...dados.entries()].filter(([k]) => k.startsWith(prefixo))
        .map(([k, v]) => ({ id: k.slice(prefixo.length), data: () => v }))
        .filter(d => bate(d.data(), filtros));
      return { docs };
    }
    function whereChain(filtros) { return { where: (c, o, v) => whereChain([...filtros, [c, o, v]]), get: async () => getComFiltros(filtros) }; }
    return {
      doc(id) {
        const docId = id || ('auto' + (++autoIdSeq));
        const chave = prefixo + docId;
        return {
          id: docId,
          get: async () => ({ exists: dados.has(chave), id: docId, data: () => dados.get(chave) }),
          set: async (valor, opts) => { const atual = dados.get(chave) || {}; dados.set(chave, (opts && opts.merge) ? { ...atual, ...valor } : valor); },
        };
      },
      where: (c, o, v) => whereChain([[c, o, v]]),
      get: async () => getComFiltros([]),
    };
  }
  return {
    collection: colecaoRef,
    batch: () => { const ops = []; return { set: (ref, valor, opts) => ops.push({ ref, valor, opts }), commit: async () => { for (const op of ops) await op.ref.set(op.valor, op.opts); } }; },
    _dados: dados,
  };
}

function carregarServico(rawFirestore) {
  const window = { getDTRawFirestore: () => rawFirestore, _currentAnalistaUser: { email: 'comprador@empresa.com' }, registrarAuditoria: async () => null };
  vm.runInNewContext(code, { window });
  return window._fornecedoresService;
}

test('validarCnpj: aceita CNPJ real com dígito verificador correto, rejeita dígito errado e sequência repetida', () => {
  const svc = carregarServico(criarFirestoreFake());
  assert.equal(svc.validarCnpj('11.222.333/0001-81'), true);
  assert.equal(svc.validarCnpj('11222333000180'), false); // dígito verificador errado
  assert.equal(svc.validarCnpj('11111111111111'), false); // sequência repetida
  assert.equal(svc.validarCnpj('123'), false); // tamanho errado
});

test('normalizarCnpj remove máscara; formatarCnpj só formata CNPJ de 14 dígitos', () => {
  const svc = carregarServico(criarFirestoreFake());
  assert.equal(svc.normalizarCnpj('11.222.333/0001-81'), '11222333000181');
  assert.equal(svc.formatarCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(svc.formatarCnpj('123'), '');
});

test('normalizarNomeFornecedor: mesmo nome com grafia diferente vira a mesma chave (bug real já visto no legado)', () => {
  const svc = carregarServico(criarFirestoreFake());
  assert.equal(svc.normalizarNomeFornecedor('FORNECEDOR TESTE'), svc.normalizarNomeFornecedor('fornecedor teste'));
  assert.equal(svc.normalizarNomeFornecedor('2JM Amidos e Derivados Ltda'), svc.normalizarNomeFornecedor('2JM  AMIDOS E DERIVADOS LTDA'));
});

test('criarFornecedor: exige razão social, nome fantasia e recusa CNPJ inválido', async () => {
  const svc = carregarServico(criarFirestoreFake());
  await assert.rejects(() => svc.criarFornecedor({ nomeFantasia: 'X' }), /razão social/i);
  await assert.rejects(() => svc.criarFornecedor({ razaoSocial: 'X', nomeFantasia: 'X', cnpj: '11222333000180' }), /CNPJ inválido/i);
});

test('criarFornecedor: usa o CNPJ como ID do documento e recusa duplicidade de CNPJ', async () => {
  const rawFs = criarFirestoreFake();
  const svc = carregarServico(rawFs);
  const f = await svc.criarFornecedor({ razaoSocial: '2JM Amidos e Derivados Ltda', nomeFantasia: '2JM Amidos', cnpj: '11.222.333/0001-81' });
  assert.equal(f.fornecedorId, '11222333000181');
  const doc = await rawFs.collection('compras_fornecedores').doc('11222333000181').get();
  assert.equal(doc.exists, true);
  const resumo = await rawFs.collection('compras_fornecedores_resumo').doc('11222333000181').get();
  assert.equal(resumo.exists, true);
  assert.equal(resumo.data().nomeFantasia, '2JM Amidos');
  assert.equal(resumo.data().leadTimePadraoDias, 0);
  // preço/condição comercial NUNCA no resumo (Seção F — só Compras vê)
  assert.equal('condicaoPagamentoPadrao' in resumo.data(), false);
  await assert.rejects(() => svc.criarFornecedor({ razaoSocial: '2JM Amidos e Derivados Ltda', nomeFantasia: '2JM Amidos', cnpj: '11.222.333/0001-81' }), /já existe fornecedor cadastrado com este cnpj/i);
});

test('criarFornecedor: sem CNPJ gera ID automático e marca statusCadastro incompleto', async () => {
  const svc = carregarServico(criarFirestoreFake());
  const f = await svc.criarFornecedor({ razaoSocial: 'Fornecedor Sem CNPJ Ltda', nomeFantasia: 'Fornecedor Sem CNPJ' });
  assert.equal(f.statusCadastro, 'incompleto_sem_cnpj');
  assert.ok(f.fornecedorId);
});

test('atualizarFornecedor: atualiza documento completo e resumo no mesmo batch', async () => {
  const rawFs = criarFirestoreFake();
  const svc = carregarServico(rawFs);
  const f = await svc.criarFornecedor({ razaoSocial: 'Terrafec Ltda', nomeFantasia: 'Terrafec', cnpj: '11.222.333/0001-81' });
  await svc.atualizarFornecedor(f.fornecedorId, { situacao: 'inativo', leadTimePadraoDias: 15 });
  const atualizado = await svc.buscarPorId(f.fornecedorId);
  assert.equal(atualizado.situacao, 'inativo');
  assert.equal(atualizado.leadTimePadraoDias, 15);
  const resumo = await rawFs.collection('compras_fornecedores_resumo').doc(f.fornecedorId).get();
  assert.equal(resumo.data().situacao, 'inativo');
});

test('bloquearFornecedor exige justificativa e marca situacao=bloqueado; desbloquear reverte', async () => {
  const svc = carregarServico(criarFirestoreFake());
  const f = await svc.criarFornecedor({ razaoSocial: 'Okker Ltda', nomeFantasia: 'Okker', cnpj: '11.222.333/0001-81' });
  await assert.rejects(() => svc.bloquearFornecedor(f.fornecedorId, ''), /justificativa/i);
  const bloqueado = await svc.bloquearFornecedor(f.fornecedorId, 'Atraso recorrente em entregas.');
  assert.equal(bloqueado.situacao, 'bloqueado');
  assert.equal(svc.estaBloqueado(bloqueado), true);
  const desbloqueado = await svc.desbloquearFornecedor(f.fornecedorId, 'Regularizado.');
  assert.equal(desbloqueado.situacao, 'ativo');
  assert.equal(svc.estaBloqueado(desbloqueado), false);
  // Histórico de bloqueios é append-only — nunca reescreve o registro anterior.
  assert.equal(desbloqueado.bloqueios.length, 1);
  assert.equal(desbloqueado.bloqueios[0].ativo, false);
});

test('detectarDuplicidade encontra por CNPJ e por nome normalizado, sem exigir grafia idêntica', async () => {
  const svc = carregarServico(criarFirestoreFake());
  await svc.criarFornecedor({ razaoSocial: 'Fornecedor Teste Ltda', nomeFantasia: 'FORNECEDOR TESTE', cnpj: '11.222.333/0001-81' });
  const porCnpj = await svc.detectarDuplicidade({ cnpj: '11222333000181' });
  assert.equal(porCnpj.duplicado, true);
  assert.equal(porCnpj.motivo, 'cnpj');
  const porNome = await svc.detectarDuplicidade({ nome: 'fornecedor teste' });
  assert.equal(porNome.duplicado, true);
  assert.equal(porNome.motivo, 'nome');
});

test('documentosVencidos filtra só documentos com validade no passado', () => {
  const svc = carregarServico(criarFirestoreFake());
  const hoje = new Date().toISOString().slice(0, 10);
  const f = { documentos: [{ tipo: 'contrato', validade: '2000-01-01' }, { tipo: 'alvara', validade: '2999-01-01' }, { tipo: 'sem_validade' }] };
  const vencidos = svc.documentosVencidos(f);
  assert.equal(vencidos.length, 1);
  assert.equal(vencidos[0].tipo, 'contrato');
  assert.notEqual(hoje, undefined);
});
