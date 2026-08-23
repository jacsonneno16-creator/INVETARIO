// PEDIDO AO VIVO (auditoria 2ª rodada, seção 13): Configurações no
// original é um overlay de página inteira de verdade (#settings-page,
// index.html:984: position:fixed;inset:0;z-index:500), com topbar
// própria de 52px (só "‹ Voltar" + "⚙ Configurações") e sidebar 210px —
// não o card-dentro-do-fluxo-normal que existia aqui antes (que só
// escondia a pílula de abas, mas deixava logo/loja/tema/3-pontos
// visíveis). Este teste confere o CSS real (não só que a classe existe,
// mas que ela declara position:fixed/inset:0/z-index:500) e dirige o
// render real de 77-producao-config.js pra confirmar a topbar/sidebar/
// conteúdo, incluindo os itens novos de Administração (Gestão de Lojas/
// Usuários do Sistema) abrindo o modal real existente, não uma tela nova.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css/producao-completa.css'), 'utf8');
const code = fs.readFileSync(path.join(root, 'js/analista/77-producao-config.js'), 'utf8');

test('CSS: .prod-config-modo é um overlay de tela cheia de verdade (fixed/inset:0/z-index:500)', () => {
  const bloco = css.match(/#setor-producao-shell\.prod-config-modo\{[^}]*\}/);
  assert.ok(bloco, 'regra #setor-producao-shell.prod-config-modo deveria existir');
  assert.match(bloco[0], /position:fixed/);
  assert.match(bloco[0], /inset:0/);
  assert.match(bloco[0], /z-index:500/);
  assert.match(css, /#setor-producao-shell\.prod-config-modo>aside\{display:none/, 'cabeçalho/abas originais (aside) devem sumir por completo em modo Configurações');
});

test('CSS: sidebar e conteúdo usam as medidas exatas do original (210px / 12px 8px / 16px 20px)', () => {
  assert.match(css, /\.prod-config-sidebar\{width:210px[^}]*padding:12px 8px/);
  assert.match(css, /\.prod-config-content\{[^}]*padding:16px 20px/);
  assert.match(css, /\.prod-config-topbar\{[^}]*height:52px/);
});

function carregarPagina() {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-config"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.getDTFirestore = () => ({ collection: () => ({ get: async () => ({ docs: [] }), doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }) });
  win.abrirModalConfiguracoes = () => { win.__modalAberto = null; };
  win.abrirModalConfiguracoes = (aba) => { win.__modalAberto = aba; };
  win.eval(code);
  return { win, document };
}

test('Configurações: renderiza topbar (52px) + sidebar + conteúdo, sem título grande dentro do fluxo', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoConfig();
  const html = document.getElementById('page-producao-config').innerHTML;
  assert.match(html, /class="prod-config-topbar"/);
  assert.match(html, /class="prod-config-sidebar"/);
  assert.match(html, /class="prod-config-content"/);
  assert.match(html, /⚙ Configurações/);
  assert.doesNotMatch(html, /Configurações de Produção/, 'título grande antigo não deveria mais existir');
});

test('Configurações: "Gestão de Lojas" e "Usuários do Sistema" abrem o modal real existente, não uma tela nova', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoConfig();
  document.querySelector('[data-pcfg-secao="gestao-lojas"]').click();
  assert.equal(win.__modalAberto, 'lojas');
  document.querySelector('[data-pcfg-secao="usuarios"]').click();
  assert.equal(win.__modalAberto, 'operadores');
});
