const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');
const navCode=fs.readFileSync(path.join(base,'03-core-navigation.js'),'utf8');
const permCode=fs.readFileSync(path.join(base,'37-usuarios-permissoes.js'),'utf8');
const dashCode=fs.readFileSync(path.join(base,'91-logistica-recebimento.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');

function mockRawFirestore(loja){
  return {
    collection:(nome)=>{
      if(nome==='lojas') return {doc:()=>({get:async()=>({exists:true,data:()=>loja})})};
      if(nome==='dt_config') return {doc:()=>({get:async()=>({exists:true,data:()=>({token:'tok',url_hml:'https://hml.exemplo',ambiente:'homologacao',timeout:30})})})};
      return {doc:()=>({get:async()=>({exists:false})})};
    },
  };
}
// O SDK real do Firestore rejeita `undefined` em qualquer campo do payload
// (é exatamente o bug relatado ao vivo: "Unsupported field value: undefined
// (found in field notaFiscalKey)"). O mock validava isso frouxo demais —
// aceitava qualquer coisa — e por isso não pegou esse bug antes de ir pra
// produção. Replicando a mesma checagem aqui pra nunca mais passar batido.
function _validarSemUndefined(payload, docId){
  Object.keys(payload).forEach(k=>{
    if(payload[k]===undefined) throw new Error("Function WriteBatch.set() called with invalid data. Unsupported field value: undefined (found in field "+k+" in document .../"+docId+")");
  });
}
function mockColecao(docsIniciais){
  const registro=new Map(docsIniciais.map(d=>[d.id,d.data]));
  let seq=0;
  const colecao={
    get: async()=>({size:registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data}))}),
    doc: (id)=>{
      const docId=id||('novo'+(seq++));
      return { id:docId, set:(payload)=>{ _validarSemUndefined(payload,docId); const atual=registro.get(docId)||{}; registro.set(docId,{...atual,...payload}); } };
    },
  };
  return {colecao,registro};
}
function loadServico(fetchMock,loja,colecoes){
  const document={addEventListener:()=>{}};
  const window={
    fetch:fetchMock,
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'idtoken'}})},
    getDTRawFirestore:()=>({ ...mockRawFirestore(loja), batch:()=>{
      const ops=[];
      return { set:(ref,payload)=>ops.push(()=>ref.set(payload)), delete:(ref)=>ops.push(()=>colecoes[ref._col]?.registro.delete(ref.id)), commit: async()=>{ ops.forEach(fn=>fn()); } };
    }}),
    getDTFirestore:()=>({ collection:(nome)=>{ const c=colecoes[nome]?.colecao||{get:async()=>({docs:[]}),doc:()=>({id:'novo',set:()=>{}})}; return { ...c, doc:(id)=>({...c.doc(id),_col:nome}) }; } }),
    getDTLojaAtiva:()=>'loja1',
  };
  vm.runInNewContext(servicoCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON,AbortController,setTimeout,clearTimeout,isNaN},{filename:'90-bluesoft-service.js'});
  return window;
}
function paginaVazia(page){ return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:[]})}; }

test('_janelasMensais gera janelas de calendário (mês cheio), mais recente primeiro, sempre <=31 dias',()=>{
  const w=loadServico(async()=>paginaVazia(0),{nome:'Loja 1'});
  const janelas=w._bluesoftServiceInternals._janelasMensais(3);
  assert.equal(janelas.length,3);
  janelas.forEach(j=>{
    const [d1,m1,y1]=j.inicio.split('/').map(Number);
    const [d2,m2,y2]=j.fim.split('/').map(Number);
    const dias=(new Date(y2,m2-1,d2)-new Date(y1,m1-1,d1))/86400000;
    assert.ok(dias<=31,'janela não deve passar de 31 dias: '+j.inicio+' - '+j.fim);
  });
});

