// PEDIDO AO VIVO (auditoria 2ª rodada, seção 8): o original (index.html:
// 282-297) não tem título grande acima do Gantt — começa direto no
// seletor Semanal/Mensal ("Visualização: [Semanal][Mensal]"), toolbar
// embaixo. Este teste dirige o render real (jsdom, buildProducaoSchedule
// mockado) e confere que o título grande sumiu e que o resumo "📦 Qtd por
// Dia" (visível nesta integração — ver comentário no arquivo sobre o
// original escondê-lo com display:none) aparece no formato por-máquina.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '64-producao-gantt.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }) };
}

function carregarPagina() {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-gantt"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_registros: mockColecao([{ id: 'r1', data: { produto: 'Produto A', maquina: 'ENVASADORA 1', qntCaixas: 100, status: 'pendente', data: '2026-08-24' } }]),
      producao_maquinas: mockColecao([{ id: 'm1', data: { nome: 'ENVASADORA 1' } }]),
      producao_setup: mockColecao([]),
      producao_categorias: mockColecao([]),
    }[nome] || mockColecao([])),
  });
  win.temPermissao = () => true;
  win.PRODUCAO_JORNADA = [0, 9, 9, 9, 9, 8, 0];
  // Mock direto do motor de agenda — o que importa aqui é a MARCAÇÃO
  // (título, resumo), não recalcular o agendamento real.
  win.buildProducaoSchedule = () => {
    const porDia = [[], [], [], [], [], [], []];
    porDia[1] = [{ tipo: 'producao', produto: 'Produto A', registroId: 'r1', caixasNoDia: 50, minutosNoDia: 120, inicioMin: 0, capacidadeDoDiaMin: 540 }];
    porDia[2] = [{ tipo: 'producao', produto: 'Produto A', registroId: 'r1', caixasNoDia: 50, minutosNoDia: 120, inicioMin: 0, capacidadeDoDiaMin: 540 }];
    return { porMaquina: { 'ENVASADORA 1': { porDia, totalMinutosUsados: 240, capacidadeMinutosSemana: 2700 } } };
  };
  win.DTProducao = { registrarInvalidacao: () => {} };
  win.eval(code);
  return { win, document };
}

test('Gantt: sem título grande — começa direto no seletor Semanal/Mensal', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoGantt();
  const html = document.getElementById('page-producao-gantt').innerHTML;
  assert.doesNotMatch(html, /Gantt — Programação de Produção/);
  assert.match(html, /Visualização:/);
  assert.match(html, /data-pgantt-modo="semanal"/);
  assert.match(html, /data-pgantt-modo="mensal"/);
});

test('Gantt: resumo semanal mostra tabela por máquina/produto/dia (gs-table), não mais um único total agregado', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoGantt();
  const html = document.getElementById('page-producao-gantt').innerHTML;
  assert.match(html, /📦 Qtd por Dia/);
  assert.match(html, /class="gs-maq"/);
  assert.match(html, /class="gs-table"/);
  assert.match(html, /ENVASADORA 1/);
  assert.match(html, /class="total-row"/);
});
