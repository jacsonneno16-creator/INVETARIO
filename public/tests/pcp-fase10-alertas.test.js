const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'87-pcp-alertas.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');

function load(mockInternals){
  const document={addEventListener:()=>{}};
  const window={_pcpInternals:mockInternals,pcpRegistrarPagina:()=>{}};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Map,Set});
  return window;
}

test('calcularAlertas detecta sem estoque, compra atrasada e compra insuficiente, ordenados por severidade',async()=>{
  const w=load({
    carregar:async()=>{},
    construirVisao:()=>[{key:'X',produto:'Produto X',estoqueAtual:0,estoqueDisponivel:0,consumoDia:10,necessidade:100,coberturaDias:0,coberturaProjetadaDias:0,leadTimeDias:7,diasAlvo:10}],
    getReqs:()=>[{prodKey:'X',produto:'Produto X',status:'comprada',quantidade:100,quantidadeComprada:50}],
    getAgend:()=>[{produto:'Produto X',dataPrevista:'2020-01-01',status:'prevista'}],
    keyOf:x=>String(x.prodKey||x.cod||''),
  });
  const alertas=await w._pcpAlertasInternals.calcularAlertas();
  assert.ok(alertas.some(a=>a.tipo==='sem_estoque'));
  assert.ok(alertas.some(a=>a.tipo==='compra_atrasada'));
  assert.ok(alertas.some(a=>a.tipo==='compra_insuficiente'));
  assert.equal(alertas[0].cor,'red');
});


test('produto zerado sem consumo e sem necessidade não vira ruptura falsa',async()=>{
  const w=load({
    carregar:async()=>{},
    construirVisao:()=>[{key:'Z',produto:'Descontinuado',estoqueAtual:0,estoqueDisponivel:0,consumoDia:0,necessidade:0,coberturaDias:null,coberturaProjetadaDias:null,leadTimeDias:7,diasAlvo:30}],
    getReqs:()=>[], getAgend:()=>[], keyOf:x=>String(x.prodKey||x.cod||''),
  });
  const alertas=await w._pcpAlertasInternals.calcularAlertas();
  assert.equal(alertas.some(a=>a.tipo==='sem_estoque'),false);
});

test('calcularAlertas fica vazio quando não há nenhum problema',async()=>{
  const w=load({
    carregar:async()=>{},
    construirVisao:()=>[{key:'Y',produto:'Produto Y',estoqueAtual:500,coberturaDias:30,coberturaProjetadaDias:30,diasAlvo:10}],
    getReqs:()=>[],
    getAgend:()=>[],
    keyOf:x=>String(x.prodKey||x.cod||''),
  });
  const alertas=await w._pcpAlertasInternals.calcularAlertas();
  assert.equal(alertas.length,0);
});

