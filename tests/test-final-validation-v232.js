const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const window={};
vm.runInNewContext(fs.readFileSync('public/js/shared/address-state-engine.js','utf8'),{window,console});
const engine=window.InventoryAddressState;
const inv={id:'INV'};
const first=(address,pallet,product='P1',quantity=1,extra={})=>({
  id:`F-${address}-${pallet}-${product}`,inventario_id:'INV',endereco:address,
  tipo_contagem:'PRIMEIRA',palete:pallet,codigo_produto:product,quantidade:quantity,
  status:'DIVERGENTE',...extra
});
const recount=(address,pallet,product='P1',quantity=1,round=1,extra={})=>({
  id:`R${round}-${address}-${pallet}-${product}`,inventario_id:'INV',endereco:address,
  tipo_contagem:'RECONTAGEM',numero_recontagem:round,recontagem_id:`TASK-${address}-${round}`,
  divergencia_id:`DIV-${address}`,palete:pallet,codigo_produto:product,quantidade:quantity,
  status:'CONCLUIDA',status_recontagem:'concluida',recontagem_concluida_em:`2026-07-31T1${round}:00:00Z`,...extra
});
const task=(address,round=1,extra={})=>({
  id:`TASK-${address}-${round}`,inventario_id:'INV',endereco:address,
  divergencia_id:`DIV-${address}`,numero_recontagem:round,status:'CONCLUIDA',
  status_recontagem:'concluida',recontagem_concluida_em:`2026-07-31T1${round}:00:00Z`,...extra
});
const rows=(contagens,recontagens=[])=>engine.latestPhysicalRows({inventarios:[inv],contagens,recontagens},'INV');

// 15 pallets -> 1 pallet: substituição integral, nunca soma.
const fifteen=Array.from({length:15},(_,i)=>first('A1',String(i+1)));
let out=rows([...fifteen,recount('A1','99')],[task('A1')]);
assert.deepStrictEqual(Array.from(out,r=>r.palete),['99']);
assert.equal(out.reduce((s,r)=>s+Number(r.quantidade),0),1);

// Produto e quantidade diferentes pertencem exclusivamente à última rodada.
out=rows([first('A2','1','P1',20),recount('A2','2','P2',7)],[task('A2')]);
assert.equal(out.length,1); assert.equal(out[0].codigo_produto,'P2'); assert.equal(out[0].quantidade,7);

// Endereço vazio não entra em nenhuma fotografia operacional.
out=rows([first('','1')]); assert.equal(out.length,0);

// Terceira contagem (segunda recontagem) substitui completamente a segunda.
out=rows([first('A3','1'),recount('A3','2','P1',5,1),recount('A3','3','P1',2,2)],[task('A3',1),task('A3',2)]);
assert.equal(out.length,1); assert.equal(out[0].palete,'3'); assert.equal(out[0].quantidade,2);

// Recontagem cancelada não apaga nem substitui a primeira rodada válida.
const cancelled=task('A4',1,{status:'CANCELADA',status_recontagem:'cancelada',recontagem_concluida_em:null});
out=rows([first('A4','1'),first('A4','2'),recount('A4','9')],[cancelled]);
assert.deepStrictEqual(Array.from(out,r=>r.palete).sort(),['1','2']);

// Múltiplos pallets do mesmo produto e múltiplos produtos no endereço são preservados.
out=rows([
  first('A5','old'),
  recount('A5','10','P1',3),recount('A5','11','P1',4),recount('A5','12','P2',5)
],[task('A5')]);
assert.equal(out.length,3);
assert.deepStrictEqual(Array.from(out,r=>`${r.palete}:${r.codigo_produto}:${r.quantidade}`).sort(),['10:P1:3','11:P1:4','12:P2:5']);

// Resolver é persistência atômica; consumidores operacionais compartilham a fonte canônica.
const business=fs.readFileSync('public/js/analista/21-divergencias-recontagens.js','utf8');
const recountScreen=fs.readFileSync('public/js/analista/32-render-divergencias-recontagens.js','utf8');
const countScreen=fs.readFileSync('public/js/analista/31-render-contagens-pendencias.js','utf8');
const exportsApi=fs.readFileSync('public/js/analista/43-importar-exportar-api.js','utf8');
const dashboard=fs.readFileSync('public/js/analista/22-dashboard-render-sync.js','utf8');
const inventory=fs.readFileSync('public/js/analista/30-render-inventarios-acompanhamento.js','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');
assert.match(business,/function fsResolverDivergencia[\s\S]*batch\.commit\(\)/);
assert.match(recountScreen,/await fsResolverDivergencia\(divAtualizada,recPayload\)/);
assert.match(countScreen,/InventoryAddressState\?\.latestPhysicalRows/);
assert.match(exportsApi,/InventoryAddressState\.latestPhysicalRows/);
assert.match(dashboard,/function _dashContagens[\s\S]*InventoryAddressState\?\.latestPhysicalRows/);
assert.match(inventory,/function _inventarioContagensFisicas[\s\S]*InventoryAddressState\?\.latestPhysicalRows/);
const inventoryRules=rules.match(/match \/dt_inventarios\/\{docId\}[\s\S]*?match \/base_chunks/)?.[0]||'';
assert.match(inventoryRules,/hasPermission\('inventarios', 'editar'\)/,'atualização continua restrita à permissão de inventários');
assert.match(inventoryRules,/request\.resource\.data\.versao == resource\.data\.versao \|\|[\s\S]*request\.resource\.data\.versao == resource\.data\.versao \+ 1/,'metadados legítimos podem manter a versão; alterações versionadas avançam somente uma unidade');

console.log('OK validação final v232: 9 cenários críticos, consumidores canônicos e regra de versão aprovados.');
