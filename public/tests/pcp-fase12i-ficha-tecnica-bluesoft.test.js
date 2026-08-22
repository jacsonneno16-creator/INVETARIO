const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');
const importacaoCode=fs.readFileSync(path.join(base,'76-producao-importacao.js'),'utf8');
const fichaCode=fs.readFileSync(path.join(base,'60-producao-ficha-tecnica.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

function mockRawFirestore(loja){
  return {
    collection:(nome)=>{
      if(nome==='lojas') return {doc:()=>({get:async()=>({exists:true,data:()=>loja})})};
      if(nome==='dt_config') return {doc:()=>({get:async()=>({exists:true,data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30})})})};
      return {doc:()=>({get:async()=>({exists:false})})};
    },
  };
}
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

test('sincronizarFichaTecnicaBluesoft busca ficha só de produto com estoque real, cadastra insumos e nunca sobrescreve ficha já editada manualmente',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/pcp/ficha-tecnica/')){
      // insumos de uma ficha específica
      const fichaKey=body.path.split('/')[4];
      const porFicha={
        '501':[{fichaTecnicaItemKey:1,produtoKey:900,descricao:'Farinha de Trigo',pesoBrutoQtd:2.5}],
      };
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?(porFicha[fichaKey]||[]):[]})};
    }
    if(body.path.startsWith('/api/pcp/ficha-tecnica')){
      // lista de fichas da loja
      const fichas=[
        {fichaTecnicaKey:501,produtoKey:1,descricao:'Pão Francês'}, // tem estoque, sem ficha local -> cria
        {fichaTecnicaKey:502,produtoKey:2,descricao:'Bolo de Fubá'}, // tem estoque, já tem ficha manual -> ignora
        {fichaTecnicaKey:503,produtoKey:3,descricao:'Item sem estoque'}, // sem estoque -> nem entra
      ];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?fichas:[]})};
    }
    if(body.path.startsWith('/api/comercial/estoques/ficha-estoque')) return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:[]})};
    if(body.path.startsWith('/api/comercial/estoques')){
      const data=page===0?[{produtoKey:1,saldoFisico:30},{produtoKey:2,saldoFisico:15}]:[]; // produtoKey 3 fora
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const producaoFichas=mockColecao([
    {id:'jaTemFicha',data:{cod:'2',desc:'Bolo de Fubá',insumos:[{insumo:'Açúcar',qty:1}]}}, // editada manualmente -> preservar
  ]);
  const producaoProdutos=mockColecao([
    {id:'p1',data:{cod:'1',bluesoftProdutoKey:1,nome:'Pão Francês'}},
  ]);
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},{producao_ficha_tecnica:producaoFichas,producao_produtos:producaoProdutos});
  const r=await w.sincronizarFichaTecnicaBluesoft({});
  assert.equal(r.totalFichas,2); // só produtoKey 1 e 2 (com estoque) — 3 fica de fora
  assert.equal(r.criadas,1);
  assert.equal(r.ignoradas,1);
  const criada=[...producaoFichas.registro.values()].find(f=>f.cod==='1');
  assert.ok(criada);
  assert.equal(criada.insumos.length,1);
  assert.equal(criada.insumos[0].insumo,'Farinha de Trigo');
  assert.equal(criada.insumos[0].qty,2.5);
  const preservada=producaoFichas.registro.get('jaTemFicha');
  assert.equal(preservada.insumos[0].insumo,'Açúcar'); // não foi sobrescrita
});

test('76 tem o botão de sincronizar ficha técnica (Bluesoft), ligado ao serviço novo',()=>{
  assert.match(importacaoCode,/data-pimp-bluesoft-ficha/);
  assert.match(importacaoCode,/global\.sincronizarFichaTecnicaBluesoft/);
});

test('60 (Produtos & Ficha Técnica) tem botão de apagar tudo, com confirmação digitada',()=>{
  assert.match(fichaCode,/data-pft-apagar-tudo/);
  assert.match(fichaCode,/pftApagarTudo/);
  assert.match(fichaCode,/APAGAR TUDO/);
});

test('Firestore permite producao-importacao:importar escrever ficha técnica só nos campos que a Bluesoft traz',()=>{
  const trecho=rules.slice(rules.indexOf('match /producao_ficha_tecnica/'), rules.indexOf('match /producao_ficha_tecnica/')+1500);
  assert.match(trecho,/hasPermission\('producao-importacao', 'importar'\)/);
  assert.match(trecho,/affectedKeys\(\)\.hasOnly\(\['cod','desc','insumos','bluesoftFichaTecnicaKey','bluesoftSincronizadoEm','atualizadoEm'\]\)/);
});
