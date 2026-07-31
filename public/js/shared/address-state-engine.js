(function (global) {
  'use strict';

  const EPSILON = 1e-9;
  const CLOSED = new Set(['CANCELADA','CANCELADO','EXCLUIDA','EXCLUIDO','ESTORNADA','ESTORNADO']);
  const text = value => String(value == null ? '' : value).trim().toUpperCase();
  const number = value => {
    if (value == null || String(value).trim() === '') return null;
    const raw = String(value).trim().replace(/\s/g, '');
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const qty = value => number(value) ?? 0;
  const same = (a,b) => a != null && b != null && Math.abs(a-b) < EPSILON;
  const address = row => text(row?.endereco);
  const timestamp = row => String(row?.atualizado_em || row?.finalizada_em || row?.recontagem_concluida_em || row?.concluida_em || row?.timestamp || row?.criado_em || row?.dataHora || '');
  const rawInventoryId = row => String(row?.inventario_id ?? row?.inventarioId ?? row?.inventario ?? row?.inv_id ?? '').trim();
  const aliases = inv => [inv?.id,inv?.codigo,inv?.nome,inv?.inventario_id,inv?.inventarioId].filter(Boolean).map(String);
  const canonicalInventoryId = (row,inventories) => {
    const raw=rawInventoryId(row);
    const found=(inventories||[]).find(inv=>aliases(inv).includes(raw));
    return String(found?.id || raw);
  };
  const isClosed = row => CLOSED.has(text(row?.status)) || CLOSED.has(text(row?.status_recontagem)) || row?._excluida === true;
  const isRecountReading = row => text(row?.tipo_contagem) === 'RECONTAGEM';
  const productCode = row => text(row?.codigo_produto ?? row?.codigoProduto ?? row?.codigo_interno ?? row?.sku ?? row?.gtin ?? row?.gtinLido ?? row?.produto ?? row?.produto_recontagem ?? row?.ean ?? row?.dun ?? 'SEM_PRODUTO');
  const productDescription = row => String(row?.descricao_produto || row?.descricao || row?.nome_produto || '').trim();
  const palletId = row => String(row?.palete_id ?? row?.pallet_id ?? row?.palete ?? row?.pallet ?? row?.numero_palete ?? row?.capa_palete ?? '').trim();

  function uniqueOperationalRows(rows) {
    const seen=new Set();
    return (rows||[]).filter((row,index)=>{
      const explicit=String(row?.uuid || row?.id || row?.contagem_uuid || row?.recontagem_id || row?.divergencia_id || '').trim();
      // Só deduplica por identidade explícita. Linhas iguais sem ID podem ser pallets reais distintos.
      if(!explicit) return true;
      const key=explicit;
      if(seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  function expectedQuantity(row) {
    return row?.quantidade_esperada ?? row?.quantidadeEsperada ?? row?.qtd_esperada ?? row?.qtdEsperada ?? row?.quantidade_sistema ?? row?.quantidadeSistema ?? row?.quantidade_enderecada ?? row?.qtd_enderecada ?? row?.saldo_estoque ?? row?.saldo ?? row?.saldo_erp ?? row?.qtd_sistema ?? row?.qtd_estoque ?? row?.estoque_total ?? row?.estoque ?? row?.quantidade ?? row?.qtd ?? row?.qtde;
  }
  function readingQuantity(row) { return row?.quantidade ?? row?.qtd_caixas ?? row?.qtd_contada ?? row?.qtd_primeira ?? row?.qtd; }
  function recountQuantity(row,round) { return round===1 ? (row?.qtd_segunda ?? row?.qtd_recontagem ?? row?.quantidade ?? row?.qtd) : (row?.qtd_terceira ?? row?.qtd_recontagem ?? row?.quantidade ?? row?.qtd); }

  function groupItems(rows, quantityGetter) {
    const grouped=new Map();
    (rows||[]).forEach(row=>{
      const code=productCode(row);
      const amount=number(quantityGetter(row));
      if(amount==null) return;
      const current=grouped.get(code) || {codigo_produto:code,descricao_produto:productDescription(row),quantidade:0,paletes:[],registros:0};
      current.quantidade += amount;
      current.registros += 1;
      const pallet=palletId(row);
      if(pallet && !current.paletes.includes(pallet)) current.paletes.push(pallet);
      if(!current.descricao_produto) current.descricao_produto=productDescription(row);
      grouped.set(code,current);
    });
    return [...grouped.values()].sort((a,b)=>a.codigo_produto.localeCompare(b.codigo_produto));
  }

  function snapshotExpected(inventory,targetAddress) {
    const target=text(targetAddress);
    const baseRows=(inventory?.base||[]).filter(row=>address(row)===target);
    const seenIds=new Set();
    const valid=baseRows.filter(row=>{
      const explicit=String(row?.id || row?.uuid || row?.base_id || row?.registro_id || '').trim();
      if(!explicit) return true;
      if(seenIds.has(explicit)) return false;
      seenIds.add(explicit); return true;
    });
    return groupItems(valid, expectedQuantity).map(item=>({
      codigo_produto:item.codigo_produto,
      descricao_produto:item.descricao_produto,
      quantidade_esperada:item.quantidade,
      quantidade_paletes_base:item.registros,
      paletes:item.paletes
    }));
  }

  function roundSnapshot(rows, quantityGetter, n) {
    const clean=uniqueOperationalRows(rows).filter(r=>number(quantityGetter(r))!=null);
    if(!clean.length) return null;
    const items=groupItems(clean,quantityGetter);
    const operators=[...new Set(clean.map(r=>String(r?.operador_recontagem || r?.operador || r?.operador_nome || '').trim()).filter(Boolean))];
    const dates=clean.map(timestamp).filter(Boolean).sort();
    return Object.freeze({numero:n,total:items.reduce((t,i)=>t+i.quantidade,0),itens:items,operadores:operators,data:dates[dates.length-1]||null,registros:clean.length,origens:clean});
  }

  function evaluateTotals(expected,first,second,third) {
    if(expected==null) return Object.freeze({estado:'SEM_BASE',referencia:'TOTAL_ESPERADO_INDISPONIVEL',rodada:0,resultado:null,rodadasQueBateram:[],esperado:null,fluxoConsolidado:true});
    const rounds=[{n:1,v:first},{n:2,v:second},{n:3,v:third}];
    const matched=rounds.filter(r=>same(r.v,expected)).map(r=>r.n);
    const hit=rounds.find(r=>same(r.v,expected));
    if(hit) return Object.freeze({estado:'RESOLVIDA',referencia:`OK_${hit.n}_TOTAL_ENDERECO`,rodada:hit.n,resultado:{qtd:hit.v,produto:'TOTAL_ENDERECO'},rodadasQueBateram:matched,esperado:expected,fluxoConsolidado:true});
    if(first==null) return Object.freeze({estado:'AGUARDANDO_CONTAGEM',referencia:null,rodada:0,resultado:null,rodadasQueBateram:matched,esperado:expected,fluxoConsolidado:true});
    if(third!=null) return Object.freeze({estado:'PERSISTENTE',referencia:'TERCEIRA_DIVERGENTE_TOTAL_ENDERECO',rodada:3,resultado:{qtd:third,produto:'TOTAL_ENDERECO'},rodadasQueBateram:matched,esperado:expected,fluxoConsolidado:true});
    return Object.freeze({estado:'AGUARDANDO_RECONTAGEM',referencia:null,rodada:second!=null?2:1,resultado:{qtd:second??first,produto:'TOTAL_ENDERECO'},rodadasQueBateram:matched,esperado:expected,fluxoConsolidado:true});
  }

  function consolidate(input) {
    const state=input?.state||{}, inventories=state.inventarios||[];
    const source=input?.record||{inventario_id:input?.inventarioId,endereco:input?.endereco};
    const invId=canonicalInventoryId(source,inventories), targetAddress=address(source);
    const sameAddress=row=>canonicalInventoryId(row,inventories)===invId && address(row)===targetAddress;
    const inventory=inventories.find(inv=>String(inv?.id)===invId || aliases(inv).includes(invId))||null;
    const expectedItems=snapshotExpected(inventory,targetAddress);
    const counts=uniqueOperationalRows((state.contagens||[]).filter(row=>sameAddress(row)&&!isClosed(row)));
    const divergences=uniqueOperationalRows((state.divergencias||[]).filter(row=>sameAddress(row)&&!isClosed(row)));
    const recountDocs=uniqueOperationalRows((state.recontagens||[]).filter(row=>sameAddress(row)&&!isClosed(row)));

    let expected=expectedItems.length ? expectedItems.reduce((t,i)=>t+qty(i.quantidade_esperada),0) : null;
    if(expected==null) expected=divergences.map(d=>number(d?.qtd_esperada ?? d?.quantidade_esperada)).find(v=>v!=null) ?? number(source?.qtd_esperada);

    const firstRows=counts.filter(row=>!isRecountReading(row));
    let round1=roundSnapshot(firstRows,readingQuantity,1);
    if(!round1) round1=roundSnapshot(divergences,r=>r?.qtd_primeira ?? r?.qtd_contada,1);

    function recountRound(round) {
      const readings=counts.filter(isRecountReading).filter(r=>Number(r?.numero_recontagem||1)===round);
      const fromReadings=roundSnapshot(readings,readingQuantity,round+1);
      if(fromReadings) return fromReadings;
      const docs=recountDocs.filter(r=>Number(r?.numero_recontagem||1)===round);
      const fromDocs=roundSnapshot(docs,r=>recountQuantity(r,round),round+1);
      if(fromDocs) return fromDocs;
      return roundSnapshot(divergences,r=>round===1?r?.qtd_segunda:r?.qtd_terceira,round+1);
    }
    const round2=recountRound(1), round3=recountRound(2);
    const evaluation=evaluateTotals(expected,round1?.total??null,round2?.total??null,round3?.total??null);
    const status=evaluation.estado==='RESOLVIDA'?'RESOLVIDA':evaluation.estado==='PERSISTENTE'?'PERSISTENTE':evaluation.estado==='SEM_BASE'?'SEM_BASE':evaluation.estado==='AGUARDANDO_CONTAGEM'?'PENDENTE':(round2?'EM_RECONTAGEM':'DIVERGENTE');
    const all=[...counts,...divergences,...recountDocs];
    return Object.freeze({
      chave:`${invId}|${targetAddress}`,inventario_id:invId,inventario:inventory,endereco:targetAddress,
      esperado:expected,primeira:round1?.total??null,segunda:round2?.total??null,terceira:round3?.total??null,
      rodadas:Object.freeze([round1,round2,round3]),ultimaRodada:round3||round2||round1||null,
      status,status_recontagem:evaluation.estado==='RESOLVIDA'?'sem_divergencia':evaluation.estado==='PERSISTENTE'?'persistente':evaluation.estado==='SEM_BASE'?'sem_base':(round2?'aguardando_analista':'aguardando_recontagem'),
      divergente:evaluation.estado!=='RESOLVIDA',precisa_recontagem:['AGUARDANDO_RECONTAGEM'].includes(evaluation.estado),avaliacao:evaluation,
      itens_esperados:expectedItems,contagens:counts,divergencias:divergences,recontagens:recountDocs,
      atualizado_em:all.map(timestamp).filter(Boolean).sort().pop()||null
    });
  }

  function decorate(record,state) { const s=consolidate({state,record}); return Object.assign({},record,{_estado_endereco:s,status:s.status,status_recontagem:s.status_recontagem,divergente:s.divergente,precisa_recontagem:s.precisa_recontagem,qtd_esperada:s.esperado,qtd_primeira:s.primeira,qtd_segunda:s.segunda,qtd_terceira:s.terceira}); }
  function list(state) {
    const rows=[...(state?.contagens||[]),...(state?.divergencias||[]),...(state?.recontagens||[])], inventories=state?.inventarios||[], keys=new Map();
    rows.filter(r=>!isClosed(r)&&address(r)).forEach(r=>{const k=`${canonicalInventoryId(r,inventories)}|${address(r)}`;if(!keys.has(k))keys.set(k,r);});
    return [...keys.values()].map(record=>consolidate({state,record}));
  }
  function fromHistory(h) { return evaluateTotals(number(h?.qtd_esperada),number(h?.qtd_primeira??h?.qtd_contada),number(h?.qtd_segunda??h?.qtd_recontagem),number(h?.qtd_terceira)); }

  // Fotografia operacional canônica. O histórico preserva todas as rodadas,
  // mas tela, totais e exportações recebem somente a rodada concluída mais
  // recente de cada inventário/endereço. Uma recontagem nunca é somada à
  // primeira contagem: ela a substitui integralmente, inclusive quando possui
  // menos paletes.
  function physicalRound(row) {
    return isRecountReading(row) ? Math.min(3, 1 + Math.max(1, Number(row?.numero_recontagem || 1))) : 1;
  }
  function recountCompleted(row,state) {
    if(physicalRound(row)===1) return true;
    const status=text(row?.status_recontagem || row?.status);
    if(['CANCELADA','CANCELADO','EXCLUIDA','EXCLUIDO','ESTORNADA','ESTORNADO','PENDENTE','ATRIBUIDA','ATRIBUÍDA','EM_ANDAMENTO','ABERTA'].includes(status)) return false;
    const rid=String(row?.recontagem_id || '').trim(), did=String(row?.divergencia_id || '').trim();
    const round=Math.max(1,Number(row?.numero_recontagem || 1));
    const task=(state?.recontagens||[]).find(rec=>{
      if(rid && String(rec?.id||rec?.recontagem_id||'')===rid) return true;
      if(did && String(rec?.divergencia_id||'')===did && Number(rec?.numero_recontagem||round)===round) return true;
      return canonicalInventoryId(rec,state?.inventarios||[])===canonicalInventoryId(row,state?.inventarios||[]) &&
        address(rec)===address(row) && Number(rec?.numero_recontagem||0)===round;
    });
    const source=task||row, taskStatus=text(source?.status_recontagem||source?.status);
    if(['CANCELADA','CANCELADO','EXCLUIDA','EXCLUIDO','ESTORNADA','ESTORNADO','PENDENTE','ATRIBUIDA','ATRIBUÍDA','EM_ANDAMENTO','ABERTA'].includes(taskStatus)) return false;
    return Boolean(source?.recontagem_concluida_em||source?.concluida_em||source?.finalizada_em||source?.data_segunda||source?.data_terceira) ||
      ['CONCLUIDA','CONCLUÍDA','FINALIZADA','PROCESSADA','RESOLVIDA','AGUARDANDO_ANALISTA','SEM_DIVERGENCIA'].includes(taskStatus);
  }
  function physicalPalletKey(row,index) {
    const pallet=text(row?.palete??row?.pallet??row?.numero_palete??row?.numeroPalete??row?.palete_key??row?.capa_palete??row?.capa??row?.sscc);
    if(pallet) return `PAL:${pallet}`;
    const explicit=String(row?.uuid||row?.id||row?.contagem_uuid||'').trim();
    if(explicit) return `DOC:${explicit}`;
    return `LINHA:${productCode(row)}|${readingQuantity(row)??''}|${timestamp(row)||index}`;
  }
  function latestPhysicalRows(state,inventoryId) {
    const inventories=state?.inventarios||[], groups=new Map();
    (state?.contagens||[]).forEach((row,index)=>{
      if(isClosed(row)||!address(row)||!recountCompleted(row,state)) return;
      const inv=canonicalInventoryId(row,inventories);
      if(inventoryId && inv!==canonicalInventoryId({inventario_id:inventoryId},inventories)) return;
      const key=`${inv}|${address(row)}`;
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push({row,index,round:physicalRound(row)});
    });
    const output=[];
    groups.forEach(entries=>{
      const latest=Math.max(...entries.map(entry=>entry.round));
      const unique=new Map();
      entries.filter(entry=>entry.round===latest).forEach(entry=>{
        const key=physicalPalletKey(entry.row,entry.index), previous=unique.get(key);
        if(!previous || timestamp(entry.row)>=timestamp(previous)) unique.set(key,entry.row);
      });
      unique.forEach(row=>output.push(row));
    });
    return output;
  }

  global.InventoryAddressState=Object.freeze({consolidate,decorate,list,evaluateTotals,fromHistory,snapshotExpected,latestPhysicalRows,number,text});
})(window);
