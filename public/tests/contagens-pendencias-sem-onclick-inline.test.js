// Bug ao vivo real (2026-10-07): os botões Estornar/Restaurar (Contagens Recebidas)
// e vários botões da aba Pendências usavam onclick/onchange inline, mas essas telas
// são desenhadas via `.innerHTML =`. O sanitizador global (common-utils.js) remove
// todo atributo que comece com "on" de qualquer HTML gravado assim — os cliques
// nunca chegavam a fazer nada, sem erro nenhum no console. Corrigido com data-* e
// um único escutador delegado por tipo de evento (click/change).
// Este teste trava essa regra pra esse arquivo específico, sem reaparecer.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../js/analista/31-render-contagens-pendencias.js'), 'utf8');

test('31-render-contagens-pendencias.js: nenhum onchange inline (o sanitizador removeria)', () => {
  assert.doesNotMatch(src, /onchange="/);
});

test('31-render-contagens-pendencias.js: o único onclick inline que sobra é o de HTML inserido por insertAdjacentHTML (não passa pelo sanitizador)', () => {
  const ocorrencias = [...src.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
  // Lista exaustiva: qualquer onclick novo fora desta lista tem que ser justificado
  // (confirmado que o elemento é inserido via insertAdjacentHTML, não innerHTML=)
  // ou convertido para data-* + addEventListener, como os demais desta tela.
  const permitidos = new Set([
    'if(event.target===this)this.remove()',
    "document.getElementById('modal-pend-produto-bg')?.remove()"
  ]);
  ocorrencias.forEach(o => assert.ok(permitidos.has(o), 'onclick inline não esperado (provável regressão do bug do sanitizador): ' + o));
});

test('31-render-contagens-pendencias.js: Estornar/Restaurar/Atribuir/Desvincular/Registrar/Detalhe usam data-* com escutador delegado', () => {
  assert.match(src, /data-cont-estornar=/);
  assert.match(src, /data-cont-restaurar=/);
  assert.match(src, /data-pend-detalhe=/);
  assert.match(src, /data-pend-desvincular=/);
  assert.match(src, /data-pend-atribuir=/);
  assert.match(src, /data-pend-atribuir-selecionados=/);
  assert.match(src, /data-rec-registrar=/);
  assert.match(src, /data-pend-selecionar-todos=/);
  assert.match(src, /document\.addEventListener\('click'/);
  assert.match(src, /document\.addEventListener\('change'/);
});
