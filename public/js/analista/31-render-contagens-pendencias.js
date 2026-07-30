function state(){ return window.AnalistaStore.getState(); }

function _paleteContagem(c){
  const valor=c?.palete ?? c?.pallet ?? c?.numero_palete ?? c?.numeroPalete ??
    c?.palete_key ?? c?.capa_palete ?? c?.pallete_ou_capa ?? c?.capa ?? '';
  return String(valor ?? '').trim();
}

function _ordemPaleteContagem(c){
  const pal=_paleteContagem(c);
  const num=Number(pal);
  if(pal && Number.isFinite(num)) return {grupo:0, valor:num, texto:pal};
  return {grupo:1, valor:0, texto:pal || String(c?.criado_em || c?.dataHora || c?.timestamp || '')};
}

function _produtoContagemExibicao(c){
  const codigo=c?.codigo_produto||c?.codigoProduto||c?.gtin||c?.ean||c?.dun||c?.codigo_lido||c?.codigoLido||'';
  const atual=String(c?.descricao_produto||c?.descricaoProduto||c?.descricao||'').trim();
  const placeholder=!atual||/^(PRODUTO NAO IDENTIFICADO|PRODUTO NÃO IDENTIFICADO|PRODUTO NAO CADASTRADO|PRODUTO NÃO CADASTRADO|CODIGO SEM CADASTRO|CÓDIGO SEM CADASTRO)$/i.test(atual);
  const ach=window.DTProdutos?.buscarSync?.(codigo);
  return {codigo:codigo||ach?.codigoInterno||ach?.gtin||ach?.dun||'',descricao:(!placeholder?atual:'')||(ach?.encontrado?ach.nomeProduto:'Código sem cadastro')};
}


