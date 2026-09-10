const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const auditoriaCode=fs.readFileSync(path.join(base,'80-pcp-auditoria.js'),'utf8');
const parametrosCode=fs.readFileSync(path.join(base,'81-pcp-parametros.js'),'utf8');
const pcpCode=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');
const permCode=fs.readFileSync(path.join(base,'37-usuarios-permissoes.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(__dirname,'../js/analista/00-lazy-areas.js'),'utf8');

function loadAuditoria(){
  const escritas=[];
  const colRef={add:async(payload)=>{escritas.push(payload);return {id:'x'};},where(){return this;},get:async()=>({docs:[]})};
  const window={getDTFirestore:()=>({collection:()=>colRef}),_currentAnalistaUser:{email:'user@x.com'}};
  vm.runInNewContext(auditoriaCode,{window,console,Date,Math,Number,String,Array,Object,Promise});
  return {window,escritas};
}

test('registrarAuditoria não grava nada quando os valores não mudam',async()=>{
  const {window,escritas}=loadAuditoria();
  const r=await window.registrarAuditoria({colecao:'producao_produtos',docId:'d1',produtoCod:'001',produtoNome:'X',antes:{a:1,b:2},depois:{a:1,b:2},camposRastreados:['a','b']});
  assert.equal(r,null);
  assert.equal(escritas.length,0);
});

test('registrarAuditoria grava só os campos que realmente mudaram, com antes/depois',async()=>{
  const {window,escritas}=loadAuditoria();
  await window.registrarAuditoria({colecao:'producao_produtos',docId:'d1',produtoCod:'001',produtoNome:'Açúcar',antes:{a:1,b:2,c:'x'},depois:{a:5,b:2,c:'y'},camposRastreados:['a','b','c']});
  assert.equal(escritas.length,1);
  const alt=escritas[0].alteracoes;
  assert.equal(alt.length,2);
  const a=alt.find(x=>x.campo==='a'),c=alt.find(x=>x.campo==='c');
  assert.equal(a.valorAnterior,1);assert.equal(a.valorNovo,5);
  assert.equal(c.valorAnterior,'x');assert.equal(c.valorNovo,'y');
  assert.equal(escritas[0].produtoCod,'001');
  assert.equal(escritas[0].criadoPor,'user@x.com');
});

test('auditoria é append-only (helper exportado, sem update/delete)',()=>{
  assert.match(auditoriaCode,/global\.registrarAuditoria\s*=\s*registrarAuditoria/);
  assert.match(auditoriaCode,/global\.listarAuditoria\s*=\s*listarAuditoria/);
  assert.doesNotMatch(auditoriaCode,/\.collection\(COL\)\.doc\([^)]*\)\.(update|delete)\(/);
});

test('Parâmetros do PCP cobrem os campos novos de cobertura/compra e reaproveitam producao_produtos',()=>{
  for(const campo of ['estoqueMinimo','estoqueMaximo','estoqueSeguranca','leadTimeDias','loteMinimoCompra','multiploCompra','criticidade','fornecedorPadrao','metaCoberturaDias']){
    assert.match(parametrosCode,new RegExp(campo));
  }
  assert.match(parametrosCode,/COL_PRODUTOS = 'producao_produtos'/);
  assert.match(parametrosCode,/registrarAuditoria/);
  assert.match(parametrosCode,/pcpp-massa/);
});

test('PCP está ligado à página de Parâmetros (registro dinâmico + sidebar + Firestore)',()=>{
  assert.match(pcpCode,/pcpRegistrarPagina/);
  assert.match(pcpCode,/global\.pcpRegistrarPagina\s*=\s*pcpRegistrarPagina/);
  assert.match(htmlCode,/id="page-pcp-parametros"/);
  assert.match(htmlCode,/pcpIrParaAba\('parametros',this\)/);
  assert.match(htmlCode,/81-pcp-parametros\.js/);
  assert.match(permCode,/id:'pcp-central'.*'configurar'/);
  assert.match(rules,/match \/pcp_auditoria/);
  assert.match(rules,/hasPermission\('pcp-central', 'configurar'\)/);
  for(const campo of ['estoqueMinimo','estoqueMaximo','estoqueSeguranca','leadTimeDias','loteMinimoCompra','multiploCompra','criticidade','fornecedorPadrao']){
    assert.match(rules,new RegExp(campo));
  }
});
