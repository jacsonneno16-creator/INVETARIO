'use strict';
// Cadastro único de produtos (pedido ao vivo 2026-09-21): categoria deixa
// de vir só da primeira palavra do nome. Testa a nova cadeia de prioridade
// em metaProduto() de 78-pcp-central.js: produtos_mestre (cadastro único,
// pós-migração) > bi_classificacao_produtos (classificação real da
// Bluesoft, já sincronizada mas nunca lida antes) > _categoriaDoNome
// (fallback antigo, primeira palavra do nome).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '78-pcp-central.js'), 'utf8');

function load() {
  const document = { addEventListener: () => {}, getElementById: () => null };
  const window = { calcularProjecaoComRisco: () => [], getParametrosProducaoProjecao: () => ({}), temPermissao: () => true };
  vm.runInNewContext(code, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, confirm: () => true, prompt: () => null });
  return window._pcpInternals;
}

test('_categoriaDeBluesoft: usa grupo/seção/departamento (nessa ordem) da classificação real, maiúsculo', () => {
  const h = load();
  h.setBiClassificacao(new Map([
    ['700', { produtoKey: '700', grupo: 'temperos e condimentos', secao: 'mercearia', departamento: 'alimentos' }],
    ['701', { produtoKey: '701', grupo: '', secao: 'mercearia', departamento: 'alimentos' }],
    ['702', { produtoKey: '702', grupo: '', secao: '', departamento: 'alimentos' }],
  ]));
  assert.equal(h._categoriaDeBluesoft({ cod: '700' }), 'TEMPEROS E CONDIMENTOS', 'grupo tem prioridade sobre seção/departamento');
  assert.equal(h._categoriaDeBluesoft({ cod: '701' }), 'MERCEARIA', 'sem grupo, cai pra seção');
  assert.equal(h._categoriaDeBluesoft({ cod: '702' }), 'ALIMENTOS', 'sem grupo nem seção, cai pro departamento');
});
test('_categoriaDeBluesoft: sem match nenhum pro código, devolve vazio (não quebra, não inventa)', () => {
  const h = load();
  h.setBiClassificacao(new Map());
  assert.equal(h._categoriaDeBluesoft({ cod: '999' }), '');
});

test('metaProduto: categoria prefere produtos_mestre (cadastro único) antes de qualquer outra fonte', () => {
  const h = load();
  h.setProdutos([{ cod: '700', nome: 'BOBINA CANELA PO DA TERRINHA', lojaId: 'loja1' }]);
  h.setBiClassificacao(new Map([['700', { produtoKey: '700', grupo: 'temperos e condimentos' }]]));
  h.setProdutosMestre(new Map([['700', { categoria: 'ESPECIARIAS' }]]));
  const meta = h.metaProduto({ key: '700', produto: 'BOBINA CANELA PO DA TERRINHA' });
  assert.equal(meta.categoria, 'ESPECIARIAS', 'produtos_mestre (revisado por humano) vence tudo o mais');
});
test('metaProduto: sem produtos_mestre, cai pra classificação real da Bluesoft — resolve a fragmentação por nome', () => {
  const h = load();
  h.setProdutos([{ cod: '700', nome: 'BOBINA CANELA PO DA TERRINHA', lojaId: 'loja1' }]);
  h.setBiClassificacao(new Map([['700', { produtoKey: '700', grupo: 'temperos e condimentos' }]]));
  h.setProdutosMestre(new Map());
  const meta = h.metaProduto({ key: '700', produto: 'BOBINA CANELA PO DA TERRINHA' });
  assert.equal(meta.categoria, 'TEMPEROS E CONDIMENTOS', 'antes desta mudança isso virava categoria "BOBINA" — errado');
});
test('metaProduto: sem produtos_mestre e sem classificação Bluesoft, cai pro fallback antigo (1ª palavra do nome)', () => {
  const h = load();
  h.setProdutos([{ cod: '999', nome: 'CANELA EM PO DA TERRINHA', lojaId: 'loja1' }]);
  h.setBiClassificacao(new Map());
  h.setProdutosMestre(new Map());
  const meta = h.metaProduto({ key: '999', produto: 'CANELA EM PO DA TERRINHA' });
  assert.equal(meta.categoria, 'CANELA');
});
test('metaProduto: marcaPropria vem do cadastro único quando presente, sem depender só do regex "DA TERRINHA" no nome', () => {
  const h = load();
  h.setProdutos([{ cod: '5', nome: 'PRODUTO GENERICO SEM MARCA NO NOME', lojaId: 'loja1' }]);
  h.setProdutosMestre(new Map([['5', { marcaPropria: true }]]));
  const meta = h.metaProduto({ key: '5', produto: 'PRODUTO GENERICO SEM MARCA NO NOME' });
  assert.equal(meta.marcaPropria, true, 'produtos_mestre.marcaPropria=true precisa valer mesmo sem "DA TERRINHA" no nome');
});

