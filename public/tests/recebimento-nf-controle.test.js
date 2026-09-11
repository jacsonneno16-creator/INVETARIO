// Controle de Nota Fiscal na transferência Matriz → Filial (acréscimo ao
// fluxo de Transbordo já especificado). Cobre os 3 ângulos que o pedido
// detalhou: (1) a NF é obrigatória na saída e viaja junto da transição de
// status, (2) a Filial só confirma — nunca recria — e uma NF divergente
// bloqueia a chegada sem concluir sozinho, (3) a proteção contra
// sobrescrever a NF depois de já gravada é reforçada nas regras do
// Firestore, não só na tela.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const opCode = fs.readFileSync(path.join(base, '93-recebimento-operacao.js'), 'utf8');
const relCode = fs.readFileSync(path.join(base, '94-recebimento-relatorios.js'), 'utf8');
const trbCode = fs.readFileSync(path.join(base, '95-recebimento-transbordo.js'), 'utf8');
const htmlCode = fs.readFileSync(path.join(__dirname, '../analista.html'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const base = {
    get: async () => ({ size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: id => { const docId = id || ('novo' + (seq++)); return {
      id: docId,
      set: async p => { const a = registro.get(docId) || {}; registro.set(docId, { ...a, ...p }); },
      update: async p => { const a = registro.get(docId); if (a === undefined) throw new Error('NOT_FOUND: no document to update'); registro.set(docId, { ...a, ...p }); },
      delete: async () => { registro.delete(docId); },
    }; },
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    _registro: registro,
  };
  // _carregarTodosTransbordos() (95-recebimento-transbordo.js) faz
  // `.where('tipo','==','TRANSBORDO')` por loja.
  base.where = (campo, op, valor) => ({
    get: async () => ({ docs: [...registro.entries()].filter(([, data]) => !data || data[campo] === valor).map(([id, data]) => ({ id, data: () => data })) }),
  });
  return base;
}
// Mock mínimo de `getDTRawFirestore().collection('lojas')` — usado por
// _carregarTodosTransbordos() pra listar as lojas ativas e buscar
// `recebimentos` (tipo TRANSBORDO) de cada uma.
function mockRawLojasSimples(recebimentosColecao) {
  return {
    collection: nome => {
      if (nome !== 'lojas') return mockColecao([]);
      return {
        doc: () => ({ collection: sub => (sub === 'recebimentos' ? recebimentosColecao : mockColecao([])) }),
        get: async () => ({ docs: [{ id: 'loja_matriz', data: () => ({ id: 'loja_matriz', nome: 'Matriz', ativa: true }) }] }),
      };
    },
  };
}

function elMap(valores) {
  const els = {};
  Object.keys(valores || {}).forEach(id => { els[id] = { value: valores[id], textContent: '', innerHTML: '', focus() {} }; });
  return { getElementById: id => { if (!els[id]) els[id] = { value: '', textContent: '', innerHTML: '', focus() {} }; return els[id]; }, _els: els };
}

function loadTransbordo(colecoes, domValores) {
  const dom = elMap(domValores);
  const document = { addEventListener: () => {}, getElementById: dom.getElementById };
  const window = {
    getDTFirestore: () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) }),
    getDTRawFirestore: () => mockRawLojasSimples(colecoes?.recebimentos || mockColecao([])),
    openModal: () => {}, closeModal: () => {}, showToast: () => {}, showConfirm: (msg, exec) => exec(),
    qrcode: () => ({ addData() {}, make() {}, createDataURL: () => 'data:image/gif;base64,AAAA' }),
    _currentAnalistaUser: { email: 'analista@daterrinha.com' },
    getDTLojaAtiva: () => 'loja_matriz',
    DTLoja: { listar: async () => ([{ id: 'loja_matriz', nome: 'Matriz' }, { id: 'loja_filial2', nome: 'Filial 2' }]) },
  };
  const ctx = { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, isNaN, setTimeout, setInterval: () => 0, clearInterval: () => {} };
  vm.createContext(ctx);
  vm.runInContext(opCode, ctx, { filename: '93-recebimento-operacao.js' });
  vm.runInContext(trbCode, ctx, { filename: '95-recebimento-transbordo.js' });
  return { window, dom: dom._els };
}

