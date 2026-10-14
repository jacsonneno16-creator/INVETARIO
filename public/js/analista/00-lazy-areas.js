// Carregamento por setor. Os arquivos de Recebimento só são baixados e
// executados quando o usuário abre Recebimento pela primeira vez. Os
// utilitários compartilhados continuam estáticos em analista.html.
(function (global) {
  'use strict';

  var AREAS = {
    producao: [
      "js/analista/58-producao-insumos-bi-service.js?v=20260928-fases1a8-final",
      "js/analista/59-producao-ui-completa.js?v=20260828-relatorios-bi-extras",
      // Módulos de Produção usados diretamente pela navegação/configuração.
      // Estes arquivos tinham saído da lista lazy, então funções como
      // renderProducaoInsumos/renderProducaoProjecao podiam não existir.
      "js/analista/60-producao-ficha-tecnica.js?v=20260928-fases1a8-fechamento2",
      "js/analista/61-producao-maquinas.js?v=20260823i-maquina-modal-abas-original",
      "js/analista/62-producao-programacao.js?v=20260928-fases1a8-fechamento2",
      "js/analista/63-producao-agenda.js?v=20260914-setup-sku-embalagem",
      "js/analista/64-producao-gantt.js?v=20260914-setup-sku-embalagem",
      "js/analista/65-producao-insumos.js?v=20260928-fases1a8-final",
      "js/analista/66-producao-projecao.js?v=20260928-fases1a8-final",
      "js/analista/67-producao-prog-automatica.js?v=20260928-fases1a8-final",
      "js/analista/68-producao-funcionarios.js?v=20260822b-embed-container",
      "js/analista/69-producao-relatorios.js?v=20260928-fix-fuso-hoje-relatorios",
      "js/analista/70-producao-setup.js?v=20260822b-embed-container",
      "js/analista/71-producao-excel.js?v=20260928-fases1a8-fechamento2",
      "js/analista/72-producao-mapa-fabrica.js?v=20260816-producao-integrada-final",
      "js/analista/73-producao-realizado.js?v=20260928-fases1a8-final",
      "js/analista/74-producao-dashboard.js?v=20260823b-dashboard-cache-atualizado",
      "js/analista/75-producao-estoque.js?v=20260913-bi-sem-bluesoft",
      "js/analista/76-producao-importacao.js?v=20260914-lazy-fix",
      "js/analista/77-producao-config.js?v=20260914-lazy-fix",
      "js/analista/95-producao-importzip.js?v=20260823f-16-cenarios-testados",
      "js/analista/101-relatorios-bi.js?v=20260914-lazy-fix"
    ],
    pcp: [
      "js/analista/compras-fornecedores-service.js?v=20260927-compras-auditoria-final",
      "js/analista/120-pcp-demand-engine.js?v=20260928-fases1a8-fechamento2",
      "js/analista/pcp-solicitacoes-workflow.js?v=20260929-pcp-solicitacoes-gestao-v1",
      "js/analista/78-pcp-central.js?v=20261001-lote-rolagem-modal",
      "js/analista/81-pcp-parametros.js?v=20260928-fases1a8-fechamento2",
      "js/analista/82-pcp-dashboard.js?v=20261001-casca-antes-do-dado",
      "js/analista/83-pcp-timeline.js?v=20260928-fix-desempenho-multiloja",
      "js/analista/84-pcp-compras-acompanhamento.js?v=20260929-pcp-solicitacoes-gestao-v1",
      "js/analista/pcp-cortes.js?v=20260925-cache-refresh",
      "js/analista/85-pcp-producao-insumos.js?v=20260925-cache-refresh",
      "js/analista/86-pcp-produto-360.js?v=20261001-cobertura-negativa",
      "js/analista/122-pcp-insumo-360.js?v=20260926-auditoria-final-definitiva",
      "js/analista/87-pcp-alertas.js?v=20261001-cobertura-negativa",
      "js/analista/88-pcp-relatorios.js?v=20261001-cobertura-negativa"
    ],
    compras: [
      "js/analista/pcp-solicitacoes-workflow.js?v=20260929-pcp-solicitacoes-gestao-v1",
      "js/analista/79-compras-central.js?v=20260928-fases1a8-fechamento2",
      "js/analista/89-compras-dashboard.js?v=20260928-fases1a8-fechamento2",
      "js/analista/bi-pasta-local.js?v=20260913-cache-dedup",
      "js/analista/compras-fornecedores-service.js?v=20260927-compras-auditoria-final",
      "js/analista/121-compras-profissional.js?v=20260929-pcp-solicitacoes-gestao-v1"
    ],
    recebimento: [
      "js/analista/90-bi-recebimento-service.js?v=20260913-sem-api-bluesoft",
      "js/analista/91-logistica-recebimento.js?v=20260913-busca-manual",
      "js/analista/92-recebimento-config.js?v=20260814-fase15f4h-rotas-globais",
      "js/analista/93-recebimento-operacao.js?v=20260927-compras-auditoria-final",
      "js/analista/94-recebimento-relatorios.js?v=20260918-agenda-coluna-quantidade",
      "js/analista/95-recebimento-transbordo.js?v=20260918-fix-salvar-primeira-vez",
      "js/analista/96-recebimento-performance.js?v=20260928-meta-carreta-dia-real",
      "js/analista/97-recebimento-recusas.js?v=20261014-override-bigquery-atraso",
      "js/analista/98-recebimento-retornos-indicadores.js?v=20260913-resumo-servidor",
      "js/analista/106-devolucoes.js?v=20261014-botao-confirmar-chave",
      "js/analista/99-recebimento-retornos-status.js?v=20260922-confirmado-ausente",
      "js/analista/103-recusas-indicadores.js?v=20260910-busca-manual-periodo-3-meses",
      "js/coletor/28-recebimento-paletes-ledger.js?v=20260906-tambem-no-analista",
      "js/analista/recebimento-paletes-monitoramento.js?v=20261002-fix-transbordo-fantasma",
      "js/analista/104-recebimento-cargas-cards.js?v=20260918-fix-badge-nf-ao-vivo",
      "js/analista/105-recebimento-patio-tempo-real.js?v=20261006-completar-relatorio-bluesoft",
      "js/analista/124-recebimento-patio-inventarios-relatorio.js?v=20261002-novo"
    ],
    // PEDIDO AO VIVO (2026-10-02): Logística › Estoque › Relatórios —
    // movimentos/inventários/notas de estoque (BigQuery, via Bluesoft
    // só-leitura). Só carrega quando o usuário abre o sub-setor Estoque.
    estoque: [
      "js/analista/129-estoque-separacao.js?v=20261012-separacao-v1",
      "js/analista/127-estoque-apontamento.js?v=20261006-wms-tela",
      "js/analista/128-estoque-operacoes-api.js?v=20261009-setores-gestao-v1",
      "js/analista/125-estoque-relatorios.js?v=20261005-v11-loading-logo"
    ],
    atendimento: [
      "js/analista/126-atendimento-whatsapp.js?v=20261005-v1"
    ]
  };

  var _promises = {};

  function _carregarScript(src) {
    return new Promise(function (resolve, reject) {
      var alvo = new URL(src, document.baseURI).pathname;
      var existente = Array.from(document.scripts).some(function (script) {
        return script.src && new URL(script.src, document.baseURI).pathname === alvo;
      });
      if (existente) { resolve(); return; }
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
