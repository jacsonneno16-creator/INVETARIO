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
const htmlCode = fs.readFileSync(path.join(__dirname, '../analista.html'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const base = {
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
  // Usado por _carregarTodosTransbordos() (95-recebimento-transbordo.js) —
  // `.where('tipo','==','TRANSBORDO')` por loja, mesmo padrão de mock
  // encadeável já usado nos testes de Recebimento desta sessão.
  base.where = (campo, op, valor) => {
    const construir = condicoesAtuais => ({
      where: (c2, o2, v2) => construir([...condicoesAtuais, { campo: c2, op: o2, valor: v2 }]),
      get: async () => {
        const bate = data => condicoesAtuais.every(c => {
          const v = data ? data[c.campo] : undefined;
          if (c.op === '==') return v === c.valor;
          return true;
        });
        return { docs: [...registro.entries()].filter(([, data]) => bate(data)).map(([id, data]) => ({ id, data: () => data })) };
      },
    });
    return construir([{ campo, op, valor }]);
  };
  return base;
}
// Mock de `getDTRawFirestore().collection('lojas')` — `.doc(lojaId).collection(sub)`
// usado por recbtSalvar()/recbtSalvarEdicaoCompleta() (escrita crua, mesmo
// padrão de recbtSalvarRota() já existente no arquivo real); `.get()` na
// raiz usado por _carregarTodosTransbordos() pra listar as lojas ativas
// (mesmo padrão de 104-recebimento-cargas-cards.js).
function mockRawLojas(porLoja, lojasMeta) {
  const metas = lojasMeta || Object.keys(porLoja).map(id => ({ id, nome: id }));
  return {
    collection: nome => {
      if (nome !== 'lojas') return mockColecao([]);
      return {
        doc: lojaId => ({ collection: sub => (porLoja[lojaId] && porLoja[lojaId][sub]) || mockColecao([]) }),
        get: async () => ({ docs: metas.map(m => ({ id: m.id, data: () => m })) }),
      };
    },
  };
}

// Migrado pra jsdom de verdade (era um objeto document mockado à mão, sem
// querySelector) — a tela ganhou _vincularBotoesCriticosTransbordo()
// (sessão seguinte: liga "+ Novo Transbordo"/"⇄ Inverter lojas" direto no
// elemento via querySelector, não mais só por delegação), que essa suíte
// não sustentava. Mesma lição já aplicada nos testes do Coletor.
// PEDIDO AO VIVO (2026-09-11): 93-recebimento-operacao.js passou a usar
// setInterval (polling de 45s em vez de onSnapshot — ver comentário
// "2026-09-11" no arquivo), disparado no fim de carregarRecebimentoOperacao()
// — que esta suíte chama em quase todo teste. Sem fechar a janela, cada
// teste deixava pra trás um timer de verdade rodando (nunca se limpa
// sozinho), acumulando um por teste. Mesmo cuidado já usado em outras
// suítes com timer real (ex.: analista-recebimento-patio-tempo-real.test.js).
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function loadTransbordo(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-transbordo"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _janelasAbertas.push(win);
  const document = win.document;
  const els = new Proxy({}, { get: (_, id) => document.getElementById(id) });
  win.getDTFirestore = () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) });
  // Mesma loja nos dois lados por padrão (93 tagueia _lojaId pela loja
  // ATIVA; _carregarTodosTransbordos tagueia pelo id de cada loja
  // percorrida) — sem isso os dois "achavam" o mesmo registro com
  // _lojaId diferente ('' vs 'loja_matriz') e o dedup de transbordos()
  // não os via como duplicata, contando o mesmo registro 2x.
  win.getDTLojaAtiva = () => 'loja_matriz';
  // _carregarTodosTransbordos() (95-recebimento-transbordo.js) sempre busca
  // TODAS as lojas — padrão default aqui é 1 loja só ('loja_matriz'),
  // reaproveitando o MESMO mock de `recebimentos` que os testes já passam
  // em `colecoes` (assim os testes simples de 1 loja continuam vendo os
  // registros deles na listagem sem precisar saber desse detalhe). Testes
  // que precisam mesmo de multi-loja de verdade sobrescrevem
  // `win.getDTRawFirestore` depois de chamar loadTransbordo(), como já
  // faziam pra testar escrita cross-loja.
  win.getDTRawFirestore = () => mockRawLojas(
    { loja_matriz: { recebimentos: colecoes?.recebimentos || mockColecao([]) } },
    [{ id: 'loja_matriz', nome: 'Matriz', ativa: true }]
  );
  win.openModal = () => {}; win.closeModal = () => {}; win.showToast = () => {};
  win.showConfirm = (msg, exec) => exec();
  // PEDIDO AO VIVO (2026-09-11): _carregarTodosTransbordos() passou a
  // buscar via Cloud Function (buscarTransbordoTodasLojasBigQuery) em vez
  // de 1 leitura por loja direto no Firestore — o mock abaixo reaproveita
  // o MESMO win.getDTRawFirestore() já configurado acima (lojas + suas
  // subcoleções `recebimentos`), filtrando por tipo=TRANSBORDO igual à
  // função real, devolvendo {_id, _lojaId, ...dados}.
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nomeFuncao => async () => {
    if (nomeFuncao !== 'buscarTransbordoTodasLojasBigQuery') throw new Error('função não mockada: ' + nomeFuncao);
    const rawFs = win.getDTRawFirestore();
    const lojasSnap = await rawFs.collection('lojas').get();
    const ativas = lojasSnap.docs.map(d => d.data()).filter(l => l.ativa !== false);
    const porLoja = await Promise.all(ativas.map(loja =>
      rawFs.collection('lojas').doc(loja.id).collection('recebimentos').where('tipo', '==', 'TRANSBORDO').get().catch(() => ({ docs: [] }))
    ));
    const transbordos = [];
    porLoja.forEach((snap, i) => snap.docs.forEach(d => transbordos.push({ _id: d.id, _lojaId: ativas[i].id, ...d.data() })));
    return { data: { transbordos } };
  } }) }) };
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
  await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

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

  // BUG AO VIVO REAL (2026-09-08): "quando vou colocar a data quando chega
  // no ano ele para e da só para colocar o 2" — o `change` do `<input
  // type="date">` agora é debounced (600ms) antes de redesenhar a tela, pra
  // não recriar o próprio `<input>` no meio da digitação do ano (ver
  // comentário no listener). O teste espera essa pausa antes de conferir.
  const esperarDebounce = () => new Promise(r => setTimeout(r, 650));

  // intervalo livre (não é "o mês inteiro") — só o dia 10, o resto de fora
  dispararChange('rebt-f-data-inicio', '2026-08-10');
  dispararChange('rebt-f-data-fim', '2026-08-10');
  await esperarDebounce();
  let html = els['page-recebimento-transbordo'].innerHTML;
  assert.match(html, /1 transbordo\(s\)/);
  assert.match(html, /TRB-AGO-10/);
  assert.doesNotMatch(html, /TRB-AGO-20/);
  assert.doesNotMatch(html, /TRB-JUL/);

  // intervalo de uma semana cobrindo os dois de agosto, mas não julho
  dispararChange('rebt-f-data-inicio', '2026-08-05');
  dispararChange('rebt-f-data-fim', '2026-08-25');
  await esperarDebounce();
  html = els['page-recebimento-transbordo'].innerHTML;
  assert.match(html, /2 transbordo\(s\)/);
  assert.match(html, /TRB-AGO-10/);
  assert.match(html, /TRB-AGO-20/);
  assert.doesNotMatch(html, /TRB-JUL/);

  // só a data de início, sem fim — sem limite pra frente
  dispararChange('rebt-f-data-inicio', '2026-08-01');
  dispararChange('rebt-f-data-fim', '');
  await esperarDebounce();
  html = els['page-recebimento-transbordo'].innerHTML;
  assert.match(html, /2 transbordo\(s\)/);
  assert.doesNotMatch(html, /TRB-JUL/);
});

