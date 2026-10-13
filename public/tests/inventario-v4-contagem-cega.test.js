const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const normal = fs.readFileSync(path.join(root,'js/coletor/08-etapas-produto-quantidade-salvamento.js'),'utf8');
const lote = fs.readFileSync(path.join(root,'js/coletor/07-etapa-endereco.js'),'utf8');

test('contagem normal continua gravando esperado para o Analista, mas não mostra ao operador',()=>{
  assert.match(normal,/quantidade_esperada:\s*qtdEsp\s*\|\|\s*''/);
  assert.match(normal,/toast\('✅ Quantidade registrada\.'/);
  assert.doesNotMatch(normal,/toast\([^\n]*esperado\s*\$\{qtdEsp\}/i);
  assert.doesNotMatch(normal,/(innerHTML|textContent)[^\n]*(quantidade_esperada|qtdEsp)/i);
});

test('modo lote não renderiza quantidade esperada do sistema',()=>{
  assert.doesNotMatch(lote,/(toast|innerHTML|textContent)[^\n]*(quantidade_esperada|qtdEsp)/i);
  assert.match(lote,/_loteSalvarTudo|loteConfirmarQtdPadrao/);
});

// A varredura original desta rodada só cobriu 07/08 (o fluxo de contagem em
// si); a tela de Histórico do próprio Coletor (09-historico-stats.js) já
// mostrava "Esperado: X · Contado: Y" pras contagens marcadas como
// divergentes, revelando o número do sistema pro operador de outro jeito —
// achado numa auditoria independente, corrigido junto.
test('histórico do Coletor não revela a quantidade esperada do sistema, nem pra contagens divergentes',()=>{
  const historico = fs.readFileSync(path.join(root,'js/coletor/09-historico-stats.js'),'utf8');
  assert.doesNotMatch(historico,/Esperado:\s*\$\{c\.quantidade_esperada\}/);
  assert.doesNotMatch(historico,/[^\n]*(quantidade_esperada|qtdEsp)[^\n]*\$\{/);
});
