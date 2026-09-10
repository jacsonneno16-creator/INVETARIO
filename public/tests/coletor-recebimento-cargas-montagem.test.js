// Coletor > Recebimento > Nova Movimentação > Transbordo de mercadorias >
// Montagem de carga. Primeira metade do fluxo Montagem/Expedição (a
// expedição em si, que gera o transbordo de verdade, é a próxima etapa —
// ver plano em C:\Users\Daterrinha69\.claude\plans\structured-sprouting-hoare.md).
// Carga = `recebimento_transbordo_cargas` (por loja); itens = subcoleção
// `itens`, só existe enquanto a carga está PENDENTE. Destino reaproveita o
// MESMO mecanismo de rotas do Transbordo ad-hoc (ROTAS_CACHE/
// _destinosPossiveis, 22-recebimento.js), carregado antes deste arquivo em
// coletor.html.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const base = path.join(__dirname, '../js/coletor');
const recCode = fs.readFileSync(path.join(base, '22-recebimento.js'), 'utf8');
const cargasCode = fs.readFileSync(path.join(base, '26-recebimento-cargas.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  const subcolecoes = new Map(); // `${docId}/${sub}` -> mockColecao
  let seq = 0;
  const snapshot = entradas => ({ empty: entradas.length === 0, size: entradas.length, docs: entradas.map(([id, data]) => ({ id, data: () => data, exists: true })) });
  return {
    get: async () => snapshot([...registro.entries()]),
    doc: id => {
      const docId = id || ('novo' + (seq++));
      return {
        id: docId,
        get: async () => { const data = registro.get(docId); return { exists: data !== undefined, id: docId, data: () => data }; },
        set: async p => { const a = registro.get(docId) || {}; registro.set(docId, { ...a, ...p }); },
        update: async p => { const a = registro.get(docId); if (a === undefined) throw new Error('NOT_FOUND'); registro.set(docId, { ...a, ...p }); },
        delete: async () => { registro.delete(docId); },
        collection: sub => {
          const chave = docId + '/' + sub;
          if (!subcolecoes.has(chave)) subcolecoes.set(chave, mockColecao([]));
          return subcolecoes.get(chave);
        },
      };
    },
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    where: (campo, op, valor) => {
      const filtrados = () => [...registro.entries()].filter(([, data]) => data && data[campo] === valor);
      return { get: async () => snapshot(filtrados()), limit: n => ({ get: async () => snapshot(filtrados().slice(0, n)) }) };
    },
    _registro: registro,
  };
}

const SHELL = `<!doctype html><html><body>
<div id="cargas-lista-itens"></div>
<input id="carga-nova-nome">
<select id="carga-nova-destino"></select>
<div id="carga-nova-status"></div>
<div id="carga-montagem-resumo"></div>
<input id="carga-montagem-capa">
<input id="carga-montagem-produto-codigo">
<div id="carga-montagem-produto-nome"></div>
<input id="carga-montagem-quantidade">
<div id="carga-montagem-status"></div>
<div id="carga-montagem-lista-itens"></div>
<input id="carga-finalizar-paletes">
<div id="carga-finalizar-status"></div>
</body></html>`;

function loadCargas(colecoes, opts) {
  const telas = [];
  const toasts = [];
  const dom = new JSDOM(SHELL, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const lojas = mockColecao([{ id: (opts && opts.lojaId) || 'loja1', data: { nome: (opts && opts.lojaNome) || 'Loja Matriz' } }]);
  win.FS = { collection: nome => (colecoes && colecoes[nome]) || mockColecao([]) };
  win.APP = { operador: { email: 'operador@daterrinha.com' } };
  win.goScreen = id => { telas.push(id); };
  win.toast = (msg, tipo) => { toasts.push({ msg, tipo }); };
  win.getDTLojaAtiva = () => (opts && opts.lojaId) || 'loja1';
  win.getDTRawFirestore = () => ({ collection: nome => (nome === 'lojas' ? lojas : (colecoes && colecoes[nome]) || mockColecao([])) });
  Object.defineProperty(win.navigator, 'onLine', { get: () => !opts || opts.online !== false, configurable: true });
  win.eval(recCode);
  win.eval(cargasCode);
  return { window: win, document, telas, toasts };
}

const ROTA_MATRIZ_FILIAL = { id: 'r1', data: { origemLojaId: 'loja1', origemNome: 'Loja Matriz', destinoLojaId: 'loja2', destinoNome: 'Loja Filial' } };
const PRODUTO_ARROZ = { id: 'pr1', data: { cod: '1001', gtin: '7891000100103', nome: 'Arroz 5kg' } };

test('abrirNovaMovimentacaoRecebimento: navega pro menu "Nova Movimentação"', () => {
  const { window, telas } = loadCargas({});
  window.abrirNovaMovimentacaoRecebimento();
  assert.deepEqual(telas, ['nova-movimentacao-menu']);
});

test('abrirNovaCarga: preenche o select de destino com as rotas cadastradas a partir desta loja (mesmo mecanismo do Transbordo ad-hoc)', async () => {
  const rotas = mockColecao([ROTA_MATRIZ_FILIAL]);
  const { window, document } = loadCargas({ recebimento_rotas_transbordo: rotas, recebimento_transbordo_cargas: mockColecao([]) });

  await window.abrirNovaCarga();

  const html = document.getElementById('carga-nova-destino').innerHTML;
  assert.match(html, /Loja Filial/);
});

test('confirmarNovaCarga: cria a carga com status PENDENTE e navega pra montagem', async () => {
  const rotas = mockColecao([ROTA_MATRIZ_FILIAL]);
  const cargas = mockColecao([]);
  const { window, document, telas } = loadCargas({ recebimento_rotas_transbordo: rotas, recebimento_transbordo_cargas: cargas });

  await window.abrirNovaCarga();
  document.getElementById('carga-nova-nome').value = 'Carga Filial 04/09';
  document.getElementById('carga-nova-destino').value = 'loja2';
  await window.confirmarNovaCarga();

  assert.equal(cargas._registro.size, 1);
  const doc = [...cargas._registro.values()][0];
  assert.equal(doc.nomeCarga, 'Carga Filial 04/09');
  assert.equal(doc.destinoLojaId, 'loja2');
  assert.equal(doc.destinoNome, 'Loja Filial');
  assert.equal(doc.origemLojaId, 'loja1');
  assert.equal(doc.status, 'PENDENTE');
  assert.equal(doc.notasFiscais.length, 0);
  assert.ok(telas.includes('carga-montagem'));
});

test('confirmarNovaCarga: recusa sem nome ou sem destino', async () => {
  const cargas = mockColecao([]);
  const { window, document } = loadCargas({ recebimento_rotas_transbordo: mockColecao([]), recebimento_transbordo_cargas: cargas });
  await window.abrirNovaCarga();

  await window.confirmarNovaCarga();
  assert.equal(cargas._registro.size, 0);
  assert.match(document.getElementById('carga-nova-status').textContent, /nome/i);

  document.getElementById('carga-nova-nome').value = 'Carga X';
  await window.confirmarNovaCarga();
  assert.equal(cargas._registro.size, 0);
  assert.match(document.getElementById('carga-nova-status').textContent, /destino/i);
});

test('adicionarItemMontagemCarga: bipa capa + produto (por GTIN) + quantidade, e acumula na lista', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', destinoNome: 'Loja Filial', status: 'PENDENTE' } }]);
  const produtos = mockColecao([PRODUTO_ARROZ]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: produtos });

  await window.abrirMontagemCarga('c1');
  document.getElementById('carga-montagem-capa').value = 'CAPA-001';
  document.getElementById('carga-montagem-produto-codigo').value = '7891000100103'; // por GTIN
  document.getElementById('carga-montagem-quantidade').value = '40';
  await window.adicionarItemMontagemCarga();

  const itens = window._recebimentoCargasInternals.getItensCarga();
  assert.equal(itens.length, 1);
  assert.equal(itens[0].capa, 'CAPA-001');
  assert.equal(itens[0].codigoProduto, '1001');
  assert.equal(itens[0].nomeProduto, 'Arroz 5kg');
  assert.equal(itens[0].quantidade, 40);
  const html = document.getElementById('carga-montagem-lista-itens').innerHTML;
  assert.match(html, /CAPA-001/);
  assert.match(html, /Arroz 5kg/);
});

