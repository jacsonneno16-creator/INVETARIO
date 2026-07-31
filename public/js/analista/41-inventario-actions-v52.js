// v52 — ações estáveis do Inventário: publicar, excluir e sincronizar com coletores.
(function(global){
  'use strict';

  function state(){ return global.AnalistaStore && global.AnalistaStore.getState ? global.AnalistaStore.getState() : {}; }
  function db(){ return global.FS_AN || (global.getDTFirestore && global.getDTFirestore()) || (global.getDTRawFirestore && global.getDTRawFirestore()); }
  function coll(){ return (global.DT_FCOL && global.DT_FCOL.inventarios) || 'dt_inventarios'; }
  function toast(m,t){ if(typeof global.showToast==='function') global.showToast(m,t||'i'); else alert(m); }
  function invById(id){ return (state().inventarios||[]).find(function(i){return i.id===id;}) || null; }
  function refresh(){
    try{ global.saveAll && global.saveAll(); }catch(e){ console.warn("[Erro tratado]", e); }
    try{ global.renderInvTable && global.renderInvTable(); }catch(e){ console.warn("[Erro tratado]", e); }
    try{ global.renderDashboard && global.renderDashboard(); }catch(e){ console.warn("[Erro tratado]", e); }
    try{ global.atualizarBadgesNav && global.atualizarBadgesNav(); }catch(e){ console.warn("[Erro tratado]", e); }
    try{ global.popularSelects && global.popularSelects(); }catch(e){ console.warn("[Erro tratado]", e); }
  }
  async function apagarColecaoEmLotes(ref){
    var snap=await ref.get().catch(function(){return null;});
    if(!snap || snap.empty) return 0;
    var docs=snap.docs||[], total=0, raw=db();
    for(var i=0;i<docs.length;i+=400){
      var batch=raw.batch();
      docs.slice(i,i+400).forEach(function(d){batch.delete(d.ref);});
      await batch.commit(); total+=Math.min(400,docs.length-i);
    }
    return total;
  }

  function aliasesInventario(inv){
    return [inv&&inv.id,inv&&inv.codigo,inv&&inv.nome,inv&&inv.inventario_id,inv&&inv.inventarioId]
      .filter(function(v){return v!=null&&String(v).trim();}).map(function(v){return String(v).trim();});
  }

  async function apagarDocumentosRelacionados(inv){
    var raw=db(), aliases=aliasesInventario(inv), refs=new Map();
    var colecoes=['dt_contagens','dt_vazios','dt_divergencias','dt_recontagens'];
    var campos=['inventario_id','inventarioId'];
    var consultas=[];
    colecoes.forEach(function(nome){campos.forEach(function(campo){aliases.forEach(function(alias){
      consultas.push(raw.collection(nome).where(campo,'==',alias).get().then(function(s){
        (s.docs||[]).forEach(function(d){refs.set(d.ref.path,d.ref);});
      }).catch(function(e){console.warn('[Excluir inventário] consulta',nome,campo,alias,e.message);}));
    });});});
    await Promise.all(consultas);
    var lista=Array.from(refs.values());
    for(var i=0;i<lista.length;i+=400){
      var b=raw.batch();lista.slice(i,i+400).forEach(function(r){b.delete(r);});await b.commit();
    }
    return lista.length;
  }

  async function republicarBaseInventario(id){
    var inv=invById(id);
    if(!inv){ toast('Inventário não encontrado. Atualize a página e tente novamente.','e'); return false; }
    if(!navigator.onLine){ toast('Sem internet. Conecte-se para publicar a base.','w'); return false; }
    if(!Array.isArray(inv.base) || !inv.base.length){ toast('Este inventário não possui base carregada. Use “Reimportar Base”.','w'); return false; }
    try{
      toast('Publicando inventário e base no Firebase…','i');
      inv.status = String(inv.status||'ATIVO').toUpperCase()==='FECHADO' ? 'FECHADO' : (String(inv.status||'ATIVO').toUpperCase()==='PAUSADO'?'PAUSADO':'ATIVO');
      inv.oculto_coletor = false;
      inv.publicado_em = new Date().toISOString();
      inv.total_registros = inv.base.length;
      await global.fsPublicarInventario(inv);
      // Confirma o documento que o coletor consulta.
      await db().collection(coll()).doc(inv.id).set({
        id:inv.id,
        nome:inv.nome||inv.codigo||inv.id,
        codigo:inv.codigo||inv.id,
        status:inv.status,
        oculto_coletor:false,
        total_registros:inv.total_registros,
        total_enderecos:inv.total_enderecos||0,
        loja_principal:inv.loja_principal||'',
        lojas_espelho:inv.lojas_espelho||[],
        data_inicio:inv.data_inicio||'',
        publicado_em:new Date(),
        base_chunks:Math.ceil(inv.base.length/1000),
        base_chunk_size:1000
      },{merge:true});
      refresh();
      toast('✅ Base publicada. O inventário já está disponível para os coletores.','s');
      return true;
    }catch(e){
      console.error('[v52 republicarBaseInventario]',e);
      toast('Falha ao publicar no Firebase: '+(e.message||e),'e');
      return false;
    }
  }

  async function excluirInventario(id){
    var inv=invById(id);
    if(!inv){ toast('Inventário não encontrado.','e'); return false; }
    var executar=async function(){
      var stAntes=state();
      try{
        // Remove imediatamente da interface. A limpeza remota continua em seguida,
        // evitando que a tela pareça travada em bases grandes.
        var aliases=aliasesInventario(inv);
        var novo=(stAntes.inventarios||[]).filter(function(x){return String(x.id)!==String(id);});
        if(global.AnalistaState&&global.AnalistaState.replaceSlice)global.AnalistaState.replaceSlice('inventarios',novo,{source:'excluirInventario-v80'});
        ['contagens','vazios','divergencias','recontagens'].forEach(function(chave){
          var arr=(state()[chave]||[]).filter(function(x){
            var xids=[x.inventario_id,x.inventarioId,x.inventario,x.inv_id].filter(function(v){return v!=null;}).map(String);
            return !xids.some(function(v){return aliases.includes(v);});
          });
          if(global.AnalistaState&&global.AnalistaState.replaceSlice)global.AnalistaState.replaceSlice(chave,arr,{source:'excluirInventario-v80'});
        });
        refresh();toast('Arquivando inventário…','i');
        var raw=db();
        if(raw&&navigator.onLine){
          var ref=raw.collection(coll()).doc(id);
          await raw.runTransaction(async function(transaction){
            var snapshot=await transaction.get(ref);
            if(!snapshot.exists) throw new Error('Inventário não encontrado no servidor.');
            var remoto=snapshot.data()||{}, versao=Number(remoto.versao||0);
            transaction.update(ref,{
              status:'ARQUIVADO',
              oculto_coletor:true,
              excluido_logicamente:true,
              arquivado_em:firebase.firestore.FieldValue.serverTimestamp(),
              arquivado_por:global._currentAnalistaUser?.uid||global._currentAnalistaUser?.email||'',
              versao:versao+1
            });
          });
        }
        try{global.AnalistaFirebaseService&&global.AnalistaFirebaseService.restart&&await global.AnalistaFirebaseService.restart();}catch(_e){ console.warn("[Erro tratado]", _e); }
        refresh();toast('📦 Inventário arquivado. O histórico foi preservado.','s');
        return true;
      }catch(e){
        console.error('[v80 excluirInventario]',e);
        // Recarrega do Firebase para restaurar a verdade do servidor se algo falhar.
        try{global.AnalistaFirebaseService&&global.AnalistaFirebaseService.restart&&await global.AnalistaFirebaseService.restart();}catch(_e){ console.warn("[Erro tratado]", _e); }
        toast('Não foi possível concluir a exclusão: '+(e.message||e),'e');
        return false;
      }
    };
    var msg='Arquivar o inventário “'+(inv.nome||inv.codigo||id)+'”? Ele sairá da operação, mas o histórico continuará disponível para auditoria e recuperação.';
    if(typeof global.showConfirm==='function'){
      global.showConfirm(msg,executar,{title:'Arquivar inventário',icon:'📦',okLabel:'Arquivar',okClass:'btn-danger'});return true;
    }
    if(confirm(msg))return executar();return false;
  }

  // Corrige a visibilidade usando a coleção certa (FS_COL antigo podia não existir).
  global.toggleInvVisibilidade = async function(id){
    var inv=invById(id); if(!inv) return;
    inv.oculto_coletor=!inv.oculto_coletor;
    try{
      if(db() && navigator.onLine) await db().collection(coll()).doc(id).set({oculto_coletor:inv.oculto_coletor},{merge:true});
      refresh();
      toast(inv.oculto_coletor?'🙈 Inventário ocultado nos coletores':'👁 Inventário visível nos coletores',inv.oculto_coletor?'w':'s');
    }catch(e){ inv.oculto_coletor=!inv.oculto_coletor; refresh(); toast('Falha ao alterar visibilidade: '+(e.message||e),'e'); }
  };

  global.republicarBaseInventario=republicarBaseInventario;
  global.excluirInventario=excluirInventario;
})(window);
