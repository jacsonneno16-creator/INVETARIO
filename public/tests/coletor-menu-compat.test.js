// Coletor > menu "⋮" (3 pontinhos) — 20-menu-compat.js.
// BUG AO VIVO REAL (2026-09-04): "os 3 pontinhos funciona na tela de login e
// na tela que mostra inventario e recebimento, nas outras telas algumas
// aparece mas não funciona" — a lista de pares botão/dropdown era FIXA (só
// 5 entradas: login, acesso, mode, recebimento, bare) e cada tela nova
// (screen-recebimento-modo, screen-paletes-menu, screen-nova-movimentacao-
// menu...) ficava sem o clique funcionar, porque nunca tinha sido
// adicionada na lista. Corrigido pra descobrir TODO par
// `btn-menu3pts...`/`menu3pts-dropdown...` já presente no DOM.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../js/coletor/20-menu-compat.js'), 'utf8');

function montarTela(idsExtras) {
  const extras = (idsExtras || []).map(id => `
    <button id="btn-menu3pts-${id}"></button>
    <div id="menu3pts-dropdown-${id}" style="display:none"></div>
    <span id="${id}-ver-label"></span>
  `).join('');
  const html = `<!doctype html><html><body>
    <button id="btn-menu3pts"></button><div id="menu3pts-dropdown" style="display:none"></div>
    <span id="app-ver-label"></span>
    ${extras}
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.APP_VERSION = 'v999';
  win.eval(code);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  return { win, document: win.document };
}

test('botão "bare" (btn-menu3pts, sem sufixo) continua abrindo/fechando o dropdown correspondente', () => {
  const { document } = montarTela([]);
  const botao = document.getElementById('btn-menu3pts');
  const dropdown = document.getElementById('menu3pts-dropdown');
  botao.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(dropdown.style.display, 'block');
  botao.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(dropdown.style.display, 'none');
});

test('CORREÇÃO ESTRUTURAL: qualquer tela nova (id arbitrário, nunca visto antes) já funciona sem editar este arquivo', () => {
  const { document } = montarTela(['recebimento-modo', 'paletes-menu', 'nova-movimentacao-menu', 'uma-tela-que-nao-existia-quando-isso-foi-escrito']);
  ['recebimento-modo', 'paletes-menu', 'nova-movimentacao-menu', 'uma-tela-que-nao-existia-quando-isso-foi-escrito'].forEach(id => {
    const botao = document.getElementById('btn-menu3pts-' + id);
    const dropdown = document.getElementById('menu3pts-dropdown-' + id);
    assert.equal(dropdown.style.display, 'none', 'começa fechado: ' + id);
    botao.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
    assert.equal(dropdown.style.display, 'block', 'deveria abrir ao clicar: ' + id);
  });
});

test('abrir um menu fecha qualquer outro que já estivesse aberto (nunca 2 abertos ao mesmo tempo)', () => {
  const { document } = montarTela(['tela-a', 'tela-b']);
  const botaoA = document.getElementById('btn-menu3pts-tela-a');
  const botaoB = document.getElementById('btn-menu3pts-tela-b');
  const dropdownA = document.getElementById('menu3pts-dropdown-tela-a');
  const dropdownB = document.getElementById('menu3pts-dropdown-tela-b');
  botaoA.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(dropdownA.style.display, 'block');
  botaoB.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(dropdownB.style.display, 'block');
  assert.equal(dropdownA.style.display, 'none', 'abrir o de B tem que fechar o de A');
});

test('clicar fora de qualquer botão/dropdown fecha tudo', () => {
  const { document } = montarTela(['tela-a']);
  const botaoA = document.getElementById('btn-menu3pts-tela-a');
  const dropdownA = document.getElementById('menu3pts-dropdown-tela-a');
  botaoA.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(dropdownA.style.display, 'block');
  document.body.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(dropdownA.style.display, 'none');
});

test('CORREÇÃO ESTRUTURAL: todo "*-ver-label" no DOM recebe a versão, não só a lista fixa antiga', () => {
  const { document } = montarTela(['recebimento-modo', 'paletes-menu']);
  assert.equal(document.getElementById('app-ver-label').textContent, 'v999');
  assert.equal(document.getElementById('recebimento-modo-ver-label').textContent, 'v999');
  assert.equal(document.getElementById('paletes-menu-ver-label').textContent, 'v999');
});
