const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'88-pcp-relatorios.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');

test('Relatórios do PCP cobrem somente indicadores operacionais',()=>{
  for(const id of ['necessidade','demandas','ruptura','cobertura','estoque-projetado']){
    assert.match(code,new RegExp(`'${id}'`));
  }
  assert.doesNotMatch(code,/pre[cç]o|valorTotal|currency\s*:\s*['"]BRL/i);
});

test('Exportação reaproveita o padrão XLSX/PDF já existente, sem exportador paralelo',()=>{
  assert.match(code,/global\.XLSX\.utils\.book_new\(\)/);
  assert.match(code,/global\.XLSX\.utils\.book_append_sheet/);
  assert.match(code,/global\.XLSX\.utils\.json_to_sheet/);
  assert.match(code,/global\.XLSX\.writeFile/);
  assert.match(code,/global\.XLSX\.utils\.sheet_to_csv/);
  assert.match(code,/global\.exportarElementoProducaoPDF\?\./);
});

test('PCP · Relatórios está registrado dinamicamente e ligado ao HTML',()=>{
  assert.match(code,/pcpRegistrarPagina\?\.\('relatorios'/);
  assert.match(htmlCode,/id="page-pcp-relatorios"/);
  assert.match(htmlCode,/88-pcp-relatorios\.js/);
});

// PEDIDO AO VIVO (2026-09-07): "eu queria que somasse e colocasse a data
// necessária de umas três compras futuras pros produtos que realmente vai
// precisar de compras que não são produzidos" — o relatório "Necessidade
// de Compra" ganha Data1aCompra/Data2aCompra/Data3aCompra (+ quantidades),
// calculadas por calcularProximasDatasCompra (83-pcp-timeline.js) a cada
// chamada — nunca uma data salva/fixada.
test('relatório "necessidade": Data1aCompra/2ª/3ª vêm de calcularProximasDatasCompra, recalculadas a cada chamada (não salvas)',()=>{
  const vm=require('vm');
  const visaoFake=[{key:'k1',produto:'Batata Palha',necessidade:100,estoqueAtual:1000,coberturaDias:20,diasAlvo:30,estoqueAlvo:300,eventos:[]}];
  let chamadas=0;
  const window={
    document:{addEventListener:()=>{}},
    _pcpInternals:{
      construirVisao:()=>visaoFake,getEstoqueBi:()=>null,getReqs:()=>[],getProdutos:()=>[],keyOf:p=>String(p.cod||''),
      produzidoInternamente:()=>false, // "Batata Palha" não é produzida internamente — entra no relatório de compra
    },
    _pcpTimelineInternals:{
      calcularProximasDatasCompra:()=>{ chamadas++; return [{dataNecessaria:'2026-10-01',quantidadeSugerida:310},{dataNecessaria:'2026-11-01',quantidadeSugerida:310},{dataNecessaria:'2026-12-01',quantidadeSugerida:310}]; },
    },
  };
  const document={addEventListener:()=>{}};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
  const linhas=window._pcpRelatoriosInternals._linhas();
  assert.equal(linhas.length,1);
  assert.equal(linhas[0].Data1aCompra,'2026-10-01');
  assert.equal(linhas[0].Qtd1aCompra,310);
  assert.equal(linhas[0].Data2aCompra,'2026-11-01');
  assert.equal(linhas[0].Data3aCompra,'2026-12-01');
  assert.equal(chamadas,1,'calcularProximasDatasCompra é chamada de verdade — não é um valor salvo/fixo');
});
