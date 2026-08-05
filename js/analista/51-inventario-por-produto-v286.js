(function(global){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>global.DTProdutos?.normalizarCodigo?.(v)||String(v??'').trim().replace(/\D/g,'');
let modo='GERAL';
let selecionados=[];
let busca='';

function idsProduto(p){
  return new Set([p?.produtoId,p?.id,p?.codigoInterno,p?.gtin,p?.dun].map(norm).filter(Boolean));
}
function idsLinha(r){
  return new Set([
    r?.produto_id,r?.codigo_produto,r?.produto_codigo,r?.codigoInterno,r?.codigo,
    r?.gtin,r?.dun,r?.gtin_produto,r?.codigo_barras
  ].map(norm).filter(Boolean));
}
function linhaCorresponde(r,p){
  const a=idsLinha(r),b=idsProduto(p);
  for(const id of a) if(b.has(id)) return true;
  return false;
}
function produtosBase(){
  return (global.DTProdutos?.cache?.lista||[]).filter(p=>p&&p.ativo!==false);
}
function aplicar(base){
  if(modo!=='PRODUTO'||!selecionados.length)return [...(base||[])];
  return (base||[]).filter(r=>selecionados.some(p=>linhaCorresponde(r,p)));
}
function resumo(base){
  const filtrada=aplicar(base||[]);
  const ends=new Set(filtrada.map(r=>r.endereco).filter(Boolean));
  return {registros:filtrada.length,enderecos:ends.size};
}
function atualizarResumo(){
  const ctx=global.AnalistaStore?.getState?.()?.ui?.inventarioImportCtx;
  const el=document.getElementById('inv-produto-resumo');
  if(!el)return;
  if(modo!=='PRODUTO'){
    el.innerHTML='O inventário será aberto com todos os produtos presentes na base importada.';
    return;
  }
  if(!selecionados.length){
    el.innerHTML='<span style="color:var(--danger);font-weight:700">Selecione pelo menos um produto.</span>';
    return;
  }
  const r=resumo(ctx?.base||[]);
  el.innerHTML=`<strong>${selecionados.length}</strong> produto(s) selecionado(s) · <strong>${r.registros}</strong> linha(s) encontradas na base · <strong>${r.enderecos}</strong> endereço(s)`;
}
function renderLista(){
  const list=document.getElementById('inv-produtos-lista');
  if(!list)return;
  const q=busca.toLowerCase();
  const arr=produtosBase().filter(p=>!q||String([p.codigoInterno,p.nomeProduto,p.gtin,p.dun].join(' ')).toLowerCase().includes(q)).slice(0,100);
  if(!arr.length){list.innerHTML='<div class="empty" style="padding:18px"><div class="empty-title">Nenhum produto encontrado</div></div>';return;}
  list.innerHTML=arr.map(p=>{
    const checked=selecionados.some(x=>String(x.produtoId||x.id)===String(p.produtoId||p.id));
    return `<label style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;background:${checked?'rgba(0,229,255,.06)':'transparent'}">
      <input type="checkbox" data-inv-prod-id="${esc(p.produtoId||p.id)}" ${checked?'checked':''} style="width:18px;height:18px;accent-color:var(--accent)">
      <span><strong>${esc(p.nomeProduto||'Produto')}</strong><small style="display:block;color:var(--muted);margin-top:2px">Código: ${esc(p.codigoInterno||'—')} · GTIN: ${esc(p.gtin||'—')} · DUN: ${esc(p.dun||'—')}</small></span>
      <span class="badge">${esc(p.tipoProduto||p.tipo_produto||p.categoriaFamilia||'PRODUTO')}</span>
    </label>`;
  }).join('');
}
function syncCheck(id,checked){
  const p=produtosBase().find(x=>String(x.produtoId||x.id)===String(id));
  if(!p)return;
  if(checked){if(!selecionados.some(x=>String(x.produtoId||x.id)===String(id)))selecionados.push(p);}
  else selecionados=selecionados.filter(x=>String(x.produtoId||x.id)!==String(id));
  renderSelecionados();renderLista();atualizarResumo();
  global.habilitarBtnCriar?.();
}
function renderSelecionados(){
  const el=document.getElementById('inv-produtos-selecionados');if(!el)return;
  el.innerHTML=selecionados.length?selecionados.map(p=>`<span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--accent);border-radius:999px;padding:6px 9px;background:rgba(0,229,255,.06);font-size:.76rem"><strong>${esc(p.nomeProduto)}</strong><button type="button" data-remove-inv-prod="${esc(p.produtoId||p.id)}" style="border:0;background:none;color:var(--danger);cursor:pointer;font-weight:900">×</button></span>`).join(''):'<span style="color:var(--muted);font-size:.78rem">Nenhum produto selecionado.</span>';
}
function setModo(novo){
  modo=novo==='PRODUTO'?'PRODUTO':'GERAL';
  const box=document.getElementById('inv-produto-escolha');if(box)box.style.display=modo==='PRODUTO'?'block':'none';
  document.querySelectorAll('[name="inv-modo-abertura"]').forEach(r=>r.checked=r.value===modo);
  atualizarResumo();global.habilitarBtnCriar?.();
}
function ensureUI(){
  if(document.getElementById('inv-modo-produto-wrap'))return;
  const endWrap=document.getElementById('inv-end-sel-wrap');
  if(!endWrap)return;
  const box=document.createElement('div');box.id='inv-modo-produto-wrap';box.style='display:none;border-top:1px solid var(--border);padding-top:16px;margin-top:14px';
  box.innerHTML=`
    <div style="font-weight:800;font-size:.9rem;margin-bottom:10px">🎯 Escopo do inventário</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px">
      <label style="border:2px solid var(--border);border-radius:10px;padding:12px;cursor:pointer"><input type="radio" name="inv-modo-abertura" value="GERAL" checked style="accent-color:var(--accent)"> <strong>Inventário geral</strong><small style="display:block;color:var(--muted);margin:4px 0 0 22px">Todos os produtos da base importada</small></label>
      <label style="border:2px solid var(--border);border-radius:10px;padding:12px;cursor:pointer"><input type="radio" name="inv-modo-abertura" value="PRODUTO" style="accent-color:var(--accent)"> <strong>Por produto</strong><small style="display:block;color:var(--muted);margin:4px 0 0 22px">Somente os itens escolhidos na base geral de produtos</small></label>
    </div>
    <div id="inv-produto-escolha" style="display:none;border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="padding:12px;background:var(--surface-2)"><input id="inv-produto-busca" class="search" placeholder="Buscar por nome, código, GTIN ou DUN" style="width:100%;max-width:none"></div>
      <div id="inv-produtos-lista" style="max-height:280px;overflow:auto"></div>
      <div style="padding:10px 12px;border-top:1px solid var(--border)"><div id="inv-produtos-selecionados" style="display:flex;gap:7px;flex-wrap:wrap"></div></div>
    </div>
    <div id="inv-produto-resumo" class="alert info" style="margin-top:10px">O inventário será aberto com todos os produtos presentes na base importada.</div>`;
  endWrap.parentNode.insertBefore(box,endWrap);
  box.addEventListener('change',e=>{if(e.target.name==='inv-modo-abertura')setModo(e.target.value);const id=e.target.dataset.invProdId;if(id)syncCheck(id,e.target.checked);});
  box.addEventListener('click',e=>{const b=e.target.closest('[data-remove-inv-prod]');if(b)syncCheck(b.dataset.removeInvProd,false);});
  box.querySelector('#inv-produto-busca').addEventListener('input',e=>{busca=e.target.value;renderLista();});
}
function onBaseReady(){
  ensureUI();
  const wrap=document.getElementById('inv-modo-produto-wrap');if(wrap)wrap.style.display='block';
  global.DTProdutos?.carregar?.().then(()=>{renderLista();renderSelecionados();atualizarResumo();}).catch(()=>{renderLista();});
}
function reset(){modo='GERAL';selecionados=[];busca='';ensureUI();const wrap=document.getElementById('inv-modo-produto-wrap');if(wrap)wrap.style.display='none';setModo('GERAL');renderSelecionados();}
const oldOpen=global.abrirNovoInventario;if(oldOpen)global.abrirNovoInventario=function(){reset();return oldOpen.apply(this,arguments);};
const oldMap=global.confirmarMapeamentoInv;if(oldMap)global.confirmarMapeamentoInv=function(){const r=oldMap.apply(this,arguments);setTimeout(onBaseReady,0);return r;};
const oldEnable=global.habilitarBtnCriar;if(oldEnable)global.habilitarBtnCriar=function(){oldEnable.apply(this,arguments);const btn=document.getElementById('btn-criar-inv');if(btn&&modo==='PRODUTO'&&!selecionados.length)btn.disabled=true;};
let last=null;setInterval(()=>{const ctx=global.AnalistaStore?.getState?.()?.ui?.inventarioImportCtx;if(ctx&&ctx!==last){last=ctx;onBaseReady();}if(!ctx)last=null;},500);
document.addEventListener('DOMContentLoaded',ensureUI);
global.DTInventarioProdutoFiltro={aplicar,modo:()=>modo,selecionados:()=>selecionados.map(p=>({produto_id:p.produtoId||p.id,codigo_interno:p.codigoInterno||'',nome:p.nomeProduto||'',gtin:p.gtin||'',dun:p.dun||''})),resumo};
})(window);
