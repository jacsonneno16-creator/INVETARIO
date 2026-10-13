'use strict';
// Logística › Estoque › Relatórios — Fase B. Este arquivo NÃO roda SQL de
// verdade contra o BigQuery (não temos acesso a BigQuery de produção nem
// emulador pra isso — _obterBigQueryCliente() bloqueia justamente o
// emulador, de propósito, em functions/index.js). O que dá pra travar sem
// infra nenhuma: que o SQL entregue bate EXATAMENTE com a tabela de
// classificação confirmada com dados reais no plano — nenhum código a
// mais, nenhum a menos, nenhuma linha duplicada/conflitante, e que a view
// de transformação e o CFOP 5949 seguem as regras documentadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'estoque-relatorios-schema.sql'), 'utf8');

// Mesma tabela do plano/spec, transcrita uma única vez aqui — se o SQL
// divergir desta lista (por edição futura descuidada), o teste quebra.
const ESPERADO = {
  INVENTARIO: {
    lancamentos: [801, 802, 806, 930, 931, 821, 823, 803, 804, 932, 933, 825, 828],
    estornos: [811, 812, 805, 934, 935, 822, 824, 809, 810, 936, 937, 826, 827],
  },
  DESCARTE: { lancamentos: [410, 942], estornos: [430, 947] },
  REQUISICAO: { lancamentos: [352], estornos: [362] },
  TRANSFORMACAO: { lancamentos: [354, 304, 359, 389, 356, 860], estornos: [364, 314, 358, 388, 357, 861] },
};

function extrairClassificacaoDoSql(texto) {
  const inicio = texto.indexOf('INSERT INTO `daterrinha-inventario.dt_relatorios.estoque_classificacao`');
  assert.ok(inicio > -1, 'não encontrei o INSERT de estoque_classificacao — ajuste este teste se o arquivo mudou de formato');
  const fim = texto.indexOf(';', inicio);
  const trecho = texto.slice(inicio, fim);
  const linhas = [];
  const re = /\((\d+),\s*'([A-Z]+)',\s*(TRUE|FALSE)\)/g;
  let m;
  while ((m = re.exec(trecho))) linhas.push({ codigo: Number(m[1]), operacao: m[2], ehEstorno: m[3] === 'TRUE' });
  return linhas;
}

test('estoque_classificacao: todo código esperado (lançamento ou estorno) está presente, com a operação e o eh_estorno certos', () => {
  const linhas = extrairClassificacaoDoSql(sql);
  const porCodigo = new Map(linhas.map(l => [l.codigo, l]));
  for (const [operacao, grupos] of Object.entries(ESPERADO)) {
    for (const codigo of grupos.lancamentos) {
      const achado = porCodigo.get(codigo);
      assert.ok(achado, `código ${codigo} (${operacao}, lançamento) não encontrado no SQL`);
      assert.equal(achado.operacao, operacao, `código ${codigo} deveria ser ${operacao}`);
      assert.equal(achado.ehEstorno, false, `código ${codigo} é lançamento, não pode estar marcado como estorno`);
    }
    for (const codigo of grupos.estornos) {
      const achado = porCodigo.get(codigo);
      assert.ok(achado, `código ${codigo} (${operacao}, estorno) não encontrado no SQL`);
      assert.equal(achado.operacao, operacao, `código ${codigo} deveria ser ${operacao}`);
      assert.equal(achado.ehEstorno, true, `código ${codigo} é estorno, precisa estar marcado TRUE`);
    }
  }
});

test('estoque_classificacao: nenhum código fora da lista confirmada (nenhuma invenção) e nenhum duplicado/conflitante', () => {
  const linhas = extrairClassificacaoDoSql(sql);
  const esperados = new Set();
  Object.values(ESPERADO).forEach(g => { g.lancamentos.forEach(c => esperados.add(c)); g.estornos.forEach(c => esperados.add(c)); });

  const vistos = new Map();
  linhas.forEach(l => {
    assert.ok(esperados.has(l.codigo), `código ${l.codigo} aparece no SQL mas não está na lista confirmada — de onde veio?`);
    if (vistos.has(l.codigo)) {
      const anterior = vistos.get(l.codigo);
      assert.deepEqual(l, anterior, `código ${l.codigo} aparece 2x com classificações DIFERENTES — conflito`);
    }
    vistos.set(l.codigo, l);
  });
  assert.equal(linhas.length, esperados.size, 'quantidade de linhas no INSERT precisa bater com a quantidade de códigos confirmados (sem duplicata)');
});

