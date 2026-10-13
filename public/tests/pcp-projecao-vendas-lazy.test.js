const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lazyPath = path.join(__dirname, '../js/analista/00-lazy-areas.js');
const projPath = path.join(__dirname, '../js/analista/66-producao-projecao.js');
const htmlPath = path.join(__dirname, '../analista.html');
const lazyCode = fs.readFileSync(lazyPath, 'utf8');
const projCode = fs.readFileSync(projPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

test('PCP não carrega mais a Projeção de Vendas duplicada da Produção', () => {
  const document={baseURI:'https://app.local/',scripts:[],createElement:()=>({}),head:{appendChild:()=>{}}};
  const window={document};vm.runInNewContext(lazyCode,{window,document,URL,Promise,Array,Error});
  assert.ok(!window._lazyAreasInternals.AREAS.pcp.some(src=>/66-producao-projecao\.js/.test(src)));
  assert.ok(window._lazyAreasInternals.AREAS.producao.some(src=>/66-producao-projecao\.js/.test(src)),'módulo continua pertencendo à Produção');
});

test('carregar 66-producao-projecao registra a função sem ler Firestore no carregamento', () => {
  let firestoreChamado = 0;
  const document = { addEventListener: () => {}, querySelectorAll: () => [], getElementById: () => null };
  const window = {
    document,
    getDTFirestore(){ firestoreChamado++; throw new Error('Firestore não deve ser lido no load do módulo'); },
    DTProducao: { registrarInvalidacao: () => {} }
  };
  const ctx = { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise };
  vm.runInNewContext(projCode, ctx);
  assert.equal(typeof window.abrirProjecaoVendasPcp, 'function');
  assert.equal(firestoreChamado, 0);
});

test('menu PCP remove a Projeção duplicada e usa cache da reorganização', () => {
  assert.doesNotMatch(html, /nav-pcp-projecao-vendas/);
  assert.doesNotMatch(html, /onclick="abrirProjecaoVendasPcp\(this\)"/);
  // Só confirma que o cache-bust de 00-lazy-areas.js existe — travar o
  // valor exato quebra a cada bump de versão real (ex.: 2026-10-02,
  // Inventários do Pátio).
  assert.match(html, /00-lazy-areas\.js\?v=\d{8}/);
});
