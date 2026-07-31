// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
function fmtTime(d) {
  return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

// Enter handler — movido para a seção de scanner de hardware acima

// ── Init ──
updateSteps();
// ServiceWorker não necessário — Firebase SDK gerencia offline


// ── Sincronização unificada e silenciosa ────────────────────────────────────
// Contagens e auditorias usam armazenamentos diferentes, mas para o operador
// existe uma única fila lógica. A reconexão apenas dispara os envios; nunca
// recarrega a página e nunca bloqueia a operação atual.
let _syncTudoPromise = null;
async function sincronizarTudoEmSegundoPlano(origem = 'automatico') {
  if (!navigator.onLine) return { contagens: 0, auditorias: 0, offline: true };
  if (_syncTudoPromise) return _syncTudoPromise;

  _syncTudoPromise = (async function(){
    let erros = [];
    try {
      if (typeof idbGetPendentes === 'function' && typeof enviarFilaPendente === 'function') {
        const pendentes = await idbGetPendentes();
        FILA_ENVIO = Array.isArray(pendentes) ? pendentes : [];
        filaSave(FILA_ENVIO);
        if (FILA_ENVIO.length) await enviarFilaPendente();
      }
    } catch (e) { erros.push(e); console.warn('[SYNC] Contagens permanecem pendentes:', e); }

    try {
      if (typeof window.sincronizarFilaAuditoria === 'function') {
        await window.sincronizarFilaAuditoria();
      }
    } catch (e) { erros.push(e); console.warn('[SYNC] Auditorias permanecem pendentes:', e); }

    try { await atualizarFilaStatus(); } catch(e){ console.warn("[Erro tratado]", e); }
    try { if (typeof atualizarBarraStatus === 'function') atualizarBarraStatus(); } catch(e){ console.warn("[Erro tratado]", e); }
    return { origem, erros: erros.length };
  })();

  try { return await _syncTudoPromise; }
  finally { _syncTudoPromise = null; }
}
window.sincronizarTudoEmSegundoPlano = sincronizarTudoEmSegundoPlano;

/** Botão manual para enviar fila (aba STATUS) */
async function enviarFilaManual() {
  if (!navigator.onLine) { toast('📶 Sem internet — os registros continuam salvos no aparelho', 'w'); return; }
  toast('⬆️ Sincronizando contagens e auditorias em segundo plano…', 'w');
  await sincronizarTudoEmSegundoPlano('manual');
  updateStats();
  await atualizarFilaStatus();
  const contagens = typeof idbGetPendentes === 'function' ? (await idbGetPendentes()).length : 0;
  let auditorias = 0;
  try { auditorias = window.DTAuditoriaStorage ? (await window.DTAuditoriaStorage.filaAll()).length : 0; } catch(e){ console.warn("[Erro tratado]", e); }
  const total = contagens + auditorias;
  if (total === 0) toast('✅ Contagens e auditorias enviadas com sucesso!', 's');
  else toast(`⚠️ ${total} registro(s) ainda pendente(s) — nova tentativa será automática`, 'w');
}

/** Atualiza o indicador de fila na aba STATUS */
async function atualizarFilaStatus() {
  const el = document.getElementById('st-fila');
  if (el) {
    // Busca contagem real do IDB
    let n = FILA_ENVIO.length;
    try {
      const pendentes = await idbGetPendentes();
      n = pendentes.length;
      FILA_ENVIO = pendentes;
      filaSave(FILA_ENVIO);
    } catch(e){ console.warn("[Erro tratado]", e); }
    let auditorias = 0;
    try { auditorias = window.DTAuditoriaStorage ? (await window.DTAuditoriaStorage.filaAll()).length : 0; } catch(e){ console.warn("[Erro tratado]", e); }
    const total = n + auditorias;
    el.textContent = total > 0 ? total + ' pendente(s) (' + n + ' contagem(ns), ' + auditorias + ' auditoria(s))' : '✓ Tudo enviado';
    el.style.color = total > 0 ? 'var(--warn)' : 'var(--success)';
  }
  // Atualizar também network indicator na tela de inventários
  const net = document.getElementById('net-status');
  if (net) net.textContent = navigator.onLine ? '🔥 Firebase' : '📵 Offline';
  // Manter pill sempre atualizado
  atualizarBarraStatus();
}

// Atualiza indicador a cada 5s
setInterval(atualizarFilaStatus, 5000);
