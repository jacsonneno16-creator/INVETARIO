// ═══════════════════════════════════════════════════
//  SYNC AUTOMÁTICO A CADA 10 MIN EM BACKGROUND
//  Envia fila pendente sem travar o operador
// ═══════════════════════════════════════════════════
let _syncInterval = null;

// ═══════════════════════════════════════════════════
//  IDENTIFICAÇÃO DO DISPOSITIVO (coletor)
//  Estrutura no Firestore: dt_coletores/{device_id}
//  {
//    device_id, apelido, numero,
//    criado_em, ultimo_ping, status,
//    sessao: { operador, email, inventario_id,
//              inventario_nome, login_em } | null
//  }
// ═══════════════════════════════════════════════════

const ST = firebase.firestore.FieldValue.serverTimestamp;
const FV_DELETE = firebase.firestore.FieldValue.delete;

/** Gera fingerprint estável do aparelho (canvas + screen + userAgent).
 *  Mesmo que o localStorage seja limpo, o mesmo aparelho gera o mesmo ID. */
/**
 * IDENTIFICAÇÃO DO APARELHO
 * Regra: 1 aparelho físico = 1 device_id = 1 registro no Firestore.
 *
 * Estratégia de persistência (em ordem de prioridade):
 *   1. localStorage 'dt_device_id'  → fonte principal (sempre lido primeiro)
 *   2. sessionStorage               → fallback se LS bloqueado
 *   3. fingerprint determinístico   → gerado UMA vez se nenhum storage tiver ID
 *
 * O fingerprint combina dados estáveis do hardware/browser para minimizar
 * colisões entre aparelhos diferentes e maximizar estabilidade no mesmo aparelho.
 * Troca de usuário / logout / limpeza de cache NÃO devem mudar o device_id.
 */

const _LS_KEY = 'dt_device_id';
const _SS_KEY = 'dt_device_id_ss';

function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = Math.imul(h, 33) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function _gerarFingerprint() {
  const parts = [];
  // 1. User-Agent (estável no mesmo browser/versão)
  parts.push(navigator.userAgent);
  // 2. Resolução + color depth
  parts.push(screen.width + 'x' + screen.height + ':' + screen.colorDepth);
  // 3. Fuso horário
  try { parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch(e) {}
  // 4. Idioma
  parts.push(navigator.language || '');
  // 5. Número de núcleos lógicos (hardware)
  parts.push(String(navigator.hardwareConcurrency || 0));
  // 6. Canvas fingerprint (rendering engine)
  try {
    const cv = document.createElement('canvas');
    const cx = cv.getContext('2d');
    cx.textBaseline = 'alphabetic';
    cx.font = '16px Arial';
    cx.fillStyle = '#f00';
    cx.fillText('DT_inv', 2, 14);
    cx.fillStyle = 'rgba(0,255,0,0.5)';
    cx.fillRect(2, 0, 30, 5);
    parts.push(cv.toDataURL().slice(-32));
  } catch(e) { parts.push('nocanvas'); }
  // 7. Plugins (browsers desktop)
  try { parts.push(String(navigator.plugins?.length || 0)); } catch(e) {}

  return 'dt_' + _djb2(parts.join('|'));
}

/**
 * Retorna o device_id deste aparelho. ÚNICA função que deve ser chamada.
 * Gera e persiste o ID na primeira vez; nas seguintes, apenas lê do storage.
 */
function obterDeviceId() {
  // 1. Tentar localStorage (persistente entre sessões)
  try {
    let did = localStorage.getItem(_LS_KEY);
    if (did && did.startsWith('dt_')) {
      // Espelhar no sessionStorage como backup
      try { sessionStorage.setItem(_SS_KEY, did); } catch(e) {}
      return did;
    }
  } catch(e) {}

  // 2. Tentar sessionStorage (caso LS bloqueado)
  try {
    let did = sessionStorage.getItem(_SS_KEY);
    if (did && did.startsWith('dt_')) {
      try { localStorage.setItem(_LS_KEY, did); } catch(e) {}
      return did;
    }
  } catch(e) {}

  // 3. Gerar fingerprint e persistir
  const did = _gerarFingerprint();
  try { localStorage.setItem(_LS_KEY, did); } catch(e) {}
  try { sessionStorage.setItem(_SS_KEY, did); } catch(e) {}
  dbg('[DeviceID] Novo ID gerado e salvo:', did);
  return did;
}

/** Obtém o IP público do aparelho via API gratuita */
async function obterIPPublico() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return j.ip || null;
  } catch { return null; }
}

