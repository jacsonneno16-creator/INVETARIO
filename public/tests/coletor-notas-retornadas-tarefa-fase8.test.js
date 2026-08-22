// FASE 8 do módulo "Notas Retornadas": Analista delega conferência posterior
// pra um operador específico (recebimento_recusas_tarefas_conferencia, no
// molde de dt_atribuicoes_contagem). O operador vê a tarefa ao entrar em
// Notas Retornadas, bipa os produtos e conclui — SEM criar um segundo
// registro, atualizando a MESMA recusa original.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const baseColetor=path.join(__dirname,'../js/coletor');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const navCode=fs.readFileSync(path.join(baseColetor,'10-navegacao-estorno.js'),'utf8');
const recusasCode=fs.readFileSync(path.join(baseColetor,'24-recebimento-recusas.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    doc:(id)=>({
      id,
      get: async()=>{ const data=registro.get(id); return { exists: data!==undefined, id, data:()=>data }; },
      update: async(payload)=>{ const a=registro.get(id); if(a===undefined) throw new Error('NOT_FOUND'); registro.set(id,{...a,...payload}); },
    }),
    where:(campo,op,valor)=>({
      get: async()=>snapshot([...registro.entries()].filter(([,data])=>data && data[campo]===valor)),
    }),
    _registro: registro,
  };
}

function carregarColetorReal(colecoes,email){
  const dom=new JSDOM(htmlCode,{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  win.FS={ collection:(nome)=>colecoes?.[nome]||mockColecao([]) };
  win.getDTFirestore=()=>win.FS;
  win.showToast=()=>{};
  win.firebase={ auth:()=>({ currentUser:{ uid:'op1', email: email||'operador@daterrinha.com' } }) };
  Object.defineProperty(win.navigator,'onLine',{ get:()=>true, configurable:true });
  win.eval(navCode);
  win.eval(recusasCode);
  return { win, document };
}

test('operador com tarefa PENDENTE atribuída vê o card "Conferências pendentes pra você" ao entrar em Notas Retornadas',async()=>{
  const tarefas=mockColecao([{id:'r1',data:{recusaId:'r1',box:'BOX 5',notas:[{chave:'X',numeroNota:'999'}],atribuidoPara:'operador@daterrinha.com',status:'PENDENTE'}}]);
  const { win, document }=carregarColetorReal({ recebimento_recusas_tarefas_conferencia:tarefas, recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });
  await win.abrirRecusasRecebimento();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/Conferências pendentes pra você/);
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/NF 999/);
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/BOX 5/);
});

test('operador SEM tarefas atribuídas (ou tarefa de outro e-mail) não vê o card',async()=>{
  const tarefas=mockColecao([{id:'r1',data:{recusaId:'r1',box:'BOX 5',notas:[],atribuidoPara:'outro@daterrinha.com',status:'PENDENTE'}}]);
  const { win, document }=carregarColetorReal({ recebimento_recusas_tarefas_conferencia:tarefas, recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });
  await win.abrirRecusasRecebimento();
  assert.doesNotMatch(document.getElementById('recusa-fluxo-host').innerHTML,/Conferências pendentes/);
});

test('"Iniciar" pula direto pra bipagem de itens (sem motorista/motivo/volume/box) e "Concluir conferência" atualiza a RECUSA ORIGINAL + marca a tarefa CONCLUIDA, sem criar um segundo registro',async()=>{
  const notaX=mockColecao([{id:'CHAVEX',data:{numeroNota:'999',itens:[{produtoKey:1,descricao:'Refrigerante 2L',gtin:'789',quantidade:2}]}}]);
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 5',statusConferenciaOperacional:'NAO_REALIZADA',itensConferidos:[]}}]);
  const tarefas=mockColecao([{id:'r1',data:{recusaId:'r1',box:'BOX 5',notas:[{chave:'CHAVEX',numeroNota:'999'}],atribuidoPara:'operador@daterrinha.com',status:'PENDENTE'}}]);
  const { win, document }=carregarColetorReal({
    recebimento_recusas_notas:notaX, recebimento_recusas:recusas, recebimento_recusas_tarefas_conferencia:tarefas,
    recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]),
  });
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-tarefa-iniciar]').click();
  await new Promise(r=>setTimeout(r,0));

  // caiu direto na tela de bipagem de itens — nenhuma tela de motorista/box no meio
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/Bipe os produtos/);
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/Refrigerante 2L/);

  document.getElementById('recusa-conf-scan').value='789';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  document.getElementById('recusa-conf-scan').value='789';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));

  document.getElementById('recusa-conf-concluir').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(recusas._registro.size,1,'não deve ter criado um segundo registro em recebimento_recusas');
  const recusaAtualizada=recusas._registro.get('r1');
  assert.equal(recusaAtualizada.statusConferenciaOperacional,'CONFERIDA');
  assert.equal(recusaAtualizada.itensConferidos.length,1);
  assert.equal(recusaAtualizada.itensConferidos[0].qtdConferida,2);
  assert.ok(recusaAtualizada.conferenciaConcluidaPorEmail,'operador@daterrinha.com');

  const tarefaAtualizada=tarefas._registro.get('r1');
  assert.equal(tarefaAtualizada.status,'CONCLUIDA');
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/Conferência concluída/);
});
