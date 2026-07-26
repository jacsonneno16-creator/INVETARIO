// Relatórios gerenciais, produtividade e capas duplicadas.
(function(global){
  'use strict';

  const esc = global.escHTML || function(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); };
  const st = function(){ return global.AnalistaStore && global.AnalistaStore.getState ? global.AnalistaStore.getState() : (global.AnalistaBootstrap && global.AnalistaBootstrap.getState ? global.AnalistaBootstrap.getState() : {}); };
  const setText = function(id,v){ const el=document.getElementById(id); if(el) el.textContent=String(v == null ? 0 : v); };
  const val = function(id){ const el=document.getElementById(id); return el ? String(el.value||'') : ''; };
  const norm = function(v){ return String(v == null ? '' : v).trim(); };
  const when = function(x){
    const raw=x && (x.criado_em || x.data_hora || x.timestamp || x.atualizado_em || x.finalizado_em || x.data);
    if(!raw) return null;
    if(raw.toDate) return raw.toDate();
    const d=new Date(raw); return isNaN(d.getTime()) ? null : d;
  };
  const invName = function(id){ const i=(st().inventarios||[]).find(function(x){return x.id===id;}); return i ? (i.nome||i.titulo||i.id) : (id||'—'); };
  const operador = function(x){ return norm(x.operador_nome || x.operador || x.usuario_nome || x.usuario || x.email_operador || 'Não informado'); };
  const produto = function(x){ return norm(x.produto_nome || x.produto || x.descricao || x.gtin || x.dun || x.codigo_produto || '—'); };
  const local = function(x){ return norm(x.local || x.setor || x.nome_local || x.local_estoque || 'SEM LOCAL'); };
  const rua = function(x){ return norm(x.rua || global.extrairRua(x.endereco) || 'SEM RUA'); };
  let relDivRowsFiltradas=[];
  let produtividadeRowsFiltradas=[];

  // Estrutura do endereço: loja.local.area.rua.coluna.nivel.sequencia (separado por ponto).
  // A rua é sempre a 4ª parte (índice 3). Antes esta função pegava o 1º token (código da
  // loja) e por isso todos os endereços apareciam agrupados como se fossem da mesma rua.
  global.extrairRua = global.extrairRua || function(endereco){
    const p=global.DTEnderecos?.partes(endereco);
    return p?.rua ? String(p.rua).toUpperCase() : '';
  };

  function fillSelect(id, items, first){
    const el=document.getElementById(id); if(!el) return;
    const current=el.value;
    const uniq=Array.from(new Set(items.filter(Boolean))).sort(function(a,b){return String(a).localeCompare(String(b),'pt-BR',{numeric:true});});
    el.innerHTML='<option value="">'+first+'</option>'+uniq.map(function(x){return '<option value="'+esc(x)+'">'+esc(x)+'</option>';}).join('');
    if(uniq.indexOf(current)>=0) el.value=current;
  }

  global.renderRelDivergencias = function(){
    const s=st(); let rows=(s.divergencias||[]).slice();
    fillSelect('reldiv-inv',(s.inventarios||[]).map(function(i){return i.id;}),'Todos os inventários');
    fillSelect('reldiv-local',rows.map(local),'Todos os locais');
    fillSelect('reldiv-rua',rows.map(rua),'Todas as ruas');
    fillSelect('reldiv-operador',rows.map(operador),'Todos os operadores');
    const q=val('reldiv-busca').toLowerCase(), fi=val('reldiv-inv'), fs=val('reldiv-status'), ft=val('reldiv-tipo'), fl=val('reldiv-local'), fr=val('reldiv-rua'), fo=val('reldiv-operador');
    rows=rows.filter(function(d){
      const tipo=norm(d.tipo||d.tipo_divergencia).toUpperCase();
      return (!fi||d.inventario_id===fi)&&(!fs||norm(d.status).toUpperCase()===fs)&&(!ft||tipo===ft)&&(!fl||local(d)===fl)&&(!fr||rua(d)===fr)&&(!fo||operador(d)===fo)&&(!q||[d.endereco,produto(d),operador(d),tipo,d.status].join(' ').toLowerCase().indexOf(q)>=0);
    });
    relDivRowsFiltradas=rows.slice();
    const all=s.divergencias||[];
    setText('rdk-total',all.length); setText('rdk-abertas',all.filter(function(x){return norm(x.status).toUpperCase()==='ABERTA';}).length);
    setText('rdk-em-rec',all.filter(function(x){return norm(x.status).toUpperCase()==='EM_RECONTAGEM';}).length);
    setText('rdk-resolvidas',all.filter(function(x){return norm(x.status).toUpperCase()==='RESOLVIDA';}).length);
    setText('rdk-persistentes',all.filter(function(x){return norm(x.status).toUpperCase()==='PERSISTENTE';}).length);
    setText('rdk-faltas',all.filter(function(x){return norm(x.tipo||x.tipo_divergencia).toUpperCase()==='FALTA';}).length);
    setText('rdk-sobras',all.filter(function(x){return norm(x.tipo||x.tipo_divergencia).toUpperCase()==='SOBRA';}).length);
    const wrap=document.getElementById('reldiv-table-wrap'); if(!wrap) return;
    if(!rows.length){ wrap.innerHTML='<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhum conflito encontrado</div><div class="empty-sub">Não há registros para os filtros selecionados.</div></div>'; return; }
    wrap.innerHTML='<div style="overflow:auto"><table><thead><tr><th>Inventário</th><th>Endereço</th><th>Produto</th><th>Tipo</th><th>Status</th><th>Operador</th><th>Data</th></tr></thead><tbody>'+rows.map(function(d){const dt=when(d);return '<tr><td>'+esc(invName(d.inventario_id))+'</td><td><strong>'+esc(d.endereco||'—')+'</strong></td><td>'+esc(produto(d))+'</td><td>'+esc(d.tipo||d.tipo_divergencia||'—')+'</td><td>'+esc(d.status||'ABERTA')+'</td><td>'+esc(operador(d))+'</td><td>'+esc(dt?dt.toLocaleString('pt-BR'):'—')+'</td></tr>';}).join('')+'</tbody></table></div>';
  };

  function renderProdutividadeGraficos(rows,cont){
    const wrap=document.getElementById('prod-graficos-wrap'); if(!wrap)return;
    if(!rows.length){wrap.innerHTML='<div class="empty"><div class="empty-icon">📊</div><div class="empty-title">Nenhuma contagem registrada</div><div class="empty-sub">Os gráficos aparecerão após as contagens.</div></div>';return;}
    const top=rows.slice(0,10), max=Math.max.apply(null,top.map(function(x){return Math.max(x.enderecos.size,x.contagens);}).concat([1]));
    const colunas='<div class="dash-column-legend"><span><i style="background:#2563eb"></i>Endereços</span><span><i style="background:#f97316"></i>Contagens</span></div><div class="dash-column-scroll"><div class="dash-column-chart" style="--chart-count:'+top.length+';min-width:max(520px,calc('+top.length+' * 92px))">'+top.map(function(x,i){const he=Math.max(x.enderecos.size?8:2,Math.round(x.enderecos.size/max*100)),hc=Math.max(x.contagens?8:2,Math.round(x.contagens/max*100));return '<div class="dash-column-group" title="'+esc(x.nome)+': '+x.enderecos.size+' endereços e '+x.contagens+' contagens"><div class="dash-column-value-row"><span>'+x.enderecos.size+'</span><span>'+x.contagens+'</span></div><div class="dash-column-bars"><i class="dash-column-bar audited" style="height:'+he+'%"></i><i class="dash-column-bar" style="height:'+hc+'%;background:#f97316"></i></div><strong class="dash-column-label">'+esc((i+1)+'º '+x.nome)+'</strong><small>'+x.produtos.size+' produto(s)</small></div>';}).join('')+'</div></div>';
    const horas=Array.from({length:24},function(_,h){return {h:h,n:0};});cont.forEach(function(c){const d=when(c);if(d)horas[d.getHours()].n++;});const maxHora=Math.max.apply(null,horas.map(function(x){return x.n;}).concat([1]));
    const barrasHora=horas.map(function(x){const alt=Math.max(8,Math.round(x.n/maxHora*100)),ativo=x.n>0;return '<div title="'+String(x.h).padStart(2,'0')+':00 · '+x.n+' contagem(ns)" style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0"><div style="height:110px;width:100%;display:flex;align-items:flex-end;justify-content:center"><div style="width:100%;max-width:22px;height:'+(ativo?alt:8)+'%;border-radius:8px 8px 4px 4px;background:'+(ativo?'linear-gradient(180deg,var(--orange-h),var(--orange))':'var(--border)')+'"></div></div><div style="font-size:.61rem;font-family:var(--mono);color:var(--muted)">'+String(x.h).padStart(2,'0')+'</div></div>';}).join('');
    const total=cont.length,recs=rows.reduce(function(a,x){return a+x.recontagens;},0),divs=rows.reduce(function(a,x){return a+x.divs;},0),normais=Math.max(0,total-recs),pct=total?Math.round(normais/total*100):0,pctRec=total?Math.round(recs/total*100):0;
    wrap.innerHTML='<div style="display:grid;grid-template-columns:1.35fr .65fr;gap:16px;margin-bottom:16px"><div class="tc"><div class="tc-header"><div><div class="tc-title">🏆 Desempenho por Operador</div><div class="sec-sub">Endereços únicos e volume total de contagens</div></div></div><div style="padding:14px">'+colunas+'</div></div><div class="tc"><div class="tc-header"><div><div class="tc-title">📊 Composição das Contagens</div><div class="sec-sub">Resultado do filtro atual</div></div></div><div style="padding:18px;display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div style="width:170px;height:170px;border-radius:50%;background:conic-gradient(#2563eb 0 '+pct+'%,#f97316 '+pct+'% '+(pct+pctRec)+'%,#ef4444 '+(pct+pctRec)+'% 100%);display:flex;align-items:center;justify-content:center;margin:auto"><div style="width:108px;height:108px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center"><strong style="font-family:var(--mono);font-size:1.55rem">'+total.toLocaleString('pt-BR')+'</strong><small style="color:var(--muted)">contagens</small></div></div><div style="flex:1;min-width:150px;display:grid;gap:8px"><div><b style="color:#2563eb">● '+normais+'</b> normais</div><div><b style="color:#f97316">● '+recs+'</b> recontagens</div><div><b style="color:#ef4444">● '+divs+'</b> conflitos</div></div></div></div></div><div class="tc" style="margin-bottom:16px"><div class="tc-header"><div><div class="tc-title">⏱️ Contagens por Hora</div><div class="sec-sub">Distribuição do movimento operacional ao longo do dia</div></div></div><div style="padding:18px 16px 12px"><div style="display:flex;gap:8px;align-items:flex-end">'+barrasHora+'</div></div></div>';
  }

  global.renderProdutividade = function(){
    const s=st(); let cont=(s.contagens||[]).slice(); const inv=val('prod-inv'), r=val('prod-rua'), l=val('prod-local'), periodo=val('prod-periodo');
    fillSelect('prod-inv',(s.inventarios||[]).map(function(i){return i.id;}),'Todos os inventários');
    fillSelect('prod-rua',cont.map(rua),'Todas as ruas'); fillSelect('prod-local',cont.map(local),'Todos os locais');
    const now=Date.now(), days=periodo==='hoje'?1:periodo==='7d'?7:periodo==='30d'?30:0;
    cont=cont.filter(function(c){ const d=when(c); return (!inv||c.inventario_id===inv)&&(!r||rua(c)===r)&&(!l||local(c)===l)&&(!days||d&&now-d.getTime()<=days*86400000); });
    const map={}; cont.forEach(function(c){ const op=operador(c); if(!map[op]) map[op]={nome:op,contagens:0,enderecos:new Set(),produtos:new Set(),recontagens:0,divs:0}; const x=map[op]; x.contagens++; if(c.endereco)x.enderecos.add(c.endereco); x.produtos.add(produto(c)); if(c.rodada>1||c.tipo_contagem==='RECONTAGEM')x.recontagens++; });
    (s.divergencias||[]).forEach(function(d){ const op=operador(d); if(map[op]) map[op].divs++; });
    const rows=Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return b.enderecos.size-a.enderecos.size||b.contagens-a.contagens;});
    produtividadeRowsFiltradas=rows.slice();
    setText('pk-prod-operadores',rows.length); setText('pk-prod-ends',new Set(cont.map(function(c){return c.endereco;}).filter(Boolean)).size); setText('pk-prod-conts',cont.length); setText('pk-prod-prods',new Set(cont.map(produto)).size); setText('pk-prod-divs',rows.reduce(function(a,x){return a+x.divs;},0)); setText('pk-prod-recs',rows.reduce(function(a,x){return a+x.recontagens;},0));
    renderProdutividadeGraficos(rows,cont);
    const wrap=document.getElementById('produtividade-table-wrap'); if(!wrap)return;
    if(!rows.length){wrap.innerHTML='<div class="empty"><div class="empty-icon">🏆</div><div class="empty-title">Nenhuma contagem registrada</div><div class="empty-sub">Os dados aparecerão após as contagens.</div></div>';return;}
    wrap.innerHTML='<div style="overflow:auto"><table><thead><tr><th>Posição</th><th>Operador</th><th>Endereços</th><th>Contagens</th><th>Produtos</th><th>Conflitos</th><th>Recontagens</th></tr></thead><tbody>'+rows.map(function(x,i){return '<tr><td>'+(i+1)+'º</td><td><strong>'+esc(x.nome)+'</strong></td><td>'+x.enderecos.size+'</td><td>'+x.contagens+'</td><td>'+x.produtos.size+'</td><td>'+x.divs+'</td><td>'+x.recontagens+'</td></tr>';}).join('')+'</tbody></table></div>';
  };

  global.renderCapasDuplicadas = function(){
    const s=st(), inv=val('cd-fil-inv'), q=val('cd-busca').toLowerCase(); let cont=(s.contagens||[]).filter(function(c){return norm(c.capa||c.capa_palete||c.capaPalete);});
    fillSelect('cd-fil-inv',(s.inventarios||[]).map(function(i){return i.id;}),'Todos os inventários');
    const groups={}; cont.forEach(function(c){const capa=norm(c.capa||c.capa_palete||c.capaPalete);(groups[capa]||(groups[capa]=[])).push(c);});
    let rows=Object.keys(groups).map(function(c){return {capa:c,itens:groups[c]};}).filter(function(g){return new Set(g.itens.map(function(x){return [x.inventario_id,x.endereco].join('|');})).size>1;});
    const all=rows.slice(); rows=rows.filter(function(g){return (!inv||g.itens.some(function(x){return x.inventario_id===inv;}))&&(!q||[g.capa].concat(g.itens.map(function(x){return x.endereco+' '+invName(x.inventario_id);})).join(' ').toLowerCase().indexOf(q)>=0);});
    setText('cd-kpi-total',all.length); setText('cd-kpi-ocorrencias',all.reduce(function(a,g){return a+g.itens.length;},0)); setText('cd-kpi-multiinv',all.filter(function(g){return new Set(g.itens.map(function(x){return x.inventario_id;})).size>1;}).length);
    const wrap=document.getElementById('cd-table-wrap'); if(!wrap)return;
    if(!rows.length){wrap.innerHTML='<div class="empty"><div class="empty-icon">🪪</div><div class="empty-title">Nenhuma capa duplicada</div><div class="empty-sub">Não foram encontradas capas repetidas.</div></div>';return;}
    wrap.innerHTML='<div style="overflow:auto"><table><thead><tr><th>Capa</th><th>Ocorrências</th><th>Inventários / Endereços</th><th>Operadores</th></tr></thead><tbody>'+rows.map(function(g){return '<tr><td><strong>'+esc(g.capa)+'</strong></td><td>'+g.itens.length+'</td><td>'+g.itens.map(function(x){return esc(invName(x.inventario_id)+' — '+(x.endereco||'—'));}).join('<br>')+'</td><td>'+Array.from(new Set(g.itens.map(operador))).map(esc).join('<br>')+'</td></tr>';}).join('')+'</tbody></table></div>';
  };
  global.renderCausasDuplicadas = global.renderCapasDuplicadas;

  function exportSimple(filename, headers, rows){
    const csv='\ufeff'+[headers].concat(rows).map(function(r){return r.map(function(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}).join(';');}).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download=filename; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},500);
  }
  function exportXlsx(filename, sheet, rows){
    if(!global.XLSX){ if(global.showToast) global.showToast('Biblioteca Excel não carregada.','e'); return; }
    if(!rows.length){ if(global.showToast) global.showToast('Não há dados nos filtros atuais para exportar.','w'); return; }
    const ws=global.XLSX.utils.json_to_sheet(rows), wb=global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb,ws,sheet.substring(0,31));
    global.XLSX.writeFile(wb,filename);
  }
  global.exportarRelDivergencias=function(){
    global.renderRelDivergencias();
    exportXlsx('relatorio-conflitos-filtrado.xlsx','Conflitos',relDivRowsFiltradas.map(function(d){const dt=when(d);return {'Inventário':invName(d.inventario_id),'Endereço':d.endereco||'','Rua':rua(d),'Local':local(d),'Produto':produto(d),'Tipo':d.tipo||d.tipo_divergencia||'','Status':d.status||'','Operador':operador(d),'Data':dt?dt.toLocaleString('pt-BR'):''};}));
  };
  global.exportarProdutividade=function(){
    global.renderProdutividade();
    exportXlsx('produtividade-operadores-filtrada.xlsx','Produtividade',produtividadeRowsFiltradas.map(function(x,i){return {'Posição':i+1,'Operador':x.nome,'Endereços':x.enderecos.size,'Contagens':x.contagens,'Produtos':x.produtos.size,'Conflitos':x.divs,'Recontagens':x.recontagens};}));
  };
  global.exportarCapasDuplicadas=global.exportarCapasDuplicadas||function(){const s=st(),groups={};(s.contagens||[]).forEach(function(c){const cp=norm(c.capa||c.capa_palete||c.capaPalete);if(cp)(groups[cp]||(groups[cp]=[])).push(c);});const rows=[];Object.keys(groups).forEach(function(cp){if(new Set(groups[cp].map(function(x){return x.inventario_id+'|'+x.endereco;})).size>1)groups[cp].forEach(function(x){rows.push([cp,invName(x.inventario_id),x.endereco,operador(x)]);});});exportSimple('capas-duplicadas.csv',['Capa','Inventário','Endereço','Operador'],rows);};
})(window);
