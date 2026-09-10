// Coletor > Recebimento > Nova Movimentação > Transferência de paletes.
// Movimento simples entre lojas (sem produto/NF): enviar reaproveita o
// mecanismo de destino do Transbordo ad-hoc (ROTAS_CACHE/_destinosPossiveis,
// 22-recebimento.js); confirmar recebimento cruza pelas MESMAS rotas
// (_origensParaCruzar), já que é o mesmo grafo de parceiros. Alimenta o
// ledger de paletes nos dois momentos (expedição na origem, recebimento
// cross-loja debitando a origem + creditando o destino).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const base = path.join(__dirname, '../js/coletor');
const recCode = fs.readFileSync(path.join(base, '22-recebimento.js'), 'utf8');
const transfCode = fs.readFileSync(path.join(base, '27-transferencia-paletes.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const snapshot = entradas => ({ empty: entradas.length === 0, size: entradas.length, docs: entradas.map(([id, data]) => ({ id, data: () => data, exists: true })) });
  return {
    get: async () => snapshot([...registro.entries()]),
    doc: id => {
      const docId = id || ('novo' + (seq++));
      return {
        id: docId,
        get: async () => { const data = registro.get(docId); return { exists: data !== undefined, id: docId, data: () => data }; },
        update: async p => { const a = registro.get(docId); if (a === undefined) throw new Error('NOT_FOUND'); registro.set(docId, { ...a, ...p }); },
      };
    },
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    where: (campo, op, valor) => {
      const filtrados = () => [...registro.entries()].filter(([, data]) => data && data[campo] === valor);
      return { get: async () => snapshot(filtrados()) };
    },
    _registro: registro,
  };
}

const SHELL = `<!doctype html><html><body>
<select id="transferencia-destino"></select>
<input id="transferencia-quantidade">
<input id="transferencia-observacao">
<div id="transferencia-status"></div>
<div id="transferencia-confirmar-lista-itens"></div>
<div id="transferencia-confirmar-resumo"></div>
<input id="transferencia-confirmar-quantidade">
<div id="transferencia-confirmar-status"></div>
</body></html>`;

// lojasSub: { [lojaId]: { recebimento_transferencias_paletes: mockColecao(...) } }
function loadTransferencia(rotas, lojasSub, opts) {
  const telas = [];
  const toasts = [];
  const chamadasLedger = [];
  const dom = new JSDOM(SHELL, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const lojas = mockColecao([{ id: (opts && opts.lojaId) || 'loja1', data: { nome: (opts && opts.lojaNome) || 'Loja Matriz' } }]);
  const minhaLoja = (opts && opts.lojaId) || 'loja1';
  win.FS = {
    collection: nome => {
      if (nome === 'recebimento_rotas_transbordo') return rotas;
      return (lojasSub[minhaLoja] && lojasSub[minhaLoja][nome]) || mockColecao([]);
    },
  };
  win.APP = { operador: { email: 'operador@daterrinha.com' } };
  win.goScreen = id => { telas.push(id); };
  win.toast = (msg, tipo) => { toasts.push({ msg, tipo }); };
  win.getDTLojaAtiva = () => (opts && opts.lojaId) || 'loja1';
  win.getDTRawFirestore = () => ({
    collection: nome => {
      if (nome !== 'lojas') return mockColecao([]);
      return {
        get: lojas.get,
        doc: lojaId => Object.assign(lojas.doc(lojaId), {
          collection: sub => (lojasSub[lojaId] && lojasSub[lojaId][sub]) || mockColecao([]),
        }),
      };
    },
  });
  win._aplicarMovimentoLedger = async function (lojaId, tipo, deltas, referencia) {
    chamadasLedger.push({ lojaId, tipo, deltas, referencia });
    if (opts && opts.ledgerFalha) throw new Error('Falha simulada no ledger');
  };
  let online = !opts || opts.online !== false;
  Object.defineProperty(win.navigator, 'onLine', { get: () => online, configurable: true });
  win.eval(recCode);
  win.eval(transfCode);
  return { window: win, document, telas, toasts, chamadasLedger, setOnline: v => { online = v; } };
}

const ROTA_MATRIZ_FILIAL = { id: 'r1', data: { origemLojaId: 'loja1', origemNome: 'Loja Matriz', destinoLojaId: 'loja2', destinoNome: 'Loja Filial' } };

test('abrirTransferenciaMenu: navega pro menu de transferência', () => {
  const { window, telas } = loadTransferencia(mockColecao([]), {});
  window.abrirTransferenciaMenu();
  assert.deepEqual(telas, ['transferencia-menu']);
});

test('abrirTransferenciaPaletes: preenche o destino com as mesmas rotas do Transbordo ad-hoc', async () => {
  const rotas = mockColecao([ROTA_MATRIZ_FILIAL]);
  const { window, document } = loadTransferencia(rotas, {});
  await window.abrirTransferenciaPaletes();
  assert.match(document.getElementById('transferencia-destino').innerHTML, /Loja Filial/);
});

test('confirmarTransferenciaPaletes: cria o doc na origem com status EM_TRANSITO e alimenta o ledger (disponível -qtd / em trânsito +qtd)', async () => {
  const rotas = mockColecao([ROTA_MATRIZ_FILIAL]);
  const transferenciasOrigem = mockColecao([]);
  const { window, document, chamadasLedger, telas } = loadTransferencia(rotas, { loja1: { recebimento_transferencias_paletes: transferenciasOrigem } });

  await window.abrirTransferenciaPaletes();
  document.getElementById('transferencia-destino').value = 'loja2';
  document.getElementById('transferencia-quantidade').value = '15';
  document.getElementById('transferencia-observacao').value = 'Reposição mensal';
  await window.confirmarTransferenciaPaletes();

  assert.equal(transferenciasOrigem._registro.size, 1);
  const doc = [...transferenciasOrigem._registro.values()][0];
  assert.equal(doc.origemLojaId, 'loja1');
  assert.equal(doc.destinoLojaId, 'loja2');
  assert.equal(doc.destinoNome, 'Loja Filial');
  assert.equal(doc.quantidade, 15);
  assert.equal(doc.status, 'EM_TRANSITO');
  assert.equal(doc.observacao, 'Reposição mensal');
  assert.equal(doc.quantidadeRecebida, null);

  assert.equal(chamadasLedger.length, 1);
  assert.equal(chamadasLedger[0].lojaId, 'loja1');
  assert.equal(chamadasLedger[0].tipo, 'TRANSFERENCIA_EXPEDICAO');
  assert.equal(chamadasLedger[0].deltas.disponivelDelta, -15);
  assert.equal(chamadasLedger[0].deltas.emTransitoDelta, 15);
  assert.ok(telas.includes('transferencia-menu'));
});

test('confirmarTransferenciaPaletes: recusa sem destino ou quantidade inválida', async () => {
  const { window, document } = loadTransferencia(mockColecao([ROTA_MATRIZ_FILIAL]), { loja1: { recebimento_transferencias_paletes: mockColecao([]) } });
  await window.abrirTransferenciaPaletes();

  await window.confirmarTransferenciaPaletes();
  assert.match(document.getElementById('transferencia-status').textContent, /destino/i);

  document.getElementById('transferencia-destino').value = 'loja2';
  document.getElementById('transferencia-quantidade').value = '0';
  await window.confirmarTransferenciaPaletes();
  assert.match(document.getElementById('transferencia-status').textContent, /quantidade/i);
});

test('carregarTransferenciasPendentes: cruza pelas lojas com rota PRA esta loja (_origensParaCruzar) e só traz EM_TRANSITO destinadas a ela', async () => {
  const rotas = mockColecao([ROTA_MATRIZ_FILIAL]); // loja1 -> loja2
  const transferenciasOrigemLoja1 = mockColecao([
    { id: 't1', data: { origemNome: 'Loja Matriz', destinoLojaId: 'loja2', destinoNome: 'Loja Filial', quantidade: 10, status: 'EM_TRANSITO' } },
    { id: 't2', data: { origemNome: 'Loja Matriz', destinoLojaId: 'loja2', destinoNome: 'Loja Filial', quantidade: 5, status: 'FINALIZADO' } },
    { id: 't3', data: { origemNome: 'Loja Matriz', destinoLojaId: 'loja9-outra', destinoNome: 'Outra Loja', quantidade: 99, status: 'EM_TRANSITO' } },
  ]);
  // Rodando do lado da loja2 (destino) — precisa ver o que loja1 mandou pra ela
  const { window, document } = loadTransferencia(rotas, { loja1: { recebimento_transferencias_paletes: transferenciasOrigemLoja1 } }, { lojaId: 'loja2' });

  await window.abrirConfirmarRecebimentoTransferencia();

  const pendentes = window._transferenciaPaletesInternals.getPendentes();
  assert.equal(pendentes.length, 1);
  assert.equal(pendentes[0]._id, 't1');
  assert.equal(pendentes[0]._origemLojaId, 'loja1');
  const html = document.getElementById('transferencia-confirmar-lista-itens').innerHTML;
  assert.match(html, /10 palete/);
  assert.doesNotMatch(html, /FINALIZADO|99 palete/);
});

test('confirmarRecebimentoTransferencia: fecha a transferência (cross-loja), credita disponível no destino e debita em trânsito na origem com o que REALMENTE chegou', async () => {
  const rotas = mockColecao([ROTA_MATRIZ_FILIAL]);
  const transferenciasOrigemLoja1 = mockColecao([
    { id: 't1', data: { origemLojaId: 'loja1', origemNome: 'Loja Matriz', destinoLojaId: 'loja2', destinoNome: 'Loja Filial', quantidade: 10, status: 'EM_TRANSITO' } },
  ]);
  const { window, document, chamadasLedger, telas } = loadTransferencia(rotas, { loja1: { recebimento_transferencias_paletes: transferenciasOrigemLoja1 } }, { lojaId: 'loja2' });

  await window.abrirConfirmarRecebimentoTransferencia();
  window.abrirConfirmarRecebimentoDetalhe('t1', 'loja1');
  document.getElementById('transferencia-confirmar-quantidade').value = '8'; // recebimento parcial: enviou 10, chegou 8
  await window.confirmarRecebimentoTransferencia();

  const docAtualizado = transferenciasOrigemLoja1._registro.get('t1');
  assert.equal(docAtualizado.status, 'FINALIZADO');
  assert.equal(docAtualizado.quantidadeRecebida, 8);
  assert.ok(docAtualizado.horaRecebimento);

  assert.equal(chamadasLedger.length, 2);
  const origem = chamadasLedger.find(c => c.lojaId === 'loja1');
  const destino = chamadasLedger.find(c => c.lojaId === 'loja2');
  assert.equal(origem.tipo, 'TRANSFERENCIA_RECEBIMENTO');
  assert.equal(origem.deltas.emTransitoDelta, -8, 'delta tem que ser o que chegou (8), não o que saiu (10)');
  assert.equal(destino.tipo, 'TRANSFERENCIA_RECEBIMENTO');
  assert.equal(destino.deltas.disponivelDelta, 8);
  assert.ok(telas.includes('transferencia-confirmar-lista'));
  assert.equal(window._transferenciaPaletesInternals.getPendentes().length, 0, 'transferência confirmada some da lista de pendentes');
});

test('confirmarRecebimentoTransferencia: sem conexão, recusa confirmar (mesma limitação online-only da Expedição de carga)', async () => {
  const rotas = mockColecao([ROTA_MATRIZ_FILIAL]);
  const transferenciasOrigemLoja1 = mockColecao([
    { id: 't1', data: { origemLojaId: 'loja1', destinoLojaId: 'loja2', quantidade: 10, status: 'EM_TRANSITO' } },
  ]);
  const { window, document, setOnline } = loadTransferencia(rotas, { loja1: { recebimento_transferencias_paletes: transferenciasOrigemLoja1 } }, { lojaId: 'loja2' });

  // Descobre a transferência pendente ONLINE (como aconteceria de verdade
  // ao abrir a tela), só cai offline bem na hora de confirmar.
  await window.abrirConfirmarRecebimentoTransferencia();
  window.abrirConfirmarRecebimentoDetalhe('t1', 'loja1');
  setOnline(false);
  document.getElementById('transferencia-confirmar-quantidade').value = '10';
  await window.confirmarRecebimentoTransferencia();

  assert.match(document.getElementById('transferencia-confirmar-status').textContent, /sem conexão/i);
  assert.equal(transferenciasOrigemLoja1._registro.get('t1').status, 'EM_TRANSITO');
});

test('confirmarRecebimentoTransferencia: se o ledger falhar, a confirmação de recebimento em si continua salva', async () => {
  const rotas = mockColecao([ROTA_MATRIZ_FILIAL]);
  const transferenciasOrigemLoja1 = mockColecao([
    { id: 't1', data: { origemLojaId: 'loja1', destinoLojaId: 'loja2', quantidade: 10, status: 'EM_TRANSITO' } },
  ]);
  const { window, document } = loadTransferencia(
    rotas,
    { loja1: { recebimento_transferencias_paletes: transferenciasOrigemLoja1 } },
    { lojaId: 'loja2', ledgerFalha: true }
  );

  await window.abrirConfirmarRecebimentoTransferencia();
  window.abrirConfirmarRecebimentoDetalhe('t1', 'loja1');
  document.getElementById('transferencia-confirmar-quantidade').value = '10';
  await window.confirmarRecebimentoTransferencia();

  assert.equal(transferenciasOrigemLoja1._registro.get('t1').status, 'FINALIZADO', 'falha no ledger não pode impedir a confirmação de recebimento de salvar');
});
