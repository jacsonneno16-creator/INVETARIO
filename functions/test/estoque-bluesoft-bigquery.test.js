'use strict';
// Logística › Estoque › Relatórios — Fase C (Cloud Functions). Mesmo
// padrão de carregamento/mocks já usado em compras-historico-bigquery.test.js
// (firebase-admin stubado, bigqueryFake injetado direto nas funções
// internas — nunca toca o BigQuery/Firestore de verdade).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

function carregar() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', {value: () => ({}), configurable: true});
  return require(path.join(__dirname, '..', 'index.js'))._estoqueBluesoftInternals;
}

// ── Fake de Firestore (só o suficiente: doc/get/set por caminho) ─────────
function firestoreFake(seed) {
  const dados = new Map(Object.entries(seed || {})); // 'colecao/doc' -> objeto
  function docRef(caminho) {
    return {
      get: async () => ({exists: dados.has(caminho), data: () => dados.get(caminho)}),
      set: async (valor) => { dados.set(caminho, valor); },
      collection: (sub) => colRef(caminho + '/' + sub),
    };
  }
  function colRef(caminho) {
    return {
      doc: (id) => docRef(caminho + '/' + id),
      get: async () => {
        const prefixo = caminho + '/';
        const docs = [...dados.entries()].filter(([k]) => k.startsWith(prefixo) && !k.slice(prefixo.length).includes('/'))
          .map(([k, v]) => ({id: k.slice(prefixo.length), data: () => v}));
        return {docs};
      },
    };
  }
  return {_dados: dados, collection: (nome) => colRef(nome)};
}

// ── Fake de BigQuery — simula load() + MERGE de verdade o suficiente pra
// provar idempotência (mantém um "destino" em memória e aplica o MERGE
// quando a query bate com o padrão esperado) ─────────────────────────────
function bigqueryFake() {
  const chamadasQuery = [];
  const chamadasLoad = [];
  const tabelasDeletadas = [];
  const staging = new Map(); // nomeTabela -> linhas carregadas
  const destino = new Map(); // nomeTabela -> Map(chave -> linha)

  function tableFake(nomeTabela) {
    return {
      async load(caminhoArquivo, opts) {
        const linhas = fs.readFileSync(caminhoArquivo, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
        chamadasLoad.push({nomeTabela, linhas, opts});
        staging.set(nomeTabela, linhas);
      },
      async delete() { tabelasDeletadas.push(nomeTabela); staging.delete(nomeTabela); },
    };
  }
  return {
    _chamadasQuery: chamadasQuery, _chamadasLoad: chamadasLoad, _tabelasDeletadas: tabelasDeletadas, _destino: destino,
    dataset: () => ({table: tableFake}),
    query: async (opts) => {
      chamadasQuery.push(opts);
      const m = String(opts.query).match(/MERGE `dt_relatorios\.(\w+)` destino\s+USING `dt_relatorios\.(\w+)` origem\s+ON destino\.(\w+) = origem\.\3/);
      if (m) {
        const [, nomeDestino, nomeStaging, colunaChave] = m;
        if (!destino.has(nomeDestino)) destino.set(nomeDestino, new Map());
        const mapaDestino = destino.get(nomeDestino);
        const linhasStaging = staging.get(nomeStaging) || [];
        const fazUpdate = /WHEN MATCHED THEN UPDATE/.test(opts.query);
        linhasStaging.forEach(linha => {
          const chave = String(linha[colunaChave]);
          if (!mapaDestino.has(chave)) mapaDestino.set(chave, linha);
          else if (fazUpdate) mapaDestino.set(chave, linha);
        });
        return [[]];
      }
      return [[]];
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Trava GET-only
// ═══════════════════════════════════════════════════════════════════════
test('_bluesoftGetSomenteLeitura: recusa qualquer método diferente de GET, sem nem tentar chamar a Bluesoft', async () => {
  const {_bluesoftGetSomenteLeitura} = carregar();
  await assert.rejects(
    _bluesoftGetSomenteLeitura('/api/estoques/movimentacoesdeestoque/analitico', {ambiente: 'homologacao', url_hml: 'https://x', token: 't'}, 'POST'),
    /só pode fazer GET/
  );
});

test('_bluesoftGetSomenteLeitura: GET de verdade (sem 2º/3º parâmetro de método) chega até a chamada HTTP', async () => {
  const {_bluesoftGetSomenteLeitura} = carregar();
  const chamadas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => { chamadas.push({url, opts}); return {ok: true, status: 200, text: async () => JSON.stringify({data: []})}; };
  try {
    await _bluesoftGetSomenteLeitura('/api/estoques/movimentacoesdeestoque/tipos', {ambiente: 'homologacao', url_hml: 'https://exemplo.bluesoft', token: 'abc'});
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].opts.method, 'GET');
    assert.equal(chamadas[0].opts.headers['x-CustomToken'], 'abc');
  } finally { global.fetch = fetchOriginal; }
});

test('_bluesoftGetSomenteLeitura: 401 falha na hora, sem tentar de novo', async () => {
  const {_bluesoftGetSomenteLeitura} = carregar();
  let chamadas = 0;
  const fetchOriginal = global.fetch;
  global.fetch = async () => { chamadas++; return {ok: false, status: 401, text: async () => '{}'}; };
  try {
    await assert.rejects(_bluesoftGetSomenteLeitura('/x', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}), /token inválido/i);
    assert.equal(chamadas, 1);
  } finally { global.fetch = fetchOriginal; }
});

test('_bluesoftGetSomenteLeitura: 429 e 5xx tentam de novo (até 3x); outro erro 4xx não tenta de novo', async () => {
  const {_bluesoftGetSomenteLeitura} = carregar();
  const fetchOriginal = global.fetch;
  let chamadas = 0;
  global.fetch = async () => { chamadas++; return {ok: false, status: 503, text: async () => '{}'}; };
  try {
    await assert.rejects(_bluesoftGetSomenteLeitura('/x', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}));
    assert.equal(chamadas, 3, '503 é retentável — até 3 tentativas');
  } finally { global.fetch = fetchOriginal; }

  chamadas = 0;
  global.fetch = async () => { chamadas++; return {ok: false, status: 400, text: async () => '{}'}; };
  try {
    await assert.rejects(_bluesoftGetSomenteLeitura('/x', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}));
    assert.equal(chamadas, 1, '400 não é retentável — falha na 1ª tentativa');
  } finally { global.fetch = fetchOriginal; }
});

// ═══════════════════════════════════════════════════════════════════════
// Paginação + dedupe
// ═══════════════════════════════════════════════════════════════════════
test('_coletarMovimentosAnaliticoDia: pagina até a página vir com menos de 500 itens, dedupe por movimentoEstoqueKey', async () => {
  const {_coletarMovimentosAnaliticoDia} = carregar();
  const paginasChamadas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(url);
    const pagina = Number(u.searchParams.get('currentPage'));
    paginasChamadas.push(pagina);
    let data;
    if (pagina === 0) data = Array.from({length: 500}, (_, i) => ({movimentoEstoqueKey: i + 1, quantidade: 1}));
    else if (pagina === 1) data = [{movimentoEstoqueKey: 1, quantidade: 1}, {movimentoEstoqueKey: 501, quantidade: 1}]; // repete a key 1 (paginação inconsistente real) + 1 nova
    else data = [];
    return {ok: true, status: 200, text: async () => JSON.stringify({currentPage: pagina, pageSize: 500, data})};
  };
  try {
    const itens = await _coletarMovimentosAnaliticoDia('1', '01/04/2026', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'});
    assert.deepEqual(paginasChamadas, [0, 1], 'parou assim que a página veio com menos de 500 — não pediu uma 3ª');
    assert.equal(itens.length, 501, 'achatou 500 + 2 (1 repetida) sem duplicar — dedupe por movimentoEstoqueKey');
  } finally { global.fetch = fetchOriginal; }
});

