// FASES 6/7 do módulo "Notas Retornadas" no Coletor: Box+Pallets, badge de
// identificação (só informativo, nunca classificação — o operador NUNCA
// decide se é devolução), e a escolha "Conferir produtos" (bipagem de
// GTIN, item a item) vs "Receber somente o volume".
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
    where:()=>({ limit:()=>({ get: async()=>snapshot([]) }) }),
    _registro: registro,
  };
}

function carregarColetorReal(colecoes){
  const dom=new JSDOM(htmlCode,{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  win.FS={ collection:(nome)=>colecoes?.[nome]||mockColecao([]) };
  win.getDTFirestore=()=>win.FS;
  win.showToast=()=>{};
  Object.defineProperty(win.navigator,'onLine',{ get:()=>true, configurable:true });
  win.eval(navCode);
  win.eval(recusasCode);
  return { win, document };
}

// Motorista/motivo viraram uma busca (combo de texto + lista filtrada) em
// vez de <select> nativo — pedido ao vivo do usuário: "quando clico em
// cima, tem que deixar a pessoa digitar também para não ficar procurando
// durante um tempão" (rolar um <select> com ~30 motoristas era lento).
// Seleciona pelo mousedown na opção (é isso que a lista escuta — não
// click, pra registrar antes do blur do campo esconder a lista).
function selecionarComboOpcao(document,prefixo,valor){
  const win=document.defaultView;
  const opcao=document.querySelector(`[data-combo-opcao="${prefixo}"][data-combo-valor="${valor}"]`);
  opcao.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true}));
}
async function avancarAteConferencia(document,{ notaExtra }={}){
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='10';
  document.getElementById('recusa-continuar-3').click();
  document.getElementById('recusa-box').value='box 7';
  document.getElementById('recusa-pallets').value='3';
  document.getElementById('recusa-continuar-4').click();
}

// PEDIDO AO VIVO (usuário: "quando clico em cima [motorista/motivo], tem
// que deixar a pessoa digitar também para não ficar procurando durante um
// tempão") — os <select> nativos viraram um campo de texto com lista
// filtrada em tempo real.
test('PEDIDO AO VIVO: campo de motorista filtra a lista ao digitar, e digitar de novo depois de selecionar limpa a seleção',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Mercado Atacadão',volumes:10}}]);
  const motoristas=mockColecao([
    {id:'m1',data:{nome:'João Pereira',ativo:true}},
    {id:'m2',data:{nome:'Maria Souza',ativo:true}},
    {id:'m3',data:{nome:'José Almeida',ativo:true}},
  ]);
  const { win, document }=carregarColetorReal({ recebimento_recusas_notas:notas, recebimento_recusas_motoristas:motoristas, recebimento_recusas_motivos:mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]) });
  await win.abrirRecusasRecebimento();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();

  const input=document.getElementById('recusa-motorista-busca');
  assert.ok(input,'campo de busca precisa existir (não é mais <select>)');
  input.value='mar';
  input.dispatchEvent(new win.Event('input',{bubbles:true}));
  const lista=document.getElementById('recusa-motorista-lista');
  assert.match(lista.innerHTML,/Maria Souza/);
  assert.doesNotMatch(lista.innerHTML,/João Pereira/,'filtro por texto (acento-insensível) não deve trazer quem não bate');
  assert.doesNotMatch(lista.innerHTML,/José Almeida/);

  selecionarComboOpcao(document,'recusa-motorista','m2');
  assert.equal(document.getElementById('recusa-motorista-busca').value,'Maria Souza');

  // digitar de novo depois de já ter selecionado precisa limpar a seleção —
  // senão dava pra "Continuar" com um motorista que não é mais o que está
  // escrito na tela.
  const input2=document.getElementById('recusa-motorista-busca');
  input2.value='Maria S';
  input2.dispatchEvent(new win.Event('input',{bubbles:true}));
  document.getElementById('recusa-continuar-2').click();
  assert.equal(document.getElementById('recusa-volume'),null,'não pode avançar de etapa com o texto digitado não batendo com nenhuma seleção válida');
});

test('nota vinda da Bluesoft com pareceDevolucao=true mostra o badge "Nota de devolução identificada" — só informativo',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Mercado Atacadão',volumes:10,origemImportacao:'BLUESOFT',pareceDevolucao:true,itens:[]}}]);
  const { win, document }=carregarColetorReal({ recebimento_recusas_notas:notas, recebimento_recusas_motoristas:mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]), recebimento_recusas_motivos:mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]) });
  await win.abrirRecusasRecebimento();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  assert.match(document.getElementById('recusa-notas-lista').innerHTML,/Nota de devolução identificada/);
});

