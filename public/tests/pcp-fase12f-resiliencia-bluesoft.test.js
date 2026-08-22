const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');

function mockRawFirestore(loja){
  return {
    collection:(nome)=>{
      if(nome==='lojas') return {doc:()=>({get:async()=>({exists:true,data:()=>loja})})};
      if(nome==='dt_config') return {doc:()=>({get:async()=>({exists:true,data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30})})})};
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

test('um tipo de produto falhando na Bluesoft (ex.: 500) não derruba os tipos que já vieram bem — falha fica registrada, não perdida',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const tipo=qs.get('tipoProduto')||'';
    const page=Number(qs.get('currentPage'));
    if(tipo==='PRODUTO_ACABADO') return {ok:false,status:500,text:async()=>JSON.stringify({erro:'Ocorreu um erro inesperado.'})};
    const catalogo={VENDA:[{produtoKey:1,descricao:'Refrigerante',status:'ATIVO'}]};
    return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?(catalogo[tipo]||[]):[]})};
  };
  const w=loadServico(fetchMock,{nome:'Loja 1'});
  const catalogo=await w.obterCatalogoBluesoft(true,{tipos:['VENDA','PRODUTO_ACABADO']});
  assert.equal(catalogo.length,1);
  assert.equal(catalogo[0].cod,'1');
  assert.equal(catalogo.falhas.length,1);
  assert.equal(catalogo.falhas[0].tipo,'PRODUTO_ACABADO');
  assert.match(catalogo.falhas[0].erro,/500/);
});

test('obterEstoqueBluesoft cai pra /api/comercial/estoques/ficha-estoque quando a rota rica volta vazia pra uma loja com produto ativo',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/comercial/estoques/ficha-estoque')){
      const data=page===0?[{produtokey:1,gtinprincipal:'789',quantidade:'12,50'}]:[];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data})};
    }
    if(body.path.startsWith('/api/comercial/estoques')){
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:[]})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const w=loadServico(fetchMock,{nome:'Loja 1'});
  const loja={nome:'Loja 1',bluesoft_loja_key:'LK1'};
  const r=await w.obterEstoqueBluesoft(loja,true,{incluirTodos:true});
  assert.equal(r.totalRecebido,1);
  assert.equal(r.rotaSimplificada,true);
  assert.equal(r.itens[0].estoqueAtual,12.5);
});

test('obterEstoqueBluesoft não usa o fallback quando a rota rica já devolveu itens normalmente',async()=>{
  let chamouFichaEstoque=false;
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/comercial/estoques/ficha-estoque')){ chamouFichaEstoque=true; return {ok:true,text:async()=>'{}'}; }
    if(body.path.startsWith('/api/comercial/estoques')){
      const data=page===0?[{produtoKey:1,saldoFisico:40}]:[];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const w=loadServico(fetchMock,{nome:'Loja 1'});
  const loja={nome:'Loja 1',bluesoft_loja_key:'LK1'};
  const r=await w.obterEstoqueBluesoft(loja,true,{incluirTodos:true});
  assert.equal(chamouFichaEstoque,false);
  assert.equal(r.rotaSimplificada,false);
  assert.equal(r.totalRecebido,1);
});
