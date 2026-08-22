const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function src(name){ return fs.readFileSync(path.join(__dirname,'..','js','analista',name),'utf8'); }

test('Produção Etapa 5 (CORRIGIDO): jornada padrão bate com DEFAULT_DAY_HRS do original (sábado 0h, não 8h) e lê configuração legada', () => {
  // Comparação linha a linha com o original confirmou: app.js define
  // DEFAULT_DAY_HRS=[0,9,9,9,9,8,0] (Seg-Qui 9h, Sex 8h, Sáb-Dom 0h). A
  // versão anterior deste teste tinha o valor errado (sábado 8h) travado
  // como se fosse o comportamento correto do original — não era.
  const s = src('77-producao-config.js');
  assert.match(s, /function padrao\(\)\{return \[0,9,9,9,9,8,0\];\}/);
  assert.match(s, /CCFG_LEGACY='configuracoes'/);
  assert.match(s, /normalizarDias\(legacy\.data\(\)\.dias/);
});

test('Produção Etapa 5: Realizado normaliza OPs e apontamentos do formato original', () => {
  const s = src('73-producao-realizado.js');
  assert.match(s, /CAP_LEGACY='apontamentos_producao'/);
  assert.match(s, /d\.data\|\|d\.dtDesejada\|\|d\.dtSolicitacao/);
  assert.match(s, /d\.qntCaixas\?\?d\.quantidade\?\?d\.realizadoCaixas/);
  assert.match(s, /registro_id:id,opId:id/);
});

test('Produção Etapa 5: MRP aceita ficha/insumos antigos e estoque legado', () => {
  const s = src('65-producao-insumos.js');
  assert.match(s, /COL_ESTOQUE_LEGACY='insumos'/);
  assert.match(s, /i\.qty\?\?i\.qtd\?\?i\.quantidade\?\?i\.consumoPorCaixa/);
  assert.match(s, /f\?\.desc\|\|f\?\.descricao\|\|f\?\.produto\|\|f\?\.nome/);
});
