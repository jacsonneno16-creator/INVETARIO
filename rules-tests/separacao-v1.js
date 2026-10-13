'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const admin=require('../functions/node_modules/firebase-admin');
async function negado(p){let e;try{await p;}catch(x){e=x;}assert.ok(e,'Acesso direto indevido permitido');assert.equal(e.code,'permission-denied');assert.doesNotMatch(e.message,/maximum of 1000|Unable to evaluate the expression/i);}
(async()=>{
 const host=process.env.FIRESTORE_EMULATOR_HOST;if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw new Error('Exige emulador local.');
 const projectId='demo-dt-separacao',env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:Number(host.split(':')[1]),rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});
 const app=admin.initializeApp({projectId},'test-separacao'),db=app.firestore();let count=0;
 const m='estoque-separacao',actions=['visualizar','criar','editar','iniciar','finalizar','registrar-erro','tratar-erro','cancelar','reabrir','configurar'];
 try{
 await db.doc('lojas/matriz').set({ativo:true});await db.doc('usuarios_acessos/root').set({perfil:'administrador',ativo:true,acesso_todas_lojas:true,canais_acesso:{analista:true,coletor:true}});await db.doc('usuarios_acessos/conf').set({nome:'Conferente',ativo:true,lojas_permitidas:['matriz'],canais_acesso:{coletor:true},permissoes:{[m]:{visualizar:true,'registrar-erro':true}}});await db.doc('lojas/matriz/sep_pessoas/p1').set({nome:'Separador',ativo:true});
 const root=env.authenticatedContext('root').firestore(),conf=env.authenticatedContext('conf').firestore();
 for(const col of ['sep_cargas','sep_erros','sep_pessoas','sep_operacoes','sep_chaves_carga','sep_cadastros_historico']){
  await negado(root.doc('lojas/matriz/'+col+'/tentativa').set({fraude:true}));count++;
  await negado(conf.doc('lojas/matriz/'+col+'/tentativa').get());count++;
 }
 await negado(root.doc('lojas/matriz/sep_cargas/c/historico/e').set({fraude:true}));count++;
 class HttpsError extends Error{constructor(code,msg){super(msg);this.code=code;}}
 const functions={https:{HttpsError},region:()=>({runWith:()=>({https:{onCall:fn=>fn}})})};
 const api=require('../functions/separacao')({db,admin,functions}),ctx={auth:{uid:'root'}};
 const carga={viagem:'123',numeroCarga:'555',motoristaCodigo:'20',veiculoTipo:'VAN',volumes:11,caixas:10,avulsos:1,bipadas:7,separadores:['p:p1']};
 const create={lojaId:'matriz',canal:'analista',requestId:'create_idempotente_0001',carga};
 const [a,b]=await Promise.all([api.separacaoSalvarCarga(create,ctx),api.separacaoSalvarCarga(create,ctx)]);assert.equal(a.id,b.id);assert.equal((await db.collection('lojas/matriz/sep_cargas').get()).size,1);count++;
 const err={lojaId:'matriz',canal:'coletor',cargaId:a.id,viagem:'123',numeroCarga:'555',ciclo:1,requestId:'erro_idempotente_0001',erro:{tipo:'FALTA',produto:'A',unidade:'CX',qtdEsperada:10,qtdEncontrada:9}};
 const ec={auth:{uid:'conf'}},[x,y]=await Promise.all([api.separacaoRegistrarErro(err,ec),api.separacaoRegistrarErro(err,ec)]);assert.equal(x.id,y.id);assert.equal((await db.doc('lojas/matriz/sep_cargas/'+a.id).get()).data().errosAbertos,1);count++;
 const another={...create,requestId:'create_concorrente_0002',carga:{...carga,numeroCarga:'777'}},third={...another,requestId:'create_concorrente_0003'};
 const results=await Promise.allSettled([api.separacaoSalvarCarga(another,ctx),api.separacaoSalvarCarga(third,ctx)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'already-exists');count++;
 await api.separacaoTratarErro({lojaId:'matriz',canal:'analista',requestId:'resolve_0000000001',id:x.id,versao:1,status:'RESOLVIDA',tratamento:'corrigida',corrigidoPor:'Pessoa',confirmadoPor:'Conferente'},ctx);assert.equal((await db.doc('lojas/matriz/sep_cargas/'+a.id).get()).data().errosAbertos,0);count++;
 const details=await api.separacaoObter({lojaId:'matriz',canal:'analista',id:a.id},ctx);assert.equal(details.erros.length,1);assert.equal(details.eventos.length,3);count++;
 const list=await api.separacaoListar({lojaId:'matriz',canal:'coletor',campo:'viagem',busca:'123'},ec);assert.equal(list.cargas.length,2);count++;
 const dia=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());const periodo=await api.separacaoListar({lojaId:'matriz',canal:'analista',dataInicio:dia,dataFim:dia},ctx);assert.equal(periodo.cargas.length,2);count++;
 console.log(count+' verificações reais de Separação passaram: Rules, transações concorrentes, idempotência, chave única, histórico e consulta.');
 }finally{await env.cleanup();await app.delete();}
})().catch(e=>{console.error(e);process.exitCode=1;});