// Retorna a rodada mais recente concluida para exibicao na aba Contagens.
// O registro original permanece intacto; esta funcao apenas monta a visao
// operacional com produto, quantidade, operador e data da ultima rodada.
function _ultimaRodadaContagem(c){
  const st=state();
  const FK=window.InventoryFlowKey;
  const primeira={
    rodada:1,
    quantidade:c?.quantidade ?? c?.qtd ?? c?.qtd_contada ?? null,
    produto:c?.gtin_bipado || c?.gtinLido || c?.gtin_lido || c?.codigo_lido || c?.codigoLido || c?.codigo_produto || c?.codigoProduto || c?.gtin || c?.ean || c?.dun || '',
    descricao:c?.descricao_produto || c?.descricaoProduto || c?.produto_descricao || c?.descricao || '',
    operador:c?.operador || c?.operador_nome || '',
    data:c?.timestamp || c?.criado_em || c?.dataHora || ''
  };
  if(!FK) return primeira;

  const inv=FK.inventario(c,st.inventarios);
  const end=FK.endereco(c?.endereco);
  const prod=FK.produto(c);
  const cid=String(c?.uuid || c?.id || '');
  const divs=(st.divergencias || []).filter(d =>
    FK.inventario(d,st.inventarios)===inv && FK.endereco(d?.endereco)===end &&
    !['CANCELADA','EXCLUIDA','ESTORNADA'].includes(String(d?.status || '').toUpperCase())
  );
  const div=divs.find(d => cid && [d?.contagem_uuid,d?.contagem_id,d?.origem_contagem_id].filter(Boolean).map(String).includes(cid)) ||
    divs.find(d => FK.produto(d)===prod) || (divs.length===1 ? divs[0] : null);
  if(!div) return primeira;

  const concluida=r => {
    const status=String(r?.status_recontagem || r?.status || '').trim().toUpperCase();
    const bloqueada=['PENDENTE','ATRIBUIDA','ATRIBUÍDA','EM_ANDAMENTO','ABERTA','CANCELADA','EXCLUIDA'].includes(status);
    const temQtd=r?.qtd_recontagem != null || r?.qtd_segunda != null || r?.qtd_terceira != null;
    const temData=Boolean(r?.recontagem_concluida_em || r?.concluida_em || r?.finalizada_em || r?.data_segunda || r?.data_terceira);
    return temQtd && !bloqueada && (temData || ['CONCLUIDA','CONCLUÍDA','FINALIZADA','PROCESSADA','RESOLVIDA','AGUARDANDO_ANALISTA'].includes(status));
  };
  const recs=(st.recontagens || []).filter(r =>
    (String(r?.divergencia_id || '')===String(div?.id || '') || FK.mesmo(r,div,st.inventarios)) && concluida(r)
  ).sort((a,b) => {
    const na=Number(a?.numero_recontagem || 0), nb=Number(b?.numero_recontagem || 0);
    if(na!==nb) return na-nb;
    return String(a?.data_terceira || a?.recontagem_concluida_em || a?.concluida_em || a?.data_segunda || '')
      .localeCompare(String(b?.data_terceira || b?.recontagem_concluida_em || b?.concluida_em || b?.data_segunda || ''));
  });
  if(!recs.length) return primeira;

  const r=recs[recs.length-1];
  const numeroRodada=Math.max(1,Number(r?.numero_recontagem || recs.length));
  const rodada=Math.min(3,1+numeroRodada);

  // A tarefa de recontagem guarda o TOTAL do endereço, mas a aba Contagens
  // precisa continuar exibindo cada palete bipado separadamente. Por isso,
  // buscamos as leituras brutas da rodada em dt_contagens e associamos cada
  // leitura ao palete original (primeiro pelo número da capa/palete e, para
  // dados antigos sem o mesmo identificador, pela posição ordenada).
  const recontagensBrutas=(st.contagens || []).filter(x => {
    if(String(x?.tipo_contagem || '').toUpperCase()!=='RECONTAGEM') return false;
    if(x?._excluida || ['ESTORNADA','EXCLUIDA'].includes(String(x?.status || '').toUpperCase())) return false;
    if(FK.inventario(x,st.inventarios)!==inv || FK.endereco(x?.endereco)!==end) return false;
    const vinculada=String(x?.recontagem_id || '')===String(r?.id || '') ||
      String(x?.divergencia_id || '')===String(div?.id || '');
    const mesmaRodada=!x?.numero_recontagem || Number(x.numero_recontagem)===numeroRodada;
    return vinculada && mesmaRodada;
  }).sort((a,b) => {
    const oa=_ordemPaleteContagem(a), ob=_ordemPaleteContagem(b);
    if(oa.grupo!==ob.grupo) return oa.grupo-ob.grupo;
    if(oa.valor!==ob.valor) return oa.valor-ob.valor;
    return oa.texto.localeCompare(ob.texto);
  });

  let leituraPalete=null;
  const paleteOriginal=_paleteContagem(c);
  if(paleteOriginal){
    leituraPalete=recontagensBrutas.find(x => _paleteContagem(x)===paleteOriginal) || null;
  }
  if(!leituraPalete && recontagensBrutas.length){
    const originais=(st.contagens || []).filter(x =>
      String(x?.tipo_contagem || 'PRIMEIRA').toUpperCase()!=='RECONTAGEM' &&
      !x?._excluida && !['ESTORNADA','EXCLUIDA'].includes(String(x?.status || '').toUpperCase()) &&
      FK.inventario(x,st.inventarios)===inv && FK.endereco(x?.endereco)===end &&
      FK.produto(x)===prod
    ).sort((a,b) => {
      const oa=_ordemPaleteContagem(a), ob=_ordemPaleteContagem(b);
      if(oa.grupo!==ob.grupo) return oa.grupo-ob.grupo;
      if(oa.valor!==ob.valor) return oa.valor-ob.valor;
      return oa.texto.localeCompare(ob.texto);
    });
    const indice=originais.findIndex(x => String(x?.uuid || x?.id || '')===cid);
    if(indice>=0 && recontagensBrutas[indice]) leituraPalete=recontagensBrutas[indice];
  }

  const fonte=leituraPalete || r;
  return {
    rodada,
    quantidade:leituraPalete
      ? (leituraPalete?.quantidade ?? leituraPalete?.qtd ?? leituraPalete?.qtd_contada ?? primeira.quantidade)
      : (r?.qtd_terceira ?? r?.qtd_segunda ?? r?.qtd_recontagem ?? r?.quantidade ?? primeira.quantidade),
    produto:leituraPalete
      ? (leituraPalete?.gtin_bipado || leituraPalete?.codigoLido || leituraPalete?.dunLido || leituraPalete?.gtinLido || leituraPalete?.gtin || leituraPalete?.codigo_produto || primeira.produto)
      : (r?.produto_terceira || r?.produto_segunda || r?.produto_recontagem || r?.gtin_bipado || r?.codigo_produto || r?.produto || primeira.produto),
    descricao:fonte?.descricao_produto || fonte?.produto_descricao || fonte?.produtoLidoNome || fonte?.descricao || primeira.descricao,
    operador:fonte?.operador_terceira || fonte?.operador_segunda || fonte?.operador_recontagem || fonte?.operador || fonte?.operador_nome || primeira.operador,
    data:fonte?.data_terceira || fonte?.data_segunda || fonte?.recontagem_concluida_em || fonte?.concluida_em || fonte?.finalizada_em || fonte?.criado_em || fonte?.dataHora || primeira.data,
    palete:_paleteContagem(leituraPalete) || paleteOriginal,
    leitura_individual:Boolean(leituraPalete)
  };
}


