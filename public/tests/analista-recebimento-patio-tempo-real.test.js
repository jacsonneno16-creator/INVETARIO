// Pátio em Tempo Real (105-recebimento-patio-tempo-real.js) — saldo FÍSICO
// atual de notas de Recusa/Reentrega paradas no pátio. Ver plano completo
// em structured-sprouting-hoare.md.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const patioCode = fs.readFileSync(path.join(base, '105-recebimento-patio-tempo-real.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  const base = {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: id => ({
      id,
      get: async () => ({ id, exists: registro.has(id), data: () => registro.get(id) }),
      set: async p => { const a = registro.get(id) || {}; registro.set(id, { ...a, ...p }); },
      update: async p => { const a = registro.get(id); if (a === undefined) throw new Error('NOT_FOUND'); registro.set(id, { ...a, ...p }); },
    }),
    _registro: registro,
  };
  base.where = (campo, op, valor) => {
    const get = async () => {
      // PEDIDO AO VIVO (2026-09-11): _enriquecerComNotas passou a buscar
      // por lote via FieldPath.documentId() 'in' — mock replica isso pra
      // não quebrar quando `campo` é o sentinel de documentId.
      if (campo && campo.__isDocumentIdSentinel && op === 'in') {
        return { docs: [...registro.entries()].filter(([id]) => valor.includes(id)).map(([id, data]) => ({ id, data: () => data })) };
      }
      const bate = data => { const v = data ? data[campo] : undefined; return op === '==' ? v === valor : true; };
      return { docs: [...registro.entries()].filter(([, data]) => bate(data)).map(([id, data]) => ({ id, data: () => data })) };
    };
    // PEDIDO AO VIVO (2026-09-11): buscarMercadoFaltante() usa
    // .where('numeroNota','==',n).limit(1).get() — encadeia igual ao
    // Firestore de verdade, cortando o resultado de `get`.
    return { get, limit: n => ({ get: async () => { const r = await get(); return { empty: r.docs.length === 0, docs: r.docs.slice(0, n) }; } }) };
  };
  return base;
}
function mockRawFirestore(colecoes) {
  return {
    batch: () => {
      const ops = [];
      return {
        update: (ref, payload) => ops.push({ ref, payload }),
        commit: async () => { ops.forEach(op => { const col = colecoes.recebimento_recusas; const atual = col._registro.get(op.ref.id) || {}; col._registro.set(op.ref.id, { ...atual, ...op.payload }); }); },
      };
    },
  };
}
// renderPatioTempoReal() agenda um setInterval real de 45s (polling) —
// timer de verdade em jsdom, que segura o processo do `node --test` até
// ser derrubado com window.close() ou o node --test demora ~45s pra sair
// sozinho no fim do arquivo (mesmo cuidado já usado nos testes de
// buscar-bi-automatico/importar-cadastros, que têm o mesmo tipo de timer).
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-patio-tempo-real"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _janelasAbertas.push(win);
  win.getDTFirestore = () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) });
  win.getDTRawFirestore = () => mockRawFirestore(colecoes || {});
  win.getDTLojaAtiva = () => 'loja_matriz';
  // PEDIDO AO VIVO (2026-09-11): carregarPatio() passou a buscar via Cloud
  // Function (buscarPatioTempoRealBigQuery) em vez de recebimento_recusas.
  // where('statusFisico','==','NO_PATIO') direto — o mock abaixo replica o
  // mesmo filtro sobre a mesma coleção mock de sempre.
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nomeFuncao => async payload => {
    if (nomeFuncao !== 'buscarPatioTempoRealBigQuery') throw new Error('função não mockada: ' + nomeFuncao);
    const col = colecoes?.recebimento_recusas || mockColecao([]);
    const snap = await col.get();
    const recusas = snap.docs.filter(d => (d.data() || {}).statusFisico === 'NO_PATIO').map(d => ({ _id: d.id, ...d.data() }));
    return { data: { recusas } };
  } }) }), firestore: { FieldPath: { documentId: () => ({ __isDocumentIdSentinel: true }) } } };
  win.showToast = () => {};
  win.aplicarPermissoesAnalista = () => {};
  win.eval(patioCode);
  return { win, document: win.document };
}

