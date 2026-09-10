// PEDIDO AO VIVO (2026-09-03, pt. 2): "lá no coletor na hora de receber a
// nota, ele às vezes o banco de dados não está atualizado então a nota pode
// ter retornado e ainda não está no banco de dados. Então, ele deixar
// prosseguir... bipar normal a chave de acesso, e aí caso não ache a pessoa
// vai colocar manualmente o número da nota... e aí vai seguir o fluxo
// normal... na hora da conferência... mostrar qual é o produto que ele
// bipou." Antes, uma chave que não batesse com NADA (nem ledger de venda,
// nem devolução automática) travava com "Nota não encontrada". Agora fica
// pendente até o operador confirmar o número (pré-preenchido a partir da
// própria chave), e a conferência de produtos vira "livre": bipar contra o
// catálogo geral (producao_produtos) em vez de uma lista de itens prevista
// que nunca existiu pra essa nota.
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const baseColetor=path.join(__dirname,'../js/coletor');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const navCode=fs.readFileSync(path.join(baseColetor,'10-navegacao-estorno.js'),'utf8');
const recusasCode=fs.readFileSync(path.join(baseColetor,'24-recebimento-recusas.js'),'utf8');

const CHAVE_VALIDA='35260800123456780001235500100000123412345673';
const NUMERO_DA_CHAVE='10000012'; // nNF embutido na própria chave (posições 26-34)

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
    where:()=>({ get: async()=>snapshot([]) }),
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
function cadastrosPadrao(extra){
  return Object.assign({
    recebimento_recusas_motoristas: mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]),
    recebimento_recusas_motivos: mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]),
  }, extra);
}
async function biparChaveNaoEncontrada(document){
  document.getElementById('recusa-chave-input').value=CHAVE_VALIDA;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
}

test('chave que não bate com nada (nem venda, nem devolução automática) não trava mais — pede o número da nota, pré-preenchido a partir da própria chave', async()=>{
  const { win, document }=carregarColetorReal(cadastrosPadrao());
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await biparChaveNaoEncontrada(document);

  const html=document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html,/Nota ainda não está no sistema/,'mostra o aviso, não trava com erro');
  const numeroInput=document.getElementById('recusa-chave-manual-numero');
  assert.ok(numeroInput,'campo de número da nota aparece');
  assert.equal(numeroInput.value,NUMERO_DA_CHAVE,'pré-preenchido com o número extraído da própria chave');
  assert.doesNotMatch(document.getElementById('recusa-notas-lista').innerHTML,new RegExp('NF '+NUMERO_DA_CHAVE),'ainda não entrou na lista — só depois de confirmar');
});

test('cancelar o pendente limpa o estado e permite bipar de novo', async()=>{
  const { win, document }=carregarColetorReal(cadastrosPadrao());
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await biparChaveNaoEncontrada(document);
  document.getElementById('recusa-chave-manual-cancelar').click();
  assert.equal(document.getElementById('recusa-chave-manual-numero'),null,'formulário pendente sumiu');
  assert.match(document.getElementById('recusa-notas-lista').innerHTML,/Nenhuma nota lida ainda/);
});

test('confirmar o número (editado ou não) adiciona a nota com origemImportacao MANUAL_SEM_BANCO e o badge de aviso', async()=>{
  const { win, document }=carregarColetorReal(cadastrosPadrao());
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await biparChaveNaoEncontrada(document);
  document.getElementById('recusa-chave-manual-numero').value='999888';
  document.getElementById('recusa-chave-manual-confirmar').click();

  const listaHtml=document.getElementById('recusa-notas-lista').innerHTML;
  assert.match(listaHtml,/NF 999888/,'usa o número corrigido pelo operador, não o pré-preenchido');
  assert.match(listaHtml,/digitado manualmente/,'badge avisa que foi digitado manualmente');
  assert.equal(document.getElementById('recusa-chave-manual-numero'),null,'formulário pendente fecha depois de confirmar');
});

