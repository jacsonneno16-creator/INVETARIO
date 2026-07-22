function state(){ return window.AnalistaStore.getState(); }
// ── RENDER PRINCIPAL ─────────────────────────────────────────────────
function renderColetores() {
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
      <button class="btn btn-warn btn-sm" style="margin-top:12px" onclick="abrirModalSimularColetor()">🧪 Simular acesso de coletor</button>
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
    const apBg    = ap==='aprovado' ? (isOnline?'#f0fdf4':'var(--surface-2)') : ap==='bloqueado' ? '#fff5f5' : '#fffbeb';
    const apBord  = ap==='aprovado' ? (isOnline?'var(--success)':'var(--border)') : ap==='bloqueado' ? '#fca5a5' : '#fcd34d';
    const apBadge = ap==='aprovado'
      ? `<span style="font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(34,197,94,.12);color:var(--success);font-weight:700">✓ Aprovado</span>`
      : ap==='bloqueado'
      ? `<span style="font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(255,71,87,.12);color:var(--danger);font-weight:700">🚫 Bloqueado</span>`
      : `<span style="font-size:.6rem;padding:2px 7px;border-radius:20px;background:rgba(251,191,36,.15);color:#d97706;font-weight:700">⏳ Pendente</span>`;
    return `<div style="
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
        <button onclick="editarNomeColetor('${col.id}')" title="Editar nome" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:.85rem;opacity:.5;padding:2px 4px;flex-shrink:0" title="Renomear">✏️</button>
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
        ${ap==='bloqueado' ? '<div style="font-size:.7rem;color:var(--danger);margin-top:4px">Acesso bloqueado</div>' : ''}
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
          ? `<button class="btn btn-success btn-sm" style="flex:1;font-size:.68rem" onclick="aprovarColetor('${col.id}')">✅ Aprovar</button>
             <button class="btn btn-danger btn-sm" style="font-size:.68rem" onclick="bloquearColetor('${col.id}')">🚫</button>`
          : ap==='bloqueado'
          ? `<button class="btn btn-success btn-sm" style="flex:1;font-size:.68rem" onclick="aprovarColetor('${col.id}')">✅ Reativar</button>
             <button class="btn btn-danger btn-sm" style="font-size:.68rem" onclick="excluirColetor('${col.id}')">🗑</button>`
          : `${op && isOnline
              ? `<button class="btn btn-ghost btn-sm" style="flex:1;font-size:.68rem" onclick="logoutOperadorColetor('${col.id}')">🚪 Logout</button>`
              : `<span style="flex:1"></span>`}
             <button class="btn btn-warn btn-sm" style="font-size:.68rem" onclick="bloquearColetor('${col.id}')">🚫 Bloquear</button>
             <button class="btn btn-danger btn-sm" style="font-size:.68rem" onclick="excluirColetor('${col.id}')">🗑</button>`}
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
      <button class="btn btn-warn btn-sm" style="margin-top:12px" onclick="abrirModalSimularColetor()">🧪 Simular acesso de coletor</button></div>`;
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
        <td><div style="font-weight:800;font-family:var(--mono);font-size:.9rem">${col.nome_exibicao || ('Coletor ' + col.numero)}</div>${col.apelido?`<div style="font-size:.68rem;color:var(--muted)">${col.apelido}</div>`:''}<button onclick="editarNomeColetor('${col.id}')" style="background:none;border:none;cursor:pointer;font-size:.72rem;color:var(--muted);padding:2px 0;margin-top:2px">✏️ renomear</button></td>
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
            ? `<button class="btn btn-success btn-sm" style="font-size:.65rem" onclick="aprovarColetor('${col.id}')">✅ Aprovar</button><button class="btn btn-danger btn-sm" style="font-size:.65rem" onclick="bloquearColetor('${col.id}')">🚫</button>`
            : col.aprovado==='bloqueado'
            ? `<button class="btn btn-success btn-sm" style="font-size:.65rem" onclick="aprovarColetor('${col.id}')">✅ Reativar</button>`
            : `${op&&isOnline?`<button class="btn btn-ghost btn-sm" style="font-size:.65rem" onclick="logoutOperadorColetor('${col.id}')">🚪 Logout</button>`:''}<button class="btn btn-warn btn-sm" style="font-size:.65rem" onclick="bloquearColetor('${col.id}')">🚫</button>`}
          <button class="btn btn-danger btn-sm" style="font-size:.68rem" onclick="excluirColetor('${col.id}')">🗑</button>
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

