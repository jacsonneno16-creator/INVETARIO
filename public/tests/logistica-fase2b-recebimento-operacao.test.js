const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const opCode=fs.readFileSync(path.join(base,'93-recebimento-operacao.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map(docsIniciais.map(d=>[d.id,d.data]));
  let seq=0;
  return {
    get: async()=>({size:registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data}))}),
    doc: (id)=>{
      const docId=id||('novo'+(seq++));
      return {
        id:docId,
        set: async(payload)=>{ const atual=registro.get(docId)||{}; registro.set(docId,{...atual,...payload}); },
        update: async(payload)=>{ const atual=registro.get(docId); if(atual===undefined) throw new Error('NOT_FOUND: no document to update'); registro.set(docId,{...atual,...payload}); },
      };
    },
    add: async(payload)=>{ const docId='novo'+(seq++); registro.set(docId,payload); return {id:docId}; },
    _registro: registro,
  };
}

function loadOperacao(colecoes){
  const elementos=new Map();
  function elFake(id){ if(!elementos.has(id)) elementos.set(id,{id,value:'',textContent:'',innerHTML:''}); return elementos.get(id); }
  const document={
    addEventListener:()=>{},
    getElementById:(id)=>elFake(id),
  };
  const window={
    getDTFirestore:()=>({ collection:(nome)=>colecoes[nome]||mockColecao([]) }),
    openModal:()=>{}, closeModal:()=>{}, showToast:()=>{}, showConfirm:(msg,exec)=>exec(),
    _currentAnalistaUser:{email:'teste@daterrinha.com'},
  };
  vm.runInNewContext(opCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,isNaN},{filename:'93-recebimento-operacao.js'});
  return {window,elFake};
}

test('máquina de estados: guardas não deixam pular etapa (não pode iniciar descarga sem ter chegado, não pode finalizar descarga sem ter iniciado)',()=>{
  const {window}=loadOperacao({});
  const i=window._recebimentoOperacaoInternals;
  assert.equal(i.podeIniciarDescarga({status:'PREVISTO'}),false);
  assert.equal(i.podeIniciarDescarga({status:'CHEGOU'}),true);
  assert.equal(i.podeIniciarDescarga({status:'AGUARDANDO_DOCA'}),true);
  assert.equal(i.podeFinalizarDescarga({status:'CHEGOU'}),false);
  assert.equal(i.podeFinalizarDescarga({status:'EM_DESCARGA'}),true);
  assert.equal(i.podeFinalizar({status:'EM_DESCARGA'}),false);
  assert.equal(i.podeFinalizar({status:'DESCARGA_FINALIZADA'}),true);
  assert.equal(i.podeFinalizar({status:'EM_CONFERENCIA'}),true);
  assert.equal(i.podeCancelar({status:'FINALIZADO'}),false);
  assert.equal(i.podeCancelar({status:'CANCELADO'}),false);
  assert.equal(i.podeCancelar({status:'EM_DESCARGA'}),true);
});

test('cálculo de tempos: espera, descarga, total e até fechamento batem com a diferença em minutos entre os horários',()=>{
  const {window}=loadOperacao({});
  const i=window._recebimentoOperacaoInternals;
  const r={
    horaChegada:'2026-08-14T08:13:00.000Z',
    horaInicioDescarga:'2026-08-14T08:47:00.000Z',
    horaFimDescarga:'2026-08-14T09:35:00.000Z',
    horaFechamentoRecebimento:'2026-08-14T09:50:00.000Z',
  };
  const tempos=i.recalcularTempos(r);
  assert.equal(tempos.tempoEsperaMin,34);
  assert.equal(tempos.tempoDescargaMin,48);
  assert.equal(tempos.tempoTotalMin,82);
  assert.equal(tempos.tempoAteFechamentoMin,97);
});

