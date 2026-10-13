'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const base=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(base,'js/analista/78-pcp-central.js'),'utf8');
const html=fs.readFileSync(path.join(base,'analista.html'),'utf8');

function internals(){
  const document={addEventListener:()=>{},getElementById:()=>null,querySelector:()=>null,activeElement:null};
  const window={document,temPermissao:()=>true,calcularProjecaoComRisco:()=>[],getParametrosProducaoProjecao:()=>({})};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,confirm:()=>true,prompt:()=>null,setTimeout,clearTimeout});
  return window._pcpInternals;
}

test('menu PCP fica enxuto e Insumos abre a aba real de materiais',()=>{
  for(const id of ['nav-pcp-dashboard','nav-pcp-planejamento','nav-pcp-insumos','nav-pcp-pedidos','nav-pcp-producao','nav-pcp-relatorios','nav-pcp-parametros']) assert.match(html,new RegExp(`id="${id}"`));
  for(const id of ['nav-pcp-compras','nav-pcp-alertas','nav-pcp-projecao-vendas','nav-pcp-timeline','nav-pcp-producao-insumo','nav-pcp-compras-acompanhamento','nav-pcp-agendamentos','nav-pcp-cortes','nav-pcp-cruzamento','nav-pcp-estoque']) assert.doesNotMatch(html,new RegExp(`id="${id}"`));
  assert.match(html,/id="nav-pcp-insumos" onclick="pcpIrParaAba\('insumos',this\)"/);
});

test('Solicitação por categoria lista matéria-prima/insumo e, em produto acabado, exclui item produzido internamente',()=>{
  const h=internals();
  h.setInsumosBi([
    {cod:'MP1',produto:'FARINHA X',grupo:'materia-prima',tipo:'FARINHA',estoque:100},
    {cod:'EMB1',produto:'CAIXA PAPELAO',grupo:'insumo',tipo:'EMBALAGEM',estoque:200},
  ]);
  h.setProdutos([
    {cod:'PA1',nome:'PRODUTO INTERNO',maquina:'M1',ativo:true},
    {cod:'PA2',nome:'PRODUTO COMPRADO',fornecedorPadrao:'Fornecedor',ativo:true},
  ]);
  assert.deepEqual(Array.from(h._loteCatalogoCategoria('materia-prima')).map(x=>x.produtoId),['MP1']);
  assert.deepEqual(Array.from(h._loteCatalogoCategoria('insumos')).map(x=>x.produtoId),['EMB1']);
  const acabados=Array.from(h._loteCatalogoCategoria('produto-acabado')).map(x=>x.produtoId);
  assert.ok(!acabados.includes('PA1'),'produto produzido internamente não pode aparecer em solicitação de compra');
  assert.ok(acabados.includes('PA2'),'produto acabado comprado continua disponível para solicitação');
});

test('Planejamento destaca somente o saldo em vermelho quando Estoque - Pedidos é negativo',()=>{
  const h=internals();
  const out=h.estoqueHtml([{key:'1',cod:'1',produto:'PRODUTO NEGATIVO',estoqueAtual:10,pendente:25,estoqueDisponivel:-15,coberturaDias:0,necessidade:30,leadTimeDias:5}]);
  assert.match(out,/PRODUTO NEGATIVO/);
  assert.match(out,/>-15<\/b>/);
  assert.equal((out.match(/background:#c0392b;color:#fff/g)||[]).length,1,'somente a célula de saldo recebe fundo vermelho');
  const trechoProduto=out.slice(out.indexOf('PRODUTO NEGATIVO')-120,out.indexOf('PRODUTO NEGATIVO')+80);
  assert.doesNotMatch(trechoProduto,/background:#c0392b/,'nome do produto não fica vermelho');
});

test('pesquisas de Planejamento e Insumos preservam foco entre letras',()=>{
  assert.match(code,/setTimeout\(\(\)=>_redesenharComFoco\('\[data-pcp-filtro="busca"\]'\),220\)/);
  assert.match(code,/setTimeout\(\(\)=>_redesenharComFoco\('\[data-pcp-ins-filtro="busca"\]'\),220\)/);
  assert.match(code,/novo\.focus\(\)/);
  assert.match(code,/setSelectionRange/);
});

test('reorganização não adiciona leitura Firestore nos novos catálogos nem no grid central',()=>{
  const trecho=code.slice(code.indexOf('async function _garantirCatalogosSolicitacao'),code.indexOf('function _loteSincronizarForm'));
  assert.doesNotMatch(trecho,/\.collection\(|getDTFirestore|getDTRawFirestore/);
  assert.match(trecho,/buscarInsumosBi\(\)|buscarEstoqueBi\(\)/,'catálogos reutilizam os carregadores BI já existentes');
});
