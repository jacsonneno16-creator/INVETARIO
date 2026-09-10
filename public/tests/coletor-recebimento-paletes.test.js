// Coletor > Recebimento > Paletes (saída/entrada com mercados externos).
// PEDIDO AO VIVO: "no coletor colocar a opção de saída/entrada de paletes,
// onde vai escolher o motorista, colocar o número da viagem e a quantidade
// de paletes; quando voltar, mesma coisa: número da viagem e quantidade que
// retornou". Coleção própria `recebimento_paletes` (por loja, sem
// cross-loja) — ver 25-recebimento-paletes.js pro motivo de não reaproveitar
// `recebimentos`/TRANSBORDO.
//
// PEDIDO AO VIVO (2026-09-04): "os motorista que vai aparecer lá são os
// mesmo motoristas da parte de notas retornadas" — motorista passou a vir
// de `recebimento_recusas_motoristas` (o MESMO cadastro por loja de Notas
// Retornadas), não mais do cadastro global `recebimento_motoristas` do
// Transbordo.
//
// PEDIDO AO VIVO (2026-09-04): "o nome lá vai mudar... 'controle de
// paletes'... vai ter duas opções, paletes em estoque e saída de paletes...
// paletes em estoque é onde a pessoa vai colocar todo dia a quantidade de
// paletes que tem" — abrirControlePaletes() abre o menu; a saída de
// paletes de sempre continua igual; "Paletes em Estoque" é um registro
// NOVO, simples, 1 doc por dia (id = data local) em
// recebimento_paletes_estoque.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const base = path.join(__dirname, '../js/coletor');
// 22-recebimento.js só entra pelas constantes/utilitários globais que
// 25-recebimento-paletes.js reaproveita (COL_MOTORISTAS, _escRec,
// _lojaAtivaRec) — mesma ordem de carregamento real do coletor.html.
const recCode = fs.readFileSync(path.join(base, '22-recebimento.js'), 'utf8');
const paletesCode = fs.readFileSync(path.join(base, '25-recebimento-paletes.js'), 'utf8');

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
        set: async p => { const a = registro.get(docId) || {}; registro.set(docId, { ...a, ...p }); },
        update: async p => { const a = registro.get(docId); if (a === undefined) throw new Error('NOT_FOUND'); registro.set(docId, { ...a, ...p }); },
        delete: async () => { registro.delete(docId); },
      };
    },
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    _registro: registro,
  };
}

const SHELL = `<!doctype html><html><body>
<div id="paletes-lista-transito"></div>
<select id="paletes-saida-motorista"></select>
<input id="paletes-saida-mercado">
<input id="paletes-saida-viagem">
<input id="paletes-saida-quantidade">
<div id="paletes-saida-status"></div>
<div id="paletes-retorno-resumo"></div>
<input id="paletes-retorno-viagem">
<input id="paletes-retorno-quantidade">
<div id="paletes-retorno-status"></div>
<div id="paletes-estoque-ultimo"></div>
<input id="paletes-estoque-quantidade">
<div id="paletes-estoque-status"></div>
</body></html>`;