test('_coletarMovimentosAnaliticoDia: ACHADO AO VIVO — Bluesoft devolvendo a MESMA página cheia pra sempre (ignorando currentPage) não trava mais a função, para na 2ª chamada', async () => {
  const {_coletarMovimentosAnaliticoDia} = carregar();
  let chamadas = 0;
  const fetchOriginal = global.fetch;
  const mesmos500 = Array.from({length: 500}, (_, i) => ({movimentoEstoqueKey: i + 1, quantidade: 1}));
  global.fetch = async () => {
    chamadas++;
    return {ok: true, status: 200, text: async () => JSON.stringify({currentPage: 0, pageSize: 500, data: mesmos500})};
  };
  try {
    const itens = await _coletarMovimentosAnaliticoDia('1', '01/04/2026', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'});
    assert.equal(chamadas, 2, 'chamou a 1ª página, viu que a 2ª não trouxe NADA novo, e parou — não ficou pedindo pra sempre');
    assert.equal(itens.length, 500);
  } finally { global.fetch = fetchOriginal; }
});

test('_coletarMovimentosAnaliticoDia: limite absoluto de 200 páginas protege contra uma API que SEMPRE devolve itens novos (nunca fica presa de verdade)', async () => {
  const {_coletarMovimentosAnaliticoDia} = carregar();
  let chamadas = 0;
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    chamadas++;
    const pagina = Number(new URL(url).searchParams.get('currentPage'));
    const data = Array.from({length: 500}, (_, i) => ({movimentoEstoqueKey: pagina * 500 + i + 1, quantidade: 1}));
    return {ok: true, status: 200, text: async () => JSON.stringify({currentPage: pagina, pageSize: 500, data})};
  };
  try {
    const itens = await _coletarMovimentosAnaliticoDia('1', '01/04/2026', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'});
    assert.equal(chamadas, 200, 'parou exatamente no limite de 200 páginas, não ficou pedindo pra sempre');
    assert.equal(itens.length, 100000);
  } finally { global.fetch = fetchOriginal; }
});

// ═══════════════════════════════════════════════════════════════════════
// MERGE idempotente
// ═══════════════════════════════════════════════════════════════════════
test('_carregarMovimentosEstoqueNoBigQuery: rodar o MESMO dia 2x não duplica (MERGE por movimento_estoque_key)', async () => {
  const {_normalizarMovimentoEstoque, _carregarMovimentosEstoqueNoBigQuery} = carregar();
  const bq = bigqueryFake();
  const brutos = [{movimentoEstoqueKey: 1, lojaKey: 1, produtoKey: 10, dataMovimento: '01/04/2026', quantidade: 5, tipoMovimentoKey: 801}];
  const linhas = brutos.map(b => _normalizarMovimentoEstoque(b, 'loja_matriz', '2026-10-02T03:00:00.000Z'));

  await _carregarMovimentosEstoqueNoBigQuery(bq, linhas);
  await _carregarMovimentosEstoqueNoBigQuery(bq, linhas); // roda de novo, mesmo dia/dados

  assert.equal(bq._chamadasLoad.length, 2, 'cada rodada cria sua própria staging');
  assert.equal(bq._tabelasDeletadas.length, 2, 'staging sempre apagada depois (nas 2 rodadas)');
  const mapaFinal = bq._destino.get('estoque_movimentos');
  assert.equal(mapaFinal.size, 1, 'só 1 linha no destino — a 2ª rodada não duplicou');
});

test('_sincronizarEstoqueDiaLoja: BUG AO VIVO REAL — grava loja_key com o código da BLUESOFT (loja.bluesoft_loja_key), nunca o ID do documento no Firestore (loja.id)', async () => {
  const {_sincronizarEstoqueDiaLoja} = carregar();
  const bq = bigqueryFake();
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({data: [{movimentoEstoqueKey: 1, quantidade: 1, tipoMovimentoKey: 801}]})});
  try {
    // ID do Firestore ("loja_matriz") DIFERENTE do código da Bluesoft
    // ("14") de propósito — é exatamente essa diferença que escondia o bug
    // real: _buscarRelatorioEstoqueBigQueryInterno sempre filtra pelo
    // código da Bluesoft, então uma linha gravada com o ID do Firestore
    // nunca aparece em NENHUM relatório, pra nenhuma loja.
    const loja = {id: 'loja_matriz', bluesoft_loja_key: '14'};
    await _sincronizarEstoqueDiaLoja(loja, '15/05/2026', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}, bq);
    const linhaGravada = bq._chamadasLoad[0].linhas[0];
    assert.equal(linhaGravada.loja_key, '14', 'tinha que ser o código da Bluesoft');
    assert.notEqual(linhaGravada.loja_key, 'loja_matriz', 'nunca o ID do documento do Firestore');
  } finally { global.fetch = fetchOriginal; }
});

// ═══════════════════════════════════════════════════════════════════════
// Descrição de produto (pedido ao vivo 2026-10-03)
// ═══════════════════════════════════════════════════════════════════════
test('_sincronizarProdutosFaltantesEstoque: busca descrição só dos produtos que faltam, grava via MERGE por produto_key', async () => {
  const {_sincronizarProdutosFaltantesEstoque} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT DISTINCT produto_key FROM/.test(opts.query)) {
      bq._chamadasQuery.push(opts);
      return [[{produto_key: 'p1'}, {produto_key: 'p2'}]];
    }
    return queryOriginal(opts);
  };
  const chamadasFetch = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    chamadasFetch.push(url);
    const produtoKey = decodeURIComponent(String(url).split('/').pop());
    return {ok: true, status: 200, text: async () => JSON.stringify({descricao: 'Produto ' + produtoKey})};
  };
  try {
    const resultado = await _sincronizarProdutosFaltantesEstoque(bq, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'});
    assert.equal(resultado.total, 2);
    assert.equal(chamadasFetch.length, 2);
    const mapaFinal = bq._destino.get('estoque_produtos');
    assert.equal(mapaFinal.get('p1').descricao, 'Produto p1');
    assert.equal(mapaFinal.get('p2').descricao, 'Produto p2');
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarProdutosFaltantesEstoque: nenhum produto faltando não chama a Bluesoft nem o MERGE', async () => {
  const {_sincronizarProdutosFaltantesEstoque} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT DISTINCT produto_key FROM/.test(opts.query)) { bq._chamadasQuery.push(opts); return [[]]; }
    return queryOriginal(opts);
  };
  let chamadasFetch = 0;
  const fetchOriginal = global.fetch;
  global.fetch = async () => { chamadasFetch++; return {ok: true, status: 200, text: async () => '{}'}; };
  try {
    const resultado = await _sincronizarProdutosFaltantesEstoque(bq, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'});
    assert.equal(resultado.total, 0);
    assert.equal(chamadasFetch, 0);
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarProdutosFaltantesEstoque: 1 produto falhando não impede os outros de serem gravados', {timeout: 10000}, async () => {
  const {_sincronizarProdutosFaltantesEstoque} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT DISTINCT produto_key FROM/.test(opts.query)) { bq._chamadasQuery.push(opts); return [[{produto_key: 'p1'}, {produto_key: 'p2'}]]; }
    return queryOriginal(opts);
  };
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith('/p1')) return {ok: false, status: 500, text: async () => '{}'};
    return {ok: true, status: 200, text: async () => JSON.stringify({descricao: 'Produto p2'})};
  };
  try {
    const resultado = await _sincronizarProdutosFaltantesEstoque(bq, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'});
    assert.equal(resultado.total, 1, 'só p2 foi gravado — p1 falhou mas não travou o resto');
  } finally { global.fetch = fetchOriginal; }
});

