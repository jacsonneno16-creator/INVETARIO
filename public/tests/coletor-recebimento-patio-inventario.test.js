// Coletor > Recebimento > Inventário do Pátio (29-recebimento-patio-
// inventario.js). Pedido ao vivo (2026-09-22): virou um fluxo só — pra
// cada NÚMERO de nota digitado (não mais a chave de 44 dígitos), já
// conhecida e presente só CONFIRMA; nova ou que já tinha saído pede o Box
// e CADASTRA (igual sempre foi). Ao "Finalizar", quem não foi confirmado é
// ENCERRADO (statusFisico:'SAIU') — nunca apagado, o histórico em Notas
// Retornadas continua, só a classificação muda (Recusa→Finalizado,
// Reentrega→dataSaidaEm, sem classificação→vira Reentrega finalizada
// também com tratamento+dataSaidaEm).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const baseColetor = path.join(__dirname, '../js/coletor');
const htmlCode = fs.readFileSync(path.join(__dirname, '../coletor.html'), 'utf8');
const navCode = fs.readFileSync(path.join(baseColetor, '10-navegacao-estorno.js'), 'utf8');
const patioCode = fs.readFileSync(path.join(baseColetor, '29-recebimento-patio-inventario.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const snapshot = entradas => ({ empty: entradas.length === 0, size: entradas.length, docs: entradas.map(([id, data]) => ({ id, data: () => data })) });
  const base = {
    get: async () => snapshot([...registro.entries()]),
    doc: id => ({
      id: id || ('novo' + (seq++)),
      get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; },
      update: async payload => { const atual = registro.get(id); if (atual === undefined) throw new Error('NOT_FOUND'); registro.set(id, Object.assign({}, atual, payload)); },
    }),
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    _registro: registro,
  };
  base.where = (campo, op, valor) => ({
    get: async () => {
      const bate = data => {
        const v = data ? data[campo] : undefined;
        if (op === 'array-contains') return Array.isArray(v) && v.includes(valor);
        if (op === '==') return v === valor;
        return true;
      };
      return snapshot([...registro.entries()].filter(([, data]) => bate(data)));
    },
  });
  return base;
}

let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarColetor(colecoes) {
  const dom = new JSDOM(htmlCode, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  win.getDTFirestore = () => ({ collection: nome => (colecoes && colecoes[nome]) || mockColecao([]) });
  win.getDTAuth = () => ({ currentUser: { uid: 'u1', email: 'operador@daterrinha.com' } });
  win.toast = () => {};
  win.eval(navCode);
  win.eval(patioCode);
  return { win, document };
}

test('número não encontrado: pede o Box e cadastra um novo evento de presença (INVENTARIO_INICIAL, NO_PATIO)', async () => {
  const recusas = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  win.APP = { operador: { name: 'Maria Operadora' } };

  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '12345';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('patio-inventario-host').innerHTML, /12345/);
  assert.match(document.getElementById('patio-inventario-host').innerHTML, /não está registrada/);

  document.getElementById('patio-box-input').value = 'box 7';
  document.getElementById('patio-confirmar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(recusas._registro.size, 1);
  const doc = [...recusas._registro.values()][0];
  assert.equal(doc.origem, 'INVENTARIO_INICIAL');
  assert.equal(doc.statusFisico, 'NO_PATIO');
  assert.equal(doc.box, 'BOX 7');
  assert.deepEqual(Array.from(doc.numerosNotas), ['12345']);
  assert.equal(doc.notas.length, 1);
  assert.equal(doc.notas[0].numeroNota, '12345');
  assert.equal(doc.notas[0].box, 'BOX 7');
  assert.equal(doc.notas[0].tratamento, undefined, 'tratamento não é definido aqui — o Analista classifica depois, igual toda nota nova');
  assert.equal(doc.conferenteNome, 'Maria Operadora');
  // volta pra tela de bipar, já com a nota confirmada na lista
  assert.match(document.getElementById('patio-inventario-host').innerHTML, /CONFIRMADAS: 1/);
});

test('nota nova: pallets é opcional (fica null se não preenchido) e motorista nunca é pedido — só Box e pallets', async () => {
  const recusas = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '55';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(document.getElementById('patio-motorista-input'), null, 'nunca pede motorista aqui — ninguém tem como saber quem trouxe');
  assert.ok(document.getElementById('patio-pallets-input'));
  document.getElementById('patio-box-input').value = 'BOX 4';
  document.getElementById('patio-confirmar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  const doc = [...recusas._registro.values()][0];
  assert.equal(doc.pallets, null, 'sem preencher, fica null — nunca vira 0 por engano');
  assert.equal(doc.motoristaNome, undefined);
});

test('nota nova: quantidade de pallets preenchida é gravada como número no doc', async () => {
  const recusas = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '56';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('patio-box-input').value = 'BOX 5';
  document.getElementById('patio-pallets-input').value = '8';
  document.getElementById('patio-confirmar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  const doc = [...recusas._registro.values()][0];
  assert.equal(doc.pallets, 8);
});

test('número já registrado e ainda no pátio: só CONFIRMA presença (sem pedir Box, sem gravar nada)', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', box: 'BOX 3', numerosNotas: ['999'], notas: [{ numeroNota: '999', tratamento: 'RECUSA' }] } },
  ]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });

  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '999';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('patio-inventario-host').innerHTML;
  assert.doesNotMatch(html, /patio-box-input/, 'não pede Box — a nota já está registrada e presente');
  assert.match(html, /CONFIRMADAS: 1/);
  assert.equal(recusas._registro.size, 1, 'nenhum documento novo foi criado');
});

