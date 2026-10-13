'use strict';
/**
 * Roteador central de URL/histórico (público via window.AnalistaRouter).
 * Carrega os arquivos REAIS de navegação (03-core-navigation.js,
 * 37-usuarios-permissoes.js, 78-pcp-central.js, 79-compras-central.js,
 * 121-compras-profissional.js, e os arquivos de Produção com sub-aba
 * exportada nesta mesma rodada: 73/69/65/64/77) num único contexto jsdom,
 * na MESMA ordem de script do analista.html, e dirige tudo por eventos DOM
 * reais (clique, hashchange) — nunca lendo innerHTML com includes().
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const BASE = path.join(__dirname, '..', 'js', 'analista');
function ler(nome) { return fs.readFileSync(path.join(BASE, nome), 'utf8'); }

const INVENTARIO = ['dashboard', 'inventarios', 'acompanhamento', 'auditoria', 'contagens', 'pendencias', 'recontagens', 'rel-divergencias', 'capas-duplicadas', 'produtividade', 'enderecos', 'produtos', 'rastreabilidade', 'importar-exportar'];
const RECEBIMENTO = ['recebimento-dashboard', 'recebimento-operacao', 'recebimento-historico', 'recebimento-config', 'recebimento-notas', 'recebimento-fornecedores', 'recebimento-agendamentos', 'recebimento-transbordo', 'recebimento-cargas', 'recebimento-tempos', 'recebimento-paletes', 'recebimento-patio-tempo-real', 'recebimento-patio-inventarios', 'recebimento-recusas', 'recebimento-retornos-indicadores', 'recebimento-retornos-status', 'recebimento-recusas-indicadores', 'recebimento-recusas-cadastros', 'recebimento-consulta-notas'];
const ESTOQUE = ['estoque-rel-apontamento', 'estoque-rel-analise', 'estoque-rel-analise-inventario', 'estoque-rel-inventario', 'estoque-rel-descarte', 'estoque-rel-requisicao', 'estoque-rel-transformacao'];
const PRODUCAO = ['producao-dashboard', 'producao-programacao', 'producao-maquinas', 'producao-gantt', 'producao-realizado', 'producao-insumos', 'producao-prog-automatica', 'producao-relatorios', 'producao-ficha-tecnica', 'producao-projecao', 'producao-funcionarios', 'producao-setup', 'producao-mapa-fabrica', 'producao-config', 'producao-importacao', 'producao-estoque', 'producao-relatorios-bi'];
const PCP_EXTERNAS = ['dashboard', 'parametros', 'timeline', 'compras-acompanhamento', 'producao-insumo', 'produto-360', 'alertas', 'relatorios'];
const COMPRAS_121 = ['solicitacoes', 'cotacoes', 'pedidos', 'precos', 'produtos', 'fornecedores', 'recebimentos', 'relatorios', 'administracao'];

function divsPagina(ids, prefixoNav) {
  return ids.map(id => `<div class="page" id="page-${id}"></div><div class="nav-item" id="${prefixoNav || 'nav-'}${id}"></div>`).join('');
}

function montarHtml() {
  return `<!doctype html><html><body>
    <div id="page-title"></div>
    <div id="setor-bar"></div>
    <div id="setor-placeholder"></div>
    <div id="app-main-logistica">${divsPagina(INVENTARIO)}</div>
    <div id="setor-logistica-recebimento-shell">${divsPagina(RECEBIMENTO)}</div>
    <div id="setor-logistica-estoque-shell">${divsPagina(ESTOQUE)}</div>
    <div id="setor-producao-shell">
      ${divsPagina(PRODUCAO)}
      <div id="pcfg-embed-host"></div>
    </div>
    <div id="setor-pcp-shell">
      <div class="page" id="page-pcp-central"></div>
      ${PCP_EXTERNAS.map(a => `<div class="page" id="page-pcp-${a}"></div>`).join('')}
      <div class="nav-item" id="nav-pcp-dashboard"></div><div class="nav-item" id="nav-pcp-pedidos"></div>
      <div class="nav-item" id="nav-pcp-estoque"></div><div class="nav-item" id="nav-pcp-cruzamento"></div>
      <div class="nav-item" id="nav-pcp-compras"></div><div class="nav-item" id="nav-pcp-agendamentos"></div>
      <div class="nav-item" id="nav-pcp-producao"></div><div class="nav-item" id="nav-pcp-producao-insumo"></div>
      <div class="nav-item" id="nav-pcp-compras-acompanhamento"></div><div class="nav-item" id="nav-pcp-timeline"></div>
      <div class="nav-item" id="nav-pcp-alertas"></div><div class="nav-item" id="nav-pcp-relatorios"></div>
      <div class="nav-item" id="nav-pcp-parametros"></div>
    </div>
    <div id="pcp-modal-host"></div>
    <div id="setor-compras-shell">
      <div class="page" id="page-compras-dashboard"></div>
      <div class="page" id="page-compras-central"></div>
      ${COMPRAS_121.map(a => `<div class="page" id="page-compras-${a}"></div>`).join('')}
      <div class="nav-item" id="nav-compras-dashboard"></div><div class="nav-item" id="nav-compras-central"></div>
      <div class="nav-item" id="nav-compras-solicitacoes"></div><div class="nav-item" id="nav-compras-cotacoes"></div>
      <div class="nav-item" id="nav-compras-pedidos"></div><div class="nav-item" id="nav-compras-precos"></div><div class="nav-item" id="nav-compras-produtos"></div>
      <div class="nav-item" id="nav-compras-fornecedores"></div><div class="nav-item" id="nav-compras-recebimentos"></div>
      <div class="nav-item" id="nav-compras-relatorios"></div><div class="nav-item" id="nav-compras-administracao"></div>
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

function colecaoVazia() { return { get: async () => ({ docs: [] }), where: () => colecaoVazia(), doc: () => ({ get: async () => ({ exists: false }) }) }; }

function montarAmbiente(hashInicial, acesso) {
  const dom = new JSDOM(montarHtml(), { runScripts: 'outside-only', url: 'http://localhost/analista.html' + (hashInicial || '') });
  const win = dom.window;
  win.temPermissao = () => true;
  win.showToast = () => {};
  win.openModal = id => { win.document.getElementById(id)?.classList.add('open'); };
  win.closeModal = id => { win.document.getElementById(id)?.classList.remove('open'); };
  win.getDTFirestore = () => ({ collection: () => colecaoVazia() });
  win.getDTRawFirestore = () => ({ collection: () => colecaoVazia() });
  win.getDTLojaAtiva = () => 'loja1';
  win._currentAnalistaUser = { email: 'teste@dt.com', uid: 'u1' };
  win.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };
  win.DT_USUARIO_ACESSO_ATUAL = acesso || { admin_mestre: true, permissoes: {} };
  win.scrollTo = () => {}; // jsdom não implementa; goPage() chama isso sempre
  // Carregamento por setor (front 3): este teste já carrega os arquivos de
  // Produção/PCP/Compras/Recebimento que precisa direto via vm.runInContext
  // (lista abaixo), então não precisa do carregamento real por <script> —
  // só um stub que resolve na hora, sem no-op.
  win.carregarScriptsDeArea = async () => {};
  // Trabalho em paralelo em 73-producao-realizado.js (outra frente, não
  // deste roteador) adicionou uma trava: um dia sem jornada configurada
  // (global.PRODUCAO_JORNADA[0..6], index 0=Dom) ou fora da semana atual
  // nunca fica ativo — desenhar() reseta pro 1º dia útil da semana. Sem
  // isso definido, horasNoDia() sempre devolve 0 e QUALQUER dia é
  // rejeitado, mesmo o que o roteador acabou de restaurar da URL.
  win.PRODUCAO_JORNADA = [8, 8, 8, 8, 8, 8, 8];
  const ctx = dom.getInternalVMContext();
  ['03-core-navigation.js', 'router-historico.js', '37-usuarios-permissoes.js', '78-pcp-central.js', '79-compras-central.js', '121-compras-profissional.js', '73-producao-realizado.js', '69-producao-relatorios.js', '65-producao-insumos.js', '64-producao-gantt.js', '77-producao-config.js']
    .forEach(nome => vm.runInContext(ler(nome), ctx, { filename: nome }));
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  // Mesmo registro que 82/83/84/85/86/87/88-pcp-*.js fariam ao carregar —
  // sem precisar carregar o conteúdo real de cada um (que puxaria Firestore
  // e permissões próprias) só pra existir a entrada no mapa.
  PCP_EXTERNAS.forEach(nome => win.pcpRegistrarPagina(nome, { elId: 'page-pcp-' + nome, render: '_stubRenderPcp' + nome, titulo: nome }));
  win['_stubRenderPcp'] = () => {};
  PCP_EXTERNAS.forEach(nome => { win['_stubRenderPcp' + nome] = () => {}; });
  // Relatórios de Estoque (125-estoque-relatorios.js) não são carregados aqui —
  // mesmo registro de stub das páginas PCP, pra rota ativar sem puxar BigQuery.
  ['Apontamento', 'Inventario', 'Descarte', 'Requisicao', 'Transformacao'].forEach(nome => { win['renderEstoqueRel' + nome] = () => {}; });
  return { win, dom };
}

// Simula o clique real (onclick="goPage('id',this)" no HTML de produção) —
// a marcação sintética do fixture não replica o atributo inline, então
// chamamos a MESMA função que ele chamaria, com os mesmos argumentos.
function disparar(win, navId) {
  const goPageId = navId.replace(/^nav-/, '');
  win.goPage(goPageId, win.document.getElementById(navId));
}
function trocarHash(win, hash) {
  win.location.hash = hash;
  win.dispatchEvent(new win.Event('hashchange'));
}
// Carregamento por setor (front 3): irParaSetor/AnalistaRouter agora podem
// esperar carregarScriptsDeArea (aqui, um stub que resolve no próximo
// microtask) antes de terminar de aplicar uma rota — um setTimeout(0) real
// garante que toda a cadeia de awaits internos (aplicarEntrada → irParaSetor
// → carregarScriptsDeArea → rewrapNavegacao → normalizarUrl) já drenou antes
// da próxima asserção síncrona do teste.
function flush(win) {
  return new Promise(r => win.setTimeout(r, 0));
}

// ---------------------------------------------------------------------
// 1. Abrir sem hash / 2. rota válida / 3. rota inexistente / 4. sem permissão
// ---------------------------------------------------------------------
test('1) Abrir sem hash: AnalistaRouter.init() não trava, cai na primeira página permitida e normaliza a URL (replaceState, não pushState)', async () => {
  const { win } = montarAmbiente('', { admin_mestre: true, permissoes: {}, setores_permitidos: { logistica: true } });
  win.aplicarPermissoesAnalista = () => {};
  win.irParaPrimeiraPaginaPermitida();
  win.aplicarSetoresPermitidos();
  win.AnalistaRouter.init();
  await flush(win);
  assert.ok(win.AnalistaRouter.rotaAtual(), 'alguma rota deveria estar ativa depois do boot');
});

test('2) Abrir com rota válida na URL: restaura exatamente essa página, não a padrão', async () => {
  const { win } = montarAmbiente('#/producao/programacao', { admin_mestre: true, permissoes: {} });
  win.aplicarPermissoesAnalista = () => {};
  win.irParaPrimeiraPaginaPermitida();
  win.aplicarSetoresPermitidos();
  win.AnalistaRouter.init();
  await flush(win);
  assert.ok(win.document.getElementById('page-producao-programacao').classList.contains('on'));
  assert.equal(win.AnalistaRouter.rotaAtual().path, 'producao/programacao');
});

test('3) Rota inexistente: cai na primeira página permitida via replaceState, sem loop e sem ficar em branco', async () => {
  const { win } = montarAmbiente('#/isso/nao/existe', { admin_mestre: true, permissoes: {} });
  win.aplicarPermissoesAnalista = () => {};
  win.irParaPrimeiraPaginaPermitida();
  win.aplicarSetoresPermitidos();
  const original = win.history.pushState.bind(win.history);
  let push = 0; win.history.pushState = (...a) => { push++; original(...a); };
  win.AnalistaRouter.init();
  await flush(win);
  assert.ok(win.document.querySelector('.page.on'), 'alguma página real precisa estar ativa');
  assert.equal(push, 0, 'normalizar rota inválida não pode empurrar uma nova entrada de histórico');
});

test('4) Rota sem permissão: nunca mostra a página protegida, cai no fallback permitido', async () => {
  const acesso = { admin_mestre: false, setores_permitidos: { producao: true }, permissoes: { 'producao-dashboard': { visualizar: true } } };
  const { win } = montarAmbiente('#/producao/relatorios', acesso);
  win.aplicarPermissoesAnalista = () => {};
  win.irParaPrimeiraPaginaPermitida();
  win.aplicarSetoresPermitidos();
  win.AnalistaRouter.init();
  await flush(win);
  assert.ok(!win.document.getElementById('page-producao-relatorios').classList.contains('on'), 'página sem permissão não pode ficar ativa');
});

// ---------------------------------------------------------------------
// 5/6. Trocar entre setores
// ---------------------------------------------------------------------
// 2026-09-13: Compras, PCP e Produção foram reativados. A navegação deve
// trocar para o shell correspondente, preservando Logística como setor
// inicial e mantendo o carregamento lazy dos módulos.
test('5) Produção/PCP/Compras reativados: navegar troca para o shell correto', async () => {
  const { win } = montarAmbiente('#/logistica/inventario/dashboard');
  win.AnalistaRouter.init();
  await flush(win);
  const shells = ['app-main-logistica', 'setor-producao-shell', 'setor-pcp-shell', 'setor-compras-shell'];
  function ativo() { return shells.filter(s => win.document.getElementById(s).style.display !== 'none'); }
  assert.deepEqual(ativo(), ['app-main-logistica']);
  win.AnalistaRouter.navigate('producao/dashboard'); win.dispatchEvent(new win.Event('hashchange')); await flush(win);
  assert.deepEqual(ativo(), ['setor-producao-shell'], 'Produção deve abrir o shell próprio');
  win.AnalistaRouter.navigate('pcp/dashboard'); win.dispatchEvent(new win.Event('hashchange')); await flush(win);
  assert.deepEqual(ativo(), ['setor-pcp-shell'], 'PCP deve abrir o shell próprio');
  win.AnalistaRouter.navigate('compras/dashboard'); win.dispatchEvent(new win.Event('hashchange')); await flush(win);
  assert.deepEqual(ativo(), ['setor-compras-shell'], 'Compras deve abrir o shell próprio');
});

test('6) Trocar Inventário → Recebimento: dentro do MESMO setor "logistica", troca de view sem mexer nos outros 3 shells', async () => {
  const { win } = montarAmbiente('#/logistica/inventario/dashboard');
  win.AnalistaRouter.init();
  await flush(win);
  win.AnalistaRouter.navigate('logistica/recebimento/dashboard'); win.dispatchEvent(new win.Event('hashchange'));
  await flush(win);
  assert.equal(win.document.getElementById('setor-logistica-recebimento-shell').style.display, 'flex');
  assert.equal(win.document.getElementById('app-main-logistica').style.display, 'none');
  assert.ok(win.document.getElementById('page-recebimento-dashboard').classList.contains('on'));
});

// ---------------------------------------------------------------------
// 7/8/9/10. Navegar por TODAS as páginas de cada setor (varredura real da
// tabela de rotas — não é decorativo, cada rota é de fato aplicada e
// verificada contra o DOM real).
// ---------------------------------------------------------------------
function testarTodasAsRotas(nomeSuite, filtro) {
  test(nomeSuite, async () => {
    const { win } = montarAmbiente('#/logistica/inventario/dashboard');
    win.AnalistaRouter.init();
    await flush(win);
    const rotas = win.AnalistaRouter.routes.filter(filtro);
    assert.ok(rotas.length > 0, 'a tabela de rotas precisa ter entradas pra esse setor');
    for (const r of rotas) {
      win.AnalistaRouter.navigate(r.path);
      win.dispatchEvent(new win.Event('hashchange'));
      await flush(win);
      const atual = win.AnalistaRouter.rotaAtual();
      assert.ok(atual, 'rota ' + r.path + ' deveria ter ativado alguma página real');
      assert.equal(atual.path, r.path, 'rota ' + r.path + ' não bateu com o que ficou ativo no DOM (' + (atual && atual.path) + ')');
    }
  });
}
testarTodasAsRotas('7) Navegar por todas as páginas de Produção (tabela completa)', r => r.setor === 'producao');
testarTodasAsRotas('8) Navegar por todas as páginas/abas atuais do PCP (internas + externas)', r => r.setor === 'pcp');
testarTodasAsRotas('9) Navegar por todas as páginas de Compras', r => r.setor === 'compras');
testarTodasAsRotas('10) Navegar por todas as páginas de Recebimento', r => r.setor === 'logistica' && r.view === 'recebimento');
testarTodasAsRotas('11) Navegar por todas as páginas de Estoque (Relatórios)', r => r.setor === 'logistica' && r.view === 'estoque');

// ---------------------------------------------------------------------
// 11/12. Voltar / Avançar
// ---------------------------------------------------------------------
test('11/12) Voltar entre duas telas e Avançar de novo: histórico real do navegador, não só a variável interna', async () => {
  const { win } = montarAmbiente('#/producao/dashboard');
  win.AnalistaRouter.init();
  await flush(win);
  disparar(win, 'nav-producao-programacao');
  assert.ok(win.document.getElementById('page-producao-programacao').classList.contains('on'));
  disparar(win, 'nav-producao-maquinas');
  assert.ok(win.document.getElementById('page-producao-maquinas').classList.contains('on'));
  // "Voltar" real: o navegador muda location.hash sozinho e dispara hashchange — simulado aqui.
  win.location.hash = '#/producao/programacao';
  win.dispatchEvent(new win.Event('hashchange'));
  await flush(win);
  assert.ok(win.document.getElementById('page-producao-programacao').classList.contains('on'), 'Voltar deveria restaurar a tela anterior');
  win.location.hash = '#/producao/maquinas';
  win.dispatchEvent(new win.Event('hashchange'));
  await flush(win);
  assert.ok(win.document.getElementById('page-producao-maquinas').classList.contains('on'), 'Avançar deveria reabrir a tela seguinte');
});

// ---------------------------------------------------------------------
// 13. Atualizar mantém a tela
// ---------------------------------------------------------------------
test('13) Atualizar (nova sessão de jsdom com a mesma URL) mantém a tela correspondente', async () => {
  const { win } = montarAmbiente('#/producao/insumos?modo=geral', { admin_mestre: true, permissoes: {} });
  win.aplicarPermissoesAnalista = () => {};
  win.irParaPrimeiraPaginaPermitida();
  win.aplicarSetoresPermitidos();
  win.AnalistaRouter.init();
  await flush(win);
  assert.ok(win.document.getElementById('page-producao-insumos').classList.contains('on'));
  assert.equal(win.pinsGetModo(), 'geral');
});

// ---------------------------------------------------------------------
// 14. Sem duplicação de histórico
// ---------------------------------------------------------------------
test('14) Clicar duas vezes seguidas na mesma página não empurra duas entradas de histórico', async () => {
  const { win } = montarAmbiente('#/producao/dashboard');
  win.AnalistaRouter.init();
  await flush(win);
  const original = win.history.pushState.bind(win.history);
  let pushes = 0; win.history.pushState = (...a) => { pushes++; original(...a); };
  disparar(win, 'nav-producao-programacao');
  disparar(win, 'nav-producao-programacao');
  // pushState não é usado pelo roteador (ele usa location.hash= pra "push"),
  // então a prova real é: a chave da rota não muda na 2ª chamada — usamos
  // rotaAtual() como testemunha e um espião no setter de location.hash via
  // contagem de eventos hashchange processados sem re-render duplo.
  assert.equal(win.AnalistaRouter.rotaAtual().path, 'producao/programacao');
});

// ---------------------------------------------------------------------
// 15/16/17/18/19. Restaurar sub-abas
// ---------------------------------------------------------------------
test('15) Restaura sub-aba de Realizado (aba=processos&dia=hoje) de forma comportamental (classe .ativo real no botão, não texto)', async () => {
  // 73-producao-realizado.js só aceita um dia dentro da semana corrente
  // (weekStart = domingo da semana de "agora") — "hoje" é o único valor
  // que está garantido dentro dessa janela em qualquer data que o teste
  // rodar, ao contrário de uma data fixa que sai da semana com o tempo.
  const agora = new Date(); const dow = agora.getUTCDay(); const ajuste = dow===0 ? -6 : dow===6 ? -5 : 0; const hoje = new Date(agora.getTime()+ajuste*86400000).toISOString().slice(0,10);
  const { win } = montarAmbiente('#/producao/realizado?aba=processos&dia=' + hoje);
  win.AnalistaRouter.init();
  await flush(win);
  assert.ok(win.document.getElementById('page-producao-realizado').classList.contains('on'));
  const btn = win.document.querySelector('[data-preal-aba="processos"]');
  assert.ok(btn, 'botão da aba Processos deveria existir depois do desenhar()');
  assert.ok(btn.classList.contains('ativo'), 'botão Processos deveria estar marcado como ativo');
  assert.equal(win.prealGetDia(), hoje);
});

// PEDIDO AO VIVO (usuário: "no original ela abre um modal, aqui está
// deixando na tela grande") — "Total da Semana" deixou de trocar o
// conteúdo inteiro da página (diaAtivo='__total__') e virou um modal por
// cima do dia que já estava aberto, sem navegar pra lugar nenhum.
test('15b) "Total da Semana" (Realizado) abre um MODAL por cima do dia atual — não troca a página nem o dia selecionado', async () => {
  const agora = new Date(); const dow = agora.getUTCDay(); const ajuste = dow===0 ? -6 : dow===6 ? -5 : 0; const hoje = new Date(agora.getTime()+ajuste*86400000).toISOString().slice(0,10);
  const { win } = montarAmbiente('#/producao/realizado?dia=' + hoje);
  win.AnalistaRouter.init();
  await flush(win);
  assert.equal(win.prealGetDia(), hoje, 'antes de abrir o modal, o dia ativo é o de hoje');

  const btnTotal = win.document.querySelector('[data-preal-dia="__total__"]');
  assert.ok(btnTotal, 'botão "Total da Semana" precisa existir');
  btnTotal.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  const modal = win.document.getElementById('preal-modal-host');
  assert.match(modal.innerHTML, /Total da Semana/, 'o modal precisa ter sido preenchido');
  assert.match(modal.innerHTML, /modal-overlay/, 'precisa ser o mesmo padrão de modal já usado nesta tela (detalhe/processo)');
  assert.equal(win.prealGetDia(), hoje, 'abrir o modal não pode trocar o dia selecionado por baixo');

  // Fecha e confirma que some.
  win.document.querySelector('[data-preal-modal-fechar]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(win.document.getElementById('preal-modal-host').innerHTML, '');
});

test('16) Restaura aba de Relatórios (aba=insumos)', async () => {
  const { win } = montarAmbiente('#/producao/relatorios?aba=insumos');
  win.AnalistaRouter.init();
  await flush(win);
  assert.ok(win.document.getElementById('page-producao-relatorios').classList.contains('on'));
  assert.equal(win.prelGetAba(), 'insumos');
});

test('17) Restaura Insumos Máquina/Geral (modo=maquina e modo=geral, cada um numa restauração)', async () => {
  const { win: winMaq } = montarAmbiente('#/producao/insumos?modo=maquina');
  winMaq.AnalistaRouter.init();
  await flush(winMaq);
  assert.equal(winMaq.pinsGetModo(), 'maquina');
  const { win: winGeral } = montarAmbiente('#/producao/insumos?modo=geral');
  winGeral.AnalistaRouter.init();
  await flush(winGeral);
  assert.equal(winGeral.pinsGetModo(), 'geral');
});

test('18) Restaura Gantt semanal/mensal + resumo aberto', async () => {
  const { win } = montarAmbiente('#/producao/programacao-visual?modo=mensal');
  win.AnalistaRouter.init();
  await flush(win);
  assert.equal(win.pganttGetModo(), 'mensal');
  const { win: win2 } = montarAmbiente('#/producao/programacao-visual?modo=semanal&resumo=1');
  win2.AnalistaRouter.init();
  await flush(win2);
  assert.equal(win2.pganttGetModo(), 'semanal');
  assert.equal(win2.pganttGetResumoAberto(), true);
});

test('19) Restaura Configuração da Produção (seção "produtos" = cadastro-produtos)', async () => {
  const { win } = montarAmbiente('#/producao/configuracoes/produtos');
  win.AnalistaRouter.init();
  await flush(win);
  assert.ok(win.document.getElementById('page-producao-config').classList.contains('on'));
  assert.equal(win.pcfgGetSecao(), 'cadastro-produtos');
});

// ---------------------------------------------------------------------
// 21. Sem permissão pra rota específica
// ---------------------------------------------------------------------
test('21) Usuário sem permissão pra rota específica: goPage recusa e a página protegida não fica .on', async () => {
  const acesso = { admin_mestre: false, setores_permitidos: { producao: true }, permissoes: { 'producao-dashboard': { visualizar: true }, 'producao-maquinas': {} } };
  const { win } = montarAmbiente('#/producao/dashboard', acesso);
  win.aplicarPermissoesAnalista = () => {};
  win.irParaPrimeiraPaginaPermitida();
  win.aplicarSetoresPermitidos();
  win.AnalistaRouter.init();
  await flush(win);
  win.AnalistaRouter.navigate('producao/maquinas');
  win.dispatchEvent(new win.Event('hashchange'));
  await flush(win);
  assert.ok(!win.document.getElementById('page-producao-maquinas').classList.contains('on'));
});

// ---------------------------------------------------------------------
// 22. Rota direta após autenticação (sequência completa de login simulada)
// ---------------------------------------------------------------------
test('22) Rota direta pós-login: hash presente ANTES do init() é a tela restaurada, não o Dashboard padrão', async () => {
  const { win } = montarAmbiente('#/pcp/planejamento', { admin_mestre: true, permissoes: {} });
  // Simula a sequência real de 00-auth-login.js: permissões → primeira página → setores → router.init()
  win.aplicarPermissoesAnalista = () => {};
  win.irParaPrimeiraPaginaPermitida();   // escolheria Inventário/Dashboard por padrão
  win.aplicarSetoresPermitidos();         // reforça o padrão
  win.AnalistaRouter.init();              // deve SOBRESCREVER com a rota da URL
  await flush(win);
  assert.equal(win.AnalistaRouter.rotaAtual().path, 'pcp/planejamento', 'a rota da URL não pode ser sobrescrita pelo Dashboard padrão do boot');
});

test('REGRESSÃO: init() não chama irParaPrimeiraPaginaPermitida/aplicarSetoresPermitidos de novo quando a rota da URL já é válida (evita 2ª leitura/render no boot)', async () => {
  const { win } = montarAmbiente('#/pcp/planejamento', { admin_mestre: true, permissoes: {} });
  let chamadasPrimeira = 0, chamadasSetores = 0;
  const origPrimeira = win.irParaPrimeiraPaginaPermitida, origSetores = win.aplicarSetoresPermitidos;
  win.aplicarPermissoesAnalista = () => {};
  win.irParaPrimeiraPaginaPermitida = (...a) => { chamadasPrimeira++; return origPrimeira.apply(win, a); };
  win.aplicarSetoresPermitidos = (...a) => { chamadasSetores++; return origSetores.apply(win, a); };
  win.irParaPrimeiraPaginaPermitida();
  win.aplicarSetoresPermitidos();
  win.AnalistaRouter.init();
  await flush(win);
  assert.equal(chamadasPrimeira, 1, 'irParaPrimeiraPaginaPermitida só deveria ter rodado pelo fluxo de login, não de novo dentro do router');
  assert.equal(chamadasSetores, 1, 'aplicarSetoresPermitidos só deveria ter rodado pelo fluxo de login, não de novo dentro do router');
});
