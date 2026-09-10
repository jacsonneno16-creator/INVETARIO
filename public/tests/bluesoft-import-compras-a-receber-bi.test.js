'use strict';
// PEDIDO AO VIVO (2026-08-26): "agora aplica os outros arquivos" —
// compras_a_receber.json (export do BI) alimenta a MESMA Agenda de
// Recebimento (recebimento_agendamentos) que sincronizarAgendaBluesoft já
// alimenta via API, só que sem precisar da Bluesoft. Uma linha do JSON é
// uma ENTREGA (parcela) de um pedido_key — pode ter várias entregas E
// vários produtos pro mesmo pedido — então agrupa por pedido antes de
// gravar, reaproveitando a MESMA função de escrita (_gravarAgendaPendentes,
// extraída de sincronizarAgendaBluesoft) que a Bluesoft usa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const servicoCode = fs.readFileSync(path.join(base, '90-bluesoft-service.js'), 'utf8');

function mockAmbiente(loja, agendamentosIniciais) {
  const registro = new Map((agendamentosIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const colAgendamentos = {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id: id || ('novo' + (seq++)) }),
  };
  const rawFirestore = {
    collection: (nome) => {
      if (nome === 'lojas') return { doc: () => ({ get: async () => ({ exists: true, data: () => loja }) }) };
      return { doc: () => ({ get: async () => ({ exists: false }) }) };
    },
    batch: () => {
      const ops = [];
      return {
        set: (ref, payload, opts) => { ops.push({ ref, payload, opts }); },
        commit: async () => { ops.forEach(({ ref, payload, opts }) => { const atual = registro.get(ref.id) || {}; registro.set(ref.id, opts?.merge ? { ...atual, ...payload } : payload); }); },
      };
    },
  };
  const firestore = {
    collection: (nome) => nome === 'recebimento_agendamentos' ? colAgendamentos : { get: async () => ({ docs: [] }) },
  };
  return { registro, rawFirestore, firestore };
}

function loadServico(loja, agendamentosIniciais) {
  const document = { addEventListener: () => {} };
  const { registro, rawFirestore, firestore } = mockAmbiente(loja, agendamentosIniciais);
  const window = {
    fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'idtoken' } }) },
    getDTRawFirestore: () => rawFirestore,
    getDTFirestore: () => firestore,
    getDTLojaAtiva: () => 'loja1',
  };
  vm.runInNewContext(servicoCode, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, URLSearchParams, JSON, AbortController, setTimeout, clearTimeout }, { filename: '90-bluesoft-service.js' });
  return { w: window, registro };
}

const linhaBase = { loja_key: 14, pedido_key: 317223, entrega: 4, fornecedor: 'VIBELPLAST EMBALAGEN', produto_key: 72009, descricao: 'BOBINA TAPIOCA DA TERRINHA 70 G', comprador: 'vitor', qtd_unidades_pendentes: 800, data_entrega_inicial: '2026-07-20T00:00:00', data_entrega_final: '2026-11-06T00:00:00' };

test('_agruparComprasAReceberBiPorPedido: 2 entregas do mesmo pedido/produto viram 1 registro com a menor data inicial e maior data final', () => {
  const { w } = loadServico({ nome: 'Loja 1' });
  const linhas = [
    { ...linhaBase, entrega: 4, data_entrega_inicial: '2026-07-20T00:00:00', data_entrega_final: '2026-11-06T00:00:00', qtd_unidades_pendentes: 800 },
    { ...linhaBase, entrega: 5, data_entrega_inicial: '2026-11-07T00:00:00', data_entrega_final: '2026-11-30T00:00:00', qtd_unidades_pendentes: 200 },
  ];
  const grupos = w._bluesoftServiceInternals._agruparComprasAReceberBiPorPedido(linhas, null);
  assert.equal(grupos.length, 1);
  const g = grupos[0];
  assert.equal(g.numeroPedido, '317223');
  assert.equal(g.dataEntregaInicial, '2026-07-20');
  assert.equal(g.dataEntregaFinal, '2026-11-30');
  assert.equal(g.itens.length, 1, 'mesmo produto nas 2 entregas — soma em UM item');
  assert.equal(g.itens[0].quantidadePendente, 1000);
  assert.equal(g.fornecedorNome, 'VIBELPLAST EMBALAGEN');
});

test('_agruparComprasAReceberBiPorPedido: linhas já entregues (qtd_unidades_pendentes 0/null) são ignoradas', () => {
  const { w } = loadServico({ nome: 'Loja 1' });
  const grupos = w._bluesoftServiceInternals._agruparComprasAReceberBiPorPedido([{ ...linhaBase, qtd_unidades_pendentes: 0 }, { ...linhaBase, qtd_unidades_pendentes: null }], null);
  assert.equal(grupos.length, 0);
});

test('_agruparComprasAReceberBiPorPedido: filtra por loja_key quando informado', () => {
  const { w } = loadServico({ nome: 'Loja 1' });
  const grupos = w._bluesoftServiceInternals._agruparComprasAReceberBiPorPedido([{ ...linhaBase, loja_key: 14, pedido_key: 1 }, { ...linhaBase, loja_key: 11, pedido_key: 2 }], 14);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].numeroPedido, '1');
});

test('importarComprasAReceberBiJson: cria um agendamento novo em recebimento_agendamentos, origem bluesoft', async () => {
  const { w, registro } = loadServico({ nome: 'Loja 1', bluesoft_loja_key: 14 }, []);
  const resultado = await w.importarComprasAReceberBiJson([linhaBase]);
  assert.equal(resultado.criados, 1);
  assert.equal(resultado.atualizados, 0);
  const doc = [...registro.values()][0];
  assert.equal(doc.origem, 'bluesoft');
  assert.equal(doc.numeroPedido, '317223');
  assert.equal(doc.fornecedorNome, 'VIBELPLAST EMBALAGEN');
  assert.equal(doc.dataPrevista, '2026-07-20');
  assert.equal(doc.itensPedido[0].quantidadePendente, 800);
});

test('importarComprasAReceberBiJson: pedido já existente é ATUALIZADO (merge), não duplicado', async () => {
  const { w, registro } = loadServico({ nome: 'Loja 1', bluesoft_loja_key: 14 }, [{ id: 'ag1', data: { numeroPedido: '317223', origem: 'bluesoft', dataAgendada: '', dataPrevista: '2026-06-01' } }]);
  const resultado = await w.importarComprasAReceberBiJson([linhaBase]);
  assert.equal(resultado.criados, 0);
  assert.equal(resultado.atualizados, 1);
  assert.equal(registro.size, 1);
  assert.equal(registro.get('ag1').dataPrevista, '2026-07-20');
});

test('importarComprasAReceberBiJson: loja sem bluesoft_loja_key ainda importa (sem filtro de loja), não trava', async () => {
  const { w } = loadServico({ nome: 'Loja sem vínculo' }, []);
  const resultado = await w.importarComprasAReceberBiJson([linhaBase]);
  assert.equal(resultado.criados, 1);
});

test('importarComprasAReceberBiJson: sem nenhum pedido pendente pra loja, lança erro claro', async () => {
  const { w } = loadServico({ nome: 'Loja 1', bluesoft_loja_key: 14 }, []);
  await assert.rejects(() => w.importarComprasAReceberBiJson([{ ...linhaBase, loja_key: 11 }]), /Nenhum pedido de compra pendente encontrado/);
});
