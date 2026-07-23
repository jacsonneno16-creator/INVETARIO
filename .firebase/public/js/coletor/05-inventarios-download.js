// ═══════════════════════════════════════════════════
//  INVENTÁRIOS  (Firestore)
// ═══════════════════════════════════════════════════

function abrirModoInventario() {
  APP.modoAcesso = 'inventario';
  APP.modoPendente = 'inventario';
  goScreen('inventarios');
  carregarInventarios();
}
function abrirModoAuditoria() {
  APP.modoAcesso = 'auditoria';
  APP.modoPendente = 'auditoria';
  goScreen('auditorias');
  carregarAuditoriasMenu();
}
function _extrairLojasDoInventario(inv) {
  const lojas = [];
  const principal = String(inv?.loja_principal || '').trim();
  if (principal) lojas.push(principal);
  const espelho = Array.isArray(inv?.lojas_espelho) ? inv.lojas_espelho : [];
  espelho.forEach(loja => {
    loja = String(loja || '').trim();
    if (loja && !lojas.includes(loja)) lojas.push(loja);
  });
  return lojas;
}
function _getOperadorLojasPermitidas() {
  const op = APP.operador || {};
  const raw = op.lojas_permitidas || op.lojasPermitidas || [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(v => String(v || '').trim()).filter(Boolean))];
}
function _operadorTemAcessoTotalLojas() {
  const op = APP.operador || {};
  return op.acesso_todas_lojas === true || op.acessoTodasLojas === true;
}
function _filtrarInventariosPorAcessoOperador(lista) {
  const base = Array.isArray(lista) ? lista : [];
  if (_operadorTemAcessoTotalLojas()) return base;
  const permitidas = _getOperadorLojasPermitidas();
  if (!permitidas.length) return base;
  return base.filter(inv => _extrairLojasDoInventario(inv).some(loja => permitidas.includes(loja)));
}
function _popularSelectLojasColetor(lista, selectId, valorAtual) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const acessiveis = _filtrarInventariosPorAcessoOperador(lista || []);
  const lojas = [...new Set(acessiveis.flatMap(_extrairLojasDoInventario).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sel.innerHTML = '<option value="">Todas as lojas</option>' + lojas.map(loja => `<option value="${escHTML(loja)}">${escHTML(loja)}</option>`).join('');
  sel.value = lojas.includes(valorAtual) ? valorAtual : '';
}
function _filtrarInventariosPorLoja(lista, loja) {
  const alvo = String(loja || '').trim();
  if (!alvo) return lista || [];
  return (lista || []).filter(inv => _extrairLojasDoInventario(inv).includes(alvo));
}
function aplicarFiltroLojaInventario(loja) {
  APP.lojaFiltroInventario = String(loja || '').trim();
  renderListaInventarios(APP.inventariosDisponiveis || []);
}
function aplicarFiltroLojaAuditoria(loja) {
  APP.lojaFiltroAuditoria = String(loja || '').trim();
  renderListaAuditorias(APP.inventariosDisponiveis || []);
}
function _ajustarVisibilidadeFiltroLoja(cardId, lista) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const acessiveis = _filtrarInventariosPorAcessoOperador(lista || []);
  const lojas = [...new Set(acessiveis.flatMap(_extrairLojasDoInventario).filter(Boolean))];
  card.style.display = lojas.length > 1 ? '' : 'none';
}

