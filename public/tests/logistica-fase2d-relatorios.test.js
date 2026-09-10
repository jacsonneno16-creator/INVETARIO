const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const relCode=fs.readFileSync(path.join(base,'94-recebimento-relatorios.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map(docsIniciais.map(d=>[d.id,d.data]));
  let seq=0;
  const colecao={
    get: async()=>({size:registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data}))}),
    doc:(id)=>{ const docId=id||('novo'+(seq++)); return { id:docId, set: async(p)=>{ const a=registro.get(docId)||{}; registro.set(docId,{...a,...p}); }, delete: async()=>{ registro.delete(docId); } }; },
    add: async(payload)=>{ const docId='novo'+(seq++); registro.set(docId,payload); return {id:docId}; },
    where:(campo,op,valor)=>({
      get: async()=>{
        const filtrados=[...registro.entries()].filter(([,data])=>op==='=='?data[campo]===valor:true);
        return {size:filtrados.length, docs:filtrados.map(([id,data])=>({id,data:()=>data}))};
      },
    }),
    _registro: registro,
  };
  return colecao;
}

function loadRelatorios(recebimentosFake, notasBluesoftFake, colecoes, sincronizarAgendaBluesoftFake){
  const elementos=new Map();
  function elFake(id){ if(!elementos.has(id)) elementos.set(id,{id,value:'',textContent:'',innerHTML:''}); return elementos.get(id); }
  const document={ addEventListener:()=>{}, getElementById:(id)=>elFake(id), createElement:()=>({click:()=>{}}) };
  const window={
    getDTFirestore:()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) }),
    _recebimentoOperacaoInternals:{ carregar: async()=>{}, recebimentos: ()=>recebimentosFake },
    _recebimentoInternals:{ carregar: async()=>{}, notasFiltradas: ()=>notasBluesoftFake||[] },
    sincronizarAgendaBluesoft: sincronizarAgendaBluesoftFake,
    openModal:()=>{}, closeModal:()=>{}, showToast:()=>{}, showConfirm:(msg,exec)=>exec(),
  };
  vm.runInNewContext(relCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,Blob:class{},URL:{createObjectURL:()=>''}},{filename:'94-recebimento-relatorios.js'});
  return {window,elFake};
}

test('notas achatadas: junta recebimentos[].notas de todos os recebimentos num só array, com dados da carga anexados',()=>{
  const recs=[
    {fornecedorNome:'A',motoristaNome:'João',placa:'ABC1D23',status:'FINALIZADO',horaChegada:'2026-08-01T08:00:00Z',notas:[{numero:'1',serie:'1',valor:100,quantidadeVolumes:5},{numero:'2',serie:'1',valor:50,quantidadeVolumes:2}]},
    {fornecedorNome:'B',motoristaNome:'Maria',placa:'XYZ9K88',status:'EM_DESCARGA',horaChegada:'2026-08-02T09:00:00Z',notas:[]},
  ];
  const {window}=loadRelatorios(recs,[]);
  const notas=window._recebimentoRelatoriosInternals.notasAchatadas();
  assert.equal(notas.length,2);
  assert.equal(notas[0].fornecedorNome,'A');
  assert.equal(notas[0].numero,'1');
  assert.equal(notas[1].valor,50);
});

test('ranking de fornecedores: agrega tempos médios e cruza divergência com o histórico real da Bluesoft por nome normalizado',()=>{
  const recs=[
    {tipo:'FORNECEDOR',fornecedorNome:'Fornecedor Teste',status:'FINALIZADO',horaChegada:'2026-08-01T08:00:00Z',tempoEsperaMin:10,tempoDescargaMin:20,tempoTotalMin:30,notas:[{numero:'1',quantidadeVolumes:5}]},
    {tipo:'FORNECEDOR',fornecedorNome:'Fornecedor Teste',status:'FINALIZADO',horaChegada:'2026-08-05T08:00:00Z',tempoEsperaMin:20,tempoDescargaMin:40,tempoTotalMin:60,notas:[{numero:'2',quantidadeVolumes:3}]},
    {tipo:'FORNECEDOR',fornecedorNome:'Outro Fornecedor',status:'FINALIZADO',horaChegada:'2026-08-03T08:00:00Z',tempoEsperaMin:5,tempoDescargaMin:5,tempoTotalMin:10,notas:[]},
  ];
  const notasBluesoft=[
    {fornecedorNome:'fornecedor teste',temDivergencia:true},
    {fornecedorNome:'FORNECEDOR TESTE',temDivergencia:false},
  ];
  const {window}=loadRelatorios(recs,notasBluesoft);
  const rank=window._recebimentoRelatoriosInternals.agregarFornecedores();
  const ft=rank.find(x=>x.fornecedor==='Fornecedor Teste');
  assert.ok(ft);
  assert.equal(ft.qtdEntregas,2);
  assert.equal(ft.tempoMedioEspera,15);
  assert.equal(ft.tempoMedioDescarga,30);
  assert.equal(ft.tempoMedioTotal,45);
  assert.equal(ft.qtdNotas,2);
  assert.equal(ft.volumes,8);
  assert.equal(ft.divergencias,1); // só a nota com temDivergencia:true conta, cruzando por nome normalizado
});

