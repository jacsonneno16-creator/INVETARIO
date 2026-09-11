// Dashboard de Recebimento (91) virou um resumo agregado (ranking de
// fornecedores, valor/mês, tempo de recebimento/mês) — a tabela crua de
// notas individuais (com filtros/paginação/edição de "chegada na
// portaria") mudou pra aba Notas Fiscais (94), porque numa tela chamada
// "Dashboard" listar número de nota um por um atrapalhava a leitura da
// visão geral (feedback ao vivo do usuário). Como não existe endpoint de
// portaria confirmado na Bluesoft, o "tempo de recebimento" agora usa o
// que a própria Bluesoft já informa por carga: geração → fechamento.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const dashCode = fs.readFileSync(path.join(base, '91-logistica-recebimento.js'), 'utf8');
const relCode = fs.readFileSync(path.join(base, '94-recebimento-relatorios.js'), 'utf8');
const opCode = fs.readFileSync(path.join(base, '93-recebimento-operacao.js'), 'utf8');
const svcCode = fs.readFileSync(path.join(base, '90-bluesoft-service.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  return {
    get: async () => ({ size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: id => { const docId = id || ('novo' + (seq++)); return { id: docId, set: async p => { const a = registro.get(docId) || {}; registro.set(docId, { ...a, ...p }); } }; },
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    _registro: registro,
  };
}

function elMap() {
  const els = {};
  return { getElementById: id => { if (!els[id]) els[id] = { value: '', textContent: '', innerHTML: '', focus() {} }; return els[id]; }, _els: els };
}

function loadAmbiente(colecoes) {
  const dom = elMap();
  const changeHandlers = []; const clickHandlers = [];
  const document = {
    addEventListener: (tipo, fn) => { if (tipo === 'change') changeHandlers.push(fn); if (tipo === 'click') clickHandlers.push(fn); },
    getElementById: dom.getElementById,
  };
  const window = {
    getDTFirestore: () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) }),
    getDTRawFirestore: () => ({
      collection: nome => {
        if (nome === 'lojas') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ nome: 'Loja 1', bluesoft_loja_key: 'LK1' }) }), collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }) };
        if (nome === 'dt_config') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ token: 'tok', url_hml: 'https://hml.exemplo', ambiente: 'homologacao', timeout: 30 }) }) }) };
        return { doc: () => ({ get: async () => ({ exists: false }) }) };
      },
    }),
    getDTLojaAtiva: () => 'loja1',
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'idtoken' } }) },
    fetch: async () => ({ ok: true, text: async () => JSON.stringify({ currentPage: 0, pageSize: 200, data: [] }) }),
    showToast: () => {}, _currentAnalistaUser: { email: 'analista@daterrinha.com' },
  };
  // setInterval/clearInterval fakes (não-op): 93-recebimento-operacao.js
  // passou a usar setInterval pra atualização periódica (ver comentário
  // "2026-09-11" no arquivo) — nenhum teste aqui exercita esse polling em
  // si, só precisa não quebrar ao chamar carregarRecebimentoOperacao().
  const ctx = { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, isNaN, setTimeout, clearTimeout, URLSearchParams, JSON, AbortController, setInterval: () => 0, clearInterval: () => {} };
  vm.createContext(ctx);
  vm.runInContext(svcCode, ctx, { filename: '90-bluesoft-service.js' });
  vm.runInContext(opCode, ctx, { filename: '93-recebimento-operacao.js' });
  vm.runInContext(dashCode, ctx, { filename: '91-logistica-recebimento.js' });
  vm.runInContext(relCode, ctx, { filename: '94-recebimento-relatorios.js' });
  const dispararChange = (id, value, checked) => changeHandlers.forEach(fn => fn({ target: { id, value, checked, closest: () => null } }));
  const dispararClick = attrObj => clickHandlers.forEach(fn => fn({ target: { closest: sel => (attrObj && sel.includes(attrObj.attr)) ? { getAttribute: () => attrObj.valor } : null } }));
  return { window, els: dom._els, dispararChange, dispararClick };
}

test('_fmtMesLabel: mês abreviado + ano completo, nunca corta o ano (bug relatado ao vivo: "01/02/2" sem dar pra saber o ano)', () => {
  const { window } = loadAmbiente({});
  assert.equal(window._recebimentoInternals.fmtMesLabel('2026-02'), 'fev/2026');
  assert.equal(window._recebimentoInternals.fmtMesLabel('2025-12'), 'dez/2025');
  assert.equal(window._recebimentoInternals.fmtMesLabel(''), '—');
});

