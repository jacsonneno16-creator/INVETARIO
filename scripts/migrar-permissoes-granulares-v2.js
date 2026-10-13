'use strict';
/**
 * Backfill seguro das permissões introduzidas no V2.
 *
 * Uso:
 *   node scripts/migrar-permissoes-granulares-v2.js            # dry-run
 *   node scripts/migrar-permissoes-granulares-v2.js --apply    # grava
 *   node scripts/migrar-permissoes-granulares-v2.js --service-account=/caminho/credencial.json
 *
 * O script nunca sobrescreve uma chave já existente (true OU false). Ele só
 * materializa o acesso efetivo legado quando a chave nova ainda não existe.
 */
const path=require('node:path');
const fs=require('node:fs');
const admin=require(path.join(__dirname,'..','functions','node_modules','firebase-admin'));
const APPLY=process.argv.includes('--apply');
const argSa=process.argv.find(x=>x.startsWith('--service-account='));
const SA=argSa?argSa.slice('--service-account='.length):(process.env.GOOGLE_APPLICATION_CREDENTIALS||'');
if(admin.apps.length===0){
  if(SA){
    if(!fs.existsSync(SA))throw new Error('Service account não encontrado: '+SA);
    admin.initializeApp({credential:admin.credential.cert(require(path.resolve(SA)))});
  }else{
    admin.initializeApp();
  }
}
const db=admin.firestore();
const RECEBIMENTO_BASE=['recebimento-operacao','recebimento-transbordo','recebimento-notas','recebimento-dashboard'];
const RECUSAS_ACOES=['visualizar','entrada','saida','rastrear','identificar','criar','editar','excluir','importar','exportar'];
function get(obj,pathStr){return pathStr.split('.').reduce((v,k)=>v&&typeof v==='object'?v[k]:undefined,obj);}
function has(obj,pathStr){const ks=pathStr.split('.');let v=obj;for(const k of ks){if(!v||typeof v!=='object'||!Object.prototype.hasOwnProperty.call(v,k))return false;v=v[k];}return true;}
function setIfMissing(updates,data,pathStr,value){if(!has(data,pathStr))updates[pathStr]=value;}
function ehColetor(a){return a?.canais_acesso?.coletor===true||a?.perfil==='operador';}
function ehAnalista(a){return a?.canais_acesso?.analista===true||a?.perfil==='analista';}
function temVisual(a,mods){return mods.some(m=>get(a,'permissoes.'+m+'.visualizar')===true);}
async function main(){
  console.log(APPLY?'=== APPLY: gravação habilitada ===':'=== DRY-RUN: nada será gravado ===');
  const snap=await db.collection('usuarios_acessos').get();
  let alterados=0,campos=0,semMudanca=0;const planos=[];
  for(const doc of snap.docs){
    const a=doc.data()||{},u={};
    if(ehColetor(a)){
      setIfMissing(u,a,'permissoes.inventarios.visualizar',true);
      setIfMissing(u,a,'permissoes.inventarios.contar',true);
      setIfMissing(u,a,'permissoes.auditoria.visualizar',true);
      setIfMissing(u,a,'permissoes.auditoria.conferir',true);
      setIfMissing(u,a,'permissoes.recontagens.visualizar',true);
      setIfMissing(u,a,'permissoes.recontagens.executar',true);
    }
    if(ehAnalista(a)&&temVisual(a,RECEBIMENTO_BASE)){
      if(!has(a,'permissoes.recebimento-recusas')){
        for(const acao of RECUSAS_ACOES)u['permissoes.recebimento-recusas.'+acao]=true;
      }
    }
    if(ehAnalista(a)&&temVisual(a,[...RECEBIMENTO_BASE,'recebimento-recusas'])){
      setIfMissing(u,a,'permissoes.recebimento-patio-tempo-real.visualizar',true);
    }
    const keys=Object.keys(u);
    if(!keys.length){semMudanca++;continue;}
    alterados++;campos+=keys.length;planos.push({id:doc.id,email:a.email||'',updates:u});
  }
  console.log(`usuarios_acessos: ${snap.size}; a alterar: ${alterados}; sem mudança: ${semMudanca}; campos novos: ${campos}`);
  planos.slice(0,20).forEach(x=>console.log('-',x.id,x.email,Object.keys(x.updates).join(', ')));
  if(planos.length>20)console.log(`... +${planos.length-20} usuário(s)`);
  if(!APPLY){console.log('DRY-RUN concluído. Rode novamente com --apply somente após revisar o resumo.');return;}
  for(let i=0;i<planos.length;i+=400){
    const batch=db.batch();
    for(const x of planos.slice(i,i+400))batch.update(db.collection('usuarios_acessos').doc(x.id),x.updates);
    await batch.commit();
    console.log(`Lote ${Math.floor(i/400)+1}: ${Math.min(400,planos.length-i)} usuário(s) gravados.`);
  }
  console.log('Migração concluída.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