function carregarAuditoriasMenu() {
  const el = document.getElementById('aud-list-menu');
  if (!el) return;
  el.innerHTML = '<div class="empty-inv"><div class="empty-inv-icon" style="font-size:1.5rem">⏳</div><div>Carregando auditorias…</div></div>';
  const fromCache = () => {
    const lista = invCacheLoad().filter(i => {
      const s = String(i.status || '').toUpperCase();
      return s === 'ATIVO' || s === 'PAUSADO';
    });
    APP.inventariosDisponiveis = lista;
    renderListaAuditorias(lista);
  };
  if (!navigator.onLine) { fromCache(); return; }
  FS.collection(FCOL.inventarios)
    .where('status', 'in', ['ATIVO', 'PAUSADO', 'Ativo', 'Pausado'])
    .get()
    .then(snap => {
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => !i.oculto_coletor);
      APP.inventariosDisponiveis = lista;
      invCacheSave(lista);
      renderListaAuditorias(lista);
    })
    .catch(() => fromCache());
}
function renderListaAuditorias(lista) {
  const el = document.getElementById('aud-list-menu');
  if (!el) return;
  _ajustarVisibilidadeFiltroLoja('aud-loja-card', lista);
  _popularSelectLojasColetor(lista, 'aud-loja-select', APP.lojaFiltroAuditoria);
  lista = _filtrarInventariosPorAcessoOperador(lista);
  lista = _filtrarInventariosPorLoja(lista, APP.lojaFiltroAuditoria);
  if (!lista.length) {
    el.innerHTML = '<div class="empty-inv"><div class="empty-inv-icon">📝</div><div style="font-size:.9rem;font-weight:600">Nenhuma auditoria disponível</div><div style="font-size:.78rem;margin-top:6px">Aguarde o analista liberar a auditoria</div></div>';
    return;
  }
  el.innerHTML = lista.map(inv => `
    <div class="inv-card" onclick="selecionarInventario('${inv.id}','auditoria')">
      <div class="inv-card-code">AUD-${escHTML(inv.codigo || inv.id)}</div>
      <div class="inv-card-name">Auditoria — ${escHTML(inv.nome || '')}</div>
      <div class="inv-card-meta">
        <span class="badge badge-info">📝 Auditoria</span>
        <span class="badge badge-muted">${inv.total_registros || 0} registros</span>
        <span class="badge badge-muted">${inv.data_inicio || ''}</span>
      </div>
    </div>
  `).join('');
}
function carregarInventarios() {
  const el = document.getElementById('inv-list');
  el.innerHTML = '<div class="empty-inv"><div class="empty-inv-icon" style="font-size:1.5rem">⏳</div><div>Carregando inventários…</div></div>';

  if (!navigator.onLine) {
    const cache = invCacheLoad().filter(i => {
      const s = (i.status || '').toUpperCase();
      return s === 'ATIVO' || s === 'PAUSADO';
    });
    APP.inventariosDisponiveis = cache;
    renderListaInventarios(cache);
    return;
  }

    FS.collection(FCOL.inventarios)
    .where('status', 'in', ['ATIVO', 'PAUSADO', 'Ativo', 'Pausado'])
    .get()
    .then(snap => {
      dbg('[Firestore] inventários encontrados:', snap.size);
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(i => !i.oculto_coletor);  // 🙈 ocultos pelo analista não aparecem
      APP.inventariosDisponiveis = lista;
      invCacheSave(lista);
      limparInventariosObsoletos(lista.map(i => i.id));  // 🗑 remove cache de inv. excluídos
      renderListaInventarios(lista);
    })
    .catch(err => {
      console.error('[Firestore] erro:', err.code, err.message);
      // Tentar sem filtro para diagnóstico
      FS.collection(FCOL.inventarios).limit(5).get()
        .then(snap2 => {
          dbg('[Firestore] sem filtro:', snap2.size, 'docs');
          const lista2 = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
          if (lista2.length) {
            // Coleção existe mas ou regra bloqueou a query com where, ou status difere
            const ativos = lista2.filter(i => i.status === 'ATIVO');
            if (ativos.length) {
              APP.inventariosDisponiveis = ativos;
              renderListaInventarios(ativos);
              return;
            }
            // Mostrar o que existe para diagnóstico
            const statusList = lista2.map(i => i.status || '?').join(', ');
            el.innerHTML = `<div class="empty-inv" style="gap:8px">
              <div class="empty-inv-icon">⚠️</div>
              <div style="font-size:.85rem;font-weight:600">Nenhum inventário com status ATIVO</div>
              <div style="font-size:.72rem;color:var(--muted);text-align:center">Encontrados ${lista2.length} doc(s) com status: ${statusList}</div>
              <div style="font-size:.72rem;color:var(--muted);text-align:center">Peça ao analista para clicar em "🔥 Sync Firebase"</div>
            </div>`;
          } else {
            el.innerHTML = `<div class="empty-inv" style="gap:8px">
              <div class="empty-inv-icon">❌</div>
              <div style="font-size:.85rem;font-weight:600">Erro de conexão com Firebase</div>
              <div style="font-size:.72rem;color:#f87171;text-align:center;word-break:break-all">${err.code || err.message}</div>
              <div style="font-size:.72rem;color:var(--muted);text-align:center;margin-top:4px">Verifique as regras de segurança do Firestore ou a conexão</div>
              <button onclick="carregarInventarios()" style="margin-top:8px;background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:.8rem;cursor:pointer">Tentar novamente</button>
            </div>`;
          }
        })
        .catch(err2 => {
          // Fallback para cache local
          const cache = invCacheLoad().filter(i => {
            const s = (i.status || '').toUpperCase();
            return s === 'ATIVO' || s === 'PAUSADO';
          });
          APP.inventariosDisponiveis = cache;
          if (cache.length) {
            renderListaInventarios(cache);
            toast('Carregado do cache local (offline)', 'w');
          } else {
            el.innerHTML = `<div class="empty-inv" style="gap:8px">
              <div class="empty-inv-icon">❌</div>
              <div style="font-size:.85rem;font-weight:600">Sem acesso ao Firebase</div>
              <div style="font-size:.72rem;color:#f87171;text-align:center">${err2.code}: ${err2.message}</div>
              <button onclick="carregarInventarios()" style="margin-top:8px;background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:.8rem;cursor:pointer">Tentar novamente</button>
            </div>`;
          }
        });
    });
}