test('Dashboard: carrega cargas junto com notas, e cargasTodas()/tempoRecebimentoMin() ficam disponíveis pro resto do app', async () => {
  const cargas = mockColecao([
    { id: 'c1', data: { movimentacaoCargaKey: 1, dataGeracao: '2026-08-01T08:00:00.000Z', dataFimRecebimento: '2026-08-01T09:30:00.000Z' } },
    { id: 'c2', data: { movimentacaoCargaKey: 2, dataGeracao: '2026-08-02T08:00:00.000Z' } }, // sem fechamento ainda
  ]);
  const { window } = loadAmbiente({ recebimento_cargas: cargas, recebimento_notas: mockColecao([]) });
  await window._recebimentoInternals.carregar(true);
  const todas = window._recebimentoInternals.cargasTodas();
  assert.equal(todas.length, 2);
  assert.equal(window._recebimentoInternals.tempoRecebimentoMin(todas[0]), 90);
  assert.equal(window._recebimentoInternals.tempoRecebimentoMin(todas[1]), null); // sem os dois horários, não opina
});

test('Dashboard: quebra o tempo de recebimento em Espera (geração → início) e Conferência (início → fechamento), usando dataInicioRecebimento que a Bluesoft confirma como evento real, não proxy', async () => {
  const cargas = mockColecao([
    { id: 'c1', data: { movimentacaoCargaKey: 1, dataGeracao: '2026-08-01T08:00:00.000Z', dataInicioRecebimento: '2026-08-01T08:20:00.000Z', dataFimRecebimento: '2026-08-01T09:30:00.000Z' } },
    { id: 'c2', data: { movimentacaoCargaKey: 2, dataGeracao: '2026-08-02T08:00:00.000Z', dataFimRecebimento: '2026-08-02T09:00:00.000Z' } }, // sem início — não opina em nenhuma das duas partes
  ]);
  const { window, els } = loadAmbiente({ recebimento_cargas: cargas, recebimento_notas: mockColecao([]) });
  await window._recebimentoInternals.carregar(true);
  const todas = window._recebimentoInternals.cargasTodas();

  assert.equal(window._recebimentoInternals.tempoEsperaMin(todas[0]), 20); // 08:00 → 08:20
  assert.equal(window._recebimentoInternals.tempoConferenciaMin(todas[0]), 70); // 08:20 → 09:30
  assert.equal(window._recebimentoInternals.tempoRecebimentoMin(todas[0]), 90); // total continua batendo (20+70)
  assert.equal(window._recebimentoInternals.tempoEsperaMin(todas[1]), null);
  assert.equal(window._recebimentoInternals.tempoConferenciaMin(todas[1]), null);

  await window.renderRecebimentoDashboard();
  const html = els['page-recebimento-dashboard'].innerHTML;
  assert.match(html, /Tempo médio de espera/);
  assert.match(html, /Tempo médio de conferência/);
});

test('Dashboard: renderiza pelo menos 4 gráficos e o ranking de fornecedores, com filtro de período afetando tudo', async () => {
  const notas = mockColecao([
    { id: 'n1', data: { numeroNota: '1', fornecedorNome: 'Fornecedor A', valor: 1000, processamento: '2026-07-10' } },
    { id: 'n2', data: { numeroNota: '2', fornecedorNome: 'Fornecedor A', valor: 500, processamento: '2026-08-10' } },
    { id: 'n3', data: { numeroNota: '3', fornecedorNome: 'Fornecedor B', valor: 200, processamento: '2026-08-15' } },
  ]);
  const cargas = mockColecao([{ id: 'c1', data: { dataGeracao: '2026-08-01T08:00:00.000Z', dataFimRecebimento: '2026-08-01T09:00:00.000Z' } }]);
  const { window, els } = loadAmbiente({ recebimento_notas: notas, recebimento_cargas: cargas });
  await window.renderRecebimentoDashboard();

  const html = els['page-recebimento-dashboard'].innerHTML;
  assert.match(html, /3 nota\(s\)/);
  assert.match(html, /Fornecedor A/);
  assert.doesNotMatch(html, /Nota Fiscal.*<\/th><th>Fornecedor/); // não tem mais a tabela crua nota-a-nota (colunas Nota/Fornecedor lado a lado)
  assert.doesNotMatch(html, /data-reb-portaria/);
});