const I = win => win._recebimentoPatioTempoRealInternals;

// ── estaNoPatio / recalcularStatusFisico ────────────────────────────────
test('estaNoPatio: Recusa ainda não finalizada continua no pátio; FINALIZADO sai', () => {
  const { win } = carregarPagina({});
  const doc = { origem: 'COLETOR' };
  assert.equal(I(win).estaNoPatio(doc, { tratamento: 'RECUSA', statusRetorno: 'AGUARD_FISCAL' }), true);
  assert.equal(I(win).estaNoPatio(doc, { tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }), false);
  assert.equal(I(win).estaNoPatio(doc, { tratamento: 'RECUSA' }), true, 'sem status ainda (Aguard. Monitoramento) continua no pátio');
});
test('estaNoPatio: Reentrega sem dataSaidaEm continua no pátio; com saída, sai', () => {
  const { win } = carregarPagina({});
  const doc = { origem: 'COLETOR' };
  assert.equal(I(win).estaNoPatio(doc, { tratamento: 'REENTREGA' }), true);
  assert.equal(I(win).estaNoPatio(doc, { tratamento: 'REENTREGA', dataSaidaEm: '2026-09-01T00:00:00.000Z' }), false);
});
test('estaNoPatio: PENDENTE/não-classificado sempre conta no pátio (sem evento de conclusão hoje)', () => {
  const { win } = carregarPagina({});
  const doc = { origem: 'COLETOR' };
  assert.equal(I(win).estaNoPatio(doc, { tratamento: 'PENDENTE' }), true);
  assert.equal(I(win).estaNoPatio(doc, { tratamento: '' }), true);
  assert.equal(I(win).estaNoPatio(doc, {}), true);
});
test('estaNoPatio: devolução AUTOMATICO (nunca confirmada fisicamente) nunca conta no pátio', () => {
  const { win } = carregarPagina({});
  const doc = { origem: 'AUTOMATICO' };
  assert.equal(I(win).estaNoPatio(doc, { tratamento: 'RECUSA' }), false);
  assert.equal(I(win).estaNoPatio(doc, {}), false);
});
test('estaNoPatio: INVENTARIO_INICIAL conta como física, igual COLETOR', () => {
  const { win } = carregarPagina({});
  assert.equal(I(win).estaNoPatio({ origem: 'INVENTARIO_INICIAL' }, { tratamento: 'PENDENTE' }), true);
});
test('recalcularStatusFisico: NO_PATIO enquanto QUALQUER nota do documento continua presente; SAIU só quando todas saíram', () => {
  const { win } = carregarPagina({});
  const doc1 = { origem: 'COLETOR', notas: [{ tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }, { tratamento: 'REENTREGA' }] };
  assert.equal(I(win).recalcularStatusFisico(doc1), 'NO_PATIO', 'a Reentrega ainda não saiu — documento continua NO_PATIO');
  const doc2 = { origem: 'COLETOR', notas: [{ tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }, { tratamento: 'REENTREGA', dataSaidaEm: '2026-09-01T00:00:00.000Z' }] };
  assert.equal(I(win).recalcularStatusFisico(doc2), 'SAIU', 'as duas notas já saíram — documento inteiro SAIU');
});