test('CFOP 5949: NÃO tem nenhum tipo_movimento_key classificado — pendência documentada, não inventada', () => {
  // 5949 não é um tipo_movimento_key, é um CFOP de nota — a regra real é
  // "nenhum código novo foi adicionado por causa dele". Confirma que o
  // comentário de pendência existe e que a tabela de classificação não tem
  // nenhuma entrada fora da lista confirmada (já coberto acima), e reforça
  // que o 5949 está documentado como pendente no próprio arquivo.
  // Texto quebra em várias linhas de comentário "-- " no .sql — tolera
  // qualquer coisa (inclusive o prefixo "--    " da linha seguinte) entre
  // as palavras-chave, em vez de exigir um espaço único contíguo.
  assert.match(sql, /5\.?949[\s\S]{0,400}não se sabe que[\s\S]{0,30}tipo_movimento_key/i);
});

test('942 (Descarte): a view NUNCA infere sentido quando saldo_anterior = saldo_posterior', () => {
  const inicioCreate = sql.indexOf('CREATE OR REPLACE VIEW `daterrinha-inventario.dt_relatorios.vw_estoque_rel_descarte`');
  assert.ok(inicioCreate > -1);
  const fimView = sql.indexOf('CREATE OR REPLACE VIEW', inicioCreate + 1);
  const trecho = sql.slice(inicioCreate, fimView === -1 ? sql.length : fimView);
  assert.match(trecho, /saldo_anterior\s*=\s*m\.saldo_posterior.*sem variação de saldo/s);
});

test('view de transformação: liga SAÍDA e ENTRADA por produto_origem + mesma loja + mesmo dia + poucos segundos de diferença (nunca por acaso)', () => {
  const inicio = sql.indexOf('vw_estoque_rel_transformacao');
  assert.ok(inicio > -1);
  const trecho = sql.slice(inicio);
  assert.match(trecho, /e\.produto_origem\s*=\s*s\.produto_key/);
  assert.match(trecho, /e\.loja_key\s*=\s*s\.loja_key/);
  assert.match(trecho, /e\.data_movimento\s*=\s*s\.data_movimento/);
  assert.match(trecho, /TIMESTAMP_DIFF/);
  assert.match(trecho, /sem_par/, 'saída sem entrada correspondente precisa ficar marcada, não desaparecer');
});

test('as 4 views do spec existem, uma pra cada relatório', () => {
  ['vw_estoque_rel_inventario', 'vw_estoque_rel_descarte', 'vw_estoque_rel_requisicao', 'vw_estoque_rel_transformacao'].forEach(nome => {
    assert.match(sql, new RegExp('CREATE OR REPLACE VIEW `daterrinha-inventario\\.dt_relatorios\\.' + nome + '`'));
  });
});

test('todas as tabelas usam IF NOT EXISTS (migração idempotente — rodar o arquivo 2x não quebra)', () => {
  const tabelas = ['estoque_movimentos', 'estoque_tipos_movimento', 'estoque_inventarios', 'estoque_inventario_itens', 'estoque_notas_baixa', 'estoque_produtos', 'estoque_classificacao'];
  tabelas.forEach(nome => {
    assert.match(sql, new RegExp('CREATE TABLE IF NOT EXISTS `daterrinha-inventario\\.dt_relatorios\\.' + nome + '`'), `${nome} precisa ser CREATE TABLE IF NOT EXISTS`);
  });
});

test('estoque_movimentos: particionada por data_movimento e clusterizada por loja_key, tipo_movimento_key, produto_key', () => {
  const inicio = sql.indexOf('CREATE TABLE IF NOT EXISTS `daterrinha-inventario.dt_relatorios.estoque_movimentos`');
  // Não corta no 1º ";" — tem comentário inline de coluna com ";" dentro do
  // texto ("...Bluesoft); sentido = ..."), que não é o fim do statement.
  // Janela fixa generosa em vez disso (o statement inteiro cabe bem dentro).
  const trecho = sql.slice(inicio, inicio + 1800);
  assert.match(trecho, /PARTITION BY data_movimento/);
  assert.match(trecho, /CLUSTER BY loja_key, tipo_movimento_key, produto_key/);
});
