(function(){
  'use strict';
  var lastInstallPrompt=null;
  var diag=[];
  function addDiag(msg){
    try{diag.push(new Date().toLocaleTimeString('pt-BR')+' — '+msg); if(diag.length>20)diag.shift(); localStorage.setItem('dt_diag_coletor_v15',JSON.stringify(diag));}catch(e){}
  }
  window.addEventListener('error',function(e){addDiag('JS: '+(e.message||'erro')+' @ '+(e.filename||'')+':'+(e.lineno||''));});
  window.addEventListener('unhandledrejection',function(e){addDiag('Promise: '+((e.reason&&e.reason.message)||e.reason||'erro'));});
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();lastInstallPrompt=e;addDiag('Instalação PWA disponível');});

  function closeMenus(){['menu3pts-dropdown','menu3pts-dropdown-login'].forEach(function(id){var x=document.getElementById(id);if(x)x.style.display='none';});}
  window.instalarAplicativo=async function(){
    closeMenus();
    try{
      if(lastInstallPrompt){lastInstallPrompt.prompt();await lastInstallPrompt.userChoice;lastInstallPrompt=null;return;}
      if(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches){if(typeof toast==='function')toast('Aplicativo já está instalado.','s');return;}
      alert('Para instalar: abra este endereço no Google Chrome, toque no menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”. O navegador interno de alguns coletores não permite instalação PWA.');
    }catch(e){addDiag('Instalação: '+e.message);alert('Não foi possível iniciar a instalação: '+e.message);}
  };
  window.mostrarDiagnosticoColetor=function(){
    var auth=(window.AUTH&&AUTH.currentUser)?AUTH.currentUser.email:'não autenticado';
    var info=['Versão: '+(window.APP_VERSION||'v15'),'Device ID: '+(typeof obterDeviceId==='function'?obterDeviceId():'indisponível'),'Online: '+navigator.onLine,'Firebase: '+(window.firebase?'carregado':'não carregado'),'Usuário: '+auth,'Navegador: '+navigator.userAgent,'','Últimos erros:'].concat(diag.length?diag:['nenhum erro registrado']);
    alert(info.join('\n'));
  };
  document.addEventListener('DOMContentLoaded',function(){
    try{diag=JSON.parse(localStorage.getItem('dt_diag_coletor_v15')||'[]');}catch(e){diag=[];}
    // Acrescenta diagnóstico aos dois menus sem depender do restante do aplicativo.
    ['menu3pts-dropdown-login','menu3pts-dropdown'].forEach(function(id){var d=document.getElementById(id);if(!d||d.querySelector('[data-dt-diagnostico]'))return;var b=document.createElement('button');b.type='button';b.setAttribute('data-dt-diagnostico','1');b.textContent='🩺 Diagnóstico do coletor';b.style.cssText='display:block;width:100%;padding:12px;text-align:left;background:transparent;color:inherit;border:0;font:inherit';b.onclick=function(e){e.preventDefault();e.stopPropagation();closeMenus();window.mostrarDiagnosticoColetor();};d.appendChild(b);});
    // Garante que as opções de instalar chamem a função estável.
    ['menu-instalar-pwa-login','menu-instalar-pwa-app'].forEach(function(id){var el=document.getElementById(id);if(el){el.style.display='block';el.onclick=function(e){e.preventDefault();e.stopPropagation();window.instalarAplicativo();};}});
    // Atualiza IP somente depois da tela estar funcional.
    setTimeout(function(){if(typeof atualizarIPColetorEmSegundoPlano==='function')atualizarIPColetorEmSegundoPlano();},5000);
  });
})();
