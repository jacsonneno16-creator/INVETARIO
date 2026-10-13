'use strict';
// Exige emulador Firestore local. Nunca conecta à produção.
const {initializeTestEnvironment,assertSucceeds}=require('@firebase/rules-unit-testing');
const fs=require('fs'),path=require('path');
async function negado(p){let erro;try{await p;}catch(e){erro=e;}if(!erro)throw new Error('Escrita indevida permitida.');if(erro.code!=='permission-denied')throw erro;if(/maximum of 1000|Unable to evaluate the expression/i.test(erro.message))throw erro;}
(async()=>{
  const host=process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8180';if(!/^127\.0\.0\.1:\d+$/.test(host))throw new Error('Use somente emulador local.');
  const e=await initializeTestEnvironment({projectId:'demo-dt-permissoes',firestore:{host:'127.0.0.1',port:Number(host.split(':')[1]),rules:fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8')}});
  try{
    await e.withSecurityRulesDisabled(async c=>{
      const d=c.firestore();
      await d.doc('usuarios_acessos/root').set({perfil:'administrador',ativo:true,acesso_todas_lojas:true,canais_acesso:{analista:true}});
      await d.doc('usuarios_acessos/gestor').set({perfil:'analista',ativo:true,acesso_todas_lojas:false,lojas_permitidas:['matriz'],canais_acesso:{analista:true},permissoes:{operadores:{criar:true,editar:true,visualizar:true},inventarios:{visualizar:true}},gestao_areas:{areas:['inventario'],operacoes:{criar:true,editar:true,atribuir:true}}});
      await d.doc('usuarios_acessos/alvo').set({perfil:'analista',ativo:true,lojas_permitidas:['matriz'],permissoes:{inventarios:{visualizar:true}}});
      await d.doc('usuarios_acessos/legado').set({perfil:'analista',ativo:true,lojas_permitidas:['matriz'],canais_acesso:{analista:true},permissoes:{operadores:{criar:true,editar:true}}});
    });
    const gestor=e.authenticatedContext('gestor').firestore(),legado=e.authenticatedContext('legado').firestore(),root=e.authenticatedContext('root').firestore();
    await negado(gestor.doc('usuarios_acessos/alvo').update({permissoes:{inventarios:{visualizar:true,excluir:true}}}));
    await negado(gestor.doc('usuarios_acessos/gestor').update({gestao_areas:{areas:['compras']}}));
    await negado(legado.doc('usuarios_acessos/alvo').update({gestao_areas:{areas:['inventario']}}));
    await negado(gestor.doc('dt_modelos_acesso/teste').set({nome:'Fraude'}));
    await negado(root.doc('dt_modelos_acesso/teste').set({nome:'Cliente direto'}));
    await negado(gestor.doc('dt_setores_endereco/teste').set({setorOperacionalKey:1}));
    await assertSucceeds(root.doc('usuarios_acessos/alvo').update({nome:'Nome atualizado'}));
    console.log('7 verificações reais de Rules passaram; modelo/setor somente via Functions.');
  }finally{await e.cleanup();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