// ── carregarPatio: busca + filtro fino + enriquecimento ─────────────────
test('carregarPatio: busca só statusFisico=NO_PATIO, expande em 1 linha por nota, e enriquece com mercado/vendedor/valor', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', box: 'BOX 1', motoristaNome: 'João', conferenteNome: 'Ana', criadoEm: '2026-08-01T10:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '100', tratamento: 'RECUSA', statusRetorno: 'AGUARD_FISCAL' }] } },
    { id: 'r2', data: { origem: 'COLETOR', criadoEm: '2026-08-02T10:00:00.000Z', statusFisico: 'SAIU', notas: [{ chave: 'B', numeroNota: '200', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }] } },
  ]);
  const notas = mockColecao([{ id: 'A', data: { destinatario: 'Mercado Atacadão', vendedorNome: 'Pedro', supervisorNome: 'Carla', valorTotal: 500 } }]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: notas });
  await I(win).carregarPatio(true);
  const linhas = I(win).getLinhas();
  assert.equal(linhas.length, 1, 'só o doc com statusFisico NO_PATIO entra na busca (r2 fica de fora)');
  assert.equal(linhas[0].numeroNota, '100');
  assert.equal(linhas[0].destinatario, 'Mercado Atacadão');
  assert.equal(linhas[0].vendedorNome, 'Pedro');
  assert.equal(linhas[0].supervisorNome, 'Carla');
  assert.equal(linhas[0].valorTotal, 500);
  assert.equal(linhas[0].box, 'BOX 1');
});
// BUG AO VIVO REAL (2026-09-11): "tem um monte sem valor" — nota sem
// `chave` (ex.: registrada direto pelo Coletor, sem casar com o ledger de
// venda) que já tem `valorTotal` gravado NELA MESMA sumia pra R$0,00: a
// linha copiava o campo do DOCUMENTO (sempre ausente nesse caso) em vez
// da nota, e como não tem chave o enriquecimento também não tinha como
// corrigir depois. 'valorTotal' precisa estar em CAMPOS_POR_NOTA igual
// 'destinatario' já está.
test('carregarPatio: valorTotal gravado na PRÓPRIA nota (sem chave, sem enriquecimento possível) aparece certo, não R$0,00', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', box: 'BOX 2', criadoEm: '2026-09-11T16:11:22.000Z', statusFisico: 'NO_PATIO', notas: [{ numeroNota: '194238', destinatario: 'WMS SUPERMERCADOS DO BRASIL LTDA', valorTotal: 1814.4 }] } },
  ]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });
  await I(win).carregarPatio(true);
  const linhas = I(win).getLinhas();
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].valorTotal, 1814.4, 'valor já estava na própria nota — nunca devia virar 0');
});
test('carregarPatio: filtro fino por nota — documento com statusFisico NO_PATIO mas ESSA nota específica já finalizada não aparece', async () => {
  // Simula um doc com 2 notas: uma ainda no pátio (mantém statusFisico=NO_PATIO no doc), outra já finalizada.
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [
      { chave: 'A', numeroNota: '100', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' },
      { chave: 'B', numeroNota: '200', tratamento: 'REENTREGA' },
    ] } },
  ]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });
  await I(win).carregarPatio(true);
  const linhas = I(win).getLinhas();
  assert.equal(linhas.length, 1, 'só a nota B (Reentrega ainda sem saída) fica — a A (Recusa finalizada) é filtrada mesmo o doc estando NO_PATIO');
  assert.equal(linhas[0].numeroNota, '200');
});

// PEDIDO AO VIVO (2026-09-11): "Pátio em Tempo Real demora pra atualizar"
// — o enriquecimento por nota (mercado/vendedor/valor) fazia 1 leitura
// POR NOTA; com o pátio crescendo (Identificar/Inventário Inicial geram
// mais notas), isso ficava cada vez mais pesado, inclusive a cada tick do
// polling de 45s. Agora agrupa em lotes de até 30 chaves por consulta
// `in` — prova aqui: 33 notas viram 2 consultas em lote, nunca 33
// leituras individuais via .doc().get().
test('carregarPatio: enriquecimento busca em LOTES (in, até 30 chaves), não 1 leitura por nota', async () => {
  const notasRecusa = [];
  const notasDocs = [];
  for (let i = 1; i <= 33; i++) {
    const chave = 'CH' + i;
    notasRecusa.push({ chave, numeroNota: String(1000 + i), tratamento: 'RECUSA', statusRetorno: 'AGUARD_FISCAL' });
    notasDocs.push({ id: chave, data: { destinatario: 'Mercado ' + i, valorTotal: i } });
  }
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: notasRecusa } },
  ]);
  const notas = mockColecao(notasDocs);
  let chamadasDoc = 0;
  const docOriginal = notas.doc;
  notas.doc = id => { chamadasDoc++; return docOriginal(id); };
  let chamadasWhereIn = 0;
  const whereOriginal = notas.where;
  notas.where = (campo, op, valor) => { if (op === 'in') chamadasWhereIn++; return whereOriginal(campo, op, valor); };

  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: notas });
  await I(win).carregarPatio(true);
  const linhas = I(win).getLinhas();

  assert.equal(linhas.length, 33);
  assert.equal(linhas.find(l => l.numeroNota === '1005').destinatario, 'Mercado 5', 'enriquecimento em lote traz o dado certo pra cada nota');
  assert.equal(chamadasDoc, 0, 'nunca usa .doc() individual pra buscar nota');
  assert.equal(chamadasWhereIn, 2, '33 chaves em lotes de 30 = 2 consultas em lote (30 + 3)');
});

