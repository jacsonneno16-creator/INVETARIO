const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');
const importacaoCode=fs.readFileSync(path.join(base,'76-producao-importacao.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

// PEDIDO AO VIVO (etapa BlueSoft, diagnóstico de causa-raiz): _config() em
// 90-bluesoft-service.js busca PRIMEIRO em lojas/{id}/dt_config/
// integracao_api (config por loja) e só cai pro dt_config/integracao_api
// global se a de loja não existir. Este mock só simulava 2 níveis
// (collection→doc→get); a busca por loja fazia
// collection('lojas').doc(id).collection('dt_config')... e essa segunda
// .collection() não existia no objeto devolvido — TypeError, engolido
// pelo try/catch de _config(), resultando em config vazia e o erro "URL
// da BlueSoft não encontrada" em produção nenhuma real, só nos testes.
// Corrigido pra simular os 4 níveis de verdade (loja sem override →
// cai pro dt_config global, que é o que esses testes sempre quiseram
// testar).
function mockConfigFs(){
  return { collection:(nome)=>{
    if(nome==='lojas') return { doc:()=>({ get: async()=>({exists:false}), collection:()=>({ doc:()=>({ get: async()=>({exists:false}) }) }) }) };
    return { doc:()=>({ get: async()=>({ exists:true, data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30}) }) }) };
  } };
}
function mockFetchProdutosPorTipo(porTipo){
  return async (_url, opts) => {
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const tipo=qs.get('tipoProduto')||'';
    const page=Number(qs.get('currentPage'));
    const lista=porTipo[tipo]||[];
    const data=page===0?lista:[];
    return { ok:true, text: async()=>JSON.stringify({currentPage:page,pageSize:200,data}) };
  };
}
function loadServico(fetchMock,firestoreMock){
  const document={addEventListener:()=>{}};
  const window={
    fetch: fetchMock,
    firebase:{ auth:()=>({ currentUser:{ getIdToken: async()=>'idtoken' } }) },
    getDTRawFirestore:()=>mockConfigFs(),
    getDTFirestore:()=>firestoreMock||({ collection:()=>({ get: async()=>({docs:[]}) }) }),
    getDTLojaAtiva:()=>'loja1',
  };
  vm.runInNewContext(servicoCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON,AbortController,setTimeout,clearTimeout},{filename:'90-bluesoft-service.js'});
  return window;
}

test('_buscarProdutosPorTipos busca um tipo por vez (filtro real tipoProduto da Bluesoft) e deduplica por produtoKey',async()=>{
  const porTipo={
    PRODUTO_ACABADO:[{produtoKey:1,descricao:'Pão',status:'ATIVO',tipoProduto:{produtoAcabado:true}}],
    VENDA:[{produtoKey:1,descricao:'Pão',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}},{produtoKey:2,descricao:'Bolo',status:'ATIVO',tipoProduto:{mercadoriaParaRevenda:true}}],
  };
  const w=loadServico(mockFetchProdutosPorTipo(porTipo));
  const progresso=[];
  const catalogo=await w.obterCatalogoBluesoft(true,{tipos:['PRODUTO_ACABADO','VENDA'],onProgresso:n=>progresso.push(n)});
  assert.equal(catalogo.length,2);
  assert.ok(catalogo.some(p=>p.cod==='1'));
  assert.ok(catalogo.some(p=>p.cod==='2'));
  assert.ok(progresso.length>0);
});

test('obterCatalogoBluesoft usa PRODUTO_ACABADO+VENDA por padrão quando nenhum tipo é informado',async()=>{
  const porTipo={ PRODUTO_ACABADO:[{produtoKey:9,descricao:'X',status:'ATIVO'}], VENDA:[] };
  const w=loadServico(mockFetchProdutosPorTipo(porTipo));
  const catalogo=await w.obterCatalogoBluesoft(true);
  assert.equal(catalogo.length,1);
  assert.equal(catalogo[0].cod,'9');
});

test('sincronizarEstoqueBluesoft não busca o catálogo completo na Bluesoft de novo — usa producao_produtos já sincronizado',()=>{
  const trecho=servicoCode.slice(servicoCode.indexOf('async function sincronizarEstoqueBluesoft'),servicoCode.indexOf('global.sincronizarEstoqueBluesoft = sincronizarEstoqueBluesoft;'));
  assert.doesNotMatch(trecho,/obterCatalogoBluesoft/);
  assert.match(trecho,/collection\('producao_produtos'\)\.get\(\)/);
});

test('_paginarTudo chama onProgresso a cada rodada',async()=>{
  const w=loadServico(mockFetchProdutosPorTipo({PRODUTO_ACABADO:[{produtoKey:1,descricao:'A'}]}));
  const chamadas=[];
  await w._bluesoftServiceInternals._paginarTudo('/api/comercial/produtos',{status:'ATIVO',tipoProduto:'PRODUTO_ACABADO'},await w._bluesoftServiceInternals._config(),item=>item.produtoKey,n=>chamadas.push(n));
  assert.ok(chamadas.length>0);
  assert.equal(chamadas[chamadas.length-1],1);
});

