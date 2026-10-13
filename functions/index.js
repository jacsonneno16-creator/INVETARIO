'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const cors = require('cors')({origin: true});
const {BigQuery} = require('@google-cloud/bigquery');
const fsNode = require('fs');
const os = require('os');
const path = require('path');

admin.initializeApp();

const db = admin.firestore();
const politicaAcessos = require('./permissoes-politica');
Object.assign(exports, require('./permissoes-servico')({db,admin,functions}));
Object.assign(exports, require('./recuperacao-senha')({db,admin,functions}));
Object.assign(exports, require('./separacao')({db,admin,functions}));

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
  // Administração de pessoas exige autoridade explícita, separada do trabalho.
  return politicaAcessos.pode(acesso, operacao);
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

async function podeGerirAlvo(solicitante, alvo) {
  if (alvo && alvo.cadastro_principal_uid) {const s=await db.collection('usuarios_acessos').doc(alvo.cadastro_principal_uid).get();if(!s.exists)return false;alvo=s.data();}
  if (politicaAcessos.protegido(alvo)) return false;
  if (Object.keys(politicaAcessos.delegacao(solicitante)).length && !administrador(solicitante)) return politicaAcessos.completo(solicitante, alvo);
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
    if (!administrador(solicitante) && Object.keys(politicaAcessos.delegacao(solicitante)).length) throw new functions.https.HttpsError('permission-denied', 'Use o cadastro de usuários por área.');
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
    if (!(Object.keys(politicaAcessos.delegacao(solicitante)).length && !administrador(solicitante) ? politicaAcessos.pode(solicitante,'senha') : podeEditarUsuarios(solicitante))) {
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
      if (!alvo || !(await podeGerirAlvo(solicitante, alvo))) {
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
    if (!alvo || !(await podeGerirAlvo(solicitante, alvo))) {
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
  // PEDIDO AO VIVO (2026-09-16): revisão de custo — guarda os DADOS
  // existentes também (não só o id), pra poder comparar e pular a
  // gravação quando nada mudou desde a última sincronização (2x/dia
  // agora; antes disso era a cada 30min, então quase sempre nada muda).
  const fichasPorCod = new Map(fichasSnap.docs.map(d => [String((d.data() || {}).cod), {id: d.id, dados: d.data() || {}}]));

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
  let semProduto = 0, inalterados = 0;
  for (let i = 0; i < agrupadas.length; i += 300) {
    const lote = agrupadas.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(f => {
      if (!codsComProduto.has(f.cod)) semProduto++;
      const existente = fichasPorCod.get(f.cod);
      if (existente && existente.dados.desc === f.desc && JSON.stringify(existente.dados.insumos || []) === JSON.stringify(f.insumos)) { inalterados++; return; }
      const payload = {cod: f.cod, desc: f.desc, insumos: f.insumos, atualizadoEm: agora};
      if (existente) batch.set(colFichas.doc(existente.id), payload, {merge: true});
      else batch.set(colFichas.doc(), Object.assign({}, payload, {criadoEm: agora}));
    });
    await batch.commit();
  }
  return {total: agrupadas.length, semProduto, inalterados};
}

async function _sincronizarAgendaBiLoja(lojaId, loja, registrosCompras) {
  const lojaKey = loja.bluesoft_loja_key != null ? loja.bluesoft_loja_key : null;
  const porPedido = new Map();
  registrosCompras.forEach(it => {
    if (lojaKey != null && String(it.loja_key) !== String(lojaKey)) return;
    const pendente = Number(it.qtd_unidades_pendentes) || 0;
    const recebida = Number(it.qtd_unidades_recebidas) || 0;
    // Mantém também a última fotografia de um item já recebido quando ela
    // ainda aparece no arquivo. Não criamos agenda nova para pedido 100%
    // recebido, mas isso permite atualizar a quantidade recebida de uma
    // agenda já existente antes de o registro sumir da fonte "a receber".
    if (pendente <= 0 && recebida <= 0) return;
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
    atual.quantidadeRecebida += recebida;
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
  let criados = 0, atualizados = 0, inalterados = 0;
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
        // PEDIDO AO VIVO (2026-09-16): revisão de custo — pula a gravação
        // quando nada de relevante mudou (compara com o doc existente
        // antes de gravar; antes regravava TODO pedido pendente em toda
        // rodada, mesmo sem nenhuma mudança real).
        const vaiLimparDataAgendada = limparPrevisaoAntiga && existente.dados.dataAgendada;
        const semMudanca = !vaiLimparDataAgendada && existente.dados.origem === 'bi' && existente.dados.fornecedorNome === fornecedorNome &&
          existente.dados.dataPrevista === dataPrevista && (existente.dados.dataEntregaFinal || null) === (p.dataEntregaFinal || null) &&
          existente.dados.compradorNome === (p.compradorNome || '') && JSON.stringify(existente.dados.itensPedido || []) === JSON.stringify(p.itens || []);
        if (semMudanca) { inalterados++; return; }
        batch.set(colAgenda.doc(existente.id), Object.assign({
          origem: 'bi', lojaId, lojaNome: loja.nome || loja.codigo || lojaId, numeroPedido: p.numeroPedido, fornecedorNome, dataPrevista,
          dataEntregaFinal: p.dataEntregaFinal || null, compradorNome: p.compradorNome || '', itensPedido: p.itens || [], bluesoftSincronizadoEm: agora, atualizadoEm: agora,
        }, limparPrevisaoAntiga ? {dataAgendada: ''} : {}), {merge: true});
        atualizados++;
      } else {
        const totalPendente=(p.itens||[]).reduce((s,it)=>s+(Number(it.quantidadePendente)||0),0);
        if(totalPendente<=0){inalterados++;return;}
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
  const totalPedidosPendentes=pendentes.filter(p=>(p.itens||[]).some(it=>(Number(it.quantidadePendente)||0)>0)).length;
  return {totalPedidosPendentes, criados, atualizados, inalterados};
}

// Ponte segura Recebimento -> PCP/Compras. Só espelha uma data de recebimento
// quando o documento logístico traz explicitamente uma data/hora REAL.
// Quantidade recebida pode ser atualizada sem data; data prevista/agendada
// jamais é convertida em "recebidoEm".
function _aliasesProdutoPcpServidor(x){
  x=x||{};
  const norm=v=>String(v==null?'':v).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]+/g,'');
  const out=new Set();
  [x.produtoKey,x.prodKey,x.produto_key,x.cod,x.codigo,x.sku,x.gtin,x.ean,x.dun,x.codigoProduto,x.produtoCodigo,x.bluesoftProdutoKey,x.produtoUnitarioKey,x.produtoUnitarioKeyBluesoft,x.canonicalKey].forEach(v=>{const n=norm(v);if(n)out.add(n);});
  const nome=norm(x.produto||x.produtoNome||x.descricao||x.nome);if(nome)out.add('N:'+nome);
  return out;
}
function _mesmoProdutoPcpServidor(a,b){
  const aa=_aliasesProdutoPcpServidor(a),bb=_aliasesProdutoPcpServidor(b);
  for(const k of aa)if(bb.has(k))return true;
  return false;
}

async function _sincronizarRecebimentoAgendaNoPcp(lojaId, agenda, dbRef=db) {
  agenda=agenda||{};
  const numeroPedido=String(agenda.numeroPedido||agenda.numeroCompra||'').trim();
  if(!lojaId||!numeroPedido)return {atualizados:0};
  const itens=Array.isArray(agenda.itensPedido)?agenda.itensPedido:[];
  const col=dbRef.collection('lojas').doc(String(lojaId)).collection('pcp_agendamentos');
  const colReq=dbRef.collection('lojas').doc(String(lojaId)).collection('pcp_requisicoes_compra');
  const snap=await col.where('numeroCompra','==',numeroPedido).get();
  if(!snap.docs.length)return {atualizados:0};
  const recebidoEm=agenda.recebidoEm||agenda.dataRecebimento||agenda.horaFechamentoRecebimento||'';
  const agora=new Date().toISOString();
  const batch=dbRef.batch();
  let atualizados=0;
  snap.docs.forEach(d=>{
    const x=d.data()||{},it=itens.find(item=>_mesmoProdutoPcpServidor(x,item));
    if(!it)return;
    const qtdRecebida=Math.max(0,Number(it.quantidadeRecebida)||0);
    const total=Math.max(0,Number(x.quantidade)||0);
    const statusRecebimento=total>0&&qtdRecebida>=total?'finalizada':'parcial';
    const payload={quantidadeRecebida:qtdRecebida,atualizadoEm:agora};
    if(recebidoEm){payload.recebidoEm=recebidoEm;payload.recebidoPor='recebimento';payload.status=statusRecebimento;}
    batch.set(col.doc(d.id),payload,{merge:true});
    const requisicaoId=String(x.requisicaoId||'').trim();
    if(requisicaoId){
      const reqPayload={quantidadeRecebida:qtdRecebida,atualizadoEm:agora};
      if(recebidoEm){reqPayload.recebidoEm=recebidoEm;reqPayload.status=statusRecebimento;}
      batch.set(colReq.doc(requisicaoId),reqPayload,{merge:true});
    }
    atualizados++;
  });
  if(atualizados)await batch.commit();
  return {atualizados};
}


// Quando um recebimento físico é finalizado e foi vinculado a um pedido de
// compra, espelha o horário REAL de fechamento na agenda logística. A agenda
// continua sendo a ponte única para PCP/Compras; não inferimos pedido por nome
// de fornecedor e não convertemos previsão em recebimento.
async function _sincronizarRecebimentoFisicoNaAgenda(lojaId, recebimento, recebimentoId, dbRef=db) {
  recebimento=recebimento||{};
  const numeroPedido=String(recebimento.numeroPedido||'').trim();
  const recebidoEm=recebimento.horaFechamentoRecebimento||'';
  if(!lojaId||!numeroPedido||!recebidoEm||String(recebimento.status||'').toUpperCase()!=='FINALIZADO')return {atualizados:0};
  const col=dbRef.collection('lojas').doc(lojaId).collection('recebimento_agendamentos');
  let refs=[];
  const agendaId=String(recebimento.agendamentoRecebimentoId||'').trim();
  if(agendaId){
    const snap=await col.doc(agendaId).get();
    if(snap.exists)refs=[col.doc(agendaId)];
  }
  if(!refs.length){
    const snap=await col.where('numeroPedido','==',numeroPedido).get();
    refs=snap.docs.map(d=>col.doc(d.id));
  }
  if(!refs.length)return {atualizados:0};
  const payload={horaFechamentoRecebimento:recebidoEm,recebidoEm,recebimentoId:recebimentoId||'',status:'FINALIZADO',atualizadoEm:new Date().toISOString()};
  const batch=dbRef.batch();refs.forEach(ref=>batch.set(ref,payload,{merge:true}));await batch.commit();
  return {atualizados:refs.length};
}

exports.onRecebimentoFisicoFinalizado = functions
  .region('southamerica-east1')
  .firestore.document('lojas/{lojaId}/recebimentos/{docId}')
  .onWrite(async (change, context) => {
    if(!change.after.exists)return null;
    const atual=change.after.data()||{},antes=change.before.exists?(change.before.data()||{}):{};
    const sig=x=>[x.status||'',x.numeroPedido||'',x.agendamentoRecebimentoId||'',x.horaFechamentoRecebimento||''].join('|');
    if(sig(atual)===sig(antes))return null;
    return _sincronizarRecebimentoFisicoNaAgenda(context.params.lojaId,atual,context.params.docId,db);
  });

exports.sincronizarRecebimentoAgendaNoPcp = functions
  .region('southamerica-east1')
  .firestore.document('lojas/{lojaId}/recebimento_agendamentos/{docId}')
  .onWrite(async change=>{
    if(!change.after.exists)return null;
    const antes=change.before.exists?(change.before.data()||{}):{},depois=change.after.data()||{};
    const assinatura=x=>JSON.stringify({
      numeroPedido:x.numeroPedido||x.numeroCompra||'',
      recebidoEm:x.recebidoEm||x.dataRecebimento||x.horaFechamentoRecebimento||'',
      itens:(Array.isArray(x.itensPedido)?x.itensPedido:[]).map(it=>[it.produtoKey||it.cod||'',Number(it.quantidadeRecebida)||0])
    });
    if(assinatura(antes)===assinatura(depois))return null;
    return _sincronizarRecebimentoAgendaNoPcp(change.after.ref.parent.parent.id,depois,db);
  });

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
  // PEDIDO AO VIVO (2026-09-16): revisão de custo — antes gravava TODO
  // item às cegas em toda rodada (centenas de docs x 2x/dia), mesmo sem
  // nenhuma mudança real de estoque/consumo. Uma leitura da coleção
  // inteira aqui sai muito mais barata que reescrever tudo sempre.
  const existentesSnap = await colEstoque.get();
  const existentesPorId = new Map(existentesSnap.docs.map(d => [d.id, d.data() || {}]));
  const agora = new Date().toISOString();
  let gravados = 0, inalterados = 0;
  for (let i = 0; i < relevantes.length; i += 300) {
    const lote = relevantes.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(it => {
      const cod = String(it.sku);
      const docId = 'produto_' + _idSeguro(cod);
      const campos = {
        cod, produto: it.produto || ('Produto ' + cod),
        estoqueAtual: Number(it.estoque) || 0,
        unidadeExibicao: it.unidade || '',
        consumoDiaMedioBluesoft: (Number(it.consumoMensal) || 0) / 30,
      };
      const existente = existentesPorId.get(docId);
      if (existente && existente.produto === campos.produto && existente.estoqueAtual === campos.estoqueAtual &&
          existente.unidadeExibicao === campos.unidadeExibicao && existente.consumoDiaMedioBluesoft === campos.consumoDiaMedioBluesoft) {
        inalterados++; return;
      }
      batch.set(colEstoque.doc(docId), Object.assign({}, campos, {biSincronizadoEm: agora, atualizadoEm: agora, origem: 'bi'}), {merge: true});
      gravados++;
    });
    await batch.commit();
  }
  return {total: relevantes.length, gravados, inalterados};
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
  // PEDIDO AO VIVO (2026-09-16): revisão de custo — mesmo ajuste de
  // _sincronizarEstoqueInsumosBiLoja logo acima: só grava quem realmente
  // mudou. produtosBluesoftSnap já foi lido antes (linha ~1164) só pra
  // validar cadastro; aqui precisa do estado ATUAL de pcp_estoque_bluesoft
  // pra comparar valor por valor.
  const existentesSnap = await colEstoque.get();
  const existentesPorId = new Map(existentesSnap.docs.map(d => [d.id, d.data() || {}]));
  const agora = new Date().toISOString();
  let gravados = 0, inalterados = 0;
  for (let i = 0; i < relevantes.length; i += 300) {
    const lote = relevantes.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(it => {
      const cod = String(it.produto_key);
      const docId = 'produto_' + _idSeguro(cod);
      const campos = {
        cod, produto: it.produto || ('Produto ' + cod),
        estoqueAtual: Number(it.quantidade_estoque) || 0,
        estoqueReservadoVenda: Number(it.quantidadePedidos) || 0,
      };
      const existente = existentesPorId.get(docId);
      if (existente && existente.produto === campos.produto && existente.estoqueAtual === campos.estoqueAtual && existente.estoqueReservadoVenda === campos.estoqueReservadoVenda) {
        inalterados++; return;
      }
      batch.set(colEstoque.doc(docId), Object.assign({}, campos, {biSincronizadoEm: agora, atualizadoEm: agora, origem: 'bi'}), {merge: true});
      gravados++;
    });
    await batch.commit();
  }
  return {total: relevantes.length, gravados, inalterados};
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
  // PEDIDO AO VIVO (2026-09-16): revisão de custo — guarda os dados do doc
  // (não só o id) pra comparar e pular quando m1/m2/m3 não mudaram.
  const porCod = new Map();
  snap.docs.forEach(d => { const x = d.data() || {}; if (x.cod != null) porCod.set(String(x.cod), {id: d.id, dados: x}); });
  const agora = new Date().toISOString();
  let gravados = 0, inalterados = 0;
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
      const existente = porCod.get(cod);
      if (!existente) return;
      if (existente.dados.venda_m1 === m1 && existente.dados.venda_m2 === m2 && existente.dados.venda_m3 === m3 &&
          JSON.stringify(existente.dados.historicoVendasMeses || []) === JSON.stringify(mesesDisponiveis)) {
        inalterados++; return;
      }
      const payload = {cod, venda_m1: m1, venda_m2: m2, venda_m3: m3, historicoVendasMeses: mesesDisponiveis, biSincronizadoEm: agora, atualizadoEm: agora, origem: 'bi'};
      batch.set(colProjecao.doc(existente.id), payload, {merge: true});
      gravados++;
    });
    await batch.commit();
  }
  return {total: entradas.length, gravados, inalterados, meses: mesesDisponiveis};
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
// PEDIDO AO VIVO (2026-09-17): "padronizar, para não ficar duas coisas do
// mesmo jeito" — motivoNome (BI) saía em Capitalizado, motivoNome (Coletor/
// cadastro manual) sai em MAIÚSCULO; o gráfico "Motivos da Volta" agrupa
// por string exata (sem normalizar caixa), então a mesma razão virava 2
// barras separadas. Categorias em maiúsculo aqui pra nascer já no mesmo
// padrão do cadastro manual, nos dois lados (aqui e em 100-consulta-notas-
// fiscais.js).
const CATEGORIAS_MOTIVO_DEVOLUCAO_BI = [
  ['TROCA', /\bTROCA/],
  ['IMPRÓPRIO PARA CONSUMO/VENDA', /IMPROPRI/],
  ['AVARIA', /AVARI/],
  ['FALTA NA CARGA/ENTREGA', /FALTA|FALTOU/],
  ['PRODUTO ERRADO/DIVERGENTE', /ERRAD|DIVERGEN/],
  ['VENCIDO/VENCIMENTO', /VENCID|VENC:/],
  ['DESACORDO COM PEDIDO', /DESACORDO/],
];
const SEM_MOTIVO_NO_TEXTO_BI = '(SEM MOTIVO NO TEXTO)';
function _classificarMotivoTextoBi(texto) {
  const t = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [nome, regex] of CATEGORIAS_MOTIVO_DEVOLUCAO_BI) if (regex.test(t)) return nome;
  return SEM_MOTIVO_NO_TEXTO_BI;
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
// PEDIDO AO VIVO (2026-10-13, "Devoluções unificadas"): a versão anterior
// descartava 5 categorias de motivo (TROCA/AVARIA/VENCIDO/IMPRÓPRIO/SEM
// MOTIVO) e só gravava as outras — já como CONFERIDA, só por terem
// aparecido no BI, nunca de verdade recebidas fisicamente. Substituído por
// um catálogo fiscal único (`devolucoes_notas`, coleção nova, NÃO
// `recebimento_recusas`) que recebe TODOS os motivos, sempre como
// PENDENTE — "importar não significa receber". `_construirRecebimentoAutomaticoBi`/
// `CATEGORIAS_MOTIVO_PRECISAM_COLETOR_BI`/`_motivoDispensaColetorBi` foram
// removidas de propósito: motivo deixou de decidir se a nota é gravada.
// `devolucoes_notas/{chave}` é espelhada pro BigQuery pela extensão
// bq-devolucoes-notas (ver extensions/bq-devolucoes-notas.env) — assim o
// catálogo fica consultável por chave mesmo ANTES do retorno físico, o
// que `recebimento_recusas`/sua view `_raw_latest` nunca ofereceu (só
// existe lá o que já foi confirmado).
function _construirDevolucaoNotaBi(nota, lojaId, versaoImportacao) {
  const categoria = _classificarMotivoTextoBi(nota.informacoesComplementares);
  return {
    chave: nota.chave, lojaId,
    numeroNota: nota.numeroNota || '', serie: nota.serie || '', cfop: nota.cfop || '',
    dataEmissao: nota.dataEmissao || '', destinatario: nota.destinatario || '',
    rede: _extrairRedeBi(nota.destinatario), valorTotal: Number(nota.valorTotal) || 0,
    itens: nota.itens || [],
    motivoTextoOriginal: nota.informacoesComplementares || '', motivoNormalizado: categoria,
    versaoImportacao, atualizadoEm: new Date().toISOString(),
  };
}
// Upsert idempotente por CHAVE (doc ID = chave, nunca `.doc()` aleatório —
// diferente da versão antiga, que gerava ID aleatório e deduplicava só
// com um pré-read em memória, uma race real entre o sync manual e o
// agendado). `estado`/`recebidoEm`/`recebidoPor`/`origemRecebimento`/
// `criadoEm` só entram no payload de uma chave NOVA (nunca vista antes) —
// numa chave já existente, ficam de fora do `{merge:true}` e por isso
// continuam intocados, preservando o estado de recebimento mesmo numa
// reimportação só de dados fiscais.
async function _sincronizarDevolucoesBiLoja(lojaId, lojaKey, registrosNotas) {
  const relevantes = (registrosNotas || []).filter(it => lojaKey != null && String(it.loja_key) === String(lojaKey) && String(it.tipo_movimento || '').toUpperCase() === 'DEVOLUCAO');
  const notas = _agruparDevolucoesBiPorChaveServidor(relevantes);
  const colNotas = db.collection('lojas').doc(lojaId).collection('devolucoes_notas');
  const existentesSnap = await colNotas.get();
  const chavesExistentes = new Set(existentesSnap.docs.map(d => d.id));
  const versaoImportacao = new Date().toISOString();
  let novas = 0, atualizadas = 0, invalidas = 0;
  const validas = [];
  for (const nota of notas) {
    if (!/^\d{44}$/.test(nota.chave)) { invalidas++; continue; }
    validas.push(nota);
  }
  for (let i = 0; i < validas.length; i += 450) {
    const lote = validas.slice(i, i + 450);
    const batch = db.batch();
    lote.forEach(nota => {
      const ref = colNotas.doc(nota.chave);
      const payload = _construirDevolucaoNotaBi(nota, lojaId, versaoImportacao);
      if (!chavesExistentes.has(nota.chave)) {
        payload.estado = 'PENDENTE';
        payload.criadoEm = payload.atualizadoEm;
        novas++;
      } else {
        atualizadas++;
      }
      batch.set(ref, payload, {merge: true});
    });
    await batch.commit();
  }
  return {total: notas.length, novas, atualizadas, semAlteracao: 0, invalidas, falhas: 0};
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

// PEDIDO AO VIVO (2026-09-15): rodava a cada 30 min (48x/dia) sem necessidade
// — conferido o histórico de versões real de 3 dos 5 arquivos no SharePoint
// (notas_fiscais_jacson.json, compras_a_receber.json, produtos_estoque.json)
// e os 3 batem no MESMO padrão, todo dia, sem exceção real: a Controladoria
// sobe tudo às 08:30 e 15:30 (horário de Brasília). Rodando só 2x/dia, 15min
// depois de cada horário (folga de segurança), cai de 48 pra 2 execuções —
// mesmo resultado (dado sempre fresco), fração do custo de uma function
// pesada (1GB de memória, até 9min de execução).
exports.sincronizarBiAgendado = functions
  .region('southamerica-east1')
  .runWith({secrets: ['GRAPH_CLIENT_SECRET'], timeoutSeconds: 540, memory: '1GB'})
  .pubsub.schedule('45 8,15 * * *')
  .timeZone('America/Sao_Paulo')
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
  // PEDIDO AO VIVO (2026-09-16): revisão de custo — o comentário acima já
  // explica que isso reprocessa por design (produto pode trocar de
  // departamento). Mas "reprocessar o cálculo" não precisa dizer "regravar
  // o documento" quando o resultado é IDÊNTICO ao que já está salvo — só
  // grava quem realmente mudou de descrição/grupo/departamento/seção.
  const existentesSnap = await col.get();
  const existentesPorId = new Map(existentesSnap.docs.map(d => [d.id, d.data() || {}]));
  const agora = new Date().toISOString();
  let gravados = 0, inalterados = 0;
  for (let i = 0; i < lista.length; i += 300) {
    const lote = lista.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(item => {
      const docId = _idSeguro(item.produtoKey);
      const existente = existentesPorId.get(docId);
      if (existente && existente.descricao === item.descricao && existente.grupo === item.grupo &&
          existente.departamento === item.departamento && existente.secao === item.secao) {
        inalterados++; return;
      }
      batch.set(col.doc(docId), Object.assign({}, item, {atualizadoEm: agora}), {merge: true});
      gravados++;
    });
    await batch.commit();
  }
  return {totalProdutos: lista.length, gravados, inalterados};
}


const TABELA_COMPRAS_HISTORICO_BQ = 'compras_historico';
const SCHEMA_COMPRAS_HISTORICO_BQ = [
  {name: 'chave', type: 'STRING'}, {name: 'loja_key', type: 'STRING'},
  {name: 'data_emissao', type: 'STRING'}, {name: 'data_recebimento', type: 'STRING'},
  {name: 'nf_numero', type: 'STRING'}, {name: 'produto_key', type: 'STRING'},
  {name: 'descricao', type: 'STRING'}, {name: 'quantidade_faturada', type: 'FLOAT'},
  {name: 'nome_abreviado', type: 'STRING'}, {name: 'custo_liq_unit', type: 'FLOAT'},
  {name: 'Custo_liquido_total', type: 'FLOAT'}, {name: 'comprador_nome', type: 'STRING'},
  {name: 'departamento', type: 'STRING'}, {name: 'grupo', type: 'STRING'},
  {name: 'secao', type: 'STRING'}, {name: 'tipo_operacao', type: 'STRING'},
];
function _slimCompraHistoricoBi(r) {
  return {
    chave: String(r.nota_fiscal_item_key == null ? '' : r.nota_fiscal_item_key),
    loja_key: r.loja_key == null ? '' : String(r.loja_key),
    data_emissao: r.data_emissao || '', data_recebimento: r.data_recebimento || '',
    nf_numero: r.nf_numero == null ? '' : String(r.nf_numero),
    produto_key: r.produto_key == null ? '' : String(r.produto_key), descricao: r.descricao || '',
    quantidade_faturada: Number(r.quantidade_faturada) || 0, nome_abreviado: r.nome_abreviado || '',
    custo_liq_unit: Number(r.custo_liq_unit) || 0, Custo_liquido_total: Number(r.Custo_liquido_total) || 0,
    comprador_nome: r.comprador_nome || '', departamento: r.Departamento || '', grupo: r.grupo || '',
    secao: r.Secao || '', tipo_operacao: r.TIPO_OPERACAO || '',
  };
}
async function _sincronizarComprasHistoricoBigQuery(registros, bigqueryClient) {
  if (!bigqueryClient) bigqueryClient = _obterBigQueryCliente();
  const dataset = bigqueryClient.dataset('dt_relatorios');
  const table = dataset.table(TABELA_COMPRAS_HISTORICO_BQ);
  const tmp = path.join(os.tmpdir(), `compras_historico_${Date.now()}_${process.pid}.ndjson`);
  const stream = fsNode.createWriteStream(tmp, {encoding: 'utf8'});
  try {
    for (const r of registros) {
      if (!stream.write(JSON.stringify(_slimCompraHistoricoBi(r)) + '\n')) {
        await new Promise(resolve => stream.once('drain', resolve));
      }
    }
    await new Promise((resolve, reject) => { stream.end(resolve); stream.on('error', reject); });
    await table.load(tmp, {
      sourceFormat: 'NEWLINE_DELIMITED_JSON', schema: {fields: SCHEMA_COMPRAS_HISTORICO_BQ},
      writeDisposition: 'WRITE_TRUNCATE', createDisposition: 'CREATE_IF_NEEDED',
    });
    return {ok: true, total: registros.length, tabela: 'dt_relatorios.' + TABELA_COMPRAS_HISTORICO_BQ};
  } finally {
    try { if (!stream.destroyed) stream.destroy(); } catch (_) {}
    try { fsNode.unlinkSync(tmp); } catch (_) {}
  }
}

async function _sincronizarComprasHistoricoBi(registros, bigqueryClient) {
  const classificacaoProdutos = await _gravarClassificacaoProdutosComprasBi(_construirClassificacaoProdutosComprasBi(registros));
  const filtrados = registros.filter(r => String(r.data_emissao || '').slice(0, 4) >= ANO_MINIMO_RELATORIOS_BI);
  let bigQuery = {ok: false, erro: 'não executado'};
  try {
    bigQuery = await _sincronizarComprasHistoricoBigQuery(filtrados, bigqueryClient);
  } catch (e) {
    // Transição segura: enquanto o BigQuery estiver sendo implantado/permissões
    // ajustadas, o espelho Firestore antigo continua sendo atualizado e as
    // telas conseguem cair nele como fallback.
    bigQuery = {ok: false, erro: e && e.message ? e.message : String(e)};
    console.error('[ComprasHistoricoBi] Falha ao atualizar BigQuery; mantendo fallback Firestore:', bigQuery.erro);
  }
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
  return Object.assign({}, resultado, {classificacaoProdutos, bigQuery});
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
  // PEDIDO AO VIVO (2026-09-16): revisão de custo — só grava insumo cujo
  // resumo (produto/categoria/tipo/médias) realmente mudou desde a
  // última rodada.
  const existentesSnap = await col.get();
  const existentesPorId = new Map(existentesSnap.docs.map(d => [d.id, d.data() || {}]));
  const agora = new Date().toISOString();
  let gravados = 0, inalterados = 0;
  for (let i = 0; i < lista.length; i += 300) {
    const lote = lista.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(item => {
      const docId = _idSeguro(item.sku);
      const existente = existentesPorId.get(docId);
      if (existente && existente.produto === item.produto && existente.categoria === item.categoria && existente.tipo === item.tipo &&
          existente.mediaMensal === item.mediaMensal && existente.totalPeriodo === item.totalPeriodo) {
        inalterados++; return;
      }
      batch.set(col.doc(docId), Object.assign({}, item, {atualizadoEm: agora}), {merge: true});
      gravados++;
    });
    await batch.commit();
  }
  return {totalInsumos: lista.length, gravados, inalterados};
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
// PEDIDO AO VIVO (2026-09-17): "só precisa ler do dia anterior pra frente,
// é dados que não mudam" — a Graph API não tem como baixar só o que
// mudou de um arquivo JSON (não existe leitura incremental de verdade
// aqui, o arquivo inteiro precisa ser baixado sempre), mas deixamos de
// REPROCESSAR as 54 mil linhas de histórico a cada rodada: mês fechado no
// passado nunca muda, então só agregamos o mês atual + o anterior (margem
// de segurança pra virada de mês) — na prática, ~1-2 mil linhas por
// rodada em vez de 54 mil, e os meses fechados nem entram no Promise.all
// de _gravarCortesResumoMensalBi (só busca/compara os meses que vieram
// aqui).
// PEDIDO AO VIVO (2026-09-17): "não é pra deixar só Terrinha... a gente
// também faz venda pela OK Filial, OK Matriz... só o 2JM não é venda pra
// cliente, é só intercompany" — dados_cortes.json não tem campo de
// cliente/destinatário (só loja_key, produto_key, quantidades e valores),
// então não dá pra separar venda real de transferência entre lojas
// DENTRO de uma mesma loja — só dá pra decidir por loja inteira.
// Confirmado com o usuário, loja a loja: Terrinha Matriz (1), Terrinha
// Filial (14), OK Matriz (10), OK Filial (17) e J E Comércio (2) vendem
// pra cliente de verdade — só a 2JM Amidos (11) é 100% intercompany.
const LOJA_KEY_EXCLUIDA_CORTES = '11';
function _construirCortesResumoMensalBi(registros, agoraISO) {
  const agora = new Date(agoraISO || Date.now());
  const mesAtual = agora.toISOString().slice(0, 7);
  const mesAnterior = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const mesesRelevantes = new Set([mesAtual, mesAnterior]);

  const porChave = new Map();
  (registros || []).forEach(r => {
    if (!r.data || r.produto_key == null) return;
    if (String(r.loja_key) === LOJA_KEY_EXCLUIDA_CORTES) return;
    const mes = String(r.data).slice(0, 7);
    if (!mesesRelevantes.has(mes)) return;
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
  // PEDIDO AO VIVO (2026-09-16): revisão de custo — só grava o mês cuja
  // lista de itens realmente mudou (meses fechados no passado tendem a
  // ficar idênticos rodada após rodada; só o mês corrente muda de verdade).
  const meses = [...porMes.keys()];
  const existentesSnap = await Promise.all(meses.map(mes => col.doc(mes).get()));
  const existentesPorMes = new Map(meses.map((mes, i) => [mes, existentesSnap[i].exists ? existentesSnap[i].data() || {} : null]));
  const agora = new Date().toISOString();
  let gravados = 0, inalterados = 0;
  for (let i = 0; i < meses.length; i += 300) {
    const lote = meses.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(mes => {
      const itensDoMes = porMes.get(mes);
      const existente = existentesPorMes.get(mes);
      if (existente && JSON.stringify(existente.itens || []) === JSON.stringify(itensDoMes)) { inalterados++; return; }
      batch.set(col.doc(mes), {mes, itens: itensDoMes, atualizadoEm: agora});
      gravados++;
    });
    await batch.commit();
  }
  return {totalMeses: meses.length, totalItens: itens.length, gravados, inalterados};
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


// ─────────────────────────────────────────────────────────────────────────
// Compras históricas — consultas prontas no BigQuery.
// O navegador NÃO recebe 30 mil+ itens para somar/filtrar. As telas de
// Dashboard recebem apenas KPIs, rankings e séries mensais já agregados.

async function _buscarHistoricoComprasBigQueryInterno(data, bigqueryClient) {
  const inicio = textoSeguro(data?.inicio, 10);
  const fim = textoSeguro(data?.fim, 10);
  const lojaKey = textoSeguro(data?.lojaKey, 120);
  const tipoOperacao = textoSeguro(data?.tipoOperacao, 40).toUpperCase();
  const produto = textoSeguro(data?.produto, 240);
  const produtoKey = textoSeguro(data?.produtoKey, 120);
  const compradores = Array.isArray(data?.compradores) ? data.compradores.map(v => textoSeguro(v, 80).toLowerCase()).filter(Boolean).slice(0, 50) : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    throw new functions.https.HttpsError('invalid-argument', 'Informe um período válido para o histórico de compras.');
  }
  const dIni = new Date(inicio + 'T00:00:00Z'), dFim = new Date(fim + 'T23:59:59Z');
  if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime()) || dIni > dFim || (dFim - dIni) / 86400000 > 731) {
    throw new functions.https.HttpsError('invalid-argument', 'Escolha um período de até 2 anos.');
  }
  const filtros = ["SUBSTR(data_emissao,1,10) BETWEEN @inicio AND @fim"];
  const params = {inicio, fim};
  if (lojaKey) { filtros.push('loja_key=@lojaKey'); params.lojaKey = lojaKey; }
  if (tipoOperacao) { filtros.push('UPPER(IFNULL(tipo_operacao,\'\'))=@tipoOperacao'); params.tipoOperacao = tipoOperacao; }
  if (produtoKey) { filtros.push('CAST(produto_key AS STRING)=@produtoKey'); params.produtoKey = produtoKey; }
  if (produto) { filtros.push('LOWER(descricao) LIKE @produto'); params.produto = '%' + produto.toLowerCase() + '%'; }
  if (compradores.length) { filtros.push("EXISTS (SELECT 1 FROM UNNEST(@compradores) c WHERE (STRPOS(c, ' ') > 0 AND LOWER(TRIM(REGEXP_REPLACE(IFNULL(comprador_nome,''), r'\\s+', ' '))) = c) OR (STRPOS(c, ' ') = 0 AND LOWER(REGEXP_EXTRACT(IFNULL(comprador_nome,''), r'^[^\\.\\s]+')) = c))"); params.compradores = compradores; }
  const query = `
    SELECT chave, loja_key, data_emissao, data_recebimento, nf_numero, produto_key,
           descricao, quantidade_faturada, nome_abreviado, custo_liq_unit,
           Custo_liquido_total, comprador_nome, departamento, grupo, secao, tipo_operacao
    FROM \`daterrinha-inventario.dt_relatorios.compras_historico\`
    WHERE ${filtros.join(' AND ')}
    ORDER BY data_emissao DESC, nf_numero DESC
  `;
  const [rows] = await bigqueryClient.query({query, params});
  return rows;
}
// PEDIDO AO VIVO (2026-09-18): "escrevo farofa e ele traz toda a família
// junto" — a Análise de Preços buscava por LIKE direto na descrição
// inteira do período (produto=texto), então "farofa" trazia TODAS as
// variantes misturadas no mesmo gráfico/tabela. Esta consulta é só pra
// alimentar a sugestão de digitação (poucos resultados, sem período) — o
// app usa o produtoKey de quem foi escolhido pra fazer a busca de
// histórico de verdade (exata, via produtoKey em
// buscarHistoricoComprasBigQuery), nunca mais o texto solto.
async function _buscarProdutosComprasBigQueryInterno(data, bigqueryClient) {
  const busca = textoSeguro(data?.busca, 120).trim().toLowerCase();
  if (busca.length < 2) return [];
  const query = `
    SELECT produto_key AS produtoKey, ANY_VALUE(descricao) AS descricao, COUNT(DISTINCT nf_numero) AS notas
    FROM \`daterrinha-inventario.dt_relatorios.compras_historico\`
    WHERE (tipo_operacao IS NULL OR tipo_operacao = '' OR UPPER(tipo_operacao) = 'COMPRA')
      AND IFNULL(produto_key,'') != ''
      AND (LOWER(IFNULL(descricao,'')) LIKE @busca OR LOWER(IFNULL(produto_key,'')) LIKE @busca)
    GROUP BY produto_key
    ORDER BY notas DESC, descricao
    LIMIT 20
  `;
  const [rows] = await bigqueryClient.query({query, params: {busca: '%' + busca + '%'}});
  return rows.map(r => ({produtoKey: r.produtoKey, descricao: r.descricao, notas: Number(r.notas) || 0}));
}
exports.buscarProdutosComprasBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const produtos = await _buscarProdutosComprasBigQueryInterno(data || {}, _obterBigQueryCliente());
    return {ok: true, produtos};
  });
