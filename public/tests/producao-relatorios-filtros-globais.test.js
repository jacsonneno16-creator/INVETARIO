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

// Data local (não `.toISOString()`, que converte pra UTC): perto da meia-noite
// no fuso de Brasília (UTC-3) o dia em UTC já vira amanhã, fazendo o fixture
// cair fora da janela "semana atual"/"hoje" que o componente calcula em hora
// local (mesmo bug de fuso já visto e corrigido em outro teste desta sessão).
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

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

test('Relatórios: filtro de Produto isolado restringe a tabela de Produtos (aba "produto")', async () => {
  const hoje = iso(new Date());
  const registros = [
    { id: 'r1', data: { produto: 'Produto A', maquina: 'M1', qntCaixas: 70, data: hoje, status: 'pendente' } },
    { id: 'r2', data: { produto: 'Produto B', maquina: 'M1', qntCaixas: 30, data: hoje, status: 'pendente' } },
  ];
  const { win, document } = carregarPagina(registros);
  await win.renderProducaoRelatorios();
  document.querySelector('[data-prel-aba="produto"]').click();
  let html = document.getElementById('page-producao-relatorios').innerHTML;
  assert.match(html, /Produto A/);
  assert.match(html, /Produto B/);

  const selProduto = document.querySelector('[data-prel-produto]');
  selProduto.value = 'Produto A';
  selProduto.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  const conteudo = document.getElementById('prel-conteudo').innerHTML;
  assert.match(conteudo, /Produto A/);
  assert.doesNotMatch(conteudo, /Produto B/, 'filtro de produto deveria remover Produto B da TABELA (o dropdown continua listando os dois, o que é esperado)');
});

// PEDIDO AO VIVO (pendência #5): "filtro de operador precisa filtrar
// efetivamente dados relacionados ao operador — não basta renderizar o
// campo". Conferido contra o original (app.js:17025-17067,
// _grpRenderFuncionarios): o filtro de operador só se aplica à aba
// Funcionários (baseada em apontamentos por funcionário, não em
// registros de máquina/produto) — é assim no original também, não uma
// omissão daqui.
test('Relatórios: filtro de Operador filtra de verdade a aba Funcionários (não só renderiza o campo)', async () => {
  const { win, document } = carregarPagina([]);
  const dom2 = new JSDOM('<!doctype html><html><body><div id="page-producao-relatorios"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win2 = dom2.window; const document2 = dom2.window.document;
  const hoje = iso(new Date());
  win2.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_registros: mockColecao([]),
      producao_apontamentos: mockColecao([]),
      producao_maquinas: mockColecao([]),
      producao_produtos: mockColecao([]),
      producao_projecao: mockColecao([]),
      producao_ficha_tecnica: mockColecao([]),
      producao_insumos_estoque: mockColecao([]),
      producao_processos: mockColecao([
        { id: 'p1', data: { data: hoje, nome: 'Mistura', funcionarios: [{ nome: 'João', tempoMin: 60 }] } },
        { id: 'p2', data: { data: hoje, nome: 'Envase', funcionarios: [{ nome: 'Maria', tempoMin: 90 }] } },
      ]),
    }[nome] || mockColecao([])),
  });
  win2.eval(fs.readFileSync(path.join(base, '69-producao-relatorios.js'), 'utf8'));
  await win2.renderProducaoRelatorios();
  document2.querySelector('[data-prel-aba="funcionarios"]').click();
  let html = document2.getElementById('page-producao-relatorios').innerHTML;
  assert.match(html, /João/);
  assert.match(html, /Maria/);

  const selOperador = document2.querySelector('[data-prel-funcionario]');
  selOperador.value = 'João';
  selOperador.dispatchEvent(new win2.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  const conteudo2 = document2.getElementById('prel-conteudo').innerHTML;
  assert.match(conteudo2, /João/);
  assert.doesNotMatch(conteudo2, /Maria/, 'filtro de operador deveria remover Maria da TABELA de Funcionários (o dropdown continua listando os dois, o que é esperado)');
});

test('Relatórios: filtros combinados (período + máquina + produto) funcionam JUNTOS, não isoladamente', async () => {
  const hoje = new Date();
  const foraDoPeriodo = new Date(hoje); foraDoPeriodo.setDate(hoje.getDate() - 10);
  const registros = [
    // bate com TODOS os filtros combinados abaixo
    { id: 'r1', data: { produto: 'Produto A', maquina: 'ENVASADORA 1', qntCaixas: 40, data: iso(hoje), status: 'pendente' } },
    // máquina certa, mas produto errado
    { id: 'r2', data: { produto: 'Produto B', maquina: 'ENVASADORA 1', qntCaixas: 900, data: iso(hoje), status: 'pendente' } },
    // produto certo, mas máquina errada
    { id: 'r3', data: { produto: 'Produto A', maquina: 'EMPACOTADEIRA 1', qntCaixas: 900, data: iso(hoje), status: 'pendente' } },
    // máquina e produto certos, mas fora do período "Hoje"
    { id: 'r4', data: { produto: 'Produto A', maquina: 'ENVASADORA 1', qntCaixas: 900, data: iso(foraDoPeriodo), status: 'pendente' } },
  ];
  const { win, document } = carregarPagina(registros);
  await win.renderProducaoRelatorios();

  document.querySelector('[data-prel-periodo="hoje"]').click();
  await new Promise(r => setTimeout(r, 0));
  const selMaquina = document.querySelector('[data-prel-maquina]');
  selMaquina.value = 'ENVASADORA 1';
  selMaquina.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  const selProduto = document.querySelector('[data-prel-produto]');
  selProduto.value = 'Produto A';
  selProduto.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('page-producao-relatorios').innerHTML;
  assert.match(html, />40</, 'só o registro que bate com período+máquina+produto ao mesmo tempo deveria contar (40cx)');
  assert.doesNotMatch(html, /900/, 'nenhum dos registros que falham em pelo menos um filtro deveria aparecer somado');
});
