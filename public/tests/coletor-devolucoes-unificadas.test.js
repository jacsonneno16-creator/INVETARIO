// Devoluções unificadas (2026-10-13): Coletor bipa a chave de uma nota de
// devolução importada pelo catálogo fiscal novo (devolucoes_notas) — TODOS
// os motivos, não só o subconjunto que o esquema antigo gravava como
// recebimento_recusas origem:'AUTOMATICO' (esse caminho legado continua
// coberto por coletor-notas-retornadas-retorno-fisico-automatico.test.js,
// pra devolução importada ANTES desta mudança). finalizar() grava
// recebimento_recusas (pátio/conferência, como sempre) E confirma o
// recebimento fiscal via confirmarRecebimentoDevolucaoClient
// (js/shared/devolucoes-confirmar.js), em paralelo, sem bloquear.
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom');
const baseColetor = path.join(__dirname, '../js/coletor');
const htmlCode = fs.readFileSync(path.join(__dirname, '../coletor.html'), 'utf8');
const navCode = fs.readFileSync(path.join(baseColetor, '10-navegacao-estorno.js'), 'utf8');
const recusasCode = fs.readFileSync(path.join(baseColetor, '24-recebimento-recusas.js'), 'utf8');

// Dígito verificador (módulo 11) precisa bater de verdade — chaveValida()
// em 24-recebimento-recusas.js faz a validação real da NF-e, não só regex.
const CHAVE_DEVOLUCAO = '33333333333333333333333333333333333333333336';

function mockColecaoNotas(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data, exists: true })) }),
    doc: (id) => ({ id, get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; } }),
  };
}
function mockColecaoRecusas(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const snapshot = (entradas) => ({ empty: entradas.length === 0, size: entradas.length, docs: entradas.map(([id, data]) => ({ id, data: () => data, exists: true })) });
  return {
    get: async () => snapshot([...registro.entries()]),
    doc: (id) => ({ id: id || ('novo' + (seq++)), get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; } }),
    add: async (payload) => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    where: (campo, _op, valor) => ({
      get: async () => snapshot([...registro.entries()].filter(([, data]) => Array.isArray(data[campo]) && data[campo].includes(valor))),
    }),
    _registro: registro,
  };
}
function mockColecaoDevolucoesNotas(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { doc: (id) => ({ id, get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; } }) };
}
function mockColecaoCadastro(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }) };
}
function cadastrosPadrao(extra) {
  return Object.assign({
    recebimento_recusas_motoristas: mockColecaoCadastro([{ id: 'm1', data: { nome: 'João', ativo: true } }]),
    recebimento_recusas_motivos: mockColecaoCadastro([{ id: 'v1', data: { nome: 'Cliente ausente', ativo: true } }]),
  }, extra);
}
function carregarColetorReal(colecoes, opts) {
  opts = opts || {};
  const dom = new JSDOM(htmlCode, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.FS = { collection: (nome) => (colecoes && colecoes[nome]) || mockColecaoCadastro([]) };
  win.getDTFirestore = () => win.FS;
  win.getDTRawFirestore = () => win.FS;
  win.getDTLojaAtiva = () => 'matriz';
  win.confirmarRecebimentoDevolucaoClient = opts.confirmarMock || (async () => ({ jaRecebida: false }));
  win.toast = () => {};
  Object.defineProperty(win.navigator, 'onLine', { get: () => true, configurable: true });
  win.eval(navCode);
  win.eval(recusasCode);
  return { win, document };
}
function selecionarComboOpcao(document, prefixo, valor) {
  const win = document.defaultView;
  const opcao = document.querySelector(`[data-combo-opcao="${prefixo}"][data-combo-valor="${valor}"]`);
  opcao.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
}

test('adicionarChave: chave de devolução PENDENTE no catálogo fiscal novo (devolucoes_notas) é aceita com os dados fiscais', async () => {
  const devNotas = mockColecaoDevolucoesNotas([{ id: CHAVE_DEVOLUCAO, data: { chave: CHAVE_DEVOLUCAO, lojaId: 'matriz', estado: 'PENDENTE', numeroNota: '777', destinatario: 'Mercado Novo', itens: [{ descricao: 'Produto Y', quantidade: 2 }] } }]);
  const { win, document } = carregarColetorReal({ ...cadastrosPadrao(), recebimento_recusas_notas: mockColecaoNotas([]), recebimento_recusas: mockColecaoRecusas([]), devolucoes_notas: devNotas });
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value = CHAVE_DEVOLUCAO;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r => setTimeout(r, 0));

  const listaHtml = document.getElementById('recusa-notas-lista').innerHTML;
  assert.match(listaHtml, /NF 777/, 'nota entra na lista com o número fiscal do catálogo novo');
});

