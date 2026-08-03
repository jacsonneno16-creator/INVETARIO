'use strict';
/**
 * Testes da defesa central de innerHTML (js/shared/common-utils.js) e dos
 * helpers de escape. Usa jsdom porque o sanitizador depende de
 * window.Element / window.DOMParser (é uma proteção que sobrescreve o
 * setter de innerHTML no protótipo de Element).
 *
 * Requer `jsdom` como devDependency (ver package.json / npm install).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function novoAmbiente() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const codigo = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'shared', 'common-utils.js'),
    'utf8'
  );
  dom.window.eval(codigo);
  return dom.window;
}

test('escHTML: escapa os cinco caracteres perigosos de HTML', () => {
  const win = novoAmbiente();
  assert.equal(
    win.escHTML(`<script>alert('x')</script>&"'`),
    '&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;&amp;&quot;&#039;'
  );
});

test('escHTML: valores null/undefined viram string vazia', () => {
  const win = novoAmbiente();
  assert.equal(win.escHTML(null), '');
  assert.equal(win.escHTML(undefined), '');
});

test('innerHTML: remove tags <script> injetadas', () => {
  const win = novoAmbiente();
  const div = win.document.createElement('div');
  div.innerHTML = '<b>ok</b><script>window.__pwned = true;</script>';
  assert.equal(win.__pwned, undefined);
  assert.ok(!div.innerHTML.includes('<script'));
  assert.ok(div.innerHTML.includes('<b>ok</b>'));
});

test('innerHTML: remove atributos on* (event handlers inline)', () => {
  const win = novoAmbiente();
  const div = win.document.createElement('div');
  div.innerHTML = '<img src="x.png" onerror="window.__pwned=true">';
  const img = div.querySelector('img');
  assert.equal(img.getAttribute('onerror'), null);
});

test('innerHTML: remove href/src com esquema javascript:', () => {
  const win = novoAmbiente();
  const div = win.document.createElement('div');
  div.innerHTML = '<a href="javascript:alert(1)">clique</a>';
  const a = div.querySelector('a');
  assert.equal(a.getAttribute('href'), null);
});

test('innerHTML: remove srcset com esquema perigoso (gap corrigido)', () => {
  const win = novoAmbiente();
  const div = win.document.createElement('div');
  div.innerHTML = '<img src="ok.png" srcset="javascript:alert(1) 1x, ok.png 2x">';
  const img = div.querySelector('img');
  assert.equal(img.getAttribute('srcset'), null);
});

test('innerHTML: remove style com expression() (gap corrigido)', () => {
  const win = novoAmbiente();
  const div = win.document.createElement('div');
  div.innerHTML = '<div style="width:expression(alert(1))">x</div>';
  const alvo = div.querySelector('div');
  assert.equal(alvo.getAttribute('style'), null);
});

test('innerHTML: remove style com url(javascript:...) (gap corrigido)', () => {
  const win = novoAmbiente();
  const div = win.document.createElement('div');
  div.innerHTML = '<div style="background:url(javascript:alert(1))">x</div>';
  const alvo = div.querySelector('div');
  assert.equal(alvo.getAttribute('style'), null);
});

test('innerHTML: preserva style legítimo', () => {
  const win = novoAmbiente();
  const div = win.document.createElement('div');
  div.innerHTML = '<div style="color:red;font-weight:700">x</div>';
  const alvo = div.querySelector('div');
  assert.equal(alvo.getAttribute('style'), 'color:red;font-weight:700');
});

test('innerHTML: preserva markup legítimo (tabelas, listas, etc.)', () => {
  const win = novoAmbiente();
  const div = win.document.createElement('div');
  div.innerHTML = '<table><tr><td class="cel">valor</td></tr></table>';
  assert.ok(div.querySelector('table td.cel'));
  assert.equal(div.querySelector('td').textContent, 'valor');
});
