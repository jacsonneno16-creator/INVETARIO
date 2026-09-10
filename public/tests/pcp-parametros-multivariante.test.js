// PCP > Parâmetros — 2 correções ao vivo (2026-09-06):
//
// 1) "muda a cobertura de estoque, salva, mas quando mostra 'salvou' ele
// volta pro valor antigo" — um produto pode ter MAIS de 1 documento em
// producao_produtos NA MESMA LOJA (1 por máquina compatível, mesmo cod —
// convenção já usada pela Ficha Técnica). A tela mostrava cada variante
// como linha separada e editava só a PRIMEIRA encontrada por cod; a
// variante nunca tocada continuava com o valor antigo, e como as duas
// linhas mostravam o "mesmo" produto, parecia que o valor tinha revertido.
//
// 2) "coloca um filtro por loja" — antes só lia a loja ATIVA do navegador
// (fs(), proxy loja-scoped); um produto cadastrado só na Matriz nunca
// aparecia se a loja ativa fosse outra. Agora consolida TODAS as lojas
// (mesmo padrão de recebimento-paletes-monitoramento.js) com um filtro
// opcional — e como o MESMO cod pode ser um produto diferente em cada
// loja, o agrupamento de variantes/edição nunca cruza de uma loja pra
// outra.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../js/analista/81-pcp-parametros.js'), 'utf8');

function mockColecaoSimples(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: id => ({
      get: async () => { const data = registro.get(id); return { exists: data !== undefined, data: () => data }; },
      set: async (payload) => { const a = registro.get(id) || {}; registro.set(id, { ...a, ...payload }); },
    }),
    _registro: registro,
  };
}

// lojas: [{id,nome}]; produtosPorLoja: {lojaId: [{id,data}]}
function mockRawFirestore(lojas, produtosPorLoja) {
  const colLojas = mockColecaoSimples(lojas.map(l => ({ id: l.id, data: l })));
  const subProdutos = {};
  Object.keys(produtosPorLoja || {}).forEach(lojaId => { subProdutos[lojaId] = mockColecaoSimples(produtosPorLoja[lojaId]); });
  return {
    collection: nome => {
      if (nome !== 'lojas') return mockColecaoSimples([]);
      return {
        get: colLojas.get,
        doc: lojaId => ({ collection: () => subProdutos[lojaId] || mockColecaoSimples([]) }),
      };
    },
  };
}

function carregarPagina(lojas, produtosPorLoja) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-parametros"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTRawFirestore = () => mockRawFirestore(lojas, produtosPorLoja);
  win.getDTFirestore = () => ({ collection: () => mockColecaoSimples([]) }); // pcp_configuracoes, não usado nestes testes
  win.temPermissao = () => true;
  win.registrarAuditoria = async () => {};
  win.showToast = () => {};
  win.eval(code);
  return { win, document: win.document };
}

const LOJAS = [{ id: 'matriz', nome: 'Matriz' }, { id: 'filial', nome: 'Filial' }];

const PRODUTO_2_VARIANTES_MATRIZ = [
  { id: 'docA', data: { cod: '8445', nome: '00003 TAPIOCA DA TERRINHA NA MEDIDA 360 G CX 15', maquina: 'SELGRON 01', pc_min: 7.65, metaCoberturaDias: 10 } },
  { id: 'docB', data: { cod: '8445', nome: '00003 TAPIOCA DA TERRINHA NA MEDIDA 360 G CX 15', maquina: 'SELGRON 02', pc_min: 7.2, metaCoberturaDias: 10 } },
];

test('_linhas(): produto com 2 variantes de máquina (mesmo cod, mesma loja) aparece só 1 vez na lista, não duplicado', async () => {
  const { win } = carregarPagina(LOJAS, { matriz: PRODUTO_2_VARIANTES_MATRIZ });
  await win.renderPCPParametros();
  const linhas = win.document.querySelectorAll('#page-pcp-parametros tbody tr');
  const linhasComCod8445 = [...linhas].filter(tr => tr.textContent.includes('8445'));
  assert.equal(linhasComCod8445.length, 1, 'produto com 2 variantes de máquina não pode aparecer 2x na tabela');
});

test('CORREÇÃO ESTRUTURAL: editar e salvar um produto com 2 variantes grava em AMBAS — reabrir não mostra o valor antigo', async () => {
  const { win } = carregarPagina(LOJAS, { matriz: PRODUTO_2_VARIANTES_MATRIZ });
  await win.renderPCPParametros();

  win.pcppEditar('matriz', '8445');
  win.document.getElementById('pcpp-cobertura').value = '25';
  await win.pcppSalvarIndividual();

  win.pcppEditar('matriz', '8445');
  assert.equal(win.document.getElementById('pcpp-cobertura').value, '25', 'reabrir tem que mostrar 25 nas DUAS variantes, nunca reverter');
});

