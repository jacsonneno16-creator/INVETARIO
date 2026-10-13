'use strict';
// Verificação REAL (não regex) das regras novas de Devoluções unificadas
// (devolucoes_notas/devolucoes_recebimentos/devolucoes_relatorios) contra o
// motor de regras de verdade do Firestore. Rodar com `npm run test:rules`
// adaptado ou diretamente:
//   firebase emulators:exec --only firestore "node rules-tests/devolucoes-unificadas.js"
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const admin = require('../functions/node_modules/firebase-admin');

async function negado(p) {
  let e; try { await p; } catch (x) { e = x; }
  assert.ok(e, 'Acesso direto indevido foi permitido');
  assert.equal(e.code, 'permission-denied');
  assert.doesNotMatch(String(e.message || ''), /maximum of 1000|Unable to evaluate the expression/i);
}
async function permitido(p) { await p; }

(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!/^127\.0\.0\.1:\d+$/.test(host || '')) throw new Error('Exige emulador local.');
  const projectId = 'demo-dt-devolucoes';
  const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: Number(host.split(':')[1]), rules: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8') } });
  const app = admin.initializeApp({ projectId }, 'test-devolucoes'), db = app.firestore();
  let count = 0;
  try {
    await db.doc('lojas/matriz').set({ ativo: true });
    await db.doc('lojas/filial').set({ ativo: true });
    await db.doc('usuarios_acessos/root').set({ perfil: 'administrador', ativo: true, acesso_todas_lojas: true, canais_acesso: { analista: true, coletor: true } });
    // Importador: só 'importar'.
    await db.doc('usuarios_acessos/importador').set({ perfil: 'analista', ativo: true, lojas_permitidas: ['matriz'], canais_acesso: { analista: true }, permissoes: { 'recebimento-devolucoes': { visualizar: true, importar: true } } });
    // Confirmador: só 'confirmar' (não importa, não finaliza relatório).
    await db.doc('usuarios_acessos/confirmador').set({ perfil: 'analista', ativo: true, lojas_permitidas: ['matriz'], canais_acesso: { analista: true }, permissoes: { 'recebimento-devolucoes': { visualizar: true, confirmar: true } } });
    // Só visualizar — controle negativo.
    await db.doc('usuarios_acessos/sovisualiza').set({ perfil: 'analista', ativo: true, lojas_permitidas: ['matriz'], canais_acesso: { analista: true }, permissoes: { 'recebimento-devolucoes': { visualizar: true } } });
    // Coletor com permissão operacional de recebimento (hasPermissionColetorRecebimento).
    await db.doc('usuarios_acessos/coletor').set({ perfil: 'operador', ativo: true, lojas_permitidas: ['matriz'], canais_acesso: { coletor: true }, permissoes: { 'recebimento-operacao': { criar: true } } });
    // Mesma loja de outro usuário, sem NENHUMA permissão de devoluções — cross-loja/sem-permissão.
    await db.doc('usuarios_acessos/filialSemPermissao').set({ perfil: 'analista', ativo: true, lojas_permitidas: ['filial'], canais_acesso: { analista: true }, permissoes: {} });
    // Relatório: criador e finalizador separados.
    await db.doc('usuarios_acessos/relCriador').set({ perfil: 'analista', ativo: true, lojas_permitidas: ['matriz'], canais_acesso: { analista: true }, permissoes: { 'recebimento-devolucoes': { visualizar: true, relatorio_criar: true } } });
    await db.doc('usuarios_acessos/relFinalizador').set({ perfil: 'analista', ativo: true, lojas_permitidas: ['matriz'], canais_acesso: { analista: true }, permissoes: { 'recebimento-devolucoes': { visualizar: true, relatorio_finalizar: true } } });

    const root = env.authenticatedContext('root').firestore();
    const importador = env.authenticatedContext('importador').firestore();
    const confirmador = env.authenticatedContext('confirmador').firestore();
    const sovisualiza = env.authenticatedContext('sovisualiza').firestore();
    const coletor = env.authenticatedContext('coletor').firestore();
    const filialSemPermissao = env.authenticatedContext('filialSemPermissao').firestore();
    const relCriador = env.authenticatedContext('relCriador').firestore();
    const relFinalizador = env.authenticatedContext('relFinalizador').firestore();

    const CHAVE = '33333333333333333333333333333333333333333331';

    // --- devolucoes_notas ---
    // Só visualizar não pode importar.
    await negado(sovisualiza.doc('lojas/matriz/devolucoes_notas/' + CHAVE).set({ chave: CHAVE, lojaId: 'matriz', estado: 'PENDENTE' })); count++;
    // Importador pode criar a nota pendente.
    await permitido(importador.doc('lojas/matriz/devolucoes_notas/' + CHAVE).set({ chave: CHAVE, lojaId: 'matriz', estado: 'PENDENTE', dataEmissao: '2026-10-01', valorTotal: 40 })); count++;
    // Confirmador NÃO pode reescrever dados fiscais livremente (isso é 'importar', não 'confirmar').
    await negado(confirmador.doc('lojas/matriz/devolucoes_notas/' + CHAVE).set({ chave: CHAVE, lojaId: 'matriz', estado: 'PENDENTE', valorTotal: 999 }, { merge: true })); count++;
    // Confirmador PODE fazer a transição restrita PENDENTE -> RECEBIDA.
    await permitido(confirmador.doc('lojas/matriz/devolucoes_notas/' + CHAVE).set({ estado: 'RECEBIDA', atualizadoEm: 'x', recebidoEm: 'x', recebidoPor: 'confirmador', origemRecebimento: 'ANALISTA' }, { merge: true })); count++;
    // Ninguém reabre uma nota já RECEBIDA por essa mesma via restrita (regra exige resource.data.estado == 'PENDENTE').
    await negado(confirmador.doc('lojas/matriz/devolucoes_notas/' + CHAVE).set({ estado: 'RECEBIDA', atualizadoEm: 'y', recebidoEm: 'y', recebidoPor: 'confirmador', origemRecebimento: 'ANALISTA' }, { merge: true })); count++;
    // Cross-loja: usuário só com acesso à filial não enxerga/edita nota da matriz.
    await negado(filialSemPermissao.doc('lojas/matriz/devolucoes_notas/' + CHAVE).get()); count++;

    // Segunda nota pendente, pra testar a confirmação do Coletor (hasPermissionColetorRecebimento).
    const CHAVE2 = '33333333333333333333333333333333333333333332';
    await db.doc('lojas/matriz/devolucoes_notas/' + CHAVE2).set({ chave: CHAVE2, lojaId: 'matriz', estado: 'PENDENTE' });
    await permitido(coletor.doc('lojas/matriz/devolucoes_notas/' + CHAVE2).set({ estado: 'RECEBIDA', atualizadoEm: 'x', recebidoEm: 'x', recebidoPor: 'coletor', origemRecebimento: 'COLETOR' }, { merge: true })); count++;

    // --- devolucoes_recebimentos ---
    await permitido(confirmador.doc('lojas/matriz/devolucoes_recebimentos/' + CHAVE).set({ chave: CHAVE, lojaId: 'matriz', confirmadoEm: 'x', confirmadoPor: 'confirmador', origem: 'ANALISTA', relatorioId: null })); count++;
    // Segunda tentativa de CRIAR o mesmo doc é negada pela regra (!exists) — camada extra de autorização, a garantia real é a transação.
    await negado(coletor.doc('lojas/matriz/devolucoes_recebimentos/' + CHAVE).set({ chave: CHAVE, lojaId: 'matriz', confirmadoEm: 'y', confirmadoPor: 'coletor', origem: 'COLETOR' })); count++;
    // Quem só visualiza não pode estornar.
    await negado(sovisualiza.doc('lojas/matriz/devolucoes_recebimentos/' + CHAVE).set({ estornadoEm: 'x', estornadoPor: 'sovisualiza', motivoEstorno: 'teste' }, { merge: true })); count++;

    // --- devolucoes_relatorios ---
    await negado(relFinalizador.doc('lojas/matriz/devolucoes_relatorios/r1').set({ status: 'RASCUNHO', lojaId: 'matriz', criadoPor: 'relFinalizador' })); count++;
    await permitido(relCriador.doc('lojas/matriz/devolucoes_relatorios/r1').set({ status: 'RASCUNHO', lojaId: 'matriz', criadoPor: 'relCriador' })); count++;
    // Quem só cria não pode finalizar (ação separada).
    await negado(relCriador.doc('lojas/matriz/devolucoes_relatorios/r1').set({ status: 'FINALIZADO', finalizadoEm: 'x', finalizadoPor: 'relCriador' }, { merge: true })); count++;
    await permitido(relFinalizador.doc('lojas/matriz/devolucoes_relatorios/r1').set({ status: 'FINALIZADO', finalizadoEm: 'x', finalizadoPor: 'relFinalizador' }, { merge: true })); count++;
    // Depois de finalizado, o criador não pode mais editar (regra exige resource.data.status == 'RASCUNHO').
    await negado(relCriador.doc('lojas/matriz/devolucoes_relatorios/r1').set({ observacao: 'tentando mexer' }, { merge: true })); count++;
    await permitido(relCriador.doc('lojas/matriz/devolucoes_relatorios/r1').collection('linhas').doc(CHAVE).set({ chave: CHAVE, relatorioStatus: 'RASCUNHO' })); count++;

    console.log(count + ' verificações reais de regras de Devoluções unificadas passaram (importar/confirmar/estornar/relatório, sem o estouro de 1000 sub-expressões).');
  } finally {
    await env.cleanup();
    await app.delete();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
