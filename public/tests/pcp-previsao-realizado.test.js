const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const code=fs.readFileSync(path.join(__dirname,'../js/analista/88-pcp-relatorios.js'),'utf8');

function carregar(){
  const window={document:{addEventListener:()=>{}},_pcpInternals:{
    construirVisao:()=>[],getEstoqueBi:()=>null,getEscadinhaBiRaw:()=>null,getReqs:()=>[],getProdutos:()=>[],keyOf:p=>String(p.cod||''),produzidoInternamente:()=>false,_categoriaDoNome:()=>''
  }};
  const document=window.document;
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
  return window;
}

test('Previsão x Realizado compara apenas meses fechados e calcula WAPE, acurácia, MAPE e viés',()=>{
  const w=carregar();
  const esc={produtos:[{cod:'1',produto:'Produto A',plano:[100,200,999],real:[110,180,500]}]};
  const itens=w._pcpRelatoriosInternals.calcularPrecisaoPrevisao(esc,[{cod:'1',categoria:'Grãos'}],{mesAtual:2,agora:new Date('2026-03-15T12:00:00')});
  assert.equal(itens.length,1);
  const x=itens[0];
  assert.equal(x.meses,2,'março ainda está aberto e não entra');
  assert.equal(x.previsto,300);
  assert.equal(x.realizado,290);
  assert.equal(x.erroAbs,30);
  assert.ok(Math.abs(x.wape-(30/290*100))<0.0001);
  assert.ok(Math.abs(x.acuracia-(100-30/290*100))<0.0001);
  assert.ok(Math.abs(x.vies-((290-300)/300*100))<0.0001);
  assert.equal(x.categoria,'Grãos');
});

test('MAPE ignora mês com realizado zero sem gerar Infinity/NaN',()=>{
  const w=carregar();
  const itens=w._pcpRelatoriosInternals.calcularPrecisaoPrevisao({produtos:[{cod:'2',produto:'B',plano:[50,100],real:[0,100]}]},[],{mesAtual:2});
  assert.equal(itens.length,1);
  assert.equal(itens[0].mape,0,'só o mês com realizado > 0 participa do MAPE');
  assert.ok(Number.isFinite(itens[0].wape));
});

test('agrupamento por categoria consolida volumes e erro absoluto ponderado',()=>{
  const w=carregar();
  const fn=w._pcpRelatoriosInternals._agruparPrecisao;
  const linhas=fn([
    {categoria:'Farináceos',previsto:100,realizado:80,erroAbs:20,mape:25},
    {categoria:'Farináceos',previsto:300,realizado:330,erroAbs:30,mape:9.09},
  ],'categoria');
  assert.equal(linhas.length,1);
  assert.equal(linhas[0].Produtos,2);
  assert.equal(linhas[0].Previsto,400);
  assert.equal(linhas[0].Realizado,410);
  assert.equal(linhas[0].ErroAbsoluto,50);
  assert.equal(linhas[0].WAPE,Number((50/410*100).toFixed(2)));
});

test('módulo de precisão não cria leitura Firestore própria',()=>{
  assert.match(code,/Previsão × Realizado/);
  assert.match(code,/getEscadinhaBiRaw/);
  assert.doesNotMatch(code,/\.collection\s*\(/,'relatório usa dados já carregados pelo PCP');
});
