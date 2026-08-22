'use strict';
// PEDIDO AO VIVO (usuário: "na parte de recebimento, quando a carga estiver
// em andamento, a pessoa poder colocar em qualquer etapa algum motivo, para
// justificar uma possível demora") — antes só dava pra escolher uma
// observação (do cadastro do Analista) na tela de NF da SAÍDA. Agora todo
// card "em andamento" (qualquer status antes de FINALIZADO/CANCELADO) tem
// um botão "📝 Motivo" que abre o MESMO modal de seleção e grava direto no
// registro, em qualquer etapa.
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
    doc: id => ({
      id,
      get: async () => ({ exists: registro.has(id), id, data: () => registro.get(id) }),
      set: async p => { const a = registro.get(id) || {}; registro.set(id, { ...a, ...p }); },
      update: async p => { const a = registro.get(id); if (a === undefined) throw new Error('NOT_FOUND'); registro.set(id, { ...a, ...p }); },
    }),
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
    <div id="rec-obs-modal" style="display:none">
      <div id="rec-obs-titulo"></div>
      <div id="rec-obs-subtitulo"></div>
      <input id="rec-obs-busca">
      <div id="rec-obs-opcoes"></div>
      <button id="rec-obs-rodape-btn" onclick="_acaoRodapeObservacaoTransbordo()"></button>
    </div>
  </body></html>`, { runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(commonUtilsCode); // sanitizador real, igual produção
  win.FS = { collection: nome => colecoes?.[nome] || mockColecao([]) };
  win.APP = { operador: { email: 'operador@daterrinha.com' } };
  win.toast = () => {};
  win.obterDeviceId = () => 'dt_teste';
  win.goScreen = () => {};
  win.eval(recCode);
  // jsdom com runScripts:'outside-only' não executa atributos onclick=""
  // inline (só o eval() explícito acima) — liga por addEventListener aqui
  // só pra este teste conseguir clicar o botão; a página real (coletor.html)
  // usa onclick="" estático de verdade, que o browser executa normalmente.
  win.document.getElementById('rec-obs-rodape-btn')?.addEventListener('click', () => win._acaoRodapeObservacaoTransbordo());
  return { win };
}

function clicarBotao(win, seletor) {
  const el = win.document.querySelector(seletor);
  assert.ok(el, 'esperava encontrar ' + seletor);
  el.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));
}

test('PEDIDO AO VIVO: card em andamento (qualquer etapa) mostra o botão "📝 Motivo"',async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origem: 'Matriz', destino: 'Filial 2', identificadorCodigo: 'TRB-1' } },
    { id: 'r2', data: { tipo: 'TRANSBORDO', status: 'EM_DESCARGA', origem: 'Matriz', destino: 'Filial 2', identificadorCodigo: 'TRB-2' } },
  ]);
  const { win } = montarAmbiente({ recebimentos, recebimento_auditoria: mockColecao([]) });
  await win.carregarRecebimentoColetor();
  win._selecionarAbaRecebimento('andamento');
  assert.ok(win.document.querySelector('[data-recid-motivo="r2"]'), 'carga em EM_DESCARGA precisa ter o botão de motivo');
});

test('PEDIDO AO VIVO: card FINALIZADO não mostra o botão de motivo (processo já fechado)',async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', origem: 'Matriz', destino: 'Filial 2' } }]);
  const { win } = montarAmbiente({ recebimentos, recebimento_auditoria: mockColecao([]) });
  await win.carregarRecebimentoColetor();
  win._selecionarAbaRecebimento('recebidas');
  assert.equal(win.document.querySelector('[data-recid-motivo="r1"]'), null);
});

test('PEDIDO AO VIVO: tocar em "📝 Motivo", escolher um motivo cadastrado, grava direto na carga (sem passar pela tela de NF)',async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origem: 'Matriz', destino: 'Filial 2', motoristaNome: 'Carlos' } }]);
  const motivos = mockColecao([{ id: 'm1', data: { texto: 'Trânsito intenso na rodovia', ativa: true } }]);
  const { win } = montarAmbiente({ recebimentos, recebimento_observacoes_transbordo: motivos, recebimento_auditoria: mockColecao([]) });
  await win.carregarRecebimentoColetor();
  win._selecionarAbaRecebimento('transito');

  clicarBotao(win, '[data-recid-motivo="r1"]');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win.document.getElementById('rec-obs-modal').style.display, 'flex', 'o modal de seleção precisa abrir');

  const opcao = win.document.querySelector('[data-rec-obs-id="m1"]');
  assert.ok(opcao, 'a opção cadastrada precisa aparecer na lista');
  opcao.dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  assert.equal(win.document.getElementById('rec-obs-modal').style.display, 'none', 'o modal fecha depois de escolher');
  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.observacao, 'Trânsito intenso na rodovia');
  assert.equal(doc.observacaoId, 'm1');
  assert.ok(doc.atualizadoEm);

  // o card volta a mostrar o motivo escolhido
  assert.match(win.document.getElementById('rec-lista-andamento').innerHTML, /Trânsito intenso na rodovia/);
  assert.match(win.document.querySelector('[data-recid-motivo="r1"]').textContent, /Trocar motivo/);
});

test('PEDIDO AO VIVO: motivo escolhido é registrado na auditoria (recebimento_auditoria), preservando o valor anterior',async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'EM_DESCARGA', origem: 'Matriz', destino: 'Filial 2', observacao: 'Fila na doca' } }]);
  const motivos = mockColecao([{ id: 'm2', data: { texto: 'Quebra do empilhadeira', ativa: true } }]);
  const auditoria = mockColecao([]);
  const { win } = montarAmbiente({ recebimentos, recebimento_observacoes_transbordo: motivos, recebimento_auditoria: auditoria });
  await win.carregarRecebimentoColetor();
  win._selecionarAbaRecebimento('andamento');

  clicarBotao(win, '[data-recid-motivo="r1"]');
  await new Promise(r => setTimeout(r, 0));
  win.document.querySelector('[data-rec-obs-id="m2"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  const registros = [...auditoria._registro.values()];
  const evento = registros.find(x => x.operacao === 'MOTIVO_ATUALIZADO');
  assert.ok(evento, 'precisa registrar MOTIVO_ATUALIZADO na auditoria');
  assert.equal(evento.valorAnterior, 'Fila na doca');
  assert.equal(evento.valorNovo, 'Quebra do empilhadeira');
});

test('PEDIDO AO VIVO: rodapé do modal remove o motivo atual quando aberto a partir de um card que já tem motivo',async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'CHEGOU', origem: 'Matriz', destino: 'Filial 2', observacao: 'Fila na doca', observacaoId: 'm1' } }]);
  const { win } = montarAmbiente({ recebimentos, recebimento_observacoes_transbordo: mockColecao([]), recebimento_auditoria: mockColecao([]) });
  await win.carregarRecebimentoColetor();
  win._selecionarAbaRecebimento('andamento');

  clicarBotao(win, '[data-recid-motivo="r1"]');
  await new Promise(r => setTimeout(r, 0));
  assert.match(win.document.getElementById('rec-obs-rodape-btn').textContent, /Remover motivo/);

  clicarBotao(win, '#rec-obs-rodape-btn');
  await new Promise(r => setTimeout(r, 0));

  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.observacao, '');
  assert.match(win.document.getElementById('rec-lista-andamento').innerHTML, /📝 Motivo/);
  assert.doesNotMatch(win.document.getElementById('rec-lista-andamento').innerHTML, /Fila na doca/);
});

test('rodapé do modal NÃO grava nada quando aberto pelo fluxo antigo (seleção de observação da saída) — continua "Continuar sem observação"',async () => {
  const { win } = montarAmbiente({ recebimento_observacoes_transbordo: mockColecao([]), recebimento_auditoria: mockColecao([]) });
  await win.abrirSeletorObservacaoTransbordo();
  assert.match(win.document.getElementById('rec-obs-rodape-btn').textContent, /Continuar sem observação/);
});

test('carga que não é mais desta loja (turno já passou pro destino) não deixa editar o motivo por aqui',async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origem: 'Matriz', destino: 'Filial 2', origemLojaId: 'matriz', destinoLojaId: 'filial2' } }]);
  const motivos = mockColecao([{ id: 'm1', data: { texto: 'Trânsito', ativa: true } }]);
  const toasts = [];
  const { win } = montarAmbiente({ recebimentos, recebimento_observacoes_transbordo: motivos, recebimento_auditoria: mockColecao([]) });
  win.getDTLojaAtiva = () => 'matriz'; // origem — depois de EM_TRANSITO, a vez já é do destino
  win.toast = (m) => toasts.push(m);
  await win.carregarRecebimentoColetor();

  await win.abrirSeletorMotivoEtapa('r1');
  win.document.querySelector('[data-rec-obs-id="m1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  assert.ok(toasts.some(t => /não pertence mais a esta loja/.test(t)));
  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.observacao, undefined, 'não pode ter gravado nada');
});