// PEDIDO AO VIVO (2026-10-03): "vou precisar ficar atualizando várias
// vezes?" — temMaisPendentes avisa o chamador quando o lote veio cheio
// (500), pra "Atualizar agora" saber que precisa chamar de novo sozinho.
test('_sincronizarProdutosFaltantesEstoque: temMaisPendentes=true quando o lote veio cheio (500) — pode ter mais além dele', async () => {
  const {_sincronizarProdutosFaltantesEstoque} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT DISTINCT produto_key FROM/.test(opts.query)) {
      return [Array.from({length: 500}, (_, i) => ({produto_key: 'p' + i}))];
    }
    return queryOriginal(opts);
  };
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({descricao: 'X'})});
  try {
    const resultado = await _sincronizarProdutosFaltantesEstoque(bq, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'});
    assert.equal(resultado.temMaisPendentes, true);
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarProdutosFaltantesEstoque: temMaisPendentes=false quando o lote veio incompleto (achou tudo que faltava)', async () => {
  const {_sincronizarProdutosFaltantesEstoque} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT DISTINCT produto_key FROM/.test(opts.query)) return [[{produto_key: 'p1'}]];
    return queryOriginal(opts);
  };
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({descricao: 'X'})});
  try {
    const resultado = await _sincronizarProdutosFaltantesEstoque(bq, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'});
    assert.equal(resultado.temMaisPendentes, false);
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarItensInventariosFechadosLoja: temMaisPendentes=true quando o lote veio cheio (50)', async () => {
  const {_sincronizarItensInventariosFechadosLoja} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT inventario_key FROM/.test(opts.query)) return [Array.from({length: 50}, (_, i) => ({inventario_key: String(i)}))];
    return queryOriginal(opts);
  };
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({data: []})});
  try {
    const loja = {id: 'loja_matriz', bluesoft_loja_key: '14'};
    const resultado = await _sincronizarItensInventariosFechadosLoja(loja, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}, bq);
    assert.equal(resultado.temMaisPendentes, true);
  } finally { global.fetch = fetchOriginal; }
});

// ═══════════════════════════════════════════════════════════════════════
// Cabeçalho de inventário (pedido ao vivo 2026-10-03) — MESMA classe de bug
// do produto: coletado na Fase C, nunca ligado em lugar nenhum.
// ═══════════════════════════════════════════════════════════════════════
test('_sincronizarInventariosLoja: grava loja_key com o código da BLUESOFT (mesmo cuidado do bug de movimentos), filtra por dataAbertura no formato BR', async () => {
  const {_sincronizarInventariosLoja} = carregar();
  const bq = bigqueryFake();
  const chamadasFetch = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    chamadasFetch.push(String(url));
    return {ok: true, status: 200, text: async () => JSON.stringify({data: [{inventarioKey: 1001, descricao: 'Inventário Mensal', tipoDeInventario: 'ESTOQUE', dataAbertura: '01/05/2026 08:00', dataFechamento: '02/05/2026 18:00'}]})};
  };
  try {
    const loja = {id: 'loja_matriz', bluesoft_loja_key: '14'};
    const resultado = await _sincronizarInventariosLoja(loja, '2026-05-01', '2026-05-31', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}, bq);
    assert.equal(resultado.total, 1);
    const linhaGravada = bq._chamadasLoad[0].linhas[0];
    assert.equal(linhaGravada.loja_key, '14', 'tinha que ser o código da Bluesoft');
    assert.notEqual(linhaGravada.loja_key, 'loja_matriz');
    assert.equal(linhaGravada.inventario_key, '1001');
    assert.equal(linhaGravada.descricao, 'Inventário Mensal');
    assert.equal(linhaGravada.status, 'FECHADO', 'tem dataFechamento, então fechado');
    assert.match(chamadasFetch[0], /dataAberturaInicial=01%2F05%2F2026/);
    assert.match(chamadasFetch[0], /dataAberturaFinal=31%2F05%2F2026/);
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarInventariosLoja: nenhum inventário no período não chama o MERGE', async () => {
  const {_sincronizarInventariosLoja} = carregar();
  const bq = bigqueryFake();
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({data: []})});
  try {
    const loja = {id: 'loja_matriz', bluesoft_loja_key: '14'};
    const resultado = await _sincronizarInventariosLoja(loja, '2026-05-01', '2026-05-31', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}, bq);
    assert.equal(resultado.total, 0);
    assert.equal(bq._chamadasLoad.length, 0);
  } finally { global.fetch = fetchOriginal; }
});

// ═══════════════════════════════════════════════════════════════════════
// Itens de inventário / quantidade sistema+contada (pedido ao vivo
// 2026-10-03) — MESMA classe de bug, 3ª instância: coletado na Fase C,
// nunca ligado em lugar nenhum.
// ═══════════════════════════════════════════════════════════════════════
test('_sincronizarItensInventariosFechadosLoja: busca só inventário FECHADO que ainda não tem item gravado, normaliza quantidade_contada/sistema certo', async () => {
  const {_sincronizarItensInventariosFechadosLoja} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  const chamadasQuery = [];
  bq.query = async (opts) => {
    chamadasQuery.push(opts);
    if (/SELECT inventario_key FROM/.test(opts.query)) return [[{inventario_key: '48975'}]];
    return queryOriginal(opts);
  };
  const chamadasFetch = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    chamadasFetch.push(String(url));
    return {ok: true, status: 200, text: async () => JSON.stringify({data: [{produtoKey: 45362, quantidadeContada: 3191, quantidadeSistema: 1509.856, custoBruto: 12.12, custoLiquido: 9.40, custoContabil: 9.40}]})};
  };
  try {
    const loja = {id: 'loja_matriz', bluesoft_loja_key: '14'};
    const resultado = await _sincronizarItensInventariosFechadosLoja(loja, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}, bq);
    assert.equal(resultado.total, 1);
    assert.match(chamadasQuery[0].query, /status = 'FECHADO'/);
    assert.equal(chamadasQuery[0].params.lojaKey, '14');
    assert.match(chamadasFetch[0], /\/api\/estoques\/inventarios\/48975\/produtos/);
    const linhaGravada = bq._chamadasLoad[0].linhas[0];
    assert.equal(linhaGravada.inventario_key, '48975');
    assert.equal(linhaGravada.produto_key, '45362');
    assert.equal(linhaGravada.loja_key, '14');
    assert.equal(linhaGravada.quantidade_contada, 3191);
    assert.equal(linhaGravada.quantidade_sistema, 1509.856);
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarItensInventariosFechadosLoja: nenhum inventário fechado faltando não chama a Bluesoft', async () => {
  const {_sincronizarItensInventariosFechadosLoja} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT inventario_key FROM/.test(opts.query)) return [[]];
    return queryOriginal(opts);
  };
  let chamadasFetch = 0;
  const fetchOriginal = global.fetch;
  global.fetch = async () => { chamadasFetch++; return {ok: true, status: 200, text: async () => '{}'}; };
  try {
    const loja = {id: 'loja_matriz', bluesoft_loja_key: '14'};
    const resultado = await _sincronizarItensInventariosFechadosLoja(loja, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}, bq);
    assert.equal(resultado.total, 0);
    assert.equal(chamadasFetch, 0);
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarItensInventariosFechadosLoja: 1 inventário falhando não impede os outros de serem gravados', {timeout: 10000}, async () => {
  const {_sincronizarItensInventariosFechadosLoja} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT inventario_key FROM/.test(opts.query)) return [[{inventario_key: '1'}, {inventario_key: '2'}]];
    return queryOriginal(opts);
  };
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/inventarios/1/produtos')) return {ok: false, status: 500, text: async () => '{}'};
    return {ok: true, status: 200, text: async () => JSON.stringify({data: [{produtoKey: 'p1', quantidadeContada: 1, quantidadeSistema: 1}]})};
  };
  try {
    const loja = {id: 'loja_matriz', bluesoft_loja_key: '14'};
    const resultado = await _sincronizarItensInventariosFechadosLoja(loja, {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}, bq);
    assert.equal(resultado.total, 1, 'só o inventário 2 gravou — o 1 falhou mas não travou o resto');
  } finally { global.fetch = fetchOriginal; }
});

