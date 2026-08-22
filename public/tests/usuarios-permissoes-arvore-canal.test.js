'use strict';
/**
 * Reforma da tela de Usuários e Permissões — árvore Canal → Setor → Módulo →
 * Ação substituindo os cards soltos. Canal é o seletor "Onde este login pode
 * entrar" (data-canal, já existia) — filtra ao vivo quais setor/módulo
 * aparecem na árvore, sem esconder o painel inteiro (hack antigo removido).
 * A classificação de `canais` por módulo não é suposição: é auditoria real
 * contra firestore.rules (só recebimento-operacao/recebimento-transbordo têm
 * a permissão fina checada por uma variante Coletor-aware das regras — o
 * resto que o Coletor toca, como contagens, é liberado por canal sozinho,
 * incondicional, então a permissão fina não controla nada de verdade lá).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const codigoPermissoes = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '37-usuarios-permissoes.js'), 'utf8');

function htmlFormularioCriar() {
  return `
    <input id="op-nome"><input id="op-senha"><input id="op-username" readonly><div id="op-logins-preview"></div>
    <label><input type="radio" name="op-tipo" value="analista"></label>
    <label><input type="radio" name="op-tipo" value="operador" checked></label>
    <div id="op-canais-criar"></div>
    <div id="op-setores-criar"></div>
    <div id="op-permissoes-criar"></div>
    <label><input type="radio" name="op-lojas-criar-modo" value="todas" checked></label>
    <label><input type="radio" name="op-lojas-criar-modo" value="selecionadas"></label>
    <div id="op-lojas-criar-box" style="display:none"></div>
    <div id="op-lojas-criar-lista"></div>
    <div id="op-modal-criar-bg" style="display:none"></div>`;
}

function novoAmbiente(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'outside-only' });
  dom.window.eval(codigoPermissoes);
  return dom.window;
}
const flush = () => new Promise(r => setTimeout(r, 0));

async function abrirCriar(win) {
  win.DTLoja = { garantirLojaInicial: async () => [{ id: 'loja_matriz', nome: 'Matriz' }], listar: async () => [{ id: 'loja_matriz', nome: 'Matriz' }] };
  win.opAbrirModalCriar();
  await flush(); await flush(); await flush();
}
function marcarCanal(win, prefix, canal, valor) {
  const chk = win.document.querySelector(`#op-canais-${prefix} [data-canal="${canal}"]`);
  chk.checked = valor;
  chk.dispatchEvent(new win.Event('change', { bubbles: true }));
}
function modulosVisiveis(win, prefix) {
  return [...win.document.querySelectorAll(`#op-permissoes-${prefix} [data-modulo-all]`)]
    .filter(chk => chk.closest('.perm-modulo').style.display !== 'none')
    .map(chk => chk.getAttribute('data-modulo-all'));
}

test('árvore de permissões: só canal Coletor marcado — mostra SOMENTE recebimento-operacao/recebimento-transbordo, nada exclusivo do Analista', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);
  marcarCanal(win, 'criar', 'coletor', true);
  marcarCanal(win, 'criar', 'analista', false);

  const visiveis = modulosVisiveis(win, 'criar');
  assert.ok(visiveis.includes('recebimento-operacao'));
  assert.ok(visiveis.includes('recebimento-transbordo'));
  // Nada exclusivo do Analista pode aparecer — nem módulos de outros
  // setores (Produção/PCP/Compras são 100% analista-only hoje), nem outros
  // módulos de Logística (dashboard, inventarios, auditoria...).
  assert.ok(!visiveis.includes('dashboard'));
  assert.ok(!visiveis.includes('inventarios'));
  assert.ok(!visiveis.includes('auditoria'));
  assert.ok(!visiveis.includes('producao-dashboard'));
  assert.ok(!visiveis.includes('pcp-central'));
  assert.ok(!visiveis.includes('compras-central'));
  assert.ok(!visiveis.includes('recebimento-notas')); // recebimento-* fora das duas exceções continua analista-only

  // Setores inteiros sem NENHUM módulo compatível (Produção/PCP/Compras)
  // ficam escondidos também, não só os módulos individuais.
  ['producao', 'pcp', 'compras'].forEach(setorId => {
    const setorEl = win.document.querySelector(`[data-perm-setor="${setorId}"]`);
    assert.equal(setorEl.style.display, 'none', 'setor ' + setorId + ' deveria estar escondido pro canal só-Coletor');
  });
});

test('árvore de permissões: Coletor + Analista marcados — mostra a união (tudo)', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);
  marcarCanal(win, 'criar', 'coletor', true);
  marcarCanal(win, 'criar', 'analista', true);

  const visiveis = modulosVisiveis(win, 'criar');
  assert.ok(visiveis.includes('recebimento-transbordo'));
  assert.ok(visiveis.includes('dashboard'));
  assert.ok(visiveis.includes('producao-dashboard'));
  assert.ok(visiveis.includes('pcp-central'));
});

test('árvore de permissões: só canal Analista marcado — mostra tudo (todo módulo tem pelo menos canal analista)', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);
  marcarCanal(win, 'criar', 'coletor', false);
  marcarCanal(win, 'criar', 'analista', true);

  const visiveis = modulosVisiveis(win, 'criar');
  assert.ok(visiveis.includes('recebimento-transbordo')); // analista também usa este módulo
  assert.ok(visiveis.includes('dashboard'));
  assert.ok(visiveis.includes('producao-dashboard'));
});

test('árvore de permissões: sem NENHUM canal marcado, nenhum módulo aparece — painel continua visível (não é mais o hack antigo de esconder tudo)', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);
  marcarCanal(win, 'criar', 'coletor', false);
  // 'operador' já vem com coletor:true por padrão em opAbrirModalCriar — desmarca os dois de propósito.
  marcarCanal(win, 'criar', 'analista', false);

  const visiveis = modulosVisiveis(win, 'criar');
  assert.deepEqual(visiveis, []);
  assert.notEqual(win.document.getElementById('op-permissoes-criar').style.display, 'none');
});

test('busca de texto combina com o filtro de canal — resultado é a intersecção dos dois, nunca um sobrescreve o outro', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);
  marcarCanal(win, 'criar', 'coletor', true);
  marcarCanal(win, 'criar', 'analista', false);

  win.opFiltrarPermissoes('criar', 'transbordo');
  let visiveis = modulosVisiveis(win, 'criar');
  assert.deepEqual(visiveis, ['recebimento-transbordo']); // bate a busca E é compatível com Coletor

  win.opFiltrarPermissoes('criar', 'dashboard');
  visiveis = modulosVisiveis(win, 'criar');
  assert.deepEqual(visiveis, []); // "dashboard" bate a busca, mas não é compatível com Coletor — nenhum resultado
});

test('expandir/recolher: módulo começa recolhido (sem .is-aberto) e alterna ao clicar no cabeçalho; setor começa expandido e recolhe ao clicar', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);
  marcarCanal(win, 'criar', 'coletor', true);

  const moduloEl = win.document.querySelector('[data-modulo-all="recebimento-transbordo"]').closest('.perm-modulo');
  assert.ok(!moduloEl.classList.contains('is-aberto'));
  moduloEl.querySelector('[data-perm-toggle-modulo]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(moduloEl.classList.contains('is-aberto'));
  moduloEl.querySelector('[data-perm-toggle-modulo]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(!moduloEl.classList.contains('is-aberto'));

  const setorEl = win.document.querySelector('[data-perm-setor="logistica"]');
  assert.ok(!setorEl.classList.contains('is-recolhido'));
  setorEl.querySelector('[data-perm-toggle-setor]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(setorEl.classList.contains('is-recolhido'));
});

function permissaoAtual(win, prefix, moduloId, acao) {
  const chk = win.document.querySelector(`#op-permissoes-${prefix} [data-modulo="${moduloId}"][data-acao="${acao}"]`);
  return !!chk?.checked;
}

test('preset "Operador de Coletor · Recebimento": marca só editar/criar/corrigir-horario/gerar-qrcode nos 2 módulos de recebimento — nunca cancelar/finalizar (ações administrativas)', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);

  win.opAplicarPreset('criar', 'coletor-recebimento');

  assert.equal(permissaoAtual(win, 'criar', 'recebimento-transbordo', 'editar'), true);
  assert.equal(permissaoAtual(win, 'criar', 'recebimento-transbordo', 'criar'), true);
  assert.equal(permissaoAtual(win, 'criar', 'recebimento-transbordo', 'corrigir-horario'), true);
  assert.equal(permissaoAtual(win, 'criar', 'recebimento-operacao', 'editar'), true);
  // Ações administrativas continuam de fora — pedido explícito: "não
  // liberar telas administrativas".
  assert.equal(permissaoAtual(win, 'criar', 'recebimento-transbordo', 'cancelar'), false);
  assert.equal(permissaoAtual(win, 'criar', 'recebimento-transbordo', 'finalizar'), false);
  // Nada fora de recebimento-operacao/recebimento-transbordo é marcado.
  assert.equal(permissaoAtual(win, 'criar', 'dashboard', 'visualizar'), false);
});

test('preset é um PONTO DE PARTIDA, não uma trava — aplicar de novo limpa o estado anterior (previsível), e o admin ainda consegue desmarcar/marcar manualmente depois', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);

  // Estado anterior "sujo": uma permissão fora do preset já marcada à mão.
  const chkDashboard = win.document.querySelector('#op-permissoes-criar [data-modulo="dashboard"][data-acao="visualizar"]');
  chkDashboard.checked = true;

  win.opAplicarPreset('criar', 'coletor-recebimento');
  assert.equal(permissaoAtual(win, 'criar', 'dashboard', 'visualizar'), false); // preset limpou o que não faz parte dele
  assert.equal(permissaoAtual(win, 'criar', 'recebimento-transbordo', 'editar'), true);

  // Ajuste manual depois de aplicar o preset continua livre.
  const chkCancelar = win.document.querySelector('#op-permissoes-criar [data-modulo="recebimento-transbordo"][data-acao="cancelar"]');
  chkCancelar.checked = true;
  assert.equal(permissaoAtual(win, 'criar', 'recebimento-transbordo', 'cancelar'), true);
});

test('preset "PCP" libera acesso completo só ao módulo pcp-central', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);
  win.opAplicarPreset('criar', 'pcp');
  assert.equal(permissaoAtual(win, 'criar', 'pcp-central', 'visualizar'), true);
  assert.equal(permissaoAtual(win, 'criar', 'pcp-central', 'configurar'), true);
  assert.equal(permissaoAtual(win, 'criar', 'compras-central', 'visualizar'), false);
});

test('preset "Administrador" marca literalmente tudo', async () => {
  const win = novoAmbiente(htmlFormularioCriar());
  await abrirCriar(win);
  win.opAplicarPreset('criar', 'administrador');
  const total = win.DT_MODULOS_PERMISSOES.reduce((a, m) => a + m.acoes.length, 0);
  const marcados = [...win.document.querySelectorAll('#op-permissoes-criar [data-modulo]')].filter(c => c.checked).length;
  assert.equal(marcados, total);
});
