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

// pftBuscarBiAutomatico() (60-producao-ficha-tecnica.js) agenda um
// setInterval de auto-refresh a cada render da tela somente-leitura — timer
// real em jsdom, que precisa ser derrubado com window.close() ou o
// node --test nunca sai sozinho.
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina() {
  const dom = new JSDOM('<!doctype html><html><body><div id="pcfg-embed-host"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
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

test('Ficha Técnica: somente leitura — sem "+ Novo Produto" (CRUD de produto continua exclusivo do Cadastro), com o aviso do original', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoFichaTecnicaSomenteLeitura('pcfg-embed-host');
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.doesNotMatch(html, /\+ Novo Produto/);
  assert.match(html, /Gerada automaticamente ao importar produtos/);
  assert.match(html, /Produto A/, 'os mesmos dados devem aparecer, só sem os controles de edição');
});

// PEDIDO AO VIVO (2026-09-02): "quando vou digitar só consigo digitar um
// dígito por vez, tipo coloco 1 dígito tenho que clicar de novo digitar
// outro e assim vai" — o listener de 'input' do #pft-busca redesenhava a
// tela inteira (innerHTML novo, input novo) sem devolver o foco pro campo
// recém-criado, então o próximo caractere digitado caía no vazio. Mesmo
// tratamento que #pftro-busca (Ficha Técnica somente leitura) já tinha.
test('Cadastro de Produtos: digitar na busca mantém o foco no campo depois de redesenhar (não perde 1 caractere por vez)', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  const campo = document.getElementById('pft-busca');
  campo.focus();
  campo.value = 'P';
  campo.dispatchEvent(new win.Event('input', { bubbles: true }));
  const campoDepois = document.getElementById('pft-busca');
  assert.equal(document.activeElement, campoDepois, 'o campo (novo nó após o redesenho) precisa continuar com foco pro próximo caractere não se perder');
  assert.equal(campoDepois.value, 'p', '_desenharProducaoFichaTecnica já normalizava a busca pra minúsculo antes deste fix; não é o bug relatado, só documentando o comportamento atual');
});
