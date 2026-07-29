(function(global){
  'use strict';

  function toast(msg,type){
    if(typeof global.showToast==='function') global.showToast(msg,type||'i');
    else alert(msg);
  }
  function db(){ return global.FS_AN || (global.getDTFirestore && global.getDTFirestore()); }
  function state(){ return global.AnalistaStore?.getState?.() || {}; }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  async function contarColecao(nome){
    try{ const snap=await db().collection(nome).get(); return {ok:true,total:snap.size}; }
    catch(e){ return {ok:false,total:0,erro:e.message||String(e)}; }
  }

  async function diagnosticarSync(){
    const user=global.AUTH_AN?.currentUser || global._currentAnalistaUser || null;
    const loja=global.getDTLojaAtiva?.() || '';
    const online=navigator.onLine;
    const checks={};
    if(user && loja && db()){
      const nomes=['dt_inventarios','dt_auditorias','dt_contagens','dt_divergencias','dt_recontagens','dt_locais_chunks','dt_produtos'];
      const rs=await Promise.all(nomes.map(contarColecao));
      nomes.forEach(function(n,i){checks[n]=rs[i];});
    }
    const fsState=global.AnalistaFirebaseService?.state || {};
    const linhas=[
      ['Internet',online?'Online':'Offline',online],
      ['Usuário',user?.email||'Não autenticado',!!user],
      ['Loja ativa',loja||'Não selecionada',!!loja],
      ['Tempo real',fsState.started?'Ativo':'Parado',!!fsState.started],
      ['Auditoria: função de criação',typeof global.criarNovaAuditoriaStandalone==='function'?'OK':'Ausente',typeof global.criarNovaAuditoriaStandalone==='function'],
      ['Auditoria: função de listagem',typeof global.atualizarListaAuditorias==='function'?'OK':'Ausente',typeof global.atualizarListaAuditorias==='function']
    ];
    Object.keys(checks).forEach(function(k){ const r=checks[k]; linhas.push([k,r.ok?String(r.total)+' documento(s)':'Erro: '+r.erro,r.ok]); });
    let modal=document.getElementById('modal-diagnostico-sync-v75'); if(modal) modal.remove();
    modal=document.createElement('div'); modal.id='modal-diagnostico-sync-v75'; modal.className='modal-bg on';
    modal.innerHTML='<div class="modal" style="max-width:720px"><div class="modal-hdr"><div><div class="modal-title">🔍 Diagnóstico do sistema</div><div class="sec-sub">Loja atual e comunicação com o Firebase</div></div><button class="modal-close" data-fechar>✕</button></div><div style="max-height:60vh;overflow:auto"><table style="width:100%"><thead><tr><th>Verificação</th><th>Resultado</th><th>Status</th></tr></thead><tbody>'+linhas.map(function(x){return '<tr><td>'+esc(x[0])+'</td><td>'+esc(x[1])+'</td><td>'+(x[2]?'✅':'⚠️')+'</td></tr>';}).join('')+'</tbody></table></div><div class="modal-actions"><button class="btn btn-ghost" data-fechar>Fechar</button><button class="btn btn-primary" id="diag-v75-recarregar">↻ Recarregar dados</button></div></div>';
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-fechar]').forEach(function(b){b.onclick=function(){modal.remove();};});
    modal.onclick=function(e){if(e.target===modal)modal.remove();};
    modal.querySelector('#diag-v75-recarregar').onclick=async function(){
      try{ await global.AnalistaFirebaseService?.stop?.(); await global.AnalistaFirebaseService?.start?.(); await global.atualizarListaAuditorias?.(); toast('Dados recarregados do Firebase.','s'); modal.remove(); }
      catch(e){toast('Falha ao recarregar: '+(e.message||e),'e');}
    };
  }

  async function republicarTodosFirebase(){
    if(!navigator.onLine) return toast('Sem internet. Conecte-se para sincronizar.','w');
    const btn=document.getElementById('btn-sync-firebase');
    const original=btn?.innerHTML;
    if(btn){btn.disabled=true;btn.innerHTML='⏳ Sincronizando...';}
    try{
      const st=state();
      const inventarios=Array.isArray(st.inventarios)?st.inventarios:[];
      let publicados=0;
      for(const inv of inventarios){ if(inv&&inv.id&&typeof global.fsPublicarInventario==='function'){ await global.fsPublicarInventario(inv); publicados++; } }
      if(typeof global.fsPublicarEnderecos==='function') await global.fsPublicarEnderecos();
      const produtos=global.DTProdutos?.listar?.() || global.DTProdutos?.todos?.() || [];
      if(Array.isArray(produtos)&&produtos.length&&typeof global.fsPublicarProdutos==='function') await global.fsPublicarProdutos(produtos);
      await global.AnalistaFirebaseService?.stop?.();
      await global.AnalistaFirebaseService?.start?.();
      await global.atualizarListaAuditorias?.();
      toast('Sincronização concluída. '+publicados+' inventário(s) republicado(s).','s');
    }catch(e){
      console.error('[SYNC FIREBASE]',e);
      toast('Falha na sincronização: '+(e.message||e),'e');
    }finally{ if(btn){btn.disabled=false;btn.innerHTML=original||'🔥 Sync Firebase';} }
  }

  global.diagnosticarSync=diagnosticarSync;
  global.republicarTodosFirebase=republicarTodosFirebase;
})(window);