// BUG AO VIVO REAL (2026-09-08): mesmo bug acima — garante especificamente
// que uma sequência RÁPIDA de `change` (simulando dígito por dígito no ano)
// não recria o `<input>` a cada evento: só 1 redesenho no final, e o valor
// final digitado é respeitado (não trava no primeiro dígito).
test('filtro de data: sequência rápida de mudanças (digitação) NÃO redesenha a cada evento — só depois de uma pausa, com o valor final', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: { tipo: 'TRANSBORDO', status: 'FINALIZADO', identificadorCodigo: 'TRB-AGO-10', horaSaida: '2026-08-10T06:00:00.000Z', tempoTotalMin: 60 } },
  ]);
  const { window, els, dispararChange } = loadTransbordo({ recebimentos });
  await window.renderRecebimentoTransbordo();

  const pagina = els['page-recebimento-transbordo'];
  let contagemRedesenhos = 0;
  const observer = new window.MutationObserver(() => { contagemRedesenhos++; });
  observer.observe(pagina, { childList: true });

  // Simula o navegador disparando `change` a cada dígito digitado no ano
  // (0002 -> 0020 -> 0202 -> 2026), como o bug real relatado.
  dispararChange('rebt-f-data-fim', '0002-08-31');
  dispararChange('rebt-f-data-fim', '0020-08-31');
  dispararChange('rebt-f-data-fim', '0202-08-31');
  dispararChange('rebt-f-data-fim', '2026-08-31');
  assert.equal(contagemRedesenhos, 0, 'não pode redesenhar (recriar o <input>) no meio da digitação');

  await new Promise(r => setTimeout(r, 650));
  assert.equal(contagemRedesenhos, 1, 'só 1 redesenho, depois da pausa');
  const html = pagina.innerHTML;
  assert.match(html, /TRB-AGO-10/, 'valor final (2026) é o que vale, não o primeiro dígito');
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

  // Shell-first (2026-09-10): cada render agora desenha 2x (estrutura
  // imediata com o que já tem em cache + de novo quando o fetch resolve),
  // então uma única chamada já gera mais de um ciclo criar/destruir — a
  // sequência exata de eventos deixou de ser previsível. O que realmente
  // importa pra não vazar instância: em qualquer momento, o saldo
  // (criações vivas − destruições) nunca fica negativo, e termina em
  // exatamente 2 (bar + doughnut) depois de cada chamada — nunca sobra
  // nem falta instância.
  function saldoNaoNegativoETerminaEm2(lista) {
    let saldo = 0;
    for (const evento of lista) {
      saldo += evento.startsWith('criado') ? 1 : -1;
      assert.ok(saldo >= 0, 'destruiu mais do que criou em algum momento — instância inexistente sendo destruída');
    }
    assert.equal(saldo, 2, 'tem que sobrar exatamente os 2 gráficos do desenho mais recente, nem mais nem menos');
  }

  await window.renderRecebimentoTransbordo();
  saldoNaoNegativoETerminaEm2(instancias);

  await window.renderRecebimentoTransbordo(); // redesenha
  saldoNaoNegativoETerminaEm2(instancias);
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
  const { window, document, dispararClick } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]), recebimento_motoristas: mockColecao([]), recebimento_veiculos: mockColecao([]), recebimento_rotas_transbordo: mockColecao([]) });
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTRawFirestore = () => mockRawLojas({ loja_matriz: { recebimentos, recebimento_identificadores: identificadores } });
  window.DTLoja = { listar: async () => [{ id: 'loja_matriz', nome: 'Matriz', ativa: true }, { id: 'loja_filial', nome: 'Filial', ativa: true }] };

  await window.recbtNovo();
  document.getElementById('rebt-origem').value = 'loja_matriz';
  document.getElementById('rebt-destino').value = 'loja_filial';
  // Nota Fiscal + Volume por nota (mesmo modelo do Coletor) — primeira
  // linha já vem pronta, "+ Adicionar nota" cria a segunda.
  document.getElementById('rebt-nf-novo-lista').querySelector('[data-nfv-input="0"]').value = '111';
  document.getElementById('rebt-nf-novo-lista').querySelector('[data-nfv-volume="0"]').value = '6';
  dispararClick('[data-rebtnfv-add="novo"]');
  document.getElementById('rebt-nf-novo-lista').querySelector('[data-nfv-input="1"]').value = '222';
  document.getElementById('rebt-nf-novo-lista').querySelector('[data-nfv-volume="1"]').value = '4';
  assert.equal(document.getElementById('rebt-nf-novo-lista').querySelector('[data-nfv-input="0"]').value, '111');
  assert.equal(document.getElementById('rebt-nf-novo-lista').querySelector('[data-nfv-input="1"]').value, '222');
  // Horário de saída digitado em DOIS campos (data + hora), não mais um datetime-local só.
  document.getElementById('rebt-hora-saida-data').value = '2026-08-18';
  document.getElementById('rebt-hora-saida-hora').value = '14:30';

  await window.recbtSalvar();

  assert.equal(recebimentos._registro.size, 1);
  const doc = [...recebimentos._registro.values()][0];
  assert.equal(doc.notaFiscalTransferencia, '111, 222'); // as duas notas, juntas
  assert.equal(doc.volumes, 10); // soma dos volumes de cada nota (6 + 4)
  assert.equal(doc.notasVolumesTransferencia.length, 2);
  assert.equal(doc.notasVolumesTransferencia[0].numero, '111');
  assert.equal(doc.notasVolumesTransferencia[0].volumes, 6);
  assert.equal(doc.notasVolumesTransferencia[1].numero, '222');
  assert.equal(doc.notasVolumesTransferencia[1].volumes, 4);
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
  await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  await window.recbtAbrirEdicaoCompleta('r1');

  // Abriu mostrando os horários já salvos, cada um separado em data+hora.
  assert.equal(document.getElementById('rebtedit-hora-saida-data').value, '2026-08-17');
  assert.equal(document.getElementById('rebtedit-hora-fechamento-data').value, '2026-08-17');
  // Volume que já existia (0) aparece na primeira linha da grade NF+Volume.
  assert.equal(document.getElementById('rebt-nf-editar-lista').querySelector('[data-nfv-volume="0"]').value, '0');
  // PEDIDO AO VIVO ("eu consigo ajustar tudo, menos troca o motorista que
  // veio, quando saiu de um lugar eles biparam o motorista errado"): o
  // motorista atual precisa vir pré-selecionado no campo editável.
  assert.equal(document.getElementById('rebtedit-motorista').value, 'm-carlos');

  // Corrige o que faltou: volume+nota (juntos na mesma linha, igual no
  // Coletor) e o motorista bipado errado.
  document.getElementById('rebt-nf-editar-lista').querySelector('[data-nfv-input="0"]').value = '999888';
  document.getElementById('rebt-nf-editar-lista').querySelector('[data-nfv-volume="0"]').value = '25';
  document.getElementById('rebtedit-motorista').value = 'm-joao';

  await window.recbtSalvarEdicaoCompleta();

  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.volumes, 25);
  assert.equal(doc.notaFiscalTransferencia, '999888');
  assert.equal(doc.notasVolumesTransferencia.length, 1);
  assert.equal(doc.notasVolumesTransferencia[0].numero, '999888');
  assert.equal(doc.notasVolumesTransferencia[0].volumes, 25);
  assert.equal(doc.status, 'FINALIZADO'); // continuou finalizado, os horários não mudaram
  assert.equal(doc.motoristaId, 'm-joao');
  assert.equal(doc.motoristaNome, 'João');
  assert.equal(doc.transportadora, 'Transp. B');
  // Nada dos campos fora do que a regra do Firestore libera pra
  // 'corrigir-horario' pode entrar no update — senão a regra recusa a
  // escrita de verdade em produção mesmo passando no mock daqui.
  const CAMPOS_PERMITIDOS = new Set(['status','horaChegada','horaInicioDescarga','horaFimDescarga','horaFechamentoRecebimento','horaSaida','tempoViagemMin','tempoEsperaMin','tempoDescargaMin','tempoTotalMin','tempoAteFechamentoMin','atualizadoEm','atualizadoPor','notaFiscalTransferencia','notasVolumesTransferencia','volumes','notaFiscalConfirmadaEm','notaFiscalConfirmadaPor','motoristaId','motoristaNome','transportadora','identificadorCodigo']);
  const fs = require('fs'), path = require('path');
  const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8');
  const trecho = rules.slice(rules.indexOf("hasAny(['corrigir-horario'])"), rules.indexOf("hasAny(['corrigir-horario'])") + 1200);
  const camposDaRegra = trecho.match(/affectedKeys\(\)\.hasOnly\(\[([^\]]+)\]\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(new Set(camposDaRegra), CAMPOS_PERMITIDOS, 'lista de campos da regra mudou — atualize este teste E confirme que o payload de recbtSalvarEdicaoCompleta ainda cabe nela');
});

