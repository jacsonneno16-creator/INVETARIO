'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const cors = require('cors')({origin: true});

admin.initializeApp();

const db = admin.firestore();

const PERFIS_ADMIN = new Set(['administrador']);
const MAX_NOME = 120;
const MAX_EMAIL = 254;
const MAX_UIDS = 20;
// Nome vira displayName do Firebase Auth e é renderizado em telas internas;
// bloquear caracteres de marcação HTML na origem evita que um nome vire
// injeção de script em qualquer tela que (hoje ou no futuro) o exiba sem escapar.
const NOME_VALIDO = /^[\p{L}\p{M}\d .'-]+$/u;

function acessoAtivo(acesso) {
  return Boolean(acesso && acesso.ativo !== false);
}

function adminMestre(acesso) {
  return acessoAtivo(acesso) &&
    (acesso.admin_mestre === true || acesso.administrador_mestre === true);
}

function administrador(acesso) {
  return acessoAtivo(acesso) &&
    (adminMestre(acesso) || PERFIS_ADMIN.has(String(acesso.perfil || '').toLowerCase()));
}

function permissao(acesso, operacao) {
  return administrador(acesso) ||
    (acessoAtivo(acesso) && acesso.permissoes?.operadores?.[operacao] === true);
}

function podeEditarUsuarios(acesso) {
  return permissao(acesso, 'editar');
}

function podeCriarUsuarios(acesso) {
  return permissao(acesso, 'criar');
}

function podeExcluir(acesso) {
  return permissao(acesso, 'excluir');
}

async function acessoSolicitante(context) {
  const snap = await db.collection('usuarios_acessos').doc(context.auth.uid).get();
  return snap.exists ? snap.data() : null;
}

function emailNormalizado(valor) {
  const email = String(valor || '').trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new functions.https.HttpsError('invalid-argument', 'E-mail inválido.');
  }
  return email;
}

function lojasPermitidas(acesso) {
  return new Set((Array.isArray(acesso?.lojas_permitidas) ?
    acesso.lojas_permitidas : []).map(String));
}

function podeGerirAlvo(solicitante, alvo) {
  if (adminMestre(alvo)) return false;
  if (adminMestre(solicitante) || solicitante?.acesso_todas_lojas === true) return true;
  if (alvo?.acesso_todas_lojas === true) return false;
  const permitidas = lojasPermitidas(solicitante);
  const alvoLojas = Array.isArray(alvo?.lojas_permitidas) ? alvo.lojas_permitidas : [];
  return alvoLojas.length > 0 && alvoLojas.every(lojaId => permitidas.has(String(lojaId)));
}

function validarSenha(senha) {
  // Mínimo 6: é o piso real do Firebase Authentication (auth/invalid-password
  // abaixo disso) — não dá pra aceitar 4 dígitos como pedido, então usamos o
  // menor valor que a plataforma realmente aceita. Só números é permitido.
  if (typeof senha !== 'string' || senha.length < 6 || senha.length > 128) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A senha deve ter entre 6 e 128 caracteres.'
    );
  }
}

async function obterOuCriarUsuario(email, password, displayName) {
  try {
    const existente = await admin.auth().getUserByEmail(email);
    const acesso = await db.collection('usuarios_acessos').doc(existente.uid).get();
    const dados = acesso.exists ? acesso.data() : null;
    if (adminMestre(dados)) {
      throw new functions.https.HttpsError('failed-precondition', 'O login do administrador mestre é protegido.');
    }
    throw new functions.https.HttpsError(
      'already-exists',
      'Já existe uma conta com este e-mail. Use a edição de usuário.'
    );
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    const user = await admin.auth().createUser({email, password, displayName, disabled: false});
    return {user, existente: false};
  }
}

exports.criarUsuarioVinculado = functions
  .region('southamerica-east1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    }
    const solicitante = await acessoSolicitante(context);
    if (!podeCriarUsuarios(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode criar usuários.');
    }

    const nome = String(data?.nome || '').trim();
    const senha = String(data?.senha || '');
    const emailAnalista = emailNormalizado(data?.emailAnalista);
    const emailColetor = emailNormalizado(data?.emailColetor);
    const criarAnalista = data?.criarAnalista === true;
    if (!nome || nome.length > MAX_NOME || !NOME_VALIDO.test(nome) || !emailColetor || (criarAnalista && !emailAnalista)) {
      throw new functions.https.HttpsError('invalid-argument', 'Nome, login e senha são obrigatórios.');
    }
    validarSenha(senha);

    const coletor = await obterOuCriarUsuario(emailColetor, senha, nome);
    let analista = null;
    try {
      if (criarAnalista) analista = await obterOuCriarUsuario(emailAnalista, senha, nome);
    } catch (error) {
      if (!coletor.existente) {
        try {
          await admin.auth().deleteUser(coletor.user.uid);
        } catch (rollbackError) {
          console.error('Falha no rollback da conta de coletor', {
            uid: coletor.user.uid,
            error: rollbackError
          });
        }
      }
      throw error;
    }
    return {
      ok: true,
      uid: analista?.user.uid || coletor.user.uid,
      analista_uid: analista?.user.uid || null,
      coletor_uid: coletor.user.uid,
      conta_existente: coletor.existente || analista?.existente === true
    };
  });

exports.alterarSenhaUsuario = functions
  .region('southamerica-east1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    }
    const solicitante = await acessoSolicitante(context);
    if (!podeEditarUsuarios(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode alterar senhas.');
    }
    const senha = String(data?.senha || '');
    const uids = [...new Set((Array.isArray(data?.uids) ? data.uids : [data?.uid])
      .map(uid => String(uid || '').trim()).filter(Boolean))];
    validarSenha(senha);
    if (!uids.length || uids.length > MAX_UIDS) {
      throw new functions.https.HttpsError('invalid-argument', 'Informe uma senha com no mínimo 6 caracteres.');
    }
    if (uids.includes(context.auth.uid)) {
      throw new functions.https.HttpsError('failed-precondition', 'Use “Esqueci minha senha” para alterar a própria senha.');
    }
    for (const uid of uids) {
      const alvoSnap = await db.collection('usuarios_acessos').doc(uid).get();
      const alvo = alvoSnap.exists ? alvoSnap.data() : null;
      if (!alvo || !podeGerirAlvo(solicitante, alvo)) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'O usuário-alvo não pertence ao seu escopo de lojas.'
        );
      }
      if (adminMestre(alvo)) {
        throw new functions.https.HttpsError('failed-precondition', 'O administrador mestre é protegido.');
      }
    }
    for (const uid of uids) await admin.auth().updateUser(uid, {password: senha});
    return {ok: true, total: uids.length};
  });

