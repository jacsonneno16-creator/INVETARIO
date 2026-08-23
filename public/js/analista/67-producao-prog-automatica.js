// Setor Produção — Programação Automática (paridade funcional V341).
// Reimplementa, dentro da arquitetura multi-loja do Inventário, os recursos
// operacionais do módulo original: planejamento em até 4 semanas, prioridade
// dinâmica por cobertura/risco, múltiplas máquinas compatíveis, scoring por
// carga + setup + velocidade, limite percentual por máquina/produto, opção de
// limitar por estoque de insumos, auditoria de capacidade, filtro por máquina,
// simulação sem gravação e aplicação das sugestões no Gantt/Programação.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_PRODUTOS = 'producao_produtos';
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_REGISTROS = 'producao_registros';
  const COL_SETUP = 'producao_setup';
  const COL_FICHAS = 'producao_ficha_tecnica';
  const COL_INSUMOS_ESTOQUE = 'producao_insumos_estoque';
  const DIA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  let _produtos = [], _maquinas = [], _registros = [], _setups = [], _fichas = [], _insumosEstoque = [];
  let _carregado = false, _sugestoes = [], _auditoria = [], _simulacao = false;

  function fs(){ return global.getDTFirestore(); }
  function domingo(d){ const r=new Date(d); r.setHours(12,0,0,0); r.setDate(r.getDate()-r.getDay()); return r; }
  function iso(d){ return d.toISOString().slice(0,10); }
  function fmt(d){ return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}); }
  function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
  function n(v,def=0){ const x=Number(v); return Number.isFinite(x)?x:def; }
  function norm(v){ return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim(); }

  async function carregarProgAutomatica(forcar){
    if(_carregado && !forcar) return;
    await global.carregarProducaoProjecao?.(forcar);
    const [p,m,r,s,f,i]=await Promise.all([
      fs().collection(COL_PRODUTOS).get(), fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_REGISTROS).get(), fs().collection(COL_SETUP).get(),
      fs().collection(COL_FICHAS).get(), fs().collection(COL_INSUMOS_ESTOQUE).get().catch(()=>({docs:[]})),
    ]);
    _produtos=p.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _maquinas=m.docs.map(d=>({_firestoreId:d.id,...d.data()})).filter(x=>x.ativo!==false && x.status!=='inativa');
    _registros=r.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _setups=s.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _fichas=f.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _insumosEstoque=i.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _carregado=true;
  }

  function produtoCad(proj){
    return _produtos.find(p=>String(p.cod)===String(proj.cod)) || _produtos.find(p=>norm(p.nome)===norm(proj.produto));
  }
  function fichaCad(prod){
    if(!prod) return null;
    return _fichas.find(f=>String(f.cod)===String(prod.cod)) || _fichas.find(f=>norm(f.desc)===norm(prod.nome));
  }
  function maquinasCompativeis(prod){
    if(!prod) return [];
    const out=[];
    _maquinas.forEach(m=>{
      const comp=(m.produtosCompativeis||[]).find(p=>norm(p.produto)===norm(prod.nome) || norm(prod.nome).startsWith(norm(p.produto)));
      if(comp || norm(m.nome)===norm(prod.maquina)){
        const vel=n(comp?.velocidade,0)||n(m.pcMin,0)||n(prod.pc_min,0);
        if(vel>0) out.push({maquina:m,pcMin:vel});
      }
    });
    if(!out.length && prod.maquina){
      const m=_maquinas.find(x=>norm(x.nome)===norm(prod.maquina));
      if(m) out.push({maquina:m,pcMin:n(m.pcMin,0)||n(prod.pc_min,0)});
    }
    return out.sort((a,b)=>b.pcMin-a.pcMin);
  }
  function capacidadeMinSemana(maquina, weekStart){
    if(typeof global.buildProducaoSchedule==='function'){
      const mp={}; _maquinas.forEach(m=>mp[m.nome]=m);
      const s=global.buildProducaoSchedule(weekStart,_registros,mp,_setups);
      const x=s?.porMaquina?.[maquina.nome];
      if(x?.capacidadeMinutosSemana>0) return x.capacidadeMinutosSemana;
    }
    // fallback pelos turnos cadastrados
    let total=0;
    for(let k=0;k<7;k++){
      const d=new Date(weekStart); d.setDate(d.getDate()+k);
      const turnos=(maquina.turnos?.[d.getDay()]||maquina.turnos?.[String(d.getDay())]||[]).filter(x=>x&&x.ativo!==false);
      if(turnos.length){
        turnos.forEach(t=>{
          const [h1,m1]=String(t.ini||'00:00').split(':').map(Number), [h2,m2]=String(t.fim||'00:00').split(':').map(Number);
          let a=h1*60+m1,b=h2*60+m2; if(b<=a)b+=1440; total+=Math.max(0,b-a);
        });
      } else if(d.getDay()>=1 && d.getDay()<=5) total+=9*60;
    }
    return total;
  }
  function cargaExistenteMin(maquina, weekStart){
    if(typeof global.buildProducaoSchedule!=='function') return 0;
    const mp={}; _maquinas.forEach(m=>mp[m.nome]=m);
    return global.buildProducaoSchedule(weekStart,_registros,mp,_setups)?.porMaquina?.[maquina.nome]?.totalMinutosUsados||0;
  }
  function ultimoProdutoNaMaquina(nome){
    return _registros.filter(r=>r.maquina===nome && r.status!=='concluido')
      .sort((a,b)=>n(b.sortOrder)-n(a.sortOrder))[0]?.produto||'';
  }
  function setupMin(maquina,orig,dest){ return global.getSetupMin?.(maquina,orig,dest,_setups)||0; }

  function estoqueInsumosMap(){
    const m=new Map();
    _insumosEstoque.forEach(i=>m.set(norm(i.insumo||i.nome),n(i.quantidade)));
    return m;
  }
  function maxCaixasPorInsumos(prod,qtdDesejada,mapa){
    const ficha=fichaCad(prod); if(!ficha || !(ficha.insumos||[]).length) return {max:qtdDesejada, faltas:[]};
    let max=qtdDesejada; const faltas=[];
    (ficha.insumos||[]).forEach(i=>{
      const porCx=n(i.qty); if(porCx<=0)return;
      const saldo=n(mapa.get(norm(i.insumo)),0);
      const poss=Math.floor(saldo/porCx);
      max=Math.min(max,poss);
      if(poss<qtdDesejada) faltas.push({insumo:i.insumo,necessario:qtdDesejada*porCx,disponivel:saldo,possivelCx:poss});
    });
    return {max:Math.max(0,max),faltas};
  }
  function consumirInsumos(prod,cx,mapa){
    const ficha=fichaCad(prod); if(!ficha)return;
    (ficha.insumos||[]).forEach(i=>{ const q=n(i.qty)*cx; const k=norm(i.insumo); mapa.set(k,Math.max(0,n(mapa.get(k))-q)); });
  }

  function parametros(){
    return {
      modo:document.querySelector('input[name="ppa-modo"]:checked')?.value||'mes',
      coberturaMin:Math.max(1,n(document.getElementById('ppa-cobertura-min')?.value,30)),
      coberturaAlvo:Math.max(1,n(document.getElementById('ppa-cobertura-alvo')?.value,20)),
      riscoCritico:Math.max(1,n(document.getElementById('ppa-risco-critico')?.value,10)),
      maxPct:clamp(n(document.getElementById('ppa-max-pct')?.value,90)/100,.1,1),
      insumo:document.querySelector('input[name="ppa-insumo"]:checked')?.value||'total',
      fechamento:document.getElementById('ppa-fechamento')?.value||'mes-seguinte',
      semana:document.getElementById('ppa-semana')?.value||'',
      mes:document.getElementById('ppa-mes')?.value||'',
    };
  }
  function inicioPlanejamento(p){
    if(p.modo==='semana' && p.semana) return domingo(new Date(p.semana+'T12:00:00'));
    if(p.modo==='mes' && p.mes){ const [y,m]=p.mes.split('-').map(Number); return domingo(new Date(y,m-1,1,12)); }
    return domingo(new Date());
  }
  function semanasPlanejamento(p){
    const base=inicioPlanejamento(p), arr=[];
    const limiteMes=p.modo==='mes' && p.mes ? (()=>{const [y,m]=p.mes.split('-').map(Number);return new Date(y,m,0,12);})():null;
    const qtd=p.modo==='semana'?1:4;
    for(let i=0;i<qtd;i++){
      const ini=new Date(base); ini.setDate(ini.getDate()+i*7); const fim=new Date(ini); fim.setDate(fim.getDate()+6);
      if(limiteMes && p.fechamento==='este-mes' && fim>limiteMes) fim.setTime(limiteMes.getTime());
      arr.push({index:i,inicio:ini,fim});
    }
    return arr;
  }
  function prioridade(cobertura,riscoLim,cobMin,semanaIdx){
    const cob=Number.isFinite(cobertura)?cobertura:9999;
    let score=0;
    if(cob<=riscoLim) score+=1000+(riscoLim-cob)*40;
    else if(cob<cobMin) score+=500+(cobMin-cob)*20;
    score-=semanaIdx*5;
    return score;
  }
  function distribuirDias(cx,week,maquina){
    const dias=[]; let pesos=[];
    for(let i=0;i<7;i++){
      const d=new Date(week.inicio);d.setDate(d.getDate()+i); if(d>week.fim)break;
      const t=(maquina.turnos?.[d.getDay()]||maquina.turnos?.[String(d.getDay())]||[]).filter(x=>x&&x.ativo!==false);
      const peso=t.length?t.reduce((s,f)=>{const [h1,m1]=String(f.ini||'00:00').split(':').map(Number),[h2,m2]=String(f.fim||'00:00').split(':').map(Number);let a=h1*60+m1,b=h2*60+m2;if(b<=a)b+=1440;return s+Math.max(0,b-a)},0):(d.getDay()>=1&&d.getDay()<=5?540:0);
      if(peso>0){dias.push(d);pesos.push(peso);}
    }
    const total=pesos.reduce((a,b)=>a+b,0)||1; let restante=cx;
    return dias.map((d,i)=>{ const q=i===dias.length-1?restante:Math.min(restante,Math.round(cx*(pesos[i]/total))); restante-=q; return {data:iso(d),caixas:q,dia:DIA[d.getDay()]}; }).filter(x=>x.caixas>0);
  }

  async function gerarSugestoes(simulacao=false){
    const p=parametros(); _simulacao=!!simulacao;
    const proj=global.calcularProjecaoComRisco?.(document.getElementById('pproj-metodo')?.value||'simples')||[];
    const semanas=semanasPlanejamento(p); const insumos=estoqueInsumosMap();
    const carga=new Map(), ultimo=new Map(); _auditoria=[]; _sugestoes=[];
    semanas.forEach(w=>_maquinas.forEach(m=>{
      const key=m.nome+'|'+iso(w.inicio), cap=capacidadeMinSemana(m,w.inicio), usada=cargaExistenteMin(m,w.inicio);
      carga.set(key,{cap,usada,novas:0,porProduto:new Map()}); ultimo.set(key,ultimoProdutoNaMaquina(m.nome));
    }));

    const estados=proj.map(x=>{
      const prod=produtoCad(x); const demandaSem=n(x.projSemanal); return {proj:x,prod,demandaSem,estoque:n(x.estoqueAtual),produzido:0};
    }).filter(x=>x.prod && x.prod.ativo!==false && x.demandaSem>0);

    for(const w of semanas){
      // consumo previsto ocorre antes de calcular necessidade da semana; para a primeira,
      // preservamos o estoque atual como ponto de partida.
      if(w.index>0) estados.forEach(e=>e.estoque=Math.max(0,e.estoque-e.demandaSem));
      const fila=estados.map(e=>{
        const diaria=e.demandaSem/7, cob=diaria>0?e.estoque/diaria:9999;
        const prioProduto=Math.max(1,n(e.prod.prioridadeProducao,2));
        return {...e,cob,prioProduto,prio:prioridade(cob,p.riscoCritico,p.coberturaMin,w.index)+Math.max(0,(4-prioProduto))*200};
      }).filter(e=>e.cob<p.coberturaMin).sort((a,b)=>b.prio-a.prio || a.cob-b.cob);

      // Round-robin: uma passada aloca uma fração; repete enquanto houver necessidade
      // e capacidade. Evita um produto monopolizar a máquina.
      let progresso=true, guard=0;
      while(progresso && guard++<30){
        progresso=false;
        for(const e of fila){
          const diaria=e.demandaSem/7, alvoDias=Math.max(1,n(e.prod.metaCoberturaDias||e.prod.coberturaDias,p.coberturaAlvo)), alvo=diaria*alvoDias;
          let necessidade=Math.max(0,Math.ceil(alvo-e.estoque));
          const minimo=Math.max(0,n(e.prod.producaoMinima));
          const multiplo=Math.max(0,n(e.prod.multiploProducao));
          if(necessidade>0 && minimo>0 && necessidade<minimo) necessidade=minimo;
          if(necessidade>0 && multiplo>0) necessidade=Math.ceil(necessidade/multiplo)*multiplo;
          if(necessidade<=0) continue;
          const comps=maquinasCompativeis(e.prod); if(!comps.length){
            if(!_sugestoes.some(s=>s.cod===e.proj.cod && s.semMaquina)) _sugestoes.push({cod:e.proj.cod,produto:e.proj.produto,semMaquina:true,semana:iso(w.inicio),coberturaAtual:e.cob,motivo:'Sem máquina compatível'});
            continue;
          }
          if(p.insumo==='limitado') necessidade=maxCaixasPorInsumos(e.prod,necessidade,insumos).max;
          if(necessidade<=0) continue;

          const scored=comps.map(c=>{
            const key=c.maquina.nome+'|'+iso(w.inicio), st=carga.get(key), prev=ultimo.get(key)||'';
            const setup=setupMin(c.maquina,prev,e.prod.nome); const minCx=60/Math.max(.0001,c.pcMin);
            const cargaPct=st.cap>0?(st.usada+st.novas)/st.cap:999;
            return {...c,key,st,setup,minCx,score:cargaPct*10000+setup*8+(1000/Math.max(1,c.pcMin))};
          }).sort((a,b)=>a.score-b.score);

          let alocou=false;
          for(const c of scored){
            if(c.st.cap<=0) continue;
            const prodUsado=c.st.porProduto.get(norm(e.prod.nome))||0;
            const limiteProdutoMin=c.st.cap*p.maxPct;
            const dispMin=Math.max(0,c.st.cap-c.st.usada-c.st.novas-c.setup);
            const dispProdMin=Math.max(0,limiteProdutoMin-prodUsado);
            const poss=Math.floor(Math.min(dispMin,dispProdMin)/c.minCx);
            if(poss<=0) continue;
            // rodada distribui no máximo 1/3 da necessidade por passagem, favorecendo equilíbrio
            let cx=Math.max(1,Math.min(necessidade,poss,Math.ceil(necessidade/3)));
            if(e.produzido<=0 && minimo>0 && poss>=minimo) cx=Math.max(cx,minimo);
            if(multiplo>0){ const arred=Math.ceil(cx/multiplo)*multiplo; if(arred<=poss) cx=arred; else cx=Math.max(multiplo,Math.floor(poss/multiplo)*multiplo); }
            cx=Math.min(cx,necessidade,poss);
            let faltas=[];
            if(p.insumo==='limitado'){ const lim=maxCaixasPorInsumos(e.prod,cx,insumos); cx=Math.min(cx,lim.max); faltas=lim.faltas; }
            else faltas=maxCaixasPorInsumos(e.prod,cx,insumos).faltas;
            if(cx<=0) continue;
            const minutos=cx*c.minCx+c.setup;
            c.st.novas+=minutos; c.st.porProduto.set(norm(e.prod.nome),prodUsado+minutos); ultimo.set(c.key,e.prod.nome);
            if(p.insumo==='limitado') consumirInsumos(e.prod,cx,insumos);
            e.estoque+=cx; e.produzido+=cx; progresso=true; alocou=true;
            const novaCob=diaria>0?e.estoque/diaria:9999;
            _sugestoes.push({
              cod:e.proj.cod,produto:e.proj.produto,produtoCad:e.prod,semana:iso(w.inicio),semanaFim:iso(w.fim),
              coberturaAtual:e.cob,coberturaPos:novaCob,qtyCaixas:cx,maquina:c.maquina.nome,maquinaCad:c.maquina,
              pcMin:c.pcMin,unidPorCx:Math.max(1,n(e.prod.unid,1)),setupMin:c.setup,minutos,
              risco:e.cob<=p.riscoCritico?'critico':'baixo',insumoFaltas:faltas,distribuicao:distribuirDias(cx,w,c.maquina),
              metaCoberturaDias:alvoDias,producaoMinima:minimo,multiploProducao:multiplo,prioridadeProducao:e.prioProduto,alergenico:e.prod.alergenico===true,
              motivo:e.cob<=p.riscoCritico?'Risco crítico de ruptura':'Cobertura abaixo do mínimo', selecionada:true,
            });
            break;
          }
          if(!alocou) continue;
        }
      }
    }

    semanas.forEach(w=>_maquinas.forEach(m=>{
      const key=m.nome+'|'+iso(w.inicio), st=carga.get(key); if(!st)return;
      _auditoria.push({maquina:m.nome,semana:iso(w.inicio),capacidade:st.cap,existente:st.usada,nova:st.novas,total:st.usada+st.novas,pct:st.cap>0?(st.usada+st.novas)/st.cap*100:0});
    }));
    _desenharProgAutomatica();
  }

  async function renderProducaoProgAutomatica(){
    const pagina=document.getElementById('page-producao-prog-automatica'); if(!pagina)return;
    pagina.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try{await carregarProgAutomatica();}catch(e){pagina.innerHTML='<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">'+esc(e.message||e)+'</div></div>';return;}
    _desenharProgAutomatica();
  }
  function optionsSemanas(){
    const base=domingo(new Date()); return Array.from({length:8},(_,i)=>{const d=new Date(base);d.setDate(d.getDate()+i*7);const f=new Date(d);f.setDate(f.getDate()+6);return `<option value="${iso(d)}">${fmt(d)} – ${fmt(f)} / ${d.getFullYear()}</option>`}).join('');
  }
  function optionsMeses(){
    const d=new Date(); return Array.from({length:6},(_,i)=>{const x=new Date(d.getFullYear(),d.getMonth()+i,1);const v=x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0');return `<option value="${v}">${x.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</option>`}).join('');
  }
  function _desenharProgAutomatica(){
    const pagina=document.getElementById('page-producao-prog-automatica'); if(!pagina)return;
    const p=parametros();
    const filtro=document.getElementById('ppa-maq-filter')?.value||'';
    const vis=_sugestoes.filter(s=>!filtro||s.maquina===filtro);
    const reais=_sugestoes.filter(s=>!s.semMaquina), maqSet=new Set(reais.map(s=>s.maquina));
    const hrs=reais.reduce((a,s)=>a+n(s.minutos),0)/60, risco=new Set(reais.filter(s=>s.risco==='critico').map(s=>s.cod)).size;
    const maquinasOpts=_maquinas.map(m=>`<option value="${esc(m.nome)}" ${filtro===m.nome?'selected':''}>${esc(m.nome)}</option>`).join('');
    const avisoSemMaq=_sugestoes.filter(s=>s.semMaquina).length;
    const periodoAlvoLabel = p.modo==='semana' ? (document.getElementById('ppa-semana')?.selectedOptions?.[0]?.textContent||'—') : (document.getElementById('ppa-mes')?.selectedOptions?.[0]?.textContent||'—');
    pagina.innerHTML=`
      <div style="margin-bottom:16px"><div class="page-title" style="font-size:1.1rem">🤖 Programação Automática</div><div style="font-size:.72rem;color:var(--muted)">Planejamento equilibrado por cobertura, capacidade, setup, velocidade e insumos — simulação de até 4 semanas.</div></div>
      <div class="kpi-grid" style="margin-bottom:16px">
        <div class="kpi orange"><span class="kpi-icon">⚠️</span><div class="kpi-val">${risco}</div><div class="kpi-lbl">Em Risco de Ruptura</div></div>
        <div class="kpi blue"><span class="kpi-icon">📋</span><div class="kpi-val">${reais.length}</div><div class="kpi-lbl">Sugestões Geradas</div></div>
        <div class="kpi purple"><span class="kpi-icon">🏭</span><div class="kpi-val">${maqSet.size}</div><div class="kpi-lbl">Máquinas Envolvidas</div></div>
        <div class="kpi green"><span class="kpi-icon">⏱️</span><div class="kpi-val">${hrs.toLocaleString('pt-BR',{maximumFractionDigits:1})}h</div><div class="kpi-lbl">Horas de Produção</div></div>
        <div class="kpi"><div class="kpi-val" style="font-size:1rem">${esc(periodoAlvoLabel)}</div><div class="kpi-lbl">Período Alvo</div></div>
      </div>
      <div class="tc" style="padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:.68rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;min-width:60px">Período</span>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:5px 14px;border-radius:20px;border:1px solid ${p.modo==='mes'?'var(--orange)':'var(--border)'};font-size:.76rem;font-weight:600"><input type="radio" name="ppa-modo" value="mes" ${p.modo==='mes'?'checked':''}> 📅 Mês</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:5px 14px;border-radius:20px;border:1px solid ${p.modo==='semana'?'var(--orange)':'var(--border)'};font-size:.76rem;font-weight:600"><input type="radio" name="ppa-modo" value="semana" ${p.modo==='semana'?'checked':''}> 📆 Semana</label>
        <select id="ppa-mes" class="field" style="min-width:180px;${p.modo==='mes'?'':'display:none'}">${optionsMeses()}</select>
        <select id="ppa-semana" class="field" style="min-width:220px;${p.modo==='semana'?'':'display:none'}">${optionsSemanas()}</select>
        <span style="font-size:.64rem;color:var(--muted)">venda + estoque desejado − estoque atual, distribuído nas semanas</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn btn-primary" data-ppa-gerar="1">🤖 Gerar Programação Automática</button>
        <button class="btn btn-ghost" data-ppa-recalcular="1">🔄 Recalcular</button>
        ${reais.length?'<button class="btn btn-primary" data-ppa-aplicar="1" style="background:var(--success)">✅ Aplicar no Gantt / Programação</button>':''}
        <button class="btn btn-ghost" data-ppa-simular="1">🔬 Simular Cenário</button>
        <div style="flex:1"></div>
        <select id="ppa-maq-filter" class="field" style="min-width:160px"><option value="">Todas as máquinas</option>${maquinasOpts}</select>
      </div>
      <div class="tc" style="padding:14px;margin-bottom:16px">
        <div style="font-weight:700;font-size:.8rem;margin-bottom:10px">⚙️ Parâmetros da Programação Automática</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          <div class="form-group" style="margin:0"><label>Cobertura Mínima Desejada (dias)</label><input id="ppa-cobertura-min" class="field" type="number" min="1" value="${p.coberturaMin}"></div>
          <div class="form-group" style="margin:0"><label>Cobertura Alvo Após Produção (dias)</label><input id="ppa-cobertura-alvo" class="field" type="number" min="1" value="${p.coberturaAlvo}"></div>
          <div class="form-group" style="margin:0"><label>Risco Crítico Abaixo de (dias)</label><input id="ppa-risco-critico" class="field" type="number" min="1" value="${p.riscoCritico}"></div>
          <div class="form-group" style="margin:0"><label>% Máx. da Máquina por Produto</label><input id="ppa-max-pct" class="field" type="number" min="10" max="100" value="${Math.round(p.maxPct*100)}"></div>
          <div class="form-group" style="margin:0"><label>Fechamento da Última Semana</label><select id="ppa-fechamento" class="field"><option value="mes-seguinte" ${p.fechamento==='mes-seguinte'?'selected':''}>↪ Pode cruzar para o mês seguinte</option><option value="este-mes" ${p.fechamento==='este-mes'?'selected':''}>🔒 Só dias deste mês (corta na virada)</option></select></div>
        </div>
        <div style="margin-top:10px;padding:10px 12px;background:rgba(224,112,32,.06);border:1px solid rgba(224,112,32,.2);border-radius:8px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span style="font-size:.68rem;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.05em">📦 Insumos</span>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.76rem"><input type="radio" name="ppa-insumo" value="total" ${p.insumo==='total'?'checked':''}> <span><b>Opção A</b> — Programar necessidade total <small style="color:var(--muted)">(mantém aviso se faltar insumo)</small></span></label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.76rem"><input type="radio" name="ppa-insumo" value="limitado" ${p.insumo==='limitado'?'checked':''}> <span><b>Opção B</b> — Limitar pelo estoque de insumos disponível <small style="color:var(--muted)">(programa só o que os insumos permitem)</small></span></label>
        </div>
      </div>
      ${_simulacao && reais.length?'<div class="tc" style="padding:10px 14px;margin-bottom:12px;border-left:4px solid var(--orange)"><b>🔬 Modo simulação:</b> nenhuma OP foi gravada. Ajuste os parâmetros e compare o cenário.</div>':''}
      ${avisoSemMaq?`<div class="tc" style="padding:10px 14px;margin-bottom:12px;border-left:4px solid var(--danger)">⚠️ ${avisoSemMaq} produto(s) em risco não possuem máquina compatível cadastrada.</div>`:''}
      ${_auditoria.length?`<div class="tc" style="padding:12px;margin-bottom:16px"><div style="font-weight:700;margin-bottom:8px">📊 Auditoria de capacidade por máquina</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px">${_auditoria.filter(a=>!filtro||a.maquina===filtro).map(a=>`<div style="border:1px solid var(--border);border-radius:8px;padding:9px"><div style="display:flex;justify-content:space-between"><b>${esc(a.maquina)}</b><span>${a.pct.toFixed(0)}%</span></div><div style="font-size:.66rem;color:var(--muted)">${esc(a.semana)} · atual ${(a.existente/60).toFixed(1)}h + nova ${(a.nova/60).toFixed(1)}h / cap ${(a.capacidade/60).toFixed(1)}h</div><div style="height:5px;background:var(--border);border-radius:9px;margin-top:5px"><div style="height:100%;width:${Math.min(100,a.pct)}%;background:${a.pct>100?'var(--danger)':a.pct>85?'var(--orange)':'var(--green-mid)'};border-radius:9px"></div></div></div>`).join('')}</div></div>`:''}
      ${_sugestoes.length?`<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th><input type="checkbox" data-ppa-check-todos="1" checked></th><th>Semana</th><th>Produto</th><th>Cobertura</th><th>Qtd.</th><th>Máquina</th><th>Setup</th><th>Distribuição</th><th>Insumos</th></tr></thead><tbody>${vis.map((s)=>{const idx=_sugestoes.indexOf(s);return `<tr><td>${s.semMaquina?'—':`<input type="checkbox" data-ppa-check="${idx}" ${s.selecionada!==false?'checked':''}>`}</td><td>${esc(s.semana||'—')}</td><td><b>${esc(s.produto)}</b><div style="font-size:.62rem;color:var(--muted)">Cód. ${esc(s.cod)}</div></td><td>${Number.isFinite(s.coberturaAtual)?s.coberturaAtual.toFixed(1)+'d':'—'} → ${Number.isFinite(s.coberturaPos)?s.coberturaPos.toFixed(1)+'d':'—'}</td><td>${s.qtyCaixas||'—'} cx</td><td>${s.maquina?esc(s.maquina):'<span class="badge b-red">Sem máquina</span>'}</td><td>${s.setupMin?Math.round(s.setupMin)+' min':'—'}</td><td style="font-size:.68rem">${(s.distribuicao||[]).map(d=>d.dia+' '+d.caixas).join(' · ')||'—'}</td><td>${s.insumoFaltas?.length?`<span class="badge b-orange" title="${esc(s.insumoFaltas.map(f=>f.insumo).join(', '))}">${s.insumoFaltas.length} falta(s)</span>`:'<span class="badge b-green">OK</span>'}</td></tr>`}).join('')}</tbody></table></div></div>`:'<div class="empty"><div class="empty-icon">🤖</div><div class="empty-title">Configure os parâmetros e gere a programação automática.</div></div>'}
    `;
    // preserva seleções de período quando redesenha
    const mes=document.getElementById('ppa-mes'); if(mes&&p.mes)mes.value=p.mes;
    const sem=document.getElementById('ppa-semana'); if(sem&&p.semana)sem.value=p.semana;
  }

  async function aplicarSugestoesSelecionadas(){
    const ids=new Set(Array.from(document.querySelectorAll('[data-ppa-check]:checked')).map(x=>Number(x.getAttribute('data-ppa-check'))));
    const lista=_sugestoes.filter((s,i)=>ids.has(i)&&!s.semMaquina);
    if(!lista.length){global.showToast?.('Selecione ao menos uma sugestão.','error');return;}
    const executar=async()=>{
      try{
        const agora=new Date().toISOString(); let gravadas=0;
        for(const s of lista){
          const snapshot=typeof global.buildProducaoConfigSnapshot==='function'?global.buildProducaoConfigSnapshot(s.produtoCad,s.maquinaCad,s.pcMin,s.unidPorCx):null;
          await fs().collection(COL_REGISTROS).add({
            produto:s.produto,prodCod:s.cod,maquina:s.maquina,pcMin:s.pcMin,unidPorCx:s.unidPorCx,
            qntCaixas:s.qtyCaixas,qntUnid:s.qtyCaixas*s.unidPorCx,categoria:s.maquinaCad?.categoria||'',
            status:'pendente',data:(s.distribuicao?.[0]?.data)||s.semana,horaInicio:'',
            obs:'Gerada pela Programação Automática V341',origem:'programacao_automatica',semanaPlanejada:s.semana,
            distribuicaoPlanejada:s.distribuicao||[],setupPrevistoMin:s.setupMin||0,
            ...(snapshot?{configSnapshot:snapshot}:{}),sortOrder:Date.now()+gravadas,criadoEm:agora,atualizadoEm:agora,
          }); gravadas++;
        }
        global.showToast?.(`${gravadas} OP(s) aplicadas à Programação/Gantt.`,'success');
        _registros=[]; _carregado=false; _sugestoes=[]; _auditoria=[]; _simulacao=false; await carregarProgAutomatica(true); _desenharProgAutomatica();
      }catch(e){global.showToast?.('Erro ao aplicar: '+(e.message||e),'error');}
    };
    if(global.showConfirm)global.showConfirm(`Aplicar ${lista.length} sugestão(ões) na Programação?`,executar,{title:'Aplicar programação automática',icon:'🤖',okLabel:'Aplicar'});else if(confirm('Aplicar sugestões?'))await executar();
  }

  global.renderProducaoProgAutomatica=renderProducaoProgAutomatica;
  global.gerarProducaoAutomaticaAvancada=gerarSugestoes;
  global.aplicarProducaoAutomatica=aplicarSugestoesSelecionadas;

  document.addEventListener('click',e=>{
    if(e.target.closest('[data-ppa-gerar]')){gerarSugestoes(false);return;}
    if(e.target.closest('[data-ppa-recalcular]')){gerarSugestoes(false);return;}
    if(e.target.closest('[data-ppa-simular]')){gerarSugestoes(true);return;}
    if(e.target.closest('[data-ppa-aplicar]')){aplicarSugestoesSelecionadas();return;}
    if(e.target.hasAttribute('data-ppa-check-todos')){document.querySelectorAll('[data-ppa-check]').forEach(c=>{if(!c.disabled)c.checked=e.target.checked;});}
  });
  document.addEventListener('change',e=>{
    if(e.target?.name==='ppa-modo')_desenharProgAutomatica();
    if(e.target?.id==='ppa-maq-filter')_desenharProgAutomatica();
    const chk=e.target?.closest?.('[data-ppa-check]'); if(chk){const i=Number(chk.getAttribute('data-ppa-check'));if(_sugestoes[i])_sugestoes[i].selecionada=chk.checked;}
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _registros=[]; _maquinas=[]; _produtos=[]; _fichas=[]; _setups=[]; _insumosEstoque=[]; _sugestoes=[]; _auditoria=[]; _simulacao=false; });
})(window);