test('_coletarInventarios: mesma proteção de paginação travada que movimentos — página cheia sem item novo para na hora', async () => {
  const {_coletarInventarios} = carregar();
  let chamadas = 0;
  const fetchOriginal = global.fetch;
  const mesmos200 = Array.from({length: 200}, (_, i) => ({inventarioKey: i + 1}));
  global.fetch = async () => { chamadas++; return {ok: true, status: 200, text: async () => JSON.stringify({data: mesmos200})}; };
  try {
    const itens = await _coletarInventarios('14', {ambiente: 'homologacao', url_hml: 'https://exemplo', token: 't'}, {});
    assert.equal(chamadas, 2, 'viu a 2ª página sem nada novo e parou — não ficou pedindo pra sempre');
    assert.equal(itens.length, 200);
  } finally { global.fetch = fetchOriginal; }
});

test('_carregarMovimentosEstoqueNoBigQuery: staging é apagada mesmo se o MERGE falhar (finally)', async () => {
  const {_normalizarMovimentoEstoque, _carregarMovimentosEstoqueNoBigQuery} = carregar();
  const bq = bigqueryFake();
  bq.query = async () => { throw new Error('falha simulada no MERGE'); };
  const linhas = [_normalizarMovimentoEstoque({movimentoEstoqueKey: 1, lojaKey: 1, dataMovimento: '01/04/2026', quantidade: 1, tipoMovimentoKey: 801}, 'loja_matriz', '2026-10-02T00:00:00.000Z')];
  await assert.rejects(_carregarMovimentosEstoqueNoBigQuery(bq, linhas));
  assert.equal(bq._tabelasDeletadas.length, 1, 'staging apagada mesmo com o MERGE falhando');
});

test('_carregarMovimentosEstoqueNoBigQuery: lista vazia não cria staging nem chama o BigQuery (nada a carregar)', async () => {
  const {_carregarMovimentosEstoqueNoBigQuery} = carregar();
  const bq = bigqueryFake();
  const resultado = await _carregarMovimentosEstoqueNoBigQuery(bq, []);
  assert.equal(resultado.total, 0);
  assert.equal(bq._chamadasLoad.length, 0);
  assert.equal(bq._chamadasQuery.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// Carga histórica retomável
// ═══════════════════════════════════════════════════════════════════════
test('_sincronizarEstoqueBluesoftIntervalo: processa dia a dia e grava progresso por loja (objeto aninhado, nunca chave pontilhada)', async () => {
  const {_sincronizarEstoqueBluesoftIntervalo} = carregar();
  const bq = bigqueryFake();
  const fdb = firestoreFake({'dt_config/integracao_api': {url_hml: 'https://exemplo.bluesoft', token: 't'}});
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({data: []})});
  try {
    const resultado = await _sincronizarEstoqueBluesoftIntervalo('2026-04-01', '2026-04-02', [{id: 'loja1', bluesoft_loja_key: '1'}], bq, fdb, 480000);
    assert.equal(resultado.concluido, true);
    const progresso = fdb._dados.get('dt_config/estoque_bluesoft_sync');
    assert.ok(progresso, 'progresso precisa ter sido gravado');
    assert.equal(typeof progresso.porLoja, 'object');
    assert.equal(progresso.porLoja.loja1.ultimoDiaConcluido, '2026-04-02');
    // nunca uma chave tipo "porLoja.loja1" literal (merge pontilhado) — o
    // objeto precisa estar DE VERDADE aninhado.
    assert.equal(Object.prototype.hasOwnProperty.call(progresso, 'porLoja.loja1'), false);
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarEstoqueBluesoftIntervalo: depois dos movimentos, também sincroniza o cabeçalho de inventário da loja pro mesmo período (pedido ao vivo 2026-10-03)', async () => {
  const {_sincronizarEstoqueBluesoftIntervalo} = carregar();
  const bq = bigqueryFake();
  const fdb = firestoreFake({'dt_config/integracao_api': {url_hml: 'https://exemplo.bluesoft', token: 't'}});
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/api/estoques/inventarios')) {
      return {ok: true, status: 200, text: async () => JSON.stringify({data: [{inventarioKey: 1001, descricao: 'Inventário Mensal', dataAbertura: '01/04/2026 08:00'}]})};
    }
    return {ok: true, status: 200, text: async () => JSON.stringify({data: []})};
  };
  try {
    await _sincronizarEstoqueBluesoftIntervalo('2026-04-01', '2026-04-02', [{id: 'loja1', bluesoft_loja_key: '1'}], bq, fdb, 480000);
    const mapaInventarios = bq._destino.get('estoque_inventarios');
    assert.ok(mapaInventarios, 'estoque_inventarios precisa ter sido gravado');
    const [linhaGravada] = mapaInventarios.values();
    assert.equal(linhaGravada.inventario_key, '1001');
    assert.equal(linhaGravada.loja_key, '1', 'código da Bluesoft, não o ID do Firestore ("loja1")');
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarEstoqueBluesoftIntervalo: devolve produtosPendentes/inventariosItensPendentes=true quando os lotes vêm cheios — "Atualizar agora" sabe que precisa chamar de novo sozinho, sem o usuário clicar manualmente', async () => {
  const {_sincronizarEstoqueBluesoftIntervalo} = carregar();
  const bq = bigqueryFake();
  const queryOriginal = bq.query;
  bq.query = async (opts) => {
    if (/SELECT DISTINCT produto_key FROM/.test(opts.query)) return [Array.from({length: 500}, (_, i) => ({produto_key: 'p' + i}))];
    if (/SELECT inventario_key FROM/.test(opts.query)) return [Array.from({length: 50}, (_, i) => ({inventario_key: String(i)}))];
    return queryOriginal(opts);
  };
  const fdb = firestoreFake({'dt_config/integracao_api': {url_hml: 'https://exemplo.bluesoft', token: 't'}});
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/api/comercial/produtos/')) return {ok: true, status: 200, text: async () => JSON.stringify({descricao: 'X'})};
    return {ok: true, status: 200, text: async () => JSON.stringify({data: []})};
  };
  try {
    const resultado = await _sincronizarEstoqueBluesoftIntervalo('2026-04-01', '2026-04-02', [{id: 'loja1', bluesoft_loja_key: '1'}], bq, fdb, 480000);
    assert.equal(resultado.produtosPendentes, true);
    assert.equal(resultado.inventariosItensPendentes, true);
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarEstoqueBluesoftIntervalo: retoma do dia certo quando o tempo acaba no meio do range (não refaz dias já concluídos)', async () => {
  const {_sincronizarEstoqueBluesoftIntervalo} = carregar();
  const bq = bigqueryFake();
  const diasChamados = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    // dataMovimento só existe na chamada de movimentos — a sincronização de
    // inventário (pedido ao vivo 2026-10-03) usa dataAbertura, sem esse
    // parâmetro, e não deve entrar na lista rastreada aqui.
    const dataMovimento = new URL(url).searchParams.get('dataMovimento');
    if (dataMovimento) diasChamados.push(dataMovimento);
    return {ok: true, status: 200, text: async () => JSON.stringify({data: []})};
  };
  try {
    // 1ª chamada: já vem com loja1 tendo concluído até 02/04 (simulando uma
    // execução anterior que já tinha avançado); pede o range 01/04 a 04/04 —
    // só 03/04 e 04/04 deveriam ser buscados de verdade.
    const fdb = firestoreFake({
      'dt_config/estoque_bluesoft_sync': {porLoja: {loja1: {ultimoDiaConcluido: '2026-04-02', diasComErro: []}}},
      'dt_config/integracao_api': {url_hml: 'https://exemplo.bluesoft', token: 't'},
    });
    const resultado = await _sincronizarEstoqueBluesoftIntervalo('2026-04-01', '2026-04-04', [{id: 'loja1', bluesoft_loja_key: '1'}], bq, fdb, 480000);
    assert.equal(resultado.concluido, true);
    assert.deepEqual(diasChamados, ['03/04/2026', '04/04/2026'], 'não refaz 01/04 nem 02/04, já concluídos antes');
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarEstoqueBluesoftIntervalo: tempo esgotado no meio do range devolve concluido=false e o próximo dia certo', async () => {
  const {_sincronizarEstoqueBluesoftIntervalo} = carregar();
  const bq = bigqueryFake();
  const fdb = firestoreFake({'dt_config/integracao_api': {url_hml: 'https://exemplo.bluesoft', token: 't'}});
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({data: []})});
  try {
    // limiteMs=-1 — qualquer tempo decorrido (mesmo 0ms, sujeito à resolução
    // do relógio do SO) já é "maior que -1", então estoura antes de
    // processar qualquer dia, de forma determinística.
    const resultado = await _sincronizarEstoqueBluesoftIntervalo('2026-04-01', '2026-04-05', [{id: 'loja1', bluesoft_loja_key: '1'}], bq, fdb, -1);
    assert.equal(resultado.concluido, false);
    assert.equal(resultado.proximoDia, '2026-04-01');
  } finally { global.fetch = fetchOriginal; }
});

