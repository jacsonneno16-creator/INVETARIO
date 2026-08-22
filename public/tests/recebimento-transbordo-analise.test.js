// Análise do Transbordo (acréscimo ao pedido original): gráficos de tempo
// por dia, status atual, ranking por motorista. A tela NUNCA usou a
// Bluesoft pra CRIAR/controlar o transbordo (isso sempre foi só do nosso
// Coletor) — mas chegou a ter um cruzamento opcional de conferência da NF e
// uma seção mostrando notas de transferência sincronizadas; ambos foram
// removidos a pedido do usuário (o Coletor já registra motorista, nota e
// cada horário sozinho, então a tela de Transbordo passou a mostrar só o
// que o nosso próprio sistema gerou, sem nada vindo de importação).
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const opCode = fs.readFileSync(path.join(base, '93-recebimento-operacao.js'), 'utf8');
const svcCode = fs.readFileSync(path.join(base, '90-bluesoft-service.js'), 'utf8');
const dashCode = fs.readFileSync(path.join(base, '91-logistica-recebimento.js'), 'utf8');
const trbCode = fs.readFileSync(path.join(base, '95-recebimento-transbordo.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  return {
    get: async () => ({ size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: id => { const docId = id || ('novo' + (seq++)); return {
      id: docId,
      set: async p => { const a = registro.get(docId) || {}; registro.set(docId, { ...a, ...p }); },
      update: async p => { const a = registro.get(docId); if (a === undefined) throw new Error('NOT_FOUND: no document to update'); registro.set(docId, { ...a, ...p }); },
      get: async () => ({ exists: registro.has(docId), data: () => registro.get(docId) }),
      delete: async () => { registro.delete(docId); },
    }; },
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    _registro: registro,
  };
}
// Mock de `getDTRawFirestore().collection('lojas').doc(lojaId).collection('recebimentos')`
// — usado por recbtSalvar()/recbtSalvarEdicaoCompleta() (escrita crua,
// mesmo padrão de recbtSalvarRota() já existente no arquivo real).
function mockRawLojas(porLoja) {
  return {
    collection: nome => {
      if (nome !== 'lojas') return mockColecao([]);
      return { doc: lojaId => ({ collection: sub => (porLoja[lojaId] && porLoja[lojaId][sub]) || mockColecao([]) }) };
    },
  };
}

// Migrado pra jsdom de verdade (era um objeto document mockado à mão, sem
// querySelector) — a tela ganhou _vincularBotoesCriticosTransbordo()
// (sessão seguinte: liga "+ Novo Transbordo"/"⇄ Inverter lojas" direto no
// elemento via querySelector, não mais só por delegação), que essa suíte
// não sustentava. Mesma lição já aplicada nos testes do Coletor.
function loadTransbordo(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-transbordo"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const els = new Proxy({}, { get: (_, id) => document.getElementById(id) });
  win.getDTFirestore = () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) });
  win.openModal = () => {}; win.closeModal = () => {}; win.showToast = () => {};
  win.showConfirm = (msg, exec) => exec();
  win.qrcode = () => ({ addData() {}, make() {}, createDataURL: () => 'data:image/gif;base64,AAAA' });
  win._currentAnalistaUser = { email: 'analista@daterrinha.com' };
  win.eval(opCode + '\n' + svcCode + '\n' + dashCode + '\n' + trbCode);
  const dispararChange = (id, value) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const dispararClick = seletor => {
    const el = document.querySelector(seletor);
    if (el) el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  return { window: win, els, document, dispararChange, dispararClick };
}

test('91: notasTodas() ignora o filtro de período/fornecedor da tela de Notas — nunca fica vazia por causa de um filtro deixado em outra aba', async () => {
  const notas = mockColecao([{ id: 'n1', data: { numeroNota: '9001', processamento: '2026-01-01' } }]);
  const { window } = loadTransbordo({ recebimento_notas: notas });
  await window._recebimentoInternals.carregar(true);
  // mesmo sem chamar nenhum filtro, notasTodas() traz tudo
  assert.equal(window._recebimentoInternals.notasTodas().length, 1);
  assert.equal(window._recebimentoInternals.notasTodas()[0].numeroNota, '9001');
});

