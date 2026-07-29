
(function(){
  function _auditoriaMeta(lista){
    return (lista || []).map(a => ({
      id: String(a.auditoria_id || a.id || '').trim(),
      auditoria_nome: a.nome || a.auditoria_nome || a.id || '',
      total_registros: Number(a.totalItens || a.total_registros || 0),
      lojas: Array.isArray(a.lojas) ? a.lojas : [],
      importado_em: a.importado_em || '',
      liberada: a.status === 'LIBERADA' || a.status === 'EM_ANDAMENTO' || !!a.liberada_coletor,
      tipoAuditoria: a.tipoAuditoria || a.tipo_auditoria || '',
      ruas: Array.isArray(a.ruas) ? a.ruas : [],
      familiaId: a.familiaId || a.familia_id || '',
      familiaNome: a.familiaNome || a.familia_nome || '',
      familiaCodigos: Array.isArray(a.familiaCodigos) ? a.familiaCodigos : [],
      disponivel_coletor: a.disponivel_coletor !== false
    })).filter(a => a.id && a.disponivel_coletor !== false && a.liberada);
  }
  window._extrairLojasDaAuditoria = function(aud){ return Array.isArray(aud?.lojas) ? aud.lojas : []; };

  function _normalizarEnderecoGeral(valor){
    return window.DTEnderecos?.chave(valor) || String(valor == null ? '' : valor).trim().toUpperCase();
  }

  async function _carregarBaseGeralEnderecosAuditoria(forcar){
    const lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
    const cacheKey = 'dt_auditoria_locais_' + lojaId;
    if (!forcar && APP._locaisDoFirebase && APP.locaisAtivos && APP.locaisAtivos.size) {
      return APP.locaisAtivos;
    }
    const locais = new Set();
    try {
      let versaoServidor = '';
      try {
        const meta = await FS.collection('dt_locais_meta').doc('versao').get();
        if (meta.exists) versaoServidor = String((meta.data() || {}).versao || '');
      } catch(e) {}
      const chunks = await FS.collection('dt_locais_chunks').orderBy('parte').get();
      if (!chunks.empty) {
        const todosDocs = chunks.docs;
        const docsDaVersao = versaoServidor ? todosDocs.filter(function(d){ return String((d.data() || {}).versao || '') === versaoServidor; }) : [];
        const docsSemVersao = todosDocs.filter(function(d){ return !(d.data() || {}).versao; });
        // Se nenhum chunk bater com a versão do meta (pode acontecer por latência entre a
        // escrita do meta e a leitura dos chunks) e não houver chunks legados sem versão,
        // usa todos os chunks existentes em vez de tratar a base como vazia.
        const docsUsar = docsDaVersao.length ? docsDaVersao : (docsSemVersao.length ? docsSemVersao : todosDocs);
        docsUsar.forEach(function(doc){
          const dados = doc.data() || {};
          const itens = dados.dados || dados.itens || dados.registros || [];
          itens.forEach(function(item){
            if (item && item.ativo === false) return;
            const endereco = _normalizarEnderecoGeral(item && (item.endereco || item.endereco_norm || item.codigo_endereco));
            if (endereco) locais.add(endereco);
          });
        });
      } else {
        const snap = await FS.collection(FCOL.locais).get();
        snap.docs.forEach(function(doc){
          const item = doc.data() || {};
          if (item.ativo === false) return;
          const endereco = _normalizarEnderecoGeral(item.endereco || item.endereco_norm || item.codigo_endereco || doc.id);
          if (endereco) locais.add(endereco);
        });
      }
      APP.locaisAtivos = locais;
      APP._locaisDoFirebase = true;
      try { localStorage.setItem(cacheKey, JSON.stringify(Array.from(locais))); } catch(e) {}
      console.log('[AUDITORIA] Base Geral de Endereços carregada:', locais.size, 'loja:', lojaId);
      return locais;
    } catch (erro) {
      console.warn('[AUDITORIA] Falha ao carregar Base Geral de Endereços:', erro);
      try {
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '[]');
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
    const audRef = FS.collection(FCOL.auditorias).doc(auditoriaId);
    // v15: auditoria também lê por chunks de 1000 para reduzir leituras.
    const chunkSnap = await audRef.collection('base_chunks').orderBy('parte').get();
    if (!chunkSnap.empty) {
      const rows = [];
      chunkSnap.docs.forEach(doc => {
        const d = doc.data();
        rows.push(...(d.dados || d.itens || d.registros || []));
      });
      APP.auditoriaProdutosMap = APP.auditoriaProdutosMap || {};
      rows.forEach(r => {
        const codigo = String(r.gtinEsperado || r.gtin_esperado || r.eanEsperado || r.ean_esperado || r.ean || r.gtin || r.dunEsperado || r.dun_esperado || r.dun || r.codigo_produto || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
        const nome = String(r.produtoEsperado || r.produto_esperado || r.produto_nome || r.descricao || r.produto || '').trim();
        if (codigo && nome) APP.auditoriaProdutosMap[codigo] = nome;
      });
      const resultadosSnap = await audRef.collection('enderecos').where('disponivel_coletor', '==', false).get();
      const finalizados = new Set();
      resultadosSnap.docs.forEach(doc => {
        const d = doc.data() || {};
        const status = String(d.status || '').toUpperCase();
        if (['OK','DIVERGENTE','ENDERECO_VAZIO'].includes(status) || d.disponivel_coletor === false) {
          finalizados.add(String(doc.id));
          finalizados.add((window.DTEnderecos?.chave(d.endereco) || String(d.endereco || '').trim().toUpperCase()));
        }
      });
      const pendentes = rows.filter(a => {
        const status = String(a.status || '').toUpperCase();
        const id = String(a.id || '');
        const endereco = (window.DTEnderecos?.chave(a.endereco) || String(a.endereco || '').trim().toUpperCase());
        return a.disponivel_coletor !== false &&
          !['OK','DIVERGENTE','ENDERECO_VAZIO'].includes(status) &&
          !finalizados.has(id) && !finalizados.has(endereco);
      });
      try {
        const lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
        localStorage.setItem('dt_auditoria_cache_' + lojaId + '_' + auditoriaId, JSON.stringify(pendentes));
      } catch(e) {}
      return pendentes;
    }
    // Fallback para auditorias antigas sem chunks.
    const snap = await audRef.collection('enderecos').get();
    const todos = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    APP.auditoriaProdutosMap = {};
    todos.forEach(r => {
      const codigo = String(r.gtinEsperado || r.gtin_esperado || r.eanEsperado || r.ean_esperado || r.ean || r.gtin || r.dunEsperado || r.dun_esperado || r.dun || r.codigo_produto || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
      const nome = String(r.produtoEsperado || r.produto_esperado || r.produto_nome || r.descricao || r.produto || '').trim();
      if (codigo && nome) APP.auditoriaProdutosMap[codigo] = nome;
    });
    return todos.filter(a => {
      const status = String(a.status || '').toUpperCase();
      return a.disponivel_coletor !== false && !['OK','DIVERGENTE','ENDERECO_VAZIO'].includes(status);
    });
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
    FS.collection(FCOL.auditorias)
      .where('liberada_coletor', '==', true)
      .get()
      .then(snap => {
        const docs = snap.docs.map(d => ({ id:d.id, ...d.data() }));
        const grupos = _auditoriaMeta(docs);
        APP.auditoriasMenu = grupos;
        localStorage.setItem('auditorias_menu_cache_v2', JSON.stringify(grupos));
        renderListaAuditorias(grupos);
      })
      .catch(() => fromCache());
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
      <div class="inv-card" onclick="selecionarAuditoriaMenu('${aud.id}')">
        <div class="inv-card-code">${escHTML(aud.id)}</div>
        <div class="inv-card-name">Auditoria — ${escHTML(aud.auditoria_nome || aud.id)}</div>
        <div class="inv-card-meta">
          <span class="badge badge-info">📝 Auditoria</span>
          <span class="badge badge-muted">${aud.total_registros || 0} endereços</span>
          ${aud.lojas?.[0] ? `<span class="badge badge-muted">${escHTML(aud.lojas[0])}</span>` : ''}
        </div>
      </div>
    `).join('');
  };

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
    goScreen('coleta');
    if(audTab) showView('auditoria',audTab);
    renderAuditoriaColetor();
  };

  window.selecionarAuditoriaMenu = async function(auditoriaId){
    if(APP._auditoriaCarregando) return;
    const meta = (APP.auditoriasMenu || []).find(x => x.id === auditoriaId);
    if (!meta) { toast('Auditoria não encontrada', 'e'); return; }
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
      let produtos=await window.DTProdutos.carregar(false);
      if(token!==APP._auditoriaCargaToken) return;
      let totalProdutos=(produtos||[]).filter(p=>p&&p.ativo!==false).length;
      if(!totalProdutos){
        // Uma falha passageira de rede pode ter derrubado o download antes da hora —
        // tenta mais uma vez forçando atualização antes de dizer que está vazia.
        if(typeof _dlStep==='function') _dlStep('aud-prod','📦','Base Geral de Produtos','Nova tentativa…','run');
        await new Promise(r=>setTimeout(r,1500));
        produtos=await window.DTProdutos.carregar(true);
        if(token!==APP._auditoriaCargaToken) return;
        totalProdutos=(produtos||[]).filter(p=>p&&p.ativo!==false).length;
      }
      if(!totalProdutos) throw new Error('Não foi possível baixar a Base Geral de Produtos (verifique a conexão com a internet e tente novamente). Se o problema continuar, confirme com o analista se a base de produtos foi publicada.');
      if(typeof _dlStep==='function') _dlStep('aud-prod','📦','Base Geral de Produtos',totalProdutos+' produtos carregados','ok');

      if(typeof _dlStep==='function') _dlStep('aud-end','📍','Base Geral de Endereços','Baixando endereços da loja…','run');
      if(typeof _dlProg==='function') _dlProg(45,'Baixando Base Geral de Endereços…');
      let locais=await _carregarBaseGeralEnderecosAuditoria(false);
      if(token!==APP._auditoriaCargaToken) return;
      let totalLocais=locais&&typeof locais.size==='number'?locais.size:0;
      if(!totalLocais){
        // Idem: pode ser uma falha passageira de rede — tenta mais uma vez antes de desistir.
        if(typeof _dlStep==='function') _dlStep('aud-end','📍','Base Geral de Endereços','Nova tentativa…','run');
        await new Promise(r=>setTimeout(r,1500));
        locais=await _carregarBaseGeralEnderecosAuditoria(true);
        if(token!==APP._auditoriaCargaToken) return;
        totalLocais=locais&&typeof locais.size==='number'?locais.size:0;
      }
      if(!totalLocais) throw new Error('Não foi possível baixar a Base Geral de Endereços (verifique a conexão com a internet e tente novamente). Se o problema continuar, confirme com o analista se os endereços foram publicados.');
      if(typeof _dlStep==='function') _dlStep('aud-end','📍','Base Geral de Endereços',totalLocais+' endereços carregados','ok');

      if(typeof _dlStep==='function') _dlStep('aud-base','📝','Base da Auditoria','Baixando endereços pendentes…','run');
      if(typeof _dlProg==='function') _dlProg(75,'Baixando Base da Auditoria…');
      APP.auditorias=await _carregarEnderecoAuditoria(auditoriaId);
      if(token!==APP._auditoriaCargaToken) return;
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
