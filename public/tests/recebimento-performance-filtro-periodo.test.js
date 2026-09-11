// PEDIDO AO VIVO (usuário: "na parte do analista na parte de tempos e
// perfomance colocar filtro de periodos") — a tela "Tempos / Performance"
// (nav "recebimento-tempos", 96-recebimento-performance.js) só deixava
// escolher UM mês inteiro (<input type="month">). Trocado pelo mesmo
// filtro De/até com atalhos já validado em 95-recebimento-transbordo.js.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const opCode = fs.readFileSync(path.join(base, '93-recebimento-operacao.js'), 'utf8');
const perfCode = fs.readFileSync(path.join(base, '96-recebimento-performance.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: id => ({ id, get: async () => ({ exists: registro.has(id), data: () => registro.get(id) }) }),
  };
}
// PEDIDO AO VIVO (2026-09-11): 93-recebimento-operacao.js passou a usar
// setInterval (polling de 45s em vez de onSnapshot — ver comentário
// "2026-09-11" no arquivo), disparado no fim de carregarRecebimentoOperacao()
// — chamado por esta tela via global._recebimentoOperacaoInternals.carregar().
// Sem fechar a janela, cada teste deixava pra trás um timer de verdade
// rodando (nunca se limpa sozinho).
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function loadPerformance(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-tempos"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  const els = new Proxy({}, { get: (_, id) => document.getElementById(id) });
  win.getDTFirestore = () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: () => ({ doc: () => ({ collection: () => mockColecao([]) }) }) });
  win.showToast = () => {};
  win.eval(opCode + '\n' + perfCode);
  const dispararChange = (id, value) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const dispararClick = seletor => {
    const el = document.querySelector(seletor);
    if (el) el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  return { window: win, els, document, dispararChange, dispararClick };
}
function transbordo(id, horaSaida, horaInicioDescarga, horaFimDescarga, extra) {
  return { id, data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', horaSaida, horaChegada: horaSaida, horaInicioDescarga, horaFimDescarga, placa: 'ABC1D23', motoristaNome: 'Carlos', ...extra } };
}

test('PEDIDO AO VIVO: a tela de Tempos/Performance tem filtro De/até (não é mais um único mês fixo)', async () => {
  const recebimentos = mockColecao([
    transbordo('r1', '2026-06-10T08:00:00.000Z', '2026-06-10T09:00:00.000Z', '2026-06-10T09:30:00.000Z'),
    transbordo('r2', '2026-08-10T08:00:00.000Z', '2026-08-10T09:00:00.000Z', '2026-08-10T10:00:00.000Z'),
    transbordo('r3', '2026-08-20T08:00:00.000Z', '2026-08-20T09:00:00.000Z', '2026-08-20T09:45:00.000Z'),
  ]);
  const { window, els } = loadPerformance({ recebimentos });
  await window.renderRecebimentoTempos();
  assert.ok(els['rebperf-f-data-inicio'], 'precisa ter o campo de data de início');
  assert.ok(els['rebperf-f-data-fim'], 'precisa ter o campo de data de fim');
  assert.doesNotMatch(els['page-recebimento-tempos'].innerHTML, /type="month"/, 'o seletor de mês único não deve mais existir');
});

test('PEDIDO AO VIVO: intervalo livre De/até filtra os indicadores (não precisa ser um mês inteiro)', async () => {
  const recebimentos = mockColecao([
    transbordo('r-jun', '2026-06-10T08:00:00.000Z', '2026-06-10T09:00:00.000Z', '2026-06-10T09:30:00.000Z'),
    transbordo('r-ago-10', '2026-08-10T08:00:00.000Z', '2026-08-10T09:00:00.000Z', '2026-08-10T10:00:00.000Z'),
    transbordo('r-ago-20', '2026-08-20T08:00:00.000Z', '2026-08-20T09:00:00.000Z', '2026-08-20T09:45:00.000Z'),
  ]);
  const { window, els, dispararChange } = loadPerformance({ recebimentos });
  await window.renderRecebimentoTempos();

  // só o dia 10 de agosto
  dispararChange('rebperf-f-data-inicio', '2026-08-10');
  dispararChange('rebperf-f-data-fim', '2026-08-10');
  let html = els['page-recebimento-tempos'].innerHTML;
  assert.match(html, />1<\/div><div class="rebperf-label">Total de viagens no período/);

  // intervalo de uma semana cobrindo os dois de agosto, mas não junho
  dispararChange('rebperf-f-data-inicio', '2026-08-05');
  dispararChange('rebperf-f-data-fim', '2026-08-25');
  html = els['page-recebimento-tempos'].innerHTML;
  assert.match(html, />2<\/div><div class="rebperf-label">Total de viagens no período/);
});

test('PEDIDO AO VIVO: atalho "7 dias" e "Limpar" no filtro de período de Tempos/Performance', async () => {
  const hoje = new Date().toLocaleDateString('en-CA');
  const recebimentos = mockColecao([
    transbordo('r-hoje', hoje + 'T08:00:00.000Z', hoje + 'T09:00:00.000Z', hoje + 'T09:30:00.000Z'),
    transbordo('r-2020', '2020-01-01T08:00:00.000Z', '2020-01-01T09:00:00.000Z', '2020-01-01T09:30:00.000Z'),
  ]);
  const { window, els, dispararClick } = loadPerformance({ recebimentos });
  await window.renderRecebimentoTempos();

  dispararClick('[data-rebperf-f-semana]');
  let html = els['page-recebimento-tempos'].innerHTML;
  assert.match(html, />1<\/div><div class="rebperf-label">Total de viagens no período/);

  dispararClick('[data-rebperf-f-limpar]');
  html = els['page-recebimento-tempos'].innerHTML;
  assert.match(html, />2<\/div><div class="rebperf-label">Total de viagens no período/, 'limpar mostra todo o histórico de novo, sem limite de data');
});

test('periodoLabel: mensagens de intervalo, aberto de um lado só, e "todo o período" quando vazio', () => {
  const { window } = loadPerformance({});
  const i = window._recebimentoPerformanceInternals;
  assert.equal(i.periodoLabel('', ''), 'todo o período');
  assert.equal(i.periodoLabel('2026-08-01', '2026-08-20'), '01/08/2026 até 20/08/2026');
  assert.equal(i.periodoLabel('2026-08-10', '2026-08-10'), '10/08/2026');
  assert.equal(i.periodoLabel('2026-08-01', ''), 'a partir de 01/08/2026');
  assert.equal(i.periodoLabel('', '2026-08-20'), 'até 20/08/2026');
});

test('calcularPerformance: período livre filtra as viagens que entram no cálculo — não precisa mais ser um mês inteiro', () => {
  const { window } = loadPerformance({});
  const { calcularPerformance } = window._recebimentoPerformanceInternals;
  const recebimentos = [
    { tipo: 'TRANSBORDO', status: 'FINALIZADO', horaSaida: '2026-08-01T08:00:00.000Z', horaInicioDescarga: '2026-08-01T09:00:00.000Z', horaFimDescarga: '2026-08-01T09:30:00.000Z', placa: 'AAA1B11' },
    { tipo: 'TRANSBORDO', status: 'FINALIZADO', horaSaida: '2026-08-15T08:00:00.000Z', horaInicioDescarga: '2026-08-15T09:00:00.000Z', horaFimDescarga: '2026-08-15T10:00:00.000Z', placa: 'AAA1B11' },
    { tipo: 'TRANSBORDO', status: 'FINALIZADO', horaSaida: '2026-08-30T08:00:00.000Z', horaInicioDescarga: '2026-08-30T09:00:00.000Z', horaFimDescarga: '2026-08-30T09:15:00.000Z', placa: 'AAA1B11' },
  ];
  // sem período (todo o histórico) — as 3 entram
  let k = calcularPerformance(recebimentos, [], { inicio: '', fim: '' }, {});
  assert.equal(k.totalViagens, 3);
  // só uma semana no meio do mês — só a viagem do dia 15 entra
  k = calcularPerformance(recebimentos, [], { inicio: '2026-08-12', fim: '2026-08-18' }, {});
  assert.equal(k.totalViagens, 1);
  assert.equal(k.tempoMedioDescarga, 60);
});

test('calcularPerformance: a comparação de tendência (1ª x 2ª metade) usa o PONTO MÉDIO do período com dado, não mais fixo no dia 16 do mês', () => {
  const { window } = loadPerformance({});
  const { calcularPerformance } = window._recebimentoPerformanceInternals;
  // período de uma semana só (1 a 7) — a regra antiga (dia < 16 = 1ª
  // metade) jogaria TUDO na 1ª metade, o que não faz sentido pra uma
  // semana inteira. O corte precisa ser no meio do intervalo com dado (dia 4).
  const recebimentos = [
    { tipo: 'TRANSBORDO', status: 'FINALIZADO', horaSaida: '2026-08-01T08:00:00.000Z', horaInicioDescarga: '2026-08-01T09:00:00.000Z', horaFimDescarga: '2026-08-01T09:30:00.000Z', placa: 'AAA1B11' },
    { tipo: 'TRANSBORDO', status: 'FINALIZADO', horaSaida: '2026-08-07T08:00:00.000Z', horaInicioDescarga: '2026-08-07T09:00:00.000Z', horaFimDescarga: '2026-08-07T10:30:00.000Z', placa: 'AAA1B11' },
  ];
  const k = calcularPerformance(recebimentos, [], { inicio: '2026-08-01', fim: '2026-08-07' }, {});
  assert.equal(k.mediaPrimeiraMetade, 30);
  assert.equal(k.mediaSegundaMetade, 90);
  assert.equal(k.variacaoMetades, 60);
});

test('renderRecebimentoTempos(): sem filtro escolhido ainda, o padrão é o mês mais recente COM dado (não o calendário atual, que pode estar vazio)', async () => {
  const recebimentos = mockColecao([
    transbordo('r1', '2026-06-05T08:00:00.000Z', '2026-06-05T09:00:00.000Z', '2026-06-05T09:30:00.000Z'),
  ]);
  const { window, els } = loadPerformance({ recebimentos });
  await window.renderRecebimentoTempos();
  assert.equal(els['rebperf-f-data-inicio'].value, '2026-06-01');
  assert.equal(els['rebperf-f-data-fim'].value, '2026-06-30');
  assert.match(els['page-recebimento-tempos'].innerHTML, />1<\/div><div class="rebperf-label">Total de viagens no período/);
});
