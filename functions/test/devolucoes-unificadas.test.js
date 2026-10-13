// Devoluções unificadas (2026-10-13): catálogo fiscal (devolucoes_notas),
// confirmação atômica de recebimento (devolucoes_recebimentos, 1 doc por
// chave via transação) e consulta/listagem via BigQuery com fallback
// Firestore. Ver C:\Users\Daterrinha69\.claude\plans\smooth-moseying-seal.md
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Fake Firestore com coleções aninhadas (lojas/{id}/devolucoes_notas/{chave})
// + runTransaction de verdade (reads antes de writes, igual ao Firestore
// real) — tx.create lança se o doc já existe no momento do commit, mesma
// garantia que o SDK real dá (ver _confirmarRecebimentoDevolucaoInterno).
function criarFirestoreFake(seed) {
  const dados = new Map(Object.entries(seed || {}));
  function colRef(prefixo) {
    return {
      doc(id) {
        const caminho = prefixo + '/' + id;
        return {
          id, _path: caminho,
          collection(nome) { return colRef(caminho + '/' + nome); },
          async get() { return { exists: dados.has(caminho), id, data: () => dados.get(caminho) }; },
        };
      },
      async get() {
        const pfx = prefixo + '/';
        const docs = [];
        dados.forEach((valor, caminho) => {
          if (caminho.startsWith(pfx) && !caminho.slice(pfx.length).includes('/')) docs.push({ id: caminho.slice(pfx.length), data: () => valor });
        });
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  return {
    fake: {
      collection(nome) { return colRef(nome); },
      async runTransaction(fn) {
        const tx = {
          get: async (ref) => dados.has(ref._path) ? { exists: true, data: () => dados.get(ref._path) } : { exists: false, data: () => undefined },
          set: (ref, payload, opts) => {
            const atual = dados.get(ref._path) || {};
            dados.set(ref._path, (opts && opts.merge) ? { ...atual, ...payload } : { ...payload });
          },
          create: (ref, payload) => {
            if (dados.has(ref._path)) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; }
            dados.set(ref._path, { ...payload });
          },
        };
        return fn(tx);
      },
    },
    dados,
  };
}

function carregarComFirestoreFake(seed) {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  const { fake, dados } = criarFirestoreFake(seed);
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', { value: () => fake, configurable: true });
  const indexModule = require(path.join(__dirname, '..', 'index.js'));
  return { internals: indexModule._graphBiInternals, fake, dados };
}

const CHAVE = '33333333333333333333333333333333333333333331';
const ACESSO_ADMIN = { acesso_todas_lojas: true };
const ACESSO_LOJA1 = { lojas_permitidas: ['loja1'] };
const ACESSO_LOJA2 = { lojas_permitidas: ['loja2'] };

test('_confirmarRecebimentoDevolucaoInterno: 1ª confirmação cria devolucoes_recebimentos e vira RECEBIDA', async () => {
  const { internals, dados, fake } = carregarComFirestoreFake({
    ['lojas/loja1/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'loja1', estado: 'PENDENTE', dataEmissao: '2026-10-01' },
  });
  const r = await internals._confirmarRecebimentoDevolucaoInterno({ lojaId: 'loja1', chave: CHAVE, origem: 'ANALISTA', relatorioId: 'rel1' }, ACESSO_LOJA1, fake);
  assert.equal(r.jaRecebida, false);
  const nota = dados.get('lojas/loja1/devolucoes_notas/' + CHAVE);
  assert.equal(nota.estado, 'RECEBIDA');
  assert.equal(nota.origemRecebimento, 'ANALISTA');
  const rec = dados.get('lojas/loja1/devolucoes_recebimentos/' + CHAVE);
  assert.ok(rec);
  assert.equal(rec.origem, 'ANALISTA');
  assert.equal(rec.relatorioId, 'rel1');
});

test('_confirmarRecebimentoDevolucaoInterno: 2ª confirmação da MESMA chave (ex.: Coletor depois do Analista) não cria outro recebimento — devolve jaRecebida com os dados do primeiro', async () => {
  const { internals, dados, fake } = carregarComFirestoreFake({
    ['lojas/loja1/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'loja1', estado: 'PENDENTE' },
  });
  const r1 = await internals._confirmarRecebimentoDevolucaoInterno({ lojaId: 'loja1', chave: CHAVE, origem: 'ANALISTA', relatorioId: 'rel1' }, ACESSO_LOJA1, fake);
  assert.equal(r1.jaRecebida, false);
  const r2 = await internals._confirmarRecebimentoDevolucaoInterno({ lojaId: 'loja1', chave: CHAVE, origem: 'COLETOR' }, ACESSO_LOJA1, fake);
  assert.equal(r2.jaRecebida, true, 'segunda tentativa não deve criar um novo recebimento');
  assert.equal(r2.recebimento.origem, 'ANALISTA', 'devolve o primeiro recebimento (quem chegou primeiro venceu), não o do Coletor');
  // Só existe 1 doc de recebimento pra essa chave — nunca dois.
  let count = 0;
  dados.forEach((v, k) => { if (k === 'lojas/loja1/devolucoes_recebimentos/' + CHAVE) count++; });
  assert.equal(count, 1);
});

test('_confirmarRecebimentoDevolucaoInterno: chave sem nota no catálogo fiscal falha com not-found, nunca confirma às cegas', async () => {
  const { internals, fake } = carregarComFirestoreFake({});
  await assert.rejects(
    internals._confirmarRecebimentoDevolucaoInterno({ lojaId: 'loja1', chave: CHAVE, origem: 'ANALISTA' }, ACESSO_LOJA1, fake),
    /Nota de devolução não encontrada/
  );
});

test('_confirmarRecebimentoDevolucaoInterno: usuário sem acesso à loja da nota é recusado, mesmo com chave válida', async () => {
  const { internals, fake } = carregarComFirestoreFake({
    ['lojas/loja1/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'loja1', estado: 'PENDENTE' },
  });
  await assert.rejects(
    internals._confirmarRecebimentoDevolucaoInterno({ lojaId: 'loja1', chave: CHAVE, origem: 'ANALISTA' }, ACESSO_LOJA2, fake),
    /não tem acesso a esta loja/
  );
});

test('_confirmarRecebimentoDevolucaoInterno: chave fora do padrão de 44 dígitos é recusada antes de qualquer leitura', async () => {
  const { internals, fake } = carregarComFirestoreFake({});
  await assert.rejects(
    internals._confirmarRecebimentoDevolucaoInterno({ lojaId: 'loja1', chave: '123', origem: 'ANALISTA' }, ACESSO_LOJA1, fake),
    /Chave de acesso inválida/
  );
});

test('_confirmarRecebimentoDevolucaoInterno: admin confirma em qualquer loja', async () => {
  const { internals, fake } = carregarComFirestoreFake({
    ['lojas/loja9/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'loja9', estado: 'PENDENTE' },
  });
  const r = await internals._confirmarRecebimentoDevolucaoInterno({ lojaId: 'loja9', chave: CHAVE, origem: 'ANALISTA' }, ACESSO_ADMIN, fake);
  assert.equal(r.jaRecebida, false);
});

test('_consultarDevolucaoPorChaveInterno: sem BigQuery disponível (ambiente local), cai direto pro Firestore', async () => {
  const { internals, fake } = carregarComFirestoreFake({
    ['lojas/loja1/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'loja1', estado: 'PENDENTE', numeroNota: '900' },
  });
  const nota = await internals._consultarDevolucaoPorChaveInterno({ lojaId: 'loja1', chave: CHAVE }, ACESSO_LOJA1, null, fake);
  assert.ok(nota);
  assert.equal(nota.numeroNota, '900');
});

test('_consultarDevolucaoPorChaveInterno: BigQuery acha a linha — não precisa cair pro Firestore', async () => {
  const { internals, fake } = carregarComFirestoreFake({});
  const bigqueryFake = { query: async () => [[{ data: JSON.stringify({ chave: CHAVE, numeroNota: 'via-bigquery' }) }]] };
  const nota = await internals._consultarDevolucaoPorChaveInterno({ lojaId: 'loja1', chave: CHAVE }, ACESSO_LOJA1, bigqueryFake, fake);
  assert.equal(nota.numeroNota, 'via-bigquery');
});

test('_consultarDevolucaoPorChaveInterno: BigQuery falha (extensão não instalada/propagação atrasada) — cai pro Firestore em vez de propagar o erro', async () => {
  const { internals, fake } = carregarComFirestoreFake({
    ['lojas/loja1/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'loja1', numeroNota: 'via-firestore' },
  });
  const bigqueryFake = { query: async () => { throw new Error('Table not found'); } };
  const nota = await internals._consultarDevolucaoPorChaveInterno({ lojaId: 'loja1', chave: CHAVE }, ACESSO_LOJA1, bigqueryFake, fake);
  assert.equal(nota.numeroNota, 'via-firestore');
});

test('_consultarDevolucaoPorChaveInterno: chave inexistente nos dois lados devolve null, nunca inventa dado', async () => {
  const { internals, fake } = carregarComFirestoreFake({});
  const nota = await internals._consultarDevolucaoPorChaveInterno({ lojaId: 'loja1', chave: CHAVE }, ACESSO_LOJA1, null, fake);
  assert.equal(nota, null);
});

test('_listarDevolucoesBigQueryInterno: monta a query com os filtros informados e devolve as notas (sem listar o arquivo BI inteiro)', async () => {
  const chamadas = [];
  const bigqueryFake = { query: async (opts) => { chamadas.push(opts); return [[{ data: JSON.stringify({ chave: CHAVE, estado: 'PENDENTE', motivoNormalizado: 'TROCA' }) }]]; } };
  const { internals } = carregarComFirestoreFake({});
  const notas = await internals._listarDevolucoesBigQueryInterno({ lojaId: 'loja1', estado: 'PENDENTE', motivo: 'TROCA' }, ACESSO_LOJA1, bigqueryFake);
  assert.equal(notas.length, 1);
  assert.equal(notas[0].motivoNormalizado, 'TROCA');
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].query, /LIMIT @limite/);
  assert.equal(chamadas[0].params.estado, 'PENDENTE');
  assert.equal(chamadas[0].params.motivo, 'TROCA');
  assert.equal(chamadas[0].params.limite, 500, 'padrão continua 500 quando nenhum limite é pedido');
});

test('_listarDevolucoesBigQueryInterno: aba Indicadores pode pedir um teto maior (até 5000), nunca ilimitado', async () => {
  const chamadas = [];
  const bigqueryFake = { query: async (opts) => { chamadas.push(opts); return [[]]; } };
  const { internals } = carregarComFirestoreFake({});
  await internals._listarDevolucoesBigQueryInterno({ lojaId: 'loja1', limite: 2000 }, ACESSO_LOJA1, bigqueryFake);
  await internals._listarDevolucoesBigQueryInterno({ lojaId: 'loja1', limite: 999999 }, ACESSO_LOJA1, bigqueryFake);
  assert.equal(chamadas[0].params.limite, 2000);
  assert.equal(chamadas[1].params.limite, 5000, 'nunca passa do teto de 5000, mesmo pedindo mais');
});

test('_listarDevolucoesBigQueryInterno: estado fora de PENDENTE/RECEBIDA é recusado', async () => {
  const { internals } = carregarComFirestoreFake({});
  await assert.rejects(
    internals._listarDevolucoesBigQueryInterno({ lojaId: 'loja1', estado: 'QUALQUER' }, ACESSO_LOJA1, { query: async () => [[]] }),
    /Estado inválido/
  );
});
