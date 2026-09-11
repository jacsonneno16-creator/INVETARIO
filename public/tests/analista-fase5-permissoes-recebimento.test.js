'use strict';
/**
 * FASE 5 — as telas de Recebimento (92/93/94/95) usam clique delegado
 * (data-recop-*, data-rebt-*, data-recmot-*, data-recveic-*, data-recdoca-*,
 * data-recag-*, data-recist-*) em vez de onclick inline, porque as linhas
 * são geradas dinamicamente (mesmo motivo documentado em vários outros
 * pontos do Coletor/Analista: onclick inline não "pega" em HTML injetado
 * depois do primeiro carregamento). O heurístico antigo de
 * aplicarPermissoesAnalista() só varria [onclick]/[onchange], então nenhum
 * botão de ação do Recebimento era escondido por permissão fina — a regra
 * do Firestore sempre barrou a escrita, mas o botão continuava visível e
 * clicável, resultando num erro de permissão em vez de o botão simplesmente
 * não aparecer. Este teste usa jsdom (mesmo padrão de sanitizacao.test.js)
 * porque depende de querySelectorAll/closest/hasAttribute reais.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const codigoPermissoes = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '37-usuarios-permissoes.js'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8');

function novoAmbiente(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'outside-only' });
  dom.window.eval(codigoPermissoes);
  return dom.window;
}

test('REGRESSÃO: aplicarPermissoesAnalista() nunca navega sozinho — só irParaPrimeiraPaginaPermitida() faz isso, e só deve ser chamada uma vez, no login', () => {
  // Bug relatado ao vivo: ao dar uma permissão pra um operador na tela de
  // Usuários (que não é uma `.page` do sistema de navegação normal), o app
  // pulava sozinho pra primeira aba liberada — porque
  // aplicarPermissoesAnalista() (que agora roda a toda hora: a cada
  // mutação no DOM via MutationObserver, a cada redraw do Recebimento)
  // tinha essa navegação embutida no final. Extraída pra uma função à
  // parte, chamada só uma vez, logo após o login.
  const win = novoAmbiente(`<div class="page" id="page-recebimento-operacao"></div>`); // nenhuma .page tem classe "on" — simula a tela de Usuários, fora do sistema de páginas
  win.DT_USUARIO_ACESSO_ATUAL = { permissoes: { 'recebimento-operacao': { visualizar: true } } };
  const chamadas = [];
  win.goPage = id => chamadas.push(id);

  win.aplicarPermissoesAnalista();
  assert.deepEqual(chamadas, []); // não deve ter navegado sozinho

  win.irParaPrimeiraPaginaPermitida();
  assert.deepEqual(chamadas, ['recebimento-operacao']); // essa função sim decide a tela inicial
});

test('recebimento-operacao: esconde só os botões cuja ação real não está liberada (criar liberado, cancelar não)', () => {
  const win = novoAmbiente(`
    <div class="page on" id="page-recebimento-operacao">
      <button data-recop-novo="1">+ Novo Recebimento</button>
      <button data-recop-cancelar="r1">Cancelar</button>
      <button data-recop-finalizar="r1">Finalizar</button>
      <button data-recop-iniciar-descarga="r1">Iniciar descarga</button>
      <button data-recop-pg="-1">Anterior</button>
    </div>`);
  win.DT_USUARIO_ACESSO_ATUAL = {
    permissoes: { 'recebimento-operacao': { visualizar: true, criar: true, editar: true, cancelar: false, finalizar: false } },
  };
  win.aplicarPermissoesAnalista();

  assert.notEqual(win.document.querySelector('[data-recop-novo]').style.display, 'none');
  assert.notEqual(win.document.querySelector('[data-recop-iniciar-descarga]').style.display, 'none');
  assert.equal(win.document.querySelector('[data-recop-cancelar]').style.display, 'none');
  assert.equal(win.document.querySelector('[data-recop-finalizar]').style.display, 'none');
  assert.notEqual(win.document.querySelector('[data-recop-pg]').style.display, 'none'); // paginação não é ação, sempre visível
});

test('recebimento-transbordo: qr-teste exige gerar-qrcode, cancelar exige cancelar — cada um checado separado', () => {
  const win = novoAmbiente(`
    <div class="page on" id="page-recebimento-transbordo">
      <button data-rebt-novo="1">+ Novo Transbordo</button>
      <button data-rebt-qr-teste="1">Gerar QR de teste</button>
      <button data-rebt-cancelar="t1">Cancelar</button>
    </div>`);
  win.DT_USUARIO_ACESSO_ATUAL = {
    permissoes: { 'recebimento-transbordo': { visualizar: true, criar: true, cancelar: true, 'gerar-qrcode': false } },
  };
  win.aplicarPermissoesAnalista();

  assert.notEqual(win.document.querySelector('[data-rebt-novo]').style.display, 'none');
  assert.notEqual(win.document.querySelector('[data-rebt-cancelar]').style.display, 'none');
  assert.equal(win.document.querySelector('[data-rebt-qr-teste]').style.display, 'none');
});

test('recebimento-transbordo: excluir (apagar de verdade) é ação própria, separada de cancelar', () => {
  const win = novoAmbiente(`
    <div class="page on" id="page-recebimento-transbordo">
      <button data-rebt-cancelar="t1">Cancelar</button>
      <button data-rebt-excluir="t1">Excluir</button>
      <button data-rebt-excluir-todos="1">Apagar todos</button>
    </div>`);
  win.DT_USUARIO_ACESSO_ATUAL = {
    permissoes: { 'recebimento-transbordo': { visualizar: true, cancelar: true, excluir: false } },
  };
  win.aplicarPermissoesAnalista();

  assert.notEqual(win.document.querySelector('[data-rebt-cancelar]').style.display, 'none');
  assert.equal(win.document.querySelector('[data-rebt-excluir]').style.display, 'none');
  assert.equal(win.document.querySelector('[data-rebt-excluir-todos]').style.display, 'none');
});

test('recebimento-config: motorista/veículo/doca são todos gatilhados pela mesma ação "editar" (é o que a regra de fato exige)', () => {
  const html = `
    <div class="page on" id="page-recebimento-config">
      <button data-recmot-novo="1">+ Motorista</button>
      <button data-recveic-excluir="v1">Excluir veículo</button>
      <button data-recdoca-editar="d1">Editar doca</button>
    </div>`;

  const semEditar = novoAmbiente(html);
  semEditar.DT_USUARIO_ACESSO_ATUAL = { permissoes: { 'recebimento-config': { visualizar: true, editar: false } } };
  semEditar.aplicarPermissoesAnalista();
  assert.equal(semEditar.document.querySelector('[data-recmot-novo]').style.display, 'none');
  assert.equal(semEditar.document.querySelector('[data-recveic-excluir]').style.display, 'none');
  assert.equal(semEditar.document.querySelector('[data-recdoca-editar]').style.display, 'none');

  // DOM novo (mesmo padrão do app real: cada redraw substitui o innerHTML e
  // roda aplicarPermissoesAnalista() de novo sobre elementos frescos)
  const comEditar = novoAmbiente(html);
  comEditar.DT_USUARIO_ACESSO_ATUAL = { permissoes: { 'recebimento-config': { visualizar: true, editar: true } } };
  comEditar.aplicarPermissoesAnalista();
  assert.notEqual(comEditar.document.querySelector('[data-recmot-novo]').style.display, 'none');
  assert.notEqual(comEditar.document.querySelector('[data-recveic-excluir]').style.display, 'none');
});

test('recebimento-agendamentos: excluir é uma ação própria, independente de criar/editar', () => {
  const win = novoAmbiente(`
    <div class="page on" id="page-recebimento-agendamentos">
      <button data-recag-novo="1">+ Novo</button>
      <button data-recag-editar="a1">Editar</button>
      <button data-recag-excluir="a1">Excluir</button>
    </div>`);
  win.DT_USUARIO_ACESSO_ATUAL = { permissoes: { 'recebimento-agendamentos': { visualizar: true, criar: true, editar: true, excluir: false } } };
  win.aplicarPermissoesAnalista();

  assert.notEqual(win.document.querySelector('[data-recag-novo]').style.display, 'none');
  assert.notEqual(win.document.querySelector('[data-recag-editar]').style.display, 'none');
  assert.equal(win.document.querySelector('[data-recag-excluir]').style.display, 'none');
});

test('admin_mestre nunca tem nada escondido, mesmo sem entradas de permissao explicitas', () => {
  const win = novoAmbiente(`
    <div class="page on" id="page-recebimento-operacao">
      <button data-recop-cancelar="r1">Cancelar</button>
    </div>`);
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true, permissoes: {} };
  win.aplicarPermissoesAnalista();
  assert.notEqual(win.document.querySelector('[data-recop-cancelar]').style.display, 'none');
});

test('conta legada sem campo permissoes: aplicarPermissoesAnalista não mexe em nada (compatibilidade retroativa)', () => {
  const win = novoAmbiente(`
    <div class="page on" id="page-recebimento-operacao">
      <button data-recop-cancelar="r1">Cancelar</button>
    </div>`);
  win.DT_USUARIO_ACESSO_ATUAL = { email: 'antigo@daterrinha.com' }; // sem .permissoes
  win.aplicarPermissoesAnalista();
  assert.notEqual(win.document.querySelector('[data-recop-cancelar]').style.display, 'none');
});

// BUG AO VIVO REAL (2026-09-11): "busca rápido, mas pra mostrar tá
// demorando" — o scan de RECEBIMENTO_SELETOR (data-recusa-*, data-recop-*
// etc.) ficou de fora da correção de escopo de 2026-09-03 (que já limitou
// o scan de [onclick]/[onchange] só à página ATIVA) e continuava varrendo
// `document` inteiro — inclusive páginas de Recebimento já visitadas e
// escondidas (ficam no DOM pra sempre, só com CSS escondendo). Rodava a
// cada mutação em QUALQUER lugar do app (MutationObserver em
// document.body), então quanto mais telas visitadas na sessão, mais lento
// esse passo ficava — mesmo pra telas sem nenhuma relação (ex.: Pátio em
// Tempo Real). Corrigido pra também respeitar `escopo` (só a página
// .page.on) — uma página escondida não é escaneada de novo.
test('BUG AO VIVO REAL: o scan de data-recusa-*/data-recop-* etc. só varre a página ATIVA — página escondida (já visitada antes) não é rechecada a cada mutação', () => {
  const win = novoAmbiente(`
    <div class="page on" id="page-recebimento-recusas">
      <select data-recusa-tratamento="ativa"></select>
    </div>
    <div class="page" id="page-recebimento-notas">
      <select data-recusa-tratamento="escondida"></select>
    </div>`);
  win.DT_USUARIO_ACESSO_ATUAL = {
    permissoes: {
      'recebimento-recusas': { visualizar: true, editar: false },
      'recebimento-notas': { visualizar: true, editar: false },
    },
  };
  win.aplicarPermissoesAnalista();
  assert.equal(win.document.querySelector('[data-recusa-tratamento="ativa"]').style.display, 'none', 'botão da página ATIVA continua sendo escondido normalmente, sem permissão de editar');
  assert.notEqual(win.document.querySelector('[data-recusa-tratamento="escondida"]').style.display, 'none', 'página escondida (já visitada antes, fora da tela agora) não é escaneada de novo — ninguém interage com ela mesmo, era custo puro sem função nenhuma');
});

test('firestore.rules: recebimento_agendamentos aceita excluir como alternativa própria de escrita (antes só criar/editar valiam)', () => {
  const trecho = rules.slice(rules.indexOf('match /recebimento_agendamentos/'));
  assert.match(trecho.slice(0, 400), /hasPermission\('recebimento-agendamentos', 'excluir'\)/);
});

test('redraws do Recebimento religam aplicarPermissoesAnalista() após cada innerHTML (HTML gerado depois do login também fica coberto)', () => {
  const base = path.join(__dirname, '..', 'js', 'analista');
  for (const arq of ['92-recebimento-config.js', '93-recebimento-operacao.js', '94-recebimento-relatorios.js', '95-recebimento-transbordo.js']) {
    const codigo = fs.readFileSync(path.join(base, arq), 'utf8');
    assert.match(codigo, /global\.aplicarPermissoesAnalista\?\.\(\)/, arq + ' deveria rechecar permissões após redesenhar');
  }
});
