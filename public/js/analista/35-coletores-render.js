function state(){ return window.AnalistaStore.getState(); }

let _abaColetoresInicializada = false;
const _acoesColetoresEmAndamento = new Set();

function inicializarAbaColetores() {
  if (_abaColetoresInicializada) return;
  _abaColetoresInicializada = true;

  ['col-cadastro-wrap'].forEach(id => {
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

  if (acao === 'configurar' || acao === 'editar') {
    abrirConfigColetor(coletorId);
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
// BUG AO VIVO REAL (2026-09-14): "os que já tinha cadastrado antes não
// aparecem" — refreshColetores() buscava os dados e atualizava o Store
// certinho, mas essa função só desenhava a tabela (renderColetores) no
// ramo de ERRO. No caminho de sucesso ela só devolvia a Promise, sem
// nunca chamar renderColetores() — a tela ficava vazia mesmo com os 25+
// coletores já carregados no estado. Confirmado reproduzindo com dados
// reais de produção antes de corrigir.
async function atualizarAbaColetores() {
  const btn = document.activeElement;
  try {
    if (window.AnalistaFirebaseService?.refreshColetores) {
      await window.AnalistaFirebaseService.refreshColetores();
    }
    renderColetores();
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

  // Resumo em cards removido por solicitação. A tela passa a abrir direto na lista de dispositivos.

  _renderTabelaColetores(cols);

  // Compatibilidade com versões antigas que ainda possuam o painel de produtividade.
  // Na tela atual o painel foi removido; portanto, nenhum conteúdo é renderizado.
  const colTableWrap = document.getElementById('col-table-wrap');
  if (colTableWrap) {
  if (!operadores.length) {
    colTableWrap.innerHTML = `<div class="empty"><div class="empty-icon">👤</div><div class="empty-title">Nenhum operador com contagens</div><div class="empty-sub">As contagens aparecerão aqui conforme os operadores registrarem</div></div>`;
  } else {
    colTableWrap.innerHTML = `
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
          } catch(e){ console.warn("[Erro tratado]", e); }
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
  }
  document.getElementById('col-painel-ultima-atualizacao').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
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
    <thead><tr><th>Coletor</th><th>Operador Logado</th><th>Inventário</th><th>Contagens</th><th>Últ. Atividade</th><th>Status</th><th>Ações</th></tr></thead>
    <tbody>${cols.sort((a,b)=>a.numero.localeCompare(b.numero)).map(col => {
      const op = col.sessao;
      const pendentes = col.contagens_pendentes || 0;
      const statusInfo = _statusColetor(col);
      return `<tr>
        <td>
          <div style="font-weight:800;font-family:var(--mono);font-size:.9rem">${esc(col.nome_exibicao || ('Coletor ' + col.numero))}</div>
          <div class="mono" style="font-size:.62rem;color:var(--muted)">${col.device_id.slice(0,14)}…</div>
        </td>
        <td>${col.operador_atual ? `<div style="font-weight:600;font-size:.82rem">${esc(col.operador_atual)}</div>${op?`<div style="font-size:.67rem;color:var(--muted)">Sessão ativa</div>`:''}` : '<span style="color:var(--muted);font-size:.78rem;font-style:italic">Nenhum</span>'}</td>
        <td style="font-size:.78rem">${op?.inventario_nome || '<span style="color:var(--muted)">—</span>'}</td>
        <td class="mono" style="text-align:center;font-size:.78rem">${col.contagens_enviadas||0} enviadas${pendentes>0?`<br><span class="badge b-red" style="margin-top:2px;display:inline-block">${pendentes} pendente(s)</span>`:''}</td>
        <td style="font-size:.73rem;color:var(--muted)">${col.ultimo_ping?new Date(col.ultimo_ping).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}</td>
        <td><span class="badge ${statusInfo.classe}">${statusInfo.rotulo}</span></td>
        <td><button class="btn btn-ghost btn-sm coletor-acao-btn" style="font-size:.72rem" data-acao-coletor="configurar" data-coletor-id="${col.id}">⚙️ Configurar</button></td>
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

// ── Status único do coletor (consolida aprovação + turno + online/offline) ──
function _statusColetor(col) {
  const ap = col.aprovado || 'pendente';
  const isOnline = col.status === 'online';
  if (ap === 'bloqueado')  return { rotulo: '🔒 Bloqueado',            classe: 'b-red'    };
  if (ap === 'reprovado')  return { rotulo: '🔒 Reprovado',            classe: 'b-red'    };
  if (ap === 'pendente')   return { rotulo: '⏳ Aguardando aprovação', classe: 'b-yellow' };
  if (col.turno_encerrado) return { rotulo: '🔒 Turno encerrado',      classe: 'b-blue'   };
  if (isOnline)             return { rotulo: '🟢 Online',              classe: 'b-green'  };
  return { rotulo: '⚫ Offline', classe: 'b-gray' };
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

// ── Configurar coletor (renomear + ações contextuais num só lugar) ──────
// Substitui os antigos botões soltos (Aprovar/Reprovar/Bloquear/Excluir…)
// por um único botão "⚙️ Configurar" na tabela, que abre este modal.
function abrirConfigColetor(colId) {
  const col = state().coletores.find(c => c.id === colId);
  if (!col) return;

  const nomeOriginal = col.nome_exibicao || ('Coletor ' + col.numero);
  const nomeAtual = esc(nomeOriginal);
  const ap = col.aprovado || 'pendente';
  const isOnline = col.status === 'online';
  const statusInfo = _statusColetor(col);

  const modal = document.createElement('div');
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;

  // Monta os botões de ação de acordo com o estado atual do coletor.
  let acoesHtml = '';
  if (ap === 'pendente') {
    acoesHtml += `<button class="btn btn-success btn-sm" style="flex:1" data-cfg-acao="aprovar">✅ Aprovar acesso</button>
                  <button class="btn btn-danger btn-sm" style="flex:1" data-cfg-acao="reprovar">❌ Reprovar</button>`;
  } else if (ap === 'bloqueado' || ap === 'reprovado') {
    acoesHtml += `<button class="btn btn-success btn-sm" style="flex:1" data-cfg-acao="desbloquear">🔓 Desbloquear</button>`;
  } else {
    if (col.turno_encerrado) {
      acoesHtml += `<button class="btn btn-success btn-sm" style="flex:1" data-cfg-acao="reabrir">🔓 Reabrir para nova contagem</button>`;
    }
    if (isOnline && col.sessao) {
      acoesHtml += `<button class="btn btn-ghost btn-sm" style="flex:1" data-cfg-acao="logout">🚪 Forçar logout</button>`;
    }
    acoesHtml += `<button class="btn btn-warn btn-sm" style="flex:1" data-cfg-acao="bloquear">🚫 Bloquear</button>`;
  }

  modal.innerHTML = `
    <div style="
      background:#fff;border-radius:14px;padding:24px 22px;
      max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);
    ">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div style="font-weight:800;font-size:1rem">⚙️ Configurar Coletor</div>
        <span class="badge ${statusInfo.classe}" style="margin-left:auto">${statusInfo.rotulo}</span>
      </div>
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:16px">Número: ${col.numero} · ID: ${col.device_id.slice(0,18)}…</div>

      <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);display:block;margin-bottom:6px">Nome do coletor</label>
      <input id="modal-nome-coletor-input" type="text" value="${nomeAtual}"
        style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;
               font-size:.95rem;font-family:var(--sans);outline:none;margin-bottom:14px"
        placeholder="Ex: Coletor Câmara Fria"
        onfocus="this.style.borderColor='var(--orange)'"
        onblur="this.style.borderColor='var(--border)'"
      />
      <button id="btn-modal-salvar-nome" style="
        width:100%;padding:10px;border-radius:8px;border:none;margin-bottom:16px;
        background:var(--orange);color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;font-family:var(--sans)
      ">💾 Salvar nome</button>

      ${acoesHtml ? `
      <div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px">
        <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);display:block;margin-bottom:8px">Acesso do dispositivo</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${acoesHtml}</div>
      </div>` : ''}

      <div style="display:flex;gap:8px">
        <button id="btn-modal-cancelar-nome" style="
          flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);
          background:transparent;color:var(--muted);font-size:.85rem;cursor:pointer;font-family:var(--sans)
        ">Fechar</button>
        <button data-cfg-acao="excluir" style="
          flex:1;padding:10px;border-radius:8px;border:1px solid var(--danger);
          background:transparent;color:var(--danger);font-size:.85rem;font-weight:700;cursor:pointer;font-family:var(--sans)
        ">🗑 Remover coletor</button>
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

  // Extraído pra ser reaproveitado pelos botões de ação (aprovar/reprovar/
  // ...) — BUG AO VIVO REAL relatado pelo usuário: "sempre que pede
  // autorização... eu já coloco um nome novo, ele nunca salva com o nome
  // que eu coloco, só salva quando coloco depois". Causa raiz: o campo de
  // nome e os botões de ação eram DUAS escritas totalmente separadas —
  // clicar em "Aprovar acesso" nunca lia o que estava digitado aqui, só o
  // botão "Salvar nome" fazia isso. Agora qualquer ação de acesso salva
  // primeiro o nome (se foi alterado), na MESMA interação.
  async function salvarNomeSeAlterado() {
    const novoNome = input.value.trim();
    if (!novoNome || novoNome === nomeOriginal) return;
    try {
      await FS_AN.collection('dt_coletores').doc(colId).update({
        nome_exibicao: novoNome,
        nome_coletor:  novoNome,   // compatibilidade com o coletor.html
      });
    } catch (e) { /* offline — segue só com o estado local abaixo */ }
    col.nome_exibicao = novoNome;
    col.nome_coletor  = novoNome;
    salvarDB_coletores();
  }

  document.getElementById('btn-modal-salvar-nome').onclick = async () => {
    const novoNome = input.value.trim();
    if (!novoNome) { input.style.borderColor = 'var(--danger)'; input.focus(); return; }

    const btn = document.getElementById('btn-modal-salvar-nome');
    btn.disabled = true;
    btn.textContent = 'Salvando…';

    try {
      await FS_AN.collection('dt_coletores').doc(colId).update({
        nome_exibicao: novoNome,
        nome_coletor:  novoNome,   // compatibilidade com o coletor.html
      });
      col.nome_exibicao = novoNome;
      col.nome_coletor  = novoNome;
      salvarDB_coletores();
      renderColetores();
      showToast(`✏️ Coletor renomeado para "${novoNome}"`, 's');
      logAuditoria('SISTEMA', `Coletor ${col.numero} renomeado para "${novoNome}"`, { id: colId });
      btn.disabled = false;
      btn.textContent = '💾 Salvar nome';
    } catch(e) {
      // Se offline, salva só local e marca para sync
      col.nome_exibicao = novoNome;
      col.nome_coletor  = novoNome;
      salvarDB_coletores();
      renderColetores();
      showToast(`✏️ Nome salvo localmente (sincronizará quando online)`, 'w');
      btn.disabled = false;
      btn.textContent = '💾 Salvar nome';
    }
  };

  // Ações de acesso (aprovar/reprovar/bloquear/desbloquear/logout/excluir)
  modal.querySelectorAll('[data-cfg-acao]').forEach(btnAcao => {
    btnAcao.addEventListener('click', async () => {
      const acao = btnAcao.dataset.cfgAcao;
      btnAcao.disabled = true;
      const textoOriginal = btnAcao.textContent;
      btnAcao.textContent = '⏳ Processando…';
      try {
        await salvarNomeSeAlterado();
        let resultado = true;
        if (acao === 'aprovar')          resultado = await aprovarColetor(colId);
        else if (acao === 'reprovar')    resultado = await reprovarColetor(colId);
        else if (acao === 'bloquear')    resultado = await bloquearColetor(colId);
        else if (acao === 'desbloquear') resultado = await desbloquearColetor(colId);
        else if (acao === 'reabrir')     resultado = await reabrirTurnoColetor(colId);
        else if (acao === 'logout')      { await logoutOperadorColetor(colId); resultado = true; }
        else if (acao === 'excluir')     resultado = await excluirColetor(colId);
        // Ações com confirm() nativo retornam false quando o usuário cancela.
        if (resultado === false) { btnAcao.disabled = false; btnAcao.textContent = textoOriginal; return; }
        renderColetores();
        fechar();
      } catch (e) {
        btnAcao.disabled = false;
        btnAcao.textContent = textoOriginal;
      }
    });
  });
}

// ── Novo coletor por código (pré-aprovação) ──────────────────────────
// PEDIDO AO VIVO (2026-09-04): "no lugar de ficar entrando no coletor e
// ficar indo no analista aprovar... quero que no analista cadastre o ID do
// coletor e na hora que abrir o aplicativo ele já peça o id pra aprovar, e
// depois fique aprovado" — em vez do Analista precisar esperar o aparelho
// aparecer como "pendente" na tabela pra só então clicar em Aprovar, ele
// gera o código AQUI, ANTES, dá um nome pro aparelho, e passa esse código
// pro operador digitar direto na tela de espera do Coletor (ver
// resgatarCodigoAprovacaoColetor em 02-sync-dispositivo.js) — libera na
// hora, sem outra ida ao painel do Analista.
function abrirModalNovoColetorComCodigo() {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:24px 22px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2)">
      <div style="font-weight:800;font-size:1rem;margin-bottom:4px">➕ Novo Coletor</div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:16px">Dê um nome pro aparelho e gere um código. Passe esse código pro operador digitar na tela de aprovação do Coletor — ele libera o acesso na hora, sem precisar voltar aqui pra aprovar.</div>
      <div id="novocol-form">
        <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);display:block;margin-bottom:6px">Nome do coletor</label>
        <input id="novocol-nome-input" type="text" placeholder="Ex: Coletor Câmara Fria"
          style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.95rem;font-family:var(--sans);outline:none;margin-bottom:14px">
        <button id="novocol-btn-gerar" style="width:100%;padding:10px;border-radius:8px;border:none;background:var(--orange);color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;font-family:var(--sans)">🔑 Gerar código</button>
      </div>
      <div id="novocol-codigo-box" style="display:none;text-align:center;padding:18px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;margin-top:6px">
        <div style="font-size:.7rem;color:#166534;font-weight:700;letter-spacing:.06em">CÓDIGO DE APROVAÇÃO</div>
        <div id="novocol-codigo-valor" style="font-size:1.9rem;font-weight:900;letter-spacing:5px;color:#15803d;font-family:var(--mono,monospace);margin-top:6px"></div>
        <div style="font-size:.72rem;color:#166534;margin-top:8px">Vale só uma vez. Passe pro operador digitar no aparelho.</div>
      </div>
      <div id="novocol-pendentes" style="margin-top:16px"></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="novocol-btn-fechar" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:.85rem;cursor:pointer;font-family:var(--sans)">Fechar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const fechar = () => modal.remove();
  document.getElementById('novocol-btn-fechar').onclick = fechar;
  modal.addEventListener('click', e => { if (e.target === modal) fechar(); });

  async function renderPendentes() {
    const wrap = document.getElementById('novocol-pendentes');
    if (!wrap || !wrap.isConnected) return;
    const lista = await carregarCodigosAprovacaoColetorPendentes();
    if (!lista.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px">Códigos ainda não usados</div>' +
      lista.map(c => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f8fafc;border-radius:8px;margin-bottom:6px">
        <div><b style="font-family:var(--mono,monospace);letter-spacing:2px">${escapeHTML(c.id)}</b> <span style="color:var(--muted);font-size:.76rem">${escapeHTML(c.nome_coletor || '')}</span></div>
        <button class="btn btn-ghost btn-sm" data-novocol-cancelar="${escapeHTML(c.id)}" style="color:var(--danger)">✕</button>
      </div>`).join('');
    wrap.querySelectorAll('[data-novocol-cancelar]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await cancelarCodigoAprovacaoColetor(btn.dataset.novocolCancelar);
        if (ok) renderPendentes();
      });
    });
  }
  renderPendentes();

  document.getElementById('novocol-btn-gerar').onclick = async () => {
    const input = document.getElementById('novocol-nome-input');
    const nome = (input.value || '').trim();
    if (!nome) { input.style.borderColor = 'var(--danger)'; input.focus(); return; }
    const btn = document.getElementById('novocol-btn-gerar');
    btn.disabled = true;
    btn.textContent = 'Gerando…';
    const codigo = await gerarCodigoAprovacaoColetor(nome);
    btn.disabled = false;
    btn.textContent = '🔑 Gerar código';
    if (!codigo) return;
    document.getElementById('novocol-codigo-box').style.display = 'block';
    document.getElementById('novocol-codigo-valor').textContent = codigo;
    input.value = '';
    renderPendentes();
  };
}
window.abrirModalNovoColetorComCodigo = abrirModalNovoColetorComCodigo;


function abrirCadastroColetoresLote() {
  const campo=document.getElementById('coletores-lote-texto');
  const fb=document.getElementById('coletores-lote-feedback');
  if(campo)campo.value='';
  if(fb)fb.textContent='';
  if(typeof openModal==='function') openModal('modal-coletores-lote');
  else { const m=document.getElementById('modal-coletores-lote'); if(m)m.style.display='flex'; }
}

async function cadastrarColetoresLote() {
  const campo=document.getElementById('coletores-lote-texto');
  const fb=document.getElementById('coletores-lote-feedback');
  const nomes=[...new Set(String(campo&&campo.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];
  if(!nomes.length){ if(typeof showToast==='function')showToast('Informe pelo menos um coletor.','w'); return; }
  const resultados=[];
  for(let i=0;i<nomes.length;i++){
    if(fb)fb.textContent='Gerando '+(i+1)+' de '+nomes.length+': '+nomes[i];
    try{
      const codigo=await gerarCodigoAprovacaoColetor(nomes[i]);
      if(!codigo)throw new Error('código não gerado');
      resultados.push({nome:nomes[i],codigo,ok:true});
    }catch(e){resultados.push({nome:nomes[i],erro:e.message||String(e),ok:false});}
  }
  if(fb){
    fb.innerHTML=resultados.map(r=>r.ok
      ? '<div style="padding:6px 0"><b>'+escapeHTML(r.nome)+'</b> — código <span style="font-family:var(--mono);font-weight:900;letter-spacing:2px">'+escapeHTML(r.codigo)+'</span></div>'
      : '<div style="padding:6px 0;color:var(--danger)"><b>'+escapeHTML(r.nome)+'</b> — '+escapeHTML(r.erro)+'</div>').join('');
  }
  const ok=resultados.filter(r=>r.ok).length;
  if(typeof showToast==='function')showToast(ok+' código(s) de coletor gerado(s).','s');
}
window.abrirCadastroColetoresLote=abrirCadastroColetoresLote;
window.cadastrarColetoresLote=cadastrarColetoresLote;

// A Auditoria Operacional pertence exclusivamente ao módulo
// 38-auditoria-operacional-v22.js. Não manter implementações paralelas aqui.
