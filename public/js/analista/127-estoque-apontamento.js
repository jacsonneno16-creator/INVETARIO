(function(global){
  'use strict';
  var estado={itens:[],status:'',busca:'',produto:'',dataIni:'',dataFim:'',carregando:false,abertos:{}};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function loja(){try{return String((global.getDTLojaAtiva&&global.getDTLojaAtiva())||localStorage.getItem('dt_loja_atual')||'');}catch(e){return '';}}
  function call(nome,dados){return global.firebase.app().functions('southamerica-east1').httpsCallable(nome)(dados||{}).then(function(r){return r.data||{};});}
  function pode(acao){return typeof global.temPermissao!=='function'||global.temPermissao('estoque-rel-apontamento',acao);}
  function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('pt-BR');}catch(e){return String(v);}}
  function badge(s){var map={AGUARDANDO_CONFERENCIA:'Aguardando conferência',DIVERGENTE:'Divergente',CONFERIDO_AGUARDANDO_INTEGRACAO:'Aguardando integração',ENVIANDO:'Enviando',PROCESSANDO:'Processando BlueSoft',APONTADO_BLUESOFT:'Apontado BlueSoft',ERRO_REJEITADO:'Erro rejeitado',ERRO_INCERTO:'Erro incerto',CANCELADO:'Cancelado'};return map[s]||s||'—';}
  function style(){
    if(document.getElementById('dt-ap-style'))return;
    var st=document.createElement('style');st.id='dt-ap-style';st.textContent='.ap-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px}.ap-kpi{border:1px solid var(--border);border-radius:12px;padding:14px;background:var(--card)}.ap-kpi b{display:block;font-size:1.55rem;margin-top:5px}.ap-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:14px 0}.ap-table{width:100%;border-collapse:collapse}.ap-table th,.ap-table td{padding:9px 8px;border-bottom:1px solid var(--border);font-size:.78rem;text-align:left}.ap-pill{display:inline-block;padding:3px 7px;border-radius:999px;background:rgba(245,158,11,.12);font-weight:700;font-size:.69rem}.ap-actions{display:flex;gap:5px;flex-wrap:wrap}@media(max-width:900px){.ap-grid{grid-template-columns:repeat(2,1fr)}}';document.head.appendChild(st);
  }
  // Dia local (AAAA-MM-DD) do apontamento, para comparar com o período escolhido.
  function diaLocal(v){if(!v)return '';var d=new Date(v);if(isNaN(d))return '';return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  // Período primeiro: os demais filtros trabalham sobre o que já está no período.
  function itensDoPeriodo(){return estado.itens.filter(function(x){var dia=diaLocal(x.dataHoraApontamento);if(estado.dataIni&&(!dia||dia<estado.dataIni))return false;if(estado.dataFim&&(!dia||dia>estado.dataFim))return false;return true;});}
  function filtrar(){var q=estado.busca.toLowerCase(),s=estado.status,p=estado.produto.toLowerCase();return itensDoPeriodo().filter(function(x){if(s==='PENDENTES'){if(x.status!=='AGUARDANDO_CONFERENCIA'&&x.status!=='DIVERGENTE')return false;}else if(s==='INTEGRADOS'){if(x.status!=='APONTADO_BLUESOFT')return false;}else if(s&&x.status!==s)return false;if(p&&!([x.produtoKey,x.descricaoProduto,x.gtin,x.codigo].join(' ').toLowerCase().includes(p)))return false;if(q&&!([x.capa,x.descricaoProduto,x.produtoKey,x.lote,x.usuarioApontamentoNome,x.usuarioConferenciaNome].join(' ').toLowerCase().includes(q)))return false;return true;});}
  function render(){
    style();var host=document.getElementById('page-estoque-rel-apontamento');if(!host)return;
    var itens=filtrar(),todos=itensDoPeriodo();
    // Produtos sugeridos: só os que têm apontamento no período escolhido.
    var prodOpts=Array.from(new Set(todos.map(function(x){return (x.produtoKey||'')+' · '+(x.descricaoProduto||'');}))).sort();
    function n(st){return todos.filter(function(x){return x.status===st;}).length;}
    host.innerHTML='<div class="sec-hdr"><div><div class="sec-title">🏷️ Apontamento de Produção</div><div class="sec-sub">Produção gera a capa; Logística confere o pallet físico; somente depois o apontamento segue para a BlueSoft.</div></div><button class="btn btn-ghost btn-sm" id="ap-an-refresh">↻ Atualizar</button></div>'+
      '<div class="ap-grid"><div class="ap-kpi"><span>Aguardando conferência</span><b>'+n('AGUARDANDO_CONFERENCIA')+'</b></div><div class="ap-kpi"><span>Divergentes</span><b>'+n('DIVERGENTE')+'</b></div><div class="ap-kpi"><span>Processando</span><b>'+n('PROCESSANDO')+'</b></div><div class="ap-kpi"><span>Apontados BlueSoft</span><b>'+n('APONTADO_BLUESOFT')+'</b></div></div>'+
      '<div class="tc" id="ap-wms-cfg" style="padding:12px;margin-bottom:10px"></div><div class="ap-toolbar"><div><div class="fl">Status</div><select class="field" id="ap-an-status"><option value="">Todos</option><option value="PENDENTES">Pendentes (conferência e divergência)</option><option value="INTEGRADOS">Integrados BlueSoft</option><option value="AGUARDANDO_CONFERENCIA">Aguardando conferência</option><option value="DIVERGENTE">Divergente</option><option value="PROCESSANDO">Processando BlueSoft</option><option value="APONTADO_BLUESOFT">Apontado BlueSoft</option><option value="ERRO_REJEITADO">Erro rejeitado</option><option value="ERRO_INCERTO">Erro incerto</option><option value="CANCELADO">Cancelado</option></select></div><div><div class="fl">De</div><input type="date" class="field" id="ap-an-ini" value="'+esc(estado.dataIni)+'"></div><div><div class="fl">Até</div><input type="date" class="field" id="ap-an-fim" value="'+esc(estado.dataFim)+'"></div><div style="flex:1;min-width:200px"><div class="fl">Produto</div><input class="field" id="ap-an-produto" list="ap-an-produtos" placeholder="código, nome ou GTIN" value="'+esc(estado.produto)+'"><datalist id="ap-an-produtos">'+prodOpts.map(function(o){return '<option value="'+esc(o)+'">';}).join('')+'</datalist></div><div style="flex:1;min-width:220px"><div class="fl">Pesquisar</div><input class="field" id="ap-an-busca" placeholder="Capa, produto, lote, operador..." value="'+esc(estado.busca)+'"></div></div>'+
      '<div class="tc"><div class="tc-header"><div class="tc-title">Pallets / capas</div><div class="sec-sub">'+itens.length+' registro(s)</div></div><div style="overflow:auto"><table class="ap-table"><thead><tr><th>Capa</th><th>Produto</th><th>Lote / validade</th><th>Qtd.</th><th>Produção</th><th>Conferência</th><th>Status</th><th>Ações</th></tr></thead><tbody>'+
      (itens.length?itens.map(function(x){var acts=[];if(x.status==='PROCESSANDO')acts.push('<button class="btn btn-ghost btn-sm" data-ap-status="'+esc(x.capa)+'">Consultar BlueSoft</button>');if(x.status==='ERRO_REJEITADO'&&pode('reprocessar'))acts.push('<button class="btn btn-primary btn-sm" data-perm-modulo="estoque-rel-apontamento" data-perm-acao="reprocessar" data-ap-reprocessar="'+esc(x.capa)+'">Reprocessar</button>');if(x.status==='AGUARDANDO_CONFERENCIA'&&pode('cancelar'))acts.push('<button class="btn btn-danger btn-sm" data-ap-cancelar="'+esc(x.capa)+'">Cancelar</button>');return '<tr><td><strong>'+esc(x.capa)+'</strong><br><small>'+esc(fmt(x.dataHoraApontamento))+'</small></td><td>'+esc(x.produtoKey)+' · '+esc(x.descricaoProduto||'')+'<br><small>GTIN '+esc(x.gtin||'')+'</small></td><td>'+esc(x.lote||'—')+'<br><small>'+esc(x.validade||'—')+'</small></td><td>'+esc(x.quantidade)+'</td><td>'+esc(x.usuarioApontamentoNome||'—')+'</td><td>'+esc(x.usuarioConferenciaNome||'—')+'</td><td><span class="ap-pill">'+esc(badge(x.status))+'</span>'+(x.integracao&&x.integracao.erro?'<br><small title="'+esc(x.integracao.erro)+'">'+esc(String(x.integracao.erro).slice(0,80))+'</small>':'')+'</td><td><div class="ap-actions">'+acts.join('')+'</div></td></tr>';}).join(''):'<tr><td colspan="8" style="padding:22px;text-align:center;color:var(--muted)">Nenhum apontamento encontrado.</td></tr>')+'</tbody></table></div></div>';
    var st=document.getElementById('ap-an-status');st.value=estado.status;st.onchange=function(){estado.status=this.value;render();};
    document.getElementById('ap-an-busca').oninput=function(){estado.busca=this.value;render();};
    document.getElementById('ap-an-ini').onchange=function(){estado.dataIni=this.value;carregar();};
    document.getElementById('ap-an-fim').onchange=function(){estado.dataFim=this.value;carregar();};
    document.getElementById('ap-an-produto').oninput=function(){estado.produto=this.value;render();};
    document.getElementById('ap-an-refresh').onclick=carregar;
    renderWmsCfg();
    enriquecerTabelaWms(itens);
    host.querySelectorAll('[data-ap-status]').forEach(function(b){b.onclick=function(){consultar(this.getAttribute('data-ap-status'));};});
    host.querySelectorAll('[data-ap-reprocessar]').forEach(function(b){b.onclick=function(){reprocessar(this.getAttribute('data-ap-reprocessar'));};});
    host.querySelectorAll('[data-ap-cancelar]').forEach(function(b){b.onclick=function(){cancelar(this.getAttribute('data-ap-cancelar'));};});
  }
  // ---- WMS na tabela: detalhe com vínculo e linha do tempo, Reprocessar WMS e Endereçar ----
  var WMS_LABEL={PROCESSANDO:'Processando',VINCULADO:'Vinculado',WMS_CRIADO:'Criado, sem vínculo',WMS_FALHA:'Falha',WMS_AGUARDANDO_CONFIGURACAO:'Aguardando configuração',WMS_VINCULO_AMBIGUO:'Vínculo ambíguo',ENDERECADO:'Endereçado',WMS_SEM_PERMISSAO_MONITORAMENTO:'Sem permissão (4047)',WMS_RESULTADO_INDETERMINADO:'Resultado incerto'};
  function wmsLabel(s){return s?(WMS_LABEL[s]||s):'Não solicitado';}
  function dataOuNada(v){var d=v?new Date(v):null;return d&&!isNaN(d)?d:null;}
  function linhaDoTempo(x){
    var w=x.wms||{},it=x.integracao||{},ev=[];
    function add(v,txt){var d=dataOuNada(v);if(d)ev.push({d:d,txt:txt});}
    add(x.criadoEm||x.dataHoraApontamento,'Capa DT criada');
    add(x.dataHoraConferencia,x.status==='REPROVADO'?'Reprovada pela Logística':'Aprovada pela Logística');
    add(it.dataEnvio,'Produção enviada à BlueSoft');
    add(it.dataConfirmacao,'Produção confirmada pela BlueSoft');
    add(w.criadoEm,'Criação WMS solicitada');
    add(w.vinculadoEm,'Pallet BlueSoft '+(w.paleteKey||'')+' vinculado');
    add(w.enderecadoEm,'Endereçado'+(w.enderecoDescritivo?' em '+w.enderecoDescritivo:''));
    ev.sort(function(a,b){return a.d-b.d;});
    if(!ev.length)return '<div class="sec-sub">Sem eventos registrados.</div>';
    return ev.map(function(e){return '<div style="font-size:.8rem">'+esc(e.d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))+' — '+esc(e.txt)+'</div>';}).join('');
  }
  function detalheHtml(x){
    var w=x.wms||{};
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:10px">'+
      '<div><div class="fl">Capa DT</div><b>'+esc(x.capa)+'</b></div>'+
      '<div><div class="fl">Pallet BlueSoft</div><b>'+esc(w.paleteKey!=null?w.paleteKey:'—')+'</b></div>'+
      '<div><div class="fl">Lote logístico</div><b>'+esc(w.numeroLoteLogistico||'—')+'</b></div>'+
      '<div><div class="fl">Status WMS</div><b>'+esc(wmsLabel(w.status))+'</b></div>'+
      '<div><div class="fl">Endereço</div><b>'+esc(w.enderecoDescritivo||(w.enderecoLogisticoKey!=null?'chave '+w.enderecoLogisticoKey:'—'))+'</b></div></div>'+
      (w.erro?'<div style="color:#b91c1c;font-size:.8rem;margin-bottom:8px">'+esc(w.erro)+'</div>':'')+
      (w.erroEnderecamento?'<div style="color:#b91c1c;font-size:.8rem;margin-bottom:8px">Endereçamento recusado pela BlueSoft: '+esc(w.erroEnderecamento)+'</div>':'')+
      '<div class="fl">Linha do tempo</div>'+linhaDoTempo(x);
  }
  function enriquecerTabelaWms(itens){
    var trs=Array.prototype.slice.call(document.querySelectorAll('#page-estoque-rel-apontamento .ap-table tbody tr'));
    if(!itens||!itens.length)return;
    trs.forEach(function(tr,i){
      var x=itens[i];if(!x)return;
      var acoes=tr.querySelector('.ap-actions');if(!acoes)return;
      var w=x.wms||{},html='';
      html+='<button class="btn btn-ghost btn-sm" data-perm-modulo="estoque-rel-apontamento" data-perm-acao="visualizar" data-ap-detalhe="'+esc(x.capa)+'">'+(estado.abertos[x.capa]?'Ocultar':'Detalhe')+'</button>';
      if(pode('reprocessar')&&['WMS_FALHA','WMS_AGUARDANDO_CONFIGURACAO','WMS_SEM_PERMISSAO_MONITORAMENTO'].indexOf(w.status)>=0)
        html+='<button class="btn btn-ghost btn-sm" data-perm-modulo="estoque-rel-apontamento" data-perm-acao="reprocessar" data-ap-reprocessar-wms="'+esc(x.capa)+'">Reprocessar WMS</button>';
      if(pode('conferir')&&w.status==='VINCULADO'&&Number(w.paleteKey)>0)
        html+='<button class="btn btn-primary btn-sm" data-perm-modulo="estoque-rel-apontamento" data-perm-acao="conferir" data-ap-enderecar="'+esc(x.capa)+'">Endereçar pallet</button>';
      // Produção presa em "Processando BlueSoft" sem requestId: só acontecia pelo
      // endpoint síncrono (sem ficha técnica). Ação administrativa — nunca reenvia o PCP.
      if(pode('configurar')&&x.status==='PROCESSANDO'&&x.integracao&&x.integracao.endpoint==='/api/pcp/apontamento-producao'&&!x.integracao.requestId)
        html+='<button class="btn btn-ghost btn-sm" data-perm-modulo="estoque-rel-apontamento" data-perm-acao="configurar" data-ap-confirmar-pcp="'+esc(x.capa)+'">Produção já confirmada → iniciar só WMS</button>';
      acoes.insertAdjacentHTML('beforeend',html);
      if(estado.abertos[x.capa]){var det=document.createElement('tr');det.innerHTML='<td colspan="8" style="background:#f8fafc;padding:12px">'+detalheHtml(x)+'</td>';tr.parentNode.insertBefore(det,tr.nextSibling);}
    });
    document.querySelectorAll('#page-estoque-rel-apontamento [data-ap-detalhe]').forEach(function(b){b.onclick=function(){var c=this.getAttribute('data-ap-detalhe');estado.abertos[c]=!estado.abertos[c];render();};});
    document.querySelectorAll('#page-estoque-rel-apontamento [data-ap-reprocessar-wms]').forEach(function(b){b.onclick=function(){reprocessarWms(this.getAttribute('data-ap-reprocessar-wms'));};});
    document.querySelectorAll('#page-estoque-rel-apontamento [data-ap-enderecar]').forEach(function(b){b.onclick=function(){enderecarPallet(this.getAttribute('data-ap-enderecar'));};});
    document.querySelectorAll('#page-estoque-rel-apontamento [data-ap-confirmar-pcp]').forEach(function(b){b.onclick=function(){confirmarPcpManual(this.getAttribute('data-ap-confirmar-pcp'));};});
  }
  // Correção administrativa: a produção já está confirmada na BlueSoft (endpoint
  // síncrono), mas um bug antigo deixou o registro preso em "Processando". Isso
  // NUNCA reenvia o POST de produção — só confirma e dispara a etapa WMS.
  function confirmarPcpManual(capa){
    var msg='A capa '+capa+' já tem a produção confirmada na BlueSoft (não será reenviada). Confirmar o status aqui e iniciar só a integração WMS?';
    global.showConfirm&&global.showConfirm(msg,function(){
      call('apontamentoConfirmarPcpManual',{capa:capa}).then(function(r){
        var ok=(r.corrigidas||[]).indexOf(capa)>=0;
        global.showToast&&global.showToast(ok?'Confirmado. Iniciando a etapa WMS.':'Não foi corrigido: '+((r.ignoradas||[])[0]&&r.ignoradas[0].motivo||'verifique o status atual.'),ok?'success':'error');
        carregar();
      }).catch(function(e){global.showToast&&global.showToast(e&&e.message?e.message:String(e),'error');});
    },{title:'Confirmar produção manualmente',icon:'⚠️',okLabel:'Confirmar e iniciar WMS',okClass:'btn-primary'});
  }
  // Reprocessa só a etapa WMS. O servidor confere a tentativa anterior e nunca reenvia o PCP.
  function reprocessarWms(capa){
    global.showConfirm&&global.showConfirm('Reprocessar somente o WMS da capa '+capa+'? A produção na BlueSoft não será reenviada.',function(){
      call('apontamentoReprocessarWms',{capa:capa}).then(function(r){global.showToast&&global.showToast(r.mensagem||'WMS reprocessado.','success');carregar();}).catch(function(e){global.showToast&&global.showToast(e&&e.message?e.message:String(e),'error');});
    },{title:'Reprocessar WMS',icon:'🔁',okLabel:'Reprocessar',okClass:'btn-primary'});
  }
  // Endereça pela Capa DT: o servidor resolve o paleteKey. Confirma antes do POST.
  function enderecarPallet(capa){
    var x=(estado.itens||[]).filter(function(i){return String(i.capa)===String(capa);})[0];if(!x)return;
    var w=x.wms||{};
    var end=global.prompt?global.prompt('Endereço de destino (número do endereço logístico BlueSoft) para a capa '+capa+':',''):'';
    end=String(end||'').trim();if(!end)return;
    var msg='Endereçar a capa '+capa+' (pallet BlueSoft '+w.paleteKey+', '+(x.descricaoProduto||x.produtoKey||'')+', qtd '+x.quantidade+') no endereço '+end+'?';
    global.showConfirm&&global.showConfirm(msg,function(){
      call('apontamentoEnderecarPallet',{capa:capa,enderecoLogisticoKey:Number(end)}).then(function(){global.showToast&&global.showToast('Pallet endereçado na BlueSoft.','success');carregar();}).catch(function(e){global.showToast&&global.showToast(e&&e.message?e.message:String(e),'error');});
    },{title:'Endereçar pallet',icon:'📦',okLabel:'Endereçar',okClass:'btn-primary'});
  }
  // Integração WMS (pallet logístico BlueSoft). Desligada por padrão. O cdKey é
  // configurado por loja, nunca inventado. "Testar" verifica autenticação,
  // monitoramento assíncrono e API WMS, mostrando cada resultado.
  function renderWmsCfg(){
    var box=document.getElementById('ap-wms-cfg');if(!box)return;
    var lojaId=loja();
    if(!lojaId){box.innerHTML='<div class="sec-sub">Selecione uma loja para configurar a integração WMS.</div>';return;}
    var db=global.getDTFirestore(),raw=global.getDTRawFirestore();
    // dt_config é coleção global (raiz): getDTFirestore() prefixa com a loja ativa
    // e só escapa disso pra uma lista fixa de coleções, que não inclui dt_config.
    Promise.all([raw.collection('dt_config').doc('apontamento_producao').get(),db.collection('lojas').doc(lojaId).get()]).then(function(r){
      var cfg=r[0].data()||{},loj=r[1].data()||{};
      var bkey=String(loj.bluesoft_loja_key||'');
      var porLoja=(cfg.wmsPorLoja&&cfg.wmsPorLoja[bkey])||{};
      box.innerHTML='<div class="tc-title" style="margin-bottom:8px">⚙️ Integração WMS (pallet logístico BlueSoft)</div>'+
        '<div class="sec-sub" style="margin-bottom:8px">Desligada por padrão. Enquanto estiver desligada, nada é criado na BlueSoft.</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">'+
        '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="wms-ativa"'+(cfg.integracaoWmsAtiva===true?' checked':'')+'> Integração WMS ativa</label>'+
        '<div><div class="fl">Motivo (BlueSoft)</div><input class="field" type="number" id="wms-motivo" value="'+esc(cfg.wmsMotivo||1)+'" style="width:110px"></div>'+
        '<div><div class="fl">cdKey desta loja</div><input class="field" type="number" id="wms-cdkey" value="'+esc(porLoja.cdKey||'')+'" placeholder="informe" style="width:130px"></div>'+
        '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="wms-loja-ativa"'+(porLoja.ativo===true?' checked':'')+'> Loja ativa no WMS</label>'+
        '<button class="btn btn-ghost btn-sm" data-perm-modulo="estoque-rel-apontamento" data-perm-acao="configurar" id="wms-salvar">Salvar</button>'+
        '<button class="btn btn-ghost btn-sm" data-perm-modulo="estoque-rel-apontamento" data-perm-acao="visualizar" id="wms-testar">Testar configuração</button></div>'+
        '<div id="wms-resultado" style="margin-top:8px;font-size:.8rem"></div>';
      document.getElementById('wms-salvar').onclick=function(){salvarWmsCfg(lojaId,bkey);};
      document.getElementById('wms-testar').onclick=function(){testarWms(lojaId);};
    }).catch(function(e){box.innerHTML='<div class="sec-sub">Não foi possível carregar a configuração WMS: '+esc(e&&e.message?e.message:String(e))+'</div>';});
  }
  function salvarWmsCfg(lojaId,bkey){
    var raw=global.getDTRawFirestore();
    var ativa=!!document.getElementById('wms-ativa').checked;
    var motivo=Number(document.getElementById('wms-motivo').value)||1;
    var cd=Number(document.getElementById('wms-cdkey').value);
    var lojaAt=!!document.getElementById('wms-loja-ativa').checked;
    if(!bkey){global.showToast&&global.showToast('Esta loja não tem código BlueSoft cadastrado.','error');return;}
    var porLoja={};porLoja[bkey]={cdKey:cd>0?cd:null,ativo:lojaAt};
    raw.collection('dt_config').doc('apontamento_producao').set({integracaoWmsAtiva:ativa,wmsMotivo:motivo,wmsPorLoja:porLoja},{merge:true})
      .then(function(){global.showToast&&global.showToast('Configuração WMS salva.','success');})
      .catch(function(e){global.showToast&&global.showToast('Não foi possível salvar: '+(e&&e.message?e.message:String(e)),'error');});
  }
  function testarWms(lojaId){
    var out=document.getElementById('wms-resultado');if(out)out.textContent='Testando...';
    call('apontamentoTestarWms',{lojaId:lojaId}).then(function(r){
      var linhas=(r.checks||[]).map(function(c){return (c.ok?'✓ ':'✕ ')+c.item+' — '+c.detalhe;});
      if(out)out.innerHTML=linhas.map(function(l){return '<div>'+esc(l)+'</div>';}).join('');
    }).catch(function(e){if(out)out.textContent=e&&e.message?e.message:String(e);});
  }
  async function carregar(){if(estado.carregando)return;estado.carregando=true;try{var r=await call('apontamentoListar',{lojaId:loja(),limite:500,dataInicio:estado.dataIni||null,dataFim:estado.dataFim||null});estado.itens=r.itens||[];render();}catch(e){global.showToast&&global.showToast('Falha ao carregar apontamentos: '+(e.message||e),'error');}finally{estado.carregando=false;}}
  async function consultar(capa){try{var r=await call('apontamentoConsultarStatusBluesoft',{capa:capa,lojaId:loja()});global.showToast&&global.showToast(r.mensagem||'Status atualizado.','success');await carregar();}catch(e){global.showToast&&global.showToast(e.message||String(e),'error');}}
  async function reprocessar(capa){if(!pode('reprocessar'))return;try{await call('apontamentoReprocessar',{capa:capa,lojaId:loja()});global.showToast&&global.showToast('Reprocessamento iniciado.','success');await carregar();}catch(e){global.showToast&&global.showToast(e.message||String(e),'error');}}
  async function cancelar(capa){if(!pode('cancelar'))return;if(!global.confirm('Cancelar o pré-apontamento da capa '+capa+'? Nada será enviado à BlueSoft.'))return;try{await call('apontamentoCancelar',{capa:capa,lojaId:loja(),motivo:'Cancelado pelo analista'});global.showToast&&global.showToast('Pré-apontamento cancelado.','success');await carregar();}catch(e){global.showToast&&global.showToast(e.message||String(e),'error');}}
  global.renderEstoqueRelApontamento=function(){render();return carregar();};
})(window);
