(function(global){
'use strict';
// v296.2 — Este arquivo era a tela antiga de "Base de Produtos" (renderização própria,
// onSnapshot próprio, dropdown de famílias). A tela hoje é 100% renderizada por
// js/analista/52-cadastros-v287.js, que já mantém seu próprio listener em tempo real
// (P.unsub) e reage sozinho a qualquer escrita nesta coleção.
// Por isso este arquivo NÃO deve mais manter lista/listener/render próprios — isso
// causava uma segunda leitura simultânea do Firestore e divergência entre o badge e a
// tabela quando os dois estados ficavam dessincronizados. Ele expõe apenas as ações de
// dados (importar, exportar, modelo, republicar chunks, excluir todos, salvar) que a
// tela nova chama via window.produtoXxx — a atualização da tela acontece sozinha
// porque qualquer escrita aqui dispara o onSnapshot que o 52-cadastros-v287.js já mantém.
const COL=()=>global.getDTRawFirestore().collection(global.DT_FCOL.produtos||'dt_produtos');
let sincronizandoChunks=false;
const txt=v=>String(v==null?'':v).trim();const esc=v=>txt(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cab=v=>txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[_\-]+/g,' ').replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const cod=v=>global.DTProdutos.normalizarCodigo(v);
function inferirCategoria(nome,familiaNome){let n=txt(familiaNome||nome).replace(/^\d{4,6}\s+/,'').trim();const palavras=n.split(/\s+/).filter(Boolean);return (palavras[0]||'SEM FAMÍLIA').toUpperCase();}
function hashTexto(v){let h=2166136261,s=txt(v).toUpperCase();for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}function idEstavel(p){const codigo=cod(p.codigoInterno);const nome=txt(p.nomeProduto);if(codigo)return 'p_cod_'+codigo.toLowerCase()+'_'+hashTexto(nome);if(nome)return 'p_nome_'+hashTexto(nome);const base=cod(p.gtin)||cod(p.dun);return base?('p_gtin_'+base.toLowerCase()+'_'+Date.now().toString(36)):('p_'+Date.now()+'_'+Math.random().toString(36).slice(2,8));}
function limparCodigoPlanilha(v){let s=txt(v).replace(/\s+/g,'');if(/^\d+[.,]0+$/.test(s))s=s.replace(/[.,]0+$/,'');if(/^\d+(?:[.,]\d+)?E[+-]?\d+$/i.test(s)){const n=Number(s.replace(',','.'));if(Number.isFinite(n))s=n.toLocaleString('fullwide',{useGrouping:false,maximumFractionDigits:0});}return s.replace(/[^0-9A-Za-z]/g,'');}
function normalizeRow(row){const map={},compact={};Object.keys(row||{}).forEach(k=>{const nk=cab(k),ck=nk.replace(/[^A-Z0-9]/g,'');map[nk]=row[k];compact[ck]=row[k];});const pick=arr=>{for(const k of arr){const kk=cab(k),ck=kk.replace(/[^A-Z0-9]/g,'');const v=map[kk]!=null?map[kk]:compact[ck];if(v!=null&&txt(v))return txt(v);}return '';};const nome=pick(['PRODUTO','DESCRICAO','DESCRIÇÃO','NOME DO PRODUTO','DESCRICAO PRODUTO','ITEM']);const unidade=pick(['UNIDADE','UN','EMBALAGEM']);const fam=global.DTProdutos.inferirFamilia(nome,unidade);const categoria=pick(['SECAO','SEÇÃO','FAMILIA','FAMÍLIA','CATEGORIA','GRUPO','FAMILIA DO PRODUTO'])||inferirCategoria(nome,fam.familiaNome);const codigoInformado=pick(['CODIGO','CÓDIGO','CODIGO INTERNO','CÓDIGO INTERNO','SKU','PRODUTO ID']);const codigoDescricao=(nome.match(/^\s*(\d{4,6})\b/)||[])[1]||'';const gtin=limparCodigoPlanilha(pick(['GTIN PRINCIPAL','GTIN_PRINCIPAL','GTIN-PRINCIPAL','GTIN/EAN','EAN/GTIN','GTIN EAN','EAN GTIN','GTIN','EAN','EAN13','GTIN13','EAN 13','GTIN 13','CODIGO DE BARRAS','CÓDIGO DE BARRAS','COD BARRAS','BARCODE']));const dun=limparCodigoPlanilha(pick(['DUN','DUN14','DUN 14','EAN14','EAN 14','GTIN14','GTIN 14','CODIGO DUN','DUN PRINCIPAL']));const tipoProduto=pick(['TIPO PRODUTO','TIPO_PRODUTO','TIPO DO PRODUTO','CATEGORIA PRODUTO','CATEGORIA INVENTARIO','GRUPO PRODUTO'])||'NAO CLASSIFICADO';const fatorCaixa=Math.max(1,Number(String(pick(['FATOR CAIXA','FATOR_CAIXA','FATOR DA CAIXA','FATOR EMBALAGEM','UNIDADES POR CAIXA'])||'1').replace(',','.'))||1);const ativoRaw=pick(['ATIVO','STATUS']);const ativo=!/^(NAO|NÃO|INATIVO|FALSE|0)$/i.test(ativoRaw||'SIM');return {codigoInterno:codigoInformado||codigoDescricao,nomeProduto:nome,dun:dun,gtin:gtin||dun,unidade:unidade,embalagem:fam.embalagem,familiaCodigo:fam.familiaCodigo,familiaNome:fam.familiaNome,produtoPrincipal:fam.familiaNome,categoriaFamilia:categoria,tipoProduto:tipoProduto,tipo_produto:tipoProduto,fatorCaixa:fatorCaixa,fator_caixa:fatorCaixa,ativo:ativo};}
function validar(rows){const erros=[];rows.forEach((p,i)=>{const linha=i+2;if(!p.nomeProduto)erros.push({linha,codigo:p.codigoInterno||p.gtin,motivo:'Nome do produto obrigatório'});if(!p.codigoInterno&&!p.gtin&&!p.nomeProduto)erros.push({linha,codigo:'',motivo:'Linha sem identificação'});});return erros;}

async function publicarChunksProdutos(){
 if(sincronizandoChunks)return;sincronizandoChunks=true;
 try{
  const fs=global.getDTRawFirestore(),raw=global.getDTRawFirestore();
  const snap=await COL().get();
  const todos=snap.docs.map(d=>({id:d.id,...d.data()}));
  const tamanho=1000,totalChunks=Math.ceil(todos.length/tamanho),versao=Date.now().toString();
  // Publicação segura por versão: escreve todos os chunks novos + o meta ANTES de apagar
  // os antigos. Assim nunca existe uma janela em que o coletor encontra a base vazia
  // no meio da publicação (mesmo princípio usado em fsPublicarEnderecos).
  const idsNovos=new Set();
  const opsNovas=[];
  for(let i=0;i<totalChunks;i++){
   const ref=fs.collection('dt_produtos_chunks').doc('v'+versao+'_'+String(i+1).padStart(4,'0'));
   idsNovos.add(ref.id);
   opsNovas.push({tipo:'set',ref,data:{parte:i+1,totalPartes:totalChunks,totalProdutos:todos.length,versao,itens:todos.slice(i*tamanho,(i+1)*tamanho)}});
  }
  for(let i=0;i<opsNovas.length;i+=350){const batch=raw.batch();opsNovas.slice(i,i+350).forEach(op=>batch.set(op.ref,op.data));await batch.commit();}
  await fs.collection('dt_produtos_meta').doc('versao').set({versao,totalProdutos:todos.length,totalChunks,atualizadoEm:new Date().toISOString()});
  // Só agora o coletor passa a enxergar a nova versão completa — pode limpar os chunks antigos.
  const antigos=await fs.collection('dt_produtos_chunks').get();
  const opsDelete=antigos.docs.filter(d=>!idsNovos.has(d.id)).map(d=>({tipo:'delete',ref:d.ref}));
  for(let i=0;i<opsDelete.length;i+=350){const batch=raw.batch();opsDelete.slice(i,i+350).forEach(op=>batch.delete(op.ref));await batch.commit();}
  window.dbg('[Produtos] Chunks publicados:',totalChunks,'/',todos.length);
 }finally{sincronizandoChunks=false;}
}
async function salvarProduto(p,id,publicar=true){const agora=new Date().toISOString();const fam=global.DTProdutos.inferirFamilia(p.nomeProduto,p.unidade);const payload={codigoInterno:txt(p.codigoInterno),nomeProduto:txt(p.nomeProduto),dun:txt(p.dun),gtin:txt(p.gtin),unidade:txt(p.unidade),embalagem:txt(p.embalagem)||fam.embalagem,familiaCodigo:txt(p.familiaCodigo)||fam.familiaCodigo,familiaNome:txt(p.familiaNome)||fam.familiaNome,produtoPrincipal:txt(p.produtoPrincipal)||fam.familiaNome,categoriaFamilia:txt(p.categoriaFamilia)||inferirCategoria(p.nomeProduto,fam.familiaNome),tipoProduto:txt(p.tipoProduto||p.tipo_produto)||'NAO CLASSIFICADO',tipo_produto:txt(p.tipoProduto||p.tipo_produto)||'NAO CLASSIFICADO',fatorCaixa:Math.max(1,Number(p.fatorCaixa||p.fator_caixa)||1),fator_caixa:Math.max(1,Number(p.fatorCaixa||p.fator_caixa)||1),ativo:p.ativo!==false,atualizadoEm:agora,atualizadoPor:global.currentUser?.email||''};if(!id){payload.criadoEm=agora;payload.criadoPor=global.currentUser?.email||'';}await COL().doc(id||idEstavel(payload)).set(payload,{merge:true});if(publicar)await publicarChunksProdutos();}
function abrirModal(p={}){const categoria=p.categoriaFamilia||inferirCategoria(p.nomeProduto,p.familiaNome);const html=`<div id="modal-produto-bg" class="modal-bg open"><div class="modal"><div class="modal-hdr"><div class="modal-title">${p.id?'Editar':'Novo'} produto</div><button class="modal-close" data-prod-fechar>✕</button></div><div class="fg"><div class="fi"><div class="fl">Código interno</div><input id="mp-cod" value="${esc(p.codigoInterno||'')}"></div><div class="fi full"><div class="fl">Produto *</div><input id="mp-nome" value="${esc(p.nomeProduto||'')}"></div><div class="fi"><div class="fl">Família *</div><input id="mp-familia" placeholder="Ex.: TAPIOCA, FAROFA" value="${esc(categoria==='SEM FAMÍLIA'?'':categoria)}"></div><div class="fi"><div class="fl">GTIN/EAN</div><input id="mp-gtin" value="${esc(p.gtin||'')}"></div><div class="fi"><div class="fl">Unidade/embalagem</div><input id="mp-un" value="${esc(p.unidade||p.embalagem||'')}"></div></div><div class="modal-actions"><button class="btn btn-ghost" data-prod-fechar>Cancelar</button><button class="btn btn-primary" id="mp-salvar">Salvar</button></div></div></div>`;document.body.insertAdjacentHTML('beforeend',html);document.querySelectorAll('[data-prod-fechar]').forEach(b=>b.onclick=()=>document.getElementById('modal-produto-bg')?.remove());document.getElementById('mp-salvar').onclick=async()=>{const obj={codigoInterno:txt(document.getElementById('mp-cod').value),nomeProduto:txt(document.getElementById('mp-nome').value),categoriaFamilia:txt(document.getElementById('mp-familia').value).toUpperCase(),dun:txt(p.dun),gtin:txt(document.getElementById('mp-gtin').value),unidade:txt(document.getElementById('mp-un').value),ativo:p.ativo!==false};const er=validar([obj]);if(er.length)return alert(er[0].motivo);if(!obj.categoriaFamilia)return alert('Informe a família do produto.');await salvarProduto(obj,p.id);document.getElementById('modal-produto-bg')?.remove();};}
async function importar(file){
 if(!file)return;
 if(global.__produtoImportando){if(global.showToast)global.showToast('Já existe uma importação em andamento.','info');return;}
 global.__produtoImportando=true;
 const aviso=global.showToast?global.showToast('Lendo e importando a base de produtos…','info'):null;
 try{
  const data=await file.arrayBuffer();
  const wb=XLSX.read(data,{type:'array',raw:false,cellText:true});
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false});
  const normalized=rows.map(normalizeRow).filter(p=>p.nomeProduto||p.codigoInterno||p.gtin||p.dun);
  const erros=validar(normalized);
  if(erros.length)throw new Error('Base inválida:\n'+erros.slice(0,30).map(e=>`Linha ${e.linha} · ${e.codigo||'sem código'} · ${e.motivo}`).join('\n'));
  // Busca o estado atual direto do Firestore (sem depender de um listener próprio)
  // só para casar duplicidade por GTIN/código+nome durante a importação.
  const snapAtual=await COL().get();
  const listaAtual=snapAtual.docs.map(d=>({id:d.id,...global.DTProdutos.normalizarProduto(d.data(),d.id)}));
  const porGtin=new Map(),porChave=new Map();
  listaAtual.forEach(p=>{const g=cod(p.gtin||p.dun);if(g)porGtin.set(g,p);porChave.set((cod(p.codigoInterno)||'')+'|'+txt(p.nomeProduto).toUpperCase(),p);});
  const agora=new Date().toISOString(),docs=[],vistos=new Set();let inseridos=0,atualizados=0,duplicados=0;
  normalized.forEach((p,i)=>{
   const g=cod(p.gtin||p.dun),ch=(cod(p.codigoInterno)||'')+'|'+txt(p.nomeProduto).toUpperCase();
   const existente=(g&&porGtin.get(g))||porChave.get(ch)||null;
   const fam=global.DTProdutos.inferirFamilia(p.nomeProduto,p.unidade);
   const payload={codigoInterno:txt(p.codigoInterno),nomeProduto:txt(p.nomeProduto),dun:txt(p.dun),gtin:txt(p.gtin||p.dun),unidade:txt(p.unidade),embalagem:txt(p.embalagem)||fam.embalagem,familiaCodigo:txt(p.familiaCodigo)||fam.familiaCodigo,familiaNome:txt(p.familiaNome)||fam.familiaNome,produtoPrincipal:txt(p.produtoPrincipal)||fam.familiaNome,categoriaFamilia:txt(p.categoriaFamilia)||inferirCategoria(p.nomeProduto,fam.familiaNome),tipoProduto:txt(p.tipoProduto||p.tipo_produto)||'NAO CLASSIFICADO',tipo_produto:txt(p.tipoProduto||p.tipo_produto)||'NAO CLASSIFICADO',fatorCaixa:Math.max(1,Number(p.fatorCaixa||p.fator_caixa)||1),fator_caixa:Math.max(1,Number(p.fatorCaixa||p.fator_caixa)||1),ativo:p.ativo!==false,atualizadoEm:agora,atualizadoPor:global.currentUser?.email||''};
   const id=existente?.id||idEstavel(payload);if(!existente){payload.criadoEm=agora;payload.criadoPor=global.currentUser?.email||'';inseridos++;}else atualizados++;
   if(vistos.has(id)){duplicados++;return;}vistos.add(id);docs.push({id,payload});
  });
  const raw=global.getDTRawFirestore();
  for(let i=0;i<docs.length;i+=300){const batch=raw.batch();docs.slice(i,i+300).forEach(x=>batch.set(COL().doc(x.id),x.payload,{merge:true}));await batch.commit();}
  await publicarChunksProdutos();
  const msg=`Importação finalizada: ${rows.length} linha(s) lida(s), ${docs.length} gravada(s), ${inseridos} nova(s), ${atualizados} atualizada(s)${duplicados?`, ${duplicados} duplicada(s) ignorada(s)`:''}.`;
  if(global.showToast)global.showToast(msg,'success');else alert(msg);
 }catch(e){console.error('[Produtos] Falha na importação',e);const msg=e?.message||String(e);if(global.showToast)global.showToast(msg,'error');else alert(msg);}
 finally{global.__produtoImportando=false;}
}
async function atualizarBase(){
 if(global.__produtoImportando){if(global.showToast)global.showToast('Já existe uma operação em andamento.','info');return;}
 global.__produtoImportando=true;
 try{
  const snap=await COL().get();
  await publicarChunksProdutos();
  if(global.showToast)global.showToast(`Base atualizada: ${snap.docs.length} produto(s) publicado(s) para os coletores.`,'success');
 }catch(e){console.error('[Produtos] Falha ao atualizar base',e);const msg=e?.message||String(e);if(global.showToast)global.showToast(msg,'error');else alert(msg);}
 finally{global.__produtoImportando=false;}
}
async function exportar(){
 const snap=await COL().get();
 const lista=snap.docs.map(d=>({id:d.id,...d.data()}));
 const dados=lista.map(p=>({'Código interno':p.codigoInterno,'Produto':p.nomeProduto,'Família':p.categoriaFamilia||inferirCategoria(p.nomeProduto,p.familiaNome),'GTIN/EAN':p.gtin,'Unidade':p.unidade,'Embalagem':p.embalagem,'Produto principal':p.familiaNome||p.produtoPrincipal,'Tipo produto':p.tipoProduto||p.tipo_produto||'NAO CLASSIFICADO','Fator caixa':p.fatorCaixa||p.fator_caixa||1,'Status':p.ativo?'ATIVO':'INATIVO'}));
 const ws=XLSX.utils.json_to_sheet(dados);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Produtos');XLSX.writeFile(wb,'base_produtos.xlsx');
}
async function excluirTodos(){
 const snapAtual=await COL().get();
 const total=snapAtual.docs.length;
 if(!total){if(global.showToast)global.showToast('Não há produtos para excluir.','error');return;}
 const executar=async()=>{
  let excluidos=0;
  try{
   const snap=await COL().get();const docs=snap.docs||[];
   for(let i=0;i<docs.length;i+=300){const batch=global.getDTRawFirestore().batch();docs.slice(i,i+300).forEach(d=>batch.delete(d.ref));await batch.commit();excluidos+=Math.min(300,docs.length-i);}
   await publicarChunksProdutos();
   if(global.showToast)global.showToast(excluidos+' produto(s) excluído(s).','success');
  }catch(e){console.error(e);if(global.showToast)global.showToast('Erro ao excluir todos: '+e.message,'error');}
   
 };
 if(global.showConfirm)global.showConfirm('Excluir TODOS os '+total.toLocaleString('pt-BR')+' produtos desta loja?',executar,{title:'Excluir todos os produtos',icon:'🗑️',okLabel:'Excluir tudo',okClass:'btn-danger'});
 else if(confirm('Excluir TODOS os '+total+' produtos desta loja?'))await executar();
}
function modelo(){const ws=XLSX.utils.json_to_sheet([{'CÓDIGO INTERNO':'000123','PRODUTO':'00001 TAPIOCA DA TERRINHA 1 KG - CX 12','FAMÍLIA':'TAPIOCA','TIPO PRODUTO':'PRODUTO DE VENDA','GTIN':'0789000000001','DUN':'17890000000018','FATOR CAIXA':12,'UNIDADE':'CX','ATIVO':'SIM'}]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Modelo');XLSX.writeFile(wb,'modelo_base_produtos.xlsx');}

// Compat: a tela nova (52-cadastros-v287.js) sobrescreve renderBaseProdutos com a
// própria função de ativação da tela; se por algum motivo ela ainda não tiver
// carregado, isto evita um erro de "não é função" — não faz mais leitura própria.
global.renderBaseProdutos=global.renderBaseProdutos||function(){};
global.produtoNovo=()=>abrirModal();
global.produtoImportar=importar;
global.produtoAtualizarBase=atualizarBase;
global.produtoExportar=exportar;
global.produtoBaixarModelo=modelo;
global.produtoExcluirTodos=excluirTodos;
global.publicarChunksProdutos=publicarChunksProdutos;
})(window);