test('REGRESSÃO: tela de Transbordo não usa mais a Bluesoft pra nada — sem sync, sem cruzamento de NF, sem seção de notas importadas (pedido ao vivo do usuário: "o coletor passa a ser a origem dos dados do nosso transbordo")', () => {
  assert.doesNotMatch(trbCode, /sincronizarRecebimentoBluesoft/);
  assert.doesNotMatch(trbCode, /data-rebt-sync/);
  assert.doesNotMatch(trbCode, /rebt-sync-status/);
  assert.doesNotMatch(trbCode, /statusNfBluesoft/);
  assert.doesNotMatch(trbCode, /_recebimentoInternals/);
  assert.doesNotMatch(trbCode, /categoriaNotaBluesoft/);
  assert.doesNotMatch(trbCode, /Notas de transferência \(Bluesoft\)/);
});

// BUG AO VIVO REAL (achado direto pelo usuário no painel, não suposição):
// "não apareceu os primeiros transbordos... ele tá cobrindo o anterior" —
// causa raiz era transbordos() (função DESTA tela, separada da de
// 93-recebimento-operacao.js) tendo sua PRÓPRIA cópia do mesmo erro:
// agrupava por identificadorCodigo (QR FIXO POR MOTORISTA, reaproveitado
// em toda viagem dele, de propósito) em vez de pela identidade real do
// documento — duas viagens diferentes do mesmo motorista colidiam na
// mesma chave, e só a mais recente sobrevivia.
test('REGRESSÃO (bug ao vivo real, relatado direto pelo usuário no painel): várias viagens do MESMO motorista (mesmo identificadorCodigo, documentos e horários distintos) aparecem TODAS na tela de Transbordo — nenhuma "cobre" a anterior', async () => {
  const recebimentos = mockColecao([
    { id: 't1', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', identificadorCodigo: 'MOT-ABC123', motoristaNome: 'Carlos', horaSaida: '2026-08-18T08:14:00.000Z', notaFiscalTransferencia: '305548' } },
    { id: 't2', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', identificadorCodigo: 'MOT-ABC123', motoristaNome: 'Carlos', horaSaida: '2026-08-18T10:22:00.000Z', notaFiscalTransferencia: '305549, 305550' } },
    { id: 't3', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', identificadorCodigo: 'MOT-ABC123', motoristaNome: 'Carlos', horaSaida: '2026-08-18T12:44:00.000Z', notaFiscalTransferencia: '305552' } },
  ]);
  const { window } = loadTransbordo({ recebimentos });
  await window._recebimentoOperacaoInternals.carregar(true);

  await window.renderRecebimentoTransbordo();
  const html = window.document.getElementById('page-recebimento-transbordo').innerHTML;
  assert.match(html, /3 transbordo\(s\)/);
  assert.match(html, /305548/);
  assert.match(html, /305549, 305550/);
  assert.match(html, /305552/);
});

test('95: tela mostra a coluna de Nota Fiscal (texto simples, sem cruzamento com nada) e os dois gráficos', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', notaFiscalTransferencia: '9001', horaSaida: '2026-08-14T06:00:00.000Z', motoristaNome: 'Carlos', tempoTotalMin: 90 } },
    { id: 'r2', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', notaFiscalTransferencia: '4321', horaSaida: '2026-08-14T07:00:00.000Z', motoristaNome: 'Carlos', tempoTotalMin: 60 } },
  ]);
  const { window, els } = loadTransbordo({ recebimentos });

  await window.renderRecebimentoTransbordo();
  const html = els['page-recebimento-transbordo'].innerHTML;

  assert.match(html, /Nota Fiscal/);
  assert.match(html, />9001</);
  assert.match(html, />4321</);
  assert.doesNotMatch(html, /confere|não encontrada/i);
  assert.match(html, /id="rebt-graf-tempos"/);
  assert.match(html, /id="rebt-graf-status"/);
  assert.match(html, /Por motorista/);
  assert.match(html, /Carlos/);
  assert.match(html, /2<\/td>/); // Carlos aparece com 2 viagens na tabela de ranking
});

test('PEDIDO AO VIVO: filtro de período tem INÍCIO e FIM (não só um mês único) — dá pra escolher um dia só, uma semana, ou qualquer intervalo livre', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', identificadorCodigo: 'TRB-JUL', horaSaida: '2026-07-10T06:00:00.000Z', tempoTotalMin: 30 } },
    { id: 'r2', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', identificadorCodigo: 'TRB-AGO-10', horaSaida: '2026-08-10T06:00:00.000Z', tempoTotalMin: 60 } },
    { id: 'r3', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', identificadorCodigo: 'TRB-AGO-20', horaSaida: '2026-08-20T06:00:00.000Z', tempoTotalMin: 45 } },
  ]);
  const { window, els, dispararChange } = loadTransbordo({ recebimentos });
  await window.renderRecebimentoTransbordo();
  assert.match(els['page-recebimento-transbordo'].innerHTML, /3 transbordo\(s\)/);

  // intervalo livre (não é "o mês inteiro") — só o dia 10, o resto de fora
  dispararChange('rebt-f-data-inicio', '2026-08-10');
  dispararChange('rebt-f-data-fim', '2026-08-10');
  let html = els['page-recebimento-transbordo'].innerHTML;
  assert.match(html, /1 transbordo\(s\)/);
  assert.match(html, /TRB-AGO-10/);
  assert.doesNotMatch(html, /TRB-AGO-20/);
  assert.doesNotMatch(html, /TRB-JUL/);

  // intervalo de uma semana cobrindo os dois de agosto, mas não julho
  dispararChange('rebt-f-data-inicio', '2026-08-05');
  dispararChange('rebt-f-data-fim', '2026-08-25');
  html = els['page-recebimento-transbordo'].innerHTML;
  assert.match(html, /2 transbordo\(s\)/);
  assert.match(html, /TRB-AGO-10/);
  assert.match(html, /TRB-AGO-20/);
  assert.doesNotMatch(html, /TRB-JUL/);

  // só a data de início, sem fim — sem limite pra frente
  dispararChange('rebt-f-data-inicio', '2026-08-01');
  dispararChange('rebt-f-data-fim', '');
  html = els['page-recebimento-transbordo'].innerHTML;
  assert.match(html, /2 transbordo\(s\)/);
  assert.doesNotMatch(html, /TRB-JUL/);
});