test('_sincronizarEstoqueBluesoftIntervalo: um dia com erro é registrado em diasComErro e NÃO trava o resto do range', async () => {
  const {_sincronizarEstoqueBluesoftIntervalo} = carregar();
  const bq = bigqueryFake();
  const fdb = firestoreFake({'dt_config/integracao_api': {url_hml: 'https://exemplo.bluesoft', token: 't'}});
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    const dataMovimento = new URL(url).searchParams.get('dataMovimento');
    if (dataMovimento === '02/04/2026') return {ok: false, status: 500, text: async () => '{}'};
    return {ok: true, status: 200, text: async () => JSON.stringify({data: []})};
  };
  try {
    const resultado = await _sincronizarEstoqueBluesoftIntervalo('2026-04-01', '2026-04-03', [{id: 'loja1', bluesoft_loja_key: '1'}], bq, fdb, 480000);
    assert.equal(resultado.concluido, true, 'erro em 1 dia não impede o range de terminar');
    assert.ok(resultado.porLoja.loja1.diasComErro.includes('2026-04-02'));
    assert.equal(resultado.porLoja.loja1.ultimoDiaConcluido, '2026-04-03', 'segue adiante e termina no último dia, mesmo com 1 erro no meio');
  } finally { global.fetch = fetchOriginal; }
});

// ═══════════════════════════════════════════════════════════════════════
// Relatório (consulta pras telas)
// ═══════════════════════════════════════════════════════════════════════
test('_buscarRelatorioEstoqueBigQueryInterno: recusa loja sem permissão', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {lojas_permitidas: ['outraLoja']};
  const bq = bigqueryFake();
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await assert.rejects(
    _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb),
    /permission-denied|Sem acesso/
  );
});

test('_buscarRelatorioEstoqueBigQueryInterno: recusa período acima de 366 dias', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await assert.rejects(
    _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', lojaId: 'loja1', dataInicial: '2024-01-01', dataFinal: '2026-01-01'}, acesso, bq, fdb),
    /366 dias/
  );
});

test('_buscarRelatorioEstoqueBigQueryInterno: relatório inválido é recusado antes de consultar o BigQuery', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await assert.rejects(
    _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'nao-existe', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb),
    /Relatório inválido/
  );
  assert.equal(bq._chamadasQuery.length, 0);
});

test('_buscarRelatorioEstoqueBigQueryInterno: monta a query certa (view do relatório, período, loja, @param) e devolve totais calculados das linhas', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => {
    bq._chamadasQuery.push(opts);
    return [[{produto_key: 'p1', quantidade: 10, valor: 100}, {produto_key: 'p2', quantidade: 5, valor: 50}]];
  };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}, 'dt_config/estoque_bluesoft_sync': {porLoja: {loja1: {ultimoDiaConcluido: '2026-04-30'}}}});
  const resultado = await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb);

  const chamada = bq._chamadasQuery[0];
  assert.match(chamada.query, /vw_estoque_rel_inventario/);
  assert.match(chamada.query, /loja_key IN UNNEST\(@lojaKeys\)/);
  assert.match(chamada.query, /eh_estorno = FALSE/, 'sem incluirEstornos, filtra estorno por padrão');
  assert.deepEqual(chamada.params.lojaKeys, ['1']);
  assert.equal(chamada.params.dataInicial, '2026-04-01');
  assert.equal(resultado.totais.lancamentos, 2);
  assert.equal(resultado.totais.quantidade, 15);
  assert.equal(resultado.totais.valor, 150);
  assert.equal(resultado.totais.produtosDistintos, 2);
  assert.equal(resultado.ultimaAtualizacao, '2026-04-30');
});

