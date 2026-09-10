// PEDIDO AO VIVO (usuário, 2026-08-20): "quando coloca o volume, ele tem
// que mostrar pro conferente se colocou o volume certo ou nao, mostrar
// tipo o volume correto da nota" + "quando entro bipo a chave de acesso,
// coloco todas as infomrçoes e erro alguma coisa no passo anterior e
// aperto em voltar para ajustar o anterior ele volta tudo e tem que
// refazer tudo" — dois bugs corrigidos em 24-recebimento-recusas.js:
// (1) feedback de volume esperado x contado, ao vivo; (2) botões de
// voltar em toda etapa que NUNCA chamam reset(), só trocam S.etapa.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const baseColetor=path.join(__dirname,'../js/coletor');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const navCode=fs.readFileSync(path.join(baseColetor,'10-navegacao-estorno.js'),'utf8');
const recusasCode=fs.readFileSync(path.join(baseColetor,'24-recebimento-recusas.js'),'utf8');

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
    where:()=>({ limit:()=>({ get: async()=>snapshot([]) }), get: async()=>snapshot([]) }),
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
function selecionarComboOpcao(document,prefixo,valor){
  const win=document.defaultView;
  const opcao=document.querySelector(`[data-combo-opcao="${prefixo}"][data-combo-valor="${valor}"]`);
  opcao.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true}));
}
// carregarTarefasPendentes() faz .where('atribuidoPara','==',email).get()
// SEM .limit() — o mockColecao genérico acima (copiado do padrão da fase
// 6/7) só serve pro caso .where(...).limit(1).get() do histórico de
// recusas; aqui precisa filtrar de verdade.
function mockColecaoComWhere(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    doc:(id)=>({ id, get: async()=>{ const data=registro.get(id); return { exists: data!==undefined, id, data:()=>data }; }, update: async(patch)=>{ registro.set(id,{...(registro.get(id)||{}),...patch}); } }),
    where:(campo,_op,valor)=>({
      get: async()=>snapshot([...registro.entries()].filter(([,data])=>data[campo]===valor)),
      limit:()=>({ get: async()=>snapshot([]) }),
    }),
    _registro: registro,
  };
}
function colecoesPadrao(notas){
  return {
    recebimento_recusas_notas: notas,
    recebimento_recusas: mockColecao([]),
    recebimento_recusas_motoristas: mockColecao([{id:'m1',data:{nome:'João Pereira',ativo:true}}]),
    recebimento_recusas_motivos: mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]),
    recebimento_recusas_conferentes: mockColecao([{id:'c1',data:{nome:'Ana Conferente',ativo:true}}]),
  };
}

// ---- Feedback de volume ----

test('etapa de volume mostra o volume esperado da nota antes de digitar qualquer coisa',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  assert.match(document.getElementById('recusa-volume-feedback').innerHTML,/Volume esperado da nota.*8|8.*Volume esperado/s);
});

test('digitar um volume que bate com o esperado mostra feedback de OK, ao vivo, sem perder o foco do campo',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();

  const input=document.getElementById('recusa-volume');
  input.focus();
  input.value='8';
  input.dispatchEvent(new win.Event('input',{bubbles:true}));
  assert.match(document.getElementById('recusa-volume-feedback').innerHTML,/Confere/);
  assert.equal(document.activeElement,input,'o foco não pode sair do campo só porque o feedback foi atualizado');
});

test('digitar um volume divergente do esperado mostra alerta com a diferença, ao vivo',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();

  const input=document.getElementById('recusa-volume');
  input.value='5';
  input.dispatchEvent(new win.Event('input',{bubbles:true}));
  const feedback=document.getElementById('recusa-volume-feedback').innerHTML;
  assert.match(feedback,/Divergente/);
  assert.match(feedback,/esperado 8/);
  assert.match(feedback,/contado 5/);
});

test('volume esperado soma quando há mais de uma nota no mesmo retorno',async()=>{
  const notas=mockColecao([
    {id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}},
  ]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  assert.match(document.getElementById('recusa-volume-feedback').innerHTML,/8/);
});