test('_ehDevolucao identifica pelo campo real da Bluesoft (tipoTransferencia), não por texto adivinhado — TRANSFERENCIA_ENTRE_LOJAS (transbordo) e COMPRA_ENTRE_LOJAS não contam como devolução',()=>{
  const w=loadServico(async()=>paginaVazia(0),{nome:'Loja 1'});
  const eh=w._bluesoftServiceInternals._ehDevolucao;
  assert.equal(eh({tipoTransferencia:'DEVOLUCAO_ENTRE_LOJAS'}),true);
  assert.equal(eh({tipoTransferencia:'DEVOLUCAO_CLIENTE'}),true);
  assert.equal(eh({tipoTransferencia:'TRANSFERENCIA_ENTRE_LOJAS'}),false); // transbordo
  assert.equal(eh({tipoTransferencia:'COMPRA_ENTRE_LOJAS'}),false);
  assert.equal(eh({tipoTransferencia:null}),false);
  assert.equal(eh({}),false);
});

test('REGRESSÃO: devolução de cliente ainda aparecia no dashboard porque não anda de carga/caminhão — nunca cruzava com tipoTransferencia e ficava null. Natureza (texto livre) entra como sinal extra, sem se confundir com venda/compra/transferência/bonificação',()=>{
  const w=loadServico(async()=>paginaVazia(0),{nome:'Loja 1'});
  const eh=w._bluesoftServiceInternals._ehDevolucao;
  assert.equal(eh({tipoTransferencia:null,natureza:'DEVOLUÇÃO DE VENDA'}),true);
  assert.equal(eh({tipoTransferencia:null,natureza:'devolucao de compra'}),true);
  assert.equal(eh({tipoTransferencia:null,natureza:'Devolução'}),true);
  assert.equal(eh({tipoTransferencia:null,natureza:'VENDA DE MERCADORIA'}),false);
  assert.equal(eh({tipoTransferencia:null,natureza:'COMPRA'}),false);
  assert.equal(eh({tipoTransferencia:null,natureza:'TRANSFERÊNCIA ENTRE FILIAIS'}),false);
  assert.equal(eh({tipoTransferencia:null,natureza:'BONIFICAÇÃO'}),false);
  assert.equal(eh({tipoTransferencia:null,natureza:''}),false);
  assert.equal(eh({tipoTransferencia:null,natureza:null}),false);
});

test('REGRESSÃO: natureza real de produção (dado ao vivo do usuário) usa descrição estilo CFOP abreviada — "Dev." não é pego por "DEVOL" inteiro, e "Retorno de mercadoria" também não conta como recebimento de fornecedor',()=>{
  const w=loadServico(async()=>paginaVazia(0),{nome:'Loja 1'});
  const eh=w._bluesoftServiceInternals._ehDevolucao;
  // valores reais vistos na tela de Notas Fiscais em produção
  assert.equal(eh({tipoTransferencia:null,natureza:'Dev.compra com.em op.merc.suj.reg.sub.trib.'}),true);
  assert.equal(eh({tipoTransferencia:null,natureza:'RETORNO DE MERCADORIA UTILIZADA NA INDUSTRIALIZACA'}),true);
  assert.equal(eh({tipoTransferencia:null,natureza:'Venda de producao do estabelecimento'}),false);
  assert.equal(eh({tipoTransferencia:null,natureza:'VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS'}),false);
  assert.equal(eh({tipoTransferencia:null,natureza:'REMESSA EM BONIFICACAO, DOACAO OU BRINDE'}),false);
  assert.equal(eh({tipoTransferencia:null,natureza:'Simples Remessa'}),false);
});