function _avaliarDistribuicaoPaletes(c){
  return null; /* validacao autoritativa e somente pelo total do endereco */
  /*
  const st=state();
  const FK=window.InventoryFlowKey;
  if(!FK) return null;
  const inv=FK.inventario(c,st.inventarios);
  const end=FK.endereco(c?.endereco);
  const prod=FK.produto(c);
  const invObj=(st.inventarios||[]).find(i=>FK.inventario(i,st.inventarios)===inv);
  const num=v=>{ if(v===null||v===undefined||String(v).trim()==='') return 0; const n=Number(String(v).replace(',','.')); return Number.isFinite(n)?n:0; };
  const pal=x=>String(x?.palete ?? x?.pallet ?? x?.numero_palete ?? x?.numeroPalete ?? x?.palete_key ?? x?.capa_palete ?? x?.capa ?? '').trim();
  const qtd=x=>num(x?.quantidade_esperada ?? x?.qtd_esperada ?? x?.quantidade_enderecada ?? x?.saldo_estoque ?? x?.qtd_sistema ?? x?.estoque ?? x?.quantidade ?? x?.qtd ?? x?.qtde);
  const base=(invObj?.base||[]).filter(x=>FK.endereco(x?.endereco)===end && (!prod || FK.produto(x)===prod));
  const esperado=new Map();
  base.forEach(x=>{ const k=pal(x); if(k) esperado.set(k,(esperado.get(k)||0)+qtd(x)); });
  if(esperado.size<2) return null;
  const validas=(st.contagens||[]).filter(x=>!x?._excluida && !['ESTORNADA','EXCLUIDA'].includes(String(x?.status||'').toUpperCase()) && FK.inventario(x,st.inventarios)===inv && FK.endereco(x?.endereco)===end && (!prod || FK.produto(x)===prod));
  if(!validas.length) return null;
  const rodada=x=>String(x?.tipo_contagem||'PRIMEIRA').toUpperCase()==='RECONTAGEM' ? Math.min(3,1+Math.max(1,Number(x?.numero_recontagem||1))) : 1;
  const ultima=Math.max(...validas.map(rodada));
  const atual=new Map();
  validas.filter(x=>rodada(x)===ultima).forEach(x=>{ const k=pal(x); if(k) atual.set(k,(atual.get(k)||0)+num(x?.quantidade ?? x?.qtd ?? x?.qtd_contada)); });
  if(!atual.size) return null;
  const totalEsp=[...esperado.values()].reduce((a,b)=>a+b,0);
  const totalAt=[...atual.values()].reduce((a,b)=>a+b,0);
  const chaves=new Set([...esperado.keys(),...atual.keys()]);
  const divergentes=[...chaves].filter(k=>Math.abs((esperado.get(k)||0)-(atual.get(k)||0))>1e-9);
  return {rodada:ultima,totalEsperado:totalEsp,totalContado:totalAt,totalBate:Math.abs(totalEsp-totalAt)<1e-9,divergentes,quantidadeDivergente:divergentes.length};
  */
}
window.avaliarDistribuicaoPaletes=_avaliarDistribuicaoPaletes;

function contStatusBadge(status){
  const st = String(status || 'PENDENTE').toUpperCase();
  if (st === 'PROCESSADO' || st === 'OK' || st === 'CONCLUIDA') return 'b-green';
  if (st === 'DIVERGENTE' || st === 'CONFLITO' || st === 'PERSISTENTE') return 'b-red';
  if (st === 'ESTORNADA' || st === 'EXCLUIDA') return 'b-gray';
  if (st === 'EM_RECONTAGEM' || st === 'RECONTAGEM') return 'b-purple';
  return 'b-orange';
}
window.contStatusBadge = window.contStatusBadge || contStatusBadge;

