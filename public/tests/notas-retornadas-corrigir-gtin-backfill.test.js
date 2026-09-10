// PEDIDO AO VIVO (2026-09-02): "verifica pq não apareceu o gtin e dun" —
// notas de venda já gravadas ANTES do fix de _agruparNotasBiPorChave
// ficaram com gtin='' pra sempre, porque _gravarNotasVenda pula chave que
// já existe (venda é histórico, nunca reimporta de novo). GTIN/DUN é
// atributo do PRODUTO (código de barras) — não muda de nota pra nota —
// então dá pra corrigir qualquer nota já gravada (mesmo uma que não esteja
// mais "em aberto" no BI) só reaproveitando um mapa produto_key→gtin
// construído a partir do arquivo atual do BI. Botão manual "🔧 Corrigir
// GTIN" em Notas Retornadas (Venda), não roda sozinho.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '97-recebimento-recusas.js'), 'utf8');

function colecaoVazia() { return { get: async () => ({ docs: [] }) }; }

function montarAmbiente(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const registro = new Map((opts.notas || []).map(n => [n.id, n.data]));
  const colNotas = {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
  };
  const escritas = [];
  const rawFs = {
    batch: () => ({
      set: (ref, data) => { escritas.push({ id: ref.id, data }); registro.set(ref.id, { ...registro.get(ref.id), ...data }); },
      commit: async () => {},
    }),
  };
  win.getDTFirestore = () => ({
    collection: (nome) => (nome === 'recebimento_recusas_notas' ? colNotas : colecaoVazia()),
    ...{ doc: undefined },
  });
  // fs().collection(COL_NOTAS).doc(id) precisa devolver algo com `.id` pro batch.set
  const origGetDTFirestore = win.getDTFirestore;
  win.getDTFirestore = () => {
    const base = origGetDTFirestore();
    return { collection: (nome) => { const c = base.collection(nome); return { ...c, doc: (id) => ({ id }) }; } };
  };
  win.getDTRawFirestore = () => ({ batch: rawFs.batch });
  win.showToast = () => {};
  win.DTBiPastaLocal = opts.biIndisponivel ? undefined : {
    suportado: () => true,
    status: async () => 'conectado',
    conectar: async () => ({ ok: true }),
    lerJson: async () => opts.registrosBi || [],
  };
  win.eval(code);
  return { win, parser: win.DTRecusasParser, registro, escritas };
}

test('_corrigirGtinNotasVenda: preenche gtin(ean)/dun(dum) de itens vazios, casando por produtoKey (não por chave)', async () => {
  const { parser, registro } = montarAmbiente({
    notas: [
      { id: 'chaveA', data: { naturezaLabel: 'Venda', itens: [
        { produtoKey: 75877, descricao: '00204 BATATA PALHA...', quantidade: 2, gtin: '', ncm: '' },
        { produtoKey: 999999, descricao: 'produto sem barcode no BI', quantidade: 1, gtin: '', ncm: '' },
      ] } },
      { id: 'chaveB', data: { naturezaLabel: 'Venda', itens: [
        { produtoKey: 305, descricao: '00002 TAPIOCA...', quantidade: 5, gtin: '', ncm: '' },
      ] } },
    ],
    registrosBi: [
      { produto_key: 75877, dum: 17898693230671, ean: 7898693230674 },
      { produto_key: 305, dum: 17898994081620, ean: 7898994081623 },
    ],
  });
  await parser._corrigirGtinNotasVenda();
  assert.equal(registro.get('chaveA').itens[0].gtin, '7898693230674', 'gtin é o ean');
  assert.equal(registro.get('chaveA').itens[0].dun, '17898693230671', 'dun é o dum, diferente do gtin');
  assert.equal(registro.get('chaveA').itens[1].gtin, '', 'produto sem correspondência no BI continua vazio, não quebra nem inventa valor');
  assert.equal(registro.get('chaveB').itens[0].gtin, '7898994081623', 'produto 305: gtin corrigido pro ean certo dele');
  assert.equal(registro.get('chaveB').itens[0].dun, '17898994081620', 'produto 305: dun corrigido pro dum certo dele');
});

// PEDIDO AO VIVO (2026-09-02, 3ª rodada): "o gtin ficou com o dun também,
// cada um no lugar certo" — a 1ª execução deste botão (antes deste fix)
// gravou gtin=dun (duplicado) em notas que já tinham sido "corrigidas".
// O botão precisa RECALCULAR sempre que há correspondência no BI (não só
// preencher quando vazio), pra também consertar esse erro anterior.
test('_corrigirGtinNotasVenda: RECALCULA e corrige item que já tinha gtin igual ao dun (erro da correção anterior)', async () => {
  const { parser, registro } = montarAmbiente({
    notas: [
      { id: 'chaveC', data: { naturezaLabel: 'Venda', itens: [
        { produtoKey: 305, descricao: 'gtin duplicado errado da vez passada', quantidade: 1, gtin: '17898994081620', dun: '17898994081620', ncm: '' },
      ] } },
    ],
    registrosBi: [
      { produto_key: 305, dum: 17898994081620, ean: 7898994081623 },
    ],
  });
  await parser._corrigirGtinNotasVenda();
  assert.equal(registro.get('chaveC').itens[0].gtin, '7898994081623', 'gtin corrigido pro ean — não fica mais igual ao dun');
  assert.equal(registro.get('chaveC').itens[0].dun, '17898994081620', 'dun continua correto');
});

test('_corrigirGtinNotasVenda: sem BI disponível, avisa e não tenta ler/escrever nada', async () => {
  const { parser, registro } = montarAmbiente({
    biIndisponivel: true,
    notas: [{ id: 'chaveA', data: { naturezaLabel: 'Venda', itens: [{ produtoKey: 1, gtin: '' }] } }],
  });
  await parser._corrigirGtinNotasVenda();
  assert.equal(registro.get('chaveA').itens[0].gtin, '', 'nada mudou — sem serviço de BI não há como corrigir');
});
