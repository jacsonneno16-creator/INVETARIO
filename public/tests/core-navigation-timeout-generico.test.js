// BUG AO VIVO REAL (2026-09-09): "nenhuma tela do sistema todo não mostra
// nada" — _callPage() (03-core-navigation.js) ganhou um aviso genérico que
// cobre TODA tela do sistema com "Não foi possível carregar esta tela" +
// botão "Tentar novamente" quando a Promise de render REJEITA de verdade
// (ex.: permission-denied) — antes disso, uma rejeição numa tela sem
// tratamento próprio só aparecia no console, sem feedback nenhum pro
// usuário. Telas que já cuidam do próprio carregamento/erro (Dashboard,
// Status de Retornos, Recebimentos) marcam a Promise que devolvem com
// `.__dtBackground = true` pra esse aviso genérico não cobrir por cima o
// aviso específico delas.
//
// SEM TIMEOUT ARTIFICIAL DE PROPÓSITO (2026-09-09, revisão desta mesma
// correção): uma versão anterior chegou a ter um `window.comTimeout`
// genérico aqui (Promise.race com um limite de segundos). Removido —
// Promise.race com timeout NÃO cancela a busca real, só desiste de
// esperar; numa consulta grande que só é lenta (não travada de verdade),
// isso transformava "vai chegar, só demorou" em "sempre mostra erro".
// Agora só reage a rejeição REAL — uma Promise que nunca resolve nem
// rejeita fica em "Carregando..." (a estrutura da tela já aparece por
// fora disso — ver 91/93/99), sem timeout nenhum forçando um erro falso.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../js/analista/03-core-navigation.js'), 'utf8');

function carregar() {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-title"></div><div class="page on" id="page-dashboard"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(code);
  return { win, document: win.document };
}

test('_callPage: Promise SEM __dtBackground que REJEITA de verdade mostra o aviso genérico com "Tentar novamente"', async () => {
  const { win, document } = carregar();
  win.renderDashboard = () => Promise.reject(new Error('permission-denied'));

  win.AnalistaNavigation.renderPage('dashboard');
  await new Promise(r => setTimeout(r, 0));

  const pagina = document.getElementById('page-dashboard');
  assert.match(pagina.innerHTML, /Não foi possível carregar esta tela/, 'uma rejeição real precisa aparecer pro usuário, não só no console');
  assert.ok(pagina.querySelector('[data-recarregar-pagina="dashboard"]'), 'precisa ter o botão de tentar de novo');
});

test('_callPage: Promise SEM __dtBackground que nunca resolve nem rejeita NÃO aciona nenhum aviso (sem timeout artificial)', async () => {
  const { win, document } = carregar();
  win.renderDashboard = () => new Promise(() => {}); // nunca resolve nem rejeita — simula consulta só lenta

  win.AnalistaNavigation.renderPage('dashboard');
  await new Promise(r => setTimeout(r, 0));

  const pagina = document.getElementById('page-dashboard');
  assert.doesNotMatch(pagina.innerHTML, /Não foi possível carregar esta tela/, 'uma consulta só lenta (não rejeitada) não pode virar erro falso por timeout');
});

test('_callPage: Promise marcada com __dtBackground=true NUNCA aciona o aviso genérico, mesmo rejeitando', async () => {
  const { win, document } = carregar();
  const p = Promise.reject(new Error('erro tratado pela própria tela'));
  p.__dtBackground = true;
  p.catch(() => {}); // evita unhandledRejection no teste — a própria tela trata isso
  win.renderDashboard = () => p;

  win.AnalistaNavigation.renderPage('dashboard');
  await new Promise(r => setTimeout(r, 0));

  const pagina = document.getElementById('page-dashboard');
  assert.doesNotMatch(pagina.innerHTML, /Não foi possível carregar esta tela/, 'o aviso genérico não pode cobrir uma tela que já cuida do próprio erro');
});

test('REGRESSÃO (mecânica JS, não bug nosso): confirma por que a tela de render precisa ser função comum, não async, pra usar __dtBackground', () => {
  async function comoAsyncFunction() {
    const p = Promise.resolve(1);
    p.__dtBackground = true;
    return p; // "return" dentro de async function embrulha numa Promise NOVA
  }
  function comumSemAsync() {
    const p = Promise.resolve(1);
    p.__dtBackground = true;
    return p; // devolve o MESMO objeto, marcação sobrevive
  }
  assert.equal(comoAsyncFunction().__dtBackground, undefined, 'async function perde a marcação — não pode ser usada assim');
  assert.equal(comumSemAsync().__dtBackground, true, 'função comum preserva a marcação — é o padrão certo');
});
