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
  // Evita rebuscar a coleção inteira de ficha técnica toda vez que o
  // usuário abre outro produto na mesma sessão da tela — só recarrega se
  // pedirem forçar (pouco provável de mudar entre 2 cliques na mesma tela).
  let _fichaTecnicaCache = null;
  async function _obterFichaTecnica(forcar) {
    if (_fichaTecnicaCache && !forcar) return _fichaTecnicaCache;
    const snap = await global.getDTFirestore().collection('producao_ficha_tecnica').get();
    _fichaTecnicaCache = snap.docs.map(d => d.data());
    return _fichaTecnicaCache;
  }

  async function _buscarInsumosDoProduto(cod, forcar) {
    if (!cod) return [];
    try {
      const fichas = await _obterFichaTecnica(forcar);
      const ficha = fichas.find(f => String(f.cod) === String(cod));
      const insumosFicha = (ficha && ficha.insumos) || [];
      const insumosBi = global._pcpInternals.getInsumosBi?.() || [];
      const norm = global._pcpInternals.norm || (v => String(v || '').trim().toLowerCase());
      const porNome = new Map(insumosBi.map(x => [norm(x.produto), x]));
      return insumosFicha.map(i => ({ insumo: i.insumo, qty: n(i.qty), categoria: i.categoria || '', bi: porNome.get(norm(i.insumo)) || null }));
    } catch (e) { return []; }
  }

  async function _desenhar() {
    const pagina = document.getElementById('page-pcp-produto-360');
    if (!pagina) return;
    const internos = global._pcpInternals;
    const visao = internos.construirVisao({ estoqueBi: internos.getEstoqueBi?.() });
    const item = visao.find(x => x.key === _produtoKey);
    if (!item) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Produto não encontrado</div><div class="empty-sub">Volte e selecione um produto em qualquer tabela do PCP.</div></div>'; return; }
    const produtoCad = (internos.getProdutos?.() || []).find(p => internos.keyOf(p) === _produtoKey) || {};
    const projecaoRec = (internos.getProjecao?.() || []).find(p => internos.keyOf(p) === _produtoKey) || {};
    const proxMeses = _proximosMesesEscadinha(item, projecaoRec);
    const historico = (internos.getReqs?.() || [])
      .filter(r => internos.keyOf(r) === _produtoKey && n(r.quantidadeComprada) > 0)
      .sort((a, b) => String(b.compradoEm || '').localeCompare(String(a.compradoEm || '')));
    const insumos = await _buscarInsumosDoProduto(item.cod);
    const passos = internos.memoriaDeCalculo(item);
    const marcos = global._pcpTimelineInternals?.construirLinhaDoTempo?.(item, 90) || [];
    const proximaCompraSugerida = item.necessidade > 0 ? Math.ceil(item.necessidade / Math.max(1, n(produtoCad.multiploCompra) || 1)) * Math.max(1, n(produtoCad.multiploCompra) || 1) : 0;
    const marcoIdeal = marcos.find(m => m.estado === 'abaixo_minimo' || m.estado === 'critico' || m.estado === 'ruptura');

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.2rem">🔎 ${esc(item.produto)}</div><div style="font-size:.74rem;color:var(--muted)">Cód. ${esc(item.cod || '—')} · ${esc(produtoCad.categoria || 'Sem categoria')}</div></div>
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
            <tr><td>Cobertura atual</td><td style="text-align:right">${item.coberturaDias == null ? '—' : item.coberturaDias.toFixed(1) + 'd'}</td></tr>
            <tr><td>Cobertura desejada</td><td style="text-align:right">${item.diasAlvo}d</td></tr>
            <tr><td>Mínimo / Máximo / Segurança</td><td style="text-align:right">${esc(produtoCad.estoqueMinimo ?? '—')} / ${esc(produtoCad.estoqueMaximo ?? '—')} / ${esc(produtoCad.estoqueSeguranca ?? '—')}</td></tr>
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
        <div class="tc" style="padding:12px">
          <b>🛒 Compras</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Compras registradas</td><td style="text-align:right">${historico.length}</td></tr>
            <tr><td>Quantidade total comprada</td><td style="text-align:right">${historico.reduce((s, h) => s + n(h.quantidadeComprada), 0).toLocaleString('pt-BR')}</td></tr>
            <tr><td>Último fornecedor</td><td style="text-align:right">${esc(historico[0]?.fornecedor || '—')}</td></tr>
            <tr><td>Última quantidade</td><td style="text-align:right">${historico.length ? n(historico[0].quantidadeComprada).toLocaleString('pt-BR') : '—'}</td></tr>
            <tr><td>Fornecedor preferencial</td><td style="text-align:right">${esc(produtoCad.fornecedorPadrao || '—')}</td></tr>
          </tbody></table>
        </div>
        <div class="tc" style="padding:12px">
          <b>🗓️ Planejamento</b>
          <table class="dt-table" style="margin-top:8px"><tbody>
            <tr><td>Necessidade atual</td><td style="text-align:right">${item.necessidade.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td></tr>
            <tr><td>Próxima compra sugerida</td><td style="text-align:right"><b>${proximaCompraSugerida.toLocaleString('pt-BR')}</b></td></tr>
            <tr><td>Data ideal da compra</td><td style="text-align:right">${marcoIdeal ? esc(marcoIdeal.data) : 'sem urgência nos próximos 90 dias'}</td></tr>
            <tr><td>Lead time</td><td style="text-align:right">${esc(produtoCad.leadTimeDias ?? '—')} dias</td></tr>
            <tr><td>Criticidade</td><td style="text-align:right">${esc(produtoCad.criticidade || 'baixa')}</td></tr>
          </tbody></table>
        </div>
      </div>
      <div class="tc" style="padding:12px;margin-top:14px">
        <b>Histórico operacional de compras</b>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Data</th><th>Fornecedor</th><th>Qtd</th><th>Previsão</th><th>Status</th></tr></thead><tbody>
        ${historico.length ? historico.map(h => `<tr><td>${esc(String(h.compradoEm || '').slice(0, 10))}</td><td>${esc(h.fornecedor || '')}</td><td>${n(h.quantidadeComprada).toLocaleString('pt-BR')}</td><td>${esc(String(h.dataPrevista || '').slice(0, 10))}</td><td>${esc(h.status || '')}</td></tr>`).join('') : '<tr><td colspan="5">Nenhuma compra registrada ainda.</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="tc" style="padding:12px;margin-top:14px">
        <b>🧪 Insumos usados neste produto</b>
        <div style="font-size:.7rem;color:var(--muted);margin-top:3px">${global._pcpInternals.getInsumosBi?.()?'':'Estoque/cobertura de insumo não carregados ainda — abra a aba "Insumos" e clique em Buscar do BI pra ver aqui também.'}</div>
        <div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Insumo</th><th>Qtd. por caixa</th><th>Estoque do insumo</th><th>Cobertura</th></tr></thead><tbody>
        ${insumos.length ? insumos.map(i => `<tr><td>${esc(i.insumo)}</td><td>${i.qty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td>${i.bi ? i.bi.estoque.toLocaleString('pt-BR') + ' ' + esc(i.bi.unidade || '') : '—'}</td><td>${i.bi && i.bi.coberturaDias != null ? i.bi.coberturaDias.toFixed(1) + 'd' : '—'}</td></tr>`).join('') : '<tr><td colspan="4">Sem ficha técnica cadastrada pra este produto ainda.</td></tr>'}
        </tbody></table></div>
      </div>`;

    _destruirGraficos();
  }

  global.pcpRegistrarPagina?.('produto-360', { elId: 'page-pcp-produto-360', render: 'renderPCPProduto360', titulo: 'Produto 360°' });
  global.abrirProduto360 = abrirProduto360;
  global.renderPCPProduto360 = renderPCPProduto360;
  global._pcp360Internals = { _buscarInsumosDoProduto, _proximosMesesEscadinha };

  document.addEventListener('click', function (event) {
    const el = event.target.closest('[data-pcp-360]');
    if (el) abrirProduto360(el.getAttribute('data-pcp-360'));
  });
})(window);
