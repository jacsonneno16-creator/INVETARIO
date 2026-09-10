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

// PEDIDO AO VIVO (usuário reportou ao vivo: "matéria-prima às vezes fica
// mapeado em outro... embalagem em umas mapeia certo, outras errado —
// quando abre só embalagens não traz todas, quando abre matéria-prima não
// abre todas"): a versão antiga usava `principaldestinoproduto` (texto
// livre) ANTES das flags estruturadas de `tipoproduto`. Um produto com a
// flag `materiaPrima:true` mas `principaldestinoproduto` preenchido com
// outra coisa (ex.: um texto que não bate com nenhum bucket esperado)
// caía classificado errado mesmo sendo, pela própria Bluesoft, uma
// matéria-prima. Trava a ordem corrigida: flags sempre decidem primeiro.
test('_bluesoftClassificarTipoProduto(): flags estruturadas de tipoProduto vencem principalDestinoProduto quando os dois estão preenchidos e discordam (bug ao vivo real)', () => {
  const win = novoAmbiente();
  const internals = win._importarExportarApiInternals;
  assert.equal(internals._bluesoftClassificarTipoProduto({
    tipoproduto: { materiaPrima: true },
    principaldestinoproduto: 'ALGO INCONSISTENTE',
  }), 'MATERIA PRIMA', 'flag estruturada tem que vencer o texto livre inconsistente');
  assert.equal(internals._bluesoftClassificarTipoProduto({
    tipoproduto: { embalagem: true },
    principaldestinoproduto: 'OUTRO TEXTO QUALQUER',
  }), 'EMBALAGEM', 'mesmo caso pra embalagem — era o que causava "embalagem em umas mapeia certo, outras errado"');
});

test('_bluesoftClassificarTipoProduto(): sem NENHUMA flag de tipoProduto marcada, cai pro texto livre de principalDestinoProduto como último recurso (não perde a classificação)', () => {
  const win = novoAmbiente();
  const internals = win._importarExportarApiInternals;
  assert.equal(internals._bluesoftClassificarTipoProduto({
    tipoproduto: {},
    principaldestinoproduto: 'revenda',
  }), 'REVENDA');
});

// PEDIDO AO VIVO: endereço vazio (sem produto na Bluesoft no momento) caía
// sempre em "SEM PRODUTO NA BLUESOFT", misturando endereços de QUALQUER
// área — ao abrir só "produto acabado" incluindo vazios, endereços vazios
// de matéria-prima/embalagem apareciam junto (falsa impressão de
// endereçamento). Usa o campo "Local de estoque" que já existe no
// cadastro de endereço (ex.: "PRODUTO ACABADO") pra deduzir o tipo certo.
test('_bluesoftTipoProdutoPorLocalEstoque(): reconhece o "Local de estoque" do cadastro de endereço e devolve o mesmo bucket usado pelos produtos', () => {
  const win = novoAmbiente();
  const internals = win._importarExportarApiInternals;
  assert.equal(internals._bluesoftTipoProdutoPorLocalEstoque('PRODUTO ACABADO'), 'PRODUTO ACABADO');
  assert.equal(internals._bluesoftTipoProdutoPorLocalEstoque('Matéria-Prima'), 'MATERIA PRIMA');
  assert.equal(internals._bluesoftTipoProdutoPorLocalEstoque('embalagens'), 'EMBALAGEM');
  assert.equal(internals._bluesoftTipoProdutoPorLocalEstoque('Uso e Consumo'), 'INSUMO/CONSUMO');
  assert.equal(internals._bluesoftTipoProdutoPorLocalEstoque('Produtos para Venda'), 'PRODUTO DE VENDA');
});

test('_bluesoftTipoProdutoPorLocalEstoque(): local vazio ou sem correspondência conhecida devolve null (fica "SEM PRODUTO NA BLUESOFT" na visão geral, não some nem inventa tipo)', () => {
  const win = novoAmbiente();
  const internals = win._importarExportarApiInternals;
  assert.equal(internals._bluesoftTipoProdutoPorLocalEstoque(''), null);
  assert.equal(internals._bluesoftTipoProdutoPorLocalEstoque('SISTEMA'), null);
  assert.equal(internals._bluesoftTipoProdutoPorLocalEstoque(undefined), null);
});

// PEDIDO AO VIVO: usuário quer conseguir "detalhar bem" um produto — o
// motivo precisa nomear especificamente QUAL flag (ou o fallback de texto
// livre) decidiu o tipo, na mesma ordem de prioridade da classificação.
test('_bluesoftMotivoTipoProduto(): nomeia a flag estruturada específica que decidiu, na mesma ordem de prioridade de _bluesoftClassificarTipoProduto', () => {
  const win = novoAmbiente();
  const internals = win._importarExportarApiInternals;
  assert.match(internals._bluesoftMotivoTipoProduto({ tipoproduto: { materiaPrima: true }, principaldestinoproduto: 'ALGO INCONSISTENTE' }), /materiaPrima/);
  assert.match(internals._bluesoftMotivoTipoProduto({ tipoproduto: { embalagem: true } }), /embalagem/);
  assert.match(internals._bluesoftMotivoTipoProduto({ tipoproduto: {}, principaldestinoproduto: 'revenda' }), /texto livre.*revenda/);
  assert.match(internals._bluesoftMotivoTipoProduto({}), /Nenhuma flag/);
});
