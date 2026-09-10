// FASE 4 do módulo "Notas Retornadas": busca e normalização das notas via
// GET /api/estoques/notas-fiscais — endpoint ainda SEM chamada real
// confirmada (ao contrário de status-processamento-nfe/recebimentocargas,
// já comprovados em produção). Por isso obterNotasRetornoBluesoft() nunca
// grava sozinha no Firestore — só busca+normaliza; a gravação fica na
// pré-visualização do Analista (97-recebimento-recusas.js).
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
// `recebimentoNotas` simula a coleção `recebimento_notas`, JÁ sincronizada
// por sincronizarRecebimentoBluesoft() — a mesma fonte que o Dashboard
// (91-logistica-recebimento.js) usa pro contador "N devolução(ões) não
// contam como recebimento". `getDTFirestore().collection('recebimento_notas')`
// pode ser uma função (lança erro) pra simular falha nessa fonte.
function loadServico(fetchMock,loja,recebimentoNotas){
  const document={addEventListener:()=>{}};
  const colecaoRecebimentoNotas=typeof recebimentoNotas==='function'
    ? {get:recebimentoNotas}
    : {get:async()=>({docs:(recebimentoNotas||[]).map(d=>({data:()=>d}))})};
  const window={
    fetch:fetchMock,
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'idtoken'}})},
    getDTRawFirestore:()=>mockRawFirestore(loja),
    getDTFirestore:()=>({collection:(nome)=>nome==='recebimento_notas'?colecaoRecebimentoNotas:{get:async()=>({docs:[]}),doc:()=>({id:'novo'})}}),
    getDTLojaAtiva:()=>'loja1',
  };
  vm.runInNewContext(servicoCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON,AbortController,setTimeout,clearTimeout},{filename:'90-bluesoft-service.js'});
  return window;
}

test('_normalizarNotaRetorno preserva os campos reais do schema (NotasFiscaisConsultarResponse) sem inventar nomes',()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}),{});
  const bruta={
    nfChave:'35260800123456780001235500100000123412345673', nfNumero:12345, nfSerie:1, cfop:'1202',
    dataEmissao:'2026-08-10', dataSaida:null, dataRecebimento:'2026-08-12', valorTotalNota:450.9,
    nomeRazaoFornecedor:'Mercado Atacadão LTDA', cpfCnpjFornecedor:'12345678000199',
    itens:[
      {produtoKey:1,descricao:'Refrigerante 2L',quantidade:12,gtin:'789',ncm:'2202',notaFiscalOrigem:{chave:'ORIGEM123',numero:999,serie:1}},
      {produtoKey:2,descricao:'Água 500ml',quantidade:6,gtin:'790',ncm:'2201'},
    ],
  };
  const norm=w._bluesoftServiceInternals._normalizarNotaRetorno(bruta);
  assert.equal(norm.chave,'35260800123456780001235500100000123412345673');
  assert.equal(norm.numeroNota,'12345');
  assert.equal(norm.serie,'1');
  assert.equal(norm.cfop,'1202');
  assert.equal(norm.destinatarioNome,'Mercado Atacadão LTDA');
  assert.equal(norm.destinatarioCnpj,'12345678000199');
  assert.equal(norm.itens.length,2);
  // vm.runInNewContext roda num realm à parte — deepEqual falharia por
  // não-igualdade referencial de protótipo mesmo com a mesma estrutura;
  // por isso comparação campo a campo, não deepEqual do objeto inteiro.
  assert.equal(norm.itens[0].produtoKey,1);
  assert.equal(norm.itens[0].descricao,'Refrigerante 2L');
  assert.equal(norm.itens[0].quantidade,12);
  assert.equal(norm.itens[0].gtin,'789');
  assert.equal(norm.itens[0].ncm,'2202');
  assert.equal(norm.notaOriginalChave,'ORIGEM123');
  assert.equal(norm.notaOriginalNumero,'999');
  assert.equal(norm.pareceDevolucao,true); // CFOP 1202 é devolução de venda
  assert.equal(norm.naturezaLabel,'Devolução'); // pedido ao vivo do usuário: "quero que venha só devolução ou venda"
  assert.equal(norm.origemImportacao,'BLUESOFT');
});

