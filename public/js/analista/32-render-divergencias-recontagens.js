function state(){ return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  16. RENDERIZAÇÃO — DIVERGÊNCIAS
// ───────────────────────────────────────────────────────────────────

function marcarDivergenciaResolvida(divId) {
  const div = state().divergencias.find(d => d.id === divId);
  if (!div) return;
  showConfirm(`Marcar a divergência do endereço ${escHTML(div.endereco)} como RESOLVIDA?`, () => _marcarDivResolvida(divId), { title: '✅ Resolver divergência', icon: '✅', okLabel: 'Marcar resolvida', okClass: 'btn-success' }); return;
}

function _marcarDivResolvida(divId) {
  div.status        = 'RESOLVIDA';
  div.resolvida_em  = new Date().toISOString();
  div.resolvida_por = _currentAnalistaUser?.email || 'Analista';
  // Marcar recontagem associada também
  const rec = state().recontagens.find(r =>
    r.divergencia_id === divId ||
    (r.endereco === div.endereco && r.inventario_id === div.inventario_id)
  );
  if (rec) {
    rec.status             = 'CONCLUIDA';
    rec.status_recontagem  = 'concluida';  // ← campo que o coletor usa para filtrar
    rec.concluida_em       = div.resolvida_em;
    rec.resolvida_por      = div.resolvida_por;
    // ✅ Persistir recontagem no Firestore
    fsSalvarRecontagem(rec);
  }
  saveAll();
  // ✅ Persistir divergência atualizada no Firestore
  fsSalvarDivergencia(div);
  renderDivergencias();
  renderRecontagens();
  atualizarBadgesNav();
  logSistema('DIVERGENCIA', `Divergência ${divId} marcada como resolvida pelo analista`, { divId, endereco: div.endereco, inventario_id: div.inventario_id });
  showToast('✅ Divergência marcada como resolvida!', 's');
}

// ── Estado de seleção de divergências ──────────────────────────────────────
let _divSelecionadas = new Set();

function divAtualizarBarraSel() {
  const bar = document.getElementById('div-sel-bar');
  const cnt = document.getElementById('div-sel-count');
  if (!bar) return;
  if (_divSelecionadas.size > 0) {
    bar.style.display = 'flex';
    cnt.textContent = `${_divSelecionadas.size} endereço${_divSelecionadas.size !== 1 ? 's' : ''} selecionado${_divSelecionadas.size !== 1 ? 's' : ''}`;
  } else {
    bar.style.display = 'none';
  }
}

function divToggleSel(id, checked) {
  if (checked) _divSelecionadas.add(id);
  else _divSelecionadas.delete(id);
  divAtualizarBarraSel();
  // Atualizar checkbox master
  const chkAll = document.getElementById('div-chk-all');
  if (chkAll) {
    const total = document.querySelectorAll('.div-row-chk').length;
    chkAll.indeterminate = _divSelecionadas.size > 0 && _divSelecionadas.size < total;
    chkAll.checked = total > 0 && _divSelecionadas.size === total;
  }
}

function divToggleTodos(checked) {
  document.querySelectorAll('.div-row-chk').forEach(chk => {
    chk.checked = checked;
    const id = chk.dataset.id;
    if (checked) _divSelecionadas.add(id);
    else _divSelecionadas.delete(id);
  });
  divAtualizarBarraSel();
}

function divDeselecionarTodos() {
  _divSelecionadas.clear();
  document.querySelectorAll('.div-row-chk').forEach(c => c.checked = false);
  const chkAll = document.getElementById('div-chk-all');
  if (chkAll) { chkAll.checked = false; chkAll.indeterminate = false; }
  divAtualizarBarraSel();
}

function divAtribuirRapido(divId) {
  _divSelecionadas.clear();
  _divSelecionadas.add(divId);
  divAtualizarBarraSel();
  abrirAtribuirRecontagem();
}

// Atribuir a partir da aba Recontagens (recebe rec.id, localiza divergência correspondente)
function divAtribuirPorRec(recId) {
  const rec = state().recontagens.find(r => r.id === recId);
  if (!rec) { showToast('Recontagem não encontrada', 'e'); return; }
  // Encontrar ou criar divergência correspondente
  let divId = rec.divergencia_id;
  if (!divId) {
    // Fallback: usar o id da recontagem como referência temporária
    divId = recId;
  }
  _divSelecionadas.clear();
  if (divId && state().divergencias.find(d => d.id === divId)) {
    _divSelecionadas.add(divId);
  } else {
    // Sem divergência vinculada: atribuir direto na recontagem
    _recAtribuirDireto = rec;
    abrirAtribuirRecontagemDireto(rec);
    return;
  }
  divAtualizarBarraSel();
  abrirAtribuirRecontagem();
}

// Atribuição direta quando não há divergência vinculada (caso edge)
let _recAtribuirDireto = null;
async function abrirAtribuirRecontagemDireto(rec) {
  const resumo = document.getElementById('atrib-resumo');
  if (resumo) {
    resumo.innerHTML = `<div style="font-weight:700;margin-bottom:8px;color:var(--text)">📍 Recontagem: <span class="badge b-orange" style="font-size:.72rem">${rec.endereco}</span></div>
      <div style="font-size:.78rem;color:var(--muted)">${rec.produto}</div>`;
  }
  openModal('modal-atribuir-recontagem');
  document.getElementById('atrib-obs').value = '';
  await divPopularSelectOperadores('atrib-operador');
}

// ── Filtros rápidos ─────────────────────────────────────────────────────────
let _divFiltroRapidoAtivo = '';
function divFiltroRapido(tipo) {
  _divFiltroRapidoAtivo = _divFiltroRapidoAtivo === tipo ? '' : tipo;
  // Atualizar visual dos botões
  ['nao_atribuidas','minhas','pendentes','aguardando_analista','concluidas'].forEach(t => {
    const btn = document.getElementById('fq-' + t);
    if (btn) btn.style.background = _divFiltroRapidoAtivo === t ? 'var(--orange)' : '';
    if (btn) btn.style.color = _divFiltroRapidoAtivo === t ? '#fff' : '';
    if (btn) btn.style.borderColor = _divFiltroRapidoAtivo === t ? 'var(--orange)' : '';
  });
  if (tipo === 'limpar') {
    _divFiltroRapidoAtivo = '';
    // Limpar todos os filtros
    ['div-busca','div-frua','div-fnivel','div-fsetor','div-fproduto','div-foperador','div-fstatus-rec','div-fdata','div-ftipo','div-fstatus','div-ford','div-sel-inv'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }
  renderDivergencias();
}

// ── Popula o select de operadores a partir da lista carregada do Firestore ──
async function divPopularSelectOperadores(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const cur = sel.value;

  // Mostrar loading
  sel.innerHTML = `<option value="">⏳ Carregando operadores...</option>`;
  sel.disabled = true;

  let ops = [];

  // 1. Tentar usar _opListaCompleta já carregada
  if (typeof _opListaCompleta !== 'undefined' && _opListaCompleta.length) {
    ops = _opListaCompleta
      .filter(o => o.ativo !== false && o.tipo !== 'analista')
      .map(o => ({ id: o.id, nome: o.nome, cargo: o.cargo }));
  }

  // 2. Se vazia, buscar direto do Firestore
  if (!ops.length && typeof FS_AN !== 'undefined') {
    try {
      const snap = await FS_AN.collection('dt_operadores')
        .where('ativo', '==', true)
        .orderBy('nome')
        .get();
      if (!snap.empty) {
        ops = snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, nome: data.nome, cargo: data.cargo };
        }).filter(o => o.nome);
        // Atualiza cache
        if (typeof _opListaCompleta !== 'undefined') {
          snap.docs.forEach(d => {
            const existing = _opListaCompleta.find(x => x.id === d.id);
            if (!existing) _opListaCompleta.push({ id: d.id, ...d.data() });
          });
        }
      }
    } catch(e) {
      console.warn('[divPopularSelectOperadores] Firestore:', e.message);
    }
  }

  // 3. Fallback: operadores únicos das contagens locais
  if (!ops.length) {
    const nomes = [...new Set([
      ...state().contagens.map(c => c.operador),
      ...state().recontagens.map(r => r.operador),
    ].filter(Boolean))].sort();
    ops = nomes.map(n => ({ id: n, nome: n }));
  }

  sel.disabled = false;

  if (!ops.length) {
    sel.innerHTML = `<option value="">⚠️ Nenhum operador cadastrado</option>`;
    return;
  }

  sel.innerHTML = `<option value="">Selecione o operador...</option>` +
    ops.map(o => `<option value="${o.nome || o.id}" ${(o.nome||o.id)===cur?'selected':''}>${o.nome}${o.cargo ? ` — ${o.cargo}` : ''}</option>`).join('');
  if (cur) sel.value = cur;
}