test('PEDIDO AO VIVO: atalhos "Hoje"/"7 dias"/"Limpar" no filtro de período do Transbordo', async () => {
  const hoje = new Date().toLocaleDateString('en-CA');
  const recebimentos = mockColecao([
    { id: 'r1', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', identificadorCodigo: 'TRB-HOJE', horaSaida: hoje + 'T06:00:00.000Z', tempoTotalMin: 30 } },
    { id: 'r2', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', identificadorCodigo: 'TRB-2020', horaSaida: '2020-01-01T06:00:00.000Z', tempoTotalMin: 60 } },
  ]);
  const { window, els, dispararClick } = loadTransbordo({ recebimentos });
  await window.renderRecebimentoTransbordo();

  dispararClick('[data-rebt-f-hoje]');
  let html = els['page-recebimento-transbordo'].innerHTML;
  assert.match(html, /1 transbordo\(s\)/);
  assert.match(html, /TRB-HOJE/);
  assert.doesNotMatch(html, /TRB-2020/);

  dispararClick('[data-rebt-f-limpar]');
  html = els['page-recebimento-transbordo'].innerHTML;
  assert.match(html, /2 transbordo\(s\)/); // limpou — mostra tudo de novo
});

test('95: o gráfico de tempos por dia e o de status são desenhados com Chart.js quando disponível, e destruídos antes de redesenhar (sem vazamento de instância)', async () => {
  const recebimentos = mockColecao([{ id: 'r1', data: { tipo: 'TRANSBORDO', status: 'EM_TRANSITO', horaSaida: '2026-08-14T06:00:00.000Z', tempoViagemMin: 30 } }]);
  const { window, els } = loadTransbordo({ recebimentos });
  const instancias = [];
  window.Chart = function (ctx, cfg) { this.destroy = () => { instancias.push('destruído'); }; this._cfg = cfg; instancias.push('criado:' + cfg.type); };

  await window.renderRecebimentoTransbordo();
  assert.deepEqual(instancias, ['criado:bar', 'criado:doughnut']);

  await window.renderRecebimentoTransbordo(); // redesenha
  assert.deepEqual(instancias, ['criado:bar', 'criado:doughnut', 'destruído', 'destruído', 'criado:bar', 'criado:doughnut']);
});

// PEDIDOS AO VIVO DO USUÁRIO (tela "+ Novo Transbordo" do Analista): (1)
// "não tem o espaço pra mim colocar a nota... tem que ter a opção pra
// colocar mais de uma" — o modal de criação nunca teve campo de NF nenhum,
// só volumes; (2) "na hora de colocar a hora tem que ficar arrastando lá...
// mais fácil a hora ser digitada" — os 5 campos de horário eram
// `type="datetime-local"` únicos, viraram DOIS campos (`date`+`time`)
// digitáveis, combinados na hora de salvar.
test('PEDIDO AO VIVO: "+ Novo Transbordo" agora tem campo de Nota Fiscal (múltiplas) e salva com os horários combinados de data+hora separados', async () => {
  const recebimentos = mockColecao([]);
  const identificadores = mockColecao([]);
  const { window, document } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]), recebimento_motoristas: mockColecao([]), recebimento_veiculos: mockColecao([]), recebimento_rotas_transbordo: mockColecao([]) });
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTRawFirestore = () => mockRawLojas({ loja_matriz: { recebimentos, recebimento_identificadores: identificadores } });
  window.DTLoja = { listar: async () => [{ id: 'loja_matriz', nome: 'Matriz', ativa: true }, { id: 'loja_filial', nome: 'Filial', ativa: true }] };

  await window.recbtNovo();
  document.getElementById('rebt-origem').value = 'loja_matriz';
  document.getElementById('rebt-destino').value = 'loja_filial';
  document.getElementById('rebt-volumes').value = '10';
  // Campo de NF novo — digita duas notas usando o "+" (mesmo padrão já usado na saída/chegada)
  document.getElementById('rebt-nf-novo-numero').value = '111';
  window.adicionarNotaFiscalTransbordo('novo');
  document.getElementById('rebt-nf-novo-numero').value = '222';
  window.adicionarNotaFiscalTransbordo('novo');
  assert.match(document.getElementById('rebt-nf-novo-lista').innerHTML, /111/);
  assert.match(document.getElementById('rebt-nf-novo-lista').innerHTML, /222/);
  // Horário de saída digitado em DOIS campos (data + hora), não mais um datetime-local só.
  document.getElementById('rebt-hora-saida-data').value = '2026-08-18';
  document.getElementById('rebt-hora-saida-hora').value = '14:30';

  await window.recbtSalvar();

  assert.equal(recebimentos._registro.size, 1);
  const doc = [...recebimentos._registro.values()][0];
  assert.equal(doc.notaFiscalTransferencia, '111, 222'); // as duas notas, juntas
  assert.ok(doc.horaSaida.startsWith('2026-08-18'), 'a data digitada tem que estar no ISO salvo: ' + doc.horaSaida);
  assert.equal(doc.status, 'EM_TRANSITO'); // já tinha saída informada
});