exports.buscarHistoricoComprasBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const linhas = await _buscarHistoricoComprasBigQueryInterno(data, _obterBigQueryCliente());
    return {ok: true, linhas};
  });

// PEDIDO AO VIVO (2026-09-18): "eu não quero ter que ir lá e pegar produto
// por produto... se tem um fornecedor de tal coisa, ele tem aqueles
// produtos, quem compra é um comprador — pega o histórico e cadastra no
// nome da pessoa que mais compra" — em vez de digitar fornecedor por
// fornecedor (ou produto por produto, mais de mil) em Regras de
// Compradores (compras_regras_comprador), uma consulta só agrega TODO o
// histórico real (compras_historico) por fornecedor x comprador (e outra
// por produto x comprador) e devolve, pra cada um, quem mais comprou (por
// valor) e o quanto isso representa do total — o app decide o que fazer
// com a sugestão (mostrar pra revisão, aplicar tudo automaticamente,
// etc.), esta função só agrega. Só leitura — não grava nada.
// PEDIDO AO VIVO (2026-09-18, correção do pedido acima): "o comprador de
// fubá mimoso é Dilma, aí no sistema muda pra Marta — o sistema tem que
// identificar e alterar sozinho, pra não ficar aparecendo pra pessoa
// errada" — a granularidade por PRODUTO importa de verdade (um mesmo
// fornecedor pode ter produtos de compradores diferentes), por isso
// `agruparPor` aceita 'fornecedor' OU 'produto'; quem decide se aplica
// automático (sincronização, sem revisão linha a linha — inviável pra
// >1000 produtos) ou com revisão manual (poucas dezenas de fornecedores)
// é o app, não esta função.
function _sugerirRegrasCompradorAgregadoBigQuerySql(agruparPor) {
  const chave = agruparPor === 'produto' ? 'produto_key' : 'nome_abreviado';
  const extra = agruparPor === 'produto' ? ', ANY_VALUE(descricao) AS descricao' : '';
  return `
    WITH base AS (
      SELECT ${chave} AS chave, descricao,
             LOWER(REGEXP_EXTRACT(IFNULL(comprador_nome,''), r'^[^\\.\\s]+')) AS compradorChave,
             comprador_nome, quantidade_faturada, Custo_liquido_total, nf_numero
      FROM \`daterrinha-inventario.dt_relatorios.compras_historico\`
      WHERE (tipo_operacao IS NULL OR tipo_operacao = '' OR UPPER(tipo_operacao) = 'COMPRA')
        AND IFNULL(${chave},'') != '' AND IFNULL(comprador_nome,'') != ''
        AND SUBSTR(data_emissao,1,10) >= FORMAT_DATE('%Y-%m-%d', DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 24 MONTH))
    ), porComprador AS (
      SELECT chave, compradorChave, ANY_VALUE(comprador_nome) AS compradorNomeOriginal,
             SUM(quantidade_faturada) AS qtd, SUM(Custo_liquido_total) AS valor,
             COUNT(DISTINCT nf_numero) AS notas
      FROM base WHERE compradorChave != ''
      GROUP BY chave, compradorChave
    )
    SELECT chave,
           SUM(valor) AS totalValor, SUM(qtd) AS totalQtd,
           ARRAY_AGG(STRUCT(compradorChave, compradorNomeOriginal, qtd, valor, notas) ORDER BY valor DESC) AS compradores
    FROM porComprador
    GROUP BY chave
    ORDER BY totalValor DESC
  `;
}
async function _sugerirRegrasCompradorAgregadoBigQueryInterno(agruparPor, bigqueryClient) {
  const query = _sugerirRegrasCompradorAgregadoBigQuerySql(agruparPor);
  const [rows] = await bigqueryClient.query({query, params: {}});
  return rows.map(r => {
    const compradores = (r.compradores || []).map(c => ({
      compradorChave: c.compradorChave, compradorNome: c.compradorNomeOriginal,
      qtd: Number(c.qtd) || 0, valor: Number(c.valor) || 0, notas: Number(c.notas) || 0,
    }));
    const totalValor = Number(r.totalValor) || 0;
    const top = compradores[0] || null;
    return {
      chave: r.chave,
      totalValor, totalQtd: Number(r.totalQtd) || 0,
      sugerido: top ? { compradorChave: top.compradorChave, compradorNome: top.compradorNome, participacaoPct: totalValor > 0 ? (top.valor / totalValor) * 100 : 0 } : null,
      compradores,
    };
  });
}
async function _sugerirRegrasCompradorPorFornecedorBigQueryInterno(data, bigqueryClient) {
  const linhas = await _sugerirRegrasCompradorAgregadoBigQueryInterno('fornecedor', bigqueryClient);
  return linhas.map(l => ({ fornecedor: l.chave, totalValor: l.totalValor, totalQtd: l.totalQtd, sugerido: l.sugerido, compradores: l.compradores }));
}
async function _sugerirRegrasCompradorPorProdutoBigQueryInterno(data, bigqueryClient) {
  const linhas = await _sugerirRegrasCompradorAgregadoBigQueryInterno('produto', bigqueryClient);
  return linhas.map(l => ({ produtoKey: l.chave, totalValor: l.totalValor, totalQtd: l.totalQtd, sugerido: l.sugerido, compradores: l.compradores }));
}
exports.sugerirRegrasCompradorPorFornecedorBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const fornecedores = await _sugerirRegrasCompradorPorFornecedorBigQueryInterno(data || {}, _obterBigQueryCliente());
    return {ok: true, fornecedores};
  });
exports.sugerirRegrasCompradorPorProdutoBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 60, memory: '512MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const produtos = await _sugerirRegrasCompradorPorProdutoBigQueryInterno(data || {}, _obterBigQueryCliente());
    return {ok: true, produtos};
  });

// PEDIDO AO VIVO (2026-09-18): "Produtos 360° só mostra produto de
// produção, não mostra matéria-prima comprada... os números têm que ser
// do arquivo real, não da solicitação do PCP" — a tela lia
// pcp_requisicoes_compra (preenchida manualmente pelo PCP; só existe pro
// que passou por lá) em vez do histórico real de compras. Esta consulta
// devolve, POR PRODUTO REALMENTE COMPRADO (matéria-prima, embalagem,
// qualquer coisa que apareça no BI — não só o que o PCP registrou), a
// última compra (data/fornecedor/preço) e quantas compras já teve —
// mesmo filtro de comprador (`compradores`) do resumo do Dashboard, pra
// já sair no ar respeitando "cada comprador só vê os seus produtos".
async function _buscarResumoProdutosComprasBigQueryInterno(data, bigqueryClient) {
  const compradores = Array.isArray(data?.compradores) ? data.compradores.map(v => textoSeguro(v, 80).toLowerCase()).filter(Boolean).slice(0, 50) : [];
  const filtroComprador = compradores.length ? " AND EXISTS (SELECT 1 FROM UNNEST(@compradores) c WHERE (STRPOS(c, ' ') > 0 AND LOWER(TRIM(REGEXP_REPLACE(IFNULL(comprador_nome,''), r'\\s+', ' '))) = c) OR (STRPOS(c, ' ') = 0 AND LOWER(REGEXP_EXTRACT(IFNULL(comprador_nome,''), r'^[^\\.\\s]+')) = c))" : '';
  const query = `
    WITH base AS (
      SELECT produto_key, descricao, nome_abreviado, comprador_nome, data_emissao, custo_liq_unit, nf_numero
      FROM \`daterrinha-inventario.dt_relatorios.compras_historico\`
      WHERE (tipo_operacao IS NULL OR tipo_operacao = '' OR UPPER(tipo_operacao) = 'COMPRA')
        AND IFNULL(produto_key,'') != ''${filtroComprador}
    )
    SELECT produto_key AS produtoKey, ANY_VALUE(descricao) AS descricao,
           COUNT(DISTINCT nf_numero) AS numCompras,
           ARRAY_AGG(STRUCT(data_emissao, nome_abreviado, custo_liq_unit, comprador_nome) ORDER BY data_emissao DESC LIMIT 1)[SAFE_OFFSET(0)] AS ultima
    FROM base
    GROUP BY produto_key
    ORDER BY ultima.data_emissao DESC
  `;
  const [rows] = await bigqueryClient.query({query, params: compradores.length ? {compradores} : {}});
  return rows.map(r => ({
    produtoKey: r.produtoKey, descricao: r.descricao, numCompras: Number(r.numCompras) || 0,
    ultimaData: r.ultima?.data_emissao || '', ultimoFornecedor: r.ultima?.nome_abreviado || '',
    ultimoPreco: Number(r.ultima?.custo_liq_unit) || 0, ultimoComprador: r.ultima?.comprador_nome || '',
  }));
}
exports.buscarResumoProdutosComprasBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 60, memory: '512MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const produtos = await _buscarResumoProdutosComprasBigQueryInterno(data || {}, _obterBigQueryCliente());
    return {ok: true, produtos};
  });

async function _buscarResumoComprasDashboardBigQueryInterno(data, bigqueryClient) {
  if (!bigqueryClient && data && typeof data.query === 'function') { bigqueryClient = data; data = {}; }
  data = data || {};
  const compradores = Array.isArray(data.compradores) ? data.compradores.map(v => textoSeguro(v, 80).toLowerCase()).filter(Boolean).slice(0, 50) : [];
  const filtroComprador = compradores.length ? " AND EXISTS (SELECT 1 FROM UNNEST(@compradores) c WHERE (STRPOS(c, ' ') > 0 AND LOWER(TRIM(REGEXP_REPLACE(IFNULL(comprador_nome,''), r'\\s+', ' '))) = c) OR (STRPOS(c, ' ') = 0 AND LOWER(REGEXP_EXTRACT(IFNULL(comprador_nome,''), r'^[^\\.\\s]+')) = c))" : '';
  const query = `
    WITH base AS (
      SELECT *, COALESCE(NULLIF(data_recebimento, ''), data_emissao) AS data_ref
      FROM \`daterrinha-inventario.dt_relatorios.compras_historico\`
      WHERE (tipo_operacao IS NULL OR tipo_operacao = '' OR UPPER(tipo_operacao) = 'COMPRA')
        AND UPPER(IFNULL(departamento, '')) NOT IN ('MRO', 'LOGISTICA')${filtroComprador}
    ), precos AS (
      SELECT produto_key,
        ARRAY_AGG(STRUCT(descricao, custo_liq_unit, data_emissao) ORDER BY data_emissao ASC LIMIT 1)[SAFE_OFFSET(0)] primeiro,
        ARRAY_AGG(STRUCT(descricao, custo_liq_unit, data_emissao) ORDER BY data_emissao DESC LIMIT 1)[SAFE_OFFSET(0)] ultimo,
        COUNT(*) qtd
      FROM base WHERE custo_liq_unit > 0
      GROUP BY produto_key HAVING COUNT(*) >= 2
    )
    SELECT
      (SELECT IFNULL(SUM(Custo_liquido_total),0) FROM base WHERE SUBSTR(data_ref,1,7)=FORMAT_DATE('%Y-%m', CURRENT_DATE('America/Sao_Paulo'))) compradoNoMes,
      (SELECT IFNULL(SUM(Custo_liquido_total),0) FROM base WHERE SUBSTR(data_ref,1,4)=FORMAT_DATE('%Y', CURRENT_DATE('America/Sao_Paulo'))) compradoNoAno,
      (SELECT COUNT(DISTINCT nf_numero) FROM base) nPedidos,
      (SELECT IFNULL(SUM(Custo_liquido_total),0) FROM base) valorTotal,
      ARRAY(SELECT AS STRUCT SUBSTR(data_ref,1,7) mes, SUM(Custo_liquido_total) valor, SUM(quantidade_faturada) qtd FROM base WHERE LENGTH(data_ref)>=7 GROUP BY mes ORDER BY mes) porMes,
      ARRAY(SELECT AS STRUCT ANY_VALUE(descricao) produto, SUM(quantidade_faturada) qtd, SUM(Custo_liquido_total) valor FROM base GROUP BY produto_key ORDER BY valor DESC LIMIT 10) topProdutos,
      ARRAY(SELECT AS STRUCT nome_abreviado fornecedor, SUM(quantidade_faturada) qtd, SUM(Custo_liquido_total) valor FROM base WHERE IFNULL(nome_abreviado,'')!='' GROUP BY nome_abreviado ORDER BY valor DESC LIMIT 10) topFornecedores,
      ARRAY(SELECT AS STRUCT primeiro.descricao produto, SAFE_DIVIDE(ultimo.custo_liq_unit-primeiro.custo_liq_unit, primeiro.custo_liq_unit)*100 variacaoPct FROM precos WHERE primeiro.custo_liq_unit>0 ORDER BY variacaoPct DESC LIMIT 10) maisSubiram,
      ARRAY(SELECT AS STRUCT primeiro.descricao produto, SAFE_DIVIDE(ultimo.custo_liq_unit-primeiro.custo_liq_unit, primeiro.custo_liq_unit)*100 variacaoPct FROM precos WHERE primeiro.custo_liq_unit>0 ORDER BY variacaoPct ASC LIMIT 10) maisCairam,
      ARRAY(SELECT AS STRUCT comprador primeiroNome FROM (SELECT DISTINCT LOWER(TRIM(REGEXP_REPLACE(IFNULL(comprador_nome,''), r'\\s+', ' '))) comprador FROM base WHERE IFNULL(comprador_nome,'')!='') WHERE comprador!='' ORDER BY comprador) compradores
  `;
  const [rows] = await bigqueryClient.query({query, params: compradores.length ? {compradores} : {}});
  return rows[0] || {};
}
exports.buscarResumoComprasDashboardBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const resumo = await _buscarResumoComprasDashboardBigQueryInterno(data || {}, _obterBigQueryCliente());
    return {ok: true, resumo};
  });

async function _buscarResumoRecebimentoComprasBigQueryInterno(data, acesso, bigqueryClient) {
  const lojaKey = textoSeguro(data?.lojaKey, 120);
  if (!lojaKey) throw new functions.https.HttpsError('invalid-argument', 'Loja Bluesoft não informada.');
  // A permissão por loja continua validada no app pela loja ativa; esta chave
  // é o identificador Bluesoft, não o id do documento Firestore da loja.
  const query = `
    WITH base AS (
      SELECT COALESCE(NULLIF(data_recebimento, ''), data_emissao) AS data_ref,
             nf_numero, data_emissao, Custo_liquido_total
      FROM \`daterrinha-inventario.dt_relatorios.compras_historico\`
      WHERE loja_key=@lojaKey AND UPPER(IFNULL(tipo_operacao,''))='COMPRA'
    )
    SELECT SUBSTR(data_ref,1,7) mes,
           COUNT(DISTINCT CONCAT(IFNULL(nf_numero,''),'|',IFNULL(data_emissao,''))) notas,
           IFNULL(SUM(Custo_liquido_total),0) valor
    FROM base WHERE LENGTH(data_ref)>=7
    GROUP BY mes ORDER BY mes DESC LIMIT 14
  `;
  const [rows] = await bigqueryClient.query({query, params: {lojaKey}});
  return rows.reverse();
}
exports.buscarResumoRecebimentoComprasBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const mensal = await _buscarResumoRecebimentoComprasBigQueryInterno(data, acesso, _obterBigQueryCliente());
    return {ok: true, mensal};
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
function _dtRodandoLocalmente() {
  return process.env.FUNCTIONS_EMULATOR === 'true' || process.env.DT_AMBIENTE_LOCAL === '1';
}
function _obterBigQueryCliente() {
  // O Emulator Suite não emula BigQuery. Falhar explicitamente é obrigatório:
  // nunca permitir que uma Function local use credenciais ADC e consulte o
  // projeto daterrinha-inventario por acidente. Testes continuam podendo
  // injetar bigqueryFake diretamente nas funções internas.
  if (_dtRodandoLocalmente()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'BigQuery de produção bloqueado no ambiente local.'
    );
  }
  if (!_bigQueryClienteSingleton) _bigQueryClienteSingleton = new BigQuery({projectId: 'daterrinha-inventario'});
  return _bigQueryClienteSingleton;
}

async function _buscarRecebimentosOperacaoBigQueryInterno(data, acesso, bigqueryClient, firestoreDb) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) {
    throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  }

  // A própria operação precisa enxergar transbordos vindos das lojas que
  // possuem rota para a loja ativa. Antes o navegador fazia uma consulta
  // Firestore por origem depois de receber a lista principal. O backend
  // resolve as rotas e devolve tudo em uma única resposta.
  let origens = [];
  if (firestoreDb && typeof firestoreDb.collection === 'function') {
    const rotasSnap = await firestoreDb.collection('recebimento_rotas_transbordo')
      .where('destinoLojaId', '==', lojaId).get().catch(() => ({docs: []}));
    origens = Array.from(new Set((rotasSnap.docs || [])
      .map(d => String((d.data() || {}).origemLojaId || '')).filter(Boolean)));
  }

  const query = `
    SELECT document_id, data, JSON_EXTRACT_SCALAR(path_params, '$.lojaId') AS loja_origem
    FROM \`daterrinha-inventario.dt_relatorios.recebimentos_raw_latest\`
    WHERE operation != 'DELETE'
      AND (
        JSON_EXTRACT_SCALAR(path_params, '$.lojaId') = @lojaId
        OR (
          JSON_EXTRACT_SCALAR(path_params, '$.lojaId') IN UNNEST(@origens)
          AND UPPER(IFNULL(JSON_VALUE(data, '$.tipo'), '')) = 'TRANSBORDO'
        )
      )
  `;
  const [rows] = await bigqueryClient.query({query, params: {lojaId, origens}});
  return rows.map(r => Object.assign({_id: r.document_id, _lojaId: r.loja_origem || lojaId}, JSON.parse(r.data)));
}
exports.buscarRecebimentosOperacaoBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const recebimentos = await _buscarRecebimentosOperacaoBigQueryInterno(data, acesso, _obterBigQueryCliente(), admin.firestore());
    return {ok: true, recebimentos, incluiTransbordosParceiros: true};
  });

// Histórico de recebimentos — consulta específica para a tela Histórico.
// Evita carregar a operação inteira (recebimentos + cadastros auxiliares +
// cruzamento das lojas parceiras) quando a tela precisa apenas de registros
// FINALIZADO/CANCELADO. O filtro de período já é aplicado no BigQuery.
async function _buscarHistoricoRecebimentosBigQueryInterno(data, acesso, bigqueryClient, firestoreDb) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  const periodo = textoSeguro(data?.periodo, 7);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (periodo && !/^\d{4}-\d{2}$/.test(periodo)) throw new functions.https.HttpsError('invalid-argument', 'Período inválido.');
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) {
    throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  }

  // Mantém a mesma regra do cliente para transbordos recebidos: somente
  // origens com rota configurada para a loja ativa são cruzadas.
  const rotasSnap = await firestoreDb.collection('recebimento_rotas_transbordo')
    .where('destinoLojaId', '==', lojaId).get().catch(() => ({docs: []}));
  const origens = Array.from(new Set((rotasSnap.docs || []).map(d => String((d.data() || {}).origemLojaId || '')).filter(Boolean)));
  const lojasBusca = Array.from(new Set([lojaId, ...origens]));

  const filtrosPeriodo = periodo ? `
      AND SUBSTR(COALESCE(JSON_VALUE(data, '$.horaChegada'), JSON_VALUE(data, '$.criadoEm'), ''), 1, 7) = @periodo` : '';
  const query = `
    SELECT document_id, data, JSON_EXTRACT_SCALAR(path_params, '$.lojaId') AS loja_origem
    FROM \`daterrinha-inventario.dt_relatorios.recebimentos_raw_latest\`
    WHERE operation != 'DELETE'
      AND JSON_EXTRACT_SCALAR(path_params, '$.lojaId') IN UNNEST(@lojasBusca)
      AND JSON_VALUE(data, '$.status') IN ('FINALIZADO', 'CANCELADO')${filtrosPeriodo}
  `;
  const params = {lojasBusca};
  if (periodo) params.periodo = periodo;
  const [rows] = await bigqueryClient.query({query, params});
  return rows.map(r => {
    const dados = JSON.parse(r.data);
    return Object.assign({_id: r.document_id, _lojaId: r.loja_origem}, dados);
  }).filter(r => {
    if (String(r._lojaId) === lojaId) return true;
    return String(r.tipo || '') === 'TRANSBORDO' && String(r.destinoLojaId || '') === lojaId;
  });
}
exports.buscarHistoricoRecebimentosBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const recebimentos = await _buscarHistoricoRecebimentosBigQueryInterno(data, acesso, _obterBigQueryCliente(), admin.firestore());
    return {ok: true, recebimentos};
  });


// Recebimento histórico — Dashboard agregado no backend.
// Lê os espelhos BigQuery de recebimento_notas/recebimento_cargas e devolve
// somente KPIs, ranking e séries de tempo; o navegador não precisa baixar o
// histórico bruto só para montar a visão geral.
function _normTxtRecebimento(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}
function _mesChaveRecebimento(v) {
  const st = String(v || '').trim();
  if (!st) return '';
  let m = st.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  m = st.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2];
  const d = new Date(st);
  return Number.isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function _ehDevolucaoRecebimento(nota) {
  const tipos = ['DEVOLUCAO_ENTRE_LOJAS', 'DEVOLUCAO_CLIENTE'];
  if (tipos.includes(nota && nota.tipoTransferencia)) return true;
  return /\bDEV(OL|\.)|\bRETORNO\b/.test(_normTxtRecebimento(nota && nota.natureza));
}
function _categoriaRecebimento(nota) {
  if (_ehDevolucaoRecebimento(nota)) return 'DEVOLUCAO';
  if (nota && nota.tipoTransferencia === 'TRANSFERENCIA_ENTRE_LOJAS') return 'TRANSBORDO';
  if (_normTxtRecebimento(nota && nota.natureza).includes('TRANSFER')) return 'TRANSBORDO';
  return 'FORNECEDOR';
}
function _minEntreRecebimento(a, b) {
  if (!a || !b) return null;
  const da = new Date(a), db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  const n = Math.round((db - da) / 60000);
  return Number.isFinite(n) ? n : null;
}
function _mediaRecebimento(vals) {
  const a = (vals || []).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
  return a.length ? a.reduce((x,y) => x+y, 0) / a.length : null;
}
async function _buscarResumoHistoricoRecebimentoBigQueryInterno(data, acesso, bigqueryClient) {
  const periodo = textoSeguro(data?.periodo, 7);
  const categoria = textoSeguro(data?.categoria, 20).toUpperCase() || 'FORNECEDOR';
  if (periodo && !/^\d{4}-\d{2}$/.test(periodo)) {
    throw new functions.https.HttpsError('invalid-argument', 'Período inválido.');
  }
  if (!['FORNECEDOR','TRANSBORDO','TODAS'].includes(categoria)) {
    throw new functions.https.HttpsError('invalid-argument', 'Categoria inválida.');
  }
  const filtroNotas = periodo
    ? "WHERE operation != 'DELETE' AND (SUBSTR(JSON_EXTRACT_SCALAR(data, '$.processamento'),1,7)=@periodo OR SUBSTR(JSON_EXTRACT_SCALAR(data, '$.dataRecebimento'),1,7)=@periodo)"
    : "WHERE operation != 'DELETE'";
  const filtroCargas = periodo
    ? "WHERE operation != 'DELETE' AND SUBSTR(JSON_EXTRACT_SCALAR(data, '$.dataGeracao'),1,7)=@periodo"
    : "WHERE operation != 'DELETE'";
  const params = periodo ? {periodo} : {};
  const [notasRows, cargasRows] = await Promise.all([
    bigqueryClient.query({query:`SELECT document_id, data FROM \`daterrinha-inventario.dt_relatorios.recebimento_notas_raw_latest\` ${filtroNotas}`, params}),
    bigqueryClient.query({query:`SELECT document_id, data FROM \`daterrinha-inventario.dt_relatorios.recebimento_cargas_raw_latest\` ${filtroCargas}`, params}),
  ]);
  const notasTodas = (notasRows[0] || []).map(r => Object.assign({_id:r.document_id}, JSON.parse(r.data || '{}')));
  const cargas = (cargasRows[0] || []).map(r => Object.assign({_id:r.document_id}, JSON.parse(r.data || '{}')));
  const transbordoNoPeriodo = notasTodas.filter(x => _categoriaRecebimento(x) === 'TRANSBORDO').length;
  const devolucoesExcluidas = notasTodas.filter(_ehDevolucaoRecebimento).length;
  const notas = notasTodas.filter(x => !_ehDevolucaoRecebimento(x)).filter(x => categoria === 'TODAS' || _categoriaRecebimento(x) === categoria);
  const fornecedores = new Set(notas.map(x => x.fornecedorNome).filter(Boolean));
  const temposLanc = notas.map(x => x.tempoLancamentoMin).filter(v => v != null).map(Number).filter(Number.isFinite);
  const comparaveis = notas.filter(x => x.comparavel);
  const comDivergencia = notas.filter(x => x.temDivergencia).length;
  const valorTotal = notas.reduce((s,x) => s + (Number(x.valor)||0), 0);
  const rankingMap = new Map();
  notas.filter(x => x.fornecedorNome).forEach(x => {
    const a = rankingMap.get(x.fornecedorNome) || {nome:x.fornecedorNome, entregas:0, valor:0};
    a.entregas++; a.valor += Number(x.valor)||0; rankingMap.set(x.fornecedorNome, a);
  });
  const rankingFornecedores = [...rankingMap.values()].sort((a,b)=>b.entregas-a.entregas).slice(0,10);
  const temposTotal=[], temposEspera=[], temposConf=[];
  const porMes = new Map();
  cargas.forEach(c => {
    const total = _minEntreRecebimento(c.dataGeracao, c.dataFimRecebimento);
    const espera = _minEntreRecebimento(c.dataGeracao, c.dataInicioRecebimento);
    const conf = _minEntreRecebimento(c.dataInicioRecebimento, c.dataFimRecebimento);
    if (total != null) temposTotal.push(total);
    if (espera != null) temposEspera.push(espera);
    if (conf != null) temposConf.push(conf);
    const mes = _mesChaveRecebimento(c.dataGeracao);
    if (!mes) return;
    const a = porMes.get(mes) || {total:[], espera:[], conferencia:[]};
    if (total != null) a.total.push(total);
    if (espera != null) a.espera.push(espera);
    if (conf != null) a.conferencia.push(conf);
    porMes.set(mes,a);
  });
  return {
    totalNotas:notas.length,
    fornecedoresDistintos:fornecedores.size,
    tempoMedioLancamento:_mediaRecebimento(temposLanc),
    comparaveis:comparaveis.length,
    comDivergencia,
    valorTotal,
    tempoMedioRecebimento:_mediaRecebimento(temposTotal),
    tempoMedioEspera:_mediaRecebimento(temposEspera),
    tempoMedioConferencia:_mediaRecebimento(temposConf),
    transbordoNoPeriodo,
    devolucoesExcluidas,
    rankingFornecedores,
    tempoPorMes:[...porMes.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([mes,a])=>({mes,espera:_mediaRecebimento(a.espera),conferencia:_mediaRecebimento(a.conferencia),total:_mediaRecebimento(a.total)})),
  };
}
exports.buscarResumoHistoricoRecebimentoBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds:30, memory:'256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const resumo = await _buscarResumoHistoricoRecebimentoBigQueryInterno(data, acesso, _obterBigQueryCliente());
    return {ok:true, resumo};
  });


// Recebimento histórico — Notas Fiscais paginadas no backend.
// A UI recebe apenas a página visível (50 registros), enquanto filtros,
// contagem total e ordenação acontecem no BigQuery. Isso elimina o download
// completo de `recebimento_notas` só para mostrar uma página da tabela.
function _whereNotasRecebimentoPaginadas(data) {
  const periodo = textoSeguro(data?.periodo, 7);
  const fornecedor = textoSeguro(data?.fornecedor, 180);
  const status = textoSeguro(data?.status, 120);
  const natureza = textoSeguro(data?.natureza, 220);
  const categoria = textoSeguro(data?.categoria, 20).toUpperCase() || 'FORNECEDOR';
  const soDivergencia = data?.soDivergencia === true;
  if (periodo && !/^\d{4}-\d{2}$/.test(periodo)) throw new functions.https.HttpsError('invalid-argument', 'Período inválido.');
  if (!['FORNECEDOR','TRANSBORDO','TODAS'].includes(categoria)) throw new functions.https.HttpsError('invalid-argument', 'Categoria inválida.');
  const params = {periodo, fornecedor, status, natureza, categoria, soDivergencia};
  const where = `
    categoria != 'DEVOLUCAO'
    AND (@categoria = 'TODAS' OR categoria = @categoria)
    AND (@periodo = '' OR mes_ref = @periodo)
    AND (@fornecedor = '' OR fornecedor_nome = @fornecedor)
    AND (@status = '' OR status_recebimento = @status)
    AND (@natureza = '' OR natureza = @natureza)
    AND (@soDivergencia = FALSE OR tem_divergencia = TRUE)
  `;
  return {where, params};
}
function _cteNotasRecebimentoPaginadas() {
  return `
    WITH base AS (
      SELECT
        document_id,
        data,
        COALESCE(JSON_EXTRACT_SCALAR(data, '$.fornecedorNome'), '') AS fornecedor_nome,
        COALESCE(JSON_EXTRACT_SCALAR(data, '$.statusRecebimento'), '') AS status_recebimento,
        COALESCE(JSON_EXTRACT_SCALAR(data, '$.natureza'), '') AS natureza,
        COALESCE(JSON_EXTRACT_SCALAR(data, '$.dataRecebimento'), JSON_EXTRACT_SCALAR(data, '$.processamento'), '') AS data_ordem,
        SUBSTR(COALESCE(JSON_EXTRACT_SCALAR(data, '$.processamento'), JSON_EXTRACT_SCALAR(data, '$.dataRecebimento'), ''), 1, 7) AS mes_ref,
        LOWER(COALESCE(JSON_EXTRACT_SCALAR(data, '$.temDivergencia'), 'false')) = 'true' AS tem_divergencia,
        CASE
          WHEN JSON_EXTRACT_SCALAR(data, '$.tipoTransferencia') IN ('DEVOLUCAO_ENTRE_LOJAS', 'DEVOLUCAO_CLIENTE')
            OR REGEXP_CONTAINS(UPPER(COALESCE(JSON_EXTRACT_SCALAR(data, '$.natureza'), '')), r'(^|[^A-Z])DEV(OL|\\.)|(^|[^A-Z])RETORNO([^A-Z]|$)')
            THEN 'DEVOLUCAO'
          WHEN JSON_EXTRACT_SCALAR(data, '$.tipoTransferencia') = 'TRANSFERENCIA_ENTRE_LOJAS'
            OR STRPOS(UPPER(COALESCE(JSON_EXTRACT_SCALAR(data, '$.natureza'), '')), 'TRANSFER') > 0
            THEN 'TRANSBORDO'
          ELSE 'FORNECEDOR'
        END AS categoria
      FROM \`daterrinha-inventario.dt_relatorios.recebimento_notas_raw_latest\`
      WHERE operation != 'DELETE'
    )
  `;
}
async function _buscarNotasRecebimentoPaginadasBigQueryInterno(data, acesso, bigqueryClient) {
  if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
  const pagina = Math.max(1, Math.min(100000, Number(data?.pagina) || 1));
  const limite = Math.max(1, Math.min(100, Number(data?.limite) || 50));
  const incluirOpcoes = data?.incluirOpcoes === true;
  const {where, params} = _whereNotasRecebimentoPaginadas(data || {});
  const base = _cteNotasRecebimentoPaginadas();
  const offset = (pagina - 1) * limite;
  const queryPagina = `${base}
    SELECT document_id, data
    FROM base
    WHERE ${where}
    ORDER BY data_ordem DESC, document_id DESC
    LIMIT @limite OFFSET @offset
  `;
  const queryTotal = `${base}
    SELECT COUNT(*) AS total
    FROM base
    WHERE ${where}
  `;
  const paramsPagina = Object.assign({}, params, {limite, offset});
  const promessas = [
    bigqueryClient.query({query:queryPagina, params:paramsPagina}),
    bigqueryClient.query({query:queryTotal, params}),
  ];
  if (incluirOpcoes) {
    promessas.push(bigqueryClient.query({query:`${base}
      SELECT
        ARRAY_AGG(DISTINCT fornecedor_nome IGNORE NULLS ORDER BY fornecedor_nome) AS fornecedores,
        ARRAY_AGG(DISTINCT status_recebimento IGNORE NULLS ORDER BY status_recebimento) AS status,
        ARRAY_AGG(DISTINCT natureza IGNORE NULLS ORDER BY natureza) AS naturezas
      FROM base
      WHERE fornecedor_nome != '' OR status_recebimento != '' OR natureza != ''
    `}));
  }
  const resultados = await Promise.all(promessas);
  const linhas = (resultados[0][0] || []).map(r => Object.assign({_id:r.document_id}, JSON.parse(r.data || '{}')));
  const totalRaw = resultados[1][0] && resultados[1][0][0] ? resultados[1][0][0].total : 0;
  const total = Number(totalRaw && typeof totalRaw === 'object' && 'value' in totalRaw ? totalRaw.value : totalRaw) || 0;
  let opcoes = null;
  if (incluirOpcoes) {
    const row = resultados[2][0] && resultados[2][0][0] ? resultados[2][0][0] : {};
    const limpa = arr => (Array.isArray(arr) ? arr : []).map(String).filter(Boolean);
    opcoes = {fornecedores:limpa(row.fornecedores), status:limpa(row.status), naturezas:limpa(row.naturezas)};
  }
  return {linhas, total, pagina, limite, opcoes};
}
exports.buscarNotasRecebimentoPaginadasBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds:30, memory:'256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    return Object.assign({ok:true}, await _buscarNotasRecebimentoPaginadasBigQueryInterno(data, acesso, _obterBigQueryCliente()));
  });


