(function(){
  'use strict';
  const COLORS=['#f97316','#2563eb','#10b981','#8b5cf6','#ef4444','#06b6d4','#eab308','#ec4899','#14b8a6','#6366f1'];
  const oldRenderAcompanhamento=window.renderAcompanhamentoInventarioBase || window.renderAcompanhamento;
  const oldTrocarInventarioAcomp=window.trocarInventarioAcomp;
  let acompAudItens=[], acompAudOcorrencias=[], acompAudMetas=[], acompAudLoja='';
  let acompInventarioAnterior='';
  let acompAudFiltro={tipo:'',valor:''};
  function safe(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function tipoAcomp(){return document.getElementById('acomp-tipo')?.value||'inventario';}
  // Estrutura: loja.local.area.rua.coluna.nivel.sequencia — rua=índice3, coluna=índice4, nível=índice5.
  function enderecoPartes(end){const p=window.DTEnderecos?.partes(end)||{};return {rua:String(p.rua||'SEM RUA').toUpperCase(),coluna:String(p.coluna||'SEM COLUNA').toUpperCase(),nivel:String(p.nivel||'SEM NÍVEL').toUpperCase()};}
  function audStatus(i){const s=String(i.status||'PENDENTE').toUpperCase();if(['APROVADO','CORRETO','CONFERIDO','FINALIZADO','CONFIRMADO_SEM_AJUSTE','OK'].includes(s))return'OK';if(['ERRO','CONFIRMADO_COM_AJUSTE','DIVERGENTE'].includes(s))return'DIVERGENTE';if(['VAZIO','ENDERECO_VAZIO'].includes(s))return'ENDERECO_VAZIO';return'PENDENTE';}
  function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
  function ensureHero(){let h=document.getElementById('acomp-live-hero');if(h)return h;h=document.createElement('div');h.id='acomp-live-hero';h.innerHTML='<div id="acomp-live-ring"><div id="acomp-live-value">0%</div></div><div><div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;opacity:.72">Progresso em tempo real</div><div id="acomp-live-title" style="font-size:1.15rem;font-weight:800;margin:5px 0">—</div><div id="acomp-live-detail" style="font-size:.75rem;opacity:.75">Aguardando seleção</div></div>';document.getElementById('acomp-kpis')?.before(h);return h;}
  function setHero(pct,title,detail,color2){ensureHero();const ring=document.getElementById('acomp-live-ring');if(ring)ring.style.background=`conic-gradient(${color2||'#f59e0b'} ${pct*3.6}deg,rgba(255,255,255,.16) 0)`;setText('acomp-live-value',pct+'%');setText('acomp-live-title',title);setText('acomp-live-detail',detail);}
  function rawDb(){return window.getDTRawFirestore?.()||null;}
  function lojaAtiva(){return String(window.getDTLojaAtiva?.()||'').trim();}
  function auditoriasRef(origem){
    const raw=rawDb(); if(!raw)return null;
    return origem==='raiz' ? raw.collection('dt_auditorias') : raw.collection('lojas').doc(lojaAtiva()).collection('dt_auditorias');
  }
  function audDocRef(metaOuId){
    const meta=typeof metaOuId==='object'?metaOuId:acompAudMetas.find(x=>x.id===metaOuId);
    const id=typeof metaOuId==='object'?metaOuId.id:metaOuId;
    const raw=rawDb(); if(!raw)return null;
    const origem=meta?meta._origem:'loja:'+lojaAtiva();
    if(origem==='raiz') return raw.collection('dt_auditorias').doc(id);
    if(String(origem).indexOf('loja:')===0) return raw.collection('lojas').doc(String(origem).slice(5)).collection('dt_auditorias').doc(id);
    return raw.collection('lojas').doc(lojaAtiva()).collection('dt_auditorias').doc(id);
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
    const raw=rawDb();
    if(!raw){acompAudMetas=[];acompAudLoja='';return;}
    const itens=[],vistos=new Set();
    async function add(ref,origem){
      try{const snap=await ref.get();snap.docs.forEach(d=>{if(vistos.has(d.id))return;vistos.add(d.id);itens.push({id:d.id,...d.data(),_origem:origem});});}
      catch(e){console.warn('[ACOMP AUD] Falha ao listar '+origem+':',e);}
    }
    if(loja) await add(raw.collection('lojas').doc(loja).collection('dt_auditorias'),'loja:'+loja);
    try{
      const ls=await raw.collection('lojas').get();
      for(const ld of ls.docs){if(ld.id!==loja)await add(raw.collection('lojas').doc(ld.id).collection('dt_auditorias'),'loja:'+ld.id);}
    }catch(e){console.warn('[ACOMP AUD] Falha ao procurar auditorias nas lojas:',e);}
    await add(raw.collection('dt_auditorias'),'raiz');
    acompAudMetas=itens.sort((a,b)=>{
      const av=a.criadoEm?.toMillis?.()||a.criadoEm?.seconds*1000||Date.parse(a.criadoEm||a.criado_em||0)||0;
      const bv=b.criadoEm?.toMillis?.()||b.criadoEm?.seconds*1000||Date.parse(b.criadoEm||b.criado_em||0)||0;
      return bv-av;
    });
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
    if(!id){acompAudItens=[];acompAudOcorrencias=[];renderAcompAuditoria();return;}
    const meta=acompAudMetas.find(m=>m.id===id);const ref=audDocRef(meta||id);if(!ref)return;
    const aplicar=async snap=>{acompAudItens=await montarItensAuditoria(ref,snap);renderAcompAuditoria();};
    try{
      const inicial=await ref.collection('enderecos').get();await aplicar(inicial);
      try{const oc=await ref.collection('ocorrencias').get();acompAudOcorrencias=oc.docs.map(d=>({id:d.id,...d.data()}));renderAcompAuditoria();}catch(e){acompAudOcorrencias=[];}
    }catch(e){console.error('[ACOMP AUD] Falha ao carregar acompanhamento:',e);acompAudItens=[];renderAcompAuditoria();}
  }
  function agrupar(lista,fn){const m={};lista.forEach(x=>{const k=fn(x)||'SEM DADO';m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
  const GRAD=['linear-gradient(90deg,#f97316,#fb923c)','linear-gradient(90deg,#2563eb,#38bdf8)','linear-gradient(90deg,#10b981,#34d399)','linear-gradient(90deg,#8b5cf6,#a78bfa)','linear-gradient(90deg,#ef4444,#fb7185)','linear-gradient(90deg,#06b6d4,#67e8f9)','linear-gradient(90deg,#eab308,#fde047)','linear-gradient(90deg,#ec4899,#f9a8d4)','linear-gradient(90deg,#14b8a6,#5eead4)','linear-gradient(90deg,#6366f1,#a5b4fc)'];
  function progressRows(arr,total){if(!arr.length)return '<div class="empty"><div class="empty-title">Sem dados para exibir</div></div>';return arr.map(([l,v],idx)=>{const pct=total?Math.round(v/total*100):0;return `<div style="display:grid;grid-template-columns:100px 1fr 55px;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><b style="font-size:.75rem">${safe(l)}</b><div class="prog"><div class="prog-fill" style="width:${pct}%;background:${GRAD[idx%GRAD.length]}"></div></div><span class="mono" style="font-size:.7rem;text-align:right">${v} · ${pct}%</span></div>`}).join('');}
  function jsArg(v){return String(v??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' ');}
  function acompFiltrados(){
    const f=acompAudFiltro;
    if(!f.tipo||!f.valor)return acompAudItens;
    return acompAudItens.filter(i=>{
      if(f.tipo==='status')return audStatus(i)===f.valor;
      if(f.tipo==='rua')return enderecoPartes(i.endereco).rua===f.valor;
      if(f.tipo==='nivel')return enderecoPartes(i.endereco).nivel===f.valor;
      if(f.tipo==='coluna')return enderecoPartes(i.endereco).coluna===f.valor;
      if(f.tipo==='operador')return String(i.operadorNome||i.operador_nome||i.operadorId||i.operador_id||'SEM OPERADOR')===f.valor;
      return true;
    });
  }
  function acompFiltroInfo(){
    if(!acompAudFiltro.tipo)return '';
    const nomes={status:'Resultado',rua:'Rua',nivel:'Nível',coluna:'Coluna',operador:'Operador'};
    return `<div class="acomp-aud-filter-active"><span>Filtro ativo: <b>${safe(nomes[acompAudFiltro.tipo]||acompAudFiltro.tipo)} — ${safe(acompAudFiltro.valor)}</b></span><button type="button" onclick="_acompAudChartClick('','')">✕ Limpar filtro</button></div>`;
  }
  function acompColumnChart(arr,tipo,limit){
    if(!arr.length)return '<div class="empty"><div class="empty-title">Sem dados para exibir</div><div class="empty-sub">Clique em Atualizar para carregar a auditoria selecionada.</div></div>';
    const dados=arr.slice(0,limit||12),max=Math.max(...dados.map(x=>Math.max(x.auditados,x.divergencias)),1),teto=Math.max(1,Math.ceil(max/4)*4);
    const linhas=[0,1,2,3,4].map(n=>Math.round(teto*n/4));
    return `<div class="dash-column-legend"><span><i class="auditados"></i>Auditados</span><span><i class="divergencias"></i>Divergências</span><small>Primeiro clique filtra; o segundo remove</small></div>
      <div class="dash-column-scroll"><div class="dash-column-chart" style="--chart-count:${dados.length}">
        <div class="dash-y-axis">${linhas.map((v,i)=>`<span style="bottom:${i*25}%">${v}</span>`).join('')}</div>
        <div class="dash-grid-lines">${linhas.map((_,i)=>`<i style="bottom:${i*25}%"></i>`).join('')}</div>
        <div class="dash-column-groups">${dados.map((x,idx)=>{
          const ativo=acompAudFiltro.tipo===tipo&&acompAudFiltro.valor===String(x.label);
          const ha=x.auditados?Math.max(4,x.auditados/teto*100):0,hd=x.divergencias?Math.max(4,x.divergencias/teto*100):0;
          return `<button type="button" class="dash-column-group${ativo?' acomp-chart-selected':''}" onclick="_acompAudChartClick('${tipo}','${jsArg(x.label)}')" title="${safe(x.label)}: ${x.auditados} auditados e ${x.divergencias} divergências">
            <span class="dash-columns"><i class="dash-column auditados" style="height:${ha}%"><b>${x.auditados}</b></i><i class="dash-column divergencias" style="height:${hd}%"><b>${x.divergencias}</b></i></span>
            <span class="dash-column-label"><em>${idx+1}.</em> ${safe(x.label)}</span>
          </button>`;
        }).join('')}</div>
      </div></div>`;
  }
  function acompResultChart(itens){
    const valores=[
      {label:'Corretos',filter:'OK',value:itens.filter(i=>audStatus(i)==='OK').length,color:'#10b981'},
      {label:'Divergentes',filter:'DIVERGENTE',value:itens.filter(i=>audStatus(i)==='DIVERGENTE').length,color:'#ef4444'},
      {label:'Pendentes',filter:'PENDENTE',value:itens.filter(i=>audStatus(i)==='PENDENTE').length,color:'#f59e0b'},
      {label:'Vazios',filter:'ENDERECO_VAZIO',value:itens.filter(i=>audStatus(i)==='ENDERECO_VAZIO').length,color:'#64748b'}
    ];
    const total=valores.reduce((s,x)=>s+x.value,0),base=total||1;let grau=0;
    const stops=valores.map(x=>{const ini=grau;grau+=x.value/base*360;return `${x.color} ${ini}deg ${grau}deg`;}).join(',');
    return `<div class="dash-pie-body"><div class="dash-donut" style="background:conic-gradient(${stops})"><div class="dash-donut-value">${total.toLocaleString('pt-BR')}<small>Total</small></div></div><div class="dash-stat-list">${valores.map(x=>`<button type="button" class="dash-stat-row${acompAudFiltro.tipo==='status'&&acompAudFiltro.valor===x.filter?' acomp-chart-selected':''}" onclick="_acompAudChartClick('status','${x.filter}')" title="Filtrar por ${x.label}"><span><i class="dash-dot" style="background:${x.color}"></i>${x.label}</span><b>${x.value.toLocaleString('pt-BR')}</b></button>`).join('')}</div></div>`;
  }
  function restaurarLayoutInventario(){
    const ruas=document.getElementById('acomp-ruas-grid');
    if(ruas){ruas.className='dash-scroll-card';ruas.style.cssText='padding:12px 20px;display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto';}
    const detalhe=document.getElementById('acomp-progress-detail');
    if(detalhe){detalhe.className='dash-scroll-card';detalhe.style.cssText='padding:20px;max-height:380px;overflow-y:auto';}
    const coletores=document.getElementById('acomp-coletores-wrap');
    if(coletores){coletores.className='dash-scroll-card';coletores.style.cssText='max-height:380px;overflow-y:auto';}
    const titulos=document.querySelectorAll('#page-acompanhamento .tc-title');
    if(titulos[0])titulos[0].textContent='🛣️ Progresso por Rua';
    if(titulos[1])titulos[1].textContent='🗂️ Progresso por Local de Estoque';
    if(titulos[2])titulos[2].textContent='👤 Produtividade por Operador';
  }
  function renderAcompAuditoria(){const id=document.getElementById('acomp-sel-inv')?.value||'';const meta=acompAudMetas.find(m=>m.id===id);const total=acompAudItens.length;const ok=acompAudItens.filter(i=>audStatus(i)==='OK').length;const div=acompAudItens.filter(i=>audStatus(i)==='DIVERGENTE').length;const vaz=acompAudItens.filter(i=>audStatus(i)==='ENDERECO_VAZIO').length;const pend=acompAudItens.filter(i=>audStatus(i)==='PENDENTE').length;const concl=total-pend;const pct=total?Math.round(concl/total*100):0;setText('acomp-inv-nome',meta?(meta.nome||meta.auditoria_nome||meta.id):'Selecione uma auditoria para monitorar');setText('ak-total',total.toLocaleString('pt-BR'));setText('ak-contados',concl.toLocaleString('pt-BR'));setText('ak-pendentes',pend.toLocaleString('pt-BR'));setText('ak-diverg',div.toLocaleString('pt-BR'));setText('ak-recount',vaz.toLocaleString('pt-BR'));setText('ak-pct',pct+'%');
    const labels=['Total de Endereços','Endereços Auditados','Endereços Pendentes','Endereços Divergentes','Endereços Vazios','% Concluído'];document.querySelectorAll('#acomp-kpis .kpi-lbl').forEach((e,i)=>e.textContent=labels[i]||e.textContent);setHero(pct,meta?(meta.nome||meta.auditoria_nome||meta.id):'Auditoria não selecionada',`${concl.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} endereços auditados · ${ok} corretos · ${div} divergentes · ${acompAudOcorrencias.length} fora da auditoria`,'#fb923c');
    let ocorrBox=document.getElementById('acomp-aud-ocorrencias');if(!ocorrBox){ocorrBox=document.createElement('div');ocorrBox.id='acomp-aud-ocorrencias';document.getElementById('acomp-kpis')?.after(ocorrBox);}if(ocorrBox){ocorrBox.innerHTML=acompAudOcorrencias.length?`<div class="alert warn" style="margin:12px 0"><b>📍 ${acompAudOcorrencias.length} produto(s) encontrado(s) fora dos endereços previstos</b><div style="margin-top:8px;overflow:auto"><table><thead><tr><th>Endereço encontrado</th><th>Produto</th><th>Operador</th><th>Data</th></tr></thead><tbody>${acompAudOcorrencias.slice().reverse().slice(0,20).map(o=>`<tr><td class="mono">${safe(o.endereco)}</td><td>${safe(o.produtoLido||o.produto_lido||o.codigoLido||'—')}</td><td>${safe(o.operador_nome||o.operadorNome||'—')}</td><td>${safe(o.encontrado_em||o.criadoEm||'—')}</td></tr>`).join('')}</tbody></table></div></div>`:'';}
    const filtrados=acompFiltrados();
    const ruas=groupStats(filtrados,i=>enderecoPartes(i.endereco).rua);
    const ops=groupStats(filtrados.filter(i=>audStatus(i)!=='PENDENTE'),i=>i.operadorNome||i.operador_nome||i.operadorId||i.operador_id||'SEM OPERADOR');
    const filtroHtml=acompFiltroInfo();
    const ruasGrid=document.getElementById('acomp-ruas-grid');
    if(ruasGrid){ruasGrid.className='acomp-aud-chart-host';ruasGrid.style.cssText='padding:4px 18px 20px;overflow:hidden';ruasGrid.innerHTML=filtroHtml+acompColumnChart(ruas,'rua',12);}
    const detalhe=document.getElementById('acomp-progress-detail');
    if(detalhe){detalhe.className='acomp-aud-chart-host';detalhe.style.cssText='padding:4px 18px 20px;overflow:hidden';detalhe.innerHTML=acompResultChart(filtrados);}
    const coletores=document.getElementById('acomp-coletores-wrap');
    if(coletores){coletores.className='acomp-aud-chart-host';coletores.style.cssText='padding:4px 18px 20px;overflow:hidden';coletores.innerHTML=acompColumnChart(ops,'operador',10);}
    const titulos=document.querySelectorAll('#page-acompanhamento .tc-title');
    if(titulos[0])titulos[0].textContent='📊 Auditados e divergências por rua';
    if(titulos[1])titulos[1].textContent='🎯 Resultado da auditoria';
    if(titulos[2])titulos[2].textContent='👤 Resultado por operador';
    setText('acomp-ultima-sync','Última atualização: '+new Date().toLocaleTimeString('pt-BR'));
  }
  window.trocarTipoAcompanhamento=async function(){
    const sel=document.getElementById('acomp-sel-inv');
    if(tipoAcomp()==='auditoria'){
      acompInventarioAnterior=String(window.AnalistaStore?.getState()?.ui?.acompanhamentoInventarioId||sel?.value||'');
      window.AnalistaState?.set('ui.acompanhamentoInventarioId',null,{source:'acomp-tipo'});
      acompAudItens=[];acompAudOcorrencias=[];acompAudFiltro={tipo:'',valor:''};
      if(sel){sel.disabled=true;sel.innerHTML='<option value="">Carregando auditorias...</option>';}
      renderAcompAuditoria();
      try{
        await loadAuditoriasAcomp(false);
        if(sel)sel.value='';
        await popularAcompAuditorias();
      }catch(e){
        console.error('[ACOMP AUD] Falha ao preparar seletor:',e);
        if(sel)sel.innerHTML='<option value="">Não foi possível listar as auditorias</option>';
        window.showToast?.('Não foi possível listar as auditorias. Clique em Atualizar para tentar novamente.','e');
      }finally{
        if(sel)sel.disabled=false;
      }
      renderAcompAuditoria();
      return;
    }
    if(sel){sel.disabled=false;sel.innerHTML='<option value="">Escolha um inventário</option>';}
    if(acompInventarioAnterior)window.AnalistaState?.set('ui.acompanhamentoInventarioId',acompInventarioAnterior,{source:'acomp-tipo'});
    restaurarLayoutInventario();ensureHero().style.display='';oldRenderAcompanhamento?.();
    setTimeout(()=>{const pct=parseInt(document.getElementById('ak-pct')?.textContent)||0;setHero(pct,document.getElementById('acomp-inv-nome')?.textContent||'Inventário',`${document.getElementById('ak-contados')?.textContent||0} endereços contados`,'#34d399')},0);
  };
  window.trocarInventarioAcomp=async function(){if(tipoAcomp()==='auditoria'){acompAudItens=[];acompAudOcorrencias=[];acompAudFiltro={tipo:'',valor:''};return renderAcompAuditoria();}return oldTrocarInventarioAcomp?.();};
  window.renderAcompanhamento=function(){if(tipoAcomp()==='auditoria')return renderAcompAuditoria();oldRenderAcompanhamento?.();setTimeout(()=>{const pct=parseInt(document.getElementById('ak-pct')?.textContent)||0;setHero(pct,document.getElementById('acomp-inv-nome')?.textContent||'Inventário',`${document.getElementById('ak-contados')?.textContent||0} endereços contados`,'#34d399')},0);};
  window.atualizarAcompanhamentoAuditoriaManual=async function(){
    await loadAuditoriasAcomp(true);
    const sel=document.getElementById('acomp-sel-inv');
    const atual=sel?.value||'';
    await popularAcompAuditorias();
    if(sel&&atual&&acompAudMetas.some(m=>m.id===atual))sel.value=atual;
    await carregarAuditoriaSelecionada();
  };
  window._acompAudChartClick=function(tipo,valor){
    if(!tipo){acompAudFiltro={tipo:'',valor:''};}
    else if(acompAudFiltro.tipo===tipo&&acompAudFiltro.valor===valor){acompAudFiltro={tipo:'',valor:''};}
    else{acompAudFiltro={tipo,valor};}
    renderAcompAuditoria();
  };

  function groupStats(lista,keyFn){const m={};lista.forEach(i=>{const k=keyFn(i)||'SEM DADO';if(!m[k])m[k]={label:k,total:0,auditados:0,divergencias:0,ok:0,vazios:0};const x=m[k];x.total++;const st=audStatus(i);if(st!=='PENDENTE')x.auditados++;if(st==='DIVERGENTE')x.divergencias++;if(st==='OK')x.ok++;if(st==='ENDERECO_VAZIO')x.vazios++;});return Object.values(m).sort((a,b)=>b.divergencias-a.divergencias||b.auditados-a.auditados);}
  function compareColumns(arr,tipo,limit=10){
    if(!arr.length)return '<div class="empty"><div class="empty-title">Sem dados nos filtros atuais</div></div>';
    const dados=arr.slice(0,limit),max=Math.max(...dados.map(x=>Math.max(x.auditados,x.divergencias)),1);
    const teto=Math.max(1,Math.ceil(max/4)*4);
    const linhas=[0,1,2,3,4].map(n=>Math.round(teto*n/4));
    return `<div class="dash-column-legend"><span><i class="auditados"></i>Auditados</span><span><i class="divergencias"></i>Divergências</span><small>Clique em uma coluna para ver os detalhes</small></div>
      <div class="dash-column-scroll"><div class="dash-column-chart" style="--chart-count:${dados.length}">
        <div class="dash-y-axis">${linhas.map((v,i)=>`<span style="bottom:${i*25}%">${v}</span>`).join('')}</div>
        <div class="dash-grid-lines">${linhas.map((_,i)=>`<i style="bottom:${i*25}%"></i>`).join('')}</div>
        <div class="dash-column-groups">${dados.map((x,idx)=>{
          const label=String(x.label),clickLabel=label.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          const ha=x.auditados?Math.max(4,x.auditados/teto*100):0;
          const hd=x.divergencias?Math.max(4,x.divergencias/teto*100):0;
          return `<button class="dash-column-group" onclick="_dashAudBarClick('${tipo}','${clickLabel}')" title="${safe(label)} — ${x.auditados} auditados, ${x.divergencias} divergências">
            <span class="dash-columns"><i class="dash-column auditados" style="height:${ha}%"><b>${x.auditados}</b></i><i class="dash-column divergencias" style="height:${hd}%"><b>${x.divergencias}</b></i></span>
            <span class="dash-column-label"><em>${idx+1}.</em> ${safe(label)}</span>
          </button>`;
        }).join('')}</div>
      </div></div>`;
  }
  function donut(title,items,tipo){const total=items.reduce((a,x)=>a+x.value,0)||1;let deg=0;const stops=items.map((x,i)=>{const ini=deg;deg+=x.value/total*360;return `${x.color} ${ini}deg ${deg}deg`;}).join(',');return `<section class="dash-modern-card dash-pie"><div class="dm-head"><div><div class="dm-title">${title}</div><div class="dm-sub">Clique uma vez para filtrar; clique novamente para remover</div></div></div><div class="dash-pie-body"><div class="dash-donut" style="background:conic-gradient(${stops})"><div class="dash-donut-value">${total.toLocaleString('pt-BR')}<small>Total</small></div></div><div class="dash-stat-list">${items.map(x=>{const clickLabel=String(x.filter??x.label).replace(/\\/g,'\\\\').replace(/'/g,"\\'");return `<button type="button" class="dash-stat-row" onclick="_dashAudBarClick('${tipo}','${clickLabel}')" title="Clique para filtrar ou remover o filtro"><span><i class="dash-dot" style="background:${x.color}"></i>${safe(x.label)}</span><b>${x.value.toLocaleString('pt-BR')}</b></button>`;}).join('')}</div></div></section>`;}
  window.renderDashboardAuditoria=function(){const lista=window._dashAudFiltrados?window._dashAudFiltrados():[];const total=lista.length,ok=lista.filter(i=>audStatus(i)==='OK').length,div=lista.filter(i=>audStatus(i)==='DIVERGENTE').length,vaz=lista.filter(i=>audStatus(i)==='ENDERECO_VAZIO').length,pend=lista.filter(i=>audStatus(i)==='PENDENTE').length,audit=total-pend,pct=total?Math.round(audit/total*100):0,acur=audit?Math.round(ok/audit*100):0;
    const prod=groupStats(lista,i=>i.produtoEsperado||i.produto_esperado||i.dunEsperado||i.dun_esperado||i.dun||'SEM PRODUTO');
    const ruas=groupStats(lista,i=>i.rua||enderecoPartes(i.endereco).rua);
    const niveis=groupStats(lista,i=>i.nivel||enderecoPartes(i.endereco).nivel);
    const cols=groupStats(lista,i=>i.coluna||enderecoPartes(i.endereco).coluna);
    const kpi=document.getElementById('kpi-grid');if(kpi)kpi.style.display='none';const breakdown=document.getElementById('dash-breakdown-grid');if(breakdown)breakdown.style.display='none';const wrap=document.getElementById('dash-charts-wrap');if(wrap)wrap.innerHTML=`<div class="dash-modern-grid">
      <section class="dash-modern-card dash-summary"><div class="dash-donut" style="background:conic-gradient(#10b981 ${acur*3.6}deg,#ef4444 0)"><div class="dash-donut-value">${acur}%<small>Acuracidade</small></div></div><div class="dash-stat-list">${[{label:'Corretos',status:'OK',value:ok,color:'#10b981'},{label:'Divergentes',status:'DIVERGENTE',value:div,color:'#ef4444'},{label:'Pendentes',status:'PENDENTE',value:pend,color:'#f59e0b'},{label:'Vazios',status:'ENDERECO_VAZIO',value:vaz,color:'#64748b'}].map(x=>`<button type="button" class="dash-stat-row" onclick="_dashAudBarClick('status','${x.status}')" title="Clique para filtrar ou remover o filtro"><span><i class="dash-dot" style="background:${x.color}"></i>${x.label}</span><b>${x.value}</b></button>`).join('')}</div></section>
      <section class="dash-modern-card dash-ranking"><div class="dm-head"><div><div class="dm-title">Top 10 produtos com maior divergência</div><div class="dm-sub">Quantidade auditada comparada às divergências encontradas</div></div></div><div class="dash-ranking-body">${compareColumns(prod,'produto')}</div></section>
      <section class="dash-modern-card dash-wide"><div class="dm-head"><div><div class="dm-title">Ruas com maiores divergências</div><div class="dm-sub">Quantidade auditada comparada às divergências em cada rua</div></div></div><div class="dash-ranking-body">${compareColumns(ruas,'rua',12)}</div></section>
      ${donut('Resultado da auditoria',[{label:'Corretos',filter:'OK',value:ok,color:'#10b981'},{label:'Divergentes',filter:'DIVERGENTE',value:div,color:'#ef4444'},{label:'Pendentes',filter:'PENDENTE',value:pend,color:'#f59e0b'},{label:'Vazios',filter:'ENDERECO_VAZIO',value:vaz,color:'#64748b'}],'status')}
      ${donut('Divergências por nível',niveis.slice(0,6).map((x,i)=>({label:x.label,value:x.divergencias,color:COLORS[i%COLORS.length]})).filter(x=>x.value),'nivel')}
      ${donut('Divergências por coluna',cols.slice(0,6).map((x,i)=>({label:x.label,value:x.divergencias,color:COLORS[(i+3)%COLORS.length]})).filter(x=>x.value),'coluna')}
      <section class="dash-modern-card dash-insights"><div class="dash-insight"><strong>${total.toLocaleString('pt-BR')}</strong><span>Endereços previstos</span></div><div class="dash-insight"><strong>${audit.toLocaleString('pt-BR')}</strong><span>Auditados</span></div><div class="dash-insight"><strong>${pct}%</strong><span>Execução</span></div><div class="dash-insight"><strong>${new Set(lista.map(i=>i.operadorNome||i.operador_nome||i.operadorId||i.operador_id).filter(Boolean)).size}</strong><span>Operadores</span></div><div class="dash-insight"><strong>${prod.filter(x=>x.divergencias).length}</strong><span>Produtos divergentes</span></div></section></div>`;
    const rt=document.getElementById('dash-recentes-title');if(rt)rt.textContent='🔎 Resultados recentes da auditoria';const act=document.getElementById('dash-recentes-action');if(act)act.style.display='none';const tab=document.getElementById('dash-inv-table');if(tab){const rec=[...lista].filter(i=>audStatus(i)!=='PENDENTE').slice(-15).reverse();tab.innerHTML=rec.length?`<div class="tbl-wrap"><table><thead><tr><th>Endereço</th><th>Produto esperado</th><th>Produto lido</th><th>Resultado</th><th>Operador</th></tr></thead><tbody>${rec.map(i=>`<tr><td class="mono">${safe(i.endereco)}</td><td>${safe(i.produtoEsperado||i.produto_esperado||i.dunEsperado||i.dun_esperado||'—')}</td><td>${safe(i.produtoLido||i.produto_lido||i.dunLido||i.dun_lido||'—')}</td><td><span class="badge ${audStatus(i)==='OK'?'ok':audStatus(i)==='DIVERGENTE'?'err':'warn'}">${audStatus(i)}</span></td><td>${safe(i.operadorNome||i.operador_nome||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><div class="empty-title">Nenhum resultado</div></div>';}const alert=document.getElementById('dash-alert-wrap');if(alert)alert.innerHTML=div?`<div class="alert warn"><b>⚠️ ${div} divergência(s)</b> identificadas. Clique nos gráficos para detalhar.</div>`:`<div class="alert ok"><b>✅ Nenhuma divergência</b> nos filtros atuais.</div>`;};
  const oldAlterar=window.alterarModoDashboard;window.alterarModoDashboard=function(m){if(m==='inventario'){const k=document.getElementById('kpi-grid');if(k)k.style.display='';const b=document.getElementById('dash-breakdown-grid');if(b)b.style.display='';}return oldAlterar?.(m);};
  let atualizacaoManualEmAndamento=null;
  window.atualizarTresAbasAuditoria=function(botao){
    if(atualizacaoManualEmAndamento)return atualizacaoManualEmAndamento;
    const botoes=[...document.querySelectorAll('[onclick^="atualizarTresAbasAuditoria"],[onclick^="atualizarDadosAnalista"]')];
    botoes.forEach(b=>{b.disabled=true;b.dataset.textoAtualizar=b.innerHTML;b.innerHTML='⏳ Atualizando...';});
    const pagina=botao?.closest?.('.page')?.id||'';
    const modoAuditoria=pagina==='page-auditoria'
      ||(pagina==='page-dashboard'&&document.getElementById('dash-mode')?.value==='auditoria')
      ||(pagina==='page-acompanhamento'&&document.getElementById('acomp-tipo')?.value==='auditoria');
    atualizacaoManualEmAndamento=(modoAuditoria
      ? Promise.all([
          Promise.resolve(window.atualizarDashboardAuditoriaManual?.()),
          Promise.resolve(window.atualizarAcompanhamentoAuditoriaManual?.()),
          Promise.resolve(window.atualizarAuditoriaOperacionalManual?.())
        ])
      : Promise.resolve(window.AnalistaFirebaseService?.refreshInventarioManual?.())
    ).then(()=>{
      if(modoAuditoria){
        window.showToast?.('Dashboard, Acompanhamento e Auditoria atualizados.','s');
      }else{
        window.renderDashboard?.();
        window.renderAcompanhamento?.();
        window.renderContagens?.();
        window.renderPendencias?.();
        window.renderDivergencias?.();
        window.renderRecontagens?.();
        window.showToast?.('As quatro bases do Inventário foram atualizadas.','s');
      }
    }).catch(e=>{
      console.error('[ATUALIZAÇÃO MANUAL AUDITORIA]',e);
      window.showToast?.('Não foi possível atualizar todas as telas: '+(e?.message||e),'e');
    }).finally(()=>{
      botoes.forEach(b=>{b.disabled=false;b.innerHTML=b.dataset.textoAtualizar||'🔄 Atualizar';delete b.dataset.textoAtualizar;});
      atualizacaoManualEmAndamento=null;
    });
    return atualizacaoManualEmAndamento;
  };
  window.atualizarDadosAnalista=window.atualizarTresAbasAuditoria;
  document.addEventListener('DOMContentLoaded',()=>{ensureHero();const tipo=document.getElementById('acomp-tipo');if(tipo)tipo.value='inventario';});
})();
