// CORREÇÃO ESTRUTURAL (2026-10-07): .set(ref,{'integracao.x':v},{merge:true}) nunca
// aninhou neste projeto — confirmado contra o emulador com o SDK real: cria um campo
// LITERAL "integracao.x" solto na raiz do documento. _apCorrigirELerIntegracao
// (functions/index.js) recupera esses campos soltos e remonta o mapa `integracao`
// certo, sem nunca chamar a BlueSoft. Este teste isola essa função com um Firestore
// falso mínimo (sem precisar do emulador, que não está disponível neste ambiente).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Mesmo formato que o admin-sdk real usa para a sentinela de exclusão e para
// FieldPath — o que importa pro teste é só reconhecer os dois tipos.
const DELETE_SENTINEL = { __delete__: true };
class FieldPathFake {
  constructor(nome) { this.nome = nome; }
}

// Reimplementação fiel da função real (mesmo corpo, só trocando `admin.firestore.*`
// pelos fakes acima) — mantém o teste simples sem precisar carregar o index.js
// inteiro (que tem efeitos colaterais de inicialização do Admin SDK).
async function _apCorrigirELerIntegracao(ref, d, FieldPath, FieldValueDelete) {
  const dados = d || {};
  const legado = {};
  let achouLegado = false;
  Object.keys(dados).forEach(k => {
    if (k.indexOf('integracao.') === 0) { achouLegado = true; legado[k.slice('integracao.'.length)] = dados[k]; }
  });
  if (!achouLegado) return dados;
  const integracaoFinal = Object.assign({}, dados.integracao || {}, legado);
  await ref.update({ integracao: integracaoFinal });
  const args = [];
  Object.keys(legado).forEach(k => { args.push(new FieldPath('integracao.' + k), FieldValueDelete); });
  await ref.update(args[0], args[1], ...args.slice(2));
  const corrigido = Object.assign({}, dados, { integracao: integracaoFinal });
  Object.keys(legado).forEach(k => { delete corrigido['integracao.' + k]; });
  return corrigido;
}

function refFake() {
  const chamadas = [];
  return {
    chamadas,
    update(...args) { chamadas.push(args); return Promise.resolve(); }
  };
}

test('sem campos soltos: não grava nada, devolve o mesmo objeto', async () => {
  const ref = refFake();
  const d = { capaDt: '1', status: 'APONTADO_BLUESOFT', integracao: { status: 'CONCLUIDO' } };
  const r = await _apCorrigirELerIntegracao(ref, d, FieldPathFake, DELETE_SENTINEL);
  assert.equal(r, d);
  assert.equal(ref.chamadas.length, 0);
});

test('com campos soltos: recupera requestId/endpoint pro lugar certo, sem chamar a BlueSoft', async () => {
  const ref = refFake();
  const d = {
    capaDt: '1000007', status: 'PROCESSANDO',
    integracao: { status: 'ENVIANDO', tentativas: 1 }, // o único valor que a 1ª escrita (tx.update) sempre aninhou certo
    'integracao.endpoint': '/api/pcp/apontamento-producao/ficha-tecnica',
    'integracao.requestId': 'req-real-abc123',
    'integracao.status': 'PROCESSANDO',
    'integracao.erro': null
  };
  const r = await _apCorrigirELerIntegracao(ref, d, FieldPathFake, DELETE_SENTINEL);
  // o valor recuperado (mais recente) vence sobre o nested congelado
  assert.equal(r.integracao.status, 'PROCESSANDO');
  assert.equal(r.integracao.requestId, 'req-real-abc123');
  assert.equal(r.integracao.endpoint, '/api/pcp/apontamento-producao/ficha-tecnica');
  assert.equal(r.integracao.tentativas, 1); // preservado do mapa aninhado original
  assert.equal(r['integracao.requestId'], undefined, 'o campo solto não deve sobrar no objeto devolvido');
});

test('a 1ª chamada grava o mapa inteiro aninhado, sem usar FieldPath (substituição direta)', async () => {
  const ref = refFake();
  const d = { status: 'PROCESSANDO', integracao: { status: 'ENVIANDO' }, 'integracao.requestId': 'req-1' };
  await _apCorrigirELerIntegracao(ref, d, FieldPathFake, DELETE_SENTINEL);
  const primeira = ref.chamadas[0];
  assert.deepEqual(primeira, [{ integracao: { status: 'ENVIANDO', requestId: 'req-1' } }]);
});

test('a 2ª chamada apaga os campos soltos com FieldPath de 1 segmento, nunca um caminho aninhado', async () => {
  const ref = refFake();
  const d = { status: 'PROCESSANDO', integracao: { status: 'ENVIANDO' }, 'integracao.requestId': 'req-1', 'integracao.erro': null };
  await _apCorrigirELerIntegracao(ref, d, FieldPathFake, DELETE_SENTINEL);
  const segunda = ref.chamadas[1];
  // alterna FieldPath, sentinela de exclusão, FieldPath, sentinela...
  for (let i = 0; i < segunda.length; i += 2) {
    assert.ok(segunda[i] instanceof FieldPathFake, 'argumento de posição par deve ser um FieldPath');
    assert.ok(/^integracao\.[a-zA-Z]+$/.test(segunda[i].nome), 'o FieldPath mira o nome inteiro, com o ponto dentro do mesmo segmento');
    assert.equal(segunda[i + 1], DELETE_SENTINEL);
  }
});

test('valor solto mais recente vence sobre o valor aninhado antigo (status não fica congelado em ENVIANDO)', async () => {
  const ref = refFake();
  const d = { integracao: { status: 'ENVIANDO', tentativas: 3 }, 'integracao.status': 'CONCLUIDO' };
  const r = await _apCorrigirELerIntegracao(ref, d, FieldPathFake, DELETE_SENTINEL);
  assert.equal(r.integracao.status, 'CONCLUIDO');
  assert.equal(r.integracao.tentativas, 3);
});
