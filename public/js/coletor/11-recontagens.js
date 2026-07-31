// ═══════════════════════════════════════════════════
//  🔄  RECONTAGENS — CONTROLE E RENDERIZAÇÃO
// ═══════════════════════════════════════════════════

function recarregarRecontagens() {
  if (!APP.inventario?.id) { renderRecontagensAtribuidas(); return; }
  if (_recListener) { try { _recListener(); } catch(e){ console.warn("[Erro tratado]", e); } _recListener = null; }
  iniciarListenerRecontagens(APP.inventario.id);
  toast('🔄 Sincronizando…', 's');
}

function setRecFilter(f, el) {
  _recFiltroAtivo = f;
  document.querySelectorAll('.rec-filter-btn').forEach(b => {
    b.style.borderColor = 'var(--border)'; b.style.background = 'transparent'; b.style.color = 'var(--muted)';
  });
  if (el) { el.style.borderColor = 'var(--accent)'; el.style.background = 'rgba(232,117,26,.12)'; el.style.color = 'var(--accent)'; }
  renderRecontagensAtribuidas();
}

function _recontagemDoOperadorAtual(item) {
  const atual = String(APP.operador?.name || '').trim().toUpperCase();
  const atribuido = String(item?.operador || item?.operador_responsavel || '').trim().toUpperCase();
  return atual !== '' && atribuido !== '' && atual === atribuido;
}

function _atualizarBadgeRecontagens() {
  const statusEncerrados = ['concluida','sem_divergencia','resolvida','aguardando_analista','cancelada'];
  const recs = (APP.recontagens || []).filter(r => {
    const st    = (r.status || '').toUpperCase();
    const stRec = (r.status_recontagem || 'pendente').toLowerCase();
    if (st === 'CANCELADA' || stRec === 'cancelada') return false;
    if (stRec === 'persistente') return false;
    if (st === 'PERSISTENTE' || (r.status_bloqueio || '') === 'PERSISTENTE_BLOQUEADO') return false;
    if (st === 'CONCLUIDA' || stRec === 'concluida' || stRec === 'aguardando_analista') return false;
    return _recontagemDoOperadorAtual(r);
  });
  const pendentes = recs.filter(r => !statusEncerrados.includes((r.status_recontagem || 'pendente').toLowerCase())).length;
  const total = recs.length;
  const tab = document.getElementById('tab-recontagens');
  if (!tab) return;
  const old = tab.querySelector('.rec-badge');
  if (old) old.remove();
  if (total > 0) {
    const badge = document.createElement('span');
    badge.className = 'rec-badge';
    badge.textContent = pendentes > 0 ? pendentes : '✓';
    badge.style.background = pendentes > 0 ? 'var(--warn)' : 'var(--success)';
    tab.appendChild(badge);
  }
}