test('naturezaLabel é sempre "Devolução" ou "Venda" — nunca o CFOP cru ou um rótulo fiscal detalhado (pedido ao vivo do usuário)',()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}),{});
  assert.equal(w._bluesoftServiceInternals._normalizarNotaRetorno({cfop:'1202'}).naturezaLabel,'Devolução');
  assert.equal(w._bluesoftServiceInternals._normalizarNotaRetorno({cfop:'1102'}).naturezaLabel,'Venda'); // compra normal — não é devolução, então cai no outro balde
  assert.equal(w._bluesoftServiceInternals._normalizarNotaRetorno({cfop:'9999'}).naturezaLabel,'Venda'); // desconhecido também cai em "Venda", nunca mostra o CFOP cru
});

test('_pareceDevolucao é só um sinal — não confunde CFOP de venda normal, mas pega natureza em texto livre mesmo sem CFOP de devolução',()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}),{});
  assert.equal(w._bluesoftServiceInternals._pareceDevolucao({cfop:'5102'}),false); // venda normal
  assert.equal(w._bluesoftServiceInternals._pareceDevolucao({cfop:'1202'}),true);
  assert.equal(w._bluesoftServiceInternals._pareceDevolucao({cfop:'','naturezaOperacao':'Dev.compra com.em op.merc.suj.reg.sub.trib.'}),true);
  assert.equal(w._bluesoftServiceInternals._pareceDevolucao({cfop:'','naturezaOperacao':'Venda de mercadoria'}),false);
});

// obterNotasRetornoBluesoft busca em DUAS fontes em paralelo desde
// 2026-08-19 (bug ao vivo real: "no dasboard tava vindo tudo, aqui não vem
// nenhuma" — a via principal só pega nota com dataRecebimento já
// preenchida, ou seja, já processada no estoque; devolução recém-emitida,
// ainda "em aberto", nunca tem esse campo e por isso nunca aparecia).
//
// A PRIMEIRA versão da segunda fonte usava /api/forca-de-vendas/comissoes-
// vendedores (tipoPedido=DEVOLUCAO) — deu timeout numa rodada, e depois de
// corrigir o timeout, voltou 0 registros. Usuário questionou com razão: "o
// que tem a ver a comissão com a nota?" e apontou que o Dashboard (outra
// tela deste MESMO app) "tava puxando todas as notas de devolução".
// Investigado: o Dashboard usa `recebimento_notas`, sincronizado por
// sincronizarRecebimentoBluesoft() via /api/estoque/recebimento/status-
// processamento-nfe — um endpoint PROVADO em produção. Reescrito pra
// reaproveitar essa MESMA coleção já sincronizada como fonte de descoberta,
// com um lookup targetado por chave (não em lote) só pra enriquecer
// CFOP/itens/destinatário.
function mockFetchNotasFiscais(notasFiscais, porChave, opts){
  opts = opts || {};
  const caminhos=[];
  return { caminhos, fetchMock: async(_url,reqOpts)=>{
    const body=JSON.parse(reqOpts.body);
    const rota=body.path.split('?')[0];
    caminhos.push(body.path);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    if(rota==='/api/estoques/notas-fiscais'){
      const chaveFiltro=qs.get('nfChave');
      if(chaveFiltro){
        // lookup targetado por chave (usado pra enriquecer devolução
        // descoberta via recebimento_notas) — não é paginado em lote.
        const achou=(porChave||{})[chaveFiltro];
        return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:10,data:achou?[achou]:[]})};
      }
      const page=Number(qs.get('currentPage'));
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?(notasFiscais||[]):[]})};
    }
    // Venda faturada ainda não entregue — GET /api/forca-de-vendas/pedidos
    // (cada pedido já traz clientes[] com nfChave/nfNumero direto — sem
    // lookup adicional por nota) + /api/clientes (nome/CNPJ por clienteKey).
    if(rota==='/api/forca-de-vendas/pedidos'){
      const page=Number(qs.get('currentPage'));
      const porStatus=opts.pedidosForcaVendaPorStatus;
      const dados=porStatus ? (porStatus[qs.get('pedidoVendaStatus')]||[]) : (opts.pedidosForcaVenda||[]);
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?dados:[]})};
    }
    if(rota==='/api/clientes'){
      const achou=(opts.clientesPorKey||{})[qs.get('clienteKey')];
      return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:1,data:achou?[achou]:[]})};
    }
    if(rota==='/api/forca-de-vendas/vendedores'){
      const achou=(opts.vendedoresPorKey||{})[qs.get('vendedorKey')];
      return {ok:true,text:async()=>JSON.stringify({data:achou?[achou]:[]})};
    }
    if(rota==='/api/comercial/produtos'){
      const achou=(opts.produtosPorKey||{})[qs.get('produtoKey')];
      return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:1,data:achou?[achou]:[]})};
    }
    return {ok:true,text:async()=>JSON.stringify({currentPage:0,pageSize:200,data:[]})};
  }};
}