exports.excluirUsuario = functions
  .region('southamerica-east1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    }

    const uid = String(data?.uid || '').trim();
    if (!uid) {
      throw new functions.https.HttpsError('invalid-argument', 'Usuário inválido.');
    }
    if (uid === context.auth.uid) {
      throw new functions.https.HttpsError('failed-precondition', 'Você não pode excluir a própria conta.');
    }

    const [solicitanteSnap, alvoSnap] = await Promise.all([
      db.collection('usuarios_acessos').doc(context.auth.uid).get(),
      db.collection('usuarios_acessos').doc(uid).get()
    ]);
    const solicitante = solicitanteSnap.exists ? solicitanteSnap.data() : null;
    const alvo = alvoSnap.exists ? alvoSnap.data() : null;

    if (!podeExcluir(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode excluir usuários.');
    }
    if (!alvo || !podeGerirAlvo(solicitante, alvo)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'O usuário-alvo não pertence ao seu escopo de lojas.'
      );
    }
    if (adminMestre(alvo)) {
      throw new functions.https.HttpsError('failed-precondition', 'O administrador mestre é protegido.');
    }

    const uids = [...new Set([
      uid,
      alvo?.analista_uid,
      alvo?.coletor_uid,
      ...(Array.isArray(alvo?.uids_vinculados) ? alvo.uids_vinculados : [])
    ].map(item => String(item || '').trim()).filter(Boolean))];
    if (uids.includes(context.auth.uid)) {
      throw new functions.https.HttpsError('failed-precondition', 'Você não pode excluir a própria conta.');
    }
    for (const alvoUid of uids) {
      try {
        await admin.auth().deleteUser(alvoUid);
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
      }
    }

    const lojasEscopo = [...lojasPermitidas(solicitante)].slice(0, 30);
    const lojasSnap = solicitante.acesso_todas_lojas === true || adminMestre(solicitante)
      ? await db.collection('lojas').get()
      : lojasEscopo.length
        ? await db.collection('lojas')
          .where(admin.firestore.FieldPath.documentId(), 'in', lojasEscopo)
          .get()
        : {docs: []};
    const refs = [
      ...uids.map(alvoUid => db.collection('usuarios_acessos').doc(alvoUid)),
      ...lojasSnap.docs.flatMap(loja => uids.map(alvoUid => loja.ref.collection('dt_operadores').doc(alvoUid)))
    ];
    for (let inicio = 0; inicio < refs.length; inicio += 450) {
      const batch = db.batch();
      refs.slice(inicio, inicio + 450).forEach(ref => batch.delete(ref));
      await batch.commit();
    }

    await db.collection('dt_logs').add({
      acao: 'USUARIO_EXCLUIDO',
      usuario_uid: uid,
      usuario_email: alvo?.email || null,
      executado_por_uid: context.auth.uid,
      executado_por_email: context.auth.token.email || null,
      criado_em: admin.firestore.FieldValue.serverTimestamp()
    }).catch(error => console.warn('Falha ao registrar log da exclusão:', {
      message: error.message,
      code: error.code,
      usuario_uid: uid,
      executado_por_uid: context.auth.uid
    }));

    return {ok: true, uid, uids};
  });

// Auditorias v231: todas as decisões que dependem da base esperada são feitas
// no servidor. O coletor recebe apenas um identificador opaco e o endereço.
const AUDITORIA_STATUS_FINAIS = new Set(['OK', 'DIVERGENTE', 'ENDERECO_VAZIO']);

function textoSeguro(valor, maximo = 500) {
  const texto = String(valor == null ? '' : valor).trim();
  if (texto.length > maximo) {
    throw new functions.https.HttpsError('invalid-argument', 'Campo maior que o permitido.');
  }
  return texto;
}

function lojaAutorizada(acesso, lojaId) {
  return acessoAtivo(acesso) && (
    administrador(acesso) || acesso?.acesso_todas_lojas === true ||
    lojasPermitidas(acesso).has(String(lojaId))
  );
}

function podeEditarAuditoria(acesso) {
  return administrador(acesso) || (
    acessoAtivo(acesso) && acesso?.permissoes?.auditoria?.editar === true
  );
}

function podeUsarColetor(acesso) {
  return acessoAtivo(acesso) && (
    administrador(acesso) || acesso?.perfil === 'operador' ||
    acesso?.canais_acesso?.coletor === true
  );
}

function refsAuditoria(lojaId, auditoriaId, origem = 'loja') {
  const auditoria = origem === 'raiz'
    ? db.collection('dt_auditorias').doc(auditoriaId)
    : db.collection('lojas').doc(lojaId).collection('dt_auditorias').doc(auditoriaId);
  return {auditoria, esperados: auditoria.collection('enderecos'),
    cegos: auditoria.collection('itens_coletor'), resultados: auditoria.collection('resultados'),
    lojaId, origem};
}

async function localizarRefsAuditoria({lojaId, auditoriaId, itemId, endereco, acesso}) {
  const candidatos = [];
  const vistos = new Set();
  const adicionar = (id, origem) => {
    const chave = origem === 'raiz' ? 'raiz' : `loja:${String(id || '')}`;
    if (vistos.has(chave) || (origem !== 'raiz' && !id)) return;
    vistos.add(chave);
    candidatos.push(refsAuditoria(String(id || lojaId || ''), auditoriaId, origem));
  };

  // Primeiro respeita exatamente a loja enviada pelo coletor e depois tenta a
  // coleção raiz, pois versões anteriores do analista criavam auditorias nos
  // dois formatos.
  adicionar(lojaId, 'loja');
  adicionar(lojaId, 'raiz');

  const publico = await db.collection('dt_auditorias_coletor').doc(auditoriaId).get().catch(() => null);
  const metaPublica = publico && publico.exists ? (publico.data() || {}) : {};
  const lojasMeta = Array.isArray(metaPublica.lojas) ? metaPublica.lojas : [];
  [metaPublica.loja, metaPublica.loja_id, metaPublica.lojaId, ...lojasMeta]
    .map(v => String(v || '').trim()).filter(Boolean).forEach(id => adicionar(id, 'loja'));

  // Último recurso: procura somente nas lojas que o usuário pode acessar. Isso
  // corrige filas antigas gravadas com alias como "matriz"/"loja_matriz" sem
  // abrir acesso a lojas não autorizadas.
  if (administrador(acesso) || acesso?.acesso_todas_lojas === true) {
    const lojasSnap = await db.collection('lojas').get();
    lojasSnap.docs.forEach(d => adicionar(d.id, 'loja'));
  } else {
    lojasPermitidas(acesso).forEach(id => adicionar(id, 'loja'));
  }

  for (const refs of candidatos) {
    if (refs.origem === 'loja' && !lojaAutorizada(acesso, refs.lojaId)) continue;
    const esperadoRef = refs.esperados.doc(itemId);
    const cegoRef = refs.cegos.doc(itemId);
    const [metaSnap, esperadoSnap, cegoSnap] = await Promise.all([
      refs.auditoria.get(), esperadoRef.get(), cegoRef.get()
    ]);
    if (metaSnap.exists || esperadoSnap.exists || cegoSnap.exists) {
      return {refs, metaPublica, metaSnap, esperadoRef, cegoRef, esperadoSnap, cegoSnap};
    }
    if (endereco) {
      const porEndereco = await refs.cegos.where('endereco', '==', endereco).limit(2).get();
      if (porEndereco.size === 1) {
        const resolvido = porEndereco.docs[0];
        return {
          refs, metaPublica, metaSnap,
          esperadoRef: refs.esperados.doc(resolvido.id),
          cegoRef: resolvido.ref,
          esperadoSnap: await refs.esperados.doc(resolvido.id).get(),
          cegoSnap: resolvido,
          itemIdResolvido: resolvido.id
        };
      }
    }
  }
  throw new functions.https.HttpsError('not-found', 'Auditoria ou item não encontrado nas lojas autorizadas.');
}