// Resume o resultado final das rodadas (1ª/2ª/3ª contagem) de um endereço em
// um único badge, em vez de o endereço aparecer uma vez por rodada na lista
// de Contagens. Usa a mesma regra de avaliação da aba Recontagem, então os
// dois lugares sempre concordam sobre qual rodada "bateu".
function _resultadoRodadaEndereco(c){
  const motor = window.InventoryAddressState;
  if (!motor) return { texto:'⚠️ Status indisponível', cls:'b-orange' };
  const consolidado = motor.consolidate({ state: state(), record: c });
  const avaliacao = consolidado.avaliacao;
  if (avaliacao.estado === 'RESOLVIDA') {
    return { texto:`✅ OK ${Number(avaliacao.rodada || 1)}ª — total do endereço`, cls:'b-green' };
  }
  if (avaliacao.estado === 'PERSISTENTE') return { texto:'🔴 Persistente (3 rodadas)', cls:'b-red' };
  if (consolidado.segunda != null) return { texto:'⏳ Aguardando 3ª contagem', cls:'b-orange' };
  if (consolidado.contagens.length) return { texto:'❌ Divergente — aguardando recontagem', cls:'b-red' };
  return { texto:'⏳ Aguardando processamento', cls:'b-orange' };
}

// ───────────────────────────────────────────────────────────────────
//  14. RENDERIZAÇÃO — CONTAGENS
// ───────────────────────────────────────────────────────────────────

function renderContagens() {
  const motor=window.InventoryAddressState, selectors=window.InventoryAddressSelectors, view=window.InventoryAddressView;
  if(!motor||!selectors||!view) throw new Error('Motor consolidado de endereços não carregado');
  const busca=(document.getElementById('cont-busca')?.value||'').toLowerCase();
  const fInv=document.getElementById('cont-finv')?.value||'', fStatus=document.getElementById('cont-fstatus')?.value||'';
  const fRua=document.getElementById('cont-frua')?.value||'', fOp=document.getElementById('cont-foperador')?.value||'', fPeriodo=document.getElementById('cont-fperiodo')?.value||'';
  const fTipo=document.getElementById('cont-ftipo')?.value||'';
  const selInv=document.getElementById('cont-finv');
  if(selInv){const cur=selInv.value;selInv.innerHTML='<option value="">Todos os inventários</option>'+state().inventarios.map(i=>`<option value="${i.id}">${escHTML(i.codigo||i.id)} — ${escHTML(i.nome||'')}</option>`).join('');selInv.value=cur;}
  let dados=selectors.list(state()).filter(s=>s.primeira!=null);
  if(fInv) dados=dados.filter(s=>String(s.inventario_id)===String(fInv));
  if(fStatus) dados=dados.filter(s=>String(s.status).toUpperCase()===String(fStatus).toUpperCase());
  if(fRua) dados=dados.filter(s=>(getEnderecoInfo(s.endereco)?.rua||'—')===fRua);
  if(fOp) dados=dados.filter(s=>s.rodadas.some(r=>r?.operadores?.includes(fOp)));
  if(fTipo){const n=fTipo==='RECONTAGEM'?2:1;dados=dados.filter(s=>s.ultimaRodada?.numero>=n);}
  if(fPeriodo){const hoje=new Date();hoje.setHours(0,0,0,0);const ontem=new Date(hoje);ontem.setDate(ontem.getDate()-1);const set7=new Date(hoje);set7.setDate(set7.getDate()-7);dados=dados.filter(s=>{const d=s.atualizado_em?new Date(s.atualizado_em):null;if(!d||isNaN(d))return false;if(fPeriodo==='hoje')return d>=hoje;if(fPeriodo==='ontem')return d>=ontem&&d<hoje;if(fPeriodo==='7d')return d>=set7;return true;});}
  if(busca) dados=dados.filter(s=>[s.endereco,s.inventario?.codigo,s.inventario?.nome,view.latestOperator(s),view.itemsText(s.itens_esperados,'quantidade_esperada'),...s.rodadas.filter(Boolean).map(r=>view.itemsText(r.itens))].join(' ').toLowerCase().includes(busca));
  dados.sort((a,b)=>String(b.atualizado_em||'').localeCompare(String(a.atualizado_em||'')));
  window.__contagensVisiveis=dados.slice();
  const todos=selectors.list(state()).filter(s=>s.primeira!=null),setK=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  setK('ck-total',todos.length);setK('ck-processadas',todos.filter(s=>s.status==='RESOLVIDA').length);setK('ck-divergentes',todos.filter(s=>['DIVERGENTE','EM_RECONTAGEM','PERSISTENTE','SEM_BASE'].includes(s.status)).length);setK('ck-pendentes',todos.filter(s=>['DIVERGENTE','EM_RECONTAGEM','SEM_BASE'].includes(s.status)).length);setK('ck-recontagens',todos.filter(s=>s.segunda!=null||s.terceira!=null).length);
  const selRua=document.getElementById('cont-frua');if(selRua){const cur=selRua.value,ruas=[...new Set(todos.map(s=>getEnderecoInfo(s.endereco)?.rua||'—'))].sort();selRua.innerHTML='<option value="">Todas as ruas</option>'+ruas.map(r=>`<option value="${escHTML(r)}">${escHTML(r)}</option>`).join('');selRua.value=cur;}
  const selOp=document.getElementById('cont-foperador');if(selOp){const cur=selOp.value,ops=[...new Set(todos.flatMap(s=>s.rodadas.filter(Boolean).flatMap(r=>r.operadores)))].sort();selOp.innerHTML='<option value="">Todos os operadores</option>'+ops.map(o=>`<option value="${escHTML(o)}">${escHTML(o)}</option>`).join('');selOp.value=cur;}
  const wrap=document.getElementById('cont-table-wrap');if(!dados.length){wrap.innerHTML='<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma contagem encontrada</div></div>';return;}
  wrap.innerHTML=`<div class="tbl-wrap"><table><thead><tr><th>Última atualização</th><th>Operador(es)</th><th>Inventário</th><th>Endereço</th><th>Produtos esperados</th><th>Totais das rodadas</th><th>Última etapa</th><th>Status consolidado</th><th>Ações</th></tr></thead><tbody>${dados.map(s=>{const src=view.sourceRecord(s),end=getEnderecoInfo(s.endereco),id=src?.id||src?.uuid||'';return `<tr><td class="mono" style="white-space:nowrap;font-size:.75rem">${fmtTs(s.atualizado_em)}</td><td style="font-size:.8rem;font-weight:600">${escHTML(view.latestOperator(s))}</td><td style="font-size:.75rem">${escHTML(s.inventario?.codigo||s.inventario_id)}<div style="color:var(--muted)">${escHTML(s.inventario?.nome||'')}</div></td><td class="mono">${escHTML(s.endereco)}${end?.rua?`<div style="font-size:.65rem;color:var(--muted)">Rua ${escHTML(end.rua)}</div>`:''}</td><td>${view.itemsHtml(s.itens_esperados,'quantidade_esperada')}</td><td><div><b>Sistema:</b> <span class="mono">${view.fmt(s.esperado)}</span></div><div><b>1ª:</b> <span class="mono">${view.fmt(s.primeira)}</span></div><div><b>2ª:</b> <span class="mono">${view.fmt(s.segunda)}</span></div><div><b>3ª:</b> <span class="mono">${view.fmt(s.terceira)}</span></div></td><td><span class="badge b-blue">${escHTML(view.roundType(s))}</span></td><td><span class="badge ${view.statusBadge(s)}">${escHTML(view.statusLabel(s))}</span>${s.status==='SEM_BASE'?'<div style="font-size:.65rem;color:var(--danger)">Comparação bloqueada: total esperado ausente.</div>':''}</td><td>${id?`<button class="btn btn-danger btn-sm" onclick="abrirEstorno('${escHTML(id)}')">↩ Estornar</button>`:'—'}</td></tr>`;}).join('')}</tbody></table></div>`;
}

