const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const configCode=fs.readFileSync(path.join(base,'92-recebimento-config.js'),'utf8');
const navCode=fs.readFileSync(path.join(base,'03-core-navigation.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');
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
        get: async()=>{ const data=registro.get(docId); return { exists: data!==undefined, id:docId, data:()=>data }; },
        set: async(payload)=>{ const atual=registro.get(docId)||{}; registro.set(docId,{...atual,...payload}); },
        delete: async()=>{ registro.delete(docId); },
      };
    },
    add: async(payload)=>{ const docId='novo'+(seq++); registro.set(docId,payload); return {id:docId}; },
    _registro: registro,
  };
}

// `opts.lojaAntiga` simula o cadastro LEGADO por loja (path lojas/{lojaId}/
// recebimento_motoristas|recebimento_veiculos), pra testar a migração
// automática pro cadastro global: { motoristas: mockColecao(...), veiculos:
// mockColecao(...) }.
function loadConfig(colecoes,opts){
  const elementos=new Map();
  function elFake(id){
    if(!elementos.has(id)) elementos.set(id,{id,value:'',textContent:'',innerHTML:''});
    return elementos.get(id);
  }
  const document={
    addEventListener:()=>{},
    getElementById:(id)=>{
      if(id==='page-recebimento-config') return elFake(id);
      return elementos.has(id)?elementos.get(id):elFake(id);
    },
  };
  const lojaId=opts?.lojaId||'loja1';
  const window={
    getDTFirestore:()=>({ collection:(nome)=>colecoes[nome]||mockColecao([]) }),
    getDTLojaAtiva:()=>lojaId,
    getDTRawFirestore: opts?.lojaAntiga ? (()=>({
      collection:(nome)=>{
        if (nome!=='lojas') return mockColecao([]);
        return { doc:(id)=>({ collection:(sub)=>{
          if (id!==lojaId) return mockColecao([]);
          if (sub==='recebimento_motoristas') return opts.lojaAntiga.motoristas||mockColecao([]);
          if (sub==='recebimento_veiculos') return opts.lojaAntiga.veiculos||mockColecao([]);
          return mockColecao([]);
        } }) };
      },
    })) : undefined,
    openModal:()=>{}, closeModal:()=>{}, showToast:()=>{}, showConfirm:(msg,exec)=>exec(),
    recbtMostrarQr:()=>{},
  };
  vm.runInNewContext(configCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise},{filename:'92-recebimento-config.js'});
  return {window,elFake};
}

test('cadastro de motorista: salva novo e edita existente (upsert por doc-id, mesmo padrão de 61-producao-maquinas.js)',async()=>{
  const motoristas=mockColecao([]);
  const veiculos=mockColecao([]);
  const docas=mockColecao([]);
  const {window,elFake}=loadConfig({recebimento_motoristas:motoristas,recebimento_veiculos:veiculos,recebimento_docas:docas});
  elFake('recmot-doc-id').value='';
  elFake('recmot-nome').value='João Silva';
  elFake('recmot-documento').value='123.456.789-00';
  elFake('recmot-telefone').value='11999998888';
  elFake('recmot-transportadora').value='Transp. Rápida';
  elFake('recmot-ativo').value='true';
  await window.recmotSalvar();
  assert.equal(motoristas._registro.size,1);
  const [id,doc]=[...motoristas._registro.entries()][0];
  assert.equal(doc.nome,'João Silva');
  assert.equal(doc.ativo,true);

  elFake('recmot-doc-id').value=id;
  elFake('recmot-nome').value='João Silva Neto';
  elFake('recmot-ativo').value='false';
  await window.recmotSalvar();
  assert.equal(motoristas._registro.size,1); // upsert, não duplicou
  assert.equal(motoristas._registro.get(id).nome,'João Silva Neto');
  assert.equal(motoristas._registro.get(id).ativo,false);
});

