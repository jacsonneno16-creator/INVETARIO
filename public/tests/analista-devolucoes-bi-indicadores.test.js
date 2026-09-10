// PEDIDO AO VIVO (2026-08-31): devoluções auto-gravadas (origem:
// 'AUTOMATICO') tem indicador próprio, separado dos retornos físicos do
// Coletor (97/98/99 excluem esses registros — ver
// analista-retornos-indicadores-exclui-devolucao-automatico.test.js).
// Este arquivo testa o novo painel (102-devolucoes-bi-indicadores.js):
// KPIs, agrupamento por motivo/mês/rede, e filtro por período usando a
// dataEmissao REAL da nota (não a data de importação).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '102-devolucoes-bi-indicadores.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  const base = {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id }),
    _registro: registro,
  };
  base.where = (campo, op, valor) => {
    const construir = (condicoesAtuais) => ({
      where: (c2, o2, v2) => construir([...condicoesAtuais, { campo: c2, op: o2, valor: v2 }]),
      get: async () => {
        const bate = (data) => condicoesAtuais.every(c => {
          const v = data ? data[c.campo] : undefined;
          if (c.op === '>=') return v >= c.valor;
          if (c.op === '<=') return v <= c.valor;
          if (c.op === '==') return v === c.valor;
          if (c.op === 'array-contains-any') return Array.isArray(v) && v.some(x => c.valor.includes(x));
          return true;
        });
        return { docs: [...registro.entries()].filter(([, data]) => bate(data)).map(([id, data]) => ({ id, data: () => data })) };
      },
    });
    return construir([{ campo, op, valor }]);
  };
  return base;
}

function mockRawFs(colecoes) {
  return {
    batch: () => {
      const dels = [];
      return {
        delete: (ref) => dels.push(ref.id),
        commit: async () => { dels.forEach(id => colecoes.recebimento_recusas._registro.delete(id)); },
      };
    },
  };
}

function carregarPagina(recusasIniciais, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-devolucoes-indicadores"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const col = mockColecao(recusasIniciais || []);
  const colecoes = { recebimento_recusas: col };
  win.getDTFirestore = () => ({ collection: (nome) => (colecoes[nome] || mockColecao([])) });
  win.getDTRawFirestore = () => mockRawFs(colecoes);
  win.aplicarPermissoesAnalista = () => {};
  win.confirm = opts.confirm || (() => true);
  win.showToast = () => {};
  win.eval(code);
  return { win, document, col };
}

const AUTO_BASE = { origem: 'AUTOMATICO', valorTotal: 100 };

test('carregarDevolucoesIndicadores: só carrega registros com origem AUTOMATICO, ignora recebimentos reais do Coletor', async () => {
  const { win } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-01', rede: 'ASSAI', destinatario: 'ASSAI - 278' } },
    { id: 'b', data: { origem: undefined, motivoNome: 'x', valorTotal: 999 } },
  ]);
  await win._DevolucoesBiIndicadoresInternals.carregarDevolucoesIndicadores('2000-01-01','2100-01-01',true);
  const recusas = win._DevolucoesBiIndicadoresInternals.getRecusas();
  assert.equal(recusas.length, 1);
  assert.equal(recusas[0].motivoNome, 'Falta na carga/entrega');
});

