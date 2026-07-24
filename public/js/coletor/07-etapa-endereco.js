// ═══════════════════════════════════════════════════
//  ETAPA 1: ENDEREÇO
// ═══════════════════════════════════════════════════
// Timer para auto-avançar quando endereço não encontrado
let _enderecoNaoEncontradoTimer = null;

function onEnderecoInput() {
  const raw = document.getElementById('f-endereco').value;
  const valNorm = _normStr(raw);
  document.getElementById('f-endereco').value = raw.toUpperCase();
  const fb = document.getElementById('fb-endereco');

  if (_enderecoNaoEncontradoTimer) {
    clearTimeout(_enderecoNaoEncontradoTimer);
    _enderecoNaoEncontradoTimer = null;
  }

  // Limpar cache se mudou de endereço
  if (_endVerif && _endVerif.endereco !== valNorm) _endVerif = null;

  // Em modo recontagem: não verificar histórico do Firebase
  if (APP.modoRecontagem) {
    fb.innerHTML = '';
    APP.atual.enderecoValido = true;
    return;
  }

  if (!valNorm) {
    fb.innerHTML = '';
    APP.atual.enderecoValido = false;
    return;
  }

  // ── Verificação rápida local: endereço em recontagem? (resposta imediata) ──
  if (_enderecoEmRecontagem(valNorm)) {
    fb.innerHTML = `<div class="fb err" style="flex-direction:column;align-items:flex-start;gap:3px">
      <b>🔒 Endereço bloqueado para contagem normal</b>
      <span style="font-size:.7rem;opacity:.9">Este endereço tem uma rodada em aberto — use a aba 🔄 RODADAS.</span>
    </div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    APP.atual.enderecoValido = false;
    return;
  }

  if (!APP.base.length) {
    fb.innerHTML = `<div class="fb warn" style="flex-direction:column;align-items:flex-start;gap:6px">
      <b>⚠ Base não carregada</b>
      <span style="font-size:.72rem;opacity:.85">O cadastro de endereços não está na memória. Volte e selecione o inventário novamente para baixar a base.</span>
      <button onclick="voltarInventarios()" style="margin-top:4px;padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer">↩ Recarregar base agora</button>
    </div>`;
    APP.atual.enderecoValido = true;
    _verificarEnderecoFirebase(valNorm);
    return;
  }

  const matches = APP.base.filter(r => r._end === valNorm);
  // Endereço válido se existir na base de produtos OU em dt_locais (locaisAtivos)
  const naLocais = APP.locaisAtivos?.has(valNorm);
  const endValido = matches.length > 0 || naLocais;

  if (endValido) {
    APP.atual._endNorm = valNorm;
    APP.atual.enderecoValido = true;
    document.getElementById('f-endereco').className = 'field field-ok';
    fb.innerHTML = `<div class="fb ok">✓ ${matches.length > 0 ? matches.length + ' produto(s) neste endereço' : 'Endereço confirmado'}</div>`;
    const vaziow = document.getElementById('btn-vazio-wrap');
    if (vaziow) vaziow.style.display = '';
    _verificarEnderecoFirebase(valNorm);
  } else {
    // Endereço não encontrado na base
    APP.atual._endNorm = valNorm;
    APP.atual.enderecoValido = false;

    // Só mostrar erro e bloquear se o endereço tem o formato esperado (NN.NNNN.N.N.N.N.N)
    // Endereços com outro formato podem ser endereços de outra área — avisar mas não bloquear
    const formatoValido = /^\d{2}\.\d{4}(\.\d+){4,6}$/.test(valNorm);
    if (formatoValido) {
      // Cache local pode estar desatualizado — verificar no Firebase antes de bloquear
      fb.innerHTML = `<div class="fb info">🔍 Verificando endereço na base…</div>`;
      const _chkLoc = async () => {
        try {
          // Tentar pelo doc.id (formato mais comum em dt_locais)
          let snap = await FS.collection(FCOL.locais).doc(valNorm).get();
          let naFirebase = snap.exists && snap.data()?.ativo !== false;
          if (!naFirebase) {
            // Tentar pelo campo 'endereco'
            const byField = await FS.collection(FCOL.locais)
              .where('endereco', '==', valNorm).limit(1).get();
            naFirebase = !byField.empty && byField.docs[0].data()?.ativo !== false;
          }
          // Garantir que o campo ainda mostra o mesmo endereço
          const curVal = _normStr(document.getElementById('f-endereco')?.value || '');
          if (curVal !== valNorm) return; // usuário já digitou outro valor
          if (naFirebase) {
            APP.locaisAtivos?.add(valNorm); // atualizar cache local
            APP.atual.enderecoValido = true;
            document.getElementById('f-endereco').className = 'field field-ok';
            fb.innerHTML = `<div class="fb ok">✓ Endereço confirmado</div>`;
            _verificarEnderecoFirebase(valNorm);
          } else {
            APP.atual.enderecoValido = false;
            fb.innerHTML = `<div class="fb err" style="flex-direction:column;align-items:flex-start;gap:3px">
              <b>🚫 Endereço não cadastrado na base</b>
              <span style="font-size:.7rem;opacity:.85">Verifique o endereço e tente novamente.</span>
            </div>`;
            document.getElementById('f-endereco').className = 'field field-err';
            // beep só ao confirmar, não ao digitar
          }
        } catch(e) {
          // Falha na consulta Firebase — não bloquear (benefício da dúvida)
          const curVal = _normStr(document.getElementById('f-endereco')?.value || '');
          if (curVal !== valNorm) return;
          APP.atual.enderecoValido = true;
          fb.innerHTML = `<div class="fb warn">⚠ Não foi possível verificar o endereço. Continue com cautela.</div>`;
        }
      };
      _chkLoc();
    } else {
      // Formato diferente — pode ser endereço de outra área, deixar passar com aviso
      fb.innerHTML = `<div class="fb warn" style="flex-direction:column;align-items:flex-start;gap:3px">
        <b>⚠ Endereço não encontrado na base</b>
        <span style="font-size:.7rem;opacity:.85">Pressione Confirmar para registrar assim mesmo.</span>
      </div>`;
      document.getElementById('f-endereco').className = 'field field-warn';
      APP.atual.enderecoValido = true;
    }
  }
}

/**
 * Consulta o Firebase para verificar se o endereço já foi coletado.
 * Resultado é cacheado em _endVerif para uso em confirmarEndereco().
 */
/**
 * Verifica localmente se um endereço está em recontagem ativa.
 * Checa APP.recontagens e APP.divergenciasAtribuidas (dados carregados do Firestore).
 * Retorna true se o endereço deve ser bloqueado para contagem normal.
 */
/**
 * Retorna true se o endereço está (ou já esteve) em recontagem neste inventário.
 * Uma vez que entra em recontagem, o endereço fica bloqueado para contagem normal
 * permanentemente — só pode ser tratado pelo fluxo de recontagem.
 */
function _enderecoEmRecontagem(endNorm) {
  if (!APP.inventario?.id) return false;
  const nd  = s => String(s || '').trim().toUpperCase();
  const endN = nd(endNorm);
  const invId = APP.inventario.id;

  // Bloquear se existir QUALQUER divergência para este endereço (independente do status)
  // Uma divergência gerada = endereço bloqueado permanentemente para contagem normal
  const temDiv = (APP.divergenciasAtribuidas || []).some(d =>
    nd(d.endereco) === endN && d.inventario_id === invId
  );
  if (temDiv) return true;

  // Bloquear se existir recontagem ativa (pendente/em andamento) para este endereço.
  // Recontagens encerradas (sem_divergencia, resolvida, persistente) não bloqueiam.
  const temRec = (APP.recontagens || []).some(r => {
    if (nd(r.endereco) !== endN || r.inventario_id !== invId) return false;
    const stRec = (r.status_recontagem || '').toLowerCase();
    if (stRec === 'cancelada')       return false;
    if (stRec === 'sem_divergencia') return false;
    const st = (r.status || '').toUpperCase();
    if (st === 'RESOLVIDA' || st === 'PERSISTENTE') return false;
    if (r.divergencia_resolvida === true || r.encerrada_definitivamente === true) return false;
    return true;
  });
  return temRec;
}

async function _verificarEnderecoFirebase(endNorm) {
  if (!APP.inventario?.id) return;
  // Evita consulta duplicada para o mesmo endereço
  // Cache de 5 minutos por endereço — elimina consultas repetidas do mesmo end. na sessão.
  // Seguro porque: a gravação da contagem vai SEMPRE direto ao Firebase (nunca usa cache).
  // O único dado em cache é "quem já contou aqui?" — que não muda em 5 min durante operação.
  const _CACHE_END_TTL = 5 * 60 * 1000; // 5 minutos em ms
  if (_endVerif?.endereco === endNorm && Date.now() - (_endVerif.checkedAt||0) < _CACHE_END_TTL) return;

  try {
    const snap = await FS.collection(FCOL.contagens)
      .where('inventario_id', '==', APP.inventario.id)
      .where('endereco', '==', endNorm)
      .get();

    const docsAtivos = snap.docs
      .map(d => ({ _docId: d.id, ...d.data() }))
      .filter(c => !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA');

    // ── Verificar se o endereço está em recontagem ativa (divergência ou recontagem pendente) ──
    const emRecontagemLocal = _enderecoEmRecontagem(endNorm);

    // Se não temos info local, consultar Firebase
    let emRecontagemFS = false;
    if (!emRecontagemLocal) {
      try {
        const [snapDiv, snapRec] = await Promise.all([
          FS.collection('dt_divergencias')
            .where('inventario_id', '==', APP.inventario.id)
            .where('endereco', '==', endNorm)
            .limit(5)
            .get(),
          FS.collection('dt_recontagens')
            .where('inventario_id', '==', APP.inventario.id)
            .where('endereco', '==', endNorm)
            .limit(5)
            .get(),
        ]);
        // Apenas divergências com fluxo ABERTO bloqueiam o endereço.
        // RESOLVIDA, PERSISTENTE e sem_divergencia liberam o endereço para nova contagem.
        const divAtiva = snapDiv.docs.find(d => {
          const data = d.data();
          const s     = (data.status || '').toUpperCase();
          const bloq  = (data.status_bloqueio || '').toUpperCase();
          const stRec = (data.status_recontagem || '').toLowerCase();
          if (s === 'RESOLVIDA')             return false; // encerrada — não bloqueia
          if (s === 'PERSISTENTE')           return false; // encerrada — não bloqueia
          if (bloq === 'PERSISTENTE_BLOQUEADO') return false;
          if (stRec === 'sem_divergencia')   return false; // resolvida — não bloqueia
          if (data.divergencia_resolvida === true)     return false;
          if (data.encerrada_definitivamente === true) return false;
          return s !== ''; // div aberta/em_recontagem bloqueia
        });
        // Qualquer recontagem não cancelada = bloqueio permanente
        const recAtiva = snapRec.docs.find(d => {
          const sr = (d.data().status_recontagem || '').toLowerCase();
          return sr !== 'cancelada';
        });
        emRecontagemFS = !!(divAtiva || recAtiva);
      } catch(e) { /* se falhar, usar info local */ }
    }

    const bloqueadoRecontagem = emRecontagemLocal || emRecontagemFS;

    const meuNome = APP.operador?.name || '';
    const temVazio = docsAtivos.some(c => c.tipo_contagem === 'VAZIO');
    const docsNaoVazio = docsAtivos.filter(c => c.tipo_contagem !== 'VAZIO');
    const docsMeus   = docsNaoVazio.filter(c => c.operador === meuNome);
    const docsOutros = docsNaoVazio.filter(c => c.operador !== meuNome);

    let status;
    if (bloqueadoRecontagem) status = 'em_recontagem';  // novo status de bloqueio
    else if (temVazio)       status = 'encerrado';
    else if (docsOutros.length > 0) status = 'outro';
    else if (docsMeus.length > 0)  status = 'proprio';
    else                           status = 'livre';

    _endVerif = { endereco: endNorm, status, docs: docsAtivos, docsMeus, docsOutros, checkedAt: Date.now() };

    // Atualizar feedback inline se o campo ainda tem esse endereço
    const fbEl = document.getElementById('fb-endereco');
    const campoVal = _normStr(document.getElementById('f-endereco')?.value || '');
    if (fbEl && campoVal === endNorm) {
      _mostrarFeedbackVerificacao(fbEl, endNorm);
    }
  } catch(err) {
    console.warn('[VerifEnd] Erro na consulta Firebase:', err.message);
    // Em caso de erro, não bloquear — deixa o confirmarEndereco decidir
    _endVerif = { endereco: endNorm, status: 'livre', docs: [], docsMeus: [], docsOutros: [], checkedAt: Date.now() };
  }
}

function _mostrarFeedbackVerificacao(fbEl, endNorm) {
  if (!_endVerif || _endVerif.endereco !== endNorm) return;
  const { status, docsOutros, docsMeus } = _endVerif;

  if (status === 'em_recontagem') {
    fbEl.innerHTML = `<div class="fb err" style="flex-direction:column;align-items:flex-start;gap:3px">
      <b>🔒 Endereço bloqueado para contagem normal</b>
      <span style="font-size:.7rem;opacity:.9">Este endereço tem uma nova rodada solicitada.<br>A contagem normal está bloqueada.<br>Use a aba <b>🔄 RODADAS</b> para tratá-lo.</span>
    </div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    APP.atual.enderecoValido = false;
    // beep só ao confirmar
  } else if (status === 'encerrado') {
    fbEl.innerHTML = `<div class="fb err">
      🚫 Endereço encerrado (vazio confirmado) — estorne na aba ↩️ ESTORNO para liberar
    </div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    APP.atual.enderecoValido = false;
  } else if (status === 'outro') {
    const quem = docsOutros[0]?.operador || 'outro operador';
    fbEl.innerHTML = `<div class="fb err" style="flex-direction:column;align-items:flex-start;gap:3px">
      <b>🚫 Endereço já coletado por <span style="color:var(--warn)">${quem}</span></b>
      <span style="font-size:.7rem;opacity:.85">Somente ${quem} pode estornar esta contagem.</span>
    </div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    APP.atual.enderecoValido = false;
  } else if (status === 'proprio') {
    const qtd = docsMeus.length;
    fbEl.innerHTML = `<div class="fb warn" style="flex-direction:column;align-items:flex-start;gap:3px">
      <b>⚠ Você já contou ${qtd} pallet(s) neste endereço</b>
      <span style="font-size:.7rem;opacity:.85">Confirme para adicionar mais pallets ou escolha 📭 VAZIO para encerrar.</span>
    </div>`;
  }
  // 'livre' — não sobrescreve o feedback padrão
}

