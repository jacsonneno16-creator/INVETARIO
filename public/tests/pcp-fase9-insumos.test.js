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
