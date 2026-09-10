const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const insumosCode=fs.readFileSync(path.join(base,'65-producao-insumos.js'),'utf8');
const pageCode=fs.readFileSync(path.join(base,'85-pcp-producao-insumos.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');

function load(){
  const document={addEventListener:()=>{}};
  const window={};
  vm.runInNewContext(insumosCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map});
  return window;
}

test('calcularNecessidadeInsumosPorOPs soma o BOM das OPs no intervalo de datas, descontando o realizado e ignorando concluídas/fora do período',()=>{
  const w=load();
  const registros=[
    {_firestoreId:'op1',prodCod:'X',produto:'Produto X',maquina:'M1',data:'2026-08-15',qntCaixas:100,realizadoCaixas:20,status:'pendente'},
    {_firestoreId:'op2',prodCod:'X',produto:'Produto X',data:'2026-08-20',qntCaixas:50,realizadoCaixas:0,status:'concluido'},
    {_firestoreId:'op3',prodCod:'Y',produto:'Produto Y',data:'2026-09-01',qntCaixas:10,realizadoCaixas:0,status:'pendente'},
  ];
  const fichas=[{cod:'X',insumos:[{insumo:'Farinha',qty:2,categoria:'Insumos'}]},{cod:'Y',insumos:[{insumo:'Acucar',qty:1,categoria:'Insumos'}]}];
  const r=w.calcularNecessidadeInsumosPorOPs(registros,fichas,'2026-08-01','2026-08-31');
  assert.equal(r.porOP.length,1);
  assert.equal(r.porOP[0].registroId,'op1');
  assert.equal(r.porOP[0].qntCaixas,80);
  assert.equal(r.porInsumo.length,1);
  assert.equal(r.porInsumo[0].insumo,'Farinha');
  assert.equal(r.porInsumo[0].necessidade,160);
});

