const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'../js/analista');
const read=n=>fs.readFileSync(path.join(base,n),'utf8');

test('fase 6: desempenho de fornecedor prioriza fornecedorId e mantém fallback legado por nome',()=>{
  const s=read('121-compras-profissional.js');
  assert.match(s,/function _chaveFornecedorDesempenho\(fornecedorId,nome\)/);
  assert.match(s,/id:'\+id/);
  assert.match(s,/a\.fornecedorId\|\|req\?\.fornecedorId/);
  assert.match(s,/_buscarDesempenhoFornecedor\(historico,\{fornecedorId:c\.fornecedorId,fornecedor:c\.fornecedor\}\)/);
  assert.match(s,/String\(x\.fornecedorId\|\|''\)===String\(id\)/);
});

test('fase 6: parâmetros persistem ID do fornecedor preferencial',()=>{
  const s=read('81-pcp-parametros.js');
  assert.match(s,/fornecedorPadraoId/);
  assert.match(s,/_resolverFornecedorPreferencial/);
  assert.match(s,/resolverFornecedorAptoPorNome/);
  assert.match(s,/\.\.\.fornecedor/);
});

test('fase 7: lead time segue hierarquia única documentada',()=>{
  const s=read('78-pcp-central.js');
  const posManual=s.indexOf("fonte:'manual'");
  const posVinc=s.indexOf("fonte:'fornecedor_produto'");
  const posHist=s.indexOf("fonte:'historico_fornecedor'");
  const posPadraoF=s.indexOf("fonte:'fornecedor_padrao'");
  const posFallback=s.indexOf("fonte:'padrao'",posPadraoF);
  assert.ok(posManual>=0&&posManual<posVinc&&posVinc<posHist&&posHist<posPadraoF&&posPadraoF<posFallback);
  assert.match(s,/listarVinculosHomologados/);
  assert.match(s,/leadTimePadraoDias/);
});

test('fase 7: parcial recebido não é tratado como recebimento final no histórico de lead time',()=>{
  const s=read('78-pcp-central.js');
  assert.match(s,/\^finalizada\?\$\|\^recebida\?\$/);
  assert.doesNotMatch(s,/const final=\/finaliz\|recebid\/i/);
});

test('fase 8: histórico operacional e histórico real têm rótulos distintos',()=>{
  const a=read('84-pcp-compras-acompanhamento.js');
  const p=read('86-pcp-produto-360.js');
  const c=read('121-compras-profissional.js');
  assert.match(a,/Acompanhamento operacional de compras/);
  assert.match(p,/Histórico operacional de compras/);
  assert.match(p,/Requisições compradas \(operacional\)/);
  assert.match(c,/histórico real de compras/i);
  assert.match(c,/Histórico operacional de requisições PCP/);
});
