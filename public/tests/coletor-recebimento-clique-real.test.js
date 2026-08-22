'use strict';
/**
 * Regressão do bug relatado ao vivo: tocar num card de "cargas em
 * andamento" na tela de Recebimento do Coletor não fazia nada — sem erro
 * nenhum. Causa raiz: o card usava `onclick="..."` inline, atribuído via
 * `lista.innerHTML = ...`. O sanitizador global de innerHTML
 * (js/shared/common-utils.js, "defesa central para innerHTML") REMOVE
 * qualquer atributo `on*` de HTML inserido dinamicamente, como proteção
 * contra XSS — silenciosamente, sem lançar erro nenhum. Por isso nem o
 * toast de diagnóstico mais básico aparecia: o atributo onclick nunca
 * chegava a existir de verdade no DOM.
 *
 * O resto do Coletor (05-inventarios-download.js, 17-auditoria-meta.js) já
 * evitava isso ligando o clique via `card.addEventListener(...)` depois de
 * inserir o HTML — 22-recebimento.js foi corrigido pro mesmo padrão.
 *
 * Este teste usa jsdom com o sanitizador REAL instalado (mesmo ambiente de
 * produção) e despacha um clique de verdade no card renderizado — não
 * chama abrirConfirmacaoParaRecebimento() diretamente — porque só assim se
 * prova que o clique físico realmente aciona a função depois de passar
 * pelo sanitizador.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const commonUtilsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'common-utils.js'), 'utf8');
const recCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'coletor', '22-recebimento.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  const snapshot = entradas => ({ empty: entradas.length === 0, size: entradas.length, docs: entradas.map(([id, data]) => ({ id, data: () => data, exists: true })) });
  return {
    get: async () => snapshot([...registro.entries()]),
    doc: id => ({ id, get: async () => ({ exists: registro.has(id), id, data: () => registro.get(id) }), set: async p => { const a = registro.get(id) || {}; registro.set(id, { ...a, ...p }); } }),
    add: async payload => { const id = 'novo' + registro.size; registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}

function montarAmbiente(colecoes) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="rec-lista-andamento"></div>
    <div id="rec-lista-titulo"></div>
    <div id="rec-nf-titulo"></div><div id="rec-nf-subtitulo"></div><button id="rec-nf-btn"></button>
    <input id="rec-nf-input"><div id="rec-nf-status"></div>
    <div id="rec-conf-icone"></div><div id="rec-conf-titulo"></div><div id="rec-conf-corpo"></div>
  </body></html>`, { runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(commonUtilsCode); // instala o sanitizador REAL de innerHTML, igual produção
  win.FS = { collection: nome => colecoes?.[nome] || mockColecao([]) };
  win.APP = { operador: { email: 'operador@daterrinha.com' } };
  win.navigator.__defineGetter__ ? null : null;
  win.toast = () => {};
  win.obterDeviceId = () => 'dt_teste';
  const telas = [];
  win.goScreen = id => { telas.push(id); };
  win.eval(recCode);
  return { win, telas };
}

test('sanitizador real de innerHTML remove onclick inline — por isso o card não pode depender dele', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="alvo"></div></body></html>', { runScripts: 'outside-only' });
  dom.window.eval(commonUtilsCode);
  const alvo = dom.window.document.getElementById('alvo');
  alvo.innerHTML = '<div onclick="algo()" data-x="1">teste</div>';
  const filho = alvo.firstElementChild;
  assert.equal(filho.hasAttribute('onclick'), false); // removido pelo sanitizador
  assert.equal(filho.getAttribute('data-x'), '1'); // atributos normais sobrevivem
});

test('REGRESSÃO: tocar num card de carga em andamento de verdade aciona abrirConfirmacaoParaRecebimento, mesmo com o sanitizador real instalado', async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', notaFiscalTransferencia: '999', identificadorCodigo: 'TRB-1', origem: 'Matriz', destino: 'Filial 2' } }]);
  const { win, telas } = montarAmbiente({ recebimentos, recebimento_auditoria: mockColecao([]) });

  await win.carregarRecebimentoColetor();
  const lista = win.document.getElementById('rec-lista-andamento');
  const card = lista.querySelector('.inv-card[data-recid="r1"]');
  assert.ok(card, 'o card precisa existir no DOM com data-recid, não onclick');
  assert.equal(card.hasAttribute('onclick'), false);

  // Despacha um clique de VERDADE (bubbles:true, igual um toque real) —
  // não chama a função diretamente, para provar que o listener está
  // realmente ligado ao elemento depois da renderização.
  const evento = new win.Event('click', { bubbles: true, cancelable: true });
  card.dispatchEvent(evento);
  await new Promise(r => setTimeout(r, 0)); // abrirConfirmacaoParaRecebimento é async

  assert.ok(telas.includes('recebimento-nf'), 'o clique deveria ter navegado pra tela de conferência de NF');
});