test('Alertas do PCP estão registrados dinamicamente e clicáveis',()=>{
  assert.match(code,/pcpRegistrarPagina\?\.\('alertas'/);
  assert.match(code,/data-pcpal-ir/);
  assert.match(code,/pcpIrParaAba\?\./);
  assert.match(htmlCode,/id="page-pcp-alertas"/);
  assert.match(htmlCode,/87-pcp-alertas\.js/);
});

test('Central de Exceções transforma risco temporal em ação de compra com data limite sem nova leitura',()=>{
  const w=load({});
  w._pcpTimelineInternals={calcularRiscoTemporal:()=>({pontoPedidoEm:'2026-09-25',rupturaEm:'2026-10-02'})};
  const a=w._pcpAlertasInternals.excecoesDoProduto({key:'P1',produto:'Produto compra',estoqueAtual:100,estoqueDisponivel:100,coberturaProjetadaDias:5,leadTimeDias:7,diasAlvo:30,necessidade:200,quantidadeSugerida:200,eventos:[],alertasCalculo:[]},()=>false);
  assert.equal(a[0].acao,'COMPRAR');
  assert.equal(a[0].dataAcao,'2026-09-25');
  assert.equal(a[0].dataNecessaria,'2026-10-02');
  assert.equal(a[0].quantidade,200);
  assert.doesNotMatch(code,/getDTFirestore|\.collection\(/,'classificação das exceções não cria leitura direta no Firestore');
});

test('Central de Exceções recomenda produção para item interno e antecipação quando suprimento chega depois da ruptura',()=>{
  const w=load({});
  w._pcpTimelineInternals={calcularRiscoTemporal:()=>({pontoPedidoEm:'2026-09-20',rupturaEm:'2026-09-23'})};
  const base={key:'P2',produto:'Produto interno',estoqueAtual:100,estoqueDisponivel:100,coberturaProjetadaDias:3,leadTimeDias:5,diasAlvo:30,necessidade:100,quantidadeSugerida:100,alertasCalculo:[]};
  const normal=w._pcpAlertasInternals.excecoesDoProduto({...base,eventos:[]},()=>true);
  assert.equal(normal[0].acao,'PRODUZIR');
  const atrasada=w._pcpAlertasInternals.excecoesDoProduto({...base,eventos:[{tipo:'producao',data:'2026-09-30',delta:500}]},()=>true);
  assert.equal(atrasada[0].acao,'ANTECIPAR PRODUÇÃO');
});

// PEDIDO AO VIVO (2026-10-01): "quero saber quantos dias negativos fica
// com o saldo negativo... em todo lugar que mostre cobertura de estoque"
// — o texto do alerta (`detalhe`) usava item.coberturaProjetadaDias, que
// vem floorado em 0 (construirVisao), de propósito, pra classificação de
// risco. Agora recalcula sem esse piso só pro texto mostrado.
test('Central de Exceções: alerta "cobertura menor que o lead time" mostra a cobertura recalculada (saldo/consumoDia), não a floorada em 0',()=>{
  const w=load({});
  const a=w._pcpAlertasInternals.excecoesDoProduto({key:'P3',produto:'Produto Lead',estoqueAtual:36,estoqueDisponivel:36,saldo:36,consumoDia:12,coberturaDias:0,coberturaProjetadaDias:0,leadTimeDias:10,diasAlvo:30,necessidade:50,quantidadeSugerida:50,alertasCalculo:[],eventos:[]},()=>false);
  assert.equal(a[0].tipo,'cobertura_menor_leadtime');
  assert.match(a[0].detalhe,/Cobertura projetada 3\.0d/,'recalcula saldo(36)/consumoDia(12)=3.0d, não usa o coberturaProjetadaDias floorado (0)');
});
test('Central de Exceções: alerta "abaixo da cobertura desejada" também mostra a cobertura recalculada, não a floorada em 0',()=>{
  const w=load({});
  const a=w._pcpAlertasInternals.excecoesDoProduto({key:'P4',produto:'Produto Meta',estoqueAtual:50,estoqueDisponivel:50,saldo:50,consumoDia:20,coberturaDias:0,coberturaProjetadaDias:0,leadTimeDias:0,diasAlvo:30,necessidade:10,quantidadeSugerida:10,alertasCalculo:[],eventos:[]},()=>false);
  assert.equal(a[0].tipo,'abaixo_cobertura');
  assert.match(a[0].detalhe,/Cobertura projetada 2\.5d/,'recalcula saldo(50)/consumoDia(20)=2.5d, não usa coberturaProjetadaDias floorado (0)');
});

test('motor de Exceções continua compatível, mas a tela separada saiu do menu e foi consolidada em Planejamento',()=>{
  assert.match(code,/Central de Exceções e Ações/);
  assert.match(code,/pcpRegistrarPagina\?\.\('alertas'/,'rota interna alertas é preservada para compatibilidade');
  assert.doesNotMatch(htmlCode,/id="nav-pcp-alertas"/);
  assert.match(htmlCode,/id="nav-pcp-planejamento"/);
});

test('Central de Exceções inclui sugestão de transferência entre lojas sem criar movimentação automática',async()=>{
  const w=load({
    carregar:async()=>{},
    construirVisao:()=>[],
    getReqs:()=>[],
    getAgend:()=>[],
    keyOf:x=>String(x.prodKey||x.cod||''),
    calcularSugestoesTransferencia:()=>[{key:'P1',produto:'Produto 1',origemLojaNome:'Matriz',destinoLojaNome:'Filial',quantidade:80,necessidadeRestante:20,dataAcao:'2026-09-20'}]
  });
  const alertas=await w._pcpAlertasInternals.calcularAlertas();
  const t=alertas.find(a=>a.tipo==='transferencia_lojas');
  assert.ok(t);
  assert.equal(t.acao,'TRANSFERIR');
  assert.equal(t.quantidade,80);
  assert.match(t.detalhe,/Matriz/);
  assert.match(t.detalhe,/Filial/);
  assert.match(t.detalhe,/20/);
});

test('agendamento cancelado e atrasado não gera alerta de cobrança',async()=>{
  const w=load({
    carregar:async()=>{}, construirVisao:()=>[], getReqs:()=>[],
    getAgend:()=>[{cod:'P1',produto:'Produto cancelado',dataPrevista:'2020-01-01',status:'cancelado'}],
    keyOf:x=>String(x.produtoKey||x.prodKey||x.cod||'')
  });
  const alertas=await w._pcpAlertasInternals.calcularAlertas();
  assert.equal(alertas.some(a=>a.tipo==='compra_atrasada'),false);
});

test('compra atrasada preserva a chave do produto para abrir o detalhe',async()=>{
  const w=load({
    carregar:async()=>{}, construirVisao:()=>[], getReqs:()=>[],
    getAgend:()=>[{prodKey:'P9',produto:'Produto 9',dataPrevista:'2020-01-01',status:'prevista'}],
    keyOf:x=>String(x.produtoKey||x.prodKey||x.cod||'')
  });
  const alerta=(await w._pcpAlertasInternals.calcularAlertas()).find(a=>a.tipo==='compra_atrasada');
  assert.equal(alerta.key,'P9');
});
