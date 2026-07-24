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

  global.renderProdutividade = function(){
    const s=st(); let cont=(s.contagens||[]).slice(); const inv=val('prod-inv'), r=val('prod-rua'), l=val('prod-local'), periodo=val('prod-periodo');
    fillSelect('prod-inv',(s.inventarios||[]).map(function(i){return i.id;}),'Todos os inventários');
    fillSelect('prod-rua',cont.map(rua),'Todas as ruas'); fillSelect('prod-local',cont.map(local),'Todos os locais');
    const now=Date.now(), days=periodo==='hoje'?1:periodo==='7d'?7:periodo==='30d'?30:0;
    cont=cont.filter(function(c){ const d=when(c); return (!inv||c.inventario_id===inv)&&(!r||rua(c)===r)&&(!l||local(c)===l)&&(!days||d&&now-d.getTime()<=days*86400000); });
    const map={}; cont.forEach(function(c){ const op=operador(c); if(!map[op]) map[op]={nome:op,contagens:0,enderecos:new Set(),produtos:new Set(),recontagens:0,divs:0}; const x=map[op]; x.contagens++; if(c.endereco)x.enderecos.add(c.endereco); x.produtos.add(produto(c)); if(c.rodada>1||c.tipo_contagem==='RECONTAGEM')x.recontagens++; });
    (s.divergencias||[]).forEach(function(d){ const op=operador(d); if(map[op]) map[op].divs++; });
    const rows=Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return b.enderecos.size-a.enderecos.size||b.contagens-a.contagens;});
    setText('pk-prod-operadores',rows.length); setText('pk-prod-ends',new Set(cont.map(function(c){return c.endereco;}).filter(Boolean)).size); setText('pk-prod-conts',cont.length); setText('pk-prod-prods',new Set(cont.map(produto)).size); setText('pk-prod-divs',rows.reduce(function(a,x){return a+x.divs;},0)); setText('pk-prod-recs',rows.reduce(function(a,x){return a+x.recontagens;},0));
    const cards=document.getElementById('prod-ranking-cards'); if(cards) cards.innerHTML=rows.slice(0,10).map(function(x,i){return '<div class="card" style="min-width:180px;flex:1;padding:14px"><div style="font-size:1.2rem">'+(['🥇','🥈','🥉'][i]||(i+1)+'º')+'</div><strong>'+esc(x.nome)+'</strong><div style="font-size:.76rem;color:var(--muted);margin-top:5px">'+x.enderecos.size+' endereços · '+x.contagens+' contagens</div></div>';}).join('')||'<div class="empty" style="width:100%"><div class="empty-title">Nenhuma contagem registrada</div></div>';
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
  global.exportarRelDivergencias=global.exportarRelDivergencias||function(){const s=st();exportSimple('relatorio-conflitos.csv',['Inventário','Endereço','Produto','Tipo','Status','Operador'],(s.divergencias||[]).map(function(d){return [invName(d.inventario_id),d.endereco,produto(d),d.tipo||d.tipo_divergencia,d.status,operador(d)];}));};
  global.exportarProdutividade=global.exportarProdutividade||function(){global.renderProdutividade(); const rows=[]; document.querySelectorAll('#produtividade-table-wrap tbody tr').forEach(function(tr){rows.push(Array.from(tr.cells).map(function(td){return td.textContent.trim();}));});exportSimple('produtividade-operadores.csv',['Posição','Operador','Endereços','Contagens','Produtos','Conflitos','Recontagens'],rows);};
  global.exportarCapasDuplicadas=global.exportarCapasDuplicadas||function(){const s=st(),groups={};(s.contagens||[]).forEach(function(c){const cp=norm(c.capa||c.capa_palete||c.capaPalete);if(cp)(groups[cp]||(groups[cp]=[])).push(c);});const rows=[];Object.keys(groups).forEach(function(cp){if(new Set(groups[cp].map(function(x){return x.inventario_id+'|'+x.endereco;})).size>1)groups[cp].forEach(function(x){rows.push([cp,invName(x.inventario_id),x.endereco,operador(x)]);});});exportSimple('capas-duplicadas.csv',['Capa','Inventário','Endereço','Operador'],rows);};
})(window);