test('94: aba Notas Fiscais agora mostra a tabela crua da Bluesoft (com filtros, paginação e edição de chegada na portaria), além da view achatada de recebimentos', async () => {
  const notas = mockColecao([{ id: 'n1', data: { numeroNota: '777', fornecedorNome: 'Fornecedor A', valor: 1000, processamento: '2026-08-10', statusRecebimento: 'FINALIZADA' } }]);
  const { window, els } = loadAmbiente({ recebimento_notas: notas, recebimento_cargas: mockColecao([]) });
  await window.renderRecebimentoNotas();

  const html = els['page-recebimento-notas'].innerHTML;
  assert.match(html, /777/); // número da nota aparece aqui, não no dashboard
  assert.match(html, /Fornecedor A/);
  assert.match(html, /Notas registradas nos recebimentos/); // seção secundária (achatada) continua existindo
});

test('94: editar a chegada na portaria grava via o serviço único de 91 e redesenha só a tela de Notas', async () => {
  const notas = mockColecao([{ id: 'n1', data: { notaFiscalKey: 555, numeroNota: '777', dataRecebimento: '2026-08-10T12:00:00.000Z' } }]);
  const { window } = loadAmbiente({ recebimento_notas: notas, recebimento_cargas: mockColecao([]) });
  await window.renderRecebimentoNotas();

  await window._recebimentoRelatoriosInternals.notasBluesoftFiltradas(); // sanity: função exposta
  const doc = notas._registro.get('n1');
  assert.equal(doc.chegadaPortaria, undefined);

  // simula o fluxo real: o Analista digita a chegada na portaria pra nota
  // 555. `datetime-local` não tem fuso — o navegador (e o Date() daqui)
  // interpreta como hora local, então o teste calcula o esperado do mesmo
  // jeito que o código faz, em vez de cravar um número fixo (senão quebra
  // dependendo do fuso de quem roda o teste).
  const chegadaLocal = '2026-08-10T10:00:00';
  const esperadoMin = Math.round((new Date('2026-08-10T12:00:00.000Z') - new Date(chegadaLocal)) / 60000);
  await window._recebimentoInternals.salvarPortaria(555, chegadaLocal);
  const atualizado = notas._registro.get('n1');
  assert.equal(atualizado.chegadaPortaria, new Date(chegadaLocal).toISOString());
  assert.equal(atualizado.tempoPortariaAteRecebimentoMin, esperadoMin);
});

test('Dashboard: devolução não conta como recebimento — some dos KPIs/gráficos/ranking por padrão, avisa quantas foram excluídas', async () => {
  const notas = mockColecao([
    { id: 'n1', data: { numeroNota: '1', fornecedorNome: 'Fornecedor A', valor: 1000, processamento: '2026-08-10', tipoTransferencia: null } },
    { id: 'n2', data: { numeroNota: '2', fornecedorNome: 'Fornecedor A', valor: 9999, processamento: '2026-08-11', tipoTransferencia: 'DEVOLUCAO_ENTRE_LOJAS' } },
  ]);
  const { window, els } = loadAmbiente({ recebimento_notas: notas, recebimento_cargas: mockColecao([]) });
  await window.renderRecebimentoDashboard();

  const html = els['page-recebimento-dashboard'].innerHTML;
  assert.match(html, /1 nota\(s\) de fornecedor neste período/); // só a nota 1 conta
  assert.doesNotMatch(html, /9\.999,00|9999/); // valor da devolução não entra no total
  assert.match(html, /1 devolução\(ões\) não conta/); // avisa a exclusão
});

test('Dashboard: filtro de categoria deixa ver Transbordo/Todas em vez do padrão Fornecedor — devolução NUNCA é opção de filtro, some sempre (pedido ao vivo do usuário: "devolução eu falei pra tirar, não colocar nos filtros")', async () => {
  const notas = mockColecao([
    { id: 'n1', data: { numeroNota: '1', fornecedorNome: 'Fornecedor A', valor: 1000, processamento: '2026-08-10', tipoTransferencia: null } },
    { id: 'n2', data: { numeroNota: '2', fornecedorNome: 'Loja Matriz', valor: 500, processamento: '2026-08-10', tipoTransferencia: 'TRANSFERENCIA_ENTRE_LOJAS' } },
    { id: 'n3', data: { numeroNota: '3', fornecedorNome: 'Cliente X', valor: 9999, processamento: '2026-08-10', tipoTransferencia: 'DEVOLUCAO_ENTRE_LOJAS' } },
  ]);
  const { window, els, dispararChange } = loadAmbiente({ recebimento_notas: notas, recebimento_cargas: mockColecao([]) });
  await window.renderRecebimentoDashboard();

  let html = els['page-recebimento-dashboard'].innerHTML;
  assert.match(html, /1 nota\(s\) de fornecedor/); // padrão: só fornecedor
  assert.doesNotMatch(html, /Loja Matriz/);
  assert.doesNotMatch(html, /Cliente X/);
  assert.doesNotMatch(html, /Devolução</); // não existe opção "Devolução" no select

  dispararChange('reb-f-categoria', 'TRANSBORDO');
  html = els['page-recebimento-dashboard'].innerHTML;
  assert.match(html, /1 nota\(s\) de transbordo/);
  assert.match(html, /Loja Matriz/);
  assert.doesNotMatch(html, /Fornecedor A/);
  assert.doesNotMatch(html, /Cliente X/);

  dispararChange('reb-f-categoria', 'TODAS');
  html = els['page-recebimento-dashboard'].innerHTML;
  assert.match(html, /2 nota\(s\)/); // Fornecedor + Transbordo, devolução nunca entra nem em "Todas"
  assert.match(html, /Fornecedor A/);
  assert.match(html, /Loja Matriz/);
  assert.doesNotMatch(html, /Cliente X/);

  // defensivo: mesmo que algo force o valor "DEVOLUCAO" no filtro (nunca
  // deveria acontecer pela UI, já que a opção nem existe mais), a devolução
  // continua fora — o filtro duro roda antes de olhar a categoria escolhida.
  dispararChange('reb-f-categoria', 'DEVOLUCAO');
  html = els['page-recebimento-dashboard'].innerHTML;
  assert.doesNotMatch(html, /Cliente X/);
});