// PEDIDO AO VIVO (2026-09-11): "olha se não tem como os dados se
// conversarem entre as telas" — quando Indicadores de Retornos (98) já
// carregou a coleção inteira nesta sessão (DT_NOTAS_VENDA_CACHE.completa
// = true), Pátio em Tempo Real reaproveita 100% — zero leituras no
// Firestore pro enriquecimento.
test('carregarPatio: com o cache compartilhado (DT_NOTAS_VENDA_CACHE) já completo, não busca NADA no Firestore pro enriquecimento', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [
      { chave: 'CHX', numeroNota: '999', tratamento: 'RECUSA', statusRetorno: 'AGUARD_FISCAL' },
    ] } },
  ]);
  let chamouWhere = false;
  const notas = mockColecao([]);
  const whereOriginal = notas.where;
  notas.where = (...args) => { chamouWhere = true; return whereOriginal(...args); };

  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-patio-tempo-real"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _janelasAbertas.push(win);
  win.getDTFirestore = () => ({ collection: nome => ({ recebimento_recusas: recusas, recebimento_recusas_notas: notas })[nome] || mockColecao([]) });
  win.getDTLojaAtiva = () => 'loja_matriz';
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: () => async () => ({ data: { recusas: recusas._registro ? [...recusas._registro.entries()].map(([id, data]) => ({ _id: id, ...data })) : [] } }) }) }), firestore: { FieldPath: { documentId: () => ({ __isDocumentIdSentinel: true }) } } };
  win.showToast = () => {};
  win.aplicarPermissoesAnalista = () => {};
  // Simula Indicadores de Retornos já tendo carregado a coleção inteira
  // nesta sessão, ANTES de 105-recebimento-patio-tempo-real.js rodar.
  win.DT_NOTAS_VENDA_CACHE = { porChave: new Map([['CHX', { destinatario: 'Mercado Pré-carregado', valorTotal: 42 }]]), completa: true };
  win.eval(patioCode);

  await win._recebimentoPatioTempoRealInternals.carregarPatio(true);
  const linhas = win._recebimentoPatioTempoRealInternals.getLinhas();

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].destinatario, 'Mercado Pré-carregado', 'veio do cache compartilhado, não de uma busca nova');
  assert.equal(chamouWhere, false, 'zero leituras no Firestore — o cache já tinha tudo');
});

// PEDIDO AO VIVO (2026-09-11): "clico demora muito para carregar" — leitura
// direta de lojas/{lojaId}/recebimento_patio_cache/atual (montado por um
// job agendado no servidor) em vez de chamar a Cloud Function/BigQuery no
// clique.
test('carregarPatio: com cache válido (recente) no Firestore, usa ele direto — NUNCA chama a Cloud Function', async () => {
  let chamouFuncao = false;
  const cache = mockColecao([{ id: 'atual', data: {
    atualizadoEm: new Date().toISOString(),
    linhas: [{ origem: 'COLETOR', criadoEm: '2026-09-01T10:00:00.000Z', numeroNota: '700', destinatario: 'Mercado Cache', tratamento: 'RECUSA', chave: 'CHZ' }],
  } }]);
  const { win } = carregarPagina({ recebimento_patio_cache: cache });
  win.firebase.app = () => ({ functions: () => ({ httpsCallable: () => async () => { chamouFuncao = true; return { data: { recusas: [] } }; } }) });

  await I(win).carregarPatio(true);
  const linhas = I(win).getLinhas();

  assert.equal(chamouFuncao, false, 'cache válido — não precisa chamar a Cloud Function');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].destinatario, 'Mercado Cache');
});