/** Confirma endereço sem botão — usado no fluxo auto-avanço (endereço não encontrado na base). */
function confirmarEnderecoSilencioso() {
  const raw = document.getElementById('f-endereco').value;
  if (!raw.trim()) return;
  const valNorm = _normStr(raw);
  const fb = document.getElementById('fb-endereco');

  // Em modo recontagem: sem verificações de histórico — sessão limpa
  if (APP.modoRecontagem) {
    _prosseguirComEndereco(valNorm);
    return;
  }

  const verifAtual = (_endVerif?.endereco === valNorm) ? _endVerif : null;
  const status = verifAtual?.status;

  if (status === 'em_recontagem') {
    fb.innerHTML = `<div class="fb err" style="flex-direction:column;align-items:flex-start;gap:3px">
      <b>🔒 Endereço bloqueado para contagem normal</b>
      <span style="font-size:.7rem;opacity:.9">Use a aba 🔄 RODADAS para tratar este endereço.</span>
    </div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    APP.atual.enderecoValido = false;
    beepErr(); return;
  }
  if (status === 'encerrado') {
    fb.innerHTML = `<div class="fb err">🚫 Endereço encerrado — estorne na aba ↩️ ESTORNO para liberar</div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    return;
  }
  if (status === 'outro') {
    _modalBloqueioOutroOperador(valNorm, verifAtual.docsOutros || []);
    return;
  }
  if (status === 'proprio') {
    _modalOpcoesProprio(valNorm, verifAtual.docsMeus || []);
    return;
  }

  // livre ou sem cache — prosseguir
  const cap = APP.endCapacidade?.[valNorm] || 0;
  APP.atual.capacidadeEnd = cap;
  APP.atual.endereco    = valNorm;
  APP.atual._endNorm    = valNorm;
  APP.atual.somentesDun = valNorm.includes('14.1520');
  APP.atual.step        = 2;
  beepSuave();

  const range = APP.capaRange;
  const hintEl = document.getElementById('cp-proximo-hint');
  if (hintEl) hintEl.textContent = (range?.min && range?.max)
    ? `Range: ${range.min}–${range.max} · Próximo: ${APP.proximoCapa}`
    : 'Próximo disponível: ' + APP.proximoCapa;
  document.getElementById('f-capa').value = '';
  document.getElementById('fb-capa').innerHTML = '';

  updateSteps();
  setTimeout(() => document.getElementById('f-capa').focus(), 100);
}

