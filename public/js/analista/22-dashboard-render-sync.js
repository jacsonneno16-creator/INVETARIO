function state(){ return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  11. RENDERIZAÇÃO — DASHBOARD
// ───────────────────────────────────────────────────────────────────

function limparFiltrosDash() {
  ['dash-finv','dash-frua','dash-flocal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderDashboard();
}

let _dashCache = null;

function renderDashboardInventario() {
  // ── Preencher selects de filtro ──
  const fInvEl   = document.getElementById('dash-finv');
  const fRuaEl   = document.getElementById('dash-frua');
  const fLocalEl = document.getElementById('dash-flocal');

  const fInvId  = fInvEl?.value   || '';
  const fRua    = fRuaEl?.value   || '';
  const fLocal  = fLocalEl?.value || '';

  // Preencher select de inventários ativos
  if (fInvEl) {
    const cur = fInvEl.value;
    fInvEl.innerHTML = '<option value="">Todos os inventários ativos</option>' +
      getInventariosAtivos().map(i => `<option value="${i.id}" ${i.id===cur?'selected':''}>${i.codigo} — ${i.nome}</option>`).join('');
    if (cur) fInvEl.value = cur;
  }

  // Endereços cadastrados e endereços operacionais ativos.
  // O card 'End. cadastrados' deve mostrar a mesma quantidade da aba Endereços.
  const endsBaseTodos = state().enderecosLista || [];
  const endsBaseAtivos = endsBaseTodos.filter(e => e.ativo !== false);

  // Preencher selects de rua e local
  if (fRuaEl) {
    const cur = fRuaEl.value;
    const ruas = [...new Set(endsBaseAtivos.map(e => e.rua || extrairRua(e.endereco) || 'SEM RUA'))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
    fRuaEl.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(r=>`<option value="${r}" ${r===cur?'selected':''}>Rua ${r}</option>`).join('');
    if (cur) fRuaEl.value = cur;
  }
  if (fLocalEl) {
    const cur = fLocalEl.value;
    const locais = [...new Set(endsBaseAtivos.map(e => e.setor || 'SEM LOCAL'))].sort();
    fLocalEl.innerHTML = '<option value="">Todos os locais</option>' + locais.map(l=>`<option value="${l}" ${l===cur?'selected':''}>${l}</option>`).join('');
    if (cur) fLocalEl.value = cur;
  }

  // Inventários a considerar (filtrado por select ou todos ativos)
  const ativos = getInventariosAtivos();
  const invsConsiderados = fInvId ? ativos.filter(i => i.id === fInvId) : ativos;

  // Endereços filtrados por rua/local
  let endsFiltered = endsBaseAtivos;
  if (fRua)   endsFiltered = endsFiltered.filter(e => (e.rua || extrairRua(e.endereco) || 'SEM RUA') === fRua);
  if (fLocal) endsFiltered = endsFiltered.filter(e => (e.setor || 'SEM LOCAL') === fLocal);

  const endsFilteredSet = new Set(endsFiltered.map(e => e.endereco));

  const totalEnds  = state().enderecosLista.length;
  const totalConts = state().contagens.filter(c => !c._excluida).length;

  let endContadosTotal = 0;
  let pendentesTotal   = 0;
  invsConsiderados.forEach(inv => {
    const contsInv = state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida);
    const contados = new Set(contsInv.filter(c => !_isVazio(c)).map(c => c.endereco));
    const vaziosConf = new Set(contsInv.filter(c => _isVazio(c) && c.status !== 'ESTORNADA').map(c => c.endereco));
    endsFiltered.forEach(e => {
      if (contados.has(e.endereco) || vaziosConf.has(e.endereco)) endContadosTotal++;
      else pendentesTotal++;
    });
  });

  const divAbertos = state().divergencias.filter(d => {
    if (fInvId && d.inventario_id !== fInvId) return false;
    return d.status === 'ABERTA';
  }).length;
  const recPend = state().recontagens.filter(r => {
    if (fInvId && r.inventario_id !== fInvId) return false;
    return r.status === 'PENDENTE';
  }).length;

  const base4Pct = endsFiltered.length > 0 ? endsFiltered.length : endsBaseAtivos.length;
  const pctGeral = base4Pct > 0 && invsConsiderados.length > 0
    ? Math.round((endContadosTotal / (base4Pct * invsConsiderados.length)) * 100) : 0;

  const contagensConsideradas = state().contagens.filter(c => {
    if (c._excluida) return false;
    if (fInvId && c.inventario_id !== fInvId) return false;
    if (fRua || fLocal) {
      const end = state().enderecosLista.find(e => e.endereco === c.endereco) || {};
      const rua = end.rua || extrairRua(c.endereco) || 'SEM RUA';
      const local = end.setor || 'SEM LOCAL';
      if (fRua && rua !== fRua) return false;
      if (fLocal && local !== fLocal) return false;
    }
    return true;
  });

  // Operadores ativos
  const opsAtivos = new Set();
  invsConsiderados.forEach(inv => {
    state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida && c.operador).forEach(c => opsAtivos.add(c.operador));
  });

  document.getElementById('kd-inventarios').textContent  = invsConsiderados.length;
  const totalCadastradosCard = (fRua || fLocal)
    ? endsBaseTodos.filter(e => (!fRua || (e.rua || extrairRua(e.endereco) || 'SEM RUA') === fRua) && (!fLocal || (e.setor || 'SEM LOCAL') === fLocal)).length
    : endsBaseTodos.length;
  document.getElementById('kd-enderecos').textContent    = totalCadastradosCard.toLocaleString('pt-BR');
  document.getElementById('kd-end-contados').textContent = endContadosTotal.toLocaleString('pt-BR');
  document.getElementById('kd-contagens').textContent    = totalConts.toLocaleString('pt-BR');
  document.getElementById('kd-pendencias').textContent   = pendentesTotal.toLocaleString('pt-BR');
  document.getElementById('kd-diverg').textContent       = divAbertos.toLocaleString('pt-BR');
  document.getElementById('kd-recount').textContent      = recPend.toLocaleString('pt-BR');
  document.getElementById('kd-pct-geral').textContent    = pctGeral + '%';
  document.getElementById('kd-operadores').textContent   = opsAtivos.size;

  _dashCache = {
    filtros: { inventarioId: fInvId, rua: fRua, local: fLocal },
    invsConsiderados,
    endsBaseAtivos,
    endsBase: endsFiltered.length ? endsFiltered : endsBaseAtivos,
    endsFiltered,
    contagensConsideradas,
    pctGeral,
    endContadosTotal,
    pendentesTotal,
    divAbertos,
    recPend,
    opsAtivos: [...opsAtivos]
  };

  // Alertas
  const pausados = state().inventarios.filter(i => i.status === 'PAUSADO');
  let alertas = '';
  if (ativos.length === 0) {
    alertas += `<div class="alert info" style="margin-bottom:8px">📦 Nenhum inventário ativo. <a href="#" onclick="abrirNovoInventario()" style="color:var(--accent)">Criar novo inventário</a></div>`;
  }
  if (pausados.length > 0) {
    alertas += `<div class="alert warn" style="margin-bottom:8px">⏸️ ${pausados.length} inventário(s) <strong>PAUSADO(s)</strong>: ${pausados.map(i=>i.nome).join(', ')} — verifique se deve ser retomado.</div>`;
  }
  if (divAbertos > 5) {
    alertas += `<div class="alert warn" style="margin-bottom:8px">⚠️ <strong>${divAbertos}</strong> contagens em conflito aguardando resolução. <a href="#" onclick="goPage('divergencias',document.getElementById('nav-divergencias'))" style="color:var(--accent)">Ver conflitos →</a></div>`;
  }
  if (recPend > 0) {
    alertas += `<div class="alert warn" style="margin-bottom:8px">🔄 <strong>${recPend}</strong> rodada(s) pendente(s) aguardando execução. <a href="#" onclick="goPage('recontagens',document.getElementById('nav-recontagens'))" style="color:var(--accent)">Ver rodadas →</a></div>`;
  }
  // Alerta: contagens com inventario_id='local' — coletor salvou sem inventário definido
  const contagensLocais = state().contagens.filter(c => c.inventario_id === 'local' && !c._excluida);
  if (contagensLocais.length > 0) {
    alertas += `<div class="alert warn" style="margin-bottom:8px">⚠️ <strong>${contagensLocais.length} contagem(ns)</strong> chegaram sem vínculo de inventário (operador contou antes de selecionar o inventário corretamente). <a href="#" onclick="goPage('contagens',document.getElementById('nav-contagens'))" style="color:var(--accent)">Ver contagens →</a></div>`;
  }
  if (pctGeral >= 100 && invsConsiderados.length > 0) {
    alertas += `<div class="alert info" style="margin-bottom:8px">🎉 Todos os endereços foram contados! Verifique as divergências e feche o inventário.</div>`;
  }
  if (fInvId || fRua || fLocal) {
    const tags = [fInvId && `inventário: ${invsConsiderados[0]?.nome||fInvId}`, fRua && `rua: ${fRua}`, fLocal && `local: ${fLocal}`].filter(Boolean).join(' · ');
    alertas = `<div class="alert info" style="margin-bottom:8px">🔎 Filtros ativos: <strong>${tags}</strong> — KPIs calculados para a seleção.</div>` + alertas;
  }
  document.getElementById('dash-alert-wrap').innerHTML = alertas;

  // Barras de progresso
  const endsBase = endsFiltered.length ? endsFiltered : endsBaseAtivos;
  let progressHtml = '';
  invsConsiderados.slice(0,3).forEach(inv => {
    const contsInv2 = state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida);
    const contados2 = new Set(contsInv2.filter(c => !_isVazio(c)).map(c => c.endereco));
    const vaziosConf2 = new Set(contsInv2.filter(c => _isVazio(c) && c.status !== 'ESTORNADA').map(c => c.endereco));
    const conferidos2 = cod => contados2.has(cod) || vaziosConf2.has(cod);
    const conferidosAtivosInv = endsBase.filter(e => conferidos2(e.endereco)).length;
    const pct = endsBase.length > 0 ? Math.round((conferidosAtivosInv / endsBase.length) * 100) : 0;
    const color = pct >= 80 ? 'green' : pct >= 50 ? 'blue' : 'yellow';
    progressHtml += `
      <div style="padding:14px 20px;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-weight:600;font-size:.83rem">${escHTML(inv.nome)}</span>
          <span class="badge ${statusBadge(inv.status)}">${inv.status}</span>
        </div>
        <div class="prog-wrap">
          <div class="prog"><div class="prog-fill ${color}" style="width:${pct}%"></div></div>
          <span class="prog-label">${pct}%</span>
        </div>
        <div style="font-size:.7rem;color:var(--muted);margin-top:4px">${conferidosAtivosInv} de ${endsBase.length} endereços${fRua||fLocal?' (filtrados)':''} conferidos</div>
      </div>`;
  });
  document.getElementById('dash-progress-wrap').innerHTML = progressHtml ? `<div class="tc">${progressHtml}</div>` : '';

  // ── Progresso por Rua e Local ──
  _renderDashboardCharts();
  _renderDashRuas(endsBase, invsConsiderados);
  _renderDashLocais(endsBase, invsConsiderados);

  // Tabela resumo
  if (!state().inventarios.length) {
    document.getElementById('dash-inv-table').innerHTML = `<div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Nenhum inventário</div><div class="empty-sub">Clique em + Novo Inventário</div></div>`;
    return;
  }
  document.getElementById('dash-inv-table').innerHTML = `
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Código</th><th>Nome</th><th>Data</th><th>Status</th><th>Progresso</th><th>Ações</th></tr></thead>
        <tbody>
          ${state().inventarios.slice(0,8).map(inv => {
            const contsInv3 = state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida);
            const contadosSet3 = new Set(contsInv3.filter(c => !_isVazio(c)).map(c => c.endereco));
            const vaziosConfSet3 = new Set(contsInv3.filter(c => _isVazio(c) && c.status !== 'ESTORNADA').map(c => c.endereco));
            const conferidos3 = new Set([...contadosSet3, ...vaziosConfSet3]);
            const endsAtivosTotal = state().enderecosLista.filter(e => e.ativo !== false).length;
            const pct = endsAtivosTotal > 0 ? Math.round((conferidos3.size / endsAtivosTotal) * 100) : 0;
            return `<tr>
              <td class="mono">${inv.codigo}</td>
              <td style="font-weight:600">${escHTML(inv.nome)}</td>
              <td class="mono" style="color:var(--muted)">${fmtData(inv.data_inicio)}</td>
              <td><span class="badge ${statusBadge(inv.status)}">${inv.status}</span></td>
              <td>
                <div class="prog-wrap">
                  <div class="prog"><div class="prog-fill ${pct>=80?'green':pct>=50?'blue':'yellow'}" style="width:${pct}%"></div></div>
                  <span class="prog-label">${pct}%</span>
                </div>
              </td>
              <td><button class="btn btn-ghost btn-sm" onclick="verBase('${inv.id}')">Ver Base</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ───────────────────────────────────────────────────────────────────
//  11b. DASHBOARD — Progresso por Rua e por Local
// ───────────────────────────────────────────────────────────────────

function _renderDashRuas(endsBase, invsConsiderados) {
  const el = document.getElementById('dash-ruas-wrap');
  if (!el) return;
  if (!endsBase.length) { el.innerHTML = `<div class="empty" style="padding:16px"><div class="empty-icon">🛣️</div><div class="empty-title">Sem endereços</div></div>`; return; }

  const invs = invsConsiderados || getInventariosAtivos();
  // Mapear contagens e vazios dos inventários considerados
  const contadosSet = new Set();
  const vaziosConfSet = new Set();
  invs.forEach(inv => {
    state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida).forEach(c => {
      if (_isVazio(c) && c.status !== 'ESTORNADA') vaziosConfSet.add(c.endereco);
      else contadosSet.add(c.endereco);
    });
  });

  // Agrupar por rua
  const ruas = {};
  endsBase.forEach(e => {
    const rua = e.rua || extrairRua(e.endereco) || 'SEM RUA';
    if (!ruas[rua]) ruas[rua] = { total: 0, contados: 0 };
    ruas[rua].total++;
    if (contadosSet.has(e.endereco) || vaziosConfSet.has(e.endereco)) ruas[rua].contados++;
  });

  const sorted = Object.entries(ruas).sort((a,b) => {
    const pctA = a[1].total > 0 ? a[1].contados/a[1].total : 0;
    const pctB = b[1].total > 0 ? b[1].contados/b[1].total : 0;
    return pctA - pctB; // menor progresso primeiro
  });

  if (!sorted.length) { el.innerHTML = `<div class="empty" style="padding:16px"><div class="empty-icon">🛣️</div><div class="empty-title">Sem ruas mapeadas</div></div>`; return; }

  el.innerHTML = sorted.map(([rua, d]) => {
    const pct = d.total > 0 ? Math.round((d.contados/d.total)*100) : 0;
    const color = pct >= 80 ? 'green' : pct >= 40 ? 'orange' : 'red';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:.78rem;font-weight:600">${rua}</span>
        <span style="font-size:.7rem;color:var(--muted);font-family:var(--mono)">${d.contados}/${d.total} · ${pct}%</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="mini-prog"><div class="mini-prog-fill ${color}" style="width:${pct}%"></div></div>
      </div>
    </div>`;
  }).join('');
}

function _renderDashLocais(endsBase, invsConsiderados) {
  const el = document.getElementById('dash-locais-wrap');
  if (!el) return;
  if (!endsBase.length) { el.innerHTML = `<div class="empty" style="padding:16px"><div class="empty-icon">🏭</div><div class="empty-title">Sem endereços</div></div>`; return; }

  const invs = invsConsiderados || getInventariosAtivos();
  const contadosSet = new Set();
  const vaziosConfSet = new Set();
  invs.forEach(inv => {
    state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida).forEach(c => {
      if (_isVazio(c) && c.status !== 'ESTORNADA') vaziosConfSet.add(c.endereco);
      else contadosSet.add(c.endereco);
    });
  });

  const locais = {};
  endsBase.forEach(e => {
    const local = e.setor || 'SEM LOCAL';
    if (!locais[local]) locais[local] = { total: 0, contados: 0 };
    locais[local].total++;
    if (contadosSet.has(e.endereco) || vaziosConfSet.has(e.endereco)) locais[local].contados++;
  });

  const sorted = Object.entries(locais).sort((a,b) => {
    const pctA = a[1].total > 0 ? a[1].contados/a[1].total : 0;
    const pctB = b[1].total > 0 ? b[1].contados/b[1].total : 0;
    return pctA - pctB;
  });

  if (!sorted.length) { el.innerHTML = `<div class="empty" style="padding:16px"><div class="empty-icon">🏭</div><div class="empty-title">Sem locais mapeados</div></div>`; return; }

  el.innerHTML = sorted.map(([local, d]) => {
    const pct = d.total > 0 ? Math.round((d.contados/d.total)*100) : 0;
    const pend = d.total - d.contados;
    const color = pct >= 80 ? 'green' : pct >= 40 ? 'orange' : 'red';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:.78rem;font-weight:600">${local}</span>
        <span style="font-size:.7rem;color:var(--muted);font-family:var(--mono)">${d.contados}/${d.total} · ${pct}%</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
        <div class="mini-prog"><div class="mini-prog-fill ${color}" style="width:${pct}%"></div></div>
      </div>
      <div style="font-size:.65rem;color:var(--muted)">${pend > 0 ? `${pend} pendentes` : '✅ Concluído'}</div>
    </div>`;
  }).join('');
}


