// Analista > Recebimento > Paletes > Monitoramento.
// PEDIDO AO VIVO: "o analista tem que ter uma comparação do que saiu, o que
// voltou, o que tá em trânsito, se voltou ou não voltou, qual motorista tem
// que devolver os paletes pra qual mercado". Lê a coleção própria
// `recebimento_paletes` (por loja) escrita pelo Coletor
// (25-recebimento-paletes.js).
//
// BUG AO VIVO REAL (2026-09-04): "dei saída em um palete, na parte do
// analista não pareceu" — investigado ao vivo: a viagem tinha sido
// registrada na MESMA loja que estava ativa no Analista, mas mesmo assim
// não aparecia. Causa: a tela só lia a subcoleção da "loja ativa" do
// navegador (fs(), proxy loja-scoped) — pedido explícito do usuário: "lá
// não vai funcionar por loja, vai mostrar tudo em uma loja só" — ou seja, a
// tela nunca deveria depender de qual loja está selecionada. Agora lê a
// subcoleção `recebimento_paletes` de TODAS as lojas ativas (raw() +
// loop, mesmo padrão de carregar() em 78-pcp-central.js) e consolida tudo
// numa tabela só, com filtro de loja opcional.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../js/analista/recebimento-paletes-monitoramento.js'), 'utf8');

function mockColecaoSimples(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: id => ({
      get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; },
      delete: async () => { registro.delete(id); },
    }),
    where: (campo, op, valor) => ({
      get: async () => {
        const filtrados = [...registro.entries()].filter(([, data]) => op === 'in' ? (valor || []).includes(data[campo]) : data[campo] === valor);
        return { docs: filtrados.map(([id, data]) => ({ id, data: () => data })) };
      },
    }),
    _registro: registro,
  };
}

// lojas: [{id, nome, ativa}]; paletesPorLoja: { [lojaId]: [{id,data}] };
// estoquePorLoja: { [lojaId]: [{id,data}] } — id = data AAAA-MM-DD
// ledgerPorLoja: { [lojaId]: {disponivel,emTransito,total} } — doc único 'atual'
// movimentosPorLoja: { [lojaId]: [{id,data}] } — log de recebimento_paletes_movimentos (tipo/emTransitoDelta)
function mockRawFirestore(lojas, paletesPorLoja, estoquePorLoja, ledgerPorLoja, movimentosPorLoja) {
  const colLojas = mockColecaoSimples(lojas.map(l => ({ id: l.id, data: l })));
  const subPaletes = {}, subEstoque = {}, subMovimentos = {};
  Object.keys(paletesPorLoja || {}).forEach(lojaId => { subPaletes[lojaId] = mockColecaoSimples(paletesPorLoja[lojaId]); });
  Object.keys(estoquePorLoja || {}).forEach(lojaId => { subEstoque[lojaId] = mockColecaoSimples(estoquePorLoja[lojaId]); });
  Object.keys(movimentosPorLoja || {}).forEach(lojaId => { subMovimentos[lojaId] = mockColecaoSimples(movimentosPorLoja[lojaId]); });
  return {
    collection: nome => {
      if (nome === 'lojas') {
        return {
          get: colLojas.get,
          doc: lojaId => ({
            collection: sub => {
              if (sub === 'recebimento_paletes_estoque') return subEstoque[lojaId] || mockColecaoSimples([]);
              if (sub === 'recebimento_paletes_ledger') {
                const dados = (ledgerPorLoja || {})[lojaId];
                return { doc: () => ({ get: async () => ({ exists: dados !== undefined, data: () => dados }) }) };
              }
              if (sub === 'recebimento_paletes_movimentos') return subMovimentos[lojaId] || mockColecaoSimples([]);
              if (!subPaletes[lojaId]) subPaletes[lojaId] = mockColecaoSimples([]);
              return subPaletes[lojaId];
            },
          }),
        };
      }
      return mockColecaoSimples([]);
    },
    _subPaletes: subPaletes,
  };
}

function carregarPagina(lojas, paletesPorLoja, estoquePorLoja, ledgerPorLoja, opts, movimentosPorLoja) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-paletes"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const raw = mockRawFirestore(lojas || [], paletesPorLoja || {}, estoquePorLoja || {}, ledgerPorLoja || {}, movimentosPorLoja || {});
  win.getDTRawFirestore = () => raw;
  win.showToast = () => {};
  const chamadasLedger = [];
  win._aplicarMovimentoLedger = async function (lojaId, tipo, deltas, referencia) {
    chamadasLedger.push({ lojaId, tipo, deltas, referencia });
  };
  win.confirm = () => (opts ? opts.confirmar !== false : true);
  win.eval(code);
  return { win, document: win.document, raw, chamadasLedger };
}