// "+ Novo Transbordo" ganhou uma reescrita concorrente (sessão seguinte):
// o modal agora é criado dinamicamente via document.body.insertAdjacentHTML
// (fallback defensivo pra cache antigo do analista.html) em vez de já
// existir 100% pronto — e recbtSalvar() passou a escrever sempre via
// getDTRawFirestore() (rota origem→destino de verdade), não mais fs()
// direto. O mock de DOM à mão (elMap, sem classList/insertAdjacentHTML/
// createElement reais) não sustenta isso — precisa de jsdom de verdade,
// mesma lição já aplicada nos testes do Coletor nesta sessão.
const { JSDOM } = require('jsdom');
// PEDIDO AO VIVO (2026-09-11): 93-recebimento-operacao.js passou a usar
// setInterval (polling de 45s em vez de onSnapshot — ver comentário
// "2026-09-11" no arquivo), disparado no fim de carregarRecebimentoOperacao()
// — chamado explicitamente pelos testes abaixo. Diferente do resto deste
// arquivo (que roda em `vm` com setInterval fake), esta janela é jsdom de
// verdade — sem fechá-la, cada teste deixava pra trás um timer real de
// verdade rodando (nunca se limpa sozinho), travando a suíte inteira por
// ~45s esperando o event loop esvaziar.
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function loadTransbordoRealDom(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _janelasAbertas.push(win);
  const document = win.document;
  win.getDTFirestore = () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: nome => nome === 'lojas' ? { doc: () => ({ collection: sub => colecoes?.[sub] || mockColecao([]) }) } : mockColecao([]) });
  win.openModal = () => {}; win.closeModal = () => {}; win.showToast = () => {};
  win.showConfirm = (msg, exec) => exec();
  win.qrcode = () => ({ addData() {}, make() {}, createDataURL: () => 'data:image/gif;base64,AAAA' });
  win._currentAnalistaUser = { email: 'analista@daterrinha.com' };
  win.getDTLojaAtiva = () => 'loja_matriz';
  win.DTLoja = { listar: async () => ([{ id: 'loja_matriz', nome: 'Matriz' }, { id: 'loja_filial2', nome: 'Filial 2' }]) };
  win.eval(opCode + '\n' + trbCode);
  return { window: win, document };
}

test('REGRESSÃO: "+ Novo Transbordo" grava null explícito em todos os campos de horário/NF ainda não preenchidos — bug ao vivo era "erro de permissão" bem na hora de confirmar a NF da saída, porque firestore.rules nega a escrita se o campo nunca existiu no documento (diferente de existir com valor null)', async () => {
  const recebimentos = mockColecao([]);
  const identificadores = mockColecao([]);
  const { window, document } = loadTransbordoRealDom({ recebimentos, recebimento_identificadores: identificadores, recebimento_auditoria: mockColecao([]) });
  await window._recebimentoOperacaoInternals.carregar(true);
  if (window._recebimentoTransbordoInternals) await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  // Destino passou a ser uma loja de verdade (select populado por
  // recbtNovo, não texto livre) — correção estrutural pra que
  // destinoLojaId exista de verdade e a guarda de posse tenha o que
  // proteger. Origem já vem pré-selecionada como a loja ativa.
  await window._recebimentoTransbordoInternals.abrirNovo();
  document.getElementById('rebt-destino').value = 'loja_filial2';

  await window.recbtSalvar();
  assert.equal(recebimentos._registro.size, 1);
  const doc = [...recebimentos._registro.values()][0];
  assert.equal(doc.status, 'PREVISTO');
  ['horaChegada', 'horaSaida', 'horaInicioDescarga', 'horaFimDescarga', 'horaFechamentoRecebimento', 'notaFiscalTransferencia', 'notaFiscalConfirmadaEm', 'notaFiscalConfirmadaPor'].forEach(campo => {
    assert.ok(Object.prototype.hasOwnProperty.call(doc, campo), 'campo ' + campo + ' precisa existir no documento (mesmo que null)');
    assert.equal(doc[campo], null, 'campo ' + campo + ' precisa ser null explícito, não ausente');
  });
});

