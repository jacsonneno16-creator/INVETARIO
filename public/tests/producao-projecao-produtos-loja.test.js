const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const code=fs.readFileSync(path.join(__dirname,'../js/analista/66-producao-projecao.js'),'utf8');

function doc(id,data){return{id,data:()=>data};}
function carregar(colecoes){
  const document={addEventListener:()=>{},getElementById:()=>null};
  const window={getDTFirestore:()=>({collection:n=>({get:async()=>({docs:colecoes[n]||[]})})})};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map},{filename:'66-producao-projecao.js'});
  return window;
}

test('lista todo produto cadastrado na produção mesmo sem documento de projeção',async()=>{
  const w=carregar({producao_produtos:[doc('p1',{codigo:'00123',descricao:'Produto cadastrado',ativo:true})],producao_projecao:[]});
  await w.carregarProducaoProjecao(true);
  const linhas=w.calcularProjecaoComRisco('simples');
  assert.equal(linhas.length,1);
  assert.equal(linhas[0].cod,'00123');
  assert.equal(linhas[0].produto,'Produto cadastrado');
});

test('cruza estoque por alias numérico preservando código e nome do cadastro da produção',async()=>{
  const w=carregar({
    producao_produtos:[doc('p1',{cod:'00123',nome:'Produto correto',ativo:true})],
    producao_projecao:[doc('s1',{cod:'123',produto:'Nome externo',estoqueAtual:97.5,venda_m1:30})],
  });
  await w.carregarProducaoProjecao(true);
  const [linha]=w.calcularProjecaoComRisco('simples');
  assert.equal(linha.cod,'00123');
  assert.equal(linha.produto,'Produto correto');
  assert.equal(linha.estoqueAtual,97.5);
});

test('completa o estoque pelo cache BlueSoft sem trocar o nome do cadastro da produção',async()=>{
  const w=carregar({
    producao_produtos:[doc('p1',{cod:'00123',nome:'Produto correto',bluesoftProdutoKey:'CX-123',ativo:true})],
    producao_projecao:[doc('s1',{cod:'00123',venda_m1:30})],
    pcp_estoque_bluesoft:[doc('e1',{cod:'CX-123',estoqueAtual:97.5})],
  });
  await w.carregarProducaoProjecao(true);
  const [linha]=w.calcularProjecaoComRisco('simples');
  assert.equal(linha.produto,'Produto correto');
  assert.equal(linha.estoqueAtual,97.5);
});

test('não esconde erro de leitura de producao_produtos como coleção vazia',async()=>{
  const document={addEventListener:()=>{},getElementById:()=>null};
  const window={getDTFirestore:()=>({collection:n=>({get:async()=>{if(n==='producao_produtos')throw new Error('sem permissão');return{docs:[]};}})})};
  vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map});
  await assert.rejects(()=>window.carregarProducaoProjecao(true),/sem permissão/);
});