// PEDIDO AO VIVO (2026-09-08): "bipei capa palete já pula para produto,
// bipar produto já pula para quantidade" — um leitor de código de barras
// digita os caracteres e manda um Enter sozinho no final; ouvir o Enter é
// reagir ao bipe, sem o operador precisar tocar em nada.
test('_avancarAoEnterMontagem: Enter na capa (preenchida) foca o campo de produto', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]) });
  await window.abrirMontagemCarga('c1');

  const capa = document.getElementById('carga-montagem-capa');
  const produto = document.getElementById('carga-montagem-produto-codigo');
  capa.value = 'CAPA-001';
  const resultado = window._avancarAoEnterMontagem({ key: 'Enter', target: capa, preventDefault: () => {} }, 'carga-montagem-produto-codigo');

  assert.equal(resultado, false, 'bloqueia o comportamento padrão do Enter (evita qualquer submit)');
  assert.equal(document.activeElement, produto, 'foco pulou pro campo de produto');
});

test('_avancarAoEnterMontagem: Enter no produto (preenchido) foca o campo de quantidade', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([PRODUTO_ARROZ]) });
  await window.abrirMontagemCarga('c1');

  const produto = document.getElementById('carga-montagem-produto-codigo');
  const quantidade = document.getElementById('carga-montagem-quantidade');
  produto.value = '7891000100103';
  window._avancarAoEnterMontagem({ key: 'Enter', target: produto, preventDefault: () => {} }, 'carga-montagem-quantidade');

  assert.equal(document.activeElement, quantidade);
});