let _heartbeatInterval = null;

/**
 * Registra ou atualiza o aparelho no Firestore após login Firebase bem-sucedido.
 *
 * FLUXO:
 *   Aparelho novo  → cria doc com aprovado='pendente' → retorna 'pendente'
 *   Aprovado       → atualiza operador_atual + ultimo_ping → retorna 'aprovado'
 *   Bloqueado      → não altera nada → retorna 'bloqueado'
 *   Pendente       → não altera nada → retorna 'pendente'
 *
 * GARANTIA: usa o deviceId como chave do documento (doc(deviceId)).
 * Nunca cria mais de um documento para o mesmo aparelho.
 */
async function registrarColetorNoFirestore(operadorInfo) {
  const deviceId = obterDeviceId();
  const ref      = FS.collection(FCOL.coletores).doc(deviceId);

  // O registro não pode depender de serviço externo de IP.
  const ip = null;

  try {
    let snap = await ref.get();

    // Compatibilidade com versões antigas: a aprovação era salva dentro de
    // lojas/{lojaId}/dt_coletores. Se o documento global ainda não existe,
    // procura o mesmo device_id nas lojas permitidas e reaproveita a aprovação.
    if (!snap.exists) {
      try {
        const lojas = Array.isArray(window.DT_LOJAS_USUARIO_ATUAL) ? window.DT_LOJAS_USUARIO_ATUAL : [];
        for (const loja of lojas) {
          const antiga = await window.getDTRawFirestore().collection('lojas').doc(loja.id).collection(FCOL.coletores).doc(deviceId).get();
          if (!antiga.exists) continue;
          const legado = antiga.data() || {};
          if (legado.aprovado === 'aprovado' || legado.status === 'aprovado') {
            await ref.set(Object.assign({}, legado, {
              device_id: deviceId,
              aprovado: 'aprovado',
              status: 'online',
              migrado_aprovacao_global_em: ST()
            }), { merge: true });
            snap = await ref.get();
            break;
          }
          if (legado.aprovado === 'bloqueado') {
            await ref.set(Object.assign({}, legado, {device_id:deviceId, aprovado:'bloqueado'}), {merge:true});
            snap = await ref.get();
            break;
          }
        }
      } catch (compatError) {
        console.warn('[Coletor] Não foi possível consultar aprovação antiga:', compatError.message);
      }
    }

    // ── APARELHO NOVO ────────────────────────────────────────────────────
    if (!snap.exists) {
      // Número provisório estável, sem consultar toda a coleção.
      const numero = deviceId.slice(-4).toUpperCase();

      await ref.set({
        device_id:           deviceId,
        nome_coletor:        'Coletor ' + numero,
        numero:              numero,
        operador_atual:      operadorInfo.name,
        operador_email:      operadorInfo.email || null,
        operador_uid:        operadorInfo.uid || null,
        status:              'pendente',
        aprovado:            'pendente',
        data_registro:       ST(),
        ultimo_ping:         ST(),
        sessao:              null,
        contagens_enviadas:  0,
        contagens_pendentes: 0,
        versao_app:          (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '2.0.0')
      }, { merge: true });

      // IP é enriquecimento opcional e assíncrono; nunca bloqueia o login.
      obterIPPublico().then(v => v && ref.set({ip:v},{merge:true})).catch(()=>{});
      dbg('[Coletor] Novo aparelho registrado como Coletor', numero, '— pendente — ID:', deviceId);
      return 'pendente';
    }

    // ── APARELHO JÁ EXISTE ───────────────────────────────────────────────
    const dados = snap.data();

    if (dados.aprovado === 'bloqueado') {
      console.warn('[Coletor] Aparelho bloqueado — acesso negado.');
      return 'bloqueado';
    }

    if (dados.aprovado !== 'aprovado') {
      // Atualiza operador_atual e ping mesmo estando pendente (analista vê quem tentou)
      await ref.set({ operador_atual: operadorInfo.name, operador_email: operadorInfo.email || null, operador_uid: operadorInfo.uid || null, ultimo_ping: ST() }, {merge:true});
      dbg('[Coletor] Aparelho pendente — acesso aguardando aprovacao.');
      return 'pendente';
    }

    // APROVADO: atualizar operador e sessão (nunca cria novo doc)
    await ref.set({
      operador_atual:   operadorInfo.name,
      ultimo_ping:      ST(),
      status:           'online',
      sessao: {
        operador:        operadorInfo.name,
        email:           operadorInfo.email,
        inventario_id:   APP.inventario?.id    || null,
        inventario_nome: APP.inventario?.nome  || null,
        login_em:        ST(),
      },
    }, { merge: true });
    obterIPPublico().then(v => v && ref.set({ip:v},{merge:true})).catch(()=>{});
    dbg('[Coletor] Sessao atualizada —', operadorInfo.name, '— aprovado — ID:', deviceId);
    return 'aprovado';

  } catch (e) {
    console.warn('[Coletor] registrarColetorNoFirestore falhou:', e.message);
    // Em caso de erro de rede, permitir acesso se já tinha sessão local
    return 'erro';
  }
}


