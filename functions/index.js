'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const cors = require('cors')({origin: true});
const {BigQuery} = require('@google-cloud/bigquery');

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

// Extraído do handler .https.onCall (que só faz auth+permissão e delega
// aqui) pra poder ser testado direto, sem depender de como cada versão do
// SDK do firebase-functions expõe/invoca o callable por baixo — mesmo
// padrão já usado em _graphBiInternals pra sincronização do BI.
async function _criarUsuarioVinculadoInterno(data) {
    const nome = String(data?.nome || '').trim();
    const senha = String(data?.senha || '');
    const criarAnalista = data?.criarAnalista === true;
    // PEDIDO AO VIVO (2026-08-27): "eu selecionei só analista, sem
    // coletor... não precisa criar um login pra coletor" — antes desta
    // correção, o login de Coletor era SEMPRE criado, mesmo quando só
    // Analista era pedido (emailColetor era obrigatório incondicionalmente,
    // e emailNormalizado() lança erro pra string vazia SEM checar se aquele
    // e-mail é sequer necessário). Agora só normaliza/exige o e-mail de
    // cada canal quando aquele canal é realmente pedido.
    const criarColetor = data?.criarColetor === true;
    if (!nome || nome.length > MAX_NOME || !NOME_VALIDO.test(nome) || (!criarAnalista && !criarColetor)) {
      throw new functions.https.HttpsError('invalid-argument', 'Nome, login e senha são obrigatórios.');
    }
    const emailAnalista = criarAnalista ? emailNormalizado(data?.emailAnalista) : null;
    const emailColetor = criarColetor ? emailNormalizado(data?.emailColetor) : null;
    validarSenha(senha);

    let coletor = null;
    let analista = null;
    try {
      if (criarColetor) coletor = await obterOuCriarUsuario(emailColetor, senha, nome);
      if (criarAnalista) analista = await obterOuCriarUsuario(emailAnalista, senha, nome);
    } catch (error) {
      if (coletor && !coletor.existente) {
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
      uid: analista?.user.uid || coletor?.user.uid,
      analista_uid: analista?.user.uid || null,
      coletor_uid: coletor?.user.uid || null,
      conta_existente: coletor?.existente === true || analista?.existente === true
    };
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
    return _criarUsuarioVinculadoInterno(data);
  });

exports._criarUsuarioVinculadoInterno = _criarUsuarioVinculadoInterno;

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

// PEDIDO AO VIVO (2026-09-04): "no lugar de ficar entrando no coletor e
// ficar indo no analista aprovar... quero que no analista cadastre o ID do
// coletor e na hora que abrir o aplicativo ele já peça o id pra aprovar, e
// depois fique aprovado" — o Analista pré-gera um código (dt_codigos_coletor)
// com um nome/apelido pro aparelho; o operador digita esse código na tela
// "aguardando aprovação" do Coletor (ver 02-sync-dispositivo.js) e o
// aparelho já entra aprovado, sem precisar do Analista abrir a lista de
// coletores e clicar em Aprovar. Roda como Cloud Function (Admin SDK,
// ignora as regras do Firestore) porque as regras de dt_coletores
// deliberadamente IMPEDEM o próprio aparelho de se auto-aprovar (ver
// firestore.rules) — só um código válido, verificado aqui no servidor
// dentro de uma transação (evita 2 aparelhos usarem o mesmo código ao
// mesmo tempo), pode liberar o acesso.
async function _resgatarCodigoAprovacaoColetorInterno({codigo, deviceId, uid, email, nomeExibicao}) {
  const codigoNormalizado = String(codigo || '').trim().toUpperCase().slice(0, 20);
  const deviceIdSeguro = String(deviceId || '').trim().slice(0, 120);
  if (!codigoNormalizado) throw new functions.https.HttpsError('invalid-argument', 'Informe o código.');
  if (!deviceIdSeguro) throw new functions.https.HttpsError('invalid-argument', 'Aparelho não identificado.');
  const codigoRef = db.collection('dt_codigos_coletor').doc(codigoNormalizado);
  const deviceRef = db.collection('dt_coletores').doc(deviceIdSeguro);
  const agora = admin.firestore.FieldValue.serverTimestamp();
  const nome = nomeExibicao || email || 'Coletor';
  const resultado = await db.runTransaction(async tx => {
    const [codSnap, devSnap] = await Promise.all([tx.get(codigoRef), tx.get(deviceRef)]);
    if (!codSnap.exists) throw new functions.https.HttpsError('not-found', 'Código inválido.');
    const cod = codSnap.data() || {};
    if (cod.usado === true) throw new functions.https.HttpsError('failed-precondition', 'Esse código já foi usado. Peça um código novo ao Analista.');
    const dadosDevice = devSnap.exists ? (devSnap.data() || {}) : {};
    if (dadosDevice.aprovado === 'bloqueado') throw new functions.https.HttpsError('permission-denied', 'Este aparelho foi bloqueado pelo Analista.');
    const numero = deviceIdSeguro.slice(-4).toUpperCase();
    tx.set(deviceRef, {
      uid, device_id: deviceIdSeguro,
      nome_coletor: cod.nome_coletor || dadosDevice.nome_coletor || ('Coletor ' + numero),
      numero: dadosDevice.numero || numero,
      operador_atual: nome,
      operador_email: email || null,
      operador_uid: uid,
      status: 'offline',
      aprovado: 'aprovado',
      aprovado_em: agora,
      aprovado_via_codigo: codigoNormalizado,
      data_registro: dadosDevice.data_registro || agora,
      ultimo_ping: agora,
      sessao: null,
      contagens_enviadas: dadosDevice.contagens_enviadas || 0,
      contagens_pendentes: dadosDevice.contagens_pendentes || 0,
      excluido: false,
      revogado_em: null,
    }, {merge: true});
    tx.set(codigoRef, {
      usado: true, usado_em: agora, usado_por_device_id: deviceIdSeguro, usado_por_uid: uid,
    }, {merge: true});
    return {nome_coletor: cod.nome_coletor || ''};
  });
  return {ok: true, nome_coletor: resultado.nome_coletor};
}
exports._resgatarCodigoAprovacaoColetorInterno = _resgatarCodigoAprovacaoColetorInterno;

exports.resgatarCodigoAprovacaoColetor = functions.region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    return _resgatarCodigoAprovacaoColetorInterno({
      codigo: data?.codigo,
      deviceId: data?.deviceId,
      uid: context.auth.uid,
      email: context.auth.token.email,
      nomeExibicao: context.auth.token.name || context.auth.token.email,
    });
  });

// BUG AO VIVO REAL (2026-09-06): "Registro do aparelho falhou: permission-
// denied" repetindo por HORAS pra uma conta específica, mesmo depois de
// corrigir o menu que escondia o Diagnóstico. As firestore.rules de
// dt_coletores foram relidas com cuidado e, na teoria, deveriam aceitar
// esta escrita (allow create só exige signedIn(); allow update/pendente não
// depende de active()/canais_acesso) — ou seja, o texto da regra sozinho
// não explica o erro real. Em vez de continuar adivinhando pela leitura das
// regras, esta função (Admin SDK, ignora as regras) devolve o estado
// REAL gravado hoje pra esta conta+aparelho, pro Diagnóstico do coletor
// mostrar isso na tela em vez de só o código do erro. Só lê dados da
// PRÓPRIA conta autenticada (usuarios_acessos/{uid}) e do device_id que o
// próprio aparelho informa (o mesmo que já usa pra tentar se registrar) —
// nenhum dado de outra conta/aparelho é exposto.
exports.diagnosticarAparelhoColetor = functions.region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const deviceId = String(data?.deviceId || '').trim().slice(0, 120);
    const [accSnap, devSnap] = await Promise.all([
      db.collection('usuarios_acessos').doc(context.auth.uid).get(),
      deviceId ? db.collection('dt_coletores').doc(deviceId).get() : Promise.resolve(null),
    ]);
    const acc = accSnap.exists ? (accSnap.data() || {}) : null;
    const dev = devSnap && devSnap.exists ? (devSnap.data() || {}) : null;
    return {
      ok: true,
      uid: context.auth.uid,
      usuarios_acessos: acc ? {
        existe: true,
        ativo: acc.ativo !== false,
        perfil: acc.perfil || null,
        admin_mestre: acc.admin_mestre === true || acc.administrador_mestre === true,
        canais_acesso: acc.canais_acesso || null,
        lojas_permitidas: Array.isArray(acc.lojas_permitidas) ? acc.lojas_permitidas : [],
        acesso_todas_lojas: acc.acesso_todas_lojas === true,
      } : {existe: false},
      dt_coletores: dev ? {
        existe: true,
        aprovado: dev.aprovado ?? null,
        status: dev.status ?? null,
        excluido: dev.excluido ?? null,
        uid: dev.uid ?? null,
        operador_uid: dev.operador_uid ?? null,
        device_id: dev.device_id ?? null,
        revogado_em: dev.revogado_em ? String(dev.revogado_em) : null,
      } : {existe: false, device_id_consultado: deviceId || null},
    };
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
      // PEDIDO AO VIVO (usuário reportou vários "500" seguidos no console,
      // sem detalhe nenhum): só a chamada fetch() tinha try/catch — uma
      // exceção em qualquer coisa ANTES dela (verifyIdToken, parse do body,
      // validação) virava rejeição não tratada dentro do callback async
      // passado pro `cors`, que o runtime do Cloud Functions converte num
      // 500 genérico, sem corpo, sem mensagem — o navegador só reporta
      // "responded with a status of 500 ()", sem dar pra saber o motivo.
      // Envolve a função inteira, não só o fetch, pra qualquer erro real
      // sempre voltar como JSON com mensagem (o app já mostra isso no
      // diagnóstico da busca).
      try {
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
      } catch (erroInesperado) {
        console.error('Erro inesperado no proxy Bluesoft (fora do fetch):', erroInesperado);
        if (!res.headersSent) {
          return res.status(500).json({erro: 'Erro inesperado no proxy.', detalhe: String(erroInesperado && erroInesperado.message || erroInesperado)});
        }
      }
    });
  });

// ─────────────────────────────────────────────────────────────────────────
// Leitura do BI via Microsoft Graph API (SharePoint) — PEDIDO AO VIVO
// (2026-08-27): "amanhã eu vou colocar pra ir via a API, que aí fica mais
// fácil pra atualizar automaticamente". App Registration "App PCP e
// Compras" no Azure AD, fluxo client_credentials (servidor-a-servidor,
// sem usuário logado). O client secret NUNCA passa por código nem por esta
// conversa — fica só no Secret Manager (GRAPH_CLIENT_SECRET), injetado em
// process.env só dentro da função, por causa do `secrets:[...]` no
// runWith(). Tenant/Client ID e o caminho do SharePoint não são segredo
// (são só identificadores), por isso ficam aqui como constante mesmo.
const GRAPH_TENANT_ID = 'ed1c5836-e579-4f4d-be52-e0f3a971457a';
const GRAPH_CLIENT_ID = '07548f43-35db-4da8-bb71-463339e1793e';
const GRAPH_SHAREPOINT_HOSTNAME = 'daterrinhaalimentoscombr.sharepoint.com';
const GRAPH_SHAREPOINT_SITE_PATH = 'DT-BI';
// Caminho da pasta do BI DENTRO do drive padrão do site (ver
// _resolverDriveGraphApi) — "Shared Documents" costuma SER o próprio drive
// raiz, então não repete aqui; testarGraphApi confirma isso na prática.
const GRAPH_PASTA_BI = 'PCP/extracao_dados_planejamento_estoque';

