function state(){ return window.AnalistaStore.getState(); }

let _abaColetoresInicializada = false;
const _acoesColetoresEmAndamento = new Set();

function inicializarAbaColetores() {
  if (_abaColetoresInicializada) return;
  _abaColetoresInicializada = true;

  ['col-painel-cards', 'col-cadastro-wrap'].forEach(id => {
    const container = document.getElementById(id);
    if (!container || container.dataset.eventosColetores === '1') return;
    container.dataset.eventosColetores = '1';
    container.addEventListener('click', tratarCliqueAcaoColetor);
  });
}
window.inicializarAbaColetores = inicializarAbaColetores;

async function tratarCliqueAcaoColetor(event) {
  const botao = event.target.closest('[data-acao-coletor]');
  if (!botao) return;

  event.preventDefault();
  event.stopPropagation();

  const acao = botao.dataset.acaoColetor;
  const coletorId = botao.dataset.coletorId;
  if (!acao || !coletorId || _acoesColetoresEmAndamento.has(coletorId)) return;

  if (acao === 'editar') {
    editarNomeColetor(coletorId);
    return;
  }
  if (acao === 'logout') {
    logoutOperadorColetor(coletorId);
    return;
  }

  const botoesDoColetor = document.querySelectorAll(`[data-coletor-id="${CSS.escape(coletorId)}"]`);
  const textosOriginais = new Map();
  botoesDoColetor.forEach(btn => {
    textosOriginais.set(btn, btn.innerHTML);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  });
  botao.innerHTML = '⏳ Processando…';
  _acoesColetoresEmAndamento.add(coletorId);

  try {
    if (acao === 'aprovar') await aprovarColetor(coletorId);
    else if (acao === 'reprovar') await reprovarColetor(coletorId);
    else if (acao === 'bloquear') await bloquearColetor(coletorId);
    else if (acao === 'desbloquear') await desbloquearColetor(coletorId);
    else if (acao === 'excluir') await excluirColetor(coletorId);
  } catch (error) {
    console.error(`[Coletores] Falha na ação ${acao}:`, error);
  } finally {
    _acoesColetoresEmAndamento.delete(coletorId);
    botoesDoColetor.forEach(btn => {
      if (!btn.isConnected) return;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (textosOriginais.has(btn)) btn.innerHTML = textosOriginais.get(btn);
    });
  }
}

// Busca direta usada pelo botão Atualizar e ao abrir a aba.
async function atualizarAbaColetores() {
  const btn = document.activeElement;
  try {
    if (window.AnalistaFirebaseService?.refreshColetores) {
      await window.AnalistaFirebaseService.refreshColetores();
    } else {
      renderColetores();
    }
  } catch (e) {
    renderColetores();
    if (typeof showToast === 'function') showToast('Não foi possível atualizar os coletores: ' + e.message, 'e');
  }
}
window.atualizarAbaColetores = atualizarAbaColetores;

