'use strict';
/**
 * RodadaFisicaService
 * ---------------------------------------------------------------------
 * Regras canônicas de rodada física (contagem × recontagem), extraídas
 * de js/analista/21-divergencias-recontagens.js.
 *
 * Motivo da extração: estas são as regras que causaram as divergências
 * documentadas em AUDITORIA_FLUXO_V224.txt (tela, badge e exportações
 * calculando a rodada válida de formas diferentes). Isolá-las em um
 * módulo puro — sem depender do estado do Analista (state()) nem do
 * DOM — permite testá-las diretamente (ver tests/rodadaFisicaService.test.js)
 * e garante que só existe UM lugar onde essa regra é implementada.
 *
 * js/analista/21-divergencias-recontagens.js continua sendo o dono do
 * fluxo (persistência, integração com o Store, etc.); ele agora apenas
 * delega para as funções puras daqui, sem duplicar a lógica.
 *
 * REGRA CANÔNICA (ver AUDITORIA_FLUXO_V224.txt):
 * - Primeira contagem é rodada 1.
 * - Recontagem 1 é rodada 2; recontagem 2 é rodada 3 (rodada é limitada a 3).
 * - Somente recontagens concluídas podem substituir a rodada anterior.
 * - Dentro da rodada ativa, cada palete aparece uma única vez
 *   (a leitura mais recente por palete/documento/linha vence).
 * ---------------------------------------------------------------------
 */
(function (global) {

  var STATUS_RECONTAGEM_ABERTA = [
    'CANCELADA', 'EXCLUIDA', 'ESTORNADA', 'PENDENTE',
    'ATRIBUIDA', 'ATRIBUÍDA', 'EM_ANDAMENTO', 'ABERTA'
  ];
  var STATUS_RECONTAGEM_CONCLUIDA = [
    'CONCLUIDA', 'CONCLUÍDA', 'FINALIZADA', 'PROCESSADA',
    'RESOLVIDA', 'AGUARDANDO_ANALISTA', 'SEM_DIVERGENCIA'
  ];

  // Normaliza texto para comparação: trim + uppercase.
  // Equivalente EXATO ao helper interno "_nd" do módulo de origem
  // (js/analista/21-divergencias-recontagens.js): `v => String(v || '').trim().toUpperCase()`.
  // Importante: não remove acentos — as listas de status abaixo contêm
  // deliberadamente as duas grafias (ex.: 'CONCLUIDA' e 'CONCLUÍDA').
  function normalizarTexto(valor) {
    return String(valor || '').trim().toUpperCase();
  }

  /**
   * Rodada física da leitura: 1 = primeira contagem, 2 = recontagem 1,
   * 3 = recontagem 2 (teto em 3, recontagens adicionais não avançam rodada).
   */
  function rodadaFisica(contagem) {
    var tipo = normalizarTexto(contagem && contagem.tipo_contagem || 'PRIMEIRA');
    if (tipo !== 'RECONTAGEM') return 1;
    var numero = Number(contagem && contagem.numero_recontagem || 1);
    return Math.min(3, 1 + Math.max(1, numero));
  }

  /**
   * Uma recontagem só é considerada concluída (apta a substituir a rodada
   * anterior) se tiver marca de conclusão OU status de conclusão — e não
   * estiver em um status de rodada ainda aberta/cancelada.
   */
  function recontagemConcluida(recontagem) {
    if (!recontagem) return false;
    var status = normalizarTexto(recontagem.status_recontagem || recontagem.status);
    if (STATUS_RECONTAGEM_ABERTA.indexOf(status) !== -1) return false;
    var temMarcaConclusao = Boolean(
      recontagem.recontagem_concluida_em || recontagem.concluida_em ||
      recontagem.finalizada_em || recontagem.data_segunda || recontagem.data_terceira
    );
    return temMarcaConclusao || STATUS_RECONTAGEM_CONCLUIDA.indexOf(status) !== -1;
  }

  /**
   * Chave de identidade de um palete físico dentro de uma rodada, usada
   * para deduplicar leituras (cada palete aparece uma única vez na
   * fotografia). Prioridade: número de palete > uuid/id do documento >
   * fingerprint da linha (código + quantidade + timestamp/índice).
   */
  function idPaleteFisico(contagem, indice) {
    var pal = normalizarTexto(
      (contagem && (contagem.palete ?? contagem.pallet ?? contagem.numero_palete ??
        contagem.numeroPalete ?? contagem.palete_key ?? contagem.capa_palete ??
        contagem.capa ?? contagem.sscc)) || ''
    );
    if (pal) return 'PAL:' + pal;

    var id = String((contagem && (contagem.uuid || contagem.id || contagem.contagem_uuid)) || '').trim();
    if (id) return 'DOC:' + id;

    var codigo = normalizarTexto(
      (contagem && (contagem.gtin_bipado || contagem.codigoLido || contagem.codigo_lido ||
        contagem.dunLido || contagem.codigo_produto)) || ''
    );
    var quantidade = (contagem && (contagem.quantidade ?? contagem.qtd ?? contagem.qtd_contada)) ?? '';
    var timestamp = (contagem && (contagem.timestamp || contagem.criado_em || contagem.dataHora)) || indice;
    return 'LINHA:' + [codigo, quantidade, timestamp].join('|');
  }

  var RodadaFisicaService = {
    normalizarTexto: normalizarTexto,
    rodadaFisica: rodadaFisica,
    recontagemConcluida: recontagemConcluida,
    idPaleteFisico: idPaleteFisico
  };

  // Node (tests) e browser (app) precisam funcionar sem bundler.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RodadaFisicaService;
  }
  if (global) {
    global.RodadaFisicaService = RodadaFisicaService;
  }

})(typeof window !== 'undefined' ? window : globalThis);
