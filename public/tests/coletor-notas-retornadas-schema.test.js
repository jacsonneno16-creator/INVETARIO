// FASE 3 do módulo "Notas Retornadas": trava (regressão) o formato ATUAL do
// payload que finalizar() grava em recebimento_recusas — antes de qualquer
// fase futura (Bluesoft, conferência item a item, fluxo de recusa) começar
// a ACRESCENTAR campos novos. Se este teste quebrar por um campo existente
// ter sumido/mudado de nome, é sinal de regressão; se quebrar só porque um
// campo novo apareceu, ajuste o `assert.deepEqual` das chaves aqui (fases
// seguintes SÓ ADICIONAM, nunca removem/renomeiam os campos já travados).
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const baseColetor=path.join(__dirname,'../js/coletor');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const navCode=fs.readFileSync(path.join(baseColetor,'10-navegacao-estorno.js'),'utf8');
const recusasCode=fs.readFileSync(path.join(baseColetor,'24-recebimento-recusas.js'),'utf8');

// Chave de NF-e de 44 dígitos com dígito verificador (mod-11) válido —
// gerada uma vez, fixa aqui só pra passar pela validação de chaveValida().
const CHAVE_VALIDA='35260800123456780001235500100000123412345673';

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  let seq=0;
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    doc:(id)=>({
      id: id||('novo'+(seq++)),
      get: async()=>{ const data=registro.get(id); return { exists: data!==undefined, id, data:()=>data }; },
    }),
    add: async(payload)=>{ const docId='novo'+(seq++); registro.set(docId,payload); return {id:docId}; },
    where:()=>({ limit:()=>({ get: async()=>snapshot([]) }), get: async()=>snapshot([]) }), // nenhuma recusa anterior pra essa chave
    _registro: registro,
  };
}

function carregarColetorReal(colecoes){
  const dom=new JSDOM(htmlCode,{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  win.FS={ collection:(nome)=>colecoes?.[nome]||mockColecao([]) };
  win.getDTFirestore=()=>win.FS;
  win.toast=()=>{};
  Object.defineProperty(win.navigator,'onLine',{ get:()=>true, configurable:true });
  win.eval(navCode);
  win.eval(recusasCode);
  return { win, document };
}

// Motorista/motivo viraram uma busca (combo de texto + lista filtrada) em
// vez de <select> nativo — pedido ao vivo do usuário: "quando clico em
// cima, tem que deixar a pessoa digitar também para não ficar procurando
// durante um tempão". Seleciona pelo mousedown na opção (é isso que a
// lista escuta, não click, pra registrar antes do blur esconder a lista).
function selecionarComboOpcao(document,prefixo,valor){
  const win=document.defaultView;
  const opcao=document.querySelector(`[data-combo-opcao="${prefixo}"][data-combo-valor="${valor}"]`);
  opcao.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true}));
}

test('REGRESSÃO (FASE 3): payload gravado por finalizar() em recebimento_recusas mantém exatamente o mesmo conjunto de campos de hoje',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Mercado Atacadão',volumes:10}}]);
  const motoristas=mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]);
  const motivos=mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]);
  const recusas=mockColecao([]);
  const { win, document }=carregarColetorReal({
    recebimento_recusas_notas:notas,
    recebimento_recusas_motoristas:motoristas,
    recebimento_recusas_motivos:motivos,
    recebimento_recusas:recusas,
  });

  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0)); // adicionarChave() é assíncrona (consulta a nota)

  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();

  document.getElementById('recusa-volume').value='8'; // diferente do esperado (10) — força diferencaVolumes != 0
  document.getElementById('recusa-continuar-3').click(); // FASE 11: volume agora leva direto pra escolha de conferência

  document.getElementById('recusa-conf-somente-volume').click(); // sem itens disponíveis nesta nota (não veio da Bluesoft) — só "somente volume" está habilitado
  document.getElementById('recusa-box').value='box 12'; // FASE 11: box+pallets virou o último passo, depois da conferência
  document.getElementById('recusa-continuar-4').click();
  await new Promise(r=>setTimeout(r,0)); // finalizar() é assíncrona

  assert.equal(recusas._registro.size,1);
  const payload=[...recusas._registro.values()][0];

  // Pedido ao vivo do usuário (planilha real de controle): "Conferente" —
  // novo campo opcional, 2026-08-20. Igual aos outros dessa fase, sempre
  // presente no payload (vazio quando ninguém foi selecionado), nunca
  // omitido condicionalmente.
  // PEDIDO AO VIVO (2026-09-08): `numerosNotas` — array irmão de `chaves`,
  // mesma ideia (permitir `.where('numerosNotas','array-contains',...)`),
  // pra tela de "Saída" (Coletor) achar o registro de entrada pelo NÚMERO
  // impresso da nota, sem baixar a coleção inteira.
  // PEDIDO AO VIVO (2026-09-10): `statusFisico` — novo campo, "Pátio em
  // Tempo Real" (105-recebimento-patio-tempo-real.js). Toda entrada nova
  // começa 'NO_PATIO' (recalculado depois em confirmarSaida/
  // alterarTratamento/mudarStatusRetorno conforme a nota sai de verdade).
  assert.deepEqual(Object.keys(payload).sort(),[
    'box','chaves','conferenciaStatus','conferenteId','conferenteNome','criadoEm','criadoPorEmail','criadoPorUid',
    'diferencaVolumes','itensConferidos','motivoId','motivoNome','motoristaId','motoristaNome',
    'notas','numerosNotas','origem','pallets','statusConferenciaOperacional','statusFisico','volumeEsperado','volumeInformado',
  ].sort());
  assert.equal(payload.statusFisico, 'NO_PATIO');
  // `payload` vem de win.eval (outro realm) — deepStrictEqual falha por
  // Array.prototype diferente mesmo com o mesmo conteúdo; compara via JSON
  // (mesma convenção já usada noutros testes cross-realm desta sessão).
  assert.equal(JSON.stringify(payload.numerosNotas), JSON.stringify([payload.notas[0].numeroNota]));
  assert.equal(payload.conferenteId,'','conferente é opcional — não selecionado nesse teste, fica vazio');
  // `box` — Pátio em Tempo Real: promovido pra dentro de cada nota (mesmo
  // valor do Box do documento, já que todas chegam juntas no mesmo evento).
  assert.deepEqual(Object.keys(payload.notas[0]).sort(),['box','chave','destinatario','numeroNota','volumeEsperado'].sort());
  assert.equal(payload.notas[0].box, payload.box);

  assert.equal(payload.chaves.length,1);
  assert.equal(payload.chaves[0],CHAVE_VALIDA);
  assert.equal(payload.box,'BOX 12'); // maiúsculas — comportamento atual, não uma escolha desta fase
  assert.equal(payload.volumeEsperado,10);
  assert.equal(payload.volumeInformado,8);
  assert.equal(payload.diferencaVolumes,-2);
  assert.equal(payload.conferenciaStatus,'DIVERGENTE');
  assert.equal(payload.origem,'COLETOR');
  // FASE 6/7 — sem pallets digitado e sem conferência de itens (nota sem itens[])
  assert.equal(payload.pallets,null);
  assert.equal(payload.statusConferenciaOperacional,'NAO_REALIZADA');
  assert.equal(payload.itensConferidos.length,0);
});
