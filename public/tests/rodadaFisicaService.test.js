'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RodadaFisicaService = require('../js/analista/services/rodadaFisicaService.js');

// ── rodadaFisica ────────────────────────────────────────────────────
// Regra (AUDITORIA_FLUXO_V224.txt): primeira contagem = rodada 1,
// recontagem 1 = rodada 2, recontagem 2 = rodada 3, teto em 3.
test('rodadaFisica: primeira contagem é sempre rodada 1', () => {
  assert.equal(RodadaFisicaService.rodadaFisica({ tipo_contagem: 'PRIMEIRA' }), 1);
  assert.equal(RodadaFisicaService.rodadaFisica({}), 1); // sem tipo_contagem definido
});

test('rodadaFisica: recontagem 1 é rodada 2, recontagem 2 é rodada 3', () => {
  assert.equal(RodadaFisicaService.rodadaFisica({ tipo_contagem: 'RECONTAGEM', numero_recontagem: 1 }), 2);
  assert.equal(RodadaFisicaService.rodadaFisica({ tipo_contagem: 'RECONTAGEM', numero_recontagem: 2 }), 3);
});

test('rodadaFisica: rodada nunca ultrapassa 3, mesmo com numero_recontagem alto', () => {
  assert.equal(RodadaFisicaService.rodadaFisica({ tipo_contagem: 'RECONTAGEM', numero_recontagem: 10 }), 3);
});

test('rodadaFisica: numero_recontagem ausente ou zero em uma RECONTAGEM ainda conta como rodada 2', () => {
  assert.equal(RodadaFisicaService.rodadaFisica({ tipo_contagem: 'RECONTAGEM' }), 2);
  assert.equal(RodadaFisicaService.rodadaFisica({ tipo_contagem: 'RECONTAGEM', numero_recontagem: 0 }), 2);
});

test('rodadaFisica: tipo_contagem é comparado sem diferenciar maiúsculas/espaços nas pontas', () => {
  assert.equal(RodadaFisicaService.rodadaFisica({ tipo_contagem: '  recontagem  ', numero_recontagem: 1 }), 2);
});

// ── recontagemConcluida ─────────────────────────────────────────────
test('recontagemConcluida: null/undefined nunca é concluída', () => {
  assert.equal(RodadaFisicaService.recontagemConcluida(null), false);
  assert.equal(RodadaFisicaService.recontagemConcluida(undefined), false);
});

test('recontagemConcluida: status de rodada aberta nunca é concluída, mesmo com marca de data', () => {
  for (const status of ['CANCELADA', 'EXCLUIDA', 'ESTORNADA', 'PENDENTE', 'ATRIBUIDA', 'ATRIBUÍDA', 'EM_ANDAMENTO', 'ABERTA']) {
    assert.equal(
      RodadaFisicaService.recontagemConcluida({ status, concluida_em: '2026-01-01' }),
      false,
      `status ${status} não deveria contar como concluída`
    );
  }
});

test('recontagemConcluida: marca de conclusão (data) é suficiente mesmo sem status explícito', () => {
  assert.equal(RodadaFisicaService.recontagemConcluida({ concluida_em: '2026-01-01' }), true);
  assert.equal(RodadaFisicaService.recontagemConcluida({ finalizada_em: '2026-01-01' }), true);
  assert.equal(RodadaFisicaService.recontagemConcluida({ data_segunda: '2026-01-01' }), true);
  assert.equal(RodadaFisicaService.recontagemConcluida({ data_terceira: '2026-01-01' }), true);
});

test('recontagemConcluida: status de conclusão é suficiente mesmo sem marca de data', () => {
  for (const status of ['CONCLUIDA', 'CONCLUÍDA', 'FINALIZADA', 'PROCESSADA', 'RESOLVIDA', 'AGUARDANDO_ANALISTA', 'SEM_DIVERGENCIA']) {
    assert.equal(RodadaFisicaService.recontagemConcluida({ status }), true, `status ${status} deveria contar como concluída`);
  }
});

test('recontagemConcluida: sem status e sem marca de data não é concluída', () => {
  assert.equal(RodadaFisicaService.recontagemConcluida({}), false);
});

test('recontagemConcluida: aceita status em status_recontagem OU status', () => {
  assert.equal(RodadaFisicaService.recontagemConcluida({ status_recontagem: 'FINALIZADA' }), true);
});

// ── idPaleteFisico ───────────────────────────────────────────────────
test('idPaleteFisico: prioriza o número do palete quando disponível', () => {
  const chave = RodadaFisicaService.idPaleteFisico({ palete: 'P123', uuid: 'abc' }, 0);
  assert.equal(chave, 'PAL:P123');
});

test('idPaleteFisico: aceita variantes do campo de palete (pallet, sscc, capa...)', () => {
  assert.equal(RodadaFisicaService.idPaleteFisico({ pallet: 'X1' }, 0), 'PAL:X1');
  assert.equal(RodadaFisicaService.idPaleteFisico({ sscc: 'S9' }, 0), 'PAL:S9');
  assert.equal(RodadaFisicaService.idPaleteFisico({ capa: 'C7' }, 0), 'PAL:C7');
});

test('idPaleteFisico: sem palete, cai para uuid/id do documento', () => {
  const chave = RodadaFisicaService.idPaleteFisico({ uuid: 'doc-1' }, 0);
  assert.equal(chave, 'DOC:doc-1');
});

test('idPaleteFisico: sem palete nem uuid, monta fingerprint de linha', () => {
  const chave = RodadaFisicaService.idPaleteFisico(
    { codigo_produto: 'ABC', quantidade: 5, timestamp: 't1' }, 3
  );
  assert.equal(chave, 'LINHA:ABC|5|t1');
});

test('idPaleteFisico: fingerprint de linha usa o índice como último recurso quando não há timestamp', () => {
  const chave = RodadaFisicaService.idPaleteFisico({ codigo_produto: 'ABC', quantidade: 5 }, 7);
  assert.equal(chave, 'LINHA:ABC|5|7');
});

test('idPaleteFisico: duas contagens do mesmo palete físico geram a mesma chave (garante deduplicação)', () => {
  const a = RodadaFisicaService.idPaleteFisico({ palete: 'p-9', quantidade: 10 }, 0);
  const b = RodadaFisicaService.idPaleteFisico({ palete: 'p-9', quantidade: 12 }, 5);
  assert.equal(a, b);
});