function _dashSafe(str) {
  return escHTML(String(str ?? ''));
}

function _dashBuildBreakdown(endsBase, invsConsiderados, keyFn) {
  const invs = invsConsiderados || getInventariosAtivos();
  const contadosSet = new Set();
  const vaziosConfSet = new Set();
  invs.forEach(inv => {
    state().contagens.filter(c => c.inventario_id === inv.id && !c._excluida).forEach(c => {
      if (_isVazio(c) && c.status !== 'ESTORNADA') vaziosConfSet.add(c.endereco);
      else contadosSet.add(c.endereco);
    });
  });
  const groups = {};
  endsBase.forEach(e => {
    const key = keyFn(e) || 'SEM DADO';
    if (!groups[key]) groups[key] = { total: 0, contados: 0 };
    groups[key].total++;
    if (contadosSet.has(e.endereco) || vaziosConfSet.has(e.endereco)) groups[key].contados++;
  });
  return Object.entries(groups).map(([label, d]) => {
    const pendentes = Math.max(0, d.total - d.contados);
    const pct = d.total > 0 ? Math.round((d.contados / d.total) * 100) : 0;
    return { label, total: d.total, contados: d.contados, pendentes, pct };
  });
}

function _dashTopOperadores(contagensConsideradas) {
  const mapa = {};
  (contagensConsideradas || []).forEach(c => {
    const op = c.operador || c.usuario || 'SEM OPERADOR';
    if (!mapa[op]) mapa[op] = { operador: op, total: 0, enderecos: new Set(), divergencias: 0 };
    mapa[op].total++;
    if (c.endereco) mapa[op].enderecos.add(c.endereco);
    if (c.status === 'CONFLITO' || c.em_conflito) mapa[op].divergencias++;
  });
  return Object.values(mapa)
    .map(x => ({ ...x, enderecos: x.enderecos.size }))
    .sort((a,b) => b.total - a.total)
    .slice(0,8);
}

