// PEDIDO AO VIVO: "quando é colocar abrir por produto, [precisa] mapear o
// produto por lá também colocando qual é o tipo dele pra, aí eu vou saber
// detalhar bem" — a tela Acompanhamento → Por Produto já tinha uma coluna
// Tipo; o que faltava era o usuário conseguir AUDITAR de onde veio aquele
// tipo quando desconfiar de uma classificação errada. Clicar na linha agora
// abre um detalhe com o motivo (flag da Bluesoft usada, texto livre de
// fallback, ou dedução pelo "Local de estoque" quando o endereço está vazio).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const codigo = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '50-inventario-classificacoes-v275.js'), 'utf8');

// O módulo abre um setInterval(...,500) no topo (poll de contexto de
// importação) que fica rodando de verdade no relógio do processo — sem
// fechar a janela jsdom no fim de cada teste, esse timer nunca é limpo e
// `node --test` fica pendurado depois de todos os testes já terem passado.
function novoAmbiente(t, inv) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="page-acompanhamento"><div class="sec-header"></div><div id="acomp-produtos-v275"></div></div>
    <div id="modal-inv"><div class="modal-footer"></div></div>
  </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.AnalistaStore = { getState: () => ({ inventarios: [inv], contagens: [], ui: { acompanhamentoInventarioId: inv.id } }) };
  win.DTProdutos = { buscarSync: () => ({ encontrado: false }) };
  win.eval(codigo);
  t.after(() => win.close());
  return win;
}

test('Acompanhamento por Produto: a coluna Tipo mostra o tipo classificado de cada produto', (t) => {
  const inv = { id: 'inv1', status: 'ATIVO', base: [
    { codigo_produto: 'P1', descricao_produto: 'Farinha', tipo_produto: 'MATERIA PRIMA', tipo_produto_motivo: 'Flag da Bluesoft: materiaPrima', total_unidades_sistema: 10 },
    { codigo_produto: 'P2', descricao_produto: 'Caixa', tipo_produto: 'EMBALAGEM', tipo_produto_motivo: 'Flag da Bluesoft: embalagem', total_unidades_sistema: 5 },
  ] };
  const win = novoAmbiente(t, inv);
  win.DTV275.renderProductView();
  const html = win.document.getElementById('acomp-prod-tbody-v275').innerHTML;
  assert.match(html, /MATERIA PRIMA/);
  assert.match(html, /EMBALAGEM/);
});

test('clicar numa linha do produto abre o modal de detalhe mostrando o motivo real da classificação', (t) => {
  const inv = { id: 'inv1', status: 'ATIVO', base: [
    { codigo_produto: 'P1', descricao_produto: 'Farinha', tipo_produto: 'MATERIA PRIMA', tipo_produto_motivo: 'Flag da Bluesoft: materiaPrima', total_unidades_sistema: 10 },
  ] };
  const win = novoAmbiente(t, inv);
  win.DTV275.renderProductView();
  const tr = win.document.querySelector('#acomp-prod-tbody-v275 tr[data-tipo-codigo="P1"]');
  assert.ok(tr, 'linha do produto precisa existir e ser clicável');
  tr.click();
  const modal = win.document.getElementById('v275-tipo-modal');
  assert.ok(modal, 'modal de detalhe precisa abrir ao clicar na linha');
  assert.match(modal.textContent, /MATERIA PRIMA/);
  assert.match(modal.textContent, /Flag da Bluesoft: materiaPrima/, 'precisa mostrar o motivo real, não só o tipo já visível na tabela');
  win.document.querySelector('#v275-tipo-modal [data-close]').click();
  assert.equal(win.document.getElementById('v275-tipo-modal'), null, 'fechar precisa remover o modal');
});

test('endereço vazio classificado pelo "Local de estoque" mostra esse motivo no detalhe (não um genérico "sem produto")', (t) => {
  const inv = { id: 'inv1', status: 'ATIVO', base: [
    { codigo_produto: 'P9', endereco: '14.1.1.1', descricao_produto: 'Refrigerante', tipo_produto: 'PRODUTO ACABADO', tipo_produto_motivo: 'Endereço vazio agora — tipo deduzido do "Local de estoque": PRODUTO ACABADO', total_unidades_sistema: 0 },
  ] };
  const win = novoAmbiente(t, inv);
  win.DTV275.renderProductView();
  const tr = win.document.querySelector('#acomp-prod-tbody-v275 tr[data-tipo-codigo="P9"]');
  tr.click();
  const modal = win.document.getElementById('v275-tipo-modal');
  assert.match(modal.textContent, /Local de estoque.*PRODUTO ACABADO/);
});