function normalizarCodigoAuditoria(valor) {
  return String(valor || '').replace(/\D/g, '').replace(/^0+/, '');
}
function normalizarEnderecoAuditoria(valor) {
  return String(valor || '').trim().toUpperCase().replace(/\s+/g, '');
}
async function candidatosAuditoriaV2(lojaId, auditoriaId, acesso) {
  const lista=[]; const vistos=new Set();
  const add=(origem,id)=>{const chave=origem==='raiz'?'raiz':`loja:${id||''}`;if(vistos.has(chave)||(!id&&origem!=='raiz'))return;vistos.add(chave);lista.push(refsAuditoria(String(id||''),auditoriaId,origem));};
  if(lojaId)add('loja',lojaId);
  add('raiz','');
  const publico=await db.collection('dt_auditorias_coletor').doc(auditoriaId).get().catch(()=>null);
  const meta=publico&&publico.exists?publico.data()||{}:{};
  [meta.loja,meta.loja_id,meta.lojaId,...(Array.isArray(meta.lojas)?meta.lojas:[])].map(v=>String(v||'').trim()).filter(Boolean).forEach(id=>add('loja',id));
  if(administrador(acesso)||acesso?.acesso_todas_lojas===true){
    const lojas=await db.collection('lojas').get(); lojas.docs.forEach(d=>add('loja',d.id));
  }else lojasPermitidas(acesso).forEach(id=>add('loja',id));
  return {lista,publico,meta};
}
async function localizarItemAuditoriaV2({lojaId,auditoriaId,itemId,endereco,acesso}) {
  const candidatos=await candidatosAuditoriaV2(lojaId,auditoriaId,acesso);
  const alvo=normalizarEnderecoAuditoria(endereco);
  for(const refs of candidatos.lista){
    if(refs.origem==='loja'&&!lojaAutorizada(acesso,refs.lojaId))continue;
    const [metaSnap,esperadoDireto,cegoDireto]=await Promise.all([refs.auditoria.get(),refs.esperados.doc(itemId).get(),refs.cegos.doc(itemId).get()]);
    if(esperadoDireto.exists||cegoDireto.exists){return {refs,metaSnap,esperadoSnap:esperadoDireto,cegoSnap:cegoDireto,itemId:itemId,publico:candidatos.publico};}
    if(alvo){
      const cegos=await refs.cegos.where('endereco','==',endereco).limit(2).get().catch(()=>({docs:[]}));
      if(cegos.docs&&cegos.docs.length===1){const c=cegos.docs[0],e=await refs.esperados.doc(c.id).get();return {refs,metaSnap,esperadoSnap:e,cegoSnap:c,itemId:c.id,publico:candidatos.publico};}
      const esperados=await refs.esperados.where('endereco','==',endereco).limit(2).get().catch(()=>({docs:[]}));
      if(esperados.docs&&esperados.docs.length===1){const e=esperados.docs[0],c=await refs.cegos.doc(e.id).get();return {refs,metaSnap,esperadoSnap:e,cegoSnap:c,itemId:e.id,publico:candidatos.publico};}
    }
    // Compatibilidade com auditorias standalone antigas que possuem somente base_chunks.
    const chunks=await refs.auditoria.collection('base_chunks').orderBy('parte').get().catch(()=>null);
    if(chunks&&!chunks.empty&&alvo){
      let achado=null;
      for(const doc of chunks.docs){
        const dados=doc.data()||{}; const itens=dados.itens||dados.dados||dados.registros||[];
        achado=itens.find(r=>normalizarEnderecoAuditoria(r.endereco||r.local||r.codigo_endereco)===alvo)||null;
        if(achado)break;
      }
      if(achado){
        const esperado={auditoriaId,endereco:endereco||achado.endereco||achado.local||'',dunEsperado:achado.dunEsperado||achado.dun||achado.gtin||achado.ean||achado.codigo_barras||'',produtoEsperado:achado.produtoEsperado||achado.produto||achado.descricao||achado.descricao_produto||'',status:'PENDENTE',loja:refs.lojaId||lojaId,origem:'BASE_CHUNKS_LEGADA'};
        return {refs,metaSnap,esperadoSnap:null,cegoSnap:null,itemId:itemId,esperadoLegado:esperado,publico:candidatos.publico};
      }
    }
    if(metaSnap.exists&&alvo){
      // Mantem o candidato para diagnostico, mas continua buscando uma base que contenha o item.
    }
  }
  throw new functions.https.HttpsError('not-found','A auditoria foi encontrada, mas o endereco/item nao existe na base publicada.');
}

exports.registrarResultadoAuditoria = functions.region('southamerica-east1')
  .runWith({timeoutSeconds: 60, memory: '512MB'})
  .https.onCall(async (data, context) => {
    if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
    const protocolo=textoSeguro(data?.protocolo,300)||`${context.auth.uid}:${Date.now()}`;
    const lojaId=textoSeguro(data?.lojaId,120);
    const auditoriaId=textoSeguro(data?.auditoriaId,180);
    const itemIdInformado=textoSeguro(data?.itemId,220);
    const endereco=textoSeguro(data?.endereco,220);
    const dunLido=textoSeguro(data?.dunLido,120);
    const produtoLido=textoSeguro(data?.produtoLido,500);
    const vazio=data?.vazio===true;
    if(!auditoriaId||!itemIdInformado||(!endereco&&!itemIdInformado))throw new functions.https.HttpsError('invalid-argument','Auditoria, item ou endereco invalido.');
    const acesso=await acessoSolicitante(context);
    if(!podeUsarColetor(acesso))throw new functions.https.HttpsError('permission-denied','Usuario sem acesso ao coletor.');

    const localizado=await localizarItemAuditoriaV2({lojaId,auditoriaId,itemId:itemIdInformado,endereco,acesso});
    const refs=localizado.refs;
    const itemId=localizado.itemId||itemIdInformado;
    const lojaResolvida=refs.lojaId||lojaId||'';
    const resultadoRef=refs.resultados.doc(itemId);
    const espRef=refs.esperados.doc(itemId);
    const cegoRef=refs.cegos.doc(itemId);
    const espInicial=localizado.esperadoSnap&&localizado.esperadoSnap.exists?localizado.esperadoSnap.data():localizado.esperadoLegado;
    const statusMeta=String((localizado.metaSnap&&localizado.metaSnap.exists?localizado.metaSnap.data()?.status:'')||(localizado.publico&&localizado.publico.exists?localizado.publico.data()?.status:'')||'LIBERADA').toUpperCase();
    if(['FINALIZADA','CANCELADA','EXCLUSAO_PENDENTE'].includes(statusMeta))throw new functions.https.HttpsError('failed-precondition','A auditoria ja foi encerrada.');

    const mirrorId=Buffer.from(`${auditoriaId}|${itemId}`).toString('base64').replace(/[\/=+]/g,'_').slice(0,700);
    const mirrorRef=db.collection('dt_auditoria_resultados').doc(mirrorId);
    const agora=admin.firestore.FieldValue.serverTimestamp();
    const retorno=await db.runTransaction(async tx=>{
      const [resultadoSnap,mirrorSnap,espSnap,cegoSnap]=await Promise.all([tx.get(resultadoRef),tx.get(mirrorRef),tx.get(espRef),tx.get(cegoRef)]);
      const existente=resultadoSnap.exists?resultadoSnap.data():(mirrorSnap.exists?mirrorSnap.data():null);
      if(existente&&existente.protocolo===protocolo)return {status:existente.status,repetido:true};
      const esperado=espSnap.exists?espSnap.data():(espInicial||{});
      if(!esperado||(!esperado.endereco&&!endereco))throw new functions.https.HttpsError('not-found','Base esperada da auditoria nao encontrada.');
      const esperadoCodigo=normalizarCodigoAuditoria(esperado.dunEsperado||esperado.gtin||esperado.ean||esperado.codigo_barras);
      const lidoCodigo=normalizarCodigoAuditoria(dunLido);
      const status=vazio?'ENDERECO_VAZIO':(lidoCodigo&&esperadoCodigo&&lidoCodigo===esperadoCodigo?'OK':'DIVERGENTE');
      const resultado={protocolo,auditoriaId,itemId,endereco:endereco||esperado.endereco||'',dunEsperado:esperado.dunEsperado||esperado.gtin||esperado.ean||'',produtoEsperado:esperado.produtoEsperado||esperado.produto||esperado.descricao||'',dunLido:vazio?null:dunLido,produtoLido:vazio?null:produtoLido,status,operador_uid:context.auth.uid,operador_id:context.auth.token.email||context.auth.uid,operador_nome:acesso?.nome||context.auth.token.name||context.auth.token.email||'Coletor',dispositivo_id:textoSeguro(data?.dispositivoId,180),loja:lojaResolvida,origem_auditoria:refs.origem,coletadoEm:textoSeguro(data?.coletadoEm,80)||null,lidoEm:agora,atualizadoEm:agora};
      tx.set(resultadoRef,resultado,{merge:true});
      tx.set(mirrorRef,resultado,{merge:true});
      tx.set(espRef,{...esperado,...resultado},{merge:true});
      tx.set(cegoRef,{auditoriaId,itemId,endereco:resultado.endereco,loja:lojaResolvida,disponivel_coletor:false,status:'CONCLUIDO',atualizadoEm:agora},{merge:true});
      tx.set(refs.auditoria,{status:'EM_ANDAMENTO',loja:lojaResolvida,atualizadoEm:agora},{merge:true});
      tx.set(db.collection('dt_auditorias_coletor').doc(auditoriaId),{status:'EM_ANDAMENTO',loja:lojaResolvida,lojas:lojaResolvida?admin.firestore.FieldValue.arrayUnion(lojaResolvida):[],atualizadoEm:agora},{merge:true});
      return {status,repetido:false};
    });
    return {ok:true,status:retorno.status,repetido:retorno.repetido,lojaId:lojaResolvida,origem:refs.origem,itemId,buildServidor:'v271'};
  });

