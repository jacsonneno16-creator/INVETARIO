(function(global){
  const raw=()=>global.getDTRawFirestore();
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function renderGestaoLojas(){
    const grid=document.getElementById('lojas-grid');
    const lista=document.getElementById('lojas-lista');
    const destinos=[grid,lista].filter(Boolean);
    if(!destinos.length)return;
    destinos.forEach(box=>box.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando lojas...</div></div>');
    try{
      const lojas=await global.DTLoja.garantirLojaInicial(), ativa=global.getDTLojaAtiva();
      const linhas=lojas.map(l=>`<tr>
        <td><div style="display:flex;align-items:center;gap:10px"><div class="u-avatar" style="width:32px;height:32px;font-size:.78rem;flex:0 0 auto">🏪</div><div><div style="font-weight:750">${esc(l.nome||l.id)}</div><div class="mono" style="font-size:.66rem;color:var(--muted)">${esc(l.codigo||l.id)}</div></div></div></td>
        <td>${esc(l.responsavel||'—')}</td>
        <td>${l.ativa===false?'<span class="badge badge-red">Inativa</span>':'<span class="badge badge-green">Ativa</span>'}</td>
        <td>${l.id===ativa?'<span class="badge badge-blue">Em uso</span>':'<span style="color:var(--muted);font-size:.74rem">Disponível</span>'}</td>
        <td style="text-align:center"><button class="acao-lapis" type="button" title="Configurar loja" aria-label="Configurar loja" data-loja-editar="${esc(l.id)}">✏️</button></td>
      </tr>`).join('');
      const tabela=linhas?`<div class="tbl-wrap lojas-lista-linhas"><table><thead><tr><th>Loja</th><th>Responsável</th><th>Status</th><th>Ambiente</th><th style="width:74px;text-align:center">Ações</th></tr></thead><tbody>${linhas}</tbody></table></div>`:'<div class="empty"><div class="empty-title">Nenhuma loja cadastrada</div></div>';
      if(grid) grid.innerHTML=tabela;
      if(lista) lista.innerHTML=tabela;
    }catch(e){
      destinos.forEach(box=>box.innerHTML=`<div class="empty"><div class="empty-title">Erro ao carregar lojas</div><div class="empty-sub">${esc(e.message||e)}</div></div>`);
      global.showToast?.('Erro ao carregar lojas: '+(e.message||e),'error');
    }
  }

  function abrirCadastroLoja(){
    const modal=document.getElementById('loja-modal-bg');
    if(modal){
      ['loja-codigo','loja-nome','loja-responsavel','loja-obs'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      const fb=document.getElementById('loja-modal-feedback');if(fb){fb.style.display='none';fb.innerHTML='';}
      modal.style.display='flex';
      setTimeout(()=>document.getElementById('loja-codigo')?.focus(),0);
      return;
    }
    document.getElementById('ml-id').value=''; document.getElementById('ml-nome').value=''; document.getElementById('ml-codigo').value=''; document.getElementById('ml-ativa').value='true'; document.getElementById('ml-title').textContent='Cadastrar loja'; openModal('modal-loja-cadastro');
  }
  function editarLoja(json){
    const l=typeof json==='string'?JSON.parse(json):json;
    const modal=document.getElementById('loja-edit-modal-bg');
    if(modal){
      document.getElementById('loja-edit-id').value=l.id||'';
      document.getElementById('loja-edit-nome').value=l.nome||'';
      document.getElementById('loja-edit-responsavel').value=l.responsavel||'';
      document.getElementById('loja-edit-obs').value=l.observacao||l.obs||'';
      const usarBtn=document.getElementById('loja-edit-usar');if(usarBtn){const emUso=l.id===global.getDTLojaAtiva();usarBtn.disabled=emUso;usarBtn.textContent=emUso?'Loja em uso':'Usar esta loja';}
      modal.style.display='flex';
      return;
    }
    document.getElementById('ml-id').value=l.id;document.getElementById('ml-nome').value=l.nome||'';document.getElementById('ml-codigo').value=l.codigo||'';document.getElementById('ml-ativa').value=String(l.ativa!==false);document.getElementById('ml-title').textContent='Editar loja';openModal('modal-loja-cadastro');
  }
  async function salvarLoja(){
    const nome=document.getElementById('ml-nome').value.trim(), codigo=document.getElementById('ml-codigo').value.trim().toUpperCase(); if(!nome){showToast('Informe o nome da loja','error');return;}
    const atualId=document.getElementById('ml-id').value, id=atualId||global.DTLoja.slug(codigo||nome);
    try{await raw().collection('lojas').doc(id).set({nome,codigo,ativa:document.getElementById('ml-ativa').value==='true',atualizada_em:new Date().toISOString(),...(atualId?{}:{criada_em:new Date().toISOString()})},{merge:true});closeModal('modal-loja-cadastro');showToast('Loja salva com sucesso','success');renderGestaoLojas();}
    catch(e){showToast('Erro ao salvar loja: '+e.message,'error');}
  }
  async function usarLoja(id){if(id===global.getDTLojaAtiva())return;if(typeof global.aplicarTrocaLojaAnalista==='function'){await global.aplicarTrocaLojaAnalista(id);await renderGestaoLojas();return;}global.setDTLojaAtiva(id);await renderGestaoLojas();}

  function _pausarMigracao(ms){
    return new Promise(function(resolve){ setTimeout(resolve, ms); });
  }

  async function _commitMigracaoControlado(batch, ops){
    if (!ops) return;
    await batch.commit();
    // WebViews e conexões lentas podem saturar o write stream quando muitos
    // commits são enfileirados em sequência. Uma pausa curta mantém apenas um
    // lote ativo por vez e evita resource-exhausted.
    await _pausarMigracao(120);
  }

  async function _copiarColecaoLegada(nome, lojaId, progresso){
    const origem=await raw().collection(nome).get();
    if(origem.empty) return 0;
    let total=0, batch=raw().batch(), ops=0;
    const LIMITE_LOTE=120;

    async function gravar(ref, dados){
      batch.set(ref, dados, {merge:true});
      ops++;
      if(ops>=LIMITE_LOTE){
        await _commitMigracaoControlado(batch, ops);
        batch=raw().batch();
        ops=0;
      }
    }

    for(const d of origem.docs){
      await gravar(raw().collection('lojas').doc(lojaId).collection(nome).doc(d.id), d.data());
      total++;

      if(['dt_inventarios','dt_auditorias'].includes(nome)){
        for(const sub of ['base_chunks','enderecos']){
          try{
            const ss=await d.ref.collection(sub).get();
            for(const sd of ss.docs){
              await gravar(
                raw().collection('lojas').doc(lojaId).collection(nome).doc(d.id).collection(sub).doc(sd.id),
                sd.data()
              );
            }
          }catch(_){ console.warn("[Erro tratado]", _); }
        }
      }
      if(progresso) progresso(nome,total);
    }
    if(ops) await _commitMigracaoControlado(batch, ops);
    return total;
  }
  const COLECOES_LEGADAS=['dt_inventarios','dt_contagens','dt_vazios','dt_recontagens','dt_divergencias','dt_locais','dt_locais_chunks','dt_locais_meta','dt_produtos','dt_auditorias','dt_auditoria_imports','dt_auditoria_meta','dt_operadores','dt_analistas','dt_logs_analista','dt_logs_coletor','dt_ranking_operadores'];
  const COLECOES_OPERACIONAIS_LOJA=COLECOES_LEGADAS.slice();

  async function sincronizarDadosLegadosAutomaticamente(){
    if(global.__dtMigracaoLegadaPromise) return global.__dtMigracaoLegadaPromise;

    global.__dtMigracaoLegadaPromise=(async function(){
      const lojaId=global.getDTLojaAtiva();
      const acesso=global.DT_USUARIO_ACESSO_ATUAL||{};
      let usuario=null;
      try { usuario=global.firebase && global.firebase.auth ? global.firebase.auth().currentUser : null; } catch(_){ console.warn("[Erro tratado]", _); }
      if(!usuario || !lojaId || (acesso.perfil!=='administrador' && acesso.admin_mestre!==true && acesso.administrador_mestre!==true)) {
        return {executado:false,total:0};
      }
      // Dados legados pertencem exclusivamente à Loja Matriz. Nunca copiar a
      // raiz automaticamente para filiais, pois isso mistura endereços,
      // produtos, inventários e auditorias entre ambientes.
      if(lojaId!=='loja_matriz') return {executado:false,total:0,isolado:true};

      const lojaRef=raw().collection('lojas').doc(lojaId);
      const lojaSnap=await lojaRef.get();
      const loja=lojaSnap.exists?(lojaSnap.data()||{}):{};
      if(loja.migracao_legada_concluida===true) return {executado:false,total:Number(loja.migracao_documentos||0)};

      // Evita duas abas/navegadores executarem a mesma migração ao mesmo tempo.
      if(loja.migracao_legada_status==='EM_ANDAMENTO' && loja.migracao_legada_uid && loja.migracao_legada_uid!==usuario.uid){
        return {executado:false,total:Number(loja.migracao_documentos||0),emAndamento:true};
      }

      const verificacoes=await Promise.all([
        lojaRef.collection('dt_locais').limit(1).get(),
        lojaRef.collection('dt_inventarios').limit(1).get(),
        lojaRef.collection('dt_operadores').limit(1).get(),
        raw().collection('dt_locais').limit(1).get(),
        raw().collection('dt_inventarios').limit(1).get(),
        raw().collection('dt_operadores').limit(1).get()
      ]);
      const destinoVazio=verificacoes[0].empty&&verificacoes[1].empty&&verificacoes[2].empty;
      const raizPossuiDados=!verificacoes[3].empty||!verificacoes[4].empty||!verificacoes[5].empty;
      if(!destinoVazio || !raizPossuiDados){
        await lojaRef.set({migracao_legada_concluida:true,migracao_legada_status:'CONCLUIDA',migracao_legada_em:new Date().toISOString(),migracao_documentos:0},{merge:true});
        return {executado:false,total:0};
      }

      await lojaRef.set({
        migracao_legada_status:'EM_ANDAMENTO',
        migracao_legada_uid:usuario.uid,
        migracao_legada_inicio:new Date().toISOString()
      },{merge:true});

      let total=0;
      try{
        for(const c of COLECOES_LEGADAS){
          const snapAtual=await lojaRef.get();
          const dadosAtual=snapAtual.exists?(snapAtual.data()||{}):{};
          const concluidas=Array.isArray(dadosAtual.migracao_colecoes_concluidas)?dadosAtual.migracao_colecoes_concluidas:[];
          if(concluidas.indexOf(c)>=0) continue;

          total+=await _copiarColecaoLegada(c,lojaId);
          await lojaRef.set({
            migracao_documentos:total,
            migracao_colecoes_concluidas:concluidas.concat([c]),
            migracao_ultima_colecao:c,
            migracao_atualizada_em:new Date().toISOString()
          },{merge:true});
          await _pausarMigracao(200);
        }
        await lojaRef.set({
          migracao_legada_concluida:true,
          migracao_legada_status:'CONCLUIDA',
          migracao_legada_em:new Date().toISOString(),
          migracao_documentos:total,
          migracao_origem:'COLECOES_RAIZ'
        },{merge:true});
        return {executado:true,total:total};
      }catch(error){
        await lojaRef.set({
          migracao_legada_status:'ERRO',
          migracao_legada_erro:String(error&&error.message||error),
          migracao_atualizada_em:new Date().toISOString()
        },{merge:true}).catch(function(error){ console.warn("[Falha assíncrona]", error); });
        throw error;
      }
    })();

    try { return await global.__dtMigracaoLegadaPromise; }
    finally { global.__dtMigracaoLegadaPromise=null; }
  }

  async function _excluirColecaoLojaControlado(lojaId,nome){
    const ref=raw().collection('lojas').doc(lojaId).collection(nome);
    let total=0;
    while(true){
      const snap=await ref.limit(100).get();
      if(snap.empty) break;
      const batch=raw().batch();
      for(const d of snap.docs){
        if(nome==='dt_inventarios' || nome==='dt_auditorias'){
          for(const sub of ['base_chunks','enderecos']){
            try{
              const ss=await d.ref.collection(sub).get();
              if(!ss.empty){
                let sb=raw().batch(),n=0;
                for(const sd of ss.docs){ sb.delete(sd.ref); n++; if(n>=100){await sb.commit();await _pausarMigracao(100);sb=raw().batch();n=0;} }
                if(n) await sb.commit();
              }
            }catch(_){ console.warn("[Erro tratado]", _); }
          }
        }
        batch.delete(d.ref); total++;
      }
      await batch.commit();
      await _pausarMigracao(140);
    }
    return total;
  }

  async function corrigirIsolamentoLojaAtual(){
    const lojaId=global.getDTLojaAtiva();
    if(!lojaId || lojaId==='loja_matriz') return {corrigido:false,total:0};
    const lojaRef=raw().collection('lojas').doc(lojaId);
    const snap=await lojaRef.get();
    const loja=snap.exists?(snap.data()||{}):{};
    if(loja.isolamento_corrigido_v33===true) return {corrigido:false,total:0};
    // A limpeza só ocorre quando há prova registrada de que esta filial recebeu
    // automaticamente uma cópia das coleções raiz na versão anterior.
    if(loja.migracao_origem!=='COLECOES_RAIZ' || loja.migracao_legada_concluida!==true){
      await lojaRef.set({isolamento_corrigido_v33:true,isolamento_verificado_em:new Date().toISOString()},{merge:true});
      return {corrigido:false,total:0};
    }
    let total=0;
    for(const nome of COLECOES_OPERACIONAIS_LOJA){
      total+=await _excluirColecaoLojaControlado(lojaId,nome);
    }
    await lojaRef.set({
      isolamento_corrigido_v33:true,
      isolamento_corrigido_em:new Date().toISOString(),
      isolamento_documentos_removidos:total,
      migracao_legada_concluida:false,
      migracao_legada_status:'CANCELADA_POR_ISOLAMENTO',
      migracao_origem:firebase.firestore.FieldValue.delete(),
      migracao_colecoes_concluidas:firebase.firestore.FieldValue.delete()
    },{merge:true});
    // Limpa somente o cache local da filial atual.
    try{
      Object.values(global.KEYS||{}).forEach(function(k){localStorage.removeItem(k+'__'+lojaId);});
      localStorage.removeItem('invcount_auditoria_metas__'+lojaId);
      localStorage.removeItem('dt_produtos_cache__'+lojaId);
    }catch(_){ console.warn("[Erro tratado]", _); }
    return {corrigido:true,total:total};
  }

  async function migrarDadosLegadosParaLojaAtual(){
    const lojaId=global.getDTLojaAtiva(); if(!lojaId){showToast('Selecione uma loja','error');return;}
    const colecoes=COLECOES_LEGADAS;
    if(!confirm('Copiar os dados antigos da raiz do Firebase para a loja atual? Os dados originais não serão apagados.'))return;
    let total=0;
    try{
      showToast('Migração iniciada. Não feche a página.','success');
      for(const c of colecoes) total+=await _copiarColecaoLegada(c,lojaId);
      await raw().collection('lojas').doc(lojaId).set({migracao_legada_em:new Date().toISOString(),migracao_documentos:total},{merge:true});
      showToast(`Migração concluída: ${total} documentos copiados.`,'success');
      setTimeout(()=>location.reload(),1200);
    }catch(e){showToast('Erro na migração: '+e.message,'error');console.error(e);}
  }

  async function editarLojaPorId(id){
    if(!id)return;
    try{
      // Consulta direta torna a edição independente de qualquer outra aba
      // ter sido aberta ou de caches já terem sido inicializados.
      let loja=null;
      try{
        const snap=await raw().collection('lojas').doc(String(id)).get();
        if(snap.exists) loja=Object.assign({id:snap.id},snap.data()||{});
      }catch(erroDireto){
        console.warn('[Lojas] Consulta direta indisponível; usando lista local.',erroDireto);
      }
      if(!loja){
        const lojas=await global.DTLoja.garantirLojaInicial();
        loja=lojas.find(item=>String(item.id)===String(id));
      }
      if(!loja)throw new Error('Loja não encontrada');
      editarLoja(loja);
    }catch(e){
      global.showToast?.('Não foi possível abrir a loja: '+(e.message||e),'error');
      console.error('[Lojas] Falha ao abrir edição:',e);
    }
  }

  function tratarCliqueEditarLoja(event){
    const alvo=event.target && event.target.closest ? event.target.closest('[data-loja-editar]') : null;
    if(!alvo)return;
    event.preventDefault();
    event.stopPropagation();
    if(typeof event.stopImmediatePropagation==='function')event.stopImmediatePropagation();
    editarLojaPorId(alvo.getAttribute('data-loja-editar'));
  }
  // Capture garante o clique mesmo se outro componente interromper a propagação.
  document.addEventListener('click',tratarCliqueEditarLoja,true);

  Object.assign(global,{renderGestaoLojas,abrirCadastroLoja,editarLoja,editarLojaPorId,salvarLoja,usarLoja,migrarDadosLegadosParaLojaAtual,sincronizarDadosLegadosAutomaticamente,corrigirIsolamentoLojaAtual});
})(window);