function renderListaInventarios(lista) {
  const el = document.getElementById('inv-list');
  _ajustarVisibilidadeFiltroLoja('inv-loja-card', lista);
  _popularSelectLojasColetor(lista, 'inv-loja-select', APP.lojaFiltroInventario);
  lista = _filtrarInventariosPorAcessoOperador(lista);
  lista = _filtrarInventariosPorLoja(lista, APP.lojaFiltroInventario);
  if (!lista.length) {
    el.innerHTML = `
      <div class="empty-inv">
        <div class="empty-inv-icon">📦</div>
        <div style="font-size:.9rem;font-weight:600">Nenhum inventário ativo</div>
        <div style="font-size:.78rem;margin-top:6px">Aguarde o analista abrir um inventário</div>
      </div>`;
    return;
  }
  el.innerHTML = lista.map(inv => `
    <div class="inv-card" onclick="selecionarInventario('${inv.id}','inventario')">
      <div class="inv-card-code">${escHTML(inv.codigo || inv.id)}</div>
      <div class="inv-card-name">${escHTML(inv.nome)}</div>
      <div class="inv-card-meta">
        <span class="badge badge-ok">● ATIVO</span>
        <span class="badge badge-info">${inv.total_registros || 0} registros</span>
        <span class="badge badge-muted">${inv.data_inicio || ''}</span>
        ${inv.total_enderecos ? `<span class="badge badge-muted">📍 ${inv.total_enderecos} end.</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ─── Versão/timestamp da base no Firestore ──────────────────
function _invBaseVer(docData) {
  // Usar updated_at, data_atualizacao, base_version ou total_registros como proxy de versão
  return String(
    docData.updated_at || docData.data_atualizacao ||
    docData.base_version || docData.base_chunks || docData.total_registros || ''
  );
}

function selecionarInventario(id, modo = 'inventario') {
  APP.modoPendente = modo || 'inventario';
  const inv = (APP.inventariosDisponiveis || []).find(i => i.id === id);
  if (!inv) { toast('Inventário não encontrado', 'e'); return; }

  // ── Melhoria 5: verificar se base local já existe e está atualizada ──
  const metaLocal   = baseMetaLoad(id);
  const verLocal    = bVerLoad(id);
  const verServidor = _invBaseVer(inv);
  const baseLocal   = metaLocal ? baseLoad(id) : null;
  const capLocal    = endCapLoad(id);

  const cacheValido = (
    baseLocal &&
    baseLocal.length > 0 &&
    // Cache é válido se a versão bate OU se não há versão para comparar
    (verServidor === '' || verLocal === verServidor)
  );

  if (cacheValido) {
    // ── Usar cache local — sem download ──────────────────────
    dbg('[cache] base local válida —', baseLocal.length, 'registros, ver:', verLocal);
    APP.inventario    = inv;
    APP.base          = baseLocal;

    // Capacidade: começar com o que a base tem, depois sobrepor com dt_locais (fonte principal)
    let capMapa = _recalcularEndCap(baseLocal);
    try {
      const cached = localStorage.getItem(LS_LOCAIS);
      if (cached) {
        const locaisMap = JSON.parse(cached);
        Object.entries(locaisMap).forEach(([k, v]) => { if (v > 0) capMapa[k] = v; });
        dbg('[dt_locais cache] mesclado:', Object.values(capMapa).filter(v=>v>0).length, 'com cap');
      }
    } catch(e) {}
    APP.endCapacidade = capMapa;
    endCapSave(id, capMapa);

    // Restaurar set de endereços válidos do cache
    try {
      const cs = localStorage.getItem(LS_LOCAIS + '_set');
      APP.locaisAtivos = cs ? new Set(JSON.parse(cs)) : new Set(baseLocal.map(r => r._end).filter(Boolean));
    } catch(e) {
      APP.locaisAtivos = new Set(baseLocal.map(r => r._end).filter(Boolean));
    }

    APP.proximoCapa   = calcularProximoCapa();
    _aplicarInventario(inv, APP.modoPendente || 'inventario');
    toast(`✅ Base local carregada (${baseLocal.length} registros)`, 's');
    return;
  }

  // ── Precisa baixar: sem cache ou versão desatualizada ─────
  dbg('[cache] download necessário — cacheValido:', cacheValido, 'ver local:', verLocal, 'servidor:', verServidor);
  _iniciarTelaDowload(inv);
}

function _iniciarTelaDowload(inv) {
  document.getElementById('dl-inv-nome').textContent   = inv.nome || inv.id;
  document.getElementById('dl-status-txt').textContent = 'Preparando download…';
  document.getElementById('dl-bar-fg').style.width     = '0%';
  document.getElementById('dl-pct').textContent        = '0%';
  document.getElementById('dl-steps').innerHTML        = '';
  const btnEntrar  = document.getElementById('dl-btn-entrar');
  const btnCancel  = document.getElementById('dl-btn-cancel');
  const dlErro     = document.getElementById('dl-erro');
  if (btnEntrar) btnEntrar.style.display = 'none';
  if (btnCancel) btnCancel.style.display = '';
  if (dlErro)    dlErro.style.display    = 'none';
  document.getElementById('dl-icon').textContent = '📦';

  goScreen('download');
  _executarDownload(inv).catch(err => _dlSetErro('Falha: ' + (err.message || err)));
}

function _atualizarHintCapa() {
  const hintEl = document.getElementById('cp-proximo-hint');
  if (!hintEl) return;
  const range = APP.capaRange;
  hintEl.textContent = (range?.min && range?.max)
    ? `Range: ${range.min}–${range.max} · Próximo: ${APP.proximoCapa}`
    : 'Próximo disponível: ' + APP.proximoCapa;
}

async function garantirRangeCapaOperador(inv) {
  const nomeOp = String(APP.operador?.name || '').trim();
  const inicioBase = Math.max(1, parseInt(inv?.capa_inicio_base ?? inv?.capa_inicio ?? 1) || 1);
  const lotePorOperador = Math.max(1, parseInt(inv?.capa_lote_por_operador ?? 200) || 200);
  const listaAtual = Array.isArray(inv?.capa_ranges) ? inv.capa_ranges.slice() : [];

  let meuRange = listaAtual.find(r => String(r?.operador || '').trim() === nomeOp || r?.operador === '*');
  if (meuRange) {
    APP.capaRange = { min: parseInt(meuRange.min) || inicioBase, max: parseInt(meuRange.max) || (inicioBase + lotePorOperador - 1) };
    APP.proximoCapa = calcularProximoCapa();
    _atualizarHintCapa();
    return APP.capaRange;
  }

  if (!inv?.id || !nomeOp || !navigator.onLine) {
    APP.capaRange = null;
    APP.proximoCapa = calcularProximoCapa();
    _atualizarHintCapa();
    return null;
  }

  try {
    const ref = FS.collection(FCOL.inventarios).doc(inv.id);
    let rangeGerado = null;

    await FS.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const ranges = Array.isArray(data.capa_ranges) ? data.capa_ranges.slice() : [];

      const existente = ranges.find(r => String(r?.operador || '').trim() === nomeOp || r?.operador === '*');
      if (existente) {
        rangeGerado = existente;
        return;
      }

      const maiorFim = ranges.reduce((acc, r) => Math.max(acc, parseInt(r?.max) || 0), inicioBase - 1);
      const min = Math.max(inicioBase, maiorFim + 1);
      const max = min + lotePorOperador - 1;

      rangeGerado = {
        operador: nomeOp,
        min,
        max,
        lote: lotePorOperador,
        criado_em: new Date().toISOString()
      };

      ranges.push(rangeGerado);
      tx.set(ref, {
        capa_ranges: ranges,
        capa_inicio_base: inicioBase,
        capa_lote_por_operador: lotePorOperador,
        atualizado_em: new Date()
      }, { merge: true });
    });

    if (rangeGerado) {
      inv.capa_ranges = Array.isArray(inv.capa_ranges) ? inv.capa_ranges : [];
      if (!inv.capa_ranges.some(r => String(r?.operador || '').trim() === nomeOp || r?.operador === '*')) {
        inv.capa_ranges.push(rangeGerado);
      }
      APP.capaRange = { min: parseInt(rangeGerado.min) || inicioBase, max: parseInt(rangeGerado.max) || (inicioBase + lotePorOperador - 1) };
    } else {
      APP.capaRange = null;
    }
  } catch (e) {
    console.warn('[capa] Falha ao reservar range automático:', e?.message || e);
    APP.capaRange = null;
  }

  APP.proximoCapa = calcularProximoCapa();
  _atualizarHintCapa();
  return APP.capaRange;
}