// BUG AO VIVO REAL (usuário: "toda vez que eu edito alguma informação o
// motorista some, e também não consigo trocar o motorista caso colocaram
// errado") — causa: a lista do <select> só traz motorista ATIVO
// (opInternals().motoristas() filtra ativo!==false). Se o motorista já
// gravado na carga foi desativado depois, o campo abria em branco (sem
// nenhuma <option> batendo com motoristaId) e salvar assim apagava
// motoristaNome mesmo sem o usuário ter tocado no campo.
test('BUG AO VIVO REAL: motorista desativado no cadastro continua aparecendo pré-selecionado ao editar (não some) e não é apagado ao salvar sem mexer nele', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: {
      tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origem: 'Matriz', destino: 'Filial',
      motoristaId: 'm-carlos', motoristaNome: 'Carlos', placa: 'ABC1D23', volumes: 10,
      horaSaida: '2026-08-17T09:00:00.000Z',
    } },
  ]);
  // 'm-carlos' foi desativado no cadastro DEPOIS de já estar na carga —
  // opInternals().motoristas() não traz mais ele na lista.
  const motoristas = mockColecao([
    { id: 'm-carlos', data: { nome: 'Carlos', transportadora: 'Transp. A', ativo: false } },
    { id: 'm-joao', data: { nome: 'João', transportadora: 'Transp. B' } },
  ]);
  const { window, document } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]), recebimento_motoristas: motoristas, recebimento_veiculos: mockColecao([]) });
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTRawFirestore = () => mockRawLojas({ loja_matriz: { recebimentos, recebimento_auditoria: mockColecao([]) } });
  await window._recebimentoOperacaoInternals.carregar(true);
  await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  await window.recbtAbrirEdicaoCompleta('r1');
  assert.equal(document.getElementById('rebtedit-motorista').value, 'm-carlos', 'motorista desativado precisa continuar pré-selecionado, não em branco');
  assert.match(document.getElementById('rebtedit-motorista').innerHTML, /Carlos/, 'nome do motorista desativado precisa aparecer na lista, não só o id');

  // Edita só o volume — não mexe no motorista.
  document.getElementById('rebt-nf-editar-lista').querySelector('[data-nfv-volume="0"]').value = '15';
  await window.recbtSalvarEdicaoCompleta();

  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.volumes, 15);
  assert.equal(doc.motoristaId, 'm-carlos', 'motoristaId não pode sumir só por editar outro campo');
  assert.equal(doc.motoristaNome, 'Carlos', 'motoristaNome não pode ser apagado — era exatamente o "some ao editar" relatado');
});

