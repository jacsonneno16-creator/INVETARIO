(function(global){
'use strict';
const COL=()=>global.getDTFirestore().collection(global.DT_FCOL.produtos||'dt_produtos');let lista=[],listener=null,filtroStatus='';
const txt=v=>String(v==null?'':v).trim();const esc=v=>txt(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cab=v=>txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
const cod=v=>global.DTProdutos.normalizarCodigo(v);
function idEstavel(p){const base=cod(p.codigoInterno)||cod(p.dun)||cod(p.gtin);return base?('p_'+base.toLowerCase()):('p_'+Date.now()+'_'+Math.random().toString(36).slice(2,8));}
function normalizeRow(row){const map={};Object.keys(row||{}).forEach(k=>map[cab(k)]=row[k]);const pick=arr=>{for(const k of arr){if(map[k]!=null&&txt(map[k]))return txt(map[k]);}return '';};return {codigoInterno:pick(['CODIGO','CODIGO INTERNO','SKU','PRODUTO ID']),nomeProduto:pick(['PRODUTO','DESCRICAO','NOME DO PRODUTO']),dun:pick(['DUN','CODIGO DUN']),gtin:pick(['GTIN','EAN','CODIGO DE BARRAS']),unidade:pick(['UNIDADE','UN','EMBALAGEM']),ativo:true};}
function validar(rows){const erros=[];const vistos={dun:new Map(),gtin:new Map(),codigo:new Map()};rows.forEach((p,i)=>{const linha=i+2;if(!p.nomeProduto)erros.push({linha,codigo:p.codigoInterno||p.dun||p.gtin,motivo:'Nome do produto obrigatório'});if(!p.codigoInterno&&!p.dun&&!p.gtin)erros.push({linha,codigo:'',motivo:'Informe código interno, DUN ou GTIN'});[['dun',p.dun],['gtin',p.gtin],['codigo',p.codigoInterno]].forEach(([tipo,v])=>{const n=cod(v);if(!n)return;if(vistos[tipo].has(n))erros.push({linha,codigo:v,motivo:`${tipo.toUpperCase()} duplicado na linha ${vistos[tipo].get(n)}`});else vistos[tipo].set(n,linha);});});return erros;}
function render(){
 const busca=txt(document.getElementById('prod-busca')?.value).toLowerCase();const st=document.getElementById('prod-status')?.value||'';let f=lista.filter(p=>(!st||(st==='ativo'?p.ativo:p.ativo===false))&&(!busca||[p.codigoInterno,p.nomeProduto,p.dun,p.gtin,p.unidade].join(' ').toLowerCase().includes(busca)));
 const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};set('prod-k-total',lista.length);set('prod-k-semdun',lista.filter(p=>!p.dun).length);set('prod-k-semgtin',lista.filter(p=>!p.gtin).length);set('nb-produtos',lista.length);
 const wrap=document.getElementById('prod-table-wrap');if(!wrap)return;if(!f.length){wrap.innerHTML='<div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Nenhum produto encontrado</div></div>';return;}
 wrap.innerHTML=`<table><thead><tr><th>Código interno</th><th>Produto</th><th>DUN</th><th>GTIN/EAN</th><th>Unidade</th><th>Status</th><th>Atualização</th><th>Ações</th></tr></thead><tbody>${f.map(p=>`<tr><td class="mono">${esc(p.codigoInterno||'—')}</td><td><b>${esc(p.nomeProduto)}</b></td><td class="mono">${esc(p.dun||'—')}</td><td class="mono">${esc(p.gtin||'—')}</td><td>${esc(p.unidade||'—')}</td><td><span class="badge ${p.ativo?'ok':'off'}">${p.ativo?'ATIVO':'INATIVO'}</span></td><td>${esc(formatData(p.atualizadoEm))}</td><td><div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-prod-acao="editar" data-id="${esc(p.id)}">✏️</button><button class="btn btn-ghost btn-sm" data-prod-acao="toggle" data-id="${esc(p.id)}">${p.ativo?'⏸':'▶'}</button><button class="btn btn-danger btn-sm" data-prod-acao="excluir" data-id="${esc(p.id)}">🗑</button></div></td></tr>`).join('')}</tbody></table>`;
}
function formatData(v){try{const d=v?.toDate?v.toDate():new Date(v||0);return isNaN(d)?'—':d.toLocaleString('pt-BR');}catch(e){return '—';}}
async function iniciar(){if(listener)listener();listener=COL().onSnapshot(s=>{lista=s.docs.map(d=>global.DTProdutos.normalizarProduto(d.data(),d.id));global.DTProdutos.indexar(lista);render();},e=>console.error('[Base Produtos]',e));}
async function salvarProduto(p,id){const agora=new Date().toISOString();const payload={codigoInterno:txt(p.codigoInterno),nomeProduto:txt(p.nomeProduto),dun:txt(p.dun),gtin:txt(p.gtin),unidade:txt(p.unidade),ativo:p.ativo!==false,atualizadoEm:agora,atualizadoPor:global.currentUser?.email||''};if(!id){payload.criadoEm=agora;payload.criadoPor=global.currentUser?.email||'';}await COL().doc(id||idEstavel(payload)).set(payload,{merge:true});}
function abrirModal(p={}){const html=`<div id="modal-produto-bg" class="modal-bg on"><div class="modal"><div class="modal-hdr"><div class="modal-title">${p.id?'Editar':'Novo'} produto</div><button class="modal-close" data-prod-fechar>✕</button></div><div class="fg"><div class="fi"><div class="fl">Código interno</div><input id="mp-cod" value="${esc(p.codigoInterno||'')}"></div><div class="fi full"><div class="fl">Produto *</div><input id="mp-nome" value="${esc(p.nomeProduto||'')}"></div><div class="fi"><div class="fl">DUN</div><input id="mp-dun" value="${esc(p.dun||'')}"></div><div class="fi"><div class="fl">GTIN/EAN</div><input id="mp-gtin" value="${esc(p.gtin||'')}"></div><div class="fi"><div class="fl">Unidade</div><input id="mp-un" value="${esc(p.unidade||'')}"></div></div><div class="modal-actions"><button class="btn btn-ghost" data-prod-fechar>Cancelar</button><button class="btn btn-primary" id="mp-salvar">Salvar</button></div></div></div>`;document.body.insertAdjacentHTML('beforeend',html);document.querySelectorAll('[data-prod-fechar]').forEach(b=>b.onclick=()=>document.getElementById('modal-produto-bg')?.remove());document.getElementById('mp-salvar').onclick=async()=>{const obj={codigoInterno:txt(document.getElementById('mp-cod').value),nomeProduto:txt(document.getElementById('mp-nome').value),dun:txt(document.getElementById('mp-dun').value),gtin:txt(document.getElementById('mp-gtin').value),unidade:txt(document.getElementById('mp-un').value),ativo:p.ativo!==false};const er=validar([obj]);if(er.length)return alert(er[0].motivo);await salvarProduto(obj,p.id);document.getElementById('modal-produto-bg')?.remove();};}
async function importar(file){if(!file)return;const data=await file.arrayBuffer();const wb=XLSX.read(data,{type:'array',raw:false});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false});const normalized=rows.map(normalizeRow).filter(p=>p.nomeProduto||p.codigoInterno||p.dun||p.gtin);const erros=validar(normalized);if(erros.length){alert('Base inválida:\n'+erros.slice(0,20).map(e=>`Linha ${e.linha} · ${e.codigo||'sem código'} · ${e.motivo}`).join('\n'));return;}const ativos=lista.filter(p=>p.ativo);for(let i=0;i<normalized.length;i++){const p=normalized[i];const existente=ativos.find(x=>(cod(p.codigoInterno)&&cod(x.codigoInterno)===cod(p.codigoInterno))||(cod(p.dun)&&cod(x.dun)===cod(p.dun))||(cod(p.gtin)&&cod(x.gtin)===cod(p.gtin)));await salvarProduto(p,existente?.id);}alert(`${normalized.length} produto(s) importado(s)/atualizado(s).`);}
function exportar(){const dados=lista.map(p=>({'Código interno':p.codigoInterno,'Produto':p.nomeProduto,'DUN':p.dun,'GTIN/EAN':p.gtin,'Unidade':p.unidade,'Status':p.ativo?'ATIVO':'INATIVO'}));const ws=XLSX.utils.json_to_sheet(dados);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Produtos');XLSX.writeFile(wb,'base_produtos.xlsx');}

async function excluirTodos(){
  const total=lista.length;
  if(!total){ if(global.showToast) global.showToast('Não há produtos para excluir.','error'); return; }
  const executar=async function(){
    let excluidos=0;
    try{
      const snap=await COL().get();
      const docs=snap.docs||[];
      for(let i=0;i<docs.length;i+=300){
        const batch=global.getDTRawFirestore().batch();
        docs.slice(i,i+300).forEach(function(d){ batch.delete(d.ref); });
        await batch.commit();
        excluidos+=Math.min(300,docs.length-i);
      }
      lista=[];
      global.DTProdutos.indexar([]);
      render();
      if(global.showToast) global.showToast(excluidos+' produto(s) excluído(s).','success');
    }catch(e){
      console.error('[Base Produtos] Erro ao excluir todos:',e);
      if(global.showToast) global.showToast('Erro ao excluir todos os produtos: '+e.message,'error');
    }
  };
  if(global.showConfirm){
    global.showConfirm('Excluir TODOS os '+total.toLocaleString('pt-BR')+' produtos desta loja? Esta ação não pode ser desfeita.',executar,{title:'Excluir todos os produtos',icon:'🗑️',okLabel:'Excluir tudo',okClass:'btn-danger'});
  }else if(confirm('Excluir TODOS os '+total+' produtos desta loja?')) await executar();
}

function reiniciarAoTrocarLoja(){
  if(listener){ try{listener();}catch(_){} listener=null; }
  lista=[];
  global.DTProdutos.indexar([]);
  render();
  iniciar();
}

function modelo(){const ws=XLSX.utils.json_to_sheet([{'CÓDIGO INTERNO':'000123','PRODUTO':'PRODUTO EXEMPLO','DUN':'07890000000001','GTIN':'0789000000001','UNIDADE':'CX'}]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Modelo');XLSX.writeFile(wb,'modelo_base_produtos.xlsx');}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-prod-acao]');if(!b)return;const p=lista.find(x=>x.id===b.dataset.id);if(!p)return;if(b.dataset.prodAcao==='editar')abrirModal(p);if(b.dataset.prodAcao==='toggle')await salvarProduto({...p,ativo:!p.ativo},p.id);if(b.dataset.prodAcao==='excluir'&&confirm(`Excluir ${p.nomeProduto}?`))await COL().doc(p.id).delete();});
if(!global.__baseProdutosListenerLoja){global.__baseProdutosListenerLoja=true;global.addEventListener('dt-loja-alterada',reiniciarAoTrocarLoja);}
global.renderBaseProdutos=()=>{render();if(!listener)iniciar();};global.produtoNovo=()=>abrirModal();global.produtoImportar=importar;global.produtoExportar=exportar;global.produtoBaixarModelo=modelo;global.produtoExcluirTodos=excluirTodos;
})(window);