let _graphTokenCache = null; // {token, expiraEm} — reaproveitado entre invocações "quentes" da função
async function _obterTokenGraphApi(clientSecret) {
  if (_graphTokenCache && _graphTokenCache.expiraEm > Date.now() + 30000) return _graphTokenCache.token;
  const resp = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: GRAPH_CLIENT_ID, client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
  });
  const dados = await resp.json();
  if (!resp.ok) throw new Error('Falha ao autenticar no Graph API: ' + (dados.error_description || dados.error || resp.status));
  _graphTokenCache = {token: dados.access_token, expiraEm: Date.now() + (Number(dados.expires_in) || 3600) * 1000};
  return _graphTokenCache.token;
}
let _graphDriveIdCache = null; // driveId do site resolvido — não muda, cacheado entre invocações quentes
async function _resolverDriveGraphApi(token) {
  if (_graphDriveIdCache) return _graphDriveIdCache;
  const headers = {Authorization: 'Bearer ' + token};
  const siteResp = await fetch(`https://graph.microsoft.com/v1.0/sites/${GRAPH_SHAREPOINT_HOSTNAME}:/sites/${GRAPH_SHAREPOINT_SITE_PATH}`, {headers});
  const site = await siteResp.json();
  if (!siteResp.ok) throw new Error('Falha ao achar o site do SharePoint: ' + (site.error?.message || siteResp.status));
  const driveResp = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drive`, {headers});
  const drive = await driveResp.json();
  if (!driveResp.ok) throw new Error('Falha ao achar a biblioteca de documentos: ' + (drive.error?.message || driveResp.status));
  _graphDriveIdCache = drive.id;
  return _graphDriveIdCache;
}
async function _listarArquivosBiGraphApi(token, driveId) {
  const headers = {Authorization: 'Bearer ' + token};
  const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(GRAPH_PASTA_BI).replace(/%2F/g, '/')}:/children?$select=name,size,lastModifiedDateTime`, {headers});
  const dados = await resp.json();
  if (!resp.ok) throw new Error('Falha ao listar a pasta do BI: ' + (dados.error?.message || resp.status));
  return (dados.value || []).map(f => ({nome: f.name, tamanho: f.size, modificadoEm: f.lastModifiedDateTime}));
}
async function _lerArquivoBiGraphApi(token, driveId, nomeArquivo) {
  const headers = {Authorization: 'Bearer ' + token};
  const resp = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(GRAPH_PASTA_BI).replace(/%2F/g, '/')}/${encodeURIComponent(nomeArquivo)}:/content`, {headers});
  if (!resp.ok) {
    const dados = await resp.json().catch(() => ({}));
    throw new Error('Falha ao ler ' + nomeArquivo + ' no SharePoint: ' + (dados.error?.message || resp.status));
  }
  return resp.json();
}

// Versão segura (callable, exige login+permissão) — usada pelas telas do
// Analista pra buscar um arquivo específico do BI via API, no lugar da
// pasta local sincronizada. Mesmo contrato de retorno que
// DTBiPastaLocal.lerJson(arquivo) — troca só QUEM fornece o JSON.
// PEDIDO AO VIVO: estourava "Memory limit of 256 MiB exceeded with 277 MiB
// used" ao buscar arquivos grandes (ex.: notas_fiscais_jacson.json com
// milhares de notas de venda) — a resposta ficava corrompida no meio do
// estouro e o cliente via "Response is not valid JSON object", sem
// nenhuma pista do motivo real (só aparecia nos logs da function, não na
// tela). 256 MiB era o default do Cloud Functions v1, nunca configurado
// explicitamente; alinhado aqui com as outras functions de BI do mesmo
// arquivo (sincronizarBiAgendado etc., já em 512MB-1GB).
exports.buscarArquivoBiGraphApi = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 120, memory: '1GB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    const podeImportarRecusas = solicitante && solicitante.permissoes && solicitante.permissoes['recebimento-recusas'] &&
      solicitante.permissoes['recebimento-recusas'].importar === true;
    if (!administrador(solicitante) && !podeImportarRecusas) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode buscar arquivos do BI.');
    }
    const arquivo = String(data && data.arquivo || '').trim();
    if (!arquivo) throw new functions.https.HttpsError('invalid-argument', 'Informe o nome do arquivo.');
    try {
      const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
      const driveId = await _resolverDriveGraphApi(token);
      const conteudo = await _lerArquivoBiGraphApi(token, driveId, arquivo);
      return {ok: true, dados: conteudo};
    } catch (e) {
      throw new functions.https.HttpsError('internal', String(e.message || e));
    }
  });

// ─────────────────────────────────────────────────────────────────────────
// Sincronização automática do BI via API (servidor, sem navegador aberto)
// PEDIDO AO VIVO (2026-08-27): "coloca também uma atualização automática...
// pra atualizar toda vez que o arquivo for atualizado" — começando pelos 2
// fluxos mais simples (Ficha Técnica e Agenda de Recebimento — só merge,
// sem pacotes/exclusão como o ledger de venda). Duplica de propósito a
// mesma lógica já validada em produção do lado do cliente
// (_agruparFichaTecnicaBiPorProduto em 60-producao-ficha-tecnica.js e
// _agruparComprasAReceberBiPorPedido/_gravarAgendaPendentes em
// 90-bluesoft-service.js) — aqui usando Admin SDK (acesso direto a
// lojas/{lojaId}/..., sem o conceito de "loja ativa" que só existe no
// navegador). Se a lógica de agrupamento mudar de um lado, replicar a
// mudança no outro.
async function _sincronizarFichaTecnicaBiLoja(lojaId, lojaKey, registrosFicha) {
  const colProdutos = db.collection('lojas').doc(lojaId).collection('producao_produtos');
  const colFichas = db.collection('lojas').doc(lojaId).collection('producao_ficha_tecnica');
  const [produtosSnap, fichasSnap] = await Promise.all([colProdutos.get(), colFichas.get()]);
  const codsComProduto = new Set(produtosSnap.docs.map(d => String((d.data() || {}).cod)));
  const fichasPorCod = new Map(fichasSnap.docs.map(d => [String((d.data() || {}).cod), d.id]));

  const porProduto = new Map();
  registrosFicha.forEach(it => {
    if (lojaKey != null && String(it.loja_key) !== String(lojaKey)) return;
    const cod = it.produto_key != null ? String(it.produto_key) : '';
    if (!cod) return;
    if (!porProduto.has(cod)) porProduto.set(cod, {cod, desc: it.produto_acabado || '', insumos: []});
    const produto = porProduto.get(cod);
    if (!produto.desc && it.produto_acabado) produto.desc = it.produto_acabado;
    const nomeInsumo = it.descricao_insumo || '';
    if (!nomeInsumo) return;
    produto.insumos.push({insumo: nomeInsumo, qty: Number(it.consumo_receita) || 0, categoria: ''});
  });
  const agrupadas = [...porProduto.values()];
  const agora = new Date().toISOString();
  let semProduto = 0;
  for (let i = 0; i < agrupadas.length; i += 300) {
    const lote = agrupadas.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(f => {
      if (!codsComProduto.has(f.cod)) semProduto++;
      const payload = {cod: f.cod, desc: f.desc, insumos: f.insumos, atualizadoEm: agora};
      const idExistente = fichasPorCod.get(f.cod);
      if (idExistente) batch.set(colFichas.doc(idExistente), payload, {merge: true});
      else batch.set(colFichas.doc(), Object.assign({}, payload, {criadoEm: agora}));
    });
    await batch.commit();
  }
  return {total: agrupadas.length, semProduto};
}

async function _sincronizarAgendaBiLoja(lojaId, loja, registrosCompras) {
  const lojaKey = loja.bluesoft_loja_key != null ? loja.bluesoft_loja_key : null;
  const porPedido = new Map();
  registrosCompras.forEach(it => {
    if (lojaKey != null && String(it.loja_key) !== String(lojaKey)) return;
    const pendente = Number(it.qtd_unidades_pendentes) || 0;
    if (pendente <= 0) return;
    const numeroPedido = it.pedido_key != null ? String(it.pedido_key) : '';
    if (!numeroPedido) return;
    if (!porPedido.has(numeroPedido)) {
      porPedido.set(numeroPedido, {numeroPedido, fornecedorNome: it.fornecedor || '', compradorNome: it.comprador || '', dataEntregaInicial: '', dataEntregaFinal: '', itensPorProduto: new Map()});
    }
    const pedido = porPedido.get(numeroPedido);
    const dataIni = it.data_entrega_inicial ? String(it.data_entrega_inicial).slice(0, 10) : '';
    const dataFim = it.data_entrega_final ? String(it.data_entrega_final).slice(0, 10) : '';
    if (dataIni && (!pedido.dataEntregaInicial || dataIni < pedido.dataEntregaInicial)) pedido.dataEntregaInicial = dataIni;
    if (dataFim && (!pedido.dataEntregaFinal || dataFim > pedido.dataEntregaFinal)) pedido.dataEntregaFinal = dataFim;
    const chaveProduto = it.produto_key != null ? String(it.produto_key) : (it.descricao || '');
    // PEDIDO AO VIVO (2026-08-27): "traz os campos código do produto, valor,
    // quantidade recebida" — o arquivo (compras_a_receber.json) já trazia
    // esses campos (produto_key, custo_unitario, valor_pendente,
    // qtd_unidades_recebidas), só não eram lidos. quantidadeRecebida e
    // valorPendente somam entre parcelas do mesmo pedido/produto (campo
    // "entrega" do arquivo pode fatiar um item em mais de uma linha);
    // custoUnitario fica com o valor mais recente lido.
    const atual = pedido.itensPorProduto.get(chaveProduto) || {produto: it.descricao || '', produtoKey: it.produto_key != null ? String(it.produto_key) : '', tipoProduto: '', quantidadePendente: 0, quantidadeRecebida: 0, valorPendente: 0, custoUnitario: 0};
    atual.quantidadePendente += pendente;
    atual.quantidadeRecebida += Number(it.qtd_unidades_recebidas) || 0;
    atual.valorPendente += Number(it.valor_pendente) || 0;
    if (Number(it.custo_unitario) > 0) atual.custoUnitario = Number(it.custo_unitario);
    pedido.itensPorProduto.set(chaveProduto, atual);
  });
  const pendentes = [...porPedido.values()].map(p => ({
    numeroPedido: p.numeroPedido, fornecedorNome: p.fornecedorNome, compradorNome: p.compradorNome,
    dataEntregaInicial: p.dataEntregaInicial, dataEntregaFinal: p.dataEntregaFinal, itens: [...p.itensPorProduto.values()],
  }));
  if (!pendentes.length) return {totalPedidosPendentes: 0, criados: 0, atualizados: 0};

  const colAgenda = db.collection('lojas').doc(lojaId).collection('recebimento_agendamentos');
  const snap = await colAgenda.get();
  const docPorNumeroPedido = new Map();
  snap.docs.forEach(d => { const x = d.data() || {}; if (x.numeroPedido != null) docPorNumeroPedido.set(String(x.numeroPedido), {id: d.id, dados: x}); });
  const agora = new Date().toISOString();
  let criados = 0, atualizados = 0;
  for (let i = 0; i < pendentes.length; i += 300) {
    const lote = pendentes.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(p => {
      const fornecedorNome = p.fornecedorNome || ('Fornecedor ' + p.numeroPedido);
      const dataPrevista = p.dataEntregaInicial ? String(p.dataEntregaInicial).slice(0, 10) : '';
      const existente = docPorNumeroPedido.get(String(p.numeroPedido));
      // PEDIDO AO VIVO (2026-08-27): "tira tudo da bluesoft... pra quando
      // você linkar no SharePoint, puxar essas informações atualizadas" —
      // esta função já veio do SharePoint desde que foi criada (não da
      // Bluesoft), mas gravava origem:'bluesoft' por ter copiado o payload
      // do sync antigo sem trocar o rótulo. Corrigido pra origem:'bi' —
      // sem isso, uma limpeza futura que apague "dado antigo da bluesoft"
      // filtrando por origem==='bluesoft' apagaria também o dado NOVO,
      // vindo do SharePoint, só porque o rótulo estava errado. Doc antigo
      // (de antes desta correção) ainda pode estar marcado 'bluesoft' — por
      // isso o `limparPrevisaoAntiga` aceita os dois valores, o que importa
      // é "veio de sync automático", não qual sync.
      if (existente) {
        const limparPrevisaoAntiga = (existente.dados.origem === 'bluesoft' || existente.dados.origem === 'bi') && !existente.dados.agendamentoConfirmadoManual;
        batch.set(colAgenda.doc(existente.id), Object.assign({
          origem: 'bi', lojaId, lojaNome: loja.nome || loja.codigo || lojaId, numeroPedido: p.numeroPedido, fornecedorNome, dataPrevista,
          dataEntregaFinal: p.dataEntregaFinal || null, compradorNome: p.compradorNome || '', itensPedido: p.itens || [], bluesoftSincronizadoEm: agora, atualizadoEm: agora,
        }, limparPrevisaoAntiga ? {dataAgendada: ''} : {}), {merge: true});
        atualizados++;
      } else {
        batch.set(colAgenda.doc(), {
          origem: 'bi', lojaId, lojaNome: loja.nome || loja.codigo || lojaId, numeroPedido: p.numeroPedido, fornecedorNome, dataPrevista, dataAgendada: '', compradorNome: p.compradorNome || '', itensPedido: p.itens || [],
          dataEntregaFinal: p.dataEntregaFinal || null, horaAgendada: '', codigo: 'PC-' + p.numeroPedido,
          motoristaNome: '', placa: '', status: 'AGENDADO',
          observacao: 'Pedido de compra #' + p.numeroPedido + ' — sincronizado automaticamente (BI)',
          bluesoftSincronizadoEm: agora, criadoEm: agora, atualizadoEm: agora,
        }, {merge: true});
        criados++;
      }
    });
    await batch.commit();
  }
  return {totalPedidosPendentes: pendentes.length, criados, atualizados};
}

const _idSeguro = v => String(v ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);

// PEDIDO AO VIVO (2026-08-27): "mas é para puxar do share point tudo nao
// mais da bluesoft" — o estoque de insumos que o PCP usa pra sobrepor
// `producao_projecao.estoqueAtual` (tela "Pedidos x Estoque", ver
// 66-producao-projecao.js:97 e 78-pcp-central.js:35) vinha só da Bluesoft
// (90-bluesoft-service.js, coleção pcp_estoque_bluesoft, origem:'bluesoft').
// dados-insumos.json já é lido pela tela "Relatórios BI" (101-relatorios-bi.js,
// aba "Estoque de Insumos") e tem loja como CHAVE NUMÉRICA (mesmo formato de
// bluesoft_loja_key — confirmado nos dados reais: "1","10","11","14"), ao
// contrário de dados-estoque.json (produto acabado), cujo campo `loja` é o
// NOME do cliente/marca (ex.: "ROMARIZ","ALGO MAIS") e não mapeia direto pra
// loja numérica — por isso fica de fora aqui, é um caso à parte.
// Mesma coleção/doc-id que a Bluesoft já escrevia (`produto_<cod>`), pra não
// precisar tocar em nenhum código de leitura (66-producao-projecao.js,
// 78-pcp-central.js) — só troca QUEM alimenta o dado, com origem:'bi'.
// NÃO aplica a mesma guarda de "só cod já cadastrado em producao_produtos"
// que _sincronizarEstoqueProdutoAcabadoBiLoja usa logo abaixo (bug real de
// contaminação por matéria-prima de outra planta): dados-insumos.json não
// mostrou o mesmo problema de magnitude (valores batem com o esperado por
// loja) e "09016 FARINHA DE MANDIOCA" — o caso real que esta função corrigiu
// — é um insumo, podendo não estar cadastrado em producao_produtos da mesma
// forma que produto acabado. Restringir aqui sem confirmar arriscava
// reverter silenciosamente a correção original. Mantido como estava.
async function _sincronizarEstoqueInsumosBiLoja(lojaId, lojaKey, registrosInsumos) {
  const colEstoque = db.collection('lojas').doc(lojaId).collection('pcp_estoque_bluesoft');
  const relevantes = (registrosInsumos || []).filter(it => lojaKey != null && String(it.loja) === String(lojaKey) && it.sku != null);
  const agora = new Date().toISOString();
  let gravados = 0;
  for (let i = 0; i < relevantes.length; i += 300) {
    const lote = relevantes.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(it => {
      const cod = String(it.sku);
      const payload = {
        cod, produto: it.produto || ('Produto ' + cod),
        estoqueAtual: Number(it.estoque) || 0,
        unidadeExibicao: it.unidade || '',
        consumoDiaMedioBluesoft: (Number(it.consumoMensal) || 0) / 30,
        biSincronizadoEm: agora, atualizadoEm: agora, origem: 'bi',
      };
      batch.set(colEstoque.doc('produto_' + _idSeguro(cod)), payload, {merge: true});
      gravados++;
    });
    await batch.commit();
  }
  return {total: relevantes.length, gravados};
}

// PEDIDO AO VIVO (2026-08-27): "migra tudo" — depois de confirmado que
// produtos_estoque.json tem loja_key NUMÉRICO (ao contrário de
// dados-estoque.json, que é por nome de cliente/marca) e já traz
// `quantidadePedidos` (pedido de venda pendente/reservado — a cobertura
// negativa nos dados reais bate com pedido > estoque, mesmo cálculo que
// `disponivel=estoque-comprometido` em 78-pcp-central.js:35), este arquivo
// cobre finalmente o produto ACABADO — dados-insumos.json acima só cobria
// matéria-prima/embalagem. Mesmo padrão/doc-id de
// _sincronizarEstoqueInsumosBiLoja (produto_<cod>, origem:'bi'), campo
// `estoqueReservadoVenda` é o MESMO nome que 90-bluesoft-service.js já
// gravava pra pedido de venda pendente — reaproveitado de propósito, pra
// não precisar tocar em nenhum código de leitura.
// BUG AO VIVO REAL (achado pelo usuário, "Estoque atual (CX)" do Dashboard
// do PCP pulou pra 15 milhões): produtos_estoque.json mistura, sob o MESMO
// campo `quantidade_estoque` sem indicar unidade, produto acabado em CAIXA
// (ex.: "00001 TAPIOCA... - CX 12": 1482) com matéria-prima em KG vinda de
// OUTRAS plantas/fornecedoras que nem são loja de venda de verdade (ex.:
// loja_key 7 "TERRAFEC FECULA MANDIOCA", produto "000002 FECULA KG":
// 806.000) — sem campo de unidade nem tipo pra distinguir os dois casos.
// Corrigido restringindo a um `cod` já cadastrado nesta loja. PEDIDO AO
// VIVO (2026-08-27) — correção do próprio filtro: "aquele cadastro da
// produção é o que produz nela, mas tem produtos que vem de fornecedores,
// então não pode usar o que tá lá para o restante do estoque" — restringir
// só a producao_produtos (cadastro de FABRICAÇÃO) excluía todo produto
// comprado de fornecedor e revendido pela loja, que nunca teve motivo pra
// estar cadastrado como "produzido". A guarda agora aceita o MESMO cadastro
// mais amplo que 78-pcp-central.js:68 já usa pra montar a própria tela
// (producao_produtos UNIÃO pcp_produtos_bluesoft — este último cobre
// venda/compra de fornecedor, não só fabricação) — matéria-prima de outra
// planta (ex.: fécula de 806 mil "caixas") continua de fora, porque nunca
// esteve cadastrada em nenhum dos dois.
async function _sincronizarEstoqueProdutoAcabadoBiLoja(lojaId, lojaKey, registrosProdutos) {
  const colEstoque = db.collection('lojas').doc(lojaId).collection('pcp_estoque_bluesoft');
  const [produtosSnap, produtosBluesoftSnap] = await Promise.all([
    db.collection('lojas').doc(lojaId).collection('producao_produtos').get(),
    db.collection('lojas').doc(lojaId).collection('pcp_produtos_bluesoft').get(),
  ]);
  const codsRegistrados = new Set([
    ...produtosSnap.docs.map(d => String((d.data() || {}).cod || '')),
    ...produtosBluesoftSnap.docs.map(d => String((d.data() || {}).cod || '')),
  ].filter(Boolean));
  const relevantes = (registrosProdutos || []).filter(it => lojaKey != null && String(it.loja_key) === String(lojaKey) && it.produto_key != null && codsRegistrados.has(String(it.produto_key)));
  const agora = new Date().toISOString();
  let gravados = 0;
  for (let i = 0; i < relevantes.length; i += 300) {
    const lote = relevantes.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(it => {
      const cod = String(it.produto_key);
      const payload = {
        cod, produto: it.produto || ('Produto ' + cod),
        estoqueAtual: Number(it.quantidade_estoque) || 0,
        estoqueReservadoVenda: Number(it.quantidadePedidos) || 0,
        biSincronizadoEm: agora, atualizadoEm: agora, origem: 'bi',
      };
      batch.set(colEstoque.doc('produto_' + _idSeguro(cod)), payload, {merge: true});
      gravados++;
    });
    await batch.commit();
  }
  return {total: relevantes.length, gravados};
}

// PEDIDO AO VIVO (2026-08-27): "migra tudo" — último dado real que faltava
// pro PCP parar de depender da Bluesoft: venda_m1/m2/m3 (histórico de
// vendas dos últimos 3 meses fechados, usado no cálculo de demanda
// ponderada — ver memoriaDeCalculo em 78-pcp-central.js). notas_fiscais_
// jacson.json é estrutura PLANA (1 item por linha, não nota+itens
// aninhados — confirmado nos dados reais), com tipo_movimento 'VENDA' ou
// 'DEVOLUCAO' — só 'VENDA' entra aqui (devolução não é demanda). Os 3
// meses viram os 3 valores DISTINTOS mais recentes de data_emissao.slice(0,7)
// presentes nos dados desta loja, não "hoje menos 1/2/3" fixo — evita M1/M2/M3
// zerados se a extração do BI atrasar um dia. Grava em producao_projecao
// (mesmo destino que a Bluesoft já usava), casando só por `cod` — a
// coleção tem muito campo manual (maquina, pc_min, projeção manual) que o
// merge:true nunca toca.
async function _sincronizarHistoricoVendasBiLoja(lojaId, lojaKey, registrosNotas) {
  const relevantes = (registrosNotas || []).filter(it => lojaKey != null && String(it.loja_key) === String(lojaKey) && it.tipo_movimento === 'VENDA' && it.produto_key != null && it.data_emissao);
  const mesesDisponiveis = [...new Set(relevantes.map(it => String(it.data_emissao).slice(0, 7)))].sort().reverse().slice(0, 3);
  const porProdutoMes = new Map();
  relevantes.forEach(it => {
    const idx = mesesDisponiveis.indexOf(String(it.data_emissao).slice(0, 7));
    if (idx === -1) return;
    const cod = String(it.produto_key);
    const acc = porProdutoMes.get(cod) || [0, 0, 0];
    acc[idx] += Number(it.quantidade_faturada) || 0;
    porProdutoMes.set(cod, acc);
  });
  const colProjecao = db.collection('lojas').doc(lojaId).collection('producao_projecao');
  const snap = await colProjecao.get();
  const porCod = new Map();
  snap.docs.forEach(d => { const x = d.data() || {}; if (x.cod != null) porCod.set(String(x.cod), d.id); });
  const agora = new Date().toISOString();
  let gravados = 0;
  const entradas = [...porProdutoMes.entries()];
  for (let i = 0; i < entradas.length; i += 300) {
    const lote = entradas.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(([cod, [m1, m2, m3]]) => {
      // BUG AO VIVO REAL (mesma causa raiz de _sincronizarEstoqueProdutoAcabadoBiLoja
      // logo acima): criar um doc NOVO pra qualquer produto_key vendido —
      // mesmo um item interno tipo "000002 FECULA KG" que nunca teve
      // producao_projecao — vira linha fantasma nos KPIs do PCP (78-pcp-
      // central.js:69 lê TUDO de producao_projecao sem filtrar cadastro).
      // Só atualiza doc que já existe; produto sem projeção cadastrada
      // fica de fora, nunca cria um novo.
      const id = porCod.get(cod);
      if (!id) return;
      const payload = {cod, venda_m1: m1, venda_m2: m2, venda_m3: m3, historicoVendasMeses: mesesDisponiveis, biSincronizadoEm: agora, atualizadoEm: agora, origem: 'bi'};
      batch.set(colProjecao.doc(id), payload, {merge: true});
      gravados++;
    });
    await batch.commit();
  }
  return {total: entradas.length, gravados, meses: mesesDisponiveis};
}

// PEDIDO AO VIVO (2026-08-29): "se eu quiser que ela atualize sozinha, vai
// atualizar" — o ledger de Notas Retornadas (recebimento_recusas_notas,
// tela 97-recebimento-recusas.js) só era alimentado por clique manual em
// "Buscar" ou por um setInterval de 30min QUE SÓ RODA com aquela aba do
// navegador aberta — nada de verdade automático. Passa a rodar aqui,
// dentro do mesmo sync agendado de 30min que já roda pras outras fontes,
// sem depender de navegador nenhum aberto. Duplica de propósito a mesma
// lógica já validada em produção do lado do cliente
// (_agruparNotasBiPorChave/_gravarNotasVenda/_notaResumida em
// 97-recebimento-recusas.js) — se a lógica de agrupamento/chunking mudar
// de um lado, replicar a mudança no outro. O botão "Buscar" manual
// continua existindo na tela (útil pra forçar uma atualização imediata),
// mas deixa de ser a única forma de a lista se manter em dia.
// BUG AO VIVO REAL (2026-09-03, duas vezes seguidas — 18:09 e 19:13):
// "Falha na última busca: Document .../recebimento_recusas_notas_chunks/
// chunk_N cannot be written because its size (~1.08MB) exceeds o máximo de
// 1.048.576 bytes" — 1000 notas por chunk (só contagem, nunca bytes) já
// não cabe: notas reais (destinatario/vendedorNome variam de tamanho)
// davam ~1084 bytes/nota de verdade no Firestore. Esta é a sincronização
// AGENDADA no servidor (roda sozinha a cada 30min, é aqui — não no
// cliente — que as duas falhas de produção realmente aconteceram, porque
// o botão manual do lado cliente só tinha sido corrigido primeiro sem
// perceber que este duplicado também precisava do mesmo conserto).
// TAMANHO_CHUNK_NOTAS_RETORNADAS caiu pra 400 — com folga generosa mesmo
// se uma nota futura for maior que qualquer uma já vista (400 × ~1084 ≈
// 434.000 bytes, 41% do limite real).
const TAMANHO_CHUNK_NOTAS_RETORNADAS = 400;
function _agruparNotasVendaBiPorChave(itens) {
  const porChave = new Map();
  itens.forEach(it => {
    const chave = String(it.chave || '').trim();
    if (!chave) return;
    if (!porChave.has(chave)) {
      porChave.set(chave, {
        chave, numeroNota: it.nf_numero != null ? String(it.nf_numero) : '', serie: it.nf_serie != null ? String(it.nf_serie) : '',
        destinatario: it.cliente || '', dataEmissao: String(it.data_emissao || '').slice(0, 10), cfop: it.cfop || '',
        valorTotal: 0, vendedorNome: it.vendedor || '', supervisorNome: it.supervisor || '', itens: [],
      });
    }
    const nota = porChave.get(chave);
    nota.valorTotal += Number(it.valor_nota) || 0;
    nota.itens.push({produtoKey: it.produto_key != null ? it.produto_key : null, descricao: it.produto || '', quantidade: Number(it.quantidade_faturada) || 0, gtin: '', ncm: ''});
  });
  return [...porChave.values()];
}
function _notaRetornadaResumida(n) {
  return {
    chave: n.chave, numeroNota: n.numeroNota, serie: n.serie, destinatario: n.destinatario || '',
    destinatarioCnpj: n.destinatarioCnpj || '', dataEmissao: n.dataEmissao || '', valorTotal: Number(n.valorTotal) || 0,
    cfop: n.cfop || '', naturezaLabel: n.naturezaLabel || '', tipoOperacao: n.tipoOperacao || '',
    informacoesComplementares: n.informacoesComplementares || '', pareceDevolucao: !!n.pareceDevolucao, origemImportacao: n.origemImportacao || '',
    vendedorNome: n.vendedorNome || '', vendedorEmail: n.vendedorEmail || '', supervisorNome: n.supervisorNome || '', supervisorEmail: n.supervisorEmail || '',
    ativo: n.ativo !== false, atualizadoEm: n.atualizadoEm || '',
  };
}
// BUG AO VIVO REAL (2026-09-03, causa raiz de verdade — descoberta com
// diagnóstico real do usuário: "0 notas dentro, mas o documento pesa mais
// de 1MB"): `.set(ref, {'notas.'+chave: valor}, {merge:true})` NUNCA criou
// o mapa aninhado {notas:{chave:valor}} que esta sincronização sempre
// assumiu ao ler `dados.notas` — criou um campo LITERAL solto na raiz do
// documento, chamado "notas.CHAVE" (o ponto faz parte do NOME do campo,
// não é um caminho aninhado). Isso é desde o INÍCIO deste recurso: toda
// leitura de "quantas notas já tem nesse chunk" sempre via ZERO, então
// `chavesExistentes` nunca continha nada, TODA nota da busca era tratada
// como nova em TODA sincronização, e o chunk só crescia — nunca parava,
// não importa o limite configurado. Lê os dois formatos (o aninhado
// correto e os campos soltos legados) — nunca mais grava no formato
// quebrado (ver o resto desta função: sempre `.set(ref,{notas:mapa})`
// com o mapa JÁ COMPLETO, nunca merge com chave de ponto).
function _notasRetornadasDoDocumentoChunk(dados) {
  dados = dados || {};
  const notas = Object.assign({}, dados.notas || {});
  Object.keys(dados).forEach(k => {
    if (!k.startsWith('notas.')) return;
    const v = dados[k];
    if (v && typeof v === 'object') notas[k.slice(6)] = v;
  });
  return notas;
}
// Lê o estado REAL de um chunk (curando campo solto legado na leitura) e
// grava de volta com `.set()` SEM merge, sempre com o mapa {notas:...}
// já completo calculado aqui — nunca mais um merge cego com chave de
// ponto, que é a causa raiz de tudo isso.
async function _lerEGravarChunkNotasRetornadas(colChunks, chunkIndex, mudar) {
  const ref = colChunks.doc('chunk_' + chunkIndex);
  const snap = await ref.get();
  const notas = _notasRetornadasDoDocumentoChunk(snap.exists ? snap.data() : null);
  mudar(notas);
  const batch = db.batch();
  batch.set(ref, {notas});
  await batch.commit();
}
// BUG AO VIVO REAL (2026-09-03, três vezes seguidas — 18:09, 19:13, 19:30 e
// de novo 21:04 com o MESMO tamanho de antes): reduzir TAMANHO_CHUNK_
// NOTAS_RETORNADAS não resolveu sozinho porque o pacote que falha já
// estava com MUITO mais notas do que o limite (de antes de qualquer
// conserto existir) — reduzir o limite só evita que um pacote NOVO fique
// grande, nunca divide um que JÁ está grande. O conserto manual (botão
// "Reparar" em 97-recebimento-recusas.js) resolve, mas depende de alguém
// clicar — e essa sincronização roda SOZINHA a cada 30min, então continua
// batendo no mesmo pacote quebrado até alguém lembrar de clicar. Esta
// função divide pacotes grandes demais automaticamente, ANTES de tentar
// gravar qualquer nota nova — nenhuma dependência de ação manual.
async function _dividirChunksNotasRetornadasGrandesDemaisSeNecessario(colChunks, colNotas, notasExistentes) {
  const porChunk = new Map();
  notasExistentes.forEach(n => {
    const idx = n.chunkIndex != null ? n.chunkIndex : 0;
    if (!porChunk.has(idx)) porChunk.set(idx, []);
    porChunk.get(idx).push(n);
  });
  let proximoIndiceLivre = porChunk.size ? Math.max(...porChunk.keys()) + 1 : 0;
  const resultado = [];
  let dividiuAlgo = false;
  for (const [idx, lista] of porChunk) {
    if (lista.length <= TAMANHO_CHUNK_NOTAS_RETORNADAS) { resultado.push(...lista); continue; }
    dividiuAlgo = true;
    const ficam = lista.slice(0, TAMANHO_CHUNK_NOTAS_RETORNADAS);
    let excedentes = lista.slice(TAMANHO_CHUNK_NOTAS_RETORNADAS);
    const mapaFica = {};
    ficam.forEach(n => { mapaFica[n.chave] = _notaRetornadaResumida(n); });
    const batchFica = db.batch();
    batchFica.set(colChunks.doc('chunk_' + idx), {notas: mapaFica});
    await batchFica.commit();
    resultado.push(...ficam);
    while (excedentes.length) {
      const bloco = excedentes.slice(0, TAMANHO_CHUNK_NOTAS_RETORNADAS);
      excedentes = excedentes.slice(TAMANHO_CHUNK_NOTAS_RETORNADAS);
      const novoIndice = proximoIndiceLivre++;
      for (let i = 0; i < bloco.length; i += 300) {
        const sublote = bloco.slice(i, i + 300);
        const batchIndividual = db.batch();
        sublote.forEach(n => batchIndividual.set(colNotas.doc(n.chave), {chunkIndex: novoIndice}, {merge: true}));
        await batchIndividual.commit();
      }
      const mapaBloco = {};
      bloco.forEach(n => { mapaBloco[n.chave] = _notaRetornadaResumida(n); n.chunkIndex = novoIndice; });
      const batchNovo = db.batch();
      batchNovo.set(colChunks.doc('chunk_' + novoIndice), {notas: mapaBloco});
      await batchNovo.commit();
      resultado.push(...bloco);
    }
  }
  return {dividiuAlgo, notasExistentes: resultado};
}
// Mesma regra do lado cliente: "o jacson.json só traz venda ainda EM
// ABERTO... caso a nota sumiu, é pra excluir também... a que já foi
// recebida pelo Coletor, aí não vai apagar" — e "nunca reconcilia com uma
// busca vazia" (guardado pelo `if (notas.length)` abaixo).
async function _sincronizarNotasRetornadasVendaBiLoja(lojaId, lojaKey, registrosNotas) {
  const relevantes = (registrosNotas || []).filter(it => lojaKey != null && String(it.loja_key) === String(lojaKey) && it.tipo_movimento === 'VENDA' && it.chave);
  const notas = _agruparNotasVendaBiPorChave(relevantes);

  const colNotas = db.collection('lojas').doc(lojaId).collection('recebimento_recusas_notas');
  const colChunks = db.collection('lojas').doc(lojaId).collection('recebimento_recusas_notas_chunks');
  const colRecusas = db.collection('lojas').doc(lojaId).collection('recebimento_recusas');
  const [chunksSnap, recusasSnap] = await Promise.all([colChunks.get(), colRecusas.get()]);

  let notasExistentes = [];
  chunksSnap.docs.forEach(doc => {
    const chunkIndex = Number(String(doc.id).replace('chunk_', '')) || 0;
    Object.values(_notasRetornadasDoDocumentoChunk(doc.data())).forEach(nota => notasExistentes.push(Object.assign({}, nota, {chunkIndex})));
  });
  // BUG AO VIVO REAL (2026-09-03): "se não foi recebida, ela tem que
  // apagar... senão só vai juntando nota lixo" — gravar notas NOVAS e
  // REMOVER as que saíram de "em aberto" são 2 passos independentes, mas
  // um erro no 1º (ex.: chunk estourou o 1MB do Firestore) subia direto e
  // pulava o 2º inteiro — a limpeza nunca rodava. Isso deixava a "nota
  // lixo" se acumular pra sempre, piorando exatamente o problema que
  // causou a falha original (mais notas presas = chunk cada vez mais
  // perto do limite de novo). Agora um erro ao dividir/gravar é reportado
  // no fim, mas NUNCA impede a limpeza de rodar.
  let erroAoGravar = null;
  let notasNovasQtd = 0;
  try {
    ({notasExistentes} = await _dividirChunksNotasRetornadasGrandesDemaisSeNecessario(colChunks, colNotas, notasExistentes));
    const chavesExistentes = new Set(notasExistentes.map(n => n.chave));
    const notasNovas = notas.filter(n => !chavesExistentes.has(n.chave));
    notasNovasQtd = notasNovas.length;

    const agora = new Date().toISOString();
    const contagemPorChunk = new Map();
    notasExistentes.forEach(n => contagemPorChunk.set(n.chunkIndex, (contagemPorChunk.get(n.chunkIndex) || 0) + 1));
    let chunkAtual = notasExistentes.length ? Math.max(...notasExistentes.map(n => n.chunkIndex != null ? n.chunkIndex : 0)) : 0;
    let espacoNoChunkAtual = TAMANHO_CHUNK_NOTAS_RETORNADAS - (contagemPorChunk.get(chunkAtual) || 0);

    for (let i = 0; i < notasNovas.length; i += 300) {
      const lote = notasNovas.slice(i, i + 300);
      const batchIndividual = db.batch();
      const porChunkNesseLote = new Map();
      lote.forEach(n => {
        if (espacoNoChunkAtual <= 0) { chunkAtual++; espacoNoChunkAtual = TAMANHO_CHUNK_NOTAS_RETORNADAS; }
        espacoNoChunkAtual--;
        const payloadCompleto = {
          chave: n.chave, numeroNota: n.numeroNota, serie: n.serie, volumes: null, destinatario: n.destinatario || '',
          dataEmissao: n.dataEmissao || '', transportadora: '', arquivoOrigem: 'notas_fiscais_jacson.json',
          valorTotal: Number(n.valorTotal) || 0, cfop: n.cfop || '', naturezaLabel: 'Venda', tipoOperacao: 'SAIDA',
          destinatarioCnpj: '', notaOriginalChave: null, notaOriginalNumero: null, informacoesComplementares: '',
          itens: n.itens || [], pareceDevolucao: false, origemImportacao: 'BI',
          vendedorNome: n.vendedorNome || '', vendedorEmail: '', supervisorNome: n.supervisorNome || '', supervisorEmail: '',
          ativo: true, atualizadoEm: agora, chunkIndex: chunkAtual,
        };
        batchIndividual.set(colNotas.doc(n.chave), payloadCompleto, {merge: true});
        if (!porChunkNesseLote.has(chunkAtual)) porChunkNesseLote.set(chunkAtual, {});
        porChunkNesseLote.get(chunkAtual)[n.chave] = _notaRetornadaResumida(payloadCompleto);
      });
      await batchIndividual.commit();
      // Lê-modifica-grava por chunk (ver _lerEGravarChunkNotasRetornadas)
      // — nunca mais merge cego com "notas.CHAVE", que é a causa raiz do
      // bug real de hoje.
      for (const [idx, mapaResumidas] of porChunkNesseLote) {
        await _lerEGravarChunkNotasRetornadas(colChunks, idx, notasAtuais => Object.assign(notasAtuais, mapaResumidas));
      }
    }
  } catch (e) {
    erroAoGravar = e;
  }

  let removidas = 0;
  if (notas.length) {
    const chavesAbertasAgora = new Set(notas.map(n => n.chave));
    const chavesComRecebimento = new Set(recusasSnap.docs.flatMap(d => (d.data() || {}).chaves || []));
    const paraRemover = notasExistentes.filter(n => n.origemImportacao === 'BI' && n.naturezaLabel === 'Venda' && !chavesAbertasAgora.has(n.chave) && !chavesComRecebimento.has(n.chave));
    for (let i = 0; i < paraRemover.length; i += 300) {
      const lote = paraRemover.slice(i, i + 300);
      const batchIndividual = db.batch();
      const porChunkNesseLote = new Map();
      lote.forEach(n => {
        batchIndividual.delete(colNotas.doc(n.chave));
        if (!porChunkNesseLote.has(n.chunkIndex)) porChunkNesseLote.set(n.chunkIndex, []);
        porChunkNesseLote.get(n.chunkIndex).push(n.chave);
      });
      await batchIndividual.commit();
      for (const [idx, chaves] of porChunkNesseLote) {
        await _lerEGravarChunkNotasRetornadas(colChunks, idx, notasAtuais => chaves.forEach(c => delete notasAtuais[c]));
      }
    }
    removidas = paraRemover.length;
  }
  // A limpeza já rodou (mesmo com erro ao gravar/dividir) — agora sim
  // relata a falha, pra continuar aparecendo no resumo de erros por loja.
  if (erroAoGravar) throw erroAoGravar;
  return {total: notas.length, novas: notasNovasQtd, removidas};
}

// PEDIDO AO VIVO (2026-09-11): "vou sair de férias... se ninguém entrar no
// site vai atualizar?" — Devoluções (BI) (100-consulta-notas-fiscais.js) só
// girava com alguém com AQUELA aba aberta (setInterval de 30min, cliente).
// Duplica aqui de propósito a mesma lógica já validada em produção do lado
// do cliente (_importarDevolucoesBiRegistros/_agruparDevolucoesBiPorChave/
// classificarMotivoTexto/_construirRecebimentoAutomatico em 100-consulta-
// notas-fiscais.js) — se a lógica de classificação de motivo mudar de um
// lado, replicar a mudança no outro. Mesmo padrão já usado acima pra Notas
// Retornadas (venda): passa a rodar dentro do sync agendado de 30min do
// servidor, sem depender de navegador nenhum aberto — o botão "Buscar"
// manual da tela continua existindo, só deixa de ser a única forma de a
// devolução se manter em dia.
const CATEGORIAS_MOTIVO_DEVOLUCAO_BI = [
  ['Troca', /\bTROCA/],
  ['Impróprio para consumo/venda', /IMPROPRI/],
  ['Avaria', /AVARI/],
  ['Falta na carga/entrega', /FALTA|FALTOU/],
  ['Produto errado/divergente', /ERRAD|DIVERGEN/],
  ['Vencido/vencimento', /VENCID|VENC:/],
  ['Desacordo com pedido', /DESACORDO/],
];
const SEM_MOTIVO_NO_TEXTO_BI = '(sem motivo no texto)';
const CATEGORIAS_MOTIVO_PRECISAM_COLETOR_BI = new Set(['Troca', 'Avaria', 'Vencido/vencimento', 'Impróprio para consumo/venda', SEM_MOTIVO_NO_TEXTO_BI]);
function _classificarMotivoTextoBi(texto) {
  const t = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [nome, regex] of CATEGORIAS_MOTIVO_DEVOLUCAO_BI) if (regex.test(t)) return nome;
  return SEM_MOTIVO_NO_TEXTO_BI;
}
function _motivoDispensaColetorBi(informacoesComplementares) {
  if (!informacoesComplementares) return false;
  return !CATEGORIAS_MOTIVO_PRECISAM_COLETOR_BI.has(_classificarMotivoTextoBi(informacoesComplementares));
}
function _extrairRedeBi(destinatario) {
  const s = String(destinatario || '').trim();
  const idx = s.indexOf(' - ');
  return (idx > -1 ? s.slice(0, idx) : s).trim();
}
function _agruparDevolucoesBiPorChaveServidor(itens) {
  const porChave = new Map();
  itens.forEach(it => {
    const chave = String(it.chave || '').trim();
    if (!chave) return;
    if (!porChave.has(chave)) {
      porChave.set(chave, {
        chave, numeroNota: it.nf_numero != null ? String(it.nf_numero) : '', serie: it.nf_serie != null ? String(it.nf_serie) : '',
        destinatario: it.cliente || '', dataEmissao: String(it.data_emissao || '').slice(0, 10), cfop: it.cfop || '',
        valorTotal: 0, informacoesComplementares: '', itens: [],
      });
    }
    const nota = porChave.get(chave);
    if (!nota.numeroNota && it.nf_numero != null) nota.numeroNota = String(it.nf_numero);
    if (!nota.serie && it.nf_serie != null) nota.serie = String(it.nf_serie);
    if (!nota.destinatario && it.cliente) nota.destinatario = it.cliente;
    if (!nota.dataEmissao && it.data_emissao) nota.dataEmissao = String(it.data_emissao).slice(0, 10);
    if (!nota.cfop && it.cfop) nota.cfop = it.cfop;
    nota.valorTotal += Number(it.valor_nota) || 0;
    const gtinItem = it.ean != null ? String(it.ean) : '';
    const dunItem = it.dum != null ? String(it.dum) : '';
    nota.itens.push({produtoKey: it.produto_key ?? null, descricao: it.produto || '', quantidade: Number(it.quantidade_faturada) || 0, gtin: gtinItem, dun: dunItem, ncm: ''});
    if (!nota.informacoesComplementares && it.mensagem) nota.informacoesComplementares = String(it.mensagem);
  });
  return [...porChave.values()];
}
function _construirRecebimentoAutomaticoBi(nota) {
  if (!_motivoDispensaColetorBi(nota.informacoesComplementares)) return null;
  const categoria = _classificarMotivoTextoBi(nota.informacoesComplementares);
  const agora = new Date().toISOString();
  return {
    chaves: [nota.chave],
    notas: [{chave: nota.chave, numeroNota: nota.numeroNota, dataEmissao: nota.dataEmissao || '', volumeEsperado: 0, destinatario: nota.destinatario || '', valorTotal: Number(nota.valorTotal) || 0, itens: nota.itens || []}],
    motoristaId: '', motoristaNome: '', motivoId: '', motivoNome: categoria,
    conferenteId: '', conferenteNome: '',
    volumeEsperado: 0, volumeInformado: 0, diferencaVolumes: 0, conferenciaStatus: 'CONFERIDO',
    box: '', pallets: null, statusConferenciaOperacional: 'CONFERIDA', itensConferidos: [],
    criadoEm: agora, criadoPorUid: '', criadoPorEmail: 'sincronizarBiAgendado',
    origem: 'AUTOMATICO', motivoAutomaticoTexto: nota.informacoesComplementares || '',
    dataEmissao: nota.dataEmissao || '', destinatario: nota.destinatario || '', rede: _extrairRedeBi(nota.destinatario), valorTotal: Number(nota.valorTotal) || 0,
  };
}
async function _sincronizarDevolucoesBiLoja(lojaId, lojaKey, registrosNotas) {
  const relevantes = (registrosNotas || []).filter(it => lojaKey != null && String(it.loja_key) === String(lojaKey) && String(it.tipo_movimento || '').toUpperCase() === 'DEVOLUCAO');
  const notas = _agruparDevolucoesBiPorChaveServidor(relevantes);
  const colRecusas = db.collection('lojas').doc(lojaId).collection('recebimento_recusas');
  const recusasSnap = await colRecusas.get();
  const chavesJaComRecebimento = new Map();
  recusasSnap.docs.forEach(d => {
    const data = d.data() || {};
    (data.chaves || []).forEach(c => chavesJaComRecebimento.set(c, {docId: d.id, dataEmissao: data.dataEmissao || '', destinatario: data.destinatario || ''}));
  });
  let autoSalvas = 0, descartadas = 0, corrigidas = 0;
  const patches = [];
  for (const nota of notas) {
    if (chavesJaComRecebimento.has(nota.chave)) {
      const existente = chavesJaComRecebimento.get(nota.chave);
      const patch = {};
      if (!existente.dataEmissao && nota.dataEmissao) patch.dataEmissao = nota.dataEmissao;
      if (!existente.destinatario && nota.destinatario) { patch.destinatario = nota.destinatario; patch.rede = _extrairRedeBi(nota.destinatario); }
      if (Object.keys(patch).length) { patches.push({docId: existente.docId, patch}); corrigidas++; }
    } else {
      const payloadAuto = _construirRecebimentoAutomaticoBi(nota);
      if (payloadAuto) {
        const ref = colRecusas.doc();
        const batchNovo = db.batch();
        batchNovo.set(ref, payloadAuto);
        await batchNovo.commit();
        chavesJaComRecebimento.set(nota.chave, {docId: ref.id, dataEmissao: nota.dataEmissao, destinatario: nota.destinatario});
        autoSalvas++;
      } else {
        descartadas++;
      }
    }
  }
  for (let i = 0; i < patches.length; i += 300) {
    const lote = patches.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(p => batch.set(colRecusas.doc(p.docId), p.patch, {merge: true}));
    await batch.commit();
  }
  return {total: notas.length, autoSalvas, descartadas, corrigidas};
}

async function _sincronizarBiTodasLojas() {
  const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
  const driveId = await _resolverDriveGraphApi(token);
  const [registrosFicha, registrosCompras, arquivoInsumos, arquivoProdutos, arquivoNotas] = await Promise.all([
    _lerArquivoBiGraphApi(token, driveId, 'ficha_tecnica.json'),
    _lerArquivoBiGraphApi(token, driveId, 'compras_a_receber.json'),
    _lerArquivoBiGraphApi(token, driveId, 'dados-insumos.json'),
    _lerArquivoBiGraphApi(token, driveId, 'produtos_estoque.json'),
    _lerArquivoBiGraphApi(token, driveId, 'notas_fiscais_jacson.json'),
  ]);
  const registrosInsumos = (arquivoInsumos && arquivoInsumos.produtos) || arquivoInsumos || [];
  const registrosProdutos = Array.isArray(arquivoProdutos) ? arquivoProdutos : ((arquivoProdutos && arquivoProdutos.produtos) || []);
  const registrosNotas = Array.isArray(arquivoNotas) ? arquivoNotas : ((arquivoNotas && arquivoNotas.registros) || []);
  const lojasSnap = await db.collection('lojas').get();
  const resultados = [];
  for (const doc of lojasSnap.docs) {
    const loja = Object.assign({id: doc.id}, doc.data());
    if (!loja.bluesoft_loja_key) continue;
    try {
      const ficha = await _sincronizarFichaTecnicaBiLoja(loja.id, loja.bluesoft_loja_key, registrosFicha);
      const agenda = await _sincronizarAgendaBiLoja(loja.id, loja, registrosCompras);
      const estoqueInsumos = await _sincronizarEstoqueInsumosBiLoja(loja.id, loja.bluesoft_loja_key, registrosInsumos);
      const estoqueProdutos = await _sincronizarEstoqueProdutoAcabadoBiLoja(loja.id, loja.bluesoft_loja_key, registrosProdutos);
      const historicoVendas = await _sincronizarHistoricoVendasBiLoja(loja.id, loja.bluesoft_loja_key, registrosNotas);
      const notasRetornadas = await _sincronizarNotasRetornadasVendaBiLoja(loja.id, loja.bluesoft_loja_key, registrosNotas);
      const devolucoesBi = await _sincronizarDevolucoesBiLoja(loja.id, loja.bluesoft_loja_key, registrosNotas);
      resultados.push({loja: loja.nome || loja.id, ficha, agenda, estoqueInsumos, estoqueProdutos, historicoVendas, notasRetornadas, devolucoesBi});
    } catch (e) {
      resultados.push({loja: loja.nome || loja.id, erro: e.message || String(e)});
      console.error('[SincronizacaoBiAgendado] Falha na loja', loja.id, e);
    }
  }
  console.log('[SincronizacaoBiAgendado] Resumo:', JSON.stringify(resultados));
  return resultados;
}

// BUG AO VIVO REAL (2026-08-27) — limpeza retroativa: as duas correções de
// contaminação acima (_sincronizarEstoqueProdutoAcabadoBiLoja e
// _sincronizarHistoricoVendasBiLoja) só impedem gravação NOVA — os docs
// contaminados que a versão anterior (sem guarda) já gravou continuam lá
// pra sempre, inflando o Dashboard do PCP, até serem apagados uma vez.
// Remove só doc com origem:'bi' (nunca origem:'bluesoft' — essa é a
// limpeza separada, ainda pendente, do dado antigo de verdade da Bluesoft)
// cujo cod não está cadastrado nesta loja (producao_produtos OU
// pcp_produtos_bluesoft — mesma união usada em
// _sincronizarEstoqueProdutoAcabadoBiLoja, corrigida depois que restringir
// só a producao_produtos excluía produto comprado de fornecedor). Roda só
// no gatilho MANUAL (sincronizarBiAgendadoAgora) — não no agendado de 30
// min, pra não repetir a varredura de limpeza pra sempre.
async function _limparEstoqueBiContaminadoLoja(lojaId) {
  const colEstoque = db.collection('lojas').doc(lojaId).collection('pcp_estoque_bluesoft');
  const [estoqueSnap, produtosSnap, produtosBluesoftSnap] = await Promise.all([
    colEstoque.get(),
    db.collection('lojas').doc(lojaId).collection('producao_produtos').get(),
    db.collection('lojas').doc(lojaId).collection('pcp_produtos_bluesoft').get(),
  ]);
  const codsRegistrados = new Set([
    ...produtosSnap.docs.map(d => String((d.data() || {}).cod || '')),
    ...produtosBluesoftSnap.docs.map(d => String((d.data() || {}).cod || '')),
  ].filter(Boolean));
  const contaminados = estoqueSnap.docs.filter(d => {
    const x = d.data() || {};
    return x.origem === 'bi' && x.cod != null && !codsRegistrados.has(String(x.cod));
  });
  let removidos = 0;
  for (let i = 0; i < contaminados.length; i += 300) {
    const lote = contaminados.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(d => batch.delete(colEstoque.doc(d.id)));
    await batch.commit();
    removidos += lote.length;
  }
  return {verificados: estoqueSnap.docs.length, removidos};
}
async function _limparEstoqueBiContaminadoTodasLojas() {
  const lojasSnap = await db.collection('lojas').get();
  const resultados = [];
  for (const doc of lojasSnap.docs) {
    const loja = Object.assign({id: doc.id}, doc.data());
    if (!loja.bluesoft_loja_key) continue;
    try {
      const limpeza = await _limparEstoqueBiContaminadoLoja(loja.id);
      resultados.push({loja: loja.nome || loja.id, limpeza});
    } catch (e) {
      resultados.push({loja: loja.nome || loja.id, erro: e.message || String(e)});
    }
  }
  return resultados;
}

// PEDIDO AO VIVO (2026-08-27): "vou apagar todo o banco... só estoque,
// pedido antigo da Bluesoft, não é pra apagar configurações nem nada do
// tipo" — dado (não cadastro) que ainda tem origem:'bluesoft' de verdade,
// de antes de tudo isso existir. `pcp_estoque_bluesoft` é só sincronização,
// sem nada manual — remove tudo com origem:'bluesoft'. `pcp_pedidos` e
// `pcp_agendamentos` são coleções MISTAS (pedido/agendamento manual da
// equipe convive com o que a Bluesoft sincronizava) — `salvarPedido()`/
// `salvarAgendamento()` (78-pcp-central.js) nunca gravam campo `origem`,
// então filtrar por origem==='bluesoft' nunca toca no que foi criado à
// mão. `pcp_produtos_bluesoft` (cadastro fino: categoria/tipo/fator de
// caixa) fica de fora de propósito — não é estoque nem pedido, é cadastro,
// e não tem substituto no SharePoint ainda.
async function _limparDadosAntigosBluesoftLoja(lojaId) {
  const colEstoque = db.collection('lojas').doc(lojaId).collection('pcp_estoque_bluesoft');
  const colPedidos = db.collection('lojas').doc(lojaId).collection('pcp_pedidos');
  const colAgendamentos = db.collection('lojas').doc(lojaId).collection('pcp_agendamentos');
  async function limparColecao(col) {
    const snap = await col.get();
    const alvos = snap.docs.filter(d => (d.data() || {}).origem === 'bluesoft');
    let removidos = 0;
    for (let i = 0; i < alvos.length; i += 300) {
      const lote = alvos.slice(i, i + 300);
      const batch = db.batch();
      lote.forEach(d => batch.delete(col.doc(d.id)));
      await batch.commit();
      removidos += lote.length;
    }
    return {verificados: snap.docs.length, removidos};
  }
  const [estoque, pedidos, agendamentos] = await Promise.all([
    limparColecao(colEstoque), limparColecao(colPedidos), limparColecao(colAgendamentos),
  ]);
  return {estoque, pedidos, agendamentos};
}
async function _limparDadosAntigosBluesoftTodasLojas() {
  const lojasSnap = await db.collection('lojas').get();
  const resultados = [];
  for (const doc of lojasSnap.docs) {
    const loja = Object.assign({id: doc.id}, doc.data());
    if (!loja.bluesoft_loja_key) continue;
    try {
      const limpeza = await _limparDadosAntigosBluesoftLoja(loja.id);
      resultados.push({loja: loja.nome || loja.id, limpeza});
    } catch (e) {
      resultados.push({loja: loja.nome || loja.id, erro: e.message || String(e)});
    }
  }
  return resultados;
}

exports.sincronizarBiAgendado = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 540, memory: '1GB'})
  .pubsub.schedule('every 30 minutes')
  .onRun(async () => { await _sincronizarBiTodasLojas(); return null; });

// Gatilho manual (callable) — pra testar sem esperar o próximo horário
// agendado, mesma checagem de permissão do resto.
exports.sincronizarBiAgendadoAgora = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 540, memory: '1GB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    if (!administrador(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa sincronização.');
    }
    const limpeza = await _limparEstoqueBiContaminadoTodasLojas();
    const resultados = await _sincronizarBiTodasLojas();
    return {ok: true, resultados, limpeza};
  });

// Ação separada e explícita (não roda junto do "Atualizar" de rotina) —
// pedido ao vivo do usuário pra apagar, uma vez, o estoque/pedido/
// agendamento que ainda tem origem:'bluesoft' de verdade, agora que
// insumo, produto acabado, pedido de venda e agenda já vêm do SharePoint.
// Botão em Produção → Importação/Exportação → "Limpeza de dados antigos".
exports.limparDadosAntigosBluesoftAgora = functions
  .region('southamerica-east1')
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    if (!administrador(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa limpeza.');
    }
    const resultados = await _limparDadosAntigosBluesoftTodasLojas();
    return {ok: true, resultados};
  });

// ─────────────────────────────────────────────────────────────────────────
// Relatórios BI grandes (Compras/PCP/Produção) — gravação em pacotes
// PEDIDO AO VIVO (2026-08-27): "quero gravar mais só os dados desse ano
// pra frente" + "que seja por chunks aí pra não gerar tanta leitura" — os
// relatórios de 101-relatorios-bi.js eram só leitura direta do BI (sem
// gravar nada); agora passam a gravar no Firestore em PACOTES de até
// TAMANHO_CHUNK_RELATORIOS registros por documento (mesma ideia de
// recebimento_recusas_notas_chunks), pra quem abrir a tela depois já ver
// os dados sem precisar clicar em Buscar de novo. Coleção GLOBAL (não por
// loja) — a tela hoje mostra todas as lojas juntas, sem filtro de loja.
// Registro histórico (nota fiscal já emitida) nunca muda depois de
// lançado — só pula quem já existe, nunca reconcilia/apaga (diferente do
// ledger de venda, que representa "em aberto"; aqui é log permanente).
// Mesmo risco do TAMANHO_CHUNK_NOTAS_RETORNADAS acima (contagem fixa sem
// olhar bytes reais) — reduzido preventivamente pela mesma razão, mesmo
// sem ter falhado ainda aqui.
const TAMANHO_CHUNK_RELATORIOS = 400;

async function _sincronizarRelatorioBiChunkeadoGlobal(nomeColecaoChunks, registrosFiltrados, chaveFn, slimFn) {
  const colChunks = db.collection(nomeColecaoChunks);
  const chunksSnap = await colChunks.get();
  const chavesExistentes = new Set();
  const contagemPorChunk = new Map();
  chunksSnap.docs.forEach(doc => {
    const idx = Number(String(doc.id).replace('chunk_', '')) || 0;
    const registrosDoc = (doc.data() || {}).registros || {};
    const chaves = Object.keys(registrosDoc);
    contagemPorChunk.set(idx, chaves.length);
    chaves.forEach(k => chavesExistentes.add(k));
  });

  const novos = registrosFiltrados.filter(r => !chavesExistentes.has(String(chaveFn(r))));
  let chunkAtual = contagemPorChunk.size ? Math.max(...contagemPorChunk.keys()) : 0;
  let espaco = TAMANHO_CHUNK_RELATORIOS - (contagemPorChunk.get(chunkAtual) || 0);

  for (let i = 0; i < novos.length; i += 300) {
    const lote = novos.slice(i, i + 300);
    const porChunkNesseLote = new Map();
    lote.forEach(r => {
      if (espaco <= 0) { chunkAtual++; espaco = TAMANHO_CHUNK_RELATORIOS; }
      espaco--;
      const chave = String(chaveFn(r));
      if (!porChunkNesseLote.has(chunkAtual)) porChunkNesseLote.set(chunkAtual, {});
      porChunkNesseLote.get(chunkAtual)['registros.' + chave] = slimFn(r);
    });
    const batch = db.batch();
    porChunkNesseLote.forEach((campos, idx) => batch.set(colChunks.doc('chunk_' + idx), campos, {merge: true}));
    await batch.commit();
  }
  return {totalFiltrados: registrosFiltrados.length, novos: novos.length, jaExistiam: registrosFiltrados.length - novos.length};
}

const ANO_MINIMO_RELATORIOS_BI = '2026'; // "quero gravar mais só os dados desse ano pra frente"

// PEDIDO AO VIVO (2026-08-27): "aproveita que o histórico é grande, grava
// todos os produtos... qual é o setor deles, que alguns eu vou pedir pra
// deixar fora, tipo manutenção, patrimônio, marketing, resíduos... não
// quero que apareça visualmente, só gravar" — o histórico completo de
// compras (compras_produto.json TODOS os anos, não só 2026+ que a tela usa)
// traz Departamento/Grupo/Seção por produto, dado que nenhuma tela usa
// hoje. Gravado numa coleção própria e silenciosa — não é lida por
// 101-relatorios-bi.js nem por nenhuma tela; só existe pra decidir depois
// quais departamentos ficam de fora das telas de Compras. Roda dentro do
// mesmo sync que já busca o arquivo (a cada 4h) — sem fetch extra, sem
// mudar uma vírgula do que a tela "Histórico de Compras" mostra. Mantém
// sempre a classificação mais recente por produto — reprocessa a cada
// sync (não é uma gravação de uma vez só e nunca mais), o que é desejável:
// produto pode mudar de departamento com o tempo.
function _construirClassificacaoProdutosComprasBi(registros) {
  const porProduto = new Map();
  registros.forEach(r => {
    if (r.produto_key == null) return;
    const chave = String(r.produto_key);
    const emissao = String(r.data_emissao || '');
    const atual = porProduto.get(chave);
    if (atual && atual._emissao >= emissao) return;
    porProduto.set(chave, {
      produtoKey: chave, descricao: r.descricao || '',
      grupo: r.grupo || '', departamento: r.Departamento || '', secao: r.Secao || '',
      _emissao: emissao,
    });
  });
  return [...porProduto.values()].map(({_emissao, ...resto}) => resto);
}

async function _gravarClassificacaoProdutosComprasBi(lista) {
  const col = db.collection('bi_classificacao_produtos');
  const agora = new Date().toISOString();
  let gravados = 0;
  for (let i = 0; i < lista.length; i += 300) {
    const lote = lista.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(item => { batch.set(col.doc(_idSeguro(item.produtoKey)), Object.assign({}, item, {atualizadoEm: agora}), {merge: true}); gravados++; });
    await batch.commit();
  }
  return {totalProdutos: lista.length, gravados};
}

async function _sincronizarComprasHistoricoBi(registros) {
  const classificacaoProdutos = await _gravarClassificacaoProdutosComprasBi(_construirClassificacaoProdutosComprasBi(registros));
  const filtrados = registros.filter(r => String(r.data_emissao || '').slice(0, 4) >= ANO_MINIMO_RELATORIOS_BI);
  const resultado = await _sincronizarRelatorioBiChunkeadoGlobal(
    'relatorios_bi_compras_historico_chunks',
    filtrados,
    r => r.nota_fiscal_item_key,
    // PEDIDO AO VIVO (2026-08-27): "MRO sai fora, logística sai fora, e o
    // compras eu quero, mas com a seção... e o que é transferência da
    // matriz pra filial, crie um campo Em Trânsito" — departamento/grupo/
    // seção e o tipo de operação (COMPRA/TRANSFERENCIA/BONIFICAÇÃO/OUTROS)
    // precisam estar na linha pra tela filtrar e rotular "Em Trânsito".
    // Registro histórico não é reconciliado (dedupe por nota_fiscal_item_key
    // nunca reescreve quem já existe) — linha já sincronizada ANTES desta
    // mudança fica sem esses campos até a coleção ser reconstruída.
    r => ({
      chave: String(r.nota_fiscal_item_key), loja_key: r.loja_key, data_emissao: r.data_emissao, data_recebimento: r.data_recebimento,
      nf_numero: r.nf_numero, produto_key: r.produto_key, descricao: r.descricao, quantidade_faturada: r.quantidade_faturada,
      nome_abreviado: r.nome_abreviado, custo_liq_unit: r.custo_liq_unit, Custo_liquido_total: r.Custo_liquido_total, comprador_nome: r.comprador_nome,
      departamento: r.Departamento || '', grupo: r.grupo || '', secao: r.Secao || '', tipo_operacao: r.TIPO_OPERACAO || '',
    })
  );
  return Object.assign({}, resultado, {classificacaoProdutos});
}

// BUG AO VIVO REAL (2026-09-06): "não vem inventar coisa não, lá não
// carregava era nada" — logs reais (firebase functions:log) mostraram a
// função crashando por estouro de heap (V8 "allocation failure; scavenge
// might not succeed" perto de 830MB, seguido de crash do processo) ao
// processar compras_produto.json (89,7MB). Isso significa que o sync
// provavelmente NUNCA terminou com sucesso — relatorios_bi_compras_
// historico_chunks nunca chegou a ser gravado, por isso a tela de
// Dashboard não mostrava nem dado novo nem antigo. memory subido de 1GB
// pra 2GB (arquivo é o maior de todos os BIs sincronizados hoje; JSON
// parseado + Map de classificação + Set de chaves existentes juntos
// passam do limite anterior).
exports.sincronizarComprasHistoricoBiAgendado = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 540, memory: '2GB'})
  .pubsub.schedule('every 4 hours')
  .onRun(async () => {
    const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
    const driveId = await _resolverDriveGraphApi(token);
    const registros = await _lerArquivoBiGraphApi(token, driveId, 'compras_produto.json');
    const resultado = await _sincronizarComprasHistoricoBi(registros);
    console.log('[ComprasHistoricoBiAgendado] Resumo:', JSON.stringify(resultado));
    return null;
  });

exports.sincronizarComprasHistoricoBiAgora = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 540, memory: '2GB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    if (!administrador(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa sincronização.');
    }
    const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
    const driveId = await _resolverDriveGraphApi(token);
    const registros = await _lerArquivoBiGraphApi(token, driveId, 'compras_produto.json');
    const resultado = await _sincronizarComprasHistoricoBi(registros);
    return {ok: true, resultado};
  });

// PEDIDO AO VIVO (2026-08-28): "ranking de fornecedores que você não
// aplicou lá no Compras" — fornecedores_agregado.json (6MB, mas só ~600
// fornecedores por categoria/ano — pequeno o bastante pra 1 doc por
// categoria+ano, sem precisar de chunking) passa a ser gravado global,
// pra tela real de Fornecedores do Compras (121-compras-profissional.js)
// ler sem precisar buscar o arquivo toda vez.
async function _sincronizarFornecedoresAgregadoBi(dados) {
  const categorias = [['materia_prima', dados && dados.materia_prima], ['produto_acabado', dados && dados.produto_acabado]];
  const agora = new Date().toISOString();
  const batch = db.batch();
  let gravados = 0;
  categorias.forEach(([categoria, bloco]) => {
    if (!bloco || !bloco.anoData) return;
    Object.keys(bloco.anoData).forEach(ano => {
      const top = (bloco.anoData[ano] || {}).top || [];
      batch.set(db.collection('bi_fornecedores_agregado').doc(categoria + '_' + ano), {categoria, ano, top, atualizadoEm: agora}, {merge: true});
      gravados++;
    });
  });
  await batch.commit();
  return {gravados};
}

exports.sincronizarFornecedoresAgregadoBiAgendado = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 300, memory: '512MB'})
  .pubsub.schedule('every 4 hours')
  .onRun(async () => {
    const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
    const driveId = await _resolverDriveGraphApi(token);
    const dados = await _lerArquivoBiGraphApi(token, driveId, 'fornecedores_agregado.json');
    const resultado = await _sincronizarFornecedoresAgregadoBi(dados);
    console.log('[FornecedoresAgregadoBiAgendado] Resumo:', JSON.stringify(resultado));
    return null;
  });

exports.sincronizarFornecedoresAgregadoBiAgora = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 300, memory: '512MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    if (!administrador(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa sincronização.');
    }
    const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
    const driveId = await _resolverDriveGraphApi(token);
    const dados = await _lerArquivoBiGraphApi(token, driveId, 'fornecedores_agregado.json');
    const resultado = await _sincronizarFornecedoresAgregadoBi(dados);
    return {ok: true, resultado};
  });

// PEDIDO AO VIVO (2026-08-28): "a quantidade que usa de cada insumo, você
// não aplicou" — dados-consumo-insumos.json (resumo mensal, 452 linhas
// loja×sku) somado por sku (perde granularidade por loja de propósito —
// o pedido foi "quanto usa de cada insumo", uma visão por produto).
function _construirConsumoInsumosResumoBi(dados) {
  const registros = (dados && dados.produtos) || [];
  const porSku = new Map();
  registros.forEach(r => {
    if (r.sku == null) return;
    const chave = String(r.sku);
    const atual = porSku.get(chave) || {sku: chave, produto: r.produto || '', categoria: r.categoria || '', tipo: r.tipo || '', mediaMensal: 0, totalPeriodo: 0};
    atual.mediaMensal += Number(r.mediaMensal) || 0;
    atual.totalPeriodo += Number(r.totalPeriodo) || 0;
    porSku.set(chave, atual);
  });
  return [...porSku.values()];
}

async function _gravarConsumoInsumosResumoBi(lista) {
  const col = db.collection('bi_consumo_insumos_resumo');
  const agora = new Date().toISOString();
  let gravados = 0;
  for (let i = 0; i < lista.length; i += 300) {
    const lote = lista.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(item => { batch.set(col.doc(_idSeguro(item.sku)), Object.assign({}, item, {atualizadoEm: agora}), {merge: true}); gravados++; });
    await batch.commit();
  }
  return {totalInsumos: lista.length, gravados};
}

exports.sincronizarConsumoInsumosResumoBiAgendado = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 300, memory: '512MB'})
  .pubsub.schedule('every 4 hours')
  .onRun(async () => {
    const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
    const driveId = await _resolverDriveGraphApi(token);
    const dados = await _lerArquivoBiGraphApi(token, driveId, 'dados-consumo-insumos.json');
    const resultado = await _gravarConsumoInsumosResumoBi(_construirConsumoInsumosResumoBi(dados));
    console.log('[ConsumoInsumosResumoBiAgendado] Resumo:', JSON.stringify(resultado));
    return null;
  });

exports.sincronizarConsumoInsumosResumoBiAgora = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 300, memory: '512MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    if (!administrador(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa sincronização.');
    }
    const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
    const driveId = await _resolverDriveGraphApi(token);
    const dados = await _lerArquivoBiGraphApi(token, driveId, 'dados-consumo-insumos.json');
    const resultado = await _gravarConsumoInsumosResumoBi(_construirConsumoInsumosResumoBi(dados));
    return {ok: true, resultado};
  });

// PEDIDO AO VIVO (2026-08-28): "eu quero uma aba de cortes... só puxe o
// total, não puxe tudo... vai juntar, vai compilar, e vai somar o que
// aconteceu, vai colocar por mês, por produtos" — dados_cortes.json
// (53.515 linhas) nunca é mostrado cru; agregado por mês+produto (poucas
// centenas de combinações) e gravado 1 doc por mês, cada um com a lista de
// produtos daquele mês (não chunk por causa de tamanho, e sim porque cada
// consulta real é "me dá um mês" — ideal já vir separado por doc).
function _construirCortesResumoMensalBi(registros) {
  const porChave = new Map();
  (registros || []).forEach(r => {
    if (!r.data || r.produto_key == null) return;
    const mes = String(r.data).slice(0, 7);
    const produtoKey = String(r.produto_key);
    const chave = mes + '_' + produtoKey;
    const atual = porChave.get(chave) || {mes, produtoKey, descricao: r.descricao || '', quantidadePedidaCx: 0, quantidadeFaturadaCx: 0, corteRoteiroCx: 0, valorPedidoTotal: 0, faturamentoRs: 0};
    atual.quantidadePedidaCx += Number(r.quantidadePedidaCx) || 0;
    atual.quantidadeFaturadaCx += Number(r.quantidadeFaturadaCx) || 0;
    atual.corteRoteiroCx += Number(r.corteRoteiroCx) || 0;
    atual.valorPedidoTotal += Number(r.valorPedidoTotal) || 0;
    atual.faturamentoRs += Number(r.faturamentoRs) || 0;
    porChave.set(chave, atual);
  });
  return [...porChave.values()];
}

async function _gravarCortesResumoMensalBi(itens) {
  const porMes = new Map();
  itens.forEach(item => { const arr = porMes.get(item.mes) || []; arr.push(item); porMes.set(item.mes, arr); });
  const col = db.collection('bi_cortes_mensal');
  const agora = new Date().toISOString();
  const meses = [...porMes.keys()];
  for (let i = 0; i < meses.length; i += 300) {
    const lote = meses.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(mes => batch.set(col.doc(mes), {mes, itens: porMes.get(mes), atualizadoEm: agora}));
    await batch.commit();
  }
  return {totalMeses: meses.length, totalItens: itens.length};
}

exports.sincronizarCortesMensalBiAgendado = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 300, memory: '1GB'})
  .pubsub.schedule('every 4 hours')
  .onRun(async () => {
    const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
    const driveId = await _resolverDriveGraphApi(token);
    const registros = await _lerArquivoBiGraphApi(token, driveId, 'dados_cortes.json');
    const resultado = await _gravarCortesResumoMensalBi(_construirCortesResumoMensalBi(registros));
    console.log('[CortesMensalBiAgendado] Resumo:', JSON.stringify(resultado));
    return null;
  });

exports.sincronizarCortesMensalBiAgora = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 300, memory: '1GB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    if (!administrador(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa sincronização.');
    }
    const token = await _obterTokenGraphApi(process.env.GRAPH_CLIENT_SECRET);
    const driveId = await _resolverDriveGraphApi(token);
    const registros = await _lerArquivoBiGraphApi(token, driveId, 'dados_cortes.json');
    const resultado = await _gravarCortesResumoMensalBi(_construirCortesResumoMensalBi(registros));
    return {ok: true, resultado};
  });

// PEDIDO AO VIVO (2026-09-11, Fase 2 do espelho BigQuery — ver
// bq-recebimento-recusas em extensions/): Indicadores de Retornos
// (98-recebimento-retornos-indicadores.js) baixava recebimento_recusas
// inteiro do período pro NAVEGADOR calcular tudo (rankings, filtro
// cruzado, checkboxes) — funciona bem hoje com poucos documentos, mas é
// exatamente o padrão que fica lento conforme a coleção cresce (mesma
// causa raiz investigada com o usuário: "por que a Bluesoft não demora e
// aqui demora" — lá quem agrega é o SERVIDOR, aqui era sempre o
// navegador). Esta função devolve os MESMOS documentos crus (mesmo
// formato de {_id, ...dados}) que o Firestore já devolvia — o
// agrupamento/filtro cruzado/checkboxes do lado cliente continuam
// EXATAMENTE iguais, só a origem da busca muda. Lê da view
// "_raw_latest" da extensão (já resolve create/update/delete pro estado
// mais recente por documento) — nunca a coleção Firestore direto, que é
// justamente o gargalo que se quer evitar pra período grande.
function _lojaPermitidaParaAcesso(acesso, lojaId) {
  if (adminMestre(acesso) || acesso?.acesso_todas_lojas === true) return true;
  return lojasPermitidas(acesso).has(String(lojaId));
}
let _bigQueryClienteSingleton = null;
function _obterBigQueryCliente() {
  if (!_bigQueryClienteSingleton) _bigQueryClienteSingleton = new BigQuery({projectId: 'daterrinha-inventario'});
  return _bigQueryClienteSingleton;
}
async function _buscarIndicadoresRetornosBigQueryInterno(data, acesso, bigqueryClient) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  const ini = textoSeguro(data?.ini, 10);
  const fim = textoSeguro(data?.fim, 10);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    throw new functions.https.HttpsError('invalid-argument', 'Período inválido — use o formato AAAA-MM-DD.');
  }
  const dIni = new Date(ini + 'T00:00:00'), dFim = new Date(fim + 'T23:59:59');
  if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime()) || dIni > dFim || (dFim - dIni) / 86400000 > 731) {
    throw new functions.https.HttpsError('invalid-argument', 'Escolha um período válido de até 2 anos.');
  }
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) {
    throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  }
  const query = `
    SELECT document_id, data
    FROM \`daterrinha-inventario.dt_relatorios.recebimento_recusas_raw_latest\`
    WHERE operation != 'DELETE'
      AND JSON_EXTRACT_SCALAR(path_params, '$.lojaId') = @lojaId
      AND JSON_EXTRACT_SCALAR(data, '$.criadoEm') >= @inicioIso
      AND JSON_EXTRACT_SCALAR(data, '$.criadoEm') <= @fimIso
      AND IFNULL(JSON_EXTRACT_SCALAR(data, '$.origem'), '') != 'AUTOMATICO'
      AND JSON_EXTRACT_SCALAR(data, '$.motivoAutomaticoTexto') IS NULL
  `;
  const [rows] = await bigqueryClient.query({
    query,
    params: {lojaId, inicioIso: ini + 'T00:00:00.000Z', fimIso: fim + 'T23:59:59.999Z'},
  });
  return rows.map(r => Object.assign({_id: r.document_id}, JSON.parse(r.data)));
}
// PEDIDO AO VIVO (2026-09-11): "1 a 3 segundos pra mim tá perfeito" —
// minInstances:1 mantém 1 instância desta função sempre de prontidão,
// eliminando o "cold start" (2-5s extras de carregar a biblioteca pesada
// do BigQuery do zero) — sobra só o pedágio inerente do próprio BigQuery
// (job de consulta, não encolhe mesmo com pouco dado). Custo fixo pequeno
// e contínuo no Google (a instância fica de pé mesmo sem uso), aceito
// explicitamente pelo usuário em troca de latência previsível.
exports.buscarIndicadoresRetornosBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB', minInstances: 1})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const recusas = await _buscarIndicadoresRetornosBigQueryInterno(data, acesso, _obterBigQueryCliente());
    return {ok: true, recusas};
  });