function iniciarListenerRecontagens(invId) {
  if (_recListener) { try { _recListener(); } catch(e){ console.warn("[Erro tratado]", e); } _recListener = null; }
  if (!invId) return;
  let _unsubRec = null, _unsubDiv = null;
  if (!APP.recontagens?.length) _recCarregando = true;
  try {
    const operadorAtual = String(APP.operador?.name || '').trim();
    if (!operadorAtual) {
      _recCarregando = false;
      APP.recontagens = [];
      APP.divergenciasAtribuidas = [];
      renderRecontagensAtribuidas();
      return;
    }
    _unsubRec = FS.collection('dt_recontagens')
      .where('operador', '==', operadorAtual)
      .onSnapshot(snap => {
        APP.recontagens = snap.docs.map(d => {
          const data = d.data(); delete data.id;
          const rec = { id: d.id, ...data };
          rec.status_recontagem = (rec.status_recontagem || 'pendente').toLowerCase();
          return rec;
        }).filter(r => {
          if (String(r.inventario_id || '') !== String(invId)) return false;
          const stRec = (r.status_recontagem || 'pendente').toLowerCase();
          const st    = (r.status || '').toUpperCase();
          // Excluir canceladas, encerradas e bloqueadas definitivamente
          if (stRec === 'cancelada' || st === 'CANCELADA') return false;
          if (stRec === 'persistente') return false;
          if (st === 'PERSISTENTE') return false;
          if ((r.status_bloqueio || '') === 'PERSISTENTE_BLOQUEADO') return false;
          return true;
        });
        // Compatibilidade com tarefas criadas antes da v143: o próprio
        // coletor responsável cria o indicador leve que bloqueará o endereço
        // nos outros aparelhos, sem compartilhar os detalhes da tarefa.
        APP.recontagens.forEach(r => {
          const st = String(r.status || '').toUpperCase();
          const sr = String(r.status_recontagem || '').toLowerCase();
          if (!r.endereco || st !== 'PENDENTE' || sr === 'cancelada') return;
          // Mesma chave canônica usada pelo Analista: inventário + endereço + produto.
          // Evita que produtos diferentes do mesmo endereço compartilhem o bloqueio.
          const chaveFluxo = window.InventoryFlowKey
            ? window.InventoryFlowKey.chave(r, APP.inventarios || (APP.inventario ? [APP.inventario] : []))
            : `${invId}|${String(r.endereco).trim().toUpperCase()}|${r.produto || r.codigo_produto || 'SEM_PRODUTO'}`;
          const chave = encodeURIComponent(chaveFluxo);
          FS.collection('dt_bloqueios_recontagem').doc(chave).set({
            ativo: true, inventario_id: invId, endereco: r.endereco,
            produto: r.produto || r.codigo_produto || '',
            chave_fluxo: chaveFluxo,
            operador: operadorAtual, recontagem_id: r.id,
            operador_uid: AUTH?.currentUser?.uid || null,
            atualizado_em: new Date().toISOString()
          }, { merge: true }).catch((erro) => {
            console.error('[Recontagem] Falha ao registrar bloqueio da tarefa', { recontagemId: r.id, chaveFluxo, erro });
          });
        });
        _recCarregando = false;
        _atualizarBadgeRecontagens();
        if (!_recJaAtivouAba) { _recJaAtivouAba = true; _ativarAbaSeNecessario(); }
        renderRecontagensAtribuidas();
      }, err => {
        console.error('[REC] dt_recontagens erro:', err.code, err.message);
        if (err.code === 'permission-denied')
          toast('⚠️ Permissão negada em dt_recontagens. Corrija as Firestore Rules.', 'e');
        _recCarregando = false; renderRecontagensAtribuidas();
      });

    // A divergência completa pertence ao Analista. Os dados operacionais
    // necessários já acompanham a tarefa em dt_recontagens.
    APP.divergenciasAtribuidas = [];

    _recListener = () => {
      try { if (_unsubRec) _unsubRec(); } catch(e){ console.warn("[Erro tratado]", e); }
      try { if (_unsubDiv) _unsubDiv(); } catch(e){ console.warn("[Erro tratado]", e); }
      _recListener = null;
    };
  } catch(e) {
    console.error('[REC] Falha ao iniciar listener:', e.message);
    _recCarregando = false;
  }
}

function _ativarAbaSeNecessario() {
  if (APP.modoRecontagem) return;
  if (APP.atual.step !== 1) return;
  if (document.getElementById('view-recontagens')?.classList.contains('on')) {
    renderRecontagensAtribuidas(); return;
  }
  const statusEncerrados = ['concluida','sem_divergencia','resolvida','aguardando_analista','cancelada'];
  const temPendente = (APP.recontagens || [])
    .some(r => !statusEncerrados.includes((r.status_recontagem || 'pendente').toLowerCase()));
  if (temPendente) showView('recontagens', document.getElementById('tab-recontagens'));
}

/**
 * Retorna true se o item (recontagem ou divergência) está encerrado no coletor.
 * Usado tanto nos filtros de lista quanto na abertura manual.
 */
function _itemEncerradoColetor(item) {
  if (!item) return true;
  const status   = String(item.status           || '').toUpperCase();
  const bloqueio = String(item.status_bloqueio  || '').toUpperCase();
  const stRec    = String(item.status_recontagem || '').toLowerCase();

  if (status   === 'RESOLVIDA')             return true;
  if (status   === 'PERSISTENTE')           return true;
  if (status   === 'CANCELADA')             return true;
  if (bloqueio === 'PERSISTENTE_BLOQUEADO') return true;
  if (stRec    === 'concluida')             return true;
  if (stRec    === 'cancelada')             return true;
  if (stRec    === 'sem_divergencia')       return true;
  if (stRec    === 'aguardando_analista')   return true;
  if (item.divergencia_resolvida     === true) return true;
  if (item.encerrada_definitivamente === true) return true;
  return false;
}

