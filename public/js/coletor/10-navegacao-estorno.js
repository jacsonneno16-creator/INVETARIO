// ═══════════════════════════════════════════════════
//  NAVEGAÇÃO
// ═══════════════════════════════════════════════════
function goScreen(id) {
  const aliases={coleta:'app',auditoria:'app'};
  const destino=aliases[id]||id;
  const alvo=document.getElementById('screen-'+destino);
  if(!alvo){ console.error('[Navegacao] Tela inexistente:',id,'destino:',destino); return false; }
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  alvo.classList.add('active');
  return true;
}
// ═══════════════════════════════════════════════════
//  ↩️  ESTORNO DE CONTAGENS
//  Regra: marca _excluida=true + status='ESTORNADA'
//  sem apagar o doc — liberando o endereço para recontagem.
// ═══════════════════════════════════════════════════

/**
 * Renderiza a lista de contagens estornáveis do operador atual
 * neste inventário. Mostra também estornadas (para histórico),
 * mas apenas as ativas têm botão de estornar.
 */
async function renderEstorno() {
  const el    = document.getElementById('estorno-list');
  const badge = document.getElementById('estorno-badge');
  const invId = APP.inventario?.id;
  const op    = APP.operador?.name;

  if (!invId) {
    el.innerHTML = `<div class="empty"><div class="ei">📦</div><p>Selecione um inventário primeiro.</p></div>`;
    return;
  }

  el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:.8rem">⏳ Carregando…</div>`;

  try {
    // ── 1. Buscar do Firebase: dt_contagens E dt_vazios ──
    const [snapConts, snapVazios] = await Promise.all([
      FS.collection(FCOL.contagens)
        .where('inventario_id', '==', invId)
        .where('operador', '==', op)
        .get(),
      FS.collection('dt_vazios')
        .where('inventario_id', '==', invId)
        .where('operador', '==', op)
        .get(),
    ]);

    const docsFirebase = [
      ...snapConts.docs.map(d => ({ _docId: d.id, _colecao: 'dt_contagens', ...d.data() })),
      ...snapVazios.docs.map(d => ({ _docId: d.id, _colecao: 'dt_vazios',   ...d.data() })),
    ];

    // ── 2. Fundir com registros locais ainda não sincronizados ──
    const uuidsFirebase = new Set(docsFirebase.map(d => d._docId || d.uuid));
    const docsLocais = APP.contagens
      .filter(c => c.inventario_id === invId && c.operador === op && !uuidsFirebase.has(c.uuid))
      .map(c => ({ _docId: c.uuid, _local: true, ...c }));

    const todas = [...docsFirebase, ...docsLocais]
      .sort((a, b) => {
        const ta = a.dataHora?.toDate ? a.dataHora.toDate() : new Date(a.dataHora || 0);
        const tb = b.dataHora?.toDate ? b.dataHora.toDate() : new Date(b.dataHora || 0);
        return tb - ta;
      });

    if (!todas.length) {
      el.innerHTML = `<div class="empty"><div class="ei">✅</div><p>Nenhuma contagem neste inventário ainda.</p></div>`;
      if (badge) badge.textContent = '';
      return;
    }

    // ── 3. Separar ativas e estornadas ──
    const ativas    = todas.filter(c => !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA');
    const estornadas = todas.filter(c => c._excluida || c.status === 'ESTORNADA' || c.status === 'EXCLUIDA');

    if (badge) badge.textContent = `${ativas.length} ativa(s) · ${estornadas.length} estornada(s)`;

    const fmtData = (dh) => {
      if (!dh) return '—';
      try {
        const d = dh.toDate ? dh.toDate() : new Date(dh);
        return d.toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      } catch(e) { return '—'; }
    };

    const renderCard = (c, isEstornada) => {
      const isVazio = c.tipo_contagem === 'VAZIO';
      const corBorda  = isEstornada ? 'rgba(148,163,184,.3)' : isVazio ? 'rgba(100,116,139,.4)' : 'rgba(232,117,26,.2)';
      const corBordaL = isEstornada ? '#475569' : isVazio ? '#64748b' : 'var(--accent)';
      const opacidade = isEstornada ? 'opacity:.55' : '';
      const icone     = isVazio ? '📭' : '📦';
      const labelTipo = isVazio
        ? `<span style="font-size:.6rem;background:rgba(100,116,139,.2);color:#94a3b8;border-radius:4px;padding:1px 5px;margin-left:6px">VAZIO</span>`
        : '';
      const labelLocal = c._local
        ? `<span style="font-size:.6rem;background:rgba(255,179,0,.15);color:var(--warn);border-radius:4px;padding:1px 5px;margin-left:4px">pendente</span>`
        : '';

      return `
      <div style="
        background:var(--card);border:1px solid ${corBorda};border-left:3px solid ${corBordaL};
        border-radius:var(--r);padding:10px 12px;margin-bottom:6px;${opacidade}
      ">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px">
              <span style="font-size:.82rem;font-weight:700;font-family:var(--mono);color:${isEstornada?'var(--muted)':'var(--accent)'}">${icone} ${c.endereco || '—'}</span>
              ${labelTipo}${labelLocal}
            </div>
            <div style="font-size:.72rem;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${isVazio ? 'Endereço vazio confirmado' : (c.descricao || c.gtin || '—')}
            </div>
            <div style="font-size:.68rem;color:var(--muted);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap">
              ${!isVazio ? `<span>CP&nbsp;${c.capa||'—'}</span><span>Qtd&nbsp;<b>${c.quantidade}</b></span><span>Val&nbsp;${c.validade||'—'}</span>` : ''}
              <span>🕐&nbsp;${fmtData(c.dataHora)}</span>
            </div>
            ${isEstornada ? `<div style="font-size:.64rem;color:var(--muted);margin-top:4px;border-top:1px solid var(--border);padding-top:4px">
              ↩ Estornado por <b>${c.estornada_por||'—'}</b> em ${fmtData(c._excluida_em)}
            </div>` : ''}
          </div>
          <div style="flex-shrink:0">
            ${!isEstornada
              ? `<button onclick="estornarContagem('${c._docId}', ${!!c._local})"
                  style="background:rgba(255,71,87,.12);border:1px solid rgba(255,71,87,.3);color:#ff4757;
                         border-radius:8px;padding:6px 12px;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap">
                  ↩ Estornar
                </button>`
              : `<span style="font-size:.65rem;color:var(--muted);font-weight:700">ESTORNADA</span>`}
          </div>
        </div>
      </div>`;
    };

    let html = '';
    if (ativas.length) {
      html += `<div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px">Contagens ativas</div>`;
      html += ativas.map(c => renderCard(c, false)).join('');
    }
    if (estornadas.length) {
      html += `<div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:10px 0 6px">Estornadas (histórico)</div>`;
      html += estornadas.map(c => renderCard(c, true)).join('');
    }
    el.innerHTML = html;

  } catch(err) {
    console.error('[Estorno] renderEstorno:', err);
    el.innerHTML = `<div class="fb err" style="margin:0">✗ Erro ao carregar contagens: ${err.message}</div>`;
  }
}

/**
 * Estorna uma contagem: marca _excluida=true + status='ESTORNADA'.
 * Não apaga o documento — libera o endereço para nova contagem.
 */
async function estornarContagem(docId, isLocal = false) {
  const op = APP.operador?.name || 'Operador';

  const confirmado = await _confirmarEstorno(docId);
  if (!confirmado) return;

  try {
    if (isLocal) {
      // Registro ainda não sincronizado — marca só na memória local
      const idx = APP.contagens.findIndex(c => c.uuid === docId || c._docId === docId);
      if (idx >= 0) {
        APP.contagens[idx]._excluida    = true;
        APP.contagens[idx].status       = 'ESTORNADA';
        APP.contagens[idx]._excluida_em = new Date().toISOString();
        APP.contagens[idx].estornada_por = op;
      }
      // Atualizar também no IDB/fila para que o Firebase receba já marcado
      const filaAtual = await idbGetPendentes().catch(() => []);
      const reg = filaAtual.find(c => c.uuid === docId);
      if (reg) {
        await idbPut({ ...reg, _excluida: true, status: 'ESTORNADA', _excluida_em: new Date().toISOString(), estornada_por: op });
      }
    } else {
      // Registro já no Firebase — rotear para coleção correta
      // Verificar se é VAZIO (pode estar em dt_vazios)
      const _docLocal = APP.contagens.find(c => c.uuid === docId || c._docId === docId || c.id === docId);
      const _colEstorno = (_docLocal?.tipo_contagem === 'VAZIO' || _docLocal?._colecao === 'dt_vazios')
        ? 'dt_vazios' : FCOL.contagens;
      await FS.collection(_colEstorno).doc(docId).update({
        _excluida:    true,
        status:       'ESTORNADA',
        _excluida_em: new Date().toISOString(),
        estornada_por: op,
      });
      // Espelha na memória local
      const idx = APP.contagens.findIndex(c => c.uuid === docId || c._docId === docId || c.id === docId);
      if (idx >= 0) {
        APP.contagens[idx]._excluida    = true;
        APP.contagens[idx].status       = 'ESTORNADA';
        APP.contagens[idx]._excluida_em = new Date().toISOString();
        APP.contagens[idx].estornada_por = op;
      }
    }

    // Invalidar cache do endereço para liberar nova contagem
    _endVerif = null;

    toast('↩ Contagem estornada. Endereço liberado.', 's');
    renderEstorno();
    renderHistorico();
    updateStats();

  } catch(err) {
    console.error('[Estorno] estornarContagem:', err);
    toast('✗ Erro ao estornar: ' + err.message, 'e');
  }
}

/** Modal de confirmação inline (sem alert/confirm nativo) */
function _confirmarEstorno(docId) {
  return new Promise(resolve => {
    // Remove modal anterior se existir
    const old = document.getElementById('modal-estorno');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-estorno';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);
      display:flex;align-items:center;justify-content:center;padding:20px;
    `;
    modal.innerHTML = `
      <div style="
        background:var(--surface);border:1px solid var(--border);border-radius:16px;
        padding:24px;max-width:320px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5);
      ">
        <div style="font-size:1.4rem;text-align:center;margin-bottom:12px">↩️</div>
        <div style="font-weight:700;font-size:.92rem;text-align:center;margin-bottom:8px">Confirmar estorno</div>
        <div style="font-size:.78rem;color:var(--muted);text-align:center;margin-bottom:20px;line-height:1.5">
          Esta contagem será marcada como <b>ESTORNADA</b>.<br>
          O endereço ficará liberado para nova contagem.<br>
          <span style="color:var(--warn)">O histórico não será apagado.</span>
        </div>
        <div style="display:flex;gap:10px">
          <button id="btn-cancel-estorno" style="
            flex:1;padding:10px;border-radius:10px;border:1px solid var(--border);
            background:transparent;color:var(--muted);font-size:.82rem;cursor:pointer
          ">Cancelar</button>
          <button id="btn-ok-estorno" style="
            flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,71,87,.4);
            background:rgba(255,71,87,.15);color:#ff4757;font-size:.82rem;font-weight:700;cursor:pointer
          ">↩ Estornar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    document.getElementById('btn-ok-estorno').onclick = () => { modal.remove(); resolve(true); };
    document.getElementById('btn-cancel-estorno').onclick = () => { modal.remove(); resolve(false); };
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(false); } });
  });
}

function showView(v, el) {
  document.querySelectorAll('.view').forEach(e=>e.classList.remove('on'));
  document.querySelectorAll('.nav-tab').forEach(e=>e.classList.remove('on'));
  const viewAlvo=document.getElementById('view-'+v);
  if(!viewAlvo){ console.error('[Navegacao] View inexistente:',v); return false; }
  viewAlvo.classList.add('on');
  if (el) el.classList.add('on');
  if (v==='status')      updateStats();
  if (v==='estorno')     renderEstorno();
  if (v==='recontagens') renderRecontagensAtribuidas();
  if (v==='auditoria')   renderAuditoriaColetor();
}

