function state(){ return window.AnalistaStore.getState(); }
//  5. LÓGICA DE NEGÓCIO — INVENTÁRIOS
// ───────────────────────────────────────────────────────────────────

function gerarId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
}

/**
 * Verifica se uma contagem é um registro de endereço vazio.
 * Aceita os dois formatos:
 *   - coletor novo:  tipo_contagem === 'VAZIO'
 *   - analista/legado: tipo === 'VAZIO_CONFIRMADO'
 */
function _isVazio(c) {
  // Verifica pelo campo original do coletor OU pelo campo normalizado (_normalizarContagem)
  return c.tipo_contagem === 'VAZIO' || c.tipo === 'VAZIO_CONFIRMADO';
}

/**
 * Normaliza um registro de contagem vindo do Firebase para o formato
 * interno do analista. Garante que vazios do coletor (tipo_contagem:'VAZIO')
 * sejam tratados como VAZIO_CONFIRMADO em toda a lógica do analista.
 */
function _normalizarContagem(c) {
  const norm = { ...c };

  // Mapear dataHora → timestamp quando timestamp ausente
  // O coletor grava dataHora (ISO string ou Date); o analista usa timestamp.
  if (!norm.timestamp && norm.dataHora) {
    const dh = norm.dataHora;
    if (dh && typeof dh.toDate === 'function') {
      norm.timestamp = dh.toDate().toISOString();
    } else if (dh instanceof Date) {
      norm.timestamp = dh.toISOString();
    } else if (typeof dh === 'string') {
      norm.timestamp = dh;
    }
  }
  // Fallback: usar criado_em se ambos ausentes
  if (!norm.timestamp && norm.criado_em) {
    norm.timestamp = norm.criado_em;
  }

  if (norm.tipo_contagem === 'VAZIO') {
    norm.tipo = 'VAZIO_CONFIRMADO';
  }

  return norm;
}

function getInventariosAtivos() {
  return state().inventarios.filter(i => i.status === 'ATIVO');
}

function getInventarioPorId(id) {
  return state().inventarios.find(i => i.id === id) || null;
}