function loadPaletes(colecoes, opts) {
  const telas = [];
  const toasts = [];
  const chamadasLedger = [];
  const dom = new JSDOM(SHELL, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const lojas = mockColecao([{ id: (opts && opts.lojaId) || 'loja1', data: { nome: (opts && opts.lojaNome) || 'Loja Matriz' } }]);
  win.FS = { collection: nome => (colecoes && colecoes[nome]) || mockColecao([]) };
  win.APP = { operador: { email: 'operador@daterrinha.com' } };
  win.goScreen = id => { telas.push(id); };
  win.toast = (msg, tipo) => { toasts.push({ msg, tipo }); };
  win.getDTLojaAtiva = () => (opts && opts.lojaId) || 'loja1';
  win.getDTRawFirestore = () => ({
    collection: nome => (nome === 'lojas' ? lojas : mockColecao([])),
  });
  // 28-recebimento-paletes-ledger.js não é carregado neste teste (ele é o
  // arquivo à parte, com teste próprio em recebimento-paletes-ledger.test.js)
  // — aqui só verificamos que 25 CHAMA _aplicarMovimentoLedger com os
  // parâmetros certos, não o que o ledger faz por dentro. Espião simples;
  // opts.ledgerFalha simula a rede caindo nessa chamada específica.
  win._aplicarMovimentoLedger = async function (lojaId, tipo, deltas, referencia) {
    chamadasLedger.push({ lojaId, tipo, deltas, referencia });
    if (opts && opts.ledgerFalha) throw new Error('Falha simulada no ledger');
  };
  Object.defineProperty(win.navigator, 'onLine', { get: () => !opts || opts.online !== false, configurable: true });
  win.eval(recCode);
  win.eval(paletesCode);
  return { window: win, document, telas, toasts, chamadasLedger };
}

test('carregarPaletesColetor: carrega viagens e motoristas, e a lista mostra só as EM_TRANSITO', async () => {
  const paletes = mockColecao([
    { id: 'p1', data: { motoristaNome: 'Carlos', mercado: 'Assai - 278', numeroViagem: '100', paletesSaida: 20, status: 'EM_TRANSITO', horaSaida: '2026-09-01T08:00:00.000Z' } },
    { id: 'p2', data: { motoristaNome: 'João', mercado: 'Extra - 12', numeroViagem: '101', paletesSaida: 10, paletesRetorno: 10, status: 'FINALIZADO', horaSaida: '2026-08-30T08:00:00.000Z' } },
  ]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos', codigo: 'MOT-1' } }]);
  const { window, document } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: motoristas });

  await window.carregarPaletesColetor();

  assert.equal(window._recebimentoPaletesInternals.getPaletes().length, 2);
  assert.equal(window._recebimentoPaletesInternals.getMotoristas().length, 1);
  const html = document.getElementById('paletes-lista-transito').innerHTML;
  assert.match(html, /Viagem 100/);
  assert.match(html, /Carlos/);
  assert.doesNotMatch(html, /Viagem 101/, 'viagem já finalizada não deve aparecer na lista de em trânsito');
});

test('confirmarSaidaPaletes: cria a viagem com motorista/mercado/viagem/quantidade e status EM_TRANSITO', async () => {
  const paletes = mockColecao([]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos', placa: 'ABC1D23' } }]);
  const { window, document } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: motoristas });

  await window.abrirNovaSaidaPaletes();
  document.getElementById('paletes-saida-motorista').value = 'm1';
  document.getElementById('paletes-saida-mercado').value = 'Assai - Loja 278';
  document.getElementById('paletes-saida-viagem').value = '4521';
  document.getElementById('paletes-saida-quantidade').value = '20';

  await window.confirmarSaidaPaletes();

  assert.equal(paletes._registro.size, 1);
  const doc = [...paletes._registro.values()][0];
  assert.equal(doc.motoristaId, 'm1');
  assert.equal(doc.motoristaNome, 'Carlos');
  assert.equal(doc.mercado, 'Assai - Loja 278');
  assert.equal(doc.numeroViagem, '4521');
  assert.equal(doc.paletesSaida, 20);
  assert.equal(doc.paletesRetorno, null);
  assert.equal(doc.status, 'EM_TRANSITO');
  assert.equal(doc.origemLojaId, 'loja1');
});

test('confirmarSaidaPaletes: alimenta o ledger (disponível -20 / em trânsito +20) referenciando o doc criado', async () => {
  const paletes = mockColecao([]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos', placa: 'ABC1D23' } }]);
  const { window, document, chamadasLedger } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: motoristas });

  await window.abrirNovaSaidaPaletes();
  document.getElementById('paletes-saida-motorista').value = 'm1';
  document.getElementById('paletes-saida-mercado').value = 'Assai - Loja 278';
  document.getElementById('paletes-saida-viagem').value = '4521';
  document.getElementById('paletes-saida-quantidade').value = '20';
  await window.confirmarSaidaPaletes();

  assert.equal(chamadasLedger.length, 1);
  assert.equal(chamadasLedger[0].lojaId, 'loja1');
  assert.equal(chamadasLedger[0].tipo, 'SAIDA_EXTERNA');
  assert.equal(chamadasLedger[0].deltas.disponivelDelta, -20);
  assert.equal(chamadasLedger[0].deltas.emTransitoDelta, 20);
  assert.equal(chamadasLedger[0].referencia.colecao, 'recebimento_paletes');
  assert.equal(chamadasLedger[0].referencia.id, [...paletes._registro.keys()][0]);
});

