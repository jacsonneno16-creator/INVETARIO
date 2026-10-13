'use strict';
// CORREÇÃO REAL (2026-10-08) — Endereçamento de Paletes: a V13 só aceitava o
// endereço físico quando ele era IDÊNTICO ao destino sugerido pela BlueSoft
// pra aquele palete específico (enderecoDeDestino/enderecoDeDestinoKey de
// GET /api/wms/enderecamento-de-paletes). Isso bloqueava os 42 paletes do
// pedido ao vivo sempre que o destino desejado era diferente da sugestão —
// mas a sugestão do WMS é só uma recomendação pra UM palete, não a lista de
// endereços válidos da loja, e a API confirma isso: o schema do POST real
// (EnderecamentoPaletesForm) exige `novoEndereco` (integer, a chave), sem
// nenhum campo de "capacidade" — quem decide elegibilidade/capacidade é a
// própria BlueSoft no POST (409/422), nunca uma pré-validação nossa.
//
// Fonte real de correspondência endereço físico ↔ chave: já confirmada no
// schema AjusteEstoqueLogisticoResponse (campos enderecoLogisticoKey +
// enderecoLogisticoDescritivo) e já usada em produção por
// 90-bluesoft-service.js (GET /api/wms/ajuste-estoque-logistico?lojaKey=).
// É um catálogo de endereços da LOJA, não do palete — por isso resolve
// qualquer endereço físico válido da loja, não só o sugerido.
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

function comFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { global.fetch = original; });
}

const CFG = {ambiente: 'homologacao', url_hml: 'https://x', token: 't'};

test('_eopCatalogoEnderecosLogisticos: monta o mapa descritivo→chave a partir de /api/wms/ajuste-estoque-logistico', async () => {
  const {_eopCatalogoEnderecosLogisticos} = carregar();
  await comFetch(async (url) => {
    assert.match(String(url), /\/api\/wms\/ajuste-estoque-logistico\?lojaKey=7/);
    return {ok: true, status: 200, text: async () => JSON.stringify([
      {enderecoLogisticoKey: 960, enderecoLogisticoDescritivo: '14.1564.1.1.1.5.1'},
      {enderecoLogisticoKey: 123, enderecoLogisticoDescritivo: '14.1520.1.11.26.1.1'},
    ])};
  }, async () => {
    const catalogo = await _eopCatalogoEnderecosLogisticos(CFG, '7');
    assert.equal(catalogo.get('14.1564.1.1.1.5.1'), 960);
    assert.equal(catalogo.get('14.1520.1.11.26.1.1'), 123);
    assert.equal(catalogo.size, 2);
  });
});

test('_eopCatalogoEnderecosLogisticos: ignora linha sem descritivo ou sem chave numérica válida, sem derrubar o catálogo', async () => {
  const {_eopCatalogoEnderecosLogisticos} = carregar();
  await comFetch(async () => ({ok: true, status: 200, text: async () => JSON.stringify([
    {enderecoLogisticoKey: 960, enderecoLogisticoDescritivo: ''},
    {enderecoLogisticoKey: 'abc', enderecoLogisticoDescritivo: '14.1.1.1'},
    {enderecoLogisticoKey: 55, enderecoLogisticoDescritivo: '14.2.2.2'},
  ])}), async () => {
    const catalogo = await _eopCatalogoEnderecosLogisticos(CFG, '7');
    assert.equal(catalogo.size, 1);
    assert.equal(catalogo.get('14.2.2.2'), 55);
  });
});

