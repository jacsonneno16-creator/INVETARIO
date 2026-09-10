// Produção — Realizado V341. Apontamento sincronizado com detalhe horário,
// sequência, observações, liberação, conclusão/reabertura e Excel.
(function(global){'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CREG='producao_registros',CAP='producao_apontamentos',CAP_LEGACY='apontamentos_producao',CPROC='producao_processos',CPCP='pcp_solicitacoes_producao_global';const PROC_TIPOS=['mistura','descanso','envase','etiquetagem','embalagem','pesagem','limpeza','inspecao','outro'];let pfData='',pfTipo='',pfBusca='';const DL=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];const HORAS=Array.from({length:17},(_,i)=>7+i);
// PCP (fase 5) — quando uma OP vinculada a uma solicitação do PCP muda de
// status aqui, o mesmo status é refletido na solicitação global (coleção
// raiz, por isso usa o Firestore "cru", sem o namespace por loja).
const PCP_STATUS_MAP={em_producao:'em_producao',concluido:'produzida'};
async function syncPCP(r,novoStatus){if(!r||!r.pcpSolicitacaoId)return;const st=PCP_STATUS_MAP[novoStatus];if(!st)return;const raw=global.getDTRawFirestore();const agora=new Date().toISOString(),autor=global._currentAnalistaUser?.email||'';const campos=st==='em_producao'?{producaoIniciadaEm:agora,producaoIniciadaPor:autor}:{produzidoEm:agora,produzidoPor:autor};await raw.collection(CPCP).doc(r.pcpSolicitacaoId).set({status:st,...campos,atualizadoEm:agora},{merge:true}).catch(e=>console.warn('[realizado] syncPCP:',e));}
let regs=[],aps=[],procs=[],carregado=false,weekStart=domingo(new Date()),fMaq='',fProd='',fStatus='',salvando=new Set();
// PEDIDO AO VIVO (comparação com o original achou faltando): lá a
// navegação é dia-a-dia (aba por dia da semana + "Produção Dia"/"Total da
// Semana"), não uma grade única com os 7 dias sempre visíveis juntos.
// diaAtivo='' = grade da semana inteira (comportamento que já existia,
// intocado); diaAtivo=uma data ISO = mostra só aquele dia, agrupado por
// máquina — reaproveita salvar()/bloqueio() exatamente como estão.
let diaAtivo='';
// PEDIDO AO VIVO (usuário: "processos produtivos... se ele tá pra
// aparecer só quando..." — o original tem DUAS sub-abas reais dentro de
// Realizado, "Apontamentos" e "Processos", que se escondem uma à outra —
// nunca as duas juntas na tela ao mesmo tempo. Antes eu deixava
// Processos sempre empilhado embaixo da tabela principal; agora vira
// aba própria, escondida até o usuário clicar nela.
let abaRealizado='apontamentos';
function statusNorm(v){const x=String(v||'programado').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ -]+/g,'_');if(['concluido','concluida','finalizado','finalizada','produzida'].includes(x))return 'concluido';if(['em_producao','producao','iniciado','iniciada'].includes(x))return 'em_producao';return x||'programado';}
function regNorm(id,d){d=d||{};return {_id:id,...d,data:d.data||d.dtDesejada||d.dtSolicitacao||'',produto:d.produto||d.descricao||d.descProduto||'',maquina:d.maquina||d.maquinaPadrao||'',qntCaixas:n(d.qntCaixas??d.quantidadeCaixas??d.qtdCaixas??d.quantidade),unidPorCx:n(d.unidPorCx??d.unidadesPorCaixa??d.unPorCx)||1,status:statusNorm(d.status)};}
function aponNorm(id,d){d=d||{};const horas=(d.horas&&typeof d.horas==='object')?d.horas:{};let q=n(d.qntCaixas??d.quantidade??d.realizadoCaixas);if(!q&&Object.keys(horas).length)q=Object.values(horas).reduce((s,v)=>s+n(v),0);return {_id:id,...d,registroId:d.registroId||d.registro_id||d.opId||'',data:String(d.data||d.date||'').slice(0,10),qntCaixas:q,qntUnid:n(d.qntUnid??d.quantidadeUnidades),horas,observacao:d.observacao||d.obs||''};}
function fs(){return global.getDTFirestore();}function pode(){return typeof global.temPermissao!=='function'||global.temPermissao('producao-realizado','editar');}function domingo(d){const x=new Date(d);x.setHours(0,0,0,0);const dia=x.getDay();x.setDate(x.getDate()-(dia===0?6:dia-1));return x;}function iso(d){return d.toISOString().slice(0,10);}function dias(){return Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return d;});}function fmt(d){return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});}function n(v){return Number(v)||0;}function apon(id,data){return aps.find(a=>a.registroId===id&&a.data===data);}function total(id){return aps.filter(a=>a.registroId===id).reduce((s,a)=>s+n(a.qntCaixas),0);}function totalSem(id,ds){return aps.filter(a=>a.registroId===id&&ds.includes(a.data)).reduce((s,a)=>s+n(a.qntCaixas),0);}
// PEDIDO AO VIVO (comparação com o original: dias sem jornada configurada
// — normalmente Dom/Sáb — não aparecem como aba de dia). Usa a mesma
// jornada geral de 77-producao-config.js (global.PRODUCAO_JORNADA[0..6],
// index 0=Dom...6=Sáb, igual DL).
function horasNoDia(d){const j=global.PRODUCAO_JORNADA;return Array.isArray(j)?n(j[d.getDay()]):0;}function diasUteis(){return dias().filter(d=>horasNoDia(d)>0);}
function diaFinalizacao(id,needed){const linhasAp=aps.filter(a=>a.registroId===id).sort((a,b)=>a.data.localeCompare(b.data));let acc=0;for(const a of linhasAp){acc+=n(a.qntCaixas);if(acc>=needed)return a.data;}return null;}
// PEDIDO AO VIVO ("Produção Dia" do original): reatribuição de dia e
// finalização ficam em localStorage por semana/registro, igual ao
// original (pdAssign_/pdFin_) — não é dado de negócio, é só organização
// visual da tela, então não precisa ir pro Firestore.
function pdChaveDia(id){return 'pdAssign_producao_v341_'+id;}function pdChaveFin(id){return 'pdFin_producao_v341_'+id;}
function pdDiaAtribuido(r){return localStorage.getItem(pdChaveDia(r._id))||r.data||'';}
function pdFinalizado(id){return localStorage.getItem(pdChaveFin(id))==='1';}
function pdSetDia(id,ds){if(ds)localStorage.setItem(pdChaveDia(id),ds);else localStorage.removeItem(pdChaveDia(id));}
function pdSetFin(id,v){if(v)localStorage.setItem(pdChaveFin(id),'1');else localStorage.removeItem(pdChaveFin(id));}
async function carregar(forcar){if(carregado&&!forcar)return;const [r,a,al,p]=await Promise.all([fs().collection(CREG).get(),fs().collection(CAP).get(),fs().collection(CAP_LEGACY).get().catch(()=>({docs:[]})),fs().collection(CPROC).get().catch(()=>({docs:[]}))]);regs=r.docs.map(d=>regNorm(d.id,d.data()));const merged=new Map();al.docs.forEach(d=>{const x=aponNorm(d.id,d.data());merged.set((x.registroId||'')+'_'+(x.data||'')||d.id,x);});a.docs.forEach(d=>{const x=aponNorm(d.id,d.data());merged.set((x.registroId||'')+'_'+(x.data||'')||d.id,x);});aps=[...merged.values()];procs=p.docs.map(d=>({_id:d.id,...d.data()}));carregado=true;}
function seq(r){return Number.isFinite(Number(r.sortOrder))?Number(r.sortOrder):Number.MAX_SAFE_INTEGER;}function bloqueio(r){if(r.liberacaoSequencia===true)return null;const anteriores=regs.filter(x=>x._id!==r._id&&x.maquina===r.maquina&&seq(x)<seq(r)&&x.status!=='concluido'&&total(x._id)<n(x.qntCaixas)).sort((a,b)=>seq(a)-seq(b));return anteriores[0]||null;}
function linhas(){const ds=dias().map(iso);return regs.filter(r=>(ds.includes(r.data)||aps.some(a=>a.registroId===r._id&&ds.includes(a.data)))&&(!fMaq||r.maquina===fMaq)&&(!fProd||String(r.produto||'').toLowerCase().includes(fProd.toLowerCase()))&&(!fStatus||statusNorm(r.status)===fStatus)).sort((a,b)=>(a.maquina||'').localeCompare(b.maquina||'')||seq(a)-seq(b)||(a.data||'').localeCompare(b.data||''));}
async function render(){const p=document.getElementById('page-producao-realizado');if(!p)return;desenhar();try{await carregar();}catch(e){p.innerHTML='<div class="empty">Falha: '+esc(e.message||e)+'</div>';return;}desenhar();}
// PEDIDO AO VIVO (bate por completo com o original, app.js:5641-5719 e
// index.html:356-391): ordem real é 1) abas Apontamentos/Processos, 2)
// navegação de semana (‹ Ant. | rótulo | Próx. › | Hoje | ir-para-data),
// 3) abas de dia (só dias com jornada>0) + Produção Dia + Total da
// Semana, 4) conteúdo. Sem cards de KPI nessa tela — não existem no
// original (confirmado lendo index.html:370-385).
function desenhar(){
  const p=document.getElementById('page-producao-realizado');if(!p)return;
  const dd=dias(),ds=dd.map(iso),edit=pode();
  const workDays=diasUteis();
  if(diaAtivo!=='producao-dia'&&(!diaAtivo||!ds.includes(diaAtivo)||horasNoDia(new Date(diaAtivo+'T12:00:00'))<=0)){
    diaAtivo=iso(workDays[0]||dd[0]);
  }
  const ll=linhas();
  // PEDIDO AO VIVO (usuário: "no original ela abre um modal, aqui está
  // deixando na tela grande") — "Total da Semana" deixou de ser mais uma
  // aba que troca o conteúdo da página (diaAtivo='__total__') e virou um
  // modal (abrirTotalSemanaModal) por cima da visão do dia atual, sem
  // navegar pra lugar nenhum — por isso não tem mais classe "is-active"
  // aqui, é só um botão que abre um popup, como Produção Dia deveria e os
  // outros modais desta mesma tela (detalhe/procModal) já fazem.
  const diaTabsHtml=`<div id="prod-day-tabs" class="preal-day-tabs">${workDays.map(d=>{const dt=iso(d),count=aps.filter(a=>a.data===dt&&n(a.qntCaixas)>0).length;return `<button type="button" class="preal-day-tab ${diaAtivo===dt?'is-active':''}" data-preal-dia="${dt}"><span>${DL[d.getDay()]}</span><small>${fmt(d)}</small>${count?`<i>${count}</i>`:''}</button>`;}).join('')}<button type="button" class="preal-day-tab preal-special ${diaAtivo==='producao-dia'?'is-active':''}" data-preal-dia="producao-dia"><span>🗂️</span><small>Produção Dia</small></button><button type="button" class="preal-day-tab preal-special" data-preal-dia="__total__"><span>📊</span><small>Total da Semana</small></button></div>`;
  p.innerHTML=`
    <div style="display:flex;gap:0;margin-bottom:18px;border-bottom:2px solid var(--border)">
      <button type="button" class="btn-tab-sub ${abaRealizado==='apontamentos'?'ativo':''}" data-preal-aba="apontamentos" style="padding:9px 20px;font-size:.82rem;font-weight:600;border:none;border-bottom:2px solid ${abaRealizado==='apontamentos'?'var(--orange)':'transparent'};margin-bottom:-2px;background:none;color:${abaRealizado==='apontamentos'?'var(--orange)':'var(--muted)'};cursor:pointer">✅ Apontamentos</button>
      <button type="button" class="btn-tab-sub ${abaRealizado==='processos'?'ativo':''}" data-preal-aba="processos" style="padding:9px 20px;font-size:.82rem;font-weight:600;border:none;border-bottom:2px solid ${abaRealizado==='processos'?'var(--orange)':'transparent'};margin-bottom:-2px;background:none;color:${abaRealizado==='processos'?'var(--orange)':'var(--muted)'};cursor:pointer">⚙️ Processos</button>
    </div>
    ${abaRealizado==='processos'?processosHtml(edit):`
    <div class="preal-week-toolbar">
      <div class="preal-week-nav">
        <button class="btn btn-ghost" data-preal-semana="-1">‹ Ant.</button>
        <div class="preal-week-label">${fmt(dd[0])} – ${fmt(dd[6])} / ${dd[0].getFullYear()}</div>
        <button class="btn btn-ghost" data-preal-semana="1">Próx. ›</button>
        <button class="btn btn-ghost" data-preal-hoje>Hoje</button>
      </div>
      <input type="date" class="field" data-preal-data value="${iso(weekStart)}" title="Ir para semana">
    </div>
    ${diaTabsHtml}
    ${diaAtivo==='producao-dia'?produzaoDiaHtml(ll,edit):diaViewHtml(ll,edit)}
    `}<div id="preal-modal-host"></div>`;
}
// PEDIDO AO VIVO (bate com app.js:5977-6038): tabela por máquina, não
// uma tabela única com "Máquina" como coluna. Filtros + Importar/Exportar
// ficam nessa mesma linha (app.js:5919-5925), não no topo da tela.
function diaViewHtml(ll,edit){
  const dateVal=diaAtivo,d=new Date(dateVal+'T12:00:00'),dateLabel=fmt(d),isHoje=dateVal===iso(new Date());
  const maqs=[...new Set(regs.map(r=>r.maquina).filter(Boolean))].sort();
  const filtroRow=`<div class="preal-filter-row">
    <div class="preal-filter-controls">
      <span style="font-size:.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted)">${dateLabel}${isHoje?' <span style="color:var(--orange)">(HOJE)</span>':''}</span>
      <select class="field" data-preal-fmaq><option value="">Todas as máquinas</option>${maqs.map(x=>`<option value="${esc(x)}" ${x===fMaq?'selected':''}>${esc(x)}</option>`).join('')}</select>
      <select class="field" data-preal-fstatus><option value="">Todos os status</option>${[['programado','Pendente'],['em_producao','Em andamento'],['concluido','Concluído']].map(([v,l])=>`<option value="${v}" ${fStatus===v?'selected':''}>${l}</option>`).join('')}</select>
      <input class="field" data-preal-fprod placeholder="Buscar produto..." value="${esc(fProd)}">
      ${(fMaq||fProd||fStatus)?`<button class="btn btn-ghost btn-sm" data-preal-limpar-filtros>✕</button>`:''}
    </div>
    ${edit?`<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-preal-import-btn>📥 Importar</button><input type="file" accept=".xlsx,.xls" data-preal-import hidden><button class="btn btn-ghost btn-sm" data-preal-export>📤 Exportar</button></div>`:''}
  </div>`;
  const grupos={};ll.forEach(r=>{(grupos[r.maquina]=grupos[r.maquina]||[]).push(r);});
  const maqKeys=Object.keys(grupos).sort();
  if(!maqKeys.length){
    return `${filtroRow}<div class="empty preal-empty"><div class="empty-icon">⏰</div><div class="empty-title">Nenhum produto programado para ${dateLabel}.</div><div class="empty-sub">Verifique o Gantt Visual ou a aba Produção Dia.</div></div>`;
  }
  const tabelas=maqKeys.map(maq=>{
    const recs=grupos[maq];
    const linhasHtml=recs.map((r,idx)=>{
      const tr=total(r._id),pr=n(r.qntCaixas),bloq=bloqueio(r),a=apon(r._id,dateVal),h=a?.horas||{};
      const totalDia=HORAS.reduce((s,hr)=>s+n(h[hr]),0),isDone=pr>0&&tr>=pr,isAndamento=tr>0&&!isDone;
      const nomeCor=isDone?'var(--success)':isAndamento?'inherit':'var(--muted)';
      return `<tr><td>${idx+1}</td><td><b style="color:${nomeCor}">${esc(r.produto)}</b>${bloq?`<div style="font-size:.66rem;color:var(--orange)">🔒 aguarda ${esc(bloq.produto)}</div>`:''}</td>${HORAS.map(hr=>`<td style="text-align:center;padding:2px"><input type="number" min="0" class="field" style="width:38px;padding:3px;text-align:center;font-size:.66rem" value="${h[hr]??''}" data-preal-hora-input data-id="${esc(r._id)}" data-data="${dateVal}" data-hora="${hr}" ${edit&&!bloq&&r.status!=='concluido'?'':'disabled'}></td>`).join('')}<td style="text-align:right;font-weight:700">${totalDia||'—'}</td><td style="text-align:right;font-weight:700" data-preal-total="${esc(r._id)}">${tr.toLocaleString('pt-BR')}</td><td style="text-align:right">${pr.toLocaleString('pt-BR')}</td><td style="text-align:center"><button class="acao-lapis" title="Observação" data-preal-detalhe="${esc(r._id)}|${dateVal}">📝</button></td><td style="white-space:nowrap">${edit?`${r.status==='concluido'?`<button class="acao-lapis" title="Reabrir" data-preal-reabrir="${esc(r._id)}">↩️</button>`:`<button class="acao-lapis" title="Concluir" data-preal-concluir="${esc(r._id)}">🏁</button>`}${bloq?`<button class="acao-lapis" title="Liberar sequência" data-preal-liberar="${esc(r._id)}">🔓</button>`:''}`:''}</td></tr>`;
    }).join('');
    return `<div class="tc" style="padding:0;margin-bottom:14px;overflow:hidden"><div style="padding:8px 12px;background:var(--surface-2);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px"><b style="font-size:.78rem">🏭 ${esc(maq)}</b><span style="font-size:.7rem;color:var(--muted)">${recs.length} produto(s)</span></div><div style="overflow:auto"><table class="dt-table"><thead><tr><th>#</th><th>Produto</th>${HORAS.map(h=>`<th style="min-width:40px;text-align:center;font-size:.6rem">${h}h</th>`).join('')}<th style="text-align:right">Total dia</th><th style="text-align:right">Acumulado</th><th style="text-align:right">Solic.</th><th>Obs.</th><th>Ações</th></tr></thead><tbody>${linhasHtml}</tbody></table></div></div>`;
  }).join('');
  return `${filtroRow}${tabelas}`;
}
// PEDIDO AO VIVO (comparação com o original achou isso diferente): a
// original mostra processos como CARTÕES coloridos por tipo (borda
// esquerda + ícone), com "Carga de Trabalho dos Funcionários" em barra de
// progresso colorida (verde/amarelo/vermelho conforme % de 480min = 8h) —
// não tabela + badges de texto simples.
const PROC_TIPO_INFO={mistura:{icone:'🥣',cor:'var(--info)'},descanso:{icone:'⏳',cor:'var(--muted)'},envase:{icone:'🧴',cor:'var(--orange)'},etiquetagem:{icone:'🏷️',cor:'var(--warn)'},embalagem:{icone:'📦',cor:'var(--success)'},pesagem:{icone:'⚖️',cor:'var(--danger)'},limpeza:{icone:'🧽',cor:'var(--info)'},inspecao:{icone:'🔍',cor:'var(--muted)'},outro:{icone:'⚙️',cor:'var(--muted)'}};

