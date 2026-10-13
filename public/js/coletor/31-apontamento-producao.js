(function(global){
  'use strict';

  var produtoAtual=null;
  var capaAtual=null;
  // Divergência de quantidade aguardando aprovação (usada na conferência).
  var divergenciaQuantidadePendente=null;
  var requisicaoAtual='';
  var DRAFT_KEY='dt_apontamento_producao_rascunho_v1';

  function lojaId(){
    try{
      if(typeof global.getDTLojaAtiva==='function' && global.getDTLojaAtiva()) return String(global.getDTLojaAtiva());
      if(global.APP && global.APP.lojaAtual && global.APP.lojaAtual.id) return String(global.APP.lojaAtual.id);
      if(global.APP && global.APP.lojaId) return String(global.APP.lojaId);
    }catch(e){}
    return '';
  }
  function call(nome,dados){
    // O Coletor usa um app Firebase com nome próprio (DT_FIREBASE_APP_NOME): firebase.app()
    // sem nome não existe aqui. getDTFirebaseApp() devolve o app certo.
    if(typeof global.getDTFirebaseApp!=='function') return Promise.reject(new Error('Firebase indisponível.'));
    return global.getDTFirebaseApp().functions('southamerica-east1').httpsCallable(nome)(dados||{}).then(function(r){return r&&r.data?r.data:{};});
  }
  function txt(v){return String(v==null?'':v);}
  function esc(v){return txt(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function status(id,msg,tipo){
    var el=document.getElementById(id); if(!el)return;
    el.textContent=msg||'';
    el.style.color=tipo==='e'?'#ff6b6b':tipo==='ok'?'#22c55e':'var(--muted,#8aa4bd)';
  }
  function fmtData(v){if(!v)return '—';try{return new Date(v).toLocaleString('pt-BR');}catch(e){return txt(v);}}
  function garantirRequisicaoId(){if(requisicaoAtual)return requisicaoAtual;requisicaoAtual='ap_'+Date.now()+'_'+Math.floor(Math.random()*1000000000);return requisicaoAtual;}
  function salvarRascunho(){
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify({gtin:document.getElementById('ap-produto-gtin')&&document.getElementById('ap-produto-gtin').value||'',lote:document.getElementById('ap-lote')&&document.getElementById('ap-lote').value||'',validade:document.getElementById('ap-validade')&&document.getElementById('ap-validade').value||'',quantidade:document.getElementById('ap-quantidade')&&document.getElementById('ap-quantidade').value||'',requisicaoId:garantirRequisicaoId()}));}catch(e){}
  }
  function restaurarRascunho(){
    try{
      var r=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}');requisicaoAtual=r.requisicaoId||'';garantirRequisicaoId();
      if(document.getElementById('ap-produto-gtin'))document.getElementById('ap-produto-gtin').value=r.gtin||'';
      if(document.getElementById('ap-lote'))document.getElementById('ap-lote').value=r.lote||'';
      if(document.getElementById('ap-validade'))document.getElementById('ap-validade').value=r.validade||'';
      if(document.getElementById('ap-quantidade'))document.getElementById('ap-quantidade').value=r.quantidade||'';
    }catch(e){}
  }
  function limparRascunho(){try{localStorage.removeItem(DRAFT_KEY);}catch(e){}requisicaoAtual='';}

  global.abrirAreaEstoque=function(){
    if(typeof global.coletorTemAlgumaPermissao==='function'&&!global.coletorTemAlgumaPermissao([['estoque-rel-apontamento','visualizar'],['estoque-rel-apontamento','criar'],['estoque-rel-apontamento','conferir'],['estoque-separacao','visualizar']]))return;
    global.goScreen('estoque-modo');if(typeof global.aplicarPermissoesMenuColetor==='function')global.aplicarPermissoesMenuColetor();
  };
  global.abrirAreaEstoqueApontamento=function(){
    if(typeof global.coletorTemAlgumaPermissao==='function' && !global.coletorTemAlgumaPermissao([['estoque-rel-apontamento','visualizar'],['estoque-rel-apontamento','criar'],['estoque-rel-apontamento','conferir']]))return;
    if(typeof global.goScreen==='function')global.goScreen('estoque-apontamento-modo');
    if(typeof global.aplicarPermissoesMenuColetor==='function')global.aplicarPermissoesMenuColetor();
  };
  global.abrirApontamentoProducao=function(){
    if(typeof global.coletorExigirPermissao==='function'&&!global.coletorExigirPermissao('estoque-rel-apontamento','criar'))return;
    produtoAtual=null;
    if(typeof global.goScreen==='function')global.goScreen('apontamento-producao');
    var info=document.getElementById('ap-produto-info');if(info)info.style.display='none';
    var capa=document.getElementById('ap-capa-gerada');if(capa)capa.style.display='none';
    restaurarRascunho();
    setTimeout(function(){var el=document.getElementById('ap-produto-gtin');if(el)el.focus();},100);
  };
  global.abrirConferenciaApontamento=function(){
    if(typeof global.coletorExigirPermissao==='function'&&!global.coletorExigirPermissao('estoque-rel-apontamento','conferir'))return;
    capaAtual=null;
    if(typeof global.goScreen==='function')global.goScreen('apontamento-conferencia');
    var d=document.getElementById('ap-conf-detalhe');if(d)d.style.display='none';
    var c=document.getElementById('ap-conf-campos');if(c)c.style.display='none';
    divergenciaQuantidadePendente=null;
    var aq=document.getElementById('ap-conf-aprovar-qtd');if(aq)aq.style.display='none';
    var av=document.getElementById('ap-conf-divergencia-aviso');if(av){av.style.display='none';av.innerHTML='';}
    if(document.getElementById('ap-conf-capa'))document.getElementById('ap-conf-capa').value='';
    status('ap-conf-status','');
    var ini=document.getElementById('ap-conf-ini'),fim=document.getElementById('ap-conf-fim');
    if(ini&&!ini.value)ini.value=hojeIso();
    if(fim&&!fim.value)fim.value=hojeIso();
    if(ini)ini.onchange=function(){global.apontamentoRecarregarLista();};
    if(fim)fim.onchange=function(){global.apontamentoRecarregarLista();};
    // Produto e status filtram só o que o período já trouxe (não consultam de novo).
    var prodEl=document.getElementById('ap-conf-produto'),stEl=document.getElementById('ap-conf-status-filtro');
    if(prodEl)prodEl.oninput=function(){confRender();};
    if(prodEl)prodEl.onchange=function(){confRender();};
    if(stEl)stEl.onchange=function(){confRender();};
    global.apontamentoRecarregarLista();
    setTimeout(function(){var el=document.getElementById('ap-conf-capa');if(el)el.focus();},100);
  };
  // Lista de pallets pendentes do período escolhido (padrão: hoje). Tocar em
  // "Conferir" abre o mesmo fluxo de conferência que a capa digitada.
  function hojeIso(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  // Lista de pallets do período. Produto e status filtram o que o período trouxe.
  // ✓ aprova (com confirmação) e envia à BlueSoft. ✕ pede o motivo e reprova
  // (não envia nada à BlueSoft).
  var confItens=[];
  function confStatusOk(x,f){
    var s=x.status;
    if(f==='TODOS')return true;
    if(f==='PENDENTES')return s==='AGUARDANDO_CONFERENCIA'||s==='DIVERGENTE';
    if(f==='APROVADOS')return s==='CONFERIDO_AGUARDANDO_INTEGRACAO'||s==='ENVIANDO'||s==='PROCESSANDO'||s==='ERRO_REJEITADO';
    if(f==='REPROVADOS')return s==='REPROVADO';
    if(f==='INTEGRADOS')return s==='APONTADO_BLUESOFT';
    return true;
  }
  function confStatusLabel(s){
    var m={AGUARDANDO_CONFERENCIA:'Pendente',DIVERGENTE:'Divergente',CONFERIDO_AGUARDANDO_INTEGRACAO:'Aprovado',ENVIANDO:'Processando',PROCESSANDO:'Processando',ERRO_REJEITADO:'Erro na BlueSoft',APONTADO_BLUESOFT:'Integrado BlueSoft',REPROVADO:'Reprovado'};
    return m[s]||String(s||'');
  }
  function confHora(v){var d=v?new Date(v):null;return d&&!isNaN(d)?d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';}
  function confRender(){
    var box=document.getElementById('ap-conf-lista'),cont=document.getElementById('ap-conf-contagem');
    var prodEl=document.getElementById('ap-conf-produto'),stEl=document.getElementById('ap-conf-status-filtro');
    if(!box)return;
    var p=(prodEl&&prodEl.value||'').trim().toLowerCase(),f=(stEl&&stEl.value)||'PENDENTES';
    var lista=confItens.filter(function(x){
      if(!confStatusOk(x,f))return false;
      if(p&&![x.produtoKey,x.codigo,x.descricaoProduto,x.gtin].join(' ').toLowerCase().includes(p))return false;
      return true;
    });
    if(cont)cont.textContent=lista.length+' pallet(s) encontrado(s)';
    if(!lista.length){box.innerHTML='<div style="color:var(--muted);font-size:.8rem;padding:8px 0">Nenhum pallet com esse filtro neste período.</div>';return;}
    box.innerHTML=lista.map(function(x){
      var pend=x.status==='AGUARDANDO_CONFERENCIA'||x.status==='DIVERGENTE';
      var acoes=pend?'<div style="display:flex;gap:8px;flex-shrink:0">'+
        '<button type="button" data-conf-aprovar="'+esc(x.capa)+'" style="width:44px;height:44px;border-radius:50%;border:0;background:#16a34a;color:#fff;font-size:1.2rem;font-weight:800">✓</button>'+
        '<button type="button" data-conf-reprovar="'+esc(x.capa)+'" style="width:44px;height:44px;border-radius:50%;border:0;background:#dc2626;color:#fff;font-size:1.2rem;font-weight:800">✕</button></div>':'';
      return '<div style="border:1px solid var(--border,#29445f);border-radius:10px;padding:8px 10px;margin-bottom:6px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'+
          '<div style="min-width:0"><div style="font-weight:800">CAPA '+esc(x.capa)+' · qtd '+esc(x.quantidade)+'</div>'+
          '<div style="font-size:.75rem;color:var(--muted)">Validade '+esc(x.validade||'—')+' · '+esc(confHora(x.dataHoraApontamento))+'</div>'+
          '<div style="font-size:.72rem;color:var(--muted)">'+esc(x.descricaoProduto||x.produtoKey||'')+' · '+esc(confStatusLabel(x.status))+'</div></div>'+acoes+'</div>'+
        (pend?'<div data-conf-motivo-box="'+esc(x.capa)+'" style="display:none;margin-top:8px"><input class="field" data-conf-motivo="'+esc(x.capa)+'" placeholder="Motivo da reprovação"/><button type="button" data-conf-reprovar-ok="'+esc(x.capa)+'" class="btn btn-danger" style="margin-top:6px;padding:8px">Confirmar reprovação</button></div>':'')+
        '</div>';
    }).join('');
    box.querySelectorAll('[data-conf-aprovar]').forEach(function(b){b.onclick=function(){confAprovar(this.getAttribute('data-conf-aprovar'));};});
    box.querySelectorAll('[data-conf-reprovar]').forEach(function(b){b.onclick=function(){var c=this.getAttribute('data-conf-reprovar');var m=box.querySelector('[data-conf-motivo-box="'+c+'"]');if(m)m.style.display=m.style.display==='none'?'block':'none';};});
    box.querySelectorAll('[data-conf-reprovar-ok]').forEach(function(b){b.onclick=function(){confReprovar(this.getAttribute('data-conf-reprovar-ok'));};});
  }
  function confAprovar(capa){
    var x=confItens.filter(function(i){return String(i.capa)===String(capa);})[0];
    if(!x)return;
    var msg='Aprovar a capa '+x.capa+' ('+(x.descricaoProduto||x.produtoKey||'')+', qtd '+x.quantidade+', validade '+(x.validade||'—')+')? O apontamento será enviado à BlueSoft.';
    if(!window.confirm(msg))return;
    status('ap-conf-status','Enviando para a BlueSoft...');
    call('apontamentoConferirEnviar',{capa:x.capa,lojaId:lojaId(),gtinConferido:x.gtin||'',loteConferido:x.lote||'',validadeConferida:x.validade||'',quantidadeConferida:x.quantidade}).then(function(){
      status('ap-conf-status','Aprovado e enviado à BlueSoft.','ok');global.apontamentoRecarregarLista();
    }).catch(function(e){status('ap-conf-status',e&&e.message?e.message:String(e),'e');});
  }
  function confReprovar(capa){
    var inp=document.querySelector('[data-conf-motivo="'+capa+'"]');
    var motivo=txt(inp&&inp.value).trim();
    if(!motivo){status('ap-conf-status','Informe o motivo da reprovação.','e');return;}
    status('ap-conf-status','Reprovando...');
    call('apontamentoReprovar',{capa:capa,motivo:motivo}).then(function(){
      status('ap-conf-status','Pallet reprovado. Nada foi enviado à BlueSoft.','ok');global.apontamentoRecarregarLista();
    }).catch(function(e){status('ap-conf-status',e&&e.message?e.message:String(e),'e');});
  }
  global.apontamentoRecarregarLista=function(){
    var ini=document.getElementById('ap-conf-ini'),fim=document.getElementById('ap-conf-fim'),box=document.getElementById('ap-conf-lista');
    if(!box)return;
    var di=(ini&&ini.value)||hojeIso(),df=(fim&&fim.value)||hojeIso();
    box.innerHTML='<div style="color:var(--muted);font-size:.8rem;padding:8px 0">Carregando pallets...</div>';
    call('apontamentoListar',{lojaId:lojaId(),limite:500,dataInicio:di,dataFim:df}).then(function(r){
      confItens=r.itens||[];
      // Produtos sugeridos: só os que têm apontamento no período.
      var dl=document.getElementById('ap-conf-produtos');
      if(dl){var nomes=[];confItens.forEach(function(x){var n=(x.produtoKey||'')+' · '+(x.descricaoProduto||'');if(nomes.indexOf(n)<0)nomes.push(n);});dl.innerHTML=nomes.map(function(n){return '<option value="'+esc(n)+'">';}).join('');}
      confRender();
    }).catch(function(e){box.innerHTML='<div style="color:#f87171;font-size:.8rem">'+esc(e&&e.message?e.message:String(e))+'</div>';});
  };
  global.abrirHistoricoApontamento=function(){
    if(typeof global.coletorExigirPermissao==='function'&&!global.coletorExigirPermissao('estoque-rel-apontamento','visualizar'))return;
    if(typeof global.goScreen==='function')global.goScreen('apontamento-historico');
    global.carregarHistoricoApontamento();
  };

  global.apontamentoBuscarProduto=function(){
    var gtin=txt(document.getElementById('ap-produto-gtin')&&document.getElementById('ap-produto-gtin').value).trim();
    if(!gtin){status('ap-status','Bipe ou informe o produto.','e');return Promise.resolve();}
    if(!lojaId()){status('ap-status','Selecione uma loja antes de apontar.','e');return Promise.resolve();}
    status('ap-status','Consultando produto na BlueSoft...');
    var b=document.getElementById('ap-produto-buscar');if(b)b.disabled=true;
    return call('apontamentoConsultarProduto',{lojaId:lojaId(),gtin:gtin}).then(function(r){
      produtoAtual=r.produto||null;
      if(!produtoAtual)throw new Error('Produto não encontrado.');
      var info=document.getElementById('ap-produto-info');
      if(info){
        info.innerHTML='<div style="font-weight:800">'+esc(produtoAtual.codigo||produtoAtual.produtoKey)+' · '+esc(produtoAtual.descricao||'Produto')+'</div>'+
          '<div style="margin-top:4px;color:var(--muted,#8aa4bd)">GTIN: '+esc(gtin)+(produtoAtual.fichaTecnicaKey?' · Ficha técnica '+esc(produtoAtual.fichaTecnicaKey):' · Apontamento por produto')+'</div>';
        info.style.display='block';
      }
      if(r.validadeSugerida && document.getElementById('ap-validade') && !document.getElementById('ap-validade').value)document.getElementById('ap-validade').value=r.validadeSugerida;
      salvarRascunho();status('ap-status','Produto validado.','ok');
    }).catch(function(e){produtoAtual=null;var info=document.getElementById('ap-produto-info');if(info)info.style.display='none';status('ap-status',e&&e.message?e.message:String(e),'e');}).then(function(){if(b)b.disabled=false;});
  };

  global.apontamentoCriarCapa=function(){
    if(typeof global.coletorExigirPermissao==='function'&&!global.coletorExigirPermissao('estoque-rel-apontamento','criar'))return;
    var gtin=txt(document.getElementById('ap-produto-gtin').value).trim(),lote=txt(document.getElementById('ap-lote').value).trim(),validade=txt(document.getElementById('ap-validade').value).trim(),quantidade=Number(document.getElementById('ap-quantidade').value||0);
    if(!produtoAtual || txt(produtoAtual.gtin)!==gtin){status('ap-status','Valide novamente o produto antes de gerar a capa.','e');return;}
    if(!lote){status('ap-status','Informe o lote.','e');return;}
    if(!validade){status('ap-status','Informe a validade.','e');return;}
    if(!(quantidade>0)){status('ap-status','Informe uma quantidade maior que zero.','e');return;}
    salvarRascunho();
    var btn=document.getElementById('ap-salvar');if(btn)btn.disabled=true;
    status('ap-status','Gerando capa única...');
    call('apontamentoCriarPre',{requisicaoId:garantirRequisicaoId(),lojaId:lojaId(),produtoKey:produtoAtual.produtoKey,gtin:gtin,descricaoProduto:produtoAtual.descricao||'',fichaTecnicaKey:produtoAtual.fichaTecnicaKey||null,tipoApontamento:produtoAtual.tipoApontamento||'',lote:lote,validade:validade,quantidade:quantidade}).then(function(r){
      var box=document.getElementById('ap-capa-gerada');document.getElementById('ap-capa-numero').textContent=r.capa||'';
      document.getElementById('ap-capa-resumo').innerHTML='<strong>'+esc(produtoAtual.descricao||produtoAtual.produtoKey)+'</strong><br>Lote '+esc(lote)+' · Val. '+esc(validade)+' · Qtd. '+esc(quantidade)+'<br><span style="color:var(--muted,#8aa4bd)">Aguardando conferência da Logística</span>';
      if(box)box.style.display='block';
      status('ap-status','Pré-apontamento salvo. Nada foi enviado à BlueSoft ainda.','ok');
      limparRascunho();
      produtoAtual=null;
      document.getElementById('ap-produto-gtin').value='';document.getElementById('ap-lote').value='';document.getElementById('ap-validade').value='';document.getElementById('ap-quantidade').value='';
      var info=document.getElementById('ap-produto-info');if(info)info.style.display='none';
    }).catch(function(e){status('ap-status',e&&e.message?e.message:String(e),'e');}).then(function(){if(btn)btn.disabled=false;});
  };

  global.apontamentoCarregarCapa=function(){
    var capa=txt(document.getElementById('ap-conf-capa').value).trim();
    if(!/^\d{7}$/.test(capa)){status('ap-conf-status','Informe uma capa de 7 dígitos.','e');return;}
    divergenciaQuantidadePendente=null;var aq=document.getElementById('ap-conf-aprovar-qtd');if(aq)aq.style.display='none';var av=document.getElementById('ap-conf-divergencia-aviso');if(av){av.style.display='none';av.innerHTML='';}
    status('ap-conf-status','Localizando capa...');
    call('apontamentoObter',{capa:capa,lojaId:lojaId()}).then(function(r){
      capaAtual=r.apontamento||null;if(!capaAtual)throw new Error('Capa não encontrada.');
      var d=document.getElementById('ap-conf-detalhe');
      d.innerHTML='<div style="font-size:1.35rem;font-weight:900">CAPA '+esc(capaAtual.capa)+'</div><div style="margin-top:8px"><strong>'+esc(capaAtual.descricaoProduto||capaAtual.produtoKey)+'</strong></div><div>Lote: '+esc(capaAtual.lote)+' · Validade: '+esc(capaAtual.validade)+'</div><div>Quantidade apontada: <strong>'+esc(capaAtual.quantidade)+'</strong></div><div style="color:var(--muted,#8aa4bd);margin-top:5px">Produção: '+esc(capaAtual.usuarioApontamentoNome||'—')+' · '+esc(fmtData(capaAtual.dataHoraApontamento))+'</div>';
      d.style.display='block';document.getElementById('ap-conf-campos').style.display='block';
      document.getElementById('ap-conf-gtin').value='';document.getElementById('ap-conf-lote').value='';document.getElementById('ap-conf-validade').value='';document.getElementById('ap-conf-qtd').value='';document.getElementById('ap-conf-obs').value='';
      status('ap-conf-status','Confira fisicamente o pallet.');
      setTimeout(function(){document.getElementById('ap-conf-gtin').focus();},80);
    }).catch(function(e){capaAtual=null;document.getElementById('ap-conf-detalhe').style.display='none';document.getElementById('ap-conf-campos').style.display='none';status('ap-conf-status',e&&e.message?e.message:String(e),'e');});
  };

  global.apontamentoConfirmarConferencia=function(){
    if(typeof global.coletorExigirPermissao==='function'&&!global.coletorExigirPermissao('estoque-rel-apontamento','conferir'))return;
    if(!capaAtual){status('ap-conf-status','Carregue uma capa primeiro.','e');return;}
    var gtin=txt(document.getElementById('ap-conf-gtin').value).trim(),lote=txt(document.getElementById('ap-conf-lote').value).trim(),validade=txt(document.getElementById('ap-conf-validade').value).trim(),qtd=Number(document.getElementById('ap-conf-qtd').value||0),obs=txt(document.getElementById('ap-conf-obs').value).trim();
    if(!gtin||!lote||!validade||!(qtd>0)){status('ap-conf-status','Bipe o produto e confirme lote, validade e quantidade.','e');return;}
    status('ap-conf-status','Registrando conferência...');
    call('apontamentoConferirEnviar',{capa:capaAtual.capa,lojaId:lojaId(),gtinConferido:gtin,loteConferido:lote,validadeConferida:validade,quantidadeConferida:qtd,observacao:obs}).then(function(r){
      if(r.divergente){
        divergenciaQuantidadePendente=null;
        var btnAprovar=document.getElementById('ap-conf-aprovar-qtd'),aviso=document.getElementById('ap-conf-divergencia-aviso');
        if(btnAprovar)btnAprovar.style.display='none';
        if(aviso){aviso.style.display='block';aviso.innerHTML='<strong>Divergência registrada.</strong><br>Nenhum apontamento foi enviado à BlueSoft.';}
        if(r.podeAprovarQuantidade){
          divergenciaQuantidadePendente={capa:capaAtual.capa,quantidade:qtd};
          if(aviso)aviso.innerHTML='<strong>Quantidade diferente.</strong><br>Apontado: '+esc(capaAtual.quantidade)+' · Conferido: '+esc(qtd)+'.<br>Informe obrigatoriamente o motivo e, se a quantidade física estiver correta, use o botão abaixo para aprovar.';
          if(btnAprovar)btnAprovar.style.display='block';
          status('ap-conf-status','Quantidade divergente. Revise e aprove somente se o físico estiver correto.','e');
        }else{
          status('ap-conf-status','Divergência de produto, lote ou validade. Corrija antes de continuar.','e');
        }
        return;
      }
      divergenciaQuantidadePendente=null;var btnOk=document.getElementById('ap-conf-aprovar-qtd');if(btnOk)btnOk.style.display='none';var avOk=document.getElementById('ap-conf-divergencia-aviso');if(avOk)avOk.style.display='none';
      if(r.processando){status('ap-conf-status','Pallet conferido. BlueSoft recebeu a solicitação e está processando.','ok');}
      else if(r.concluido){status('ap-conf-status','Pallet conferido e apontado na BlueSoft com sucesso.','ok');}
      else status('ap-conf-status','Conferência registrada. Integração pendente.','ok');
      document.getElementById('ap-conf-campos').style.display='none';capaAtual=null;
    }).catch(function(e){status('ap-conf-status',e&&e.message?e.message:String(e),'e');});
  };


  global.apontamentoAprovarQuantidadeDivergente=function(){
    if(typeof global.coletorExigirPermissao==='function'&&!global.coletorExigirPermissao('estoque-rel-apontamento','conferir'))return;
    if(!capaAtual||!divergenciaQuantidadePendente){status('ap-conf-status','Não há divergência de quantidade pendente para aprovar.','e');return;}
    var obs=txt(document.getElementById('ap-conf-obs').value).trim();
    if(!obs){status('ap-conf-status','Informe o motivo/justificativa da quantidade divergente antes de aprovar.','e');var oe=document.getElementById('ap-conf-obs');if(oe)oe.focus();return;}
    var qtd=divergenciaQuantidadePendente.quantidade;
    if(!global.confirm('Aprovar a quantidade física conferida ('+qtd+') e enviar este pallet para a BlueSoft?'))return;
    status('ap-conf-status','Aprovando quantidade e enviando à BlueSoft...');
    call('apontamentoAprovarDivergenciaQuantidade',{capa:capaAtual.capa,lojaId:lojaId(),observacao:obs}).then(function(r){
      divergenciaQuantidadePendente=null;
      var btn=document.getElementById('ap-conf-aprovar-qtd');if(btn)btn.style.display='none';
      var aviso=document.getElementById('ap-conf-divergencia-aviso');if(aviso)aviso.style.display='none';
      if(r.processando)status('ap-conf-status','Quantidade aprovada. BlueSoft recebeu a solicitação e está processando.','ok');
      else if(r.concluido)status('ap-conf-status','Quantidade aprovada e apontamento concluído na BlueSoft.','ok');
      else status('ap-conf-status','Quantidade aprovada. Integração registrada.','ok');
      document.getElementById('ap-conf-campos').style.display='none';capaAtual=null;
    }).catch(function(e){status('ap-conf-status',e&&e.message?e.message:String(e),'e');});
  };

  global.carregarHistoricoApontamento=function(){
    status('ap-historico-status','Carregando...');
    call('apontamentoListar',{lojaId:lojaId(),limite:50}).then(function(r){
      var itens=r.itens||[],host=document.getElementById('ap-historico-lista');
      host.innerHTML=itens.length?itens.map(function(x){return '<div style="border:1px solid var(--border,#29445f);border-radius:10px;padding:10px;margin-top:8px"><div style="display:flex;justify-content:space-between;gap:8px"><strong>CAPA '+esc(x.capa)+'</strong><span style="font-size:.72rem">'+esc(x.status||'')+'</span></div><div style="font-size:.8rem;margin-top:5px">'+esc(x.descricaoProduto||x.produtoKey)+'</div><div style="font-size:.75rem;color:var(--muted,#8aa4bd)">Lote '+esc(x.lote)+' · Qtd. '+esc(x.quantidade)+' · '+esc(fmtData(x.dataHoraApontamento))+'</div></div>';}).join(''):'<div style="padding:18px;text-align:center;color:var(--muted,#8aa4bd)">Nenhum apontamento encontrado.</div>';
      status('ap-historico-status',itens.length+' registro(s).','ok');
    }).catch(function(e){status('ap-historico-status',e&&e.message?e.message:String(e),'e');});
  };

  function bindEnter(id,fn){var el=document.getElementById(id);if(!el||el.getAttribute('data-ap-bound')==='1')return;el.setAttribute('data-ap-bound','1');el.addEventListener('keydown',function(e){if((e.key||e.keyCode)==='Enter'||e.keyCode===13){e.preventDefault();fn();}});}
  function init(){
    bindEnter('ap-produto-gtin',global.apontamentoBuscarProduto);bindEnter('ap-conf-capa',global.apontamentoCarregarCapa);
    ['ap-produto-gtin','ap-lote','ap-validade','ap-quantidade'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',salvarRascunho);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