function confirmarEndereco() {
  const raw = document.getElementById('f-endereco').value;
  if (!raw.trim()) { toast('Informe o endereço', 'e'); return; }

  if (_enderecoNaoEncontradoTimer) {
    clearTimeout(_enderecoNaoEncontradoTimer);
    _enderecoNaoEncontradoTimer = null;
  }

  const valNorm = _normStr(raw);
  const fb = document.getElementById('fb-endereco');

  // ── Modo recontagem: validar endereço esperado ──
  if (APP.modoRecontagem) {
    const esperado = _normStr(APP.modoRecontagem.endereco || '');
    if (valNorm !== esperado) {
      fb.innerHTML = `<div class="fb err">🚫 Endereço incorreto — esperado: <b>${escHTML(APP.modoRecontagem.endereco)}</b></div>`;
      document.getElementById('f-endereco').className = 'field field-err';
      beepErr(); return;
    }
    _prosseguirComEndereco(valNorm);
    return;
  }

  // ── Bloqueio por status do inventário ──
  const statusInv = (APP.inventario?.status || '').toUpperCase();
  if (statusInv === 'PAUSADO') {
    toast('⏸ Inventário pausado pelo analista. Contagens bloqueadas.', 'w');
    beepErr(); return;
  }
  if (statusInv === 'FECHADO' || statusInv === 'CANCELADO') {
    toast('🚫 Inventário encerrado. Retornando...', 'e');
    setTimeout(() => voltarInventarios(), 1500);
    beepErr(); return;
  }

  // ── Bloqueio por turno encerrado ──
  if (APP.turnoEncerrado) {
    toast('🔒 Turno encerrado. Não é possível realizar novas contagens.', 'w');
    beepErr(); return;
  }

  // ── Validar endereço contra base do inventário E catálogo geral (dt_locais) ──
  // APP._locaisDoFirebase = true somente quando locaisAtivos veio do dt_locais completo
  // Se veio só do CSV do inventário, não bloquear endereços que podem existir no armazém
  if (APP.base.length > 0 || APP.locaisAtivos?.size > 0) {
    const naBase   = APP.base.some(r => r._end === valNorm);
    // Só usar locaisAtivos como critério de bloqueio se veio do Firebase (catálogo completo)
    const catalogoCompleto = !!APP._locaisDoFirebase;
    const naLocais = catalogoCompleto && APP.locaisAtivos?.has(valNorm);
    // APP.atual.enderecoValido pode ter sido atualizado pela verificação async do Firebase
    // no onEnderecoInput() — se sim, confiar nessa verificação e pular o cache local.
    if (!naBase && catalogoCompleto && !naLocais && !APP.atual.enderecoValido) {
      const formatoValido = /^\d{2}\.\d{4}(\.\d+){4,6}$/.test(valNorm);
      if (formatoValido) {
        fb.innerHTML = `<div class="fb err" style="flex-direction:column;align-items:flex-start;gap:3px">
          <b>🚫 Endereço não cadastrado na base</b>
          <span style="font-size:.7rem;opacity:.85">Verifique o endereço e tente novamente.</span>
        </div>`;
        document.getElementById('f-endereco').className = 'field field-err';
        beepErr(); return;
      }
      // Formato diferente: pode ser área especial — deixar prosseguir
    }
  }

  // ── Usar cache da verificação Firebase ──
  const verifAtual = (_endVerif?.endereco === valNorm) ? _endVerif : null;

  if (!verifAtual) {
    // Ainda não temos resultado — consultar e aguardar
    fb.innerHTML = `<div class="fb info">🔍 Verificando endereço…</div>`;
    _verificarEnderecoFirebase(valNorm).then(() => confirmarEndereco());
    return;
  }

  const { status, docsMeus, docsOutros } = verifAtual;

  if (status === 'em_recontagem') {
    fb.innerHTML = `<div class="fb err" style="flex-direction:column;align-items:flex-start;gap:3px">
      <b>🔒 Endereço bloqueado para contagem normal</b>
      <span style="font-size:.7rem;opacity:.9">Este endereço tem uma rodada em aberto — use a aba 🔄 RODADAS.</span>
    </div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    APP.atual.enderecoValido = false;
    beepErr(); return;
  }

  if (status === 'encerrado') {
    fb.innerHTML = `<div class="fb err">🚫 Endereço encerrado — estorne na aba ↩️ ESTORNO para liberar</div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    beepErr(); return;
  }

  if (status === 'outro') {
    // Bloquear — marcar campo como erro E mostrar modal (mesmo nível que em_recontagem)
    fb.innerHTML = `<div class="fb err" style="flex-direction:column;align-items:flex-start;gap:3px">
      <b>🚫 Endereço ocupado por outro operador</b>
      <span style="font-size:.7rem;opacity:.9">Somente o operador responsável pode estornar.</span>
    </div>`;
    document.getElementById('f-endereco').className = 'field field-err';
    APP.atual.enderecoValido = false;
    _modalBloqueioOutroOperador(valNorm, docsOutros);
    beepErr(); return;
  }

  if (status === 'proprio') {
    // Mesmo operador — mostrar opções: continuar ou estornar
    _modalOpcoesProprio(valNorm, docsMeus);
    return;
  }

  // 'livre' — prosseguir normalmente
  _prosseguirComEndereco(valNorm);
}

/** Prossegue para a etapa 2 após validar o endereço */
function _prosseguirComEndereco(valNorm) {
  const fb = document.getElementById('fb-endereco');
  const cap = APP.endCapacidade?.[valNorm] || 0;
  APP.atual.capacidadeEnd = cap;

  // ── DEBUG: mostrar capacidade detectada no feedback visual ──
  // (remover após confirmar que está funcionando)
  dbg('[LOTE DEBUG] endereço:', valNorm, '| cap:', cap, '| perguntaFeita:', APP.lotePerguntaFeita, '| endCapKeys:', Object.keys(APP.endCapacidade||{}).length);
  const capAmostra = Object.entries(APP.endCapacidade||{}).filter(([,v])=>v>0).slice(0,3).map(([k,v])=>k+'='+v).join(', ');
  dbg('[LOTE DEBUG] amostra endCapacidade c/ cap>0:', capAmostra || '(nenhum)');

  // Em modo recontagem: nova sessão limpa — sem info de contagens anteriores
  if (APP.modoRecontagem) {
    fb.innerHTML = `<div class="fb ok">✓ Endereço confirmado — iniciando nova rodada</div>`;
    APP.atual.endereco    = valNorm;
    APP.atual._endNorm    = valNorm;
    APP.atual.somentesDun = valNorm.includes('14.1520');
    APP.atual.step        = 2;
    beepSuave();
    const el2 = document.getElementById('cp-proximo-hint');
    const el3 = document.getElementById('f-capa');
    const el4 = document.getElementById('fb-capa');
    if (el3) el3.value = '';
    if (el4) el4.innerHTML = '';
    updateSteps();
    setTimeout(() => el3?.focus(), 120);
    return;
  }

  // ── Verificar oferta de lançamento rápido (endereços grandes) ──
  // Só oferece se: cap >= 10, primeira vez neste endereço, não é recontagem
  APP.atual.endereco    = valNorm;
  APP.atual._endNorm    = valNorm;
  APP.atual.capacidadeEnd = cap;
  APP.atual.somentesDun = valNorm.includes('14.1520');

  // DEBUG visual — exibe cap detectada no feedback para confirmar no celular
  if (fb) fb.innerHTML = `<div class="fb info" style="font-size:.68rem;line-height:1.5">
    🔍 <b>cap:</b> ${cap} | min: ${LOTE_CAP_MINIMA} | pergunta: ${APP.lotePerguntaFeita}<br>
    ends c/cap: ${Object.values(APP.endCapacidade||{}).filter(v=>v>0).length} / ${Object.keys(APP.endCapacidade||{}).length}<br>
    <span style="opacity:.7">${capAmostra||'(sem cap>0)'}</span>
  </div>`;

  if (_loteVerificarOferta(valNorm, valNorm, cap)) return; // painel lote assumiu o controle

  const palletsJaContados = _palletsNoEnderecoAtual(valNorm);

  let infoCapacidade = '';
  if (cap > 0) {
    const restantes = Math.max(0, cap - palletsJaContados);
    infoCapacidade = `<div class="fb info" style="margin-top:6px">
      🏷️ Capacidade: <b>${cap}</b> pallets &nbsp;·&nbsp;
      Contados: <b>${palletsJaContados}</b> &nbsp;·&nbsp;
      Restantes: <b>${restantes}</b>
    </div>`;
  } else if (palletsJaContados > 0) {
    infoCapacidade = `<div class="fb info" style="margin-top:6px">
      📦 Pallets contados neste endereço: <b>${palletsJaContados}</b>
    </div>`;
  }

  fb.innerHTML = (palletsJaContados > 0
    ? `<div class="fb ok">✓ Continuando endereço — pallet ${palletsJaContados + 1}</div>`
    : `<div class="fb ok">✓ Endereço confirmado</div>`) + infoCapacidade;

  APP.atual.endereco    = valNorm;
  APP.atual._endNorm    = valNorm;
  APP.atual.somentesDun = valNorm.includes('14.1520');
  APP.atual.step        = 2;
  beepSuave();

  const el2 = document.getElementById('cp-proximo-hint');
  const el3 = document.getElementById('f-capa');
  const el4 = document.getElementById('fb-capa');
  if (el2) {
    const range = APP.capaRange;
    el2.textContent = (range?.min && range?.max)
      ? `Range: ${range.min}–${range.max} · Próximo: ${APP.proximoCapa}`
      : 'Próximo disponível: ' + APP.proximoCapa;
  }
  if (el3) el3.value = '';
  if (el4) el4.innerHTML = '';

  updateSteps();
  // Garantir explicitamente que o botão VAZIO está visível após confirmar endereço
  const _vaziow = document.getElementById('btn-vazio-wrap');
  if (_vaziow && !APP.lote) _vaziow.style.display = '';
  setTimeout(() => { try { document.getElementById('f-capa').focus(); } catch(e){} }, 100);
}

