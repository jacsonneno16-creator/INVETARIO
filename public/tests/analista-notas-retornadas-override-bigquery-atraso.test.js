// BUG AO VIVO REAL (2026-10-14): "o analista muda o motivo de 5 notas,
// recarrega na hora e elas voltam pro motivo antigo". Esta tela lê via
// buscarIndicadoresRetornosBigQuery, um espelho do Firestore com atraso de
// propagação — alterarMotivo()/alterarTratamento() gravam certo e na hora
// no Firestore, mas um "Buscar" (ou F5) logo em seguida pode consultar o
// BigQuery ANTES do espelho atualizar, mostrando o valor antigo por cima
// da edição real. Fix: guarda a edição recém-feita em localStorage com o
// MESMO timestamp gravado (motivoAlteradoEm/tratamentoDefinidoEm) e
// reaplica por cima do que o BigQuery devolver, só enquanto o timestamp do
// BigQuery ainda for mais antigo — assim que o espelho alcança, o override
// se apaga sozinho.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const recusasCode = fs.readFileSync(path.join(base, '97-recebimento-recusas.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ empty: registro.size === 0, size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, update: async (payload) => { const a = registro.get(id) || {}; registro.set(id, { ...a, ...payload }); } }),
    _registro: registro,
  };
}

let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) { } }); _janelasAbertas = []; });

// `obterRespostaAtual()` é consultada A CADA chamada do callable mockado —
// o teste troca o que ela devolve entre um clique e outro em "Buscar", pra
// simular o espelho do BigQuery ainda atrasado e depois já alcançado.
function carregarPagina(colecoes, obterRespostaAtual) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  win.getDTFirestore = () => ({ collection: (nome) => colecoes[nome] || mockColecao([]) });
  win.getDTLojaAtiva = () => 'loja_matriz';
  win.firebase = {
    auth: () => ({ currentUser: { uid: 'u1', email: 'analista@daterrinha.com' } }),
    app: () => ({ functions: () => ({ httpsCallable: (nomeFuncao) => async () => {
      if (nomeFuncao !== 'buscarIndicadoresRetornosBigQuery') throw new Error('função não mockada: ' + nomeFuncao);
      return { data: { recusas: obterRespostaAtual() } };
    } }) }),
  };
  win.showToast = () => { };
  win.aplicarPermissoesAnalista = () => { };
  win.eval(recusasCode);
  return { win, document };
}

async function montarEBuscar(colecoes, obterRespostaAtual) {
  const { win, document } = carregarPagina(colecoes, obterRespostaAtual);
  await win.renderRecebimentoRecusas();
  document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  return { win, document };
}
async function buscarDeNovo(document) {
  document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
}

test('motivo: edição sobrevive a um "Buscar" de novo mesmo que o BigQuery ainda devolva o valor antigo (atraso de propagação)', async () => {
  const motivos = mockColecao([{ id: 'm1', data: { nome: 'PEDIDO CANCELADO', ativo: true } }]);
  const recusas = mockColecao([{ id: 'r1', data: { box: 'BOX 19', notas: [{ numeroNota: '200846' }], criadoEm: '2026-08-19T10:00:00.000Z', motivoId: '', motivoNome: '' } }]);
  const docAntigo = () => [{ _id: 'r1', box: 'BOX 19', notas: [{ numeroNota: '200846' }], criadoEm: '2026-08-19T10:00:00.000Z', motivoId: '', motivoNome: '' }];
  const { win, document } = await montarEBuscar(
    { recebimento_recusas: recusas, recebimento_recusas_motoristas: mockColecao([]), recebimento_recusas_motivos: motivos },
    docAntigo // o mock SEMPRE devolve o valor antigo — simula o espelho nunca alcançando
  );

  const campo = document.querySelector('[data-recusa-motivo="r1"]');
  campo.value = 'PEDIDO CANCELADO';
  campo.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(recusas._registro.get('r1').motivoId, 'm1', 'gravou certo no Firestore');

  // "recarrega" — Buscar de novo; o BigQuery ainda devolve o doc ANTIGO.
  await buscarDeNovo(document);

  const tabelaDepois = document.getElementById('recusas-tabela').innerHTML;
  assert.match(tabelaDepois, /value="PEDIDO CANCELADO"/, 'o override local precisa aparecer por cima do valor antigo vindo do BigQuery');
});

test('motivo: override some sozinho assim que o BigQuery alcança a edição (nunca fica preso pra sempre)', async () => {
  const motivos = mockColecao([{ id: 'm1', data: { nome: 'PEDIDO CANCELADO', ativo: true } }]);
  const recusas = mockColecao([{ id: 'r1', data: { box: 'BOX 19', notas: [{ numeroNota: '200846' }], criadoEm: '2026-08-19T10:00:00.000Z', motivoId: '', motivoNome: '' } }]);
  let motivoAlteradoEm = '';
  const docAntigo = () => [{ _id: 'r1', box: 'BOX 19', notas: [{ numeroNota: '200846' }], criadoEm: '2026-08-19T10:00:00.000Z', motivoId: '', motivoNome: '' }];
  let alcancou = false;
  const resposta = () => alcancou
    ? [{ _id: 'r1', box: 'BOX 19', notas: [{ numeroNota: '200846' }], criadoEm: '2026-08-19T10:00:00.000Z', motivoId: 'm1', motivoNome: 'PEDIDO CANCELADO', motivoAlteradoEm }]
    : docAntigo();
  const { win, document } = await montarEBuscar(
    { recebimento_recusas: recusas, recebimento_recusas_motoristas: mockColecao([]), recebimento_recusas_motivos: motivos },
    resposta
  );
  const campo = document.querySelector('[data-recusa-motivo="r1"]');
  campo.value = 'PEDIDO CANCELADO';
  campo.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 0));
  motivoAlteradoEm = recusas._registro.get('r1').motivoAlteradoEm;

  alcancou = true; // o BigQuery "alcançou" a edição
  await buscarDeNovo(document);

  const overridesRestantes = JSON.parse(win.localStorage.getItem('dt_recusas_edicoes_pendentes_loja_matriz') || '{}');
  assert.deepEqual(overridesRestantes, {}, 'depois que o BigQuery alcança, o override tem que ser removido do localStorage');
});

test('tratamento: edição por nota sobrevive ao mesmo atraso de propagação', async () => {
  const motivos = mockColecao([]);
  const recusas = mockColecao([{ id: 'r1', data: { box: 'BOX 4', notas: [{ chave: 'c1', numeroNota: '200878' }], criadoEm: '2026-08-19T10:00:00.000Z' } }]);
  const docAntigo = () => [{ _id: 'r1', box: 'BOX 4', notas: [{ chave: 'c1', numeroNota: '200878' }], criadoEm: '2026-08-19T10:00:00.000Z' }];
  const { win, document } = await montarEBuscar(
    { recebimento_recusas: recusas, recebimento_recusas_motoristas: mockColecao([]), recebimento_recusas_motivos: motivos },
    docAntigo
  );

  const select = document.querySelector('[data-recusa-tratamento="r1|c1"]');
  select.value = 'RECUSA';
  select.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(recusas._registro.get('r1').notas[0].tratamento, 'RECUSA');

  await buscarDeNovo(document);
  const tabelaDepois = document.getElementById('recusas-tabela').innerHTML;
  assert.match(tabelaDepois, /value="RECUSA"[^<]*selected/s);
});
