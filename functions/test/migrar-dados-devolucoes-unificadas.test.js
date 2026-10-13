// Devoluções unificadas (2026-10-13): testa a lógica pura de
// scripts/migrar-dados-devolucoes-unificadas.js — backfill de
// devolucoes_notas/devolucoes_recebimentos a partir do histórico ANTIGO de
// recebimento_recusas (origem:'AUTOMATICO' = devolução fiscal; qualquer
// outra origem na MESMA chave = retorno físico já confirmado).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { montarPlanoDaLoja, classificarMotivoTexto, extrairRede } = require(path.join(__dirname, '..', '..', 'scripts', 'migrar-dados-devolucoes-unificadas.js'));

const CHAVE1 = '33333333333333333333333333333333333333333336';
const CHAVE2 = '44444444444444444444444444444444444444444448';
const AGORA = '2026-10-13T12:00:00.000Z';

function docAutomatico(chave, overrides) {
  return { id: 'auto-' + chave, data: Object.assign({
    chaves: [chave], origem: 'AUTOMATICO', criadoEm: '2026-05-01T08:00:00.000Z',
    dataEmissao: '2026-04-30', destinatario: 'ASSAI - 278', valorTotal: 150.5,
    motivoAutomaticoTexto: 'FALTA DE PRODUTO NA ENTREGA',
    notas: [{ chave, numeroNota: '777', dataEmissao: '2026-04-30', destinatario: 'ASSAI - 278', valorTotal: 150.5, itens: [{ descricao: 'Produto Y', quantidade: 2 }] }],
  }, overrides) };
}
function docFisico(chave, overrides) {
  return { id: 'fis-' + chave, data: Object.assign({ chaves: [chave], origem: 'COLETOR', criadoEm: '2026-05-05T10:00:00.000Z', criadoPorEmail: 'operador@daterrinha.com' }, overrides) };
}

test('chave sem nenhum doc AUTOMATICO não é tocada — não é devolução conhecida por este histórico', () => {
  const plano = montarPlanoDaLoja('matriz', [docFisico(CHAVE1)], new Set(), new Set(), AGORA);
  assert.equal(plano.totalChavesComAutomatico, 0);
  assert.equal(plano.notasParaCriar.length, 0);
});

test('AUTOMATICO sem nenhum outro doc na mesma chave → PENDENTE, sem devolucoes_recebimentos', () => {
  const plano = montarPlanoDaLoja('matriz', [docAutomatico(CHAVE1)], new Set(), new Set(), AGORA);
  assert.equal(plano.pendentes, 1);
  assert.equal(plano.recebidas, 0);
  assert.equal(plano.notasParaCriar.length, 1);
  const nota = plano.notasParaCriar[0].payload;
  assert.equal(nota.estado, 'PENDENTE');
  assert.equal(nota.chave, CHAVE1);
  assert.equal(nota.numeroNota, '777');
  assert.equal(nota.motivoNormalizado, 'FALTA NA CARGA/ENTREGA');
  assert.equal(nota.rede, 'ASSAI');
  assert.equal(plano.recebimentosParaCriar.length, 0);
});

test('AUTOMATICO + doc físico (COLETOR) na mesma chave → RECEBIDA, cria devolucoes_recebimentos com quem/quando confirmou', () => {
  const plano = montarPlanoDaLoja('matriz', [docAutomatico(CHAVE1), docFisico(CHAVE1)], new Set(), new Set(), AGORA);
  assert.equal(plano.recebidas, 1);
  assert.equal(plano.pendentes, 0);
  const nota = plano.notasParaCriar[0].payload;
  assert.equal(nota.estado, 'RECEBIDA');
  assert.equal(nota.recebidoPor, 'operador@daterrinha.com');
  assert.equal(nota.origemRecebimento, 'MIGRACAO_HISTORICO');
  assert.equal(plano.recebimentosParaCriar.length, 1);
  const rec = plano.recebimentosParaCriar[0].payload;
  assert.equal(rec.origem, 'COLETOR');
  assert.equal(rec.confirmadoPor, 'operador@daterrinha.com');
  assert.equal(rec.chave, CHAVE1);
});

test('duas chaves diferentes são processadas independentemente (uma PENDENTE, outra RECEBIDA)', () => {
  const plano = montarPlanoDaLoja('matriz', [docAutomatico(CHAVE1), docAutomatico(CHAVE2), docFisico(CHAVE2)], new Set(), new Set(), AGORA);
  assert.equal(plano.totalChavesComAutomatico, 2);
  assert.equal(plano.pendentes, 1);
  assert.equal(plano.recebidas, 1);
});

test('idempotente: chave cujo devolucoes_notas já existe é pulada (nunca sobrescreve)', () => {
  const plano = montarPlanoDaLoja('matriz', [docAutomatico(CHAVE1)], new Set([CHAVE1]), new Set(), AGORA);
  assert.equal(plano.jaExistiamNotas, 1);
  assert.equal(plano.notasParaCriar.length, 0);
});

test('idempotente: devolucoes_recebimentos que já existe não é recriado, mesmo recriando a nota', () => {
  const plano = montarPlanoDaLoja('matriz', [docAutomatico(CHAVE1), docFisico(CHAVE1)], new Set(), new Set([CHAVE1]), AGORA);
  assert.equal(plano.jaExistiamRecebimentos, 1);
  assert.equal(plano.recebimentosParaCriar.length, 0);
  assert.equal(plano.notasParaCriar.length, 1, 'a nota ainda é criada/atualizada — só o recebimento é que não duplica');
});

test('com 2 docs físicos na mesma chave, usa o mais ANTIGO (quem confirmou primeiro de verdade)', () => {
  const maisAntigo = docFisico(CHAVE1, { id: 'fis-antigo', criadoEm: '2026-05-02T09:00:00.000Z', criadoPorEmail: 'primeiro@daterrinha.com' });
  maisAntigo.id = 'fis-antigo';
  const maisNovo = docFisico(CHAVE1, { criadoEm: '2026-05-10T09:00:00.000Z', criadoPorEmail: 'segundo@daterrinha.com' });
  const plano = montarPlanoDaLoja('matriz', [docAutomatico(CHAVE1), maisNovo, maisAntigo], new Set(), new Set(), AGORA);
  assert.equal(plano.recebimentosParaCriar[0].payload.confirmadoPor, 'primeiro@daterrinha.com');
});

test('classificarMotivoTexto: motivos historicamente descartados (Troca/Avaria/Vencido/Impróprio/sem motivo) não têm representação no histórico, documentado como cobertura parcial', () => {
  // Nenhum destes NUNCA teve doc AUTOMATICO gravado (eram descartados na
  // importação antiga) — este teste só confirma que a função de
  // classificação em si continua reconhecendo essas categorias, caso um
  // doc ANTIGO de outra origem as contenha por algum motivo.
  assert.equal(classificarMotivoTexto('TROCA DE PRODUTO'), 'TROCA');
  assert.equal(classificarMotivoTexto('PRODUTO VENCIDO'), 'VENCIDO/VENCIMENTO');
  assert.equal(classificarMotivoTexto('texto qualquer sem motivo'), '(SEM MOTIVO NO TEXTO)');
});

test('extrairRede: pega o prefixo antes de " - "', () => {
  assert.equal(extrairRede('ASSAI - 278'), 'ASSAI');
  assert.equal(extrairRede('Mercado Novo'), 'Mercado Novo');
});
