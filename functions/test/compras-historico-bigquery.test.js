'use strict';
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
  return require(path.join(__dirname, '..', 'index.js'))._graphBiInternals;
}

function bqQueryFake(linhas) {
  const chamadas = [];
  return { _chamadas: chamadas, query: async opts => { chamadas.push(opts); return [linhas]; } };
}

test('Histórico de Compras: BigQuery recebe período na própria consulta, não filtra depois no navegador', async () => {
  const {_buscarHistoricoComprasBigQueryInterno} = carregar();
  const bq = bqQueryFake([{chave:'1', data_emissao:'2026-09-10'}]);
  const linhas = await _buscarHistoricoComprasBigQueryInterno({inicio:'2026-09-01', fim:'2026-09-12', lojaKey:'1', tipoOperacao:'COMPRA'}, bq);
  assert.equal(linhas.length, 1);
  const c = bq._chamadas[0];
  assert.match(c.query, /compras_historico/);
  assert.match(c.query, /BETWEEN @inicio AND @fim/);
  assert.match(c.query, /loja_key=@lojaKey/);
  assert.equal(c.params.inicio, '2026-09-01');
  assert.equal(c.params.fim, '2026-09-12');
  assert.equal(c.params.lojaKey, '1');
});

test('Dashboard de Compras: uma consulta devolve KPIs, séries e rankings agregados', async () => {
  const {_buscarResumoComprasDashboardBigQueryInterno} = carregar();
  const resumoEsperado = {compradoNoMes:100, compradoNoAno:1000, nPedidos:5, valorTotal:1000, porMes:[{mes:'2026-09',valor:100}], topProdutos:[], topFornecedores:[], maisSubiram:[], maisCairam:[]};
  const bq = bqQueryFake([resumoEsperado]);
  const resumo = await _buscarResumoComprasDashboardBigQueryInterno(bq);
  assert.equal(resumo.nPedidos, 5);
  const q = bq._chamadas[0].query;
  assert.match(q, /COUNT\(DISTINCT nf_numero\)/);
  assert.match(q, /topProdutos/i);
  assert.match(q, /MRO/);
  // PEDIDO AO VIVO (2026-09-18): "Compras por mês (quantidade)" do
  // Dashboard do PCP lia pcp_requisicoes_compra (solicitação manual);
  // agora reaproveita este MESMO resumo, que precisa trazer a
  // quantidade por mês além do valor (não só valor).
  assert.match(q, /SUM\(quantidade_faturada\) qtd.*porMes|porMes.*SUM\(quantidade_faturada\) qtd/s);
  assert.match(q, /LOGISTICA/);
});

test('Dashboard de Recebimento: BigQuery devolve somente os 14 meses agregados da loja', async () => {
  const {_buscarResumoRecebimentoComprasBigQueryInterno} = carregar();
  const bq = bqQueryFake([{mes:'2026-09', notas:10, valor:2000}, {mes:'2026-08', notas:8, valor:1500}]);
  const linhas = await _buscarResumoRecebimentoComprasBigQueryInterno({lojaKey:'7'}, {}, bq);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].mes, '2026-08', 'a função entrega cronológico crescente para o gráfico');
  const c = bq._chamadas[0];
  assert.match(c.query, /COUNT\(DISTINCT CONCAT/);
  assert.match(c.query, /LIMIT 14/);
  assert.equal(c.params.lojaKey, '7');
});