async function _aplicarInventario(inv, modo = 'inventario') {
  document.getElementById('app-inv-name').textContent = inv.nome || inv.id;
  APP.contagens              = [];
  APP.contagensOutros        = [];
  APP.recontagens            = [];
  APP.divergenciasAtribuidas = [];
  APP.modoRecontagem         = null;
  APP.recPalletAtual         = 1;
  APP.sessionStart           = new Date();
  APP.sessaoId               = gerarUUID();
  _recJaAtivouAba            = false;

  // Carregar / reservar range de capa palete do inventário
  await garantirRangeCapaOperador(inv);

  APP.modoAcesso = modo || 'inventario';
  // No modo inventário, auditoriaBase fica vazio (aba auditoria oculta no modo inventário)
  APP.auditoriaBase = [];

  // Iniciar listener de recontagens em tempo real
  setTimeout(() => iniciarListenerRecontagens(inv.id), 0);
  setTimeout(() => iniciarListenerAuditoria(inv.id), 0);
  const tabs = {
    contar: document.getElementById('tab-contar'),
    historico: document.getElementById('tab-historico'),
    recontagens: document.getElementById('tab-recontagens'),
    estorno: document.getElementById('tab-estorno'),
    auditoria: document.getElementById('tab-auditoria'),
    status: document.getElementById('tab-status')
  };
  if (APP.modoAcesso === 'auditoria') {
    if (tabs.contar) tabs.contar.style.display = 'none';
    if (tabs.historico) tabs.historico.style.display = 'none';
    if (tabs.recontagens) tabs.recontagens.style.display = 'none';
    if (tabs.estorno) tabs.estorno.style.display = 'none';
    if (tabs.auditoria) tabs.auditoria.style.display = '';
    if (tabs.status) tabs.status.style.display = '';
  } else {
    if (tabs.contar) tabs.contar.style.display = '';
    if (tabs.historico) tabs.historico.style.display = '';
    if (tabs.recontagens) tabs.recontagens.style.display = '';
    if (tabs.estorno) tabs.estorno.style.display = '';
    // Aba de auditoria sempre oculta no modo inventário — só aparece no modo auditoria
    if (tabs.auditoria) tabs.auditoria.style.display = 'none';
    if (tabs.status) tabs.status.style.display = '';
  }

  resetContagem();
  updateStats();
  atualizarBarraStatus();
  const el = document.getElementById('st-inicio');
  if (el) el.textContent = fmtTime(APP.sessionStart);
  goScreen('app');
  if (APP.modoAcesso === 'auditoria') {
    const audTab = document.getElementById('tab-auditoria');
    if (audTab) showView('auditoria', audTab);
    renderAuditoriaColetor();
  } else {
    const contTab = document.getElementById('tab-contar');
    if (contTab) showView('contar', contTab);
  }
}