// ── RENDER PRINCIPAL ─────────────────────────────────────────────────
function renderColetores() {
  inicializarAbaColetores();
  const fInv = document.getElementById('col-sel-inv')?.value || '';
  // Apenas contagens ativas (excluindo estornadas/excluídas)
  let conts = state().contagens.filter(c => !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA');
  if (fInv) conts = conts.filter(c => c.inventario_id === fInv);

  const porOp = {};
  conts.forEach(c => {
    const op = c.operador || 'Desconhecido';
    if (!porOp[op]) porOp[op] = { total:0, divergentes:0, ultima:'', ultimaLeitura:'', enderecos: new Set() };
    porOp[op].total++;
    if (c.divergente === true) porOp[op].divergentes++;
    if (c.timestamp > porOp[op].ultima) { porOp[op].ultima = c.timestamp; porOp[op].ultimaLeitura = c.endereco || '—'; }
    porOp[op].enderecos.add(c.endereco);
  });
  const operadores = Object.entries(porOp).sort((a,b) => b[1].total - a[1].total);

  let cols = state().coletores;
  if (fInv) cols = cols.filter(c => !c.sessao || c.sessao.inventario_id === fInv);

  const online = cols.filter(c => c.status === 'online').length;
  const totalPendentes = cols.reduce((s,c) => s + (c.contagens_pendentes||0), 0);

  const pendAprovacao = state().coletores.filter(c => (c.aprovado||'pendente') === 'pendente').length;
  const bloqueados2   = state().coletores.filter(c => c.aprovado === 'bloqueado').length;
  document.getElementById('col-kpis').innerHTML = `
    <div class="kpi blue"><span class="kpi-icon">📱</span><div class="kpi-val">${state().coletores.length}</div><div class="kpi-lbl">Dispositivos Registrados</div></div>
    <div class="kpi green"><span class="kpi-icon">🟢</span><div class="kpi-val">${online}</div><div class="kpi-lbl">Online Agora</div></div>
    <div class="kpi yellow"><span class="kpi-icon">⏳</span><div class="kpi-val" style="color:${pendAprovacao>0?'#d97706':'inherit'}">${pendAprovacao}</div><div class="kpi-lbl">Aguard. Aprovação</div></div>
    <div class="kpi red"><span class="kpi-icon">🚫</span><div class="kpi-val">${bloqueados2}</div><div class="kpi-lbl">Bloqueados</div></div>
    <div class="kpi purple"><span class="kpi-icon">📋</span><div class="kpi-val">${conts.length.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Total Contagens</div></div>
    <div class="kpi orange"><span class="kpi-icon">⚠️</span><div class="kpi-val">${conts.filter(c=>c.divergente===true).length}</div><div class="kpi-lbl">Com Divergência</div></div>`;

  _renderPainelVisualColetores(cols);
  _renderTabelaColetores(cols);

  // Produtividade por operador — melhorada
  if (!operadores.length) {
    document.getElementById('col-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">👤</div><div class="empty-title">Nenhum operador com contagens</div><div class="empty-sub">As contagens aparecerão aqui conforme os operadores registrarem</div></div>`;
  } else {
    document.getElementById('col-table-wrap').innerHTML = `
      <div class="tbl-wrap"><table>
        <thead><tr>
          <th>Operador</th><th>Coletor Atual</th>
          <th>End. Contados</th><th>Total Contagens</th>
          <th>Rodadas</th><th>Em Conflito</th>
          <th>Prod./hora</th><th>Tempo Médio/end</th>
          <th>Última Atividade</th>
        </tr></thead>
        <tbody>${operadores.map(([op,d])=>{
          const colAtual = state().coletores.find(c => c.sessao?.operador === op && c.status === 'online');
          // Calcular produtividade/hora
          let prodHz = '—', tempoMedio = '—';
          try {
            const allConts = conts.filter(c => (c.operador || 'Desconhecido') === op);
            const timestamps = allConts.map(c => new Date(c.timestamp).getTime()).filter(t => !isNaN(t)).sort();
            if (timestamps.length >= 2) {
              const diffMs = timestamps[timestamps.length-1] - timestamps[0];
              if (diffMs > 60000) {
                const hrs = diffMs / 3600000;
                prodHz = (d.enderecos.size / hrs).toFixed(1) + '/h';
                const avgSec = diffMs / 1000 / d.enderecos.size;
                tempoMedio = avgSec < 60 ? Math.round(avgSec) + 's' : Math.round(avgSec/60) + 'min';
              }
            }
          } catch(e){}
          const recOp = state().recontagens.filter(r => r.operador === op).length;
          return `<tr>
            <td><div style="display:flex;align-items:center;gap:8px">
              <div class="u-avatar" style="width:28px;height:28px;font-size:.72rem;flex-shrink:0">${op[0]?.toUpperCase()||'?'}</div>
              <span style="font-weight:600">${op}</span>
            </div></td>
            <td class="mono">${colAtual ? `🟢 Coletor ${colAtual.numero}` : '<span style="color:var(--muted)">—</span>'}</td>
            <td class="mono" style="font-weight:700">${d.enderecos.size.toLocaleString('pt-BR')}</td>
            <td class="mono">${d.total.toLocaleString('pt-BR')}</td>
            <td class="mono">${recOp}</td>
            <td class="mono" style="color:${d.divergentes>0?'var(--danger)':'var(--muted)'}">${d.divergentes}</td>
            <td class="mono" style="color:var(--accent);font-weight:700">${prodHz}</td>
            <td class="mono">${tempoMedio}</td>
            <td style="font-size:.75rem;color:var(--muted)">${fmtTs(d.ultima)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }
  document.getElementById('col-painel-ultima-atualizacao').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
}

// ── Painel de cards visuais ──────────────────────────────────────────
function _renderPainelVisualColetores(cols) {
  const el = document.getElementById('col-painel-cards');
  if (!cols.length) {
    el.innerHTML = `<div class="empty" style="padding:20px;width:100%">
      <div class="empty-icon">📡</div><div class="empty-title">Nenhum coletor registrado</div>
      <div class="empty-sub">Coletores são registrados automaticamente quando um aparelho acessa o sistema</div>
      <button class="btn btn-warn btn-sm coletor-acao-btn" style="margin-top:12px" onclick="abrirModalSimularColetor()">🧪 Simular acesso de coletor</button>
    </div>`;
    return;
  }
  el.innerHTML = cols.map(col => {
    const isOnline  = col.status === 'online';
    const ap        = col.aprovado || 'pendente';
    const op        = col.sessao;
    const invNomeDisplay = op?.inventario_nome || (op?.inventario_id ? '(inv. ' + op.inventario_id.slice(-6) + ')' : '—');
    const pendentes = col.contagens_pendentes || 0;
    const turnoEncerrado = col.turno_encerrado === true;
    const tempoOnline = isOnline && op ? _calcTempoOnline(op.login_em) : null;
    const apBg    = ap==='aprovado' ? (isOnline?'#f0fdf4':'var(--surface-2)') : (ap==='bloqueado'||ap==='reprovado') ? '#fff5f5' : '#fffbeb';
    const apBord  = ap==='aprovado' ? (isOnline?'var(--success)':'var(--border)') : (ap==='bloqueado'||ap==='reprovado') ? '#fca5a5' : '#fcd34d';
    const apBadge = ap==='aprovado'
      ? `<span style="font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(34,197,94,.12);color:var(--success);font-weight:700">✓ Aprovado</span>`
      : ap==='bloqueado'
      ? `<span style="font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(255,71,87,.12);color:var(--danger);font-weight:700">🚫 Bloqueado</span>`
      : ap==='reprovado'
      ? `<span style="font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(255,71,87,.12);color:var(--danger);font-weight:700">❌ Reprovado</span>`
      : `<span style="font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(251,191,36,.15);color:#d97706;font-weight:700">⏳ Pendente</span>`;
    return `<div class="coletor-card" data-coletor-card="${col.id}" style="
      background:${apBg};
      border:2px solid ${apBord};
      border-radius:14px;padding:14px 16px;min-width:210px;flex:1;max-width:280px;
      box-shadow:${isOnline&&ap==='aprovado'?'0 2px 12px rgba(34,197,94,.15)':'none'};position:relative;
    ">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="width:10px;height:10px;border-radius:50%;background:${isOnline&&ap==='aprovado'?'var(--success)':'#94a3b8'};flex-shrink:0;${isOnline&&ap==='aprovado'?'box-shadow:0 0 0 3px rgba(34,197,94,.25);animation:pulse 2s infinite':''}"></div>
        <span style="font-weight:800;font-size:1rem;font-family:var(--mono)">${col.nome_exibicao || ('Coletor ' + col.numero)}</span>
        ${apBadge}
        ${turnoEncerrado ? `<span style="font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(14,165,233,.15);color:#0ea5e9;font-weight:700;margin-left:4px">🔒 Encerrado</span>` : ''}
        <button data-acao-coletor="editar" data-coletor-id="${col.id}" title="Editar nome" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:.85rem;opacity:.5;padding:2px 4px;flex-shrink:0" title="Renomear">✏️</button>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:.72rem;font-weight:600;color:var(--text);margin-bottom:2px">
          👤 ${col.operador_atual || (op?.operador) || '<span style="color:var(--muted);font-style:italic">Sem operador</span>'}
        </div>
        ${op && ap==='aprovado' ? `
          <div style="font-size:.68rem;color:var(--muted);margin-bottom:2px">🕐 Login: ${new Date(op.login_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
          <div style="font-size:.68rem;color:var(--muted)">📦 ${invNomeDisplay}</div>
        ` : ''}
        ${ap==='pendente' ? '<div style="font-size:.7rem;color:#d97706;margin-top:4px">Aguardando aprovação do analista</div>' : ''}
        ${ap==='bloqueado' ? '<div style="font-size:.7rem;color:var(--danger);margin-top:4px">Acesso bloqueado</div>' : ''}${ap==='reprovado' ? '<div style="font-size:.7rem;color:var(--danger);margin-top:4px">Solicitação reprovada</div>' : ''}
      </div>
      ${ap==='aprovado' ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:5px 10px;text-align:center;flex:1">
          <div style="font-size:.58rem;color:var(--muted);font-weight:700;text-transform:uppercase">Enviadas</div>
          <div style="font-family:var(--mono);font-weight:700;font-size:.9rem">${col.contagens_enviadas||0}</div>
        </div>
        <div style="background:${pendentes>0?'#fef2f2':'#fff'};border:1px solid ${pendentes>0?'#fecaca':'var(--border)'};border-radius:8px;padding:5px 10px;text-align:center;flex:1">
          <div style="font-size:.58rem;color:${pendentes>0?'var(--danger)':'var(--muted)'};font-weight:700;text-transform:uppercase">Pendentes</div>
          <div style="font-family:var(--mono);font-weight:700;font-size:.9rem;color:${pendentes>0?'var(--danger)':'inherit'}">${pendentes}</div>
        </div>
      </div>
      ${isOnline && tempoOnline ? `<div style="font-size:.63rem;color:var(--muted);text-align:center;margin-bottom:6px">⏱ Online há ${tempoOnline}</div>` : ''}
      ` : ''}
      <div style="font-size:.58rem;color:#94a3b8;margin-bottom:8px;word-break:break-all">🔑 ${col.device_id.slice(0,22)}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${ap==='pendente'
          ? `<button class="btn btn-success btn-sm coletor-acao-btn" style="flex:1;font-size:.68rem" data-acao-coletor="aprovar" data-coletor-id="${col.id}">✅ Aprovar</button>
             <button class="btn btn-danger btn-sm coletor-acao-btn" style="font-size:.68rem" data-acao-coletor="reprovar" data-coletor-id="${col.id}">❌ Reprovar</button>`
          : (ap==='bloqueado'||ap==='reprovado')
          ? `<button class="btn btn-success btn-sm coletor-acao-btn" style="flex:1;font-size:.68rem" data-acao-coletor="desbloquear" data-coletor-id="${col.id}">🔓 Desbloquear</button>
             <button class="btn btn-danger btn-sm coletor-acao-btn" style="font-size:.68rem" data-acao-coletor="excluir" data-coletor-id="${col.id}">🗑</button>`
          : `${op && isOnline
              ? `<button class="btn btn-ghost btn-sm coletor-acao-btn" style="flex:1;font-size:.68rem" data-acao-coletor="logout" data-coletor-id="${col.id}">🚪 Logout</button>`
              : `<span style="flex:1"></span>`}
             <button class="btn btn-warn btn-sm coletor-acao-btn" style="font-size:.68rem" data-acao-coletor="bloquear" data-coletor-id="${col.id}">🚫 Bloquear</button>
             <button class="btn btn-danger btn-sm coletor-acao-btn" style="font-size:.68rem" data-acao-coletor="excluir" data-coletor-id="${col.id}">🗑</button>`}
      </div>
    </div>`;
  }).join('') + `
    <div style="border:2px dashed var(--border);border-radius:14px;padding:14px 16px;min-width:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;opacity:.6" onclick="abrirModalSimularColetor()">
      <div style="font-size:1.4rem">📱</div><div style="font-size:.75rem;font-weight:600;text-align:center">Simular novo coletor</div>
    </div>`;
}

function abrirLoginRapidoColetor(colId) {
  abrirModalLoginOperador();
  setTimeout(() => { const s = document.getElementById('lop-coletor-sel'); if(s){s.value=colId; verificarColetorDisponivel();} }, 100);
}

// ── Tabela detalhada ─────────────────────────────────────────────────
function _renderTabelaColetores(cols) {
  const el = document.getElementById('col-cadastro-wrap');
  if (!cols.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📱</div><div class="empty-title">Nenhum dispositivo registrado</div>
      <div class="empty-sub">Os coletores aparecem automaticamente quando um aparelho acessa o sistema</div>
      <button class="btn btn-warn btn-sm coletor-acao-btn" style="margin-top:12px" onclick="abrirModalSimularColetor()">🧪 Simular acesso de coletor</button></div>`;
    return;
  }
  el.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Coletor</th><th>Device ID</th><th>Status</th><th>Operador Logado</th><th>Login</th><th>Inventário</th><th>Últ. Atividade</th><th>Enviadas</th><th>Pendentes</th><th>Ações</th></tr></thead>
    <tbody>${cols.sort((a,b)=>a.numero.localeCompare(b.numero)).map(col => {
      const isOnline = col.status === 'online';
      const op = col.sessao;
      const invNomeDisplay = op?.inventario_nome || (op?.inventario_id ? '(inv. ' + op.inventario_id.slice(-6) + ')' : '—');
      const pendentes = col.contagens_pendentes || 0;
      return `<tr>
        <td><div style="font-weight:800;font-family:var(--mono);font-size:.9rem">${col.nome_exibicao || ('Coletor ' + col.numero)}</div>${col.apelido?`<div style="font-size:.68rem;color:var(--muted)">${col.apelido}</div>`:''}<button data-acao-coletor="editar" data-coletor-id="${col.id}" style="background:none;border:none;cursor:pointer;font-size:.72rem;color:var(--muted);padding:2px 0;margin-top:2px">✏️ renomear</button></td>
        <td><span class="mono" style="font-size:.62rem;color:var(--muted)">${col.device_id.slice(0,18)}…</span></td>
        <td><span class="badge ${(col.aprovado||'pendente')==='aprovado'?(isOnline?'b-green':'b-gray'):(col.aprovado==='bloqueado'?'b-red':'b-yellow')}">${(col.aprovado||'pendente')==='aprovado'?(isOnline?'🟢 Online':'✓ Aprovado'):(col.aprovado==='bloqueado'?'🚫 Bloqueado':'⏳ Pendente')}</span></td>
        <td>${col.operador_atual ? `<div style="font-weight:600;font-size:.82rem">${col.operador_atual}</div>${op?`<div style="font-size:.67rem;color:var(--muted)">Sessão ativa</div>`:''}` : '<span style="color:var(--muted);font-size:.78rem;font-style:italic">Nenhum</span>'}</td>
        <td style="font-size:.73rem;color:var(--muted)">${op?new Date(op.login_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—'}</td>
        <td style="font-size:.78rem">${op?.inventario_nome || '<span style="color:var(--muted)">—</span>'}</td>
        <td style="font-size:.73rem;color:var(--muted)">${col.ultimo_ping?new Date(col.ultimo_ping).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—'}</td>
        <td class="mono" style="text-align:center;font-weight:700">${col.contagens_enviadas||0}</td>
        <td class="mono" style="text-align:center">${pendentes>0?`<span class="badge b-red">${pendentes}</span>`:'0'}</td>
        <td><div style="display:flex;gap:4px">
          ${(col.aprovado||'pendente')==='pendente'
            ? `<button class="btn btn-success btn-sm coletor-acao-btn" style="font-size:.65rem" data-acao-coletor="aprovar" data-coletor-id="${col.id}">✅ Aprovar</button><button class="btn btn-danger btn-sm coletor-acao-btn" style="font-size:.65rem" data-acao-coletor="reprovar" data-coletor-id="${col.id}">❌ Reprovar</button>`
            : (col.aprovado==='bloqueado'||col.aprovado==='reprovado')
            ? `<button class="btn btn-success btn-sm coletor-acao-btn" style="font-size:.65rem" data-acao-coletor="desbloquear" data-coletor-id="${col.id}">🔓 Desbloquear</button>`
            : `${op&&isOnline?`<button class="btn btn-ghost btn-sm coletor-acao-btn" style="font-size:.65rem" data-acao-coletor="logout" data-coletor-id="${col.id}">🚪 Logout</button>`:''}<button class="btn btn-warn btn-sm coletor-acao-btn" style="font-size:.65rem" data-acao-coletor="bloquear" data-coletor-id="${col.id}">🚫</button>`}
          <button class="btn btn-danger btn-sm coletor-acao-btn" style="font-size:.68rem" data-acao-coletor="excluir" data-coletor-id="${col.id}">🗑</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  ${window._filaOffline.length > 0 ? `
    <div class="status-box warn" style="margin:12px 16px">
      <span class="sb-icon">⚠️</span>
      <div><div class="sb-text">${window._filaOffline.length} contagem(ns) aguardando sincronização</div>
      <div class="sb-sub">Salvas localmente. Serão enviadas quando a internet voltar.</div></div>
      <button class="btn btn-primary btn-sm" onclick="sincronizarFilaOffline()">🔄 Sincronizar agora</button>
    </div>` : ''}`;
}

function _calcTempoOnline(horaLogin) {
  if (!horaLogin) return null;
  const diff = Date.now() - new Date(horaLogin).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min/60), m = min%60;
  return `${h}h${m>0?` ${m}min`:''}`;
}

// ── Editar nome do coletor ────────────────────────────────────────────
function editarNomeColetor(colId) {
  const col = state().coletores.find(c => c.id === colId);
  if (!col) return;

  const nomeAtual = col.nome_exibicao || ('Coletor ' + col.numero);

  // Modal inline
  const modal = document.createElement('div');
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;
  modal.innerHTML = `
    <div style="
      background:#fff;border-radius:14px;padding:24px 22px;
      max-width:360px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);
    ">
      <div style="font-weight:800;font-size:1rem;margin-bottom:4px">✏️ Renomear Coletor</div>
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:16px">Número: ${col.numero} · ID: ${col.device_id.slice(0,18)}…</div>
      <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);display:block;margin-bottom:6px">Novo nome</label>
      <input id="modal-nome-coletor-input" type="text" value="${nomeAtual}"
        style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;
               font-size:.95rem;font-family:var(--sans);outline:none;margin-bottom:16px"
        placeholder="Ex: Coletor Câmara Fria"
        onfocus="this.style.borderColor='var(--orange)'"
        onblur="this.style.borderColor='var(--border)'"
      />
      <div style="display:flex;gap:8px">
        <button id="btn-modal-cancelar-nome" style="
          flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);
          background:transparent;color:var(--muted);font-size:.85rem;cursor:pointer;font-family:var(--sans)
        ">Cancelar</button>
        <button id="btn-modal-salvar-nome" style="
          flex:1;padding:10px;border-radius:8px;border:none;
          background:var(--orange);color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;font-family:var(--sans)
        ">💾 Salvar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const input = document.getElementById('modal-nome-coletor-input');
  input.focus();
  input.select();

  const fechar = () => modal.remove();

  document.getElementById('btn-modal-cancelar-nome').onclick = fechar;
  modal.addEventListener('click', e => { if (e.target === modal) fechar(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-modal-salvar-nome').click();
    if (e.key === 'Escape') fechar();
  });

  document.getElementById('btn-modal-salvar-nome').onclick = async () => {
    const novoNome = input.value.trim();
    if (!novoNome) { input.style.borderColor = 'var(--danger)'; input.focus(); return; }

    const btn = document.getElementById('btn-modal-salvar-nome');
    btn.disabled = true;
    btn.textContent = 'Salvando…';

    try {
      // Salvar no Firestore
      await FS_AN.collection('dt_coletores').doc(colId).update({
        nome_exibicao: novoNome,
        nome_coletor:  novoNome,   // compatibilidade com o coletor.html
      });

      // Atualizar DB local
      col.nome_exibicao = novoNome;
      col.nome_coletor  = novoNome;
      salvarDB_coletores();

      fechar();
      renderColetores();
      showToast(`✏️ Coletor renomeado para "${novoNome}"`, 's');
      logAuditoria('SISTEMA', `Coletor ${col.numero} renomeado para "${novoNome}"`, { id: colId });
    } catch(e) {
      // Se offline, salva só local e marca para sync
      col.nome_exibicao = novoNome;
      col.nome_coletor  = novoNome;
      salvarDB_coletores();
      fechar();
      renderColetores();
      showToast(`✏️ Nome salvo localmente (sincronizará quando online)`, 'w');
    }
  };
}

// A Auditoria Operacional pertence exclusivamente ao módulo
// 38-auditoria-operacional-v22.js. Não manter implementações paralelas aqui.
