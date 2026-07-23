
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
    return String(valor == null ? '' : valor).trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  }

  async function _carregarBaseGeralEnderecosAuditoria(forcar){
    const lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
    const cacheKey = 'dt_auditoria_locais_' + lojaId;
    if (!forcar && APP._locaisDoFirebase && APP.locaisAtivos && APP.locaisAtivos.size) {
      return APP.locaisAtivos;
    }
    const locais = new Set();
    try {
      const chunks = await FS.collection('dt_locais_chunks').orderBy('parte').get();
      if (!chunks.empty) {
        chunks.docs.forEach(function(doc){
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
        const codigo = String(r.dunEsperado || r.dun_esperado || r.dun || r.codigo_produto || r.gtin || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
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
          finalizados.add(String(d.endereco || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,''));
        }
      });
      const pendentes = rows.filter(a => {
        const status = String(a.status || '').toUpperCase();
        const id = String(a.id || '');
        const endereco = String(a.endereco || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
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
      const codigo = String(r.dunEsperado || r.dun_esperado || r.dun || r.codigo_produto || r.gtin || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
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

  window.selecionarAuditoriaMenu = async function(auditoriaId){
    const meta = (APP.auditoriasMenu || []).find(x => x.id === auditoriaId);
    if (!meta) { toast('Auditoria não encontrada', 'e'); return; }
    APP.modoPendente = 'auditoria';
    APP.modoAcesso = 'auditoria';
    APP.inventario = { id: auditoriaId, nome: meta.auditoria_nome || auditoriaId, status: 'ATIVO', auditoria_id: auditoriaId };
    APP.base = [];
    APP.auditoriaBase = [];
    APP.contagens = [];
    try {
      _carregarBaseGeralEnderecosAuditoria(false).catch(function(){});
      const lojaId = window.getDTLojaAtiva ? window.getDTLojaAtiva() : '';
      let cacheAuditoria = [];
      try { cacheAuditoria = JSON.parse(localStorage.getItem('dt_auditoria_cache_' + lojaId + '_' + auditoriaId) || '[]'); } catch(e) {}
      if (cacheAuditoria.length) APP.auditorias = cacheAuditoria;
      else APP.auditorias = await _carregarEnderecoAuditoria(auditoriaId);
      if (cacheAuditoria.length) {
        _carregarEnderecoAuditoria(auditoriaId).then(function(lista){ APP.auditorias = lista; if (APP.modoAcesso === 'auditoria') renderAuditoriaColetor(); }).catch(function(){});
      }
      const audTab = document.getElementById('tab-auditoria');
      if (audTab) audTab.style.display = '';
      goScreen('coleta');
      if (audTab) showView('auditoria', audTab);
      renderAuditoriaColetor();
    } catch (err) {
      toast('Erro ao abrir auditoria: ' + err.message, 'e');
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