test('sincronizarAgendaBluesoft: Bluesoft não tem YMS/agendamento de mercadoria confirmado — usa Pedido de Compra (entregaPendente + dataEntregaInicial/Final, mesmo endpoint já usado pra divergência) pra preencher a Agenda automaticamente, sem sobrescrever status/observação editados à mão',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/compras/pedidos-de-compra/entregas')) return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:[]})};
    if(body.path.startsWith('/api/compras/pedidos-de-compra')){
      const pedidos=[
        {numeroPedido:500,dataEmissao:'2026-08-01',fornecedorKey:10,statusPedido:'ABERTO',dataEntregaInicial:'2026-08-20',dataEntregaFinal:'2026-08-22',entregaPendente:true,itens:[]},
        {numeroPedido:501,dataEmissao:'2026-08-01',fornecedorKey:10,statusPedido:'FECHADO',dataEntregaInicial:'2026-08-10',dataEntregaFinal:'2026-08-10',entregaPendente:false,itens:[]},
      ];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?pedidos:[]})};
    }
    if(body.path.startsWith('/api/fornecedores')){
      const fornecedores=[{fornecedorKey:10,nomeFantasia:'Fornecedor Dez',ativa:true}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?fornecedores:[]})};
    }
    return paginaVazia(0);
  };
  const loja={nome:'Loja 1',bluesoft_loja_key:'LK1'};
  const agendamentos=mockColecao([]);
  const w=loadServico(fetchMock,loja,{recebimento_agendamentos:agendamentos});

  const r=await w.sincronizarAgendaBluesoft();
  assert.equal(r.totalPedidos,2); // 500 + 501, sem filtro
  assert.equal(r.totalPedidosPendentes,1); // só o 500 — o 501 já foi entregue (entregaPendente:false)
  assert.equal(r.criados,1);

  const docId=[...agendamentos.registro.keys()][0];
  const doc=agendamentos.registro.get(docId);
  assert.equal(doc.numeroPedido,500);
  assert.equal(doc.fornecedorNome,'Fornecedor Dez');
  assert.equal(doc.dataAgendada,'2026-08-20');
  assert.equal(doc.dataEntregaFinal,'2026-08-22');
  assert.equal(doc.origem,'bluesoft');
  assert.equal(doc.status,'AGENDADO');

  // simula o Analista editando manualmente depois que a Bluesoft criou o registro
  agendamentos.registro.set(docId,{...doc,status:'UTILIZADO',observacao:'chegou antes do previsto'});

  const r2=await w.sincronizarAgendaBluesoft();
  assert.equal(r2.atualizados,1);
  const docDepois=agendamentos.registro.get(docId);
  assert.equal(docDepois.status,'UTILIZADO'); // preservado — sync não sobrescreve
  assert.equal(docDepois.observacao,'chegou antes do previsto'); // preservado
});

test('REGRESSÃO: sincronizarAgendaBluesoft devolve totalPedidos (sem filtro) além de totalPedidosPendentes — dado ao vivo do usuário: "não tá encontrando nenhum agendamento" precisa dar pra diferenciar "loja não usa Pedido de Compra na Bluesoft" de "usa, mas está tudo entregue"',async()=>{
  const fetchMock=async()=>paginaVazia(0); // nenhum pedido nenhum
  const loja={nome:'Loja 1',bluesoft_loja_key:'LK1'};
  const w=loadServico(fetchMock,loja,{recebimento_agendamentos:mockColecao([])});
  const r=await w.sincronizarAgendaBluesoft();
  assert.equal(r.totalPedidos,0); // loja não tem nenhum PC cadastrado na Bluesoft
  assert.equal(r.totalPedidosPendentes,0);
  assert.equal(r.criados,0);
});