// PEDIDO AO VIVO (2026-09-18): "eu não quero ter que ir lá e pegar produto
// por produto... pega o histórico e cadastra no nome da pessoa que mais
// compra" — sugestão automática de comprador por fornecedor, agregada no
// próprio BigQuery (nunca soma mais de 1000 fornecedores no navegador).
test('Sugestão de regras de comprador: agrega por fornecedor x comprador e aponta quem mais comprou de cada um (por valor)', async () => {
  const {_sugerirRegrasCompradorPorFornecedorBigQueryInterno} = carregar();
  const bq = bqQueryFake([
    {
      chave: 'Ebrali Embalagens', totalValor: 10000, totalQtd: 500,
      compradores: [
        {compradorChave: 'fabricio', compradorNomeOriginal: 'Fabricio Silva', qtd: 400, valor: 8000, notas: 12},
        {compradorChave: 'dilma', compradorNomeOriginal: 'Dilma Souza', qtd: 100, valor: 2000, notas: 3},
      ],
    },
    {
      chave: 'Fornecedor Sem Maioria Clara', totalValor: 1000, totalQtd: 100,
      compradores: [
        {compradorChave: 'joao', compradorNomeOriginal: 'Joao', qtd: 51, valor: 510, notas: 2},
        {compradorChave: 'maria', compradorNomeOriginal: 'Maria', qtd: 49, valor: 490, notas: 2},
      ],
    },
  ]);
  const fornecedores = await _sugerirRegrasCompradorPorFornecedorBigQueryInterno({}, bq);
  assert.equal(fornecedores.length, 2);
  assert.equal(fornecedores[0].fornecedor, 'Ebrali Embalagens');
  assert.equal(fornecedores[0].sugerido.compradorChave, 'fabricio');
  assert.equal(fornecedores[0].sugerido.compradorNome, 'Fabricio Silva');
  assert.equal(Math.round(fornecedores[0].sugerido.participacaoPct), 80, 'Fabricio ficou com 8000 dos 10000 (80%)');
  assert.equal(Math.round(fornecedores[1].sugerido.participacaoPct), 51);

  const c = bq._chamadas[0];
  assert.match(c.query, /compras_historico/);
  assert.match(c.query, /GROUP BY chave, compradorChave/);
  assert.match(c.query, /INTERVAL 24 MONTH/);
  assert.match(c.query, /UPPER\(tipo_operacao\) = 'COMPRA'/);
});

test('Sugestão de regras de comprador: fornecedor sem nenhum comprador identificado no histórico não sugere ninguém (não trava)', async () => {
  const {_sugerirRegrasCompradorPorFornecedorBigQueryInterno} = carregar();
  const bq = bqQueryFake([{chave: 'Fornecedor Sem Comprador', totalValor: 500, totalQtd: 20, compradores: []}]);
  const fornecedores = await _sugerirRegrasCompradorPorFornecedorBigQueryInterno({}, bq);
  assert.equal(fornecedores[0].sugerido, null);
});

// PEDIDO AO VIVO (2026-09-18, correção): "o comprador de fubá mimoso é
// Dilma, aí no sistema muda pra Marta — o sistema tem que identificar e
// alterar sozinho" — a MESMA agregação, só que por PRODUTO em vez de
// fornecedor (um fornecedor pode vender produtos de compradores
// diferentes; fornecedor sozinho não é preciso o bastante).
test('Sugestão de regras de comprador POR PRODUTO: mesma agregação, mas agrupada por produto_key (não por fornecedor)', async () => {
  const {_sugerirRegrasCompradorPorProdutoBigQueryInterno} = carregar();
  const bq = bqQueryFake([
    {
      chave: '30421', totalValor: 4000, totalQtd: 200,
      compradores: [{compradorChave: 'marta', compradorNomeOriginal: 'Marta Lima', qtd: 180, valor: 3800, notas: 9}],
    },
  ]);
  const produtos = await _sugerirRegrasCompradorPorProdutoBigQueryInterno({}, bq);
  assert.equal(produtos[0].produtoKey, '30421');
  assert.equal(produtos[0].sugerido.compradorNome, 'Marta Lima');
  const c = bq._chamadas[0];
  assert.match(c.query, /produto_key AS chave/);
  assert.match(c.query, /GROUP BY chave, compradorChave/);
});

