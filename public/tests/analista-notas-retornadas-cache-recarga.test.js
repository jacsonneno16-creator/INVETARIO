// PEDIDO AO VIVO (2026-09-09): "o código refaz sete consultas completas
// toda vez que você entra... ao ir para Indicadores e Status, baixa a
// coleção de recusas outra vez" — carregarDados() (97-recebimento-recusas.js)
// buscava recusas/motoristas/motivos/conferentes/tarefas/vendedores/chunks
// de notas do ZERO toda vez, mesmo só trocando entre "Notas Retornadas" e
// "Cadastros" segundos depois, sem nenhum dado ter mudado. Agora só busca
// de novo quando: (a) ainda não carregou nada nesta sessão de página, ou
// (b) alguém pediu explicitamente (botão "Atualizar", ou logo depois de
// SALVAR algo — criar/editar/excluir cadastro, atribuir conferência,
// importar do BI — que aí sim precisa buscar de novo pra refletir o que
// acabou de escrever).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const recusasCode = fs.readFileSync(path.join(base, '97-recebimento-recusas.js'), 'utf8');
const statusCode = fs.readFileSync(path.join(base, '99-recebimento-retornos-status.js'), 'utf8');

function mockColecaoContada(docsIniciais, contador, nomeParaContagem) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => { contador.n++; if (nomeParaContagem) contador.chamadas.push(nomeParaContagem); return { empty: registro.size === 0, size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }; },
    doc: id => ({
      id,
      set: async payload => { const a = registro.get(id) || {}; registro.set(id, { ...a, ...payload }); },
      update: async payload => { const a = registro.get(id); if (a === undefined) throw new Error('NOT_FOUND'); registro.set(id, { ...a, ...payload }); },
      add: async payload => { registro.set('novo' + registro.size, payload); },
    }),
    add: async payload => { const id = 'novo' + registro.size; registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}
function _comColecaoNoDoc(colecao, nome) {
  const docOriginal = colecao.doc;
  colecao.doc = id => ({ ...docOriginal(id), _colecao: nome });
  return colecao;
}
function mockRawFirestore(colecoes) {
  return {
    batch: () => {
      const ops = [];
      return {
        set: (ref, payload, opts) => ops.push({ ref, payload, merge: !!opts?.merge }),
        delete: ref => ops.push({ ref, excluir: true }),
        commit: async () => { ops.forEach(op => { const col = colecoes[op.ref._colecao]; if (!col) return; if (op.excluir) { col._registro.delete(op.ref.id); return; } const atual = col._registro.get(op.ref.id) || {}; col._registro.set(op.ref.id, op.merge ? { ...atual, ...op.payload } : op.payload); }); },
      };
    },
  };
}
function carregarPagina() {
  const contador = { n: 0, chamadas: [] };
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div><div id="page-recebimento-recusas-cadastros"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const colecoes = {
    recebimento_recusas: mockColecaoContada([{ id: 'r1', data: { box: 'BOX 1', notas: [{ chave: 'CH1' }] } }], contador, 'recusas'),
    recebimento_recusas_notas: mockColecaoContada([], contador, 'notas'),
    recebimento_recusas_notas_chunks: mockColecaoContada([], contador, 'chunks'),
    recebimento_recusas_motoristas: mockColecaoContada([], contador, 'motoristas'),
    recebimento_recusas_motivos: mockColecaoContada([], contador, 'motivos'),
    recebimento_recusas_conferentes: mockColecaoContada([], contador, 'conferentes'),
    recebimento_recusas_tarefas_conferencia: mockColecaoContada([], contador, 'tarefas'),
    recebimento_recusas_vendedores_mercado: mockColecaoContada([], contador, 'vendedores'),
  };
  Object.keys(colecoes).forEach(nome => _comColecaoNoDoc(colecoes[nome], nome));
  win.getDTFirestore = () => ({ collection: nome => { if (!colecoes[nome]) colecoes[nome] = _comColecaoNoDoc(mockColecaoContada([], contador, nome), nome); return colecoes[nome]; } });
  win.getDTRawFirestore = () => mockRawFirestore(colecoes);
  win.firebase = { auth: () => ({ currentUser: { uid: 'u1', email: 'analista@daterrinha.com' } }) };
  win.showToast = () => {};
  win.aplicarPermissoesAnalista = () => {};
  win.openModal = () => {};
  win.closeModal = () => {};
  win.eval(statusCode);
  win.eval(recusasCode);
  return { win, document, contador };
}

test('BUG AO VIVO REAL: entrar em Notas Retornadas e depois em Cadastros NÃO refaz as 7 buscas de novo — reaproveita o que já carregou', async () => {
  const { win, contador } = carregarPagina();

  await win.renderRecebimentoRecusas();
  const chamadasAposPrimeiraEntrada = contador.n;
  assert.ok(chamadasAposPrimeiraEntrada > 0, 'a primeira entrada precisa buscar de verdade');

  await win.renderRecebimentoRecusasCadastros();
  assert.equal(contador.n, chamadasAposPrimeiraEntrada, 'trocar pra Cadastros não pode refazer nenhuma busca — os mesmos 7 dados já estão em memória');

  await win.renderRecebimentoRecusas();
  assert.equal(contador.n, chamadasAposPrimeiraEntrada, 'voltar pra Notas Retornadas também não pode refazer busca nenhuma');
});

test('botão "Atualizar" força busca nova mesmo com dado já carregado', async () => {
  const { win, document, contador } = carregarPagina();
  await win.renderRecebimentoRecusas();
  const chamadasAntes = contador.n;

  document.querySelector('[data-recusa-atualizar]').click();
  await new Promise(r => setTimeout(r, 0));

  assert.ok(contador.n > chamadasAntes, '"Atualizar" precisa forçar busca nova, ignorando o cache');
});

test('depois de SALVAR um cadastro novo, a lista busca de novo (não fica mostrando cache desatualizado)', async () => {
  const { win, document, contador } = carregarPagina();
  await win.renderRecebimentoRecusasCadastros();
  const chamadasAntes = contador.n;

  const input = document.getElementById('recusas-motorista-novo');
  input.value = 'Motorista Teste';
  document.querySelector('[data-recusa-add="motorista"]').click();
  await new Promise(r => setTimeout(r, 0));

  assert.ok(contador.n > chamadasAntes, 'salvar um cadastro precisa buscar de novo pra mostrar o que acabou de ser criado');
});