test('sincronizarRecebimentoBluesoft cruza tipoTransferencia da carga pra cada nota, pra identificar devolução com precisão',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/estoque/recebimento/status-processamento-nfe')){
      const notas=[{notaFiscalKey:300,notaFiscal:900,cnpjRemetente:'12.345.678/0001-99',valor:100,statusRecebimento:'FINALIZADA'}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?notas:[]})};
    }
    if(body.path.startsWith('/api/compras/recebimentocargas')){
      const cargas=[{movimentacaoCargaKey:400,lojaKey:1,dataGeracao:'2026-08-01T08:00:00',notasFiscais:[{nfKey:300,tipoTransferencia:'DEVOLUCAO_ENTRE_LOJAS'}]}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?cargas:[]})};
    }
    return paginaVazia(0);
  };
  const loja={nome:'Loja 1',bluesoft_loja_key:'LK1'};
  const notasExistentes=mockColecao([]);
  const w=loadServico(fetchMock,loja,{recebimento_notas:notasExistentes,recebimento_cargas:mockColecao([])});
  await w.sincronizarRecebimentoBluesoft({meses:1});

  const nota=[...notasExistentes.registro.values()][0];
  assert.equal(nota.tipoTransferencia,'DEVOLUCAO_ENTRE_LOJAS');
  assert.equal(w._bluesoftServiceInternals._ehDevolucao(nota),true);
});

test('REGRESSÃO: firestore.rules permite gravar tipoTransferencia em recebimento_notas (bug ao vivo: "Missing or insufficient permissions" — o payload do sync grava o campo mas a whitelist de update não deixava)',()=>{
  const rulesCode=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');
  const inicio=rulesCode.indexOf("match /recebimento_notas/{docId}");
  const trecho=rulesCode.slice(inicio,inicio+2000);
  const matchWhitelist=trecho.match(/hasPermission\('recebimento-notas', 'importar'\)[\s\S]*?hasOnly\(\[([^\]]+)\]\)/);
  assert.ok(matchWhitelist,'não achou a whitelist de campos do ramo "importar" em recebimento_notas');
  assert.match(matchWhitelist[1],/'tipoTransferencia'/);
});

test('_normalizarNotaRecebimento calcula tempoLancamentoMin a partir de inicio/fimLancamento',()=>{
  const w=loadServico(async()=>paginaVazia(0),{nome:'Loja 1'});
  const norm=w._bluesoftServiceInternals._normalizarNotaRecebimento({
    notaFiscalKey:1,notaFiscal:555,cnpjRemetente:'12345678000199',valor:1000,
    statusRecebimento:'FINALIZADA',notaFiscalFechada:true,
    inicioLancamento:'2026-08-01T10:00:00',fimLancamento:'2026-08-01T10:30:00',
  });
  assert.equal(norm.tempoLancamentoMin,30);
  assert.equal(norm.fechada,true);
});