test('mesmo com o motorista antigo desativado, ainda dá pra trocar pra um motorista ativo diferente', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: {
      tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origem: 'Matriz', destino: 'Filial',
      motoristaId: 'm-carlos', motoristaNome: 'Carlos', placa: 'ABC1D23', volumes: 10,
    } },
  ]);
  const motoristas = mockColecao([
    { id: 'm-carlos', data: { nome: 'Carlos', transportadora: 'Transp. A', ativo: false } },
    { id: 'm-joao', data: { nome: 'João', transportadora: 'Transp. B' } },
  ]);
  const { window, document } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]), recebimento_motoristas: motoristas, recebimento_veiculos: mockColecao([]) });
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTRawFirestore = () => mockRawLojas({ loja_matriz: { recebimentos, recebimento_auditoria: mockColecao([]) } });
  await window._recebimentoOperacaoInternals.carregar(true);
  await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  await window.recbtAbrirEdicaoCompleta('r1');
  document.getElementById('rebtedit-motorista').value = 'm-joao';
  await window.recbtSalvarEdicaoCompleta();

  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.motoristaId, 'm-joao');
  assert.equal(doc.motoristaNome, 'João');
  assert.equal(doc.transportadora, 'Transp. B');
});

// BUG AO VIVO REAL (2ª rodada — usuário continuou vendo "o motorista some
// depois de editar"): registros mais antigos podem ter motoristaNome
// preenchido SEM motoristaId (campo entrou depois na gravação). A correção
// anterior só cobria "motoristaId existe mas o cadastro dele foi
// desativado" — aqui motoristaId nem existe, então a condição antiga nunca
// disparava e o <select> abria em branco; salvar sem mexer em nada apagava
// motoristaNome.
test('BUG AO VIVO REAL: carga antiga com motoristaNome mas SEM motoristaId continua mostrando o motorista ao editar, e não apaga o nome ao salvar sem mexer nele', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: {
      tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origem: 'Matriz', destino: 'Filial',
      motoristaNome: 'Carlos', placa: 'ABC1D23', volumes: 10, // sem motoristaId — registro antigo
      horaSaida: '2026-08-17T09:00:00.000Z',
    } },
  ]);
  const motoristas = mockColecao([{ id: 'm-carlos', data: { nome: 'Carlos', transportadora: 'Transp. A' } }]);
  const { window, document } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]), recebimento_motoristas: motoristas, recebimento_veiculos: mockColecao([]) });
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTRawFirestore = () => mockRawLojas({ loja_matriz: { recebimentos, recebimento_auditoria: mockColecao([]) } });
  await window._recebimentoOperacaoInternals.carregar(true);
  await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  await window.recbtAbrirEdicaoCompleta('r1');
  assert.equal(document.getElementById('rebtedit-motorista').value, '__atual__', 'sem motoristaId pra casar, a opção precisa preservar o nome já salvo');
  assert.match(document.getElementById('rebtedit-motorista').innerHTML, /Carlos/, 'nome do motorista precisa aparecer mesmo sem id cadastrado na carga');

  // Edita só o volume — não mexe no motorista.
  document.getElementById('rebt-nf-editar-lista').querySelector('[data-nfv-volume="0"]').value = '20';
  await window.recbtSalvarEdicaoCompleta();

  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.volumes, 20);
  assert.equal(doc.motoristaNome, 'Carlos', 'motoristaNome não pode ser apagado só por editar outro campo, mesmo sem motoristaId original');
});

