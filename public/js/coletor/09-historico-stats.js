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
    } catch(e) {}
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

