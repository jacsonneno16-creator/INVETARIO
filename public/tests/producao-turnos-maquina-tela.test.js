// PEDIDO AO VIVO: usuário abriu Configurações → Máquinas → Turnos por
// Máquina e viu "ainda não foi implementado nesta integração" — a tela
// realmente não existia como visão de tabela única (só dava pra editar
// turno máquina-por-máquina dentro do modal de Cadastro). Este teste dirige
// a nova tela renderProducaoTurnosMaquinas via DOM real (jsdom) + Firestore
// mockado, confirmando que ela: carrega as máquinas existentes, mostra as
// faixas de turno já cadastradas, grava no Firestore ao editar horário,
// adicionar/remover faixa, aplicar atalho T1/T2/T3, e copiar turnos de uma
// máquina pra todas as outras.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const maquinasCode = fs.readFileSync(path.join(base, '61-producao-maquinas.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ empty: registro.size === 0, size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({
      id,
      get: async () => ({ exists: registro.has(id), data: () => registro.get(id) }),
      set: async (payload, opts) => { const a = (opts && opts.merge) ? (registro.get(id) || {}) : {}; registro.set(id, { ...a, ...payload }); },
      delete: async () => { registro.delete(id); },
    }),
    _registro: registro,
  };
}

function carregarPagina(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body><div id="pcfg-embed-host"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.getDTFirestore = () => ({ collection: (nome) => colecoes[nome] || mockColecao([]) });
  win.showToast = () => {};
  win.showConfirm = (msg, executar) => executar();
  win.DTProducao = { registrarInvalidacao: () => {} };
  win.eval(maquinasCode);
  return { win, document, colecoes };
}

test('Turnos por Máquina: renderiza a matriz com as máquinas e faixas já cadastradas', async () => {
  const maquinas = mockColecao([
    { id: 'm1', data: { nome: 'ENVASADORA 1', turnos: { 0: [], 1: [{ ini: '08:00', fim: '17:00' }], 2: [], 3: [], 4: [], 5: [], 6: [] } } },
    { id: 'm2', data: { nome: 'EMPACOTADEIRA 1', turnos: {} } },
  ]);
  const { win, document } = carregarPagina({
    producao_maquinas: maquinas, producao_registros: mockColecao([]), producao_setup: mockColecao([]), producao_categorias: mockColecao([]), producao_config: mockColecao([]),
  });

  await win.renderProducaoTurnosMaquinas('pcfg-embed-host');
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.match(html, /Turnos por Máquina/);
  assert.match(html, /ENVASADORA 1/);
  assert.match(html, /EMPACOTADEIRA 1/);
  assert.match(html, /value="08:00"/);
  assert.match(html, /value="17:00"/);
  assert.match(html, /9\.0h/); // H/sem de ENVASADORA 1 (uma faixa de 9h na semana)
});

test('Turnos por Máquina: editar horário de uma faixa grava direto no Firestore (sem botão Salvar)', async () => {
  const maquinas = mockColecao([{ id: 'm1', data: { nome: 'ENVASADORA 1', turnos: { 1: [{ ini: '08:00', fim: '17:00' }] } } }]);
  const { win, document } = carregarPagina({
    producao_maquinas: maquinas, producao_registros: mockColecao([]), producao_setup: mockColecao([]), producao_categorias: mockColecao([]), producao_config: mockColecao([]),
  });
  await win.renderProducaoTurnosMaquinas('pcfg-embed-host');

  const inputIni = document.querySelector('[data-ptm-ini][data-ptm-maq="m1"][data-ptm-dia="1"][data-ptm-idx="0"]');
  assert.ok(inputIni, 'input de início da faixa deveria existir');
  inputIni.value = '06:00';
  inputIni.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  const salvo = maquinas._registro.get('m1');
  assert.equal(salvo.turnos[1][0].ini, '06:00', 'Firestore deveria refletir o novo horário imediatamente');
});