exports.registrarOcorrenciaAuditoria = functions.region('southamerica-east1')
  .runWith({timeoutSeconds: 60, memory: '512MB'})
  .https.onCall(async (data, context) => {
    if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
    const lojaId=textoSeguro(data?.lojaId,120);
    const auditoriaId=textoSeguro(data?.auditoriaId,180);
    const ocorrenciaId=textoSeguro(data?.ocorrenciaId||data?.itemId,220);
    const protocolo=textoSeguro(data?.protocolo,300)||`${auditoriaId}:${ocorrenciaId}`;
    if(!auditoriaId||!ocorrenciaId)throw new functions.https.HttpsError('invalid-argument','Auditoria ou ocorrencia invalida.');
    const acesso=await acessoSolicitante(context);
    if(!podeUsarColetor(acesso))throw new functions.https.HttpsError('permission-denied','Usuario sem acesso ao coletor.');
    const candidatos=await candidatosAuditoriaV2(lojaId,auditoriaId,acesso);
    let refs=null;
    for(const candidato of candidatos.lista){
      if(candidato.origem==='loja'&&!lojaAutorizada(acesso,candidato.lojaId))continue;
      const snap=await candidato.auditoria.get();
      if(snap.exists){refs=candidato;break;}
    }
    if(!refs){
      // Auditorias antigas podem possuir apenas metadado publico; usa a origem raiz.
      refs=refsAuditoria('',auditoriaId,'raiz');
    }
    const agora=admin.firestore.FieldValue.serverTimestamp();
    const registro={protocolo,auditoriaId,tipo:'PRODUTO_FORA_AUDITORIA',status:'PRODUTO_FORA_AUDITORIA',endereco:textoSeguro(data?.endereco,220),dunLido:textoSeguro(data?.dunLido,120),produtoLido:textoSeguro(data?.produtoLido,500),operador_uid:context.auth.uid,operador_id:context.auth.token.email||context.auth.uid,operador_nome:acesso?.nome||context.auth.token.name||context.auth.token.email||'Coletor',dispositivo_id:textoSeguro(data?.dispositivoId,180),loja:refs.lojaId||lojaId||'',origem_auditoria:refs.origem,criadoEm:agora,atualizadoEm:agora};
    const mirrorId=Buffer.from(`${auditoriaId}|ocorrencia|${ocorrenciaId}`).toString('base64').replace(/[\/=+]/g,'_').slice(0,700);
    await Promise.all([
      refs.auditoria.collection('ocorrencias').doc(ocorrenciaId).set(registro,{merge:true}),
      db.collection('dt_auditoria_resultados').doc(mirrorId).set({...registro,itemId:ocorrenciaId},{merge:true}),
      refs.auditoria.set({status:'EM_ANDAMENTO',atualizadoEm:agora},{merge:true}),
      db.collection('dt_auditorias_coletor').doc(auditoriaId).set({status:'EM_ANDAMENTO',atualizadoEm:agora},{merge:true})
    ]);
    return {ok:true,status:'PRODUTO_FORA_AUDITORIA',lojaId:refs.lojaId||lojaId||'',origem:refs.origem,itemId:ocorrenciaId};
  });