// PEDIDO AO VIVO (2026-09-03): "as notas podem gravar direto, mas ainda vai
// continuar recebendo por aqui também... vai ter que criar uma coluna de
// notas que retornaram... quando o conferência receber ela, muda o gráfico
// pra recebida" — o Coletor agora cria um SEGUNDO recebimento_recusas
// (origem:'COLETOR', mesma chave) quando bipa a chave de uma devolução já
// gravada automaticamente. Aqui é onde esse cruzamento vira o campo
// retornouFisicamente de cada registro AUTOMATICO.
test('retornouFisicamente: true quando existe outro registro (qualquer origem != AUTOMATICO) com a mesma chave; false quando só existe o automático', async () => {
  const { win } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, chaves: ['X1'], motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-01' } },
    { id: 'b', data: { ...AUTO_BASE, chaves: ['X2'], motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-01' } },
    { id: 'fisico', data: { origem: 'COLETOR', chaves: ['X1'], motoristaNome: 'João' } },
  ]);
  await win._DevolucoesBiIndicadoresInternals.carregarDevolucoesIndicadores('2000-01-01','2100-01-01',true);
  const recusas = win._DevolucoesBiIndicadoresInternals.getRecusas();
  const auto1 = recusas.find(r => r._id === 'a'), auto2 = recusas.find(r => r._id === 'b');
  assert.equal(auto1.retornouFisicamente, true, 'X1 tem um registro COLETOR com a mesma chave — já retornou fisicamente');
  assert.equal(auto2.retornouFisicamente, false, 'X2 só tem o registro automático — ainda aguardando retorno físico');
});

test('tela: mostra a coluna "Retorno físico" na tabela e o KPI "Aguardando retorno físico"; filtro de retorno esconde as já recebidas', async () => {
  const { win, document } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, chaves: ['X1'], motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-01', destinatario: 'ASSAI - 278' } },
    { id: 'fisico', data: { origem: 'COLETOR', chaves: ['X1'] } },
    { id: 'b', data: { ...AUTO_BASE, chaves: ['X2'], motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-01', destinatario: 'MERCADAO - 12' } },
  ]);
  await win.renderDevolucoesBiIndicadores();
  document.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  let html = document.getElementById('page-recebimento-devolucoes-indicadores').innerHTML;
  assert.match(html, /Retorno físico/);
  assert.match(html, /AGUARDANDO RETORNO FÍSICO/);
  assert.match(html, /✓ Recebida/);
  assert.match(html, /Aguardando retorno/);

  document.getElementById('devind-filtro-retorno').value = 'nao';
  document.getElementById('devind-filtro-retorno').dispatchEvent(new win.Event('change', { bubbles: true }));
  html = document.getElementById('page-recebimento-devolucoes-indicadores').innerHTML;
  assert.match(html, /MERCADAO/, 'X2 (aguardando) continua aparecendo');
  assert.doesNotMatch(html, /ASSAI/, 'X1 (já retornou) sai da lista com o filtro "Aguardando retorno"');
});

test('kpis: soma valor, conta redes/mercados únicos e acha o motivo mais comum', () => {
  const { win } = carregarPagina([]);
  const itens = [
    { valorTotal: 100, rede: 'ASSAI', destinatario: 'ASSAI - 278', motivoNome: 'Falta na carga/entrega' },
    { valorTotal: 50, rede: 'ASSAI', destinatario: 'ASSAI - 14', motivoNome: 'Falta na carga/entrega' },
    { valorTotal: 25, rede: 'MERCADAO', destinatario: 'MERCADAO - 12', motivoNome: 'Impróprio para consumo/venda' },
  ];
  const k = win._DevolucoesBiIndicadoresInternals.kpis(itens);
  assert.equal(k.totalDevolucoes, 3);
  assert.equal(k.somaValor, 175);
  assert.equal(k.redesUnicas, 2);
  assert.equal(k.mercadosUnicos, 3);
  assert.equal(k.motivoTop, 'Falta na carga/entrega');
});

test('mesAnoDe: converte "AAAA-MM-DD" (dataEmissao real) pra "MM/AAAA"', () => {
  const { win } = carregarPagina([]);
  assert.equal(win._DevolucoesBiIndicadoresInternals.mesAnoDe('2026-07-22'), '07/2026');
  assert.equal(win._DevolucoesBiIndicadoresInternals.mesAnoDe(''), '');
});