/** Modal de bloqueio quando outro operador já coletou */
function _modalBloqueioOutroOperador(endNorm, docsOutros) {
  const quem = docsOutros[0]?.operador || 'outro operador';
  const qtd  = docsOutros.length;
  _criarModal({
    icone: '🚫',
    titulo: 'Endereço já coletado',
    corBorda: 'rgba(255,71,87,.5)',
    corpo: `
      <div style="font-size:.82rem;color:var(--text);text-align:center;line-height:1.6">
        Endereço <b style="font-family:var(--mono);color:var(--accent)">${endNorm}</b> foi coletado por
        <b style="color:var(--warn)">${quem}</b>
        <br><span style="font-size:.72rem;color:var(--muted)">${qtd} pallet(s) registrado(s)</span>
      </div>
      <div style="margin-top:10px;padding:10px 12px;background:rgba(255,71,87,.08);border:1px solid rgba(255,71,87,.2);border-radius:8px;font-size:.75rem;color:var(--muted);text-align:center">
        Somente <b>${quem}</b> pode estornar esta contagem.
      </div>`,
    botoes: [
      { label: '← Voltar', estilo: 'ghost', acao: null }
    ]
  });
}

/** Modal com opções quando o próprio operador já contou */
function _modalOpcoesProprio(endNorm, docsMeus) {
  const qtd = docsMeus.length;
  const docIds = docsMeus.map(c => c._docId || c.uuid).filter(Boolean);

  // ── Regra do 1 minuto: verificar tempo da contagem mais recente ──
  const agora = Date.now();
  const maisRecente = docsMeus.reduce((latest, c) => {
    // criado_em pode ser string ISO, Timestamp Firebase ou Date — normalizar todos
    const raw = c.criado_em || c.dataHora || 0;
    const t = raw?.toDate ? raw.toDate().getTime()
            : raw?.seconds ? raw.seconds * 1000
            : new Date(raw).getTime();
    return (!isNaN(t) && t > latest) ? t : latest;
  }, 0);
  const segundosAtras = maisRecente ? Math.floor((agora - maisRecente) / 1000) : Infinity;
  const dentroDoTempo = segundosAtras <= 60;

  if (!dentroDoTempo) {
    // Fora do prazo — bloquear completamente
    _criarModal({
      icone: '🔒',
      titulo: 'Endereço bloqueado',
      corBorda: 'rgba(255,71,87,.5)',
      corpo: `
        <div style="font-size:.82rem;color:var(--text);text-align:center;line-height:1.6">
          Endereço <b style="font-family:var(--mono);color:var(--accent)">${endNorm}</b>
          <br><span style="font-size:.72rem;color:var(--muted)">Contagem registrada há ${segundosAtras}s</span>
        </div>
        <div style="margin-top:10px;font-size:.78rem;color:#ff4757;text-align:center;line-height:1.5;padding:10px;background:rgba(255,71,87,.08);border-radius:8px;border:1px solid rgba(255,71,87,.2)">
          ⏱ Tempo limite de correção (1 min) expirado.<br>
          Este endereço está bloqueado.<br>
          <b>Solicite nova rodada ao analista.</b>
        </div>`,
      botoes: [
        { label: '← Voltar', estilo: 'ghost', acao: null },
      ]
    });
    document.getElementById('f-endereco').className = 'field field-err';
    APP.atual.enderecoValido = false;
    beepErr();
    return;
  }

  // Dentro do prazo (≤ 60s) — mostrar opções normais
  const tempoRestante = 60 - segundosAtras;
  _criarModal({
    icone: '⚠️',
    titulo: 'Você já contou este endereço',
    corBorda: 'rgba(255,179,0,.5)',
    corpo: `
      <div style="font-size:.82rem;color:var(--text);text-align:center;line-height:1.6">
        Endereço <b style="font-family:var(--mono);color:var(--accent)">${endNorm}</b>
        <br><span style="font-size:.72rem;color:var(--muted)">${qtd} pallet(s) já registrado(s) por você</span>
      </div>
      <div style="margin-top:8px;font-size:.72rem;color:#00d68f;text-align:center;padding:6px;background:rgba(0,214,143,.08);border-radius:6px;border:1px solid rgba(0,214,143,.2)">
        ✅ Correção permitida — ${tempoRestante}s restantes
      </div>
      <div style="margin-top:8px;font-size:.72rem;color:var(--muted);text-align:center">
        O que deseja fazer?
      </div>`,
    botoes: [
      { label: '← Voltar',          estilo: 'ghost',   acao: null },
      { label: '+ Adicionar pallet', estilo: 'primary', acao: () => _prosseguirComEndereco(endNorm) },
      { label: '↩ Estornar e recontar', estilo: 'warn', acao: () => _estornarERecomecar(endNorm, docIds) }
    ]
  });
}

/** Estorna todos os pallets do endereço e inicia nova contagem */
async function _estornarERecomecar(endNorm, docIds) {
  const op = APP.operador?.name || '';
  toast('↩ Estornando contagens…', 'w');
  try {
    for (const id of docIds) {
      await FS.collection(FCOL.contagens).doc(id).update({
        _excluida:     true,
        status:        'ESTORNADA',
        _excluida_em:  new Date().toISOString(),
        estornada_por: op,
      });
      const idx = APP.contagens.findIndex(c => (c.uuid === id || c._docId === id));
      if (idx >= 0) {
        APP.contagens[idx]._excluida    = true;
        APP.contagens[idx].status       = 'ESTORNADA';
        APP.contagens[idx]._excluida_em = new Date().toISOString();
        APP.contagens[idx].estornada_por = op;
      }
    }
    // Invalidar cache do endereço
    _endVerif = null;
    renderHistorico();
    updateStats();
    toast('✓ Estornado. Pode recontar.', 's');
    beepOk();
    _prosseguirComEndereco(endNorm);
  } catch(err) {
    toast('✗ Erro ao estornar: ' + err.message, 'e');
  }
}

