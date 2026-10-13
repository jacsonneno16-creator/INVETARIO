'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('boot do Analista não executa módulos de Recebimento antes de abrir o setor', () => {
  const html = read('analista.html');
  assert.match(html, /00-lazy-areas\.js/);
  for (const nome of ['91-logistica-recebimento.js', '97-recebimento-recusas.js', '98-recebimento-retornos-indicadores.js', '105-recebimento-patio-tempo-real.js']) {
    assert.doesNotMatch(html, new RegExp('<script[^>]+src="js/analista/' + nome.replaceAll('.', '\\.') + '\\?'));
  }
  const lazy = read('js/analista/00-lazy-areas.js');
  assert.match(lazy, /recebimento:\s*\[/);
  assert.match(lazy, /105-recebimento-patio-tempo-real\.js/);
});

test('carregar os 18 scripts de Recebimento juntos executa ZERO acessos a dados', async () => {
  const lazy = read('js/analista/00-lazy-areas.js');
  const bloco = lazy.match(/recebimento:\s*(\[[\s\S]*?\n\s*\])/);
  assert.ok(bloco, 'lista lazy de Recebimento precisa existir');
  const arquivos = Function('return ' + bloco[1])().map(src => src.split('?')[0]);
  assert.equal(arquivos.length, 18);
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost', runScripts: 'outside-only' });
  const { window } = dom;
  const acessos = [];
  function refFake() {
    return new Proxy({}, { get(_alvo, propriedade) {
      if (propriedade === 'collection') return nome => { acessos.push(['collection', nome]); return refFake(); };
      if (['doc', 'where', 'limit', 'orderBy'].includes(propriedade)) return () => refFake();
      if (propriedade === 'get') return async () => { acessos.push(['get']); return { docs: [], empty: true, exists: false, data: () => ({}) }; };
      if (propriedade === 'onSnapshot') return () => { acessos.push(['onSnapshot']); return () => {}; };
      return undefined;
    } });
  }
  window.getDTFirestore = () => refFake();
  window.getDTRawFirestore = () => refFake();
  window.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => {
    acessos.push(['callable', nome]); return { data: {} };
  } }) }) };
  for (const arquivo of arquivos) window.eval(read(arquivo));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(acessos, [], 'executar todos os módulos não pode iniciar leitura em segundo plano');
});

test('serviço BlueSoft geral não entra no boot; Recebimento usa serviço BI sem API externa', () => {
  const html = read('analista.html');
  const lazy = read('js/analista/00-lazy-areas.js');
  const biRecebimento = read('js/analista/90-bi-recebimento-service.js');
  assert.doesNotMatch(html, /src="js\/analista\/90-bluesoft-service\.js/);
  assert.match(lazy, /90-bi-recebimento-service\.js/);
  assert.doesNotMatch(biRecebimento, /bluesoftProxy|https?:\/\/|\bfetch\s*\(/);
  assert.match(html, /43-importar-exportar-api\.js/, 'integração BlueSoft do Inventário permanece disponível');
});

test('importação manual de compras usa JSON materializado e query direcionada, sem varrer Agenda', async () => {
  const consultas = [];
  const escritas = [];
  let commits = 0;
  const agenda = {
    where(campo, operador, valores) { consultas.push({ campo, operador, valores }); return this; },
    async get() { return { docs: [] }; },
    doc(id) { return { id: id || 'novo', caminho: 'agenda/' + (id || 'novo') }; },
  };
  const raw = {
    collection(nome) {
      if (nome === 'lojas') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ nome: 'Matriz', bluesoft_loja_key: '1' }) }) }) };
      throw new Error('coleção raw inesperada: ' + nome);
    },
    batch() { return { set(ref, dados) { escritas.push({ ref, dados }); }, async commit() { commits++; } }; },
  };
  const window = {
    getDTLojaAtiva: () => 'loja_matriz',
    getDTRawFirestore: () => raw,
    getDTFirestore: () => ({ collection: nome => {
      assert.equal(nome, 'recebimento_agendamentos');
      return agenda;
    } }),
  };
  vm.runInNewContext(read('js/analista/90-bi-recebimento-service.js'), { window, Date, String, Number, Array, Object, Map, Set, Promise, Error }, { filename: '90-bi-recebimento-service.js' });
  const resultado = await window.importarComprasAReceberBiJson([
    { loja_key: 1, pedido_key: 123, fornecedor: 'Fornecedor A', produto_key: 9, descricao: 'Produto', qtd_unidades_pendentes: 2 },
  ]);
  assert.equal(resultado.totalPedidosPendentes, 1);
  assert.equal(JSON.stringify(consultas), JSON.stringify([{ campo: 'numeroPedido', operador: 'in', valores: ['123'] }]));
  assert.equal(commits, 1);
  assert.equal(escritas[0].dados.origem, 'bi');
  assert.match(escritas[0].dados.observacao, /BI\/SharePoint/);
});

