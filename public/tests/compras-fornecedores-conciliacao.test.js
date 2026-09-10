// Fase 1A — Seção E: simulação de conciliação de fornecedor legado
// (texto livre, sem CNPJ) contra o cadastro mestre. Pedido explícito:
// "Não executar migração definitiva sem minha aprovação" — por isso esta
// tela é SÓ LEITURA e o teste central aqui é justamente confirmar que
// rodar a simulação nunca grava nada.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/compras-fornecedores-service.js'), 'utf8');

function criarFirestoreFake() {
  const dados = new Map();
  let autoIdSeq = 0;
  function bate(docData, filtros) { return filtros.every(([campo, op, valor]) => op === '==' && docData[campo] === valor); }
  function colecaoRef(nome) {
    const prefixo = nome + '/';
    function getComFiltros(filtros) {
      const docs = [...dados.entries()]
        .filter(([k]) => k.startsWith(prefixo) && k.slice(prefixo.length).indexOf('/') === -1)
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
          collection: (subNome) => colecaoRef(prefixo + docId + '/' + subNome),
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

async function montarCenario() {
  const rawFs = criarFirestoreFake();
  const svc = carregarServico(rawFs);
  await svc.criarFornecedor({ razaoSocial: '2JM Amidos e Derivados Ltda', nomeFantasia: '2jm amidos' });
  await svc.criarFornecedor({ razaoSocial: 'Terra Fecundante Ltda', nomeFantasia: 'Terra Fecundante' });
  await svc.criarFornecedor({ razaoSocial: 'Terra Fértil Ltda', nomeFantasia: 'Terra Fértil' });

  await rawFs.collection('lojas').doc('loja1').set({ nome: 'Loja 1' });
  await rawFs.collection('lojas').doc('loja1').collection('producao_produtos').doc('p1').set({ fornecedorPadrao: '2JM AMIDOS' });
  await rawFs.collection('lojas').doc('loja1').collection('pcp_requisicoes_compra').doc('r1').set({ fornecedor: 'Terra', cotacoes: [{ fornecedor: 'Fornecedor Nunca Cadastrado XYZ123' }] });
  await rawFs.collection('lojas').doc('loja1').collection('pcp_agendamentos').doc('a1').set({});
  await rawFs.collection('recebimento_agendamentos').doc('rec1').set({ fornecedorNome: '' });
  await rawFs.collection('bi_fornecedores_agregado').doc('bi1').set({ categoria: 'materia_prima', ano: '2026', top: [{ f: 'BI Only Fornecedor Nunca Visto' }] });
  return { rawFs, svc };
}

test('simularConciliacaoLegado: classifica exato (nome normalizado idêntico, grafia diferente)', async () => {
  const { svc } = await montarCenario();
  const r = await svc.simularConciliacaoLegado();
  const exato = r.exato.find(x => x.nomeLegado === '2JM AMIDOS');
  assert.ok(exato, 'esperava "2JM AMIDOS" classificado como exato');
  assert.equal(exato.candidatos.length, 1);
  assert.equal(exato.candidatos[0].nomeFantasia, '2jm amidos');
});

test('simularConciliacaoLegado: classifica ambíguo quando 2+ cadastrados são candidatos prováveis', async () => {
  const { svc } = await montarCenario();
  const r = await svc.simularConciliacaoLegado();
  const ambiguo = r.ambiguo.find(x => x.nomeLegado === 'Terra');
  assert.ok(ambiguo, 'esperava "Terra" classificado como ambíguo');
  assert.equal(ambiguo.candidatos.length, 2);
});

test('simularConciliacaoLegado: sem candidato nenhum vira "sem correspondência"', async () => {
  const { svc } = await montarCenario();
  const r = await svc.simularConciliacaoLegado();
  assert.ok(r.semCorrespondencia.some(x => x.nomeLegado === 'Fornecedor Nunca Cadastrado XYZ123'));
  assert.ok(r.semCorrespondencia.some(x => x.nomeLegado === 'BI Only Fornecedor Nunca Visto'));
});

test('simularConciliacaoLegado NUNCA grava nada — pedido explícito de não migrar sem aprovação', async () => {
  const { rawFs, svc } = await montarCenario();
  const tamanhoAntes = rawFs._dados.size;
  await svc.simularConciliacaoLegado();
  assert.equal(rawFs._dados.size, tamanhoAntes);
});

test('conciliarFornecedorLegado (uso isolado) nunca associa sozinho — só classifica', async () => {
  const svc = carregarServico(criarFirestoreFake());
  const cadastrados = [{ fornecedorId: 'f1', nomeFantasia: 'Fornecedor Teste', razaoSocial: 'Fornecedor Teste Ltda' }];
  const r = await svc.conciliarFornecedorLegado('FORNECEDOR TESTE', cadastrados);
  assert.equal(r.classificacao, 'exato');
  assert.equal(r.candidatos.length, 1);
  assert.equal(r.candidatos[0].fornecedorId, 'f1');
});