/**
 * Retorna true se o item está aguardando decisão do analista
 * (recontagem concluída porém divergência ainda em aberto, sem novo operador atribuído).
 */
function _itemAguardandoAnalista(item) {
  if (!item) return false;
  const stRec = String(item.status_recontagem || '').toLowerCase();
  const status = String(item.status || '').toUpperCase();
  if (stRec === 'aguardando_analista') return true;
  if (stRec === 'concluida' || status === 'CONCLUIDA') return true;
  return Boolean(item.divergencia_id && stRec === 'pendente' && !String(item.operador || '').trim());
}

function selecionarEnderecoRecontagem(itemId) {
  const item =
    (APP.divergenciasAtribuidas||[]).find(d => d.id === itemId) ||
    (APP.recontagens||[]).find(r => r.id === itemId) ||
    { id: itemId, endereco: itemId, tipo: 'recontagem' };

  // Primeiro informa corretamente quando a rodada está aguardando decisão.
  if (_itemAguardandoAnalista(item)) {
    toast('🔒 Aguardando decisão do analista. Uma nova rodada será atribuída quando necessário.', 'w');
    return;
  }

  if (_itemEncerradoColetor(item)) {
    toast('🔒 Esta rodada já está encerrada. Não é possível iniciar novamente.', 'e');
    return;
  }

  // Existem no máximo duas recontagens após a contagem inicial.
  // A segunda recontagem (numero_recontagem = 2) ainda precisa ser permitida.
  const numRec = Number(item.numero_recontagem || 1);
  const terceiraJaRealizada = item.qtd_terceira != null || numRec > 2;
  if (terceiraJaRealizada) {
    toast('🔒 Limite de 3 contagens atingido. Sem consenso — endereço marcado como persistente.', 'e');
    return;
  }

  _ativarModoRecontagem(item);
}

function _marcarRecontagemIniciada(item) {
  if (!item || !item.id) return;
  const agora = new Date().toISOString();
  const operador = APP.operador?.name || APP.operador?.nome || '';
  const upd = {
    status: 'EM_ANDAMENTO',
    status_recontagem: 'em_andamento',
    iniciada_em: item.iniciada_em || agora,
    recontagem_iniciada_em: item.recontagem_iniciada_em || agora,
    operador_recontagem: operador,
    operador_uid: AUTH?.currentUser?.uid || null
  };

  Object.assign(item, upd);
  const local = (APP.recontagens || []).find(r => String(r.id) === String(item.id));
  if (local) Object.assign(local, upd);

  if (!navigator.onLine || !FS) return;
  FS.collection('dt_recontagens').doc(item.id).set(upd, { merge: true }).catch(e =>
    console.warn('[Rec] Não foi possível marcar início:', e.message)
  );
}

function _ativarModoRecontagem(item) {
  // ── Normalizar ids: garantir que recontagem_id e divergencia_id estejam corretos ──
  // Se o item vier de APP.divergenciasAtribuidas, é uma divergência (não tem divergencia_id).
  // Precisamos buscar a recontagem PENDENTE vinculada para gravar o recontagem_id correto.
  let itemNorm = { ...item };

  if (!itemNorm.divergencia_id || itemNorm.id === itemNorm.divergencia_id) {
    // O item veio como divergência, ou chegou com o id da divergência no lugar
    // do id da recontagem. Localizar a tarefa pendente correta antes de continuar.
    const divId = itemNorm.divergencia_id || item.id;
    itemNorm.divergencia_id = divId;
    // Buscar recontagem pendente vinculada para obter o id correto
    const recVinculada = (APP.recontagens || [])
      .filter(r => {
        if (String(r.divergencia_id || '') !== String(divId)) return false;
        const status = String(r.status || '').toUpperCase();
        const stRec = String(r.status_recontagem || 'pendente').toLowerCase();
        if (['CONCLUIDA','CANCELADA','PERSISTENTE','RESOLVIDA'].includes(status)) return false;
        if (['concluida','cancelada','persistente','resolvida','aguardando_analista'].includes(stRec)) return false;
        return status === 'PENDENTE' || stRec === 'pendente';
      })
      .sort((a,b) => Number(a.numero_recontagem || 1) - Number(b.numero_recontagem || 1))[0];
    if (recVinculada) {
      itemNorm.id = recVinculada.id;   // recontagem_id que será gravado na contagem
      itemNorm.numero_recontagem = recVinculada.numero_recontagem || 1;
    } else {
      // BUG CORRIGIDO: aqui itemNorm.id ficava com o id da DIVERGÊNCIA (não da
      // recontagem), porque nada era feito nesse ramo e o valor herdado de
      // "{...item}" permanecia. A contagem enviada gravava recontagem_id
      // apontando pra um documento que não existe em dt_recontagens, então o
      // Analista nunca conseguia consolidar essa rodada — a recontagem "sumia".
      // Agora bloqueamos e pedimos sincronização em vez de seguir com um id errado.
      itemNorm.id = null;
      toast('🔄 Recontagem ainda não sincronizada neste aparelho. Toque em "Atualizar" e tente novamente.', 'w');
      return;
    }
  }

  APP.modoRecontagem = itemNorm;
  _marcarRecontagemIniciada(itemNorm);
  _endVerif = null;       // limpar cache Firebase — recontagem é sessão nova e independente
  resetContagem();
  showView('contar', document.querySelector('.nav-tab'));
  setTimeout(() => _aplicarUIRecontagem(itemNorm), 80);
}

