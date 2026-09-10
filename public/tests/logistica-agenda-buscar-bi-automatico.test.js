// PEDIDO AO VIVO (2026-08-26): mesmo padrão "conecta a pasta do BI uma vez,
// clica em Buscar" da tela de Notas Retornadas, agora na Agenda de
// Recebimento (page-recebimento-agendamentos) — botão "📊 Buscar do BI" lê
// compras_a_receber.json via DTBiPastaLocal e cai em
// importarComprasAReceberBiJson (90-bluesoft-service.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const relCode = fs.readFileSync(path.join(base, '94-recebimento-relatorios.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }) };
}

function loadRelatorios(dtBiPastaLocalMock, importarComprasAReceberBiJsonMock) {
  const elementos = new Map();
  function elFake(id) { if (!elementos.has(id)) elementos.set(id, { id, value: '', textContent: '', innerHTML: '' }); return elementos.get(id); }
  const document = { addEventListener: () => {}, getElementById: (id) => elFake(id), createElement: () => ({ click: () => {} }) };
  const window = {
    getDTFirestore: () => ({ collection: (nome) => nome === 'recebimento_agendamentos' ? mockColecao([]) : mockColecao([]) }),
    _recebimentoOperacaoInternals: { carregar: async () => {}, recebimentos: () => [] },
    _recebimentoInternals: { carregar: async () => {}, notasFiltradas: () => [] },
    sincronizarAgendaBluesoft: async () => ({ totalPedidos: 0, totalPedidosPendentes: 0, criados: 0, atualizados: 0 }),
    importarComprasAReceberBiJson: importarComprasAReceberBiJsonMock,
    DTBiPastaLocal: dtBiPastaLocalMock,
    openModal: () => {}, closeModal: () => {}, showToast: () => {}, showConfirm: (msg, exec) => exec(),
  };
  vm.runInNewContext(relCode, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, Blob: class {}, URL: { createObjectURL: () => '' } }, { filename: '94-recebimento-relatorios.js' });
  return { window, elFake };
}

test('Agenda: mostra "Buscar do BI" quando DTBiPastaLocal.suportado() é true', async () => {
  const { window, elFake } = loadRelatorios({ suportado: () => true });
  await window.renderRecebimentoAgendamentos();
  assert.match(elFake('page-recebimento-agendamentos').innerHTML, /data-recag-buscar-bi="1">📊 Buscar do BI</);
});

test('Agenda: sem suporte no navegador, não mostra o botão automático nem nenhum seletor de arquivo manual', async () => {
  const { window, elFake } = loadRelatorios({ suportado: () => false });
  await window.renderRecebimentoAgendamentos();
  const html = elFake('page-recebimento-agendamentos').innerHTML;
  assert.doesNotMatch(html, /data-recag-buscar-bi/);
  assert.doesNotMatch(html, /type="file"/, 'pedido ao vivo: tirar o seletor de arquivo manual — só o botão Buscar');
});

test('buscarComprasAReceberBiAutomatico: já conectado, lê o JSON certo e chama importarComprasAReceberBiJson', async () => {
  let conectarChamado = false;
  const registros = [{ pedido_key: 1 }];
  const importarMock = async (regs) => { assert.equal(regs, registros); return { totalPedidosPendentes: 1, criados: 1, atualizados: 0 }; };
  const { window, elFake } = loadRelatorios({
    suportado: () => true, status: async () => 'conectado',
    conectar: async () => { conectarChamado = true; return { ok: true }; },
    lerJson: async (nome) => { assert.equal(nome, 'compras_a_receber.json'); return registros; },
  }, importarMock);
  await window.renderRecebimentoAgendamentos();
  await window._recebimentoRelatoriosInternals.buscarComprasAReceberBiAutomatico();
  assert.equal(conectarChamado, false);
  assert.match(elFake('page-recebimento-agendamentos').innerHTML, /1 pedido\(s\) pendente\(s\) do BI \(1 novo\(s\), 0 atualizado\(s\)\)/);
});

test('buscarComprasAReceberBiAutomatico: não conectado ainda, conecta primeiro e depois lê', async () => {
  const ordem = [];
  const { window } = loadRelatorios({
    suportado: () => true, status: async () => 'nao-conectado',
    conectar: async () => { ordem.push('conectar'); return { ok: true }; },
    lerJson: async () => { ordem.push('lerJson'); return []; },
  }, async () => { ordem.push('importar'); return { totalPedidosPendentes: 0, criados: 0, atualizados: 0 }; });
  await window.renderRecebimentoAgendamentos();
  await window._recebimentoRelatoriosInternals.buscarComprasAReceberBiAutomatico();
  assert.deepEqual(ordem, ['conectar', 'lerJson', 'importar']);
});

test('buscarComprasAReceberBiAutomatico: conexão recusada mostra o erro, sem chamar importar', async () => {
  let importouAlgo = false;
  const { window } = loadRelatorios({
    suportado: () => true, status: async () => 'nao-conectado',
    conectar: async () => ({ ok: false, erro: 'Seleção cancelada.' }),
    lerJson: async () => { throw new Error('não deveria chamar'); },
  }, async () => { importouAlgo = true; });
  let toastMsg = '';
  window.showToast = (msg) => { toastMsg = msg; };
  await window.renderRecebimentoAgendamentos();
  await window._recebimentoRelatoriosInternals.buscarComprasAReceberBiAutomatico();
  assert.equal(toastMsg, 'Seleção cancelada.');
  assert.equal(importouAlgo, false);
});
