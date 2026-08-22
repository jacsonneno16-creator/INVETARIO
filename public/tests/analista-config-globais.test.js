'use strict';
/**
 * Engrenagem de Configurações (pedido ao vivo do usuário): Usuários/
 * Coletores/Lojas/API são cross-loja e não fazem sentido só dentro do setor
 * Inventário — ficam num ícone ⚙️ na mesma linha dos setores (Logística/
 * Compras/PCP/Produção), acessível de qualquer setor. Usuários/Coletores/
 * Lojas abrem como modal "por cima" de onde o usuário estava (não navegam
 * pra outro setor); a Configuração da API (dentro de Importar/Exportar,
 * multi-aba demais pra mover) só navega, como clicar num setor normal.
 *
 * Usa jsdom (não mocks manuais) porque o comportamento central depende de
 * DOM real: goPage() troca .on em TODAS as .page do documento, e o modal
 * precisa restaurar a página de origem ao fechar sem perder o estado.
 *
 * Correção estrutural (pedido ao vivo do usuário): as mesmas 3 opções
 * apareciam duas vezes — na engrenagem (pra escolher) e de novo como abas
 * dentro do modal já aberto (pra trocar). A engrenagem agora é um botão
 * único que já abre direto na primeira opção permitida (Usuários →
 * Coletores → Lojas); as abas de dentro do modal continuam sendo o único
 * lugar de trocar entre as três, e passam a respeitar a mesma permissão
 * que antes só decidia se o item aparecia fora.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const permCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '37-usuarios-permissoes.js'), 'utf8');

function montarAmbiente(acesso) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="setor-bar"></div>
    <div id="page-pcp-central" class="page on"></div>
    <div id="page-operadores" class="page"></div>
    <div id="page-coletores" class="page"></div>
    <div id="page-lojas" class="page"></div>
    <div id="modal-configuracoes" class="modal-bg">
      <button id="cfgm-tab-operadores" class="cfgm-tab" data-config-abrir="operadores"></button>
      <button id="cfgm-tab-coletores" class="cfgm-tab" data-config-abrir="coletores"></button>
      <button id="cfgm-tab-lojas" class="cfgm-tab" data-config-abrir="lojas"></button>
      <div id="modal-config-conteudo"></div>
    </div>
  </body></html>`, { runScripts: 'outside-only' });
  const win = dom.window;
  const goPageChamadas = [];
  win.goPage = (id) => { goPageChamadas.push(id); win.document.querySelectorAll('.page').forEach(p => p.classList.remove('on')); const el = win.document.getElementById('page-' + id); if (el) el.classList.add('on'); };
  win.openModal = id => { win.document.getElementById(id)?.classList.add('open'); };
  win.closeModal = id => { win.document.getElementById(id)?.classList.remove('open'); };
  win.DT_USUARIO_ACESSO_ATUAL = acesso;
  win.eval(permCode);
  return { win, goPageChamadas };
}

const ACESSO_ADMIN = { admin_mestre: true, permissoes: { operadores: { visualizar: true }, coletores: { visualizar: true }, lojas: { visualizar: true }, 'importar-exportar': { visualizar: true } } };

test('aplicarSetoresPermitidos: engrenagem de Configurações aparece na barra de setores como botão único (sem flyout de 3 itens) e já abre direto em Usuários', () => {
  const { win } = montarAmbiente(ACESSO_ADMIN);
  win.aplicarSetoresPermitidos();
  const html = win.document.getElementById('setor-bar').innerHTML;
  assert.match(html, /id="setor-btn-config"/);
  // data-config-abrir (não onclick inline) — o sanitizador global de
  // common-utils.js remove qualquer atributo on* de HTML injetado via
  // .innerHTML, então o clique tem que ser resolvido pelo listener
  // delegado em document, via data-*.
  assert.match(html, /id="setor-btn-config"[^>]*data-config-abrir="operadores"/);
  // Não é mais um flyout com 3 sub-itens — só um data-config-abrir na
  // própria engrenagem, sem um segundo nível de sub-botões.
  const ocorrencias = (html.match(/data-config-abrir="/g) || []).length;
  assert.equal(ocorrencias, 1);
});

test('aplicarSetoresPermitidos: sem permissão de Usuários mas com Coletores, a engrenagem abre direto em Coletores', () => {
  const acesso = { admin_mestre: false, setores_permitidos: { logistica: true }, permissoes: { operadores: {}, coletores: { visualizar: true }, lojas: {}, 'importar-exportar': {} } };
  const { win } = montarAmbiente(acesso);
  win.aplicarSetoresPermitidos();
  const html = win.document.getElementById('setor-bar').innerHTML;
  assert.match(html, /id="setor-btn-config"[^>]*data-config-abrir="coletores"/);
});

test('REGRESSÃO: clique real (não chamada direta de função) na engrenagem abre o modal — pega o caso do sanitizador global de common-utils.js removendo onclick inline silenciosamente', () => {
  const commonUtilsCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'common-utils.js'), 'utf8');
  const { win } = montarAmbiente(ACESSO_ADMIN);
  win.eval(commonUtilsCode); // instala o sanitizador real de .innerHTML, igual em produção
  win.aplicarSetoresPermitidos();
  const btn = win.document.getElementById('setor-btn-config');
  assert.ok(btn, 'engrenagem deveria existir no DOM');
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(win.document.getElementById('modal-configuracoes').classList.contains('open'), 'clique real na engrenagem tem que abrir o modal (onclick inline seria removido pelo sanitizador — só data-* + listener delegado funciona)');
});

test('abrirModalConfiguracoes: esconde as abas internas (cfgm-tab-*) que o usuário não tem permissão de ver', () => {
  const acesso = { admin_mestre: false, setores_permitidos: { logistica: true }, permissoes: { operadores: { visualizar: true }, coletores: {}, lojas: {}, 'importar-exportar': {} } };
  const { win } = montarAmbiente(acesso);
  win.abrirModalConfiguracoes('operadores');
  assert.notEqual(win.document.getElementById('cfgm-tab-operadores').style.display, 'none');
  assert.equal(win.document.getElementById('cfgm-tab-coletores').style.display, 'none');
  assert.equal(win.document.getElementById('cfgm-tab-lojas').style.display, 'none');
});

test('aplicarSetoresPermitidos: sem nenhuma permissão de config, a engrenagem nem aparece (evita abrir um painel vazio)', () => {
  const acessoSemConfig = { admin_mestre: false, setores_permitidos: { logistica: true, compras: true }, permissoes: { operadores: {}, coletores: {}, lojas: {}, 'importar-exportar': {} } };
  const { win } = montarAmbiente(acessoSemConfig);
  win.aplicarSetoresPermitidos();
  const html = win.document.getElementById('setor-bar').innerHTML;
  assert.doesNotMatch(html, /id="setor-btn-config"/);
});

test('abrirModalConfiguracoes: move a página real pro modal, marca a aba certa e chama goPage — sem apagar a página de fora que estava ativa', () => {
  const { win, goPageChamadas } = montarAmbiente(ACESSO_ADMIN);

  win.abrirModalConfiguracoes('operadores');

  assert.ok(win.document.getElementById('modal-configuracoes').classList.contains('open'));
  assert.equal(win.document.getElementById('page-operadores').parentNode.id, 'modal-config-conteudo'); // moveu de verdade
  assert.ok(win.document.getElementById('cfgm-tab-operadores').classList.contains('on'));
  assert.deepEqual(goPageChamadas, ['operadores']);
});

test('REGRESSÃO: fechar o modal de Configurações restaura a página de onde o usuário veio (PCP, neste teste) — não pode ficar em branco', () => {
  const { win, goPageChamadas } = montarAmbiente(ACESSO_ADMIN);
  assert.ok(win.document.getElementById('page-pcp-central').classList.contains('on')); // estado inicial: usuário estava no PCP

  win.abrirModalConfiguracoes('operadores');
  // goPage('operadores') removeu .on de TODAS as .page — inclusive PCP, que
  // fica coberto pelo modal mas ficaria em branco se não for restaurado.
  assert.ok(!win.document.getElementById('page-pcp-central').classList.contains('on'));

  win.fecharModalConfiguracoes();

  assert.ok(!win.document.getElementById('modal-configuracoes').classList.contains('open'));
  assert.ok(win.document.getElementById('page-pcp-central').classList.contains('on')); // restaurado
  assert.deepEqual(goPageChamadas, ['operadores', 'pcp-central']);
});

test('trocar de aba dentro do modal já aberto não perde a página de origem — fechar ainda volta pro PCP, não pra "operadores"', () => {
  const { win, goPageChamadas } = montarAmbiente(ACESSO_ADMIN);

  win.abrirModalConfiguracoes('operadores');
  win.abrirModalConfiguracoes('coletores'); // troca de aba com o modal já aberto
  assert.ok(win.document.getElementById('cfgm-tab-coletores').classList.contains('on'));
  assert.ok(!win.document.getElementById('cfgm-tab-operadores').classList.contains('on'));

  win.fecharModalConfiguracoes();

  assert.deepEqual(goPageChamadas, ['operadores', 'coletores', 'pcp-central']);
  assert.ok(win.document.getElementById('page-pcp-central').classList.contains('on'));
});