// PEDIDO AO VIVO (2026-09-18): "escrevo farofa e ele traz toda a família
// junto" — sugestão de produto real pra Análise de Preços, sem misturar
// variantes num texto solto (o app depois busca por produtoKey exato).
test('Busca de produtos (autocomplete Análise de Preços): filtra por LIKE na descrição, limita a 20, ordena pelo mais movimentado', async () => {
  const { _buscarProdutosComprasBigQueryInterno } = carregar();
  const bq = bqQueryFake([
    { produtoKey: '101', descricao: 'Farofa Tradicional 500g', notas: 40 },
    { produtoKey: '102', descricao: 'Farofa Pronta Bacon 500g', notas: 12 },
  ]);
  const produtos = await _buscarProdutosComprasBigQueryInterno({ busca: 'farofa' }, bq);
  assert.equal(produtos.length, 2);
  assert.equal(produtos[0].produtoKey, '101');
  const c = bq._chamadas[0];
  assert.match(c.query, /LIKE @busca/);
  assert.match(c.query, /LIMIT 20/);
  assert.equal(c.params.busca, '%farofa%');
});

test('Busca de produtos: texto curto demais (menos de 2 letras) nem consulta o BigQuery — devolve vazio direto', async () => {
  const { _buscarProdutosComprasBigQueryInterno } = carregar();
  const bq = bqQueryFake([]);
  const produtos = await _buscarProdutosComprasBigQueryInterno({ busca: 'f' }, bq);
  assert.equal(produtos.length, 0);
  assert.equal(bq._chamadas.length, 0);
});

// PEDIDO AO VIVO (2026-09-18): "Produtos 360° só mostra produto de
// produção, não mostra matéria-prima comprada... os números têm que ser
// do arquivo real, não da solicitação do PCP".
test('Resumo de produtos comprados (Produtos 360°): última compra por produto REAL, direto do histórico (não da solicitação do PCP)', async () => {
  const { _buscarResumoProdutosComprasBigQueryInterno } = carregar();
  const bq = bqQueryFake([
    { produtoKey: '55001', descricao: 'Fita Adesiva 48mm', numCompras: 6, ultima: { data_emissao: '2026-09-10', nome_abreviado: 'Embalagens SA', custo_liq_unit: 3.2, comprador_nome: 'Fabricio Silva' } },
  ]);
  const produtos = await _buscarResumoProdutosComprasBigQueryInterno({}, bq);
  assert.equal(produtos[0].produtoKey, '55001');
  assert.equal(produtos[0].ultimaData, '2026-09-10');
  assert.equal(produtos[0].ultimoFornecedor, 'Embalagens SA');
  assert.equal(produtos[0].ultimoPreco, 3.2);
  const c = bq._chamadas[0];
  assert.match(c.query, /GROUP BY produto_key/);
  assert.match(c.query, /ORDER BY data_emissao DESC LIMIT 1/);
});

test('Resumo de produtos comprados: filtro de comprador (mesmo padrão do resumo do Dashboard) restringe direto no BigQuery', async () => {
  const { _buscarResumoProdutosComprasBigQueryInterno } = carregar();
  const bq = bqQueryFake([]);
  await _buscarResumoProdutosComprasBigQueryInterno({ compradores: ['fabricio'] }, bq);
  const c = bq._chamadas[0];
  assert.match(c.query, /REGEXP_EXTRACT\(IFNULL\(comprador_nome,''\)/);
  assert.deepEqual(c.params.compradores, ['fabricio']);
});

test('Sincronização: gera NDJSON e usa WRITE_TRUNCATE na tabela histórica', async () => {
  const {_sincronizarComprasHistoricoBigQuery} = carregar();
  let metadata = null; let conteudo = '';
  const fake = {
    dataset: id => ({ table: nome => ({ load: async (arquivo, meta) => { metadata = meta; conteudo = fs.readFileSync(arquivo, 'utf8'); return [{}]; } }) })
  };
  const r = await _sincronizarComprasHistoricoBigQuery([{nota_fiscal_item_key:123, loja_key:1, data_emissao:'2026-09-01', nf_numero:55, produto_key:304, descricao:'Tapioca', quantidade_faturada:2, custo_liq_unit:3, Custo_liquido_total:6, TIPO_OPERACAO:'COMPRA'}], fake);
  assert.equal(r.ok, true);
  assert.equal(metadata.writeDisposition, 'WRITE_TRUNCATE');
  assert.equal(metadata.sourceFormat, 'NEWLINE_DELIMITED_JSON');
  assert.match(conteudo, /"chave":"123"/);
  assert.match(conteudo, /"tipo_operacao":"COMPRA"/);
});
