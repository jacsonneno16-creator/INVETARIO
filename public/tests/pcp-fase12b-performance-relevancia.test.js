const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');
const estoqueCode=fs.readFileSync(path.join(base,'75-producao-estoque.js'),'utf8');
const pcpCode=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');

function loadServico(){
  const document={addEventListener:()=>{}};
  const window={getDTRawFirestore:()=>({}),getDTFirestore:()=>({})};
  vm.runInNewContext(servicoCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON},{filename:'90-bluesoft-service.js'});
  return window;
}

test('_estoqueRelevante descarta produto zerado sem nenhum pedido/reserva, mas mantém ruptura real (zerado com pedido de venda pendente)',()=>{
  const w=loadServico();
  const relevante=w._bluesoftServiceInternals._estoqueRelevante;
  assert.equal(relevante({estoqueAtual:0,estoqueReservado:0,estoqueEmTransito:0,pedidosPendentes:0,pedidosVendaPendentes:0}),false);
  assert.equal(relevante({estoqueAtual:0,estoqueReservado:0,estoqueEmTransito:0,pedidosPendentes:0,pedidosVendaPendentes:5}),true);
  assert.equal(relevante({estoqueAtual:120,estoqueReservado:0,estoqueEmTransito:0,pedidosPendentes:0,pedidosVendaPendentes:0}),true);
  assert.equal(relevante({estoqueAtual:0,estoqueReservado:0,estoqueEmTransito:30,pedidosPendentes:0,pedidosVendaPendentes:0}),true);
});

test('obterCatalogoBluesoft filtra status ATIVO e tipoProduto real da Bluesoft no próprio servidor (menos volume puxado)',()=>{
  assert.match(servicoCode,/const params = \{ status: 'ATIVO' \}; if \(tipo\) params\.tipoProduto = tipo;/);
});

test('obterEstoqueBluesoft ignora produtos inativos e filtra pra relevante por padrão',()=>{
  assert.match(servicoCode,/ignoraProdutosInativos: true/);
  assert.match(servicoCode,/todosNormalizados\.filter\(_estoqueRelevante\)/);
});

test('sincronizarEstoqueBluesoft grava estoqueReservadoVenda e invalida os caches do PCP/Projeção ao terminar',()=>{
  const trecho=servicoCode.slice(servicoCode.indexOf('async function sincronizarEstoqueBluesoft'));
  assert.match(trecho,/payload\.estoqueReservadoVenda\s*=\s*e\.pedidosVendaPendentes/);
  assert.match(trecho,/_invalidarCachesDependentes\(\)/);
  assert.match(servicoCode,/global\.carregarProducaoProjecao\?\.\(true\)/);
  assert.match(servicoCode,/global\._pcpInternals\?\.carregar\?\.\(true\)/);
});

test('sincronizarProdutosBluesoft também invalida os caches dependentes',()=>{
  const trecho=servicoCode.slice(servicoCode.indexOf('async function sincronizarProdutosBluesoft'),servicoCode.indexOf('async function sincronizarEstoqueBluesoft'));
  assert.match(trecho,/_invalidarCachesDependentes\(\)/);
});

test('Tela de Estoque (Bluesoft) pagina o resultado — não renderiza milhares de linhas de uma vez',()=>{
  assert.match(estoqueCode,/ITENS_POR_PAGINA/);
  assert.match(estoqueCode,/data-pest-pg/);
  assert.match(estoqueCode,/itensOrdenados\.slice\(\(_pagina - 1\) \* ITENS_POR_PAGINA, _pagina \* ITENS_POR_PAGINA\)/);
});

test('PCP soma a reserva de venda real da Bluesoft ao comprometido/necessidade, não só pedidos internos',()=>{
  const document={addEventListener:()=>{}};
  const window={temPermissao:()=>true,calcularProjecaoComRisco:()=>[]};
  vm.runInNewContext(pcpCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,confirm:()=>true,prompt:()=>null},{filename:'78-pcp-central.js'});
  const h=window._pcpInternals;
  const v=h.construirVisao({
    produtos:[{cod:'X',nome:'Produto X'}],
    projecao:[{cod:'X',produto:'Produto X',estoqueAtual:500,estoqueReservadoVenda:150}],
    pedidos:[],ops:[],agendamentos:[],requisicoes:[],
  })[0];
  assert.equal(v.estoqueComprometido,150);
  assert.equal(v.estoqueDisponivel,350);
});

// PEDIDO AO VIVO (2026-08-28): "a aba de pedido versus estoque... era pra
// trazer os pedidos de vendas, está tudo zerado" — comprometido/disponível
// já caíam pra reservaVendaBluesoft sem pedido manual, mas a coluna exibida
// "Pedidos pend." (campo pendente) e o saldo/necessidade projetados
// continuavam somando só o pedido LEGADO (pcp_pedidos, vazio pra quem
// migrou pro BI) — mostrava zero mesmo com reserva de venda real.
test('PCP: "Pedidos pend." (pendente exibido) e saldo/necessidade também usam a reserva de venda do BI quando não há pedido manual cadastrado',()=>{
  const document={addEventListener:()=>{}};
  const window={temPermissao:()=>true,calcularProjecaoComRisco:()=>[]};
  vm.runInNewContext(pcpCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,confirm:()=>true,prompt:()=>null},{filename:'78-pcp-central.js'});
  const h=window._pcpInternals;
  const v=h.construirVisao({
    produtos:[{cod:'X',nome:'Produto X',metaCoberturaDias:0}],
    projecao:[{cod:'X',produto:'Produto X',estoqueAtual:500,estoqueReservadoVenda:150}],
    pedidos:[],ops:[],agendamentos:[],requisicoes:[],
  })[0];
  assert.equal(v.pendente,150,'"Pedidos pend." não pode mostrar zero quando existe reserva de venda real do BI');
  assert.equal(v.saldo,350,'saldo projetado precisa descontar a reserva de venda real, não só pedido manual');
});
