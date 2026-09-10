// PEDIDO AO VIVO (2026-08-26): importar as devoluções direto de
// notas_fiscais_jacson.json (export do BI, sincronizado localmente via
// SharePoint) em vez de depender da API da Bluesoft — o Analista escolhe o
// arquivo na tela "Importar do BI (JSON)", mesmo esquema de prévia/salvar
// já usado pelo PDF. Cada linha do JSON é um ITEM de nota (várias linhas
// por chave quando a nota tem mais de um produto); _agruparNotasBiPorChave
// junta isso numa nota por chave antes de cair na prévia.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const recusasCode = fs.readFileSync(path.join(base, '97-recebimento-recusas.js'), 'utf8');

function carregarParser() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTFirestore = () => ({ collection: () => ({ get: async () => ({ docs: [] }) }) });
  win.eval(recusasCode);
  return win.DTRecusasParser;
}

test('_agruparNotasBiPorChave: uma nota com 2 itens vira UM registro, com itens[] e valorTotal somado', () => {
  const parser = carregarParser();
  const linhasJson = [
    { tipo_movimento: 'DEVOLUCAO', nf_numero: 519917, nf_serie: '300', loja_key: 14, cliente: 'SENDAS DISTRIBUIDORA 915 - CD CAJAMAR', produto_key: 304, produto: '00001 TAPIOCA DA TERRINHA 1 KG - CX 12', cfop: '1201', valor_nota: 18.8, data_emissao: '2026-05-26T00:00:00', quantidade_faturada: 2.0, supervisor: null, vendedor: null, chave: '35260506057223036877553000005199171533755547' },
    { tipo_movimento: 'DEVOLUCAO', nf_numero: 519917, nf_serie: '300', loja_key: 14, cliente: 'SENDAS DISTRIBUIDORA 915 - CD CAJAMAR', produto_key: 37190, produto: '00002 TAPIOCA DA TERRINHA 500 G - FD 24', cfop: '1201', valor_nota: 65.8, data_emissao: '2026-05-26T00:00:00', quantidade_faturada: 14.0, supervisor: null, vendedor: null, chave: '35260506057223036877553000005199171533755547' },
  ];
  const notas = parser._agruparNotasBiPorChave(linhasJson);
  assert.equal(notas.length, 1, 'as 2 linhas de item, mesma chave, precisam virar 1 nota só');
  const nota = notas[0];
  assert.equal(nota.chave, '35260506057223036877553000005199171533755547');
  assert.equal(nota.numeroNota, '519917');
  assert.equal(nota.serie, '300');
  assert.equal(nota.destinatario, 'SENDAS DISTRIBUIDORA 915 - CD CAJAMAR');
  assert.equal(nota.dataEmissao, '2026-05-26');
  assert.equal(nota.valorTotal, 84.6, 'valorTotal precisa ser a SOMA dos 2 itens (18.8 + 65.8)');
  assert.equal(nota.itens.length, 2);
  assert.equal(nota.itens[0].descricao, '00001 TAPIOCA DA TERRINHA 1 KG - CX 12');
  assert.equal(nota.itens[0].quantidade, 2);
  assert.equal(nota.itens[1].produtoKey, 37190);
});

test('_agruparNotasBiPorChave: duas notas com chaves diferentes viram 2 registros separados', () => {
  const parser = carregarParser();
  const linhasJson = [
    { nf_numero: 1, nf_serie: '1', cliente: 'Mercado A', valor_nota: 10, data_emissao: '2026-06-01T00:00:00', quantidade_faturada: 1, produto: 'X', chave: 'A'.repeat(44) },
    { nf_numero: 2, nf_serie: '1', cliente: 'Mercado B', valor_nota: 20, data_emissao: '2026-06-02T00:00:00', quantidade_faturada: 1, produto: 'Y', chave: 'B'.repeat(44) },
  ];
  const notas = parser._agruparNotasBiPorChave(linhasJson);
  assert.equal(notas.length, 2);
});

test('_agruparNotasBiPorChave: linha sem chave é ignorada (não vira nota "fantasma")', () => {
  const parser = carregarParser();
  const linhasJson = [
    { nf_numero: 1, cliente: 'Mercado A', valor_nota: 10, data_emissao: '2026-06-01T00:00:00', quantidade_faturada: 1, produto: 'X', chave: '' },
  ];
  const notas = parser._agruparNotasBiPorChave(linhasJson);
  assert.equal(notas.length, 0);
});