test('93: recopRegistrarSaida/registrarChegadaTransbordo mesclam campos extras (NF) na mesma escrita, sem escrita separada', async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'PREVISTO' } }]);
  const auditoria = mockColecao([]);
  const { window } = loadTransbordo({ recebimentos, recebimento_auditoria: auditoria });
  await window._recebimentoOperacaoInternals.carregar(true);
  if (window._recebimentoTransbordoInternals) await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  await window._recebimentoOperacaoInternals.registrarSaida('r1', { notaFiscalTransferencia: '555000' });
  let r = recebimentos._registro.get('r1');
  assert.equal(r.status, 'EM_TRANSITO');
  assert.equal(r.notaFiscalTransferencia, '555000');
  assert.ok(r.horaSaida);

  await window._recebimentoOperacaoInternals.registrarChegadaTransbordo('r1', { notaFiscalConfirmadaEm: '2026-08-14T10:00:00.000Z', notaFiscalConfirmadaPor: 'op@x.com' });
  r = recebimentos._registro.get('r1');
  assert.equal(r.status, 'CHEGOU');
  assert.equal(r.notaFiscalConfirmadaPor, 'op@x.com');
  assert.equal(r.notaFiscalTransferencia, '555000'); // não recriada, continua a mesma

  assert.equal(auditoria._registro.size, 2);
});

test('95: modal de NF na saída (Matriz) — exige número não vazio, depois grava junto com a saída', async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'PREVISTO' } }]);
  const auditoria = mockColecao([]);
  const { window, dom } = loadTransbordo({ recebimentos, recebimento_auditoria: auditoria }, {
    'rebt-nf-saida-id': 'r1', 'rebt-nf-saida-numero': '',
  });
  await window._recebimentoOperacaoInternals.carregar(true);
  if (window._recebimentoTransbordoInternals) await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  let avisos = [];
  window.showToast = msg => avisos.push(msg);
  await window.recbtConfirmarNfSaida();
  assert.equal(recebimentos._registro.get('r1').status, 'PREVISTO'); // bloqueado, número vazio
  assert.equal(avisos.length, 1);

  dom['rebt-nf-saida-numero'].value = '777888';
  await window.recbtConfirmarNfSaida();
  const r = recebimentos._registro.get('r1');
  assert.equal(r.status, 'EM_TRANSITO');
  assert.equal(r.notaFiscalTransferencia, '777888');
});

test('PEDIDO AO VIVO: modal de NF do Transbordo (Analista) aceita mais de uma nota — adicionar() empilha, confirmar junta com ", ", e a chegada confere como CONJUNTO (ordem diferente ainda bate)', async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'PREVISTO' } }]);
  const { window, dom } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]) }, { 'rebt-nf-saida-id': 'r1', 'rebt-nf-saida-numero': '', 'rebt-nf-chegada-id': '', 'rebt-nf-chegada-numero': '' });
  await window._recebimentoOperacaoInternals.carregar(true);
  if (window._recebimentoTransbordoInternals) await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  dom['rebt-nf-saida-numero'].value = 'NF-1';
  window.adicionarNotaFiscalTransbordo('saida');
  assert.equal(dom['rebt-nf-saida-numero'].value, ''); // limpa pra próxima
  assert.match(dom['rebt-nf-saida-lista'].innerHTML, /NF-1/);
  dom['rebt-nf-saida-numero'].value = 'NF-2';
  window.adicionarNotaFiscalTransbordo('saida');
  dom['rebt-nf-saida-numero'].value = 'NF-3'; // deixado digitado, sem clicar no "+"
  await window.recbtConfirmarNfSaida();

  let r = recebimentos._registro.get('r1');
  assert.equal(r.status, 'EM_TRANSITO');
  assert.equal(r.notaFiscalTransferencia, 'NF-1, NF-2, NF-3');

  // confere na chegada, em ORDEM diferente — ainda tem que bater (conjunto, não string exata)
  window._recebimentoTransbordoInternals.abrirNfChegada('r1'); // popula o "registrada na saída" e limpa a lista de edição
  dom['rebt-nf-chegada-numero'].value = 'NF-3';
  window.adicionarNotaFiscalTransbordo('chegada');
  dom['rebt-nf-chegada-numero'].value = 'NF-1';
  window.adicionarNotaFiscalTransbordo('chegada');
  dom['rebt-nf-chegada-numero'].value = 'NF-2';
  await window.recbtConfirmarNfChegada();
  r = recebimentos._registro.get('r1');
  assert.equal(r.status, 'CHEGOU');
});

