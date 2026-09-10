// BUG AO VIVO REAL (2026-08-29), print real do Coletor: "Bipe os produtos"
// mostrava só "Produto" (sem nome), "GTIN —" e "Previsto" errado; a etapa
// de volume mostrava "esperado 0" mesmo com produtos reais na nota; e
// receber várias notas do mesmo motorista com o MESMO produto pedia o
// total de cada nota separado, em vez de somar. Três correções em
// 24-recebimento-recusas.js: (1) volumeEsperadoNota cai pra soma das
// quantidades dos itens quando a nota não tem "volumes" (o BI não traz
// isso — só o PDF antigo trazia, e foi removido); (2) _enriquecerItem
// busca nome/GTIN em producao_produtos quando a nota não trouxe (sem
// GTIN, a bipagem nunca reconhecia o produto — bug funcional, não só
// visual); (3) _mesclarItensPorProduto soma a quantidade prevista do
// mesmo produto vindo de notas diferentes numa linha só.
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const baseColetor=path.join(__dirname,'../js/coletor');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const navCode=fs.readFileSync(path.join(baseColetor,'10-navegacao-estorno.js'),'utf8');
const recusasCode=fs.readFileSync(path.join(baseColetor,'24-recebimento-recusas.js'),'utf8');

const CHAVE_A='35260800123456780001235500100000123412345673';
const CHAVE_B='35260800123456780001235500100000987654321110';

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
function cadastrosPadrao(extra){
  return Object.assign({
    recebimento_recusas_motoristas: mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]),
    recebimento_recusas_motivos: mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]),
  }, extra);
}

test('BUG AO VIVO REAL: volume esperado NÃO fica em zero quando a nota (BI) não traz "volumes" mas tem itens — cai pra soma das quantidades', async()=>{
  const notas=mockColecao([{id:CHAVE_A,data:{numeroNota:'191445',destinatario:'Cliente X',volumes:null,itens:[{produtoKey:'304',descricao:'Tapioca',gtin:'',quantidade:5},{produtoKey:'305',descricao:'Fécula',gtin:'',quantidade:3}]}}]);
  const { win, document }=carregarColetorReal(cadastrosPadrao({ recebimento_recusas_notas:notas }));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_A;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  assert.match(document.getElementById('recusa-volume-feedback').innerHTML,/8/,'esperado deveria ser 5+3=8, nunca 0, quando existem itens reais');
});

test('BUG AO VIVO REAL: nota sem GTIN/nome (comum vindo do BI) preenche a partir do cadastro (producao_produtos) por produtoKey — mostra nome real e a bipagem passa a reconhecer o produto', async()=>{
  const notas=mockColecao([{id:CHAVE_A,data:{numeroNota:'191445',destinatario:'Cliente X',volumes:10,itens:[{produtoKey:'304',descricao:'',gtin:'',quantidade:5}]}}]);
  const produtos=mockColecao([{id:'p1',data:{cod:'304',nome:'Tapioca 1kg',gtin:'7891234567890'}}]);
  const { win, document }=carregarColetorReal(cadastrosPadrao({ recebimento_recusas_notas:notas, producao_produtos:produtos }));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  await new Promise(r=>setTimeout(r,0)); // carregarCadastros() busca producao_produtos em paralelo
  document.getElementById('recusa-chave-input').value=CHAVE_A;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='5';
  document.getElementById('recusa-continuar-3').click();
  document.getElementById('recusa-conf-itens').click();

  let html=document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html,/Tapioca 1kg/,'nome deveria vir do cadastro quando a nota não trouxe descrição');
  assert.match(html,/GTIN 7891234567890/,'GTIN deveria vir do cadastro quando a nota não trouxe GTIN');

  // prova que a bipagem passa a FUNCIONAR de verdade (antes, gtin sempre
  // vazio significava que nenhum código bipado batia com nada).
  document.getElementById('recusa-conf-scan').value='7891234567890';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  html=document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html,/1\/1 produto/);
});

