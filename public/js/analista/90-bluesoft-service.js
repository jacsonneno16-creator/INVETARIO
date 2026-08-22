// Bluesoft — Fase 11/12: serviço compartilhado de integração via API real.
// Centraliza autenticação/paginação/normalização num único lugar em vez de
// cada tela (Estoque/75, Importação/43, PCP, Compras) duplicar sua própria
// versão. Usa a MESMA Cloud Function de proxy (bluesoftProxy) e a MESMA
// configuração (dt_config/integracao_api) já usadas hoje — nenhuma
// credencial/endpoint novo é inventado, tudo confirmado contra o schema
// real da API (api-docs da Bluesoft, OpenAPI 3.0.1).
//
// Campos que NÃO existem na Bluesoft (cobertura desejada, estoque mínimo/
// máximo/segurança, lead time, criticidade, prioridade, todo o workflow de
// requisição/roteamento do PCP) continuam sendo regra de planejamento do
// PCP, cadastrados no próprio sistema (Parâmetros PCP, fase 7) — este
// serviço nunca escreve nesses campos.
(function (global) {
  'use strict';
  const BLUESOFT_PROXY_URL = 'https://southamerica-east1-daterrinha-inventario.cloudfunctions.net/bluesoftProxy';
  const TAMANHO_PAGINA = 200;
  // Reduzido de 5 pra 3: a Bluesoft documenta limite de 10 requisições em
  // paralelo POR USUÁRIO — com produtos e estoque sendo buscados em
  // sequência (não mais em paralelo, ver sincronizarEstoqueBluesoft), 3 dá
  // folga suficiente sem deixar excessivamente lento.
  const CONCORRENCIA_PAGINAS = 3;
  const LIMITE_PAGINAS = 300;
  const CACHE_CATALOGO_MS = 24 * 60 * 60 * 1000; // 24h — mesmo padrão do snapshot diário do PCP (fase 8)
  const CACHE_CURTO_MS = 5 * 60 * 1000; // 5min — evita 2 chamadas na mesma sessão pro mesmo dado
  // Confirmado no schema oficial (parâmetro `tipoProduto` de
  // GET /api/comercial/produtos) — não é um valor inventado.
  const TIPOS_PRODUTO_VALIDOS = ['VENDA', 'INSUMO', 'EMBALAGEM', 'CONSUMO', 'SUBPRODUTO', 'PRODUTO_ACABADO'];

  let _cfgCache = null, _cfgCacheEm = 0;
  const _cacheMemoria = new Map();

  function raw() { return global.getDTRawFirestore(); }
  function normUpper(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }

  // Config lida direto do Firestore (não do formulário da tela de Importar/
  // Exportar) — assim qualquer módulo (PCP, Compras, Produção) consegue usar
  // a integração independente de qual página está aberta no momento.
  async function _config(forcar) {
    if (_cfgCache && !forcar && (Date.now() - _cfgCacheEm) < 60000) return _cfgCache;
    try {
      const snap = await raw().collection('dt_config').doc('integracao_api').get();
      _cfgCache = snap.exists ? (snap.data() || {}) : {};
    } catch (e) { _cfgCache = {}; }
    _cfgCacheEm = Date.now();
    return _cfgCache;
  }
  function _baseUrl(cfg) { return cfg.ambiente === 'producao' ? (cfg.url_prd || '') : (cfg.url_hml || ''); }

  async function _requestBluesoft(pathComQuery, cfg, method, body) {
    const idToken = await global.firebase?.auth?.().currentUser?.getIdToken();
    if (!idToken) throw new Error('Faça login novamente para usar a integração Bluesoft.');
    const baseUrl = _baseUrl(cfg);
    if (!baseUrl) throw new Error('Configure a URL da Bluesoft (Homologação/Produção) em Importar/Exportar → Configuração da API.');
    if (!cfg.token) throw new Error('Configure o Token/API Key da Bluesoft em Importar/Exportar → Configuração da API.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (Number(cfg.timeout) || 30) * 1000);
    let resposta;
    try {
      resposta = await global.fetch(BLUESOFT_PROXY_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ method: method || 'GET', path: pathComQuery, baseUrl: baseUrl.replace(/\/+$/, ''), token: cfg.token, body }),
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('A Bluesoft demorou demais para responder (timeout) em ' + pathComQuery.split('?')[0] + '.');
      throw new Error('Falha de rede ao chamar ' + pathComQuery.split('?')[0] + ': ' + (e.message || e));
    }
    clearTimeout(timer);
    const texto = await resposta.text();
    let dados; try { dados = texto ? JSON.parse(texto) : null; } catch (_) { dados = texto; }
    if (!resposta.ok) {
      if (resposta.status === 401) throw new Error('Token da Bluesoft inválido ou expirado.');
      if (resposta.status === 429) throw new Error('Limite de requisições da Bluesoft atingido (muitas chamadas em paralelo) — tente novamente em instantes.');
      const detalhe = dados && (dados.erro || dados.message) ? (dados.erro || dados.message) : String(texto).slice(0, 300);
      throw new Error('HTTP ' + resposta.status + ' em ' + pathComQuery.split('?')[0] + (detalhe ? ': ' + detalhe : ''));
    }
    return dados;
  }

  function _linhasDe(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    return body.data || body.items || body.results || [];
  }

  // Paginação currentPage/pageSize — padrão de todos os endpoints REST da
  // Bluesoft usados aqui. Dedup por chave de identidade explícita quando
  // informada (mais barato/seguro que JSON.stringify do item inteiro, que
  // chega a ter 90+ campos em /api/comercial/produtos). `onProgresso(n)` é
  // chamado a cada rodada com o total de itens já recebidos — a API não
  // devolve um total geral antecipado, então não dá pra mostrar % real sem
  // inventar um número; o chamador mostra uma contagem viva em vez disso.
  async function _paginarTudo(path, params, cfg, chaveIdentidade, onProgresso) {
    const itens = [];
    const vistos = new Set();
    let pagina = 0, acabou = false, paginasSemNovidade = 0;
    while (!acabou) {
      const indices = Array.from({ length: CONCORRENCIA_PAGINAS }, (_, i) => pagina + i);
      const respostas = await Promise.all(indices.map(p => {
        const qs = new URLSearchParams(Object.assign({}, params, { currentPage: p, pageSize: TAMANHO_PAGINA })).toString();
        return _requestBluesoft(path + '?' + qs, cfg);
      }));
      for (const body of respostas) {
        const linhas = _linhasDe(body);
        if (!linhas.length) { acabou = true; break; }
        let novos = 0;
        linhas.forEach(item => {
          const chave = chaveIdentidade ? String(chaveIdentidade(item)) : JSON.stringify(item);
          if (!vistos.has(chave)) { vistos.add(chave); itens.push(item); novos++; }
        });
        if (novos === 0) { paginasSemNovidade++; if (paginasSemNovidade >= 5) { acabou = true; break; } }
        else paginasSemNovidade = 0;
        if (linhas.length < TAMANHO_PAGINA) { acabou = true; break; }
      }
      pagina += CONCORRENCIA_PAGINAS;
      if (typeof onProgresso === 'function') { try { onProgresso(itens.length); } catch (e) { /* nunca deixa o progresso quebrar a busca */ } }
      if (pagina > LIMITE_PAGINAS) throw new Error('A busca passou do limite de segurança sem terminar — fale com o suporte da Bluesoft.');
    }
    return itens;
  }

  // BUG AO VIVO REAL (2026-08-20): "ficou mais de 5m e não trouxe nada" —
  // os lookups targetados (1 chamada por cliente/vendedor único) eram feitos
  // um de cada vez, em sequência (`for...of` com `await` dentro). Com
  // dezenas/centenas de clientes ou vendedores distintos numa busca, isso
  // sozinho já passava de vários minutos. Roda em lotes paralelos — rápido
  // o suficiente sem mandar tudo de uma vez.
  // AJUSTADO no mesmo dia (2026-08-20): o lote de 8 provavelmente esbarrou
  // no limite de requisições simultâneas da Bluesoft ("muitos mercados não
  // trouxe [vendedor]" — um lote inteiro de 429 vira `catch(){}` silencioso
  // e some sem erro visível). Reduzido pra 4, mesmo espírito de
  // CONCORRENCIA_PAGINAS (3) já usado na paginação.
  const TAMANHO_LOTE_LOOKUP = 4;
  async function _emLotesParalelos(itens, fn, tamanhoLote) {
    tamanhoLote = tamanhoLote || TAMANHO_LOTE_LOOKUP;
    for (let i = 0; i < itens.length; i += tamanhoLote) {
      await Promise.all(itens.slice(i, i + tamanhoLote).map(fn));
    }
  }
  function _cacheGet(chave, ttlMs) { const c = _cacheMemoria.get(chave); return (c && (Date.now() - c.em) < ttlMs) ? c.dados : null; }
  function _cacheSet(chave, dados) { _cacheMemoria.set(chave, { dados, em: Date.now() }); }

  // Avisa os módulos que já carregaram dados em memória (Projeção, PCP,
  // Insumos) que acabou de entrar dado novo — sem isso, quem já tinha
  // visitado a tela antes da sincronização continuava vendo o estado antigo
  // em cache até recarregar a página inteira (F5).
  function _invalidarCachesDependentes() {
    try { global.carregarProducaoProjecao?.(true); } catch (e) { /* melhor esforço */ }
    try { global._pcpInternals?.carregar?.(true); } catch (e) { /* melhor esforço */ }
    try { global.carregarProducaoInsumos?.(true); } catch (e) { /* melhor esforço */ }
  }

  // ── Produtos (catálogo) — GET /api/comercial/produtos ──────────────────
  // subGrupoProduto já vem como texto no próprio produto — não precisa de
  // uma segunda chamada à árvore mercadológica só pra ter uma categoria
  // legível. `tipoProduto` é um filtro REAL da Bluesoft (confirmado no
  // schema oficial, enum VENDA/INSUMO/EMBALAGEM/CONSUMO/SUBPRODUTO/
  // PRODUTO_ACABADO) — usar isso pra pedir só o que interessa é o que evita
  // trazer "produto pra consumo interno" junto com produto de venda.
  function _normalizarProduto(p) {
    const fornecedores = p.fornecedores || [];
    const fornecedorPadrao = fornecedores.find(f => f.padrao) || fornecedores[0] || null;
    const tp = p.tipoProduto || {};
    return {
      produtoKey: p.produtoKey, cod: String(p.produtoKey), nome: p.descricao || '',
      unidade: p.tipoUnidadeMedida?.descricao || '',
      gtin: p.gtinPrincipal || (p.gtins || [])[0] || '',
      status: p.status || '', categoria: p.subGrupoProduto || '',
      fornecedorPadraoKey: fornecedorPadrao?.fornecedorKey ?? p.fornecedorPadraoKey ?? null,
      fornecedorPadraoNome: fornecedorPadrao?.nomeRazao || '',
      multiploCompraSugerido: fornecedorPadrao?.multiploCompraUnitaria || null,
      produtoAcabado: tp.produtoAcabado === true, materiaPrima: tp.materiaPrima === true,
      mercadoriaParaRevenda: tp.mercadoriaParaRevenda === true, mercadoriaParaUsoConsumo: tp.mercadoriaParaUsoConsumo === true,
      embalagem: tp.embalagem === true, subProduto: tp.subProduto === true,
      tipoPrincipal: tp.produtoAcabado ? 'PRODUTO_ACABADO' : tp.mercadoriaParaRevenda ? 'VENDA' : tp.embalagem ? 'EMBALAGEM'
        : tp.materiaPrima ? 'INSUMO' : tp.subProduto ? 'SUBPRODUTO' : tp.mercadoriaParaUsoConsumo ? 'CONSUMO' : '',
    };
  }
  // Um doc de producao_produtos só pode ser apagado pela reconciliação
  // automática se ele NUNCA foi tocado por Ficha Técnica nem por Parâmetros
  // PCP — a sincronização Bluesoft só grava os campos de catálogo (ver
  // payload abaixo); qualquer chave fora desse conjunto presente no doc
  // prova que outro fluxo (ficha técnica/PCP) já configurou esse produto de
  // propósito, mesmo que agora esteja sem estoque — nunca apaga isso.
  const CAMPOS_PROTEGIDOS_PRODUTO = ['metaCoberturaDias', 'estoqueMinimo', 'estoqueMaximo', 'estoqueSeguranca',
    'leadTimeDias', 'loteMinimoCompra', 'criticidade', 'pc_min', 'maquina', 'producaoMinima', 'multiploProducao',
    'tipoMinimo', 'prioridadeProducao', 'alergenico', 'empresaProdutoraId', 'insumos'];
  function _produtoProtegidoPcp(x) { return CAMPOS_PROTEGIDOS_PRODUTO.some(campo => x[campo] !== undefined); }
  // Busca um-a-um por tipo (o filtro da Bluesoft aceita só um valor por
  // chamada) e junta sem duplicar — um produto raramente casa com mais de
  // um tipo, mas o dedup por produtoKey cobre esse caso mesmo assim.
  // Cada tipo é uma chamada HTTP separada (a Bluesoft só aceita um valor de
  // tipoProduto por vez) — se um tipo específico falhar (ex.: erro interno
  // da Bluesoft só pra PRODUTO_ACABADO), os outros tipos que já vieram bem
  // não são descartados; a falha fica registrada em `.falhas` no array
  // devolvido, pro chamador avisar o usuário sem jogar fora o que já deu
  // certo.
  async function _buscarProdutosPorTipos(tipos, cfg, onProgresso) {
    const porKey = new Map();
    let acumulado = 0;
    const falhas = [];
    for (const tipo of tipos) {
      if (tipo && !TIPOS_PRODUTO_VALIDOS.includes(tipo)) continue;
      const params = { status: 'ATIVO' }; if (tipo) params.tipoProduto = tipo;
      try {
        const itens = await _paginarTudo('/api/comercial/produtos', params, cfg, item => item.produtoKey, n => { if (onProgresso) onProgresso(acumulado + n); });
        itens.forEach(it => porKey.set(it.produtoKey, it));
        acumulado = porKey.size;
      } catch (e) {
        falhas.push({ tipo: tipo || '(todos)', erro: e.message || String(e) });
      }
    }
    const resultado = Array.from(porKey.values());
    resultado.falhas = falhas;
    return resultado;
  }
  async function obterCatalogoBluesoft(forcar, opcoes) {
    opcoes = opcoes || {};
    const tipos = (opcoes.tipos && opcoes.tipos.length) ? opcoes.tipos : ['PRODUTO_ACABADO', 'VENDA'];
    const chave = 'catalogo_' + tipos.slice().sort().join('_');
    if (!forcar) { const c = _cacheGet(chave, CACHE_CATALOGO_MS); if (c) return c; }
    const cfg = await _config();
    const brutos = await _buscarProdutosPorTipos(tipos, cfg, opcoes.onProgresso);
    const normalizados = brutos.map(_normalizarProduto);
    normalizados.falhas = brutos.falhas;
    if (!brutos.falhas.length) _cacheSet(chave, normalizados); // catálogo parcial nunca fica em cache — o próximo forcar precisa tentar de novo
    return normalizados;
  }

  // ── Estoque — GET /api/comercial/estoques (loja comum) ou
  //    /api/wms/ajuste-estoque-logistico (CD, mesma rota já usada hoje em
  //    75-producao-estoque.js — a rota comercial não cobre CD/WMS). Sem
  //    cache persistente (dado precisa estar fresco); só cache curto de
  //    memória pra não duplicar chamada na mesma sessão.
  function _normalizarEstoqueComercial(e) {
    return {
      produtoKey: e.produtoKey, cod: String(e.produtoKey),
      estoqueAtual: Number(e.saldoFisico) || 0, estoqueDisponivel: Number(e.saldoDisponivel) || 0,
      estoqueReservado: Number(e.quantidadeReservada) || 0, estoqueEmTransito: Number(e.quantidadeEmTransito) || 0,
      pedidosPendentes: Number(e.quantidadePendenteEmPedidos) || 0,
      // Reserva por PEDIDO DE VENDA em aberto — é o sinal que diferencia um
      // produto zerado mas irrelevante de um produto zerado com demanda
      // real represada (ruptura de verdade, que o PCP precisa enxergar).
      pedidosVendaPendentes: Number(e.quantidadeReservadaEmPedidosVendaPendentes) || 0,
      consumoDiaMedio: Number(e.mediaVendaDiaria) || 0,
      custoUltimaCompra: Number(e.custoBrutoUltimaCompra) || 0, custoMedioContabil: Number(e.custoMedioContabil) || 0,
      coberturaDiasBluesoft: e.diasDeCoberturaOnline != null ? Number(e.diasDeCoberturaOnline) : null,
    };
  }
  function _normalizarEstoqueWms(e) {
    return {
      produtoKey: String(e.produtokey || '').trim(), cod: String(e.produtokey || '').trim(),
      estoqueAtual: Math.max(0, parseFloat(String(e.quantidadedisponivelemunidades || 0).replace(',', '.')) || 0),
      estoqueDisponivel: null, estoqueReservado: null, estoqueEmTransito: null, pedidosPendentes: null, pedidosVendaPendentes: null,
      consumoDiaMedio: null, custoUltimaCompra: null, custoMedioContabil: null, coberturaDiasBluesoft: null,
    };
  }
  // Rota de fallback — /api/comercial/estoques/ficha-estoque é mais simples
  // (só saldo, sem reserva/trânsito/custo/consumo médio) mas é a MESMA rota
  // que 43-importar-exportar-api.js já usa há tempos, com sucesso comprovado
  // em produção, pra montar inventário a partir da Bluesoft. Serve de
  // fallback quando /api/comercial/estoques volta vazio pra uma loja que
  // claramente tem produto ativo (sinal de que a rota "rica" não está
  // disponível pra essa conta/loja, não que a loja não tem estoque).
  function _normalizarEstoqueFicha(e) {
    return {
      produtoKey: String(e.produtokey || '').trim(), cod: String(e.produtokey || '').trim(),
      estoqueAtual: Math.max(0, parseFloat(String(e.quantidade || 0).replace(',', '.')) || 0),
      estoqueDisponivel: null, estoqueReservado: null, estoqueEmTransito: null, pedidosPendentes: null, pedidosVendaPendentes: null,
      consumoDiaMedio: null, custoUltimaCompra: null, custoMedioContabil: null, coberturaDiasBluesoft: null,
    };
  }
  // Só interessa pro PCP/telas um produto que TEM alguma posição real: saldo
  // diferente de zero, OU pedido de venda pendente represado, OU entrada
  // prevista (trânsito/compra). Produto zerado e sem nenhum movimento
  // pendente é ruído puro — descartar isso é o que evita puxar 15-20 mil
  // linhas irrelevantes e travar a tela.
  function _estoqueRelevante(item) {
    return item.estoqueAtual !== 0 || item.estoqueReservado > 0 || item.estoqueEmTransito > 0 ||
      item.pedidosPendentes > 0 || item.pedidosVendaPendentes > 0;
  }
  async function obterEstoqueBluesoft(loja, forcar, opcoes) {
    opcoes = opcoes || {};
    const lojaKey = loja?.bluesoft_loja_key;
    if (!lojaKey) throw new Error('Loja sem vínculo com a Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const chave = 'estoque_' + lojaKey + (opcoes.incluirTodos ? '_todos' : '');
    if (!forcar) { const c = _cacheGet(chave, CACHE_CURTO_MS); if (c) return c; }
    const cfg = await _config();
    let normalizados, totalRecebido, rotaSimplificada = false;
    if (loja.bluesoft_loja_cd === true) {
      const itens = await _paginarTudo('/api/wms/ajuste-estoque-logistico', { lojaKey }, cfg, undefined, opcoes.onProgresso);
      const porProduto = new Map();
      itens.forEach(item => {
        const cod = String(item.produtokey || '').trim();
        if (!cod) return;
        if (!porProduto.has(cod)) porProduto.set(cod, _normalizarEstoqueWms(item));
        else porProduto.get(cod).estoqueAtual += _normalizarEstoqueWms(item).estoqueAtual;
      });
      normalizados = Array.from(porProduto.values());
      totalRecebido = normalizados.length; // WMS não tem sinal de "pedido pendente" pra filtrar — mantém como já era
    } else {
      const itens = await _paginarTudo('/api/comercial/estoques', {
        lojaKey, retornarCustoUltimaCompra: true, retornarEstoqueEmTransito: true, ignoraProdutosInativos: true,
      }, cfg, item => item.produtoKey, opcoes.onProgresso);
      let todosNormalizados = itens.map(_normalizarEstoqueComercial);
      totalRecebido = todosNormalizados.length;
      if (!totalRecebido) {
        // /api/comercial/estoques voltou vazio pra essa loja — cai pra
        // .../ficha-estoque (rota mais simples, sem reserva/trânsito/custo,
        // mas comprovadamente funcional pra essa mesma loja no fluxo de
        // Inventário) em vez de reportar "0 de estoque" quando na verdade é
        // a rota rica que não está disponível.
        const itensFicha = await _paginarTudo('/api/comercial/estoques/ficha-estoque', { lojaKey }, cfg, item => item.produtokey, opcoes.onProgresso);
        todosNormalizados = itensFicha.map(_normalizarEstoqueFicha);
        totalRecebido = todosNormalizados.length;
        rotaSimplificada = totalRecebido > 0;
      }
      normalizados = opcoes.incluirTodos ? todosNormalizados : todosNormalizados.filter(_estoqueRelevante);
    }
    const resultado = { itens: normalizados, totalRecebido, rotaSimplificada };
    _cacheSet(chave, resultado);
    return resultado;
  }

  // ── Fornecedores — GET /api/fornecedores ────────────────────────────────
  async function obterFornecedoresBluesoft(forcar) {
    const chave = 'fornecedores';
    if (!forcar) { const c = _cacheGet(chave, CACHE_CATALOGO_MS); if (c) return c; }
    const cfg = await _config();
    const itens = await _paginarTudo('/api/fornecedores', {}, cfg, item => item.fornecedorKey);
    const normalizados = itens.filter(f => f.ativa !== false).map(f => ({
      fornecedorKey: f.fornecedorKey, nome: f.nomeFantasia || f.nomeRazao || '', razaoSocial: f.nomeRazao || '', documento: f.cpfCnpj || '',
    }));
    _cacheSet(chave, normalizados);
    return normalizados;
  }

  // ── Pedidos de compra — GET /api/compras/pedidos-de-compra ─────────────
  // Sob demanda (tela de Acompanhamento de Compras), sem cache persistente.
  async function obterPedidosCompraBluesoft(filtros) {
    filtros = filtros || {};
    const cfg = await _config();
    const params = {};
    if (filtros.lojaKey) params.lojaKey = filtros.lojaKey;
    if (filtros.dataEntregaInicial) params.dataEntregaInicial = filtros.dataEntregaInicial;
    if (filtros.dataEntregaFinal) params.dataEntregaFinal = filtros.dataEntregaFinal;
    if (filtros.codigoDoFornecedor) params.codigoDoFornecedor = filtros.codigoDoFornecedor;
    const itens = await _paginarTudo('/api/compras/pedidos-de-compra', params, cfg, item => item.numeroPedido);
    return itens.map(p => ({
      numeroPedido: p.numeroPedido, dataEmissao: p.dataEmissao, fornecedorKey: p.fornecedorKey,
      status: p.statusPedido || '', dataEntregaInicial: p.dataEntregaInicial, dataEntregaFinal: p.dataEntregaFinal,
      entregaPendente: p.entregaPendente === true,
      itens: (p.itens || []).map(it => ({ itemPedidoKey: it.itemPedidoKey, produtoKey: it.produtoKey, quantidadePedida: Number(it.quantidadePedida) || 0, quantidadePendente: Number(it.quantidadePendente) || 0 })),
    }));
  }

  // ── Recebimento (Logística/FASE 15) ──────────────────────────────────────
  // 3 rotas reais e confirmadas no schema oficial, sem inventar nada:
  // - GET /api/estoque/recebimento/status-processamento-nfe — nota a nota,
  //   com inicioLancamento/fimLancamento (tempo real de recebimento). O
  //   filtro é limitado a 31 dias por chamada (documentado), por isso a
  //   varredura é mês a mês.
  // - GET /api/compras/recebimentocargas — carga/movimentação (só tem
  //   dataInicialGeracao, sem data final — busca tudo a partir daí de uma
  //   vez, sem precisar janelar por mês).
  // - GET /api/compras/pedidos-de-compra/entregas — a PONTE real entre nota
  //   recebida e pedido de compra: dá quantidadeRecebida por itemPedidoKey,
  //   ligado à nota via notaFiscal.nfKey. Cruzando com quantidadePedida (já
  //   trazido por obterPedidosCompraBluesoft, mesmo itemPedidoKey) dá a
  //   divergência real — não é estimativa.
  function _fmtDataBR(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }
  function _janelasMensais(qtd) {
    const janelas = [];
    const hoje = new Date();
    for (let i = 0; i < qtd; i++) {
      const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const inicio = new Date(ref.getFullYear(), ref.getMonth(), 1);
      const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      if (fim > hoje) fim.setTime(hoje.getTime());
      janelas.push({ inicio: _fmtDataBR(inicio), fim: _fmtDataBR(fim), chave: ref.getFullYear() + '-' + String(ref.getMonth() + 1).padStart(2, '0') });
    }
    return janelas;
  }
  function _normalizarNotaRecebimento(n) {
    const inicio = n.inicioLancamento ? new Date(n.inicioLancamento) : null;
    const fim = n.fimLancamento ? new Date(n.fimLancamento) : null;
    const tempoLancamentoMin = (inicio && fim && !isNaN(inicio) && !isNaN(fim)) ? Math.round((fim - inicio) / 60000) : null;
    return {
      notaFiscalKey: n.notaFiscalKey ?? null, numeroNota: n.notaFiscal ?? null, serieNota: n.serieNota ?? null,
      chaveNota: n.chaveNota || '', cnpjRemetente: n.cnpjRemetente || '', valor: Number(n.valor) || 0,
      status: n.status || '', statusRecebimento: n.statusRecebimento || '', fechada: n.notaFiscalFechada === true,
      natureza: n.natureza || '', processamento: n.processamento || null, dataRecebimento: n.dataRecebimento || null,
      inicioLancamento: n.inicioLancamento || null, fimLancamento: n.fimLancamento || null, tempoLancamentoMin,
      // preenchido depois, em sincronizarRecebimentoBluesoft, cruzando com
      // a carga (StatusProcessamentoNfeResponse não tem esse campo direto).
      tipoTransferencia: null,
    };
  }
  async function obterNotasRecebimentoBluesoft(lojaKey, janela, cfg, onProgresso) {
    const params = { lojaKey, dataProcessamentoInicial: janela.inicio, dataProcessamentoFinal: janela.fim };
    const itens = await _paginarTudo('/api/estoque/recebimento/status-processamento-nfe', params, cfg, item => item.notaFiscalKey, onProgresso);
    return itens.map(_normalizarNotaRecebimento);
  }
  // Valores confirmados no schema real da Bluesoft
  // (RecebimentoCargaListarNotasFiscaisResponse.tipoTransferencia) — é o
  // único campo com enum fechado pra identificar devolução com certeza
  // (o campo `natureza` da StatusProcessamentoNfeResponse é string livre,
  // sem enum documentado, não dá pra confiar num valor exato).
  const TIPOS_TRANSFERENCIA_DEVOLUCAO = ['DEVOLUCAO_ENTRE_LOJAS', 'DEVOLUCAO_CLIENTE'];
  function _normTxt(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }
  // `tipoTransferencia` só existe pra nota que está dentro de uma carga
  // (RecebimentoCargaListarNotasFiscaisResponse) — devolução de cliente
  // (DEVOLUCAO_CLIENTE) normalmente não anda de carga/caminhão, então nunca
  // cruza com nenhuma carga e o campo fica null (bug ao vivo relatado: a
  // devolução continuava aparecendo mesmo com o filtro). Por isso o texto
  // livre de `natureza` (StatusProcessamentoNfeResponse, sem enum
  // documentado) entra como sinal extra. Confirmado com dado real em
  // produção que a Bluesoft usa descrição de natureza no estilo CFOP,
  // abreviada — ex.: "Dev.compra com.em op.merc.suj.reg.sub.trib." (só
  // "Dev.", não a palavra inteira "devolução"), então o texto precisa cobrir
  // a forma abreviada também, não só "DEVOL". "RETORNO" (ex.: "Retorno de
  // mercadoria utilizada na industrialização") também não é recebimento de
  // fornecedor de verdade — mesma categoria de exclusão, pedido explícito do
  // usuário ("nota de venda, nota de retorno... a de devolução pode tirar
  // fora").
  const RE_NATUREZA_NAO_RECEBIMENTO = /\bDEV(OL|\.)|\bRETORNO\b/;
  function _ehDevolucao(nota) {
    if (TIPOS_TRANSFERENCIA_DEVOLUCAO.includes(nota?.tipoTransferencia)) return true;
    return RE_NATUREZA_NAO_RECEBIMENTO.test(_normTxt(nota?.natureza));
  }
  // Classificação por categoria pra rotear cada nota pro lugar certo na UI
  // (pedido ao vivo do usuário): FORNECEDOR fica no Dashboard/Notas Fiscais
  // (90/91/94), TRANSBORDO fica na tela de Transbordo (95) — os dados
  // puxados da Bluesoft têm que aparecer lá, não só ficar misturado no
  // Dashboard geral. DEVOLUCAO some das duas por padrão (já tratado acima).
  // Mesmo fallback por texto de `natureza` usado em `_ehDevolucao`, pelo
  // mesmo motivo: nem toda nota de transferência necessariamente cruza com
  // uma carga (ver comentário de `_ehDevolucao`).
  function _categoriaNota(nota) {
    if (_ehDevolucao(nota)) return 'DEVOLUCAO';
    if (nota?.tipoTransferencia === 'TRANSFERENCIA_ENTRE_LOJAS') return 'TRANSBORDO';
    if (_normTxt(nota?.natureza).includes('TRANSFER')) return 'TRANSBORDO';
    return 'FORNECEDOR';
  }
  function _normalizarCargaRecebimento(c) {
    const nfs = c.notasFiscais || [];
    return {
      movimentacaoCargaKey: c.movimentacaoCargaKey ?? null, lojaKey: c.lojaKey ?? null,
      dataGeracao: c.dataGeracao || null, dataInicioRecebimento: c.dataInicioRecebimento || null, dataFimRecebimento: c.dataFimRecebimento || null,
      notasFiscaisKeys: nfs.map(nf => nf.nfKey).filter(k => k != null),
      placaVeiculo: nfs.find(nf => nf.placaVeiculo)?.placaVeiculo || '',
      // por nota dentro da carga — usado pra cruzar tipoTransferencia (e
      // assim identificar devolução) na hora de montar cada nota sincronizada.
      notasFiscaisDetalhe: nfs.map(nf => ({ nfKey: nf.nfKey ?? null, tipoTransferencia: nf.tipoTransferencia || null })),
    };
  }
  async function obterCargasRecebimentoBluesoft(lojaKey, mesesAtras, cfg, onProgresso) {
    const inicio = new Date(); inicio.setMonth(inicio.getMonth() - mesesAtras); inicio.setDate(1);
    const itens = await _paginarTudo('/api/compras/recebimentocargas', { lojaKey, dataInicialGeracao: _fmtDataBR(inicio) }, cfg, item => item.movimentacaoCargaKey, onProgresso);
    return itens.map(_normalizarCargaRecebimento);
  }
  async function obterEntregasPedidosBluesoft(lojaKey, cfg) {
    const itens = await _paginarTudo('/api/compras/pedidos-de-compra/entregas', { lojaKey }, cfg, item => (item.itemPedidoKey + '_' + (item.notaFiscal?.nfKey ?? '')));
    return itens.map(e => ({
      itemPedidoKey: e.itemPedidoKey, quantidadeRecebida: Number(e.quantidadeRecebida) || 0,
      nfKey: e.notaFiscal?.nfKey ?? null,
    }));
  }
  // Nunca apaga nada aqui — ao contrário de produtos/estoque (que são
  // "situação atual"), recebimento é histórico mês a mês; um mês antigo não
  // varrido de novo não deixa de ter acontecido. `chegadaPortaria` é campo
  // manual (não existe API de portaria/YMS confirmada) — o payload nunca
  // inclui essa chave, então merge:true nunca sobrescreve o que o analista
  // digitou na tela.
  async function sincronizarRecebimentoBluesoft(opcoes) {
    opcoes = opcoes || {};
    const meses = Math.max(1, Math.min(24, Number(opcoes.meses) || 12));
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const lojaKey = loja.bluesoft_loja_key;
    const cfg = await _config();

    const [cargas, entregas, pedidos, fornecedores] = await Promise.all([
      obterCargasRecebimentoBluesoft(lojaKey, meses, cfg),
      obterEntregasPedidosBluesoft(lojaKey, cfg),
      obterPedidosCompraBluesoft({ lojaKey }),
      obterFornecedoresBluesoft(false),
    ]);

    const pedidoPorItem = new Map();
    pedidos.forEach(p => (p.itens || []).forEach(it => { if (it.itemPedidoKey != null) pedidoPorItem.set(it.itemPedidoKey, it); }));
    const entregasPorNf = new Map();
    entregas.forEach(e => {
      if (e.nfKey == null) return;
      const pedidoItem = pedidoPorItem.get(e.itemPedidoKey);
      const lista = entregasPorNf.get(e.nfKey) || [];
      lista.push({ recebido: e.quantidadeRecebida, pedido: pedidoItem ? pedidoItem.quantidadePedida : null });
      entregasPorNf.set(e.nfKey, lista);
    });
    const fornecedorPorCnpj = new Map(fornecedores.map(f => [String(f.documento || '').replace(/\D/g, ''), f.nome]));
    const cargaPorNf = new Map();
    cargas.forEach(c => c.notasFiscaisKeys.forEach(nfKey => cargaPorNf.set(nfKey, c)));

    const janelas = _janelasMensais(meses);
    const notasBrutas = [];
    let acumulado = 0;
    for (const janela of janelas) {
      const lote = await obterNotasRecebimentoBluesoft(lojaKey, janela, cfg);
      notasBrutas.push(...lote);
      acumulado += lote.length;
      if (typeof opcoes.onProgresso === 'function') { try { opcoes.onProgresso(acumulado); } catch (e) { /* nunca deixa o progresso quebrar a busca */ } }
    }

    const fs = global.getDTFirestore();
    const rawFs = raw();
    const [notasSnap, cargasSnap] = await Promise.all([
      fs.collection('recebimento_notas').get(),
      fs.collection('recebimento_cargas').get(),
    ]);
    const notaDocPorKey = new Map();
    notasSnap.docs.forEach(d => { const x = d.data() || {}; if (x.notaFiscalKey != null) notaDocPorKey.set(String(x.notaFiscalKey), d.id); });
    const cargaDocPorKey = new Map();
    cargasSnap.docs.forEach(d => { const x = d.data() || {}; if (x.movimentacaoCargaKey != null) cargaDocPorKey.set(String(x.movimentacaoCargaKey), d.id); });

    const agora = new Date().toISOString();
    let comDivergencia = 0, criadas = 0, atualizadas = 0;
    for (let i = 0; i < notasBrutas.length; i += 300) {
      const lote = notasBrutas.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(n => {
        const carga = cargaPorNf.get(n.notaFiscalKey);
        const entregasDaNota = entregasPorNf.get(n.notaFiscalKey);
        let comparavel = false, quantidadePedidaTotal = 0, quantidadeRecebidaTotal = 0;
        if (entregasDaNota && entregasDaNota.length) {
          entregasDaNota.forEach(e => { if (e.pedido != null) { comparavel = true; quantidadePedidaTotal += e.pedido; } quantidadeRecebidaTotal += e.recebido; });
        }
        const divergencia = comparavel ? (quantidadeRecebidaTotal - quantidadePedidaTotal) : null;
        const temDivergencia = comparavel && Math.abs(divergencia) > 0.001;
        if (temDivergencia) comDivergencia++;
        const detalheNf = carga?.notasFiscaisDetalhe?.find(x => x.nfKey === n.notaFiscalKey);
        const payload = {
          ...n, fornecedorNome: fornecedorPorCnpj.get(String(n.cnpjRemetente || '').replace(/\D/g, '')) || '',
          movimentacaoCargaKey: carga?.movimentacaoCargaKey ?? null,
          tipoTransferencia: detalheNf?.tipoTransferencia ?? null,
          comparavel, quantidadePedidaTotal: comparavel ? quantidadePedidaTotal : null, quantidadeRecebidaTotal: comparavel ? quantidadeRecebidaTotal : null,
          divergencia, temDivergencia, bluesoftSincronizadoEm: agora, atualizadoEm: agora,
        };
        const docId = notaDocPorKey.get(String(n.notaFiscalKey));
        if (docId) { batch.set(fs.collection('recebimento_notas').doc(docId), payload, { merge: true }); atualizadas++; }
        else { batch.set(fs.collection('recebimento_notas').doc(), { ...payload, criadoEm: agora }, { merge: true }); criadas++; }
      });
      await batch.commit();
    }
    let cargasCriadas = 0, cargasAtualizadas = 0;
    for (let i = 0; i < cargas.length; i += 300) {
      const lote = cargas.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(c => {
        const payload = { ...c, atualizadoEm: agora, bluesoftSincronizadoEm: agora };
        const docId = cargaDocPorKey.get(String(c.movimentacaoCargaKey));
        if (docId) { batch.set(fs.collection('recebimento_cargas').doc(docId), payload, { merge: true }); cargasAtualizadas++; }
        else { batch.set(fs.collection('recebimento_cargas').doc(), { ...payload, criadoEm: agora }, { merge: true }); cargasCriadas++; }
      });
      await batch.commit();
    }
    _invalidarCachesDependentes();
    return {
      totalNotas: notasBrutas.length, criadas, atualizadas, comDivergencia,
      totalCargas: cargas.length, cargasCriadas, cargasAtualizadas, meses,
    };
  }
  global.obterNotasRecebimentoBluesoft = obterNotasRecebimentoBluesoft;
  global.obterCargasRecebimentoBluesoft = obterCargasRecebimentoBluesoft;
  global.obterEntregasPedidosBluesoft = obterEntregasPedidosBluesoft;
  global.sincronizarRecebimentoBluesoft = sincronizarRecebimentoBluesoft;

  // ── Notas Retornadas (FASE 4) — GET /api/estoques/notas-fiscais ─────────
  // Endpoint mais rico que existe pra "nota completa" (itens, CFOP, link
  // pra nota original via notaFiscalOrigem) — mas, ao contrário de
  // status-processamento-nfe/recebimentocargas acima (já comprovados com
  // dado real em produção), este AINDA NÃO foi testado com uma chamada
  // real contra a conta do cliente. Por isso esta função NUNCA escreve no
  // Firestore sozinha — só busca e normaliza; quem grava é
  // 97-recebimento-recusas.js, só depois do Analista revisar numa
  // pré-visualização (mesmo padrão já usado pro import de PDF de DANFE).
  //
  // Nenhum enum documentado marca "nota de devolução" de forma direta
  // nesse endpoint — só sinais indiretos (CFOP de devolução, texto livre
  // em naturezaOperacao). `_pareceDevolucao` é só um SINAL pra destacar na
  // pré-visualização, nunca um filtro silencioso — a decisão de
  // classificação continua sempre manual, do Analista.
  function _normalizarItemNotaRetorno(it) {
    return {
      produtoKey: it.produtoKey ?? null, descricao: it.descricao || '',
      quantidade: Number(it.quantidade) || 0, gtin: it.gtin || '', ncm: it.ncm || '',
    };
  }
  // CFOPs de devolução de venda (tabela oficial CFOP, cobre devolução de
  // produção própria 1201-1204/2201-2204 e devolução de mercadoria de
  // terceiros 1410-1411/2410-2411) — pedido ao vivo do usuário: a coluna
  // de Natureza mostra só "Devolução" ou "Venda" (binário), não o CFOP
  // detalhado, então uma lista simples já basta (sem precisar de rótulo
  // legível por CFOP).
  const CFOPS_DEVOLUCAO_VENDA = ['1201', '1202', '1203', '1204', '1410', '1411', '2201', '2202', '2203', '2204', '2410', '2411'];
  function _pareceDevolucao(n) {
    if (CFOPS_DEVOLUCAO_VENDA.includes(String(n.cfop || '').replace(/\D/g, ''))) return true;
    return RE_NATUREZA_NAO_RECEBIMENTO.test(_normTxt(n.naturezaOperacao || n.natureza || ''));
  }
  function _normalizarNotaRetorno(n) {
    const origem = (n.itens || []).map(it => it.notaFiscalOrigem).find(Boolean) || null;
    // Pedido ao vivo do usuário: a coluna de Natureza mostra só "Devolução"
    // ou "Venda" (binário), não o detalhe fiscal completo do CFOP —
    // reaproveita o mesmo sinal de _pareceDevolucao, calculado uma vez só.
    const pareceDevolucao = _pareceDevolucao(n);
    return {
      chave: n.nfChave || '', numeroNota: n.nfNumero != null ? String(n.nfNumero) : '', serie: n.nfSerie != null ? String(n.nfSerie) : '',
      cfop: n.cfop || '', tipoOperacao: n.tipoNota || '', naturezaLabel: pareceDevolucao ? 'Devolução' : 'Venda',
      dataEmissao: n.dataEmissao || null, dataSaida: n.dataSaida || null, dataRecebimento: n.dataRecebimento || null,
      valorTotal: Number(n.valorTotalNota) || 0,
      // Pra nota tipoNota=ENTRADA (o filtro usado abaixo), "fornecedor" é
      // quem está MANDANDO a mercadoria pra loja — no caso de uma devolução
      // de cliente, é o próprio cliente. Sem ambiguidade nesse sentido
      // específico (o risco documentado era só pra nota de SAÍDA).
      destinatarioNome: n.nomeRazaoFornecedor || '', destinatarioCnpj: n.cpfCnpjFornecedor || '',
      itens: (n.itens || []).map(_normalizarItemNotaRetorno),
      notaOriginalChave: origem?.chave || null, notaOriginalNumero: origem?.numero != null ? String(origem.numero) : null,
      pareceDevolucao,
      origemImportacao: 'BLUESOFT',
    };
  }
  // Sem enum de "em aberto" confirmado nesse endpoint — busca por
  // tipoNota=ENTRADA (mercadoria voltando pra loja) + janela de data
  // (30 dias, o máximo documentado). TENTAMOS remover o filtro de data
  // numa rodada anterior (2026-08-19) achando que `dataRecebimento`
  // pudesse estar excluindo nota "em aberto" — mas em teste real isso
  // zerou o resultado (a Bluesoft não devolve nada sem uma janela de
  // data pra esse endpoint, aparentemente obrigatória junto de lojaKey).
  // Revertido: o filtro de data volta a ser sempre enviado.
  //
  // BUG AO VIVO REAL (2026-08-19, mesmo dia): confirmado no schema oficial
  // que `NotasFiscaisConsultarRequest` só tem `dataRecebimentoInicial`/
  // `Final` — NÃO existe `dataEmissaoInicial`/`Final` nesse endpoint (a
  // ideia cogitada no comentário antigo não existe). `dataRecebimento` é a
  // data em que a nota foi PROCESSADA/recebida no estoque da loja — uma
  // devolução recém-emitida, ainda "em aberto" (o motorista acabou de
  // trazer de volta, ninguém deu entrada nela ainda), simplesmente NÃO TEM
  // esse campo preenchido, então nunca aparece aqui — exatamente o caso que
  // este módulo mais precisa pegar. Usuário confirmou ao vivo: "no dasboard
  // tava vindo tudo, aqui não vem nenhuma".
  //
  // Corrigido com uma SEGUNDA fonte, em paralelo: GET
  // /api/forca-de-vendas/comissoes-vendedores com tipoPedido=DEVOLUCAO e
  // dataInicial/dataFinal (essas SIM são "data de emissão", confirmado no
  // schema) — pega a devolução pela emissão do pedido, não pelo
  // processamento no estoque, então não depende de já ter sido recebida.
  // Cada registro já traz a nota completa (`notaFiscal.chave/numero/serie/
  // dataEmissao/itens`) — normalizada pro MESMO formato de
  // `_normalizarNotaRetorno`. Deduplicado por chave (ou número, se a chave
  // vier vazia) contra o que já veio pela via principal, pra nunca duplicar
  // a mesma nota nas duas fontes.
  // BUG AO VIVO REAL (2026-08-19) — HISTÓRICO: a primeira tentativa de achar
  // devolução "em aberto" usava /api/forca-de-vendas/comissoes-vendedores
  // (tipoPedido=DEVOLUCAO). Deu timeout numa rodada, e depois de corrigir o
  // timeout, voltou 0 registros — e o usuário questionou com razão: "o que
  // tem a ver a comissão com a nota?" (comissão é sobre o VENDEDOR ganhar
  // uma porcentagem, não é um registro confiável de "existe uma nota de
  // devolução" — proxy indireto de verdade). O "no dashboard tava vindo
  // tudo" do usuário batia com OUTRA tela deste MESMO app: o Dashboard
  // (91-logistica-recebimento.js) já mostra "N devolução(ões) não contam
  // como recebimento", contado a partir de `recebimento_notas` — coleção
  // sincronizada por sincronizarRecebimentoBluesoft() via
  // /api/estoque/recebimento/status-processamento-nfe, um endpoint
  // PROVADO em produção (nunca deu timeout, usado há tempos). Ou seja: os
  // dados já existem, sincronizados, sem precisar de outra chamada frágil
  // — só nunca tinham sido reaproveitados aqui. Corrigido usando essa
  // coleção como fonte de DESCOBERTA (quais chaves são devolução), com um
  // lookup TARGETADO por chave (não em lote) em /api/estoques/notas-fiscais
  // só pra enriquecer com CFOP/itens/destinatário, que `recebimento_notas`
  // não guarda.
  // BUG AO VIVO REAL (usuário: "não esquece que tem que puxar as notas de
  // devolução que não foram dado entrada no nosso sistema ainda"):
  // confirmado ao vivo contra a API real que /api/estoque/recebimento/
  // status-processamento-nfe já traz `statusRecebimento` com valores
  // "Receber" (pendente) e "Recebido" (já processado) — e a nota MAIS
  // pendente de todas (chegou mas ninguém mexeu ainda) não tem
  // `dataRecebimento` preenchido, só `processamento` (data em que a nota
  // entrou na fila). Filtrar por `dataRecebimento` (como estava antes)
  // EXCLUÍA exatamente essas notas ainda não recebidas — o oposto do que
  // o usuário pediu. Corrigido: filtra por `processamento`, que sempre
  // vem preenchido, e nunca mais exige `dataRecebimento`.
  // PEDIDO AO VIVO (usuário, com print real das telas do Bluesoft
  // "Acompanhamento de Faturamento" e "Consultar Notas Fiscais": "hoje ela
  // traz notas canceladas e recusadas, também não é para vim essas notas")
  // — confirmado ao vivo que a Bluesoft usa 2 vocabulários reais pra isso:
  // "Status da NF-e" (Autorizada / Rejeitada / Inutilizada) e "Status"
  // (Cancelada / Não Cancelada). O campo `status` de
  // StatusProcessamentoNfeResponse (sem enum documentado na spec, texto
  // livre) é a única fonte que carrega esse dado pra quem descobre
  // devolução via recebimento_notas — mesmo padrão de texto livre já usado
  // em _ehDevolucao acima. Nunca uma nota fiscal REAL de devolução (só um
  // registro fiscal inválido/cancelado que não representa carga física
  // nenhuma indo ou vindo).
  const RE_STATUS_NAO_VALIDO = /CANCELAD|REJEITAD|INUTILIZAD|DENEGAD/;
  function _notaComStatusValido(x) {
    return !RE_STATUS_NAO_VALIDO.test(_normTxt(x?.status));
  }
  async function _descobrirNotasDevolucaoViaRecebimentoSincronizado(fs, inicio, fim) {
    const snap = await fs.collection('recebimento_notas').get();
    return snap.docs
      .map(d => d.data() || {})
      .filter(x => _ehDevolucao(x))
      .filter(_notaComStatusValido)
      .filter(x => {
        const dp = x.processamento ? new Date(x.processamento) : null;
        return dp && !isNaN(dp) && dp >= inicio && dp <= fim;
      });
  }
  // BUG AO VIVO REAL (2026-08-19, "Failed to load resource ... 400" ×15):
  // NotasFiscaisConsultarRequest exige lojaKey OU as duas datas SEMPRE —
  // nfChave é um filtro ADICIONAL, não substitui essa exigência (mesma
  // regra que já tinha derrubado uma tentativa anterior de tirar o filtro
  // de data). Sem lojaKey aqui, a Bluesoft rejeitava com 400 Bad Request
  // pra CADA nota devolução descoberta em recebimento_notas.
  async function _buscarNotaFiscalPorChave(chave, lojaKey, cfg) {
    if (!chave) return null;
    const qs = new URLSearchParams({ nfChave: chave, lojaKey, currentPage: 0, pageSize: 10 }).toString();
    const dados = await _requestBluesoft('/api/estoques/notas-fiscais?' + qs, cfg);
    return _linhasDe(dados)[0] || null;
  }
  // Fallback quando o lookup targetado por chave falha (ou a nota não tem
  // chave gravada) — usa só o que `recebimento_notas` já tem. Sem CFOP/
  // itens/destinatário, mas ainda assim visível e salvável (nunca some da
  // lista por causa disso).
  function _normalizarNotaRecebimentoComoRetorno(x) {
    return {
      chave: x.chaveNota || '', numeroNota: x.numeroNota != null ? String(x.numeroNota) : '', serie: x.serieNota != null ? String(x.serieNota) : '',
      cfop: '', tipoOperacao: '', naturezaLabel: 'Devolução',
      dataEmissao: null, dataSaida: null, dataRecebimento: x.dataRecebimento || null,
      valorTotal: Number(x.valor) || 0,
      destinatarioNome: '', destinatarioCnpj: String(x.cnpjRemetente || '').replace(/\D/g, ''),
      itens: [], notaOriginalChave: null, notaOriginalNumero: null,
      pareceDevolucao: true, origemImportacao: 'BLUESOFT',
      // "Receber" = ainda não foi dado entrada fisicamente; "Recebido" =
      // já processada. Sem valor = a mais pendente de todas (só chegou a
      // ser logada, ninguém mexeu ainda) — confirmado ao vivo contra a API.
      statusRecebimento: x.statusRecebimento || '',
    };
  }

  // ── Venda faturada ainda não entregue — GET /api/forca-de-vendas/pedidos ──
  // Pedido ao vivo do usuário: "é para ve notas faturadas ainda nao
  // entregues, mercador e todas as outras informações e atraves do
  // mercado trazer o vendedor e o supervisor".
  //
  // BUG AO VIVO REAL (2026-08-19/20) — HISTÓRICO: a primeira versão usava
  // /api/venda/pedidovenda, testado ao vivo direto contra a API (com o
  // token real do cliente) e CONFIRMADO que não tem nenhuma atividade de
  // 2026 pra esse objeto — nem no ambiente de homologação, nem filtrando
  // por qualquer status/janela de data. O usuário mandou print de dentro
  // do próprio Bluesoft mostrando 6.732 pedidos reais de junho/2026 — mas
  // numa tela DIFERENTE: "Pedido Força de Venda" (Vendas → Força de
  // Venda), não "Pedido de Venda". São objetos diferentes no schema da
  // Bluesoft. O endpoint certo é este (`forca-de-vendas/pedidos`, request
  // PedidosConsultarRequest) — confirmado ao vivo, mesmo token, retornou
  // pedidos reais de 23/06/2026. Diferenças-chave em relação à tentativa
  // anterior:
  // - Filtra por `filialKey` (não `lojaKey`) e `dataEmissaoInicial`/
  //   `dataEmissaoFinal` (intervalo de verdade, não só "a partir de").
  // - `pedidoVendaStatus` aqui é um valor ÚNICO (não array) — mais simples.
  // - Cada pedido tem uma lista de `clientes[]` (pode ter mais de um
  //   cliente no mesmo pedido!), e CADA cliente já traz `nfChave`/
  //   `nfNumero`/`nfSerie`/`valorNf` DIRETO — nenhum lookup adicional por
  //   nota é necessário (diferente da tentativa anterior, que precisava
  //   buscar a nota do pedido à parte).
  const STATUS_FATURADO_NAO_ENTREGUE = ['FATURADO_POR_NOTA_FISCAL', 'FATURADO_POR_CUPOM', 'ROTEIRIZADO'];
  async function obterPedidosVendaFaturadosNaoEntreguesBluesoft(filialKey, cfg) {
    const fim = new Date(); const inicio = new Date(); inicio.setMonth(inicio.getMonth() - 6);
    const porKey = new Map();
    const itensPorStatus = await Promise.all(STATUS_FATURADO_NAO_ENTREGUE.map(status => _paginarTudo('/api/forca-de-vendas/pedidos', {
      filialKey, pedidoVendaStatus: status,
      dataEmissaoInicial: _fmtDataBR(inicio) + ' 00:00', dataEmissaoFinal: _fmtDataBR(fim) + ' 23:59',
    }, cfg, item => item.pedidoForcaVendaKey)));
    itensPorStatus.forEach(itens => itens.forEach(it => porKey.set(it.pedidoForcaVendaKey, it)));
    // Achata pedido→clientes: cada cliente do pedido com NF gerada vira uma
    // "nota" candidata — um pedido de força de venda pode ter vários
    // clientes agrupados na mesma remessa.
    const notas = [];
    porKey.forEach(p => {
      (p.clientes || []).filter(c => c.nfChave || c.nfNumero).forEach(c => {
        notas.push({
          chave: c.nfChave || '', numeroNota: c.nfNumero != null ? String(c.nfNumero) : '', serie: c.nfSerie != null ? String(c.nfSerie) : '',
          cfop: '', tipoOperacao: 'SAIDA', naturezaLabel: 'Venda',
          dataEmissao: c.nfDataEmissao || p.dataEmissao || null, valorTotal: Number(c.valorNf ?? c.valorTotal) || 0,
          destinatarioNome: '', destinatarioCnpj: '', // resolvido depois via clienteKey (targetado)
          itens: (p.itens || []).filter(it => it.clienteKey === c.clienteKey).map(it => ({ produtoKey: it.produtoKey ?? null, descricao: '', quantidade: Number(it.quantidadePedida) || 0, gtin: '', ncm: '' })),
          notaOriginalChave: null, notaOriginalNumero: null, pareceDevolucao: false, origemImportacao: 'BLUESOFT',
          statusPedidoVenda: c.pedidoVendaStatus || p.pedidoVendaStatus || '', pedidoForcaVendaKey: p.pedidoForcaVendaKey,
          vendedorKey: p.vendedorExternoKey ?? null, clienteKey: c.clienteKey ?? null,
        });
      });
    });
    // Nome/CNPJ do cliente — lookup targetado, uma vez por clienteKey único
    // (poucos clientes distintos, nunca o cadastro inteiro).
    const clienteKeysUnicos = [...new Set(notas.map(n => n.clienteKey).filter(k => k != null))];
    const clientePorKey = new Map();
    await _emLotesParalelos(clienteKeysUnicos, async ck => {
      try {
        const dados = await _requestBluesoft('/api/clientes?' + new URLSearchParams({ clienteKey: ck, currentPage: 0, pageSize: 1 }).toString(), cfg);
        const linha = _linhasDe(dados)[0];
        if (linha) clientePorKey.set(ck, linha);
      } catch (e) { /* um cliente faltando não trava os outros — fica só sem nome */ }
    });
    // BUG AO VIVO REAL (2026-08-21): "na conferência quando aparece os
    // produtos ele tá trazendo é o código do produto, tem que trazer a
    // descrição" — /api/forca-de-vendas/pedidos NUNCA traz descrição do
    // item (só produtoKey), diferente da fonte de entrada/devolução (que
    // já vem com descricao pronta). Lookup targetado, um por produtoKey
    // único (confirmado no schema oficial que ProdutoConsultarRequest
    // aceita um `produtoKey` único como filtro — mesmo padrão já usado
    // pra cliente/vendedor, nunca varre o catálogo inteiro).
    const produtoKeysUnicos = [...new Set(notas.flatMap(n => n.itens.map(it => it.produtoKey)).filter(k => k != null))];
    const produtoPorKey = new Map();
    await _emLotesParalelos(produtoKeysUnicos, async pk => {
      try {
        const dados = await _requestBluesoft('/api/comercial/produtos?' + new URLSearchParams({ produtoKey: pk, currentPage: 0, pageSize: 1 }).toString(), cfg);
        const linha = _linhasDe(dados)[0];
        if (linha) produtoPorKey.set(pk, linha);
      } catch (e) { /* um produto faltando não trava os outros — fica só sem descrição */ }
    });
    return notas.map(n => {
      const cli = clientePorKey.get(n.clienteKey);
      return {
        ...n, destinatarioNome: cli?.nomeRazao || cli?.nomeFantasia || cli?.nomeAbreviado || '', destinatarioCnpj: String(cli?.cpfCnpj || '').replace(/\D/g, ''),
        itens: n.itens.map(it => ({ ...it, descricao: produtoPorKey.get(it.produtoKey)?.descricao || '' })),
      };
    });
  }
  async function obterNotasRetornoBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const cfg = await _config();
    const dias = Math.max(1, Math.min(30, Number(opcoes.dias) || 30));
    const fim = new Date(); const inicio = new Date(); inicio.setDate(inicio.getDate() - dias);
    const paramsEntrada = { lojaKey: loja.bluesoft_loja_key, tipoNota: 'ENTRADA', dataRecebimentoInicial: _fmtDataBR(inicio), dataRecebimentoFinal: _fmtDataBR(fim) };
    // Diagnóstico exposto no resultado (não só engolido em silêncio) — sem
    // isso, se alguma dessas fontes falhar, a tela mostra exatamente o
    // mesmo resultado de antes e ninguém descobre que a busca extra nem
    // rodou.
    //
    // BUG AO VIVO REAL (2026-08-20): "vou em outra aba ele para e tenho que
    // começar de novo" — a fonte principal (notas de entrada) era a ÚNICA
    // das três sem `.catch()` próprio. Se ela falhasse (timeout de 30s por
    // requisição, mais provável depois de um tempo com a aba em segundo
    // plano — o navegador atrasa timers/rede em aba inativa), o
    // `Promise.all` inteiro rejeitava e TUDO era descartado — inclusive
    // devolução/venda faturada que já tinham terminado com sucesso —
    // forçando clicar em "Buscar" do zero. Agora as três fontes são melhor
    // esforço, sempre: uma falhando nunca mais derruba as outras duas.
    let diagnosticoFontePrincipal = { ok: true, totalBruto: 0, erro: '' };
    let diagnosticoSegundaFonte = { ok: true, totalBruto: 0, erro: '' };
    let diagnosticoTerceiraFonte = { ok: true, totalBruto: 0, erro: '' };
    const fs = global.getDTFirestore();
    const [itensEntrada, devolucoesSincronizadas, pedidosFaturados] = await Promise.all([
      _paginarTudo('/api/estoques/notas-fiscais', paramsEntrada, cfg, item => item.nfChave, opcoes.onProgresso)
        .then(itens => { diagnosticoFontePrincipal.totalBruto = itens.length; return itens; })
        .catch(e => { diagnosticoFontePrincipal = { ok: false, totalBruto: 0, erro: e.message || String(e) }; return []; }),
      _descobrirNotasDevolucaoViaRecebimentoSincronizado(fs, inicio, fim)
        .then(itens => { diagnosticoSegundaFonte.totalBruto = itens.length; return itens; })
        .catch(e => { diagnosticoSegundaFonte = { ok: false, totalBruto: 0, erro: e.message || String(e) }; return []; }), // melhor esforço — se essa segunda fonte falhar, a via principal continua funcionando normalmente
      obterPedidosVendaFaturadosNaoEntreguesBluesoft(loja.bluesoft_loja_key, cfg)
        .then(itens => { diagnosticoTerceiraFonte.totalBruto = itens.length; return itens; })
        .catch(e => { diagnosticoTerceiraFonte = { ok: false, totalBruto: 0, erro: e.message || String(e) }; return []; }), // melhor esforço — se essa fonte falhar, as outras continuam funcionando normalmente
    ]);
    // BUG AO VIVO REAL (2026-08-20): "achei nota de devolução, e ta puxando
    // notas de vendas, mas nós sendo o destino, e quero de vendas só nós
    // sendo o remetente" — essa fonte (paramsEntrada, tipoNota=ENTRADA) só
    // traz notas onde a LOJA é quem RECEBE a mercadoria (destinatária) —
    // nunca uma venda de verdade (nisso a loja é sempre remetente). Quando
    // `_pareceDevolucao` dava falso (uma compra normal de fornecedor, sem
    // relação nenhuma com devolução), o rótulo caía no "senão" e virava
    // "Venda" por engano — poluindo a lista com compras comuns, com o
    // fornecedor aparecendo como se fosse "destinatário" de uma venda que
    // nunca existiu. Venda de verdade (loja como remetente) já vem por
    // outra fonte (obterPedidosVendaFaturadosNaoEntreguesBluesoft, via
    // forca-de-vendas/pedidos) — aqui, filtra só o que realmente parece
    // devolução.
    const notasEntrada = itensEntrada.map(_normalizarNotaRetorno).filter(n => n.pareceDevolucao);
    const chavesConhecidas = new Set(notasEntrada.filter(n => n.chave).map(n => n.chave));
    const numerosConhecidos = new Set(notasEntrada.filter(n => n.numeroNota).map(n => n.numeroNota));
    const novasDevolucoes = devolucoesSincronizadas.filter(x => {
      const chave = x.chaveNota || '', numero = x.numeroNota != null ? String(x.numeroNota) : '';
      return !(chave && chavesConhecidas.has(chave)) && !(numero && numerosConhecidos.has(numero));
    });
    // Lookup targetado por chave, uma nota por vez, em paralelo (poucas
    // notas — é sempre um subconjunto de devolução, nunca o cadastro
    // inteiro) — enriquece com CFOP/itens/destinatário; se falhar pra uma
    // nota específica, cai pro fallback básico em vez de sumir com ela.
    const extrasDevolucao = await Promise.all(novasDevolucoes.map(async x => {
      try {
        const bruta = await _buscarNotaFiscalPorChave(x.chaveNota, loja.bluesoft_loja_key, cfg);
        if (bruta) return _normalizarNotaRetorno(bruta);
      } catch (e) { /* cai pro fallback abaixo */ }
      return _normalizarNotaRecebimentoComoRetorno(x);
    }));
    extrasDevolucao.forEach(n => { if (n.chave) chavesConhecidas.add(n.chave); if (n.numeroNota) numerosConhecidos.add(n.numeroNota); });

    // obterPedidosVendaFaturadosNaoEntreguesBluesoft já devolve cada nota
    // com chave/número/destinatário resolvidos (a NF já vem direto no
    // cliente do pedido, sem lookup adicional) — só falta dedup e vendedor.
    const pedidosNovos = pedidosFaturados.filter(n => (n.chave || n.numeroNota) && !(n.chave && chavesConhecidas.has(n.chave)) && !(n.numeroNota && numerosConhecidos.has(n.numeroNota)));
    const vendedorKeysUnicos = [...new Set(pedidosNovos.map(n => n.vendedorKey).filter(k => k != null))];
    const dadosVendedorPorKey = new Map();
    // Pedido ao vivo do usuário: "muitos mercados não trouxe [o vendedor]"
    // — antes, um vendedor faltando (ex.: 429 de limite de requisições)
    // era engolido em silêncio, indistinguível de "esse vendedor genuinamente
    // não tem gerente/supervisor". Conta as falhas pra aparecer no
    // diagnóstico da tela em vez de sumir sem explicação.
    let falhasVendedor = 0;
    await _emLotesParalelos(vendedorKeysUnicos, async vk => {
      try { const d = await obterDadosVendedorPorKey(vk); if (d) dadosVendedorPorKey.set(vk, d); else falhasVendedor++; }
      catch (e) { falhasVendedor++; }
    });
    const extrasVenda = pedidosNovos.map(n => {
      const vd = dadosVendedorPorKey.get(n.vendedorKey);
      // Gerente removido (pedido ao vivo do usuário: "o gerente pode
      // tirar, que sempre será 1 pq de gerente só tem ele" — um valor
      // fixo pra conta inteira, sem informação útil por nota).
      return { ...n, vendedorNome: vd?.nome || '', vendedorEmail: vd?.email || '', supervisorNome: vd?.supervisorNome || '', supervisorEmail: vd?.supervisorEmail || '' };
    });
    diagnosticoTerceiraFonte.totalExtras = extrasVenda.length;
    diagnosticoTerceiraFonte.falhasVendedor = falhasVendedor;

    const resultado = notasEntrada.concat(extrasDevolucao, extrasVenda);
    diagnosticoSegundaFonte.totalExtras = extrasDevolucao.length;
    resultado.diagnosticoFontePrincipal = diagnosticoFontePrincipal;
    resultado.diagnosticoSegundaFonte = diagnosticoSegundaFonte;
    resultado.diagnosticoTerceiraFonte = diagnosticoTerceiraFonte;
    return resultado;
  }
  global.obterNotasRetornoBluesoft = obterNotasRetornoBluesoft;

  // ── XML da nota — GET /api/estoques/notas-fiscais/xml/{nfChave} ────────
  // Pedido ao vivo do usuário: "consegue ler o XML das notas de devolução,
  // lá dentro tem o motivo" — confirmado no schema oficial. Só que esse
  // endpoint NÃO devolve o XML direto: devolve um link S3 pré-assinado
  // (NotaFiscalXmlResponse.URL_S3), válido por só 1 MINUTO. Por isso é
  // buscado sob demanda (um clique por nota na pré-visualização), nunca em
  // lote — em lote arriscaria o link expirar antes de ser usado, e
  // multiplicaria 2 chamadas por nota (pegar o link + baixar o XML) numa
  // tela que já faz bastante coisa.
  function _decodeXmlEntities(s) {
    return String(s || '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  }
  // <infCpl> (Informações Complementares de Interesse do Contribuinte,
  // dentro de <infAdic>) é o campo real da NF-e onde o motivo da
  // devolução costuma ser escrito — a MESMA informação que o import de
  // PDF tenta ler via OCR do rodapé do DANFE, só que aqui vem estruturada,
  // direto da fonte, sem depender do layout visual da nota.
  function _extrairInfCplDoXml(xmlTexto) {
    const m = String(xmlTexto || '').match(/<infCpl>([\s\S]*?)<\/infCpl>/i);
    return m ? _decodeXmlEntities(m[1]).trim() : '';
  }
  // PEDIDO AO VIVO (usuário, 2026-08-19, mesmo dia da coluna Volumes):
  // "nem veio também com o volume da carga" — confirmado no schema oficial
  // que NENHUM endpoint de consulta (nem /api/estoques/notas-fiscais nem
  // /api/forca-de-vendas/comissoes-vendedores) devolve volume/embalagem —
  // esse dado só existe dentro do XML da própria NF-e, na tag padrão
  // <transp><vol><qVol>. Extraído do MESMO XML que já baixamos pra pegar o
  // motivo (<infCpl>) — uma nota pode ter mais de um bloco <vol> (raro),
  // pega o primeiro; soma os `qVol` se vier mais de um, pra não perder
  // volume de nota com múltiplos volumes declarados.
  function _extrairVolumesDoXml(xmlTexto) {
    const texto = String(xmlTexto || '');
    const blocos = texto.match(/<vol>[\s\S]*?<\/vol>/gi) || [];
    let total = 0, achou = false;
    blocos.forEach(bloco => {
      const m = bloco.match(/<qVol>(\d+)<\/qVol>/i);
      if (m) { total += Number(m[1]) || 0; achou = true; }
    });
    return achou ? total : null;
  }
  async function obterUrlXmlNota(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) throw new Error('Chave de acesso inválida (precisa ter 44 dígitos).');
    const cfg = await _config();
    const dados = await _requestBluesoft('/api/estoques/notas-fiscais/xml/' + c, cfg);
    return dados?.URL_S3 || dados?.url_s3 || '';
  }
  // O link S3 é de fora do domínio da Bluesoft — bluesoftProxy só aceita o
  // host configurado da Bluesoft (BLUESOFT_HOST_PERMITIDO), então esta
  // busca precisa ser direta do navegador. É o uso típico de link
  // pré-assinado (pensado pra download direto do cliente, não pra passar
  // de novo por um proxy) — se o bucket não permitir CORS pra este
  // domínio, essa chamada falha e quem chamou trata o erro; a tela
  // continua funcionando normalmente sem o motivo do XML.
  async function _baixarXmlNota(chave) {
    const url = await obterUrlXmlNota(chave);
    if (!url) return '';
    const resp = await global.fetch(url);
    if (!resp.ok) throw new Error('Não foi possível baixar o XML (HTTP ' + resp.status + ').');
    return await resp.text();
  }
  async function obterMotivoDevolucaoXml(chave) {
    const xmlTexto = await _baixarXmlNota(chave);
    if (!xmlTexto) return '';
    return _extrairInfCplDoXml(xmlTexto);
  }
  global.obterMotivoDevolucaoXml = obterMotivoDevolucaoXml;
  // Uma chamada só (o mesmo XML já baixado pro motivo) devolvendo motivo E
  // volumes juntos — evita baixar o mesmo link S3 duas vezes (que expira em
  // 1 minuto) quando a tela precisa das duas informações no mesmo clique.
  async function obterDadosXmlNota(chave) {
    const xmlTexto = await _baixarXmlNota(chave);
    if (!xmlTexto) return { motivo: '', volumes: null };
    return { motivo: _extrairInfCplDoXml(xmlTexto), volumes: _extrairVolumesDoXml(xmlTexto) };
  }
  global.obterDadosXmlNota = obterDadosXmlNota;

  // ── Vendedor/Gerente/Supervisor — TARGETADO a partir das notas ─────────
  // Reescrito 2026-08-19: a versão anterior (bulk_vendedores_cache)
  // sincronizava grupos-econômicos + TODOS os clientes da conta (61.170+
  // registros) pra montar um cache antes de olhar pra nenhuma nota —
  // pedido ao vivo do usuário: "não quero que consulte todos os clientes
  // cadastrados... tem que trazer os que tem as notas do jeito que já
  // falei emitidas, ele tem que procurar as notas e a partir das notas
  // trazer os vendedores". Achado o caminho certo no schema oficial:
  // GET /api/forca-de-vendas/comissoes-vendedores já traz, no MESMO
  // registro, cnpj + clienteKey + vendedorExternoKey/Nome + gerenteKey +
  // supervisorKey + número da nota de origem + motivoDevolucao — filtrado
  // por período (dataInicial/dataFinal) e tipoPedido (TODOS/DEVOLUCAO/
  // VENDA), sem precisar varrer o cadastro de clientes inteiro. Só falta
  // uma chamada TARGETADA (por vendedorKey, uma vez por vendedor único
  // encontrado — tipicamente 1 a 3 pra um punhado de notas) pra pegar o
  // e-mail do vendedor e o nome legível do gerente/supervisor (a comissão
  // só traz a key numérica deles).
  function _normalizarComissaoVendedor(c) {
    return {
      cnpj: String(c.cnpj || '').replace(/\D/g, ''),
      clienteKey: c.clienteKey ?? null, nomeCliente: c.nomeCliente || '',
      vendedorKey: c.vendedorExternoKey ?? null, vendedorNome: c.vendedorExternoNome || '',
      supervisorKey: c.supervisorKey ?? null,
      numeroNotaFiscalOrigem: c.numeroNotaFiscalOrigem != null ? String(c.numeroNotaFiscalOrigem) : '',
      motivoDevolucao: c.motivoDevolucao || '', tipoDePedido: c.tipoDePedido || '',
    };
  }
  async function obterComissoesVendedorPorPeriodo(opcoes) {
    opcoes = opcoes || {};
    const cfg = await _config();
    const params = {};
    if (opcoes.dataInicial) params.dataInicial = opcoes.dataInicial;
    if (opcoes.dataFinal) params.dataFinal = opcoes.dataFinal;
    if (opcoes.tipoPedido) params.tipoPedido = opcoes.tipoPedido;
    // BUG AO VIVO REAL (2026-08-19): esse endpoint é mais lento que os
    // outros da Bluesoft pra essa conta. Piso de 130s, acima dos 120s da
    // Cloud Function bluesoftProxy (functions/index.js) — senão o
    // navegador espera mais que o próprio proxy (que já foi morto pelo
    // Google antes), e o erro vira "Failed to fetch" em vez de um timeout
    // limpo.
    const cfgComissoes = { ...cfg, timeout: Math.max(Number(cfg.timeout) || 30, 130) };
    const itens = await _paginarTudo('/api/forca-de-vendas/comissoes-vendedores', params, cfgComissoes,
      item => (item.clienteKey || '') + '_' + (item.numeroNotaFiscalOrigem || '') + '_' + (item.vendedorExternoKey || ''));
    return itens.map(_normalizarComissaoVendedor);
  }
  global.obterComissoesVendedorPorPeriodo = obterComissoesVendedorPorPeriodo;

  // Campos confirmados 2026-08-19 direto no schema oficial
  // (VendedorConsultarResponse): o nome do PRÓPRIO vendedor é
  // vendedorNomeAbreviado/vendedorEmail, e a chave de correlação é
  // vendedorExternoKey (não repete o "vendedorKey" usado só como filtro
  // de ENTRADA em VendedoresConsultarRequest).
  function _normalizarVendedor(v) {
    return {
      vendedorKey: v.vendedorExternoKey ?? null,
      nome: v.vendedorNomeAbreviado || '',
      email: v.vendedorEmail || '',
      supervisorNome: v.supervisorNomeAbreviado || '', supervisorEmail: v.supervisorEmail || '',
    };
  }
  // Lookup TARGETADO — um vendedor só por chamada, nunca a lista inteira.
  async function obterDadosVendedorPorKey(vendedorKey) {
    if (vendedorKey == null) return null;
    const cfg = await _config();
    const dados = await _requestBluesoft('/api/forca-de-vendas/vendedores?vendedorKey=' + encodeURIComponent(vendedorKey), cfg);
    const linha = _linhasDe(dados)[0];
    return linha ? _normalizarVendedor(linha) : null;
  }
  global.obterDadosVendedorPorKey = obterDadosVendedorPorKey;

  // Orquestra tudo: busca as comissões do MESMO período das notas (uma
  // chamada), casa cada nota por número de NF (mais preciso) ou por CNPJ
  // (fallback), e só então busca supervisor/e-mail dos vendedores
  // realmente encontrados (poucos, targetados por key). Nunca escreve no
  // Firestore — só enriquece em memória, igual ao resto do fluxo de
  // pré-visualização desta tela.
  async function enriquecerNotasComVendedorPorComissao(notas, opcoes) {
    opcoes = opcoes || {};
    if (!notas || !notas.length) return notas || [];
    let comissoes = [];
    try { comissoes = await obterComissoesVendedorPorPeriodo(opcoes); }
    catch (e) { return notas; } // melhor esforço — sem comissão, as notas continuam aparecendo, só sem vendedor
    const porNumeroNota = new Map(), porCnpj = new Map();
    comissoes.forEach(c => {
      if (c.numeroNotaFiscalOrigem && !porNumeroNota.has(c.numeroNotaFiscalOrigem)) porNumeroNota.set(c.numeroNotaFiscalOrigem, c);
      if (c.cnpj && !porCnpj.has(c.cnpj)) porCnpj.set(c.cnpj, c);
    });
    const vendedorKeysUnicos = [...new Set(comissoes.map(c => c.vendedorKey).filter(k => k != null))];
    const dadosVendedorPorKey = new Map();
    await _emLotesParalelos(vendedorKeysUnicos, async vk => {
      try { const d = await obterDadosVendedorPorKey(vk); if (d) dadosVendedorPorKey.set(vk, d); }
      catch (e) { /* um vendedor faltando não trava os outros */ }
    });
    return notas.map(n => {
      // BUG AO VIVO REAL (2026-08-20): "muitos mercados não trouxe [o
      // vendedor]" — notas de venda faturada já chegam aqui com vendedor
      // preenchido (lookup direto por vendedorKey, mais confiável). Se o
      // número da NF ou o CNPJ dessa nota TAMBÉM batesse por acaso com uma
      // comissão de outro contexto (comum em clientes grandes/recorrentes,
      // ex.: redes como Sendas/Assai que aparecem várias vezes no período),
      // esse código sobrescrevia o vendedor bom com o resultado de um
      // lookup TARGETADO diferente — que podia falhar/vir vazio e apagar
      // um dado que já estava certo. Agora nunca sobrescreve vendedor que
      // a nota já trouxe; comissão só PREENCHE o que ainda está vazio
      // (entrada/devolução, que não têm vendedorKey próprio).
      if (n.vendedorNome) return n;
      const cnpjNorm = String(n.destinatarioCnpj || '').replace(/\D/g, '');
      const match = porNumeroNota.get(n.numeroNota) || (cnpjNorm ? porCnpj.get(cnpjNorm) : null);
      if (!match) return n;
      const vd = dadosVendedorPorKey.get(match.vendedorKey);
      return {
        ...n,
        vendedorNome: match.vendedorNome || vd?.nome || '',
        vendedorEmail: vd?.email || '',
        supervisorNome: vd?.supervisorNome || '', supervisorEmail: vd?.supervisorEmail || '',
        // Bônus: a comissão também tem um campo próprio de motivo de
        // devolução — usado como fallback quando o XML da nota não tem
        // <infCpl> preenchido.
        motivoDevolucaoComissao: match.motivoDevolucao || '',
      };
    });
  }
  global.enriquecerNotasComVendedorPorComissao = enriquecerNotasComVendedorPorComissao;

  // ── Agenda (fase 15, seção 18) — a Bluesoft não tem "agendamento de
  // mercadoria"/YMS confirmado (checado à exaustão no schema oficial: só
  // existe agendamento bancário, sem relação com entrega de carga). O mais
  // próximo real é Pedido de Compra: `entregaPendente` +
  // `dataEntregaInicial/Final` (GET /api/compras/pedidos-de-compra, mesmo
  // endpoint já usado pra cruzar divergência) — pedidos ainda não entregues
  // com janela de entrega prevista. Preenche a Agenda automaticamente sem
  // tirar a edição manual: só cria/atualiza fornecedor/data — nunca mexe em
  // `status`/`observacao` depois de criado, porque o Analista pode ter
  // marcado como Utilizado/Cancelado ou anotado algo à mão (mesmo espírito
  // de nunca sobrescrever `chegadaPortaria` no recebimento).
  async function sincronizarAgendaBluesoft() {
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const lojaKey = loja.bluesoft_loja_key;

    const [pedidos, fornecedores] = await Promise.all([
      obterPedidosCompraBluesoft({ lojaKey }),
      obterFornecedoresBluesoft(false),
    ]);
    const fornecedorPorKey = new Map(fornecedores.map(f => [f.fornecedorKey, f.nome]));
    const pendentes = pedidos.filter(p => p.entregaPendente && p.numeroPedido != null);

    const fs = global.getDTFirestore();
    const rawFs = raw();
    const snap = await fs.collection('recebimento_agendamentos').get();
    const docPorNumeroPedido = new Map();
    snap.docs.forEach(d => { const x = d.data() || {}; if (x.numeroPedido != null) docPorNumeroPedido.set(String(x.numeroPedido), d.id); });

    const agora = new Date().toISOString();
    let criados = 0, atualizados = 0;
    for (let i = 0; i < pendentes.length; i += 300) {
      const lote = pendentes.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(p => {
        const fornecedorNome = fornecedorPorKey.get(p.fornecedorKey) || ('Fornecedor ' + p.fornecedorKey);
        const dataAgendada = p.dataEntregaInicial ? String(p.dataEntregaInicial).slice(0, 10) : '';
        const docId = docPorNumeroPedido.get(String(p.numeroPedido));
        if (docId) {
          batch.set(fs.collection('recebimento_agendamentos').doc(docId), {
            origem: 'bluesoft', numeroPedido: p.numeroPedido, fornecedorNome, dataAgendada,
            dataEntregaFinal: p.dataEntregaFinal || null, bluesoftSincronizadoEm: agora, atualizadoEm: agora,
          }, { merge: true });
          atualizados++;
        } else {
          batch.set(fs.collection('recebimento_agendamentos').doc(), {
            origem: 'bluesoft', numeroPedido: p.numeroPedido, fornecedorNome, dataAgendada,
            dataEntregaFinal: p.dataEntregaFinal || null, horaAgendada: '', codigo: 'PC-' + p.numeroPedido,
            motoristaNome: '', placa: '', status: 'AGENDADO',
            observacao: 'Pedido de compra #' + p.numeroPedido + ' — sincronizado da Bluesoft',
            bluesoftSincronizadoEm: agora, criadoEm: agora, atualizadoEm: agora,
          }, { merge: true });
          criados++;
        }
      });
      await batch.commit();
    }
    // totalPedidos (sem filtro nenhum) ajuda a diferenciar duas situações
    // que dão "0 pendente" mas são bem diferentes: totalPedidos:0 quer dizer
    // que a loja não tem NENHUM Pedido de Compra na Bluesoft (não usa esse
    // módulo — provavelmente lança nota direto, sem PO — o que também
    // explica toda nota aparecer "sem comparação" na Divergência, já que os
    // dois dependem do mesmo dado); totalPedidos > 0 com pendentes:0 quer
    // dizer que a loja usa Pedido de Compra só que está tudo já entregue.
    return { totalPedidos: pedidos.length, totalPedidosPendentes: pendentes.length, criados, atualizados };
  }
  global.sincronizarAgendaBluesoft = sincronizarAgendaBluesoft;
  // Usado por 91-logistica-recebimento.js e 94-recebimento-relatorios.js
  // pra excluir devolução das telas de recebimento sem duplicar a lista
  // de valores do enum em cada arquivo.
  global.ehNotaDevolucaoBluesoft = _ehDevolucao;
  global.categoriaNotaBluesoft = _categoriaNota;

  // ── Sincronização produtos → producao_produtos ──────────────────────────
  // Upsert por bluesoftProdutoKey (re-sync) ou por cod==produtoKey (1ª sync)
  // — nunca apaga o que já existe (mesma política de segurança de
  // 71-producao-excel.js/76-producao-importacao.js). Toca SOMENTE campos de
  // catálogo; nunca escreve nos campos de planejamento do PCP (cobertura,
  // mínimo/máximo/segurança, lead time, criticidade etc. — fase 7,
  // continuam só editáveis pelo próprio PCP). `unid` (unidades por caixa,
  // usado pelos cálculos de produção) também não é tocado — a unidade de
  // medida da Bluesoft (rótulo, não quantidade) vai num campo novo
  // separado, pra não confundir os dois conceitos. `opcoes.tipos` escolhe
  // quais tipos de produto trazer (default: produto acabado + venda).
  // Sempre cruza com o estoque real da loja ativa e só grava o que tem
  // estoque de verdade (mesmo critério de _estoqueRelevante já usado no
  // estoque/insumos) — o catálogo "ATIVO" da Bluesoft sozinho é muito maior
  // que o que a loja realmente movimenta; o restante fica de fora pra
  // cadastro manual, como pedido.
  async function sincronizarProdutosBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const catalogoBruto = await obterCatalogoBluesoft(true, opcoes);
    const resultadoEstoque = await obterEstoqueBluesoft(loja, true, { onProgresso: opcoes.onProgresso });
    const comEstoque = new Set(resultadoEstoque.itens.map(e => e.produtoKey));
    const catalogo = catalogoBruto.filter(p => comEstoque.has(p.produtoKey));
    const fs = global.getDTFirestore();
    const rawFs = raw();
    const snap = await fs.collection('producao_produtos').get();
    const porBluesoftKey = new Map(), porCod = new Map(), docs = new Map();
    snap.docs.forEach(d => {
      const x = d.data() || {};
      docs.set(d.id, x);
      if (x.bluesoftProdutoKey != null) porBluesoftKey.set(String(x.bluesoftProdutoKey), d.id);
      if (x.cod != null) porCod.set(String(x.cod).trim(), d.id);
    });
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    let criados = 0, atualizados = 0;
    for (let i = 0; i < catalogo.length; i += 300) {
      const lote = catalogo.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(p => {
        const docId = porBluesoftKey.get(String(p.produtoKey)) || porCod.get(p.cod);
        const existente = docId ? docs.get(docId) : null;
        const payload = {
          nome: p.nome, unidadeMedidaBluesoft: p.unidade, gtin: p.gtin, ativo: p.status === 'ATIVO',
          categoria: p.categoria, fornecedorPadrao: p.fornecedorPadraoNome, fornecedorPadraoKey: p.fornecedorPadraoKey,
          bluesoftProdutoKey: p.produtoKey, bluesoftTipoProduto: p.tipoPrincipal || null,
          bluesoftSincronizadoEm: agora, atualizadoEm: agora, atualizadoPor: autor,
        };
        // Pré-preenche múltiplo de compra só se o PCP ainda não configurou
        // nada (nunca sobrescreve um valor já cadastrado manualmente).
        if (p.multiploCompraSugerido && !(existente && Number(existente.multiploCompra) > 0)) {
          payload.multiploCompra = p.multiploCompraSugerido;
        }
        if (docId) {
          batch.set(fs.collection('producao_produtos').doc(docId), payload, { merge: true });
          atualizados++;
        } else {
          batch.set(fs.collection('producao_produtos').doc(), { ...payload, cod: p.cod, criadoEm: agora, criadoPor: autor }, { merge: true });
          criados++;
        }
      });
      await batch.commit();
    }
    // Reconciliação (fase 12h) — um produto que já foi sincronizado antes
    // (bluesoftProdutoKey presente) e não voltou nesta sincronização perdeu
    // o estoque que tinha; some da base pra não acumular ruído indefinidamente.
    // Só reconcilia dentro do MESMO conjunto de tipos pedido agora (um
    // produto de EMBALAGEM sincronizado antes não pode ser apagado só
    // porque esta chamada só pediu VENDA) e nunca toca produto que Ficha
    // Técnica ou Parâmetros PCP já configuraram.
    const tiposAtuais = new Set((opcoes.tipos && opcoes.tipos.length) ? opcoes.tipos : ['PRODUTO_ACABADO', 'VENDA']);
    const chavesAtuais = new Set(catalogo.map(p => String(p.produtoKey)));
    const alvosRemocao = [];
    docs.forEach((x, id) => {
      if (x.bluesoftProdutoKey == null) return;
      if (!tiposAtuais.has(x.bluesoftTipoProduto)) return;
      if (chavesAtuais.has(String(x.bluesoftProdutoKey))) return;
      if (_produtoProtegidoPcp(x)) return;
      alvosRemocao.push(id);
    });
    let removidos = 0;
    for (let i = 0; i < alvosRemocao.length; i += 300) {
      const lote = alvosRemocao.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(id => batch.delete(fs.collection('producao_produtos').doc(id)));
      await batch.commit();
      removidos += lote.length;
    }
    _invalidarCachesDependentes();
    return { totalCatalogo: catalogoBruto.length, comEstoque: catalogo.length, total: catalogo.length, criados, atualizados, removidos, falhas: catalogoBruto.falhas || [] };
  }
  global.sincronizarProdutosBluesoft = sincronizarProdutosBluesoft;

  // ── Sincronização estoque → producao_projecao (fase 12) ─────────────────
  // Sempre a loja ATIVA da sessão (getDTLojaAtiva) — a mesma que
  // producao_projecao já usa via o proxy getDTFirestore(), então nunca
  // mistura estoque de lojas diferentes. Upsert por cod==produtoKey, nunca
  // apaga (mesma política de segurança de sempre). `estoqueAtual` é
  // sobrescrito de propósito (é a mesma política já usada por
  // importarEstoquePA/sincronizarApi em 76-producao-importacao.js — a
  // Bluesoft manda o saldo real, não um delta). Só sincroniza itens
  // relevantes (ver _estoqueRelevante). Os nomes vêm do PRÓPRIO
  // producao_produtos já sincronizado (não busca o catálogo na Bluesoft de
  // novo em paralelo) — evita dobrar a carga de requisições simultâneas
  // contra o limite por usuário da Bluesoft.
  // Nunca apaga producao_projecao com projeção manual digitada (M1-M3 ou
  // override manual) — mesmo que a Bluesoft não reporte mais esse produto
  // como relevante, o dado manual foi intencional e precisa sobreviver.
  function _projecaoTemDadoManual(x) {
    return (Number(x.venda_m1) || 0) > 0 || (Number(x.venda_m2) || 0) > 0 ||
      (Number(x.venda_m3) || 0) > 0 || (Number(x.projecaoManual) || 0) > 0;
  }
  async function sincronizarEstoqueBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const fs = global.getDTFirestore();
    const rawFs = raw();
    const [resultadoEstoque, produtosSnap] = await Promise.all([
      obterEstoqueBluesoft(loja, true, { onProgresso: opcoes.onProgresso }),
      fs.collection('producao_produtos').get(),
    ]);
    const itensEstoque = resultadoEstoque.itens;
    const nomesPorCod = new Map();
    produtosSnap.docs.forEach(d => { const x = d.data() || {}; if (x.cod != null) nomesPorCod.set(String(x.cod).trim(), x.nome || ''); });
    const snap = await fs.collection('producao_projecao').get();
    const porCod = new Map(), docsProjecao = new Map();
    snap.docs.forEach(d => {
      const x = d.data() || {};
      docsProjecao.set(d.id, x);
      if (x.cod != null) porCod.set(String(x.cod).trim(), d.id);
    });
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    let criados = 0, atualizados = 0;
    for (let i = 0; i < itensEstoque.length; i += 300) {
      const lote = itensEstoque.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(e => {
        const payload = { estoqueAtual: e.estoqueAtual, bluesoftSincronizadoEm: agora, atualizadoEm: agora, atualizadoPor: autor };
        if (e.estoqueReservado != null) payload.estoqueReservado = e.estoqueReservado;
        if (e.estoqueEmTransito != null) payload.estoqueEmTransito = e.estoqueEmTransito;
        if (e.pedidosVendaPendentes != null) payload.estoqueReservadoVenda = e.pedidosVendaPendentes;
        if (e.custoUltimaCompra != null) payload.custoUltimaCompra = e.custoUltimaCompra;
        if (e.custoMedioContabil != null) payload.custoMedioContabil = e.custoMedioContabil;
        if (e.consumoDiaMedio != null) payload.consumoDiaMedioBluesoft = e.consumoDiaMedio;
        const docId = porCod.get(e.cod);
        if (docId) {
          batch.set(fs.collection('producao_projecao').doc(docId), payload, { merge: true });
          atualizados++;
        } else {
          batch.set(fs.collection('producao_projecao').doc(), { ...payload, cod: e.cod, produto: nomesPorCod.get(e.cod) || ('Produto ' + e.cod), criadoEm: agora }, { merge: true });
          criados++;
        }
      });
      await batch.commit();
    }
    // Reconciliação (fase 12h) — a busca de estoque não é filtrada por tipo
    // (traz tudo que é relevante pra loja de uma vez), então qualquer doc já
    // sincronizado antes que não voltou nesta rodada perdeu a relevância de
    // verdade (zerou e sem pedido pendente) — remove pra não acumular ruído
    // que trava as telas do PCP.
    const chavesAtuais = new Set(itensEstoque.map(e => String(e.cod)));
    const alvosRemocao = [];
    docsProjecao.forEach((x, id) => {
      if (!x.bluesoftSincronizadoEm) return;
      if (x.cod != null && chavesAtuais.has(String(x.cod))) return;
      if (_projecaoTemDadoManual(x)) return;
      alvosRemocao.push(id);
    });
    let removidos = 0;
    for (let i = 0; i < alvosRemocao.length; i += 300) {
      const lote = alvosRemocao.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(id => batch.delete(fs.collection('producao_projecao').doc(id)));
      await batch.commit();
      removidos += lote.length;
    }
    _invalidarCachesDependentes();
    return { total: itensEstoque.length, totalRecebido: resultadoEstoque.totalRecebido, rotaSimplificada: resultadoEstoque.rotaSimplificada, criados, atualizados, removidos, lojaNome: loja.nome || loja.codigo || lojaId };
  }
  global.sincronizarEstoqueBluesoft = sincronizarEstoqueBluesoft;

  // ── Insumos → producao_insumos_estoque (fase 12d/12e) ───────────────────
  // "Insumo" na Bluesoft é `tipoProduto=INSUMO`, e embalagem é
  // `tipoProduto=EMBALAGEM` (mesmo filtro real usado acima) — mas só
  // interessa pro PCP o que (a) tem estoque de verdade e (b) já é USADO em
  // alguma ficha técnica cadastrada (não todo insumo/embalagem ativo da
  // Bluesoft, que pode incluir item de uso e consumo interno sem relação
  // com produção). Casamento por NOME normalizado, mesma forma que
  // 65-producao-insumos.js já casa ficha↔estoque de insumo.
  const TIPOS_INSUMO_BLUESOFT = ['INSUMO', 'EMBALAGEM'];
  async function _nomesInsumosUsados() {
    const fs = global.getDTFirestore();
    const snap = await fs.collection('producao_ficha_tecnica').get();
    const nomes = new Set();
    snap.docs.forEach(d => { (d.data()?.insumos || []).forEach(i => { if (i.insumo) nomes.add(normUpper(i.insumo)); }); });
    return nomes;
  }
  async function sincronizarInsumosBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const cfg = await _config();
    const [catalogoInsumoBruto, usados] = await Promise.all([
      _buscarProdutosPorTipos(TIPOS_INSUMO_BLUESOFT, cfg, opcoes.onProgresso),
      _nomesInsumosUsados(),
    ]);
    const catalogoInsumo = catalogoInsumoBruto.map(_normalizarProduto);
    const falhas = catalogoInsumoBruto.falhas || [];
    const utilizados = catalogoInsumo.filter(p => usados.has(normUpper(p.nome)));
    if (!utilizados.length) return { totalCatalogo: catalogoInsumo.length, utilizados: 0, comEstoque: 0, criados: 0, atualizados: 0, removidos: 0, falhas };
    const resultadoEstoque = await obterEstoqueBluesoft(loja, true, { incluirTodos: true });
    const estoquePorKey = new Map(resultadoEstoque.itens.map(e => [e.produtoKey, e]));
    const comEstoque = utilizados
      .map(p => ({ produto: p, estoque: estoquePorKey.get(p.produtoKey) }))
      .filter(x => x.estoque && x.estoque.estoqueAtual > 0);
    const fs = global.getDTFirestore();
    const rawFs = raw();
    const snap = await fs.collection('producao_insumos_estoque').get();
    const porNome = new Map(), docsInsumos = new Map();
    snap.docs.forEach(d => {
      const x = d.data() || {};
      docsInsumos.set(d.id, x);
      porNome.set(normUpper(x.insumo || x.nome || ''), d.id);
    });
    const agora = new Date().toISOString();
    let criados = 0, atualizados = 0;
    for (let i = 0; i < comEstoque.length; i += 300) {
      const lote = comEstoque.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(({ produto, estoque }) => {
        const payload = {
          insumo: produto.nome, unidade: produto.unidade || '', categoria: produto.categoria || '',
          quantidade: estoque.estoqueAtual, bluesoftProdutoKey: produto.produtoKey, bluesoftSincronizadoEm: agora, atualizadoEm: agora,
        };
        const docId = porNome.get(normUpper(produto.nome));
        if (docId) { batch.set(fs.collection('producao_insumos_estoque').doc(docId), payload, { merge: true }); atualizados++; }
        else { batch.set(fs.collection('producao_insumos_estoque').doc(), { ...payload, criadoEm: agora }, { merge: true }); criados++; }
      });
      await batch.commit();
    }
    // Reconciliação (fase 12h) — mesma lógica de produtos/estoque: insumo já
    // sincronizado que não voltou nesta rodada (deixou de ter estoque ou
    // deixou de ser usado em ficha técnica) sai da base.
    const nomesAtuais = new Set(comEstoque.map(({ produto }) => normUpper(produto.nome)));
    const alvosRemocao = [];
    docsInsumos.forEach((x, id) => {
      if (!x.bluesoftSincronizadoEm) return;
      if (nomesAtuais.has(normUpper(x.insumo || x.nome || ''))) return;
      alvosRemocao.push(id);
    });
    let removidos = 0;
    for (let i = 0; i < alvosRemocao.length; i += 300) {
      const lote = alvosRemocao.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(id => batch.delete(fs.collection('producao_insumos_estoque').doc(id)));
      await batch.commit();
      removidos += lote.length;
    }
    _invalidarCachesDependentes();
    return { totalCatalogo: catalogoInsumo.length, utilizados: utilizados.length, comEstoque: comEstoque.length, criados, atualizados, removidos, falhas };
  }
  global.sincronizarInsumosBluesoft = sincronizarInsumosBluesoft;

  // ── Ficha Técnica — GET /api/pcp/ficha-tecnica (+ .../insumos) (fase 12i)
  // Rota real e documentada no schema oficial da Bluesoft (módulo PCP deles,
  // não inventado): filter.lojaKey devolve as fichas técnicas cadastradas
  // pra loja; cada ficha tem um endpoint próprio pra listar os insumos que a
  // compõem. Só busca ficha técnica de produto que JÁ tem estoque real na
  // loja (mesmo critério de sincronizarProdutosBluesoft) — não varre a base
  // inteira. Nunca sobrescreve uma ficha técnica que o usuário já editou
  // localmente (ver `existente?.insumos?.length`) — só preenche o que ainda
  // está vazio, mesma política de "nunca perder trabalho manual" das outras
  // sincronizações.
  function _normalizarFichaTecnica(f) {
    return { fichaTecnicaKey: f.fichaTecnicaKey, produtoKey: f.produtoKey, desc: f.descricao || '' };
  }
  function _normalizarInsumoFicha(i) {
    return { insumo: i.descricao || '', qty: Number(i.pesoBrutoQtd ?? i.pesoLiquido) || 0 };
  }
  async function sincronizarFichaTecnicaBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const cfg = await _config();
    const [resultadoEstoque, fichasBrutas] = await Promise.all([
      obterEstoqueBluesoft(loja, true),
      _paginarTudo('/api/pcp/ficha-tecnica', { lojaKey: loja.bluesoft_loja_key }, cfg, item => item.fichaTecnicaKey, opcoes.onProgresso),
    ]);
    const comEstoque = new Set(resultadoEstoque.itens.map(e => e.produtoKey));
    const fichas = fichasBrutas.map(_normalizarFichaTecnica).filter(f => comEstoque.has(f.produtoKey));
    const fs = global.getDTFirestore();
    const rawFs = raw();
    const [produtosSnap, fichasSnap] = await Promise.all([
      fs.collection('producao_produtos').get(),
      fs.collection('producao_ficha_tecnica').get(),
    ]);
    const produtoPorKey = new Map();
    produtosSnap.docs.forEach(d => { const x = d.data() || {}; if (x.bluesoftProdutoKey != null) produtoPorKey.set(String(x.bluesoftProdutoKey), { id: d.id, ...x }); });
    const fichaPorCod = new Map();
    fichasSnap.docs.forEach(d => { const x = d.data() || {}; if (x.cod != null) fichaPorCod.set(String(x.cod).trim(), { id: d.id, ...x }); });
    const agora = new Date().toISOString();
    const falhas = [];
    const pendentes = []; // { docId, payload, novo }
    for (const ficha of fichas) {
      const cod = String(ficha.produtoKey);
      const existente = fichaPorCod.get(cod);
      if (existente && Array.isArray(existente.insumos) && existente.insumos.length) continue; // já tem ficha editada manualmente — nunca sobrescreve
      let insumosBrutos;
      try {
        insumosBrutos = await _paginarTudo('/api/pcp/ficha-tecnica/' + ficha.fichaTecnicaKey + '/insumos', {}, cfg, item => item.fichaTecnicaItemKey);
      } catch (e) {
        falhas.push({ produtoKey: ficha.produtoKey, erro: e.message || String(e) });
        continue;
      }
      const insumos = insumosBrutos.map(_normalizarInsumoFicha).filter(i => i.insumo);
      const produtoLocal = produtoPorKey.get(cod);
      const payload = {
        cod, desc: ficha.desc || produtoLocal?.nome || existente?.desc || ('Produto ' + cod),
        insumos, bluesoftFichaTecnicaKey: ficha.fichaTecnicaKey, bluesoftSincronizadoEm: agora, atualizadoEm: agora,
      };
      pendentes.push({ docId: existente?.id, payload, novo: !existente });
    }
    let criadas = 0, atualizadas = 0;
    for (let i = 0; i < pendentes.length; i += 300) {
      const lote = pendentes.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(({ docId, payload, novo }) => {
        if (novo) { batch.set(fs.collection('producao_ficha_tecnica').doc(), { ...payload, criadoEm: agora }, { merge: true }); criadas++; }
        else { batch.set(fs.collection('producao_ficha_tecnica').doc(docId), payload, { merge: true }); atualizadas++; }
      });
      await batch.commit();
    }
    const ignoradas = fichas.length - pendentes.length - falhas.length;
    _invalidarCachesDependentes();
    return { totalFichas: fichas.length, criadas, atualizadas, ignoradas, falhas };
  }
  global.sincronizarFichaTecnicaBluesoft = sincronizarFichaTecnicaBluesoft;

  // ── Limpeza do ruído deixado pela sincronização antiga (fase 12c) ──────
  // Antes do filtro de relevância existir, uma sincronização podia gravar
  // dezenas de milhares de produtos zerados e sem nenhum pedido em
  // producao_projecao — e como a sincronização sempre foi upsert (nunca
  // apaga), esse ruído continua lá até alguém limpar explicitamente. Só
  // remove documento que (a) veio de uma sincronização Bluesoft
  // (`bluesoftSincronizadoEm` presente — nunca mexe em linha criada
  // manualmente na tela de Projeção) e (b) não tem nenhum sinal de
  // relevância (estoque/reserva/trânsito) nem projeção manual/M1-M3
  // digitada. `dryRun:true` só conta, não apaga — usado pra mostrar o
  // aviso de confirmação antes de qualquer exclusão de verdade.
  async function limparEstoqueBluesoftIrrelevante(dryRun) {
    const fs = global.getDTFirestore();
    const rawFs = raw();
    const snap = await fs.collection('producao_projecao').get();
    const alvos = [];
    snap.docs.forEach(d => {
      const x = d.data() || {};
      if (!x.bluesoftSincronizadoEm) return;
      const semSinal = !(Number(x.estoqueAtual) || 0) && !(Number(x.estoqueReservado) || 0) &&
        !(Number(x.estoqueEmTransito) || 0) && !(Number(x.estoqueReservadoVenda) || 0);
      const temDadoManual = (Number(x.venda_m1) || 0) > 0 || (Number(x.venda_m2) || 0) > 0 ||
        (Number(x.venda_m3) || 0) > 0 || (Number(x.projecaoManual) || 0) > 0;
      if (semSinal && !temDadoManual) alvos.push(d.id);
    });
    if (dryRun) return { total: snap.size, candidatos: alvos.length };
    for (let i = 0; i < alvos.length; i += 300) {
      const lote = alvos.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(id => batch.delete(fs.collection('producao_projecao').doc(id)));
      await batch.commit();
    }
    _invalidarCachesDependentes();
    return { total: snap.size, removidos: alvos.length };
  }
  global.limparEstoqueBluesoftIrrelevante = limparEstoqueBluesoftIrrelevante;

  // ── Limpeza manual ampla de producao_produtos (fase 12h) ────────────────
  // A reconciliação automática de sincronizarProdutosBluesoft só limpa
  // dentro do(s) tipo(s) marcado(s) naquela chamada (pra nunca apagar um
  // tipo que simplesmente não foi selecionado dessa vez). Essa ferramenta
  // manual é mais ampla de propósito: verifica contra o estoque real da loja
  // inteiro (sem filtrar por tipo), pra zerar de uma vez o acúmulo de
  // produtos sincronizados antes do filtro de estoque existir, não importa
  // de qual tipo eram. Sempre com pré-visualização (dryRun) e nunca toca
  // produto protegido por Ficha Técnica/Parâmetros PCP.
  async function limparProdutosBluesoftIrrelevante(dryRun) {
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const resultadoEstoque = await obterEstoqueBluesoft(loja, true);
    const chavesComEstoque = new Set(resultadoEstoque.itens.map(e => String(e.produtoKey)));
    const fs = global.getDTFirestore();
    const rawFs = raw();
    const snap = await fs.collection('producao_produtos').get();
    const alvos = [];
    snap.docs.forEach(d => {
      const x = d.data() || {};
      if (x.bluesoftProdutoKey == null) return;
      if (chavesComEstoque.has(String(x.bluesoftProdutoKey))) return;
      if (_produtoProtegidoPcp(x)) return;
      alvos.push(d.id);
    });
    if (dryRun) return { total: snap.size, candidatos: alvos.length };
    for (let i = 0; i < alvos.length; i += 300) {
      const lote = alvos.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(id => batch.delete(fs.collection('producao_produtos').doc(id)));
      await batch.commit();
    }
    _invalidarCachesDependentes();
    return { total: snap.size, removidos: alvos.length };
  }
  global.limparProdutosBluesoftIrrelevante = limparProdutosBluesoftIrrelevante;

  global.obterCatalogoBluesoft = obterCatalogoBluesoft;
  global.obterEstoqueBluesoft = obterEstoqueBluesoft;
  global.obterFornecedoresBluesoft = obterFornecedoresBluesoft;
  global.obterPedidosCompraBluesoft = obterPedidosCompraBluesoft;
  global.TIPOS_PRODUTO_BLUESOFT = TIPOS_PRODUTO_VALIDOS;
  global._bluesoftServiceInternals = { _requestBluesoft, _paginarTudo, _config, _normalizarProduto, _normalizarEstoqueComercial, _normalizarEstoqueWms, _normalizarEstoqueFicha, _estoqueRelevante, _buscarProdutosPorTipos, _nomesInsumosUsados, _produtoProtegidoPcp, _projecaoTemDadoManual, _normalizarFichaTecnica, _normalizarInsumoFicha, _janelasMensais, _normalizarNotaRecebimento, _normalizarCargaRecebimento, _ehDevolucao, _categoriaNota, _normalizarNotaRetorno, _pareceDevolucao, _normalizarVendedor, _normalizarComissaoVendedor, enriquecerNotasComVendedorPorComissao, _extrairInfCplDoXml, _extrairVolumesDoXml, _descobrirNotasDevolucaoViaRecebimentoSincronizado, _buscarNotaFiscalPorChave, _normalizarNotaRecebimentoComoRetorno, obterPedidosVendaFaturadosNaoEntreguesBluesoft, obterUrlXmlNota };
})(window);