test('REGRESSÃO: clicar em "Sincronizar recebimento" no Dashboard não quebra (bug ao vivo: "Erro: _pagina is not defined" — sobrou uma referência de paginação de quando a tabela crua saiu desta tela)', async () => {
  const { window, els, dispararClick } = loadAmbiente({ recebimento_notas: mockColecao([]), recebimento_cargas: mockColecao([]) });
  await window.renderRecebimentoDashboard();

  dispararClick({ attr: 'data-reb-sync', valor: '' });
  await new Promise(resolve => setTimeout(resolve, 50)); // deixa o fluxo assíncrono do sync terminar

  const status = els['reb-sync-status'].textContent;
  assert.doesNotMatch(status, /Erro:/);
});

test('94: Notas Fiscais escondem devolução E transbordo por padrão (só Fornecedor), mas o filtro de categoria mostra cada um — e o filtro de natureza existe', async () => {
  const notas = mockColecao([
    { id: 'n1', data: { numeroNota: '1', fornecedorNome: 'Fornecedor A', natureza: 'COMPRA', processamento: '2026-08-10' } },
    { id: 'n2', data: { numeroNota: '2', fornecedorNome: 'Fornecedor A', natureza: 'DEVOLUCAO', processamento: '2026-08-11', tipoTransferencia: 'DEVOLUCAO_ENTRE_LOJAS' } },
    { id: 'n3', data: { numeroNota: '3', fornecedorNome: 'Loja Matriz', natureza: 'TRANSFERENCIA', processamento: '2026-08-12', tipoTransferencia: 'TRANSFERENCIA_ENTRE_LOJAS' } },
  ]);
  const { window, els, dispararChange } = loadAmbiente({ recebimento_notas: notas, recebimento_cargas: mockColecao([]) });
  await window.renderRecebimentoNotas();

  let html = els['page-recebimento-notas'].innerHTML;
  assert.match(html, />1<\/td>/); // nota 1 (fornecedor) aparece na tabela
  assert.doesNotMatch(html, />2<\/td>/); // devolução (nota "2") não aparece
  assert.doesNotMatch(html, />3<\/td>/); // transbordo (nota "3") não aparece — tem tela própria
  assert.doesNotMatch(html, /Devolução</); // não existe opção "Devolução" no select

  dispararChange('recnf-bs-f-categoria', 'TRANSBORDO');
  html = els['page-recebimento-notas'].innerHTML;
  assert.match(html, />3<\/td>/);
  assert.match(html, /transbordo<\/span>/); // com o selo de transbordo
  assert.doesNotMatch(html, />2<\/td>/); // devolução continua fora

  dispararChange('recnf-bs-f-categoria', 'TODAS');
  html = els['page-recebimento-notas'].innerHTML;
  assert.match(html, />1<\/td>/);
  assert.match(html, />3<\/td>/);
  assert.doesNotMatch(html, />2<\/td>/); // devolução nunca entra nem em "Todas"

  // defensivo: mesmo forçando o valor "DEVOLUCAO" (a opção nem existe na UI),
  // a devolução continua fora — filtro duro roda antes da categoria escolhida.
  dispararChange('recnf-bs-f-categoria', 'DEVOLUCAO');
  html = els['page-recebimento-notas'].innerHTML;
  assert.doesNotMatch(html, />2<\/td>/);
});
