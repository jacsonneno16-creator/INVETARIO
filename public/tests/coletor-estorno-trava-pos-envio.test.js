const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const estornoCode=fs.readFileSync(path.join(__dirname,'../js/coletor/10-navegacao-estorno.js'),'utf8');

// Pedido ao vivo 2026-09-29: depois que uma contagem é enviada manualmente
// pro Firebase (ver coletor-envio-manual-contagens.test.js), ela fica
// travada — o operador não pode mais estorná-la, porque o Analista já pode
// estar tratando aquele endereço. `estornarContagem(docId, isLocal)` usa o
// mesmo `isLocal`/`c._local` que a tela de Estorno já usa pra saber se o
// registro ainda está só no IDB (pendente, isLocal=true) ou já foi
// sincronizado (isLocal=false) — só o primeiro caso pode ser estornado.
function loadEstorno(overrides){
  const chamadasFS=[];
  const toasts=[];
  const context={
    console,
    FCOL:{ contagens:'dt_contagens' },
    FS:{ collection:(nome)=>({ doc:(id)=>({
      update: async payload => { chamadasFS.push({colecao:nome,id,payload}); },
    }) }) },
    APP:{ operador:{name:'Jacson'}, contagens:(overrides && overrides.contagens) || [] },
    idbGetPendentes: async()=>[],
    idbPut: async()=>{},
    toast:(msg,tipo)=>toasts.push({msg,tipo}),
    renderEstorno:()=>{},
    renderHistorico:()=>{},
    updateStats:()=>{},
    document:{ getElementById:()=>null, querySelectorAll:()=>[] },
    Date, JSON, String, Number, Array, Object, Set, Map, Promise,
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(estornoCode,context,{filename:'10-navegacao-estorno.js'});
  return {ctx:context, chamadasFS, toasts};
}

test('estornarContagem(id, false) — já enviada/sincronizada — é recusado, sem confirmar e sem tocar no Firestore',async()=>{
  const {ctx,chamadasFS,toasts}=loadEstorno({});
  await ctx.estornarContagem('doc123', false);
  assert.equal(chamadasFS.length,0);
  assert.equal(toasts.length,1);
  assert.equal(toasts[0].tipo,'e');
  assert.match(toasts[0].msg,/não pode mais ser estornada/);
});

test('estornarContagem(id, true) — ainda pendente/local — segue o fluxo normal (pede confirmação, não é bloqueado de cara)',async()=>{
  let confirmarChamado=false;
  const {ctx,chamadasFS,toasts}=loadEstorno({});
  // Sobrescreve _confirmarEstorno depois de carregado, simulando o operador
  // CANCELANDO a confirmação — isso já prova que o bloqueio "já enviada"
  // não disparou (chegou até a etapa de confirmação de verdade).
  ctx._confirmarEstorno = async () => { confirmarChamado = true; return false; };
  await ctx.estornarContagem('doc456', true);
  assert.equal(confirmarChamado,true);
  assert.equal(chamadasFS.length,0); // cancelou, então nada foi gravado
  assert.equal(toasts.length,0); // nenhum toast de bloqueio "já enviada"
});