test('nota importada por PDF (sem origemImportacao=BLUESOFT) não mostra nenhum badge de identificação — sem dado, sem opinar',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Mercado Atacadão',volumes:10}}]);
  const { win, document }=carregarColetorReal({ recebimento_recusas_notas:notas, recebimento_recusas_motoristas:mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]), recebimento_recusas_motivos:mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]) });
  await win.abrirRecusasRecebimento();
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  assert.doesNotMatch(document.getElementById('recusa-notas-lista').innerHTML,/identificada/);
});

test('sem itens[] disponíveis, "Conferir produtos" fica desabilitado — só "Receber somente o volume" funciona',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:10}}]);
  const { win, document }=carregarColetorReal({ recebimento_recusas_notas:notas, recebimento_recusas_motoristas:mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]), recebimento_recusas_motivos:mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]) });
  await win.abrirRecusasRecebimento();
  await avancarAteConferencia(document);
  assert.equal(document.getElementById('recusa-conf-itens').disabled,true);
});

test('bipagem de GTIN soma 1 na quantidade conferida; produto não conferido gera CONFERIDA_COM_DIVERGENCIA no payload final',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{
    numeroNota:'12345',destinatario:'Cliente X',volumes:10,
    itens:[{produtoKey:1,descricao:'Refrigerante 2L',gtin:'789',quantidade:2},{produtoKey:2,descricao:'Água 500ml',gtin:'790',quantidade:5}],
  }}]);
  const recusas=mockColecao([]);
  const { win, document }=carregarColetorReal({
    recebimento_recusas_notas:notas, recebimento_recusas:recusas,
    recebimento_recusas_motoristas:mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]),
    recebimento_recusas_motivos:mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]),
  });
  await win.abrirRecusasRecebimento();
  await avancarAteConferencia(document);
  assert.equal(document.getElementById('recusa-conf-itens').disabled,false);
  document.getElementById('recusa-conf-itens').click();

  // bipa o GTIN 789 duas vezes (bate com o previsto de 2); GTIN 790 fica em 0 (previsto 5 — divergente)
  document.getElementById('recusa-conf-scan').value='789';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  document.getElementById('recusa-conf-scan').value='789';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/1\/2 produto/);

  document.getElementById('recusa-conf-concluir').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(recusas._registro.size,1);
  const payload=[...recusas._registro.values()][0];
  assert.equal(payload.pallets,3);
  assert.equal(payload.statusConferenciaOperacional,'CONFERIDA_COM_DIVERGENCIA');
  assert.equal(payload.itensConferidos.length,2);
  assert.equal(payload.itensConferidos[0].qtdConferida,2);
  assert.equal(payload.itensConferidos[1].qtdConferida,0);
});

test('bipagem de GTIN desconhecido mostra erro e não altera nenhum item',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:10,itens:[{produtoKey:1,descricao:'Refrigerante 2L',gtin:'789',quantidade:2}]}}]);
  const toasts=[];
  const { win, document }=carregarColetorReal({ recebimento_recusas_notas:notas, recebimento_recusas_motoristas:mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]), recebimento_recusas_motivos:mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]) });
  win.showToast=(m,t)=>toasts.push({m,t});
  await win.abrirRecusasRecebimento();
  await avancarAteConferencia(document);
  document.getElementById('recusa-conf-itens').click();
  document.getElementById('recusa-conf-scan').value='999999';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  assert.ok(toasts.some(t=>/não encontrado/.test(t.m)));
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/0\/1 produto/);
});

test('"Receber somente o volume" grava statusConferenciaOperacional=NAO_REALIZADA mesmo quando a nota tem itens[] disponíveis',async()=>{
  const notas=mockColecao([{id:CHAVE_VALIDA,data:{numeroNota:'12345',destinatario:'Cliente X',volumes:10,itens:[{produtoKey:1,descricao:'Refrigerante 2L',gtin:'789',quantidade:2}]}}]);
  const recusas=mockColecao([]);
  const { win, document }=carregarColetorReal({
    recebimento_recusas_notas:notas, recebimento_recusas:recusas,
    recebimento_recusas_motoristas:mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]),
    recebimento_recusas_motivos:mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]),
  });
  await win.abrirRecusasRecebimento();
  await avancarAteConferencia(document);
  document.getElementById('recusa-conf-somente-volume').click();
  await new Promise(r=>setTimeout(r,0));
  const payload=[...recusas._registro.values()][0];
  assert.equal(payload.statusConferenciaOperacional,'NAO_REALIZADA');
  assert.equal(payload.itensConferidos.length,0);
});
