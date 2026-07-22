(function(global){
  'use strict';
  var busy={};
  function idFromOnclick(v){var m=String(v||'').match(/\(['\"]([^'\"]+)['\"]\)/);return m?m[1]:'';}
  async function execute(action,id,button){
    if(!id||busy[id])return;busy[id]=true;if(button)button.disabled=true;
    try{
      if(action==='approve') await global.aprovarColetor(id);
      else if(action==='block') await global.bloquearColetor(id);
      else if(action==='delete') await global.excluirColetor(id);
      else if(action==='logout'&&typeof global.logoutOperadorColetor==='function') await global.logoutOperadorColetor(id);
    }finally{setTimeout(function(){busy[id]=false;if(button&&button.isConnected)button.disabled=false;},700);}
  }
  document.addEventListener('click',function(e){
    var b=e.target&&e.target.closest?e.target.closest('#page-coletores button[onclick]'):null;if(!b)return;
    var oc=b.getAttribute('onclick')||'', action='';
    if(oc.indexOf('aprovarColetor')>=0)action='approve';
    else if(oc.indexOf('bloquearColetor')>=0)action='block';
    else if(oc.indexOf('excluirColetor')>=0)action='delete';
    else if(oc.indexOf('logoutOperadorColetor')>=0)action='logout';
    if(!action)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();execute(action,idFromOnclick(oc),b);
  },true);

  // Diagnóstico visível no console para facilitar suporte sem adivinhação.
  global.diagnosticarColetores=function(){
    var st=global.AnalistaStore&&global.AnalistaStore.getState?global.AnalistaStore.getState():{};
    var r={firebase:!!global.FS_AN,auth:!!(global.AUTH_AN&&global.AUTH_AN.currentUser),usuario:global.AUTH_AN&&global.AUTH_AN.currentUser&&global.AUTH_AN.currentUser.email,coletores:(st.coletores||[]).length,online:navigator.onLine};
    console.table(r);return r;
  };
})(window);
