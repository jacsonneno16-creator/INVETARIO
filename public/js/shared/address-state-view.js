(function(global){
  'use strict';
  const esc=v=>typeof global.escHTML==='function'?global.escHTML(String(v??'')):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>v==null?'—':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(v);
  const labels={RESOLVIDA:'✅ Resolvida',DIVERGENTE:'❌ Divergente',EM_RECONTAGEM:'🔄 Em recontagem',PERSISTENTE:'🔴 Persistente',SEM_BASE:'⚠️ Sem base esperada',PENDENTE:'⏳ Pendente'};
  const badges={RESOLVIDA:'b-green',DIVERGENTE:'b-red',EM_RECONTAGEM:'b-orange',PERSISTENTE:'b-red',SEM_BASE:'b-orange',PENDENTE:'b-yellow'};
  function statusLabel(s){return labels[s?.status]||s?.status||'—';}
  function statusBadge(s){return badges[s?.status]||'b-gray';}
  function itemsText(items,field){return (items||[]).map(i=>`${i.codigo_produto}: ${fmt(i[field||'quantidade'])}`).join(' | ')||'—';}
  function itemsHtml(items,field){
    if(!(items||[]).length) return '<span style="color:var(--muted-2)">—</span>';
    return items.map(i=>`<div style="margin-bottom:4px"><strong>${esc(i.codigo_produto)}</strong>${i.descricao_produto?` — ${esc(i.descricao_produto)}`:''}<div class="mono" style="font-size:.72rem">Qtd ${fmt(i[field||'quantidade'])}${i.paletes?.length?` · Pallets: ${esc(i.paletes.join(', '))}`:''}</div></div>`).join('');
  }
  function roundHtml(round,expected){
    if(!round) return '<span style="color:var(--muted-2)">—</span>';
    const ok=expected!=null && Math.abs(round.total-expected)<1e-9;
    return `<div style="${ok?'background:rgba(34,197,94,.10);padding:5px;border-radius:6px':''}">${ok?'✅ ':''}<strong class="mono">${fmt(round.total)}</strong><div style="font-size:.67rem;color:var(--muted)">${esc(round.operadores.join(', ')||'Operador não informado')}</div>${round.itens.length>1?`<details><summary style="font-size:.66rem;cursor:pointer">Itens (${round.itens.length})</summary>${itemsHtml(round.itens)}</details>`:''}</div>`;
  }
  function latestOperator(s){return s?.ultimaRodada?.operadores?.join(', ')||'—';}
  function roundType(s){return s?.ultimaRodada?`${s.ultimaRodada.numero}ª contagem`:'—';}
  function sourceRecord(s){return s?.contagens?.[0]||s?.divergencias?.[0]||s?.recontagens?.[0]||null;}
  global.InventoryAddressView=Object.freeze({fmt,statusLabel,statusBadge,itemsText,itemsHtml,roundHtml,latestOperator,roundType,sourceRecord});
})(window);
