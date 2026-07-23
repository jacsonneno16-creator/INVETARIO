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

  async function _copiarColecaoLegada(nome, lojaId, progresso){
    const origem=await raw().collection(nome).get();
    if(origem.empty) return 0;
    let total=0, batch=raw().batch(), ops=0;
    for(const d of origem.docs){
      batch.set(raw().collection('lojas').doc(lojaId).collection(nome).doc(d.id), d.data(), {merge:true}); total++; ops++;
      if(ops>=400){await batch.commit();batch=raw().batch();ops=0;}
      if(['dt_inventarios','dt_auditorias'].includes(nome)){
        for(const sub of ['base_chunks','enderecos']){
          try{
            const ss=await d.ref.collection(sub).get();
            for(const sd of ss.docs){
              batch.set(raw().collection('lojas').doc(lojaId).collection(nome).doc(d.id).collection(sub).doc(sd.id),sd.data(),{merge:true});ops++;
              if(ops>=400){await batch.commit();batch=raw().batch();ops=0;}
            }
          }catch(_){ }
        }
      }
      if(progresso) progresso(nome,total);
    }
    if(ops) await batch.commit();
    return total;
  }
  async function migrarDadosLegadosParaLojaAtual(){
    const lojaId=global.getDTLojaAtiva(); if(!lojaId){showToast('Selecione uma loja','error');return;}
    const colecoes=['dt_inventarios','dt_contagens','dt_vazios','dt_recontagens','dt_divergencias','dt_coletores','dt_locais','dt_locais_chunks','dt_locais_meta','dt_produtos','dt_auditorias','dt_auditoria_imports','dt_operadores','dt_logs_analista'];
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

  Object.assign(global,{renderGestaoLojas,abrirCadastroLoja,editarLoja,salvarLoja,usarLoja,migrarDadosLegadosParaLojaAtual});
})(window);