// ═══════════════════════════════════════════════════════════════════════
// "filtro de loja pra todos" (pedido ao vivo 2026-10-03) — lojaId vira
// opcional, sem ele busca em todas as lojas permitidas de uma vez (mesmo
// padrão de permissão de buscarCargasTodasLojasBigQuery/
// buscarTransbordoTodasLojasBigQuery).
// ═══════════════════════════════════════════════════════════════════════
test('_buscarRelatorioEstoqueBigQueryInterno: sem lojaId e acesso_todas_lojas=true — busca em TODAS as lojas com bluesoft_loja_key configurada', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[]]; };
  const fdb = firestoreFake({
    'lojas/loja1': {bluesoft_loja_key: '1', nome: 'Matriz'},
    'lojas/loja2': {bluesoft_loja_key: '2', nome: 'Filial'},
    'lojas/loja_sem_bluesoft': {nome: 'Sem integração'}, // sem bluesoft_loja_key — tem que ficar de fora
  });
  await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb);
  const chamada = bq._chamadasQuery[0];
  assert.deepEqual(new Set(chamada.params.lojaKeys), new Set(['1', '2']));
});

test('_buscarRelatorioEstoqueBigQueryInterno: sem lojaId e acesso restrito — busca só nas lojas PERMITIDAS, nunca confia no filtro do cliente', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {lojas_permitidas: ['loja1']}; // só loja1, não loja2
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[]]; };
  const fdb = firestoreFake({
    'lojas/loja1': {bluesoft_loja_key: '1'},
    'lojas/loja2': {bluesoft_loja_key: '2'},
  });
  await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb);
  assert.deepEqual(bq._chamadasQuery[0].params.lojaKeys, ['1']);
});

test('_buscarRelatorioEstoqueBigQueryInterno: sem lojaId e sem NENHUMA loja permitida com integração — recusa antes de consultar o BigQuery', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {lojas_permitidas: ['loja_qualquer']};
  const bq = bigqueryFake();
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await assert.rejects(
    _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb),
    /permission-denied|Sem acesso/
  );
  assert.equal(bq._chamadasQuery.length, 0);
});

test('_buscarRelatorioEstoqueBigQueryInterno: cada linha vem enriquecida com loja_id/loja_nome (resolvidos pelo loja_key cru do BigQuery)', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => {
    bq._chamadasQuery.push(opts);
    return [[{produto_key: 'p1', loja_key: '1', quantidade: 1, valor: 1}, {produto_key: 'p2', loja_key: '2', quantidade: 1, valor: 1}]];
  };
  const fdb = firestoreFake({
    'lojas/loja1': {bluesoft_loja_key: '1', nome: 'Matriz'},
    'lojas/loja2': {bluesoft_loja_key: '2', nome: 'Filial Sul'},
  });
  const resultado = await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb);
  const linhaMatriz = resultado.linhas.find(l => l.produto_key === 'p1');
  const linhaFilial = resultado.linhas.find(l => l.produto_key === 'p2');
  assert.equal(linhaMatriz.loja_id, 'loja1');
  assert.equal(linhaMatriz.loja_nome, 'Matriz');
  assert.equal(linhaFilial.loja_id, 'loja2');
  assert.equal(linhaFilial.loja_nome, 'Filial Sul');
});

test('_buscarRelatorioEstoqueBigQueryInterno: ultimaAtualizacao com várias lojas mostra a mais ATRASADA entre elas (visão conservadora)', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[]]; };
  const fdb = firestoreFake({
    'lojas/loja1': {bluesoft_loja_key: '1'},
    'lojas/loja2': {bluesoft_loja_key: '2'},
    'dt_config/estoque_bluesoft_sync': {porLoja: {
      loja1: {ultimoDiaConcluido: '2026-04-30'},
      loja2: {ultimoDiaConcluido: '2026-04-15'}, // mais atrasada
    }},
  });
  const resultado = await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb);
  assert.equal(resultado.ultimaAtualizacao, '2026-04-15');
});

test('_buscarRelatorioEstoqueBigQueryInterno: incluirEstornos=true NÃO filtra eh_estorno', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[]]; };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'descarte', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30', incluirEstornos: true}, acesso, bq, fdb);
  assert.doesNotMatch(bq._chamadasQuery[0].query, /eh_estorno/);
});

test('_buscarRelatorioEstoqueBigQueryInterno: transformação — produtosIncluir filtra por produto_origem_key OU produto_destino_key com IN UNNEST', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[]]; };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'transformacao', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30', produtosIncluir: ['p1', 'p2']}, acesso, bq, fdb);
  const chamada = bq._chamadasQuery[0];
  assert.match(chamada.query, /produto_origem_key IN UNNEST\(@produtosIncluir\)/);
  assert.match(chamada.query, /produto_destino_key IN UNNEST\(@produtosIncluir\)/);
  assert.deepEqual(chamada.params.produtosIncluir, ['p1', 'p2']);
});

test('_buscarRelatorioEstoqueBigQueryInterno: transformação — produtosExcluir usa NOT (...) IN UNNEST, e ignora o campo "produto" livre quando incluir/excluir estão em uso', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[]]; };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'transformacao', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30', produto: 'nao-deveria-usar', produtosExcluir: ['p3']}, acesso, bq, fdb);
  const chamada = bq._chamadasQuery[0];
  assert.match(chamada.query, /NOT \(produto_origem_key IN UNNEST\(@produtosExcluir\) OR produto_destino_key IN UNNEST\(@produtosExcluir\)\)/);
  assert.deepEqual(chamada.params.produtosExcluir, ['p3']);
  assert.equal(chamada.params.produto, undefined, 'não usa o filtro livre quando incluir/excluir estão presentes');
});

test('_buscarRelatorioEstoqueBigQueryInterno: inventário — inventarioKey filtra por um inventário específico (clique em "Por inventário")', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[]]; };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30', inventarioKey: 'inv-42'}, acesso, bq, fdb);
  const chamada = bq._chamadasQuery[0];
  assert.match(chamada.query, /inventario_key = @inventarioKey/);
  assert.equal(chamada.params.inventarioKey, 'inv-42');
});

test('_buscarRelatorioEstoqueBigQueryInterno: inventarioKey é ignorado pros outros 3 relatórios (a coluna nem existe lá)', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[]]; };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'descarte', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30', inventarioKey: 'inv-42'}, acesso, bq, fdb);
  assert.doesNotMatch(bq._chamadasQuery[0].query, /inventario_key/);
});

test('_buscarRelatorioEstoqueBigQueryInterno: achata campos DATE/DATETIME do BigQuery (objeto {value:...} vira string de verdade antes de ir pro navegador)', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  // Molde real das classes BigQueryDate/BigQueryDatetime/BigQueryTimestamp
  // do @google-cloud/bigquery: só uma propriedade própria `value`, sem
  // toJSON — é exatamente esse shape que precisa ser achatado.
  bq.query = async (opts) => {
    bq._chamadasQuery.push(opts);
    return [[{
      produto_key: 'p1', quantidade: 1, valor: 1,
      data_movimento: {value: '2026-04-01'},
      data_lancamento: {value: '2026-04-01T10:00:00'},
    }]];
  };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  const resultado = await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb);
  assert.equal(resultado.linhas[0].data_movimento, '2026-04-01');
  assert.equal(resultado.linhas[0].data_lancamento, '2026-04-01T10:00:00');
  assert.equal(typeof resultado.linhas[0].data_movimento, 'string');
});

