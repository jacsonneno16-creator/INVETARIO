// BUG AO VIVO REAL (relatado pelo usuário: "tentei abrir de novo o
// inventário lá... só está vindo produto não classificado... não sei se
// você mexeu"): _bluesoftCatalogoProdutos() tinha DOIS problemas
// combinados em 43-importar-exportar-api.js:
//
// 1) `if (_bluesoftCatalogoCache) return ...` tratava um array VAZIO (`[]`,
//    resultado de uma falha total de rede) como "já buscado com sucesso,
//    não tenta de novo" — `[]` é truthy em JS. Uma falha transitória na
//    PRIMEIRA tentativa da sessão "envenenava" TODAS as tentativas
//    seguintes na mesma aba/sessão, sem nunca mais buscar de verdade —
//    cada produto caía em "NAO CLASSIFICADO" por falta de catálogo.
// 2) Quando a paginação do catálogo estagnava (Bluesoft repetindo a mesma
//    página, ou parando de avançar antes do fim), o resultado PARCIAL
//    seguia como se fosse o catálogo inteiro e era GRAVADO no cache
//    persistente (localStorage) por 12h — reproduzindo o "tentei abrir de
//    novo, continua a mesma coisa" relatado ao vivo, porque cada tentativa
//    seguinte reaproveitava o mesmo catálogo quebrado do cache, sem nunca
//    buscar de novo.
//
// Testes reais (execução, não regex) contra os dois.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const codigo = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '43-importar-exportar-api.js'), 'utf8');

function novoAmbiente() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <input id="api-token" value="token-teste">
    <input id="api-url" value="https://erp.bluesoft.com.br/tenant">
    <input id="api-url-hml" value="https://erp.bluesoft.com.br/tenant"><input id="api-url-prd" value="https://erp.bluesoft.com.br/tenant">
    <input id="api-timeout" value="30"><input id="api-warehouse-id" value="">
    <input id="api-env-badge" value="HML"><input id="api-adapter-type" value="bluesoft">
    <input id="fmap-endereco"><input id="fmap-codigo-produto"><input id="fmap-descricao"><input id="fmap-qtd-esperada"><input id="fmap-gtin">
  </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.AnalistaStore = { getState: () => ({}) };
  win.showToast = () => {};
  win.firebase = { auth: () => ({ currentUser: { getIdToken: async () => 'id-token-teste' } }) };
  win.eval(codigo);
  return win;
}

// 20 páginas de 200 itens cada seria o "catálogo completo"; simulamos a
// Bluesoft travando (devolvendo a MESMA página repetida) logo na página 2,
// pra forçar a detecção de estagnação (5 páginas seguidas sem novidade).
function mockFetchCatalogoEstagnado(win) {
  const paginaValida = { currentPage: 0, pageSize: 200, data: Array.from({ length: 200 }, (_, i) => ({ produtokey: 'P' + i, descricao: 'Produto ' + i })) };
  const paginaRepetida = { currentPage: 1, pageSize: 200, data: Array.from({ length: 200 }, (_, i) => ({ produtokey: 'P' + i, descricao: 'Produto ' + i })) }; // MESMOS produtokey de novo — Bluesoft "travada"
  let chamadas = 0;
  win.fetch = async (url, opts) => {
    chamadas++;
    const body = JSON.parse(opts.body);
    const pagina = Number(new URLSearchParams(body.path.split('?')[1] || '').get('currentPage'));
    const resposta = pagina === 0 ? paginaValida : paginaRepetida;
    return { ok: true, status: 200, text: async () => JSON.stringify(resposta) };
  };
  return () => chamadas;
}