test('sincronizarRecebimentoBluesoft cruza entregas x pedido pra calcular divergência real, cruza fornecedor por CNPJ, e nunca sobrescreve chegadaPortaria já preenchida manualmente',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/estoque/recebimento/status-processamento-nfe')){
      const notas=[
        {notaFiscalKey:100,notaFiscal:555,cnpjRemetente:'12.345.678/0001-99',valor:1000,statusRecebimento:'FINALIZADA',notaFiscalFechada:true,dataRecebimento:'2026-08-01',inicioLancamento:'2026-08-01T10:00:00',fimLancamento:'2026-08-01T10:30:00'},
        {notaFiscalKey:101,notaFiscal:556,cnpjRemetente:'12.345.678/0001-99',valor:500,statusRecebimento:'FINALIZADA',notaFiscalFechada:true,dataRecebimento:'2026-08-02',inicioLancamento:'2026-08-02T09:00:00',fimLancamento:'2026-08-02T09:20:00'},
      ];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?notas:[]})};
    }
    if(body.path.startsWith('/api/compras/recebimentocargas')){
      const cargas=[{movimentacaoCargaKey:200,lojaKey:1,dataGeracao:'2026-08-01T08:00:00',dataInicioRecebimento:'2026-08-01T10:00:00',dataFimRecebimento:'2026-08-01T10:30:00',notasFiscais:[{nfKey:100,fornecedorKey:9,placaVeiculo:'ABC1234'}]}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?cargas:[]})};
    }
    if(body.path.startsWith('/api/compras/pedidos-de-compra/entregas')){
      const entregas=[{itemPedidoKey:1,numeroDoPedido:50,quantidadeRecebida:8,itemPendente:false,notaFiscal:{nfKey:100}}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?entregas:[]})};
    }
    if(body.path.startsWith('/api/compras/pedidos-de-compra')){
      const pedidos=[{numeroPedido:50,fornecedorKey:9,statusPedido:'FINALIZADO',itens:[{itemPedidoKey:1,produtoKey:7,quantidadePedida:10}]}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?pedidos:[]})};
    }
    if(body.path.startsWith('/api/fornecedores')){
      const fornecedores=[{fornecedorKey:9,nomeFantasia:'Fornecedor Teste',nomeRazao:'Fornecedor Teste LTDA',cpfCnpj:'12.345.678/0001-99',ativa:true}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?fornecedores:[]})};
    }
    return paginaVazia(0);
  };
  const notasExistentes=mockColecao([
    {id:'existenteComPortaria',data:{notaFiscalKey:100,chegadaPortaria:'2026-08-01T09:00:00.000Z',tempoPortariaAteRecebimentoMin:90}},
  ]);
  const cargasExistentes=mockColecao([]);
  const loja={nome:'Loja 1',bluesoft_loja_key:'LK1'};
  const w=loadServico(fetchMock,loja,{recebimento_notas:notasExistentes,recebimento_cargas:cargasExistentes});
  const r=await w.sincronizarRecebimentoBluesoft({meses:1});

  assert.equal(r.totalNotas,2);
  assert.equal(r.comDivergencia,1);
  assert.equal(r.totalCargas,1);

  const nota100=notasExistentes.registro.get('existenteComPortaria');
  assert.equal(nota100.comparavel,true);
  assert.equal(nota100.quantidadeRecebidaTotal,8);
  assert.equal(nota100.quantidadePedidaTotal,10);
  assert.equal(nota100.divergencia,-2);
  assert.equal(nota100.temDivergencia,true);
  assert.equal(nota100.fornecedorNome,'Fornecedor Teste');
  // nunca sobrescreve o campo manual, mesmo re-sincronizando a mesma nota
  assert.equal(nota100.chegadaPortaria,'2026-08-01T09:00:00.000Z');
  assert.equal(nota100.tempoPortariaAteRecebimentoMin,90);

  const nota101=[...notasExistentes.registro.values()].find(x=>x.notaFiscalKey===101);
  assert.ok(nota101);
  assert.equal(nota101.comparavel,false);
  assert.equal(nota101.divergencia,null);
  assert.equal(nota101.temDivergencia,false);

  const carga=[...cargasExistentes.registro.values()][0];
  assert.deepEqual(carga.notasFiscaisKeys,[100]);
  assert.equal(carga.placaVeiculo,'ABC1234');
});

test('REGRESSÃO: uma nota da Bluesoft sem notaFiscalKey (campo ausente na resposta da API) não derruba a sincronização — grava null em vez de undefined',async()=>{
  const fetchMock=async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const qs=new URLSearchParams(body.path.split('?')[1]||'');
    const page=Number(qs.get('currentPage'));
    if(body.path.startsWith('/api/estoque/recebimento/status-processamento-nfe')){
      // nota real vinda da Bluesoft sem a chave — é exatamente o caso que
      // crashava com "Unsupported field value: undefined"
      const notas=[{notaFiscal:999,cnpjRemetente:'12.345.678/0001-99',valor:100,statusRecebimento:'FINALIZADA'}];
      return {ok:true,text:async()=>JSON.stringify({currentPage:page,pageSize:200,data:page===0?notas:[]})};
    }
    return paginaVazia(0);
  };
  const loja={nome:'Loja 1',bluesoft_loja_key:'LK1'};
  const w=loadServico(fetchMock,loja,{recebimento_notas:mockColecao([]),recebimento_cargas:mockColecao([])});

  const r=await w.sincronizarRecebimentoBluesoft({meses:1}); // não deve lançar
  assert.equal(r.totalNotas,1);
  assert.equal(r.criadas,1);
});

