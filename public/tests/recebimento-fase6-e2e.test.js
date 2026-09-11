// FASE 6 — cenários ponta a ponta especificados na seção 30 do pedido.
// Não substitui o teste ao vivo com hardware de verdade (isso só o usuário
// consegue fazer), mas simula a integração real: Analista e Coletor rodam
// em DOIS contextos JS separados (mesma separação de bundles do app de
// verdade — coletor.html nunca carrega o bundle do Analista), compartilhando
// apenas as MESMAS instâncias de coleção mockada (mesmo padrão de
// `mockColecao` usado nos demais testes da fase 15). Isso prova que a
// "fonte única" (mesma coleção `recebimentos`/`recebimento_auditoria`) é
// real e não só uma afirmação de design.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const baseAnalista = path.join(__dirname, '../js/analista');
const baseColetor = path.join(__dirname, '../js/coletor');
const dashCode = fs.readFileSync(path.join(baseAnalista, '91-logistica-recebimento.js'), 'utf8');
const opCode = fs.readFileSync(path.join(baseAnalista, '93-recebimento-operacao.js'), 'utf8');
const relCode = fs.readFileSync(path.join(baseAnalista, '94-recebimento-relatorios.js'), 'utf8');
const trbCode = fs.readFileSync(path.join(baseAnalista, '95-recebimento-transbordo.js'), 'utf8');
const recColetorCode = fs.readFileSync(path.join(baseColetor, '22-recebimento.js'), 'utf8');
const offColetorCode = fs.readFileSync(path.join(baseColetor, '23-recebimento-offline.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const snapshot = entradas => ({ empty: entradas.length === 0, size: entradas.length, docs: entradas.map(([id, data]) => ({ id, data: () => data, exists: true })) });
  return {
    get: async () => snapshot([...registro.entries()]),
    doc: id => {
      const docId = id || ('novo' + (seq++));
      return {
        id: docId,
        get: async () => { const data = registro.get(docId); return { exists: data !== undefined, id: docId, data: () => data }; },
        set: async p => { const a = registro.get(docId) || {}; registro.set(docId, { ...a, ...p }); },
        update: async p => { const a = registro.get(docId); if (a === undefined) throw new Error('NOT_FOUND: no document to update'); registro.set(docId, { ...a, ...p }); },
        delete: async () => { registro.delete(docId); },
      };
    },
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    where: (campo, op, valor) => ({ get: async () => snapshot([...registro.entries()].filter(([, data]) => data && data[campo] === valor)) }),
    _registro: registro,
  };
}

// Carrega 91+93+94+95 juntos no MESMO contexto — é assim que roda de
// verdade dentro de analista.html (scripts irmãos, mesmo window global).
function loadAnalista(colecoes) {
  const document = { addEventListener: () => {}, getElementById: () => ({ value: '', textContent: '', innerHTML: '' }) };
  const window = {
    getDTFirestore: () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) }),
    openModal: () => {}, closeModal: () => {}, showToast: () => {}, showConfirm: (msg, exec) => exec(),
    aplicarPermissoesAnalista: () => {},
    qrcode: () => ({ addData() {}, make() {}, createDataURL: () => 'data:image/gif;base64,AAAA' }),
    _currentAnalistaUser: { email: 'analista@daterrinha.com' },
  };
  // setInterval/clearInterval fakes (não-op): 93-recebimento-operacao.js
  // passou a usar setInterval pra atualização periódica (ver comentário
  // "2026-09-11" no arquivo) — nenhum teste aqui exercita esse polling em
  // si, só precisa não quebrar ao chamar carregarRecebimentoOperacao().
  const ctx = { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, isNaN, setInterval: () => 0, clearInterval: () => {} };
  vm.createContext(ctx);
  vm.runInContext(opCode, ctx, { filename: '93-recebimento-operacao.js' });
  vm.runInContext(dashCode, ctx, { filename: '91-logistica-recebimento.js' });
  vm.runInContext(relCode, ctx, { filename: '94-recebimento-relatorios.js' });
  vm.runInContext(trbCode, ctx, { filename: '95-recebimento-transbordo.js' });
  return window;
}

function mockRecIdb() {
  const store = new Map();
  return {
    recIdbPut: async bip => { store.set(bip.uuid, bip); },
    recIdbDelete: async uuid => { store.delete(uuid); },
    recIdbGetPendentes: async () => [...store.values()].filter(b => b.status_sync === 'pendente'),
    recIdbGetAll: async () => [...store.values()],
  };
}