// PEDIDO AO VIVO (2026-09-08): "quando mudar o nome do motorista tem que
// trazer automaticamente o código do motorista escolhido" — o código
// mostrado na coluna "Carga" (identificadorCodigo, ex.: MOT-...) é o QR
// fixo do motorista; trocar o motorista sem atualizar esse código deixava a
// carga com o código do motorista ERRADO mesmo depois do nome corrigido.
test('trocar o motorista na edição atualiza identificadorCodigo pro código do motorista NOVO', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: {
      tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origem: 'Matriz', destino: 'Filial',
      motoristaId: 'm-carlos', motoristaNome: 'Carlos', identificadorCodigo: 'MOT-CARLOS-CODIGO',
      placa: 'ABC1D23', volumes: 10,
    } },
  ]);
  const motoristas = mockColecao([
    { id: 'm-carlos', data: { nome: 'Carlos', codigo: 'MOT-CARLOS-CODIGO', transportadora: 'Transp. A' } },
    { id: 'm-joao', data: { nome: 'João', codigo: 'MOT-JOAO-CODIGO', transportadora: 'Transp. B' } },
  ]);
  const { window, document } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]), recebimento_motoristas: motoristas, recebimento_veiculos: mockColecao([]) });
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTRawFirestore = () => mockRawLojas({ loja_matriz: { recebimentos, recebimento_auditoria: mockColecao([]) } });
  await window._recebimentoOperacaoInternals.carregar(true);
  await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  await window.recbtAbrirEdicaoCompleta('r1');
  document.getElementById('rebtedit-motorista').value = 'm-joao';
  await window.recbtSalvarEdicaoCompleta();

  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.motoristaNome, 'João');
  assert.equal(doc.identificadorCodigo, 'MOT-JOAO-CODIGO', 'código da carga tem que virar o do motorista NOVO');
});