/** Factory de modais reutilizável */
function _criarModal({ icone, titulo, corBorda, corpo, botoes }) {
  const old = document.getElementById('_modal_end_bloq');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = '_modal_end_bloq';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

  const botoesHtml = botoes.map((b, i) => {
    const bg = b.estilo === 'primary' ? 'background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:800'
             : b.estilo === 'warn'    ? 'background:rgba(255,71,87,.15);border:1px solid rgba(255,71,87,.4);color:#ff4757;font-weight:700'
             :                         'background:transparent;border:1px solid var(--border);color:var(--muted)';
    return `<button id="_mbtn_${i}" style="flex:1;padding:11px 8px;border-radius:10px;font-size:.82rem;font-family:var(--sans);cursor:pointer;border:none;${bg}">${b.label}</button>`;
  }).join('');

  modal.innerHTML = `
    <div style="background:var(--surface);border:1.5px solid ${corBorda};border-radius:18px;padding:24px 20px;max-width:340px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)">
      <div style="font-size:1.8rem;text-align:center;margin-bottom:8px">${icone}</div>
      <div style="font-weight:800;font-size:.95rem;text-align:center;margin-bottom:14px;color:var(--text)">${titulo}</div>
      ${corpo}
      <div style="display:flex;gap:8px;margin-top:16px">${botoesHtml}</div>
    </div>`;

  document.body.appendChild(modal);

  botoes.forEach((b, i) => {
    document.getElementById(`_mbtn_${i}`).onclick = () => {
      modal.remove();
      if (b.acao) b.acao();
    };
  });
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ═══════════════════════════════════════════════════════════════════
//  LANÇAMENTO RÁPIDO EM LOTE
// ═══════════════════════════════════════════════════════════════════

const LOTE_CAP_MINIMA = 10; // capacidade mínima para oferecer o modo lote

/**
 * Retorna quantos pallets foram contados no endereço indicado,
 * excluindo registros do tipo VAZIO.
 *
 * Em modo recontagem: conta APENAS registros da sessão atual de
 * recontagem (tipo_contagem === 'RECONTAGEM'), ignorando os registros
 * da 1ª contagem para não bloquear o fluxo nem poluir contadores.
 */
function _palletsNoEnderecoAtual(endNorm) {
  const endereco = endNorm || '';
  const locais = (APP.contagens || []).filter(c =>
    c.endereco === endereco &&
    c.tipo_contagem !== 'VAZIO' &&
    !c._excluida &&
    c.status !== 'ESTORNADA' &&
    c.status !== 'EXCLUIDA' &&
    // Em recontagem: ignorar registros de contagem anterior (PRIMEIRA)
    (!APP.modoRecontagem || c.tipo_contagem === 'RECONTAGEM')
  );

  // _verificarEnderecoFirebase() consulta as contagens existentes no Firestore antes
  // de confirmar o endereço. Reaproveitar esses documentos evita que um reload do app
  // zere artificialmente a capacidade já ocupada no endereço.
  const remotos = (_endVerif && _endVerif.endereco === endereco ? (_endVerif.docs || []) : []).filter(c =>
    c.tipo_contagem !== 'VAZIO' &&
    !c._excluida &&
    c.status !== 'ESTORNADA' &&
    c.status !== 'EXCLUIDA' &&
    (!APP.modoRecontagem || c.tipo_contagem === 'RECONTAGEM')
  );

  // União idempotente: a mesma contagem pode existir no array local e no snapshot.
  const unicos = new Map();
  const chave = (c, i, origem) => String(
    c.uuid || c._docId || c.id ||
    [origem, c.inventario_id || '', c.endereco || '', c.capa_palete || c.capa || '', c.criada_em || c.data_hora || '', i].join('|')
  );
  remotos.forEach((c, i) => unicos.set(chave(c, i, 'fs'), c));
  locais.forEach((c, i) => {
    const id = String(c.uuid || c._docId || c.id || '');
    if (id) unicos.set(id, c);
    else unicos.set(chave(c, i, 'local'), c);
  });
  return unicos.size;
}

/** Alias para uso interno do módulo lote */
function _lotePalletsJaUsados(endNorm) {
  return _palletsNoEnderecoAtual(endNorm || APP.lote?.endNorm || '');
}
function _loteSetPainel(ativo) {
  const painel = document.getElementById('painel-lote');
  const steps  = document.getElementById('steps');
  // step-fields que devem sumir quando lote estiver ativo
  const stepIds = ['step-capa','step-gtin','step-validade','step-quantidade','bloco-endereco-travado'];
  const btVazio = document.getElementById('btn-vazio-wrap');
  if (ativo) {
    if (painel) painel.style.display = '';
    stepIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    // manter step-endereco visível mas congelado (sem interação)
    if (btVazio) btVazio.style.display = 'none';
  } else {
    if (painel) painel.style.display = 'none';
    stepIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
  }
}

/** Mostra apenas a tela indicada dentro do painel, esconde as demais */
function _loteShowTela(telaId) {
  ['oferta','gtin','qtd','total','capas','validade','continuar'].forEach(id => {
    const el = document.getElementById('lote-tela-' + id);
    if (el) el.style.display = (('lote-tela-' + id) === telaId || id === telaId) ? '' : 'none';
  });
  // alias curto: pode passar 'oferta' ou 'lote-tela-oferta'
  const el = document.getElementById('lote-tela-' + telaId) || document.getElementById(telaId);
  if (el) el.style.display = '';
  _loteAtualizarHeader();
}

function _loteAtualizarHeader() {
  const l = APP.lote;
  if (!l) return;
  const hEnd  = document.getElementById('lote-header-end');
  const hProg = document.getElementById('lote-header-prog');
  if (hEnd)  hEnd.textContent  = l.endExib || '';
  if (hProg) {
    if (l.totalPallets) {
      const lidos = l.capasLidas?.length || 0;
      hProg.textContent = `Pallets: ${lidos} / ${l.totalPallets} · Qtd padrão: ${l.qtdPadrao ?? '—'}`;
    } else {
      const ja  = _lotePalletsJaUsados(l.endNorm);
      const cap = l.cap || 0;
      hProg.textContent = cap > 0 ? `Capacidade: ${cap} · Usados: ${ja} · Restantes: ${cap - ja}` : '';
    }
  }
}

// ──────────────────────────────────────────────────────────────────
//  ENTRADA: chamado em _prosseguirComEndereco quando cap >= 10
// ──────────────────────────────────────────────────────────────────
function loteOferecer(endNorm, endExib, cap) {
  if (APP.modoRecontagem) return; // recontagem = sempre manual
  APP.lote = { endNorm, endExib, cap, gtin: null, codigoProduto: null,
                descricaoProduto: null, qtdPadrao: null, totalPallets: null,
                capasLidas: [], grupos: [], totalSalvos: 0 };
  APP.lotePerguntaFeita = true;
  _loteSetPainel(true);
  _loteShowTela('oferta');
  const jaUsados   = _lotePalletsJaUsados(endNorm);
  const restantes  = Math.max(0, cap - jaUsados);
  const txt = document.getElementById('lote-oferta-cap-txt');
  if (txt) txt.innerHTML = `Capacidade: <b>${cap} pallets</b>${jaUsados > 0 ? ` &nbsp;·&nbsp; Já contados: <b>${jaUsados}</b> &nbsp;·&nbsp; Restantes: <b>${restantes}</b>` : ''}`;
  const hdr = document.getElementById('lote-header');
  if (hdr) hdr.style.display = 'none'; // esconder cabeçalho na tela de oferta
}

function loteRecusar() {
  // Operador prefere modo manual — fechar painel e continuar fluxo normal
  APP.lote = null;
  _loteSetPainel(false);
  // Redirecionar para step 2 (capa)
  APP.atual.step = 2;
  updateSteps();
  const el = document.getElementById('f-capa');
  if (el) { el.value = ''; el.disabled = false; setTimeout(() => el.focus(), 80); }
  // Mostrar botão vazio
  const vw = document.getElementById('btn-vazio-wrap');
  if (vw) vw.style.display = '';
}

function loteAceitar() {
  const hdr = document.getElementById('lote-header');
  if (hdr) hdr.style.display = '';
  _loteShowTela('gtin');
  setTimeout(() => document.getElementById('lote-f-gtin')?.focus(), 120);
}

function loteAbortar() {
  const endNorm = APP.lote?.endNorm;
  const cap     = APP.lote?.cap;
  const sonen   = APP.lote?.somentesDun || false;
  APP.lote = null;
  _loteSetPainel(false);
  if (endNorm) {
    // Se já salvou algum pallet, entrar no modo travado
    const j = _lotePalletsJaUsados(endNorm);
    if (j > 0) {
      _manterEnderecoAtivo(endNorm, endNorm, cap || 0, sonen);
    } else {
      resetContagem();
    }
  } else {
    resetContagem();
  }
}

// ──────────────────────────────────────────────────────────────────
//  TELA GTIN
// ──────────────────────────────────────────────────────────────────
function loteOnGtinInput() {
  const val = (document.getElementById('lote-f-gtin')?.value || '').trim();
  const fb  = document.getElementById('lote-fb-gtin');
  if (!fb) return;
  if (!val) { fb.innerHTML = ''; return; }
  const match = _buscarProduto(val); // reutiliza a lógica existente de busca de produto
  if (match) {
    fb.innerHTML = `<div class="fb ok" style="font-size:.75rem">✓ ${escHTML(match.descricao_produto || match.codigo_produto)}</div>`;
  } else {
    fb.innerHTML = `<div class="fb warn" style="font-size:.75rem">⚠ Código não encontrado na base — será registrado assim mesmo</div>`;
  }
}

function loteConfirmarGtin() {
  const val = (document.getElementById('lote-f-gtin')?.value || '').trim();
  const fb  = document.getElementById('lote-fb-gtin');
  if (!val) { if (fb) fb.innerHTML = `<div class="fb err">Bipe ou digite o código</div>`; return; }
  if (!APP.lote) return;
  const match = _buscarProduto(val);
  APP.lote.gtin             = normProd(val);
  APP.lote.codigoProduto    = normProd(match?.codigo_produto || val);
  APP.lote.descricaoProduto = match?.descricao_produto || 'Código sem cadastro';
  _loteShowTela('qtd');
  const resumoEl = document.getElementById('lote-prod-resumo');
  if (resumoEl) resumoEl.innerHTML = `<b>${escHTML(APP.lote.descricaoProduto)}</b><br><span style="opacity:.7">${escHTML(APP.lote.gtin)}</span>`;
  setTimeout(() => document.getElementById('lote-f-qtd-padrao')?.focus(), 120);
}

/** Reutiliza a lógica de busca de produto do fluxo normal */
function _buscarProduto(gtin) {
  if (!APP.base?.length) return null;
  const endNorm = APP.lote?.endNorm || APP.atual._endNorm || '';
  // Primeiro tenta pelo endereço + gtin
  const matchEnd = APP.base.find(r => r._end === endNorm && (r.gtin === gtin || r.codigo_produto === gtin));
  if (matchEnd) return matchEnd;
  // Fallback: qualquer produto com esse código
  return APP.base.find(r => r.gtin === gtin || r.codigo_produto === gtin) || null;
}

// ──────────────────────────────────────────────────────────────────
//  TELA QTD PADRÃO
// ──────────────────────────────────────────────────────────────────
function loteConfirmarQtdPadrao() {
  const val = parseInt(document.getElementById('lote-f-qtd-padrao')?.value);
  const fb  = document.getElementById('lote-fb-qtd');
  if (isNaN(val) || val <= 0) { if (fb) fb.innerHTML = `<div class="fb err">Informe uma quantidade válida</div>`; return; }
  APP.lote.qtdPadrao = val;
  _loteShowTela('total');
  // Mostrar resumo + aviso de capacidade
  const jaUsados  = _lotePalletsJaUsados(APP.lote.endNorm);
  const maxPoss   = APP.lote.cap > 0 ? Math.max(0, APP.lote.cap - jaUsados) : 999;
  const resumoEl  = document.getElementById('lote-total-resumo');
  if (resumoEl) resumoEl.innerHTML = `Produto: <b>${escHTML(APP.lote.descricaoProduto)}</b><br>Qtd/pallet: <b>${escHTML(String(val))}</b>`;
  const avisoEl   = document.getElementById('lote-total-aviso-cap');
  if (avisoEl && APP.lote.cap > 0) {
    avisoEl.style.display = '';
    avisoEl.innerHTML = `⚠ Capacidade do endereço: <b>${escHTML(String(APP.lote.cap))}</b> &nbsp;·&nbsp; Já usados: <b>${escHTML(String(jaUsados))}</b> &nbsp;·&nbsp; Máximo neste lote: <b>${escHTML(String(maxPoss))}</b>`;
  }
  const fTotal = document.getElementById('lote-f-total');
  if (fTotal) { fTotal.max = String(maxPoss); fTotal.value = ''; }
  setTimeout(() => fTotal?.focus(), 120);
}

// ──────────────────────────────────────────────────────────────────
//  TELA TOTAL DE PALLETS
// ──────────────────────────────────────────────────────────────────
function loteConfirmarTotal() {
  const val       = parseInt(document.getElementById('lote-f-total')?.value);
  const fb        = document.getElementById('lote-fb-total');
  const jaUsados  = _lotePalletsJaUsados(APP.lote.endNorm);
  const maxPoss   = APP.lote.cap > 0 ? Math.max(0, APP.lote.cap - jaUsados) : 9999;
  if (isNaN(val) || val <= 0) { if (fb) fb.innerHTML = `<div class="fb err">Informe uma quantidade válida</div>`; return; }
  if (APP.lote.cap > 0 && val > maxPoss) {
    if (fb) fb.innerHTML = `<div class="fb err">Máximo permitido: ${maxPoss} pallet(s)</div>`; return;
  }
  APP.lote.totalPallets = val;
  APP.lote.capasLidas   = [];
  _loteShowTela('capas');
  _loteAtualizarTelaCapa();
  setTimeout(() => document.getElementById('lote-f-capa')?.focus(), 120);
}

// ──────────────────────────────────────────────────────────────────
//  TELA LEITURA DE CAPAS
// ──────────────────────────────────────────────────────────────────
function _loteAtualizarTelaCapa() {
  const l        = APP.lote;
  const lidas    = l.capasLidas.length;
  const total    = l.totalPallets;
  const restante = total - lidas;
  const pct      = total > 0 ? Math.round((lidas / total) * 100) : 0;
  const progEl   = document.getElementById('lote-capas-prog');
  const barEl    = document.getElementById('lote-capas-bar');
  const listaWrap= document.getElementById('lote-capas-lidas-wrap');
  const listaEl  = document.getElementById('lote-capas-lidas-list');
  if (progEl)   progEl.innerHTML = `Pallet <b>${lidas + 1}</b> de <b>${total}</b> &nbsp;·&nbsp; Restam: <b>${restante}</b>`;
  if (barEl)    barEl.style.width = pct + '%';
  if (listaWrap) listaWrap.style.display = lidas > 0 ? '' : 'none';
  if (listaEl)  listaEl.innerHTML = l.capasLidas.map((c, i) =>
    `<span style="background:rgba(232,117,26,.12);border:1px solid rgba(232,117,26,.25);border-radius:6px;padding:2px 7px;font-family:var(--mono);font-size:.68rem;color:var(--accent)">${c}</span>`
  ).join('');
  _loteAtualizarHeader();
}

function loteOnCapaInput() {
  const val = document.getElementById('lote-f-capa')?.value || '';
  const fb  = document.getElementById('lote-fb-capa');
  if (!fb) return;
  if (val.length >= 7) {
    // Verificar duplicata
    if (APP.lote?.capasLidas.includes(val)) {
      fb.innerHTML = `<div class="fb err">⚠ Capa já lida neste lote</div>`;
    } else {
      fb.innerHTML = `<div class="fb ok" style="font-size:.75rem">✓ ${val}</div>`;
    }
  } else {
    fb.innerHTML = '';
  }
}

function loteConfirmarCapa() {
  const fCapa = document.getElementById('lote-f-capa');
  const fb    = document.getElementById('lote-fb-capa');
  const val   = (fCapa?.value || '').trim();
  if (!val || val.length < 7) { if (fb) fb.innerHTML = `<div class="fb err">Mínimo 7 dígitos</div>`; return; }
  if (APP.lote.capasLidas.includes(val)) { if (fb) fb.innerHTML = `<div class="fb err">Capa já lida — bipe a próxima</div>`; return; }
  APP.lote.capasLidas.push(val);
  beepOk();
  const lidas = APP.lote.capasLidas.length;
  const total = APP.lote.totalPallets;
  if (lidas >= total) {
    // Todas as capas lidas — ir para validade
    _loteIniciarValidade();
  } else {
    // Próxima capa
    if (fCapa) fCapa.value = '';
    if (fb)    fb.innerHTML = `<div class="fb ok">✓ Capa ${lidas} registrada — leia a próxima</div>`;
    _loteAtualizarTelaCapa();
    setTimeout(() => { fCapa?.value === '' && fCapa?.focus(); }, 80);
  }
}

// ──────────────────────────────────────────────────────────────────
//  TELA VALIDADE POR GRUPO
// ──────────────────────────────────────────────────────────────────
function _loteIniciarValidade() {
  APP.lote.pendenciasValidade = [...APP.lote.capasLidas]; // todas as capas ainda sem validade
  _loteShowTela('validade');
  _loteAtualizarTelaValidade();
  setTimeout(() => document.getElementById('lote-f-validade')?.focus(), 120);
}

function _loteAtualizarTelaValidade() {
  const l       = APP.lote;
  const pend    = l.pendenciasValidade?.length || 0;
  const txtEl   = document.getElementById('lote-val-pendente-txt');
  const fValQtd = document.getElementById('lote-f-val-qtd');
  if (txtEl) txtEl.innerHTML = `Faltam definir validade de <b>${pend}</b> pallet(s)`;
  if (fValQtd) { fValQtd.max = String(pend); fValQtd.value = pend === 1 ? '1' : ''; }
}

function loteOnValidadeInput() {
  const val = document.getElementById('lote-f-validade')?.value || '';
  const fb  = document.getElementById('lote-fb-validade');
  if (!fb || !val) { if (fb) fb.innerHTML = ''; return; }
  // Formato simples: aceitar MM/AAAA ou DD/MM/AAAA
  if (/^\d{2}\/\d{4}$/.test(val) || /^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
    fb.innerHTML = `<div class="fb ok" style="font-size:.75rem">✓ ${val}</div>`;
  } else {
    fb.innerHTML = '';
  }
}

function loteConfirmarValidadeInput() {
  // Avança para o campo de qtd ao dar Enter na validade
  document.getElementById('lote-f-val-qtd')?.focus();
}

function loteConfirmarValidade() {
  const validade = (document.getElementById('lote-f-validade')?.value || '').trim();
  const qtdPal   = parseInt(document.getElementById('lote-f-val-qtd')?.value);
  const fb       = document.getElementById('lote-fb-validade');
  const pend     = APP.lote.pendenciasValidade?.length || 0;
  if (!validade) { if (fb) fb.innerHTML = `<div class="fb err">Informe a validade</div>`; return; }
  if (isNaN(qtdPal) || qtdPal <= 0) { if (fb) fb.innerHTML = `<div class="fb err">Informe quantos pallets</div>`; return; }
  if (qtdPal > pend) { if (fb) fb.innerHTML = `<div class="fb err">Máximo: ${pend}</div>`; return; }

  // Pegar as primeiras qtdPal capas das pendências
  const capasGrupo = APP.lote.pendenciasValidade.splice(0, qtdPal);
  APP.lote.grupos.push({ validade, capas: capasGrupo });

  if (APP.lote.pendenciasValidade.length > 0) {
    // Ainda há pendências
    document.getElementById('lote-f-validade').value = '';
    _loteAtualizarTelaValidade();
    if (fb) fb.innerHTML = `<div class="fb ok">✓ ${qtdPal} pallet(s) com validade ${validade} — defina a próxima</div>`;
    setTimeout(() => document.getElementById('lote-f-validade')?.focus(), 80);
  } else {
    // Tudo definido — salvar e ir para continuação
    _loteSalvarTudo();
  }
}

// ──────────────────────────────────────────────────────────────────
//  SALVAR TODOS OS PALLETS DO LOTE INDIVIDUALMENTE
// ──────────────────────────────────────────────────────────────────
function _loteSalvarTudo() {
  // ── Verificar status do inventário antes de salvar o lote ──
  if (!APP.inventario) {
    toast('⚠ Nenhum inventário ativo — selecione um inventário antes de contar.', 'e');
    return;
  }
  if (APP.inventario.status && APP.inventario.status !== 'ATIVO') {
    toast(`⚠ Inventário "${APP.inventario.nome}" está ${APP.inventario.status}. Lote bloqueado.`, 'e');
    APP.lote = null;
    _loteSetPainel(false);
    voltarInventarios();
    return;
  }

  const l    = APP.lote;
  const agora = new Date();
  let saved  = 0;

  // Para cada grupo de validade, salvar cada capa individualmente
  l.grupos.forEach(grupo => {
    grupo.capas.forEach(capa => {
      const contagem = {
        id:                Date.now() + Math.random(), // garante uniqueness em loop síncrono
        uuid:              gerarUUID(),
        inventario_id:     APP.inventario?.id     || 'local',
        inventario_nome:   APP.inventario?.nome   || '',
        inventario_codigo: APP.inventario?.codigo || '',
        endereco:          l.endNorm,
        capa:              capa,
        gtin:           normProd(l.gtin),
        codigo_produto: normProd(l.codigoProduto),
        produto_codigo:    l.codigoProduto,
        descricao:         l.descricaoProduto,
        descricao_produto: l.descricaoProduto,
        validade:          grupo.validade,
        quantidade:        l.qtdPadrao,
        quantidade_esperada: '',
        divergente:        false,
        operador:          APP.operador?.name  || '',
        operador_id:       APP.operador?.email || APP.operador?.usuario || APP.operador?.login || '',
        operador_nome:     APP.operador?.name  || APP.operador?.nome || '',
        operador_email:    APP.operador?.email || '',
        coletor_id:        localStorage.getItem('dt_device_id') || '',
        origem:            'COLETOR',
        tipo_contagem:     'PRIMEIRA',
        lancamento_rapido: true,   // flag para rastreabilidade
        dataHora:          agora,
        criado_em:         agora.toISOString(),
        numero:            APP.contagens.filter(c => c.endereco === l.endNorm).length + saved + 1,
      };
      APP.contagens.unshift(contagem);
      enfileirarContagem({ ...contagem, dataHora: agora.toISOString() });
      saved++;
    });
  });

  l.totalSalvos = (l.totalSalvos || 0) + saved;
  if (!isNaN(l.qtdPadrao)) {
    const n = parseInt(l.capasLidas[l.capasLidas.length - 1]);
    if (!isNaN(n) && n >= APP.proximoCapa) APP.proximoCapa = n + 1;
  }

  renderHistorico();
  updateStats();
  beepOk();
  toast(`✅ ${saved} pallets salvos em lote!`, 's');

  // ── Verificar capacidade após salvar batch ────────────────────────
  const _capLote   = l.cap || 0;
  const _usadosLote = _lotePalletsJaUsados(l.endNorm);
  if (_capLote > 0 && _usadosLote >= _capLote) {
    // Capacidade atingida — encerrar imediatamente sem mostrar tela continuar
    toast(`✅ Capacidade do endereço atingida (${_usadosLote}/${_capLote}) — próximo endereço`, 's');
    APP.lote = null;
    _loteSetPainel(false);
    finalizarEnderecoAtual();
    return;
  }

  // Ainda há vaga → ir para tela de continuação
  _loteShowTela('continuar');
  const jaUsados  = _lotePalletsJaUsados(l.endNorm);
  const restantes = l.cap > 0 ? Math.max(0, l.cap - jaUsados) : null;
  const resumoEl  = document.getElementById('lote-cont-resumo');
  const capTxtEl  = document.getElementById('lote-cont-cap-txt');
  if (resumoEl) resumoEl.innerHTML = `${saved} pallets salvos com sucesso!<br><span style="font-size:.78rem;color:var(--muted);font-weight:400">${l.descricaoProduto} · ${l.qtdPadrao} un/pallet</span>`;
  if (capTxtEl && l.cap > 0) capTxtEl.innerHTML = `Capacidade: <b>${l.cap}</b> &nbsp;·&nbsp; Já contados: <b>${jaUsados}</b> &nbsp;·&nbsp; Restantes: <b>${restantes}</b>`;
  else if (capTxtEl) capTxtEl.innerHTML = `Total contado neste endereço: <b>${jaUsados}</b>`;
}

// ──────────────────────────────────────────────────────────────────
//  TELA CONTINUAR
// ──────────────────────────────────────────────────────────────────
function loteNovoBatch() {
  // Novo lote no mesmo endereço com o mesmo produto — reseta capas/grupos
  APP.lote.capasLidas        = [];
  APP.lote.grupos            = [];
  APP.lote.pendenciasValidade = [];
  APP.lote.qtdPadrao         = null;
  APP.lote.totalPallets      = null;
  // Volta para tela de qty padrão
  _loteShowTela('qtd');
  const resumoEl = document.getElementById('lote-prod-resumo');
  if (resumoEl) resumoEl.innerHTML = `<b>${escHTML(APP.lote.descricaoProduto)}</b><br><span style="opacity:.7">${escHTML(APP.lote.gtin)}</span>`;
  document.getElementById('lote-f-qtd-padrao').value = '';
  setTimeout(() => document.getElementById('lote-f-qtd-padrao')?.focus(), 120);
}

function loteContinuarManual() {
  const endNorm = APP.lote?.endNorm;
  const cap     = APP.lote?.cap || 0;
  const sonen   = APP.lote?.somentesDun || false;
  APP.lote = null;
  _loteSetPainel(false);
  // Entrar no modo travado (rebipar) — lógica existente
  const stepEnd = document.getElementById('step-endereco');
  if (stepEnd) stepEnd.style.display = 'none';
  _manterEnderecoAtivo(endNorm, endNorm, cap, sonen);
}

function loteEncerrar() {
  const endNorm = APP.lote?.endNorm || '';
  APP.lote = null;
  _loteSetPainel(false);
  // Usar confirmarVazio somente se nenhum pallet foi contado,
  // caso contrário apenas encerrar (a divergência será detectada pelo analista)
  const j = _lotePalletsJaUsados(endNorm);
  if (j === 0 && endNorm) {
    _executarVazio(endNorm);      // endereço realmente vazio — salvar vazio
  } else {
    finalizarEnderecoAtual();     // pallets já contados — apenas encerrar
    toast('✅ Endereço encerrado', 's');
  }
}

/** Chamado em _prosseguirComEndereco quando o endereço pode ser grande */
function _loteVerificarOferta(endNorm, endExib, capExplicita) {
  if (APP.modoRecontagem)    return false; // recontagem = sempre manual
  if (APP.lotePerguntaFeita) return false; // já perguntou neste endereço

  const cap = capExplicita || 0;
  if (cap < LOTE_CAP_MINIMA) return false; // endereço pequeno — não oferecer

  loteOferecer(endNorm, endExib, cap);
  return true; // painel lote assumiu o controle
}

/** Deve ser chamado em resetContagem para limpar o estado lote */
function _loteReset() {
  APP.lote              = null;
  APP.lotePerguntaFeita = false; // novo endereço → pode perguntar de novo
  _loteSetPainel(false);
}

/** Encerra o endereço como vazio — popup de confirmação obrigatório */
function confirmarVazio() {
  // Resolver o endereço por ordem de prioridade:
  // 1) modo recontagem  2) lote ativo  3) estado atual  4) campo de tela
  const raw = document.getElementById('f-endereco')?.value || '';
  const endereco = APP.modoRecontagem?.endereco
    || APP.lote?.endNorm
    || APP.atual._endNorm
    || APP.atual._pendingEndereco
    || raw;

  if (!endereco.trim()) { toast('Informe o endereço primeiro', 'e'); return; }
  const valNorm = _normStr(endereco);

  const cap = APP.endCapacidade?.[valNorm] || APP.atual?.capacidadeEnd || 0;
  const palletsJaContados = _palletsNoEnderecoAtual(valNorm);

  // ── Modal de confirmação ──
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:var(--surface);border:1.5px solid rgba(245,158,11,.5);border-radius:18px;padding:24px 20px;max-width:320px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)">
      <div style="font-size:1.8rem;text-align:center;margin-bottom:10px">📭</div>
      <div style="font-weight:800;font-size:.95rem;text-align:center;margin-bottom:6px;color:var(--text)">Confirmar endereço vazio?</div>
      <div style="font-size:.78rem;color:var(--muted);text-align:center;margin-bottom:16px;line-height:1.5">
        Endereço <b style="color:var(--warn);font-family:var(--mono)">${valNorm}</b><br>
        ${palletsJaContados > 0
          ? `<span style="color:var(--text)">${palletsJaContados} pallet(s) já contado(s)</span><br>`
          : ''}
        ${cap > 0 ? `Capacidade: <b>${cap}</b> pallets<br>` : ''}
        <span style="color:var(--warn)">Isso encerrará este endereço.</span>
      </div>
      <div style="display:flex;gap:10px">
        <button id="btn-vazio-cancelar" style="flex:1;padding:12px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:.88rem;cursor:pointer">✗ Cancelar</button>
        <button id="btn-vazio-ok" style="flex:1;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-size:.88rem;font-weight:800;cursor:pointer">📭 Confirmar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  document.getElementById('btn-vazio-ok').onclick = () => {
    modal.remove();
    _executarVazio(valNorm);
  };
  document.getElementById('btn-vazio-cancelar').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function _executarVazio(valNorm) {
  // Em recontagem: verificar apenas pallets da sessão atual (RECONTAGEM),
  // não os da 1ª contagem — o operador está confirmando o estado atual.
  // Fora de recontagem: verificar todos os pallets não-VAZIO do endereço.
  const palletsJaContados = _palletsNoEnderecoAtual(valNorm);

  if (palletsJaContados > 0) {
    // Já há pallets contados → NÃO enviar vazio, apenas encerrar o endereço.
    // "Endereço vazio" aqui significa: "não há mais pallets neste endereço".
    toast('📦 ' + palletsJaContados + ' pallet(s) registrado(s) — endereço encerrado', 's');
    beepOk();
    renderHistorico();
    updateStats();
    if (APP.modoRecontagem) {
      resetContagem();
      _concluirRecontagem();
      return;
    }
    finalizarEnderecoAtual();
    return;
  }

  // ── Nenhum pallet contado → salvar registro VAZIO normalmente ──
  // Se o painel lote estava ativo, fechar antes de gravar/resetar
  if (APP.lote) { APP.lote = null; _loteSetPainel(false); }

  // Em modo recontagem: marcar como RECONTAGEM (não VAZIO) para o analista processar
  // o resultado via sincronizarRecontagensComContagens. O produto 'VAZIO' sinaliza
  // que o operador confirmou o endereço vazio nesta rodada.
  const _emRec = !!APP.modoRecontagem;
  const contagem = {
    id:   Date.now(),
    uuid: gerarUUID(),
    inventario_id:     APP.inventario?.id     || 'local',
    inventario_nome:   APP.inventario?.nome   || '',
    inventario_codigo: APP.inventario?.codigo || '',
    endereco:          valNorm,
    capa:              '',
    gtin:              PROD_VAZIO,   // '__VAZIO__'
    codigo_produto:    PROD_VAZIO,
    produto_codigo:    PROD_VAZIO,
    descricao:         'ENDEREÇO VAZIO',
    descricao_produto: 'ENDEREÇO VAZIO',
    validade:          '',
    quantidade:        0,
    quantidade_esperada: '',
    divergente:        false,
    operador:          APP.operador?.name  || '',
    operador_email:    APP.operador?.email || '',
    coletor_id:        localStorage.getItem('dt_device_id') || '',
    origem:            'COLETOR',
    // Em recontagem: tipo_contagem='RECONTAGEM' para o analista processar o resultado
    tipo_contagem:     _emRec ? 'RECONTAGEM' : 'VAZIO',
    _destino:          _emRec ? 'dt_contagens' : 'dt_vazios',
    recontagem_id:     APP.modoRecontagem?.id          || null,
    divergencia_id:    APP.modoRecontagem?.divergencia_id || null,
    dataHora:          new Date(),
    criado_em:         new Date().toISOString(),
    numero:            1,
  };

  APP.contagens.unshift(contagem);
  enfileirarContagem({ ...contagem, dataHora: contagem.dataHora.toISOString() });
  renderHistorico();
  updateStats();
  toast('📭 Endereço vazio encerrado: ' + valNorm, 's');
  beepOk();
  if (APP.modoRecontagem) {
    finalizarEnderecoAtual();
    _concluirRecontagem();
    return;
  }
  finalizarEnderecoAtual();
}

/** Trocar endereço (botão 🔄 que aparece após confirmar) */
function resetEndereco() {
  // Em recontagem: sempre permitir reset (nova sessão limpa)
  if (APP.modoRecontagem) { resetContagem(); return; }

  // Bloquear se já há pallets contados neste endereço — operador deve encerrar com VAZIO
  const endNorm = APP.atual._endNorm || APP.atual._pendingEndereco;
  if (endNorm) {
    const palletsContados = _palletsNoEnderecoAtual(endNorm);
    if (palletsContados > 0) {
      toast('Para sair deste endereço use 📭 ENDEREÇO VAZIO', 'w');
      return;
    }
  }

  // Sem pallets contados — permitir trocar endereço normalmente
  // Garantir que o bloco travado esteja oculto e o step-endereco visível
  const blocoTravado = document.getElementById('bloco-endereco-travado');
  if (blocoTravado) blocoTravado.style.display = 'none';
  const stepEnd = document.getElementById('step-endereco');
  if (stepEnd) stepEnd.style.display = '';

  APP.atual.step         = 1;
  APP.atual.endereco     = '';
  APP.atual._endNorm     = '';
  APP.atual._pendingEndereco = null;
  APP.atual._pendingPallets  = null;
  APP.atual.enderecoValido = false;
  APP.atual.capa         = '';
  APP.atual.gtin         = '';
  APP.atual.produtoAtual = null;
  APP.atual.validade     = '';
  APP.atual.quantidade   = 0;
  _endVerif = null;
  ['f-endereco','f-capa','f-gtin','f-validade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.disabled = false; el.className = el.className.replace(/\bfield-(ok|err|warn)\b/g,'').trim(); }
  });
  ['fb-endereco','fb-capa','fb-gtin','fb-validade'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = '';
  });
  ['sf-val-endereco','sf-val-capa','sf-val-gtin','sf-val-validade'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  });
  const vaziow = document.getElementById('btn-vazio-wrap');
  if (vaziow) vaziow.style.display = 'none';
  updateSteps();
  setTimeout(() => { const el = document.getElementById('f-endereco'); if (el) el.focus(); }, 80);
}