test('confirmarSaidaPaletes: se o ledger falhar (rede), o registro principal continua salvo e a tela avança normalmente', async () => {
  const paletes = mockColecao([]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos' } }]);
  const { window, document, telas, toasts } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: motoristas }, { ledgerFalha: true });

  await window.abrirNovaSaidaPaletes();
  document.getElementById('paletes-saida-motorista').value = 'm1';
  document.getElementById('paletes-saida-mercado').value = 'Assai - Loja 278';
  document.getElementById('paletes-saida-viagem').value = '4521';
  document.getElementById('paletes-saida-quantidade').value = '20';
  await window.confirmarSaidaPaletes();

  assert.equal(paletes._registro.size, 1, 'falha no ledger não pode impedir o registro principal de salvar');
  assert.ok(toasts.some(t => /registrada/i.test(t.msg)));
  assert.ok(telas.includes('paletes'));
});

test('confirmarSaidaPaletes: recusa salvar sem motorista/mercado/viagem/quantidade válida', async () => {
  const paletes = mockColecao([]);
  const { window, document } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: mockColecao([]) });
  await window.abrirNovaSaidaPaletes();

  await window.confirmarSaidaPaletes();
  assert.equal(paletes._registro.size, 0);
  assert.match(document.getElementById('paletes-saida-status').textContent, /motorista/i);
});

test('confirmarRetornoPaletes: com o número da viagem certo, grava paletesRetorno/horaRetorno e finaliza', async () => {
  const paletes = mockColecao([
    { id: 'p1', data: { motoristaNome: 'Carlos', mercado: 'Assai - 278', numeroViagem: '4521', paletesSaida: 20, paletesRetorno: null, status: 'EM_TRANSITO' } },
  ]);
  const { window, document } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: mockColecao([]) });
  await window.carregarPaletesColetor();

  await window.abrirRetornoPaletes('p1');
  document.getElementById('paletes-retorno-viagem').value = '4521';
  document.getElementById('paletes-retorno-quantidade').value = '18';
  await window.confirmarRetornoPaletes();

  const doc = paletes._registro.get('p1');
  assert.equal(doc.paletesRetorno, 18);
  assert.equal(doc.status, 'FINALIZADO');
  assert.ok(doc.horaRetorno);
});

test('confirmarRetornoPaletes: alimenta o ledger com o que REALMENTE voltou (paletesRetorno), não o que saiu (paletesSaida)', async () => {
  const paletes = mockColecao([
    { id: 'p1', data: { motoristaNome: 'Carlos', mercado: 'Assai - 278', numeroViagem: '4521', paletesSaida: 20, paletesRetorno: null, status: 'EM_TRANSITO', origemLojaId: 'loja1' } },
  ]);
  const { window, document, chamadasLedger } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: mockColecao([]) });
  await window.carregarPaletesColetor();

  await window.abrirRetornoPaletes('p1');
  document.getElementById('paletes-retorno-viagem').value = '4521';
  document.getElementById('paletes-retorno-quantidade').value = '18'; // retorno parcial: saiu 20, voltou 18
  await window.confirmarRetornoPaletes();

  assert.equal(chamadasLedger.length, 1);
  assert.equal(chamadasLedger[0].lojaId, 'loja1');
  assert.equal(chamadasLedger[0].tipo, 'RETORNO_EXTERNO');
  assert.equal(chamadasLedger[0].deltas.disponivelDelta, 18, 'delta tem que ser o que voltou (18), não o que saiu (20)');
  assert.equal(chamadasLedger[0].deltas.emTransitoDelta, -18);
  assert.equal(chamadasLedger[0].referencia.id, 'p1');
});