function _dashHourlySeries(contagensConsideradas) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
  (contagensConsideradas || []).forEach(c => {
    const raw = c.criado_em || c.created_at || c.data_hora || c.ts || c.updated_at;
    if (!raw) return;
    let d = null;
    if (raw && typeof raw.toDate === 'function') d = raw.toDate();
    else d = new Date(raw);
    if (!(d instanceof Date) || isNaN(d)) return;
    buckets[d.getHours()].total++;
  });
  return buckets;
}

function _dashMiniBars(items, opts={}) {
  const clickable = !!opts.clickable;
  if (!items.length) return `<div class="empty" style="padding:20px"><div class="empty-icon">📊</div><div class="empty-title">Sem dados para o gráfico</div></div>`;
  const max = Math.max(...items.map(i => i.value), 1);
  return items.map(item => {
    const pct = Math.max(4, Math.round((item.value / max) * 100));
    const buttonOpen = clickable ? `<button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;padding:10px 12px;border-radius:12px" onclick="${item.onclick}">` : `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2)">`;
    const buttonClose = clickable ? `</button>` : `</div>`;
    return `${buttonOpen}
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px">
        <span style="font-size:.76rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_dashSafe(item.label)}</span>
        <span style="font-size:.68rem;color:var(--muted);font-family:var(--mono)">${item.valueLabel || item.value}</span>
      </div>
      <div style="height:10px;background:var(--border);border-radius:999px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${item.color || 'linear-gradient(90deg,var(--orange),var(--orange-h))'};border-radius:999px"></div>
      </div>
      ${item.sub ? `<div style="margin-top:6px;font-size:.67rem;color:var(--muted)">${_dashSafe(item.sub)}</div>` : ''}
    ${buttonClose}`;
  }).join('');
}

