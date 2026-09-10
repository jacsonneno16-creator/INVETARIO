// FASE 1 do módulo "Notas Retornadas": navegação hierárquica do Coletor em
// Recebimento (Categoria → Escolha do módulo → Funcionalidade), igual ao
// padrão que "Inventário" já usa (screen-mode). Este teste roda o DOM REAL
// de coletor.html (não uma casca resumida) contra o goScreen REAL de
// 10-navegacao-estorno.js — garante que o card "Transbordo" e o card
// "Notas Retornadas" da nova screen-recebimento-modo realmente acionam as
// funções certas e trocam a tela .active de verdade, e que as cadeias de
// botão voltar levam pro lugar certo.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const baseColetor=path.join(__dirname,'../js/coletor');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const navCode=fs.readFileSync(path.join(baseColetor,'10-navegacao-estorno.js'),'utf8');
const recCode=fs.readFileSync(path.join(baseColetor,'22-recebimento.js'),'utf8');
const recusasCode=fs.readFileSync(path.join(baseColetor,'24-recebimento-recusas.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    doc:(id)=>({
      id,
      get: async()=>{ const data=registro.get(id); return { exists: data!==undefined, id, data:()=>data }; },
    }),
    where:()=>({ limit:()=>({ get: async()=>snapshot([]) }), get: async()=>snapshot([]) }),
    _registro: registro,
  };
}

// Carrega o coletor.html DE VERDADE (screens reais, sem casca resumida) e
// executa por cima o goScreen real + o abrirAreaRecebimento/
// abrirTransbordoRecebimento reais + o abrirRecusasRecebimento real —
// só Firestore/APP/dispositivo são mockados (fronteira externa).
function carregarColetorReal(colecoes){
  const dom=new JSDOM(htmlCode,{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  win.FS={ collection:(nome)=>colecoes?.[nome]||mockColecao([]) };
  win.getDTFirestore=()=>win.FS;
  win.APP={ operador:{ email:'operador@daterrinha.com' } };
  win.obterDeviceId=()=>'dt_teste123';
  win.getDTLojaAtiva=()=>'loja1';
  win.getDTRawFirestore=()=>({ collection:()=>mockColecao([]) });
  win.toast=()=>{};
  Object.defineProperty(win.navigator,'onLine',{ get:()=>true, configurable:true });
  win.eval(navCode);   // goScreen real
  win.eval(recCode);   // abrirAreaRecebimento / abrirTransbordoRecebimento reais
  win.eval(recusasCode); // abrirRecusasRecebimento real
  return { win, document };
}

function telaAtiva(document){
  return [...document.querySelectorAll('.screen.active')].map(s=>s.id);
}

test('abrirAreaRecebimento() mostra a nova tela de escolha (screen-recebimento-modo), não entra direto no Transbordo',()=>{
  const { win, document }=carregarColetorReal();
  win.abrirAreaRecebimento();
  assert.deepEqual(telaAtiva(document),['screen-recebimento-modo']);
});

test('card "Transbordo" da tela de escolha chama carregarRecebimentoColetor() e abre screen-recebimento',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',identificadorCodigo:'TRB-1'}}]);
  const { win, document }=carregarColetorReal({ recebimentos });
  win.abrirAreaRecebimento();
  win.abrirTransbordoRecebimento(); // dispara e não espera (mesmo comportamento do onclick real)
  assert.deepEqual(telaAtiva(document),['screen-recebimento']); // troca de tela é síncrona
  await win.carregarRecebimentoColetor(); // guarda de reentrância devolve a MESMA promessa já em voo
  assert.match(document.getElementById('rec-lista-andamento').innerHTML,/TRB-1/);
});

test('card "Notas Retornadas" da tela de escolha chama abrirRecusasRecebimento() e abre screen-recebimento-recusas',async()=>{
  const motoristas=mockColecao([{id:'m1',data:{nome:'João',ativo:true}}]);
  const motivos=mockColecao([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]);
  const { win, document }=carregarColetorReal({ recebimento_recusas_motoristas:motoristas, recebimento_recusas_motivos:motivos });
  win.abrirAreaRecebimento();
  await win.abrirRecusasRecebimento();
  assert.deepEqual(telaAtiva(document),['screen-recebimento-recusas']);
  document.querySelector('[data-recusa-modo="entrada"]').click();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML,/Bipe a chave de acesso/);
});

test('cadeias de botão voltar: acesso→recebimento-modo, recebimento→recebimento-modo, recebimento-recusas→recebimento-modo',async()=>{
  const { win, document }=carregarColetorReal();
  // Recebimento (Transbordo) volta pra tela de escolha, não pro Acesso
  win.abrirAreaRecebimento();
  await win.abrirTransbordoRecebimento();
  assert.match(document.getElementById('screen-recebimento').outerHTML,/onclick="goScreen\('recebimento-modo'\)"/);
  // Notas Retornadas também volta pra tela de escolha
  await win.abrirRecusasRecebimento();
  assert.match(document.getElementById('screen-recebimento-recusas').outerHTML,/goScreen\('recebimento-modo'\)/);
});

test('a tela de escolha não tem mais o botão fixo antigo de Recusas dentro do Transbordo',()=>{
  const { document }=carregarColetorReal();
  assert.equal(document.getElementById('btn-abrir-recusas'),null);
  const modo=document.getElementById('screen-recebimento-modo');
  assert.match(modo.outerHTML,/abrirTransbordoRecebimento\(\)/);
  assert.match(modo.outerHTML,/abrirRecusasRecebimento\(\)/);
});

test('REGRESSÃO (bug ao vivo real, relatado pelo usuário: "operador não consegue criar transbordo, não aparece a opção") — screen-recebimento tem um botão visível que chama abrirScanRecebimento(), e ele realmente abre a tela de bipagem',async()=>{
  const { win, document }=carregarColetorReal();
  win.abrirAreaRecebimento();
  win.abrirTransbordoRecebimento();
  const tela=document.getElementById('screen-recebimento');
  assert.match(tela.outerHTML,/onclick="abrirScanRecebimento\(\)"/,'o botão de bipar QR do motorista (única forma de CRIAR um transbordo) sumiu da tela');
  assert.equal(typeof win.abrirScanRecebimento,'function');
  win.abrirScanRecebimento();
  assert.deepEqual(telaAtiva(document),['screen-recebimento-scan']);
});
