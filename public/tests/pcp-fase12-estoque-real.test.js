const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');
const projecaoCode=fs.readFileSync(path.join(base,'66-producao-projecao.js'),'utf8');
const importacaoCode=fs.readFileSync(path.join(base,'76-producao-importacao.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

test('calcularProjecaoComRisco: real (Bluesoft) > histórico (M1/M2/M3) > manual só quando explicitamente pedido',async()=>{
  const document={addEventListener:()=>{}};
  const docs=[
    {id:'a',data:()=>({cod:'A',produto:'Com Bluesoft',venda_m1:10,venda_m2:10,venda_m3:10,consumoDiaMedioBluesoft:5,estoqueAtual:100})},
    {id:'b',data:()=>({cod:'B',produto:'Sem Bluesoft',venda_m1:30,venda_m2:30,venda_m3:30,estoqueAtual:100})},
    {id:'c',data:()=>({cod:'C',produto:'Manual',venda_m1:10,venda_m2:10,venda_m3:10,consumoDiaMedioBluesoft:5,projecaoManual:900,estoqueAtual:100})},
  ];
  const window={getDTFirestore:()=>({collection:()=>({get:async()=>({docs})})})};
  vm.runInNewContext(projecaoCode,{window,document,console,Date,Math,Number,String,Array,Object},{filename:'66-producao-projecao.js'});
  await window.carregarProducaoProjecao(true);
  const linhas=window.calcularProjecaoComRisco('simples');
  const a=linhas.find(x=>x.cod==='A'), b=linhas.find(x=>x.cod==='B'), c=linhas.find(x=>x.cod==='C');
  assert.equal(a.origemConsumo,'bluesoft');
  assert.equal(Math.round(a.projMensal),Math.round(5*30.44));
  assert.equal(b.origemConsumo,'historico');
  assert.equal(b.projMensal,30);
  const linhasManual=window.calcularProjecaoComRisco('manual');
  const cManual=linhasManual.find(x=>x.cod==='C');
  assert.equal(cManual.origemConsumo,'manual');
  assert.equal(cManual.projMensal,900);
});

test('sincronizarEstoqueBluesoft usa a loja ativa, faz upsert por cod e nunca escreve projecaoManual/venda_m1-3',()=>{
  assert.match(servicoCode,/global\.sincronizarEstoqueBluesoft\s*=\s*sincronizarEstoqueBluesoft/);
  assert.match(servicoCode,/getDTLojaAtiva/);
  const trecho=servicoCode.slice(servicoCode.indexOf('async function sincronizarEstoqueBluesoft'),servicoCode.indexOf('global.sincronizarEstoqueBluesoft = sincronizarEstoqueBluesoft;'));
  assert.doesNotMatch(trecho,/projecaoManual/);
  assert.doesNotMatch(trecho,/venda_m1/);
});

// PEDIDO AO VIVO (2026-08-27): "tira tudo da bluesoft" — estoque de
// produto acabado já vem do SharePoint (sincronizarBiAgendado em
// functions/index.js), botão de buscar estoque via Bluesoft removido de
// 76. sincronizarEstoqueBluesoft (90-bluesoft-service.js) continua
// existindo e testada — só não tem mais botão nesta tela que a chame. O
// fallback manual (Excel) e a limpeza continuam existindo.
test('76 NÃO tem mais o botão de buscar estoque (Bluesoft) — estoque já vem do SharePoint —, mantendo o fallback manual existente (Excel) e sem o painel de API genérica próprio da Produção',()=>{
  assert.doesNotMatch(importacaoCode,/data-pimp-bluesoft-estoque/);
  assert.doesNotMatch(importacaoCode,/global\.sincronizarEstoqueBluesoft/);
  assert.match(importacaoCode,/data-pimp-file="estoque-pa"/);
  assert.doesNotMatch(importacaoCode,/data-pimp-api-sync|data-pimp-api-salvar|data-pimp-api-testar|producao_config['"]\)\.doc\('api'\)/);
});

test('Firestore rules dão via de escrita em producao_projecao pra sincronização de estoque, restrita aos campos reais',()=>{
  assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['cod','produto','estoqueAtual','estoqueReservado','estoqueEmTransito','estoqueReservadoVenda','custoUltimaCompra','custoMedioContabil','consumoDiaMedioBluesoft','bluesoftSincronizadoEm','atualizadoEm','atualizadoPor'\]\)/);
});
