const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname,'..','js','analista');
const src = n => fs.readFileSync(path.join(dir,n),'utf8');

test('Produção Etapa 6: troca de loja invalida os caches privados de todas as telas com dados carregados', () => {
  const arquivos = [
    '60-producao-ficha-tecnica.js','61-producao-maquinas.js','62-producao-programacao.js',
    '64-producao-gantt.js','65-producao-insumos.js','66-producao-projecao.js',
    '67-producao-prog-automatica.js','68-producao-funcionarios.js','69-producao-relatorios.js',
    '70-producao-setup.js','72-producao-mapa-fabrica.js','73-producao-realizado.js',
    '74-producao-dashboard.js','75-producao-estoque.js','77-producao-config.js'
  ];
  for (const arq of arquivos) {
    assert.match(src(arq), /DTProducao\?\.registrarInvalidacao/, arq+' precisa registrar invalidacao');
  }
  const core = src('59-producao-ui-completa.js');
  assert.match(core, /dt-loja-alterada/);
  assert.match(core, /invalidarTudo/);
});

test('Produção Etapa 6: jornada local é isolada por loja, não reaproveita configuração da loja anterior', () => {
  const s = src('77-producao-config.js');
  assert.match(s, /KEY_BASE='dt_producao_jornada_v341'/);
  assert.match(s, /function jornadaKey\(\)/);
  assert.match(s, /getDTLojaAtiva/);
  assert.match(s, /localStorage\.getItem\(jornadaKey\(\)\)/);
  assert.match(s, /localStorage\.setItem\(jornadaKey\(\),JSON\.stringify\(jornada\)\)/);
});

test('Produção Etapa 6: seletor de loja aparece dentro do módulo e reutiliza o switcher oficial do projeto maior', () => {
  const s = src('59-producao-ui-completa.js');
  assert.match(s, /id="prod-loja-atual"/);
  assert.match(s, /trocarLojaInventario/);
  assert.match(s, /atualizarLojaSidebar/);
});

test('Produção Etapa 6: troca oficial do Analista invalida Produção antes de renderizar a nova loja', () => {
  const s = src('00-auth-login.js');
  const iSet = s.indexOf('window.setDTLojaAtiva(nova)');
  const iInv = s.indexOf('window.DTProducao?.invalidarTudo?.()', iSet);
  const iRender = s.indexOf('window.AnalistaNavigation.renderCurrentPage()', iSet);
  assert.ok(iSet >= 0 && iInv > iSet && iRender > iInv);
});
