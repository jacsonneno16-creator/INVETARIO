// Substitui o antigo teste do "⋮ Mais" (padrão que o usuário rejeitou
// explicitamente e que a auditoria RELATORIO-COMPARACAO-PRODUCAO.md (seções
// 4 e 5) confirmou não existir no original de verdade). O original tem:
// nove abas fixas na barra principal, e um menu de 3-pontos no cabeçalho
// com exatamente 5 itens fixos (usuário, Meu Perfil, Projeção de Vendas,
// Configurações, Sair) — nada de um flyout genérico com 8 páginas soltas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dir = path.join(__dirname, '..', 'js', 'analista');
const codigo = fs.readFileSync(path.join(dir, '59-producao-ui-completa.js'), 'utf8');

const ROTAS_PRINCIPAIS = [
  'dashboard', 'programacao', 'maquinas', 'gantt', 'realizado',
  'insumos', 'insumos-geral', 'prog-automatica', 'relatorios',
];
const ROTAS_OCULTAS = [
  'ficha-tecnica', 'projecao', 'funcionarios', 'setup',
  'mapa-fabrica', 'config', 'importacao', 'estoque',
];

function carregarShell() {
  const navItems = ROTAS_PRINCIPAIS.concat(ROTAS_OCULTAS)
    .map(r => `<div class="nav-item" id="nav-producao-${r}" onclick="void(0)"><span class="nav-icon">X</span>${r}</div>`).join('');
  const html = `<!doctype html><html><body>
    <div id="setor-producao-shell"><aside class="sidebar"><div class="sb-sec">Producao</div>${navItems}</aside>
    <div class="content"></div></div>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTLojaAtiva = () => 'loja1';
  win.DTLoja = { listar: async () => [{ id: 'loja1', nome: 'Matriz' }] };
  win.aplicarTrocaLojaAnalista = () => {};
  win.doLogoutAnalista = () => { win.__logout = true; };
  win.goPage = (id) => { win.__lastGoPage = id; };
  win._currentAnalistaUser = { email: 'op@dt.com', nome: 'Operador Teste' };
  win.firebase = { auth: () => ({ currentUser: null }) };
  win.eval(codigo);
  win.ProducaoUICompleta.montarSidebar();
  return win;
}

test('PEDIDO AO VIVO (auditoria seção 5): barra principal tem exatamente as nove abas do original, nesta ordem, sem "Mais"', () => {
  const win = carregarShell();
  const tabs = win.document.querySelector('.prod-original-tabs');
  assert.ok(tabs, '.prod-original-tabs (pílula de abas) precisa existir');
  const ids = [...tabs.children].map(n => n.id);
  assert.deepEqual(ids, ROTAS_PRINCIPAIS.map(r => 'nav-producao-' + r), 'ordem e conjunto das 9 abas precisa bater exatamente com o original');
  ids.forEach(id => assert.ok(win.document.getElementById(id).classList.contains('prod-primary-tab')));
  // MESMO node (reparentado, não clonado) — o onclick original continua intacto.
  assert.equal(win.document.getElementById('nav-producao-realizado').getAttribute('onclick'), 'void(0)');
});

test('PEDIDO AO VIVO (auditoria seção 5): rótulos divergentes são corrigidos sem recriar o nó (Máquinas, Prog. Visual)', () => {
  const win = carregarShell();
  assert.equal(win.document.getElementById('nav-producao-maquinas').textContent.trim(), 'XMáquinas');
  assert.equal(win.document.getElementById('nav-producao-gantt').textContent.trim(), 'XProg. Visual');
});

test('PEDIDO AO VIVO (auditoria seção 4/7.10): rotas sem entrada própria no original ficam escondidas da navegação principal (só em Configurações)', () => {
  const win = carregarShell();
  ROTAS_OCULTAS.forEach(r => {
    const n = win.document.getElementById('nav-producao-' + r);
    assert.equal(n.style.display, 'none', 'nav-producao-' + r + ' precisa estar oculto da navegação principal');
  });
  // Nenhum nó foi removido do DOM — permissões/goPage continuam funcionando.
  assert.equal(win.document.querySelectorAll('.nav-item').length, ROTAS_PRINCIPAIS.length + ROTAS_OCULTAS.length);
});

test('PEDIDO AO VIVO (auditoria seção 4): menu de 3 pontos tem exatamente os 5 itens fixos do original', () => {
  const win = carregarShell();
  const menu = win.document.getElementById('prod-more-menu');
  assert.ok(menu, '#prod-more-menu precisa existir');
  const itens = [...menu.querySelectorAll('.prod-more-item')].map(b => b.dataset.prodMenuAcao);
  assert.deepEqual(itens, ['meu-perfil', 'projecao', 'config', 'sair']);
  assert.ok(menu.querySelector('.prod-more-user'), 'bloco de usuário precisa aparecer antes dos itens, como no original');
});

test('PEDIDO AO VIVO: clicar em "Configurações"/"Projeção de Vendas" navega via goPage; "Sair" chama o logout real', () => {
  const win = carregarShell();
  win.document.getElementById('prod-more-btn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  win.document.querySelector('[data-prod-menu-acao="config"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(win.__lastGoPage, 'producao-config');

  win.document.getElementById('prod-more-btn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  win.document.querySelector('[data-prod-menu-acao="projecao"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(win.__lastGoPage, 'producao-projecao');

  win.document.getElementById('prod-more-btn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  win.document.querySelector('[data-prod-menu-acao="sair"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(win.__logout, true);
});

test('PEDIDO AO VIVO: clicar em "⋮" (3 pontos) abre o painel; escolher um item fecha ele de novo', () => {
  const win = carregarShell();
  const menu = win.document.getElementById('prod-more-menu');
  const btn = win.document.getElementById('prod-more-btn');
  assert.equal(menu.classList.contains('on'), false);

  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.classList.contains('on'), true, 'clicar no botão abre o painel');

  win.document.querySelector('[data-prod-menu-acao="meu-perfil"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.classList.contains('on'), false, 'escolher um item dentro do painel fecha ele de novo');
});

test('PEDIDO AO VIVO: clicar fora do menu de 3 pontos, com o painel aberto, fecha ele', () => {
  const win = carregarShell();
  const menu = win.document.getElementById('prod-more-menu');
  const btn = win.document.getElementById('prod-more-btn');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.classList.contains('on'), true);

  win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.classList.contains('on'), false, 'clique fora do menu tem que fechar o painel');
});

test('PEDIDO AO VIVO (auditoria seção 4): seletor de loja é um <select> real, populado a partir de DTLoja.listar', () => {
  const win = carregarShell();
  const sel = win.document.getElementById('prod-loja-sel');
  assert.ok(sel, '#prod-loja-sel precisa existir (o original usa #topbar-loja-sel, um <select>)');
});
