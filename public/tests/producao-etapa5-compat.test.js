const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function src(name){ return fs.readFileSync(path.join(__dirname,'..','js','analista',name),'utf8'); }

test('Produção Etapa 5: jornada mantém sábado de 8h como no projeto de Produção original e lê configuração legada', () => {
  const s = src('77-producao-config.js');
  assert.match(s, /function padrao\(\)\{return \[0,9,9,9,9,8,8\];\}/);
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
