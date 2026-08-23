const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('agenda desconta caixas ja realizadas da capacidade', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/63-producao-agenda.js'), 'utf8');
  const window = {};
  vm.runInNewContext(code, { window, console, Date, Math, Number, String, Array, Object });
  const week = new Date(2026, 7, 9); // domingo
  const maquinas = { M1: { nome: 'M1', turnos: { '1': [{ ini: '08:00', fim: '18:00' }] } } };
  const regs = [{ _firestoreId: 'op1', produto: 'P1', maquina: 'M1', data: '2026-08-10', status: 'pendente', qntCaixas: 100, realizadoCaixas: 40, unidPorCx: 10, pcMin: 10, sortOrder: 1 }];
  const out = window.buildProducaoSchedule(week, regs, maquinas, []);
  const prod = out.porMaquina.M1.porDia.flat().filter(x => x.tipo === 'producao');
  const caixas = prod.reduce((s, x) => s + x.caixasNoDia, 0);
  assert.equal(caixas, 60);
  assert.equal(Math.round(out.porMaquina.M1.totalMinutosUsados), 60);
});

test('programacao grava snapshot de configuracao em OP manual e Excel', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/62-producao-programacao.js'), 'utf8');
  // Comparação com o original achou o bug do pcMin<=0 sumindo silenciosamente
  // da agenda — corrigido reaproveitando o `pcMin` já calculado (em vez de
  // chamar _resolvePcMin de novo) pra poder avisar o usuário quando for 0,
  // nos dois caminhos de criação de OP (manual e Excel).
  const ocorrencias = code.match(/configSnapshot:\s*_buildConfigSnapshot\(produto, maquina, pcMin, unidPorCx\)/g) || [];
  assert.equal(ocorrencias.length, 2, 'manual e Excel devem gravar o snapshot com o mesmo pcMin já calculado (e já avisado ao usuário se for 0)');
  assert.match(code, /global\.migrarSnapshotsProgramacao\s*=\s*migrarSnapshotsProgramacao/);
});

test('apontamento persiste agregado realizado na OP', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/73-producao-realizado.js'), 'utf8');
  assert.match(code, /realizadoCaixas:\s*totalReal/);
  assert.match(code, /realizadoUnid:\s*totalReal \* unidPorCx/);
});

test('programacao automatica considera setup e cria snapshot', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/67-producao-prog-automatica.js'), 'utf8');
  assert.match(code, /COL_SETUP = 'producao_setup'/);
  assert.match(code, /global\.getSetupMin/);
  assert.match(code, /buildProducaoConfigSnapshot/);
});

test('programacao automatica V341 mantem planejamento avancado', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/67-producao-prog-automatica.js'), 'utf8');
  assert.match(code, /planejamento em até 4 semanas/);
  assert.match(code, /maxCaixasPorInsumos/);
  assert.match(code, /auditoria de capacidade/i);
  assert.match(code, /Simular Cenário/i);
});

test('realizado V341 mantem grade horaria, sequencia e excel', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/73-producao-realizado.js'), 'utf8');
  assert.match(code, /Array\.from\(\{length:17\}/);
  assert.match(code, /liberacaoSequencia/);
  assert.match(code, /observacao/);
  assert.match(code, /exportarProducaoRealizado/);
  assert.match(code, /producao_processos/);
});

test('relatorios V341 cruzam programado e realizado e exportam', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/69-producao-relatorios.js'), 'utf8');
  assert.match(code, /producao_apontamentos/);
  assert.match(code, /Programado × Realizado/);
  assert.match(code, /exportarProducaoRelatorios/);
});

test('backup de producao inclui dados operacionais completos', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/71-producao-excel.js'), 'utf8');
  for (const aba of ['Programacao','Realizado','Funcionarios','Estoque_Insumos','Projecao']) assert.match(code, new RegExp("'" + aba + "'"));
  assert.match(code, /producao_backup_completo\.xlsx/);
});

test('central de importacao/API de producao esta navegavel', () => {
  const nav = fs.readFileSync(path.join(__dirname, '../js/analista/03-core-navigation.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../js/analista/76-producao-importacao.js'), 'utf8');
  assert.match(nav, /producao-importacao/);
  assert.match(page, /renderProducaoImportacao/);
  assert.match(page, /importarProgramacaoExcel/);
  assert.match(page, /importarEstoqueInsumosProducao/);
  assert.match(page, /importarProjecaoExcel/);
});

test('agenda respeita horaInicio dentro do turno', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/63-producao-agenda.js'), 'utf8');
  const window = {}; vm.runInNewContext(code, {window, console, Date, Math, Number, String, Array, Object});
  const week = new Date(2026,7,9);
  const maquinas={M1:{nome:'M1',turnos:{'1':[{ini:'08:00',fim:'18:00'}]}}};
  const regs=[{_firestoreId:'a',produto:'P',maquina:'M1',data:'2026-08-10',horaInicio:'10:00',qntCaixas:10,unidPorCx:1,pcMin:1,sortOrder:1}];
  const out=window.buildProducaoSchedule(week,regs,maquinas,[]);
  const seg=out.porMaquina.M1.porDia[1].find(x=>x.tipo==='producao');
  assert.equal(seg.inicioMin,120);
});