let _aprovacaoListener = null;
function iniciarListenerAprovacaoColetor(operadorInfo) {
  if (_aprovacaoListener) { try { _aprovacaoListener(); } catch(_){} }
  const ref = FS.collection(FCOL.coletores).doc(obterDeviceId());
  _aprovacaoListener = ref.onSnapshot(async snap => {
    if (!snap.exists) return;
    const d = snap.data() || {};
    if (d.aprovado === 'bloqueado') {
      if (typeof _mostrarTelaBloqueado === 'function') _mostrarTelaBloqueado();
      return;
    }
    if (d.aprovado !== 'aprovado') return;
    try {
      await ref.set({status:'online', operador_atual:operadorInfo.name, operador_email:operadorInfo.email, operador_uid:operadorInfo.uid, ultimo_ping:ST()}, {merge:true});
      if (_aprovacaoListener) { _aprovacaoListener(); _aprovacaoListener=null; }
      location.reload();
    } catch(e) { console.error('[Aprovação] Falha ao liberar coletor:', e); }
  }, err => console.error('[Aprovação] Listener:', err));
}
window.iniciarListenerAprovacaoColetor = iniciarListenerAprovacaoColetor;

/**
 * Atualiza apenas o inventário dentro da sessão.
 * Chamado quando o operador seleciona/baixa um inventário.
 */
async function atualizarInventarioColetor() {
  if (!APP.operador) return;
  const deviceId = obterDeviceId();
  try {
    await FS.collection(FCOL.coletores).doc(deviceId).update({
      'sessao.inventario_id':   APP.inventario?.id    || null,
      'sessao.inventario_nome': APP.inventario?.nome  || null,
      ultimo_ping:              ST(),
    });
    dbg('[Coletor] Inventário atualizado:',
                APP.inventario?.nome || '—');
  } catch (e) {
    console.warn('[Coletor] atualizarInventario falhou:', e.message);
  }
}

/**
 * Heartbeat a cada 120s — mantém status online visível no analista (intervalo aumentado para reduzir leituras Firebase).
 * Atualiza também contagens_pendentes para o analista ver a fila.
 */
async function enviarHeartbeat() {
  if (!APP.operador) return;
  const deviceId = obterDeviceId();
  try {
    await FS.collection(FCOL.coletores).doc(deviceId).update({
      ultimo_ping:         ST(),
      status:              'online',
      contagens_pendentes: FILA_ENVIO.length,
    });
  } catch (e) {
    // silencioso — não interrompe operação
  }
}

let _coletorListener = null;

/**
 * Listener em tempo real no documento deste coletor.
 * Detecta bloqueio/remoção feitos pelo analista e desconecta imediatamente.
 */