test('_dataEmissaoDe: usa o campo top-level dataEmissao, com fallback pra notas[0].dataEmissao', () => {
  const { win } = carregarPagina([]);
  const f = win._DevolucoesBiIndicadoresInternals._dataEmissaoDe;
  assert.equal(f({ dataEmissao: '2026-07-22' }), '2026-07-22');
  assert.equal(f({ notas: [{ dataEmissao: '2026-06-10' }] }), '2026-06-10');
  assert.equal(f({}), '');
});

test('tela: mostra KPIs e os 4 gráficos (Motivo/Mês/Redes/Mercados), separado das notas do Coletor', async () => {
  const { win, document } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-22', rede: 'ASSAI', destinatario: 'ASSAI - 278' } },
  ]);
  await win.renderDevolucoesBiIndicadores();
  document.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-recebimento-devolucoes-indicadores').innerHTML;
  assert.match(html, /Indicadores de Devoluções/);
  assert.match(html, /DEVOLUÇÕES/);
  assert.match(html, /Motivo da devolução/);
  assert.match(html, /Devoluções por mês/);
  assert.match(html, /Top redes\/bandeiras/);
  assert.match(html, /Top mercados\/lojas/);
  assert.match(html, /Falta na carga\/entrega/);
  assert.match(html, /ASSAI/);
});

test('tela: filtro de período (EMISSÃO) usa a dataEmissao real, exclui devoluções fora do intervalo', async () => {
  const { win, document } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-22', rede: 'ASSAI', destinatario: 'ASSAI - 278' } },
    { id: 'b', data: { ...AUTO_BASE, motivoNome: 'Impróprio para consumo/venda', dataEmissao: '2026-01-05', rede: 'MERCADAO', destinatario: 'MERCADAO - 12' } },
  ]);
  await win.renderDevolucoesBiIndicadores();
  document.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('devind-periodo-ini').value = '2026-07-01';
  document.getElementById('devind-periodo-ini').dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-recebimento-devolucoes-indicadores').innerHTML;
  assert.match(html, /ASSAI/);
  assert.doesNotMatch(html, /MERCADAO/, 'devolução de janeiro precisa ficar de fora do período a partir de julho');
});

// PEDIDO AO VIVO (2026-09-01): "impróprio pra consumo também não é pra
// gravar... pode descartar também" — Impróprio saiu da lista de motivos
// auto-gravados; botão de limpeza apaga os registros já gravados antes
// dessa mudança (com confirmação mostrando a contagem exata).
test('botão "Limpar Impróprios" só aparece quando existe pelo menos um registro com esse motivo', async () => {
  const { win: semImproprio, document: docSem } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-22' } },
  ]);
  await semImproprio.renderDevolucoesBiIndicadores();
  docSem.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.doesNotMatch(docSem.getElementById('page-recebimento-devolucoes-indicadores').innerHTML, /Limpar Impróprios/);

  const { win: comImproprio, document: docCom } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, motivoNome: 'Impróprio para consumo/venda', dataEmissao: '2026-07-22' } },
  ]);
  await comImproprio.renderDevolucoesBiIndicadores();
  docCom.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.match(docCom.getElementById('page-recebimento-devolucoes-indicadores').innerHTML, /Limpar Impróprios/);
});

test('_limparImproprios: apaga só os registros de Impróprio, pede confirmação com a contagem exata', async () => {
  const { win, document, col } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, motivoNome: 'Impróprio para consumo/venda', dataEmissao: '2026-07-22' } },
    { id: 'b', data: { ...AUTO_BASE, motivoNome: 'Impróprio para consumo/venda', dataEmissao: '2026-08-01' } },
    { id: 'c', data: { ...AUTO_BASE, motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-07-22' } },
  ]);
  let mensagemConfirm = '';
  win.confirm = (msg) => { mensagemConfirm = msg; return true; };
  await win.renderDevolucoesBiIndicadores();
  document.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  await win._DevolucoesBiIndicadoresInternals._limparImproprios();
  assert.match(mensagemConfirm, /2 registro/, 'confirmação precisa mostrar a contagem exata antes de apagar');
  assert.equal(col._registro.size, 1, 'só sobra o registro que não é Impróprio');
  assert.ok(col._registro.has('c'));
});