exports.finalizarAuditoria = functions.region('southamerica-east1')
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const lojaId = textoSeguro(data?.lojaId, 120);
    const auditoriaId = textoSeguro(data?.auditoriaId, 180);
    const acesso = await acessoSolicitante(context);
    if (!lojaAutorizada(acesso, lojaId) || !podeEditarAuditoria(acesso)) {
      throw new functions.https.HttpsError('permission-denied', 'Sem permissão para finalizar.');
    }
    const refs = refsAuditoria(lojaId, auditoriaId);
    const [cegosSnap, resultadosSnap] = await Promise.all([refs.cegos.get(), refs.resultados.get()]);
    const pendentes = cegosSnap.docs.filter(d => d.data().disponivel_coletor === true).length;
    if (!cegosSnap.size || pendentes) {
      throw new functions.https.HttpsError('failed-precondition', `Existem ${pendentes || 'itens'} pendentes.`);
    }
    const totais = {OK: 0, DIVERGENTE: 0, ENDERECO_VAZIO: 0};
    resultadosSnap.docs.forEach(d => { if (totais[d.data().status] != null) totais[d.data().status]++; });
    if (resultadosSnap.size !== cegosSnap.size) {
      throw new functions.https.HttpsError('failed-precondition', 'Existem sincronizações pendentes.');
    }
    await db.runTransaction(async tx => {
      const meta = await tx.get(refs.auditoria);
      if (!meta.exists || !['LIBERADA', 'EM_ANDAMENTO'].includes(String(meta.data().status || '').toUpperCase())) {
        throw new functions.https.HttpsError('failed-precondition', 'Estado inválido para finalização.');
      }
      tx.update(refs.auditoria, {
        status: 'FINALIZADA', liberada_coletor: false, totalItens: cegosSnap.size,
        totalPendentes: 0, totalOk: totais.OK, totalDivergentes: totais.DIVERGENTE,
        totalVazios: totais.ENDERECO_VAZIO, finalizadaPorUid: context.auth.uid,
        finalizadaEm: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return {ok: true, total: cegosSnap.size, totais};
  });

async function apagarConsultaEmLotes(query) {
  let apagados = 0;
  while (true) {
    const snap = await query.limit(400).get();
    if (snap.empty) return apagados;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    apagados += snap.size;
  }
}

exports.excluirAuditoriaCompleta = functions.region('southamerica-east1')
  .runWith({timeoutSeconds: 540, memory: '512MB'}).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const lojaId = textoSeguro(data?.lojaId, 120);
    const auditoriaId = textoSeguro(data?.auditoriaId, 180);
    const acesso = await acessoSolicitante(context);
    if (!lojaAutorizada(acesso, lojaId) || !podeEditarAuditoria(acesso)) {
      throw new functions.https.HttpsError('permission-denied', 'Sem permissão para excluir.');
    }
    const refs = refsAuditoria(lojaId, auditoriaId);
    await refs.auditoria.set({status: 'EXCLUSAO_PENDENTE', exclusaoPorUid: context.auth.uid,
      exclusaoIniciadaEm: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    const subcolecoes = ['resultados', 'ocorrencias', 'itens_coletor', 'enderecos', 'base_chunks', 'importacoes'];
    let apagados = 0;
    try {
      for (const nome of subcolecoes) apagados += await apagarConsultaEmLotes(refs.auditoria.collection(nome));
      await refs.auditoria.delete();
    } catch (error) {
      await refs.auditoria.set({status: 'ERRO_EXCLUSAO', exclusaoErro: String(error.message || error).slice(0, 500)}, {merge: true});
      throw new functions.https.HttpsError('internal', 'A exclusão não foi concluída; a auditoria foi preservada para nova tentativa.');
    }
    return {ok: true, apagados};
  });

// ─────────────────────────────────────────────────────────────────────────
// Proxy Bluesoft ERP: o servidor da Bluesoft não envia headers de CORS, então
// o navegador não pode chamá-lo diretamente. Esta function relaia a chamada
// servidor-para-servidor (sem CORS) e devolve a resposta ao frontend. O token
// do Bluesoft continua vindo do próprio frontend (mesmo padrão já usado para
// os outros adaptadores de API) — nunca fica hardcoded aqui nem em nenhum
// arquivo de código-fonte.
const BLUESOFT_HOST_PERMITIDO = /^https:\/\/erp\.bluesoft\.com\.br(?:\/[\w-]+)?$/;
const METODOS_PERMITIDOS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

async function usuarioAutenticadoPorHeader(req) {
  const cabecalho = String(req.get('Authorization') || '');
  const partes = cabecalho.match(/^Bearer (.+)$/i);
  if (!partes) return null;
  try { return await admin.auth().verifyIdToken(partes[1]); }
  catch (_) { return null; }
}

exports.bluesoftProxy = functions
  .region('southamerica-east1')
  // BUG AO VIVO REAL (2026-08-19): /api/forca-de-vendas/comissoes-vendedores
  // é mais lento que os outros endpoints da Bluesoft pra essa conta. Um
  // timeout de 60s foi adicionado no lado do navegador (90-bluesoft-
  // service.js) achando que resolveria — mas essa função é MATADA pelo
  // Google aos 30s independente disso, derrubando a conexão de um jeito que
  // o navegador só reporta como "Failed to fetch" (nem chega a virar um
  // erro de timeout limpo). O limite real que precisava mudar era este.
  .runWith({timeoutSeconds: 120, memory: '256MB'})
  .https.onRequest((req, res) => {
    cors(req, res, async () => {
      if (req.method !== 'POST') {
        return res.status(405).json({erro: 'Use POST.'});
      }
      const usuario = await usuarioAutenticadoPorHeader(req);
      if (!usuario) {
        return res.status(401).json({erro: 'Faça login novamente.'});
      }

      const {method, path, baseUrl, token, body} = req.body || {};
      const metodo = String(method || 'GET').toUpperCase();
      const caminho = String(path || '');
      const base = String(baseUrl || '').replace(/\/+$/, '');

      if (!METODOS_PERMITIDOS.has(metodo)) {
        return res.status(400).json({erro: 'Método HTTP inválido.'});
      }
      if (!caminho.startsWith('/') || !BLUESOFT_HOST_PERMITIDO.test(base) || !token) {
        return res.status(400).json({
          erro: "Envie 'baseUrl' (host da Bluesoft), 'path' (iniciando com /) e 'token' válidos."
        });
      }

      try {
        const resposta = await fetch(base + caminho, {
          method: metodo,
          headers: {'x-CustomToken': String(token), 'Content-Type': 'application/json'},
          body: metodo !== 'GET' && metodo !== 'HEAD' && body != null ? JSON.stringify(body) : undefined
        });
        const texto = await resposta.text();
        let dados;
        try { dados = texto ? JSON.parse(texto) : null; }
        catch (_) { dados = texto; }
        return res.status(resposta.status).json(dados);
      } catch (erro) {
        console.error('Erro no proxy Bluesoft:', erro);
        return res.status(502).json({erro: 'Falha ao conectar com a Bluesoft.', detalhe: String(erro.message || erro)});
      }
    });
  });

// ─────────────────────────────────────────────────────────────────────────
// Notas Retornadas — sincronização automática (Cloud Scheduler)
// Pedido ao vivo do usuário: "essas atualizações via api tem como colocar
// horarios programados para atualizar automaticamente" — escolheu
// explicitamente "buscar E salvar sozinho" pra Notas Retornadas, 2-3x ao
// dia. Roda servidor-a-servidor (sem passar pelo bluesoftProxy — aqui já
// SOMOS o servidor, com o token vindo direto de dt_config, sem precisar de
// usuário logado nem token de ID do Firebase).
//
// O que é gravado (lojas/{lojaId}/recebimento_recusas_notas/{chave}) é só
// uma tabela de REFERÊNCIA — o mesmo destino do botão manual "Salvar
// importação" em 97-recebimento-recusas.js. NÃO é o registro final de
// recebimento: isso continua exigindo um operador no Coletor escanear a
// nota e passar pelo fluxo de motorista/motivo/box/volume contado
// fisicamente (24-recebimento-recusas.js) — o volume aqui é só ponto de
// partida (lido do XML quando disponível), nunca a contagem oficial. Por
// isso `volumes` pode ficar `null` aqui (a validação de "volumes
// obrigatório" do botão manual não se aplica a esta gravação de
// referência).
//
// Duplica de propósito a lógica de descoberta/normalização já existente em
// 90-bluesoft-service.js — não dá pra reusar aquele arquivo direto: ele
// espera window.fetch/getDTFirestore()/token de auth do navegador, nada
// disso existe aqui. Se a lógica de devolução mudar de um lado, replicar
// a mudança no outro.
const CFOPS_DEVOLUCAO_VENDA_SRV = ['1201', '1202', '1203', '1204', '1410', '1411', '2201', '2202', '2203', '2204', '2410', '2411'];
const RE_NATUREZA_NAO_RECEBIMENTO_SRV = /\bDEV(OL|\.)|\bRETORNO\b/;
function _normTxtSrv(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }
function _ehDevolucaoSrv(nota) {
  if (['DEVOLUCAO_ENTRE_LOJAS', 'DEVOLUCAO_CLIENTE'].includes(nota && nota.tipoTransferencia)) return true;
  return RE_NATUREZA_NAO_RECEBIMENTO_SRV.test(_normTxtSrv(nota && nota.natureza));
}
// PEDIDO AO VIVO (usuário, com print real das telas do Bluesoft: "hoje ela
// traz notas canceladas e recusadas, também não é para vim essas notas") —
// duplica o mesmo filtro aplicado em 90-bluesoft-service.js (ver comentário
// completo lá): "Status da NF-e" (Rejeitada/Inutilizada) e "Status"
// (Cancelada) confirmados ao vivo contra as telas reais do Bluesoft.
const RE_STATUS_NAO_VALIDO_SRV = /CANCELAD|REJEITAD|INUTILIZAD|DENEGAD/;
function _notaComStatusValidoSrv(x) {
  return !RE_STATUS_NAO_VALIDO_SRV.test(_normTxtSrv(x && x.status));
}
function _pareceDevolucaoSrv(n) {
  if (CFOPS_DEVOLUCAO_VENDA_SRV.includes(String(n.cfop || '').replace(/\D/g, ''))) return true;
  return RE_NATUREZA_NAO_RECEBIMENTO_SRV.test(_normTxtSrv(n.naturezaOperacao || n.natureza || ''));
}
function _normalizarNotaRetornoSrv(n) {
  const origem = (n.itens || []).map(it => it.notaFiscalOrigem).find(Boolean) || null;
  const pareceDevolucao = _pareceDevolucaoSrv(n);
  return {
    chave: n.nfChave || '', numeroNota: n.nfNumero != null ? String(n.nfNumero) : '', serie: n.nfSerie != null ? String(n.nfSerie) : '',
    cfop: n.cfop || '', tipoOperacao: n.tipoNota || '', naturezaLabel: pareceDevolucao ? 'Devolução' : 'Venda',
    dataEmissao: n.dataEmissao || null, valorTotal: Number(n.valorTotalNota) || 0,
    destinatarioNome: n.nomeRazaoFornecedor || '', destinatarioCnpj: n.cpfCnpjFornecedor || '',
    itens: (n.itens || []).map(it => ({produtoKey: it.produtoKey != null ? it.produtoKey : null, descricao: it.descricao || '', quantidade: Number(it.quantidade) || 0, gtin: it.gtin || '', ncm: it.ncm || ''})),
    notaOriginalChave: origem && origem.chave || null, notaOriginalNumero: origem && origem.numero != null ? String(origem.numero) : null,
    pareceDevolucao,
  };
}
function _extrairVolumesSrv(xmlTexto) {
  const blocos = String(xmlTexto || '').match(/<vol>[\s\S]*?<\/vol>/gi) || [];
  let total = 0, achou = false;
  blocos.forEach(bloco => { const m = bloco.match(/<qVol>(\d+)<\/qVol>/i); if (m) { total += Number(m[1]) || 0; achou = true; } });
  return achou ? total : null;
}
function _fmtDataBRSrv(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }

async function _bluesoftGetSrv(baseUrl, path, token, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    const resp = await fetch(baseUrl.replace(/\/+$/, '') + path, {
      method: 'GET', headers: {'x-CustomToken': String(token), 'Content-Type': 'application/json'}, signal: controller.signal,
    });
    const texto = await resp.text();
    let dados; try { dados = texto ? JSON.parse(texto) : null; } catch (_) { dados = texto; }
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' em ' + path + (dados && dados.erro ? ': ' + dados.erro : ''));
    return dados;
  } finally { clearTimeout(timer); }
}
// Pedido ao vivo do usuário (2026-08-20): "vou deixar no automático" — a
// sincronização agendada tem 540s pra TODAS as lojas, uma de cada vez. Essa
// função paginava UMA página por vez, em série — o mesmo ponto lento que
// deixou a busca manual "mais de 5m sem trazer nada" do lado do cliente.
// Paginação concorrente (mesmo padrão de 90-bluesoft-service.js), com
// dedup por chave de identidade pra nunca duplicar item por causa da
// concorrência.
const CONCORRENCIA_PAGINAS_SRV = 3;
async function _paginarTudoSrv(baseUrl, path, params, token, chaveIdentidade) {
  const itens = [];
  const vistos = new Set();
  let pagina = 0, acabou = false, paginasSemNovidade = 0;
  while (!acabou) {
    const indices = Array.from({length: CONCORRENCIA_PAGINAS_SRV}, (_, i) => pagina + i);
    const respostas = await Promise.all(indices.map(p => {
      const qs = new URLSearchParams(Object.assign({}, params, {currentPage: p, pageSize: 200})).toString();
      return _bluesoftGetSrv(baseUrl, path + '?' + qs, token);
    }));
    for (const dados of respostas) {
      const linhas = Array.isArray(dados) ? dados : ((dados && (dados.data || dados.items || dados.results)) || []);
      if (!linhas.length) { acabou = true; break; }
      let novos = 0;
      linhas.forEach(item => {
        const chave = chaveIdentidade ? String(chaveIdentidade(item)) : JSON.stringify(item);
        if (!vistos.has(chave)) { vistos.add(chave); itens.push(item); novos++; }
      });
      if (novos === 0) { paginasSemNovidade++; if (paginasSemNovidade >= 5) { acabou = true; break; } }
      else paginasSemNovidade = 0;
      if (linhas.length < 200) { acabou = true; break; }
    }
    pagina += CONCORRENCIA_PAGINAS_SRV;
    if (pagina > 300) throw new Error('Limite de páginas excedido em ' + path);
  }
  return itens;
}
// Mesmo helper de lotes paralelos de 90-bluesoft-service.js — lookups
// targetados (1 chamada por cliente/vendedor único) rodavam um de cada vez.
// Reduzido de 8 pra 4 no mesmo dia (ver comentário em 90-bluesoft-
// service.js): lote grande demais provavelmente esbarrava no limite de
// requisições simultâneas da Bluesoft.
const TAMANHO_LOTE_LOOKUP_SRV = 4;
async function _emLotesParalelosSrv(itens, fn, tamanhoLote) {
  tamanhoLote = tamanhoLote || TAMANHO_LOTE_LOOKUP_SRV;
  for (let i = 0; i < itens.length; i += tamanhoLote) {
    await Promise.all(itens.slice(i, i + tamanhoLote).map(fn));
  }
}

