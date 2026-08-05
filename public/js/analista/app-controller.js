(function(global){
  const DivergenciaService = global.AnalistaDivergenciaService;
  let uiBound = false;
  let renderTid = null;
  let badgeTid = null;
  let processTid = null;
  let persistTid = null;
  let rendering = false;
  let lastRenderError = '';

  // ── Trava de interação ──────────────────────────────────────────────────
  // O auto-refresh reconstrói a tabela inteira (innerHTML) toda vez que
  // chega uma mudança do Firebase, mesmo que seja de outro inventário/
  // coletor. Se essa reconstrução cair entre o mousedown e o mouseup de um
  // clique (ex.: no botão "Atribuir"), o elemento clicado é substituído por
  // um novo e o navegador nunca dispara o evento "click" — sem erro nenhum
  // no console. O mesmo problema podia fazer a seleção de um endereço
  // desaparecer silenciosamente logo após marcada. Esta trava adia o
  // re-render automático enquanto o usuário estiver com o ponteiro
  // pressionado, e concede uma pequena folga após soltar.
  let pointerAtivo = false;
  let pointerFolgaTid = null;
  function _armarTravaInteracao(){
    const marcarAtivo = () => {
      pointerAtivo = true;
      clearTimeout(pointerFolgaTid);
    };
    const liberar = () => {
      clearTimeout(pointerFolgaTid);
      pointerFolgaTid = setTimeout(() => { pointerAtivo = false; }, 250);
    };
    document.addEventListener('pointerdown', marcarAtivo, true);
    document.addEventListener('mousedown', marcarAtivo, true);
    document.addEventListener('touchstart', marcarAtivo, true);
    document.addEventListener('pointerup', liberar, true);
    document.addEventListener('mouseup', liberar, true);
    document.addEventListener('touchend', liberar, true);
    document.addEventListener('touchcancel', liberar, true);
  }

  function runWhenIdle(fn, timeout){
    const executar = () => {
      if (pointerAtivo) { global.setTimeout(executar, 150); return; }
      fn();
    };
    if (typeof global.requestIdleCallback === 'function') {
      return global.requestIdleCallback(executar, { timeout: timeout || 800 });
    }
    return global.setTimeout(executar, 0);
  }

  function scheduleBadges(){
    clearTimeout(badgeTid);
    badgeTid = setTimeout(() => {
      runWhenIdle(() => {
        try { if (typeof global.atualizarBadgesNav === 'function') global.atualizarBadgesNav(); }
        catch (err) { console.warn('[AppController] badges:', err?.message || err); }
      }, 500);
    }, 220);
  }

  // Renderizar toda a pagina em cada documento recebido do Firebase fazia a
  // thread principal ficar ocupada continuamente. Agora as mudancas sao
  // consolidadas e existe no maximo uma renderizacao a cada 120 ms.
  function scheduleRender(){
    clearTimeout(renderTid);
    renderTid = setTimeout(() => {
      if (rendering) return;
      runWhenIdle(() => {
        if (rendering) return;
        rendering = true;
        try {
          global.AnalistaNavigation?.renderCurrentPage?.();
          lastRenderError = '';
        } catch (err) {
          const sig = String(err && (err.stack || err.message) || err);
          if (sig !== lastRenderError) console.error('[AppController] falha ao renderizar:', err);
          lastRenderError = sig;
        } finally {
          rendering = false;
        }
      }, 700);
    }, 120);
    scheduleBadges();
  }

  function schedulePersist(){
    clearTimeout(persistTid);
    persistTid = setTimeout(() => {
      runWhenIdle(() => {
        try { global.AnalistaBootstrap?.saveAll?.(); }
        catch (err) { console.warn('[AppController] persistencia:', err?.message || err); }
      }, 1200);
    }, 1500);
  }

  function scheduleBusinessReprocess(){
    clearTimeout(processTid);
    processTid = setTimeout(() => {
      runWhenIdle(() => {
        try { DivergenciaService.processarDivergencias({ criarRecontagens: false, source: 'store-reactive' }); }
        catch (err) { console.warn('[AppController] processarDivergencias', err); }
        try { DivergenciaService.corrigirOrfas(); }
        catch (err) { console.warn('[AppController] corrigirDivsOrfas', err); }
        schedulePersist();
        scheduleRender();
      }, 1200);
    }, 350);
  }

  function isOnlySyncAction(action){
    return action?.type === 'SET_SYNC_STATUS';
  }

  function bindUI(){
    if (uiBound) return;
    uiBound = true;
    _armarTravaInteracao();
    global.AnalistaStore.subscribe((state, action, prevState) => {
      const metaSource = action?.meta?.source;

      // SET_SYNC_STATUS muda apenas textos pequenos que ja sao atualizados por
      // updateSyncUI. Nao ha motivo para reconstruir tabelas e dashboards.
      if (metaSource !== 'ui-render' && !isOnlySyncAction(action)) scheduleRender();

      if (DivergenciaService.deveReprocessar(action?.type) && DivergenciaService.afetaFluxoDeContagem(action)) {
        const changed = prevState.contagens !== state.contagens;
        if (changed && metaSource !== 'business-reprocess') scheduleBusinessReprocess();
      }
    });
  }

  global.AnalistaAppController = { bindUI, scheduleRender, scheduleBadges };
})(window);
