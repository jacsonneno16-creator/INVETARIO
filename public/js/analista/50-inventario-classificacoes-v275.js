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

function productRows(inv){
 const base=inv?.base||[]; const conts=(st().contagens||[]).filter(c=>c.inventario_id===inv.id&&c.status!=='ESTORNADA'); const map=new Map();
 const keyOf=x=>String(x.codigo_produto||x.produto_codigo||x.gtin||x.gtinLido||x.codigoLido||'SEM-CODIGO').trim();
 for(const r of base){
   const k=keyOf(r);
   const factorImported=n(r.fator_caixa||r.fatorCaixa);
   const productMaster=window.DTProdutos?.buscarSync?.(k);
   const factorMaster=productMaster?.encontrado ? n(productMaster.fator_caixa||productMaster.fatorCaixa) : 0;
   const fator=factorImported||factorMaster||1;
   if(!map.has(k)) map.set(k,{codigo:k,descricao:r.descricao_produto||r.descricao||'Produto',fator:fator,sistema:0,contado:0,enderecos:new Set(),tipo:r.tipo_produto||'NAO CLASSIFICADO',motivo:r.tipo_produto_motivo||''});
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
   if(!map.has(k)) map.set(k,{codigo:k,descricao:c.descricao_produto||c.produtoLidoNome||c.descricao||'Produto não previsto',fator:fator,sistema:0,contado:0,enderecos:new Set(),tipo:'EXTRA',motivo:'Contado no inventário mas não estava na base importada'});
   const o=map.get(k);
   const un = n(c.quantidade_unidades) || (n(c.quantidade) * (String(c.tipo_bipagem||'').toUpperCase()==='DUN' ? fator : 1));
   o.contado += un;
   if(c.endereco) o.enderecos.add(c.endereco);
 }
 return [...map.values()].map(o=>({...o,diferenca:o.contado-o.sistema})).sort((a,b)=>Math.abs(b.diferenca)-Math.abs(a.diferenca));
}