// Fonte de descoberta de devolução "em aberto": recebimento_notas, já
// sincronizado pelo Dashboard (sincronizarRecebimentoBluesoft, endpoint
// PROVADO em produção) — ver histórico completo do bug em 90-bluesoft-
// service.js. Enriquecida com um lookup targetado por chave (com lojaKey,
// obrigatório mesmo com nfChave informado — outro bug ao vivo real já
// corrigido do lado do cliente).
// BUG AO VIVO REAL (usuário: "não esquece que tem que puxar as notas de
// devolução que não foram dado entrada no nosso sistema ainda") — mesmo
// bug do lado do cliente (ver comentário completo em 90-bluesoft-
// service.js): filtrar por `dataRecebimento` excluía exatamente as notas
// ainda não recebidas (esse campo só é preenchido depois). Corrigido pra
// filtrar por `processamento`, que sempre vem preenchido.
async function _descobrirNotasDevolucaoSrv(lojaId, baseUrl, lojaKey, token) {
  const snap = await db.collection('lojas').doc(lojaId).collection('recebimento_notas').get();
  const agora = new Date();
  const inicio = new Date(); inicio.setDate(inicio.getDate() - 30);
  const candidatas = snap.docs.map(d => d.data() || {}).filter(x => _ehDevolucaoSrv(x)).filter(_notaComStatusValidoSrv).filter(x => {
    const dp = x.processamento ? new Date(x.processamento) : null;
    return dp && !isNaN(dp) && dp >= inicio && dp <= agora;
  });
  return Promise.all(candidatas.map(async x => {
    try {
      const qs = new URLSearchParams({nfChave: x.chaveNota, lojaKey, currentPage: 0, pageSize: 10}).toString();
      const dados = await _bluesoftGetSrv(baseUrl, '/api/estoques/notas-fiscais?' + qs, token);
      const linha = Array.isArray(dados) ? dados[0] : ((dados && dados.data) || [])[0];
      if (linha) return _normalizarNotaRetornoSrv(linha);
    } catch (e) { /* cai pro fallback abaixo */ }
    return {
      chave: x.chaveNota || '', numeroNota: x.numeroNota != null ? String(x.numeroNota) : '', serie: x.serieNota != null ? String(x.serieNota) : '',
      cfop: '', tipoOperacao: '', naturezaLabel: 'Devolução', dataEmissao: null, valorTotal: Number(x.valor) || 0,
      destinatarioNome: '', destinatarioCnpj: String(x.cnpjRemetente || '').replace(/\D/g, ''), itens: [],
      notaOriginalChave: null, notaOriginalNumero: null, pareceDevolucao: true, statusRecebimento: x.statusRecebimento || '',
    };
  }));
}

