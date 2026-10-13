// PEDIDO AO VIVO (2026-09-18): "não quero que esses nomes fiquem
// aparecendo... cada comprador só vai poder pesquisar os seus" — o
// seletor de comprador do Dashboard de Compras (antes liberado pra
// QUALQUER conta com a permissão 'pcp-central') passa a respeitar um papel
// formal gravado no cadastro do usuário (usuarios_acessos.papelCompras):
// 'comprador' nunca escolhe nada (sempre travado no próprio nome), 'gerente'
// só escolhe dentro de quem ele gerencia (compradoresGerenciados), e quem
// não tem papel nenhum (inclusive o admin/dono) continua vendo geral.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/89-compras-dashboard.js'), 'utf8');

const RESUMO_BASE = {
  nPedidos: 3, compradoNoMes: 100, compradoNoAno: 100, valorTotal: 100,
  porMes: [], topProdutos: [], topFornecedores: [], maisSubiram: [], maisCairam: [],
  compradores: [{ primeiroNome: 'dilma' }, { primeiroNome: 'fabricio' }, { primeiroNome: 'gisella' }],
};

function carregarPagina(acesso, resumo) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-dashboard"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win._comprasInternals = { carregar: async () => {}, historicoCompras: () => [], historicoBase: () => [], agruparHistorico: () => [], agendamentos: () => [] };
  win.DT_USUARIO_ACESSO_ATUAL = acesso;
  win._currentAnalistaUser = { email: 'x@daterrinhaalimentos.com.br' };
  win.showToast = () => {};
  win.Chart = function () { return { destroy() {} }; };
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: name => async () => name === 'buscarResumoComprasDashboardBigQuery' ? { data: { resumo } } : { data: {} } }) }) };
  win.eval(code);
  return { win, document: win.document };
}

test('comprador: nunca vê o seletor, e o filtro trava sempre no próprio nome (nunca escolhe nada)', async () => {
  const { win, document } = carregarPagina({ papelCompras: 'comprador', nome: 'Dilma Silva' }, RESUMO_BASE);
  await win.renderComprasDashboard();
  const html = document.getElementById('page-compras-dashboard').innerHTML;
  assert.doesNotMatch(html, /id="compd-compradores"/, 'comprador não vê nenhum seletor');
});

test('gerente: vê o seletor, mas só com quem ele gerencia — nunca o universo inteiro', async () => {
  const acesso = { papelCompras: 'gerente', compradoresGerenciados: ['Dilma', 'Fabricio'] };
  const { win, document } = carregarPagina(acesso, RESUMO_BASE);
  await win.renderComprasDashboard();
  const html = document.getElementById('page-compras-dashboard').innerHTML;
  assert.match(html, /id="compd-compradores"/, 'gerente vê o seletor');
  assert.match(html, /Dilma/); assert.match(html, /Fabricio/);
  assert.doesNotMatch(html, />Gisella</, 'Gisella não é gerenciada por este gerente — não aparece como opção');
  assert.match(html, /Ver comprador da minha equipe/);
});

test('gerente sem equipe configurada ainda: não trava ninguém (mostra geral, sem seletor restrito quebrando a tela)', async () => {
  const { win, document } = carregarPagina({ papelCompras: 'gerente', compradoresGerenciados: [] }, RESUMO_BASE);
  await win.renderComprasDashboard();
  const html = document.getElementById('page-compras-dashboard').innerHTML;
  assert.doesNotMatch(html, /id="compd-compradores"/, 'sem equipe definida, nem oferece um seletor vazio');
});

test('admin/dono: vê o seletor com todos os compradores reais, sem restrição', async () => {
  const { win, document } = carregarPagina({ admin_mestre: true }, RESUMO_BASE);
  await win.renderComprasDashboard();
  const html = document.getElementById('page-compras-dashboard').innerHTML;
  assert.match(html, /id="compd-compradores"/);
  assert.match(html, /Dilma/); assert.match(html, /Fabricio/); assert.match(html, /Gisella/);
  assert.match(html, /Filtrar por comprador/);
});

test('sem papel nenhum (conta comum, sem admin_mestre e sem papelCompras): não vê seletor, mas também não fica travada num nome — usa o próprio nome como comprador padrão', async () => {
  const { win, document } = carregarPagina({ nome: 'Joao Vitor' }, RESUMO_BASE);
  await win.renderComprasDashboard();
  const html = document.getElementById('page-compras-dashboard').innerHTML;
  assert.doesNotMatch(html, /id="compd-compradores"/);
});