test('obterNotasRetornoBluesoft, quando dias é passado explicitamente, busca com tipoNota=ENTRADA e janela de até 30 dias, sem gravar nada sozinha',async()=>{
  const {caminhos,fetchMock}=mockFetchNotasFiscais([{nfChave:'X1',nfNumero:1,cfop:'1202',nomeRazaoFornecedor:'Cliente A',itens:[]}]);
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({dias:15});
  const pathEntrada=caminhos.find(p=>p.startsWith('/api/estoques/notas-fiscais'));
  assert.ok(pathEntrada,'a via principal (notas-fiscais) precisa ter sido chamada');
  assert.match(pathEntrada,/tipoNota=ENTRADA/);
  assert.match(pathEntrada,/lojaKey=LK1/);
  assert.match(pathEntrada,/dataRecebimentoInicial=/);
  assert.equal(notas.length,1);
  assert.equal(notas[0].chave,'X1');
  assert.equal(notas[0].pareceDevolucao,true);
});

test('REGRESSÃO (bug ao vivo real: uma rodada anterior removeu o filtro de data pra tentar achar mais devolução, mas em teste real isso ZEROU o resultado — a Bluesoft exige data junto de lojaKey nesse endpoint) — sem `dias` explícito (uso normal do botão), continua mandando lojaKey+tipoNota+dataRecebimentoInicial/Final',async()=>{
  const {caminhos,fetchMock}=mockFetchNotasFiscais([{nfChave:'X1',nfNumero:1,cfop:'1202'}]);
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({});
  const pathEntrada=caminhos.find(p=>p.startsWith('/api/estoques/notas-fiscais'));
  assert.ok(pathEntrada);
  assert.match(pathEntrada,/tipoNota=ENTRADA/);
  assert.match(pathEntrada,/lojaKey=LK1/);
  assert.match(pathEntrada,/dataRecebimentoInicial=/);
  assert.match(pathEntrada,/dataRecebimentoFinal=/);
  assert.equal(notas.length,1);
});

// BUG AO VIVO REAL (usuário: "não esquece que tem que puxar as notas de
// devolução que não foram dado entrada no nosso sistema ainda") —
// confirmado ao vivo contra a API real que a nota MAIS pendente de todas
// (só chegou a ser logada, ninguém mexeu ainda) não tem `dataRecebimento`
// preenchido, só `processamento`. Por isso o teste abaixo NÃO define
// dataRecebimento — é exatamente esse o caso que precisa aparecer.
test('PEDIDO AO VIVO: devolução ainda não recebida (sem dataRecebimento, só processamento) aparece mesmo assim, via recebimento_notas (JÁ sincronizado pelo Dashboard) + lookup targetado por chave',async()=>{
  const agora=new Date().toISOString();
  const recebimentoNotas=[
    { chaveNota:'CHAVE-EM-ABERTO', numeroNota:777, serieNota:1, valor:120.5, natureza:'Devolução de venda', processamento:agora, cnpjRemetente:'12345678000199' },
  ];
  const brutaEnriquecida={ nfChave:'CHAVE-EM-ABERTO', nfNumero:777, nfSerie:1, cfop:'1202', valorTotalNota:120.5, nomeRazaoFornecedor:'Mercado Y', cpfCnpjFornecedor:'12345678000199', itens:[{produtoKey:9,descricao:'Item X',quantidade:3}] };
  const {caminhos,fetchMock}=mockFetchNotasFiscais([],{'CHAVE-EM-ABERTO':brutaEnriquecida}); // via principal (bulk) não devolve NADA — é exatamente o caso "em aberto"
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},recebimentoNotas);
  const notas=await w.obterNotasRetornoBluesoft({});
  const pathTargetado=caminhos.find(p=>p.startsWith('/api/estoques/notas-fiscais')&&p.includes('nfChave='));
  assert.ok(pathTargetado,'precisa ter feito o lookup targetado pela chave descoberta em recebimento_notas');
  // REGRESSÃO (bug ao vivo real: "Failed to load resource ... 400" ×15) —
  // NotasFiscaisConsultarRequest exige lojaKey OU as duas datas SEMPRE;
  // nfChave sozinho não bastava e a Bluesoft rejeitava com 400.
  assert.match(pathTargetado,/lojaKey=LK1/,'lookup por chave sem lojaKey é rejeitado pela Bluesoft com 400');
  assert.equal(notas.length,1,'a devolução em aberto precisa aparecer mesmo sem vir pela via principal em lote');
  assert.equal(notas[0].chave,'CHAVE-EM-ABERTO');
  assert.equal(notas[0].numeroNota,'777');
  assert.equal(notas[0].naturezaLabel,'Devolução');
  assert.equal(notas[0].destinatarioNome,'Mercado Y');
  assert.equal(notas[0].itens.length,1);
  assert.equal(notas[0].itens[0].quantidade,3);
});

