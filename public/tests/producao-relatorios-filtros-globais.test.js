// PEDIDO AO VIVO (auditoria 2ª rodada, seção 12): Relatórios tinha um
// nav de semana única (‹ Semana / Hoje / Semana ›), mas o original
// (index.html:754-780) usa Filtros Globais — De/Até + Máquina/Produto/
// Operador + atalhos de período (Hoje/Semana/Mês/Trimestre/Ano/Tudo). O
// próprio arquivo já tinha um comentário "PENDENTE, não escondido"
// reconhecendo essa lacuna de uma auditoria anterior. Este teste dirige
// o render real (jsdom) pra confirmar que os filtros existem e realmente
// restringem os dados mostrados — não só que os campos aparecem na tela.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '69-producao-relatorios.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }) };
}

function iso(d) { return d.toISOString().slice(0, 10); }

function carregarPagina(registros) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-relatorios"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_registros: mockColecao(registros),
      producao_apontamentos: mockColecao([]),
      producao_maquinas: mockColecao([]),
      producao_produtos: mockColecao([]),
      producao_projecao: mockColecao([]),
      producao_ficha_tecnica: mockColecao([]),
      producao_insumos_estoque: mockColecao([]),
      producao_processos: mockColecao([]),
    }[nome] || mockColecao([])),
  });
  win.DTProducao = { registrarInvalidacao: () => {} };
  win.eval(code);
  return { win, document };
}

test('Relatórios: painel de Filtros Globais aparece com De/Até, Máquina, Produto, Operador e atalhos de período', async () => {
  const { win, document } = carregarPagina([]);
  await win.renderProducaoRelatorios();
  const html = document.getElementById('page-producao-relatorios').innerHTML;
  assert.match(html, /🔍 Filtros/);
  assert.match(html, /data-prel-dt-ini/);
  assert.match(html, /data-prel-dt-fim/);
  assert.match(html, /Todas as máquinas/);
  assert.match(html, /Todos os produtos/);
  assert.match(html, /Todos os operadores/);
  assert.match(html, /data-prel-periodo="hoje"/);
  assert.match(html, /data-prel-periodo="tudo"/);
  assert.doesNotMatch(html, /data-prel-semana/, 'nav de semana única deveria ter sumido');
});

test('Relatórios: filtro de Máquina realmente restringe o Programado/Realizado mostrado', async () => {
  const hoje = iso(new Date());
  const registros = [
    { id: 'r1', data: { produto: 'Produto A', maquina: 'ENVASADORA 1', qntCaixas: 100, data: hoje, status: 'pendente' } },
    { id: 'r2', data: { produto: 'Produto B', maquina: 'EMPACOTADEIRA 1', qntCaixas: 50, data: hoje, status: 'pendente' } },
  ];
  const { win, document } = carregarPagina(registros);
  await win.renderProducaoRelatorios();

  // sem filtro: soma das duas máquinas (150 cx programadas)
  let html = document.getElementById('page-producao-relatorios').innerHTML;
  assert.match(html, /150/);

  const selMaquina = document.querySelector('[data-prel-maquina]');
  selMaquina.value = 'ENVASADORA 1';
  selMaquina.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  html = document.getElementById('page-producao-relatorios').innerHTML;
  assert.match(html, /100/, 'com o filtro de máquina, só a ENVASADORA 1 (100cx) deveria contar');
  assert.doesNotMatch(html, />150</, 'não deveria mais mostrar o total das duas máquinas somadas');
});

test('Relatórios: atalho "Hoje" restringe o período pra só a data de hoje', async () => {
  const hoje = new Date();
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 8); // fora da semana atual também
  const registros = [
    { id: 'r1', data: { produto: 'Produto A', maquina: 'M1', qntCaixas: 100, data: iso(hoje), status: 'pendente' } },
    { id: 'r2', data: { produto: 'Produto B', maquina: 'M1', qntCaixas: 999, data: iso(ontem), status: 'pendente' } },
  ];
  const { win, document } = carregarPagina(registros);
  await win.renderProducaoRelatorios();

  document.querySelector('[data-prel-periodo="hoje"]').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('page-producao-relatorios').innerHTML;
  const inputIni = document.querySelector('[data-prel-dt-ini]');
  const inputFim = document.querySelector('[data-prel-dt-fim]');
  assert.equal(inputIni.value, iso(hoje));
  assert.equal(inputFim.value, iso(hoje));
  assert.doesNotMatch(html, /999/, 'registro de 8 dias atrás não deveria entrar no período "Hoje"');
});

test('Relatórios: "Limpar" volta ao período padrão (semana atual) e reseta os demais filtros', async () => {
  const { win, document } = carregarPagina([]);
  await win.renderProducaoRelatorios();
  document.querySelector('[data-prel-periodo="ano"]').click();
  await new Promise(r => setTimeout(r, 0));
  document.querySelector('[data-prel-limpar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios').innerHTML;
  assert.match(html, /Todas as máquinas/);
});
