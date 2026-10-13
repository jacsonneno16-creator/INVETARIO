'use strict';
// PEDIDO AO VIVO (2026-10-02): "não quero que o nome das permissões fiquem
// só nisso visualizar, quero que tenha esse nome completo da tela... não
// em todas as permissões tá o número e visualizar, apagar, etc." — o
// popup "🔐 Permissões desta tela" (abrirPermissoesTela(),
// 123-configuracoes-sistema.js) mostrava só "{número} {ação}" por linha
// (ex.: "39165  Visualizar"), sem repetir o nome da tela — o usuário
// pediu o formato "{número} - {Nome completo da tela}: {Ação}", igual a
// um exemplo real de outro sistema (WMS) que ele mostrou.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '..', 'js', 'analista');
const permCode = fs.readFileSync(path.join(base, '37-usuarios-permissoes.js'), 'utf8');
const cfgCode = fs.readFileSync(path.join(base, '123-configuracoes-sistema.js'), 'utf8');

function carregar(pageIdAtual) {
  const dom = new JSDOM(`<!doctype html><html><body><div class="page on" id="page-${pageIdAtual}"></div></body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  win.eval(permCode);
  win.eval(cfgCode);
  return { win, document: win.document };
}

test('abrirPermissoesTela: cada linha mostra "{código} - {nome completo da tela}: {ação}", não só a ação sozinha', () => {
  const { win, document } = carregar('recebimento-patio-inventarios');
  win.abrirPermissoesTela();
  const lista = document.getElementById('dt-page-permissions');
  assert.ok(lista, 'o modal de permissões da tela deveria ter sido criado');
  const html = lista.querySelector('.dt-page-perm-list').innerHTML;
  assert.match(html, /Recebimento · Inventários do Pátio \(Relatório\): Visualizar/, 'precisa repetir o nome completo da tela junto da ação, não só "Visualizar" sozinho');
  assert.doesNotMatch(html, /<span>Visualizar<\/span>/, 'a ação sozinha, sem o nome da tela na frente, não pode mais aparecer');
});

test('abrirPermissoesTela: tela com mais de 1 ação mostra o nome completo repetido em cada linha (não só na 1ª)', () => {
  const { win, document } = carregar('recebimento-recusas');
  win.abrirPermissoesTela();
  const html = document.querySelector('.dt-page-perm-list').innerHTML;
  assert.match(html, /Recebimento · Notas Retornadas: Visualizar/);
  assert.match(html, /Recebimento · Notas Retornadas: Exportar/);
});

test('ROTULOS: toda ação usada em algum MODULOS tem um rótulo descritivo cadastrado (nenhuma cai pro texto cru da chave, ex.: "liberar"/"resetar")', () => {
  const inicio = permCode.indexOf('const MODULOS=[');
  const fim = permCode.indexOf('\n  ];', inicio);
  const trechoModulos = permCode.slice(inicio, fim);
  const acoesUsadas = new Set();
  const reAcoes = /acoes:\[([^\]]*)\]/g;
  let m;
  while ((m = reAcoes.exec(trechoModulos))) {
    m[1].split(',').forEach(s => { const v = s.trim().replace(/^'/, '').replace(/'$/, ''); if (v) acoesUsadas.add(v); });
  }
  const iniR = permCode.indexOf('const ROTULOS=');
  const fimR = permCode.indexOf('};', iniR) + 1;
  const trechoRotulos = permCode.slice(iniR, fimR);
  const semRotulo = [...acoesUsadas].filter(a => !trechoRotulos.includes("'" + a + "'") && !new RegExp(a + ':').test(trechoRotulos));
  assert.deepEqual(semRotulo, [], 'ação(ões) sem rótulo descritivo em ROTULOS — adicione uma entrada lá');
});