test('PEDIDO AO VIVO: uma NF errada na chegada do Transbordo (Analista) não fica "grudada" numa tentativa seguinte', async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', notaFiscalTransferencia: 'NF-1, NF-2' } }]);
  const { window, dom } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]) }, { 'rebt-nf-chegada-id': 'r1', 'rebt-nf-chegada-numero': '' });
  await window._recebimentoOperacaoInternals.carregar(true);
  if (window._recebimentoTransbordoInternals) await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  dom['rebt-nf-chegada-numero'].value = 'NF-1';
  window.adicionarNotaFiscalTransbordo('chegada');
  dom['rebt-nf-chegada-numero'].value = 'NF-ERRADA';
  await window.recbtConfirmarNfChegada();
  assert.equal(recebimentos._registro.get('r1').status, 'EM_TRANSITO'); // bloqueado
  assert.match(dom['rebt-nf-chegada-erro'].textContent, /não confere/i);
  assert.doesNotMatch(dom['rebt-nf-chegada-lista'].innerHTML, /NF-1|NF-ERRADA/); // limpou — não gruda na próxima tentativa

  dom['rebt-nf-chegada-numero'].value = 'NF-1';
  window.adicionarNotaFiscalTransbordo('chegada');
  dom['rebt-nf-chegada-numero'].value = 'NF-2';
  await window.recbtConfirmarNfChegada();
  assert.equal(recebimentos._registro.get('r1').status, 'CHEGOU');
});

test('95: modal de NF na chegada (Filial, registrada manualmente pelo Analista) — mostra a NF da saída e bloqueia divergência sem concluir', async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', notaFiscalTransferencia: '777888' } }]);
  const auditoria = mockColecao([]);
  const { window, dom } = loadTransbordo({ recebimentos, recebimento_auditoria: auditoria }, {
    'rebt-nf-chegada-id': '', 'rebt-nf-chegada-registrada': '', 'rebt-nf-chegada-numero': '', 'rebt-nf-chegada-erro': '',
  });
  await window._recebimentoOperacaoInternals.carregar(true);
  if (window._recebimentoTransbordoInternals) await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  window._recebimentoTransbordoInternals.abrirNfChegada('r1');
  assert.equal(dom['rebt-nf-chegada-registrada'].textContent, '777888');

  dom['rebt-nf-chegada-numero'].value = '000000'; // errado
  await window.recbtConfirmarNfChegada();
  assert.equal(recebimentos._registro.get('r1').status, 'EM_TRANSITO'); // não concluiu
  assert.match(dom['rebt-nf-chegada-erro'].textContent, /não confere/i);

  dom['rebt-nf-chegada-numero'].value = '777888'; // corrige
  await window.recbtConfirmarNfChegada();
  const r = recebimentos._registro.get('r1');
  assert.equal(r.status, 'CHEGOU');
  assert.ok(r.notaFiscalConfirmadaEm);
  assert.equal(r.notaFiscalConfirmadaPor, 'analista@daterrinha.com');
});