const LOJAS = [{ id: 'matriz', nome: 'Matriz', ativa: true }, { id: 'filial', nome: 'Filial', ativa: true }];
const PALETES_POR_LOJA = {
  matriz: [
    { id: 'p1', data: { motoristaNome: 'Carlos', mercado: 'Assai - 278', numeroViagem: '100', paletesSaida: 20, paletesRetorno: null, status: 'EM_TRANSITO', horaSaida: '2026-09-01T08:00:00.000Z', origem: 'Matriz' } },
    { id: 'p2', data: { motoristaNome: 'João', mercado: 'Extra - 12', numeroViagem: '101', paletesSaida: 10, paletesRetorno: 10, status: 'FINALIZADO', horaSaida: '2026-08-30T08:00:00.000Z', horaRetorno: '2026-08-30T14:00:00.000Z', origem: 'Matriz' } },
  ],
  filial: [
    { id: 'p3', data: { motoristaNome: 'Carlos', mercado: 'Carrefour - 55', numeroViagem: '102', paletesSaida: 15, paletesRetorno: 8, status: 'FINALIZADO', horaSaida: '2026-08-28T08:00:00.000Z', horaRetorno: '2026-08-29T09:00:00.000Z', origem: 'Filial' } },
  ],
};
const ITENS_BASE = [...PALETES_POR_LOJA.matriz, ...PALETES_POR_LOJA.filial];

test('kpis: conta em trânsito, com saldo pendente, e soma paletes retornados/em aberto', () => {
  const { win } = carregarPagina([], {});
  const itens = ITENS_BASE.map(x => x.data);
  const k = win._recebimentoPaletesMonitoramentoInternals.kpis(itens);
  assert.equal(k.total, 3);
  assert.equal(k.emTransito, 1); // p1
  // p1 (20 saiu, nada voltou) e p3 (15 saiu, só 8 voltaram) têm saldo > 0
  assert.equal(k.comSaldoPendente, 2);
  assert.equal(k.paletesRetornados, 18); // 10 (p2) + 8 (p3)
  assert.equal(k.paletesEmAberto, 20 + 7); // p1: 20-0=20 · p3: 15-8=7
});

test('saldoDe: retorno null conta como zero devolvido (saldo = saída inteira)', () => {
  const { win } = carregarPagina([], {});
  assert.equal(win._recebimentoPaletesMonitoramentoInternals.saldoDe({ paletesSaida: 20, paletesRetorno: null }), 20);
  assert.equal(win._recebimentoPaletesMonitoramentoInternals.saldoDe({ paletesSaida: 20, paletesRetorno: 20 }), 0);
  assert.equal(win._recebimentoPaletesMonitoramentoInternals.saldoDe({ paletesSaida: 15, paletesRetorno: 8 }), 7);
});

// BUG AO VIVO REAL (2026-09-04): a viagem registrada na loja "filial" tem
// que aparecer mesmo que o Analista nunca tenha "loja ativa" nenhuma
// selecionada (carregarPaletesMonitoramento não depende mais disso) — as
// duas lojas entram juntas na mesma leitura.
test('carregarPaletesMonitoramento: consolida TODAS as lojas ativas numa lista só, sem depender de nenhuma "loja ativa" selecionada', async () => {
  const { win } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();
  const itens = win._recebimentoPaletesMonitoramentoInternals.getItens();
  assert.equal(itens.length, 3, 'as 2 viagens da matriz + 1 da filial aparecem juntas');
  assert.ok(itens.some(x => x.numeroViagem === '102' && x.lojaId === 'filial'), 'viagem da filial marcada com o lojaId certo');
  assert.ok(itens.some(x => x.numeroViagem === '100' && x.lojaId === 'matriz'));
});
test('carregarPaletesMonitoramento: loja inativa (ativa:false) não entra na consolidação', async () => {
  const lojas = [...LOJAS, { id: 'desativada', nome: 'Loja Desativada', ativa: false }];
  const paletes = { ...PALETES_POR_LOJA, desativada: [{ id: 'p9', data: { motoristaNome: 'X', numeroViagem: '999', paletesSaida: 5, status: 'EM_TRANSITO', horaSaida: '2026-09-01T00:00:00.000Z' } }] };
  const { win } = carregarPagina(lojas, paletes);
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();
  const itens = win._recebimentoPaletesMonitoramentoInternals.getItens();
  assert.equal(itens.some(x => x.numeroViagem === '999'), false);
});
test('carregarPaletesMonitoramento: loja sem permissão de leitura (erro no get) não derruba as outras — só fica de fora, silenciosamente', async () => {
  const lojas = [...LOJAS, { id: 'sem-acesso', nome: 'Sem Acesso', ativa: true }];
  const { win } = carregarPagina(lojas, PALETES_POR_LOJA); // "sem-acesso" não tem entrada em PALETES_POR_LOJA — mock devolve coleção vazia, equivalente a um catch(()=>vazio) bem-sucedido
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();
  const itens = win._recebimentoPaletesMonitoramentoInternals.getItens();
  assert.equal(itens.length, 3, 'as lojas com dado continuam aparecendo normalmente');
});

