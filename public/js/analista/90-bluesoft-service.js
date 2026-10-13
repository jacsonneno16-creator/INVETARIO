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
  // PEDIDO AO VIVO (2026-08-23): voltou pra 3 junto com a nova tentativa
  // automática (pra recuperar de falha passageira sem perder o que já
  // tinha sido buscado) e o usuário reportou AO VIVO que piorou — mais
  // erro que com 1 só. Ou seja: concorrência de verdade importa aqui, não
  // é só a falta de retry. De volta a 1 (serializado, mais lento mas com
  // menos erro observado), com a tentativa automática mantida — as duas
  // coisas juntas: menos carga simultânea na BlueSoft E não perde dado já
  // coletado se uma página isolada falhar.
  const CONCORRENCIA_PAGINAS = 1;
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
      const lojaId = global.getDTLojaAtiva?.() || '';
      const porLoja = lojaId ? await raw().collection('lojas').doc(lojaId).collection('dt_config').doc('integracao_api').get().catch(() => null) : null;
      const globalSnap = porLoja?.exists ? null : await raw().collection('dt_config').doc('integracao_api').get().catch(() => null);
      _cfgCache = porLoja?.exists ? (porLoja.data() || {}) : globalSnap?.exists ? (globalSnap.data() || {}) : {};
      _cfgCache._origemConfig = porLoja?.exists ? 'loja/' + lojaId : globalSnap?.exists ? 'global' : 'ausente';
    } catch (e) { _cfgCache = {}; }
    _cfgCacheEm = Date.now();
    return _cfgCache;
  }
  function _baseUrl(cfg) { return cfg.ambiente === 'producao' ? (cfg.url_prd || '') : (cfg.url_hml || ''); }

  // PEDIDO AO VIVO (2026-08-23, print real do Network): centenas de
  // páginas chegam com dado real (produto/estoque/fornecedor visíveis na
  // resposta), mas se UMA página qualquer no meio de uma busca longa
  // esbarrar no 500 aleatório e genérico que a própria BlueSoft às vezes
  // devolve ("Ocorreu um erro inesperado", confirmado no corpo da
  // resposta — não é bug daqui), _paginarTudo() descartava tudo que já
  // tinha sido buscado com sucesso até ali. Com centenas de páginas, a
  // chance de NENHUMA falhar no meio do caminho é praticamente zero — daí
  // "funciona muito, mas no final não salva nada". _requestBluesoft agora
  // tenta de novo (até 2 vezes, com uma pequena espera) só pra esse tipo
  // de falha passageira (429 ou 5xx) antes de desistir da página — 401/400
  // continuam falhando na hora, tentar de novo não ajudaria.
  async function _requestBluesoft(pathComQuery, cfg, method, body, _tentativa) {
    _tentativa = _tentativa || 1;
    try {
      return await _requestBluesoftUmaVez(pathComQuery, cfg, method, body);
    } catch (e) {
      if (e.retentavel && _tentativa < 3) {
        await new Promise(r => setTimeout(r, 500 * _tentativa));
        return _requestBluesoft(pathComQuery, cfg, method, body, _tentativa + 1);
      }
      throw e;
    }
  }
  async function _requestBluesoftUmaVez(pathComQuery, cfg, method, body) {
    const idToken = await global.firebase?.auth?.().currentUser?.getIdToken();
    if (!idToken) throw new Error('Faça login novamente para usar a busca.');
    const baseUrl = _baseUrl(cfg);
    if (!baseUrl) throw new Error('URL não encontrada na configuração da loja ativa nem na configuração global.');
    if (!cfg.token) throw new Error('Token não encontrado na configuração da loja ativa nem na configuração global.');
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
      if (e.name === 'AbortError') throw new Error('A busca demorou demais para responder (timeout) em ' + pathComQuery.split('?')[0] + '.');
      throw Object.assign(new Error('Falha de rede ao chamar ' + pathComQuery.split('?')[0] + ': ' + (e.message || e)), { retentavel: true });
    }
    clearTimeout(timer);
    const texto = await resposta.text();
    let dados; try { dados = texto ? JSON.parse(texto) : null; } catch (_) { dados = texto; }
    if (!resposta.ok) {
      if (resposta.status === 401) throw new Error('Token inválido ou expirado.');
      if (resposta.status === 429) throw Object.assign(new Error('Limite de requisições atingido (muitas chamadas em paralelo) — tente novamente em instantes.'), { retentavel: true });
      const detalhe = dados && (dados.erro || dados.message) ? (dados.erro || dados.message) : String(texto).slice(0, 300);
      throw Object.assign(new Error('HTTP ' + resposta.status + ' em ' + pathComQuery.split('?')[0] + (detalhe ? ': ' + detalhe : '')), { status: resposta.status, retentavel: resposta.status >= 500 });
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
  // PEDIDO AO VIVO (2026-08-24, confirmado ao vivo com o usuário): mesmo
  // com a tentativa automática de _requestBluesoft (até 3x), a BlueSoft às
  // vezes erra com frequência ALTA o suficiente pra uma página específica
  // esgotar as 3 tentativas mesmo assim — e como o Promise.all de uma
  // rodada rejeitava inteiro nesse caso, TUDO que já tinha sido coletado
  // com sucesso até ali (podem ser centenas de páginas boas) era jogado
  // fora, resultando em "busca roda inteira, mas no final não salva nada".
  // Agora cada página que falhar (mesmo depois das 3 tentativas) é
  // registrada em `itens.falhas` e a busca CONTINUA pras próximas páginas
  // — só para de vez se 5 rodadas seguidas não renderem nenhum item novo
  // (falha ou vazio de verdade, mesmo critério de sempre). Dado parcial
  // real é sempre melhor que descartar tudo.
  async function _paginarTudo(path, params, cfg, chaveIdentidade, onProgresso) {
    const itens = [];
    const vistos = new Set();
    const falhas = [];
    let pagina = 0, acabou = false, paginasSemNovidade = 0;
    while (!acabou) {
      const indices = Array.from({ length: CONCORRENCIA_PAGINAS }, (_, i) => pagina + i);
      const respostas = await Promise.all(indices.map(p => {
        const qs = new URLSearchParams(Object.assign({}, params, { currentPage: p, pageSize: TAMANHO_PAGINA })).toString();
        return _requestBluesoft(path + '?' + qs, cfg).catch(e => ({ __paginaFalhou: true, pagina: p, erro: e && e.message || String(e) }));
      }));
      for (const body of respostas) {
        if (body && body.__paginaFalhou) {
          falhas.push({ pagina: body.pagina, erro: body.erro });
          paginasSemNovidade++;
          if (paginasSemNovidade >= 5) { acabou = true; break; }
          continue;
        }
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
      if (pagina > LIMITE_PAGINAS) throw new Error('A busca passou do limite de segurança sem terminar — fale com o suporte.');
    }
    itens.falhas = falhas;
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
      fatorEstoque: Math.max(1, Number(p.fatorEstoque) || Number(p.quantidadeEmbalagemVenda) || 1),
      produtoUnitarioKey: p.produtoUnitarioKey ?? null, caixa: p.caixa === true,
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

  // Resolve a apresentação comercial do produto. Quando a chave recebida é
  // do item unitário, consulta as caixas/fardos vinculados e escolhe a
  // embalagem ativa cujo fator corresponde ao estoque/pedido. Assim nome,
  // código e fator sempre pertencem à MESMA embalagem comercial.
  async function _obterProdutoEmbalagemVenda(produtoKey, cfg, fatorPreferido) {
    const cacheKey='produto_embalagem_'+produtoKey+'_'+(Number(fatorPreferido)||0);
    const salvo=_cacheGet(cacheKey,CACHE_CATALOGO_MS);if(salvo?.naoEncontrado)return null;if(salvo)return salvo;
    let dados;
    try{
      // A rota /{produtoKey} devolve 404 para chaves antigas presentes em
      // pedidos pendentes da homologação, e o navegador registra cada 404
      // como erro mesmo quando o JS trata. A listagem documentada aceita
      // `produtoKey` como filtro e responde 200 + lista vazia nesses casos.
      const qs=new URLSearchParams({produtoKey:String(produtoKey),currentPage:'0',pageSize:'10'}).toString();
      const linhas=_linhasDe(await _requestBluesoft('/api/comercial/produtos?'+qs,cfg));
      // Algumas versões da homologação ignoram silenciosamente o filtro
      // produtoKey e devolvem a primeira página do catálogo. Nunca aceitar
      // a primeira linha sem conferir a chave: isso associava o nome de um
      // produto ao código de outro e depois impedia o estoque de casar.
      dados=linhas.find(x=>String(x?.produtoKey??'').trim()===String(produtoKey).trim())||null;
      if(!dados){_cacheSet(cacheKey,{naoEncontrado:true});return null;}
    }
    catch(e){
      // Pedido pendente pode conservar a chave de um cadastro já inativo ou
      // indisponível na homologação. 404 não é falha transitória: memoriza o
      // resultado negativo e deixa o chamador usar catálogo/estoque local.
      if(e?.status===404){_cacheSet(cacheKey,{naoEncontrado:true});return null;}
      throw e;
    }
    const detalhe=Array.isArray(dados)?dados[0]:(dados?.data&&!Array.isArray(dados.data)?dados.data:dados);
    if(!detalhe) return null;
    let escolhido=detalhe;
    const fatorAtual=Math.max(1,Number(detalhe.fatorEstoque)||Number(detalhe.quantidadeEmbalagemVenda)||1);
    if(detalhe.caixa!==true&&fatorAtual<=1){
      try{
        const baseKey=detalhe.produtoUnitarioKey??detalhe.produtoKey??produtoKey;
        const caixas=await _paginarTudo('/api/comercial/produtos/'+encodeURIComponent(baseKey)+'/caixas',{status:'ATIVO'},cfg,x=>x.produtoKey);
        const ativas=caixas.filter(x=>x.status!=='INATIVO'&&(Number(x.fatorEstoque)||0)>1);
        const alvo=Number(fatorPreferido)||Number(detalhe.quantidadeEmbalagemVenda)||0;
        const caixa=(alvo>1?ativas.find(x=>Number(x.fatorEstoque)===alvo):null)||ativas[0];
        if(caixa) escolhido={...detalhe,...caixa,caixa:true,produtoUnitarioKey:caixa.produtoUnitarioKey??baseKey,tipoProduto:detalhe.tipoProduto};
      }catch(e){/* sem embalagem vinculada: mantém o cadastro retornado */}
    }
    const normalizado=_normalizarProduto(escolhido);
    normalizado.canonicalKey=String(escolhido.produtoKey??produtoKey);
    normalizado.embalagemKey=escolhido.embalagemKey||'';
    normalizado.fator=Math.max(1,Number(normalizado.fatorEstoque)||1);
    _cacheSet(cacheKey,normalizado);
    return normalizado;
  }
  // Um doc de producao_produtos só pode ser apagado pela reconciliação
  // automática se ele NUNCA foi tocado por Ficha Técnica nem por Parâmetros
  // PCP — a sincronização Bluesoft só grava os campos de catálogo (ver
  // payload abaixo); qualquer chave fora desse conjunto presente no doc
  // prova que outro fluxo (ficha técnica/PCP) já configurou esse produto de
  // propósito, mesmo que agora esteja sem estoque — nunca apaga isso.
  const CAMPOS_PROTEGIDOS_PRODUTO = ['metaCoberturaDias', 'estoqueMinimo', 'estoqueMaximo', 'estoqueSeguranca',
    'leadTimeDias', 'loteMinimoCompra', 'multiploCompra', 'criticidade', 'fornecedorPadrao', 'capacidadePorCaminhao', 'maxCaminhoesPorEntrega',
    'pc_min', 'maquina', 'producaoMinima', 'multiploProducao', 'tipoMinimo', 'prioridadeProducao', 'alergenico', 'empresaProdutoraId', 'insumos'];
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
        // _paginarTudo não joga mais fora tudo por causa de UMA página
        // ruim — mas se páginas específicas continuaram falhando mesmo
        // com a tentativa automática, isso ainda precisa aparecer pro
        // usuário (dado parcial, não escondido).
        if (itens.falhas && itens.falhas.length) {
          falhas.push({ tipo: tipo || '(todos)', erro: itens.falhas.length + ' página(s) não vieram mesmo após tentar de novo (dado parcial)' });
        }
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
    const fator = Math.max(1, Number(e.fatorEstoque) || 1);
    return {
      produtoKey: e.produtoKey, cod: String(e.produtoKey),
      produtoUnitarioKey: e.produtoUnitarioKey ?? null,
      fatorEstoque: fator, estoqueAtualUnidades: Number(e.saldoFisico) || 0,
      estoqueAtual: (Number(e.saldoFisico) || 0) / fator, estoqueDisponivel: (Number(e.saldoDisponivel) || 0) / fator,
      estoqueReservado: (Number(e.quantidadeReservada) || 0) / fator, estoqueEmTransito: (Number(e.quantidadeEmTransito) || 0) / fator,
      pedidosPendentes: (Number(e.quantidadePendenteEmPedidos) || 0) / fator,
      // Reserva por PEDIDO DE VENDA em aberto — é o sinal que diferencia um
      // produto zerado mas irrelevante de um produto zerado com demanda
      // real represada (ruptura de verdade, que o PCP precisa enxergar).
      pedidosVendaPendentes: (Number(e.quantidadeReservadaEmPedidosVendaPendentes) || 0) / fator,
      consumoDiaMedio: (Number(e.mediaVendaDiaria) || 0) / fator,
      custoUltimaCompra: Number(e.custoBrutoUltimaCompra) || 0, custoMedioContabil: Number(e.custoMedioContabil) || 0,
      coberturaDiasBluesoft: e.diasDeCoberturaOnline != null ? Number(e.diasDeCoberturaOnline) : null,
    };
  }
  function _normalizarEstoqueWms(e) {
    // A resposta oficial da Bluesoft usa camelCase (produtoKey e
    // quantidadeDisponivelEmUnidades). Mantemos os aliases minúsculos por
    // compatibilidade com respostas antigas/mocks, mas nunca dependemos
    // exclusivamente deles.
    const produtoKey = e.produtoKey ?? e.produtokey;
    const quantidade = e.quantidadeDisponivelEmUnidades ?? e.quantidadedisponivelemunidades;
    const fator = Math.max(1, Number(e.fatorEstoque ?? e.fatorestoque) || 1);
    const unidades = Math.max(0, parseFloat(String(quantidade ?? 0).replace(',', '.')) || 0);
    return {
      produtoKey: String(produtoKey ?? '').trim(), cod: String(produtoKey ?? '').trim(),
      produtoUnitarioKey: e.produtoUnitarioKey ?? null,
      descricaoProduto: e.descricaoProduto || '',
      localDeEstoqueKey: e.localDeEstoqueKey ?? null,
      enderecoLogisticoKey: e.enderecoLogisticoKey ?? null,
      enderecoLogisticoDescritivo: e.enderecoLogisticoDescritivo || '',
      fatorEstoque: fator, estoqueAtualUnidades: unidades, estoqueAtual: unidades / fator,
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
    const produtoKey = e.produtoKey ?? e.produtokey;
    return {
      produtoKey: String(produtoKey ?? '').trim(), cod: String(produtoKey ?? '').trim(),
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
    if (!lojaKey) throw new Error('Loja sem vínculo com a integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    let configLocais = {};
    try { const s=await global.getDTFirestore().collection('pcp_configuracoes').doc('estoque_bluesoft').get();configLocais=s.exists?(s.data()||{}):{}; } catch(e) { configLocais={}; }
    const locaisExcluidos = new Set((configLocais.locaisExcluidos || []).map(String));
    const chave = 'estoque_' + lojaKey + (opcoes.incluirTodos ? '_todos' : '') + '_excl_' + Array.from(locaisExcluidos).sort().join('-');
    if (!forcar) { const c = _cacheGet(chave, CACHE_CURTO_MS); if (c) return c; }
    const cfg = await _config();
    let normalizados, totalRecebido, rotaSimplificada = false, falhas = [];
    if (loja.bluesoft_loja_cd === true) {
      // Conforme o OpenAPI, esta rota WMS devolve um ARRAY direto e não uma
      // PaginationResponse. Passá-la por _paginarTudo fazia repetir a mesma
      // lista várias vezes (currentPage é ignorado pelo endpoint), gerando
      // chamadas pesadas desnecessárias e possíveis timeouts/429.
      const qs = new URLSearchParams({ lojaKey }).toString();
      const respostaWms = await _requestBluesoft('/api/wms/ajuste-estoque-logistico?' + qs, cfg);
      const itensBrutos = _linhasDe(respostaWms);
      const nomesLocais = new Map();
      try {
        const respostaLocais = await _requestBluesoft('/api/modulos/estoque/operacoes/consultar-local-de-estoque?' + qs, cfg);
        _linhasDe(respostaLocais).forEach(l => { const k=String(l.localDeEstoqueKey??'').trim(); if(k) nomesLocais.set(k,String(l.descricao||'').trim()); });
      } catch(e) { /* nome é enriquecimento; a falta dele não bloqueia o saldo */ }
      const locaisMap = new Map();
      itensBrutos.forEach(item=>{const k=String(item.localDeEstoqueKey??'').trim();if(!k)return;const atual=locaisMap.get(k)||{key:k,nome:nomesLocais.get(k)||'',exemploEndereco:''};if(!atual.nome)atual.nome=nomesLocais.get(k)||'';if(!atual.exemploEndereco)atual.exemploEndereco=item.enderecoLogisticoDescritivo||'';locaisMap.set(k,atual);});
      try { await global.getDTFirestore().collection('pcp_configuracoes').doc('estoque_bluesoft').set({locaisDetectados:Array.from(locaisMap.values()),atualizadoEm:new Date().toISOString()},{merge:true}); } catch(e) { /* configuração é auxiliar; estoque continua */ }
      const itens = itensBrutos.filter(item=>!locaisExcluidos.has(String(item.localDeEstoqueKey??'')));
      if (typeof opcoes.onProgresso === 'function') { try { opcoes.onProgresso(itens.length); } catch (e) { /* progresso não quebra a busca */ } }
      const porProduto = new Map();
      itens.forEach(item => {
        const cod = String(item.produtoKey ?? item.produtokey ?? '').trim();
        if (!cod) return;
        if (!porProduto.has(cod)) porProduto.set(cod, _normalizarEstoqueWms(item));
        else { const atual=_normalizarEstoqueWms(item), alvo=porProduto.get(cod); alvo.estoqueAtual += atual.estoqueAtual; alvo.estoqueAtualUnidades=(alvo.estoqueAtualUnidades||0)+(atual.estoqueAtualUnidades||0); }
      });
      normalizados = Array.from(porProduto.values());
      totalRecebido = normalizados.length; // WMS não tem sinal de "pedido pendente" pra filtrar — mantém como já era
    } else {
      const itens = await _paginarTudo('/api/comercial/estoques', {
        lojaKey, retornarCustoUltimaCompra: true, retornarEstoqueEmTransito: true, ignoraProdutosInativos: true,
      }, cfg, item => item.produtoKey, opcoes.onProgresso);
      // `.map()`/`.filter()` devolvem um array NOVO — a `.falhas` que
      // _paginarTudo anexa no array original (páginas que não vieram
      // mesmo após tentar de novo) se perdia silenciosamente aqui, e nunca
      // chegava no `resultado` devolvido pro chamador. Guarda antes de
      // qualquer .map()/.filter() reatribuir a variável.
      falhas = itens.falhas || [];
      let todosNormalizados = itens.map(_normalizarEstoqueComercial);
      totalRecebido = todosNormalizados.length;
      if (!totalRecebido) {
        // /api/comercial/estoques voltou vazio pra essa loja — cai pra
        // .../ficha-estoque (rota mais simples, sem reserva/trânsito/custo,
        // mas comprovadamente funcional pra essa mesma loja no fluxo de
        // Inventário) em vez de reportar "0 de estoque" quando na verdade é
        // a rota rica que não está disponível.
        const itensFicha = await _paginarTudo('/api/comercial/estoques/ficha-estoque', { lojaKey }, cfg, item => item.produtokey, opcoes.onProgresso);
        falhas = itensFicha.falhas || [];
        todosNormalizados = itensFicha.map(_normalizarEstoqueFicha);
        totalRecebido = todosNormalizados.length;
        rotaSimplificada = totalRecebido > 0;
      }
      normalizados = opcoes.incluirTodos ? todosNormalizados : todosNormalizados.filter(_estoqueRelevante);
    }
    const resultado = { itens: normalizados, totalRecebido, rotaSimplificada, falhas };
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
    if (filtros.numeroDoPedido) params.numeroDoPedido = filtros.numeroDoPedido;
    const itens = await _paginarTudo('/api/compras/pedidos-de-compra', params, cfg, item => item.numeroPedido);
    const normalizados = itens.map(p => ({
      numeroPedido: p.numeroPedido, dataEmissao: p.dataEmissao, fornecedorKey: p.fornecedorKey,
      status: p.statusPedido || '', dataEntregaInicial: p.dataEntregaInicial, dataEntregaFinal: p.dataEntregaFinal,
      entregaPendente: p.entregaPendente === true,
      itens: (p.itens || []).map(it => ({ itemPedidoKey: it.itemPedidoKey, produtoKey: it.produtoKey, quantidadePedida: Number(it.quantidadePedida) || 0, quantidadePendente: Number(it.quantidadePendente) || 0 })),
    }));
    normalizados.falhas = itens.falhas || []; // `.map()` devolve array novo — sem isto, a falha registrada por _paginarTudo se perde antes de chegar no chamador.
    return normalizados;
  }

  // PEDIDO AO VIVO (PCP → Agendamentos): o comprador digita uma previsão
  // manual hoje (produto/fornecedor/qtd/data/nº do pedido). Quando o
  // fornecedor confirma a agenda de verdade, em vez de redigitar tudo, o
  // comprador só informa o número do pedido — esta função busca ESSE pedido
  // específico na Bluesoft (filtro numeroDoPedido, real e confirmado no
  // schema oficial — não precisa varrer todos os pedidos pendentes) e
  // resolve fornecedor/produto pra nome, pra tela só mostrar "usar este
  // item" em vez de o comprador ter que digitar de novo.
  async function buscarPedidoCompraBluesoftPorNumero(numeroPedido) {
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const [pedidos, fornecedores, produtosSnap] = await Promise.all([
      obterPedidosCompraBluesoft({ lojaKey: loja.bluesoft_loja_key, numeroDoPedido: numeroPedido }),
      obterFornecedoresBluesoft(false),
      global.getDTFirestore().collection('producao_produtos').get(),
    ]);
    const pedido = pedidos.find(p => String(p.numeroPedido) === String(numeroPedido));
    if (!pedido) throw new Error('Pedido nº ' + numeroPedido + ' não encontrado para esta loja.');
    const fornecedorNome = fornecedores.find(f => f.fornecedorKey === pedido.fornecedorKey)?.nome || ('Fornecedor ' + pedido.fornecedorKey);
    const produtoPorCod = new Map();
    produtosSnap.docs.forEach(d => { const x = d.data() || {}; if (x.cod != null) produtoPorCod.set(String(x.cod).trim(), x); });
    const itens = pedido.itens.map(it => {
      const local = produtoPorCod.get(String(it.produtoKey).trim());
      return {
        produtoKey: it.produtoKey, cod: String(it.produtoKey), produtoNome: local?.nome || null,
        cadastradoNaProducao: !!local, quantidadePedida: it.quantidadePedida, quantidadePendente: it.quantidadePendente,
      };
    });
    return {
      numeroPedido: pedido.numeroPedido, fornecedorKey: pedido.fornecedorKey, fornecedorNome,
      dataEntregaInicial: pedido.dataEntregaInicial, dataEntregaFinal: pedido.dataEntregaFinal,
      entregaPendente: pedido.entregaPendente, itens,
    };
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
  // Leitura targetada dos documentos que realmente vieram da Bluesoft.
  // Antes cada sincronização fazia `.get()` na coleção INTEIRA de notas e
  // cargas só para montar `key -> docId`; isso piora indefinidamente com o
  // histórico. Agora o Firestore procura somente as chaves deste lote.
  async function _buscarDocsExistentesPorCampo(col, campo, valores) {
    const unicos = [...new Set((valores || []).filter(v => v != null).map(v => String(v)))];
    const mapa = new Map();
    if (!unicos.length) return mapa;
    if (!col || typeof col.where !== 'function') {
      const snap = await col.get();
      snap.docs.forEach(d => { const x = d.data() || {}; if (x[campo] != null) mapa.set(String(x[campo]), d.id); });
      return mapa;
    }
    try {
      const lotes = [];
      for (let i = 0; i < unicos.length; i += 10) lotes.push(unicos.slice(i, i + 10));
      for (let i = 0; i < lotes.length; i += 4) {
        const snaps = await Promise.all(lotes.slice(i, i + 4).map(lote => col.where(campo, 'in', lote).get()));
        snaps.forEach(snap => snap.docs.forEach(d => { const x = d.data() || {}; if (x[campo] != null) mapa.set(String(x[campo]), d.id); }));
      }
      return mapa;
    } catch (e) {
      console.warn('[Bluesoft] Busca targetada por ' + campo + ' indisponível; usando fallback integral:', e && e.message ? e.message : e);
      const snap = await col.get();
      snap.docs.forEach(d => { const x = d.data() || {}; if (x[campo] != null) mapa.set(String(x[campo]), d.id); });
      return mapa;
    }
  }

  async function sincronizarRecebimentoBluesoft(opcoes) {
    opcoes = opcoes || {};
    const meses = Math.max(1, Math.min(24, Number(opcoes.meses) || 12));
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
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
    const [notaDocPorKey, cargaDocPorKey] = await Promise.all([
      _buscarDocsExistentesPorCampo(fs.collection('recebimento_notas'), 'notaFiscalKey', notasBrutas.map(n => n.notaFiscalKey)),
      _buscarDocsExistentesPorCampo(fs.collection('recebimento_cargas'), 'movimentacaoCargaKey', cargas.map(c => c.movimentacaoCargaKey)),
    ]);

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

  // PEDIDO AO VIVO (2026-08-24): "eu queria colocar lá a data que eu quero
  // buscar... não buscar automaticamente" — o usuário está numa cópia de
  // homologação da Bluesoft datada de junho (só tem dado até lá), e no
  // futuro vai trocar pra API de produção — uma janela fixa "hoje menos N
  // meses" não é confiável em nenhum dos dois casos. Resolve um período
  // explícito (Date, ou string 'dd/MM/yyyy'/'yyyy-MM-dd') quando o usuário
  // informou `dataInicial`/`dataFinal`; sem isso, cai no automático de
  // sempre (hoje menos `diasPadrao` dias, ou 6 meses se `diasPadrao` não
  // for passado) — comportamento anterior 100% preservado quando ninguém
  // escolhe período.
  function _parseDataBluesoft(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return null;
  }
  function _resolverPeriodoBluesoft(opcoes, diasPadrao) {
    opcoes = opcoes || {};
    const inicioManual = _parseDataBluesoft(opcoes.dataInicial);
    const fimManual = _parseDataBluesoft(opcoes.dataFinal);
    if (inicioManual || fimManual) {
      return { inicio: inicioManual || fimManual, fim: fimManual || new Date(), manual: true };
    }
    const fim = new Date(); const inicio = new Date();
    if (diasPadrao) inicio.setDate(inicio.getDate() - diasPadrao); else inicio.setMonth(inicio.getMonth() - 6);
    return { inicio, fim, manual: false };
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
  async function obterPedidosVendaFaturadosNaoEntreguesBluesoft(filialKey, cfg, periodo) {
    const fim = (periodo && periodo.fim) || new Date();
    const inicio = (periodo && periodo.inicio) || (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d; })();
    const porKey = new Map();
    const itensPorStatus = await Promise.all(STATUS_FATURADO_NAO_ENTREGUE.map(status => _paginarTudo('/api/forca-de-vendas/pedidos', {
      filialKey, pedidoVendaStatus: status,
      dataEmissaoInicial: _fmtDataBR(inicio) + ' 00:00', dataEmissaoFinal: _fmtDataBR(fim) + ' 23:59',
    }, cfg, item => item.pedidoForcaVendaKey)));
    // _paginarTudo não rejeita mais por página ruim (páginas que falham até
    // esgotar as tentativas ficam registradas em .falhas em vez de derrubar
    // o que já tinha vindo bem — ver 90-bluesoft-service.js). Mas se um
    // status inteiro não trouxe NADA e tem falhas registradas, é a busca
    // inteira que não respondeu (não uma página ruim isolada) — precisa
    // continuar propagando como erro real, senão o diagnóstico de "3 fontes
    // com melhor esforço" (obterNotasRetornoBluesoft) nunca mais marca essa
    // fonte como falha, mesmo quando ela nunca respondeu de verdade.
    const statusSemRespostaAlguma = STATUS_FATURADO_NAO_ENTREGUE.filter((_, i) => itensPorStatus[i].length === 0 && (itensPorStatus[i].falhas || []).length > 0);
    if (statusSemRespostaAlguma.length) {
      const primeiraFalha = itensPorStatus.flatMap(itens => itens.falhas || [])[0];
      throw new Error('Falha ao buscar pedidos de força de venda (' + statusSemRespostaAlguma.join(', ') + '): ' + (primeiraFalha ? primeiraFalha.erro : 'sem resposta'));
    }
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
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const cfg = await _config();
    // Sem dataInicial/dataFinal explícitos, mantém o automático de sempre
    // (janela de `opcoes.dias`, 1-30, padrão 30). Com data explícita
    // (PEDIDO AO VIVO: usuário numa cópia de homologação datada de junho
    // quer escolher o período em vez de confiar num cálculo relativo a
    // hoje), usa exatamente o período informado, sem teto de 30 dias.
    let inicio, fim, periodoManual = false;
    if (opcoes.dataInicial || opcoes.dataFinal) {
      const periodo = _resolverPeriodoBluesoft(opcoes);
      inicio = periodo.inicio; fim = periodo.fim; periodoManual = true;
    } else {
      const dias = Math.max(1, Math.min(30, Number(opcoes.dias) || 30));
      fim = new Date(); inicio = new Date(); inicio.setDate(inicio.getDate() - dias);
    }
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
      obterPedidosVendaFaturadosNaoEntreguesBluesoft(loja.bluesoft_loja_key, cfg, periodoManual ? { inicio, fim } : null)
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

  // PEDIDO AO VIVO (2026-08-24): API de comissão (/api/forca-de-vendas/
  // comissoes-vendedores) removida por completo — exigia permissão extra e
  // expunha dado de remuneração, e o usuário prefere um cadastro local
  // (Analista registra vendedor/supervisor por CNPJ do mercado uma vez —
  // ver recebimento_recusas_vendedores_mercado, cadastro em 97-recebimento-recusas.js) em
  // vez de uma chamada à API pra isso. Venda faturada (3ª fonte, acima)
  // continua resolvendo vendedor via /api/forca-de-vendas/vendedores
  // (não é comissão) — o cadastro local só sobrepõe quando cadastrado.

  // PCP: fluxos distintos. Pedido de venda aberto compromete estoque;
  // pedido de compra pendente é entrada futura. Ambos são gravados item a
  // item, em caixas, nas coleções que o PCP realmente lê.
  const STATUS_VENDA_PENDENTE = ['ABERTO','FECHADO','EM_SEPARACAO','SEPARADO','REABERTO','AGUARDANDO_ANALISE_GERENCIAL','EM_ANALISE_GERENCIAL','APROVADO','ROTEIRIZADO','FATURANDO','EM_ANALISE_DE_CREDITO','AGUARDANDO_PAGAMENTO','AGUARDANDO_SEPARACAO_WMS'];
  const _idSeguro = v => String(v ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
  function _produtoTemNomeValido(p){const nome=String(p?.nome||p?.produto||p?.descricao||'').trim();return !!nome&&!/^Produto\s+\d+$/i.test(nome);}
  async function _obterCompradorBluesoft(compradorKey,cfg){
    const key=String(compradorKey??'').trim();if(!key)return null;
    const ck='comprador_'+key,c=_cacheGet(ck,CACHE_CATALOGO_MS);if(c)return c.naoEncontrado?null:c;
    const qs=new URLSearchParams({compradorKey:key,currentPage:'0',pageSize:'10'}).toString();
    const linhas=_linhasDe(await _requestBluesoft('/api/compras/compradores?'+qs,cfg));
    const x=linhas.find(v=>String(v?.compradorKey??'').trim()===key);
    if(!x){_cacheSet(ck,{naoEncontrado:true});return null;}
    const out={compradorKey:key,nome:x.nomeAbreviado||x.nomeFantasia||x.nomeRazao||('Comprador '+key),documento:x.cpfCnpj||''};_cacheSet(ck,out);return out;
  }
  async function _contextoPcpBluesoft() {
    const lojaId=global.getDTLojaAtiva?.(); if(!lojaId)throw new Error('Nenhuma loja selecionada.');
    const lojaSnap=await raw().collection('lojas').doc(lojaId).get(); if(!lojaSnap.exists)throw new Error('Loja não encontrada.');
    const loja={id:lojaId,...lojaSnap.data()}; if(!loja.bluesoft_loja_key)throw new Error('Loja sem bluesoft_loja_key.');
    const fs=global.getDTFirestore(), [ps,pcps,ests,regrasSnap]=await Promise.all([fs.collection('producao_produtos').get(),fs.collection('pcp_produtos_bluesoft').get().catch(()=>({docs:[]})),fs.collection('pcp_estoque_bluesoft').get().catch(()=>({docs:[]})),fs.collection('compras_regras_comprador').get().catch(()=>({docs:[]}))]);
    const produtos=new Map(),produtoProducaoPorAlias=new Map(); ps.docs.forEach(d=>{const x=d.data()||{},k=String(x.bluesoftProdutoKey??x.cod??'').trim();if(k){const p={id:d.id,...x,canonicalKey:String(x.cod??k),fator:Math.max(1,Number(x.unid)||Number(x.fatorCaixaBluesoft)||1)};produtos.set(k,p);[x.cod,x.bluesoftProdutoKey,x.produtoUnitarioKeyBluesoft,x.produtoUnitarioKey].forEach(a=>{a=String(a??'').trim();if(a)produtoProducaoPorAlias.set(a,p);});const unit=String(x.produtoUnitarioKeyBluesoft??'').trim();if(unit&&!produtos.has(unit))produtos.set(unit,p);}});
    pcps.docs.forEach(d=>{const x=d.data()||{},k=String(x.bluesoftProdutoKey??x.cod??'').trim();if(k){const p={id:d.id,...x,canonicalKey:String(x.cod??k),fator:Math.max(1,Number(x.fatorCaixaBluesoft)||1)};if(!produtos.has(k))produtos.set(k,p);const unit=String(x.produtoUnitarioKeyBluesoft??'').trim();if(unit&&!produtos.has(unit))produtos.set(unit,p);}});
    ests.docs.forEach(d=>{const x=d.data()||{},k=String(x.cod??'').trim();if(!k)return;const atual=produtos.get(k)||{};produtos.set(k,{...atual,nome:atual.nome||x.produto||'',fator:Math.max(1,Number(x.fatorCaixa)||Number(atual.fator)||1)});});
    const vinculosComprador=new Map();regrasSnap.docs.forEach(d=>{const x=d.data()||{};if(x.ativo!==false&&x.tipo==='bluesoft_comprador'&&String(x.valor??'').trim())vinculosComprador.set(String(x.valor).trim(),{regraId:d.id,compradorUid:x.compradorUid||'',compradorEmail:x.compradorEmail||'',compradorNome:x.compradorNome||''});});
    return {loja,fs,produtos,produtoProducaoPorAlias,vinculosComprador,cfg:await _config()};
  }
  async function sincronizarPedidosVendaPcpBluesoft(opcoes) {
    opcoes=opcoes||{}; const {loja,fs,produtos,cfg}=await _contextoPcpBluesoft(); const falhas=[], porPedido=new Map();
    // O PCP não precisa de cliente, destinatário nem de uma linha para cada
    // pedido. Busca apenas os pedidos nos status pendentes e, assim que cada
    // resposta chega, conserva somente os itens necessários para somar a
    // demanda por produto. Os status são consultados em pequenos lotes
    // paralelos para não transformar 13 buscas independentes numa espera
    // sequencial muito longa.
    await _emLotesParalelos(STATUS_VENDA_PENDENTE, async status => {
      try {
        const xs=await _paginarTudo('/api/forca-de-vendas/pedidos',{filialKey:loja.bluesoft_loja_key,pedidoVendaStatus:status},cfg,x=>x.pedidoForcaVendaKey);
        xs.forEach(x=>porPedido.set(String(x.pedidoForcaVendaKey??x.numeroPedidoExterno??JSON.stringify(x.itens||[])),x));
        if(xs.falhas?.length)falhas.push(...xs.falhas.map(f=>({status,...f})));
      } catch(e) { falhas.push({status,erro:e.message||String(e)}); }
    }, 3);
    const chavesPedidos=new Set();porPedido.forEach(ped=>(ped.itens||[]).forEach(it=>{if(it.produtoKey!=null)chavesPedidos.add(String(it.produtoKey));}));
    // Revalida todos os códigos encontrados nos pedidos. Além dos nomes
    // vazios, versões anteriores podiam ter salvo uma descrição NÃO vazia,
    // porém pertencente a outro produto porque o filtro da rota de lista
    // foi ignorado. Consultar por chave corrige também esses registros.
    const faltantes=Array.from(chavesPedidos);
    await _emLotesParalelos(faltantes,async pk=>{try{const p=await _obterProdutoEmbalagemVenda(pk,cfg,produtos.get(pk)?.fator);if(!p)return;produtos.set(pk,p);produtos.set(p.canonicalKey,p);await fs.collection('pcp_produtos_bluesoft').doc('produto_'+_idSeguro(p.canonicalKey)).set({cod:p.canonicalKey,nome:p.nome,bluesoftProdutoKey:p.produtoKey,produtoUnitarioKeyBluesoft:p.produtoUnitarioKey,fatorCaixaBluesoft:p.fator,embalagemKeyBluesoft:p.embalagemKey||'',unidadeMedidaBluesoft:p.unidade,bluesoftTipoProduto:p.tipoPrincipal||null,origem:'bluesoft',atualizadoEm:new Date().toISOString()},{merge:true});}catch(e){falhas.push({produtoKey:pk,erro:'Cadastro do produto: '+(e.message||String(e))});}},1);
    const totais=new Map();
    porPedido.forEach(ped => (ped.itens||[]).forEach(it => {
      const pkOriginal=String(it.produtoKey??'').trim(); if(!pkOriginal)return;
      const p=produtos.get(pkOriginal)||{},pk=String(p.canonicalKey||p.produtoKey||pkOriginal), fator=Math.max(1,Number(p.fator)||1);
      const unidades=Math.max(0,Number(it.quantidadePedida)||0), atendidasUn=Math.max(0,Number(it.quantidadeSeparada)||0);
      if(unidades<=0)return;
      const atual=totais.get(pk)||{quantidade:0,atendida:0,unidades:0,atendidasUn:0,fator,produto:p.nome||('Produto '+pk)};
      atual.quantidade+=unidades/fator; atual.atendida+=Math.min(unidades,atendidasUn)/fator;
      atual.unidades+=unidades; atual.atendidasUn+=Math.min(unidades,atendidasUn);
      totais.set(pk,atual);
    }));
    const agora=new Date().toISOString(), vistos=new Set(); let gravados=0;
    for(const [pk,total] of totais){const id='bs_venda_produto_'+_idSeguro(pk);vistos.add(id);await fs.collection('pcp_pedidos').doc(id).set({origem:'bluesoft',agrupadoPorProduto:true,pedido:'Total pendente BlueSoft',cod:pk,prodKey:pk,produto:total.produto,quantidade:total.quantidade,quantidadeAtendida:Math.min(total.quantidade,total.atendida),quantidadeUnidades:total.unidades,quantidadeAtendidaUnidades:total.atendidasUn,fatorCaixa:total.fator,unidade:'CX',destino:'',dataNecessaria:'',status:total.atendida>=total.quantidade?'atendido':total.atendida>0?'parcial':'pendente',bluesoftSincronizadoEm:agora,atualizadoEm:agora},{merge:true});gravados++;}
    const snap=await fs.collection('pcp_pedidos').get();for(const d of snap.docs){const x=d.data()||{};if(x.origem==='bluesoft'&&!vistos.has(d.id))await fs.collection('pcp_pedidos').doc(d.id).delete();}
    return {pedidos:porPedido.size,itens:gravados,produtos:gravados,gravados,falhas};
  }
  async function sincronizarPedidosCompraPendentesPcpBluesoft() {
    const {loja,fs,produtos,vinculosComprador,cfg}=await _contextoPcpBluesoft();const pedidos=await _paginarTudo('/api/compras/pedidospendentes',{},cfg,x=>x.numeroPedido),falhas=[...(pedidos.falhas||[])];
    const itensValidos=[];for(const ped of pedidos)for(const it of (ped.itens||[])){const destino=it.destinatarioKey??it.lojaKey;if(destino!=null&&String(destino)!==String(loja.bluesoft_loja_key))continue;if(it.produtoKey!=null)itensValidos.push({ped,it,pk:String(it.produtoKey)});}
    const porChave=new Map();itensValidos.forEach(x=>{if(!porChave.has(x.pk))porChave.set(x.pk,x.it);});
    // Revalida todos: uma versão anterior podia ter persistido um nome
    // não vazio, porém de outro produto. Filtrar só nomes vazios manteria
    // esse dado incorreto para sempre.
    const produtosSemNome=Array.from(porChave.keys());
    await _emLotesParalelos(produtosSemNome,async pk=>{try{const it=porChave.get(pk),p=await _obterProdutoEmbalagemVenda(pk,cfg,it?.fatorEstoque);if(!p)return;produtos.set(pk,p);produtos.set(p.canonicalKey,p);await fs.collection('pcp_produtos_bluesoft').doc('produto_'+_idSeguro(p.canonicalKey)).set({cod:p.canonicalKey,nome:p.nome,bluesoftProdutoKey:p.produtoKey,produtoUnitarioKeyBluesoft:p.produtoUnitarioKey,fatorCaixaBluesoft:p.fator,embalagemKeyBluesoft:p.embalagemKey||'',unidadeMedidaBluesoft:p.unidade,bluesoftTipoProduto:p.tipoPrincipal||null,origem:'bluesoft',atualizadoEm:new Date().toISOString()},{merge:true});}catch(e){falhas.push({produtoKey:pk,erro:'Cadastro do produto: '+(e.message||String(e))});}},1);
    const compradorKeys=[...new Set(pedidos.map(p=>String(p.compradorKey??'').trim()).filter(Boolean))],compradores=new Map();
    await _emLotesParalelos(compradorKeys,async k=>{try{const c=await _obterCompradorBluesoft(k,cfg);if(c)compradores.set(k,c);}catch(e){falhas.push({compradorKey:k,erro:'Cadastro do comprador: '+(e.message||String(e))});}},2);
    const agora=new Date().toISOString(),vistos=new Set();let gravados=0;
    for(const {ped,it,pk:pkOriginal} of itensValidos){const p=produtos.get(pkOriginal)||{};if(p.tipoPrincipal==='CONSUMO'||p.bluesoftTipoProduto==='CONSUMO')continue;const pk=String(p.canonicalKey||p.produtoKey||pkOriginal),fator=Math.max(1,Number(p.fator)||Number(it.fatorEstoque)||1),qUn=Math.max(0,Number(it.quantidadePendente)||0),q=qUn/fator;if(q<=0)continue;const buyerKey=String(ped.compradorKey??'').trim(),buyer=compradores.get(buyerKey)||{},vinculo=vinculosComprador.get(buyerKey)||{},id='bs_compra_'+_idSeguro(ped.numeroPedido)+'_'+_idSeguro(it.itemPedidoKey??pk);vistos.add(id);await fs.collection('pcp_agendamentos').doc(id).set({origem:'bluesoft',lojaId:loja.id,lojaNome:loja.nome||loja.codigo||loja.id,numeroCompra:String(ped.numeroPedido),cod:pk,prodKey:pk,produto:p.nome||('Produto '+pk),bluesoftTipoProduto:p.tipoPrincipal||p.bluesoftTipoProduto||'',fornecedor:String(ped.fornecedorKey||''),fornecedorKey:ped.fornecedorKey||null,quantidade:q,quantidadeRecebida:0,quantidadeUnidades:qUn,fatorCaixa:fator,unidade:'CX',dataPrevista:String(ped.dataEntregaInicial||ped.dataEntregaFinal||'').slice(0,10),dataEntregaFinal:ped.dataEntregaFinal||null,status:'prevista',bluesoftCompradorKey:buyerKey,bluesoftCompradorNome:buyer.nome||('Comprador '+buyerKey),compradorUid:vinculo.compradorUid||'',compradorEmail:vinculo.compradorEmail||'',compradorNome:vinculo.compradorNome||'',regraCompradorId:vinculo.regraId||'',bluesoftSincronizadoEm:agora,atualizadoEm:agora},{merge:true});gravados++;}
    const snap=await fs.collection('pcp_agendamentos').get();for(const d of snap.docs){const x=d.data()||{};if(x.origem==='bluesoft'&&!vistos.has(d.id))await fs.collection('pcp_agendamentos').doc(d.id).delete();}
    return {pedidos:pedidos.length,itens:gravados,gravados,falhas};
  }
  async function sincronizarHistoricoVendasPcpBluesoft(opcoes) {
    opcoes=opcoes||{};const {loja,fs,produtos,produtoProducaoPorAlias,cfg}=await _contextoPcpBluesoft();let fim=opcoes.dataFinal?new Date(opcoes.dataFinal+'T12:00:00'):new Date();const meses=[];for(let i=0;i<3;i++){const end=new Date(fim.getFullYear(),fim.getMonth()-i+1,0,23,59),ini=new Date(end.getFullYear(),end.getMonth(),1,0,0);meses.push({ini,end,unidades:new Map(),total:new Map()});}
    const falhas=[];for(const mes of meses){for(const status of ['ENTREGUE','FATURADO_POR_NOTA_FISCAL','FATURADO_POR_CUPOM']){try{const xs=await _paginarTudo('/api/forca-de-vendas/pedidos',{filialKey:loja.bluesoft_loja_key,pedidoVendaStatus:status,dataEmissaoInicial:_fmtDataBR(mes.ini)+' 00:00',dataEmissaoFinal:_fmtDataBR(mes.end)+' 23:59'},cfg,x=>x.pedidoForcaVendaKey);for(const ped of xs)for(const it of (ped.itens||[])){const pk=String(it.produtoKey??'').trim();if(pk)mes.unidades.set(pk,(mes.unidades.get(pk)||0)+Math.max(0,Number(it.quantidadePedida)||0));}}catch(e){falhas.push({mes:_fmtDataBR(mes.ini),status,erro:e.message||String(e)});}}}
    const chavesOriginais=new Set(meses.flatMap(m=>Array.from(m.unidades.keys()))),chavesSemNome=Array.from(chavesOriginais);await _emLotesParalelos(chavesSemNome,async pk=>{try{const p=await _obterProdutoEmbalagemVenda(pk,cfg,produtos.get(pk)?.fator);if(!p)return;produtos.set(pk,p);produtos.set(p.canonicalKey,p);await fs.collection('pcp_produtos_bluesoft').doc('produto_'+_idSeguro(p.canonicalKey)).set({cod:p.canonicalKey,nome:p.nome,bluesoftProdutoKey:p.produtoKey,produtoUnitarioKeyBluesoft:p.produtoUnitarioKey,fatorCaixaBluesoft:p.fator,embalagemKeyBluesoft:p.embalagemKey||'',unidadeMedidaBluesoft:p.unidade,bluesoftTipoProduto:p.tipoPrincipal||null,origem:'bluesoft',atualizadoEm:new Date().toISOString()},{merge:true});}catch(e){falhas.push({produtoKey:pk,erro:'Cadastro do produto: '+(e.message||String(e))});}},1);
    meses.forEach(m=>m.unidades.forEach((un,pkOriginal)=>{const p=produtos.get(pkOriginal)||{},pk=String(p.canonicalKey||p.produtoKey||pkOriginal),f=Math.max(1,Number(p.fator)||1);m.total.set(pk,(m.total.get(pk)||0)+(un/f));}));
    const keys=new Set(meses.flatMap(m=>Array.from(m.total.keys()))),snap=await fs.collection('producao_projecao').get(),porCod=new Map();snap.docs.forEach(d=>{const x=d.data()||{};porCod.set(String(x.cod??''),d.id);});const agora=new Date().toISOString();let gravados=0;for(const pk of keys){const api=produtos.get(pk)||{},base=produtoProducaoPorAlias.get(pk)||produtoProducaoPorAlias.get(String(api.canonicalKey||''))||produtoProducaoPorAlias.get(String(api.produtoKey||''));if(!base)continue;const cod=String(base.cod??pk),payload={cod,produto:base.nome||base.descricao||base.desc||api.nome||('Produto '+cod),venda_m1:meses[0].total.get(pk)||0,venda_m2:meses[1].total.get(pk)||0,venda_m3:meses[2].total.get(pk)||0,historicoVendasMeses:meses.map(m=>m.ini.toISOString().slice(0,7)),historicoVendasSincronizadoEm:agora,atualizadoEm:agora};const id=porCod.get(cod);if(id)await fs.collection('producao_projecao').doc(id).set(payload,{merge:true});else await fs.collection('producao_projecao').add({...payload,criadoEm:agora});gravados++;}return {gravados,falhas,meses:meses.map(m=>m.ini.toISOString().slice(0,7))};
  }

  // Versão corrigida: M1 é sempre o mês disponível mais recente. Em bases
  // de homologação defasadas não grava dois meses zerados (calendário atual)
  // e um único mês antigo; recua até encontrar três meses com vendas reais.
  async function sincronizarHistoricoVendasPcpBluesoftCorrigido(opcoes) {
    opcoes=opcoes||{};
    const {loja,fs,produtos,produtoProducaoPorAlias,cfg}=await _contextoPcpBluesoft();
    if(!loja?.bluesoft_loja_key)throw new Error('Loja sem vínculo BlueSoft.');
    const limite=opcoes.dataFinal?new Date(opcoes.dataFinal+'T12:00:00'):new Date();
    // Sem data manual, começa pelo último mês encerrado. Com data manual,
    // considera o mês escolhido pelo usuário como possível M1.
    const inicioOffset=opcoes.dataFinal?0:1,meses=[],falhas=[];
    for(let offset=inicioOffset;offset<inicioOffset+15&&meses.length<3;offset++){
      const ini=new Date(limite.getFullYear(),limite.getMonth()-offset,1,0,0);
      const end=new Date(ini.getFullYear(),ini.getMonth()+1,0,23,59);
      const unidades=new Map();
      for(const status of ['ENTREGUE','FATURADO_POR_NOTA_FISCAL','FATURADO_POR_CUPOM']){
        try{
          const xs=await _paginarTudo('/api/forca-de-vendas/pedidos',{filialKey:loja.bluesoft_loja_key,pedidoVendaStatus:status,dataEmissaoInicial:_fmtDataBR(ini)+' 00:00',dataEmissaoFinal:_fmtDataBR(end)+' 23:59'},cfg,x=>x.pedidoForcaVendaKey);
          for(const ped of xs)for(const it of (ped.itens||[])){const pk=String(it.produtoKey??'').trim();if(pk)unidades.set(pk,(unidades.get(pk)||0)+Math.max(0,Number(it.quantidadePedida)||0));}
        }catch(e){falhas.push({mes:_fmtDataBR(ini),status,erro:e.message||String(e)});}
      }
      if(unidades.size)meses.push({ini,end,unidades,total:new Map()});
    }
    while(meses.length<3){const base=meses[meses.length-1]?.ini||limite,ini=new Date(base.getFullYear(),base.getMonth()-1,1);meses.push({ini,end:new Date(ini.getFullYear(),ini.getMonth()+1,0),unidades:new Map(),total:new Map()});}
    const chavesOriginais=new Set(meses.flatMap(m=>Array.from(m.unidades.keys())));
    await _emLotesParalelos(Array.from(chavesOriginais),async pk=>{try{const p=await _obterProdutoEmbalagemVenda(pk,cfg,produtos.get(pk)?.fator);if(!p)return;produtos.set(pk,p);produtos.set(p.canonicalKey,p);await fs.collection('pcp_produtos_bluesoft').doc('produto_'+_idSeguro(p.canonicalKey)).set({cod:p.canonicalKey,nome:p.nome,bluesoftProdutoKey:p.produtoKey,produtoUnitarioKeyBluesoft:p.produtoUnitarioKey,fatorCaixaBluesoft:p.fator,embalagemKeyBluesoft:p.embalagemKey||'',unidadeMedidaBluesoft:p.unidade,bluesoftTipoProduto:p.tipoPrincipal||null,origem:'bluesoft',atualizadoEm:new Date().toISOString()},{merge:true});}catch(e){falhas.push({produtoKey:pk,erro:'Cadastro do produto: '+(e.message||String(e))});}},1);
    meses.forEach(m=>m.unidades.forEach((un,pkOriginal)=>{const p=produtos.get(pkOriginal)||{},pk=String(p.canonicalKey||p.produtoKey||pkOriginal),f=Math.max(1,Number(p.fator)||1);m.total.set(pk,(m.total.get(pk)||0)+(un/f));}));
    const keys=new Set(meses.flatMap(m=>Array.from(m.total.keys()))),snap=await fs.collection('producao_projecao').get(),porCod=new Map();
    snap.docs.forEach(d=>{const x=d.data()||{};porCod.set(String(x.cod??''),d.id);});
    const agora=new Date().toISOString(),labels=meses.map(m=>m.ini.toISOString().slice(0,7));let gravados=0;
    for(const pk of keys){const api=produtos.get(pk)||{},base=produtoProducaoPorAlias.get(pk)||produtoProducaoPorAlias.get(String(api.canonicalKey||''))||produtoProducaoPorAlias.get(String(api.produtoKey||''));if(!base)continue;const cod=String(base.cod??pk),payload={cod,produto:base.nome||base.descricao||base.desc||api.nome||('Produto '+cod),venda_m1:meses[0].total.get(pk)||0,venda_m2:meses[1].total.get(pk)||0,venda_m3:meses[2].total.get(pk)||0,historicoVendasMeses:labels,historicoVendasSincronizadoEm:agora,atualizadoEm:agora};const id=porCod.get(cod);if(id)await fs.collection('producao_projecao').doc(id).set(payload,{merge:true});else await fs.collection('producao_projecao').add({...payload,criadoEm:agora});gravados++;}
    return {gravados,falhas,meses:labels};
  }
  sincronizarHistoricoVendasPcpBluesoft=sincronizarHistoricoVendasPcpBluesoftCorrigido;
  global.sincronizarPedidosVendaPcpBluesoft=sincronizarPedidosVendaPcpBluesoft;
  global.sincronizarPedidosCompraPendentesPcpBluesoft=sincronizarPedidosCompraPendentesPcpBluesoft;
  global.sincronizarHistoricoVendasPcpBluesoft=sincronizarHistoricoVendasPcpBluesoft;

  // Busca geral do PCP/Compras: percorre todas as lojas vinculadas sem
  // disparar troca visual de loja. Cada função continua gravando na
  // subcoleção correta; ao terminar, a seleção original é restaurada.
  async function sincronizarTodasLojasPcpBluesoft(opcoes) {
    opcoes=opcoes||{};const rawFs=raw(),snap=await rawFs.collection('lojas').get();
    const lojas=snap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>l.ativa!==false&&l.bluesoft_loja_key);
    const chave=global.DT_LOJA_KEY||'dt_loja_ativa_v1',original=global.getDTLojaAtiva?.()||'';
    const totais={lojas:0,produtos:0,estoques:0,insumos:0,pedidosVenda:0,pedidosCompra:0,historicos:0,falhas:[]};
    try{
      for(let i=0;i<lojas.length;i++){
        const loja=lojas[i];localStorage.setItem(chave,loja.id);opcoes.onEtapa?.(i+1,lojas.length,loja.nome||loja.codigo||loja.id);
        try{const p=await sincronizarProdutosBluesoft({tipos:['PRODUTO_ACABADO','VENDA','INSUMO','EMBALAGEM']});totais.produtos+=p.gravados??p.total??0;}catch(e){totais.falhas.push({loja:loja.id,etapa:'Produtos',erro:e.message||String(e)});}
        try{const s=await sincronizarEstoqueBluesoft({});totais.estoques+=s.total??s.atualizados??0;}catch(e){totais.falhas.push({loja:loja.id,etapa:'Estoque',erro:e.message||String(e)});}
        try{const x=await sincronizarInsumosBluesoft({});totais.insumos+=x.comEstoque??x.gravados??0;}catch(e){totais.falhas.push({loja:loja.id,etapa:'Insumos',erro:e.message||String(e)});}
        try{const v=await sincronizarPedidosVendaPcpBluesoft({});totais.pedidosVenda+=v.produtos??v.itens??0;}catch(e){totais.falhas.push({loja:loja.id,etapa:'Pedidos de clientes',erro:e.message||String(e)});}
        try{const c=await sincronizarPedidosCompraPendentesPcpBluesoft({});totais.pedidosCompra+=c.itens??0;}catch(e){totais.falhas.push({loja:loja.id,etapa:'Pedidos de fornecedores',erro:e.message||String(e)});}
        try{const h=await sincronizarHistoricoVendasPcpBluesoft(opcoes.dataFinal?{dataFinal:opcoes.dataFinal}:{});totais.historicos+=h.gravados??0;}catch(e){totais.falhas.push({loja:loja.id,etapa:'Histórico',erro:e.message||String(e)});}
        totais.lojas++;
      }
    } finally {if(original)localStorage.setItem(chave,original);else localStorage.removeItem(chave);}
    return totais;
  }
  global.sincronizarTodasLojasPcpBluesoft=sincronizarTodasLojasPcpBluesoft;

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
  // PEDIDO AO VIVO (2026-08-24): sem período explícito, continua buscando
  // TODOS os pedidos de entrega pendente (sem filtro de data — como já era)
  // — mas o usuário quer poder restringir a uma janela específica (ex.:
  // testando contra uma cópia de homologação datada de junho, onde uma
  // busca sem filtro pode incluir/excluir coisa inesperada dependendo de
  // como a Bluesoft trata período ausente).
  async function sincronizarAgendaBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const lojaKey = loja.bluesoft_loja_key;
    const filtrosPedidos = { lojaKey };
    if (opcoes.dataInicial || opcoes.dataFinal) {
      const periodo = _resolverPeriodoBluesoft(opcoes);
      filtrosPedidos.dataEntregaInicial = _fmtDataBR(periodo.inicio);
      filtrosPedidos.dataEntregaFinal = _fmtDataBR(periodo.fim);
    }

    const [pedidos, fornecedores, pcpSnap] = await Promise.all([
      obterPedidosCompraBluesoft(filtrosPedidos),
      obterFornecedoresBluesoft(false),
      (async()=>{
        const col=global.getDTFirestore().collection('pcp_agendamentos');
        try{return await col.where('origem','==','bluesoft').get();}
        catch(e){console.warn('[Bluesoft] Filtro de origem em PCP indisponível; usando fallback completo:',e?.message||e);return col.get().catch(()=>({docs:[]}));}
      })(),
    ]);
    const fornecedorPorKey = new Map(fornecedores.map(f => [f.fornecedorKey, f.nome]));
    // Compras/PCP usa /api/compras/pedidospendentes, que é a fonte que
    // efetivamente devolve os pedidos ainda abertos nesta instalação. A
    // Agenda antiga consultava só /pedidos-de-compra e podia dizer "0"
    // mesmo com a tela de Recebimentos cheia. Reaproveita os documentos já
    // sincronizados e agrupa os vários itens numa única carga por pedido.
    const porPedidoPcp=new Map();
    pcpSnap.docs.forEach(d=>{const x=d.data()||{};if(x.origem!=='bluesoft'||!x.numeroCompra||/final|cancel/i.test(String(x.status||'')))return;const numero=String(x.numeroCompra),a=porPedidoPcp.get(numero)||{numeroPedido:numero,lojaId:x.lojaId||loja.id,lojaNome:x.lojaNome||loja.nome||loja.codigo||loja.id,fornecedorKey:x.fornecedorKey||x.fornecedor||'',fornecedorNome:x.fornecedorNome||'',dataEntregaInicial:x.dataPrevista||'',dataEntregaFinal:x.dataEntregaFinal||null,entregaPendente:true,compradorNome:x.compradorNome||x.bluesoftCompradorNome||'',itens:[]};a.itens.push({produto:x.produto||'',tipoProduto:x.bluesoftTipoProduto||x.tipoProduto||'',quantidadePendente:Math.max(0,Number(x.quantidade||0)-Number(x.quantidadeRecebida||0))});if(!a.compradorNome)a.compradorNome=x.compradorNome||x.bluesoftCompradorNome||'';porPedidoPcp.set(numero,a);});
    const pedidosPcp=[...porPedidoPcp.values()],fontePedidos=pedidosPcp.length?pedidosPcp:pedidos;
    const pendentes = fontePedidos.filter(p => p.entregaPendente && p.numeroPedido != null);
    const { criados, atualizados } = await _gravarAgendaPendentes(pendentes, loja, fornecedorPorKey);
    // totalPedidos (sem filtro nenhum) ajuda a diferenciar duas situações
    // que dão "0 pendente" mas são bem diferentes: totalPedidos:0 quer dizer
    // que a loja não tem NENHUM Pedido de Compra na Bluesoft (não usa esse
    // módulo — provavelmente lança nota direto, sem PO — o que também
    // explica toda nota aparecer "sem comparação" na Divergência, já que os
    // dois dependem do mesmo dado); totalPedidos > 0 com pendentes:0 quer
    // dizer que a loja usa Pedido de Compra só que está tudo já entregue.
    return { totalPedidos: fontePedidos.length, totalPedidosPendentes: pendentes.length, criados, atualizados, fonte:pedidosPcp.length?'pcp_agendamentos':'pedidos-de-compra', falhas: pedidos.falhas || [] };
  }
  // Extraído de sincronizarAgendaBluesoft pra ser reaproveitado pelo import
  // direto do BI (compras_a_receber.json — ver importarComprasAReceberBiJson
  // mais abaixo): MESMO shape de `pendentes` ({numeroPedido, lojaId,
  // lojaNome, fornecedorNome|fornecedorKey, dataEntregaInicial,
  // dataEntregaFinal, compradorNome, itens}), MESMA lógica de merge — só
  // muda de onde `pendentes` veio (API da Bluesoft, ou JSON do BI).
  async function _gravarAgendaPendentes(pendentes, loja, fornecedorPorKey) {
    fornecedorPorKey = fornecedorPorKey || new Map();
    const fs = global.getDTFirestore();
    const rawFs = raw();
    const listaPendentes = Array.isArray(pendentes) ? pendentes : [];
    if (!listaPendentes.length) return { criados: 0, atualizados: 0 };

    // Não varrer a Agenda inteira só para saber quais pedidos desta sincronização
    // já existem. Busca somente os números recebidos agora, em lotes compatíveis
    // com o operador `in`; se o ambiente/índice não suportar a consulta, mantém
    // o full-scan antigo como fallback para não alterar o comportamento.
    const numeros = [...new Set(listaPendentes.map(p => p && p.numeroPedido != null ? String(p.numeroPedido) : '').filter(Boolean))];
    const docPorNumeroPedido = new Map();
    try {
      for (let i = 0; i < numeros.length; i += 10) {
        const loteNumeros = numeros.slice(i, i + 10);
        const snap = await fs.collection('recebimento_agendamentos').where('numeroPedido', 'in', loteNumeros).get();
        snap.docs.forEach(d => { const x = d.data() || {}; if (x.numeroPedido != null) docPorNumeroPedido.set(String(x.numeroPedido), {id:d.id,dados:x}); });
      }
    } catch (e) {
      console.warn('[Bluesoft] Consulta direcionada da Agenda indisponível; usando fallback completo:', e?.message || e);
      const snap = await fs.collection('recebimento_agendamentos').get();
      snap.docs.forEach(d => { const x = d.data() || {}; if (x.numeroPedido != null) docPorNumeroPedido.set(String(x.numeroPedido), {id:d.id,dados:x}); });
    }

    const agora = new Date().toISOString();
    let criados = 0, atualizados = 0;
    for (let i = 0; i < listaPendentes.length; i += 300) {
      const lote = listaPendentes.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(p => {
        const fornecedorNome = p.fornecedorNome || fornecedorPorKey.get(p.fornecedorKey) || ('Fornecedor ' + p.fornecedorKey);
        const dataPrevista = p.dataEntregaInicial ? String(p.dataEntregaInicial).slice(0, 10) : '';
        const existente = docPorNumeroPedido.get(String(p.numeroPedido));
        if (existente) {
          const limparPrevisaoAntiga = existente.dados.origem==='bluesoft' && !existente.dados.agendamentoConfirmadoManual;
          batch.set(fs.collection('recebimento_agendamentos').doc(existente.id), {
            origem: 'bluesoft', lojaId:p.lojaId||loja.id, lojaNome:p.lojaNome||loja.nome||loja.codigo||loja.id, numeroPedido: p.numeroPedido, fornecedorNome, dataPrevista,
            ...(limparPrevisaoAntiga?{dataAgendada:''}:{}), dataEntregaFinal: p.dataEntregaFinal || null, compradorNome:p.compradorNome||'', itensPedido:p.itens||[], bluesoftSincronizadoEm: agora, atualizadoEm: agora,
          }, { merge: true });
          atualizados++;
        } else {
          batch.set(fs.collection('recebimento_agendamentos').doc(), {
            origem: 'bluesoft', lojaId:p.lojaId||loja.id, lojaNome:p.lojaNome||loja.nome||loja.codigo||loja.id, numeroPedido: p.numeroPedido, fornecedorNome, dataPrevista, dataAgendada:'', compradorNome:p.compradorNome||'', itensPedido:p.itens||[],
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
    return { criados, atualizados };
  }

  // PEDIDO AO VIVO (2026-08-26): mesmo padrão de "conecta a pasta do BI uma
  // vez, clica em Buscar" das outras telas — compras_a_receber.json é uma
  // linha por ENTREGA (parcela) de um pedido_key, podendo ter várias
  // entregas E vários produtos pro mesmo pedido; agrupa tudo por pedido
  // antes de gravar (data prevista = mínima data_entrega_inicial entre as
  // entregas pendentes, data final = máxima data_entrega_final, itens
  // somados por produto).
  function _agruparComprasAReceberBiPorPedido(itens, lojaKeyFiltro) {
    const porPedido = new Map();
    itens.forEach(it => {
      if (lojaKeyFiltro != null && String(it.loja_key) !== String(lojaKeyFiltro)) return;
      const pendente = Number(it.qtd_unidades_pendentes) || 0;
      if (pendente <= 0) return;
      const numeroPedido = it.pedido_key != null ? String(it.pedido_key) : '';
      if (!numeroPedido) return;
      if (!porPedido.has(numeroPedido)) {
        porPedido.set(numeroPedido, { numeroPedido, fornecedorNome: it.fornecedor || '', compradorNome: it.comprador || '', dataEntregaInicial: '', dataEntregaFinal: '', itensPorProduto: new Map() });
      }
      const pedido = porPedido.get(numeroPedido);
      const dataIni = it.data_entrega_inicial ? String(it.data_entrega_inicial).slice(0, 10) : '';
      const dataFim = it.data_entrega_final ? String(it.data_entrega_final).slice(0, 10) : '';
      if (dataIni && (!pedido.dataEntregaInicial || dataIni < pedido.dataEntregaInicial)) pedido.dataEntregaInicial = dataIni;
      if (dataFim && (!pedido.dataEntregaFinal || dataFim > pedido.dataEntregaFinal)) pedido.dataEntregaFinal = dataFim;
      const chaveProduto = it.produto_key != null ? String(it.produto_key) : (it.descricao || '');
      const atual = pedido.itensPorProduto.get(chaveProduto) || { produto: it.descricao || '', tipoProduto: '', quantidadePendente: 0 };
      atual.quantidadePendente += pendente;
      pedido.itensPorProduto.set(chaveProduto, atual);
    });
    return [...porPedido.values()].map(p => ({
      numeroPedido: p.numeroPedido, fornecedorNome: p.fornecedorNome, compradorNome: p.compradorNome,
      entregaPendente: true, dataEntregaInicial: p.dataEntregaInicial, dataEntregaFinal: p.dataEntregaFinal,
      itens: [...p.itensPorProduto.values()],
    }));
  }

  async function importarComprasAReceberBiJson(registros) {
    if (!Array.isArray(registros)) throw new Error('Formato inesperado — esperava uma lista de registros.');
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    const lojaKey = loja.bluesoft_loja_key != null ? loja.bluesoft_loja_key : null;
    const pendentes = _agruparComprasAReceberBiPorPedido(registros, lojaKey);
    if (!pendentes.length) throw new Error('Nenhum pedido de compra pendente encontrado' + (lojaKey != null ? ' para esta loja (loja_key ' + lojaKey + ' na Bluesoft).' : '.'));
    const { criados, atualizados } = await _gravarAgendaPendentes(pendentes, loja);
    return { totalPedidosPendentes: pendentes.length, criados, atualizados };
  }
  global.sincronizarAgendaBluesoft = sincronizarAgendaBluesoft;
  global.importarComprasAReceberBiJson = importarComprasAReceberBiJson;
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
  // PEDIDO AO VIVO: "não precisa buscar vários milhares de SKUs, só buscar
  // o que tem estoque... e caso tenha saldo zero mas tenha pedido de venda
  // pendente, trazer também" — a versão antiga buscava o CATÁLOGO INTEIRO
  // (todos os tipos pedidos, sem filtro de estoque — inclui produto fora
  // de linha há anos) e só DEPOIS cruzava com o estoque, jogando fora quem
  // não tinha estoque. Isso multiplicava o número de páginas buscadas na
  // Bluesoft (catálogo inteiro inteiro + estoque inteiro) — bem mais
  // exposto à instabilidade da Bluesoft do que uma busca de notas com
  // período filtrado (que já funciona em Recebimento/Recusas). Invertido:
  // busca o ESTOQUE primeiro (obterEstoqueBluesoft já aplica exatamente o
  // critério pedido via _estoqueRelevante — saldo diferente de zero OU
  // pedido de venda pendente represado OU trânsito), e só busca detalhe de
  // catálogo (nome/tipo/GTIN/fornecedor) PRODUTO A PRODUTO, um lookup
  // targetado só pra quem tem estoque relevante — mesmo padrão já usado e
  // comprovado em Notas Retornadas (nunca varre o catálogo inteiro pra
  // completar descrição de item).
  async function sincronizarProdutosBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const cfg = await _config();
    const resultadoEstoque = await obterEstoqueBluesoft(loja, true, { onProgresso: opcoes.onProgresso });
    const tiposAlvo = new Set((opcoes.tipos && opcoes.tipos.length) ? opcoes.tipos : ['PRODUTO_ACABADO', 'VENDA']);
    const produtoPorKey = new Map();
    const falhasLookup = [];
    await _emLotesParalelos(resultadoEstoque.itens, async e => {
      try {
        const produto = await _obterProdutoEmbalagemVenda(e.produtoKey, cfg, e.fatorEstoque);
        produtoPorKey.set(e.produtoKey, produto || { produtoKey: e.produtoKey, cod: String(e.produtoKey), nome: e.descricaoProduto||'', unidade: '', gtin: '', status: 'ATIVO', categoria: '', fornecedorPadraoKey: null, fornecedorPadraoNome: '', multiploCompraSugerido: null, tipoPrincipal: '' });
      } catch (err) {
        falhasLookup.push({ produtoKey: e.produtoKey, erro: err.message || String(err) });
        // Produto com estoque real confirmado mas cujo detalhe de catálogo
        // falhou ainda entra (sem nome/tipo) — a alternativa (sumir) recria
        // exatamente a queixa "não traz todas as matérias-primas/embalagens".
        produtoPorKey.set(e.produtoKey, { produtoKey: e.produtoKey, cod: String(e.produtoKey), nome: '', unidade: '', gtin: '', status: 'ATIVO', categoria: '', fornecedorPadraoKey: null, fornecedorPadraoNome: '', multiploCompraSugerido: null, tipoPrincipal: '' });
      }
    });
    const catalogoBruto = Array.from(produtoPorKey.values());
    // Item sem tipo reconhecido (lookup falhou, ou a Bluesoft não marcou
    // nenhuma flag de tipoProduto) ainda assim fica visível — só o tipo
    // pedido explicitamente filtra fora quem TEM um tipo diferente do
    // pedido; nunca filtra fora quem não tem tipo nenhum.
    const catalogo = catalogoBruto.filter(p => !p.tipoPrincipal || tiposAlvo.has(p.tipoPrincipal));
    const falhas = (resultadoEstoque.falhas || []).map(f => ({ tipo: '(estoque)', erro: f.erro })).concat(falhasLookup.map(f => ({ tipo: 'produtoKey ' + f.produtoKey, erro: f.erro })));
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
          fatorCaixaBluesoft: p.fatorEstoque, produtoUnitarioKeyBluesoft: p.produtoUnitarioKey,
          embalagemKeyBluesoft: p.embalagemKey || '', caixaBluesoft: p.caixa,
          bluesoftSincronizadoEm: agora, atualizadoEm: agora, atualizadoPor: autor,
        };
        // Pré-preenche múltiplo de compra só se o PCP ainda não configurou
        // nada (nunca sobrescreve um valor já cadastrado manualmente).
        if (p.multiploCompraSugerido && !(existente && Number(existente.multiploCompra) > 0)) {
          payload.multiploCompra = p.multiploCompraSugerido;
        }
        const pcpProdutosCol=fs.collection('pcp_produtos_bluesoft');
        if(typeof pcpProdutosCol.doc==='function')batch.set(pcpProdutosCol.doc('produto_'+_idSeguro(p.cod)), { ...payload, cod:p.cod, origem:'bluesoft' }, { merge:true });
        if (docId) {
          batch.set(fs.collection('producao_produtos').doc(docId), payload, { merge: true });
          atualizados++;
        } else criados++; // criado somente no catálogo auxiliar do PCP
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
    const chavesAtuais = new Set(catalogo.map(p => String(p.produtoKey)));
    const alvosRemocao = [];
    // PEDIDO AO VIVO (correção de segurança, achada revisando o mesmo bug):
    // se a busca veio INCOMPLETA (falhas.length>0 — página de estoque ou
    // lookup de produto que não voltou), um produto que só não apareceu
    // por causa dessa falha NÃO pode ser confundido com "perdeu o estoque
    // de verdade" e ser apagado. Reconciliação só roda numa busca que
    // terminou sem nenhuma falha registrada — senão, cada tentativa que
    // esbarra numa instabilidade da Bluesoft piora a base em vez de só
    // deixar de atualizar.
    if (!falhas.length) {
      docs.forEach((x, id) => {
        if (x.bluesoftProdutoKey == null) return;
        if (!tiposAlvo.has(x.bluesoftTipoProduto)) return;
        if (chavesAtuais.has(String(x.bluesoftProdutoKey))) return;
        if (_produtoProtegidoPcp(x)) return;
        alvosRemocao.push(id);
      });
    }
    let removidos = 0;
    for (let i = 0; i < alvosRemocao.length; i += 300) {
      const lote = alvosRemocao.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(id => batch.delete(fs.collection('producao_produtos').doc(id)));
      await batch.commit();
      removidos += lote.length;
    }
    _invalidarCachesDependentes();
    return { totalCatalogo: resultadoEstoque.itens.length, comEstoque: catalogo.length, total: catalogo.length, criados, atualizados, removidos, falhas };
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
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    const fs = global.getDTFirestore();
    const rawFs = raw();
    const [resultadoEstoque, produtosSnap, pcpProdutosSnap] = await Promise.all([
      obterEstoqueBluesoft(loja, true, { onProgresso: opcoes.onProgresso }),
      fs.collection('producao_produtos').get(),
      fs.collection('pcp_produtos_bluesoft').get().catch(()=>({docs:[]})),
    ]);
    const itensEstoque = resultadoEstoque.itens;
    const nomesPorCod = new Map(), fatoresPorCod=new Map(), canonicalPorCod=new Map(), tiposPorCod=new Map();
    pcpProdutosSnap.docs.forEach(d=>{const x=d.data()||{},k=String(x.cod??x.bluesoftProdutoKey??'').trim();if(k){nomesPorCod.set(k,x.nome||'');fatoresPorCod.set(k,Math.max(1,Number(x.fatorCaixaBluesoft)||1));tiposPorCod.set(k,String(x.bluesoftTipoProduto||x.tipoPrincipal||'').toUpperCase());canonicalPorCod.set(k,k);const unit=String(x.produtoUnitarioKeyBluesoft??'').trim();if(unit){canonicalPorCod.set(unit,k);tiposPorCod.set(unit,tiposPorCod.get(k)||'');}}});
    const produtoProducaoPorAlias=new Map();
    produtosSnap.docs.forEach(d => { const x = d.data() || {}; if (x.cod != null){const k=String(x.cod).trim();nomesPorCod.set(k,x.nome||x.descricao||'');fatoresPorCod.set(k,Math.max(1,Number(x.unid)||Number(x.fatorCaixaBluesoft)||1));[x.cod,x.bluesoftProdutoKey,x.produtoUnitarioKeyBluesoft,x.produtoUnitarioKey].forEach(a=>{a=String(a??'').trim();if(a)produtoProducaoPorAlias.set(a,{id:d.id,...x,cod:k});});} });
    // A sincronização de estoque também precisa funcionar quando a etapa de
    // catálogo foi parcial ou não foi executada antes. Resolve somente os
    // itens relevantes ainda sem vínculo/nome e registra todos os aliases
    // (embalagem comercial e produto unitário) antes de gravar os saldos.
    // Assim a descrição e o estoque sempre chegam ao mesmo documento.
    // Revalida todos os itens relevantes nesta rodada para também reparar
    // nomes incorretos persistidos por versões anteriores.
    const semVinculo=itensEstoque;
    const enriquecidos=[];
    await _emLotesParalelos(semVinculo,async e=>{
      const original=String(e.produtoKey??e.cod??'').trim();if(!original)return;
      try{const p=await _obterProdutoEmbalagemVenda(original,await _config(),e.fatorEstoque);if(p)enriquecidos.push(p);}catch(err){/* saldo continua sendo gravado com o dado local */}
    },1);
    for(const p of enriquecidos){
      const canon=String(p.canonicalKey||p.produtoKey||'').trim();if(!canon)continue;
      [canon,p.produtoKey,p.produtoUnitarioKey].forEach(a=>{a=String(a??'').trim();if(a)canonicalPorCod.set(a,canon);});
      nomesPorCod.set(canon,p.nome||'');fatoresPorCod.set(canon,Math.max(1,Number(p.fator)||1));tiposPorCod.set(canon,String(p.tipoPrincipal||'').toUpperCase());
      await fs.collection('pcp_produtos_bluesoft').doc('produto_'+_idSeguro(canon)).set({cod:canon,nome:p.nome||'',bluesoftProdutoKey:p.produtoKey,produtoUnitarioKeyBluesoft:p.produtoUnitarioKey??null,fatorCaixaBluesoft:Math.max(1,Number(p.fator)||1),embalagemKeyBluesoft:p.embalagemKey||'',unidadeMedidaBluesoft:p.unidade||'',bluesoftTipoProduto:p.tipoPrincipal||null,origem:'bluesoft',atualizadoEm:new Date().toISOString()},{merge:true});
    }
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
        const codOriginal=String(e.cod),cod=canonicalPorCod.get(codOriginal)||codOriginal;
        if(tiposPorCod.get(cod)==='CONSUMO'||tiposPorCod.get(codOriginal)==='CONSUMO')return;
        const unidades=e.estoqueAtualUnidades ?? (e.estoqueAtual*(e.fatorEstoque||1)),fator=Math.max(1,Number(fatoresPorCod.get(cod))||Number(e.fatorEstoque)||1);
        const payload = { estoqueAtual: unidades/fator, estoqueAtualUnidades: unidades, fatorCaixa: fator, unidadeExibicao:'CX', bluesoftSincronizadoEm: agora, atualizadoEm: agora, atualizadoPor: autor };
        if (e.estoqueReservado != null) payload.estoqueReservado = e.estoqueReservado;
        if (e.estoqueEmTransito != null) payload.estoqueEmTransito = e.estoqueEmTransito;
        if (e.pedidosVendaPendentes != null) payload.estoqueReservadoVenda = e.pedidosVendaPendentes;
        if (e.custoUltimaCompra != null) payload.custoUltimaCompra = e.custoUltimaCompra;
        if (e.custoMedioContabil != null) payload.custoMedioContabil = e.custoMedioContabil;
        if (e.consumoDiaMedio != null) payload.consumoDiaMedioBluesoft = e.consumoDiaMedio;
        // PCP/Compras recebem todo o estoque relevante. Produção recebe
        // somente códigos já aprovados no Cadastro de Produtos da loja.
        const pcpEstoqueCol=fs.collection('pcp_estoque_bluesoft');
        if(typeof pcpEstoqueCol.doc==='function')batch.set(pcpEstoqueCol.doc('produto_'+_idSeguro(cod)), { ...payload, cod, produto:nomesPorCod.get(cod)||e.descricaoProduto||('Produto '+cod), produtoUnitarioKey:e.produtoUnitarioKey??codOriginal, origem:'bluesoft' }, { merge:true });
        const base=produtoProducaoPorAlias.get(cod)||produtoProducaoPorAlias.get(codOriginal)||produtoProducaoPorAlias.get(String(e.produtoUnitarioKey??''));
        if (base) {
          const codProducao=String(base.cod),docId=porCod.get(codProducao);
          const dadosProducao={...payload,cod:codProducao,produto:base.nome||base.descricao||base.desc||nomesPorCod.get(cod)||e.descricaoProduto||('Produto '+codProducao)};
          if(docId){batch.set(fs.collection('producao_projecao').doc(docId),dadosProducao,{merge:true});atualizados++;}
          else if(typeof fs.collection('producao_projecao').doc==='function'){batch.set(fs.collection('producao_projecao').doc(),{...dadosProducao,criadoEm:agora},{merge:true});criados++;}
        }
      });
      await batch.commit();
    }
    // Reconciliação (fase 12h) — a busca de estoque não é filtrada por tipo
    // (traz tudo que é relevante pra loja de uma vez), então qualquer doc já
    // sincronizado antes que não voltou nesta rodada perdeu a relevância de
    // verdade (zerou e sem pedido pendente) — remove pra não acumular ruído
    // que trava as telas do PCP.
    // PEDIDO AO VIVO (correção de segurança): se `obterEstoqueBluesoft`
    // registrou falhas (página que não voltou mesmo após tentar de novo),
    // a busca está INCOMPLETA — um produto que só não apareceu por causa
    // dessa falha não pode ser confundido com "zerou de verdade" e ser
    // apagado da base. Só reconcilia numa busca sem nenhuma falha.
    const chavesAtuais = new Set(itensEstoque.map(e => canonicalPorCod.get(String(e.cod))||String(e.cod)).filter(c=>tiposPorCod.get(c)!=='CONSUMO'));
    const alvosRemocao = [];
    if (!(resultadoEstoque.falhas || []).length) {
      docsProjecao.forEach((x, id) => {
        if (!x.bluesoftSincronizadoEm) return;
        if (x.cod != null && chavesAtuais.has(String(x.cod))) return;
        if (_projecaoTemDadoManual(x)) return;
        alvosRemocao.push(id);
      });
    }
    let removidos = 0;
    for (let i = 0; i < alvosRemocao.length; i += 300) {
      const lote = alvosRemocao.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(id => batch.delete(fs.collection('producao_projecao').doc(id)));
      await batch.commit();
      removidos += lote.length;
    }
    _invalidarCachesDependentes();
    return { total: itensEstoque.length, totalRecebido: resultadoEstoque.totalRecebido, rotaSimplificada: resultadoEstoque.rotaSimplificada, criados, atualizados, removidos, falhas: resultadoEstoque.falhas || [], lojaNome: loja.nome || loja.codigo || lojaId };
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
  function _canonInsumo(v){return normUpper(v).replace(/^\s*\d+\s*[-–—.:/]?\s*/,'').replace(/^\s*(MP|MAT(?:ERIA)?\s*PRIMA|MATERIA\s*PRIMA|LOGISTICA)\s*[-–—.:/]\s*/,'').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
  async function _nomesInsumosUsados() {
    const fs = global.getDTFirestore();
    const snap = await fs.collection('producao_ficha_tecnica').get();
    const nomes = new Set(), codigos = new Set();
    snap.docs.forEach(d => { (d.data()?.insumos || []).forEach(i => { if (i.insumo){nomes.add(normUpper(i.insumo));nomes.add(_canonInsumo(i.insumo));}const k=i.bluesoftProdutoKey??i.produtoKey??i.cod??i.codigo;if(k!=null&&String(k).trim())codigos.add(String(k).trim()); }); });
    return {nomes,codigos};
  }
  async function sincronizarInsumosBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
    // A etapa Produtos, executada imediatamente antes desta, já deixou no
    // catálogo auxiliar somente os produtos com posição relevante e todos
    // os dados necessários (nome, código, tipo e unidade). Reutilizar esse
    // catálogo evita varrer novamente TODO /api/comercial/produtos para
    // INSUMO e EMBALAGEM — era essa repetição que tornava a etapa lenta e
    // multiplicava timeouts/429. O estoque também usa o cache curto criado
    // na etapa anterior, em vez de fazer uma segunda consulta idêntica.
    const fs = global.getDTFirestore();
    const [catalogoSnap, usados] = await Promise.all([
      fs.collection('pcp_produtos_bluesoft').get().catch(()=>({docs:[]})),
      _nomesInsumosUsados(),
    ]);
    let catalogoInsumo = catalogoSnap.docs.map(d=>{const x=d.data()||{};return {produtoKey:String(x.bluesoftProdutoKey??x.cod??'').trim(),produtoUnitarioKey:String(x.produtoUnitarioKeyBluesoft??'').trim(),cod:String(x.cod??x.bluesoftProdutoKey??'').trim(),nome:x.nome||'',unidade:x.unidadeMedidaBluesoft||x.unidade||'',categoria:x.categoria||'',tipoPrincipal:x.bluesoftTipoProduto||''};}).filter(p=>p.produtoKey&&TIPOS_INSUMO_BLUESOFT.includes(p.tipoPrincipal));
    const falhas = [];
    // Compatibilidade para uma primeira sincronização isolada (antes de a
    // etapa Produtos criar o catálogo auxiliar). No fluxo normal do botão
    // essa consulta não acontece; só é fallback quando a base está vazia.
    if (!catalogoInsumo.length) {
      const brutos = await _buscarProdutosPorTipos(TIPOS_INSUMO_BLUESOFT, await _config(), opcoes.onProgresso);
      catalogoInsumo = brutos.map(_normalizarProduto);
      falhas.push(...(brutos.falhas || []));
    }
    const resultadoEstoque = await obterEstoqueBluesoft(loja, false, {});
    // No WMS a própria posição já informa descriçãoProduto. Isso permite
    // casar fichas técnicas antigas que guardavam apenas o nome do insumo,
    // mesmo antes de existir bluesoftProdutoKey no cadastro local.
    const chavesCatalogo=new Set(catalogoInsumo.map(p=>String(p.produtoKey)));
    resultadoEstoque.itens.forEach(e=>{if(chavesCatalogo.has(String(e.produtoKey))||!e.descricaoProduto)return;const nomeNorm=normUpper(e.descricaoProduto),unit=String(e.produtoUnitarioKey??'');if(usados.nomes.has(nomeNorm)||usados.nomes.has(_canonInsumo(e.descricaoProduto))||usados.codigos.has(String(e.produtoKey))||(unit&&usados.codigos.has(unit))){catalogoInsumo.push({produtoKey:String(e.produtoKey),produtoUnitarioKey:unit,cod:String(e.produtoKey),nome:e.descricaoProduto,unidade:'',categoria:'',tipoPrincipal:'INSUMO'});chavesCatalogo.add(String(e.produtoKey));}});
    const utilizados = catalogoInsumo.filter(p => usados.codigos.has(String(p.produtoKey)) || (p.produtoUnitarioKey&&usados.codigos.has(String(p.produtoUnitarioKey))) || usados.codigos.has(String(p.cod)) || usados.nomes.has(normUpper(p.nome)) || usados.nomes.has(_canonInsumo(p.nome)));
    if (!utilizados.length) return { totalCatalogo: catalogoInsumo.length, utilizados: 0, comEstoque: 0, criados: 0, atualizados: 0, removidos: 0, falhas };
    const estoquePorKey = new Map();resultadoEstoque.itens.forEach(e=>{estoquePorKey.set(String(e.produtoKey),e);if(e.produtoUnitarioKey!=null)estoquePorKey.set(String(e.produtoUnitarioKey),e);});
    const comEstoque = utilizados
      .map(p => ({ produto: p, estoque: estoquePorKey.get(String(p.produtoKey))||estoquePorKey.get(String(p.produtoUnitarioKey||''))||resultadoEstoque.itens.find(e=>_canonInsumo(e.descricaoProduto)===_canonInsumo(p.nome)) }))
      .filter(x => x.estoque && x.estoque.estoqueAtual > 0);
    const rawFs = raw();
    const snap = await fs.collection('producao_insumos_estoque').get();
    const porNome = new Map(), porKey = new Map(), docsInsumos = new Map();
    snap.docs.forEach(d => {
      const x = d.data() || {};
      docsInsumos.set(d.id, x);
      porNome.set(normUpper(x.insumo || x.nome || ''), d.id);
      if(x.bluesoftProdutoKey!=null)porKey.set(String(x.bluesoftProdutoKey),d.id);
    });
    const agora = new Date().toISOString();
    let criados = 0, atualizados = 0;
    for (let i = 0; i < comEstoque.length; i += 300) {
      const lote = comEstoque.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(({ produto, estoque }) => {
        const payload = {
          insumo: produto.nome, unidade: produto.unidade || '', categoria: produto.categoria || '',
          // Insumo permanece na unidade nativa da Bluesoft (kg, un, m...):
          // fator de caixa só se aplica a produto acabado/pedido.
          quantidade: estoque.estoqueAtualUnidades ?? estoque.estoqueAtual, bluesoftProdutoKey: produto.produtoKey, bluesoftSincronizadoEm: agora, atualizadoEm: agora,
        };
        const docId = porKey.get(String(produto.produtoKey)) || porNome.get(normUpper(produto.nome));
        if (docId) { batch.set(fs.collection('producao_insumos_estoque').doc(docId), payload, { merge: true }); atualizados++; }
        else { batch.set(fs.collection('producao_insumos_estoque').doc(), { ...payload, criadoEm: agora }, { merge: true }); criados++; }
      });
      await batch.commit();
    }
    // Reconciliação (fase 12h) — mesma lógica de produtos/estoque: insumo já
    // sincronizado que não voltou nesta rodada (deixou de ter estoque ou
    // deixou de ser usado em ficha técnica) sai da base.
    // PEDIDO AO VIVO (correção de segurança, mesmo bug já corrigido em
    // produtos/estoque): busca incompleta (falhas do catálogo OU do
    // estoque) nunca pode disparar remoção — um insumo que só não voltou
    // por causa de uma falha de página não é a mesma coisa que "deixou de
    // ter estoque de verdade".
    falhas.push(...(resultadoEstoque.falhas || []));
    const nomesAtuais = new Set(comEstoque.map(({ produto }) => normUpper(produto.nome)));
    const alvosRemocao = [];
    if (!falhas.length) {
      docsInsumos.forEach((x, id) => {
        if (!x.bluesoftSincronizadoEm) return;
        if (nomesAtuais.has(normUpper(x.insumo || x.nome || ''))) return;
        alvosRemocao.push(id);
      });
    }
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
    return { insumo: i.descricao || '', qty: Number(i.pesoBrutoQtd ?? i.pesoLiquido) || 0, bluesoftProdutoKey:i.produtoKey??null, fatorConversao:Number(i.fatorConversao)||1 };
  }
  async function sincronizarFichaTecnicaBluesoft(opcoes) {
    opcoes = opcoes || {};
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
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
    if (!loja.bluesoft_loja_key) throw new Error('Esta loja não está vinculada à integração (bluesoft_loja_key). Vincule em Gestão de Lojas.');
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
  global.buscarPedidoCompraBluesoftPorNumero = buscarPedidoCompraBluesoftPorNumero;
  global.diagnosticarBluesoft = async function () {
    const cfg = await _config(true);
    const lojaId = global.getDTLojaAtiva?.() || '';
    const lojaSnap = lojaId ? await raw().collection('lojas').doc(lojaId).get().catch(() => null) : null;
    const loja = lojaSnap?.exists ? { id: lojaId, ...lojaSnap.data() } : null;
    const resultado = { lojaId, lojaEncontrada: !!loja, lojaKey: loja?.bluesoft_loja_key || '', origemConfig: cfg._origemConfig || 'ausente', urlConfigurada: !!_baseUrl(cfg), tokenConfigurado: !!cfg.token, proxy: BLUESOFT_PROXY_URL };
    if (!lojaId) throw Object.assign(new Error('Nenhuma loja ativa selecionada.'), { diagnostico: resultado });
    if (!loja) throw Object.assign(new Error('A loja ativa não foi encontrada no Firestore.'), { diagnostico: resultado });
    if (!loja.bluesoft_loja_key) throw Object.assign(new Error('A loja ativa não possui bluesoft_loja_key.'), { diagnostico: resultado });
    if (!resultado.urlConfigurada || !resultado.tokenConfigurado) throw Object.assign(new Error('Configuração da API incompleta.'), { diagnostico: resultado });
    // Aqui validamos somente os pré-requisitos comuns. Antes, o diagnóstico
    // chamava /api/fornecedores e uma falta de permissão exclusiva desse
    // endpoint bloqueava também produtos e estoque, mesmo quando eles
    // estavam autorizados. Cada etapa agora testa seu próprio endpoint e
    // reporta sua própria falha.
    return { ...resultado, ok: true };
  };
  global.TIPOS_PRODUTO_BLUESOFT = TIPOS_PRODUTO_VALIDOS;
  global._bluesoftServiceInternals = { _requestBluesoft, _paginarTudo, _config, _normalizarProduto, _normalizarEstoqueComercial, _normalizarEstoqueWms, _normalizarEstoqueFicha, _estoqueRelevante, _buscarProdutosPorTipos, _nomesInsumosUsados, _produtoProtegidoPcp, _projecaoTemDadoManual, _normalizarFichaTecnica, _normalizarInsumoFicha, _janelasMensais, _normalizarNotaRecebimento, _normalizarCargaRecebimento, _ehDevolucao, _categoriaNota, _normalizarNotaRetorno, _pareceDevolucao, _normalizarVendedor, _extrairInfCplDoXml, _extrairVolumesDoXml, _descobrirNotasDevolucaoViaRecebimentoSincronizado, _buscarNotaFiscalPorChave, _normalizarNotaRecebimentoComoRetorno, obterPedidosVendaFaturadosNaoEntreguesBluesoft, obterUrlXmlNota, _parseDataBluesoft, _resolverPeriodoBluesoft, _agruparComprasAReceberBiPorPedido, _gravarAgendaPendentes };
})(window);
