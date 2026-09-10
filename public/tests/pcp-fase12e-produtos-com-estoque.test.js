const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');

function mockConfigDoc(){return {exists:true,data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30})};}
function mockRawFirestore(loja){
  return {
    collection:(nome)=>{
      if(nome==='lojas') return {doc:()=>({get:async()=>({exists:true,data:()=>loja}),collection:()=>({doc:()=>({get:async()=>({exists:false})})})})};
      if(nome==='dt_config') return {doc:()=>({get:async()=>mockConfigDoc()})};
      return {doc:()=>({get:async()=>({exists:false})})};
    },
    batch:()=>({set:()=>{},commit:async()=>{}}),
  };
}
function loadServico(fetchMock,loja,firestoreMock){
  const document={addEventListener:()=>{}};
  const window={
    fetch:fetchMock,
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'idtoken'}})},
    getDTRawFirestore:()=>mockRawFirestore(loja),
    getDTFirestore:()=>firestoreMock||({collection:()=>({get:async()=>({docs:[]}),doc:()=>({id:'novo'})})}),
    getDTLojaAtiva:()=>'loja1',
  };
  vm.runInNewContext(servicoCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON,AbortController,setTimeout,clearTimeout},{filename:'90-bluesoft-service.js'});
  return window;
}

// PEDIDO AO VIVO (2026-08-23): "não precisa buscar vários milhares de
// SKUs, só buscar o que tem estoque" — sincronizarProdutosBluesoft() foi
// invertida: busca o ESTOQUE primeiro (já filtrado por _estoqueRelevante)
// e só faz lookup de catálogo (nome/tipo/GTIN) PRODUTO A PRODUTO, um por
// produtoKey, só pra quem tem estoque relevante — nunca mais varre o
// catálogo inteiro por tipo. O mock abaixo filtra de verdade por
// produtoKey (como a Bluesoft real faria) pra provar que o lookup
// targetado busca exatamente o item certo, não só "a primeira página".
test('sincronizarProdutosBluesoft busca estoque primeiro e só traz catálogo de quem tem estoque real — catálogo "ATIVO" sozinho não basta',async()=>{
  const catalogo=[
    {produtoKey:1,descricao:'Pão Francês',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}},
    {produtoKey:2,descricao:'Saco Plástico',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}},
    {produtoKey:3,descricao:'Bolo de Fubá',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}},
  ];
  const catalogoPorKey=new Map(catalogo.map(p=>[String(p.produtoKey),p]));
  // `_obterProdutoEmbalagemVenda` (resolução de embalagem/caixa) pode fazer
  // uma 2ª chamada em /api/comercial/produtos/{key}/caixas quando o produto
  // não tem fator de caixa definido — mesmo prefixo de URL, então contamos
  // só os lookups que TÊM query param produtoKey (a chamada de catálogo em
  // si), não qualquer chamada que comece com /api/comercial/produtos.
  const produtoKeysConsultados=[];
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    if(body.path.startsWith('/api/comercial/produtos') && qs.has('produtoKey')){
      const produtoKey=qs.get('produtoKey');
      produtoKeysConsultados.push(produtoKey);
      const item=catalogoPorKey.get(produtoKey);
      return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:item?[item]:[]})};
    }
    if(body.path.startsWith('/api/comercial/estoques')){
      const page=Number(qs.get('currentPage'));
      const data=page===0?[{produtoKey:1,saldoFisico:40},{produtoKey:3,saldoFisico:0}]:[];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const escritos=[];
  const firestoreMock={
    collection:(nome)=>{
      if(nome==='producao_produtos') return {get:async()=>({docs:[]}),doc:()=>({id:'novo',set:(p)=>escritos.push(p)})};
      return {get:async()=>({docs:[]})};
    },
  };
  const loja={nome:'Loja 1',bluesoft_loja_key:'LK1'};
  const w=loadServico(fetchMock,loja,firestoreMock);
  const r=await w.sincronizarProdutosBluesoft({tipos:['VENDA']});
  assert.deepEqual(produtoKeysConsultados,['1'],'só o produtoKey 1 (único com estoque relevante) pode gerar lookup de catálogo — produto 2 (sem estoque) e 3 (saldo zero, sem pedido pendente) nunca deveriam ser consultados');
  assert.equal(r.totalCatalogo,1,'agora reflete quantos produtos tinham estoque relevante, não o catálogo inteiro (que nunca mais é varrido por completo)');
  assert.equal(r.comEstoque,1);
  assert.equal(r.criados,1,'o único produto escrito precisa ser o do lookup targetado por produtoKey 1 — o mock só devolve item quando o produtoKey bate, então "criados:1" já prova que foi o item certo, não qualquer um da primeira página');
});

test('sincronizarProdutosBluesoft exige loja vinculada à Bluesoft antes de puxar catálogo',async()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}),{nome:'Loja sem vínculo'});
  await assert.rejects(()=>w.sincronizarProdutosBluesoft({tipos:['VENDA']}),/bluesoft_loja_key/);
});