test('tela: mostra KPIs e a tabela com motorista/mercado/viagem/saída/retorno/saldo/status/loja, consolidando as 2 lojas', async () => {
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win.renderRecebimentoPaletes();
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /Controle de Paletes/);
  assert.match(html, /todas as lojas consolidadas/i);
  assert.match(html, /Carlos/);
  assert.match(html, /Assai - 278/);
  assert.match(html, /Viagem/);
  assert.match(html, />100</); // número da viagem em trânsito (matriz)
  assert.match(html, />102</); // viagem da filial também aparece
  assert.match(html, /Em trânsito/);
  assert.match(html, /Finalizado/);
  assert.match(html, /Retornado \(parcial\)/); // p3, saldo pendente mas já FINALIZADO
});

test('filtro de loja: escolher uma loja específica esconde as viagens das outras', async () => {
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win.renderRecebimentoPaletes();
  const sel = document.getElementById('paletes-f-loja');
  assert.ok(sel, 'filtro de loja precisa existir na tela');
  sel.value = 'filial';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, />102</); // filial
  assert.doesNotMatch(html, />100</); // matriz, fora do filtro
  assert.doesNotMatch(html, />101</);
});

test('filtro por motorista: só mostra as viagens daquele motorista', async () => {
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win.renderRecebimentoPaletes();
  const campo = document.getElementById('paletes-f-motorista');
  campo.value = 'joão';
  campo.dispatchEvent(new win.Event('input', { bubbles: true }));
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /João/);
  assert.doesNotMatch(html, />100</); // viagem do Carlos (p1) some do filtro
});

test('filtro por status "com saldo pendente": mostra p1 (em trânsito) e p3 (retorno parcial), não p2 (fechado sem saldo)', async () => {
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win.renderRecebimentoPaletes();
  const sel = document.getElementById('paletes-f-status');
  sel.value = 'PENDENTE';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, />100</);
  assert.match(html, />102</);
  assert.doesNotMatch(html, />101</);
});

test('filtro de período usa a data de SAÍDA real, exclui viagens fora do intervalo', async () => {
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win.renderRecebimentoPaletes();
  document.getElementById('paletes-f-inicio').value = '2026-08-31';
  document.getElementById('paletes-f-inicio').dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, />100</); // 01/09, dentro do período
  assert.doesNotMatch(html, />101</); // 30/08, fora
  assert.doesNotMatch(html, />102</); // 28/08, fora
});

test('tela: sem nenhuma viagem, mostra estado vazio explicando como criar uma pelo Coletor', async () => {
  const { win, document } = carregarPagina(LOJAS, { matriz: [], filial: [] });
  await win.renderRecebimentoPaletes();
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /Nenhuma viagem de paletes encontrada/);
});

// PEDIDO AO VIVO (2026-09-04): "controle de paletes... vai ter duas
// opções, paletes em estoque e saída de paletes... paletes em estoque é
// onde a pessoa vai colocar todo dia a quantidade de paletes que tem, e na
// parte do analista vai especifica de qual loja é esse saldo dos paletes".
test('carregarPaletesMonitoramento: pega o registro de estoque MAIS RECENTE de cada loja (não o histórico inteiro)', async () => {
  const estoque = {
    matriz: [
      { id: '2026-09-01', data: { data: '2026-09-01', quantidade: 100 } },
      { id: '2026-09-03', data: { data: '2026-09-03', quantidade: 120 } }, // mais recente
      { id: '2026-09-02', data: { data: '2026-09-02', quantidade: 110 } },
    ],
    filial: [
      { id: '2026-09-01', data: { data: '2026-09-01', quantidade: 40 } },
    ],
  };
  const { win } = carregarPagina(LOJAS, {}, estoque);
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();
  const porLoja = win._recebimentoPaletesMonitoramentoInternals.getEstoquePorLoja();
  const matriz = porLoja.find(x => x.lojaId === 'matriz');
  const filial = porLoja.find(x => x.lojaId === 'filial');
  assert.equal(matriz.quantidade, 120, 'pega o dia 03, não o 01 (inserido primeiro) nem o 02');
  assert.equal(matriz.data, '2026-09-03');
  assert.equal(filial.quantidade, 40);
});
test('carregarPaletesMonitoramento: loja sem NENHUM registro de estoque ainda aparece na lista, com quantidade null (não some, não quebra)', async () => {
  const { win } = carregarPagina(LOJAS, {}, { matriz: [{ id: '2026-09-01', data: { data: '2026-09-01', quantidade: 100 } }] });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();
  const porLoja = win._recebimentoPaletesMonitoramentoInternals.getEstoquePorLoja();
  const filial = porLoja.find(x => x.lojaId === 'filial');
  assert.ok(filial, 'a loja aparece mesmo sem nenhum registro de estoque');
  assert.equal(filial.quantidade, null);
});
// PEDIDO AO VIVO (2026-09-04): "na tela do analista colocar uma opção do
// lado tipo uma em trânsito e outra 'estoque'" — virou 2 abas de verdade;
// por padrão abre em "Em Trânsito", a seção de estoque só aparece na aba
// "Estoque".
test('tela: por padrão abre na aba "Em Trânsito" — a seção de estoque NÃO aparece até trocar de aba', async () => {
  const estoque = { matriz: [{ id: '2026-09-04', data: { data: '2026-09-04', quantidade: 87 } }], filial: [] };
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA, estoque);
  await win.renderRecebimentoPaletes();
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.doesNotMatch(html, /Paletes em Estoque/);
  assert.match(html, /Viagens \(no filtro\)/); // KPI só da aba de trânsito
});
test('tela: clicar na aba "Estoque" mostra o resumo por loja e some com KPIs/tabela de viagens', async () => {
  const estoque = { matriz: [{ id: '2026-09-04', data: { data: '2026-09-04', quantidade: 87 } }], filial: [] };
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA, estoque);
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /Paletes em Estoque/);
  assert.match(html, /Matriz/);
  assert.match(html, /Filial/);
  assert.match(html, />87</);
  assert.match(html, /Nunca registrado/); // filial não tem nenhum registro
  assert.doesNotMatch(html, /Viagens \(no filtro\)/);
});
test('tela: clicar de volta na aba "Em Trânsito" restaura a tabela de viagens', async () => {
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA, {});
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  document.querySelector('[data-paletes-aba="transito"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /Viagens \(no filtro\)/);
  assert.match(html, />100</);
});

