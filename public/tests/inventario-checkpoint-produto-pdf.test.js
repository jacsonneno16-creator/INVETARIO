const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const src=fs.readFileSync(path.join(__dirname,'..','js','analista','50-inventario-classificacoes-v275.js'),'utf8');

function ambiente(t,{inv,contagens=[]}){
  const dom=new JSDOM(`<!doctype html><html><body><div id="acomp-produtos-v275"></div><div id="page-acompanhamento"><div class="sec-header"></div></div></body></html>`,{url:'http://localhost/',runScripts:'outside-only'});
  const w=dom.window;
  const state={inventarios:[inv],contagens,ui:{acompanhamentoInventarioId:inv.id}};
  w.AnalistaStore={getState:()=>state};
  w.DTProdutos={buscarSync:(k)=>({encontrado:true,nomeProduto:k==='P1'?'Produto 1':'Produto X',fator_caixa:12})};
  w.DTContagemFisicaAtual={linhas:()=>contagens};
  w.eval(src);
  t.after(()=>w.close());
  return w;
}

test('checkpoint cria linha zero da base + linha contada e mantém endereço não contado',t=>{
  const inv={id:'inv1',codigo:'58743',status:'ATIVO',base:[
    {codigo_produto:'P1',descricao_produto:'Produto 1',endereco:'14.1520.1.4.11.3.1',pallete_ou_capa:'1002',fator_caixa:12,quantidade_esperada:60,total_unidades_sistema:720},
    {codigo_produto:'P1',descricao_produto:'Produto 1',endereco:'14.1520.1.4.3.3.1',pallete_ou_capa:'1001',fator_caixa:12,quantidade_esperada:60,total_unidades_sistema:720},
  ]};
  const contagens=[
    {inventario_id:'inv1',codigo_produto:'P1',descricao_produto:'Produto 1',endereco:'14.1520.1.4.3.3.1',capa:'2001',quantidade:720,quantidade_unidades:720,tipo_bipagem:'GTIN',status:'PROCESSADO'},
  ];
  const w=ambiente(t,{inv,contagens});
  const rows=w.DTV275.checkpointRows(inv,'P1');
  assert.equal(rows.length,3);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(r=>[r.endereco,r.tipo,r.qtdUn,r.situacao]))),[
    ['14.1520.1.4.3.3.1','BASE',0,'Constava no sistema'],
    ['14.1520.1.4.3.3.1','CONTADO',720,'Contado'],
    ['14.1520.1.4.11.3.1','BASE',0,'Não contado'],
  ]);
  assert.equal(rows[1].palete,'2001');
  assert.equal(rows[1].qtdCx,60,'720 UN com fator 12 deve aparecer como 60 CX');
});

test('produto contado em endereço onde não constava na base aparece só como Fora da base',t=>{
  const inv={id:'inv1',status:'ATIVO',base:[{codigo_produto:'P1',descricao_produto:'Produto 1',endereco:'14.10.1',fator_caixa:12,total_unidades_sistema:120}]};
  const contagens=[{inventario_id:'inv1',codigo_produto:'P1',endereco:'14.2.1',capa:'3001',quantidade:24,quantidade_unidades:24,tipo_bipagem:'GTIN'}];
  const w=ambiente(t,{inv,contagens});
  const rows=w.DTV275.checkpointRows(inv,'P1');
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(r=>[r.endereco,r.tipo,r.situacao]))),[
    ['14.2.1','CONTADO','Fora da base'],
    ['14.10.1','BASE','Não contado'],
  ]);
});

test('tela Por Produto mostra checkbox de checkpoint e botão de PDF após seleção',t=>{
  const inv={id:'inv1',status:'ATIVO',base:[{codigo_produto:'P1',descricao_produto:'Produto 1',endereco:'14.1',fator_caixa:12,total_unidades_sistema:120}]};
  const w=ambiente(t,{inv});
  w.DTV275.renderProductView();
  const ch=w.document.querySelector('[data-checkpoint-prod="P1"]');
  assert.ok(ch);
  ch.click();
  assert.equal(ch.checked,true);
  const box=w.document.getElementById('acomp-prod-checkpoint-actions-v275');
  assert.equal(box.style.display,'flex');
  assert.match(box.textContent,/1 produto selecionado/);
  assert.match(box.textContent,/Baixar checkpoint PDF/);
});