// PEDIDO AO VIVO (2026-09-11): "a parte do Analista pode puxar do BigQuery,
// 1 a 5 minutos de atraso não tem problema" — Pátio em Tempo Real
// (105-recebimento-patio-tempo-real.js) busca por statusFisico=NO_PATIO,
// não por período — filtro diferente do de Indicadores/Notas Retornadas/
// Status, por isso é uma função separada (mesma view "_raw_latest",
// mesmo formato de retorno {_id, ...dados}).
async function _consultarPatioTempoRealBigQuery(lojaId, bigqueryClient) {
  const query = `
    SELECT document_id, data
    FROM \`daterrinha-inventario.dt_relatorios.recebimento_recusas_raw_latest\`
    WHERE operation != 'DELETE'
      AND JSON_EXTRACT_SCALAR(path_params, '$.lojaId') = @lojaId
      AND JSON_EXTRACT_SCALAR(data, '$.statusFisico') = 'NO_PATIO'
  `;
  const [rows] = await bigqueryClient.query({query, params: {lojaId}});
  return rows.map(r => Object.assign({_id: r.document_id}, JSON.parse(r.data)));
}
async function _buscarPatioTempoRealBigQueryInterno(data, acesso, bigqueryClient) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) {
    throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  }
  return _consultarPatioTempoRealBigQuery(lojaId, bigqueryClient);
}
// PEDIDO AO VIVO (2026-09-11): "clico demora muito para carregar" — mesmo
// com minInstances:1 (sem cold start), o próprio BigQuery tem um piso de
// 1-3s por consulta que não dá pra encolher mais. Confirmado direto no log
// do servidor (Function execution took ~1200-1600ms) — não era bug de
// código, era o pedágio inerente de "consultar o BigQuery na hora do
// clique". Em vez de cada clique de cada Analista disparar sua própria
// consulta, um job agendado (a cada 2 minutos) já deixa o resultado PRONTO
// — flatten por nota + enriquecido (mercado/vendedor/valor) — guardado em
// `lojas/{lojaId}/recebimento_patio_cache/atual`. A tela passa a fazer só
// uma LEITURA de Firestore desse documento (bem abaixo de 1s), igual toda
// outra tela do app — sem chamar Cloud Function nem BigQuery no clique.
// Mesma tolerância de atraso (1-5min) que o usuário já aceitou pra essa
// tela; o job roda bem mais rápido que isso (2min), então na prática fica
// sempre bem mais fresco que o mínimo aceito.
function _estaNoPatioParaCache(doc, nota) {
  if (doc.origem !== 'COLETOR' && doc.origem !== 'INVENTARIO_INICIAL') return false;
  const tratamento = nota.tratamento != null ? nota.tratamento : (doc.tratamento || '');
  if (tratamento === 'REENTREGA') {
    const saida = nota.dataSaidaEm != null ? nota.dataSaidaEm : doc.dataSaidaEm;
    return !saida;
  }
  if (tratamento === 'RECUSA') {
    const status = nota.statusRetorno != null ? nota.statusRetorno : (doc.statusRetorno || '');
    return status !== 'FINALIZADO';
  }
  return true;
}
const _CAMPOS_POR_NOTA_PATIO_CACHE = ['tratamento', 'statusRetorno', 'dataSaidaEm', 'dataProgramadaEm', 'box', 'numeroNota', 'chave', 'destinatario', 'volumeEsperado'];
function _linhasPorNotaParaCache(recusas) {
  const linhas = [];
  recusas.forEach(r => {
    const notas = Array.isArray(r.notas) && r.notas.length ? r.notas : [{}];
    notas.forEach(nota => {
      const linha = Object.assign({}, r, {notas: [nota], _recusaId: r._id, _notaChave: nota.chave || ''});
      _CAMPOS_POR_NOTA_PATIO_CACHE.forEach(c => { linha[c] = nota[c] != null ? nota[c] : r[c]; });
      if (linha.tratamento == null) linha.tratamento = '';
      if (linha.statusRetorno == null) linha.statusRetorno = '';
      linhas.push(linha);
    });
  });
  return linhas;
}
async function _montarCachePatioTempoRealLoja(lojaId, bigqueryClient) {
  const docs = await _consultarPatioTempoRealBigQuery(lojaId, bigqueryClient);
  const linhas = _linhasPorNotaParaCache(docs).filter(l => _estaNoPatioParaCache(l, l));
  const chaves = [...new Set(linhas.map(l => l.chave).filter(Boolean))];
  const porChave = new Map();
  if (chaves.length) {
    const colNotas = db.collection('lojas').doc(lojaId).collection('recebimento_recusas_notas');
    const snaps = await Promise.all(chaves.map(c => colNotas.doc(c).get()));
    snaps.forEach(s => { if (s.exists) porChave.set(s.id, s.data()); });
  }
  const linhasEnriquecidas = linhas.map(l => {
    const n = porChave.get(l.chave) || {};
    return Object.assign({}, l, {
      destinatario: l.destinatario || n.destinatario || '',
      vendedorNome: n.vendedorNome || '',
      supervisorNome: n.supervisorNome || '',
      valorTotal: Number(l.valorTotal != null ? l.valorTotal : n.valorTotal) || 0,
    });
  });
  const batch = db.batch();
  batch.set(db.collection('lojas').doc(lojaId).collection('recebimento_patio_cache').doc('atual'), {
    linhas: linhasEnriquecidas,
    atualizadoEm: new Date().toISOString(),
  });
  await batch.commit();
  return linhasEnriquecidas.length;
}
async function _atualizarCachePatioTempoRealTodasLojas(bigqueryClient) {
  const lojasSnap = await db.collection('lojas').get();
  if (!bigqueryClient) bigqueryClient = _obterBigQueryCliente();
  const resultados = [];
  for (const doc of lojasSnap.docs) {
    try {
      const total = await _montarCachePatioTempoRealLoja(doc.id, bigqueryClient);
      resultados.push({loja: doc.id, ok: true, total});
    } catch (e) {
      resultados.push({loja: doc.id, ok: false, erro: e.message || String(e)});
    }
  }
  return resultados;
}
exports.atualizarCachePatioTempoRealAgendado = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 120, memory: '256MB'})
  .pubsub.schedule('every 2 minutes')
  .onRun(async () => { await _atualizarCachePatioTempoRealTodasLojas(); return null; });