test('número já registrado MAS já saiu do pátio (Recusa finalizada): não bloqueia — pede Box pra confirmar que voltou', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', statusFisico: 'SAIU', box: 'BOX 3', numerosNotas: ['999'], notas: [{ numeroNota: '999', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }] } },
  ]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });

  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '999';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('patio-inventario-host').innerHTML, /patio-box-input/);
});

test('número já confirmado nesta conferência não é consultado de novo (evita gasto de leitura à toa)', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', numerosNotas: ['999'], notas: [{ numeroNota: '999', tratamento: '' }] } },
  ]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '999';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('patio-numero-input').value = '999';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win._patioInventarioInternals.getEstado().confirmadas.length, 1);
});

test('sem Box informado: bloqueia a confirmação com aviso, não grava nada', async () => {
  const recusas = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  let avisoMostrado = '';
  win.toast = m => { avisoMostrado = m; };

  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '1';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  document.getElementById('patio-box-input').value = '';
  document.getElementById('patio-confirmar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(avisoMostrado, /Box/);
  assert.equal(recusas._registro.size, 0);
});

function docsIniciais() {
  return [
    { id: 'docRecusa', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', numerosNotas: ['100'], notas: [{ numeroNota: '100', tratamento: 'RECUSA', statusRetorno: '' }] } },
    { id: 'docReentrega', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', numerosNotas: ['101'], notas: [{ numeroNota: '101', tratamento: 'REENTREGA' }] } },
    { id: 'docSemClassificacao', data: { origem: 'INVENTARIO_INICIAL', statusFisico: 'NO_PATIO', numerosNotas: ['102'], notas: [{ numeroNota: '102', tratamento: '' }] } },
    { id: 'docConfirmada', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', numerosNotas: ['103'], notas: [{ numeroNota: '103', tratamento: 'RECUSA', statusRetorno: '' }] } },
  ];
}
async function confirmarEIrProResumo(win, document) {
  document.getElementById('patio-numero-input').value = '103';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  await win._patioInventarioInternals.irParaResumo();
}

test('resumo: nota confirmada fica de fora do que vai ser encerrado; as outras 3 (Recusa/Reentrega/sem classificação) entram', async () => {
  const recusas = mockColecao(docsIniciais());
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  const r = win._patioInventarioInternals.getEstado().resumo;
  assert.equal(r.qtdEncontradas, 1);
  assert.equal(r.qtdTotalEncerrar, 3);
  assert.equal(r.qtdRecusa, 1);
  assert.equal(r.qtdReentrega, 1);
  assert.equal(r.qtdSemClassificacao, 1);
});

test('confirmarFinalizacao: Recusa não confirmada vira statusRetorno FINALIZADO (não é apagada)', async () => {
  const recusas = mockColecao(docsIniciais());
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  await win._patioInventarioInternals.confirmarFinalizacao();
  const doc = recusas._registro.get('docRecusa');
  assert.equal(doc.notas[0].statusRetorno, 'FINALIZADO');
  assert.equal(doc.statusFisico, 'SAIU');
  assert.ok(Array.isArray(doc.notas[0].statusRetornoHistorico) && doc.notas[0].statusRetornoHistorico.length === 1);
});

test('confirmarFinalizacao: Reentrega não confirmada grava dataSaidaEm (mesmo campo da tela de Saída normal)', async () => {
  const recusas = mockColecao(docsIniciais());
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  await win._patioInventarioInternals.confirmarFinalizacao();
  const doc = recusas._registro.get('docReentrega');
  assert.ok(doc.notas[0].dataSaidaEm);
  assert.equal(doc.statusFisico, 'SAIU');
});

test('confirmarFinalizacao: nota SEM classificação não confirmada vira Reentrega finalizada (tratamento+dataSaidaEm)', async () => {
  const recusas = mockColecao(docsIniciais());
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  await win._patioInventarioInternals.confirmarFinalizacao();
  const doc = recusas._registro.get('docSemClassificacao');
  assert.equal(doc.notas[0].tratamento, 'REENTREGA', 'pedido ao vivo: não classificado + não encontrado vira Reentrega');
  assert.ok(doc.notas[0].dataSaidaEm);
  assert.equal(doc.statusFisico, 'SAIU');
});
test('estaNoPatio: nota com tratamento legado (fora de RECUSA/REENTREGA/vazio) ainda usa confirmadoAusenteEm como rede de segurança', async () => {
  const { win } = carregarColetor();
  const doc = { origem: 'COLETOR' };
  const nota = { tratamento: 'DEVOLUCAO', confirmadoAusenteEm: '2026-09-22T00:00:00.000Z' };
  assert.equal(win._patioInventarioInternals.estaNoPatio(doc, nota), false);
});

test('confirmarFinalizacao: nota confirmada continua intacta — statusFisico permanece NO_PATIO', async () => {
  const recusas = mockColecao(docsIniciais());
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  await win._patioInventarioInternals.confirmarFinalizacao();
  const doc = recusas._registro.get('docConfirmada');
  assert.equal(doc.statusFisico, 'NO_PATIO');
  assert.equal(doc.notas[0].statusRetorno, '');
});

test('nada confirmado: pedir resumo sem confirmar nenhuma nota mostra erro e não avança de etapa', async () => {
  const recusas = mockColecao(docsIniciais());
  const { win } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  await win._patioInventarioInternals.irParaResumo();
  assert.equal(win._patioInventarioInternals.getEstado().etapa, 'bipar');
});

test('estaNoPatio: nota com confirmadoAusenteEm nunca conta como presente, mesmo sendo Reentrega sem dataSaidaEm', async () => {
  const { win } = carregarColetor();
  const doc = { origem: 'COLETOR' };
  const nota = { tratamento: 'REENTREGA', confirmadoAusenteEm: '2026-09-22T00:00:00.000Z' };
  assert.equal(win._patioInventarioInternals.estaNoPatio(doc, nota), false);
});

// PEDIDO AO VIVO (2026-10-02): "teria que ter uma aba de relatório de
// inventário de notas no pátio" — confirmarFinalizacao() agora grava um
// retrato da sessão em recebimento_patio_inventarios, pra ser consultado
// depois (124-recebimento-patio-inventarios-relatorio.js, no Analista).
test('confirmarFinalizacao: grava 1 snapshot da sessão em recebimento_patio_inventarios com as notas encontradas e encerradas', async () => {
  const recusas = mockColecao(docsIniciais());
  const inventarios = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas, recebimento_patio_inventarios: inventarios });
  win.APP = { operador: { name: 'Maria Operadora' } };
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  await win._patioInventarioInternals.confirmarFinalizacao();

  assert.equal(inventarios._registro.size, 1);
  const snap = [...inventarios._registro.values()][0];
  assert.deepEqual(Array.from(snap.notasEncontradas), ['103']);
  assert.equal(snap.qtdEncontradas, 1);
  assert.equal(snap.operadorNome, 'Maria Operadora');
  assert.equal(snap.operadorEmail, 'operador@daterrinha.com');
  assert.equal(snap.qtdRecusa, 1);
  assert.equal(snap.qtdReentrega, 1);
  assert.equal(snap.qtdSemClassificacao, 1);
  assert.equal(snap.qtdTotalEncerrar, 3);
  const porNumero = Object.fromEntries(snap.notasEncerradas.map(n => [n.numeroNota, n.tratamento]));
  assert.equal(porNumero['100'], 'RECUSA');
  assert.equal(porNumero['101'], 'REENTREGA');
  assert.equal(porNumero['102'], 'SEM_CLASSIFICACAO');
});

test('confirmarFinalizacao: sem nada a encerrar (tudo confirmado), não grava snapshot nenhum', async () => {
  const recusas = mockColecao([
    { id: 'docConfirmada', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', numerosNotas: ['103'], notas: [{ numeroNota: '103', tratamento: 'RECUSA', statusRetorno: '' }] } },
  ]);
  const inventarios = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas, recebimento_patio_inventarios: inventarios });
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  await win._patioInventarioInternals.confirmarFinalizacao();
  assert.equal(inventarios._registro.size, 0, 'early-return antes do try — nada a encerrar, nada pra registrar');
});

test('confirmarFinalizacao: falha ao gravar o snapshot do histórico não impede o encerramento nem a tela de "concluído"', async () => {
  const recusas = mockColecao(docsIniciais());
  const inventariosQueFalha = { add: async () => { throw new Error('indisponível'); } };
  const { win, document } = carregarColetor({ recebimento_recusas: recusas, recebimento_patio_inventarios: inventariosQueFalha });
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  await win._patioInventarioInternals.confirmarFinalizacao();
  assert.equal(win._patioInventarioInternals.getEstado().etapa, 'concluido', 'mesmo com o histórico falhando, o inventário termina normalmente');
  assert.equal(recusas._registro.get('docRecusa').statusFisico, 'SAIU', 'o encerramento das notas já gravado não é desfeito');
});

// PEDIDO AO VIVO (2026-10-14): "se ele tiver fazendo e sair da página ou do
// aplicativo ele perde o progresso" — S vivia só em memória; sair da tela
// (ou o app fechar/recarregar) zerava tudo que já tinha sido confirmado.
// Estes testes cobrem o rascunho novo em localStorage: salva a cada
// confirmação, sobrevive a reabrir a tela (nova "sessão" de abrirInventarioPatio),
// e só é apagado quando o inventário é FINALIZADO de verdade.
test('progresso sobrevive a sair e reabrir a tela: confirmar 1 nota, "reabrir" (nova chamada de abrirInventarioPatio) restaura a lista', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', numerosNotas: ['999'], notas: [{ numeroNota: '999', tratamento: '' }] } },
  ]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '999';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win._patioInventarioInternals.getEstado().confirmadas.length, 1);

  // Simula sair da página/app e voltar: chama abrirInventarioPatio() de
  // novo, igual o botão de menu faria numa sessão nova do mesmo app aberto.
  let avisoMostrado = '';
  win.toast = m => { avisoMostrado = m; };
  await win.abrirInventarioPatio();

  assert.equal(win._patioInventarioInternals.getEstado().confirmadas.length, 1, 'não perdeu a nota já confirmada');
  assert.deepEqual(Array.from(win._patioInventarioInternals.getEstado().confirmadas), ['999']);
  assert.match(avisoMostrado, /Retomando conferência anterior/);
  assert.match(document.getElementById('patio-inventario-host').innerHTML, /CONFIRMADAS: 1/);
});

