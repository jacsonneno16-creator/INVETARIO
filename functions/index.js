'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

function podeExcluir(acesso) {
  if (!acesso) return false;
  return acesso.admin_mestre === true ||
    acesso.administrador_mestre === true ||
    acesso.perfil === 'administrador' ||
    (acesso.perfil === 'analista' && !acesso.permissoes) ||
    acesso.permissoes?.operadores?.excluir === true;
}

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
    if (alvo?.admin_mestre === true || alvo?.administrador_mestre === true) {
      throw new functions.https.HttpsError('failed-precondition', 'O administrador mestre é protegido.');
    }

    try {
      await admin.auth().deleteUser(uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }

    const lojasSnap = await db.collection('lojas').get();
    const refs = [
      db.collection('usuarios_acessos').doc(uid),
      ...lojasSnap.docs.map(loja => loja.ref.collection('dt_operadores').doc(uid))
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
    }).catch(error => console.warn('Falha ao registrar log da exclusão:', error.message));

    return {ok: true, uid};
  });