test('_normalizarNotaRecebimento/_normalizarCargaRecebimento nunca retornam undefined nos campos-chave, mesmo quando a Bluesoft não manda eles',()=>{
  const w=loadServico(async()=>paginaVazia(0),{nome:'Loja 1'});
  const nota=w._bluesoftServiceInternals._normalizarNotaRecebimento({notaFiscal:1});
  assert.equal(nota.notaFiscalKey,null);
  const carga=w._bluesoftServiceInternals._normalizarCargaRecebimento({});
  assert.equal(carga.movimentacaoCargaKey,null);
  assert.equal(carga.lojaKey,null);
});

test('navegação: setor Logística ganha flyout com Inventário e Recebimento; Recebimento tem shell/sidebar próprio, separado do Inventário',()=>{
  assert.match(permCode,/setor-flyout-trigger/);
  assert.match(permCode,/data-setor-view="recebimento"/);
  assert.match(permCode,/data-setor-view="inventario"/);
  assert.match(permCode,/function irParaSetor\(id,view\)/);
  assert.match(permCode,/recebimentoShell=document\.getElementById\('setor-logistica-recebimento-shell'\)/);
  assert.match(navCode,/case 'recebimento-dashboard':\s*return _callPage\('renderRecebimentoDashboard'\)/);
  assert.match(htmlCode,/id="setor-logistica-recebimento-shell"/);
  assert.match(htmlCode,/id="page-recebimento-dashboard"/);
  assert.match(htmlCode,/id="nav-recebimento-dashboard"/);
  assert.match(htmlCode,/91-logistica-recebimento\.js/);
  // shell antigo (Recebimento como item dentro da sidebar do Inventário) foi removido, não só duplicado
  assert.doesNotMatch(htmlCode,/id="page-logistica-recebimento"/);
  assert.doesNotMatch(htmlCode,/id="nav-logistica-recebimento"/);
});

test('permissões: 7 módulos de Recebimento registrados (bate com a seção 26 do pedido), substituindo o módulo único antigo',()=>{
  ['recebimento-dashboard','recebimento-operacao','recebimento-notas','recebimento-fornecedores','recebimento-agendamentos','recebimento-transbordo','recebimento-config'].forEach(m=>{
    assert.match(permCode,new RegExp("id:'"+m+"'"));
  });
  assert.doesNotMatch(permCode,/id:'logistica-recebimento'/);
});

test('irParaSetor alterna entre o shell de Inventário e o de Recebimento sem afetar Produção/PCP/Compras',()=>{
  const els={
    'app-main-logistica':{style:{}},
    'setor-logistica-recebimento-shell':{style:{}},
    'setor-placeholder':{style:{}},
    'setor-producao-shell':{style:{}},
    'setor-pcp-shell':{style:{}},
    'setor-compras-shell':{style:{}},
  };
  const document={
    addEventListener:()=>{},
    querySelectorAll:()=>({forEach:()=>{}}),
    querySelector:()=>null,
    getElementById:(id)=>els[id]||null,
  };
  const goPage=()=>{};
  const window={goPage};
  vm.runInNewContext(permCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,goPage},{filename:'37-usuarios-permissoes.js'});
  window.irParaSetor('logistica','recebimento');
  const logisticaEl=document.getElementById('app-main-logistica');
  const recebimentoEl=document.getElementById('setor-logistica-recebimento-shell');
  assert.equal(logisticaEl.style.display,'none');
  assert.equal(recebimentoEl.style.display,'flex');
  window.irParaSetor('logistica','inventario');
  assert.equal(logisticaEl.style.display,'flex');
  assert.equal(recebimentoEl.style.display,'none');
});