// Recebimento — divergências agregadas por fornecedor.
// A tela de Fornecedores precisa somente da contagem histórica de notas com
// divergência por fornecedor; não há motivo para mandar `recebimento_notas`
// inteira ao navegador só para montar esse único campo/ranking.
async function _buscarDivergenciasFornecedoresRecebimentoBigQueryInterno(data, acesso, bigqueryClient) {
  const query = `
    SELECT
      UPPER(TRIM(COALESCE(JSON_EXTRACT_SCALAR(data, '$.fornecedorNome'), ''))) AS fornecedor_chave,
      ANY_VALUE(COALESCE(JSON_EXTRACT_SCALAR(data, '$.fornecedorNome'), '')) AS fornecedor,
      COUNT(1) AS divergencias
    FROM \`daterrinha-inventario.dt_relatorios.recebimento_notas_raw_latest\`
    WHERE operation != 'DELETE'
      AND LOWER(COALESCE(JSON_EXTRACT_SCALAR(data, '$.temDivergencia'), 'false')) = 'true'
      AND TRIM(COALESCE(JSON_EXTRACT_SCALAR(data, '$.fornecedorNome'), '')) != ''
    GROUP BY fornecedor_chave
    ORDER BY divergencias DESC, fornecedor_chave
  `;
  const [rows] = await bigqueryClient.query({query});
  return (rows || []).map(r => ({
    fornecedor: String(r.fornecedor || r.fornecedor_chave || '').trim(),
    divergencias: Number(r.divergencias && typeof r.divergencias === 'object' && 'value' in r.divergencias ? r.divergencias.value : r.divergencias) || 0,
  }));
}
exports.buscarDivergenciasFornecedoresRecebimentoBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds:30, memory:'256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const fornecedores = await _buscarDivergenciasFornecedoresRecebimentoBigQueryInterno(data, acesso, _obterBigQueryCliente());
    return {ok:true, fornecedores};
  });


function _statusProducaoDashboard(status) {
  status = String(status || '').trim();
  if(status==='em_producao')return 'em_andamento';
  return status === 'em_andamento' || status === 'concluido' ? status : 'pendente';
}

function _resumirRegistrosProducaoDashboard(docs) {
  const resumo = {
    total: 0, pend: 0, and: 0, ok: 0,
    totalCx: 0, pendCx: 0, andCx: 0, okCx: 0,
    maquinas: [], topProdutos: [], recentes: [],
  };
  const porMaquina = new Map();
  const porProduto = new Map();
  const recentes = [];
  (docs || []).forEach(doc => {
    const d = typeof doc.data === 'function' ? (doc.data() || {}) : (doc || {});
    const id = doc && doc.id != null ? String(doc.id) : String(d._firestoreId || d._id || '');
    const status = _statusProducaoDashboard(d.status);
    const caixas = Number(d.qntCaixas) || 0;
    const maquina = String(d.maquina || '').trim();
    const produto = String(d.produto || '').trim();
    resumo.total++;
    resumo.totalCx += caixas;
    if (status === 'pendente') { resumo.pend++; resumo.pendCx += caixas; }
    else if (status === 'em_andamento') { resumo.and++; resumo.andCx += caixas; }
    else { resumo.ok++; resumo.okCx += caixas; }
    if (maquina) {
      let m = porMaquina.get(maquina);
      if (!m) {
        m = {nome: maquina, totalCx: 0, okCx: 0, pendCount: 0, emAndamentoProduto: '', status: {
          pendente: {ops: 0, caixas: 0}, em_andamento: {ops: 0, caixas: 0}, concluido: {ops: 0, caixas: 0},
        }};
        porMaquina.set(maquina, m);
      }
      m.totalCx += caixas;
      m.status[status].ops++;
      m.status[status].caixas += caixas;
      if (status === 'concluido') m.okCx += caixas;
      if (status === 'pendente') m.pendCount++;
      if (status === 'em_andamento' && !m.emAndamentoProduto) m.emAndamentoProduto = produto;
    }
    if (produto) porProduto.set(produto, (porProduto.get(produto) || 0) + caixas);
    recentes.push({_firestoreId: id, produto, maquina, qntCaixas: caixas, status, atualizadoEm: d.atualizadoEm || '', criadoEm: d.criadoEm || ''});
  });
  resumo.maquinas = Array.from(porMaquina.values()).sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  resumo.topProdutos = Array.from(porProduto.entries()).sort((a,b) => b[1] - a[1]).slice(0, 8).map(([nome, caixas]) => ({nome, caixas}));
  resumo.recentes = recentes.sort((a,b) => String(b.atualizadoEm || b.criadoEm || '').localeCompare(String(a.atualizadoEm || a.criadoEm || ''))).slice(0, 8);
  return resumo;
}

async function _buscarResumoProducaoDashboardInterno(data, acesso, firestoreDb) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) {
    throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  }
  const ref = (firestoreDb || db).collection('lojas').doc(lojaId).collection('producao_registros');
  // Projeção server-side: evita transportar campos grandes/configSnapshot para a Function.
  const snap = await ref.select('status', 'qntCaixas', 'maquina', 'produto', 'atualizadoEm', 'criadoEm').get();
  return _resumirRegistrosProducaoDashboard(snap.docs);
}

exports.buscarResumoProducaoDashboard = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const resumo = await _buscarResumoProducaoDashboardInterno(data, acesso, db);
    return {ok: true, resumo};
  });


function _chunks(arr, tamanho) {
  const out = [];
  for (let i = 0; i < arr.length; i += tamanho) out.push(arr.slice(i, i + tamanho));
  return out;
}

async function _buscarRelatorioProducaoPeriodoInterno(data, acesso, firestoreDb) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  const tudo = data?.tudo === true;
  const ini = textoSeguro(data?.ini, 10);
  const fim = textoSeguro(data?.fim, 10);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) {
    throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  }
  if (!tudo) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
      throw new functions.https.HttpsError('invalid-argument', 'Período inválido — use o formato AAAA-MM-DD.');
    }
    const dIni = new Date(ini + 'T00:00:00'), dFim = new Date(fim + 'T23:59:59');
    if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime()) || dIni > dFim || (dFim - dIni) / 86400000 > 731) {
      throw new functions.https.HttpsError('invalid-argument', 'Escolha um período válido de até 2 anos.');
    }
  }

  const lojaRef = (firestoreDb || db).collection('lojas').doc(lojaId);
  const regsRef = lojaRef.collection('producao_registros');
  const apsRef = lojaRef.collection('producao_apontamentos');
  const maqsRef = lojaRef.collection('producao_maquinas');
  const procRef = lojaRef.collection('producao_processos');

  let qRegs = regsRef;
  let qAps = apsRef;
  let qProc = procRef;
  if (!tudo) {
    qRegs = qRegs.where('data', '>=', ini).where('data', '<=', fim);
    qAps = qAps.where('data', '>=', ini).where('data', '<=', fim);
    qProc = qProc.where('data', '>=', ini).where('data', '<=', fim);
  }

  // 1) Só o período pedido. Apontamentos do período podem pertencer a uma OP
  // programada fora do intervalo, então buscamos essas OPs por id em seguida.
  const [regsSnap, apsPeriodoSnap, maqsSnap, procSnap] = await Promise.all([
    qRegs.get(), qAps.get(), maqsRef.get(), qProc.get().catch(() => ({docs: []})),
  ]);
  const registrosMap = new Map(regsSnap.docs.map(d => [d.id, Object.assign({_id: d.id}, d.data())]));
  const apontamentosPeriodo = apsPeriodoSnap.docs.map(d => Object.assign({_id: d.id}, d.data()));
  const idsPorApontamento = [...new Set(apontamentosPeriodo.map(a => String(a.registroId || '')).filter(Boolean))]
    .filter(id => !registrosMap.has(id));

  for (const lote of _chunks(idsPorApontamento, 250)) {
    if (!lote.length) continue;
    const snaps = await (firestoreDb || db).getAll(...lote.map(id => regsRef.doc(id)));
    snaps.forEach(d => { if (d.exists) registrosMap.set(d.id, Object.assign({_id: d.id}, d.data())); });
  }

  // 2) Para atraso/incompleto precisamos do realizado TOTAL da OP, não só do
  // período. Agregamos no servidor e devolvemos apenas um número por OP.
  const idsRelevantes = [...registrosMap.keys()];
  const totalRealPorRegistro = {};
  idsRelevantes.forEach(id => { totalRealPorRegistro[id] = 0; });
  if (tudo) {
    apontamentosPeriodo.forEach(a => {
      const id = String(a.registroId || '');
      if (id && Object.prototype.hasOwnProperty.call(totalRealPorRegistro, id)) {
        totalRealPorRegistro[id] += Number(a.qntCaixas) || 0;
      }
    });
  } else {
    for (const lote of _chunks(idsRelevantes, 30)) {
      if (!lote.length) continue;
      const snap = await apsRef.where('registroId', 'in', lote).select('registroId', 'qntCaixas').get();
      snap.docs.forEach(d => {
        const a = d.data() || {};
        const id = String(a.registroId || '');
        if (id && Object.prototype.hasOwnProperty.call(totalRealPorRegistro, id)) {
          totalRealPorRegistro[id] += Number(a.qntCaixas) || 0;
        }
      });
    }
  }

  return {
    registros: [...registrosMap.values()],
    apontamentos: apontamentosPeriodo,
    totalRealPorRegistro,
    maquinas: maqsSnap.docs.map(d => Object.assign({_id: d.id}, d.data())),
    processos: (procSnap.docs || []).map(d => Object.assign({_id: d.id}, d.data())),
  };
}

exports.buscarRelatorioProducaoPeriodo = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const relatorio = await _buscarRelatorioProducaoPeriodoInterno(data, acesso, db);
    return {ok: true, relatorio};
  });

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

// Retorna somente os campos pequenos usados para enriquecer Pátio e
// Indicadores. Os documentos completos de recebimento_recusas_notas podem
// conter listas muito grandes; projetar os campos no servidor impede que o
// navegador baixe dezenas de megabytes por lote de 30 chaves.
async function _buscarResumoNotasRetorno(lojaId, chaves, firestoreDb) {
  const unicas = [...new Set((chaves || []).map(String).filter(Boolean))];
  if (!unicas.length) return {};
  const col = (firestoreDb || db).collection('lojas').doc(lojaId).collection('recebimento_recusas_notas');
  const resumo = {};
  // Compatibilidade com o Firestore em memória dos testes. Em produção o
  // caminho abaixo usa query + select, que é o ponto da otimização.
  if (typeof col.where !== 'function' || !admin.firestore.FieldPath) {
    const snaps = await Promise.all(unicas.map(chave => col.doc(chave).get()));
    snaps.forEach(doc => {
      if (!doc.exists) return;
      const x = doc.data() || {};
      const item = _resumoNotaRetorno(doc.id, x);
      resumo[doc.id] = item;
      resumo[item.chave] = item;
    });
    return resumo;
  }
  for (let i = 0; i < unicas.length; i += 120) {
    const grupos = [];
    const pagina = unicas.slice(i, i + 120);
    for (let j = 0; j < pagina.length; j += 30) grupos.push(pagina.slice(j, j + 30));
    const snaps = await Promise.all(grupos.map(grupo => col
      .where(admin.firestore.FieldPath.documentId(), 'in', grupo)
      .select('chave', 'numeroNota', 'serie', 'cfop', 'naturezaLabel', 'tipoOperacao', 'pareceDevolucao',
        'destinatario', 'destinatarioNome', 'destinatarioCnpj', 'vendedorNome', 'vendedorEmail',
        'supervisorNome', 'supervisorEmail', 'valorTotal', 'informacoesComplementares')
      .get()));
    snaps.forEach(snap => snap.docs.forEach(doc => {
      const x = doc.data() || {};
      const item = _resumoNotaRetorno(doc.id, x);
      resumo[doc.id] = item;
      resumo[item.chave] = item;
    }));
  }
  return resumo;
}

function _resumoNotaRetorno(id, x) {
  return {
    chave: String(x.chave || id), numeroNota: x.numeroNota || '', serie: x.serie || '',
    cfop: x.cfop || '', naturezaLabel: x.naturezaLabel || '', tipoOperacao: x.tipoOperacao || '',
    pareceDevolucao: x.pareceDevolucao === true, destinatario: x.destinatario || '',
    destinatarioNome: x.destinatarioNome || '', destinatarioCnpj: x.destinatarioCnpj || '',
    vendedorNome: x.vendedorNome || '', vendedorEmail: x.vendedorEmail || '',
    supervisorNome: x.supervisorNome || '', supervisorEmail: x.supervisorEmail || '',
    valorTotal: Number(x.valorTotal) || 0, informacoesComplementares: x.informacoesComplementares || '',
  };
}
// PEDIDO AO VIVO (2026-09-11): tinha minInstances:1 aqui (eliminava os 2-5s
// de "cold start" da biblioteca do BigQuery), aceito na época em troca de
// latência previsível. PEDIDO AO VIVO (2026-09-15): revisão geral de custo
// — removido de propósito em todas as 14 functions de BigQuery (essa
// incluída). Sem isso, a função "esfria" depois de ~15min sem uso e a
// PRÓXIMA chamada depois disso leva alguns segundos a mais; volta a ficar
// rápida enquanto continuar em uso. Trade-off aceito conscientemente pelo
// usuário: menos custo fixo, ocasional espera extra.
exports.buscarIndicadoresRetornosBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const recusas = await _buscarIndicadoresRetornosBigQueryInterno(data, acesso, _obterBigQueryCliente());
    const chaves = recusas.flatMap(r => (Array.isArray(r.notas) ? r.notas : []).map(n => n && n.chave));
    const notasResumo = await _buscarResumoNotasRetorno(textoSeguro(data?.lojaId, 120), chaves, admin.firestore());
    return {ok: true, recusas, notasResumo};
  });

// PEDIDO AO VIVO (2026-10-13, "Devoluções unificadas"): catálogo fiscal
// novo (`devolucoes_notas`), espelhado pro BigQuery pela extensão
// bq-devolucoes-notas — diferente de `recebimento_recusas_raw_latest`
// (só o que já foi confirmado), essa view também tem notas PENDENTES,
// então dá pra consultar por chave mesmo antes do retorno físico.
function _bigQueryClienteOuNulo() {
  try { return _obterBigQueryCliente(); } catch (e) { return null; }
}
async function _consultarDevolucaoPorChaveInterno(data, acesso, bigqueryClient, firestoreDb) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  const chave = textoSeguro(data?.chave, 44);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!/^\d{44}$/.test(chave)) throw new functions.https.HttpsError('invalid-argument', 'Chave de acesso inválida — precisa ter 44 dígitos.');
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  if (bigqueryClient) {
    try {
      const query = `
        SELECT data
        FROM \`daterrinha-inventario.dt_relatorios.devolucoes_notas_raw_latest\`
        WHERE operation != 'DELETE'
          AND JSON_EXTRACT_SCALAR(path_params, '$.lojaId') = @lojaId
          AND JSON_EXTRACT_SCALAR(data, '$.chave') = @chave
        LIMIT 1
      `;
      const [rows] = await bigqueryClient.query({query, params: {lojaId, chave}});
      if (rows.length) return JSON.parse(rows[0].data);
    } catch (e) {
      // Extensão ainda não instalada, propagação atrasada, ou ambiente
      // local sem BigQuery — segue pro fallback Firestore abaixo.
      console.warn('[Devoluções] consultarDevolucaoPorChave: BigQuery indisponível, usando Firestore direto:', e.message || e);
    }
  }
  const snap = await (firestoreDb || db).collection('lojas').doc(lojaId).collection('devolucoes_notas').doc(chave).get();
  return snap.exists ? snap.data() : null;
}
exports.consultarDevolucaoPorChave = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const nota = await _consultarDevolucaoPorChaveInterno(data, acesso, _bigQueryClienteOuNulo(), db);
    return {ok: true, nota};
  });

// Confirmação atômica de recebimento — o MESMO mecanismo (transação com
// tx.create em devolucoes_recebimentos/{chave}, que só pode suceder uma
// vez por chave) é usado tanto pelo Analista (bipagem no "Montar
// relatório") quanto pelo Coletor (via confirmarRecebimentoDevolucaoClient,
// public/js/shared/devolucoes-confirmar.js, rodando a mesma transação
// pelo SDK client-side direto em vez de chamar esta Function). Quem
// chegar primeiro grava; o segundo lê o doc já existente e recebe
// jaRecebida:true, sem erro — nunca dois "primeiros recebimentos" pra
// mesma chave, mesmo com Coletor e Analista confirmando ao mesmo tempo.
async function _confirmarRecebimentoDevolucaoInterno(data, acesso, firestoreDb) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  const chave = textoSeguro(data?.chave, 44);
  const relatorioId = data?.relatorioId ? textoSeguro(data.relatorioId, 120) : null;
  const origem = textoSeguro(data?.origem || 'ANALISTA', 20);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!/^\d{44}$/.test(chave)) throw new functions.https.HttpsError('invalid-argument', 'Chave de acesso inválida — precisa ter 44 dígitos.');
  if (!['ANALISTA', 'COLETOR'].includes(origem)) throw new functions.https.HttpsError('invalid-argument', 'Origem inválida.');
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  const fdb = firestoreDb || db;
  const notaRef = fdb.collection('lojas').doc(lojaId).collection('devolucoes_notas').doc(chave);
  const recRef = fdb.collection('lojas').doc(lojaId).collection('devolucoes_recebimentos').doc(chave);
  const confirmadoPor = acesso.email || acesso.nome || '';
  const agora = new Date().toISOString();
  return fdb.runTransaction(async tx => {
    const [notaSnap, recSnap] = await Promise.all([tx.get(notaRef), tx.get(recRef)]);
    if (!notaSnap.exists) throw new functions.https.HttpsError('not-found', 'Nota de devolução não encontrada no catálogo fiscal — atualize do BI e tente de novo.');
    const notaDados = notaSnap.data() || {};
    if (String(notaDados.lojaId || lojaId) !== String(lojaId)) throw new functions.https.HttpsError('permission-denied', 'Esta nota pertence a outra loja.');
    if (recSnap.exists) return {jaRecebida: true, recebimento: recSnap.data()};
    const recebimento = {chave, lojaId, confirmadoEm: agora, confirmadoPor, origem, relatorioId: relatorioId || null};
    tx.create(recRef, recebimento);
    tx.set(notaRef, {estado: 'RECEBIDA', recebidoEm: agora, recebidoPor: confirmadoPor, origemRecebimento: origem}, {merge: true});
    return {jaRecebida: false, recebimento};
  });
}
exports.confirmarRecebimentoDevolucao = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const resultado = await _confirmarRecebimentoDevolucaoInterno(data, acesso, db);
    return Object.assign({ok: true}, resultado);
  });

// Consulta paginada/filtrada do catálogo fiscal pra aba Controle — sempre
// via BigQuery (nunca lista o arquivo BI inteiro), com LIMIT fixo (igual
// espírito do resto do projeto: filtros reais, não "trazer tudo e filtrar
// no cliente").
async function _listarDevolucoesBigQueryInterno(data, acesso, bigqueryClient) {
  const lojaId = textoSeguro(data?.lojaId, 120);
  if (!lojaId) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!_lojaPermitidaParaAcesso(acesso, lojaId)) throw new functions.https.HttpsError('permission-denied', 'Seu login não tem acesso a esta loja.');
  const estado = textoSeguro(data?.estado, 20);
  if (estado && !['PENDENTE', 'RECEBIDA'].includes(estado)) throw new functions.https.HttpsError('invalid-argument', 'Estado inválido.');
  const motivo = textoSeguro(data?.motivo, 60);
  const numeroNota = textoSeguro(data?.numeroNota, 30);
  const chaveExata = textoSeguro(data?.chave, 44);
  const mercado = textoSeguro(data?.mercado, 120);
  const ini = textoSeguro(data?.ini, 10);
  const fim = textoSeguro(data?.fim, 10);
  if (ini && !/^\d{4}-\d{2}-\d{2}$/.test(ini)) throw new functions.https.HttpsError('invalid-argument', 'Data inicial inválida — use AAAA-MM-DD.');
  if (fim && !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new functions.https.HttpsError('invalid-argument', 'Data final inválida — use AAAA-MM-DD.');
  const campoData = data?.campoData === 'recebimento' ? 'recebidoEm' : 'dataEmissao';

  const condicoes = [`operation != 'DELETE'`, `JSON_EXTRACT_SCALAR(path_params, '$.lojaId') = @lojaId`];
  const params = {lojaId};
  if (estado) { condicoes.push(`JSON_EXTRACT_SCALAR(data, '$.estado') = @estado`); params.estado = estado; }
  if (motivo) { condicoes.push(`JSON_EXTRACT_SCALAR(data, '$.motivoNormalizado') = @motivo`); params.motivo = motivo; }
  if (numeroNota) { condicoes.push(`JSON_EXTRACT_SCALAR(data, '$.numeroNota') = @numeroNota`); params.numeroNota = numeroNota; }
  if (chaveExata) { condicoes.push(`JSON_EXTRACT_SCALAR(data, '$.chave') = @chaveExata`); params.chaveExata = chaveExata; }
  if (mercado) { condicoes.push(`LOWER(JSON_EXTRACT_SCALAR(data, '$.destinatario')) LIKE @mercado`); params.mercado = '%' + mercado.toLowerCase() + '%'; }
  if (ini) { condicoes.push(`JSON_EXTRACT_SCALAR(data, '$.${campoData}') >= @ini`); params.ini = ini; }
  if (fim) { condicoes.push(`JSON_EXTRACT_SCALAR(data, '$.${campoData}') <= @fim`); params.fim = fim; }
  // PEDIDO (aba Indicadores, 2026-10-13): o padrão (500) é o bastante pra
  // busca pontual da aba Controle; Indicadores agrega o período inteiro
  // (até 2 anos) e precisa de um teto maior pra não subcontar os KPIs —
  // ainda assim um teto, nunca "lista o arquivo BI inteiro".
  const limite = Math.min(5000, Math.max(1, Number(data?.limite) || 500));
  params.limite = limite;

  const query = `
    SELECT data
    FROM \`daterrinha-inventario.dt_relatorios.devolucoes_notas_raw_latest\`
    WHERE ${condicoes.join(' AND ')}
    ORDER BY JSON_EXTRACT_SCALAR(data, '$.dataEmissao') DESC
    LIMIT @limite
  `;
  const [rows] = await bigqueryClient.query({query, params, types: {limite: 'INT64'}});
  return rows.map(r => JSON.parse(r.data));
}
exports.listarDevolucoesBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const notas = await _listarDevolucoesBigQueryInterno(data, acesso, _obterBigQueryCliente());
    return {ok: true, notas};
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
// PEDIDO AO VIVO (2026-09-11): "clico demora muito para carregar" —
// confirmado no log do servidor que o BigQuery tem um piso de 1-3s por
// consulta, não é bug de código. Solução original: um job agendado a cada
// 2min deixava o resultado PRONTO em `recebimento_patio_cache/atual`, e a
// tela só lia esse cache (leitura de Firestore, bem abaixo de 1s).
// PEDIDO AO VIVO (2026-09-15): revisão de custo — esse job rodava 720x/dia
// (24h, inclusive de madrugada sem ninguém usando) só pra manter o cache
// pronto. Removido; a tela (105-recebimento-patio-tempo-real.js) já cai
// sozinha pro caminho ao vivo (esta function) quando o cache não existe ou
// passa de 10min — então agora ela é chamada com mais frequência (todo
// acesso ao vivo, não só o cache-miss ocasional de antes).
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
// BUG AO VIVO REAL (2026-09-11): "tem um monte sem valor" — faltava
// 'valorTotal' nesta lista. Nota que só tem o valor gravado nela mesma
// (não no documento) caía pro fallback `r.valorTotal` (doc, sempre
// ausente nesse caso) e virava R$0,00 — mesmo com o valor certinho
// dentro da própria nota (confirmado direto no BigQuery). Mesmo bug
// duplicado em public/js/analista/105-recebimento-patio-tempo-real.js
// (CAMPOS_POR_NOTA) — corrigido junto.
// BUG AO VIVO REAL (2026-09-17): "aqui ainda tá vazio" — mesmo bug do
// valorTotal acima, mas pra vendedorNome/supervisorNome: faltavam nesta
// lista, então vinham sempre do documento (ausente) em vez da própria
// nota, mesmo depois de uma importação de planilha preencher a nota
// diretamente. Mesmo bug duplicado em 105-recebimento-patio-tempo-real.js
// (CAMPOS_POR_NOTA) — corrigido junto.
const _CAMPOS_POR_NOTA_PATIO_CACHE = ['tratamento', 'statusRetorno', 'dataSaidaEm', 'dataProgramadaEm', 'box', 'numeroNota', 'chave', 'destinatario', 'volumeEsperado', 'valorTotal', 'vendedorNome', 'supervisorNome'];
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
  const notasResumo = await _buscarResumoNotasRetorno(lojaId, chaves, db);
  const porChave = new Map(Object.entries(notasResumo));
  const linhasEnriquecidas = linhas.map(l => {
    const n = porChave.get(l.chave) || {};
    return Object.assign({}, l, {
      destinatario: l.destinatario || n.destinatario || '',
      vendedorNome: l.vendedorNome || n.vendedorNome || '',
      supervisorNome: l.supervisorNome || n.supervisorNome || '',
      valorTotal: Number(l.valorTotal != null ? l.valorTotal : n.valorTotal) || 0,
    });
  });
  // BUG AO VIVO REAL (2026-09-11): "Pátio em Tempo Real ainda tá demorando
  // muito" — o job rodava sem erro NENHUM lugar visível (o erro por loja
  // fica só no array `resultados`, nunca logado), mas o cache nunca se
  // formava pra loja_matriz de verdade: campos como dataSaidaEm/
  // dataProgramadaEm ficam `undefined` quando a nota nunca teve esse
  // evento (nem na nota, nem no documento) — o SDK Admin do Firestore
  // REJEITA `undefined` num write (diferente do SDK do navegador, que
  // aceita numa leitura vinda de BigQuery). O round-trip por JSON
  // converte campo com undefined em ausente — mesmo efeito de nunca ter
  // existido, sem exigir tocar em `settings({ignoreUndefinedProperties})`
  // (que mudaria o comportamento pro projeto INTEIRO, não só aqui).
  const linhasSeguras = JSON.parse(JSON.stringify(linhasEnriquecidas));
  const batch = db.batch();
  batch.set(db.collection('lojas').doc(lojaId).collection('recebimento_patio_cache').doc('atual'), {
    linhas: linhasSeguras,
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
      // BUG AO VIVO REAL (2026-09-11): erro por loja ficava só neste
      // array, nunca aparecia em log nenhum — o job "terminava com
      // sucesso" (onRun não relança) mesmo com TODA loja falhando por
      // baixo. Sempre logar, pra um problema futuro aparecer de verdade
      // em `firebase functions:log`.
      console.error('[atualizarCachePatioTempoReal] Falha na loja ' + doc.id + ':', e.message || e);
      resultados.push({loja: doc.id, ok: false, erro: e.message || String(e)});
    }
  }
  return resultados;
}
// PEDIDO AO VIVO (2026-09-15): removido o agendamento automático de 2 em 2
// minutos (720 execuções/dia, 24h, mesmo de madrugada sem ninguém usando) —
// custo real sem benefício real. A tela (105-recebimento-patio-tempo-real.js
// > carregarPatio) já cai sozinha pro caminho ao vivo (callable
// buscarPatioTempoRealBigQuery) sempre que o cache não existir ou tiver mais
// de 10min (_tentarCarregarDoCache/LIMITE_IDADE_CACHE_MIN) — mais o botão
// "↻ Atualizar" e o polling de 45s enquanto a aba está aberta. Sem esse job,
// toda visita simplesmente busca ao vivo (pouco mais de 1s a mais na
// primeira vez, sem cache pra reaproveitar) — nada quebra, só troca "sempre
// pronto, mesmo sem ninguém olhar" por "busca quando alguém precisa".
// atualizarCachePatioTempoRealAgora (callable, abaixo) continua existindo
// como gatilho manual, pra quem quiser forçar o cache mesmo assim.
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
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const recusas = await _buscarPatioTempoRealBigQueryInterno(data, acesso, _obterBigQueryCliente());
    const chaves = recusas.flatMap(r => (Array.isArray(r.notas) ? r.notas : []).map(n => n && n.chave));
    const notasResumo = await _buscarResumoNotasRetorno(textoSeguro(data?.lojaId, 120), chaves, admin.firestore());
    return {ok: true, recusas, notasResumo};
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
  .runWith({timeoutSeconds: 30, memory: '256MB'})
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
  const dataInicio = /^\d{4}-\d{2}-\d{2}$/.test(String(data?.dataInicio || '')) ? String(data.dataInicio) : '';
  const dataFim = /^\d{4}-\d{2}-\d{2}$/.test(String(data?.dataFim || '')) ? String(data.dataFim) : '';
  const params = Object.assign({}, restricao.params);
  let filtroPeriodo = '';
  if (dataInicio) { filtroPeriodo += " AND SUBSTR(JSON_EXTRACT_SCALAR(data, '$.criadoEm'), 1, 10) >= @dataInicio"; params.dataInicio = dataInicio; }
  if (dataFim) { filtroPeriodo += " AND SUBSTR(JSON_EXTRACT_SCALAR(data, '$.criadoEm'), 1, 10) <= @dataFim"; params.dataFim = dataFim; }
  const query = `
    SELECT document_id, data, path_params
    FROM \`daterrinha-inventario.dt_relatorios.recebimento_transbordo_cargas_raw_latest\`
    WHERE operation != 'DELETE'
      ${filtroStatus}
      ${filtroPeriodo}
      ${restricao.clausula}
  `;
  const [rows] = await bigqueryClient.query({query, params});
  return rows.map(r => Object.assign({_id: r.document_id, lojaId: JSON.parse(r.path_params).lojaId}, JSON.parse(r.data)));
}
exports.buscarCargasTodasLojasBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    const cargas = await _buscarCargasTodasLojasBigQueryInterno(data, acesso, _obterBigQueryCliente());
    return {ok: true, cargas};
  });

// ═══════════════════════════════════════════════════════════════════════
// Logística › Estoque › Relatórios (PEDIDO AO VIVO 2026-10-02) — coleta
// SÓ-LEITURA (GET) da Bluesoft, carregada no BigQuery (dataset
// dt_relatorios). Schema completo em
// functions/sql/estoque-relatorios-schema.sql; telas em
// public/js/analista/125-estoque-relatorios.js.
//
// Nomes de campo confirmados direto no OpenAPI real da Bluesoft
// (api-docs.json) — não são suposição: movimentoEstoqueKey/lojaKey/
// produtoKey/dataMovimento/dataLancamento/quantidade/valor/custoEstoque/
// custoEstoqueComIcm/custoContabil/tipoMovimentoKey/tipoMovimento/
// saldoEstoqueAnterior/saldoEstoque/fornecedorKey/produtoOrigem/
// produtoOrigemQtd/movimentoEstornoKey/tipoOrigemKey/tipoOrigem/origemKey
// (schema MovimentacoesDeEstoqueAnaliticoResponse). Envelope de paginação
// SEMPRE `{currentPage, pageSize, data:[...]}` (schema PaginationResponse*
// — confirmado nos 4 endpoints paginados usados aqui), query "plana"
// (currentPage/pageSize/lojaKey/... direto na querystring, sem
// aninhamento). `InventarioConsultarResponse` NÃO devolve `status` nem
// `numero` (só `inventarioKey`,`descricao`,`dataAbertura`,`dataFechamento`,
// `tipoDeInventario`,`lojaKey`) — por isso `numero` usa o próprio
// inventarioKey e `status` é inferido por `dataFechamento` presente/ausente.
// ═══════════════════════════════════════════════════════════════════════
const ESTOQUE_BQ_DATASET = 'dt_relatorios';

// BUG AO VIVO REAL (2026-10-03): "RangeError: Maximum call stack size
// exceeded" no encode() do firebase-functions — ver comentário completo em
// _buscarRelatorioEstoqueBigQueryInterno. Qualquer linha crua vinda de
// `SELECT *` numa tabela/view com coluna NUMERIC (Big.js) ou DATE/DATETIME/
// TIMESTAMP precisa passar por aqui antes de voltar numa resposta de
// onCall — função compartilhada pra não duplicar essa lógica.
function _achatarLinhaBigQuery(linha) {
  if (!linha) return linha;
  const r = {};
  Object.keys(linha).forEach(k => {
    const v = linha[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.value === 'string' && Object.keys(v).length === 1) {
      r[k] = v.value; // BigQueryDate/Datetime/Timestamp
    } else if (v && typeof v === 'object' && v.constructor && v.constructor.name === 'Big') {
      r[k] = Number(v.toString()); // NUMERIC/BIGNUMERIC (Big.js)
    } else {
      r[k] = v;
    }
  });
  return r;
}

// ── Config / chamada à Bluesoft (servidor) ──────────────────────────────
// Mesmo formato de dt_config/integracao_api já usado pelo navegador
// (90-bluesoft-service.js), lido aqui via Admin SDK em vez de
// getDTRawFirestore(). NÃO passa pelo bluesoftProxy (HTTPS) — chama a
// Bluesoft direto, do mesmo jeito que o próprio bluesoftProxy já faz
// server-side (fetch + header x-CustomToken).
async function _lerConfigIntegracaoApiEstoque(lojaId, firestoreDb) {
  const fdb = firestoreDb || db;
  if (lojaId) {
    const porLoja = await fdb.collection('lojas').doc(lojaId).collection('dt_config').doc('integracao_api').get().catch(() => null);
    if (porLoja && porLoja.exists) return porLoja.data() || {};
  }
  const globalSnap = await fdb.collection('dt_config').doc('integracao_api').get().catch(() => null);
  return globalSnap && globalSnap.exists ? (globalSnap.data() || {}) : {};
}
function _baseUrlBluesoftEstoque(cfg) {
  return cfg.ambiente === 'producao' ? (cfg.url_prd || '') : (cfg.url_hml || '');
}
async function _bluesoftGetUmaVez(pathComQuery, cfg) {
  const baseUrl = _baseUrlBluesoftEstoque(cfg);
  if (!baseUrl) throw new Error('URL não encontrada na configuração de integração (dt_config/integracao_api).');
  if (!cfg.token) throw new Error('Token não encontrado na configuração de integração (dt_config/integracao_api).');
  let resposta;
  try {
    resposta = await fetch(baseUrl.replace(/\/+$/, '') + pathComQuery, {method: 'GET', headers: {'x-CustomToken': String(cfg.token)}});
  } catch (e) {
    throw Object.assign(new Error('Falha de rede ao chamar Bluesoft em ' + pathComQuery.split('?')[0] + ': ' + (e.message || e)), {retentavel: true});
  }
  const texto = await resposta.text();
  let dados; try { dados = texto ? JSON.parse(texto) : null; } catch (_) { dados = texto; }
  if (!resposta.ok) {
    if (resposta.status === 401) throw Object.assign(new Error('Bluesoft: token inválido ou expirado.'), {status: 401});
    const detalhe = dados && (dados.erro || dados.message) ? (dados.erro || dados.message) : String(texto).slice(0, 300);
    throw Object.assign(new Error('Bluesoft HTTP ' + resposta.status + ' em ' + pathComQuery.split('?')[0] + (detalhe ? ': ' + detalhe : '')), {status: resposta.status, retentavel: resposta.status === 429 || resposta.status >= 500});
  }
  return dados;
}
// PEDIDO AO VIVO: "a função de sincronização deve ter uma trava que recuse
// qualquer outro método antes de chamar a Bluesoft". Não existe NENHUM
// parâmetro de método em NENHUMA função de coleta abaixo — só GET,
// sempre; o `if` abaixo é a 2ª camada de defesa caso este código seja
// copiado/alterado descuidadamente no futuro.
async function _bluesoftGetSomenteLeitura(pathComQuery, cfg, metodo, _tentativa) {
  if ((metodo || 'GET') !== 'GET') {
    throw new Error('Trava de segurança: esta integração só pode fazer GET na Bluesoft (recusado: "' + metodo + '").');
  }
  _tentativa = _tentativa || 1;
  try {
    return await _bluesoftGetUmaVez(pathComQuery, cfg);
  } catch (e) {
    if (e.retentavel && _tentativa < 3) {
      await new Promise(r => setTimeout(r, 500 * _tentativa));
      return _bluesoftGetSomenteLeitura(pathComQuery, cfg, 'GET', _tentativa + 1);
    }
    throw e;
  }
}

