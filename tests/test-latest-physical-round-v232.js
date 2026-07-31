const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const window={};
vm.runInNewContext(fs.readFileSync('public/js/shared/address-state-engine.js','utf8'),{window,console});
const engine=window.InventoryAddressState;

const first=Array.from({length:15},(_,i)=>({
  id:`c${i+1}`,inventario_id:'INV',endereco:'A1',tipo_contagem:'PRIMEIRA',
  palete:String(i+1),codigo_produto:'P1',quantidade:1,status:'DIVERGENTE'
}));
const recount={
  id:'rc1',inventario_id:'INV',endereco:'A1',tipo_contagem:'RECONTAGEM',numero_recontagem:1,
  recontagem_id:'R1',divergencia_id:'D1',palete:'99',codigo_produto:'P1',quantidade:1,
  status:'CONCLUIDA',recontagem_concluida_em:'2026-07-31T12:00:00Z'
};
const state={inventarios:[{id:'INV'}],contagens:first.concat(recount),recontagens:[{
  id:'R1',inventario_id:'INV',endereco:'A1',divergencia_id:'D1',numero_recontagem:1,
  status:'CONCLUIDA',status_recontagem:'concluida',recontagem_concluida_em:'2026-07-31T12:00:00Z'
}]};
const current=engine.latestPhysicalRows(state,'INV');
assert.equal(current.length,1,'recontagem com um palete deve substituir os 15 anteriores');
assert.equal(current[0].id,'rc1');
assert.equal(current.reduce((sum,row)=>sum+Number(row.quantidade||0),0),1,'não pode somar rodadas');

const pending=JSON.parse(JSON.stringify(state));
pending.recontagens[0].status='PENDENTE';
pending.recontagens[0].status_recontagem='pendente';
delete pending.recontagens[0].recontagem_concluida_em;
assert.equal(engine.latestPhysicalRows(pending,'INV').length,15,'recontagem pendente não pode substituir a rodada válida');

console.log('OK v232: substituição integral da rodada física validada.');

const contagens=fs.readFileSync('public/js/analista/31-render-contagens-pendencias.js','utf8');
const integracao=fs.readFileSync('public/js/analista/43-importar-exportar-api.js','utf8');
const negocio=fs.readFileSync('public/js/analista/21-divergencias-recontagens.js','utf8');
const recontagemTela=fs.readFileSync('public/js/analista/32-render-divergencias-recontagens.js','utf8');
assert.match(contagens,/InventoryAddressState\?\.latestPhysicalRows/,'Contagem deve usar a fotografia compartilhada');
assert.match(integracao,/InventoryAddressState\.latestPhysicalRows/,'Relatórios/API devem usar a fotografia compartilhada');
assert.match(negocio,/function fsResolverDivergencia[\s\S]*batch\.commit\(\)/,'Resolver deve persistir em batch');
assert.match(recontagemTela,/await fsResolverDivergencia\(divAtualizada,recPayload\)/,'botão Resolver deve aguardar o batch');
assert.doesNotMatch(recontagemTela,/Promise\.all\(gravacoes\)/,'Resolver não pode fazer gravações independentes');
console.log('OK v232: Contagem, relatórios e Resolver usam persistência/lógica canônicas.');
