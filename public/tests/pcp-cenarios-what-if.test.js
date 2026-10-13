const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');const vm=require('vm');
const engCode=fs.readFileSync(path.join(__dirname,'../js/analista/120-pcp-demand-engine.js'),'utf8');
const relCode=fs.readFileSync(path.join(__dirname,'../js/analista/88-pcp-relatorios.js'),'utf8');
const tlCode=fs.readFileSync(path.join(__dirname,'../js/analista/83-pcp-timeline.js'),'utf8');
function carregar(){
  const document={addEventListener:()=>{},getElementById:()=>null};
  const window={document,pcpRegistrarPagina:()=>{},_pcpInternals:{construirVisao:()=>[],getEstoqueBi:()=>null,getEscadinhaBiRaw:()=>null,getReqs:()=>[],getProdutos:()=>[],keyOf:p=>String(p.cod||''),produzidoInternamente:()=>false,_categoriaDoNome:()=>'',resolverCadastroProduto:()=>({loteMinimoCompra:220,multiploCompra:50})}};
  const ctx={window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}};
  vm.runInNewContext(engCode,ctx);
  vm.runInNewContext(tlCode,ctx);
  vm.runInNewContext(relCode,ctx);
  return window;
}
function item(){return {key:'1',produto:'Produto 1',estoqueAtual:1000,estoqueDisponivel:1000,estoqueComprometido:0,timelineSaldoInicial:1000,estoqueMinimo:0,estoqueSeguranca:50,leadTimeDias:10,diasAlvo:30,estoqueAlvo:300,consumoDia:10,consumoMensal:300,previsaoMensal:300,necessidade:0,producaoProgramada:200,entradasPrevistas:300,saldo:1500,eventos:[{data:'2099-01-10',tipo:'entrada',delta:300},{data:'2099-01-05',tipo:'producao',delta:200}],planoEscadinha:null};}

test('cenário de demanda altera consumo e cobertura sem mutar item base',()=>{
  const w=carregar(), base=item();
  const sim=w._pcpRelatoriosInternals.aplicarCenarioItem(base,{demandaPct:50});
  assert.equal(sim.consumoDia,15);
  assert.ok(sim.coberturaDias < base.estoqueDisponivel/base.consumoDia);
  assert.equal(base.consumoDia,10);
});

test('atraso do fornecedor desloca somente eventos de entrada',()=>{
  const w=carregar(), base=item();
  const sim=w._pcpRelatoriosInternals.aplicarCenarioItem(base,{atrasoFornecedorDias:7});
  const ent=sim.eventos.find(e=>e.tipo==='entrada');
  const prod=sim.eventos.find(e=>e.tipo==='producao');
  assert.equal(ent.data,'2099-01-17');
  assert.equal(prod.data,'2099-01-05');
});

test('cenário de produção ajusta somente quantidade programada simulada',()=>{
  const w=carregar(), base=item();
  const sim=w._pcpRelatoriosInternals.aplicarCenarioItem(base,{producaoPct:-50});
  assert.equal(sim.producaoProgramada,100);
  assert.equal(sim.eventos.find(e=>e.tipo==='producao').delta,100);
  assert.equal(base.producaoProgramada,200);
});

test('cobertura alvo do cenário muda necessidade sem gravar parâmetros',()=>{
  const w=carregar(), base=item();
  const sim=w._pcpRelatoriosInternals.aplicarCenarioItem(base,{coberturaDias:90});
  assert.equal(sim.diasAlvo,90);
  assert.equal(sim.estoqueAlvo,950); // 90d de consumo + segurança do mesmo motor
  assert.equal(base.diasAlvo,30);
});

test('cenário aplica lote mínimo e múltiplo na quantidade sugerida',()=>{
  const w=carregar(), base={...item(),estoqueAtual:0,estoqueDisponivel:0,saldo:0,producaoProgramada:0,entradasPrevistas:0,estoqueComprometido:0,consumoDia:10,diasAlvo:10,estoqueAlvo:100};
  const sim=w._pcpRelatoriosInternals.aplicarCenarioItem(base,{});
  assert.equal(sim.necessidade,250); // inclui segurança do motor
  assert.equal(sim.quantidadeSugerida,250); // lote mínimo 220 arredondado ao múltiplo 50
});

test('simulador não possui leitura nem gravação Firestore própria',()=>{
  assert.match(relCode,/Cenários “E se\?”/);
  assert.match(relCode,/aplicarCenarioItem/);
  assert.doesNotMatch(relCode,/\.collection\s*\(/);
  assert.doesNotMatch(relCode,/getDTFirestore|getDTRawFirestore/);
});
