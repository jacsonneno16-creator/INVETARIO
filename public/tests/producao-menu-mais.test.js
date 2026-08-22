// Pedido ao vivo do usuário: a barra de abas do Produção mostrava TODOS os
// 16 itens do menu original de uma vez (a mesma barra horizontal +
// wrapping deixava um bloco de itens "sobrando" com aparência de menu
// duplicado). Pedido: só o fluxo do dia a dia fica na barra principal; o
// resto entra num "⋮ Mais" — mesmo padrão de flyout já usado em Usuários e
// Permissões. O CSS (.prod-more-wrap/.prod-more-menu) já existia em
// producao-completa.css mas nunca tinha sido ligado a nenhum elemento —
// por isso só um teste de EXECUÇÃO real (não regex no texto) prova que a
// funcionalidade existe de verdade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dir = path.join(__dirname, '..', 'js', 'analista');
const codigo = fs.readFileSync(path.join(dir, '59-producao-ui-completa.js'), 'utf8');

const ROTAS = [
  'dashboard', 'ficha-tecnica', 'maquinas', 'programacao', 'gantt', 'realizado',
  'insumos', 'projecao', 'prog-automatica', 'funcionarios', 'relatorios', 'setup',
  'mapa-fabrica', 'config', 'importacao', 'estoque',
];

function carregarShell() {
  const navItems = ROTAS.map(r => `<div class="nav-item" id="nav-producao-${r}" onclick="void(0)">${r}</div>`).join('');
  const html = `<!doctype html><html><body>
    <div id="setor-producao-shell"><aside class="sidebar"><div class="sb-sec">Producao</div>${navItems}</aside>
    <div class="content"></div></div>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTLojaAtiva = () => 'loja1';
  win.DTLoja = { listar: async () => [] };
  win.firebase = { auth: () => ({ currentUser: null }) };
  win.eval(codigo);
  win.ProducaoUICompleta.montarSidebar();
  return win;
}

test('PEDIDO AO VIVO: "⋮ Mais" existe de verdade — reparenta (não recria) os itens secundários do menu original, preservando onclick/permissões', () => {
  const win = carregarShell();
  const menu = win.document.getElementById('prod-more-menu');
  assert.ok(menu, 'painel #prod-more-menu precisa existir');
  const idsNoMenu = [...menu.children].map(n => n.id);
  // Os itens do dia a dia continuam na barra principal, fora do menu.
  ['nav-producao-dashboard', 'nav-producao-programacao', 'nav-producao-maquinas', 'nav-producao-gantt', 'nav-producao-realizado', 'nav-producao-insumos', 'nav-producao-prog-automatica', 'nav-producao-relatorios'].forEach(id => {
    assert.ok(!idsNoMenu.includes(id), id + ' é item do dia a dia, não pode estar dentro do "Mais"');
    assert.ok(win.document.getElementById(id).classList.contains('prod-primary-tab'), id + ' precisa estar na barra principal');
  });
  // O resto (cadastro/config/uso ocasional) foi pro menu.
  ['nav-producao-ficha-tecnica', 'nav-producao-projecao', 'nav-producao-funcionarios', 'nav-producao-setup', 'nav-producao-mapa-fabrica', 'nav-producao-config', 'nav-producao-importacao', 'nav-producao-estoque'].forEach(id => {
    assert.ok(idsNoMenu.includes(id), id + ' precisa estar dentro do "⋮ Mais"');
  });
  assert.equal(idsNoMenu.length, 8);
  // MESMO node (reparentado, não clonado) — o onclick original continua intacto.
  assert.equal(win.document.getElementById('nav-producao-config').getAttribute('onclick'), 'void(0)');
});

test('PEDIDO AO VIVO: clicar em "⋮ Mais" abre o painel; clicar num item dentro dele fecha o painel de novo', () => {
  const win = carregarShell();
  const menu = win.document.getElementById('prod-more-menu');
  const btn = win.document.getElementById('prod-more-btn');
  assert.ok(btn, 'botão "⋮ Mais" precisa existir');
  assert.equal(menu.classList.contains('on'), false);

  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.classList.contains('on'), true, 'clicar no botão abre o painel');

  menu.children[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.classList.contains('on'), false, 'escolher um item dentro do painel fecha ele de novo');
});

test('PEDIDO AO VIVO: clicar fora do "⋮ Mais" com o painel aberto fecha ele', () => {
  const win = carregarShell();
  const menu = win.document.getElementById('prod-more-menu');
  const btn = win.document.getElementById('prod-more-btn');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.classList.contains('on'), true);

  win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.classList.contains('on'), false, 'clique fora do menu tem que fechar o painel');
});

test('estrutura: nenhum item aparece duas vezes (nem na barra, nem faltando)', () => {
  const win = carregarShell();
  const barra = [...win.document.querySelectorAll('.prod-primary-tab')].map(n => n.id);
  const menu = [...win.document.getElementById('prod-more-menu').children].map(n => n.id);
  const todos = barra.concat(menu);
  assert.equal(todos.length, ROTAS.length, 'todo item do menu original tem que aparecer em algum lugar (barra ou "Mais"), nunca duas vezes nem nenhuma');
  assert.equal(new Set(todos).size, todos.length, 'nenhum id repetido entre a barra e o "Mais"');
});