test('PCP tem tela de Insumos da Produção ligada ao MRP existente e gera requisição marcada como insumo',()=>{
  assert.match(insumosCode,/global\.calcularNecessidadeInsumosPorOPs\s*=\s*calcularNecessidadeInsumosPorOPs/);
  assert.match(pageCode,/calcularNecessidadeInsumosPorOPs/);
  assert.match(pageCode,/tipoSolicitacao:\s*'insumo'/);
  assert.match(pageCode,/data-pcppi-gerar/);
  assert.match(pageCode,/pcpRegistrarPagina\?\.\('producao-insumo'/);
  assert.match(htmlCode,/id="page-pcp-producao-insumo"/);
  assert.match(htmlCode,/85-pcp-producao-insumos\.js/);
});

// PEDIDO AO VIVO (2026-09-04): "os insumos não tá atualizando certo" —
// calcularNecessidadeInsumosPorOPs jogava fora o código do insumo (só
// devolvia o nome), forçando quem consome o resultado (85-pcp-producao-
// insumos.js) a casar por nome normalizado — frágil o bastante pra deixar
// insumos reais de fora do cruzamento com o BI.
test('calcularNecessidadeInsumosPorOPs: carrega o código do insumo (bluesoftProdutoKey da ficha) adiante, tanto no agregado por insumo quanto por OP',()=>{
  const w=load();
  const registros=[{_firestoreId:'op1',prodCod:'X',produto:'Produto X',data:'2026-08-15',qntCaixas:100,realizadoCaixas:0,status:'pendente'}];
  const fichas=[{cod:'X',insumos:[{insumo:'Farinha',bluesoftProdutoKey:'79782',qty:2,categoria:'Insumos'}]}];
  const r=w.calcularNecessidadeInsumosPorOPs(registros,fichas,'2026-08-01','2026-08-31');
  assert.equal(r.porInsumo[0].cod,'79782');
  assert.equal(r.porOP[0].insumos[0].cod,'79782');
});
test('calcularNecessidadeInsumosPorOPs: insumo sem código cadastrado na ficha não quebra, só fica com cod vazio (fallback pro nome continua funcionando)',()=>{
  const w=load();
  const registros=[{_firestoreId:'op1',prodCod:'X',produto:'Produto X',data:'2026-08-15',qntCaixas:10,realizadoCaixas:0,status:'pendente'}];
  const fichas=[{cod:'X',insumos:[{insumo:'Sem código',qty:1,categoria:'Insumos'}]}];
  const r=w.calcularNecessidadeInsumosPorOPs(registros,fichas,'2026-08-01','2026-08-31');
  assert.equal(r.porInsumo[0].cod,'');
});

// BUG AO VIVO REAL (2026-09-04): comparado com dados-insumos.json (BI),
// producao_insumos_estoque (Firestore, alimentado só por um sync direto da
// Bluesoft que raramente roda) mostrava "0 disponível" pra insumo com
// estoque real de dezenas de milhares de kg. Corrigido: 85-pcp-producao-
// insumos.js passa a casar contra o mesmo _insumosBi que a aba Insumos
// (78-pcp-central.js) já usa, primeiro por código, com nome como último
// recurso.
function loadPagina({registros,fichas,insumosBi}={}){
  const window={
    console,
    temPermissao:()=>true,
    DTBiPastaLocal:{ suportado:()=>false },
    getDTFirestore:()=>({ collection:()=>({ add:async()=>{} }) }),
  };
  const document={ addEventListener:()=>{}, getElementById:()=>({ innerHTML:'' }) };
  window.document=document;
  window.window=window;
  vm.createContext(window);
  // Carrega o código REAL de 65 primeiro (dá o calcularNecessidadeInsumosPorOPs
  // de verdade, com o fix de `cod` incluso) — depois sobrescreve as peças
  // que 65 conecta ao Firestore (carregarProducaoInsumos/_producaoInsumosInternals),
  // já que _calcular() (85) só lê essas duas via `global.X` na hora da chamada;
  // sobrescrever aqui alimenta os dados do teste sem precisar simular Firestore.
  vm.runInContext(insumosCode,window,{filename:'65-producao-insumos.js'});
  const canonInsumoReal=window._producaoInsumosInternals.canonInsumo;
  window.carregarProducaoInsumos=async()=>{};
  window._producaoInsumosInternals={ getRegistros:()=>registros||[], getFichas:()=>fichas||[], getEstoque:()=>[], canonInsumo:canonInsumoReal };
  window._pcpInternals={ getInsumosBi:()=>insumosBi||[], getUltimaBuscaInsumosBi:()=>'' };
  vm.runInContext(pageCode,window,{filename:'85-pcp-producao-insumos.js'});
  return window;
}
test('85-pcp-producao-insumos _calcular(): casa insumo com o BI PELO CÓDIGO, mesmo com nome diferente/abreviado — disponível vem do BI, não de producao_insumos_estoque',async()=>{
  const w=loadPagina({
    registros:[{_firestoreId:'op1',prodCod:'X',produto:'Produto X',data:new Date().toISOString().slice(0,10),qntCaixas:1,realizadoCaixas:0,status:'pendente'}],
    fichas:[{cod:'X',insumos:[{insumo:'MP - FUBA MEDIO KG',bluesoftProdutoKey:'79782',qty:100,categoria:'Materia prima'}]}],
    insumosBi:[{cod:'79782',produto:'MP – FUBA MEDIO KG',estoque:28191,unidade:'kg'}],
  });
  const {porInsumo}=await w._pcpProducaoInsumosInternals._calcular();
  assert.equal(porInsumo[0].disponivel,28191,'veio do BI (28.191), não de um estoque zerado/desatualizado');
  assert.equal(porInsumo[0].status,'suficiente');
});
test('85-pcp-producao-insumos _calcular(): sem código na ficha, cai pro nome normalizado como último recurso',async()=>{
  const w=loadPagina({
    registros:[{_firestoreId:'op1',prodCod:'X',produto:'Produto X',data:new Date().toISOString().slice(0,10),qntCaixas:1,realizadoCaixas:0,status:'pendente'}],
    fichas:[{cod:'X',insumos:[{insumo:'Acucar Confeiteiro',qty:5,categoria:'Materia prima'}]}],
    insumosBi:[{cod:'80060',produto:'Acucar Confeiteiro',estoque:1727,unidade:'kg'}],
  });
  const {porInsumo}=await w._pcpProducaoInsumosInternals._calcular();
  assert.equal(porInsumo[0].disponivel,1727);
});
test('85-pcp-producao-insumos _calcular(): insumo sem nenhum match no BI (nem código nem nome) fica com disponível 0, mas não quebra a tela, e é marcado semDadoBi',async()=>{
  const w=loadPagina({
    registros:[{_firestoreId:'op1',prodCod:'X',produto:'Produto X',data:new Date().toISOString().slice(0,10),qntCaixas:1,realizadoCaixas:0,status:'pendente'}],
    fichas:[{cod:'X',insumos:[{insumo:'Insumo Nunca Visto',qty:1,categoria:'Materia prima'}]}],
    insumosBi:[],
  });
  const {porInsumo}=await w._pcpProducaoInsumosInternals._calcular();
  assert.equal(porInsumo[0].disponivel,0);
  assert.equal(porInsumo[0].status,'falta');
  assert.equal(porInsumo[0].semDadoBi,true,'0 por falta de dado no BI precisa ser distinguível de 0 por estoque real zerado');
});
test('85-pcp-producao-insumos _calcular(): insumo COM match no BI nunca fica marcado semDadoBi, mesmo com estoque genuinamente zero',async()=>{
  const w=loadPagina({
    registros:[{_firestoreId:'op1',prodCod:'X',produto:'Produto X',data:new Date().toISOString().slice(0,10),qntCaixas:1,realizadoCaixas:0,status:'pendente'}],
    fichas:[{cod:'X',insumos:[{insumo:'Zerado De Verdade',bluesoftProdutoKey:'1',qty:1,categoria:'Materia prima'}]}],
    insumosBi:[{cod:'1',produto:'Zerado De Verdade',estoque:0,unidade:'kg'}],
  });
  const {porInsumo}=await w._pcpProducaoInsumosInternals._calcular();
  assert.equal(porInsumo[0].disponivel,0);
  assert.equal(porInsumo[0].semDadoBi,false);
});

// BUG AO VIVO REAL (2026-09-04): "vai no arquivo e vê se estão com as
// quantidades corretas" — nome do insumo na ficha técnica com um traço
// diferente (en-dash, ou até um caractere corrompido no meio) do usado no
// BI (dados-insumos.json usa "MP – FUBA MEDIO KG", en-dash de verdade)
// nunca batia — o norm() local só tirava acento, não pontuação. Confirmado
// direto no arquivo real: FUBA MEDIO/SUSPENSÃO OLEOSA URUCUM ficavam em 0
// só por causa disso, mesmo com estoque de dezenas de milhares de kg.
test('85-pcp-producao-insumos _calcular(): nome do insumo com traço DIFERENTE do usado no BI (en-dash vs hífen normal) ainda casa, via canonInsumo',async()=>{
  const w=loadPagina({
    registros:[{_firestoreId:'op1',prodCod:'X',produto:'Produto X',data:new Date().toISOString().slice(0,10),qntCaixas:1,realizadoCaixas:0,status:'pendente'}],
    fichas:[{cod:'X',insumos:[{insumo:'MP - FUBA MEDIO KG',qty:1,categoria:'Materia prima'}]}],
    insumosBi:[{cod:'79782',produto:'MP – FUBA MEDIO KG',estoque:28191,unidade:'kg'}],
  });
  const {porInsumo}=await w._pcpProducaoInsumosInternals._calcular();
  assert.equal(porInsumo[0].disponivel,28191);
  assert.equal(porInsumo[0].semDadoBi,false);
});
test('85-pcp-producao-insumos _calcular(): nome do insumo com caractere de encoding corrompido no meio (achado ao vivo em produção) ainda casa',async()=>{
  const w=loadPagina({
    registros:[{_firestoreId:'op1',prodCod:'X',produto:'Produto X',data:new Date().toISOString().slice(0,10),qntCaixas:1,realizadoCaixas:0,status:'pendente'}],
    fichas:[{cod:'X',insumos:[{insumo:'MP � SUSPENSÃO OLEOSA URUCUM KG',qty:1,categoria:'Materia prima'}]}],
    insumosBi:[{cod:'79922',produto:'MP – SUSPENSÃO OLEOSA URUCUM KG',estoque:1023,unidade:'kg'}],
  });
  const {porInsumo}=await w._pcpProducaoInsumosInternals._calcular();
  assert.equal(porInsumo[0].disponivel,1023,'canonInsumo tira o separador corrompido dos dois lados igual, sem deixar "MP" sobrando só de um lado');
});

// PEDIDO AO VIVO (2026-09-04): "esses que estão escritos unidades, pode
// deixar só o valor" — "unidade"/"unidades" não agrega informação (é só
// contagem de itens), diferente de kg/ml/etc que dizem o que está sendo
// medido.
test('unidadeExibivel: "unidade"/"unidades" (com variação de caixa) somem — outras unidades continuam aparecendo',()=>{
  const w=loadPagina();
  const u=w._pcpProducaoInsumosInternals.unidadeExibivel;
  assert.equal(u('unidade'),'');
  assert.equal(u('Unidades'),'');
  assert.equal(u('UNIDADE'),'');
  assert.equal(u('kg'),' kg');
  assert.equal(u('ml'),' ml');
  assert.equal(u(''),'');
  assert.equal(u(null),'');
});