// PEDIDO AO VIVO (2026-09-25): "vou em categoria, aparece todas as antigas
// ainda" — filtrosHtml() montava a lista do dropdown com _categoriaDoNome()
// direto, sem passar por metaProduto() (a mesma função que decide a
// categoria de cada linha de verdade) — a categoria revisada na planilha
// nunca aparecia como opção pra filtrar.
test('filtrosHtml: lista de categorias do dropdown usa a categoria REVISADA (produtos_mestre), não a regra antiga da 1ª palavra do nome', () => {
  const h = load();
  h.setProdutos([{ cod: '76401', nome: '11102 ALHO FRITO GRANULADO OKKER 90 GR - CX 12', lojaId: 'loja1' }]);
  h.setProdutosMestre(new Map([['76401', { categoria: 'OKKER' }]]));
  const html = h.filtrosHtml();
  assert.match(html, /<option[^>]*>OKKER<\/option>/, 'categoria revisada precisa aparecer como opção');
  assert.doesNotMatch(html, />ALHO</, 'categoria antiga (1ª palavra do nome) não deveria mais aparecer quando existe revisão');
});
test('filtrosHtml: sem revisão nem Bluesoft, o dropdown ainda mostra o fallback antigo (não quebra pra quem não foi revisado)', () => {
  const h = load();
  h.setProdutos([{ cod: '999', nome: 'CANELA EM PO DA TERRINHA', lojaId: 'loja1' }]);
  h.setProdutosMestre(new Map());
  h.setBiClassificacao(new Map());
  const html = h.filtrosHtml();
  assert.match(html, /<option[^>]*>CANELA<\/option>/);
});

// PEDIDO AO VIVO (2026-09-25, 2ª rodada): "ainda ta aparecendo mais de 30
// tipos de categoria" — os 714 produtos marcados INATIVOS (fora da
// planilha revisada de 19 categorias reais) ainda entravam na lista do
// dropdown, caindo no fallback Bluesoft/nome e inflando a lista. Categoria
// de produto inativo não deve aparecer como opção de filtro.
test('filtrosHtml: categoria de produto INATIVO no cadastro único não aparece como opção no dropdown', () => {
  const h = load();
  h.setProdutos([
    { cod: '700', nome: 'PRODUTO ATIVO REVISADO', lojaId: 'loja1', ativo: true },
    { cod: '701', nome: 'PRODUTO REMOVIDO DA PLANILHA', lojaId: 'loja1', ativo: true },
  ]);
  h.setProdutosMestre(new Map([
    ['700', { categoria: 'TAPIOCA', ativo: true }],
    ['701', { categoria: 'CATEGORIA-FANTASMA', ativo: false }],
  ]));
  const html = h.filtrosHtml();
  assert.match(html, /<option[^>]*>TAPIOCA<\/option>/);
  assert.doesNotMatch(html, />CATEGORIA-FANTASMA</, 'categoria de produto inativo não pode inflar a lista de filtros');
});

// PEDIDO AO VIVO (2026-09-25): "tem como colocar pra aparecer só os
// produtos ativos?" — o catálogo da "Nova solicitação de compra" (categoria
// Produto acabado) filtrava por um `ativo` desatualizado do cadastro por
// loja; agora usa o produtos_mestre revisado como fonte de verdade.
test('_catalogoProdutoAcabadoCompleto: produto inativo no cadastro único (produtos_mestre) não aparece, mesmo com ativo:true no cadastro antigo por loja', () => {
  const h = load();
  h.setProdutos([{ cod: '76401', nome: 'ALHO FRITO OKKER', lojaId: 'loja1', ativo: true }]);
  h.setProdutosMestre(new Map([['76401', { ativo: false }]]));
  const catalogo = h._catalogoProdutoAcabadoCompleto();
  assert.equal(catalogo.length, 0);
});
test('_catalogoProdutoAcabadoCompleto: produto ativo no cadastro único aparece, mesmo com ativo:false esquecido no cadastro antigo', () => {
  const h = load();
  h.setProdutos([{ cod: '48723', nome: 'ACAFRAO DA TERRINHA', lojaId: 'loja1', ativo: false }]);
  h.setProdutosMestre(new Map([['48723', { ativo: true }]]));
  const catalogo = h._catalogoProdutoAcabadoCompleto();
  assert.equal(catalogo.length, 1);
  assert.equal(catalogo[0].produtoId, '48723');
});
test('_catalogoProdutoAcabadoCompleto: produto que nem chegou a ser migrado pro cadastro único continua aparecendo (nunca esconde por acidente)', () => {
  const h = load();
  h.setProdutos([{ cod: '111', nome: 'PRODUTO SEM CADASTRO UNICO AINDA', lojaId: 'loja1' }]);
  h.setProdutosMestre(new Map());
  const catalogo = h._catalogoProdutoAcabadoCompleto();
  assert.equal(catalogo.length, 1);
});

