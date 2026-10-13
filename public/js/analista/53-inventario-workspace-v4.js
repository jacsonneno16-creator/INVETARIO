(function(global){
'use strict';
const PAGE_GROUP={
  acompanhamento:'resumo', contagens:'contagens', pendencias:'contagens',
  'rel-divergencias':'relatorios', produtividade:'relatorios',
  'capas-duplicadas':'relatorios'
};
function st(){return global.AnalistaStore?.getState?.()||{};}
function invId(){return st().ui?.acompanhamentoInventarioId||'';}
function setFiltro(page){
  const v=invId(); if(!v)return;
  ['cont-finv','pend-sel-inv','div-sel-inv'].forEach(x=>{const el=document.getElementById(x);if(el){el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));}});
  if(page==='rastreabilidade'){
    const inv=(st().inventarios||[]).find(i=>String(i.id)===String(v));
    setTimeout(()=>{
      const sel=document.getElementById('aud-finv'); if(!sel)return;
      const candidatos=[v,inv?.nome,inv?.codigo].filter(Boolean).map(String);
      const alvo=[...sel.options].find(o=>candidatos.includes(String(o.value)) || candidatos.includes(String(o.textContent).trim()));
      if(alvo){sel.value=alvo.value;global.renderRastreabilidade?.();}
    },0);
  }
}
function ir(page){
  global.goPage?.(page,document.getElementById('nav-'+page)||null);
  setTimeout(()=>{setFiltro(page);instalar();},0);
}
// Ação "📊 Acompanhar" da lista de Inventários (30-render-inventarios-
// acompanhamento.js): seleciona o inventário clicado e abre direto no
// Resumo, sem criar tela nova — mesma navegação que os botões do workspace
// já usam.
function acompanharInventarioV4(id){
  if(!id)return;
  global.AnalistaState?.set?.('ui.acompanhamentoInventarioId', String(id), {source:'ui-acompanhar-lista'});
  ir('acompanhamento');
}
function bar(page){
  const group=PAGE_GROUP[page]||'resumo';
  const primary=`<div class="dt-inv-workspace-primary">
    <button type="button" data-dt-inv-page="acompanhamento" class="${group==='resumo'?'on':''}">Resumo</button>
    <button type="button" data-dt-inv-page="contagens" class="${group==='contagens'?'on':''}">Contagens</button>
    <button type="button" data-dt-inv-page="rel-divergencias" class="${group==='relatorios'?'on':''}">Relatórios</button>
  </div>`;
  let secondary='';
  if(group==='contagens') secondary=`<div class="dt-inv-workspace-secondary"><button data-dt-inv-page="contagens" class="${page==='contagens'?'on':''}">Recebidas</button><button data-dt-inv-page="pendencias" class="${page==='pendencias'?'on':''}">Pendências</button></div>`;
  if(group==='relatorios') secondary=`<div class="dt-inv-workspace-secondary"><button data-dt-inv-page="rel-divergencias" class="${page==='rel-divergencias'?'on':''}">Conflitos</button><button data-dt-inv-page="produtividade" class="${page==='produtividade'?'on':''}">Produtividade</button><button data-dt-inv-page="capas-duplicadas" class="${page==='capas-duplicadas'?'on':''}">Capas duplicadas</button></div>`;
  return `<div class="dt-inv-workspace" data-page="${page}">${primary}${secondary}</div>`;
}
function instalar(){
  ['recontagens','rastreabilidade'].forEach(page=>document.querySelector('#page-'+page+' > .dt-inv-workspace')?.remove());
  Object.keys(PAGE_GROUP).forEach(page=>{
    const host=document.getElementById('page-'+page);if(!host)return;
    let nav=host.querySelector(':scope > .dt-inv-workspace');
    if(nav)nav.remove();
    host.insertAdjacentHTML('afterbegin',bar(page));
  });
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-dt-inv-page]');if(b){e.preventDefault();ir(b.dataset.dtInvPage);return;}
});
function css(){if(document.getElementById('dt-inv-workspace-css'))return;const s=document.createElement('style');s.id='dt-inv-workspace-css';s.textContent=`
.dt-inv-workspace{margin:0 0 14px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.dt-inv-workspace-primary,.dt-inv-workspace-secondary{display:flex;gap:8px;flex-wrap:wrap}.dt-inv-workspace-secondary{margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
.dt-inv-workspace button{border:0;border-radius:9px;padding:8px 12px;background:transparent;color:var(--muted);font:inherit;font-weight:700;cursor:pointer}.dt-inv-workspace button:hover{background:var(--surface-2);color:var(--text)}.dt-inv-workspace button.on{background:var(--accent);color:#fff}
`;document.head.appendChild(s);}