test('_avancarAoEnterMontagem: Enter com o campo VAZIO não avança o foco (evita pular sem ter bipado nada)', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]) });
  await window.abrirMontagemCarga('c1');

  const capa = document.getElementById('carga-montagem-capa');
  const produto = document.getElementById('carga-montagem-produto-codigo');
  capa.value = '';
  window._avancarAoEnterMontagem({ key: 'Enter', target: capa, preventDefault: () => {} }, 'carga-montagem-produto-codigo');

  assert.notEqual(document.activeElement, produto);
});

test('_avancarAoEnterMontagem: outras teclas (não Enter) não mexem no foco', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]) });
  await window.abrirMontagemCarga('c1');

  const capa = document.getElementById('carga-montagem-capa');
  const produto = document.getElementById('carga-montagem-produto-codigo');
  capa.value = 'CAPA-001';
  const resultado = window._avancarAoEnterMontagem({ key: 'A', target: capa, preventDefault: () => {} }, 'carga-montagem-produto-codigo');

  assert.equal(resultado, true, 'deixa o comportamento padrão seguir pra qualquer outra tecla');
  assert.notEqual(document.activeElement, produto);
});

test('adicionarItemMontagemCarga: também busca produto pelo código interno (cod), não só GTIN', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const produtos = mockColecao([PRODUTO_ARROZ]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: produtos });

  await window.abrirMontagemCarga('c1');
  document.getElementById('carga-montagem-capa').value = 'CAPA-002';
  document.getElementById('carga-montagem-produto-codigo').value = '1001'; // por código interno
  document.getElementById('carga-montagem-quantidade').value = '10';
  await window.adicionarItemMontagemCarga();

  assert.equal(window._recebimentoCargasInternals.getItensCarga()[0].nomeProduto, 'Arroz 5kg');
});

test('adicionarItemMontagemCarga: recusa capa repetida na mesma carga', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const produtos = mockColecao([PRODUTO_ARROZ]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: produtos });

  await window.abrirMontagemCarga('c1');
  document.getElementById('carga-montagem-capa').value = 'CAPA-001';
  document.getElementById('carga-montagem-produto-codigo').value = '1001';
  document.getElementById('carga-montagem-quantidade').value = '10';
  await window.adicionarItemMontagemCarga();

  document.getElementById('carga-montagem-capa').value = 'CAPA-001';
  document.getElementById('carga-montagem-produto-codigo').value = '1001';
  document.getElementById('carga-montagem-quantidade').value = '5';
  await window.adicionarItemMontagemCarga();

  assert.equal(window._recebimentoCargasInternals.getItensCarga().length, 1, 'a 2ª tentativa com a mesma capa não pode duplicar');
  assert.match(document.getElementById('carga-montagem-status').textContent, /já foi bipada/i);
});

