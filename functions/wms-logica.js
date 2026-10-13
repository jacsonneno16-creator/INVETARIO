'use strict';
// Regras de decisão do WMS (pallet logístico BlueSoft), sem acesso a rede nem
// ao banco. O index.js chama estas funções antes de qualquer POST ou gravação,
// e os testes (functions/test/wms-logica.test.js) cobrem os cenários críticos.
//
// Regras centrais:
// - PCP concluído nunca é reenviado pelo WMS.
// - requestId significa só "solicitação recebida": o pallet só é dado como
//   criado/vinculado quando a consulta posterior confirmar.
// - Nunca criar outro WMS sem antes consultar a tentativa anterior.
// - Nunca escolher um pallet quando há mais de um candidato.

// Estados em que já existe uma solicitação ou um vínculo: não criar de novo.
const STATUS_WMS_ABERTOS = ['PROCESSANDO', 'VINCULADO', 'WMS_CRIADO', 'ENDERECADO', 'WMS_VINCULO_AMBIGUO', 'WMS_RESULTADO_INDETERMINADO'];

function normalizarStatusBlueSoft(valor) {
  return String(valor || '').trim().toUpperCase().replace(/\s+/g, '_');
}

function pcpConcluido(d) {
  return d.status === 'APONTADO_BLUESOFT' || (d.integracao && d.integracao.status === 'CONCLUIDO');
}

// Pode solicitar a criação do lote logístico agora?
function podeSolicitarWms({ ativa, cdKey, lojaAtiva, wms }) {
  const w = wms || {};
  if (w.paleteKey != null && w.paleteKey !== '') return { ok: false, motivo: 'ja_vinculado', mensagem: 'Este pallet já está vinculado a um pallet BlueSoft. Não criar outro.' };
  if (w.requestId && w.status === 'PROCESSANDO') return { ok: false, motivo: 'em_andamento', mensagem: 'Já existe uma importação WMS em processamento. Consulte antes de criar outra.' };
  if (w.status === 'WMS_RESULTADO_INDETERMINADO') return { ok: false, motivo: 'indeterminado', mensagem: 'O resultado anterior ficou incerto. Investigue antes de qualquer novo envio.' };
  if (STATUS_WMS_ABERTOS.includes(String(w.status || ''))) return { ok: false, motivo: 'em_andamento', mensagem: 'O WMS deste pallet já foi solicitado. Consulte o status.' };
  if (!ativa) return { ok: false, motivo: 'desligada', mensagem: 'Integração WMS desligada. Nada foi criado na BlueSoft.' };
  if (!(Number(cdKey) > 0)) return { ok: false, motivo: 'sem_cdkey', mensagem: 'Informe o cdKey desta loja na Integração WMS.' };
  if (!lojaAtiva) return { ok: false, motivo: 'loja_inativa', mensagem: 'Esta loja não está ativa na Integração WMS.' };
  return { ok: true };
}

// Pode reprocessar SOMENTE a etapa WMS? Nunca toca no PCP.
function podeReprocessarWms(d) {
  const w = d.wms || {};
  if (!pcpConcluido(d)) return { ok: false, motivo: 'pcp_nao_concluido', mensagem: 'A produção ainda não foi confirmada pela BlueSoft.' };
  if (w.paleteKey != null && w.paleteKey !== '') return { ok: false, motivo: 'ja_vinculado', mensagem: 'O pallet já está vinculado. Não há o que reprocessar.' };
  if (w.requestId && w.status === 'PROCESSANDO') return { ok: false, motivo: 'em_andamento', mensagem: 'A importação ainda está em processamento. Consulte antes.' };
  if (w.status === 'WMS_RESULTADO_INDETERMINADO') return { ok: false, motivo: 'indeterminado', mensagem: 'Resultado incerto: investigue antes de reenviar.' };
  if (!['WMS_FALHA', 'WMS_AGUARDANDO_CONFIGURACAO', 'WMS_SEM_PERMISSAO_MONITORAMENTO'].includes(String(w.status || ''))) {
    return { ok: false, motivo: 'status_nao_reprocessavel', mensagem: 'Só é possível reprocessar o WMS quando ele falhou ou está aguardando configuração.' };
  }
  return { ok: true };
}

// Pode endereçar agora? Exige paleteKey válido vindo da BlueSoft.
function podeEnderecarPallet(d) {
  const w = d.wms || {};
  if (w.status === 'ENDERECADO') return { ok: false, motivo: 'ja_enderecado', mensagem: 'Este pallet já foi endereçado.' };
  if (!(Number(w.paleteKey) > 0)) return { ok: false, motivo: 'sem_palete', mensagem: 'O pallet ainda não está vinculado à BlueSoft (paleteKey ausente).' };
  if (w.status !== 'VINCULADO') return { ok: false, motivo: 'nao_vinculado', mensagem: 'O vínculo com a BlueSoft ainda não foi confirmado.' };
  return { ok: true };
}

// Candidatos compatíveis com o pallet: mesmo produto e, quando informado, mesmo lote.
function filtrarCandidatosPallet(lista, { produtoKey, numeroLote }) {
  const arr = Array.isArray(lista) ? lista : [];
  return arr.filter(p => p && p.paleteKey != null && Number(p.produtoKey) === Number(produtoKey) && (!numeroLote || String(p.numeroDoLote || '') === String(numeroLote)));
}