test('94: Histórico mostra a Nota Fiscal na tabela e no CSV exportado (antes ficava só salva no registro, sem aparecer em relatório nenhum)', async () => {
  const recebimentos = mockColecao([{
    id: 't1', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', motoristaNome: 'Pedro', placa: 'ABC1D23', notaFiscalTransferencia: 'NF-9001', horaChegada: '2026-08-14T10:00:00.000Z', horaFechamentoRecebimento: '2026-08-14T12:00:00.000Z', tempoEsperaMin: 10, tempoDescargaMin: 20, tempoTotalMin: 30 },
  }]);
  const dom = elMap({});
  const document = { addEventListener: () => {}, getElementById: dom.getElementById };
  const window = { getDTFirestore: () => ({ collection: nome => (nome === 'recebimentos' ? recebimentos : mockColecao([])) }) };
  const ctx = { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, isNaN, setInterval: () => 0, clearInterval: () => {} };
  vm.createContext(ctx);
  vm.runInContext(opCode, ctx, { filename: '93-recebimento-operacao.js' });
  vm.runInContext(relCode, ctx, { filename: '94-recebimento-relatorios.js' });

  await window._recebimentoOperacaoInternals.carregar(true);
  if (window._recebimentoTransbordoInternals) await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);
  await window.renderRecebimentoHistorico();

  assert.match(document.getElementById('page-recebimento-historico').innerHTML, /Nota Fiscal/);
  assert.match(document.getElementById('page-recebimento-historico').innerHTML, /NF-9001/);

  const linha = window._recebimentoRelatoriosInternals.historicoFiltrado()[0];
  assert.equal(linha.notaFiscalTransferencia, 'NF-9001');
});

test('95: botões de saída/chegada abrem o modal de NF em vez de registrar a transição direto', () => {
  assert.match(trbCode, /data-rebt-saida.*recbtAbrirNfSaida/);
  assert.match(trbCode, /data-rebt-chegada.*recbtAbrirNfChegada/);
});

test('analista.html: os dois modais de controle de NF existem, com os campos certos', () => {
  assert.match(htmlCode, /id="modal-rebt-nf-saida"/);
  assert.match(htmlCode, /id="rebt-nf-saida-numero"/);
  assert.match(htmlCode, /id="modal-rebt-nf-chegada"/);
  assert.match(htmlCode, /id="rebt-nf-chegada-registrada"/);
  assert.match(htmlCode, /id="rebt-nf-chegada-numero"/);
});

test('firestore.rules: notaFiscalTransferencia/confirmadaEm/Por só gravam na 1ª vez pelo ramo normal — sobrescrever exige corrigir-horario', () => {
  // A checagem "ramo normal" foi consolidada em _recebTransicaoHorarioValida()
  // (uma função, não mais repetida inline dentro de `match /recebimentos/{docId}`)
  // pra evitar 9 chamadas separadas de .diff() na mesma regra de update —
  // isso sozinho estourava o limite de 1000 sub-expressões do motor de
  // regras do Firestore (confirmado via Rules Unit Testing contra o
  // emulador real). Ver o comentário na própria função.
  const trechoFn = rules.slice(rules.indexOf('function _recebTransicaoHorarioValida'), rules.indexOf('function _recebTransicaoHorarioValida') + 1800);
  assert.match(trechoFn, /d\.hasAny\(\['notaFiscalTransferencia'\]\) \|\| antigo\.notaFiscalTransferencia == null/);
  assert.match(trechoFn, /d\.hasAny\(\['notaFiscalConfirmadaEm'\]\) \|\| antigo\.notaFiscalConfirmadaEm == null/);
  assert.match(trechoFn, /d\.hasAny\(\['notaFiscalConfirmadaPor'\]\) \|\| antigo\.notaFiscalConfirmadaPor == null/);

  // corrigir-horario cobre os 3 campos de NF também — mora em
  // _recAcaoConsolidada() (função consolidada reaproveitada pelos dois
  // ramos de `allow update`, definida ANTES do bloco `match /recebimentos/
  // {docId}`), não mais inline dentro do match — a fatia começa na função.
  const trecho = rules.slice(rules.indexOf('function _recAcaoConsolidada'), rules.indexOf('match /recebimento_identificadores'));
  assert.match(trecho, /'corrigir-horario'[\s\S]{0,300}?\) && request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\[[^\]]*notaFiscalTransferencia[^\]]*notaFiscalConfirmadaEm[^\]]*notaFiscalConfirmadaPor[^\]]*\]\)/);
});