test('Turnos por Máquina: +faixa adiciona um novo período editável e grava no Firestore', async () => {
  const maquinas = mockColecao([{ id: 'm1', data: { nome: 'ENVASADORA 1', turnos: { 1: [] } } }]);
  const { win, document } = carregarPagina({
    producao_maquinas: maquinas, producao_registros: mockColecao([]), producao_setup: mockColecao([]), producao_categorias: mockColecao([]), producao_config: mockColecao([]),
  });
  await win.renderProducaoTurnosMaquinas('pcfg-embed-host');

  document.querySelector('[data-ptm-add][data-ptm-maq="m1"][data-ptm-dia="1"]').click();
  await new Promise(r => setTimeout(r, 0));

  const salvo = maquinas._registro.get('m1');
  assert.equal(salvo.turnos[1].length, 1);
  assert.equal(salvo.turnos[1][0].ini, '08:00');
  assert.match(document.getElementById('pcfg-embed-host').innerHTML, /value="08:00"/);
});

test('Turnos por Máquina: atalho T1/T2/T3 substitui as faixas do dia pelo horário do atalho', async () => {
  const maquinas = mockColecao([{ id: 'm1', data: { nome: 'ENVASADORA 1', turnos: { 1: [{ ini: '08:00', fim: '17:00' }] } } }]);
  const cfg = mockColecao([{ id: 'turnos_atalhos', data: { T1: { ini: '06:00', fim: '14:00' }, T2: { ini: '14:00', fim: '22:00' }, T3: { ini: '22:00', fim: '06:00' } } }]);
  const { win, document } = carregarPagina({
    producao_maquinas: maquinas, producao_registros: mockColecao([]), producao_setup: mockColecao([]), producao_categorias: mockColecao([]), producao_config: cfg,
  });
  await win.renderProducaoTurnosMaquinas('pcfg-embed-host');

  document.querySelector('[data-ptm-atalho][data-ptm-maq="m1"][data-ptm-dia="1"][data-ptm-chave="T2"]').click();
  await new Promise(r => setTimeout(r, 0));

  const salvo = maquinas._registro.get('m1');
  assert.equal(salvo.turnos[1].length, 1);
  assert.equal(salvo.turnos[1][0].ini, '14:00');
  assert.equal(salvo.turnos[1][0].fim, '22:00');
});

test('Turnos por Máquina: "→ Todas" copia os turnos da máquina de origem pra todas as outras', async () => {
  const maquinas = mockColecao([
    { id: 'm1', data: { nome: 'ENVASADORA 1', turnos: { 1: [{ ini: '06:00', fim: '12:00' }] } } },
    { id: 'm2', data: { nome: 'EMPACOTADEIRA 1', turnos: { 1: [{ ini: '08:00', fim: '17:00' }] } } },
    { id: 'm3', data: { nome: 'ROTULADORA 1', turnos: {} } },
  ]);
  const { win, document } = carregarPagina({
    producao_maquinas: maquinas, producao_registros: mockColecao([]), producao_setup: mockColecao([]), producao_categorias: mockColecao([]), producao_config: mockColecao([]),
  });
  await win.renderProducaoTurnosMaquinas('pcfg-embed-host');

  document.querySelector('[data-ptm-copiar-linha="m1"]').click();
  await new Promise(r => setTimeout(r, 0));

  // JSON.stringify em vez de deepEqual: os objetos gravados por
  // ptmCopiarLinha nascem dentro do realm do jsdom (via win.eval), então
  // têm um Object.prototype diferente do realm deste arquivo de teste —
  // deepStrictEqual reprova por isso mesmo com conteúdo idêntico.
  assert.equal(JSON.stringify(maquinas._registro.get('m2').turnos[1]), JSON.stringify([{ ini: '06:00', fim: '12:00' }]));
  assert.equal(JSON.stringify(maquinas._registro.get('m3').turnos[1]), JSON.stringify([{ ini: '06:00', fim: '12:00' }]));
  assert.equal(JSON.stringify(maquinas._registro.get('m1').turnos[1]), JSON.stringify([{ ini: '06:00', fim: '12:00' }]), 'origem não deveria mudar');
});
