// PEDIDO AO VIVO (2026-08-27): "tira tudo da bluesoft" — os 4 cards de
// busca (produtos/estoque/insumos/ficha técnica) que existiam aqui (ver
// histórico deste arquivo antes desta correção) foram removidos: todo esse
// dado já vem sozinho do SharePoint agora (sincronizarBiAgendado em
// functions/index.js). Só a limpeza do que a busca antiga já tinha gravado
// continua existindo — não tem equivalente novo, e o dado antigo (origem
// Bluesoft) ainda pode precisar ser removido manualmente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/76-producao-importacao.js'), 'utf8');

function carregarPagina() {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-importacao"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.getDTFirestore = () => ({ collection: () => ({ get: async () => ({ docs: [] }), doc: () => ({ get: async () => ({ exists: false }) }) }) });
  win.eval(code);
  return { win, document };
}

test('Importação/API: não existem mais os cards de busca (produtos/estoque/insumos/ficha técnica) — esse dado já vem do SharePoint', () => {
  const { win, document } = carregarPagina();
  win.renderProducaoImportacao('page-producao-importacao');
  const html = document.getElementById('page-producao-importacao').innerHTML;
  assert.doesNotMatch(html, /data-pimp-bluesoft-produtos|data-pimp-bluesoft-estoque|data-pimp-bluesoft-insumos|data-pimp-bluesoft-ficha/);
  assert.doesNotMatch(html, /🔎 Buscar produtos|🔎 Buscar estoque|🔎 Buscar insumos|🔎 Buscar ficha técnica/);
  assert.equal(typeof win.sincronizarBluesoftProdutos, 'undefined');
  assert.equal(typeof win.sincronizarBluesoftEstoque, 'undefined');
  assert.equal(typeof win.sincronizarBluesoftInsumos, 'undefined');
  assert.equal(typeof win.sincronizarBluesoftFicha, 'undefined');
});

test('Importação/API: a limpeza de dados antigos continua existindo, separada dos 6 blocos originais', () => {
  const { win, document } = carregarPagina();
  win.renderProducaoImportacao('page-producao-importacao');
  const html = document.getElementById('page-producao-importacao').innerHTML;
  const iLimpeza = html.indexOf('Limpeza de dados antigos');
  const iBackup = html.indexOf('Backup completo');
  const iSetup = html.indexOf('Setup e ficha técnica');
  const iBtnRuido = html.indexOf('data-pimp-limpar-bluesoft-ruido');
  const iBtnProdutos = html.indexOf('data-pimp-limpar-bluesoft-produtos-ruido');
  assert.ok(iBackup >= 0 && iSetup >= 0 && iLimpeza >= 0 && iBtnRuido >= 0 && iBtnProdutos >= 0);
  assert.ok(iBackup < iLimpeza, 'blocos originais devem vir antes do painel de limpeza');
  assert.ok(iSetup < iLimpeza, 'o último bloco original (Setup) deve vir antes do painel de limpeza');
});

test('Importação/API: não existe mais o painel próprio de configuração de API da Produção (URL/token/mapeamento) — só a limpeza em si', () => {
  const { win, document } = carregarPagina();
  win.renderProducaoImportacao('page-producao-importacao');
  const html = document.getElementById('page-producao-importacao').innerHTML;
  assert.doesNotMatch(html, /pimp-api-url|pimp-api-token|pimp-map-cod|data-pimp-api-salvar|data-pimp-api-testar|data-pimp-api-sync/);
  assert.equal(typeof win.salvarApiCfg, 'undefined');
  assert.equal(typeof win.sincronizarApi, 'undefined');
});

test('Importação/API: os dois botões de limpeza Bluesoft aparecem, cada um uma única vez', () => {
  const { win, document } = carregarPagina();
  win.renderProducaoImportacao('page-producao-importacao');
  const html = document.getElementById('page-producao-importacao').innerHTML;
  assert.equal((html.match(/data-pimp-limpar-bluesoft-ruido/g) || []).length, 1);
  assert.equal((html.match(/data-pimp-limpar-bluesoft-produtos-ruido/g) || []).length, 1);
});

test('clicar em "Limpar itens irrelevantes" ainda chama limparEstoqueBluesoftIrrelevante (função de limpeza preservada)', async () => {
  const { win, document } = carregarPagina();
  const chamadas = [];
  win.confirm = () => true;
  win.showToast = () => {};
  win.limparEstoqueBluesoftIrrelevante = async (previa) => { chamadas.push(previa); return previa ? { candidatos: 3, total: 10 } : { removidos: 3 }; };
  win.renderProducaoImportacao('page-producao-importacao');
  document.querySelector('[data-pimp-limpar-bluesoft-ruido]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(chamadas, [true, false]);
});

// PEDIDO AO VIVO (2026-08-27): "vou apagar todo o banco... só estoque,
// pedido antigo da Bluesoft" — botão dedicado, separado da limpeza de
// ruído acima, que chama a Cloud Function limparDadosAntigosBluesoftAgora
// (functions/index.js) — nunca mexe no dado novo do SharePoint nem em
// cadastro/configuração.
test('clicar em "Apagar dado antigo da Bluesoft" chama a Cloud Function certa e mostra o total removido', async () => {
  const { win, document } = carregarPagina();
  let funcaoChamada = '';
  win.confirm = () => true;
  win.showToast = () => {};
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: (nome) => { funcaoChamada = nome; return async () => ({ data: { ok: true, resultados: [{ loja: 'Loja 1', limpeza: { estoque: { removidos: 2 }, pedidos: { removidos: 1 }, agendamentos: { removidos: 0 } } }] } }); } }) }) };
  win.renderProducaoImportacao('page-producao-importacao');
  document.querySelector('[data-pimp-limpar-bluesoft-dado-antigo]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(funcaoChamada, 'limparDadosAntigosBluesoftAgora');
  const status = document.getElementById('pimp-limpar-bluesoft-status').textContent;
  assert.match(status, /3 registro\(s\)/);
});

test('botão de apagar dado antigo da Bluesoft pede confirmação antes de chamar a função', async () => {
  const { win, document } = carregarPagina();
  let confirmado = false, chamou = false;
  win.confirm = () => { confirmado = true; return false; };
  win.showToast = () => {};
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: () => { chamou = true; return async () => ({ data: { ok: true, resultados: [] } }); } }) }) };
  win.renderProducaoImportacao('page-producao-importacao');
  document.querySelector('[data-pimp-limpar-bluesoft-dado-antigo]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(confirmado);
  assert.ok(!chamou, 'cancelar a confirmação não pode chamar a função de apagar');
});
