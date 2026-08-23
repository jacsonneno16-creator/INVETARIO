// PEDIDO AO VIVO (auditoria 2ª rodada, seção 6/item 4): a tela real de
// Programação (index.html:201-258 do original) não tem bloco de título
// acima da toolbar — o toolbar é o primeiro elemento do painel — e a
// numeração "#" da tabela é ((pg-1)*PER+i+1) (app.js:2114), não reinicia
// a cada página. Este teste dirige o render real (jsdom) com mais de
// PAGE_SIZE registros pra provar que a numeração continua entre páginas,
// e confere cabeçalhos/estado-vazio exatos do original.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '62-producao-programacao.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, delete: async () => { registro.delete(id); }, set: async (payload) => { registro.set(id, { ...(registro.get(id) || {}), ...payload }); } }),
    add: async (payload) => { const id = 'novo' + registro.size; registro.set(id, payload); return { id }; },
    where: () => ({ get: async () => ({ docs: [] }) }),
    _registro: registro,
  };
}

function carregarPagina(registros) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-programacao"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const colRegistros = mockColecao(registros);
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_registros: colRegistros,
      producao_produtos: mockColecao([]),
      producao_maquinas: mockColecao([]),
      producao_ficha_tecnica: mockColecao([]),
      producao_insumos_estoque: mockColecao([]),
    }[nome] || mockColecao([])),
  });
  win.getDTRawFirestore = () => ({ collection: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) });
  win.getDTLojaAtiva = () => 'loja1';
  win.temPermissao = () => true;
  win.DTProducao = { registrarInvalidacao: () => {} };
  win.eval(code);
  return { win, document };
}

test('Programação: sem bloco de título acima da toolbar (original começa direto no toolbar)', async () => {
  const { win, document } = carregarPagina([]);
  await win.renderProducaoProgramacao();
  const html = document.getElementById('page-producao-programacao').innerHTML;
  assert.equal(html.includes('page-title'), false, 'não deveria ter .page-title — original não tem bloco de título aqui');
  assert.match(html, /class="toolbar"/);
});

test('Programação: cabeçalhos exatos do original (Tempo, Dt Início, Ações)', async () => {
  const { win, document } = carregarPagina([]);
  await win.renderProducaoProgramacao();
  const html = document.getElementById('page-producao-programacao').innerHTML;
  assert.match(html, /<th>Tempo<\/th>/);
  assert.match(html, /<th>Dt Início<\/th>/);
  assert.match(html, /<th>Ações<\/th>/);
  assert.doesNotMatch(html, /Tempo est\./);
});

test('Programação: estado vazio exato do original ("Nenhum registro encontrado", ícone 🔍)', async () => {
  const { win, document } = carregarPagina([]);
  await win.renderProducaoProgramacao();
  const html = document.getElementById('page-producao-programacao').innerHTML;
  assert.match(html, /Nenhum registro encontrado/);
  assert.match(html, /🔍/);
});

test('Programação: numeração "#" continua entre páginas — ((pg-1)*PAGE_SIZE+i+1), não reinicia', async () => {
  const registros = [];
  for (let i = 1; i <= 20; i++) {
    registros.push({ id: 'r' + i, data: { produto: 'Produto ' + i, maquina: 'M1', qntCaixas: 10, qntUnid: 100, status: 'pendente', data: '2026-08-0' + (i % 9 + 1), sortOrder: 1000 - i } });
  }
  const { win, document } = carregarPagina(registros);
  await win.renderProducaoProgramacao();
  const page1 = document.getElementById('page-producao-programacao').innerHTML;
  assert.match(page1, /<td style="color:var\(--muted\)">1<\/td>/, 'primeira linha da página 1 deveria ser #1');

  document.querySelector('[data-pprog-pg="2"]').click();
  const page2 = document.getElementById('page-producao-programacao').innerHTML;
  assert.match(page2, /<td style="color:var\(--muted\)">16<\/td>/, 'primeira linha da página 2 deveria ser #16, não #1 de novo');
  assert.doesNotMatch(page2, /<td style="color:var\(--muted\)">1<\/td>/, 'página 2 não deveria repetir a numeração da página 1');
});