test('histórico: só lista FINALIZADO/CANCELADO, nunca cargas ainda em andamento',()=>{
  const recs=[
    {status:'FINALIZADO',horaChegada:'2026-08-01T08:00:00Z'},
    {status:'CANCELADO',horaChegada:'2026-08-02T08:00:00Z'},
    {status:'EM_DESCARGA',horaChegada:'2026-08-03T08:00:00Z'},
    {status:'CHEGOU',horaChegada:'2026-08-04T08:00:00Z'},
  ];
  const {window}=loadRelatorios(recs,[]);
  const hist=window._recebimentoRelatoriosInternals.historicoFiltrado();
  assert.equal(hist.length,2);
  assert.ok(hist.every(r=>['FINALIZADO','CANCELADO'].includes(r.status)));
});

test('agendamento: cria e edita (upsert por doc-id), exige fornecedor e data',async()=>{
  const agendamentos=mockColecao([]);
  const {window,elFake}=loadRelatorios([],[],{recebimento_agendamentos:agendamentos});
  elFake('recag-doc-id').value='';
  elFake('recag-fornecedor').value='';
  elFake('recag-data').value='';
  await window.recagSalvar();
  assert.equal(agendamentos._registro.size,0); // sem fornecedor/data, não salva

  elFake('recag-fornecedor').value='Fornecedor X';
  elFake('recag-data').value='2026-08-20';
  elFake('recag-hora').value='10:00';
  elFake('recag-status').value='AGENDADO';
  await window.recagSalvar();
  assert.equal(agendamentos._registro.size,1);
  assert.equal([...agendamentos._registro.values()][0].fornecedorNome,'Fornecedor X');
});

test('agenda: mostra botão de sincronizar pedidos pendentes e coluna de Origem, distinguindo o que veio da Bluesoft do que foi cadastrado à mão (pedido ao vivo do usuário: puxar agenda de mercadoria)',async()=>{
  const agendamentos=mockColecao([
    {id:'a1',data:{fornecedorNome:'Fornecedor Bluesoft',dataAgendada:'2026-08-20',status:'AGENDADO',origem:'bluesoft',numeroPedido:500}},
    {id:'a2',data:{fornecedorNome:'Fornecedor Manual',dataAgendada:'2026-08-21',status:'AGENDADO'}},
  ]);
  const {window,elFake}=loadRelatorios([],[],{recebimento_agendamentos:agendamentos});
  await window.renderRecebimentoAgendamentos();
  const html=elFake('page-recebimento-agendamentos').innerHTML;
  assert.match(html,/data-recag-sync/);
  assert.match(html,/Fornecedor Bluesoft/);
  assert.match(html,/🔗 Bluesoft/);
  assert.match(html,/Fornecedor Manual/);
  assert.match(html,/Manual</);
});

test('REGRESSÃO: mensagem de status da sincronização da Agenda sobrevive ao redesenho da tabela (bug ao vivo: o toast aparecia mas a linha de status ficava em branco — _desenharRecebimentoAgendamentos recriava o innerHTML inteiro, inclusive um #recag-sync-status novo e vazio, por cima do texto que acabou de ser escrito)',async()=>{
  const sincronizarAgendaBluesoftFake=async()=>({totalPedidos:0,totalPedidosPendentes:0,criados:0,atualizados:0});
  const {window,elFake}=loadRelatorios([],[],{recebimento_agendamentos:mockColecao([])},sincronizarAgendaBluesoftFake);
  await window.renderRecebimentoAgendamentos();

  await window._recebimentoRelatoriosInternals.sincronizarAgenda();

  // a mensagem final tem que sobreviver ao _desenharRecebimentoAgendamentos()
  // que roda logo depois — ou seja, tem que estar embutida no innerHTML
  // redesenhado da página inteira, não só escrita direto num nó de DOM que o
  // próximo innerHTML=... apagaria (era exatamente o bug: só sobrava o
  // "⏳ Buscando..." de antes do redesenho)
  const html=elFake('page-recebimento-agendamentos').innerHTML;
  assert.match(html,/0 de 0 pedido\(s\) pendente\(s\)/);
  assert.match(html,/não tem nenhum Pedido de Compra cadastrado/);
});

test('navegação: as 4 telas de relatório estão registradas e o modal de agendamento existe',()=>{
  assert.match(htmlCode,/id="modal-recag"/);
  assert.match(htmlCode,/94-recebimento-relatorios\.js/);
  assert.match(relCode,/data-recist-exportar/);
  assert.match(relCode,/data-recag-novo/);
});

