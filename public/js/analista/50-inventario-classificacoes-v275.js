(function(){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Math.max(0,Number(String(v??0).replace(',','.'))||0);
function st(){return window.AnalistaStore?.getState?.()||{};}
function selectedInv(){const s=st();const id=s.ui?.acompanhamentoInventarioId;return (s.inventarios||[]).find(x=>x.id===id)||(s.inventarios||[]).find(x=>x.status==='ATIVO')||null;}
function ensureTypeBox(){
 const modal=document.querySelector('#modal-inv .modal-footer'); if(!modal||document.getElementById('inv-tipos-produto-wrap'))return;
 const box=document.createElement('div');box.id='inv-tipos-produto-wrap';box.style='display:none;border-top:1px solid var(--border);padding-top:16px;margin-top:12px';
 box.innerHTML='<div style="font-weight:700;font-size:.88rem;margin-bottom:8px">🏷️ Tipos de produto deste inventário</div><div class="alert info" style="margin-bottom:8px">Selecione um ou mais tipos. Sem seleção, todos os tipos serão incluídos.</div><div id="inv-tipos-produto-list" style="display:flex;gap:8px;flex-wrap:wrap"></div>';
 modal.parentNode.insertBefore(box,modal);
}
function refreshTypes(){
 ensureTypeBox(); const ctx=st().ui?.inventarioImportCtx; const wrap=document.getElementById('inv-tipos-produto-wrap'); const list=document.getElementById('inv-tipos-produto-list'); if(!wrap||!list)return;
 const tipos=[...new Set((ctx?.base||[]).map(r=>String(r.tipo_produto||'NAO CLASSIFICADO').trim().toUpperCase()).filter(Boolean))].sort();
 wrap.style.display=tipos.length?'block':'none';
 list.innerHTML=tipos.map(t=>`<label style="display:flex;gap:6px;align-items:center;border:1px solid var(--border);border-radius:999px;padding:7px 10px;background:var(--surface)"><input type="checkbox" class="inv-tipo-produto" value="${esc(t)}" checked> ${esc(t)}</label>`).join('');
 window.__DT_TIPOS_PRODUTO_SELECIONADOS=[...tipos];
 list.onchange=()=>{window.__DT_TIPOS_PRODUTO_SELECIONADOS=[...list.querySelectorAll('.inv-tipo-produto:checked')].map(x=>x.value);};
 const fis=[...new Set((ctx?.base||[]).filter(r=>r.contabiliza_inventario!==false).map(r=>r.endereco).filter(Boolean))].length;
 const vir=[...new Set((ctx?.base||[]).filter(r=>r.contabiliza_inventario===false).map(r=>r.endereco).filter(Boolean))].length;
 const fb=document.getElementById('inv-import-fb'); if(fb&&ctx?.base?.length){fb.insertAdjacentHTML('beforeend',`<div class="alert info" style="margin-top:8px">📍 ${fis.toLocaleString('pt-BR')} endereço(s) contabilizável(is) · ${vir.toLocaleString('pt-BR')} virtual(is) fora do progresso.</div>`);}
}
const oldOpen=window.abrirNovoInventario; if(oldOpen)window.abrirNovoInventario=function(){window.__DT_TIPOS_PRODUTO_SELECIONADOS=[];oldOpen.apply(this,arguments);setTimeout(ensureTypeBox,0)};
const oldMapper=window.confirmarMapeamentoInv; if(oldMapper)window.confirmarMapeamentoInv=function(){const r=oldMapper.apply(this,arguments);setTimeout(refreshTypes,0);return r;};

function productRows(inv){
 const base=inv?.base||[]; const conts=(st().contagens||[]).filter(c=>c.inventario_id===inv.id&&c.status!=='ESTORNADA'); const map=new Map();
 const keyOf=x=>String(x.codigo_produto||x.produto_codigo||x.gtin||x.gtinLido||x.codigoLido||'SEM-CODIGO').trim();
 for(const r of base){
   const k=keyOf(r);
   const factorImported=n(r.fator_caixa||r.fatorCaixa);
   const productMaster=window.DTProdutos?.buscarSync?.(k);
   const factorMaster=productMaster?.encontrado ? n(productMaster.fator_caixa||productMaster.fatorCaixa) : 0;
   const fator=factorImported||factorMaster||1;
   if(!map.has(k)) map.set(k,{codigo:k,descricao:r.descricao_produto||r.descricao||'Produto',fator:fator,sistema:0,contado:0,enderecos:new Set(),tipo:r.tipo_produto||'NAO CLASSIFICADO'});
   const o=map.get(k);
   o.sistema += n(r.total_unidades_sistema) || (n(r.quantidade_esperada) * fator);
 }
 for(const c of conts){
   if(c.tipo_contagem==='VAZIO'||c.tipo==='VAZIO_CONFIRMADO') continue;
   const k=keyOf(c);
   const factorImported=n(c.fator_caixa||c.fatorCaixa);
   const productMaster=window.DTProdutos?.buscarSync?.(k);
   const factorMaster=productMaster?.encontrado ? n(productMaster.fator_caixa||productMaster.fatorCaixa) : 0;
   const fator=factorImported||factorMaster||1;
   if(!map.has(k)) map.set(k,{codigo:k,descricao:c.descricao_produto||c.produtoLidoNome||c.descricao||'Produto não previsto',fator:fator,sistema:0,contado:0,enderecos:new Set(),tipo:'EXTRA'});
   const o=map.get(k);
   const un = n(c.quantidade_unidades) || (n(c.quantidade) * (String(c.tipo_bipagem||'').toUpperCase()==='DUN' ? fator : 1));
   o.contado += un;
   if(c.endereco) o.enderecos.add(c.endereco);
 }
 return [...map.values()].map(o=>({...o,diferenca:o.contado-o.sistema})).sort((a,b)=>Math.abs(b.diferenca)-Math.abs(a.diferenca));
}
function renderProductView(){
 const host=document.getElementById('acomp-produtos-v275');if(!host)return;const inv=selectedInv();if(!inv){host.innerHTML='<div class="empty"><div class="empty-title">Selecione um inventário</div></div>';return;}
 const rows=productRows(inv);const sys=rows.reduce((a,x)=>a+x.sistema,0),cnt=rows.reduce((a,x)=>a+x.contado,0),gain=rows.reduce((a,x)=>a+Math.max(0,x.diferenca),0),loss=rows.reduce((a,x)=>a+Math.max(0,-x.diferenca),0);
 host.innerHTML=`<div class="kpi-grid" style="margin-bottom:12px"><div class="kpi-card"><div class="kpi-label">Produtos</div><div class="kpi-value">${rows.length.toLocaleString('pt-BR')}</div></div><div class="kpi-card"><div class="kpi-label">Sistema (un.)</div><div class="kpi-value">${sys.toLocaleString('pt-BR')}</div></div><div class="kpi-card"><div class="kpi-label">Contado (un.)</div><div class="kpi-value">${cnt.toLocaleString('pt-BR')}</div></div><div class="kpi-card"><div class="kpi-label">Ganho / Perda</div><div class="kpi-value">+${gain.toLocaleString('pt-BR')} / -${loss.toLocaleString('pt-BR')}</div></div></div><div class="tc"><div class="tc-header"><div><div class="tc-title">📦 Acompanhamento por Produto</div><div class="sec-sub">Sistema, contado e diferença consolidados em unidades</div></div><input id="acomp-prod-busca-v275" class="search" placeholder="Buscar produto ou código" style="max-width:260px"></div><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Código</th><th>Tipo</th><th>Fator</th><th>Sistema (un.)</th><th>Contado (un.)</th><th>Diferença</th><th>Situação</th><th>Endereços</th></tr></thead><tbody id="acomp-prod-tbody-v275">${rows.map(r=>`<tr data-q="${esc((r.descricao+' '+r.codigo).toLowerCase())}"><td><b>${esc(r.descricao)}</b></td><td>${esc(r.codigo)}</td><td>${esc(r.tipo)}</td><td>${r.fator}</td><td>${r.sistema.toLocaleString('pt-BR')}</td><td>${r.contado.toLocaleString('pt-BR')}</td><td style="font-weight:800;color:${r.diferenca<0?'var(--danger)':r.diferenca>0?'var(--success)':'var(--muted)'}">${r.diferenca>0?'+':''}${r.diferenca.toLocaleString('pt-BR')}</td><td>${r.diferenca>0?'GANHO':r.diferenca<0?'PERDA':'IGUAL'}</td><td>${r.enderecos.size}</td></tr>`).join('')}</tbody></table></div></div>`;
 const q=document.getElementById('acomp-prod-busca-v275');if(q)q.oninput=()=>document.querySelectorAll('#acomp-prod-tbody-v275 tr').forEach(tr=>tr.style.display=tr.dataset.q.includes(q.value.toLowerCase())?'':'none');
}
function ensureAcompTabs(){
 const page=document.getElementById('page-acompanhamento');if(!page||document.getElementById('acomp-tabs-v275'))return;
 const target=page.querySelector('.sec-header')||page.firstElementChild;const tabs=document.createElement('div');tabs.id='acomp-tabs-v275';tabs.style='display:flex;gap:8px;margin:10px 0 14px';tabs.innerHTML='<button class="btn btn-primary btn-sm" data-v="end">📍 Por Endereço</button><button class="btn btn-ghost btn-sm" data-v="prod">📦 Por Produto</button>';
 target.insertAdjacentElement('afterend',tabs);const prod=document.createElement('div');prod.id='acomp-produtos-v275';prod.style.display='none';page.appendChild(prod);
 tabs.onclick=e=>{const b=e.target.closest('button');if(!b)return;const prodMode=b.dataset.v==='prod';[...tabs.children].forEach(x=>x.className='btn btn-ghost btn-sm');b.className='btn btn-primary btn-sm';[...page.children].forEach(x=>{if(x.id==='acomp-produtos-v275'||x.id==='acomp-tabs-v275'||x===target)return;x.dataset.v275Old=x.style.display;x.style.display=prodMode?'none':(x.dataset.v275Old||'');});prod.style.display=prodMode?'block':'none';if(prodMode)renderProductView();};
}
const oldRender=window.renderAcompanhamento;if(oldRender)window.renderAcompanhamento=function(){const r=oldRender.apply(this,arguments);setTimeout(()=>{ensureAcompTabs();if(document.getElementById('acomp-produtos-v275')?.style.display!=='none')renderProductView();},0);return r;};
let __ctxRef=null; setInterval(()=>{const c=st().ui?.inventarioImportCtx;if(c&&c!==__ctxRef){__ctxRef=c;refreshTypes();}else if(!c){__ctxRef=null;}},500);
document.addEventListener('DOMContentLoaded',()=>{ensureTypeBox();ensureAcompTabs();});
window.DTV275={refreshTypes,renderProductView};
})();