test('Pátio e Indicadores recebem resumo de notas do servidor sem consulta em lote no navegador', () => {
  const patio = read('js/analista/105-recebimento-patio-tempo-real.js');
  const indicadores = read('js/analista/98-recebimento-retornos-indicadores.js');
  assert.match(patio, /resposta\.data\.notasResumo/);
  assert.match(indicadores, /resposta\.data\.notasResumo/);
  assert.doesNotMatch(patio, /documentId\(\).*['"]in['"]/s);
  assert.doesNotMatch(indicadores, /documentId\(\).*['"]in['"]/s);
});

test('Produtos não fazem leitura integral no login e módulos operacionais não voltam ao Firestore integral quando BigQuery falha', () => {
  const cadastros = read('js/analista/52-cadastros-v287.js');
  const boot = cadastros.slice(cadastros.indexOf('function boot()'));
  assert.doesNotMatch(boot, /function boot\(\)\{activateProducts\(\)/);
  for (const arquivo of ['js/analista/93-recebimento-operacao.js', 'js/analista/94-recebimento-relatorios.js', 'js/analista/101-relatorios-bi.js']) {
    const codigo = read(arquivo);
    assert.match(codigo, /BigQuery/);
    assert.doesNotMatch(codigo, /BigQuery[^}]*catch[^}]*collection\([^)]*\)\.get\(\)/s);
  }
});

test('abrir Dashboard de Recebimento monta a interface com ZERO leituras; somente Buscar dados consulta', async () => {
  const dom = new JSDOM('<div id="page-recebimento-dashboard"></div>');
  const { window } = dom;
  let callables = 0;
  let firestoreGets = 0;
  let operacaoCarregar = 0;
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTFirestore = () => ({
    collection: () => ({ doc: () => ({ get: async () => {
      firestoreGets++;
      return { exists: true, data: () => ({ bluesoft_loja_key: '1' }) };
    } }) }),
  });
  window.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => {
    callables++;
    if (nome === 'buscarResumoHistoricoRecebimentoBigQuery') return { data: { resumo: {} } };
    if (nome === 'buscarResumoRecebimentoComprasBigQuery') return { data: { mensal: [] } };
    throw new Error('Callable inesperada: ' + nome);
  } }) }) };
  window._recebimentoOperacaoInternals = { carregar: async () => { operacaoCarregar++; }, recebimentos: () => [] };
  vm.runInNewContext(read('js/analista/91-logistica-recebimento.js'), {
    window, document: window.document, console, Date, Math, Number, String, Array, Object,
    Set, Map, Promise, JSON, isNaN, isFinite, setTimeout, clearTimeout,
  }, { filename: '91-logistica-recebimento.js' });

  window.renderRecebimentoDashboard();
  assert.equal(callables, 0, 'abrir a tela não pode chamar Cloud Function');
  assert.equal(firestoreGets, 0, 'abrir a tela não pode ler Firestore');
  assert.equal(operacaoCarregar, 0, 'abrir a tela não pode carregar a operação');
  assert.match(window.document.body.textContent, /Buscar dados/);
  assert.match(window.document.body.textContent, /Nenhuma consulta é executada ao abrir esta tela/);

  await window._recebimentoDashboardBuscaInternals.buscarManual();
  assert.equal(callables, 2, 'clique manual consulta os dois resumos BigQuery');
  assert.equal(firestoreGets, 1, 'clique manual resolve a chave da loja uma vez');
  assert.equal(operacaoCarregar, 1, 'clique manual carrega a operação uma vez');
  assert.equal(window._recebimentoDashboardBuscaInternals.buscaManualRealizada(), true);
});

