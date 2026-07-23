// v52 — ações estáveis do Inventário: publicar, excluir e sincronizar com coletores.
(function(global){
  'use strict';

  function state(){ return global.AnalistaStore && global.AnalistaStore.getState ? global.AnalistaStore.getState() : {}; }
  function db(){ return global.FS_AN || (global.getDTFirestore && global.getDTFirestore()) || (global.getDTRawFirestore && global.getDTRawFirestore()); }
  function coll(){ return (global.DT_FCOL && global.DT_FCOL.inventarios) || 'dt_inventarios'; }
  function toast(m,t){ if(typeof global.showToast==='function') global.showToast(m,t||'i'); else alert(m); }
  function invById(id){ return (state().inventarios||[]).find(function(i){return i.id===id;}) || null; }
  function refresh(){
    try{ global.saveAll && global.saveAll(); }catch(e){}
    try{ global.renderInvTable && global.renderInvTable(); }catch(e){}
    try{ global.renderDashboard && global.renderDashboard(); }catch(e){}
    try{ global.atualizarBadgesNav && global.atualizarBadgesNav(); }catch(e){}
    try{ global.popularSelects && global.popularSelects(); }catch(e){}
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
      try{
        var raw=db();
        if(raw && navigator.onLine){
          var ref=raw.collection(coll()).doc(id);
          // Apaga subcoleções conhecidas antes do documento principal.
          await apagarColecaoEmLotes(ref.collection('base_chunks'));
          await apagarColecaoEmLotes(ref.collection('contagens'));
          await apagarColecaoEmLotes(ref.collection('resultados'));
          await ref.delete().catch(function(e){
            // Se o documento já não existe, a exclusão local ainda deve continuar.
            if(e && e.code!=='not-found') throw e;
          });
        }
        var novo=(state().inventarios||[]).filter(function(x){return x.id!==id;});
        if(global.AnalistaState && global.AnalistaState.replaceSlice){
          global.AnalistaState.replaceSlice('inventarios',novo,{source:'excluirInventario-v52'});
        }
        // Limpa dados locais relacionados para não reaparecer no acompanhamento.
        ['contagens','divergencias','recontagens'].forEach(function(chave){
          var arr=(state()[chave]||[]).filter(function(x){return x.inventario_id!==id && x.inventarioId!==id;});
          if(global.AnalistaState && global.AnalistaState.replaceSlice) global.AnalistaState.replaceSlice(chave,arr,{source:'excluirInventario-v52'});
        });
        refresh();
        toast('🗑 Inventário excluído do Analista e do Firebase.','s');
        return true;
      }catch(e){
        console.error('[v52 excluirInventario]',e);
        toast('Não foi possível excluir: '+(e.message||e),'e');
        return false;
      }
    };
    var msg='Excluir permanentemente o inventário “'+(inv.nome||inv.codigo||id)+'”? Esta ação remove também a base publicada no Firebase.';
    if(typeof global.showConfirm==='function'){
      global.showConfirm(msg,executar,{title:'Excluir inventário',icon:'🗑️',okLabel:'Excluir',okClass:'btn-danger'});
      return true;
    }
    if(confirm(msg)) return executar();
    return false;
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
