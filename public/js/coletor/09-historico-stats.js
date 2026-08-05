// ═══════════════════════════════════════════════════
//  HISTÓRICO
// ═══════════════════════════════════════════════════

function _audNorm(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g,' ').toUpperCase();
}
function _audEndNorm(v) {
  return _audNorm(v).replace(/[^A-Z0-9]/g,'');
}
function _escapeAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function toggleAuditoriaRua(rua) {
  const bodies = [...document.querySelectorAll('[id^="aud-rua-body-"]')];
  bodies.forEach((el, i) => {
    if (el.getAttribute('data-rua') === rua) {
      const abrir = el.style.display === 'none';
      el.style.display = abrir ? 'block' : 'none';
      const icon = document.getElementById('aud-rua-icon-' + i);
      if (icon) icon.textContent = abrir ? '▾' : '▸';
    }
  });
}
function toggleAuditoriaEndereco(id) {
  const el = document.getElementById('aud-item-body-' + id);
  const icon = document.getElementById('aud-item-icon-' + id);
  if (!el) return;
  const abrir = el.style.display === 'none';
  el.style.display = abrir ? 'block' : 'none';
  if (icon) icon.textContent = abrir ? '▴' : '▾';
}

function renderHistorico() {
  const el = document.getElementById('hist-list');
  if (!APP.contagens.length) {
    el.innerHTML = `<div class="empty"><div class="ei">📋</div><p>Nenhuma contagem nesta sessão.</p></div>`;
    return;
  }
  const total = APP.contagens.length;
  const divs  = APP.contagens.filter(c => c.divergente).length;
  const resumoBar = `
    <div style="display:flex;gap:8px;align-items:center;padding:8px 0 10px;flex-wrap:wrap">
      <span style="font-size:.72rem;color:var(--muted)">Total: <b style="color:var(--text)">${total}</b></span>
      <span style="font-size:.72rem;color:var(--muted)">·</span>
      <span style="font-size:.72rem;color:var(--success)">✓ OK: <b>${total - divs}</b></span>
      ${divs ? `<span style="font-size:.72rem;color:var(--muted)">·</span>
      <span style="font-size:.72rem;color:var(--warn)">⚠ Divergências: <b>${divs}</b></span>` : ''}
    </div>`;

  el.innerHTML = resumoBar + APP.contagens.slice(0, 100).map((c, i) => {
    const hora = new Date(typeof c.dataHora === 'string' ? c.dataHora : c.dataHora).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const div  = c.divergente;
    return `
    <div style="
      display:flex;align-items:flex-start;gap:10px;
      padding:10px 12px;
      background:${div ? 'rgba(255,179,0,.06)' : 'var(--card)'};
      border:1px solid ${div ? 'rgba(255,179,0,.3)' : 'var(--border)'};
      border-left:3px solid ${div ? 'var(--warn)' : 'var(--success)'};
      border-radius:10px;margin-bottom:6px">
      <div style="font-size:1.1rem;margin-top:1px">${div ? '⚠️' : '✅'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.descricao}</div>
        <div style="font-size:.68rem;color:var(--muted);margin-top:2px">
          📍 ${c.endereco} &nbsp;·&nbsp; CP ${c.capa} &nbsp;·&nbsp; Val ${c.validade}
        </div>
        ${div ? `<div style="font-size:.68rem;color:var(--warn);margin-top:2px">Esperado: ${c.quantidade_esperada} · Contado: ${c.quantidade}</div>` : ''}
        ${c.bateu_auditoria ? `<div style="font-size:.68rem;color:var(--success);margin-top:2px;font-weight:700">✅ Bateu com auditoria</div>` : ''}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:1.1rem;font-weight:800;font-family:var(--mono);color:${div?'var(--warn)':'var(--accent)'}">${c.quantidade}</div>
        <div style="font-size:.6rem;color:var(--muted)">${hora}</div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════
function updateStats() {
  // Contagens ativas da sessão (excluindo estornadas)
  const ativas   = APP.contagens.filter(c => !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA');
  const total    = ativas.length;
  const enviadas = total - FILA_ENVIO.filter(c => !c._excluida && c.status !== 'ESTORNADA').length;
  const pendentes = FILA_ENVIO.length;
  // Divergências potenciais = contagens com _alertaQtd (apenas informativo)
  // c.divergente sempre false desde que o analista decide a divergência real
  const divs     = 0; // reservado — divergência é calculada pelo analista

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  s('st-total',    total);
  s('st-enviadas', Math.max(0, enviadas));
  s('st-pendentes', pendentes);
  s('st-div',      divs);

  // Campos de sessão
  s('st-op',     APP.operador?.name || '—');
  s('st-inv',    APP.inventario?.nome || '—');
  s('st-base',   APP.base.length ? APP.base.length + ' registros' : '—');
  s('st-net',    navigator.onLine ? '🟢 Online' : '🔴 Offline');
  s('st-coletor', localStorage.getItem('dt_device_id')?.slice(0,20) || '—');
  const _locVer = localStorage.getItem('col_locais_ver');
  s('st-locais-ver', _locVer ? ('v' + _locVer.slice(0,12) + (_locVer.length > 12 ? '…' : '')) : 'sem cache');

  const stAud = document.getElementById('st-aud');
  if (stAud) stAud.textContent = (APP.auditorias || []).length;

  // Fila (barra de status)
  atualizarBarraStatus();
}

// ── Forçar atualização do cache de endereços (dt_locais) ─────────────────
// Chamado pelo botão "Atualizar endereços" na aba Status.
// Limpa a versão salva para que o próximo carregamento de inventário
// faça um download fresco do dt_locais — sem precisar relogar.
async function atualizarCacheLocais() {
  const btn = document.getElementById('btn-refresh-locais');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Atualizando…'; }
  try {
    // Verificar conexão
    if (!navigator.onLine) {
      toast('Sem conexão — impossível atualizar endereços', 'e');
      return;
    }
    // Buscar nova versão do servidor
    let versaoServidor = null;
    try {
      const metaDoc = await FS.collection('dt_locais_meta').doc('versao').get();
      if (metaDoc.exists) versaoServidor = String(metaDoc.data()?.versao ?? '');
    } catch(e) {
      toast('Erro ao verificar versão: ' + e.message, 'e');
      return;
    }
    const versaoLocal = localStorage.getItem('col_locais_ver');
    if (versaoServidor && versaoLocal === versaoServidor) {
      toast('✅ Endereços já estão atualizados (v' + versaoServidor.slice(0,10) + ')', 's');
      return;
    }
    // Baixar endereços em chunks de 1000 (dt_locais_chunks) para reduzir leituras.
    const locaisSet = new Set();
    const endCapMapa = {};
    if (!versaoServidor) throw new Error('Versão da Base Geral de Endereços não encontrada.');
    const chunksSnap = await FS.collection('dt_locais_chunks').where('versao','==',versaoServidor).get();
    if (chunksSnap.empty) throw new Error('Base de endereços em chunks não publicada para a versão atual.');
    const docsUsar = chunksSnap.docs.slice().sort((a,b)=>Number((a.data()||{}).parte||0)-Number((b.data()||{}).parte||0));
    docsUsar.forEach(chunkDoc => {
      const dados = chunkDoc.data().dados || chunkDoc.data().itens || [];
      dados.forEach(d => {
        if (d.ativo === false) return;
        const end = _normStr ? _normStr(d.endereco || '') : String(d.endereco || '').trim().toUpperCase().replace(/\s+/g,' ');
        if (!end) return;
        locaisSet.add(end);
        const cap = parseInt(d.capacidade_paletes ?? d.capacidade_pallets ?? d.capacidade_palete ?? d.capacidade_pallet ?? d.capacidade ?? d.max_pallets ?? 0);
        if (cap > 0) endCapMapa[end] = cap;
      });
    });
    // Salvar cache
    try {
      localStorage.setItem('col_locais',     JSON.stringify(endCapMapa));
      localStorage.setItem('col_locais_set', JSON.stringify([...locaisSet]));
      if (versaoServidor) localStorage.setItem('col_locais_ver', versaoServidor);
    } catch(e){ console.warn("[Erro tratado]", e); }
    // Atualizar APP em memória (sem precisar recarregar inventário)
    APP.locaisAtivos = locaisSet;
    APP._locaisDoFirebase = true;
    if (APP.endCapacidade) Object.assign(APP.endCapacidade, endCapMapa);
    // Atualizar campo de versão na tela
    const verStr = versaoServidor ? ('v' + versaoServidor.slice(0,12)) : 'sem versão';
    const el = document.getElementById('st-locais-ver');
    if (el) el.textContent = verStr;
    toast('✅ ' + locaisSet.size + ' endereços atualizados (' + verStr + ')', 's');
    dbg('[dt_locais] atualização manual: ' + locaisSet.size + ' ends | ver:', versaoServidor);
  } catch(e) {
    toast('Erro ao atualizar endereços: ' + e.message, 'e');
    console.warn('[dt_locais] atualizarCacheLocais erro:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar endereços'; }
  }
}



// v276 — Cards de status baseados em um livro-caixa local persistente.
// Cada registro salvo é mantido como PENDENTE ou ENVIADO, inclusive após
// recarregar a página, ficar offline ou sair da tela de contagem.
(function(){
  const KEY='dt_coletor_status_ledger_v276';
  function load(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(_){return {};}}
  function save(v){try{localStorage.setItem(KEY,JSON.stringify(v));}catch(_){}}
  function scope(tipo,id){return String(tipo||'inventario')+'::'+String(id||'sem-id');}
  function mark(tipo,id,registro,status){
    if(!registro)return; const rid=String(registro.uuid||registro.chave||registro.docId||registro.id||'').trim(); if(!rid)return;
    const all=load(), k=scope(tipo,id), box=all[k]||{itens:{}};
    box.itens[rid]={status:String(status||'PENDENTE').toUpperCase(),divergente:!!(registro._alertaQtd||registro.divergencia_potencial||registro.divergente||String(registro.status||'').toUpperCase()==='DIVERGENTE'),atualizadoEm:new Date().toISOString()};
    all[k]=box; save(all);
    try{window.dispatchEvent(new CustomEvent('dt-status-ledger-atualizado'));}catch(_){ }
  }
  function resumo(tipo,id){
    const all=load(), box=all[scope(tipo,id)]||{itens:{}}, vals=Object.values(box.itens||{});
    const pendentes=vals.filter(x=>x.status!=='ENVIADO').length;
    return {total:vals.length,enviadas:vals.length-pendentes,pendentes,divergencias:vals.filter(x=>x.divergente).length};
  }
  function reconciliar(tipo,id,registrosPendentes,registrosConhecidos){
    const all=load(), k=scope(tipo,id), box=all[k]||{itens:{}};
    const pend=new Set((registrosPendentes||[]).map(r=>String(r.uuid||r.chave||r.docId||r.id||'')).filter(Boolean));
    (registrosConhecidos||[]).forEach(r=>{
      const rid=String(r.uuid||r.chave||r.docId||r.id||'').trim(); if(!rid)return;
      const anterior=box.itens[rid]||{};
      box.itens[rid]={
        status:pend.has(rid)?'PENDENTE':(anterior.status||'ENVIADO'),
        divergente:!!(anterior.divergente||r._alertaQtd||r.divergencia_potencial||r.divergente||String(r.status||'').toUpperCase()==='DIVERGENTE'),
        atualizadoEm:new Date().toISOString()
      };
    });
    (registrosPendentes||[]).forEach(r=>{
      const rid=String(r.uuid||r.chave||r.docId||r.id||'').trim(); if(!rid)return;
      const anterior=box.itens[rid]||{};
      box.itens[rid]={status:'PENDENTE',divergente:!!(anterior.divergente||r._alertaQtd||r.divergencia_potencial||r.divergente),atualizadoEm:new Date().toISOString()};
    });
    all[k]=box; save(all);
  }
  window.DTStatusLedger={mark,resumo,reconciliar};
})();

// v156 — Status da Auditoria offline baseado na fila IndexedDB.
(function(){
  const _updateStatsBase = window.updateStats;
  let _audStatsSeq = 0;
  function _audDocId(r){ return String((r && (r.docId || r.id)) || '').trim(); }
  function _audStatus(r){ return String((r && (r.status || (r.payload && r.payload.status))) || '').trim().toUpperCase(); }
  async function _atualizarStatsAuditoriaOffline(){
    if (!window.APP || APP.modoAcesso !== 'auditoria' || !window.DTAuditoriaStorage) return;
    const seq = ++_audStatsSeq;
    const audId = String(APP.inventario?.auditoria_id || APP.inventario?.id || '').trim();
    if (!audId) return;
    let fila = [];
    try { fila = await DTAuditoriaStorage.filaAll(); } catch(e) { fila = []; }
    if (seq !== _audStatsSeq) return;
    const pendFila = fila.filter(x => String(x.auditoriaId || '') === audId && (x.subcolecao || 'enderecos') === 'enderecos');
    const mapa = new Map();
    (APP.contagens || []).forEach(r => {
      if (String(r.auditoriaId || r.auditoria_id || '') !== audId) return;
      const id = _audDocId(r); if (id) mapa.set(id, r);
    });
    pendFila.forEach(x => { const id = _audDocId(x); if (id) mapa.set(id, Object.assign({id:id}, x.payload || {})); });
    // Todo registro salvo no aparelho conta como auditoria realizada, mesmo antes
    // de o servidor devolver OK/DIVERGENTE. Antes este filtro aceitava apenas
    // status finais e, por isso, a barra mostrava 50 na fila enquanto os cards
    // exibiam zero.
    const resultados = Array.from(mapa.values());
    const pendIds = new Set(pendFila.map(_audDocId).filter(Boolean));
    const lr = window.DTStatusLedger ? DTStatusLedger.resumo('auditoria',audId) : {total:0,enviadas:0,pendentes:0,divergencias:0};
    const total = Math.max(resultados.length, lr.total);
    const pendentes = Math.max(resultados.filter(r => pendIds.has(_audDocId(r))).length, lr.pendentes);
    const enviadas = Math.max(lr.enviadas, total - pendentes);
    const divergencias = Math.max(resultados.filter(r => _audStatus(r) === 'DIVERGENTE').length, lr.divergencias);
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=String(v); };
    set('st-total', total); set('st-enviadas', enviadas); set('st-pendentes', pendentes); set('st-div', divergencias);
    window._dtAuditoriaPendentes = pendentes;
    const bar=document.getElementById('sync-bar'), txt=document.getElementById('sync-bar-text'), spin=document.getElementById('sync-bar-spinner');
    const label=document.getElementById('conn-label');
    if (!navigator.onLine) {
      if (bar) { bar.style.display='flex'; bar.style.background='linear-gradient(90deg,#7c2d12,#92400e)'; }
      if (txt) txt.textContent=`📵 Sem internet — ${pendentes} auditoria(s) salva(s) localmente e aguardando envio`;
      if (spin) spin.textContent='💾';
      if (label) label.textContent=pendentes > 0 ? `📵 ${pendentes} na fila` : '📵 Offline';
    } else if (pendentes > 0) {
      if (bar) { bar.style.display='flex'; bar.style.background='linear-gradient(90deg,#1e3a8a,#1d4ed8)'; }
      if (txt) txt.textContent=`⬆️ Sincronizando ${pendentes} auditoria(s) com Firebase…`;
      if (spin) spin.textContent='🔄';
      if (label) label.textContent=`⬆ ${pendentes} pend.`;
    }
  }
  window.atualizarStatsAuditoriaOffline = _atualizarStatsAuditoriaOffline;
  window.updateStats = function(){
    if (typeof _updateStatsBase === 'function') _updateStatsBase.apply(this, arguments);
    _atualizarStatsAuditoriaOffline().catch(function(e){ console.warn('[AUDITORIA] Status offline:', e); });
  };
  window.addEventListener('dt-auditoria-salva', function(){ window.updateStats(); });
  window.addEventListener('online', function(){ setTimeout(function(){ window.updateStats(); }, 300); });
  window.addEventListener('offline', function(){ window.updateStats(); });
})();


// v157 — Status do modo Inventário baseado na fila real do IndexedDB.
(function(){
  const _updateStatsAnterior = window.updateStats;
  let _invStatsSeq = 0;
  function _invAtiva(c){ return c && !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA'; }
  function _invId(c){ return String((c && (c.inventario_id || c.inventarioId)) || '').trim(); }
  function _invUuid(c){ return String((c && (c.uuid || c.id)) || '').trim(); }
  function _invDivergenciaLocal(c){ return !!(c && (c._alertaQtd === true || c.divergencia_potencial === true || c.divergente === true)); }
  window.updateStats = function(){
    if (window.APP && APP.modoAcesso === 'auditoria') return _updateStatsAnterior.apply(this, arguments);
    const seq = ++_invStatsSeq;
    const invId = String(APP.inventario?.id || '').trim();
    const ativas = (APP.contagens || []).filter(_invAtiva).filter(c => !invId || _invId(c) === invId);
    const aplicar = (fila) => {
      if (seq !== _invStatsSeq) return;
      fila = Array.isArray(fila) ? fila : [];
      const pendInv = fila.filter(_invAtiva).filter(c => !invId || _invId(c) === invId);
      const pendIds = new Set(pendInv.map(_invUuid).filter(Boolean));
      if (window.DTStatusLedger && DTStatusLedger.reconciliar) {
        DTStatusLedger.reconciliar('inventario', invId, pendInv, ativas);
      }
      const lr = window.DTStatusLedger ? DTStatusLedger.resumo('inventario',invId) : {total:0,enviadas:0,pendentes:0,divergencias:0};
      const idsAtivos = new Set(ativas.map(_invUuid).filter(Boolean));
      const idsPend = new Set(pendInv.map(_invUuid).filter(Boolean));
      const total = Math.max(new Set([...idsAtivos, ...idsPend]).size, lr.total);
      const pendentes = Math.max(idsPend.size, lr.pendentes);
      const enviadas = Math.max(0, Math.max(lr.enviadas, total - pendentes));
      const divs = Math.max(ativas.filter(_invDivergenciaLocal).length, lr.divergencias);
      const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
      s('st-total', total); s('st-enviadas', enviadas); s('st-pendentes', pendentes); s('st-div', divs);
      s('st-op', APP.operador?.name || '—'); s('st-inv', APP.inventario?.nome || '—');
      s('st-base', APP.base.length ? APP.base.length + ' registros' : '—');
      s('st-net', navigator.onLine ? '🟢 Online' : '🔴 Offline');
      s('st-coletor', localStorage.getItem('dt_device_id')?.slice(0,20) || '—');
      const locVer=localStorage.getItem('col_locais_ver');
      s('st-locais-ver', locVer ? ('v'+locVer.slice(0,12)+(locVer.length>12?'…':'')) : 'sem cache');
      const stAud=document.getElementById('st-aud'); if(stAud) stAud.textContent=(APP.auditorias||[]).length;
      atualizarBarraStatus();
    };
    aplicar(FILA_ENVIO || []);
    if (typeof idbGetPendentes === 'function') {
      Promise.resolve(idbGetPendentes()).then(fila => {
        FILA_ENVIO = Array.isArray(fila) ? fila : [];
        filaSave(FILA_ENVIO);
        aplicar(FILA_ENVIO);
      }).catch((erro) => {
        console.warn('[Histórico] Não foi possível carregar a fila pendente do IndexedDB', erro);
        aplicar(FILA_ENVIO || []);
      });
    }
  };
})();

window.addEventListener('dt-status-ledger-atualizado',function(){ if(typeof window.updateStats==='function') window.updateStats(); });
setInterval(function(){ if(typeof window.updateStats==='function') window.updateStats(); },2000);
