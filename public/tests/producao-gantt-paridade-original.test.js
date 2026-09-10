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

// PEDIDO AO VIVO (pendência #3, rodada de correção): o original começa
// com #gantt-summary escondido (display:none, index.html:353) — a
// fidelidade real exige que a tela ENTRE oculta, não que o resumo seja
// forçado visível "porque é mais útil". Testes abaixo dirigem o fluxo
// completo: oculto → abre → mostra a tabela → fecha.
test('Gantt: resumo semanal começa OCULTO (estado inicial igual ao original)', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoGantt();
  const html = document.getElementById('page-producao-gantt').innerHTML;
  assert.match(html, /Mostrar resumo/);
  assert.doesNotMatch(html, /📦 Qtd por Dia/, 'resumo não deveria aparecer antes de o usuário clicar em "Mostrar resumo"');
  assert.doesNotMatch(html, /class="gs-table"/);
});

test('Gantt: botão "Mostrar resumo" abre a tabela por máquina/produto/dia (gs-table)', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoGantt();
  document.querySelector('[data-pgantt-resumo-toggle]').click();
  const html = document.getElementById('page-producao-gantt').innerHTML;
  assert.match(html, /Ocultar resumo/);
  assert.match(html, /📦 Qtd por Dia/);
  assert.match(html, /class="gs-maq"/);
  assert.match(html, /class="gs-table"/);
  assert.match(html, /ENVASADORA 1/);
  assert.match(html, /class="total-row"/);
});

test('Gantt: clicar de novo em "Ocultar resumo" fecha a tabela outra vez', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoGantt();
  document.querySelector('[data-pgantt-resumo-toggle]').click();
  assert.match(document.getElementById('page-producao-gantt').innerHTML, /📦 Qtd por Dia/);
  document.querySelector('[data-pgantt-resumo-toggle]').click();
  const html = document.getElementById('page-producao-gantt').innerHTML;
  assert.match(html, /Mostrar resumo/);
  assert.doesNotMatch(html, /📦 Qtd por Dia/);
});

test('Gantt: troca de loja (invalidação) volta o resumo pro estado oculto padrão', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-gantt"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_registros: mockColecao([{ id: 'r1', data: { produto: 'Produto A', maquina: 'ENVASADORA 1', qntCaixas: 100, status: 'pendente', data: '2026-08-24' } }]),
      producao_maquinas: mockColecao([{ id: 'm1', data: { nome: 'ENVASADORA 1' } }]),
      producao_setup: mockColecao([]), producao_categorias: mockColecao([]),
    }[nome] || mockColecao([])),
  });
  win.temPermissao = () => true;
  win.PRODUCAO_JORNADA = [0, 9, 9, 9, 9, 8, 0];
  win.buildProducaoSchedule = () => {
    const porDia = [[], [], [], [], [], [], []];
    porDia[1] = [{ tipo: 'producao', produto: 'Produto A', registroId: 'r1', caixasNoDia: 50, minutosNoDia: 120, inicioMin: 0, capacidadeDoDiaMin: 540 }];
    return { porMaquina: { 'ENVASADORA 1': { porDia, totalMinutosUsados: 120, capacidadeMinutosSemana: 2700 } } };
  };
  let _invalidar = () => {};
  win.DTProducao = { registrarInvalidacao: (fn) => { _invalidar = fn; } };
  win.eval(code);

  await win.renderProducaoGantt();
  document.querySelector('[data-pgantt-resumo-toggle]').click();
  assert.match(document.getElementById('page-producao-gantt').innerHTML, /Ocultar resumo/);

  _invalidar();
  await win.renderProducaoGantt();
  const html = document.getElementById('page-producao-gantt').innerHTML;
  assert.match(html, /Mostrar resumo/, 'depois de invalidar (troca de loja), o resumo deveria voltar a nascer oculto');
});

// CORREÇÃO (comparação com screenshot real do original rodando): a
// tentativa anterior (mover Observação pra logo depois de Produto) tinha
// sido baseada numa leitura desatualizada do código de referência. O app
// real mostra: Máquina → Produto → Qtd → Tempo → Setup → H.Prog →
// Observação → dias. Teste atualizado pra essa ordem real.
test('Gantt: coluna Observação fica depois de H.Prog e antes dos dias, igual ao original', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoGantt();
  const headerRow = document.querySelector('.pgantt-grid-row');
  const labels = [...headerRow.children].map(el => el.textContent.replace(/\s+/g, ' ').trim());
  const idxProduto = labels.findIndex(t => t.startsWith('Produto'));
  const idxObs = labels.findIndex(t => t.includes('Obser'));
  const idxQtd = labels.findIndex(t => t.includes('Qtd'));
  const idxProg = labels.findIndex(t => t.includes('H.'));
  assert.ok(idxProduto > -1 && idxObs > -1 && idxQtd > -1 && idxProg > -1, 'as colunas precisam existir no cabeçalho');
  assert.ok(idxQtd > idxProduto, 'Qtd precisa vir depois de Produto');
  assert.ok(idxObs > idxProg, 'Observação precisa vir depois de H.Prog, não logo depois de Produto');
});