// Exporta exatamente as linhas atualmente exibidas na aba Contagens.
// A leitura original permanece no historico, mas os campos operacionais
// (produto, quantidade, operador e horario) usam a ultima rodada concluida.
function exportarContagens(){
  const view=window.InventoryAddressView,lista=Array.isArray(window.__contagensVisiveis)?window.__contagensVisiveis:[];
  if(!lista.length){showToast?.('Nenhuma contagem visível para exportar.','w');return;}
  const linhas=lista.map(s=>({
    'Inventário':s.inventario?.codigo||s.inventario_id,'Endereço':s.endereco,'Rua':getEnderecoInfo(s.endereco)?.rua||'',
    'Produtos esperados':view.itemsText(s.itens_esperados,'quantidade_esperada'),'Qtd sistema':s.esperado??'',
    '1ª contagem':s.primeira??'','Itens 1ª':view.itemsText(s.rodadas[0]?.itens),'Operador 1ª':s.rodadas[0]?.operadores?.join(', ')||'',
    '2ª contagem':s.segunda??'','Itens 2ª':view.itemsText(s.rodadas[1]?.itens),'Operador 2ª':s.rodadas[1]?.operadores?.join(', ')||'',
    '3ª contagem':s.terceira??'','Itens 3ª':view.itemsText(s.rodadas[2]?.itens),'Operador 3ª':s.rodadas[2]?.operadores?.join(', ')||'',
    'Status consolidado':view.statusLabel(s),'Última atualização':s.atualizado_em||''
  }));
  _exportarXlsxAnalista('contagens-consolidadas.xlsx','Contagens',linhas);
}
window.exportarContagens = exportarContagens;

