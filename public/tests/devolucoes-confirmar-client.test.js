// Devoluções unificadas (2026-10-13): public/js/shared/devolucoes-confirmar.js
// — confirmação atômica client-side, compartilhada entre Coletor e
// Analista. Mesma garantia testada do lado do servidor
// (functions/test/devolucoes-unificadas.test.js), agora do lado do cliente.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codigo = fs.readFileSync(path.join(__dirname, '../js/shared/devolucoes-confirmar.js'), 'utf8');

// Fake Firestore client com coleções aninhadas + runTransaction (reads
// antes de writes, igual ao SDK real) — tx.set aqui NÃO impede sobrescrita
// por si só (o client SDK não tem tx.create); a proteção real vem de
// sempre ler recRef ANTES de decidir, dentro da mesma transação.
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
        };
        return fn(tx);
      },
    },
    dados,
  };
}

function carregar() {
  const window = {};
  vm.runInNewContext(codigo, { window, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, RegExp });
  return window.confirmarRecebimentoDevolucaoClient;
}

const CHAVE = '33333333333333333333333333333333333333333331';

test('confirmarRecebimentoDevolucaoClient: 1ª confirmação (Coletor) cria devolucoes_recebimentos e vira RECEBIDA', async () => {
  const confirmar = carregar();
  const { fake, dados } = criarFirestoreFake({
    ['lojas/matriz/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'matriz', estado: 'PENDENTE' },
  });
  const r = await confirmar(fake, 'matriz', CHAVE, { origem: 'COLETOR', confirmadoPor: 'operador@daterrinha.com' });
  assert.equal(r.jaRecebida, false);
  const nota = dados.get('lojas/matriz/devolucoes_notas/' + CHAVE);
  assert.equal(nota.estado, 'RECEBIDA');
  assert.equal(nota.origemRecebimento, 'COLETOR');
  const rec = dados.get('lojas/matriz/devolucoes_recebimentos/' + CHAVE);
  assert.equal(rec.origem, 'COLETOR');
  assert.equal(rec.relatorioId, null);
});

test('confirmarRecebimentoDevolucaoClient: 2ª confirmação da mesma chave (Analista depois do Coletor) não cria outro recebimento', async () => {
  const confirmar = carregar();
  const { fake, dados } = criarFirestoreFake({
    ['lojas/matriz/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'matriz', estado: 'PENDENTE' },
  });
  const r1 = await confirmar(fake, 'matriz', CHAVE, { origem: 'COLETOR', confirmadoPor: 'operador@daterrinha.com' });
  assert.equal(r1.jaRecebida, false);
  const r2 = await confirmar(fake, 'matriz', CHAVE, { origem: 'ANALISTA', confirmadoPor: 'analista@daterrinha.com', relatorioId: 'rel1' });
  assert.equal(r2.jaRecebida, true);
  assert.equal(r2.recebimento.origem, 'COLETOR', 'devolve quem chegou primeiro, não sobrescreve com o segundo');
  let count = 0;
  dados.forEach((v, k) => { if (k === 'lojas/matriz/devolucoes_recebimentos/' + CHAVE) count++; });
  assert.equal(count, 1);
});

test('confirmarRecebimentoDevolucaoClient: chave sem nota no catálogo fiscal rejeita, nunca confirma às cegas', async () => {
  const confirmar = carregar();
  const { fake } = criarFirestoreFake({});
  await assert.rejects(() => confirmar(fake, 'matriz', CHAVE, { origem: 'ANALISTA', confirmadoPor: 'x' }), /não encontrada/);
});

test('confirmarRecebimentoDevolucaoClient: nota de outra loja é recusada', async () => {
  const confirmar = carregar();
  const { fake } = criarFirestoreFake({
    ['lojas/matriz/devolucoes_notas/' + CHAVE]: { chave: CHAVE, lojaId: 'filial', estado: 'PENDENTE' },
  });
  await assert.rejects(() => confirmar(fake, 'matriz', CHAVE, { origem: 'ANALISTA', confirmadoPor: 'x' }), /outra loja/);
});

test('confirmarRecebimentoDevolucaoClient: chave fora do formato de 44 dígitos é recusada', async () => {
  const confirmar = carregar();
  const { fake } = criarFirestoreFake({});
  await assert.rejects(() => confirmar(fake, 'matriz', '123', { origem: 'ANALISTA', confirmadoPor: 'x' }), /44 dígitos/);
});