// ── Datas (dd/MM/yyyy [HH:mm[:ss]] -> DATE/DATETIME de verdade) ─────────
function _dataBrDeDate(d) {
  return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
}
function _dataBrParaIso(dataBr) {
  const m = String(dataBr || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? (m[3] + '-' + m[2] + '-' + m[1]) : null;
}
function _dataHoraBrParaIso(valor) {
  const s = String(valor || '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T]?(\d{2}:\d{2}(?::\d{2})?)?/);
  if (!m) return null;
  const hora = m[4] ? (m[4].length === 5 ? m[4] + ':00' : m[4]) : '00:00:00';
  return m[3] + '-' + m[2] + '-' + m[1] + ' ' + hora;
}

// ── Coleta: movimentos do dia (paginação plana + dedupe por chave) ──────
async function _coletarMovimentosAnaliticoDia(bluesoftLojaKey, dataBr, cfg) {
  const porChave = new Map();
  const PAGE_SIZE = 500;
  // ACHADO AO VIVO (2026-10-03): a paginação FICOU PRESA num dia real —
  // a trava de "página veio com menos de 500 itens" nunca disparava.
  // Duas proteções novas, além do dedupe (que já existia): (1) limite
  // absoluto de páginas, nunca confiar cegamente num "while(true)" contra
  // uma API de terceiro; (2) se uma página cheia não trouxe NENHUM item
  // novo (Bluesoft repetindo a mesma página / ignorando currentPage),
  // para na hora — não espera a página ficar menor que PAGE_SIZE, que é
  // exatamente a condição que nunca aconteceu no caso real.
  const MAX_PAGINAS = 200; // 200×500 = 100.000 itens no dia — folga enorme pra um dia real
  let currentPage = 0;
  while (currentPage < MAX_PAGINAS) {
    const resp = await _bluesoftGetSomenteLeitura(
      '/api/estoques/movimentacoesdeestoque/analitico?currentPage=' + currentPage + '&pageSize=' + PAGE_SIZE +
      '&lojaKey=' + encodeURIComponent(bluesoftLojaKey) + '&dataMovimento=' + encodeURIComponent(dataBr),
      cfg
    );
    const itens = (resp && Array.isArray(resp.data)) ? resp.data : [];
    const tamanhoAntes = porChave.size;
    itens.forEach(it => {
      const chave = it.movimentoEstoqueKey != null ? String(it.movimentoEstoqueKey) : '';
      if (chave) porChave.set(chave, it);
    });
    if (itens.length < PAGE_SIZE) break;
    if (porChave.size === tamanhoAntes) break;
    currentPage++;
  }
  return [...porChave.values()];
}
function _normalizarMovimentoEstoque(it, lojaId, agoraIso) {
  return {
    movimento_estoque_key: String(it.movimentoEstoqueKey),
    loja_key: lojaId,
    produto_key: it.produtoKey != null ? String(it.produtoKey) : null,
    data_movimento: _dataBrParaIso(it.dataMovimento),
    data_lancamento: _dataHoraBrParaIso(it.dataLancamento),
    quantidade: Number(it.quantidade) || 0,
    valor: Number(it.valor) || 0,
    custo_estoque: Number(it.custoEstoque) || 0,
    custo_estoque_com_icm: Number(it.custoEstoqueComIcm) || 0,
    custo_contabil: Number(it.custoContabil) || 0,
    saldo_anterior: Number(it.saldoEstoqueAnterior) || 0,
    saldo_posterior: Number(it.saldoEstoque) || 0,
    tipo_movimento_key: Number(it.tipoMovimentoKey),
    tipo_movimento: it.tipoMovimento || null,
    tipo_origem_key: it.tipoOrigemKey != null ? Number(it.tipoOrigemKey) : null,
    tipo_origem: it.tipoOrigem || null,
    origem_key: it.origemKey != null ? String(it.origemKey) : null,
    fornecedor_key: it.fornecedorKey != null ? String(it.fornecedorKey) : null,
    produto_origem: it.produtoOrigem != null ? String(it.produtoOrigem) : null,
    produto_origem_qtd: it.produtoOrigemQtd != null ? Number(it.produtoOrigemQtd) : null,
    movimento_estorno_key: it.movimentoEstornoKey != null ? String(it.movimentoEstornoKey) : null,
    coletado_em: agoraIso,
  };
}

const ESTOQUE_MOVIMENTOS_SCHEMA_BQ = [
  {name: 'movimento_estoque_key', type: 'STRING'}, {name: 'loja_key', type: 'STRING'}, {name: 'produto_key', type: 'STRING'},
  {name: 'data_movimento', type: 'DATE'}, {name: 'data_lancamento', type: 'DATETIME'},
  {name: 'quantidade', type: 'NUMERIC'}, {name: 'valor', type: 'NUMERIC'},
  {name: 'custo_estoque', type: 'NUMERIC'}, {name: 'custo_estoque_com_icm', type: 'NUMERIC'}, {name: 'custo_contabil', type: 'NUMERIC'},
  {name: 'saldo_anterior', type: 'NUMERIC'}, {name: 'saldo_posterior', type: 'NUMERIC'},
  {name: 'tipo_movimento_key', type: 'INTEGER'}, {name: 'tipo_movimento', type: 'STRING'},
  {name: 'tipo_origem_key', type: 'INTEGER'}, {name: 'tipo_origem', type: 'STRING'}, {name: 'origem_key', type: 'STRING'},
  {name: 'fornecedor_key', type: 'STRING'}, {name: 'produto_origem', type: 'STRING'}, {name: 'produto_origem_qtd', type: 'NUMERIC'},
  {name: 'movimento_estorno_key', type: 'STRING'}, {name: 'coletado_em', type: 'TIMESTAMP'},
];

// Carga incremental de verdade (padrão NOVO neste projeto — toda carga de
// BI existente até aqui era WRITE_TRUNCATE/substitui a tabela inteira).
// Staging + MERGE por movimento_estoque_key: um movimento já lançado na
// Bluesoft nunca muda de valor depois (confirmado no pedido), então só
// precisa INSERT quando não existe ainda — nunca UPDATE. Staging SEMPRE
// apagada no finally, mesmo se o MERGE falhar.
async function _carregarMovimentosEstoqueNoBigQuery(bigqueryClient, linhasNormalizadas) {
  if (!linhasNormalizadas.length) return {total: 0};
  if (!bigqueryClient) bigqueryClient = _obterBigQueryCliente();
  const dataset = bigqueryClient.dataset(ESTOQUE_BQ_DATASET);
  const nomeStaging = 'estoque_movimentos_staging_' + Date.now() + '_' + process.pid;
  const tabelaStaging = dataset.table(nomeStaging);
  const tmp = path.join(os.tmpdir(), `estoque_movimentos_${Date.now()}_${process.pid}.ndjson`);
  const stream = fsNode.createWriteStream(tmp, {encoding: 'utf8'});
  try {
    for (const r of linhasNormalizadas) {
      if (!stream.write(JSON.stringify(r) + '\n')) await new Promise(resolve => stream.once('drain', resolve));
    }
    await new Promise((resolve, reject) => { stream.end(resolve); stream.on('error', reject); });
    await tabelaStaging.load(tmp, {
      sourceFormat: 'NEWLINE_DELIMITED_JSON', schema: {fields: ESTOQUE_MOVIMENTOS_SCHEMA_BQ},
      writeDisposition: 'WRITE_TRUNCATE', createDisposition: 'CREATE_IF_NEEDED',
    });
    const mergeSql = `MERGE \`${ESTOQUE_BQ_DATASET}.estoque_movimentos\` destino
      USING \`${ESTOQUE_BQ_DATASET}.${nomeStaging}\` origem
      ON destino.movimento_estoque_key = origem.movimento_estoque_key
      WHEN NOT MATCHED THEN INSERT ROW`;
    await bigqueryClient.query({query: mergeSql});
    return {total: linhasNormalizadas.length};
  } finally {
    try { if (!stream.destroyed) stream.destroy(); } catch (_) {}
    try { fsNode.unlinkSync(tmp); } catch (_) {}
    try { await tabelaStaging.delete(); } catch (_) {}
  }
}

// ── Coleta: tipos de movimento (dimensão pequena, WRITE_TRUNCATE normal — não precisa de MERGE) ──
async function _coletarTiposMovimentoEstoque(cfg) {
  const resp = await _bluesoftGetSomenteLeitura('/api/estoques/movimentacoesdeestoque/tipos', cfg);
  return Array.isArray(resp) ? resp : (Array.isArray(resp && resp.data) ? resp.data : []);
}
async function _sincronizarTiposMovimentoEstoqueBigQuery(bigqueryClient, cfg) {
  const tipos = await _coletarTiposMovimentoEstoque(cfg);
  const agora = new Date().toISOString();
  const linhas = tipos.map(t => ({tipo_movimento_key: Number(t.tipoMovimentoKey), descricao: t.descricao || null, coletado_em: agora}));
  if (!bigqueryClient) bigqueryClient = _obterBigQueryCliente();
  const table = bigqueryClient.dataset(ESTOQUE_BQ_DATASET).table('estoque_tipos_movimento');
  const tmp = path.join(os.tmpdir(), `estoque_tipos_${Date.now()}_${process.pid}.ndjson`);
  const stream = fsNode.createWriteStream(tmp, {encoding: 'utf8'});
  try {
    for (const r of linhas) { if (!stream.write(JSON.stringify(r) + '\n')) await new Promise(resolve => stream.once('drain', resolve)); }
    await new Promise((resolve, reject) => { stream.end(resolve); stream.on('error', reject); });
    await table.load(tmp, {
      sourceFormat: 'NEWLINE_DELIMITED_JSON',
      schema: {fields: [{name: 'tipo_movimento_key', type: 'INTEGER'}, {name: 'descricao', type: 'STRING'}, {name: 'coletado_em', type: 'TIMESTAMP'}]},
      writeDisposition: 'WRITE_TRUNCATE', createDisposition: 'CREATE_IF_NEEDED',
    });
    return {total: linhas.length};
  } finally {
    try { if (!stream.destroyed) stream.destroy(); } catch (_) {}
    try { fsNode.unlinkSync(tmp); } catch (_) {}
  }
}

// ── Coleta: inventários (cabeçalho + itens só de fechados novos) ────────
// InventarioConsultarResponse NÃO tem `status`/`numero` — ver comentário
// grande no topo desta seção.
async function _coletarInventarios(bluesoftLojaKey, cfg, filtros) {
  filtros = filtros || {};
  const porChave = new Map();
  const PAGE_SIZE = 200;
  const MAX_PAGINAS = 200; // mesma proteção de _coletarMovimentosAnaliticoDia — ver comentário lá
  let currentPage = 0;
  while (currentPage < MAX_PAGINAS) {
    let qs = '/api/estoques/inventarios?currentPage=' + currentPage + '&pageSize=' + PAGE_SIZE +
      '&lojaKey=' + encodeURIComponent(bluesoftLojaKey) + '&status=TODOS';
    if (filtros.dataAberturaInicial) qs += '&dataAberturaInicial=' + encodeURIComponent(filtros.dataAberturaInicial);
    if (filtros.dataAberturaFinal) qs += '&dataAberturaFinal=' + encodeURIComponent(filtros.dataAberturaFinal);
    const resp = await _bluesoftGetSomenteLeitura(qs, cfg);
    const itens = (resp && Array.isArray(resp.data)) ? resp.data : [];
    const tamanhoAntes = porChave.size;
    itens.forEach(it => { if (it.inventarioKey != null) porChave.set(String(it.inventarioKey), it); });
    if (itens.length < PAGE_SIZE) break;
    if (porChave.size === tamanhoAntes) break;
    currentPage++;
  }
  return [...porChave.values()];
}
function _normalizarInventario(it, lojaId, agoraIso) {
  return {
    inventario_key: String(it.inventarioKey),
    loja_key: lojaId,
    numero: String(it.inventarioKey), // a Bluesoft não devolve um "número" separado
    descricao: it.descricao || null,
    tipo: it.tipoDeInventario || null,
    status: it.dataFechamento ? 'FECHADO' : 'ABERTO', // inferido — a API não devolve status na listagem
    data_abertura: _dataHoraBrParaIso(it.dataAbertura),
    data_fechamento: _dataHoraBrParaIso(it.dataFechamento),
    coletado_em: agoraIso,
  };
}
// PEDIDO AO VIVO (2026-10-03): "o inventário tá vindo sem nome aí quando
// clico não traz nenhum produto dentro dele" — MESMO BUG do produto: a
// coleta de cabeçalho de inventário (_coletarInventarios/_normalizarInventario,
// escrita na Fase C) nunca tinha sido ligada em lugar nenhum. A view faz
// LEFT JOIN com estoque_inventarios — tabela vazia = inventario_key sempre
// NULL no resultado = agrupamento "(vazio)" e nenhum drill-down encontra
// nada. Roda 1x por loja por sincronização (inventário é por loja, ao
// contrário de produto que é dimensão comercial global).
async function _sincronizarInventariosLoja(loja, dataInicialIso, dataFinalIso, cfg, bigqueryClient) {
  const filtros = {
    dataAberturaInicial: _dataBrDeDate(new Date(dataInicialIso + 'T00:00:00Z')),
    dataAberturaFinal: _dataBrDeDate(new Date(dataFinalIso + 'T00:00:00Z')),
  };
  const itens = await _coletarInventarios(loja.bluesoft_loja_key, cfg, filtros);
  const agora = new Date().toISOString();
  // Mesmo cuidado do bug de loja_key em movimentos: grava o código da
  // BLUESOFT (loja.bluesoft_loja_key), nunca o ID do documento no Firestore.
  const linhas = itens.map(it => _normalizarInventario(it, loja.bluesoft_loja_key, agora));
  await _mergeGenericoBigQuery(bigqueryClient, 'estoque_inventarios', ['inventario_key', 'loja_key'], [
    {name: 'inventario_key', type: 'STRING'}, {name: 'loja_key', type: 'STRING'}, {name: 'numero', type: 'STRING'},
    {name: 'descricao', type: 'STRING'}, {name: 'tipo', type: 'STRING'}, {name: 'status', type: 'STRING'},
    {name: 'data_abertura', type: 'DATETIME'}, {name: 'data_fechamento', type: 'DATETIME'}, {name: 'coletado_em', type: 'TIMESTAMP'},
  ], linhas);
  return {total: linhas.length};
}

async function _coletarInventarioProdutos(inventarioKey, cfg) {
  const porChave = new Map();
  const PAGE_SIZE = 200;
  const MAX_PAGINAS = 200; // mesma proteção de _coletarMovimentosAnaliticoDia — ver comentário lá
  let currentPage = 0;
  while (currentPage < MAX_PAGINAS) {
    const resp = await _bluesoftGetSomenteLeitura(
      '/api/estoques/inventarios/' + encodeURIComponent(inventarioKey) + '/produtos?currentPage=' + currentPage + '&pageSize=' + PAGE_SIZE,
      cfg
    );
    const itens = (resp && Array.isArray(resp.data)) ? resp.data : [];
    const tamanhoAntes = porChave.size;
    itens.forEach(it => { if (it.produtoKey != null) porChave.set(String(it.produtoKey), it); });
    if (itens.length < PAGE_SIZE) break;
    if (porChave.size === tamanhoAntes) break;
    currentPage++;
  }
  return [...porChave.values()];
}
function _normalizarInventarioItem(it, inventarioKey, lojaKey, agoraIso) {
  return {
    inventario_key: String(inventarioKey), produto_key: String(it.produtoKey), loja_key: lojaKey,
    quantidade_contada: it.quantidadeContada != null ? Number(it.quantidadeContada) : null,
    quantidade_sistema: it.quantidadeSistema != null ? Number(it.quantidadeSistema) : null,
    custo_bruto: it.custoBruto != null ? Number(it.custoBruto) : null,
    custo_liquido: it.custoLiquido != null ? Number(it.custoLiquido) : null,
    custo_contabil: it.custoContabil != null ? Number(it.custoContabil) : null,
    coletado_em: agoraIso,
  };
}
// PEDIDO AO VIVO (2026-10-03): "não tá trazendo quantidade sistema e
// contada" — 3ª instância da MESMA classe de bug (produto e cabeçalho de
// inventário já corrigidos antes): coleta escrita na Fase C
// (_coletarInventarioProdutos), nunca ligada em lugar nenhum. Só busca
// itens de inventário JÁ FECHADO (um aberto ainda muda) que ainda não
// tem nenhuma linha em estoque_inventario_itens — incremental, continua
// de onde parou a cada chamada, igual a sincronização de produto.
async function _sincronizarItensInventariosFechadosLoja(loja, cfg, bigqueryClient, limiteMs) {
  const inicio = Date.now();
  const [inventariosFaltando] = await bigqueryClient.query({
    query: `SELECT inventario_key FROM \`${ESTOQUE_BQ_DATASET}.estoque_inventarios\`
      WHERE loja_key = @lojaKey AND status = 'FECHADO'
      AND inventario_key NOT IN (
        SELECT DISTINCT inventario_key FROM \`${ESTOQUE_BQ_DATASET}.estoque_inventario_itens\` WHERE loja_key = @lojaKey
      )
      LIMIT 50`,
    params: {lojaKey: String(loja.bluesoft_loja_key)},
  });
  const agora = new Date().toISOString();
  let totalLinhas = 0;
  let processados = 0;
  for (const linha of inventariosFaltando) {
    if (limiteMs != null && Date.now() - inicio > limiteMs) break;
    processados++;
    const inventarioKey = linha.inventario_key;
    try {
      const itens = await _coletarInventarioProdutos(inventarioKey, cfg);
      const linhasNormalizadas = itens.map(it => _normalizarInventarioItem(it, inventarioKey, String(loja.bluesoft_loja_key), agora));
      await _mergeGenericoBigQuery(bigqueryClient, 'estoque_inventario_itens', ['inventario_key', 'produto_key', 'loja_key'], [
        {name: 'inventario_key', type: 'STRING'}, {name: 'produto_key', type: 'STRING'}, {name: 'loja_key', type: 'STRING'},
        {name: 'quantidade_contada', type: 'NUMERIC'}, {name: 'quantidade_sistema', type: 'NUMERIC'},
        {name: 'custo_bruto', type: 'NUMERIC'}, {name: 'custo_liquido', type: 'NUMERIC'}, {name: 'custo_contabil', type: 'NUMERIC'},
        {name: 'coletado_em', type: 'TIMESTAMP'},
      ], linhasNormalizadas);
      totalLinhas += linhasNormalizadas.length;
    } catch (e) {
      console.warn('[EstoqueBluesoft] Falha ao coletar itens do inventário ' + inventarioKey + ':', e && e.message ? e.message : e);
    }
  }
  // PEDIDO AO VIVO (2026-10-03): "vou precisar ficar atualizando várias
  // vezes?" — sinaliza pro chamador se ainda pode sobrar trabalho (lote
  // cheio de 50, ou parou no meio por tempo), pra "Atualizar agora" saber
  // que precisa chamar de novo sozinho, sem o usuário precisar clicar mais.
  const temMaisPendentes = processados < inventariosFaltando.length || inventariosFaltando.length >= 50;
  return {total: totalLinhas, temMaisPendentes};
}

// ── Coleta: notas de saída CFOP 5927/5949 (filtra no cliente — tipoNotaKey dá 400) ──
async function _coletarNotasBaixa(bluesoftLojaKey, dataRecebimentoInicial, dataRecebimentoFinal, cfg) {
  const porChave = new Map();
  const PAGE_SIZE = 200;
  let currentPage = 0;
  while (true) {
    const resp = await _bluesoftGetSomenteLeitura(
      '/api/estoques/notas-fiscais?currentPage=' + currentPage + '&pageSize=' + PAGE_SIZE +
      '&lojaKey=' + encodeURIComponent(bluesoftLojaKey) + '&tipoNota=SAIDA' +
      '&dataRecebimentoInicial=' + encodeURIComponent(dataRecebimentoInicial) + '&dataRecebimentoFinal=' + encodeURIComponent(dataRecebimentoFinal),
      cfg
    );
    const itens = (resp && Array.isArray(resp.data)) ? resp.data : [];
    itens.forEach(it => {
      const cfop = String(it.cfop || '').replace(/\D/g, '');
      if ((cfop === '5927' || cfop === '5949') && it.nfKey != null) porChave.set(String(it.nfKey), it);
    });
    if (itens.length < PAGE_SIZE) break;
    currentPage++;
  }
  return [...porChave.values()];
}
function _normalizarNotaBaixa(it, lojaId, agoraIso) {
  return {
    nf_key: String(it.nfKey), loja_key: lojaId,
    nf_numero: it.nfNumero != null ? String(it.nfNumero) : null, nf_serie: it.nfSerie || null,
    cfop: String(it.cfop || '').replace(/\D/g, ''), tipo_nota_key: it.tipoNotaKey != null ? Number(it.tipoNotaKey) : null,
    tipo_nota: it.tipoNota || null, data_emissao: _dataBrParaIso(it.dataEmissao), coletado_em: agoraIso,
  };
}

// ── Coleta: produto (só os que faltam na dimensão) ──────────────────────
async function _coletarProdutoDescricao(produtoKey, cfg) {
  const resp = await _bluesoftGetSomenteLeitura('/api/comercial/produtos/' + encodeURIComponent(produtoKey), cfg);
  return resp && resp.descricao ? String(resp.descricao) : null;
}
// Fator cadastrado é opcional (só pra comparar com o fator REAL calculado
// pela view) — qualquer falha aqui vira null, nunca interrompe a coleta.
async function _coletarFatorTransformacaoCadastrado(produtoOrigemKey, produtoDestinoKey, cfg) {
  try {
    const resp = await _bluesoftGetSomenteLeitura('/api/comercial/produtos/transformacao?produtoKey=' + encodeURIComponent(produtoOrigemKey), cfg);
    const lista = resp && Array.isArray(resp.produtoTransformacao) ? resp.produtoTransformacao : [];
    const achado = lista.find(p => String(p.produtoDestinoKey) === String(produtoDestinoKey));
    return achado && achado.fatorTransformacao != null ? Number(achado.fatorTransformacao) : null;
  } catch (_) { return null; }
}

// Carregador genérico WRITE_TRUNCATE-por-upsert-simples pras dimensões
// pequenas/médias que não precisam de MERGE incremental de verdade aqui
// (inventários/itens/notas/produtos) — grava só as linhas passadas,
// mesclando com o que já existe na tabela via MERGE por chave (mesmo
// raciocínio de _carregarMovimentosEstoqueNoBigQuery, reaproveitado
// genericamente pra não duplicar a lógica de staging 4 vezes).
async function _mergeGenericoBigQuery(bigqueryClient, nomeTabela, colunasChave, schemaFields, linhas) {
  if (!linhas.length) return {total: 0};
  if (!bigqueryClient) bigqueryClient = _obterBigQueryCliente();
  const dataset = bigqueryClient.dataset(ESTOQUE_BQ_DATASET);
  const nomeStaging = nomeTabela + '_staging_' + Date.now() + '_' + process.pid;
  const tabelaStaging = dataset.table(nomeStaging);
  const tmp = path.join(os.tmpdir(), `${nomeTabela}_${Date.now()}_${process.pid}.ndjson`);
  const stream = fsNode.createWriteStream(tmp, {encoding: 'utf8'});
  try {
    for (const r of linhas) { if (!stream.write(JSON.stringify(r) + '\n')) await new Promise(resolve => stream.once('drain', resolve)); }
    await new Promise((resolve, reject) => { stream.end(resolve); stream.on('error', reject); });
    await tabelaStaging.load(tmp, {
      sourceFormat: 'NEWLINE_DELIMITED_JSON', schema: {fields: schemaFields},
      writeDisposition: 'WRITE_TRUNCATE', createDisposition: 'CREATE_IF_NEEDED',
    });
    const onClausula = colunasChave.map(c => `destino.${c} = origem.${c}`).join(' AND ');
    const mergeSql = `MERGE \`${ESTOQUE_BQ_DATASET}.${nomeTabela}\` destino
      USING \`${ESTOQUE_BQ_DATASET}.${nomeStaging}\` origem
      ON ${onClausula}
      WHEN NOT MATCHED THEN INSERT ROW
      WHEN MATCHED THEN UPDATE SET ${schemaFields.map(f => f.name).filter(n => !colunasChave.includes(n)).map(n => `destino.${n} = origem.${n}`).join(', ')}`;
    await bigqueryClient.query({query: mergeSql});
    return {total: linhas.length};
  } finally {
    try { if (!stream.destroyed) stream.destroy(); } catch (_) {}
    try { fsNode.unlinkSync(tmp); } catch (_) {}
    try { await tabelaStaging.delete(); } catch (_) {}
  }
}

// PEDIDO AO VIVO (2026-10-03): "tem que mostrar pela descrição do produto,
// tá mostrando pelo código" — a view já faz LEFT JOIN com estoque_produtos
// e já seleciona produto_descricao, mas a coleta de descrição
// (_coletarProdutoDescricao, escrita na Fase C) nunca tinha sido ligada em
// lugar nenhum — por isso a dimensão ficava sempre vazia. `estoque_produtos`
// não tem loja_key (é dimensão comercial global na Bluesoft), então só
// precisa rodar 1x por sincronização, não por loja. Limitado por lote
// (LIMIT 500) e por tempo restante — nunca é motivo de a sincronização de
// movimentos inteira falhar.
async function _sincronizarProdutosFaltantesEstoque(bigqueryClient, cfg, limiteMs) {
  if (!bigqueryClient) bigqueryClient = _obterBigQueryCliente();
  const inicio = Date.now();
  const [linhasFaltantes] = await bigqueryClient.query({
    query: `SELECT DISTINCT produto_key FROM \`${ESTOQUE_BQ_DATASET}.estoque_movimentos\`
      WHERE produto_key IS NOT NULL AND produto_key NOT IN (
        SELECT produto_key FROM \`${ESTOQUE_BQ_DATASET}.estoque_produtos\`
      )
      LIMIT 500`,
  });
  const chaves = linhasFaltantes.map(l => l.produto_key).filter(Boolean);
  const agora = new Date().toISOString();
  const linhas = [];
  let processados = 0;
  for (const chave of chaves) {
    if (limiteMs != null && Date.now() - inicio > limiteMs) break;
    processados++;
    try {
      const descricao = await _coletarProdutoDescricao(chave, cfg);
      linhas.push({produto_key: chave, descricao, fator_transformacao_cadastrado: null, coletado_em: agora});
    } catch (e) {
      console.warn('[EstoqueBluesoft] Falha ao coletar descrição do produto ' + chave + ':', e && e.message ? e.message : e);
    }
  }
  await _mergeGenericoBigQuery(bigqueryClient, 'estoque_produtos', ['produto_key'], [
    {name: 'produto_key', type: 'STRING'}, {name: 'descricao', type: 'STRING'},
    {name: 'fator_transformacao_cadastrado', type: 'NUMERIC'}, {name: 'coletado_em', type: 'TIMESTAMP'},
  ], linhas);
  // PEDIDO AO VIVO (2026-10-03): "vou precisar ficar atualizando várias
  // vezes?" — mesmo sinal usado em _sincronizarItensInventariosFechadosLoja,
  // pra "Atualizar agora" continuar sozinho sem o usuário precisar clicar
  // de novo manualmente a cada lote.
  const temMaisPendentes = processados < chaves.length || chaves.length >= 500;
  return {total: linhas.length, pendentes: chaves.length - linhas.length, temMaisPendentes};
}

// ── Orquestração: 1 dia, 1 loja — movimentos + reconciliação leve dos demais ──
async function _sincronizarEstoqueDiaLoja(loja, dataBr, cfg, bigqueryClient) {
  const agora = new Date().toISOString();
  const itens = await _coletarMovimentosAnaliticoDia(loja.bluesoft_loja_key, dataBr, cfg);
  // BUG AO VIVO REAL (2026-10-03): gravava loja.id (o ID do documento no
  // Firestore, ex. "loja_matriz") em vez de loja.bluesoft_loja_key (ex.
  // "14") — e _buscarRelatorioEstoqueBigQueryInterno sempre filtra pelo
  // código da Bluesoft (lojaDoc.data().bluesoft_loja_key). Os dois nunca
  // batiam: 246 mil linhas reais foram coletadas com sucesso, mas nenhum
  // relatório nunca mostrava nada, pra nenhuma loja. Achado comparando
  // direto no console do BigQuery (SELECT DISTINCT loja_key devolveu
  // "loja_matriz", não "14").
  const normalizados = itens.map(it => _normalizarMovimentoEstoque(it, loja.bluesoft_loja_key, agora));
  await _carregarMovimentosEstoqueNoBigQuery(bigqueryClient, normalizados);
  return {total: normalizados.length};
}

// PEDIDO AO VIVO: carga histórica com retomada — NÃO existe nenhum padrão
// pronto pra copiar no resto do projeto (confirmado: sincronizarComprasHistoricoBiAgora
// é um reload completo, sem range de data nem resume), desenho novo.
// Progresso gravado como objeto aninhado COMPLETO reescrito por `.set()`
// (nunca chave pontilhada em merge — ver o bug documentado em
// _sincronizarRelatorioBiChunkeadoGlobal mais acima no arquivo).
async function _sincronizarEstoqueBluesoftIntervalo(dataInicial, dataFinal, lojasAlvo, bigqueryClient, firestoreDb, limiteMs) {
  const fdb = firestoreDb || db;
  const inicioExec = Date.now();
  const progressoRef = fdb.collection('dt_config').doc('estoque_bluesoft_sync');
  const progressoSnap = await progressoRef.get();
  const progressoAtual = progressoSnap.exists ? (progressoSnap.data() || {}) : {};
  const porLoja = Object.assign({}, progressoAtual.porLoja || {});
  let concluido = true;
  let proximoDia = null;
  // PEDIDO AO VIVO (2026-10-03): sinais agregados de "ainda tem mais pra
  // buscar" (produto/itens de inventário) — devolvidos no resultado final
  // pra "Atualizar agora" saber que precisa chamar de novo sozinho, sem o
  // usuário precisar clicar manualmente várias vezes.
  let inventariosItensPendentes = false;

  for (const loja of lojasAlvo) {
    if (!loja.bluesoft_loja_key) continue;
    const cfg = await _lerConfigIntegracaoApiEstoque(loja.id, fdb);
    const estadoAnterior = porLoja[loja.id] || {};
    let diasComErro = Array.isArray(estadoAnterior.diasComErro) ? estadoAnterior.diasComErro.slice() : [];
    let cursor = new Date(dataInicial + 'T00:00:00Z');
    const fim = new Date(dataFinal + 'T00:00:00Z');
    // Só retoma a partir do checkpoint se ele pertencer a ESTE range (uma
    // execução anterior de um range diferente não pode fazer a gente
    // pular dias de um pedido novo).
    if (estadoAnterior.ultimoDiaConcluido && estadoAnterior.ultimoDiaConcluido >= dataInicial && estadoAnterior.ultimoDiaConcluido < dataFinal) {
      const proximo = new Date(estadoAnterior.ultimoDiaConcluido + 'T00:00:00Z');
      proximo.setUTCDate(proximo.getUTCDate() + 1);
      if (proximo > cursor) cursor = proximo;
    }
    while (cursor <= fim) {
      if (Date.now() - inicioExec > limiteMs) {
        concluido = false;
        proximoDia = cursor.toISOString().slice(0, 10);
        porLoja[loja.id] = {ultimoDiaConcluido: estadoAnterior.ultimoDiaConcluido || null, diasComErro};
        await progressoRef.set({porLoja, ultimaExecucaoEm: new Date().toISOString()});
        return {concluido, proximoDia, porLoja};
      }
      const diaIso = cursor.toISOString().slice(0, 10);
      const dataBr = _dataBrDeDate(cursor);
      try {
        await _sincronizarEstoqueDiaLoja(loja, dataBr, cfg, bigqueryClient);
        diasComErro = diasComErro.filter(d => d !== diaIso);
        porLoja[loja.id] = {ultimoDiaConcluido: diaIso, diasComErro};
      } catch (e) {
        if (!diasComErro.includes(diaIso)) diasComErro.push(diaIso);
        porLoja[loja.id] = {ultimoDiaConcluido: porLoja[loja.id] ? porLoja[loja.id].ultimoDiaConcluido : (estadoAnterior.ultimoDiaConcluido || null), diasComErro};
        console.warn('[EstoqueBluesoft] Falha ao coletar ' + diaIso + ' (loja ' + loja.id + '):', e && e.message ? e.message : e);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    // Loja terminou o range pedido sem estourar o tempo — completa o
    // cabeçalho de inventário dela pro mesmo período. Silencioso, nunca
    // derruba a sincronização de movimentos (que é o que importa pro
    // "concluido" devolvido daqui).
    try {
      await _sincronizarInventariosLoja(loja, dataInicial, dataFinal, cfg, bigqueryClient);
    } catch (e) {
      console.warn('[EstoqueBluesoft] Falha ao sincronizar inventários da loja ' + loja.id + ':', e && e.message ? e.message : e);
    }
    // Com o cabeçalho em dia, completa os ITENS (quantidade sistema/contada)
    // dos inventários já fechados que ainda não têm nenhum item gravado.
    try {
      const tempoRestanteLoja = limiteMs - (Date.now() - inicioExec);
      if (tempoRestanteLoja > 5000) {
        const resultadoItens = await _sincronizarItensInventariosFechadosLoja(loja, cfg, bigqueryClient, tempoRestanteLoja - 2000);
        if (resultadoItens && resultadoItens.temMaisPendentes) inventariosItensPendentes = true;
      } else {
        inventariosItensPendentes = true; // nem deu tempo de tentar
      }
    } catch (e) {
      console.warn('[EstoqueBluesoft] Falha ao sincronizar itens de inventário da loja ' + loja.id + ':', e && e.message ? e.message : e);
    }
  }
  // Preenche descrição de produto pros que faltam, com o tempo que sobrou
  // — nunca derruba a sincronização de movimentos (que é o que importa pro
  // "concluido" devolvido daqui).
  let produtosPendentes = false;
  try {
    const tempoRestante = limiteMs - (Date.now() - inicioExec);
    if (tempoRestante > 5000 && lojasAlvo.length) {
      const cfgQualquer = await _lerConfigIntegracaoApiEstoque(lojasAlvo[0].id, fdb);
      const resultadoProdutos = await _sincronizarProdutosFaltantesEstoque(bigqueryClient, cfgQualquer, tempoRestante - 2000);
      if (resultadoProdutos && resultadoProdutos.temMaisPendentes) produtosPendentes = true;
    } else if (lojasAlvo.length) {
      produtosPendentes = true; // nem deu tempo de tentar
    }
  } catch (e) {
    console.warn('[EstoqueBluesoft] Falha ao completar descrições de produto:', e && e.message ? e.message : e);
  }
  await progressoRef.set({porLoja, ultimaExecucaoEm: new Date().toISOString()});
  return {concluido, proximoDia, porLoja, produtosPendentes, inventariosItensPendentes};
}

exports.sincronizarEstoqueBluesoftAgendado = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 540, memory: '512MB'})
  .pubsub.schedule('0 3 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async () => {
    const lojasSnap = await db.collection('lojas').get();
    const lojas = lojasSnap.docs.map(d => ({id: d.id, ...d.data()})).filter(l => l.bluesoft_loja_key);
    const hojeUtc = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const fim = new Date(hojeUtc); fim.setUTCDate(fim.getUTCDate() - 1); // ontem
    const inicio = new Date(hojeUtc); inicio.setUTCDate(inicio.getUTCDate() - 4); // ontem + 3 dias antes (atraso/estorno)
    const resultado = await _sincronizarEstoqueBluesoftIntervalo(
      inicio.toISOString().slice(0, 10), fim.toISOString().slice(0, 10), lojas, _obterBigQueryCliente(), db, 480000
    );
    console.log('[EstoqueBluesoftAgendado] concluido=' + resultado.concluido);
    return null;
  });

exports.sincronizarEstoqueBluesoftAgora = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 540, memory: '512MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!administrador(acesso)) throw new functions.https.HttpsError('permission-denied', 'Seu login não pode rodar essa sincronização.');
    const dataInicial = textoSeguro(data && data.dataInicial, 10);
    const dataFinal = textoSeguro(data && data.dataFinal, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal) || dataInicial > dataFinal) {
      throw new functions.https.HttpsError('invalid-argument', 'Informe dataInicial/dataFinal válidos (AAAA-MM-DD, inicial <= final).');
    }
    const lojaIdFiltro = textoSeguro(data && data.lojaId, 120);
    const lojasSnap = await db.collection('lojas').get();
    let lojas = lojasSnap.docs.map(d => ({id: d.id, ...d.data()})).filter(l => l.bluesoft_loja_key);
    if (lojaIdFiltro) lojas = lojas.filter(l => l.id === lojaIdFiltro);
    const resultado = await _sincronizarEstoqueBluesoftIntervalo(dataInicial, dataFinal, lojas, _obterBigQueryCliente(), db, 480000);
    return {
      ok: true, concluido: resultado.concluido, proximoDia: resultado.proximoDia || null,
      produtosPendentes: !!resultado.produtosPendentes, inventariosItensPendentes: !!resultado.inventariosItensPendentes,
    };
  });