// Gatilho manual — pra testar sem esperar o próximo ciclo de 2min, mesma
// checagem de administrador de sincronizarBiAgendadoAgora.
exports.atualizarCachePatioTempoRealAgora = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 120, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const solicitante = await acessoSolicitante(context);
    if (!administrador(solicitante)) {
      throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa atualização.');
    }
    const resultados = await _atualizarCachePatioTempoRealTodasLojas();
    return {ok: true, resultados};
  });
// Callable ao vivo — mantida como FALLBACK: se o cache ainda não existir
// (loja nova, ou os 2 primeiros minutos depois do 1º deploy do job
// agendado) ou estiver visivelmente parado (job quebrado), a tela cai pra
// esta consulta direta em vez de mostrar dado vazio/velho demais.
exports.buscarPatioTempoRealBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB', minInstances: 1})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const recusas = await _buscarPatioTempoRealBigQueryInterno(data, acesso, _obterBigQueryCliente());
    return {ok: true, recusas};
  });

// PEDIDO AO VIVO (2026-09-11): Transbordo (95-recebimento-transbordo.js) e
// Cargas/Montagem (104-recebimento-cargas-cards.js) mostram TODAS as
// lojas de uma vez (não uma loja ativa só) — diferente das funções acima.
// IMPORTANTE (achado revisando firestore.rules): hoje, um login restrito
// a certas lojas simplesmente recebe permission-denied nas lojas que não
// pode ver quando o cliente lê `recebimentos`/`recebimento_transbordo_
// cargas` direto (código cliente trata isso como silêncio, `.catch(()=>
// vazio)`) — a Cloud Function roda com uma conta de serviço (bypassa as
// regras do Firestore), então PRECISA repetir esse filtro na consulta,
// senão um login restrito passaria a ver loja que não devia só por essa
// tela ter mudado de fonte.
function _clausulaLojasPermitidas(acesso) {
  if (adminMestre(acesso) || acesso?.acesso_todas_lojas === true) return {clausula: '', params: {}};
  const permitidas = [...lojasPermitidas(acesso)];
  if (!permitidas.length) return {semAcessoNenhum: true};
  return {clausula: "AND JSON_EXTRACT_SCALAR(path_params, '$.lojaId') IN UNNEST(@lojasPermitidas)", params: {lojasPermitidas: permitidas}};
}
async function _buscarTransbordoTodasLojasBigQueryInterno(acesso, bigqueryClient) {
  const restricao = _clausulaLojasPermitidas(acesso);
  if (restricao.semAcessoNenhum) return [];
  const query = `
    SELECT document_id, data, path_params
    FROM \`daterrinha-inventario.dt_relatorios.recebimentos_raw_latest\`
    WHERE operation != 'DELETE'
      AND JSON_EXTRACT_SCALAR(data, '$.tipo') = 'TRANSBORDO'
      ${restricao.clausula}
  `;
  const [rows] = await bigqueryClient.query({query, params: restricao.params});
  return rows.map(r => Object.assign({_id: r.document_id, _lojaId: JSON.parse(r.path_params).lojaId}, JSON.parse(r.data)));
}
exports.buscarTransbordoTodasLojasBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB', minInstances: 1})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const transbordos = await _buscarTransbordoTodasLojasBigQueryInterno(acesso, _obterBigQueryCliente());
    return {ok: true, transbordos};
  });

