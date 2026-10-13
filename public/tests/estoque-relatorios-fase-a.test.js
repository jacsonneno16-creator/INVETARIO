'use strict';
// Logística › Estoque › Relatórios — FASE A (2026-10-02): só o menu/
// permissão/troca de shell, sem dado real ainda (ver plano completo em
// structured-sprouting-hoare.md). Estes testes cobrem exatamente os 3
// itens pedidos nesta fase: (1) o item "Estoque" aparece/some conforme a
// permissão, (2) irParaSetor('logistica','estoque') mostra o shell certo
// e esconde os outros 2, (3) nenhuma página nova usa onclick inline.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const permCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '37-usuarios-permissoes.js'), 'utf8');
const htmlAn = fs.readFileSync(path.join(__dirname, '..', 'analista.html'), 'utf8');

function montarAmbiente(acesso) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="setor-bar"></div>
    <div id="setor-placeholder"></div>
    <div id="app-main-logistica"></div>
    <div id="setor-logistica-recebimento-shell"><div class="page" id="page-recebimento-dashboard"></div></div>
    <div id="setor-logistica-estoque-shell"><div class="page" id="page-estoque-rel-inventario"></div></div>
    <div id="setor-producao-shell"></div>
    <div id="setor-pcp-shell"></div>
    <div id="setor-compras-shell"></div>
  </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.DT_USUARIO_ACESSO_ATUAL = acesso;
  win.goPage = () => {}; // Fase A: render real das páginas não carregado neste harness
  win.carregarScriptsDeArea = async () => {}; // lazy-load — não importa o script de verdade aqui
  win.eval(permCode);
  return win;
}

const BASE_ADMIN = { admin_mestre: true };
function acessoComEstoque() {
  return { setores_permitidos: { logistica: true }, permissoes: { 'estoque-rel-inventario': { visualizar: true } } };
}
function acessoSemEstoque() {
  return { setores_permitidos: { logistica: true }, permissoes: { 'recebimento-dashboard': { visualizar: true } } };
}

test('aplicarSetoresPermitidos: usuário com permissão de Estoque vê o item "📊 Estoque" no flyout de Logística', () => {
  const win = montarAmbiente(acessoComEstoque());
  win.aplicarSetoresPermitidos();
  const html = win.document.getElementById('setor-bar').innerHTML;
  assert.match(html, /data-setor-view="estoque"/);
  assert.match(html, /📊\s*Estoque/);
});

test('aplicarSetoresPermitidos: usuário SEM nenhuma permissão de Estoque não vê o item no flyout (evita abrir um painel vazio)', () => {
  const win = montarAmbiente(acessoSemEstoque());
  win.aplicarSetoresPermitidos();
  const html = win.document.getElementById('setor-bar').innerHTML;
  assert.doesNotMatch(html, /data-setor-view="estoque"/);
});

test('aplicarSetoresPermitidos: admin_mestre sempre vê o item "Estoque" (igual já acontece com Recebimento)', () => {
  const win = montarAmbiente(BASE_ADMIN);
  win.aplicarSetoresPermitidos();
  const html = win.document.getElementById('setor-bar').innerHTML;
  assert.match(html, /data-setor-view="estoque"/);
  assert.match(html, /data-setor-view="recebimento"/);
});

test('REGRESSÃO (mesmo bug já corrigido pra Recebimento em 2026-09-18): usuário com SÓ permissão de Estoque não fica preso numa tela em branco — "só 1 setor" ainda mostra o flyout de Logística', () => {
  const win = montarAmbiente(acessoComEstoque());
  win.aplicarSetoresPermitidos();
  // Com só Logística liberado mas tendo permissão funcional de Estoque, a
  // barra não pode ter sido reduzida a só a engrenagem — precisa continuar
  // mostrando o flyout (mesma lógica que já vale pra Recebimento).
  const html = win.document.getElementById('setor-bar').innerHTML;
  assert.match(html, /setor-flyout-trigger/, 'flyout de Logística precisa continuar visível, não só a engrenagem');
});

test('irParaSetor("logistica","estoque"): mostra o shell de Estoque e esconde Inventário clássico e Recebimento', async () => {
  const win = montarAmbiente(BASE_ADMIN);
  win.aplicarSetoresPermitidos();
  await win.irParaSetor('logistica', 'estoque');
  assert.equal(win.document.getElementById('setor-logistica-estoque-shell').style.display, 'flex');
  assert.equal(win.document.getElementById('app-main-logistica').style.display, 'none');
  assert.equal(win.document.getElementById('setor-logistica-recebimento-shell').style.display, 'none');
});

test('irParaSetor("logistica","recebimento") continua escondendo o shell de Estoque (regressão: shell novo não pode vazar por cima dos outros 2)', async () => {
  const win = montarAmbiente(BASE_ADMIN);
  win.aplicarSetoresPermitidos();
  await win.irParaSetor('logistica', 'estoque');
  await win.irParaSetor('logistica', 'recebimento');
  assert.equal(win.document.getElementById('setor-logistica-estoque-shell').style.display, 'none');
  assert.equal(win.document.getElementById('setor-logistica-recebimento-shell').style.display, 'flex');
});

test('analista.html: shell de Estoque existe com os 4 nav-items e 4 page-divs certos (mesmo molde estático do shell de Recebimento)', () => {
  const inicio = htmlAn.indexOf('id="setor-logistica-estoque-shell"');
  assert.ok(inicio > -1, 'shell de Estoque precisa existir em analista.html');
  const fim = htmlAn.indexOf('<!-- Configurações globais', inicio);
  const trecho = htmlAn.slice(inicio, fim);
  ['estoque-rel-inventario', 'estoque-rel-descarte', 'estoque-rel-requisicao', 'estoque-rel-transformacao'].forEach(id => {
    assert.match(trecho, new RegExp('id="nav-' + id + '"'));
    assert.match(trecho, new RegExp('id="page-' + id + '"'));
  });
});

test('125-estoque-relatorios.js (Fase A): o placeholder "em construção" nunca usa onclick inline (HTML gerado via innerHTML — o sanitizador global removeria o atributo)', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-estoque-rel-inventario"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '125-estoque-relatorios.js'), 'utf8');
  win.eval(codigo);
  win.renderEstoqueRelInventario();
  const html = win.document.getElementById('page-estoque-rel-inventario').innerHTML;
  assert.doesNotMatch(html, /onclick=/);
  assert.match(html, /Relatório de Inventário/);
});
