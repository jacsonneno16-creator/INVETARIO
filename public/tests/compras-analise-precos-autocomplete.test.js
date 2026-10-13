// PEDIDO AO VIVO (2026-09-18): "escrevo farofa e ele traz toda a família
// junto... tem que ser mais fácil, sugerir enquanto digita e buscar exato".
// A Análise de Preços agora sugere produtos reais (buscarProdutosComprasBigQuery)
// enquanto a pessoa digita, e só busca de fato depois de escolher UM da
// lista — por produtoKey exato, nunca mais por texto solto (LIKE).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/121-compras-profissional.js'), 'utf8');

function mockColecao(docs) {
  const registro = new Map((docs || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }), doc: () => ({ set: async () => {} }), where: () => ({ get: async () => ({ docs: [] }) }) };
}

function carregarPagina({ callableRespostas } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-precos"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.showToast = () => {};
  win.temPermissao = () => true;
  win._currentAnalistaUser = { uid: 'u1', email: 'comprador@empresa.com', nome: 'Comprador' };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  const cols = { pcp_requisicoes_compra: mockColecao([]), producao_produtos: mockColecao([]), pcp_agendamentos: mockColecao([]), compras_regras_comprador: mockColecao([]), recebimento_agendamentos: mockColecao([]) };
  win.getDTFirestore = () => ({ collection: (nome) => cols[nome] || mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: () => mockColecao([]) });
  const chamadas = [];
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nome => async payload => {
    chamadas.push({ nome, payload });
    const r = (callableRespostas && callableRespostas[nome]) ? callableRespostas[nome](payload) : { data: {} };
    return r;
  } }) }) };
  win.eval(code);
  return { win, document, chamadas };
}

test('digitar no campo de produto mostra sugestões reais (não a família toda misturada), e selecionar uma busca por produtoKey exato', async () => {
  const { win, document, chamadas } = carregarPagina({
    callableRespostas: {
      buscarProdutosComprasBigQuery: () => ({ data: { produtos: [
        { produtoKey: '101', descricao: 'Farofa Tradicional 500g', notas: 40 },
        { produtoKey: '102', descricao: 'Farofa Pronta Bacon 500g', notas: 12 },
      ] } }),
      buscarHistoricoComprasBigQuery: () => ({ data: { linhas: [] } }),
    },
  });
  await win.renderComprasProfissional('precos');
  const campo = document.getElementById('cp-preco-produto');
  campo.value = 'farofa';
  campo.dispatchEvent(new win.Event('input', { bubbles: true }));
  // debounce de 300ms
  await new Promise(r => setTimeout(r, 350));
  let html = document.getElementById('cp-preco-sugestoes-host').innerHTML;
  assert.match(html, /Farofa Tradicional 500g/);
  assert.match(html, /Farofa Pronta Bacon 500g/);
  assert.equal(chamadas.filter(c => c.nome === 'buscarProdutosComprasBigQuery').length, 1);

  document.querySelector('[data-cp-preco-sugestao="101"]').click();
  await new Promise(r => setTimeout(r, 0));
  const buscaHist = chamadas.find(c => c.nome === 'buscarHistoricoComprasBigQuery');
  assert.equal(buscaHist.payload.produtoKey, '101', 'busca por produtoKey EXATO, não por texto');
  assert.equal(buscaHist.payload.produto, undefined, 'nunca manda o texto solto junto quando já tem produtoKey');
});

