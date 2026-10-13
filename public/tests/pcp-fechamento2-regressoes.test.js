const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..','js','analista',f),'utf8');
const p60=read('60-producao-ficha-tecnica.js');
const p62=read('62-producao-programacao.js');
const p71=read('71-producao-excel.js');
const p78=read('78-pcp-central.js');
const p79=read('79-compras-central.js');
const p81=read('81-pcp-parametros.js');
const p87=read('87-pcp-alertas.js');
const p88=read('88-pcp-relatorios.js');
const p89=read('89-compras-dashboard.js');
const p120=read('120-pcp-demand-engine.js');
const lazy=read('00-lazy-areas.js');
const fn=fs.readFileSync(path.join(__dirname,'..','..','functions','index.js'),'utf8');

test('fornecedor preferencial grava ID e roteamento prioriza ID',()=>{
  assert.match(p81,/fornecedorPadraoId/);
  assert.match(p81,/_resolverFornecedorPreferencial/);
  assert.match(p78,/const fornecedorId=String\(p\.fornecedorPadraoId\|\|p\.fornecedorId/);
  assert.match(p78,/String\(x\.fornecedorId\|\|''\)\.trim\(\)===fornecedorId/);
  assert.match(p78,/fornecedorId:prod\.fornecedorPadraoId\|\|prod\.fornecedorId/);
});

test('sem comprador usa uma função compartilhada e catálogo inclui Bluesoft',()=>{
  assert.match(p79,/function requisicaoSemComprador/);
  assert.match(p79,/CPRODBI='pcp_produtos_bluesoft'/);
  assert.match(p79,/\.collection\(CPRODBI\)/);
  assert.match(p89,/internos\.requisicaoSemComprador/);
});

test('histórico operacional não é apresentado como histórico fiscal',()=>{
  assert.match(p79,/Histórico operacional de compras/);
});

test('cenário repassa lead time resolvido ao motor',()=>{
  assert.match(p88,/motorProduto=\{\.\.\.cad,leadTimeDias:n\(item\.leadTimeDias\)/);
});

test('clamp de estoque máximo preserva múltiplo e não ultrapassa máximo',()=>{
  assert.match(p120,/Math\.floor\(limite \/ mult\) \* mult/);
  assert.match(p120,/suggestedQuantity = candidato >= minimum \? candidato : 0/);
});

test('quatro alertas levam key por produto/insumo',()=>{
  for(const tipo of ['compra_insuficiente','insumo_nao_comprado','producao_sem_insumo','compra_recebida']){
    assert.match(p87,new RegExp("tipo: '"+tipo+"', key:"));
  }
});

test('ficha técnica usa referência explícita por loja e audita parâmetros',()=>{
  assert.match(p60,/function _refProdutoCrossLoja/);
  assert.match(p60,/_refProdutoCrossLoja\(lojaEdicao,existente\._firestoreId\)/);
  assert.match(p60,/registrarAuditoria/);
  assert.match(p60,/camposRastreados:\['metaCoberturaDias','producaoMinima','multiploProducao','tipoMinimo','prioridadeProducao'\]/);
});

test('capacidade herdada é sinalizada e máximo pode ficar não configurado',()=>{
  assert.match(p81,/_herdado:true/);
  assert.match(p81,/Capacidade herdada de/);
  assert.match(p81,/maxCaminhoesPorEntrega: String\([^\n]+\)\.trim\(\)===''\?null/);
});

test('exclusão limpa mestre somente após checar outras lojas',()=>{
  assert.match(p60,/async function _limparMestreSeOrfao/);
  assert.match(p60,/\.collection\(COL_PRODUTOS\)\.where\('cod','==',cod\)\.limit\(1\)/);
  assert.match(p60,/await _limparMestreSeOrfao\(cod\)/);
  assert.match(p60,/collection\('produtos_mestre'\)\.doc\(cod\)/);
});

test('programação normaliza em_producao histórico para em_andamento',()=>{
  assert.match(p62,/function _statusProgramacao/);
  assert.match(p62,/em_producao/);
  assert.match(p62,/_statusProgramacao\(r\.status\) === filtroStatus/);
  assert.match(p62,/STATUS_INFO\[_statusProgramacao\(r\.status\)\]/);
});

test('ponte do servidor reconhece aliases centrais do produto',()=>{
  for(const campo of ['bluesoftProdutoKey','produtoUnitarioKey','produtoUnitarioKeyBluesoft','canonicalKey']) assert.match(fn,new RegExp('x\\.'+campo));
});

test('Excel exporta estoque do BI e não restaura legado quando BI é autoridade',()=>{
  assert.match(p71,/DTProducaoInsumosBI\?\.carregar/);
  assert.match(p71,/estoqueBi\.length\?Promise\.resolve\(\{docs:\[\]\}\)/);
  assert.match(p71,/const usarEstoqueLegado=!global\.DTProducaoInsumosBI/);assert.match(p71,/if\(usarEstoqueLegado\)\{for \(const r of linhasEstoqueInsumos\)/);
});

test('status parcial novo está no teste de retorno e dropdown',()=>{
  const ret=fs.readFileSync(path.join(__dirname,'pcp-retorno-fase5.test.js'),'utf8');
  const p84=read('84-pcp-compras-acompanhamento.js');
  assert.match(ret,/finalizada':'parcial/);
  assert.match(p84,/'parcial'/);
});

test('todo JS tocado desta rodada tem cache bust fechamento2',()=>{
  // 78-pcp-central.js, 87-pcp-alertas.js, 69-producao-relatorios.js e
  // 88-pcp-relatorios.js receberam correções legítimas em rodadas
  // posteriores (Config Hub V3, fix de desempenho multi-loja, fix de fuso
  // horário do atalho "Hoje", cobertura/estoque negativo em todo lugar) —
  // travar um valor exato aqui quebra a cada bump de versão real. Pra
  // esses quatro, só confirma que NÃO ficaram presos na versão anterior a
  // esta rodada (fase1a8/fechamento1).
  const arquivos=['60-producao-ficha-tecnica.js','62-producao-programacao.js','71-producao-excel.js','79-compras-central.js','81-pcp-parametros.js','89-compras-dashboard.js','120-pcp-demand-engine.js'];
  for(const f of arquivos){assert.match(lazy,new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\?v=20260928-fases1a8-fechamento2'));}
  assert.doesNotMatch(lazy,/78-pcp-central\.js\?v=20260926-auditoria-final-definitiva/,'78-pcp-central.js precisa ter recebido cache bust desde a rodada fechamento2');
  assert.doesNotMatch(lazy,/87-pcp-alertas\.js\?v=20260926-auditoria-final-definitiva/,'87-pcp-alertas.js precisa ter recebido cache bust desde a rodada fechamento2');
  assert.doesNotMatch(lazy,/69-producao-relatorios\.js\?v=20260926-auditoria-final-definitiva/,'69-producao-relatorios.js precisa ter recebido cache bust desde a rodada fechamento2');
  assert.doesNotMatch(lazy,/88-pcp-relatorios\.js\?v=20260926-auditoria-final-definitiva/,'88-pcp-relatorios.js precisa ter recebido cache bust desde a rodada fechamento2');
});
