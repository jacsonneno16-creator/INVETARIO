// BUG AO VIVO REAL (2026-08-28): "mexeu mexeu e não arrumou nada" — o
// Service Worker gravava e procurava o cache de arquivos críticos (.js/
// .css/.html) só pelo caminho (u.pathname), IGNORANDO o "?v=..." que o
// resto do app usa pra cache-busting. Bastava UMA falha de rede (a mesma
// instabilidade real que apareceu no console do usuário —
// "WebChannelConnection... transport errored") pra esse fallback devolver
// a cópia ANTIGA, mesmo com uma versão nova publicada — nenhum ajuste de
// "?v=" surtia efeito porque o navegador nem chegava a pedir de novo.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
// CACHE é gerado automaticamente por scripts/build-sw.js (hash do conteúdo
// pré-cacheado) — nunca hardcodear o valor aqui, senão todo `npm run
// build:sw` quebra este teste sem nenhuma regressão real.
const CACHE_NAME = code.match(/var CACHE\s*=\s*'([^']+)'/)[1];

// Mock mínimo de CacheStorage/Cache do Service Worker — guarda por chave de
// URL COMPLETA (com querystring), igual o navegador de verdade faz.
function criarCachesFake(armazenamentoExterno) {
  const armazenamento = armazenamentoExterno || new Map();
  function criarCache() {
    const itens = new Map(); // chave: URL completa (string)
    return {
      put: async (req, res) => { const url = typeof req === 'string' ? req : req.url; itens.set(url, res); },
      match: async (req, opts) => {
        const url = typeof req === 'string' ? req : req.url;
        if (opts && opts.ignoreSearch) {
          // Igual o navegador de verdade: uma string de caminho ("/js/x.js")
          // é resolvida relativa à origem do próprio Service Worker.
          const caminhoAlvo = new URL(url, 'https://app.exemplo.com').pathname;
          for (const [chave, valor] of itens) { if (new URL(chave.split('?')[0], 'https://app.exemplo.com').pathname === caminhoAlvo) return valor; }
          return undefined;
        }
        return itens.get(url);
      },
      _itens: itens,
    };
  }
  return {
    open: async (nome) => { if (!armazenamento.has(nome)) armazenamento.set(nome, criarCache()); return armazenamento.get(nome); },
    match: async (req, opts) => {
      for (const c of armazenamento.values()) { const r = await c.match(req, opts); if (r) return r; }
      return undefined;
    },
    keys: async () => [...armazenamento.keys()],
    delete: async (nome) => armazenamento.delete(nome),
    _armazenamento: armazenamento,
  };
}

function montarSW({ redeDisponivel, versaoNoServidor, armazenamentoExterno }) {
  const listeners = {};
  const self = {
    addEventListener: (nome, fn) => { listeners[nome] = fn; },
    location: { origin: 'https://app.exemplo.com' },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const cachesFake = criarCachesFake(armazenamentoExterno);
  const fetchMock = async (input, opts) => {
    if (!redeDisponivel) throw new Error('Falha de rede simulada');
    const url = typeof input === 'string' ? input : input.url;
    return { ok: true, status: 200, clone: () => ({ _url: url, _corpo: versaoNoServidor }), _url: url, _corpo: versaoNoServidor };
  };
  const contexto = { self, caches: cachesFake, fetch: fetchMock, console, URL, Promise, Response: function (body, init) { return { body, ...init }; } };
  vm.createContext(contexto);
  vm.runInContext(code, contexto, { filename: 'sw.js' });
  return { listeners, cachesFake, contexto };
}

function criarRequisicao(url) { return { url, method: 'GET', mode: 'no-cors' }; }

test('Service Worker: grava o cache de um .js pela URL COMPLETA (com ?v=), não só pelo caminho', async () => {
  const { listeners, cachesFake } = montarSW({ redeDisponivel: true, versaoNoServidor: 'v2' });
  const req = criarRequisicao('https://app.exemplo.com/js/analista/89-compras-dashboard.js?v=NOVA');
  let resposta;
  await listeners.fetch({ request: req, respondWith: (p) => { resposta = p; }, waitUntil: (p) => p });
  await resposta;
  const cache = await cachesFake.open(CACHE_NAME);
  assert.ok(cache._itens.has('https://app.exemplo.com/js/analista/89-compras-dashboard.js?v=NOVA'), 'tem que gravar com a URL completa, versão incluída');
});

test('Service Worker: se a rede falhar, devolve a versão EXATA já guardada (com ?v=) em vez de uma versão antiga qualquer', async () => {
  const { listeners, cachesFake } = montarSW({ redeDisponivel: true, versaoNoServidor: 'v-antiga' });
  const reqAntiga = criarRequisicao('https://app.exemplo.com/js/analista/89-compras-dashboard.js?v=ANTIGA');
  let p1; await listeners.fetch({ request: reqAntiga, respondWith: (p) => { p1 = p; }, waitUntil: (p) => p }); await p1;

  // Simula: servidor já tem a versão NOVA publicada, mas a rede do usuário falha bem agora.
  // Reaproveita o MESMO Map de cache já populado (mesma sessão de navegador real).
  const swSemRede = montarSW({ redeDisponivel: false, versaoNoServidor: 'não deveria usar isso', armazenamentoExterno: cachesFake._armazenamento });

  const reqNova = criarRequisicao('https://app.exemplo.com/js/analista/89-compras-dashboard.js?v=ANTIGA');
  let p2; await swSemRede.listeners.fetch({ request: reqNova, respondWith: (p) => { p2 = p; }, waitUntil: (p) => p });
  const resultado = await p2;
  assert.equal(resultado._url, 'https://app.exemplo.com/js/analista/89-compras-dashboard.js?v=ANTIGA');
});

test('Service Worker: sem NENHUMA cópia da versão exata em cache e rede fora do ar, cai pro "ignoreSearch" (qualquer versão) só como último recurso', async () => {
  const primeiraVisita = montarSW({ redeDisponivel: true, versaoNoServidor: 'v-bem-antiga' });
  const reqV1 = criarRequisicao('https://app.exemplo.com/js/analista/89-compras-dashboard.js?v=V1');
  let p1; await primeiraVisita.listeners.fetch({ request: reqV1, respondWith: (p) => { p1 = p; }, waitUntil: (p) => p }); await p1;

  const semRedeAgora = montarSW({ redeDisponivel: false, versaoNoServidor: 'não deveria usar isso', armazenamentoExterno: primeiraVisita.cachesFake._armazenamento });

  // Pede uma versão NUNCA vista (v=V2) — não existe cópia exata, só a v=V1 antiga.
  const reqV2 = criarRequisicao('https://app.exemplo.com/js/analista/89-compras-dashboard.js?v=V2');
  let p2; await semRedeAgora.listeners.fetch({ request: reqV2, respondWith: (p) => { p2 = p; }, waitUntil: (p) => p });
  const resultado = await p2;
  assert.ok(resultado, 'melhor servir a versão antiga do que tela em branco quando está offline de verdade');
  assert.equal(resultado._url, 'https://app.exemplo.com/js/analista/89-compras-dashboard.js?v=V1');
});