// Venda faturada ainda não entregue — GET /api/forca-de-vendas/pedidos.
// HISTÓRICO (ver comentário completo em 90-bluesoft-service.js): a
// primeira versão usava /api/venda/pedidovenda, testado ao vivo com o
// token real e CONFIRMADO sem nenhuma atividade de 2026. O usuário mandou
// print de dentro do próprio Bluesoft mostrando 6.732 pedidos reais de
// junho/2026 numa tela DIFERENTE — "Pedido Força de Venda", objeto
// diferente no schema. Endpoint certo, confirmado ao vivo: filtra por
// filialKey+dataEmissaoInicial/Final+pedidoVendaStatus (valor único, não
// array). Cada pedido tem clientes[], e cada cliente já traz nfChave/
// nfNumero/nfSerie DIRETO — nenhum lookup extra por nota é necessário.
const STATUS_FATURADO_NAO_ENTREGUE_SRV = ['FATURADO_POR_NOTA_FISCAL', 'FATURADO_POR_CUPOM', 'ROTEIRIZADO'];
async function _obterPedidosVendaFaturadosSrv(baseUrl, filialKey, token) {
  const fim = new Date(); const inicio = new Date(); inicio.setMonth(inicio.getMonth() - 6);
  const porKey = new Map();
  const itensPorStatus = await Promise.all(STATUS_FATURADO_NAO_ENTREGUE_SRV.map(status => _paginarTudoSrv(baseUrl, '/api/forca-de-vendas/pedidos', {
    filialKey, pedidoVendaStatus: status,
    dataEmissaoInicial: _fmtDataBRSrv(inicio) + ' 00:00', dataEmissaoFinal: _fmtDataBRSrv(fim) + ' 23:59',
  }, token, item => item.pedidoForcaVendaKey)));
  itensPorStatus.forEach(itens => itens.forEach(it => porKey.set(it.pedidoForcaVendaKey, it)));
  const notas = [];
  porKey.forEach(p => {
    (p.clientes || []).filter(c => c.nfChave || c.nfNumero).forEach(c => {
      notas.push({
        chave: c.nfChave || '', numeroNota: c.nfNumero != null ? String(c.nfNumero) : '', serie: c.nfSerie != null ? String(c.nfSerie) : '',
        cfop: '', tipoOperacao: 'SAIDA', naturezaLabel: 'Venda',
        dataEmissao: c.nfDataEmissao || p.dataEmissao || null, valorTotal: Number(c.valorNf != null ? c.valorNf : c.valorTotal) || 0,
        destinatarioNome: '', destinatarioCnpj: '',
        itens: (p.itens || []).filter(it => it.clienteKey === c.clienteKey).map(it => ({produtoKey: it.produtoKey != null ? it.produtoKey : null, descricao: '', quantidade: Number(it.quantidadePedida) || 0, gtin: '', ncm: ''})),
        notaOriginalChave: null, notaOriginalNumero: null, pareceDevolucao: false,
        vendedorKey: p.vendedorExternoKey != null ? p.vendedorExternoKey : null, clienteKey: c.clienteKey != null ? c.clienteKey : null,
      });
    });
  });
  const clienteKeysUnicos = [...new Set(notas.map(n => n.clienteKey).filter(k => k != null))];
  const clientePorKey = new Map();
  await _emLotesParalelosSrv(clienteKeysUnicos, async ck => {
    try {
      const dados = await _bluesoftGetSrv(baseUrl, '/api/clientes?' + new URLSearchParams({clienteKey: ck, currentPage: 0, pageSize: 1}).toString(), token);
      const linha = Array.isArray(dados) ? dados[0] : ((dados && dados.data) || [])[0];
      if (linha) clientePorKey.set(ck, linha);
    } catch (e) { /* um cliente faltando não trava os outros */ }
  });
  // BUG AO VIVO REAL (2026-08-21, mesmo bug do lado do cliente): forca-de-
  // vendas/pedidos nunca traz descrição do item, só produtoKey. Lookup
  // targetado, um por produtoKey único.
  const produtoKeysUnicos = [...new Set(notas.flatMap(n => n.itens.map(it => it.produtoKey)).filter(k => k != null))];
  const produtoPorKey = new Map();
  await _emLotesParalelosSrv(produtoKeysUnicos, async pk => {
    try {
      const dados = await _bluesoftGetSrv(baseUrl, '/api/comercial/produtos?' + new URLSearchParams({produtoKey: pk, currentPage: 0, pageSize: 1}).toString(), token);
      const linha = Array.isArray(dados) ? dados[0] : ((dados && dados.data) || [])[0];
      if (linha) produtoPorKey.set(pk, linha);
    } catch (e) { /* um produto faltando não trava os outros */ }
  });
  return notas.map(n => {
    const cli = clientePorKey.get(n.clienteKey);
    return {
      ...n, destinatarioNome: (cli && (cli.nomeRazao || cli.nomeFantasia || cli.nomeAbreviado)) || '', destinatarioCnpj: String((cli && cli.cpfCnpj) || '').replace(/\D/g, ''),
      itens: n.itens.map(it => ({...it, descricao: (produtoPorKey.get(it.produtoKey) && produtoPorKey.get(it.produtoKey).descricao) || ''})),
    };
  });
}
async function _buscarVendedorSrv(baseUrl, vendedorKey, token) {
  if (vendedorKey == null) return null;
  const dados = await _bluesoftGetSrv(baseUrl, '/api/forca-de-vendas/vendedores?vendedorKey=' + encodeURIComponent(vendedorKey), token);
  const linha = Array.isArray(dados) ? dados[0] : ((dados && dados.data) || [])[0];
  if (!linha) return null;
  // Gerente removido (pedido ao vivo do usuário: "o gerente pode tirar,
  // que sempre será 1 pq de gerente só tem ele").
  return {
    nome: linha.vendedorNomeAbreviado || '', email: linha.vendedorEmail || '',
    supervisorNome: linha.supervisorNomeAbreviado || '', supervisorEmail: linha.supervisorEmail || '',
  };
}

