const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'122-pcp-insumo-360.js'),'utf8');
const central=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
const prodIns=fs.readFileSync(path.join(base,'85-pcp-producao-insumos.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');
const lazy=fs.readFileSync(path.join(base,'00-lazy-areas.js'),'utf8');

function load(){
  const listeners={};
  const document={addEventListener:(ev,fn)=>{listeners[ev]=fn;},querySelectorAll:()=>[],getElementById:()=>null};
  const window={document,pcpRegistrarPagina:()=>{},_pcpInternals:{getInsumosBi:()=>[{cod:'79922',produto:'MP – URUCUM KG',grupo:'materia-prima',tipo:'Ingrediente',estoque:100,consumoMensal:300,coberturaDias:10,estoqueAlvo:300,diasAlvo:30,unidade:'kg'}]},_producaoInsumosInternals:{canonInsumo:v=>String(v||'').replace(/^MP\s*[-–]\s*/i,'').toUpperCase().trim(),getFichas:()=>[{cod:'P1',desc:'Produto 1',insumos:[{insumo:'MP - URUCUM KG',bluesoftProdutoKey:'79922',qty:2,categoria:'Materia prima'}]}]},_pcpProducaoInsumosInternals:{getHorizonte:()=>30,getUltimoCalculo:()=>({porInsumo:[{cod:'79922',insumo:'MP - URUCUM KG',necessidade:120,disponivel:100}],porOP:[{produto:'Produto 1',maquina:'M1',data:'2026-09-20',qntCaixas:20,insumos:[{cod:'79922',insumo:'MP - URUCUM KG',necessidade:40}]},{produto:'Produto 1',maquina:'M1',data:'2026-09-21',qntCaixas:40,insumos:[{cod:'79922',insumo:'MP - URUCUM KG',necessidade:80}]}]})}};
  window.window=window;vm.createContext(window);vm.runInContext(code,window,{filename:'122-pcp-insumo-360.js'});return window;
}

test('Insumo 360 usa somente caches já carregados e não acessa Firestore/BI diretamente',()=>{
  assert.doesNotMatch(code,/getDTFirestore|\.collection\s*\(|lerJson\s*\(|buscarInsumosBi\s*\(/);
  assert.match(code,/getInsumosBi/);assert.match(code,/getFichas/);assert.match(code,/getUltimoCalculo/);
});

test('Insumo 360 cruza por código e mostra produtos/OPs que consomem o material',()=>{
  const w=load();
  w._pcpInsumo360Internals._match('79922','MP – URUCUM KG','79922','nome diferente');
  const prods=w._pcpInsumo360Internals._produtosQueUsam();
  assert.equal(prods.length,0,'sem chave selecionada ainda não deve casar qualquer componente');
  // usa abrirInsumo360 para definir a chave, com DOM mínimo neutro
  w.document.querySelectorAll=()=>[];w.document.getElementById=()=>null;w.abrirInsumo360('79922','MP – URUCUM KG');
  assert.equal(w._pcpInsumo360Internals._acharBi().estoque,100);
  assert.equal(w._pcpInsumo360Internals._produtosQueUsam()[0].produto,'Produto 1');
  assert.equal(w._pcpInsumo360Internals._opsRelacionadas().length,2);
});

test('Insumo 360 calcula a primeira OP que estoura o estoque e sugestão usa maior risco entre cobertura e programação',()=>{
  const w=load();w.document.querySelectorAll=()=>[];w.document.getElementById=()=>null;w.abrirInsumo360('79922','MP – URUCUM KG');
  const ops=w._pcpInsumo360Internals._opsRelacionadas();
  const risco=w._pcpInsumo360Internals._riscoPorOps(100,ops);
  assert.equal(risco.saldoProjetado,-20);assert.equal(risco.rupturaEm,'2026-09-21');
  const estado=w._pcpInsumo360Internals._estado(w._pcpInsumo360Internals._acharBi(),w._pcpInsumo360Internals._necessidadeProgramada(),ops);
  assert.equal(estado.faltaProducao,20);assert.equal(estado.reposicaoCobertura,200);assert.equal(estado.sugestao,200);
});

test('Telas de Insumos abrem o 360 e página/módulo estão ligados no shell PCP',()=>{
  assert.match(central,/data-pcp-insumo-360=/);assert.match(prodIns,/data-pcp-insumo-360=/);
  assert.match(html,/id="page-pcp-insumo-360"/);assert.match(lazy,/122-pcp-insumo-360\.js/);
  assert.match(code,/pcpRegistrarPagina\('insumo-360'/);
});

test('85 mantém último cálculo em memória para o Insumo 360 sem nova leitura',()=>{
  assert.match(prodIns,/getUltimoCalculo:\s*\(\)\s*=>\s*_ultimoCalculo/);
  assert.match(prodIns,/_ultimoCalculo\s*=\s*\{\s*porInsumo,\s*porOP:\s*resultado\.porOP\s*\}/);
});
