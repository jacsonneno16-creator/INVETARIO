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
    const meta=(APP.auditoriasMenu||[]).find(function(x){return texto(x&&x.id)===texto(auditoriaId());})||{};
    return texto(APP.inventario?.loja_id || APP.inventario?.lojaId || (Array.isArray(APP.inventario?.lojas) && APP.inventario.lojas[0]) || meta.loja_id || meta.lojaId || (Array.isArray(meta.lojas) && meta.lojas[0]) || meta.loja || window.getDTLojaAtiva?.() || APP.lojaAtual?.id || APP.lojaId || APP.inventario?.loja);
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

  function localizarProdutoLido(codigoLido){
    const globalProduto = window.DTProdutos?.buscarSync(codigoLido);
    if (globalProduto?.encontrado) return texto(globalProduto.nomeProduto);
    return 'Produto não identificado';
  }

  function encontrarEndereco(valor){
    const alvo = normalizarEndereco(valor);
    if (!alvo) return null;
    const previsto=listaAuditoria().find(function(item){return normalizarEndereco(item.endereco||item.endereco_norm)===alvo;});
    if(previsto)return previsto;
    if(APP.locaisAtivos&&APP.locaisAtivos.has(alvo))return {id:auditoriaId()+'__'+alvo,endereco:texto(valor),foraAuditoria:true,disponivel_coletor:true};
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
    if (itemAnterior) liberarLockAuditoria(itemAnterior).catch(function(error){ console.warn("[Falha assíncrona]", error); });
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
  function chaveConcluidosAuditoria(audId){
    const loja=lojaAtual();
    return 'dt_auditoria_concluidos_'+String(loja||'')+'_'+String(audId||'');
  }
  async function marcarConcluidoLocalAuditoria(docId,payload){
    const chave=chaveConcluidosAuditoria(auditoriaId());
    let registros=[];
    try{ registros=await window.DTAuditoriaStorage.cacheGet(chave); }catch(_){ registros=[]; }
    if(!Array.isArray(registros)) registros=[];
    registros=registros.filter(function(x){ return texto(x&&x.id)!==texto(docId); });
    registros.unshift({id:docId,payload:payload||{},salvoEm:agoraISO()});
    if(registros.length>5000) registros.length=5000;
    await window.DTAuditoriaStorage.cacheSet(chave,registros);
  }
  async function enfileirarAuditoria(docId,payload,subcolecao){
    const audId=auditoriaId();
    const registro={
      chave:chaveRegistroAuditoria(audId,subcolecao,docId),
      docId:docId,
      auditoriaId:audId,
      subcolecao:subcolecao||'enderecos',
      payload:payload,
      lojaId:lojaAtual(),
      criadoEm:agoraISO()
    };
    await window.DTAuditoriaStorage.filaPut(registro);
    return registro;
  }
  // SINCRONIZADOR DE AUDITORIA V2
  // A leitura sempre e confirmada primeiro no IndexedDB. O envio e idempotente,
  // independente de turno/inventario e nunca muda a tela atual do operador.
  let _sincronizandoAuditoria=false;
  let _timerRetryAuditoria=null;
  const AUDITORIA_SYNC_TIMEOUT_MS=30000;
  const AUDITORIA_RETRY_BASE_MS=5000;

  function comTimeoutAuditoria(promise,ms){
    return new Promise(function(resolve,reject){
      let terminou=false;
      const timer=setTimeout(function(){
        if(terminou)return;
        terminou=true;
        const erro=new Error('O servidor demorou para confirmar a auditoria. O registro continua salvo no aparelho.');
        erro.code='auditoria/timeout';
        reject(erro);
      },ms);
      Promise.resolve(promise).then(function(valor){
        if(terminou)return; terminou=true; clearTimeout(timer); resolve(valor);
      },function(erro){
        if(terminou)return; terminou=true; clearTimeout(timer); reject(erro);
      });
    });
  }

  function atualizarEstadoFilaAuditoria(total,erro){
    try{
      localStorage.setItem('dt_auditoria_sync_pendente',String(Math.max(0,Number(total)||0)));
      if(erro) localStorage.setItem('dt_auditoria_ultimo_erro',JSON.stringify(erro));
      else if(Number(total)===0) localStorage.removeItem('dt_auditoria_ultimo_erro');
    }catch(_e){}
    try{ window.dispatchEvent(new CustomEvent('dt-auditoria-fila',{detail:{pendentes:Number(total)||0,erro:erro||null}})); }catch(_e){}
    if(typeof window.updateStats==='function') window.updateStats();
  }

  function agendarSyncAuditoria(atraso){
    if(_timerRetryAuditoria || !navigator.onLine)return;
    _timerRetryAuditoria=setTimeout(function(){
      _timerRetryAuditoria=null;
      sincronizarFilaAuditoria().catch(function(error){ console.warn('[AUDITORIA V2] retry:',error); });
    },Math.max(AUDITORIA_RETRY_BASE_MS,Number(atraso)||AUDITORIA_RETRY_BASE_MS));
  }

  async function migrarFilaAuditoriaLegada(){
    const chaves=[];
    for(let i=0;i<localStorage.length;i++){
      const chave=localStorage.key(i);
      if(chave && chave.indexOf('dt_auditoria_fila_')===0) chaves.push(chave);
    }
    for(const chaveLS of chaves){
      let fila=[];
      try{ fila=JSON.parse(localStorage.getItem(chaveLS)||'[]'); }catch(_e){}
      for(const antigo of fila){
        if(!antigo || !antigo.docId || !antigo.auditoriaId)continue;
        antigo.subcolecao=antigo.subcolecao||'enderecos';
        antigo.chave=antigo.chave||chaveRegistroAuditoria(antigo.auditoriaId,antigo.subcolecao,antigo.docId);
        antigo.criadoEm=antigo.criadoEm||agoraISO();
        antigo.tentativas=Number(antigo.tentativas||0);
        await window.DTAuditoriaStorage.filaPut(antigo);
      }
      try{localStorage.removeItem(chaveLS);}catch(_e){}
    }
  }

  async function aguardarAuthAuditoria(){
    if(window.DT_AUTH_USER_READY){ try{ await window.DT_AUTH_USER_READY; }catch(_e){} }
    const auth=window.AUTH || (firebase.app && firebase.app().auth ? firebase.app().auth() : null);
    let user=auth&&auth.currentUser;
    if(!user && auth){
      user=await new Promise(function(resolve){
        let finalizado=false;
        const timer=setTimeout(function(){if(!finalizado){finalizado=true;resolve(auth.currentUser||null);}},8000);
        const off=auth.onAuthStateChanged(function(u){if(!finalizado){finalizado=true;clearTimeout(timer);try{off();}catch(_e){}resolve(u||null);}});
      });
    }
    if(!user){ const e=new Error('Sessao do coletor nao confirmada. A auditoria continua salva e sera reenviada apos o login.');e.code='auditoria/auth-pendente';throw e; }
    await user.getIdToken().catch(function(){return null;});
    return user;
  }

  function dadosEnvioAuditoria(x){
    const p=x.payload||{};
    const meta=(APP.auditoriasMenu||[]).find(function(a){return texto(a&&a.id)===texto(x.auditoriaId);})||{};
    const lojaId=texto(x.lojaId||p.loja_id||p.lojaId||p.loja||meta.loja_id||meta.lojaId||(Array.isArray(meta.lojas)&&meta.lojas[0])||meta.loja);
    const base={
      protocolo:texto(x.chave)||chaveRegistroAuditoria(x.auditoriaId,x.subcolecao||'enderecos',x.docId),
      lojaId:lojaId,
      auditoriaId:texto(x.auditoriaId),
      itemId:texto(x.docId),
      endereco:texto(p.endereco),
      dunLido:texto(p.dunLido||p.gtinLido||p.codigoLido),
      produtoLido:texto(p.produtoLido||p.produto_lido),
      vazio:p.vazio===true,
      dispositivoId:texto(p.dispositivo_id||dispositivoId()),
      coletadoEm:texto(p.criadoEm||x.criadoEm||agoraISO())
    };
    if((x.subcolecao||'enderecos')==='ocorrencias') base.ocorrenciaId=base.itemId;
    return base;
  }

  async function enviarRegistroAuditoria(x){
    const ocorrencia=(x.subcolecao||'enderecos')==='ocorrencias';
    const nome=ocorrencia?'registrarOcorrenciaAuditoria':'registrarResultadoAuditoria';
    const callable=firebase.app().functions('southamerica-east1').httpsCallable(nome);
    const resposta=await comTimeoutAuditoria(callable(dadosEnvioAuditoria(x)),AUDITORIA_SYNC_TIMEOUT_MS);
    const data=resposta&&resposta.data||{};
    if(data.ok!==true)throw Object.assign(new Error(data.mensagem||'Servidor nao confirmou a auditoria.'),{code:data.codigo||'auditoria/sem-confirmacao'});
    return data;
  }

  async function sincronizarFilaAuditoria(){
    if(_sincronizandoAuditoria || !navigator.onLine)return;
    _sincronizandoAuditoria=true;
    let houveErro=false;
    try{
      await aguardarAuthAuditoria();
      let fila=await window.DTAuditoriaStorage.filaAll();
      atualizarEstadoFilaAuditoria(fila.length,null);
      for(const x of fila){
        if(!navigator.onLine)break;
        try{
          const data=await enviarRegistroAuditoria(x);
          const status=texto(data.status||'ENVIADO').toUpperCase();
          if((x.subcolecao||'enderecos')!=='ocorrencias'){
            const payloadFinal=Object.assign({},x.payload||{},{status:status,servidor_confirmado:true,servidor_confirmado_em:agoraISO()});
            await marcarConcluidoLocalAuditoria(x.docId,payloadFinal);
            const registro=(APP.contagens||[]).find(function(r){return texto(r&&r.id)===texto(x.docId);});
            if(registro){registro.status=status;registro.servidor_confirmado=true;}
          }
          await window.DTAuditoriaStorage.filaDelete(x.chave);
          try{window.dispatchEvent(new CustomEvent('dt-auditoria-sync',{detail:{id:x.docId,status:status,lojaId:data.lojaId||'',origem:data.origem||''}}));}catch(_e){}
        }catch(e){
          houveErro=true;
          x.tentativas=Number(x.tentativas||0)+1;
          x.ultimoErro={em:agoraISO(),codigo:texto(e&&e.code),mensagem:texto(e&&e.message||e)};
          try{await window.DTAuditoriaStorage.filaPut(x);}catch(_e){}
          atualizarEstadoFilaAuditoria((await window.DTAuditoriaStorage.filaAll()).length,{id:x.docId,auditoriaId:x.auditoriaId,tentativas:x.tentativas,...x.ultimoErro});
          console.error('[AUDITORIA V2] Registro preservado para novo envio:',x.ultimoErro,x);
          // Um registro antigo ou inconsistente nao bloqueia os demais.
          continue;
        }
      }
      fila=await window.DTAuditoriaStorage.filaAll();
      atualizarEstadoFilaAuditoria(fila.length,houveErro?undefined:null);
      if(fila.length)agendarSyncAuditoria(Math.min(60000,AUDITORIA_RETRY_BASE_MS*Math.max(1,Math.min(10,Number(fila[0].tentativas||1)))));
    }catch(e){
      houveErro=true;
      const fila=await window.DTAuditoriaStorage.filaAll().catch(function(){return[];});
      atualizarEstadoFilaAuditoria(fila.length,{em:agoraISO(),codigo:texto(e&&e.code),mensagem:texto(e&&e.message||e)});
      agendarSyncAuditoria(10000);
    }finally{
      _sincronizandoAuditoria=false;
    }
  }

  window.sincronizarFilaAuditoria=sincronizarFilaAuditoria;
  window.addEventListener('online',function(){
    if(_timerRetryAuditoria){clearTimeout(_timerRetryAuditoria);_timerRetryAuditoria=null;}
    // Somente sincroniza. Nao navega, nao mostra confirmacao e nao reinicia a auditoria.
    sincronizarFilaAuditoria().catch(function(error){console.warn('[AUDITORIA V2] online:',error);});
  });
  window.addEventListener('offline',function(){if(_timerRetryAuditoria){clearTimeout(_timerRetryAuditoria);_timerRetryAuditoria=null;}});
  migrarFilaAuditoriaLegada().then(function(){return window.DTAuditoriaStorage.filaAll();}).then(function(fila){
    atualizarEstadoFilaAuditoria(fila.length,null);
    if(navigator.onLine)sincronizarFilaAuditoria();
  }).catch(function(e){console.warn('[AUDITORIA V2] migracao:',e);});

  async function salvarOcorrenciaForaAuditoria(produtoLido){
    if (estado.processando || !estado.item) return;
    const item = estado.item;
    const momento = agoraISO();
    const lido = texto(produtoLido);
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
    try { window.dispatchEvent(new CustomEvent('dt-auditoria-ocorrencia',{detail:{id:docId,payload:payload}})); } catch(e){ console.warn("[Erro tratado]", e); }
    if(navigator.onLine) sincronizarFilaAuditoria().catch(function(error){ console.warn("[Falha assíncrona]", error); });
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
    const lido = status === STATUS_VAZIO ? null : texto(produtoLido);
    const nomeLido = status === STATUS_VAZIO ? null : localizarProdutoLido(lido);
    const payload = {
      auditoriaId: auditoriaId(),
      endereco: texto(item.endereco),
      dunLido: lido,
      produtoLido: nomeLido,
      loja: lojaAtual(),
      dispositivo_id: dispositivoId(),
      vazio: status === STATUS_VAZIO,
      criadoEm: momento
    };

    try {
      // Confirma primeiro no armazenamento durável do aparelho. A operação nunca
      // fica esperando o timeout da internet; a sincronização ocorre em paralelo.
      await enfileirarAuditoria(docId,payload,'enderecos');
      await marcarConcluidoLocalAuditoria(docId,payload);
      APP.auditorias = (APP.auditorias || []).filter(a => documentoId(a) !== docId);
      APP.contagens = (APP.contagens || []).filter(a => texto(a.id) !== docId);
      APP.contagens.unshift({id:docId,...payload});
      atualizarContadorTitulo();
      try { window.dispatchEvent(new CustomEvent('dt-auditoria-salva',{detail:{id:docId,payload:payload}})); } catch(e){ console.warn("[Erro tratado]", e); }

      mostrarResultado('Leitura registrada. A comparação será feita com segurança no servidor.',status===STATUS_VAZIO?'vazio':'ok');
      tocar(status===STATUS_VAZIO?'vazio':'ok');

      if(navigator.onLine) sincronizarFilaAuditoria().catch(function(error){ console.warn("[Falha assíncrona]", error); });
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
    if (estado.foraAuditoria || estado.item.foraAuditoria === true) {
      salvarOcorrenciaForaAuditoria(lido);
      return;
    }
    salvarResultado('PENDENTE_SERVIDOR',lido);
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
        liberarLockAuditoria(estado.item).catch(function(error){ console.warn("[Falha assíncrona]", error); });
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