test('_buscarRelatorioEstoqueBigQueryInterno: BUG AO VIVO REAL — achata campos NUMERIC (instância Big.js) em número de verdade, sem travar o serializador do firebase-functions', async () => {
  const Big = require('big.js');
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  // Molde real de uma coluna NUMERIC do @google-cloud/bigquery: instância
  // de Big.js, que grava `instance.constructor = Big` como propriedade
  // PRÓPRIA — é isso que travava o encode() do firebase-functions com
  // "Maximum call stack size exceeded" (loop instância→constructor→
  // prototype→constructor, sem detecção de ciclo).
  bq.query = async (opts) => {
    bq._chamadasQuery.push(opts);
    return [[{ produto_key: 'p1', quantidade: new Big('258.50'), valor: new Big('1234.5') }]];
  };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  const resultado = await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'inventario', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb);
  assert.equal(resultado.linhas[0].quantidade, 258.5);
  assert.equal(typeof resultado.linhas[0].quantidade, 'number');
  assert.equal(resultado.linhas[0].valor, 1234.5);
  // Prova real de que não tem mais ciclo: JSON.stringify trava em ciclo
  // (TypeError "Converting circular structure to JSON"), nunca trava em
  // pilha — então chegar até aqui sem exceção já confirma a ausência dele.
  assert.doesNotThrow(() => JSON.stringify(resultado.linhas));
});

test('_buscarRelatorioEstoqueBigQueryInterno: relatório de transformação usa os campos saida_*/produto_origem_key (não quantidade/valor/produto_key genéricos)', async () => {
  const {_buscarRelatorioEstoqueBigQueryInterno} = carregar();
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  bq.query = async (opts) => { bq._chamadasQuery.push(opts); return [[{produto_origem_key: 'p4', saida_quantidade: 258.5, saida_valor: 10}]]; };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  const resultado = await _buscarRelatorioEstoqueBigQueryInterno({relatorio: 'transformacao', lojaId: 'loja1', dataInicial: '2026-04-01', dataFinal: '2026-04-30'}, acesso, bq, fdb);
  assert.match(bq._chamadasQuery[0].query, /vw_estoque_rel_transformacao/);
  assert.match(bq._chamadasQuery[0].query, /saida_eh_estorno = FALSE/);
  assert.equal(resultado.totais.quantidade, 258.5);
  assert.equal(resultado.totais.valor, 10);
});

// ═══════════════════════════════════════════════════════════════════════
// Ferramenta temporária — aplicar o schema.sql direto (sem bq/gcloud local)
// ═══════════════════════════════════════════════════════════════════════
test('_dividirStatementsSql: o SQL real da Fase B divide em exatamente 14 statements (1 schema + 7 tabelas + delete + insert + 4 views), sem cortar no ";" de dentro de comentário', () => {
  const {_dividirStatementsSql} = carregar();
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'estoque-relatorios-schema.sql'), 'utf8');
  const statements = _dividirStatementsSql(sql);
  assert.equal(statements.length, 14);
  assert.match(statements[0], /CREATE SCHEMA IF NOT EXISTS/);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS.*estoque_movimentos/);
  // A armadilha real: "-- sempre positiva (vem assim da Bluesoft); sentido = ..."
  // tem um ";" DENTRO do comentário — não pode ter cortado o statement aí.
  assert.match(statements[1], /PARTITION BY data_movimento/);
  assert.match(statements.find(s => /DELETE FROM/.test(s)), /estoque_classificacao/);
  assert.equal(statements.filter(s => /CREATE OR REPLACE VIEW/.test(s)).length, 4);
});

test('_dividirStatementsSql: ignora statement vazio (ex.: arquivo terminando com ";\\n" sem nada depois)', () => {
  const {_dividirStatementsSql} = carregar();
  assert.deepEqual(_dividirStatementsSql('SELECT 1;\n\n-- só comentário\n'), ['SELECT 1']);
});

test('_aplicarSchemaEstoqueBigQueryInterno: recusa quem não é administrador, sem rodar nenhum statement', async () => {
  const {_aplicarSchemaEstoqueBigQueryInterno} = carregar();
  const bq = bigqueryFake();
  await assert.rejects(
    _aplicarSchemaEstoqueBigQueryInterno({admin_mestre: false}, bq, 'CREATE TABLE x (a INT64);'),
    /permission-denied|administrador/
  );
  assert.equal(bq._chamadasQuery.length, 0);
});

test('_aplicarSchemaEstoqueBigQueryInterno: admin — roda cada statement em ordem e devolve total/sucesso certos', async () => {
  const {_aplicarSchemaEstoqueBigQueryInterno} = carregar();
  const bq = bigqueryFake();
  const ordemRecebida = [];
  bq.query = async (opts) => { ordemRecebida.push(opts.query); return [[]]; };
  const sql = 'CREATE TABLE IF NOT EXISTS a (x INT64);\nCREATE TABLE IF NOT EXISTS b (y INT64);';
  const resultado = await _aplicarSchemaEstoqueBigQueryInterno({admin_mestre: true}, bq, sql);
  assert.equal(resultado.total, 2);
  assert.equal(resultado.sucesso, 2);
  assert.ok(resultado.resultados.every(r => r.ok));
  assert.match(ordemRecebida[0], /TABLE IF NOT EXISTS a/);
  assert.match(ordemRecebida[1], /TABLE IF NOT EXISTS b/);
});

test('_diagnosticoEstoqueBigQueryInterno: recusa quem não é administrador', async () => {
  const {_diagnosticoEstoqueBigQueryInterno} = carregar();
  const bq = bigqueryFake();
  await assert.rejects(_diagnosticoEstoqueBigQueryInterno({admin_mestre: false}, bq, firestoreFake()), /permission-denied|administrador/);
});

