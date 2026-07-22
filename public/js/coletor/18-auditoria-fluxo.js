
(function(){
  function norm(v){ return (window._audEndNorm ? window._audEndNorm(v) : String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')); }
  function getAuditoriaPendentePorEndereco(endereco){
    const endNorm = norm(endereco);
    return (APP.auditorias || []).find(a => norm(a.endereco || a.endereco_norm || '') === endNorm && a.disponivel_coletor !== false);
  }
  function getAuditoriaItemPorDun(endereco, dun){
    const endNorm = norm(endereco || APP.atual?.endereco || '');
    const dunNorm = String(dun || '').replace(/\D+/g,'');
    if (!dunNorm) return { pend: null, item: null };
    const pend = (APP.auditorias || []).find(a =>
      a.disponivel_coletor !== false &&
      (!endNorm || norm(a.endereco || a.endereco_norm || '') === endNorm) &&
      ((a.itens || []).some(it => String(it.dun || '').replace(/\D+/g,'') === dunNorm) ||
       (a.itens_confirmados || []).some(it => String(it.dun || '').replace(/\D+/g,'') === dunNorm))
    ) || getAuditoriaPendentePorEndereco(endereco || APP.atual?.endereco || '');
    const item = (pend?.itens || []).find(it => String(it.dun || '').replace(/\D+/g,'') === dunNorm) || null;
    return { pend, item };
  }
  function getAuditoriaAtualNome(){
    return APP.inventario?.nome || APP.inventario?.auditoria_nome || APP.inventario?.id || 'Auditoria';
  }
  function setAuditSubtitle(){
    const subt = document.querySelector('#view-contar .view-sub');
    if (subt) subt.textContent = 'Bipe endereço, capa/palete, DUM e quantidade. Após informar o endereço, use “endereço vazio” quando não houver produto.';
  }
  function ensureAuditHint(){
    const wrap = document.getElementById('view-contar');
    if (!wrap) return;
    let box = document.getElementById('audit-manual-hint');
    if (!box) {
      box = document.createElement('div');
      box.id = 'audit-manual-hint';
      box.style.cssText = 'margin-bottom:10px;background:rgba(232,117,26,.08);border:1px solid rgba(232,117,26,.24);border-radius:12px;padding:12px 14px';
      wrap.insertBefore(box, wrap.firstChild);
    }
    box.innerHTML = '<div style="font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:4px">Modo auditoria</div><div style="font-size:.82rem;color:var(--text)">'+esc(getAuditoriaAtualNome())+'</div><div style="font-size:.72rem;color:var(--muted);margin-top:4px">A conferência é manual por bipagem: endereço, capa/palete, DUM e quantidade.</div>';
    box.style.display = (APP.modoAcesso === 'auditoria') ? '' : 'none';
  }
  function applyAuditoriaCountLayout(){
    ensureAuditHint();
    setAuditSubtitle();
    const steps = document.getElementById('steps');
    if (steps) steps.style.display = (APP.modoAcesso === 'auditoria') ? 'none' : '';
    const mapa = {
      'step-endereco':'',
      'step-capa':'',
      'step-gtin':'',
      'step-validade':'none',
      'step-quantidade':''
    };
    Object.entries(mapa).forEach(([id,show]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = (APP.modoAcesso === 'auditoria') ? show : el.style.display;
    });
    const blocoTravado = document.getElementById('bloco-endereco-travado');
    if (blocoTravado && APP.modoAcesso === 'auditoria') blocoTravado.style.display = 'none';
    const painellote = document.getElementById('painel-lote');
    if (painellote && APP.modoAcesso === 'auditoria') painellote.style.display = 'none';
    const resumo = document.getElementById('resumo-atual');
    if (resumo && APP.modoAcesso === 'auditoria') resumo.style.display = 'none';
    const gtinLabel = document.getElementById('gtin-label-txt');
    if (gtinLabel && APP.modoAcesso === 'auditoria') gtinLabel.textContent = 'DUM';
    const fgtin = document.getElementById('f-gtin');
    if (fgtin && APP.modoAcesso === 'auditoria') {
      fgtin.placeholder = 'Bipe o DUM';
      fgtin.oninput = function(){ flashField('f-gtin'); };
    }
    const fend = document.getElementById('f-endereco');
    if (fend && APP.modoAcesso === 'auditoria') {
      fend.placeholder = 'Bipe o endereço';
      fend.oninput = function(){ this.value = this.value.toUpperCase(); flashField('f-endereco'); };
    }
    const fcapa = document.getElementById('f-capa');
    if (fcapa && APP.modoAcesso === 'auditoria') {
      fcapa.placeholder = 'Informe a capa/palete';
      fcapa.oninput = function(){ this.value = this.value.replace(/\D+/g,'').slice(0,7); flashField('f-capa'); };
    }
    const btnCapa = document.getElementById('btn-confirmar-capa');
    if (btnCapa && APP.modoAcesso === 'auditoria') btnCapa.textContent = 'Próximo →';
    const vazioWrap = document.getElementById('btn-vazio-wrap');
    if (vazioWrap && APP.modoAcesso === 'auditoria') vazioWrap.style.display = (APP.atual?.endereco ? '' : 'none');
    const btnQtd = document.getElementById('btn-confirmar-qty');
    if (btnQtd && APP.modoAcesso === 'auditoria') btnQtd.textContent = '✓ Confirmar contagem';
    const fqty = document.getElementById('f-qty');
    if (fqty && APP.modoAcesso === 'auditoria') fqty.placeholder = 'Informe a quantidade';
    const qtdDisplay = document.getElementById('f-qty-display');
    if (qtdDisplay && APP.modoAcesso === 'auditoria') qtdDisplay.placeholder = 'Quantidade';
    const btnCalc = document.getElementById('btn-toggle-calc');
    if (btnCalc) btnCalc.style.display = (APP.modoAcesso === 'auditoria') ? 'none' : '';
    const fbEnd = document.getElementById('fb-endereco'); if (fbEnd && APP.modoAcesso === 'auditoria') fbEnd.innerHTML = '';
    const fbG = document.getElementById('fb-gtin'); if (fbG && APP.modoAcesso === 'auditoria') fbG.innerHTML = '';
    const fbV = document.getElementById('fb-validade'); if (fbV && APP.modoAcesso === 'auditoria') fbV.innerHTML = '';
    const prodBox = document.getElementById('prod-found-box'); if (prodBox && APP.modoAcesso === 'auditoria') prodBox.style.display = 'none';
    const btnEndereco = document.getElementById('btn-confirmar-endereco'); if (btnEndereco && APP.modoAcesso === 'auditoria') btnEndereco.textContent = 'Próximo →';
    const btnGtin = document.getElementById('btn-confirmar-gtin'); if (btnGtin && APP.modoAcesso === 'auditoria') btnGtin.textContent = 'Próximo →';
  }

  const _oldSelecionarAuditoriaMenu = window.selecionarAuditoriaMenu;
  window.selecionarAuditoriaMenu = function(auditoriaId){
    const meta = (APP.auditoriasMenu || []).find(x => x.id === auditoriaId);
    if (!meta) { toast('Auditoria não encontrada', 'e'); return; }
    APP.modoPendente = 'auditoria';
    APP.modoAcesso = 'auditoria';
    APP.inventario = { id: auditoriaId, nome: meta.auditoria_nome || auditoriaId, status: 'ATIVO', auditoria_id: auditoriaId, auditoria_nome: meta.auditoria_nome || auditoriaId };
    APP.base = [];
    APP.auditoriaBase = [];
    APP.contagens = [];
    if (typeof _auditoriaListener === 'function') { try { _auditoriaListener(); } catch(e){} }
    _auditoriaListener = null;
    (window._carregarEnderecoAuditoria
      ? window._carregarEnderecoAuditoria(auditoriaId)
      : FS.collection(FCOL.auditorias).doc(auditoriaId).collection('enderecos').get().then(snap => snap.docs.map(d => ({ id:d.id, ...d.data() }))))
      .then(lista => {
        APP.auditorias = (lista || []).filter(a => a.disponivel_coletor !== false);
        goScreen('app');
        const contTab = document.getElementById('tab-contar');
        const histTab = document.getElementById('tab-historico');
        const recTab = document.getElementById('tab-recontagens');
        const estTab = document.getElementById('tab-estorno');
        const audTab = document.getElementById('tab-auditoria');
        const stTab = document.getElementById('tab-status');
        if (contTab) contTab.style.display = '';
        if (histTab) histTab.style.display = 'none';
        if (recTab) recTab.style.display = 'none';
        if (estTab) estTab.style.display = 'none';
        if (audTab) audTab.style.display = 'none';
        if (stTab) stTab.style.display = '';
        resetContagem();
        applyAuditoriaCountLayout();
        if (contTab) showView('contar', contTab);
      }).catch(err => toast('Erro ao abrir auditoria: ' + err.message, 'e'));
  };

  const _oldAplicarInventario = window._aplicarInventario;
  window._aplicarInventario = async function(inv, modo){
    const out = await _oldAplicarInventario.apply(this, arguments);
    if ((modo || APP.modoAcesso) === 'auditoria') {
      const contTab = document.getElementById('tab-contar');
      const histTab = document.getElementById('tab-historico');
      const recTab = document.getElementById('tab-recontagens');
      const estTab = document.getElementById('tab-estorno');
      const audTab = document.getElementById('tab-auditoria');
      if (contTab) contTab.style.display = '';
      if (histTab) histTab.style.display = 'none';
      if (recTab) recTab.style.display = 'none';
      if (estTab) estTab.style.display = 'none';
      if (audTab) audTab.style.display = 'none';
      applyAuditoriaCountLayout();
      if (contTab) showView('contar', contTab);
    }
    return out;
  };

  const _oldReset = window.resetContagem;
  window.resetContagem = function(){
    const res = _oldReset.apply(this, arguments);
    if (APP.modoAcesso === 'auditoria') {
      APP.atual = APP.atual || {};
      APP.atual.step = 1;
      APP.atual.capa = '';
      APP.atual.validade = '';
      APP.atual.produtoAtual = null;
      const fqty = document.getElementById('f-qty'); if (fqty) fqty.value = '';
      const fqtyd = document.getElementById('f-qty-display'); if (fqtyd) fqtyd.value = '';
      const fcapa = document.getElementById('f-capa'); if (fcapa) fcapa.value = '';
      const fgtin = document.getElementById('f-gtin'); if (fgtin) fgtin.value = '';
      const fval = document.getElementById('f-validade'); if (fval) fval.value = '';
      const vazioWrap = document.getElementById('btn-vazio-wrap'); if (vazioWrap) vazioWrap.style.display = 'none';
      applyAuditoriaCountLayout();
      setTimeout(() => { const el = document.getElementById('f-endereco'); if (el) el.focus(); }, 80);
    }
    return res;
  };

  const _origConfirmarEndereco = window.confirmarEndereco;
  const _origConfirmarCapa = window.confirmarCapa;
  const _origConfirmarGtin = window.confirmarGtin;
  const _origConfirmarValidade = window.confirmarValidade;
  window.confirmarEndereco = function(){
    if (APP.modoAcesso !== 'auditoria') return _origConfirmarEndereco.apply(this, arguments);
    const el = document.getElementById('f-endereco');
    const val = (el?.value || '').trim().toUpperCase();
    if (!val) { toast('Bipe o endereço', 'e'); if (typeof beepErr === 'function') beepErr(); return; }
    APP.atual = APP.atual || {};
    APP.atual.endereco = val;
    APP.atual._endNorm = norm(val);
    const fb = document.getElementById('fb-endereco');
    const pend = getAuditoriaPendentePorEndereco(val);
    if (fb) fb.innerHTML = pend ? `<div class="fb ok">✓ Endereço encontrado na auditoria</div>` : `<div class="fb warn">⚠ Endereço não estava pendente na base — será registrado assim mesmo</div>`;
    const vazioWrap = document.getElementById('btn-vazio-wrap'); if (vazioWrap) vazioWrap.style.display = '';
    const cp = document.getElementById('f-capa'); if (cp) cp.focus();
  };
  window.confirmarCapa = function(){
    if (APP.modoAcesso !== 'auditoria') return _origConfirmarCapa.apply(this, arguments);
    const val = (document.getElementById('f-capa')?.value || '').trim();
    const n = parseInt(val, 10);
    if (!val || isNaN(n) || n < 1000000) { toast('Informe o número da capa/palete com no mínimo 7 dígitos', 'e'); if (typeof beepErr === 'function') beepErr(); return; }
    APP.atual = APP.atual || {};
    APP.atual.capa = val;
    const fb = document.getElementById('fb-capa');
    if (fb) fb.innerHTML = `<div class="fb ok">✓ Capa/Palete nº ${val}</div>`;
    const gt = document.getElementById('f-gtin'); if (gt) gt.focus();
  };
  window.confirmarGtin = function(){
    if (APP.modoAcesso !== 'auditoria') return _origConfirmarGtin.apply(this, arguments);
    const val = (document.getElementById('f-gtin')?.value || '').trim();
    if (!val) { toast('Bipe o DUN/DUM do produto', 'e'); if (typeof beepErr === 'function') beepErr(); return; }
    APP.atual = APP.atual || {};
    const dun = String(val).replace(/\D+/g,'') || normProd(val);
    const achado = getAuditoriaItemPorDun(APP.atual.endereco, dun);
    APP.atual.gtin = dun;
    APP.atual.dun = dun;
    APP.atual.produtoAtual = achado.item ? {
      descricao_produto: achado.item.produto_nome || achado.item.descricao_produto || '',
      codigo_produto: achado.item.codigo_produto || '',
      dun: achado.item.dun || dun,
      gtin: achado.item.dun || dun,
      _auditoria_item: achado.item
    } : { descricao_produto: '', codigo_produto: '', dun, gtin: dun, _nao_encontrado: true };
    const fb = document.getElementById('fb-gtin');
    if (fb) fb.innerHTML = achado.item
      ? `<div class="fb ok">✓ Produto identificado pelo DUN: ${esc(achado.item.produto_nome || achado.item.codigo_produto || dun)}</div>`
      : `<div class="fb warn">⚠ DUN não encontrado na base deste endereço — será registrado como ajuste</div>`;
    const q = document.getElementById('f-qty'); if (q) q.focus();
  };
  window.confirmarValidade = function(){
    if (APP.modoAcesso !== 'auditoria') return _origConfirmarValidade.apply(this, arguments);
    const q = document.getElementById('f-qty'); if (q) q.focus();
  };

  async function salvarAuditoriaManual(){
    const endereco = (document.getElementById('f-endereco')?.value || '').trim().toUpperCase();
    const capa = (document.getElementById('f-capa')?.value || '').trim();
    const dum = (document.getElementById('f-gtin')?.value || '').trim();
    const qtyRaw = (document.getElementById('f-qty')?.value || document.getElementById('f-qty-display')?.value || '').trim();
    const qty = parseInt(String(qtyRaw).replace(/\D+/g,''), 10);
    if (!endereco) { toast('Bipe o endereço', 'e'); return; }
    if (!capa) { toast('Informe a capa/palete', 'e'); return; }
    if (!dum) { toast('Bipe o DUM', 'e'); return; }
    if (!Number.isFinite(qty)) { toast('Informe a quantidade', 'e'); return; }
    const achado = getAuditoriaItemPorDun(endereco, dum);
    const pend = achado.pend || getAuditoriaPendentePorEndereco(endereco);
    const itemBase = achado.item || APP.atual?.produtoAtual?._auditoria_item || null;
    const docId = pend?.id || `${APP.inventario?.auditoria_id || APP.inventario?.id}__${norm(endereco)}__${String(dum).replace(/\D+/g,'')}`;
    const payload = {
      auditoria_id: pend?.auditoria_id || APP.inventario?.auditoria_id || APP.inventario?.id || '',
      auditoria_nome: pend?.auditoria_nome || getAuditoriaAtualNome(),
      inventario_id: '',
      inventario_nome: '',
      endereco: endereco,
      endereco_norm: norm(endereco),
      rua: pend?.rua || 'SEM RUA',
      itens_confirmados: [{
        codigo_produto: itemBase?.codigo_produto || '',
        produto_nome: itemBase?.produto_nome || itemBase?.descricao_produto || '',
        capa_palete: capa,
        data: itemBase?.data || '',
        dun: String(dum).replace(/\D+/g,'') || dum,
        quantidade: qty,
        quantidade_dun: qty
      }],
      confirmado_por: APP.operador?.name || '',
      confirmado_por_email: APP.operador?.email || '',
      confirmado_em: new Date().toISOString(),
      com_ajuste: true,
      status: 'CONFIRMADO_COM_AJUSTE',
      disponivel_coletor: false,
      liberada_coletor: true,
      atualizado_em: new Date().toISOString(),
      origem: 'COLETOR_AUDITORIA_MANUAL'
    };
    if (pend?.itens?.length) payload.itens = pend.itens;
    try {
      await FS.collection(FCOL.auditorias).doc(APP.inventario?.auditoria_id || APP.inventario?.id).collection('enderecos').doc(docId).set(payload, { merge: true });
      APP.auditorias = (APP.auditorias || []).filter(a => a.id !== docId);
      toast('✅ Auditoria salva', 's');
      beepOk && beepOk();
      resetContagem();
    } catch (e) {
      toast('Erro ao salvar auditoria: ' + e.message, 'e');
    }
  }

  const _oldSalvar = window.salvarContagem;
  window.salvarContagem = function(){
    if (APP.modoAcesso === 'auditoria') return salvarAuditoriaManual();
    return _oldSalvar.apply(this, arguments);
  };

  const _oldConfirmarVazio = window.confirmarVazio;
  window.confirmarVazio = function(){
    if (APP.modoAcesso !== 'auditoria') return _oldConfirmarVazio.apply(this, arguments);
    const endereco = (document.getElementById('f-endereco')?.value || '').trim().toUpperCase();
    if (!endereco) { toast('Bipe o endereço primeiro', 'e'); return; }
    const ok = confirm('Confirmar endereço vazio na auditoria?\n' + endereco);
    if (!ok) return;
    const achado = getAuditoriaItemPorDun(endereco, dum);
    const pend = achado.pend || getAuditoriaPendentePorEndereco(endereco);
    const itemBase = achado.item || APP.atual?.produtoAtual?._auditoria_item || null;
    const docId = pend?.id || `${APP.inventario?.auditoria_id || APP.inventario?.id}__${norm(endereco)}__${String(dum).replace(/\D+/g,'')}`;
    const payload = {
      auditoria_id: pend?.auditoria_id || APP.inventario?.auditoria_id || APP.inventario?.id || '',
      auditoria_nome: pend?.auditoria_nome || getAuditoriaAtualNome(),
      inventario_id: '',
      inventario_nome: '',
      endereco: endereco,
      endereco_norm: norm(endereco),
      rua: pend?.rua || 'SEM RUA',
      itens_confirmados: [],
      confirmado_por: APP.operador?.name || '',
      confirmado_por_email: APP.operador?.email || '',
      confirmado_em: new Date().toISOString(),
      com_ajuste: true,
      status: 'CONFIRMADO_COM_AJUSTE',
      disponivel_coletor: false,
      liberada_coletor: true,
      atualizado_em: new Date().toISOString(),
      endereco_vazio_confirmado: true,
      origem: 'COLETOR_AUDITORIA_VAZIO'
    };
    FS.collection(FCOL.auditorias).doc(APP.inventario?.auditoria_id || APP.inventario?.id).collection('enderecos').doc(docId).set(payload, { merge: true }).then(() => {
      APP.auditorias = (APP.auditorias || []).filter(a => a.id !== docId);
      toast('✅ Endereço vazio confirmado', 's');
      beepOk && beepOk();
      resetContagem();
    }).catch(e => toast('Erro ao confirmar vazio: ' + e.message, 'e'));
  };

  const _oldShowView = window.showView;
  window.showView = function(view, tab){
    const r = _oldShowView.apply(this, arguments);
    if (APP.modoAcesso === 'auditoria' && view === 'contar') applyAuditoriaCountLayout();
    return r;
  };

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(() => { if (APP.modoAcesso === 'auditoria') applyAuditoriaCountLayout(); }, 50);
  });
})();