// ── Consulta pras telas (views no lugar das tabelas cruas) ──────────────
const ESTOQUE_VIEWS_PERMITIDAS = {
  inventario: 'vw_estoque_rel_inventario',
  descarte: 'vw_estoque_rel_descarte',
  requisicao: 'vw_estoque_rel_requisicao',
  transformacao: 'vw_estoque_rel_transformacao',
};
async function _buscarRelatorioEstoqueBigQueryInterno(data, acesso, bigqueryClient, firestoreDb) {
  const fdb = firestoreDb || db;
  const relatorio = textoSeguro(data && data.relatorio, 30);
  const viewNome = ESTOQUE_VIEWS_PERMITIDAS[relatorio];
  if (!viewNome) throw new functions.https.HttpsError('invalid-argument', 'Relatório inválido. Use inventario/descarte/requisicao/transformacao.');

  // PEDIDO AO VIVO (2026-10-03): "filtro de loja pra todos" — lojaId agora é
  // OPCIONAL. Sem ele, busca em TODAS as lojas que o login enxerga (mesmo
  // padrão de permissão de buscarCargasTodasLojasBigQuery/
  // buscarTransbordoTodasLojasBigQuery: a Cloud Function roda com conta de
  // serviço, então PRECISA repetir a checagem de permissão — nunca confiar
  // só no filtro que o cliente mandou).
  const lojaIdPedida = data && data.lojaId ? textoSeguro(data.lojaId, 120) : null;
  const lojasSnap = await fdb.collection('lojas').get();
  const lojasComBluesoft = lojasSnap.docs
    .map(d => ({id: d.id, nome: (d.data() || {}).nome || d.id, bluesoft_loja_key: (d.data() || {}).bluesoft_loja_key || null}))
    .filter(l => l.bluesoft_loja_key);
  let lojasAlvo;
  if (lojaIdPedida) {
    if (!_lojaPermitidaParaAcesso(acesso, lojaIdPedida)) throw new functions.https.HttpsError('permission-denied', 'Sem acesso a esta loja.');
    lojasAlvo = lojasComBluesoft.filter(l => l.id === lojaIdPedida);
    if (!lojasAlvo.length) throw new functions.https.HttpsError('failed-precondition', 'Esta loja não tem bluesoft_loja_key configurada.');
  } else {
    const todasLojas = adminMestre(acesso) || acesso?.acesso_todas_lojas === true;
    const permitidas = lojasPermitidas(acesso);
    lojasAlvo = todasLojas ? lojasComBluesoft : lojasComBluesoft.filter(l => permitidas.has(l.id));
    if (!lojasAlvo.length) throw new functions.https.HttpsError('permission-denied', 'Sem acesso a nenhuma loja com integração configurada.');
  }
  const mapaLojaPorBluesoftKey = new Map(lojasAlvo.map(l => [String(l.bluesoft_loja_key), l]));
  const bluesoftKeys = lojasAlvo.map(l => String(l.bluesoft_loja_key));

  const dataInicial = textoSeguro(data && data.dataInicial, 10);
  const dataFinal = textoSeguro(data && data.dataFinal, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal) || dataInicial > dataFinal) {
    throw new functions.https.HttpsError('invalid-argument', 'Informe dataInicial/dataFinal válidos (AAAA-MM-DD, inicial <= final).');
  }
  const dias = Math.round((new Date(dataFinal) - new Date(dataInicial)) / 86400000);
  if (dias > 366) throw new functions.https.HttpsError('invalid-argument', 'Período máximo de 366 dias.');

  const ehTransformacao = relatorio === 'transformacao';
  const produto = data && data.produto ? textoSeguro(data.produto, 120) : null;
  const incluirEstornos = data && data.incluirEstornos === true;
  // PEDIDO AO VIVO (2026-10-03): "o da transformação colocar filtros pra
  // saber quais produtos quero e não quero com seleção múltipla" — só pro
  // relatório de transformação (os outros 3 continuam com o campo de busca
  // livre de sempre, por cima do mesmo `produto`).
  const produtosIncluir = ehTransformacao && Array.isArray(data && data.produtosIncluir)
    ? data.produtosIncluir.map(p => textoSeguro(p, 120)).filter(Boolean).slice(0, 200) : [];
  const produtosExcluir = ehTransformacao && Array.isArray(data && data.produtosExcluir)
    ? data.produtosExcluir.map(p => textoSeguro(p, 120)).filter(Boolean).slice(0, 200) : [];
  // PEDIDO AO VIVO (2026-10-03): "quando tiver por inventário ter a opção
  // de selecionar ele e mostrar só os produtos naquele inventário" — só pro
  // relatório de inventário, filtra por 1 inventário específico.
  const inventarioKey = relatorio === 'inventario' && data && data.inventarioKey ? textoSeguro(data.inventarioKey, 120) : null;

  const condicoes = ['loja_key IN UNNEST(@lojaKeys)', 'data_movimento BETWEEN @dataInicial AND @dataFinal'];
  const params = {lojaKeys: bluesoftKeys, dataInicial, dataFinal};
  if (produtosIncluir.length) { condicoes.push('(produto_origem_key IN UNNEST(@produtosIncluir) OR produto_destino_key IN UNNEST(@produtosIncluir))'); params.produtosIncluir = produtosIncluir; }
  if (produtosExcluir.length) { condicoes.push('NOT (produto_origem_key IN UNNEST(@produtosExcluir) OR produto_destino_key IN UNNEST(@produtosExcluir))'); params.produtosExcluir = produtosExcluir; }
  if (!produtosIncluir.length && !produtosExcluir.length && produto) {
    if (ehTransformacao) { condicoes.push('(produto_origem_key = @produto OR produto_destino_key = @produto)'); }
    else { condicoes.push('(produto_key = @produto OR produto_descricao LIKE @produtoLike)'); params.produtoLike = '%' + produto + '%'; }
    params.produto = produto;
  }
  if (inventarioKey) { condicoes.push('inventario_key = @inventarioKey'); params.inventarioKey = inventarioKey; }
  if (!incluirEstornos) condicoes.push(ehTransformacao ? 'saida_eh_estorno = FALSE' : 'eh_estorno = FALSE');

  const query = `SELECT * FROM \`${ESTOQUE_BQ_DATASET}.${viewNome}\` WHERE ${condicoes.join(' AND ')} ORDER BY data_movimento DESC LIMIT 20000`;
  const [linhasCruas] = await bigqueryClient.query({query, params});
  const linhas = linhasCruas.map(_achatarLinhaBigQuery).map(l => {
    const lojaInfo = mapaLojaPorBluesoftKey.get(String(l.loja_key));
    l.loja_id = lojaInfo ? lojaInfo.id : null;
    l.loja_nome = lojaInfo ? lojaInfo.nome : (l.loja_key || null);
    return l;
  });

  const campoQtd = ehTransformacao ? 'saida_quantidade' : 'quantidade';
  const campoValor = ehTransformacao ? 'saida_valor' : 'valor';
  const campoProduto = ehTransformacao ? 'produto_origem_key' : 'produto_key';
  const produtosDistintos = new Set();
  let somaQtd = 0, somaValor = 0;
  linhas.forEach(l => {
    somaQtd += Number(l[campoQtd]) || 0;
    somaValor += Number(l[campoValor]) || 0;
    if (l[campoProduto]) produtosDistintos.add(l[campoProduto]);
  });
  const totais = {lancamentos: linhas.length, quantidade: somaQtd, valor: somaValor, produtosDistintos: produtosDistintos.size};

  const progressoSnap = await fdb.collection('dt_config').doc('estoque_bluesoft_sync').get();
  const progresso = progressoSnap.exists ? (progressoSnap.data() || {}) : {};
  // Com várias lojas, "atualizado em" mostra a mais ATRASADA entre elas —
  // visão conservadora (nunca passa a impressão de um dado mais fresco do
  // que a loja que ficou pra trás).
  let ultimaAtualizacao = null;
  lojasAlvo.forEach(l => {
    const estadoLoja = progresso.porLoja && progresso.porLoja[l.id];
    const diaDaLoja = estadoLoja && estadoLoja.ultimoDiaConcluido;
    if (diaDaLoja && (!ultimaAtualizacao || diaDaLoja < ultimaAtualizacao)) ultimaAtualizacao = diaDaLoja;
  });
  if (!ultimaAtualizacao) ultimaAtualizacao = progresso.ultimaExecucaoEm || null;

  return {linhas, totais, ultimaAtualizacao};
}
// FERRAMENTA TEMPORÁRIA (2026-10-05) — diagnóstico SOMENTE LEITURA do vínculo
// pedido Força de Vendas → roteiro/viagem/carga/lote antes do faturamento.
// Não grava nada. Remover depois que o vínculo estiver confirmado.
exports.diagnosticoVinculoPedidoBluesoftTemporaria = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 300, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!administrador(acesso)) throw new functions.https.HttpsError('permission-denied', 'Só administrador pode rodar este diagnóstico.');
    const lojaId = textoSeguro(data && data.lojaId, 120) || null;
    const pedidoKey = textoSeguro(data && data.pedidoKey, 40) || '980105';
    const alvo = textoSeguro(data && data.alvo, 40) || '457277';
    const cdKey = data && data.cdKey != null ? String(data.cdKey) : null;
    const lojaKey = data && data.lojaKey != null ? String(data.lojaKey) : null;
    const dataInicio = textoSeguro(data && data.dataInicio, 10) || null; // dd/MM/yyyy
    const dataFim = textoSeguro(data && data.dataFim, 10) || null;       // dd/MM/yyyy

    const cfg = await _lerConfigIntegracaoApiEstoque(lojaId, db);
    const resultado = {alvo, pedidoKey, consultas: {}, camposComRelacao: [], todasAsChavesDoPedido: []};

    async function consulta(nome, path) {
      try {
        const r = await _bluesoftGetSomenteLeitura(path, cfg);
        const texto = JSON.stringify(r) || '';
        resultado.consultas[nome] = {ok: true, path, contemAlvo: texto.includes(alvo), resposta: r};
        return r;
      } catch (e) {
        resultado.consultas[nome] = {ok: false, path, status: e.status || null, erro: e.message || String(e)};
        return null;
      }
    }
    // Varre o objeto inteiro (inclusive aninhado) e junta chaves com pistas de vínculo.
    function varrer(obj, caminho, pistas) {
      if (obj === null || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach((x, i) => varrer(x, caminho + '[' + i + ']', pistas)); return; }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        const cam = caminho ? caminho + '.' + k : k;
        if (/roteiro|viagem|carga|lote|ordem|separ|expedi|wms|nota|nf/i.test(k) && (v === null || typeof v !== 'object')) pistas.push({campo: cam, valor: v});
        varrer(v, cam, pistas);
      }
    }
    function todasAsChaves(obj, caminho, out) {
      if (obj === null || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.slice(0, 3).forEach((x, i) => todasAsChaves(x, caminho + '[' + i + ']', out)); return; }
      for (const k of Object.keys(obj)) { const cam = caminho ? caminho + '.' + k : k; out.push(cam); todasAsChaves(obj[k], cam, out); }
    }

    const pedido = await consulta('pedidoForcaVenda', '/api/forca-de-vendas/pedidos/' + encodeURIComponent(pedidoKey));
    if (pedido) {
      const pistas = [];
      varrer(pedido, '', pistas);
      resultado.camposComRelacao = pistas;
      todasAsChaves(pedido, '', resultado.todasAsChavesDoPedido);
      resultado.todasAsChavesDoPedido = [...new Set(resultado.todasAsChavesDoPedido)];
    }

    // Reservas WMS: a consulta exige filtro (datas em dd/MM/yyyy); não tem filtro por carga.
    if (dataInicio && dataFim && cdKey) {
      const qsReserva = 'currentPage=0&pageSize=200&cdOrigemKey=' + encodeURIComponent(cdKey) +
        '&dataGeracaoInicio=' + encodeURIComponent(dataInicio) + '&dataGeracaoFim=' + encodeURIComponent(dataFim);
      await consulta('reservasWms', '/api/logistica/estoque/wms/consulta-estoque-reservado?' + qsReserva);
    }

    // Lotes logísticos: exige cdKey.
    if (cdKey) {
      const qsLotes = 'currentPage=0&pageSize=50&cdKey=' + encodeURIComponent(cdKey) + (lojaKey ? '&lojaKey=' + encodeURIComponent(lojaKey) : '');
      await consulta('lotesLogisticos', '/api/wms/externo/loteslogisticos?' + qsLotes);
    }

    return resultado;
  });

exports.buscarRelatorioEstoqueBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 30, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    return _buscarRelatorioEstoqueBigQueryInterno(data, acesso, _obterBigQueryCliente(), db);
  });

// RECONSTRUÇÃO (2026-10-08): existia em produção (a tela "📊 Análise de
// Inventários" em 125-estoque-relatorios.js já a chama, com um gate de versão
// — ANALISE_RELEASE_ESPERADO abaixo precisa bater com o que o front espera),
// mas sumiu do código-fonte local numa edição anterior sem redeploy — nenhum
// backup/zip encontrado tinha o original. Reconstruída lendo o CONTRATO
// exato no front (campos consumidos de d.inventarios/d.produtos/d.itens/etc.)
// e reaproveitando o mesmo padrão de permissão/loja/achatamento já usado em
// _buscarRelatorioEstoqueBigQueryInterno. Simplificação assumida e documentada:
// "historicoProdutos" volta vazio (o front já trata isso defensivamente com
// Array.isArray(...)||[]) — não há registro de qual série temporal essa lista
// deveria conter, e inventar o formato seria pior do que não preencher.
// Custo usado pra valor de perda/ganho: custo_liquido (dentre bruto/líquido/
// contábil disponíveis em estoque_inventario_itens) — ajustar se o critério
// real for outro.
const ANALISE_INVENTARIOS_RELEASE = '20261005-v7-carregamento-rapido';
function _analiseAgregadoInventarioSql(dataset) {
  return `SELECT
      i.inventario_key AS inventario_key, i.loja_key AS loja_key,
      i.numero AS inventario_numero, i.descricao AS inventario_descricao,
      i.status AS status, i.data_abertura AS data_abertura, i.data_fechamento AS data_fechamento,
      COUNT(it.produto_key) AS produtos_total,
      COUNTIF(it.quantidade_contada = it.quantidade_sistema) AS produtos_corretos,
      COUNTIF(it.quantidade_contada < it.quantidade_sistema) AS produtos_perda,
      COUNTIF(it.quantidade_contada > it.quantidade_sistema) AS produtos_ganho,
      COUNTIF(it.quantidade_contada IS NULL OR it.quantidade_sistema IS NULL) AS produtos_sem_dados,
      SUM(CASE WHEN it.quantidade_contada < it.quantidade_sistema THEN it.quantidade_sistema - it.quantidade_contada ELSE 0 END) AS perda_quantidade,
      SUM(CASE WHEN it.quantidade_contada > it.quantidade_sistema THEN it.quantidade_contada - it.quantidade_sistema ELSE 0 END) AS ganho_quantidade,
      SUM(CASE WHEN it.quantidade_contada < it.quantidade_sistema THEN (it.quantidade_sistema - it.quantidade_contada) * it.custo_liquido ELSE 0 END) AS perda_valor,
      SUM(CASE WHEN it.quantidade_contada > it.quantidade_sistema THEN (it.quantidade_contada - it.quantidade_sistema) * it.custo_liquido ELSE 0 END) AS ganho_valor,
      MAX(it.coletado_em) AS coletado_em
    FROM \`${dataset}.estoque_inventarios\` i
    JOIN \`${dataset}.estoque_inventario_itens\` it ON it.inventario_key = i.inventario_key AND it.loja_key = i.loja_key`;
}
function _analiseCalcularAcuracidade(linha) {
  const total = Number(linha.produtos_total) || 0;
  linha.acuracidade_itens = total > 0 ? (Number(linha.produtos_corretos) || 0) * 100 / total : null;
  return linha;
}
async function _buscarAnaliseInventariosBigQueryInterno(data, acesso, bigqueryClient, firestoreDb) {
  const fdb = firestoreDb || db;
  const lojasSnap = await fdb.collection('lojas').get();
  const lojasComBluesoft = lojasSnap.docs
    .map(d => ({id: d.id, nome: (d.data() || {}).nome || d.id, bluesoft_loja_key: (d.data() || {}).bluesoft_loja_key || null}))
    .filter(l => l.bluesoft_loja_key);
  const lojaIdPedida = data && data.lojaId ? textoSeguro(data.lojaId, 120) : null;
  let lojasAlvo;
  if (lojaIdPedida) {
    if (!_lojaPermitidaParaAcesso(acesso, lojaIdPedida)) throw new functions.https.HttpsError('permission-denied', 'Sem acesso a esta loja.');
    lojasAlvo = lojasComBluesoft.filter(l => l.id === lojaIdPedida);
    if (!lojasAlvo.length) throw new functions.https.HttpsError('failed-precondition', 'Esta loja não tem bluesoft_loja_key configurada.');
  } else {
    const todasLojas = adminMestre(acesso) || acesso?.acesso_todas_lojas === true;
    const permitidas = lojasPermitidas(acesso);
    lojasAlvo = todasLojas ? lojasComBluesoft : lojasComBluesoft.filter(l => permitidas.has(l.id));
    if (!lojasAlvo.length) throw new functions.https.HttpsError('permission-denied', 'Sem acesso a nenhuma loja com integração configurada.');
  }
  const mapaLojaPorBluesoftKey = new Map(lojasAlvo.map(l => [String(l.bluesoft_loja_key), l]));
  const bluesoftKeys = lojasAlvo.map(l => String(l.bluesoft_loja_key));
  const lojasResposta = lojasAlvo.map(l => ({id: l.id, nome: l.nome, bluesoft_loja_key: l.bluesoft_loja_key}));

  if (data && data.modo === 'inventario') {
    const inventarioKey = textoSeguro(data.inventarioKey, 120);
    if (!inventarioKey) throw new functions.https.HttpsError('invalid-argument', 'inventarioKey é obrigatório no modo "inventario".');
    const lojaDoInventario = lojaIdPedida ? lojasAlvo[0] : null;
    if (!lojaDoInventario) throw new functions.https.HttpsError('invalid-argument', 'lojaId é obrigatório no modo "inventario".');
    const params = {inventarioKey, lojaKey: String(lojaDoInventario.bluesoft_loja_key)};
    const queryItens = `SELECT it.produto_key AS produto_key, p.descricao AS produto_descricao,
        it.quantidade_contada AS quantidade_contada, it.quantidade_sistema AS quantidade_sistema,
        it.custo_bruto AS custo_bruto, it.custo_liquido AS custo_liquido, it.custo_contabil AS custo_contabil,
        (it.quantidade_contada - it.quantidade_sistema) AS diferenca_quantidade,
        (it.quantidade_contada - it.quantidade_sistema) * it.custo_liquido AS diferenca_valor
      FROM \`${ESTOQUE_BQ_DATASET}.estoque_inventario_itens\` it
      LEFT JOIN \`${ESTOQUE_BQ_DATASET}.estoque_produtos\` p ON p.produto_key = it.produto_key
      WHERE it.inventario_key = @inventarioKey AND it.loja_key = @lojaKey
      ORDER BY ABS((it.quantidade_contada - it.quantidade_sistema) * it.custo_liquido) DESC
      LIMIT 20000`;
    const [itensCrus] = await bigqueryClient.query({query: queryItens, params});
    const itens = itensCrus.map(_achatarLinhaBigQuery).map(x => Object.assign(x, {
      dados_validos: x.quantidade_contada != null && x.quantidade_sistema != null
    }));
    const queryInv = _analiseAgregadoInventarioSql(ESTOQUE_BQ_DATASET) +
      ` WHERE i.inventario_key = @inventarioKey AND i.loja_key = @lojaKey
      GROUP BY i.inventario_key, i.loja_key, i.numero, i.descricao, i.status, i.data_abertura, i.data_fechamento`;
    const [invCru] = await bigqueryClient.query({query: queryInv, params});
    const invLinha = invCru.map(_achatarLinhaBigQuery).map(_analiseCalcularAcuracidade)[0] || null;
    const inventario = invLinha ? Object.assign({}, invLinha, {loja_id: lojaDoInventario.id}) : {
      inventario_key: inventarioKey, loja_id: lojaDoInventario.id, produtos_total: itens.length,
      produtos_corretos: 0, produtos_perda: 0, produtos_ganho: 0, produtos_sem_dados: itens.length
    };
    return {release: ANALISE_INVENTARIOS_RELEASE, inventario, itens, validacaoBluesoft: null, fonte: 'bigquery', diagnostico: null};
  }

  const dataInicio = data && data.dataInicio ? textoSeguro(data.dataInicio, 10) : null;
  const dataFim = data && data.dataFim ? textoSeguro(data.dataFim, 10) : null;
  const condicoesInv = ['i.loja_key IN UNNEST(@lojaKeys)', "i.status = 'FECHADO'"];
  const params = {lojaKeys: bluesoftKeys};
  if (dataInicio) { condicoesInv.push('DATE(i.data_fechamento) >= @dataInicio'); params.dataInicio = dataInicio; }
  if (dataFim) { condicoesInv.push('DATE(i.data_fechamento) <= @dataFim'); params.dataFim = dataFim; }
  const queryInvs = _analiseAgregadoInventarioSql(ESTOQUE_BQ_DATASET) +
    ` WHERE ${condicoesInv.join(' AND ')}
    GROUP BY i.inventario_key, i.loja_key, i.numero, i.descricao, i.status, i.data_abertura, i.data_fechamento
    ORDER BY i.data_fechamento DESC
    LIMIT 500`;
  const [invsCrus] = await bigqueryClient.query({query: queryInvs, params});
  const inventarios = invsCrus.map(_achatarLinhaBigQuery).map(_analiseCalcularAcuracidade).map(l => {
    const lojaInfo = mapaLojaPorBluesoftKey.get(String(l.loja_key));
    l.loja_id = lojaInfo ? lojaInfo.id : null;
    return l;
  });

  const queryProdutos = `SELECT it.produto_key AS produto_key, ANY_VALUE(p.descricao) AS produto_descricao,
      SUM(CASE WHEN it.quantidade_contada < it.quantidade_sistema THEN it.quantidade_sistema - it.quantidade_contada ELSE 0 END) AS perda_quantidade,
      SUM(CASE WHEN it.quantidade_contada > it.quantidade_sistema THEN it.quantidade_contada - it.quantidade_sistema ELSE 0 END) AS ganho_quantidade,
      SUM(CASE WHEN it.quantidade_contada < it.quantidade_sistema THEN (it.quantidade_sistema - it.quantidade_contada) * it.custo_liquido ELSE 0 END) AS perda_valor,
      SUM(CASE WHEN it.quantidade_contada > it.quantidade_sistema THEN (it.quantidade_contada - it.quantidade_sistema) * it.custo_liquido ELSE 0 END) AS ganho_valor,
      COUNTIF(it.quantidade_contada != it.quantidade_sistema) AS inventarios_divergentes
    FROM \`${ESTOQUE_BQ_DATASET}.estoque_inventario_itens\` it
    JOIN \`${ESTOQUE_BQ_DATASET}.estoque_inventarios\` i ON i.inventario_key = it.inventario_key AND i.loja_key = it.loja_key
    LEFT JOIN \`${ESTOQUE_BQ_DATASET}.estoque_produtos\` p ON p.produto_key = it.produto_key
    WHERE ${condicoesInv.join(' AND ')}
    GROUP BY it.produto_key
    HAVING perda_quantidade > 0 OR ganho_quantidade > 0
    ORDER BY (ABS(perda_valor) + ABS(ganho_valor)) DESC
    LIMIT 500`;
  const [produtosCrus] = await bigqueryClient.query({query: queryProdutos, params});
  const produtos = produtosCrus.map(_achatarLinhaBigQuery);

  let atualizadoEm = null;
  inventarios.forEach(l => { if (l.coletado_em && (!atualizadoEm || l.coletado_em > atualizadoEm)) atualizadoEm = l.coletado_em; });

  return {
    release: ANALISE_INVENTARIOS_RELEASE,
    revalidacaoHistorico: null,
    inventarios, produtos, historicoProdutos: [], lojas: lojasResposta,
    atualizadoEm
  };
}
exports.buscarAnaliseInventariosBigQuery = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 60, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    if (!acesso) throw new functions.https.HttpsError('permission-denied', 'Login sem acesso cadastrado.');
    return _buscarAnaliseInventariosBigQueryInterno(data, acesso, _obterBigQueryCliente(), db);
  });

// ── FERRAMENTA TEMPORÁRIA (2026-10-03) — aplica o schema de
// functions/sql/estoque-relatorios-schema.sql no BigQuery de produção. Só
// existe porque não há `bq`/`gcloud` nem credencial local pra rodar esse
// SQL direto; a conta de serviço das Cloud Functions já tem acesso ao
// BigQuery (as outras *BigQuery onCall já provam isso). Admin-only, só lê o
// arquivo já revisado (nenhum SQL novo/arbitrário aceito pela chamada) —
// remover esta function depois que o schema for confirmado criado (ela não
// tem utilidade depois disso, e re-rodar não causa dano: todo CREATE é
// IF NOT EXISTS/OR REPLACE, idempotente).
function _dividirStatementsSql(sqlTexto) {
  const semComentarios = sqlTexto.split('\n').map(linha => {
    const idx = linha.indexOf('--');
    return idx === -1 ? linha : linha.slice(0, idx);
  }).join('\n');
  return semComentarios.split(';').map(s => s.trim()).filter(Boolean);
}
async function _aplicarSchemaEstoqueBigQueryInterno(acesso, bigqueryClient, sqlTexto) {
  if (!administrador(acesso)) throw new functions.https.HttpsError('permission-denied', 'Só administrador pode aplicar o schema.');
  const statements = _dividirStatementsSql(sqlTexto);
  const resultados = [];
  for (const stmt of statements) {
    try {
      await bigqueryClient.query({query: stmt});
      resultados.push({ok: true, trecho: stmt.slice(0, 70).replace(/\s+/g, ' ')});
    } catch (e) {
      resultados.push({ok: false, trecho: stmt.slice(0, 70).replace(/\s+/g, ' '), erro: e.message || String(e)});
    }
  }
  return {total: statements.length, sucesso: resultados.filter(r => r.ok).length, resultados};
}
exports.aplicarSchemaEstoqueBigQueryTemporaria = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 540, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    const caminho = path.join(__dirname, 'sql', 'estoque-relatorios-schema.sql');
    const sqlTexto = fsNode.readFileSync(caminho, 'utf8');
    return _aplicarSchemaEstoqueBigQueryInterno(acesso, _obterBigQueryCliente(), sqlTexto);
  });

// ── FERRAMENTA TEMPORÁRIA (2026-10-03) — diagnóstico: schema existe mas
// nenhum relatório mostra linha nenhuma, nem Descarte (tipo de movimento
// frequente). Essa function olha 3 coisas de uma vez sem precisar de
// bq/gcloud local: (1) quantas linhas CRUAS existem em estoque_movimentos
// (prova se a coleta gravou algo, independente de view/classificação);
// (2) o progresso salvo em dt_config/estoque_bluesoft_sync (dias com erro
// silencioso por loja); (3) uma amostra de até 5 linhas cruas. Remover
// junto com aplicarSchemaEstoqueBigQueryTemporaria quando o pipeline
// estiver confirmado ponta a ponta.
async function _diagnosticoEstoqueBigQueryInterno(acesso, bigqueryClient, firestoreDb, data) {
  if (!administrador(acesso)) throw new functions.https.HttpsError('permission-denied', 'Só administrador pode rodar o diagnóstico.');
  const [totalLinhas] = await bigqueryClient.query({
    query: `SELECT COUNT(*) AS total, MIN(data_movimento) AS data_min, MAX(data_movimento) AS data_max FROM \`${ESTOQUE_BQ_DATASET}.estoque_movimentos\``,
  });
  const [amostraCrua] = await bigqueryClient.query({
    query: `SELECT * FROM \`${ESTOQUE_BQ_DATASET}.estoque_movimentos\` ORDER BY coletado_em DESC LIMIT 5`,
  });
  const amostra = amostraCrua.map(_achatarLinhaBigQuery);
  const [porTipoOrigem] = await bigqueryClient.query({
    query: `SELECT tipo_origem_key, tipo_origem, COUNT(*) AS total FROM \`${ESTOQUE_BQ_DATASET}.estoque_movimentos\` GROUP BY tipo_origem_key, tipo_origem ORDER BY total DESC LIMIT 20`,
  });
  const fdb = firestoreDb || db;
  const progressoSnap = await fdb.collection('dt_config').doc('estoque_bluesoft_sync').get();
  const progresso = progressoSnap.exists ? (progressoSnap.data() || {}) : null;
  const lojasSnap = await fdb.collection('lojas').get();
  const lojas = lojasSnap.docs.map(d => ({id: d.id, bluesoft_loja_key: (d.data() || {}).bluesoft_loja_key || null}));
  const resumoPorLoja = lojas.filter(l => l.bluesoft_loja_key).map(l => {
    const estado = (progresso && progresso.porLoja && progresso.porLoja[l.id]) || {};
    return {lojaId: l.id, bluesoft_loja_key: l.bluesoft_loja_key, ultimoDiaConcluido: estado.ultimoDiaConcluido || null, diasComErro: estado.diasComErro || []};
  });

  // Teste AO VIVO (sem gravar nada): só UMA chamada crua por endpoint (sem
  // paginação completa), pra confirmar conexão/credencial/PERMISSÃO sem
  // correr o risco de um dia com muitos registros levar o diagnóstico a
  // estourar tempo. A paginação completa (usada de verdade na
  // sincronização) fica de fora daqui de propósito.
  // PEDIDO AO VIVO (2026-10-03): "tem que ver as permissões na Bluesoft de
  // cada API" — antes só testava 1 dos 7 endpoints usados pela coleta;
  // agora testa os 7, um por um, reportando status HTTP de cada (401/403 =
  // token sem permissão pra aquele endpoint específico na Bluesoft —
  // precisa ser liberado lá, não é algo que dá pra corrigir por código).
  let testeAoVivo = null;
  const lojaIdPedida = data && data.lojaId ? String(data.lojaId) : null;
  const lojaTeste = lojaIdPedida ? lojas.find(l => l.id === lojaIdPedida) : lojas.find(l => l.bluesoft_loja_key);
  if (lojaTeste && lojaTeste.bluesoft_loja_key) {
    const cfg = await _lerConfigIntegracaoApiEstoque(lojaTeste.id, fdb);
    const baseUrl = _baseUrlBluesoftEstoque(cfg);
    let dataBr = data && data.dataBr ? String(data.dataBr) : null;
    if (!dataBr) {
      const ontem = new Date(); ontem.setUTCDate(ontem.getUTCDate() - 1);
      dataBr = _dataBrDeDate(ontem);
    }
    const hojeBr = _dataBrDeDate(new Date());
    // Chaves reais pra testar os 3 endpoints que exigem um identificador
    // existente (inventário/produto) — sem elas o teste ainda prova se o
    // endpoint está autorizado (401/403 acontece ANTES de qualquer busca
    // pelo identificador), só não confirma dados de verdade.
    const produtoKeyTeste = amostra.find(l => l.produto_key)?.produto_key || null;
    let inventarioKeyTeste = null;
    try {
      const [invSnap] = await bigqueryClient.query({query: `SELECT inventario_key FROM \`${ESTOQUE_BQ_DATASET}.estoque_inventarios\` LIMIT 1`});
      inventarioKeyTeste = invSnap[0]?.inventario_key || null;
    } catch (_) { /* tabela pode não existir ainda — segue sem essa chave */ }

    const endpoints = [
      {nome: 'Movimentos de estoque (analítico)', path: '/api/estoques/movimentacoesdeestoque/analitico?currentPage=0&pageSize=1&lojaKey=' + encodeURIComponent(lojaTeste.bluesoft_loja_key) + '&dataMovimento=' + encodeURIComponent(dataBr)},
      {nome: 'Tipos de movimento de estoque', path: '/api/estoques/movimentacoesdeestoque/tipos'},
      {nome: 'Inventários (cabeçalho)', path: '/api/estoques/inventarios?currentPage=0&pageSize=1&lojaKey=' + encodeURIComponent(lojaTeste.bluesoft_loja_key) + '&status=TODOS'},
      inventarioKeyTeste
        ? {nome: 'Itens de um inventário', path: '/api/estoques/inventarios/' + encodeURIComponent(inventarioKeyTeste) + '/produtos?currentPage=0&pageSize=1'}
        : {nome: 'Itens de um inventário', pulado: 'nenhum inventario_key encontrado no BigQuery pra testar'},
      {nome: 'Notas fiscais (saída)', path: '/api/estoques/notas-fiscais?currentPage=0&pageSize=1&lojaKey=' + encodeURIComponent(lojaTeste.bluesoft_loja_key) + '&tipoNota=SAIDA&dataRecebimentoInicial=' + encodeURIComponent(dataBr) + '&dataRecebimentoFinal=' + encodeURIComponent(hojeBr)},
      produtoKeyTeste
        ? {nome: 'Descrição de produto', path: '/api/comercial/produtos/' + encodeURIComponent(produtoKeyTeste)}
        : {nome: 'Descrição de produto', pulado: 'nenhum produto_key encontrado no BigQuery pra testar'},
      produtoKeyTeste
        ? {nome: 'Fator de transformação cadastrado', path: '/api/comercial/produtos/transformacao?produtoKey=' + encodeURIComponent(produtoKeyTeste)}
        : {nome: 'Fator de transformação cadastrado', pulado: 'nenhum produto_key encontrado no BigQuery pra testar'},
    ];
    const porEndpoint = [];
    for (const ep of endpoints) {
      if (ep.pulado) { porEndpoint.push({nome: ep.nome, status: 'pulado', detalhe: ep.pulado}); continue; }
      try {
        await _bluesoftGetSomenteLeitura(ep.path, cfg);
        porEndpoint.push({nome: ep.nome, status: 'autorizado'});
      } catch (e) {
        const semPermissao = e.status === 401 || e.status === 403;
        porEndpoint.push({nome: ep.nome, status: semPermissao ? 'sem_permissao' : 'erro', httpStatus: e.status || null, detalhe: e.message || String(e)});
      }
    }
    testeAoVivo = {
      lojaId: lojaTeste.id, dataBr,
      ambiente: cfg.ambiente || null, temToken: !!cfg.token,
      baseUrlHost: baseUrl ? String(baseUrl).replace(/^(https?:\/\/[^/]+).*$/, '$1') : null,
      porEndpoint,
    };
  }

  return {totalLinhas: _achatarLinhaBigQuery(totalLinhas[0]), amostra, porTipoOrigem, resumoPorLoja, testeAoVivo};
}
exports.diagnosticoEstoqueBigQueryTemporaria = functions
  .region('southamerica-east1')
  .runWith({timeoutSeconds: 300, memory: '256MB'})
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const acesso = await acessoSolicitante(context);
    // ACHADO AO VIVO (2026-10-03): o log do `firebase functions:log` ficou
    // preso/travando nesta sessão (bug do próprio CLI), impossível ver o
    // stack real de um erro 500 genérico ("INTERNAL") por log — então essa
    // function nunca deixa um erro virar HttpsError opaco: captura tudo e
    // devolve o erro + stack DIRETO na resposta (200), sempre visível no
    // alert() do navegador, sem depender de log nenhum.
    try {
      return await _diagnosticoEstoqueBigQueryInterno(acesso, _obterBigQueryCliente(), db, data);
    } catch (e) {
      return {erroFatal: e.message || String(e), stack: String((e && e.stack) || '').slice(0, 2000)};
    }
  });

