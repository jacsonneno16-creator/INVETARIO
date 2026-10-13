// Roteador central + histórico de navegação (URLs por hash).
//
// Não é um 6º mecanismo de navegação desconectado — envolve os 5 já
// existentes (goPage, irParaSetor, pcpIrParaAba, comprasIrParaPagina,
// abrirModalConfiguracoes/fecharModalConfiguracoes) sem reescrever nenhum
// deles: cada rota, ao ser aplicada, só CHAMA essas mesmas funções (mais
// alguns getters/setters pequenos e aditivos que foram exportados nos
// arquivos de origem para expor sub-abas que hoje só vivem em variável de
// módulo). Todos os 90+ pontos de chamada existentes (onclick inline no
// HTML incluído) continuam funcionando exatamente como antes.
//
// Ordem de carregamento: logo após 03-core-navigation.js (goPage/renderPage/
// PAGE_NAMES já existem), mas o monkey-patch de verdade só roda dentro de
// AnalistaRouter.init(), chamado explicitamente por 00-auth-login.js depois
// de aplicarPermissoesAnalista()/irParaPrimeiraPaginaPermitida()/
// aplicarSetoresPermitidos() — nesse ponto todos os scripts da página já
// terminaram de carregar (inclusive o monkey-patch que
// 121-compras-profissional.js faz em cima de comprasIrParaPagina), então o
// roteador sempre embrulha a versão final de cada função. Antes disso nada
// é clicável (#app-main fica display:none até o login terminar).
(function (global) {
  'use strict';

  var HASH_PREFIXO = '#/';
  // PCP reorganizado: mantém links antigos funcionando, mas converte a
  // URL para a rota canônica atual em vez de exigir nav-items que saíram
  // do menu. Isso evita tela em branco em favoritos/links antigos.
  var ROTAS_PCP_LEGADAS = {
    'pcp/estoque':'pcp/planejamento',
    'pcp/pedidos-x-estoque':'pcp/planejamento',
    'pcp/compras':'pcp/planejamento',
    'pcp/alertas':'pcp/planejamento',
    'pcp/timeline':'pcp/planejamento',
    'pcp/insumos-producao':'pcp/insumos',
    'pcp/acompanhamento-compras':'compras/solicitacoes',
    'pcp/agendamentos':'compras/pedidos'
  };

  // Reentrância: true enquanto o PRÓPRIO roteador está aplicando uma rota
  // (boot, popstate/hashchange, dismiss do modal). As funções embrulhadas só
  // sincronizam a URL quando esta flag está false — isso cobre
  // automaticamente qualquer chamada aninhada (o fallback interno de
  // irParaSetor pra goPage/pcpIrParaAba/comprasIrParaPagina, a chamada
  // interna de abrirModalConfiguracoes pra goPage, etc.) sem precisar tocar
  // nesses arquivos.
  var _isApplyingRoute = false;
  var _iniciado = false;
  // Última rota (path+query serializados) que o próprio roteador já sabe
  // que está refletida na URL — usado tanto pra não duplicar entradas de
  // histórico quanto pra ignorar o evento hashchange que nós mesmos
  // disparamos (esse evento é assíncrono; a flag acima não alcança ele).
  var _ultimaChaveConhecida = null;
  var _rotaAnteriorPath = null;

  function elId(id) { return id ? document.getElementById(id) : null; }

  // ---------------------------------------------------------------------
  // Parser / serializador
  // ---------------------------------------------------------------------
  function stateFromLocation() {
    var h = String(global.location.hash || '');
    if (h.indexOf(HASH_PREFIXO) === 0) h = h.slice(HASH_PREFIXO.length);
    else if (h.indexOf('#') === 0) h = h.slice(1).replace(/^\//, '');
    var partes = h.split('?');
    var path = (partes[0] || '').replace(/\/+$/, '');
    path = ROTAS_PCP_LEGADAS[path] || path;
    var params = new URLSearchParams(partes[1] || '');
    return { path: path, params: params };
  }
  function _serializarRota(path, params) {
    var qs = params ? params.toString() : '';
    return path + (qs ? '?' + qs : '');
  }

  // ---------------------------------------------------------------------
  // Fábricas de rota — cobrem os casos uniformes (Inventário/Recebimento/
  // Produção simples, abas do PCP, páginas de Compras, seções virtuais de
  // Configurações da Produção). Casos irregulares (Compras/central,
  // Compras/produtos, Configurações globais) são objetos escritos à mão
  // mais abaixo, junto da tabela.
  // ---------------------------------------------------------------------
  function paginaSimples(path, goPageId, opts) {
    opts = opts || {};
    var navId = opts.navId !== undefined ? opts.navId : ('nav-' + goPageId);
    return {
      path: path, setor: opts.setor, view: opts.view,
      apply: function (params) {
        global.goPage(goPageId, elId(navId));
        if (opts.applyExtra) opts.applyExtra(params);
      },
      currentRoute: function () {
        var pg = elId('page-' + goPageId);
        if (!pg || !pg.classList.contains('on')) return null;
        if (opts.matchExtra && !opts.matchExtra()) return null;
        var params = new URLSearchParams();
        if (opts.paramsExtra) opts.paramsExtra(params);
        return { path: path, params: params };
      }
    };
  }
  function paginaConfigProducao(path, secaoId) {
    return paginaSimples(path, 'producao-config', {
      setor: 'producao',
      applyExtra: function () { if (global.pcfgSetSecao) global.pcfgSetSecao(secaoId); },
      matchExtra: function () { return !!(global.pcfgGetSecao && global.pcfgGetSecao() === secaoId); }
    });
  }
  function paginaPcpInterna(path, abaId, navId) {
    return {
      path: path, setor: 'pcp',
      apply: function () { global.pcpIrParaAba(abaId, elId(navId)); },
      currentRoute: function () {
        var pg = elId('page-pcp-central');
        if (!pg || !pg.classList.contains('on')) return null;
        if (!global.pcpGetAbaAtual || global.pcpGetAbaAtual() !== abaId) return null;
        return { path: path, params: new URLSearchParams() };
      }
    };
  }
  function paginaPcpExterna(path, abaId, navId) {
    return {
      path: path, setor: 'pcp',
      apply: function () { global.pcpIrParaAba(abaId, elId(navId)); },
      currentRoute: function () {
        var pg = elId('page-pcp-' + abaId);
        if (!pg || !pg.classList.contains('on')) return null;
        return { path: path, params: new URLSearchParams() };
      }
    };
  }
  function paginaCompras(path, nome, navId) {
    return {
      path: path, setor: 'compras',
      apply: function () { global.comprasIrParaPagina(nome, elId(navId)); },
      currentRoute: function () {
        var pg = elId('page-compras-' + nome);
        if (!pg || !pg.classList.contains('on')) return null;
        return { path: path, params: new URLSearchParams() };
      }
    };
  }


  function paginaAtendimento(path, nome, navId) {
    return {
      path: path, setor: 'atendimento',
      apply: function () { global.atendimentoIrParaPagina(nome, elId(navId)); },
      currentRoute: function () {
        var pg = elId('page-atendimento-' + nome);
        if (!pg || !pg.classList.contains('on')) return null;
        return { path: path, params: new URLSearchParams() };
      }
    };
  }

  // ---------------------------------------------------------------------
  // Tabela de rotas
  // ---------------------------------------------------------------------
  var ROTAS = [
    // Configurações globais (⚙️, "modal como página") — Formato B: tem
    // dismiss() porque fechar não é "ir pra outra rota", é restaurar
    // _paginaAntesConfig (lógica que já existe em
    // 37-usuarios-permissoes.js, reaproveitada sem duplicação).
    {
      path: 'configuracoes', isModal: true,
      apply: function (params) {
        var tab = params.get('tab') || 'operadores';
        global.abrirModalConfiguracoes(tab, null);
      },
      dismiss: function () { global.fecharModalConfiguracoes(); },
      currentRoute: function () {
        var modal = elId('modal-configuracoes');
        if (!modal || !modal.classList.contains('open')) return null;
        var tabAtiva = document.querySelector('#modal-configuracoes .cfgm-tab.on');
        var tab = tabAtiva ? tabAtiva.id.replace('cfgm-tab-', '') : 'operadores';
        var params = new URLSearchParams(); params.set('tab', tab);
        return { path: 'configuracoes', params: params };
      }
    },

    // ---- Logística · Inventário ----
    paginaSimples('logistica/inventario/dashboard', 'dashboard', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/inventarios', 'inventarios', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/acompanhamento', 'acompanhamento', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/auditoria', 'auditoria', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/contagens', 'contagens', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/pendencias', 'pendencias', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/recontagem', 'recontagens', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/relatorio-conflitos', 'rel-divergencias', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/capas-duplicadas', 'capas-duplicadas', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/produtividade', 'produtividade', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/enderecos', 'enderecos', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/produtos', 'produtos', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/rastreabilidade', 'rastreabilidade', { setor: 'logistica', view: 'inventario' }),
    paginaSimples('logistica/inventario/importar-exportar', 'importar-exportar', {
      setor: 'logistica', view: 'inventario',
      applyExtra: function (params) { if (params.get('tab') && global.ieSetTab) global.ieSetTab(params.get('tab')); },
      paramsExtra: function (params) { if (global.ieGetTabAtual) params.set('tab', global.ieGetTabAtual()); }
    }),

    // ---- Logística · Recebimento ----
    paginaSimples('logistica/recebimento/dashboard', 'recebimento-dashboard', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/recebimentos', 'recebimento-operacao', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/historico', 'recebimento-historico', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/configuracoes', 'recebimento-config', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/notas', 'recebimento-notas', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/fornecedores', 'recebimento-fornecedores', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/agendamentos', 'recebimento-agendamentos', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/transbordo', 'recebimento-transbordo', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/cargas', 'recebimento-cargas', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/paletes', 'recebimento-paletes', { setor: 'logistica', view: 'recebimento' }),
    // BUG AO VIVO REAL (2026-09-17): faltava esta rota — usuário cujo único
    // módulo liberado era este ficava preso na casca errada (Inventário
    // clássico vazio) ao entrar direto pela URL, porque encontrarRota()
    // nunca achava esta página e o roteador desistia silenciosamente sem
    // chamar irParaSetor('logistica','recebimento').
    paginaSimples('logistica/recebimento/patio-tempo-real', 'recebimento-patio-tempo-real', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/patio-inventarios', 'recebimento-patio-inventarios', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/tempos', 'recebimento-tempos', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/recusas', 'recebimento-recusas', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/retornos-indicadores', 'recebimento-retornos-indicadores', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/retornos-status', 'recebimento-retornos-status', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/recusas-indicadores', 'recebimento-recusas-indicadores', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/recusas-cadastros', 'recebimento-recusas-cadastros', { setor: 'logistica', view: 'recebimento' }),
    paginaSimples('logistica/recebimento/devolucoes', 'recebimento-devolucoes', { setor: 'logistica', view: 'recebimento' }),

    // ---- Logística — Estoque (Relatórios, BigQuery) ----
    paginaSimples('logistica/estoque/relatorios/inventario', 'estoque-rel-inventario', { setor: 'logistica', view: 'estoque' }),
    paginaSimples('logistica/estoque/relatorios/descarte', 'estoque-rel-descarte', { setor: 'logistica', view: 'estoque' }),
    paginaSimples('logistica/estoque/relatorios/requisicao', 'estoque-rel-requisicao', { setor: 'logistica', view: 'estoque' }),
    paginaSimples('logistica/estoque/relatorios/transformacao', 'estoque-rel-transformacao', { setor: 'logistica', view: 'estoque' }),

    // ---- Produção — páginas principais ----
    paginaAtendimento('atendimento/dashboard', 'dashboard', 'nav-atendimento-dashboard'),
    paginaAtendimento('atendimento/conversas', 'conversas', 'nav-atendimento-conversas'),
    paginaAtendimento('atendimento/config', 'config', 'nav-atendimento-config'),

    paginaSimples('producao/dashboard', 'producao-dashboard', { setor: 'producao' }),
    paginaSimples('producao/programacao', 'producao-programacao', { setor: 'producao' }),
    paginaSimples('producao/maquinas', 'producao-maquinas', { setor: 'producao' }),
    paginaSimples('producao/programacao-visual', 'producao-gantt', {
      setor: 'producao',
      applyExtra: function (params) {
        if (params.get('modo') && global.pganttModo) global.pganttModo(params.get('modo'));
        if (global.pganttResumoSet) global.pganttResumoSet(params.get('resumo') === '1');
      },
      paramsExtra: function (params) {
        if (global.pganttGetModo) params.set('modo', global.pganttGetModo());
        if (global.pganttGetResumoAberto && global.pganttGetResumoAberto()) params.set('resumo', '1');
      }
    }),
    paginaSimples('producao/realizado', 'producao-realizado', {
      setor: 'producao',
      applyExtra: function (params) {
        if (params.get('aba') && global.prealSetAba) global.prealSetAba(params.get('aba'));
        if (params.get('dia') && global.prealSetDia) global.prealSetDia(params.get('dia'));
      },
      paramsExtra: function (params) {
        if (global.prealGetAba) params.set('aba', global.prealGetAba());
        if (global.prealGetDia && global.prealGetDia()) params.set('dia', global.prealGetDia());
      }
    }),
    paginaSimples('producao/insumos', 'producao-insumos', {
      setor: 'producao',
      applyExtra: function (params) { if (params.get('modo') && global.pinsModo) global.pinsModo(params.get('modo')); },
      paramsExtra: function (params) { if (global.pinsGetModo) params.set('modo', global.pinsGetModo()); }
    }),
    paginaSimples('producao/programacao-automatica', 'producao-prog-automatica', { setor: 'producao' }),
    paginaSimples('producao/relatorios', 'producao-relatorios', {
      setor: 'producao',
      applyExtra: function (params) { if (params.get('aba') && global.prelSetAba) global.prelSetAba(params.get('aba')); },
      paramsExtra: function (params) { if (global.prelGetAba) params.set('aba', global.prelGetAba()); }
    }),
    // Páginas de Produção sem item visível na navegação principal (3-pontos
    // ou reaproveitadas dentro de Configurações via RENDER_EMBED) — têm
    // goPage id e #page- próprios, continuam navegáveis por URL direta.
    paginaSimples('producao/produtos', 'producao-ficha-tecnica', { setor: 'producao' }),
    paginaSimples('producao/projecao', 'producao-projecao', { setor: 'producao' }),
    paginaSimples('producao/funcionarios', 'producao-funcionarios', { setor: 'producao' }),
    paginaSimples('producao/tempos-setup', 'producao-setup', { setor: 'producao' }),
    paginaSimples('producao/mapa-fabrica', 'producao-mapa-fabrica', { setor: 'producao' }),
    paginaSimples('producao/importacao', 'producao-importacao', { setor: 'producao' }),
    paginaSimples('producao/estoque', 'producao-estoque', { setor: 'producao' }),
    paginaSimples('producao/relatorios-bi', 'producao-relatorios-bi', { setor: 'producao' }),

    // ---- Produção → Configurações (seções da sidebar interna) ----
    // Turnos por Máquina e Importar ZIP não têm goPage id próprio — só
    // existem como secaoAtiva dentro de producao-config.
    paginaConfigProducao('producao/configuracoes/maquinas', 'cadastro-maquinas'),
    paginaConfigProducao('producao/configuracoes/turnos', 'turnos'),
    paginaConfigProducao('producao/configuracoes/setup', 'setup-maquinas'),
    paginaConfigProducao('producao/configuracoes/produtos', 'cadastro-produtos'),
    paginaConfigProducao('producao/configuracoes/ficha-tecnica', 'ficha-tecnica-cfg'),
    paginaConfigProducao('producao/configuracoes/categorias', 'categorias-cfg'),
    paginaConfigProducao('producao/configuracoes/funcionarios', 'funcionarios'),
    paginaConfigProducao('producao/configuracoes/processos', 'processos'),
    paginaConfigProducao('producao/configuracoes/jornada', 'jornada'),
    paginaConfigProducao('producao/configuracoes/importacao', 'importacao'),
    paginaConfigProducao('producao/configuracoes/importzip', 'importzip'),
    paginaConfigProducao('producao/configuracoes/mapa-fabrica', 'producao-mapa-fabrica'),
    paginaConfigProducao('producao/configuracoes/estoque', 'producao-estoque'),

    // ---- PCP reorganizado — somente rotas canônicas que ainda existem no menu ----
    paginaPcpInterna('pcp/pedidos', 'pedidos', 'nav-pcp-pedidos'),
    paginaPcpInterna('pcp/planejamento', 'planejamento', 'nav-pcp-planejamento'),
    paginaPcpInterna('pcp/insumos', 'insumos', 'nav-pcp-insumos'),
    paginaPcpInterna('pcp/programacao-producao', 'producao', 'nav-pcp-producao'),
    paginaPcpExterna('pcp/dashboard', 'dashboard', 'nav-pcp-dashboard'),
    paginaPcpExterna('pcp/parametros', 'parametros', 'nav-pcp-parametros'),
    paginaPcpExterna('pcp/produto-360', 'produto-360', null),
    paginaPcpExterna('pcp/relatorios', 'relatorios', 'nav-pcp-relatorios'),

    // ---- Compras ----
    paginaCompras('compras/dashboard', 'dashboard', 'nav-compras-dashboard'),
    {
      path: 'compras/central', setor: 'compras',
      apply: function (params) {
        global.comprasIrParaPagina('central', elId('nav-compras-central'));
        if (params.get('aba') && global.comprasSetAbaCentral) global.comprasSetAbaCentral(params.get('aba'));
      },
      currentRoute: function () {
        var pg = elId('page-compras-central');
        if (!pg || !pg.classList.contains('on')) return null;
        var params = new URLSearchParams();
        if (global.comprasGetAbaCentral) params.set('aba', global.comprasGetAbaCentral());
        return { path: 'compras/central', params: params };
      }
    },
    paginaCompras('compras/solicitacoes', 'solicitacoes', 'nav-compras-solicitacoes'),
    paginaCompras('compras/cotacoes', 'cotacoes', 'nav-compras-cotacoes'),
    paginaCompras('compras/pedidos', 'pedidos', 'nav-compras-pedidos'),
    paginaCompras('compras/precos', 'precos', 'nav-compras-precos'),
    {
      // Corrige, ao restaurar por URL, o mesmo bug que a navegação por
      // clique já corrige (selectedProduct nunca ficava preso): uma rota
      // "compras/produtos" pura sempre abre a lista; só com ?produto= é que
      // abre o 360° de um item específico.
      path: 'compras/produtos', setor: 'compras',
      apply: function (params) {
        global.comprasIrParaPagina('produtos', elId('nav-compras-produtos'));
        var produto = params.get('produto');
        if (produto && global.comprasSetProduto) global.comprasSetProduto(produto);
      },
      currentRoute: function () {
        var pg = elId('page-compras-produtos');
        if (!pg || !pg.classList.contains('on')) return null;
        var params = new URLSearchParams();
        var sel = global.comprasGetSelectedProduct && global.comprasGetSelectedProduct();
        if (sel) params.set('produto', sel);
        return { path: 'compras/produtos', params: params };
      }
    },
    paginaCompras('compras/fornecedores', 'fornecedores', 'nav-compras-fornecedores'),
    paginaCompras('compras/recebimentos', 'recebimentos', 'nav-compras-recebimentos'),
    paginaCompras('compras/relatorios', 'relatorios', 'nav-compras-relatorios'),
    paginaCompras('compras/administracao', 'administracao', 'nav-compras-administracao')
  ];

  function encontrarRota(path) {
    for (var i = 0; i < ROTAS.length; i++) if (ROTAS[i].path === path) return ROTAS[i];
    return null;
  }
  function rotaAtualDoDom() {
    for (var i = 0; i < ROTAS.length; i++) {
      var r = ROTAS[i].currentRoute && ROTAS[i].currentRoute();
      if (r) return r;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Aplicação de rota
  // ---------------------------------------------------------------------
  function _aplicarEntrada(entry, params) {
    if (!entry.isModal && entry.setor) global.irParaSetor(entry.setor, entry.view);
    entry.apply(params);
  }
  function _rotaValidaEAtiva(path, params) {
    var entry = encontrarRota(path);
    if (!entry) return false;
    _aplicarEntrada(entry, params || new URLSearchParams());
    var atual = rotaAtualDoDom();
    return !!(atual && atual.path === path);
  }
  function _normalizarUrl(rota, modo) {
    var chave = rota ? _serializarRota(rota.path, rota.params) : '';
    if (modo === 'noop') { _ultimaChaveConhecida = chave; return; }
    if (chave === _ultimaChaveConhecida) return; // já reflete isso — evita entrada/replace redundante
    _ultimaChaveConhecida = chave;
    var hashCompleto = chave ? (HASH_PREFIXO + chave) : HASH_PREFIXO;
    if (modo === 'push') {
      global.location.hash = hashCompleto;
    } else {
      var url = global.location.pathname + global.location.search + hashCompleto;
      global.history.replaceState(global.history.state, '', url);
    }
  }

  // Chamado 1x no boot, DEPOIS que aplicarPermissoesAnalista()/
  // irParaPrimeiraPaginaPermitida()/aplicarSetoresPermitidos() já rodaram
  // (fluxo de login inalterado, sem nada removido) — só sobrescreve se a
  // URL pedir uma rota diferente e permitida. Nunca chama o fallback de
  // novo aqui, pra não duplicar leitura/renderização logo no boot.
  function applyCurrentRoute() {
    _isApplyingRoute = true;
    try {
      var estado = stateFromLocation();
      if (estado.path) _rotaValidaEAtiva(estado.path, estado.params);
      var rotaFinal = rotaAtualDoDom();
      _normalizarUrl(rotaFinal, 'replace');
      _rotaAnteriorPath = rotaFinal ? rotaFinal.path : null;
    } finally { _isApplyingRoute = false; }
  }

  function _aoTrocarHash() {
    var estado = stateFromLocation();
    var chaveNova = _serializarRota(estado.path, estado.params);
    if (chaveNova === _ultimaChaveConhecida) return; // eco do nosso próprio push, já aplicado
    _isApplyingRoute = true;
    try {
      if (_rotaAnteriorPath === 'configuracoes' && estado.path !== 'configuracoes') {
        var modalEntry = encontrarRota('configuracoes');
        if (modalEntry && modalEntry.dismiss) modalEntry.dismiss();
      }
      var ok = estado.path ? _rotaValidaEAtiva(estado.path, estado.params) : false;
      if (!ok) {
        if (typeof global.irParaPrimeiraPaginaPermitida === 'function') global.irParaPrimeiraPaginaPermitida();
        if (typeof global.aplicarSetoresPermitidos === 'function') global.aplicarSetoresPermitidos();
      }
      var rotaFinal = rotaAtualDoDom();
      _normalizarUrl(rotaFinal, ok ? 'noop' : 'replace');
      _rotaAnteriorPath = rotaFinal ? rotaFinal.path : null;
    } finally { _isApplyingRoute = false; }
  }

  // Depois de qualquer chamada "real" (clique do usuário, ou qualquer outro
  // código chamando goPage/irParaSetor/pcpIrParaAba/comprasIrParaPagina/
  // abrirModalConfiguracoes/fecharModalConfiguracoes fora do roteador),
  // reflete o estado resultante do DOM na URL.
  function _sincronizarAposChamadaReal() {
    var rota = rotaAtualDoDom();
    _rotaAnteriorPath = rota ? rota.path : _rotaAnteriorPath;
    _normalizarUrl(rota, 'push');
  }
  function _instalarWrapper(nome) {
    var original = global[nome];
    if (typeof original !== 'function' || original.__dtRouterWrapped) return;
    var wrapped = function () {
      var resultado = original.apply(this, arguments);
      if (!_isApplyingRoute) _sincronizarAposChamadaReal();
      return resultado;
    };
    wrapped.__dtRouterWrapped = true;
    global[nome] = wrapped;
  }

  function navigate(path, query) {
    var params = query instanceof global.URLSearchParams ? query : new URLSearchParams(query || {});
    var chave = _serializarRota(path, params);
    var hashCompleto = HASH_PREFIXO + chave;
    if (global.location.hash === hashCompleto) return; // já está nessa rota
    global.location.hash = hashCompleto;
  }
  function replace(path, query) {
    var params = query instanceof global.URLSearchParams ? query : new URLSearchParams(query || {});
    _normalizarUrl({ path: path, params: params }, 'replace');
  }

  function init() {
    if (_iniciado) return;
    _iniciado = true;
    ['goPage', 'irParaSetor', 'pcpIrParaAba', 'comprasIrParaPagina', 'atendimentoIrParaPagina', 'abrirModalConfiguracoes', 'fecharModalConfiguracoes'].forEach(_instalarWrapper);
    global.addEventListener('hashchange', _aoTrocarHash);
    applyCurrentRoute();
  }

  global.AnalistaRouter = {
    routes: ROTAS,
    navigate: navigate,
    applyCurrentRoute: applyCurrentRoute,
    routeFromLocation: stateFromLocation,
    stateFromLocation: stateFromLocation,
    replace: replace,
    back: function () { global.history.back(); },
    isRestoring: function () { return _isApplyingRoute; },
    init: init,
    rotaAtual: rotaAtualDoDom
  };
})(window);