// ─── Cancelar / Entrar após download ─────────────────────────
let _dlCancelado = false;

function cancelarDownload() {
  _dlCancelado = true;
  APP.inventario = null;
  if (APP.modoPendente === 'auditoria') { goScreen('auditorias'); } else { goScreen('inventarios'); }
}

function entrarInventario() {
  _aplicarInventario(APP.inventario, APP.modoPendente || APP.modoAcesso || 'inventario');
}

// ─── Motor de download ────────────────────────────────────────
async function _executarDownload(inv) {
  const invId = inv.id;
  _dlCancelado = false;

  // Verificar offline — usar cache se existir
  const baseLocal = baseLoad(invId);
  if (!navigator.onLine && baseLocal && baseLocal.length > 0) {
    _dlStep('offline', '💾', 'Modo offline', baseLocal.length + ' registros do cache', 'ok');
    _dlProg(100, 'Pronto (offline)');
    APP.inventario    = inv;
    APP.base          = baseLocal;
    APP.endCapacidade = _recalcularEndCap(baseLocal);
    endCapSave(invId, APP.endCapacidade);
    _concluirDownload(baseLocal.length);
    return;
  }

  // Etapa 1: metadados
  _dlProg(10, 'Baixando metadados…');
  _dlStep('meta', '📋', 'Metadados', 'Carregando…', 'run');
  if (_dlCancelado) return;

  let docData;
  try {
    const snap = await FS.collection(FCOL.inventarios).doc(invId).get();
    if (!snap.exists) throw new Error('Inventário não encontrado');
    docData = { id: snap.id, ...snap.data() };
  } catch(e) {
    _dlStep('meta', '📋', 'Metadados', 'Erro: ' + e.message, 'err');
    if (baseLocal && baseLocal.length > 0) {
      APP.base = baseLocal;
      APP.endCapacidade = _recalcularEndCap(baseLocal);
      endCapSave(invId, APP.endCapacidade);
      _dlProg(100, 'Usando cache local'); _concluirDownload(baseLocal.length); return;
    }
    throw e;
  }
  _dlStep('meta', '📋', 'Metadados',
    (docData.total_registros || '?') + ' registros · ' + (docData.total_enderecos || '?') + ' endereços', 'ok');
  _dlProg(20);
  if (_dlCancelado) return;

  // Etapa 2: base de produtos (chunks)
  _dlProg(25, 'Baixando base de produtos…');
  _dlStep('base', '📦', 'Base de produtos', 'Carregando…', 'run');

  const nChunks = docData.base_chunks || 0;
  let baseRaw = [];

  if (nChunks > 0) {
    try {
      const cSnap = await FS.collection(FCOL.inventarios).doc(invId)
                      .collection('base_chunks').orderBy('parte').get();
      const total = cSnap.docs.length;
      for (let i = 0; i < total; i++) {
        if (_dlCancelado) return;
        const itens = cSnap.docs[i].data().itens || cSnap.docs[i].data().registros || [];
        baseRaw = baseRaw.concat(itens);
        const pct = 25 + Math.round(60 * (i + 1) / total);
        _dlProg(pct, `Chunk ${i+1}/${total} — ${baseRaw.length} registros`);
        _dlStep('base', '📦', 'Base de produtos', baseRaw.length + ' registros…', 'run');
      }
    } catch(e) {
      _dlStep('base', '📦', 'Base de produtos', 'Erro: ' + e.message, 'err');
      if (baseLocal && baseLocal.length > 0) {
        APP.base = baseLocal;
        APP.endCapacidade = _recalcularEndCap(baseLocal);
        endCapSave(invId, APP.endCapacidade);
        _concluirDownload(baseLocal.length); return;
      }
      throw e;
    }
  } else if (Array.isArray(docData.base)) {
    baseRaw = docData.base;
    _dlProg(85, baseRaw.length + ' registros no documento');
  } else {
    _dlStep('base', '📦', 'Base de produtos', 'Base não encontrada no servidor!', 'err');
    _dlSetErro('A base deste inventário não foi publicada ainda. Peça ao analista para publicar o inventário no sistema.');
    return; // bloquear entrada sem base
  }

  // ── NORMALIZAR A BASE (melhoria 1+2) ──
  _dlStep('norm', '🔧', 'Normalizando campos', 'Padronizando nomes de colunas…', 'run');
  _dlProg(87, 'Normalizando…');
  const baseNorm = normalizarBase(baseRaw);
  _dlStep('norm', '🔧', 'Normalizando campos',
    `${baseNorm.length} registros normalizados`, 'ok');
  _dlStep('base', '📦', 'Base de produtos', baseNorm.length + ' registros', 'ok');
  _dlProg(90);
  if (_dlCancelado) return;

  // ──────────────────────────────────────────────────────────────────────────
  // Etapa 3: dt_locais — cache versionado
  //
  // Fluxo:
  //   1. Lê 1 doc "dt_locais_meta/versao" (doc pequeno, 1 leitura)
  //   2. Compara com versão salva em localStorage
  //   3. Cache válido → usa localStorage, zero leituras adicionais
  //   4. Cache inválido ou forceRefresh → baixa dt_locais e persiste cache
  //
  // O operador pode forçar atualização via botão na tela de status
  // que chama atualizarCacheLocais() — seta LS_LOCAIS_VER = '' e recarrega.
  // ──────────────────────────────────────────────────────────────────────────
  _dlProg(92, 'Carregando capacidade dos endereços…');
  _dlStep('cap', '🏷️', 'Capacidade de pallets', 'Verificando cache…', 'run');

  let endCapMapa = {};

  // forceRefresh: definido externamente quando o operador clica em "Atualizar endereços"
  const _forceLocaisRefresh = !!window._locaisForceRefresh;
  window._locaisForceRefresh = false;

  // ── Passo 1: ler versão do servidor (1 leitura de 1 doc pequeno) ──────────
  let versaoServidor = null;
  try {
    const metaDoc = await FS.collection('dt_locais_meta').doc('versao').get();
    if (metaDoc.exists) versaoServidor = String(metaDoc.data()?.versao ?? '');
    dbg('[dt_locais] versão servidor:', versaoServidor);
  } catch(e) {
    dbg('[dt_locais] config/locais_meta inacessível — forçará download:', e.message);
  }

  // ── Passo 2: ler versão salva localmente ──────────────────────────────────
  let versaoLocal = null;
  try { versaoLocal = localStorage.getItem(LS_LOCAIS_VER); } catch(e) {}

  // ── Passo 3: cache válido? ────────────────────────────────────────────────
  // _forceLocaisRefresh ignora a comparação de versão e força o download
  const _cacheValido = !_forceLocaisRefresh && versaoServidor !== null && versaoLocal === versaoServidor;

  if (_cacheValido) {
    // ✅ Cache válido — restaurar do localStorage, ZERO leituras de dt_locais
    dbg('[dt_locais] cache válido (ver=' + versaoLocal + ') — sem download');
    _dlStep('cap', '🏷️', 'Capacidade de pallets', 'Cache local ✓', 'ok');
    try {
      const raw = localStorage.getItem(LS_LOCAIS);
      if (raw) Object.assign(endCapMapa, JSON.parse(raw));
    } catch(e) {}
    try {
      const rawSet = localStorage.getItem(LS_LOCAIS_SET);
      if (rawSet) {
        APP.locaisAtivos = new Set(JSON.parse(rawSet));
        APP._locaisDoFirebase = true;
      } else {
        APP.locaisAtivos = new Set(baseNorm.map(r => r._end).filter(Boolean));
        APP._locaisDoFirebase = false;
      }
    } catch(e) {
      APP.locaisAtivos = new Set(baseNorm.map(r => r._end).filter(Boolean));
    }

  } else {
    // ⬇️ Cache ausente, desatualizado ou forçado pelo operador
    const motivo = _forceLocaisRefresh ? 'atualização manual' : ('local=' + versaoLocal + ' servidor=' + versaoServidor);
    dbg('[dt_locais] download necessário —', motivo);
    _dlStep('cap', '🏷️', 'Capacidade de pallets', _forceLocaisRefresh ? 'Atualizando endereços…' : 'Baixando endereços…', 'run');
    const locaisSet = new Set();
    try {
      // v15: leitura principal por chunks de 1000 endereços.
      // Reduz leituras de N endereços para aproximadamente N/1000 documentos.
      const chunksSnap = await FS.collection('dt_locais_chunks').orderBy('parte').get();
      if (!chunksSnap.empty) {
        chunksSnap.docs.forEach(chunkDoc => {
          const dados = chunkDoc.data().dados || chunkDoc.data().itens || [];
          dados.forEach(d => {
            if (d.ativo === false) return;
            const end = _normStr(d.endereco || '');
            if (!end) return;
            locaisSet.add(end);
            const cap = parseInt(
              d.capacidade_paletes ?? d.capacidade_pallets ?? d.capacidade_palete ??
              d.capacidade_pallet  ?? d.capacidade         ?? d.max_pallets        ?? 0
            );
            if (cap > 0) endCapMapa[end] = cap;
          });
        });
      } else {
        // Fallback para instalações antigas ainda sem dt_locais_chunks.
        const locSnap = await FS.collection(FCOL.locais).get();
        locSnap.docs.forEach(doc => {
          const d   = doc.data();
          if (d.ativo === false) return;
          const end = _normStr(d.endereco || doc.id);
          if (!end) return;
          locaisSet.add(end);
          const cap = parseInt(
            d.capacidade_paletes ?? d.capacidade_pallets ?? d.capacidade_palete ??
            d.capacidade_pallet  ?? d.capacidade         ?? d.max_pallets        ?? 0
          );
          if (cap > 0) endCapMapa[end] = cap;
        });
      }
      // Persistir cache + versão
      try {
        localStorage.setItem(LS_LOCAIS,     JSON.stringify(endCapMapa));
        localStorage.setItem(LS_LOCAIS_SET, JSON.stringify([...locaisSet]));
        if (versaoServidor) localStorage.setItem(LS_LOCAIS_VER, versaoServidor);
      } catch(e) {}
      APP.locaisAtivos = locaisSet;
      APP._locaisDoFirebase = true;
      dbg('[dt_locais] baixado:', locaisSet.size, 'endereços | cap:', Object.keys(endCapMapa).length, '| ver:', versaoServidor);
    } catch(e) {
      console.warn('[dt_locais] falha no download — restaurando cache:', e.message);
      try {
        const raw = localStorage.getItem(LS_LOCAIS);
        if (raw) Object.assign(endCapMapa, JSON.parse(raw));
      } catch(e2) {}
      try {
        const rawSet = localStorage.getItem(LS_LOCAIS_SET);
        APP.locaisAtivos = rawSet
          ? new Set(JSON.parse(rawSet))
          : new Set(baseNorm.map(r => r._end).filter(Boolean));
      } catch(e2) {
        APP.locaisAtivos = new Set(baseNorm.map(r => r._end).filter(Boolean));
      }
      if (!Object.keys(endCapMapa).length) endCapMapa = _recalcularEndCap(baseNorm);
    }
  }

  const comLimite = Object.values(endCapMapa).filter(v => v > 0).length;
  _dlStep('cap', '🏷️', 'Capacidade de pallets',
    Object.keys(endCapMapa).length + ' endereços · ' + comLimite + ' c/ limite', 'ok');
  _dlProg(95);

  // Etapa 4: salvar localmente
  _dlStep('save', '💾', 'Cache local', 'Salvando…', 'run');
  baseSave(invId, baseNorm);
  endCapSave(invId, endCapMapa);
  bVerSave(invId, _invBaseVer(docData));
  _dlStep('save', '💾', 'Cache local', 'Dados salvos para uso offline', 'ok');
  _dlProg(100, 'Download concluído!');

  APP.inventario    = { ...inv, ...docData };
  APP.base          = baseNorm;
  APP.endCapacidade = endCapMapa;

  atualizarInventarioColetor(); // 📡 atualiza inventário no doc do coletor

  _concluirDownload(baseNorm.length);
}

