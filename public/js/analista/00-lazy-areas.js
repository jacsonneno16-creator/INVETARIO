// Carregamento por setor (front 3, ver CLAUDE.md desta pasta e o plano
// structured-sprouting-hoare.md, Fase 2): cada balde abaixo lista, NA
// MESMA ORDEM em que as tags <script> estáticas apareciam em
// analista.html, os arquivos que só fazem sentido depois que o usuário
// realmente abre aquele setor pela primeira vez nesta sessão de página —
// Produção/PCP/Compras/Recebimento. O resto (Inventário/Logística
// clássico + os ~60 arquivos "Base"/compartilhados, incluindo os que
// hospedam utilitário usado por mais de um setor — 60/65/66/76-producao-*,
// 80-pcp-auditoria, 90-bluesoft-service, 101-relatorios-bi — continua
// como <script> estático em analista.html, carregado sempre no boot.
(function (global) {
  'use strict';

  var AREAS = {
    producao: [
      "js/analista/59-producao-ui-completa.js?v=20260828-relatorios-bi-extras",
      "js/analista/63-producao-agenda.js?v=20260907-setup-nome-normalizado",
      "js/analista/61-producao-maquinas.js?v=20260823i-maquina-modal-abas-original",
      "js/analista/62-producao-programacao.js?v=20260902-preview-insumo-modal",
      "js/analista/64-producao-gantt.js?v=20260831f-ellipsis-flex-fix",
      "js/analista/67-producao-prog-automatica.js?v=20260907l-desconta-comprometido",
      "js/analista/68-producao-funcionarios.js?v=20260822b-embed-container",
      "js/analista/69-producao-relatorios.js?v=20260823d-graficos-altura-fixa",
      "js/analista/70-producao-setup.js?v=20260822b-embed-container",
      "js/analista/71-producao-excel.js?v=20260902-empresa-produtora-loja-ativa",
      "js/analista/72-producao-mapa-fabrica.js?v=20260816-producao-integrada-final",
      "js/analista/73-producao-realizado.js?v=20260831-total-semana-modal",
      "js/analista/74-producao-dashboard.js?v=20260823b-dashboard-cache-atualizado",
      "js/analista/75-producao-estoque.js?v=20260822-embed-container",
      "js/analista/77-producao-config.js?v=20260828-relatorios-bi-extras",
      "js/analista/95-producao-importzip.js?v=20260823f-16-cenarios-testados"
    ],
    pcp: [
      "js/analista/120-pcp-demand-engine.js?v=20260907-peso-50-50",
      "js/analista/78-pcp-central.js?v=20260907c-consumo-e-previsao-mensal",
      "js/analista/81-pcp-parametros.js?v=20260906b-filtro-loja",
      "js/analista/82-pcp-dashboard.js?v=20260909-cache-snapshots",
      "js/analista/83-pcp-timeline.js?v=20260907-proximas-datas-compra",
      "js/analista/84-pcp-compras-acompanhamento.js?v=20260902-estoquebi",
      "js/analista/pcp-cortes.js?v=20260828-pcp-cortes-1",
      "js/analista/85-pcp-producao-insumos.js?v=20260904b-sem-dado-bi-e-unidade",
      "js/analista/86-pcp-produto-360.js?v=20260909-cache-ficha-tecnica",
      "js/analista/87-pcp-alertas.js?v=20260902-estoquebi",
      "js/analista/88-pcp-relatorios.js?v=20260907-3-datas-compra-futuras"
    ],
    compras: [
      "js/analista/79-compras-central.js?v=20260909-cache-recarga",
      "js/analista/89-compras-dashboard.js?v=20260906-forcar-sync-bi",
      "js/analista/bi-pasta-local.js?v=20260827-so-via-api-graph",
      "js/analista/compras-fornecedores-service.js?v=20260829-fase1a-fornecedor-mestre",
      "js/analista/121-compras-profissional.js?v=20260906-aviso-sem-permissao-fornecedores"
    ],
    recebimento: [
      "js/analista/91-logistica-recebimento.js?v=20260909e-sem-timeout-artificial",
      "js/analista/92-recebimento-config.js?v=20260814-fase15f4h-rotas-globais",
      "js/analista/93-recebimento-operacao.js?v=20260909d-sem-timeout-artificial",
      "js/analista/94-recebimento-relatorios.js?v=20260827-so-buscar-auto-refresh",
      "js/analista/95-recebimento-transbordo.js?v=20260908c-codigo-segue-motorista",
      "js/analista/96-recebimento-performance.js?v=20260821-filtro-periodo-livre",
      "js/analista/97-recebimento-recusas.js?v=20260909-cache-carregarDados",
      "js/analista/100-consulta-notas-fiscais.js?v=20260902b-gtin-ean-dun-separados",
      "js/analista/98-recebimento-retornos-indicadores.js?v=20260909-cache-carregarDados",
      "js/analista/102-devolucoes-bi-indicadores.js?v=20260903-controle-retorno-fisico",
      "js/analista/99-recebimento-retornos-status.js?v=20260909f-cache-carregarDados",
      "js/analista/103-recusas-indicadores.js?v=20260909-cache-carregarDados",
      "js/coletor/28-recebimento-paletes-ledger.js?v=20260906-tambem-no-analista",
      "js/analista/recebimento-paletes-monitoramento.js?v=20260908b-split-transbordo-entrega",
      "js/analista/104-recebimento-cargas-cards.js?v=20260908i-ledger-transito-no-destino"
    ]
  };

  var _promises = {};

  function _carregarScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = src;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error("Falha ao carregar " + src)); };
      document.head.appendChild(el);
    });
  }

  // Injeta um script de cada vez, só disparando o próximo depois que o
  // anterior terminou de executar (onload de <script> dispara depois da
  // execução, não só do download) — mesma garantia de ordem que "defer"
  // dá pras tags estáticas, necessária porque vários arquivos de uma
  // mesma área dependem de globals que o anterior já registrou.
  async function _carregarSequencial(lista) {
    for (var i = 0; i < lista.length; i++) await _carregarScript(lista[i]);
  }

  // Cache de Promise por área: nunca recarrega a mesma área 2x na mesma
  // sessão de página, e chamadas concorrentes (ex.: duplo clique na aba)
  // esperam a MESMA Promise em vez de disparar 2 carregamentos.
  // Numa falha, a Promise fica rejeitada (não tenta de novo sozinha) —
  // ver o botão "Recarregar página" em 37-usuarios-permissoes.js: alguns
  // arquivos da área registram listeners globais no próprio carregamento,
  // então reexecutar só os que já rodaram duplicaria esses listeners; um
  // F5 garante estado limpo em vez de uma nova tentativa de injeção.
  function carregarScriptsDeArea(area) {
    if (!AREAS[area]) return Promise.resolve();
    if (!_promises[area]) _promises[area] = _carregarSequencial(AREAS[area]);
    return _promises[area];
  }

  global.carregarScriptsDeArea = carregarScriptsDeArea;
  global._lazyAreasInternals = { AREAS: AREAS, carregarScriptsDeArea: carregarScriptsDeArea };
})(window);
