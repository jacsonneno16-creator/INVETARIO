const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'88-pcp-relatorios.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');

test('Análises do PCP expõem somente análises não repetidas no seletor principal',()=>{
  const bloco=code.slice(code.indexOf('const RELATORIOS'),code.indexOf('let _precisaoAgrupamento'));
  for(const id of ['previsao-realizado','abc-xyz','cenarios']) assert.match(bloco,new RegExp(`'${id}'`));
  for(const id of ['necessidade','demandas','ruptura','cobertura','estoque-projetado']) assert.doesNotMatch(bloco,new RegExp(`'${id}'`));
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
  window._pcpRelatoriosInternals.setRelatorio('necessidade');
  const linhas=window._pcpRelatoriosInternals._linhas();
  assert.equal(linhas.length,1);
  assert.equal(linhas[0].Data1aCompra,'2026-10-01');
  assert.equal(linhas[0].Qtd1aCompra,310);
  assert.equal(linhas[0].Data2aCompra,'2026-11-01');
  assert.equal(linhas[0].Data3aCompra,'2026-12-01');
  assert.equal(chamadas,1,'calcularProximasDatasCompra é chamada de verdade — não é um valor salvo/fixo');
});

// PEDIDO AO VIVO (2026-10-01): "quero saber quantos dias negativos fica
// com o saldo negativo... em todo lugar que mostre cobertura de estoque"
// — x.coberturaDias vem floorado em 0 (construirVisao), de propósito, pra
// classificação de risco; os relatórios/exportações mostram agora o valor
// recalculado sem esse piso.
test('relatórios "necessidade"/"ruptura"/"cobertura": coluna Cobertura mostra os dias negativos de verdade, não "0" floorado',()=>{
  const vm=require('vm');
  const item={key:'k1',produto:'Alho Triturado',necessidade:10,estoqueAtual:-144,estoqueDisponivel:-344,saldo:-344,consumoDia:32,coberturaDias:0,diasAlvo:30,estoqueAlvo:300,eventos:[],rupturaEm:'2026-10-05'};
  const window={
    document:{addEventListener:()=>{}},
    _pcpInternals:{
      construirVisao:()=>[item],getEstoqueBi:()=>null,getReqs:()=>[],getProdutos:()=>[],keyOf:p=>String(p.cod||''),
      produzidoInternamente:()=>false,
    },
    _pcpTimelineInternals:{calcularProximasDatasCompra:()=>[]},
  };
  const document={addEventListener:()=>{}};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
  window._pcpRelatoriosInternals.setRelatorio('necessidade');
  assert.equal(window._pcpRelatoriosInternals._linhas()[0].Cobertura,-10.75,'necessidade: -344/32 = -10.75, não 0');
  window._pcpRelatoriosInternals.setRelatorio('ruptura');
  assert.equal(window._pcpRelatoriosInternals._linhas()[0].Cobertura,-10.75,'ruptura: -344/32 = -10.75, não 0');
  window._pcpRelatoriosInternals.setRelatorio('cobertura');
  assert.equal(window._pcpRelatoriosInternals._linhas()[0].CoberturaAtual,-10.75,'cobertura: -344/32 = -10.75, não 0');
  assert.equal(window._pcpRelatoriosInternals._linhas()[0].Situacao,'abaixo','classificação continua usando a cobertura floorada — negativo também é "abaixo", sem mudar de faixa');
});