test('dashboard de Recebimento tem botão de sync, filtro de período e vários gráficos agregados (a tabela crua de notas e a edição de portaria mudaram pra aba Notas Fiscais)',()=>{
  assert.match(dashCode,/data-reb-sync/);
  assert.match(dashCode,/id="reb-f-periodo"/);
  assert.match(dashCode,/sincronizarRecebimentoBluesoft/);
  assert.doesNotMatch(dashCode,/data-reb-portaria/); // editar chegada na portaria não é mais responsabilidade do dashboard
  assert.doesNotMatch(dashCode,/data-reb-pg/); // paginação de nota-a-nota também não
  const qtdGraficos=[...dashCode.matchAll(/new global\.Chart/g)].length;
  assert.ok(qtdGraficos>=4,'esperava pelo menos 4 gráficos no dashboard, achou '+qtdGraficos);
});

// PEDIDO AO VIVO (usuário, print da sidebar de Recebimento: "deixar essa
// parte correta, cada informação no lugar certo... tem partes que é para
// recusas, tem outras que é para transbordo, então ta meio bagunçados") —
// os 12 itens viviam numa lista só, sem indicar a qual fluxo cada um
// pertence. Agrupados em 4 seções (Geral/Fornecedor/Transbordo/Notas
// Retornadas), pelo DONO REAL dos dados de cada página (não pelo rótulo —
// "Tempos / Performance" parece genérico mas 96-recebimento-performance.js
// só calcula em cima de recebimentos tipo:'TRANSBORDO'; "Histórico" fica em
// Geral porque 94-recebimento-relatorios.js lista sem filtrar tipo).
test('PEDIDO AO VIVO: sidebar de Recebimento tem os itens agrupados por seção (Geral/Fornecedor/Transbordo/Notas Retornadas), não mais numa lista só',()=>{
  const trechoShell=htmlCode.split('id="setor-logistica-recebimento-shell"')[1].split('</aside>')[0];
  const secoes=[...trechoShell.matchAll(/<div class="sb-sec">([^<]+)<\/div>/g)].map(m=>m[1]);
  assert.deepEqual(secoes,['Recebimento','Fornecedor','Transbordo','Notas Retornadas']);

  // cada nav-item precisa vir DEPOIS da seção certa e ANTES da próxima —
  // checagem por posição de índice no HTML, não por regex frágil.
  const pos=id=>trechoShell.indexOf('id="'+id+'"');
  const posSecao=nome=>trechoShell.indexOf('<div class="sb-sec">'+nome+'</div>');
  const geralFim=posSecao('Fornecedor');
  const fornecedorFim=posSecao('Transbordo');
  const transbordoFim=posSecao('Notas Retornadas');

  ['nav-recebimento-dashboard','nav-recebimento-operacao','nav-recebimento-historico','nav-recebimento-config'].forEach(id=>{
    assert.ok(pos(id)>posSecao('Recebimento') && pos(id)<geralFim, id+' precisa estar na seção Geral');
  });
  ['nav-recebimento-notas','nav-recebimento-fornecedores','nav-recebimento-agendamentos'].forEach(id=>{
    assert.ok(pos(id)>geralFim && pos(id)<fornecedorFim, id+' precisa estar na seção Fornecedor');
  });
  ['nav-recebimento-transbordo','nav-recebimento-tempos'].forEach(id=>{
    assert.ok(pos(id)>fornecedorFim && pos(id)<transbordoFim, id+' precisa estar na seção Transbordo (Tempos/Performance é transbordo-only, apesar do nome genérico)');
  });
  ['nav-recebimento-recusas','nav-recebimento-retornos-indicadores','nav-recebimento-retornos-status','nav-recebimento-recusas-cadastros'].forEach(id=>{
    assert.ok(pos(id)>transbordoFim, id+' precisa estar na seção Notas Retornadas');
  });
});