// PEDIDO AO VIVO (usuário, com print real das telas do Bluesoft
// "Acompanhamento de Faturamento" e "Consultar Notas Fiscais": "hoje ela
// tras notas canceladas e recusadas, também não é para vim essas notas") —
// confirmado ao vivo que a Bluesoft usa "Status da NF-e"
// (Autorizada/Rejeitada/Inutilizada) e "Status" (Cancelada/Não Cancelada).
// O campo `status` de recebimento_notas (StatusProcessamentoNfeResponse,
// texto livre, sem enum documentado) é a fonte real desse dado.
test('BUG AO VIVO REAL: nota com status Cancelada/Rejeitada/Inutilizada não aparece em Notas Retornadas, mesmo parecendo devolução',async()=>{
  const agora=new Date().toISOString();
  const recebimentoNotas=[
    { chaveNota:'CHAVE-OK', numeroNota:1, natureza:'Devolução de venda', processamento:agora, status:'Autorizada' },
    { chaveNota:'CHAVE-CANCELADA', numeroNota:2, natureza:'Devolução de venda', processamento:agora, status:'Cancelada' },
    { chaveNota:'CHAVE-REJEITADA', numeroNota:3, natureza:'Devolução de venda', processamento:agora, status:'Rejeitada' },
    { chaveNota:'CHAVE-INUTILIZADA', numeroNota:4, natureza:'Devolução de venda', processamento:agora, status:'Inutilizada' },
    { chaveNota:'CHAVE-SEM-STATUS', numeroNota:5, natureza:'Devolução de venda', processamento:agora }, // campo ausente — nunca trava/exclui à toa
  ];
  const {fetchMock}=mockFetchNotasFiscais([],{});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},recebimentoNotas);
  const notas=await w.obterNotasRetornoBluesoft({});
  // Array.from (não .map()) — `notas` veio de dentro do vm.runInNewContext
  // (outro realm); .map() herdaria o Array daquele realm e deepEqual
  // falharia por não-igualdade de protótipo mesmo com conteúdo idêntico.
  const chaves=Array.from(notas,n=>n.chave).sort();
  assert.deepEqual(chaves,['CHAVE-OK','CHAVE-SEM-STATUS'],'só a nota Autorizada e a sem status (campo não veio) devem aparecer — Cancelada/Rejeitada/Inutilizada ficam de fora');
});

test('quando o lookup targetado falha pra uma devolução específica, ela ainda aparece com os dados básicos de recebimento_notas (nunca some da lista)',async()=>{
  const agora=new Date().toISOString();
  const recebimentoNotas=[
    { chaveNota:'CHAVE-SEM-ENRIQUECIMENTO', numeroNota:555, valor:80, natureza:'Retorno de mercadoria', processamento:agora, statusRecebimento:'Receber', cnpjRemetente:'99999999000100' },
  ];
  const {fetchMock}=mockFetchNotasFiscais([],{}); // lookup targetado não acha nada de volta (data:[])
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},recebimentoNotas);
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,1);
  assert.equal(notas[0].chave,'CHAVE-SEM-ENRIQUECIMENTO');
  assert.equal(notas[0].numeroNota,'555');
  assert.equal(notas[0].naturezaLabel,'Devolução');
  assert.equal(notas[0].destinatarioCnpj,'99999999000100');
  assert.equal(notas[0].statusRecebimento,'Receber','o status "ainda não recebida" precisa sobreviver até a tela');
});

