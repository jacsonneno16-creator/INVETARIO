const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');
const importacaoCode=fs.readFileSync(path.join(base,'76-producao-importacao.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

function mockRawFirestore(loja){
  return {
    collection:(nome)=>{
      if(nome==='lojas') return {doc:()=>({get:async()=>({exists:true,data:()=>loja}),collection:()=>({doc:()=>({get:async()=>({exists:false})})})})};
      if(nome==='dt_config') return {doc:()=>({get:async()=>({exists:true,data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30})})})};
      return {doc:()=>({get:async()=>({exists:false})})};
    },
  };
}
// Coleção mock que mantém estado real (respeitando id) — necessário aqui
// porque a reconciliação primeiro lê tudo, depois faz upsert/delete no MESMO
// mapa, e o teste precisa inspecionar o que sobrou no final.
function mockColecao(docsIniciais){
  const registro=new Map(docsIniciais.map(d=>[d.id,d.data]));
  let seq=0;
  const colecao={
    get: async()=>({size:registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data}))}),
    doc: (id)=>{
      const docId=id||('novo'+(seq++));
      return { id:docId, set:(payload)=>{ const atual=registro.get(docId)||{}; registro.set(docId,{...atual,...payload}); } };
    },
  };
  return {colecao,registro};
}
function loadServico(fetchMock,loja,colecoes){
  const document={addEventListener:()=>{}};
  const window={
    fetch:fetchMock,
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'idtoken'}})},
    getDTRawFirestore:()=>({ ...mockRawFirestore(loja), batch:()=>{
      const ops=[];
      return { set:(ref,payload)=>ops.push(()=>ref.set(payload)), delete:(ref)=>ops.push(()=>colecoes[ref._col]?.registro.delete(ref.id)), commit: async()=>{ ops.forEach(fn=>fn()); } };
    }}),
    getDTFirestore:()=>({ collection:(nome)=>{ const c=colecoes[nome]?.colecao||{get:async()=>({docs:[]}),doc:()=>({id:'novo',set:()=>{}})}; return { ...c, doc:(id)=>({...c.doc(id),_col:nome}) }; } }),
    getDTLojaAtiva:()=>'loja1',
  };
  vm.runInNewContext(servicoCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON,AbortController,setTimeout,clearTimeout},{filename:'90-bluesoft-service.js'});
  return window;
}

test('sincronizarProdutosBluesoft remove produto do MESMO tipo que sumiu do estoque, mas preserva o de outro tipo (fora do escopo) e o protegido por ficha técnica',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/comercial/produtos')){
      const tipo=qs.get('tipoProduto');
      const catalogo=tipo==='VENDA'?[{produtoKey:1,descricao:'Refrigerante Novo',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}}]:[];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?catalogo:[]})};
    }
    if(body.path.startsWith('/api/comercial/estoques')){
      const data=page===0?[{produtoKey:1,saldoFisico:30}]:[];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const producaoProdutos=mockColecao([
    {id:'sumiu',data:{cod:'99',bluesoftProdutoKey:99,bluesoftTipoProduto:'VENDA',nome:'Refri Antigo'}}, // mesmo tipo, sumiu do estoque -> remove
    {id:'outroTipo',data:{cod:'88',bluesoftProdutoKey:88,bluesoftTipoProduto:'PRODUTO_ACABADO',nome:'Pão'}}, // fora do escopo desta sync (só VENDA) -> preserva
    {id:'protegido',data:{cod:'77',bluesoftProdutoKey:77,bluesoftTipoProduto:'VENDA',nome:'Item com ficha',pc_min:5}}, // ficha técnica -> preserva
  ]);
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},{producao_produtos:producaoProdutos});
  const r=await w.sincronizarProdutosBluesoft({tipos:['VENDA']});
  assert.equal(r.removidos,1);
  assert.equal(producaoProdutos.registro.has('sumiu'),false);
  assert.equal(producaoProdutos.registro.has('outroTipo'),true);
  assert.equal(producaoProdutos.registro.has('protegido'),true);
});

test('sincronizarEstoqueBluesoft remove producao_projecao que perdeu a relevância, mas preserva o que tem projeção manual (venda_m1)',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/comercial/estoques/ficha-estoque')) return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:[]})};
    if(body.path.startsWith('/api/comercial/estoques')){
      const data=page===0?[{produtoKey:1,saldoFisico:20}]:[];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const producaoProjecao=mockColecao([
    {id:'sumiu',data:{cod:'2',bluesoftSincronizadoEm:'2026-08-01',estoqueAtual:0}}, // não veio mais -> remove
    {id:'manual',data:{cod:'3',bluesoftSincronizadoEm:'2026-08-01',estoqueAtual:0,venda_m1:10}}, // projeção manual -> preserva
  ]);
  const producaoProdutos=mockColecao([]);
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},{producao_projecao:producaoProjecao,producao_produtos:producaoProdutos});
  const r=await w.sincronizarEstoqueBluesoft({});
  assert.equal(r.removidos,1);
  assert.equal(producaoProjecao.registro.has('sumiu'),false);
  assert.equal(producaoProjecao.registro.has('manual'),true);
});

test('limparProdutosBluesoftIrrelevante (manual, todos os tipos) remove produto Bluesoft sem estoque real e preserva o protegido por ficha técnica',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/comercial/estoques/ficha-estoque')) return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:[]})};
    if(body.path.startsWith('/api/comercial/estoques')){
      const data=page===0?[{produtoKey:1,saldoFisico:5}]:[];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const producaoProdutos=mockColecao([
    {id:'temEstoque',data:{cod:'1',bluesoftProdutoKey:1}},
    {id:'semEstoque',data:{cod:'50',bluesoftProdutoKey:50}},
    {id:'protegido',data:{cod:'60',bluesoftProdutoKey:60,maquina:'Forno 1'}},
    {id:'manual',data:{cod:'X',nome:'Cadastrado à mão'}},
  ]);
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},{producao_produtos:producaoProdutos});
  const previa=await w.limparProdutosBluesoftIrrelevante(true);
  assert.equal(previa.total,4);
  assert.equal(previa.candidatos,1);
  const r=await w.limparProdutosBluesoftIrrelevante(false);
  assert.equal(r.removidos,1);
  assert.equal(producaoProdutos.registro.has('semEstoque'),false);
  assert.equal(producaoProdutos.registro.has('temEstoque'),true);
  assert.equal(producaoProdutos.registro.has('protegido'),true);
  assert.equal(producaoProdutos.registro.has('manual'),true);
});

test('Firestore rules permitem produção-importação apagar producao_produtos só quando o doc veio da Bluesoft',()=>{
  const trecho=rules.slice(rules.indexOf('match /producao_produtos/'), rules.indexOf('match /producao_produtos/')+3000);
  assert.match(trecho,/allow delete: if canAccessStore\(lojaId\) && \(/);
  assert.match(trecho,/resource\.data\.bluesoftProdutoKey != null/);
});

test('76 tem o botão de limpeza manual de produtos sem estoque (Bluesoft), com preview/confirmação',()=>{
  assert.match(importacaoCode,/data-pimp-limpar-bluesoft-produtos-ruido/);
  assert.match(importacaoCode,/global\.limparProdutosBluesoftIrrelevante\(true\)/);
  assert.match(importacaoCode,/confirm\(/);
  assert.match(importacaoCode,/global\.limparProdutosBluesoftIrrelevante\(false\)/);
});
