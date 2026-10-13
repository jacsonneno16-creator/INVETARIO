// Fase 1A — vínculo produto×fornecedor (compras_fornecedor_produtos).
// Doc ID determinístico (fornecedorId + '_' + idSeguro(produtoId)) — o
// mesmo par nunca deve duplicar documento, mesmo chamado várias vezes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/compras-fornecedores-service.js'), 'utf8');

function criarFirestoreFake() {
  const dados = new Map();
  function bate(docData, filtros) { return filtros.every(([campo, op, valor]) => op === '==' && docData[campo] === valor); }
  function colecaoRef(nome) {
    const prefixo = nome + '/';
    function getComFiltros(filtros) {
      const docs = [...dados.entries()].filter(([k]) => k.startsWith(prefixo)).map(([k, v]) => ({ id: k.slice(prefixo.length), data: () => v })).filter(d => bate(d.data(), filtros));
      return { docs };
    }
    function whereChain(filtros) { return { where: (c, o, v) => whereChain([...filtros, [c, o, v]]), get: async () => getComFiltros(filtros) }; }
    return {
      doc(id) {
        const chave = prefixo + id;
        return { id, get: async () => ({ exists: dados.has(chave), id, data: () => dados.get(chave) }), set: async (valor, opts) => { const atual = dados.get(chave) || {}; dados.set(chave, (opts && opts.merge) ? { ...atual, ...valor } : valor); } };
      },
      where: (c, o, v) => whereChain([[c, o, v]]),
      get: async () => getComFiltros([]),
    };
  }
  return { collection: colecaoRef, batch: () => { const ops = []; return { set: (ref, valor, opts) => ops.push({ ref, valor, opts }), commit: async () => { for (const op of ops) await op.ref.set(op.valor, op.opts); } }; }, _dados: dados };
}
function carregarServico(rawFirestore) {
  const window = { getDTRawFirestore: () => rawFirestore, _currentAnalistaUser: { email: 'comprador@empresa.com' }, registrarAuditoria: async () => null };
  vm.runInNewContext(code, { window });
  return window._fornecedoresService;
}

test('vincularProdutoFornecedor: doc ID é determinístico — chamar duas vezes faz upsert, não duplica', async () => {
  const rawFs = criarFirestoreFake();
  const svc = carregarServico(rawFs);
  await svc.vincularProdutoFornecedor({ fornecedorId: '11222333000181', produtoId: '500', produtoNomeSnapshot: 'Farinha de Trigo', precoReferencia: 2.5 });
  await svc.vincularProdutoFornecedor({ fornecedorId: '11222333000181', produtoId: '500', produtoNomeSnapshot: 'Farinha de Trigo', precoReferencia: 3.0 });
  const doc = await rawFs.collection('compras_fornecedor_produtos').doc('11222333000181_500').get();
  assert.equal(doc.exists, true);
  assert.equal(doc.data().precoReferencia, 3.0); // upsert atualizou, não criou um segundo doc
  const todos = await rawFs.collection('compras_fornecedor_produtos').get();
  assert.equal(todos.docs.length, 1);
});

test('vincularProdutoFornecedor: código de produto com caracteres especiais gera ID seguro (sem quebrar path do Firestore)', async () => {
  const rawFs = criarFirestoreFake();
  const svc = carregarServico(rawFs);
  await svc.vincularProdutoFornecedor({ fornecedorId: 'f1', produtoId: 'PROD/500 A' });
  const todos = await rawFs.collection('compras_fornecedor_produtos').get();
  assert.equal(todos.docs.length, 1);
  assert.doesNotMatch(todos.docs[0].id, /\//);
});

test('vincularProdutoFornecedor: exige fornecedor e produto', async () => {
  const svc = carregarServico(criarFirestoreFake());
  await assert.rejects(() => svc.vincularProdutoFornecedor({ produtoId: '500' }), /fornecedor/i);
  await assert.rejects(() => svc.vincularProdutoFornecedor({ fornecedorId: 'f1' }), /produto/i);
});

test('listarProdutosDoFornecedor e listarHomologadosPorProduto filtram corretamente', async () => {
  const rawFs = criarFirestoreFake();
  const svc = carregarServico(rawFs);
  await rawFs.collection('compras_fornecedores_resumo').doc('f1').set({ fornecedorId:'f1', nomeFantasia:'Fornecedor 1', situacao:'ativo', homologacaoStatus:'homologado' });
  await rawFs.collection('compras_fornecedores_resumo').doc('f2').set({ fornecedorId:'f2', nomeFantasia:'Fornecedor 2', situacao:'ativo', homologacaoStatus:'homologado' });
  await svc.vincularProdutoFornecedor({ fornecedorId: 'f1', produtoId: '500', homologado: true });
  await svc.vincularProdutoFornecedor({ fornecedorId: 'f2', produtoId: '500', homologado: false });
  await svc.vincularProdutoFornecedor({ fornecedorId: 'f1', produtoId: '600', homologado: true });
  const doFornecedor = await svc.listarProdutosDoFornecedor('f1');
  assert.equal(doFornecedor.length, 2);
  const homologados500 = await svc.listarHomologadosPorProduto('500');
  assert.equal(homologados500.length, 1);
  assert.equal(homologados500[0].fornecedorId, 'f1');
});

test('fornecedor bloqueado/inativo não volta como homologado só porque o vínculo produto está homologado', async () => {
  const rawFs = criarFirestoreFake();
  const svc = carregarServico(rawFs);
  await rawFs.collection('compras_fornecedores_resumo').doc('ok').set({fornecedorId:'ok',nomeFantasia:'OK',situacao:'ativo',homologacaoStatus:'homologado'});
  await rawFs.collection('compras_fornecedores_resumo').doc('blk').set({fornecedorId:'blk',nomeFantasia:'Bloqueado',situacao:'bloqueado',homologacaoStatus:'homologado'});
  await svc.vincularProdutoFornecedor({fornecedorId:'ok',produtoId:'700',homologado:true});
  await svc.vincularProdutoFornecedor({fornecedorId:'blk',produtoId:'700',homologado:true});
  const lista=await svc.listarHomologadosPorProduto('700');
  assert.deepEqual(lista.map(x=>x.fornecedorId),['ok']);
});