test('BUG AO VIVO REAL ("achei nota de devolução, e ta puxando notas de vendas, mas nós sendo o destino"): a fonte de ENTRADA nunca mostra uma compra normal (não-devolução) como "Venda" — só devolução passa',async()=>{
  const notasFiscais=[
    { nfChave:'DEV-1', nfNumero:1, cfop:'1202', nomeRazaoFornecedor:'Cliente Que Devolveu', itens:[] }, // devolução de venda — deve aparecer
    { nfChave:'COMPRA-1', nfNumero:2, cfop:'1102', nomeRazaoFornecedor:'Fornecedor Comum', itens:[] }, // compra normal — NÃO é devolução nem venda, não devia aparecer aqui
  ];
  const {fetchMock}=mockFetchNotasFiscais(notasFiscais);
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,1,'a compra normal (não-devolução) precisa ser filtrada fora — venda de verdade só vem da 3ª fonte, com a loja como remetente');
  assert.equal(notas[0].chave,'DEV-1');
  assert.equal(notas[0].naturezaLabel,'Devolução');
  assert.ok(!notas.some(n=>n.chave==='COMPRA-1'),'compra de fornecedor nunca deveria aparecer rotulada como "Venda" — a loja é destinatária aqui, não remetente');
});

test('devolução que JÁ veio pela via principal (mesma chave) não aparece duplicada quando também está em recebimento_notas',async()=>{
  const agora=new Date().toISOString();
  const notasFiscais=[{nfChave:'MESMA-CHAVE',nfNumero:888,cfop:'1202',nomeRazaoFornecedor:'Cliente Dup',itens:[]}];
  const recebimentoNotas=[{ chaveNota:'MESMA-CHAVE', numeroNota:888, natureza:'Devolução', processamento:agora }];
  const {fetchMock}=mockFetchNotasFiscais(notasFiscais,{});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},recebimentoNotas);
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,1,'não pode duplicar a mesma nota vinda das duas fontes');
});

test('nota de recebimento_notas fora da janela de dias (processamento antigo) não entra na busca',async()=>{
  const antiga=new Date(); antiga.setDate(antiga.getDate()-60);
  const recebimentoNotas=[{ chaveNota:'CHAVE-ANTIGA', numeroNota:1, natureza:'Devolução', processamento:antiga.toISOString() }];
  const {fetchMock}=mockFetchNotasFiscais([],{});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},recebimentoNotas);
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,0);
});

// PEDIDO AO VIVO (usuário: "é para ve notas faturadas ainda nao entregues
// mercador e todas as outras informações e atraves do mercado trazer o
// vendedor e o supervisor") — HISTÓRICO: a primeira tentativa usou
// /api/venda/pedidovenda, testado ao vivo contra a API real e CONFIRMADO
// sem nenhuma atividade de 2026 (nem em homologação). Usuário mandou print
// de dentro do próprio Bluesoft mostrando 6.732 pedidos reais de
// junho/2026 numa tela DIFERENTE: "Pedido Força de Venda" — objeto
// diferente no schema. Endpoint certo, confirmado ao vivo com o token
// real: GET /api/forca-de-vendas/pedidos (request PedidosConsultarRequest,
// filtra por filialKey+dataEmissaoInicial/Final+pedidoVendaStatus ÚNICO,
// não array). Cada pedido tem clientes[], e CADA cliente já traz
// nfChave/nfNumero/nfSerie DIRETO — nenhum lookup extra por nota. Nome do
// cliente vem de um lookup targetado em /api/clientes por clienteKey.
test('PEDIDO AO VIVO: venda faturada ainda não entregue (status FATURADO_POR_NOTA_FISCAL) aparece com cliente, itens e vendedor/supervisor (gerente removido a pedido do usuário)',async()=>{
  const pedidosForcaVenda=[{
    pedidoForcaVendaKey:555, dataEmissao:'15/08/2026 10:00', vendedorExternoKey:7,
    itens:[{produtoKey:1,quantidadePedida:12,clienteKey:42}],
    clientes:[{clienteKey:42, nfChave:'CHAVE-VENDA-555', nfNumero:9001, nfSerie:'1', valorNf:340.9, pedidoVendaStatus:'FATURADO_POR_NOTA_FISCAL'}],
  }];
  const clientesPorKey={'42':{clienteKey:42, nomeRazao:'Mercado Central LTDA', cpfCnpj:'12345678000199'}};
  const vendedoresPorKey={'7':{vendedorExternoKey:7,vendedorNomeAbreviado:'João Vendas',vendedorEmail:'joao@x.com',gerenteNomeAbreviado:'Maria Gerente',gerenteEmail:'maria@x.com',supervisorNomeAbreviado:'Pedro Supervisor',supervisorEmail:'pedro@x.com'}};
  const {caminhos,fetchMock}=mockFetchNotasFiscais([],{},{pedidosForcaVenda,clientesPorKey,vendedoresPorKey});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({});
  const pathPedidos=caminhos.find(p=>p.startsWith('/api/forca-de-vendas/pedidos?'));
  assert.ok(pathPedidos,'precisa ter chamado a listagem de pedidos de força de venda');
  assert.match(pathPedidos,/pedidoVendaStatus=FATURADO_POR_NOTA_FISCAL/);
  assert.match(pathPedidos,/filialKey=LK1/);
  assert.match(pathPedidos,/dataEmissaoInicial=/);
  assert.match(pathPedidos,/dataEmissaoFinal=/);
  assert.equal(notas.length,1);
  assert.equal(notas[0].chave,'CHAVE-VENDA-555');
  assert.equal(notas[0].numeroNota,'9001');
  assert.equal(notas[0].naturezaLabel,'Venda');
  assert.equal(notas[0].destinatarioNome,'Mercado Central LTDA');
  assert.equal(notas[0].itens[0].produtoKey,1);
  assert.equal(notas[0].vendedorNome,'João Vendas');
  assert.equal(notas[0].supervisorNome,'Pedro Supervisor');
  assert.ok(!('gerenteNome' in notas[0]),'gerente foi removido (pedido ao vivo: "sempre será 1 pq de gerente só tem ele")');
  assert.equal(notas.diagnosticoTerceiraFonte.ok,true);
  assert.equal(notas.diagnosticoTerceiraFonte.totalExtras,1);
});

