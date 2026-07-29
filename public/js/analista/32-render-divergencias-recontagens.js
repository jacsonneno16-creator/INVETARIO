function state(){ return window.AnalistaStore.getState(); }
const _FK = window.InventoryFlowKey;
const _normRec = v => _FK.texto(v);
const _inventarioCanonicoRec = obj => _FK.inventario(obj, state().inventarios);
const _produtoCanonicoRec = obj => _FK.produto(obj);

const _nomeProdutoRec = valor => {
  const codigo = String(valor || '').trim();
  if (!codigo) return 'Produto nao informado';
  try {
    const ach = window.DTProdutos?.buscarSync?.(codigo);
    if (ach?.encontrado) {
      return String(ach.nomeProduto || ach.descricao || ach.descricaoProduto || ach.produto_nome || codigo).trim();
    }
  } catch(e) {}
  const produtoEstado = (state().produtos || []).find(p =>
    [p.codigo, p.codigo_produto, p.codigoInterno, p.codigo_interno, p.gtin, p.ean, p.dun]
      .filter(Boolean).map(String).includes(codigo));
  return String(produtoEstado?.descricao || produtoEstado?.nome || produtoEstado?.descricao_produto || codigo).trim();
};

const _totalEsperadoEnderecoRec = obj => {
  const invCanonico = _inventarioCanonicoRec(obj);
  const endereco = _FK.endereco(obj?.endereco);
  const inventario = (state().inventarios || []).find(i => _inventarioCanonicoRec(i) === invCanonico);
  const itens = (inventario?.base || []).filter(item => _FK.endereco(item?.endereco) === endereco);
  const qtd = item => {
    const bruto = item?.quantidade_esperada ?? item?.quantidadeEsperada ?? item?.qtd_esperada ?? item?.qtdEsperada ??
      item?.quantidade_enderecada ?? item?.qtd_enderecada ?? item?.saldo_estoque ?? item?.saldo ??
      item?.saldo_erp ?? item?.qtd_sistema ?? item?.qtd_estoque ?? item?.estoque_total ??
      item?.estoque ?? item?.quantidade ?? item?.qtd ?? item?.qtde;
    const n = Number(String(bruto ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  if (itens.length) return itens.reduce((total, item) => total + qtd(item), 0);
  const snap = Array.isArray(obj?.itens_esperados) ? obj.itens_esperados : [];
  if (snap.length) return snap.reduce((total, item) => total + qtd(item), 0);
  const fallback = Number(String(obj?.qtd_esperada ?? '').replace(',', '.'));
  return Number.isFinite(fallback) ? fallback : null;
};



// Regra autoritativa da visao consolidada por endereco:
// se uma recontagem concluida totaliza exatamente o total esperado do endereco,
// o fluxo esta resolvido. Nao reutilizar a qtd_esperada individual da divergencia.
const _avaliarTotalConsolidadoRec = (obj, totalEsperado) => {
  // A tabela, o modal e a aba Contagens devem avaliar exatamente os mesmos
  // totais exibidos. Nao priorizar status/documentos legados do endereco.
  return window.AnalistaDivergenciasRuntime?.avaliarResumo?.(obj, totalEsperado) ||
    window.AnalistaDivergenciasRuntime?.avaliarHistorico?.({
      ...(obj || {}),
      qtd_esperada: totalEsperado,
      comparacao_somente_quantidade: true,
      fluxo_consolidado_endereco: true
    }) || null;
};

// Único tradutor da avaliação consolidada para os campos exibidos em todas as telas.
// Divergências e Recontagens devem chamar esta função, sem reinterpretar estados.
const _aplicarAvaliacaoConsolidadaRec = (principal, totalEsperado) => {
  const avaliacao = _avaliarTotalConsolidadoRec(principal, totalEsperado);
  if (!avaliacao) return { principal, avaliacao:null };

  if (avaliacao.estado === 'RESOLVIDA') {
    Object.assign(principal, {
      status:'RESOLVIDA', status_recontagem:'sem_divergencia',
      contagem_aceita:avaliacao.referencia,
      qtd_resultado_final:avaliacao.resultado?.qtd ?? null,
      produto_resultado_final:avaliacao.resultado?.produto || '',
      divergencia_resolvida:true, encerrada_definitivamente:true,
      precisa_recontagem:false, operador_responsavel:null
    });
  } else if (avaliacao.estado === 'PERSISTENTE') {
    Object.assign(principal, {
      status:'PERSISTENTE', status_recontagem:'persistente',
      contagem_aceita:null,
      qtd_resultado_final:avaliacao.resultado?.qtd ?? null,
      produto_resultado_final:avaliacao.resultado?.produto || '',
      divergencia_resolvida:false, encerrada_definitivamente:true,
      precisa_recontagem:false, operador_responsavel:null
    });
  } else if (avaliacao.estado === 'AGUARDANDO_ANALISTA') {
    Object.assign(principal, {
      status:'ABERTA', status_recontagem:'aguardando_analista',
      precisa_recontagem:true, contagem_aceita:null,
      qtd_resultado_final:null, produto_resultado_final:'',
      divergencia_resolvida:false, encerrada_definitivamente:false,
      resolvida_em:null, finalizada_em:null, operador_responsavel:null
    });
  }
  principal._avaliacao_consolidada = avaliacao;
  return { principal, avaliacao };
};

const _chaveEndereco = obj => {
  const x = Object.assign({}, obj || {});
  // Nao reutiliza chave_fluxo antiga: ela pode ter sido gravada sem produto.
  delete x.chave_fluxo;
  return _FK.chave(x, state().inventarios);
};
// ───────────────────────────────────────────────────────────────────
//  16. RENDERIZAÇÃO — DIVERGÊNCIAS
// ───────────────────────────────────────────────────────────────────

function marcarDivergenciaResolvida(divId) {
  const div = _obterDivSelecionada(divId);
  if (!div) return;
  showConfirm(`Marcar a divergência do endereço ${escHTML(div.endereco)} como RESOLVIDA?`, () => _marcarDivResolvida(divId), { title: '✅ Resolver divergência', icon: '✅', okLabel: 'Marcar resolvida', okClass: 'btn-success' }); return;
}

function _marcarDivResolvida(divId) {
  const div = _obterDivSelecionada(divId);
  if (!div) return;
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
let _divDadosFiltradosExport = [];
let _recDadosFiltradosExport = [];
// Mantém a mesma visão consolidada usada pela tabela. Sem isso, o clique no
// checkbox voltava ao documento bruto de divergência, que podia estar com flags
// antigas de encerramento mesmo quando o histórico atual ainda era divergente.
let _divSelecionaveisRender = new Map();

function _obterDivSelecionada(id) {
  return _divSelecionaveisRender.get(String(id)) ||
    state().divergencias.find(d => String(d.id) === String(id)) || null;
}

function divPodeSelecionar(div) {
  if (!div) return false;

  const status = String(div.status || '').trim().toUpperCase();
  const statusRec = String(div.status_recontagem || '').trim().toLowerCase();

  // A mesma regra deve valer no checkbox, no modal e na confirmação.
  // Bloquear somente quando o fluxo estiver realmente encerrado.
  if (['RESOLVIDA','PERSISTENTE','CANCELADA','EXCLUIDA'].includes(status)) return false;
  if (['resolvida','sem_divergencia','cancelada','persistente','excluida'].includes(statusRec)) return false;
  if (div.qtd_terceira != null) return false;

  const recs = (state().recontagens || []).filter(r => {
    const mesmoId = String(r.divergencia_id || '') === String(div.id || '');
    const mesmaAtividade = _FK.mesmo(r, div, state().inventarios);
    if (!mesmoId && !mesmaAtividade) return false;
    const st = String(r.status || '').toUpperCase();
    const sr = String(r.status_recontagem || '').toLowerCase();
    return !['CANCELADA','EXCLUIDA'].includes(st) && !['cancelada','excluida'].includes(sr);
  });

  // Uma tarefa pendente já atribuída não pode ser atribuída novamente.
  const pendenteAtribuida = recs.some(r => {
    const st = String(r.status || '').toUpperCase();
    const sr = String(r.status_recontagem || '').toLowerCase();
    const pendente = st === 'PENDENTE' || sr === 'pendente';
    return pendente && Boolean(r.operador || r.operador_responsavel);
  });
  if (pendenteAtribuida) return false;

  // Aguardando analista significa que a rodada anterior terminou e pode ser
  // enviada novamente, desde que ainda não exista terceira contagem.
  if (statusRec === 'aguardando_analista') return true;

  // Conta rodadas reais, eliminando documentos duplicados da mesma rodada.
  const rodadasConcluidas = new Set();
  recs.forEach(r => {
    const st = String(r.status || '').toUpperCase();
    const sr = String(r.status_recontagem || '').toLowerCase();
    const concluida = st === 'CONCLUIDA' || sr === 'concluida' ||
      Boolean(r.recontagem_concluida_em || r.concluida_em || r.finalizada_em);
    if (concluida) rodadasConcluidas.add(Number(r.numero_recontagem || 1));
  });
  if (rodadasConcluidas.size >= 2) return false;

  return ['ABERTA','EM_RECONTAGEM','DIVERGENTE'].includes(status) ||
    ['','pendente','aguardando_recontagem'].includes(statusRec);
}

function divStatusBadge(status) {
  switch (String(status || '').toUpperCase()) {
    case 'ABERTA':        return 'b-red';
    case 'EM_RECONTAGEM': return 'b-orange';
    case 'RESOLVIDA':     return 'b-green';
    case 'PERSISTENTE':   return 'b-gray';
    default:              return 'b-gray';
  }
}


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
  const div = _obterDivSelecionada(id);
  if (checked && divPodeSelecionar(div)) _divSelecionadas.add(id);
  else _divSelecionadas.delete(id);
  divAtualizarBarraSel();
  // Atualizar checkbox master
  const chkAll = document.getElementById('div-chk-all');
  if (chkAll) {
    const total = document.querySelectorAll('.div-row-chk:not(:disabled)').length;
    chkAll.indeterminate = _divSelecionadas.size > 0 && _divSelecionadas.size < total;
    chkAll.checked = total > 0 && _divSelecionadas.size === total;
  }
}

function divToggleTodos(checked) {
  document.querySelectorAll('.div-row-chk:not(:disabled)').forEach(chk => {
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
  const div = state().divergencias.find(d => d.id === divId);
  const recontagensValidas = state().recontagens.filter(r =>
    r.divergencia_id === divId &&
    !['CANCELADA','EXCLUIDA'].includes(String(r.status || '').toUpperCase()) &&
    !['cancelada','excluida'].includes(String(r.status_recontagem || '').toLowerCase())
  );
  const concluidas = recontagensValidas.filter(r =>
    String(r.status || '').toUpperCase() === 'CONCLUIDA' ||
    String(r.status_recontagem || '').toLowerCase() === 'concluida' ||
    Boolean(r.recontagem_concluida_em || r.concluida_em || r.finalizada_em)
  ).length;
  if (!div || !divPodeSelecionar(div) || div.qtd_terceira != null || concluidas >= 2) {
    showToast('🔒 Esta atividade já atingiu o limite de contagens ou está encerrada.', 'e');
    return;
  }
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
  sel.innerHTML = '<option value="">⏳ Carregando todos os logins...</option>';
  sel.disabled = true;

  const mapa = new Map();
  const adicionar = u => {
    if (!u || u.ativo === false || u.conta_secundaria === true) return;
    const nome = String(u.nome || u.name || u.displayName || '').trim();
    const email = String(u.email || '').trim();
    const loginColetor = String(u.login_coletor || u.email_coletor || '').trim().split('@')[0];
    const emailAnalista = String(u.email_analista || ((u.canais_acesso?.analista === true || u.perfil === 'analista') ? email : '')).trim();
    const valor = nome || loginColetor || emailAnalista || email;
    if (!valor) return;
    const chave = String(u.uid || u.id || email || loginColetor || valor).toLowerCase();
    const logins = [...new Set([loginColetor, emailAnalista, email].filter(Boolean))];
    mapa.set(chave, { valor, nome: nome || valor, logins, perfil: u.perfil || u.tipo || '' });
  };

  // Lista oficial de usuários e logins criados no sistema.
  try {
    const raw = window.getDTRawFirestore?.();
    if (raw) {
      const snap = await raw.collection('usuarios_acessos').get();
      snap.docs.forEach(d => adicionar({ id:d.id, ...d.data() }));
    }
  } catch(e) {
    console.warn('[Atribuição] usuários_acessos:', e.message);
  }

  // Compatibilidade com cadastros antigos em dt_operadores.
  if (!mapa.size && typeof FS_AN !== 'undefined') {
    try {
      const snap = await FS_AN.collection('dt_operadores').get();
      snap.docs.forEach(d => adicionar({ id:d.id, ...d.data() }));
    } catch(e) {
      console.warn('[Atribuição] dt_operadores:', e.message);
    }
  }

  // Fallback local para não bloquear a operação se a rede estiver indisponível.
  if (!mapa.size) {
    [...(state().contagens || []), ...(state().recontagens || [])].forEach(x =>
      adicionar({ id:x.operador || x.operador_responsavel, nome:x.operador || x.operador_responsavel, ativo:true })
    );
  }

  const ops = [...mapa.values()].sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  sel.disabled = false;
  if (!ops.length) {
    sel.innerHTML = '<option value="">⚠️ Nenhum login cadastrado</option>';
    return;
  }
  sel.innerHTML = '<option value="">Selecione o usuário...</option>' + ops.map(o => {
    const detalhe = o.logins.length ? ` — ${o.logins.join(' / ')}` : '';
    return `<option value="${escHTML(o.valor)}" ${o.valor===cur?'selected':''}>${escHTML(o.nome + detalhe)}</option>`;
  }).join('');
  if (cur) sel.value = cur;
}

// ── Abrir modal de atribuição ────────────────────────────────────────────────
async function abrirAtribuirRecontagem() {
  _divSelecionadas = new Set([..._divSelecionadas].filter(id =>
    divPodeSelecionar(_obterDivSelecionada(id))
  ));
  divAtualizarBarraSel();
  if (!_divSelecionadas.size) { showToast('Selecione pelo menos um endereço', 'w'); return; }

  // Resumo dos endereços selecionados
  const resumo = document.getElementById('atrib-resumo');
  if (resumo) {
    const lista = [..._divSelecionadas].map(id => {
      const d = _obterDivSelecionada(id);
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

  // Caso a linha de recontagem nao tenha divergencia vinculada, atualiza a
  // propria tarefa em vez de fechar o modal informando 0 atribuicoes.
  if (_recAtribuirDireto) {
    const recAtualizada = Object.assign({}, _recAtribuirDireto, {
      operador, operador_responsavel: operador, atribuido_por: atribPor,
      atribuido_em: agora, status: 'PENDENTE', status_recontagem: 'pendente',
      observacao_atribuicao: obs || ''
    });
    fsSalvarRecontagem(recAtualizada).catch(() => {});
    Store.dispatch(Actions.upsertEntity('recontagens', recAtualizada, { source: 'atribuirRecontagemDireto' }));
    _recAtribuirDireto = null;
    count = 1;
  }

  const selecionadasNoModal = [..._divSelecionadas]
    .map(id => _obterDivSelecionada(id))
    .filter(Boolean);

  selecionadasNoModal.forEach(d => {
    // A linha já foi validada ao ser selecionada e ao abrir o modal. A função
    // de serviço faz apenas os bloqueios finais e a gravação da tarefa.
    const rec = atribuirRecontagemSegura(d, operador, atribPor, obs, agora);
    if (!rec) return;
    count++;
  });

  saveAll();
  renderDivergencias();
  renderRecontagens();
  closeModal('modal-atribuir-recontagem');
  _divSelecionadas.clear();
  divAtualizarBarraSel();

  logSistema('ATRIBUIÇÃO_RECONTAGEM', `${count} recontagem(s) atribuída(s) a ${operador}`, { count, operador, atribPor, ts: agora });
  if (count > 0) {
    showToast(`✅ ${count} recontagem${count!==1?'s':''} atribuída${count!==1?'s':''} para ${operador}`, 's');
  } else {
    showToast('Não foi possível atribuir. Verifique se a atividade já possui operador ou atingiu a 3ª contagem.', 'e');
  }
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


// Localiza a contagem original exata que deu origem ao fluxo exibido.
// Prioridade: vínculo explícito por ID; depois mesma chave operacional completa
// (inventário + endereço + produto). Isso impede que a Recontagem mostre uma
// quantidade consolidada/legada diferente da linha correspondente em Contagens.
function _contagemOrigemExataRec(divergencia) {
  const st = state();
  const ids = [divergencia?.contagem_uuid, divergencia?.contagem_id, divergencia?.origem_contagem_id]
    .filter(Boolean).map(String);
  const validas = (st.contagens || []).filter(c =>
    String(c?.tipo_contagem || 'PRIMEIRA').toUpperCase() !== 'RECONTAGEM' &&
    !c?._excluida && !['ESTORNADA','EXCLUIDA'].includes(String(c?.status || '').toUpperCase())
  );
  let encontrada = validas.find(c => ids.includes(String(c?.uuid || c?.id || '')));
  if (encontrada) return encontrada;
  encontrada = validas.find(c => _FK.mesmo(c, divergencia, st.inventarios));
  if (encontrada) return encontrada;
  const inv = _inventarioCanonicoRec(divergencia);
  const end = _FK.endereco(divergencia?.endereco);
  const prod = _produtoCanonicoRec(divergencia);
  return validas.find(c =>
    _inventarioCanonicoRec(c) === inv && _FK.endereco(c?.endereco) === end &&
    (!prod || _produtoCanonicoRec(c) === prod)
  ) || null;
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

  // A Recontagem é um processo por endereço. Motivos diferentes detectados
  // no mesmo inventário/endereço devem ocupar uma única linha, sem esconder
  // o histórico das rodadas nem inflar os indicadores.
  const gruposPorEndereco = new Map();
  const divergenciasVisiveis = [...state().divergencias];

  // Uma rodada pode continuar existindo no Firebase mesmo quando a divergência
  // vinculada foi removida/arquivada por versões anteriores. O menu contava essa
  // rodada, mas a tela renderizava apenas divergências e, por isso, ficava vazia.
  // Recompõe um caso visual a partir da própria recontagem para não esconder a
  // atividade pendente do Analista.
  state().recontagens.forEach(r => {
      const vinculada = divergenciasVisiveis.some(d => {
        return (
          (r.divergencia_id && String(d.id) === String(r.divergencia_id)) ||
          (String(d.inventario_id || '') === String(r.inventario_id || r.inventarioId || '') &&
           _FK.endereco(d.endereco) === _FK.endereco(r.endereco))
        );
      });
      if (vinculada) return;
      const statusRec = String(r.status_recontagem || r.status || '').toLowerCase();
      const concluida = ['concluida','resolvida'].includes(statusRec);
      const persistente = statusRec === 'persistente' ||
        String(r.status_bloqueio || '').toUpperCase() === 'PERSISTENTE_BLOQUEADO';
      divergenciasVisiveis.push({
        ...r,
        id: r.divergencia_id || `recontagem-${r.id}`,
        _recontagem_orfa_id: r.id,
        inventario_id: r.inventario_id || r.inventarioId || '',
        status: persistente ? 'PERSISTENTE' : (concluida ? 'RESOLVIDA' :
          (statusRec === 'aguardando_analista' ? 'ABERTA' : 'EM_RECONTAGEM')),
        status_recontagem: concluida ? 'concluida' : statusRec,
        operador_responsavel: r.operador_responsavel || r.operador || '',
        criada_em: r.criada_em || r.atribuido_em || r.data || '',
        tipo_divergencia: r.tipo_divergencia || 'RECONTAGEM_PENDENTE',
        motivos_divergencia: r.motivos_divergencia || ['Recontagem pendente'],
        produto: r.produto || r.gtin || r.codigo || '',
        quantidade_contada: r.quantidade_contada ?? r.quantidade ?? r.qtd ?? null
      });
    });

  const _invCanonicoHist = obj => {
    const bruto = String(obj?.inventario_id || obj?.inventarioId || obj?.inventario || '').trim();
    const inv = (state().inventarios || []).find(i =>
      [i.id,i.codigo,i.nome,i.inventario_id,i.inventarioId].filter(Boolean).map(String).includes(bruto));
    return String(inv?.id || bruto);
  };
  const _chaveHist = obj =>
    `${_invCanonicoHist(obj)}|${String(obj?.endereco || '').trim().toUpperCase()}`;
  divergenciasVisiveis.forEach(d => {
    const chave = _chaveHist(d);
    const grupo = gruposPorEndereco.get(chave) || [];
    grupo.push(d);
    gruposPorEndereco.set(chave, grupo);
  });
  let dados = [...gruposPorEndereco.values()].map(grupo => {
    const ordenado = [...grupo].sort((a,b) => {
      const ativaA = !['RESOLVIDA','PERSISTENTE','CANCELADA'].includes(String(a.status || '').toUpperCase());
      const ativaB = !['RESOLVIDA','PERSISTENTE','CANCELADA'].includes(String(b.status || '').toUpperCase());
      const pa = (ativaA ? 10 : 0) + (String(a.status_recontagem || '').toLowerCase() === 'aguardando_analista' ? 3
        : (a.operador_responsavel ? 2 : 1));
      const pb = (ativaB ? 10 : 0) + (String(b.status_recontagem || '').toLowerCase() === 'aguardando_analista' ? 3
        : (b.operador_responsavel ? 2 : 1));
      return pb - pa || String(b.criada_em || '').localeCompare(String(a.criada_em || ''));
    });
    const principal = Object.assign({}, ordenado[0]);
    const contagemOrigem = _contagemOrigemExataRec(principal);
    if (contagemOrigem) {
      principal._contagem_origem = contagemOrigem;
      principal.qtd_contada = contagemOrigem.quantidade ?? contagemOrigem.qtd ?? contagemOrigem.qtd_contada ?? principal.qtd_contada;
      principal.qtd_primeira = principal.qtd_contada;
      principal.produto_contado = contagemOrigem.gtin_bipado || contagemOrigem.codigoLido || contagemOrigem.codigo_lido || contagemOrigem.dunLido || contagemOrigem.gtinLido || contagemOrigem.codigo_produto || contagemOrigem.gtin || principal.produto_contado;
      principal.produto_primeira = principal.produto_contado;
      principal.descricao_contada = contagemOrigem.descricao_produto || contagemOrigem.descricao || principal.descricao_contada;
      principal.operador = contagemOrigem.operador || contagemOrigem.operador_nome || principal.operador;
      principal.operador_primeira = principal.operador;
      principal.criada_em = contagemOrigem.timestamp || contagemOrigem.criado_em || contagemOrigem.dataHora || principal.criada_em;
      principal.data_primeira = principal.criada_em;
    }
    const recsEndereco = (state().recontagens || [])
      .filter(r => _chaveHist(r) === _chaveHist(principal))
      .sort((a,b) => String(a.recontagem_concluida_em || a.concluida_em || a.criada_em || '')
        .localeCompare(String(b.recontagem_concluida_em || b.concluida_em || b.criada_em || '')));
    const recsExecutadas = recsEndereco.filter(r =>
      r.qtd_recontagem != null || r.qtd_segunda != null || r.qtd_terceira != null ||
      ['CONCLUIDA','RESOLVIDA'].includes(String(r.status || '').toUpperCase()));
    const segunda = recsExecutadas[0] || {};
    const terceira = recsExecutadas[1] || {};
    principal._divergencias_agrupadas = grupo.map(x => x.id);
    principal.motivos_divergencia = [...new Set(grupo.flatMap(x =>
      Array.isArray(x.motivos_divergencia) ? x.motivos_divergencia : [x.tipo_divergencia]
    ).filter(Boolean))];
    principal.itens_esperados = grupo.flatMap(x => Array.isArray(x.itens_esperados) ? x.itens_esperados : []);
    ['qtd_segunda','produto_segunda','operador_segunda','data_segunda',
     'qtd_terceira','produto_terceira','operador_terceira','data_terceira',
     'qtd_resultado_final','produto_recontagem','operador_recontagem'].forEach(campo => {
      const origem = ordenado.find(x => x[campo] != null && x[campo] !== '');
      if (origem) principal[campo] = origem[campo];
    });
    principal.qtd_segunda = principal.qtd_segunda ?? segunda.qtd_segunda ?? segunda.qtd_recontagem;
    principal.produto_segunda = principal.produto_segunda || segunda.produto_segunda || segunda.produto_recontagem || segunda.produto || '';
    principal.operador_segunda = principal.operador_segunda || segunda.operador_segunda || segunda.operador_recontagem || segunda.operador || '';
    principal.data_segunda = principal.data_segunda || segunda.data_segunda || segunda.recontagem_concluida_em || segunda.concluida_em || '';
    principal.qtd_terceira = principal.qtd_terceira ?? terceira.qtd_terceira ?? terceira.qtd_recontagem;
    principal.produto_terceira = principal.produto_terceira || terceira.produto_terceira || terceira.produto_recontagem || terceira.produto || '';
    principal.operador_terceira = principal.operador_terceira || terceira.operador_terceira || terceira.operador_recontagem || terceira.operador || '';
    principal.data_terceira = principal.data_terceira || terceira.data_terceira || terceira.recontagem_concluida_em || terceira.concluida_em || '';
    principal._recontagens_endereco = recsEndereco;
    principal._vezes_contado = 1 + (principal.qtd_segunda != null ? 1 : 0) + (principal.qtd_terceira != null ? 1 : 0);
    // Nunca confiar cegamente no status legado. O resultado deve ser
    // recalculado pelas rodadas reais: só há OK quando produto e quantidade
    // coincidem com o sistema ou com uma contagem anterior.
    const totalEsperadoEndereco = _totalEsperadoEnderecoRec(principal);
    principal._qtd_esperada_endereco = totalEsperadoEndereco;
    // A linha consolidada representa o endereco inteiro. Para decidir o consenso,
    // comparar o total contado com o total esperado do endereco, sem exigir que
    // todas as rodadas tenham repetido o mesmo codigo de produto.
    _aplicarAvaliacaoConsolidadaRec(principal, totalEsperadoEndereco);
    return principal;
  });
  // Snapshot sem filtros da mesma visão consolidada usada pela tabela. Os cards
  // não podem contar documentos brutos com status legado diferente do exibido.
  const dadosConsolidados = dados.slice();
  if (fInv)    dados = dados.filter(d => d.inventario_id === fInv);
  if (fStatus) {
    dados = dados.filter(d => d.status === fStatus);
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
    const cont = d._contagem_origem || _contagemOrigemExataRec(d);
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

  _divDadosFiltradosExport = dados.slice();

  // A seleção deve obedecer ao resultado consolidado que o usuário está vendo,
  // e não ao documento bruto possivelmente desatualizado em dt_divergencias.
  _divSelecionaveisRender = new Map(
    dados.filter(d => divPodeSelecionar(d)).map(d => [String(d.id), d])
  );
  for (const id of [..._divSelecionadas]) {
    if (!_divSelecionaveisRender.has(String(id))) _divSelecionadas.delete(id);
  }

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
    const cont = d._contagem_origem || _contagemOrigemExataRec(d);
    return d.operador || cont?.operador || '';
  }).filter(Boolean))].sort();
  _popSel('div-frua',      todasRuas,    fRua,      'Todas as ruas');
  _popSel('div-fnivel',    todosNiveis,  fNivel,    'Todos os níveis');
  _popSel('div-fsetor',    todosSetores, fSetor,    'Todos os setores');
  _popSel('div-fproduto',  todosProds,   fProduto,  'Todos os produtos');
  _popSel('div-foperador', todosOps,     fOperador, 'Todos os operadores');

  // KPIs
  // Os indicadores usam a mesma fonte consolidada da tabela, inclusive
  // recontagens órfãs recuperadas acima.
  const all        = dadosConsolidados.filter(d => !fInv || String(d.inventario_id) === String(fInv));
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
        <th>Inventário</th><th>Rua</th><th>Endereço</th><th>Vezes contado</th>
        <th>Operador Contagem</th><th>Data</th><th>Tipo</th>
        <th>Esperado no endereço</th><th>1ª Contagem</th>
        <th>2ª Contagem</th><th>3ª Contagem</th><th>Resultado</th>
        <th>Status</th><th>Status Recontagem</th><th>Atribuído para</th><th>Executado por</th><th>Ações</th>
      </tr></thead>
      <tbody>
        ${dados.map(d => {
          const difColor = d.diferenca > 0 ? 'var(--warn)' : d.diferenca < 0 ? 'var(--danger)' : 'var(--success)';
          const idsAgrupados = d._divergencias_agrupadas || [d.id];
          const rec = state().recontagens
            .filter(r => idsAgrupados.includes(r.divergencia_id))
            .sort((a,b) => (b.numero_recontagem||1) - (a.numero_recontagem||1))[0] || null;
          const endInfo = getEnderecoInfo(d.endereco);
          const rua = endInfo?.rua || '—';
          const cont = d._contagem_origem || _contagemOrigemExataRec(d);
          const operador = d.operador || cont?.operador || '—';
          const podeSelecionar = divPodeSelecionar(d);
          if (!podeSelecionar) _divSelecionadas.delete(d.id);
          const selecionado = podeSelecionar && _divSelecionadas.has(d.id);

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
          const inventario = state().inventarios.find(i =>
            String(i.id || '') === String(d.inventario_id || '') ||
            String(i.codigo || '') === String(d.inventario_id || '') ||
            String(i.nome || '') === String(d.inventario_id || '')
          );
          const esperadosDaBase = (inventario?.base || []).filter(item =>
            _FK.mesmo(item, d, state().inventarios)
          );
          const esperadosEndereco = esperadosDaBase.length
            ? esperadosDaBase
            : (Array.isArray(d.itens_esperados) ? d.itens_esperados : []);
          const _qtdEsperadaItem = item => {
            const bruto = item.quantidade_esperada ?? item.quantidadeEsperada ?? item.qtd_esperada ?? item.qtdEsperada ??
              item.quantidade_enderecada ?? item.qtd_enderecada ?? item.saldo_estoque ?? item.saldo ??
              item.saldo_erp ?? item.qtd_sistema ?? item.qtd_estoque ?? item.estoque_total ??
              item.estoque ?? item.quantidade ?? item.qtd ?? item.qtde;
            const numero = Number(String(bruto ?? '').replace(',', '.'));
            return Number.isFinite(numero) ? numero : 0;
          };
          const totalEsperadoEndereco = d._qtd_esperada_endereco != null
            ? d._qtd_esperada_endereco
            : (esperadosEndereco.length
              ? esperadosEndereco.reduce((total, item) => total + _qtdEsperadaItem(item), 0)
              : Number(qtdEspTxt) || 0);
          const quantidadePaletes = esperadosEndereco.length || 1;
          const esperadoHtml = `<button type="button" onclick="abrirDetalhePaletesEsperados(decodeURIComponent('${encodeURIComponent(String(d.id || ''))}'))"
            title="Clique para visualizar os paletes"
            style="width:100%;min-width:145px;text-align:left;border:1px solid rgba(59,130,246,.28);background:rgba(59,130,246,.07);border-radius:10px;padding:8px 10px;cursor:pointer;color:inherit">
              <div class="mono" style="font-weight:850;font-size:.78rem">Total esperado: ${escHTML(totalEsperadoEndereco)}</div>
              <div style="font-size:.66rem;color:var(--muted);margin-top:3px">📦 ${quantidadePaletes} ${quantidadePaletes === 1 ? 'palete' : 'paletes'} · clique para detalhar</div>
            </button>`;
          const produtoBipado = d.produto_contado || d.gtin_bipado || d.produto || '—';
          const descricaoBipada = d.descricao_contada || d.descricao || '';

          // Status recontagem
          const statusRec = d.status_recontagem || (rec ? (rec.status==='CONCLUIDA' ? 'concluida' : 'pendente') : '');
          const atribPara = d.operador_responsavel || rec?.operador || '';
          const executadoPor = rec?.operador_recontagem || d.operador_recontagem || '';
          const _produtoRodada = valor => {
            const partes = Array.isArray(valor) ? valor : String(valor || '').split(/[,;|]+/);
            const esperado = _produtoCanonicoRec(d);
            const limpas = partes.map(v => String(v || '').trim()).filter(Boolean);
            const correspondente = limpas.find(v => _produtoCanonicoRec({ produto:v }) === esperado);
            return correspondente || limpas[0] || d.produto_contado || d.produto || '—';
          };
          const _qtdBateTotal = qtd => {
            if (qtd === null || qtd === undefined || String(qtd).trim() === '') return false;
            const n = Number(String(qtd).replace(',', '.'));
            const esperado = Number(String(totalEsperadoEndereco).replace(',', '.'));
            return Number.isFinite(n) && Number.isFinite(esperado) && n === esperado;
          };
          const _cellRodada = (qtd, produto, operadorRodada, dataRodada, aguardando) => {
            if (qtd == null) {
              return `<td><div style="color:var(--muted);font-size:.7rem;text-align:center">${aguardando ? 'Aguardando' : '—'}</div></td>`;
            }
            const codigo = _produtoRodada(produto);
            const nome = _nomeProdutoRec(codigo);
            const bateu = _qtdBateTotal(qtd);
            const estilo = bateu
              ? 'background:rgba(34,197,94,.12);box-shadow:inset 3px 0 0 var(--success);'
              : '';
            return `<td style="${estilo}"><div style="font-weight:800;color:${bateu ? 'var(--success)' : 'inherit'}" title="Codigo: ${escHTML(codigo)}">${bateu ? '✅ ' : ''}${escHTML(nome)}</div><div style="font-family:var(--mono);font-size:.72rem;margin-top:2px;font-weight:${bateu ? '900' : '600'};color:${bateu ? 'var(--success)' : 'inherit'}">Qtd ${escHTML(qtd)}${bateu ? ' · conferida' : ''}</div></td>`;
          };

          return `<tr style="${selecionado ? 'background:rgba(232,117,26,.06)' : ''}">
            <td style="padding:8px 10px">
              ${podeSelecionar ? `<input type="checkbox" class="div-row-chk" data-id="${d.id}"
                style="width:15px;height:15px;cursor:pointer;accent-color:var(--orange)"
                ${selecionado ? 'checked' : ''}
                onchange="divToggleSel('${d.id}', this.checked)">` : ''}
            </td>
            <td style="font-size:.75rem;color:var(--muted)">${d.inventario_nome || d.inventario_id}</td>
            <td class="mono" style="font-weight:600">${rua}</td>
            <td class="mono">${escHTML(d.endereco)}${d.endereco_correto ? `<br><span style="font-size:.65rem;color:var(--muted)">→ ${escHTML(d.endereco_correto)}</span>` : ''}</td>
            <td style="text-align:center"><span class="badge b-purple" style="font-size:.76rem">${d._vezes_contado || 1}x</span></td>
            <td style="font-size:.8rem">${operador}</td>
            <td class="mono" style="font-size:.72rem;color:var(--muted);white-space:nowrap">${fmtTs(d.criada_em)}</td>
            <td><span class="badge ${tipoCls}">${tipoTxt}</span></td>
            <td>${esperadoHtml}</td>
            ${(() => {
              // Reutilizável: renderiza célula de contagem com produto e cor
              const _qtdC1 = d.qtd_contada != null ? d.qtd_contada : '—';
              const codigo = _produtoRodada(produtoBipado);
              const nome = _nomeProdutoRec(codigo);
              const bateu = _qtdBateTotal(_qtdC1);
              return `<td style="${bateu ? 'background:rgba(34,197,94,.12);box-shadow:inset 3px 0 0 var(--success);' : ''}"><div style="font-weight:800;color:${bateu ? 'var(--success)' : 'inherit'}" title="Codigo: ${escHTML(codigo)}">${bateu ? '✅ ' : ''}${escHTML(nome)}</div><div style="font-family:var(--mono);font-size:.72rem;margin-top:2px;font-weight:${bateu ? '900' : '600'};color:${bateu ? 'var(--success)' : 'inherit'}">Qtd ${escHTML(_qtdC1)}${bateu ? ' · conferida' : ''}</div></td>`;
            })()}
            ${_cellRodada(
              rec?.qtd_segunda ?? d.qtd_segunda,
              rec?.produto_segunda ?? d.produto_segunda,
              rec?.operador_segunda ?? d.operador_segunda,
              rec?.data_segunda ?? d.data_segunda,
              statusRec === 'aguardando_analista' && (rec?.qtd_segunda ?? d.qtd_segunda) == null
            )}
            ${_cellRodada(
              rec?.qtd_terceira ?? d.qtd_terceira,
              rec?.produto_terceira ?? d.produto_terceira,
              rec?.operador_terceira ?? d.operador_terceira,
              rec?.data_terceira ?? d.data_terceira,
              false
            )}
            ${(() => {
              const resolvida = String(d.status || '').toUpperCase() === 'RESOLVIDA' ||
                String(d.status_recontagem || '').toLowerCase() === 'sem_divergencia';
              return `<td><div style="font-family:var(--mono);font-weight:800;color:${resolvida ? 'var(--success)' : 'var(--danger)'}">${resolvida ? '✅ Conferido' : '❌ Divergente'}</div></td>`;
            })()}
                        <td><span class="badge ${divStatusBadge(d.status)}">${d.status}</span></td>
            <td>
              ${statusRec
                ? `<span class="badge ${recStatusBadge(statusRec)}" style="font-size:.68rem">${recStatusLabel(statusRec)}</span>`
                : `<span style="font-size:.72rem;color:var(--muted-2)">—</span>`}
            </td>
            <td>
              ${atribPara
                ? `<div style="font-size:.78rem;font-weight:600;color:var(--text)">${escHTML(atribPara)}</div>
                   ${d.atribuido_em ? `<div style="font-size:.65rem;color:var(--muted)">${fmtTs(d.atribuido_em)}</div>` : ''}`
                : `<span style="font-size:.72rem;color:var(--muted-2)">Não atribuído</span>`}
            </td>
            <td>
              ${executadoPor
                ? `<div style="font-size:.78rem;font-weight:700;color:var(--success)">${escHTML(executadoPor)}</div>
                   ${rec?.recontagem_concluida_em ? `<div style="font-size:.65rem;color:var(--muted)">${fmtTs(rec.recontagem_concluida_em)}</div>` : ''}`
                : `<span style="font-size:.72rem;color:var(--muted-2)">—</span>`}
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
  // Recria automaticamente vínculos ausentes antes de montar a fila. O botão
  // "Processar Contagens" continua disponível, mas não é mais necessário para
  // uma primeira divergência aparecer e poder ser atribuída.
  const faltaVinculo = (state().contagens || []).some(c => {
    if (String(c.tipo_contagem || '').toUpperCase() === 'RECONTAGEM' ||
        c.divergente !== true || c._excluida ||
        ['ESTORNADA','EXCLUIDA'].includes(String(c.status || '').toUpperCase())) return false;
    const id=String(c.inventario_id || c.inventarioId || '');
    const inv=(state().inventarios || []).find(i =>
      [i.id,i.codigo,i.nome,i.inventario_id,i.inventarioId]
        .filter(Boolean).map(String).includes(id));
    const aliases=inv
      ? [inv.id,inv.codigo,inv.nome,inv.inventario_id,inv.inventarioId].filter(Boolean).map(String)
      : [id];
    const end=_FK.endereco(c.endereco);
    const prod=_normRec(c.gtin || c.codigo_produto || c.codigoLido || c.produto || '');
    return !(state().divergencias || []).some(d =>
      aliases.includes(String(d.inventario_id || d.inventarioId || '')) &&
      _FK.endereco(d.endereco) === end &&
      (!prod || _produtoCanonicoRec(d) === prod));
  });
  if (faltaVinculo && typeof processarDivergencias === 'function') {
    processarDivergencias({ criarRecontagens:false, source:'render-recontagens', force:true });
  }
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

  // A unidade operacional é inventário + endereço + produto, usando a mesma
  // normalização da aba Contagens e da rotina de atribuição.
  const _gruposRec = new Map();
  const _adicionarGrupo = (obj, tipo) => {
    if (!obj || !_normRec(obj.endereco)) return;
    const chave = _chaveEndereco(obj);
    const grupo = _gruposRec.get(chave) || { divergencias:[], recontagens:[] };
    grupo[tipo].push(obj);
    _gruposRec.set(chave, grupo);
  };
  state().divergencias.forEach(d => _adicionarGrupo(d, 'divergencias'));
  state().recontagens.forEach(r => _adicionarGrupo(r, 'recontagens'));
  state().contagens.filter(c =>
    String(c.tipo_contagem || '').toUpperCase() !== 'RECONTAGEM' &&
    c.divergente === true && !c._excluida &&
    !['ESTORNADA','EXCLUIDA'].includes(String(c.status || '').toUpperCase())
  ).forEach(c => {
    const chave=_chaveEndereco(c);
    const grupo=_gruposRec.get(chave) || { divergencias:[], recontagens:[] };
    if (!grupo.divergencias.length) {
      grupo.divergencias.push({
        id:`contagem-${c.uuid || c.id || chave}`,
        inventario_id:_inventarioCanonicoRec(c), endereco:c.endereco,
        produto:c.gtin || c.codigo_produto || c.codigoLido || '',
        descricao:c.descricao_produto || c.descricao || '',
        qtd_esperada:c.qtd_esperada ?? c.quantidade_esperada ?? c.qtd_sistema ?? null,
        qtd_contada:c.quantidade ?? c.qtd_caixas ?? null,
        qtd_primeira:c.quantidade ?? c.qtd_caixas ?? null,
        produto_primeira:c.gtin || c.codigo_produto || c.codigoLido || '',
        operador_primeira:c.operador || c.operador_nome || '',
        data_primeira:c.timestamp || c.criado_em || c.dataHora || '',
        status:'EM_RECONTAGEM', status_recontagem:'aguardando_analista',
        precisa_recontagem:true, chave_fluxo:_chaveEndereco(c), _virtual_de_contagem:true
      });
    }
    _gruposRec.set(chave,grupo);
  });

  let dados = [..._gruposRec.values()].map(grupo => {
    const divs = [...grupo.divergencias].sort((a,b) =>
      String(b.criada_em || '').localeCompare(String(a.criada_em || ''))
    );
    const recs = [...grupo.recontagens].sort((a,b) =>
      Number(a.numero_recontagem || 1) - Number(b.numero_recontagem || 1) ||
      String(a.criada_em || '').localeCompare(String(b.criada_em || ''))
    );
    const principal = Object.assign({}, recs[recs.length - 1] || divs[0] || {});
    const divPrincipal = divs.find(d =>
      !['RESOLVIDA','PERSISTENTE','CANCELADA'].includes(String(d.status || '').toUpperCase())
    ) || divs[0] || {};

    // A primeira contagem nasce em dt_contagens/dt_divergencias. Ela precisa
    // aparecer mesmo antes de o Analista criar a segunda rodada.
    const contPrimeira = state().contagens
      .filter(c =>
        _chaveEndereco(c) === _chaveEndereco(principal) &&
        String(c.tipo_contagem || '').toUpperCase() !== 'RECONTAGEM' &&
        !c._excluida && !['ESTORNADA','EXCLUIDA'].includes(String(c.status || '').toUpperCase())
      )
      .sort((a,b) => String(a.criado_em || a.dataHora || '').localeCompare(String(b.criado_em || b.dataHora || '')))[0];

    const recsConcluidas = recs.filter(r => r.qtd_recontagem != null)
      .sort((a,b) => String(a.recontagem_concluida_em || a.concluida_em || a.criada_em || '')
        .localeCompare(String(b.recontagem_concluida_em || b.concluida_em || b.criada_em || '')));
    const recSegunda = recsConcluidas[0] || {};
    const recTerceira = recsConcluidas[1] || {};
    Object.assign(principal, {
      divergencia_id: divPrincipal.id || principal.divergencia_id,
      chave_fluxo: _chaveEndereco(divPrincipal.id ? divPrincipal : principal),
      inventario_id: divPrincipal.inventario_id || principal.inventario_id,
      inventario_nome: divPrincipal.inventario_nome || principal.inventario_nome,
      endereco: divPrincipal.endereco || principal.endereco,
      produto: divPrincipal.produto || principal.produto || contPrimeira?.gtin || contPrimeira?.codigo_produto || '',
      descricao: divPrincipal.descricao || divPrincipal.descricao_produto || principal.descricao || contPrimeira?.descricao_produto || '',
      qtd_esperada: divPrincipal.qtd_esperada ?? principal.qtd_esperada,
      qtd_primeira: divPrincipal.qtd_primeira ?? divPrincipal.qtd_contada ?? principal.qtd_primeira ??
        contPrimeira?.quantidade ?? contPrimeira?.qtd_caixas,
      produto_primeira: divPrincipal.produto_primeira || divPrincipal.produto_contado ||
        principal.produto_primeira || contPrimeira?.gtin || contPrimeira?.codigo_produto || '',
      operador_primeira: divPrincipal.operador_primeira || divPrincipal.operador ||
        principal.operador_primeira || contPrimeira?.operador || '',
      data_primeira: divPrincipal.data_primeira || divPrincipal.criada_em ||
        principal.data_primeira || contPrimeira?.criado_em || contPrimeira?.dataHora || '',
      qtd_segunda: recSegunda.qtd_segunda ?? recSegunda.qtd_recontagem ?? divPrincipal.qtd_segunda ?? principal.qtd_segunda,
      produto_segunda: recSegunda.produto_segunda || recSegunda.produto_recontagem || divPrincipal.produto_segunda || principal.produto_segunda || '',
      operador_segunda: recSegunda.operador_segunda || recSegunda.operador_recontagem || divPrincipal.operador_segunda || principal.operador_segunda || '',
      data_segunda: recSegunda.data_segunda || recSegunda.recontagem_concluida_em || divPrincipal.data_segunda || principal.data_segunda || '',
      qtd_terceira: recTerceira.qtd_terceira ?? recTerceira.qtd_recontagem ?? divPrincipal.qtd_terceira ?? principal.qtd_terceira,
      produto_terceira: recTerceira.produto_terceira || recTerceira.produto_recontagem || divPrincipal.produto_terceira || principal.produto_terceira || '',
      operador_terceira: recTerceira.operador_terceira || recTerceira.operador_recontagem || divPrincipal.operador_terceira || principal.operador_terceira || '',
      data_terceira: recTerceira.data_terceira || recTerceira.recontagem_concluida_em || divPrincipal.data_terceira || principal.data_terceira || '',
      status: divPrincipal.status || principal.status || 'ABERTA',
      status_recontagem: divPrincipal.status_recontagem || principal.status_recontagem || 'aguardando_analista',
      _somente_divergencia: recs.length === 0,
      _divergencias_agrupadas: divs.map(d => d.id),
      _recontagens_agrupadas: recs.map(r => r.id)
    });
    const totalEsperadoEndereco = _totalEsperadoEnderecoRec(principal);
    principal._qtd_esperada_endereco = totalEsperadoEndereco;
    _aplicarAvaliacaoConsolidadaRec(principal, totalEsperadoEndereco);
    return principal;
  });
  dados = dados.filter(r => {
    const status=String(r.status || '').toUpperCase();
    const statusRec=String(r.status_recontagem || '').toLowerCase();
    return !['RESOLVIDA','CANCELADA'].includes(status) &&
      !['sem_divergencia','resolvida','cancelada'].includes(statusRec);
  });
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
      return (r.operador || div?.operador_responsavel || '') === fOperador || (r.operador_recontagem || div?.operador_recontagem || '') === fOperador;
    });
  }

  if (busca) dados = dados.filter(r =>
    (r.endereco||'').toLowerCase().includes(busca) ||
    (r.produto||'').toLowerCase().includes(busca) ||
    (r.descricao||'').toLowerCase().includes(busca) ||
    (r.inventario_nome||'').toLowerCase().includes(busca) ||
    (r.operador||'').toLowerCase().includes(busca) ||
    (r.operador_recontagem||'').toLowerCase().includes(busca)
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

  _recDadosFiltradosExport = dados.slice();

  // Popular filtros dinâmicos
  const selRua = document.getElementById('rec-frua');
  if (selRua) {
    const ruas = [...new Set(state().recontagens.map(r => getEnderecoInfo(r.endereco)?.rua || '—'))].sort();
    selRua.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(r => `<option value="${r}" ${r===fRua?'selected':''}>${r}</option>`).join('');
  }
  const selOp = document.getElementById('rec-foperador');
  if (selOp) {
    const cur = selOp.value;
    const ops = [...new Set(state().recontagens.flatMap(r => {
      const div = state().divergencias.find(d => d.id === r.divergencia_id);
      return [r.operador || div?.operador_responsavel || '', r.operador_recontagem || div?.operador_recontagem || ''];
    }).filter(Boolean))].sort();
    selOp.innerHTML = '<option value="">Todos os operadores</option>' + ops.map(o => `<option value="${o}" ${o===cur?'selected':''}>${o}</option>`).join('');
    if (cur) selOp.value = cur;
  }

  // KPIs
  // Indicadores e tabela usam exatamente os mesmos casos consolidados por
  // endereço. Assim o menu não mostra 1 enquanto a tabela mostra 0, nem conta
  // três documentos técnicos como três atividades operacionais.
  const allRec = dados.slice();
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
        <th>Atribuído para</th><th>Executado por</th>
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
          const executadoPor = r.operador_recontagem || div?.operador_recontagem || '';

          // ── Células das 3 contagens — exibe produto E quantidade ──
          const _ndp = v => String(v || '').trim().toUpperCase();
          const prodEsp = _ndp(r.produto);
          const _cellCont = (qtd, op, data, prodContado) => {
            if (qtd === null || qtd === undefined) {
              return `<td style="color:var(--muted-2);font-size:.78rem;text-align:center">—</td>`;
            }
            const partes = Array.isArray(prodContado) ? prodContado : String(prodContado || r.produto || '').split(/[,;|]+/);
            const esperadoCanonico = _produtoCanonicoRec(r);
            const limpas = partes.map(v => String(v || '').trim()).filter(Boolean);
            const produtoExibido = limpas.find(v => _produtoCanonicoRec({produto:v}) === esperadoCanonico) || limpas[0] || r.produto || '—';
            const nome = _nomeProdutoRec(produtoExibido);
            return `<td><div style="font-weight:800" title="Codigo: ${escHTML(produtoExibido)}">${escHTML(nome)}</div><div style="font-family:var(--mono);font-size:.72rem;margin-top:2px">Qtd ${escHTML(qtd)}</div></td>`;
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
              ${executadoPor
                ? `<div style="font-weight:700;font-size:.82rem;color:var(--success)">${escHTML(executadoPor)}</div>
                   ${r.recontagem_concluida_em ? `<div style="font-size:.65rem;color:var(--muted)">${fmtTs(r.recontagem_concluida_em)}</div>` : ''}`
                : `<span style="font-size:.75rem;color:var(--muted-2)">—</span>`}
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
                  ? `<button class="btn btn-ghost btn-sm" onclick="${r._somente_divergencia
                      ? `divAtribuirRapido('${r.divergencia_id}')`
                      : `divAtribuirPorRec('${r.id}')`}" style="font-size:.72rem" title="Atribuir a um operador">👤 Atribuir</button>`
                  : ''}
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
}



function _exportarXlsxAnalista(nomeArquivo, nomeAba, linhas) {
  if (!window.XLSX) {
    showToast('Biblioteca Excel não carregada. Atualize a página e tente novamente.', 'e');
    return;
  }
  if (!linhas || !linhas.length) {
    showToast('Não há dados nos filtros atuais para exportar.', 'w');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, nomeAba.substring(0, 31));
  XLSX.writeFile(wb, nomeArquivo);
}

function exportarDivergencias() {
  renderDivergencias();
  const linhas = _divDadosFiltradosExport.map(d => {
    const info = getEnderecoInfo(d.endereco) || {};
    const rec = state().recontagens.find(r => r.divergencia_id === d.id) || {};
    return {
      'Inventário': d.inventario_nome || d.inventario_id || '',
      'Rua': info.rua || '',
      'Endereço': d.endereco || '',
      'Produto': d.produto || d.descricao || '',
      'GTIN bipado': d.gtin_bipado || '',
      'Tipo': d.tipo_divergencia || d.tipo || '',
      'Quantidade esperada': d.qtd_esperada ?? '',
      'Quantidade contada': d.qtd_contada ?? '',
      'Diferença': d.diferenca ?? '',
      'Status': d.status || '',
      'Status recontagem': d.status_recontagem || rec.status_recontagem || rec.status || '',
      'Operador da contagem': d.operador || '',
      'Atribuído para': d.operador_responsavel || rec.operador || '',
      'Executado por': rec.operador_recontagem || d.operador_recontagem || '',
      'Criada em': d.criada_em ? fmtTs(d.criada_em) : ''
    };
  });
  _exportarXlsxAnalista('divergencias-filtradas.xlsx', 'Divergências', linhas);
}

function exportarRecontagens() {
  renderRecontagens();
  const linhas = _recDadosFiltradosExport.map(r => {
    const info = getEnderecoInfo(r.endereco) || {};
    const div = state().divergencias.find(d => d.id === r.divergencia_id) || {};
    return {
      'Inventário': r.inventario_nome || r.inventario_id || '',
      'Rua': info.rua || '',
      'Endereço': r.endereco || '',
      'Produto': r.produto || r.descricao || '',
      'Quantidade esperada': r.qtd_esperada ?? '',
      '1ª contagem': r.qtd_primeira ?? '',
      'Operador 1ª': r.operador_primeira || '',
      '2ª contagem': r.qtd_segunda ?? '',
      'Operador 2ª': r.operador_segunda || '',
      '3ª contagem': r.qtd_terceira ?? '',
      'Operador 3ª': r.operador_terceira || '',
      'Status': r.status_recontagem || div.status_recontagem || r.status || '',
      'Atribuído para': r.operador || div.operador_responsavel || '',
      'Executado por': r.operador_recontagem || div.operador_recontagem || '',
      'Atribuída em': r.atribuido_em ? fmtTs(r.atribuido_em) : '',
      'Concluída em': r.recontagem_concluida_em ? fmtTs(r.recontagem_concluida_em) : (r.concluida_em ? fmtTs(r.concluida_em) : '')
    };
  });
  _exportarXlsxAnalista('recontagens-filtradas.xlsx', 'Recontagens', linhas);
}


// Exibe a composição do total esperado em formato de lista de paletes.
function abrirDetalhePaletesEsperados(divId) {
  const bruto = state().divergencias.find(item => String(item.id || '') === String(divId || ''));
  if (!bruto) return showToast('Não foi possível localizar essa divergência.', 'e');
  const invCanonico = _inventarioCanonicoRec(bruto);
  const endCanonico = _FK.endereco(bruto.endereco);
  const mesmoEndereco = obj =>
    _inventarioCanonicoRec(obj) === invCanonico && _FK.endereco(obj?.endereco) === endCanonico;
  const inventario = state().inventarios.find(i => _inventarioCanonicoRec(i) === invCanonico);
  let itens = (inventario?.base || []).filter(item => _FK.endereco(item?.endereco) === endCanonico);
  if (!itens.length && Array.isArray(bruto.itens_esperados)) itens = bruto.itens_esperados;
  if (!itens.length) itens = [{ produto: bruto.produto, descricao: bruto.descricao, quantidade_esperada: bruto.qtd_esperada }];

  const obterQtd = item => {
    const valor = item?.quantidade_esperada ?? item?.quantidadeEsperada ?? item?.qtd_esperada ?? item?.qtdEsperada ??
      item?.quantidade_enderecada ?? item?.qtd_enderecada ?? item?.saldo_estoque ?? item?.saldo ??
      item?.saldo_erp ?? item?.qtd_sistema ?? item?.qtd_estoque ?? item?.estoque_total ??
      item?.estoque ?? item?.quantidade ?? item?.qtd ?? item?.qtde;
    if (valor === null || valor === undefined || String(valor).trim() === '') return 0;
    const numero = Number(String(valor).replace(',', '.'));
    return Number.isFinite(numero) ? numero : 0;
  };
  const total = itens.reduce((soma, item) => soma + obterQtd(item), 0);
  const linhas = itens.map((item, indice) => {
    const codigo = item.codigo_produto || item.codigoProduto || item.codigo_interno || item.codigoInterno || item.gtin || item.ean || item.dun || item.produto || '—';
    const nome = item.descricao_produto || item.descricaoProduto || item.descricao || item.nomeProduto || _nomeProdutoRec(codigo) || '';
    const identificador = item.palete || item.pallet || item.numero_palete || item.numeroPalete || item.sscc || item.lote || `Palete ${indice + 1}`;
    const qtd = obterQtd(item);
    return `<div style="display:grid;grid-template-columns:minmax(90px,.7fr) minmax(170px,1.7fr) auto;gap:12px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--border)">
      <div><div style="font-size:.65rem;color:var(--muted)">PALETE</div><div class="mono" style="font-weight:800">${escHTML(identificador)}</div></div>
      <div><div class="mono" style="font-weight:800">${escHTML(codigo)}</div>${nome ? `<div style="font-size:.69rem;color:var(--muted);margin-top:2px">${escHTML(nome)}</div>` : ''}</div>
      <div style="text-align:right"><div style="font-size:.65rem;color:var(--muted)">QUANTIDADE</div><div class="mono" style="font-size:1rem;font-weight:900">${escHTML(qtd)}</div></div>
    </div>`;
  }).join('');

  const divsEndereco = (state().divergencias || []).filter(mesmoEndereco);
  const primeiraDiv = [...divsEndereco].sort((a,b) => String(a.criada_em || '').localeCompare(String(b.criada_em || '')))
    .find(x => x.qtd_contada != null || x.qtd_primeira != null) || bruto;
  const recs = (state().recontagens || []).filter(mesmoEndereco).filter(r =>
    r.qtd_recontagem != null || r.qtd_segunda != null || r.qtd_terceira != null
  ).sort((a,b) => String(a.recontagem_concluida_em || a.concluida_em || a.data_segunda || '')
    .localeCompare(String(b.recontagem_concluida_em || b.concluida_em || b.data_segunda || '')));
  const consolidada = recs.find(r => r.qtd_terceira != null || r.qtd_segunda != null) || {};
  const segundaRec = recs[0] || {};
  const terceiraRec = recs[1] || {};
  const rodadas = [
    { titulo:'1ª contagem', qtd: primeiraDiv.qtd_primeira ?? primeiraDiv.qtd_contada ?? primeiraDiv.quantidade, produto: primeiraDiv.produto_primeira || primeiraDiv.produto_contado || primeiraDiv.gtin_bipado || primeiraDiv.produto || primeiraDiv.codigo_produto },
    { titulo:'2ª contagem', qtd: consolidada.qtd_segunda ?? segundaRec.qtd_segunda ?? segundaRec.qtd_recontagem, produto: consolidada.produto_segunda || segundaRec.produto_segunda || segundaRec.produto_recontagem || segundaRec.produto },
    { titulo:'3ª contagem', qtd: consolidada.qtd_terceira ?? terceiraRec.qtd_terceira ?? terceiraRec.qtd_recontagem, produto: consolidada.produto_terceira || terceiraRec.produto_terceira || terceiraRec.produto_recontagem || terceiraRec.produto }
  ];
  const numero = v => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const historicoModal = {
    qtd_primeira: numero(rodadas[0].qtd),
    qtd_segunda: numero(rodadas[1].qtd),
    qtd_terceira: numero(rodadas[2].qtd),
    qtd_esperada: total,
    comparacao_somente_quantidade: true,
    fluxo_consolidado_endereco: true
  };
  const avaliacaoModal = _avaliarTotalConsolidadoRec(historicoModal, total);
  const rodadaAceita = avaliacaoModal?.estado === 'RESOLVIDA' ? Number(avaliacaoModal.rodada || 0) : 0;
  const referencia = String(avaliacaoModal?.referencia || '');
  const rodadasConsenso = new Set();
  if (referencia.includes('PRIMEIRA')) rodadasConsenso.add(1);
  if (referencia.includes('SEGUNDA')) rodadasConsenso.add(2);
  if (referencia.includes('TERCEIRA')) rodadasConsenso.add(3);
  if (rodadaAceita) rodadasConsenso.add(rodadaAceita);

  const comparacoes = rodadas.map((r, idx) => {
    const numeroRodada = idx + 1;
    const qtd = numero(r.qtd);
    const bateuSistema = qtd !== null && qtd === total;
    const aceitaPorFluxo = avaliacaoModal?.estado === 'RESOLVIDA' && rodadasConsenso.has(numeroRodada);
    const ok = bateuSistema || aceitaPorFluxo;
    const codigo = String(r.produto || '').split(/[,;|]+/).map(x => x.trim()).filter(Boolean)[0] || '';
    const nome = codigo ? _nomeProdutoRec(codigo) : 'Sem contagem';
    const badge = qtd === null
      ? '<span class="badge b-gray">Sem registro</span>'
      : ok
        ? `<span class="badge b-green">✅ ${bateuSistema ? 'Bateu total' : 'Consenso'}</span>`
        : '<span class="badge b-red">Divergente</span>';
    return `<div style="border:1px solid ${ok ? 'rgba(34,197,94,.45)' : 'var(--border)'};background:${ok ? 'rgba(34,197,94,.11)' : 'var(--surface)'};border-radius:12px;padding:12px;min-width:0;box-shadow:${ok ? 'inset 0 0 0 1px rgba(34,197,94,.12)' : 'none'}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>${r.titulo}</strong>${badge}</div>
      <div style="font-size:.72rem;color:var(--muted);margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHTML(nome)}">${escHTML(nome)}</div>
      <div class="mono" style="font-size:1.05rem;font-weight:950;margin-top:4px;color:${ok ? 'var(--success)' : 'inherit'}">${qtd === null ? '—' : `Qtd ${escHTML(qtd)}`}</div>
      <div style="font-size:.66rem;color:var(--muted);margin-top:3px">Esperado consolidado: ${escHTML(total)}</div>
    </div>`;
  }).join('');


  document.getElementById('modal-paletes-esperados-bg')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="modal-paletes-esperados-bg" class="modal-bg open" style="display:flex;z-index:99999" onclick="if(event.target===this) fecharDetalhePaletesEsperados()">
    <div class="modal" style="max-width:820px;width:min(820px,94vw);padding:0;overflow:hidden">
      <div class="modal-hdr" style="padding:18px 20px">
        <div><div class="modal-title">📦 Esperado e comparação das contagens</div><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Endereço ${escHTML(bruto.endereco || '—')} · ${itens.length} ${itens.length === 1 ? 'palete' : 'paletes'}</div></div>
        <button class="modal-close" onclick="fecharDetalhePaletesEsperados()">✕</button>
      </div>
      <div style="max-height:42vh;overflow:auto;border-top:1px solid var(--border);border-bottom:1px solid var(--border)">${linhas}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:rgba(59,130,246,.07)">
        <div><div style="font-size:.68rem;color:var(--muted)">TOTAL CONSOLIDADO DO ENDEREÇO</div><div style="font-size:.72rem;color:var(--muted)">Soma de todos os paletes listados acima</div></div>
        <div class="mono" style="font-size:1.35rem;font-weight:950">${escHTML(total)}</div>
      </div>
      <div style="padding:16px 20px"><div style="font-weight:850;margin-bottom:10px">Comparação das contagens</div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${comparacoes}</div></div>
      <div class="modal-actions" style="padding:14px 20px"><button class="btn btn-primary" onclick="fecharDetalhePaletesEsperados()">Fechar</button></div>
    </div>
  </div>`);
}
function fecharDetalhePaletesEsperados() {
  document.getElementById('modal-paletes-esperados-bg')?.remove();
}
