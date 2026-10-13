'use strict';
// RECONSTRUÇÃO (2026-10-08): apontamentoConfirmarPcpManual e
// buscarAnaliseInventariosBigQuery existiam em produção, mas sumiram do
// código-fonte local numa edição anterior sem redeploy (nenhum backup/zip
// nem o histórico desta conversa tinha o original — ver investigação na
// mesma sessão). Reconstruídas a partir da descrição funcional já registrada
// e do contrato exato que o front espera. Estes testes travam esse contrato.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function carregar() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', {value: () => ({}), configurable: true});
  return require(path.join(__dirname, '..', 'index.js'));
}

function bigqueryFake() {
  const chamadasQuery = [];
  return {
    _chamadasQuery: chamadasQuery,
    query: async (opts) => { chamadasQuery.push(opts); return [[]]; },
  };
}

function firestoreFake(seed) {
  const dados = new Map(Object.entries(seed || {}));
  function docRef(caminho) {
    return {
      id: caminho.split('/').pop(),
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

// ═══════════════════════════════════════════════════════════════════════
// buscarAnaliseInventariosBigQuery (_buscarAnaliseInventariosBigQueryInterno)
// ═══════════════════════════════════════════════════════════════════════

test('_buscarAnaliseInventariosBigQueryInterno: recusa loja sem permissão', async () => {
  const {_buscarAnaliseInventariosBigQueryInterno} = carregar()._estoqueBluesoftInternals;
  const acesso = {lojas_permitidas: ['outraLoja']};
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});
  await assert.rejects(
    _buscarAnaliseInventariosBigQueryInterno({lojaId: 'loja1'}, acesso, bigqueryFake(), fdb),
    /permission-denied|Sem acesso/
  );
});

test('_buscarAnaliseInventariosBigQueryInterno: devolve release correta (gate de versão do front) e agrega inventarios/produtos/lojas', async () => {
  const {_buscarAnaliseInventariosBigQueryInterno, ANALISE_INVENTARIOS_RELEASE} = carregar()._estoqueBluesoftInternals;
  const acesso = {acesso_todas_lojas: true};
  const bq = bigqueryFake();
  const chamadas = [];
  bq.query = async (opts) => {
    chamadas.push(opts);
    if (/GROUP BY it\.produto_key/.test(opts.query)) {
      return [[{produto_key: 'p1', produto_descricao: 'Produto 1', perda_quantidade: 2, ganho_quantidade: 0, perda_valor: 20, ganho_valor: 0, inventarios_divergentes: 1}]];
    }
    return [[{
      inventario_key: 'INV1', loja_key: '1', inventario_numero: '10', inventario_descricao: 'Inventário 10',
      status: 'FECHADO', data_abertura: {value: '2026-04-01T00:00:00'}, data_fechamento: {value: '2026-04-02T00:00:00'},
      produtos_total: 10, produtos_corretos: 8, produtos_perda: 1, produtos_ganho: 1, produtos_sem_dados: 0,
      perda_quantidade: 2, ganho_quantidade: 3, perda_valor: 20, ganho_valor: 30, coletado_em: {value: '2026-04-02T10:00:00'}
    }]];
  };
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1', nome: 'Loja 1'}});
  const resultado = await _buscarAnaliseInventariosBigQueryInterno({}, acesso, bq, fdb);

  assert.equal(resultado.release, ANALISE_INVENTARIOS_RELEASE);
  assert.equal(resultado.inventarios.length, 1);
  assert.equal(resultado.inventarios[0].loja_id, 'loja1', 'enriquece com o id da loja a partir do bluesoft_loja_key cru');
  assert.equal(resultado.inventarios[0].acuracidade_itens, 80, '8 de 10 produtos corretos = 80%');
  assert.equal(resultado.produtos.length, 1);
  assert.equal(resultado.produtos[0].produto_key, 'p1');
  assert.deepEqual(resultado.historicoProdutos, [], 'documentado como simplificação — front trata array vazio defensivamente');
  assert.equal(resultado.lojas.length, 1);
  assert.equal(resultado.lojas[0].id, 'loja1');
  assert.equal(resultado.atualizadoEm, '2026-04-02T10:00:00');
  // GROUP BY nos dois selects de agregação, sempre filtrando status FECHADO
  assert.ok(chamadas.every(c => /status = 'FECHADO'/.test(c.query)));
});

test('_buscarAnaliseInventariosBigQueryInterno: modo "inventario" exige inventarioKey e lojaId, e nunca consulta a Bluesoft ao vivo (fonte != bluesoft-live)', async () => {
  const {_buscarAnaliseInventariosBigQueryInterno} = carregar()._estoqueBluesoftInternals;
  const acesso = {acesso_todas_lojas: true};
  const fdb = firestoreFake({'lojas/loja1': {bluesoft_loja_key: '1'}});

  await assert.rejects(
    _buscarAnaliseInventariosBigQueryInterno({modo: 'inventario', lojaId: 'loja1'}, acesso, bigqueryFake(), fdb),
    /inventarioKey/
  );
  await assert.rejects(
    _buscarAnaliseInventariosBigQueryInterno({modo: 'inventario', inventarioKey: 'INV1'}, acesso, bigqueryFake(), fdb),
    /lojaId/
  );

  const bq = bigqueryFake();
  bq.query = async (opts) => {
    if (/FROM `dt_relatorios\.estoque_inventario_itens` it\s*$/m.test(opts.query) || /LEFT JOIN `dt_relatorios\.estoque_produtos`/.test(opts.query)) {
      return [[{produto_key: 'p1', produto_descricao: 'Produto 1', quantidade_contada: 8, quantidade_sistema: 10, custo_liquido: 10, diferenca_quantidade: -2, diferenca_valor: -20}]];
    }
    return [[{inventario_key: 'INV1', loja_key: '1', produtos_total: 1, produtos_corretos: 0, produtos_perda: 1, produtos_ganho: 0, produtos_sem_dados: 0}]];
  };
  const resultado = await _buscarAnaliseInventariosBigQueryInterno({modo: 'inventario', inventarioKey: 'INV1', lojaId: 'loja1'}, acesso, bq, fdb);
  assert.equal(resultado.itens.length, 1);
  assert.equal(resultado.itens[0].dados_validos, true);
  assert.notEqual(resultado.fonte, 'bluesoft-live', 'reconstrução não revalida ao vivo na Bluesoft — nunca pode se passar por isso');
  assert.equal(resultado.inventario.loja_id, 'loja1');
});

// ═══════════════════════════════════════════════════════════════════════
// apontamentoConfirmarPcpManual — sem harness de onCall neste projeto pra
// este grupo de functions (AP_*); trava os invariantes críticos no próprio
// código-fonte, mesmo padrão já usado nos testes de público (front) desta
// sessão quando não há como montar um Firestore fake completo com runTransaction.
// ═══════════════════════════════════════════════════════════════════════
test('apontamentoConfirmarPcpManual: existe, é admin/"configurar"-only e NUNCA chama a Bluesoft (não reenvia o PCP)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const i = src.indexOf('exports.apontamentoConfirmarPcpManual');
  assert.ok(i >= 0, 'função não encontrada em functions/index.js');
  const fim = src.indexOf('\n});', i) + 4;
  const corpo = src.slice(i, fim);
  assert.match(corpo, /_apRequire\(acesso,'configurar'\)/);
  assert.doesNotMatch(corpo, /_apBluesoftPost|_apEnviarParaBluesoft/, 'nunca pode acionar o envio/POST à BlueSoft — só confirma status já existente');
  assert.match(corpo, /String\(d\.status\)==='PROCESSANDO'&&String\(integ\.endpoint\|\|''\)==='\/api\/pcp\/apontamento-producao'&&!integ\.requestId/,
    'critério de elegibilidade exato: PROCESSANDO + endpoint síncrono + sem requestId');
  assert.match(corpo, /await _apMarcarWms\(ref\)/, 'dispara a etapa WMS depois de confirmar');
  assert.match(corpo, /corrigidas\.push\(capa\)/);
  assert.match(corpo, /ignoradas\.push\(\{capa,motivo:/);
  assert.match(corpo, /return \{corrigidas,ignoradas\}/, 'contrato exato que 127-estoque-apontamento.js espera (r.corrigidas[]/r.ignoradas[].motivo)');
});