async function _buscarCargasTodasLojasBigQueryInterno(data, acesso, bigqueryClient) {
  const restricao = _clausulaLojasPermitidas(acesso);
  if (restricao.semAcessoNenhum) return [];
  // PEDIDO AO VIVO (2026-09-10, já aplicado no cliente antes de existir
  // BigQuery): por padrão só cargas ATIVAS (PENDENTE/EM_TRANSITO) — o
  // histórico fechado (RECEBIDA/CANCELADA) só entra quando o filtro de
  // status da tela pede explicitamente (incluirFinalizadas).
  const incluirFinalizadas = data?.incluirFinalizadas === true;
  const filtroStatus = incluirFinalizadas ? '' : "AND JSON_EXTRACT_SCALAR(data, '$.status') IN ('PENDENTE', 'EM_TRANSITO')";
  const query = `
    SELECT document_id, data, path_params
    FROM \`daterrinha-inventario.dt_relatorios.recebimento_transbordo_cargas_raw_latest\`
    WHERE operation != 'DELETE'
      ${filtroStatus}
      ${restricao.clausula}
  `;
  const [rows] = await bigqueryClient.query({query, params: restricao.params});
  return rows.map(r => Object.assign({_id: r.document_id, lojaId: JSON.parse(r.path_params).lojaId}, JSON.parse(r.data)));
}
exports.buscarCargasTodasLojasBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB', minInstances: 1})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const cargas = await _buscarCargasTodasLojasBigQueryInterno(data, acesso, _obterBigQueryCliente());
    return {ok: true, cargas};
  });