test('_diagnosticoEstoqueBigQueryInterno: admin — devolve total de linhas cruas, amostra, contagem por tipo_origem, resumo por loja e o teste ao vivo contra a Bluesoft', async () => {
  const {_diagnosticoEstoqueBigQueryInterno} = carregar();
  const bq = bigqueryFake();
  const chamadas = [];
  bq.query = async (opts) => {
    chamadas.push(opts.query);
    if (/COUNT\(\*\) AS total, MIN/.test(opts.query)) return [[{total: 42, data_min: '2026-04-01', data_max: '2026-04-30'}]];
    if (/ORDER BY coletado_em DESC LIMIT 5/.test(opts.query)) return [[{movimento_estoque_key: '1'}]];
    if (/GROUP BY tipo_origem_key/.test(opts.query)) return [[{tipo_origem_key: 9, tipo_origem: 'Inventário', total: 42}]];
    return [[]];
  };
  const fdb = firestoreFake({
    'dt_config/estoque_bluesoft_sync': {porLoja: {loja1: {ultimoDiaConcluido: '2026-04-30', diasComErro: ['2026-04-15']}}},
    'lojas/loja1': {bluesoft_loja_key: '1', nome: 'Matriz'},
    'dt_config/integracao_api': {ambiente: 'producao', url_prd: 'https://exemplo-prd.bluesoft', token: 't'},
  });
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({currentPage: 0, pageSize: 10, data: [{movimentoEstoqueKey: 1}, {movimentoEstoqueKey: 2}]})});
  try {
    const resultado = await _diagnosticoEstoqueBigQueryInterno({admin_mestre: true}, bq, fdb);
    assert.equal(chamadas.length, 4, '3 queries de sempre + 1 nova pra achar um inventario_key de teste');
    assert.equal(resultado.totalLinhas.total, 42);
    assert.equal(resultado.amostra.length, 1);
    assert.equal(resultado.porTipoOrigem[0].tipo_origem, 'Inventário');
    assert.equal(resultado.resumoPorLoja.find(l => l.lojaId === 'loja1').diasComErro[0], '2026-04-15');
    assert.equal(resultado.testeAoVivo.lojaId, 'loja1');
    assert.equal(resultado.testeAoVivo.ambiente, 'producao');
    assert.equal(resultado.testeAoVivo.temToken, true);
    assert.equal(resultado.testeAoVivo.baseUrlHost, 'https://exemplo-prd.bluesoft');
    // PEDIDO AO VIVO (2026-10-03): "tem que ver as permissões na Bluesoft de
    // cada API" — testeAoVivo agora testa os 7 endpoints usados pela coleta
    // de estoque, um por um (status autorizado/sem_permissao/erro/pulado).
    assert.equal(resultado.testeAoVivo.porEndpoint.length, 7);
    const movimentos = resultado.testeAoVivo.porEndpoint.find(e => e.nome === 'Movimentos de estoque (analítico)');
    assert.equal(movimentos.status, 'autorizado');
    // Sem produto_key/inventario_key disponíveis nesta massa de teste, os 3
    // endpoints que precisam de uma chave real ficam "pulado" (não falham).
    const semChave = resultado.testeAoVivo.porEndpoint.filter(e => e.status === 'pulado');
    assert.equal(semChave.length, 3);
  } finally { global.fetch = fetchOriginal; }
});

test('_diagnosticoEstoqueBigQueryInterno: data.lojaId/data.dataBr miram uma loja/data específica em vez do padrão (ontem, 1ª loja)', async () => {
  const {_diagnosticoEstoqueBigQueryInterno} = carregar();
  const bq = bigqueryFake();
  const fdb = firestoreFake({
    'lojas/loja_matriz': {bluesoft_loja_key: '14'},
    'lojas/loja_outra': {bluesoft_loja_key: '99'},
    'dt_config/integracao_api': {ambiente: 'homologacao', url_hml: 'https://exemplo-hml.bluesoft', token: 't'},
  });
  const chamadasFetch = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    chamadasFetch.push(url);
    return {ok: true, status: 200, text: async () => JSON.stringify({data: [{movimentoEstoqueKey: 1}]})};
  };
  try {
    const resultado = await _diagnosticoEstoqueBigQueryInterno({admin_mestre: true}, bq, fdb, {lojaId: 'loja_matriz', dataBr: '15/05/2026'});
    assert.equal(resultado.testeAoVivo.lojaId, 'loja_matriz');
    assert.equal(resultado.testeAoVivo.dataBr, '15/05/2026');
    assert.match(chamadasFetch[0], /lojaKey=14/);
    assert.match(chamadasFetch[0], /dataMovimento=15%2F05%2F2026/);
  } finally { global.fetch = fetchOriginal; }
});

test('_diagnosticoEstoqueBigQueryInterno: teste ao vivo reporta o erro (não derruba o diagnóstico inteiro) se a chamada à Bluesoft falhar', async () => {
  const {_diagnosticoEstoqueBigQueryInterno} = carregar();
  const bq = bigqueryFake();
  const fdb = firestoreFake({
    'lojas/loja1': {bluesoft_loja_key: '1'},
    'dt_config/integracao_api': {ambiente: 'homologacao', url_hml: 'https://exemplo-hml.bluesoft', token: 't'},
  });
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({ok: false, status: 401, text: async () => '{}'});
  try {
    const resultado = await _diagnosticoEstoqueBigQueryInterno({admin_mestre: true}, bq, fdb);
    // Erro de 1 endpoint não derruba o diagnóstico inteiro — cada endpoint
    // reporta o próprio status, 401/403 vira "sem_permissao" (distinto de
    // "erro", pra deixar claro que é falta de liberação na Bluesoft).
    const movimentos = resultado.testeAoVivo.porEndpoint.find(e => e.nome === 'Movimentos de estoque (analítico)');
    assert.equal(movimentos.status, 'sem_permissao');
    assert.equal(movimentos.httpStatus, 401);
    assert.match(movimentos.detalhe, /token inválido/i);
  } finally { global.fetch = fetchOriginal; }
});

test('_diagnosticoEstoqueBigQueryInterno: distingue "sem_permissao" (401/403 — falta liberar na Bluesoft) de "erro" (outra falha, ex. 500) por endpoint', async () => {
  const {_diagnosticoEstoqueBigQueryInterno} = carregar();
  const bq = bigqueryFake();
  const fdb = firestoreFake({
    'lojas/loja1': {bluesoft_loja_key: '1'},
    'dt_config/integracao_api': {ambiente: 'homologacao', url_hml: 'https://exemplo-hml.bluesoft', token: 't'},
  });
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    // Só o endpoint de "tipos" (sem query string) está sem permissão (403);
    // o de movimentos funciona normal; um 3º simula erro de servidor (500).
    if (String(url).includes('/api/estoques/movimentacoesdeestoque/tipos')) return {ok: false, status: 403, text: async () => '{}'};
    if (String(url).includes('/api/estoques/inventarios?')) return {ok: false, status: 500, text: async () => '{"message":"instabilidade"}'};
    return {ok: true, status: 200, text: async () => JSON.stringify({data: []})};
  };
  try {
    const resultado = await _diagnosticoEstoqueBigQueryInterno({admin_mestre: true}, bq, fdb);
    const porNome = Object.fromEntries(resultado.testeAoVivo.porEndpoint.map(e => [e.nome, e]));
    assert.equal(porNome['Movimentos de estoque (analítico)'].status, 'autorizado');
    assert.equal(porNome['Tipos de movimento de estoque'].status, 'sem_permissao');
    assert.equal(porNome['Tipos de movimento de estoque'].httpStatus, 403);
    assert.equal(porNome['Inventários (cabeçalho)'].status, 'erro', '500 não é problema de permissão — não pode virar "sem_permissao"');
    assert.equal(porNome['Inventários (cabeçalho)'].httpStatus, 500);
  } finally { global.fetch = fetchOriginal; }
});

test('_aplicarSchemaEstoqueBigQueryInterno: 1 statement falhando não trava os seguintes — cada resultado reporta certo (ok/erro)', async () => {
  const {_aplicarSchemaEstoqueBigQueryInterno} = carregar();
  const bq = bigqueryFake();
  bq.query = async (opts) => {
    if (/EXISTS a /.test(opts.query)) throw new Error('Not found: Dataset');
    return [[]];
  };
  const sql = 'CREATE TABLE IF NOT EXISTS a (x INT64);\nCREATE TABLE IF NOT EXISTS b (y INT64);';
  const resultado = await _aplicarSchemaEstoqueBigQueryInterno({admin_mestre: true}, bq, sql);
  assert.equal(resultado.total, 2);
  assert.equal(resultado.sucesso, 1);
  assert.equal(resultado.resultados[0].ok, false);
  assert.match(resultado.resultados[0].erro, /Not found/);
  assert.equal(resultado.resultados[1].ok, true, 'statement seguinte ainda roda mesmo com o anterior falhando');
});
