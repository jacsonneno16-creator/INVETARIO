(function(){
  'use strict';
  var lastInstallPrompt=null;
  var diag=[];
  function addDiag(msg){
    try{diag.push(new Date().toLocaleTimeString('pt-BR')+' — '+msg); if(diag.length>20)diag.shift(); localStorage.setItem('dt_diag_coletor_v15',JSON.stringify(diag));}catch(e){ console.warn("[Erro tratado]", e); }
  }
  // Exposto pra outros arquivos (ex.: 02-sync-dispositivo.js) registrarem
  // erros que são tratados internamente (try/catch que nunca vira
  // unhandledrejection) — sem isso, um erro real de permissão no registro
  // do aparelho ficava invisível na tela de Diagnóstico (bug ao vivo
  // relatado: "diagnóstico tá tudo correto" mesmo com o registro falhando).
  window.dtAddDiag=addDiag;
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
  // Pedido ao vivo do usuário: "não consigo rastrear qual é o UID dele, se
  // é o mesmo ou se mudou" — antes só mostrava o e-mail, e a lista de erros
  // misturava sessões/contas diferentes do MESMO aparelho físico (1
  // aparelho passa por vários operadores ao longo do tempo) sem separar o
  // que é de agora do que é histórico, deixando impossível confirmar "esse
  // UID que está dando erro AGORA é o mesmo que o Analista configurou?".
  window.mostrarDiagnosticoColetor=function(){
    var user=(window.AUTH&&AUTH.currentUser)?AUTH.currentUser:null;
    var info=[
      'Versão: '+(window.APP_VERSION||'v15'),
      'Device ID: '+(typeof obterDeviceId==='function'?obterDeviceId():'indisponível'),
      'Online: '+navigator.onLine,
      'Firebase: '+(window.firebase?'carregado':'não carregado'),
      '',
      '=== QUEM ESTÁ LOGADO AGORA ===',
      'E-mail: '+(user?user.email:'não autenticado'),
      'UID: '+(user?user.uid:'—'),
      '(compare esse UID com o que aparece no Diagnóstico de acesso, na tela de Usuários e Permissões do Analista)',
      '',
      'Navegador: '+navigator.userAgent,
      '',
      'Últimos erros (histórico deste APARELHO — pode ter entradas de contas/logins anteriores, não só a de agora):',
    ].concat(diag.length?diag:['nenhum erro registrado']);
    alert(info.join('\n'));
  };
  window.limparDiagnosticoColetor=function(){
    if(!confirm('Apagar o histórico de erros deste aparelho? Não afeta login nem permissões, só limpa a lista.'))return;
    diag=[];
    try{localStorage.removeItem('dt_diag_coletor_v15');}catch(e){ console.warn("[Erro tratado]", e); }
    if(typeof toast==='function')toast('Histórico de diagnóstico limpo.','s');
  };
  document.addEventListener('DOMContentLoaded',function(){
    try{diag=JSON.parse(localStorage.getItem('dt_diag_coletor_v15')||'[]');}catch(e){diag=[];}
    // Acrescenta diagnóstico aos dois menus sem depender do restante do aplicativo.
    ['menu3pts-dropdown-login','menu3pts-dropdown'].forEach(function(id){
      var d=document.getElementById(id);if(!d||d.querySelector('[data-dt-diagnostico]'))return;
      var b=document.createElement('button');b.type='button';b.setAttribute('data-dt-diagnostico','1');b.textContent='🩺 Diagnóstico do coletor';b.style.cssText='display:block;width:100%;padding:12px;text-align:left;background:transparent;color:inherit;border:0;font:inherit';b.onclick=function(e){e.preventDefault();e.stopPropagation();closeMenus();window.mostrarDiagnosticoColetor();};d.appendChild(b);
      var bLimpar=document.createElement('button');bLimpar.type='button';bLimpar.setAttribute('data-dt-diagnostico-limpar','1');bLimpar.textContent='🧹 Limpar histórico de erros';bLimpar.style.cssText='display:block;width:100%;padding:12px;text-align:left;background:transparent;color:inherit;border:0;font:inherit';bLimpar.onclick=function(e){e.preventDefault();e.stopPropagation();closeMenus();window.limparDiagnosticoColetor();};d.appendChild(bLimpar);
    });
    // Garante que as opções de instalar chamem a função estável.
    ['menu-instalar-pwa-login','menu-instalar-pwa-app'].forEach(function(id){var el=document.getElementById(id);if(el){el.style.display='block';el.onclick=function(e){e.preventDefault();e.stopPropagation();window.instalarAplicativo();};}});
    // Atualiza IP somente depois da tela estar funcional.
    setTimeout(function(){if(typeof atualizarIPColetorEmSegundoPlano==='function')atualizarIPColetorEmSegundoPlano();},5000);
  });
})();