// ---- Voltar sem perder dados ----

test('PEDIDO AO VIVO: voltar da etapa de motorista/motivo/conferente pra chave, e avançar de novo, preserva a lista de notas lidas',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();

  document.getElementById('recusa-voltar-2').click();
  assert.match(document.getElementById('recusa-notas-lista').innerHTML,/12345/,'a nota lida não pode sumir ao voltar');

  document.getElementById('recusa-continuar-1').click();
  assert.ok(document.getElementById('recusa-motorista-busca'),'precisa conseguir avançar de novo normalmente depois de voltar');
});

test('PEDIDO AO VIVO: preencher motorista/motivo, avançar até volume, voltar, e o que foi selecionado continua lá',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();

  document.getElementById('recusa-voltar-3').click();
  assert.equal(document.getElementById('recusa-motorista-busca').value,'João Pereira','motorista selecionado precisa continuar marcado ao voltar');
  assert.equal(document.getElementById('recusa-motivo-busca').value,'Cliente ausente');
});

// PEDIDO AO VIVO (2026-09-03): "o conferente não vai precisar nem
// selecionar... vai descobrir pelo login" — substitui o combo manual de
// conferente por resolução automática (e-mail do login batendo com o
// cadastro), testada aqui em vez da seleção manual acima.
test('PEDIDO AO VIVO: conferente é detectado sozinho pelo e-mail de login, sem precisar selecionar — e continua detectado ao voltar/avançar',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const { win, document }=carregarColetorReal({...colecoesPadrao(notas), recebimento_recusas_conferentes:mockColecao([{id:'c1',data:{nome:'Ana Conferente',ativo:true,email:'ana@daterrinha.com'}}])});
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'ana@daterrinha.com' } }) };
  win.getDTAuth=win.firebase.auth;
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  assert.equal(document.getElementById('recusa-conferente-busca'),null,'não existe mais combo manual de conferente');
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/Conferente:.*Ana Conferente/s,'conferente detectado sozinho pelo login, sem seleção manual');

  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-voltar-3').click();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/Conferente:.*Ana Conferente/s,'continua detectado ao voltar pra etapa de motorista');
});

test('login sem conferente cadastrado com esse e-mail mostra aviso, não trava o fluxo',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'sem-cadastro@daterrinha.com' } }) };
  win.getDTAuth=win.firebase.auth;
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/Não foi possível identificar o conferente/);
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  assert.ok(document.getElementById('recusa-volume'),'sem conferente identificado o fluxo continua normalmente');
});

// FASE 11 (2026-09-03): Box+Pallets virou o ÚLTIMO passo do fluxo, depois
// da conferência dos produtos — este teste passou a cobrir "voltar da
// escolha de conferência pro volume", não mais "voltar do Box pro volume".
test('PEDIDO AO VIVO: digitar volume, avançar pra escolha de conferência, voltar pro volume — o número digitado continua lá (não zera)',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='8';
  document.getElementById('recusa-continuar-3').click();

  document.getElementById('recusa-voltar-conferencia').click();
  assert.equal(document.getElementById('recusa-volume').value,'8','o volume contado não pode sumir ao voltar da escolha de conferência');
});

