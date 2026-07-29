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

/** Botão manual para enviar fila (aba STATUS) */
async function enviarFilaManual() {
  if (!navigator.onLine) { toast('📶 Sem internet — contagens salvas localmente no aparelho', 'w'); return; }
  // Busca pendentes do IDB (fonte de verdade)
  const pendentes = await idbGetPendentes();
  if (!pendentes.length) { toast('✅ Nenhuma contagem pendente', 's'); return; }
  const qtd = pendentes.length;
  FILA_ENVIO = pendentes;
  toast(`⬆️ Enviando ${qtd} contagem(ns)…`, 'w');
  await enviarFilaPendente();
  updateStats();
  atualizarFilaStatus();
  const restantes = (await idbGetPendentes()).length;
  if (restantes === 0) toast(`✅ ${qtd} contagem(ns) enviadas com sucesso!`, 's');
  else toast(`⚠️ ${restantes} contagem(ns) ainda pendentes`, 'w');
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
    } catch(e) {}
    el.textContent = n > 0 ? n + ' pendente(s)' : '✓ Tudo enviado';
    el.style.color = n > 0 ? 'var(--warn)' : 'var(--success)';
  }
  // Atualizar também network indicator na tela de inventários
  const net = document.getElementById('net-status');
  if (net) net.textContent = navigator.onLine ? '🔥 Firebase' : '📵 Offline';
  // Manter pill sempre atualizado
  atualizarBarraStatus();
}

// Atualiza indicador a cada 5s
setInterval(atualizarFilaStatus, 5000);

