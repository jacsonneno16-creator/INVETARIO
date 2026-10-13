// Testes dos cenários críticos do WMS (pallet logístico BlueSoft).
// As regras estão em wms-logica.js; a chamada real à BlueSoft fica para homologação.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('../wms-logica');

const LOJA_ATIVA = true;
const CD = 400;
const PCP_OK = { status: 'APONTADO_BLUESOFT', integracao: { status: 'CONCLUIDO' } };

// ---- Solicitação de criação do lote ----
test('integracaoWmsAtiva = false: nada é solicitado', () => {
  const r = w.podeSolicitarWms({ ativa: false, cdKey: CD, lojaAtiva: LOJA_ATIVA, wms: {} });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'desligada');
});

test('loja sem cdKey: não solicita e pede o cdKey', () => {
  const r = w.podeSolicitarWms({ ativa: true, cdKey: null, lojaAtiva: LOJA_ATIVA, wms: {} });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'sem_cdkey');
});

test('loja WMS inativa: não solicita', () => {
  const r = w.podeSolicitarWms({ ativa: true, cdKey: CD, lojaAtiva: false, wms: {} });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'loja_inativa');
});

test('tudo certo: solicita', () => {
  assert.deepEqual(w.podeSolicitarWms({ ativa: true, cdKey: CD, lojaAtiva: LOJA_ATIVA, wms: {} }), { ok: true });
});

