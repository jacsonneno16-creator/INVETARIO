const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const pcp360Code=fs.readFileSync(path.join(base,'86-pcp-produto-360.js'),'utf8');
const pcp360=pcp360Code;
const acompanhamento=fs.readFileSync(path.join(base,'84-pcp-compras-acompanhamento.js'),'utf8');
const pcpCentral=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');

test('Produto 360° reaproveita construirVisao/memoriaDeCalculo/timeline (só busca ficha técnica direto, pra seção de Insumos)',()=>{
  assert.match(pcp360,/global\._pcpInternals\.carregar/);
  assert.match(pcp360,/internos\.construirVisao\(\{/);
  assert.match(pcp360,/internos\.memoriaDeCalculo\(item\)/);
  assert.match(pcp360,/_pcpTimelineInternals\?\.construirLinhaDoTempo/);
  assert.match(pcp360,/pcpRegistrarPagina\?\.\('produto-360'/);
  assert.match(pcp360,/producao_ficha_tecnica/);
  assert.match(pcp360,/_garantirCatalogosSolicitacao\?\.\('insumos'\)/,'Produto 360 carrega a mesma fonte de insumos sob demanda, sem exigir abrir a aba antes');
  assert.match(pcp360,/produzidoInternamente/);
  assert.match(pcp360,/🏭 Produção/);
  assert.match(pcp360,/Próxima produção sugerida/);
});

// PEDIDO AO VIVO (2026-09-02): "quando eu clico em ver relatório de
// produto, tem que trazer as informações de insumos que ele usa".
test('_buscarInsumosDoProduto: cruza a ficha técnica do produto com a lista de insumos do BI (por nome normalizado)',async()=>{
  const document={addEventListener:()=>{}};
  const window={
    _pcpInternals:{norm:v=>String(v||'').trim().toLowerCase(),getInsumosBi:()=>[{produto:'BOBINA FLOCAO MILHO DA TERRINHA 800 G',estoque:64.8,unidade:'kg',coberturaDias:5.2}]},
    getDTFirestore:()=>({collection:col=>{
      assert.equal(col,'producao_ficha_tecnica');
      return {get:async()=>({docs:[{data:()=>({cod:'304',insumos:[{insumo:'Bobina Flocao Milho da Terrinha 800 g',qty:0.05},{insumo:'Insumo sem correspondência no BI',qty:1}]})}]})};
    }}),
  };
  vm.runInNewContext(pcp360Code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Promise});
  const lista=await window._pcp360Internals._buscarInsumosDoProduto('304');
  assert.equal(lista.length,2);
  const comBi=lista.find(x=>x.insumo.includes('Bobina'));
  assert.equal(comBi.bi.estoque,64.8,'casou por nome normalizado (maiúscula/minúscula não importa)');
  const semBi=lista.find(x=>x.insumo.includes('sem correspondência'));
  assert.equal(semBi.bi,null,'insumo sem match no BI não quebra, só fica sem estoque/cobertura');
});

test('_buscarInsumosDoProduto também casa nomes com prefixo MP/pontuação diferente',async()=>{
  const document={addEventListener:()=>{}};
  const window={
    _pcpInternals:{norm:v=>String(v||'').trim().toLowerCase(),getInsumosBi:()=>[{produto:'CANJICA BRANCA KG',estoque:2106.7,unidade:'kg',coberturaDias:77}]},
    getDTFirestore:()=>({collection:()=>({get:async()=>({docs:[{data:()=>({cod:'8005',insumos:[{insumo:'MP - CANJICA BRANCA KG',qty:4.88}]})}]})})})
  };
  vm.runInNewContext(pcp360Code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Promise});
  const lista=await window._pcp360Internals._buscarInsumosDoProduto('8005');
  assert.equal(lista[0].bi.estoque,2106.7);
  assert.equal(lista[0].bi.coberturaDias,77);
});


test('_buscarInsumosDoProduto prioriza o código Bluesoft da ficha técnica antes do nome',async()=>{
  const document={addEventListener:()=>{}};
  const window={
    _pcpInternals:{
      norm:v=>String(v||'').trim().toLowerCase(),
      getInsumosBi:()=>[{cod:'42079',produto:'MP - CANJICA BRANCA KG',estoque:3567,unidade:'kg',coberturaDias:3.3}]
    },
    getDTFirestore:()=>({collection:()=>({get:async()=>({docs:[{data:()=>({cod:'8005',insumos:[{insumo:'NOME DIFERENTE DA BASE',bluesoftProdutoKey:'42079',qty:4.88}]})}]})})})
  };
  vm.runInNewContext(pcp360Code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise});
  const lista=await window._pcp360Internals._buscarInsumosDoProduto('8005');
  assert.equal(lista[0].cod,'42079');
  assert.equal(lista[0].bi.estoque,3567,'o estoque é localizado pelo código mesmo quando o nome diverge');
});