async function _sincronizarNotasRetornadasDaLoja(lojaId, loja) {
  const cfgSnap = await db.collection('lojas').doc(lojaId).collection('dt_config').doc('integracao_api').get();
  const cfg = cfgSnap.exists ? (cfgSnap.data() || {}) : {};
  const baseUrl = cfg.ambiente === 'producao' ? cfg.url_prd : cfg.url_hml;
  if (!baseUrl || !cfg.token) return {loja: loja.nome || lojaId, pulou: 'sem configuração de API'};
  const lojaKey = loja.bluesoft_loja_key;
  const fim = new Date(); const inicio = new Date(); inicio.setDate(inicio.getDate() - 30);
  const paramsEntrada = {lojaKey, tipoNota: 'ENTRADA', dataRecebimentoInicial: _fmtDataBRSrv(inicio), dataRecebimentoFinal: _fmtDataBRSrv(fim)};

  // Cada fonte é melhor esforço (mesmo padrão do lado do cliente, ver
  // 90-bluesoft-service.js) — uma fonte falhando (timeout, 429, etc.) nunca
  // derruba as outras duas nem zera a loja inteira nesse ciclo.
  const [brutasEntrada, extras, pedidosFaturados] = await Promise.all([
    _paginarTudoSrv(baseUrl, '/api/estoques/notas-fiscais', paramsEntrada, cfg.token, item => item.nfChave)
      .catch(e => { console.error('[NotasRetornadas automático] Falha na fonte principal (notas de entrada)', lojaId, e.message || e); return []; }),
    _descobrirNotasDevolucaoSrv(lojaId, baseUrl, lojaKey, cfg.token)
      .catch(e => { console.error('[NotasRetornadas automático] Falha na 2ª fonte (devolução)', lojaId, e.message || e); return []; }),
    _obterPedidosVendaFaturadosSrv(baseUrl, lojaKey, cfg.token).catch(e => { console.error('[NotasRetornadas automático] Falha na 3ª fonte (venda faturada)', lojaId, e.message || e); return []; }),
  ]);
  // BUG AO VIVO REAL (2026-08-20, mesmo bug do lado do cliente — ver
  // comentário completo em 90-bluesoft-service.js): essa fonte (tipoNota=
  // ENTRADA) só traz notas onde a loja RECEBE a mercadoria — nunca uma
  // venda de verdade. Compra normal de fornecedor (sem relação com
  // devolução) caía no "senão" e virava "Venda" por engano. Filtra só o
  // que realmente parece devolução; venda de verdade vem só da 3ª fonte
  // (_obterPedidosVendaFaturadosSrv).
  const notasEntrada = brutasEntrada.map(_normalizarNotaRetornoSrv).filter(n => n.pareceDevolucao);
  const chavesConhecidas = new Set(notasEntrada.filter(n => n.chave).map(n => n.chave));
  const numerosConhecidos = new Set(notasEntrada.filter(n => n.numeroNota).map(n => n.numeroNota));
  const extrasNovas = extras.filter(n => !(n.chave && chavesConhecidas.has(n.chave)) && !(n.numeroNota && numerosConhecidos.has(n.numeroNota)));
  extrasNovas.forEach(n => { if (n.chave) chavesConhecidas.add(n.chave); if (n.numeroNota) numerosConhecidos.add(n.numeroNota); });

  // _obterPedidosVendaFaturadosSrv já devolve cada nota com chave/número/
  // destinatário resolvidos (a NF já vem direto no cliente do pedido) — só
  // falta dedup e vendedor.
  const pedidosNovos = pedidosFaturados.filter(n => (n.chave || n.numeroNota) && !(n.chave && chavesConhecidas.has(n.chave)) && !(n.numeroNota && numerosConhecidos.has(n.numeroNota)));
  const vendedorKeysUnicos = [...new Set(pedidosNovos.map(n => n.vendedorKey).filter(k => k != null))];
  const vendedorPorKey = new Map();
  await _emLotesParalelosSrv(vendedorKeysUnicos, async vk => {
    try { const v = await _buscarVendedorSrv(baseUrl, vk, cfg.token); if (v) vendedorPorKey.set(vk, v); }
    catch (e) { /* um vendedor faltando não trava os outros */ }
  });
  const extrasVenda = pedidosNovos.map(n => {
    const vd = vendedorPorKey.get(n.vendedorKey);
    return {...n, vendedorNome: (vd && vd.nome) || '', vendedorEmail: (vd && vd.email) || '', supervisorNome: (vd && vd.supervisorNome) || '', supervisorEmail: (vd && vd.supervisorEmail) || ''};
  });

  const todasNotas = notasEntrada.concat(extrasNovas, extrasVenda);

  // Pedido ao vivo do usuário: "se eu fizer outra busca... ela já tem as
  // notas salvas, e já com o XML gravado... não precisaria buscar de
  // novo" — carrega ANTES do loop quais notas de Venda já estão salvas com
  // volume > 0 (genuinamente resolvido, não só o 0 padrão de quem nunca
  // chegou a carregar). Reaproveitado também pela limpeza de venda já
  // entregue logo abaixo (uma leitura só pras duas coisas).
  let salvasVendaSnap = null;
  const volumeJaSalvoPorChave = new Map();
  try {
    salvasVendaSnap = await db.collection('lojas').doc(lojaId).collection('recebimento_recusas_notas')
      .where('naturezaLabel', '==', 'Venda').get();
    salvasVendaSnap.docs.forEach(d => {
      const x = d.data() || {};
      if (Number(x.volumes) > 0) volumeJaSalvoPorChave.set(d.id, Number(x.volumes));
    });
  } catch (e) { console.error('[NotasRetornadas automático] Falha ao carregar vendas já salvas (segue sem cache)', lojaId, e.message || e); }

  const agora = new Date().toISOString();
  let salvas = 0, comMotivoOuVolume = 0, erros = 0, reaproveitadas = 0;
  for (let i = 0; i < todasNotas.length; i += 20) {
    const lote = todasNotas.slice(i, i + 20);
    await Promise.all(lote.map(async n => {
      if (!n.chave) return;
      let motivo = '', volumes = null;
      // Pedido ao vivo do usuário (2026-08-20): "não quero mais o motivo e
      // nem o volume das notas de devolução" — devolução NUNCA mais lê o
      // XML; só venda lê, e só pra pegar o volume (venda nunca teve motivo).
      const volumeCache = !n.pareceDevolucao ? volumeJaSalvoPorChave.get(n.chave) : undefined;
      if (volumeCache != null) {
        volumes = volumeCache;
        reaproveitadas++;
      } else if (!n.pareceDevolucao) {
        try {
          const linkDados = await _bluesoftGetSrv(baseUrl, '/api/estoques/notas-fiscais/xml/' + n.chave.replace(/\D/g, ''), cfg.token);
          const url = (linkDados && (linkDados.URL_S3 || linkDados.url_s3)) || '';
          if (url) {
            const resp = await fetch(url);
            if (resp.ok) {
              const xmlTexto = await resp.text();
              volumes = _extrairVolumesSrv(xmlTexto);
              if (volumes != null) comMotivoOuVolume++;
            }
          }
        } catch (e) { /* volume segue vazio — nota ainda é salva */ }
      }
      try {
        await db.collection('lojas').doc(lojaId).collection('recebimento_recusas_notas').doc(n.chave).set({
          chave: n.chave, numeroNota: n.numeroNota, volumes, destinatario: n.destinatarioNome || '', dataEmissao: n.dataEmissao || '',
          valorTotal: Number(n.valorTotal) || 0,
          transportadora: '', arquivoOrigem: '', serie: n.serie || '', cfop: n.cfop || '', naturezaLabel: n.naturezaLabel || '',
          tipoOperacao: n.tipoOperacao || '', destinatarioCnpj: n.destinatarioCnpj || '',
          notaOriginalChave: n.notaOriginalChave || null, notaOriginalNumero: n.notaOriginalNumero || null,
          informacoesComplementares: motivo, itens: n.itens || [], pareceDevolucao: !!n.pareceDevolucao,
          // BUG AO VIVO REAL (2026-08-20): "muitos mercados não trouxe [o
          // vendedor]" — a sincronização automática já calculava vendedor/
          // supervisor (venda faturada, via vendedorKey do pedido) mas
          // nunca salvava isso aqui. Só a busca MANUAL ("Buscar" no
          // Analista) gravava esses campos — qualquer nota que só passou
          // pelo automático (06h/14h/17h) ficava sem vendedor pra sempre,
          // mesmo já tendo o dado calculado em memória.
          vendedorNome: n.vendedorNome || '', vendedorEmail: n.vendedorEmail || '',
          supervisorNome: n.supervisorNome || '', supervisorEmail: n.supervisorEmail || '',
          origemImportacao: 'BLUESOFT_AUTOMATICO', ativo: true, atualizadoEm: agora, atualizadoPor: 'sistema-automatico',
        }, {merge: true});
        salvas++;
      } catch (e) { erros++; console.error('[NotasRetornadas automático] Falha ao salvar', n.chave, e.message || e); }
    }));
  }

  // Pedido ao vivo do usuário: "toda vez que uma nota que ta publicada for
  // atualizado que ela foi entregue, pode excluir ela da base anterior" —
  // qualquer "venda faturada" já salva que NÃO está mais no conjunto atual
  // de pendentes (pedidosFaturados, com os 3 status FATURADO/ROTEIRIZADO)
  // significa que ela mudou de status — virou ENTREGUE (ou CANCELADO/
  // DEVOLVIDO) — e não precisa mais ficar na tabela de referência. Só
  // limpa o que a própria automação salvou (BLUESOFT_AUTOMATICO) com
  // naturezaLabel=Venda — nunca mexe em devolução nem em importação
  // manual por PDF.
  let removidas = 0;
  try {
    const chavesVendaPendentesAgora = new Set(pedidosFaturados.filter(n => n.chave).map(n => n.chave));
    // Reaproveita o snapshot carregado ANTES do loop (mesma leitura já usada
    // pro cache de volume acima) — evita ler a coleção inteira duas vezes.
    const paraRemover = (salvasVendaSnap ? salvasVendaSnap.docs : []).filter(d => {
      const x = d.data() || {};
      return x.origemImportacao === 'BLUESOFT_AUTOMATICO' && !chavesVendaPendentesAgora.has(d.id);
    });
    for (let i = 0; i < paraRemover.length; i += 300) {
      const lote = paraRemover.slice(i, i + 300);
      const batch = db.batch();
      lote.forEach(d => batch.delete(d.ref));
      await batch.commit();
      removidas += lote.length;
    }
  } catch (e) { console.error('[NotasRetornadas automático] Falha ao limpar vendas já entregues', lojaId, e.message || e); }

  return {loja: loja.nome || lojaId, encontradas: todasNotas.length, salvas, comMotivoOuVolume, erros, removidas, reaproveitadas};
}

async function _sincronizarNotasRetornadasTodasLojas() {
  const lojasSnap = await db.collection('lojas').get();
  const resultados = [];
  for (const doc of lojasSnap.docs) {
    const loja = doc.data() || {};
    if (!loja.bluesoft_loja_key) continue;
    try {
      resultados.push(await _sincronizarNotasRetornadasDaLoja(doc.id, loja));
    } catch (e) {
      resultados.push({loja: loja.nome || doc.id, erro: e.message || String(e)});
      console.error('[NotasRetornadas automático] Falha na loja', doc.id, e);
    }
  }
  console.log('[NotasRetornadas automático] Resumo:', JSON.stringify(resultados));
  return resultados;
}

exports.sincronizarNotasRetornadasAgendado = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 540, memory: '512MB'})
  .pubsub.schedule('0 6,14,17 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => { await _sincronizarNotasRetornadasTodasLojas(); return null; });

// Gatilho manual (callable) — pra testar sem esperar o próximo horário
// agendado, mesma checagem de permissão do botão "Buscar"/"Salvar" manual.
exports.sincronizarNotasRetornadasAgora = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 540, memory: '512MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    const podeImportarRecusas = solicitante && solicitante.permissoes && solicitante.permissoes['recebimento-recusas'] &&
      solicitante.permissoes['recebimento-recusas'].importar === true;
    if (!administrador(solicitante) && !podeImportarRecusas) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa sincronização.');
    }
    const resultados = await _sincronizarNotasRetornadasTodasLojas();
    return {ok: true, resultados};
  });