function instalarFluxoNovoInventario(){
  if(global.__DT_INV_V4_FLUXO_INSTALADO)return; global.__DT_INV_V4_FLUXO_INSTALADO=true;
  const tipos=()=>global.DTV275;
  const produtos=()=>global.DTInventarioProdutoFiltro;
  const oldOpen=global.abrirNovoInventario;
  if(typeof oldOpen==='function') global.abrirNovoInventario=function(){
    global.__DT_TIPOS_PRODUTO_SELECIONADOS=[];
    produtos()?.reset?.(); tipos()?.ensureTypeBox?.();
    const r=oldOpen.apply(this,arguments); atualizarEtapasNovoInventario(); return r;
  };
  const oldEnable=global.habilitarBtnCriar;
  if(typeof oldEnable==='function') global.habilitarBtnCriar=function(){
    const r=oldEnable.apply(this,arguments); const btn=document.getElementById('btn-criar-inv');
    if(btn && produtos()?.validarCriacao && !produtos().validarCriacao()) btn.disabled=true;
    return r;
  };
  let lastCtx=global.AnalistaStore?.getState?.()?.ui?.inventarioImportCtx||null;
  global.AnalistaStore?.subscribe?.((next)=>{
    const ctx=next?.ui?.inventarioImportCtx||null; if(ctx===lastCtx)return; lastCtx=ctx;
    if(ctx){ tipos()?.refreshTypes?.(); produtos()?.onBaseReady?.(); }
    else { global.__DT_TIPOS_PRODUTO_SELECIONADOS=[]; produtos()?.reset?.(); }
    atualizarEtapasNovoInventario();
  });
  tipos()?.ensureTypeBox?.(); produtos()?.ensureUI?.(); atualizarEtapasNovoInventario();
}
function atualizarEtapasNovoInventario(){
  const modal=document.getElementById('modal-inv'); if(!modal)return;
  let bar=document.getElementById('inv-fluxo-v4');
  if(!bar){ bar=document.createElement('div'); bar.id='inv-fluxo-v4'; bar.style='display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px';
    bar.innerHTML=['1 Origem','2 Escopo','3 Endereços','4 Confirmar'].map((x,i)=>`<span data-step="${i+1}" style="padding:6px 9px;border-radius:999px;border:1px solid var(--border);font-size:.72rem;font-weight:800">${x}</span>`).join('');
    const body=modal.querySelector('.modal-body')||modal.querySelector('.modal-content')||modal; body.insertBefore(bar,body.firstChild);
  }
  const ctx=global.AnalistaStore?.getState?.()?.ui?.inventarioImportCtx;
  const step=ctx?.base?.length ? (document.getElementById('inv-end-sel-wrap')?.style.display!=='none'?3:2) : 1;
  bar.querySelectorAll('[data-step]').forEach(el=>{const n=Number(el.dataset.step);el.style.background=n<=step?'rgba(232,117,26,.12)':'transparent';el.style.color=n<=step?'var(--orange)':'var(--muted)';});
}

document.addEventListener('DOMContentLoaded',()=>{css();instalar();;instalarFluxoNovoInventario();});
global.DTInventarioWorkspaceV4={instalar,ir,setFiltro,acompanharInventarioV4};
global.acompanharInventarioV4=acompanharInventarioV4;
})(window);