function iniciarListenerColetor() {
  if (_coletorListener) { _coletorListener(); _coletorListener = null; }
  const deviceId = obterDeviceId();
  try {
    _coletorListener = FS.collection(FCOL.coletores).doc(deviceId)
      .onSnapshot(snap => {
        if (!APP.operador) return; // já deslogado, ignorar
        if (!snap.exists) return;  // doc ainda não existe (primeiro cadastro)
        const dados = snap.data();
        if (!dados) return;

        if (dados.aprovado === 'bloqueado') {
          // Analista bloqueou — forçar logout e mostrar tela de bloqueio
          console.warn('[Coletor] Bloqueado pelo analista em tempo real.');
          AUTH.signOut().catch(() => {});
          APP.operador = null;
          if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
  if (typeof _coletorListener === 'function') { _coletorListener(); _coletorListener = null; }
          if (_coletorListener)   { _coletorListener(); _coletorListener = null; }
          goScreen('login');
          // Mostrar tela vermelha com hora do bloqueio
          const agora = new Date().toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
          const box = document.getElementById('login-bloqueado-box');
          if (box) {
            // Atualizar mensagem com a hora
            const msg = box.querySelector('div[style*="font-size:.78rem"]');
            if (msg) msg.innerHTML = `Este aparelho foi bloqueado pelo analista.<br>Sessão encerrada às <b>${agora}</b>.<br>Entre em contato com o responsável.`;
            box.style.display = 'flex';
          }
        } else if (dados.aprovado === 'pendente') {
          // Analista removeu aprovação (edge case) — forçar logout e tela amarela
          console.warn('[Coletor] Aprovação revogada — retornando para tela de espera.');
          AUTH.signOut().catch(() => {});
          APP.operador = null;
          if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
          if (_coletorListener)   { _coletorListener(); _coletorListener = null; }
          goScreen('login');
          _mostrarTelaAguardandoAprovacao('');
        }
      }, err => {
        console.warn('[ListenerColetor] erro:', err.message);
      });
  } catch(e) {
    console.warn('[ListenerColetor] não iniciado:', e.message);
  }
}

/**
 * Logout: marca offline e limpa APENAS a sessão.
 * O documento do coletor permanece intacto.
 */
async function marcarColetorOffline() {
  const deviceId = obterDeviceId();
  try {
    const updateData = {
      status:      'offline',
      ultimo_ping: ST(),
    };
    // Se o turno foi encerrado, limpamos a sessão no Firebase para o analista ver
    if (APP.turnoEncerrado) {
      updateData.sessao = null;
    }
    await FS.collection(FCOL.coletores).doc(deviceId).update(updateData);
    dbg('[Coletor] Marcado offline.');
  } catch (e) {
    console.warn('[Coletor] marcarOffline falhou:', e.message);
  }
}

/**
 * Encerra o turno do operador: envia tudo, marca como encerrado e faz logout.
 * O analista só consegue fechar o inventário se todos os coletores encerrarem.
 */
async function encerrarTurnoColetor() {
  if (APP.turnoEncerrado) return;

  // ── 1. Verificar contagens pendentes no IDB ──────────────────────────────
  const pendentes = await idbGetPendentes();
  if (pendentes.length > 0) {
    if (!navigator.onLine) {
      toast('⚠️ Sem Conexão: Você possui contagens pendentes. Conecte-se para enviar antes de encerrar.', 'e');
      return;
    }
    toast('Enviando contagens pendentes antes de encerrar...', 'i');
    await enviarFilaPendente();
    const aindaPendentes = await idbGetPendentes();
    if (aindaPendentes.length > 0) {
      toast('Falha ao enviar algumas contagens. Tente novamente.', 'e');
      return;
    }
  }

  // ── 2. Verificar recontagens pendentes ───────────────────────────────────
  const _statusEncerradosRec = ['concluida','sem_divergencia','resolvida','aguardando_analista','cancelada'];
  const recsPendentes = (APP.recontagens || [])
    .filter(r => !_statusEncerradosRec.includes((r.status_recontagem || 'pendente').toLowerCase()));
  if (recsPendentes.length > 0) {
    toast('🚫 Você possui ' + recsPendentes.length + ' recontagem(ns) pendente(s). Finalize todas antes de encerrar o turno.', 'e');
    showView('recontagens', document.getElementById('tab-recontagens'));
    return;
  }

  // ── 3. Confirmação de encerramento ───────────────────────────────────────
  showConfirm('Deseja encerrar seu turno? Após encerrar, você não poderá realizar novas contagens neste inventário.', async () => {
    try {
      APP.turnoEncerrado = true;
      const deviceId = obterDeviceId();
      
      // Marcar no Firebase que este coletor encerrou o turno com sucesso
      await FS.collection(FCOL.coletores).doc(deviceId).update({
        status: 'offline',
        turno_encerrado: true,
        turno_encerrado_em: ST(),
        contagens_pendentes: 0,
        sessao: null
      });

      toast('✅ Turno encerrado com sucesso!', 's');
      setTimeout(() => {
        AUTH.signOut();
        APP.operador = null;
        APP.turnoEncerrado = false; // reset para próximo login
        goScreen('login');
      }, 2000);
    } catch (e) {
      APP.turnoEncerrado = false;
      toast('Erro ao encerrar turno: ' + e.message, 'e');
    }
  }, { title: 'Encerrar Turno', icon: '🔒', okLabel: 'Encerrar Agora', okColor: 'var(--danger)' });
}