/** Abre modal para criar novo inventário */
function abrirNovoInventario() {
  ['inv-codigo','inv-nome','inv-resp','inv-setor','inv-loja-principal','inv-lojas-espelho'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('inv-data').value = new Date().toISOString().slice(0,10);
  const elCapaInicio = document.getElementById('inv-capa-inicio');
  const elCapaLote = document.getElementById('inv-capa-lote');
  if (elCapaInicio) elCapaInicio.value = '1';
  if (elCapaLote) elCapaLote.value = '200';
  document.getElementById('inv-import-fb').innerHTML = '';
  document.getElementById('inv-end-sel-wrap').style.display = 'none';
  window.AnalistaState.batch([
    window.AnalistaActions.setPath('ui.inventarioImportCtx', null, { source: 'abrirModalInventario' }),
    window.AnalistaActions.setPath('ui.selecionadosSetores', new Set(), { source: 'abrirModalInventario' })
  ]);
  // Resetar file input — sem isso, selecionar o mesmo arquivo não dispara onchange
  const fi = document.getElementById('file-inv');
  if (fi) fi.value = '';
  habilitarBtnCriar();
  openModal('modal-inv');
}

function habilitarBtnCriar() {
  const nome = document.getElementById('inv-nome')?.value.trim();
  const ok = nome && state().ui.inventarioImportCtx && state().ui.inventarioImportCtx.base.length > 0;
  const btn = document.getElementById('btn-criar-inv');
  if (btn) { btn.disabled = !ok; }
}

function criarInventario() {
  const nome = document.getElementById('inv-nome').value.trim();
  if (!nome)              { showToast('Informe o nome do inventário', 'e'); return; }
  if (!state().ui.inventarioImportCtx || !state().ui.inventarioImportCtx.base.length) {
    showToast('Importe a base de dados primeiro', 'e'); return;
  }

  // Montar lista de endereços selecionados
  // Prioridade: seleção manual > endereços únicos da base
  let endsSelecionados = [];
  if (state().ui.selecionadosSetores.size > 0) {
    state().ui.selecionadosSetores.forEach(s => {
      if (state().enderecosPorSetor[s]) endsSelecionados.push(...state().enderecosPorSetor[s]);
    });
  } else {
    // Usar endereços únicos da base importada
    const endsUnicos = [...new Set(state().ui.inventarioImportCtx.base.map(r => r.endereco).filter(Boolean))];
    endsSelecionados = endsUnicos.map(e => ({ endereco: e }));
  }

  // ── VALIDAÇÃO v6: remover endereços inativos da seleção ──────────────
  // Endereços inativos (ativo=false) não participam do inventário operacional.
  // Eles permanecem no cadastro (ENDDB) para consulta, mas são excluídos da contagem.
  const endsSelecionadosAtivos = endsSelecionados.filter(e => {
    const info = getEnderecoInfo(e.endereco || e);
    return !info || info.ativo !== false; // sem cadastro → tratado como ativo (legado)
  });
  const qtdInativos = endsSelecionados.length - endsSelecionadosAtivos.length;
  endsSelecionados = endsSelecionadosAtivos;
  // ─────────────────────────────────────────────────────────────────────

  const codigo = document.getElementById('inv-codigo').value.trim() || ('INV-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String(state().inventarios.length + 1).padStart(3,'0'));
  const lojaPrincipal = document.getElementById('inv-loja-principal').value.trim();
  const lojasEspelho = (document.getElementById('inv-lojas-espelho').value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i && v !== lojaPrincipal);
  const capaInicioBase = Math.max(1, parseInt(document.getElementById('inv-capa-inicio').value || '1') || 1);
  const capaLotePorOperador = Math.max(1, parseInt(document.getElementById('inv-capa-lote').value || '200') || 200);

  const inv = {
    id:                   gerarId('INV'),
    codigo,
    nome,
    data_inicio:          document.getElementById('inv-data').value || new Date().toISOString().slice(0,10),
    responsavel:          document.getElementById('inv-resp').value.trim(),
    setor:                document.getElementById('inv-setor').value.trim(),
    loja_principal:       lojaPrincipal,
    lojas_espelho:        lojasEspelho,
    capa_inicio_base:     capaInicioBase,
    capa_lote_por_operador: capaLotePorOperador,
    capa_ranges:          [],
    status:               'ATIVO',
    base:                 [...state().ui.inventarioImportCtx.base],
    total_registros:      state().ui.inventarioImportCtx.base.length,
    arquivo:              state().ui.inventarioImportCtx.arquivo,
    enderecos_selecionados: endsSelecionados,
    total_enderecos:      endsSelecionados.length,
    locais_selecionados:  [...state().ui.selecionadosSetores],
    // Rastreabilidade de criação
    criado_em:            new Date().toISOString(),
    criado_por:           _currentAnalistaUser?.email || 'analista',
    criado_por_nome:      _currentAnalistaUser?.displayName || _currentAnalistaUser?.email?.split('@')[0] || 'Analista',
    fechado_em:           null,
    fechado_por:          null,
    fechado_por_nome:     null,
    snapshot_fechamento:  null,
  };

  window.AnalistaState.replaceSlice('inventarios', [inv, ...(state().inventarios || [])], { source: 'criarInventario' });
  saveAll();
  closeModal('modal-inv');
  renderInvTable();
  renderDashboard();
  atualizarBadgesNav();
  popularSelects();
  logSistema('INVENTARIO', `Inventário ${inv.codigo} criado por ${inv.criado_por_nome}`, {
    id:                inv.id,
    nome:              inv.nome,
    codigo:            inv.codigo,
    criado_por:        inv.criado_por,
    criado_por_nome:   inv.criado_por_nome,
    total_registros:   inv.total_registros,
    total_enderecos:   inv.total_enderecos,
    inativos_excluidos: qtdInativos,
  });
  logSistema('IMPORTACAO', `Base importada: ${inv.arquivo || 'arquivo'} — ${inv.total_registros} registros`, {
    inventario_id: inv.id,
    arquivo:       inv.arquivo,
    total:         inv.total_registros,
  });
  const msgInativos = qtdInativos > 0 ? ` (${qtdInativos} endereço(s) inativo(s) excluído(s))` : '';
  showToast(`✅ Inventário "${inv.nome}" criado! Publicando no Firebase...`, 's');

  // Publicar no Firestore para o coletor enxergar
  fsPublicarInventario(inv).then(() => {
    showToast(`✅ Inventário "${inv.nome}" publicado! Operadores já podem acessá-lo.`, 's');
  });
  // Publicar base de endereços para o coletor validar endereços
  fsPublicarEnderecos();

  // Publicar base de produtos extraída da base do inventário
  // Garante que coletores identifiquem GTINs mesmo de endereços de outros inventários
  if (inv.base && inv.base.length) {
    // Deduplicar por codigo_produto para não enviar duplicatas
    const prodMap = {};
    inv.base.forEach(r => {
      const cod = String(r.codigo_produto || r.gtin || '').trim();
      if (cod && !prodMap[cod]) prodMap[cod] = r;
    });
    const produtosUnicos = Object.values(prodMap);
    if (produtosUnicos.length) {
      fsPublicarProdutos(produtosUnicos).catch(e =>
        console.warn('[FS] Falha ao publicar produtos:', e.message)
      );
    }
  }

  document.getElementById('btn-inv-ativo').style.display = 'inline-flex';
  document.getElementById('inv-ativo-nome').textContent = inv.codigo;

  window.AnalistaFirebaseService?.start?.();

  goPage('inventarios', document.getElementById('nav-inventarios'));
}

function abrirFecharInventario(id) {
  const inv = getInventarioPorId(id);
  if (!inv) return;
  window.AnalistaState.set('ui.inventarioFecharId', id, { source: 'prepararFechamentoInventario' });

  // Calcular pendências e divergências
  // v6: excluir endereços inativos e com limite atingido da contagem de pendências
  const contsAtivas = state().contagens.filter(c => c.inventario_id === id && !c._excluida);
  const endsContados = new Set(contsAtivas.filter(c => !_isVazio(c)).map(c => c.endereco));
  const endsVaziosConf = new Set(contsAtivas.filter(c => _isVazio(c) && c.status !== 'ESTORNADA').map(c => c.endereco));
  const endsConferidos = new Set([...endsContados, ...endsVaziosConf]);

  // Usar state().enderecosLista como base oficial
  let pendentes = [], inativos = [], limiteAtingido = [];
  state().enderecosLista.forEach(e => {
    const cod = e.endereco;
    if (e.ativo === false) { inativos.push(cod); return; }
    const cap = e.capacidade_paletes ?? null;
    if (cap !== null && cap > 0) {
      const usados = getPaletesUsados(id, cod);
      if (usados >= cap) { limiteAtingido.push(cod); return; }
    }
    if (!endsConferidos.has(cod)) pendentes.push(cod);
  });

  const divsAbertas = state().divergencias.filter(d => d.inventario_id === id && d.status === 'ABERTA');
  const recPend = state().recontagens.filter(r => r.inventario_id === id && r.status === 'PENDENTE');

  // Verificar coletores vinculados a este inventário que não encerraram o turno
  // REGRA: qualquer coletor que participou deste inventário e não encerrou o turno bloqueia o fechamento
  const coletoresPendentes = state().coletores.filter(c => 
    (c.sessao?.inventario_id === id || c.ultimo_inventario_id === id) && 
    !c.turno_encerrado
  );

  let alertas = '';
  let bloqueioCritico = false;

  if (pendentes.length > 0) {
    alertas += `<div class="alert warn" style="margin-bottom:10px">⚠️ <strong>${pendentes.length} endereço(s)</strong> ainda não foram contados!</div>`;
  }
  if (divsAbertas.length > 0) {
    alertas += `<div class="alert danger" style="margin-bottom:10px">🚫 <strong>${divsAbertas.length} divergência(s)</strong> abertas! Resolva todas antes de fechar.</div>`;
    bloqueioCritico = true;
  }
  if (recPend.length > 0) {
    alertas += `<div class="alert danger" style="margin-bottom:10px">🚫 <strong>${recPend.length} recontagem(ns)</strong> pendentes! Finalize as rodadas antes de fechar.</div>`;
    bloqueioCritico = true;
  }
  if (coletoresPendentes.length > 0) {
    alertas += `<div class="alert danger" style="margin-bottom:10px">🚫 <strong>${coletoresPendentes.length} coletor(es)</strong> ainda não encerraram o turno! Todos os coletores devem encerrar o turno antes de fechar o inventário.</div>`;
    bloqueioCritico = true;
  }

  if (!alertas) {
    alertas = `<div class="alert success">✅ Tudo conferido! Inventário pode ser fechado com segurança.</div>`;
  }

  // Desabilitar botão de fechamento se houver bloqueio crítico
  const btnFechar = document.getElementById('btn-confirmar-fechar');
  if (btnFechar) {
    btnFechar.disabled = bloqueioCritico;
    btnFechar.style.opacity = bloqueioCritico ? '0.5' : '1';
    btnFechar.title = bloqueioCritico ? 'Resolva as pendências críticas para habilitar o fechamento' : '';
  }

  document.getElementById('fechar-inv-alertas').innerHTML = alertas;
  document.getElementById('fechar-inv-resumo').innerHTML = `
    <div style="background:#f8fafc;border-radius:8px;padding:14px;font-size:.83rem;margin-top:8px">
      <div style="font-weight:700;margin-bottom:8px">Resumo — ${escHTML(inv.nome)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div>📍 Endereços: <strong>${inv.total_enderecos || 0}</strong></div>
        <div>✅ Contados: <strong>${endsContados.size}</strong></div>
        ${endsVaziosConf.size > 0 ? `<div>🔲 Vazios conf.: <strong>${endsVaziosConf.size}</strong></div>` : ''}
        <div>⏳ Pendentes: <strong>${pendentes.length}</strong></div>
        <div>⚠️ Em Conflito: <strong>${divsAbertas.length}</strong></div>
        ${inativos.length   > 0 ? `<div>🚫 Inativos: <strong>${inativos.length}</strong></div>` : ''}
        ${limiteAtingido.length > 0 ? `<div>🔒 Limite: <strong>${limiteAtingido.length}</strong></div>` : ''}
      </div>
    </div>`;

  openModal('modal-fechar-inv');
}

function confirmarFecharInventario() {
  const inv = getInventarioPorId(state().ui.inventarioFecharId);
  if (!inv) return;

  const agora         = new Date().toISOString();
  const emailAnalista = _currentAnalistaUser?.email || 'analista';
  const nomeAnalista  = _currentAnalistaUser?.displayName || emailAnalista;

  inv.status           = 'FECHADO';
  inv.fechado_em       = agora;
  inv.fechado_por      = emailAnalista;
  inv.fechado_por_nome = nomeAnalista;

  // Ao fechar o inventário, resetamos o status de turno dos coletores para o próximo
  state().coletores.forEach(c => {
    if (c.sessao?.inventario_id === inv.id || c.ultimo_inventario_id === inv.id) {
      c.turno_encerrado = false;
      FS_AN.collection(FS_COL_COLETORES).doc(c.id).update({ turno_encerrado: false }).catch(() => {});
    }
  });

  // Snapshot de fechamento para auditoria completa
  const contsInv    = state().contagens.filter(c => c.inventario_id === inv.id);
  const contsAtivas = contsInv.filter(c => !c._excluida && c.status !== 'ESTORNADA');
  const divsInv     = state().divergencias.filter(d => d.inventario_id === inv.id);
  const recsInv     = state().recontagens.filter(r => r.inventario_id === inv.id);

  inv.snapshot_fechamento = {
    total_contagens:              contsAtivas.length,
    total_contagens_estornadas:   contsInv.filter(c => c.status === 'ESTORNADA').length,
    total_divergencias:           divsInv.length,
    divergencias_abertas:         divsInv.filter(d => d.status === 'ABERTA').length,
    divergencias_resolvidas:      divsInv.filter(d => d.status === 'RESOLVIDA').length,
    total_recontagens:            recsInv.length,
    recontagens_concluidas:       recsInv.filter(r => r.status === 'CONCLUIDA').length,
    recontagens_pendentes:        recsInv.filter(r => r.status === 'PENDENTE').length,
    total_vazios:                 contsAtivas.filter(c => _isVazio(c)).length,
    operadores_envolvidos:        [...new Set(contsAtivas.map(c => c.operador).filter(Boolean))],
    gerado_em:                    agora,
  };

  saveAll();
  closeModal('modal-fechar-inv');
  renderInvTable();
  renderDashboard();
  atualizarBadgesNav();

  logSistema('FECHAMENTO', `Inventário ${inv.codigo} fechado por ${nomeAnalista}`, {
    id:               inv.id,
    nome:             inv.nome,
    codigo:           inv.codigo,
    fechado_em:       agora,
    fechado_por:      emailAnalista,
    fechado_por_nome: nomeAnalista,
    snapshot:         inv.snapshot_fechamento,
  });

  showToast(`🔒 Inventário "${inv.codigo}" encerrado! Novas contagens bloqueadas.`, 'w');
  // Atualizar status + snapshot no Firestore
  fsAtualizarStatusInventario(inv);
  // Salvar ranking final do inventário encerrado
  setTimeout(() => fsSalvarRankingOperadores(), 1000);
}

function pausarInventario(id) {
  const inv = getInventarioPorId(id);
  if (!inv) return;
  inv.status = inv.status === 'PAUSADO' ? 'ATIVO' : 'PAUSADO';
  saveAll();
  renderInvTable();
  logSistema('INVENTARIO', `Inventário ${inv.codigo} ${inv.status === 'ATIVO' ? 'reativado' : 'pausado'}`, { id });
  showToast(inv.status === 'ATIVO' ? '▶️ Inventário reativado' : '⏸ Inventário pausado', 'w');
  // Sincronizar status no Firestore
  fsAtualizarStatusInventario(inv);
  window.AnalistaFirebaseService?.start?.();
}

async function toggleInvVisibilidade(id) {
  const inv = getInventarioPorId(id);
  if (!inv) return;
  inv.oculto_coletor = !inv.oculto_coletor;
  saveAll();
  renderInvTable();
  try {
    await FS_AN.collection(FS_COL).doc(id).update({ oculto_coletor: inv.oculto_coletor });
  } catch(e) { console.warn('[Visibilidade]', e.message); }
  showToast(inv.oculto_coletor ? '🙈 Inventário ocultado nos coletores' : '👁 Inventário visível nos coletores', inv.oculto_coletor ? 'w' : 's');
  logSistema('INVENTARIO', `Inventário ${inv.codigo} ${inv.oculto_coletor ? 'ocultado' : 'mostrado'} no coletor`, { id });
}

function verBase(id) {
  const inv = getInventarioPorId(id);
  if (!inv || !inv.base?.length) { showToast('Base vazia ou não encontrada', 'w'); return; }
  document.getElementById('modal-base-title').textContent = `📂 Base da Auditoria — ${inv.nome}`;
  const cols = ['endereco','codigo_produto','descricao_produto','quantidade_esperada','setor','pallete_ou_capa'];
  document.getElementById('modal-base-content').innerHTML = `
    <div style="font-size:.78rem;color:var(--muted);margin-bottom:10px">${inv.base.length.toLocaleString('pt-BR')} registros · ${inv.arquivo || 'Importado'}</div>
    <div class="preview-wrap" style="max-height:360px">
      <table class="preview-table">
        <thead><tr>${cols.map(c => `<th>${c.replace(/_/g,' ')}</th>`).join('')}</tr></thead>
        <tbody>${inv.base.slice(0,200).map(r => `<tr>${cols.map(c => `<td>${r[c]||'—'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
    ${inv.base.length > 200 ? `<div style="text-align:center;padding:10px;font-size:.75rem;color:var(--muted)">Exibindo primeiros 200 de ${inv.base.length.toLocaleString('pt-BR')} registros</div>` : ''}`;
  window._baseExportInvId = id;
  openModal('modal-base');
}

function exportarBaseAtual() {
  const id = window._baseExportInvId;
  const inv = getInventarioPorId(id);
  if (!inv || !inv.base?.length) return;
  exportCSVData(inv.base, `base_${inv.codigo}.csv`);
}


// Exportações globais necessárias para módulos carregados separadamente.
window.getInventariosAtivos = getInventariosAtivos;
window.getInventarioPorId = getInventarioPorId;
window.abrirNovoInventario = abrirNovoInventario;
window.criarInventario = criarInventario;

console.info("[MÓDULO] inventários v6 carregado");
