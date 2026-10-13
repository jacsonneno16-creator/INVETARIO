const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const js=n=>fs.readFileSync(path.join(root,'js','analista',n),'utf8');
const txt=n=>fs.readFileSync(path.join(root,'..',n),'utf8');

test('Fase 1: status de recebimento e produção usam vocabulário único',()=>{
  const fn=txt('functions/index.js'), central=js('78-pcp-central.js'), realizado=js('73-producao-realizado.js'), excel=js('71-producao-excel.js'), acomp=js('84-pcp-compras-acompanhamento.js');
  assert.match(fn,/qtdRecebida>=total\?'finalizada':'parcial'/);
  assert.doesNotMatch(fn,/qtdRecebida>=total\?'finalizada':'parcialmente_recebida'/);
  assert.match(central,/status:final\?'finalizada':'parcial'/);
  assert.match(realizado,/totalReal>0\?'em_andamento'/);
  assert.match(realizado,/status\(r\.dataset\.prealReabrir,'em_andamento'\)/);
  assert.match(excel,/em_andamento','em_producao'/); // legado só entra como alias de leitura
  assert.match(acomp,/parcialmente_comprada/);
  assert.match(acomp,/'parcial'/);
});

test('Fase 2: ponte recebimento atualiza PCP por alias e requisicaoId; regras são por operação',()=>{
  const fn=txt('functions/index.js'), rules=txt('firestore.rules');
  assert.match(fn,/function _aliasesProdutoPcpServidor/);
  assert.match(fn,/itens\.find\(item=>_mesmoProdutoPcpServidor\(x,item\)\)/);
  assert.match(fn,/const requisicaoId=String\(x\.requisicaoId\|\|''\)/);
  assert.match(fn,/batch\.set\(colReq\.doc\(requisicaoId\),reqPayload/);
  const bloco=(rules.match(/match \/recebimento_agendamentos\/\{docId\} \{[\s\S]*?\n      \}/)||[])[0]||'';
  assert.match(bloco,/allow create:/);assert.match(bloco,/allow update:/);assert.match(bloco,/allow delete:/);assert.doesNotMatch(bloco,/allow write:/);
});

test('Fase 3: estoque de insumo da Produção vem do BI sem depender do PCP aberto',async()=>{
  const svc=js('58-producao-insumos-bi-service.js'), lazy=js('00-lazy-areas.js');
  assert.match(lazy,/58-producao-insumos-bi-service\.js\?v=20260928-fases1a8-final/);
  for(const f of ['62-producao-programacao.js','65-producao-insumos.js','67-producao-prog-automatica.js','69-producao-relatorios.js']) assert.match(js(f),/DTProducaoInsumosBI/);
  assert.doesNotMatch(js('67-producao-prog-automatica.js'),/_pcpInternals\?\.getInsumosBi/);
  const window={getDTLojaAtiva:()=> '11'}; vm.runInNewContext(svc,{window,Map,Set,String,Number,Array,Object,Promise,console});
  const r=window.DTProducaoInsumosBI.consolidar([
    {lojaId:'11',sku:'1',produto:'MP - TESTE KG',estoque:5,unidade:'KG',categoria:'Mat. Prima'},
    {lojaId:'11',sku:'1',produto:'MP - TESTE KG',estoque:7,unidade:'KG',categoria:'Mat. Prima'},
    {lojaId:'14',sku:'1',produto:'MP - TESTE KG',estoque:99}
  ],'11');
  assert.equal(r.length,1);assert.equal(r[0].quantidade,12);assert.equal(r[0].fonte,'bi');
});

test('Fase 4: Produção identifica cobertura/risco como métrica operacional/cenário',()=>{
  const proj=js('66-producao-projecao.js'), auto=js('67-producao-prog-automatica.js'), rel=js('69-producao-relatorios.js');
  assert.match(proj,/Cobertura Operacional Média/);assert.match(proj,/Cobertura operacional/);assert.match(proj,/Risco operacional/);
  assert.match(auto,/Cobertura mínima do cenário/);assert.match(auto,/Cobertura alvo do cenário/);assert.match(auto,/Risco operacional do cenário/);
  assert.match(rel,/Cobertura operacional/);assert.match(rel,/Risco operacional/);
});

test('Fase 5: fechamento e Dashboard respeitam enderecos_selecionados',()=>{
  const inv=js('10-inventarios-negocio.js'), dash=js('22-dashboard-render-sync.js');
  assert.match(inv,/selecionadosFechamento/);assert.match(inv,/enderecosDoInventario\.forEach/);
  assert.match(dash,/idsSelecionados/);assert.match(dash,/endsGlobais\.filter/);assert.match(dash,/const totalEnds  = endsBaseTodos\.length/);
  assert.match(dash,/const enderecos = \(dc && dc\.endsBase\)/);assert.match(dash,/const enderecos = dc\.endsBase \|\| \[\]/);
});
