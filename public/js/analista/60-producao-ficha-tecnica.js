// Setor Produção — Ficha Técnica (fase 2 da unificação com o Sistema de
// Produção). Porta a lógica de renderFichaTecnica/getFichaTecnicaMerged do
// app.js original, adaptada pro Firestore compat do Inventário e carregada
// sob demanda (não no boot do app inteiro).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_PRODUTOS = 'producao_produtos';
  const COL_FICHAS = 'producao_ficha_tecnica';
  const COL_MAQUINAS = 'producao_maquinas';

  let _produtos = [];
  let _fichas = [];
  let _carregado = false;
  let _insumosEditando = [];
  let _lojasProdutoras = [];
  let _maquinasCadastro = [];
  let _maquinasEditando = [];
  let _modoModalPft = 'produto';

  function fs() { return global.getDTFirestore(); }

  async function carregarProducaoDados(forcar) {
    if (_carregado && !forcar) return;
    const [snapProdutos, snapFichas, snapMaquinas] = await Promise.all([
      fs().collection(COL_PRODUTOS).get(),
      fs().collection(COL_FICHAS).get(),
      fs().collection(COL_MAQUINAS).get(),
    ]);
    _produtos = snapProdutos.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _fichas = snapFichas.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _maquinasCadastro = snapMaquinas.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  // PCP (fase 4) — empresa produtora do produto: qual loja/unidade
  // fabrica este item, usada pelo PCP pra rotear a solicitação de
  // produção pra loja certa (ao invés de texto solto que não bate com
  // nenhum ID real de loja).
  async function _carregarLojasProdutoras() {
    try { _lojasProdutoras = (await global.DTLoja?.listar(false)) || []; }
    catch (e) { _lojasProdutoras = []; }
  }
  function _empresaProdutoraOpts(sel) {
    const opts = _lojasProdutoras.map(l => `<option value="${esc(l.id)}" ${String(sel) === String(l.id) ? 'selected' : ''}>${esc(l.nome || l.id)}</option>`).join('');
    return `<option value="">— Não definida —</option>${opts}`;
  }

  // Junta produtos + fichas — produto sem ficha ainda entra com insumos
  // vazios (mesma lógica do getFichaTecnicaMerged original).
  function getProducaoFichaTecnicaMerged() {
    const porCod = new Map();
    _fichas.forEach(f => porCod.set(String(f.cod), f));
    return _produtos.map(p => {
      const ficha = porCod.get(String(p.cod));
      if (ficha) return { ...p, ...ficha, desc: ficha.desc || p.nome || p.desc || '', categoria: ficha.categoria || p.categoria || '', classificacao: ficha.classificacao || p.classificacao || '', metaCoberturaDias: Number(ficha.metaCoberturaDias ?? p.metaCoberturaDias ?? p.coberturaDias) || 0, producaoMinima: Number(ficha.producaoMinima ?? p.producaoMinima) || 0, multiploProducao: Number(ficha.multiploProducao ?? p.multiploProducao) || 0, tipoMinimo: ficha.tipoMinimo || p.tipoMinimo || '', prioridadeProducao: Number(ficha.prioridadeProducao ?? p.prioridadeProducao) || 2, alergenico: ficha.alergenico === true || p.alergenico === true };
      return { cod: p.cod, desc: p.nome || p.desc || '', unid: p.unid || 1, pc_min: p.pc_min || 0, maquina: p.maquina || '', categoria: p.categoria || '', classificacao: p.classificacao || '', metaCoberturaDias: Number(p.metaCoberturaDias ?? p.coberturaDias) || 0, producaoMinima: Number(p.producaoMinima) || 0, multiploProducao: Number(p.multiploProducao) || 0, tipoMinimo: p.tipoMinimo || '', prioridadeProducao: Number(p.prioridadeProducao) || 2, alergenico: p.alergenico === true, produtoAtivo: p.produtoAtivo !== false && p.ativo !== false, ativo: p.ativo !== false, empresaProdutoraId: p.empresaProdutoraId || '', empresaProdutoraNome: p.empresaProdutoraNome || '', insumos: [], _semFicha: true, _produtoId: p._firestoreId };
    });
  }

  let _containerFicha = 'page-producao-ficha-tecnica';
  async function renderProducaoFichaTecnica(containerId) {
    _containerFicha = containerId || 'page-producao-ficha-tecnica';
    const pagina = document.getElementById(_containerFicha);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoDados(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoFichaTecnica();
  }

  function _desenharProducaoFichaTecnica() {
    const pagina = document.getElementById(_containerFicha);
    if (!pagina) return;
    const busca = String(document.getElementById('pft-busca')?.value || '').trim().toLowerCase();
    const linhas = getProducaoFichaTecnicaMerged()
      .filter(f => !busca || String(f.cod).includes(busca) || String(f.desc || '').toLowerCase().includes(busca))
      .sort((a, b) => String(a.cod).localeCompare(String(b.cod), 'pt-BR', { numeric: true }));

    const grupos = new Map();
    linhas.forEach(f => { const k=String(f.desc||'').trim().toLowerCase(); if(!grupos.has(k)) grupos.set(k,{...f,maquinas:[]}); if(f.maquina) grupos.get(k).maquinas.push(f.maquina); });
    const produtosAgrupados=[...grupos.values()];
    const linhaProduto=f=>`<div class="pcfg-row ${f.produtoAtivo===false||f.ativo===false?'is-off':''}"><div class="pcfg-info"><div class="pcfg-main"><code>${esc(f.cod)}</code><span>${esc(f.desc)}</span>${f.produtoAtivo===false||f.ativo===false?'<em>DESATIVADO</em>':''}</div><div class="pcfg-meta"><b>${esc(f.pc_min||0)} und/min</b><span>${esc(f.unid||1)} un/cx</span>${f.categoria?`<span>${esc(f.categoria)}</span>`:''}${f.classificacao?`<span>/ ${esc(f.classificacao)}</span>`:''}${[...new Set(f.maquinas)].map(m=>`<i>${esc(m)}</i>`).join('')}</div></div><div class="pcfg-actions"><button type="button" class="btn btn-ghost btn-sm" data-pft-toggle-produto="${esc(f.cod)}">${f.produtoAtivo===false||f.ativo===false?'✅ Ativar':'⛔ Desativar'}</button><button type="button" class="btn btn-ghost btn-sm" title="Editar produto" data-pft-editar="${esc(f.cod)}">✏️</button><button type="button" class="btn btn-ghost btn-sm pcfg-delete" title="Excluir produto" data-pft-excluir-produto="${esc(f.cod)}">🗑️</button></div></div>`;
    // PEDIDO AO VIVO (2026-09-02): "os produtos duplicou" — cod com mais de
    // 1 documento em producao_produtos (mesma máquina, tipicamente ambas
    // vazias — bug de reenvio já corrigido, ver pftCatalogoCadastrarSelecionados).
    // Botão só aparece quando existe duplicata de verdade pra limpar.
    const codsComDuplicata = new Set();
    { const porCodMaq = new Map(); _produtos.forEach(p => { const k = String(p.cod) + '|' + String(p.maquina || p.maquinaPadrao || ''); porCodMaq.set(k, (porCodMaq.get(k) || 0) + 1); }); porCodMaq.forEach((n, k) => { if (n > 1) codsComDuplicata.add(k.split('|')[0]); }); }
    pagina.innerHTML = `<div class="pcfg-card"><div class="pcfg-head"><div class="pcfg-title"><span>📦</span><b>Produtos</b><small>(${produtosAgrupados.length.toLocaleString('pt-BR')})</small></div><div class="pcfg-head-actions"><button type="button" class="btn btn-ghost btn-sm" data-pft-exportar>📤 Exportar</button><label class="btn btn-primary btn-sm">📥 Importar Excel<input type="file" accept=".xlsx,.xls" data-pft-importar hidden></label>${global.DTBiPastaLocal?.suportado?.() ? '<button type="button" class="btn btn-primary btn-sm" data-pft-do-catalogo="1">📥 Adicionar do catálogo</button>' : ''}<button type="button" class="btn btn-ghost btn-sm" data-pft-novo="1">+ Novo Produto</button>${codsComDuplicata.size ? `<button type="button" class="btn btn-ghost btn-sm pcfg-delete" data-pft-limpar-duplicados="1" title="Apaga a cópia redundante (mesmo código + mesma máquina), mantém a mais antiga">🧹 Corrigir ${codsComDuplicata.size} duplicado(s)</button>` : ''}<button type="button" class="btn btn-ghost btn-sm pcfg-delete" data-pft-apagar-tudo="1">🗑️ Limpar dados</button></div></div><div class="pcfg-search"><input id="pft-busca" placeholder="Filtrar por código ou descrição..." value="${esc(busca)}"></div><div class="pcfg-list">${produtosAgrupados.length?produtosAgrupados.slice(0,200).map(linhaProduto).join(''):'<div class="pcfg-empty">Nenhum produto encontrado.</div>'}</div></div>`;
  }

  // PEDIDO AO VIVO (2026-09-02, 3ª rodada): conferido ao vivo com o usuário
  // (console real) — 109 cods, TODOS com exatamente 2 documentos em
  // producao_produtos, mesma máquina ('' nos dois), só 2 timestamps de
  // criação (13s de diferença) pros 218 docs — assinatura clássica de
  // reenvio duplo do "Adicionar do catálogo" ANTES da trava desta mesma
  // rodada. producao_ficha_tecnica é 1 doc por cod (não por máquina, ao
  // contrário de producao_produtos) — dedupe separado, mesma regra
  // (mantém o mais antigo).
  async function pftLimparProdutosDuplicados() {
    await carregarProducaoDados(true);
    const grupos = new Map();
    _produtos.forEach(p => { const k = String(p.cod) + '|' + String(p.maquina || p.maquinaPadrao || ''); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(p); });
    const paraApagarProdutos = [];
    grupos.forEach(arr => {
      if (arr.length < 2) return;
      const ordenados = arr.slice().sort((a, b) => String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')) || String(a._firestoreId).localeCompare(String(b._firestoreId)));
      paraApagarProdutos.push(...ordenados.slice(1)); // mantém o mais antigo (ou o de menor id, se empatar), apaga o resto
    });
    const gruposFicha = new Map();
    _fichas.forEach(f => { const k = String(f.cod); if (!gruposFicha.has(k)) gruposFicha.set(k, []); gruposFicha.get(k).push(f); });
    const paraApagarFichas = [];
    gruposFicha.forEach(arr => {
      if (arr.length < 2) return;
      const ordenados = arr.slice().sort((a, b) => String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')) || String(a._firestoreId).localeCompare(String(b._firestoreId)));
      paraApagarFichas.push(...ordenados.slice(1));
    });
    if (!paraApagarProdutos.length && !paraApagarFichas.length) { global.showToast?.('Nenhum duplicado encontrado.', 'success'); return; }
    const executar = async () => {
      try {
        const rawFs = global.getDTRawFirestore ? global.getDTRawFirestore() : fs();
        for (let i = 0; i < paraApagarProdutos.length; i += 300) {
          const batch = rawFs.batch();
          paraApagarProdutos.slice(i, i + 300).forEach(p => batch.delete(fs().collection(COL_PRODUTOS).doc(p._firestoreId)));
          await batch.commit();
        }
        for (let i = 0; i < paraApagarFichas.length; i += 300) {
          const batch = rawFs.batch();
          paraApagarFichas.slice(i, i + 300).forEach(f => batch.delete(fs().collection(COL_FICHAS).doc(f._firestoreId)));
          await batch.commit();
        }
        global.showToast?.(`${paraApagarProdutos.length} produto(s) e ${paraApagarFichas.length} ficha(s) duplicado(s) removido(s) — mantida a cópia mais antiga de cada.`, 'success');
        global.DTProducao?.invalidarTudo?.();
        await carregarProducaoDados(true);
        _desenharProducaoFichaTecnica();
      } catch (e) {
        global.showToast?.('Erro ao corrigir duplicados: ' + (e.message || e), 'error');
      }
    };
    const msg = `Encontrado(s) ${paraApagarProdutos.length} produto(s) e ${paraApagarFichas.length} ficha(s) técnica(s) duplicado(s) — vai manter sempre a cópia mais antiga e apagar a(s) redundante(s). Essa ação não pode ser desfeita. Continuar?`;
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Corrigir produtos duplicados', icon: '🧹', okLabel: 'Corrigir', okClass: 'btn-danger' });
    else if (confirm(msg)) await executar();
  }

  // PEDIDO AO VIVO (auditoria 2ª rodada, seção 14/15): no original,
  // "Cadastro de Produtos" (scontent-produtos, index.html:1143-1168) e
  // "Ficha Técnica" (scontent-ficha-tecnica-cfg, index.html:1123-1140)
  // são DUAS telas diferentes — Produtos é o CRUD completo (+Adicionar/
  // Importar/Exportar/Limpar), Ficha Técnica é só uma LISTA DE CONSULTA,
  // somente leitura ("Gerada automaticamente ao importar produtos" —
  // texto literal do original), sem nenhum botão de edição. Aqui as duas
  // rotas apontavam pra mesma função/tela; esta é a versão somente
  // leitura, reaproveitando os mesmos dados (getProducaoFichaTecnicaMerged)
  // sem duplicar a fonte de verdade.
  let _containerFichaRO = 'page-producao-ficha-tecnica';
  let _fichaROBusca = '';
  async function renderProducaoFichaTecnicaSomenteLeitura(containerId) {
    _containerFichaRO = containerId || 'page-producao-ficha-tecnica';
    const pagina = document.getElementById(_containerFichaRO);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoDados(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharFichaTecnicaSomenteLeitura();
  }
  function _desenharFichaTecnicaSomenteLeitura() {
    const pagina = document.getElementById(_containerFichaRO);
    if (!pagina) return;
    const busca = _fichaROBusca.trim().toLowerCase();
    const linhas = getProducaoFichaTecnicaMerged()
      .filter(f => !busca || String(f.cod).includes(busca) || String(f.desc || '').toLowerCase().includes(busca))
      .sort((a, b) => String(a.cod).localeCompare(String(b.cod), 'pt-BR', { numeric: true }));
    pagina.innerHTML = `
      <div class="pftcfg-card">
        <div class="pftcfg-head">
          <div class="pftcfg-title"><span class="pftcfg-doc">▧</span><b>Ficha Técnica de Produtos</b><span>(${linhas.length.toLocaleString('pt-BR')} produtos)</span></div>
          <span class="pftcfg-auto">Gerada automaticamente ao importar produtos</span>
        </div>
        <div class="pftcfg-bi" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 4px;padding:10px 12px;border-radius:8px;background:#eef7f0;border:1px solid #cfe8d6">
          <div style="font-size:.75rem;color:#1E6F4E"><b>📊 Buscar do BI:</b> ${global.DTBiPastaLocal?.suportado?.() ? 'busca direto do SharePoint (API) — clique em Buscar, ou espere, atualiza sozinho a cada 30 min enquanto a tela estiver aberta.' : 'serviço de busca do BI indisponível no momento (recarregue a página).'}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${global.DTBiPastaLocal?.suportado?.() ? '<button type="button" class="btn btn-primary btn-sm" data-pft-buscar-bi="1">📊 Buscar</button><button type="button" class="btn btn-ghost btn-sm" data-pft-corrigir-categoria="1" title="Preenche a categoria (Mat. Prima/Embalagem/etc) dos insumos que ainda estão sem, usando o dados-insumos.json do BI">🏷️ Corrigir categoria dos insumos</button>' : ''}
          </div>
        </div>
        ${_ultimaBuscaBiFichaTexto ? `<div style="font-size:.7rem;color:var(--muted);margin:0 0 12px;padding:6px 10px;border-radius:8px;background:#f3f4f6">${esc(_ultimaBuscaBiFichaTexto)}</div>` : ''}
        <div class="pftcfg-search"><input id="pftro-busca" placeholder="Filtrar por código ou descrição..." value="${esc(_fichaROBusca)}"></div>
        <div class="pftcfg-list">
          ${linhas.length ? linhas.slice(0,150).map((f,idx) => {
            const insumos=f.insumos||[], sem=f._semFicha||!insumos.length;
            const insHtml=insumos.length?insumos.map(i=>`<div class="pftcfg-ins-row"><span>${Number(i.qty)>0?Number(i.qty).toFixed(Number(i.qty)<.01?6:Number(i.qty)<1?4:2):'—'}</span><span>${esc(i.insumo)}</span></div>`).join(''):'<div class="pftcfg-no-ins">Nenhum insumo cadastrado</div>';
            return `<div class="pftcfg-item">
              <button type="button" class="pftcfg-row" data-pftcfg-toggle="${idx}">
                <span class="pftcfg-main"><i class="pftcfg-chevron">⌄</i><code>${esc(f.cod)}</code><span>${esc(f.desc)}</span></span>
                <span class="pftcfg-meta"><em>${esc(f.pc_min||0)} und/min</em>${sem?'<small class="is-empty">⚠️ Sem insumos</small>':`<small>${insumos.length} insumo${insumos.length!==1?'s':''}</small>`}</span>
              </button>
              <div class="pftcfg-panel" data-pftcfg-panel="${idx}">
                <div>${insHtml}</div>
                <div class="pftcfg-panel-actions"><button type="button" class="btn btn-ghost" data-pft-editar="${esc(f.cod)}" data-pft-modo="ficha">✎ ${sem?'+ Cadastrar insumos':'Editar insumos e quantidades'}</button>${f._semFicha?'':`<button type="button" class="btn btn-ghost pftcfg-delete" data-pft-excluir="${esc(f.cod)}">🗑 Excluir</button>`}</div>
              </div>
            </div>`;
          }).join(''):'<div class="pftcfg-empty">Nenhum produto encontrado.</div>'}
        </div>
      </div>`;
    _iniciarAutoRefreshBiFicha();
  }
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'pftro-busca') { _fichaROBusca = e.target.value || ''; _desenharFichaTecnicaSomenteLeitura(); const el = document.getElementById('pftro-busca'); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} } }
  });
  document.addEventListener('click', e => {
    const toggle=e.target.closest('[data-pftcfg-toggle]');
    if(!toggle)return;
    const idx=toggle.getAttribute('data-pftcfg-toggle');
    const panel=document.querySelector('[data-pftcfg-panel="'+idx+'"]');
    const aberto=panel?.classList.toggle('is-open');
    toggle.classList.toggle('is-open',!!aberto);
  });

  // PEDIDO AO VIVO (2026-08-26): importar a ficha técnica direto do export
  // do BI (ficha_tecnica.json, sincronizado localmente via SharePoint) —
  // uma linha por par (produto acabado, insumo), precisa agrupar por
  // produto_key antes de gravar. loja_key varia no arquivo (várias lojas no
  // mesmo export); filtra pela loja ativa quando ela está vinculada à
  // Bluesoft, senão importa tudo (evita travar quem ainda não vinculou).
  const ARQUIVO_BI_FICHA = 'ficha_tecnica.json';
  // PEDIDO AO VIVO (2026-09-02): "atualizar a ficha técnica com o arquivo de
  // insumos também... trazer se é embalagem primária, secundária, sem
  // matéria-prima" — dados-insumos.json já tem essa classificação
  // (tipo/categoria) por insumo. ficha_tecnica.json não traz código de
  // insumo, só nome (descricao_insumo) — o cruzamento só pode ser por nome
  // normalizado, nunca por código.
  const ARQUIVO_BI_INSUMOS = 'dados-insumos.json';
  const INTERVALO_AUTO_BUSCA_MS = 30 * 60 * 1000; // pedido ao vivo: a cada 30 minutos
  let _ultimaBuscaBiFichaTexto = '';
  function _normInsumoNome(v) { return String(v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
  // Classifica categoria de cada insumo: 1º preserva o que já estava
  // configurado em qualquer ficha existente (edição manual do usuário nunca
  // é sobrescrita — o array `insumos` é substituído por inteiro a cada
  // import, então sem isso a categoria manual se perderia); 2º, se ainda
  // vazio, tenta casar com dados-insumos.json por nome normalizado; sem
  // correspondência, fica vazio (nunca inventa classificação).
  function _classificarInsumosComBi(fichasAgrupadas, fichasExistentes, dadosInsumos) {
    const categoriaManual = new Map();
    (fichasExistentes || []).forEach(f => (f.insumos || []).forEach(i => {
      if (i.categoria) { const k = _normInsumoNome(i.insumo); if (!categoriaManual.has(k)) categoriaManual.set(k, i.categoria); }
    }));
    const categoriaBi = new Map();
    (dadosInsumos?.produtos || []).forEach(it => { const k = _normInsumoNome(it.produto); if (k && it.categoria && !categoriaBi.has(k)) categoriaBi.set(k, it.categoria); });
    fichasAgrupadas.forEach(f => (f.insumos || []).forEach(i => {
      const k = _normInsumoNome(i.insumo);
      i.categoria = categoriaManual.get(k) || categoriaBi.get(k) || '';
    }));
    return fichasAgrupadas;
  }
  let _autoRefreshBiFichaIniciado = false;
  function _fmtHoraFicha(v) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function _iniciarAutoRefreshBiFicha() {
    if (_autoRefreshBiFichaIniciado) return;
    if (!global.DTBiPastaLocal?.suportado?.() || typeof global.setInterval !== 'function') return;
    _autoRefreshBiFichaIniciado = true;
    global.setInterval(async () => {
      try {
        const status = await global.DTBiPastaLocal.status();
        if (status === 'conectado') await pftBuscarBiAutomatico();
      } catch (e) { /* silencioso — só o clique manual mostra erro */ }
    }, INTERVALO_AUTO_BUSCA_MS);
  }

  async function _obterLojaAtivaBluesoftKey() {
    try {
      const lojaId = global.getDTLojaAtiva?.();
      if (!lojaId) return null;
      const lojas = await global.DTLoja?.listar(false) || [];
      const loja = lojas.find(l => String(l.id) === String(lojaId));
      return loja?.bluesoft_loja_key != null ? String(loja.bluesoft_loja_key) : null;
    } catch (e) { return null; }
  }

  function _agruparFichaTecnicaBiPorProduto(itens, lojaKeyFiltro) {
    const porProduto = new Map();
    itens.forEach(it => {
      if (lojaKeyFiltro != null && String(it.loja_key) !== String(lojaKeyFiltro)) return;
      const cod = it.produto_key != null ? String(it.produto_key) : '';
      if (!cod) return;
      if (!porProduto.has(cod)) porProduto.set(cod, { cod, desc: it.produto_acabado || '', insumos: [] });
      const produto = porProduto.get(cod);
      if (!produto.desc && it.produto_acabado) produto.desc = it.produto_acabado;
      const nomeInsumo = it.descricao_insumo || '';
      if (!nomeInsumo) return;
      produto.insumos.push({ insumo: nomeInsumo, qty: Number(it.consumo_receita) || 0, categoria: '' });
    });
    return [...porProduto.values()];
  }

  // Grava só cod/desc/insumos/atualizadoEm com merge:true — preserva
  // pc_min/maquina/categoria/etc já configurados manualmente na ficha.
  async function _salvarFichasTecnicasBi(fichasAgrupadas) {
    const agora = new Date().toISOString();
    const codsComProduto = new Set(_produtos.map(p => String(p.cod)));
    let semProduto = 0;
    for (const f of fichasAgrupadas) {
      if (!codsComProduto.has(f.cod)) semProduto++;
      const fichaExistente = _fichas.find(x => String(x.cod) === f.cod);
      const payload = { cod: f.cod, desc: f.desc, insumos: f.insumos, atualizadoEm: agora };
      if (fichaExistente) await fs().collection(COL_FICHAS).doc(fichaExistente._firestoreId).set(payload, { merge: true });
      else await fs().collection(COL_FICHAS).add({ ...payload, criadoEm: agora });
    }
    return { total: fichasAgrupadas.length, semProduto };
  }

  async function _importarFichaTecnicaBiRegistros(registros, dadosInsumos) {
    if (!Array.isArray(registros)) throw new Error('Formato inesperado — esperava uma lista de registros.');
    await carregarProducaoDados();
    const lojaKey = await _obterLojaAtivaBluesoftKey();
    const agrupadas = _agruparFichaTecnicaBiPorProduto(registros, lojaKey);
    if (!agrupadas.length) throw new Error('Nenhuma ficha técnica encontrada' + (lojaKey ? ' para esta loja (loja_key ' + lojaKey + ' na Bluesoft).' : '.'));
    _classificarInsumosComBi(agrupadas, _fichas, dadosInsumos);
    const resultado = await _salvarFichasTecnicasBi(agrupadas);
    global.DTProducao?.invalidarTudo?.();
    await carregarProducaoDados(true);
    _desenharFichaTecnicaSomenteLeitura();
    return resultado;
  }

  async function pftBuscarBiAutomatico() {
    if (!global.DTBiPastaLocal?.suportado?.()) return;
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') {
      const resultado = await global.DTBiPastaLocal.conectar();
      if (!resultado.ok) { global.showToast?.(resultado.erro, 'error'); return; }
    }
    try {
      const registros = await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_FICHA);
      // dados-insumos.json é best-effort: se falhar, a ficha técnica ainda
      // importa normal, só sem a classificação automática de categoria.
      const dadosInsumos = await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_INSUMOS).catch(() => null);
      const { total, semProduto } = await _importarFichaTecnicaBiRegistros(registros, dadosInsumos);
      _ultimaBuscaBiFichaTexto = `Última atualização: ${_fmtHoraFicha(new Date().toISOString())} — ${total} ficha(s) técnica(s) atualizada(s)` + (semProduto ? `, ${semProduto} sem produto cadastrado ainda` : '') + '.';
      _desenharFichaTecnicaSomenteLeitura();
    } catch (e) {
      _ultimaBuscaBiFichaTexto = `Falha na última busca (${_fmtHoraFicha(new Date().toISOString())}): ${e.message || e}`;
      global.showToast?.('Erro ao buscar no BI: ' + (e.message || e), 'error');
      _desenharFichaTecnicaSomenteLeitura();
    }
  }

  // PEDIDO AO VIVO (2026-09-03): "Insumos Geral" (65-producao-insumos.js)
  // mostra tudo caindo em "OUTROS" em vez de agrupado por categoria (Mat.
  // Prima/Emb. Primária/etc, igual ao original) — a tela em si já agrupa
  // certo, o problema é DADO: fichas técnicas gravadas ANTES de
  // _classificarInsumosComBi existir nunca tiveram a categoria preenchida,
  // e _importarFichaTecnicaBiRegistros só classifica no import (novo ou
  // reimportado), nunca corrige o que já está salvo. Conferido com dados
  // reais: "MP - FEIJAO BRANCO KG" bate EXATO em dados-insumos.json
  // ("MATERIA PRIMA") — o dado pra classificar sempre existiu, só nunca
  // rodou pra essas fichas. Backfill: só preenche categoria vazia (nunca
  // sobrescreve uma categoria já classificada, igual _classificarInsumosComBi
  // já respeita pra edição manual).
  async function pftCorrigirCategoriaInsumos() {
    if (!global.DTBiPastaLocal?.suportado?.()) { global.showToast?.('Serviço de busca do BI indisponível no momento.', 'error'); return; }
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') { const r = await global.DTBiPastaLocal.conectar(); if (!r.ok) { global.showToast?.(r.erro, 'error'); return; } }
    try {
      const dadosInsumos = await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_INSUMOS);
      const categoriaBi = new Map();
      (dadosInsumos?.produtos || []).forEach(it => { const k = _normInsumoNome(it.produto); if (k && it.categoria && !categoriaBi.has(k)) categoriaBi.set(k, it.categoria); });
      const fichasParaCorrigir = [];
      let itensCorrigidos = 0;
      _fichas.forEach(f => {
        let mudou = false;
        const insumosNovos = (f.insumos || []).map(i => {
          if (i.categoria) return i;
          const cat = categoriaBi.get(_normInsumoNome(i.insumo));
          if (!cat) return i;
          mudou = true; itensCorrigidos++;
          return { ...i, categoria: cat };
        });
        if (mudou) fichasParaCorrigir.push({ id: f._firestoreId, insumos: insumosNovos });
      });
      if (!fichasParaCorrigir.length) { global.showToast?.('Nenhum insumo sem categoria encontrado (ou sem correspondência no BI ainda).', 'success'); return; }
      const agora = new Date().toISOString();
      for (const f of fichasParaCorrigir) {
        await fs().collection(COL_FICHAS).doc(f.id).set({ insumos: f.insumos, atualizadoEm: agora }, { merge: true });
      }
      global.showToast?.(`${fichasParaCorrigir.length} ficha(s) corrigida(s), ${itensCorrigidos} insumo(s) com categoria preenchida.`, 'success');
      global.DTProducao?.invalidarTudo?.();
      await carregarProducaoDados(true);
      _desenharFichaTecnicaSomenteLeitura();
    } catch (e) {
      global.showToast?.('Erro ao corrigir categoria dos insumos: ' + (e.message || e), 'error');
    }
  }

  async function _abrirModalPft(item, modo) {
    const soFicha = modo === 'ficha';
    _modoModalPft = soFicha ? 'ficha' : 'produto';
    document.getElementById('modal-pft')?.classList.toggle('pft-ficha-only', soFicha);
    document.getElementById('pft-title').textContent = item._novo ? 'Novo Produto' : (soFicha ? `Editar ficha técnica — ${item.cod}` : 'Editar Produto');
    document.getElementById('pft-doc-id').value = item._firestoreId || '';
    document.getElementById('pft-cod').value = item.cod ?? '';
    document.getElementById('pft-cod').disabled = !item._novo;
    document.getElementById('pft-desc').value = item.desc || '';
    document.getElementById('pft-unid').value = item.unid || 1;
    document.getElementById('pft-pcmin').value = item.pc_min || 0;
    const variantes = _produtos.filter(p => String(p.cod) === String(item.cod));
    _maquinasEditando = variantes.map(p => ({ nome: p.maquina || p.maquinaPadrao || '', velocidade: Number(p.pc_min ?? p.velocidadePadrao) || Number(item.pc_min) || 0 })).filter(x => x.nome);
    if (!_maquinasEditando.length && item.maquina) _maquinasEditando = [{ nome:item.maquina, velocidade:Number(item.pc_min)||0 }];
    _redesenharMaquinasProduto();
    document.getElementById('pft-maquina').value = _maquinasEditando[0]?.nome || item.maquina || '';
    document.getElementById('pft-categoria').value = item.categoria || '';
    document.getElementById('pft-classificacao').value = item.classificacao || '';
    document.getElementById('pft-cobertura').value = item.metaCoberturaDias || item.coberturaDias || '';
    document.getElementById('pft-prod-min').value = item.producaoMinima || '';
    document.getElementById('pft-multiplo').value = item.multiploProducao || '';
    document.getElementById('pft-tipo-min').value = item.tipoMinimo || '';
    document.getElementById('pft-prioridade').value = item.prioridadeProducao || 2;
    document.getElementById('pft-alergenico').value = item.alergenico === true ? 'true' : 'false';
    document.getElementById('pft-ativo').value = item.produtoAtivo === false || item.ativo === false ? 'false' : 'true';
    await _carregarLojasProdutoras();
    const selEmpresa = document.getElementById('pft-empresa-produtora');
    if (selEmpresa) { selEmpresa.innerHTML = _empresaProdutoraOpts(item.empresaProdutoraId || ''); }
    _insumosEditando = (item.insumos || []).map(i => ({ insumo: i.insumo || '', qty: i.qty || 0, categoria: i.categoria || '' }));
    _redesenharInsumosEditando();
    global.openModal?.('modal-pft');
  }

  function _redesenharMaquinasProduto() {
    const wrap=document.getElementById('pft-maquinas-list'); if(!wrap)return;
    const nomes=[...new Set([..._maquinasCadastro.map(m=>m.nome).filter(Boolean),..._maquinasEditando.map(m=>m.nome).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    wrap.innerHTML=nomes.length?nomes.map(nome=>{const x=_maquinasEditando.find(m=>m.nome===nome);return `<label class="pft-maquina-row"><input type="checkbox" data-pft-maquina-check="${esc(nome)}" ${x?'checked':''}><span>${esc(nome)}</span><input type="number" min="0" step="0.01" data-pft-maquina-vel="${esc(nome)}" value="${esc(x?.velocidade||'')}" placeholder="Vel. und/min" ${x?'':'disabled'}></label>`;}).join(''):'<div class="pft-maquinas-empty">Nenhuma máquina cadastrada.</div>';
  }

  function pftMaquinaToggle(nome, marcada) {
    const idx=_maquinasEditando.findIndex(m=>m.nome===nome);
    if(marcada&&idx<0)_maquinasEditando.push({nome,velocidade:Number(document.getElementById('pft-pcmin')?.value)||0});
    if(!marcada&&idx>=0)_maquinasEditando.splice(idx,1);
    _redesenharMaquinasProduto();
    document.getElementById('pft-maquina').value=_maquinasEditando[0]?.nome||'';
  }
  function pftMaquinaVelocidade(nome, valor) { const x=_maquinasEditando.find(m=>m.nome===nome); if(x)x.velocidade=Math.max(0,Number(valor)||0); }

  // PEDIDO AO VIVO (comparação com o original): categoria do insumo não é
  // "descoberta" automaticamente a partir do nome — no original é sempre
  // escolhida manualmente de uma lista fixa de 5 opções (mesmas usadas nos
  // filtros de Insumos por Máquina/Geral e na ordenação fixa de
  // 65-producao-insumos.js/CAT_ORDER). Era um campo de texto livre aqui —
  // trocado por <select> com a lista fechada, pra evitar grafia divergente
  // (“Materia Prima” vs “MATERIA PRIMA”) que faria o insumo cair fora da
  // ordenação/agrupamento por categoria na tela de Insumos.
  const CATEGORIAS_INSUMO = ['MATERIA PRIMA', 'EMBALAGEM PRIMARIA', 'EMBALAGEM TERCIARIA', 'EMBALAGEM QUARTERNARIA', 'OUTROS'];
  function _redesenharInsumosEditando() {
    const wrap = document.getElementById('pft-insumos-list');
    if (!wrap) return;
    wrap.innerHTML = _insumosEditando.map((ins, i) => `
      <div style="display:flex;gap:6px;align-items:center">
        <input class="field" style="flex:2" placeholder="Insumo" value="${esc(ins.insumo)}" data-pft-campo="insumo" data-pft-idx="${i}">
        <input class="field" style="flex:1" type="number" step="any" min="0" placeholder="Qtd/caixa" value="${esc(ins.qty)}" data-pft-campo="qty" data-pft-idx="${i}">
        <select class="field" style="flex:1" data-pft-campo="categoria" data-pft-idx="${i}">
          <option value="">Categoria...</option>
          ${CATEGORIAS_INSUMO.map(c => `<option value="${esc(c)}" ${String(ins.categoria || '').toUpperCase() === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" data-pft-remover-insumo="${i}">✕</button>
      </div>`).join('') || '<div style="font-size:.75rem;color:var(--muted)">Nenhum insumo ainda.</div>';
  }

  function pftInsumoAlterado(i, campo, valor) {
    if (!_insumosEditando[i]) return;
    _insumosEditando[i][campo] = campo === 'qty' ? (parseFloat(String(valor).replace(',', '.')) || 0) : valor;
  }
  function pftAdicionarInsumo() { _insumosEditando.push({ insumo: '', qty: 0, categoria: '' }); _redesenharInsumosEditando(); }
  function pftRemoverInsumo(i) { _insumosEditando.splice(i, 1); _redesenharInsumosEditando(); }

  function pftEditar(cod, modo) {
    const item = getProducaoFichaTecnicaMerged().find(f => String(f.cod) === String(cod));
    if (!item) return;
    _abrirModalPft(item, modo || 'produto');
  }

  function pftNovoProduto() {
    _abrirModalPft({ _novo: true, cod: '', desc: '', unid: 1, pc_min: 0, maquina: '', categoria: '', classificacao: '', metaCoberturaDias: 0, producaoMinima: 0, multiploProducao: 0, tipoMinimo: '', prioridadeProducao: 2, alergenico: false, insumos: [] }, 'produto');
  }

  // PEDIDO AO VIVO (2026-09-02): "quando colocar para adicionar produto ele
  // trazer de alguma base para eu selecionar tipo vários produtos de uma
  // vez, ele já cadastrar e já trazer os insumos dele também, e ele vai
  // levar a empresa produtora por onde ele for cadastrado, se eu cadastrar
  // pela loja filial lá vai ser a empresa produtora e assim vai" — cadastro
  // manual (pftNovoProduto) continua existindo pra 1 produto de cada vez;
  // este é um segundo caminho, em lote: lista candidatos direto do
  // ficha_tecnica.json (mesmo arquivo que "Buscar do BI" da Ficha Técnica
  // somente-leitura já usa — já traz produto+insumos juntos, sem precisar
  // de um segundo arquivo), filtrados pela loja ativa (mesmo filtro por
  // loja_key/bluesoft_loja_key que pftBuscarBiAutomatico já usa) e
  // excluindo quem já está cadastrado (_produtos). Ao confirmar, cria o
  // producao_produtos (com empresaProdutoraId/Nome = loja ativa AGORA, não
  // um seletor manual — é isso que "leva a empresa produtora por onde ele
  // for cadastrado" pede) e a ficha técnica com os insumos, reaproveitando
  // _salvarFichasTecnicasBi (mesma função que o import de ficha já usa).
  let _catalogo = []; // [{cod, desc, insumos}] candidatos ainda não cadastrados
  let _catalogoSelecionados = new Set();
  let _catalogoBusca = '';
  let _catalogoCarregando = false;
  let _catalogoErro = '';
  let _catalogoLojaNome = '';

  function _ensureModalCatalogo() {
    let modal = document.getElementById('modal-pft-catalogo');
    if (modal) return modal;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-bg" id="modal-pft-catalogo"><div class="modal" style="max-width:640px">
  <div class="modal-title">📥 Adicionar produtos do catálogo</div>
  <div id="pft-catalogo-corpo"></div>
  <div class="modal-actions">
    <button class="btn btn-ghost" type="button" data-pft-catalogo-fechar>Cancelar</button>
    <button class="btn btn-primary" type="button" id="pft-catalogo-confirmar" data-pft-catalogo-confirmar>Cadastrar selecionados</button>
  </div>
</div></div>`);
    return document.getElementById('modal-pft-catalogo');
  }

  function _catalogoFiltrados() {
    const q = _catalogoBusca.trim().toLowerCase();
    if (!q) return _catalogo;
    return _catalogo.filter(p => String(p.cod).includes(q) || String(p.desc || '').toLowerCase().includes(q));
  }

  function _desenharModalCatalogo() {
    _ensureModalCatalogo();
    const corpo = document.getElementById('pft-catalogo-corpo');
    if (!corpo) return;
    const confirmarBtn = document.getElementById('pft-catalogo-confirmar');
    if (confirmarBtn) confirmarBtn.textContent = _catalogoSelecionados.size ? `Cadastrar ${_catalogoSelecionados.size} selecionado(s)` : 'Cadastrar selecionados';
    if (confirmarBtn) confirmarBtn.disabled = !_catalogoSelecionados.size;
    if (_catalogoCarregando) { corpo.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Buscando catálogo do BI...</div></div>'; return; }
    if (_catalogoErro) { corpo.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao buscar</div><div class="empty-sub">${esc(_catalogoErro)}</div></div>`; return; }
    const visiveis = _catalogoFiltrados();
    corpo.innerHTML = `
      <div style="font-size:.76rem;color:var(--muted);margin-bottom:8px">
        ${_catalogo.length} produto(s) do catálogo ainda sem cadastro${_catalogoLojaNome ? ' — loja ' + esc(_catalogoLojaNome) : ''}. Ao cadastrar, a empresa produtora vira <b>${esc(_catalogoLojaNome || 'a loja ativa')}</b> pra todos os selecionados, e os insumos vêm junto automaticamente.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
        <input class="field" style="flex:1" placeholder="Filtrar por código ou descrição..." value="${esc(_catalogoBusca)}" data-pft-catalogo-busca>
        <button type="button" class="btn btn-ghost btn-sm" data-pft-catalogo-marcar-visiveis>Marcar filtrados</button>
        <button type="button" class="btn btn-ghost btn-sm" data-pft-catalogo-limpar-selecao>Limpar seleção</button>
      </div>
      <div style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:8px">
        ${visiveis.length ? visiveis.map(p => `<label style="display:flex;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--border);cursor:pointer">
          <input type="checkbox" data-pft-catalogo-check="${esc(p.cod)}" ${_catalogoSelecionados.has(p.cod) ? 'checked' : ''}>
          <span style="flex:1"><code>${esc(p.cod)}</code> ${esc(p.desc)}</span>
          <small style="color:var(--muted)">${esc(p.unid || 1)} un/cx · ${p.insumos.length} insumo${p.insumos.length !== 1 ? 's' : ''}</small>
        </label>`).join('') : '<div class="pcfg-empty">Nenhum produto novo encontrado (todos os produtos do catálogo já estão cadastrados, ou nenhum bate com o filtro).</div>'}
      </div>`;
  }

  async function pftAbrirModalCatalogo() {
    if (!global.DTBiPastaLocal?.suportado?.()) { global.showToast?.('Serviço de busca do BI indisponível no momento.', 'error'); return; }
    _catalogo = []; _catalogoSelecionados = new Set(); _catalogoBusca = ''; _catalogoErro = ''; _catalogoCarregando = true;
    _ensureModalCatalogo(); _desenharModalCatalogo(); global.openModal?.('modal-pft-catalogo');
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') { const r = await global.DTBiPastaLocal.conectar(); if (!r.ok) { _catalogoCarregando = false; _catalogoErro = r.erro || 'Falha ao conectar.'; _desenharModalCatalogo(); return; } }
    try {
      await _carregarLojasProdutoras();
      const lojaAtivaId = global.getDTLojaAtiva?.() || '';
      const lojaAtiva = _lojasProdutoras.find(l => String(l.id) === String(lojaAtivaId));
      _catalogoLojaNome = lojaAtiva?.nome || lojaAtivaId || '';
      const [registros, dadosInsumos] = await Promise.all([
        global.DTBiPastaLocal.lerJson(ARQUIVO_BI_FICHA),
        global.DTBiPastaLocal.lerJson(ARQUIVO_BI_INSUMOS).catch(() => null),
      ]);
      const lojaKey = await _obterLojaAtivaBluesoftKey();
      const agrupadas = _agruparFichaTecnicaBiPorProduto(registros, lojaKey);
      _classificarInsumosComBi(agrupadas, _fichas, dadosInsumos);
      const codsComProduto = new Set(_produtos.map(p => String(p.cod)));
      // PEDIDO AO VIVO (2026-09-02): "os que cadastrou automaticamente não
      // traz a quantidade que vem na caixa" — ficha_tecnica.json não tem
      // essa informação (só produto+insumos), mas o cadastro sincronizado
      // da Bluesoft (pcp_produtos_bluesoft) já tem, no campo
      // `fatorCaixaBluesoft` (mesmo campo que a tela mostra como "un/cx").
      // Velocidade de produção (und/min) foi conferida nos 15 arquivos do
      // BI (compras/estoque/escadinha/insumos/ficha técnica/notas/cortes) —
      // NENHUM traz esse dado; não existe fonte automática pra isso, por
      // isso só o un/cx é preenchido aqui.
      const snapBluesoft = await fs().collection('pcp_produtos_bluesoft').get().catch(() => ({ docs: [] }));
      const fatorCaixaPorCod = new Map();
      snapBluesoft.docs.forEach(d => { const x = d.data() || {}; const cod = String(x.cod || ''); const fator = Number(x.fatorCaixaBluesoft); if (cod && fator > 0 && !fatorCaixaPorCod.has(cod)) fatorCaixaPorCod.set(cod, fator); });
      agrupadas.forEach(p => { p.unid = fatorCaixaPorCod.get(p.cod) || 1; });
      _catalogo = agrupadas.filter(p => p.cod && p.desc && !codsComProduto.has(p.cod)).sort((a, b) => a.desc.localeCompare(b.desc, 'pt-BR'));
      _catalogoCarregando = false;
      _desenharModalCatalogo();
    } catch (e) {
      _catalogoCarregando = false; _catalogoErro = e.message || String(e);
      _desenharModalCatalogo();
    }
  }

  // PEDIDO AO VIVO (2026-09-02, 2ª rodada): "os produtos duplicou" — a
  // tela de Ficha Técnica somente-leitura NÃO agrupa por cod (só a tela
  // editável agrupa, pra mostrar as máquinas juntas — ver `grupos` em
  // _desenharProducaoFichaTecnica), então qualquer cod com 2 documentos em
  // producao_produtos aparece como 2 linhas ali. O confirmar deste modal
  // rodava `.add()` sem NENHUMA proteção contra reenvio (clique duplo,
  // duplo toque em tela sensível, ou reabrir o modal com a mesma seleção
  // antiga) e sem reconferir contra o banco no momento exato do envio (só
  // contra o `_produtos` já carregado, que podia estar desatualizado se
  // algo tivesse sido cadastrado entre abrir o modal e confirmar) — as
  // duas brechas que geram documento duplicado. Agora: (1) trava contra
  // reenvio enquanto uma gravação está em andamento; (2) relê
  // producao_produtos na hora de gravar (não confia só no cache) e pula
  // quem já existe, sem gravar de novo.
  let _catalogoSalvando = false;
  async function pftCatalogoCadastrarSelecionados() {
    if (_catalogoSalvando) return;
    const selecionados = _catalogo.filter(p => _catalogoSelecionados.has(p.cod));
    if (!selecionados.length) return;
    _catalogoSalvando = true;
    const btn = document.getElementById('pft-catalogo-confirmar');
    if (btn) { btn.disabled = true; btn.textContent = 'Cadastrando...'; }
    try {
      const lojaAtivaId = global.getDTLojaAtiva?.() || '';
      const lojaAtiva = _lojasProdutoras.find(l => String(l.id) === String(lojaAtivaId));
      const empresaProdutoraId = lojaAtivaId, empresaProdutoraNome = lojaAtiva?.nome || lojaAtivaId || '';
      const agora = new Date().toISOString();
      const snapAtual = await fs().collection(COL_PRODUTOS).get();
      const codsJaExistentes = new Set(snapAtual.docs.map(d => String((d.data() || {}).cod || '')));
      const paraGravar = selecionados.filter(p => !codsJaExistentes.has(p.cod));
      const jaExistiam = selecionados.length - paraGravar.length;
      for (const p of paraGravar) {
        const payloadProduto = {
          cod: p.cod, nome: p.desc, descricao: p.desc, unid: p.unid || 1, pc_min: 0, maquina: '', maquinaPadrao: '', velocidadePadrao: 0,
          categoria: '', classificacao: '', metaCoberturaDias: 0, producaoMinima: 0, multiploProducao: 0, tipoMinimo: '', prioridadeProducao: 2,
          alergenico: false, produtoAtivo: true, ativo: true, empresaProdutoraId, empresaProdutoraNome, atualizadoEm: agora,
        };
        await fs().collection(COL_PRODUTOS).add({ ...payloadProduto, criadoEm: agora });
      }
      if (paraGravar.length) await _salvarFichasTecnicasBi(paraGravar);
      global.closeModal?.('modal-pft-catalogo');
      _catalogo = []; _catalogoSelecionados = new Set();
      global.showToast?.(
        paraGravar.length
          ? `${paraGravar.length} produto(s) cadastrado(s) com insumos e empresa produtora ${empresaProdutoraNome || '(sem loja ativa)'}.` + (jaExistiam ? ` ${jaExistiam} já existia(m) e foi(ram) pulado(s).` : '')
          : 'Todos os selecionados já estavam cadastrados — nada foi gravado de novo.',
        'success');
      global.DTProducao?.invalidarTudo?.();
      await carregarProducaoDados(true);
      _desenharProducaoFichaTecnica();
    } catch (e) {
      global.showToast?.('Erro ao cadastrar do catálogo: ' + (e.message || e), 'error');
    } finally {
      _catalogoSalvando = false;
      const btnFim = document.getElementById('pft-catalogo-confirmar');
      if (btnFim) btnFim.disabled = !_catalogoSelecionados.size;
    }
  }

  async function _pftSincronizarProdutoNaMaquina(nomeMaquina, nomeProduto, velocidade) {
    if (!nomeMaquina || !nomeProduto) return;
    try {
      const snap = await fs().collection('producao_maquinas').where('nome', '==', nomeMaquina).limit(1).get();
      if (snap.empty) return;
      const doc = snap.docs[0];
      const dados = doc.data() || {};
      const lista = Array.isArray(dados.produtosCompativeis) ? dados.produtosCompativeis.slice() : [];
      const idx = lista.findIndex(p => String(p?.produto || '').trim().toLowerCase() === nomeProduto.trim().toLowerCase());
      const item = { produto: nomeProduto, velocidade: Number(velocidade) || 0 };
      if (idx >= 0) lista[idx] = { ...lista[idx], ...item };
      else lista.push(item);
      await fs().collection('producao_maquinas').doc(doc.id).set({ produtosCompativeis: lista, atualizadoEm: new Date().toISOString() }, { merge: true });
    } catch (e) {
      console.warn('[PRODUCAO][FICHA] Falha ao sincronizar produto na máquina:', e);
    }
  }

  async function pftSalvar() {
    const cod = String(document.getElementById('pft-cod').value || '').trim();
    const desc = String(document.getElementById('pft-desc').value || '').trim();
    if (!cod || !desc) { global.showToast?.('Informe código e descrição.', 'error'); return; }
    const unid = Math.max(1, Number(document.getElementById('pft-unid').value) || 1);
    const pc_min = Math.max(0, Number(document.getElementById('pft-pcmin').value) || 0);
    const maquinasSelecionadas = _maquinasEditando.filter(m => m.nome);
    const maquina = maquinasSelecionadas[0]?.nome || String(document.getElementById('pft-maquina').value || '').trim();
    const categoria = String(document.getElementById('pft-categoria').value || '').trim();
    const classificacao = String(document.getElementById('pft-classificacao').value || '').trim();
    const metaCoberturaDias = Math.max(0, Number(document.getElementById('pft-cobertura').value) || 0);
    const producaoMinima = Math.max(0, Number(document.getElementById('pft-prod-min').value) || 0);
    const multiploProducao = Math.max(0, Number(document.getElementById('pft-multiplo').value) || 0);
    const tipoMinimo = String(document.getElementById('pft-tipo-min').value || '');
    const prioridadeProducao = Math.min(99, Math.max(1, Number(document.getElementById('pft-prioridade').value) || 2));
    const alergenico = document.getElementById('pft-alergenico').value === 'true';
    const produtoAtivo = document.getElementById('pft-ativo').value !== 'false';
    const empresaProdutoraId = String(document.getElementById('pft-empresa-produtora')?.value || '');
    const empresaProdutoraNome = empresaProdutoraId ? String(document.getElementById('pft-empresa-produtora')?.selectedOptions?.[0]?.textContent || '') : '';
    const insumos = _insumosEditando.filter(i => i.insumo);
    const agora = new Date().toISOString();
    const docIdFicha = document.getElementById('pft-doc-id').value || '';

    try {
      // Compatibilidade com o modelo da Produção original: além dos campos
      // usados pelo módulo integrado, persistimos os aliases que programação,
      // Gantt/importadores antigos esperam (descricao/velocidadePadrao/maquinaPadrao).
      // A Produção original permite o mesmo código em máquinas diferentes, então
      // a identidade do produto é código + máquina, e não apenas o código.
      const payloadProdutoBase = {
        cod, nome: desc, descricao: desc, unid,
        categoria, classificacao,
        metaCoberturaDias, producaoMinima, multiploProducao, tipoMinimo, prioridadeProducao,
        alergenico, produtoAtivo,
        empresaProdutoraId, empresaProdutoraNome, ativo: produtoAtivo, atualizadoEm: agora
      };
      const variantesSalvar = maquinasSelecionadas.length ? maquinasSelecionadas : [{ nome:maquina, velocidade:pc_min }];
      const idsMantidos = new Set();
      for (const variante of variantesSalvar) {
        const existente = _produtos.find(p => String(p.cod) === cod && String(p.maquina || p.maquinaPadrao || '') === String(variante.nome || ''));
        const velocidade = Number(variante.velocidade) || pc_min;
        const payloadProduto = { ...payloadProdutoBase, pc_min:velocidade, velocidadePadrao:velocidade, maquina:variante.nome||'', maquinaPadrao:variante.nome||'' };
        if (existente) { idsMantidos.add(existente._firestoreId); await fs().collection(COL_PRODUTOS).doc(existente._firestoreId).set(payloadProduto,{merge:true}); }
        else { const ref=await fs().collection(COL_PRODUTOS).add({...payloadProduto,criadoEm:agora}); if(ref?.id)idsMantidos.add(ref.id); }
        await _pftSincronizarProdutoNaMaquina(variante.nome, desc, velocidade);
      }
      const variantesAntigas = _produtos.filter(p => String(p.cod) === cod && !idsMantidos.has(p._firestoreId));
      await Promise.all(variantesAntigas.map(p => fs().collection(COL_PRODUTOS).doc(p._firestoreId).delete()));
      // Mantém o vínculo bidirecional Produto <-> Máquina existente no projeto
      // de Produção de referência. Sem isso a máquina pode ser cadastrada, mas
      // programação automática e seleção de compatibilidade ficam divergentes.
      // Os vínculos por máquina já foram atualizados no laço acima.

      const payloadFicha = { cod, desc, unid, pc_min, maquina, categoria, classificacao, metaCoberturaDias, producaoMinima, multiploProducao, tipoMinimo, prioridadeProducao, alergenico, insumos, atualizadoEm: agora };
      const fichaExistente = _fichas.find(f => String(f.cod) === cod);
      if (fichaExistente) {
        await fs().collection(COL_FICHAS).doc(fichaExistente._firestoreId).set(payloadFicha, { merge: true });
      } else {
        payloadFicha.criadoEm = agora;
        await fs().collection(COL_FICHAS).add(payloadFicha);
      }

      global.closeModal?.('modal-pft');
      global.showToast?.('Ficha técnica salva.', 'success');
      // Ficha, velocidade, máquina e insumos alimentam várias telas. Limpa
      // todos os caches para a alteração valer já na próxima troca de aba.
      global.DTProducao?.invalidarTudo?.();
      await carregarProducaoDados(true);
      if (_modoModalPft === 'ficha') _desenharFichaTecnicaSomenteLeitura();
      else _desenharProducaoFichaTecnica();
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  async function pftExcluir(cod) {
    const ficha = _fichas.find(f => String(f.cod) === String(cod));
    if (!ficha) return;
    const executar = async () => {
      try {
        await fs().collection(COL_FICHAS).doc(ficha._firestoreId).delete();
        global.showToast?.('Ficha excluída.', 'success');
        global.DTProducao?.invalidarTudo?.();
        await carregarProducaoDados(true);
        _desenharProducaoFichaTecnica();
      } catch (e) {
        global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error');
      }
    };
    if (global.showConfirm) global.showConfirm('Excluir a ficha técnica do produto ' + cod + '?', executar, { title: 'Excluir ficha técnica', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir a ficha técnica do produto ' + cod + '?')) await executar();
  }

  async function pftAlternarProduto(cod) {
    const produtos = _produtos.filter(p => String(p.cod) === String(cod));
    if (!produtos.length) return;
    const novoAtivo = !produtos.some(p => p.produtoAtivo !== false && p.ativo !== false);
    try {
      await Promise.all(produtos.map(p => fs().collection(COL_PRODUTOS).doc(p._firestoreId).set({ produtoAtivo: novoAtivo, ativo: novoAtivo, atualizadoEm: new Date().toISOString() }, { merge: true })));
      global.DTProducao?.invalidarTudo?.(); await carregarProducaoDados(true); _desenharProducaoFichaTecnica();
      global.showToast?.(novoAtivo ? 'Produto ativado.' : 'Produto desativado.', 'success');
    } catch (e) { global.showToast?.('Erro ao alterar status: ' + (e.message || e), 'error'); }
  }

  async function pftExcluirProduto(cod) {
    const produtos = _produtos.filter(p => String(p.cod) === String(cod));
    const fichas = _fichas.filter(f => String(f.cod) === String(cod));
    const executar = async () => {
      try {
        await Promise.all(produtos.map(p => fs().collection(COL_PRODUTOS).doc(p._firestoreId).delete()));
        await Promise.all(fichas.map(f => fs().collection(COL_FICHAS).doc(f._firestoreId).delete()));
        global.DTProducao?.invalidarTudo?.(); await carregarProducaoDados(true); _desenharProducaoFichaTecnica();
        global.showToast?.('Produto excluído.', 'success');
      } catch (e) { global.showToast?.('Erro ao excluir produto: ' + (e.message || e), 'error'); }
    };
    if (global.showConfirm) global.showConfirm('Excluir o produto ' + cod + ' e sua ficha técnica?', executar, { title:'Excluir produto', icon:'🗑️', okLabel:'Excluir', okClass:'btn-danger' });
    else if (confirm('Excluir o produto ' + cod + ' e sua ficha técnica?')) await executar();
  }

  // Apaga TUDO — produtos e fichas técnicas, sem distinguir origem (manual,
  // Excel ou Bluesoft). Ferramenta de reset explícito pedida pra zerar a
  // base de uma vez e recomeçar (via template Excel ou sincronização
  // Bluesoft), não uma limpeza seletiva como as de 90-bluesoft-service.js —
  // por isso exige o usuário digitar a confirmação, em vez de só um OK/Cancelar.
  async function pftApagarTudo() {
    await carregarProducaoDados(true);
    const totalProdutos = _produtos.length, totalFichas = _fichas.length;
    if (!totalProdutos && !totalFichas) { global.showToast?.('Nada para apagar — a base já está vazia.', 'success'); return; }
    const digitado = prompt('Isso vai apagar TODOS os ' + totalProdutos.toLocaleString('pt-BR') + ' produto(s) e ' + totalFichas.toLocaleString('pt-BR') + ' ficha(s) técnica(s) cadastrados — incluindo máquina, insumos e parâmetros de PCP configurados manualmente. Essa ação NÃO pode ser desfeita.\n\nDigite APAGAR TUDO para confirmar:');
    if (digitado !== 'APAGAR TUDO') { if (digitado != null) global.showToast?.('Texto não confere — nada foi apagado.', 'warning'); return; }
    try {
      const rawFs = global.getDTRawFirestore();
      const idsProdutos = _produtos.map(p => p._firestoreId);
      const idsFichas = _fichas.map(f => f._firestoreId);
      for (let i = 0; i < idsProdutos.length; i += 300) {
        const batch = rawFs.batch();
        idsProdutos.slice(i, i + 300).forEach(id => batch.delete(fs().collection(COL_PRODUTOS).doc(id)));
        await batch.commit();
      }
      for (let i = 0; i < idsFichas.length; i += 300) {
        const batch = rawFs.batch();
        idsFichas.slice(i, i + 300).forEach(id => batch.delete(fs().collection(COL_FICHAS).doc(id)));
        await batch.commit();
      }
      global.DTProducao?.invalidarTudo?.();
      await carregarProducaoDados(true);
      _desenharProducaoFichaTecnica();
      global.showToast?.('Apagado: ' + totalProdutos.toLocaleString('pt-BR') + ' produto(s) e ' + totalFichas.toLocaleString('pt-BR') + ' ficha(s) técnica(s).', 'success');
    } catch (e) {
      global.showToast?.('Erro ao apagar tudo: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoFichaTecnica = renderProducaoFichaTecnica;
  global.renderProducaoFichaTecnicaSomenteLeitura = renderProducaoFichaTecnicaSomenteLeitura;
  global._desenharProducaoFichaTecnica = _desenharProducaoFichaTecnica;
  global.pftAdicionarInsumo = pftAdicionarInsumo;
  global.pftRemoverInsumo = pftRemoverInsumo;
  global.pftInsumoAlterado = pftInsumoAlterado;
  global.pftEditar = pftEditar;
  global.pftNovoProduto = pftNovoProduto;
  global.pftSalvar = pftSalvar;
  global.pftExcluir = pftExcluir;
  global.pftAlternarProduto = pftAlternarProduto;
  global.pftExcluirProduto = pftExcluirProduto;
  global.pftMaquinaToggle = pftMaquinaToggle;
  global.pftMaquinaVelocidade = pftMaquinaVelocidade;
  global.pftApagarTudo = pftApagarTudo;
  global.pftBuscarBiAutomatico = pftBuscarBiAutomatico;
  global.pftAbrirModalCatalogo = pftAbrirModalCatalogo;
  global.pftCatalogoCadastrarSelecionados = pftCatalogoCadastrarSelecionados;
  global.pftLimparProdutosDuplicados = pftLimparProdutosDuplicados;
  global.pftCorrigirCategoriaInsumos = pftCorrigirCategoriaInsumos;
  global._DTFichaTecnicaBiInternals = {
    _agruparFichaTecnicaBiPorProduto, _importarFichaTecnicaBiRegistros, ARQUIVO_BI_FICHA, _classificarInsumosComBi, _normInsumoNome, ARQUIVO_BI_INSUMOS,
    pftAbrirModalCatalogo, pftCatalogoCadastrarSelecionados, pftLimparProdutosDuplicados, pftCorrigirCategoriaInsumos,
    getCatalogo: () => _catalogo, getCatalogoSelecionados: () => _catalogoSelecionados,
  };

  // Tudo abaixo é gerado via innerHTML (tabela, linhas de insumo) — usa
  // data-* + escutador delegado em vez de onclick/oninput/onchange inline,
  // que não dispara de forma confiável quando injetado dinamicamente.
  document.addEventListener('click', function (event) {
    const novo = event.target.closest('[data-pft-novo]');
    if (novo) { pftNovoProduto(); return; }
    const editar = event.target.closest('[data-pft-editar]');
    if (editar) { pftEditar(editar.getAttribute('data-pft-editar'), editar.getAttribute('data-pft-modo') || 'produto'); return; }
    const excluir = event.target.closest('[data-pft-excluir]');
    if (excluir) { pftExcluir(excluir.getAttribute('data-pft-excluir')); return; }
    const excluirProduto = event.target.closest('[data-pft-excluir-produto]');
    if (excluirProduto) { pftExcluirProduto(excluirProduto.getAttribute('data-pft-excluir-produto')); return; }
    const toggleProduto = event.target.closest('[data-pft-toggle-produto]');
    if (toggleProduto) { pftAlternarProduto(toggleProduto.getAttribute('data-pft-toggle-produto')); return; }
    if (event.target.closest('[data-pft-exportar]')) { global.exportarProducaoTemplate?.(); return; }
    const remover = event.target.closest('[data-pft-remover-insumo]');
    if (remover) { pftRemoverInsumo(Number(remover.getAttribute('data-pft-remover-insumo'))); return; }
    const apagarTudo = event.target.closest('[data-pft-apagar-tudo]');
    if (apagarTudo) { pftApagarTudo(); return; }
    if (event.target.closest('[data-pft-buscar-bi]')) { pftBuscarBiAutomatico(); return; }
    if (event.target.closest('[data-pft-corrigir-categoria]')) { pftCorrigirCategoriaInsumos(); return; }
    if (event.target.closest('[data-pft-do-catalogo]')) { pftAbrirModalCatalogo(); return; }
    if (event.target.closest('[data-pft-limpar-duplicados]')) { pftLimparProdutosDuplicados(); return; }
    if (event.target.closest('[data-pft-catalogo-fechar]')) { global.closeModal?.('modal-pft-catalogo'); return; }
    if (event.target.closest('[data-pft-catalogo-confirmar]')) { pftCatalogoCadastrarSelecionados(); return; }
    if (event.target.closest('[data-pft-catalogo-marcar-visiveis]')) { _catalogoFiltrados().forEach(p => _catalogoSelecionados.add(p.cod)); _desenharModalCatalogo(); return; }
    if (event.target.closest('[data-pft-catalogo-limpar-selecao]')) { _catalogoSelecionados.clear(); _desenharModalCatalogo(); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pft-busca') { _desenharProducaoFichaTecnica(); const el = document.getElementById('pft-busca'); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} } }
    if (event.target && event.target.matches('[data-pft-catalogo-busca]')) { _catalogoBusca = event.target.value || ''; _desenharModalCatalogo(); const el = document.querySelector('[data-pft-catalogo-busca]'); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} } }
  });
  document.addEventListener('change', function (event) {
    const catalogoCheck = event.target.closest('[data-pft-catalogo-check]');
    if (catalogoCheck) { const cod = catalogoCheck.getAttribute('data-pft-catalogo-check'); if (catalogoCheck.checked) _catalogoSelecionados.add(cod); else _catalogoSelecionados.delete(cod); _desenharModalCatalogo(); return; }
    const maqCheck=event.target.closest('[data-pft-maquina-check]');
    if(maqCheck){pftMaquinaToggle(maqCheck.getAttribute('data-pft-maquina-check'),maqCheck.checked);return;}
    const maqVel=event.target.closest('[data-pft-maquina-vel]');
    if(maqVel){pftMaquinaVelocidade(maqVel.getAttribute('data-pft-maquina-vel'),maqVel.value);return;}
    if (event.target && event.target.matches('[data-pft-importar]')) { global.importarProducaoTemplate?.(event.target.files?.[0]); event.target.value=''; return; }
    const campo = event.target.closest('[data-pft-campo]');
    if (campo) pftInsumoAlterado(Number(campo.getAttribute('data-pft-idx')), campo.getAttribute('data-pft-campo'), campo.value);
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _produtos=[]; _fichas=[]; _maquinasCadastro=[]; _maquinasEditando=[]; _insumosEditando=[]; _lojasProdutoras=[]; });
})(window);
