(function(global){
  'use strict';

  function requireEngine(){
    const engine=global.InventoryAddressState;
    if(!engine) throw new Error('InventoryAddressState nao carregado');
    return engine;
  }

  function assignment(snapshot){
    const recount=(snapshot.recontagens||[]).find(r=>r.operador||r.operador_responsavel);
    const divergence=(snapshot.divergencias||[]).find(d=>d.operador_responsavel||d.operador);
    return String(recount?.operador||recount?.operador_responsavel||divergence?.operador_responsavel||divergence?.operador||'');
  }

  function executor(snapshot){
    return [...new Set((snapshot.rodadas||[]).slice(1).filter(Boolean).flatMap(r=>r.operadores||[]))].join(', ');
  }

  function sourceRecord(snapshot){
    return snapshot.contagens?.[0]||snapshot.divergencias?.[0]||snapshot.recontagens?.[0]||null;
  }

  function toRow(snapshot){
    const rounds=snapshot.rodadas||[];
    const row=Object.assign({},snapshot,{
      key:snapshot.chave,
      inventoryId:snapshot.inventario_id,
      inventory:snapshot.inventario,
      address:snapshot.endereco,
      expectedItems:snapshot.itens_esperados,
      expectedTotal:snapshot.esperado,
      firstRound:rounds[0]||null,
      secondRound:rounds[1]||null,
      thirdRound:rounds[2]||null,
      firstTotal:snapshot.primeira,
      secondTotal:snapshot.segunda,
      thirdTotal:snapshot.terceira,
      latestRound:snapshot.ultimaRodada,
      status:snapshot.status,
      recountStatus:snapshot.status_recontagem,
      evaluation:snapshot.avaliacao,
      updatedAt:snapshot.atualizado_em,
      assignedTo:assignment(snapshot),
      executedBy:executor(snapshot),
      sourceRecord:sourceRecord(snapshot),
      counts:snapshot.contagens,
      divergences:snapshot.divergencias,
      recounts:snapshot.recontagens,
      snapshot
    });
    return Object.freeze(row);
  }

  function list(state){
    return Object.freeze(requireEngine().list(state).map(toRow));
  }

  function byKey(state,key){
    return list(state).find(row=>row.key===key)||null;
  }

  const columnContract=Object.freeze({
    CONTAGEM:Object.freeze({
      updatedAt:'updatedAt',operators:'latestRound.operadores',inventory:'inventory',address:'address',
      expectedProducts:'expectedItems',expectedTotal:'expectedTotal',first:'firstTotal',second:'secondTotal',third:'thirdTotal',
      latestStep:'latestRound.numero',status:'status',actionRecord:'sourceRecord'
    }),
    RECONTAGEM:Object.freeze({
      inventory:'inventory',address:'address',expectedProducts:'expectedItems',expectedTotal:'expectedTotal',
      first:'firstRound',second:'secondRound',third:'thirdRound',assignedTo:'assignedTo',executedBy:'executedBy',status:'status'
    })
  });

  global.InventoryAddressSelectors=Object.freeze({list,byKey,toRow,columnContract});
})(window);
