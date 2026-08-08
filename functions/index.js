'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

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
  if (typeof senha !== 'string' || senha.length < 8 || senha.length > 128 ||
      !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A senha deve ter entre 8 e 128 caracteres e conter letras e números.'
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