// PEDIDO AO VIVO (2026-09-04): "e tem que ter um histórico de paletes por
// dia" — a aba Estoque mostra o resumo (último por loja) E a série
// completa dia a dia, mais recente primeiro.
test('aba Estoque: mostra o histórico diário completo, não só o último registro de cada loja', async () => {
  const estoque = {
    matriz: [
      { id: '2026-09-01', data: { data: '2026-09-01', quantidade: 100, registradoPor: 'joao@x.com' } },
      { id: '2026-09-03', data: { data: '2026-09-03', quantidade: 120, registradoPor: 'joao@x.com' } },
      { id: '2026-09-02', data: { data: '2026-09-02', quantidade: 110, registradoPor: 'joao@x.com' } },
    ],
  };
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA, estoque);
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /Histórico diário/);
  // as 3 datas aparecem (formatadas dd/mm/aaaa), não só a mais recente
  assert.match(html, /01\/09\/2026/);
  assert.match(html, /02\/09\/2026/);
  assert.match(html, /03\/09\/2026/);
  assert.match(html, />100</);
  assert.match(html, />110</);
  assert.match(html, />120</);
});
test('carregarPaletesMonitoramento: getEstoqueHistorico() traz TODOS os registros diários de todas as lojas, mais recente primeiro', async () => {
  const estoque = {
    matriz: [
      { id: '2026-09-01', data: { data: '2026-09-01', quantidade: 100 } },
      { id: '2026-09-03', data: { data: '2026-09-03', quantidade: 120 } },
    ],
    filial: [
      { id: '2026-09-02', data: { data: '2026-09-02', quantidade: 40 } },
    ],
  };
  const { win } = carregarPagina(LOJAS, {}, estoque);
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();
  const historico = win._recebimentoPaletesMonitoramentoInternals.getEstoqueHistorico();
  assert.equal(historico.length, 3);
  // .join() em vez de deepEqual no array: historico vem de dentro do
  // win.eval() (realm da JSDOM) — deepStrictEqual rejeita arrays de realms
  // diferentes mesmo com o mesmo conteúdo (Array.prototype.map herda o
  // realm de origem). Comparar a string já junta evita esse falso negativo.
  assert.equal(historico.map(h => h.data).join(','), '2026-09-03,2026-09-02,2026-09-01', 'ordenado por data decrescente, cruzando lojas');
});

// Extensão do ledger de paletes (Montagem/Expedição de Carga + Transferência
// + Saída Externa, ver 28-recebimento-paletes-ledger.js) — fonte de verdade
// calculada, exibida como colunas extras dentro da aba "Estoque" JÁ
// EXISTENTE (não cria uma 4ª aba). Só leitura, nunca ajusta a contagem manual.
test('carregarPaletesMonitoramento: lê o ledger (recebimento_paletes_ledger/atual) de cada loja e disponibiliza via getLedgerPorLoja()', async () => {
  const ledger = {
    matriz: { disponivel: 42, emTransito: 8, total: 50 },
    filial: { disponivel: 10, emTransito: 0, total: 10 },
  };
  const { win } = carregarPagina(LOJAS, {}, {}, ledger);
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();
  const porLoja = win._recebimentoPaletesMonitoramentoInternals.getLedgerPorLoja();
  assert.equal(porLoja.length, 2);
  const matriz = porLoja.find(l => l.lojaId === 'matriz');
  assert.equal(matriz.disponivel, 42);
  assert.equal(matriz.emTransito, 8);
  assert.equal(matriz.total, 50);
});

