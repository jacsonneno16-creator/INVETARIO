'use strict';
// O código de ação é gerado para o login Auth; somente o servidor escolhe o destinatário.
const crypto=require('node:crypto');
const P=require('./permissoes-politica');
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailValido(v){return typeof v==='string'&&v.length<=254&&EMAIL.test(v);}
function canalPermitido(a,c){if(a.canais_acesso)return a.canais_acesso[c]===true;return c==='analista'?(a.perfil==='analista'||P.protegido(a)):a.perfil==='operador';}
function configuracao(raw){
  let c;try{c=JSON.parse(raw||'{}');}catch(_){throw new Error('SMTP não configurado.');}
  if(!c.host||!c.user||!c.pass||!emailValido(c.from)||![465,587].includes(Number(c.port)))throw new Error('SMTP não configurado.');
  return c;
}
function remetente(raw){
  const c=configuracao(raw),transport=require('nodemailer').createTransport({host:c.host,port:Number(c.port),secure:Number(c.port)===465,requireTLS:true,auth:{user:c.user,pass:c.pass},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true});
  return {verify:()=>transport.verify(),send:async(to,text)=>{
    const r=await transport.sendMail({from:{name:'Da Terrinha · Acessos',address:c.from},to,subject:'Redefinição de senha · Da Terrinha',text,disableFileAccess:true,disableUrlAccess:true});
    if(!r.accepted||!r.accepted.length)throw new Error('Destinatário rejeitado.');
  }};
}
module.exports=function({db,admin,functions,senderFactory=()=>remetente(process.env.RECUPERACAO_SMTP),now=()=>Date.now()}){
  const H=functions.https.HttpsError;
  const wrap=fn=>functions.region('southamerica-east1').runWith({timeoutSeconds:60,maxInstances:10,secrets:['RECUPERACAO_SMTP']}).https.onCall(fn);
  const resposta={ok:true,mensagem:'Se o login estiver cadastrado e ativo, enviaremos o link ao e-mail de recuperação registrado. Confira também o spam.'};
  async function reservar(email,ctx){
    const instante=now(),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
    // IP observado pela plataforma; não confia em cabeçalhos enviados pelo navegador.
    const ip=String(ctx.rawRequest&&ctx.rawRequest.ip||'indisponivel');
    const col=db.collection('dt_recuperacao_limites'),rIP=col.doc('ip-'+hash(ip)),rEmail=col.doc('login-'+hash(email));
    return db.runTransaction(async tx=>{
      const [si,se]=await Promise.all([tx.get(rIP),tx.get(rEmail)]),i=si.exists?si.data():{},e=se.exists?se.data():{};
      const inicio=Number(i.inicio)||0,contagem=instante-inicio<3600000?Number(i.contagem)||0:0;
      if(contagem>=10)throw new H('resource-exhausted','Muitas tentativas. Aguarde e tente novamente.');
      tx.set(rIP,{inicio:contagem?inicio:instante,contagem:contagem+1,expira_em:new Date(instante+86400000)});
      if(instante-Number(e.ultimo||0)<120000)return false;
      tx.set(rEmail,{ultimo:instante,expira_em:new Date(instante+86400000)});return true;
    });
  }
  return {
    solicitarRecuperacaoSenha:wrap(async(d,ctx)=>{
      const email=String(d&&d.email||'').trim().toLowerCase(),canal=d&&d.canal;
      if(!emailValido(email)||!['analista','coletor'].includes(canal))throw new H('invalid-argument','Informe um e-mail de login válido.');
      if(!await reservar(email,ctx))return resposta;
      let sender;try{sender=senderFactory();}catch(_){throw new H('failed-precondition','A recuperação de senha aguarda configuração do remetente. Contate o administrador.');}
      let user;try{user=await admin.auth().getUserByEmail(email);}catch(e){if(e.code==='auth/user-not-found')return resposta;throw new H('unavailable','Não foi possível solicitar a recuperação agora.');}
      if(user.disabled)return resposta;
      const s=await db.collection('usuarios_acessos').doc(user.uid).get();if(!s.exists)return resposta;
      let acesso=s.data();if(acesso.ativo===false||!canalPermitido(acesso,canal))return resposta;
      if(acesso.conta_secundaria){
        if(!acesso.cadastro_principal_uid)return resposta;
        const p=await db.collection('usuarios_acessos').doc(acesso.cadastro_principal_uid).get();if(!p.exists)return resposta;
        const principal=p.data();if(principal.ativo===false||principal.coletor_uid!==user.uid||!canalPermitido(principal,canal))return resposta;acesso=principal;
      }
      const destino=acesso.email_recuperacao||user.email;if(!emailValido(destino))return resposta;
      try{
        const link=await admin.auth().generatePasswordResetLink(user.email);
        await sender.send(destino,'Foi solicitada uma nova senha para o login '+user.email+'.\n\nUse o link seguro do Firebase:\n'+link+'\n\nSe você não solicitou a recuperação, ignore esta mensagem. A senha só muda após a confirmação no link.');
      }catch(e){
        // Nunca registra o link de ação, credenciais SMTP ou destinatário.
        console.error('[Recuperação] Falha de entrega',{code:String(e.code||'envio').slice(0,60)});
        throw new H('unavailable','Não foi possível concluir o envio. Tente mais tarde ou contate o administrador.');
      }
      return resposta;
    }),
    verificarRemetenteRecuperacao:wrap(async(d,ctx)=>{
      if(!ctx.auth)throw new H('unauthenticated','Faça login.');
      const a=await db.collection('usuarios_acessos').doc(ctx.auth.uid).get();if(!a.exists||!P.mestre(a.data()))throw new H('permission-denied','Somente administrador verifica o remetente.');
      try{await senderFactory().verify();return {ok:true,mensagem:'Conexão e autenticação do remetente confirmadas. Valide também a entrega em uma caixa real usando Esqueci minha senha.'};}
      catch(_){throw new H('failed-precondition','Remetente não configurado ou conexão SMTP rejeitada. Confira RECUPERACAO_SMTP.');}
    })
  };
};
module.exports.emailValido=emailValido;
module.exports.configuracao=configuracao;
