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

function refsAuditoria(lojaId, auditoriaId) {
  const auditoria = db.collection('lojas').doc(lojaId)
    .collection('dt_auditorias').doc(auditoriaId);
  return {auditoria, esperados: auditoria.collection('enderecos'),
    cegos: auditoria.collection('itens_coletor'), resultados: auditoria.collection('resultados')};
}

exports.registrarResultadoAuditoria = functions.region('southamerica-east1')
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const lojaId = textoSeguro(data?.lojaId, 120);
    const auditoriaId = textoSeguro(data?.auditoriaId, 180);
    const itemId = textoSeguro(data?.itemId, 220);
    const dunLido = textoSeguro(data?.dunLido, 120);
    const produtoLido = textoSeguro(data?.produtoLido, 500);
    const vazio = data?.vazio === true;
    if (!lojaId || !auditoriaId || !itemId) {
      throw new functions.https.HttpsError('invalid-argument', 'Auditoria ou item inválido.');
    }
    const acesso = await acessoSolicitante(context);
    if (!lojaAutorizada(acesso, lojaId) || !podeUsarColetor(acesso)) {
      throw new functions.https.HttpsError('permission-denied', 'Coletor sem acesso a esta auditoria.');
    }
    const refs = refsAuditoria(lojaId, auditoriaId);
    const esperadoRef = refs.esperados.doc(itemId);
    const cegoRef = refs.cegos.doc(itemId);
    const resultadoRef = refs.resultados.doc(itemId);
    return db.runTransaction(async tx => {
      const [metaSnap, esperadoSnap, cegoSnap, resultadoSnap] = await Promise.all([
        tx.get(refs.auditoria), tx.get(esperadoRef), tx.get(cegoRef), tx.get(resultadoRef)
      ]);
      if (!metaSnap.exists || !['LIBERADA', 'EM_ANDAMENTO'].includes(String(metaSnap.data().status || '').toUpperCase())) {
        throw new functions.https.HttpsError('failed-precondition', 'Auditoria não está liberada ou em andamento.');
      }
      if (!esperadoSnap.exists || !cegoSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Item da auditoria não encontrado.');
      }
      if (resultadoSnap.exists && AUDITORIA_STATUS_FINAIS.has(resultadoSnap.data().status)) {
        return {ok: true, status: resultadoSnap.data().status, repetido: true};
      }
      const esperado = esperadoSnap.data();
      const normalizar = valor => String(valor || '').replace(/\D/g, '').replace(/^0+/, '');
      const status = vazio ? 'ENDERECO_VAZIO' :
        (normalizar(dunLido) && normalizar(dunLido) === normalizar(esperado.dunEsperado) ? 'OK' : 'DIVERGENTE');
      const agora = admin.firestore.FieldValue.serverTimestamp();
      const resultado = {
        auditoriaId, itemId, endereco: cegoSnap.data().endereco,
        dunLido: vazio ? null : dunLido, produtoLido: vazio ? null : produtoLido,
        status, operador_uid: context.auth.uid,
        operador_id: context.auth.token.email || context.auth.uid,
        operador_nome: acesso?.nome || context.auth.token.name || context.auth.token.email || 'Coletor',
        dispositivo_id: textoSeguro(data?.dispositivoId, 180), loja: lojaId,
        lidoEm: agora, atualizadoEm: agora
      };
      tx.set(resultadoRef, resultado);
      tx.update(cegoRef, {disponivel_coletor: false, status: 'CONCLUIDO', atualizadoEm: agora});
      tx.update(esperadoRef, resultado);
      const campoTotal = status === 'OK' ? 'totalOk' :
        (status === 'DIVERGENTE' ? 'totalDivergentes' : 'totalVazios');
      tx.update(refs.auditoria, {
        status: 'EM_ANDAMENTO', totalPendentes: admin.firestore.FieldValue.increment(-1),
        [campoTotal]: admin.firestore.FieldValue.increment(1), atualizadoEm: agora
      });
      return {ok: true, status};
    });
  });

exports.registrarOcorrenciaAuditoria = functions.region('southamerica-east1')
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Faça login novamente.');
    const lojaId = textoSeguro(data?.lojaId, 120);
    const auditoriaId = textoSeguro(data?.auditoriaId, 180);
    const ocorrenciaId = textoSeguro(data?.ocorrenciaId, 220);
    const acesso = await acessoSolicitante(context);
    if (!lojaAutorizada(acesso, lojaId) || !podeUsarColetor(acesso)) {
      throw new functions.https.HttpsError('permission-denied', 'Coletor sem acesso a esta auditoria.');
    }
    const refs = refsAuditoria(lojaId, auditoriaId);
    const meta = await refs.auditoria.get();
    if (!meta.exists || !['LIBERADA', 'EM_ANDAMENTO'].includes(String(meta.data().status || '').toUpperCase())) {
      throw new functions.https.HttpsError('failed-precondition', 'Auditoria não está liberada ou em andamento.');
    }
    await refs.auditoria.collection('ocorrencias').doc(ocorrenciaId).set({
      auditoriaId, tipo: 'PRODUTO_FORA_AUDITORIA', status: 'PRODUTO_FORA_AUDITORIA',
      endereco: textoSeguro(data?.endereco, 220), dunLido: textoSeguro(data?.dunLido, 120),
      produtoLido: textoSeguro(data?.produtoLido, 500), loja: lojaId,
      operador_uid: context.auth.uid, operador_id: context.auth.token.email || context.auth.uid,
      operador_nome: acesso?.nome || context.auth.token.name || context.auth.token.email || 'Coletor',
      dispositivo_id: textoSeguro(data?.dispositivoId, 180),
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    }, {merge: false});
    return {ok: true};
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