exports._estoqueBluesoftInternals = {
  _lerConfigIntegracaoApiEstoque, _baseUrlBluesoftEstoque, _bluesoftGetSomenteLeitura, _bluesoftGetUmaVez,
  _dividirStatementsSql, _aplicarSchemaEstoqueBigQueryInterno, _diagnosticoEstoqueBigQueryInterno,
  _dataBrDeDate, _dataBrParaIso, _dataHoraBrParaIso,
  _coletarMovimentosAnaliticoDia, _normalizarMovimentoEstoque, _carregarMovimentosEstoqueNoBigQuery,
  _coletarTiposMovimentoEstoque, _sincronizarTiposMovimentoEstoqueBigQuery,
  _coletarInventarios, _normalizarInventario, _sincronizarInventariosLoja,
  _coletarInventarioProdutos, _normalizarInventarioItem, _sincronizarItensInventariosFechadosLoja,
  _coletarNotasBaixa, _normalizarNotaBaixa,
  _coletarProdutoDescricao, _coletarFatorTransformacaoCadastrado,
  _mergeGenericoBigQuery, _sincronizarProdutosFaltantesEstoque, _sincronizarEstoqueDiaLoja, _sincronizarEstoqueBluesoftIntervalo,
  _buscarRelatorioEstoqueBigQueryInterno, ESTOQUE_VIEWS_PERMITIDAS,
  _buscarAnaliseInventariosBigQueryInterno, ANALISE_INVENTARIOS_RELEASE,
  _eopCheckNumero, _eopValidarLote, _eopConsultarPaletesPagina, _eopConferirCadastroAntesPost,
  _eopCatalogoEnderecosLogisticos, _eopExecutarTrocaAgrupadaUmaVez,
};

// Exportado só pra teste local contra o emulador do Firestore (nunca
// chamado em produção) — mesmo padrão de `_XInternals` já usado nos
// arquivos do front-end.
exports._graphBiInternals = {
  _sincronizarFichaTecnicaBiLoja, _sincronizarAgendaBiLoja, _sincronizarRecebimentoAgendaNoPcp, _sincronizarRecebimentoFisicoNaAgenda, _sincronizarBiTodasLojas,
  _sincronizarEstoqueInsumosBiLoja, _sincronizarEstoqueProdutoAcabadoBiLoja, _sincronizarHistoricoVendasBiLoja,
  _sincronizarNotasRetornadasVendaBiLoja, _dividirChunksNotasRetornadasGrandesDemaisSeNecessario, _notasRetornadasDoDocumentoChunk,
  _sincronizarDevolucoesBiLoja, _classificarMotivoTextoBi, _construirDevolucaoNotaBi,
  _consultarDevolucaoPorChaveInterno, _confirmarRecebimentoDevolucaoInterno, _listarDevolucoesBigQueryInterno,
  _limparEstoqueBiContaminadoLoja, _limparEstoqueBiContaminadoTodasLojas,
  _limparDadosAntigosBluesoftLoja, _limparDadosAntigosBluesoftTodasLojas,
  _sincronizarRelatorioBiChunkeadoGlobal, _sincronizarComprasHistoricoBi, _sincronizarComprasHistoricoBigQuery, _slimCompraHistoricoBi,
  _construirClassificacaoProdutosComprasBi, _gravarClassificacaoProdutosComprasBi,
  _sincronizarFornecedoresAgregadoBi,
  _construirConsumoInsumosResumoBi, _gravarConsumoInsumosResumoBi,
  _construirCortesResumoMensalBi, _gravarCortesResumoMensalBi,
  _buscarHistoricoComprasBigQueryInterno, _buscarResumoComprasDashboardBigQueryInterno, _buscarResumoRecebimentoComprasBigQueryInterno, _buscarResumoHistoricoRecebimentoBigQueryInterno, _buscarNotasRecebimentoPaginadasBigQueryInterno, _buscarDivergenciasFornecedoresRecebimentoBigQueryInterno,
  _sugerirRegrasCompradorPorFornecedorBigQueryInterno, _sugerirRegrasCompradorPorProdutoBigQueryInterno, _buscarProdutosComprasBigQueryInterno, _buscarResumoProdutosComprasBigQueryInterno,
  _buscarIndicadoresRetornosBigQueryInterno, _buscarRecebimentosOperacaoBigQueryInterno, _buscarHistoricoRecebimentosBigQueryInterno, _lojaPermitidaParaAcesso,
  _buscarResumoNotasRetorno,
  _resumirRegistrosProducaoDashboard, _buscarResumoProducaoDashboardInterno, _buscarRelatorioProducaoPeriodoInterno,
  _buscarPatioTempoRealBigQueryInterno, _consultarPatioTempoRealBigQuery,
  _estaNoPatioParaCache, _linhasPorNotaParaCache, _montarCachePatioTempoRealLoja, _atualizarCachePatioTempoRealTodasLojas,
  _buscarTransbordoTodasLojasBigQueryInterno, _buscarCargasTodasLojasBigQueryInterno, _clausulaLojasPermitidas,
};

// ═══════════════════════════════════════════════════════════════════════
// DT Atendimento · WhatsApp Business Platform (V1)
// Central multiatendente oficial. Tokens ficam no Secret Manager.
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
//  APONTAMENTO DE PRODUÇÃO COM CONFERÊNCIA FÍSICA (Logística › Estoque)
//  Regra central: 1 pallet físico = 1 capa = 1 conferência = no máximo
//  1 apontamento BlueSoft. A Produção cria somente um PRÉ-apontamento;
//  a escrita na BlueSoft acontece exclusivamente após a conferência.
// ═══════════════════════════════════════════════════════════════════════
const AP_REGION = 'southamerica-east1';
const AP_COL = 'dt_apontamentos_producao';
const AP_COUNTER_DOC = 'apontamento_capa_counter';

function _apPerm(acesso, acao) {
  return administrador(acesso) || Boolean(
    acesso && acessoAtivo(acesso) && acesso.permissoes &&
    acesso.permissoes['estoque-rel-apontamento'] &&
    acesso.permissoes['estoque-rel-apontamento'][acao] === true
  );
}
function _apRequire(acesso, acao) {
  if (!_apPerm(acesso, acao)) {
    throw new functions.https.HttpsError('permission-denied', 'Sem permissão para esta ação em Apontamento de Produção.');
  }
}
function _apNome(acesso, context) {
  return String((acesso && (acesso.nome || acesso.displayName || acesso.email)) ||
    (context.auth && context.auth.token && (context.auth.token.name || context.auth.token.email)) || 'Usuário');
}
function _apLojaPermitida(acesso, lojaId) {
  if (administrador(acesso) || (acesso && acesso.acesso_todas_lojas === true)) return true;
  const id = String(lojaId || '');
  if (!id) return false;
  const lojas = Array.isArray(acesso && acesso.lojas_permitidas) ? acesso.lojas_permitidas.map(String) : [];
  if (lojas.includes(id)) return true;
  return [acesso && acesso.loja_id, acesso && acesso.lojaId, acesso && acesso.loja].filter(Boolean).map(String).includes(id);
}
async function _apRequireLoja(acesso, lojaId) {
  const id = String(lojaId || '').trim();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'Loja não informada.');
  if (!_apLojaPermitida(acesso, id)) throw new functions.https.HttpsError('permission-denied', 'Você não possui acesso a esta loja.');
  const snap = await db.collection('lojas').doc(id).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Loja não encontrada.');
  const loja = snap.data() || {};
  if (!loja.bluesoft_loja_key) throw new functions.https.HttpsError('failed-precondition', 'A loja não possui bluesoft_loja_key configurada.');
  return {id, dados: loja, bluesoftLojaKey: Number(loja.bluesoft_loja_key)};
}
function _apDataIso(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function _apSerializar(d) {
  if (!d) return d;
  const out = Object.assign({}, d);
  ['criadoEm','atualizadoEm','dataHoraApontamento','dataHoraConferencia','canceladoEm'].forEach(k => {
    if (out[k]) out[k] = _apDataIso(out[k]);
  });
  if (out.integracao) {
    out.integracao = Object.assign({}, out.integracao);
    ['dataEnvio','dataConfirmacao','dataUltimaConsulta'].forEach(k => { if (out.integracao[k]) out.integracao[k] = _apDataIso(out.integracao[k]); });
  }
  return out;
}
async function _apEvento(capa, tipo, context, acesso, extras) {
  const ref = db.collection(AP_COL).doc(String(capa)).collection('eventos').doc();
  await ref.set(Object.assign({
    tipo, usuarioUid: context.auth.uid, usuarioNome: _apNome(acesso, context),
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  }, extras || {}));
}
function _apValidarCapa(capa) {
  const c = String(capa || '').trim();
  if (!/^\d{7}$/.test(c)) throw new functions.https.HttpsError('invalid-argument', 'Capa inválida. Informe os 7 dígitos.');
  return c;
}
function _apHashPayload(payload) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
async function _apBluesoftPost(pathApi, cfg, payload) {
  const baseUrl = _baseUrlBluesoftEstoque(cfg);
  if (!baseUrl) throw Object.assign(new Error('URL da BlueSoft não configurada.'), {apTipo:'rejeitado'});
  if (!cfg.token) throw Object.assign(new Error('Token da BlueSoft não configurado.'), {apTipo:'rejeitado'});
  let resposta;
  try {
    resposta = await fetch(baseUrl.replace(/\/+$/, '') + pathApi, {
      method:'POST',
      headers:{'x-CustomToken':String(cfg.token),'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
  } catch (e) {
    throw Object.assign(new Error('Falha de rede ao enviar para a BlueSoft: ' + (e.message || e)), {apTipo:'incerto'});
  }
  const texto = await resposta.text();
  let dados = null; try { dados = texto ? JSON.parse(texto) : null; } catch (_) { dados = texto; }
  if (!resposta.ok) {
    const detalhe0 = dados && (dados.message || dados.erro || dados.detail || dados.title) ? (dados.message || dados.erro || dados.detail || dados.title) : String(texto || '').slice(0,400);
    // Se a BlueSoft disser quais campos estão errados, mostra a lista também.
    const campos = dados && typeof dados === 'object' ? (dados.errors || dados.erros || dados.fieldErrors || dados.violations || dados.campos) : null;
    const detalhe1 = campos ? detalhe0 + ' — ' + JSON.stringify(campos).slice(0,400) : detalhe0;
    // Mostra o pedido enviado (sem token) para ver valor vazio ou inválido.
    const detalhe = detalhe1 + ' | enviado: ' + JSON.stringify(payload).slice(0,300);
    const tipo = resposta.status >= 500 || resposta.status === 429 ? 'incerto' : 'rejeitado';
    throw Object.assign(new Error('BlueSoft HTTP ' + resposta.status + (detalhe ? ': ' + detalhe : '')), {status:resposta.status, apTipo:tipo});
  }
  return dados;
}
async function _apBuscarProdutoPorGtin(loja, gtin) {
  const cfg = await _lerConfigIntegracaoApiEstoque(loja.id, db);
  const resp = await _bluesoftGetSomenteLeitura('/api/comercial/produtos/gtin-plu?currentPage=0&pageSize=30&gtinPlu=' + encodeURIComponent(gtin), cfg);
  const lista = resp && Array.isArray(resp.data) ? resp.data : [];
  if (!lista.length || !lista[0].produtoKey) throw new functions.https.HttpsError('not-found', 'Produto não encontrado na BlueSoft para o código bipado.');
  const produtoKey = Number(lista[0].produtoKey);
  let descricao = null;
  try { descricao = await _coletarProdutoDescricao(produtoKey, cfg); } catch (_) {}
  // A ficha técnica define QUAL endpoint de apontamento será usado.
  // Portanto esta consulta não pode falhar silenciosamente: sem saber se há
  // ficha ativa, enviar pelo endpoint "por produto" poderia criar um
  // apontamento semanticamente diferente do configurado na BlueSoft.
  const ft = await _bluesoftGetSomenteLeitura('/api/pcp/ficha-tecnica?currentPage=0&pageSize=30&lojaKey=' + encodeURIComponent(loja.bluesoftLojaKey) + '&produtoKey=' + encodeURIComponent(produtoKey), cfg);
  const fichas = ft && Array.isArray(ft.data) ? ft.data : [];
  const ficha = fichas.find(f => String(f.status || '').toUpperCase().includes('ATIV')) || null;
  return {produtoKey, descricao: descricao || ('Produto ' + produtoKey), ficha, cfg};
}
function _apAdicionarDiasIso(dias) {
  const n = Number(dias || 0); if (!(n > 0)) return null;
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

exports.apontamentoConsultarProduto = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context); _apRequire(acesso, 'criar');
  const loja = await _apRequireLoja(acesso, data && data.lojaId);
  const gtin = String((data && data.gtin) || '').replace(/\s/g,'');
  if (!gtin || gtin.length > 32) throw new functions.https.HttpsError('invalid-argument', 'GTIN/DUN inválido.');
  const achado = await _apBuscarProdutoPorGtin(loja, gtin);
  const ficha = achado.ficha || null;
  return {
    produto:{
      produtoKey: achado.produtoKey, codigo: achado.produtoKey, gtin,
      descricao: achado.descricao,
      fichaTecnicaKey: ficha && ficha.fichaTecnicaKey ? Number(ficha.fichaTecnicaKey) : null,
      tipoApontamento: ficha && ficha.tipoApontamento ? String(ficha.tipoApontamento) : '',
      setorProdutivo: ficha && ficha.setorProdutivo ? String(ficha.setorProdutivo) : '',
      diasDeValidade: ficha && ficha.diasDeValidade != null ? Number(ficha.diasDeValidade) : null
    },
    validadeSugerida: ficha ? _apAdicionarDiasIso(ficha.diasDeValidade) : null
  };
});

exports.apontamentoCriarPre = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context); _apRequire(acesso, 'criar');
  const loja = await _apRequireLoja(acesso, data && data.lojaId);
  const produtoKey = Number(data && data.produtoKey), quantidade = Number(data && data.quantidade);
  const gtin = String((data && data.gtin) || '').trim(), lote = String((data && data.lote) || '').trim(), validade = String((data && data.validade) || '').trim();
  if (!(produtoKey > 0) || !(quantidade > 0) || !gtin || !lote || !/^\d{4}-\d{2}-\d{2}$/.test(validade)) throw new functions.https.HttpsError('invalid-argument', 'Produto, lote, validade e quantidade são obrigatórios.');
  if (lote.length > 30) throw new functions.https.HttpsError('invalid-argument', 'O lote pode ter no máximo 30 caracteres.');
  // Revalida o GTIN no servidor para impedir produto adulterado no navegador.
  const validado = await _apBuscarProdutoPorGtin(loja, gtin);
  if (Number(validado.produtoKey) !== produtoKey) throw new functions.https.HttpsError('failed-precondition', 'O produto informado não corresponde ao código bipado.');
  const requisicaoId=String((data&&data.requisicaoId)||'').trim();
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(requisicaoId))throw new functions.https.HttpsError('invalid-argument','Identificador da solicitação inválido.');
  const reqRef=db.collection('dt_apontamento_idempotencia').doc(context.auth.uid+'_'+requisicaoId);
  const counterRef = db.collection('dt_config').doc(AP_COUNTER_DOC);
  let capa = null, criadoNovo=false;
  await db.runTransaction(async tx => {
    const reqSnap=await tx.get(reqRef);
    if(reqSnap.exists){capa=String((reqSnap.data()||{}).capa||'');return;}
    const cSnap = await tx.get(counterRef);
    let atual = cSnap.exists ? Number((cSnap.data() || {}).ultimo || 999999) : 999999;
    if (!Number.isFinite(atual) || atual < 999999) atual = 999999;
    let proximo = atual + 1;
    if (proximo > 9999999) throw new functions.https.HttpsError('resource-exhausted', 'Faixa de capas de 7 dígitos esgotada.');
    capa = String(proximo).padStart(7,'0');
    const ref = db.collection(AP_COL).doc(capa);
    const existe = await tx.get(ref);
    if (existe.exists) throw new functions.https.HttpsError('already-exists', 'A capa gerada já existe. Tente novamente.');
    const ficha = validado.ficha || null;criadoNovo=true;
    tx.set(counterRef,{ultimo:proximo,atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    tx.create(reqRef,{capa,uid:context.auth.uid,requisicaoId,criadoEm:admin.firestore.FieldValue.serverTimestamp()});
    tx.create(ref,{
      capa, apontamentoId:ref.id, lojaId:loja.id, bluesoftLojaKey:loja.bluesoftLojaKey,
      produtoKey, gtin, descricaoProduto:validado.descricao || String((data && data.descricaoProduto) || ''),
      fichaTecnicaKey:ficha && ficha.fichaTecnicaKey ? Number(ficha.fichaTecnicaKey) : null,
      tipoApontamento:ficha && ficha.tipoApontamento ? String(ficha.tipoApontamento) : '',
      lote, validade, quantidade, quantidadeApontada:quantidade,
      usuarioApontamentoUid:context.auth.uid, usuarioApontamentoNome:_apNome(acesso,context),
      dataHoraApontamento:admin.firestore.FieldValue.serverTimestamp(),
      status:'AGUARDANDO_CONFERENCIA',
      integracao:{status:'NAO_ENVIADO',requestId:null,tentativas:0,payloadHash:null,erro:null},
      criadoEm:admin.firestore.FieldValue.serverTimestamp(), atualizadoEm:admin.firestore.FieldValue.serverTimestamp()
    });
  });
  if(criadoNovo)await _apEvento(capa,'PRE_APONTAMENTO_CRIADO',context,acesso,{lojaId:loja.id,produtoKey,quantidade,requisicaoId});
  return {ok:true,capa,status:'AGUARDANDO_CONFERENCIA',reutilizado:!criadoNovo};
});

exports.apontamentoObter = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context);
  if (!_apPerm(acesso,'visualizar') && !_apPerm(acesso,'conferir')) throw new functions.https.HttpsError('permission-denied','Sem permissão para consultar a capa.');
  const capa = _apValidarCapa(data && data.capa); const ref=db.collection(AP_COL).doc(capa); const snap=await ref.get();
  if(!snap.exists) throw new functions.https.HttpsError('not-found','Capa não encontrada.');
  const d=snap.data()||{}; await _apRequireLoja(acesso,d.lojaId);
  return {apontamento:_apSerializar(d)};
});

exports.apontamentoListar = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context); _apRequire(acesso, 'visualizar');
  const loja = await _apRequireLoja(acesso, data && data.lojaId);
  const limite = Math.min(500,Math.max(1,Number(data && data.limite)||100));
  // Período (AAAA-MM-DD, horário de Brasília). Com período, a consulta usa só o
  // campo de data (índice automático); a loja é conferida depois da leitura.
  const ini = data && data.dataInicio ? new Date(String(data.dataInicio)+'T00:00:00-03:00') : null;
  const fim = data && data.dataFim ? new Date(String(data.dataFim)+'T23:59:59.999-03:00') : null;
  let docs;
  if (ini || fim) {
    let q = db.collection(AP_COL);
    if (ini && !isNaN(ini)) q = q.where('dataHoraApontamento','>=',admin.firestore.Timestamp.fromDate(ini));
    if (fim && !isNaN(fim)) q = q.where('dataHoraApontamento','<=',admin.firestore.Timestamp.fromDate(fim));
    const snap=await q.limit(5000).get();
    docs=snap.docs.filter(d=>(d.data()||{}).lojaId===loja.id);
  } else {
    const snap=await db.collection(AP_COL).where('lojaId','==',loja.id).limit(500).get();
    docs=snap.docs;
  }
  const itens=docs.map(d=>_apSerializar(d.data()||{})).sort((a,b)=>String(b.dataHoraApontamento||'').localeCompare(String(a.dataHoraApontamento||''))).slice(0,limite);
  return {itens};
});

// Integração WMS (pallet logístico BlueSoft). Desligada por padrão: enquanto
// dt_config/apontamento_producao.integracaoWmsAtiva não for true, nada é criado
// na BlueSoft — só fica registrado que o WMS está aguardando configuração.
// Vínculo permanente: Capa DT (etiqueta física) ↔ paleteKey BlueSoft (técnico).
async function _apMarcarWms(ref) {
  const cfgWms = await _apLerConfigWms();
  if (!cfgWms.ativa) {
    await ref.set({wms: {
      status: 'WMS_AGUARDANDO_CONFIGURACAO',
      paleteKey: null,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    }}, {merge: true});
    return;
  }
  await _apSolicitarWms(ref);
}
// A BlueSoft aceita a validade só no formato dd/MM/yyyy (AAAA-MM-DD é recusado).
function _apDataBluesoft(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
}
async function _apEnviarParaBluesoft(capa, context, acesso, permitirReprocesso) {
  const ref=db.collection(AP_COL).doc(capa);
  let docData=null;
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref); if(!snap.exists)throw new functions.https.HttpsError('not-found','Capa não encontrada.');
    const d=snap.data()||{}; docData=d;
    if(d.status==='APONTADO_BLUESOFT'||(d.integracao&&d.integracao.status==='CONCLUIDO'))return;
    const ist=String(d.integracao&&d.integracao.status||'NAO_ENVIADO');
    if(ist==='ENVIANDO'||ist==='PROCESSANDO')throw new functions.https.HttpsError('failed-precondition','Este apontamento já está sendo processado.');
    if(ist==='ERRO_INCERTO')throw new functions.https.HttpsError('failed-precondition','O resultado anterior ficou incerto. Confira a BlueSoft antes de qualquer novo envio para evitar duplicidade.');
    if(ist==='ERRO_REJEITADO'&&!permitirReprocesso)throw new functions.https.HttpsError('failed-precondition','A integração anterior foi rejeitada. Use Reprocessar com permissão específica.');
    if(!['CONFERIDO_AGUARDANDO_INTEGRACAO','ERRO_REJEITADO'].includes(String(d.status)))throw new functions.https.HttpsError('failed-precondition','O pallet ainda não está pronto para integração.');
    tx.update(ref,{'integracao.status':'ENVIANDO','integracao.tentativas':Number(d.integracao&&d.integracao.tentativas||0)+1,'integracao.erro':null,'integracao.dataEnvio':admin.firestore.FieldValue.serverTimestamp(),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()});
  });
  if(docData && (docData.status==='APONTADO_BLUESOFT'||(docData.integracao&&docData.integracao.status==='CONCLUIDO')))return {concluido:true,jaExistia:true};
  const loja=await _apRequireLoja(acesso,docData.lojaId); const cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  let endpoint,payload;
  if(docData.fichaTecnicaKey){
    endpoint='/api/pcp/apontamento-producao/ficha-tecnica';
    payload={lojaKey:Number(docData.bluesoftLojaKey),fichaTecnicaKey:Number(docData.fichaTecnicaKey),lote:String(docData.lote||''),dataValidade:_apDataBluesoft(docData.validade),quantidadeAProduzir:Number(docData.quantidadeConferida||docData.quantidade),quantidadeProduzida:Number(docData.quantidadeConferida||docData.quantidade),observacao:'Capa '+capa+' - conferido pela Logística'};
  }else{
    endpoint='/api/pcp/apontamento-producao';
    payload={lojaKey:Number(docData.bluesoftLojaKey),produtoFinalKey:Number(docData.produtoKey),lote:String(docData.lote||''),dataValidade:_apDataBluesoft(docData.validade),quantidadeAProduzir:Number(docData.quantidadeConferida||docData.quantidade)};
  }
  const hash=_apHashPayload(payload);
  await ref.set({'integracao.payloadHash':hash,'integracao.endpoint':endpoint,'integracao.payloadResumo':payload,atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  try{
    const resp=await _apBluesoftPost(endpoint,cfg,payload);
    const requestId=resp&&resp.requestId?String(resp.requestId):null;
    if(requestId){
      await ref.set({status:'PROCESSANDO','integracao.status':'PROCESSANDO','integracao.requestId':requestId,'integracao.erro':null,atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
      await _apEvento(capa,'BLUESOFT_PROCESSANDO',context,acesso,{requestId,endpoint});
      return {processando:true,requestId};
    }
    await ref.set({status:'APONTADO_BLUESOFT','integracao.status':'CONCLUIDO','integracao.requestId':null,'integracao.erro':null,'integracao.dataConfirmacao':admin.firestore.FieldValue.serverTimestamp(),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    await _apEvento(capa,'BLUESOFT_CONCLUIDO',context,acesso,{endpoint});
    await _apMarcarWms(ref);
    return {concluido:true};
  }catch(e){
    const incerto=e&&e.apTipo==='incerto';
    const st=incerto?'ERRO_INCERTO':'ERRO_REJEITADO';
    await ref.set({status:st,'integracao.status':st,'integracao.erro':String(e&&e.message||e).slice(0,1000),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    await _apEvento(capa,incerto?'BLUESOFT_ERRO_INCERTO':'BLUESOFT_REJEITADO',context,acesso,{erro:String(e&&e.message||e).slice(0,1000),endpoint});
    throw new functions.https.HttpsError(incerto?'aborted':'failed-precondition',incerto?'O envio ficou com resultado incerto. Não reenvie: confira a BlueSoft para evitar duplicidade.':String(e&&e.message||e));
  }
}

exports.apontamentoConferirEnviar = functions.region(AP_REGION).runWith({timeoutSeconds:120}).https.onCall(async (data, context) => {
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context);_apRequire(acesso,'conferir');
  const capa=_apValidarCapa(data&&data.capa),gtin=String((data&&data.gtinConferido)||'').trim(),loteConf=String((data&&data.loteConferido)||'').trim(),validadeConf=String((data&&data.validadeConferida)||'').trim(),qtd=Number(data&&data.quantidadeConferida),obs=String((data&&data.observacao)||'').trim().slice(0,500);
  if(!gtin||!loteConf||!/^\d{4}-\d{2}-\d{2}$/.test(validadeConf)||!(qtd>0))throw new functions.https.HttpsError('invalid-argument','Produto, lote, validade e quantidade conferida são obrigatórios.');
  const ref=db.collection(AP_COL).doc(capa);const snap=await ref.get();if(!snap.exists)throw new functions.https.HttpsError('not-found','Capa não encontrada.');
  const d=snap.data()||{};const loja=await _apRequireLoja(acesso,d.lojaId);
  if(d.status!=='AGUARDANDO_CONFERENCIA'&&d.status!=='DIVERGENTE')throw new functions.https.HttpsError('failed-precondition','Esta capa já foi conferida ou encerrada.');
  // O segundo código pode ser outro GTIN/DUN da mesma unidade comercial.
  // Por isso a conferência compara produtoKey resolvido na BlueSoft, não a
  // string bruta do código de barras.
  const produtoConferido=await _apBuscarProdutoPorGtin(loja,gtin);
  const produtoOk=Number(produtoConferido.produtoKey)===Number(d.produtoKey);
  const loteOk=String(d.lote||'').trim().toUpperCase()===loteConf.toUpperCase();
  const validadeOk=String(d.validade||'')===validadeConf;
  const qtdOk=Math.abs(Number(d.quantidade)-qtd)<0.000001;
  if(!produtoOk||!loteOk||!validadeOk||!qtdOk){
    await ref.set({status:'DIVERGENTE',gtinConferido:gtin,produtoKeyConferido:Number(produtoConferido.produtoKey),loteConferido:loteConf,validadeConferida:validadeConf,quantidadeConferida:qtd,observacaoConferencia:obs,usuarioConferenciaUid:context.auth.uid,usuarioConferenciaNome:_apNome(acesso,context),dataHoraConferencia:admin.firestore.FieldValue.serverTimestamp(),divergencia:{produto:!produtoOk,lote:!loteOk,validade:!validadeOk,quantidade:!qtdOk,quantidadeApontada:Number(d.quantidade),quantidadeConferida:qtd},atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    await _apEvento(capa,'CONFERENCIA_DIVERGENTE',context,acesso,{gtinConferido:gtin,produtoKeyConferido:Number(produtoConferido.produtoKey),loteConferido:loteConf,validadeConferida:validadeConf,quantidadeConferida:qtd,produtoOk,loteOk,validadeOk,qtdOk,observacao:obs});
    return {ok:true,divergente:true,divergencia:{produto:!produtoOk,lote:!loteOk,validade:!validadeOk,quantidade:!qtdOk},podeAprovarQuantidade:produtoOk&&loteOk&&validadeOk&&!qtdOk};
  }
  await ref.set({status:'CONFERIDO_AGUARDANDO_INTEGRACAO',gtinConferido:gtin,produtoKeyConferido:Number(produtoConferido.produtoKey),loteConferido:loteConf,validadeConferida:validadeConf,quantidadeConferida:qtd,observacaoConferencia:obs,usuarioConferenciaUid:context.auth.uid,usuarioConferenciaNome:_apNome(acesso,context),dataHoraConferencia:admin.firestore.FieldValue.serverTimestamp(),divergencia:null,atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  await _apEvento(capa,'CONFERENCIA_APROVADA',context,acesso,{quantidadeConferida:qtd});
  return _apEnviarParaBluesoft(capa,context,acesso,false);
});

exports.apontamentoAprovarDivergenciaQuantidade = functions.region(AP_REGION).runWith({timeoutSeconds:120}).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context);_apRequire(acesso,'conferir');
  const capa=_apValidarCapa(data&&data.capa),obs=String((data&&data.observacao)||'').trim().slice(0,500);
  if(!obs)throw new functions.https.HttpsError('invalid-argument','Informe uma justificativa para aprovar a quantidade divergente.');
  const ref=db.collection(AP_COL).doc(capa),snap=await ref.get();if(!snap.exists)throw new functions.https.HttpsError('not-found','Capa não encontrada.');
  const d=snap.data()||{};await _apRequireLoja(acesso,d.lojaId);
  const dv=d.divergencia||{};
  if(d.status!=='DIVERGENTE'||dv.produto===true||dv.lote===true||dv.validade===true||dv.quantidade!==true)throw new functions.https.HttpsError('failed-precondition','Só é possível aprovar por esta ação quando a única divergência é a quantidade.');
  const qtd=Number(d.quantidadeConferida);if(!(qtd>0))throw new functions.https.HttpsError('failed-precondition','Quantidade conferida inválida.');
  await ref.set({status:'CONFERIDO_AGUARDANDO_INTEGRACAO',quantidadeOriginal:Number(d.quantidade),quantidadeAceita:qtd,observacaoAprovacaoDivergencia:obs,divergenciaAprovadaPorUid:context.auth.uid,divergenciaAprovadaPorNome:_apNome(acesso,context),divergenciaAprovadaEm:admin.firestore.FieldValue.serverTimestamp(),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  await _apEvento(capa,'DIVERGENCIA_QUANTIDADE_APROVADA',context,acesso,{quantidadeOriginal:Number(d.quantidade),quantidadeAceita:qtd,observacao:obs});
  return _apEnviarParaBluesoft(capa,context,acesso,false);
});

exports.apontamentoConsultarStatusBluesoft = functions.region(AP_REGION).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context);_apRequire(acesso,'visualizar');
  const capa=_apValidarCapa(data&&data.capa),ref=db.collection(AP_COL).doc(capa),snap=await ref.get();if(!snap.exists)throw new functions.https.HttpsError('not-found','Capa não encontrada.');
  const d=snap.data()||{};await _apRequireLoja(acesso,d.lojaId);
  const requestId=d.integracao&&d.integracao.requestId?String(d.integracao.requestId):'';
  if(!requestId)return {status:d.status,mensagem:'Este apontamento não possui processamento assíncrono pendente.'};
  const cfg=await _lerConfigIntegracaoApiEstoque(d.lojaId,db);
  const resp=await _bluesoftGetSomenteLeitura('/api/monitoramento/async/'+encodeURIComponent(requestId),cfg);
  const lista=Array.isArray(resp)?resp:[];const item=lista.find(x=>String(x.requestId||'')===requestId)||lista[0]||{};const st=String(item.status||'').toUpperCase();
  if(st==='DONE'){
    await ref.set({status:'APONTADO_BLUESOFT','integracao.status':'CONCLUIDO','integracao.erro':null,'integracao.dataConfirmacao':admin.firestore.FieldValue.serverTimestamp(),'integracao.dataUltimaConsulta':admin.firestore.FieldValue.serverTimestamp(),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    await _apEvento(capa,'BLUESOFT_CONCLUIDO_ASYNC',context,acesso,{requestId});
    await _apMarcarWms(ref);return {status:'APONTADO_BLUESOFT',mensagem:'BlueSoft concluiu o apontamento.'};
  }
  if(st==='FAILED'){
    const erro='Processamento assíncrono BlueSoft retornou FAILED.';
    await ref.set({status:'ERRO_REJEITADO','integracao.status':'ERRO_REJEITADO','integracao.erro':erro,'integracao.dataUltimaConsulta':admin.firestore.FieldValue.serverTimestamp(),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    await _apEvento(capa,'BLUESOFT_ASYNC_FALHOU',context,acesso,{requestId});return {status:'ERRO_REJEITADO',mensagem:erro};
  }
  await ref.set({'integracao.dataUltimaConsulta':admin.firestore.FieldValue.serverTimestamp(),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  return {status:'PROCESSANDO',mensagem:'BlueSoft ainda está processando o apontamento.'};
});

exports.apontamentoReprocessar = functions.region(AP_REGION).runWith({timeoutSeconds:120}).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context);_apRequire(acesso,'reprocessar');
  const capa=_apValidarCapa(data&&data.capa),snap=await db.collection(AP_COL).doc(capa).get();if(!snap.exists)throw new functions.https.HttpsError('not-found','Capa não encontrada.');
  const d=snap.data()||{};await _apRequireLoja(acesso,d.lojaId);
  if(d.status!=='ERRO_REJEITADO')throw new functions.https.HttpsError('failed-precondition','Só é permitido reprocessar erros rejeitados. Erro incerto exige conferência manual na BlueSoft.');
  await db.collection(AP_COL).doc(capa).set({status:'CONFERIDO_AGUARDANDO_INTEGRACAO',atualizadoEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  await _apEvento(capa,'REPROCESSAMENTO_SOLICITADO',context,acesso,{});
  return _apEnviarParaBluesoft(capa,context,acesso,true);
});

// Reprovação na conferência: marca o pallet como REPROVADO com motivo. Não envia
// nada à BlueSoft. Só vale para pallets ainda pendentes de conferência.
exports.apontamentoReprovar = functions.region(AP_REGION).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context);_apRequire(acesso,'conferir');
  const capa=_apValidarCapa(data&&data.capa),ref=db.collection(AP_COL).doc(capa);
  const motivo=String((data&&data.motivo)||'').trim().slice(0,500);
  if(!motivo)throw new functions.https.HttpsError('invalid-argument','Informe o motivo da reprovação.');
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)throw new functions.https.HttpsError('not-found','Capa não encontrada.');
    const d=snap.data()||{};
    if(!_apLojaPermitida(acesso,d.lojaId))throw new functions.https.HttpsError('permission-denied','Você não possui acesso a esta loja.');
    if(!['AGUARDANDO_CONFERENCIA','DIVERGENTE'].includes(String(d.status)))throw new functions.https.HttpsError('failed-precondition','Só é possível reprovar pallets pendentes.');
    tx.update(ref,{status:'REPROVADO',reprovadoEm:admin.firestore.FieldValue.serverTimestamp(),reprovadoMotivo:motivo,reprovadoPorUid:context.auth.uid,atualizadoEm:admin.firestore.FieldValue.serverTimestamp()});
  });
  await _apEvento(capa,'PALLET_REPROVADO',context,acesso,{motivo});
  return {ok:true};
});

exports.apontamentoCancelar = functions.region(AP_REGION).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context);_apRequire(acesso,'cancelar');
  const capa=_apValidarCapa(data&&data.capa),ref=db.collection(AP_COL).doc(capa),motivo=String((data&&data.motivo)||'').trim().slice(0,500);
  await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)throw new functions.https.HttpsError('not-found','Capa não encontrada.');const d=snap.data()||{};if(!_apLojaPermitida(acesso,d.lojaId))throw new functions.https.HttpsError('permission-denied','Sem acesso à loja.');if(d.status!=='AGUARDANDO_CONFERENCIA'&&d.status!=='DIVERGENTE')throw new functions.https.HttpsError('failed-precondition','Só é possível cancelar antes do envio à BlueSoft.');tx.update(ref,{status:'CANCELADO',motivoCancelamento:motivo,canceladoPorUid:context.auth.uid,canceladoPorNome:_apNome(acesso,context),canceladoEm:admin.firestore.FieldValue.serverTimestamp(),atualizadoEm:admin.firestore.FieldValue.serverTimestamp()});});
  await _apEvento(capa,'PRE_APONTAMENTO_CANCELADO',context,acesso,{motivo});return {ok:true};
});

