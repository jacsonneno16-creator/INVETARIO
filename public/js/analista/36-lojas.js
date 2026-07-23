(function(global){
  const raw=()=>global.getDTRawFirestore();
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function renderGestaoLojas(){
    const box=document.getElementById('lojas-lista'); if(!box)return;
    box.innerHTML='<div class="empty">Carregando lojas...</div>';
    try{
      const lojas=await global.DTLoja.garantirLojaInicial(), ativa=global.getDTLojaAtiva();
      box.innerHTML=`<div class="table-card"><table><thead><tr><th>Loja</th><th>Código</th><th>Status</th><th>Ambiente atual</th><th>Ações</th></tr></thead><tbody>${lojas.map(l=>`<tr>
        <td><b>${esc(l.nome||l.id)}</b><div style="font-size:.7rem;color:var(--muted)">${esc(l.id)}</div></td>
        <td>${esc(l.codigo||'—')}</td><td><span class="badge ${l.ativa===false?'badge-red':'badge-green'}">${l.ativa===false?'Inativa':'Ativa'}</span></td>
        <td>${l.id===ativa?'✅ Em uso':'—'}</td><td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick='editarLoja(${JSON.stringify(JSON.stringify(l))})'>Editar</button> <button class="btn btn-ghost btn-sm" onclick="usarLoja('${esc(l.id)}')">Usar</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    }catch(e){box.innerHTML=`<div class="empty">Erro ao carregar lojas: ${esc(e.message)}</div>`;}
  }
  function abrirCadastroLoja(){
    document.getElementById('ml-id').value=''; document.getElementById('ml-nome').value=''; document.getElementById('ml-codigo').value=''; document.getElementById('ml-ativa').value='true'; document.getElementById('ml-title').textContent='Cadastrar loja'; openModal('modal-loja-cadastro');
  }
  function editarLoja(json){const l=JSON.parse(json);document.getElementById('ml-id').value=l.id;document.getElementById('ml-nome').value=l.nome||'';document.getElementById('ml-codigo').value=l.codigo||'';document.getElementById('ml-ativa').value=String(l.ativa!==false);document.getElementById('ml-title').textContent='Editar loja';openModal('modal-loja-cadastro');}
  async function salvarLoja(){
    const nome=document.getElementById('ml-nome').value.trim(), codigo=document.getElementById('ml-codigo').value.trim().toUpperCase(); if(!nome){showToast('Informe o nome da loja','error');return;}
    const atualId=document.getElementById('ml-id').value, id=atualId||global.DTLoja.slug(codigo||nome);
    try{await raw().collection('lojas').doc(id).set({nome,codigo,ativa:document.getElementById('ml-ativa').value==='true',atualizada_em:new Date().toISOString(),...(atualId?{}:{criada_em:new Date().toISOString()})},{merge:true});closeModal('modal-loja-cadastro');showToast('Loja salva com sucesso','success');renderGestaoLojas();}
    catch(e){showToast('Erro ao salvar loja: '+e.message,'error');}
  }
  function usarLoja(id){if(id===global.getDTLojaAtiva())return;global.setDTLojaAtiva(id);location.reload();}

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
          }catch(_){ }
        }
      }
      if(progresso) progresso(nome,total);
    }
    if(ops) await _commitMigracaoControlado(batch, ops);
    return total;
  }
  const COLECOES_LEGADAS=['dt_inventarios','dt_contagens','dt_vazios','dt_recontagens','dt_divergencias','dt_coletores','dt_locais','dt_locais_chunks','dt_locais_meta','dt_produtos','dt_auditorias','dt_auditoria_imports','dt_auditoria_meta','dt_operadores','dt_analistas','dt_logs_analista','dt_logs_coletor','dt_ranking_operadores'];

  async function sincronizarDadosLegadosAutomaticamente(){
    if(global.__dtMigracaoLegadaPromise) return global.__dtMigracaoLegadaPromise;

    global.__dtMigracaoLegadaPromise=(async function(){
      const lojaId=global.getDTLojaAtiva();
      const acesso=global.DT_USUARIO_ACESSO_ATUAL||{};
      let usuario=null;
      try { usuario=global.firebase && global.firebase.auth ? global.firebase.auth().currentUser : null; } catch (_) {}
      if(!usuario || !lojaId || (acesso.perfil!=='administrador' && acesso.admin_mestre!==true && acesso.administrador_mestre!==true)) {
        return {executado:false,total:0};
      }

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
        },{merge:true}).catch(function(){});
        throw error;
      }
    })();

    try { return await global.__dtMigracaoLegadaPromise; }
    finally { global.__dtMigracaoLegadaPromise=null; }
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

  Object.assign(global,{renderGestaoLojas,abrirCadastroLoja,editarLoja,salvarLoja,usarLoja,migrarDadosLegadosParaLojaAtual,sincronizarDadosLegadosAutomaticamente});
})(window);