// BUG AO VIVO REAL (2026-09-04): "na hora de montar uma carga não tá
// reconhecendo o produto bipado" — abrirMontagemCarga() liberava a tela
// (goScreen) e SÓ DEPOIS terminava de carregar o catálogo de produtos; um
// operador rápido bipava o primeiro item antes do catálogo chegar e via
// "não encontrado" com o código certo. Corrigido com uma re-checagem
// defensiva dentro de adicionarItemMontagemCarga().
test('adicionarItemMontagemCarga: reconhece o produto MESMO SE bipado antes do catálogo terminar de carregar (corrida real)', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const produtos = mockColecao([PRODUTO_ARROZ]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: produtos });
  await window.carregarCargasColetor(); // carga já em cache, igual a vinda real da tela de lista

  const abrindo = window.abrirMontagemCarga('c1'); // NÃO espera terminar — mesma corrida real
  document.getElementById('carga-montagem-capa').value = 'CAPA-001';
  document.getElementById('carga-montagem-produto-codigo').value = '7891000100103';
  document.getElementById('carga-montagem-quantidade').value = '40';
  await window.adicionarItemMontagemCarga(); // bipado ANTES do catálogo carregar
  await abrindo;

  const itens = window._recebimentoCargasInternals.getItensCarga();
  assert.equal(itens.length, 1, 'produto tinha que ser reconhecido mesmo bipado antes do catálogo terminar de carregar');
  assert.equal(itens[0].nomeProduto, 'Arroz 5kg');
});

test('adicionarItemMontagemCarga: recusa produto não encontrado e quantidade inválida', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const produtos = mockColecao([PRODUTO_ARROZ]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: produtos });
  await window.abrirMontagemCarga('c1');

  document.getElementById('carga-montagem-capa').value = 'CAPA-009';
  document.getElementById('carga-montagem-produto-codigo').value = 'NAO-EXISTE';
  document.getElementById('carga-montagem-quantidade').value = '5';
  await window.adicionarItemMontagemCarga();
  assert.equal(window._recebimentoCargasInternals.getItensCarga().length, 0);
  assert.match(document.getElementById('carga-montagem-status').textContent, /não encontrado/i);

  document.getElementById('carga-montagem-produto-codigo').value = '1001';
  document.getElementById('carga-montagem-quantidade').value = '0';
  await window.adicionarItemMontagemCarga();
  assert.equal(window._recebimentoCargasInternals.getItensCarga().length, 0);
  assert.match(document.getElementById('carga-montagem-status').textContent, /quantidade/i);
});

// PEDIDO AO VIVO (2026-09-08): "o produto às vezes demora pra carregar...
// ver se tem como consultar na hora que bipar, quando os produtos ainda
// não tiver atualizado/baixado no aparelho" — `dt_produtos` (a coleção-
// fonte, 1 doc por produto, de onde os chunks de window.DTProdutos são
// gerados) já é lida por qualquer usuário ativo (firestore.rules) — dá
// pra consultar só o código bipado, sem esperar o catálogo inteiro.
const PRODUTO_FEIJAO_DT = { id: 'dt1', data: { gtin: '7891000200204', codigoInterno: '2002', nomeProduto: 'Feijão 1kg' } };

test('adicionarItemMontagemCarga: catálogo local (nem PCP nem DTProdutos) ainda vazio — consulta ao vivo em dt_produtos e ainda assim adiciona o item', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const dtProdutos = mockColecao([PRODUTO_FEIJAO_DT]);
  // producao_produtos vazio de propósito — só dt_produtos tem o produto.
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]), dt_produtos: dtProdutos });
  await window.abrirMontagemCarga('c1');

  document.getElementById('carga-montagem-capa').value = 'CAPA-777';
  document.getElementById('carga-montagem-produto-codigo').value = '7891000200204'; // GTIN
  document.getElementById('carga-montagem-quantidade').value = '12';
  await window.adicionarItemMontagemCarga();

  const itens = window._recebimentoCargasInternals.getItensCarga();
  assert.equal(itens.length, 1, 'consulta ao vivo achou o produto mesmo sem nenhum catálogo local carregado');
  assert.equal(itens[0].nomeProduto, 'Feijão 1kg');
  assert.equal(itens[0].codigoProduto, '2002');
});

