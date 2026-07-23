// ═══════════════════════════════════════════════════════════════
// AUDITORIA DO COLETOR — FLUXO ISOLADO E SIMPLIFICADO
// Endereço -> Produto OU Endereço vazio -> gravação -> próximo endereço
// Este arquivo não usa nem altera as funções de contagem do Inventário.
// ═══════════════════════════════════════════════════════════════
(function(){
  'use strict';

  const STATUS_OK = 'OK';
  const STATUS_DIVERGENTE = 'DIVERGENTE';
  const STATUS_VAZIO = 'ENDERECO_VAZIO';
  const STATUS_FINAIS = new Set([STATUS_OK, STATUS_DIVERGENTE, STATUS_VAZIO]);

  let estado = {
    etapa: 'endereco',
    item: null,
    processando: false,
    timerRetorno: null
  };

  function texto(v){ return String(v == null ? '' : v).trim(); }
  function normalizarEndereco(v){
    return texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function normalizarCodigo(v){
    return texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function escapar(v){
    return texto(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function agoraISO(){ return new Date().toISOString(); }
  function operadorNome(){ return APP.operador?.name || APP.operador?.nome || ''; }
  function operadorUsuario(){ return APP.operador?.email || APP.operador?.usuario || APP.operador?.login || ''; }
  function lojaAtual(){
    return APP.lojaAtual?.id || APP.lojaAtual?.nome || APP.lojaId || APP.inventario?.loja || '';
  }
  function auditoriaId(){ return APP.inventario?.auditoria_id || APP.inventario?.id || ''; }

  function listaAuditoria(){
    return (APP.auditorias || []).filter(item => {
      const status = texto(item.status).toUpperCase();
      return item.disponivel_coletor !== false && !STATUS_FINAIS.has(status);
    });
  }

  function dunEsperado(item){
    return texto(item?.dunEsperado || item?.dun_esperado || item?.dun || item?.codigoProduto || item?.codigo_produto || item?.gtin);
  }

  function descricaoEsperada(item){
    return texto(item?.produtoEsperado || item?.produto_esperado || item?.descricaoProdutoEsperado || item?.produto_nome || item?.descricao || item?.produto);
  }

  function localizarProdutoLido(codigoLido){
    const globalProduto = window.DTProdutos?.buscarSync(codigoLido);
    if (globalProduto?.encontrado) return texto(globalProduto.nomeProduto);
    const alvo = normalizarCodigo(codigoLido);
    const nomeMapeado = APP.auditoriaProdutosMap?.[alvo];
    if (nomeMapeado) return texto(nomeMapeado);
    const encontrado = (APP.auditorias || []).find(item => normalizarCodigo(dunEsperado(item)) === alvo);
    return encontrado ? descricaoEsperada(encontrado) : 'Produto não identificado';
  }

  function encontrarEndereco(valor){
    const alvo = normalizarEndereco(valor);
    if (!alvo) return null;
    return listaAuditoria().find(item => normalizarEndereco(item.endereco || item.endereco_norm) === alvo) || null;
  }

  function elementos(){
    return {
      titulo: document.getElementById('auditoria-titulo'),
      etapaEndereco: document.getElementById('auditoria-etapa-endereco'),
      etapaProduto: document.getElementById('auditoria-etapa-produto'),
      endereco: document.getElementById('auditoria-endereco'),
      produto: document.getElementById('auditoria-produto'),
      enderecoConfirmado: document.getElementById('auditoria-endereco-confirmado'),
      feedbackEndereco: document.getElementById('auditoria-feedback-endereco'),
      feedbackFinal: document.getElementById('auditoria-feedback-final'),
      btnEndereco: document.getElementById('auditoria-confirmar-endereco'),
      btnProduto: document.getElementById('auditoria-confirmar-produto'),
      btnVazio: document.getElementById('auditoria-endereco-vazio')
    };
  }

  function tocar(tipo){
    try {
      if (tipo === 'erro' && typeof beepErr === 'function') beepErr();
      else if (tipo === 'vazio' && typeof beepSuave === 'function') beepSuave();
      else if (typeof beepOk === 'function') beepOk();
    } catch(e) { console.warn('[AUDITORIA] Falha ao tocar som:', e); }
  }

  function mostrarFeedbackEndereco(mensagem, erro){
    const el = elementos().feedbackEndereco;
    if (!el) return;
    el.style.display = '';
    el.className = erro ? 'fb err' : 'fb ok';
    el.textContent = mensagem;
  }

  function mostrarResultado(mensagem, tipo){
    const el = elementos().feedbackFinal;
    if (!el) return;
    el.style.display = '';
    el.className = tipo === 'erro' ? 'fb err' : (tipo === 'vazio' ? 'fb warn' : 'fb ok');
    el.textContent = mensagem;
  }

  function setProcessando(valor){
    estado.processando = !!valor;
    const el = elementos();
    [el.btnEndereco, el.btnProduto, el.btnVazio].forEach(btn => { if (btn) btn.disabled = estado.processando; });
    if (el.endereco) el.endereco.disabled = estado.processando || estado.etapa !== 'endereco';
    if (el.produto) el.produto.disabled = estado.processando || estado.etapa !== 'produto';
  }

  function atualizarContadorTitulo(){
    const el = elementos().titulo;
    if (!el) return;
    const nome = APP.inventario?.auditoria_nome || APP.inventario?.nome || auditoriaId() || 'Auditoria';
    el.textContent = `${nome} · ${listaAuditoria().length} pendente(s)`;
  }

  function irParaEndereco(){
    if (estado.timerRetorno) clearTimeout(estado.timerRetorno);
    estado = { etapa: 'endereco', item: null, processando: false, timerRetorno: null };
    const el = elementos();
    if (el.etapaEndereco) el.etapaEndereco.style.display = '';
    if (el.etapaProduto) el.etapaProduto.style.display = 'none';
    if (el.endereco) { el.endereco.disabled = false; el.endereco.value = ''; }
    if (el.produto) { el.produto.disabled = true; el.produto.value = ''; }
    if (el.feedbackEndereco) { el.feedbackEndereco.style.display = 'none'; el.feedbackEndereco.textContent = ''; }
    if (el.feedbackFinal) { el.feedbackFinal.style.display = 'none'; el.feedbackFinal.textContent = ''; }
    atualizarContadorTitulo();
    setTimeout(() => el.endereco?.focus(), 60);
  }

  function irParaProduto(item){
    estado.etapa = 'produto';
    estado.item = item;
    const el = elementos();
    if (el.etapaEndereco) el.etapaEndereco.style.display = 'none';
    if (el.etapaProduto) el.etapaProduto.style.display = '';
    if (el.enderecoConfirmado) el.enderecoConfirmado.textContent = texto(item.endereco);
    if (el.produto) { el.produto.disabled = false; el.produto.value = ''; }
    if (el.feedbackFinal) { el.feedbackFinal.style.display = 'none'; el.feedbackFinal.textContent = ''; }
    setProcessando(false);
    setTimeout(() => el.produto?.focus(), 60);
  }

  function confirmarEnderecoAuditoria(){
    if (estado.processando || estado.etapa !== 'endereco') return;
    const el = elementos();
    const valor = texto(el.endereco?.value);
    if (!valor) {
      mostrarFeedbackEndereco('Bipe o endereço.', true);
      tocar('erro');
      el.endereco?.focus();
      return;
    }
    const item = encontrarEndereco(valor);
    if (!item) {
      mostrarFeedbackEndereco('Endereço não encontrado nesta auditoria.', true);
      tocar('erro');
      if (el.endereco) { el.endereco.select(); el.endereco.focus(); }
      return;
    }
    mostrarFeedbackEndereco('Endereço confirmado.', false);
    tocar('ok');
    irParaProduto(item);
  }

  function documentoId(item){
    return texto(item?.id || `${auditoriaId()}__${normalizarEndereco(item?.endereco)}`);
  }

  async function salvarResultado(status, produtoLido){
    if (estado.processando || !estado.item) return;
    const item = estado.item;
    const docId = documentoId(item);
    if (!docId || !auditoriaId()) {
      mostrarResultado('Não foi possível identificar a auditoria.', 'erro');
      tocar('erro');
      return;
    }

    setProcessando(true);
    const momento = agoraISO();
    const esperado = dunEsperado(item);
    const lido = status === STATUS_VAZIO ? null : texto(produtoLido);
    const nomeLido = status === STATUS_VAZIO ? null : localizarProdutoLido(lido);
    const payload = {
      auditoriaId: auditoriaId(),
      endereco: texto(item.endereco),
      dunEsperado: esperado,
      produtoEsperado: descricaoEsperada(item),
      dunLido: lido,
      produtoLido: nomeLido,
      status,
      operadorId: operadorUsuario(),
      operadorNome: operadorNome(),
      lidoEm: momento,
      loja: lojaAtual(),
      observacao: '',
      disponivel_coletor: false,
      atualizadoEm: momento
    };

    try {
      await FS.collection(FCOL.auditorias)
        .doc(auditoriaId())
        .collection('enderecos')
        .doc(docId)
        .set(payload, { merge: true });

      APP.auditorias = (APP.auditorias || []).filter(a => documentoId(a) !== docId);
      atualizarContadorTitulo();

      if (status === STATUS_OK) {
        mostrarResultado('Auditoria concluída.', 'ok');
        tocar('ok');
      } else if (status === STATUS_DIVERGENTE) {
        mostrarResultado('Produto divergente.', 'erro');
        tocar('erro');
      } else {
        mostrarResultado('Endereço registrado como vazio.', 'vazio');
        tocar('vazio');
      }

      estado.timerRetorno = setTimeout(irParaEndereco, 900);
    } catch(error) {
      console.error('[AUDITORIA] Erro ao salvar resultado:', error);
      mostrarResultado('Não foi possível salvar a auditoria.', 'erro');
      tocar('erro');
      setProcessando(false);
    }
  }

  function confirmarProdutoAuditoria(){
    if (estado.processando || estado.etapa !== 'produto' || !estado.item) return;
    const el = elementos();
    const lido = texto(el.produto?.value);
    if (!lido) {
      mostrarResultado('Bipe o produto.', 'erro');
      tocar('erro');
      el.produto?.focus();
      return;
    }
    const correto = normalizarCodigo(lido) === normalizarCodigo(dunEsperado(estado.item));
    salvarResultado(correto ? STATUS_OK : STATUS_DIVERGENTE, lido);
  }

  function registrarEnderecoVazio(){
    if (estado.processando || estado.etapa !== 'produto' || !estado.item) return;
    salvarResultado(STATUS_VAZIO, '');
  }

  function renderAuditoriaColetor(){
    atualizarContadorTitulo();
    irParaEndereco();
  }

  window.renderAuditoriaColetor = renderAuditoriaColetor;
  window.confirmarEnderecoAuditoria = confirmarEnderecoAuditoria;
  window.confirmarProdutoAuditoria = confirmarProdutoAuditoria;
  window.registrarEnderecoVazioAuditoria = registrarEnderecoVazio;

  // Substitui somente a abertura de Auditoria. Não chama resetContagem(),
  // Não chama nenhuma rotina de confirmação ou gravação do Inventário.
  window.selecionarAuditoriaMenu = async function(auditoriaSelecionadaId){
    const meta = (APP.auditoriasMenu || []).find(x => x.id === auditoriaSelecionadaId);
    if (!meta) { toast('Auditoria não encontrada', 'e'); return; }

    APP.modoPendente = 'auditoria';
    APP.modoAcesso = 'auditoria';
    APP.inventario = {
      id: auditoriaSelecionadaId,
      nome: meta.auditoria_nome || auditoriaSelecionadaId,
      auditoria_nome: meta.auditoria_nome || auditoriaSelecionadaId,
      status: 'ATIVO',
      auditoria_id: auditoriaSelecionadaId
    };
    APP.base = [];
    APP.auditoriaBase = [];
    APP.contagens = [];

    try {
      APP.auditorias = await window._carregarEnderecoAuditoria(auditoriaSelecionadaId);
      goScreen('app');
      const tabs = {
        contar: document.getElementById('tab-contar'),
        historico: document.getElementById('tab-historico'),
        recontagens: document.getElementById('tab-recontagens'),
        estorno: document.getElementById('tab-estorno'),
        auditoria: document.getElementById('tab-auditoria'),
        status: document.getElementById('tab-status')
      };
      if (tabs.contar) tabs.contar.style.display = 'none';
      if (tabs.historico) tabs.historico.style.display = 'none';
      if (tabs.recontagens) tabs.recontagens.style.display = 'none';
      if (tabs.estorno) tabs.estorno.style.display = 'none';
      if (tabs.auditoria) tabs.auditoria.style.display = '';
      if (tabs.status) tabs.status.style.display = '';
      showView('auditoria', tabs.auditoria);
      renderAuditoriaColetor();
    } catch(error) {
      console.error('[AUDITORIA] Erro ao abrir auditoria:', error);
      toast('Erro ao abrir auditoria: ' + error.message, 'e');
    }
  };

  function registrarEventosUmaVez(){
    if (window.__auditoriaFluxoEventosRegistrados) return;
    window.__auditoriaFluxoEventosRegistrados = true;

    document.addEventListener('click', event => {
      if (event.target.closest('#auditoria-confirmar-endereco')) confirmarEnderecoAuditoria();
      else if (event.target.closest('#auditoria-confirmar-produto')) confirmarProdutoAuditoria();
      else if (event.target.closest('#auditoria-endereco-vazio')) registrarEnderecoVazio();
    });

    document.addEventListener('keydown', event => {
      if (APP.modoAcesso !== 'auditoria' || event.key !== 'Enter') return;
      const id = document.activeElement?.id;
      if (id === 'auditoria-endereco') {
        event.preventDefault();
        event.stopImmediatePropagation();
        confirmarEnderecoAuditoria();
      } else if (id === 'auditoria-produto') {
        event.preventDefault();
        event.stopImmediatePropagation();
        confirmarProdutoAuditoria();
      }
    }, true);
  }

  registrarEventosUmaVez();
})();