// PEDIDO AO VIVO (usuário: "na conferencia quando aparece os produtos ele
// ta trazendo é o codigo do produto, tem que trazer a descrição") —
// /api/forca-de-vendas/pedidos nunca traz descrição de item, só
// produtoKey; lookup targetado em /api/comercial/produtos?produtoKey=X,
// mesmo padrão já usado pra cliente/vendedor.
test('PEDIDO AO VIVO: item de venda faturada vem com descrição do produto (lookup targetado por produtoKey), não só o código',async()=>{
  const pedidosForcaVenda=[{
    pedidoForcaVendaKey:555, dataEmissao:'15/08/2026 10:00', vendedorExternoKey:7,
    itens:[{produtoKey:1,quantidadePedida:12,clienteKey:42},{produtoKey:2,quantidadePedida:3,clienteKey:42}],
    clientes:[{clienteKey:42, nfChave:'CHAVE-VENDA-555', nfNumero:9001, nfSerie:'1', valorNf:340.9, pedidoVendaStatus:'FATURADO_POR_NOTA_FISCAL'}],
  }];
  const clientesPorKey={'42':{clienteKey:42, nomeRazao:'Mercado Central LTDA', cpfCnpj:'12345678000199'}};
  const produtosPorKey={'1':{produtoKey:1,descricao:'Refrigerante 2L'},'2':{produtoKey:2,descricao:'Água 500ml'}};
  const {caminhos,fetchMock}=mockFetchNotasFiscais([],{},{pedidosForcaVenda,clientesPorKey,produtosPorKey});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({});
  const pathsProdutos=caminhos.filter(p=>p.startsWith('/api/comercial/produtos?'));
  assert.equal(pathsProdutos.length,2,'um lookup targetado por produtoKey único');
  assert.equal(notas.length,1);
  assert.equal(notas[0].itens.length,2);
  assert.equal(notas[0].itens[0].descricao,'Refrigerante 2L');
  assert.equal(notas[0].itens[1].descricao,'Água 500ml');
});

test('quando o lookup de produto falha pra uma nota, o item ainda aparece só sem descrição (não trava as outras)',async()=>{
  const pedidosForcaVenda=[{
    pedidoForcaVendaKey:555, itens:[{produtoKey:1,quantidadePedida:12,clienteKey:42}],
    clientes:[{clienteKey:42, nfChave:'CHAVE-VENDA-555', nfNumero:9001, pedidoVendaStatus:'FATURADO_POR_NOTA_FISCAL'}],
  }];
  const {fetchMock}=mockFetchNotasFiscais([],{},{pedidosForcaVenda,produtosPorKey:{}});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,1);
  assert.equal(notas[0].itens[0].descricao,'');
});