test('carregarPaletesMonitoramento: loja sem ledger ainda (nenhuma movimentação) aparece zerada, não null/undefined', async () => {
  const { win } = carregarPagina(LOJAS, {}, {}, {});
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();
  const porLoja = win._recebimentoPaletesMonitoramentoInternals.getLedgerPorLoja();
  assert.equal(porLoja.length, 2);
  porLoja.forEach(l => {
    assert.equal(l.disponivel, 0);
    assert.equal(l.emTransito, 0);
    assert.equal(l.total, 0);
  });
});

test('aba Estoque: mostra as colunas Disponível (sistema)/Em Trânsito/Diferença, calculando diferença = ledger − contagem manual', async () => {
  const estoque = { matriz: [{ id: '2026-09-04', data: { data: '2026-09-04', quantidade: 45 } }] };
  const ledger = { matriz: { disponivel: 42, emTransito: 8, total: 50 } };
  const { win, document } = carregarPagina(LOJAS, {}, estoque, ledger);
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));

  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /Disponível \(sistema\)/);
  assert.match(html, /Em Trânsito/);
  assert.match(html, /Diferença/);
  // contagem manual = 45, sistema = 42 -> diferença = 42 - 45 = -3
  assert.match(html, /-3/);
});

test('aba Estoque: loja sem contagem manual ainda mostra "—" na diferença, em vez de calcular contra null', async () => {
  const ledger = { matriz: { disponivel: 42, emTransito: 8, total: 50 } };
  const { win, document } = carregarPagina(LOJAS, {}, {}, ledger);
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));

  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /42/); // disponível aparece mesmo sem contagem manual
});

// PEDIDO AO VIVO (2026-09-08): "colocar mais uma coluna em trânsito, que
// vai chamar Em Trânsito/Transbordo, que vai ser as cargas de transbordo,
// a outra coluna em trânsito que já tá aí vai ser para as cargas dos
// motoristas que vão fazer entrega" — o ledger.emTransito mistura tudo
// (transbordo + entrega externa + transferência + ajuste); a tela agora
// separa lendo o LOG de movimentos (recebimento_paletes_movimentos) e
// somando só os de transbordo — "Em Trânsito" vira o restante.
test('aba Estoque: "Em Trânsito/Transbordo" soma só os movimentos TRANSBORDO_*, e "Em Trânsito" mostra o restante do total do ledger', async () => {
  const ledger = { matriz: { disponivel: 100, emTransito: 30, total: 130 } };
  const movimentos = { matriz: [
    { id: 'm1', data: { tipo: 'TRANSBORDO_EXPEDICAO', emTransitoDelta: 12 } },
    { id: 'm2', data: { tipo: 'TRANSBORDO_RECEBIMENTO', emTransitoDelta: -2 } }, // 12 - 2 = 10 de transbordo
    { id: 'm3', data: { tipo: 'SAIDA_EXTERNA', emTransitoDelta: 20 } }, // não é transbordo
  ] };
  const { win, document } = carregarPagina(LOJAS, {}, {}, ledger, null, movimentos);
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));

  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /Em Trânsito\/Transbordo/);
  const linhas = win._recebimentoPaletesMonitoramentoInternals.getLedgerPorLoja();
  const matriz = linhas.find(l => l.lojaId === 'matriz');
  assert.equal(matriz.emTransitoTransbordo, 10, 'soma só TRANSBORDO_EXPEDICAO/RECEBIMENTO, não SAIDA_EXTERNA');
  assert.equal(matriz.emTransito, 30, 'o total do ledger continua intocado, é só a exibição que separa');
});

test('aba Estoque: "Em Trânsito" nunca fica negativo mesmo se "Zerar Em Trânsito" zerar o total do ledger com transbordo ainda no log de movimentos', async () => {
  const ledger = { matriz: { disponivel: 100, emTransito: 0, total: 100 } };
  const movimentos = { matriz: [{ id: 'm1', data: { tipo: 'TRANSBORDO_EXPEDICAO', emTransitoDelta: 5 } }] };
  const { win, document } = carregarPagina(LOJAS, {}, {}, ledger, null, movimentos);
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  const html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.doesNotMatch(html, /-5/, 'nunca mostra "Em Trânsito" negativo');
});

