// Vendedor/supervisor por nota retornada.
// PEDIDO AO VIVO (2026-08-24): a API de comissão (/api/forca-de-vendas/
// comissoes-vendedores) foi removida por completo — exigia permissão extra
// e expunha dado de remuneração. O usuário optou por um cadastro local por
// CNPJ (ver enriquecerNotasComVendedorLocal em 97-recebimento-recusas.js)
// em vez de qualquer API pra essa parte. Os testes de comissão que viviam
// aqui foram removidos junto com o código; o que resta é _normalizarVendedor
// (usado só pela fonte "venda faturada", via /api/forca-de-vendas/vendedores
// — não é comissão, continua ativo).
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');

function mockRawFirestore(loja){
  return {
    collection:(nome)=>{
      if(nome==='lojas') return {doc:()=>({get:async()=>({exists:true,data:()=>loja}),collection:()=>({doc:()=>({get:async()=>({exists:false})})})})};
      if(nome==='dt_config') return {doc:()=>({get:async()=>({exists:true,data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30})})})};
      return {doc:()=>({get:async()=>({exists:false})})};
    },
  };
}
function loadServico(fetchMock){
  const document={addEventListener:()=>{}};
  const window={
    fetch:fetchMock,
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'idtoken'}})},
    getDTRawFirestore:()=>mockRawFirestore({nome:'Loja 1',bluesoft_loja_key:'LK1'}),
    getDTFirestore:()=>({collection:()=>({get:async()=>({docs:[]}),doc:()=>({id:'novo'})})}),
    getDTLojaAtiva:()=>'loja1',
  };
  vm.runInNewContext(servicoCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON,AbortController,setTimeout,clearTimeout},{filename:'90-bluesoft-service.js'});
  return window;
}

test('_normalizarVendedor lê os campos REAIS do schema (vendedorExternoKey/vendedorNomeAbreviado/vendedorEmail)',()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}));
  const v=w._bluesoftServiceInternals._normalizarVendedor({
    vendedorExternoKey:7, vendedorNomeAbreviado:'João Vendas', vendedorEmail:'joao@atacadao.com',
    gerenteNomeAbreviado:'Maria Gerente', gerenteEmail:'maria@atacadao.com',
    supervisorNomeAbreviado:'Pedro Supervisor', supervisorEmail:'pedro@atacadao.com',
  });
  assert.equal(v.vendedorKey,7);
  assert.equal(v.nome,'João Vendas');
  assert.equal(v.email,'joao@atacadao.com');
  assert.equal(v.supervisorNome,'Pedro Supervisor');
  assert.ok(!('gerenteNome' in v),'gerente removido a pedido do usuário (sempre é 1 pessoa só pra conta inteira)');
});

test('obterPedidosVendaFaturadosNaoEntreguesBluesoft (via obterNotasRetornoBluesoft) continua resolvendo vendedor via /api/forca-de-vendas/vendedores, sem tocar em comissão',async()=>{
  const caminhosChamados=[];
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    caminhosChamados.push(body.path.split('?')[0]);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/forca-de-vendas/pedidos')){
      const status=qs.get('pedidoVendaStatus');
      const dados=status==='FATURADO_POR_NOTA_FISCAL'?[{pedidoForcaVendaKey:1,vendedorExternoKey:7,dataEmissao:'2026-06-10',clientes:[{clienteKey:1,nfChave:'CH1',nfNumero:1}]}]:[];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?dados:[]})};
    }
    if(body.path.startsWith('/api/forca-de-vendas/vendedores')){
      return {ok:true,text:async()=>JSON.stringify({data:[{vendedorExternoKey:7,vendedorNomeAbreviado:'João Vendas',vendedorEmail:'joao@x.com',supervisorNomeAbreviado:'Pedro Supervisor',supervisorEmail:'pedro@x.com'}]})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const w=loadServico(fetchMock);
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.ok(!caminhosChamados.some(p=>p.startsWith('/api/forca-de-vendas/comissoes-vendedores')),'API de comissão não pode mais ser chamada em nenhum fluxo');
  const notaVenda=notas.find(n=>n.chave==='CH1');
  assert.ok(notaVenda,'a nota de venda faturada precisa ter sido montada');
  assert.equal(notaVenda.vendedorNome,'João Vendas');
  assert.equal(notaVenda.supervisorNome,'Pedro Supervisor');
});
