(function(global){
  'use strict';

  var db=null, unConv=null, unMsg=null, conversas=[], conversaAtual=null, agentes=[];
  var filtroStatus='todos', filtroTexto='', filtroResponsavel='todos';
  var estilosInjetados=false;
  var paginaAtual='dashboard';

  function raw(){
    if(db)return db;
    if(typeof global.getDTRawFirestore==='function')db=global.getDTRawFirestore();
    else if(global.firebase&&global.firebase.firestore)db=global.firebase.firestore();
    return db;
  }
  function tem(modulo,acao){return typeof global.temPermissao!=='function'||global.temPermissao(modulo,acao||'visualizar');}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});}
  function fmtHora(v){if(!v)return'';var d=v.toDate?v.toDate():new Date(v);if(isNaN(d.getTime()))return'';return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
  function fmtData(v){if(!v)return'';var d=v.toDate?v.toDate():new Date(v);if(isNaN(d.getTime()))return'';return d.toLocaleDateString('pt-BR')+' '+fmtHora(d);}
  function usuarioAtual(){var a=global.DT_USUARIO_ACESSO_ATUAL||{};var u=global.firebase&&global.firebase.auth?global.firebase.auth().currentUser:null;return{uid:(u&&u.uid)||a.uid||'',nome:a.nome||a.displayName||(u&&u.displayName)||(u&&u.email)||'Atendente',email:(u&&u.email)||a.email||''};}
  function call(nome,dados){return global.firebase.app().functions('southamerica-east1').httpsCallable(nome)(dados||{}).then(function(r){return r.data||{};});}
  function toast(msg,tipo){if(global.showToast)global.showToast(msg,tipo||'success');}

  function css(){
    if(estilosInjetados)return; estilosInjetados=true;
    var el=document.createElement('style'); el.id='dt-atendimento-style'; el.textContent=`
      .wa-wrap{padding:22px;max-width:1600px;margin:0 auto;color:var(--text)}
      .wa-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.wa-head h1{margin:0;font-size:1.45rem}.wa-sub{color:var(--muted);font-size:.84rem;margin-top:4px}
      .wa-grid-kpi{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:12px;margin:16px 0}.wa-kpi{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px}.wa-kpi b{font-size:1.65rem;display:block;margin-top:4px}.wa-kpi span{font-size:.76rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
      .wa-panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}.wa-panel-title{padding:14px 16px;border-bottom:1px solid var(--border);font-weight:800}
      .wa-inbox{height:calc(100vh - 132px);min-height:620px;display:grid;grid-template-columns:340px minmax(460px,1fr) 310px;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface)}
      .wa-col{min-width:0;display:flex;flex-direction:column}.wa-col+.wa-col{border-left:1px solid var(--border)}.wa-toolbar{padding:12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap}.wa-input,.wa-select,.wa-textarea{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:9px;padding:9px 11px;font:inherit;outline:none}.wa-input{flex:1;min-width:140px}.wa-select{max-width:100%}.wa-textarea{width:100%;resize:vertical;min-height:64px}
      .wa-list{overflow:auto;flex:1}.wa-conv{padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;gap:10px;position:relative}.wa-conv:hover,.wa-conv.on{background:rgba(34,139,94,.08)}.wa-avatar{width:42px;height:42px;border-radius:50%;background:#166534;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;flex:0 0 auto}.wa-conv-main{min-width:0;flex:1}.wa-row{display:flex;justify-content:space-between;gap:8px;align-items:center}.wa-name{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wa-preview{font-size:.78rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}.wa-time{font-size:.68rem;color:var(--muted)}.wa-badge{display:inline-flex;padding:3px 7px;border-radius:999px;font-size:.66rem;font-weight:800}.wa-badge.novo{background:#dbeafe;color:#1d4ed8}.wa-badge.em_atendimento{background:#dcfce7;color:#166534}.wa-badge.aguardando_cliente{background:#fef3c7;color:#92400e}.wa-badge.resolvido{background:#e5e7eb;color:#374151}.wa-unread{position:absolute;right:12px;bottom:10px;background:#16a34a;color:white;border-radius:999px;min-width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:.68rem;font-weight:900}
      .wa-chat-head{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:10px;align-items:center}.wa-chat-title{font-weight:900}.wa-chat-sub{font-size:.74rem;color:var(--muted)}.wa-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.wa-btn{border:1px solid var(--border);background:var(--surface);color:var(--text);padding:8px 10px;border-radius:8px;font-weight:750;cursor:pointer}.wa-btn.primary{background:#128c7e;color:#fff;border-color:#128c7e}.wa-btn.danger{background:#fee2e2;color:#991b1b;border-color:#fecaca}.wa-btn:disabled{opacity:.5;cursor:not-allowed}
      .wa-messages{flex:1;overflow:auto;padding:18px;background:linear-gradient(rgba(255,255,255,.82),rgba(255,255,255,.82)),repeating-linear-gradient(45deg,#f2eee8 0,#f2eee8 2px,#f8f6f2 2px,#f8f6f2 10px)}body.dark .wa-messages{background:#0b141a}.wa-msg{max-width:76%;padding:9px 11px;border-radius:10px;margin:7px 0;box-shadow:0 1px 1px rgba(0,0,0,.08);font-size:.88rem;line-height:1.35}.wa-msg.in{background:#fff;margin-right:auto}.wa-msg.out{background:#d9fdd3;margin-left:auto}.wa-msg-meta{font-size:.64rem;color:#667781;text-align:right;margin-top:4px}.wa-msg-note{background:#fff3cd!important;border:1px dashed #d69e2e;margin-left:auto;margin-right:auto;max-width:88%}.wa-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted);text-align:center;padding:30px}.wa-empty i{font-size:3rem;font-style:normal;margin-bottom:8px}
      .wa-compose{padding:10px 12px;border-top:1px solid var(--border);background:var(--surface);display:flex;gap:8px;align-items:flex-end}.wa-compose textarea{flex:1;min-height:42px;max-height:120px;resize:vertical}
      .wa-side{padding:14px;overflow:auto}.wa-side h3{margin:0 0 12px}.wa-info{border-bottom:1px solid var(--border);padding:10px 0}.wa-info small{display:block;color:var(--muted);font-size:.68rem;text-transform:uppercase;font-weight:800}.wa-info b{display:block;margin-top:3px}.wa-note{background:#fff8db;border:1px solid #f4df87;border-radius:9px;padding:9px;margin:8px 0;font-size:.78rem;color:#5b4a00}.wa-note small{display:block;opacity:.7;margin-top:4px}
      .wa-dashboard-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}.wa-table{width:100%;border-collapse:collapse}.wa-table th,.wa-table td{padding:10px 12px;border-bottom:1px solid var(--border);font-size:.79rem;text-align:left}.wa-table th{color:var(--muted);font-size:.68rem;text-transform:uppercase}.wa-config-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.wa-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px}.wa-card h3{margin:0 0 12px}.wa-status-dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:6px;background:#9ca3af}.wa-status-dot.ok{background:#16a34a}.wa-status-dot.warn{background:#f59e0b}
      @media(max-width:1100px){.wa-inbox{grid-template-columns:300px 1fr}.wa-inbox>.wa-col:last-child{display:none}.wa-grid-kpi{grid-template-columns:repeat(2,1fr)}.wa-dashboard-grid,.wa-config-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(el);
  }

  function shellTitulo(titulo,sub){return '<div class="wa-head"><div><h1>'+titulo+'</h1><div class="wa-sub">'+sub+'</div></div></div>';}

  function atendimentoIrParaPagina(pagina,el){
    css(); paginaAtual=pagina;
    document.querySelectorAll('#setor-atendimento-shell .page').forEach(function(p){p.classList.remove('on');});
    document.querySelectorAll('#setor-atendimento-shell .nav-item').forEach(function(n){n.classList.remove('on');});
    var id=pagina==='dashboard'?'page-atendimento-dashboard':pagina==='config'?'page-atendimento-config':'page-atendimento-conversas';
    var pg=document.getElementById(id);if(pg)pg.classList.add('on');if(el)el.classList.add('on');
    if(pagina==='dashboard')renderDashboard(); else if(pagina==='config')renderConfig(); else renderInbox();
  }

  function iniciarConversas(){
    if(unConv)return; var d=raw(); if(!d)return;
    unConv=d.collection('wa_conversas').orderBy('atualizadaEm','desc').limit(150).onSnapshot(function(s){
      conversas=s.docs.map(function(doc){var x=doc.data()||{};x.id=doc.id;return x;});
      if(paginaAtual==='conversas')renderListaConversas(); if(paginaAtual==='dashboard')renderDashboardConteudo();
      if(conversaAtual){var nova=conversas.find(function(c){return c.id===conversaAtual.id;});if(nova){conversaAtual=nova;renderLateral();renderChatHeader();}}
    },function(e){console.error(e);toast('Falha ao carregar conversas: '+e.message,'error');});
  }

  function convFiltradas(){
    var t=filtroTexto.trim().toLowerCase(),u=usuarioAtual();
    return conversas.filter(function(c){
      if(filtroStatus!=='todos'&&String(c.status||'novo')!==filtroStatus)return false;
      if(filtroResponsavel==='meus'&&String(c.responsavelUid||'')!==u.uid)return false;
      if(t){var alvo=[c.nomeCliente,c.telefone,c.ultimaMensagem,c.responsavelNome].join(' ').toLowerCase();if(alvo.indexOf(t)<0)return false;}
      return true;
    });
  }

  function renderInbox(){
    iniciarConversas(); carregarAgentes();
    var pg=document.getElementById('page-atendimento-conversas');if(!pg)return;
    pg.innerHTML='<div class="wa-wrap">'+shellTitulo('💬 Central de Atendimento','WhatsApp multiatendente · fila, responsável, histórico e notas internas')+
      '<div class="wa-inbox"><section class="wa-col"><div class="wa-toolbar"><input id="wa-busca" class="wa-input" placeholder="Buscar conversa..."><select id="wa-status" class="wa-select"><option value="todos">Todos</option><option value="novo">Novos</option><option value="em_atendimento">Em atendimento</option><option value="aguardando_cliente">Aguardando cliente</option><option value="resolvido">Resolvidos</option></select><select id="wa-resp" class="wa-select"><option value="todos">Todos responsáveis</option><option value="meus">Meus atendimentos</option></select></div><div id="wa-list" class="wa-list"></div></section>'+ 
      '<section class="wa-col"><div id="wa-chat-head" class="wa-chat-head"><div><div class="wa-chat-title">Selecione uma conversa</div><div class="wa-chat-sub">Nenhuma conversa aberta</div></div></div><div id="wa-messages" class="wa-messages"><div class="wa-empty"><i>💬</i><b>Selecione uma conversa</b><span>As mensagens aparecerão aqui.</span></div></div><div id="wa-compose" class="wa-compose" style="display:none"><textarea id="wa-msg" class="wa-textarea" placeholder="Digite uma mensagem..."></textarea><button id="wa-send" class="wa-btn primary">Enviar</button></div></section>'+ 
      '<aside class="wa-col"><div id="wa-side" class="wa-side"><div class="wa-empty"><i>👤</i><span>Dados do cliente e atendimento</span></div></div></aside></div></div>';
    var busca=document.getElementById('wa-busca');if(busca)busca.addEventListener('input',function(){filtroTexto=this.value;renderListaConversas();});
    var st=document.getElementById('wa-status');if(st)st.addEventListener('change',function(){filtroStatus=this.value;renderListaConversas();});
    var rp=document.getElementById('wa-resp');if(rp)rp.addEventListener('change',function(){filtroResponsavel=this.value;renderListaConversas();});
    var send=document.getElementById('wa-send');if(send)send.addEventListener('click',enviarMensagem);
    var ta=document.getElementById('wa-msg');if(ta)ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();enviarMensagem();}});
    renderListaConversas();
  }

  function renderListaConversas(){
    var host=document.getElementById('wa-list');if(!host)return;var lista=convFiltradas();
    if(!lista.length){host.innerHTML='<div class="wa-empty"><i>📭</i><b>Nenhuma conversa</b><span>As conversas recebidas pelo WhatsApp aparecerão aqui.</span></div>';return;}
    host.innerHTML=lista.map(function(c){var nome=c.nomeCliente||c.telefone||'Cliente';var ini=nome.trim().charAt(0).toUpperCase();var unread=Number(c.naoLidas||0);return '<div class="wa-conv '+(conversaAtual&&conversaAtual.id===c.id?'on':'')+'" data-id="'+esc(c.id)+'"><div class="wa-avatar">'+esc(ini)+'</div><div class="wa-conv-main"><div class="wa-row"><div class="wa-name">'+esc(nome)+'</div><span class="wa-time">'+esc(fmtHora(c.atualizadaEm))+'</span></div><div class="wa-preview">'+esc(c.ultimaMensagem||'Sem mensagens')+'</div><div style="margin-top:5px"><span class="wa-badge '+esc(c.status||'novo')+'">'+esc(rotuloStatus(c.status))+'</span> '+(c.responsavelNome?'<span class="wa-time">• '+esc(c.responsavelNome)+'</span>':'')+'</div></div>'+(unread?'<span class="wa-unread">'+unread+'</span>':'')+'</div>';}).join('');
    host.querySelectorAll('.wa-conv').forEach(function(el){el.addEventListener('click',function(){abrirConversa(this.dataset.id);});});
  }

  function rotuloStatus(s){return({novo:'Novo',em_atendimento:'Em atendimento',aguardando_cliente:'Aguardando cliente',resolvido:'Resolvido'})[s]||'Novo';}
  function abrirConversa(id){
    conversaAtual=conversas.find(function(c){return c.id===id;})||{id:id};renderListaConversas();renderChatHeader();renderLateral();
    var comp=document.getElementById('wa-compose');if(comp)comp.style.display=tem('atendimento-conversas','responder')?'flex':'none';
    if(unMsg){unMsg();unMsg=null;} var d=raw();if(!d)return;
    unMsg=d.collection('wa_conversas').doc(id).collection('mensagens').orderBy('criadaEm','asc').limit(500).onSnapshot(function(s){
      var msgs=s.docs.map(function(doc){var x=doc.data()||{};x.id=doc.id;return x;});renderMensagens(msgs);
    },function(e){toast('Falha ao abrir mensagens: '+e.message,'error');});
    if(conversaAtual.naoLidas>0) d.collection('wa_conversas').doc(id).set({naoLidas:0},{merge:true}).catch(function(){});
  }
  function renderMensagens(msgs){var host=document.getElementById('wa-messages');if(!host)return;if(!msgs.length){host.innerHTML='<div class="wa-empty"><i>💬</i><span>Sem mensagens ainda.</span></div>';return;}host.innerHTML=msgs.map(function(m){var classe=m.tipo==='nota'?'wa-msg-note':m.direcao==='saida'?'out':'in';return '<div class="wa-msg '+classe+'"><div>'+esc(m.texto||m.caption||('[ '+(m.tipoMensagem||'mensagem')+' ]'))+'</div><div class="wa-msg-meta">'+esc(m.atendenteNome||m.nomeOrigem||'')+(m.atendenteNome?' · ':'')+esc(fmtHora(m.criadaEm))+(m.statusEnvio?' · '+esc(m.statusEnvio):'')+'</div></div>';}).join('');host.scrollTop=host.scrollHeight;}
  function renderChatHeader(){var h=document.getElementById('wa-chat-head');if(!h||!conversaAtual)return;var c=conversaAtual;var podeAss=tem('atendimento-conversas','assumir'),podeTrans=tem('atendimento-conversas','transferir'),podeFin=tem('atendimento-conversas','finalizar');h.innerHTML='<div><div class="wa-chat-title">'+esc(c.nomeCliente||c.telefone||'Cliente')+'</div><div class="wa-chat-sub">'+esc(c.telefone||'')+' · '+esc(rotuloStatus(c.status))+(c.responsavelNome?' · '+esc(c.responsavelNome):'')+'</div></div><div class="wa-actions">'+(!c.responsavelUid&&podeAss?'<button class="wa-btn primary" id="wa-assumir">Assumir</button>':'')+(podeTrans?'<button class="wa-btn" id="wa-transferir">Transferir</button>':'')+(podeFin&&c.status!=='resolvido'?'<button class="wa-btn" id="wa-aguardar">Aguardar cliente</button><button class="wa-btn" id="wa-finalizar">Resolver</button>':'')+'</div>';bindAcoesHeader();}
  function bindAcoesHeader(){var e=document.getElementById('wa-assumir');if(e)e.onclick=assumir; e=document.getElementById('wa-transferir');if(e)e.onclick=transferir;e=document.getElementById('wa-aguardar');if(e)e.onclick=function(){mudarStatus('aguardando_cliente');};e=document.getElementById('wa-finalizar');if(e)e.onclick=function(){mudarStatus('resolvido');};}
  async function assumir(){if(!conversaAtual)return;try{await call('whatsappAssumirConversa',{conversaId:conversaAtual.id});toast('Atendimento assumido.');}catch(e){toast(e.message||String(e),'error');}}
  async function transferir(){if(!conversaAtual)return;await carregarAgentes();if(!agentes.length){toast('Nenhum atendente disponível para transferência.','error');return;}var nomes=agentes.map(function(a,i){return(i+1)+' - '+a.nome;}).join('\n');var n=prompt('Transferir para qual atendente?\n\n'+nomes);var idx=Number(n)-1;if(idx<0||!agentes[idx])return;try{await call('whatsappTransferirConversa',{conversaId:conversaAtual.id,destinoUid:agentes[idx].uid});toast('Conversa transferida para '+agentes[idx].nome+'.');}catch(e){toast(e.message||String(e),'error');}}
  async function mudarStatus(status){if(!conversaAtual)return;try{await call('whatsappAtualizarStatus',{conversaId:conversaAtual.id,status:status});toast('Status atualizado.');}catch(e){toast(e.message||String(e),'error');}}
  async function enviarMensagem(){if(!conversaAtual)return;var ta=document.getElementById('wa-msg');var texto=(ta&&ta.value||'').trim();if(!texto)return;var btn=document.getElementById('wa-send');if(btn)btn.disabled=true;try{await call('whatsappEnviarMensagem',{conversaId:conversaAtual.id,texto:texto});ta.value='';}catch(e){toast(e.message||String(e),'error');}finally{if(btn)btn.disabled=false;}}

  function renderLateral(){var h=document.getElementById('wa-side');if(!h||!conversaAtual)return;var c=conversaAtual;h.innerHTML='<h3>Cliente</h3><div class="wa-info"><small>Nome</small><b>'+esc(c.nomeCliente||'Não informado')+'</b></div><div class="wa-info"><small>WhatsApp</small><b>'+esc(c.telefone||'')+'</b></div><div class="wa-info"><small>Status</small><b>'+esc(rotuloStatus(c.status))+'</b></div><div class="wa-info"><small>Responsável</small><b>'+esc(c.responsavelNome||'Não atribuído')+'</b></div><div class="wa-info"><small>Última atualização</small><b>'+esc(fmtData(c.atualizadaEm))+'</b></div><h3 style="margin-top:18px">Notas internas</h3><div id="wa-notas"><div class="wa-sub">Carregando...</div></div>'+(tem('atendimento-conversas','notas')?'<textarea id="wa-nota" class="wa-textarea" placeholder="Observação que o cliente não vê..."></textarea><button id="wa-add-nota" class="wa-btn" style="width:100%;margin-top:7px">Adicionar nota</button>':'');carregarNotas();var b=document.getElementById('wa-add-nota');if(b)b.onclick=adicionarNota;}
  function carregarNotas(){if(!conversaAtual)return;raw().collection('wa_conversas').doc(conversaAtual.id).collection('notas').orderBy('criadaEm','desc').limit(50).get().then(function(s){var h=document.getElementById('wa-notas');if(!h)return;h.innerHTML=s.empty?'<div class="wa-sub">Nenhuma nota interna.</div>':s.docs.map(function(d){var n=d.data()||{};return '<div class="wa-note">'+esc(n.texto||'')+'<small>'+esc(n.autorNome||'')+' · '+esc(fmtData(n.criadaEm))+'</small></div>';}).join('');}).catch(function(){});}
  async function adicionarNota(){var ta=document.getElementById('wa-nota');var texto=(ta&&ta.value||'').trim();if(!texto)return;try{await call('whatsappAdicionarNota',{conversaId:conversaAtual.id,texto:texto});ta.value='';carregarNotas();toast('Nota adicionada.');}catch(e){toast(e.message||String(e),'error');}}

  async function carregarAgentes(){if(agentes.length)return agentes;try{var r=await call('whatsappListarAgentes',{});agentes=r.agentes||[];}catch(e){agentes=[];}return agentes;}

  function renderDashboard(){iniciarConversas();var pg=document.getElementById('page-atendimento-dashboard');if(!pg)return;pg.innerHTML='<div class="wa-wrap">'+shellTitulo('📊 Dashboard de Atendimento','Visão da fila do WhatsApp e da operação multiatendente')+'<div id="wa-dashboard-body"><div class="wa-empty"><i>⏳</i><span>Carregando indicadores...</span></div></div></div>';renderDashboardConteudo();}
  function renderDashboardConteudo(){var h=document.getElementById('wa-dashboard-body');if(!h)return;var total=conversas.length,novos=conversas.filter(function(c){return(c.status||'novo')==='novo';}).length,at=conversas.filter(function(c){return c.status==='em_atendimento';}).length,ag=conversas.filter(function(c){return c.status==='aguardando_cliente';}).length,res=conversas.filter(function(c){return c.status==='resolvido';}).length;var por={};conversas.forEach(function(c){if(c.responsavelNome)por[c.responsavelNome]=(por[c.responsavelNome]||0)+1;});var ranks=Object.keys(por).sort(function(a,b){return por[b]-por[a];});h.innerHTML='<div class="wa-grid-kpi"><div class="wa-kpi"><span>Total na base</span><b>'+total+'</b></div><div class="wa-kpi"><span>Novos</span><b>'+novos+'</b></div><div class="wa-kpi"><span>Em atendimento</span><b>'+at+'</b></div><div class="wa-kpi"><span>Aguardando cliente</span><b>'+ag+'</b></div><div class="wa-kpi"><span>Resolvidos</span><b>'+res+'</b></div></div><div class="wa-dashboard-grid"><div class="wa-panel"><div class="wa-panel-title">Conversas recentes</div><table class="wa-table"><thead><tr><th>Cliente</th><th>Status</th><th>Responsável</th><th>Atualização</th></tr></thead><tbody>'+conversas.slice(0,10).map(function(c){return'<tr><td>'+esc(c.nomeCliente||c.telefone)+'</td><td>'+esc(rotuloStatus(c.status))+'</td><td>'+esc(c.responsavelNome||'-')+'</td><td>'+esc(fmtData(c.atualizadaEm))+'</td></tr>';}).join('')+'</tbody></table></div><div class="wa-panel"><div class="wa-panel-title">Atendimentos por responsável</div><table class="wa-table"><tbody>'+(ranks.length?ranks.map(function(n){return'<tr><td>'+esc(n)+'</td><td><b>'+por[n]+'</b></td></tr>';}).join(''):'<tr><td class="wa-sub">Nenhum atendimento atribuído ainda.</td></tr>')+'</tbody></table></div></div>';}

  async function renderConfig(){var pg=document.getElementById('page-atendimento-config');if(!pg)return;pg.innerHTML='<div class="wa-wrap">'+shellTitulo('⚙️ Configuração do WhatsApp','Conexão oficial com a WhatsApp Business Platform (Meta)')+'<div id="wa-config-body"><div class="wa-empty"><i>⏳</i><span>Verificando integração...</span></div></div></div>';var h=document.getElementById('wa-config-body');try{var st=await call('whatsappStatusIntegracao',{});h.innerHTML='<div class="wa-config-grid"><div class="wa-card"><h3>Conexão Meta</h3><p><span class="wa-status-dot '+(st.configurado?'ok':'warn')+'"></span><b>'+(st.configurado?'Configurada':'Pendente de configuração')+'</b></p><div class="wa-info"><small>Phone Number ID</small><b>'+esc(st.phoneNumberId||'Não configurado')+'</b></div><div class="wa-info"><small>Versão Graph API</small><b>'+esc(st.graphVersion||'Configurável no backend')+'</b></div><p class="wa-sub">Tokens e segredo do aplicativo ficam no Secret Manager do Firebase e nunca são expostos nesta tela.</p></div><div class="wa-card"><h3>Webhook</h3><p class="wa-sub">Cadastre na Meta o endpoint da Cloud Function <b>whatsappWebhook</b>. O token de verificação também fica no Secret Manager.</p><div class="wa-info"><small>Eventos tratados na V1</small><b>Mensagens recebidas e status de envio</b></div><div class="wa-info"><small>Modelo</small><b>WhatsApp Business Platform / Cloud API</b></div></div></div>';}catch(e){h.innerHTML='<div class="wa-card"><h3>Integração ainda não publicada</h3><p class="wa-sub">Publique as Cloud Functions da V1 e configure os segredos da Meta. Erro atual: '+esc(e.message||String(e))+'</p></div>';}}

  global.atendimentoIrParaPagina=atendimentoIrParaPagina;
  global.DTAtendimento={abrirConversa:abrirConversa,renderInbox:renderInbox};
})(window);
