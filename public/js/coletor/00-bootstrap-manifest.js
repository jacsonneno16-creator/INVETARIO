
    (function() {
      const manifest = {
        name: "DT Inventário — Coletor",
        short_name: "DT Coletor",
        description: "Coletor de inventário Da Terrinha Alimentos",
        start_url: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#060d1a",
        theme_color: "#1E6F4E",
        icons: [
          { src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='36' fill='%231E6F4E'/%3E%3Ctext x='96' y='80' font-family='monospace' font-weight='700' font-size='52' fill='white' text-anchor='middle' dominant-baseline='middle'%3EDT%3C/text%3E%3Crect x='62' y='105' width='68' height='9' rx='4' fill='%23F59E0B'/%3E%3C/svg%3E", sizes: "192x192", type: "image/svg+xml" },
          { src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='96' fill='%231E6F4E'/%3E%3Ctext x='256' y='210' font-family='monospace' font-weight='700' font-size='140' fill='white' text-anchor='middle' dominant-baseline='middle'%3EDT%3C/text%3E%3Crect x='166' y='280' width='180' height='24' rx='10' fill='%23F59E0B'/%3E%3C/svg%3E", sizes: "512x512", type: "image/svg+xml" }
        ]
      };
      const blob = new Blob([JSON.stringify(manifest)], {type:'application/manifest+json'});
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('link');
      link.rel   = 'manifest';
      link.href  = url;
      document.head.appendChild(link);
    })();
  

// ===== PATCH AUDITORIA COLETOR v2 =====
(function(){
  window._audNorm = function(v){ return String(v == null ? '' : v).trim().replace(/\s+/g,' ').toUpperCase(); };
  window._audEndNorm = function(v){ return _audNorm(v).replace(/[^A-Z0-9]/g,''); };
  window._audItemKey = function(it){ return [_audNorm(it.codigo_produto || ''), _audNorm(it.produto_nome || ''), _audNorm(it.dun || ''), _audNorm(it.capa_palete || ''), _audNorm(it.data || ''), String((it.quantidade ?? it.quantidade_dun) ?? '').trim()].join('|'); };
  window._audSignature = function(itens){ return (itens || []).map(_audItemKey).sort().join('||'); };

window._audFormatDateColetor = function(v){
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
};

window._audResolverRua = function(r){
  return String(
    r.rua ||
    r.street ||
    r.corredor ||
    r.local_estoque_auditoria ||
    r.descricao_local_estoque ||
    r.local_de_estoque ||
    r.local_estoque ||
    r.descricao_setor_armazenagem ||
    r.setor_armazenagem ||
    r.setor_estoque ||
    'SEM RUA'
  ).trim().toUpperCase();
};

window._auditoriaDaBaseInventario = function(base, invRef){
  const inv = (invRef && typeof invRef === 'object') ? invRef : (APP.inventario || { id: invRef || '' });
  const invId = inv.id || '';

  if (Array.isArray(inv.auditoria_base_inicial) && inv.auditoria_base_inicial.length) {
    return [...inv.auditoria_base_inicial].sort((a,b) =>
      String(a.rua || '').localeCompare(String(b.rua || '')) ||
      String(a.endereco || '').localeCompare(String(b.endereco || ''))
    );
  }

  const rows = Array.isArray(base) ? base : [];
  const mapa = new Map();

  rows.forEach(r => {
    const endereco = String(r.endereco || r.codigo_endereco || r.endereco_logistico_descritivo || r.local || '').trim().toUpperCase();
    const endereco_norm = _audNorm(endereco);
    if (!endereco_norm) return;

    // DUN deve ser identificado separadamente do código interno do produto.
    // Se a base antiga trouxe um DUN de 13/14 dígitos dentro de codigo_produto,
    // movemos esse valor para dun e não usamos como código do produto.
    const codigoBruto = String(r.codigo_produto || r.codigo || r.sku || r.cod_produto || '').trim();
    const dunBruto = String(r.dun || r.dun14 || r.ean14 || r.gtin14 || '').trim();
    const codigoPareceDun = /^\d{13,14}$/.test(codigoBruto.replace(/\s/g,''));
    const dunFinal = (dunBruto || (codigoPareceDun ? codigoBruto : '')).trim();
    let capaFinal = String(r.capa_palete || r.capa || r.palete_key || r.pallete_ou_capa || '').trim();
    if (dunFinal && capaFinal.replace(/\s/g,'') === dunFinal.replace(/\s/g,'')) capaFinal = '';

    const qtdFinal = String(r.quantidade_esperada ?? r.quantidade ?? r.quantidade_dun ?? r.qtd ?? r.quantidade_enderecada ?? r.estoque_total_unidades ?? '').trim();
    const item = {
      codigo_produto: codigoPareceDun ? '' : codigoBruto,
      produto_nome: String(r.descricao_produto || r.produto_nome || r.produto || '').trim(),
      capa_palete: capaFinal,
      data: _audFormatDateColetor(r.data || r.validade || r.data_validade || r.data_de_validade || r.bb || r.vencimento || ''),
      dun: dunFinal,
      quantidade: qtdFinal,
      quantidade_dun: qtdFinal
    };

    const rua = _audResolverRua(r);

    if (!mapa.has(endereco_norm)) {
      mapa.set(endereco_norm, {
        id: `${invId}__BASE__${endereco_norm}`,
        inventario_id: invId,
        auditoria_id: `${invId}__BASE_INICIAL`,
        endereco,
        endereco_norm,
        rua,
        itens: [],
        itens_confirmados: [],
        status: 'PENDENTE',
        origem: 'BASE_INICIAL_INVENTARIO',
        disponivel_coletor: true,
        liberada_coletor: true
      });
    }
    mapa.get(endereco_norm).itens.push(item);
  });

  return [...mapa.values()].sort((a,b) =>
    String(a.rua || '').localeCompare(String(b.rua || '')) ||
    String(a.endereco || '').localeCompare(String(b.endereco || ''))
  );
};

window._auditoriaListaAtiva = function(){
  if ((APP.modoAcesso || 'inventario') === 'auditoria') return [...(APP.auditorias || [])];
  return [...(APP.auditoriaBase || [])];
};


window.iniciarListenerAuditoria = function(invId){
  if (_auditoriaListener) { try { _auditoriaListener(); } catch(e){} _auditoriaListener = null; }
  if (!invId) return;

  const atualizarBadge = function(){
    const lista = _auditoriaListaAtiva();
    const tab = document.getElementById('tab-auditoria');
    if (!tab) return;
    const old = tab.querySelector('.rec-badge');
    if (old) old.remove();
    if (lista.length) {
      const b = document.createElement('span');
      b.className = 'rec-badge';
      b.textContent = lista.length;
      b.style.background = 'var(--accent)';
      b.style.color = '#fff';
      tab.appendChild(b);
      tab.style.display = '';
    } else {
      tab.style.display = (APP.modoAcesso === 'auditoria') ? '' : 'none';
    }
    if (document.getElementById('view-auditoria')?.classList.contains('on')) renderAuditoriaColetor();
  };

  if ((APP.modoAcesso || 'inventario') !== 'auditoria') {
    // No modo inventário, não gerar auditoriaBase (aba auditoria fica oculta)
    APP.auditoriaBase = [];
    atualizarBadge();
    return;
  }

  _auditoriaListener = FS.collection(FCOL.auditorias)
    .where('inventario_id','==',invId)
    .onSnapshot(snap => {
      APP.auditorias = snap.docs
        .map(d => ({id:d.id, ...d.data()}))
        .filter(a => a.disponivel_coletor !== false && !['CONFIRMADO_SEM_AJUSTE','CONFIRMADO_COM_AJUSTE'].includes(String(a.status || '').toUpperCase()));
      atualizarBadge();
    }, err => console.warn('[AUD] listener auditoria:', err.message));
};

  window.renderAuditoriaColetor = function(){
    const wrap = document.getElementById('auditoria-lista-wrap');
    if (!wrap) return;
    const lista = _auditoriaListaAtiva().sort((a,b) => String(a.rua||'').localeCompare(String(b.rua||'')) || String(a.endereco||'').localeCompare(String(b.endereco||'')));
    if (!lista.length) {
      wrap.innerHTML = `<div class="empty"><div class="ei">📝</div><p>Nenhuma auditoria pendente para este inventário.</p></div>`;
      return;
    }
    const ruas = {};
    lista.forEach(a => { const rua = a.rua || 'SEM RUA'; (ruas[rua] ||= []).push(a); });
    wrap.innerHTML = Object.entries(ruas).map(([rua,itens], idx) => `
      <div class="card" style="padding:0;overflow:hidden;border-color:rgba(232,117,26,.24)">
        <div onclick="toggleAuditoriaRua('${esc(rua)}')" style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;background:rgba(232,117,26,.06)">
          <div><div style="font-size:.95rem;font-weight:800;color:var(--text)">${esc(rua)}</div><div style="font-size:.72rem;color:var(--muted)">${itens.length} endereço(s) pendente(s)</div></div>
          <div id="aud-rua-icon-${idx}" style="font-size:1rem;color:var(--accent)">▸</div>
        </div>
        <div id="aud-rua-body-${idx}" data-rua="${esc(rua)}" style="display:none;padding:10px 12px">
          ${itens.map(item => {
            const linhas = (item.itens_confirmados?.length ? item.itens_confirmados : item.itens || []);
            return `<div style="border:1px solid var(--border);border-radius:12px;margin-bottom:8px;overflow:hidden;background:var(--card)">
              <div onclick="toggleAuditoriaEndereco('${item.id}')" style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer">
                <div><div style="font-family:var(--mono);font-weight:800;color:var(--text)">${esc(item.endereco || '')}</div><div style="font-size:.7rem;color:var(--muted)">${linhas.length} item(ns) · ${item.status === 'REABERTO_ALTERACAO_BASE' ? 'Reaberto por alteração de base' : 'Pendente de confirmação'}</div></div>
                <div id="aud-item-icon-${item.id}" style="font-size:1rem;color:var(--accent)">▾</div>
              </div>
              <div id="aud-item-body-${item.id}" style="display:none;padding:0 14px 14px">
                <div style="overflow:auto;border:1px solid var(--border);border-radius:10px">
                  <table style="width:100%;border-collapse:collapse;font-size:.78rem">
                    <thead><tr style="background:rgba(255,255,255,.03)"><th style="padding:8px;text-align:left">Produto</th><th style="padding:8px;text-align:left">Data</th><th style="padding:8px;text-align:left">Capa</th><th style="padding:8px;text-align:left">DUN</th></tr></thead>
                    <tbody>
                      ${linhas.map((ln,j) => `<tr><td style="padding:8px"><input class="field" id="aud-prod-${item.id}-${j}" value="${esc(ln.produto_nome || '')}" style="height:40px!important;font-size:.85rem!important"/></td><td style="padding:8px"><input class="field" id="aud-data-${item.id}-${j}" value="${esc(ln.data || '')}" style="height:40px!important;font-size:.85rem!important"/></td><td style="padding:8px"><input class="field" id="aud-capa-${item.id}-${j}" value="${esc(ln.capa_palete || '')}" style="height:40px!important;font-size:.85rem!important"/></td><td style="padding:8px"><input class="field" id="aud-qtd-${item.id}-${j}" value="${esc(ln.quantidade_dun || '')}" style="height:40px!important;font-size:.85rem!important" inputmode="numeric"/></td></tr>`).join('')}
                    </tbody>
                  </table>
                </div>
                <button class="btn btn-success" style="margin-top:10px" onclick="confirmarAuditoriaItem('${item.id}')">✓ Confirmar endereço</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('');
  };

  window.confirmarAuditoriaItem = async function(id){
    const item = (APP.auditorias || []).find(a => a.id === id);
    if (!item) return;
    const origem = item.itens || [];
    const confirmados = origem.map((ln,j) => ({
      codigo_produto: ln.codigo_produto || '',
      produto_nome: document.getElementById(`aud-prod-${id}-${j}`)?.value?.trim() || '',
      data: document.getElementById(`aud-data-${id}-${j}`)?.value?.trim() || '',
      capa_palete: document.getElementById(`aud-capa-${id}-${j}`)?.value?.trim() || '',
      quantidade_dun: document.getElementById(`aud-qtd-${id}-${j}`)?.value?.trim() || '',
    }));
    const semAjuste = _audSignature(confirmados) === _audSignature(origem);
    const payload = {
      itens_confirmados: confirmados,
      confirmado_por: APP.operador?.name || '',
      confirmado_por_email: APP.operador?.email || '',
      confirmado_em: new Date().toISOString(),
      com_ajuste: !semAjuste,
      status: semAjuste ? 'CONFIRMADO_SEM_AJUSTE' : 'CONFIRMADO_COM_AJUSTE',
      disponivel_coletor: false,
      liberada_coletor: true,
      atualizado_em: new Date().toISOString(),
    };
    try {
      await FS.collection(FCOL.auditorias).doc(APP.inventario?.auditoria_id || APP.inventario?.id).collection('enderecos').doc(id).set(payload, { merge: true });
      APP.auditorias = (APP.auditorias || []).filter(a => a.id !== id);
      renderAuditoriaColetor();
      toast(semAjuste ? '✅ Confirmado sem ajuste' : '✅ Confirmado com ajuste', 's');
    } catch(e) {
      toast('Erro ao confirmar auditoria: ' + e.message, 'e');
    }
  };

  window._marcarAuditoriaBatidaSeHouver = async function(contagem){
    // [OTIMIZADO] Usa cache em memória (APP.auditorias) em vez de .get() no Firestore.
    // Cada contagem salva gerava uma leitura extra — agora zero leituras adicionais.
    if (!APP.inventario?.id) return false;
    const endNorm = _audEndNorm(contagem.endereco || '');
    if (!endNorm) return false;
    try {
      const docId = `${APP.inventario.id}__${endNorm}`;
      // Busca primeiro no cache em memória (APP.auditorias alimentado pelo onSnapshot)
      let a = (APP.auditorias || []).find(x => x.id === docId || _audEndNorm(x.endereco || '') === endNorm);
      // Se não está no cache local (pode estar confirmado e já removido da lista pendente),
      // só então faz .get() — e apenas uma vez por endereço (cache de confirmados)
      if (!a) {
        APP._auditoriaConfirmadaCache = APP._auditoriaConfirmadaCache || {};
        if (APP._auditoriaConfirmadaCache[docId] === false) return false; // já checado, não existe
        const snap = await FS.collection(FCOL.auditorias).doc(APP.inventario?.auditoria_id || APP.inventario?.id).collection('enderecos').doc(docId).get();
        if (!snap.exists) { APP._auditoriaConfirmadaCache[docId] = false; return false; }
        a = snap.data() || {};
        APP._auditoriaConfirmadaCache[docId] = a; // guarda para não buscar de novo
      }
      const status = String(a.status || '').toUpperCase();
      if (!['CONFIRMADO_SEM_AJUSTE','CONFIRMADO_COM_AJUSTE'].includes(status)) return false;
      const linhas = (a.itens_confirmados?.length ? a.itens_confirmados : a.itens || []);
      const bateu = linhas.some(ln =>
        _audNorm(ln.capa_palete || '') === _audNorm(contagem.capa || '') &&
        _audNorm(ln.data || '') === _audNorm(contagem.validade || '') &&
        String(ln.quantidade_dun || '').trim() === String(contagem.quantidade || '').trim() &&
        (_audNorm(ln.produto_nome || '') === _audNorm(contagem.descricao || contagem.descricao_produto || '') || _audNorm(ln.codigo_produto || '') === _audNorm(contagem.codigo_produto || ''))
      );
      if (bateu) {
        await FS.collection(FCOL.auditorias).doc(APP.inventario?.auditoria_id || APP.inventario?.id).collection('enderecos').doc(docId).set({ bateu_contagem:true, ultima_contagem_bateu_em:new Date().toISOString(), ultima_contagem_uuid:contagem.uuid || '' }, {merge:true});
        return true;
      }
    } catch(e) { console.warn('[AUD] Falha ao comparar auditoria:', e.message); }
    return false;
  };
})();


// v14: remover service workers antigos e registrar versão de rede-primeiro.
window.addEventListener('load', function(){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function(regs){
    return Promise.all(regs.map(function(r){ return r.unregister(); }));
  }).then(function(){ return navigator.serviceWorker.register('/sw-v14.js?v=14', {scope:'/'}); })
    .catch(function(e){ console.warn('[SW v14]',e && e.message); });
});