// ── Abrir modal de atribuição ────────────────────────────────────────────────
async function abrirAtribuirRecontagem() {
  if (!_divSelecionadas.size) { showToast('Selecione pelo menos um endereço', 'w'); return; }

  // Resumo dos endereços selecionados
  const resumo = document.getElementById('atrib-resumo');
  if (resumo) {
    const lista = [..._divSelecionadas].map(id => {
      const d = state().divergencias.find(x => x.id === id);
      return d ? `<span class="badge b-orange" style="font-size:.72rem">${escHTML(d.endereco)}</span>` : '';
    }).join(' ');
    resumo.innerHTML = `<div style="font-weight:700;margin-bottom:8px;color:var(--text)">📍 ${_divSelecionadas.size} endereço${_divSelecionadas.size!==1?'s':''} selecionado${_divSelecionadas.size!==1?'s':''}:</div><div style="display:flex;flex-wrap:wrap;gap:4px">${lista}</div>`;
  }

  // Abrir modal primeiro para feedback visual imediato
  openModal('modal-atribuir-recontagem');

  const obs = document.getElementById('atrib-obs');
  if (obs) obs.value = '';

  // Popular operadores de forma assíncrona (pode buscar do Firestore)
  await divPopularSelectOperadores('atrib-operador');
}

// ── Confirmar atribuição ──────────────────────────────────────────────────────
function confirmarAtribuicao() {
  const operador = document.getElementById('atrib-operador')?.value?.trim();
  const obs      = document.getElementById('atrib-obs')?.value?.trim();
  if (!operador) { showToast('Selecione um operador', 'e'); return; }

  const agora    = new Date().toISOString();
  const atribPor = _currentAnalistaUser?.displayName || _currentAnalistaUser?.email || 'Analista';
  let count = 0;

  _divSelecionadas.forEach(id => {
    const d = state().divergencias.find(x => x.id === id);
    if (!d) return;

    // ── Delegar toda a lógica de validação + criação para atribuirRecontagemSegura ──
    const rec = atribuirRecontagemSegura(d, operador, atribPor, obs, agora);
    if (!rec) return; // bloqueado — mensagem já exibida dentro da função
    count++;
  });

  saveAll();
  renderDivergencias();
  renderRecontagens();
  closeModal('modal-atribuir-recontagem');
  _divSelecionadas.clear();
  divAtualizarBarraSel();

  logSistema('ATRIBUIÇÃO_RECONTAGEM', `${count} recontagem(s) atribuída(s) a ${operador}`, { count, operador, atribPor, ts: agora });
  showToast(`✅ ${count} recontagem${count!==1?'s':''} atribuída${count!==1?'s':''} para ${operador}`, 's');
}