function _renderDashboardCharts() {
  const wrap = document.getElementById('dash-charts-wrap');
  if (!wrap) return;
  const dc = _dashCache;
  if (!dc || !dc.endsBase || !dc.invsConsiderados) {
    wrap.innerHTML = '';
    return;
  }

  const ruas = _dashBuildBreakdown(dc.endsBase, dc.invsConsiderados, e => e.rua || extrairRua(e.endereco) || 'SEM RUA')
    .sort((a,b) => b.pendentes - a.pendentes || a.pct - b.pct)
    .slice(0,6);
  const locais = _dashBuildBreakdown(dc.endsBase, dc.invsConsiderados, e => e.setor || 'SEM LOCAL')
    .sort((a,b) => b.pendentes - a.pendentes || a.pct - b.pct)
    .slice(0,6);
  const operadores = _dashTopOperadores(dc.contagensConsideradas);
  const serieHoras = _dashHourlySeries(dc.contagensConsideradas);
  const totalHoraMax = Math.max(...serieHoras.map(x => x.total), 1);

  const pct = Math.max(0, Math.min(100, dc.pctGeral || 0));
  const pendPct = 100 - pct;

  const ruasHtml = _dashMiniBars(ruas.map(r => ({
    label: `Rua ${r.label}`,
    value: r.pendentes,
    valueLabel: `${r.pendentes} pend.`,
    sub: `${r.contados}/${r.total} conferidos · ${r.pct}%`,
    color: 'linear-gradient(90deg,#ef4444,#f97316)',
    onclick: `dashApplyRuaFilter(${JSON.stringify(r.label)})`
  })), { clickable: true });

  const locaisHtml = _dashMiniBars(locais.map(l => ({
    label: l.label,
    value: l.pendentes,
    valueLabel: `${l.pendentes} pend.`,
    sub: `${l.contados}/${l.total} conferidos · ${l.pct}%`,
    color: 'linear-gradient(90deg,#0ea5e9,#22c55e)',
    onclick: `dashApplyLocalFilter(${JSON.stringify(l.label)})`
  })), { clickable: true });

  const operadoresHtml = operadores.length ? operadores.map((op, idx) => `
    <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;padding:10px 12px;border-radius:12px" onclick="dashApplyOperadorFilter(${JSON.stringify(op.operador)})">
      <div style="display:flex;align-items:center;gap:10px;width:100%">
        <div style="width:28px;height:28px;border-radius:10px;background:${idx===0?'var(--orange-soft)':'var(--surface-3)'};display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:.72rem;font-weight:700;color:${idx===0?'var(--orange)':'var(--muted)'}">${idx+1}</div>
        <div style="flex:1;min-width:0;text-align:left">
          <div style="font-size:.78rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_dashSafe(op.operador)}</div>
          <div style="font-size:.67rem;color:var(--muted)">${op.enderecos} end. únicos · ${op.divergencias} conflito(s)</div>
        </div>
        <div style="font-family:var(--mono);font-size:.82rem;font-weight:700;color:var(--green-mid)">${op.total}</div>
      </div>
    </button>
  `).join('') : `<div class="empty" style="padding:20px"><div class="empty-icon">👥</div><div class="empty-title">Sem operadores no filtro</div></div>`;

  const hourBars = serieHoras.map(b => {
    const h = Math.max(8, Math.round((b.total / totalHoraMax) * 100));
    const active = b.total > 0;
    return `<div title="${String(b.hora).padStart(2,'0')}:00 · ${b.total} contagem(ns)" style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0">
      <div style="height:110px;width:100%;display:flex;align-items:flex-end;justify-content:center">
        <div style="width:100%;max-width:22px;height:${active ? h : 8}%;border-radius:8px 8px 4px 4px;background:${active ? 'linear-gradient(180deg,var(--orange-h),var(--orange))' : 'var(--border)'};transition:height .25s"></div>
      </div>
      <div style="font-size:.61rem;font-family:var(--mono);color:${active ? 'var(--text-2)' : 'var(--muted-2)'}">${String(b.hora).padStart(2,'0')}</div>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:16px;margin-bottom:4px">
      <div class="tc" style="overflow:hidden">
        <div class="tc-header"><div><div class="tc-title">📈 Conclusão do filtro</div><div class="sec-sub">Clique nas barras ao lado para refinar a análise</div></div></div>
        <div style="padding:18px 20px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          <div style="width:180px;height:180px;border-radius:50%;background:conic-gradient(var(--green-light) 0 ${pct}%, var(--border) ${pct}% 100%);display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0;margin:auto">
            <div style="width:118px;height:118px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;flex-direction:column;box-shadow:inset 0 0 0 1px var(--border)">
              <div style="font-family:var(--mono);font-size:1.8rem;font-weight:800;color:var(--green-mid)">${pct}%</div>
              <div style="font-size:.64rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">concluído</div>
            </div>
          </div>
          <div style="flex:1;min-width:220px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)"><div style="font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Conferidos</div><div style="font-family:var(--mono);font-size:1.2rem;font-weight:800;color:var(--green-mid)">${dc.endContadosTotal.toLocaleString('pt-BR')}</div></div>
            <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)"><div style="font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Pendentes</div><div style="font-family:var(--mono);font-size:1.2rem;font-weight:800;color:var(--danger)">${dc.pendentesTotal.toLocaleString('pt-BR')}</div></div>
            <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)"><div style="font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Conflitos</div><div style="font-family:var(--mono);font-size:1.2rem;font-weight:800;color:var(--warn)">${dc.divAbertos.toLocaleString('pt-BR')}</div></div>
            <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)"><div style="font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Recontagem</div><div style="font-family:var(--mono);font-size:1.2rem;font-weight:800;color:var(--orange)">${dc.recPend.toLocaleString('pt-BR')}</div></div>
          </div>
        </div>
      </div>
      <div class="tc">
        <div class="tc-header"><div><div class="tc-title">🛣️ Ruas com mais pendências</div><div class="sec-sub">Clique para filtrar a rua</div></div></div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:8px">${ruasHtml}</div>
      </div>
      <div class="tc">
        <div class="tc-header"><div><div class="tc-title">🏭 Locais com mais pendências</div><div class="sec-sub">Clique para filtrar o local</div></div></div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:8px">${locaisHtml}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:16px;margin-bottom:16px">
      <div class="tc">
        <div class="tc-header"><div><div class="tc-title">⏱️ Contagens por hora</div><div class="sec-sub">Distribuição operacional do filtro atual</div></div></div>
        <div style="padding:18px 16px 12px">
          <div style="display:flex;gap:8px;align-items:flex-end">${hourBars}</div>
        </div>
      </div>
      <div class="tc">
        <div class="tc-header"><div><div class="tc-title">👥 Ranking de operadores</div><div class="sec-sub">Clique para abrir as contagens já filtradas por operador</div></div></div>
        <div style="padding:14px;display:flex;flex-direction:column;gap:8px">${operadoresHtml}</div>
      </div>
    </div>`;
}

function dashApplyRuaFilter(rua) {
  const el = document.getElementById('dash-frua');
  if (!el) return;
  el.value = rua || '';
  renderDashboard();
}

function dashApplyLocalFilter(local) {
  const el = document.getElementById('dash-flocal');
  if (!el) return;
  el.value = local || '';
  renderDashboard();
}

function dashApplyOperadorFilter(operador) {
  goPage('contagens', document.getElementById('nav-contagens'));
  const campo = document.getElementById('cont-busca');
  const selOp = document.getElementById('cont-foperador');
  if (selOp) selOp.value = operador || '';
  if (campo) {
    campo.value = operador || '';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (typeof renderContagens === 'function') {
    renderContagens();
  }
}

// ───────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════
// DASHBOARD DUPLO — INVENTÁRIO / AUDITORIA (v36)
// ══════════════════════════════════════════════════════════════════════
let _dashAudMetas = [];
let _dashAudItens = [];
let _dashAudCarregando = false;
let _dashAudLoja = '';

function _dashModoAtual(){ return document.getElementById('dash-mode')?.value || 'inventario'; }
function _dashEnderecoPartes(endereco){
  const p=window.DTEnderecos?.partes(endereco)||{};
  return {loja:p.loja||'',local:p.local||'',area:p.area||'',rua:p.rua||'SEM RUA',coluna:p.coluna||'SEM COLUNA',nivel:p.nivel||'SEM NÍVEL',sequencia:p.sequencia||''};
}
function _dashSetKpi(idx,valor,rotulo,icone){
  const ids=['kd-inventarios','kd-enderecos','kd-end-contados','kd-pendencias','kd-contagens','kd-diverg','kd-recount','kd-pct-geral','kd-operadores'];
  const el=document.getElementById(ids[idx]); if(!el)return;
  el.textContent=valor;
  const card=el.closest('.kpi');
  const lbl=card?.querySelector('.kpi-lbl'); const ico=card?.querySelector('.kpi-icon');
  if(lbl)lbl.textContent=rotulo; if(ico)ico.textContent=icone;
}
function alterarModoDashboard(modo){
  document.querySelectorAll('.dash-inv-filter').forEach(e=>e.style.display=modo==='inventario'?'':'none');
  document.querySelectorAll('.dash-aud-filter').forEach(e=>e.style.display=modo==='auditoria'?'':'none');
  const novo=document.querySelector('#page-dashboard button[onclick="abrirNovoInventario()"]');
  if(novo) novo.style.display=modo==='inventario'?'':'none';
  renderDashboard();
}
function renderDashboard(){
  if(_dashModoAtual()==='auditoria') return carregarDashboardAuditoria(false);
  document.getElementById('dash-alert-wrap').innerHTML='';
  const action=document.getElementById('dash-recentes-action'); if(action)action.style.display='';
  const title=document.getElementById('dash-recentes-title'); if(title)title.textContent='📦 Inventários Recentes';
  return renderDashboardInventario();
}
function limparFiltrosDash(){
  if(_dashModoAtual()==='auditoria'){
    ['dash-faud','dash-fastatus','dash-farua','dash-fanivel','dash-faproduto'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    return carregarDashboardAuditoria(false);
  }
  ['dash-finv','dash-frua','dash-flocal'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  renderDashboardInventario();
}
async function carregarDashboardAuditoria(forcar){
  const lojaAtual=window.getDTLojaAtiva?.()||'';
  if(_dashAudCarregando)return;
  if(!forcar && _dashAudLoja===lojaAtual && _dashAudMetas.length){ renderDashboardAuditoria(); return; }
  _dashAudCarregando=true;
  const wrap=document.getElementById('dash-charts-wrap'); if(wrap)wrap.innerHTML='<div class="tc"><div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando auditorias...</div></div></div>';
  try{
    const raw=window.getDTRawFirestore?.() || window.FS_AN || window.getDTFirestore?.();
    const metas=[],vistos=new Set();
    async function add(ref,origem){try{const snap=await ref.get();snap.docs.forEach(d=>{if(vistos.has(d.id))return;vistos.add(d.id);metas.push({id:d.id,...d.data(),_origem:origem,_ref:d.ref});});}catch(e){console.warn('[Dashboard Auditoria] '+origem,e);}}
    if(window.getDTRawFirestore){
      if(lojaAtual)await add(raw.collection('lojas').doc(lojaAtual).collection('dt_auditorias'),'loja:'+lojaAtual);
      try{const ls=await raw.collection('lojas').get();for(const ld of ls.docs){if(ld.id!==lojaAtual)await add(raw.collection('lojas').doc(ld.id).collection('dt_auditorias'),'loja:'+ld.id);}}catch(e){}
      await add(raw.collection('dt_auditorias'),'raiz');
    }else await add(raw.collection('dt_auditorias'),'loja');
    _dashAudMetas=metas;
    const escolhido=document.getElementById('dash-faud')?.value||'';
    const selecionadas=escolhido?_dashAudMetas.filter(m=>m.id===escolhido):_dashAudMetas;
    const listas=await Promise.all(selecionadas.map(async m=>{
      const ref=m._ref || raw.collection('dt_auditorias').doc(m.id);
      const [res,baseChunks]=await Promise.all([ref.collection('enderecos').get(),ref.collection('base_chunks').get().catch(()=>({docs:[]}))]);
      const resultados=res.docs.map(d=>({id:d.id,...d.data()}));
      const base=[];baseChunks.docs.forEach(d=>{const x=d.data()||{};(x.dados||x.itens||x.registros||[]).forEach((r,idx)=>base.push({id:String(r.id||r.docId||d.id+'_'+idx),...r}));});
      const porId=new Map(resultados.map(r=>[String(r.id),r]));
      const porEnd=new Map(resultados.map(r=>[String(r.endereco||'').trim().toUpperCase(),r]));
      const usados=new Set();
      const unidos=base.length?base.map(b=>{const r=porId.get(String(b.id))||porEnd.get(String(b.endereco||'').trim().toUpperCase());if(r)usados.add(String(r.id));return r?{...b,...r,id:r.id||b.id}:{...b,status:b.status||'PENDENTE'};}):resultados.slice();
      resultados.forEach(r=>{if(!usados.has(String(r.id))&&!unidos.some(x=>String(x.id)===String(r.id)))unidos.push(r);});
      return unidos.map(x=>({auditoriaId:m.id,auditoriaNome:m.nome||m.auditoria_nome||m.id,...x}));
    }));
    _dashAudItens=listas.flat(); _dashAudLoja=lojaAtual;
    _dashPopularFiltrosAuditoria(); renderDashboardAuditoria();
  }catch(e){
    console.error('[Dashboard Auditoria]',e);
    if(wrap)wrap.innerHTML='<div class="tc"><div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar o dashboard de auditoria</div></div></div>';
  }finally{_dashAudCarregando=false;}
}

function _dashAudStatus(i){
  const s=String(i.status||'PENDENTE').toUpperCase();
  if(['APROVADO','CORRETO','CONFERIDO','FINALIZADO','CONFIRMADO_SEM_AJUSTE'].includes(s))return'OK';
  if(['ERRO','CONFIRMADO_COM_AJUSTE'].includes(s))return'DIVERGENTE';
  if(s==='VAZIO')return'ENDERECO_VAZIO'; return s;
}
function _dashPopularFiltrosAuditoria(){
  const sel=document.getElementById('dash-faud'); if(sel){const cur=sel.value;sel.innerHTML='<option value="">Todas as auditorias</option>'+_dashAudMetas.map(m=>`<option value="${_dashSafe(m.id)}">${_dashSafe(m.nome||m.auditoria_nome||m.id)}</option>`).join('');sel.value=cur;}
  const itens=_dashAudItens;
  const popular=(id,vals,prefix)=>{const e=document.getElementById(id);if(!e)return;const cur=e.value;e.innerHTML=`<option value="">Todos os ${prefix}</option>`+vals.map(v=>`<option value="${_dashSafe(v)}">${prefix==='ruas'?'Rua ':prefix==='níveis'?'Nível ':''}${_dashSafe(v)}</option>`).join('');e.value=cur;};
  popular('dash-farua',[...new Set(itens.map(i=>_dashEnderecoPartes(i.endereco).rua))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true})),'ruas');
  popular('dash-fanivel',[...new Set(itens.map(i=>_dashEnderecoPartes(i.endereco).nivel))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true})),'níveis');
}
function _dashAudFiltrados(){
  const aud=document.getElementById('dash-faud')?.value||'', st=document.getElementById('dash-fastatus')?.value||'', rua=document.getElementById('dash-farua')?.value||'', nivel=document.getElementById('dash-fanivel')?.value||'', busca=(document.getElementById('dash-faproduto')?.value||'').toLowerCase();
  return _dashAudItens.filter(i=>{const p=_dashEnderecoPartes(i.endereco);if(aud&&i.auditoriaId!==aud)return false;if(st&&_dashAudStatus(i)!==st)return false;if(rua&&p.rua!==rua)return false;if(nivel&&p.nivel!==nivel)return false;if(busca&&!String([i.produtoEsperado,i.produto_esperado,i.produtoLido,i.produto_lido,i.dunEsperado,i.dun_esperado,i.dun,i.dunLido,i.dun_lido].join(' ')).toLowerCase().includes(busca))return false;return true;});
}
function _dashAgrupar(lista,keyFn,pred){const m={};lista.filter(pred||(()=>true)).forEach(i=>{const k=keyFn(i)||'SEM DADO';m[k]=(m[k]||0)+1;});return Object.entries(m).sort((a,b)=>b[1]-a[1]);}
function _dashAudBarClick(tipo,valor){const map={rua:'dash-farua',nivel:'dash-fanivel',produto:'dash-faproduto'};const e=document.getElementById(map[tipo]);if(e)e.value=valor;renderDashboardAuditoria();}
function _dashAudBars(arr,tipo,lim=10){if(!arr.length)return'<div class="empty" style="padding:20px"><div class="empty-title">Sem dados</div></div>';const max=Math.max(...arr.map(x=>x[1]),1);return arr.slice(0,lim).map(([l,v])=>`<button class="btn btn-ghost btn-sm" onclick="_dashAudBarClick('${tipo}','${String(l).replace(/'/g,"\\'")}')" style="width:100%;display:block;text-align:left;padding:9px 10px;margin-bottom:7px"><div style="display:flex;justify-content:space-between;gap:8px"><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_dashSafe(l)}</b><span class="mono">${v}</span></div><div style="height:9px;background:var(--border);border-radius:99px;margin-top:6px;overflow:hidden"><div style="height:100%;width:${Math.max(4,Math.round(v/max*100))}%;background:linear-gradient(90deg,var(--orange),#ef4444);border-radius:99px"></div></div></button>`).join('');}
function renderDashboardAuditoria(){
  const lista=_dashAudFiltrados(), total=lista.length, ok=lista.filter(i=>_dashAudStatus(i)==='OK').length, div=lista.filter(i=>_dashAudStatus(i)==='DIVERGENTE').length, vaz=lista.filter(i=>_dashAudStatus(i)==='ENDERECO_VAZIO').length, pend=lista.filter(i=>_dashAudStatus(i)==='PENDENTE').length, audit=total-pend, taxa=total?Math.round(audit/total*100):0, acur=audit?Math.round(ok/audit*100):0;
  const ops=new Set(lista.map(i=>i.operadorNome||i.operador_nome||i.operadorId||i.operador_id).filter(Boolean)).size;
  [_dashAudMetas.length,total,audit,pend,ok,div,vaz,`${taxa}%`,ops].forEach((v,idx)=>_dashSetKpi(idx,v,['Auditorias','Itens previstos','Itens auditados','Pendentes','Itens corretos','Divergências','End. vazios','% executado','Operadores'][idx],['🔎','📍','✅','⏳','🎯','⚠️','📭','📊','👥'][idx]));
  const diverg=lista.filter(i=>_dashAudStatus(i)==='DIVERGENTE');
  const prod=_dashAgrupar(diverg,i=>i.produtoEsperado||i.produto_esperado||i.dunEsperado||i.dun_esperado||i.dun||'SEM PRODUTO');
  const ruas=_dashAgrupar(diverg,i=>_dashEnderecoPartes(i.endereco).rua), niveis=_dashAgrupar(diverg,i=>_dashEnderecoPartes(i.endereco).nivel), cols=_dashAgrupar(diverg,i=>_dashEnderecoPartes(i.endereco).coluna);
  const operadores=_dashAgrupar(diverg,i=>i.operadorNome||i.operador_nome||i.operadorId||i.operador_id||'SEM OPERADOR');
  const wrap=document.getElementById('dash-charts-wrap'); if(wrap)wrap.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:16px"><div class="tc"><div class="tc-header"><div class="tc-title">📦 Produtos com mais divergências</div></div><div style="padding:12px">${_dashAudBars(prod,'produto',12)}</div></div><div class="tc"><div class="tc-header"><div class="tc-title">🛣️ Ruas com mais divergências</div></div><div style="padding:12px">${_dashAudBars(ruas,'rua',12)}</div></div><div class="tc"><div class="tc-header"><div class="tc-title">🏗️ Níveis com mais divergências</div></div><div style="padding:12px">${_dashAudBars(niveis,'nivel',10)}</div></div><div class="tc"><div class="tc-header"><div class="tc-title">📐 Colunas com mais divergências</div></div><div style="padding:12px">${_dashAudBars(cols,'coluna',10)}</div></div></div>`;
  const rwrap=document.getElementById('dash-ruas-wrap');if(rwrap)rwrap.innerHTML=_dashAudBars(operadores,'operador',10);
  const lwrap=document.getElementById('dash-locais-wrap');if(lwrap)lwrap.innerHTML=`<div style="padding:8px"><div style="font-size:2rem;font-weight:800">${acur}%</div><div style="color:var(--muted);margin-bottom:12px">Acuracidade dos itens auditados</div>${[['Corretos',ok],['Divergentes',div],['Vazios',vaz],['Pendentes',pend]].map(x=>`<div style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid var(--border)"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}</div>`;
  const rt=document.getElementById('dash-recentes-title');if(rt)rt.textContent='🔎 Auditorias e resultados recentes';const act=document.getElementById('dash-recentes-action');if(act)act.style.display='none';
  const tab=document.getElementById('dash-inv-table');if(tab){const rec=[...lista].sort((a,b)=>String(b.lidoEm||b.lido_em||'').localeCompare(String(a.lidoEm||a.lido_em||''))).slice(0,15);tab.innerHTML=rec.length?`<div class="table-wrap"><table><thead><tr><th>Auditoria</th><th>Endereço</th><th>Produto esperado</th><th>Produto lido</th><th>Status</th><th>Operador</th></tr></thead><tbody>${rec.map(i=>`<tr><td>${_dashSafe(i.auditoriaNome)}</td><td class="mono">${_dashSafe(i.endereco)}</td><td>${_dashSafe(i.produtoEsperado||i.produto_esperado||i.dunEsperado||i.dun_esperado||'—')}</td><td>${_dashSafe(i.produtoLido||i.produto_lido||i.dunLido||i.dun_lido||'—')}</td><td><span class="badge ${_dashAudStatus(i)==='OK'?'ok':_dashAudStatus(i)==='DIVERGENTE'?'err':'warn'}">${_dashSafe(_dashAudStatus(i))}</span></td><td>${_dashSafe(i.operadorNome||i.operador_nome||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><div class="empty-title">Nenhum resultado para os filtros</div></div>';}
  const alert=document.getElementById('dash-alert-wrap');if(alert)alert.innerHTML=div?`<div class="alert warn"><b>⚠️ ${div} divergência(s)</b> nos filtros atuais. Clique nos gráficos para aprofundar a análise.</div>`:`<div class="alert ok"><b>✅ Nenhuma divergência</b> nos filtros atuais.</div>`;
}
window.alterarModoDashboard=alterarModoDashboard;window.carregarDashboardAuditoria=carregarDashboardAuditoria;window.renderDashboardAuditoriaBase=renderDashboardAuditoria;window.renderDashboardAuditoria=renderDashboardAuditoria;window._dashAudBarClick=_dashAudBarClick;
