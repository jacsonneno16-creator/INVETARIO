const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');const vm=require('vm');
const code=fs.readFileSync(path.join(__dirname,'../js/analista/88-pcp-relatorios.js'),'utf8');
function carregar(){
  const window={document:{addEventListener:()=>{}},_pcpInternals:{construirVisao:()=>[],getEstoqueBi:()=>null,getEscadinhaBiRaw:()=>null,getReqs:()=>[],getProdutos:()=>[],keyOf:p=>String(p.cod||''),produzidoInternamente:()=>false,_categoriaDoNome:()=>''}};
  const document=window.document;
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
  return window;
}

test('ABC classifica por participação acumulada do realizado',()=>{
  const w=carregar();
  const esc={produtos:[
    {cod:'1',produto:'A',real:[70,10,0]},
    {cod:'2',produto:'B',real:[10,5,0]},
    {cod:'3',produto:'C',real:[5,0,0]},
  ]};
  const r=w._pcpRelatoriosInternals.calcularABCXYZ(esc,[],{mesAtual:2,abcA:80,abcB:95,xyzX:.3,xyzY:.75});
  assert.equal(r[0].abc,'A');
  assert.equal(r[1].abc,'B');
  assert.equal(r[2].abc,'C');
  assert.equal(r.reduce((s,x)=>s+x.realizado,0),100);
});

test('XYZ usa coeficiente de variação nos meses fechados',()=>{
  const w=carregar();
  const esc={produtos:[
    {cod:'1',produto:'X',real:[100,100,100,0]},
    {cod:'2',produto:'Y',real:[100,150,50,0]},
    {cod:'3',produto:'Z',real:[0,0,300,0]},
  ]};
  const r=w._pcpRelatoriosInternals.calcularABCXYZ(esc,[],{mesAtual:3,xyzX:.3,xyzY:.75});
  const m=Object.fromEntries(r.map(x=>[x.cod,x]));
  assert.equal(m['1'].xyz,'X');
  assert.equal(m['2'].xyz,'Y');
  assert.equal(m['3'].xyz,'Z');
});

test('ABC/XYZ ignora mês atual e produto sem histórico realizado',()=>{
  const w=carregar();
  const r=w._pcpRelatoriosInternals.calcularABCXYZ({produtos:[
    {cod:'1',produto:'Tem histórico',real:[10,20,999]},
    {cod:'2',produto:'Sem histórico',real:[0,0,999]},
  ]},[],{mesAtual:2});
  assert.equal(r.length,1);
  assert.equal(r[0].realizado,30);
});

test('relatório ABC/XYZ não cria leitura Firestore própria',()=>{
  assert.match(code,/\['abc-xyz', 'ABC\/XYZ'\]/);
  assert.match(code,/calcularABCXYZ/);
  assert.doesNotMatch(code,/\.collection\s*\(/);
});
