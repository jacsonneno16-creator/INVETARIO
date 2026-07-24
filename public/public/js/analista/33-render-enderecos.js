function state(){ return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  18. RENDERIZAÇÃO — ENDEREÇOS
// ───────────────────────────────────────────────────────────────────

function atualizarEnderecos(renderToo = true) {
  const setores  = Object.keys(state().enderecosPorSetor);
  const ativos   = state().enderecosLista.filter(e => e.ativo).length;
  const inativos = state().enderecosLista.filter(e => !e.ativo).length;
  const capZero  = state().enderecosLista.filter(e => e.capacidade_paletes === 0).length;

  // Calcular endereços com limite atingido no inventário ativo atual
  const invAtivo = getInventariosAtivos()[0] || null;
  let bloqueados = 0;
  if (invAtivo) {
    state().enderecosLista.filter(e => e.ativo && e.capacidade_paletes !== null && e.capacidade_paletes > 0).forEach(e => {
      const usados = getPaletesUsados(invAtivo.id, e.endereco);
      if (usados >= e.capacidade_paletes) bloqueados++;
    });
  }

  document.getElementById('ek-total').textContent    = state().enderecosLista.length.toLocaleString('pt-BR');
  document.getElementById('ek-locais').textContent   = setores.length;
  document.getElementById('ek-ativos').textContent   = ativos.toLocaleString('pt-BR');
  document.getElementById('ek-inativos').textContent = inativos.toLocaleString('pt-BR');
  document.getElementById('ek-bloqueados').textContent = bloqueados.toLocaleString('pt-BR');
  document.getElementById('ek-bloqueados-sub').textContent = invAtivo ? `Em: ${invAtivo.codigo}` : 'Nenhum inv. ativo';
  document.getElementById('ek-cap-zero').textContent = capZero.toLocaleString('pt-BR');
  document.getElementById('nb-enderecos').textContent = state().enderecosLista.length;

  // Badge capas duplicadas
  const _capaDupCount = _agruparCapasDuplicadas('').length;
  const _badgeCap = document.getElementById('nb-capas-dup');
  if (_badgeCap) {
    _badgeCap.textContent    = _capaDupCount;
    _badgeCap.style.display  = _capaDupCount > 0 ? '' : 'none';
  }

  const fLocal = document.getElementById('end-flocal');
  if (fLocal) {
    const cur = fLocal.value;
    fLocal.innerHTML = '<option value="">Todos os Locais de Estoque</option>' +
      setores.sort().map(s => `<option value="${s}" ${s === cur ? 'selected' : ''}>${s} (${state().enderecosPorSetor[s].length})</option>`).join('');
  }
  if (renderToo) renderEnderecos();
}

function renderEnderecos() {
  const busca   = (document.getElementById('end-busca')?.value || '').toLowerCase();
  const fLocal  = document.getElementById('end-flocal')?.value || '';
  const fStatus = document.getElementById('end-fstatus')?.value || '';
  const fLoja   = document.getElementById('end-floja')?.value || '';

  // Popular select de lojas se ainda não foi
  _popularEndLojaSelect();

  const invAtivo = getInventariosAtivos()[0] || null;

  let lista = state().enderecosLista.map(e => {
    const usados = invAtivo ? getPaletesUsados(invAtivo.id, e.endereco) : 0;
    const limiteTingido = e.ativo && e.capacidade_paletes !== null && e.capacidade_paletes > 0 && usados >= e.capacidade_paletes;
    return { ...e, _usados: usados, _limiteTingido: limiteTingido };
  });

  if (fLoja === '__sem_loja__') lista = lista.filter(e => !e.loja || e.loja === '');
  else if (fLoja)               lista = lista.filter(e => e.loja === fLoja);
  if (fLocal)              lista = lista.filter(e => (e.setor || e.nome_local || e.local) === fLocal);
  if (fStatus === 'ativo')     lista = lista.filter(e => e.ativo && !e._limiteTingido);
  if (fStatus === 'inativo')   lista = lista.filter(e => !e.ativo);
  if (fStatus === 'cap_zero')  lista = lista.filter(e => e.capacidade_paletes === 0);
  if (fStatus === 'bloqueado') lista = lista.filter(e => e._limiteTingido);
  if (busca) lista = lista.filter(e =>
    e.endereco.toLowerCase().includes(busca) ||
    (e.nome_local||'').toLowerCase().includes(busca) ||
    (e.setor||'').toLowerCase().includes(busca) ||
    (e.local||'').toLowerCase().includes(busca) ||
    (e.rua||'').toLowerCase().includes(busca)
  );

  if (!lista.length) {
    document.getElementById('end-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">📍</div><div class="empty-title">Nenhum endereço encontrado</div><div class="empty-sub">Ajuste os filtros ou importe uma planilha de endereços</div></div>`;
    return;
  }

  function endStatusBadge(e) {
    if (!e.ativo && e.capacidade_paletes === 0) return `<span class="badge b-gray">⛔ Cap.Zero</span>`;
    if (!e.ativo)       return `<span class="badge b-gray">⛔ Inativo</span>`;
    if (e._limiteTingido) return `<span class="badge b-blocked">🔒 Limite</span>`;
    return `<span class="badge b-green">✅ Ativo</span>`;
  }

  function capCell(e) {
    const capStr = e.capacidade_paletes !== null ? String(e.capacidade_paletes) : '∞';
    const usadosStr = invAtivo ? String(e._usados) : '0';
    const cor = e._limiteTingido ? 'var(--danger)' : (e.capacidade_paletes === 0 ? 'var(--muted)' : 'var(--text)');
    return `<div style="display:flex;align-items:center;gap:6px">
      <span class="mono" style="font-weight:700;color:${cor}">${usadosStr}/${capStr}</span>
      <button onclick="editarCapacidade('${e.endereco.replace(/'/g,"\\'")}')" class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:.65rem" title="Editar capacidade">✏</button>
    </div>`;
  }

  // Decompose address into labeled parts for display
  const PLABELS = ['Loja','Local','Área','Rua','Col','Nív','Seq'];
  const PCOLORS = ['#dbeafe','#dcfce7','#fef9c3','#fce7f3','#ede9fe','#ffedd5','#e0f2fe'];
  const PTXT    = ['#1d4ed8','#16a34a','#a16207','#be185d','#6d28d9','#c2410c','#0369a1'];

  function partsHtml(endereco) {
    const parsed = window.DTEnderecos?.partes(endereco) || {};
    const parts = [parsed.loja, parsed.local, parsed.area, parsed.rua, parsed.coluna, parsed.nivel, parsed.sequencia];
    return parts.map((parte, i) => parte ?
      `<span style="display:inline-flex;flex-direction:column;align-items:center;background:${PCOLORS[i]||'#f1f5f9'};border-radius:5px;padding:1px 5px;min-width:28px;margin-right:2px">
        <span style="font-size:.5rem;font-weight:700;text-transform:uppercase;color:${PTXT[i]||'#64748b'}">${PLABELS[i]||'P'+(i+1)}</span>
        <span style="font-family:var(--mono);font-size:.71rem;font-weight:700;color:${PTXT[i]||'#1e293b'}">${escHTML(parte)}</span>
      </span>` : ''
    ).join('');
  }

  function lojaTagHtml(e) {
    if (!e.loja) return `<span style="font-size:.68rem;color:var(--muted-2,#94a3b8);font-style:italic">Sem loja</span>`;
    return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);font-size:.68rem;font-weight:700;color:#92400e;font-family:var(--mono)">${escHTML(e.loja)}</span>`;
  }

  function rowHtml(e) {
    const safe = e.endereco.replace(/'/g,"\\'");
    return `<tr class="${!e.ativo ? 'end-inativo' : ''}">
      <td class="mono" style="font-size:.77rem;white-space:nowrap">${e.endereco}</td>
      <td><div style="display:flex;flex-wrap:wrap;gap:2px">${partsHtml(e.endereco)}</div></td>
      <td><span class="badge b-gray" style="font-size:.65rem">${e.tipo || 'ARM.'}</span></td>
      <td>${lojaTagHtml(e)}</td>
      <td>${capCell(e)}</td>
      <td>${endStatusBadge(e)}</td>
      <td style="white-space:nowrap">
        <div style="display:flex;gap:3px">
          <button onclick="endVincularLoja('${safe}')"
            class="btn btn-ghost btn-sm"
            style="font-size:.7rem;padding:3px 7px" title="Vincular a uma loja">🏪</button>
          <button onclick="toggleAtivacaoEndereco('${safe}')"
            class="btn ${e.ativo ? 'btn-ghost' : 'btn-success'} btn-sm"
            style="font-size:.7rem">
            ${e.ativo ? '⛔ Desativar' : '✅ Ativar'}
          </button>
          <button onclick="excluirEndereco('${safe}')"
            class="btn btn-danger btn-sm" style="font-size:.7rem" title="Excluir endereço">🗑</button>
        </div>
      </td>
    </tr>`;
  }

  // ── Agrupar por LOCAL (parte 1 do endereço ou campo local/setor) ──────────
  // Se há busca ativa ou filtros, mostrar tabela plana (sem accordion)
  const usarGrupos = !busca && !fStatus;

  if (!usarGrupos) {
    // Modo plano — sem agrupamento
    document.getElementById('end-table-wrap').innerHTML = `
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Endereço</th><th>Estrutura</th><th>Tipo</th><th>Loja</th><th>Paletes usados/cap</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${lista.slice(0,1000).map(rowHtml).join('')}</tbody>
        </table>
      </div>
      ${lista.length > 1000 ? `<div style="text-align:center;padding:8px;font-size:.73rem;color:var(--muted)">Exibindo 1.000 de ${lista.length.toLocaleString('pt-BR')} endereços — use os filtros para refinar</div>` : ''}`;
    return;
  }

  // Modo agrupado por Local de Estoque
  const grupos = {};
  lista.forEach(e => {
    const grpKey = e.setor || e.nome_local || e.local || 'SEM LOCAL';
    if (!grupos[grpKey]) grupos[grpKey] = [];
    grupos[grpKey].push(e);
  });

  const gruposHtml = Object.entries(grupos).sort((a,b) => a[0].localeCompare(b[0])).map(([local, ends]) => {
    const ativos   = ends.filter(e => e.ativo).length;
    const inativos = ends.filter(e => !e.ativo).length;
    const bloqueados = ends.filter(e => e._limiteTingido).length;
    const grpId = 'grp-' + local.replace(/[^a-z0-9]/gi,'_');

    return `<div class="loc-group">
      <div class="loc-group-header" onclick="toggleLocGroup('${grpId}')">
        <span class="loc-group-chevron" id="${grpId}-chev">▶</span>
        <span style="font-weight:700;font-size:.85rem">🏭 ${local}</span>
        <span style="font-size:.73rem;color:var(--muted);margin-left:4px">${ends.length} endereço(s)</span>
        <div style="margin-left:auto;display:flex;gap:5px">
          ${ativos ? `<span class="badge b-green" style="font-size:.65rem">${ativos} ativos</span>` : ''}
          ${inativos ? `<span class="badge b-gray" style="font-size:.65rem">⛔ ${inativos} inativos</span>` : ''}
          ${bloqueados ? `<span class="badge b-blocked" style="font-size:.65rem">🔒 ${bloqueados} limite</span>` : ''}
        </div>
      </div>
      <div class="loc-group-body" id="${grpId}">
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Endereço</th><th>Estrutura</th><th>Tipo</th><th>Loja</th><th>Paletes usados/cap</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>${ends.map(rowHtml).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('end-table-wrap').innerHTML = `
    <div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:.73rem;color:var(--muted)">${lista.length.toLocaleString('pt-BR')} endereços em ${Object.keys(grupos).length} local(is)</div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" style="font-size:.7rem" onclick="toggleAllLocGroups(true)">▶ Recolher todos</button>
        <button class="btn btn-ghost btn-sm" style="font-size:.7rem" onclick="toggleAllLocGroups(false)">▼ Expandir todos</button>
      </div>
    </div>
    <div style="padding:10px">${gruposHtml}</div>`;
}

function toggleLocGroup(grpId) {
  const body = document.getElementById(grpId);
  const chev = document.getElementById(grpId + '-chev');
  if (!body) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (chev) { chev.textContent = isOpen ? '▶' : '▼'; chev.classList.toggle('open', !isOpen); }
}

function toggleAllLocGroups(recolher) {
  document.querySelectorAll('.loc-group-body').forEach(body => {
    body.classList.toggle('open', !recolher);
  });
  document.querySelectorAll('.loc-group-chevron').forEach(chev => {
    chev.textContent = recolher ? '▶' : '▼';
    chev.classList.toggle('open', !recolher);
  });
}

/**
 * Abre prompt inline para editar a capacidade de paletes de um endereço.
 */
function editarCapacidade(endCod) {
  const end = state().enderecosLista.find(e => e.endereco === endCod);
  if (!end) return;
  const atual = end.capacidade_paletes !== null ? String(end.capacidade_paletes) : '';
  const nova = prompt(`Capacidade de paletes para ${endCod}:\n(0 = inativo, vazio = sem limite)`, atual);
  if (nova === null) return; // cancelou
  if (nova.trim() === '') {
    salvarCapacidade(endCod, null);
    return;
  }
  salvarCapacidade(endCod, nova.trim());
}

// Sobrescreve salvarCapacidade para aceitar null (sem limite)
function salvarCapacidade(endCod, novaCap) {
  const result = dtSalvarCapacidadeEndereco(endCod, novaCap, {
    allowNull: true,
    refresh(cap) {
      atualizarEnderecos();
      logSistema('ENDERECO', `Capacidade de ${endCod} alterada para ${cap ?? 'sem limite'}`, { endCod, cap });
      showToast(`✅ Capacidade de ${endCod}: ${cap !== null ? cap + ' palete(s)' : 'sem limite'}`, 's');
    }
  });
  if (!result.ok) { showToast('Capacidade inválida', 'e'); return; }
}

// ───────────────────────────────────────────────────────────────────
//  18b. EXCLUSÃO DE ENDEREÇOS
// ───────────────────────────────────────────────────────────────────

function excluirEndereco(endCod) {
  showConfirm(`Excluir o endereço ${escHTML(endCod)}? Esta ação não pode ser desfeita.`, () => _excluirEnderecoConfirmado(endCod), { title: 'Excluir endereço', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' }); return;
}

function _excluirEnderecoConfirmado(endCod) {
  const setor = state().enderecosLista.find(e => e.endereco === endCod)?.setor || 'SEM LOCAL';
  const lista = (state().enderecosLista || []).filter(e => e.endereco !== endCod);
  const porSetor = { ...(state().enderecosPorSetor || {}) };
  if (porSetor[setor]) {
    porSetor[setor] = porSetor[setor].filter(e => e.endereco !== endCod);
    if (!porSetor[setor].length) delete porSetor[setor];
  }
  window.AnalistaState.batch([
    window.AnalistaActions.replaceSlice('enderecosLista', lista, { source: 'excluirEndereco' }),
    window.AnalistaActions.replaceSlice('enderecosPorSetor', porSetor, { source: 'excluirEndereco' })
  ]);
  storageSave(KEYS.enderecos, lista);
  atualizarEnderecos();
  logSistema('ENDERECO', `Endereço ${endCod} excluído`, { endCod });
  showToast(`🗑 Endereço ${endCod} excluído`, 's');
}

function excluirTodosEnderecos() {
  const total = state().enderecosLista.length;
  if (!total) { showToast('Nenhum endereço para excluir', 'w'); return; }
  showConfirm(`Excluir TODOS os ${total.toLocaleString('pt-BR')} endereços cadastrados? Esta ação não pode ser desfeita.`, () => _excluirTodosEnderecosConfirmado(), { title: 'Excluir todos os endereços', icon: '🗑️', okLabel: 'Excluir tudo', okClass: 'btn-danger' }); return;
}

function _excluirTodosEnderecosConfirmado() {
  const total = state().enderecosLista.length;
  window.AnalistaState.batch([
    window.AnalistaActions.replaceSlice('enderecosLista', [], { source: 'excluirTodosEnderecos' }),
    window.AnalistaActions.replaceSlice('enderecosPorSetor', {}, { source: 'excluirTodosEnderecos' })
  ]);
  storageSave(KEYS.enderecos, []);
  atualizarEnderecos();
  logSistema('ENDERECO', `Todos os ${total} endereços foram excluídos`, {});
  showToast(`🗑 ${total.toLocaleString('pt-BR')} endereços excluídos`, 's');
}

// ───────────────────────────────────────────────────────────────────
//  18c. FILTRO POR LOJA — popular select dinamicamente
// ───────────────────────────────────────────────────────────────────
let _endLojaSelectPopulado = false;

function _popularEndLojaSelect() {
  const sel = document.getElementById('end-floja');
  if (!sel) return;

  // Recalcular sempre que a lista mudar (flag resetada em atualizarEnderecos)
  const lojas = [...new Set(
    (state().enderecosLista || []).map(e => (e.loja || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // Só re-renderiza se o conteúdo realmente mudou
  const hash = lojas.join('|');
  if (sel.dataset.lojasHash === hash) return;
  sel.dataset.lojasHash = hash;

  const cur = sel.value;
  sel.innerHTML =
    '<option value="">Todas as Lojas</option>' +
    '<option value="__sem_loja__">⚠ Sem loja vinculada</option>' +
    lojas.map(l => `<option value="${escHTML(l)}" ${l === cur ? 'selected' : ''}>${escHTML(l)}</option>`).join('');
}

// ───────────────────────────────────────────────────────────────────
//  18d. VINCULAR ENDEREÇO A UMA LOJA
// ───────────────────────────────────────────────────────────────────
function endVincularLoja(endCod) {
  const end = state().enderecosLista.find(e => e.endereco === endCod);
  if (!end) { showToast('Endereço não encontrado', 'e'); return; }

  const lojas = [...new Set(
    (state().enderecosLista || []).map(e => (e.loja || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const dica = lojas.length
    ? `Lojas cadastradas: ${lojas.join(', ')}\n\n`
    : '';

  const novaLoja = prompt(
    `🏪 Vincular endereço "${endCod}" a qual loja?\n\n` +
    dica +
    `Digite o código da loja ou deixe em branco para remover o vínculo.`,
    end.loja || ''
  );

  if (novaLoja === null) return; // usuário cancelou

  end.loja = novaLoja.trim();

  // Invalidar hash do select para forçar re-popular
  const sel = document.getElementById('end-floja');
  if (sel) sel.dataset.lojasHash = '';

  storageSave(KEYS.enderecos, state().enderecosLista);
  atualizarEnderecos();

  if (end.loja) {
    showToast(`🏪 Loja "${escHTML(end.loja)}" vinculada a ${endCod}`, 's');
    logSistema('ENDERECO', `Loja de ${endCod} alterada para "${end.loja}"`, { endCod, loja: end.loja });
  } else {
    showToast(`🏪 Vínculo de loja removido de ${endCod}`, 's');
    logSistema('ENDERECO', `Loja de ${endCod} removida`, { endCod });
  }
}