test('agenda absorve setup quando ha dia ocioso entre OPs', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/63-producao-agenda.js'), 'utf8');
  const window = {}; vm.runInNewContext(code, {window, console, Date, Math, Number, String, Array, Object});
  const week = new Date(2026,7,9);
  const maquinas={M1:{nome:'M1',setupPadraoMin:60,turnos:{'1':[{ini:'08:00',fim:'18:00'}],'3':[{ini:'08:00',fim:'18:00'}]}}};
  const regs=[
    {_firestoreId:'a',produto:'A',maquina:'M1',data:'2026-08-10',qntCaixas:10,unidPorCx:1,pcMin:1,sortOrder:1},
    {_firestoreId:'b',produto:'B',maquina:'M1',data:'2026-08-12',qntCaixas:10,unidPorCx:1,pcMin:1,sortOrder:2}
  ];
  const out=window.buildProducaoSchedule(week,regs,maquinas,[]);
  const setup=out.porMaquina.M1.porDia.flat().filter(x=>x.tipo==='setup');
  assert.equal(setup.length,0);
});

test('ficha tecnica preserva regras avancadas usadas pelo planejamento', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/60-producao-ficha-tecnica.js'), 'utf8');
  for (const campo of ['metaCoberturaDias','producaoMinima','multiploProducao','tipoMinimo','prioridadeProducao','alergenico','classificacao']) assert.match(code, new RegExp(campo));
  const html = fs.readFileSync(path.join(__dirname, '../analista.html'), 'utf8');
  for (const id of ['pft-cobertura','pft-prod-min','pft-multiplo','pft-tipo-min','pft-prioridade','pft-alergenico','pft-classificacao']) assert.match(html, new RegExp('id="'+id+'"'));
});

test('programacao automatica aplica minimo multiplo cobertura e prioridade por produto', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/67-producao-prog-automatica.js'), 'utf8');
  assert.match(code, /producaoMinima/);
  assert.match(code, /multiploProducao/);
  assert.match(code, /metaCoberturaDias/);
  assert.match(code, /prioridadeProducao/);
  assert.match(code, /prioProduto/);
});

test('relatorios possuem dimensoes gerenciais do sistema original', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/69-producao-relatorios.js'), 'utf8');
  for (const nome of ['Categorias','Cobertura','Funcionários','Insumos','Gerencial']) assert.match(code, new RegExp(nome));
  assert.match(code, /producao_processos/);
  assert.match(code, /producao_insumos_estoque/);
});

test('backup completo preserva estruturas profundas e novas colecoes', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/71-producao-excel.js'), 'utf8');
  for (const termo of ['Ficha_Tecnica','turnosJson','produtosCompativeisJson','dadosJson','Processos','Categorias','Configuracoes']) assert.match(code, new RegExp(termo));
  assert.match(code, /configSnapshot|dadosJson/);
});

test('gantt insumos e realizado permitem navegar diretamente por data', () => {
  const gantt = fs.readFileSync(path.join(__dirname, '../js/analista/64-producao-gantt.js'), 'utf8');
  const ins = fs.readFileSync(path.join(__dirname, '../js/analista/65-producao-insumos.js'), 'utf8');
  const real = fs.readFileSync(path.join(__dirname, '../js/analista/73-producao-realizado.js'), 'utf8');
  assert.match(gantt, /data-pgantt-data/); assert.match(gantt, /pganttGoDate/);
  assert.match(ins, /data-pins-data/); assert.match(ins, /pinsGoDate/);
  assert.match(real, /data-preal-data/);
});

test('funcionarios preservam status e ausencia temporaria por data', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/68-producao-funcionarios.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../analista.html'), 'utf8');
  assert.match(html, /id="pfunc-ativo"/);
  assert.match(code, /Date\.now\(\)/);
  assert.match(code, /const ativo = document\.getElementById\('pfunc-ativo'\)/);
});

test('setup faz fallback para produtos cadastrados quando maquina nao tem compatibilidade explicita', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/70-producao-setup.js'), 'utf8');
  assert.match(code, /COL_PRODUTOS/);
  assert.match(code, /if \(!produtos\.length\) produtos = _produtos/);
});

test('processo dia inteiro usa jornada configurada da fabrica', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/73-producao-realizado.js'), 'utf8');
  assert.match(code, /PRODUCAO_JORNADA/);
  assert.match(code, /dt_producao_jornada_v341/);
  assert.match(code, /procMin\(ini,fim,dia,data\)/);
});

test('importacao producao preserva historico e rotinas controladas de limpeza', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/76-producao-importacao.js'), 'utf8');
  assert.match(code, /getDTFirestore/);
  assert.match(code, /producao_import_historico/);
  assert.match(code, /registrarHistorico/);
  assert.match(code, /limparHistorico/);
  assert.match(code, /limparDados/);
});

test('configuracoes preservam busca de categorias e confirmacao de reset da jornada', () => {
  const code = fs.readFileSync(path.join(__dirname, '../js/analista/77-producao-config.js'), 'utf8');
  assert.match(code, /data-pcfg-cat-busca/);
  assert.match(code, /catBusca/);
  assert.match(code, /Restaurar a jornada padrão da fábrica\?/);
});
