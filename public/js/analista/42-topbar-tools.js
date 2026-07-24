(function(global){
  'use strict';
  function toast(msg,type){ if(typeof global.showToast==='function') global.showToast(msg,type||'i'); else alert(msg); }
  function db(){ return global.FS_AN || (global.getDTFirestore && global.getDTFirestore()); }
  function state(){ return global.AnalistaStore && global.AnalistaStore.getState ? global.AnalistaStore.getState() : {}; }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function arr(v){ return Array.isArray(v)?v:[]; }

  async function verificarBase(metaColecao, chunksColecao, campoTotal){
    var fs=db();
    if(!fs) return {ok:false,resumo:'Firebase indisponível'};
    try{
      var metaSnap=await fs.collection(metaColecao).doc('versao').get();
      if(!metaSnap.exists) return {ok:false,resumo:'Metadado ausente'};
      var meta=metaSnap.data()||{};
      var versao=String(meta.versao||'');
      var esperado=Number(meta[campoTotal]||meta.total||0);
      var esperadoChunks=Number(meta.totalChunks||meta.chunks||0);
      if(!versao) return {ok:false,resumo:'Versão ausente no metadado'};
      var snap=await fs.collection(chunksColecao).where('versao','==',versao).get();
      var total=0, maior=0;
      (snap.docs||[]).forEach(function(doc){
        var d=doc.data()||{};
        var itens=arr(d.dados).length?d.dados:arr(d.itens).length?d.itens:arr(d.produtos);
        total+=itens.length; if(itens.length>maior) maior=itens.length;
      });
      var ok=total===esperado && snap.size===esperadoChunks && maior<=1000;
      return {ok:ok,versao:versao,total:total,esperado:esperado,chunks:snap.size,esperadoChunks:esperadoChunks,maior:maior,
        resumo: total+' / '+esperado+' registros · '+snap.size+' / '+esperadoChunks+' chunks · maior chunk '+maior};
    }catch(e){ return {ok:false,resumo:'Erro: '+(e.message||e)}; }
  }

  async function diagnosticarSync(){
    try{
      var user=(global.AUTH_AN&&global.AUTH_AN.currentUser)||global._currentAnalistaUser||null;
      var loja=global.getDTLojaAtiva?global.getDTLojaAtiva():'';
      var st=state();
      var endLocal=arr(st.enderecosLista).length;
      var prodLocal=(global.DTProdutos&&global.DTProdutos.cache&&arr(global.DTProdutos.cache.lista).length)||0;
      var bases=await Promise.all([
        verificarBase('dt_locais_meta','dt_locais_chunks','total'),
        verificarBase('dt_produtos_meta','dt_produtos_chunks','totalProdutos')
      ]);
      var linhas=[
        ['Internet',navigator.onLine?'Online':'Offline',navigator.onLine],
        ['Usuário',user&&user.email?user.email:'Não autenticado',!!user],
        ['Loja ativa',loja||'Não selecionada',!!loja],
        ['Endereços na tela/local',String(endLocal),true],
        ['Endereços publicados',bases[0].resumo,bases[0].ok],
        ['Produtos na tela/cache',String(prodLocal),true],
        ['Produtos publicados',bases[1].resumo,bases[1].ok],
        ['Limite por chunk','Máximo 1.000 registros',bases[0].maior<=1000&&bases[1].maior<=1000],
        ['Criar auditoria',typeof global.criarNovaAuditoriaStandalone==='function'?'Função disponível':'Função ausente',typeof global.criarNovaAuditoriaStandalone==='function']
      ];
      var modal=document.getElementById('modal-diagnostico-sync-v90'); if(modal) modal.remove();
      modal=document.createElement('div'); modal.id='modal-diagnostico-sync-v90'; modal.className='modal-bg open';
      modal.innerHTML='<div class="modal" style="max-width:760px"><div class="modal-hdr"><div><div class="modal-title">🔍 Diagnóstico de sincronização</div><div class="sec-sub">Compara a base da tela com a versão ativa em chunks no Firebase</div></div><button class="modal-close" data-fechar>✕</button></div><div style="max-height:60vh;overflow:auto"><table style="width:100%"><thead><tr><th>Verificação</th><th>Resultado</th><th>Status</th></tr></thead><tbody>'+linhas.map(function(x){return '<tr><td>'+esc(x[0])+'</td><td>'+esc(x[1])+'</td><td>'+(x[2]?'✅':'⚠️')+'</td></tr>';}).join('')+'</tbody></table></div><div class="modal-actions"><button class="btn btn-ghost" data-fechar>Fechar</button><button class="btn btn-primary" id="diag-v90-sync">🔥 Sincronizar e verificar</button></div></div>';
      document.body.appendChild(modal);
      modal.querySelectorAll('[data-fechar]').forEach(function(b){b.onclick=function(){modal.remove();};});
      modal.onclick=function(e){if(e.target===modal)modal.remove();};
      modal.querySelector('#diag-v90-sync').onclick=async function(){modal.remove();await republicarTodosFirebase();};
    }catch(e){ console.error('[DIAGNOSTICO]',e); toast('Falha no diagnóstico: '+(e.message||e),'e'); }
  }

  async function republicarTodosFirebase(){
    if(!navigator.onLine) return toast('Sem internet. Conecte-se para sincronizar.','w');
    var btn=document.getElementById('btn-sync-firebase'); var original=btn&&btn.innerHTML;
    if(btn){btn.disabled=true;btn.innerHTML='⏳ Sincronizando...';}
    try{
      var st=state(), inventarios=arr(st.inventarios), publicados=0;
      for(var i=0;i<inventarios.length;i++){
        var inv=inventarios[i];
        if(inv&&inv.id&&typeof global.fsPublicarInventario==='function'){await global.fsPublicarInventario(inv);publicados++;}
      }
      var endResultado=null;
      if(typeof global.fsPublicarEnderecos==='function') endResultado=await global.fsPublicarEnderecos();
      if(typeof global.publicarChunksProdutos==='function') await global.publicarChunksProdutos();
      var checks=await Promise.all([
        verificarBase('dt_locais_meta','dt_locais_chunks','total'),
        verificarBase('dt_produtos_meta','dt_produtos_chunks','totalProdutos')
      ]);
      if(!checks[0].ok) throw new Error('Endereços não foram confirmados: '+checks[0].resumo);
      if(!checks[1].ok) throw new Error('Produtos não foram confirmados: '+checks[1].resumo);
      if(global.AnalistaFirebaseService&&global.AnalistaFirebaseService.stop) await global.AnalistaFirebaseService.stop();
      if(global.AnalistaFirebaseService&&global.AnalistaFirebaseService.start) await global.AnalistaFirebaseService.start();
      toast('Sync confirmado: '+checks[0].total+' endereços em '+checks[0].chunks+' chunks; '+checks[1].total+' produtos em '+checks[1].chunks+' chunks. '+publicados+' inventário(s) republicado(s).','s');
      return {enderecos:endResultado,produtos:checks[1],inventarios:publicados};
    }catch(e){ console.error('[SYNC FIREBASE]',e); toast('Falha na sincronização: '+(e.message||e),'e'); }
    finally{if(btn){btn.disabled=false;btn.innerHTML=original||'🔥 Sync Firebase';}}
  }
  global.diagnosticarSync=diagnosticarSync;
  global.republicarTodosFirebase=republicarTodosFirebase;
})(window);