test('carregarPatio: cache PARADO há mais de 10min (job quebrado) cai pro caminho ao vivo (Cloud Function), não mostra dado velho demais', async () => {
  let chamouFuncao = false;
  const cache = mockColecao([{ id: 'atual', data: {
    atualizadoEm: new Date(Date.now() - 15 * 60000).toISOString(), // 15min atrás
    linhas: [{ origem: 'COLETOR', criadoEm: '2026-09-01T10:00:00.000Z', numeroNota: '700', destinatario: 'Mercado Velho', tratamento: 'RECUSA' }],
  } }]);
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-09-01T10:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '800', tratamento: 'RECUSA' }] } },
  ]);
  const { win } = carregarPagina({ recebimento_patio_cache: cache, recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });
  const funcaoOriginal = win.firebase.app().functions().httpsCallable;
  win.firebase.app = () => ({ functions: () => ({ httpsCallable: nome => async payload => { chamouFuncao = true; return funcaoOriginal(nome)(payload); } }) });

  await I(win).carregarPatio(true);
  const linhas = I(win).getLinhas();

  assert.equal(chamouFuncao, true, 'cache velho demais — precisa ir pro caminho ao vivo');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].numeroNota, '800', 'veio da busca ao vivo, não do cache velho');
});

test('carregarPatio: sem documento de cache ainda (loja nova / antes do 1º ciclo do job) cai pro caminho ao vivo sem quebrar', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-09-01T10:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '801', tratamento: 'RECUSA' }] } },
  ]);
  const { win } = carregarPagina({ recebimento_patio_cache: mockColecao([]), recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });
  await I(win).carregarPatio(true);
  assert.equal(I(win).getLinhas()[0].numeroNota, '801');
});

// ── kpis / ranking ───────────────────────────────────────────────────────
test('kpis: soma total/recusas/reentregas (qtd+valor) e conta notas em tratamento (status fora de vazio/FINALIZADO)', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '1', tratamento: 'RECUSA', statusRetorno: 'AGUARD_FISCAL' }] } },
    { id: 'r2', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'B', numeroNota: '2', tratamento: 'RECUSA' }] } },
    { id: 'r3', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'C', numeroNota: '3', tratamento: 'REENTREGA' }] } },
  ]);
  const notas = mockColecao([
    { id: 'A', data: { valorTotal: 100 } }, { id: 'B', data: { valorTotal: 50 } }, { id: 'C', data: { valorTotal: 30 } },
  ]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: notas });
  await I(win).carregarPatio(true);
  const k = I(win).kpis();
  assert.equal(k.total, 3);
  assert.equal(k.valorTotal, 180);
  assert.equal(k.recusas, 2);
  assert.equal(k.valorRecusas, 150);
  assert.equal(k.reentregas, 1);
  assert.equal(k.valorReentregas, 30);
  assert.equal(k.emTratamento, 1, 'só a recusa com status AGUARD_FISCAL conta — a sem status (Aguard. Monitoramento) e a Reentrega não');
});
test('ranking de mercados: agrupa por destinatario com qtd/valor/recusas/reentregas', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '1', tratamento: 'RECUSA' }] } },
    { id: 'r2', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'B', numeroNota: '2', tratamento: 'REENTREGA' }] } },
  ]);
  const notas = mockColecao([{ id: 'A', data: { destinatario: 'Mercado X', valorTotal: 10 } }, { id: 'B', data: { destinatario: 'Mercado X', valorTotal: 20 } }]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: notas });
  await I(win).carregarPatio(true);
  const ranking = I(win).rankingMercados();
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].mercado, 'Mercado X');
  assert.equal(ranking[0].qtd, 2);
  assert.equal(ranking[0].valor, 30);
  assert.equal(ranking[0].recusas, 1);
  assert.equal(ranking[0].reentregas, 1);
});