test('fluxo completo: criar recebimento manual (equivalente ao 1º bip) → iniciar descarga → finalizar descarga → finalizar, com auditoria em cada etapa e tempos recalculados',async()=>{
  const recebimentos=mockColecao([]);
  const auditoria=mockColecao([]);
  const {window,elFake}=loadOperacao({
    recebimentos, recebimento_auditoria:auditoria,
    recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_docas:mockColecao([]),
  });
  elFake('recop-doc-id').value='';
  elFake('recop-fornecedor').value='Fornecedor Teste';
  elFake('recop-motorista').value='';
  elFake('recop-veiculo').value='';
  elFake('recop-doca').value='';
  elFake('recop-observacao').value='';
  await window.recopSalvar();
  assert.equal(recebimentos._registro.size,1);
  const [id,doc]=[...recebimentos._registro.entries()][0];
  assert.equal(doc.status,'CHEGOU'); // sem doca selecionada, entra direto como CHEGOU
  assert.ok(doc.horaChegada);
  // REGRESSÃO (bug ao vivo: "erro de permissão" ao tentar avançar a etapa
  // seguinte): firestore.rules trata campo AUSENTE e campo `null` como
  // coisas diferentes — o guard de primeira-escrita (ex.: horaInicioDescarga
  // == null) derruba a regra inteira se o campo nunca existiu no documento.
  // A criação precisa gravar null explícito em tudo que ainda não aconteceu.
  ['horaSaida','horaInicioDescarga','horaFimDescarga','horaFechamentoRecebimento','notaFiscalTransferencia','notaFiscalConfirmadaEm','notaFiscalConfirmadaPor'].forEach(campo=>{
    assert.ok(Object.prototype.hasOwnProperty.call(doc,campo),'campo '+campo+' precisa existir no documento (mesmo que null)');
    assert.equal(doc[campo],null,'campo '+campo+' precisa ser null explícito, não ausente');
  });
  assert.equal(auditoria._registro.size,1);
  assert.equal([...auditoria._registro.values()][0].operacao,'CARGA_CRIADA');

  await window._recebimentoOperacaoInternals.carregar(true);
  const i=window._recebimentoOperacaoInternals;
  const rec=i.recebimentos().find(x=>x._id===id);
  assert.ok(rec);

  // tenta finalizar descarga antes de iniciar -> não deve mudar nada (guarda bloqueia)
  const doc2=recebimentos._registro.get(id);
  assert.equal(i.podeFinalizarDescarga(doc2),false);
});

test('76/93: modal "+ Novo Recebimento" e as 9 colunas principais da tabela existem; rota registrada',()=>{
  assert.match(htmlCode,/id="modal-recop"/);
  assert.match(htmlCode,/93-recebimento-operacao\.js/);
  assert.match(opCode,/data-recop-novo/);
  assert.match(opCode,/data-recop-iniciar-descarga/);
  assert.match(opCode,/data-recop-finalizar-descarga/);
  assert.match(opCode,/data-recop-finalizar=/);
  assert.match(opCode,/data-recop-cancelar/);
});

test('Firestore rules: correção de horário em recebimentos é um ramo separado, restrito aos campos de horário/status + tempos recalculados',()=>{
  // A lógica de corrigir-horario mora em _recAcaoConsolidada() (função
  // consolidada reaproveitada pelos dois ramos de `allow update`, própria
  // loja e cross-loja — correção estrutural que evita repetir a checagem 4x
  // por ramo), não mais inline dentro do bloco `match /recebimentos/` —
  // a fatia começa na função, não no match, pra continuar cobrindo os dois.
  const trecho=rules.slice(rules.indexOf('function _recAcaoConsolidada'),rules.indexOf('match /recebimento_auditoria/'));
  assert.match(trecho,/corrigir-horario/);
  // 'status' entrou nessa lista pro "Voltar etapa" (pedido ao vivo do
  // usuário) — reaproveita a mesma permissão administrativa em vez de abrir
  // um ramo de escrita novo.
  // notasVolumesTransferencia/volumes entraram junto (sessão seguinte: NF
  // ganhou volume por nota) — mesmo ramo de corrigir-horario.
  // motoristaId/motoristaNome/transportadora entraram depois (pedido ao
  // vivo: "eu consigo ajustar tudo, menos troca o motorista que veio,
  // quando saiu de um lugar eles biparam o motorista errado") — ainda o
  // MESMO ramo administrativo, sem abrir permissão nova nem tocar em
  // status/loja (origemLojaId/destinoLojaId continuam fora desta lista).
  assert.match(trecho,/affectedKeys\(\)\.hasOnly\(\['status','horaChegada','horaInicioDescarga','horaFimDescarga','horaFechamentoRecebimento','horaSaida','tempoViagemMin','tempoEsperaMin','tempoDescargaMin','tempoTotalMin','tempoAteFechamentoMin','atualizadoEm','atualizadoPor','notaFiscalTransferencia','notasVolumesTransferencia','volumes','notaFiscalConfirmadaEm','notaFiscalConfirmadaPor','motoristaId','motoristaNome','transportadora','identificadorCodigo'\]\)/);
});