// ── Desvincular recontagem — remove o operador, mantém divergência ABERTA ────
async function desvincularRecontagem(divId) {
  const div = state().divergencias.find(d => d.id === divId);
  if (!div) return;

  // Bloqueio PERSISTENTE — não é possível desvincular fluxo encerrado
  if (_isPersistenteBloqueado(div)) {
    showToast('🔒 Endereço PERSISTENTE — fluxo encerrado. Não é possível desvincular.', 'e');
    return;
  }

  const operadorAnterior = div.operador_responsavel || '—';

  // Confirmar com o analista
  const ok = await new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.style.cssText = 'display:flex;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;background:rgba(0,0,0,.65)';
    modal.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;
        padding:24px 28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)">
        <div style="font-size:1rem;font-weight:700;margin-bottom:8px;color:var(--text)">
          🔓 Desvincular recontagem
        </div>
        <div style="font-size:.82rem;color:var(--muted);line-height:1.6;margin-bottom:16px">
          O operador <b style="color:var(--text)">${operadorAnterior}</b> será removido da recontagem do endereço
          <b style="color:var(--accent);font-family:var(--mono)">${div.endereco}</b>.
          <br><br>
          A divergência permanece <b style="color:var(--orange)">ABERTA</b> e pode ser reatribuída a outro operador.
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="btn-desvincular-cancel" style="padding:9px 18px;border-radius:8px;border:1px solid var(--border);
            background:transparent;color:var(--muted);cursor:pointer;font-weight:600;font-size:.85rem">
            Cancelar
          </button>
          <button id="btn-desvincular-ok" style="padding:9px 18px;border-radius:8px;border:none;
            background:var(--danger,#ef4444);color:#fff;cursor:pointer;font-weight:700;font-size:.85rem">
            🔓 Desvincular
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#btn-desvincular-ok').onclick     = () => { modal.remove(); resolve(true);  };
    modal.querySelector('#btn-desvincular-cancel').onclick = () => { modal.remove(); resolve(false); };
    modal.onclick = e => { if (e.target === modal) { modal.remove(); resolve(false); } };
  });

  if (!ok) return;

  // Limpar campos de atribuição na divergência local
  div.operador_responsavel = null;
  div.atribuido_por        = null;
  div.atribuido_em         = null;
  div.status_recontagem    = null;
  div.observacao_atribuicao = null;
  // Status volta para ABERTA se estava EM_RECONTAGEM
  if (div.status === 'EM_RECONTAGEM') div.status = 'ABERTA';

  // Persistir no Firestore
  await fsSalvarDivergencia(div);

  // Se houver recontagem vinculada, cancelá-la também
  const recVinculada = state().recontagens.find(r =>
    r.divergencia_id === divId ||
    (r.endereco === div.endereco && r.inventario_id === div.inventario_id &&
      (r.status_recontagem === 'pendente' || r.status === 'PENDENTE'))
  );
  if (recVinculada) {
    recVinculada.status_recontagem = 'cancelada';
    recVinculada.status            = 'CANCELADA';
    recVinculada.cancelada_em      = new Date().toISOString();
    recVinculada.cancelada_por     = _currentAnalistaUser?.email || 'Analista';
    await fsSalvarRecontagem(recVinculada);
  }

  await saveAll();
  renderDivergencias();
  logSistema('DESVINCULAÇÃO_RECONTAGEM', `Recontagem desvinculada de ${operadorAnterior}`, {
    divergencia_id: divId, endereco: div.endereco, operadorAnterior
  });
  showToast(`🔓 Recontagem desvinculada de ${operadorAnterior}. Divergência continua ABERTA.`, 's');
}

// ── Badge de status de recontagem ────────────────────────────────────────────
function recStatusBadge(statusRec) {
  switch((statusRec||'').toLowerCase()) {
    case 'pendente':              return 'b-yellow';
    case 'em_andamento':          return 'b-orange';
    case 'concluida':             return 'b-green';
    case 'sem_divergencia':       return 'b-green';
    case 'resolvida':             return 'b-green';
    case 'persistente':           return 'b-red';
    case 'cancelada':             return 'b-gray';
    case 'aguardando_analista':   return 'b-purple';
    default:                      return 'b-gray';
  }
}
function recStatusLabel(statusRec) {
  switch((statusRec||'').toLowerCase()) {
    case 'pendente':              return '⏳ Pendente';
    case 'em_andamento':          return '🔄 Em andamento';
    case 'concluida':             return '✅ Concluída';
    case 'sem_divergencia':       return '✅ Sem divergência';
    case 'resolvida':             return '✅ Sem divergência';
    case 'persistente':           return '🔴 Persistente';
    case 'cancelada':             return '❌ Cancelada';
    case 'aguardando_analista':   return '🔒 Aguard. analista';
    default:                      return '—';
  }
}