// (3) "já tem uma carga que a pessoa fez lá no coletor e finalizou pelo
// coletor... eu clique lá em editar, ela abre normalmente mostrando tudo e
// eu edite qualquer informação que tenha, horário, nota, volume, qualquer
// coisa" — não existia NENHUM jeito de editar uma carga já existente além
// de "Corrigir remetente e destino" (só lojas, explicitamente preserva o
// resto). Precisa funcionar mesmo em FINALIZADO (bug ao vivo: exatamente o
// caso relatado).
test('PEDIDO AO VIVO: "Editar" abre uma carga JÁ FINALIZADA pelo Coletor preenchendo tudo, e salva horário/nota/volume/motorista corrigidos', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: {
      tipo: 'TRANSBORDO', status: 'FINALIZADO', origem: 'Matriz', destino: 'Filial',
      motoristaId: 'm-carlos', motoristaNome: 'Carlos', placa: 'ABC1D23', volumes: 0, // volume ficou faltando — exatamente o relato
      horaSaida: '2026-08-17T09:00:00.000Z', horaChegada: '2026-08-17T10:00:00.000Z',
      horaInicioDescarga: '2026-08-17T10:10:00.000Z', horaFimDescarga: '2026-08-17T10:40:00.000Z',
      horaFechamentoRecebimento: '2026-08-17T10:45:00.000Z',
      notaFiscalTransferencia: null, // nota também ficou faltando
    } },
  ]);
  const motoristas = mockColecao([
    { id: 'm-carlos', data: { nome: 'Carlos', transportadora: 'Transp. A' } },
    { id: 'm-joao', data: { nome: 'João', transportadora: 'Transp. B' } },
  ]);
  const { window, document } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]), recebimento_motoristas: motoristas, recebimento_veiculos: mockColecao([]) });
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTRawFirestore = () => mockRawLojas({ loja_matriz: { recebimentos, recebimento_auditoria: mockColecao([]) } });
  await window._recebimentoOperacaoInternals.carregar(true);

  await window.recbtAbrirEdicaoCompleta('r1');

  // Abriu mostrando os horários já salvos, cada um separado em data+hora.
  assert.equal(document.getElementById('rebtedit-hora-saida-data').value, '2026-08-17');
  assert.equal(document.getElementById('rebtedit-hora-fechamento-data').value, '2026-08-17');
  assert.equal(document.getElementById('rebt-edit-completo-volumes').value, '0');
  // PEDIDO AO VIVO ("eu consigo ajustar tudo, menos troca o motorista que
  // veio, quando saiu de um lugar eles biparam o motorista errado"): o
  // motorista atual precisa vir pré-selecionado no campo editável.
  assert.equal(document.getElementById('rebtedit-motorista').value, 'm-carlos');

  // Corrige o que faltou: volume, nota e o motorista bipado errado.
  document.getElementById('rebt-edit-completo-volumes').value = '25';
  document.getElementById('rebt-nf-editar-numero').value = '999888';
  window.adicionarNotaFiscalTransbordo('editar');
  document.getElementById('rebtedit-motorista').value = 'm-joao';

  await window.recbtSalvarEdicaoCompleta();

  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.volumes, 25);
  assert.equal(doc.notaFiscalTransferencia, '999888');
  assert.equal(doc.status, 'FINALIZADO'); // continuou finalizado, os horários não mudaram
  assert.equal(doc.motoristaId, 'm-joao');
  assert.equal(doc.motoristaNome, 'João');
  assert.equal(doc.transportadora, 'Transp. B');
  // Nada dos campos fora do que a regra do Firestore libera pra
  // 'corrigir-horario' pode entrar no update — senão a regra recusa a
  // escrita de verdade em produção mesmo passando no mock daqui.
  const CAMPOS_PERMITIDOS = new Set(['status','horaChegada','horaInicioDescarga','horaFimDescarga','horaFechamentoRecebimento','horaSaida','tempoViagemMin','tempoEsperaMin','tempoDescargaMin','tempoTotalMin','tempoAteFechamentoMin','atualizadoEm','atualizadoPor','notaFiscalTransferencia','notasVolumesTransferencia','volumes','notaFiscalConfirmadaEm','notaFiscalConfirmadaPor','motoristaId','motoristaNome','transportadora']);
  const fs = require('fs'), path = require('path');
  const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8');
  const trecho = rules.slice(rules.indexOf("hasAny(['corrigir-horario'])"), rules.indexOf("hasAny(['corrigir-horario'])") + 1200);
  const camposDaRegra = trecho.match(/affectedKeys\(\)\.hasOnly\(\[([^\]]+)\]\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(new Set(camposDaRegra), CAMPOS_PERMITIDOS, 'lista de campos da regra mudou — atualize este teste E confirme que o payload de recbtSalvarEdicaoCompleta ainda cabe nela');
});