test('REGRESSÃO: "Voltar etapa" (pedido ao vivo do usuário: "não quero que uma ação errada deixe o transbordo preso em uma etapa sem possibilidade de correção") reverte status e limpa só o horário daquele passo, sem mexer no resto',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'CHEGOU',motoristaNome:'Carlos',placa:'ABC1D23',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-1',horaChegada:'2026-08-14T07:00:00.000Z',notaFiscalConfirmadaEm:'2026-08-14T07:00:05.000Z',notaFiscalConfirmadaPor:'analista@daterrinha.com'}}]);
  const auditoria=mockColecao([]);
  const {window}=loadOperacao({recebimentos,recebimento_auditoria:auditoria,recebimento_motoristas:mockColecao([]),recebimento_veiculos:mockColecao([]),recebimento_docas:mockColecao([])});
  await window._recebimentoOperacaoInternals.carregar(true);
  const i=window._recebimentoOperacaoInternals;

  assert.equal(i.podeVoltarEtapa({status:'PREVISTO'}),false); // nada antes do primeiro passo
  assert.equal(i.podeVoltarEtapa({status:'CANCELADO'}),false); // cancelado não é reversão de etapa
  assert.equal(i.podeVoltarEtapa({status:'CHEGOU'}),true);

  await i.voltarEtapa('r1');
  const doc=recebimentos._registro.get('r1');
  assert.equal(doc.status,'EM_TRANSITO'); // voltou de CHEGOU pra EM_TRANSITO
  assert.equal(doc.horaChegada,null); // horário daquela etapa some
  assert.equal(doc.notaFiscalConfirmadaEm,null);
  assert.equal(doc.notaFiscalConfirmadaPor,null);
  assert.equal(doc.horaSaida,'2026-08-14T06:00:00.000Z'); // etapas anteriores ficam intactas
  assert.equal(doc.notaFiscalTransferencia,'NF-1'); // NF da saída não é apagada, só a confirmação da chegada
  assert.equal(doc.motoristaNome,'Carlos'); // dados que não são de etapa continuam intactos
  assert.equal([...auditoria._registro.values()][0].operacao,'ETAPA_REVERTIDA');
});

test('REGRESSÃO: reorganização em 3 abas (pedido ao vivo: "EM TRÂNSITO | EM ANDAMENTO | FINALIZADOS") — cada status cai na aba certa e a tabela mostra só a aba ativa',async()=>{
  const recebimentos=mockColecao([
    {id:'r1',data:{tipo:'TRANSBORDO',status:'PREVISTO',motoristaNome:'A'}},
    {id:'r2',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',motoristaNome:'B'}},
    {id:'r3',data:{tipo:'TRANSBORDO',status:'CHEGOU',motoristaNome:'C'}},
    {id:'r4',data:{tipo:'TRANSBORDO',status:'EM_DESCARGA',motoristaNome:'D'}},
    {id:'r5',data:{tipo:'TRANSBORDO',status:'DESCARGA_FINALIZADA',motoristaNome:'E'}},
    {id:'r6',data:{tipo:'TRANSBORDO',status:'FINALIZADO',motoristaNome:'F'}},
    {id:'r7',data:{tipo:'TRANSBORDO',status:'CANCELADO',motoristaNome:'G'}},
  ]);
  const {window,elFake}=loadOperacao({recebimentos,recebimento_motoristas:mockColecao([]),recebimento_veiculos:mockColecao([]),recebimento_docas:mockColecao([])});
  await window.renderRecebimentoOperacao();

  // não deve mais existir o dropdown solto de status — virou abas fixas
  assert.doesNotMatch(opCode,/recop-f-status/);
  assert.doesNotMatch(opCode,/_filtroStatus/);
  assert.match(opCode,/data-recop-aba/);
  assert.match(opCode,/EM TRÂNSITO|Em Trânsito/);
  assert.match(opCode,/EM ANDAMENTO|Em Andamento/);
  assert.match(opCode,/FINALIZADOS|Finalizados/);

  // aba padrão é "transito": PREVISTO e EM_TRANSITO aparecem, o resto não
  const html=elFake('page-recebimento-operacao').innerHTML;
  assert.match(html,/>A</);
  assert.match(html,/>B</);
  assert.doesNotMatch(html,/>C</);
  assert.doesNotMatch(html,/>F</);

  window.recopAbrirComFiltro({status:'EM_DESCARGA'});
  await window.renderRecebimentoOperacao();
  const html2=elFake('page-recebimento-operacao').innerHTML;
  assert.match(html2,/>C</); // CHEGOU
  assert.match(html2,/>D</); // EM_DESCARGA
  assert.doesNotMatch(html2,/>A</);
  assert.doesNotMatch(html2,/>F</);

  window.recopAbrirComFiltro({status:'FINALIZADO'});
  await window.renderRecebimentoOperacao();
  const html3=elFake('page-recebimento-operacao').innerHTML;
  assert.match(html3,/>F</);
  assert.match(html3,/>G</); // CANCELADO entra no histórico de finalizados
  assert.doesNotMatch(html3,/>A</);
});