test('editar SEM trocar o motorista preserva identificadorCodigo original — não sobrescreve com nada', async () => {
  const recebimentos = mockColecao([
    { id: 'r1', data: {
      tipo: 'TRANSBORDO', status: 'EM_TRANSITO', origem: 'Matriz', destino: 'Filial',
      motoristaId: 'm-carlos', motoristaNome: 'Carlos', identificadorCodigo: 'MOT-CARLOS-CODIGO',
      placa: 'ABC1D23', volumes: 10,
    } },
  ]);
  const motoristas = mockColecao([{ id: 'm-carlos', data: { nome: 'Carlos', codigo: 'MOT-CARLOS-CODIGO', transportadora: 'Transp. A' } }]);
  const { window, document } = loadTransbordo({ recebimentos, recebimento_auditoria: mockColecao([]), recebimento_motoristas: motoristas, recebimento_veiculos: mockColecao([]) });
  window.getDTLojaAtiva = () => 'loja_matriz';
  window.getDTRawFirestore = () => mockRawLojas({ loja_matriz: { recebimentos, recebimento_auditoria: mockColecao([]) } });
  await window._recebimentoOperacaoInternals.carregar(true);
  await window._recebimentoTransbordoInternals.carregarTodosTransbordos(true);

  await window.recbtAbrirEdicaoCompleta('r1');
  // Não mexe no <select> — edita só o volume.
  document.getElementById('rebt-nf-editar-lista').querySelector('[data-nfv-volume="0"]').value = '15';
  await window.recbtSalvarEdicaoCompleta();

  const doc = recebimentos._registro.get('r1');
  assert.equal(doc.identificadorCodigo, 'MOT-CARLOS-CODIGO', 'sem trocar o motorista, o código da carga não pode mudar');
});