test('confirmar sem digitar nada (campo vazio) mostra erro e não adiciona a nota', async()=>{
  const toasts=[];
  const { win, document }=carregarColetorReal(cadastrosPadrao());
  win.toast=(m,t)=>toasts.push({m,t});
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await biparChaveNaoEncontrada(document);
  document.getElementById('recusa-chave-manual-numero').value='';
  document.getElementById('recusa-chave-manual-confirmar').click();
  assert.ok(toasts.some(t=>/Informe o número/.test(t.m)));
  assert.match(document.getElementById('recusa-notas-lista').innerHTML,/Nenhuma nota lida ainda/);
});

async function avancarAteConferenciaComNotaManual(document){
  await biparChaveNaoEncontrada(document);
  document.getElementById('recusa-chave-manual-confirmar').click();
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='0';
  document.getElementById('recusa-continuar-3').click();
}

test('nota manual (sem itens[] conhecido) HABILITA "Conferir produtos" — diferente de uma nota comum sem itens, que fica desabilitada', async()=>{
  const { win, document }=carregarColetorReal(cadastrosPadrao());
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await avancarAteConferenciaComNotaManual(document);
  assert.equal(document.getElementById('recusa-conf-itens').disabled,false,'mesmo sem itens conhecidos, a nota manual permite bipar livre');
});

test('conferência livre: bipar um GTIN do catálogo geral (producao_produtos) cria a linha na hora, mostrando o nome do produto', async()=>{
  const produtos=mockColecao([{id:'p1',data:{cod:'304',nome:'Tapioca 1kg',gtin:'7891234567890'}}]);
  const { win, document }=carregarColetorReal({...cadastrosPadrao(), producao_produtos:produtos});
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await new Promise(r=>setTimeout(r,0));
  await avancarAteConferenciaComNotaManual(document);
  document.getElementById('recusa-conf-itens').click();

  let html=document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html,/0\/0 produto/,'começa vazio — nenhum item previsto');

  document.getElementById('recusa-conf-scan').value='7891234567890';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  html=document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html,/Tapioca 1kg/,'linha aparece com o nome do produto vindo do catálogo');
  assert.match(html,/Bipado agora/,'marca que essa linha não estava prevista, foi bipada agora');
  assert.doesNotMatch(html,/border:1px solid #7a4a1f/,'não fica marcada como divergente — não existe expectativa pra comparar');

  document.getElementById('recusa-conf-scan').value='7891234567890';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  html=document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html,/1\/1 produto/,'segunda bipagem do MESMO código incrementa a mesma linha, não duplica');
});

test('conferência livre: código que não existe nem na lista nem no catálogo continua mostrando erro', async()=>{
  const toasts=[];
  const { win, document }=carregarColetorReal(cadastrosPadrao());
  win.toast=(m,t)=>toasts.push({m,t});
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await avancarAteConferenciaComNotaManual(document);
  document.getElementById('recusa-conf-itens').click();
  document.getElementById('recusa-conf-scan').value='000000';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  assert.ok(toasts.some(t=>/não encontrado/.test(t.m)));
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/0\/0 produto/);
});

test('concluir com só itens bipados livremente (sem expectativa) grava CONFERIDA, nunca CONFERIDA_COM_DIVERGENCIA', async()=>{
  const produtos=mockColecao([{id:'p1',data:{cod:'304',nome:'Tapioca 1kg',gtin:'7891234567890'}}]);
  const recusas=mockColecao([]);
  const { win, document }=carregarColetorReal({...cadastrosPadrao(), producao_produtos:produtos, recebimento_recusas:recusas});
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await new Promise(r=>setTimeout(r,0));
  await avancarAteConferenciaComNotaManual(document);
  document.getElementById('recusa-conf-itens').click();
  document.getElementById('recusa-conf-scan').value='7891234567890';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  document.getElementById('recusa-conf-concluir').click();
  document.getElementById('recusa-box').value='box 1';
  document.getElementById('recusa-continuar-4').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(recusas._registro.size,1);
  const payload=[...recusas._registro.values()][0];
  assert.equal(payload.statusConferenciaOperacional,'CONFERIDA','item sem expectativa nunca gera divergência sozinho');
  assert.equal(payload.itensConferidos.length,1);
  assert.equal(payload.itensConferidos[0].qtdConferida,1);
  assert.equal(payload.itensConferidos[0].qtdPrevista,0);
});