function renderDivergencias() {
  const busca     = (document.getElementById('div-busca')?.value || '').toLowerCase();
  const fInv      = document.getElementById('div-sel-inv')?.value || '';
  const fStatus   = document.getElementById('div-fstatus')?.value || '';
  const fTipo     = document.getElementById('div-ftipo')?.value || '';
  const ford      = document.getElementById('div-ford')?.value || '';
  const fRua      = document.getElementById('div-frua')?.value || '';
  const fNivel    = document.getElementById('div-fnivel')?.value || '';
  const fSetor    = document.getElementById('div-fsetor')?.value || '';
  const fProduto  = document.getElementById('div-fproduto')?.value || '';
  const fOperador = document.getElementById('div-foperador')?.value || '';
  const fStatusRec= document.getElementById('div-fstatus-rec')?.value || '';
  const fData     = document.getElementById('div-fdata')?.value || '';

  // Popular select inventários
  const selInv = document.getElementById('div-sel-inv');
  if (selInv) {
    const cur = selInv.value;
    selInv.innerHTML = '<option value="">Todos os inventários</option>' +
      state().inventarios.map(i => `<option value="${i.id}" ${i.id===cur?'selected':''}>${i.codigo} — ${i.nome}</option>`).join('');
    if (cur) selInv.value = cur;
  }

  let dados = state().divergencias;
  if (fInv)    dados = dados.filter(d => d.inventario_id === fInv);
  if (fStatus) {
    dados = dados.filter(d => d.status === fStatus);
  } else {
    // Por padrão ocultar RESOLVIDA e PERSISTENTE — já encerradas, não precisam poluir a lista
    dados = dados.filter(d => d.status !== 'RESOLVIDA' && d.status !== 'PERSISTENTE');
  }
  if (fTipo === 'FALTA')                  dados = dados.filter(d => d.diferenca != null && d.diferenca < 0);
  else if (fTipo === 'SOBRA')             dados = dados.filter(d => d.diferenca != null && d.diferenca > 0);
  else if (fTipo === 'PRODUTO_NAO_IDENTIFICADO') dados = dados.filter(d => d.tipo_divergencia === 'PRODUTO_NAO_IDENTIFICADO');
  else if (fTipo === 'PRODUTO_FORA_ENDERECO')    dados = dados.filter(d => d.tipo_divergencia === 'PRODUTO_FORA_ENDERECO');
  else if (fTipo === 'VAZIO_COM_PRODUTO_NA_BASE') dados = dados.filter(d => d.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE');

  // Filtrar por rua
  if (fRua)    dados = dados.filter(d => { const ei = getEnderecoInfo(d.endereco); return (ei?.rua||'') === fRua; });
  // Filtrar por nível
  if (fNivel)  dados = dados.filter(d => { const ei = getEnderecoInfo(d.endereco); return (ei?.nivel||ei?.andar||'') === fNivel; });
  // Filtrar por setor
  if (fSetor)  dados = dados.filter(d => { const ei = getEnderecoInfo(d.endereco); return (ei?.setor||ei?.local||ei?.nome_local||'') === fSetor; });
  // Filtrar por produto
  if (fProduto) dados = dados.filter(d => (d.produto||'') === fProduto);
  // Filtrar por operador
  if (fOperador) dados = dados.filter(d => {
    const cont = state().contagens.find(c => c.inventario_id === d.inventario_id && c.endereco === d.endereco && !c._excluida);
    const op = d.operador || cont?.operador || '';
    return op === fOperador;
  });
  // Filtrar por status de recontagem
  if (fStatusRec) {
    if (fStatusRec === 'nao_atribuida') dados = dados.filter(d => !d.atribuido_em && !d.operador_responsavel);
    else dados = dados.filter(d => (d.status_recontagem||'') === fStatusRec);
  }
  // Filtrar por data
  if (fData) {
    const agora = new Date();
    dados = dados.filter(d => {
      if (!d.criada_em) return false;
      const dt = new Date(d.criada_em);
      if (fData === 'hoje') return dt.toDateString() === agora.toDateString();
      if (fData === '7d')  return (agora - dt) <= 7*24*3600*1000;
      if (fData === '30d') return (agora - dt) <= 30*24*3600*1000;
      return true;
    });
  }

  // Filtros rápidos
  if (_divFiltroRapidoAtivo === 'nao_atribuidas') dados = dados.filter(d => !d.atribuido_em && !d.operador_responsavel);
  else if (_divFiltroRapidoAtivo === 'minhas') {
    const eu = _currentAnalistaUser?.displayName || _currentAnalistaUser?.email || '';
    dados = dados.filter(d => (d.atribuido_por||'') === eu);
  }
  else if (_divFiltroRapidoAtivo === 'pendentes')          dados = dados.filter(d => (d.status_recontagem||'') === 'pendente');
  else if (_divFiltroRapidoAtivo === 'aguardando_analista') dados = dados.filter(d => (d.status_recontagem||'') === 'aguardando_analista');
  else if (_divFiltroRapidoAtivo === 'concluidas')         dados = dados.filter(d => (d.status_recontagem||'') === 'concluida');

  if (busca) dados = dados.filter(d =>
    (d.endereco||'').toLowerCase().includes(busca) ||
    (d.produto||'').toLowerCase().includes(busca) ||
    (d.descricao||'').toLowerCase().includes(busca) ||
    (d.inventario_nome||'').toLowerCase().includes(busca) ||
    (d.operador||'').toLowerCase().includes(busca) ||
    (d.operador_responsavel||'').toLowerCase().includes(busca)
  );

  // Ordenação
  if (ford === 'maior_diff') dados = [...dados].sort((a,b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
  else if (ford === 'menor_diff') dados = [...dados].sort((a,b) => Math.abs(a.diferenca) - Math.abs(b.diferenca));
  else if (ford === 'endereco') dados = [...dados].sort((a,b) => (a.endereco||'').localeCompare(b.endereco||''));
  else dados = [...dados].sort((a,b) => (b.criada_em||'').localeCompare(a.criada_em||''));

  // Populat filtros dinâmicos (rua, nível, setor, produto, operador)
  const _popSel = (id, valores, cur, emptyLabel) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<option value="">${emptyLabel}</option>` +
      valores.map(v => `<option value="${v}" ${v===cur?'selected':''}>${v}</option>`).join('');
    if (cur) el.value = cur;
  };
  const todasRuas   = [...new Set(state().divergencias.map(d => getEnderecoInfo(d.endereco)?.rua).filter(Boolean))].sort();
  const todosNiveis = [...new Set(state().divergencias.map(d => { const i=getEnderecoInfo(d.endereco); return i?.nivel||i?.andar||''; }).filter(Boolean))].sort();
  const todosSetores= [...new Set(state().divergencias.map(d => { const i=getEnderecoInfo(d.endereco); return i?.setor||i?.local||i?.nome_local||''; }).filter(Boolean))].sort();
  const todosProds  = [...new Set(state().divergencias.map(d => d.produto).filter(Boolean))].sort();
  const todosOps    = [...new Set(state().divergencias.map(d => {
    const cont = state().contagens.find(c => c.inventario_id === d.inventario_id && c.endereco === d.endereco && !c._excluida);
    return d.operador || cont?.operador || '';
  }).filter(Boolean))].sort();
  _popSel('div-frua',      todasRuas,    fRua,      'Todas as ruas');
  _popSel('div-fnivel',    todosNiveis,  fNivel,    'Todos os níveis');
  _popSel('div-fsetor',    todosSetores, fSetor,    'Todos os setores');
  _popSel('div-fproduto',  todosProds,   fProduto,  'Todos os produtos');
  _popSel('div-foperador', todosOps,     fOperador, 'Todos os operadores');

  // KPIs
  const all        = state().divergencias.filter(d => !fInv || d.inventario_id === fInv);
  const abertas    = all.filter(d => d.status === 'ABERTA').length;
  const emRec      = all.filter(d => d.status === 'EM_RECONTAGEM').length;
  const resolvidas = all.filter(d => d.status === 'RESOLVIDA').length;
  const persistentes = all.filter(d => d.status === 'PERSISTENTE').length;
  const naoIdent   = all.filter(d => d.tipo_divergencia === 'PRODUTO_NAO_IDENTIFICADO').length;
  const foraEnd    = all.filter(d => d.tipo_divergencia === 'PRODUTO_FORA_ENDERECO').length;
  const pendentes       = all.filter(d => (d.status_recontagem||'') === 'pendente').length;
  const aguardAnalista  = all.filter(d => (d.status_recontagem||'') === 'aguardando_analista').length;
  const total      = all.length;
  const pctRes     = total > 0 ? Math.round((resolvidas/total)*100) : 0;
  const setEl = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  setEl('dk-abertas', abertas); setEl('dk-em-rec', emRec); setEl('dk-resolvidas', resolvidas);
  setEl('dk-pct', pctRes+'%'); setEl('dk-nao-ident', naoIdent); setEl('dk-fora-end', foraEnd);
  setEl('dk-persistente', persistentes); setEl('dk-pendentes', pendentes);
  setEl('dk-aguard-analista', aguardAnalista);

  if (!dados.length) {
    document.getElementById('div-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Nenhum conflito encontrado</div><div class="empty-sub">Clique em "Processar Contagens" para cruzar a base com as contagens recebidas</div></div>`;
    return;
  }

  document.getElementById('div-table-wrap').innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th style="width:36px;padding:8px 10px">
          <input type="checkbox" id="div-chk-all" title="Selecionar todos"
            style="width:15px;height:15px;cursor:pointer;accent-color:var(--orange)"
            onchange="divToggleTodos(this.checked)">
        </th>
        <th>Inventário</th><th>Rua</th><th>Endereço</th><th>Produto</th>
        <th>Operador Contagem</th><th>Data</th><th>Tipo</th>
        <th>Sistema</th><th>1ª Contagem</th><th>Resultado</th>
        <th>Status</th><th>Status Recontagem</th><th>Atribuído para</th><th>Ações</th>
      </tr></thead>
      <tbody>
        ${dados.map(d => {
          const difColor = d.diferenca > 0 ? 'var(--warn)' : d.diferenca < 0 ? 'var(--danger)' : 'var(--success)';
          const rec = state().recontagens
            .filter(r => r.divergencia_id === d.id)
            .sort((a,b) => (b.numero_recontagem||1) - (a.numero_recontagem||1))[0] || null;
          const endInfo = getEnderecoInfo(d.endereco);
          const rua = endInfo?.rua || '—';
          const cont = state().contagens.find(c => c.inventario_id === d.inventario_id && c.endereco === d.endereco && !c._excluida);
          const operador = d.operador || cont?.operador || '—';
          const selecionado = _divSelecionadas.has(d.id);

          let tipoCls, tipoTxt;
          switch(d.tipo_divergencia) {
            case 'PRODUTO_NAO_IDENTIFICADO':  tipoCls='b-red';    tipoTxt='❓ Prod. não ident.'; break;
            case 'PRODUTO_FORA_ENDERECO':     tipoCls='b-purple'; tipoTxt='📦 Fora endereço'; break;
            case 'VAZIO_COM_PRODUTO_NA_BASE': tipoCls='b-yellow'; tipoTxt='📭 Vazio c/ produto'; break;
            default:
              tipoCls = d.diferenca > 0 ? 'b-yellow' : 'b-red';
              tipoTxt = d.diferenca > 0 ? '📈 Sobra' : '📉 Falta';
          }

          const qtdEspTxt  = d.qtd_esperada  != null ? d.qtd_esperada  : '—';
          const qtdContTxt = d.qtd_contada   != null ? d.qtd_contada   : '—';
          const difTxt     = d.diferenca     != null ? (d.diferenca > 0 ? '+'+d.diferenca : String(d.diferenca)) : '—';
          const difColorTxt= d.diferenca     != null ? difColor : 'var(--muted)';

          // Status recontagem
          const statusRec = d.status_recontagem || (rec ? (rec.status==='CONCLUIDA' ? 'concluida' : 'pendente') : '');
          const atribPara = d.operador_responsavel || rec?.operador || '';

          return `<tr style="${selecionado ? 'background:rgba(232,117,26,.06)' : ''}">
            <td style="padding:8px 10px">
              <input type="checkbox" class="div-row-chk" data-id="${d.id}"
                style="width:15px;height:15px;cursor:pointer;accent-color:var(--orange)"
                ${selecionado ? 'checked' : ''}
                onchange="divToggleSel('${d.id}', this.checked)">
            </td>
            <td style="font-size:.75rem;color:var(--muted)">${d.inventario_nome || d.inventario_id}</td>
            <td class="mono" style="font-weight:600">${rua}</td>
            <td class="mono">${escHTML(d.endereco)}${d.endereco_correto ? `<br><span style="font-size:.65rem;color:var(--muted)">→ ${escHTML(d.endereco_correto)}</span>` : ''}</td>
            <td>
              <div style="font-weight:600;font-size:.82rem">${escHTML(d.produto)}</div>
              <div style="font-size:.7rem;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHTML(d.descricao || '')}</div>
              ${d.gtin_bipado ? `<div style="font-size:.65rem;color:var(--muted)">GTIN: ${d.gtin_bipado}</div>` : ''}
            </td>
            <td style="font-size:.8rem">${operador}</td>
            <td class="mono" style="font-size:.72rem;color:var(--muted);white-space:nowrap">${fmtTs(d.criada_em)}</td>
            <td><span class="badge ${tipoCls}">${tipoTxt}</span></td>
            <td class="mono" style="font-weight:700">${qtdEspTxt}${d.produto ? `<div style="font-size:.6rem;color:var(--muted);font-family:var(--mono)">${escHTML(d.produto)}</div>` : ''}</td>
            ${(() => {
              // Reutilizável: renderiza célula de contagem com produto e cor
              const _ndpD = v => String(v||'').trim().toUpperCase();
              const prodEspD = _ndpD(d.produto);
              const _qtdC1 = d.qtd_contada != null ? d.qtd_contada : '—';
              const _qtdEsp = parseFloat(d.qtd_esperada);
              const _bateC1 = !isNaN(_qtdEsp) && d.qtd_contada === _qtdEsp;
              const _corC1  = _bateC1 ? 'var(--success)' : 'var(--danger)';
              const _c1Cell = `<td><div style="font-family:var(--mono);font-weight:800;color:${_corC1}">${_qtdC1}</div>${d.operador ? `<div style="font-size:.65rem;color:var(--muted)">${d.operador}</div>` : ''}</td>`;
              return _c1Cell;
            })()}
            ${(() => {
              const recFinal = state().recontagens
                .filter(r => r.divergencia_id === d.id)
                .sort((a,b) => (b.numero_recontagem||1) - (a.numero_recontagem||1))[0] || null;
              const qtdRes = d.qtd_resultado_final ?? recFinal?.qtd_recontagem ?? recFinal?.qtd_terceira ?? recFinal?.qtd_segunda ?? null;
              const opRes  = recFinal?.operador_segunda || recFinal?.operador || '';
              const motivo = d.contagem_aceita || '';
              if (qtdRes == null) return '<td style="color:var(--muted);font-size:.75rem;text-align:center">—</td>';
              const qtdEspN = parseFloat(d.qtd_esperada);
              const bate = !isNaN(qtdEspN) && parseFloat(qtdRes) === qtdEspN;
              const cor  = bate ? 'var(--success)' : 'var(--danger)';
              const icone = bate ? '✅' : '❌';
              const mTxt = motivo === 'SEGUNDA_CONTAGEM' ? '2ª bateu sistema'
                         : motivo === 'TERCEIRA_SEM_CONSENSO' ? '3 rodadas sem consenso'
                         : motivo === 'LIBERACAO_ANALISTA' ? 'Liberado pelo analista'
                         : motivo ? motivo.replace(/_/g,' ').toLowerCase() : '';
              let cell = '<td><div style="font-family:var(--mono);font-weight:800;color:' + cor + '">' + icone + ' ' + qtdRes + '</div>';
              if (opRes) cell += '<div style="font-size:.65rem;color:var(--muted)">' + opRes + '</div>';
              if (mTxt)  cell += '<div style="font-size:.62rem;color:var(--muted);font-style:italic">' + mTxt + '</div>';
              cell += '</td>';
              return cell;
            })()}
                        <td><span class="badge ${divStatusBadge(d.status)}">${d.status}</span></td>
            <td>
              ${statusRec
                ? `<span class="badge ${recStatusBadge(statusRec)}" style="font-size:.68rem">${recStatusLabel(statusRec)}</span>`
                : `<span style="font-size:.72rem;color:var(--muted-2)">—</span>`}
            </td>
            <td>
              ${atribPara
                ? `<div style="font-size:.78rem;font-weight:600;color:var(--text)">${atribPara}</div>
                   ${d.atribuido_em ? `<div style="font-size:.65rem;color:var(--muted)">${fmtTs(d.atribuido_em)}</div>` : ''}`
                : `<span style="font-size:.72rem;color:var(--muted-2)">Não atribuído</span>`}
            </td>
            <td style="white-space:nowrap">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                ${d.status === 'PERSISTENTE'
                  ? `<span style="font-size:.68rem;color:var(--danger);font-weight:700;padding:3px 8px;background:rgba(217,32,32,.10);border-radius:6px;border:1px solid rgba(217,32,32,.25)">🔒 Encerrado</span>`
                  : d.status !== 'RESOLVIDA'
                    ? `<button class="btn btn-success btn-sm" onclick="marcarDivergenciaResolvida('${d.id}')" title="Marcar como resolvida" style="font-size:.7rem">✓ Resolver</button>`
                    : `<span style="font-size:.7rem;color:var(--muted)">${fmtTs(d.resolvida_em)}</span>`
                }
                ${(d.status !== 'RESOLVIDA' && d.status !== 'PERSISTENTE')
                  ? (atribPara
                      ? `<button class="btn btn-ghost btn-sm" style="font-size:.7rem;color:var(--danger);border-color:var(--danger)" onclick="desvincularRecontagem('${d.id}')" title="Desvincular operador">🔓 Desvincular</button>`
                      : (!_isFluxoEncerrado(d) ? `<button class="btn btn-ghost btn-sm" style="font-size:.7rem" onclick="divAtribuirRapido('${d.id}')" title="Atribuir recontagem">👤 Atribuir</button>` : ''))
                  : ''}
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
}

// ───────────────────────────────────────────────────────────────────
//  17. RENDERIZAÇÃO — RECONTAGENS
// ───────────────────────────────────────────────────────────────────

function renderRecontagens() {
  const busca      = (document.getElementById('rec-busca')?.value || '').toLowerCase();
  const fInv       = document.getElementById('rec-sel-inv')?.value || '';
  const fStatus    = document.getElementById('rec-fstatus')?.value || '';
  const fStatusRec = document.getElementById('rec-fstatus-rec')?.value || '';
  const fOperador  = document.getElementById('rec-foperador')?.value || '';
  const fRua       = document.getElementById('rec-frua')?.value || '';
  const ford       = document.getElementById('rec-ford')?.value || '';

  // Popular select inventários
  const selInv = document.getElementById('rec-sel-inv');
  if (selInv) {
    const cur = selInv.value;
    selInv.innerHTML = '<option value="">Todos os inventários</option>' +
      state().inventarios.map(i => `<option value="${i.id}" ${i.id===cur?'selected':''}>${i.codigo} — ${i.nome}</option>`).join('');
    if (cur) selInv.value = cur;
  }

  // Por divergencia, mostrar apenas o rec com maior numero_recontagem (mais recente).
  // Evita linhas duplicadas quando há rec1 (CONCLUIDA) + rec3 (PENDENTE/CONCLUIDA).
  const _recPorDiv = {};
  state().recontagens.forEach(r => {
    const key = r.divergencia_id || r.id;
    const ex  = _recPorDiv[key];
    if (!ex || (r.numero_recontagem || 1) > (ex.numero_recontagem || 1)) _recPorDiv[key] = r;
  });
  let dados = Object.values(_recPorDiv);
  if (fInv)    dados = dados.filter(r => String(r.inventario_id || r.inventarioId || '') === String(fInv));
  if (fStatus) dados = dados.filter(r => r.status === fStatus);
  if (fRua)    dados = dados.filter(r => (getEnderecoInfo(r.endereco)?.rua || '—') === fRua);

  // Filtro por status de recontagem (campo novo + derivado da divergência)
  if (fStatusRec) {
    dados = dados.filter(r => {
      const div = state().divergencias.find(d => d.id === r.divergencia_id);
      const sr  = r.status_recontagem || div?.status_recontagem || '';
      const temAtrib = r.operador || div?.operador_responsavel;
      if (fStatusRec === 'nao_atribuida') return !temAtrib;
      return sr === fStatusRec;
    });
  }

  // Filtro por operador atribuído
  if (fOperador) {
    dados = dados.filter(r => {
      const div = state().divergencias.find(d => d.id === r.divergencia_id);
      return (r.operador || div?.operador_responsavel || '') === fOperador;
    });
  }

  if (busca) dados = dados.filter(r =>
    (r.endereco||'').toLowerCase().includes(busca) ||
    (r.produto||'').toLowerCase().includes(busca) ||
    (r.descricao||'').toLowerCase().includes(busca) ||
    (r.inventario_nome||'').toLowerCase().includes(busca) ||
    (r.operador||'').toLowerCase().includes(busca)
  );

  // Ordenação
  if (ford === 'maior_diff')   dados = [...dados].sort((a,b) => Math.abs(b.qtd_primeira - b.qtd_esperada) - Math.abs(a.qtd_primeira - a.qtd_esperada));
  else if (ford === 'endereco') dados = [...dados].sort((a,b) => (a.endereco||'').localeCompare(b.endereco||''));
  else if (ford === 'atribuicao') dados = [...dados].sort((a,b) => {
    const da = state().divergencias.find(d => d.id === a.divergencia_id);
    const db2= state().divergencias.find(d => d.id === b.divergencia_id);
    return ((db2?.atribuido_em||b.atribuido_em||'').localeCompare(da?.atribuido_em||a.atribuido_em||''));
  });
  else dados = [...dados].sort((a,b) => (b.criada_em||'').localeCompare(a.criada_em||''));

  // Popular filtros dinâmicos
  const selRua = document.getElementById('rec-frua');
  if (selRua) {
    const ruas = [...new Set(state().recontagens.map(r => getEnderecoInfo(r.endereco)?.rua || '—'))].sort();
    selRua.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(r => `<option value="${r}" ${r===fRua?'selected':''}>${r}</option>`).join('');
  }
  const selOp = document.getElementById('rec-foperador');
  if (selOp) {
    const cur = selOp.value;
    const ops = [...new Set(state().recontagens.map(r => {
      const div = state().divergencias.find(d => d.id === r.divergencia_id);
      return r.operador || div?.operador_responsavel || '';
    }).filter(Boolean))].sort();
    selOp.innerHTML = '<option value="">Todos os operadores</option>' + ops.map(o => `<option value="${o}" ${o===cur?'selected':''}>${o}</option>`).join('');
    if (cur) selOp.value = cur;
  }

  // KPIs
  const allRec = state().recontagens.filter(r => !fInv || r.inventario_id === fInv);
  const pendentes    = allRec.filter(r => r.status === 'PENDENTE').length;
  const concluidas   = allRec.filter(r => r.status === 'CONCLUIDA').length;
  const atribuidas   = allRec.filter(r => {
    const div = state().divergencias.find(d => d.id === r.divergencia_id);
    return r.operador || div?.operador_responsavel;
  }).length;
  const naoAtribuidas = allRec.filter(r => {
    const div = state().divergencias.find(d => d.id === r.divergencia_id);
    return !r.operador && !div?.operador_responsavel;
  }).length;
  const pctRes = allRec.length > 0 ? Math.round((concluidas/allRec.length)*100) : 0;
  const maiorDiff = allRec.length > 0
    ? Math.max(...allRec.map(r => Math.abs((r.qtd_primeira||0) - (r.qtd_esperada||0))))
    : 0;
  const persistentesRec = allRec.filter(r =>
    (r.status_recontagem || '') === 'persistente' ||
    (r.status_bloqueio || '') === 'PERSISTENTE_BLOQUEADO'
  ).length;
  const setK = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  setK('rk-pendentes', pendentes); setK('rk-concluidas', concluidas);
  setK('rk-atribuidas', atribuidas); setK('rk-nao-atribuidas', naoAtribuidas);
  setK('rk-persistentes', persistentesRec);
  setK('rk-maior-diff', maiorDiff||'—'); setK('rk-pct', pctRes+'%');

  if (!dados.length) {
    document.getElementById('rec-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">🔄</div><div class="empty-title">Nenhuma recontagem encontrada</div><div class="empty-sub">Recontagens são criadas ao processar divergências. Use "Atribuir Recontagem" nas divergências para distribuir para operadores.</div></div>`;
    return;
  }

  document.getElementById('rec-table-wrap').innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th>Inventário</th><th>Rua</th><th>Endereço</th><th>Produto</th>
        <th>Qtd Sistema</th>
        <th>Contagem 1</th><th>Contagem 2</th><th>Contagem 3</th>
        <th>Atribuído para</th>
        <th>Status</th><th>Ações</th>
      </tr></thead>
      <tbody>
        ${dados.map(r => {
          const endInfo = getEnderecoInfo(r.endereco);
          const rua = endInfo?.rua || '—';

          // Buscar divergência correspondente
          const div = state().divergencias.find(d => d.id === r.divergencia_id);
          const atribPara   = r.operador || div?.operador_responsavel || '—';
          const atribEm     = r.atribuido_em || div?.atribuido_em || '';
          const atribPor    = r.atribuido_por || div?.atribuido_por || '';
          const statusRec   = r.status_recontagem || div?.status_recontagem || (r.status === 'CONCLUIDA' ? 'concluida' : 'pendente');
          const obsAtrib    = r.observacao_atribuicao || div?.observacao_atribuicao || '';
          const naoAtribuido = atribPara === '—' || !atribPara;

          // ── Células das 3 contagens — exibe produto E quantidade ──
          const _ndp = v => String(v || '').trim().toUpperCase();
          const prodEsp = _ndp(r.produto);
          const _cellCont = (qtd, op, data, prodContado) => {
            if (qtd === null || qtd === undefined) {
              return `<td style="color:var(--muted-2);font-size:.78rem;text-align:center">—</td>`;
            }
            const qtdEsp    = parseFloat(r.qtd_esperada);
            const qtdBate   = !isNaN(qtdEsp) && qtd === qtdEsp;
            const prodBate  = !prodContado || _ndp(prodContado) === '' || _ndp(prodContado) === prodEsp;
            const tudoBate  = qtdBate && prodBate;
            const corQtd    = tudoBate ? 'var(--success)' : (qtdBate && !prodBate ? 'var(--warn)' : 'var(--danger)');
            const prodDivBadge = (!prodBate && prodContado)
              ? `<div style="font-size:.6rem;color:var(--danger);font-family:var(--mono);font-weight:700;background:rgba(217,32,32,.08);border-radius:3px;padding:1px 4px;margin-top:2px" title="Produto diferente do esperado (${prodEsp})">⚠️ ${_ndp(prodContado)}</div>`
              : '';
            return `<td>
              <div style="font-family:var(--mono);font-weight:800;font-size:.92rem;color:${corQtd}">${qtd}</div>
              ${prodDivBadge}
              ${op   ? `<div style="font-size:.65rem;color:var(--muted)">${op}</div>` : ''}
              ${data ? `<div style="font-size:.6rem;color:var(--muted-2)">${fmtTs(data)}</div>` : ''}
            </td>`;
          };

          return `<tr>
            <td style="font-size:.75rem;color:var(--muted)">${r.inventario_nome || r.inventario_id}</td>
            <td class="mono" style="font-weight:600">${rua}</td>
            <td class="mono">${r.endereco}</td>
            <td>
              <div style="font-weight:600;font-size:.82rem">${r.produto}</div>
              <div style="font-size:.7rem;color:var(--muted)">${r.descricao || ''}</div>
            </td>
            <td class="mono" style="font-weight:700">${r.qtd_esperada ?? '—'}</td>
            ${_cellCont(r.qtd_primeira,  r.operador_primeira,  r.data_primeira,  r.produto_primeira  || r.produto)}
            ${_cellCont(r.qtd_segunda,   r.operador_segunda,   r.data_segunda,   r.produto_segunda)}
            ${_cellCont(r.qtd_terceira,  r.operador_terceira,  r.data_terceira,  r.produto_terceira)}
            <td>
              ${naoAtribuido
                ? `<span style="font-size:.75rem;color:var(--muted-2)">Não atribuído</span>`
                : `<div style="font-weight:600;font-size:.82rem;color:var(--text)">${atribPara}</div>
                   ${atribPor ? `<div style="font-size:.65rem;color:var(--muted)">por ${atribPor}</div>` : ''}
                   ${obsAtrib ? `<div style="font-size:.68rem;color:var(--text-2);font-style:italic;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${obsAtrib}">💬 ${obsAtrib}</div>` : ''}`
              }
            </td>
            <td>
              ${statusRec
                ? `<span class="badge ${recStatusBadge(statusRec)}" style="font-size:.7rem">${recStatusLabel(statusRec)}</span>`
                : `<span class="badge b-yellow" style="font-size:.7rem">⏳ Pendente</span>`}
            </td>
            <td style="white-space:nowrap">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                ${_isFluxoEncerrado(r)
                  ? `<span style="font-size:.68rem;color:var(--danger);font-weight:700;padding:3px 8px;background:rgba(217,32,32,.10);border-radius:6px;border:1px solid rgba(217,32,32,.25)">🔒 Encerrado</span>`
                  : r.status === 'PENDENTE'
                    ? `<button class="btn btn-primary btn-sm" onclick="abrirRegistrarRecontagem('${r.id}')" style="font-size:.72rem">📝 Registrar</button>`
                    : `<span style="font-size:.72rem;color:var(--muted)">${fmtTs(r.concluida_em)}</span>`
                }
                ${(!_isFluxoEncerrado(r) && naoAtribuido)
                  ? `<button class="btn btn-ghost btn-sm" onclick="divAtribuirPorRec('${r.id}')" style="font-size:.72rem" title="Atribuir a um operador">👤 Atribuir</button>`
                  : ''}
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
}