function _concluirDownload(totalReg) {
  if (_dlCancelado) return;
  document.getElementById('dl-icon').textContent = '✅';
  document.getElementById('dl-status-txt').textContent = `Pronto! ${totalReg} registros carregados`;
  const btnEntrar = document.getElementById('dl-btn-entrar');
  const btnCancel = document.getElementById('dl-btn-cancel');
  if (btnEntrar) btnEntrar.style.display = '';
  if (btnCancel) btnCancel.style.display = 'none';
  // Auto-entrar
  setTimeout(() => { if (!_dlCancelado) entrarInventario(); }, 800);
}

function _dlSetErro(msg) {
  document.getElementById('dl-status-txt').textContent = 'Erro no download';
  document.getElementById('dl-icon').textContent = '❌';
  const dlErro = document.getElementById('dl-erro');
  if (dlErro) { dlErro.style.display = ''; dlErro.textContent = msg; }
}

function _dlStep(id, icon, label, sub, estado) {
  const existing = document.getElementById('dl-step-' + id);
  if (existing) {
    existing.className = 'dl-step ' + estado;
    existing.querySelector('.dl-step-ic').textContent  = estado==='ok'?'✅':estado==='err'?'❌':'⏳';
    existing.querySelector('.dl-step-lbl').textContent = label;
    existing.querySelector('.dl-step-sub').textContent = sub || '';
  } else {
    const d = document.createElement('div');
    d.id = 'dl-step-' + id;
    d.className = 'dl-step ' + estado;
    d.innerHTML = `
      <span class="dl-step-ic">${estado==='ok'?'✅':estado==='err'?'❌':'⏳'}</span>
      <div class="dl-step-body">
        <div class="dl-step-lbl">${label}</div>
        <div class="dl-step-sub">${sub||''}</div>
      </div>`;
    document.getElementById('dl-steps').appendChild(d);
  }
}

