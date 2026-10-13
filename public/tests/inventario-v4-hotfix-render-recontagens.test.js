const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('atualização manual do Inventário não chama mais renderer da página removida', () => {
  const src = read('js/analista/41-dashboard-acomp-v37.js');
  const bloco = src.match(/window\.atualizarTresAbasAuditoria=function\(botao\)\{[\s\S]*?window\.atualizarDadosAnalista=window\.atualizarTresAbasAuditoria;/)?.[0] || '';
  assert.ok(bloco);
  assert.doesNotMatch(bloco, /renderRecontagens/);
  assert.match(bloco, /renderDivergencias/);
});

test('estorno do Analista não chama mais renderer da página removida', () => {
  const src = read('js/analista/12-validacao-operacional.js');
  assert.doesNotMatch(src, /renderRecontagens\s*\(/);
});

test('renderRecontagens legado é defensivo quando a página antiga não existe', () => {
  const src = read('js/analista/32-render-divergencias-recontagens.js');
  assert.match(src, /function renderRecontagens\(\) \{[\s\S]*?if \(!document\.getElementById\('rec-table-wrap'\)\) return;/);
  const calls = [...src.matchAll(/renderRecontagens\s*\(/g)].length;
  assert.equal(calls, 2, 'deve restar apenas a definição e a chamada interna do export legado');
});