function iniciarSyncBackground() {
  // ── Inicializar IDB e migrar dados legados ──────────────────
  idbInit().then(() => {
    // Após IDB pronto, tentar enviar imediatamente se online
    if (navigator.onLine && FILA_ENVIO.length > 0) {
      enviarFilaPendente().catch(() => {});
    }
    atualizarBarraStatus();
  });

  // Heartbeat a cada 5 minutos → analista detecta online/offline
  // [OTIMIZADO] Aumentado de 2 min → 5 min: -60% de escritas de heartbeat.
  // O _coletorListener (onSnapshot no doc do coletor) já cobre bloqueios em tempo real.
  if (_heartbeatInterval) clearInterval(_heartbeatInterval);
  _heartbeatInterval = setInterval(enviarHeartbeat, 300000); // 5 min — era 2 min
  enviarHeartbeat(); // imediato

  // Listener em tempo real — detecta bloqueio/remoção pelo analista instantaneamente
  iniciarListenerColetor();

  // Tenta imediatamente ao entrar online
  window.addEventListener('online', async () => {
    atualizarBarraStatus();
    // ⚠️ Verificar inventário ANTES de enviar a fila.
    // Se o analista fechou o inventário enquanto o operador estava offline,
    // as contagens pendentes não devem ser enviadas (evita poluir inventário fechado).
    await verificarInventarioAtivo();
    if (APP.inventario) {
      enviarFilaPendente().catch(() => {});
    }
  });
  window.addEventListener('offline', () => {
    atualizarBarraStatus();
  });

  // Loop a cada 30 segundos — sync robusto automático
  // [OTIMIZADO] Intervalo aumentado de 10s → 30s: reduz leituras em 3× sem impacto operacional.
  // verificarInventarioAtivo() só ocorre a cada 10 min (20 ciclos × 30s) para não gerar
  // leitura extra a cada envio de fila — o onSnapshot do inventário já cobre atualizações urgentes.
  let _syncCiclo = 0;
  _syncInterval = setInterval(async () => {
    if (navigator.onLine) {
      // Rebuild FILA_ENVIO do IDB antes de cada tentativa
      const pendentes = await idbGetPendentes();
      if (pendentes.length > 0) {
        FILA_ENVIO = pendentes;
        enviarFilaPendente().catch(() => {});
      }
      // Verifica inventário ativo só a cada ~10 min (20 ciclos × 30s)
      _syncCiclo++;
      if (_syncCiclo >= 20) {
        _syncCiclo = 0;
        verificarInventarioAtivo().catch(() => {});
      }
    }
    atualizarBarraStatus(); // mantém UI atualizada
  }, 30 * 1000);  // 30s — era 10s

  // 🔍 Polling a cada 60s para detectar inventários excluídos/encerrados pelo analista
  iniciarListenerInventarios();
}

// ─── Polling de inventários (substitui listener em tempo real) ──────────────
// Troca o onSnapshot por verificação a cada 60s.
// Motivo: o listener dispara em TODOS os 30 aparelhos a cada mudança do analista
// → gera 30 leituras simultâneas por atualização.
// Com polling de 60s: máximo 1 leitura/min/aparelho, mesmo com muitas atualizações.
// Impacto operacional: operador leva até 60s para ver encerramento — aceitável
// porque o analista sempre avisa antes de encerrar (rádio/WhatsApp).
let _invListener    = null;  // mantida para compatibilidade com logout (linha _invListener())
let _invPollInterval = null; // intervalo do polling