// PEDIDO AO VIVO (2026-09-06): "no palete monitoramento, quero que tenha a
// opção de excluir" — viagem errada/duplicada na aba "Em Trânsito". Essa
// tabela ALIMENTA o ledger (Disponível/Em Trânsito) — excluir sem desfazer
// o efeito no saldo deixaria ele errado pra sempre, então a exclusão
// também aplica o movimento inverso (saldoDe da viagem volta pro
// Disponível, sai do Em Trânsito).
test('excluirViagemPaletes: confirma, apaga o documento e desfaz o efeito no ledger (viagem ainda em trânsito, sem retorno)', async () => {
  const { win, raw, chamadasLedger } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.excluirViagemPaletes('p1', 'matriz'); // p1: paletesSaida 20, sem retorno

  assert.equal(raw._subPaletes.matriz._registro.has('p1'), false, 'documento tem que ter sido apagado');
  assert.equal(chamadasLedger.length, 1);
  assert.equal(chamadasLedger[0].lojaId, 'matriz');
  assert.equal(chamadasLedger[0].tipo, 'SAIDA_EXTERNA_EXCLUIDA');
  assert.equal(chamadasLedger[0].deltas.disponivelDelta, 20, 'os 20 paletes que estavam em trânsito voltam pro disponível');
  assert.equal(chamadasLedger[0].deltas.emTransitoDelta, -20);
  assert.equal(chamadasLedger[0].referencia.id, 'p1');
  assert.equal(win._recebimentoPaletesMonitoramentoInternals.getItens().some(p => p._id === 'p1'), false, 'sai da lista em memória também, sem precisar recarregar pra sumir da tela');
});

test('excluirViagemPaletes: viagem com retorno PARCIAL desfaz só o saldo que ainda estava pendente, não o total que saiu', async () => {
  const { win, raw, chamadasLedger } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.excluirViagemPaletes('p3', 'filial'); // p3: saiu 15, voltou 8 -> saldo 7

  assert.equal(chamadasLedger[0].deltas.disponivelDelta, 7);
  assert.equal(chamadasLedger[0].deltas.emTransitoDelta, -7);
});

test('excluirViagemPaletes: viagem já totalmente FINALIZADA (saldo zero) apaga o documento mas não mexe no ledger', async () => {
  const { win, chamadasLedger } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.excluirViagemPaletes('p2', 'matriz'); // p2: saiu 10, voltou 10 -> saldo 0

  assert.equal(chamadasLedger.length, 0, 'saldo zero não precisa de nenhum ajuste no ledger');
});

test('excluirViagemPaletes: se o usuário não confirmar, não apaga nada nem mexe no ledger', async () => {
  const { win, raw, chamadasLedger } = carregarPagina(LOJAS, PALETES_POR_LOJA, {}, {}, { confirmar: false });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.excluirViagemPaletes('p1', 'matriz');

  assert.equal(raw._subPaletes.matriz._registro.has('p1'), true);
  assert.equal(chamadasLedger.length, 0);
});

test('tela: cada linha da tabela "Em Trânsito" tem um botão de excluir', async () => {
  const { win, document } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win.renderRecebimentoPaletes();
  const btn = document.querySelector('[data-paletes-excluir="p1"]');
  assert.ok(btn, 'botão de excluir tem que existir na linha da viagem p1');
  assert.equal(btn.getAttribute('data-paletes-excluir-loja'), 'matriz');
});

