// AUDITORIA OPERACIONAL V22 — módulo isolado do Inventário
// Importação: Endereço + GTIN/EAN + Produto. Comparação pelos códigos cadastrados.
(function(){
  'use strict';

  const DB = () => window.FS_AN || (window.getDTFirestore && window.getDTFirestore());
  const STATUS = ['PENDENTE','OK','DIVERGENTE','ENDERECO_VAZIO'];
  let auditoriaAtual = '';
  let metaAtual = null;
  let itensAtuais = [];
  let itensBrutosAtuais = [];
  let unsubscribeItens = null;
  let unsubscribeMetas = null;
  let assinaturaAnterior = '';
  let importacaoPendente = null;
  let criacaoToken = 0;
  let criacaoAberta = false;
  let criacaoPromise = null;
  const origemAuditoria = new Map();

  function colecaoAuditorias(){ return DB().collection('dt_auditorias'); }
  function referenciaAuditoria(id){
    if(origemAuditoria.get(String(id))==='raiz' && window.getDTRawFirestore) return window.getDTRawFirestore().collection('dt_auditorias').doc(String(id));
    return colecaoAuditorias().doc(String(id));
  }

  function comTimeout(promise, ms, fallback){
    return Promise.race([
      Promise.resolve(promise).catch(function(){ return fallback; }),
      new Promise(function(resolve){ setTimeout(function(){ resolve(fallback); }, ms); })
    ]);
  }

  let configuracaoNova = null;
  function ruaDoEndereco(v){ return (window.DTEnderecos?.partes(v).rua || ''); }
  async function enderecosGerais(){
    try{
      const chunks=await DB().collection('dt_locais_chunks').orderBy('parte').get();
      let out=[]; chunks.docs.forEach(d=>{ const x=d.data(); out=out.concat(x.itens||x.enderecos||x.lista||[]); });
      if(out.length) return out.map(x=>typeof x==='string'?{endereco:x}:x);
    }catch(e){}
    try{ const snap=await DB().collection('dt_locais').get(); return snap.docs.map(d=>({id:d.id,...d.data()})); }catch(e){ return []; }
  }
  async function abrirCriacaoAuditoria(){
    const existente=document.getElementById('modal-nova-aud-v72');
    if(existente){ existente.classList.add('on'); existente.querySelector('#aud72-nome')?.focus(); return; }
    if(!await aguardarAmbienteAuditoria()) return toast('Não foi possível identificar a loja ou a sessão do analista. Atualize a página e tente novamente.','w');

    const token=++criacaoToken;
    criacaoAberta=true;
    const html=`<div id="modal-nova-aud-v72" class="modal-bg on"><div class="modal" style="max-width:760px">
      <div class="modal-hdr"><div><div class="modal-title">Criar nova auditoria</div><div class="sec-sub">O nome é definido por você e não pelo nome do arquivo.</div></div><button type="button" class="modal-close" data-aud72-fechar>✕</button></div>
      <div class="fg">
        <div class="fi full"><div class="fl">Nome da auditoria *</div><input id="aud72-nome" maxlength="100" placeholder="Ex.: Auditoria Rua 14 — Julho"></div>
        <div class="fi full"><div class="fl">Como deseja auditar?</div><select id="aud72-tipo"><option value="rua">Por rua</option><option value="produto">Por produto/família</option></select></div>
        <div class="fi full" id="aud72-box-rua"><div class="fl">Ruas *</div><div id="aud72-ruas-status" class="sec-sub">Carregando ruas…</div><select id="aud72-ruas" multiple size="7" style="display:none"></select><div class="sec-sub">Use Ctrl para selecionar mais de uma rua.</div></div>
        <div class="fi full" id="aud72-box-prod" style="display:none"><div class="fl">Família de produtos *</div><input id="aud72-busca-prod" placeholder="Pesquisar família..." autocomplete="off"><input type="hidden" id="aud72-prod"><div id="aud72-familias-lista" style="max-height:250px;overflow:auto;margin-top:8px"><div class="sec-sub">Carregando famílias…</div></div><div id="aud72-familia-selecionada" class="sec-sub" style="margin-top:8px">Nenhuma família selecionada.</div></div>
        <div class="fi full"><div class="fl">Base da auditoria *</div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn btn-ghost" id="aud72-escolher-arquivo">⬆ Selecionar arquivo</button><span id="aud72-arquivo-nome" class="sec-sub">Nenhum arquivo selecionado</span><input id="aud72-arquivo" type="file" accept=".csv,.xlsx,.xls" style="display:none"></div><div id="aud72-arquivo-status" style="margin-top:10px"></div></div>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-aud72-fechar>Cancelar</button><button type="button" class="btn btn-primary" id="aud72-criar">Criar e importar auditoria</button></div>
    </div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);
    const modal=document.getElementById('modal-nova-aud-v72');
    if(!modal) throw new Error('Não foi possível abrir o formulário de criação.');
    let arquivoSelecionado=null;
    let familias=[];
    const fechar=()=>{ ++criacaoToken; criacaoAberta=false; criacaoPromise=null; modal.remove(); };
    modal.querySelectorAll('[data-aud72-fechar]').forEach(b=>b.onclick=fechar);
    modal.addEventListener('click',e=>{ if(e.target===modal) fechar(); });
    ['mousedown','pointerdown','change','input'].forEach(evt=>modal.addEventListener(evt,e=>e.stopPropagation()));

    const tipo=modal.querySelector('#aud72-tipo');
    tipo.onchange=()=>{
      modal.querySelector('#aud72-box-rua').style.display=tipo.value==='rua'?'':'none';
      modal.querySelector('#aud72-box-prod').style.display=tipo.value==='produto'?'':'none';
    };
    const inputArquivo=modal.querySelector('#aud72-arquivo');
    modal.querySelector('#aud72-escolher-arquivo').onclick=()=>inputArquivo.click();
    inputArquivo.onchange=()=>{
      arquivoSelecionado=inputArquivo.files?.[0]||null;
      modal.querySelector('#aud72-arquivo-nome').textContent=arquivoSelecionado?arquivoSelecionado.name:'Nenhum arquivo selecionado';
      modal.querySelector('#aud72-arquivo-status').innerHTML=arquivoSelecionado?'<div class="alert info"><div>📄</div><div>Arquivo selecionado. O nome da auditoria continuará sendo o nome digitado acima.</div></div>':'';
    };

    function renderFamilias(){
      const box=modal.querySelector('#aud72-familias-lista');
      const q=txt(modal.querySelector('#aud72-busca-prod').value).toLowerCase();
      const lista=familias.filter(f=>!q||txt(f.nome).toLowerCase().includes(q));
      box.innerHTML=lista.length?lista.map(f=>`<button type="button" class="aud72-familia-card" data-id="${esc(f.id)}" data-nome="${esc(f.nome)}" style="width:100%;text-align:left;padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--card);cursor:pointer;margin-bottom:6px">${esc(f.nome)}</button>`).join(''):'<div class="empty-sub">Nenhuma família encontrada.</div>';
      box.querySelectorAll('.aud72-familia-card').forEach(card=>card.onclick=()=>{
        box.querySelectorAll('.aud72-familia-card').forEach(x=>x.style.outline='');
        card.style.outline='2px solid var(--primary)';
        modal.querySelector('#aud72-prod').value=card.dataset.id||'';
        modal.querySelector('#aud72-familia-selecionada').textContent='Selecionada: '+(card.dataset.nome||'');
      });
    }
    modal.querySelector('#aud72-busca-prod').oninput=renderFamilias;

    criacaoPromise=(async()=>{
      try{
        if(window.DTProdutos?.carregar) await comTimeout(window.DTProdutos.carregar(false),8000,[]);
        if(token!==criacaoToken || !document.body.contains(modal)) return;
        familias=(window.DTProdutos?.familias?.()||[]).filter(f=>f&&f.produtos&&f.produtos.length);
        renderFamilias();
        const ends=await comTimeout(enderecosGerais(),8000,[]);
        if(token!==criacaoToken || !document.body.contains(modal)) return;
        const ruas=[...new Set(ends.map(e=>ruaDoEndereco(e.endereco||e.codigo||e.id)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
        const sel=modal.querySelector('#aud72-ruas');
        const status=modal.querySelector('#aud72-ruas-status');
        sel.innerHTML=ruas.map(r=>`<option value="${esc(r)}">Rua ${esc(r)}</option>`).join('');
        sel.style.display='';
        status.textContent=ruas.length?`${ruas.length} rua(s) disponível(is).`:'Nenhuma rua foi encontrada na Base Geral de Endereços.';
      }catch(e){ console.warn('[AUDITORIA] opções da criação:',e); }
    })();

    modal.querySelector('#aud72-criar').onclick=async()=>{
      const nome=txt(modal.querySelector('#aud72-nome').value);
      if(!nome) return toast('Digite o nome da auditoria.','w');
      if(!arquivoSelecionado) return toast('Selecione a base da auditoria.','w');
      const modo=tipo.value;
      let selecao=[];
      if(modo==='rua') selecao=[...modal.querySelector('#aud72-ruas').selectedOptions].map(o=>o.value);
      else { const v=txt(modal.querySelector('#aud72-prod').value); if(v) selecao=[v]; }
      if(!selecao.length) return toast(modo==='rua'?'Selecione ao menos uma rua.':'Selecione uma família de produtos.','w');
      const familia=modo==='produto'?familias.find(f=>txt(f.id)===txt(selecao[0])):null;
      const cfg={tipoAuditoria:modo,ruas:modo==='rua'?selecao:[],familiaId:familia?.id||'',familiaNome:familia?.nome||''};
      const btn=modal.querySelector('#aud72-criar');
      btn.disabled=true; btn.textContent='Criando...';
      try{
        const preparada=await prepararImportacao(arquivoSelecionado,cfg);
        if(!preparada.validos.length) throw new Error('Nenhuma linha válida foi encontrada para esta auditoria.');
        const id=`AUD-${Date.now()}`;
        const db=DB(); if(!db) throw new Error('Firebase indisponível. Aguarde alguns segundos e tente novamente.');
        await db.collection('dt_auditorias').doc(id).set({
          nome:nome,auditoria_nome:nome,loja:loja(),...cfg,
          familiaCodigos:familia?familia.produtos.map(p=>p.codigoInterno):[],
          status:'RASCUNHO',liberada_coletor:false,totalItens:0,totalPendentes:0,totalOk:0,totalDivergentes:0,totalVazios:0,
          arquivo_origem:arquivoSelecionado.name,criadoEm:agora(),criadoPor:usuario()
        });
        origemAuditoria.set(id,'loja'); auditoriaAtual=id; metaAtual={id,nome,auditoria_nome:nome,...cfg,status:'RASCUNHO'};
        importacaoPendente={file:arquivoSelecionado,...preparada};
        await gravarImportacao();
        fechar();
        await popularSelect();
        const sel=document.getElementById('aud-op-auditoria'); if(sel) sel.value=id;
        await selecionarAuditoria(id);
        toast(`Auditoria “${nome}” criada com ${preparada.validos.length} item(ns).`,'s');
      }catch(e){
        console.error('[AUDITORIA] criação:',e);
        const status=modal.querySelector('#aud72-arquivo-status');
        if(status) status.innerHTML=`<div class="alert error"><div>⚠️</div><div>${esc(e.message||'Falha ao criar auditoria.')}</div></div>`;
        btn.disabled=false; btn.textContent='Criar e importar auditoria';
      }
    };
    modal.querySelector('#aud72-nome').focus();
  }


  const txt = v => String(v == null ? '' : v).trim();
  const esc = v => txt(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const semAcento = v => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const cab = v => semAcento(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  const dun = v => txt(v).replace(/[^0-9A-Za-z]/g,'').toUpperCase();
  const endNorm = v => txt(v).toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9.\-_/]/g,'');
  const agora = () => new Date().toISOString();
  const usuario = () => window._currentAnalistaUser?.email || localStorage.getItem('dt_analista_email') || 'analista';
  const loja = () => window.getDTLojaAtiva?.() || window.DTMultiStore?.getLojaAtual?.()?.id || window.getLojaAtual?.()?.id || localStorage.getItem('dt_loja_atual') || '';
  const docId = (auditoriaId, endereco, codigo='', sequencia='') => `${auditoriaId}__${endNorm(endereco).replace(/[^A-Z0-9]/g,'_')}__${dun(codigo)||'VAZIO'}__${txt(sequencia)||'0'}`;
  const fmt = v => {
    if (!v) return '—';
    const d = v?.toDate ? v.toDate() : new Date(v);
    return isNaN(d) ? txt(v) : d.toLocaleString('pt-BR');
  };
  const toast = (m,t='i') => typeof window.showToast === 'function' ? window.showToast(m,t) : alert(m);

  function produtoPlaceholder(v){
    const n=semAcento(txt(v)).toUpperCase();
    return !n || ['PRODUTO NAO IDENTIFICADO','PRODUTO NAO CADASTRADO','CODIGO SEM CADASTRO','NAO IDENTIFICADO','SEM CADASTRO'].includes(n);
  }

  function buscarProdutoPorCodigo(codigo){
    const cod=txt(codigo);
    if(!cod || !window.DTProdutos?.buscarSync) return null;
    const ach=window.DTProdutos.buscarSync(cod);
    return ach?.encontrado ? ach : null;
  }

  function normalizarItem(raw, id){
    const statusRaw = txt(raw.status || 'PENDENTE').toUpperCase();
    const compatStatus = statusRaw === 'VAZIO' ? 'ENDERECO_VAZIO' :
      ['CONFIRMADO_SEM_AJUSTE','APROVADO','CORRETO','CONFERIDO','FINALIZADO'].includes(statusRaw) ? 'OK' :
      ['CONFIRMADO_COM_AJUSTE','ERRO'].includes(statusRaw) ? 'DIVERGENTE' : statusRaw;
    const dunEsperado=txt(raw.dunEsperado || raw.dun_esperado || raw.dun || raw.codigoProduto || raw.codigo_produto || raw.gtin || raw.ean || raw.gtin_principal || raw.codigo_barras || raw.codigo_de_barras);
    const dunLido=raw.dunLido == null ? txt(raw.dun_lido || raw.produtoEncontrado || raw.produto_encontrado || raw.codigoLido || raw.codigo_lido || raw.gtinLido || raw.gtin_lido || raw.eanLido || raw.ean_lido) || null : txt(raw.dunLido) || null;
    const esperadoCadastro=buscarProdutoPorCodigo(dunEsperado);
    const lidoCadastro=buscarProdutoPorCodigo(dunLido);
    const produtoEsperadoRaw=txt(raw.produtoEsperado || raw.produto_esperado || raw.descricaoProdutoEsperado || raw.produto_nome || raw.descricao || raw.produto);
    const produtoLidoRaw=txt(raw.produtoLido || raw.produto_lido || raw.descricaoProdutoLido || raw.produtoLidoNome || raw.produto_lido_nome);
    return {
      id,
      auditoriaId: txt(raw.auditoriaId || raw.auditoria_id || auditoriaAtual),
      endereco: txt(raw.endereco || raw.local || raw.posicao),
      dunEsperado,
      produtoEsperado: produtoPlaceholder(produtoEsperadoRaw) ? (esperadoCadastro?.nomeProduto || produtoEsperadoRaw) : produtoEsperadoRaw,
      dunLido,
      produtoLido: produtoPlaceholder(produtoLidoRaw) ? (lidoCadastro?.nomeProduto || produtoLidoRaw || null) : produtoLidoRaw,
      produtoLidoId: lidoCadastro?.produtoId || txt(raw.produtoLidoId || raw.produto_lido_id) || null,
      status: STATUS.includes(compatStatus) ? compatStatus : 'PENDENTE',
      operadorId: txt(raw.operadorId || raw.operador_id || raw.usuario) || null,
      operadorNome: txt(raw.operadorNome || raw.operador_nome || raw.operador || raw.confirmado_por) || null,
      lidoEm: raw.lidoEm || raw.lido_em || raw.dataHora || raw.data_hora || null,
      loja: txt(raw.loja || loja()),
      disponivel_coletor: raw.disponivel_coletor !== false
    };
  }

  function resumo(lista=itensAtuais){
    const r = {total:lista.length, PENDENTE:0, OK:0, DIVERGENTE:0, ENDERECO_VAZIO:0};
    lista.forEach(i => r[i.status]++);
    r.auditados = r.OK + r.DIVERGENTE + r.ENDERECO_VAZIO;
    r.percentual = r.total ? Math.round((r.auditados / r.total) * 100) : 0;
    return r;
  }

  function assinatura(lista){
    return JSON.stringify(lista.map(i => [i.id,i.status,i.dunLido,i.produtoLido,i.operadorNome,i.lidoEm?.seconds || i.lidoEm || '']));
  }

  function ambienteAuditoriaPronto(){
    const db=DB();
    const lojaAtiva=loja();
    const identificacao=window.AUTH_AN?.currentUser || window._currentAnalistaUser || localStorage.getItem('dt_analista_email');
    return !!(db && typeof db.collection==='function' && lojaAtiva && identificacao);
  }

  async function aguardarAmbienteAuditoria(ms=6000){
    const inicio=Date.now();
    while(Date.now()-inicio<ms){
      if(ambienteAuditoriaPronto()) return true;
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    return ambienteAuditoriaPronto();
  }

  async function listarMetas(){
    if(!await aguardarAmbienteAuditoria()) return [];
    const db=DB();
    if(!db || typeof db.collection!=='function') return [];
    origemAuditoria.clear();
    let docs=[];
    let erroLoja=null;
    try{
      const snap=await colecaoAuditorias().get();
      docs=snap.docs.map(function(d){ origemAuditoria.set(d.id,'loja'); return {id:d.id,...d.data(),_origemAuditoria:'loja'}; });
    }catch(e){ erroLoja=e; console.warn('[AUDITORIA] coleção da loja:',e); }

    // Compatibilidade com auditorias antigas gravadas fora do proxy multiloja.
    // Mescla somente documentos da loja atual, documentos sem loja quando não há
    // equivalente na coleção atual e nunca duplica o mesmo ID.
    if(window.getDTRawFirestore){
      try{
        const atualLoja=txt(loja());
        const raiz=await window.getDTRawFirestore().collection('dt_auditorias').get();
        raiz.docs.forEach(function(d){
          if(docs.some(function(x){return x.id===d.id;})) return;
          const data=d.data()||{};
          const docLoja=txt(data.loja || data.loja_id || data.lojaId);
          const compativel=!docLoja || !atualLoja || docLoja===atualLoja;
          if(compativel){ origemAuditoria.set(d.id,'raiz'); docs.push({id:d.id,...data,_origemAuditoria:'raiz'}); }
        });
      }catch(e){ console.warn('[AUDITORIA] coleção legada da raiz:',e); if(erroLoja && !docs.length) throw erroLoja; }
    }
    if(erroLoja && !docs.length) throw erroLoja;
    return docs.sort(function(a,b){
      const av=a.criadoEm?.toMillis?.()||a.criadoEm?.seconds*1000||Date.parse(a.criadoEm||a.importado_em||0)||0;
      const bv=b.criadoEm?.toMillis?.()||b.criadoEm?.seconds*1000||Date.parse(b.criadoEm||b.importado_em||0)||0;
      return bv-av;
    });
  }

  function resolverAuditoriaSelecionada(){
    const sel=document.getElementById('aud-op-auditoria');
    const valor=txt(sel?.value);
    if(valor){ auditoriaAtual=valor; return valor; }
    if (auditoriaAtual) return auditoriaAtual;
    const opcoes=sel?[...sel.options].filter(o=>o.value):[];
    if(opcoes.length===1){ sel.value=opcoes[0].value; auditoriaAtual=opcoes[0].value; return auditoriaAtual; }
    return '';
  }

  function atualizarAcoesAuditoria(){
    const tem=!!resolverAuditoriaSelecionada();
    const btn=document.getElementById('btn-aud-atualizar-base');
    const excluir=document.getElementById('btn-aud-excluir');
    if(btn) btn.style.display=tem?'':'none';
    if(excluir) excluir.style.display=tem?'':'none';
  }

  async function importarBaseSelecionada(){
    if(!auditoriaAtual) return toast('Crie ou selecione uma auditoria antes de atualizar a base.','w');
    const input=document.getElementById('auditoria-file');
    if(input) input.click();
  }

  async function popularSelect(){
    const sel = document.getElementById('aud-op-auditoria');
    if (!sel) return [];
    const atual = auditoriaAtual || sel.value;
    if(!ambienteAuditoriaPronto()){
      sel.disabled=false;
      sel.innerHTML='<option value="">Selecione uma auditoria...</option>';
      return [];
    }
    sel.disabled=true;
    try{
      const metas = await listarMetas();
      // O proxy multiloja já direciona a coleção correta. Não esconder auditorias
      // por comparação textual de loja, pois documentos antigos podem ter loja vazia
      // ou nome/código em formato diferente.
      const visiveis=metas;
      sel.innerHTML = '<option value="">Selecione uma auditoria...</option>' + visiveis.map(m => {
        const st=txt(m.status||'RASCUNHO').toUpperCase();
        return `<option value="${esc(m.id)}">${esc(m.nome || m.auditoria_nome || m.id)} — ${esc(st)}</option>`;
      }).join('');
      if (atual && [...sel.options].some(o=>o.value===atual)) sel.value = atual;
      else if(visiveis.length===1){ sel.value=visiveis[0].id; auditoriaAtual=visiveis[0].id; }
      atualizarAcoesAuditoria();
      return visiveis;
    }catch(e){
      console.error('[AUDITORIA] listar auditorias:',e);
      const semLogin=!window.AUTH_AN?.currentUser && !window._currentAnalistaUser;
      if(semLogin){
        sel.innerHTML='<option value="">Selecione uma auditoria...</option>';
      }else{
        sel.innerHTML='<option value="">Falha ao carregar auditorias — clique em Atualizar</option>';
        toast('Não foi possível carregar as auditorias da loja atual: '+(e.message||e),'e');
      }
      return [];
    }finally{ sel.disabled=false; }
  }

  function encerrarListener(){
    if (unsubscribeMetas) { try { unsubscribeMetas(); } catch(e){} }
    unsubscribeMetas=null;
    if (unsubscribeItens) { try { unsubscribeItens(); } catch(e){} }
    unsubscribeItens = null;
    assinaturaAnterior = '';
  }

  async function selecionarAuditoria(id){
    encerrarListener();
    auditoriaAtual = txt(id);
    itensAtuais = [];
    itensBrutosAtuais = [];
    metaAtual = null;
    atualizarAcoesAuditoria();
    renderizar();
    if (!auditoriaAtual) return;
    const ref = referenciaAuditoria(auditoriaAtual);
    const metaSnap = await ref.get();
    metaAtual = metaSnap.exists ? {id:metaSnap.id,...metaSnap.data()} : null;
    if(!metaAtual){
      toast('A auditoria selecionada não existe mais. Atualizando a lista.','w');
      auditoriaAtual='';
      await popularSelect();
      renderizar();
      return;
    }
    unsubscribeMetas=ref.onSnapshot(function(ms){
      if(!ms.exists){ auditoriaAtual=''; metaAtual=null; itensAtuais=[]; popularSelect(); renderizar(); return; }
      metaAtual={id:ms.id,...ms.data()};
      atualizarAcoesAuditoria();
    });
    atualizarAcoesAuditoria();
    unsubscribeItens = ref.collection('enderecos').onSnapshot(snap => {
      itensBrutosAtuais = snap.docs.map(d => ({id:d.id,raw:d.data()}));
      const nova = itensBrutosAtuais.map(x => normalizarItem(x.raw, x.id));
      const sig = assinatura(nova);
      if (sig === assinaturaAnterior) return;
      assinaturaAnterior = sig;
      itensAtuais = nova;
      renderizar();
      sincronizarResumoMeta().catch(e => console.warn('[AUDITORIA] resumo:',e));
    }, error => {
      console.error('[AUDITORIA] listener:', error);
      toast('Não foi possível acompanhar os resultados da auditoria.','e');
    });
  }

  async function sincronizarResumoMeta(){
    if (!auditoriaAtual) return;
    const r = resumo();
    const statusAtual = txt(metaAtual?.status || 'RASCUNHO').toUpperCase();
    const status = statusAtual === 'FINALIZADA' ? 'FINALIZADA' : (r.auditados ? 'EM_ANDAMENTO' : statusAtual);
    await referenciaAuditoria(auditoriaAtual).set({
      totalItens:r.total,totalPendentes:r.PENDENTE,totalOk:r.OK,totalDivergentes:r.DIVERGENTE,totalVazios:r.ENDERECO_VAZIO,status,atualizadoEm:agora()
    },{merge:true});
    metaAtual = {...metaAtual,totalItens:r.total,totalPendentes:r.PENDENTE,totalOk:r.OK,totalDivergentes:r.DIVERGENTE,totalVazios:r.ENDERECO_VAZIO,status};
  }

  function filtros(){
    return {
      status:txt(document.getElementById('aud-op-status')?.value).toUpperCase(),
      busca:txt(document.getElementById('aud-op-busca')?.value).toLowerCase(),
      dunEsperado:txt(document.getElementById('aud-f-dun-esperado')?.value).toLowerCase(),
      dunLido:txt(document.getElementById('aud-f-dun-lido')?.value).toLowerCase(),
      operador:txt(document.getElementById('aud-f-operador')?.value).toLowerCase(),
      data:txt(document.getElementById('aud-f-data')?.value)
    };
  }

  function aplicarFiltros(lista){
    const f = filtros();
    return lista.filter(i => {
      if (f.status && i.status !== f.status) return false;
      if (f.dunEsperado && !i.dunEsperado.toLowerCase().includes(f.dunEsperado)) return false;
      if (f.dunLido && !txt(i.dunLido).toLowerCase().includes(f.dunLido)) return false;
      if (f.operador && !txt(i.operadorNome).toLowerCase().includes(f.operador)) return false;
      if (f.data && i.lidoEm) {
        const d = i.lidoEm?.toDate ? i.lidoEm.toDate() : new Date(i.lidoEm);
        if (!isNaN(d) && d.toISOString().slice(0,10) !== f.data) return false;
      } else if (f.data && !i.lidoEm) return false;
      if (f.busca) {
        const hay = [i.endereco,i.dunEsperado,i.produtoEsperado,i.dunLido,i.produtoLido,i.operadorNome,i.status].join(' ').toLowerCase();
        if (!hay.includes(f.busca)) return false;
      }
      return true;
    });
  }

  function rotuloStatus(s){ return ({PENDENTE:'Pendente',OK:'OK',DIVERGENTE:'Divergente',ENDERECO_VAZIO:'Endereço vazio'})[s] || s; }
  function classeStatus(s){ return s==='OK'?'ok':s==='DIVERGENTE'?'err':s==='ENDERECO_VAZIO'?'warn':'pending'; }

  function renderizar(){
    const r = resumo();
    const set = (id,v) => { const e=document.getElementById(id); if(e)e.textContent=v; };
    set('audop-k-total',r.total); set('audop-k-auditados',r.auditados); set('audop-k-pend',r.PENDENTE);
    set('audop-k-ok',r.OK); set('audop-k-div',r.DIVERGENTE); set('audop-k-vaz',r.ENDERECO_VAZIO); set('audop-k-perc',`${r.percentual}%`);
    const tbody = document.getElementById('auditoria-op-tbody');
    if (!tbody) return;
    const lista = aplicarFiltros(itensAtuais);
    tbody.innerHTML = lista.length ? lista.map(i => `<tr>
      <td class="mono">${esc(i.endereco)}</td>
      <td class="mono">${esc(i.dunEsperado)}</td>
      <td>${esc(i.produtoEsperado)}</td>
      <td class="mono">${esc(i.dunLido || '—')}</td>
      <td>${esc(i.produtoLido || '—')}</td>
      <td><span class="badge ${classeStatus(i.status)}">${esc(rotuloStatus(i.status))}</span></td>
      <td>${esc(i.operadorNome || '—')}</td>
      <td>${esc(fmt(i.lidoEm))}</td>
    </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">Nenhum item encontrado.</td></tr>';
    const resumoFinal = document.getElementById('auditoria-resumo-finalizacao');
    if (resumoFinal) resumoFinal.textContent = `Total ${r.total} · OK ${r.OK} · Divergentes ${r.DIVERGENTE} · Vazios ${r.ENDERECO_VAZIO} · Pendentes ${r.PENDENTE}`;
  }

  function detectarColunas(headers){
    const lista=(headers||[]).map(function(original){
      return { original:original, normal: cab(original) };
    });
    function achar(exatos, contem){
      const ex=(exatos||[]).map(cab);
      for(const h of lista){ if(ex.indexOf(h.normal)>=0) return h.original; }
      for(const h of lista){
        for(const termo of (contem||[]).map(cab)){ if(termo && h.normal.indexOf(termo)>=0) return h.original; }
      }
      return null;
    }
    return {
      endereco: achar(
        ['ENDEREÇO','ENDERECO','LOCAL','POSIÇÃO','POSICAO','LOCALIZAÇÃO','LOCALIZACAO','ADDRESS'],
        ['ENDERECO','POSICAO','LOCALIZACAO']
      ),
      dun: achar(
        ['GTIN','EAN','GTIN/EAN','EAN/GTIN','GTIN EAN','EAN GTIN','GTIN PRINCIPAL','EAN PRINCIPAL','DUN','DUN14','EAN14','GTIN14','CÓDIGO DE BARRAS','CODIGO DE BARRAS','COD BARRAS','BARCODE','CÓDIGO DO PRODUTO','CODIGO DO PRODUTO'],
        ['GTINEAN','EANGTIN','GTIN','EAN','DUN','CODIGODEBARRAS','CODBARRAS','BARCODE']
      ),
      produto: achar(
        ['PRODUTO','DESCRIÇÃO','DESCRICAO','NOME DO PRODUTO','DESCRIÇÃO DO PRODUTO','DESCRICAO DO PRODUTO','ITEM'],
        ['PRODUTO','DESCRICAO','NOMEITEM']
      )
    };
  }

  async function lerArquivo(file){
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), {type:'array',raw:false});
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
  }

  async function prepararImportacao(file,cfg){
    const rows = await lerArquivo(file);
    if (!rows.length) throw new Error('O arquivo não possui linhas de dados.');
    const col = detectarColunas(Object.keys(rows[0]));
    const ausentes = [!col.endereco&&'Endereço',!col.dun&&'GTIN/EAN/DUN',!col.produto&&'Produto'].filter(Boolean);
    if (ausentes.length) throw new Error(`Colunas obrigatórias ausentes: ${ausentes.join(', ')}. Cabeçalhos encontrados: ${Object.keys(rows[0]).join(' | ')}`);
    const erros=[]; const validos=[];
    rows.forEach((r,idx) => {
      const linha=idx+2, endereco=txt(r[col.endereco]), dunEsperado=txt(r[col.dun]), produtoEsperado=txt(r[col.produto]);
      const motivos=[];
      if(!endereco) motivos.push('endereço vazio');
      if(!dunEsperado) motivos.push('GTIN/EAN vazio');
      if(!produtoEsperado) motivos.push('nome do produto vazio');
      if(motivos.length) erros.push({linha,endereco:endereco||'—',dunEsperado,produtoEsperado,motivo:motivos.join('; ')});
      else validos.push({endereco,dunEsperado,produtoEsperado,_linha:linha,_seq:idx});
    });
    let selecionados=validos;
    cfg=cfg||metaAtual||configuracaoNova||{};
    if(cfg.tipoAuditoria==='produto' && cfg.familiaId){
      const fam=(window.DTProdutos?.familias?.()||[]).find(f=>f.id===cfg.familiaId);
      const codigos=new Set((fam?.produtos||[]).flatMap(p=>[dun(p.codigoInterno),dun(p.dun),dun(p.gtin)]).filter(Boolean));
      selecionados=validos.filter(r=>codigos.has(dun(r.dunEsperado)) || txt(r.produtoEsperado).toLowerCase().includes(txt(cfg.familiaNome).toLowerCase()));
    }
    if(cfg.tipoAuditoria==='rua' && (cfg.ruas||[]).length){
      const ruasSet=new Set(cfg.ruas.map(txt)); selecionados=validos.filter(r=>ruasSet.has(ruaDoEndereco(r.endereco)));
      const existentes=new Set(selecionados.map(r=>endNorm(r.endereco)));
      const gerais=await enderecosGerais();
      gerais.forEach(e=>{const endereco=txt(e.endereco||e.codigo||e.id);if(endereco&&ruasSet.has(ruaDoEndereco(endereco))&&!existentes.has(endNorm(endereco)))selecionados.push({endereco,dunEsperado:'',produtoEsperado:'ENDEREÇO PREVISTO VAZIO',previstoVazio:true});});
    }
    if(!selecionados.length) erros.push({linha:'—',endereco:'—',dunEsperado:'',produtoEsperado:'',motivo:'Nenhum item da base corresponde ao tipo selecionado para esta auditoria'});
    return {validos:selecionados,erros};
  }

  async function processarArquivo(file){
    if (!file) return;
    if(!auditoriaAtual) return toast('Crie ou selecione uma auditoria antes de atualizar a base.','w');
    try {
      const preparada=await prepararImportacao(file,metaAtual||{});
      if(!preparada.validos.length) throw new Error('Nenhuma linha válida foi encontrada.');
      importacaoPendente={file,...preparada};
      await gravarImportacao();
      toast(`Base atualizada com ${preparada.validos.length} item(ns).`,'s');
    } catch(e){ console.error(e); toast(e.message || 'Erro ao ler arquivo.','e'); }
  }

  async function gravarImportacao(){
    if(!importacaoPendente || !importacaoPendente.validos.length) return;
    if(!auditoriaAtual) throw new Error('Nenhuma auditoria selecionada.');
    const ref=referenciaAuditoria(auditoriaAtual);
    const itensRef=ref.collection('enderecos');
    const old=await itensRef.get();
    for(let i=0;i<old.docs.length;i+=350){const b=DB().batch();old.docs.slice(i,i+350).forEach(d=>b.delete(d.ref));await b.commit();}
    const lista=importacaoPendente.validos;
    for(let i=0;i<lista.length;i+=350){
      const b=DB().batch();
      lista.slice(i,i+350).forEach(row=>{
        const id=docId(auditoriaAtual,row.endereco,row.dunEsperado,String(row._seq==null?'':row._seq));
        b.set(itensRef.doc(id),{
          auditoriaId:auditoriaAtual,endereco:row.endereco,dunEsperado:row.dunEsperado,produtoEsperado:row.produtoEsperado,
          previstoVazio:row.previstoVazio===true,dunLido:null,produtoLido:null,status:'PENDENTE',operadorId:null,operadorNome:null,lidoEm:null,loja:loja(),disponivel_coletor:false
        });
      });
      await b.commit();
    }
    await ref.set({status:'RASCUNHO',totalItens:lista.length,totalPendentes:lista.length,totalOk:0,totalDivergentes:0,totalVazios:0,arquivo:importacaoPendente.file.name,importadoEm:agora(),importadoPor:usuario()},{merge:true});
    importacaoPendente=null;
    const status=document.getElementById('auditoria-import-status'); if(status) status.innerHTML='';
    const preview=document.getElementById('auditoria-import-preview'); if(preview){preview.innerHTML='';preview.style.display='none';}
    const actions=document.getElementById('auditoria-import-actions'); if(actions)actions.style.display='none';
  }

  async function criarNova(){ try{return await abrirCriacaoAuditoria();}catch(e){const l=document.getElementById('aud-v52-loading');if(l)l.remove();console.error('[AUDITORIA] abrir criação:',e);toast('Não foi possível abrir a criação da auditoria: '+(e.message||e),'e');} }

  async function confirmarImportacao(){
    try{ await gravarImportacao(); toast('Base importada com sucesso.','s'); }
    catch(e){ console.error(e); toast(e.message||'Falha ao importar a base.','e'); }
  }

  async function liberar(){
    const id=resolverAuditoriaSelecionada();
    if(!id) return toast('Selecione uma auditoria na lista acima.','w');
    if(id!==auditoriaAtual || !metaAtual) await selecionarAuditoria(id);
    if(!itensAtuais.length) return toast('Importe uma base válida antes de liberar.','w');
    const ref=referenciaAuditoria(auditoriaAtual);
    const snap=await ref.collection('enderecos').get();
    for(let i=0;i<snap.docs.length;i+=350){const b=DB().batch();snap.docs.slice(i,i+350).forEach(d=>b.set(d.ref,{disponivel_coletor:true},{merge:true}));await b.commit();}
    await ref.set({status:'LIBERADA',liberada_coletor:true,liberadaEm:agora(),liberadaPor:usuario()},{merge:true});
    metaAtual={...metaAtual,status:'LIBERADA'};
    toast('Auditoria liberada para os coletores.','s');
  }

  async function finalizar(){
    const id=resolverAuditoriaSelecionada();
    if(!id) return toast('Selecione uma auditoria na lista acima.','w');
    if(id!==auditoriaAtual || !metaAtual) await selecionarAuditoria(id);
    const r=resumo();
    if(r.PENDENTE>0) return toast(`Não é possível finalizar. Ainda faltam ${r.PENDENTE} item(ns).`,'w');
    if(!r.total) return toast('A auditoria não possui itens.','w');
    if(!confirm(`Finalizar auditoria?\nTotal: ${r.total}\nOK: ${r.OK}\nDivergentes: ${r.DIVERGENTE}\nVazios: ${r.ENDERECO_VAZIO}`)) return;
    await referenciaAuditoria(auditoriaAtual).set({status:'FINALIZADA',finalizadaEm:agora(),finalizadaPor:usuario(),liberada_coletor:false},{merge:true});
    metaAtual={...metaAtual,status:'FINALIZADA'};
    toast('Auditoria finalizada.','s');
  }

  async function excluir(){
    const sel=document.getElementById('aud-op-auditoria');
    const id=txt(sel?.value || auditoriaAtual);
    if(!id) return toast('Selecione a auditoria que deseja excluir.','w');
    let meta=metaAtual;
    if(!meta || txt(meta.id)!==id){
      try{ const ms=await referenciaAuditoria(id).get(); meta=ms.exists?{id:ms.id,...ms.data()}:null; }catch(e){}
    }
    const nome=txt(meta?.nome || meta?.auditoria_nome || (sel?.selectedOptions?.[0]?.textContent||id).split(' — ')[0] || id);
    const mensagem=`Excluir definitivamente a auditoria “${nome}”?\n\nTodos os endereços e resultados dessa auditoria serão apagados, e ela deixará de aparecer nos coletores.`;
    if(!window.confirm(mensagem)) return;
    const btn=document.getElementById('btn-aud-excluir');
    if(btn){ btn.disabled=true; btn.dataset.textoOriginal=btn.textContent; btn.textContent='Excluindo...'; }
    const ref=referenciaAuditoria(id);
    try{
      encerrarListener();
      // Excluir o documento principal primeiro remove a auditoria dos coletores e
      // libera a interface imediatamente. A subcoleção é limpa em seguida.
      await ref.delete();
      auditoriaAtual=''; metaAtual=null; itensAtuais=[]; itensBrutosAtuais=[]; assinaturaAnterior='';
      if(sel) sel.value='';
      await popularSelect();renderizar();atualizarAcoesAuditoria();
      toast(`Auditoria “${nome}” removida. Limpando os itens em segundo plano…`,'s');
      (async function(){
        try{
          const snap=await ref.collection('enderecos').get();
          const commits=[];
          for(let i=0;i<snap.docs.length;i+=350){const b=DB().batch();snap.docs.slice(i,i+350).forEach(d=>b.delete(d.ref));commits.push(b.commit());if(commits.length===3){await Promise.all(commits.splice(0));}}
          if(commits.length)await Promise.all(commits);
        }catch(cleanErr){console.warn('[AUDITORIA] limpeza posterior:',cleanErr.message);}
      })();
    }catch(e){
      console.error('[AUDITORIA] excluir:',e);
      toast('Falha ao excluir a auditoria: '+(e.message||e),'e');
    }finally{
      if(btn){ btn.disabled=false; btn.textContent=btn.dataset.textoOriginal||'🗑 Excluir'; }
    }
  }

  async function atualizarListaAuditorias(){
    const metas=await popularSelect();
    const sel=document.getElementById('aud-op-auditoria');
    if(sel?.value) await selecionarAuditoria(sel.value);
    else if(!metas.length) renderizar();
  }

  function exportar(){
    const id=resolverAuditoriaSelecionada();
    if(!id || !itensAtuais.length) return toast('Selecione uma auditoria com dados.','w');
    const rows=aplicarFiltros(itensAtuais).map(i=>({
      Auditoria:metaAtual?.nome||metaAtual?.auditoria_nome||auditoriaAtual,Loja:i.loja||metaAtual?.loja||loja(),Endereço:i.endereco,
      'GTIN/EAN esperado':i.dunEsperado,'Produto esperado':i.produtoEsperado,'GTIN/EAN lido':i.dunLido||'','Produto lido':i.produtoLido||'',
      Resultado:rotuloStatus(i.status),Operador:i.operadorNome||'','Data e hora':fmt(i.lidoEm)
    }));
    const ws=XLSX.utils.json_to_sheet(rows), wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Auditoria');
    XLSX.writeFile(wb,`auditoria-${auditoriaAtual}.xlsx`);
  }

  // Sobrescreve apenas as funções públicas da aba Auditoria.
  window.detectarColunasAuditoria=detectarColunas;
  window.processFileAuditoria=processarArquivo;
  window.importarBaseAuditoriaSelecionada=importarBaseSelecionada;
  window.confirmarImportAuditoria=confirmarImportacao;
  window.criarNovaAuditoriaStandalone=criarNova;
  window.liberarAuditoriaColetores=liberar;
  window.finalizarAuditoriaOperacional=finalizar;
  window.excluirAuditoriaOperacional=excluir;
  window.atualizarListaAuditorias=atualizarListaAuditorias;
  window.exportarAuditoriaOperacional=exportar;
  window.renderAuditoriaOperacional=function(){
    renderizar();
    if(!window.__auditoriaRefreshTimer){
      window.__auditoriaRefreshTimer=setTimeout(async function(){
        window.__auditoriaRefreshTimer=null;
        const page=document.getElementById('page-auditoria');
        if(page && page.classList.contains('active')) await popularSelect();
      },120);
    }
  };
  window.encerrarListenerAuditoriaPorTrocaLoja=function(){
    encerrarListener();
    auditoriaAtual='';
    metaAtual=null;
    itensAtuais=[];
    itensBrutosAtuais=[];
    atualizarAcoesAuditoria();
  };
  window.recarregarAuditoriaAposTrocaLoja=async function(){
    encerrarListener();
    auditoriaAtual='';
    metaAtual=null;
    itensAtuais=[];
    itensBrutosAtuais=[];
    atualizarAcoesAuditoria();
    await popularSelect();
    const sel=document.getElementById('aud-op-auditoria');
    const first=(sel&&sel.value)||'';
    if(first) await selecionarAuditoria(first); else renderizar();
  };


  function reprocessarItensComProdutos(){
    if(!itensBrutosAtuais.length) return;
    const nova=itensBrutosAtuais.map(x=>normalizarItem(x.raw,x.id));
    const sig=assinatura(nova);
    itensAtuais=nova;
    assinaturaAnterior=sig;
    renderizar();
  }
  window.addEventListener('dt-produtos-atualizados',reprocessarItensComProdutos);

  document.addEventListener('DOMContentLoaded', () => {
    const sel=document.getElementById('aud-op-auditoria');
    if(sel){ sel.onchange=()=>selecionarAuditoria(sel.value); }
    ['aud-op-status','aud-op-busca','aud-f-dun-esperado','aud-f-dun-lido','aud-f-operador','aud-f-data'].forEach(id=>{
      const e=document.getElementById(id); if(e)e.addEventListener(e.tagName==='SELECT'?'change':'input',renderizar);
    });
    // Não consultar o Firestore na tela de login. A lista será carregada somente
    // quando a aba Auditoria for aberta após autenticação e seleção da loja.
    renderizar();
  });
  window.addEventListener('beforeunload',encerrarListener);
})();