test('adicionarItemMontagemCarga: consulta ao vivo também reconhece pelo código interno (codigoInterno), não só GTIN', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const dtProdutos = mockColecao([PRODUTO_FEIJAO_DT]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]), dt_produtos: dtProdutos });
  await window.abrirMontagemCarga('c1');

  document.getElementById('carga-montagem-capa').value = 'CAPA-778';
  document.getElementById('carga-montagem-produto-codigo').value = '2002'; // código interno
  document.getElementById('carga-montagem-quantidade').value = '3';
  await window.adicionarItemMontagemCarga();

  assert.equal(window._recebimentoCargasInternals.getItensCarga()[0].nomeProduto, 'Feijão 1kg');
});

test('adicionarItemMontagemCarga: código que não existe nem local nem em dt_produtos continua mostrando "não encontrado" (fallback não inventa produto)', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]), dt_produtos: mockColecao([PRODUTO_FEIJAO_DT]) });
  await window.abrirMontagemCarga('c1');

  document.getElementById('carga-montagem-capa').value = 'CAPA-779';
  document.getElementById('carga-montagem-produto-codigo').value = 'CODIGO-INEXISTENTE';
  document.getElementById('carga-montagem-quantidade').value = '1';
  await window.adicionarItemMontagemCarga();

  assert.equal(window._recebimentoCargasInternals.getItensCarga().length, 0);
  assert.match(document.getElementById('carga-montagem-status').textContent, /não encontrado/i);
});

test('buscarProdutoMontagemCarga (preview ao digitar): sem achar local, consulta ao vivo e atualiza o nome mostrado depois do debounce', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const dtProdutos = mockColecao([PRODUTO_FEIJAO_DT]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]), dt_produtos: dtProdutos });
  await window.abrirMontagemCarga('c1');

  document.getElementById('carga-montagem-produto-codigo').value = '7891000200204';
  window.buscarProdutoMontagemCarga();
  await new Promise(r => setTimeout(r, 300)); // espera o debounce + a consulta ao vivo

  assert.match(document.getElementById('carga-montagem-produto-nome').textContent, /Feijão 1kg/);
});

test('buscarProdutoMontagemCarga (preview ao digitar): se o campo mudar antes da consulta ao vivo terminar, não sobrescreve com o resultado antigo', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const dtProdutos = mockColecao([PRODUTO_FEIJAO_DT]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]), dt_produtos: dtProdutos });
  await window.abrirMontagemCarga('c1');

  const elCodigo = document.getElementById('carga-montagem-produto-codigo');
  elCodigo.value = '7891000200204';
  window.buscarProdutoMontagemCarga();
  elCodigo.value = ''; // operador apagou/trocou antes da consulta voltar
  window.buscarProdutoMontagemCarga();
  await new Promise(r => setTimeout(r, 300));

  assert.doesNotMatch(document.getElementById('carga-montagem-produto-nome').textContent, /Feijão 1kg/);
});

// BUG AO VIVO REAL (2026-09-06): "produto não encontrado" bipando um GTIN
// real — e depois, questionado pelo próprio usuário: "o que tem a ver fazer
// uma carga com PCP e produção?" — carregar um caminhão é logística pura,
// não precisa de nada exclusivo da Produção. producao_produtos nunca teve
// GTIN de verdade; a fonte CERTA pra essa bipagem é a Base de Produtos do
// Inventário (window.DTProdutos, mesma usada pelo scanner do inventário).
// Ela agora é a fonte PRINCIPAL — producao_produtos só entra como reforço
// pra produto cadastrado só na PCP.
test('adicionarItemMontagemCarga: bipando um GTIN real, busca PRIMEIRO na Base de Produtos do Inventário (window.DTProdutos) — nem precisa existir em producao_produtos', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]) });
  window.DTProdutos = {
    cache: { carregado: true, lista: [{ nomeProduto: 'TAPIOCA DA TERRINHA 1KG' }] },
    buscarSync: codigo => codigo === '17898994081637'
      ? { encontrado: true, nomeProduto: 'TAPIOCA DA TERRINHA 1KG', codigoInterno: '57947', gtin: '17898994081637' }
      : { encontrado: false },
  };

  await window.abrirMontagemCarga('c1');
  document.getElementById('carga-montagem-capa').value = 'CAPA-010';
  document.getElementById('carga-montagem-produto-codigo').value = '17898994081637';
  document.getElementById('carga-montagem-quantidade').value = '12';
  await window.adicionarItemMontagemCarga();

  const itens = window._recebimentoCargasInternals.getItensCarga();
  assert.equal(itens.length, 1, 'devia ter encontrado o produto direto na Base de Produtos');
  assert.equal(itens[0].codigoProduto, '57947');
  assert.equal(itens[0].nomeProduto, 'TAPIOCA DA TERRINHA 1KG');
});

