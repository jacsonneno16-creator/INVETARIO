const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const syncCode=fs.readFileSync(path.join(__dirname,'../js/coletor/02-sync-dispositivo.js'),'utf8');

// Pedido ao vivo 2026-09-29: o envio das contagens físicas de Inventário
// pro Firebase deixou de ser automático (intervalo de 30s, reconexão, boot,
// login, logo após salvar) e passou a exigir uma ação manual do operador
// (botão "Enviar Contagens" na aba Status, ver 15-utils-init.js) — antes
// disso o operador pode continuar corrigindo/estornando à vontade, porque
// nada chegou ainda pro Analista. `enviarFilaPendente(origem)` só executa
// de fato quando `origem==='manual'`; qualquer outro valor (inclusive
// nenhum argumento, como todos os gatilhos automáticos já existentes
// continuam chamando) vira no-op. `encerrarTurnoColetor()` nunca envia
// sozinho — só bloqueia e leva o operador pra aba Status.
function loadSync(overrides){
  const chamadasFS=[];
  const idbDeletados=[];
  const idbPuts=[];
  const toasts=[];
  const telas=[];
  let pendentesIdb=(overrides && overrides.pendentes) || [];
  const statusLedgerMarcacoes=[];

  function mockDoc(colecao,id){
    return {
      set: async payload => { chamadasFS.push({colecao,id,op:'set',payload}); },
      update: async payload => { chamadasFS.push({colecao,id,op:'update',payload}); },
    };
  }
  const context={
    console,
    firebase:{ firestore:{ FieldValue:{ serverTimestamp:()=>'SERVER_TS', increment:n=>({__increment:n}) } } },
    FCOL:{ contagens:'dt_contagens', coletores:'dt_coletores' },
    FS:{ collection:(nome)=>({ doc:(id)=>mockDoc(nome,id) }) },
    APP:{ inventario:(overrides && overrides.inventario) || {status:'ATIVO', id:'inv1'}, recontagens:[], contagens:[] },
    idbGetPendentes: async()=>pendentesIdb,
    idbPut: async(reg)=>{ idbPuts.push(reg); },
    idbDelete: async(uuid)=>{ idbDeletados.push(uuid); pendentesIdb=pendentesIdb.filter(c=>c.uuid!==uuid); },
    toast:(msg,tipo)=>toasts.push({msg,tipo}),
    showConfirm:(msg,onOk)=>{ /* não invoca automaticamente — testes de bloqueio não devem chegar aqui */ },
    showView:(id,el)=>telas.push(id),
    obterDeviceId:()=>'dt_teste123',
    ST:()=>'FIRESTORE_TS',
    atualizarBarraStatus:()=>{},
    updateStats:()=>{},
    filaSave:()=>{},
    dbg:()=>{},
    document:{ getElementById:()=>null },
    localStorage:{ getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
    sessionStorage:{ getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
    navigator:{ onLine: !(overrides && overrides.offline) },
    screen:{ width:100, height:100, colorDepth:24 },
    Intl, Date, Math, JSON, String, Number, Array, Object, Set, Map, Promise,
  };
  context.window=context;
  context.window.DTStatusLedger={ mark:(...args)=>statusLedgerMarcacoes.push(args) };
  vm.createContext(context);
  vm.runInContext(syncCode,context,{filename:'02-sync-dispositivo.js'});
  return {ctx:context, chamadasFS, idbDeletados, idbPuts, toasts, telas, statusLedgerMarcacoes, getPendentes:()=>pendentesIdb};
}

const CONTAGEM_PENDENTE=()=>({ uuid:'c1', endereco:'14.1.1.1.1.1', produto:'123', quantidade:10, dataHora:new Date().toISOString() });

test('enviarFilaPendente() sem origem (gatilho automático) não envia nada e não marca ENVIADO',async()=>{
  const {ctx,chamadasFS,idbDeletados,statusLedgerMarcacoes,getPendentes}=loadSync({pendentes:[CONTAGEM_PENDENTE()]});
  await ctx.enviarFilaPendente();
  assert.equal(chamadasFS.length,0);
  assert.equal(idbDeletados.length,0);
  assert.equal(statusLedgerMarcacoes.length,0);
  assert.equal(getPendentes().length,1); // continua pendente no aparelho
});

test('enviarFilaPendente("automatico")/qualquer origem diferente de "manual" também é no-op',async()=>{
  const {ctx,chamadasFS}=loadSync({pendentes:[CONTAGEM_PENDENTE()]});
  await ctx.enviarFilaPendente('automatico');
  await ctx.enviarFilaPendente('online');
  assert.equal(chamadasFS.length,0);
});

test('enviarFilaPendente("manual") envia de verdade: grava no Firestore, remove do IDB e marca ENVIADO',async()=>{
  const {ctx,chamadasFS,idbDeletados,statusLedgerMarcacoes,getPendentes}=loadSync({pendentes:[CONTAGEM_PENDENTE()]});
  await ctx.enviarFilaPendente('manual');
  // Além de gravar a própria contagem em dt_contagens, um envio bem
  // sucedido também atualiza o resumo do coletor (contagens_enviadas etc.)
  // — checa especificamente a gravação da contagem, não a contagem total
  // de chamadas ao Firestore.
  const gravacaoContagem = chamadasFS.find(c => c.colecao === 'dt_contagens');
  assert.ok(gravacaoContagem, 'esperava uma gravação em dt_contagens');
  assert.equal(gravacaoContagem.id,'c1');
  assert.equal(gravacaoContagem.payload.status_sync,'sincronizado');
  assert.deepEqual(idbDeletados,['c1']);
  assert.equal(statusLedgerMarcacoes.length,1);
  assert.equal(statusLedgerMarcacoes[0][3],'ENVIADO');
  assert.equal(getPendentes().length,0);
});

test('encerrarTurnoColetor() com contagens pendentes bloqueia, leva pra aba Status e NUNCA tenta enviar sozinho',async()=>{
  const {ctx,chamadasFS,toasts,telas}=loadSync({pendentes:[CONTAGEM_PENDENTE()]});
  await ctx.encerrarTurnoColetor();
  assert.equal(chamadasFS.length,0); // nem tentou mandar a fila, nem fechou o turno no Firestore
  assert.deepEqual(telas,['status']);
  assert.equal(toasts.length,1);
  assert.match(toasts[0].msg,/Enviar Contagens/);
  assert.equal(ctx.APP.turnoEncerrado,undefined);
});

test('encerrarTurnoColetor() sem nada pendente segue o fluxo normal (não bloqueia por causa da fila)',async()=>{
  const {ctx,telas}=loadSync({pendentes:[]});
  await ctx.encerrarTurnoColetor();
  // Sem pendências, o bloqueio da fila não deve disparar — se seguiu adiante,
  // não redirecionou pra Status por causa dela.
  assert.equal(telas.includes('status'),false);
});

// Pedido ao vivo 2026-09-29 (mesma conversa): a faixa azul "Sincronizando N
// contagem(ns) com Firebase..." no topo da tela de contar ficou enganosa
// desde que o envio virou manual — nada é enviado sozinho, então essa faixa
// nunca deveria aparecer nesse estado. A informação de pendências já mora no
// pill compacto do topo (conn-pill) e em detalhe na aba Status.
test('atualizarBarraStatus() nunca mostra a faixa grande de "sincronizando" — o pill do topo continua funcionando normalmente',()=>{
  const cache = require('fs').readFileSync(require('path').join(__dirname,'../js/coletor/01-core-firebase-cache.js'),'utf8');
  const corpo = cache.slice(cache.indexOf('function atualizarBarraStatus('), cache.indexOf('function atualizarBarraStatus(')+2000);
  assert.match(corpo,/if \(bar\) bar\.style\.display = 'none';/);
  assert.doesNotMatch(corpo,/Sincronizando \$\{pending\}/);
  // O pill compacto do header continua sendo atualizado normalmente.
  assert.match(corpo,/pill\.style\.background/);
});
