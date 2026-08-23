// PEDIDO AO VIVO (auditoria 2ª rodada, seção 13): o original
// (index.html:467-581, panel-importacao) não tem BlueSoft em lugar
// nenhum — 6 blocos originais (Backup/Programação/Estoque insumos/
// Projeção/Estoque PA/Setup) + Integração API + Histórico. Os 4 cards de
// sincronização BlueSoft (recurso exclusivo desta integração) estavam
// misturados no MESMO grid dos 6 originais. Este teste dirige o render
// real e confirma que agora existe um grupo "🔗 Integração BlueSoft"
// visualmente separado, com os blocos originais aparecendo primeiro.
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

test('Importação/API: existe um grupo "Integração BlueSoft" separado, marcado como recurso exclusivo', () => {
  const { win, document } = carregarPagina();
  win.renderProducaoImportacao('page-producao-importacao');
  const html = document.getElementById('page-producao-importacao').innerHTML;
  assert.match(html, /🔗 Integração BlueSoft/);
  assert.match(html, /recurso exclusivo desta integração/);
});

test('Importação/API: os cards BlueSoft não aparecem mais dentro do grid dos 6 blocos originais', () => {
  const { win, document } = carregarPagina();
  win.renderProducaoImportacao('page-producao-importacao');
  const html = document.getElementById('page-producao-importacao').innerHTML;
  const iBlueGroup = html.indexOf('🔗 Integração BlueSoft');
  const iBackup = html.indexOf('Backup completo');
  const iSetup = html.indexOf('Setup e ficha técnica');
  const iBlueCard = html.indexOf('Sincronizar produtos');
  assert.ok(iBackup >= 0 && iSetup >= 0 && iBlueGroup >= 0 && iBlueCard >= 0);
  assert.ok(iBackup < iBlueGroup, 'blocos originais devem vir antes do grupo BlueSoft');
  assert.ok(iSetup < iBlueGroup, 'o último bloco original (Setup) deve vir antes do grupo BlueSoft');
  assert.ok(iBlueCard > iBlueGroup, 'os cards de sincronização devem estar DENTRO do grupo BlueSoft, não antes dele');
});

test('Importação/API: limpeza BlueSoft não duplica mais nos "Dados importados"', () => {
  const { win, document } = carregarPagina();
  win.renderProducaoImportacao('page-producao-importacao');
  const html = document.getElementById('page-producao-importacao').innerHTML;
  const ocorrencias = (html.match(/data-pimp-limpar-bluesoft-ruido/g) || []).length;
  assert.equal(ocorrencias, 1, 'o botão de limpeza BlueSoft deveria existir uma única vez, dentro do grupo BlueSoft');
});
