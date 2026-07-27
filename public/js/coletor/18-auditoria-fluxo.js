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
    timerRetorno: null,
    foraAuditoria: false
  };

  function texto(v){ return String(v == null ? '' : v).trim(); }
  function normalizarEndereco(v){
    return window.DTEnderecos?.chave(v) || texto(v).toUpperCase();
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

  const LOCK_TTL_MS = 10 * 60 * 1000;
  function dispositivoId(){ return localStorage.getItem('dt_device_id') || operadorUsuario() || 'SEM_DISPOSITIVO'; }
  function lockExpirado(dados){
    const bruto=dados?.lock_iniciado_em || dados?.iniciado_em || '';
    const data=bruto?.toDate ? bruto.toDate() : new Date(bruto || 0);
    return !data.getTime() || (Date.now()-data.getTime())>LOCK_TTL_MS;
  }
  async function reservarEnderecoAuditoria(item){
    // A operação do coletor não pode depender de uma transação de rede.
    // navigator.onLine também permanece true em vários Androids quando o Wi-Fi
    // perdeu acesso, fazendo a transação ficar pendurada por tempo indefinido.
    // A lista baixada e a fila local são a fonte de verdade durante a leitura.
    return !!item;
  }

  async function liberarLockAuditoria(item){
    return;
  }
  window.liberarLockAuditoriaAtual=function(){ return liberarLockAuditoria(estado.item); };

  function listaAuditoria(){
    return (APP.auditorias || []).filter(item => {
      const status = texto(item.status).toUpperCase();
      return item.disponivel_coletor !== false && !STATUS_FINAIS.has(status);
    });
  }

  function dunEsperado(item){
    return texto(item?.gtinEsperado || item?.gtin_esperado || item?.eanEsperado || item?.ean_esperado || item?.ean || item?.gtin || item?.dunEsperado || item?.dun_esperado || item?.dun || item?.codigoProduto || item?.codigo_produto);
  }

  function descricaoEsperada(item){
    return texto(item?.produtoEsperado || item?.produto_esperado || item?.descricaoProdutoEsperado || item?.produto_nome || item?.descricao || item?.produto);
  }

  function codigosEsperados(item){
    const valores=[item?.gtinEsperado,item?.gtin_esperado,item?.eanEsperado,item?.ean_esperado,item?.ean,item?.gtin,item?.dunEsperado,item?.dun_esperado,item?.dun,item?.codigoProduto,item?.codigo_produto,item?.codigoInterno,item?.codigo_interno];
    return Array.from(new Set(valores.map(normalizarCodigo).filter(Boolean)));
  }
  function mesmoProdutoDaBase(lido,item){
    const prodLido=window.DTProdutos?.buscarSync?.(lido)||{encontrado:false};
    if(!prodLido.encontrado)return false;
    const esperados=codigosEsperados(item);
    for(let i=0;i<esperados.length;i++){
      const prodEsp=window.DTProdutos?.buscarSync?.(esperados[i]);
      if(!prodEsp?.encontrado)continue;
      if(prodLido.id&&prodEsp.id&&prodLido.id===prodEsp.id)return true;
      const famL=normalizarCodigo(prodLido.familiaCodigo||prodLido.familiaNome||prodLido.produtoPrincipal);
      const famE=normalizarCodigo(prodEsp.familiaCodigo||prodEsp.familiaNome||prodEsp.produtoPrincipal);
      if(famL&&famE&&famL===famE&&texto(prodLido.embalagem).toUpperCase()===texto(prodEsp.embalagem).toUpperCase())return true;
    }
    const nomeEsperado=normalizarCodigo(descricaoEsperada(item));
    const nomeLido=normalizarCodigo(prodLido.nomeProduto);
    return !!(nomeEsperado&&nomeLido&&(nomeEsperado===nomeLido||nomeEsperado.includes(nomeLido)||nomeLido.includes(nomeEsperado)));
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
    const previsto=listaAuditoria().find(function(item){return normalizarEndereco(item.endereco||item.endereco_norm)===alvo;});
    if(previsto)return previsto;
    if(APP.locaisAtivos&&APP.locaisAtivos.has(alvo))return {id:auditoriaId()+'__'+alvo,endereco:texto(valor),dunEsperado:'',produtoEsperado:'ENDEREÇO PREVISTO VAZIO',previstoVazio:true,disponivel_coletor:true};
    return null;
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
    const itemAnterior = estado.etapa === 'produto' ? estado.item : null;
    if (itemAnterior) liberarLockAuditoria(itemAnterior).catch(function(){});
    estado = { etapa: 'endereco', item: null, processando: false, timerRetorno: null, foraAuditoria: false };
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


  async function consultarEnderecoNaBaseGeral(valor){
    const alvo = normalizarEndereco(valor);
    if (!alvo) return false;
    if (APP.locaisAtivos && APP.locaisAtivos.has(alvo)) return true;
    // A Base Geral já foi baixada antes de entrar na auditoria. Não consultar
    // Firebase durante o bip: isso mantém a etapa instantânea mesmo quando o
    // Android ainda reporta conexão após a queda do sinal.
    return false;
  }

  async function confirmarEnderecoAuditoria(){
    if (estado.processando || estado.etapa !== 'endereco') return;
    const el = elementos();
    const valor = texto(el.endereco?.value);
    if (!valor) {
      mostrarFeedbackEndereco('Bipe o endereço.', true);
      tocar('erro');
      el.endereco?.focus();
      return;
    }
    let item = encontrarEndereco(valor);
    let foraAuditoria = false;
    if (!item) {
      mostrarFeedbackEndereco('Verificando a Base Geral de Endereços baixada…', false);
      const existeNaBaseGeral = await consultarEnderecoNaBaseGeral(valor);
      if (existeNaBaseGeral) {
        const meta = (APP.auditoriasMenu || []).find(function(x){ return x.id === auditoriaId(); }) || {};
        const tipoProduto = texto(meta.tipoAuditoria || meta.tipo_auditoria).toLowerCase() === 'produto';
        if (tipoProduto) {
          const confirmar = window.confirm('Este endereço não faz parte da auditoria por produto. Deseja registrar uma ocorrência de produto encontrado fora dos endereços previstos?');
          if (!confirmar) {
            mostrarFeedbackEndereco('Endereço fora da auditoria. Ocorrência não registrada.', true);
            tocar('erro');
            if (el.endereco) { el.endereco.select(); el.endereco.focus(); }
            return;
          }
          foraAuditoria = true;
          item = {
            id: 'OCORRENCIA__' + auditoriaId() + '__' + normalizarEndereco(valor) + '__' + Date.now(),
            endereco: valor,
            dunEsperado: texto(meta.produtoCodigo || meta.produto_codigo || meta.gtin || meta.dun || meta.familiaId || ''),
            produtoEsperado: texto(meta.produtoNome || meta.produto_nome || meta.familiaNome || meta.nomeProduto || 'PRODUTO DA AUDITORIA'),
            foraAuditoria: true,
            disponivel_coletor: true
          };
        } else {
          mostrarFeedbackEndereco('Este endereço existe na base, mas não faz parte desta auditoria.', true);
          tocar('erro');
          if (el.endereco) { el.endereco.select(); el.endereco.focus(); }
          return;
        }
      }
    }
    if (!item) {
      mostrarFeedbackEndereco('Endereço não cadastrado na Base Geral de Endereços desta loja.', true);
      tocar('erro');
      if (el.endereco) { el.endereco.select(); el.endereco.focus(); }
      return;
    }
    estado.foraAuditoria = foraAuditoria || item.foraAuditoria === true;
    if (estado.foraAuditoria) {
      mostrarFeedbackEndereco('Endereço fora da auditoria confirmado. Bipe o produto encontrado.', false);
      tocar('ok');
      irParaProduto(item);
      return;
    }
    mostrarFeedbackEndereco('Reservando endereço para este coletor…', false);
    const reservado=await reservarEnderecoAuditoria(item);
    if(!reservado){
      mostrarFeedbackEndereco('Este endereço já está em conferência em outro coletor ou já foi finalizado.', true);
      tocar('erro');
      if(el.endereco){el.endereco.select();el.endereco.focus();}
      return;
    }
    mostrarFeedbackEndereco('Endereço confirmado.', false);
    tocar('ok');
    irParaProduto(item);
  }

  function documentoId(item){
    return texto(item?.id || `${auditoriaId()}__${normalizarEndereco(item?.endereco)}`);
  }


  function chaveRegistroAuditoria(audId,subcolecao,docId){ return [audId,subcolecao||'enderecos',docId].join('::'); }
  async function enfileirarAuditoria(docId,payload,subcolecao){
    const audId=auditoriaId();
    const registro={
      chave:chaveRegistroAuditoria(audId,subcolecao,docId),
      docId:docId,
      auditoriaId:audId,
      subcolecao:subcolecao||'enderecos',
      payload:payload,
      criadoEm:agoraISO()
    };
    await window.DTAuditoriaStorage.filaPut(registro);
    return registro;
  }
  let _sincronizandoAuditoria=false;
  let _timerRetryAuditoria=null;
  const AUDITORIA_SYNC_TIMEOUT_MS=12000;
  function comTimeoutAuditoria(promise,ms){
    return new Promise(function(resolve,reject){
      let finalizado=false;
      const timer=setTimeout(function(){
        if(finalizado)return;
        finalizado=true;
        const erro=new Error('Tempo limite de sincronização excedido');
        erro.code='auditoria/offline-timeout';
        reject(erro);
      },ms);
      Promise.resolve(promise).then(function(valor){
        if(finalizado)return;
        finalizado=true;
        clearTimeout(timer);
        resolve(valor);
      },function(erro){
        if(finalizado)return;
        finalizado=true;
        clearTimeout(timer);
        reject(erro);
      });
    });
  }
  function agendarSyncAuditoria(){
    if(_timerRetryAuditoria || !navigator.onLine)return;
    _timerRetryAuditoria=setTimeout(function(){
      _timerRetryAuditoria=null;
      sincronizarFilaAuditoria().catch(function(){});
    },15000);
  }
  async function migrarFilaAuditoriaLegada(){
    const chaves=[];
    for(let i=0;i<localStorage.length;i++){
      const chave=localStorage.key(i);
      if(chave && chave.indexOf('dt_auditoria_fila_')===0) chaves.push(chave);
    }
    for(let i=0;i<chaves.length;i++){
      const chaveLS=chaves[i];
      let fila=[];
      try{ fila=JSON.parse(localStorage.getItem(chaveLS)||'[]'); }catch(e){}
      for(let j=0;j<fila.length;j++){
        const x=fila[j]||{};
        if(!x.docId||!x.auditoriaId) continue;
        x.subcolecao=x.subcolecao||'enderecos';
        x.chave=chaveRegistroAuditoria(x.auditoriaId,x.subcolecao,x.docId);
        x.criadoEm=x.criadoEm||agoraISO();
        await window.DTAuditoriaStorage.filaPut(x);
      }
      try{localStorage.removeItem(chaveLS);}catch(e){}
    }
  }
  async function sincronizarFilaAuditoria(){
    if(_sincronizandoAuditoria || !navigator.onLine) return;
    _sincronizandoAuditoria=true;
    try{
      const fila=await window.DTAuditoriaStorage.filaAll();
      for(let i=0;i<fila.length;i++){
        const x=fila[i];
        try {
          await comTimeoutAuditoria(
            FS.collection(FCOL.auditorias).doc(x.auditoriaId).collection(x.subcolecao || 'enderecos').doc(x.docId).set(x.payload,{merge:true}),
            AUDITORIA_SYNC_TIMEOUT_MS
          );
          await window.DTAuditoriaStorage.filaDelete(x.chave);
        } catch(e) {
          console.warn('[AUDITORIA] Item permanece na fila offline:',x.docId,e);
          agendarSyncAuditoria();
          break;
        }
      }
    } finally {
      _sincronizandoAuditoria=false;
    }
  }
  window.sincronizarFilaAuditoria=sincronizarFilaAuditoria;
  window.addEventListener('online',function(){
    if(_timerRetryAuditoria){ clearTimeout(_timerRetryAuditoria); _timerRetryAuditoria=null; }
    sincronizarFilaAuditoria().catch(function(){});
  });
  window.addEventListener('offline',function(){
    if(_timerRetryAuditoria){ clearTimeout(_timerRetryAuditoria); _timerRetryAuditoria=null; }
  });
  migrarFilaAuditoriaLegada().then(function(){
    if(navigator.onLine) sincronizarFilaAuditoria();
  }).catch(function(e){console.warn('[AUDITORIA] Falha ao migrar fila antiga:',e);});

  async function salvarOcorrenciaForaAuditoria(produtoLido){
    if (estado.processando || !estado.item) return;
    const item = estado.item;
    const momento = agoraISO();
    const lido = texto(produtoLido);
    const prod = window.DTProdutos && window.DTProdutos.buscarSync ? window.DTProdutos.buscarSync(lido) : {encontrado:false};
    const meta = (APP.auditoriasMenu || []).find(function(x){ return x.id === auditoriaId(); }) || {};
    let produtoCorreto = false;
    if (prod.encontrado) {
      const famProd = normalizarCodigo(prod.familiaCodigo || prod.familiaNome || prod.produtoPrincipal);
      const famMeta = normalizarCodigo(meta.familiaId || meta.familiaNome || meta.produtoCodigo || meta.produtoNome || '');
      produtoCorreto = !!(famProd && famMeta && famProd === famMeta);
      if (!produtoCorreto) {
        const alvo = normalizarCodigo(meta.produtoCodigo || meta.gtin || meta.dun || '');
        produtoCorreto = !!(alvo && (normalizarCodigo(lido) === alvo || normalizarCodigo(prod.id) === alvo));
      }
    }
    if (!produtoCorreto) {
      mostrarResultado('O produto bipado não é o produto selecionado nesta auditoria. Bipe o produto correto.', 'erro');
      tocar('erro');
      const el = elementos(); if (el.produto) { el.produto.select(); el.produto.focus(); }
      return;
    }
    setProcessando(true);
    const docId = 'fora__' + normalizarEndereco(item.endereco) + '__' + Date.now();
    const payload = {
      auditoriaId: auditoriaId(),
      tipo: 'PRODUTO_FORA_AUDITORIA',
      status: 'PRODUTO_FORA_AUDITORIA',
      endereco: texto(item.endereco),
      produtoLido: localizarProdutoLido(lido),
      produto_lido: localizarProdutoLido(lido),
      codigoLido: lido,
      dunLido: lido,
      gtinLido: lido,
      produtoEsperado: texto(meta.produtoNome || meta.produto_nome || meta.familiaNome || 'PRODUTO DA AUDITORIA'),
      operador_id: operadorUsuario(),
      operador_nome: operadorNome(),
      dispositivo_id: dispositivoId(),
      loja: lojaAtual(),
      encontradoForaAuditoria: true,
      encontrado_em: momento,
      criadoEm: momento,
      atualizadoEm: momento
    };
    try { await enfileirarAuditoria(docId,payload,'ocorrencias'); }
    catch(error){
      console.error('[AUDITORIA] Falha ao persistir ocorrência no aparelho:',error);
      mostrarResultado('Não foi possível salvar no aparelho. Não prossiga e tente novamente.','erro');
      tocar('erro'); setProcessando(false); return;
    }
    mostrarResultado(navigator.onLine?'Ocorrência registrada no aparelho e aguardando sincronização.':'Ocorrência salva no coletor. Será enviada quando houver conexão.','vazio');
    tocar('vazio');
    try { window.dispatchEvent(new CustomEvent('dt-auditoria-ocorrencia',{detail:{id:docId,payload:payload}})); } catch(e) {}
    if(navigator.onLine) sincronizarFilaAuditoria().catch(function(){});
    estado.timerRetorno=setTimeout(irParaEndereco,1100);
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
      gtinLido: lido,
      gtin_lido: lido,
      eanLido: lido,
      ean_lido: lido,
      dunLido: lido,
      dun_lido: lido,
      codigoLido: lido,
      produtoLido: nomeLido,
      produto_lido: nomeLido,
      produtoNaoCadastrado: status !== STATUS_VAZIO && !(window.DTProdutos && window.DTProdutos.buscarSync && window.DTProdutos.buscarSync(lido).encontrado),
      status,
      operador_id: operadorUsuario(),
      operador_nome: operadorNome(),
      lidoEm: momento,
      lido_em: momento,
      loja: lojaAtual(),
      observacao: '',
      disponivel_coletor: false,
      em_andamento: false,
      dispositivo_id: dispositivoId(),
      finalizado_em: momento,
      atualizadoEm: momento
    };

    try {
      // Confirma primeiro no armazenamento durável do aparelho. A operação nunca
      // fica esperando o timeout da internet; a sincronização ocorre em paralelo.
      await enfileirarAuditoria(docId,payload,'enderecos');
      APP.auditorias = (APP.auditorias || []).filter(a => documentoId(a) !== docId);
      APP.contagens = (APP.contagens || []).filter(a => texto(a.id) !== docId);
      APP.contagens.unshift({id:docId,...payload});
      atualizarContadorTitulo();
      try { window.dispatchEvent(new CustomEvent('dt-auditoria-salva',{detail:{id:docId,payload:payload}})); } catch(e) {}

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

      if(navigator.onLine) sincronizarFilaAuditoria().catch(function(){});
      estado.timerRetorno = setTimeout(irParaEndereco, 900);
    } catch(error) {
      console.error('[AUDITORIA] Falha ao persistir resultado no aparelho:', error);
      mostrarResultado('Não foi possível salvar no aparelho. Não prossiga e tente novamente.', 'erro');
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
    if(!/^\d+$/.test(lido)){
      mostrarResultado('Código inválido. Bipe somente números, sem pontos, barras, espaços ou letras.','erro');
      tocar('erro');
      el.produto.select();
      el.produto.focus();
      return;
    }
    const prod=window.DTProdutos&&window.DTProdutos.buscarSync?window.DTProdutos.buscarSync(lido):{encontrado:false};
    const esperados=codigosEsperados(estado.item);
    let correto=esperados.indexOf(normalizarCodigo(lido))>=0||mesmoProdutoDaBase(lido,estado.item);
    const meta=(APP.auditoriasMenu||[]).find(function(x){return x.id===auditoriaId();})||{};
    if(meta.tipoAuditoria==='produto'&&meta.familiaId&&prod.encontrado){const famProd=normalizarCodigo(prod.familiaCodigo||prod.familiaNome);correto=famProd===normalizarCodigo(meta.familiaId)||famProd===normalizarCodigo(meta.familiaNome);}
    if(!prod.encontrado&&esperados.indexOf(normalizarCodigo(lido))<0)correto=false;
    if(estado.item.previstoVazio===true||!esperados.length)correto=false;
    if (estado.foraAuditoria || estado.item.foraAuditoria === true) {
      salvarOcorrenciaForaAuditoria(lido);
      return;
    }
    if(!prod.encontrado) mostrarResultado('Produto não cadastrado. Será registrado como divergente.','erro');
    salvarResultado(correto?STATUS_OK:STATUS_DIVERGENTE,lido);
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
  // A seleção e o carregamento obrigatório da Auditoria pertencem exclusivamente
  // ao módulo 17-auditoria-meta.js. Não sobrescrever selecionarAuditoriaMenu aqui.

  function registrarEventosUmaVez(){
    if (window.__auditoriaFluxoEventosRegistrados) return;
    window.__auditoriaFluxoEventosRegistrados = true;

    document.addEventListener('click', event => {
      const outraAba = event.target.closest('.nav-tab');
      if (outraAba && outraAba.id !== 'tab-auditoria' && APP.modoAcesso === 'auditoria' && estado.etapa === 'produto') {
        liberarLockAuditoria(estado.item).catch(function(){});
      }
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