// Coletor roda ISOLADO — bundle separado, sem acesso a nada do Analista.
// `deviceId` diferente por chamada simula aparelhos físicos distintos (ex.:
// o leitor da Matriz e o leitor da Filial nunca são o mesmo device_id).
//
// Migrado pra jsdom de verdade (era um objeto de elementos mockado à mão,
// sem querySelector real) — a tela de NF ganhou linhas dinâmicas (NF +
// volume por nota, geradas via innerHTML + querySelector) que esse mock não
// suportava (mesma lição já aplicada em coletor-fase4-recebimento.test.js e
// coletor-fase4c-offline.test.js).
const { JSDOM } = require('jsdom');
const SHELL_COLETOR = `<!doctype html><html><body>
<div id="rec-lista-andamento"></div>
<div id="rec-lista-titulo"></div>
<input id="rec-scan-input">
<div id="rec-scan-status"></div>
<div id="rec-nf-titulo"></div>
<div id="rec-nf-subtitulo"></div>
<div id="rec-obs-bloco"></div>
<div id="rec-nf-lista"></div>
<div id="rec-nf-status"></div>
<button id="rec-nf-btn"></button>
<div id="rec-conf-icone"></div>
<div id="rec-conf-titulo"></div>
<div id="rec-conf-corpo"></div>
</body></html>`;
function loadColetor(colecoes, deviceId) {
  const idb = mockRecIdb();
  const onlineState = { value: true };
  const dom = new JSDOM(SHELL_COLETOR, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const els = new Proxy({}, { get: (_, id) => document.getElementById(id) });
  win.FS = { collection: nome => colecoes?.[nome] || mockColecao([]) };
  win.APP = { operador: { email: 'operador-coletor@daterrinha.com' } };
  win.goScreen = () => {}; win.toast = () => {};
  win.obterDeviceId = () => deviceId || 'dt_coletor_ponte01';
  win.recIdbPut = idb.recIdbPut; win.recIdbDelete = idb.recIdbDelete;
  win.recIdbGetPendentes = idb.recIdbGetPendentes; win.recIdbGetAll = idb.recIdbGetAll;
  win.getDTRawFirestore = () => ({ collection: () => mockColecao([]) });
  Object.defineProperty(win.navigator, 'onLine', { get: () => onlineState.value, configurable: true });
  // Um único eval — 22 e 23 compartilham estado via `let` top-level
  // (RECEBIMENTOS_CACHE etc.); dois win.eval() separados criam escopos de
  // script distintos no V8 (achado ao vivo rodando esta suíte).
  win.eval(recColetorCode + '\n' + offColetorCode);
  return { ctx: win, els, onlineState, document };
}

// Preenche a NF (e, quando informado, o volume) da linha `idx`. SAÍDA exige
// volume > 0 por nota; CHEGADA não.
function preencherNf(document, idx, numero, volume) {
  const numEl = idx === 0 ? document.getElementById('rec-nf-input') : document.querySelector('[data-nf-input="' + idx + '"]');
  numEl.value = numero;
  if (volume != null) {
    const volEl = document.querySelector('[data-nf-volume="' + idx + '"]');
    if (volEl) volEl.value = String(volume);
  }
}

test('Cenário 1 — fornecedor comum: agendamento (informativo) + registro manual da chegada até finalizar, refletindo no dashboard e no histórico', async () => {
  const agendamentos = mockColecao([{ id: 'ag1', data: { fornecedorNome: 'Fornecedor Alfa', dataAgendada: '2026-08-14', status: 'AGENDADO' } }]);
  // recopSalvar já registra a chegada na criação (CHEGOU/AGUARDANDO_DOCA) —
  // o Coletor nunca participa desse caminho, só a nota fiscal importa.
  const recebimentos = mockColecao([{
    id: 'r1', data: {
      tipo: 'FORNECEDOR', status: 'CHEGOU', fornecedorNome: 'Fornecedor Alfa',
      horaChegada: new Date().toISOString(), criadoEm: new Date().toISOString(),
      notas: [{ numero: '123', valor: 500 }],
    },
  }]);
  const auditoria = mockColecao([]);
  const window = loadAnalista({ recebimentos, recebimento_auditoria: auditoria, recebimento_agendamentos: agendamentos });
  const op = window._recebimentoOperacaoInternals;
  await op.carregar(true);

  await op.iniciarDescarga('r1');
  await op.finalizarDescarga('r1');
  await op.finalizar('r1');

  const r = recebimentos._registro.get('r1');
  assert.equal(r.status, 'FINALIZADO');

  // dashboard reflete o fornecedor finalizado
  const kpiHtml = window._recebimentoInternals.kpisOperacionaisHtml();
  assert.match(kpiHtml, />1<\/div><div class="kpi-lbl">Notas fiscais registradas/);

  // histórico mostra o recebimento finalizado
  const historico = window._recebimentoRelatoriosInternals.historicoFiltrado();
  assert.equal(historico.length, 1);
  assert.equal(historico[0].fornecedorNome, 'Fornecedor Alfa');

  // agendamento continua independente (informativo — não é auto-vinculado
  // ao recebimento real registrado; nenhum bip do Coletor entrou aqui)
  const agSnap = await agendamentos.get();
  assert.equal(agSnap.docs[0].data().status, 'AGENDADO');

  const operacoes = [...auditoria._registro.values()].map(x => x.operacao);
  assert.deepEqual(operacoes, ['DESCARGA_INICIADA', 'DESCARGA_FINALIZADA', 'RECEBIMENTO_FINALIZADO']);
});

test('Cenário 2 — transbordo: Matriz bipa o QR pra sair (informa motorista + NF) → Coletor bipa chegada/descarga na Filial (bundle separado) → Analista finaliza → dashboard e auditoria batem', async () => {
  const recebimentos = mockColecao([{
    id: 't1', data: { tipo: 'TRANSBORDO', status: 'PREVISTO', identificadorCodigo: 'TRB-PONTE01', origem: 'Matriz', destino: 'Filial 2', criadoEm: '2026-08-14T05:00:00.000Z', motoristaNome: 'Pedro', placa: 'ABC1D23' },
  }]);
  const identificadores = mockColecao([{ id: 'idt1', data: { codigo: 'TRB-PONTE01', recebimentoId: 't1' } }]);
  const auditoria = mockColecao([]);
  const colecoes = { recebimentos, recebimento_auditoria: auditoria, recebimento_identificadores: identificadores };

  // 1) Matriz — o responsável bipa o MESMO QR pra registrar a saída: o
  //    motorista já aparece (a carga já foi criada com ele vinculado) e o
  //    sistema pede a Nota Fiscal antes de liberar a viagem.
  const coletorMatriz = loadColetor(colecoes, 'dt_coletor_matriz01');
  await coletorMatriz.ctx.carregarRecebimentoColetor();
  coletorMatriz.els['rec-scan-input'].value = 'trb-ponte01';
  await coletorMatriz.ctx.confirmarCodigoRecebimento(); // leva pra tela de NF, modo "informar"
  assert.equal(recebimentos._registro.get('t1').status, 'PREVISTO'); // ainda não aplicou
  assert.match(coletorMatriz.els['rec-nf-subtitulo'].textContent, /Pedro/); // motorista identificado
  preencherNf(coletorMatriz.document, 0, 'NF-9001', 10); // saída exige volume > 0
  await coletorMatriz.ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get('t1').status, 'EM_TRANSITO');
  assert.equal(recebimentos._registro.get('t1').notaFiscalTransferencia, 'NF-9001');

  // 2) Filial — OUTRO aparelho Coletor (bundle totalmente separado, sessão
  //    diferente) bipa o MESMO código físico, sobre a MESMA coleção
  //    compartilhada. A chegada exige conferir a NF registrada na saída, e
  //    o motorista já aparece pra quem está recebendo conferir.
  const coletor = loadColetor(colecoes, 'dt_coletor_filial02');
  await coletor.ctx.carregarRecebimentoColetor();
  coletor.els['rec-scan-input'].value = 'trb-ponte01';
  await coletor.ctx.confirmarCodigoRecebimento(); // leva pra tela de conferência de NF
  assert.equal(recebimentos._registro.get('t1').status, 'EM_TRANSITO'); // ainda não aplicou
  assert.match(coletor.els['rec-nf-subtitulo'].textContent, /Pedro/); // motorista aparece pra Filial também
  assert.match(coletor.els['rec-nf-subtitulo'].textContent, /NF-9001/);
  preencherNf(coletor.document, 0, 'NF-9001'); // chegada — não exige volume
  await coletor.ctx.confirmarNotaFiscalRecebimento(); // NF confere -> chegada
  assert.equal(recebimentos._registro.get('t1').status, 'CHEGOU');
  assert.ok(recebimentos._registro.get('t1').notaFiscalConfirmadaEm);

  await coletor.ctx.confirmarCodigoRecebimento(); // início descarga (reaproveita o mesmo código já digitado)
  assert.equal(recebimentos._registro.get('t1').status, 'EM_DESCARGA');

  await coletor.ctx.confirmarCodigoRecebimento(); // fim descarga
  assert.equal(recebimentos._registro.get('t1').status, 'DESCARGA_FINALIZADA');

  // 3) Matriz/Analista — volta a olhar a MESMA carga (refetch, exatamente
  //    como um refresh de tela) e finaliza
  const analista = loadAnalista(colecoes);
  await analista._recebimentoOperacaoInternals.carregar(true);
  const rNoAnalista = analista._recebimentoOperacaoInternals.recebimentos().find(x => x._id === 't1');
  assert.equal(rNoAnalista.status, 'DESCARGA_FINALIZADA'); // o bip do Coletor já aparece pro Analista sem nenhuma ponte especial
  await analista._recebimentoOperacaoInternals.finalizar('t1');
  assert.equal(recebimentos._registro.get('t1').status, 'FINALIZADO');

  // dashboard do Analista conta o transbordo como finalizado
  await analista._recebimentoOperacaoInternals.carregar(true);
  const kpiHtml = analista._recebimentoInternals.kpisOperacionaisHtml();
  assert.match(kpiHtml, />1<\/div><div class="kpi-lbl">Transbordos finalizados/);

  // auditoria única e compartilhada tem os eventos dos TRÊS pontos (Matriz,
  // Filial, Analista de volta na Matriz), na ordem certa, cada um com o
  // device_id do aparelho físico que realmente bipou
  const operacoes = [...auditoria._registro.values()].map(x => x.operacao);
  assert.deepEqual(operacoes, ['TRANSBORDO_SAIU', 'CHEGADA_REGISTRADA', 'DESCARGA_INICIADA', 'DESCARGA_FINALIZADA', 'RECEBIMENTO_FINALIZADO']);
  const porDispositivo = [...auditoria._registro.values()].map(x => x.dispositivo);
  assert.deepEqual(porDispositivo, ['dt_coletor_matriz01', 'dt_coletor_filial02', 'dt_coletor_filial02', 'dt_coletor_filial02', undefined]); // a finalização é do Analista, sem device_id físico
});

