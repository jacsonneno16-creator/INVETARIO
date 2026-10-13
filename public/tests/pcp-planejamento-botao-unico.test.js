// Pedido ao vivo (2026-09-25): "não dá pra deixar só um botão, com o nome
// Buscar?" — Planejamento tinha "📊 Atualizar BI" e "↻ Atualizar"
// separados, e essa confusão (clicar só num dos dois) atrasou achar que um
// número de estoque estranho era só aba antiga em cache. Agora um botão só
// ("🔄 Buscar") dispara tudo: sincroniza o SharePoint (best-effort,
// admin-only), recarrega o Firestore e busca o estoque fresco nas abas que
// mostram estoque (planejamento/produção).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const codeCentral = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    where: () => ({ get: async () => ({ docs: [] }) }),
    doc: () => ({ get: async () => ({ exists: false }) }),
    add: async () => ({ id: 'novo' }),
    _registro: registro,
  };
}

function montarAmbiente() {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.showToast = () => {};
  win._currentAnalistaUser = { email: 'pcp@teste.com', uid: 'u-pcp' };
  win.getDTLojaAtiva = () => 'loja1';
  win.getDTFirestore = () => ({ collection: () => mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: () => mockColecao([]) });
  win.DTBiPastaLocal = { suportado: () => true, status: async () => 'conectado', lerJson: async () => ({ produtos: [] }) };
  vm.runInContext(codeCentral, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  return { win, document: win.document };
}

test('Planejamento: só existe 1 botão de buscar (não tem mais "Atualizar BI" separado)', async () => {
  const { win, document } = montarAmbiente();
  await win._pcpInternals.carregar();
  win._pcpInternals.setAba('planejamento');
  win._pcpInternals.desenhar();
  const html = document.getElementById('page-pcp-central').innerHTML;
  assert.match(html, /data-pcp-refresh/, 'o botão único continua existindo');
  assert.match(html, /🔄 Buscar/, 'rótulo novo pedido ao vivo');
  assert.doesNotMatch(html, /data-pcp-buscar-estoque-bi/, 'botão separado de Atualizar BI não existe mais nesta aba');
  assert.doesNotMatch(html, /Atualizar BI/, 'texto do botão antigo não aparece mais');
});

test('pcpAtualizarComSync: na aba Planejamento, busca o estoque fresco junto (não precisa de um 2º clique)', async () => {
  const { win, document } = montarAmbiente();
  await win._pcpInternals.carregar();
  win._pcpInternals.setAba('planejamento');
  let buscouEstoqueBi = false;
  const originalLerJson = win.DTBiPastaLocal.lerJson;
  win.DTBiPastaLocal.lerJson = async (nome) => { if (nome === 'produtos_estoque.json') buscouEstoqueBi = true; return originalLerJson(nome); };
  win._pcpInternals.desenhar();
  const btn = document.querySelector('[data-pcp-refresh]');
  assert.ok(btn, 'botão precisa existir pra disparar o clique');
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(buscouEstoqueBi, true, 'buscarEstoqueBi() precisa ter sido chamado sozinho, sem precisar de um botão separado');
});

test('pcpAtualizarComSync: fora da aba Planejamento/Produção, não tenta buscar estoque BI (não faz sentido pra essas abas)', async () => {
  const { win, document } = montarAmbiente();
  await win._pcpInternals.carregar();
  win._pcpInternals.setAba('pedidos');
  let buscouEstoqueBi = false;
  win.DTBiPastaLocal.lerJson = async (nome) => { if (nome === 'produtos_estoque.json') buscouEstoqueBi = true; return { produtos: [] }; };
  win._pcpInternals.desenhar();
  const btn = document.querySelector('[data-pcp-refresh]');
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(buscouEstoqueBi, false);
});