// RECONSTRUÇÃO (2026-10-08): esta função existia em produção (o botão "Produção
// já confirmada → iniciar só WMS" em 127-estoque-apontamento.js já a chama),
// mas sumiu do código-fonte local numa edição anterior sem redeploy — nenhum
// backup/zip encontrado tinha o original. Reconstruída a partir da descrição
// funcional já registrada nesta conversa e do contrato exato que o front
// espera (r.corrigidas[]/r.ignoradas[{capa,motivo}]).
//
// Correção administrativa, admin-only (ação "configurar"): alguns apontamentos
// pelo endpoint síncrono (/api/pcp/apontamento-producao, sem ficha técnica)
// ficaram presos em status PROCESSANDO sem nenhum requestId — bug antigo já
// corrigido em _apEnviarParaBluesoft (hoje, sem requestId na resposta, esse
// endpoint já confirma na hora). Esta ação só destrava registros ANTIGOS
// presos nesse estado específico: confirma que a produção já está de
// verdade na BlueSoft (não reenvia o POST) e dispara só a etapa WMS.
exports.apontamentoConfirmarPcpManual = functions.region(AP_REGION).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context);_apRequire(acesso,'configurar');
  const capaUnica=data&&data.capa?_apValidarCapa(data.capa):null;
  let docs;
  if(capaUnica){
    const snap=await db.collection(AP_COL).doc(capaUnica).get();
    docs=snap.exists?[snap]:[];
  }else{
    const snap=await db.collection(AP_COL).where('status','==','PROCESSANDO').limit(200).get();
    docs=snap.docs;
  }
  const corrigidas=[],ignoradas=[];
  for(const snap of docs){
    const d=snap.data()||{};
    const capa=String(d.capa||snap.id);
    if(!_apLojaPermitida(acesso,d.lojaId)){ignoradas.push({capa,motivo:'Sem acesso à loja desta capa.'});continue;}
    const integ=d.integracao||{};
    const elegivel=String(d.status)==='PROCESSANDO'&&String(integ.endpoint||'')==='/api/pcp/apontamento-producao'&&!integ.requestId;
    if(!elegivel){ignoradas.push({capa,motivo:'Não atende aos critérios (precisa estar PROCESSANDO, pelo endpoint síncrono, sem requestId).'});continue;}
    const ref=db.collection(AP_COL).doc(snap.id);
    await ref.set({
      status:'APONTADO_BLUESOFT',
      integracao:Object.assign({},integ,{status:'CONCLUIDO',erro:null,dataConfirmacao:admin.firestore.FieldValue.serverTimestamp()}),
      confirmacaoManualPcp:{confirmadoPorUid:context.auth.uid,confirmadoPorNome:_apNome(acesso,context),confirmadoEm:admin.firestore.FieldValue.serverTimestamp()},
      atualizadoEm:admin.firestore.FieldValue.serverTimestamp()
    },{merge:true});
    await _apEvento(capa,'PCP_CONFIRMADO_MANUALMENTE',context,acesso,{});
    await _apMarcarWms(ref);
    corrigidas.push(capa);
  }
  if(capaUnica&&!corrigidas.length&&!ignoradas.length)ignoradas.push({capa:capaUnica,motivo:'Capa não encontrada.'});
  return {corrigidas,ignoradas};
});

const WA_REGION = 'southamerica-east1';
const WA_SECRETS = ['WHATSAPP_ACCESS_TOKEN','WHATSAPP_VERIFY_TOKEN','WHATSAPP_APP_SECRET','WHATSAPP_PHONE_NUMBER_ID'];
const WA_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';

function _waPerm(acesso, modulo, acao) {
  return administrador(acesso) || Boolean(
    acesso && acessoAtivo(acesso) && acesso.permissoes &&
    acesso.permissoes[modulo] && acesso.permissoes[modulo][acao] === true
  );
}
function _waRequire(acesso, modulo, acao) {
  if (!_waPerm(acesso, modulo, acao)) {
    throw new functions.https.HttpsError('permission-denied', 'Sem permissão para esta ação no Atendimento.');
  }
}
function _waNome(acesso, context) {
  return String((acesso && (acesso.nome || acesso.displayName)) ||
    (context.auth && context.auth.token && (context.auth.token.name || context.auth.token.email)) || 'Atendente');
}
function _waConversaRef(id) {
  if (!id || !/^[A-Za-z0-9_.:+-]{3,120}$/.test(String(id))) {
    throw new functions.https.HttpsError('invalid-argument', 'Conversa inválida.');
  }
  return db.collection('wa_conversas').doc(String(id));
}
function _waPodeOperarConversa(acesso, context, conversa) {
  if (administrador(acesso) || _waPerm(acesso,'atendimento-conversas','supervisionar')) return true;
  return conversa && String(conversa.responsavelUid || '') === String(context.auth.uid || '');
}

exports.whatsappStatusIntegracao = functions.region(WA_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context);
  _waRequire(acesso, 'atendimento-config', 'visualizar');
  return {
    configurado: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_VERIFY_TOKEN),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ? String(process.env.WHATSAPP_PHONE_NUMBER_ID).slice(-6).padStart(String(process.env.WHATSAPP_PHONE_NUMBER_ID).length,'•') : '',
    graphVersion: WA_GRAPH_VERSION,
  };
});

exports.whatsappListarAgentes = functions.region(WA_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context);
  _waRequire(acesso, 'atendimento-conversas', 'visualizar');
  const snap = await db.collection('usuarios_acessos').get();
  const agentes = [];
  snap.forEach(doc => {
    const a = doc.data() || {};
    if (!acessoAtivo(a)) return;
    if (!(administrador(a) || _waPerm(a,'atendimento-conversas','responder'))) return;
    agentes.push({uid: doc.id, nome: String(a.nome || a.displayName || a.email || doc.id), email: String(a.email || '')});
  });
  agentes.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));
  return {agentes};
});

exports.whatsappAssumirConversa = functions.region(WA_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context);
  _waRequire(acesso, 'atendimento-conversas', 'assumir');
  const ref = _waConversaRef(data && data.conversaId);
  const nome = _waNome(acesso, context);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Conversa não encontrada.');
    const c = snap.data() || {};
    if (c.responsavelUid && c.responsavelUid !== context.auth.uid && !_waPerm(acesso,'atendimento-conversas','supervisionar') && !administrador(acesso)) {
      throw new functions.https.HttpsError('failed-precondition', 'Esta conversa já está com ' + (c.responsavelNome || 'outro atendente') + '.');
    }
    tx.set(ref, {responsavelUid: context.auth.uid, responsavelNome: nome, status:'em_atendimento', assumidaEm: admin.firestore.FieldValue.serverTimestamp(), atualizadaEm: admin.firestore.FieldValue.serverTimestamp()}, {merge:true});
  });
  return {ok:true};
});

exports.whatsappTransferirConversa = functions.region(WA_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context);
  _waRequire(acesso, 'atendimento-conversas', 'transferir');
  const ref = _waConversaRef(data && data.conversaId);
  const destinoUid = String((data && data.destinoUid) || '');
  const [convSnap, destSnap] = await Promise.all([ref.get(), db.collection('usuarios_acessos').doc(destinoUid).get()]);
  if (!convSnap.exists) throw new functions.https.HttpsError('not-found','Conversa não encontrada.');
  if (!destSnap.exists || !acessoAtivo(destSnap.data()) || !_waPerm(destSnap.data(),'atendimento-conversas','responder')) throw new functions.https.HttpsError('invalid-argument','Atendente de destino inválido.');
  const c = convSnap.data() || {};
  if (!_waPodeOperarConversa(acesso,context,c)) throw new functions.https.HttpsError('permission-denied','Somente o responsável ou supervisor pode transferir.');
  const da = destSnap.data() || {};
  await ref.set({responsavelUid:destinoUid,responsavelNome:String(da.nome||da.displayName||da.email||destinoUid),status:'em_atendimento',transferidaPorUid:context.auth.uid,transferidaEm:admin.firestore.FieldValue.serverTimestamp(),atualizadaEm:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  return {ok:true};
});

exports.whatsappAtualizarStatus = functions.region(WA_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context);
  _waRequire(acesso, 'atendimento-conversas', 'finalizar');
  const status = String((data && data.status) || '');
  if (!['novo','em_atendimento','aguardando_cliente','resolvido'].includes(status)) throw new functions.https.HttpsError('invalid-argument','Status inválido.');
  const ref = _waConversaRef(data && data.conversaId); const snap=await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found','Conversa não encontrada.');
  if (!_waPodeOperarConversa(acesso,context,snap.data())) throw new functions.https.HttpsError('permission-denied','Somente o responsável ou supervisor pode alterar o status.');
  await ref.set({status,atualizadaEm:admin.firestore.FieldValue.serverTimestamp(),finalizadaEm:status==='resolvido'?admin.firestore.FieldValue.serverTimestamp():null},{merge:true});
  return {ok:true};
});

exports.whatsappAdicionarNota = functions.region(WA_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context); _waRequire(acesso,'atendimento-conversas','notas');
  const texto=String((data&&data.texto)||'').trim(); if(!texto||texto.length>4000)throw new functions.https.HttpsError('invalid-argument','Nota inválida.');
  const ref=_waConversaRef(data&&data.conversaId); const snap=await ref.get(); if(!snap.exists)throw new functions.https.HttpsError('not-found','Conversa não encontrada.');
  if(!_waPodeOperarConversa(acesso,context,snap.data())&&!_waPerm(acesso,'atendimento-conversas','supervisionar'))throw new functions.https.HttpsError('permission-denied','Sem permissão nesta conversa.');
  await ref.collection('notas').add({texto,autorUid:context.auth.uid,autorNome:_waNome(acesso,context),criadaEm:admin.firestore.FieldValue.serverTimestamp()});
  return {ok:true};
});


// ===================================================================
// INTEGRAÇÃO WMS (pallet logístico BlueSoft) — configuração em dt_config/apontamento_producao.
// Tudo fica DESLIGADO enquanto integracaoWmsAtiva !== true. As regras de decisão
// estão em wms-logica.js (testadas). Vínculo permanente: capaDt ↔ paleteKey.
// ===================================================================
const wmsLogica = require('./wms-logica');
async function _apLerConfigWms() {
  const c = await db.collection('dt_config').doc('apontamento_producao').get();
  const d = (c.exists && c.data()) || {};
  return {
    ativa: d.integracaoWmsAtiva === true,
    motivo: Number(d.wmsMotivo) || 1,
    porLoja: (d.wmsPorLoja && typeof d.wmsPorLoja === 'object') ? d.wmsPorLoja : {}
  };
}
function _apCdKeyDaLoja(cfgWms, lojaKey) {
  const l = cfgWms.porLoja[String(lojaKey)] || {};
  const cd = Number(l.cdKey);
  return { cdKey: Number.isFinite(cd) && cd > 0 ? cd : null, ativo: l.ativo === true };
}
function _apListaDe(resp) {
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp.data)) return resp.data;
  return [];
}
// Erro bruto da BlueSoft guardado de forma segura (sem token) para ajuste futuro.
function _apErroSeguro(e) {
  return String((e && e.message) || e || '').slice(0, 500);
}
// Pede a criação do lote logístico. Lê o registro de novo antes do POST (idempotência).
async function _apSolicitarWms(ref) {
  const snap = await ref.get();
  const d = snap.data() || {};
  const w = d.wms || {};
  const cfgWms = await _apLerConfigWms();
  const lojaKey = Number(d.bluesoftLojaKey);
  const cd = _apCdKeyDaLoja(cfgWms, lojaKey);
  const decisao = wmsLogica.podeSolicitarWms({ativa: cfgWms.ativa, cdKey: cd.cdKey, lojaAtiva: cd.ativo, wms: w});
  if (!decisao.ok) {
    if (decisao.motivo === 'sem_cdkey' || decisao.motivo === 'loja_inativa') {
      await ref.set({wms: {status: 'WMS_AGUARDANDO_CONFIGURACAO', erro: decisao.mensagem, atualizadoEm: admin.firestore.FieldValue.serverTimestamp()}}, {merge: true});
    }
    return decisao;
  }
  const cfg = await _lerConfigIntegracaoApiEstoque(d.lojaId, db);
  const payload = {
    importarComDivergencia: false,
    motivo: cfgWms.motivo,
    itens: [{ lojaKey: lojaKey, cdKey: cd.cdKey, produtoKey: Number(d.produtoKey), quantidadeSugerida: Number(d.quantidadeConferida || d.quantidade) }]
  };
  try {
    const resp = await _apBluesoftPost('/api/v3/wms/lotes-logisticos/importar', cfg, payload);
    const requestId = String((resp && resp.requestId) || '');
    if (!requestId) throw new Error('A BlueSoft não devolveu o requestId da importação de lote.');
    // requestId = solicitação recebida. NÃO é pallet criado: só o acompanhamento confirma.
    await ref.set({wms: {status: 'PROCESSANDO', requestId: requestId, paleteKey: null, logisticaLoteItemKey: null, criadoEm: admin.firestore.FieldValue.serverTimestamp(), erro: null}}, {merge: true});
    return {ok: true, requestId: requestId};
  } catch (e) {
    const st = e && e.apTipo === 'incerto' ? 'WMS_RESULTADO_INDETERMINADO' : 'WMS_FALHA';
    await ref.set({wms: {status: st, erro: _apErroSeguro(e)}}, {merge: true});
    return {ok: false, motivo: st, mensagem: _apErroSeguro(e)};
  }
}
// Acompanha o requestId. Só marca criado/vinculado quando a consulta confirmar.
async function _apAcompanharWms(ref, d) {
  const w = d.wms || {};
  if (!w.requestId) return w.status;
  const cfg = await _lerConfigIntegracaoApiEstoque(d.lojaId, db);
  let resp;
  try {
    resp = await _bluesoftGetSomenteLeitura('/api/v3/wms/externo/lotes-logisticos/' + encodeURIComponent(w.requestId), cfg);
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) {
      await ref.set({wms: {status: 'WMS_SEM_PERMISSAO_MONITORAMENTO', erro: 'A credencial BlueSoft não possui permissão para consultar processamento assíncrono (4047).'}}, {merge: true});
      return 'WMS_SEM_PERMISSAO_MONITORAMENTO';
    }
    await ref.set({wms: {erro: 'Consulta WMS falhou: ' + _apErroSeguro(e)}}, {merge: true});
    throw e;
  }
  const lotes = Array.isArray(resp && resp.lotesGerados) ? resp.lotesGerados : [];
  const lojaKey = Number(d.bluesoftLojaKey);
  let candidatos = [];
  const pre = wmsLogica.normalizarStatusBlueSoft(resp && resp.status);
  if (pre === 'FINALIZADO' && lotes.length) {
    const numeroLote = String((lotes[0] || {}).numeroDoLote || (lotes[0] || {}).numeroLote || d.lote || '');
    try {
      const r = await _bluesoftGetSomenteLeitura('/api/wms/enderecamento-de-paletes?currentPage=0&pageSize=100&lojaKey=' + encodeURIComponent(lojaKey) + '&numeroDoLote=' + encodeURIComponent(numeroLote), cfg);
      candidatos = _apListaDe(r);
    } catch (e) {
      candidatos = [];
    }
  }
  const dec = wmsLogica.decidirAcompanhamentoWms(resp, {produtoKey: d.produtoKey, numeroLoteAtual: d.lote, candidatos: candidatos});
  if (dec.desconhecido) return w.status;
  await ref.set({wms: Object.assign({status: dec.status, requestId: w.requestId}, dec.dados, dec.status === 'VINCULADO' ? {vinculadoEm: admin.firestore.FieldValue.serverTimestamp()} : {})}, {merge: true});
  return dec.status;
}

exports.apontamentoConsultarWms = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context); _apRequire(acesso, 'visualizar');
  const capa = _apValidarCapa(data && data.capa), ref = db.collection(AP_COL).doc(capa);
  const snap = await ref.get(); if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Capa não encontrada.');
  const d = snap.data() || {};
  await _apRequireLoja(acesso, d.lojaId);
  const status = await _apAcompanharWms(ref, d);
  return {status: status};
});

// Teste da configuração WMS (somente administrador). Cada verificação traz resultado próprio.
exports.apontamentoTestarWms = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context);
  if (!administrador(acesso)) throw new functions.https.HttpsError('permission-denied', 'Somente administrador pode testar a integração WMS.');
  const loja = await _apRequireLoja(acesso, data && data.lojaId);
  const cfgWms = await _apLerConfigWms();
  const checks = [];
  const cd = _apCdKeyDaLoja(cfgWms, loja.bluesoftLojaKey);
  checks.push({item: 'cdKey configurado', ok: Boolean(cd.cdKey), detalhe: cd.cdKey ? 'cdKey ' + cd.cdKey : 'Informe o cdKey desta loja.'});
  let cfg = null;
  try { cfg = await _lerConfigIntegracaoApiEstoque(loja.id, db); checks.push({item: 'Configuração da API BlueSoft', ok: true, detalhe: 'Carregada.'}); }
  catch (e) { checks.push({item: 'Configuração da API BlueSoft', ok: false, detalhe: _apErroSeguro(e)}); }
  if (cfg) {
    try { await _bluesoftGetSomenteLeitura('/api/comercial/produtos/gtin-plu?currentPage=0&pageSize=1&gtinPlu=0', cfg); checks.push({item: 'Autenticação BlueSoft', ok: true, detalhe: 'Token aceito.'}); }
    catch (e) { checks.push({item: 'Autenticação BlueSoft', ok: false, detalhe: (e && (e.status === 401 || e.status === 403)) ? 'Token recusado pela BlueSoft.' : _apErroSeguro(e)}); }
    try { await _bluesoftGetSomenteLeitura('/api/monitoramento/async/0', cfg); checks.push({item: 'Monitoramento assíncrono', ok: true, detalhe: 'Permissão 4047 disponível.'}); }
    catch (e) {
      if (e && (e.status === 401 || e.status === 403)) checks.push({item: 'Monitoramento assíncrono', ok: false, detalhe: 'A credencial BlueSoft não possui permissão para consultar processamento assíncrono (4047).'});
      else checks.push({item: 'Monitoramento assíncrono', ok: true, detalhe: 'Resposta recebida (' + _apErroSeguro(e).slice(0, 120) + ').'});
    }
    try { await _bluesoftGetSomenteLeitura('/api/wms/enderecamento-de-paletes?currentPage=0&pageSize=1&lojaKey=' + encodeURIComponent(loja.bluesoftLojaKey), cfg); checks.push({item: 'API WMS acessível', ok: true, detalhe: 'Respondeu.'}); }
    catch (e) { checks.push({item: 'API WMS acessível', ok: false, detalhe: _apErroSeguro(e).slice(0, 200)}); }
  }
  return {checks: checks, integracaoAtiva: cfgWms.ativa};
});

// Reprocessa SOMENTE a etapa WMS. Antes consulta a tentativa anterior. Nunca reenvia o PCP.
exports.apontamentoReprocessarWms = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context); _apRequire(acesso, 'reprocessar');
  const capa = _apValidarCapa(data && data.capa), ref = db.collection(AP_COL).doc(capa);
  const snap = await ref.get(); if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Capa não encontrada.');
  let d = snap.data() || {};
  await _apRequireLoja(acesso, d.lojaId);
  // 1) consulta o estado da tentativa anterior, se existir
  if ((d.wms || {}).requestId) {
    try { await _apAcompanharWms(ref, d); } catch (_) { /* erro de consulta fica registrado */ }
    d = (await ref.get()).data() || {};
  }
  const decisao = wmsLogica.podeReprocessarWms(d);
  if (!decisao.ok) throw new functions.https.HttpsError('failed-precondition', decisao.mensagem);
  // 2) limpa só a tentativa anterior falha e solicita de novo a etapa WMS
  await ref.set({wms: {status: null, requestId: null, erro: null}}, {merge: true});
  const r = await _apSolicitarWms(ref);
  return {ok: r.ok === true, mensagem: r.ok ? 'WMS reenviado conforme a configuração atual.' : (r.mensagem || r.motivo || 'Não foi possível reenviar o WMS.')};
});

// Endereçamento: o operador trabalha pela Capa DT; o backend usa o paleteKey vinculado.
exports.apontamentoEnderecarPallet = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
  const acesso = await acessoSolicitante(context); _apRequire(acesso, 'conferir');
  const capa = _apValidarCapa(data && data.capa), ref = db.collection(AP_COL).doc(capa);
  const enderecoKey = Number(data && data.enderecoLogisticoKey);
  if (!(enderecoKey > 0)) throw new functions.https.HttpsError('invalid-argument', 'Informe o endereço de destino.');
  const snap = await ref.get(); if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Capa não encontrada.');
  const d = snap.data() || {};
  await _apRequireLoja(acesso, d.lojaId);
  const decisao = wmsLogica.podeEnderecarPallet(d);
  if (!decisao.ok) throw new functions.https.HttpsError('failed-precondition', decisao.mensagem);
  const cfg = await _lerConfigIntegracaoApiEstoque(d.lojaId, db);
  const w = d.wms || {};
  try {
    await _apBluesoftPost('/api/wms/enderecamento-de-paletes', cfg, {lojaKey: Number(d.bluesoftLojaKey), novoEndereco: enderecoKey, paleteKey: Number(w.paleteKey)});
  } catch (e) {
    await ref.set({wms: {erroEnderecamento: _apErroSeguro(e), erroEnderecamentoEm: admin.firestore.FieldValue.serverTimestamp()}}, {merge: true});
    throw new functions.https.HttpsError('failed-precondition', 'BlueSoft recusou o endereçamento: ' + _apErroSeguro(e));
  }
  await ref.set({wms: {status: 'ENDERECADO', enderecoLogisticoKey: enderecoKey, enderecadoEm: admin.firestore.FieldValue.serverTimestamp(), erro: null, erroEnderecamento: null}}, {merge: true});
  return {ok: true};
});