// BUG AO VIVO REAL: "na hora de preencher a quantidade não mostra a
// quantidade que colocou, fica escondido" — o input de quantidade por
// item era estreito (80px) e as setas nativas de <input type=number>
// disputavam esse espaço com o dígito digitado. Corrigido escondendo as
// setas nativas via .conf-item-qtd (coletor.css) — este teste garante que
// a classe continua aplicada e que o valor digitado permanece no campo
// (jsdom não renderiza as setas visualmente, mas garante a classe e o
// comportamento do campo).
test('BUG AO VIVO REAL: input de quantidade por item usa .conf-item-qtd (sem setas nativas) e mantém o valor digitado visível no campo', async()=>{
  const notas=mockColecao([{id:CHAVE_A,data:{numeroNota:'170221',destinatario:'Cliente X',volumes:10,itens:[{produtoKey:'304',descricao:'Tapioca',gtin:'789',quantidade:50}]}}]);
  const { win, document }=carregarColetorReal(cadastrosPadrao({ recebimento_recusas_notas:notas }));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_A;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='50';
  document.getElementById('recusa-continuar-3').click();
  document.getElementById('recusa-conf-itens').click();

  const input=document.querySelector('[data-conf-item-qtd="0"]');
  assert.ok(input,'input de quantidade do item precisa existir');
  assert.match(input.className,/\bconf-item-qtd\b/,'precisa ter a classe que remove as setas nativas do number');
  input.value='42';
  input.dispatchEvent(new win.Event('input',{bubbles:true}));
  assert.equal(input.value,'42','o dígito digitado precisa continuar visível no próprio campo');
});

test('PEDIDO AO VIVO: mesmo produto em duas notas do mesmo retorno soma o previsto numa linha só, e a bipagem incrementa essa linha mesclada', async()=>{
  const notas=mockColecao([
    {id:CHAVE_A,data:{numeroNota:'100',destinatario:'Cliente X',volumes:10,itens:[{produtoKey:'304',descricao:'Tapioca 1kg',gtin:'789',quantidade:5}]}},
    {id:CHAVE_B,data:{numeroNota:'101',destinatario:'Cliente X',volumes:10,itens:[{produtoKey:'304',descricao:'Tapioca 1kg',gtin:'789',quantidade:3}]}},
  ]);
  const recusas=mockColecao([]);
  const { win, document }=carregarColetorReal(cadastrosPadrao({ recebimento_recusas_notas:notas, recebimento_recusas:recusas }));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_A;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-chave-input').value=CHAVE_B;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  assert.match(document.getElementById('recusa-notas-lista').innerHTML,/100/);
  assert.match(document.getElementById('recusa-notas-lista').innerHTML,/101/);

  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='8';
  document.getElementById('recusa-continuar-3').click();
  document.getElementById('recusa-conf-itens').click();

  let html=document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html,/Previsto 8/,'5 da NF 100 + 3 da NF 101 numa linha só');
  assert.equal((html.match(/Tapioca 1kg/g)||[]).length,1,'não pode aparecer 2 linhas separadas pro mesmo produto');
  assert.match(html,/NF 100, 101|NF 101, 100/);
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/0\/1 produto/,'é 1 produto (mesclado), não 2 linhas');

  document.getElementById('recusa-conf-scan').value='789';
  document.getElementById('recusa-conf-scan').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
  document.getElementById('recusa-conf-concluir').click();
  document.getElementById('recusa-box').value='box 5'; // FASE 11: box+pallets virou o último passo
  document.getElementById('recusa-continuar-4').click();
  await new Promise(r=>setTimeout(r,0));

  const payload=[...recusas._registro.values()][0];
  assert.equal(payload.itensConferidos.length,1,'grava 1 item mesclado, não 2 duplicados');
  assert.equal(payload.itensConferidos[0].qtdPrevista,8);
  assert.equal(payload.itensConferidos[0].qtdConferida,1);
  assert.equal(payload.statusConferenciaOperacional,'CONFERIDA_COM_DIVERGENCIA','1 bipado contra 8 previstos ainda diverge');
});
