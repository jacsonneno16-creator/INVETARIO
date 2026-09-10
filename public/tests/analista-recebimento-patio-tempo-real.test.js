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
  base.where = (campo, op, valor) => ({
    get: async () => {
      const bate = data => { const v = data ? data[campo] : undefined; return op === '==' ? v === valor : true; };
      return { docs: [...registro.entries()].filter(([, data]) => bate(data)).map(([id, data]) => ({ id, data: () => data })) };
    },
  });
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