test('sem produtoKey selecionado (Enter/Buscar direto), continua caindo no texto livre de sempre — não trava quem não usa a sugestão', async () => {
  const { win, document, chamadas } = carregarPagina({
    callableRespostas: { buscarHistoricoComprasBigQuery: () => ({ data: { linhas: [] } }) },
  });
  await win.renderComprasProfissional('precos');
  document.getElementById('cp-preco-produto').value = 'qualquer coisa';
  document.querySelector('[data-cp-preco-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  const buscaHist = chamadas.find(c => c.nome === 'buscarHistoricoComprasBigQuery');
  assert.equal(buscaHist.payload.produto, 'qualquer coisa');
  assert.equal(buscaHist.payload.produtoKey, undefined);
});

test('digitar de novo depois de já ter escolhido uma sugestão limpa o produtoKey (não fica preso na seleção antiga)', async () => {
  const { win, document, chamadas } = carregarPagina({
    callableRespostas: {
      buscarProdutosComprasBigQuery: () => ({ data: { produtos: [{ produtoKey: '101', descricao: 'Farofa Tradicional 500g', notas: 5 }] } }),
      buscarHistoricoComprasBigQuery: () => ({ data: { linhas: [] } }),
    },
  });
  await win.renderComprasProfissional('precos');
  const campo = document.getElementById('cp-preco-produto');
  campo.value = 'farofa';
  campo.dispatchEvent(new win.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350));
  document.querySelector('[data-cp-preco-sugestao="101"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chamadas.find(c => c.nome === 'buscarHistoricoComprasBigQuery').payload.produtoKey, '101');

  // digita de novo, SEM escolher uma nova sugestão desta vez, e clica Buscar:
  const campo2 = document.getElementById('cp-preco-produto');
  campo2.value = 'outra coisa';
  campo2.dispatchEvent(new win.Event('input', { bubbles: true }));
  document.querySelector('[data-cp-preco-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  const ultimaBusca = [...chamadas].reverse().find(c => c.nome === 'buscarHistoricoComprasBigQuery');
  assert.equal(ultimaBusca.payload.produto, 'outra coisa', 'voltou a buscar por texto livre — o produtoKey antigo (101) não vazou pra essa busca nova');
  assert.equal(ultimaBusca.payload.produtoKey, undefined);
});

test('busca de produtos: texto com menos de 2 letras não dispara consulta nenhuma', async () => {
  const { win, document, chamadas } = carregarPagina();
  await win.renderComprasProfissional('precos');
  const campo = document.getElementById('cp-preco-produto');
  campo.value = 'f';
  campo.dispatchEvent(new win.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350));
  assert.equal(chamadas.filter(c => c.nome === 'buscarProdutosComprasBigQuery').length, 0);
});

// BUG AO VIVO REAL (2026-09-18): "só aparece um produto por vez, deveria
// abrir uma caixa maior mostrando uns 10, com barra de rolagem" — o div de
// sugestões tinha position:absolute IGUAL ao container pai (que já é o
// posicionado); um absolute dentro de outro fica com altura zero (o filho
// sai do fluxo, não sobra nada pro pai medir), então só sobrava ~1 linha
// visível por cima da página. O filho não pode mais ser position:absolute
// (o pai, #cp-preco-sugestoes-host, já cuida disso), e a caixa precisa de
// altura suficiente pra caber várias sugestões (~10) antes de rolar.
test('dropdown de sugestão: NÃO duplica position:absolute (bug real: colapsava a caixa pra 1 linha), e cabe ~10 produtos antes de precisar rolar', async () => {
  const { win, document } = carregarPagina({
    callableRespostas: {
      buscarProdutosComprasBigQuery: () => ({ data: { produtos: Array.from({ length: 10 }, (_, i) => ({ produtoKey: String(100 + i), descricao: 'Batata Variante ' + i, notas: 10 - i })) } }),
    },
  });
  await win.renderComprasProfissional('precos');
  const campo = document.getElementById('cp-preco-produto');
  campo.value = 'batata';
  campo.dispatchEvent(new win.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 350));
  const host = document.getElementById('cp-preco-sugestoes-host');
  const caixa = host.querySelector('.dt-autocomplete');
  assert.ok(caixa, 'a caixa de sugestões foi desenhada');
  assert.doesNotMatch(caixa.getAttribute('style') || '', /position\s*:\s*absolute/, 'o filho não pode repetir position:absolute do pai — colapsa a altura');
  const maxHeight = parseInt((caixa.getAttribute('style') || '').match(/max-height\s*:\s*(\d+)px/)?.[1] || '0', 10);
  assert.ok(maxHeight >= 300, 'altura generosa o bastante pra caber uns 10 produtos (~35px cada) antes de precisar rolar: ' + maxHeight);
  assert.equal(host.querySelectorAll('[data-cp-preco-sugestao]').length, 10, 'as 10 sugestões estão todas no DOM (a rolagem é só visual, via CSS, não some produto)');
});
