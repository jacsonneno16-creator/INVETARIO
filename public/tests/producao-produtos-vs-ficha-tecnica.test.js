// PEDIDO AO VIVO (auditoria 2ª rodada, seção 14/15): Configurações →
// Produtos → "Cadastro de Produtos" e "Ficha Técnica" apontavam pra
// EXATAMENTE a mesma função (renderProducaoFichaTecnica) — o mesmo CRUD
// completo nas duas entradas de menu. No original são telas diferentes:
// Produtos é o CRUD (scontent-produtos, +Adicionar/Importar/Exportar),
// Ficha Técnica é uma lista somente-leitura, "gerada automaticamente ao
// importar produtos" (scontent-ficha-tecnica-cfg, index.html:1123-1140,
// texto literal). Este teste dirige o render real das duas telas e
// confere que agora são visivelmente diferentes — uma tem os botões de
// edição, a outra não.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/60-producao-ficha-tecnica.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }) };
}

function carregarPagina() {
  const dom = new JSDOM('<!doctype html><html><body><div id="pcfg-embed-host"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_produtos: mockColecao([{ id: 'p1', data: { cod: '101', nome: 'Produto A', unid: 12, pc_min: 10, maquina: 'M1' } }]),
      producao_ficha_tecnica: mockColecao([]),
    }[nome] || mockColecao([])),
  });
  win.eval(code);
  return { win, document };
}

test('renderProducaoFichaTecnica (Cadastro de Produtos) e renderProducaoFichaTecnicaSomenteLeitura (Ficha Técnica) são funções DIFERENTES', () => {
  const { win } = carregarPagina();
  assert.equal(typeof win.renderProducaoFichaTecnica, 'function');
  assert.equal(typeof win.renderProducaoFichaTecnicaSomenteLeitura, 'function');
  assert.notEqual(win.renderProducaoFichaTecnica, win.renderProducaoFichaTecnicaSomenteLeitura);
});

test('Cadastro de Produtos: tem +Novo Produto e botões de editar/excluir', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.match(html, /\+ Novo Produto/);
  assert.match(html, /data-pft-editar/);
  assert.match(html, /Produto A/);
});

test('Ficha Técnica: somente leitura — sem botão de adicionar/editar/excluir, com o aviso do original', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoFichaTecnicaSomenteLeitura('pcfg-embed-host');
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.doesNotMatch(html, /\+ Novo Produto/);
  assert.doesNotMatch(html, /data-pft-editar/);
  assert.doesNotMatch(html, /data-pft-excluir/);
  assert.match(html, /Gerada automaticamente ao importar produtos/);
  assert.match(html, /Produto A/, 'os mesmos dados devem aparecer, só sem os controles de edição');
});