(function(){
  // ── Guarda de segurança: expõe processFileAuditoria imediatamente ──
  // Caso o IIFE lance erro antes de chegar na definição real (linha ~748),
  // o input[onchange] do HTML não ficará com ReferenceError.
  window.processFileAuditoria = window.processFileAuditoria || function(file) {
    if (!file) return;
    // Aguarda 300ms para o script terminar de executar e tenta de novo
    setTimeout(function() {
      if (typeof window._processFileAuditoriaReal === 'function') {
        window._processFileAuditoriaReal(file);
      } else {
        if (typeof showToast === 'function') showToast('Módulo de auditoria ainda carregando. Tente novamente.', 'w');
      }
    }, 300);
  };

  window.esc = window.esc || function(s){
    try { return (typeof escapeHTML === 'function') ? escapeHTML(String(s ?? '')) : String(s ?? ''); }
    catch(e){ return String(s ?? ''); }
  };

  const __origStorageSave = window.storageSave;
  if (typeof __origStorageSave === 'function') {
    window.storageSave = function(key, data){
      return __origStorageSave(key, data);
    };
  }

  function __aClean(v){ return String(v == null ? '' : v).replace(/^\uFEFF/, '').replace(/[\r\n]+/g,' ').trim(); }
  function __aAlias(v){ return __aClean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_'); }
  function __aGet(row, aliases){
    const want = new Set((aliases||[]).map(__aAlias));
    for (const k of Object.keys(row||{})) if (want.has(__aAlias(k))) return row[k];
    return '';
  }
  function __aSep(line){
    const s=String(line||'');
    const cands=[';','	',',','|'];
    let best=';', score=-1;
    for (const c of cands){ const n=s.split(c).length; if (n>score){score=n; best=c;} }
    return best;
  }
  function __aCSV(line, sep){
    const out=[]; let cur=''; let q=false;
    line=String(line||'');
    for (let i=0;i<line.length;i++){
      const ch=line[i];
      if (ch==='"'){
        if (q && line[i+1]==='"'){ cur+='"'; i++; }
        else q=!q;
      } else if (ch===sep && !q){ out.push(cur); cur=''; }
      else cur+=ch;
    }
    out.push(cur);
    return out.map(__aClean);
  }
  function __aAddress(row){
    return __aClean(__aGet(row,[
      'endereco_logistico_descritivo','endereco_logistico_key','end_logistico',
      'localizacao','localizacao_estoque','endereco','endereço','codigo_endereco',
      'cod_endereco','cod_end','end','address'
    ])).toUpperCase();
  }
  function __aLocal(row){
    return __aClean(__aGet(row,[
      'descricao_local_estoque','local_de_estoque','local_estoque',
      'deposito','depósito','armazem','armazém','local'
    ]));
  }
  function __aDate(v){
    v = __aClean(v);
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
    return v;
  }
  function __aPick(row, aliases){
    const val = __aGet(row, aliases);
    return __aClean(val);
  }
  function __aIsBarcodeLike(v){ return /^\d{13,14}$/.test(String(v || '').replace(/\D/g,'')); }
  function __aItem(row){
    // Mapeamento da Auditoria por nome de coluna, não por posição.
    // Assim cada dado cai na coluna correta mesmo que a planilha venha reordenada.

    const codigoProduto = __aPick(row,[
      'produto_key','produto_caixa_key','codigo_produto','cod_produto','codigo_item',
      'cod_item','item_key','codigo','código','sku','cod','item'
    ]);

    const descricaoProduto = __aPick(row,[
      'descricao_ficha_estq_detalhe','descricao_produto','desc_produto','nome_produto',
      'produto','descricao_item','descrição_item','descricao','descrição','description','desc',
      'nome_abreviado'
    ]);

    const rawDun = __aPick(row,[
      'dun','dun14','dun_14','cod_dun','codigo_dun','codigo_barras_dun',
      'dun_produto','gtin14','gtin_14','ean14','ean_14',
      'quantidade_dun','qtd_dun','qtde_dun','dun_produto_key'
    ]);

    const rawGtin = __aPick(row,[
      'gtin','ean','ean13','ean_13','barcode','codigo_barras','cod_barras'
    ]);

    const capaPalete = __aPick(row,[
      'palete_key','palete','pallet_key','capa_palete','capa','capa_pallet',
      'pallete_ou_capa','pallete','pallet','numero_palete','num_palete'
    ]);

    const dataValidade = __aDate(__aGet(row,[
      'data_de_validade','data_validade','validade','dt_validade','vencimento',
      'data','dt','bb'
    ]));

    const rawQtd = __aPick(row,[
      'estoque_total_unidades','estoque_unidades','total_unidades_estoque',
      'quantidade_enderecada','qtd_enderecada','quantidade_estoque','qtd_estoque',
      'quantidade_esperada','qtd_esperada','saldo_estoque','saldo','saldo_erp',
      'qtd_sistema','estoque_total','total_unidades','quantidade','qtd','qtde','qty',
      'estoque'
    ]);

    const codigoPareceDun = __aIsBarcodeLike(codigoProduto);
    const qtdPareceDun = __aIsBarcodeLike(rawQtd);
    const dunFinal = rawDun || (codigoPareceDun ? codigoProduto : '');
    const gtinFinal = (!dunFinal && rawGtin && !codigoPareceDun) ? rawGtin : rawGtin;
    const capaFinal = (dunFinal && capaPalete.replace(/\s/g,'') === dunFinal.replace(/\s/g,'')) ? '' : capaPalete;
    const qtdFinal = qtdPareceDun ? '' : rawQtd;

    return {
      codigo_produto: codigoPareceDun ? '' : codigoProduto,
      produto_nome: descricaoProduto,
      gtin: gtinFinal,
      capa_palete: capaFinal,
      data: dataValidade,
      dun: dunFinal,
      quantidade_estoque: qtdFinal,
      quantidade: qtdFinal,
      quantidade_dun: qtdFinal
    };
  }
  function __aSig(items){
    const norm = window._audNorm || (v=>String(v||'').trim().toUpperCase());
    return (items||[]).map(it => [norm(it.codigo_produto), norm(it.produto_nome), norm(it.dun), norm(it.capa_palete), norm(it.data), String((it.quantidade || it.quantidade_dun)||'').trim()].join('|')).sort().join('||');
  }
  function __aRua(row, endereco, endCad){
    const direta = __aClean(__aGet(row,['rua','logradouro','setor_armazenagem','descricao_setor_armazenagem','corredor']));
    if (direta) return direta;
    if (endCad && endCad.rua) return __aClean(endCad.rua);
    const end = __aClean(endereco).toUpperCase();
    const parts = end.split('.').filter(Boolean);
    if (parts.length >= 4) return parts[3];
    if (parts.length >= 2) return parts[1];
    return '';
  }
  function __aGroup(rows, info){
    const normEnd = window._audEnderecoNorm || (v=>String(v||'').replace(/[^A-Z0-9]/g,''));
    const lista = [];

    (rows||[]).forEach((r, idx)=>{
      const endereco = __aAddress(r);
      const endNorm = normEnd(endereco);
      if (!endNorm) return;

      const endCad = (state().enderecosLista || []).find(e => normEnd(e.endereco)===endNorm) || {};
      const item = __aItem(r);

      // IMPORTANTE:
      // A auditoria deve gerar uma linha por produto.
      // Mesmo que o endereço se repita, não agrupamos vários produtos
      // dentro do mesmo registro/endereço, porque a tela deve exibir
      // o endereço novamente para cada produto.
      const prodKey = [
        item.codigo_produto,
        item.produto_nome,
        item.dun,
        item.capa_palete,
        item.data,
        item.quantidade_estoque || item.quantidade_dun,
        idx
      ].map(v => String(v || '').replace(/[^A-Z0-9]/gi,'').toUpperCase()).join('__');

      lista.push({
        id: `${info.auditoria_id}__${endNorm}__${prodKey || idx}`,
        auditoria_id: info.auditoria_id,
        auditoria_nome: info.auditoria_nome,

        endereco,
        endereco_norm:endNorm,
        rua: __aRua(r, endereco, endCad),
        itens: [item],
        itens_confirmados: [],
        status:'PENDENTE',
        importado_em: new Date().toISOString(),
        importado_por: window._currentAnalistaUser?.email || 'analista',
        batch_id: window.audBatchId,
        confirmado_em:'',
        confirmado_por:'',
        com_ajuste:false,
        reaberto_por_alteracao_base:false,
        liberada_coletor:false,
        disponivel_coletor:false,
        origem:'IMPORTACAO_AUDITORIA_STANDALONE',
        local_estoque_auditoria: __aLocal(r)
      });
    });

    return lista.map(g => ({...g, assinatura_base: __aSig(g.itens)}));
  }

  window._audFormatRua = function(row, endCad, endereco){ return __aRua(row, endereco, endCad); };
  window._audGetLocalEstoque = function(row){ return __aLocal(row); };
  window._audRowsFiltradasPorLocal = function(rows){
    const filtro = document.getElementById('aud-op-local-estoque')?.value || '';
    return !filtro ? (rows||[]) : (rows||[]).filter(r => __aLocal(r) === filtro);
  };
  window._audMontarSelectLocal = function(rows){
    const sel = document.getElementById('aud-op-local-estoque');
    if (!sel) return;
    const atual = sel.value || '';
    const locais = [...new Set((rows||[]).map(__aLocal).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
    sel.innerHTML = '<option value="">Todos</option>' + locais.map(v => `<option value="${String(v).replace(/"/g,'&quot;')}">${window.esc(v)}</option>`).join('');
    if (atual && locais.includes(atual)) sel.value = atual;
  };

  const esc2 = function(v){ return window.esc(v == null ? '' : String(v)); };
  const statusLabel = function(st){
    const s = String(st || 'PENDENTE').trim().toUpperCase();
    if (s === 'CONFIRMADO_SEM_AJUSTE') return 'Confirmado';
    if (s === 'CONFIRMADO_COM_AJUSTE') return 'Confirmado c/ ajuste';
    if (s === 'REABERTO_ALTERACAO_BASE') return 'Reaberto';
    if (s === 'LIBERADA' || s === 'LIBERADO') return 'Liberada';
    return 'Pendente';
  };
  const statusBadge = function(st){
    const s = String(st || 'PENDENTE').trim().toUpperCase();
    if (s === 'CONFIRMADO_SEM_AJUSTE') return 'b-green';
    if (s === 'CONFIRMADO_COM_AJUSTE') return 'b-yellow';
    if (s === 'REABERTO_ALTERACAO_BASE') return 'b-orange';
    if (s === 'LIBERADA' || s === 'LIBERADO') return 'b-blue';
    return 'b-gray';
  };
  const availableAudits = function(){
    const grupos = new Map();
    (state().auditorias || []).forEach(a => {
      const id = String(a?.auditoria_id || '').trim();
      if (!id) return;
      if (!grupos.has(id)) grupos.set(id, { id, nome: a.auditoria_nome || a.base_arquivo || id, ts: a.importado_em || '' });
    });
    (state().auditoria_metas || []).forEach(m => {
      const id = String(m?.auditoria_id || m?.id || '').trim();
      if (!id) return;
      grupos.set(id, { id, nome: m.auditoria_nome || m.nome || id, ts: m.importado_em || m.updated_at || '' });
    });
    (state().auditoria_imports || []).forEach(i => {
      const id = String(i?.auditoria_id || '').trim();
      if (!id) return;
      if (!grupos.has(id)) grupos.set(id, { id, nome: i.auditoria_nome || i.arquivo || id, ts: i.importado_em || '' });
    });
    return [...grupos.values()].sort((a,b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  };
  const auditId = function(){
    const selVal = String(document.getElementById('aud-op-auditoria')?.value || '').trim();
    if (selVal) return selVal;
    const savedVal = String(window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '').trim();
    if (savedVal) return savedVal;
    const manual = String(window.__auditoriaNomeManual || '').trim();
    if (manual) return manual;
    return 'AUD-' + Date.now();
  };
  const auditName = function(){
    const sel = document.getElementById('aud-op-auditoria');
    const txt = String(sel?.selectedOptions?.[0]?.textContent || '').trim();
    if (txt && txt !== 'Selecione…') return txt;
    const saved = String(window.__auditoriaNomeManual || window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '').trim();
    if (saved) return saved;
    return auditId();
  };
  const selectedLocalRows = function(rows){
    return window._audRowsFiltradasPorLocal(Array.isArray(rows) ? rows : []);
  };
  const groupRows = function(rows, info){
    return __aGroup(Array.isArray(rows) ? rows : [], info || {});
  };
  window.mountLocalSelect = function(rows){
    return window._audMontarSelectLocal(Array.isArray(rows) ? rows : []);
  };

  let audBatchId = window.audBatchId || ('AUDBATCH-' + Date.now() + '-' + Math.random().toString(36).slice(2,8).toUpperCase());
  window.audBatchId = audBatchId;

  window._popularSelectAuditorias = function(){
    const sel = document.getElementById('aud-op-auditoria');
    if (!sel) return;
    const atual = sel.value || '';
    const grupos = new Map();
    (state().auditorias || []).forEach(a => {
      const id = String(a.auditoria_id || '').trim();
      if (!id) return;
      if (!grupos.has(id)) grupos.set(id, { id, nome: a.auditoria_nome || a.base_arquivo || id, ts: a.importado_em || '' });
    });
    (state().auditoria_metas || []).forEach(m => {
      const id = String(m.auditoria_id || m.id || '').trim();
      if (!id) return;
      grupos.set(id, { id, nome: m.auditoria_nome || m.nome || id, ts: m.importado_em || m.updated_at || '' });
    });
    (state().auditoria_imports || []).forEach(i => {
      const id = String(i.auditoria_id || '').trim();
      if (!id) return;
      if (!grupos.has(id)) grupos.set(id, { id, nome: i.auditoria_nome || i.arquivo || id, ts: i.importado_em || '' });
    });
    const lista = [...grupos.values()].sort((a,b) => String(b.ts||'').localeCompare(String(a.ts||'')));
    sel.innerHTML = '<option value="">Selecione…</option>' + lista.map(x => `<option value="${x.id}">${window.esc(x.nome || x.id)}</option>`).join('');
    if (atual && [...sel.options].some(o => o.value === atual)) sel.value = atual;
    else if (!sel.value && lista.length === 1) sel.value = lista[0].id;
  };

  let __audImportando = false;

  const AUDITORIA_UI_STATE_KEY = 'dt_auditoria_ui_state_v2';

  function loadAuditoriaUiState(){
    try {
      const raw = localStorage.getItem(AUDITORIA_UI_STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch(e) { return {}; }
  }

  function saveAuditoriaUiState(extra){
    try {
      const base = loadAuditoriaUiState();
      const next = {
        ...base,
        ...extra,
        updated_at: new Date().toISOString()
      };
      localStorage.setItem(AUDITORIA_UI_STATE_KEY, JSON.stringify(next));
      return next;
    } catch(e) { return null; }
  }

  function hydrateAuditoriaUiState(){
    const state = loadAuditoriaUiState();
    if (!window.__ultimaAuditoriaSelecionada && state.auditoria_id) window.__ultimaAuditoriaSelecionada = state.auditoria_id;
    if (!window.__ultimaAuditoriaImportada && state.auditoria_id) window.__ultimaAuditoriaImportada = state.auditoria_id;
    if (!window.__auditoriaNomeManual && state.auditoria_nome) window.__auditoriaNomeManual = state.auditoria_nome;
  }

  async function _deleteCollectionDocs(collRef){
    const snap = await collRef.get();
    if (!snap || snap.empty) return 0;
    let total = 0;
    for (let i = 0; i < snap.docs.length; i += 300) {
      const batch = FS_AN.batch();
      snap.docs.slice(i, i + 300).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      total += Math.min(300, snap.docs.length - i);
    }
    return total;
  }

  function buildAuditoriaMeta(auditoriaId, auditoriaNome, lista, importMeta, extra){
    const rows = Array.isArray(lista) ? lista : [];
    const lojas = [...new Set(rows.map(r => String(r.local_estoque_auditoria || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const ts = new Date().toISOString();
    return {
      auditoria_id: auditoriaId,
      auditoria_nome: auditoriaNome || auditoriaId,
      total_registros: rows.length,
      total_pendentes: rows.filter(r => String(r.status || 'PENDENTE').toUpperCase() === 'PENDENTE').length,
      total_confirmados_sem_ajuste: rows.filter(r => String(r.status || '').toUpperCase() === 'CONFIRMADO_SEM_AJUSTE').length,
      total_confirmados_com_ajuste: rows.filter(r => String(r.status || '').toUpperCase() === 'CONFIRMADO_COM_AJUSTE').length,
      total_reabertos: rows.filter(r => String(r.status || '').toUpperCase() === 'REABERTO_ALTERACAO_BASE').length,
      lojas,
      importado_em: importMeta?.importado_em || rows[0]?.importado_em || ts,
      importado_por: importMeta?.importado_por || rows[0]?.importado_por || (window._currentAnalistaUser?.email || 'analista'),
      arquivo: importMeta?.arquivo || window._auditoriaImportFileName || '',
      origem: importMeta?.origem || rows[0]?.origem || 'IMPORTACAO_AUDITORIA_STANDALONE',
      batch_id: importMeta?.batch_id || window.audBatchId || '',
      base_chunks: Math.ceil(rows.length / 1000) || 0,
      updated_at: ts,
      ...extra
    };
  }

  async function publishAuditoriaToFirestore(lista, importMeta){
    if (!navigator.onLine || typeof FS_AN === 'undefined' || !FS_AN || !Array.isArray(lista) || !lista.length) return false;
    const auditoriaId = String(importMeta?.auditoria_id || lista[0]?.auditoria_id || '').trim();
    if (!auditoriaId) throw new Error('auditoria_id ausente');
    const auditoriaNome = String(importMeta?.auditoria_nome || lista[0]?.auditoria_nome || auditoriaId).trim();
    const audRef = FS_AN.collection('dt_auditorias').doc(auditoriaId);
    const endRef = audRef.collection('enderecos');
    const chunkRef = audRef.collection('base_chunks');

    await audRef.set(buildAuditoriaMeta(auditoriaId, auditoriaNome, lista, importMeta, {
      liberada_coletor: lista.some(x => x.liberada_coletor === true),
      disponivel_coletor: lista.some(x => x.disponivel_coletor !== false)
    }), { merge: true });

    await Promise.all([
      _deleteCollectionDocs(endRef),
      _deleteCollectionDocs(chunkRef)
    ]);

    const chunkSize = 1000;
    for (let i = 0; i < lista.length; i += chunkSize) {
      const fatia = lista.slice(i, i + chunkSize);
      const batch = FS_AN.batch();
      fatia.forEach(item => {
        batch.set(endRef.doc(String(item.id || `${auditoriaId}__${i}`)), {
          ...item,
          auditoria_id: auditoriaId,
          auditoria_nome: auditoriaNome,
          salvo_em: new Date()
        }, { merge: true });
      });
      batch.set(chunkRef.doc(`chunk_${String(i / chunkSize).padStart(4,'0')}`), {
        auditoria_id: auditoriaId,
        auditoria_nome: auditoriaNome,
        parte: i / chunkSize,
        total_partes: Math.ceil(lista.length / chunkSize),
        total_registros: fatia.length,
        dados: fatia,
        salvo_em: new Date()
      }, { merge: true });
      await batch.commit();
    }

    if (importMeta) {
      await FS_AN.collection('dt_auditoria_imports').doc(String(importMeta.id || ('AUDIMP-' + Date.now()))).set({
        ...importMeta,
        salvo_em: new Date()
      }, { merge: true });
    }
    return true;
  }

  async function _listarAuditoriasMeta(limit=50){
    const snap = await FS_AN.collection('dt_auditorias').limit(limit).get();
    return (snap.docs || []).map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async function reloadAuditoriaFromFirestore(preferredAuditoriaId){
    if (!navigator.onLine || typeof FS_AN === 'undefined' || !FS_AN) return false;
    try {
      const auditoriaId = String(preferredAuditoriaId || '').trim();
      let imports = [];
      let metas = [];
      let auditorias = [];

      if (auditoriaId) {
        const [metaSnap, endSnap, impSnap] = await Promise.all([
          FS_AN.collection('dt_auditorias').doc(auditoriaId).get(),
          FS_AN.collection('dt_auditorias').doc(auditoriaId).collection('enderecos').get(),
          FS_AN.collection('dt_auditoria_imports').where('auditoria_id', '==', auditoriaId).limit(20).get().catch(() => ({ docs: [] }))
        ]);
        metas = metaSnap.exists ? [{ id: metaSnap.id, ...metaSnap.data() }] : [];
        auditorias = (endSnap.docs || []).map(doc => ({ id: doc.id, ...doc.data() }));
        imports = (impSnap.docs || []).map(doc => ({ id: doc.id, ...doc.data() }));
      } else {
        const [metaDocs, impSnap] = await Promise.all([
          _listarAuditoriasMeta(50),
          FS_AN.collection('dt_auditoria_imports').limit(50).get().catch(() => ({ docs: [] }))
        ]);
        metas = metaDocs;
        imports = (impSnap.docs || []).map(doc => ({ id: doc.id, ...doc.data() }));
      }

      imports = imports.sort((a,b) => String(b.importado_em || '').localeCompare(String(a.importado_em || '')));
            const atuaisAuditorias = Array.isArray(state().auditorias) ? state().auditorias : [];
      const atuaisImports = Array.isArray(state().auditoria_imports) ? state().auditoria_imports : [];
      const atuaisMetas = Array.isArray(state().auditoria_metas) ? state().auditoria_metas : [];

      if (auditoriaId) {
        const existemDadosRemotos = (auditorias && auditorias.length) || (metas && metas.length) || (imports && imports.length);

        // Não apaga a Auditoria já carregada/local quando o Firestore não retorna dados.
        // Isso preserva bases importadas antes do ajuste ou quando o usuário está offline/sem sync completo.
        if (!existemDadosRemotos) {
          console.warn('[AUDITORIA] Nenhum dado remoto encontrado; mantendo auditoria local carregada:', auditoriaId);
          window.__ultimaAuditoriaSelecionada = auditoriaId;
          window.__ultimaAuditoriaImportada = auditoriaId;
          saveAuditoriaUiState({
            auditoria_id: auditoriaId,
            auditoria_nome: window.__auditoriaNomeManual || '',
            ultimo_sync_em: new Date().toISOString()
          });
          return false;
        }

        window.AnalistaState.batch([
          window.AnalistaActions.replaceSlice('auditorias', [
            ...atuaisAuditorias.filter(a => String(a?.auditoria_id || '') !== auditoriaId),
            ...auditorias
          ], { source: 'auditoria-import' }),
          window.AnalistaActions.replaceSlice('auditoria_imports', [
            ...imports,
            ...atuaisImports.filter(i => String(i?.auditoria_id || '') !== auditoriaId)
          ].sort((a,b) => String(b.importado_em || '').localeCompare(String(a.importado_em || ''))), { source: 'auditoria-import' }),
          window.AnalistaActions.replaceSlice('auditoria_metas', [
            ...atuaisMetas.filter(m => String(m?.auditoria_id || m?.id || '') !== auditoriaId),
            ...metas
          ], { source: 'auditoria-import' })
        ]);
        window.__ultimaAuditoriaSelecionada = auditoriaId;
        window.__ultimaAuditoriaImportada = auditoriaId;
      } else {
        window.AnalistaState.batch([
          window.AnalistaActions.replaceSlice('auditoria_imports', imports, { source: 'auditoria-import' }),
          window.AnalistaActions.replaceSlice('auditoria_metas', metas, { source: 'auditoria-import' }),
          window.AnalistaActions.replaceSlice('auditorias', Array.isArray(state().auditorias) ? state().auditorias : [], { source: 'auditoria-import' })
        ]);
      }

      saveAuditoriaUiState({
        auditoria_id: auditoriaId || window.__ultimaAuditoriaSelecionada || '',
        auditoria_nome: window.__auditoriaNomeManual || '',
        ultimo_sync_em: new Date().toISOString()
      });
      return true;
    } catch(e) {
      console.warn('[AUDITORIA] Falha ao recarregar Firestore:', e?.message || e);
      return false;
    }
  }

  function __parseCsvRows(text){
    const lines = String(text || '').split(/\r?\n/).filter(l => String(l).trim());
    if (!lines.length) return [];
    const sep = __aSep(lines[0]);
    const header = __aCSV(lines.shift(), sep);
    return lines.map(line => {
      const cols = __aCSV(line, sep);
      const row = {};
      header.forEach((h, i) => row[String(h || '').trim()] = cols[i] ?? '');
      return row;
    });
  }

  async function __readRowsFromFile(file){
    const name = String(file?.name || '').toLowerCase();
    if (!file) return [];
    if (name.endsWith('.csv')) {
      const text = await file.text();
      return __parseCsvRows(text);
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type:'array', cellDates:true, raw:false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
  }

  window.processFileAuditoria = window._processFileAuditoriaReal = async function(file){
    if (!file) return;
    if (__audImportando) return;
    __audImportando = true;
    try {
      const rows = await __readRowsFromFile(file);
      if (!Array.isArray(rows) || !rows.length) {
        showToast('Arquivo sem linhas válidas para auditoria', 'w');
        return;
      }
      window._auditoriaImportPreview = rows;
      window._auditoriaImportFileName = file.name || 'auditoria';
      if (!window.__auditoriaNomeManual) window.__auditoriaNomeManual = String(file.name || 'Auditoria').replace(/\.[^.]+$/, '');
      if (typeof window.mountLocalSelect === 'function') window.mountLocalSelect(rows);
      const status = document.getElementById('auditoria-import-status');
      if (status) {
        const locais = [...new Set(rows.map(r => __aLocal(r)).filter(Boolean))];
        status.innerHTML = `<div class="status-box ok"><div class="sb-icon">📂</div><div><div class="sb-text">Arquivo carregado: ${esc2(file.name || '')}</div><div class="sb-sub">${rows.length} linha(s) · ${locais.length} local(is) identificado(s)</div></div></div>`;
      }
      const actionsPanel = document.getElementById('auditoria-import-actions');
      if (actionsPanel) actionsPanel.style.display = 'flex';
      showToast('Arquivo carregado — processando auditoria...', 's');
      // Confirmar importação automaticamente após carregar o arquivo
      setTimeout(async () => {
        try {
          if (typeof window.confirmarImportAuditoria === 'function') {
            await window.confirmarImportAuditoria();
          }
        } catch(e) {
          console.error('[AUDITORIA] Erro ao confirmar importação automática:', e);
          showToast('Erro ao processar auditoria: ' + (e?.message || e), 'e');
        }
      }, 100);
    } catch(e) {
      console.error('[AUDITORIA] Erro ao ler arquivo:', e);
      showToast('Erro ao ler arquivo da auditoria: ' + (e?.message || e), 'e');
    } finally {
      __audImportando = false;
    }
  };

  window.criarNovaAuditoriaStandalone = function(){
    const nomeAtual = String(window.__auditoriaNomeManual || '').trim();
    const nome = prompt('Nome da nova auditoria:', nomeAtual || `AUD-${new Date().toLocaleString('pt-BR')}`);
    if (nome == null) return;
    const limpo = String(nome || '').trim();
    if (!limpo) { showToast('Informe um nome para a auditoria', 'w'); return; }
    window.__auditoriaNomeManual = limpo;
    window.__ultimaAuditoriaSelecionada = '';
    const input = document.getElementById('auditoria-file');
    if (input) input.click();
  };

  window.exportarAuditoriaOperacional = function(){
    const audId = document.getElementById('aud-op-auditoria')?.value || window.__ultimaAuditoriaSelecionada || '';
    const lista = (state().auditorias || []).filter(a => !audId || String(a.auditoria_id || '') === String(audId));
    if (!lista.length) { showToast('Nenhuma auditoria carregada para exportar', 'w'); return; }
    const rows = [];
    lista.forEach(a => {
      const itens = (a.itens_confirmados?.length ? a.itens_confirmados : a.itens || []);
      if (!itens.length) rows.push({ auditoria_id:a.auditoria_id, auditoria_nome:a.auditoria_nome, rua:a.rua, endereco:a.endereco, status:a.status, confirmado_por:a.confirmado_por, confirmado_em:a.confirmado_em });
      itens.forEach(it => rows.push({
        auditoria_id: a.auditoria_id,
        auditoria_nome: a.auditoria_nome,
        rua: a.rua,
        endereco: a.endereco,
        status: a.status,
        confirmado_por: a.confirmado_por,
        confirmado_em: a.confirmado_em,
        codigo_produto: it.codigo_produto || '',
        produto_nome: it.produto_nome || '',
        dun: it.dun || '',
        capa_palete: it.capa_palete || '',
        data: it.data || '',
        quantidade: it.quantidade || it.quantidade_estoque || it.quantidade_dun || ''
      }));
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
    const nome = String((lista[0]?.auditoria_nome || audId || 'auditoria')).replace(/[^a-z0-9-_]+/gi,'_');
    XLSX.writeFile(wb, `${nome}.xlsx`);
  };
  window.confirmarImportAuditoria = async function(){
    const preview = window._auditoriaImportPreview || [];
    audBatchId = window.audBatchId || audBatchId || ('AUDBATCH-' + Date.now() + '-' + Math.random().toString(36).slice(2,8).toUpperCase());
    window.audBatchId = audBatchId;
    if (!preview.length) { showToast('Importe uma base primeiro', 'w'); return; }
    const auditoria_id = auditId();
    const auditoria_nome = auditName();
    const novosGrupos = groupRows(selectedLocalRows(preview), { auditoria_id, auditoria_nome });
    if (!novosGrupos.length) { showToast('Nenhum endereço válido encontrado na base', 'w'); return; }
    const importMeta = {
      id: typeof gerarId === 'function' ? gerarId('AUDIMP') : ('AUDIMP-' + Date.now()),
      auditoria_id,
      auditoria_nome,
      arquivo: window._auditoriaImportFileName || '',
      total_registros: novosGrupos.length,
      iguais: 0,
      novos: novosGrupos.length,
      alterados: 0,
      reabertos: 0,
      importado_em: new Date().toISOString(),
      importado_por: window._currentAnalistaUser?.email || 'analista',
      origem: 'IMPORTACAO_AUDITORIA_STANDALONE',
      batch_id: window.audBatchId
    };
        window.AnalistaState.batch([
      window.AnalistaActions.replaceSlice('auditorias', [...(state().auditorias || []).filter(a => String(a.auditoria_id || '') !== String(auditoria_id)), ...novosGrupos], { source: 'auditoria-standalone-import' }),
      window.AnalistaActions.replaceSlice('auditoria_imports', [importMeta, ...(state().auditoria_imports || []).filter(i => String(i.id || '') !== String(importMeta.id))], { source: 'auditoria-standalone-import' })
    ]);
    window.__ultimaAuditoriaImportada = auditoria_id;
    window.__ultimaAuditoriaSelecionada = auditoria_id;
    window.__auditoriaNomeManual = auditoria_nome;
    saveAuditoriaUiState({ auditoria_id, auditoria_nome, ultimo_import_em: importMeta.importado_em });
    await publishAuditoriaToFirestore(novosGrupos, importMeta);
    await reloadAuditoriaFromFirestore(auditoria_id).catch(() => false);
    if (typeof _popularSelectAuditorias === 'function') _popularSelectAuditorias();
    const sel = document.getElementById('aud-op-auditoria');
    if (sel) sel.value = auditoria_id;
    const status = document.getElementById('auditoria-import-status');
    if (status) status.innerHTML = `<div class="status-box ok"><div class="sb-icon">✅</div><div><div class="sb-text">Base da auditoria importada com sucesso</div><div class="sb-sub">${novosGrupos.length} linha(s)/produto(s) em ${esc2(auditoria_nome)}</div></div></div>`;
    const actionsPanel = document.getElementById('auditoria-import-actions');
    if (actionsPanel) actionsPanel.style.display = 'none';
    if (typeof renderAuditoriaOperacional === 'function') renderAuditoriaOperacional();
    if (typeof renderRastreabilidade === 'function') renderRastreabilidade();
    showToast('✅ Base da auditoria importada', 's');
  };

  window.liberarAuditoriaColetores = async function(){
    const lista = availableAudits();
    let auditoriaId = document.getElementById('aud-op-auditoria')?.value || window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '';
    if (!auditoriaId && lista.length === 1) auditoriaId = lista[0].id;
    if (!auditoriaId) { showToast('Selecione uma auditoria', 'w'); return; }
    const itens = (state().auditorias || []).filter(a => String(a.auditoria_id || '') === String(auditoriaId)).map(a => {
      const disp = !['CONFIRMADO_SEM_AJUSTE','CONFIRMADO_COM_AJUSTE'].includes(String(a.status || '').toUpperCase());
      return { ...a, liberada_coletor:true, disponivel_coletor:disp };
    });
    if (!itens.length) { showToast('Essa auditoria não possui endereços para liberação', 'w'); return; }
    window.AnalistaState.replaceSlice('auditorias', (state().auditorias || []).map(a => String(a.auditoria_id || '') === String(auditoriaId) ? (itens.find(x => x.id === a.id) || a) : a), { source: 'liberarAuditoriaColetores' });
    window.__ultimaAuditoriaSelecionada = auditoriaId;
    window.__ultimaAuditoriaImportada = auditoriaId;
    saveAuditoriaUiState({ auditoria_id: auditoriaId, auditoria_nome: (itens[0]?.auditoria_nome || ''), ultima_liberacao_em: new Date().toISOString() });
    await publishAuditoriaToFirestore(itens, null);
    await reloadAuditoriaFromFirestore(auditoriaId).catch(() => false);
    try { if (typeof logSistema === 'function') logSistema('LIBERACAO', 'Auditoria liberada para os coletores', { auditoria_id: auditoriaId, registros: itens.length }); } catch(e) {}
    if (typeof renderAuditoriaOperacional === 'function') renderAuditoriaOperacional();
    showToast('📲 Auditoria liberada para os coletores', 's');
  };

  window.renderAuditoriaOperacional = function(){
    updateStaticTexts();
    if (typeof window._popularSelectAuditorias === 'function') window._popularSelectAuditorias();
    const audId = document.getElementById('aud-op-auditoria')?.value || '';
    const fStatus = document.getElementById('aud-op-status')?.value || '';
    const busca = String(document.getElementById('aud-op-busca')?.value || '').trim().toLowerCase();
    let todos = (state().auditorias || []).filter(a => !audId || String(a.auditoria_id || '') === String(audId));
    if (fStatus) todos = todos.filter(a => String(a.status || '').toUpperCase() === String(fStatus).toUpperCase());
    if (busca) {
      todos = todos.filter(a => [a.auditoria_nome, a.rua, a.endereco, a.confirmado_por, ...(a.itens||[]).flatMap(i => [i.produto_nome, i.codigo_produto, i.gtin, i.capa_palete, i.data, i.quantidade_dun])].join(' ').toLowerCase().includes(busca));
    }
    todos.sort((a,b) => String(a.rua || '').localeCompare(String(b.rua || '')) || String(a.endereco || '').localeCompare(String(b.endereco || '')));
    const setTxt = (id,val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    setTxt('audop-k-total', todos.length);
    setTxt('audop-k-pend', todos.filter(a => String(a.status || '').toUpperCase() === 'PENDENTE').length);
    setTxt('audop-k-ok', todos.filter(a => String(a.status || '').toUpperCase() === 'CONFIRMADO_SEM_AJUSTE').length);
    setTxt('audop-k-aj', todos.filter(a => String(a.status || '').toUpperCase() === 'CONFIRMADO_COM_AJUSTE').length);
    setTxt('audop-k-re', todos.filter(a => String(a.status || '').toUpperCase() === 'REABERTO_ALTERACAO_BASE').length);
    const tbody = document.getElementById('auditoria-op-tbody');
    if (tbody) {
      tbody.innerHTML = !todos.length
        ? `<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:18px">Nenhum endereço da auditoria foi encontrado para os filtros atuais.</td></tr>`
        : todos.flatMap(a => {
          const itensOriginais = Array.isArray(a.itens) ? a.itens : [];
          const itensConfirmados = Array.isArray(a.itens_confirmados) ? a.itens_confirmados : [];
          const maxItens = Math.max(itensOriginais.length, itensConfirmados.length, 1);
          const linhasExibir = Array.from({ length: maxItens }, (_, idx) => ({
            base: itensOriginais[idx] || {},
            conf: itensConfirmados[idx] || {}
          }));

          // Rua: segundo segmento do endereço (ex: LOJA.RUA.COL.NIV)
          const endParts = String(a.endereco || '').split('.');
          const ruaExibir = a.rua || (endParts.length >= 2 ? endParts[1] : endParts[0]) || '—';

          // A base antiga gravou alguns campos com nomes trocados
          // (ex.: DUN dentro de quantidade_estoque/quantidade_dun). Por isso
          // a tela normaliza pelo FORMATO do valor antes de imprimir a coluna.
          const onlyDigits = v => String(v ?? '').replace(/\D/g,'');
          const isBar = v => {
            const d = onlyDigits(v);
            // DUN/EAN/GTIN normalmente vem com 12, 13 ou 14 dígitos na base do WMS.
            return d.length >= 12 && d.length <= 14;
          };
          const hasLetters = v => /[A-Za-zÀ-ÿ]/.test(String(v ?? ''));
          const firstVal = (...vals) => vals.map(v => String(v ?? '').trim()).find(v => v && v !== '0') || '';
          const firstText = (...vals) => vals.map(v => String(v ?? '').trim()).find(v => v && hasLetters(v)) || '';
          const firstBarcode = (...vals) => vals.map(v => String(v ?? '').trim()).find(v => v && isBar(v)) || '';
          const firstQtd = (...vals) => vals.map(v => String(v ?? '').trim()).find(v => {
            if (!v || isBar(v)) return false;
            const n = Number(String(v).replace(',', '.'));
            return Number.isFinite(n);
          }) || '';
          const qtdEstoqueDe = (base) => firstQtd(
            base.quantidade_estoque, base.qtd_estoque, base.quantidade_esperada,
            base.qtd_esperada, base.estoque, base.saldo, base.quantidade,
            base.qtd, base.quantidade_dun
          );
          const dunDe = (base, conf) => firstBarcode(
            base.dun, conf.dun, base.gtin, conf.gtin,
            base.quantidade_estoque, base.quantidade_dun, conf.quantidade_dun,
            base.capa_palete, conf.capa_palete, base.codigo_produto, conf.codigo_produto
          );
          const capaDe = (base, conf, dunVal) => {
            const cand = firstVal(conf.capa_palete, conf.capa, base.capa_palete, base.capa, base.palete_key, conf.palete_key);
            if (!cand) return '';
            // Quando a capa veio igual ao DUN/GTIN, não é capa: é coluna trocada.
            if (dunVal && onlyDigits(cand) === onlyDigits(dunVal)) return '';
            // Evita repetir DUN/EAN na coluna Capa.
            if (isBar(cand)) return '';
            return cand;
          };
          const qtdConfirmadaDe = (conf) => firstQtd(
            conf.quantidade_contada, conf.qtd_contada, conf.quantidade, conf.qtd,
            conf.qtde, conf.qty, conf.quantidade_dun
          );

          // Qtd. Contada: primeiro usa contagens reais; se não houver, usa o valor confirmado na auditoria.
          const contagens = (state().contagens || []).filter(c =>
            c.endereco && a.endereco &&
            String(c.endereco).toUpperCase().replace(/\s/g,'') === String(a.endereco).toUpperCase().replace(/\s/g,'') &&
            !c._excluida && c.status !== 'ESTORNADA'
          );

          return linhasExibir.map(({base, conf}) => {
            const prodNome = firstText(base.produto_nome, base.descricao_produto, base.produto, conf.produto_nome, conf.descricao_produto, conf.produto) || firstVal(base.produto_nome, conf.produto_nome, base.codigo_produto, conf.codigo_produto);
            const codProduto = firstVal(base.codigo_produto, conf.codigo_produto);
            const dataVal = firstVal(conf.data, base.data);
            const dunVal = dunDe(base, conf);
            const capaVal = capaDe(base, conf, dunVal);
            const qtdEstoque = qtdEstoqueDe(base);
            const qtdConfirmada = qtdConfirmadaDe(conf);

            let qtdContadaHtml;
            if (contagens.length > 0) {
              const qtdTotal = contagens.reduce((acc, c) => acc + (parseFloat(c.quantidade) || 0), 0);
              const qtdEstNum = parseFloat(String(qtdEstoque || '').replace(',','.'));
              const cor = (Number.isFinite(qtdEstNum) && qtdEstNum > 0 && qtdTotal !== qtdEstNum) ? 'var(--warning,#f59e0b)' : 'var(--success,#22c55e)';
              qtdContadaHtml = `<span style="font-weight:800;font-size:.9rem;color:${cor}">${qtdTotal}</span><div style="font-size:.63rem;color:var(--muted);margin-top:1px">${contagens.length} contagem(ns)</div>`;
            } else if (qtdConfirmada) {
              const qtdEstNum = parseFloat(String(qtdEstoque || '').replace(',','.'));
              const qtdConfNum = parseFloat(String(qtdConfirmada || '').replace(',','.'));
              const cor = (Number.isFinite(qtdEstNum) && Number.isFinite(qtdConfNum) && qtdEstNum !== qtdConfNum) ? 'var(--warning,#f59e0b)' : 'var(--success,#22c55e)';
              qtdContadaHtml = `<span style="font-weight:800;font-size:.9rem;color:${cor}">${esc2(qtdConfirmada)}</span>`;
            } else {
              qtdContadaHtml = `<span style="color:var(--muted);font-style:italic;font-size:.75rem">Não contado</span>`;
            }

            return `<tr style="${a.liberada_coletor ? 'background:rgba(232,117,26,.03)' : ''}">
              <td style="font-size:.78rem;font-weight:700">${esc2(ruaExibir)}</td>
              <td class="mono" style="font-size:.78rem;font-weight:700;color:var(--text)">${esc2(String(a.endereco || ''))}</td>
              <td><div style="font-size:.78rem;font-weight:600">${esc2((prodNome && !isBar(prodNome)) ? prodNome : '—')}</div>${codProduto && !isBar(codProduto) ? `<div class="mono" style="font-size:.66rem;color:var(--muted);margin-top:2px">${esc2(codProduto)}</div>` : ''}</td>
              <td><div class="mono" style="font-size:.75rem">${esc2(dataVal || '—')}</div></td>
              <td><div class="mono" style="font-size:.75rem">${esc2(capaVal || '—')}</div></td>
              <td><div class="mono" style="font-size:.72rem;color:var(--muted)">${esc2(dunVal || '—')}</div></td>
              <td><div class="mono" style="font-size:.75rem">${esc2(qtdEstoque || '—')}</div></td>
              <td>${qtdContadaHtml}</td>
              <td><span class="badge ${statusBadge(a.status)}">${statusLabel(a.status)}</span>${a.liberada_coletor ? '<div style="font-size:.62rem;color:var(--orange);font-weight:700;margin-top:3px">Liberada</div>' : ''}</td>
              <td style="font-size:.78rem">${esc2(a.confirmado_por || '—')}</td>
            </tr>`;
          });
        }).join('');
    }
    const list = document.getElementById('auditoria-import-list');
    if (list) {
      const hist = (state().auditoria_imports || []).filter(i => !audId || String(i.auditoria_id || '') === String(audId));
      list.innerHTML = hist.length ? hist.slice(0,20).map(i => `<div class="log-item"><div class="log-dot info"></div><div class="log-content"><div class="log-action">${esc2(i.auditoria_nome || i.arquivo || 'base')}</div><div class="log-desc">Importação da auditoria</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><span class="chip">📍 ${i.total_registros || 0} end.</span><span class="chip">🆕 ${i.novos || 0}</span></div></div><div class="log-time">${typeof fmtTs === 'function' ? fmtTs(i.importado_em) : esc2(i.importado_em || '')}</div></div>`).join('') : `<div class="empty" style="padding:18px 10px"><div class="empty-title">Nenhuma importação ainda</div></div>`;
    }
  };

  document.addEventListener('DOMContentLoaded', function(){
    updateStaticTexts();
    hydrateAuditoriaUiState();
    setTimeout(function(){
      try { window.mountLocalSelect(window._auditoriaImportPreview || []); } catch(e) {}
      try { window._popularSelectAuditorias(); } catch(e) {}
      try { window.renderAuditoriaOperacional(); } catch(e) {}
      reloadAuditoriaFromFirestore(window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '').then(function(ok){
        if (!ok) return;
        try { window._popularSelectAuditorias(); } catch(e) {}
        const sel = document.getElementById('aud-op-auditoria');
        const alvo = window.__ultimaAuditoriaSelecionada || window.__ultimaAuditoriaImportada || '';
        if (sel && alvo) sel.value = alvo;
        try { window.renderAuditoriaOperacional(); } catch(e) {}
      });
    }, 0);
  });
})();