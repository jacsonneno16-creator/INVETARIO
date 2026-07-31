const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync(__dirname+'/../public/js/shared/address-state-engine.js','utf8');
const sandbox={window:{}}; vm.createContext(sandbox); vm.runInContext(code,sandbox);
const M=sandbox.window.InventoryAddressState;
function st(expected,first,second,third){
 const contagens=[{id:'c1',inventario_id:'I',endereco:'A',quantidade:first,tipo_contagem:'PRIMEIRA'}];
 if(second!=null) contagens.push({id:'c2',inventario_id:'I',endereco:'A',quantidade:second,tipo_contagem:'RECONTAGEM',numero_recontagem:1});
 if(third!=null) contagens.push({id:'c3',inventario_id:'I',endereco:'A',quantidade:third,tipo_contagem:'RECONTAGEM',numero_recontagem:2});
 return {inventarios:[{id:'I',base:[{endereco:'A',codigo_produto:'P1',palete:'1',quantidade:expected}]}],contagens,divergencias:[{id:'d',inventario_id:'I',endereco:'A'}],recontagens:[]};
}
let x=M.consolidate({state:st(1150,150,1150,null),record:{inventario_id:'I',endereco:'A'}}); assert.equal(x.status,'RESOLVIDA'); assert.equal(x.segunda,1150);
x=M.consolidate({state:st(1150,900,900,null),record:{inventario_id:'I',endereco:'A'}}); assert.equal(x.status,'EM_RECONTAGEM');
x=M.consolidate({state:st(1150,900,900,900),record:{inventario_id:'I',endereco:'A'}}); assert.equal(x.status,'PERSISTENTE');
x=M.consolidate({state:st(1150,1150,null,null),record:{inventario_id:'I',endereco:'A'}}); assert.equal(x.status,'RESOLVIDA');
const d=M.decorate({inventario_id:'I',endereco:'A',status:'DIVERGENTE'},st(1150,1150,null,null)); assert.equal(d.status,'RESOLVIDA'); assert.equal(d.divergente,false);
console.log('OK address-state v202');