function iniciarListenerInventarios() {
  // Cancela polling anterior se existir
  if (_invPollInterval) { clearInterval(_invPollInterval); _invPollInterval = null; }
  // _invListener vira no-op (logout continua chamando _invListener() sem erro)
  _invListener = () => { if (_invPollInterval) { clearInterval(_invPollInterval); _invPollInterval = null; } };

  // Função de poll — executa imediatamente e depois a cada 3 min
  async function _pollInventarios() {
    if (!navigator.onLine || !APP.operador) return;
    // [OTIMIZADO] Se o operador está na tela de coleta (dentro de um inventário),
    // o _syncInterval já chama verificarInventarioAtivo() a cada 10 min.
    // Só faz poll completo quando está na tela de seleção de inventários.
    const screenInv = document.getElementById('screen-inventarios');
    const screenColeta = document.getElementById('screen-coleta') || document.getElementById('screen-app');
    const dentroInventario = APP.inventario && screenColeta && screenColeta.classList.contains('ativo');
    if (dentroInventario) return; // economiza leitura — syncInterval cobre esse caso
    try {
      const snap = await FS.collection(FCOL.inventarios)
        .where('status', '==', 'ATIVO')
        .get();
      const idsAtivos = snap.docs.map(d => d.id);
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      APP.inventariosDisponiveis = lista;
      invCacheSave(lista);
      limparInventariosObsoletos(idsAtivos);
      // Se tela de inventários está visível, re-renderiza
      const screenInv = document.getElementById('screen-inventarios');
      if (screenInv && screenInv.classList.contains('ativo')) {
        renderListaInventarios(lista);
      }
      // Se operador está dentro de um inventário, verifica se ainda está ativo
      if (APP.inventario && !idsAtivos.includes(APP.inventario.id)) {
        toast('⚠️ Este inventário foi encerrado. Retornando à seleção...', 'w');
        APP.inventario = null;
        APP.base       = [];
        setTimeout(() => voltarInventarios(), 2200);
      }
      dbg('[Poll] inventários:', lista.length, 'ativos');
    } catch(e) {
      console.warn('[Poll] Erro ao verificar inventários:', e.message);
    }
  }

  _pollInventarios(); // executa imediatamente ao entrar
  _invPollInterval = setInterval(_pollInventarios, 180 * 1000); // era 60s → 3 min
}

/** Verifica se o inventário atual ainda existe/está ativo no Firestore */
async function verificarInventarioAtivo() {
  if (!APP.inventario || !navigator.onLine) return;
  try {
    const doc = await FS.collection(FCOL.inventarios).doc(APP.inventario.id).get();
    const status = doc.data()?.status;
    if (!doc.exists || status === 'FECHADO' || status === 'Fechado' || status === 'CANCELADO') {
      toast('⚠️ Este inventário foi encerrado ou excluído. Retornando à seleção...', 'w');
      APP.inventario = null;
      APP.base       = [];
      setTimeout(() => voltarInventarios(), 2200);
    }
  } catch(e) {
    console.warn('[verif] Não foi possível verificar inventário:', e.message);
  }
}