test('_agruparNotasBiPorChave: pega vendedor/supervisor quando o JSON já traz preenchido (caso das linhas de VENDA)', () => {
  const parser = carregarParser();
  const linhasJson = [
    { nf_numero: 1, cliente: 'Mercado A', valor_nota: 10, data_emissao: '2026-06-01T00:00:00', quantidade_faturada: 1, produto: 'X', chave: 'C'.repeat(44), vendedor: 'RODOLFO QUERINO LUIZ - GERENTE DE AREA', supervisor: 'RODOLFO QUERINO LUIZ - GERENTE DE AREA' },
  ];
  const notas = parser._agruparNotasBiPorChave(linhasJson);
  assert.equal(notas[0].vendedorNome, 'RODOLFO QUERINO LUIZ - GERENTE DE AREA');
  assert.equal(notas[0].supervisorNome, 'RODOLFO QUERINO LUIZ - GERENTE DE AREA');
});

// PEDIDO AO VIVO (2026-09-02): "verifica pq não apareceu o gtin e dun" — a
// tela colou um documento real (nota 176045, VENDA) com itens todos com
// gtin:"". Confirmado direto no notas_fiscais_jacson.json real: 100% das
// 22.215 linhas de VENDA têm `dum`/`ean` preenchidos (não é exclusividade
// de DEVOLUCAO, como a suposição antiga dizia) — o bug era gtin:'' fixo
// aqui em 97-recebimento-recusas.js, nunca lia esses 2 campos.
test('_agruparNotasBiPorChave: item ganha gtin (ean) e dun (dum) — cada um da sua fonte', () => {
  const parser = carregarParser();
  const linhasJson = [
    { nf_numero: 176045, nf_serie: '1', cliente: 'CASAFRUTI HORTIFRUTIGRANJEIROS - VITORIA', produto_key: 75877, produto: '00204 BATATA PALHA DA TERRINHA TRADIC 100G - CX20', valor_nota: 100, data_emissao: '2026-06-22T00:00:00', quantidade_faturada: 2, chave: 'D'.repeat(44), ean: 7898693230674, dum: 17898693230671 },
    { nf_numero: 176045, nf_serie: '1', cliente: 'CASAFRUTI HORTIFRUTIGRANJEIROS - VITORIA', produto_key: 999, produto: 'SÓ TEM EAN, SEM DUM', valor_nota: 10, data_emissao: '2026-06-22T00:00:00', quantidade_faturada: 1, chave: 'D'.repeat(44), ean: 123456 },
  ];
  const notas = parser._agruparNotasBiPorChave(linhasJson);
  assert.equal(notas[0].itens[0].gtin, '7898693230674', 'gtin é o EAN (unidade)');
  assert.equal(notas[0].itens[0].dun, '17898693230671', 'dun é o DUN (caixa), separado');
  assert.equal(notas[0].itens[1].gtin, '123456', 'sem dum, gtin continua o ean normalmente');
  assert.equal(notas[0].itens[1].dun, '', 'sem dum, dun fica vazio (não herda o ean)');
});

// PEDIDO AO VIVO (2026-09-02, 2ª/3ª rodada): "quero que grave o dun" →
// "o gtin ficou com o dun também, cada um no lugar certo" — a 1ª tentativa
// deixou gtin igual ao dun (duplicado); corrigido: gtin = EAN-13
// (unidade), dun = DUN-14 (caixa), sem fallback cruzado entre os dois.
test('_agruparNotasBiPorChave: gtin e dun NUNCA ficam com o mesmo valor cruzado — cada campo só da sua própria fonte', () => {
  const parser = carregarParser();
  const linhasJson = [
    { nf_numero: 1, cliente: 'A', produto_key: 1, produto: 'com dun e ean', valor_nota: 1, data_emissao: '2026-06-01T00:00:00', quantidade_faturada: 1, chave: 'E'.repeat(44), ean: 111, dum: 222 },
    { nf_numero: 1, cliente: 'A', produto_key: 2, produto: 'só com ean', valor_nota: 1, data_emissao: '2026-06-01T00:00:00', quantidade_faturada: 1, chave: 'E'.repeat(44), ean: 333 },
  ];
  const notas = parser._agruparNotasBiPorChave(linhasJson);
  assert.equal(notas[0].itens[0].gtin, '111', 'gtin é o ean (111), não o dun (222)');
  assert.equal(notas[0].itens[0].dun, '222', 'dun é o dum puro');
  assert.equal(notas[0].itens[1].dun, '', 'sem dum, dun fica vazio (não herda o ean)');
  assert.equal(notas[0].itens[1].gtin, '333', 'sem dum, gtin é o ean normalmente');
});