function _dlProg(pct, txt) {
  document.getElementById('dl-bar-fg').style.width = pct + '%';
  document.getElementById('dl-pct').textContent = Math.round(pct) + '%';
  if (txt) document.getElementById('dl-status-txt').textContent = txt;
}

function voltarInventarios() {
  const pendFila = FILA_ENVIO.length;
  let msg = 'Trocar de inventário?';
  if (APP.contagens.length > 0 && pendFila > 0)
    msg = `Tem ${APP.contagens.length} contagem(ns) nesta sessão (${pendFila} na fila de envio). Voltar mesmo assim?`;
  else if (APP.contagens.length > 0)
    msg = `Tem ${APP.contagens.length} contagem(ns) nesta sessão. Voltar mesmo assim?`;
  if (APP.contagens.length > 0) { showConfirm(msg, _voltarInventarioConfirmado, { title: 'Voltar ao menu', icon: '↩️', okLabel: 'Voltar mesmo assim', okColor: '#ffb300' }); return; }
  _voltarInventarioConfirmado();
}
function _voltarInventarioConfirmado() {
  if (_recListener) { try { _recListener(); } catch(e){} _recListener = null; }
  if (_auditoriaListener) { try { _auditoriaListener(); } catch(e){} _auditoriaListener = null; }
  APP.inventario             = null;
  APP.base                   = [];
  APP.auditorias             = [];
  APP.contagens              = [];
  APP.recontagens            = [];
  APP.divergenciasAtribuidas = [];
  APP.modoRecontagem         = null;
  resetContagem();
  goScreen('inventarios');
}