test('adicionarItemMontagemCarga: código cadastrado em mais de um produto na Base de Produtos (ambíguo) — não inventa qual é', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]) });
  window.DTProdutos = {
    cache: { carregado: true, lista: [{ nomeProduto: 'X' }, { nomeProduto: 'Y' }] },
    buscarSync: () => ({ encontrado: false, ambiguo: true }),
  };

  await window.abrirMontagemCarga('c1');
  document.getElementById('carga-montagem-capa').value = 'CAPA-011';
  document.getElementById('carga-montagem-produto-codigo').value = '00000000000000';
  document.getElementById('carga-montagem-quantidade').value = '3';
  await window.adicionarItemMontagemCarga();

  assert.equal(window._recebimentoCargasInternals.getItensCarga().length, 0);
  assert.match(document.getElementById('carga-montagem-status').textContent, /mais de um produto/i);
});

test('adicionarItemMontagemCarga: window.DTProdutos ainda não carregou o catálogo geral — mensagem específica, não "não encontrado" genérico', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const produtos = mockColecao([{ id: 'pr2', data: { cod: '2002', nome: 'Tapioca da Terrinha 1kg' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: produtos });
  window.DTProdutos = { cache: { carregado: false, lista: [] }, buscarSync: () => ({ encontrado: false }) };

  await window.abrirMontagemCarga('c1');
  document.getElementById('carga-montagem-capa').value = 'CAPA-012';
  document.getElementById('carga-montagem-produto-codigo').value = '17898994081637';
  document.getElementById('carga-montagem-quantidade').value = '1';
  await window.adicionarItemMontagemCarga();

  assert.equal(window._recebimentoCargasInternals.getItensCarga().length, 0);
  assert.match(document.getElementById('carga-montagem-status').textContent, /catálogo geral.*ainda não carregou/i);
});

test('confirmarFinalizarMontagemCarga: grava paletes físicos + total de volumes somado dos itens, mantém status PENDENTE (ledger só entra na expedição)', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const produtos = mockColecao([PRODUTO_ARROZ]);
  const { window, document, telas } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: produtos });
  await window.abrirMontagemCarga('c1');
  document.getElementById('carga-montagem-capa').value = 'CAPA-001';
  document.getElementById('carga-montagem-produto-codigo').value = '1001';
  document.getElementById('carga-montagem-quantidade').value = '40';
  await window.adicionarItemMontagemCarga();
  document.getElementById('carga-montagem-capa').value = 'CAPA-002';
  document.getElementById('carga-montagem-produto-codigo').value = '1001';
  document.getElementById('carga-montagem-quantidade').value = '25';
  await window.adicionarItemMontagemCarga();

  window.abrirFinalizarMontagemCarga();
  document.getElementById('carga-finalizar-paletes').value = '2';
  await window.confirmarFinalizarMontagemCarga();

  const doc = cargas._registro.get('c1');
  assert.equal(doc.totalPaletesFisico, 2);
  assert.equal(doc.totalVolumes, 65);
  assert.equal(doc.status, 'PENDENTE');
  assert.ok(telas.includes('cargas-lista'));
});

test('confirmarFinalizarMontagemCarga: recusa sem nenhum item bipado, e sem quantidade física informada', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, producao_produtos: mockColecao([]) });
  await window.abrirMontagemCarga('c1');

  window.abrirFinalizarMontagemCarga();
  document.getElementById('carga-finalizar-paletes').value = '3';
  await window.confirmarFinalizarMontagemCarga();
  assert.match(document.getElementById('carga-finalizar-status').textContent, /pelo menos 1 item/i);
  assert.equal(cargas._registro.get('c1').status, 'PENDENTE');
  assert.equal(cargas._registro.get('c1').totalPaletesFisico, undefined);
});