// Interpreta a resposta do acompanhamento do request WMS. Não cria nada.
// Retorna { status, dados } ou { status: null, desconhecido: true }.
function decidirAcompanhamentoWms(resp, { produtoKey, numeroLoteAtual, candidatos }) {
  const st = normalizarStatusBlueSoft((resp && resp.status) || '');
  if (st === 'AGUARDANDO' || st === 'EM_PROCESSAMENTO') return { status: 'PROCESSANDO', dados: {} };
  if (st === 'FALHA') {
    const log = String((resp && resp.log) || 'Importação de lote falhou na BlueSoft.').slice(0, 500);
    return { status: 'WMS_FALHA', dados: { erro: log } };
  }
  if (st !== 'FINALIZADO') return { status: null, desconhecido: true, dados: {} };
  const lotes = Array.isArray(resp.lotesGerados) ? resp.lotesGerados : [];
  if (!lotes.length) {
    return { status: 'WMS_AGUARDANDO_CONFIGURACAO', dados: { erro: "A BlueSoft recebeu a importação, mas não gerou pallet. Verifique o parâmetro 'Gerar lote automático na Importação de lotes logísticos'." } };
  }
  const lote = lotes[0] || {};
  const numeroLote = String(lote.numeroDoLote || lote.numeroLote || numeroLoteAtual || '');
  const cands = filtrarCandidatosPallet(candidatos, { produtoKey, numeroLote });
  if (cands.length === 1) {
    const c = cands[0];
    return {
      status: 'VINCULADO',
      dados: {
        paleteKey: Number(c.paleteKey),
        logisticaLoteItemKey: c.logisticaLoteItemKey != null ? Number(c.logisticaLoteItemKey) : (lote.logisticaLoteItemKey != null ? Number(lote.logisticaLoteItemKey) : null),
        numeroLoteLogistico: numeroLote,
        enderecoLogisticoKey: c.enderecoLogisticoKey != null ? Number(c.enderecoLogisticoKey) : null,
        enderecoDescritivo: c.enderecoDescritivo || null,
        erro: null
      }
    };
  }
  if (cands.length > 1) {
    return { status: 'WMS_VINCULO_AMBIGUO', dados: { numeroLoteLogistico: numeroLote, erro: 'Mais de um pallet BlueSoft compatível com este lote. Resolva manualmente.' } };
  }
  return { status: 'WMS_CRIADO', dados: { numeroLoteLogistico: numeroLote, erro: 'Lote criado na BlueSoft, mas o pallet ainda não apareceu na consulta de endereçamento.' } };
}

// Classifica um erro da BlueSoft para mostrar a mensagem certa e decidir o estado.
// contexto: 'monitoramento' quando veio da consulta assíncrona (4047).
function classificarErroBluesoft(e, contexto) {
  const s = e && e.status;
  if (s === 401) return { tipo: 'autenticacao', mensagem: 'Token BlueSoft recusado (401). Verifique a integração.' };
  if (s === 403) {
    const extra = contexto === 'monitoramento' ? ' para consultar processamento assíncrono (4047)' : '';
    return { tipo: 'permissao', mensagem: 'A credencial BlueSoft não possui permissão' + extra + '.' };
  }
  if (e && e.apTipo === 'incerto') return { tipo: 'incerto', mensagem: 'Resultado incerto: não reenviar sem investigar. ' + String(e.message || '').slice(0, 300) };
  return { tipo: 'rejeitado', mensagem: String((e && e.message) || e || '').slice(0, 300) };
}

// A BlueSoft não documenta o formato da resposta de NENHUM dos dois endpoints de
// apontamento de produção. Ao vivo, o endpoint SEM ficha técnica (síncrono, por
// documentação) também devolveu um campo parecido com requestId — então decidir
// "é assíncrono" pela presença de requestId no corpo estava errado (fez pallets
// de verdade ficarem presos em PROCESSANDO pra sempre, sem requestId de verdade
// pra consultar). A decisão certa é pelo ENDPOINT usado, não pelo corpo da
// resposta: só o endpoint com ficha técnica é assíncrono (documentado assim).
function apontamentoEhAssincrono(fichaTecnicaKey) {
  return fichaTecnicaKey != null && Number(fichaTecnicaKey) > 0;
}
// Decide o que gravar logo depois do POST de produção ter respondido sucesso.
// NUNCA interpreta o corpo da resposta sozinho: a decisão vem de fichaTecnicaKey.
function decidirAposPostPcp({ fichaTecnicaKey, requestId }) {
  if (apontamentoEhAssincrono(fichaTecnicaKey)) {
    if (!requestId) return { status: 'ERRO_INCERTO', mensagem: 'A BlueSoft não devolveu requestId para o apontamento por ficha técnica (endpoint assíncrono). Confira manualmente antes de reenviar.' };
    return { status: 'PROCESSANDO', requestId: requestId };
  }
  // Endpoint sem ficha técnica é sempre síncrono: sucesso HTTP já é a confirmação,
  // mesmo que o corpo da resposta tenha algum campo parecido com requestId.
  return { status: 'APONTADO_BLUESOFT' };
}

// Permissão do módulo de apontamento (espelha _apPerm do backend).
function podeAcaoApontamento(acesso, acao) {
  if (!acesso) return false;
  if (acesso.perfil === 'administrador' || acesso.admin_mestre === true || acesso.administrador_mestre === true) return true;
  const m = acesso.permissoes && acesso.permissoes['estoque-rel-apontamento'];
  return Boolean(m && m[acao] === true);
}

module.exports = {
  STATUS_WMS_ABERTOS,
  normalizarStatusBlueSoft,
  pcpConcluido,
  podeSolicitarWms,
  podeReprocessarWms,
  podeEnderecarPallet,
  filtrarCandidatosPallet,
  decidirAcompanhamentoWms,
  classificarErroBluesoft,
  podeAcaoApontamento,
  apontamentoEhAssincrono,
  decidirAposPostPcp
};