const checkpointSelecionados=new Set();
function _produtoKey(x){return String(x?.codigo_produto||x?.produto_codigo||x?.gtin||x?.gtinLido||x?.codigoLido||'SEM-CODIGO').trim();}
function _palete(x){return String(x?.capa??x?.palete??x?.pallet??x?.numero_palete??x?.numeroPalete??x?.pallete_ou_capa??x?.capa_palete??'').trim();}
function _lote(x){return String(x?.lote_produto??x?.lote??'').trim();}
function _ordEndereco(a,b){return String(a||'').localeCompare(String(b||''),'pt-BR',{numeric:true,sensitivity:'base'});}
function _qtdUn(c,fator){const direto=n(c?.quantidade_unidades);if(direto)return direto;const qtd=n(c?.quantidade);return String(c?.tipo_bipagem||'').toUpperCase()==='DUN'?qtd*Math.max(1,fator||1):qtd;}
function _qtdCx(c,fator,un){const q=n(c?.qtd_caixas);if(q)return q;const f=Math.max(1,fator||1);return f>1?un/f:un;}
function checkpointRows(inv,codigo){
  if(!inv)return[];
  const k=String(codigo||'').trim();
  const base=(inv.base||[]).filter(r=>_produtoKey(r)===k);
  const fisicas=(window.DTContagemFisicaAtual?.linhas?.(inv.id)||(st().contagens||[]).filter(c=>c.inventario_id===inv.id&&!c?._excluida&&!['ESTORNADA','EXCLUIDA','CANCELADA'].includes(String(c?.status||'').toUpperCase())))
    .filter(c=>c.tipo_contagem!=='VAZIO'&&c.tipo!=='VAZIO_CONFIRMADO'&&_produtoKey(c)===k);
  const productMaster=window.DTProdutos?.buscarSync?.(k);
  const fatorPadrao=Math.max(1,n(base.find(r=>n(r.fator_caixa||r.fatorCaixa))?.fator_caixa||base.find(r=>n(r.fatorCaixa))?.fatorCaixa||productMaster?.fator_caixa||productMaster?.fatorCaixa)||1);
  const contPorEnd=new Map();
  fisicas.forEach(c=>{const e=String(c.endereco||'').trim();if(!contPorEnd.has(e))contPorEnd.set(e,[]);contPorEnd.get(e).push(c);});
  const out=[];const vistosBase=new Set();
  base.forEach(r=>{
    const endereco=String(r.endereco||'').trim();if(!endereco)return;
    const palete=String(r.pallete_ou_capa||r.palete||'').trim();const lote=_lote(r);const sig=[endereco,palete,lote].join('|');if(vistosBase.has(sig))return;vistosBase.add(sig);
    out.push({tipo:'BASE',codigo:k,descricao:r.descricao_produto||r.descricao||productMaster?.nomeProduto||'Produto',palete,lote,endereco,qtdUn:0,qtdCx:0,situacao:(contPorEnd.get(endereco)||[]).length?'Constava no sistema':'Não contado'});
  });
  fisicas.forEach(c=>{
    const endereco=String(c.endereco||'').trim();if(!endereco)return;
    const isDun=String(c.tipo_bipagem||'').toUpperCase()==='DUN';const fator=Math.max(1,(isDun?n(c.fator_caixa||c.fatorCaixa):0)||fatorPadrao);const un=_qtdUn(c,fator),cx=_qtdCx(c,fator,un);
    const existeBase=base.some(r=>String(r.endereco||'').trim()===endereco);
    out.push({tipo:'CONTADO',codigo:k,descricao:c.descricao_produto||c.produtoLidoNome||c.descricao||productMaster?.nomeProduto||'Produto',palete:_palete(c),lote:_lote(c),endereco,qtdUn:un,qtdCx:cx,situacao:existeBase?'Contado':'Fora da base'});
  });
  return out.sort((a,b)=>{const e=_ordEndereco(a.endereco,b.endereco);if(e)return e;if(a.tipo!==b.tipo)return a.tipo==='BASE'?-1:1;const pa=String(a.palete||a.lote||''),pb=String(b.palete||b.lote||'');return pa.localeCompare(pb,'pt-BR',{numeric:true,sensitivity:'base'});});
}
function _fmt(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function _checkpointAtualizarAcoes(){
 const box=document.getElementById('acomp-prod-checkpoint-actions-v275'),btn=document.getElementById('acomp-prod-checkpoint-pdf-v275'),txt=document.getElementById('acomp-prod-checkpoint-count-v275');const qtd=checkpointSelecionados.size;
 if(box)box.style.display=qtd?'flex':'none';if(btn)btn.disabled=!qtd;if(txt)txt.textContent=qtd+' produto'+(qtd===1?'':'s')+' selecionado'+(qtd===1?'':'s');
 document.querySelectorAll('[data-checkpoint-prod]').forEach(el=>{el.checked=checkpointSelecionados.has(el.getAttribute('data-checkpoint-prod'));});
 const all=document.getElementById('acomp-prod-checkpoint-all-v275');if(all){const vis=[...document.querySelectorAll('#acomp-prod-tbody-v275 tr')].filter(tr=>tr.style.display!=='none').map(tr=>tr.querySelector('[data-checkpoint-prod]')).filter(Boolean);all.checked=Boolean(vis.length)&&vis.every(x=>x.checked);all.indeterminate=vis.some(x=>x.checked)&&!all.checked;}
}
function baixarCheckpointPdf(){
 const inv=selectedInv();if(!inv){window.showToast?.('Selecione um inventário.','warning');return;}
 const codigos=[...checkpointSelecionados];if(!codigos.length){window.showToast?.('Selecione ao menos um produto.','warning');return;}
 const JsPDF=window.jspdf?.jsPDF;if(!JsPDF){window.showToast?.('Geração de PDF indisponível.','error');return;}
 const resumo=new Map(productRows(inv).map(r=>[String(r.codigo),r]));const doc=new JsPDF({orientation:'portrait',unit:'mm',format:'a4'});if(typeof doc.autoTable!=='function'){window.showToast?.('Tabela PDF indisponível.','error');return;}
 codigos.forEach((codigo,idx)=>{
   if(idx)doc.addPage('a4','portrait');const r=resumo.get(String(codigo))||{};const linhas=checkpointRows(inv,codigo);const nome=String(r.descricao||linhas[0]?.descricao||'Produto');const invNome=String(inv.codigo||inv.nome||inv.id||'');const contadoAtual=linhas.filter(x=>x.tipo==='CONTADO').reduce((a,x)=>a+n(x.qtdUn),0);const sistemaAtual=n(r.sistema),diferencaAtual=contadoAtual-sistemaAtual;
   doc.setFontSize(13);doc.setFont('helvetica','bold');doc.text('Checkpoint de Inventário '+invNome,12,12);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(new Date().toLocaleString('pt-BR'),198,12,{align:'right'});
   doc.setFontSize(9);doc.text('Código: '+String(codigo)+'  |  Produto: '+nome,12,19);doc.text('Sistema: '+_fmt(sistemaAtual)+' UN   Contado: '+_fmt(contadoAtual)+' UN   Diferença: '+_fmt(diferencaAtual)+' UN',12,24);
   doc.setFontSize(7.5);doc.text('Leitura: linha zerada = produto constava no sistema; linha com quantidade = palete contado; somente linha contada = produto encontrado fora da base.',12,29);
   const body=linhas.map(x=>[x.codigo,x.descricao,x.palete||'',x.lote||'',_fmt(x.qtdUn),_fmt(x.qtdCx),x.endereco,x.situacao]);
   doc.autoTable({startY:33,head:[['Código','Descrição','Palete/Capa','Lote','Qtd. Contada UN','Qtd. Contada CX','Endereço Logístico','Situação']],body,theme:'grid',styles:{fontSize:6,cellPadding:1,valign:'middle'},headStyles:{fontStyle:'bold'},columnStyles:{4:{halign:'right'},5:{halign:'right'}},didParseCell:data=>{if(data.section==='body'){const sit=String(data.row.raw?.[7]||'');if(sit==='Não contado')data.cell.styles.fontStyle='bold';}}});
 }
 );
 const total=doc.getNumberOfPages();for(let i=1;i<=total;i++){doc.setPage(i);doc.setFontSize(7);doc.text('DT Inventário · Página '+i+' de '+total,198,290,{align:'right'});}
 const nome='checkpoint_inventario_'+String(inv.codigo||inv.id||'inventario').replace(/[^a-zA-Z0-9_-]+/g,'_')+'.pdf';doc.save(nome);
}

function renderProductView(){
 const host=document.getElementById('acomp-produtos-v275');if(!host)return;const inv=selectedInv();if(!inv){host.innerHTML='<div class="empty"><div class="empty-title">Selecione um inventário</div></div>';return;}
 const rows=productRows(inv);const validos=new Set(rows.map(r=>String(r.codigo)));[...checkpointSelecionados].forEach(k=>{if(!validos.has(k))checkpointSelecionados.delete(k);});
 const sys=rows.reduce((a,x)=>a+x.sistema,0),cnt=rows.reduce((a,x)=>a+x.contado,0),gain=rows.reduce((a,x)=>a+Math.max(0,x.diferenca),0),loss=rows.reduce((a,x)=>a+Math.max(0,-x.diferenca),0);
 host.innerHTML=`<div class="kpi-grid" style="margin-bottom:12px"><div class="kpi-card"><div class="kpi-label">Produtos</div><div class="kpi-value">${rows.length.toLocaleString('pt-BR')}</div></div><div class="kpi-card"><div class="kpi-label">Sistema (un.)</div><div class="kpi-value">${sys.toLocaleString('pt-BR')}</div></div><div class="kpi-card"><div class="kpi-label">Contado (un.)</div><div class="kpi-value">${cnt.toLocaleString('pt-BR')}</div></div><div class="kpi-card"><div class="kpi-label">Ganho / Perda</div><div class="kpi-value">+${gain.toLocaleString('pt-BR')} / -${loss.toLocaleString('pt-BR')}</div></div></div><div class="tc"><div class="tc-header" style="gap:12px;flex-wrap:wrap"><div><div class="tc-title">📦 Acompanhamento por Produto</div><div class="sec-sub">Sistema, contado e diferença consolidados em unidades · selecione produtos para gerar o checkpoint em PDF</div></div><div id="acomp-prod-checkpoint-actions-v275" style="display:${checkpointSelecionados.size?'flex':'none'};gap:8px;align-items:center;margin-left:auto"><span id="acomp-prod-checkpoint-count-v275" class="sec-sub"></span><button type="button" class="btn btn-primary btn-sm" id="acomp-prod-checkpoint-pdf-v275">📄 Baixar checkpoint PDF</button></div><input id="acomp-prod-busca-v275" class="search" placeholder="Buscar produto ou código" style="max-width:260px"></div><div style="overflow:auto"><table class="dt-table"><thead><tr><th style="width:90px;text-align:center"><label style="display:flex;gap:6px;align-items:center;justify-content:center"><input type="checkbox" id="acomp-prod-checkpoint-all-v275"> Checkpoint</label></th><th>Produto</th><th>Código</th><th>Tipo</th><th>Fator</th><th>Sistema (un.)</th><th>Contado (un.)</th><th>Diferença</th><th>Situação</th><th>Endereços</th></tr></thead><tbody id="acomp-prod-tbody-v275">${rows.map(r=>`<tr data-q="${esc((r.descricao+' '+r.codigo).toLowerCase())}" data-tipo-codigo="${esc(r.codigo)}" style="cursor:pointer" title="Clique para ver o motivo da classificação"><td style="text-align:center"><input type="checkbox" data-checkpoint-prod="${esc(r.codigo)}" aria-label="Selecionar ${esc(r.descricao)} para checkpoint" ${checkpointSelecionados.has(String(r.codigo))?'checked':''}></td><td><b>${esc(r.descricao)}</b></td><td>${esc(r.codigo)}</td><td>${esc(r.tipo)}</td><td>${r.fator}</td><td>${r.sistema.toLocaleString('pt-BR')}</td><td>${r.contado.toLocaleString('pt-BR')}</td><td style="font-weight:800;color:${r.diferenca<0?'var(--danger)':r.diferenca>0?'var(--success)':'var(--muted)'}">${r.diferenca>0?'+':''}${r.diferenca.toLocaleString('pt-BR')}</td><td>${r.diferenca>0?'GANHO':r.diferenca<0?'PERDA':'IGUAL'}</td><td>${r.enderecos.size}</td></tr>`).join('')}</tbody></table></div></div>`;
 const q=document.getElementById('acomp-prod-busca-v275');if(q)q.oninput=()=>{document.querySelectorAll('#acomp-prod-tbody-v275 tr').forEach(tr=>tr.style.display=tr.dataset.q.includes(q.value.toLowerCase())?'':'none');_checkpointAtualizarAcoes();};
 const tbody=document.getElementById('acomp-prod-tbody-v275');const rowsByCode=new Map(rows.map(r=>[String(r.codigo),r]));
 tbody?.querySelectorAll('tr[data-tipo-codigo]').forEach(tr=>{tr.onclick=e=>{if(e.target.closest('[data-checkpoint-prod]'))return;abrirDetalheTipoProduto(rowsByCode.get(String(tr.dataset.tipoCodigo)));};});
 tbody?.querySelectorAll('[data-checkpoint-prod]').forEach(ch=>{ch.onchange=e=>{e.stopPropagation();const k=ch.getAttribute('data-checkpoint-prod');if(ch.checked)checkpointSelecionados.add(k);else checkpointSelecionados.delete(k);_checkpointAtualizarAcoes();};ch.onclick=e=>e.stopPropagation();});
 const all=document.getElementById('acomp-prod-checkpoint-all-v275');if(all)all.onchange=()=>{[...document.querySelectorAll('#acomp-prod-tbody-v275 tr')].filter(tr=>tr.style.display!=='none').forEach(tr=>{const ch=tr.querySelector('[data-checkpoint-prod]');if(!ch)return;const k=ch.getAttribute('data-checkpoint-prod');if(all.checked)checkpointSelecionados.add(k);else checkpointSelecionados.delete(k);});_checkpointAtualizarAcoes();};
 document.getElementById('acomp-prod-checkpoint-pdf-v275')?.addEventListener('click',baixarCheckpointPdf);_checkpointAtualizarAcoes();
}
function abrirDetalheTipoProduto(r){
 if(!r)return;
 document.getElementById('v275-tipo-modal')?.remove();
 document.body.insertAdjacentHTML('beforeend',`<div id="v275-tipo-modal" class="v295-overlay" role="dialog" aria-modal="true"><div class="v295-dialog"><div class="modal-hdr"><div class="modal-title">🏷️ Classificação de tipo</div><button type="button" class="modal-close" data-close>✕</button></div><div style="padding:4px 2px 14px;display:flex;flex-direction:column;gap:10px"><div><div style="font-weight:700">${esc(r.descricao)}</div><div class="sec-sub">Código ${esc(r.codigo)}</div></div><div><div class="sec-sub" style="margin-bottom:2px">Tipo classificado</div><div style="font-weight:700">${esc(r.tipo)}</div></div><div><div class="sec-sub" style="margin-bottom:2px">Motivo</div><div>${esc(r.motivo||'Sem motivo registrado para esta importação (dado anterior a esta melhoria).')}</div></div></div><div class="modal-actions"><button type="button" class="btn btn-primary" data-close>Fechar</button></div></div></div>`);
 document.querySelectorAll('#v275-tipo-modal [data-close]').forEach(b=>b.onclick=()=>document.getElementById('v275-tipo-modal')?.remove());
}
function ensureAcompTabs(){
 const page=document.getElementById('page-acompanhamento');if(!page||document.getElementById('acomp-tabs-v275'))return;
 const target=page.querySelector('.sec-header')||page.firstElementChild;const tabs=document.createElement('div');tabs.id='acomp-tabs-v275';tabs.style='display:flex;gap:8px;margin:10px 0 14px';tabs.innerHTML='<button class="btn btn-primary btn-sm" data-v="end">📍 Por Endereço</button><button class="btn btn-ghost btn-sm" data-v="prod">📦 Por Produto</button>';
 target.insertAdjacentElement('afterend',tabs);const prod=document.createElement('div');prod.id='acomp-produtos-v275';prod.style.display='none';page.appendChild(prod);
 tabs.onclick=e=>{const b=e.target.closest('button');if(!b)return;const prodMode=b.dataset.v==='prod';[...tabs.children].forEach(x=>x.className='btn btn-ghost btn-sm');b.className='btn btn-primary btn-sm';[...page.children].forEach(x=>{if(x.id==='acomp-produtos-v275'||x.id==='acomp-tabs-v275'||x===target||x.classList?.contains('dt-inv-workspace'))return;x.dataset.v275Old=x.style.display;x.style.display=prodMode?'none':(x.dataset.v275Old||'');});prod.style.display=prodMode?'block':'none';if(prodMode)renderProductView();};
}
const oldRender=window.renderAcompanhamento;if(oldRender)window.renderAcompanhamento=function(){const r=oldRender.apply(this,arguments);setTimeout(()=>{ensureAcompTabs();if(document.getElementById('acomp-produtos-v275')?.style.display!=='none')renderProductView();},0);return r;};
document.addEventListener('DOMContentLoaded',()=>{ensureAcompTabs();});
window.DTV275={ensureTypeBox,refreshTypes,renderProductView,productRows,checkpointRows,baixarCheckpointPdf,checkpointSelecionados,abrirDetalheTipoProduto};
})();
