(function(){
  'use strict';
  function bind(){
    const loginBtn=document.getElementById('btn-login-analista');
    const pass=document.getElementById('an-pass');
    const email=document.getElementById('an-email');
    const eye=document.getElementById('btn-toggle-pass-analista');
    if(loginBtn) loginBtn.addEventListener('click',()=>window.doLoginAnalista?.());
    const enter=e=>{ if(e.key==='Enter'){ e.preventDefault(); window.doLoginAnalista?.(); } };
    pass?.addEventListener('keydown',enter);
    email?.addEventListener('keydown',enter);
    if(eye){
      const toggle=()=>window.togglePassAnalista?.();
      eye.addEventListener('click',toggle);
      eye.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
    }
    // Fallbacks para evitar quebra total da navegação enquanto algum módulo carrega.
    if(typeof window.getInventariosAtivos!=='function'){
      window.getInventariosAtivos=function(){
        try{return (window.AnalistaStore?.getState()?.inventarios||[]).filter(i=>String(i.status||'').toUpperCase()==='ATIVO');}
        catch(_){return [];}
      };
    }
    if(typeof window.renderAuditoriaOperacional!=='function'){
      window.renderAuditoriaOperacional=function(){
        const wrap=document.getElementById('aud-op-table-wrap')||document.getElementById('auditoria-operacional-wrap');
        if(wrap&&!wrap.dataset.erroModulo){
          wrap.dataset.erroModulo='1';
          wrap.innerHTML='<div class="empty"><div class="empty-title">Carregando módulo de auditoria…</div><div class="empty-sub">Atualize a página caso esta mensagem permaneça.</div></div>';
        }
      };
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
