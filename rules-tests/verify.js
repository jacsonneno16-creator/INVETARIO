// Verificação REAL (não regex) de firestore.rules contra o motor de regras
// de verdade do Firestore, via @firebase/rules-unit-testing + emulador
// local (`npm run test:rules`, que já sobe/derruba o emulador sozinho via
// `firebase emulators:exec`). Ver rules-tests/README.md.
//
// Cobre os cenários de posse operacional de Transbordo (FASE 1 do plano
// "Correção Estrutural — Recebimento, Transbordo e Sistema de
// Permissões") que só podem ser provados de verdade contra o motor real —
// testes estáticos (regex no texto da regra) não pegam esse tipo de bug,
// como a sessão anterior confirmou duas vezes (limite de 1000
// sub-expressões, e antes disso, lacunas de autorização que "pareciam"
// certas na leitura do texto).
const { initializeTestEnvironment, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

function linha(titulo) { console.log('\n=== ' + titulo + ' ==='); }

// assertFails() sozinho só prova que a escrita foi negada — não prova QUE
// FOI NEGADA PELA REGRA DE PERMISSÃO. O motor do Firestore também nega (com
// o MESMO código PERMISSION_DENIED) quando estoura o limite de 1000
// sub-expressões durante a avaliação — achado real desta verificação: vários
// cenários negativos "passavam" mascarando esse estouro, não a regra
// funcionando (ver comentário no `resource == null &&` do `allow create`).
// Esta função falha o teste se a negação foi por estouro de limite, mesmo
// que tecnicamente a escrita tenha sido negada.
async function assertFailsPorPermissao(promise) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  if (!erro) throw new Error('Esperava que a operação fosse NEGADA, mas foi permitida.');
  const msg = String((erro && erro.message) || erro);
  if (/maximum of 1000|Unable to evaluate the expression/i.test(msg)) {
    throw new Error('Negado por ESTOURAR o limite de 1000 sub-expressões do motor de regras, não pela lógica de permissão real — isso mascarava um bug de custo: ' + msg);
  }
}

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'daterrinha-inventario-rules-tests',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8089,
    },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Contas: cada uma só-Coletor, restrita à PRÓPRIA loja, com a permissão
    // administrativa de recebimento-transbordo já concedida (cenário exato
    // do bug ao vivo: "já dei permissão pro usuário").
    const permissoesTransbordo = { 'recebimento-transbordo': { criar: true, editar: true, visualizar: true, 'corrigir-horario': true, cancelar: true, finalizar: true } };
    await db.doc('usuarios_acessos/uidMatriz').set({
      uid: 'uidMatriz', email: 'matriz@daterrinhaalimentos.com.br', ativo: true, perfil: 'operador',
      canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: false,
      lojas_permitidas: ['loja_matriz'], permissoes: permissoesTransbordo,
    });
    await db.doc('usuarios_acessos/uidFilial').set({
      uid: 'uidFilial', email: 'filial@daterrinhaalimentos.com.br', ativo: true, perfil: 'operador',
      canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: false,
      lojas_permitidas: ['loja_filial'], permissoes: permissoesTransbordo,
    });
    // Filial 2 — não tem NADA a ver com a rota Matriz→Filial deste teste;
    // usada pra provar isolamento cross-loja (cenário 9: Filial A não pode
    // operar transbordo destinado à Filial B).
    await db.doc('usuarios_acessos/uidFilial2').set({
      uid: 'uidFilial2', email: 'filial2@daterrinhaalimentos.com.br', ativo: true, perfil: 'operador',
      canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: false,
      lojas_permitidas: ['loja_filial2'], permissoes: permissoesTransbordo,
    });
    // Mesma loja da Filial, mas SEM a permissão marcada — controle negativo.
    await db.doc('usuarios_acessos/uidFilialSemPermissao').set({
      uid: 'uidFilialSemPermissao', email: 'semperm@daterrinhaalimentos.com.br', ativo: true, perfil: 'operador',
      canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: false,
      lojas_permitidas: ['loja_filial'], permissoes: {},
    });

    await db.doc('lojas/loja_matriz').set({ nome: 'Loja Matriz' });
    await db.doc('lojas/loja_filial').set({ nome: 'Filial Centro' });
    await db.doc('lojas/loja_filial2').set({ nome: 'Filial Norte' });

    // t1: transbordo Matriz -> Filial, ainda PREVISTO (não despachado).
    await db.doc('lojas/loja_matriz/recebimentos/t1').set({
      tipo: 'TRANSBORDO', status: 'PREVISTO', origemLojaId: 'loja_matriz', origem: 'Loja Matriz',
      destinoLojaId: 'loja_filial', destino: 'Filial Centro', motoristaNome: 'Carlos',
      horaSaida: null, horaChegada: null, horaInicioDescarga: null, horaFimDescarga: null,
      horaFechamentoRecebimento: null, notaFiscalTransferencia: null,
      notaFiscalConfirmadaEm: null, notaFiscalConfirmadaPor: null,
    });
    // t1b: cópia independente de t1 (também PREVISTO) — cenário 1a ESCREVE
    // em t1 (despacha, muda status), então cenário 1b precisa do PRÓPRIO
    // doc pra não testar contra um t1 já mutado pelo cenário anterior.
    await db.doc('lojas/loja_matriz/recebimentos/t1b').set({
      tipo: 'TRANSBORDO', status: 'PREVISTO', origemLojaId: 'loja_matriz', origem: 'Loja Matriz',
      destinoLojaId: 'loja_filial', destino: 'Filial Centro', motoristaNome: 'Carlos',
      horaSaida: null, horaChegada: null, horaInicioDescarga: null, horaFimDescarga: null,
      horaFechamentoRecebimento: null, notaFiscalTransferencia: null,
      notaFiscalConfirmadaEm: null, notaFiscalConfirmadaPor: null,
    });
    // t2: MESMA rota, já EM_TRANSITO (despachado) — usado pra provar que a
    // origem perde a operação e o destino ganha.
    await db.doc('lojas/loja_matriz/recebimentos/t2').set({
      tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origemLojaId: 'loja_matriz', origem: 'Loja Matriz',
      destinoLojaId: 'loja_filial', destino: 'Filial Centro', motoristaNome: 'Carlos',
      horaSaida: '2026-08-14T06:00:00.000Z', notaFiscalTransferencia: 'NF-1',
      horaChegada: null, horaInicioDescarga: null, horaFimDescarga: null,
      horaFechamentoRecebimento: null, notaFiscalConfirmadaEm: null, notaFiscalConfirmadaPor: null,
    });
    // fornecedorX: recebimento comum (não-TRANSBORDO) da Matriz — usado só
    // pra provar que a Filial NÃO ganha acesso geral aos dados da Matriz
    // por causa do escape cross-loja de TRANSBORDO (cenário 10).
    await db.doc('lojas/loja_matriz/recebimentos/fornecedorX').set({ tipo: 'FORNECEDOR', status: 'CHEGOU', fornecedorNome: 'Fornecedor Teste' });
    // t3: já CHEGOU na Filial — usado pra provar a cadeia CHEGOU->EM_DESCARGA->DESCARGA_FINALIZADA.
    await db.doc('lojas/loja_matriz/recebimentos/t3').set({
      tipo: 'TRANSBORDO', status: 'CHEGOU', origemLojaId: 'loja_matriz', origem: 'Loja Matriz',
      destinoLojaId: 'loja_filial', destino: 'Filial Centro', motoristaNome: 'Ana',
      horaSaida: '2026-08-14T06:00:00.000Z', notaFiscalTransferencia: 'NF-2',
      horaChegada: '2026-08-14T07:00:00.000Z', notaFiscalConfirmadaEm: '2026-08-14T07:00:05.000Z', notaFiscalConfirmadaPor: 'filial@daterrinhaalimentos.com.br',
      horaInicioDescarga: null, horaFimDescarga: null, horaFechamentoRecebimento: null,
    });
  });

  const dbMatriz = testEnv.authenticatedContext('uidMatriz').firestore();
  const dbFilial = testEnv.authenticatedContext('uidFilial').firestore();
  const dbFilial2 = testEnv.authenticatedContext('uidFilial2').firestore();
  const dbSemPerm = testEnv.authenticatedContext('uidFilialSemPermissao').firestore();

  let falhas = 0;
  async function cenario(titulo, fn) {
    linha(titulo);
    try { await fn(); console.log('PASSOU.'); }
    catch (e) { falhas++; console.log('FALHOU — ' + (e && e.message || e)); }
  }

  // ── Cenário 1: PREVISTO pertence só à origem ────────────────────────────
  // .update() (não .set(merge:true)) nos cenários que mexem num doc que já
  // existe — mesma correção estrutural aplicada no app real (22-recebimento.js/
  // 93-recebimento-operacao.js): um .set(merge:true) num doc existente é
  // ambíguo pro Firestore (não sabe se é create ou update de antemão), então
  // avalia as DUAS regras — achado ao vivo real: isso estourava o limite de
  // 1000 sub-expressões em contas de produção (permissoes com ~50 módulos) e
  // permitia uma escrita indevida passar. .update() é inequívoco.
  await cenario('1a) Matriz (origem) registra a saída de t1 (PREVISTO -> EM_TRANSITO)', async () => {
    await assertSucceeds(dbMatriz.doc('lojas/loja_matriz/recebimentos/t1').update({
      status: 'EM_TRANSITO', horaSaida: '2026-08-16T06:00:00.000Z', notaFiscalTransferencia: 'NF-X',
    }));
  });
  await cenario('1b) Filial (destino) NÃO pode mexer em t1b enquanto ainda é PREVISTO (ainda não é a vez dela)', async () => {
    await assertFailsPorPermissao(dbFilial.doc('lojas/loja_matriz/recebimentos/t1b').update({
      status: 'EM_TRANSITO', horaSaida: '2026-08-16T06:00:00.000Z',
    }));
  });

  // ── Cenário 2/3: EM_TRANSITO pertence só ao destino — origem PERDE acesso ─
  await cenario('2a) Matriz (origem) NÃO pode mais mexer em t2 depois de despachado (EM_TRANSITO) — nem repetir a saída, nem pular pra chegada', async () => {
    await assertFailsPorPermissao(dbMatriz.doc('lojas/loja_matriz/recebimentos/t2').update({
      status: 'CHEGOU', horaChegada: '2026-08-16T07:00:00.000Z',
    }));
  });
  await cenario('2b) Matriz (origem) ainda consegue LER t2 (monitoramento/histórico) mesmo sem poder mais operar', async () => {
    await assertSucceeds(dbMatriz.doc('lojas/loja_matriz/recebimentos/t2').get());
  });
  await cenario('3) Filial (destino) registra a chegada de t2 (EM_TRANSITO -> CHEGOU) — cross-loja, sem acesso administrativo geral à Matriz', async () => {
    await assertSucceeds(dbFilial.doc('lojas/loja_matriz/recebimentos/t2').update({
      status: 'CHEGOU', horaChegada: '2026-08-16T07:00:00.000Z',
      notaFiscalConfirmadaEm: '2026-08-16T07:00:05.000Z', notaFiscalConfirmadaPor: 'filial@daterrinhaalimentos.com.br',
    }));
  });

  // ── Cenário 4: cadeia CHEGOU -> EM_DESCARGA -> DESCARGA_FINALIZADA, só destino ─
  await cenario('4a) Filial (destino) inicia a descarga de t3 (CHEGOU -> EM_DESCARGA)', async () => {
    await assertSucceeds(dbFilial.doc('lojas/loja_matriz/recebimentos/t3').update({
      status: 'EM_DESCARGA', horaInicioDescarga: '2026-08-16T07:10:00.000Z',
    }));
  });
  await cenario('4b) Matriz (origem) NÃO pode iniciar/mexer na descarga de t3', async () => {
    await assertFailsPorPermissao(dbMatriz.doc('lojas/loja_matriz/recebimentos/t3').update({
      status: 'EM_DESCARGA', horaInicioDescarga: '2026-08-16T07:10:00.000Z',
    }));
  });

  // ── Cenário 6: conta só-Coletor com permissão correta funciona ponta a ponta ─
  await cenario('6) Coletor-only (canal coletor=true, analista=false) com permissão de transbordo consegue CRIAR uma carga nova (bip do motorista) sem permission-denied', async () => {
    await assertSucceeds(dbMatriz.doc('lojas/loja_matriz/recebimentos/tNovo').set({
      tipo: 'TRANSBORDO', status: 'PREVISTO', origemLojaId: 'loja_matriz', origem: 'Loja Matriz',
      destinoLojaId: 'loja_filial', destino: 'Filial Centro', motoristaNome: 'Novo Motorista',
      horaSaida: null, horaChegada: null, horaInicioDescarga: null, horaFimDescarga: null,
      horaFechamentoRecebimento: null, notaFiscalTransferencia: null,
      notaFiscalConfirmadaEm: null, notaFiscalConfirmadaPor: null,
    }));
  });
  await cenario('6-negativo) Mesma loja, SEM a permissão marcada — tem que continuar negado (prova que a regra não ficou aberta demais)', async () => {
    await assertFailsPorPermissao(dbSemPerm.doc('lojas/loja_matriz/recebimentos/t2').update({ status: 'CHEGOU', horaChegada: '2026-08-16T07:00:00.000Z' }));
  });

  // ── Cenário 9: Filial 2 não tem nada a ver com esta rota (Matriz->Filial) ─
  await cenario('9) Filial 2 (loja diferente do destino real) NÃO pode operar um transbordo destinado à Filial — isolamento cross-loja', async () => {
    await assertFailsPorPermissao(dbFilial2.doc('lojas/loja_matriz/recebimentos/t2').update({
      status: 'CHEGOU', horaChegada: '2026-08-16T07:00:00.000Z',
    }));
  });

  // ── Cenário 10: destino recebe sem ganhar acesso administrativo geral à origem ─
  await cenario('10) Filial consegue LER/ESCREVER no transbordo (t3) que mora na Matriz, mas NÃO tem acesso geral aos outros dados da Matriz (ex.: outro recebimento comum não-TRANSBORDO)', async () => {
    await assertFailsPorPermissao(dbFilial.doc('lojas/loja_matriz/recebimentos/fornecedorX').get());
  });

  console.log('\n=====================================');
  console.log(falhas === 0 ? 'TODOS OS CENÁRIOS PASSARAM — regras verificadas contra o motor real do Firestore.' : (falhas + ' CENÁRIO(S) FALHARAM — regras ainda incorretas.'));
  if (falhas > 0) {
    console.log(
      '\nLIMITAÇÃO CONHECIDA (2026-08-16, ainda não corrigida): os cenários\n' +
      '1b/2a/4b/6-negativo/9 (updates cross-loja NEGADOS num transbordo já\n' +
      'existente) tendem a estourar o limite de 1000 sub-expressões do motor\n' +
      'de regras em vez de negar pela lógica de permissão normal — a mensagem\n' +
      'vai conter "maximum of 1000" ou "Unable to evaluate the expression".\n' +
      'O RESULTADO pro usuário continua correto (escrita negada, sem buraco\n' +
      'de segurança), só o motivo reportado é genérico demais. Uma tentativa\n' +
      'de reestruturar `allow update` em firestore.rules com `?:` (ternário)\n' +
      'pra evitar pagar as duas árvores foi revertida por introduzir um erro\n' +
      'de avaliação novo, mais arriscado que o problema original — fica como\n' +
      'próximo passo, fora de um apagão ao vivo. Se APARECER uma falha NOVA\n' +
      '(mensagem diferente dessas, ou nos cenários 1a/2b/3/4a/6/10), TRATE\n' +
      'como regressão real, não como esta limitação conhecida.'
    );
  }
  console.log('=====================================\n');

  await testEnv.cleanup();
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO NO SCRIPT DE VERIFICAÇÃO:', e); process.exit(2); });