test('cadastro de veículo exige placa e vincula motorista habitual por id',async()=>{
  const motoristas=mockColecao([{id:'m1',data:{nome:'João'}}]);
  const veiculos=mockColecao([]);
  const docas=mockColecao([]);
  const {window,elFake}=loadConfig({recebimento_motoristas:motoristas,recebimento_veiculos:veiculos,recebimento_docas:docas});
  elFake('recveic-doc-id').value='';
  elFake('recveic-placa').value='';
  await window.recveicSalvar();
  assert.equal(veiculos._registro.size,0); // sem placa, não salva

  elFake('recveic-placa').value='abc1d23';
  elFake('recveic-tipo').value='Caminhão baú';
  elFake('recveic-motorista').value='m1';
  elFake('recveic-ativo').value='true';
  await window.recveicSalvar();
  assert.equal(veiculos._registro.size,1);
  const doc=[...veiculos._registro.values()][0];
  assert.equal(doc.placa,'ABC1D23'); // normaliza maiúsculo
  assert.equal(doc.motoristaHabitualId,'m1');
});

test('cadastro de doca salva nome e observação',async()=>{
  const docas=mockColecao([]);
  const {window,elFake}=loadConfig({recebimento_motoristas:mockColecao([]),recebimento_veiculos:mockColecao([]),recebimento_docas:docas});
  elFake('recdoca-doc-id').value='';
  elFake('recdoca-nome').value='Doca 1';
  elFake('recdoca-observacao').value='Perto da rampa principal';
  elFake('recdoca-ativo').value='true';
  await window.recdocaSalvar();
  assert.equal(docas._registro.size,1);
  assert.equal([...docas._registro.values()][0].nome,'Doca 1');
});

test('FASE 4b: motorista novo já sai com código fixo gerado (pra imprimir e reaproveitar em toda viagem dele) — editar depois NUNCA troca esse código',async()=>{
  const motoristas=mockColecao([]);
  const {window,elFake}=loadConfig({recebimento_motoristas:motoristas,recebimento_veiculos:mockColecao([]),recebimento_docas:mockColecao([])});

  window.recmotNovo(); // abre o modal já com um código pronto no campo oculto
  const codigoGerado=elFake('recmot-codigo').value;
  assert.match(codigoGerado,/^MOT-/);

  elFake('recmot-doc-id').value='';
  elFake('recmot-nome').value='Carlos Silva';
  elFake('recmot-ativo').value='true';
  await window.recmotSalvar();
  const [id,doc]=[...motoristas._registro.entries()][0];
  assert.equal(doc.codigo,codigoGerado);

  // edita o cadastro (nome) — o código não pode mudar, é o QR já impresso na mão do motorista
  elFake('recmot-doc-id').value=id;
  elFake('recmot-nome').value='Carlos R. Silva';
  await window.recmotSalvar();
  assert.equal(motoristas._registro.get(id).codigo,codigoGerado);
});

test('FASE 4b: motorista cadastrado antes desta funcionalidade (sem código) recebe um via "gerar código" (backfill), e "ver QR" chama o mesmo modal do Transbordo',async()=>{
  const motoristas=mockColecao([{id:'m1',data:{nome:'Ana',codigo:null}}]);
  let qrChamado=null;
  const {window}=loadConfig({recebimento_motoristas:motoristas,recebimento_veiculos:mockColecao([]),recebimento_docas:mockColecao([]),recebimento_config_geral:mockColecao([])});
  window.recbtMostrarQr=(codigo,titulo)=>{ qrChamado={codigo,titulo}; };

  await window._recebimentoConfigInternals.carregar();
  await window.recmotGerarCodigo('m1');
  const codigoGerado=motoristas._registro.get('m1').codigo;
  assert.match(codigoGerado,/^MOT-/);

  await window._recebimentoConfigInternals.carregar(true); // recarrega pra pegar o código novo em memória
  window.recmotVerQr('m1');
  assert.equal(qrChamado.codigo,codigoGerado);
  assert.equal(qrChamado.titulo,'Ana');
});

