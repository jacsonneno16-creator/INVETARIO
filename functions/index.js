'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

const PERFIS_ADMIN = new Set(['administrador']);
const MAX_NOME = 120;
const MAX_EMAIL = 254;
const MAX_UIDS = 20;

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
    if (!nome || nome.length > MAX_NOME || !emailColetor || (criarAnalista && !emailAnalista)) {
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