test('rascunho persiste mesmo na etapa "novo" (nota pendente de Box) e restaura nessa mesma etapa', async () => {
  const recusas = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '42';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(win._patioInventarioInternals.getEstado().etapa, 'novo');

  const rascunho = win._patioInventarioInternals._carregarRascunho();
  assert.equal(rascunho.etapa, 'novo');
  assert.equal(rascunho.pendenteNovo, '42');
});

test('rascunho é apagado quando o inventário é finalizado de verdade — reabrir depois começa do zero', async () => {
  const recusas = mockColecao(docsIniciais());
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  await confirmarEIrProResumo(win, document);
  await win._patioInventarioInternals.confirmarFinalizacao();

  assert.equal(win._patioInventarioInternals._carregarRascunho(), null);
  await win.abrirInventarioPatio();
  assert.deepEqual(Array.from(win._patioInventarioInternals.getEstado().confirmadas), []);
  assert.equal(win._patioInventarioInternals.getEstado().etapa, 'bipar');
});

test('"Voltar sem finalizar" (sair sem clicar Finalizar) preserva o rascunho — não é um cancelamento', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', numerosNotas: ['7'], notas: [{ numeroNota: '7', tratamento: '' }] } },
  ]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas });
  await win.abrirInventarioPatio();
  document.getElementById('patio-numero-input').value = '7';
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  document.querySelector('[data-patio-voltar]').click(); // "← Voltar sem finalizar"

  const rascunho = win._patioInventarioInternals._carregarRascunho();
  assert.ok(rascunho, 'o rascunho continua salvo — "sem finalizar" não é um descarte');
  assert.deepEqual(Array.from(rascunho.confirmadas), ['7']);
});

test('sem rascunho salvo, abrirInventarioPatio() começa do zero normalmente (sem aviso de retomada)', async () => {
  const { win, document } = carregarColetor({ recebimento_recusas: mockColecao([]) });
  let avisoMostrado = '';
  win.toast = m => { avisoMostrado = m; };
  await win.abrirInventarioPatio();
  assert.deepEqual(Array.from(win._patioInventarioInternals.getEstado().confirmadas), []);
  assert.equal(avisoMostrado, '');
  assert.match(document.getElementById('patio-inventario-host').innerHTML, /Nenhuma nota confirmada ainda/);
});
