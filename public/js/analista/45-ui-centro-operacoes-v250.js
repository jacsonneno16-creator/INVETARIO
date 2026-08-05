(function(){
  'use strict';
  var PAGE_LABELS={
    dashboard:'Visao geral do sistema em tempo real',inventarios:'Gerencie todos os inventarios das lojas',
    acompanhamento:'Acompanhe o progresso por ruas e locais',auditoria:'Audite a qualidade do processo de inventario',
    contagens:'Acompanhe as contagens recebidas',pendencias:'Gerencie os pontos que exigem atencao',
    recontagens:'Gerencie solicitacoes e rodadas de recontagem','rel-divergencias':'Analise conflitos de contagem',
    'capas-duplicadas':'Identifique capas e enderecos duplicados',produtividade:'Acompanhe a produtividade da equipe',
    enderecos:'Gerencie os enderecos do inventario',produtos:'Gerencie a base de produtos',
    coletores:'Acompanhe coletores e dispositivos',operadores:'Gerencie usuarios e permissoes',
    lojas:'Gerencie as lojas do sistema',rastreabilidade:'Rastreie alteracoes e eventos do sistema',
    'importar-exportar':'Importe e exporte dados do sistema'
  };
  function activeId(){var p=document.querySelector('#app-main .page.on');return p?p.id.replace(/^page-/,''):'';}
  function sync(){
    var id=activeId();
    var app=document.getElementById('app-main');
    if(!app)return;
    app.setAttribute('data-active-page',id);
    document.querySelectorAll('#app-main .page').forEach(function(p){
      var active=p.classList.contains('on');
      p.setAttribute('aria-hidden',active?'false':'true');
      if(!active){p.style.removeProperty('display');}
    });
    var title=document.getElementById('page-title');
    if(title){
      var host=title.parentElement;
      if(host && !host.querySelector('.v250-page-subtitle')){
        var sub=document.createElement('div');sub.className='v250-page-subtitle';
        sub.style.cssText='font-size:.64rem;color:#7b8794;margin-top:2px;font-weight:500';host.appendChild(sub);
      }
      var s=host&&host.querySelector('.v250-page-subtitle');if(s)s.textContent=PAGE_LABELS[id]||'';
    }
  }
  function observe(){
    var root=document.getElementById('app-main');if(!root)return;
    new MutationObserver(function(m){if(m.some(function(x){return x.type==='attributes'&&x.attributeName==='class';}))sync();})
      .observe(root,{subtree:true,attributes:true,attributeFilter:['class']});
    sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe);else observe();
})();
