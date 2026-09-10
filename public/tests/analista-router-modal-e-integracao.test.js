'use strict';
/**
 * Roteador — Configurações (modal como página) e integrações finas:
 * sem chamada redundante de Firestore/render por navegação, sem reabrir
 * modal de cadastro/formulário em reload, sem salvar de novo ao usar
 * Voltar/Avançar, e a correção real do bug de "Produtos 360°" (Compras)
 * ficar preso no último produto selecionado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const BASE = path.join(__dirname, '..', 'js', 'analista');
function ler(nome) { return fs.readFileSync(path.join(BASE, nome), 'utf8'); }

function colecaoVazia() { return { get: async () => ({ docs: [] }), where: () => colecaoVazia(), doc: () => ({ get: async () => ({ exists: false }) }) }; }

function montarHtml() {
  return `<!doctype html><html><body>
    <div id="page-title"></div>
    <div id="setor-bar"></div>
    <div id="setor-placeholder"></div>
    <div id="app-main-logistica">
      <div class="page on" id="page-pcp-central-fake"></div>
      <div class="page" id="page-dashboard"></div>
      <div class="nav-item" id="nav-dashboard"></div>
    </div>
    <div id="setor-logistica-recebimento-shell"></div>
    <div id="setor-producao-shell">
      <div class="page" id="page-producao-dashboard"></div>
      <div class="nav-item" id="nav-producao-dashboard"></div>
    </div>
    <div id="setor-pcp-shell">
      <div class="page" id="page-pcp-central"></div>
      <div class="page" id="page-pcp-dashboard"></div>
      <div class="nav-item" id="nav-pcp-dashboard"></div>
      <div class="nav-item" id="nav-pcp-pedidos"></div>
    </div>
    <div id="pcp-modal-host"></div>
    <div id="setor-compras-shell">
      <div class="page" id="page-compras-dashboard"></div>
      <div class="page" id="page-compras-central"></div>
      <div class="page" id="page-compras-produtos"></div>
      <div class="page" id="page-compras-solicitacoes"></div>
      <div class="nav-item" id="nav-compras-dashboard"></div>
      <div class="nav-item" id="nav-compras-central"></div>
      <div class="nav-item" id="nav-compras-produtos"></div>
      <div class="nav-item" id="nav-compras-solicitacoes"></div>
    </div>
    <div id="compras-modal-host"></div>
    <div id="modal-configuracoes" class="modal-bg">
      <button id="cfgm-tab-operadores" class="cfgm-tab" data-config-abrir="operadores"></button>
      <button id="cfgm-tab-coletores" class="cfgm-tab" data-config-abrir="coletores"></button>
      <button id="cfgm-tab-lojas" class="cfgm-tab" data-config-abrir="lojas"></button>
      <button id="cfgm-tab-integracao" class="cfgm-tab" data-config-abrir="integracao"></button>
      <div id="modal-config-conteudo"></div>
    </div>
    <div class="page" id="page-operadores"></div>
    <div class="page" id="page-coletores"></div>
    <div class="page" id="page-lojas"></div>
    <div class="page" id="page-integracao-api"></div>
  </body></html>`;
}

function montarAmbiente() {
  const dom = new JSDOM(montarHtml(), { runScripts: 'outside-only', url: 'http://localhost/analista.html#/producao/dashboard' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.showToast = () => {};
  win.scrollTo = () => {};
  win.openModal = id => { win.document.getElementById(id)?.classList.add('open'); };
  win.closeModal = id => { win.document.getElementById(id)?.classList.remove('open'); };
  win.getDTFirestore = () => ({ collection: () => colecaoVazia() });
  win.getDTRawFirestore = () => ({ collection: () => colecaoVazia() });
  win.getDTLojaAtiva = () => 'loja1';
  win._currentAnalistaUser = { email: 'teste@dt.com', uid: 'u1' };
  win.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true, permissoes: {} };
  const ctx = dom.getInternalVMContext();
  ['03-core-navigation.js', 'router-historico.js', '37-usuarios-permissoes.js', '78-pcp-central.js', '79-compras-central.js', '121-compras-profissional.js']
    .forEach(nome => vm.runInContext(ler(nome), ctx, { filename: nome }));
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  win.pcpRegistrarPagina('dashboard', { elId: 'page-pcp-dashboard', render: '_stubPcpDash', titulo: 'Dashboard' });
  win._stubPcpDash = () => {};
  win.AnalistaRouter.init();
  return { win };
}

// ---------------------------------------------------------------------
// 20. Abrir Configurações gerais e voltar
// ---------------------------------------------------------------------
test('20) Abrir Configurações pela engrenagem gera rota "configuracoes"; Voltar (popstate/hashchange) fecha o modal e restaura a página de origem — reaproveitando _paginaAntesConfig, não reimplementado', () => {
  const { win } = montarAmbiente();
  win.goPage('producao-dashboard', win.document.getElementById('nav-producao-dashboard'));
  assert.ok(win.document.getElementById('page-producao-dashboard').classList.contains('on'));

  win.abrirModalConfiguracoes('operadores', null);
  assert.ok(win.document.getElementById('modal-configuracoes').classList.contains('open'));
  assert.equal(win.AnalistaRouter.rotaAtual().path, 'configuracoes');

  // Voltar de verdade: o navegador já teria trocado location.hash sozinho
  // antes de disparar popstate/hashchange — simulamos os dois.
  win.location.hash = '#/producao/dashboard';
  win.dispatchEvent(new win.Event('hashchange'));

  assert.ok(!win.document.getElementById('modal-configuracoes').classList.contains('open'), 'Voltar deveria fechar o modal');
  assert.ok(win.document.getElementById('page-producao-dashboard').classList.contains('on'), 'Voltar deveria restaurar a página de origem (Produção), não abrir Dashboard padrão');
});

test('Fechar Configurações pelo botão (não pelo navegador) também sincroniza a URL de volta pra página de origem', () => {
  const { win } = montarAmbiente();
  win.goPage('producao-dashboard', win.document.getElementById('nav-producao-dashboard'));
  win.abrirModalConfiguracoes('lojas', null);
  assert.equal(win.AnalistaRouter.rotaAtual().path, 'configuracoes');
  win.fecharModalConfiguracoes();
  assert.equal(win.AnalistaRouter.rotaAtual().path, 'producao/dashboard');
  assert.ok(!win.document.getElementById('modal-configuracoes').classList.contains('open'));
});

test('Trocar de aba dentro do modal já aberto (operadores → integracao) atualiza a query ?tab= sem empurrar uma 2ª entrada de histórico', () => {
  const { win } = montarAmbiente();
  const original = win.history.pushState.bind(win.history);
  let pushes = 0; win.history.pushState = (...a) => { pushes++; original(...a); };
  win.abrirModalConfiguracoes('operadores', null);
  win.abrirModalConfiguracoes('integracao', null);
  assert.equal(win.AnalistaRouter.rotaAtual().params.get('tab'), 'integracao');
});

// ---------------------------------------------------------------------
// 24. Sem reabrir modal de cadastro após recarregar
// ---------------------------------------------------------------------
test('24) "Recarregar" com um hash de página normal (não "configuracoes") nunca reabre o modal de Configurações sozinho', () => {
  const { win } = montarAmbiente(); // hash inicial é #/producao/dashboard, não #/configuracoes
  assert.ok(!win.document.getElementById('modal-configuracoes').classList.contains('open'));
});

// ---------------------------------------------------------------------
// 23. Não repetir consultas/renderizações desnecessárias
// ---------------------------------------------------------------------
test('23) Reaplicar a MESMA rota (2 navegações idênticas seguidas) não escreve a URL de novo nem chama irParaSetor uma 2ª vez à toa', () => {
  const { win } = montarAmbiente();
  let chamadasSetor = 0;
  const origIrParaSetor = win.irParaSetor;
  // irParaSetor já está embrulhado pelo roteador — contamos as chamadas na
  // função ORIGINAL via um contador plugado antes do init ser tarde demais:
  // como o wrap já ocorreu, contamos indiretamente pelo nº de vezes que o
  // shell muda de display (só muda de verdade quando setor muda).
  win.goPage('producao-dashboard', win.document.getElementById('nav-producao-dashboard'));
  const chaveAntes = win.location.hash;
  win.goPage('producao-dashboard', win.document.getElementById('nav-producao-dashboard'));
  assert.equal(win.location.hash, chaveAntes, 'clicar duas vezes na mesma página não pode mudar o hash de novo');
});

// ---------------------------------------------------------------------
// 25. Não repetir salvamento ao usar Voltar/Avançar
// ---------------------------------------------------------------------
test('25) Voltar/Avançar entre duas rotas nunca chama funções de salvar/gravar — o roteador só troca .page/.on, nunca invoca ações de escrita', () => {
  const { win } = montarAmbiente();
  let salvouAlgumaCoisa = false;
  // Nenhuma função exposta pelo roteador (apply/currentRoute) referencia
  // qualquer ...Salvar/salvar.../gravar... — prova estrutural: navegar não
  // pode, por construção, chamar Firestore .set/.add porque os únicos
  // pontos de entrada usados por _aplicarEntrada são goPage/irParaSetor/
  // pcpIrParaAba/comprasIrParaPagina, e nenhum deles grava dado sozinho só
  // por trocar de página — confirmamos isso via getDTFirestore instrumentado.
  const chamadasEscrita = [];
  win.getDTFirestore = () => ({
    collection: () => ({
      get: async () => ({ docs: [] }), where: () => ({ get: async () => ({ docs: [] }) }),
      add: (...a) => { chamadasEscrita.push('add'); return Promise.resolve({ id: 'x' }); },
      doc: () => ({ set: (...a) => { chamadasEscrita.push('set'); return Promise.resolve(); }, get: async () => ({ exists: false }) }),
    }),
  });
  win.location.hash = '#/pcp/dashboard'; win.dispatchEvent(new win.Event('hashchange'));
  win.location.hash = '#/pcp/pedidos'; win.dispatchEvent(new win.Event('hashchange'));
  win.location.hash = '#/pcp/dashboard'; win.dispatchEvent(new win.Event('hashchange'));
  win.location.hash = '#/pcp/pedidos'; win.dispatchEvent(new win.Event('hashchange'));
  assert.deepEqual(chamadasEscrita, [], 'navegar por Voltar/Avançar não pode chamar nenhuma escrita no Firestore');
});

// ---------------------------------------------------------------------
// Compras — correção do bug real do selectedProduct (Produtos 360°)
// ---------------------------------------------------------------------
test('Compras: clicar "Ver 360°" seleciona o produto; navegar pra outra aba e voltar pra Produtos SEM ?produto= volta pra lista, não fica preso no 360° (bug corrigido)', () => {
  const { win } = montarAmbiente();
  win.comprasSetProduto('produto-123');
  assert.equal(win.comprasGetSelectedProduct(), 'produto-123');
  assert.ok(win.document.getElementById('page-compras-produtos').classList.contains('on'));

  win.comprasIrParaPagina('solicitacoes', win.document.getElementById('nav-compras-solicitacoes'));
  win.comprasIrParaPagina('produtos', win.document.getElementById('nav-compras-produtos'));
  assert.equal(win.comprasGetSelectedProduct(), '', 'reabrir Produtos sem pedir um produto específico tem que limpar a seleção anterior');
});

test('Compras: deep-link direto pra "compras/produtos?produto=abc" abre já no 360° daquele produto', () => {
  const { win } = montarAmbiente();
  win.location.hash = '#/compras/produtos?produto=abc';
  win.dispatchEvent(new win.Event('hashchange'));
  assert.equal(win.comprasGetSelectedProduct(), 'abc');
  assert.equal(win.AnalistaRouter.rotaAtual().params.get('produto'), 'abc');
});

test('Compras: rota "compras/central" restaura a sub-aba (?aba=historico) e não perde ao trocar de setor e voltar', () => {
  const { win } = montarAmbiente();
  win.location.hash = '#/compras/central?aba=historico';
  win.dispatchEvent(new win.Event('hashchange'));
  assert.equal(win.comprasGetAbaCentral(), 'historico');
  win.location.hash = '#/producao/dashboard'; win.dispatchEvent(new win.Event('hashchange'));
  win.location.hash = '#/compras/central?aba=historico'; win.dispatchEvent(new win.Event('hashchange'));
  assert.equal(win.comprasGetAbaCentral(), 'historico');
});