// PEDIDO AO VIVO: a legenda do topo virou um texto de instruções
// genéricas ("clique pra editar", "arraste pra mover") — o original
// mostra os produtos ativos com a cor de cada um (pra identificar a
// barra pela cor). A legenda por produto (_legendaOPsSemana) já existia
// dentro do corpo da semana; só a legenda de instruções (duplicada,
// diferente do original) precisava sumir.
// PEDIDO AO VIVO (usuário: "o layout que eu quero que mude, verifica essa
// merda direito") — com mais de uma máquina, cada uma virava um card
// próprio com o cabeçalho de coluna (Máquina/Produto/Qtd/...) repetido
// dentro. O original tem 1 cabeçalho só, e cada máquina vira uma faixa
// fina (🏭 nome + % ocupação) dentro da MESMA grade contínua.
test('Gantt: com várias máquinas, o cabeçalho de colunas aparece 1x só (não repetido por card de máquina)', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-gantt"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_registros: mockColecao([
        { id: 'r1', data: { produto: 'Produto A', maquina: 'ENVASADORA 1', qntCaixas: 100, status: 'pendente', data: '2026-08-24' } },
        { id: 'r2', data: { produto: 'Produto B', maquina: 'MISTURADOR 1', qntCaixas: 80, status: 'pendente', data: '2026-08-24' } },
      ]),
      producao_maquinas: mockColecao([{ id: 'm1', data: { nome: 'ENVASADORA 1' } }, { id: 'm2', data: { nome: 'MISTURADOR 1' } }]),
      producao_setup: mockColecao([]), producao_categorias: mockColecao([]),
    }[nome] || mockColecao([])),
  });
  win.temPermissao = () => true;
  win.PRODUCAO_JORNADA = [0, 9, 9, 9, 9, 8, 0];
  win.buildProducaoSchedule = () => {
    const porDiaA = [[], [], [], [], [], [], []];
    porDiaA[1] = [{ tipo: 'producao', produto: 'Produto A', registroId: 'r1', caixasNoDia: 100, minutosNoDia: 120, inicioMin: 0, capacidadeDoDiaMin: 540 }];
    const porDiaB = [[], [], [], [], [], [], []];
    porDiaB[1] = [{ tipo: 'producao', produto: 'Produto B', registroId: 'r2', caixasNoDia: 80, minutosNoDia: 100, inicioMin: 0, capacidadeDoDiaMin: 540 }];
    return { porMaquina: {
      'ENVASADORA 1': { porDia: porDiaA, totalMinutosUsados: 120, capacidadeMinutosSemana: 2700 },
      'MISTURADOR 1': { porDia: porDiaB, totalMinutosUsados: 100, capacidadeMinutosSemana: 2700 },
    } };
  };
  win.DTProducao = { registrarInvalidacao: () => {} };
  win.eval(code);

  await win.renderProducaoGantt();
  const html = document.getElementById('page-producao-gantt').innerHTML;
  const ocorrenciasCabecalho = (html.match(/Set Up<br>h/g) || []).length;
  assert.equal(ocorrenciasCabecalho, 1, 'o cabeçalho de coluna (ex.: "Set Up") só pode aparecer 1 vez, não 1 por máquina');
  assert.match(html, /🏭 ENVASADORA 1/);
  assert.match(html, /🏭 MISTURADOR 1/, 'cada máquina ainda precisa da sua faixa separadora com nome e ocupação');
  // Só 1 container de card (.tc) envolvendo a grade inteira, não 1 por máquina.
  const cardsGrade = (html.match(/class="tc" style="padding:0;overflow:hidden"/g) || []).length;
  assert.equal(cardsGrade, 1, 'deve existir um único card envolvendo toda a grade, não um card por máquina');
});

test('Gantt: legenda do topo mostra produto+cor (igual ao original), não mais um texto de instruções genérico', async () => {
  const { win, document } = carregarPagina();
  await win.renderProducaoGantt();
  const html = document.getElementById('page-producao-gantt').innerHTML;
  assert.doesNotMatch(html, /Clique na barra: editar OP/, 'legenda de instruções genéricas não existe no original — não pode mais aparecer');
  assert.doesNotMatch(html, /Arraste: reprogramar dia/);
  assert.match(html, /Produto A/, 'legenda por produto (cor + nome) precisa continuar aparecendo, igual ao original');
});