/** Envia todas as contagens pendentes em background (não bloqueia UI) */
async function enviarFilaPendente() {
  if (!navigator.onLine) return;

  // Busca pendentes direto do IDB (fonte de verdade)
  const pendentes = await idbGetPendentes();
  if (!pendentes.length) return;

  // ⚠️ Guarda de segurança: não enviar se inventário foi fechado/cancelado
  // (pode ter sido fechado enquanto o operador estava offline)
  const statusInv = (APP.inventario?.status || '').toUpperCase();
  if (APP.inventario && (statusInv === 'FECHADO' || statusInv === 'CANCELADO')) {
    console.warn('[fila] Inventário não está ATIVO (' + statusInv + ') — envio bloqueado.');
    toast('⚠️ Inventário encerrado. Contagens pendentes não enviadas.', 'e');
    return;
  }

  // Bloquear envio se o inventário estiver PAUSADO
  if (APP.inventario && statusInv === 'PAUSADO') {
    console.warn('[fila] Inventário PAUSADO — envio aguardando reativação.');
    toast('⏸ Inventário pausado. O envio será retomado quando for reativado.', 'w');
    return;
  }

  atualizarBarraStatus();

  const enviados = [];
  const falhas   = [];
  let erroConexao = false;

  for (const c of pendentes) {
    if (erroConexao) break;   // abandona lote se conexão caiu no meio

    try {
      // Chave única no Firestore = uuid da contagem (garante idempotência)
      const docId = c.uuid || String(c.id);
      // Rota para a coleção correta: dt_contagens (padrão) ou dt_vazios (VAZIO normal)
      const colecaoDestino = c._destino || FCOL.contagens;
      await FS.collection(colecaoDestino).doc(docId).set({
        ...c,
        dataHora: c.dataHora
          ? (typeof c.dataHora === 'string' ? new Date(c.dataHora) : c.dataHora)
          : new Date(),
        enviado_em:  new Date(),
        status_sync: 'sincronizado',
      });

      // Remove do IDB e marca localmente
      await idbDelete(c.uuid);
      enviados.push(c.uuid || c.id);

    } catch(err) {
      console.warn('[Firebase] Erro ao enviar', c.uuid, err.message);
      falhas.push(c.uuid || c.id);

      // Incrementa tentativas no IDB
      await idbPut({
        ...c,
        tentativas:   (c.tentativas || 0) + 1,
        ultimo_erro:  err.message,
        status_sync:  'pendente',
      });

      if (err.code === 'unavailable' || err.code === 'failed-precondition' ||
          !navigator.onLine || err.message?.includes('network')) {
        erroConexao = true;
      }
    }
  }

  if (enviados.length > 0) {
    // Rebuild FILA_ENVIO do IDB (fonte de verdade)
    FILA_ENVIO = await idbGetPendentes();
    filaSave(FILA_ENVIO);    // espelho LS
    atualizarBarraStatus();
    updateStats();

    // Atualiza doc do coletor no Firestore
    try {
      const deviceId = obterDeviceId();
      FS.collection(FCOL.coletores).doc(deviceId).update({
        contagens_enviadas:  firebase.firestore.FieldValue.increment(enviados.length),
        contagens_pendentes: FILA_ENVIO.length,
        ultimo_ping:         firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    } catch(e) {}

    if (FILA_ENVIO.length === 0) {
      const bar = document.getElementById('sync-bar');
      if (bar) {
        bar.style.display    = 'flex';
        bar.style.background = 'linear-gradient(90deg,#14532d,#166534)';
        const barText = document.getElementById('sync-bar-text');
        if (barText) barText.textContent = `✅ ${enviados.length} contagem(ns) enviadas ao Firebase!`;
        setTimeout(() => { if (bar && FILA_ENVIO.length === 0) bar.style.display = 'none'; }, 3000);
      }
    }
  }
}

/** Adiciona contagem à fila IDB + espelho LS e tenta enviar se online */
async function enfileirarContagem(contagem) {
  // Garantir UUID único para deduplicação
  const uuid   = contagem.uuid || gerarUUID();
  const record = {
    ...contagem,
    uuid,
    status_sync: 'pendente',
    tentativas:  0,
    criado_em:   contagem.criado_em || contagem.dataHora || new Date().toISOString(),
  };

  // Verificar duplicata antes de salvar
  const existe = await idbExists(uuid);
  if (existe) {
    console.warn('[fila] Contagem já existe no IDB, ignorando duplicata:', uuid);
    return;
  }

  // 1️⃣ Salvar no IDB (fonte de verdade — sobrevive a reload e fechamento)
  await idbPut(record);

  // 2️⃣ Atualizar espelho localStorage (backup de emergência)
  FILA_ENVIO = await idbGetPendentes();
  filaSave(FILA_ENVIO);

  // 3️⃣ Atualizar UI imediatamente — operador não espera Firebase
  atualizarBarraStatus();

  // 4️⃣ Tentar enviar em background (sem bloquear o fluxo do operador)
  if (navigator.onLine) {
    enviarFilaPendente().catch(() => {});
  }
}

