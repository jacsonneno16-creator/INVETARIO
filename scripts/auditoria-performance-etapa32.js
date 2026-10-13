'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');
const { JSDOM } = require('../public/node_modules/jsdom');

const raiz = path.resolve(__dirname, '..');
const harPath = process.argv[2];
const saidaPath = process.argv[3];
if (!harPath || !saidaPath) {
  throw new Error('Uso: node scripts/auditoria-performance-etapa32.js <arquivo.har> <saida.json>');
}

function analisarHar(arquivo) {
  const har = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const entries = har.log.entries || [];
  const bytes = campo => entries.reduce((s, e) => s + Math.max(0, campo(e) || 0), 0);
  const canais = entries.filter(e => /google\.firestore\.v1\.Firestore\/Listen\/channel/.test(e.request.url));
  return {
    requisicoes: entries.length,
    transferidosBytes: bytes(e => e.response && e.response._transferSize),
    conteudoDeclaradoBytes: bytes(e => e.response && e.response.content && e.response.content.size),
    canaisFirestore: canais.length,
    maiorCanalMs: Math.max(0, ...canais.map(e => e.time || 0)),
    maiorCanalTransferidoBytes: Math.max(0, ...canais.map(e => e.response && e.response._transferSize || 0)),
  };
}

async function abrirDashboard() {
  const dom = new JSDOM('<div id="page-recebimento-dashboard"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const contagem = { callables: 0, firestoreGets: 0, operacao: 0 };
  w.getDTLojaAtiva = () => 'loja_matriz';
  w.getDTFirestore = () => ({ collection: () => ({ doc: () => ({ get: async () => { contagem.firestoreGets++; return { exists: false }; } }) }) });
  w.firebase = { app: () => ({ functions: () => ({ httpsCallable: () => async () => { contagem.callables++; return { data: {} }; } }) }) };
  w._recebimentoOperacaoInternals = { carregar: async () => { contagem.operacao++; }, recebimentos: () => [] };
  w.eval(fs.readFileSync(path.join(raiz, 'public/js/analista/91-logistica-recebimento.js'), 'utf8'));
  w.renderRecebimentoDashboard();
  const interfaceMontada = /Buscar dados/.test(w.document.body.textContent);
  dom.window.close();
  return { ...contagem, interfaceMontada };
}

async function abrirOperacao() {
  const dom = new JSDOM('<div id="page-recebimento-operacao" class="on"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const contagem = { callables: 0, firestoreGets: 0, operacao: 0, intervalos: 0 };
  const consulta = {
    get: async () => { contagem.firestoreGets++; return { docs: [] }; },
    doc() { return this; }, collection() { return this; }, where() { return this; },
    add: async () => ({}), update: async () => ({}), delete: async () => ({}), set: async () => ({}),
  };
  w.getDTLojaAtiva = () => 'loja_matriz';
  w.getDTFirestore = () => consulta;
  w.getDTRawFirestore = () => consulta;
  w.firebase = { app: () => ({ functions: () => ({ httpsCallable: () => async () => {
    contagem.callables++;
    return { data: { recebimentos: [], incluiTransbordosParceiros: true } };
  } }) }) };
  w.setInterval = () => { contagem.intervalos++; return 1; };
  w.eval(fs.readFileSync(path.join(raiz, 'public/js/analista/93-recebimento-operacao.js'), 'utf8'));
  w.renderRecebimentoOperacao();
  const interfaceMontada = /Buscar dados/.test(w.document.body.textContent);
  dom.window.close();
  return { ...contagem, interfaceMontada };
}

async function main() {
  const lazy = fs.readFileSync(path.join(raiz, 'public/js/analista/00-lazy-areas.js'), 'utf8');
  const bloco = lazy.match(/recebimento:\s*(\[[\s\S]*?\n\s*\])/);
  const scripts = Function('return ' + bloco[1])().map(src => src.split('?')[0]);
  let raw = 0, gzip = 0;
  for (const script of scripts) {
    const bytes = fs.readFileSync(path.join(raiz, 'public', script));
    raw += bytes.length;
    gzip += zlib.gzipSync(bytes, { level: 9 }).length;
  }
  const quantidadePorTipo = 10;
  const quantidade = quantidadePorTipo * 2;
  const inicio = performance.now();
  const aberturas = await Promise.all([
    ...Array.from({ length: quantidadePorTipo }, () => abrirDashboard()),
    ...Array.from({ length: quantidadePorTipo }, () => abrirOperacao()),
  ]);
  const duracaoMs = performance.now() - inicio;
  const soma = chave => aberturas.reduce((s, x) => s + Number(x[chave] || 0), 0);
  const resultado = {
    geradoEm: new Date().toISOString(),
    baselineHar: analisarHar(harPath),
    simulacaoLocalControlada: {
      quantidadeDeTelas: quantidade,
      composicao: { dashboards: quantidadePorTipo, abasOperacionais: quantidadePorTipo },
      duracaoTotalMs: Number(duracaoMs.toFixed(3)),
      mediaPorTelaMs: Number((duracaoMs / quantidade).toFixed(3)),
      interfacesMontadas: aberturas.filter(x => x.interfaceMontada).length,
      chamadasDeDadosAoAbrir: {
        cloudFunctions: soma('callables'),
        firestoreGets: soma('firestoreGets'),
        operacaoCarregar: soma('operacao'),
        intervalosDeAtualizacao: soma('intervalos'),
        bytesDeDados: 0,
      },
      ativosPrimeiraAberturaSemCache: { scripts: scripts.length, bytesRaw: raw, bytesGzipEstimado: gzip },
      observacao: 'Tempo local de renderização e tamanho gzip calculado. Não é medição de rede Firebase publicada.',
    },
  };
  fs.writeFileSync(saidaPath, JSON.stringify(resultado, null, 2) + '\n');
  process.stdout.write(JSON.stringify(resultado, null, 2) + '\n');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