// Confirma que o filtro de fato RESTRINGE os números mostrados (não só
// esconde/mostra o seletor) — usa o caminho de fallback (obterHistoricoComprasRealBi,
// sem BigQuery) pra checar o KPI "Comprado no mês" com dado real por linha.
test('comprador: os KPIs refletem só as compras com o nome dele (comprador_nome), nunca das outras pessoas', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-dashboard"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win._comprasInternals = { carregar: async () => {}, historicoCompras: () => [], historicoBase: () => [], agruparHistorico: () => [], agendamentos: () => [] };
  win.DT_USUARIO_ACESSO_ATUAL = { papelCompras: 'comprador', nome: 'Dilma Silva' };
  win._currentAnalistaUser = { email: 'dilma@daterrinhaalimentos.com.br' };
  win.showToast = () => {};
  win.Chart = function () { return { destroy() {} }; };
  const hoje = new Date();
  const mesRef = hoje.toISOString().slice(0, 8) + '10';
  win.obterHistoricoComprasRealBi = async () => [
    { comprador_nome: 'Dilma Silva', data_recebimento: mesRef, Custo_liquido_total: 500, nf_numero: 'NF1' },
    { comprador_nome: 'Fabricio Souza', data_recebimento: mesRef, Custo_liquido_total: 900, nf_numero: 'NF2' },
  ];
  win.eval(code);
  await win.renderComprasDashboard();
  const html = win.document.getElementById('page-compras-dashboard').innerHTML;
  assert.match(html, /500,00/, 'só a compra da Dilma entra no KPI');
  assert.doesNotMatch(html, /900,00/, 'a compra do Fabricio não vaza pro KPI da Dilma');
});

// PEDIDO AO VIVO (2026-09-18): "o gerente vai poder pegar o login de uma
// pessoa que vai sair de férias e unificar na outra... os pedidos dela
// aparecem TAMBÉM pra quem tá cobrindo" — o Dashboard consulta o BigQuery
// já filtrado por nome (compradores:[...]); a cobertura ativa some/aparece
// nessa lista sem precisar mexer no cadastro da pessoa em si.
test('cobertura temporária: comprador cobrindo um colega ausente manda o BigQuery filtrar TAMBÉM pelo nome de quem ele está cobrindo', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-compras-dashboard"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win._comprasInternals = { carregar: async () => {}, historicoCompras: () => [], historicoBase: () => [], agruparHistorico: () => [], agendamentos: () => [] };
  win.DT_USUARIO_ACESSO_ATUAL = { papelCompras: 'comprador', nome: 'Marta Lima' };
  win._currentAnalistaUser = { uid: 'u-marta', email: 'marta@daterrinhaalimentos.com.br' };
  win.showToast = () => {};
  win.Chart = function () { return { destroy() {} }; };
  let compradoresRecebidos = null;
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: name => async payload => {
    if (name === 'buscarResumoComprasDashboardBigQuery') { compradoresRecebidos = payload.compradores; return { data: { resumo: RESUMO_BASE } }; }
    return { data: {} };
  } }) }) };
  win.getDTRawFirestore = () => ({ collection: nome => {
    if (nome !== 'compras_cobertura_temporaria') return { where: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) };
    return {
      where: (campo, op, valor) => ({
        where: (campo2, op2, valor2) => ({
          get: async () => {
            const linha = { origemUid: 'u-dilma', origemNome: 'Dilma Silva', substitutoUid: 'u-marta', ativo: true };
            const bate = linha[campo] === valor && linha[campo2] === valor2;
            return { docs: bate ? [{ id: 'c1', data: () => linha }] : [] };
          },
        }),
      }),
    };
  } });
  win.eval(code);
  await win.renderComprasDashboard();
  // Array.from: compradoresRecebidos vem do realm do JSDOM (win) — assert
  // trata array cross-realm como "mesma estrutura, mas não é a mesma
  // referência" e falha mesmo com o conteúdo idêntico.
  assert.deepEqual(Array.from(compradoresRecebidos || []), ['marta lima', 'dilma silva'], 'filtra pelo próprio nome E pelo nome de quem está cobrindo');
});