function _aplicarUIRecontagem(item) {
  const viewContar = document.getElementById('view-contar');
  if (!viewContar) return;
  APP.recPalletAtual = 1;
  let banner = document.getElementById('banner-modo-recontagem');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'banner-modo-recontagem';
    viewContar.insertBefore(banner, viewContar.firstChild);
  }
  _atualizarBannerRecontagem(item);
  const fEnd = document.getElementById('f-endereco');
  if (fEnd) { fEnd.value=''; fEnd.disabled=false; fEnd.style.opacity=''; fEnd.placeholder='Bipe o endereço para confirmar'; setTimeout(()=>fEnd.focus(),120); }
  const fb = document.getElementById('fb-endereco');
  if (fb) fb.innerHTML = `<div class="fb warn" style="flex-direction:column;align-items:flex-start;gap:2px"><b>🔄 Nova rodada — bipe o endereço para confirmar</b><span style="font-size:.7rem;opacity:.9">Esperado: <b style="color:var(--accent)">${item.endereco}</b></span></div>`;
}

function _atualizarBannerRecontagem(item) {
  const banner = document.getElementById('banner-modo-recontagem');
  if (!banner) return;
  // Intencionalmente NÃO exibir quantidade anterior nem quantidade esperada
  // para evitar influência na nova contagem (req. independência da recontagem)
  banner.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(251,191,36,.07));border:2px solid rgba(251,191,36,.7);border-radius:12px;padding:12px 14px;margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#fbbf24;margin-bottom:5px">🔄 NOVA RODADA</div>
          <div style="font-family:var(--mono);font-weight:800;font-size:1.1rem;color:var(--warn);padding-bottom:5px;margin-bottom:5px;border-bottom:1px dashed rgba(251,191,36,.3)">📍 ${item.endereco}</div>
          ${Number(item._capacidade_rodada || item.capacidade_pallets || item.capacidade_paletes || item.capacidade || 0) > 0
            ? `<div style="font-size:.72rem;color:#fde68a;margin-bottom:5px">📦 Paletes desta rodada: <b>${Number(item._paletes_contados_rodada || 0)}</b>/<b>${Number(item._capacidade_rodada || item.capacidade_pallets || item.capacidade_paletes || item.capacidade || 0)}</b></div>`
            : `<div style="font-size:.72rem;color:#fde68a;margin-bottom:5px">📦 Registre todos os paletes e encerre com ENDERECO VAZIO</div>`}
          ${item.descricao ? `<div style="font-size:.7rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.descricao}</div>` : ''}
          ${item.observacao_atribuicao || item.observacao
            ? `<div style="margin-top:5px;padding:5px 8px;background:rgba(251,191,36,.08);border-radius:6px;font-size:.68rem;color:#fbbf24;font-style:italic">💬 ${item.observacao_atribuicao || item.observacao}</div>`
            : ''}
        </div>
        <button onclick="cancelarModoRecontagem()" style="flex-shrink:0;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.4);color:#f87171;border-radius:8px;padding:6px 10px;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap">✕ Sair</button>
      </div>
    </div>`;
}

function cancelarModoRecontagem() {
  APP.modoRecontagem = null;
  resetContagem();
  const banner = document.getElementById('banner-modo-recontagem');
  if (banner) banner.remove();
  const fEnd = document.getElementById('f-endereco');
  if (fEnd) { fEnd.disabled=false; fEnd.style.opacity=''; fEnd.value=''; }
  showView('recontagens', document.getElementById('tab-recontagens'));
}

function _concluirRecontagem() {
  const item = APP.modoRecontagem;
  if (!item) return;
  if (navigator.onLine && item.id) {
    // Coletor APENAS atualiza a recontagem — não escreve na divergência.
    // O analista é o dono da divergência. sincronizarRecontagensComContagens
    // gravará aguardando_analista quando processar a contagem recém-enviada.
    const agora = new Date().toISOString();
    const upd = { 
      status_recontagem:'concluida', 
      recontagem_concluida_em: agora, 
      operador_recontagem: APP.operador?.name || '',
      operador_uid: AUTH?.currentUser?.uid || null,
      status: 'CONCLUIDA' 
    };
    
    // Garantir que estamos atualizando o documento de RECONTAGEM e não a DIVERGÊNCIA
    const idRecontagemReal = (item._col === 'recontagem') ? item.id : (item.divergencia_id && item.id !== item.divergencia_id ? item.id : null);
    
    if (idRecontagemReal) {
      FS.collection('dt_recontagens').doc(idRecontagemReal).update(upd).catch(e=>console.warn('[Rec]',e.message));
    }
    // A divergência pertence ao Analista. O processamento da nova contagem
    // consolida a rodada e atualiza a divergência sem ampliar a permissão do Coletor.
  }
  // Marcar recontagem como concluída e encerrada na lista local
  // encerrada_definitivamente=true garante que o listener do Firebase não desfaça o estado
  const setConcluida = list => list.forEach(i => {
    if(i.id===item.id) {
      i.status_recontagem = 'concluida';
      i.encerrada_definitivamente = true;
    }
  });
  setConcluida(APP.recontagens||[]);

  // Atualizar divergência local para aguardando analista (só no estado em memória,
  // sem escrever no Firestore — o analista sobrescreve ao processar a contagem)
  const divId = item.divergencia_id || (item._col === 'divergencia' ? item.id : null);
  if (divId) {
    (APP.divergenciasAtribuidas||[]).forEach(d => {
      if (d.id === divId) {
        d.status_recontagem    = 'aguardando_analista';
        d.operador_responsavel = null;
      }
    });
  }

  // Limpar completamente o modo recontagem — não deixar estado residual
  APP.modoRecontagem = null;
  APP.recPalletAtual = 1;
  _endVerif = null;

  const banner = document.getElementById('banner-modo-recontagem');
  if (banner) banner.remove();
  const fEnd = document.getElementById('f-endereco');
  if (fEnd) { fEnd.disabled=false; fEnd.style.opacity=''; fEnd.value=''; }

  _atualizarBadgeRecontagens();
  setTimeout(() => {
    showView('recontagens', document.getElementById('tab-recontagens'));
    renderRecontagensAtribuidas();
    toast('✅ Rodada enviada — aguardando decisão do analista.', 's');
  }, 900);
}

function renderRecontagensAtribuidas() {
  const el = document.getElementById('rec-list');
  if (!el) return;
  if (_recCarregando) {
    el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--muted)"><div style="font-size:2rem;margin-bottom:8px">⏳</div><div style="font-weight:700;color:var(--text)">Buscando rodadas…</div></div>`;
    return;
  }
  const recs = (APP.recontagens||[])
    .filter(r => {
      if (_itemEncerradoColetor(r)) return false;
      // Só mostrar recontagens atribuídas ao operador atual
      return _recontagemDoOperadorAtual(r);
    })
    .map(r => ({ _id:r.id, _col:'recontagem', endereco:r.endereco||'—', descricao:r.descricao||'', barcode:r.produto||'', qtd1:r.qtd_primeira??'—', qtdEsp:r.qtd_esperada??'—', diferenca:r.diferenca??null, operador:r.operador||'', statusRec:(r.status_recontagem||'pendente'), obs:r.observacao_atribuicao||r.observacao||'', data:r.atribuido_em||'', tag:'' }));
  const endComRec = new Set(recs.map(r=>r.endereco));
  const divs = (APP.divergenciasAtribuidas||[]).filter(d => {
    if (endComRec.has(d.endereco)) return false;
    if (_itemEncerradoColetor(d)) return false;
    return true;
  }).map(d => ({ _id:d.id, _col:'divergencia', endereco:d.endereco||'—', descricao:d.descricao||'', barcode:d.gtin_bipado||d.produto||'', qtd1:d.qtd_contada??'—', qtdEsp:d.qtd_esperada??'—', diferenca:d.diferenca??null, operador:d.operador_responsavel||d.operador||'', statusRec:(d.status_recontagem||'pendente'), obs:d.observacao_atribuicao||d.observacao||'', data:d.atribuido_em||'', tag:d.tipo_divergencia||'' }));
  let fonte = [...recs, ...divs];
  let lista = _recFiltroAtivo==='todos' ? [...fonte] : fonte.filter(i=>i.statusRec===_recFiltroAtivo);
  _atualizarBadgeRecontagens();
  if (!lista.length) {
    el.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted)"><div style="font-size:2.5rem;opacity:.4;margin-bottom:10px">🔄</div><div style="font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:6px">${fonte.length>0?`Filtro "${_recFiltroAtivo}" — ${fonte.length} no banco`:'Nenhuma rodada atribuída'}</div>${fonte.length>0?`<button onclick="setRecFilter('todos',null)" style="margin-top:8px;padding:7px 18px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--accent);font-size:.78rem;font-weight:700;cursor:pointer">Ver todos (${fonte.length})</button>`:''}</div>`;
    return;
  }
  // Status que significam "encerrado" para o operador — não aparecem como ação pendente
  const _stEnc = ['concluida','sem_divergencia','resolvida','aguardando_analista','cancelada'];
  lista.sort((a,b) => {
    const ord = {pendente:0, em_andamento:1, aguardando_analista:3, concluida:4, sem_divergencia:4, resolvida:4, cancelada:5};
    const oa = ord[a.statusRec] ?? 2, ob = ord[b.statusRec] ?? 2;
    return oa !== ob ? oa - ob : a.endereco.localeCompare(b.endereco);
  });
  const tagMap = { PRODUTO_NAO_IDENTIFICADO:'🔍 Produto não identificado', PRODUTO_FORA_ENDERECO:'📍 Produto fora do endereço', QUANTIDADE_DIFERENTE:'🔢 Quantidade divergente' };

  // ── Agrupar por endereço — cada endereço aparece 1 vez mesmo com vários produtos ──
  const gruposMap = {};
  for (const item of lista) {
    const end = item.endereco;
    if (!gruposMap[end]) {
      gruposMap[end] = { endereco: end, itens: [], _id: item._id, _col: item._col,
        operador: item.operador, data: item.data, obs: item.obs };
    }
    gruposMap[end].itens.push(item);
    // Representante do botão = item acionável (não encerrado para o operador)
    if (!_stEnc.includes(item.statusRec)) gruposMap[end]._id = item._id;
  }
  const grupos = Object.values(gruposMap);

  // Para os contadores do topo, contar por endereço único
  // "pendente" = endereços que o operador ainda precisa agir (excluí aguardando_analista)
  const endUnicas = grupos.length;
  const pendEndN  = grupos.filter(g => g.itens.some(i => !_stEnc.includes(i.statusRec))).length;
  const aguardN   = grupos.filter(g => !g.itens.some(i => !_stEnc.includes(i.statusRec)) && g.itens.some(i => i.statusRec === 'aguardando_analista')).length;

  let html = `<div style="font-size:.72rem;color:var(--muted);padding:0 2px 10px;display:flex;gap:12px;flex-wrap:wrap">
    <span>📋 <b style="color:var(--text)">${endUnicas} endereço(s)</b></span>
    ${pendEndN > 0 ? `<span>⏳ <b style="color:var(--warn)">${pendEndN} para re-contar</b></span>` : ''}
    ${aguardN  > 0 ? `<span>🔒 <b style="color:#818cf8">${aguardN} aguard. analista</b></span>` : ''}
    <span>✅ <b style="color:var(--success)">${endUnicas - pendEndN - aguardN}</b></span>
  </div>`;

  // Ordenar grupos: acionáveis primeiro, aguardando segundo, encerrados por último
  grupos.sort((a, b) => {
    const aPend  = a.itens.some(i => !_stEnc.includes(i.statusRec));
    const bPend  = b.itens.some(i => !_stEnc.includes(i.statusRec));
    const aAguard = !aPend && a.itens.some(i => i.statusRec === 'aguardando_analista');
    const bAguard = !bPend && b.itens.some(i => i.statusRec === 'aguardando_analista');
    if (aPend !== bPend) return aPend ? -1 : 1;
    if (aAguard !== bAguard) return aAguard ? -1 : 1;
    return a.endereco.localeCompare(b.endereco);
  });

  for (const grupo of grupos) {
    const concluida       = grupo.itens.every(i => ['concluida','sem_divergencia','resolvida'].includes(i.statusRec));
    const aguardando      = !concluida && grupo.itens.every(i => i.statusRec === 'aguardando_analista');
    const isDiv           = grupo._col === 'divergencia';
    const nProdutos       = grupo.itens.length;
    let dataStr = '';
    try { if (grupo.data) dataStr = new Date(grupo.data).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); } catch(e){ console.warn("[Erro tratado]", e); }

    // Listar produtos distintos do grupo
    const produtosUnicos = [...new Map(grupo.itens.map(i => [i.barcode||i.descricao, i])).values()];
    const produtosHtml = produtosUnicos.map(i =>
      `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        ${i.descricao?`<span style="font-size:.78rem;font-weight:600;color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.descricao}</span>`:''}
        ${i.barcode?`<span style="font-size:.65rem;color:var(--muted);font-family:var(--mono)">📦 ${i.barcode}</span>`:''}
        ${i.diferenca!=null?`<span style="font-size:.78rem;font-weight:800;color:${i.diferenca<0?'var(--danger)':'var(--warn)'};">${i.diferenca>0?'+':''}${i.diferenca}</span>`:''}
      </div>`
    ).join('');

    // Definir estilo do card conforme estado
    const borderColor = concluida ? 'rgba(0,255,160,.2)' : aguardando ? 'rgba(99,102,241,.35)' : isDiv ? 'rgba(255,179,0,.35)' : 'rgba(232,117,26,.3)';
    const accentColor = concluida ? 'var(--success)' : aguardando ? '#818cf8' : isDiv ? 'var(--warn)' : 'var(--accent)';
    const cardOpacity = (concluida || aguardando) ? '.65' : '1';

    html += `<div style="background:var(--card);margin-bottom:8px;border-radius:12px;padding:13px 14px;border:1.5px solid ${borderColor};border-left:4px solid ${accentColor};opacity:${cardOpacity}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
        <div style="font-family:var(--mono);font-weight:800;font-size:1rem;color:${accentColor}">${grupo.endereco}</div>
        ${nProdutos>1?`<span style="font-size:.65rem;font-weight:700;background:rgba(232,117,26,.15);color:var(--accent);border-radius:99px;padding:2px 8px">${nProdutos} produtos</span>`:''}
      </div>
      <div style="margin-bottom:6px">${produtosHtml}</div>
      ${grupo.obs?`<div style="padding:5px 8px;background:rgba(255,179,0,.08);border:1px solid rgba(255,179,0,.2);border-radius:6px;font-size:.68rem;color:var(--text);margin-bottom:5px">💬 ${grupo.obs}</div>`:''}
      <div style="font-size:.62rem;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;margin-bottom:${(concluida||aguardando)?'0':'8px'}">${grupo.operador?`<span>👤 ${grupo.operador}</span>`:''} ${dataStr?`<span>📅 ${dataStr}</span>`:''}</div>
      ${concluida
        ?`<div style="text-align:center;font-size:.75rem;color:var(--success);font-weight:700;padding:8px;background:rgba(0,214,143,.08);border-radius:8px">${grupo.itens.some(i=>i.statusRec==='sem_divergencia'||i.statusRec==='resolvida')?'✅ SEM DIFERENÇA':'✅ CONCLUÍDA'}</div>`
        : aguardando
          ?`<div style="text-align:center;font-size:.75rem;color:#818cf8;font-weight:700;padding:8px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.25);border-radius:8px">🔒 Aguardando decisão do analista</div>`
          :`<button onclick="selecionarEnderecoRecontagem('${grupo._id}')" style="width:100%;padding:12px;background:linear-gradient(135deg,${isDiv?'#f59e0b,#d97706':'#E8751A,#C45E0E'});color:#fff;font-weight:800;border:none;border-radius:10px;font-size:.88rem;cursor:pointer">📍 Iniciar rodada — ${grupo.endereco}</button>`
      }
    </div>`;
  }
  el.innerHTML = html;
}