test('pcppSalvarMassa: aplica o mesmo valor a TODAS as variantes de um produto selecionado', async () => {
  const { win, document } = carregarPagina(LOJAS, { matriz: PRODUTO_2_VARIANTES_MATRIZ });
  await win.renderPCPParametros();

  const check = document.querySelector('.pcpp-check[value="8445"]');
  check.checked = true;
  check.dispatchEvent(new win.Event('change', { bubbles: true }));

  const btnMassa = document.querySelector('[data-pcpp-massa]');
  btnMassa.dispatchEvent(new win.Event('click', { bubbles: true }));
  document.getElementById('pcpp-massa-valor').value = '30';
  await win.pcppSalvarMassa();

  win.pcppEditar('matriz', '8445');
  assert.equal(document.getElementById('pcpp-cobertura').value, '30');
});

test('produto SEM variante duplicada (cod único) continua funcionando normalmente', async () => {
  const { win, document } = carregarPagina(LOJAS, { matriz: [{ id: 'doc1', data: { cod: '999', nome: 'Produto Único', maquina: 'X', metaCoberturaDias: 5 } }] });
  await win.renderPCPParametros();
  win.pcppEditar('matriz', '999');
  document.getElementById('pcpp-cobertura').value = '12';
  await win.pcppSalvarIndividual();
  win.pcppEditar('matriz', '999');
  assert.equal(document.getElementById('pcpp-cobertura').value, '12');
});

// ── Filtro por loja (pedido ao vivo 2026-09-06) ──────────────────────────
test('carregarPCPParametros: consolida TODAS as lojas ativas, sem depender de qual loja está selecionada no navegador', async () => {
  const { win } = carregarPagina(LOJAS, {
    matriz: [{ id: 'm1', data: { cod: '111', nome: 'Produto da Matriz' } }],
    filial: [{ id: 'f1', data: { cod: '222', nome: 'Produto da Filial' } }],
  });
  await win.renderPCPParametros();
  const html = win.document.getElementById('page-pcp-parametros').innerHTML;
  assert.match(html, /Produto da Matriz/);
  assert.match(html, /Produto da Filial/);
});

test('loja inativa (ativa:false) não entra na consolidação', async () => {
  const lojas = [{ id: 'matriz', nome: 'Matriz' }, { id: 'fechada', nome: 'Loja Fechada', ativa: false }];
  const { win } = carregarPagina(lojas, {
    matriz: [{ id: 'm1', data: { cod: '111', nome: 'Produto da Matriz' } }],
    fechada: [{ id: 'x1', data: { cod: '333', nome: 'Produto da Loja Fechada' } }],
  });
  await win.renderPCPParametros();
  const html = win.document.getElementById('page-pcp-parametros').innerHTML;
  assert.match(html, /Produto da Matriz/);
  assert.doesNotMatch(html, /Produto da Loja Fechada/);
});

test('filtro de loja: escolher uma loja específica esconde os produtos das outras', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    matriz: [{ id: 'm1', data: { cod: '111', nome: 'Produto da Matriz' } }],
    filial: [{ id: 'f1', data: { cod: '222', nome: 'Produto da Filial' } }],
  });
  await win.renderPCPParametros();
  document.getElementById('pcpp-f-loja').value = 'matriz';
  document.getElementById('pcpp-f-loja').dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-pcp-parametros').innerHTML;
  assert.match(html, /Produto da Matriz/);
  assert.doesNotMatch(html, /Produto da Filial/);
});

test('CORREÇÃO ESTRUTURAL: o MESMO cod em lojas diferentes é tratado como produto separado — editar um NUNCA toca no outro', async () => {
  const { win } = carregarPagina(LOJAS, {
    matriz: [{ id: 'm1', data: { cod: '8445', nome: 'Tapioca (Matriz)', metaCoberturaDias: 10 } }],
    filial: [{ id: 'f1', data: { cod: '8445', nome: 'Tapioca (Filial)', metaCoberturaDias: 20 } }],
  });
  await win.renderPCPParametros();

  win.pcppEditar('matriz', '8445');
  win.document.getElementById('pcpp-cobertura').value = '99';
  await win.pcppSalvarIndividual();

  win.pcppEditar('filial', '8445');
  assert.equal(win.document.getElementById('pcpp-cobertura').value, '20', 'editar o cod 8445 da Matriz não pode mudar o cod 8445 da Filial');
});
