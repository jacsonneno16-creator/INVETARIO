const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const code=fs.readFileSync(path.join(__dirname,'../js/analista/78-pcp-central.js'),'utf8');

function load(){
  const document={addEventListener(){},getElementById(){return null;},querySelectorAll(){return [];}};
  const window={};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Map,Set,Promise,setTimeout,clearTimeout});
  return window;
}

function item(overrides={}){
  return {
    key:'P1',produto:'Produto 1',estoqueDisponivel:0,estoqueAlvo:100,estoqueSeguranca:20,estoqueMinimo:0,
    consumoDia:10,coberturaDias:0,necessidade:0,
    ...overrides
  };
}

test('transferência usa apenas sobra física acima da reserva da loja de origem',()=>{
  const w=load();
  const visoes=[
    {lojaId:'M',lojaNome:'Matriz',itens:[item({estoqueDisponivel:170,estoqueAlvo:100,coberturaDias:17})]},
    {lojaId:'F',lojaNome:'Filial',itens:[item({estoqueDisponivel:20,estoqueAlvo:120,necessidade:100,coberturaDias:2})]}
  ];
  const r=w._pcpInternals._alocarTransferencias(visoes,()=>false);
  assert.equal(r.length,1);
  assert.equal(r[0].origemLojaId,'M');
  assert.equal(r[0].destinoLojaId,'F');
  assert.equal(r[0].quantidade,70,'origem mantém 100 cx de estoque-alvo');
  assert.equal(r[0].necessidadeRestante,30);
});

test('não transfere quando origem ficaria abaixo do alvo/segurança/mínimo',()=>{
  const w=load();
  const visoes=[
    {lojaId:'M',lojaNome:'Matriz',itens:[item({estoqueDisponivel:100,estoqueAlvo:100,coberturaDias:10})]},
    {lojaId:'F',lojaNome:'Filial',itens:[item({estoqueDisponivel:0,estoqueAlvo:100,necessidade:100,coberturaDias:0})]}
  ];
  assert.equal(w._pcpInternals._alocarTransferencias(visoes,()=>false).length,0);
});

test('não sugere transferência de item tratado como produzido internamente nesta fase',()=>{
  const w=load();
  const visoes=[
    {lojaId:'M',lojaNome:'Matriz',itens:[item({estoqueDisponivel:300,estoqueAlvo:100})]},
    {lojaId:'F',lojaNome:'Filial',itens:[item({necessidade:100})]}
  ];
  assert.equal(w._pcpInternals._alocarTransferencias(visoes,key=>key==='P1').length,0);
});

// PEDIDO AO VIVO (2026-10-01): "quero saber quantos dias negativos fica
// com o saldo negativo... em todo lugar que mostre cobertura de estoque"
// — coberturaOrigem/coberturaDestino copiavam fonte.item.coberturaDias/
// dest.item.coberturaDias direto, que vêm floorados em 0 (construirVisao).
// Agora recalcula sem esse piso.
test('coberturaOrigem/coberturaDestino na sugestão de transferência mostram o valor recalculado, não o coberturaDias floorado em 0',()=>{
  const w=load();
  const visoes=[
    {lojaId:'M',lojaNome:'Matriz',itens:[item({estoqueDisponivel:170,estoqueAlvo:100,consumoDia:10,coberturaDias:0})]},
    {lojaId:'F',lojaNome:'Filial',itens:[item({estoqueDisponivel:-20,estoqueAlvo:120,necessidade:100,consumoDia:10,coberturaDias:0})]}
  ];
  const r=w._pcpInternals._alocarTransferencias(visoes,()=>false);
  assert.equal(r.length,1);
  assert.equal(r[0].coberturaOrigem,17,'recalcula 170/10=17, não usa o coberturaDias floorado(0) passado no item');
  assert.equal(r[0].coberturaDestino,-2,'recalcula -20/10=-2 (negativo de verdade), não usa o coberturaDias floorado(0)');
});

test('motor de transferência não possui leitura própria de Firestore',()=>{
  const ini=code.indexOf('function calcularSugestoesTransferencia');
  const fim=code.indexOf('// dados-insumos.json',ini);
  const trecho=code.slice(ini,fim);
  assert.doesNotMatch(trecho,/\.collection\s*\(|getDTFirestore|getDTRawFirestore/);
  assert.match(trecho,/usarConsumoBi:false/,'estoque pode vir do BI já carregado sem substituir demanda por loja');
});