// PEDIDO AO VIVO (bate por completo com app.js:7191-7379): resumo
// agrupado POR MÁQUINA (uma tabela por máquina, igual à aba de dia), com
// colunas Produto/Solic./Realiz./Taxa+barra de progresso/Status
// (badge)/Dia Final/Observações — não uma tabela única com colunas por
// dia da semana (isso não existe no original).
function totalSemanaHtml(ll,ds,dd){
  const grupos={};ll.forEach(r=>{(grupos[r.maquina]=grupos[r.maquina]||[]).push(r);});
  const maqKeys=Object.keys(grupos).sort();
  if(!maqKeys.length)return `<div class="empty preal-empty"><div class="empty-icon">📊</div><div class="empty-title">Nenhum produto programado para esta semana.</div></div>`;
  let totalNeeded=0,totalReal=0,totalObs=0;
  const secoes=maqKeys.map(maq=>{
    const recs=grupos[maq];
    let maqNeeded=0,maqReal=0;
    const linhasHtml=recs.map(r=>{
      const needed=n(r.qntCaixas),produced=total(r._id);
      maqNeeded+=needed;maqReal+=produced;totalNeeded+=needed;totalReal+=produced;
      const pct=needed?Math.round(produced/needed*100):0,isDone=needed>0&&produced>=needed,hasAny=produced>0;
      const badge=isDone?`<span class="badge b-green">✓ Finalizado</span>`:hasAny?`<span class="badge b-orange">⚡ Parcial</span>`:`<span class="badge b-gray">— Não iniciado</span>`;
      const finDay=isDone?diaFinalizacao(r._id,needed):null;
      const obsLinhas=ds.map(dt=>{const a=apon(r._id,dt);if(!a?.observacao)return null;totalObs++;const dObj=new Date(dt+'T12:00:00');return `<div style="font-size:.68rem;margin-bottom:2px"><b style="color:var(--warn)">${DL[dObj.getDay()]}</b> ${esc(a.observacao)}</div>`;}).filter(Boolean);
      return `<tr><td><b>${esc(r.produto)}</b></td><td style="text-align:center">${needed.toLocaleString('pt-BR')}</td><td style="text-align:center;font-weight:700">${produced.toLocaleString('pt-BR')}</td><td style="text-align:center;min-width:100px"><div style="font-weight:700;color:${isDone?'var(--success)':hasAny?'var(--orange)':'var(--muted)'}">${pct}%</div><div style="height:5px;background:var(--surface-2);border-radius:3px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${Math.min(100,pct)}%;background:${isDone?'var(--success)':'var(--orange)'}"></div></div></td><td style="text-align:center">${badge}</td><td style="text-align:center">${finDay?fmt(new Date(finDay+'T12:00:00')):'<span style="color:var(--muted)">—</span>'}</td><td>${obsLinhas.join('')||'<span style="color:var(--muted)">—</span>'}</td></tr>`;
    }).join('');
    const maqPct=maqNeeded?Math.round(maqReal/maqNeeded*100):0;
    return `<div class="tc" style="padding:0;margin-bottom:14px;overflow:hidden"><div style="padding:8px 12px;background:var(--surface-2);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px"><b style="font-size:.78rem">🏭 ${esc(maq)}</b><span style="font-size:.7rem;font-weight:700;color:${maqPct>=100?'var(--success)':'var(--muted)'}">${maqReal.toLocaleString('pt-BR')} / ${maqNeeded.toLocaleString('pt-BR')} (${maqPct}%)</span></div><div style="overflow:auto"><table class="dt-table" style="font-size:.74rem"><thead><tr><th>Produto</th><th style="text-align:center">Solic.</th><th style="text-align:center">Realiz.</th><th style="text-align:center">Taxa / Progresso</th><th style="text-align:center">Status</th><th style="text-align:center">Dia Final</th><th>📝 Observações</th></tr></thead><tbody>${linhasHtml}</tbody></table></div></div>`;
  }).join('');
  const totalPct=totalNeeded?Math.round(totalReal/totalNeeded*100):0;
  return `<div class="tc" style="padding:12px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted)">📊 Total da Semana · ${fmt(dd[0])} – ${fmt(dd[6])}${totalObs?` <span style="color:var(--warn)">· ${totalObs} produto(s) com observações</span>`:''}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 14px;text-align:center"><div style="font-size:.65rem;color:var(--muted)">Solicitado</div><div style="font-weight:700">${totalNeeded.toLocaleString('pt-BR')}</div></div>
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 14px;text-align:center"><div style="font-size:.65rem;color:var(--muted)">Realizado</div><div style="font-weight:700;color:${totalPct>=100?'var(--success)':'inherit'}">${totalReal.toLocaleString('pt-BR')}</div></div>
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 14px;text-align:center"><div style="font-size:.65rem;color:var(--muted)">Taxa Geral</div><div style="font-weight:700;color:${totalPct>=100?'var(--success)':'inherit'}">${totalPct}%</div></div>
    </div>
  </div>${secoes}`;
}
// PEDIDO AO VIVO (usuário: "no original ela abre um modal, aqui está
// deixando na tela grande") — "Total da Semana" some/atualiza dentro de
// um popup, sem trocar a visão do dia que já estava aberta por baixo.
function abrirTotalSemanaModal(){
  const dd=dias(),ds=dd.map(iso),ll=linhas();
  const host=document.getElementById('preal-modal-host');
  if(!host)return;
  host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:1100px;max-height:85vh;overflow:auto"><div class="modal-header"><b>📊 Total da Semana</b><button class="modal-x" data-preal-modal-fechar>×</button></div><div class="modal-body">${totalSemanaHtml(ll,ds,dd)}</div></div></div>`;
}
// PEDIDO AO VIVO (bate com app.js:6594-6772, "Produção Dia"): colunas por
// dia útil da semana, com card por produto e opção de mover para outro
// dia / finalizar. ADAPTAÇÃO EXPLÍCITA: o original usa arraste nativo
// (HTML5 drag-and-drop) entre colunas e um seletor de operador por
// máquina/dia — aqui a troca de dia é por um <select> no card (mesmo
// efeito, sem arraste) e NÃO há seletor de operador (dependeria de dados
// de funcionário/máquina que esse arquivo não carrega hoje).
function produzaoDiaHtml(ll,edit){
  const workDays=diasUteis(),hoje=iso(new Date());
  const ativos=ll.filter(r=>!pdFinalizado(r._id)),finCount=ll.length-ativos.length;
  const cols=workDays.map(d=>{
    const dsAtual=iso(d),recsDia=ativos.filter(r=>pdDiaAtribuido(r)===dsAtual),isHoje=dsAtual===hoje;
    return `<div class="tc" style="padding:0;overflow:hidden;${isHoje?'border-color:var(--orange)':''}">
      <div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-weight:700;font-size:.78rem;color:${isHoje?'var(--orange)':'inherit'}">${DL[d.getDay()]}</div><div style="font-size:.65rem;color:var(--muted)">${fmt(d)}</div></div>
        <div style="display:flex;align-items:center;gap:5px"><span class="badge b-gray">${recsDia.length}</span>${isHoje?'<span style="color:var(--orange);font-size:.6rem;font-weight:700">HOJE</span>':''}</div>
      </div>
      <div style="padding:6px 8px;display:flex;flex-direction:column;gap:5px;min-height:60px">${recsDia.length?recsDia.map(r=>pdCardHtml(r,dsAtual,workDays,edit)).join(''):'<div style="text-align:center;padding:10px 6px;font-size:.68rem;color:var(--muted)">Nenhum produto</div>'}</div>
    </div>`;
  }).join('');
  return `${finCount>0?`<div class="tc" style="padding:8px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-color:var(--orange)"><span style="font-size:.72rem;color:var(--orange)">${finCount} produto(s) finalizado(s) e ocultos</span>${edit?`<button class="btn btn-ghost btn-sm" data-preal-pd-restaurar-todos>↩ Restaurar todos</button>`:''}</div>`:''}<div style="display:grid;grid-template-columns:repeat(${Math.max(1,workDays.length)},1fr);gap:10px;align-items:start;overflow-x:auto">${cols}</div>`;
}
function pdCardHtml(r,dsAtual,workDays,edit){
  const needed=n(r.qntCaixas),produced=total(r._id),pct=needed?Math.min(100,Math.round(produced/needed*100)):0,isDone=needed>0&&produced>=needed;
  const cor=isDone?'var(--success)':pct>0?'var(--orange)':'var(--muted)';
  return `<div class="tc" style="padding:7px 8px;border-left:3px solid ${cor}">
    <div style="font-size:.72rem;font-weight:600">${esc(r.produto)}</div>
    <div style="font-size:.64rem;color:var(--muted);margin:2px 0">${esc(r.maquina)} · ${produced.toLocaleString('pt-BR')}/${needed.toLocaleString('pt-BR')} (${pct}%)</div>
    ${edit?`<div style="display:flex;gap:4px;align-items:center;margin-top:4px">
      <select class="field" style="flex:1;font-size:.64rem;padding:2px 4px" data-preal-pd-mover="${esc(r._id)}">${workDays.map(d=>`<option value="${iso(d)}" ${iso(d)===dsAtual?'selected':''}>${DL[d.getDay()]} ${fmt(d)}</option>`).join('')}</select>
      <button class="acao-lapis" title="Finalizar" data-preal-pd-finalizar="${esc(r._id)}">🏁</button>
    </div>`:''}
  </div>`;
}
function processosHtml(edit){let atuais=procs.slice().filter(x=>(!pfData||x.data===pfData)&&(!pfTipo||x.tipo===pfTipo)&&(!pfBusca||[x.nome,x.descricao,x.maquina,(x.produtos||[]).join?.(' '),(x.funcionarios||[]).map?.(f=>f.nome).join(' ')].join(' ').toLowerCase().includes(pfBusca.toLowerCase()))).sort((a,b)=>(b.data||'').localeCompare(a.data||'')||String(a.horaInicio||a.inicio||'').localeCompare(String(b.horaInicio||b.inicio||'')));
  const JORNADA_MIN=480; // 8h — mesma base de 100% usada pelo original
  const carga={};atuais.forEach(x=>(x.funcionarios||[]).forEach(f=>{const k=f.nome||'Sem nome';carga[k]=(carga[k]||0)+n(f.tempoMin||x.tempoMinutos);}));
  const cargaHtml=Object.keys(carga).length?`<div style="display:flex;flex-direction:column;gap:6px;margin:8px 0">${Object.entries(carga).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{const pct=Math.min(100,Math.round(v/JORNADA_MIN*100));const cor=pct>=100?'var(--danger)':pct>=70?'var(--warn)':'var(--success)';return `<div><div style="display:flex;justify-content:space-between;font-size:.7rem;margin-bottom:2px"><span>${esc(k)}</span><span style="color:var(--muted)">${Math.round(v)} min (${pct}%)</span></div><div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${cor}"></div></div></div>`;}).join('')}</div>`:'';
  const cards=atuais.length?atuais.map(x=>{const info=PROC_TIPO_INFO[x.tipo]||PROC_TIPO_INFO.outro;const finalizado=x.status==='finalizado';return `<div class="tc" style="padding:12px;border-left:4px solid ${info.cor};display:flex;flex-direction:column;gap:6px">
    <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
      <div><div style="font-weight:600">${info.icone} ${esc(x.nome||x.descricao)}</div><div style="font-size:.68rem;color:var(--muted)">${esc(x.data)} · ${x.diaInteiro?'Dia inteiro':`${esc(x.horaInicio||x.inicio||'')}–${esc(x.horaFim||x.fim||'')}`}${x.maquina?' · '+esc(x.maquina):''}</div></div>
      <span class="badge ${finalizado?'b-green':'b-orange'}">${finalizado?'Finalizado':'Aberto'}</span>
    </div>
    ${(x.produtos||[]).length||x.produto?`<div style="font-size:.72rem;color:var(--muted)">📦 ${esc(Array.isArray(x.produtos)?x.produtos.join(', '):(x.produto||''))}</div>`:''}
    <div style="font-size:.72rem;color:var(--muted)">👷 ${esc((x.funcionarios||[]).map(f=>f.nome).join(', ')||'Sem equipe registrada')} · ${Math.round(n(x.tempoMinutos))} min</div>
    ${edit?`<div style="display:flex;justify-content:flex-end;gap:2px"><button class="acao-lapis" title="Editar" data-preal-proc-editar="${esc(x._id)}">✏️</button>${!finalizado?`<button class="acao-lapis" title="Finalizar" data-preal-proc-finalizar="${esc(x._id)}">🏁</button>`:''}<button class="acao-lapis" title="Excluir" data-preal-proc-excluir="${esc(x._id)}">🗑️</button></div>`:''}
  </div>`;}).join(''):'<div class="empty"><div class="empty-icon">⚙️</div><div class="empty-title">Nenhum processo encontrado</div></div>';
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div><b>⚙️ Processos Produtivos</b><div style="font-size:.7rem;color:var(--muted)">Mistura, descanso, envase, limpeza, inspeção e demais processos com equipe e duração.</div></div>${edit?'<button class="btn btn-ghost btn-sm" data-preal-proc-novo>+ Registrar processo</button>':''}</div><div class="tc" style="padding:10px;margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap"><input type="date" class="field" data-preal-pfdata value="${esc(pfData)}" style="max-width:155px"><select class="field" data-preal-pftipo style="max-width:175px"><option value="">Todos tipos</option>${PROC_TIPOS.map(t=>`<option value="${t}" ${pfTipo===t?'selected':''}>${t}</option>`).join('')}</select><input class="field" data-preal-pfbusca value="${esc(pfBusca)}" placeholder="Buscar processo, máquina ou funcionário" style="min-width:250px;flex:1"></div>${cargaHtml?`<div class="tc" style="padding:10px;margin-bottom:8px"><div style="font-size:.7rem;font-weight:700;color:var(--muted);margin-bottom:6px">Carga de Trabalho dos Funcionários</div>${cargaHtml}</div>`:''}<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">${cards}</div>`;}
async function salvar(id,data,val,extra){if(!pode())return;const r=regs.find(x=>x._id===id);if(!r)return;const bl=bloqueio(r);if(bl&&!r.liberacaoSequencia){global.showToast?.('Sequência bloqueada. Conclua a OP anterior ou use liberação temporária.','error');desenhar();return;}const key=id+'_'+data;if(salvando.has(key))return;salvando.add(key);try{const un=Math.max(1,n(r.unidPorCx)||1),q=Math.max(0,n(val));const outros=aps.filter(a=>a.registroId===id&&a.data!==data).reduce((s,a)=>s+n(a.qntCaixas),0);if(outros+q>n(r.qntCaixas)&&!r.liberacaoQuantidade){global.showToast?.('Quantidade ultrapassa o programado. Libere a OP antes de apontar excedente.','error');desenhar();return;}const old=apon(id,data);const payload={registroId:id,registro_id:id,opId:id,data,date:data,qntCaixas:q,quantidade:q,realizadoCaixas:q,qntUnid:q*un,quantidadeUnidades:q*un,horas:extra?.horas??old?.horas??{},observacao:extra?.observacao??old?.observacao??'',obs:extra?.observacao??old?.observacao??'',atualizadoEm:new Date().toISOString(),atualizadoPor:global._currentAnalistaUser?.email||''};await fs().collection(CAP).doc(key).set(payload,{merge:true});const ix=aps.findIndex(a=>a._id===key);if(ix>=0)aps[ix]={_id:key,...aps[ix],...payload};else aps.push({_id:key,...payload});const totalReal=total(id), unidPorCx=un;const novoStatus=totalReal>=n(r.qntCaixas)&&n(r.qntCaixas)>0?'concluido':(totalReal>0?'em_producao':(r.status||'programado'));await fs().collection(CREG).doc(id).set({realizadoCaixas:totalReal,quantidadeRealizada:totalReal,realizadoUnid:totalReal * unidPorCx,realizadoAtualizadoEm:new Date().toISOString(),status:novoStatus,statusProducao:novoStatus,concluidoAutomaticamente:novoStatus==='concluido'&&r.status!=='concluido'},{merge:true});r.realizadoCaixas=totalReal;r.status=novoStatus;await syncPCP(r,novoStatus);const cell=document.querySelector(`[data-preal-total="${CSS.escape(id)}"]`);if(cell)cell.textContent=totalReal.toLocaleString('pt-BR');}catch(e){global.showToast?.('Erro ao salvar: '+(e.message||e),'error');}finally{salvando.delete(key);}}
function detalhe(token){const [id,data]=token.split('|'),r=regs.find(x=>x._id===id),a=apon(id,data)||{},h=a.horas||{};if(!r)return;const host=document.getElementById('preal-modal-host');host.innerHTML=`<div class="modal-backdrop show" data-preal-modal-fechar><div class="modal" style="max-width:900px" onclick="event.stopPropagation()"><div class="modal-header"><div><b>🕐 Apontamento horário</b><div style="font-size:.75rem;color:var(--muted)">${esc(r.produto)} · ${esc(r.maquina)} · ${data}</div></div><button class="modal-close" data-preal-modal-fechar>×</button></div><div class="modal-body"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:8px">${HORAS.map(hr=>`<label style="font-size:.7rem">${hr}:00<input type="number" min="0" class="field" data-preal-hora="${hr}" value="${h[hr]??''}" ${pode()&&r.status!=='concluido'?'':'disabled'}></label>`).join('')}</div><label style="display:block;margin-top:12px">Observação<textarea class="field" data-preal-obs rows="3" ${pode()?'':'disabled'}>${esc(a.observacao||'')}</textarea></label></div><div class="modal-footer"><button class="btn btn-ghost" data-preal-modal-fechar>Cancelar</button>${pode()?`<button class="btn btn-primary" data-preal-detalhe-salvar="${esc(id)}|${data}">Salvar detalhe</button>`:''}</div></div></div>`;}
async function salvarDetalhe(token){const [id,data]=token.split('|'),horas={};document.querySelectorAll('[data-preal-hora]').forEach(i=>{if(i.value!=='')horas[i.dataset.prealHora]=Math.max(0,n(i.value));});const q=Object.values(horas).reduce((s,v)=>s+n(v),0),obs=document.querySelector('[data-preal-obs]')?.value||'';await salvar(id,data,q,{horas,observacao:obs});document.getElementById('preal-modal-host').innerHTML='';desenhar();}
async function status(id,novo){const r=regs.find(x=>x._id===id);if(!r)return;if(novo==='concluido'&&total(id)<n(r.qntCaixas)){const ok=confirm('A quantidade realizada é menor que a programada. Concluir mesmo assim?');if(!ok)return;}await fs().collection(CREG).doc(id).set({status:novo,atualizadoEm:new Date().toISOString()},{merge:true});r.status=novo;desenhar();}
async function liberar(id){const r=regs.find(x=>x._id===id);if(!r)return;await fs().collection(CREG).doc(id).set({liberacaoSequencia:true,liberacaoQuantidade:true,liberadoEm:new Date().toISOString(),liberadoPor:global._currentAnalistaUser?.email||''},{merge:true});r.liberacaoSequencia=true;r.liberacaoQuantidade=true;global.showToast?.('OP liberada temporariamente para sequência/quantidade.','success');desenhar();}
function exportar(){if(!global.XLSX){global.showToast?.('Biblioteca Excel não carregada.','error');return;}const rows=[];aps.forEach(a=>{const r=regs.find(x=>x._id===a.registroId)||{};rows.push({registroId:a.registroId,Data:a.data,Produto:r.produto||'',Maquina:r.maquina||'',Programado:n(r.qntCaixas),Realizado:n(a.qntCaixas),Observacao:a.observacao||'',...Object.fromEntries(HORAS.map(h=>['H'+h,n(a.horas?.[h])]))});});const wb=global.XLSX.utils.book_new();global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(rows),'Apontamentos');global.XLSX.writeFile(wb,'realizado_producao_'+iso(weekStart)+'.xlsx');}
async function importar(file){if(!file||!global.XLSX)return;try{const b=await file.arrayBuffer(),wb=global.XLSX.read(b,{type:'array'}),rows=global.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});let c=0;for(const x of rows){let id=String(x.registroId||'');if(!id){const r=regs.find(z=>String(z.produto||'')===String(x.Produto||x.produto||'')&&String(z.maquina||'')===String(x.Maquina||x.maquina||''));id=r?._id||'';}const data=String(x.Data||x.data||'').slice(0,10);if(!id||!data)continue;const horas={};HORAS.forEach(h=>{const v=x['H'+h];if(v!==''&&v!=null)horas[h]=n(v);});const q=Object.keys(horas).length?Object.values(horas).reduce((s,v)=>s+n(v),0):n(x.Realizado??x.qntCaixas);await salvar(id,data,q,{horas,observacao:String(x.Observacao||x.observacao||'')});c++;}await carregar(true);desenhar();global.showToast?.(`${c} apontamento(s) importado(s).`,'success');}catch(e){global.showToast?.('Erro ao importar realizado: '+(e.message||e),'error');}}
function procMin(ini,fim,dia,data){if(dia){let j=global.PRODUCAO_JORNADA; if(!Array.isArray(j)||j.length!==7){try{j=JSON.parse(localStorage.getItem('dt_producao_jornada_v341')||'null');}catch(e){j=null;}} const d=data?new Date(data+'T12:00:00'):new Date(),h=Array.isArray(j)?n(j[d.getDay()]):0;return Math.round((h>0?h:8)*60);}if(!ini||!fim)return 0;const [ih,im]=ini.split(':').map(n),[fh,fm]=fim.split(':').map(n);let v=fh*60+fm-(ih*60+im);return v<0?v+1440:v;}function procModal(id=''){const x=procs.find(z=>z._id===id)||{},host=document.getElementById('preal-modal-host');if(!host)return;const funcs=(x.funcionarios||[]).map(f=>`${f.nome||''}|${f.funcao||''}|${f.tempoMin||''}`).join('\n');host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:760px"><div class="modal-header"><b>${id?'Editar':'Novo'} processo produtivo</b><button class="modal-x" data-preal-modal-fechar>×</button></div><div class="modal-body"><div class="grid2"><div><label class="field-label">Nome/descrição</label><input class="field" id="pproc-nome" value="${esc(x.nome||x.descricao||'')}"></div><div><label class="field-label">Tipo</label><select class="field" id="pproc-tipo">${PROC_TIPOS.map(t=>`<option value="${t}" ${x.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div><div><label class="field-label">Data</label><input type="date" class="field" id="pproc-data" value="${esc(x.data||iso(new Date()))}"></div><div><label class="field-label">Máquina (opcional)</label><input class="field" id="pproc-maq" value="${esc(x.maquina||'')}"></div><div><label class="field-label">Produtos (separados por vírgula)</label><input class="field" id="pproc-prod" value="${esc(Array.isArray(x.produtos)?x.produtos.join(', '):(x.produto||''))}"></div><div><label class="field-label">Status</label><select class="field" id="pproc-status"><option value="aberto" ${(x.status||'aberto')==='aberto'?'selected':''}>aberto</option><option value="finalizado" ${x.status==='finalizado'?'selected':''}>finalizado</option></select></div><div><label class="field-label">Hora início</label><input type="time" class="field" id="pproc-ini" value="${esc(x.horaInicio||x.inicio||'')}"></div><div><label class="field-label">Hora fim</label><input type="time" class="field" id="pproc-fim" value="${esc(x.horaFim||x.fim||'')}"></div></div><label style="display:flex;gap:6px;align-items:center;margin:10px 0"><input type="checkbox" id="pproc-dia" ${x.diaInteiro?'checked':''}> Dia inteiro</label><label class="field-label">Funcionários — uma linha por pessoa: nome | função | minutos</label><textarea class="field" id="pproc-funcs" rows="4" placeholder="João | Operador | 90">${esc(funcs)}</textarea><label class="field-label" style="margin-top:8px">Observações</label><textarea class="field" id="pproc-obs" rows="3">${esc(x.observacao||x.obs||'')}</textarea></div><div class="modal-footer"><button class="btn btn-ghost" data-preal-modal-fechar>Cancelar</button><button class="btn btn-primary" data-preal-proc-salvar="${esc(id)}">Salvar</button></div></div></div>`;}function procSalvar(id=''){const g=x=>document.getElementById(x),nome=g('pproc-nome')?.value.trim();if(!nome){global.showToast?.('Informe o nome do processo.','warning');return;}const dia=!!g('pproc-dia')?.checked,ini=g('pproc-ini')?.value||'',fim=g('pproc-fim')?.value||'',dataProc=g('pproc-data')?.value||iso(new Date()),tempo=procMin(ini,fim,dia,dataProc),funcionarios=(g('pproc-funcs')?.value||'').split(/\n+/).map(l=>l.split('|').map(x=>x.trim())).filter(a=>a[0]).map(a=>({nome:a[0],funcao:a[1]||'',tempoMin:n(a[2])||tempo}));const data={nome,descricao:nome,tipo:g('pproc-tipo')?.value||'outro',data:dataProc,maquina:g('pproc-maq')?.value.trim()||'',produtos:(g('pproc-prod')?.value||'').split(',').map(x=>x.trim()).filter(Boolean),horaInicio:ini,horaFim:fim,inicio:ini,fim:fim,diaInteiro:dia,tempoMinutos:tempo,funcionarios,observacao:g('pproc-obs')?.value.trim()||'',status:g('pproc-status')?.value||'aberto',atualizadoEm:new Date().toISOString(),atualizadoPor:global._currentAnalistaUser?.email||''};const ref=id?fs().collection(CPROC).doc(id):fs().collection(CPROC).doc();if(!id){data.criadoEm=data.atualizadoEm;data.criadoPor=data.atualizadoPor;}ref.set(data,{merge:true}).then(()=>carregar(true)).then(()=>{document.getElementById('preal-modal-host').innerHTML='';desenhar();global.showToast?.('Processo salvo.','success');}).catch(e=>global.showToast?.('Erro: '+e.message,'error'));}function procFinalizar(id){fs().collection(CPROC).doc(id).set({status:'finalizado',finalizadoEm:new Date().toISOString(),finalizadoPor:global._currentAnalistaUser?.email||''},{merge:true}).then(()=>carregar(true)).then(desenhar).catch(e=>global.showToast?.('Erro: '+e.message,'error'));}function procExcluir(id){if(!confirm('Excluir este processo produtivo?'))return;fs().collection(CPROC).doc(id).delete().then(()=>carregar(true)).then(desenhar).catch(e=>global.showToast?.('Erro: '+e.message,'error'));}
// Roteador (público, sem UI própria): permite ao roteador central restaurar
// a sub-aba/dia a partir da URL e ler o estado atual pra montar a URL —
// mesmo comportamento do clique real (data-preal-aba/data-preal-dia), só
// exposto como função nomeada em vez de ficar só dentro do listener.
function prealSetAba(v){abaRealizado=v||'apontamentos';desenhar();}
function prealGetAba(){return abaRealizado;}
function prealSetDia(v){if(v==='__total__'){abrirTotalSemanaModal();return;}diaAtivo=v||'';desenhar();}
function prealGetDia(){return diaAtivo;}
global.prealSetAba=prealSetAba;global.prealGetAba=prealGetAba;global.prealSetDia=prealSetDia;global.prealGetDia=prealGetDia;
global.renderProducaoRealizado=render;global.exportarProducaoRealizado=exportar;const timers={};document.addEventListener('input',e=>{
  // PEDIDO AO VIVO ("hora a hora que foi produzido por hora do produto"):
  // toda aba de dia mostra a grade hora a hora (07h-23h) direto na
  // tabela — não existe mais um input único por dia (a grade semanal
  // única foi removida, o original não a tem). Soma as 17 horas da linha
  // e reaproveita salvar(id,data,total,{horas}) do jeito que já
  // funcionava no modal de detalhe.
  const hi=e.target.closest('[data-preal-hora-input]');
  if(hi){
    const id=hi.dataset.id,data=hi.dataset.data,k=id+'_'+data+'_horas';
    clearTimeout(timers[k]);
    timers[k]=setTimeout(()=>{
      const linha=hi.closest('tr');
      const horas={};
      linha.querySelectorAll(`[data-preal-hora-input][data-id="${CSS.escape(id)}"][data-data="${CSS.escape(data)}"]`).forEach(inp=>{if(inp.value!=='')horas[inp.dataset.hora]=Math.max(0,n(inp.value));});
      const total=Object.values(horas).reduce((s,v)=>s+n(v),0);
      const obs=apon(id,data)?.observacao||'';
      salvar(id,data,total,{horas,observacao:obs});
    },500);
  }const fp=e.target.closest('[data-preal-fprod]');if(fp){fProd=fp.value;clearTimeout(timers.f);timers.f=setTimeout(desenhar,250);}const pb=e.target.closest('[data-preal-pfbusca]');if(pb){pfBusca=pb.value;clearTimeout(timers.pf);timers.pf=setTimeout(desenhar,250);}});document.addEventListener('change',e=>{if(e.target.matches('[data-preal-data]')){const d=new Date(e.target.value+'T12:00:00');if(!Number.isNaN(d.getTime())){weekStart=domingo(d);desenhar();}return;}if(e.target.matches('[data-preal-fmaq]')){fMaq=e.target.value;desenhar();}if(e.target.matches('[data-preal-fstatus]')){fStatus=e.target.value;desenhar();}if(e.target.matches('[data-preal-pfdata]')){pfData=e.target.value;desenhar();}if(e.target.matches('[data-preal-pftipo]')){pfTipo=e.target.value;desenhar();}if(e.target.matches('[data-preal-import]')){importar(e.target.files?.[0]);e.target.value='';}if(e.target.matches('[data-preal-pd-mover]')){pdSetDia(e.target.getAttribute('data-preal-pd-mover'),e.target.value);desenhar();}});document.addEventListener('click',e=>{const abaBtn=e.target.closest('[data-preal-aba]');if(abaBtn){prealSetAba(abaBtn.getAttribute('data-preal-aba'));return;}const diaBtn=e.target.closest('[data-preal-dia]');if(diaBtn){prealSetDia(diaBtn.getAttribute('data-preal-dia'));return;}const s=e.target.closest('[data-preal-semana]');if(s){weekStart.setDate(weekStart.getDate()+n(s.dataset.prealSemana)*7);desenhar();return;}if(e.target.closest('[data-preal-hoje]')){weekStart=domingo(new Date());desenhar();return;}if(e.target.closest('[data-preal-limpar-filtros]')){fMaq='';fProd='';fStatus='';desenhar();return;}if(e.target.closest('[data-preal-import-btn]')){e.target.closest('div').querySelector('[data-preal-import]')?.click();return;}const pdf=e.target.closest('[data-preal-pd-finalizar]');if(pdf){const id=pdf.getAttribute('data-preal-pd-finalizar');pdSetFin(id,!pdFinalizado(id));desenhar();return;}if(e.target.closest('[data-preal-pd-restaurar-todos]')){linhas().forEach(r=>pdSetFin(r._id,false));desenhar();return;}const d=e.target.closest('[data-preal-detalhe]');if(d){detalhe(d.dataset.prealDetalhe);return;}const sd=e.target.closest('[data-preal-detalhe-salvar]');if(sd){salvarDetalhe(sd.dataset.prealDetalheSalvar);return;}if(e.target.closest('[data-preal-modal-fechar]')){document.getElementById('preal-modal-host').innerHTML='';return;}const c=e.target.closest('[data-preal-concluir]');if(c){status(c.dataset.prealConcluir,'concluido');return;}const r=e.target.closest('[data-preal-reabrir]');if(r){status(r.dataset.prealReabrir,'em_producao');return;}const l=e.target.closest('[data-preal-liberar]');if(l){liberar(l.dataset.prealLiberar);return;}if(e.target.closest('[data-preal-export]')){exportar();return;}if(e.target.closest('[data-preal-proc-novo]')){procModal();return;}const pe=e.target.closest('[data-preal-proc-editar]');if(pe){procModal(pe.dataset.prealProcEditar);return;}const ps=e.target.closest('[data-preal-proc-salvar]');if(ps){procSalvar(ps.dataset.prealProcSalvar);return;}const pf=e.target.closest('[data-preal-proc-finalizar]');if(pf){procFinalizar(pf.dataset.prealProcFinalizar);return;}const px=e.target.closest('[data-preal-proc-excluir]');if(px){procExcluir(px.dataset.prealProcExcluir);return;}});
  global.DTProducao?.registrarInvalidacao?.(()=>{ carregado=false; regs=[]; aps=[]; procs=[]; salvando.clear(); });
})(window);
