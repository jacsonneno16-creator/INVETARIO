const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'analista.html'),'utf8');
const ws=fs.readFileSync(path.join(root,'js/analista/53-inventario-workspace-v4.js'),'utf8');
const v275=fs.readFileSync(path.join(root,'js/analista/50-inventario-classificacoes-v275.js'),'utf8');
const v286=fs.readFileSync(path.join(root,'js/analista/51-inventario-por-produto-v286.js'),'utf8');
const div=fs.readFileSync(path.join(root,'js/analista/32-render-divergencias-recontagens.js'),'utf8');
const settings=fs.readFileSync(path.join(root,'js/analista/123-configuracoes-sistema.js'),'utf8');

test('menu principal de Inventário foi reduzido sem apagar rotas legadas',()=>{
  assert.match(html,/id="nav-dashboard"[\s\S]{0,150}Dashboard/);
  assert.match(html,/id="nav-inventarios"[\s\S]{0,150}Inventários/);
  assert.match(html,/id="nav-recontagens"[\s\S]{0,180}Divergências/);
  assert.match(html,/id="nav-rastreabilidade"[\s\S]{0,150}Histórico/);
  assert.match(html,/id="inventario-nav-legado-v4" style="display:none!important"/);
});

test('workspace mantém só navegação contextual e evita duplicar menus globais',()=>{
  for(const page of ['acompanhamento','contagens','pendencias','rel-divergencias','produtividade','capas-duplicadas']) assert.match(ws,new RegExp(page.replace('-','\\-')));
  for(const label of ['Resumo','Contagens','Relatórios']) assert.match(ws,new RegExp(label));
  assert.doesNotMatch(ws,/data-dt-inv-page=\"recontagens\"/);
  assert.doesNotMatch(ws,/data-dt-inv-page=\"rastreabilidade\"/);
  assert.doesNotMatch(ws,/data-dt-inv-produto/);
});

test('serviços órfãos da raiz foram removidos e versões reais em services continuam',()=>{
  assert.equal(fs.existsSync(path.join(root,'js/analista/inventarioService.js')),false);
  assert.equal(fs.existsSync(path.join(root,'js/analista/divergenciaService.js')),false);
  assert.equal(fs.existsSync(path.join(root,'js/analista/services/inventarioService.js')),true);
  assert.equal(fs.existsSync(path.join(root,'js/analista/services/divergenciaService.js')),true);
});

test('fluxo Novo Inventário não usa mais polling nem múltiplos wrappers concorrentes',()=>{
  assert.doesNotMatch(v275,/setInterval\s*\(/);
  assert.doesNotMatch(v286,/setInterval\s*\(/);
  assert.doesNotMatch(v275,/oldOpen=window\.abrirNovoInventario/);
  assert.doesNotMatch(v286,/oldOpen=global\.abrirNovoInventario/);
  assert.match(ws,/AnalistaStore\?\.subscribe/);
  assert.match(ws,/1 Origem[\s\S]*2 Escopo[\s\S]*3 Endereços[\s\S]*4 Confirmar/);
});

test('Divergências tem histórico contextual e a página oculta antiga saiu do HTML',()=>{
  assert.doesNotMatch(html,/id="page-recontagens-historico"/);
  assert.match(div,/abrirHistoricoDivergenciaV4/);
  for(const x of ['Aguardando recontagem','Em recontagem','Aguardando analista','Resolvidas','Persistentes']) assert.match(html,new RegExp(x));
});

test('cadastros e dados ocultados do menu continuam acessíveis por Configurações',()=>{
  assert.match(settings,/enderecos-inventario/);
  assert.match(settings,/produtos-inventario/);
  assert.match(settings,/dados-inventario/);
  assert.match(settings,/mover\('page-enderecos'\)/);
  assert.match(settings,/mover\('page-produtos'\)/);
  assert.match(settings,/mover\('page-importar-exportar'\)/);
});

test('status CANCELADO fantasma foi removido do filtro',()=>{
  assert.doesNotMatch(html,/<option value="CANCELADO">/);
});