test('confirmarRetornoPaletes: se o ledger falhar (rede), o retorno continua salvo e a tela avança normalmente', async () => {
  const paletes = mockColecao([
    { id: 'p1', data: { motoristaNome: 'Carlos', mercado: 'Assai - 278', numeroViagem: '4521', paletesSaida: 20, status: 'EM_TRANSITO' } },
  ]);
  const { window, document, telas, toasts } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: mockColecao([]) }, { ledgerFalha: true });
  await window.carregarPaletesColetor();

  await window.abrirRetornoPaletes('p1');
  document.getElementById('paletes-retorno-viagem').value = '4521';
  document.getElementById('paletes-retorno-quantidade').value = '20';
  await window.confirmarRetornoPaletes();

  assert.equal(paletes._registro.get('p1').status, 'FINALIZADO', 'falha no ledger não pode impedir o retorno de fechar a viagem');
  assert.ok(toasts.some(t => /registrado/i.test(t.msg)));
  assert.ok(telas.includes('paletes'));
});

// BUG a evitar (mesma checagem de integridade que o Transbordo já usa na
// chegada, redigitando a NF): se o número da viagem digitado no retorno não
// bate com o registrado na saída, não fecha — evita confirmar a viagem
// errada por engano de toque na lista.
test('confirmarRetornoPaletes: número da viagem digitado errado NÃO fecha a viagem', async () => {
  const paletes = mockColecao([
    { id: 'p1', data: { motoristaNome: 'Carlos', mercado: 'Assai - 278', numeroViagem: '4521', paletesSaida: 20, status: 'EM_TRANSITO' } },
  ]);
  const { window, document } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: mockColecao([]) });
  await window.carregarPaletesColetor();

  await window.abrirRetornoPaletes('p1');
  document.getElementById('paletes-retorno-viagem').value = '9999';
  document.getElementById('paletes-retorno-quantidade').value = '20';
  await window.confirmarRetornoPaletes();

  const doc = paletes._registro.get('p1');
  assert.equal(doc.status, 'EM_TRANSITO', 'viagem não pode fechar com número errado');
  assert.equal(doc.paletesRetorno, undefined);
  assert.match(document.getElementById('paletes-retorno-status').textContent, /não confere/i);
});

test('confirmarRetornoPaletes: retorno parcial (quantidade menor que a saída) ainda finaliza, mas fica com saldo pendente calculável', async () => {
  const paletes = mockColecao([
    { id: 'p1', data: { motoristaNome: 'Carlos', mercado: 'Assai - 278', numeroViagem: '4521', paletesSaida: 20, status: 'EM_TRANSITO' } },
  ]);
  const { window, document } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: mockColecao([]) });
  await window.carregarPaletesColetor();

  await window.abrirRetornoPaletes('p1');
  document.getElementById('paletes-retorno-viagem').value = '4521';
  document.getElementById('paletes-retorno-quantidade').value = '12';
  await window.confirmarRetornoPaletes();

  const doc = paletes._registro.get('p1');
  assert.equal(doc.paletesRetorno, 12);
  assert.equal(doc.paletesSaida, 20); // saldo pendente = 8, calculado no Analista
});

test('carregarPaletesColetor: motorista vem de recebimento_recusas_motoristas (o mesmo cadastro de Notas Retornadas), não do cadastro global do Transbordo', async () => {
  const paletes = mockColecao([]);
  const motoristasNotasRetornadas = mockColecao([{ id: 'm1', data: { nome: 'Carlos (Notas Retornadas)' } }]);
  const motoristasTransbordo = mockColecao([{ id: 'm2', data: { nome: 'João (Transbordo, não deveria aparecer)' } }]);
  const { window } = loadPaletes({ recebimento_paletes: paletes, recebimento_recusas_motoristas: motoristasNotasRetornadas, recebimento_motoristas: motoristasTransbordo });
  await window.carregarPaletesColetor();
  const motoristas = window._recebimentoPaletesInternals.getMotoristas();
  assert.equal(motoristas.length, 1);
  assert.equal(motoristas[0].nome, 'Carlos (Notas Retornadas)');
});

