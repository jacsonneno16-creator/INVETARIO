(function(){
'use strict';
var qs=function(s,r){return (r||document).querySelector(s)};
var qsa=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var text=function(el){return el?(el.textContent||'').trim():''};
var safe=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var pct=function(s){var m=String(s||'').match(/(\d+(?:[.,]\d+)?)\s*%/);return m?Math.max(0,Math.min(100,Number(m[1].replace(',','.'))||0)):0};
function val(id){return text(document.getElementById(id))||'0'}
function removeOld(){qsa('.ops-v251,#v251-acomp-intel').forEach(function(x){x.remove()})}
function parseProgress(container,limit){
 var nodes=qsa(':scope > *',container||document.createElement('div')).filter(function(n){return text(n).length>2});
 return nodes.map(function(n,i){var t=text(n);var name=(t.match(/Rua\s*[^|\n]+/i)||t.match(/Local\s*[^|\n]+/i)||['Item '+(i+1)])[0].trim();return {name:name.slice(0,38),p:pct(t)}}).filter(function(x){return x.name}).slice(0,limit||6)
}
function progressRows(items){
 if(!items.length)return '<div style="padding:18px 0;color:#7a8881;font-size:.75rem">Os dados aparecerão após selecionar um inventário.</div>';
 return '<div class="dash-v252-list">'+items.map(function(x){return '<div class="dash-v252-row"><b title="'+safe(x.name)+'">'+safe(x.name)+'</b><div class="dash-v252-bar"><i style="width:'+x.p+'%"></i></div><strong>'+x.p+'%</strong></div>'}).join('')+'</div>'
}
function ensureDashboard(){
 var p=qs('#page-dashboard');if(!p)return;removeOld();
 var panel=qs('#dash-v252-insights',p);if(!panel){
  panel=document.createElement('div');panel.id='dash-v252-insights';panel.className='dash-v252-insights';
  var recent=qs('#dash-recentes-card',p);if(recent)recent.parentNode.insertBefore(panel,recent);else p.appendChild(panel);
 }
 var ruas=parseProgress(qs('#dash-ruas-wrap',p),5);
 var inv=val('kd-inventarios'),end=val('kd-enderecos'),cont=val('kd-end-contados'),pend=val('kd-pendencias'),div=val('kd-diverg'),ops=val('kd-operadores');
 panel.innerHTML=
  '<section class="dash-v252-panel"><div class="dash-v252-head"><span>🏆 Destaques por rua</span><small>progresso</small></div><div class="dash-v252-body">'+progressRows(ruas)+'</div></section>'+ 
  '<section class="dash-v252-panel"><div class="dash-v252-head"><span>⚡ Atividades recentes</span><small>tempo real</small></div><div class="dash-v252-body">'+
    '<div class="dash-v252-activity"><i class="dash-v252-dot"></i><div><div class="dash-v252-a-title">Painel sincronizado</div><div class="dash-v252-a-sub">Indicadores atualizados com os dados disponíveis.</div></div></div>'+ 
    '<div class="dash-v252-activity"><i class="dash-v252-dot" style="background:#f59e0b"></i><div><div class="dash-v252-a-title">'+safe(pend)+' endereços pendentes</div><div class="dash-v252-a-sub">Itens aguardando contagem ou validação.</div></div></div>'+ 
    '<div class="dash-v252-activity"><i class="dash-v252-dot" style="background:#ef4444"></i><div><div class="dash-v252-a-title">'+safe(div)+' registros em conflito</div><div class="dash-v252-a-sub">Acesse Recontagem para analisar as diferenças.</div></div></div>'+ 
  '</div></section>'+ 
  '<section class="dash-v252-panel"><div class="dash-v252-head"><span>📋 Resumo geral</span></div><div class="dash-v252-body"><div class="dash-v252-summary">'+
    '<div><b>'+safe(inv)+'</b><span>Inventários ativos</span></div><div><b>'+safe(end)+'</b><span>Endereços</span></div><div><b>'+safe(cont)+'</b><span>Contados</span></div><div><b>'+safe(ops)+'</b><span>Operadores ativos</span></div>'+ 
  '</div></div></section>';
}
function ensureAcomp(){
 var p=qs('#page-acompanhamento');if(!p)return;removeOld();
 if(!qs('.acomp-v252-grid',p)){
  var ruas=qs('#acomp-ruas-grid',p),loc=qs('#acomp-progress-detail',p),ops=qs('#acomp-coletores-wrap',p);
  var rc=ruas&&ruas.closest('.tc'),lc=loc&&loc.closest('.tc'),oc=ops&&ops.closest('.tc');
  if(rc&&lc&&oc){
   var grid=document.createElement('div');grid.className='acomp-v252-grid';
   var main=document.createElement('div');main.className='acomp-v252-main';
   var side=document.createElement('div');side.className='acomp-v252-side';
   rc.parentNode.insertBefore(grid,rc);grid.appendChild(main);grid.appendChild(side);main.appendChild(rc);side.appendChild(lc);side.appendChild(oc);
  }
 }
 var foot=qs('#acomp-v252-footer',p);if(!foot){foot=document.createElement('div');foot.id='acomp-v252-footer';foot.className='acomp-v252-footer';p.appendChild(foot)}
 var total=val('ak-total'),done=val('ak-contados'),pending=val('ak-pendentes'),conf=val('ak-diverg'),rec=val('ak-recount'),concl=val('ak-pct');
 var ruasItems=parseProgress(qs('#acomp-ruas-grid',p),5);
 foot.innerHTML=
  '<section class="dash-v252-panel"><div class="dash-v252-head"><span>📌 Resumo operacional</span><small>'+safe(concl)+' concluído</small></div><div class="dash-v252-body"><div class="acomp-v252-status">'+
   '<div><b>'+safe(total)+'</b><span>Total de endereços</span></div><div><b>'+safe(done)+'</b><span>Contados</span></div><div><b>'+safe(pending)+'</b><span>Pendentes</span></div><div><b>'+safe(conf)+'</b><span>Em conflito</span></div><div><b>'+safe(rec)+'</b><span>Recontagens</span></div><div><b>'+safe(concl)+'</b><span>Conclusão</span></div>'+ 
  '</div></div></section>'+ 
  '<section class="dash-v252-panel"><div class="dash-v252-head"><span>📈 Ruas em destaque</span><small>progresso atual</small></div><div class="dash-v252-body">'+progressRows(ruasItems)+'</div></section>';
}
function refresh(){var active=qs('#app-main .page.on');if(!active)return;if(active.id==='page-dashboard')ensureDashboard();if(active.id==='page-acompanhamento')ensureAcomp()}
function boot(){var app=qs('#app-main');if(!app){setTimeout(boot,200);return}removeOld();var timer;new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(refresh,120)}).observe(app,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});document.addEventListener('click',function(){setTimeout(refresh,100)},true);refresh()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