// ───────────────────────────────────────────────────────────────────
//  15. RENDERIZAÇÃO — PENDÊNCIAS
// ───────────────────────────────────────────────────────────────────

function renderPendencias() {
  const selInv = document.getElementById('pend-sel-inv');
  const busca  = (document.getElementById('pend-busca')?.value || '').toLowerCase();
  const fStatus= document.getElementById('pend-fstatus')?.value || '';
  const fLocal = document.getElementById('pend-flocal')?.value || '';
  const fRua   = document.getElementById('pend-frua')?.value || '';
  const invId  = selInv?.value || '';

  // Preencher select de inventários
  if (selInv) {
    const cur = selInv.value;
    selInv.innerHTML = '<option value="">Selecione um inventário...</option>' +
      state().inventarios.filter(i => ['ATIVO','ABERTO','PUBLICADO','LIBERADO','EM_ANDAMENTO','PAUSADO'].includes(String(i.status||'').toUpperCase()) || i.enderecos_selecionados?.length).map(i =>
        `<option value="${i.id}" ${i.id === cur ? 'selected' : ''}>${i.codigo} — ${i.nome}</option>`
      ).join('');
    if (cur) selInv.value = cur;
  }

  if (!invId) {
    document.getElementById('pend-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Selecione um inventário</div></div>`;
    ['pk-total','pk-contados','pk-pendentes','pk-pct'].forEach(id => document.getElementById(id).textContent = '—');
    return;
  }

  const inv = getInventarioPorId(invId);
  if (!inv) return;

  // Usar state().enderecosLista como base oficial de endereços
  const conts   = (state().contagens || []).filter(c => String(c.inventario_id || c.inventarioId || '') === String(invId) && !c._excluida && c.status !== 'ESTORNADA');
  const endsContadosSet = new Set(conts.filter(c => !_isVazio(c)).map(c => c.endereco));
  const endsVaziosConfSet = new Set(conts.filter(c => _isVazio(c) && c.status !== 'ESTORNADA').map(c => c.endereco));

  // Usar somente os endereços pertencentes ao inventário selecionado.
  const selecionados = Array.isArray(inv.enderecos_selecionados) ? inv.enderecos_selecionados : [];
  const selecionadosSet = new Set(selecionados.map(x => String(typeof x === 'string' ? x : (x.endereco || x.id || ''))).filter(Boolean));
  const baseInventario = selecionadosSet.size
    ? (state().enderecosLista || []).filter(e => selecionadosSet.has(String(e.endereco || e.id || '')))
    : (Array.isArray(inv.base) && inv.base.length ? inv.base : (state().enderecosLista || []));

  // Enriquecer a base do inventário com status de contagem
  const lista = baseInventario.map(e => {
    const endInfo  = e; // já é o objeto completo do ENDDB
    const contado  = endsContadosSet.has(e.endereco);
    const vazioConf = endsVaziosConfSet.has(e.endereco);
    const inativo  = e.ativo === false;
    const cap      = e.capacidade_paletes ?? null;
    const usados   = getPaletesUsados(invId, e.endereco);
    const limiteTingido = !inativo && cap !== null && cap > 0 && usados >= cap;

    let status_pend;
    if (contado)             status_pend = 'CONTADO';
    else if (vazioConf)      status_pend = 'VAZIO_CONFIRMADO';
    else if (inativo)        status_pend = 'INATIVO';
    else if (limiteTingido)  status_pend = 'LIMITE_ATINGIDO';
    else                     status_pend = 'PENDENTE';

    return { ...e, contado, vazioConf, inativo, limiteTingido, usados, status_pend };
  });

  // Filtro de locais
  const locFlt = document.getElementById('pend-flocal');
  if (locFlt) {
    const locais = [...new Set(lista.map(e => e.setor || '—'))].sort();
    locFlt.innerHTML = '<option value="">Todos os locais</option>' + locais.map(l => `<option value="${l}" ${l === fLocal ? 'selected' : ''}>${l}</option>`).join('');
  }

  // Filtro de ruas
  const ruaFlt = document.getElementById('pend-frua');
  if (ruaFlt) {
    const ruas = [...new Set(lista.map(e => e.rua || extrairRua(e.endereco) || '—'))].sort((a,b) => a.localeCompare(b,'pt-BR',{numeric:true}));
    ruaFlt.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(r => `<option value="${r}" ${r === fRua ? 'selected' : ''}>Rua ${r}</option>`).join('');
  }

  // Filtros
  let filtrado = lista;
  if (fStatus) filtrado = filtrado.filter(e => e.status_pend === fStatus);
  if (fLocal)  filtrado = filtrado.filter(e => (e.setor || '—') === fLocal);
  if (fRua)    filtrado = filtrado.filter(e => (e.rua || extrairRua(e.endereco) || '—') === fRua);
  if (busca)   filtrado = filtrado.filter(e =>
    e.endereco.toLowerCase().includes(busca) ||
    (e.setor || '').toLowerCase().includes(busca) ||
    (e.rua || extrairRua(e.endereco) || '').toLowerCase().includes(busca)
  );

  // KPIs — conferidos = contados + vazios_confirmados (ambos saem das pendências)
  const total        = lista.length;
  const contados     = lista.filter(e => e.status_pend === 'CONTADO').length;
  const vaziosConf   = lista.filter(e => e.status_pend === 'VAZIO_CONFIRMADO').length;
  const conferidos   = contados + vaziosConf;
  const pendentes    = lista.filter(e => e.status_pend === 'PENDENTE').length;
  const inativos     = lista.filter(e => e.status_pend === 'INATIVO').length;
  const limiteAting  = lista.filter(e => e.status_pend === 'LIMITE_ATINGIDO').length;
  const elegíveis    = total - inativos;  // base real para % de progresso
  const pct          = elegíveis > 0 ? Math.round((conferidos / elegíveis) * 100) : 0;

  document.getElementById('pk-total').textContent    = total.toLocaleString('pt-BR');
  document.getElementById('pk-contados').textContent  = `${conferidos.toLocaleString('pt-BR')}${vaziosConf > 0 ? ` (${vaziosConf} vaz.)` : ''}`;
  document.getElementById('pk-pendentes').textContent = `${pendentes} + ${limiteAting}🔒`;
  document.getElementById('pk-pct').textContent       = pct + '%';

  if (!filtrado.length) {
    document.getElementById('pend-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Nenhum endereço encontrado com esses filtros</div></div>`;
  } else {

  const statusLabel = {
    CONTADO:          { cls: 'b-green',   txt: '✓ Contado' },
    VAZIO_CONFIRMADO: { cls: 'b-gray',    txt: '🔲 Vazio' },
    PENDENTE:         { cls: 'b-yellow',  txt: '⏳ Pendente' },
    INATIVO:          { cls: 'b-gray',    txt: '⛔ Inativo' },
    LIMITE_ATINGIDO:  { cls: 'b-blocked', txt: '🔒 Limite' },
  };

  document.getElementById('pend-table-wrap').innerHTML = `
    ${inativos > 0 ? `<div class="alert warn" style="margin:12px 16px 0;border-radius:8px">⛔ ${inativos} endereço(s) inativo(s) não serão contabilizados no progresso.</div>` : ''}
    ${limiteAting > 0 ? `<div class="alert warn" style="margin:8px 16px 0;border-radius:8px">🔒 ${limiteAting} endereço(s) com limite de paletes atingido.</div>` : ''}
    <div class="tbl-wrap"><table>
      <thead><tr><th>Endereço</th><th>Local/Área</th><th>Rua</th><th>Nível</th><th>Tipo</th><th>Paletes (usados/cap)</th><th>Status</th></tr></thead>
      <tbody>
        ${filtrado.map(e => {
          const s = statusLabel[e.status_pend] || { cls:'b-gray', txt: e.status_pend };
          const cap = e.capacidade_paletes !== null ? String(e.capacidade_paletes) : '∞';
          return `<tr style="${e.inativo || e.limiteTingido ? 'opacity:.6' : ''}">
            <td class="mono">${e.endereco}</td>
            <td>${e.setor || '—'}</td>
            <td>${e.rua || '—'}</td>
            <td>${e.nivel || '—'}</td>
            <td>${e.tipo || '—'}</td>
            <td class="mono" style="font-weight:700;color:${e.limiteTingido?'var(--danger)':'inherit'}">${e.usados}/${cap}</td>
            <td><span class="badge ${s.cls}">${s.txt}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  // Update end count display
  const endCountEl = document.getElementById('pend-end-count');
  if (endCountEl) endCountEl.textContent = `${pendentes} endereço(s) aguardando de ${total} total`;

  // ── SEÇÃO: Recontagens pendentes ──────────────────────────────────
  const recPend = (state().recontagens || []).filter(r => String(r.inventario_id || r.inventarioId || '') === String(invId) && String(r.status || '').toUpperCase() === 'PENDENTE');
  const recSec = document.getElementById('pend-rec-section');
  const pkRecPend = document.getElementById('pk-rec-pend');
  if (pkRecPend) pkRecPend.textContent = recPend.length.toLocaleString('pt-BR');
  if (recSec) {
    if (recPend.length > 0) {
      recSec.style.display = '';
      document.getElementById('pend-rec-count').textContent = `${recPend.length} recontagem(ns) pendente(s)`;
      document.getElementById('pend-rec-wrap').innerHTML = `
        <div class="tbl-wrap"><table>
          <thead><tr><th>Endereço</th><th>Produto</th><th>Qtd Sistema</th><th>1ª Contagem</th><th>Diferença</th><th>Ação</th></tr></thead>
          <tbody>
            ${recPend.slice(0,10).map(r => {
              const diff = r.qtd_primeira - r.qtd_esperada;
              return `<tr>
                <td class="mono">${r.endereco}</td>
                <td style="font-size:.82rem">${r.produto}</td>
                <td class="mono">${r.qtd_esperada}</td>
                <td class="mono" style="color:var(--danger);font-weight:700">${r.qtd_primeira}</td>
                <td class="mono" style="font-weight:800;color:${diff>0?'var(--warn)':'var(--danger)'}">
                  ${diff>0?'+':''}${diff}
                </td>
                <td><button class="btn btn-primary btn-sm" onclick="abrirRegistrarRecontagem('${r.id}')">📝 Registrar</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
        ${recPend.length > 10 ? `<div style="padding:8px 16px;font-size:.75rem;color:var(--muted)">... e mais ${recPend.length-10}. Veja a aba Recontagem.</div>` : ''}`;
    } else {
      recSec.style.display = 'none';
    }
  }

  // ── SEÇÃO: Divergências abertas ──────────────────────────────────
  const divAbertas = (state().divergencias || []).filter(d => String(d.inventario_id || d.inventarioId || '') === String(invId) && ['ABERTA','DIVERGENTE','PENDENTE','PERSISTENTE','EM_RECONTAGEM'].includes(String(d.status || '').toUpperCase()));
  const divSec = document.getElementById('pend-div-section');
  const pkDivAbertas = document.getElementById('pk-div-abertas');
  if (pkDivAbertas) pkDivAbertas.textContent = divAbertas.length.toLocaleString('pt-BR');
  if (divSec) {
    if (divAbertas.length > 0) {
      divSec.style.display = '';
      document.getElementById('pend-div-count').textContent = `${divAbertas.length} divergência(s) aberta(s)`;
      document.getElementById('pend-div-wrap').innerHTML = `
        <div class="tbl-wrap"><table>
          <thead><tr><th>Endereço</th><th>Produto</th><th>Qtd Sistema</th><th>Qtd Contada</th><th>Diferença</th><th>Status</th></tr></thead>
          <tbody>
            ${divAbertas.slice(0,10).map(d => {
              const difColor = d.diferenca > 0 ? 'var(--warn)' : 'var(--danger)';
              return `<tr>
                <td class="mono">${escHTML(d.endereco)}</td>
                <td style="font-size:.82rem">${escHTML(d.produto)}</td>
                <td class="mono">${d.qtd_esperada}</td>
                <td class="mono" style="font-weight:700;color:${d.qtd_contada<d.qtd_esperada?'var(--danger)':'var(--warn)'}">${d.qtd_contada}</td>
                <td class="mono" style="font-weight:800;color:${difColor}">${d.diferenca>0?'+':''}${d.diferenca}</td>
                <td><span class="badge ${d.status === 'EM_RECONTAGEM' ? 'b-orange' : 'b-red'}">${d.status === 'EM_RECONTAGEM' ? 'Em Recontagem' : 'Aberta'}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
        ${divAbertas.length > 10 ? `<div style="padding:8px 16px;font-size:.75rem;color:var(--muted)">... e mais ${divAbertas.length-10}. Veja a aba Recontagem.</div>` : ''}`;
    } else {
      divSec.style.display = 'none';
    }
  }
}