// PEDIDO AO VIVO (2026-09-25, 3ª rodada): "nas categorias nao precisa
// aparecer insumos e materia prima" — Planejamento é a visão de produto
// acabado; essas 2 categorias da planilha revisada não fazem sentido nem
// como opção de filtro nem como linha na tabela de Planejamento.
test('filtrosHtml: categorias INSUMOS e MATERIA PRIMA não aparecem como opção no dropdown', () => {
  const h = load();
  h.setProdutos([
    { cod: '1', nome: 'PRODUTO ACABADO QUALQUER', lojaId: 'loja1' },
    { cod: '2', nome: 'PRODUTO INSUMO QUALQUER', lojaId: 'loja1' },
    { cod: '3', nome: 'PRODUTO MATERIA PRIMA QUALQUER', lojaId: 'loja1' },
  ]);
  h.setProdutosMestre(new Map([
    ['1', { categoria: 'TAPIOCA' }],
    ['2', { categoria: 'Insumos' }],
    ['3', { categoria: 'Materia Prima' }],
  ]));
  const html = h.filtrosHtml();
  assert.match(html, /<option[^>]*>TAPIOCA<\/option>/);
  assert.doesNotMatch(html, />Insumos</i);
  assert.doesNotMatch(html, />Materia Prima</i);
});
test('visaoFiltrada: na aba planejamento, produto categorizado como INSUMOS/MATERIA PRIMA não aparece na tabela', () => {
  const h = load();
  h.setAba('planejamento');
  h.setFiltros({ ocultarZerados: false });
  h.setProdutos([
    { cod: '9001', nome: 'PRODUTO ACABADO QUALQUER', lojaId: 'loja1' },
    { cod: '9002', nome: 'PRODUTO INSUMO QUALQUER', lojaId: 'loja1' },
  ]);
  h.setProdutosMestre(new Map([
    ['9001', { categoria: 'TAPIOCA' }],
    ['9002', { categoria: 'Insumos' }],
  ]));
  const v = h.visaoFiltrada();
  assert.ok(v.some(x => x.cod === '9001'));
  assert.ok(!v.some(x => x.cod === '9002'), 'produto categoria Insumos não deveria aparecer em Planejamento');
});

// PEDIDO AO VIVO (2026-09-25, 4ª rodada): "aqui nao precisa aparecer os
// produtos em und" — lista curada à mão pelo usuário (variantes de venda
// avulsa com irmã em caixa/fardo) não deve aparecer na tabela de
// Planejamento, mesmo tendo estoque/categoria normal.
test('visaoFiltrada: na aba planejamento, produto da lista curada de UND não aparece na tabela', () => {
  const h = load();
  h.setAba('planejamento');
  h.setFiltros({ ocultarZerados: false });
  h.setProdutos([
    { cod: '9003', nome: 'PRODUTO CAIXA NORMAL', lojaId: 'loja1' },
    { cod: '48059', nome: '01703 ALHO DESID FLOCOS DA TERRINHA 25 g - UND', lojaId: 'loja1' },
  ]);
  const v = h.visaoFiltrada();
  assert.ok(v.some(x => x.cod === '9003'));
  assert.ok(!v.some(x => x.cod === '48059'), 'código da lista curada de UND não deveria aparecer em Planejamento');
});
test('visaoFiltrada: fora da aba planejamento/estoque, a lista de UND não filtra nada (não afeta outras telas)', () => {
  const h = load();
  h.setAba('pedidos');
  h.setFiltros({ ocultarZerados: false });
  h.setProdutos([{ cod: '48059', nome: '01703 ALHO DESID FLOCOS DA TERRINHA 25 g - UND', lojaId: 'loja1' }]);
  const v = h.visaoFiltrada();
  assert.ok(v.some(x => x.cod === '48059'));
});

test('filtrarProdutosPlanejaveis: produto inativo no cadastro único não entra no núcleo do Planejamento', () => {
  const h=load();
  h.setProdutos([{cod:'INAT',nome:'Produto inativo',ativo:true,lojaId:'L1'}]);
  h.setProdutosMestre(new Map([['INAT',{cod:'INAT',ativo:false,categoria:'MERCEARIA'}]]));
  const saida=h.filtrarProdutosPlanejaveis([{key:'INAT',cod:'INAT',produto:'Produto inativo'}]);
  assert.equal(saida.length,0);
});

test('filtrarProdutosPlanejaveis: produto sem cadastro mestre mantém fallback do ativo antigo', () => {
  const h=load();
  h.setProdutos([{cod:'AT',nome:'Produto ativo',ativo:true,lojaId:'L1'}]);
  h.setProdutosMestre(new Map());
  assert.equal(h.filtrarProdutosPlanejaveis([{key:'AT',cod:'AT',produto:'Produto ativo'}]).length,1);
});
