// Comparação com o projeto de referência do usuário (Sistema-Produ-o/
// Meu-Sistema-Producao, legacy/app.html, renderInsumosMaq/renderInsumosGeral)
// achou 4 diferenças reais na aba Insumos que ainda restavam depois das
// rodadas anteriores de paridade (V341): (1) semana começava Domingo em vez
// de Segunda — diferente do próprio Gantt (63/64-producao-*.js), que já usa
// Segunda-feira pra alimentar o MESMO buildProducaoSchedule(); (2) categoria
// em ordem alfabética, não na ordem fixa do original (MATÉRIA PRIMA →
// EMBALAGENS → OUTROS); (3) insumo dentro da categoria em ordem alfabética,
// não por maior consumo primeiro; (4) coluna Máquina repetida em toda linha,
// sem o agrupamento visual (rowspan + separador) que o original tem.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const agendaCode = fs.readFileSync(path.join(base, '63-producao-agenda.js'), 'utf8');
const insumosCode = fs.readFileSync(path.join(base, '65-producao-insumos.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }) };
}

function carregarInsumos() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="page-producao-insumos"></div>
  </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(agendaCode);
  win.eval(insumosCode);
  const maquinas = mockColecao([{ id: 'm1', data: { nome: 'M1', turnos: { '1': [{ ini: '00:00', fim: '23:59' }] } } }]);
  const registros = mockColecao([
    // Segunda-feira 2026-08-24 (semana de teste) — produto A (5 caixas,
    // insumo Farinha/MATERIA PRIMA) e produto B (1 caixa, insumo Açúcar/
    // MATERIA PRIMA + Saco Plástico/EMBALAGEM PRIMARIA), ambos na M1.
    { id: 'op-a', data: { produto: 'Produto A', maquina: 'M1', data: '2026-08-24', status: 'pendente', qntCaixas: 5, unidPorCx: 1, pcMin: 1, sortOrder: 1, prodCod: 'A' } },
    { id: 'op-b', data: { produto: 'Produto B', maquina: 'M1', data: '2026-08-24', status: 'pendente', qntCaixas: 1, unidPorCx: 1, pcMin: 1, sortOrder: 2, prodCod: 'B' } },
  ]);
  const fichas = mockColecao([
    { id: 'fa', data: { cod: 'A', insumos: [{ insumo: 'Farinha', categoria: 'MATERIA PRIMA', qty: 1 }] } },
    { id: 'fb', data: { cod: 'B', insumos: [{ insumo: 'Acucar', categoria: 'MATERIA PRIMA', qty: 1 }, { insumo: 'Saco Plastico', categoria: 'EMBALAGEM PRIMARIA', qty: 1 }] } },
  ]);
  win.getDTFirestore = () => ({
    collection: nome => {
      if (nome === 'producao_maquinas') return maquinas;
      if (nome === 'producao_registros') return registros;
      if (nome === 'producao_ficha_tecnica') return fichas;
      return mockColecao([]);
    },
  });
  return { win, document: win.document };
}

test('semana da aba Insumos começa na SEGUNDA-feira (igual ao Gantt e ao original), não no domingo', async () => {
  const { win, document } = carregarInsumos();
  await win.renderProducaoInsumos();
  // 2026-08-26 é uma quarta-feira; a segunda daquela semana é 2026-08-24.
  const inputGoto = document.querySelector('[data-pins-data]');
  inputGoto.value = '2026-08-26';
  inputGoto.dispatchEvent(new win.Event('change', { bubbles: true }));
  const inputData = document.querySelector('[data-pins-data]');
  assert.equal(inputData.value, '2026-08-24', 'ir para uma quarta-feira precisa mostrar a segunda-feira daquela semana, não o domingo anterior');
});

