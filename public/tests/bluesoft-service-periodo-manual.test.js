'use strict';
// PEDIDO AO VIVO (2026-08-24): "eu queria colocar lá a data que eu quero
// buscar... não buscar automaticamente" — o usuário está testando contra
// uma cópia de homologação da Bluesoft datada de junho (só tem dado até
// lá) e no futuro vai trocar pra API de produção; uma janela fixa "hoje
// menos N dias/meses" não é confiável em nenhum dos dois cenários. Trava
// que dataInicial/dataFinal explícitos (opcoes) sobrescrevem o cálculo
// automático nas buscas que têm noção de período (notas, venda faturada,
// pedidos de compra) — e que sem eles nada muda (mesmo automático de
// sempre).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const servicoCode = fs.readFileSync(path.join(base, '90-bluesoft-service.js'), 'utf8');

function mockRawFirestore(loja) {
  return {
    collection: (nome) => {
      if (nome === 'lojas') return { doc: () => ({ get: async () => ({ exists: true, data: () => loja }), collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }) };
      if (nome === 'dt_config') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ token: 'tok', url_hml: 'https://hml.exemplo', ambiente: 'homologacao', timeout: 30 }) }) }) };
      return { doc: () => ({ get: async () => ({ exists: false }) }) };
    },
  };
}
function loadServico(fetchMock, loja, recebimentoNotas) {
  const document = { addEventListener: () => {} };
  const colecaoRecebimentoNotas = { get: async () => ({ docs: (recebimentoNotas || []).map(d => ({ data: () => d })) }) };
  const window = {
    fetch: fetchMock,
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'idtoken' } }) },
    getDTRawFirestore: () => mockRawFirestore(loja),
    getDTFirestore: () => ({ collection: (nome) => nome === 'recebimento_notas' ? colecaoRecebimentoNotas : { get: async () => ({ docs: [] }), doc: () => ({ id: 'novo' }) } }),
    getDTLojaAtiva: () => 'loja1',
  };
  vm.runInNewContext(servicoCode, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, URLSearchParams, JSON, AbortController, setTimeout, clearTimeout }, { filename: '90-bluesoft-service.js' });
  return window;
}
function respostaJson(status, corpo) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(corpo) }; }

test('_parseDataBluesoft: aceita Date, "yyyy-MM-dd" (input type=date) e "dd/MM/yyyy"', () => {
  const w = loadServico(async () => respostaJson(200, {}), { nome: 'L' });
  const { _parseDataBluesoft } = w._bluesoftServiceInternals;
  assert.equal(_parseDataBluesoft('2026-06-15').getMonth(), 5);
  assert.equal(_parseDataBluesoft('2026-06-15').getDate(), 15);
  assert.equal(_parseDataBluesoft('15/06/2026').getMonth(), 5);
  assert.equal(_parseDataBluesoft('15/06/2026').getDate(), 15);
  assert.equal(_parseDataBluesoft(''), null);
  assert.equal(_parseDataBluesoft(undefined), null);
});

test('_resolverPeriodoBluesoft: sem dataInicial/dataFinal, cai no automático (hoje menos diasPadrao)', () => {
  const w = loadServico(async () => respostaJson(200, {}), { nome: 'L' });
  const { _resolverPeriodoBluesoft } = w._bluesoftServiceInternals;
  const r = _resolverPeriodoBluesoft({}, 10);
  assert.equal(r.manual, false);
  const diffDias = Math.round((r.fim - r.inicio) / 86400000);
  assert.equal(diffDias, 10);
});

test('_resolverPeriodoBluesoft: com dataInicial explícita, usa exatamente esse período (sem teto de dias)', () => {
  const w = loadServico(async () => respostaJson(200, {}), { nome: 'L' });
  const { _resolverPeriodoBluesoft } = w._bluesoftServiceInternals;
  const r = _resolverPeriodoBluesoft({ dataInicial: '2026-01-01', dataFinal: '2026-06-30' }, 10);
  assert.equal(r.manual, true);
  assert.equal(r.inicio.getMonth(), 0);
  assert.equal(r.fim.getMonth(), 5);
});

