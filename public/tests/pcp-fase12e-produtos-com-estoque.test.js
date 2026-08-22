const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');

function mockConfigDoc(){return {exists:true,data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30})};}
function mockRawFirestore(loja){
  return {
    collection:(nome)=>{
      if(nome==='lojas') return {doc:()=>({get:async()=>({exists:true,data:()=>loja})})};
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

test('sincronizarProdutosBluesoft só grava produto que tem estoque real na loja — catálogo "ATIVO" sozinho não basta',async()=>{
  const catalogo=[
    {produtoKey:1,descricao:'Pão Francês',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}},
    {produtoKey:2,descricao:'Saco Plástico',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}},
    {produtoKey:3,descricao:'Bolo de Fubá',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}},
  ];
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    if(body.path.startsWith('/api/comercial/produtos')){
      const qs=new URLSearchParams(body.path.split('?')[1]||'');
      const page=Number(qs.get('currentPage'));
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?catalogo:[]})};
    }
    if(body.path.startsWith('/api/comercial/estoques')){
      const qs=new URLSearchParams(body.path.split('?')[1]||'');
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
  assert.equal(r.totalCatalogo,3);
  assert.equal(r.comEstoque,1);
  assert.equal(r.criados,1);
});

test('sincronizarProdutosBluesoft exige loja vinculada à Bluesoft antes de puxar catálogo',async()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}),{nome:'Loja sem vínculo'});
  await assert.rejects(()=>w.sincronizarProdutosBluesoft({tipos:['VENDA']}),/bluesoft_loja_key/);
});