test('Cenário 3 — offline completo: bipa chegada (com conferência de NF, funciona sem rede) e início de descarga sem internet, reconecta, sincroniza na ordem certa sem duplicar, e o Analista finaliza normalmente', async () => {
  const recebimentos = mockColecao([{ id: 't2', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', identificadorCodigo: 'TRB-OFFLINE01', notaFiscalTransferencia: 'NF-7002' } }]);
  const identificadores = mockColecao([{ id: 'idt2', data: { codigo: 'TRB-OFFLINE01', recebimentoId: 't2' } }]);
  const auditoria = mockColecao([]);
  const colecoes = { recebimentos, recebimento_auditoria: auditoria, recebimento_identificadores: identificadores };

  const coletor = loadColetor(colecoes);
  coletor.onlineState.value = false;
  await coletor.ctx.carregarRecebimentoColetor();

  coletor.els['rec-scan-input'].value = 'TRB-OFFLINE01';
  await coletor.ctx.confirmarCodigoRecebimento(); // leva pra conferência de NF — 100% local, funciona offline
  assert.match(coletor.els['rec-nf-subtitulo'].textContent, /NF-7002/);
  preencherNf(coletor.document, 0, 'NF-7002'); // chegada — vai pra fila (não exige volume)
  await coletor.ctx.confirmarNotaFiscalRecebimento(); // chegada — vai pra fila
  await coletor.ctx.confirmarCodigoRecebimento(); // início descarga — também vai pra fila (reflexo otimista local)
  assert.equal(recebimentos._registro.get('t2').status, 'EM_TRANSITO'); // servidor intocado enquanto offline
  assert.equal((await coletor.ctx.recIdbGetAll()).length, 2);

  // reconecta — sincroniza os 2 bips pendentes, na ordem em que foram bipados
  coletor.onlineState.value = true;
  await coletor.ctx.sincronizarFilaRecebimento();
  assert.equal((await coletor.ctx.recIdbGetAll()).length, 0); // fila limpa, sem conflito
  assert.equal(recebimentos._registro.get('t2').status, 'EM_DESCARGA');

  // reenviar a fila de novo (ex.: um segundo gatilho de sync concorrente)
  // não duplica nada, porque a fila já está vazia
  await coletor.ctx.sincronizarFilaRecebimento();
  const operacoesAntesDoOnline = [...auditoria._registro.values()].map(x => x.operacao);
  assert.deepEqual(operacoesAntesDoOnline, ['CHEGADA_REGISTRADA', 'DESCARGA_INICIADA']);

  // Analista enxerga o resultado sincronizado e fecha o ciclo normalmente,
  // sem precisar saber que aquilo veio de uma fila offline
  const analista = loadAnalista(colecoes);
  await analista._recebimentoOperacaoInternals.carregar(true);
  await analista._recebimentoOperacaoInternals.finalizarDescarga('t2');
  await analista._recebimentoOperacaoInternals.finalizar('t2');
  assert.equal(recebimentos._registro.get('t2').status, 'FINALIZADO');

  const operacoesFinal = [...auditoria._registro.values()].map(x => x.operacao);
  assert.deepEqual(operacoesFinal, ['CHEGADA_REGISTRADA', 'DESCARGA_INICIADA', 'DESCARGA_FINALIZADA', 'RECEBIMENTO_FINALIZADO']);
});
