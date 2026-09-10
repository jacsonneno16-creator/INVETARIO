// PEDIDO AO VIVO (2026-09-02): "aquela projeção de vendas... pode usar a
// escadinha, e aquele outro arquivo que eu falei que mostrava o real. Aí
// pode usar o real dos três últimos meses" — Projeção de Vendas
// (66-producao-projecao.js) ganha "Buscar do BI" pra preencher
// venda_m1/m2/m3 com os 3 últimos meses FECHADOS do real[] da escadinha
// (dados-escadinha.json). NUNCA pode tocar estoqueAtual (ledger real,
// só aplicarEntradaEstoqueProducao mexe nele).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/66-producao-projecao.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, set: async (payload, opts) => { const atual = registro.get(id) || {}; registro.set(id, opts?.merge ? { ...atual, ...payload } : payload); } }),
    add: async (payload) => { const id = 'novo' + (seq++); registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}

function carregarPagina(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-projecao"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const colProjecao = mockColecao(opts.projecao || []);
  const colProdutos = mockColecao(opts.produtos || []);
  win.getDTFirestore = () => ({
    collection: (nome) => ({ producao_projecao: colProjecao, producao_produtos: colProdutos, pcp_estoque_bluesoft: mockColecao([]) }[nome] || mockColecao([])),
  });
  win.showToast = () => {};
  win.DTBiPastaLocal = opts.dtBiPastaLocal;
  win.eval(code);
  return { win, document, colProjecao };
}

test('_calcularVendaMesesEscadinha: usa os 3 meses fechados mais recentes (M1 = mês passado, não o corrente)', () => {
  const { win } = carregarPagina({});
  const dadosEscadinha = { produtos: [{ cod: 304, real: [10, 20, 30, 40, 50, 60, 70, 80, 999, 0, 0, 0] }] }; // índice 8 = mês corrente, ignorado
  const mesReferencia = 7; // agosto (0-based) — simula "hoje" sendo setembro
  const mapa = win._DTProjecaoBiInternals._calcularVendaMesesEscadinha(dadosEscadinha, mesReferencia);
  const item = mapa.get('304');
  assert.equal(item.venda_m1, 80, 'mês fechado mais recente (ago, índice 7)');
  assert.equal(item.venda_m2, 70, 'jul');
  assert.equal(item.venda_m3, 60, 'jun');
});

test('_calcularVendaMesesEscadinha: vira dezembro/janeiro sem quebrar (índice negativo)', () => {
  const { win } = carregarPagina({});
  const dadosEscadinha = { produtos: [{ cod: 1, real: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500, 600] }] }; // nov=500,dez=600
  const mapa = win._DTProjecaoBiInternals._calcularVendaMesesEscadinha(dadosEscadinha, 0); // mês de referência = janeiro
  const item = mapa.get('1');
  assert.equal(item.venda_m1, 100, 'jan');
  assert.equal(item.venda_m2, 600, 'dez do ano anterior, índice 11');
  assert.equal(item.venda_m3, 500, 'nov, índice 10');
});

test('buscarProjecaoBi: grava venda_m1/m2/m3 num produto já com doc de projeção, NUNCA toca estoqueAtual', async () => {
  const { win, colProjecao } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca' } }],
    projecao: [{ id: 'proj1', data: { cod: '304', produto: 'Tapioca', estoqueAtual: 1234, venda_m1: 1, venda_m2: 1, venda_m3: 1 } }],
    dtBiPastaLocal: { suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }), lerJson: async () => ({ produtos: [{ cod: 304, real: [10, 20, 30, 40, 50, 60, 70, 80, 0, 0, 0, 0] }] }) },
  });
  await win._DTProjecaoBiInternals.buscarProjecaoBi();
  const salvo = colProjecao._registro.get('proj1');
  assert.equal(salvo.estoqueAtual, 1234, 'estoqueAtual nunca é tocado pela importação da escadinha');
  assert.ok(salvo.venda_m1 > 1, 'venda_m1 foi atualizado a partir da escadinha');
});

