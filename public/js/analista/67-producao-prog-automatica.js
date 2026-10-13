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
  // PEDIDO AO VIVO (2026-09-07): "a produção vai ser baseada em cima do
  // saldo, se o saldo está negativo ele tem que pôr o saldo pra chegar a
  // zero e depois repor pra chegar aos trinta dias. Pra não produzir e
  // acabar tendo pedido e já vai zerar logo em seguida" — mesma coleção e
  // mesma fórmula de "comprometido" já usadas em 78-pcp-central.js
  // (construirVisao), só que aplicadas aqui pra descontar do estoque ANTES
  // de calcular a necessidade de produção, não só pra decidir compra.
  const COL_PEDIDOS = 'pcp_pedidos';
  const DIA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  let _produtos = [], _maquinas = [], _registros = [], _setups = [], _fichas = [], _insumosEstoque = [], _pedidos = [];
  let _carregado = false, _sugestoes = [], _auditoria = [], _simulacao = false, _semanasCalculo = [];

  function fs(){ return global.getDTFirestore(); }
  function inicioSemana(d){
    const r=new Date(d); r.setHours(12,0,0,0);
    const dia=r.getDay();
    r.setDate(r.getDate()-(dia===0?6:dia-1));
    return r;
  }
  function iso(d){ return d.toISOString().slice(0,10); }
  function fmt(d){ return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}); }
  function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
  function n(v,def=0){ const x=Number(v); return Number.isFinite(x)?x:def; }
  function norm(v){ return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim(); }
  function texto(v){return String(v??'').trim();}
  function variantesChave(v){const s=texto(v);if(!s)return[];const a=[s];if(/^\d+$/.test(s))a.push(String(Number(s)));return Array.from(new Set(a.filter(Boolean)));}
  function codigoProduto(p){return texto(p?.cod??p?.codigo??p?.COD??p?.CODIGO??p?.produtoKey??p?.produto_key??p?.bluesoftProdutoKey??p?._firestoreId);}
  function aliasesProduto(p){return [codigoProduto(p),p?.cod,p?.codigo,p?.COD,p?.CODIGO,p?.produtoKey,p?.produto_key,p?.bluesoftProdutoKey,p?.produtoUnitarioKeyBluesoft,p?.produtoUnitarioKey,p?.gtin,p?.ean].flatMap(variantesChave);}

  async function carregarProgAutomatica(forcar){
    if(_carregado && !forcar) return;
    await global.carregarProducaoProjecao?.(forcar);
    // Carrega a fonte oficial de estoque de insumos diretamente nesta tela.
    // Assim a Programação Automática não depende de PCP Central/Ins. Produção
    // terem sido abertas antes. Firestore fica apenas como fallback técnico se
    // o BI estiver indisponível.
    let biInsumos=[];
    try{ biInsumos=await global.DTProducaoInsumosBI?.carregar?.(forcar)||[]; }catch(_){ biInsumos=[]; }
    const estoquePromise=biInsumos.length
      ? Promise.resolve({docs:[]})
      : fs().collection(COL_INSUMOS_ESTOQUE).get().catch(()=>({docs:[]}));
    const [p,m,r,s,f,i,ped]=await Promise.all([
      fs().collection(COL_PRODUTOS).get(), fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_REGISTROS).get(), fs().collection(COL_SETUP).get(),
      fs().collection(COL_FICHAS).get(), estoquePromise,
      // best-effort: sem permissão de PCP ou coleção vazia, o desconto de
      // comprometido simplesmente fica 0 pra todo mundo — nunca trava a
      // Programação Automática por causa disso.
      fs().collection(COL_PEDIDOS).get().catch(()=>({docs:[]})),
    ]);
    _produtos=p.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _maquinas=m.docs.map(d=>({_firestoreId:d.id,...d.data()})).filter(x=>x.ativo!==false && x.status!=='inativa');
    _registros=r.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _setups=s.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _fichas=f.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _insumosEstoque=i.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _pedidos=ped.docs.map(d=>({_firestoreId:d.id,...d.data()}));
    _carregado=true;
  }

  function produtoCad(proj){
    const alvo=new Set(aliasesProduto(proj));
    return _produtos.find(p=>aliasesProduto(p).some(k=>alvo.has(k))) ||
      _produtos.find(p=>norm(p.nome||p.descricao||p.desc)===norm(proj.produto));
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
  function caixasRestantesRegistro(r){
    if(norm(r.status)==='CONCLUIDO') return 0;
    const total=n(r.qntCaixas??r.quantidadeCaixas??r.qtdCaixas);
    const feito=n(r.qntProduzida??r.qtdProduzida??r.realizadoCx??r.caixasRealizadas);
    return Math.max(0,total-feito);
  }
  function producaoProgramadaNaSemana(estado,week){
    const aliases=new Set(aliasesProduto(estado.prod));
    return _registros.reduce((s,r)=>{
      const data=texto(r.data??r.dtDesejada??r.dtSolicitacao);
      if(!data||data<iso(week.inicio)||data>iso(week.fim))return s;
      const mesmoCodigo=aliasesProduto({cod:r.prodCod??r.cod??r.codigo}).some(k=>aliases.has(k));
      const mesmoNome=norm(r.produto)===norm(estado.prod.nome||estado.prod.descricao||estado.proj.produto);
      return s+(mesmoCodigo||mesmoNome?caixasRestantesRegistro(r):0);
    },0);
  }
  // PEDIDO AO VIVO (2026-09-07): mesma fórmula de "comprometido" de
  // 78-pcp-central.js (construirVisao: `pendente=max(0,qtdPedidos-atendida)`
  // somado por pedido não-cancelado) — duplicada aqui de propósito, não
  // reusada via _pcpInternals, pra não depender do módulo PCP Central estar
  // carregado (nem da permissão de PCP) só pra Programação Automática de
  // Produção funcionar. Pedido pendente é um compromisso JÁ ASSUMIDO (não
  // recorrente como a demanda semanal) — por isso entra só UMA VEZ, no
  // estoque inicial (antes da semana 0), não a cada semana.
  function comprometidoDoProduto(estado){
    const aliases=new Set(aliasesProduto(estado.prod));
    return _pedidos.reduce((s,x)=>{
      if(/cancel/i.test(String(x.status||'')))return s;
      const mesmoCodigo=aliasesProduto({cod:x.prodCod??x.cod??x.codigo}).some(k=>aliases.has(k));
      const mesmoNome=norm(x.produto)===norm(estado.prod.nome||estado.prod.descricao||estado.proj.produto);
      if(!mesmoCodigo&&!mesmoNome)return s;
      return s+Math.max(0,n(x.quantidade)-n(x.quantidadeAtendida));
    },0);
  }
  function setupMin(maquina,orig,dest){ return global.getSetupMin?.(maquina,orig,dest,_setups)||0; }

  function canonInsumo(v){return norm(v).replace(/^\s*\d+[^A-Z0-9]*/,'').replace(/^\s*(MP|MAT(?:ERIA)?\s*PRIMA|MATERIA\s*PRIMA|LOGISTICA)[^A-Z0-9]+/,'').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
  // Fonte única da Produção: dados-insumos.json via serviço compartilhado.
  // Não depende de PCP Central estar aberto. Firestore existe só como
  // compatibilidade quando a API do BI estiver realmente indisponível.
  function estoqueInsumosMap(){
    const m=new Map(),bi=global.DTProducaoInsumosBI?.get?.()||[];
    if(bi.length){
      bi.forEach(i=>{const nome=i.produto||i.insumo||i.nome||'';const saldo=n(i.estoque??i.quantidade);if(nome)m.set(canonInsumo(nome),saldo);});
      return m;
    }
    _insumosEstoque.forEach(i=>{const nome=i.insumo||i.nome||i.produto||'';if(nome)m.set(canonInsumo(nome),n(i.quantidade??i.estoqueAtual??i.estoque));});
    return m;
  }
  function maxCaixasPorInsumos(prod,qtdDesejada,mapa){
    const ficha=fichaCad(prod); if(!ficha || !(ficha.insumos||[]).length) return {max:qtdDesejada, faltas:[]};
    let max=qtdDesejada; const faltas=[];
    (ficha.insumos||[]).forEach(i=>{
      const porCx=n(i.qty); if(porCx<=0)return;
      const saldo=n(mapa.get(canonInsumo(i.insumo)),0);
      const poss=Math.floor(saldo/porCx);
      max=Math.min(max,poss);
      if(poss<qtdDesejada) faltas.push({insumo:i.insumo,necessario:qtdDesejada*porCx,disponivel:saldo,possivelCx:poss});
    });
    return {max:Math.max(0,max),faltas};
  }
  function consumirInsumos(prod,cx,mapa){
    const ficha=fichaCad(prod); if(!ficha)return;
    (ficha.insumos||[]).forEach(i=>{ const q=n(i.qty)*cx; const k=canonInsumo(i.insumo); mapa.set(k,Math.max(0,n(mapa.get(k))-q)); });
  }

  function parametros(){
    const coberturaMin=Math.max(1,n(document.getElementById('ppa-cobertura-min')?.value,30));
    // O alvo nunca pode ficar abaixo do próprio gatilho de reposição. Antes
    // o padrão era mínimo=30 e alvo=20: o item entrava na fila por estar
    // abaixo de 30d e a própria produção o deixava em apenas 20d, portanto
    // continuava em falta na rodada seguinte. Mantém os mesmos campos e
    // leituras; corrige somente a regra matemática.
    const coberturaAlvo=Math.max(coberturaMin,Math.max(1,n(document.getElementById('ppa-cobertura-alvo')?.value,30)));
    return {
      modo:document.querySelector('input[name="ppa-modo"]:checked')?.value||'mes',
      coberturaMin,
      coberturaAlvo,
      riscoCritico:Math.max(1,n(document.getElementById('ppa-risco-critico')?.value,10)),
      maxPct:clamp(n(document.getElementById('ppa-max-pct')?.value,90)/100,.1,1),
      insumo:document.querySelector('input[name="ppa-insumo"]:checked')?.value||'total',
      fechamento:document.getElementById('ppa-fechamento')?.value||'mes-seguinte',
      semana:document.getElementById('ppa-semana')?.value||'',
      mes:document.getElementById('ppa-mes')?.value||'',
    };
  }
  function inicioPlanejamento(p){
    if(p.modo==='semana' && p.semana) return inicioSemana(new Date(p.semana+'T12:00:00'));
    if(p.modo==='mes' && p.mes){ const [y,m]=p.mes.split('-').map(Number); return inicioSemana(new Date(y,m-1,1,12)); }
    return inicioSemana(new Date());
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
  // PEDIDO AO VIVO (2026-09-07): "ficou um negócio estranho, produzindo o
  // mesmo produto várias vezes em vários dias... vamos supor a canjica
  // branca, vinte e cinco caixas por dia. Por que não pegou logo e não
  // produziu essas caixas todas dentro de um dia só?" — a versão anterior
  // dividia a quantidade da semana PROPORCIONALMENTE pelo peso (horas de
  // turno) de cada dia disponível, sem saber quantas caixas cabem de fato
  // num dia (não recebia a velocidade da máquina) — por isso fatiava em
  // pedacinhos iguais espalhados pela semana toda, mesmo quando o lote
  // inteiro caberia tranquilamente num único dia. Agora preenche os dias
  // em SEQUÊNCIA (igual uma produção de verdade rodando até acabar o
  // turno): cada dia recebe o quanto couber da capacidade real da máquina
  // (turno em minutos ÷ minutos por caixa), só passando pro dia seguinte
  // quando o dia atual não tem mais espaço — nunca mais fatias artificiais
  // menores que o necessário.
  // PEDIDO AO VIVO (2026-09-07): "cada [produto] é vinte e oito vírgula
  // zero cinco por minuto, pacotinhos" — pcMin é UNIDADES POR MINUTO, não
  // caixas por hora (confirmado batendo com 63-producao-agenda.js:
  // `cxPerMin=pcMin/unidPorCx` — e com 62-producao-programacao.js:
  // `_calcTempoHoras=qntUnid/pcMin/60`, os dois já certos). Esta função (e
  // o cálculo principal logo abaixo) usava `60/pcMin`, tratando pcMin como
  // caixas/hora — superestimava o tempo de produção em ~5x pros valores
  // reais do usuário, fazendo o motor "achar" que a máquina já estava
  // cheia bem antes da capacidade de verdade acabar. minCx (minutos por
  // caixa) precisa de unidPorCx pra converter certo: unidPorCx/pcMin.
  function distribuirDias(cx,week,maquina,pcMin,unidPorCx){
    const dias=[]; let pesosMin=[];
    for(let i=0;i<7;i++){
      const d=new Date(week.inicio);d.setDate(d.getDate()+i); if(d>week.fim)break;
      const t=(maquina.turnos?.[d.getDay()]||maquina.turnos?.[String(d.getDay())]||[]).filter(x=>x&&x.ativo!==false);
      const peso=t.length?t.reduce((s,f)=>{const [h1,m1]=String(f.ini||'00:00').split(':').map(Number),[h2,m2]=String(f.fim||'00:00').split(':').map(Number);let a=h1*60+m1,b=h2*60+m2;if(b<=a)b+=1440;return s+Math.max(0,b-a)},0):(d.getDay()>=1&&d.getDay()<=5?540:0);
      if(peso>0){dias.push(d);pesosMin.push(peso);}
    }
    if(!dias.length) return [];
    const minCx=n(pcMin)>0?Math.max(1,n(unidPorCx,1))/n(pcMin):0;
    let restante=cx; const out=[];
    for(let i=0;i<dias.length && restante>0;i++){
      const capDiaCx=minCx>0?Math.floor(pesosMin[i]/minCx):restante; // sem velocidade conhecida, não fragmenta — usa o resto todo
      const q=Math.max(0,Math.min(restante,capDiaCx));
      if(q>0){ out.push({data:iso(dias[i]),caixas:q,dia:DIA[dias[i].getDay()]}); restante-=q; }
    }
    // Sobra que não coube em nenhum turno disponível na semana: não pode
    // desaparecer — empilha no último dia disponível (mesma regra que já
    // existia pro resto da divisão proporcional antiga).
    if(restante>0){
      const ultimo=dias[dias.length-1], data=iso(ultimo), dia=DIA[ultimo.getDay()];
      const existente=out.find(x=>x.data===data);
      if(existente) existente.caixas+=restante; else out.push({data,caixas:restante,dia});
    }
    return out;
  }

  // Mesma regra do original (buildPlanejamento, app.js:13986-13991): 1º dia
  // ÚTIL da máquina dentro da semana (olhando os turnos cadastrados dela);
  // sem turno algum na semana toda, cai na própria segunda-feira. É a data
  // que vai no registro — quem espalha a produção pelos dias de verdade é
  // o motor de agenda (buildProducaoSchedule) na hora de desenhar o Gantt,
  // não esta função.
  function primeiroDiaUtil(week,maquina){
    for(let i=0;i<7;i++){
      const d=new Date(week.inicio); d.setDate(d.getDate()+i); if(d>week.fim) break;
      const min=typeof global.getTurnoMinutosDoDia==='function'?global.getTurnoMinutosDoDia(maquina,d.getDay()):(d.getDay()>=1&&d.getDay()<=5?540:0);
      if(min>0) return iso(d);
    }
    return iso(week.inicio);
  }

  // PEDIDO AO VIVO (2026-09-03): "no original ele mostra o produto aí, qual
  // semana vai produzir, a quantidade" — comparado com renderProgAutomatica
  // Resultado do original (app.js:13748): a tabela de lá é UMA LINHA POR
  // PRODUTO, consolidando as até 4 semanas (Semana 1 / Total Mês / mini
  // barra das 4 semanas), nunca uma linha por evento de alocação como
  // estava aqui. O motor por baixo (round-robin) continua o mesmo — só
  // troca ONDE cada alocação é registrada: em vez de _sugestoes.push a
  // cada `cx` alocado, acumula num Map por produto (_juntarEventoProduto)
  // e só no final consolida pra 1 linha por produto (_consolidarSugestoes).
  function _buildMotivo(cob,riscoLim,cobMin){
    if(cob<=0) return '🔴 Estoque zerado — produção imediata';
    if(cob<=riscoLim) return `🔴 Ruptura em ${cob.toFixed(1)}d — produção urgente`;
    if(cob<=cobMin) return `🟠 Abaixo do mínimo (${cobMin}d) — cobertura atual ${cob.toFixed(1)}d`;
    if(cob<=cobMin*2) return `🟡 Vai cair abaixo do mínimo — cobertura atual ${cob.toFixed(1)}d`;
    return `🟢 Reposição preventiva — cobertura ${cob.toFixed(1)}d`;
  }
  async function gerarSugestoes(simulacao=false){
    const p=parametros(); _simulacao=!!simulacao;
    const proj=global.calcularProjecaoComRisco?.(document.getElementById('pproj-metodo')?.value||'simples')||[];
    // PEDIDO AO VIVO (2026-09-07): "calcula certo, mas quando vai pra
    // Programação Visual fica tudo errado" — investigando, achado um risco
    // real: aplicarSugestoesSelecionadas() recalculava `semanas` do zero a
    // partir do formulário (parametros()+semanasPlanejamento()) no momento
    // do clique em Aplicar, em vez de reusar as MESMAS semanas que geraram
    // `_sugestoes` (detalhesSemanas[0..3] é posicional — depende de bater
    // exatamente com as datas usadas no cálculo). Se o período no formulário
    // mudar entre "Gerar/Recalcular" e "Aplicar" (ex.: o seletor de semana
    // se reconstrói a cada render com base em "hoje", ou o usuário troca de
    // mês/semana sem recalcular de novo antes de aplicar), as OPs eram
    // gravadas nas datas ERRADAS — o motor calculou certo, só a gravação
    // podia ir pra semana/mês errado. Agora as semanas usadas no cálculo
    // ficam congeladas em `_semanasCalculo` e Aplicar reusa exatamente elas,
    // nunca recalcula por conta própria.
    const semanas=semanasPlanejamento(p); _semanasCalculo=semanas;
    const insumos=estoqueInsumosMap();
    const carga=new Map(), ultimo=new Map(); _auditoria=[];
    const porProduto=new Map(); // cod -> registro consolidado (ver _juntarEventoProduto)
    const semMaquina=new Map(); // cod -> {cod,produto,semMaquina:true,...}
    semanas.forEach(w=>_maquinas.forEach(m=>{
      const key=m.nome+'|'+iso(w.inicio), cap=capacidadeMinSemana(m,w.inicio), usada=cargaExistenteMin(m,w.inicio);
      carga.set(key,{cap,usada,novas:0,porProduto:new Map()}); ultimo.set(key,ultimoProdutoNaMaquina(m.nome));
    }));

    const estados=proj.map(x=>{
      const prod=produtoCad(x); const demandaSem=n(x.projSemanal);
      // PEDIDO AO VIVO (2026-09-07): "se o saldo está negativo ele tem que
      // pôr o saldo pra chegar a zero e depois repor pra chegar aos trinta
      // dias" — desconta pedidos pendentes (comprometido) do estoque JÁ NA
      // PARTIDA (antes da semana 0), uma vez só (não é recorrente como a
      // demanda semanal). Pode deixar o estoque inicial NEGATIVO de
      // propósito — a fórmula de necessidade (alvo-estoque) já lida com
      // isso normalmente, aumentando a necessidade sozinha, sem precisar
      // de nenhum caso especial.
      const comprometido=prod?comprometidoDoProduto({prod,proj:x}):0;
      return {proj:x,prod,demandaSem,estoque:n(x.estoqueAtual)-comprometido,produzido:0};
    }).filter(x=>x.prod && x.prod.ativo!==false && x.demandaSem>0);

    function registro(e){
      if(!porProduto.has(e.proj.cod)){
        const diaria=e.demandaSem/7, cobInicial=diaria>0?e.estoque/diaria:9999;
        porProduto.set(e.proj.cod,{
          cod:e.proj.cod,produto:e.proj.produto,produtoCad:e.prod,
          coberturaAtual:cobInicial,estoque:e.estoque,demandaSemanal:e.demandaSem,
          risco:cobInicial<=p.riscoCritico?'critico':'baixo',motivo:_buildMotivo(cobInicial,p.riscoCritico,p.coberturaMin),
          unidPorCx:Math.max(1,n(e.prod.unid,1)),
          semanas:[0,0,0,0],minutosSemanas:[0,0,0,0],detalhesSemanas:[[],[],[],[]],
          maquinasCx:new Map(),insumoFaltas:new Map(),distribuicaoS1:new Map(),
          coberturaPos:cobInicial,
        });
      }
      return porProduto.get(e.proj.cod);
    }

    for(const w of semanas){
      // Igual ao original: OP já criada e ainda não concluída entra no saldo
      // projetado na semana em que será produzida. Sem isso o motor sugere
      // novamente uma quantidade que já está no Gantt.
      estados.forEach(e=>e.estoque+=producaoProgramadaNaSemana(e,w));
      // consumo previsto ocorre antes de calcular necessidade da semana; para a primeira,
      // preservamos o estoque atual como ponto de partida.
      if(w.index>0) estados.forEach(e=>e.estoque=Math.max(0,e.estoque-e.demandaSem));
      // PEDIDO AO VIVO (2026-09-07): "os cálculos não estão certos... mudo
      // pra semana e recalculo, as horas continuam as mesmas" — achado por
      // rastreamento empírico (não suposição): `fila` era montada com
      // `{...e,...}` (CÓPIA rasa por elemento), então `e.estoque+=cx`
      // dentro do round-robin só mutava a cópia daquela semana — nunca
      // voltava pro array `estados`, que é a fonte usada pra montar a
      // `fila` da semana SEGUINTE. Resultado: toda semana recomeçava o
      // cálculo de necessidade a partir do estoque ORIGINAL (menos só o
      // consumo já subtraído direto em `estados`), completamente cega à
      // produção que ela mesma tinha acabado de sugerir na semana anterior
      // — produzindo cada vez mais, semana após semana, sem nunca
      // reconhecer que o estoque projetado já tinha sido reabastecido.
      // Fix: `fila` guarda os MESMOS objetos de `estados` (só acrescenta
      // cob/prioProduto/prio), não cópias — mutações em .estoque/.produzido
      // durante o round-robin agora persistem de verdade entre semanas.
      const fila=estados.map(e=>{
        const diaria=e.demandaSem/7, cob=diaria>0?e.estoque/diaria:9999;
        const prioProduto=Math.max(1,n(e.prod.prioridadeProducao,2));
        e.cob=cob; e.prioProduto=prioProduto; e.prio=prioridade(cob,p.riscoCritico,p.coberturaMin,w.index)+Math.max(0,(4-prioProduto))*200;
        return e;
      }).filter(e=>e.cob<p.coberturaMin).sort((a,b)=>b.prio-a.prio || a.cob-b.cob);
      // PEDIDO AO VIVO (2026-09-07): "tem produto que está com onze dias,
      // no final da produção está ficando com doze" — achado com repro
      // isolada (não suposição): registro() só criava a linha consolidada
      // NA HORA da 1ª alocação bem-sucedida, ou seja, DEPOIS de
      // `e.estoque+=cx` já ter somado a primeira caixa alocada — a coluna
      // "Cobertura Atual"/"Estoque" mostrada na tabela nascia com o valor
      // JÁ PARCIALMENTE PRODUZIDO, não o valor real de antes de calcular.
      // Isso escondia o quanto a produção realmente melhorou a cobertura
      // (o antes ficava artificialmente perto do depois). Agora a linha é
      // criada aqui, ANTES de qualquer alocação desta semana — captura o
      // estado de verdade.
      fila.forEach(e=>registro(e));

      // PEDIDO AO VIVO (2026-09-07), varredura geral: "bate o código
      // original, aplica do jeito que ele faz" — depois de 3 rodadas de
      // remendo em cima do meu round-robin próprio (chunk de 1/3 por
      // passagem + bônus de continuidade/concentração) sem convencer o
      // usuário, fui ler o motor de verdade do original (app.js:12409,
      // "LOOP PRINCIPAL") e portei a lógica dele, que é mais simples E mais
      // robusta: cada produto (em ordem de prioridade) tenta resolver a
      // NECESSIDADE INTEIRA da semana numa passada só — não fatiada em 1/3
      // — contra a capacidade que sobrar NAQUELE INSTANTE. "Concentração":
      // procura primeiro 1 máquina que sozinha absorve tudo; só divide (no
      // máximo 2 máquinas, igual ao original) quando nenhuma sozinha dá
      // conta. MAX_PASSES=8 (igual ao original) é uma rede de segurança —
      // como cada produto já tenta pegar tudo que precisa na 1ª passada,
      // raramente uma 2ª faz diferença; não existe mais o conceito de
      // "continuidade" porque não é mais necessário: a máquina que sozinha
      // resolve tudo já é achada direto, sem precisar de bônus artificial
      // brigando contra o placar de carga.
      for(let pass=0;pass<8;pass++){
        let algumAlocado=false;
        for(const e of fila){
          // PEDIDO AO VIVO (2026-09-07): "mudo a cobertura ali... aí se eu
          // mudar pra trinta, em vez de aumentar a quantidade não aumenta"
          // — o produto tinha uma meta própria (metaCoberturaDias/
          // coberturaDias, configurável em PCP → Parâmetros) que vencia o
          // slider da tela sem avisar. Decisão do usuário: o controle desta
          // tela manda sempre — a meta por produto deixa de valer aqui
          // (continua existindo/configurável, só não participa mais deste
          // cálculo).
          const diaria=e.demandaSem/7, alvoDias=Math.max(p.coberturaMin,Math.max(1,n(p.coberturaAlvo,30))), alvo=diaria*alvoDias;
          let necessidade=Math.max(0,Math.ceil(alvo-e.estoque));
          const minimo=Math.max(0,n(e.prod.producaoMinima));
          const multiplo=Math.max(0,n(e.prod.multiploProducao));
          if(necessidade>0 && minimo>0 && necessidade<minimo) necessidade=minimo;
          if(necessidade>0 && multiplo>0) necessidade=Math.ceil(necessidade/multiplo)*multiplo;
          if(necessidade<=0) continue;
          const comps=maquinasCompativeis(e.prod); if(!comps.length){
            if(!semMaquina.has(e.proj.cod)) semMaquina.set(e.proj.cod,{cod:e.proj.cod,produto:e.proj.produto,semMaquina:true,semana:iso(w.inicio),coberturaAtual:e.cob,motivo:'Sem máquina compatível'});
            continue;
          }
          if(p.insumo==='limitado') necessidade=maxCaixasPorInsumos(e.prod,necessidade,insumos).max;
          if(necessidade<=0) continue;

          const unidPorCx=Math.max(1,n(e.prod.unid,1));
          const candidatos=comps.map(c=>{
            const key=c.maquina.nome+'|'+iso(w.inicio), st=carga.get(key), prev=ultimo.get(key)||'';
            const setup=setupMin(c.maquina,prev,e.prod.nome); const minCx=unidPorCx/Math.max(.0001,c.pcMin);
            const prodUsado=st.porProduto.get(norm(e.prod.nome))||0;
            const limiteProdutoMin=st.cap*p.maxPct;
            const dispMin=Math.max(0,st.cap-st.usada-st.novas-setup);
            const dispProdMin=Math.max(0,limiteProdutoMin-prodUsado);
            const poss=Math.floor(Math.min(dispMin,dispProdMin)/minCx);
            const cargaPct=st.cap>0?(st.usada+st.novas)/st.cap:999;
            return {...c,key,st,setup,minCx,prodUsado,poss,score:cargaPct*10000+setup*8+(1000/Math.max(1,c.pcMin))};
          }).filter(c=>c.poss>0);
          if(!candidatos.length) continue;

          // Concentração: 1 máquina que sozinha resolve tudo tem prioridade
          // absoluta sobre espalhar por várias — só divide (máx. 2) quando
          // nenhuma dá conta inteira.
          const absorve=candidatos.find(c=>c.poss>=necessidade);
          const usar=absorve?[absorve]:[...candidatos].sort((a,b)=>a.score-b.score).slice(0,2);

          let restante=necessidade;
          for(const c of usar){
            if(restante<=0) break;
            const cx=Math.min(restante,c.poss);
            if(cx<=0) continue;
            let faltas=[];
            let cxFinal=cx;
            if(p.insumo==='limitado'){ const lim=maxCaixasPorInsumos(e.prod,cx,insumos); cxFinal=lim.max; faltas=lim.faltas; }
            else faltas=maxCaixasPorInsumos(e.prod,cx,insumos).faltas;
            if(cxFinal<=0) continue;
            const minutos=cxFinal*c.minCx+c.setup;
            c.st.novas+=minutos; c.st.porProduto.set(norm(e.prod.nome),c.prodUsado+minutos); ultimo.set(c.key,e.prod.nome);
            if(p.insumo==='limitado') consumirInsumos(e.prod,cxFinal,insumos);
            e.estoque+=cxFinal; e.produzido+=cxFinal; restante-=cxFinal; algumAlocado=true;
            const novaCob=diaria>0?e.estoque/diaria:9999;
            const reg=registro(e);
            reg.semanas[w.index]+=cxFinal; reg.minutosSemanas[w.index]+=minutos;
            reg.detalhesSemanas[w.index].push({maquina:c.maquina.nome,maquinaCad:c.maquina,cx:cxFinal,pcMin:c.pcMin,setupMin:c.setup,minutos});
            reg.maquinasCx.set(c.maquina.nome,(reg.maquinasCx.get(c.maquina.nome)||0)+cxFinal);
            reg.coberturaPos=novaCob;
            faltas.forEach(f=>{ if(!reg.insumoFaltas.has(f.insumo)) reg.insumoFaltas.set(f.insumo,f); });
            if(w.index===0) distribuirDias(cxFinal,w,c.maquina,c.pcMin,unidPorCx).forEach(d=>{
              const atual=reg.distribuicaoS1.get(d.data)||{data:d.data,dia:d.dia,caixas:0};
              atual.caixas+=d.caixas; reg.distribuicaoS1.set(d.data,atual);
            });
          }
        }
        if(!algumAlocado) break;
      }
    }

    semanas.forEach(w=>_maquinas.forEach(m=>{
      const key=m.nome+'|'+iso(w.inicio), st=carga.get(key); if(!st)return;
      _auditoria.push({maquina:m.nome,semana:iso(w.inicio),capacidade:st.cap,existente:st.usada,nova:st.novas,total:st.usada+st.novas,pct:st.cap>0?(st.usada+st.novas)/st.cap*100:0});
    }));

    // ── Consolidação final: 1 linha por produto (Semana 1 / Total Mês /
    // mini plano de 4 semanas), igual ao renderProgAutomaticaResultado do
    // original — nunca 1 linha por evento de alocação.
    const semana0=semanas[0];
    _sugestoes=[...porProduto.values()].map(reg=>{
      const maquinaPrincipal=[...reg.maquinasCx.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
      const maquinasUsadas=[...reg.maquinasCx.keys()];
      const capSemana1=maquinaPrincipal?capacidadeMinSemana(_maquinas.find(m=>m.nome===maquinaPrincipal)||{nome:maquinaPrincipal},semana0.inicio):0;
      const pctMaquina=capSemana1>0?Math.min(100,reg.minutosSemanas[0]/capSemana1*100):0;
      return {
        cod:reg.cod,produto:reg.produto,produtoCad:reg.produtoCad,motivo:reg.motivo,risco:reg.risco,
        estoque:reg.estoque,demandaSemanal:Math.round(reg.demandaSemanal),
        coberturaAtual:reg.coberturaAtual,coberturaPos:reg.coberturaPos,
        qtyCaixas:reg.semanas[0],cxAlocadasTotal:reg.semanas.reduce((s,v)=>s+v,0),semanasArr:reg.semanas,
        minutos:reg.minutosSemanas[0],minutosTotal:reg.minutosSemanas.reduce((s,v)=>s+v,0),
        maquina:maquinaPrincipal,maquinasUsadas,pctMaquina,
        unidPorCx:reg.unidPorCx,insumoFaltas:[...reg.insumoFaltas.values()],
        distribuicao:[...reg.distribuicaoS1.values()],detalhesSemanas:reg.detalhesSemanas,
        selecionada:true,
      };
    }).sort((a,b)=>(b.risco==='critico')-(a.risco==='critico') || a.coberturaAtual-b.coberturaAtual);
    _sugestoes.push(...[...semMaquina.values()]);
    _desenharProgAutomatica();
  }

  async function renderProducaoProgAutomatica(){
    const pagina=document.getElementById('page-producao-prog-automatica'); if(!pagina)return;
    pagina.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    // A tela depende de projeção, estoque, produtos, máquinas e OPs. Sempre
    // relê ao abrir para não calcular usando o cache vazio de outra loja ou
    // dados anteriores à última sincronização.
    try{await carregarProgAutomatica(true);}catch(e){pagina.innerHTML='<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">'+esc(e.message||e)+'</div></div>';return;}
    _desenharProgAutomatica();
  }
  function optionsSemanas(){
    const base=inicioSemana(new Date()); return Array.from({length:8},(_,i)=>{const d=new Date(base);d.setDate(d.getDate()+i*7);const f=new Date(d);f.setDate(f.getDate()+6);return `<option value="${iso(d)}">${fmt(d)} – ${fmt(f)} / ${d.getFullYear()}</option>`}).join('');
  }
  function optionsMeses(){
    const d=new Date(); return Array.from({length:6},(_,i)=>{const x=new Date(d.getFullYear(),d.getMonth()+i,1);const v=x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0');return `<option value="${v}">${x.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</option>`}).join('');
  }
  // PEDIDO AO VIVO (2026-09-03): "no original ele mostra o produto aí, qual
  // semana vai produzir, a quantidade" comparado por print lado a lado — o
  // original agrupa a tabela POR MÁQUINA (card com nome + badge "N
  // crítico(s)" + resumo de cx/tempo/%máquina no cabeçalho, sugestões
  // daquela máquina embaixo), não uma lista corrida com a máquina numa
  // coluna. O motor (gerarSugestoes) já calculava tudo certo — só a tabela
  // não agrupava. _auditoria já tinha a capacidade por máquina/semana
  // calculada; só faltava mostrar por linha (coluna %Máq.) e no cabeçalho
  // do grupo (média das semanas visíveis daquela máquina).
  function fmtHrsMin(min){ const h=Math.floor(min/60), m=Math.round(min%60); return h+'h'+String(m).padStart(2,'0')+'min'; }
  // PEDIDO AO VIVO (2026-09-03, 2ª rodada): comparado direto com
  // renderProgAutomaticaResultado do original (app.js:13748) — cada linha
  // ali é 1 PRODUTO consolidado (não 1 evento de alocação), com colunas
  // Motivo/Risco, Estoque, Cob. Atual, Dem. Sem., Semana 1, Total Mês,
  // Tempo, %Máq. (com barrinha), Cob. Final, Insumos (clicável, expande
  // detalhe) e Distribuição (pills do dia da S1 + mini-plano das 4
  // semanas). gerarSugestoes() já consolida assim agora — só faltava a
  // tabela render.
  function _grupoMaquinaHtml(maquina,linhas){
    const criticos=new Set(linhas.filter(s=>s.risco==='critico').map(s=>s.cod)).size;
    const semInsumo=linhas.filter(s=>s.insumoFaltas?.length).length;
    const totalCxS1=linhas.reduce((s,x)=>s+n(x.qtyCaixas),0);
    const totalCxMes=linhas.reduce((s,x)=>s+n(x.cxAlocadasTotal),0);
    const totalHrs=linhas.reduce((s,x)=>s+n(x.minutos),0)/60;
    const audMaq=_auditoria.filter(a=>a.maquina===maquina);
    const pctMedio=audMaq.length?audMaq.reduce((s,a)=>s+a.pct,0)/audMaq.length:null;
    const coxMesLabel=totalCxMes>totalCxS1?` · ${totalCxMes.toLocaleString('pt-BR')} cx/mês`:'';
    const linhasHtml=linhas.map(s=>{
      const idx=_sugestoes.indexOf(s);
      const cobColor=s.risco==='critico'?'var(--danger)':'var(--orange)';
      const maqExtra=(s.maquinasUsadas||[]).filter(m=>m!==maquina);
      const semanas=s.semanasArr||[s.qtyCaixas||0,0,0,0];
      const maxSem=Math.max(...semanas,1);
      const semPills=semanas.map((cx,i)=>`<div style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;min-width:34px"><div style="font-size:.58rem;color:var(--muted)">S${i+1}</div><div style="height:4px;width:34px;background:var(--border);border-radius:2px"><div style="height:4px;width:${Math.round(cx/maxSem*34)}px;background:${i===0?'var(--cyan)':'rgba(34,211,238,.5)'};border-radius:2px"></div></div><div style="font-size:.6rem;color:${i===0?'var(--cyan)':'var(--muted)'};font-weight:${i===0?700:400}">${cx>0?cx+'cx':'—'}</div></div>`).join('');
      const dayPills=(s.distribuicao||[]).map(d=>`<span class="badge" style="font-size:.6rem">${esc(d.dia)} ${d.caixas}cx</span>`).join(' ');
      const insId='ppa-ins-'+idx;
      const insBadge=s.insumoFaltas?.length
        ? `<span style="cursor:pointer" class="badge b-orange" data-ppa-ins-toggle="${insId}" title="${esc(s.insumoFaltas.map(f=>f.insumo).join(', '))}">⚠️ ${s.insumoFaltas.length} falta(s) ▾</span>`
        : '<span class="badge b-green">OK</span>';
      const insDetalhe=s.insumoFaltas?.length?`<tr id="${insId}" style="display:none"><td colspan="12" style="padding:8px 14px;background:var(--surface-2)"><div style="font-size:.68rem;font-weight:700;color:var(--muted);margin-bottom:4px">Insumos faltando — ${esc(s.produto)}</div>${s.insumoFaltas.map(f=>`<div style="font-size:.7rem">${esc(f.insumo)}: necessário ${n(f.necessario).toLocaleString('pt-BR')} / disponível ${n(f.disponivel).toLocaleString('pt-BR')} (dá pra ${n(f.possivelCx)}cx)</div>`).join('')}</td></tr>`:'';
      return `<tr><td><input type="checkbox" data-ppa-check="${idx}" ${s.selecionada!==false?'checked':''}></td><td><b>${esc(s.produto)}</b><div style="font-size:.62rem;color:var(--muted)">Cód. ${esc(s.cod)}</div>${maqExtra.length?`<div style="font-size:.6rem;color:var(--muted)">+ ${esc(maqExtra.join(', '))}</div>`:''}</td><td style="max-width:170px;white-space:normal;font-size:.7rem">${s.motivo}</td><td>${s.estoque!=null?n(s.estoque).toLocaleString('pt-BR'):'—'}</td><td style="color:${cobColor};font-weight:700">${Number.isFinite(s.coberturaAtual)?s.coberturaAtual.toFixed(1)+'d':'—'}</td><td>${n(s.demandaSemanal).toLocaleString('pt-BR')}</td><td style="color:var(--cyan);font-weight:700">${s.qtyCaixas||'—'} cx</td><td style="color:var(--purple);font-weight:600">${s.cxAlocadasTotal||s.qtyCaixas||'—'} cx</td><td>${fmtHrsMin(s.minutosTotal||s.minutos||0)}</td><td>${s.pctMaquina!=null?s.pctMaquina.toFixed(0)+'%':'—'}</td><td style="font-weight:700">${Number.isFinite(s.coberturaPos)?s.coberturaPos.toFixed(1)+'d':'—'}</td><td>${insBadge}</td><td style="white-space:normal"><div style="margin-bottom:4px">${dayPills||'—'}</div><div style="display:flex;gap:3px">${semPills}</div></td></tr>${insDetalhe}`;
    }).join('');
    return `<div class="tc" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px"><b style="font-size:.86rem">${esc(maquina)}</b>${criticos?`<span class="badge b-red">${criticos} crítico(s)</span>`:''}${semInsumo?`<span class="badge b-orange">${semInsumo} sem insumo</span>`:''}</div>
        <div style="font-size:.7rem;color:var(--muted)">${totalCxS1.toLocaleString('pt-BR')} cx S1${coxMesLabel} · ${totalHrs.toLocaleString('pt-BR',{maximumFractionDigits:1})}h${pctMedio!=null?` · ${pctMedio.toFixed(0)}% da semana`:''}</div>
      </div>
      <div style="overflow:auto"><table class="dt-table"><thead><tr><th></th><th>Produto</th><th>Motivo / Risco</th><th>Estoque</th><th>Cob. cenário atual</th><th>Dem. Sem.</th><th>Semana 1</th><th>Total Mês</th><th>Tempo</th><th>%Máq.</th><th>Cob. cenário final</th><th>Insumos</th><th>Distribuição S1 + Plano 4 Sem.</th></tr></thead><tbody>${linhasHtml}</tbody></table></div>
    </div>`;
  }
  function _desenharProgAutomatica(){
    const pagina=document.getElementById('page-producao-prog-automatica'); if(!pagina)return;
    const p=parametros();
    const filtro=document.getElementById('ppa-maq-filter')?.value||'';
    const vis=_sugestoes.filter(s=>!filtro||s.maquina===filtro);
    const reais=_sugestoes.filter(s=>!s.semMaquina), maqSet=new Set(reais.map(s=>s.maquina));
    // PEDIDO AO VIVO (2026-09-07): "mudo pra semana e recalculo... as horas
    // de produção continua 348" — este KPI somava só reg.minutosSemanas[0]
    // (s.minutos = Semana 1), então em modo Mês ele NUNCA contava as horas
    // de produtos cuja necessidade só aparece nas semanas 2-4 (ficam com
    // minutosSemanas[0]=0). Coincidência: em modo Semana só existe a
    // semana 0 mesmo, então o valor batia por acaso — mascarando que Mês
    // estava subcontando. Correto é somar o plano inteiro (minutosTotal).
    const hrs=reais.reduce((a,s)=>a+n(s.minutosTotal||s.minutos),0)/60, risco=new Set(reais.filter(s=>s.risco==='critico').map(s=>s.cod)).size;
    const maquinasOpts=_maquinas.map(m=>`<option value="${esc(m.nome)}" ${filtro===m.nome?'selected':''}>${esc(m.nome)}</option>`).join('');
    const avisoSemMaq=_sugestoes.filter(s=>s.semMaquina).length;
    const periodoAlvoLabel = p.modo==='semana' ? (document.getElementById('ppa-semana')?.selectedOptions?.[0]?.textContent||'—') : (document.getElementById('ppa-mes')?.selectedOptions?.[0]?.textContent||'—');
    pagina.innerHTML=`
      <div class="ppa-summary-row">
        <div class="dc dc-orange"><div class="dc-lbl">Em Risco de Ruptura</div><div class="dc-num" style="font-size:26px">${risco}</div></div>
        <div class="dc dc-cyan"><div class="dc-lbl">Sugestões Geradas</div><div class="dc-num" style="font-size:26px">${reais.length}</div></div>
        <div class="dc dc-purple"><div class="dc-lbl">Máquinas Envolvidas</div><div class="dc-num" style="font-size:26px">${maqSet.size}</div></div>
        <div class="dc dc-green"><div class="dc-lbl">Horas de Produção</div><div class="dc-num" style="font-size:22px">${hrs.toLocaleString('pt-BR',{maximumFractionDigits:1})}h</div></div>
        <div class="dc"><div class="dc-lbl">Período Alvo</div><div class="dc-num" style="font-size:16px;padding-top:6px">${esc(periodoAlvoLabel)}</div></div>
      </div>
      <div class="tc" style="padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:.68rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;min-width:60px">Período</span>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:5px 14px;border-radius:20px;border:1px solid ${p.modo==='mes'?'var(--orange)':'var(--border)'};font-size:.76rem;font-weight:600"><input type="radio" name="ppa-modo" value="mes" ${p.modo==='mes'?'checked':''}> 📅 Mês</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:5px 14px;border-radius:20px;border:1px solid ${p.modo==='semana'?'var(--orange)':'var(--border)'};font-size:.76rem;font-weight:600"><input type="radio" name="ppa-modo" value="semana" ${p.modo==='semana'?'checked':''}> 📆 Semana</label>
        <select id="ppa-mes" class="field" style="${p.modo==='mes'?'':'display:none'}">${optionsMeses()}</select>
        <select id="ppa-semana" class="field" style="${p.modo==='semana'?'':'display:none'}">${optionsSemanas()}</select>
        <span style="font-size:.64rem;color:var(--muted)">venda + estoque desejado − estoque atual, distribuído nas semanas</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn btn-primary" data-ppa-gerar="1">🤖 Gerar Programação Automática</button>
        <button class="btn btn-ghost" data-ppa-recalcular="1">🔄 Recalcular</button>
        ${reais.length?'<button class="btn btn-primary" data-ppa-aplicar="1" style="background:var(--success)">✅ Aplicar no Gantt / Programação</button>':''}
        <button class="btn btn-ghost" data-ppa-simular="1">🔬 Simular Cenário</button>
        ${reais.length?'<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.76rem;color:var(--muted)"><input type="checkbox" data-ppa-check-todos="1" checked> Selecionar todos</label>':''}
        <div style="flex:1"></div>
        <select id="ppa-maq-filter" class="field"><option value="">Todas as máquinas</option>${maquinasOpts}</select>
      </div>
      <div class="tc" style="padding:14px;margin-bottom:16px">
        <div style="font-weight:700;font-size:.8rem;margin-bottom:10px">⚙️ Parâmetros da Programação Automática</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          <div class="form-group" style="margin:0"><label>Cobertura mínima do cenário (dias)</label><input id="ppa-cobertura-min" class="field" type="number" min="1" value="${p.coberturaMin}"></div>
          <div class="form-group" style="margin:0"><label>Cobertura alvo do cenário após produção (dias)</label><input id="ppa-cobertura-alvo" class="field" type="number" min="1" value="${p.coberturaAlvo}"></div>
          <div class="form-group" style="margin:0"><label>Risco operacional do cenário abaixo de (dias)</label><input id="ppa-risco-critico" class="field" type="number" min="1" value="${p.riscoCritico}"></div>
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
      ${!_simulacao&&_auditoria.length&&!reais.length&&!avisoSemMaq?'<div class="tc" style="padding:10px 14px;margin-bottom:12px;border-left:4px solid var(--orange)">⚠️ Nenhum produto entrou na fila de produção — normalmente é porque nenhum tem projeção de vendas cadastrada (venda_m1/m2/m3). Vá em <b>Produção › Projeção de Vendas</b> e clique em <b>"📊 Buscar do BI"</b> pra preencher a partir da escadinha, depois gere de novo.</div>':''}
      ${_auditoria.length?`<div class="tc" style="padding:12px;margin-bottom:16px"><div style="font-weight:700;margin-bottom:8px">📊 Auditoria de capacidade por máquina</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px">${_auditoria.filter(a=>!filtro||a.maquina===filtro).map(a=>`<div style="border:1px solid var(--border);border-radius:8px;padding:9px"><div style="display:flex;justify-content:space-between"><b>${esc(a.maquina)}</b><span>${a.pct.toFixed(0)}%</span></div><div style="font-size:.66rem;color:var(--muted)">${esc(a.semana)} · atual ${(a.existente/60).toFixed(1)}h + nova ${(a.nova/60).toFixed(1)}h / cap ${(a.capacidade/60).toFixed(1)}h</div><div style="height:5px;background:var(--border);border-radius:9px;margin-top:5px"><div style="height:100%;width:${Math.min(100,a.pct)}%;background:${a.pct>100?'var(--danger)':a.pct>85?'var(--orange)':'var(--green-mid)'};border-radius:9px"></div></div></div>`).join('')}</div></div>`:''}
      ${_sugestoes.length?(()=>{
        const porMaquina=new Map();
        vis.filter(s=>!s.semMaquina).forEach(s=>{ if(!porMaquina.has(s.maquina))porMaquina.set(s.maquina,[]); porMaquina.get(s.maquina).push(s); });
        const grupos=[...porMaquina.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR')).map(([maq,linhas])=>_grupoMaquinaHtml(maq,linhas)).join('');
        const semMaq=vis.filter(s=>s.semMaquina);
        const semMaqHtml=semMaq.length?`<div class="tc" style="margin-bottom:14px">
          <div style="padding:12px 14px;border-bottom:1px solid var(--border)"><b style="font-size:.86rem">⚠️ Sem máquina compatível</b></div>
          <div style="overflow:auto"><table class="dt-table"><thead><tr><th>Semana</th><th>Produto</th><th>Cobertura</th></tr></thead><tbody>${semMaq.map(s=>`<tr><td>${esc(s.semana||'—')}</td><td><b>${esc(s.produto)}</b><div style="font-size:.62rem;color:var(--muted)">Cód. ${esc(s.cod)}</div></td><td>${Number.isFinite(s.coberturaAtual)?s.coberturaAtual.toFixed(1)+'d':'—'}</td></tr>`).join('')}</tbody></table></div>
        </div>`:'';
        return (grupos+semMaqHtml) || '<div class="empty"><div class="empty-icon">🤖</div><div class="empty-title">Nenhuma sugestão para a máquina selecionada.</div></div>';
      })():'<div class="empty"><div class="empty-icon">🤖</div><div class="empty-title">Configure os parâmetros e gere a programação automática.</div></div>'}
    `;
    // preserva seleções de período quando redesenha
    const mes=document.getElementById('ppa-mes'); if(mes&&p.mes)mes.value=p.mes;
    const sem=document.getElementById('ppa-semana'); if(sem&&p.semana)sem.value=p.semana;
  }

  // PEDIDO AO VIVO (2026-09-03, 2ª rodada): desde que gerarSugestoes passou
  // a consolidar 1 linha por produto (Semana 1 / Total Mês / 4 semanas), a
  // aplicação também precisa criar 1 OP por (semana × máquina) que teve
  // alocação de verdade — igual ao original (aplicarProgAutomaticaNoGantt/
  // buildPlanejamento), não mais 1 OP por linha da tabela.
  async function aplicarSugestoesSelecionadas(){
    const ids=new Set(Array.from(document.querySelectorAll('[data-ppa-check]:checked')).map(x=>Number(x.getAttribute('data-ppa-check'))));
    const lista=_sugestoes.filter((s,i)=>ids.has(i)&&!s.semMaquina);
    if(!lista.length){global.showToast?.('Selecione ao menos uma sugestão.','error');return;}
    // Reusa exatamente as semanas do cálculo que gerou `_sugestoes` — nunca
    // recalcula do formulário aqui (ver comentário em gerarSugestoes).
    const semanas=_semanasCalculo.length?_semanasCalculo:semanasPlanejamento(parametros());
    const executar=async()=>{
      try{
        const agora=new Date().toISOString(); let gravadas=0, removidas=0;
        // PEDIDO AO VIVO (2026-09-07), varredura geral: "você sempre diz
        // que ajustou mas continua do mesmo jeito" — achada a causa: esta
        // função só ADICIONAVA OPs novas, nunca removia as sugestões
        // automáticas ANTIGAS do mesmo produto/semana (nem as de antes de
        // qualquer correção de hoje). Recalcular e aplicar de novo só
        // empilhava OPs em cima das antigas — o Gantt continuava mostrando
        // o resultado velho (às vezes exclusivamente, se nenhum checkbox
        // novo cobria aquele produto/semana). Antes de gravar as novas,
        // apaga as OPs automáticas PENDENTES (nada apontado ainda) do
        // mesmo produto+semana — nunca mexe em OP criada manualmente nem
        // em qualquer coisa que já tenha produção real registrada.
        for(const s of lista){
          for(let si=0;si<(s.detalhesSemanas||[]).length;si++){
            const w=semanas[si]; if(!w) continue;
            const semanaIso=iso(w.inicio);
            const antigos=_registros.filter(r=>
              r.origem==='programacao_automatica' &&
              r.semanaPlanejada===semanaIso &&
              norm(r.status)!=='CONCLUIDO' &&
              n(r.qntProduzida??r.qtdProduzida??r.realizadoCx??r.caixasRealizadas)<=0 &&
              (String(r.prodCod??'')===String(s.cod??'') || norm(r.produto)===norm(s.produto))
            );
            for(const r of antigos){ await fs().collection(COL_REGISTROS).doc(r._firestoreId).delete(); removidas++; }
          }
        }
        for(const s of lista){
          for(let si=0;si<(s.detalhesSemanas||[]).length;si++){
            const w=semanas[si]; if(!w) continue;
            const porMaquina=new Map();
            (s.detalhesSemanas[si]||[]).forEach(d=>{
              if(!d.cx||d.cx<=0)return;
              const atual=porMaquina.get(d.maquina)||{cx:0,pcMin:d.pcMin||0,maquinaCad:d.maquinaCad};
              atual.cx+=d.cx; atual.pcMin=d.pcMin||atual.pcMin;
              porMaquina.set(d.maquina,atual);
            });
            for(const [maquina,info] of porMaquina){
              // PEDIDO AO VIVO (2026-09-07), varredura final: lendo
              // aplicarProgAutomaticaNoGantt do original (app.js:13950) do
              // início ao fim — achado o erro de arquitetura real. O
              // original cria só **1 registro por (produto × semana ×
              // máquina)**, com a quantidade da semana INTEIRA, datado pro
              // 1º dia útil daquela máquina — e é só isso. Ele NUNCA
              // pré-divide por dia (distribuirPorDia nem é chamada aqui).
              // Quem faz a produção aparecer espalhada corretamente pelos
              // dias da semana no Gantt é o PRÓPRIO motor de agenda
              // (buildProducaoSchedule, já portado em 63-producao-agenda.js
              // e já usado pra desenhar o Gantt) — ele lê 1 registro grande
              // e vai avançando cursor de dia em dia conforme a capacidade
              // enche, sozinho, na hora de renderizar. Eu estava chamando
              // distribuirDias() AQUI e pré-fatiando em várias OPs (1 doc
              // por dia) — redundante E prejudicial: o buildProducaoSchedule
              // então recebia VÁRIOS registros pequenos do mesmo produto em
              // vez de 1 grande, e a interação entre o cursor dele e os
              // fragmentos de vários produtos entrelaçados é o que
              // bagunçava a Programação Visual, mesmo com o cálculo
              // correto por trás. Voltando a criar 1 OP só por
              // produto/semana/máquina, como o original — o Gantt já sabe
              // desenhar isso certo sozinho.
              const dataOp=primeiroDiaUtil(w,info.maquinaCad||{});
              const snapshot=typeof global.buildProducaoConfigSnapshot==='function'?global.buildProducaoConfigSnapshot(s.produtoCad,info.maquinaCad,info.pcMin,s.unidPorCx):null;
              await fs().collection(COL_REGISTROS).add({
                produto:s.produto,prodCod:s.cod,maquina,pcMin:info.pcMin,unidPorCx:s.unidPorCx,
                qntCaixas:info.cx,qntUnid:info.cx*s.unidPorCx,categoria:info.maquinaCad?.categoria||'',
                status:'pendente',data:dataOp,horaInicio:'',
                // obs fica em branco pro usuário preencher (pedido ao
                // vivo); motorVersao é um campo interno (não aparece na
                // UI) só pra dar rastreabilidade.
                obs:'',origem:'programacao_automatica',motorVersao:'20260907i',semanaPlanejada:iso(w.inicio),
                ...(snapshot?{configSnapshot:snapshot}:{}),sortOrder:Date.now()+gravadas,criadoEm:agora,atualizadoEm:agora,
              }); gravadas++;
            }
          }
        }
        // Todas as telas de Produção mantêm dados em memória. Sem esta
        // invalidação, as OPs aplicadas aqui só apareciam no Dashboard,
        // Gantt, Máquinas, Realizado e Relatórios após recarregar o site.
        global.DTProducao?.invalidarTudo?.();
        global.showToast?.(`${gravadas} OP(s) aplicadas à Programação/Gantt.${removidas?` (${removidas} OP(s) automática(s) antiga(s) substituída(s))`:''}`,'success');
        _registros=[]; _carregado=false; _sugestoes=[]; _auditoria=[]; _simulacao=false; await carregarProgAutomatica(true); _desenharProgAutomatica();
      }catch(e){global.showToast?.('Erro ao aplicar: '+(e.message||e),'error');}
    };
    if(global.showConfirm)global.showConfirm(`Aplicar ${lista.length} sugestão(ões) na Programação?`,executar,{title:'Aplicar programação automática',icon:'🤖',okLabel:'Aplicar'});else if(confirm('Aplicar sugestões?'))await executar();
  }

  global.renderProducaoProgAutomatica=renderProducaoProgAutomatica;
  global.gerarProducaoAutomaticaAvancada=gerarSugestoes;
  global.aplicarProducaoAutomatica=aplicarSugestoesSelecionadas;
  global._DTProgAutomaticaInternals={getSugestoes:()=>_sugestoes,getAuditoria:()=>_auditoria,distribuirDias,primeiroDiaUtil,semanaIsoDoIndice:i=>iso(semanasPlanejamento(parametros())[i].inicio)};

  document.addEventListener('click',e=>{
    if(e.target.closest('[data-ppa-gerar]')){gerarSugestoes(false);return;}
    if(e.target.closest('[data-ppa-recalcular]')){gerarSugestoes(false);return;}
    if(e.target.closest('[data-ppa-simular]')){gerarSugestoes(true);return;}
    if(e.target.closest('[data-ppa-aplicar]')){aplicarSugestoesSelecionadas();return;}
    if(e.target.hasAttribute('data-ppa-check-todos')){document.querySelectorAll('[data-ppa-check]').forEach(c=>{if(!c.disabled)c.checked=e.target.checked;});return;}
    const insToggle=e.target.closest('[data-ppa-ins-toggle]');
    if(insToggle){const el=document.getElementById(insToggle.getAttribute('data-ppa-ins-toggle'));if(el)el.style.display=el.style.display==='none'?'table-row':'none';return;}
  });
  document.addEventListener('change',e=>{
    if(e.target?.name==='ppa-modo')_desenharProgAutomatica();
    if(e.target?.id==='ppa-maq-filter')_desenharProgAutomatica();
    const chk=e.target?.closest?.('[data-ppa-check]'); if(chk){const i=Number(chk.getAttribute('data-ppa-check'));if(_sugestoes[i])_sugestoes[i].selecionada=chk.checked;}
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _registros=[]; _maquinas=[]; _produtos=[]; _fichas=[]; _setups=[]; _insumosEstoque=[]; _sugestoes=[]; _auditoria=[]; _simulacao=false; });
})(window);