test('abrirControlePaletes: navega pro menu "Controle de Paletes"', () => {
  const { window, telas } = loadPaletes({});
  window.abrirControlePaletes();
  assert.deepEqual(telas, ['paletes-menu']);
});

test('abrirPaletesEstoque: sem registro ainda hoje, avisa "ainda não registrado" e deixa o campo vazio', async () => {
  const estoque = mockColecao([]);
  const { window, document } = loadPaletes({ recebimento_paletes_estoque: estoque });
  await window.abrirPaletesEstoque();
  assert.match(document.getElementById('paletes-estoque-ultimo').textContent, /ainda não/i);
  assert.equal(document.getElementById('paletes-estoque-quantidade').value, '');
});

test('abrirPaletesEstoque: já registrado hoje, pré-preenche o campo com a quantidade salva', async () => {
  const hoje = window_dataHojeIso();
  const estoque = mockColecao([{ id: hoje, data: { data: hoje, quantidade: 75 } }]);
  const { window, document } = loadPaletes({ recebimento_paletes_estoque: estoque });
  await window.abrirPaletesEstoque();
  assert.equal(document.getElementById('paletes-estoque-quantidade').value, '75');
  assert.match(document.getElementById('paletes-estoque-ultimo').textContent, /75/);
});

test('confirmarPaletesEstoque: grava a quantidade de hoje com a loja certa, e volta pro menu', async () => {
  const estoque = mockColecao([]);
  const { window, document, telas, toasts } = loadPaletes({ recebimento_paletes_estoque: estoque }, { lojaId: 'loja1', lojaNome: 'Loja Matriz' });
  await window.abrirPaletesEstoque();
  document.getElementById('paletes-estoque-quantidade').value = '120';
  await window.confirmarPaletesEstoque();

  assert.equal(estoque._registro.size, 1);
  const doc = [...estoque._registro.values()][0];
  assert.equal(doc.quantidade, 120);
  assert.equal(doc.origemLojaId, 'loja1');
  assert.equal(doc.origem, 'Loja Matriz');
  assert.equal(doc.data, window_dataHojeIso());
  assert.ok(telas.includes('paletes-menu'));
  assert.ok(toasts.some(t => /registrado/i.test(t.msg)));
});

test('confirmarPaletesEstoque: registrar de novo no MESMO dia atualiza o mesmo doc (não duplica)', async () => {
  const estoque = mockColecao([]);
  const { window, document } = loadPaletes({ recebimento_paletes_estoque: estoque });
  await window.abrirPaletesEstoque();
  document.getElementById('paletes-estoque-quantidade').value = '100';
  await window.confirmarPaletesEstoque();
  document.getElementById('paletes-estoque-quantidade').value = '95';
  await window.confirmarPaletesEstoque();

  assert.equal(estoque._registro.size, 1, 'mesmo dia = mesmo doc, não 2 registros separados');
  const doc = [...estoque._registro.values()][0];
  assert.equal(doc.quantidade, 95, 'o valor mais recente venceu');
});

test('confirmarPaletesEstoque: recusa salvar quantidade inválida (vazia ou negativa)', async () => {
  const estoque = mockColecao([]);
  const { window, document } = loadPaletes({ recebimento_paletes_estoque: estoque });
  await window.abrirPaletesEstoque();
  await window.confirmarPaletesEstoque();
  assert.equal(estoque._registro.size, 0);
  assert.match(document.getElementById('paletes-estoque-status').textContent, /quantidade/i);

  document.getElementById('paletes-estoque-quantidade').value = '-5';
  await window.confirmarPaletesEstoque();
  assert.equal(estoque._registro.size, 0);
});

// Helper só pra este arquivo de teste: mesma lógica de data local AAAA-MM-DD
// que window._recebimentoPaletesInternals.dataHojeIso() usa — precisa ser
// calculado fora do window (independente do relógio do teste) pra comparar.
function window_dataHojeIso() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
