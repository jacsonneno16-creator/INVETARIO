(function(){
  'use strict';
  const COLORS=['#f97316','#2563eb','#10b981','#8b5cf6','#ef4444','#06b6d4','#eab308','#ec4899','#14b8a6','#6366f1'];
  const oldRenderAcompanhamento=window.renderAcompanhamentoInventarioBase || window.renderAcompanhamento;
  const oldTrocarInventarioAcomp=window.trocarInventarioAcomp;
  let acompAudItens=[], acompAudMetas=[], acompAudLoja='', acompAudTimer=null;
  function safe(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function tipoAcomp(){return document.getElementById('acomp-tipo')?.value||'inventario';}
  // Estrutura: loja.local.area.rua.coluna.nivel.sequencia — rua=índice3, coluna=índice4, nível=índice5.
  function enderecoPartes(end){const p=window.DTEnderecos?.partes(end)||{};return {rua:String(p.rua||'SEM RUA').toUpperCase(),coluna:String(p.coluna||'SEM COLUNA').toUpperCase(),nivel:String(p.nivel||'SEM NÍVEL').toUpperCase()};}
  function audStatus(i){const s=String(i.status||'PENDENTE').toUpperCase();if(['APROVADO','CORRETO','CONFERIDO','FINALIZADO','CONFIRMADO_SEM_AJUSTE','OK'].includes(s))return'OK';if(['ERRO','CONFIRMADO_COM_AJUSTE','DIVERGENTE'].includes(s))return'DIVERGENTE';if(['VAZIO','ENDERECO_VAZIO'].includes(s))return'ENDERECO_VAZIO';return'PENDENTE';}
  function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
  function ensureHero(){let h=document.getElementById('acomp-live-hero');if(h)return h;h=document.createElement('div');h.id='acomp-live-hero';h.innerHTML='<div id="acomp-live-ring"><div id="acomp-live-value">0%</div></div><div><div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;opacity:.72">Progresso em tempo real</div><div id="acomp-live-title" style="font-size:1.15rem;font-weight:800;margin:5px 0">—</div><div id="acomp-live-detail" style="font-size:.75rem;opacity:.75">Aguardando seleção</div></div>';document.getElementById('acomp-kpis')?.before(h);return h;}
  function setHero(pct,title,detail,color2){ensureHero();const ring=document.getElementById('acomp-live-ring');if(ring)ring.style.background=`conic-gradient(${color2||'#f59e0b'} ${pct*3.6}deg,rgba(255,255,255,.16) 0)`;setText('acomp-live-value',pct+'%');setText('acomp-live-title',title);setText('acomp-live-detail',detail);}
  let acompAudUnsub=null;
  function rawDb(){return window.getDTRawFirestore?.()||null;}
  function lojaAtiva(){return String(window.getDTLojaAtiva?.()||'').trim();}
  function auditoriasRef(origem){
    const raw=rawDb(); if(!raw)return null;
    return origem==='raiz' ? raw.collection('dt_auditorias') : raw.collection('lojas').doc(lojaAtiva()).collection('dt_auditorias');
  }
  function audDocRef(metaOuId){
    const meta=typeof metaOuId==='object'?metaOuId:acompAudMetas.find(x=>x.id===metaOuId);
    const origem=meta?meta._origem:'loja';
    const col=auditoriasRef(origem); return col?col.doc(typeof metaOuId==='object'?metaOuId.id:metaOuId):null;
  }
  function chaveAudItem(x){
    const id=String(x?.id||'').trim(); if(id)return 'ID:'+id;
    const end=window.DTEnderecos?.chave?.(x?.endereco)||String(x?.endereco||'').trim().toUpperCase();
    const cod=String(x?.dunEsperado||x?.dun_esperado||x?.gtinEsperado||x?.gtin_esperado||x?.codigoProduto||x?.codigo_produto||'').trim().toUpperCase();
    return 'END:'+end+'|COD:'+cod;
  }
  async function loadAuditoriasAcomp(force){
    const loja=lojaAtiva();
    if(!force&&loja===acompAudLoja&&acompAudMetas.length)return;
    if(!loja){acompAudMetas=[];acompAudLoja='';return;}
    const itens=[];
    try{const snap=await auditoriasRef('loja').get();snap.docs.forEach(d=>itens.push({id:d.id,...d.data(),_origem:'loja'}));}catch(e){console.warn('[ACOMP AUD] Falha ao listar auditorias da loja:',e);}
    // Compatibilidade com auditorias antigas na raiz, sem duplicar IDs já existentes na loja.
    try{const snap=await auditoriasRef('raiz').get();const ids=new Set(itens.map(x=>x.id));snap.docs.forEach(d=>{if(!ids.has(d.id))itens.push({id:d.id,...d.data(),_origem:'raiz'});});}catch(e){console.warn('[ACOMP AUD] Falha ao listar auditorias legadas:',e);}
    acompAudMetas=itens.sort((a,b)=>String(b.criadoEm||b.criado_em||'').localeCompare(String(a.criadoEm||a.criado_em||'')));
    acompAudLoja=loja;
  }
  async function popularAcompAuditorias(){await loadAuditoriasAcomp(false);const sel=document.getElementById('acomp-sel-inv');if(!sel)return;const atual=sel.value;sel.innerHTML='<option value="">Escolha uma auditoria</option>'+acompAudMetas.map(m=>`<option value="${safe(m.id)}">${safe(m.nome||m.auditoria_nome||m.id)}</option>`).join('');if(acompAudMetas.some(m=>m.id===atual))sel.value=atual;}
  async function montarItensAuditoria(ref,resultadosSnap){
    const base=[];
    try{
      const chunks=await ref.collection('base_chunks').orderBy('parte').get();
      chunks.docs.forEach(d=>{const x=d.data()||{};(x.dados||x.itens||x.registros||[]).forEach((r,idx)=>base.push({id:String(r.id||r.docId||r.documentoId||d.id+'_'+idx),...r}));});
    }catch(e){console.warn('[ACOMP AUD] Falha ao carregar base_chunks:',e);}
    const resultados=resultadosSnap.docs.map(d=>({id:d.id,...d.data()}));
    if(!base.length)return resultados;
    const porId=new Map(),porEndereco=new Map();
    resultados.forEach(r=>{porId.set(String(r.id),r);const end=window.DTEnderecos?.chave?.(r.endereco)||String(r.endereco||'').trim().toUpperCase();if(end)porEndereco.set(end,r);});
    const usados=new Set();
    const unidos=base.map(b=>{
      const end=window.DTEnderecos?.chave?.(b.endereco)||String(b.endereco||'').trim().toUpperCase();
      const r=porId.get(String(b.id))||porEndereco.get(end);
      if(r)usados.add(String(r.id));
      return r?{...b,...r,id:r.id||b.id}:{...b,status:b.status||'PENDENTE'};
    });
    resultados.forEach(r=>{if(!usados.has(String(r.id)))unidos.push(r);});
    return unidos;
  }
  async function carregarAuditoriaSelecionada(){
    const id=document.getElementById('acomp-sel-inv')?.value||'';
    if(acompAudUnsub){try{acompAudUnsub();}catch(_){}acompAudUnsub=null;}
    if(!id){acompAudItens=[];renderAcompAuditoria();return;}
    const meta=acompAudMetas.find(m=>m.id===id);const ref=audDocRef(meta||id);if(!ref)return;
    const aplicar=async snap=>{acompAudItens=await montarItensAuditoria(ref,snap);renderAcompAuditoria();};
    try{
      const inicial=await ref.collection('enderecos').get();await aplicar(inicial);
      acompAudUnsub=ref.collection('enderecos').onSnapshot(s=>{aplicar(s).catch(console.error);},e=>console.warn('[ACOMP AUD] Listener indisponível:',e));
    }catch(e){console.error('[ACOMP AUD] Falha ao carregar acompanhamento:',e);acompAudItens=[];renderAcompAuditoria();}
  }
  function agrupar(lista,fn){const m={};lista.forEach(x=>{const k=fn(x)||'SEM DADO';m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  const GRAD=['linear-gradient(90deg,#f97316,#fb923c)','linear-gradient(90deg,#2563eb,#38bdf8)','linear-gradient(90deg,#10b981,#34d399)','linear-gradient(90deg,#8b5cf6,#a78bfa)','linear-gradient(90deg,#ef4444,#fb7185)','linear-gradient(90deg,#06b6d4,#67e8f9)','linear-gradient(90deg,#eab308,#fde047)','linear-gradient(90deg,#ec4899,#f9a8d4)','linear-gradient(90deg,#14b8a6,#5eead4)','linear-gradient(90deg,#6366f1,#a5b4fc)'];
  function progressRows(arr,total){if(!arr.length)return '<div class="empty"><div class="empty-title">Sem dados para exibir</div></div>';return arr.map(([l,v],idx)=>{const pct=total?Math.round(v/total*100):0;return `<div style="display:grid;grid-template-columns:100px 1fr 55px;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><b style="font-size:.75rem">${safe(l)}</b><div class="prog"><div class="prog-fill" style="width:${pct}%;background:${GRAD[idx%GRAD.length]}"></div></div><span class="mono" style="font-size:.7rem;text-align:right">${v} · ${pct}%</span></div>`}).join('');}
  function renderAcompAuditoria(){const id=document.getElementById('acomp-sel-inv')?.value||'';const meta=acompAudMetas.find(m=>m.id===id);const total=acompAudItens.length;const ok=acompAudItens.filter(i=>audStatus(i)==='OK').length;const div=acompAudItens.filter(i=>audStatus(i)==='DIVERGENTE').length;const vaz=acompAudItens.filter(i=>audStatus(i)==='ENDERECO_VAZIO').length;const pend=acompAudItens.filter(i=>audStatus(i)==='PENDENTE').length;const concl=total-pend;const pct=total?Math.round(concl/total*100):0;setText('acomp-inv-nome',meta?(meta.nome||meta.auditoria_nome||meta.id):'Selecione uma auditoria para monitorar');setText('ak-total',total.toLocaleString('pt-BR'));setText('ak-contados',concl.toLocaleString('pt-BR'));setText('ak-pendentes',pend.toLocaleString('pt-BR'));setText('ak-diverg',div.toLocaleString('pt-BR'));setText('ak-recount',vaz.toLocaleString('pt-BR'));setText('ak-pct',pct+'%');
    const labels=['Total Endereços','Auditados','Pendentes','Divergentes','Vazios','% Concluído'];document.querySelectorAll('#acomp-kpis .kpi-lbl').forEach((e,i)=>e.textContent=labels[i]||e.textContent);setHero(pct,meta?(meta.nome||meta.auditoria_nome||meta.id):'Auditoria não selecionada',`${concl.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} endereços auditados · ${ok} corretos · ${div} divergentes`,'#fb923c');
    const ruas=agrupar(acompAudItens,i=>enderecoPartes(i.endereco).rua);document.getElementById('acomp-ruas-grid').innerHTML=progressRows(ruas,total);document.getElementById('acomp-progress-detail').innerHTML=progressRows([['Corretos',ok],['Divergentes',div],['Vazios',vaz],['Pendentes',pend]],total);const ops=agrupar(acompAudItens.filter(i=>audStatus(i)!=='PENDENTE'),i=>i.operadorNome||i.operador_nome||i.operadorId||i.operador_id||'SEM OPERADOR');document.getElementById('acomp-coletores-wrap').innerHTML=`<div style="padding:16px 20px">${progressRows(ops,Math.max(concl,1))}</div>`;setText('acomp-ultima-sync','Última sync: '+new Date().toLocaleTimeString('pt-BR'));
  }
  window.trocarTipoAcompanhamento=async function(){clearInterval(acompAudTimer);if(acompAudUnsub){try{acompAudUnsub();}catch(_){}acompAudUnsub=null;}const sel=document.getElementById('acomp-sel-inv');if(tipoAcomp()==='auditoria'){window.AnalistaState?.set('ui.acompanhamentoInventarioId',null,{source:'acomp-tipo'});await popularAcompAuditorias();await carregarAuditoriaSelecionada();acompAudTimer=setInterval(()=>carregarAuditoriaSelecionada().catch(console.error),15000);}else{if(sel){sel.innerHTML='<option value="">Escolha um inventário</option>';sel.value='';}ensureHero().style.display='';oldRenderAcompanhamento?.();const inv=window.AnalistaStore?.getState()?.ui?.acompanhamentoInventarioId;setTimeout(()=>{const pct=parseInt(document.getElementById('ak-pct')?.textContent)||0;setHero(pct,document.getElementById('acomp-inv-nome')?.textContent||'Inventário',`${document.getElementById('ak-contados')?.textContent||0} endereços contados`,'#34d399')},0);}};
  window.trocarInventarioAcomp=async function(){if(tipoAcomp()==='auditoria')return carregarAuditoriaSelecionada();return oldTrocarInventarioAcomp?.();};
  window.renderAcompanhamento=function(){if(tipoAcomp()==='auditoria')return renderAcompAuditoria();oldRenderAcompanhamento?.();setTimeout(()=>{const pct=parseInt(document.getElementById('ak-pct')?.textContent)||0;setHero(pct,document.getElementById('acomp-inv-nome')?.textContent||'Inventário',`${document.getElementById('ak-contados')?.textContent||0} endereços contados`,'#34d399')},0);};

  function groupStats(lista,keyFn){const m={};lista.forEach(i=>{const k=keyFn(i)||'SEM DADO';if(!m[k])m[k]={label:k,total:0,auditados:0,divergencias:0,ok:0,vazios:0};const x=m[k];x.total++;const st=audStatus(i);if(st!=='PENDENTE')x.auditados++;if(st==='DIVERGENTE')x.divergencias++;if(st==='OK')x.ok++;if(st==='ENDERECO_VAZIO')x.vazios++;});return Object.values(m).sort((a,b)=>b.divergencias-a.divergencias||b.auditados-a.auditados);}
  function compareRows(arr,tipo,limit=10){if(!arr.length)return '<div class="empty"><div class="empty-title">Sem dados nos filtros atuais</div></div>';const max=Math.max(...arr.map(x=>Math.max(x.auditados,x.divergencias)),1);return arr.slice(0,limit).map((x,idx)=>`<button class="dash-compare-row" onclick="_dashAudBarClick('${tipo}','${String(x.label).replace(/'/g,"\\'")}')"><span class="dash-compare-label" title="${safe(x.label)}">${idx+1}. ${safe(x.label)}</span><span class="dash-compare-bars"><span class="dash-compare-line"><i>Auditados</i><b style="width:${Math.max(2,x.auditados/max*100)}%;background:linear-gradient(90deg,#2563eb,#38bdf8)"></b><em>${x.auditados}</em></span><span class="dash-compare-line"><i>Divergências</i><b style="width:${Math.max(x.divergencias?2:0,x.divergencias/max*100)}%;background:linear-gradient(90deg,#ef4444,#fb7185)"></b><em>${x.divergencias}</em></span></span></button>`).join('');}
  function donut(title,items){const total=items.reduce((a,x)=>a+x.value,0)||1;let deg=0;const stops=items.map((x,i)=>{const ini=deg;deg+=x.value/total*360;return `${x.color} ${ini}deg ${deg}deg`;}).join(',');return `<section class="dash-modern-card dash-pie"><div class="dm-head"><div><div class="dm-title">${title}</div><div class="dm-sub">Distribuição dos registros filtrados</div></div></div><div class="dash-pie-body"><div class="dash-donut" style="background:conic-gradient(${stops})"><div class="dash-donut-value">${total.toLocaleString('pt-BR')}<small>Total</small></div></div><div class="dash-stat-list">${items.map(x=>`<div class="dash-stat-row"><span><i class="dash-dot" style="background:${x.color}"></i>${safe(x.label)}</span><b>${x.value.toLocaleString('pt-BR')}</b></div>`).join('')}</div></div></section>`;}
  window.renderDashboardAuditoria=function(){const lista=window._dashAudFiltrados?window._dashAudFiltrados():[];const total=lista.length,ok=lista.filter(i=>audStatus(i)==='OK').length,div=lista.filter(i=>audStatus(i)==='DIVERGENTE').length,vaz=lista.filter(i=>audStatus(i)==='ENDERECO_VAZIO').length,pend=lista.filter(i=>audStatus(i)==='PENDENTE').length,audit=total-pend,pct=total?Math.round(audit/total*100):0,acur=audit?Math.round(ok/audit*100):0;
    const prod=groupStats(lista,i=>i.produtoEsperado||i.produto_esperado||i.dunEsperado||i.dun_esperado||i.dun||'SEM PRODUTO');
    const ruas=groupStats(lista,i=>i.rua||enderecoPartes(i.endereco).rua);
    const niveis=groupStats(lista,i=>i.nivel||enderecoPartes(i.endereco).nivel);
    const cols=groupStats(lista,i=>i.coluna||enderecoPartes(i.endereco).coluna);
    const kpi=document.getElementById('kpi-grid');if(kpi)kpi.style.display='none';const breakdown=document.getElementById('dash-breakdown-grid');if(breakdown)breakdown.style.display='none';const wrap=document.getElementById('dash-charts-wrap');if(wrap)wrap.innerHTML=`<div class="dash-modern-grid">
      <section class="dash-modern-card dash-summary"><div class="dash-donut" style="background:conic-gradient(#10b981 ${acur*3.6}deg,#ef4444 0)"><div class="dash-donut-value">${acur}%<small>Acuracidade</small></div></div><div class="dash-stat-list"><div class="dash-stat-row"><span><i class="dash-dot" style="background:#10b981"></i>Corretos</span><b>${ok}</b></div><div class="dash-stat-row"><span><i class="dash-dot" style="background:#ef4444"></i>Divergentes</span><b>${div}</b></div><div class="dash-stat-row"><span><i class="dash-dot" style="background:#f59e0b"></i>Pendentes</span><b>${pend}</b></div><div class="dash-stat-row"><span><i class="dash-dot" style="background:#64748b"></i>Vazios</span><b>${vaz}</b></div></div></section>
      <section class="dash-modern-card dash-ranking"><div class="dm-head"><div><div class="dm-title">Top 10 produtos com maior divergência</div><div class="dm-sub">Azul: auditados · Vermelho: divergências · clique para filtrar</div></div></div><div class="dash-ranking-body">${compareRows(prod,'produto')}</div></section>
      <section class="dash-modern-card dash-wide"><div class="dm-head"><div><div class="dm-title">Ruas com maiores divergências</div><div class="dm-sub">Comparação entre endereços auditados e divergentes por rua</div></div></div><div class="dash-ranking-body">${compareRows(ruas,'rua',20)}</div></section>
      ${donut('Resultado da auditoria',[{label:'Corretos',value:ok,color:'#10b981'},{label:'Divergentes',value:div,color:'#ef4444'},{label:'Pendentes',value:pend,color:'#f59e0b'},{label:'Vazios',value:vaz,color:'#64748b'}])}
      ${donut('Divergências por nível',niveis.slice(0,6).map((x,i)=>({label:x.label,value:x.divergencias,color:COLORS[i%COLORS.length]})).filter(x=>x.value))}
      ${donut('Divergências por coluna',cols.slice(0,6).map((x,i)=>({label:x.label,value:x.divergencias,color:COLORS[(i+3)%COLORS.length]})).filter(x=>x.value))}
      <section class="dash-modern-card dash-insights"><div class="dash-insight"><strong>${total.toLocaleString('pt-BR')}</strong><span>Endereços previstos</span></div><div class="dash-insight"><strong>${audit.toLocaleString('pt-BR')}</strong><span>Auditados</span></div><div class="dash-insight"><strong>${pct}%</strong><span>Execução</span></div><div class="dash-insight"><strong>${new Set(lista.map(i=>i.operadorNome||i.operador_nome||i.operadorId||i.operador_id).filter(Boolean)).size}</strong><span>Operadores</span></div><div class="dash-insight"><strong>${prod.filter(x=>x.divergencias).length}</strong><span>Produtos divergentes</span></div></section></div>`;
    const rt=document.getElementById('dash-recentes-title');if(rt)rt.textContent='🔎 Resultados recentes da auditoria';const act=document.getElementById('dash-recentes-action');if(act)act.style.display='none';const tab=document.getElementById('dash-inv-table');if(tab){const rec=[...lista].filter(i=>audStatus(i)!=='PENDENTE').slice(-15).reverse();tab.innerHTML=rec.length?`<div class="tbl-wrap"><table><thead><tr><th>Endereço</th><th>Produto esperado</th><th>Produto lido</th><th>Resultado</th><th>Operador</th></tr></thead><tbody>${rec.map(i=>`<tr><td class="mono">${safe(i.endereco)}</td><td>${safe(i.produtoEsperado||i.produto_esperado||i.dunEsperado||i.dun_esperado||'—')}</td><td>${safe(i.produtoLido||i.produto_lido||i.dunLido||i.dun_lido||'—')}</td><td><span class="badge ${audStatus(i)==='OK'?'ok':audStatus(i)==='DIVERGENTE'?'err':'warn'}">${audStatus(i)}</span></td><td>${safe(i.operadorNome||i.operador_nome||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><div class="empty-title">Nenhum resultado</div></div>';}const alert=document.getElementById('dash-alert-wrap');if(alert)alert.innerHTML=div?`<div class="alert warn"><b>⚠️ ${div} divergência(s)</b> identificadas. Clique nos gráficos para detalhar.</div>`:`<div class="alert ok"><b>✅ Nenhuma divergência</b> nos filtros atuais.</div>`;};
  const oldAlterar=window.alterarModoDashboard;window.alterarModoDashboard=function(m){if(m==='inventario'){const k=document.getElementById('kpi-grid');if(k)k.style.display='';const b=document.getElementById('dash-breakdown-grid');if(b)b.style.display='';}return oldAlterar?.(m);};
  document.addEventListener('DOMContentLoaded',()=>{ensureHero();const tipo=document.getElementById('acomp-tipo');if(tipo)tipo.value='inventario';});
})();