// ── filtros client-side ──────────────────────────────────────────────────
test('filtros: tipo/mercado/status/box/vendedor/supervisor filtram sem refazer busca', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', box: 'BOX 1', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '1', tratamento: 'RECUSA', statusRetorno: 'CTE' }] } },
    { id: 'r2', data: { origem: 'COLETOR', box: 'BOX 2', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'B', numeroNota: '2', tratamento: 'REENTREGA' }] } },
  ]);
  const notas = mockColecao([{ id: 'A', data: { destinatario: 'Mercado X', vendedorNome: 'João', supervisorNome: 'Ana' } }, { id: 'B', data: { destinatario: 'Mercado Y', vendedorNome: 'Pedro', supervisorNome: 'Carla' } }]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: notas });
  await I(win).carregarPatio(true);

  I(win).setFiltroTipo('RECUSA');
  assert.equal(I(win).filtradas().length, 1);
  assert.equal(I(win).filtradas()[0].numeroNota, '1');
  I(win).setFiltroTipo('');

  I(win).setFiltroMercado('Mercado Y');
  assert.equal(I(win).filtradas().length, 1);
  assert.equal(I(win).filtradas()[0].numeroNota, '2');
  I(win).setFiltroMercado('');

  I(win).setFiltroStatus('CTE');
  assert.equal(I(win).filtradas().length, 1);
  assert.equal(I(win).filtradas()[0].numeroNota, '1');
  I(win).setFiltroStatus('');

  I(win).setFiltroBox('box 2');
  assert.equal(I(win).filtradas().length, 1);
  assert.equal(I(win).filtradas()[0].numeroNota, '2');
  I(win).setFiltroBox('');

  I(win).setFiltroVendedor('joão');
  assert.equal(I(win).filtradas().length, 1);
  assert.equal(I(win).filtradas()[0].numeroNota, '1');
  I(win).setFiltroVendedor('');

  I(win).setFiltroSupervisor('carla');
  assert.equal(I(win).filtradas().length, 1);
  assert.equal(I(win).filtradas()[0].numeroNota, '2');
});

// PEDIDO AO VIVO (2026-09-11): "quando eu clicar em algum dos cards
// filtrar todas as informações que condiz com o card" — os 4 cards do
// topo (Total/Recusas/Reentregas/Notas em tratamento) viram atalhos
// clicáveis pro mesmo filtro. "Notas em tratamento" é RECUSA com
// QUALQUER status ativo (fora vazio/FINALIZADO) — não um status único —
// por isso é um interruptor à parte (_filtroEmTratamento), não o dropdown
// de status.
test('clicar nos cards do topo filtra a tabela pelo que o card representa, e clicar de novo desliga o filtro', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '1', tratamento: 'RECUSA', statusRetorno: 'AGUARD_FISCAL' }] } },
    { id: 'r2', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'B', numeroNota: '2', tratamento: 'RECUSA' }] } }, // Recusa sem status ainda — NÃO é "em tratamento"
    { id: 'r3', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'C', numeroNota: '3', tratamento: 'REENTREGA' }] } },
  ]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });
  await I(win).carregarPatio(true);

  I(win).clicarCard('recusa');
  assert.deepEqual(Array.from(I(win).filtradas().map(l => l.numeroNota)).sort(), ['1', '2']);
  I(win).clicarCard('recusa'); // clicar de novo desliga
  assert.equal(I(win).filtradas().length, 3, 'sem filtro nenhum — volta a mostrar tudo (Total no Pátio)');

  I(win).clicarCard('reentrega');
  assert.deepEqual(Array.from(I(win).filtradas().map(l => l.numeroNota)), ['3']);

  I(win).clicarCard('tratamento');
  assert.deepEqual(Array.from(I(win).filtradas().map(l => l.numeroNota)), ['1'], 'só a Recusa com status ATIVO (não vazio, não FINALIZADO) — a nota 2 (Recusa sem status ainda) fica de fora');
  assert.equal(I(win).getFiltroEmTratamento(), true);

  I(win).clicarCard('total');
  assert.equal(I(win).filtradas().length, 3);
  assert.equal(I(win).getFiltroTipo(), '');
  assert.equal(I(win).getFiltroEmTratamento(), false);
});
test('renderPatioTempoReal: os cards aparecem clicáveis (data-patio-card) e o card ativo fica destacado', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '1', tratamento: 'RECUSA' }] } },
  ]);
  const { win, document } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });
  await win.renderPatioTempoReal();
  const cards = document.querySelectorAll('[data-patio-card]');
  assert.equal(cards.length, 4, 'os 4 cards (total/recusa/reentrega/tratamento) têm o atributo clicável');

  document.querySelector('[data-patio-card="recusa"]').click();
  const html = document.getElementById('page-recebimento-patio-tempo-real').innerHTML;
  assert.match(html, /FILTRANDO/, 'algum indicador visual mostra qual card está ativo');
  assert.equal(I(win).getFiltroTipo(), 'RECUSA', 'o clique real (via DOM) chamou o mesmo filtro');
});
test('renderPatioTempoReal: o card "Total no Pátio" nunca mostra "· FILTRANDO" (ele representa "sem filtro nenhum")', async () => {
  const recusas = mockColecao([{ id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '1', tratamento: 'RECUSA' }] } }]);
  const { win, document } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });
  await win.renderPatioTempoReal();
  const totalCard = document.querySelector('[data-patio-card="total"]').innerHTML;
  assert.doesNotMatch(totalCard, /FILTRANDO/, '"Total" é o estado neutro (mostra tudo), não uma classificação escolhida');
});

