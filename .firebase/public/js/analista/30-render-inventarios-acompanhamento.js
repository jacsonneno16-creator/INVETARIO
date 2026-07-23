function state(){ return window.AnalistaStore.getState(); }
//  12. RENDERIZAÇÃO — INVENTÁRIOS
// ───────────────────────────────────────────────────────────────────

function filtrarInv(v) { window.AnalistaState.set('ui.filtroInventarioTexto', v.toLowerCase(), { source: 'ui-filter' }); renderInvTable(); }
function filtrarInvStatus(v) { window.AnalistaState.set('ui.filtroInventarioStatus', v, { source: 'ui-filter' }); renderInvTable(); }

function renderInvTable() {
  let dados = state().inventarios;
  if (state().ui.filtroInventarioTexto) dados = dados.filter(i => i.nome.toLowerCase().includes(state().ui.filtroInventarioTexto) || i.codigo.toLowerCase().includes(state().ui.filtroInventarioTexto));
  if (state().ui.filtroInventarioStatus) dados = dados.filter(i => i.status === state().ui.filtroInventarioStatus);

  if (!dados.length) {
    document.getElementById('inv-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Nenhum inventário encontrado</div><div class="empty-sub">Clique em + Novo Inventário para começar</div></div>`;
    return;
  }
  document.getElementById('inv-table-wrap').innerHTML = `
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Código</th><th>Nome</th><th>Data Início</th><th>Responsável</th>
          <th>Status</th><th>Registros</th><th>Endereços</th><th>Progresso</th><th>Ações</th>
        </tr></thead>
        <tbody>
          ${dados.map(inv => {
            const contados = [...new Set(state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida).map(c => c.endereco))];
            const endsAtivosTotal = state().enderecosLista.filter(e => e.ativo !== false).length;
            const pct = endsAtivosTotal > 0 ? Math.round((contados.length / endsAtivosTotal) * 100) : 0;
            return `<tr>
              <td class="mono">${inv.codigo}</td>
              <td style="font-weight:600">${escapeHTML(inv.nome)}${inv.setor ? `<br><span style="font-size:.7rem;color:var(--muted)">${escapeHTML(inv.setor)}</span>` : ''}${inv.loja_principal ? `<br><span style="font-size:.7rem;color:var(--muted)">Loja: ${escapeHTML(inv.loja_principal)}${(inv.lojas_espelho||[]).length ? ` · Espelho: ${escapeHTML((inv.lojas_espelho||[]).join(', '))}` : ''}</span>` : ''}</td>
              <td class="mono" style="color:var(--muted)">${fmtData(inv.data_inicio)}</td>
              <td style="font-size:.8rem">${inv.responsavel || '—'}</td>
              <td><span class="badge ${statusBadge(inv.status)}">${inv.status}</span></td>
              <td class="mono">${(inv.total_registros || 0).toLocaleString('pt-BR')}</td>
              <td class="mono">${endsAtivosTotal.toLocaleString('pt-BR')}</td>
              <td style="min-width:120px">
                <div class="prog-wrap">
                  <div class="prog"><div class="prog-fill ${pct>=80?'green':pct>=50?'blue':'yellow'}" style="width:${pct}%"></div></div>
                  <span class="prog-label">${pct}%</span>
                </div>
              </td>
              <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                  <button class="btn btn-ghost btn-sm" onclick="verBase('${inv.id}')">📂 Base</button>
                  <button class="btn btn-ghost btn-sm" onclick="toggleInvVisibilidade('${inv.id}')" title="${inv.oculto_coletor ? 'Inventário oculto no coletor — clique para mostrar' : 'Inventário visível no coletor — clique para ocultar'}" style="${inv.oculto_coletor ? 'color:var(--danger);border-color:rgba(217,32,32,.3)' : ''}">
                    ${inv.oculto_coletor ? '🙈 Oculto' : '👁 Visível'}
                  </button>
                  ${inv.status === 'ATIVO' ? `
                    <button class="btn btn-sm" onclick="abrirReimportarBase('${inv.id}')" title="Reimportar o CSV da base e publicar para os coletores" style="background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.3);padding:4px 8px;font-size:.72rem">📂 Reimportar Base</button>
                    <button class="btn btn-sm" onclick="republicarBaseInventario('${inv.id}')" title="Publicar base no Firebase para que os coletores possam baixar" style="background:rgba(59,130,246,.12);color:#60a5fa;border:1px solid rgba(59,130,246,.3);padding:4px 8px;font-size:.72rem">🔥 Publicar Base</button>
                    <button class="btn btn-ghost btn-sm" onclick="pausarInventario('${inv.id}')">⏸</button>
                    <button class="btn btn-danger btn-sm" onclick="abrirFecharInventario('${inv.id}')">Fechar</button>
                  ` : inv.status === 'PAUSADO' ? `
                    <button class="btn btn-success btn-sm" onclick="pausarInventario('${inv.id}')">▶ Reativar</button>
                  ` : `
                    <button class="btn btn-export btn-sm" onclick="validarExportacaoBluesoft('${inv.id}')" title="Validar e exportar para o Bluesoft">📤 Bluesoft</button>
                    <span style="font-size:.72rem;color:var(--muted)">${fmtData(inv.fechado_em)}</span>
                  `}
                  <button class="btn btn-sm" onclick="excluirInventario('${inv.id}')" title="Excluir inventário permanentemente" style="background:rgba(217,32,32,.10);color:var(--danger);border:1px solid rgba(217,32,32,.22);padding:4px 8px">🗑 Excluir</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ───────────────────────────────────────────────────────────────────
//  13. RENDERIZAÇÃO — ACOMPANHAMENTO
// ───────────────────────────────────────────────────────────────────

function trocarInventarioAcomp() {
  window.AnalistaState.set('ui.acompanhamentoInventarioId', document.getElementById('acomp-sel-inv').value || null, { source: 'ui-select-acomp' });
  renderAcompanhamento();
}

function renderAcompanhamento() {
  const sel = document.getElementById('acomp-sel-inv');
  if (sel) {
    const ativos = state().inventarios.filter(i => i.status === 'ATIVO');
    sel.innerHTML = '<option value="">Selecione uma auditoria...</option>' +
      ativos.map(i => `<option value="${i.id}" ${i.id === state().ui.acompanhamentoInventarioId ? 'selected' : ''}>${i.codigo} — ${i.nome}</option>`).join('');
  }

  const inv = state().ui.acompanhamentoInventarioId ? getInventarioPorId(state().ui.acompanhamentoInventarioId) : (getInventariosAtivos()[0] || null);
  if (!inv) {
    document.getElementById('acomp-inv-nome').textContent = 'Selecione uma auditoria para monitorar';
    ['ak-total','ak-contados','ak-pendentes','ak-diverg','ak-recount','ak-pct'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    const ruasGrid = document.getElementById('acomp-ruas-grid');
    if (ruasGrid) ruasGrid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🎯</div><div class="empty-title">Selecione uma auditoria</div></div>`;
    document.getElementById('acomp-progress-detail').innerHTML = '';
    document.getElementById('acomp-coletores-wrap').innerHTML = '';
    return;
  }

  if (!state().ui.acompanhamentoInventarioId) window.AnalistaState.set('ui.acompanhamentoInventarioId', inv.id, { source: 'ui-default-acomp' });
  document.getElementById('acomp-inv-nome').textContent = `${inv.codigo} — ${inv.nome}`;

  // Banner de inventário fechado
  const closedBanner = document.getElementById('acomp-closed-banner');
  if (inv.status === 'FECHADO') {
    if (!document.getElementById('acomp-closed-banner')) {
      const b = document.createElement('div');
      b.id = 'acomp-closed-banner';
      b.className = 'alert danger';
      b.style.marginBottom = '8px';
      b.innerHTML = `🔒 <strong>Inventário Encerrado em ${fmtTs(inv.fechado_em)}</strong> — Novas contagens e envios estão bloqueados. Modo somente leitura.`;
      document.getElementById('acomp-alertas').before(b);
    }
  } else {
    const existing = document.getElementById('acomp-closed-banner');
    if (existing) existing.remove();
  }

  // ──────────────────────────────────────────────────────────────────
  // REGRA: progresso sempre baseado em state().enderecosLista (endereços cadastrados)
  // conferidos = contados com produto + vazios_confirmados
  // ──────────────────────────────────────────────────────────────────
  const contsInv = state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida);
  const endsContados = new Set(contsInv.filter(c => !_isVazio(c)).map(c => c.endereco));
  // Vazios confirmados (não estornados)
  const endsVaziosConf = new Set(
    contsInv.filter(c => _isVazio(c) && c.status !== 'ESTORNADA').map(c => c.endereco)
  );
  // União: endereços contados com produto OU confirmados como vazios
  const endsConferidos = new Set([...endsContados, ...endsVaziosConf]);

  // Helper: extrai a rua do endereço (parte [3] de loja.local.area.rua.col.niv.seq)
  function _getRua(e) {
    // Prioridade 1: campo rua explícito no cadastro
    if (e.rua && e.rua !== '') return e.rua;
    // Prioridade 2: decompor pelo ponto
    if (e.endereco) {
      const parts = String(e.endereco).split('.');
      if (parts.length >= 4 && parts[3]) return parts[3];
      if (parts.length >= 1 && parts[0]) return parts[0]; // fallback p/ endereços curtos
    }
    return 'SEM RUA';
  }

  // Helper: extrai o local de estoque do cadastro
  function _getLocal(e) {
    return e.nome_local || e.local_area || e.local || e.setor || 'SEM LOCAL';
  }

  // Separar endereços ativos dos inativos (usa state().enderecosLista como base)
  const endsAtivos    = state().enderecosLista.filter(e => e.ativo !== false);
  const endsInativos  = state().enderecosLista.filter(e => e.ativo === false);
  // Conferidos = endereços ativos contados com produto OU confirmados como vazios
  const contadosAtivos   = endsAtivos.filter(e => endsContados.has(e.endereco));
  const vaziosConfAtivos = endsAtivos.filter(e => endsVaziosConf.has(e.endereco) && !endsContados.has(e.endereco));
  const conferidosAtivos = endsAtivos.filter(e => endsConferidos.has(e.endereco));

  const totalBase    = endsAtivos.length;
  const totalCont    = contadosAtivos.length;
  const totalVazios  = vaziosConfAtivos.length;
  const totalConf    = conferidosAtivos.length; // contados + vazios_confirmados
  const pendentes    = totalBase - totalConf;
  const divs = state().divergencias.filter(d => d.inventario_id === inv.id && d.status === 'ABERTA').length;
  const recs = state().recontagens.filter(r => r.inventario_id === inv.id && r.status === 'PENDENTE').length;
  const pct  = totalBase > 0 ? Math.round((totalConf / totalBase) * 100) : 0;

  document.getElementById('ak-total').textContent     = totalBase.toLocaleString('pt-BR');
  document.getElementById('ak-contados').textContent  = `${totalConf.toLocaleString('pt-BR')}${totalVazios > 0 ? ` (${totalVazios} vaz.)` : ''}`;
  document.getElementById('ak-pendentes').textContent = pendentes.toLocaleString('pt-BR');
  document.getElementById('ak-diverg').textContent    = divs.toLocaleString('pt-BR');
  document.getElementById('ak-recount').textContent   = recs.toLocaleString('pt-BR');
  document.getElementById('ak-pct').textContent       = pct + '%';

  // Alertas
  let alertaAcomp = '';
  if (endsInativos.length > 0)
    alertaAcomp += `<div class="alert info" style="margin-bottom:8px">🚫 <strong>${endsInativos.length} endereço(s) inativo(s)</strong> — excluídos do cálculo de progresso.</div>`;
  if (!state().enderecosLista.length)
    alertaAcomp += `<div class="alert warn" style="margin-bottom:8px">⚠️ <strong>Nenhum endereço cadastrado no sistema.</strong> Cadastre endereços na aba Endereços para ver o progresso correto.</div>`;
  const alertEl = document.getElementById('acomp-alertas');
  if (alertEl) alertEl.innerHTML = alertaAcomp;

  // ── PROGRESSO POR RUA (baseado em state().enderecosLista) ─────────────────────
  // conferidos = contados com produto + vazios confirmados
  const porRua = {};
  endsAtivos.forEach(e => {
    const rua = _getRua(e);
    if (!porRua[rua]) porRua[rua] = { total: 0, contados: 0, vazios: 0 };
    porRua[rua].total++;
    if (endsContados.has(e.endereco)) porRua[rua].contados++;
    else if (endsVaziosConf.has(e.endereco)) porRua[rua].vazios++;
  });

  // Popular filtro de ruas
  const filtroRua = document.getElementById('acomp-filtro-rua');
  const ruaSelecionada = filtroRua ? filtroRua.value : '';
  if (filtroRua) {
    filtroRua.innerHTML = '<option value="">Todas as ruas</option>' +
      Object.keys(porRua).sort((a,b) => a.localeCompare(b, 'pt-BR', {numeric:true}))
        .map(r => `<option value="${r}" ${r === ruaSelecionada ? 'selected' : ''}>${r}</option>`).join('');
  }

  const ruasFiltradas = ruaSelecionada
    ? Object.entries(porRua).filter(([r]) => r === ruaSelecionada)
    : Object.entries(porRua);

  const ruasGrid = document.getElementById('acomp-ruas-grid');
  if (ruasGrid) {
    if (!ruasFiltradas.length) {
      ruasGrid.innerHTML = `<div class="empty"><div class="empty-icon">🛣️</div><div class="empty-title">Nenhuma rua encontrada nos endereços cadastrados</div></div>`;
    } else {
      ruasGrid.innerHTML = ruasFiltradas
        .sort((a,b) => a[0].localeCompare(b[0], 'pt-BR', {numeric:true}))
        .map(([rua, d]) => {
          const conferidos = d.contados + d.vazios;
          const p = d.total > 0 ? Math.round((conferidos / d.total) * 100) : 0;
          const finalizado = p === 100;
          const color = finalizado ? 'green' : p >= 70 ? 'blue' : p >= 30 ? 'yellow' : 'red';
          const faltam = d.total - conferidos;
          // Recontagens nesta rua
          const endsRua = endsAtivos.filter(e => _getRua(e) === rua).map(e => e.endereco);
          const recsRua = state().recontagens.filter(r => r.inventario_id === inv.id && endsRua.includes(r.endereco)).length;
          return `<div onclick="abrirDetalheRua('${inv.id}','${rua.replace(/'/g,"\\'")}','${encodeURIComponent(rua)}')"
            style="background:${finalizado ? '#f0fdf4' : 'var(--surface)'};border:1.5px solid ${finalizado ? '#86efac' : 'var(--border)'};border-radius:10px;padding:14px 18px;cursor:pointer;transition:all .18s;user-select:none"
            onmouseover="this.style.borderColor='var(--accent)';this.style.transform='translateX(3px)'"
            onmouseout="this.style.borderColor='${finalizado?'#86efac':'var(--border)'   }';this.style.transform='translateX(0)'">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:.95rem">🛣️</span>
                <span style="font-weight:700;font-size:.9rem">Rua ${rua}</span>
                ${finalizado ? '<span class="badge b-green" style="font-size:.6rem">✓ FINALIZADA</span>' : ''}
                ${d.vazios > 0 ? `<span class="badge b-gray" style="font-size:.6rem">🔲 ${d.vazios} vaz.</span>` : ''}
                ${recsRua > 0 ? `<span class="badge b-orange" style="font-size:.6rem">🔄 ${recsRua} rec.</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-family:var(--mono);font-weight:800;font-size:1rem;color:${finalizado?'#059669':'var(--text)'}">${p}%</span>
                <span style="font-size:.7rem;color:var(--muted)">▶ detalhe</span>
              </div>
            </div>
            <div class="prog"><div class="prog-fill ${color}" style="width:${p}%"></div></div>
            <div style="display:flex;justify-content:space-between;margin-top:7px;font-size:.72rem;color:var(--muted)">
              <span>✅ ${d.contados} contados${d.vazios > 0 ? ` · 🔲 ${d.vazios} vazios` : ''}</span>
              <span>${d.total} endereços</span>
              <span style="color:${faltam>0?'var(--danger)':'var(--success)'}">⏳ ${faltam} faltam</span>
            </div>
          </div>`;
        }).join('');
    }
  }

  // ── PROGRESSO POR LOCAL DE ESTOQUE (baseado em state().enderecosLista) ────────
  const porLocal = {};
  endsAtivos.forEach(e => {
    const local = _getLocal(e);
    if (!porLocal[local]) porLocal[local] = { total: 0, contados: 0, vazios: 0 };
    porLocal[local].total++;
    if (endsContados.has(e.endereco)) porLocal[local].contados++;
    else if (endsVaziosConf.has(e.endereco)) porLocal[local].vazios++;
  });

  const progHtml = Object.entries(porLocal)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([local, d]) => {
      const conferidos = d.contados + d.vazios;
      const p = d.total > 0 ? Math.round((conferidos / d.total) * 100) : 0;
      const finalizado = p === 100;
      const color = finalizado ? 'green' : p >= 80 ? 'green' : p >= 50 ? 'blue' : 'yellow';
      return `<div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:.82rem;font-weight:700">🏭 ${local}</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:.72rem;color:var(--muted)">${conferidos}/${d.total} end.${d.vazios > 0 ? ` (${d.vazios} vaz.)` : ''}</span>
            ${finalizado ? '<span class="badge b-green" style="font-size:.6rem">✓ OK</span>' : ''}
          </div>
        </div>
        <div class="prog-wrap">
          <div class="prog"><div class="prog-fill ${color}" style="width:${p}%"></div></div>
          <span class="prog-label" style="font-weight:700">${p}%</span>
        </div>
      </div>`;
    }).join('');

  document.getElementById('acomp-progress-detail').innerHTML = progHtml
    || `<div style="text-align:center;color:var(--muted);padding:20px;font-size:.83rem">Nenhum endereço cadastrado no sistema. Cadastre endereços na aba <strong>Endereços</strong>.</div>`;

  // ── PRODUTIVIDADE POR OPERADOR ──────────────────────────────────────
  const porOp = {};
  contsInv.forEach(c => {
    const op = c.operador || 'Desconhecido';
    if (!porOp[op]) porOp[op] = { total: 0, divergencias: 0, recontagens: 0, primeira: null, ultima: null };
    porOp[op].total++;
    if (!porOp[op].primeira || c.timestamp < porOp[op].primeira) porOp[op].primeira = c.timestamp;
    if (!porOp[op].ultima || c.timestamp > porOp[op].ultima) porOp[op].ultima = c.timestamp;
  });
  state().divergencias.filter(d => d.inventario_id === inv.id).forEach(d => {
    const cont = contsInv.find(c => c.endereco === d.endereco);
    if (cont && cont.operador && porOp[cont.operador]) porOp[cont.operador].divergencias++;
  });
  state().recontagens.filter(r => r.inventario_id === inv.id && r.operador).forEach(r => {
    if (porOp[r.operador]) porOp[r.operador].recontagens++;
  });

  const colHtml = Object.entries(porOp).sort((a,b) => b[1].total - a[1].total).map(([op, d]) => {
    // Calcular tempo médio entre primeira e última contagem
    let tempoMedio = '—';
    if (d.primeira && d.ultima && d.total > 1) {
      const diffMs = new Date(d.ultima) - new Date(d.primeira);
      const mins = Math.round(diffMs / 60000);
      if (mins > 0) {
        const porH = Math.round((d.total / (diffMs / 3600000)) * 10) / 10;
        tempoMedio = `${porH}/h`;
      }
    }
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="u-avatar" style="width:28px;height:28px;font-size:.7rem;flex-shrink:0">${(op||'?')[0].toUpperCase()}</div>
          <span style="font-weight:600">${op || 'Desconhecido'}</span>
        </div>
      </td>
      <td class="mono" style="font-weight:700">${d.total.toLocaleString('pt-BR')}</td>
      <td class="mono" style="color:${d.divergencias>0?'var(--danger)':'var(--muted)'}">${d.divergencias}</td>
      <td class="mono" style="color:${d.recontagens>0?'var(--warn)':'var(--muted)'}">${d.recontagens}</td>
      <td class="mono" style="color:var(--muted)">${tempoMedio}</td>
      <td style="font-size:.75rem;color:var(--muted)">${fmtTs(d.ultima)}</td>
    </tr>`;
  }).join('');

  document.getElementById('acomp-coletores-wrap').innerHTML = colHtml ? `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Operador</th><th>Contagens</th><th>Conflitos</th><th>Rodadas</th><th>Produtividade</th><th>Última Atividade</th></tr></thead>
      <tbody>${colHtml}</tbody>
    </table></div>` :
    `<div class="empty"><div class="empty-icon">👤</div><div class="empty-title">Nenhum operador com contagens neste inventário</div></div>`;
}

