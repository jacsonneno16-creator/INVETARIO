// Vendedor/gerente/supervisor por nota retornada — REESCRITO 2026-08-19.
// A versão anterior sincronizava grupos-econômicos + TODOS os clientes da
// conta (61.170+ registros, estourando timeout e o limite de segurança de
// paginação) antes de olhar pra nenhuma nota. Pedido ao vivo do usuário:
// "não quero que consulte todos os clientes cadastrados... tem que trazer
// os que tem as notas... a partir das notas trazer os vendedores".
// Corrigido usando GET /api/forca-de-vendas/comissoes-vendedores — filtra
// por período (o MESMO das notas) e já traz cnpj/clienteKey/
// vendedorExternoKey/Nome/gerenteKey/supervisorKey/número da NF/motivo de
// devolução no mesmo registro, sem varrer o cadastro de clientes inteiro.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');

function mockRawFirestore(loja){
  return {
    collection:(nome)=>{
      if(nome==='lojas') return {doc:()=>({get:async()=>({exists:true,data:()=>loja})})};
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

test('_normalizarComissaoVendedor preserva os campos reais do schema (ComissaoVendedorConsultarResponse), sem trazer comissão',()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}));
  const c=w._bluesoftServiceInternals._normalizarComissaoVendedor({
    cnpj:'12.345.678/0001-99', clienteKey:100, nomeCliente:'Mercado X',
    vendedorExternoKey:7, vendedorExternoNome:'João Vendas',
    gerenteKey:1, supervisorKey:2, numeroNotaFiscalOrigem:12345, motivoDevolucao:'Cliente recusou', tipoDePedido:'DEVOLUCAO',
    valorComissao:99.9, porcentagemComissao:3,
  });
  assert.equal(c.cnpj,'12345678000199');
  assert.equal(c.clienteKey,100);
  assert.equal(c.vendedorKey,7);
  assert.equal(c.vendedorNome,'João Vendas');
  assert.equal(c.supervisorKey,2);
  assert.ok(!('gerenteKey' in c),'gerente removido a pedido do usuário');
  assert.equal(c.numeroNotaFiscalOrigem,'12345');
  assert.equal(c.motivoDevolucao,'Cliente recusou');
  assert.ok(!('valorComissao' in c) && !('porcentagemComissao' in c), 'comissão foi pedido explícito do usuário pra NÃO vir');
});

test('obterComissoesVendedorPorPeriodo chama /api/forca-de-vendas/comissoes-vendedores com o período pedido, sem tocar em /api/clientes',async()=>{
  let pathChamado='';
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    pathChamado=body.path;
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?[{cnpj:'123',clienteKey:1,vendedorExternoKey:7,vendedorExternoNome:'João',numeroNotaFiscalOrigem:12345}]:[]})};
  };
  const w=loadServico(fetchMock);
  const r=await w.obterComissoesVendedorPorPeriodo({dataInicial:'01/07/2026',dataFinal:'19/08/2026',tipoPedido:'TODOS'});
  assert.match(pathChamado,/^\/api\/forca-de-vendas\/comissoes-vendedores\?/);
  assert.match(pathChamado,/dataInicial=01%2F07%2F2026/);
  assert.match(pathChamado,/tipoPedido=TODOS/);
  assert.equal(r.length,1);
  assert.equal(r[0].vendedorNome,'João');
});

test('REGRESSÃO (bug ao vivo real: "não quero que consulte todos os clientes cadastrados") — enriquecerNotasComVendedorPorComissao NUNCA chama /api/clientes nem /api/forca-de-vendas/grupos-economicos',async()=>{
  const caminhosChamados=[];
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    caminhosChamados.push(body.path.split('?')[0]);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/forca-de-vendas/comissoes-vendedores')){
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?[{cnpj:'12345678000199',clienteKey:1,vendedorExternoKey:7,vendedorExternoNome:'João Vendas',numeroNotaFiscalOrigem:12345}]:[]})};
    }
    if(body.path.startsWith('/api/forca-de-vendas/vendedores')){
      return {ok:true,text:async()=>JSON.stringify({data:[{vendedorExternoKey:7,vendedorNomeAbreviado:'João Vendas',vendedorEmail:'joao@x.com',gerenteNomeAbreviado:'Maria Gerente',gerenteEmail:'maria@x.com',supervisorNomeAbreviado:'Pedro Supervisor',supervisorEmail:'pedro@x.com'}]})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const w=loadServico(fetchMock);
  const notas=[{ chave:'X', numeroNota:'12345', destinatarioCnpj:'12345678000199' }];
  const enriquecidas=await w.enriquecerNotasComVendedorPorComissao(notas,{dataInicial:'01/07/2026',dataFinal:'19/08/2026'});
  assert.ok(!caminhosChamados.some(p=>p.startsWith('/api/clientes')),'nunca deveria consultar o cadastro de clientes inteiro');
  assert.ok(!caminhosChamados.some(p=>p.startsWith('/api/forca-de-vendas/grupos-economicos')),'nunca deveria varrer grupos econômicos');
  assert.equal(enriquecidas[0].vendedorNome,'João Vendas');
  assert.equal(enriquecidas[0].vendedorEmail,'joao@x.com');
  assert.equal(enriquecidas[0].supervisorNome,'Pedro Supervisor');
  assert.ok(!('gerenteNome' in enriquecidas[0]),'gerente removido a pedido do usuário');
});