test('FASE 4h: rotas de transbordo (Remetente → Destino) são globais e cadastradas com duas caixinhas (pedido ao vivo: "duas caixinha uma do lado da outra, loja remetente e loja destino") — uma rota já habilita os dois sentidos, sem precisar repetir em cada loja',async()=>{
  const rotas=mockColecao([]);
  const {window,elFake}=loadConfig({recebimento_motoristas:mockColecao([]),recebimento_veiculos:mockColecao([]),recebimento_docas:mockColecao([]),recebimento_config_geral:mockColecao([]),recebimento_rotas_transbordo:rotas});
  window.DTLoja={ listar: async()=>[{id:'loja1',nome:'Loja Matriz'},{id:'loja2',nome:'Filial Centro'},{id:'loja3',nome:'Filial Norte'}] };
  window.getDTLojaAtiva=()=>'loja1';
  await window._recebimentoConfigInternals.carregar(true);

  elFake('recconf-rota-remetente').value='loja1';
  elFake('recconf-rota-destino').value='loja2';
  await window.recrotaAdicionar();

  assert.equal(rotas._registro.size,1);
  const rota=[...rotas._registro.values()][0];
  assert.equal(rota.origemLojaId,'loja1'); assert.equal(rota.origemNome,'Loja Matriz');
  assert.equal(rota.destinoLojaId,'loja2'); assert.equal(rota.destinoNome,'Filial Centro');
  assert.equal(window._recebimentoConfigInternals.rotas().length,1);

  // não deixa remetente igual a destino, nem duplicar a mesma rota
  elFake('recconf-rota-remetente').value='loja1';
  elFake('recconf-rota-destino').value='loja1';
  await window.recrotaAdicionar();
  assert.equal(rotas._registro.size,1); // não criou a inválida

  elFake('recconf-rota-destino').value='loja2';
  await window.recrotaAdicionar();
  assert.equal(rotas._registro.size,1); // não duplicou a que já existe

  // cadastra outra rota e depois remove a primeira
  elFake('recconf-rota-destino').value='loja3';
  await window.recrotaAdicionar();
  assert.equal(rotas._registro.size,2);
  const idLoja2=[...rotas._registro.entries()].find(([,d])=>d.destinoLojaId==='loja2')[0];
  window.showConfirm=(msg,exec)=>exec();
  await window.recrotaExcluir(idLoja2);
  assert.equal(rotas._registro.size,1);
  assert.equal([...rotas._registro.values()][0].destinoLojaId,'loja3');
});

test('FASE 4h: migração automática — config antiga por loja (singular lojaParceiraId ou plural lojasParceiras, de leva anterior) vira rota global uma vez, sem duplicar quando os dois lados já migraram a mesma rota',async()=>{
  const rotas=mockColecao([]);
  const configGeral=mockColecao([{id:'padrao',data:{lojaParceiraId:'loja2',lojaParceiraNome:'Filial Centro'}}]);
  const {window}=loadConfig({recebimento_motoristas:mockColecao([]),recebimento_veiculos:mockColecao([]),recebimento_docas:mockColecao([]),recebimento_config_geral:configGeral,recebimento_rotas_transbordo:rotas});
  window.DTLoja={ listar: async()=>[{id:'loja1',nome:'Loja Matriz'},{id:'loja2',nome:'Filial Centro'}] };
  window.getDTLojaAtiva=()=>'loja1';
  await window._recebimentoConfigInternals.carregar(true);

  assert.equal(rotas._registro.size,1);
  const rota=[...rotas._registro.values()][0];
  assert.equal(rota.origemLojaId,'loja1');
  assert.equal(rota.destinoLojaId,'loja2');
  assert.equal(configGeral._registro.get('padrao').rotasTransbordoMigradas,true);

  // recarregar de novo não duplica (flag já marcada)
  await window._recebimentoConfigInternals.carregar(true);
  assert.equal(rotas._registro.size,1);
});

