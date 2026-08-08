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
  const normEnd = function(v){ return norm(v).replace(/\s+/g,'').toUpperCase(); };
  let _enderecosRefLocal=null, _enderecosMapLocal=null;
  const enderecoInfo = function(endereco){
    const lista=st().enderecosLista||[];
    if(_enderecosRefLocal!==lista){
      _enderecosRefLocal=lista;
      _enderecosMapLocal=new Map();
      lista.forEach(function(e){
        const chave=normEnd(e && (e.endereco || e.codigo || e.id));
        if(chave && !_enderecosMapLocal.has(chave)) _enderecosMapLocal.set(chave,e);
      });
    }
    return (_enderecosMapLocal && _enderecosMapLocal.get(normEnd(endereco))) || null;
  };
  const local = function(x){
    const direto=norm(x && (x.nome_local || x.local_area || x.local_estoque || x.descricao_local_estoque || x.setor || x.local));
    if(direto && direto.toUpperCase()!=='SEM LOCAL' && direto.toUpperCase()!=='SEM_LOCAL') return direto;
    const e=enderecoInfo(x && x.endereco);
    return norm(e && (e.nome_local || e.local_area || e.local_estoque || e.descricao_local_estoque || e.setor || e.local || e.area)) || 'SEM LOCAL';
  };
  const rua = function(x){ return norm(x.rua || global.extrairRua(x.endereco) || 'SEM RUA'); };
  let relDivRowsFiltradas=[];
  let produtividadeRowsFiltradas=[];
  let produtividadeHoraSelecionada=null;
  let produtividadeOperadorSelecionado='';

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
    const teto=Math.max(1,Math.ceil(max/4)*4),linhas=[0,1,2,3,4].map(function(n){return Math.round(teto*n/4);});
    const colunas='<div class="dash-column-legend"><span><i style="background:#2563eb"></i>Endereços</span><span><i style="background:#f97316"></i>Contagens</span></div><div class="dash-column-scroll"><div class="dash-column-chart" style="--chart-count:'+top.length+';min-width:max(520px,calc('+top.length+' * 92px))"><div class="dash-y-axis">'+linhas.map(function(v,i){return '<span style="bottom:'+(i*25)+'%">'+v+'</span>';}).join('')+'</div><div class="dash-grid-lines">'+linhas.map(function(_,i){return '<i style="bottom:'+(i*25)+'%"></i>';}).join('')+'</div><div class="dash-column-groups">'+top.map(function(x,i){const he=x.enderecos.size?Math.max(4,Math.round(x.enderecos.size/teto*100)):0,hc=x.contagens?Math.max(4,Math.round(x.contagens/teto*100)):0,sel=produtividadeOperadorSelecionado===x.nome;return '<button type="button" class="dash-column-group'+(sel?' acomp-chart-selected':'')+'" onclick="filtrarProdutividadeOperador('+JSON.stringify(x.nome).replace(/"/g,'&quot;')+')" title="Filtrar por '+esc(x.nome)+'"><span class="dash-columns"><i class="dash-column auditados" style="height:'+he+'%"><b>'+x.enderecos.size+'</b></i><i class="dash-column" style="height:'+hc+'%;background:linear-gradient(180deg,#fb923c,#f97316)"><b>'+x.contagens+'</b></i></span><span class="dash-column-label"><em>'+(i+1)+'º</em> '+esc(x.nome)+'</span></button>';}).join('')+'</div></div></div>';
    const horas=Array.from({length:24},function(_,h){return {h:h,n:0};});cont.forEach(function(c){const d=when(c);if(d)horas[d.getHours()].n++;});const maxHora=Math.max.apply(null,horas.map(function(x){return x.n;}).concat([1]));
    const barrasHora=horas.map(function(x){const alt=Math.max(8,Math.round(x.n/maxHora*100)),ativo=x.n>0,sel=produtividadeHoraSelecionada===x.h;return '<button type="button" onclick="filtrarProdutividadeHora('+x.h+')" title="'+String(x.h).padStart(2,'0')+':00 · '+x.n+' contagem(ns)" style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:28px;border:0;background:'+(sel?'var(--orange-soft)':'transparent')+';cursor:pointer;border-radius:10px;padding:5px 2px"><div style="height:126px;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end"><strong style="height:18px;font-family:var(--mono);font-size:.68rem;line-height:18px;color:'+(ativo?(sel?'var(--orange)':'var(--text)'):'transparent')+'">'+x.n+'</strong><div style="height:108px;width:100%;display:flex;align-items:flex-end;justify-content:center"><div style="width:100%;max-width:22px;height:'+(ativo?alt:8)+'%;border-radius:8px 8px 4px 4px;background:'+(ativo?'linear-gradient(180deg,var(--orange-h),var(--orange))':'var(--border)')+';box-shadow:'+(ativo?'0 4px 10px rgba(242,124,22,.18)':'none')+'"></div></div></div><div style="font-size:.61rem;font-family:var(--mono);color:'+(sel?'var(--orange)':'var(--muted)')+'">'+String(x.h).padStart(2,'0')+'</div></button>';}).join('');
    const locaisMap={};cont.forEach(function(c){const k=local(c);locaisMap[k]=(locaisMap[k]||0)+1;});
    const locais=Object.keys(locaisMap).map(function(k){return {nome:k,total:locaisMap[k]};}).sort(function(a,b){return b.total-a.total;}).slice(0,12);
    const maxLocal=Math.max.apply(null,locais.map(function(x){return x.total;}).concat([1]));
    const barrasLocais=locais.map(function(x){return '<div style="display:grid;grid-template-columns:minmax(120px,220px) 1fr 54px;gap:10px;align-items:center"><strong style="font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(x.nome)+'">'+esc(x.nome)+'</strong><div style="height:18px;background:var(--surface-3);border-radius:999px;overflow:hidden"><div style="height:100%;width:'+Math.max(3,Math.round(x.total/maxLocal*100))+'%;background:linear-gradient(90deg,#2563eb,#60a5fa);border-radius:999px"></div></div><span style="font-family:var(--mono);font-size:.72rem;text-align:right">'+x.total+'</span></div>';}).join('');
    const total=cont.length,recs=rows.reduce(function(a,x){return a+x.recontagens;},0),divs=rows.reduce(function(a,x){return a+x.divs;},0),normais=Math.max(0,total-recs),pct=total?Math.round(normais/total*100):0,pctRec=total?Math.round(recs/total*100):0;
    const filtroAtivo=produtividadeHoraSelecionada!==null||produtividadeOperadorSelecionado;
    wrap.innerHTML=(filtroAtivo?'<div class="alert info" style="margin:0 0 12px"><b>Filtro do gráfico:</b> '+(produtividadeHoraSelecionada!==null?String(produtividadeHoraSelecionada).padStart(2,'0')+':00–'+String((produtividadeHoraSelecionada+1)%24).padStart(2,'0')+':00':'todos os horários')+(produtividadeOperadorSelecionado?' · '+esc(produtividadeOperadorSelecionado):'')+' <button class="btn btn-ghost btn-sm" onclick="limparFiltroProdutividadeGrafico()" style="margin-left:8px">✕ Limpar</button></div>':'')+'<div style="display:grid;grid-template-columns:1.35fr .65fr;gap:16px;margin-bottom:16px"><div class="tc"><div class="tc-header"><div><div class="tc-title">🏆 Desempenho por Operador</div><div class="sec-sub">Clique em um operador para simplificar todos os dados</div></div></div><div style="padding:14px">'+colunas+'</div></div><div class="tc"><div class="tc-header"><div><div class="tc-title">📊 Composição das Contagens</div><div class="sec-sub">Resultado do filtro atual</div></div></div><div style="padding:18px;display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div style="width:170px;height:170px;border-radius:50%;background:conic-gradient(#2563eb 0 '+pct+'%,#f97316 '+pct+'% '+(pct+pctRec)+'%,#ef4444 '+(pct+pctRec)+'% 100%);display:flex;align-items:center;justify-content:center;margin:auto"><div style="width:108px;height:108px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center"><strong style="font-family:var(--mono);font-size:1.55rem">'+total.toLocaleString('pt-BR')+'</strong><small style="color:var(--muted)">contagens</small></div></div><div style="flex:1;min-width:150px;display:grid;gap:8px"><div><b style="color:#2563eb">● '+normais+'</b> normais</div><div><b style="color:#f97316">● '+recs+'</b> recontagens</div><div><b style="color:#ef4444">● '+divs+'</b> conflitos</div></div></div></div></div><div class="tc" style="margin-bottom:16px"><div class="tc-header"><div><div class="tc-title">⏱️ Contagens por Hora</div><div class="sec-sub">Colunas verticais · clique no horário para filtrar operadores e detalhes</div></div></div><div style="padding:18px 16px 12px;overflow-x:auto"><div style="display:flex;gap:8px;align-items:flex-end;min-width:720px">'+barrasHora+'</div></div></div><div class="tc" style="margin-bottom:16px"><div class="tc-header"><div><div class="tc-title">🏭 Acompanhamento por Local de Estoque</div><div class="sec-sub">Barras horizontais no padrão do Dashboard</div></div></div><div style="padding:18px;display:grid;gap:10px">'+(barrasLocais||'<div class="empty"><div class="empty-title">Sem locais no filtro</div></div>')+'</div></div>';
  }

  global.filtrarProdutividadeHora=function(h){produtividadeHoraSelecionada=produtividadeHoraSelecionada===h?null:h;global.renderProdutividade();};
  global.filtrarProdutividadeOperador=function(nome){produtividadeOperadorSelecionado=produtividadeOperadorSelecionado===nome?'':nome;global.renderProdutividade();};
  global.limparFiltroProdutividadeGrafico=function(){produtividadeHoraSelecionada=null;produtividadeOperadorSelecionado='';global.renderProdutividade();};

  global.renderProdutividade = function(){
    const s=st(); let cont=(global.AnalistaDivergenciasRuntime?.fotografiaFisicaAtual?.() || (s.contagens||[])).slice(); const inv=val('prod-inv'), r=val('prod-rua'), l=val('prod-local'), periodo=val('prod-periodo');
    fillSelect('prod-inv',(s.inventarios||[]).map(function(i){return i.id;}),'Todos os inventários');
    fillSelect('prod-rua',cont.map(rua),'Todas as ruas'); fillSelect('prod-local',cont.map(local),'Todos os locais');
    const now=Date.now(), days=periodo==='hoje'?1:periodo==='7d'?7:periodo==='30d'?30:0;
    cont=cont.filter(function(c){ const d=when(c); return (!inv||c.inventario_id===inv)&&(!r||rua(c)===r)&&(!l||local(c)===l)&&(!days||d&&now-d.getTime()<=days*86400000)&&(produtividadeHoraSelecionada===null||d&&d.getHours()===produtividadeHoraSelecionada)&&(!produtividadeOperadorSelecionado||operador(c)===produtividadeOperadorSelecionado); });
    const map={}; cont.forEach(function(c){ const op=operador(c); if(!map[op]) map[op]={nome:op,contagens:0,enderecos:new Set(),produtos:new Set(),recontagens:0,divs:0}; const x=map[op]; x.contagens++; if(c.endereco)x.enderecos.add(c.endereco); x.produtos.add(produto(c)); if(c.rodada>1||c.tipo_contagem==='RECONTAGEM')x.recontagens++; });
    (s.divergencias||[]).forEach(function(d){ const op=operador(d); if(map[op]) map[op].divs++; });
    const rows=Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return b.enderecos.size-a.enderecos.size||b.contagens-a.contagens;});
    produtividadeRowsFiltradas=rows.slice();
    setText('pk-prod-operadores',rows.length); setText('pk-prod-ends',new Set(cont.map(function(c){return c.endereco;}).filter(Boolean)).size); setText('pk-prod-conts',cont.length); setText('pk-prod-prods',new Set(cont.map(produto)).size); setText('pk-prod-divs',rows.reduce(function(a,x){return a+x.divs;},0)); setText('pk-prod-recs',rows.reduce(function(a,x){return a+x.recontagens;},0));
    renderProdutividadeGraficos(rows,cont);
    const wrap=document.getElementById('produtividade-table-wrap'); if(!wrap)return;
    if(!rows.length){wrap.innerHTML='<div class="empty"><div class="empty-icon">🏆</div><div class="empty-title">Nenhuma contagem registrada</div><div class="empty-sub">Os dados aparecerão após as contagens.</div></div>';return;}
    wrap.innerHTML='<div class="operacao-grade-fixa"><table><colgroup><col style="width:8%"><col style="width:28%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:12%"></colgroup><thead><tr><th>Posição</th><th>Operador</th><th>Endereços</th><th>Contagens</th><th>Produtos</th><th>Conflitos</th><th>Recontagens</th></tr></thead><tbody>'+rows.map(function(x,i){return '<tr><td>'+(i+1)+'º</td><td><strong>'+esc(x.nome)+'</strong></td><td>'+x.enderecos.size+'</td><td>'+x.contagens+'</td><td>'+x.produtos.size+'</td><td>'+x.divs+'</td><td>'+x.recontagens+'</td></tr>';}).join('')+'</tbody></table></div>';
  };

  global.renderCapasDuplicadas = function(){
    const s=st(), inv=val('cd-fil-inv'), q=val('cd-busca').toLowerCase(); let cont=(global.AnalistaDivergenciasRuntime?.fotografiaFisicaAtual?.() || (s.contagens||[])).filter(function(c){return norm(c.capa||c.capa_palete||c.capaPalete);});
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
  global.exportarCapasDuplicadas=global.exportarCapasDuplicadas||function(){const s=st(),groups={};(global.AnalistaDivergenciasRuntime?.fotografiaFisicaAtual?.() || (s.contagens||[])).forEach(function(c){const cp=norm(c.capa||c.capa_palete||c.capaPalete);if(cp)(groups[cp]||(groups[cp]=[])).push(c);});const rows=[];Object.keys(groups).forEach(function(cp){if(new Set(groups[cp].map(function(x){return x.inventario_id+'|'+x.endereco;})).size>1)groups[cp].forEach(function(x){rows.push([cp,invName(x.inventario_id),x.endereco,operador(x)]);});});exportSimple('capas-duplicadas.csv',['Capa','Inventário','Endereço','Operador'],rows);};
})(window);