// BUG AO VIVO REAL (2026-09-11): "clicou já traz as informações" (Notas
// Retornadas) "aqui será que não é por causa do botão buscar que demora
// tanto" — a causa real não era o backend (cache confirmado fresco,
// <1min) — era a TELA: na 1ª entrada, antes do 1º carregarPatio
// terminar, `_linhas` ainda está vazio; clicar em QUALQUER coisa que
// redesenha nesse instante (ex.: um dos cards novos) mostrava "0"/
// "R$ 0,00"/"Sem dados para exibir" por um instante — parecendo tela
// travada/mais lenta que as outras, quando é só o mesmo tempo de rede
// que toda tela paga (só que aqui é automático, e um clique no meio do
// caminho revelava o estado transitório de forma enganosa).
test('BUG AO VIVO REAL: clicar num card ENQUANTO a 1ª busca ainda está em voo mostra "Carregando...", nunca "0"/"R$ 0,00"/"Sem dados"', async () => {
  const { win, document } = carregarPagina({ recebimento_recusas: mockColecao([]), recebimento_recusas_notas: mockColecao([]) });
  let resolverCallable;
  const pendente = new Promise(r => { resolverCallable = r; });
  win.firebase.app = () => ({ functions: () => ({ httpsCallable: () => () => pendente }) });

  const promessaRender = win.renderPatioTempoReal(); // dispara carregarPatio — a Cloud Function ainda não respondeu
  await Promise.resolve(); await Promise.resolve(); // deixa o _tentarCarregarDoCache (cache inexistente) resolver e cair pro caminho ao vivo, que fica pendurado em `pendente`

  I(win).clicarCard('total'); // usuário clica ENQUANTO ainda está carregando
  const html = document.getElementById('page-recebimento-patio-tempo-real').innerHTML;
  assert.doesNotMatch(html, /R\$ 0,00/, 'nunca finge saber o total (R$ 0,00) antes da 1ª busca terminar');
  assert.doesNotMatch(html, /Sem dados para exibir/);
  assert.doesNotMatch(html, /Nenhuma nota parada com esses filtros/);
  assert.match(html, /Carregando/);

  resolverCallable({ data: { recusas: [] } });
  await promessaRender;
});

// ── formatação de tempo parado ───────────────────────────────────────────
test('fmtTempoParado: formata em dias/horas/minutos, nunca inventa valor sem data', () => {
  const { win } = carregarPagina({});
  const doisDiasTresHoras = new Date(Date.now() - (2 * 24 * 60 + 3 * 60 + 5) * 60000).toISOString();
  assert.match(I(win).fmtTempoParado(doisDiasTresHoras), /^2 dias 3h0[45]min$/);
  const cincoHoras = new Date(Date.now() - 5 * 60 * 60000).toISOString();
  assert.match(I(win).fmtTempoParado(cincoHoras), /^5h0\dmin$/);
  assert.equal(I(win).fmtTempoParado(''), '—');
  assert.equal(I(win).fmtTempoParado(null), '—');
});