test('buscarProjecaoBi: produto cadastrado mas sem doc de projeção ainda cria um novo (não deixa sem projeção)', async () => {
  const { win, colProjecao } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '500', nome: 'Novo Produto' } }],
    projecao: [],
    dtBiPastaLocal: { suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }), lerJson: async () => ({ produtos: [{ cod: 500, real: [10, 20, 30, 40, 50, 60, 70, 80, 0, 0, 0, 0] }] }) },
  });
  await win._DTProjecaoBiInternals.buscarProjecaoBi();
  assert.equal(colProjecao._registro.size, 1);
});

test('buscarProjecaoBi: produto sem correspondência na escadinha não é tocado', async () => {
  const { win, colProjecao } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '999', nome: 'Sem escadinha' } }],
    projecao: [{ id: 'proj1', data: { cod: '999', produto: 'Sem escadinha', venda_m1: 42 } }],
    dtBiPastaLocal: { suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }), lerJson: async () => ({ produtos: [] }) },
  });
  await win._DTProjecaoBiInternals.buscarProjecaoBi();
  assert.equal(colProjecao._registro.get('proj1').venda_m1, 42, 'sem match na escadinha, valor antigo permanece');
});

// PEDIDO AO VIVO (2026-09-07): "pega os três meses futuros... outubro,
// novembro, dezembro [mês corrente é setembro] — pula o mês corrente" —
// `real[]` sempre é 0 nos meses futuros (ainda não aconteceram); quem tem
// dado de verdade pra eles é `plano[]` (meta/orçamento do ano inteiro).
test('_calcularVendaMesesEscadinha: previsao_m1/m2/m3 vêm do plano[], pulando o mês corrente (mesReferencia+1)', () => {
  const { win } = carregarPagina({});
  // índices: 0=jan..11=dez. mesReferencia=7 (ago) simula "hoje = setembro".
  const dadosEscadinha = { produtos: [{ cod: 304, real: [0, 0, 0, 0, 0, 0, 70, 80, 999, 0, 0, 0], plano: [1, 2, 3, 4, 5, 6, 7, 8, 9, 100, 110, 120] }] };
  const mapa = win._DTProjecaoBiInternals._calcularVendaMesesEscadinha(dadosEscadinha, 7);
  const item = mapa.get('304');
  assert.equal(item.previsao_m1, 100, 'out (índice 9) — mês corrente (set, índice 8) é pulado');
  assert.equal(item.previsao_m2, 110, 'nov (índice 10)');
  assert.equal(item.previsao_m3, 120, 'dez (índice 11)');
});

test('_calcularVendaMesesEscadinha: previsao_mN fica OMITIDO (não vira 0) quando o mês futuro cairia fora do ano coberto pelo arquivo', () => {
  const { win } = carregarPagina({});
  // mesReferencia=9 (out, "hoje" = novembro) — mês corrente = índice 10
  // (nov, pulado); previsao_m1 = índice 11 (dez, dentro do ano); previsao_m2
  // pediria índice 12 e previsao_m3 o índice 13 — janeiro/fevereiro do ANO
  // QUE VEM, que não existe neste arquivo. Nunca pode "embrulhar" e pegar
  // janeiro/fevereiro deste MESMO ano por engano (já passaram).
  const dadosEscadinha = { produtos: [{ cod: 1, real: new Array(12).fill(0), plano: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }] };
  const mapa = win._DTProjecaoBiInternals._calcularVendaMesesEscadinha(dadosEscadinha, 9);
  const item = mapa.get('1');
  assert.equal(item.previsao_m1, 12, 'dez (índice 11) — dentro do ano, ok');
  assert.equal('previsao_m2' in item, false, 'jan do ano que vem não existe neste arquivo — não pode virar o índice 0 (jan deste ano)');
  assert.equal('previsao_m3' in item, false);
});

test('_calcularVendaMesesEscadinha: produto sem plano[] simplesmente não ganha previsao_mN (sem quebrar, sem inventar 0)', () => {
  const { win } = carregarPagina({});
  const dadosEscadinha = { produtos: [{ cod: 1, real: new Array(12).fill(0) }] }; // sem `plano` nenhum
  const mapa = win._DTProjecaoBiInternals._calcularVendaMesesEscadinha(dadosEscadinha, 7);
  const item = mapa.get('1');
  assert.equal('previsao_m1' in item, false);
});

