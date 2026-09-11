// PEDIDO AO VIVO (2026-09-11, Fase 2 do espelho BigQuery): Indicadores de
// Retornos (98-recebimento-retornos-indicadores.js) baixava recebimento_
// recusas inteiro do período pro navegador agregar — investigado com o
// usuário por que a Bluesoft ("consulta de 1 ano, milhões de linha") não
// demora e este sistema demora: lá quem agrega é o servidor, aqui era
// sempre o navegador. buscarIndicadoresRetornosBigQuery lê da view
// "_raw_latest" (extensão firestore-bigquery-export, já resolve create/
// update/delete pro estado mais recente) e devolve os documentos crus no
// MESMO formato {_id, ...dados} que o Firestore já devolvia — o cliente
// continua agregando/filtrando exatamente igual, só a origem muda.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function carregarComFirestoreFake() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  admin.initializeApp = () => {};
  // Esta função não toca em `db` — só precisa que o módulo carregue sem
  // quebrar no `admin.firestore()` do topo do arquivo.
  Object.defineProperty(admin, 'firestore', {value: () => ({}), configurable: true});
  const indexModule = require(path.join(__dirname, '..', 'index.js'));
  return indexModule._graphBiInternals;
}

function bigqueryFake(linhas) {
  const chamadas = [];
  return {
    _chamadas: chamadas,
    query: async (opts) => {
      chamadas.push(opts);
      return [linhas];
    },
  };
}

const ACESSO_TODAS_LOJAS = {acesso_todas_lojas: true};
const ACESSO_LOJA_MATRIZ = {lojas_permitidas: ['loja_matriz']};
const ACESSO_ADMIN_MESTRE = {admin_mestre: true};

test('_lojaPermitidaParaAcesso: admin_mestre e acesso_todas_lojas sempre passam; login restrito só passa pra loja da lista', () => {
  const {_lojaPermitidaParaAcesso} = carregarComFirestoreFake();
  assert.equal(_lojaPermitidaParaAcesso(ACESSO_ADMIN_MESTRE, 'qualquer_loja'), true);
  assert.equal(_lojaPermitidaParaAcesso(ACESSO_TODAS_LOJAS, 'qualquer_loja'), true);
  assert.equal(_lojaPermitidaParaAcesso(ACESSO_LOJA_MATRIZ, 'loja_matriz'), true);
  assert.equal(_lojaPermitidaParaAcesso(ACESSO_LOJA_MATRIZ, 'loja_filial'), false);
});

test('busca por período: monta a query certa (view _raw_latest, filtro por loja/período/exclusão de AUTOMATICO) e devolve documentos no formato {_id, ...dados}', async () => {
  const {_buscarIndicadoresRetornosBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([
    {document_id: 'r1', data: JSON.stringify({criadoEm: '2026-08-10T10:00:00.000Z', motivoNome: 'Avaria', pallets: 2})},
    {document_id: 'r2', data: JSON.stringify({criadoEm: '2026-08-15T10:00:00.000Z', motivoNome: 'Troca', pallets: 1})},
  ]);
  const resultado = await _buscarIndicadoresRetornosBigQueryInterno({lojaId: 'loja_matriz', ini: '2026-08-01', fim: '2026-08-31'}, ACESSO_TODAS_LOJAS, bq);
  assert.equal(resultado.length, 2);
  assert.equal(resultado[0]._id, 'r1');
  assert.equal(resultado[0].motivoNome, 'Avaria');
  assert.equal(resultado[1]._id, 'r2');

  const chamada = bq._chamadas[0];
  assert.match(chamada.query, /recebimento_recusas_raw_latest/);
  assert.match(chamada.query, /operation != 'DELETE'/);
  assert.match(chamada.query, /AUTOMATICO/);
  assert.equal(chamada.params.lojaId, 'loja_matriz');
  assert.equal(chamada.params.inicioIso, '2026-08-01T00:00:00.000Z');
  assert.equal(chamada.params.fimIso, '2026-08-31T23:59:59.999Z');
});

test('login sem acesso a esta loja: rejeita antes de consultar o BigQuery', async () => {
  const {_buscarIndicadoresRetornosBigQueryInterno} = carregarComFirestoreFake();
  const bq = bigqueryFake([]);
  await assert.rejects(
    () => _buscarIndicadoresRetornosBigQueryInterno({lojaId: 'loja_filial', ini: '2026-08-01', fim: '2026-08-31'}, ACESSO_LOJA_MATRIZ, bq),
    /não tem acesso a esta loja/
  );
  assert.equal(bq._chamadas.length, 0, 'nem chega a consultar o BigQuery sem permissão');
});

test('sem lojaId: rejeita com mensagem clara', async () => {
  const {_buscarIndicadoresRetornosBigQueryInterno} = carregarComFirestoreFake();
  await assert.rejects(
    () => _buscarIndicadoresRetornosBigQueryInterno({lojaId: '', ini: '2026-08-01', fim: '2026-08-31'}, ACESSO_TODAS_LOJAS, bigqueryFake([])),
    /Loja não informada/
  );
});

test('período em formato errado ou maior que 2 anos: rejeita', async () => {
  const {_buscarIndicadoresRetornosBigQueryInterno} = carregarComFirestoreFake();
  await assert.rejects(
    () => _buscarIndicadoresRetornosBigQueryInterno({lojaId: 'loja_matriz', ini: '01/08/2026', fim: '2026-08-31'}, ACESSO_TODAS_LOJAS, bigqueryFake([])),
    /Período inválido/
  );
  await assert.rejects(
    () => _buscarIndicadoresRetornosBigQueryInterno({lojaId: 'loja_matriz', ini: '2020-01-01', fim: '2026-08-31'}, ACESSO_TODAS_LOJAS, bigqueryFake([])),
    /até 2 anos/
  );
});

test('sem nenhum resultado no período: devolve lista vazia, não quebra', async () => {
  const {_buscarIndicadoresRetornosBigQueryInterno} = carregarComFirestoreFake();
  const resultado = await _buscarIndicadoresRetornosBigQueryInterno({lojaId: 'loja_matriz', ini: '2026-08-01', fim: '2026-08-31'}, ACESSO_TODAS_LOJAS, bigqueryFake([]));
  assert.deepEqual(resultado, []);
});