// ── migração (backfill) ──────────────────────────────────────────────────
test('migrarStatusFisico: preenche statusFisico só nos documentos que ainda não têm, idempotente', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-patio-tempo-real"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  _janelasAbertas.push(win);
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', notas: [{ chave: 'A', numeroNota: '1', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }] } }, // sem statusFisico ainda — deve virar SAIU
    { id: 'r2', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', notas: [{ chave: 'B', numeroNota: '2', tratamento: 'RECUSA' }] } }, // sem statusFisico ainda — deve virar NO_PATIO
    { id: 'r3', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'C', numeroNota: '3', tratamento: 'RECUSA' }] } }, // já tem — não deveria precisar mudar
  ]);
  win.getDTFirestore = () => ({ collection: nome => ({ recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) })[nome] || mockColecao([]) });
  win.getDTRawFirestore = () => mockRawFirestore({ recebimento_recusas: recusas });
  win.showToast = () => {};
  win.aplicarPermissoesAnalista = () => {};
  win.eval(patioCode);
  await win._recebimentoPatioTempoRealInternals.migrarStatusFisico();
  assert.equal(recusas._registro.get('r1').statusFisico, 'SAIU');
  assert.equal(recusas._registro.get('r2').statusFisico, 'NO_PATIO');
  assert.equal(recusas._registro.get('r3').statusFisico, 'NO_PATIO');
  // Rodar de novo não deve dar erro nem mudar nada (idempotente).
  await win._recebimentoPatioTempoRealInternals.migrarStatusFisico();
  assert.equal(recusas._registro.get('r1').statusFisico, 'SAIU');
});

// PEDIDO AO VIVO (2026-09-11): "puxando e preenchendo pelo número da
// nota" — backfill pras notas que já estão no pátio sem mercado (a
// maioria vinda de Identificar, que só pedia número, sem chave).
test('buscarMercadoFaltante: acha pelo número no ledger de venda e corrige o documento original (chave + mercado)', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ numeroNota: '900', box: 'BOX 1', tratamento: 'RECUSA' }] } }, // sem chave — veio de Identificar
  ]);
  const notasVenda = mockColecao([{ id: 'CHAVE-REAL', data: { numeroNota: '900', destinatario: 'Mercado Achado' } }]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: notasVenda });
  await I(win).carregarPatio(true);
  assert.ok(!I(win).getLinhas()[0].destinatario, 'antes da correção, sem mercado (sem chave pra enriquecer)');

  await I(win).buscarMercadoFaltante();

  const salvo = recusas._registro.get('r1');
  assert.equal(salvo.notas[0].chave, 'CHAVE-REAL');
  assert.equal(salvo.notas[0].destinatario, 'Mercado Achado');
  assert.equal(I(win).getLinhas()[0].destinatario, 'Mercado Achado', 'tela já recarrega sozinha depois da correção');
});

test('buscarMercadoFaltante: número que não existe no ledger não altera nada, não trava', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ numeroNota: '901', box: 'BOX 2', tratamento: 'RECUSA' }] } },
  ]);
  const { win } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });
  await I(win).carregarPatio(true);

  await I(win).buscarMercadoFaltante();

  const salvo = recusas._registro.get('r1');
  assert.equal(salvo.notas[0].chave, undefined);
  assert.equal(salvo.notas[0].destinatario, undefined);
});

// ── render da tela ───────────────────────────────────────────────────────
test('renderPatioTempoReal: mostra os 4 cards e a tabela com as notas do pátio', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', box: 'BOX 5', criadoEm: '2026-08-01T00:00:00.000Z', statusFisico: 'NO_PATIO', notas: [{ chave: 'A', numeroNota: '555', tratamento: 'RECUSA', statusRetorno: 'CTE' }] } },
  ]);
  const notas = mockColecao([{ id: 'A', data: { destinatario: 'Mercado Central', valorTotal: 250 } }]);
  const { win, document } = carregarPagina({ recebimento_recusas: recusas, recebimento_recusas_notas: notas });
  await win.renderPatioTempoReal();
  const html = document.getElementById('page-recebimento-patio-tempo-real').innerHTML;
  assert.match(html, /TOTAL NO PÁTIO/);
  assert.match(html, /RECUSAS/);
  assert.match(html, /REENTREGAS/);
  assert.match(html, /NOTAS EM TRATAMENTO/);
  assert.match(html, /555/);
  assert.match(html, /Mercado Central/);
  assert.match(html, /BOX 5/);
  assert.match(html, /R\$\s*250,00/);
});