// BUG AO VIVO REAL (usuário: "tinha um monte de nota que nao foi
// entregue ali puxou so 4 notas de venda") — só FATURADO_POR_NOTA_FISCAL
// era buscado, faltando FATURADO_POR_CUPOM e ROTEIRIZADO (todos contam
// como "faturado, ainda não entregue" — só ENTREGUE sai desse grupo).
test('PEDIDO AO VIVO: busca os 3 status que significam "faturado, ainda não entregue" (não só um)',async()=>{
  const pedidosForcaVendaPorStatus={
    FATURADO_POR_NOTA_FISCAL:[{pedidoForcaVendaKey:1,itens:[],clientes:[{clienteKey:1,nfChave:'CH1',nfNumero:1}]}],
    FATURADO_POR_CUPOM:[{pedidoForcaVendaKey:2,itens:[],clientes:[{clienteKey:2,nfChave:'CH2',nfNumero:2}]}],
    ROTEIRIZADO:[{pedidoForcaVendaKey:3,itens:[],clientes:[{clienteKey:3,nfChave:'CH3',nfNumero:3}]}],
  };
  const {caminhos,fetchMock}=mockFetchNotasFiscais([],{},{pedidosForcaVendaPorStatus});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({});
  const pathsPedidos=caminhos.filter(p=>p.startsWith('/api/forca-de-vendas/pedidos?'));
  ['FATURADO_POR_NOTA_FISCAL','FATURADO_POR_CUPOM','ROTEIRIZADO'].forEach(status=>{
    assert.ok(pathsPedidos.some(p=>p.includes('pedidoVendaStatus='+status)),`precisa ter buscado o status ${status}`);
  });
  assert.equal(notas.length,3,'os 3 status juntos, sem duplicar');
});

test('cliente do pedido sem NF gerada ainda (nem nfChave nem nfNumero) não entra na lista — nada pra ligar a uma nota',async()=>{
  const pedidosForcaVenda=[{pedidoForcaVendaKey:999, itens:[], clientes:[{clienteKey:1, pedidoVendaStatus:'ROTEIRIZADO'}]}];
  const {fetchMock}=mockFetchNotasFiscais([],{},{pedidosForcaVenda});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,0);
});

test('se a fonte de venda faturada falhar, as outras duas continuam funcionando normalmente (melhor esforço)',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const rota=body.path.split('?')[0];
    if(rota==='/api/forca-de-vendas/pedidos') return {ok:false,status:500,text:async()=>'erro interno'};
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?[{nfChave:'X1',nfNumero:1,cfop:'1202'}]:[]})};
  };
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,1);
  assert.equal(notas[0].chave,'X1');
  assert.equal(notas.diagnosticoTerceiraFonte.ok,false);
});

test('se a segunda fonte (recebimento_notas) falhar, a via principal continua funcionando normalmente (melhor esforço)',async()=>{
  const {fetchMock}=mockFetchNotasFiscais([{nfChave:'X1',nfNumero:1,cfop:'1202'}]);
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},async()=>{throw new Error('permissão negada na coleção');});
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,1);
  assert.equal(notas[0].chave,'X1');
  // PEDIDO AO VIVO (usuário mandou "ai" depois de testar uma correção
  // anterior e ver a MESMA tela de antes): sem esse diagnóstico exposto,
  // uma falha silenciosa na segunda fonte parece igual a "não tinha nada
  // mesmo" — e ninguém descobre que a busca extra nem chegou a funcionar.
  assert.equal(notas.diagnosticoSegundaFonte.ok,false);
  assert.match(notas.diagnosticoSegundaFonte.erro,/permissão negada/);
});

test('diagnosticoSegundaFonte reporta quantas devoluções vieram de recebimento_notas e quantas viraram nota NOVA (não duplicada)',async()=>{
  const agora=new Date().toISOString();
  const notasFiscais=[{nfChave:'X1',nfNumero:1,cfop:'1202'}]; // 1 nota pela via principal
  const recebimentoNotas=[
    { chaveNota:'X1', numeroNota:1, natureza:'Devolução', processamento:agora }, // mesma da via principal — não conta como extra
    { chaveNota:'X2', numeroNota:2, natureza:'Devolução', processamento:agora, valor:50 }, // essa sim é nova
  ];
  const {fetchMock}=mockFetchNotasFiscais(notasFiscais,{});
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'},recebimentoNotas);
  const notas=await w.obterNotasRetornoBluesoft({});
  assert.equal(notas.length,2);
  assert.equal(notas.diagnosticoSegundaFonte.ok,true);
  assert.equal(notas.diagnosticoSegundaFonte.totalBruto,2);
  assert.equal(notas.diagnosticoSegundaFonte.totalExtras,1);
});

test('obterNotasRetornoBluesoft exige loja vinculada à Bluesoft, mesma mensagem de erro das outras sincronizações',async()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}),{nome:'Loja sem vínculo'});
  await assert.rejects(w.obterNotasRetornoBluesoft(), /bluesoft_loja_key/);
});