test('carregarCargasColetor + lista: mostra só PENDENTE/EM_TRANSITO, com rótulo "Em montagem"/"Expedida"', async () => {
  const cargas = mockColecao([
    { id: 'c1', data: { nomeCarga: 'Carga Aberta', destinoNome: 'Loja Filial', status: 'PENDENTE', criadoEm: '2026-09-04T08:00:00.000Z' } },
    { id: 'c2', data: { nomeCarga: 'Carga Expedida', destinoNome: 'Loja Filial', status: 'EM_TRANSITO', criadoEm: '2026-09-03T08:00:00.000Z' } },
    { id: 'c3', data: { nomeCarga: 'Carga Recebida', destinoNome: 'Loja Filial', status: 'RECEBIDA', criadoEm: '2026-09-02T08:00:00.000Z' } },
  ]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.carregarCargasColetor();

  const html = document.getElementById('cargas-lista-itens').innerHTML;
  assert.match(html, /Carga Aberta/);
  assert.match(html, /Em montagem/);
  assert.match(html, /Carga Expedida/);
  assert.match(html, /Expedida/);
  assert.doesNotMatch(html, /Carga Recebida/, 'carga já RECEBIDA não deve aparecer na lista de em andamento');
});

// BUG AO VIVO REAL (2026-09-06): "quando finalizo a montagem ela não
// finaliza" — finalizar montagem salva certo (status continua PENDENTE de
// propósito, só a Expedição muda) mas o rótulo "Em montagem" não mudava
// nadinha, parecendo que nada tinha acontecido.
test('carregarCargasColetor + lista: carga PENDENTE com totalPaletesFisico já gravado mostra "Pronta pra expedição", não "Em montagem"', async () => {
  const cargas = mockColecao([
    { id: 'c1', data: { nomeCarga: 'Carga Montando', destinoNome: 'Loja Filial', status: 'PENDENTE', totalPaletesFisico: 0, criadoEm: '2026-09-04T08:00:00.000Z' } },
    { id: 'c2', data: { nomeCarga: 'Carga Pronta', destinoNome: 'Loja Filial', status: 'PENDENTE', totalPaletesFisico: 3, criadoEm: '2026-09-04T09:00:00.000Z' } },
  ]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.carregarCargasColetor();

  const html = document.getElementById('cargas-lista-itens').innerHTML;
  assert.match(html, /Carga Montando[\s\S]*Em montagem/);
  assert.match(html, /Carga Pronta[\s\S]*Pronta para expedição|Pronta pra expedição/);
});

// PEDIDO AO VIVO (2026-09-08): "inverte o nome da carga com o origem
// destino, e coloca o número das notas que tá vinculadas visíveis" — o
// nome que o operador deu à carga (como ele reconhece qual é qual) vira o
// destaque (inv-card-name, maior/em negrito); origem→destino passa a ser
// só o rótulo pequeno (inv-card-code) — mesma posição que antes só tinha o
// nome, agora invertida. Números de nota (NF manual + vínculo produto→
// nota do Analista) aparecem direto na lista, sem precisar abrir a carga.
test('carregarCargasColetor + lista: nome da carga é o destaque (inv-card-name), origem→destino vira o rótulo pequeno (inv-card-code), e as notas vinculadas aparecem visíveis', async () => {
  const cargas = mockColecao([{
    id: 'c1', data: {
      nomeCarga: '1° Carga Expedição', origemNome: 'Loja Filial', destinoNome: 'Loja Matriz',
      status: 'PENDENTE', totalPaletesFisico: 5, criadoEm: '2026-09-08T08:00:00.000Z',
      notasFiscais: [], notasFiscaisProdutos: [{ numero: '197825', produtos: [{ codigoProduto: '1', nomeProduto: 'X' }] }, { numero: '659458', produtos: [{ codigoProduto: '2', nomeProduto: 'Y' }] }],
    },
  }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.carregarCargasColetor();

  const item = document.querySelector('[data-carga-id="c1"]');
  const nomeEl = item.querySelector('.inv-card-name');
  const codigoEl = item.querySelector('.inv-card-code');
  assert.match(nomeEl.textContent, /1° Carga Expedição/, 'nome da carga precisa estar no destaque (inv-card-name)');
  assert.match(codigoEl.textContent, /Loja Filial.*→.*Loja Matriz/, 'origem→destino precisa estar no rótulo pequeno (inv-card-code)');
  assert.match(item.innerHTML, /197825/);
  assert.match(item.innerHTML, /659458/);
});
