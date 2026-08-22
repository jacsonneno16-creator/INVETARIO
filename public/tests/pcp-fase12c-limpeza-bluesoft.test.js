const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const servicoCode=fs.readFileSync(path.join(base,'90-bluesoft-service.js'),'utf8');
const importacaoCode=fs.readFileSync(path.join(base,'76-producao-importacao.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

function mockFirestore(docs){
  const registro=new Map(docs.map(d=>[d.id,d.data]));
  const deletados=[];
  const colecao={
    get: async ()=>({ size: registro.size, docs: [...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    doc: (id)=>({ id, _path:id }),
  };
  const rawFs={
    collection: ()=>colecao,
    batch(){
      const ops=[];
      return { delete: (ref)=>ops.push(ref.id), commit: async ()=>{ ops.forEach(id=>{deletados.push(id);registro.delete(id);}); } };
    },
  };
  return { window:{ getDTFirestore:()=>({collection:()=>colecao}), getDTRawFirestore:()=>rawFs }, deletados, registro };
}

test('limparEstoqueBluesoftIrrelevante só marca pra exclusão doc vindo da Bluesoft, sem estoque/reserva/trânsito/pedido, e preserva projeção manual/M1-M3',async()=>{
  const docs=[
    {id:'ruido1',data:{cod:'A',bluesoftSincronizadoEm:'2026-08-01',estoqueAtual:0,estoqueReservado:0,estoqueEmTransito:0,estoqueReservadoVenda:0}},
    {id:'relevante1',data:{cod:'B',bluesoftSincronizadoEm:'2026-08-01',estoqueAtual:50,estoqueReservado:0,estoqueEmTransito:0,estoqueReservadoVenda:0}},
    {id:'ruptura1',data:{cod:'C',bluesoftSincronizadoEm:'2026-08-01',estoqueAtual:0,estoqueReservado:0,estoqueEmTransito:0,estoqueReservadoVenda:8}},
    {id:'manual1',data:{cod:'D',bluesoftSincronizadoEm:'2026-08-01',estoqueAtual:0,venda_m1:30,venda_m2:0,venda_m3:0}},
    {id:'naoBluesoft1',data:{cod:'E',estoqueAtual:0}}, // sem bluesoftSincronizadoEm — nunca deve ser tocado
  ];
  const {window}=mockFirestore(docs);
  vm.runInNewContext(servicoCode,{window,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,URLSearchParams,JSON},{filename:'90-bluesoft-service.js'});

  const previa=await window.limparEstoqueBluesoftIrrelevante(true);
  assert.equal(previa.total,5);
  assert.equal(previa.candidatos,1); // só ruido1

  const r=await window.limparEstoqueBluesoftIrrelevante(false);
  assert.equal(r.removidos,1);
});

test('76 tem o botão de limpeza com confirmação de contagem antes de excluir (mesmo padrão dos outros "Limpar")',()=>{
  assert.match(importacaoCode,/data-pimp-limpar-bluesoft-ruido/);
  assert.match(importacaoCode,/global\.limparEstoqueBluesoftIrrelevante\(true\)/);
  assert.match(importacaoCode,/confirm\(/);
  assert.match(importacaoCode,/global\.limparEstoqueBluesoftIrrelevante\(false\)/);
});

test('Firestore só permite excluir via producao-importacao:importar quando o doc realmente veio da Bluesoft',()=>{
  assert.match(rules,/hasPermission\('producao-importacao', 'importar'\) &&\s*\n\s*resource\.data\.bluesoftSincronizadoEm != null/);
});
