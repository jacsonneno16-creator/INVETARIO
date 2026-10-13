(function(global){
'use strict';
var MODS={
  end:{id:'estoque-enderecamento',page:'page-estoque-enderecamento',title:'📍 Endereçamento de Paletes',sub:'A existência do palete é conferida na consulta WMS; a capacidade e a elegibilidade do endereço permanecem sujeitas às regras da BlueSoft. Carregue os paletes a endereçar da BlueSoft ou importe uma planilha com o número da capa/palete e o endereço logístico de destino.',cols:['paleteKey','enderecoLogisticoKey'],tpl:[{paleteKey:2853034,enderecoLogisticoKey:960}]},
  troca:{id:'estoque-lote-trocas',page:'page-estoque-lote-trocas',title:'♻️ Lote de Trocas',sub:'Os produtos válidos da mesma execução serão enviados juntos em uma única solicitação de lote à BlueSoft (máximo 200). Descarte usa o mesmo lote com motivo cadastrado de perda/quebra/descarte; faturamento fiscal permanece na BlueSoft.',cols:['gtin','quantidade','motivoTrocaKey','setorOperacionalKey','enderecoSetor'],tpl:[{gtin:7891000098967,quantidade:10,motivoTrocaKey:1,setorOperacionalKey:1}]},
  transf:{id:'estoque-transformacao-api',page:'page-estoque-transformacao-api',title:'🔁 Transformação de Produtos',sub:'Execute transformações já cadastradas na BlueSoft a partir de arquivo, usando estoque de venda ou estoque de troca.',cols:['produtoKey','transformacaoKey','localDeEstoqueKey','quantidadeTransformacao','origemDaTransformacao','setorOperacionalKey','enderecoSetor'],tpl:[{produtoKey:12345,transformacaoKey:99,localDeEstoqueKey:1,quantidadeTransformacao:10,origemDaTransformacao:'ESTOQUE_TROCA',setorOperacionalKey:1}]}
};
var state={end:[],troca:[],transf:[],paletes:[],motivos:[],modoDescarte:false};
// Geração muda quando a planilha/operação é substituída: respostas antigas devem ser ignoradas.
var generation={end:0,troca:0,transf:0};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function loja(){try{return String((global.getDTLojaAtiva&&global.getDTLojaAtiva())||localStorage.getItem('dt_loja_atual')||'');}catch(e){return '';}}
function call(n,d){return global.firebase.app().functions('southamerica-east1').httpsCallable(n)(d||{}).then(function(r){return r.data||{};});}
function pode(mod,acao){return typeof global.temPermissao!=='function'||global.temPermissao(MODS[mod].id,acao);}
function style(){if(document.getElementById('dt-est-op-style'))return;var s=document.createElement('style');s.id='dt-est-op-style';s.textContent='.eop-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.eop-actions{display:flex;gap:8px;flex-wrap:wrap}.eop-grid{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;margin:12px 0}.eop-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px}.eop-card b{font-size:1.4rem}.eop-drop{border:1px dashed var(--border);border-radius:12px;padding:16px;background:var(--card);margin:12px 0}.eop-table{width:100%;border-collapse:collapse}.eop-table th,.eop-table td{padding:8px;border-bottom:1px solid var(--border);font-size:.76rem;text-align:left}.eop-ok{color:#15803d}.eop-err{color:#b91c1c}.eop-note{font-size:.75rem;color:var(--muted)}@media(max-width:900px){.eop-grid{grid-template-columns:repeat(2,1fr)}}';document.head.appendChild(s);}
function loteFingerprint(mod,rows){var str=loja()+'|'+mod+'|'+JSON.stringify(rows),a=2166136261,b=0;for(var i=0;i<str.length;i++){a=Math.imul(a^str.charCodeAt(i),16777619);b=(b+str.charCodeAt(i)*(i+1))>>>0;}return (a>>>0).toString(36)+'-'+b.toString(36)+'-'+rows.length;}
function loteChave(mod,rows){return 'dt_eop_lote_v2_'+loteFingerprint(mod,rows);}
function novoLoteId(){return 'op'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+'_'+Math.random().toString(36).slice(2);}
function prepararLote(mod,novo){generation[mod]++;var chave=loteChave(mod,state[mod]||[]),id='';try{if(!novo)id=localStorage.getItem(chave)||'';if(!id){id=novoLoteId();localStorage.setItem(chave,id);}}catch(e){throw new Error('Armazenamento local indisponível. Para impedir duplicações, habilite o armazenamento deste navegador.');}state['_lote_'+mod]=id;state['_validated_'+mod]=false;state['_historicoCarregado_'+mod]=false;(state[mod]||[]).forEach(function(r){delete r._done;delete r._status;delete r._issues;delete r._changes;delete r._pendenteConferencia;});}
function readFile(file,mod){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){try{if(!global.XLSX)throw new Error('Biblioteca XLSX não carregada.');var wb=global.XLSX.read(r.result,{type:'array'});var ws=wb.Sheets[wb.SheetNames[0]];var rows=global.XLSX.utils.sheet_to_json(ws,{defval:''});if(rows.length>500)throw new Error('O arquivo tem '+rows.length+' linhas. Divida em arquivos com no máximo 500 registros para recuperar o histórico com segurança.');state['_validated_'+mod]=false;state[mod]=rows.map(function(x){var o={};Object.keys(x).forEach(function(k){o[String(k).trim()]=x[k];});return o;});prepararLote(mod,false);resolve(state[mod]);}catch(e){reject(e);}};r.onerror=reject;r.readAsArrayBuffer(file);});}
function inteiro(v){var t=String(v==null?'':v).trim();return /^\d+$/.test(t)&&Number(t)>0&&Number.isSafeInteger(Number(t))?Number(t):null;}
function qtd(v){var t=String(v==null?'':v).trim().replace(',','.');return /^(?:\d+)(?:\.\d+)?$/.test(t)&&Number(t)>0&&isFinite(Number(t))?Number(t):null;}
function validar(mod){
 var rows=state[mod]||[],seen={},ok=0,erros=0,corrigidos=0;
 rows.forEach(function(r){
  var issues=[],changes=[],original={};Object.keys(r).forEach(function(k){if(k.charAt(0)!=='_')original[k]=r[k];});
  var ids=mod==='end'?['paleteKey','enderecoLogisticoKey']:mod==='troca'?['gtin','motivoTrocaKey','setorOperacionalKey']:['transformacaoKey','produtoKey','localDeEstoqueKey','setorOperacionalKey'];
  ids.forEach(function(k){if(mod==='end'&&k==='enderecoLogisticoKey'&&/^\d+(?:\.\d+)+$/.test(String(r[k]||'').trim())){r[k]=String(r[k]).trim();return;}if(r[k]==null||String(r[k]).trim()==='')return;var x=inteiro(r[k]);if(x===null){issues.push(k+' inválido');return;}if(String(r[k])!==String(x)){changes.push(k+': '+String(r[k])+' → '+x);r[k]=x;}});
  var quantities=mod==='troca'?['quantidade']:mod==='transf'?['quantidadeTransformacao']:[];
  quantities.forEach(function(k){var x=qtd(r[k]);if(x===null){issues.push(k+' deve ser maior que zero');return;}if(String(r[k])!==String(x)){changes.push(k+': '+String(r[k])+' → '+x);r[k]=x;}});
  if(mod==='end'){
   if(!inteiro(r.paleteKey)||!(inteiro(r.enderecoLogisticoKey)||/^\d+(?:\.\d+)+$/.test(String(r.enderecoLogisticoKey||'').trim())))issues.push('Palete e endereço de destino obrigatórios');
   ['paleteKeyParaAglutinar','logisticaLoteItemKey','quantidadeEnderecar','gtin'].forEach(function(k){if(r[k]!=null&&String(r[k]).trim()!==''&&!inteiro(r[k]))issues.push(k+' inválido');});
   var extras=['logisticaLoteItemKey','quantidadeEnderecar','gtin'].filter(function(k){return r[k]!=null&&String(r[k]).trim()!=='';});if(extras.length&&extras.length!==3)issues.push('Detalhes do item devem ter lote, quantidade e GTIN');
  }
  if(mod==='troca'){
   if(!inteiro(r.gtin)||!inteiro(r.motivoTrocaKey)||!(inteiro(r.setorOperacionalKey)||/^\d+(?:\.\d+)+$/.test(String(r.enderecoSetor||'').trim())))issues.push('GTIN, motivo e setor (ou endereço associado) obrigatórios');
   if(r.gtin!=null&&String(r.gtin).length>14)issues.push('GTIN maior que 14 dígitos');
  }
  if(mod==='transf'){
   if(!inteiro(r.transformacaoKey)&&!inteiro(r.produtoKey))issues.push('Transformação ou produto obrigatório');
   if(!inteiro(r.localDeEstoqueKey))issues.push('Local de estoque obrigatório');
   var origin=String(r.origemDaTransformacao||'').trim().toUpperCase();if(origin!==String(r.origemDaTransformacao||'')){changes.push('Origem normalizada');r.origemDaTransformacao=origin;}
   if(origin!=='ESTOQUE_TROCA'&&origin!=='ESTOQUE_VENDA')issues.push('Origem de estoque inválida');
  }
  var key=mod==='end'?'end:'+r.paleteKey:mod==='troca'?'troca:'+r.gtin+':'+r.motivoTrocaKey+':'+r.setorOperacionalKey: 'transf:'+r.transformacaoKey+':'+r.produtoKey+':'+r.localDeEstoqueKey+':'+r.origemDaTransformacao;
  if((mod==='troca'||mod==='transf')&&r.enderecoSetor)key+=':endereco:'+String(r.enderecoSetor).trim();
  if(seen[key])issues.push('Possível duplicidade com a linha '+seen[key]);else seen[key]=rows.indexOf(r)+1;
  r._issues=issues;r._changes=changes;r._original=original;
  if(r._done){r._status=r._status&&r._status.indexOf('JÁ EXECUTADO')===0?r._status:'JÁ EXECUTADO';}else if(r._pendenteConferencia){r._status='CONFERÊNCIA NECESSÁRIA · Não reenviar';erros++;}else if(issues.length){r._status='BLOQUEADO: '+issues.join('; ');erros++;}else{r._status=changes.length?'VALIDADO · '+changes.join('; '):'VALIDADO';ok++;}
  if(changes.length)corrigidos++;
 });
 state['_validated_'+mod]=false;return {ok:ok,erros:erros,corrigidos:corrigidos};
}
// Recupera o histórico ao reabrir o mesmo arquivo, inclusive após fechar o navegador.
// Falha na consulta bloqueia o envio: nunca presumimos que linhas foram liberadas.
function recuperarHistorico(mod){
 var rows=state[mod]||[],id=state['_lote_'+mod],versao=generation[mod];if(!rows.length||!id)return Promise.resolve();
 state['_historicoCarregado_'+mod]=false;
 return call('consultarHistoricoEstoqueArquivo',{lojaId:loja(),modo:mod,operacaoId:id,indices:rows.map(function(r,i){return i;})}).then(function(res){
  if(versao!==generation[mod])return;
  var registros=res.registros;
  if(!Array.isArray(registros)||registros.length!==rows.length)throw new Error('Resposta de histórico incompleta: esperado '+rows.length+' registro(s).');
  var recebidos={};
  registros.forEach(function(item){
   if(!item||!Number.isSafeInteger(item.indice)||item.indice<0||item.indice>=rows.length||recebidos[item.indice])throw new Error('Histórico retornou índice ausente, duplicado ou inválido.');
   if(['concluido','conferencia_necessaria','nao_iniciado'].indexOf(item.status)<0)throw new Error('Histórico retornou estado desconhecido para a linha '+(item.indice+1)+'.');
   recebidos[item.indice]=true;
  });
  if(Object.keys(recebidos).length!==rows.length)throw new Error('Histórico não retornou todas as linhas.');
  registros.forEach(function(item){var r=rows[item.indice];
   if(item.status==='concluido'){r._done=true;r._status='JÁ EXECUTADO · '+(item.detalhe||'Concluído anteriormente');}
   else if(item.status==='conferencia_necessaria'){r._pendenteConferencia=true;r._status='CONFERÊNCIA NECESSÁRIA · Não reenviar';}
  });
  state['_historicoCarregado_'+mod]=true;preview(mod);
 }).catch(function(e){if(versao!==generation[mod])return;state['_historicoCarregado_'+mod]=false;preview(mod);global.showToast&&global.showToast('Histórico não disponível: envio bloqueado até recuperar os registros. '+(e.message||String(e)),'error');});
}
function exportarResultado(mod){
 if(!pode(mod,'exportar')){global.showToast&&global.showToast('Sem permissão de exportação.','error');return;}
 var rows=state[mod]||[];if(!rows.length){global.showToast&&global.showToast('Importe uma planilha primeiro.','warning');return;}
 if(!global.XLSX){global.showToast&&global.showToast('Biblioteca XLSX não carregada.','error');return;}
 var itens=rows.map(function(r,i){var item={linha:i+1};Object.keys(r).forEach(function(k){if(k.charAt(0)!=='_')item[k]=r[k];});item.status=r._status||'Aguardando validação';item.correcoes=(r._changes||[]).join('; ');item.erros=(r._issues||[]).join('; ');item.conferenciaNecessaria=!!r._pendenteConferencia;item.executado=!!r._done;return item;});
 var wb=global.XLSX.utils.book_new();global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(itens),'RESULTADOS');
 global.XLSX.writeFile(wb,'estoque_'+mod+'_resultado_'+new Date().toISOString().slice(0,10)+'.xlsx');
}
function downloadTemplate(mod){var m=MODS[mod];if(!global.XLSX){global.showToast&&global.showToast('Biblioteca Excel não carregada.','error');return;}var wb=global.XLSX.utils.book_new();var ws=global.XLSX.utils.json_to_sheet(m.tpl,{header:m.cols});global.XLSX.utils.book_append_sheet(wb,ws,mod==='end'?'ENDERECAMENTO':mod==='troca'?'LOTE_TROCAS':'TRANSFORMACAO');if(mod==='end'){var aj=global.XLSX.utils.aoa_to_sheet([['CAMPO','REGRA'],['paleteKey','Número da capa/palete BlueSoft. Obrigatório.'],['enderecoLogisticoKey','Aceita chave numérica BlueSoft OU código físico com pontos, localizado no catálogo WMS da loja; não precisa ser igual ao destino sugerido.']]);global.XLSX.utils.book_append_sheet(wb,aj,'LEIA-ME');}if(mod==='troca'){var aj2=global.XLSX.utils.aoa_to_sheet([['CAMPO','REGRA'],['gtin','GTIN do produto.'],['quantidade','Quantidade a lançar em troca.'],['motivoTrocaKey','Código do motivo de troca. Consulte na própria tela.'],['setorOperacionalKey','Chave numérica consultada na tela. Pode ficar vazio quando enderecoSetor estiver preenchido.'],['enderecoSetor','Opcional: endereço físico com associação cadastrada na tela para esta loja. Não é inferido pelo WMS.']]);global.XLSX.utils.book_append_sheet(wb,aj2,'LEIA-ME');}if(mod==='transf'){var aj3=global.XLSX.utils.aoa_to_sheet([['CAMPO','REGRA'],['produtoKey','Opcional; usado para localizar transformação quando transformacaoKey não vier.'],['transformacaoKey','Código da transformação cadastrada BlueSoft.'],['localDeEstoqueKey','Local de estoque BlueSoft.'],['quantidadeTransformacao','Quantidade > 0.'],['origemDaTransformacao','ESTOQUE_TROCA ou ESTOQUE_VENDA.'],['setorOperacionalKey','Quando exigido pela transformação, use a chave numérica ou um enderecoSetor associado.'],['enderecoSetor','Opcional: endereço físico com associação cadastrada na tela para esta loja.']]);global.XLSX.utils.book_append_sheet(wb,aj3,'LEIA-ME');}global.XLSX.writeFile(wb,'MODELO_'+(mod==='end'?'ENDERECAMENTO_PALETES':mod==='troca'?'LOTE_TROCAS':'TRANSFORMACAO_PRODUTOS')+'.xlsx');}
function preview(mod){var host=document.getElementById('eop-preview-'+mod);if(!host)return;var rows=state[mod]||[],m=MODS[mod];if(!rows.length){host.innerHTML='<div class="empty"><div class="empty-title">Nenhum arquivo carregado</div><div class="empty-sub">Baixe o modelo, preencha e importe o arquivo.</div></div>';return;}host.innerHTML='<div class="tc"><div class="tc-header"><div class="tc-title">Prévia do arquivo · '+rows.length+' linha(s)</div></div><div style="overflow:auto"><table class="eop-table"><thead><tr>'+m.cols.map(function(c){return '<th>'+esc(c)+'</th>';}).join('')+'<th>Status / correções</th></tr></thead><tbody>'+rows.map(function(r){return '<tr>'+m.cols.map(function(c){return '<td>'+esc(r[c])+'</td>';}).join('')+'<td>'+(r._status?esc(r._status):'Aguardando validação')+'</td></tr>';}).join('')+'</tbody></table></div></div>';}
function renderBase(mod){style();var m=MODS[mod],host=document.getElementById(m.page);if(!host)return;host.innerHTML='<div class="eop-head"><div><div class="sec-title">'+m.title+'</div><div class="sec-sub">'+m.sub+'</div></div><div class="eop-actions">'+(pode(mod,'exportar')?'<button class="btn btn-ghost" id="eop-tpl-'+mod+'">⬇ Modelo Excel</button>':'')+(mod==='end'?'<button class="btn btn-ghost" id="eop-load-end">↻ Paletes a endereçar</button>':'')+(mod==='troca'?'<button class="btn btn-ghost" id="eop-motivos">↻ Motivos de troca</button><button class="btn btn-ghost" id="eop-consultar-trocas">↻ Consultar lançamentos</button>':'')+'</div></div><div class="eop-drop"><div class="fl">Arquivo Excel</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="file" id="eop-file-'+mod+'" accept=".xlsx,.xls,.csv" class="field" style="max-width:420px"><button class="btn btn-ghost" id="eop-check-'+mod+'">Validar planilha</button>'+(pode(mod,'exportar')?'<button class="btn btn-ghost" id="eop-export-'+mod+'">⬇ Exportar resultado</button>':'')+'<button class="btn btn-ghost" id="eop-new-'+mod+'">Nova operação</button><button class="btn btn-primary" id="eop-exec-'+mod+'" '+(!pode(mod,'executar')?'disabled':'')+'>Executar na BlueSoft</button></div><div class="eop-note" style="margin-top:8px">A validação é obrigatória. Correções automáticas são exibidas antes da confirmação; itens inválidos não serão enviados. Ao reimportar o mesmo arquivo, a operação anterior é recuperada. Use Nova operação apenas após verificar na BlueSoft que um novo lançamento é necessário.</div></div>'+(mod==='end'?'<div id="eop-paletes"></div>':'')+(mod==='troca'?'<label style="display:block;padding:12px"><input type="checkbox" id="eop-descarte"> Este lote é de DESCARTE/PERDA/QUEBRA (somente motivos confirmados pela BlueSoft)</label><div id="eop-motivos-box"></div><div id="eop-trocas-consulta"></div><div class="eop-actions" style="padding:10px"><input type="number" min="1" class="field" id="eop-estorno-key" placeholder="movimentoEstoqueKey para estorno" style="max-width:250px"><button class="btn btn-ghost" id="eop-estornar">Estornar movimento</button></div><div class="tc" style="padding:12px;margin-top:12px"><strong>Consulta de devoluções (somente leitura)</strong><div class="eop-actions" style="margin-top:10px"><button class="btn btn-ghost" id="eop-dev-compras">Notas fiscais / compras</button><button class="btn btn-ghost" id="eop-dev-lojas">Entre lojas</button><input class="field" id="eop-dev-requestid" placeholder="requestId assíncrono" style="max-width:210px"><button class="btn btn-ghost" id="eop-dev-monitor">Consultar requestId</button></div><div id="eop-dev-result"></div></div>':'')+'<div id="eop-preview-'+mod+'"></div>';
 if(document.getElementById('eop-tpl-'+mod))document.getElementById('eop-tpl-'+mod).onclick=function(){downloadTemplate(mod);};
 if(document.getElementById('eop-export-'+mod))document.getElementById('eop-export-'+mod).onclick=function(){exportarResultado(mod);};
 var inp=document.getElementById('eop-file-'+mod);inp.onchange=function(){if(!this.files||!this.files[0])return;readFile(this.files[0],mod).then(function(){var b=document.getElementById('eop-exec-'+mod);if(b)b.disabled=true;preview(mod);return recuperarHistorico(mod);}).catch(function(e){global.showToast&&global.showToast(e.message||String(e),'error');});};
 document.getElementById('eop-check-'+mod).onclick=function(){if(!state['_historicoCarregado_'+mod]){global.showToast&&global.showToast('Aguarde a recuperação do histórico no Firebase antes de validar.','error');return;}var info=validar(mod);preview(mod);var btn=document.getElementById('eop-exec-'+mod);if(btn)btn.disabled=true;
 var versao=generation[mod];var candidates=[],indexes=[];(state[mod]||[]).forEach(function(r,i){if(!r._done&&!r._pendenteConferencia&&(!r._issues||!r._issues.length)){var clean={};Object.keys(r).forEach(function(k){if(k.charAt(0)!=='_')clean[k]=r[k];});candidates.push(clean);indexes.push(i);}});
 if(!candidates.length){global.showToast&&global.showToast('Nenhuma linha válida pendente.','warning');return;}
 if(mod==='troca'&&candidates.length>200){global.showToast&&global.showToast('Lote de trocas limitado a 200 produtos. Separe os arquivos.','error');return;}
 global.showToast&&global.showToast('Consultando BlueSoft para pré-validação...','info');
 call('prevalidarEstoqueArquivo',{lojaId:loja(),modo:mod,linhas:candidates,indices:indexes}).then(function(ret){
  if(versao!==generation[mod])return;
  var respostas=ret.resultados||[];
  if(respostas.length!==indexes.length)throw new Error('Quantidade de respostas da BlueSoft diferente das linhas enviadas. Validação cancelada.');
  var recebidos={};respostas.forEach(function(item){if(!item||indexes.indexOf(item.indice)<0||recebidos[item.indice])throw new Error('Identificação de linha inválida na resposta da pré-validação.');recebidos[item.indice]=item;});
  indexes.forEach(function(indice){var item=recebidos[indice],r=state[mod][indice];if(!item)throw new Error('A linha '+(indice+1)+' não recebeu confirmação da pré-validação.');if(!item.ok){r._issues.push(item.erro||'Validação BlueSoft recusada');r._status='BLOQUEADO · '+r._issues.join('; ');}else{if(item.correcoes){Object.keys(item.correcoes).forEach(function(campo){var antigo=r[campo];r[campo]=item.correcoes[campo];r._changes.push(campo+': '+(antigo||'vazio')+' → '+r[campo]+' (BlueSoft)');});}r._status='VALIDADO · '+(item.detalhe||'Pré-validação concluída');}});
  state['_validated_'+mod]=true;preview(mod);if(btn)btn.disabled=!pode(mod,'executar')||!state[mod].some(function(r){return !r._done&&!r._pendenteConferencia&&(!r._issues||!r._issues.length);});
  global.showToast&&global.showToast('Pré-validação concluída. Confira os resultados antes de executar.', 'success');
 }).catch(function(e){if(versao!==generation[mod])return;state['_validated_'+mod]=false;if(btn)btn.disabled=true;global.showToast&&global.showToast('Não foi possível validar na BlueSoft; execução bloqueada: '+(e.message||String(e)),'error');});};
 document.getElementById('eop-new-'+mod).onclick=function(){if(!state[mod]||!state[mod].length){global.showToast&&global.showToast('Importe uma planilha primeiro.','warning');return;}if(!state['_historicoCarregado_'+mod]){global.showToast&&global.showToast('Histórico não carregado. Não é seguro criar nova operação.','error');return;}
 // CORREÇÃO (2026-10-09): antes, havendo QUALQUER linha com resultado incerto,
 // "Nova operação" ficava travada pra sempre nesta mesma planilha — mesmo
 // depois do usuário já ter conferido manualmente na BlueSoft que nada foi
 // movido (foi exatamente o caso real: 42 paletes marcados "concluído" por
 // engano, corrigidos pra "conferência necessária", e aí não havia como
 // tentar de novo pelo mesmo arquivo). A proteção de verdade contra
 // duplicidade é no SERVIDOR (operacaoId novo = registro novo, nunca reenvia
 // o antigo); este aviso agora exige confirmação explícita em vez de travar.
 var pendentes=(state[mod]||[]).filter(function(r){return r._pendenteConferencia;}).length;
 if(typeof global.showConfirm!=='function')return;
 var msg=pendentes?('Há '+pendentes+' linha(s) com resultado incerto nesta planilha. Confirme que você já verificou na BlueSoft que elas NÃO foram executadas antes de continuar. Criar outra operação para esta mesma planilha?'):'Criar outra operação para esta mesma planilha? Faça isso SOMENTE após conferir na BlueSoft que não haverá duplicidade.';
 global.showConfirm(msg,function(){try{prepararLote(mod,true);preview(mod);recuperarHistorico(mod);var btn=document.getElementById('eop-exec-'+mod);if(btn)btn.disabled=true;global.showToast&&global.showToast('Nova operação criada. Valide novamente a planilha.','warning');}catch(e){global.showToast&&global.showToast(e.message,'error');}},{title:'Nova movimentação de estoque',icon:pendentes?'⚠️':undefined,okLabel:'Criar nova operação'});};
 document.getElementById('eop-exec-'+mod).onclick=function(){executar(mod);};
 if(mod==='end')document.getElementById('eop-load-end').onclick=carregarPaletes;
 if(mod==='troca'){document.getElementById('eop-motivos').onclick=carregarMotivos;document.getElementById('eop-descarte').onchange=function(){state.modoDescarte=!!this.checked;state['_validated_troca']=false;var b=document.getElementById('eop-exec-troca');if(b)b.disabled=true;};document.getElementById('eop-consultar-trocas').onclick=consultarTrocas;document.getElementById('eop-estornar').onclick=estornarTroca; document.getElementById('eop-dev-compras').onclick=function(){consultarDevolucoes('compras');};document.getElementById('eop-dev-lojas').onclick=function(){consultarDevolucoes('entre_lojas');};document.getElementById('eop-dev-monitor').onclick=function(){consultarDevolucoes('monitoramento');};} 
 preview(mod);
}
function executar(mod){
 var rows=state[mod]||[],versao=generation[mod];if(!rows.length||!state['_validated_'+mod]||!state['_historicoCarregado_'+mod]){global.showToast&&global.showToast('Importe e valide a planilha antes de executar.','error');return;}
 var indices=[],validos=[];rows.forEach(function(r,i){if(!r._done&&!r._pendenteConferencia&&(!r._issues||!r._issues.length)){indices.push(i);var clean={};Object.keys(r).forEach(function(k){if(k.charAt(0)!=='_')clean[k]=r[k];});validos.push(clean);}});
 if(!validos.length){global.showToast&&global.showToast('Não há registros válidos pendentes.','warning');return;}
 if(mod==='troca'&&state.modoDescarte){var keys={};state.motivos.forEach(function(m){if(/descarte|perda|quebra/i.test(String(m.nome||'')))keys[String(m.motivoTrocaKey)]=true;});if(!Object.keys(keys).length||validos.some(function(l){return !keys[String(l.motivoTrocaKey)];})){global.showToast&&global.showToast('Confira os motivos de descarte na BlueSoft; todos os itens precisam usar motivo de descarte/perda/quebra.','error');return;}}
 if(mod==='troca'&&(validos.length>200||validos.length!==rows.length)){global.showToast&&global.showToast('Para gerar um lote único, corrija todas as linhas ou use um arquivo somente com os itens válidos (até 200).','error');return;}
 var nome=mod==='end'?'enderecarPaletesArquivo':mod==='troca'?'gerarLoteTrocasArquivo':'transformarProdutosArquivo';
 var btn=document.getElementById('eop-exec-'+mod);
 if(typeof global.showConfirm!=='function'){global.showToast&&global.showToast('Confirmação indisponível. Operação bloqueada.','error');return;}
 global.showConfirm('Enviar '+validos.length+' linha(s) validada(s) à BlueSoft? '+(rows.length-validos.length)+' linha(s) já processada(s) ou bloqueada(s).',function(){
  if(versao!==generation[mod])return;
  if(btn)btn.disabled=true;
  // A resposta pode se perder mesmo após a BlueSoft concluir a operação.
  // Nunca liberar um segundo envio sem consultar novamente o histórico persistente.
  state['_validated_'+mod]=false;
  state['_historicoCarregado_'+mod]=false;
  call(nome,{lojaId:loja(),operacaoId:state['_lote_'+mod],indices:indices,linhas:validos,finalidade:mod==='troca'?(state.modoDescarte?'descarte':'troca'):undefined}).then(function(res){
   if(versao!==generation[mod])return;
   var resultados=res&&res.resultados;
   if(!Array.isArray(resultados)||resultados.length!==indices.length)throw new Error('Resultado incompleto. Consulte o histórico antes de tentar novamente.');
   resultados.forEach(function(x,i){
    if(!x||typeof x.ok!=='boolean')throw new Error('Resposta sem estado confirmado para a linha '+(indices[i]+1));
    var r=rows[indices[i]];
    r._done=x.ok===true;
    if(x.requerConferencia)r._pendenteConferencia=true;
    r._status=x.ok?'OK · '+(x.detalhe||'Concluído'):x.requerConferencia?'CONFERÊNCIA NECESSÁRIA · Não reenviar':'ERRO · '+(x.erro||'Falha');
   });
   preview(mod);
   global.showToast&&global.showToast((res.sucessos||0)+' sucesso(s), '+(res.erros||0)+' erro(s). Consulte o histórico antes de outro envio.',res.erros?'warning':'success');
  }).catch(function(e){
   if(versao!==generation[mod])return;
   global.showToast&&global.showToast('Resultado não confirmado: '+(e.message||String(e))+'. Recarregando histórico; não reenvie até conferir na BlueSoft.','error');
  }).then(function(){
   // Mesmo quando houve erro, a consulta é obrigatória para refletir o que o servidor registrou.
   if(versao!==generation[mod])return;
   return recuperarHistorico(mod);
  }).then(function(){
   if(versao===generation[mod]&&btn)btn.disabled=true; // nova validação consultiva sempre necessária
  });
 },{title:'Confirmar movimentação de estoque',icon:'⚠️',okLabel:'Enviar à BlueSoft',okClass:'btn-primary'});
}
function painelSetores(mod){
 var host=document.getElementById(MODS[mod].page);if(!host||document.getElementById('eop-setores-'+mod))return;
 var box=document.createElement('div');box.id='eop-setores-'+mod;box.className='tc';box.style.cssText='padding:14px;margin:14px 0';
 box.innerHTML='<strong>Setor operacional</strong><p class="eop-note">Consulte os nomes e códigos na BlueSoft. Para usar endereço na planilha, cadastre a associação endereço → setor. A associação vale somente para a loja selecionada.</p><button type="button" class="btn btn-ghost" id="eop-setores-load-'+mod+'">Consultar setores e associações</button><div id="eop-setores-lista-'+mod+'"></div>';
 host.insertBefore(box,document.getElementById('eop-preview-'+mod));
 document.getElementById('eop-setores-load-'+mod).onclick=function(){carregarSetores(mod);};
}
function carregarSetores(mod){
 var host=document.getElementById('eop-setores-lista-'+mod);if(!host)return;host.textContent='Consultando BlueSoft...';
 call('listarSetoresOperacionais',{lojaId:loja(),modo:mod}).then(function(r){
  var itens=r.itens||[],vinculos=r.vinculos||[];
  host.innerHTML='<div style="margin:12px 0"><label>Setor <select class="field" id="eop-setor-select-'+mod+'"><option value="">Selecione</option>'+itens.map(function(s){return '<option value="'+esc(s.setorOperacionalKey)+'">'+esc(s.descricao)+' · chave '+esc(s.setorOperacionalKey)+' · código '+esc(s.codigo)+'</option>';}).join('')+'</select></label><button type="button" class="btn btn-ghost" id="eop-setor-aplicar-'+mod+'">Preencher setor nas linhas sem setor/endereço</button></div>'+(r.podeConfigurar?'<div class="eop-actions"><input class="field" id="eop-setor-endereco-'+mod+'" placeholder="Endereço físico completo com pontos"><label><input type="checkbox" checked id="eop-setor-ativo-'+mod+'"> Associação ativa</label><button type="button" class="btn btn-primary" id="eop-setor-salvar-'+mod+'">Salvar associação</button></div>':'')+'<div style="margin:12px 0">'+vinculos.map(function(v){return '<div>'+esc(v.endereco)+' → setor '+esc(v.setorOperacionalKey)+(v.ativo===false?' (inativo)':'')+'</div>';}).join('')+'</div><small>Na coluna motivoTrocaKey use apenas a chave numérica listada em Motivos de troca. Na coluna enderecoSetor, use o endereço associado e deixe setorOperacionalKey vazio.</small>';
  document.getElementById('eop-setor-aplicar-'+mod).onclick=function(){var key=inteiro(document.getElementById('eop-setor-select-'+mod).value);if(!key)return;var n=0;(state[mod]||[]).forEach(function(l){if(!l._done&&!l._pendenteConferencia&&!l.setorOperacionalKey&&!l.enderecoSetor){l.setorOperacionalKey=key;n++;}});state['_validated_'+mod]=false;var b=document.getElementById('eop-exec-'+mod);if(b)b.disabled=true;preview(mod);global.showToast&&global.showToast(n+' linha(s) preenchida(s). Valide novamente.','success');};
  var save=document.getElementById('eop-setor-salvar-'+mod);if(save)save.onclick=function(){save.disabled=true;call('salvarVinculoEnderecoSetor',{modo:mod,lojaId:loja(),endereco:document.getElementById('eop-setor-endereco-'+mod).value,setorOperacionalKey:document.getElementById('eop-setor-select-'+mod).value,ativo:document.getElementById('eop-setor-ativo-'+mod).checked}).then(function(){state['_validated_'+mod]=false;var b=document.getElementById('eop-exec-'+mod);if(b)b.disabled=true;global.showToast&&global.showToast('Associação salva. Valide a planilha novamente.','success');carregarSetores(mod);}).catch(function(e){save.disabled=false;global.showToast&&global.showToast(e.message||String(e),'error');});};
 }).catch(function(e){host.textContent='Não foi possível consultar setores: '+(e.message||String(e))+' Verifique a permissão BlueSoft 4011 (API Setor Operacional — Consultar).';});
}
function carregarPaletes(){var box=document.getElementById('eop-paletes');if(box)box.innerHTML='<div class="loading">Carregando...</div>';call('listarPaletesAEnderecar',{lojaId:loja(),limite:200}).then(function(r){state.paletes=r.itens||[];if(!box)return;box.innerHTML='<div class="tc"><div class="tc-header"><div class="tc-title">Paletes a endereçar · '+state.paletes.length+'</div></div><div style="overflow:auto"><table class="eop-table"><thead><tr><th>Palete</th><th>Produto</th><th>Qtd.</th><th>Lote</th><th>Validade</th><th>Destino sugerido</th></tr></thead><tbody>'+state.paletes.map(function(x){return '<tr><td><b>'+esc(x.paleteKey)+'</b></td><td>'+esc(x.produtoKey)+' · '+esc(x.descricaoProduto||'')+'</td><td>'+esc(x.quantidadeDisponivelEmUnidades)+'</td><td>'+esc(x.numeroDoLote||'—')+'</td><td>'+esc(x.dataDeValidade||'—')+'</td><td>'+esc(x.enderecoDeDestino||'—')+'</td></tr>';}).join('')+'</tbody></table></div></div>';}).catch(function(e){if(box)box.innerHTML='<div class="alert alert-danger">'+esc(e.message||String(e))+'</div>';});}
function estornarTroca(){var key=Number(document.getElementById('eop-estorno-key').value);if(!Number.isSafeInteger(key)||key<=0){global.showToast&&global.showToast('Informe movimentoEstoqueKey válido.','error');return;}if(typeof global.showConfirm!=='function')return;global.showConfirm('ESTORNAR a movimentação '+key+' na BlueSoft? Confira antes o histórico. O estorno pode ser irreversível e a BlueSoft pode recusá-lo se houver nota fiscal.',function(){call('estornarTrocaDescarte',{lojaId:loja(),movimentoEstoqueKey:key,confirmacao:'CONFIRMO ESTORNO'}).then(function(r){global.showToast&&global.showToast(r.ok?'Estorno confirmado pela BlueSoft.':r.erro||'Resultado não confirmado; confira na BlueSoft.',r.ok?'success':'error');}).catch(function(e){global.showToast&&global.showToast('Estorno não confirmado: '+(e.message||e),'error');});},{title:'Confirmação de estorno',okLabel:'Confirmar estorno'});}
function consultarDevolucoes(tipo){var box=document.getElementById('eop-dev-result');if(!box)return;box.textContent='Consultando BlueSoft...';var args={lojaId:loja(),tipo:tipo,currentPage:0};if(tipo==='monitoramento')args.requestId=(document.getElementById('eop-dev-requestid').value||'').trim();call('consultarDevolucoesEstoque',args).then(function(r){box.innerHTML='<pre style="max-height:310px;overflow:auto;white-space:pre-wrap">'+esc(JSON.stringify(r,null,2))+'</pre>';}).catch(function(e){box.textContent='Consulta indisponível: '+(e.message||String(e));});}
function consultarTrocas(){var box=document.getElementById('eop-trocas-consulta');if(box)box.textContent='Consultando lançamentos...';call('consultarTrocasDescarte',{lojaId:loja(),currentPage:0}).then(function(resp){var itens=Array.isArray(resp)?resp:(resp&&resp.data)||[];if(!Array.isArray(itens))throw new Error('Resposta de consulta inesperada.');if(box)box.innerHTML='<div class="tc"><div class="tc-title">Trocas e descartes lançados · '+itens.length+' registro(s) (primeira página)</div><pre style="max-height:280px;overflow:auto">'+esc(JSON.stringify(itens,null,2))+'</pre></div>';}).catch(function(e){if(box)box.textContent='Falha: '+(e.message||e);});}
function carregarMotivos(){var box=document.getElementById('eop-motivos-box');if(box)box.textContent='Carregando...';call('listarMotivosTroca',{lojaId:loja()}).then(function(r){state.motivos=r.itens||[];if(box)box.innerHTML='<div class="tc"><div class="tc-header"><div class="tc-title">Motivos de troca</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px">'+state.motivos.map(function(x){return '<span class="ap-pill">'+esc(x.motivoTrocaKey)+' · '+esc(x.nome||'')+'</span>';}).join('')+'</div></div>';}).catch(function(e){if(box)box.innerHTML='<div class="alert alert-danger">'+esc(e.message||String(e))+'</div>';});}
global.renderEstoqueEnderecamento=function(){renderBase('end');};
global.renderEstoqueLoteTrocas=function(){renderBase('troca');painelSetores('troca');};
global.renderEstoqueTransformacaoApi=function(){renderBase('transf');painelSetores('transf');};
})(window);
