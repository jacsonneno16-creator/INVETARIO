const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/coletor');
const recCode=fs.readFileSync(path.join(base,'22-recebimento.js'),'utf8');
const offCode=fs.readFileSync(path.join(base,'23-recebimento-offline.js'),'utf8');
const coreCode=fs.readFileSync(path.join(base,'01-core-firebase-cache.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  let seq=0;
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    doc:(id)=>{
      const docId=id||('novo'+(seq++));
      return {
        id:docId,
        get: async()=>{ const data=registro.get(docId); return { exists: data!==undefined, id:docId, data:()=>data }; },
        set: async(p)=>{ const a=registro.get(docId)||{}; registro.set(docId,{...a,...p}); },
        update: async(p)=>{ const a=registro.get(docId); if(a===undefined) throw new Error('NOT_FOUND: no document to update'); registro.set(docId,{...a,...p}); },
        delete: async()=>{ registro.delete(docId); },
      };
    },
    add: async(payload)=>{ const docId='novo'+(seq++); registro.set(docId,payload); return {id:docId}; },
    where:(campo,op,valor)=>({ get: async()=>snapshot([...registro.entries()].filter(([,data])=>data && data[campo]===valor)) }),
    _registro: registro,
  };
}

function mockRecIdb(){
  const store=new Map();
  return {
    recIdbPut: async(bip)=>{ store.set(bip.uuid,bip); },
    recIdbDelete: async(uuid)=>{ store.delete(uuid); },
    recIdbGetPendentes: async()=>[...store.values()].filter(b=>b.status_sync==='pendente'),
    recIdbGetAll: async()=>[...store.values()],
    _store: store,
  };
}

// Migrado pra jsdom de verdade — mesmo motivo do coletor-fase4-recebimento:
// a tela de NF ganhou linhas dinâmicas (NF + volume, geradas via innerHTML)
// que o mock antigo de elemento (sem querySelector) não suportava.
const SHELL = `<!doctype html><html><body>
<div id="rec-lista-andamento"></div>
<div id="rec-lista-titulo"></div>
<input id="rec-scan-input">
<div id="rec-scan-status"></div>
<div id="rec-nf-titulo"></div>
<div id="rec-nf-subtitulo"></div>
<div id="rec-obs-bloco"></div>
<div id="rec-nf-lista"></div>
<div id="rec-nf-status"></div>
<button id="rec-nf-btn"></button>
<div id="rec-conf-icone"></div>
<div id="rec-conf-titulo"></div>
<div id="rec-conf-corpo"></div>
</body></html>`;

