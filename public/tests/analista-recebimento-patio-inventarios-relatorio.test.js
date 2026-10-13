// Recebimento · Inventários do Pátio (Relatório) — 124-recebimento-patio-
// inventarios-relatorio.js. Lê recebimento_patio_inventarios, gravada pelo
// Coletor (29-recebimento-patio-inventario.js/confirmarFinalizacao()) a
// cada "Finalizar" — 1 documento imutável por sessão, pra responder
// "quais notas foram encontradas naquele inventário" sem mistura com notas
// que chegaram depois.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '124-recebimento-patio-inventarios-relatorio.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    _registro: registro,
    orderBy: () => ({
      limit: () => ({
        get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
      }),
    }),
  };
}

let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-patio-inventarios"></div><div id="patio-inv-detalhe-corpo"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _janelasAbertas.push(win);
  win.getDTFirestore = () => ({ collection: nome => (colecoes && colecoes[nome]) || mockColecao([]) });
  win.openModal = () => {};
  win.closeModal = () => {};
  win.eval(code);
  return { win, document: win.document };
}

test('lista vazia: mostra mensagem de nenhum inventário, sem erro', async () => {
  const { win, document } = carregarPagina({ recebimento_patio_inventarios: mockColecao([]) });
  await win.renderPatioInventariosRelatorio();
  const html = document.getElementById('page-recebimento-patio-inventarios').innerHTML;
  assert.match(html, /Nenhum inventário do pátio registrado/);
});

test('renderiza a lista de sessões com data, operador e as 2 contagens', async () => {
  const sessoes = mockColecao([
    { id: 's1', data: { data: '2026-10-02T14:00:00.000Z', operadorNome: 'Maria Operadora', notasEncontradas: ['1', '2'], qtdEncontradas: 2, notasEncerradas: [{ numeroNota: '9', tratamento: 'RECUSA' }], qtdTotalEncerrar: 1 } },
  ]);
  const { win, document } = carregarPagina({ recebimento_patio_inventarios: sessoes });
  await win.renderPatioInventariosRelatorio();
  const html = document.getElementById('page-recebimento-patio-inventarios').innerHTML;
  assert.match(html, /Maria Operadora/);
  assert.match(html, />2</);
  assert.match(html, /data-patio-inv-detalhe="s1"/);
});

test('clicar no botão de detalhe abre o modal e mostra as notas encontradas e encerradas desta sessão, sem nova consulta ao Firestore', async () => {
  const sessoes = mockColecao([
    { id: 's1', data: { data: '2026-10-02T14:00:00.000Z', operadorNome: 'Maria Operadora', notasEncontradas: ['1', '2'], qtdEncontradas: 2, notasEncerradas: [{ numeroNota: '9', tratamento: 'RECUSA' }, { numeroNota: '10', tratamento: 'SEM_CLASSIFICACAO' }], qtdTotalEncerrar: 2 } },
  ]);
  const { win, document } = carregarPagina({ recebimento_patio_inventarios: sessoes });
  await win.renderPatioInventariosRelatorio();

  // troca a coleção mockada por uma que derruba o teste se for consultada
  // de novo — a prova de que o detalhe usa o cache em memória (_porId),
  // igual ao padrão de _auditoriaPorRecebimento em 94-recebimento-relatorios.js.
  win.getDTFirestore = () => ({ collection: () => { throw new Error('não deveria consultar o Firestore de novo'); } });

  document.querySelector('[data-patio-inv-detalhe="s1"]').click();
  await new Promise(r => setTimeout(r, 0));

  const corpo = document.getElementById('patio-inv-detalhe-corpo').innerHTML;
  assert.match(corpo, /Encontradas \(2\)/);
  assert.match(corpo, /Encerradas \(2\)/);
  assert.match(corpo, />1</);
  assert.match(corpo, />2</);
  assert.match(corpo, />9</);
  assert.match(corpo, /Recusa/);
  assert.match(corpo, /Sem classificação/);
});