test('buscarProjecaoBi: grava previsao_m1/m2/m3 (do plano[]) junto com venda_m1/m2/m3', async () => {
  const { win, colProjecao } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca' } }],
    projecao: [{ id: 'proj1', data: { cod: '304', produto: 'Tapioca', estoqueAtual: 1234 } }],
    dtBiPastaLocal: {
      suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
      lerJson: async () => ({ produtos: [{ cod: 304, real: [10, 20, 30, 40, 50, 60, 70, 80, 0, 0, 0, 0], plano: [1, 2, 3, 4, 5, 6, 7, 8, 9, 500, 600, 700] }] }),
    },
  });
  await win._DTProjecaoBiInternals.buscarProjecaoBi();
  const salvo = colProjecao._registro.get('proj1');
  assert.equal(salvo.previsao_m1, 500);
  assert.equal(salvo.previsao_m2, 600);
  assert.equal(salvo.previsao_m3, 700);
});

// PEDIDO AO VIVO (2026-09-07): "vai pegar esses dois resultados, vai somar
// um com o outro e vai dividir por dois... senão, se os meses passados
// foram fortes e os seguintes fracos, o estoque fica muito alto".
test('calcularProjecaoComRisco: com venda_m1-3 E previsao_m1-3 presentes, projeção mensal é a MÉDIA SIMPLES (50/50) das duas médias, não só o histórico', async () => {
  const { win } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca' } }],
    projecao: [{ id: 'proj1', data: { cod: '304', produto: 'Tapioca', venda_m1: 300, venda_m2: 300, venda_m3: 300, previsao_m1: 100, previsao_m2: 100, previsao_m3: 100 } }],
  });
  await win.carregarProducaoProjecao();
  const linhas = win.calcularProjecaoComRisco('simples');
  const item = linhas.find(x => x.cod === '304');
  assert.ok(item, 'produto entra no cálculo');
  // histórico médio = 300, previsão média = 100 -> (300+100)/2 = 200
  assert.equal(item.projMensal, 200);
});

// PEDIDO AO VIVO (2026-09-07): "ali aquele último mês m1, m2, m3... eu quero
// que mostre o último mês, que foi o mês de venda, e os outros dois...
// mostre o mês seguinte e o mês do mês seguinte" — a tabela de "Projeção de
// Vendas" mantém M1 como o histórico real (venda_m1), mas as outras 2
// colunas passam a mostrar a PROJEÇÃO dos 2 próximos meses (previsao_m1/m2,
// já calculados a partir do plano[] da escadinha), não mais mais histórico.
test('renderProducaoProjecao: tabela mostra Último mês (histórico) + Mês +1/+2 (previsão futura), não mais histórico', async () => {
  const { win, document } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca' } }],
    projecao: [{ id: 'proj1', data: { cod: '304', produto: 'Tapioca', venda_m1: 111, venda_m2: 222, venda_m3: 333, previsao_m1: 444, previsao_m2: 555, previsao_m3: 666, estoqueAtual: 10 } }],
  });
  await win.renderProducaoProjecao();
  const html = document.getElementById('page-producao-projecao').innerHTML;
  assert.match(html, /Mês \+1/);
  assert.match(html, /Mês \+2/);
  assert.doesNotMatch(html, /Mês -2/);
  assert.doesNotMatch(html, /Mês -3/);
  assert.match(html, />111</, 'Último mês continua mostrando venda_m1 (histórico real)');
  assert.match(html, />444</, 'Mês +1 mostra previsao_m1, não venda_m2');
  assert.match(html, />555</, 'Mês +2 mostra previsao_m2, não venda_m3');
  assert.doesNotMatch(html, />222</, 'venda_m2 não aparece mais na tabela');
  assert.doesNotMatch(html, />333</, 'venda_m3 não aparece mais na tabela');
});