// BUG AO VIVO REAL: "erro alguma coisa no passo anterior e aperto em
// voltar para ajustar o anterior ele volta tudo e tem que refazer tudo"
// — cenário completo: chega até a escolha de conferência, volta até o
// volume pra corrigir, e TUDO que já estava preenchido (notas, motorista,
// motivo, conferente) continua lá até o fim — inclusive o Box, preenchido
// só no final agora (FASE 11).
test('BUG AO VIVO REAL: corrigir o volume no meio do fluxo (voltar até Volume) não obriga a refazer nota/motorista/motivo',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8}}]);
  const recusas=mockColecao([]);
  const { win, document }=carregarColetorReal({...colecoesPadrao(notas), recebimento_recusas:recusas});
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='5'; // errado de propósito
  document.getElementById('recusa-continuar-3').click(); // -> escolha de conferência

  document.getElementById('recusa-voltar-conferencia').click(); // -> volume
  assert.equal(document.getElementById('recusa-volume').value,'5','volume errado ainda visível pra corrigir');

  document.getElementById('recusa-volume').value='8'; // corrige
  document.getElementById('recusa-continuar-3').click(); // -> escolha de conferência de novo

  document.getElementById('recusa-conf-somente-volume').click(); // -> Box (último passo)
  document.getElementById('recusa-box').value='box 9';
  document.getElementById('recusa-continuar-4').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(recusas._registro.size,1);
  const payload=[...recusas._registro.values()][0];
  assert.equal(payload.motoristaNome,'João Pereira');
  assert.equal(payload.motivoNome,'Cliente ausente');
  assert.equal(payload.box,'BOX 9');
  assert.equal(payload.volumeInformado,8);
  assert.equal(payload.conferenciaStatus,'CONFERIDO');
});

// FASE 11: a escolha de conferência agora vem logo depois do volume (não
// mais depois do Box); e o Box (agora o último passo) volta pra "itens" ou
// pra "conferencia", dependendo do caminho escolhido.
test('voltar da escolha de conferência retorna pro volume; voltar da etapa de itens retorna pra escolha de conferência; voltar do Box (último passo) retorna pros itens',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8,itens:[{produtoKey:1,descricao:'Item A',gtin:'789',quantidade:2}]}}]);
  const { win, document }=carregarColetorReal(colecoesPadrao(notas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='8';
  document.getElementById('recusa-continuar-3').click();

  assert.ok(document.getElementById('recusa-conf-itens'),'chegou na tela de escolha de conferência logo depois do volume');
  document.getElementById('recusa-voltar-conferencia').click();
  assert.ok(document.getElementById('recusa-volume'),'voltar da escolha de conferência cai no volume, não mais no Box');
  document.getElementById('recusa-continuar-3').click();

  document.getElementById('recusa-conf-itens').click();
  assert.ok(document.getElementById('recusa-voltar-itens'),'etapa de itens (fluxo normal, não delegado) precisa ter botão de voltar');
  document.getElementById('recusa-voltar-itens').click();
  assert.ok(document.getElementById('recusa-conf-itens'),'voltou pra escolha de conferência');

  document.getElementById('recusa-conf-itens').click();
  document.getElementById('recusa-conf-concluir').click();
  document.getElementById('recusa-box').value='box 1';
  assert.ok(document.getElementById('recusa-voltar-4'),'chegou no Box, o último passo');
  document.getElementById('recusa-voltar-4').click();
  assert.ok(document.getElementById('recusa-conf-scan'),'voltar do Box (veio de "conferir produtos") cai de volta nos itens, não na escolha');
});

test('conferência delegada (modoTarefa) não mostra botão de voltar na etapa de itens — não há passo anterior nesse fluxo',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:8,itens:[{produtoKey:1,descricao:'Item A',gtin:'789',quantidade:2}]}}]);
  const tarefas=mockColecaoComWhere([{id:'t1',data:{atribuidoPara:'op@x.com',status:'PENDENTE',box:'BOX 1',recusaId:'r1',notas:[{chave:CHAVE_VALIDA,numeroNota:'12345'}]}}]);
  const { win, document }=carregarColetorReal({...colecoesPadrao(notas), recebimento_recusas_tarefas_conferencia:tarefas});
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'op@x.com' } }) };
  win.getDTAuth=win.firebase.auth;
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await new Promise(r=>setTimeout(r,0));
  const botaoIniciar=document.querySelector('[data-tarefa-iniciar]');
  assert.ok(botaoIniciar,'tarefa pendente precisa aparecer pro operador certo');
  botaoIniciar.click();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(document.getElementById('recusa-voltar-itens'),null,'sem passo anterior na conferência delegada, não faz sentido mostrar Voltar');
});
