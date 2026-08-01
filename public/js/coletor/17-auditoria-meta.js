
(function(){
  // Armazenamento próprio da auditoria. Bases e fila podem ultrapassar com
  // facilidade a pequena cota do localStorage em coletores Android.
  const AUD_DB = 'dt_auditoria_offline_db';
  const AUD_DB_VERSION = 1;
  let _audDb = null;
  function _audDbOpen(){
    if (_audDb) return Promise.resolve(_audDb);
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(AUD_DB,AUD_DB_VERSION);
      req.onupgradeneeded=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains('cache')) db.createObjectStore('cache',{keyPath:'chave'});
        if(!db.objectStoreNames.contains('fila')) db.createObjectStore('fila',{keyPath:'chave'});
      };
      req.onsuccess=e=>{ _audDb=e.target.result; resolve(_audDb); };
      req.onerror=e=>reject(e.target.error);
    });
  }
  async function _audStorePut(store,registro){
    const db=await _audDbOpen();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite');
      tx.objectStore(store).put(registro);
      tx.oncomplete=()=>resolve(registro);
      tx.onerror=e=>reject(e.target.error||tx.error);
      tx.onabort=e=>reject(e.target.error||tx.error);
    });
  }
  async function _audStoreGet(store,chave){
    const db=await _audDbOpen();
    return new Promise((resolve,reject)=>{
      const req=db.transaction(store,'readonly').objectStore(store).get(chave);
      req.onsuccess=e=>resolve(e.target.result||null);
      req.onerror=e=>reject(e.target.error);
    });
  }
  async function _audStoreAll(store){
    const db=await _audDbOpen();
    return new Promise((resolve,reject)=>{
      const req=db.transaction(store,'readonly').objectStore(store).getAll();
      req.onsuccess=e=>resolve(e.target.result||[]);
      req.onerror=e=>reject(e.target.error);
    });
  }
  async function _audStoreDelete(store,chave){
    const db=await _audDbOpen();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite');
      tx.objectStore(store).delete(chave);
      tx.oncomplete=()=>resolve();
      tx.onerror=e=>reject(e.target.error||tx.error);
    });
  }
  window.DTAuditoriaStorage={
    cacheSet:(chave,valor)=>_audStorePut('cache',{chave,valor,atualizadoEm:new Date().toISOString()}),
    cacheGet:async chave=>{ const r=await _audStoreGet('cache',chave); return r?r.valor:null; },
    filaPut:registro=>_audStorePut('fila',registro),
    filaAll:()=>_audStoreAll('fila'),
    filaDelete:chave=>_audStoreDelete('fila',chave)
  };


  const AUDITORIA_ABERTURA_TIMEOUT_MS = 10000;
  function _comTimeoutAberturaAuditoria(promise, ms, rotulo){
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tempo excedido ao carregar '+rotulo+'.')),ms||AUDITORIA_ABERTURA_TIMEOUT_MS))
    ]);
  }
  async function _produtosCacheAuditoria(){
    let lista=[];
    try{
      lista=await window.DTAuditoriaStorage.cacheGet('dt_produtos_cache__GLOBAL');
      if(!Array.isArray(lista)) lista=JSON.parse(localStorage.getItem('dt_produtos_cache__GLOBAL')||'[]');
      if(Array.isArray(lista)&&lista.length&&window.DTProdutos&&typeof window.DTProdutos.indexar==='function') window.DTProdutos.indexar(lista);
    }catch(e){ lista=[]; }
    return Array.isArray(lista)?lista:[];
  }
  async function _locaisCacheAuditoria(){
    const lojaId=window.getDTLojaAtiva?window.getDTLojaAtiva():'';
    const chave='dt_auditoria_locais_'+lojaId;
    let lista=[];
    try{
      lista=await window.DTAuditoriaStorage.cacheGet(chave);
      if(!Array.isArray(lista)) lista=JSON.parse(localStorage.getItem(chave)||'[]');
    }catch(e){ lista=[]; }
    const locais=new Set(Array.isArray(lista)?lista:[]);
    if(locais.size){ APP.locaisAtivos=locais; APP._locaisDoFirebase=false; }
    return locais;
  }
  async function _baseAuditoriaCache(auditoriaId){
    const lojaId=window.getDTLojaAtiva?window.getDTLojaAtiva():'';
    const chave='dt_auditoria_cache_'+lojaId+'_'+auditoriaId;
    try{
      const registro=await _audStoreGet('cache',chave);
      return { encontrado:!!registro, lista:registro&&Array.isArray(registro.valor)?registro.valor:[] };
    }catch(e){ return { encontrado:false, lista:[] }; }
  }

  function _statusAuditoriaDisponivel(status){
    return ['LIBERADA', 'ABERTA', 'ATIVA', 'ATIVO', 'EM_ANDAMENTO']
      .includes(String(status || '').trim().toUpperCase());
  }
  function _auditoriaMeta(lista){
    return (lista || []).map(a => ({
      id: String(a.auditoria_id || a.id || '').trim(),
      auditoria_nome: a.nome || a.auditoria_nome || a.id || '',
      total_registros: Number(a.totalItens || a.total_registros || 0),
      lojas: Array.isArray(a.lojas) ? a.lojas : [],
      importado_em: a.importado_em || '',
      liberada: _statusAuditoriaDisponivel(a.status) || a.liberada === true || a.liberada_coletor === true,
      tipoAuditoria: a.tipoAuditoria || a.tipo_auditoria || '',
      disponivel_coletor: a.disponivel_coletor !== false
    })).filter(a => a.id && a.disponivel_coletor !== false && a.liberada);
  }
  window._extrairLojasDaAuditoria = function(aud){ return Array.isArray(aud?.lojas) ? aud.lojas : []; };

  function _normalizarEnderecoGeral(valor){
    return window.DTEnderecos?.chave(valor) || String(valor == null ? '' : valor).trim().toUpperCase();
  }

  function _hidratarMapaProdutosAuditoria(rows){
    APP.auditoriaProdutosMap = {};
    return APP.auditoriaProdutosMap;
  }
  window._hidratarMapaProdutosAuditoria = _hidratarMapaProdutosAuditoria;

  async function _carregarBaseGeralEnderecosAuditoria(forcar){
    const lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
    const cacheKey = 'dt_auditoria_locais_' + lojaId;
    if (!forcar && APP._locaisDoFirebase && APP.locaisAtivos && APP.locaisAtivos.size) {
      return APP.locaisAtivos;
    }
    if(!navigator.onLine){
      try{
        let cache=await window.DTAuditoriaStorage.cacheGet(cacheKey);
        if(!Array.isArray(cache)) cache=JSON.parse(localStorage.getItem(cacheKey)||'[]');
        APP.locaisAtivos=new Set(cache);
        APP._locaisDoFirebase=false;
        return APP.locaisAtivos;
      }catch(e){
        APP.locaisAtivos=APP.locaisAtivos||new Set();
        return APP.locaisAtivos;
      }
    }
    const locais = new Set();
    try {
      let versaoServidor = '';
      try {
        const meta = await FS.collection('dt_locais_meta').doc('versao').get();
        if (meta.exists) versaoServidor = String((meta.data() || {}).versao || '');
      } catch(e){ console.warn("[Erro tratado]", e); }
      if (!versaoServidor) throw new Error('Versão da Base Geral de Endereços não encontrada.');
      const chunks = await FS.collection('dt_locais_chunks').where('versao','==',versaoServidor).get();
      if (chunks.empty) throw new Error('Base Geral de Endereços em chunks não publicada para a versão atual.');
      const docsUsar = chunks.docs.slice().sort(function(a,b){ return Number((a.data()||{}).parte||0)-Number((b.data()||{}).parte||0); });
      docsUsar.forEach(function(doc){
        const dados = doc.data() || {};
        const itens = dados.dados || dados.itens || dados.registros || [];
        itens.forEach(function(item){
          if (item && item.ativo === false) return;
          const endereco = _normalizarEnderecoGeral(item && (item.endereco || item.endereco_norm || item.codigo_endereco));
          if (endereco) locais.add(endereco);
        });
      });
      APP.locaisAtivos = locais;
      APP._locaisDoFirebase = true;
      try {
        await window.DTAuditoriaStorage.cacheSet(cacheKey, Array.from(locais));
        localStorage.removeItem(cacheKey);
      } catch(e) {
        console.warn('[AUDITORIA] Não foi possível persistir a base de endereços no IndexedDB:',e);
      }
      console.log('[AUDITORIA] Base Geral de Endereços carregada:', locais.size, 'loja:', lojaId);
      return locais;
    } catch (erro) {
      console.warn('[AUDITORIA] Falha ao carregar Base Geral de Endereços:', erro);
      if((erro && (erro.code==='permission-denied' || /permission/i.test(erro.message||''))) || !AUTH.currentUser){
        throw new Error('Sessão expirada ou sem permissão no Firebase. Volte ao login e entre novamente.');
      }
      try {
        let cache = await window.DTAuditoriaStorage.cacheGet(cacheKey);
        if(!Array.isArray(cache)) cache = JSON.parse(localStorage.getItem(cacheKey) || '[]');
        APP.locaisAtivos = new Set(cache);
      } catch(e) {
        APP.locaisAtivos = APP.locaisAtivos || new Set();
      }
      APP._locaisDoFirebase = false;
      return APP.locaisAtivos;
    }
  }
  window._carregarBaseGeralEnderecosAuditoria = _carregarBaseGeralEnderecosAuditoria;

  async function _carregarEnderecoAuditoria(auditoriaId){
    const lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
    const cacheKey = 'dt_auditoria_cache_' + lojaId + '_' + auditoriaId;
    if(!navigator.onLine){
      const cache = await window.DTAuditoriaStorage.cacheGet(cacheKey);
      if(Array.isArray(cache) && cache.length) return cache;
    }
    const audRef = FS.collection(FCOL.auditorias).doc(auditoriaId);
    const snap = await audRef.collection('itens_coletor').where('disponivel_coletor','==',true).get();
    const pendentes = snap.docs.map(d => ({id:d.id,...d.data()}));
    // A base cega contém somente endereço e identificador opaco. Nenhum código,
    // produto ou critério esperado é persistido no dispositivo.
    APP.auditoriaProdutosMap = {};
    try { await window.DTAuditoriaStorage.cacheSet(cacheKey, pendentes); } catch(e){ console.warn("[Erro tratado]", e); }
    return pendentes;
  }
  window._carregarEnderecoAuditoria = _carregarEnderecoAuditoria;

  window.carregarAuditoriasMenu = function(){
    const el = document.getElementById('aud-list-menu');
    if (!el) return;
    el.innerHTML = '<div class="empty-inv"><div class="empty-inv-icon" style="font-size:1.5rem">⏳</div><div>Carregando auditorias…</div></div>';
    const fromCache = () => {
      const cache = JSON.parse(localStorage.getItem('auditorias_menu_cache_v2') || '[]');
      APP.auditoriasMenu = cache;
      renderListaAuditorias(cache);
    };
    if (!navigator.onLine) { fromCache(); return; }
    // Busca os metadados autorizados e normaliza os estados no cliente. A tela
    // administrativa historicamente gravou LIBERADA, ABERTA, ATIVA e
    // EM_ANDAMENTO; filtrar por um único texto fazia auditorias válidas sumirem.
    FS.collection('dt_auditorias_coletor').get()
      .then(snap => {
        const docs = snap.docs.map(d => ({ id:d.id, ...d.data() }));
        const grupos = _auditoriaMeta(docs);
        APP.auditoriasMenu = grupos;
        localStorage.setItem('auditorias_menu_cache_v2', JSON.stringify(grupos));
        renderListaAuditorias(grupos);
      })
      .catch(err => {
        console.error('[Auditorias] Falha ao consultar Firebase:', err?.code, err?.message || err);
        const cache = JSON.parse(localStorage.getItem('auditorias_menu_cache_v2') || '[]');
        if (cache.length) {
          APP.auditoriasMenu = cache;
          renderListaAuditorias(cache);
          toast('Auditorias carregadas do cache. Firebase: ' + (err?.code || 'erro'), 'w');
          return;
        }
        el.innerHTML = `<div class="empty-inv" style="gap:8px">
          <div class="empty-inv-icon">❌</div>
          <div style="font-size:.85rem;font-weight:600">Sem acesso às auditorias no Firebase</div>
          <div style="font-size:.72rem;color:#f87171;text-align:center;word-break:break-all">${escHTML(err?.code || err?.message || 'erro desconhecido')}</div>
          <button onclick="carregarAuditoriasMenu()" style="margin-top:8px;background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:.8rem;cursor:pointer">Tentar novamente</button>
        </div>`;
      });
  };

  window.renderListaAuditorias = function(lista){
    const el = document.getElementById('aud-list-menu');
    if (!el) return;
    lista = lista || APP.auditoriasMenu || [];
    const select = document.getElementById('aud-loja-select');
    const lojas = [...new Set((lista || []).flatMap(x => _extrairLojasDaAuditoria(x)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    if (select) {
      const atual = APP.lojaFiltroAuditoria || '';
      select.innerHTML = '<option value="">Todas as lojas</option>' + lojas.map(loja => `<option value="${escHTML(loja)}">${escHTML(loja)}</option>`).join('');
      select.value = atual;
    }
    const card = document.getElementById('aud-loja-card');
    if (card) card.style.display = lojas.length > 1 ? '' : 'none';
    if (APP.lojaFiltroAuditoria) lista = (lista || []).filter(x => _extrairLojasDaAuditoria(x).includes(APP.lojaFiltroAuditoria));
    if (!lista.length) {
      el.innerHTML = '<div class="empty-inv"><div class="empty-inv-icon">📝</div><div style="font-size:.9rem;font-weight:600">Nenhuma auditoria disponível</div><div style="font-size:.78rem;margin-top:6px">Aguarde o analista liberar a auditoria</div></div>';
      return;
    }
    el.innerHTML = lista.map(aud => `
      <button type="button" class="inv-card aud-card-menu" data-auditoria-id="${escHTML(aud.id)}" style="width:100%;text-align:left">
        <div class="inv-card-code">${escHTML(aud.id)}</div>
        <div class="inv-card-name">Auditoria — ${escHTML(aud.auditoria_nome || aud.id)}</div>
        <div class="inv-card-meta">
          <span class="badge badge-info">📝 Auditoria</span>
          <span class="badge badge-muted">${aud.total_registros || 0} endereços</span>
          ${aud.lojas?.[0] ? `<span class="badge badge-muted">${escHTML(aud.lojas[0])}</span>` : ''}
        </div>
      </button>
    `).join('');
  };

  document.addEventListener('click', function(event){
    const card=event.target.closest('.aud-card-menu[data-auditoria-id]');
    if(!card || !document.getElementById('aud-list-menu')?.contains(card)) return;
    event.preventDefault();
    if(card.disabled || APP._auditoriaCarregando) return;
    const auditoriaId=String(card.dataset.auditoriaId||'').trim();
    if(!auditoriaId){ toast('Não foi possível identificar esta auditoria. Atualize a lista e tente novamente.','e'); return; }
    card.disabled=true;
    card.setAttribute('aria-busy','true');
    window.selecionarAuditoriaMenu(auditoriaId).catch(function(error){
      console.error('[AUDITORIA] Erro ao abrir cartão:',error);
      toast('Erro ao abrir auditoria: '+(error?.message||error),'e');
    }).finally(function(){
      card.disabled=false;
      card.removeAttribute('aria-busy');
    });
  });

  window.aplicarFiltroLojaAuditoria = function(loja) {
    APP.lojaFiltroAuditoria = String(loja || '').trim();
    renderListaAuditorias(APP.auditoriasMenu || []);
  };

  function _prepararTelaDownloadAuditoria(meta){
    const nome=document.getElementById('dl-inv-nome');
    const icon=document.getElementById('dl-icon');
    const steps=document.getElementById('dl-steps');
    const erro=document.getElementById('dl-erro');
    const entrar=document.getElementById('dl-btn-entrar');
    const cancelar=document.getElementById('dl-btn-cancel');
    if(nome) nome.textContent='Auditoria — '+(meta.auditoria_nome||meta.id||'');
    if(icon) icon.textContent='📝';
    if(steps) steps.innerHTML='';
    if(erro){ erro.style.display='none'; erro.textContent=''; }
    if(entrar){ entrar.style.display='none'; entrar.textContent='OK — iniciar auditoria'; entrar.onclick=window.entrarAuditoriaCarregada; }
    if(cancelar){ cancelar.style.display=''; cancelar.textContent='Cancelar'; cancelar.onclick=window.cancelarDownloadAuditoria; }
    if(typeof _dlProg==='function') _dlProg(2,'Preparando download da auditoria…');
    goScreen('download');
  }

  window.cancelarDownloadAuditoria=function(){
    APP._auditoriaCargaToken=(APP._auditoriaCargaToken||0)+1;
    APP._auditoriaCarregando=false;
    APP.modoAcesso=null;
    APP.modoPendente=null;
    APP.inventario=null;
    APP.auditorias=[];
    goScreen('auditorias');
  };

  window.entrarAuditoriaCarregada=function(){
    if(!APP._auditoriaPronta){ toast('Aguarde o carregamento completo da auditoria.','e'); return; }
    const audTab=document.getElementById('tab-auditoria');
    if(audTab) audTab.style.display='';
    goScreen('app');
    if(audTab) showView('auditoria',audTab);
    renderAuditoriaColetor();
  };

  window.selecionarAuditoriaMenu = async function(auditoriaId){
    if(APP._auditoriaCarregando) return;
    if(!window.AUTH || !AUTH.currentUser){
      // AUTH.currentUser pode ficar momentaneamente nulo enquanto o Firebase
      // restaura/renova a sessão. Abrir uma auditoria nunca deve apagar o
      // operador nem forçar logout do sistema por causa desse estado transitório.
      APP._auditoriaPronta=false;
      APP._auditoriaCarregando=false;
      try{ toast('Não foi possível confirmar a sessão agora. Aguarde alguns segundos e tente abrir a auditoria novamente.','e'); }catch(_){ console.warn("[Erro tratado]", _); }
      goScreen('auditorias');
      return;
    }
    const meta = (APP.auditoriasMenu || []).find(x => x.id === auditoriaId);
    if (!meta) { toast('Auditoria não encontrada', 'e'); return; }
    const lojasAuditoria = _extrairLojasDaAuditoria(meta);
    if (lojasAuditoria.length) {
      const lojaAuditoria = String(lojasAuditoria[0] || '').trim();
      if (lojaAuditoria && window.getDTLojaAtiva && window.getDTLojaAtiva() !== lojaAuditoria) {
        window.setDTLojaAtiva(lojaAuditoria);
        APP.locaisAtivos = new Set();
        APP._locaisDoFirebase = false;
        console.log('[AUDITORIA] Loja alterada para a loja da auditoria:', lojaAuditoria);
      }
    }
    APP._auditoriaCarregando=true;
    APP._auditoriaPronta=false;
    const token=(APP._auditoriaCargaToken||0)+1;
    APP._auditoriaCargaToken=token;
    APP.modoPendente = 'auditoria';
    APP.modoAcesso = 'auditoria';
    APP.inventario = { id: auditoriaId, nome: meta.auditoria_nome || auditoriaId, status: 'ATIVO', auditoria_id: auditoriaId };
    APP.base = [];
    APP.auditoriaBase = [];
    APP.contagens = [];
    _prepararTelaDownloadAuditoria(meta);
    try {
      if(typeof _dlStep==='function') _dlStep('aud-prod','📦','Base Geral de Produtos','Baixando produtos, GTIN, EAN e DUN…','run');
      if(typeof _dlProg==='function') _dlProg(10,'Baixando Base Geral de Produtos…');
      if(!window.DTProdutos || typeof window.DTProdutos.carregar!=='function') throw new Error('Serviço da Base Geral de Produtos não foi carregado.');
      // Rede com timeout; se falhar, usa imediatamente a base já persistida no aparelho.
      let produtos=[];
      if(navigator.onLine){
        try{ produtos=await _comTimeoutAberturaAuditoria(window.DTProdutos.carregar(true),AUDITORIA_ABERTURA_TIMEOUT_MS,'a Base Geral de Produtos'); }
        catch(e){ console.warn('[AUDITORIA] Produtos online indisponíveis; usando cache local:',e); }
      }
      if(token!==APP._auditoriaCargaToken) return;
      let totalProdutos=(produtos||[]).filter(p=>p&&p.ativo!==false).length;
      if(!totalProdutos){
        produtos=await _produtosCacheAuditoria();
        totalProdutos=(produtos||[]).filter(p=>p&&p.ativo!==false).length;
        if(totalProdutos&&typeof _dlStep==='function') _dlStep('aud-prod','📦','Base Geral de Produtos','Modo offline — '+totalProdutos+' produtos do aparelho','run');
      }
      if(!totalProdutos) throw new Error('Esta auditoria ainda não foi preparada neste aparelho. Conecte-se à internet uma vez para baixar a Base Geral de Produtos.');
      if(typeof _dlStep==='function') _dlStep('aud-prod','📦','Base Geral de Produtos',totalProdutos+' produtos carregados','ok');

      if(typeof _dlStep==='function') _dlStep('aud-end','📍','Base Geral de Endereços','Baixando endereços da loja…','run');
      if(typeof _dlProg==='function') _dlProg(45,'Baixando Base Geral de Endereços…');
      let locais=new Set();
      if(navigator.onLine){
        try{ locais=await _comTimeoutAberturaAuditoria(_carregarBaseGeralEnderecosAuditoria(true),AUDITORIA_ABERTURA_TIMEOUT_MS,'a Base Geral de Endereços'); }
        catch(e){ console.warn('[AUDITORIA] Endereços online indisponíveis; usando cache local:',e); }
      }
      if(token!==APP._auditoriaCargaToken) return;
      let totalLocais=locais&&typeof locais.size==='number'?locais.size:0;
      if(!totalLocais){
        locais=await _locaisCacheAuditoria();
        totalLocais=locais&&typeof locais.size==='number'?locais.size:0;
        if(totalLocais&&typeof _dlStep==='function') _dlStep('aud-end','📍','Base Geral de Endereços','Modo offline — '+totalLocais+' endereços do aparelho','run');
      }
      if(!totalLocais) throw new Error('Esta auditoria ainda não foi preparada neste aparelho. Conecte-se à internet uma vez para baixar a Base Geral de Endereços.');
      if(typeof _dlStep==='function') _dlStep('aud-end','📍','Base Geral de Endereços',totalLocais+' endereços carregados','ok');

      if(typeof _dlStep==='function') _dlStep('aud-base','📝','Base da Auditoria','Baixando endereços pendentes…','run');
      if(typeof _dlProg==='function') _dlProg(75,'Baixando Base da Auditoria…');
      let baseAuditoria=[];
      let baseObtidaOnline=false;
      if(navigator.onLine){
        try{
          baseAuditoria=await _comTimeoutAberturaAuditoria(_carregarEnderecoAuditoria(auditoriaId),AUDITORIA_ABERTURA_TIMEOUT_MS,'a Base da Auditoria');
          baseObtidaOnline=Array.isArray(baseAuditoria);
        }catch(e){ console.warn('[AUDITORIA] Base online indisponível; usando cache local:',e); }
      }
      if(token!==APP._auditoriaCargaToken) return;
      if(!baseObtidaOnline){
        const cacheAuditoria=await _baseAuditoriaCache(auditoriaId);
        if(!cacheAuditoria.encontrado) throw new Error('A base desta auditoria não está salva neste aparelho. Conecte-se à internet uma vez para fazer o primeiro download.');
        baseAuditoria=cacheAuditoria.lista;
        if(typeof _dlStep==='function') _dlStep('aud-base','📝','Base da Auditoria','Modo offline — '+baseAuditoria.length+' endereços pendentes no aparelho','run');
      }
      APP.auditorias=Array.isArray(baseAuditoria)?baseAuditoria:[];
      _hidratarMapaProdutosAuditoria(APP.auditorias);
      const totalAud=(APP.auditorias||[]).length;
      if(typeof _dlStep==='function') _dlStep('aud-base','📝','Base da Auditoria',totalAud+' endereços pendentes','ok');
      if(typeof _dlProg==='function') _dlProg(100,'Todas as informações foram carregadas.');

      APP._auditoriaPronta=true;
      const entrar=document.getElementById('dl-btn-entrar');
      if(entrar){ entrar.style.display=''; entrar.textContent='OK — iniciar auditoria'; entrar.onclick=window.entrarAuditoriaCarregada; }
      const cancelar=document.getElementById('dl-btn-cancel');
      if(cancelar) cancelar.style.display='none';
      const status=document.getElementById('dl-status-txt');
      if(status) status.textContent='Carregamento concluído. Toque em OK para continuar.';
    } catch (err) {
      console.error('[AUDITORIA] Falha ao preparar auditoria:',err);
      APP._auditoriaPronta=false;
      if(typeof _dlSetErro==='function') _dlSetErro(err.message||String(err));
      else toast('Erro ao abrir auditoria: '+(err.message||err),'e');
      const cancelar=document.getElementById('dl-btn-cancel');
      if(cancelar){ cancelar.style.display=''; cancelar.textContent='Voltar'; cancelar.onclick=window.cancelarDownloadAuditoria; }
      const entrar=document.getElementById('dl-btn-entrar');
      if(entrar) entrar.style.display='none';
    } finally {
      if(token===APP._auditoriaCargaToken) APP._auditoriaCarregando=false;
    }
  };

  const _oldVoltar = window._voltarInventarioConfirmado;
  window._voltarInventarioConfirmado = function(){
    const modo = APP.modoPendente;
    _oldVoltar && _oldVoltar();
    if (modo === 'auditoria') goScreen('auditorias');
  };

  document.addEventListener('DOMContentLoaded', function(){
    const subt = document.querySelector('#screen-auditorias .screen-sub');
    if (subt) subt.textContent = 'Selecione a auditoria liberada para conferência';
  });
})();