test('enriquecerNotasComVendedorPorComissao casa PRIORITARIAMENTE pelo número da NF, e por CNPJ só como reserva',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/forca-de-vendas/comissoes-vendedores')){
      const dados=[
        {cnpj:'11111111000100',clienteKey:1,vendedorExternoKey:7,vendedorExternoNome:'Vendedor Pela NF',numeroNotaFiscalOrigem:999},
        {cnpj:'22222222000100',clienteKey:2,vendedorExternoKey:8,vendedorExternoNome:'Vendedor Pelo CNPJ',numeroNotaFiscalOrigem:''},
      ];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?dados:[]})};
    }
    if(body.path.startsWith('/api/forca-de-vendas/vendedores')){
      const vk=Number(qs.get('vendedorKey'));
      return {ok:true,text:async()=>JSON.stringify({data:[{vendedorExternoKey:vk,vendedorNomeAbreviado:'Vendedor '+vk}]})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const w=loadServico(fetchMock);
  // nota A: número de NF bate com o registro do vendedorExternoKey=7 (mesmo com CNPJ diferente no cadastro da nota)
  // nota B: sem número batendo, casa só pelo CNPJ (vendedorExternoKey=8)
  const notas=[
    { chave:'A', numeroNota:'999', destinatarioCnpj:'99999999000100' },
    { chave:'B', numeroNota:'000', destinatarioCnpj:'22222222000100' },
  ];
  const enriquecidas=await w.enriquecerNotasComVendedorPorComissao(notas,{dataInicial:'01/07/2026',dataFinal:'19/08/2026'});
  assert.equal(enriquecidas[0].vendedorNome,'Vendedor Pela NF');
  assert.equal(enriquecidas[1].vendedorNome,'Vendedor Pelo CNPJ');
});

test('nota sem nenhum registro de comissão correspondente não quebra — só fica sem vendedor preenchido',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0 && body.path.startsWith('/api/forca-de-vendas/comissoes-vendedores')?[]:[]})};
  };
  const w=loadServico(fetchMock);
  const notas=[{ chave:'X', numeroNota:'1', destinatarioCnpj:'00000000000000' }];
  const enriquecidas=await w.enriquecerNotasComVendedorPorComissao(notas,{});
  assert.equal(enriquecidas[0].vendedorNome,undefined);
  assert.equal(enriquecidas[0].chave,'X');
});

test('se a busca de comissões falhar (timeout, etc.), devolve as notas originais sem quebrar',async()=>{
  const fetchMock=async()=>({ok:false,status:500,text:async()=>'erro interno'});
  const w=loadServico(fetchMock);
  const notas=[{ chave:'X', numeroNota:'1' }];
  const enriquecidas=await w.enriquecerNotasComVendedorPorComissao(notas,{});
  assert.equal(enriquecidas.length,1);
  assert.equal(enriquecidas[0].chave,'X');
});

test('BUG AO VIVO REAL ("muitos mercados não trouxe [o vendedor]"): nota que JÁ chega com vendedor preenchido (ex.: venda faturada, via lookup direto por vendedorKey) NUNCA é sobrescrita pela comissão, mesmo quando bate por número de NF/CNPJ',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/forca-de-vendas/comissoes-vendedores')){
      // bate por CNPJ com a nota — mas o vendedorKey=8 dessa comissão
      // FALHA no lookup abaixo (simula 429/timeout), o que antes apagava o
      // vendedor bom que a nota já tinha.
      const dados=[{cnpj:'12345678000199',clienteKey:1,vendedorExternoKey:8,vendedorExternoNome:'',numeroNotaFiscalOrigem:''}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?dados:[]})};
    }
    if(body.path.startsWith('/api/forca-de-vendas/vendedores')) return {ok:false,status:429,text:async()=>'limite de requisições'};
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  };
  const w=loadServico(fetchMock);
  const notas=[{ chave:'X', numeroNota:'9001', destinatarioCnpj:'12345678000199', vendedorNome:'João Vendas (já resolvido)', vendedorEmail:'joao@x.com', supervisorNome:'Pedro Supervisor' }];
  const enriquecidas=await w.enriquecerNotasComVendedorPorComissao(notas,{dataInicial:'01/07/2026',dataFinal:'19/08/2026'});
  assert.equal(enriquecidas[0].vendedorNome,'João Vendas (já resolvido)','nunca sobrescreve vendedor que a nota já trouxe');
  assert.equal(enriquecidas[0].supervisorNome,'Pedro Supervisor');
});

test('lista de notas vazia não faz nenhuma chamada',async()=>{
  let chamou=false;
  const w=loadServico(async()=>{ chamou=true; return {ok:true,text:async()=>'{}'}; });
  const r=await w.enriquecerNotasComVendedorPorComissao([],{});
  assert.equal(chamou,false);
  assert.equal(r.length,0);
});
