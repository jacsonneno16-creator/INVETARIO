// Compras — Fase 10: Dashboard. Reaproveita _comprasInternals (carregar,
// historicoCompras, agruparHistorico) já promovidos em 79-compras-central.js
// — mesma base de dados/escopo (própria ou "todos os compradores", conforme
// o toggle já existente na aba Histórico), nenhuma consulta nova.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const charts = [];
  let _historicoRealBi = [];
  let _resumoRealBi = null;
  // PEDIDO AO VIVO (2026-08-28): "mexeu mexeu e não arrumou nada" — o
  // catch() abaixo engolia QUALQUER falha (rede instável, permissão,
  // timeout) e mostrava silenciosamente "sem dados", sem nenhuma pista de
  // que a leitura tinha falhado de verdade. Agora guarda o motivo e mostra
  // um aviso visível na tela — nunca mais falha muda.
  let _falhaHistoricoReal = '';
  let _compradoresSelecionados = [];
  const raw = () => global.getDTRawFirestore();
  function _nomeCompradorNorm(v){return String(v||'').trim().toLowerCase().replace(/\s+/g,' ');}
  function _primeiroNome(v){ return _nomeCompradorNorm(v).split(/[.\s]+/)[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
  function _seletorComprador(v){return _nomeCompradorNorm(v);}
  function _nomeBateSeletor(nome,seletor){const n0=_nomeCompradorNorm(nome),s0=_nomeCompradorNorm(seletor);return !!s0&&(s0.includes(' ')?n0===s0:_primeiroNome(n0)===_primeiroNome(s0));}
  // PEDIDO AO VIVO (2026-09-18): "o gerente vai poder pegar o login de uma
  // pessoa que vai sair de f\u00e9rias e unificar na outra... os pedidos da
  // pessoa aparecem TAMB\u00c9M pra quem t\u00e1 cobrindo, pra n\u00e3o ficar parado" \u2014
  // cobertura tempor\u00e1ria (compras_cobertura_temporaria, cadastrada em
  // 79-compras-central.js). `_coberturasAtivas` guarda os primeiros nomes
  // de quem EU estou cobrindo agora \u2014 some do filtro quando a cobertura \u00e9
  // encerrada, sem precisar trocar nada no cadastro da pessoa em si.
  let _coberturasAtivas = [];
  async function carregarCoberturasAtivas() {
    const uid = global._currentAnalistaUser?.uid || global.firebase?.auth?.().currentUser?.uid || '';
    if (!uid || typeof global.getDTRawFirestore !== 'function') { _coberturasAtivas = []; return _coberturasAtivas; }
    // try/catch (não só .catch() no .get()): um mock/coleção que não
    // suporta encadear 2x .where() lançaria SÍNCRONO, antes de chegar no
    // .get() — uma falha aqui nunca pode derrubar o carregamento do resto
    // do Dashboard.
    try {
      const snap = await raw().collection('compras_cobertura_temporaria').where('substitutoUid', '==', uid).where('ativo', '==', true).get();
      _coberturasAtivas = snap.docs.map(d => _seletorComprador(d.data().origemNome || '')).filter(Boolean);
    } catch (_e) { _coberturasAtivas = []; }
    return _coberturasAtivas;
  }
  // PEDIDO AO VIVO (2026-09-18): "n\u00e3o quero que esses nomes fiquem
  // aparecendo... cada comprador s\u00f3 vai poder pesquisar os seus" \u2014 antes,
  // QUALQUER conta com a permiss\u00e3o 'pcp-central' (visualizar) podia abrir o
  // seletor e escolher literalmente qualquer comprador \u2014 n\u00e3o tinha rela\u00e7\u00e3o
  // nenhuma com "essa pessoa realmente gerencia esse time". Papel formal
  // (usuarios_acessos.papelCompras, ver 37-usuarios-permissoes.js): admin
  // continua vendo geral por padr\u00e3o (pode filtrar se quiser); gerente s\u00f3
  // escolhe dentro de quem ele gerencia (compradoresGerenciados); comprador
  // nunca escolhe nada \u2014 sempre travado no pr\u00f3prio nome.
  function _papelCompras(){
    const a=global.DT_USUARIO_ACESSO_ATUAL||{};
    if(a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador') return 'admin';
    return a.papelCompras||'';
  }
  function _compradoresGerenciados(){
    const a=global.DT_USUARIO_ACESSO_ATUAL||{};
    return (Array.isArray(a.compradoresGerenciados)?a.compradoresGerenciados:[]).map(_seletorComprador).filter(Boolean);
  }
  function _podeEscolherComprador(){ const p=_papelCompras(); return p==='admin'||p==='gerente'; }
  function _filtroCompradores(){
    const papel=_papelCompras();
    if(papel==='admin') return _compradoresSelecionados.slice();
    if(papel==='gerente'){
      const gerenciados=_compradoresGerenciados().concat(_coberturasAtivas);
      if(!gerenciados.length) return []; // ainda sem equipe configurada \u2014 n\u00e3o trava ningu\u00e9m \u00e0 toa
      const selecionados=_compradoresSelecionados.filter(x=>gerenciados.includes(x));
      return selecionados.length?selecionados:gerenciados; // sem sele\u00e7\u00e3o = toda a equipe dele, nunca o universo inteiro
    }
    // Comprador (ou sem papel definido): sempre s\u00f3 o pr\u00f3prio nome (+ quem
    // ele estiver cobrindo temporariamente) \u2014 nunca escolhe nada. Prioriza
    // o nome do cadastro (usuarios_acessos), mais confi\u00e1vel que o
    // displayName do Firebase Auth.
    const nomeAcesso=_seletorComprador((global.DT_USUARIO_ACESSO_ATUAL||{}).nome||'');
    if(nomeAcesso) return [nomeAcesso,..._coberturasAtivas];
    const u=global._currentAnalistaUser||{}; const nome=_seletorComprador(u.nome||u.name||String(u.email||'').split('@')[0]||'');
    return nome?[nome,..._coberturasAtivas]:_coberturasAtivas.slice();
  }
  // Lista de op\u00e7\u00f5es do seletor \u2014 pra gerente, s\u00f3 quem ele gerencia
  // (interse\u00e7\u00e3o com os nomes reais que existem no BI); pra admin, todos.
  function _seletorCompradoresHtml(){
    if(!_podeEscolherComprador()||!_resumoRealBi||!Array.isArray(_resumoRealBi.compradores))return '';
    const papel=_papelCompras();
    const gerenciados=papel==='gerente'?_compradoresGerenciados():null;
    const opcoes=_resumoRealBi.compradores.filter(x=>{ if(!gerenciados)return true; const nome=x.primeiroNome||x.comprador||'';return gerenciados.some(sel=>_nomeBateSeletor(nome,sel)); });
    if(!opcoes.length)return '';
    const rotulo=papel==='gerente'?'Ver comprador da minha equipe':'Filtrar por comprador';
    const semSelecao=papel==='gerente'?'todos os da sua equipe':'todos';
    return `<div class="tc" style="padding:10px 12px;margin-bottom:12px"><label style="font-size:.72rem;font-weight:700;display:block;margin-bottom:6px">${esc(rotulo)}</label><select class="field" id="compd-compradores" multiple size="${Math.min(5,Math.max(2,opcoes.length))}" style="min-height:70px">${opcoes.map(x=>{const v=_seletorComprador(x.primeiroNome||x.comprador||'');return `<option value="${esc(v)}" ${_compradoresSelecionados.includes(v)?'selected':''}>${esc(v.charAt(0).toUpperCase()+v.slice(1))}</option>`;}).join('')}</select><div style="font-size:.68rem;color:var(--muted);margin-top:5px">Sem sele\u00e7\u00e3o = ${esc(semSelecao)}. Use Ctrl para selecionar v\u00e1rios.</div></div>`;
  }

  function _destruirGraficos() { while (charts.length) charts.pop().destroy(); }

  // BUG AO VIVO REAL (2026-09-06): "clico em atualizar, a tela só pisca de
  // volta as mesmas informações — o BI está atualizado mas a informação
  // que mostra na tela não". O "↻ Atualizar" daqui SEMPRE só releu o que
  // já estava gravado em `relatorios_bi_compras_historico_chunks` — essa
  // coleção só é atualizada de verdade pelo robô do servidor, a cada 4h
  // (functions/index.js, sincronizarComprasHistoricoBiAgendado). Não tinha
  // como o Dashboard pedir pro servidor buscar de novo AGORA — só a tela
  // "Relatórios BI" (101-relatorios-bi.js, botão "Forçar sincronização
  // agora") tinha isso, chamando a MESMA function que o robô agendado usa
  // (sincronizarComprasHistoricoBiAgora, restrita a administrador no
  // servidor). Reaproveita exatamente o mesmo padrão aqui, sem duplicar
  // lógica nova de permissão — o servidor já recusa quem não é admin.
  async function _forcarSincronizacaoBi() {
    const btn = document.querySelector('[data-compd-forcar-sync]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando...'; }
    try {
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('sincronizarComprasHistoricoBiAgora');
      await callable({});
      global.showToast?.('Sincronização com o BI concluída.', 'success');
      await renderComprasDashboard(true);
    } catch (e) {
      global.showToast?.('Erro ao forçar sincronização: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Forçar sincronização com o BI'; }
    }
  }

  // PEDIDO AO VIVO (2026-08-28): "não precisa nem ser puxado direto de
  // novo, o todo ali é as informações que você já carregou nas outras
  // abas" — reaproveita o cache compartilhado de 101-relatorios-bi.js
  // (obterHistoricoComprasRealBi) em vez de fazer uma busca própria: se a
  // aba Histórico de Compras já foi aberta nesta sessão, nem busca de
  // novo; senão busca uma vez só, e o resultado já fica disponível pra
  // aquela tela também.
  async function _carregarHistoricoRealBi(forcar) {
    _falhaHistoricoReal = '';
    _resumoRealBi = null;
    // Em produção o servidor/BigQuery calcula KPIs, rankings, variações e
    // série mensal. O navegador recebe só o resultado pronto.
    if (global.firebase && global.firebase.app) {
      try {
        const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarResumoComprasDashboardBigQuery');
        const resp = await callable({ forcar: !!forcar, compradores: _filtroCompradores() });
        if (resp && resp.data && resp.data.resumo) { _resumoRealBi = resp.data.resumo; _historicoRealBi = []; return; }
      } catch (e) {
        console.warn('[Dashboard Compras] BigQuery indisponível; usando fallback histórico:', e && e.message ? e.message : e);
      }
    }
    if (typeof global.obterHistoricoComprasRealBi !== 'function') { _historicoRealBi = []; return; }
    try {
      _historicoRealBi = await global.obterHistoricoComprasRealBi(forcar);
    } catch (e) { _historicoRealBi = []; _falhaHistoricoReal = e?.message || String(e); }
  }

  // `forcar` (novo): depois de "Forçar sincronização com o BI" rodar no
  // servidor, precisa ignorar o cache em memória de
  // obterHistoricoComprasRealBi (101-relatorios-bi.js) — sem isso, um
  // re-render normal mostraria a MESMA leitura antiga já guardada ali
  // nesta sessão, mesmo com o Firestore já atualizado.
  async function renderComprasDashboard(forcar) {
    const pagina = document.getElementById('page-compras-dashboard');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando dashboard...</div></div>';
    try {
      await carregarCoberturasAtivas();
      await Promise.all([global._comprasInternals.carregar(), _carregarHistoricoRealBi(forcar)]);
      _desenhar();
    } catch (e) {
      pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>';
    }
  }

  // Departamentos "não é compra de verdade" (mesma exclusão já aplicada em
  // 101-relatorios-bi.js) e tipo_operacao — transferência Matriz↔Filial e
  // bonificação não podem inflar "quanto foi comprado".
  const DEPARTAMENTOS_EXCLUIDOS_COMPRAS = ['MRO', 'LOGISTICA'];
  function _historicoRealFiltrado() {
    const filtro=_filtroCompradores();
    return _historicoRealBi.filter(r => (!r.tipo_operacao || r.tipo_operacao === 'COMPRA') && !DEPARTAMENTOS_EXCLUIDOS_COMPRAS.includes(String(r.departamento || '').toUpperCase()) && (!filtro.length || filtro.some(sel=>_nomeBateSeletor(r.comprador_nome||r.compradorNome||'',sel))));
  }

  function _desenhar() {
    const pagina = document.getElementById('page-compras-dashboard');
    if (!pagina) return;
    const internos = global._comprasInternals;
    const historico = typeof internos.historicoPedidosCompra==='function'?internos.historicoPedidosCompra():internos.historicoCompras(); // uma linha por pedido real quando há compra parcial
    const base = internos.historicoBase(); // todas as requisições no escopo atual (não só compradas)
    // PEDIDO AO VIVO (2026-08-28): "o dashboard não traz informação
    // nenhuma" — os KPIs/tabelas de valor viviam 100% de pcp_requisicoes_compra
    // (só requisição criada manualmente pelo PCP, muitas vezes vazia). Agora
    // o histórico REAL de notas fiscais (relatorios_bi_compras_historico_chunks,
    // já sincronizado — 30 mil linhas) é a fonte principal sempre que existir;
    // "Requisição manual (PCP)" só é usada como fallback se ainda não
    // houver nenhum dado real sincronizado.
    const historicoReal = _historicoRealFiltrado();
    const usarReal = (_resumoRealBi && n(_resumoRealBi.nPedidos) > 0) || historicoReal.length > 0;
    const hoje = new Date(), anoAtual = hoje.getFullYear(), mesAtual = hoje.getMonth();
    const abertas = base.filter(x => !/final|comprad|cancel|rejeit/i.test(String(x.status || '')));
    const atrasadas = base.filter(x => x.dataPrevista && x.dataPrevista < hoje.toISOString().slice(0, 10) && !/final|comprad|cancel|rejeit/i.test(String(x.status || '')));
    const recebidas = base.filter(x => /final/i.test(String(x.status || '')));
    const pendentesPCP = base.filter(x => x.status === 'sem_comprador' || x.status === 'solicitada');
    const parciais = base.filter(x => /parcial/i.test(String(x.status || '')) || n(x.saldoComprar) > 0 && n(x.quantidadeComprada) > 0);
    const semComprador = base.filter(x => typeof internos.requisicaoSemComprador==='function' ? internos.requisicaoSemComprador(x) : (x.status === 'sem_comprador' || (!x.compradorUid && !x.compradorNome && !/final|comprad|cancel|rejeit/i.test(String(x.status || '')))));
    const limiteCotacao = new Date(hoje); limiteCotacao.setDate(limiteCotacao.getDate()+7); const limiteCotacaoIso=limiteCotacao.toISOString().slice(0,10), hojeIso=hoje.toISOString().slice(0,10);
    const cotacoesVencendo = base.filter(x => !/final|comprad|cancel|rejeit/i.test(String(x.status || '')) && (x.cotacoes||[]).some(c => c.validadeProposta && String(c.validadeProposta).slice(0,10) >= hojeIso && String(c.validadeProposta).slice(0,10) <= limiteCotacaoIso));
    const depoisDaNecessidade = base.filter(x => x.dataPrevista && x.dataNecessaria && String(x.dataPrevista).slice(0,10) > String(x.dataNecessaria).slice(0,10) && !/final|cancel|rejeit/i.test(String(x.status || '')));

    let compradoNoMes, compradoNoAno, nPedidos, valorMedioPedido, topProdutosValor, topFornecedores, maisSubiram, maisCairam;
    const porMes = new Map(), porMesReal = new Map();
    // "Compras por mês" sempre mostra as 2 séries lado a lado (quando
    // existirem), independente de qual fonte alimenta os KPIs/tabelas acima.
    const recebidoEmPorRequisicaoMes = new Map();
    (internos.agendamentos?.() || []).forEach(a => { if (a.requisicaoId && a.recebidoEm) recebidoEmPorRequisicaoMes.set(a.requisicaoId, a.recebidoEm); });
    historico.forEach(r => { const dataEntrega = recebidoEmPorRequisicaoMes.get(r._id) || r.compradoEm; if (dataEntrega) { const mes = String(dataEntrega).slice(0, 7); porMes.set(mes, (porMes.get(mes) || 0) + n(r.valorTotalEfetivo??r.valorTotal)); } });

    if (usarReal) {
      if (_resumoRealBi && n(_resumoRealBi.nPedidos) > 0) {
        compradoNoMes = n(_resumoRealBi.compradoNoMes);
        compradoNoAno = n(_resumoRealBi.compradoNoAno);
        nPedidos = n(_resumoRealBi.nPedidos);
        valorMedioPedido = nPedidos ? n(_resumoRealBi.valorTotal) / nPedidos : 0;
        (_resumoRealBi.porMes || []).forEach(x => { if (x.mes) porMesReal.set(x.mes, n(x.valor)); });
        topProdutosValor = (_resumoRealBi.topProdutos || []).map(x => ({produto:x.produto, qtd:n(x.qtd), valor:n(x.valor)}));
        topFornecedores = (_resumoRealBi.topFornecedores || []).map(x => ({fornecedor:x.fornecedor, qtd:n(x.qtd), valor:n(x.valor)}));
        maisSubiram = (_resumoRealBi.maisSubiram || []).map(x => ({produto:x.produto, variacaoPct:n(x.variacaoPct)}));
        maisCairam = (_resumoRealBi.maisCairam || []).map(x => ({produto:x.produto, variacaoPct:n(x.variacaoPct)}));
      } else {
        const dataRefDe = r => r.data_recebimento || r.data_emissao;
        compradoNoMes = historicoReal.filter(r => { const d = new Date(dataRefDe(r)); return d.getFullYear() === anoAtual && d.getMonth() === mesAtual; }).reduce((s, r) => s + n(r.Custo_liquido_total), 0);
        compradoNoAno = historicoReal.filter(r => new Date(dataRefDe(r)).getFullYear() === anoAtual).reduce((s, r) => s + n(r.Custo_liquido_total), 0);
        const nfsDistintas = new Set(historicoReal.map(r => r.nf_numero));
        nPedidos = nfsDistintas.size;
        const valorTotalReal = historicoReal.reduce((s, r) => s + n(r.Custo_liquido_total), 0);
        valorMedioPedido = nPedidos ? valorTotalReal / nPedidos : 0;
        const porProdutoReal = new Map(), porFornecedorReal = new Map(), precosPorProdutoReal = new Map();
        historicoReal.forEach(r => {
          const chave = String(r.produto_key || r.descricao || '').trim();
          const pp = porProdutoReal.get(chave) || { produto: r.descricao, qtd: 0, valor: 0 };
          pp.qtd += n(r.quantidade_faturada); pp.valor += n(r.Custo_liquido_total); porProdutoReal.set(chave, pp);
          if (r.nome_abreviado) { const pf = porFornecedorReal.get(r.nome_abreviado) || { fornecedor: r.nome_abreviado, qtd: 0, valor: 0 }; pf.qtd += n(r.quantidade_faturada); pf.valor += n(r.Custo_liquido_total); porFornecedorReal.set(r.nome_abreviado, pf); }
          const dataRef = dataRefDe(r);
          if (dataRef) { const mes = String(dataRef).slice(0, 7); porMesReal.set(mes, (porMesReal.get(mes) || 0) + n(r.Custo_liquido_total)); }
          if (n(r.custo_liq_unit) > 0) { const arr = precosPorProdutoReal.get(chave) || []; arr.push(r); precosPorProdutoReal.set(chave, arr); }
        });
        topProdutosValor = [...porProdutoReal.values()].sort((a, b) => b.valor - a.valor).slice(0, 10);
        topFornecedores = [...porFornecedorReal.values()].sort((a, b) => b.valor - a.valor).slice(0, 10);
        const variacoesReal = [];
        precosPorProdutoReal.forEach((lista) => {
          if (lista.length < 2) return;
          const ordenada = lista.slice().sort((a, b) => String(a.data_emissao || '').localeCompare(String(b.data_emissao || '')));
          const primeiro = n(ordenada[0].custo_liq_unit), ultimo = n(ordenada[ordenada.length - 1].custo_liq_unit);
          if (primeiro > 0) variacoesReal.push({ produto: ordenada[0].descricao, variacaoPct: (ultimo - primeiro) / primeiro * 100 });
        });
        maisSubiram = variacoesReal.slice().sort((a, b) => b.variacaoPct - a.variacaoPct).slice(0, 10);
        maisCairam = variacoesReal.slice().sort((a, b) => a.variacaoPct - b.variacaoPct).slice(0, 10);
      }
    } else {
      // Fallback: nenhum histórico real sincronizado ainda — mantém o
      // comportamento antigo (derivado da requisição manual do PCP).
      compradoNoMes = historico.filter(r => { const d = new Date(r.compradoEm); return d.getFullYear() === anoAtual && d.getMonth() === mesAtual; }).reduce((s, r) => s + n(r.valorTotalEfetivo??r.valorTotal), 0);
      compradoNoAno = historico.filter(r => new Date(r.compradoEm).getFullYear() === anoAtual).reduce((s, r) => s + n(r.valorTotalEfetivo??r.valorTotal), 0);
      nPedidos = historico.length;
      valorMedioPedido = historico.length ? historico.reduce((s, r) => s + n(r.valorTotalEfetivo??r.valorTotal), 0) / historico.length : 0;
      const porProduto = new Map(), porFornecedor = new Map(), precosPorProduto = new Map();
      historico.forEach(r => {
        const chave = String(r.prodKey || r.cod || r.produto || '').trim();
        const pp = porProduto.get(chave) || { produto: r.produto, qtd: 0, valor: 0 };
        pp.qtd += n(r.quantidadeComprada); pp.valor += n(r.valorTotalEfetivo??r.valorTotal); porProduto.set(chave, pp);
        if (r.fornecedor) { const pf = porFornecedor.get(r.fornecedor) || { fornecedor: r.fornecedor, qtd: 0, valor: 0 }; pf.qtd += n(r.quantidadeComprada); pf.valor += n(r.valorTotalEfetivo??r.valorTotal); porFornecedor.set(r.fornecedor, pf); }
        if (n(r.precoUnitario) > 0) { const arr = precosPorProduto.get(chave) || []; arr.push(r); precosPorProduto.set(chave, arr); }
      });
      topProdutosValor = [...porProduto.values()].sort((a, b) => b.valor - a.valor).slice(0, 10);
      topFornecedores = [...porFornecedor.values()].sort((a, b) => b.valor - a.valor).slice(0, 10);
      const variacoes = [];
      precosPorProduto.forEach((lista, chave) => {
        if (lista.length < 2) return;
        const ordenada = lista.slice().sort((a, b) => String(a.compradoEm || '').localeCompare(String(b.compradoEm || '')));
        const primeiro = n(ordenada[0].precoUnitario), ultimo = n(ordenada[ordenada.length - 1].precoUnitario);
        if (primeiro > 0) variacoes.push({ produto: ordenada[0].produto, variacaoPct: (ultimo - primeiro) / primeiro * 100 });
      });
      maisSubiram = variacoes.slice().sort((a, b) => b.variacaoPct - a.variacaoPct).slice(0, 10);
      maisCairam = variacoes.slice().sort((a, b) => a.variacaoPct - b.variacaoPct).slice(0, 10);
    }

    pagina.innerHTML = `
      ${_falhaHistoricoReal ? `<div class="tc" style="padding:10px 12px;margin-bottom:12px;border:1px solid #D92020;background:rgba(217,32,32,.08)"><b>⚠️ O histórico real de compras não pôde ser lido agora</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Motivo: ${esc(_falhaHistoricoReal)} — os números abaixo são só da requisição manual do PCP, não do histórico completo. Verifique sua conexão e clique em Atualizar.</div></div>` : ''}
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📊 Dashboard de Compras</div><div style="font-size:.74rem;color:var(--muted)">${usarReal ? nPedidos.toLocaleString('pt-BR') + ' nota(s) fiscal(is) de compra — histórico real' : historico.length.toLocaleString('pt-BR') + ' compra(s) registrada(s) manualmente'}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" data-compd-refresh>↻ Atualizar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-compd-forcar-sync="1" title="Pede pro servidor buscar os dados mais recentes do BI agora, sem esperar o robô agendado (a cada 4h)">🔄 Forçar sincronização com o BI</button>
        </div>
      </div>
      ${_seletorCompradoresHtml()}
      <div class="kpi-grid" style="margin-bottom:10px">
        <div class="kpi blue"><div class="kpi-val">${compradoNoMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div><div class="kpi-lbl">Comprado no mês</div></div>
        <div class="kpi teal"><div class="kpi-val">${compradoNoAno.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div><div class="kpi-lbl">Comprado no ano</div></div>
        <div class="kpi purple"><div class="kpi-val">${nPedidos}</div><div class="kpi-lbl">${usarReal ? 'Nº de NFs' : 'Nº de pedidos'}</div></div>
        <div class="kpi orange"><div class="kpi-val">${valorMedioPedido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div><div class="kpi-lbl">Valor médio/pedido</div></div>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${abertas.length}</div><div class="kpi-lbl">Solicitações em aberto</div></div>
        <div class="kpi ${atrasadas.length ? 'red' : 'green'}"><div class="kpi-val">${atrasadas.length}</div><div class="kpi-lbl">Atrasados</div></div>
        <div class="kpi green"><div class="kpi-val">${recebidas.length}</div><div class="kpi-lbl">Recebidos</div></div>
        <div class="kpi ${pendentesPCP.length ? 'orange' : 'green'}"><div class="kpi-val">${pendentesPCP.length}</div><div class="kpi-lbl">Demandas do PCP pendentes</div></div>
      </div>
      <div class="tc" style="padding:10px 12px;margin-bottom:14px">
        <b>⚠️ Atenções operacionais</b>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:.72rem">
          <span class="badge ${parciais.length?'b-orange':'b-green'}">Compras parciais: ${parciais.length}</span>
          <span class="badge ${semComprador.length?'b-red':'b-green'}">Sem comprador: ${semComprador.length}</span>
          <span class="badge ${cotacoesVencendo.length?'b-orange':'b-green'}">Cotações vencendo em 7d: ${cotacoesVencendo.length}</span>
          <span class="badge ${depoisDaNecessidade.length?'b-red':'b-green'}">Entrega após data necessária: ${depoisDaNecessidade.length}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:12px"><b>📈 Compras por mês (valor)</b><div style="height:220px;margin-top:8px"><canvas id="compd-mes"></canvas></div></div>
        <div class="tc" style="padding:12px"><b>🏷️ Compras por fornecedor (top 10, valor)</b><div style="height:220px;margin-top:8px"><canvas id="compd-fornecedor"></canvas></div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="tc" style="padding:12px">
          <b>🔥 Top 10 produtos mais comprados</b>
          <table class="dt-table" style="margin-top:8px"><thead><tr><th>Produto</th><th>Qtd</th><th>Valor</th></tr></thead><tbody>
          ${topProdutosValor.length ? topProdutosValor.map(p => `<tr><td>${esc(p.produto)}</td><td>${p.qtd.toLocaleString('pt-BR')}</td><td>${p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`).join('') : '<tr><td colspan="3">Sem dados ainda.</td></tr>'}
          </tbody></table>
        </div>
        <div class="tc" style="padding:12px">
          <b>💹 Preço: maiores altas × maiores quedas</b>
          <table class="dt-table" style="margin-top:8px"><thead><tr><th>Subiram</th><th>%</th><th>Caíram</th><th>%</th></tr></thead><tbody>
          ${Math.max(maisSubiram.length, maisCairam.length) ? Array.from({ length: Math.max(maisSubiram.length, maisCairam.length) }).map((_, i) => `<tr><td>${maisSubiram[i]?`<button type="button" class="btn-link" data-compd-preco-produto="${esc(maisSubiram[i].produto)}" style="background:none;border:0;padding:0;color:inherit;text-align:left;cursor:pointer;text-decoration:underline">${esc(maisSubiram[i].produto)}</button>`:''}</td><td style="color:#D92020">${maisSubiram[i] ? maisSubiram[i].variacaoPct.toFixed(1) + '%' : ''}</td><td>${maisCairam[i]?`<button type="button" class="btn-link" data-compd-preco-produto="${esc(maisCairam[i].produto)}" style="background:none;border:0;padding:0;color:inherit;text-align:left;cursor:pointer;text-decoration:underline">${esc(maisCairam[i].produto)}</button>`:''}</td><td style="color:var(--green-mid)">${maisCairam[i] ? maisCairam[i].variacaoPct.toFixed(1) + '%' : ''}</td></tr>`).join('') : '<tr><td colspan="4">Sem histórico de preço suficiente ainda.</td></tr>'}
          </tbody></table>
        </div>
      </div>`;

    _destruirGraficos();
    if (global.Chart) {
      const ctxMes = document.getElementById('compd-mes');
      if (ctxMes) {
        const meses = [...new Set([...porMes.keys(), ...porMesReal.keys()])].sort();
        // "só tem que vir o mês e o ano, não precisa vir a data completa"
        const rotuloMes = m => { const [ano, mes] = m.split('-'); return mes && ano ? mes + '/' + ano : m; };
        const datasets = [{ label: 'Requisição manual (PCP)', data: meses.map(m => porMes.get(m) || 0), backgroundColor: '#3b82f6' }];
        if (porMesReal.size) datasets.push({ label: 'Histórico real (notas fiscais)', data: meses.map(m => porMesReal.get(m) || 0), backgroundColor: '#22c55e' });
        charts.push(new global.Chart(ctxMes, { type: 'bar', data: { labels: meses.map(rotuloMes), datasets }, options: { responsive: true, maintainAspectRatio: false, plugins:{tooltip:{callbacks:{label:function(ctx){return (ctx.dataset.label?ctx.dataset.label+': ':'')+Number(ctx.raw||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});}}}} } }));
      }
      const ctxForn = document.getElementById('compd-fornecedor');
      if (ctxForn) {
        charts.push(new global.Chart(ctxForn, { type: 'bar', data: { labels: topFornecedores.map(f => f.fornecedor), datasets: [{ label: 'Valor (R$)', data: topFornecedores.map(f => f.valor), backgroundColor: '#f59e0b' }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false } }));
      }
    }
  }

  global.renderComprasDashboard = renderComprasDashboard;

  document.addEventListener('click', function (event) {
    // `true` aqui: ignora o cache em memória de obterHistoricoComprasRealBi
    // (101-relatorios-bi.js) — sem isso, "Atualizar" podia mostrar a MESMA
    // leitura já guardada nesta sessão mesmo que o Firestore já tivesse
    // dado novo (ver comentário grande em _forcarSincronizacaoBi acima).
    if (event.target.closest('[data-compd-refresh]')) { renderComprasDashboard(true); return; }
    if (event.target.closest('[data-compd-forcar-sync]')) { _forcarSincronizacaoBi(); return; }
    const pp=event.target.closest('[data-compd-preco-produto]'); if(pp){ global.comprasAbrirAnalisePreco?.(pp.getAttribute('data-compd-preco-produto')); return; }
  });
  document.addEventListener('change',function(event){
    if(event.target && event.target.id==='compd-compradores'){
      _compradoresSelecionados=Array.from(event.target.selectedOptions||[]).map(o=>String(o.value||'').toLowerCase()).filter(Boolean);
      renderComprasDashboard(true);
    }
  });
})(window);