// ═══════════════════════════════════════════════════════════════════════
// ESTOQUE · OPERAÇÕES VIA ARQUIVO (2026-10-07)
// Endereçamento de paletes, Lote de Trocas e Transformação de Produtos.
// Contratos conferidos no OpenAPI real da Bluesoft.
// ═══════════════════════════════════════════════════════════════════════
function _eopPerm(acesso, modulo, acao) {
  return administrador(acesso) || Boolean(acesso && acessoAtivo(acesso) && acesso.permissoes && acesso.permissoes[modulo] && acesso.permissoes[modulo][acao] === true);
}
function _eopRequire(acesso, modulo, acao) {
  if (!_eopPerm(acesso, modulo, acao)) throw new functions.https.HttpsError('permission-denied', 'Sem permissão para esta operação de estoque.');
}
async function _eopPost(pathApi, cfg, payload) {
  return _apBluesoftPost(pathApi, cfg, payload);
}
function _eopLinhas(data) {
  const linhas = Array.isArray(data && data.linhas) ? data.linhas : [];
  if (!linhas.length) throw new functions.https.HttpsError('invalid-argument', 'O arquivo não possui linhas para processar.');
  if (linhas.length > 500) throw new functions.https.HttpsError('invalid-argument', 'Máximo de 500 linhas por execução.');
  const indices=data&&data.indices;
  if(!Array.isArray(indices)||indices.length!==linhas.length||new Set(indices).size!==indices.length||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=100000))throw new functions.https.HttpsError('invalid-argument','Índices de linhas inválidos. Reimporte a planilha na versão atualizada.');
  return linhas;
}
function _eopCheckNumero(v, inteiro=true) {
  const raw=String(v==null?'':v).trim();
  if (!(inteiro ? /^\d+$/.test(raw) : /^\d+(?:\.\d+)?$/.test(raw))) return false;
  const n=Number(raw);return n>0&&Number.isFinite(n)&&(!inteiro||Number.isSafeInteger(n));
}
function _eopValidarLote(linhas, modo, aceitarEnderecoFisico=false) {
  const vistos=new Set();
  linhas.forEach((l,i)=>{
    const required=modo==='end'?['paleteKey','enderecoLogisticoKey']:modo==='troca'?['gtin','motivoTrocaKey','setorOperacionalKey']:['localDeEstoqueKey'];
    for(const campo of required)if(!(modo==='end'&&campo==='enderecoLogisticoKey'&&aceitarEnderecoFisico&&/^\d+(?:\.\d+)+$/.test(String(l[campo]||'').trim()))&&!_eopCheckNumero(l[campo]))throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': '+campo+' inválido.');
    if(modo==='troca'&&!_eopCheckNumero(l.quantidade,false))throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': quantidade inválida.');
    if(modo==='troca'&&String(l.gtin).length>14)throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': GTIN inválido.');
    if(modo==='transf'){
      if(!_eopCheckNumero(l.transformacaoKey)&&!_eopCheckNumero(l.produtoKey))throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': transformação ou produto obrigatório.');
      if(!_eopCheckNumero(l.quantidadeTransformacao,false))throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': quantidade inválida.');
      if(!['ESTOQUE_TROCA','ESTOQUE_VENDA'].includes(l.origemDaTransformacao))throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': origem inválida.');
    }
    if(modo==='end'){
      for(const campo of ['paleteKeyParaAglutinar','logisticaLoteItemKey','quantidadeEnderecar','gtin'])if(l[campo]!=null&&l[campo]!==''&&!_eopCheckNumero(l[campo]))throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': '+campo+' inválido.');
      const present=['logisticaLoteItemKey','quantidadeEnderecar','gtin'].filter(k=>l[k]!=null&&l[k]!=='').length;
      if(present!==0&&present!==3)throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': dados de item incompletos.');
    }
    const chave=modo==='end'?'end:'+l.paleteKey:modo==='troca'?'troca:'+l.gtin+':'+l.motivoTrocaKey+':'+l.setorOperacionalKey:'transf:'+l.transformacaoKey+':'+l.produtoKey+':'+l.localDeEstoqueKey+':'+l.origemDaTransformacao;
    if(vistos.has(chave))throw new functions.https.HttpsError('invalid-argument','Linha '+(i+1)+': duplicidade na remessa.');
    vistos.add(chave);
  });
}
// Pré-checagem no SERVIDOR: não confiar exclusivamente no botão de validação do navegador.
// Todas as consultas são somente leitura; se falharem, nenhum POST desta remessa é iniciado.
async function _eopConferirCadastroAntesPost(linhas, modo, cfg) {
  if (modo === 'troca') {
    const resp = await _bluesoftGetSomenteLeitura('/api/estoque/motivos-de-troca', cfg);
    const lista = Array.isArray(resp) ? resp : resp && Array.isArray(resp.data) ? resp.data : null;
    if (!lista) throw new functions.https.HttpsError('failed-precondition','Não foi possível verificar motivos de troca na BlueSoft; nenhum registro foi enviado.');
    const validos = new Set(lista.filter(x => x && _eopCheckNumero(x.motivoTrocaKey)).map(x => String(Number(x.motivoTrocaKey))));
    linhas.forEach((l, i) => {
      if (!validos.has(String(Number(l.motivoTrocaKey)))) throw new functions.https.HttpsError('failed-precondition','Linha '+(i+1)+': motivo de troca não confirmado na BlueSoft; nenhum registro foi enviado.');
    });
  }
  if (modo === 'transf') {
    const cache = new Map();
    for (const [i, l] of linhas.entries()) {
      if (!_eopCheckNumero(l.produtoKey)) throw new functions.https.HttpsError('failed-precondition','Linha '+(i+1)+': informe produtoKey para confirmar a transformação antes de executar.');
      const produto = String(Number(l.produtoKey));
      if (!cache.has(produto)) {
        const resp = await _bluesoftGetSomenteLeitura('/api/comercial/produtos/transformacao?produtoKey='+encodeURIComponent(produto), cfg);
        const lista = Array.isArray(resp) ? resp : resp && Array.isArray(resp.data) ? resp.data : null;
        if (!lista) throw new functions.https.HttpsError('failed-precondition','Não foi possível validar transformações do produto '+produto+'; nenhum registro foi enviado.');
        cache.set(produto, lista);
      }
      const lista = cache.get(produto);
      if (_eopCheckNumero(l.transformacaoKey)) {
        const chave = String(Number(l.transformacaoKey));
        if (!lista.some(x => x && String(Number(x.transformacaoKey)) === chave)) throw new functions.https.HttpsError('failed-precondition','Linha '+(i+1)+': transformação não vinculada ao produto '+produto+'; nenhum registro foi enviado.');
      } else {
        if (lista.length !== 1 || !_eopCheckNumero(lista[0] && lista[0].transformacaoKey)) throw new functions.https.HttpsError('failed-precondition','Linha '+(i+1)+': transformação ambígua ou sem código válido; nenhum registro foi enviado.');
        // Fixa o código validado para que a execução não selecione outra transformação depois.
        l.transformacaoKey = Number(lista[0].transformacaoKey);
      }
    }
  }
}
// Registro persistente por linha: se a conexão com a BlueSoft cair após o POST,
// a mesma operação fica pendente de conciliação, nunca é enviada novamente às cegas.
async function _eopExecutarUmaVez(data, loja, modo, indice, linha, executar) {
  const lote=String(data&&data.operacaoId||'');
  if(!/^[a-zA-Z0-9_-]{12,90}$/.test(lote)) throw new functions.https.HttpsError('invalid-argument','Identificador persistente da operação obrigatório. Reimporte a planilha na tela atualizada.');
  const crypto=require('crypto');
  const hash=crypto.createHash('sha256').update(JSON.stringify({loja:String(loja.id),modo,linha})).digest('hex');
  const key=crypto.createHash('sha256').update(String(loja.id)+':'+modo+':'+lote+':'+indice).digest('hex');
  const ref=db.collection('dt_estoque_operacoes_execucoes').doc(key);
  const anterior=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(snap.exists)return snap.data();
    tx.create(ref,{lojaId:String(loja.id),modo,operacaoId:lote,indice,hash,status:'processando',criadoEm:admin.firestore.FieldValue.serverTimestamp()});
    return null;
  });
  if(anterior){
    if(anterior.hash!==hash)return {ok:false,erro:'Operação alterada após o primeiro envio. Inicie nova operação somente depois de conferir a BlueSoft.'};
    if(anterior.status==='concluido')return {ok:true,jaProcessado:true,detalhe:'Já enviado anteriormente; não reenviado.',...(anterior.retorno||{})};
    return {ok:false,requerConferencia:true,erro:'Envio anterior já iniciado ou com resultado incerto. Confira na BlueSoft antes de criar uma nova operação.'};
  }
  try {
    const retorno=await executar();
    await ref.update({status:'concluido',retorno:retorno||{},finalizadoEm:admin.firestore.FieldValue.serverTimestamp()});
    return {ok:true,...(retorno||{})};
  }catch(e){
    const rejeitado=e&&e.apTipo==='rejeitado';
    await ref.update({status:rejeitado?'rejeitado':'conferencia_necessaria',httpStatus:Number(e&&e.status)||null,erro:String(e.message||e).slice(0,700),finalizadoEm:admin.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
    return {ok:false,requerConferencia:!rejeitado,rejeitadoPelaBluesoft:rejeitado,erro:String(e.message||e).slice(0,700)+(rejeitado?' — BlueSoft recusou; nenhuma baixa confirmada.':' — Verifique o resultado na BlueSoft antes de tentar novamente.')};
  }
}
// Consulta somente leitura ao histórico persistente da operação. Não altera estoque.
exports.consultarHistoricoEstoqueArquivo = functions.region(AP_REGION).runWith({timeoutSeconds:120,memory:'256MB'}).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const modo=String(data&&data.modo||'');
  const modulos={end:'estoque-enderecamento',troca:'estoque-lote-trocas',transf:'estoque-transformacao-api'};
  if(!Object.prototype.hasOwnProperty.call(modulos,modo)) throw new functions.https.HttpsError('invalid-argument','Tipo de operação inválido.');
  const acesso=await acessoSolicitante(context);
  _eopRequire(acesso,modulos[modo],'visualizar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId);
  const lote=String(data&&data.operacaoId||'');
  if(!/^[a-zA-Z0-9_-]{12,90}$/.test(lote)) throw new functions.https.HttpsError('invalid-argument','Identificador inválido.');
  const indices=data&&data.indices;
  if(!Array.isArray(indices)||indices.length>500||new Set(indices).size!==indices.length||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=100000))throw new functions.https.HttpsError('invalid-argument','Índices inválidos.');
  const crypto=require('crypto');
  const refs=indices.map(indice=>db.collection('dt_estoque_operacoes_execucoes').doc(crypto.createHash('sha256').update(String(loja.id)+':'+modo+':'+lote+':'+indice).digest('hex')));
  const docs=await Promise.all(refs.map(ref=>ref.get()));
  return {registros:docs.map((snap,i)=>{
    if(!snap.exists)return {indice:indices[i],status:'nao_iniciado'};
    const d=snap.data()||{};
    if(d.lojaId!==String(loja.id)||d.modo!==modo||d.operacaoId!==lote||d.indice!==indices[i])return {indice:indices[i],status:'conferencia_necessaria'};
    return {indice:indices[i],status:d.status==='concluido'?'concluido':d.status==='rejeitado'?'rejeitado':'conferencia_necessaria',hash:d.hash||'',detalhe:d.status==='concluido'?String((d.retorno&&d.retorno.detalhe)||'Concluído anteriormente').slice(0,200):d.status==='rejeitado'?String(d.erro||'BlueSoft recusou a operação').slice(0,200):'Envio já iniciado ou incerto; confira na BlueSoft.'};
  })};
});
// Lista os paletes por páginas com limite explícito de consulta.
// Não inferimos ausência quando a paginação ainda pode ter outros resultados.
async function _eopConsultarPaletesPagina(cfg, lojaKey, paginasMaximas) {
  const paletes = new Map();
  let completa = false;
  for (let pagina = 0; pagina < paginasMaximas; pagina++) {
    const resp = await _bluesoftGetSomenteLeitura('/api/wms/enderecamento-de-paletes?currentPage='+pagina+'&pageSize=100&lojaKey='+encodeURIComponent(lojaKey),cfg);
    if (!resp || !Array.isArray(resp.data)) throw new functions.https.HttpsError('failed-precondition','Consulta WMS não retornou a lista de paletes no formato esperado.');
    for (const item of resp.data) {
      if (item && _eopCheckNumero(item.paleteKey)) paletes.set(String(Number(item.paleteKey)), item);
    }
    if (resp.data.length < 100 || resp.last === true || resp.lastPage === true || (Number.isSafeInteger(resp.totalPages) && pagina+1 >= resp.totalPages)) { completa = true; break; }
  }
  return {paletes, completa};
}
// CORREÇÃO (2026-10-08): a V13 só reconhecia o endereço físico quando ele era
// IDÊNTICO ao destino que a própria BlueSoft sugere para aquele palete
// específico (enderecoDeDestino/enderecoDeDestinoKey de
// /api/wms/enderecamento-de-paletes) — mas essa sugestão é só uma
// recomendação do WMS pra UM palete, não a lista de endereços válidos da
// loja. Isso bloqueava 100% dos 42 paletes sempre que o destino desejado era
// diferente do sugerido (ou quando o palete não tinha sugestão nenhuma).
// Fonte real de correspondência físico↔chave, confirmada no schema
// AjusteEstoqueLogisticoResponse (campos enderecoLogisticoKey +
// enderecoLogisticoDescritivo) e já usada em produção por
// 90-bluesoft-service.js pra montar estoque WMS: GET
// /api/wms/ajuste-estoque-logistico?lojaKey=. Isso é um CATÁLOGO de
// endereços da loja — não depende de qual palete está sendo endereçado.
async function _eopCatalogoEnderecosLogisticos(cfg, lojaKey) {
  const resp = await _bluesoftGetSomenteLeitura('/api/wms/ajuste-estoque-logistico?lojaKey='+encodeURIComponent(lojaKey), cfg);
  const linhas = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.data) ? resp.data : null);
  if (!linhas) throw new functions.https.HttpsError('failed-precondition','Catálogo de endereços logísticos (ajuste-estoque-logistico) não retornou formato reconhecido; não é seguro resolver endereços físicos.');
  const porDescritivo = new Map();
  linhas.forEach(item => {
    const descritivo = String((item && item.enderecoLogisticoDescritivo) || '').trim();
    const key = item && item.enderecoLogisticoKey;
    if (descritivo && _eopCheckNumero(key)) porDescritivo.set(descritivo, Number(key));
  });
  return porDescritivo;
}
// Consulta oficial: permissão BlueSoft 4011. Setor de armazenagem do WMS
// e setor operacional são cadastros diferentes; não inferir pelo endereço.
const setoresEstoque=require('./estoque-setores');
async function _eopSetores(cfg){
  const r=await _bluesoftGetSomenteLeitura('/api/estoque/setor-operacional',cfg);
  const itens=Array.isArray(r)?r:r&&r.data;
  if(!Array.isArray(itens))throw new functions.https.HttpsError('failed-precondition','Consulta de setores retornou formato desconhecido. Verifique a permissão BlueSoft 4011.');
  return itens;
}
exports.listarSetoresOperacionais=functions.region(AP_REGION).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login.');
  const a=await acessoSolicitante(context),modo=data&&data.modo==='transf'?'transf':'troca',modulo=modo==='transf'?'estoque-transformacao-api':'estoque-lote-trocas';_eopRequire(a,modulo,'visualizar');
  const loja=await _apRequireLoja(a,data&&data.lojaId),cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  const itens=await _eopSetores(cfg),vinculos=(await db.collection('dt_setores_endereco').where('lojaId','==',loja.id).get()).docs.map(s=>s.data());
  return {itens,vinculos,podeConfigurar:_eopPerm(a,modulo,'configurar')};
});
exports.salvarVinculoEnderecoSetor=functions.region(AP_REGION).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login.');
  const a=await acessoSolicitante(context),modulo=data&&data.modo==='transf'?'estoque-transformacao-api':'estoque-lote-trocas';_eopRequire(a,modulo,'configurar');
  const loja=await _apRequireLoja(a,data&&data.lojaId),cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  const endereco=String(data&&data.endereco||'').trim(),key=Number(data&&data.setorOperacionalKey);
  if(!/^\d+(?:\.\d+)+$/.test(endereco)||endereco.length>100)throw new functions.https.HttpsError('invalid-argument','Informe o endereço físico completo com pontos.');
  const setores=await _eopSetores(cfg);
  if(!setores.some(x=>Number(x.setorOperacionalKey)===key))throw new functions.https.HttpsError('invalid-argument','Selecione setor consultado na BlueSoft.');
  const catalogo=await _eopCatalogoEnderecosLogisticos(cfg,loja.bluesoftLojaKey);
  if(!catalogo.has(endereco))throw new functions.https.HttpsError('failed-precondition','Endereço não encontrado na consulta WMS desta loja. Confira o endereço; nenhum vínculo foi salvo.');
  const ref=db.collection('dt_setores_endereco').doc(setoresEstoque.idVinculo(loja.id,endereco));
  await db.runTransaction(async tx=>{const antes=await tx.get(ref),novo={lojaId:loja.id,endereco,setorOperacionalKey:key,ativo:data.ativo!==false,atualizado_por:context.auth.uid,atualizado_em:admin.firestore.FieldValue.serverTimestamp()};tx.set(ref,novo);tx.set(db.collection('dt_acessos_auditoria').doc(),{tipo:'ASSOCIAR_ENDERECO_SETOR',autor_uid:context.auth.uid,alvo:ref.id,antes:antes.exists?antes.data():null,depois:novo,criado_em:admin.firestore.FieldValue.serverTimestamp()});});
  return {ok:true};
});
async function _eopResolverSetores(linhas,modo,loja,cfg){
  if(modo!=='troca'&&modo!=='transf')return;
  const precisam=linhas.filter(l=>modo==='troca'||l.enderecoSetor||l.setorOperacionalKey);
  if(!precisam.length)return;
  const setores=await _eopSetores(cfg),cache=new Map();
  for(const l of precisam){
    const endereco=String(l.enderecoSetor||'').trim();let vinculo;
    if(endereco){if(!cache.has(endereco)){const s=await db.collection('dt_setores_endereco').doc(setoresEstoque.idVinculo(loja.id,endereco)).get();cache.set(endereco,s.exists?s.data():null);}vinculo=cache.get(endereco);if(vinculo&&vinculo.lojaId!==loja.id)throw new Error('Vínculo de outra loja.');}
    try{l.setorOperacionalKey=setoresEstoque.resolver(l,setores,vinculo);}catch(e){throw new functions.https.HttpsError('failed-precondition',e.message);}
  }
}
// Pré-validação consultiva: sem POST e sem alterações de estoque.
exports.prevalidarEstoqueArquivo = functions.region(AP_REGION).runWith({timeoutSeconds:120,memory:'256MB'}).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const modo=String(data&&data.modo||'');
  const modulos={end:'estoque-enderecamento',troca:'estoque-lote-trocas',transf:'estoque-transformacao-api'};
  if (!modulos[modo]) throw new functions.https.HttpsError('invalid-argument','Operação desconhecida.');
  const acesso=await acessoSolicitante(context);_eopRequire(acesso,modulos[modo],'visualizar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId);
  const linhas=_eopLinhas(data);
  const cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  await _eopResolverSetores(linhas,modo,loja,cfg);
  _eopValidarLote(linhas,modo,modo==='end');
  const resultados=linhas.map(l=>({ok:true,correcoes:l.enderecoSetor?{setorOperacionalKey:l.setorOperacionalKey}:{},detalhe:'Formato verificado; a API não oferece aqui uma verificação completa da movimentação.'}));
  if(modo==='troca'){
    const r=await _bluesoftGetSomenteLeitura('/api/estoque/motivos-de-troca',cfg);
    const motivos=Array.isArray(r)?r:r&&Array.isArray(r.data)?r.data:null;
    if(!motivos)throw new functions.https.HttpsError('failed-precondition','A BlueSoft não retornou a lista de motivos em formato reconhecido.');
    const chaves=new Set(motivos.map(x=>String(x.motivoTrocaKey)));
    linhas.forEach((l,i)=>{if(!chaves.has(String(l.motivoTrocaKey)))resultados[i]={ok:false,erro:'Motivo de troca não encontrado na BlueSoft.'};else resultados[i].detalhe='Motivo e setor operacional confirmados; saldo sujeito à execução.';resultados[i].correcoes={setorOperacionalKey:l.setorOperacionalKey};});
  }
  if(modo==='transf'){
    const grupos=new Map();
    linhas.forEach((l,i)=>{if(!l.produtoKey)return;const k=String(l.produtoKey);if(!grupos.has(k))grupos.set(k,[]);grupos.get(k).push(i);});
    for(const [produto,indices] of grupos){
      const resp=await _bluesoftGetSomenteLeitura('/api/comercial/produtos/transformacao?produtoKey='+encodeURIComponent(produto),cfg);
      const lista=Array.isArray(resp)?resp:resp&&Array.isArray(resp.data)?resp.data:null;
      if(!lista)throw new functions.https.HttpsError('failed-precondition','Resposta de transformação inesperada para produto '+produto+'.');
      for(const i of indices){
        const l=linhas[i],chave=String(l.transformacaoKey||'');
        if(chave){if(!lista.some(x=>String(x.transformacaoKey)===chave))resultados[i]={ok:false,erro:'Transformação não cadastrada para o produto '+produto+'.'};else resultados[i].detalhe='Transformação vinculada ao produto confirmada na BlueSoft.';}
        else if(lista.length!==1)resultados[i]={ok:false,erro:lista.length?'Há várias transformações; informe transformacaoKey.':'Não há transformação cadastrada.'};
        else {const encontrada=lista[0]&&lista[0].transformacaoKey;if(!_eopCheckNumero(encontrada))resultados[i]={ok:false,erro:'Transformação encontrada sem código válido; confira o cadastro na BlueSoft.'};else resultados[i]={ok:true,detalhe:'Transformação única encontrada e código preenchido pela BlueSoft.',correcoes:{...(l.enderecoSetor?{setorOperacionalKey:l.setorOperacionalKey}:{}),transformacaoKey:Number(encontrada)}};}
      }
    }
    linhas.forEach((l,i)=>{if(!l.produtoKey&&l.transformacaoKey)resultados[i]={ok:false,erro:'Informe produtoKey para conferir a transformação cadastrada na BlueSoft.'};});
  }
  if(modo==='end'){
    const consulta = await _eopConsultarPaletesPagina(cfg,loja.bluesoftLojaKey,50);
    const catalogo = await _eopCatalogoEnderecosLogisticos(cfg,loja.bluesoftLojaKey);
    linhas.forEach((l,i)=>{
      const palete=consulta.paletes.get(String(Number(l.paleteKey)));
      if (!palete) {
        resultados[i]={ok:false,erro:consulta.completa?'Palete não consta entre os paletes a endereçar na BlueSoft.':'Palete não encontrado nas primeiras 500 posições consultadas. Não é seguro confirmar sua disponibilidade.'};
        return;
      }
      // Sugestão do WMS é só informativa — nunca bloqueia e nunca substitui o
      // destino escolhido. A BlueSoft decide elegibilidade/capacidade no POST
      // (409/422), não esta pré-validação.
      const sugeridoKey=Number(palete.enderecoDeDestinoKey||0)||null;
      const sugeridoFisico=String(palete.enderecoDeDestino||'').trim()||null;
      const informado=String(l.enderecoLogisticoKey).trim();
      if(_eopCheckNumero(informado)){
        resultados[i]={ok:true,detalhe:'Chave numérica informada diretamente ('+informado+').'+(sugeridoFisico?' Sugestão da BlueSoft para este palete: '+sugeridoFisico+' ('+sugeridoKey+').':'')+' A BlueSoft validará elegibilidade e capacidade no POST (409/422).'};
        return;
      }
      if(/^\d+(?:\.\d+)+$/.test(informado)){
        const resolvido=catalogo.get(informado);
        if(resolvido){
          resultados[i]={ok:true,detalhe:'Endereço físico "'+informado+'" localizado no catálogo de endereços logísticos da loja (chave '+resolvido+').'+(sugeridoFisico&&sugeridoFisico!==informado?' Sugestão da BlueSoft para este palete: '+sugeridoFisico+' ('+sugeridoKey+').':'')+' A BlueSoft validará elegibilidade e capacidade no POST (409/422).',correcoes:{enderecoLogisticoKey:resolvido}};
        } else {
          resultados[i]={ok:false,erro:'Endereço físico "'+informado+'" não encontrado no catálogo de endereços logísticos desta loja (GET /api/wms/ajuste-estoque-logistico).'+(sugeridoFisico?' Sugestão da BlueSoft para este palete: '+sugeridoFisico+' ('+sugeridoKey+').':' BlueSoft não indicou nenhuma sugestão para este palete.')+' Confirme o código físico ou informe a chave numérica (enderecoLogisticoKey) diretamente.'};
        }
        return;
      }
      resultados[i]={ok:false,erro:'enderecoLogisticoKey inválido.'};
    });
  }
  return {resultados:resultados.map((r,i)=>({...r,indice:Array.isArray(data&&data.indices)?data.indices[i]:i})),confirmacaoCompleta:resultados.every(r=>r.ok),observacao:'Pré-validação consultiva. A BlueSoft pode recusar operações durante a execução por saldo, estado ou regras internas.'};
});
exports.listarPaletesAEnderecar = functions.region(AP_REGION).runWith({timeoutSeconds:120,memory:'256MB'}).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context); _eopRequire(acesso,'estoque-enderecamento','visualizar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId), cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  const consulta=await _eopConsultarPaletesPagina(cfg,loja.bluesoftLojaKey,50);
  return {itens:Array.from(consulta.paletes.values()),completa:consulta.completa,aviso:consulta.completa?'':'Consulta interrompida no limite de 5000 paletes; lista não pode ser considerada completa.'};
});
exports.enderecarPaletesArquivo = functions.region(AP_REGION).runWith({timeoutSeconds:540,memory:'256MB'}).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context); _eopRequire(acesso,'estoque-enderecamento','executar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId), cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db), linhas=_eopLinhas(data), resultados=[];
    _eopValidarLote(linhas,'end');
  // Confirma só a EXISTÊNCIA do palete na consulta WMS paginada — o destino
  // não precisa bater com a sugestão do WMS (ela é só uma recomendação pra
  // aquele palete, não a lista de endereços válidos da loja). Elegibilidade e
  // capacidade do destino ficam inteiramente a critério da BlueSoft no POST
  // (ela recusa com 409/422 quando não aceitar).
  const consultaPaletes = await _eopConsultarPaletesPagina(cfg,loja.bluesoftLojaKey,50);
  for (const [i,l] of linhas.entries()) {
    const palete=consultaPaletes.paletes.get(String(Number(l.paleteKey)));
    if(!palete)throw new functions.https.HttpsError('failed-precondition','Linha '+(data.indices[i]+1)+': palete não encontrado em consulta WMS paginada; nenhum POST iniciado. Consulta completa: '+consultaPaletes.completa);
  }
  for (const [indice,l] of linhas.entries()) {
    const resultado=await _eopExecutarUmaVez(data,loja,'end',data.indices[indice],l,async()=>{
      const paleteKey=Number(l.paleteKey||l.capa||l.palete), novoEndereco=Number(l.enderecoLogisticoKey||l.novoEndereco||l.enderecoDestinoKey);
      if (!(paleteKey>0) || !(novoEndereco>0)) throw new Error('Informe paleteKey/capa e enderecoLogisticoKey.');
      const payload={lojaKey:loja.bluesoftLojaKey,paleteKey:paleteKey,novoEndereco:novoEndereco};
      if (l.paleteKeyParaAglutinar) payload.paleteKeyParaAglutinar=Number(l.paleteKeyParaAglutinar);
      // ACHADO AO VIVO (2026-10-09): um lote real de 42 paletes voltou HTTP 200 pra
      // todos, mas uma consulta de conferência (GET, só leitura) mostrou que NENHUM
      // palete realmente mudou de endereço na BlueSoft — continuavam na própria
      // lista de pendentes, no enderecoLogisticoKey de origem. A planilha nunca traz
      // logisticaLoteItemKey/quantidadeEnderecar/gtin (não existe coluna pra isso),
      // então `itens` nunca era enviado — e sem ele, a BlueSoft parece aceitar o
      // POST sem de fato mover o palete (ela não sabe qual item do palete mover).
      // A própria consulta de paletes pendentes (a mesma usada pra confirmar que o
      // palete existe, logo acima) já devolve esses 3 campos por palete — usa-los
      // automaticamente em vez de depender da planilha informar, mesma fonte já
      // confiável usada no resto desta correção.
      const paleteConsultado=consultaPaletes.paletes.get(String(paleteKey));
      if (l.logisticaLoteItemKey && l.quantidadeEnderecar && l.gtin) {
        payload.itens=[{logisticaLoteItemKey:Number(l.logisticaLoteItemKey),quantidadeEnderecar:Number(l.quantidadeEnderecar),gtin:Number(l.gtin)}];
      } else if (paleteConsultado && _eopCheckNumero(paleteConsultado.logisticaLoteItemKey) && _eopCheckNumero(paleteConsultado.produtoGtin) && Number(paleteConsultado.quantidadeDisponivelEmUnidades)>0) {
        payload.itens=[{logisticaLoteItemKey:Number(paleteConsultado.logisticaLoteItemKey),quantidadeEnderecar:Number(paleteConsultado.quantidadeDisponivelEmUnidades),gtin:Number(paleteConsultado.produtoGtin)}];
      }
      const r=await _eopPost('/api/wms/enderecamento-de-paletes',cfg,payload);
      // CORREÇÃO (2026-10-09): antes, qualquer resposta HTTP 2xx virava "Endereçado"
      // mesmo sem nenhuma confirmação real — foi assim que os 42 paletes acima
      // ficaram marcados "concluído" sem terem sido movidos de verdade. Agora só é
      // sucesso se a resposta trouxer este palete de volta (array com paleteKey
      // batendo); qualquer outro formato vira resultado incerto (conferência
      // necessária), nunca sucesso presumido.
      const linhaConfirmada=Array.isArray(r)?r.find(x=>x&&Number(x.paleteKey)===paleteKey):null;
      // Grava o corpo cru da resposta (truncado) no erro persistido — sem isso,
      // um caso "sem confirmação" ficava sem nenhuma pista do que a BlueSoft
      // realmente devolveu, exigindo investigar de novo às cegas toda vez.
      if(!linhaConfirmada) throw new Error('BlueSoft respondeu, mas a resposta não confirma o endereçamento deste palete (formato inesperado ou palete ausente dela). Resposta recebida: '+JSON.stringify(r).slice(0,500)+'. Resultado tratado como incerto — confira na BlueSoft antes de tentar de novo.');
      return {paleteKey,detalhe:String(linhaConfirmada.enderecoDescritivo||'Endereçado em '+novoEndereco),enderecoLogisticoKeyConfirmado:linhaConfirmada.enderecoLogisticoKey??null};
    });
    resultados.push(resultado);
  }
  return {resultados,sucessos:resultados.filter(x=>x.ok).length,erros:resultados.filter(x=>!x.ok).length};
});
exports.listarMotivosTroca = functions.region(AP_REGION).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context); _eopRequire(acesso,'estoque-lote-trocas','visualizar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId), cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  const resp=await _bluesoftGetSomenteLeitura('/api/estoque/motivos-de-troca',cfg);
  return {itens:Array.isArray(resp)?resp:(resp&&Array.isArray(resp.data)?resp.data:[])};
});
// Envia todos os produtos do arquivo no mesmo pedido de lote de trocas.
// A reserva de TODAS as linhas ocorre em uma transação única: nenhuma linha
// pode ser reenviada separadamente se o POST tiver resultado desconhecido.
async function _eopExecutarTrocaAgrupadaUmaVez(data, loja, linhas, cfg) {
  const operacaoId=String(data&&data.operacaoId||'');
  if(!/^[a-zA-Z0-9_-]{12,90}$/.test(operacaoId))throw new functions.https.HttpsError('invalid-argument','Identificador da operação obrigatório.');
  const crypto=require('crypto');
  const indices=data.indices;
  const refs=indices.map(i=>db.collection('dt_estoque_operacoes_execucoes').doc(crypto.createHash('sha256').update(String(loja.id)+':troca:'+operacaoId+':'+i).digest('hex')));
  const hashes=linhas.map(l=>crypto.createHash('sha256').update(JSON.stringify({loja:String(loja.id),modo:'troca',linha:l})).digest('hex'));
  // Firestore limita transações a 500 documentos; cada lote tem no máximo 200 linhas,
  // para reservar e concluir sem extrapolar os limites de gravação em lote.
  if(linhas.length>200)throw new functions.https.HttpsError('invalid-argument','Para gerar um lote de trocas, importe no máximo 200 produtos por operação.');
  const reserva=await db.runTransaction(async tx=>{
    const snaps=[];
    for(const ref of refs)snaps.push(await tx.get(ref));
    if(snaps.some((snap,i)=>snap.exists&&(snap.data().hash!==hashes[i]||snap.data().status!=='concluido')))return {bloqueado:true};
    const existentes=snaps.filter(s=>s.exists).length;
    if(existentes===snaps.length)return {concluido:true,retornos:snaps.map(s=>s.data().retorno||{})};
    if(existentes>0)return {bloqueado:true};
    refs.forEach((ref,i)=>tx.create(ref,{lojaId:String(loja.id),modo:'troca',operacaoId,indice:indices[i],hash:hashes[i],status:'processando',criadoEm:admin.firestore.FieldValue.serverTimestamp()}));
    return {novo:true};
  });
  if(reserva.bloqueado)return {resultados:indices.map(i=>({ok:false,requerConferencia:true,indice:i,erro:'Há movimentação anterior iniciada ou parcial. Confira a BlueSoft antes de repetir o lote.'})),sucessos:0,erros:indices.length};
  if(reserva.concluido)return {resultados:reserva.retornos.map((r,i)=>({ok:true,jaProcessado:true,indice:indices[i],...r})),sucessos:indices.length,erros:0};
  try{
    const produtos=linhas.map(l=>({gtin:Number(l.gtin),quantidade:Number(l.quantidade),motivoTrocaKey:Number(l.motivoTrocaKey),setorOperacionalKey:Number(l.setorOperacionalKey)}));
    const resposta=await _eopPost('/api/estoque/troca/lote-troca',cfg,{lojaKey:loja.bluesoftLojaKey,produtos});
    const retorno={detalhe:'Lote gerado com '+produtos.length+' produto(s).',loteTrocaKeys:(resposta&&resposta.loteTrocaKeys)||[],nfNumero:resposta&&resposta.nfNumero};
    const lote=db.batch();refs.forEach(ref=>lote.update(ref,{status:'concluido',retorno,finalizadoEm:admin.firestore.FieldValue.serverTimestamp()}));await lote.commit();
    return {resultados:indices.map(i=>({ok:true,indice:i,...retorno})),sucessos:indices.length,erros:0};
  }catch(e){
    const lote=db.batch();refs.forEach(ref=>lote.update(ref,{status:'conferencia_necessaria',erro:String(e.message||e).slice(0,700),finalizadoEm:admin.firestore.FieldValue.serverTimestamp()}));await lote.commit().catch(()=>{});
    return {resultados:indices.map(i=>({ok:false,indice:i,requerConferencia:true,erro:'Resultado do lote não confirmado. Confira a BlueSoft: '+String(e.message||e).slice(0,400)})),sucessos:0,erros:indices.length};
  }
}
exports.gerarLoteTrocasArquivo = functions.region(AP_REGION).runWith({timeoutSeconds:540,memory:'256MB'}).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context); _eopRequire(acesso,'estoque-lote-trocas','executar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId), cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db), linhas=_eopLinhas(data);
  await _eopResolverSetores(linhas,'troca',loja,cfg);
  _eopValidarLote(linhas,'troca');
  await _eopConferirCadastroAntesPost(linhas,'troca',cfg);
  if(data&&data.finalidade==='descarte'){
    const respostaMotivos=await _bluesoftGetSomenteLeitura('/api/estoque/motivos-de-troca',cfg);
    const motivos=Array.isArray(respostaMotivos)?respostaMotivos:respostaMotivos&&respostaMotivos.data;
    if(!Array.isArray(motivos))throw new functions.https.HttpsError('failed-precondition','Não foi possível confirmar motivos de descarte na BlueSoft.');
    const autorizados=new Set(motivos.filter(m=>/descarte|perda|quebra/i.test(String(m.nome||''))).map(m=>String(m.motivoTrocaKey)));
    if(!autorizados.size)throw new functions.https.HttpsError('failed-precondition','Não há motivos identificados como descarte/perda/quebra. Confira o cadastro na BlueSoft.');
    if(linhas.some(l=>!autorizados.has(String(l.motivoTrocaKey))))throw new functions.https.HttpsError('failed-precondition','Um ou mais produtos têm motivo diferente de descarte/perda/quebra; nenhum POST iniciado.');
  } else if(data&&data.finalidade&&data.finalidade!=='troca')throw new functions.https.HttpsError('invalid-argument','Finalidade inválida.');
  return _eopExecutarTrocaAgrupadaUmaVez(data,loja,linhas,cfg);
});
exports.transformarProdutosArquivo = functions.region(AP_REGION).runWith({timeoutSeconds:540,memory:'256MB'}).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Faça login novamente.');
  const acesso=await acessoSolicitante(context); _eopRequire(acesso,'estoque-transformacao-api','executar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId), cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db), linhas=_eopLinhas(data), resultados=[];
  await _eopResolverSetores(linhas,'transf',loja,cfg);
  _eopValidarLote(linhas,'transf');
  await _eopConferirCadastroAntesPost(linhas,'transf',cfg);
  for (const [indice,l] of linhas.entries()) {
    const resultado=await _eopExecutarUmaVez(data,loja,'transf',data.indices[indice],l,async()=>{
      let transformacaoKey=Number(l.transformacaoKey||0);
      if (!(transformacaoKey>0) && Number(l.produtoKey)>0) {
        const resp=await _bluesoftGetSomenteLeitura('/api/comercial/produtos/transformacao?produtoKey='+encodeURIComponent(Number(l.produtoKey)),cfg);
        const lista=Array.isArray(resp)?resp:(resp&&Array.isArray(resp.data)?resp.data:[]);
        if (lista.length!==1) throw new Error(lista.length?'Produto possui mais de uma transformação; informe transformacaoKey.':'Nenhuma transformação cadastrada para produtoKey '+l.produtoKey+'.');
        transformacaoKey=Number(lista[0].transformacaoKey);
      }
      const localDeEstoqueKey=Number(l.localDeEstoqueKey), quantidadeTransformacao=Number(l.quantidadeTransformacao||l.quantidade), origem=String(l.origemDaTransformacao||'').trim().toUpperCase();
      if (!(transformacaoKey>0)||!(localDeEstoqueKey>0)||!(quantidadeTransformacao>0)||!['ESTOQUE_VENDA','ESTOQUE_TROCA'].includes(origem)) throw new Error('Obrigatórios: transformacaoKey (ou produtoKey único), localDeEstoqueKey, quantidadeTransformacao e origemDaTransformacao.');
      const payload={lojaKey:loja.bluesoftLojaKey,localDeEstoqueKey,formaGeracaoDaTransformacao:'COMUM',quantidadeTransformacao,origemDaTransformacao:origem};
      if (Number(l.setorOperacionalKey)>0) payload.setorOperacionalKey=Number(l.setorOperacionalKey);
      await _eopPost('/api/comercial/produtos/transformacao/'+transformacaoKey+'/transformar',cfg,payload);
      return {detalhe:'Transformação '+transformacaoKey+' concluída'};
    });
    resultados.push(resultado);
  }
  return {resultados,sucessos:resultados.filter(x=>x.ok).length,erros:resultados.filter(x=>!x.ok).length};
});

// Consulta auditável de lançamentos de troca/descarte; esta função não baixa nem estorna estoque.
exports.consultarTrocasDescarte = functions.region(AP_REGION).https.onCall(async (data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login.');
  const acesso=await acessoSolicitante(context);_eopRequire(acesso,'estoque-lote-trocas','visualizar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId);
  const cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  const pagina=Number(data&&data.currentPage||0);
  if(!Number.isSafeInteger(pagina)||pagina<0||pagina>10000)throw new functions.https.HttpsError('invalid-argument','Página inválida.');
  return await _bluesoftGetSomenteLeitura('/api/estoque/trocas?currentPage='+pagina+'&pageSize=100&lojaKey='+encodeURIComponent(loja.bluesoftLojaKey),cfg);
});

// Exclusivamente GET: consulta de documentos fiscais e devoluções já criadas na BlueSoft.
// A emissão, recusa, estorno fiscal ou baixa nunca acontece nesta função.
exports.consultarDevolucoesEstoque = functions.region(AP_REGION).runWith({timeoutSeconds:120,memory:'256MB'}).https.onCall(async (data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login.');
  const acesso=await acessoSolicitante(context);
  _eopRequire(acesso,'estoque-lote-trocas','visualizar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId);
  const cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  const tipo=String(data&&data.tipo||'');
  const pagina=Number(data&&data.currentPage||0);
  if(!Number.isSafeInteger(pagina)||pagina<0||pagina>10000)throw new functions.https.HttpsError('invalid-argument','Página inválida.');
  if(tipo==='monitoramento'){
    const requestId=String(data&&data.requestId||'');
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId))throw new functions.https.HttpsError('invalid-argument','requestId inválido.');
    return {tipo,resultado:await _bluesoftGetSomenteLeitura('/monitoramento/async/'+encodeURIComponent(requestId),cfg)};
  }
  const paths={compras:'/api/estoques/notas-fiscais',entre_lojas:'/api/estoque/operacoes-entre-lojas/devolucao-troca'};
  if(!Object.prototype.hasOwnProperty.call(paths,tipo))throw new functions.https.HttpsError('invalid-argument','Tipo de devolução inválido.');
  const path=paths[tipo]+'?currentPage='+pagina+'&pageSize=100&lojaKey='+encodeURIComponent(loja.bluesoftLojaKey);
  const resultado=await _bluesoftGetSomenteLeitura(path,cfg);
  if(!resultado||(!Array.isArray(resultado)&&!Array.isArray(resultado.data)))throw new functions.https.HttpsError('failed-precondition','Consulta não retornou dados no formato esperado; não inferir ausência de devoluções.');
  return {tipo,resultado,observacao:tipo==='compras'?'Consulta geral de notas fiscais; identificar devoluções conforme os campos fiscais disponíveis na conta.':'Consulta das notas elegíveis para devolução entre lojas.'};
});

// Estorno de um movimento previamente lançado: requer confirmação explícita no cliente,
// e trava persistente. A BlueSoft pode impedir estorno de movimento com nota fiscal.
exports.estornarTrocaDescarte = functions.region(AP_REGION).runWith({timeoutSeconds:120,memory:'256MB'}).https.onCall(async(data,context)=>{
  if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Faça login.');
  const acesso=await acessoSolicitante(context);_eopRequire(acesso,'estoque-lote-trocas','executar');
  const loja=await _apRequireLoja(acesso,data&&data.lojaId);
  const movimento=Number(data&&data.movimentoEstoqueKey);
  if(!Number.isSafeInteger(movimento)||movimento<=0||data.confirmacao!=='CONFIRMO ESTORNO')throw new functions.https.HttpsError('invalid-argument','Movimento válido e confirmação explícita são obrigatórios.');
  const cfg=await _lerConfigIntegracaoApiEstoque(loja.id,db);
  const crypto=require('crypto');
  const id=crypto.createHash('sha256').update(String(loja.id)+':estorno:'+movimento).digest('hex');
  const ref=db.collection('dt_estoque_operacoes_execucoes').doc(id);
  const anterior=await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists)return snap.data();tx.create(ref,{lojaId:String(loja.id),modo:'estorno',movimentoEstoqueKey:movimento,status:'processando',criadoEm:admin.firestore.FieldValue.serverTimestamp()});return null;});
  if(anterior)return {ok:anterior.status==='concluido',jaProcessado:true,status:anterior.status,detalhe:'Estorno anterior já iniciado. Não repetido.'};
  try{
    const baseUrl=_baseUrlBluesoftEstoque(cfg);
    if(!baseUrl||!cfg.token)throw Object.assign(new Error('Configuração BlueSoft incompleta.'),{apTipo:'rejeitado'});
    let resposta;
    try{resposta=await fetch(baseUrl.replace(/\/+$/,'')+'/api/estoque/troca/lote-troca/'+movimento,{method:'DELETE',headers:{'x-CustomToken':String(cfg.token)}});}
    catch(e){throw Object.assign(new Error('Falha de rede; resultado do estorno incerto.'),{apTipo:'incerto'});}
    if(!resposta.ok)throw Object.assign(new Error('BlueSoft recusou o estorno (HTTP '+resposta.status+').'),{apTipo:resposta.status===409||resposta.status===422?'rejeitado':'incerto'});
    await ref.update({status:'concluido',finalizadoEm:admin.firestore.FieldValue.serverTimestamp()});
    return {ok:true,status:'concluido',movimentoEstoqueKey:movimento};
  }catch(e){const status=e.apTipo==='rejeitado'?'rejeitado':'conferencia_necessaria';await ref.update({status,erro:String(e.message||e).slice(0,500),finalizadoEm:admin.firestore.FieldValue.serverTimestamp()}).catch(()=>{});return {ok:false,status,requerConferencia:status!=='rejeitado',erro:String(e.message||e)};}
});