test('REGRESSÃO/FASE 4d: motorista/veículo cadastrados antes desta leva (presos à loja onde foram criados) são migrados automaticamente pro cadastro global na 1ª vez que a tela de Configurações carrega — sem duplicar em cadastros futuros e sem duplicar quem já existe no global',async()=>{
  const motoristasGlobal=mockColecao([{id:'gA',data:{nome:'Zé Global',codigo:'MOT-JAGLOBAL'}}]); // já migrado por outra loja antes
  const veiculosGlobal=mockColecao([]);
  const configGeral=mockColecao([]);
  const motoristasAntigos=mockColecao([
    {id:'legadoA',data:{nome:'Carlos Silva',codigo:'MOT-ABC123'}}, // precisa migrar
    {id:'legadoB',data:{nome:'Zé Global',codigo:'MOT-JAGLOBAL'}}, // mesmo código do global — NÃO duplica
  ]);
  const veiculosAntigos=mockColecao([{id:'legadoV',data:{placa:'XYZ9A87',tipo:'Baú'}}]);
  const {window}=loadConfig(
    { recebimento_motoristas:motoristasGlobal, recebimento_veiculos:veiculosGlobal, recebimento_docas:mockColecao([]), recebimento_config_geral:configGeral },
    { lojaId:'loja_matriz', lojaAntiga:{ motoristas:motoristasAntigos, veiculos:veiculosAntigos } }
  );

  await window._recebimentoConfigInternals.carregar(true);

  assert.equal(motoristasGlobal._registro.size,2); // só o Carlos novo entrou; o Zé Global (mesmo código) não duplicou
  const nomes=[...motoristasGlobal._registro.values()].map(m=>m.nome).sort();
  assert.deepEqual(nomes,['Carlos Silva','Zé Global']);
  assert.equal(veiculosGlobal._registro.size,1);
  assert.equal([...veiculosGlobal._registro.values()][0].placa,'XYZ9A87');
  assert.equal(configGeral._registro.get('padrao').motoristasVeiculosMigrados,true); // marcado — não roda de novo

  // 2ª carga (mesma loja): não duplica de novo, mesmo rodando a migração de novo por engano
  await window._recebimentoConfigInternals.migrarMotoristasVeiculosGlobal();
  assert.equal(motoristasGlobal._registro.size,2);
  assert.equal(veiculosGlobal._registro.size,1);
});

test('navegação e Firestore rules: recebimento-config roteado, e as 5 coleções novas da FASE 2 têm regra restrita a recebimento-operacao/config/agendamentos',()=>{
  assert.match(navCode,/case 'recebimento-config':\s*return _callPage\('renderRecebimentoConfig'\)/);
  assert.match(htmlCode,/id="modal-recmot"/);
  assert.match(htmlCode,/id="modal-recveic"/);
  assert.match(htmlCode,/id="modal-recdoca"/);
  assert.match(htmlCode,/92-recebimento-config\.js/);
  ['recebimento_motoristas','recebimento_veiculos','recebimento_docas','recebimento_agendamentos','recebimentos','recebimento_auditoria','recebimento_config_geral'].forEach(col=>{
    assert.match(rules,new RegExp('match /'+col+'/'));
  });
  // 'corrigir-horario' pra 'recebimento-operacao' não é mais checada via
  // hasPermission(area, operation) direto na regra de update — foi
  // consolidada em _recAcaoConsolidada() (função só, reaproveitada pelos
  // dois ramos de `allow update`, própria loja e cross-loja — correção
  // estrutural pra caber no limite de 1000 sub-expressões do motor de
  // regras do Firestore, confirmado via Rules Unit Testing contra o
  // emulador real com dados de conta reais).
  assert.match(rules,/function _recAcaoConsolidada[\s\S]*?'corrigir-horario'/);
  const trechoQualquerCanal=rules.slice(rules.indexOf('function _recAcaoConsolidada('),rules.indexOf('function _recAcaoConsolidada(')+2500);
  assert.match(trechoQualquerCanal,/'recebimento-operacao'/);
  const trechoRecebimentos=rules.slice(rules.indexOf('match /recebimentos/'),rules.indexOf('match /recebimento_auditoria/'));
  assert.match(trechoRecebimentos,/allow delete: if false;/);
  assert.match(htmlCode,/id="recmot-codigo"/); // código fixo nunca editável pelo formulário, só carregado/devolvido
});
