'use strict';
const P=require('./permissoes-politica');
module.exports=function({db,admin,functions}){
  const fail=(msg)=>{throw new functions.https.HttpsError('permission-denied',msg);};
  async function ator(ctx){if(!ctx.auth)fail('Faça login.');const s=await db.collection('usuarios_acessos').doc(ctx.auth.uid).get();if(!s.exists||s.data().ativo===false)fail('Acesso inativo.');return s.data();}
  const audit=(batch,ctx,tipo,alvo,antes,depois)=>batch.set(db.collection('dt_acessos_auditoria').doc(),{autor_uid:ctx.auth.uid,tipo,alvo,antes:antes||null,depois:depois||null,criado_em:admin.firestore.FieldValue.serverTimestamp()});
  function campos(d){
    const out={};for(const k of ['nome','setor','perfil','ativo','canais_acesso','setores_permitidos','permissoes','acesso_todas_lojas','lojas_permitidas','papelCompras','compradoresGerenciados','modelo_acesso_id','modelo_acesso_versao','gestao_areas','email_recuperacao'])if(d[k]!==undefined)out[k]=d[k];
    if(typeof out.nome!=='string'||!out.nome.trim()||out.nome.length>180)throw new Error('Nome inválido.');
    if(out.email_recuperacao!==undefined){out.email_recuperacao=String(out.email_recuperacao).trim().toLowerCase();if(out.email_recuperacao&&(out.email_recuperacao.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email_recuperacao)))throw new Error('Informe um e-mail real válido para recuperação.');}
    out.nome=out.nome.trim();out.setor=String(out.setor||'').slice(0,120);
    if(!['analista','operador'].includes(out.perfil))throw new Error('Perfil inválido.');
    if(typeof out.ativo!=='boolean'||typeof out.acesso_todas_lojas!=='boolean')throw new Error('Status ou acesso de loja inválido.');
    if(!out.canais_acesso||(!out.canais_acesso.analista&&!out.canais_acesso.coletor))throw new Error('Selecione canal.');
    out.canais_acesso={analista:out.canais_acesso.analista===true,coletor:out.canais_acesso.coletor===true};
    if(!Array.isArray(out.lojas_permitidas)||out.lojas_permitidas.length>50||out.lojas_permitidas.some(x=>typeof x!=='string'||!x||x.includes('/')))throw new Error('Lojas inválidas.');
    if(!out.acesso_todas_lojas&&!out.lojas_permitidas.length)throw new Error('Selecione lojas.');
    out.permissoes=P.normalizar(out.permissoes);out.gestao_areas=P.validarDelegacao(out.gestao_areas);
    return out;
  }
  async function modeloValido(a,d){
    if(!d.modelo_acesso_id)return;
    if(!/^[A-Za-z0-9_-]{1,120}$/.test(d.modelo_acesso_id))throw new Error('Modelo inválido.');
    const s=await db.collection('dt_modelos_acesso').doc(d.modelo_acesso_id).get();
    if(!s.exists||s.data().ativo===false)throw new Error('Modelo inativo ou inexistente.');
    const m=s.data();if(!P.mestre(a)&&P.pares(m.permissoes).some(([mod,ac])=>!P.concedivel(a,mod,ac)))throw new Error('Modelo fora do escopo.');
    d.modelo_acesso_versao=m.versao;d.setor=m.nome;
  }
  async function gravar(ctx,a,uid,d,identidade){
    const principal=db.collection('usuarios_acessos').doc(uid);
    await db.runTransaction(async tx=>{
      const [act,old]=await Promise.all([tx.get(db.collection('usuarios_acessos').doc(ctx.auth.uid)),tx.get(principal)]);
      const atual=act.data(),antes=old.exists?old.data():null;
      let novo=P.validarAlteracao(atual,antes,d,uid,ctx.auth.uid);
      if(antes&&d.email_recuperacao===undefined)novo.email_recuperacao=antes.email_recuperacao||'';
      if(!P.mestre(atual)&&antes && Object.keys(antes.gestao_areas||{}).length)fail('Conta responsável protegida.');
      const vinculos=antes?Array.from(new Set([uid,antes.analista_uid,antes.coletor_uid,...(antes.uids_vinculados||[])].filter(Boolean))):identidade.uids_vinculados;
      if(vinculos.length>3)throw new Error('Vínculos inválidos.');
      const refs=vinculos.map(x=>db.collection('usuarios_acessos').doc(x));
      const docs=await Promise.all(refs.map(r=>tx.get(r)));
      docs.forEach((s,i)=>{if(vinculos[i]!==uid&&s.exists&&s.data().cadastro_principal_uid!==uid)throw new Error('Identidade vinculada pertence a outro cadastro.');});
      const ls=novo.acesso_todas_lojas?(await tx.get(db.collection('lojas'))).docs.map(x=>x.id):novo.lojas_permitidas;
      if(ls.length>100)throw new Error('Mais de 100 lojas: revise o escopo.');
      const antigas=antes&&antes.acesso_todas_lojas?(await tx.get(db.collection('lojas'))).docs.map(x=>x.id):antes&&antes.lojas_permitidas||[];
      const lojas=Array.from(new Set([...ls,...antigas]));
      if(lojas.length*vinculos.length+vinculos.length+1>450)throw new Error('Escopo excede o limite de gravação segura.');
      novo={...novo,...(identidade||{}),uid,atualizado_por:ctx.auth.uid,atualizado_em:new Date().toISOString()};
      vinculos.forEach((id,i)=>{
        let valor={...novo,uid:id};
        if(id!==uid){valor={...valor,perfil:'operador',canais_acesso:{analista:false,coletor:novo.canais_acesso.coletor},email:novo.email_coletor||(docs[i].exists&&docs[i].data().email)||'',conta_secundaria:true,cadastro_principal_uid:uid,gestao_areas:{}};delete valor.precisaTrocarSenha;}
        tx.set(refs[i],{...(docs[i].exists?docs[i].data():{}),...valor});
        lojas.forEach(l=>tx.set(db.collection('lojas').doc(l).collection('dt_operadores').doc(id),{...valor,ativo:ls.includes(l)&&novo.ativo},{mergeFields:Object.keys(valor)}));
      });
      audit(tx,ctx,antes?'EDITAR_USUARIO':'CRIAR_USUARIO',uid,antes?{permissoes:antes.permissoes||{},gestao_areas:antes.gestao_areas||{},ativo:antes.ativo!==false,email_recuperacao:antes.email_recuperacao||''}:null,{permissoes:novo.permissoes,gestao_areas:novo.gestao_areas,ativo:novo.ativo,email_recuperacao:novo.email_recuperacao||'',modelo_acesso_id:novo.modelo_acesso_id||''});
    });
  }
  const wrap=fn=>functions.region('southamerica-east1').runWith({timeoutSeconds:120}).https.onCall(async(data,ctx)=>{try{return await fn(data||{},ctx);}catch(e){if(e instanceof functions.https.HttpsError)throw e;throw new functions.https.HttpsError('failed-precondition',e.message||'Falha ao salvar.');}});
  return {
    listarGestaoAcessos:wrap(async(d,ctx)=>{
      const a=await ator(ctx);if(!P.pode(a,'visualizar'))fail('Sem acesso à gestão.');
      // Busca por loja para responsáveis; nenhuma lista global é entregue ao navegador.
      let docs;
      if(P.mestre(a))docs=(await db.collection('usuarios_acessos').get()).docs;
      else {const lojas=(P.delegacao(a).lojas||[]).filter(l=>a.acesso_todas_lojas||(a.lojas_permitidas||[]).includes(l));if(!lojas.length)fail('Sem lojas administráveis.');const snaps=await Promise.all(lojas.map(l=>db.collection('usuarios_acessos').where('lojas_permitidas','array-contains',l).get()));docs=Array.from(new Map(snaps.flatMap(s=>s.docs).map(x=>[x.id,x])).values());}
      const usuarios=docs.filter(s=>!s.data().conta_secundaria&&(P.mestre(a)||P.lojasOk(a,s.data())&&!P.protegido(s.data())&&!Object.keys(s.data().gestao_areas||{}).length&&P.pares(s.data().permissoes).some(([m])=>(P.delegacao(a).areas||[]).includes(P.area(m))))).map(s=>({id:s.id,...s.data()}));
      const modelos=(await db.collection('dt_modelos_acesso').get()).docs.map(s=>({id:s.id,...s.data()})).filter(m=>P.mestre(a)||P.pares(m.permissoes).every(([mod,ac])=>P.concedivel(a,mod,ac)));
      return {usuarios,modelos,catalogo:P.catalogo};
    }),
    salvarModeloAcesso:wrap(async(d,ctx)=>{
      const a=await ator(ctx);if(!P.mestre(a))fail('Somente administrador cadastra modelos.');
      if(!String(d.nome||'').trim()||String(d.nome).length>120)throw new Error('Nome obrigatório (até 120 caracteres).');
      const ref=d.id?db.collection('dt_modelos_acesso').doc(String(d.id)):db.collection('dt_modelos_acesso').doc();
      const permissoes=P.normalizar(d.permissoes);const areas=Array.from(new Set(P.pares(permissoes).map(([m])=>P.area(m))));
      if(areas.includes('sistema'))throw new Error('Modelo de setor não pode conceder administração global.');
      await db.runTransaction(async tx=>{const antigo=await tx.get(ref);const novo={nome:String(d.nome).trim(),descricao:String(d.descricao||'').slice(0,500),ativo:d.ativo!==false,permissoes,canais:{analista:!!(d.canais&&d.canais.analista),coletor:!!(d.canais&&d.canais.coletor)},areas,versao:(antigo.exists?antigo.data().versao||0:0)+1,atualizado_por:ctx.auth.uid,atualizado_em:new Date().toISOString()};tx.set(ref,novo);audit(tx,ctx,'SALVAR_MODELO',ref.id,antigo.exists?antigo.data():null,novo);});
      return {ok:true,id:ref.id};
    }),
    salvarUsuarioArea:wrap(async(d,ctx)=>{
      const a=await ator(ctx),novo=campos(d.acesso||{});await modeloValido(a,novo);
      if(d.uid){const s=await db.collection('usuarios_acessos').doc(String(d.uid)).get();if(!s.exists)throw new Error('Usuário não encontrado.');if(s.data().conta_secundaria)throw new Error('Edite o cadastro principal.');await gravar(ctx,a,String(d.uid),novo,null);return {ok:true,uid:d.uid};}
      P.validarAlteracao(a,null,novo,'novo',ctx.auth.uid);
      if(!novo.email_recuperacao)throw new Error('Informe o e-mail real de recuperação antes de criar o usuário.');
      const senha=String(d.senha||'');if(senha.length<6||senha.length>128)throw new Error('Senha de 6 a 128 caracteres.');
      const emails=[novo.canais_acesso.analista&&d.emailAnalista,novo.canais_acesso.coletor&&d.emailColetor].filter(Boolean).map(x=>String(x).trim().toLowerCase());
      if(emails.length!==Number(novo.canais_acesso.analista)+Number(novo.canais_acesso.coletor)||emails.some(x=>x.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))throw new Error('Logins inválidos.');
      // Nunca recuperar/vincular Auth existente sem editar o cadastro autoritativo.
      for(const email of emails){try{await admin.auth().getUserByEmail(email);throw new Error('Login já existe: '+email+'. Edite o cadastro existente.');}catch(e){if(e.code!=='auth/user-not-found')throw e;}}
      const criados=[];try{
        for(const email of new Set(emails))criados.push(await admin.auth().createUser({email,password:senha,displayName:novo.nome}));
        const principal=criados[0],analista=novo.canais_acesso.analista?criados.find(u=>u.email===String(d.emailAnalista).trim().toLowerCase()):null,coletor=novo.canais_acesso.coletor?criados.find(u=>u.email===String(d.emailColetor).trim().toLowerCase()):null;
        const identidade={email:principal.email,email_analista:analista?analista.email:'',email_coletor:coletor?coletor.email:'',login_coletor:coletor?coletor.email.split('@')[0]:'',analista_uid:analista?analista.uid:null,coletor_uid:coletor?coletor.uid:null,uids_vinculados:criados.map(x=>x.uid),criado_em:new Date().toISOString(),precisaTrocarSenha:!!analista};
        await gravar(ctx,a,principal.uid,novo,identidade);return {ok:true,uid:principal.uid};
      }catch(e){const pendentes=[];for(const u of criados)try{await admin.auth().deleteUser(u.uid);}catch(rollback){pendentes.push(u.uid);console.error('[Acessos] Rollback Auth pendente',{uid:u.uid,code:rollback.code});}if(pendentes.length)throw new Error('Falha no cadastro; há identidade Auth sem acesso que exige reconciliação: '+pendentes.join(', '));throw e;}
    })
  };
};
