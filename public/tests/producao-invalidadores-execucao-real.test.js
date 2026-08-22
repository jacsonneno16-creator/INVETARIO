// Bug ao vivo real (não suposição): 64-producao-gantt.js registrava um
// invalidador de cache (chamado sempre que a loja ativa troca) que
// referenciava `_produtos`/`_fichas` — nomes copiados de OUTRO arquivo de
// Produção (62-producao-programacao.js/60-producao-ficha-tecnica.js), que
// nunca existiram como variável NESTE arquivo. Em modo estrito, atribuir a
// um identificador nunca declarado lança ReferenceError — e como
// `invalidarTudo()` roda TODOS os invalidadores num loop, um erro aqui
// bloqueava a troca de loja pra TODA a Produção (não só o Gantt).
//
// producao-etapa6-multiloja.test.js já garantia (por regex) que cada
// arquivo REGISTRA um invalidador — mas nunca executava o callback de
// verdade, então nunca teria pego esse ReferenceError. Este arquivo
// carrega os módulos de Produção de verdade via jsdom (não regex) e
// EXECUTA cada invalidador registrado, do jeito que o app faz na troca de
// loja — é o único jeito de pegar essa classe de bug antes de produção.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dir = path.join(__dirname, '..', 'js', 'analista');
const src = n => fs.readFileSync(path.join(dir, n), 'utf8');

// Mesma lista que producao-etapa6-multiloja.test.js já usa pra confirmar
// que cada arquivo REGISTRA um invalidador — aqui a gente vai além e
// EXECUTA cada um.
const ARQUIVOS_PRODUCAO = [
  '60-producao-ficha-tecnica.js', '61-producao-maquinas.js', '62-producao-programacao.js',
  '64-producao-gantt.js', '65-producao-insumos.js', '66-producao-projecao.js',
  '67-producao-prog-automatica.js', '68-producao-funcionarios.js', '69-producao-relatorios.js',
  '70-producao-setup.js', '72-producao-mapa-fabrica.js', '73-producao-realizado.js',
  '74-producao-dashboard.js', '75-producao-estoque.js', '77-producao-config.js',
];

function carregarModulosProducao() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTLojaAtiva = () => 'loja1';
  win.getDTFirestore = () => ({ collection: () => ({ get: async () => ({ docs: [] }) }) });
  win.DTLoja = { listar: async () => [] };
  win.firebase = { auth: () => ({ currentUser: null }) };
  win.temPermissao = () => true;
  win.getTurnoMinutosDoDia = () => 480;
  win.eval(src('59-producao-ui-completa.js')); // define registrarInvalidacao/DTProducaoInvalidadores
  ARQUIVOS_PRODUCAO.forEach(arq => win.eval(src(arq)));
  return win;
}

test('CORREÇÃO ESTRUTURAL (bug ao vivo real: "seleciono qualquer tela, nenhuma funciona"): TODOS os invalidadores de cache de Produção rodam sem ReferenceError — não só o texto registra, o callback de verdade executa', () => {
  const win = carregarModulosProducao();
  const invalidadores = win.DTProducaoInvalidadores || [];
  assert.equal(invalidadores.length, ARQUIVOS_PRODUCAO.length, 'cada arquivo de Produção precisa registrar exatamente 1 invalidador');
  invalidadores.forEach((fn, i) => {
    assert.doesNotThrow(() => fn(), `invalidador #${i} (${ARQUIVOS_PRODUCAO[i]}) não pode lançar erro ao trocar de loja`);
  });
});

test('REGRESSÃO: 64-producao-gantt.js não referencia _produtos/_fichas (nomes de OUTROS arquivos de Produção, nunca declarados aqui — causa raiz do bug ao vivo)', () => {
  const codigo = src('64-producao-gantt.js');
  const declarados = new Set([...codigo.matchAll(/\blet\s+(_\w+)/g)].map(m => m[1]));
  assert.ok(!declarados.has('_produtos') && !/[^.\w]_produtos\s*=/.test(codigo), '_produtos nunca foi declarado neste arquivo e não pode ser atribuído');
  assert.ok(!declarados.has('_fichas') && !/[^.\w]_fichas\s*=/.test(codigo), '_fichas nunca foi declarado neste arquivo e não pode ser atribuído');
});
