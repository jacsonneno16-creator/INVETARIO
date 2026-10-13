// BUG AO VIVO REAL (2026-09-11): "carreguei o site e já tá a 2 minutos sem
// trazer as informações" — sintoma reportado no Pátio em Tempo Real, mas a
// causa real era em Produtos (52-cadastros-v287.js): um onSnapshot aberto
// pra sempre na coleção INTEIRA de produtos (~19-21MB, visto na aba
// Network). Numa conexão instável o WebChannel caía e reconectava sozinho
// (SDK do Firestore), baixando os ~20MB de novo a cada vez — 5 reconexões
// em ~70s, 7 a 58s cada — lotando as conexões do navegador e travando
// QUALQUER outra tela aberta, mesmo sem relação nenhuma com Produtos.
// Mesmo ajuste já feito em Notas Retornadas/Recusas/Status nesta sessão:
// busca única (.get()) + o botão "Atualizar" que já existia, nunca uma
// conexão permanente pendurada.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '52-cadastros-v287.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let chamadasGet = 0;
  return {
    get: async () => { chamadasGet++; return { docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }; },
    _chamadasGet: () => chamadasGet,
    _registro: registro,
  };
}

let _janelasAbertas = [];

function carregarPagina(colecaoProdutos, opcoes = {}) {
  const ativa = opcoes.produtosAtiva !== false;
  const dom = new JSDOM('<!doctype html><html><body><button id="nav-produtos" data-page="produtos">Produtos</button><div id="page-produtos" class="' + (ativa ? 'on' : '') + '"></div><div id="page-enderecos"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  win.getDTRawFirestore = () => ({ collection: () => colecaoProdutos });
  win.showToast = () => {};
  win.eval(code); // boot() já roda aqui dentro (auto-executa no load do script)
  return { win, document };
}

test('login em outra página faz ZERO leituras de produtos; abrir Produtos inicia a primeira leitura', async () => {
  const col = mockColecao([{ id: 'p1', data: { nomeProduto: 'Arroz', ativo: true } }]);
  const { document } = carregarPagina(col, { produtosAtiva: false });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(col._chamadasGet(), 0, 'o carregamento do script/login não consulta produtos');

  document.getElementById('page-produtos').classList.add('on');
  document.getElementById('nav-produtos').click();
  await new Promise(r => setTimeout(r, 220));
  assert.equal(col._chamadasGet(), 1, 'a primeira leitura só ocorre depois de abrir Produtos');
});

test('carrega os produtos com UMA busca (.get()), nunca abre conexão permanente (onSnapshot)', async () => {
  const col = mockColecao([{ id: 'p1', data: { nomeProduto: 'Arroz', ativo: true } }, { id: 'p2', data: { nomeProduto: 'Feijão', ativo: true } }]);
  const { document } = carregarPagina(col);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(document.getElementById('v287-p-total').textContent, '2');
  assert.equal(col._chamadasGet(), 1, 'só 1 leitura — não fica reconectando sozinho');
});

test('clicar em "🔄 Atualizar" refaz a busca (.get() de novo) — continua funcionando sem a conexão permanente', async () => {
  const col = mockColecao([{ id: 'p1', data: { nomeProduto: 'Arroz', ativo: true } }]);
  const { document } = carregarPagina(col);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(col._chamadasGet(), 1);

  col._registro.set('p2', { nomeProduto: 'Feijão', ativo: true }); // produto novo, cadastrado por outra pessoa nesse meio tempo
  document.getElementById('v287-p-refresh').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(col._chamadasGet(), 2, 'o clique disparou uma nova busca');
  assert.equal(document.getElementById('v287-p-total').textContent, '2', 'o produto novo já aparece depois de Atualizar');
});

test('clicar em "Atualizar" 2x rápido (antes da 1ª busca terminar) não dispara 2 buscas concorrentes', async () => {
  const col = mockColecao([{ id: 'p1', data: { nomeProduto: 'Arroz', ativo: true } }]);
  const { document } = carregarPagina(col);
  await new Promise(r => setTimeout(r, 0)); // deixa a 1ª busca (do boot) terminar
  assert.equal(col._chamadasGet(), 1);

  let resolverManual;
  const getOriginal = col.get;
  col.get = () => new Promise(r => { resolverManual = r; col._chamadasGet.contador++; });
  col._chamadasGet.contador = 0;

  document.getElementById('v287-p-refresh').click(); // 1ª busca manual — fica "em voo"
  document.getElementById('v287-p-refresh').click(); // 2º clique, ainda com a 1ª pendente — deve ser ignorado (P.carregando)
  await new Promise(r => setTimeout(r, 0));
  assert.equal(col._chamadasGet.contador, 1, 'o 2º clique não chegou a chamar .get() de novo enquanto a 1ª busca ainda estava em voo');

  resolverManual({ docs: [{ id: 'p1', data: () => ({ nomeProduto: 'Arroz', ativo: true }) }] });
  await new Promise(r => setTimeout(r, 0));
  col.get = getOriginal;
});

test('erro "permission-denied" (login ainda não terminou) fica silencioso — outros erros mostram toast', async () => {
  const colFalhaPermissao = { get: async () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; } };
  const toasts = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="page-produtos" class="on"></div><div id="page-enderecos"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _janelasAbertas.push(win);
  win.getDTRawFirestore = () => ({ collection: () => colFalhaPermissao });
  win.showToast = (m, t) => toasts.push({ m, t });
  win.eval(code);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(toasts.length, 0, 'permission-denied (login ainda carregando) não deve assustar o usuário com um toast');

  const colFalhaRede = { get: async () => { throw new Error('network error'); } };
  const dom2 = new JSDOM('<!doctype html><html><body><div id="page-produtos" class="on"></div><div id="page-enderecos"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win2 = dom2.window;
  _janelasAbertas.push(win2);
  const toasts2 = [];
  win2.getDTRawFirestore = () => ({ collection: () => colFalhaRede });
  win2.showToast = (m, t) => toasts2.push({ m, t });
  win2.eval(code);
  await new Promise(r => setTimeout(r, 0));
  assert.ok(toasts2.some(t => /Erro ao carregar produtos/.test(t.m)), 'erro de verdade (rede, etc.) continua avisando o usuário');
});