function loadRecebimentoOffline(colecoes, opts){
  const idb=mockRecIdb();
  const onlineState={ value: opts?.online !== false };
  const cacheLocal={ rec: opts?.recCacheInicial||[], ident: opts?.identCacheInicial||[] };
  const lojaId=opts?.lojaId||'loja1';
  const dom=new JSDOM(SHELL,{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window;
  const document=win.document;
  const els=new Proxy({},{ get:(_,id)=>document.getElementById(id) });

  win.FS={ collection:(nome)=>colecoes?.[nome]||mockColecao([]) };
  win.APP={ operador:{ email:'operador@daterrinha.com' } };
  win.goScreen=()=>{};
  win.toast=()=>{};
  win.obterDeviceId=()=>'dt_teste123';
  win.getDTLojaAtiva=()=>lojaId;
  win.getDTRawFirestore=()=>({
    collection:(nome)=>{
      if (nome!=='lojas') return mockColecao([]);
      return { doc:(id)=>({ collection:(sub)=> (opts?.lojasParceiras?.[id]?.[sub]) || mockColecao([]) }) };
    },
  });
  win.recIdbPut=idb.recIdbPut; win.recIdbDelete=idb.recIdbDelete;
  win.recIdbGetPendentes=idb.recIdbGetPendentes; win.recIdbGetAll=idb.recIdbGetAll;
  win.recCacheLoad=()=>cacheLocal.rec; win.recCacheSave=(l)=>{ cacheLocal.rec=l; };
  win.recIdentCacheLoad=()=>cacheLocal.ident; win.recIdentCacheSave=(l)=>{ cacheLocal.ident=l; };
  Object.defineProperty(win.navigator,'onLine',{ get:()=>onlineState.value, configurable:true });
  // Um único eval (não dois) — 22 e 23 compartilham estado via `let`
  // top-level (RECEBIMENTOS_CACHE etc.). Duas chamadas SEPARADAS de
  // win.eval() criam escopos de script distintos pro motor do V8 (ao
  // contrário de duas tags <script> reais na mesma página, que dividem o
  // mesmo ambiente léxico global) — 23 enxergando `RECEBIMENTOS_CACHE`
  // como ReferenceError foi exatamente esse problema, descoberto ao vivo
  // rodando este arquivo.
  win.eval(recCode + '\n' + offCode);
  return { ctx:win, els, idb, onlineState, cacheLocal, document };
}

function mockColecaoComErro(){
  return { get: async()=>{ throw new Error('offline'); }, where:()=>({ get: async()=>{ throw new Error('offline'); } }), doc:()=>({ get: async()=>{ throw new Error('offline'); } }) };
}

// Preenche a NF (e, quando informado, o volume) da linha `idx`. SAÍDA exige
// volume > 0 por nota; CHEGADA não (só confere o número).
function preencherNf(document, idx, numero, volume){
  const numEl = idx===0 ? document.getElementById('rec-nf-input') : document.querySelector('[data-nf-input="'+idx+'"]');
  numEl.value = numero;
  if (volume!=null){
    const volEl = document.querySelector('[data-nf-volume="'+idx+'"]');
    if (volEl) volEl.value = String(volume);
  }
}

test('offline: bip de SAÍDA na Matriz (informar NF pela 1ª vez) também funciona sem rede — vai pra fila e sincroniza depois com o campo de NF preservado',async()=>{
  const recebimentos=mockColecao([{id:'m1',data:{tipo:'TRANSBORDO',status:'PREVISTO',motoristaNome:'Ana'}}]);
  const auditoria=mockColecao([]);
  const { ctx, els, idb, onlineState, document }=loadRecebimentoOffline({ recebimentos, recebimento_auditoria:auditoria },{online:false});
  onlineState.value=false;
  await ctx.carregarRecebimentoColetor();

  await ctx.abrirConfirmacaoParaRecebimento('m1'); // tela de NF, modo "informar" — funciona offline (não compara nada)
  assert.equal(idb._store.size,0);
  assert.match(els['rec-nf-subtitulo'].textContent,/Ana/);

  preencherNf(document,0,'NF-OFF-01',8); // saída exige volume > 0
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(idb._store.size,1);
  assert.equal(recebimentos._registro.get('m1').status,'PREVISTO'); // servidor intocado

  onlineState.value=true;
  await ctx.sincronizarFilaRecebimento();
  assert.equal(idb._store.size,0);
  const r=recebimentos._registro.get('m1');
  assert.equal(r.status,'EM_TRANSITO');
  assert.equal(r.notaFiscalTransferencia,'NF-OFF-01'); // campo extra da saída não é descartado na sincronização
  assert.equal([...auditoria._registro.values()][0].operacao,'TRANSBORDO_SAIU');
});

test('offline: bip de chegada exige conferência de NF (funciona sem rede) e só então vai pra fila, sem gravar no servidor',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'321'}}]);
  const { ctx, els, idb, onlineState, document }=loadRecebimentoOffline({ recebimentos, recebimento_auditoria:mockColecao([]) },{online:false});
  onlineState.value=false;
  await ctx.carregarRecebimentoColetor(); // popula RECEBIMENTOS_CACHE mesmo com FS "acessível" (só não tenta sync por estar offline)

  await ctx.abrirConfirmacaoParaRecebimento('r1'); // vai pra tela de NF — conferência é local, funciona offline
  assert.equal(idb._store.size,0); // nada na fila ainda, falta confirmar a NF
  assert.match(els['rec-nf-subtitulo'].textContent,/321/);

  preencherNf(document,0,'321');
  await ctx.confirmarNotaFiscalRecebimento();

  assert.equal(idb._store.size,1);
  const bip=[...idb._store.values()][0];
  assert.equal(bip.recebimentoId,'r1');
  assert.equal(bip.operacao,'CHEGADA_REGISTRADA');
  assert.equal(bip.status_sync,'pendente');
  assert.ok(bip.timestampBip);
  assert.ok(bip.mudancas.notaFiscalConfirmadaEm); // confirmação da NF viaja junto no bip enfileirado
  assert.equal(recebimentos._registro.get('r1').status,'EM_TRANSITO'); // servidor intocado
  assert.match(els['rec-conf-titulo'].textContent,/offline/i);

  // reflexo otimista local: bipar de novo (ainda offline) já enxerga CHEGOU
  // e enfileira o PRÓXIMO passo (início de descarga), não outra chegada —
  // esse passo não pede NF de novo, só a chegada pede.
  await ctx.abrirConfirmacaoParaRecebimento('r1');
  assert.equal(idb._store.size,2);
  const bip2=[...idb._store.values()].find(b=>b.uuid!==bip.uuid);
  assert.equal(bip2.operacao,'DESCARGA_INICIADA');
});