// BUG AO VIVO REAL (2026-09-08, 3ª rodada — a causa raiz de verdade):
// "quando eu edito alguma coisa o motorista some, e quando clico em editar
// eu não consigo escolher um nome de motorista". As 3 rodadas anteriores
// (testes acima) cobrem a LÓGICA de `recbtAbrirEdicaoCompleta`/
// `recbtSalvarEdicaoCompleta` e sempre passaram — porque o harness delas
// (`loadTransbordo`, mais abaixo) monta um DOM limpo, sem o HTML real de
// `analista.html`. Só investigando com um print real da tela é que apareceu:
// `analista.html` tinha um modal ESTÁTICO antigo com
// `id="modal-rebt-editar-completo"` (sem campo Motorista nenhum, de antes
// dessa funcionalidade existir). `_ensureEdicaoCompletaModal()` só cria o
// modal dinamicamente SE `#modal-rebt-editar-completo` ainda não existir no
// DOM — como o estático antigo sempre "ganhava" primeiro (carregado direto
// no HTML, antes de qualquer JS rodar), a versão certa e testada nunca era
// criada. Sem `#rebtedit-motorista` no DOM de verdade,
// `recbtSalvarEdicaoCompleta()` lia `null` e gravava motorista vazio em
// QUALQUER edição — em produção, não nos testes. Removido o bloco estático;
// este teste garante que ele não volta.
test('REGRESSÃO: analista.html não tem um modal ESTÁTICO duplicado de "Editar Transbordo" — só o dinâmico (com Motorista) de _ensureEdicaoCompletaModal pode existir, senão ele nunca é criado', () => {
  assert.doesNotMatch(htmlCode, /id="modal-rebt-editar-completo"/, 'um modal estático com esse id no HTML impede _ensureEdicaoCompletaModal() de criar a versão certa (com o campo Motorista)');
});