// Exportado só pra teste local contra o emulador do Firestore (nunca
// chamado em produção) — mesmo padrão de `_XInternals` já usado nos
// arquivos do front-end.
exports._graphBiInternals = {
  _sincronizarFichaTecnicaBiLoja, _sincronizarAgendaBiLoja, _sincronizarBiTodasLojas,
  _sincronizarEstoqueInsumosBiLoja, _sincronizarEstoqueProdutoAcabadoBiLoja, _sincronizarHistoricoVendasBiLoja,
  _sincronizarNotasRetornadasVendaBiLoja, _dividirChunksNotasRetornadasGrandesDemaisSeNecessario, _notasRetornadasDoDocumentoChunk,
  _sincronizarDevolucoesBiLoja, _classificarMotivoTextoBi, _construirRecebimentoAutomaticoBi,
  _limparEstoqueBiContaminadoLoja, _limparEstoqueBiContaminadoTodasLojas,
  _limparDadosAntigosBluesoftLoja, _limparDadosAntigosBluesoftTodasLojas,
  _sincronizarRelatorioBiChunkeadoGlobal, _sincronizarComprasHistoricoBi,
  _construirClassificacaoProdutosComprasBi, _gravarClassificacaoProdutosComprasBi,
  _sincronizarFornecedoresAgregadoBi,
  _construirConsumoInsumosResumoBi, _gravarConsumoInsumosResumoBi,
  _construirCortesResumoMensalBi, _gravarCortesResumoMensalBi,
  _buscarIndicadoresRetornosBigQueryInterno, _lojaPermitidaParaAcesso,
  _buscarPatioTempoRealBigQueryInterno, _consultarPatioTempoRealBigQuery,
  _estaNoPatioParaCache, _linhasPorNotaParaCache, _montarCachePatioTempoRealLoja, _atualizarCachePatioTempoRealTodasLojas,
  _buscarTransbordoTodasLojasBigQueryInterno, _buscarCargasTodasLojasBigQueryInterno, _clausulaLojasPermitidas,
};