test('adicionarChave: chave de devolução já RECEBIDA no catálogo fiscal novo bloqueia com aviso, sem deixar bipar de novo', async () => {
  const devNotas = mockColecaoDevolucoesNotas([{ id: CHAVE_DEVOLUCAO, data: { chave: CHAVE_DEVOLUCAO, lojaId: 'matriz', estado: 'RECEBIDA', numeroNota: '777' } }]);
  const toasts = [];
  const { win, document } = carregarColetorReal({ ...cadastrosPadrao(), recebimento_recusas_notas: mockColecaoNotas([]), recebimento_recusas: mockColecaoRecusas([]), devolucoes_notas: devNotas });
  win.toast = (m, t) => toasts.push({ m, t });
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value = CHAVE_DEVOLUCAO;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r => setTimeout(r, 0));

  assert.ok(toasts.some(t => /já foi recebida anteriormente/.test(t.m)));
  assert.doesNotMatch(document.getElementById('recusa-notas-lista').innerHTML, /NF 777/);
});

test('adicionarChave: chave não encontrada em nenhum catálogo (venda, automático legado, devolução novo) ainda cai no fallback manual', async () => {
  const devNotas = mockColecaoDevolucoesNotas([]);
  const { win, document } = carregarColetorReal({ ...cadastrosPadrao(), recebimento_recusas_notas: mockColecaoNotas([]), recebimento_recusas: mockColecaoRecusas([]), devolucoes_notas: devNotas });
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value = CHAVE_DEVOLUCAO;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r => setTimeout(r, 0));

  assert.ok(document.getElementById('recusa-chave-manual-numero'), 'cai no preenchimento manual do número, igual já acontecia antes');
});

test('finalizar(): depois de gravar recebimento_recusas (pátio/conferência), confirma o recebimento fiscal da chave de devolução — chamando confirmarRecebimentoDevolucaoClient uma vez por chave', async () => {
  const devNotas = mockColecaoDevolucoesNotas([{ id: CHAVE_DEVOLUCAO, data: { chave: CHAVE_DEVOLUCAO, lojaId: 'matriz', estado: 'PENDENTE', numeroNota: '777' } }]);
  const recusas = mockColecaoRecusas([]);
  const chamadas = [];
  const confirmarMock = async (db, lojaId, chave, opts) => { chamadas.push({ lojaId, chave, opts }); return { jaRecebida: false }; };
  const { win, document } = carregarColetorReal({ ...cadastrosPadrao(), recebimento_recusas_notas: mockColecaoNotas([]), recebimento_recusas: recusas, devolucoes_notas: devNotas }, { confirmarMock });
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value = CHAVE_DEVOLUCAO;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document, 'recusa-motorista', 'm1');
  selecionarComboOpcao(document, 'recusa-motivo', 'v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value = '0';
  document.getElementById('recusa-continuar-3').click();
  document.getElementById('recusa-conf-somente-volume').click();
  document.getElementById('recusa-box').value = 'box 1';
  document.getElementById('recusa-continuar-4').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0)); // Promise.allSettled da confirmação roda depois do render de sucesso

  assert.equal(recusas._registro.size, 1, 'pátio/conferência gravados normalmente, como qualquer recusa');
  assert.equal(chamadas.length, 1, 'confirmou o recebimento fiscal exatamente 1 vez');
  assert.equal(chamadas[0].chave, CHAVE_DEVOLUCAO);
  assert.equal(chamadas[0].lojaId, 'matriz');
  assert.equal(chamadas[0].opts.origem, 'COLETOR');
});

test('finalizar(): chave que já tinha sido confirmada por outro caminho (ex.: Analista) mostra aviso não-bloqueante, sem travar o fluxo de sucesso', async () => {
  const devNotas = mockColecaoDevolucoesNotas([{ id: CHAVE_DEVOLUCAO, data: { chave: CHAVE_DEVOLUCAO, lojaId: 'matriz', estado: 'PENDENTE', numeroNota: '777' } }]);
  const recusas = mockColecaoRecusas([]);
  const toasts = [];
  const confirmarMock = async () => ({ jaRecebida: true, recebimento: { origem: 'ANALISTA' } });
  const { win, document } = carregarColetorReal({ ...cadastrosPadrao(), recebimento_recusas_notas: mockColecaoNotas([]), recebimento_recusas: recusas, devolucoes_notas: devNotas }, { confirmarMock });
  win.toast = (m, t) => toasts.push({ m, t });
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value = CHAVE_DEVOLUCAO;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document, 'recusa-motorista', 'm1');
  selecionarComboOpcao(document, 'recusa-motivo', 'v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value = '0';
  document.getElementById('recusa-continuar-3').click();
  document.getElementById('recusa-conf-somente-volume').click();
  document.getElementById('recusa-box').value = 'box 1';
  document.getElementById('recusa-continuar-4').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  assert.equal(recusas._registro.size, 1, 'pátio/conferência grava normalmente mesmo com o fiscal já confirmado por outro caminho');
  assert.ok(toasts.some(t => /já tinha sido confirmado antes/.test(t.m)));
});