test('abrir aba operacional Recebimentos faz ZERO leituras e não arma polling; botão manual consulta', async () => {
  const dom = new JSDOM('<div id="page-recebimento-operacao" class="on"></div>');
  const { window } = dom;
  let callables = 0;
  let firestoreGets = 0;
  let intervalos = 0;
  const consulta = {
    get: async () => { firestoreGets++; return { docs: [] }; },
    doc() { return this; }, collection() { return this; }, where() { return this; },
    add: async () => ({}), update: async () => ({}), delete: async () => ({}), set: async () => ({}),
  };
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTFirestore = () => consulta;
  window.getDTRawFirestore = () => consulta;
  window.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async () => {
    callables++;
    assert.equal(nome, 'buscarRecebimentosOperacaoBigQuery');
    return { data: { recebimentos: [], incluiTransbordosParceiros: true } };
  } }) }) };
  vm.runInNewContext(read('js/analista/93-recebimento-operacao.js'), {
    window, document: window.document, console, Date, Math, Number, String, Array, Object,
    Set, Map, Promise, JSON, isNaN, isFinite,
    setInterval: () => { intervalos++; return 1; }, clearInterval: () => {},
  }, { filename: '93-recebimento-operacao.js' });

  window.renderRecebimentoOperacao();
  assert.equal(callables, 0, 'abrir Recebimentos não pode chamar BigQuery');
  assert.equal(firestoreGets, 0, 'abrir Recebimentos não pode ler Firestore');
  assert.equal(intervalos, 0, 'abrir Recebimentos não pode armar atualização periódica');
  assert.match(window.document.body.textContent, /Buscar dados/);
  assert.match(window.document.body.textContent, /Abrir esta tela não consulta nenhuma base/);

  await window._recebimentoOperacaoBuscaInternals.buscarManual();
  assert.equal(callables, 1, 'busca manual chama o resumo operacional uma vez');
  assert.equal(firestoreGets, 1, 'busca manual lê apenas a coleção pequena de rotas');
  assert.equal(intervalos, 0, 'nem após a busca manual existe polling oculto');
});

test('cache manual mantém resposta por 15 minutos e deduplica chamadas simultâneas', async () => {
  let agora = 1_000_000;
  class Relogio extends Date { static now() { return agora; } }
  let chamadas = 0;
  const window = { firebase: { app: () => ({ functions: () => ({ httpsCallable: () => async ({ arquivo }) => {
    chamadas++;
    return { data: { ok: true, dados: { arquivo, chamada: chamadas } } };
  } }) }) } };
  vm.runInNewContext(read('js/analista/bi-pasta-local.js'), {
    window, Date: Relogio, Map, String, Promise, Error,
  }, { filename: 'bi-pasta-local.js' });

  const [a, b] = await Promise.all([
    window.DTBiPastaLocal.lerJson('dados-insumos.json'),
    window.DTBiPastaLocal.lerJson('dados-insumos.json'),
  ]);
  assert.equal(chamadas, 1, 'duas solicitações simultâneas usam uma única chamada');
  assert.deepEqual(a, b);
  agora += 15 * 60 * 1000 - 1;
  await window.DTBiPastaLocal.lerJson('dados-insumos.json');
  assert.equal(chamadas, 1, 'antes de completar 15 minutos usa cache');
  agora += 2;
  await window.DTBiPastaLocal.lerJson('dados-insumos.json');
  assert.equal(chamadas, 2, 'depois de 15 minutos busca novamente');
});