test('tentativa de criar WMS duas vezes: bloqueada quando já há requestId em processamento', () => {
  const r = w.podeSolicitarWms({ ativa: true, cdKey: CD, lojaAtiva: LOJA_ATIVA, wms: { status: 'PROCESSANDO', requestId: 'r1' } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'em_andamento');
});

test('pallet já vinculado: nunca cria outro pallet', () => {
  const r = w.podeSolicitarWms({ ativa: true, cdKey: CD, lojaAtiva: LOJA_ATIVA, wms: { status: 'VINCULADO', paleteKey: 20448 } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ja_vinculado');
});

test('resultado indeterminado anterior: não envia outro POST sem investigar', () => {
  const r = w.podeSolicitarWms({ ativa: true, cdKey: CD, lojaAtiva: LOJA_ATIVA, wms: { status: 'WMS_RESULTADO_INDETERMINADO' } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'indeterminado');
});

// ---- Acompanhamento do request (AGUARDANDO / EM PROCESSAMENTO / FINALIZADO / FALHA) ----
test('resposta AGUARDANDO: continua processando, sem vínculo', () => {
  const r = w.decidirAcompanhamentoWms({ status: 'AGUARDANDO' }, { produtoKey: 1, candidatos: [] });
  assert.equal(r.status, 'PROCESSANDO');
  assert.equal(r.dados.paleteKey, undefined);
});

test('resposta EM PROCESSAMENTO: continua processando', () => {
  const r = w.decidirAcompanhamentoWms({ status: 'EM PROCESSAMENTO' }, { produtoKey: 1, candidatos: [] });
  assert.equal(r.status, 'PROCESSANDO');
});

test('resposta FALHA: marca falha com o log, sem inventar vínculo', () => {
  const r = w.decidirAcompanhamentoWms({ status: 'FALHA', log: 'Produto sem cadastro logístico' }, { produtoKey: 1, candidatos: [] });
  assert.equal(r.status, 'WMS_FALHA');
  assert.equal(r.dados.erro, 'Produto sem cadastro logístico');
  assert.equal(r.dados.paleteKey, undefined);
});

test('FINALIZADO sem lote gerado: aguarda configuração com a mensagem do parâmetro', () => {
  const r = w.decidirAcompanhamentoWms({ status: 'FINALIZADO', lotesGerados: [] }, { produtoKey: 1, candidatos: [] });
  assert.equal(r.status, 'WMS_AGUARDANDO_CONFIGURACAO');
  assert.match(r.dados.erro, /Gerar lote automático na Importação de lotes logísticos/);
});

test('status desconhecido: não altera nada', () => {
  const r = w.decidirAcompanhamentoWms({ status: 'ALGO_NOVO' }, { produtoKey: 1, candidatos: [] });
  assert.equal(r.desconhecido, true);
  assert.equal(r.status, null);
});

// ---- Vínculo Capa DT ↔ paleteKey ----
const LOTE_OK = { status: 'FINALIZADO', lotesGerados: [{ numeroDoLote: 'L24001', logisticaLoteItemKey: 555 }] };

test('um único pallet compatível: vincula com paleteKey, sem misturar com a Capa DT', () => {
  const cands = [{ paleteKey: 20448, produtoKey: 12345, numeroDoLote: 'L24001', enderecoLogisticoKey: 960, enderecoDescritivo: '14.1520.1.4.1.1.1' }];
  const r = w.decidirAcompanhamentoWms(LOTE_OK, { produtoKey: 12345, numeroLoteAtual: 'L24001', candidatos: cands });
  assert.equal(r.status, 'VINCULADO');
  assert.equal(r.dados.paleteKey, 20448);
  assert.equal(r.dados.numeroLoteLogistico, 'L24001');
  assert.equal(r.dados.logisticaLoteItemKey, 555);
  assert.equal(r.dados.enderecoLogisticoKey, 960);
  assert.equal(r.dados.capaDt, undefined, 'a Capa DT não pode entrar no vínculo como paleteKey');
});

test('vários pallets compatíveis: WMS_VINCULO_AMBIGUO, nada escolhido', () => {
  const cands = [
    { paleteKey: 1, produtoKey: 12345, numeroDoLote: 'L24001' },
    { paleteKey: 2, produtoKey: 12345, numeroDoLote: 'L24001' }
  ];
  const r = w.decidirAcompanhamentoWms(LOTE_OK, { produtoKey: 12345, numeroLoteAtual: 'L24001', candidatos: cands });
  assert.equal(r.status, 'WMS_VINCULO_AMBIGUO');
  assert.equal(r.dados.paleteKey, undefined);
});

test('nenhum pallet encontrado: fica como WMS_CRIADO, não vinculado', () => {
  const cands = [{ paleteKey: 9, produtoKey: 99999, numeroDoLote: 'OUTRO' }];
  const r = w.decidirAcompanhamentoWms(LOTE_OK, { produtoKey: 12345, numeroLoteAtual: 'L24001', candidatos: cands });
  assert.equal(r.status, 'WMS_CRIADO');
  assert.equal(r.dados.paleteKey, undefined);
});

test('candidato sem paleteKey não conta como pallet', () => {
  const cands = [{ produtoKey: 12345, numeroDoLote: 'L24001' }];
  const r = w.decidirAcompanhamentoWms(LOTE_OK, { produtoKey: 12345, numeroLoteAtual: 'L24001', candidatos: cands });
  assert.notEqual(r.status, 'VINCULADO');
});

// ---- Reprocessar somente WMS ----
test('tentativa de reprocessar PCP indevidamente: recusado quando a produção não foi confirmada', () => {
  const r = w.podeReprocessarWms({ status: 'CONFERIDO_APROVADO', wms: { status: 'WMS_FALHA' } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'pcp_nao_concluido');
});

test('reprocessar WMS após falha, com PCP concluído: permitido', () => {
  const r = w.podeReprocessarWms({ ...PCP_OK, wms: { status: 'WMS_FALHA' } });
  assert.equal(r.ok, true);
});

test('reprocessar WMS já vinculado: recusado', () => {
  const r = w.podeReprocessarWms({ ...PCP_OK, wms: { status: 'VINCULADO', paleteKey: 20448 } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ja_vinculado');
});

test('reprocessar com resultado indeterminado: recusado até investigar', () => {
  const r = w.podeReprocessarWms({ ...PCP_OK, wms: { status: 'WMS_RESULTADO_INDETERMINADO' } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'indeterminado');
});

// ---- Endereçamento ----
test('endereçamento sem paleteKey: recusado', () => {
  const r = w.podeEnderecarPallet({ wms: { status: 'VINCULADO', paleteKey: null } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'sem_palete');
});

test('endereçamento com vínculo válido: permitido', () => {
  const r = w.podeEnderecarPallet({ wms: { status: 'VINCULADO', paleteKey: 20448 } });
  assert.equal(r.ok, true);
});

test('endereçamento de pallet já endereçado: recusado', () => {
  const r = w.podeEnderecarPallet({ wms: { status: 'ENDERECADO', paleteKey: 20448 } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ja_enderecado');
});

test('endereçamento sem vínculo confirmado (só requestId): recusado', () => {
  const r = w.podeEnderecarPallet({ wms: { status: 'PROCESSANDO', requestId: 'r1' } });
  assert.equal(r.ok, false);
});

// ---- Síncrono (sem ficha técnica) × assíncrono (com ficha técnica) ----
// Bug ao vivo real: a BlueSoft devolveu um campo parecido com requestId mesmo no
// endpoint SEM ficha técnica (documentado como síncrono), e o pallet ficou preso
// em PROCESSANDO pra sempre, sem requestId de verdade pra consultar.
test('endpoint sem ficha técnica com resposta "parecida com async": confirma na hora, nunca fica PROCESSANDO', () => {
  const r = w.decidirAposPostPcp({ fichaTecnicaKey: null, requestId: 'ALGO-QUE-PARECE-UM-ID' });
  assert.equal(r.status, 'APONTADO_BLUESOFT');
});

test('endpoint sem ficha técnica sem nenhum campo extra: confirma na hora', () => {
  const r = w.decidirAposPostPcp({ fichaTecnicaKey: null, requestId: null });
  assert.equal(r.status, 'APONTADO_BLUESOFT');
});

test('endpoint com ficha técnica e requestId de verdade: fica PROCESSANDO, aguardando o monitoramento', () => {
  const r = w.decidirAposPostPcp({ fichaTecnicaKey: 6322, requestId: 'req-123' });
  assert.equal(r.status, 'PROCESSANDO');
  assert.equal(r.requestId, 'req-123');
});

test('endpoint com ficha técnica sem requestId: fica incerto, nunca vira PROCESSANDO nem APONTADO sozinho', () => {
  const r = w.decidirAposPostPcp({ fichaTecnicaKey: 6322, requestId: null });
  assert.equal(r.status, 'ERRO_INCERTO');
});

test('apontamentoEhAssincrono: só é assíncrono quando há fichaTecnicaKey válido', () => {
  assert.equal(w.apontamentoEhAssincrono(null), false);
  assert.equal(w.apontamentoEhAssincrono(0), false);
  assert.equal(w.apontamentoEhAssincrono(6322), true);
});

// ---- Erros da BlueSoft ----
test('erro de autenticação (401): classificado como autenticação', () => {
  assert.equal(w.classificarErroBluesoft({ status: 401, message: 'x' }).tipo, 'autenticacao');
});

test('erro de permissão 4047 na consulta assíncrona: mensagem específica', () => {
  const r = w.classificarErroBluesoft({ status: 403, message: 'x' }, 'monitoramento');
  assert.equal(r.tipo, 'permissao');
  assert.match(r.mensagem, /4047/);
});

test('erro indeterminado (rede/5xx): não repetir sem investigar', () => {
  const r = w.classificarErroBluesoft({ apTipo: 'incerto', message: 'timeout' });
  assert.equal(r.tipo, 'incerto');
  assert.match(r.mensagem, /não reenviar/);
});

// ---- Permissões ----
test('sem acesso: nenhuma ação', () => {
  assert.equal(w.podeAcaoApontamento(null, 'criar'), false);
});

test('administrador: todas as ações', () => {
  assert.equal(w.podeAcaoApontamento({ perfil: 'administrador' }, 'reprocessar'), true);
});

test('usuário da produção com só criar: não aprova nem reprova', () => {
  const acesso = { permissoes: { 'estoque-rel-apontamento': { criar: true, visualizar: true } } };
  assert.equal(w.podeAcaoApontamento(acesso, 'criar'), true);
  assert.equal(w.podeAcaoApontamento(acesso, 'conferir'), false);
  assert.equal(w.podeAcaoApontamento(acesso, 'reprocessar'), false);
});