test('sincronização: aplica o bip pendente quando a guarda ainda bate no servidor, grava auditoria e limpa a fila (incluindo a confirmação de NF, não só status/hora)',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'321'}}]);
  const auditoria=mockColecao([]);
  const { ctx, idb, onlineState, document }=loadRecebimentoOffline({ recebimentos, recebimento_auditoria:auditoria },{online:false});
  onlineState.value=false;
  await ctx.carregarRecebimentoColetor();
  await ctx.abrirConfirmacaoParaRecebimento('r1'); // enfileira offline
  preencherNf(document,0,'321');
  await ctx.confirmarNotaFiscalRecebimento();
  const bipOriginal=[...idb._store.values()][0];

  onlineState.value=true;
  await ctx.sincronizarFilaRecebimento();

  assert.equal(idb._store.size,0); // fila limpa
  const r=recebimentos._registro.get('r1');
  assert.equal(r.status,'CHEGOU');
  assert.equal(r.horaChegada,bipOriginal.timestampBip); // preserva o timestamp ORIGINAL do bip, não o da sincronização
  assert.ok(r.notaFiscalConfirmadaEm); // campo extra do bip (NF) não é descartado na sincronização
  assert.equal(auditoria._registro.size,1);
  assert.equal([...auditoria._registro.values()][0].operacao,'CHEGADA_REGISTRADA');
});

test('conflito: se a carga já avançou pra outro estado no servidor enquanto offline, marca conflito em vez de gravar por cima',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'321'}}]);
  const { ctx, idb, onlineState, document }=loadRecebimentoOffline({ recebimentos, recebimento_auditoria:mockColecao([]) },{online:false});
  onlineState.value=false;
  await ctx.carregarRecebimentoColetor();
  await ctx.abrirConfirmacaoParaRecebimento('r1');
  preencherNf(document,0,'321');
  await ctx.confirmarNotaFiscalRecebimento(); // enfileira bip de CHEGADA (espera sair de EM_TRANSITO)

  // Enquanto offline, o Analista (ou outro aparelho) já fez a carga avançar bem além
  recebimentos._registro.set('r1',{ tipo:'TRANSBORDO', status:'EM_DESCARGA' });

  onlineState.value=true;
  await ctx.sincronizarFilaRecebimento();

  assert.equal(idb._store.size,1); // continua na fila, não foi descartado
  const bip=[...idb._store.values()][0];
  assert.equal(bip.status_sync,'conflito');
  assert.match(bip.motivoConflito,/Em descarga/i);
  assert.equal(recebimentos._registro.get('r1').status,'EM_DESCARGA'); // servidor não foi corrompido
});

test('idempotência: se o bip já tinha sido aplicado numa sincronização anterior (status do servidor já é o alvo), só limpa a fila sem duplicar nada',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'CHEGOU'}}]); // já é o alvo do bip abaixo
  const auditoria=mockColecao([]);
  const { ctx, idb, onlineState }=loadRecebimentoOffline({ recebimentos, recebimento_auditoria:auditoria });
  await idb.recIdbPut({ uuid:'u1', recebimentoId:'r1', operacao:'CHEGADA_REGISTRADA', mudancas:{status:'CHEGOU',horaChegada:'2026-08-12T10:00:00.000Z'}, timestampBip:'2026-08-12T10:00:00.000Z', status_sync:'pendente', criado_em:'2026-08-12T10:00:00.000Z' });

  onlineState.value=true;
  await ctx.sincronizarFilaRecebimento();

  assert.equal(idb._store.size,0);
  assert.equal(auditoria._registro.size,0); // não reescreve auditoria pra algo que já estava sincronizado
});

test('ordem cronológica: dois bips da mesma carga enfileirados offline são aplicados na ordem em que foram bipados, não na ordem de leitura do IDB',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'321'}}]);
  const auditoria=mockColecao([]);
  const { ctx, idb, onlineState, document }=loadRecebimentoOffline({ recebimentos, recebimento_auditoria:auditoria },{online:false});
  onlineState.value=false;
  await ctx.carregarRecebimentoColetor();

  await ctx.abrirConfirmacaoParaRecebimento('r1'); // tela de NF
  preencherNf(document,0,'321');
  await ctx.confirmarNotaFiscalRecebimento(); // bip 1: chegada (EM_TRANSITO -> CHEGOU)
  await ctx.abrirConfirmacaoParaRecebimento('r1'); // bip 2: início descarga (CHEGOU -> EM_DESCARGA), sobre o cache já otimista
  assert.equal(idb._store.size,2);

  // Embaralha a ordem de armazenamento pra simular leitura não-cronológica do IDB
  const invertido=[...idb._store.entries()].reverse();
  idb._store.clear();
  invertido.forEach(([k,v])=>idb._store.set(k,v));

  onlineState.value=true;
  await ctx.sincronizarFilaRecebimento();

  assert.equal(idb._store.size,0);
  assert.equal(recebimentos._registro.get('r1').status,'EM_DESCARGA');
  const operacoes=[...auditoria._registro.values()].map(x=>x.operacao);
  assert.deepEqual(operacoes,['CHEGADA_REGISTRADA','DESCARGA_INICIADA']);
});