test('_bluesoftPaginarTudo(): marca .estagnou=true quando a Bluesoft para de avançar (mesma página repetida), sem travar nem lançar erro', async () => {
  const win = novoAmbiente();
  mockFetchCatalogoEstagnado(win);
  const internals = win._importarExportarApiInternals;

  const itens = await internals._bluesoftPaginarTudo('/api/comercial/produtos', {});

  assert.equal(itens.estagnou, true, 'precisa marcar o resultado como incompleto');
  assert.equal(itens.length, 200, 'só os 200 itens da 1ª página real, nada da página repetida (dedup)');
});

test('REGRESSÃO: catálogo com paginação estagnada NÃO é gravado no cache local de 12h — a próxima tentativa busca de novo em vez de reaproveitar o catálogo quebrado', async () => {
  const win = novoAmbiente();
  const contarChamadas = mockFetchCatalogoEstagnado(win);
  const internals = win._importarExportarApiInternals;
  win.localStorage.clear();

  const primeiro = await internals._bluesoftCatalogoProdutos();
  assert.equal(primeiro.estagnou, true);
  assert.equal(win.localStorage.getItem('dt_bluesoft_catalogo_cache_v6'), null, 'catálogo incompleto não pode ir pro cache persistente');

  // "Tentei abrir de novo" — reseta só o cache em MEMÓRIA (equivalente a
  // reabrir o modal, não a página inteira) e chama de novo.
  internals._resetCacheCatalogoBluesoft();
  const chamadasAntes = contarChamadas();
  await internals._bluesoftCatalogoProdutos();
  assert.ok(contarChamadas() > chamadasAntes, 'precisa ter tentado buscar de novo, não reaproveitado um catálogo quebrado salvo');
});

test('REGRESSÃO (bug ao vivo real: "[] é truthy" — uma falha total na 1ª tentativa da sessão nunca mais deixava buscar de novo): depois de uma falha de rede total, uma 2ª chamada na MESMA sessão tenta buscar de novo em vez de devolver o [] antigo pra sempre', async () => {
  const win = novoAmbiente();
  let chamadas = 0;
  win.fetch = async () => { chamadas++; throw new Error('network down'); };
  const internals = win._importarExportarApiInternals;
  win.localStorage.clear();

  const primeiro = await internals._bluesoftCatalogoProdutos();
  // .length (não deepEqual) — o array vem do realm do jsdom (win), diferente
  // do Array nativo deste processo; deepStrictEqual entre realms diferentes
  // falha por identidade de construtor mesmo com o mesmo conteúdo.
  assert.equal(primeiro.length, 0); // falha total -> array vazio, como já era

  // Rede volta a funcionar — SEM resetar cache manualmente, só chamando de novo.
  win.fetch = async (url, opts) => {
    chamadas++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ currentPage: 0, pageSize: 200, data: [{ produtokey: 'P1', descricao: 'Produto 1' }] }) };
  };
  const chamadasAntes = chamadas;
  const segundo = await internals._bluesoftCatalogoProdutos();

  assert.ok(chamadas > chamadasAntes, 'precisa ter tentado buscar de novo (o [] da falha anterior não podia travar a sessão pra sempre)');
  assert.equal(segundo.length, 1);
});

test('_bluesoftClassificarTipoProduto(): classifica pelas flags de tipoProduto quando não tem principalDestinoProduto — usado pra saber se o catálogo realmente classificou o produto (não é sempre "NAO CLASSIFICADO")', () => {
  const win = novoAmbiente();
  const internals = win._importarExportarApiInternals;
  assert.equal(internals._bluesoftClassificarTipoProduto({ tipoproduto: { produtoAcabado: true } }), 'PRODUTO ACABADO');
  assert.equal(internals._bluesoftClassificarTipoProduto({ tipoproduto: { materiaPrima: true } }), 'MATERIA PRIMA');
  assert.equal(internals._bluesoftClassificarTipoProduto({ tipoproduto: { mercadoriaParaUsoConsumo: true } }), 'INSUMO/CONSUMO');
  assert.equal(internals._bluesoftClassificarTipoProduto({}), 'NAO CLASSIFICADO');
});
