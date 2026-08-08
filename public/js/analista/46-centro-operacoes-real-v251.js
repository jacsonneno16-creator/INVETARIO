(function(){
'use strict';
var qs=function(s,r){return (r||document).querySelector(s)};
var qsa=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var txt=function(el){return el?(el.textContent||'').trim():''};
var num=function(v){var m=String(v||'').replace(/\./g,'').replace(',','.').match(/-?[\d.]+/);return m?Number(m[0])||0:0};
function page(){return qs('#app-main .page.on')}
function tableRows(p){return qsa('tbody tr',p).filter(function(r){return txt(r).length>2})}
function card(label,value,sub,cls){return '<div class="ops-card '+(cls||'')+'"><div class="l">'+label+'</div><div class="v">'+value+'</div><div class="s">'+(sub||'')+'</div></div>'}
function ensureStrip(p,items){var old=qs(':scope > .ops-v251',p);if(!old){old=document.createElement('div');old.className='ops-v251';p.insertBefore(old,p.firstChild)}old.innerHTML=items.join('')}
function summarizeGeneric(p){
 var rows=tableRows(p), badges=qsa('.badge',p), text=txt(p).toLowerCase();
 var active=badges.filter(function(b){return /ativo|aberto|conclu|online|ok/.test(txt(b).toLowerCase())}).length;
 var warning=badges.filter(function(b){return /pend|andamento|paus|aten/.test(txt(b).toLowerCase())}).length;
 var danger=badges.filter(function(b){return /erro|diverg|cancel|offline|bloq/.test(txt(b).toLowerCase())}).length;
 return [card('Registros exibidos',rows.length,'Resultado da tela atual','info'),card('Status positivos',active,'Ativos, concluídos ou online','good'),card('Em atenção',warning,'Pendentes ou em andamento','warn'),card('Críticos',danger,'Erros, conflitos ou bloqueios','danger'),card('Atualização','Tempo real','Dados da aba selecionada','')];
}
function enhanceGeneric(p){if(!p||p.id==='page-dashboard'||p.id==='page-acompanhamento')return;ensureStrip(p,summarizeGeneric(p))}
function pctFrom(s){var m=String(s).match(/(\d+(?:[.,]\d+)?)\s*%/);return m?Math.max(0,Math.min(100,Number(m[1].replace(',','.')))):0}
function heatClass(p){return p>=90?4:p>=65?3:p>=35?2:p>0?1:0}
function buildHeat(){
 var p=qs('#page-acompanhamento');if(!p)return;
 var ruas=qsa('#acomp-ruas-grid > *',p).filter(function(x){return txt(x).length>0});
 var data=ruas.map(function(r,i){var t=txt(r);var name=(t.match(/Rua\s*[^\s|]+/i)||['Rua '+(i+1)])[0];return {name:name,p:pctFrom(t),el:r}});
 var panel=qs('#v251-acomp-intel',p);if(!panel){
  panel=document.createElement('div');panel.id='v251-acomp-intel';panel.className='ops-grid-2';
  var hdr=qs('.kpi-grid',p);(hdr||p.firstChild).insertAdjacentElement('afterend',panel);
 }
 var avg=data.length?Math.round(data.reduce(function(a,b){return a+b.p},0)/data.length):0;
 var done=data.filter(function(x){return x.p>=100}).length;
 var critical=data.filter(function(x){return x.p<25}).length;
 ensureStrip(p,[card('Ruas monitoradas',data.length,'Com dados carregados','info'),card('Progresso médio',avg+'%','Média das ruas','good'),card('Ruas concluídas',done,'100% finalizadas','good'),card('Ruas críticas',critical,'Abaixo de 25%','danger'),card('Sincronização',txt(qs('#acomp-ultima-sync',p))||'—','Atualização do painel','')]);
 var cells=data.slice(0,72).map(function(x){return '<div class="heat-cell heat-'+heatClass(x.p)+'" title="'+escHTML(x.name)+': '+x.p+'%" data-name="'+escHTML(x.name)+'">'+x.p+'%</div>'}).join('');
 if(!cells)cells='<div style="grid-column:1/-1;padding:28px;text-align:center;color:#718078">Selecione um inventário para montar o mapa de calor.</div>';
 var rank=data.slice().sort(function(a,b){return b.p-a.p}).slice(0,8).map(function(x,i){return '<div class="ops-rank-row"><b>'+(i+1)+'. '+escHTML(x.name)+'</b><div class="ops-rank-bar"><i style="width:'+x.p+'%"></i></div><strong>'+x.p+'%</strong></div>'}).join('')||'<div style="color:#718078">Sem dados para ranking.</div>';
 panel.innerHTML='<section class="ops-panel"><div class="ops-panel-h"><span>🗺️ Mapa de calor por rua</span><small>verde = concluído · vermelho = pendente</small></div><div class="ops-panel-b"><div class="heatmap-v251">'+cells+'</div></div></section><section class="ops-panel"><div class="ops-panel-h">🏆 Ranking de progresso</div><div class="ops-panel-b ops-ranking">'+rank+'</div></section>';
 qsa('.heat-cell',panel).forEach(function(c){c.onclick=function(){var name=c.getAttribute('data-name');var sel=qs('#acomp-filtro-rua');if(sel){var opt=qsa('option',sel).find(function(o){return txt(o).toLowerCase().indexOf(name.toLowerCase())>=0});if(opt){sel.value=opt.value;sel.dispatchEvent(new Event('change',{bubbles:true}))}}}});
 arrangeAcomp(p);
}
function arrangeAcomp(p){
 if(qs('.v251-original-grid',p))return;
 var ruas=qs('#acomp-ruas-grid',p),local=qs('#acomp-progress-detail',p),ops=qs('#acomp-coletores-wrap',p);if(!ruas||!local||!ops)return;
 var ruaCard=ruas.closest('.tc'),localCard=local.closest('.tc'),opsCard=ops.closest('.tc');if(!ruaCard||!localCard||!opsCard)return;
 var grid=document.createElement('div');grid.className='v251-original-grid';
 var main=document.createElement('div');main.className='v251-main';var side=document.createElement('div');side.className='v251-side';
 ruaCard.parentNode.insertBefore(grid,ruaCard);grid.appendChild(main);grid.appendChild(side);main.appendChild(ruaCard);side.appendChild(localCard);side.appendChild(opsCard);
}
function enhanceDashboard(){var p=qs('#page-dashboard');if(!p)return;var modo=(document.getElementById('dash-mode')||{}).value||'inventario',titulo=modo==='auditoria'?'Auditorias em aberto':'Inventários em aberto';var vals=qsa('.kpi-val',p).slice(0,5).map(txt);ensureStrip(p,[card(titulo,vals[0]||'0','Operações abertas','info'),card('Endereços',vals[1]||'0','Base cadastrada',''),card('Contados',vals[2]||'0','Conferidos','good'),card('Pendências',vals[3]||'0','Aguardando ação','warn'),card('Contagens',vals[4]||'0','Registros processados','')])}
function refresh(){var p=page();if(!p)return;if(p.id==='page-dashboard')enhanceDashboard();else if(p.id==='page-acompanhamento')buildHeat();else enhanceGeneric(p)}
var obs=new MutationObserver(function(ms){var relevant=ms.some(function(m){return m.type==='childList'||m.type==='characterData'||(m.type==='attributes'&&m.attributeName==='class')});if(relevant){clearTimeout(window.__v251t);window.__v251t=setTimeout(refresh,120)}});
function boot(){var app=qs('#app-main');if(!app){setTimeout(boot,250);return}obs.observe(app,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});refresh();document.addEventListener('click',function(){setTimeout(refresh,120)},true)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
