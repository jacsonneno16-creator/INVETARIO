// PCP — Fase 9: Produto 360°. Página de drill-down (sem item fixo na
// sidebar — aberta a partir de qualquer tabela do PCP), derivada de dados
// já carregados: construirVisao(), memoriaDeCalculo(), a linha do tempo
// (83) e as requisições de compra já existentes (78). Não busca nada que
// essas telas não busquem, só reorganiza por produto — EXCETO a seção de
// Insumos (PEDIDO AO VIVO 2026-09-02: "quando eu clico em ver relatório de
// produto, tem que trazer as informações de insumos que ele usa"), que lê
// producao_ficha_tecnica direto (não tem outro jeito: nenhuma tela do PCP
// carrega ficha técnica hoje) e cruza com a lista de insumos do PCP Central
// (getInsumosBi) quando ela já foi carregada.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const charts = [];

  let _produtoKey = '';

  function _destruirGraficos() { while (charts.length) charts.pop().destroy(); }

  const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  // PEDIDO AO VIVO (2026-09-02): "mostrar as projeções dos 3 meses
  // seguintes, baseado na escadinha do produto" — troca "Venda mês 1/2/3"
  // (fonte antiga, producao_projecao) pelos 3 meses seguintes do plano[] da
  // escadinha (mesmo dado que Estoque/Pedidos x Estoque/Linha do Tempo já
  // usam). Sem escadinha pro produto (fora dos 81 do BI), cai pro
  // venda_m1/m2/m3 de sempre.
  function _proximosMesesEscadinha(item, projecaoRec) {
    const plano = item.planoEscadinha;
    if (!Array.isArray(plano) || !plano.length) {
      return { rotulo: 'Venda mês 1 / 2 / 3', valores: [n(projecaoRec.venda_m1), n(projecaoRec.venda_m2), n(projecaoRec.venda_m3)], labels: ['Mês 1', 'Mês 2', 'Mês 3'] };
    }
    const hoje = new Date();
    const labels = [1, 2, 3].map(i => MESES_ABREV[(hoje.getMonth() + i) % 12]);
    const valores = [1, 2, 3].map(i => Number(plano[(hoje.getMonth() + i) % 12]) || 0);
    return { rotulo: 'Projeção próximos 3 meses (escadinha)', valores, labels };
  }

  async function abrirProduto360(key) {
    _produtoKey = key;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('on'));
    const pageEl = document.getElementById('page-pcp-produto-360'); if (pageEl) pageEl.classList.add('on');
    const tituloEl = document.getElementById('page-title'); if (tituloEl) tituloEl.textContent = 'PCP · Produto 360°';
    await renderPCPProduto360();
  }

  async function renderPCPProduto360() {
    const pagina = document.getElementById('page-pcp-produto-360');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await global._pcpInternals.carregar(); await _desenhar(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; }
  }

  // PEDIDO AO VIVO (2026-09-02): "quando eu clico em ver relatório de
  // produto, tem que trazer as informações de insumos que ele usa" — cruza
  // a Ficha Técnica (producao_ficha_tecnica, cod → insumos[]) com a lista
  // de insumos da aba Insumos do PCP Central (dados-insumos.json, já
  // carregada se o usuário abriu aquela aba nesta sessão — ver
  // getInsumosBi). Casa por NOME normalizado (mesma limitação do ponto 9:
  // a ficha técnica não tem código de insumo, só nome). Sem correspondência
  // ou sem a aba Insumos carregada ainda, mostra só qty da ficha, sem
  // estoque/cobertura — nunca quebra por falta desse cruzamento.
  function _normMaterial(v) {
    const canon = global._producaoInsumosInternals && global._producaoInsumosInternals.canonInsumo;
    if (typeof canon === 'function') return canon(v);
    const base = String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    return base.replace(/^\s*\d+[^A-Z0-9]*/, '').replace(/^\s*(MP|MAT(?:ERIA)?\s*PRIMA|MATERIA\s*PRIMA|LOGISTICA)[^A-Z0-9]+/, '').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async function _buscarInsumosDoProduto(cod) {
    if (!cod) return [];
    try {
      const snap = await global.getDTFirestore().collection('producao_ficha_tecnica').get();
      const aliases = new Set((global._pcpInternals.aliasesProduto?.(cod) || [String(cod)]).map(String));
      const ficha = snap.docs.map(d => d.data()).find(f => [f.cod,f.codigo,f.produtoCod,f.prodKey,f.bluesoftProdutoKey,f.produtoUnitarioKey,f.canonicalKey].some(v => v != null && aliases.has(String(v))));
      const insumosFicha = (ficha && ficha.insumos) || [];
      const internos = global._pcpInternals || {};
      const norm = internos.norm || (v => String(v || '').trim().toLowerCase());

      // O Produto 360 não pode depender do filtro visual que ficou selecionado
      // na aba Insumos. Se a origem crua estiver em memória, reconstrói uma
      // visão consolidada exclusivamente para o 360; não faz nova leitura.
      let insumosBi = internos.getInsumosBi?.() || [];
      const raw = internos.getInsumosBiRaw?.();
      if (raw && typeof internos._juntarInsumosBi === 'function') {
        const consolidados = internos._juntarInsumosBi(raw, null, '');
        if (Array.isArray(consolidados) && consolidados.length) insumosBi = consolidados;
      }

      const porCod = new Map();
      const porNome = new Map();
      const porNomeMaterial = new Map();
      insumosBi.forEach(x => {
        const codBi = String(x.cod ?? x.sku ?? x.codigo ?? x.produto_key ?? '').trim();
        if (codBi && !porCod.has(codBi)) porCod.set(codBi, x);
        const nomeExato = norm(x.produto);
        if (nomeExato && !porNome.has(nomeExato)) porNome.set(nomeExato, x);
        const k = _normMaterial(x.produto);
        if (k && !porNomeMaterial.has(k)) porNomeMaterial.set(k, x);
      });

      return insumosFicha.map(i => {
        // A própria ficha técnica já guarda o código Bluesoft do insumo.
        // O 360 estava ignorando esse código e tentando casar só pelo nome,
        // enquanto o MRP (65/85) já usa código primeiro. Isso fazia vários
        // materiais aparecerem com "—" mesmo existindo saldo no BI.
        const codInsumo = String(i.bluesoftProdutoKey ?? i.produtoKey ?? i.cod ?? i.codigo ?? '').trim();
        const nome = i.insumo || i.nome || i.desc_insumo || i.descricao || '';
        const bi = (codInsumo && porCod.get(codInsumo))
          || porNome.get(norm(nome))
          || porNomeMaterial.get(_normMaterial(nome))
          || null;
        return {
          insumo: nome,
          cod: codInsumo,
          qty: n(i.qty ?? i.qtd ?? i.quantidade ?? i.consumoPorCaixa),
          categoria: i.categoria || i.cat || '',
          bi
        };
      });
    } catch (e) { return []; }
  }

  async function _desenhar() {
    const pagina = document.getElementById('page-pcp-produto-360');
    if (!pagina) return;
    const internos = global._pcpInternals;
    const filtrosPCP=internos.getFiltros?.()||{};
    const lojaContexto=String(filtrosPCP.loja||global.getDTLojaAtiva?.()||'');
    const visao = internos.construirVisao({ estoqueBi: internos.getEstoqueBi?.(), lojaContexto });
    const item = visao.find(x => x.key === _produtoKey);
    if (!item) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Produto não encontrado</div><div class="empty-sub">Volte e selecione um produto em qualquer tabela do PCP.</div></div>'; return; }
    // PEDIDO AO VIVO (2026-09-21): "cadastro único" — quando o mestre
    // global (produtos_mestre) já tiver o produto (pós-migração), seus
    // campos (categoria de verdade, parâmetros de compra, etc.) prevalecem
    // sobre o cadastro por loja; até lá o Map vem vazio e isto não muda
    // nada do comportamento atual.
    // Usa o mesmo cadastro canônico do motor/Planejamento. Evita o Produto
    // 360° pegar simplesmente a primeira variante do código e exibir
    // parâmetros diferentes dos usados no cálculo (ex.: 5d em Parâmetros e
    // 30d aqui por causa da ordem dos documentos).
    const produtoCad = internos.resolverCadastroProduto?.(_produtoKey,{lojaId:lojaContexto}) || {};
    const projecaoRec = (internos.getProjecao?.() || []).find(p => internos.keyOf(p) === _produtoKey && (!lojaContexto || String(p.lojaId||'')===lojaContexto)) || {};
    const proxMeses = _proximosMesesEscadinha(item, projecaoRec);
    const produzidoInternamente = (internos.produzidoInternamenteNaLoja?.(_produtoKey, lojaContexto) ?? internos.produzidoInternamente?.(_produtoKey)) === true;
    const historico = (internos.getReqs?.() || [])
      .filter(r => internos.keyOf(r) === _produtoKey && n(r.quantidadeComprada) > 0)
      .filter(r => !lojaContexto || String(r.lojaId||r.origemLojaId||'') === lojaContexto)
      .sort((a, b) => String(b.compradoEm || '').localeCompare(String(a.compradoEm || '')));
    // Carrega a mesma fonte local de insumos usada pelo PCP, quando ainda
    // não estiver em memória. Não cria leitura Firestore adicional.
    if (!internos.getInsumosBi?.()?.length) {
      try { await internos._garantirCatalogosSolicitacao?.('insumos'); } catch (_) {}
    }
    const insumos = await _buscarInsumosDoProduto(item.cod);
    const passos = internos.memoriaDeCalculo(item);
    const marcos = global._pcpTimelineInternals?.construirLinhaDoTempo?.(item, 90) || [];
    const riscoTemporal = global._pcpTimelineInternals?.calcularRiscoTemporal?.(item, 365) || null;
    const ajusteProducao = produzidoInternamente ? internos._quantidadeProducaoAjustada?.(item) : null;
    const proximaSugestao = produzidoInternamente ? Math.max(0,n(ajusteProducao?.quantidade ?? item.necessidade)) : Math.max(0, n(item.quantidadeSugerida != null ? item.quantidadeSugerida : item.necessidade));
    const marcoIdeal = marcos.find(m => m.estado === 'abaixo_minimo' || m.estado === 'critico' || m.estado === 'ruptura');
    const dataAcao = riscoTemporal?.pontoPedidoEm || marcoIdeal?.data || null;
    const abastecimentoCard = produzidoInternamente ? `
        <div class="tc" style="padding:12px">
          <b>🏭 Produção</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Origem do abastecimento</td><td style="text-align:right"><b>Produção interna</b></td></tr>
            <tr><td>Produção programada</td><td style="text-align:right">${n(item.producaoProgramada).toLocaleString('pt-BR')}</td></tr>
            <tr><td>Produção mínima</td><td style="text-align:right">${n(produtoCad.producaoMinima) > 0 ? n(produtoCad.producaoMinima).toLocaleString('pt-BR') : '—'}</td></tr>
            <tr><td>Múltiplo de produção</td><td style="text-align:right">${n(produtoCad.multiploProducao) > 0 ? n(produtoCad.multiploProducao).toLocaleString('pt-BR') : '—'}</td></tr>
            <tr><td>Empresa produtora</td><td style="text-align:right">${esc(produtoCad.empresaProdutoraNome || produtoCad.empresaProdutoraId || '—')}</td></tr>
          </tbody></table>
        </div>` : `
        <div class="tc" style="padding:12px">
          <b>🛒 Compras</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Requisições compradas (operacional)</td><td style="text-align:right">${historico.length}</td></tr>
            <tr><td>Qtd. comprada nas requisições PCP</td><td style="text-align:right">${historico.reduce((s, h) => s + n(h.quantidadeComprada), 0).toLocaleString('pt-BR')}</td></tr>
            <tr><td>Último fornecedor</td><td style="text-align:right">${esc(historico[0]?.fornecedor || '—')}</td></tr>
            <tr><td>Última quantidade</td><td style="text-align:right">${historico.length ? n(historico[0].quantidadeComprada).toLocaleString('pt-BR') : '—'}</td></tr>
            <tr><td>Fornecedor preferencial</td><td style="text-align:right">${esc(produtoCad.fornecedorPadrao || '—')}</td></tr>
          </tbody></table>
        </div>`;
    const historicoAbastecimento = produzidoInternamente ? '' : `
      <div class="tc" style="padding:12px;margin-top:14px">
        <b>Histórico operacional de compras</b>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Data</th><th>Fornecedor</th><th>Qtd</th><th>Previsão</th><th>Status</th></tr></thead><tbody>
        ${historico.length ? historico.map(h => `<tr><td>${esc(String(h.compradoEm || '').slice(0, 10))}</td><td>${esc(h.fornecedor || '')}</td><td>${n(h.quantidadeComprada).toLocaleString('pt-BR')}</td><td>${esc(String(h.dataPrevista || '').slice(0, 10))}</td><td>${esc(h.status || '')}</td></tr>`).join('') : '<tr><td colspan="5">Nenhuma compra registrada ainda.</td></tr>'}
        </tbody></table></div>
      </div>`;

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.2rem">🔎 ${esc(item.produto)}</div><div style="font-size:.74rem;color:var(--muted)">Cód. ${esc(item.cod || '—')} · ${esc(internos.metaProduto?.(item)?.categoria || produtoCad.categoria || 'Sem categoria')}</div></div>
        <button type="button" class="acao-lapis" title="Memória de cálculo completa" data-pcp-memoria="${esc(item.key)}">🧮 Memória de cálculo</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
        <div class="tc" style="padding:12px">
          <b>📦 Estoque</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Estoque atual</td><td style="text-align:right">${item.estoqueAtual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>
            <tr><td>Disponível</td><td style="text-align:right">${item.estoqueDisponivel.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>
            <tr><td>Comprometido</td><td style="text-align:right">${item.estoqueComprometido.toLocaleString('pt-BR')}</td></tr>
            <tr><td>Em trânsito (entradas previstas)</td><td style="text-align:right">${item.entradasPrevistas.toLocaleString('pt-BR')}</td></tr>
            <tr><td>Projetado (saldo)</td><td style="text-align:right"><b>${item.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</b></td></tr>
            <tr><td>Cobertura atual</td><td style="text-align:right">${item.consumoDia>0?(item.estoqueDisponivel/item.consumoDia).toFixed(1)+'d':'—'}</td></tr>
            <tr><td>Cobertura desejada</td><td style="text-align:right">${item.diasAlvo}d</td></tr>
            <tr><td>Mínimo / Máximo / Segurança</td><td style="text-align:right">${esc(produtoCad.estoqueMinimo ?? '—')} / ${esc(produtoCad.estoqueMaximo ?? '—')} / ${item.estoqueSeguranca != null ? esc(Number(item.estoqueSeguranca).toLocaleString('pt-BR',{maximumFractionDigits:1})) : '—'}</td></tr>
          </tbody></table>
        </div>
        <div class="tc" style="padding:12px">
          <b>📈 Consumo</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Consumo diário estimado</td><td style="text-align:right">${item.consumoDia.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td></tr>
            <tr><td>Consumo semanal</td><td style="text-align:right">${(item.consumoDia * 7).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>
            <tr><td>${esc(proxMeses.rotulo)}</td><td style="text-align:right">${esc(proxMeses.labels[0])} ${proxMeses.valores[0].toLocaleString('pt-BR')} / ${esc(proxMeses.labels[1])} ${proxMeses.valores[1].toLocaleString('pt-BR')} / ${esc(proxMeses.labels[2])} ${proxMeses.valores[2].toLocaleString('pt-BR')}</td></tr>
            <tr><td>Tendência</td><td style="text-align:right">${proxMeses.valores[0] > 0 ? (((proxMeses.valores[2] - proxMeses.valores[0]) / proxMeses.valores[0] * 100).toFixed(1) + '%') : '—'}</td></tr>
          </tbody></table>
        </div>
        ${abastecimentoCard}
        <div class="tc" style="padding:12px">
          <b>🗓️ Planejamento</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Necessidade atual</td><td style="text-align:right">${item.necessidade.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td></tr>
            <tr><td>${produzidoInternamente ? 'Próxima produção sugerida' : 'Próxima compra sugerida'}</td><td style="text-align:right"><b>${proximaSugestao.toLocaleString('pt-BR')}</b></td></tr>
            <tr><td>Data limite para agir</td><td style="text-align:right">${dataAcao ? esc(dataAcao) : 'sem urgência no horizonte projetado'}</td></tr>
            <tr><td>Ruptura projetada</td><td style="text-align:right">${riscoTemporal?.rupturaEm ? esc(riscoTemporal.rupturaEm) : 'não prevista no horizonte'}</td></tr>
            <tr><td>Lead time</td><td style="text-align:right"><b>${esc(item.leadTimeDias)} dias</b><small style="display:block;color:var(--muted);margin-top:2px">${esc(item.leadTimeRotulo || 'Fonte resolvida pelo PCP')}</small></td></tr>
            <tr><td>Criticidade manual</td><td style="text-align:right">${produtoCad.criticidade ? esc(produtoCad.criticidade) : '<span style="color:var(--muted)">Não configurada</span>'}</td></tr>
          </tbody></table>
        </div>
      </div>
      ${historicoAbastecimento}
      <div class="tc" style="padding:12px;margin-top:14px">
        <b>🧪 Insumos usados neste produto</b>
        <div style="font-size:.7rem;color:var(--muted);margin-top:3px">${global._pcpInternals.getInsumosBi?.()?.length ? '' : (global.DTBiPastaLocal?.suportado?.() ? 'Estoque/cobertura ainda não carregados nesta sessão. Abra/atualize a aba Insumos.' : 'Este navegador não oferece suporte à fonte local necessária para saldo/cobertura de insumos.') }</div>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Insumo</th><th>Qtd. por caixa</th><th>Estoque do insumo</th><th>Cobertura</th></tr></thead><tbody>
        ${insumos.length ? insumos.map(i => `<tr><td>${esc(i.insumo)}</td><td>${i.qty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td>${i.bi ? i.bi.estoque.toLocaleString('pt-BR') + ' ' + esc(i.bi.unidade || '') : '—'}</td><td>${i.bi && i.bi.coberturaDias != null ? i.bi.coberturaDias.toFixed(1) + 'd' : '—'}</td></tr>`).join('') : '<tr><td colspan="4">Sem ficha técnica cadastrada pra este produto ainda.</td></tr>'}
        </tbody></table></div>
      </div>`;

    _destruirGraficos();
  }

  global.pcpRegistrarPagina?.('produto-360', { elId: 'page-pcp-produto-360', render: 'renderPCPProduto360', titulo: 'Produto 360°' });
  global.abrirProduto360 = abrirProduto360;
  global.renderPCPProduto360 = renderPCPProduto360;
  global._pcp360Internals = { _buscarInsumosDoProduto, _proximosMesesEscadinha, _normMaterial };

  document.addEventListener('click', function (event) {
    const el = event.target.closest('[data-pcp-360]');
    if (el) abrirProduto360(el.getAttribute('data-pcp-360'));
  });
})(window);
