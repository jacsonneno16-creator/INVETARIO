// PEDIDO AO VIVO (2026-08-27/28): "o que tiver cadastrado lá na produção vai
// aparecer como produto pra compras? Vai desaparecer pros compradores...
// os produtos que não tiver cadastro de loja que produz, vai ter cadastro
// do fornecedor, aí sim vai entrar em solicitações de pedido pra poder
// comprar" — produto com empresaProdutoraId cadastrado (fabricado pela
// própria empresa) nunca pode virar sugestão de COMPRA no PCP; só produto
// sem empresa produtora (comprado de fornecedor) entra lá. O inverso vale
// pra "Sugestões de produção".
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');

function colecaoVazia() { return { get: async () => ({ docs: [] }), where: () => ({ get: async () => ({ docs: [] }) }) }; }
function colecaoEscrivel(docsIniciais) {
  const registro = new Map((docsIniciais || []).map((d, i) => [d.id || 'seed' + i, d.data || d]));
  let seq = 0;
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    where: () => ({ get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }) }),
    add: async (payload) => { const id = 'novo' + (seq++); registro.set(id, payload); return { id }; },
    doc: (id) => ({ id, set: async (payload, opts) => { const atual = registro.get(id) || {}; registro.set(id, opts?.merge ? { ...atual, ...payload } : payload); } }),
    _registro: registro,
  };
}