test('BUG AO VIVO REAL (comparação com o original): categoria em ordem fixa (MATÉRIA PRIMA antes de EMBALAGEM), insumo por maior consumo primeiro, e Máquina aparece 1x com rowspan — não mais repetida em toda linha', async () => {
  const { win, document } = carregarInsumos();
  await win.renderProducaoInsumos();
  const inputGoto = document.querySelector('[data-pins-data]');
  inputGoto.value = '2026-08-24';
  inputGoto.dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-producao-insumos').innerHTML;

  // Ordem de categoria: MATERIA PRIMA (alfabeticamente depois de EMBALAGEM)
  // precisa aparecer ANTES — prova que não é mais ordem alfabética.
  const idxFarinha = html.indexOf('Farinha');
  const idxAcucar = html.indexOf('Acucar');
  const idxSaco = html.indexOf('Saco Plastico');
  assert.ok(idxFarinha > -1 && idxAcucar > -1 && idxSaco > -1, 'os 3 insumos precisam aparecer na tabela');
  assert.ok(idxAcucar < idxSaco, 'MATERIA PRIMA (Farinha/Acucar) precisa vir antes de EMBALAGEM PRIMARIA (Saco Plastico) — ordem fixa do original, não alfabética');

  // Dentro de MATERIA PRIMA: Farinha (consumo 5) antes de Acucar (consumo 1)
  // — maior consumo primeiro, não ordem alfabética (que colocaria Acucar antes).
  assert.ok(idxFarinha < idxAcucar, 'dentro da mesma categoria, maior consumo (Farinha=5) precisa vir antes do menor (Acucar=1)');

  // Máquina M1 aparece com rowspan cobrindo as 3 linhas de insumo dela,
  // não repetida em cada <tr> — mesmo padrão visual do original.
  assert.match(html, /rowspan="3"[^>]*><b>M1<\/b>/, 'M1 precisa aparecer 1x só, com rowspan cobrindo as 3 linhas de insumo');
  const ocorrenciasM1 = (html.match(/<b>M1<\/b>/g) || []).length;
  assert.equal(ocorrenciasM1, 1, 'M1 não pode se repetir em toda linha — só na primeira, com rowspan');
});

// PEDIDO AO VIVO (2026-09-03): "no insumos, por máquina e insumo geral do
// original ele tem uma... a primeira coluna é categoria" — Insumos Geral já
// tinha a linha separadora por categoria e o subtotal, mas faltava a
// PRIMEIRA COLUNA repetindo a categoria (abreviada) em cada linha de
// insumo, igual ao original (renderInsumosGeral, coluna "col-maq"). Insumos
// por Máquina já tinha essa coluna — só Geral estava faltando.
test('Insumos Geral: primeira coluna é "Categoria" (abreviada por linha: "Mat. Prima"/"Emb. Primaria"), igual ao original', async () => {
  const { win, document } = carregarInsumos();
  await win.renderProducaoInsumos();
  const inputGoto = document.querySelector('[data-pins-data]');
  inputGoto.value = '2026-08-24';
  inputGoto.dispatchEvent(new win.Event('change', { bubbles: true }));
  win.pinsModo('geral');
  const html = document.getElementById('page-producao-insumos').innerHTML;
  assert.match(html, /<th>Categoria<\/th><th>Insumo<\/th>/, 'cabeçalho da tabela geral tem Categoria como 1ª coluna, antes de Insumo');
  assert.match(html, /<td[^>]*>Mat\. Prima<\/td><td><b>Farinha<\/b>/, 'linha do insumo Farinha mostra "Mat. Prima" na coluna categoria, abreviado');
  // Igual ao original: o replace só troca o prefixo "EMBALAGEM " por "Emb. "
  // — o resto ("PRIMARIA") continua maiúsculo, exatamente como
  // cat.replace('EMBALAGEM ','Emb. ') do app.js original produz.
  assert.match(html, /<td[^>]*>Emb\. PRIMARIA<\/td><td><b>Saco Plastico<\/b>/, 'linha do insumo Saco Plastico mostra "Emb. PRIMARIA" na coluna categoria');
});