test('clique no botão de excluir da linha aciona excluirViagemPaletes com o id e a loja certos', async () => {
  const { win, document, raw, chamadasLedger } = carregarPagina(LOJAS, PALETES_POR_LOJA);
  await win.renderRecebimentoPaletes();

  document.querySelector('[data-paletes-excluir="p1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  assert.equal(raw._subPaletes.matriz._registro.has('p1'), false);
  assert.equal(chamadasLedger.length, 1);
  assert.equal(chamadasLedger[0].lojaId, 'matriz');
});

// PEDIDO AO VIVO (2026-09-06): "como é que eu faço um primeiro inventário
// de palete... vou colocar a quantidade total, como é que eu faço?" — não
// existia NENHUM jeito de fazer o Disponível (sistema) virar um número
// digitado. Este botão pega a Contagem manual já registrada e ajusta o
// ledger pra bater com ela.
test('ajustarSaldoComoContagem: ajusta o Disponível pro valor da contagem manual (loja que nunca teve movimentação — ledger "zerado")', async () => {
  const estoque = { matriz: [{ id: '2026-09-04', data: { data: '2026-09-04', quantidade: 1200 } }] };
  const { win, chamadasLedger } = carregarPagina(LOJAS, {}, estoque, {}, { confirmar: true });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.ajustarSaldoComoContagem('matriz');

  assert.equal(chamadasLedger.length, 1);
  assert.equal(chamadasLedger[0].lojaId, 'matriz');
  assert.equal(chamadasLedger[0].tipo, 'AJUSTE_MANUAL');
  assert.equal(chamadasLedger[0].deltas.disponivelDelta, 1200, 'ledger começa zerado, então o delta é a própria contagem');
  assert.equal(chamadasLedger[0].deltas.emTransitoDelta, undefined, 'uma contagem física não mexe no Em Trânsito');
  const ledgerAtualizado = win._recebimentoPaletesMonitoramentoInternals.getLedgerPorLoja().find(l => l.lojaId === 'matriz');
  assert.equal(ledgerAtualizado.disponivel, 1200);
});

test('ajustarSaldoComoContagem: loja com ledger existente ajusta só a DIFERENÇA, não soma em cima', async () => {
  const estoque = { matriz: [{ id: '2026-09-04', data: { data: '2026-09-04', quantidade: 100 } }] };
  const ledger = { matriz: { disponivel: 42, emTransito: 8, total: 50 } };
  const { win, chamadasLedger } = carregarPagina(LOJAS, {}, estoque, ledger, { confirmar: true });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.ajustarSaldoComoContagem('matriz');

  assert.equal(chamadasLedger[0].deltas.disponivelDelta, 58, '100 (alvo) - 42 (atual) = 58');
});

test('ajustarSaldoComoContagem: já bate (diferença zero) não chama o ledger, nem precisa confirmar nada', async () => {
  const estoque = { matriz: [{ id: '2026-09-04', data: { data: '2026-09-04', quantidade: 42 } }] };
  const ledger = { matriz: { disponivel: 42, emTransito: 8, total: 50 } };
  const { win, chamadasLedger } = carregarPagina(LOJAS, {}, estoque, ledger, { confirmar: false });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.ajustarSaldoComoContagem('matriz');

  assert.equal(chamadasLedger.length, 0);
});

test('ajustarSaldoComoContagem: se o usuário não confirmar, não ajusta nada', async () => {
  const estoque = { matriz: [{ id: '2026-09-04', data: { data: '2026-09-04', quantidade: 1200 } }] };
  const { win, chamadasLedger } = carregarPagina(LOJAS, {}, estoque, {}, { confirmar: false });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.ajustarSaldoComoContagem('matriz');

  assert.equal(chamadasLedger.length, 0);
});

test('ajustarSaldoComoContagem: loja sem nenhuma contagem manual ainda não faz nada (não tem o que aplicar)', async () => {
  const { win, chamadasLedger } = carregarPagina(LOJAS, {}, {}, {}, { confirmar: true });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.ajustarSaldoComoContagem('matriz');

  assert.equal(chamadasLedger.length, 0);
});

test('tela: aba Estoque mostra o botão "Aplicar contagem como saldo" só pra loja com contagem manual registrada', async () => {
  const estoque = { matriz: [{ id: '2026-09-04', data: { data: '2026-09-04', quantidade: 1200 } }], filial: [] };
  const { win, document } = carregarPagina(LOJAS, {}, estoque, {});
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));

  assert.ok(document.querySelector('[data-paletes-ajustar-saldo="matriz"]'), 'matriz tem contagem manual, então tem botão');
  assert.equal(document.querySelector('[data-paletes-ajustar-saldo="filial"]'), null, 'filial nunca registrou contagem, sem botão');
});

// PEDIDO AO VIVO (2026-09-08): "excluir as cargas e as saídas de paletes
// mas ainda continuou em trânsito, ele tem que voltar para o estoque de
// origem" — exclusões novas já devolvem certo pro ledger (ver
// 104-recebimento-cargas-cards.js e 25-recebimento-paletes.js), mas sobras
// de ANTES dessa correção ficavam presas em "Em Trânsito" sem nenhum jeito
// de corrigir na tela — "Aplicar contagem como saldo" só mexe no
// Disponível. Este botão zera especificamente o Em Trânsito.
test('zerarEmTransito: zera o Em Trânsito da loja, sem mexer no Disponível', async () => {
  const ledger = { matriz: { disponivel: 1500, emTransito: -8, total: 1492 } };
  const { win, chamadasLedger } = carregarPagina(LOJAS, {}, {}, ledger, { confirmar: true });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.zerarEmTransito('matriz');

  assert.equal(chamadasLedger.length, 1);
  assert.equal(chamadasLedger[0].lojaId, 'matriz');
  assert.equal(chamadasLedger[0].deltas.emTransitoDelta, 8, 'delta contrário ao valor atual (-8) zera: -8 + 8 = 0');
  assert.equal(chamadasLedger[0].deltas.disponivelDelta, undefined, 'não mexe no Disponível');
  const ledgerAtualizado = win._recebimentoPaletesMonitoramentoInternals.getLedgerPorLoja().find(l => l.lojaId === 'matriz');
  assert.equal(ledgerAtualizado.emTransito, 0);
  assert.equal(ledgerAtualizado.disponivel, 1500, 'Disponível não muda');
});

test('zerarEmTransito: já está zerado — não chama o ledger nem precisa confirmar', async () => {
  const ledger = { matriz: { disponivel: 1500, emTransito: 0, total: 1500 } };
  const { win, chamadasLedger } = carregarPagina(LOJAS, {}, {}, ledger, { confirmar: false });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.zerarEmTransito('matriz');

  assert.equal(chamadasLedger.length, 0);
});

