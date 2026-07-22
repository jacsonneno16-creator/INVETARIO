// Compatibilidade e implementações essenciais das páginas administrativas.
(function(){
  'use strict';
  const db=()=>window.FS_AN || (window.getDTFirestore && getDTFirestore());
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  window.renderRastreabilidade = window.renderRastreabilidade || async function(){
    const page=document.getElementById('page-rastreabilidade'); if(!page)return;
    const target=page.querySelector('#rast-resultados, #rast-tbody, tbody');
    if(!target)return;
    try{
      const snap=await db().collection((window.DT_FCOL||{}).contagens||'dt_contagens').orderBy('criado_em','desc').limit(100).get().catch(()=>db().collection('dt_contagens').limit(100).get());
      const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
      target.innerHTML=rows.map(x=>`<tr><td>${esc(x.endereco||'—')}</td><td>${esc(x.produto||x.gtin||x.dun||'—')}</td><td>${esc(x.operador||x.operador_nome||'—')}</td><td>${esc(x.quantidade??'—')}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;padding:24px">Nenhuma movimentação encontrada</td></tr>';
    }catch(e){ console.error('[Rastreabilidade]',e); target.innerHTML='<tr><td colspan="4">Erro ao carregar: '+esc(e.message)+'</td></tr>'; }
  };
  // Evita ReferenceError em botões de módulos ainda não implementados; exibe uma mensagem útil.
  const optional=['ieAbrirImportBase','ieExportarBluesoft','ieExportarProdutos','ieSetTab','oplSetTab','opAbrirModalCriar','opFecharModal','opFecharModalCriar','opGerarSenha','opSalvarEdicao','opSelecionarTipo','opSetModoLojasCriar','opSetModoLojasEditar','toggleOpSenha','toggleOpeditSenha'];
  optional.forEach(n=>{ if(typeof window[n]!=='function') window[n]=function(){ console.warn('[Módulo opcional]',n); window.showToast?.('Função em revisão: '+n,'w'); }; });
})();
