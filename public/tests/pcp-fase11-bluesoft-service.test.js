const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');
const estoqueCode=fs.readFileSync(path.join(base,'75-producao-estoque.js'),'utf8');
const importacaoCode=fs.readFileSync(path.join(base,'76-producao-importacao.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');

function load(){
  const document={addEventListener:()=>{}};
  const window={getDTRawFirestore:()=>({}),getDTFirestore:()=>({})};
  vm.runInNewContext(servicoCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON},{filename:'90-bluesoft-service.js'});
  return window;
}

test('normaliza produto da Bluesoft (campos reais confirmados no schema oficial) sem tocar em unid/campos de planejamento do PCP',()=>{
  const w=load();
  const produtoBluesoft={
    produtoKey:12345, descricao:'PÃO FRANCÊS 50G', status:'ATIVO', subGrupoProduto:'Padaria',
    gtinPrincipal:'7891234567890', gtins:['7891234567890'],
    tipoUnidadeMedida:{tipoUnidadeMedidaKey:'UN',descricao:'Unidade',fator:1},
    fornecedorPadraoKey:99, fornecedores:[
      {fornecedorKey:11,nomeRazao:'Fornecedor Secundário',padrao:false,multiploCompraUnitaria:5},
      {fornecedorKey:99,nomeRazao:'Fornecedor Padrão LTDA',padrao:true,multiploCompraUnitaria:10},
    ],
  };
  const norm=w._bluesoftServiceInternals._normalizarProduto(produtoBluesoft);
  assert.equal(norm.cod,'12345');
  assert.equal(norm.nome,'PÃO FRANCÊS 50G');
  assert.equal(norm.unidade,'Unidade');
  assert.equal(norm.gtin,'7891234567890');
  assert.equal(norm.categoria,'Padaria');
  assert.equal(norm.status,'ATIVO');
  assert.equal(norm.fornecedorPadraoKey,99);
  assert.equal(norm.fornecedorPadraoNome,'Fornecedor Padrão LTDA');
  assert.equal(norm.multiploCompraSugerido,10);
  assert.ok(!('unid' in norm), 'não deve gerar o campo unid (quantidade por caixa) a partir da unidade de medida da Bluesoft');
});

test('normaliza estoque de loja comum (GET /api/comercial/estoques) com os campos reais do schema',()=>{
  const w=load();
  const linha={
    produtoKey:12345, lojaKey:7, saldoFisico:150, saldoDisponivel:120, quantidadeReservada:30,
    quantidadeEmTransito:40, quantidadePendenteEmPedidos:200, mediaVendaDiaria:12.5,
    custoBrutoUltimaCompra:3.45, custoMedioContabil:3.2, diasDeCoberturaOnline:9.6,
  };
  const norm=w._bluesoftServiceInternals._normalizarEstoqueComercial(linha);
  assert.equal(norm.cod,'12345');
  assert.equal(norm.estoqueAtual,150);
  assert.equal(norm.estoqueDisponivel,120);
  assert.equal(norm.estoqueReservado,30);
  assert.equal(norm.estoqueEmTransito,40);
  assert.equal(norm.pedidosPendentes,200);
  assert.equal(norm.consumoDiaMedio,12.5);
  assert.equal(norm.custoUltimaCompra,3.45);
  assert.equal(norm.coberturaDiasBluesoft,9.6);
});

test('normaliza estoque de CD/WMS (GET /api/wms/ajuste-estoque-logistico) preservando o ramo já existente',()=>{
  const w=load();
  const linha={produtokey:'555',quantidadedisponivelemunidades:'80,50'};
  const norm=w._bluesoftServiceInternals._normalizarEstoqueWms(linha);
  assert.equal(norm.cod,'555');
  assert.equal(norm.estoqueAtual,80.5);
  assert.equal(norm.estoqueDisponivel,null);
});

test('serviço expõe as 4 funções cacheadas + sincronização de produtos, sem inventar endpoint',()=>{
  assert.match(servicoCode,/global\.obterCatalogoBluesoft\s*=\s*obterCatalogoBluesoft/);
  assert.match(servicoCode,/global\.obterEstoqueBluesoft\s*=\s*obterEstoqueBluesoft/);
  assert.match(servicoCode,/global\.obterFornecedoresBluesoft\s*=\s*obterFornecedoresBluesoft/);
  assert.match(servicoCode,/global\.obterPedidosCompraBluesoft\s*=\s*obterPedidosCompraBluesoft/);
  assert.match(servicoCode,/global\.sincronizarProdutosBluesoft\s*=\s*sincronizarProdutosBluesoft/);
  for(const rota of ['/api/comercial/produtos','/api/comercial/estoques','/api/wms/ajuste-estoque-logistico','/api/fornecedores','/api/compras/pedidos-de-compra']){
    assert.match(servicoCode,new RegExp(rota.replace(/\//g,'\\/')));
  }
  assert.match(servicoCode,/dt_config.*integracao_api|integracao_api/);
  assert.match(servicoCode,/BLUESOFT_PROXY_URL/);
});

test('sincronização de produtos nunca escreve nos campos de planejamento do PCP nem no unid de fabricação',()=>{
  const camposProibidos=['metaCoberturaDias','estoqueMinimo','estoqueMaximo','estoqueSeguranca','leadTimeDias','loteMinimoCompra','criticidade','pc_min','producaoMinima','multiploProducao'];
  const trechoSync=servicoCode.slice(servicoCode.indexOf('async function sincronizarProdutosBluesoft'));
  for(const campo of camposProibidos){
    assert.doesNotMatch(trechoSync,new RegExp('\\b'+campo+'\\s*:'));
  }
  assert.doesNotMatch(trechoSync,/\bunid\s*:/);
  assert.match(trechoSync,/unidadeMedidaBluesoft/);
});

test('75-producao-estoque.js foi migrado pro serviço compartilhado (sem duplicar request/paginação própria)',()=>{
  assert.match(estoqueCode,/global\.obterEstoqueBluesoft/);
  assert.match(estoqueCode,/global\.obterCatalogoBluesoft/);
  assert.doesNotMatch(estoqueCode,/BLUESOFT_PROXY_URL/);
  assert.doesNotMatch(estoqueCode,/function _paginarTudo/);
});

test('76 ganhou o botão de sincronizar produtos, ligado ao serviço novo',()=>{
  assert.match(importacaoCode,/data-pimp-bluesoft-produtos/);
  assert.match(importacaoCode,/global\.sincronizarProdutosBluesoft/);
});

test('Firestore rules dão uma 3ª via de escrita em producao_produtos pra sincronização, restrita a campos de catálogo',()=>{
  assert.match(rules,/hasPermission\('producao-importacao', 'importar'\)/);
  assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['nome','unidadeMedidaBluesoft','gtin','ativo','categoria','fornecedorPadrao','fornecedorPadraoKey','bluesoftProdutoKey','bluesoftTipoProduto','bluesoftSincronizadoEm','multiploCompra','atualizadoEm','atualizadoPor'\]\)/);
});

test('HTML carrega o serviço Bluesoft compartilhado',()=>{
  assert.match(htmlCode,/90-bluesoft-service\.js/);
});
