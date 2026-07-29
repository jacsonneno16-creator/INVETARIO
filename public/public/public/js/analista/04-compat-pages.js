// Compatibilidade e implementações essenciais das páginas administrativas.
(function(){
  'use strict';
  const db=()=>window.FS_AN || (window.getDTFirestore && getDTFirestore());
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const val=id=>String(document.getElementById(id)?.value||'').trim();
  const dataMs=v=>{
    if(!v)return 0;
    if(typeof v.toMillis==='function')return v.toMillis();
    if(typeof v.toDate==='function')return v.toDate().getTime();
    if(v.seconds)return Number(v.seconds)*1000;
    const n=Date.parse(v); return Number.isFinite(n)?n:0;
  };
  const fmt=v=>{ const n=dataMs(v); return n?new Date(n).toLocaleString('pt-BR'):'—'; };
  window.abrirAjuda = window.abrirAjuda || function(){ window.open('ajuda.html','_blank','noopener'); };
  window.opVerificarMinhaConta = window.opVerificarMinhaConta || function(){};
  window.opCarregarOperadoresParaFiltro = window.opCarregarOperadoresParaFiltro || function(){};
  window.ieAbrirPagina = window.ieAbrirPagina || function(){
    const p=document.getElementById('page-importar-exportar'); if(!p)return;
    const first=p.querySelector('[data-ie-tab], .ie-tab, input[type=file], button'); if(first) first.focus?.();
  };
  window.listarOperadores = window.listarOperadores || async function(){
    const page=document.getElementById('page-operadores'); if(!page)return;
    const target=page.querySelector('#op-lista, #op-tbody, tbody');
    try{
      const snap=await db().collection((window.DT_FCOL||{}).operadores||'dt_operadores').limit(500).get();
      const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
      if(target){
        const html=rows.map(o=>`<tr><td>${esc(o.nome||o.name||'—')}</td><td>${esc(o.email||'—')}</td><td>${esc(o.perfil||o.tipo||'Operador')}</td><td>${o.ativo===false?'Bloqueado':'Ativo'}</td></tr>`).join('');
        target.innerHTML=html||'<tr><td colspan="4" style="text-align:center;padding:24px">Nenhum operador cadastrado</td></tr>';
      }
      const count=page.querySelector('[data-op-count]'); if(count)count.textContent=String(rows.length);
    }catch(e){ console.error('[Operadores]',e); if(target) target.innerHTML='<tr><td colspan="4">Erro ao carregar: '+esc(e.message)+'</td></tr>'; }
  };

  function storeState(){ try{return window.AnalistaStore?.getState?.()||{};}catch(_){return{};} }
  function montarRastreabilidade(){
    const st=storeState();
    const out=[];
    const add=(arr,tipo,mapper)=>{ (Array.isArray(arr)?arr:[]).forEach((x,i)=>out.push({id:x.id||`${tipo}-${i}`,...mapper(x),tipo})); };
    add(st.contagens,'CONTAGEM',x=>({data:x.criado_em||x.data_hora||x.timestamp||x.data,operador:x.operador_nome||x.operador||x.operadorNome,endereco:x.endereco,produto:x.produto_descricao||x.descricao_produto||x.produto||x.gtin||x.dun,acao:x._excluida||x.status==='ESTORNADA'?'Contagem estornada':'Contagem registrada',inventario:x.inventario_nome||x.inventario||x.inventario_id,status:x.status}));
    add(st.divergencias,'DIVERGENCIA',x=>({data:x.criado_em||x.atualizado_em||x.data,operador:x.operador_nome||x.operador,endereco:x.endereco,produto:x.produto_descricao||x.produto||x.gtin,acao:'Divergência '+String(x.status||'ABERTA').toLowerCase(),inventario:x.inventario_nome||x.inventario_id,status:x.status}));
    add(st.recontagens,'RECONTAGEM',x=>({data:x.concluido_em||x.criado_em||x.data,operador:x.operador_recontagem||x.operador_nome||x.operador,endereco:x.endereco,produto:x.produto_descricao||x.produto||x.gtin,acao:x.status==='CONCLUIDA'?'Recontagem concluída':'Recontagem criada',inventario:x.inventario_nome||x.inventario_id,status:x.status}));
    add(st.inventarios,'AUDITORIA',x=>({data:x.atualizado_em||x.criado_em||x.data,operador:x.criado_por_nome||x.criado_por,acao:'Inventário '+String(x.status||'criado').toLowerCase(),inventario:x.nome||x.id,status:x.status}));
    add(st.auditorias,'AUDITORIA',x=>({data:x.atualizado_em||x.criado_em||x.data,operador:x.criado_por_nome||x.criado_por,acao:'Auditoria '+String(x.status||'criada').toLowerCase(),inventario:x.nome||x.auditoria_nome||x.id,status:x.status}));
    return out.sort((a,b)=>dataMs(b.data)-dataMs(a.data));
  }
  function filtrarRastreabilidade(rows){
    const busca=val('aud-busca').toUpperCase(), tipo=val('aud-ftipo'), inv=val('aud-finv'), per=val('aud-fperiodo');
    const agora=Date.now(); let min=0;
    if(per==='hoje'){ const d=new Date(); d.setHours(0,0,0,0); min=d.getTime(); }
    if(per==='7d')min=agora-7*86400000;
    if(per==='30d')min=agora-30*86400000;
    return rows.filter(r=>{
      if(tipo && r.tipo!==tipo)return false;
      if(inv && String(r.inventario||'')!==inv)return false;
      if(min && dataMs(r.data)<min)return false;
      if(busca){ const blob=[r.tipo,r.acao,r.operador,r.endereco,r.produto,r.inventario,r.status].join(' ').toUpperCase(); if(!blob.includes(busca))return false; }
      return true;
    });
  }
  function atualizarFiltroInventarios(rows){
    const sel=document.getElementById('aud-finv'); if(!sel)return;
    const atual=sel.value;
    const itens=[...new Set(rows.map(r=>String(r.inventario||'').trim()).filter(Boolean))].sort();
    sel.innerHTML='<option value="">Todas as auditorias</option>'+itens.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if(itens.includes(atual))sel.value=atual;
  }
  function setText(id,v){ const e=document.getElementById(id); if(e)e.textContent=String(v); }
  window.renderRastreabilidade = async function(){
    const page=document.getElementById('page-rastreabilidade'); if(!page)return;
    const target=document.getElementById('aud-list-wrap'); if(!target)return;
    try{
      const todos=montarRastreabilidade(); atualizarFiltroInventarios(todos);
      const rows=filtrarRastreabilidade(todos);
      setText('logk-total',todos.length);
      setText('logk-inventarios',todos.filter(x=>x.tipo==='AUDITORIA').length);
      setText('logk-contagens',todos.filter(x=>x.tipo==='CONTAGEM').length);
      setText('logk-divs',todos.filter(x=>x.tipo==='DIVERGENCIA').length);
      setText('logk-exports',todos.filter(x=>x.tipo==='EXPORTACAO').length);
      window.__rastRowsFiltradas=rows;
      if(!rows.length){ target.innerHTML='<div class="empty"><div class="empty-icon">📜</div><div class="empty-title">Nenhum registro encontrado</div><div class="empty-sub">A rastreabilidade é montada com Inventários, Auditorias, Contagens, Divergências e Recontagens carregadas da loja atual.</div></div>'; return; }
      target.innerHTML=`<div style="overflow:auto"><table class="data-table"><thead><tr><th>Data/Hora</th><th>Tipo</th><th>Ação</th><th>Operador</th><th>Inventário/Auditoria</th><th>Endereço</th><th>Produto</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(fmt(r.data))}</td><td>${esc(r.tipo)}</td><td>${esc(r.acao||'—')}</td><td>${esc(r.operador||'—')}</td><td>${esc(r.inventario||'—')}</td><td>${esc(r.endereco||'—')}</td><td>${esc(r.produto||'—')}</td><td>${esc(r.status||'—')}</td></tr>`).join('')}</tbody></table></div>`;
    }catch(e){ console.error('[Rastreabilidade]',e); target.innerHTML='<div class="empty"><div class="empty-title">Erro ao carregar rastreabilidade</div><div class="empty-sub">'+esc(e.message)+'</div></div>'; }
  };
  window.limparFiltrosRastreabilidade=function(){ ['aud-busca','aud-ftipo','aud-finv','aud-fperiodo'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';}); window.renderRastreabilidade(); };
  window.exportarRastreabilidade=function(){
    const rows=window.__rastRowsFiltradas||[];
    if(!rows.length){ window.showToast?.('Nenhum registro para exportar.','w'); return; }
    if(!window.XLSX){ window.showToast?.('Biblioteca de Excel não carregada.','e'); return; }
    const dados=rows.map(r=>({'Data/Hora':fmt(r.data),'Tipo':r.tipo,'Ação':r.acao||'','Operador':r.operador||'','Inventário/Auditoria':r.inventario||'','Endereço':r.endereco||'','Produto':r.produto||'','Status':r.status||''}));
    const ws=XLSX.utils.json_to_sheet(dados), wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Rastreabilidade'); XLSX.writeFile(wb,'Rastreabilidade_DT_Inventario.xlsx');
  };

  const optional=['ieAbrirImportBase','ieExportarBluesoft','ieExportarProdutos','ieSetTab','oplSetTab','opAbrirModalCriar','opFecharModal','opFecharModalCriar','opGerarSenha','opSalvarEdicao','opSelecionarTipo','opSetModoLojasCriar','opSetModoLojasEditar','toggleOpSenha','toggleOpeditSenha'];
  optional.forEach(n=>{ if(typeof window[n]!=='function') window[n]=function(){ console.warn('[Módulo opcional]',n); window.showToast?.('Função em revisão: '+n,'w'); }; });
})();