test('REGRESSÃO: relatório de Histórico traz todos os campos pedidos ao vivo (motorista, nota, saída, chegada, tempo em trânsito, início/fim descarga, conferência, tempos, status) — dado vem só do fluxo operacional, nunca de importação Bluesoft',async()=>{
  const recs=[{
    _id:'r1', tipo:'TRANSBORDO', status:'FINALIZADO', motoristaNome:'Carlos', placa:'ABC1D23',
    notaFiscalTransferencia:'NF-9001',
    horaSaida:'2026-08-14T06:00:00.000Z', horaChegada:'2026-08-14T07:10:00.000Z',
    horaInicioDescarga:'2026-08-14T07:20:00.000Z', horaFimDescarga:'2026-08-14T08:05:00.000Z',
    horaFechamentoRecebimento:'2026-08-14T08:10:00.000Z',
    tempoViagemMin:70, tempoEsperaMin:10, tempoDescargaMin:45, tempoTotalMin:130, responsavel:'analista@daterrinha.com',
  }];
  const {window,elFake}=loadRelatorios(recs,[]);
  await window.renderRecebimentoHistorico();
  const html=elFake('page-recebimento-historico').innerHTML;
  assert.match(html,/Carlos/);
  assert.match(html,/NF-9001/);
  assert.match(html,/07:10/); // chegada
  assert.match(html,/06:00/); // saída
  assert.match(html,/07:20/); // início descarga
  assert.match(html,/08:05/); // fim descarga
  assert.match(html,/08:10/); // conferência/fechamento
  assert.match(html,/1\.2h|70min/); // tempo de viagem
  assert.match(html,/data-recist-etapas="r1"/);

  // export CSV também carrega os mesmos campos, sem depender da Bluesoft
  const trechoCsv=relCode.slice(relCode.indexOf('function _exportarHistoricoCsv'),relCode.indexOf('function _exportarHistoricoCsv')+1200);
  assert.doesNotMatch(trechoCsv,/_recebimentoInternals/);
  assert.match(trechoCsv,/horaSaida/);
  assert.match(trechoCsv,/horaInicioDescarga/);
  assert.match(trechoCsv,/horaFimDescarga/);
});

test('REGRESSÃO: "Ver histórico das etapas" (pedido ao vivo, item 5: "Histórico das etapas") lê recebimento_auditoria — mesma fonte gravada pelo próprio fluxo a cada bip, nunca da Bluesoft — e mostra só as etapas daquele recebimento, em ordem cronológica',async()=>{
  const auditoria=mockColecao([
    {id:'a1',data:{recebimentoId:'r1',operacao:'TRANSBORDO_SAIU',dataHora:'2026-08-14T06:00:00.000Z',valorAnterior:null,valorNovo:'EM_TRANSITO',usuario:'analista@daterrinha.com'}},
    {id:'a2',data:{recebimentoId:'r2',operacao:'CARGA_CRIADA',dataHora:'2026-08-14T05:00:00.000Z',valorAnterior:null,valorNovo:'CHEGOU',usuario:'outro@daterrinha.com'}},
    {id:'a3',data:{recebimentoId:'r1',operacao:'DESCARGA_FINALIZADA',dataHora:'2026-08-14T08:05:00.000Z',valorAnterior:'EM_DESCARGA',valorNovo:'DESCARGA_FINALIZADA',usuario:'analista@daterrinha.com'}},
    {id:'a4',data:{recebimentoId:'r1',operacao:'CHEGADA_REGISTRADA',dataHora:'2026-08-14T07:10:00.000Z',valorAnterior:'EM_TRANSITO',valorNovo:'CHEGOU',usuario:'analista@daterrinha.com'}},
  ]);
  const recs=[{_id:'r1',motoristaNome:'Carlos',notaFiscalTransferencia:'NF-9001',status:'FINALIZADO'}];
  const {window,elFake}=loadRelatorios(recs,[],{recebimento_auditoria:auditoria});
  await window._recebimentoRelatoriosInternals.verEtapasHistorico('r1');
  const etapas=window._recebimentoRelatoriosInternals.etapasDoRecebimento('r1');
  assert.equal(etapas.length,3); // só as de r1, a2 (de r2) fica fora
  assert.deepEqual(etapas.map(e=>e.operacao),['TRANSBORDO_SAIU','CHEGADA_REGISTRADA','DESCARGA_FINALIZADA']); // cronológico
  const html=elFake('recist-etapas-corpo').innerHTML;
  assert.match(html,/Carlos/);
  assert.match(html,/NF-9001/);
  assert.match(html,/TRANSBORDO_SAIU/);
  assert.match(html,/CHEGADA_REGISTRADA/);
  assert.match(html,/DESCARGA_FINALIZADA/);
  assert.doesNotMatch(html,/CARGA_CRIADA/); // etapa de outro recebimento (r2) não vaza pra cá
});

test('modal de histórico das etapas existe no HTML',()=>{
  assert.match(htmlCode,/id="modal-recist-etapas"/);
  assert.match(htmlCode,/id="recist-etapas-corpo"/);
});