test('obterNotasRetornoBluesoft: com período explícito, o filtro de data enviado pra Bluesoft é exatamente o período escolhido (não o automático de 30 dias)', async () => {
  const caminhos = [];
  const fetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    caminhos.push(body.path);
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
  };
  const loja = { nome: 'Loja 1', bluesoft_loja_key: 'LK1' };
  const w = loadServico(fetchMock, loja, []);
  await w.obterNotasRetornoBluesoft({ dataInicial: '2026-06-01', dataFinal: '2026-06-30' });
  const chamadaEntrada = caminhos.find(p => p.startsWith('/api/estoques/notas-fiscais?'));
  assert.ok(chamadaEntrada, 'precisa ter chamado a busca de notas de entrada');
  assert.ok(chamadaEntrada.includes('dataRecebimentoInicial=01%2F06%2F2026') || chamadaEntrada.includes('dataRecebimentoInicial=01/06/2026'), 'a data inicial enviada precisa ser a escolhida pelo usuário (01/06/2026), não a automática');
  assert.ok(chamadaEntrada.includes('dataRecebimentoFinal=30%2F06%2F2026') || chamadaEntrada.includes('dataRecebimentoFinal=30/06/2026'));
  const chamadaVenda = caminhos.find(p => p.startsWith('/api/forca-de-vendas/pedidos?'));
  assert.ok(chamadaVenda, 'precisa ter chamado a busca de venda faturada também');
  assert.ok(chamadaVenda.includes('01%2F06%2F2026') || chamadaVenda.includes('01/06/2026'), 'o mesmo período escolhido precisa valer pra venda faturada, não só pras notas de entrada');
});

test('obterNotasRetornoBluesoft: sem período explícito, continua usando a janela automática de 30 dias (comportamento antigo preservado)', async () => {
  const caminhos = [];
  const fetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    caminhos.push(body.path);
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
  };
  const loja = { nome: 'Loja 1', bluesoft_loja_key: 'LK1' };
  const w = loadServico(fetchMock, loja, []);
  await w.obterNotasRetornoBluesoft({});
  const chamadaEntrada = caminhos.find(p => p.startsWith('/api/estoques/notas-fiscais?'));
  const qs = new URLSearchParams(chamadaEntrada.split('?')[1]);
  const hoje = new Date();
  const trintaDiasAtras = new Date(); trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
  const fmt = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  assert.equal(qs.get('dataRecebimentoFinal'), fmt(hoje));
  assert.equal(qs.get('dataRecebimentoInicial'), fmt(trintaDiasAtras));
});

test('sincronizarAgendaBluesoft: com período explícito, envia dataEntregaInicial/Final pra /api/compras/pedidos-de-compra', async () => {
  const caminhos = [];
  const fetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    caminhos.push(body.path);
    if (body.path.startsWith('/api/fornecedores')) return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
  };
  const loja = { nome: 'Loja 1', bluesoft_loja_key: 'LK1' };
  const w = loadServico(fetchMock, loja);
  await w.sincronizarAgendaBluesoft({ dataInicial: '2026-06-01', dataFinal: '2026-06-30' });
  const chamadaPedidos = caminhos.find(p => p.startsWith('/api/compras/pedidos-de-compra?'));
  assert.ok(chamadaPedidos, 'precisa ter chamado a busca de pedidos de compra');
  const qs = new URLSearchParams(chamadaPedidos.split('?')[1]);
  assert.equal(qs.get('dataEntregaInicial'), '01/06/2026');
  assert.equal(qs.get('dataEntregaFinal'), '30/06/2026');
});

test('sincronizarAgendaBluesoft: sem período explícito, busca sem filtro de data nenhum (comportamento antigo preservado)', async () => {
  const caminhos = [];
  const fetchMock = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    caminhos.push(body.path);
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
  };
  const loja = { nome: 'Loja 1', bluesoft_loja_key: 'LK1' };
  const w = loadServico(fetchMock, loja);
  await w.sincronizarAgendaBluesoft();
  const chamadaPedidos = caminhos.find(p => p.startsWith('/api/compras/pedidos-de-compra?'));
  const qs = new URLSearchParams(chamadaPedidos.split('?')[1]);
  assert.equal(qs.get('dataEntregaInicial'), null);
  assert.equal(qs.get('dataEntregaFinal'), null);
});