test('zerarEmTransito: se o usuário não confirmar, não ajusta nada', async () => {
  const ledger = { matriz: { disponivel: 1500, emTransito: -8, total: 1492 } };
  const { win, chamadasLedger } = carregarPagina(LOJAS, {}, {}, ledger, { confirmar: false });
  await win._recebimentoPaletesMonitoramentoInternals.carregarPaletesMonitoramento();

  await win._recebimentoPaletesMonitoramentoInternals.zerarEmTransito('matriz');

  assert.equal(chamadasLedger.length, 0);
});

test('tela: aba Estoque mostra "Zerar Em Trânsito" só pra loja com Em Trânsito diferente de zero', async () => {
  const ledger = { matriz: { disponivel: 1500, emTransito: -8, total: 1492 }, filial: { disponivel: 200, emTransito: 0, total: 200 } };
  const { win, document } = carregarPagina(LOJAS, {}, {}, ledger);
  await win.renderRecebimentoPaletes();
  document.querySelector('[data-paletes-aba="estoque"]').dispatchEvent(new win.Event('click', { bubbles: true }));

  assert.ok(document.querySelector('[data-paletes-zerar-transito="matriz"]'), 'matriz está com Em Trânsito != 0, então tem botão');
  assert.equal(document.querySelector('[data-paletes-zerar-transito="filial"]'), null, 'filial já está em 0, sem botão');
});

// PEDIDO AO VIVO (2026-09-06): "às vezes o motorista sai com o pallet mas
// o pallet fica no mercado e o mercado não devolve... como colocar isso no
// nome do mercado e não do motorista?" — o mesmo mercado pode receber
// entregas de motoristas DIFERENTES; a dívida é do mercado, então precisa
// somar entre eles, não ficar espalhada por motorista.
const PALETES_MESMO_MERCADO_DOIS_MOTORISTAS = {
  matriz: [
    { id: 'v1', data: { motoristaNome: 'Carlos', mercado: 'Assai - 278', paletesSaida: 20, paletesRetorno: null, status: 'EM_TRANSITO', horaSaida: '2026-09-01T08:00:00.000Z' } },
    { id: 'v2', data: { motoristaNome: 'João', mercado: 'Assai - 278', paletesSaida: 15, paletesRetorno: 5, status: 'FINALIZADO', horaSaida: '2026-09-02T08:00:00.000Z' } },
    { id: 'v3', data: { motoristaNome: 'Carlos', mercado: 'Extra - 12', paletesSaida: 10, paletesRetorno: 10, status: 'FINALIZADO', horaSaida: '2026-09-01T08:00:00.000Z' } },
  ],
};

test('saldoPorMercado: soma o saldo pendente de TODOS os motoristas que entregaram no mesmo mercado numa linha só', () => {
  const { win } = carregarPagina([], {});
  const itens = PALETES_MESMO_MERCADO_DOIS_MOTORISTAS.matriz.map(x => x.data);
  const resumo = win._recebimentoPaletesMonitoramentoInternals.saldoPorMercado(itens);
  const assai = resumo.find(m => m.mercado === 'Assai - 278');
  assert.ok(assai, 'Assai aparece no resumo (tem saldo pendente)');
  assert.equal(assai.saldoPendente, 30, '20 (Carlos, nada voltou) + 10 (João, 15-5) = 30, mesmo sendo motoristas diferentes');
  assert.equal(assai.viagens, 2);
  assert.equal(resumo.some(m => m.mercado === 'Extra - 12'), false, 'Extra-12 tem saldo zero (tudo devolvido) — não entra no resumo de pendências');
});

test('saldoPorMercado: viagem sem mercado informado entra como "Sem mercado informado", não desaparece nem quebra', () => {
  const { win } = carregarPagina([], {});
  const resumo = win._recebimentoPaletesMonitoramentoInternals.saldoPorMercado([{ motoristaNome: 'X', paletesSaida: 5, paletesRetorno: null }]);
  assert.equal(resumo[0].mercado, 'Sem mercado informado');
  assert.equal(resumo[0].saldoPendente, 5);
});

test('tela: mostra a seção "Saldo pendente por mercado" agrupando por mercado, some quando não há nenhum saldo pendente', async () => {
  const { win, document } = carregarPagina(LOJAS, PALETES_MESMO_MERCADO_DOIS_MOTORISTAS);
  await win.renderRecebimentoPaletes();
  let html = document.getElementById('page-recebimento-paletes').innerHTML;
  assert.match(html, /Saldo pendente por mercado/);
  assert.match(html, /Assai - 278/);
  assert.match(html, />30</);
  assert.match(html, /2 viagem\(ns\)/);

  // Sem nenhuma viagem com saldo pendente, a seção inteira some (não faz
  // sentido mostrar uma tabela vazia de "quem deve o quê").
  const { win: win2, document: document2 } = carregarPagina(LOJAS, { matriz: [{ id: 'p2', data: PALETES_POR_LOJA.matriz[1].data }] });
  await win2.renderRecebimentoPaletes();
  html = document2.getElementById('page-recebimento-paletes').innerHTML;
  assert.doesNotMatch(html, /Saldo pendente por mercado/);
});
