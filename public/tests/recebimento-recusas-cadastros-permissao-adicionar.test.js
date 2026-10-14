// BUG AO VIVO REAL (2026-10-14): "aperto Adicionar [motivo de devolução] e
// fala que não tenho permissão". recebimento-recusas-cadastros só tem
// 'visualizar' no catálogo (criar/editar/excluir são de propósito a MESMA
// permissão de recebimento-recusas, por rules — ver comentário em
// 37-usuarios-permissoes.js). A 2ª camada global de permissões
// (document.addEventListener('click',...,true)) infere a ação pelo texto
// do botão quando ele não declara data-perm-acao; "Adicionar" bate no
// regex de 'criar', e como a página ativa é recebimento-recusas-cadastros
// (sem 'criar' no catálogo), a checagem negava sempre, pra todo mundo.
// Fix: os botões Adicionar agora declaram explicitamente
// data-perm-modulo="recebimento-recusas" data-perm-acao="criar" — a MESMA
// permissão que o comentário sempre disse que devia valer.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const recusasCode = fs.readFileSync(path.join(base, '97-recebimento-recusas.js'), 'utf8');
const permCode = fs.readFileSync(path.join(base, '37-usuarios-permissoes.js'), 'utf8');

test('botões "Adicionar" (motorista/motivo/conferente) declaram data-perm-modulo="recebimento-recusas" data-perm-acao="criar" explícito', () => {
  const trechoMotivo = recusasCode.match(/data-recusa-add="\$\{tipo\}"[^>]*>Adicionar/g) || [];
  assert.ok(trechoMotivo.length >= 2, 'os 2 blocos de Adicionar (motorista-manual e motivo/conferente) precisam existir');
  trechoMotivo.forEach(t => {
    assert.match(t, /data-perm-modulo="recebimento-recusas"/);
    assert.match(t, /data-perm-acao="criar"/);
  });
});

test('REGRESSÃO: clicar em "Adicionar" motivo não é bloqueado pela 2ª camada global de permissões quando o analista TEM recebimento-recusas.criar', () => {
  const dom = new JSDOM('<!doctype html><html><body><div class="page on" id="page-recebimento-recusas-cadastros"><div style="display:flex;gap:7px"><input class="field" id="recusas-motivo-novo"><button type="button" class="btn btn-primary btn-sm" data-recusa-add="motivo" data-perm-modulo="recebimento-recusas" data-perm-acao="criar">Adicionar</button></div></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const toasts = [];
  win.showToast = m => toasts.push(m);
  win.DT_USUARIO_ACESSO_ATUAL = { permissoes: { 'recebimento-recusas': { visualizar: true, criar: true } } };
  win.eval(permCode);

  document.querySelector('[data-recusa-add="motivo"]').click();

  assert.deepEqual(toasts, [], 'nenhum toast de "sem permissão" ao clicar em Adicionar, pra quem tem recebimento-recusas.criar');
});

test('REGRESSÃO (sanity check inverso): quem NÃO tem recebimento-recusas.criar continua corretamente barrado (não virou liberar geral por engano)', () => {
  const dom = new JSDOM('<!doctype html><html><body><div class="page on" id="page-recebimento-recusas-cadastros"><div style="display:flex;gap:7px"><input class="field" id="recusas-motivo-novo"><button type="button" class="btn btn-primary btn-sm" data-recusa-add="motivo" data-perm-modulo="recebimento-recusas" data-perm-acao="criar">Adicionar</button></div></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const toasts = [];
  win.showToast = m => toasts.push(m);
  win.DT_USUARIO_ACESSO_ATUAL = { permissoes: { 'recebimento-recusas': { visualizar: true, criar: false } } };
  win.eval(permCode);

  document.querySelector('[data-recusa-add="motivo"]').click();

  assert.ok(toasts.some(t => /possui permiss/.test(t)), 'sem recebimento-recusas.criar, o clique precisa continuar barrado — isso é intencional');
});
