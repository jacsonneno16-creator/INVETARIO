// PEDIDO AO VIVO (2026-09-02): "esses produtos que lá no arquivo fala que
// tá em unidade não é pra aparecer" — a tela Pedidos x Estoque mostrava
// (destacado em amarelo no print do usuário) linhas como "01703 ALHO DESID
// FLOCOS DA TERRINHA 25 g - UND" e "01712 BICARBONATO DE SODIO DA TERRINHA
// 500 g - UND" ao lado de linhas normais com "FD 12"/"CX 12" — a variante
// solta ("UND", sem multiplicador de caixa) do MESMO produto físico, com
// cod diferente do cadastro (mesmo padrão já visto com CANJICA: cod 80604
// "UND" vs cod 80605 "CX 12"). buscarEstoqueBi() passou a excluir do
// codsValidos qualquer cod cujo cadastro (pcp_produtos_bluesoft) tenha
// embalagemKeyBluesoft==='UN', então essas variantes nunca entram no
// universo de chaves do BI (Estoque/Pedidos x Estoque/Dashboard etc, que
// todos compartilham o mesmo _estoqueBi).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');

function colecaoVazia() { return { get: async () => ({ docs: [] }), where: () => ({ get: async () => ({ docs: [] }) }) }; }

async function montarAmbiente(produtosCadastrados, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.calcularProjecaoComRisco = () => [];
  win.getParametrosProducaoProjecao = () => ({});
  win.getDTLojaAtiva = () => 'loja1';
  win.showToast = () => {};
  win.confirm = () => true;
  win._currentAnalistaUser = { email: 'pcp@teste.com' };
  const colProdutos = { get: async () => ({ docs: produtosCadastrados.map((p, i) => ({ id: 'p' + i, data: () => p })) }) };
  win.getDTFirestore = () => ({
    collection: (nome) => ({ producao_produtos: colProdutos }[nome] || colecaoVazia()),
  });
  win.getDTRawFirestore = () => win.getDTFirestore();
  win.DTBiPastaLocal = {
    suportado: () => true,
    status: async () => 'conectado',
    conectar: async () => ({ ok: true }),
    lerJson: async (nome) => {
      if (nome.includes('estoque')) return opts.arquivoEstoque || [];
      if (nome.includes('escadinha')) return opts.arquivoEscadinha || { produtos: [] };
      return null;
    },
  };
  vm.runInContext(code, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  await win.renderPCPCentral();
  return { win };
}

test('buscarEstoqueBi: exclui cod marcado embalagemKeyBluesoft="UN" (variante solta), mantém a variante em caixa do mesmo produto', async () => {
  const { win } = await montarAmbiente([
    { cod: '80604', nome: '01614 CANJICA BRANCA DA TERRINHA 400 G - UND', embalagemKeyBluesoft: 'UN' },
    { cod: '80605', nome: '01614 CANJICA BRANCA DA TERRINHA 400 G - CX 12', embalagemKeyBluesoft: 'CX' },
  ], {
    arquivoEstoque: [
      { loja: 'MATRIZ', loja_key: 1, produto_key: 80604, produto: '01614 CANJICA BRANCA DA TERRINHA 400 G - UND', quantidade_estoque: 228, quantidadePedidos: 0 },
      { loja: 'MATRIZ', loja_key: 1, produto_key: 80605, produto: '01614 CANJICA BRANCA DA TERRINHA 400 G - CX 12', quantidade_estoque: 2194, quantidadePedidos: 1567 },
    ],
    arquivoEscadinha: { produtos: [{ cod: 80605, produto: 'CANJICA BRANCA DA TERRINHA 400 G - CX 12', real: [0,0,0,0,0,600,700,800,0,0,0,0], plano: [] }] },
  });
  await win._pcpInternals.buscarEstoqueBi();
  const bi = win._pcpInternals.getEstoqueBi();
  assert.equal(bi.has('80605'), true, 'variante em caixa continua entrando normalmente');
  assert.equal(bi.has('80604'), false, 'variante solta (UND) não entra mais no universo do BI');
});

test('buscarEstoqueBi: cod sem embalagemKeyBluesoft (campo ausente) continua entrando normalmente (não filtra por engano)', async () => {
  const { win } = await montarAmbiente([
    { cod: '304', nome: '00001 TAPIOCA DA TERRINHA 1 KG - CX 12' },
  ], {
    arquivoEstoque: [
      { loja: 'MATRIZ', loja_key: 1, produto_key: 304, produto: '00001 TAPIOCA DA TERRINHA 1 KG - CX 12', quantidade_estoque: 100, quantidadePedidos: 10 },
    ],
    arquivoEscadinha: { produtos: [] },
  });
  await win._pcpInternals.buscarEstoqueBi();
  assert.equal(win._pcpInternals.getEstoqueBi().has('304'), true);
});