test('_buscarInsumosDoProduto usa a base bruta consolidada e não depende do filtro visual da aba Insumos',async()=>{
  const document={addEventListener:()=>{}};
  const bruto={produtos:[
    {sku:'81281',produto:'BOBINA CANJICA BRANCA PREMIUM DA TERRINHA 400 G',loja:'14',estoque:10,projecaoBom:20},
    {sku:'81281',produto:'BOBINA CANJICA BRANCA PREMIUM DA TERRINHA 400 G',loja:'11',estoque:15,projecaoBom:10}
  ]};
  const window={
    _pcpInternals:{
      norm:v=>String(v||'').trim().toLowerCase(),
      // Simula a aba Insumos filtrada em outra loja, sem o material necessário.
      getInsumosBi:()=>[],
      getInsumosBiRaw:()=>bruto,
      _juntarInsumosBi:(raw)=>[{cod:'81281',produto:'BOBINA CANJICA BRANCA PREMIUM DA TERRINHA 400 G',estoque:25,unidade:'kg',coberturaDias:25}]
    },
    getDTFirestore:()=>({collection:()=>({get:async()=>({docs:[{data:()=>({cod:'8005',insumos:[{insumo:'BOBINA CANJICA BRANCA PREMIUM DA TERRINHA 400 G',bluesoftProdutoKey:'81281',qty:0.072}]})}]})})})
  };
  vm.runInNewContext(pcp360Code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise});
  const lista=await window._pcp360Internals._buscarInsumosDoProduto('8005');
  assert.equal(lista[0].bi.estoque,25,'o 360 usa o consolidado da origem bruta, não a lista filtrada da tela');
});

test('Compras/Necessidades e as tabelas do PCP têm drill-down pro Produto 360°',()=>{
  assert.match(pcpCentral,/data-pcp-360="\$\{esc\(x\.key\)\}"/);
  assert.match(acompanhamento,/data-pcp-360=/);
});

test('Acompanhamento de Compras cobre todos os filtros pedidos (produto/categoria/fornecedor/status/prioridade/período/comprador/atrasadas/críticas)',()=>{
  for(const id of ['pcpca-f-produto','pcpca-f-categoria','pcpca-f-fornecedor','pcpca-f-status','pcpca-f-prioridade','pcpca-f-comprador','pcpca-f-de','pcpca-f-ate','pcpca-f-atrasadas','pcpca-f-criticas']){
    assert.match(acompanhamento,new RegExp(id));
  }
  assert.match(acompanhamento,/pcpRegistrarPagina\?\.\('compras-acompanhamento'/);
});

test('PCP · Compras/Necessidades mostra solicitado × comprado × saldo pendente',()=>{
  assert.match(pcpCentral,/solicitado-comprado/);
  assert.match(pcpCentral,/Saldo pendente/);
});

test('Acompanhamento e Produto 360 permanecem carregados para drill-down, mas histórico não duplica o menu do PCP',()=>{
  assert.match(htmlCode,/id="page-pcp-compras-acompanhamento"/);
  assert.match(htmlCode,/id="page-pcp-produto-360"/);
  assert.doesNotMatch(htmlCode,/id="nav-pcp-compras-acompanhamento"/);
  assert.match(htmlCode,/84-pcp-compras-acompanhamento\.js/);
  assert.match(htmlCode,/86-pcp-produto-360\.js/);
});

// PEDIDO AO VIVO (2026-10-01): "quero saber quantos dias negativos fica
// com o saldo negativo... em todo lugar que mostre cobertura de estoque"
// — item.coberturaDias vem floorado em 0 (construirVisao), de propósito,
// pra classificação de risco; o card "Cobertura atual" do Produto 360°
// recalcula agora sem esse piso.
test('Produto 360°: "Cobertura atual" mostra o valor negativo de verdade (estoqueDisponivel/consumoDia), não "0.0d"',async()=>{
  const log=[];
  const fakeEl={set innerHTML(v){log.push(v);},get innerHTML(){return log[log.length-1]||'';},classList:{add(){},remove(){}}};
  const document={addEventListener:()=>{},querySelectorAll:()=>[],getElementById:id=>id==='page-pcp-produto-360'?fakeEl:null};
  const item={key:'P1',cod:'70243',produto:'Alho Triturado Okker',estoqueAtual:-144,estoqueDisponivel:-344,estoqueComprometido:200,entradasPrevistas:0,producaoProgramada:0,saldo:-344,consumoDia:32,diasAlvo:30,necessidade:0,estoqueSeguranca:0,quantidadeSugerida:0,planoEscadinha:null,coberturaDias:0,coberturaProjetadaDias:0};
  const window={
    pcpRegistrarPagina:()=>{},
    _pcpInternals:{
      carregar:async()=>{},
      construirVisao:()=>[item],
      getEstoqueBi:()=>null,
      getFiltros:()=>({}),
      resolverCadastroProduto:()=>({}),
      getProjecao:()=>[],
      keyOf:x=>String(x.cod||x.prodKey||''),
      produzidoInternamenteNaLoja:()=>false,
      produzidoInternamente:()=>false,
      getReqs:()=>[],
      getInsumosBi:()=>[],
      memoriaDeCalculo:()=>[],
      metaProduto:()=>({categoria:''}),
    },
    getDTLojaAtiva:()=>'',
    getDTFirestore:()=>({collection:()=>({get:async()=>({docs:[]})})}),
  };
  vm.runInNewContext(pcp360Code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise});
  await window.abrirProduto360('P1');
  const html=log[log.length-1];
  assert.match(html,/Cobertura atual[\s\S]*?-10\.8d/,'recalcula -344/32 ≈ -10.8 dias, não "0.0d"');
  assert.doesNotMatch(html,/Cobertura atual[\s\S]{0,80}0\.0d/,'nunca mostra "0.0d" pra saldo negativo');
});
