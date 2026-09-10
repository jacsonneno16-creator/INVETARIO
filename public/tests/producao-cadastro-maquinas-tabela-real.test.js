// PEDIDO AO VIVO (pendência #4): o código admitia "não dá pra recriar a
// tabela exata do CRUD original nesta rodada" — Configurações → Cadastro
// de Máquinas reaproveitava visualmente os MESMOS cards da aba principal
// de monitoramento (Miniaturas/Lista, filtro categoria/semana), só com
// busca/editar/excluir plugados neles. Este teste dirige o render real
// das DUAS telas e confirma que agora são estruturalmente diferentes,
// reproduzindo app.js:7866-7957/index.html:1082-1120 do original: tabela
// própria (Nome/Tipo-Setor/Und-min/Cap-hora/Cap-dia/Status/Ações), sem
// filtro de categoria/semana, sem toggle Miniaturas/Lista, sem busca.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/61-producao-maquinas.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, delete: async () => { registro.delete(id); }, set: async (payload, opts) => { const a = (opts && opts.merge) ? (registro.get(id) || {}) : {}; registro.set(id, { ...a, ...payload }); } }),
    add: async (payload) => { const id = 'novo' + registro.size; registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}

function carregarPagina() {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-maquinas"></div><div id="pcfg-embed-host"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const maquinas = mockColecao([
    { id: 'm1', data: { nome: 'ENVASADORA 1', pcMin: 20, eficiencia: 90, hTurno: 8, nTurnos: 1, status: 'ativa', tipo: 'Envase', setor: 'Linha 1', produtosCompativeis: [{ produto: 'Produto A', velocidade: 25 }] } },
    { id: 'm2', data: { nome: 'EMPACOTADEIRA 1', pcMin: 0, status: 'ativa' } },
  ]);
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_maquinas: maquinas,
      producao_registros: mockColecao([]), producao_setup: mockColecao([]), producao_categorias: mockColecao([]), producao_config: mockColecao([]),
    }[nome] || mockColecao([])),
  });
  win.DTProducao = { registrarInvalidacao: () => {} };
  win.eval(code);
  return { win, document, maquinas };
}

test('Cadastro de Máquinas (Configurações): tabela própria com as colunas exatas do original', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoMaquinas('pcfg-embed-host');
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.match(html, /Cadastro de Máquinas/);
  assert.match(html, /Use <b>Configurações → Produtos → Excel<\/b>/);
  assert.match(html, /<th>Nome<\/th>/);
  assert.match(html, /Tipo \/ Setor/);
  assert.match(html, /Und\/min/);
  assert.match(html, /Cap\/hora/);
  assert.match(html, /Cap\/dia/);
  assert.match(html, /<th style="text-align:center">Status<\/th>/);
  assert.match(html, /ENVASADORA 1/);
  assert.match(html, /\+ Adicionar Máquina/);
});

test('Cadastro de Máquinas: NÃO tem filtro de categoria/semana nem toggle Miniaturas/Lista (não existem no original)', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoMaquinas('pcfg-embed-host');
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.doesNotMatch(html, /pmaq-filtro-categoria/);
  assert.doesNotMatch(html, /pmaq-filtro-semana/);
  assert.doesNotMatch(html, /Miniaturas/);
  assert.doesNotMatch(html, /class="maq-grid"/, 'não deveria reaproveitar o grid de cards do monitoramento');
  assert.doesNotMatch(html, /class="maq-list-row"/, 'não deveria reaproveitar a lista do monitoramento');
});

test('Aba principal Máquinas (monitoramento): continua SEM nenhuma ação de cadastro', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoMaquinas();
  const html = document.getElementById('page-producao-maquinas').innerHTML;
  assert.doesNotMatch(html, /data-pmaq-editar/);
  assert.doesNotMatch(html, /data-pmaq-excluir/);
  assert.doesNotMatch(html, /\+ Adicionar Máquina/);
  assert.doesNotMatch(html, /\+ Nova Máquina/);
  assert.match(html, /Carga por Máquina/);
  assert.match(html, /Miniaturas/);
  assert.match(html, /Configurações → Máquinas → Cadastro de Máquinas/);
});

test('Cadastro de Máquinas: clicar em ▾ abre o detalhe (Cap/hora, Cap/turno, Cap/dia, Eficiência, produtos compatíveis)', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoMaquinas('pcfg-embed-host');
  document.querySelector('[data-pmaq-detalhe-cad="m1"]').click();
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.match(html, /Cap\/turno/);
  assert.match(html, /Produtos Compatíveis \(1\)/);
  assert.match(html, /Produto A/);
});

test('Cadastro de Máquinas: excluir grava no Firestore e redesenha a TABELA (não os cards)', async () => {
  const { win, document, maquinas } = carregarPagina();
  win.showConfirm = (msg, executar) => executar();
  await win.renderProducaoMaquinas('pcfg-embed-host');
  document.querySelector('[data-pmaq-excluir="m2"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(maquinas._registro.has('m2'), false);
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.doesNotMatch(html, /EMPACOTADEIRA 1/);
  assert.match(html, /ENVASADORA 1/);
  assert.match(html, /<th>Nome<\/th>/, 'depois de excluir, continua sendo a tabela de cadastro, não os cards');
});