test('sincronizarInsumosBluesoft só mantém insumo INSUMO ativo, usado em alguma ficha técnica e com estoque real',async()=>{
  const porTipo={
    INSUMO:[
      {produtoKey:101,descricao:'Farinha de Trigo',status:'ATIVO',tipoUnidadeMedida:{descricao:'KG'}},
      {produtoKey:102,descricao:'Copo Descartável',status:'ATIVO',tipoUnidadeMedida:{descricao:'UN'}}, // não usado em nenhuma ficha
      {produtoKey:103,descricao:'Fermento',status:'ATIVO',tipoUnidadeMedida:{descricao:'KG'}}, // usado mas sem estoque
    ],
  };
  const fetchMock=async (_url,opts)=>{
    const body=JSON.parse(opts.body);
    if(body.path.startsWith('/api/comercial/produtos')) return mockFetchProdutosPorTipo(porTipo)(_url,opts);
    if(body.path.startsWith('/api/comercial/estoques')){
      const qs=new URLSearchParams(body.path.split('?')[1]||'');
      const page=Number(qs.get('currentPage'));
      const data=page===0?[{produtoKey:101,saldoFisico:40},{produtoKey:103,saldoFisico:0}]:[];
      return { ok:true, text: async()=>JSON.stringify({currentPage:page,pageSize:200,data}) };
    }
    return { ok:true, text: async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]}) };
  };
  const fichaDocs=[{ id:'f1', data:()=>({ insumos:[{insumo:'Farinha de Trigo',qty:2},{insumo:'Fermento',qty:0.1}] }) }];
  const insumosEstoqueEscritos=[];
  const firestoreMock={
    collection:(nome)=>{
      if(nome==='producao_ficha_tecnica') return { get: async()=>({docs:fichaDocs}) };
      if(nome==='producao_insumos_estoque') return { get: async()=>({docs:[]}), doc:()=>({ id:'novo' }) };
      return { get: async()=>({docs:[]}) };
    },
  };
  const w=loadServico(fetchMock,firestoreMock);
  // sobrescreve raw() indiretamente via getDTRawFirestore pra também servir batch/lojas
  const lojaDoc={ exists:true, data:()=>({ nome:'Loja 1', bluesoft_loja_key:'LK1' }) };
  const originalRaw=w.getDTRawFirestore;
  w.getDTRawFirestore=()=>({
    collection:(nome)=>{
      if(nome==='lojas') return { doc:()=>({ get: async()=>lojaDoc, collection:()=>({ doc:()=>({ get: async()=>({exists:false}) }) }) }) };
      if(nome==='dt_config') return { doc:()=>({ get: async()=>({exists:true,data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30})}) }) };
      return { doc:()=>({ get: async()=>({exists:false}) }) };
    },
    batch:()=>({ set:()=>{}, commit: async()=>{} }),
  });
  const r=await w.sincronizarInsumosBluesoft();
  assert.equal(r.totalCatalogo,3);
  assert.equal(r.utilizados,2); // Farinha e Fermento (Copo descartável fica de fora)
  assert.equal(r.comEstoque,1); // só Farinha tem saldoFisico>0
});

// PEDIDO AO VIVO (2026-08-27): "tira tudo da bluesoft" — produto/insumo já
// vêm sozinhos do SharePoint (sincronizarBiAgendado em functions/index.js),
// então os botões de buscar produto/insumo via Bluesoft foram removidos de
// 76. sincronizarProdutosBluesoft/sincronizarInsumosBluesoft
// (90-bluesoft-service.js) continuam existindo e testadas — só não tem
// mais botão nesta tela que as chame.
test('76 NÃO tem mais seleção de tipos de produto nem botão de insumos (Bluesoft) — produto/insumo já vêm do SharePoint',()=>{
  assert.doesNotMatch(importacaoCode,/pimp-bluesoft-tipo/);
  assert.doesNotMatch(importacaoCode,/TIPOS_PRODUTO_BLUESOFT/);
  assert.doesNotMatch(importacaoCode,/data-pimp-bluesoft-insumos/);
  assert.doesNotMatch(importacaoCode,/global\.sincronizarInsumosBluesoft/);
});

test('Firestore permite gravar producao_insumos_estoque também via producao-importacao:importar',()=>{
  assert.match(rules,/match \/producao_insumos_estoque/);
  const trecho=rules.slice(rules.indexOf('match /producao_insumos_estoque'));
  assert.match(trecho.slice(0,400),/hasPermission\('producao-importacao', 'importar'\)/);
});