test('_limparImproprios: cancelando a confirmação não apaga nada', async () => {
  const { win, col } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, motivoNome: 'Impróprio para consumo/venda', dataEmissao: '2026-07-22' } },
  ]);
  win.confirm = () => false;
  await win.renderDevolucoesBiIndicadores();
  win.document.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  await win._DevolucoesBiIndicadoresInternals._limparImproprios();
  assert.equal(col._registro.size, 1, 'cancelou a confirmação — nada deve ser apagado');
});

// PEDIDO AO VIVO (2026-09-02): "nessa tela aqui, colocar uma coluna para
// cada motivo e ali onde fica a quantidade de notas colocar também o
// valor" — "Motivo por mês" virou tabela (uma COLUNA por motivo + Total),
// cada célula com quantidade E valor (antes o card do calor era barras
// empilhadas e só mostrava quantidade).
test('Motivo por mês: uma coluna por motivo (cabeçalho da tabela), e cada célula mostra quantidade E valor', async () => {
  const { win, document } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, valorTotal: 100, motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-06-10' } },
    { id: 'b', data: { ...AUTO_BASE, valorTotal: 50, motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-06-15' } },
    { id: 'c', data: { ...AUTO_BASE, valorTotal: 30, motivoNome: 'Produto errado/divergente', dataEmissao: '2026-06-20' } },
  ]);
  await win.renderDevolucoesBiIndicadores();
  document.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-recebimento-devolucoes-indicadores').innerHTML;
  assert.match(html, /<th[^>]*>[\s\S]*Falta na carga\/entrega[\s\S]*<\/th>/, 'motivo vira cabeçalho de coluna');
  assert.match(html, /<th[^>]*>[\s\S]*Produto errado\/divergente[\s\S]*<\/th>/, 'segundo motivo também vira coluna própria');
  // célula de 06/2026 x Falta na carga/entrega: 2 notas, R$ 150,00 somados
  assert.match(html, />2<\/td>|>2<br/, 'quantidade de notas aparece na célula');
  assert.match(html, /R\$\s*150,00/, 'valor somado (100+50) aparece na mesma célula, não só a quantidade');
  assert.match(html, /R\$\s*30,00/, 'valor da outra célula (só a devolução de 30) também aparece');
});

test('Motivo por mês: clicar no cabeçalho de um motivo filtra por ele (mesmo comportamento de crossfilter de antes)', async () => {
  const { win, document } = carregarPagina([
    { id: 'a', data: { ...AUTO_BASE, motivoNome: 'Falta na carga/entrega', dataEmissao: '2026-06-10' } },
    { id: 'b', data: { ...AUTO_BASE, motivoNome: 'Produto errado/divergente', dataEmissao: '2026-06-20' } },
  ]);
  await win.renderDevolucoesBiIndicadores();
  document.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  const th = [...document.querySelectorAll('[data-devind-filtro="motivo"]')].find(el => el.textContent.includes('Falta na carga/entrega'));
  th.dispatchEvent(new win.Event('click', { bubbles: true }));
  const tabelaMatriz = document.querySelector('table'); // matriz é a primeira tabela renderizada na página
  const cabecalhosMatriz = [...(tabelaMatriz?.querySelectorAll('thead th') || [])].map(th => th.textContent);
  assert.ok(cabecalhosMatriz.some(t => t.includes('Falta na carga/entrega')), 'motivo selecionado continua sendo coluna');
  assert.ok(!cabecalhosMatriz.some(t => t.includes('Produto errado/divergente')), 'motivo filtrado sobra só a coluna dele na matriz (o motivo não selecionado some das colunas)');
  const linhasTabelaNotas = [...document.querySelectorAll('.devind-tag')].map(el => el.textContent);
  assert.ok(!linhasTabelaNotas.some(t => t.includes('Produto errado/divergente')), 'a tabela de notas embaixo também só mostra o motivo filtrado');
});
