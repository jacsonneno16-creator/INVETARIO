global.window = global;
require('../public/js/shared/address-state-engine.js');
const inventory = {id:'INV-1', base:[
  {endereco:'A1',codigo_produto:'P1',palete:'A',quantidade_esperada:150},
  {endereco:'A1',codigo_produto:'P2',palete:'B',quantidade_esperada:1000}
]};
function run(name, state, expected) {
  const result = InventoryAddressState.consolidate({state:{inventarios:[inventory],...state},record:{inventario_id:'INV-1',endereco:'A1'}});
  if (result.avaliacao.estado !== expected.estado || result.avaliacao.rodada !== expected.rodada || result.esperado !== 1150) {
    throw new Error(name + ': ' + JSON.stringify(result));
  }
  console.log('OK', name, result.status, result.avaliacao.referencia);
}
run('primeira bate', {contagens:[{id:'c1',inventario_id:'INV-1',endereco:'A1',quantidade:1150}]}, {estado:'RESOLVIDA',rodada:1});
run('segunda bate esperado com pallets', {contagens:[
  {id:'c1',inventario_id:'INV-1',endereco:'A1',quantidade:150},
  {id:'r1',inventario_id:'INV-1',endereco:'A1',tipo_contagem:'RECONTAGEM',numero_recontagem:1,palete:'A',quantidade:150},
  {id:'r2',inventario_id:'INV-1',endereco:'A1',tipo_contagem:'RECONTAGEM',numero_recontagem:1,palete:'B',quantidade:1000}
], divergencias:[{id:'d1',inventario_id:'INV-1',endereco:'A1',status:'DIVERGENTE'}]}, {estado:'RESOLVIDA',rodada:2});
run('segunda confirma primeira', {contagens:[{id:'c1',inventario_id:'INV-1',endereco:'A1',quantidade:900}],recontagens:[{id:'r1',inventario_id:'INV-1',endereco:'A1',numero_recontagem:1,qtd_recontagem:900,status:'CONCLUIDA'}]}, {estado:'AGUARDANDO_RECONTAGEM',rodada:2});
run('terceira sem consenso', {contagens:[{id:'c1',inventario_id:'INV-1',endereco:'A1',quantidade:900}],recontagens:[
{id:'r1',inventario_id:'INV-1',endereco:'A1',numero_recontagem:1,qtd_recontagem:1000,status:'CONCLUIDA'},
{id:'r2',inventario_id:'INV-1',endereco:'A1',numero_recontagem:2,qtd_recontagem:1100,status:'CONCLUIDA'}]}, {estado:'PERSISTENTE',rodada:3});