async function montarAmbiente(produtosCadastrados, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  // consumo diário > 0 vindo do "motor" (mockado), pra necessidade > 0 sem
  // precisar de todo o motor de demanda real — mesmo cod dos produtos.
  win.calcularProjecaoComRisco = () => produtosCadastrados.map(p => ({ cod: p.cod, projFinal: 70 }));
  win.getParametrosProducaoProjecao = () => ({});
  win.getDTLojaAtiva = () => 'loja1';
  win.showToast = () => {};
  win.confirm = () => true;
  win._currentAnalistaUser = { email: 'pcp@teste.com' };
  const colProdutos = { get: async () => ({ docs: produtosCadastrados.map((p, i) => ({ id: 'p' + i, data: () => p })) }) };
  const colRegras = colecaoEscrivel((opts.regras || []).map(r => ({ data: r })));
  const colReq = colecaoEscrivel([]);
  win.getDTFirestore = () => ({
    collection: (nome) => ({ producao_produtos: colProdutos, compras_regras_comprador: colRegras, pcp_requisicoes_compra: colReq }[nome] || colecaoVazia()),
  });
  win.getDTRawFirestore = () => win.getDTFirestore();
  vm.runInContext(code, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  await win.renderPCPCentral();
  return { win, colReq };
}

test('aba Compras: produto com empresa produtora cadastrada NÃO aparece como necessidade de compra', async () => {
  const { win } = await montarAmbiente([
    { cod: '100', nome: 'Farinha Própria', metaCoberturaDias: 10, empresaProdutoraId: 'lojaFilial', empresaProdutoraNome: 'Filial' },
    { cod: '200', nome: 'Especiaria do Fornecedor', metaCoberturaDias: 10, fornecedorPadrao: 'Fornecedor Y' },
  ]);
  win.pcpIrParaAba('compras');
  const html = win.document.getElementById('page-pcp-central').innerHTML;
  assert.doesNotMatch(html, /Farinha Própria/, 'produzido pela própria empresa não pode virar sugestão de compra');
  assert.match(html, /Especiaria do Fornecedor/, 'sem empresa produtora (fornecedor) continua aparecendo pra comprar');
});

// PEDIDO AO VIVO (2026-09-02): "dividir esses produtos por linhas... e
// colocar já alguma coisa que já envia automaticamente o pedido pra
// compras direto" — tabela normal (não mais nuvem de botões) + botão de
// enviar pedido direto (sem modal), já roteado pro comprador certo.
test('aba Compras: "Necessidades calculadas" é tabela (não nuvem de botões), com botão "Enviar pedido" por linha', async () => {
  const { win } = await montarAmbiente([
    { cod: '200', nome: 'Especiaria do Fornecedor', metaCoberturaDias: 10, fornecedorPadrao: 'Fornecedor Y' },
  ]);
  win.pcpIrParaAba('compras');
  const html = win.document.getElementById('page-pcp-central').innerHTML;
  assert.match(html, /<table[^>]*>[\s\S]*Necessidade \(cx\)[\s\S]*<\/table>/, 'tabela com coluna Necessidade');
  assert.match(html, /data-pcp-nec-enviar="/, 'botão de enviar pedido direto por linha');
  assert.match(html, /data-pcp-nec-enviar-todos/, 'botão de enviar todos em lote');
});

test('enviarNecessidadeDireto: cria a requisição direto (sem modal), já roteada pro comprador da regra', async () => {
  const { win, colReq } = await montarAmbiente(
    [{ cod: '200', nome: 'Especiaria do Fornecedor', metaCoberturaDias: 10, fornecedorPadrao: 'Fornecedor Y' }],
    { regras: [{ tipo: 'fornecedor', valor: 'Fornecedor Y', compradorUid: 'u1', compradorNome: 'Fulano' }] },
  );
  win.pcpIrParaAba('compras');
  const item = win._pcpInternals.construirVisao().find(x => x.key === '200');
  await win._pcpInternals.enviarNecessidadeDireto(item.key);
  assert.equal(colReq._registro.size, 1);
  const salvo = [...colReq._registro.values()][0];
  assert.equal(salvo.compradorUid, 'u1', 'roteado automaticamente pela regra, sem precisar escolher comprador');
  assert.equal(salvo.status, 'solicitada');
  assert.equal(salvo.motivo, 'Estoque insuficiente / saldo projetado negativo');
  assert.equal(salvo.quantidade, Math.ceil(item.necessidade));
});

test('enviarTodasNecessidades: envia todo mundo com necessidade de compra de uma vez, pulando produzido internamente', async () => {
  const { win, colReq } = await montarAmbiente(
    [
      { cod: '200', nome: 'Especiaria do Fornecedor', metaCoberturaDias: 10, fornecedorPadrao: 'Fornecedor Y' },
      { cod: '300', nome: 'Outra Especiaria', metaCoberturaDias: 10, fornecedorPadrao: 'Fornecedor Z' },
      { cod: '100', nome: 'Farinha Própria', metaCoberturaDias: 10, empresaProdutoraId: 'lojaFilial' },
    ],
    { regras: [{ tipo: 'fornecedor', valor: 'Fornecedor Y', compradorUid: 'u1' }] },
  );
  win.pcpIrParaAba('compras');
  await win._pcpInternals.enviarTodasNecessidades();
  assert.equal(colReq._registro.size, 2, 'só os 2 comprados de fornecedor, não o produzido internamente');
});

// PEDIDO AO VIVO (2026-09-02): "tem produto que tá cadastrado na produção
// que ainda aparece na tela de necessidade de compra" — na prática quase
// ninguém preenche o campo opcional "empresa produtora"; o produto cadastrado
// em Produção › Cadastro de Produtos SEMPRE grava a máquina (pftSalvar em
// 60-producao-ficha-tecnica.js), então isso sozinho já deve bastar pra
// excluir o produto das necessidades de compra, mesmo sem empresaProdutoraId.
test('aba Compras: produto SEM empresa produtora mas COM máquina cadastrada (típico de quem esqueceu de preencher "empresa produtora") também não aparece como necessidade de compra', async () => {
  const { win } = await montarAmbiente([
    { cod: '100', nome: 'Milho Pipoca da Terrinha', metaCoberturaDias: 10, maquina: 'ALFATECK 16' },
    { cod: '200', nome: 'Especiaria do Fornecedor', metaCoberturaDias: 10, fornecedorPadrao: 'Fornecedor Y' },
  ]);
  win.pcpIrParaAba('compras');
  const html = win.document.getElementById('page-pcp-central').innerHTML;
  assert.doesNotMatch(html, /Milho Pipoca da Terrinha/, 'ter máquina cadastrada já prova que é produzido internamente, mesmo sem empresaProdutoraId preenchido');
  assert.match(html, /Especiaria do Fornecedor/, 'sem empresa produtora nem máquina, continua aparecendo pra comprar');
});

test('aba Produção (Sugestões de produção): só mostra produto COM empresa produtora cadastrada', async () => {
  const { win } = await montarAmbiente([
    { cod: '100', nome: 'Farinha Própria', metaCoberturaDias: 10, empresaProdutoraId: 'lojaFilial', empresaProdutoraNome: 'Filial' },
    { cod: '200', nome: 'Especiaria do Fornecedor', metaCoberturaDias: 10, fornecedorPadrao: 'Fornecedor Y' },
  ]);
  win.pcpIrParaAba('producao');
  const html = win.document.getElementById('page-pcp-central').innerHTML;
  assert.match(html, /Farinha Própria/, 'produzido pela própria empresa aparece como sugestão de produção');
  assert.doesNotMatch(html, /Especiaria do Fornecedor/, 'produto de fornecedor não pode virar sugestão de produção');
});