test('_eopCatalogoEnderecosLogisticos: resposta em formato inesperado recusa explicitamente (nunca finge catálogo vazio)', async () => {
  const {_eopCatalogoEnderecosLogisticos} = carregar();
  await comFetch(async () => ({ok: true, status: 200, text: async () => JSON.stringify({mensagem: 'algo inesperado'})}), async () => {
    await assert.rejects(_eopCatalogoEnderecosLogisticos(CFG, '7'), /ajuste-estoque-logistico.*formato reconhecido/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Trava de contrato: o bloqueio por "destino diferente do sugerido" foi
// REMOVIDO de propósito (era o bug). Confirma que não voltou, e que o
// catálogo é a fonte real usada para resolver endereço físico ≠ sugerido.
// ═══════════════════════════════════════════════════════════════════════
test('prevalidarEstoqueArquivo: NÃO bloqueia mais só por o destino divergir da sugestão do WMS — resolve pelo catálogo da loja', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const i = src.indexOf("exports.prevalidarEstoqueArquivo");
  const fim = src.indexOf('\n});', i) + 4;
  const corpo = src.slice(i, fim);
  assert.doesNotMatch(corpo, /Destino não corresponde ao sugerido pela BlueSoft/, 'essa mensagem/bloqueio era o bug — não pode reaparecer');
  assert.doesNotMatch(corpo, /BlueSoft não indicou enderecoDeDestinoKey; endereço não pode ser pré-confirmado/, 'sugestão ausente não pode mais bloquear sozinha');
  assert.match(corpo, /_eopCatalogoEnderecosLogisticos\(cfg,loja\.bluesoftLojaKey\)/);
  assert.match(corpo, /catalogo\.get\(informado\)/);
});

test('enderecarPaletesArquivo: o gate final antes do POST não exige mais igualdade com o destino sugerido — só confirma que o palete existe', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const i = src.indexOf("exports.enderecarPaletesArquivo");
  const fim = src.indexOf('\n});', i) + 4;
  const corpo = src.slice(i, fim);
  assert.doesNotMatch(corpo, /enderecoDeDestinoKey.*!==.*enderecoLogisticoKey|endereço diferente do destino sugerido pelo WMS/, 'essa trava era o bug — bloqueava o POST mesmo depois da pré-validação aprovar');
  assert.match(corpo, /palete não encontrado em consulta WMS paginada/, 'continua confirmando que o palete existe antes do POST');
});

// ═══════════════════════════════════════════════════════════════════════
// Idempotência do lote agrupado de trocas (_eopExecutarTrocaAgrupadaUmaVez) —
// cobertura reequilibrada aqui porque o mock original entregue (vm +
// extração de texto) dependia da sintaxe exata de trechos que mudaram nesta
// correção; reescrita no padrão node:test já usado no resto do projeto,
// mesmo comportamento: sucesso agrupado, duplicidade não reenvia POST,
// resultado incerto também não reenvia (exige conferência manual).
// ═══════════════════════════════════════════════════════════════════════
function firestoreFakeComTransacao() {
  const dados = new Map();
  function docRef(id) {
    return {
      id,
      get: async () => ({exists: dados.has(id), data: () => dados.get(id)}),
      update: async (valor) => { dados.set(id, Object.assign({}, dados.get(id), valor)); },
    };
  }
  const firestoreFn = () => ({
    collection: () => ({doc: (id) => docRef(id)}),
    runTransaction: async (fn) => {
      const pendentes = [];
      const tx = {
        get: async (ref) => ({exists: dados.has(ref.id), data: () => dados.get(ref.id)}),
        create: (ref, valor) => pendentes.push([ref.id, valor]),
      };
      const resultado = await fn(tx);
      pendentes.forEach(([id, valor]) => dados.set(id, valor));
      return resultado;
    },
    batch: () => {
      const operacoes = [];
      return {
        update: (ref, valor) => operacoes.push([ref.id, valor]),
        commit: async () => operacoes.forEach(([id, valor]) => dados.set(id, Object.assign({}, dados.get(id), valor))),
      };
    },
  });
  firestoreFn.FieldValue = {serverTimestamp: () => 'FAKE_TIMESTAMP'};
  return firestoreFn;
}

function carregarComFirestore() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', {value: firestoreFakeComTransacao(), configurable: true});
  return require(path.join(__dirname, '..', 'index.js'))._estoqueBluesoftInternals;
}

test('_eopExecutarTrocaAgrupadaUmaVez: 1ª execução faz 1 POST agrupado com todos os produtos do lote', async () => {
  const {_eopExecutarTrocaAgrupadaUmaVez} = carregarComFirestore();
  let chamadasPost = 0;
  const cfgFake = {_post: null};
  const linhas = [{gtin: 1, quantidade: 3, motivoTrocaKey: 1, setorOperacionalKey: 1}, {gtin: 2, quantidade: 5, motivoTrocaKey: 1, setorOperacionalKey: 1}];
  const data = {operacaoId: 'operacao-teste-0001', indices: [0, 1]};
  const loja = {id: 'loja1', bluesoftLojaKey: 7};
  // _eopExecutarTrocaAgrupadaUmaVez chama _eopPost por dentro (função real do módulo,
  // que por sua vez chama _apBluesoftPost → fetch) — mocka fetch, não a function.
  const fetchOriginal = global.fetch;
  global.fetch = async () => { chamadasPost++; return {ok: true, status: 200, text: async () => JSON.stringify({loteTrocaKeys: [500], nfNumero: 99})}; };
  try {
    const r = await _eopExecutarTrocaAgrupadaUmaVez(data, loja, linhas, {ambiente: 'homologacao', url_hml: 'https://x', token: 't'});
    assert.equal(r.sucessos, 2);
    assert.equal(r.erros, 0);
    assert.equal(chamadasPost, 1, '2 produtos vão numa ÚNICA solicitação de lote, não 2 POSTs separados');
  } finally { global.fetch = fetchOriginal; }
});

test('_eopExecutarTrocaAgrupadaUmaVez: reenviar a MESMA operacaoId não repete o POST (idempotência real, não só client-side)', async () => {
  const {_eopExecutarTrocaAgrupadaUmaVez} = carregarComFirestore();
  let chamadasPost = 0;
  const linhas = [{gtin: 1, quantidade: 3, motivoTrocaKey: 1, setorOperacionalKey: 1}];
  const data = {operacaoId: 'operacao-teste-0002', indices: [0]};
  const loja = {id: 'loja1', bluesoftLojaKey: 7};
  const fetchOriginal = global.fetch;
  global.fetch = async () => { chamadasPost++; return {ok: true, status: 200, text: async () => JSON.stringify({loteTrocaKeys: [501], nfNumero: 1})}; };
  try {
    const r1 = await _eopExecutarTrocaAgrupadaUmaVez(data, loja, linhas, {ambiente: 'homologacao', url_hml: 'https://x', token: 't'});
    const r2 = await _eopExecutarTrocaAgrupadaUmaVez(data, loja, linhas, {ambiente: 'homologacao', url_hml: 'https://x', token: 't'});
    assert.equal(r1.sucessos, 1);
    assert.equal(r2.sucessos, 1);
    assert.equal(r2.resultados[0].jaProcessado, true);
    assert.equal(chamadasPost, 1, 'a 2ª chamada não deve gerar outro POST à BlueSoft');
  } finally { global.fetch = fetchOriginal; }
});

test('_eopExecutarTrocaAgrupadaUmaVez: resultado incerto (rede caiu) não reenvia sozinho — exige conferência', async () => {
  const {_eopExecutarTrocaAgrupadaUmaVez} = carregarComFirestore();
  let chamadasPost = 0;
  const linhas = [{gtin: 1, quantidade: 3, motivoTrocaKey: 1, setorOperacionalKey: 1}];
  const data = {operacaoId: 'operacao-teste-0003', indices: [0]};
  const loja = {id: 'loja1', bluesoftLojaKey: 7};
  const fetchOriginal = global.fetch;
  global.fetch = async () => { chamadasPost++; throw new Error('rede interrompida'); };
  try {
    const r1 = await _eopExecutarTrocaAgrupadaUmaVez(data, loja, linhas, {ambiente: 'homologacao', url_hml: 'https://x', token: 't'});
    assert.equal(r1.erros, 1);
    assert.equal(r1.resultados[0].requerConferencia, true);
    const r2 = await _eopExecutarTrocaAgrupadaUmaVez(data, loja, linhas, {ambiente: 'homologacao', url_hml: 'https://x', token: 't'});
    assert.equal(r2.resultados[0].requerConferencia, true);
    assert.equal(chamadasPost, 1, 'resultado incerto trava reenvio automático — precisa de conferência manual, não insiste sozinho');
  } finally { global.fetch = fetchOriginal; }
});