test('reload offline: se a busca ao Firestore falha, o hub cai pro espelho local da última carga bem-sucedida',async()=>{
  const identCache=[{ _id:'i1', codigo:'TRB-OFF', recebimentoId:'r1' }];
  const recCache=[{ _id:'r1', tipo:'TRANSBORDO', status:'EM_TRANSITO', identificadorCodigo:'TRB-OFF', notaFiscalTransferencia:'321' }];
  const { ctx, els, document }=loadRecebimentoOffline(
    { recebimentos: mockColecaoComErro(), recebimento_identificadores: mockColecaoComErro() },
    { online:false, recCacheInicial:recCache, identCacheInicial:identCache }
  );
  await ctx.carregarRecebimentoColetor();
  assert.match(els['rec-lista-andamento'].innerHTML,/TRB-OFF/);

  // e o scan por código também funciona nesse estado, sem chamada de rede —
  // chega até a conferência de NF (que também é 100% local) e enfileira
  els['rec-scan-input'].value='trb-off';
  await ctx.confirmarCodigoRecebimento();
  assert.match(els['rec-nf-subtitulo'].textContent,/321/);
  preencherNf(document,0,'321');
  await ctx.confirmarNotaFiscalRecebimento();
  assert.match(els['rec-conf-titulo'].textContent,/offline/i);
});

test('REGRESSÃO/FASE 4d: bip offline de uma carga que pertence à loja PARCEIRA (Matriz) sincroniza escrevendo no doc da Matriz, não cria/altera nada na coleção local da Filial',async()=>{
  const recebimentosMatriz=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'321'}}]);
  const auditoriaMatriz=mockColecao([]);
  const recebimentosFilial=mockColecao([]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const { ctx, els, idb, onlineState, document }=loadRecebimentoOffline(
    { recebimentos:recebimentosFilial, recebimento_auditoria:mockColecao([]), recebimento_rotas_transbordo:rotas },
    { online:true, lojaId:'loja_filial', lojasParceiras:{ loja_matriz:{ recebimentos:recebimentosMatriz, recebimento_auditoria:auditoriaMatriz } } }
  );
  // Cenário real: chegou o turno com internet, o hub já cruzou com a Matriz
  // e trouxe a carga (tagueada com _lojaId da Matriz) — só DEPOIS a conexão
  // cai, no meio de bipar a chegada.
  await ctx.carregarRecebimentoColetor();
  onlineState.value=false;

  await ctx.abrirConfirmacaoParaRecebimento('t1'); // tela de NF (chegada) — offline, só confere localmente
  preencherNf(document,0,'321');
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(idb._store.size,1);
  const bip=[...idb._store.values()][0];
  assert.equal(bip.lojaId,'loja_matriz'); // fila lembra de qual loja é o dono do doc

  onlineState.value=true;
  await ctx.sincronizarFilaRecebimento();

  assert.equal(idb._store.size,0);
  assert.equal(recebimentosMatriz._registro.get('t1').status,'CHEGOU'); // escreveu no dono real
  assert.equal(auditoriaMatriz._registro.size,1);
  assert.equal(recebimentosFilial._registro.size,0); // nada foi criado/alterado na coleção local da Filial
});

test('IndexedDB: store de bips de recebimento existe na mesma base, versão do banco foi incrementada',()=>{
  assert.match(coreCode,/IDB_VERSION\s*=\s*4/);
  assert.match(coreCode,/REC_IDB_STORE\s*=\s*'recebimento_bips_pendentes'/);
  assert.match(coreCode,/db\.createObjectStore\(REC_IDB_STORE/);
});

test('roteamento: coletor.html carrega o script da fila offline logo depois do de recebimento, e tem a tela de NF',()=>{
  assert.match(htmlCode,/22-recebimento\.js[^"]*"[^>]*><\/script><script defer src="js\/coletor\/23-recebimento-offline\.js/);
  assert.match(htmlCode,/id="screen-recebimento-nf"/);
});