// Pedido ao vivo do usuário: "consegue ler o XML das notas de devolução,
// lá dentro tem o motivo da devolução" — GET /api/estoques/notas-fiscais/
// xml/{nfChave} devolve um link S3 pré-assinado (URL_S3), não o XML
// direto; o motivo real fica em <infCpl> dentro do XML baixado desse link.
test('_extrairInfCplDoXml pega o texto de <infCpl> e decodifica entidades XML básicas',()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}),{});
  const xml='<nfeProc><infAdic><infCpl>Devolu&ccedil;&atilde;o ref NF 999 - avaria &amp; recusa</infCpl></infAdic></nfeProc>';
  // &ccedil;/&atilde; não são das 5 entidades básicas — só confere que as
  // básicas (&amp;) decodificam certo e o texto vem sem quebrar.
  assert.match(w._bluesoftServiceInternals._extrairInfCplDoXml(xml),/avaria & recusa/);
});
test('_extrairInfCplDoXml devolve vazio quando o XML não tem a tag',()=>{
  const w=loadServico(async()=>({ok:true,text:async()=>'{}'}),{});
  assert.equal(w._bluesoftServiceInternals._extrairInfCplDoXml('<nfeProc></nfeProc>'),'');
});

test('obterUrlXmlNota chama /api/estoques/notas-fiscais/xml/{chave} e devolve o campo URL_S3 do schema oficial',async()=>{
  let pathChamado='';
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    pathChamado=body.path;
    return {ok:true,text:async()=>JSON.stringify({URL_S3:'https://bucket.s3.amazonaws.com/notas/x.xml?assinatura=abc'})};
  };
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const url=await w._bluesoftServiceInternals.obterUrlXmlNota('35260800123456780001235500100000123412345673');
  assert.match(pathChamado,/^\/api\/estoques\/notas-fiscais\/xml\/35260800123456780001235500100000123412345673$/);
  assert.equal(url,'https://bucket.s3.amazonaws.com/notas/x.xml?assinatura=abc');
});

test('obterMotivoDevolucaoXml: busca o link (via proxy), baixa o XML DIRETO do S3 (sem passar pelo proxy) e extrai o motivo',async()=>{
  const BLUESOFT_PROXY_URL='https://southamerica-east1-daterrinha-inventario.cloudfunctions.net/bluesoftProxy';
  let chamouS3Direto=false;
  const fetchMock=async(url,opts)=>{
    if(url===BLUESOFT_PROXY_URL){
      const body=JSON.parse(opts.body);
      if(body.path.startsWith('/api/estoques/notas-fiscais/xml/')){
        return {ok:true,text:async()=>JSON.stringify({URL_S3:'https://bucket.s3.amazonaws.com/x.xml'})};
      }
      return {ok:true,text:async()=>'{}'};
    }
    // fetch direto do link S3 — SEM passar pelo bluesoftProxy (host fora
    // do domínio da Bluesoft, o proxy não aceitaria mesmo)
    if(url==='https://bucket.s3.amazonaws.com/x.xml'){
      chamouS3Direto=true;
      return {ok:true,text:async()=>'<nfeProc><infAdic><infCpl>Cliente recusou por avaria</infCpl></infAdic></nfeProc>'};
    }
    return {ok:false,status:404,text:async()=>''};
  };
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  const motivo=await w.obterMotivoDevolucaoXml('35260800123456780001235500100000123412345673');
  assert.ok(chamouS3Direto,'precisa buscar o XML direto do S3, não através do bluesoftProxy');
  assert.equal(motivo,'Cliente recusou por avaria');
});

test('obterMotivoDevolucaoXml propaga erro quando o download do XML falha (link expirado, por exemplo)',async()=>{
  const BLUESOFT_PROXY_URL='https://southamerica-east1-daterrinha-inventario.cloudfunctions.net/bluesoftProxy';
  const fetchMock=async(url,opts)=>{
    if(url===BLUESOFT_PROXY_URL) return {ok:true,text:async()=>JSON.stringify({URL_S3:'https://bucket.s3.amazonaws.com/x.xml'})};
    return {ok:false,status:403,text:async()=>'expired'};
  };
  const w=loadServico(fetchMock,{nome:'Loja 1',bluesoft_loja_key:'LK1'});
  await assert.rejects(w.obterMotivoDevolucaoXml('35260800123456780001235500100000123412345673'), /HTTP 403/);
});
