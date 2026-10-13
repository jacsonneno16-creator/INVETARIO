// PEDIDO AO VIVO (2026-09-02): "quando eu clico em programação automática
// ele mostra um monte de máquina, sem mostrar produto, sem mostrar
// quantidade" — investigado a fundo (comparado com o motor original em
// planejamento.js, achado em C:\Users\Daterrinha69\Sistema-Produ-o).
// DIAGNÓSTICO: gerarSugestoes() só considera produto com `projSemanal>0`
// (vindo de calcularProjecaoComRisco(), que por sua vez depende de
// venda_m1/m2/m3 em producao_projecao) — igual TUDO mais que mexemos hoje,
// esses campos estavam sempre vazios (só entrada manual/Excel) até o
// import da escadinha (66-producao-projecao.js, "Buscar do BI") existir.
// Sem demanda, a fila fica vazia e só a Auditoria (que roda por máquina
// independente de produto) aparece — exatamente o sintoma relatado. Este
// teste prova que, com demanda real presente (o que passa a acontecer na
// prática assim que o usuário roda o Buscar do BI da Projeção), o motor
// JÁ gera sugestão de produto/quantidade/semana/máquina corretamente —
// não faltava motor, faltava dado.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/67-producao-prog-automatica.js'), 'utf8');
// Igual ao analista.html de verdade, 63-producao-agenda.js carrega ANTES de
// 67-producao-prog-automatica.js — primeiroDiaUtil() depende de
// global.getTurnoMinutosDoDia (exportado por 63), então o teste precisa
// carregar os dois, na mesma ordem, senão os turnos cadastrados na máquina
// nunca são vistos (cai sempre no padrão seg-sex 540min).
const codeAgenda = fs.readFileSync(path.join(__dirname, '../js/analista/63-producao-agenda.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    add: async (payload) => { const id = 'novo' + (seq++); registro.set(id, payload); return { id }; },
    doc: (id) => ({ id, delete: async () => { registro.delete(id); } }),
    _registro: registro,
  };
}

function carregarPagina(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-prog-automatica"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const colRegistros = mockColecao(opts.registros || []);
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_produtos: mockColecao(opts.produtos || []),
      producao_maquinas: mockColecao(opts.maquinas || []),
      producao_registros: colRegistros,
      producao_setup: mockColecao([]),
      producao_ficha_tecnica: mockColecao(opts.fichas || []),
      producao_insumos_estoque: mockColecao(opts.insumosEstoque || []),
      pcp_pedidos: mockColecao(opts.pedidos || []),
    }[nome] || mockColecao([])),
  });
  win.calcularProjecaoComRisco = () => opts.projecao || [];
  win.carregarProducaoProjecao = async () => {};
  win.showToast = () => {};
  win.confirm = () => true;
  win.eval(codeAgenda);
  win.eval(code);
  return { win, document, colRegistros };
}

test('gerarSugestoes: SEM projSemanal (venda_m1/m2/m3 vazios, como estava até hoje) — auditoria aparece, mas nenhuma sugestão de produto', async () => {
  const { win, document } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 10, ativo: true } }],
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 10 } }],
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 0, estoqueAtual: 100 }], // sem demanda — o cenário de antes do fix da escadinha
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const html = document.getElementById('page-producao-prog-automatica').innerHTML;
  assert.match(html, /Configure os par.metros e gere/, 'sem demanda, a tabela de sugestões fica vazia — exatamente o sintoma relatado');
  assert.match(html, /Buscar do BI/, 'novo aviso explica a causa (falta projeção de vendas) e aponta pro Buscar do BI');
  assert.doesNotMatch(html, /Tapioca/);
});

test('gerarSugestoes: COM projSemanal (depois do "Buscar do BI" da Projeção de Vendas alimentar venda_m1/m2/m3) — gera produto/quantidade/semana/máquina de verdade', async () => {
  const { win, document } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 10, ativo: true, prioridadeProducao: 2 } }],
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 10 } }],
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 100 }], // cobertura ~1 dia, bem abaixo do mínimo (30d padrão)
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const html = document.getElementById('page-producao-prog-automatica').innerHTML;
  assert.match(html, /Tapioca/, 'produto aparece na tabela de sugestões');
  assert.match(html, /Extrusora 1/, 'máquina certa foi escolhida');
  assert.match(html, />\d+ cx</, 'quantidade de caixas foi calculada');
  assert.doesNotMatch(html, /Configure os par.metros e gere/, 'não fica mais no estado vazio');
  // PEDIDO AO VIVO (2026-09-03, 2ª rodada): "no original ele mostra o
  // produto aí, qual semana vai produzir, a quantidade" — a demanda deste
  // teste (700cx/sem, meta 20 dias) excede a capacidade de 1 semana só
  // (405cx com os parâmetros padrão), então o produto PRECISA aparecer em
  // mais de 1 semana do plano — mas como UMA LINHA só (Semana 1 + Total
  // Mês), nunca 4 linhas repetidas (1 por semana), como ficava antes.
  const internos = win._DTProgAutomaticaInternals || {};
  if (internos.getSugestoes) {
    const sugestoes = internos.getSugestoes().filter(s => !s.semMaquina);
    assert.equal(sugestoes.length, 1, 'só 1 linha consolidada pro produto, mesmo alocando em várias semanas');
    assert.ok(sugestoes[0].cxAlocadasTotal > sugestoes[0].qtyCaixas, 'Total Mês soma mais que só a Semana 1 — prova que consolidou as 4 semanas');
    assert.ok(Array.isArray(sugestoes[0].semanasArr) && sugestoes[0].semanasArr.length === 4, 'guarda o plano das 4 semanas pro mini-gráfico');
  }
});

// PEDIDO AO VIVO (2026-09-03): comparado por print lado a lado com o
// original — a tabela lá é agrupada POR MÁQUINA (card com nome + badge de
// crítico + resumo de cx/tempo/%máquina no topo), não uma lista corrida com
// a máquina numa coluna do meio. O motor já calculava tudo certo (provado
// no teste acima); só a apresentação precisava agrupar.
test('_desenharProgAutomatica: agrupa as sugestões POR MÁQUINA (card com nome + badge de crítico), igual ao original — não uma lista corrida', async () => {
  const { win, document } = carregarPagina({
    produtos: [
      { id: 'p1', data: { cod: '304', nome: 'Tapioca Crítica', maquina: 'Extrusora 1', pc_min: 10, ativo: true } },
      { id: 'p2', data: { cod: '305', nome: 'Farinha Normal', maquina: 'Extrusora 2', pc_min: 10, ativo: true } },
    ],
    maquinas: [
      { id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 10 } },
      { id: 'm2', data: { nome: 'Extrusora 2', ativo: true, pcMin: 10 } },
    ],
    projecao: [
      { cod: '304', produto: 'Tapioca Crítica', projSemanal: 700, estoqueAtual: 5 }, // cobertura ~0.5d — crítico
      { cod: '305', produto: 'Farinha Normal', projSemanal: 700, estoqueAtual: 100 }, // cobertura ~1d — abaixo do mínimo, não crítico
    ],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const html = document.getElementById('page-producao-prog-automatica').innerHTML;
  // Cabeçalho do grupo por máquina tem esse estilo específico (diferente do
  // card de Auditoria de capacidade, que também mostra o nome da máquina).
  const marcador = nome => `style="font-size:.86rem">${nome}</b>`;
  const cabecalho1 = html.indexOf(marcador('Extrusora 1')), cabecalho2 = html.indexOf(marcador('Extrusora 2'));
  assert.ok(cabecalho1 >= 0 && cabecalho2 >= 0, 'os dois cabeçalhos de grupo (máquina) aparecem');
  const cardExtrusora1 = html.slice(cabecalho1, cabecalho2 > cabecalho1 ? cabecalho2 : undefined);
  assert.match(cardExtrusora1, /crítico/, 'card da máquina com produto crítico mostra o badge');
  assert.match(cardExtrusora1, /Tapioca Crítica/, 'produto da própria máquina aparece dentro do card dela');
  assert.doesNotMatch(cardExtrusora1, /Farinha Normal/, 'produto de OUTRA máquina não aparece misturado no card errado');
  assert.match(html, /cx S1/, 'cabeçalho do grupo mostra o resumo de caixas da semana 1, igual ao original ("X cx S1 · Y cx/mês")');
});

// PEDIDO AO VIVO (2026-09-03, 2ª rodada): desde que a linha virou 1-por-
// produto (consolidando até 4 semanas), aplicar precisa criar 1 OP POR
// (semana × máquina) que teve alocação de verdade — igual ao original
// (aplicarProgAutomaticaNoGantt/buildPlanejamento) — não mais 1 OP só, e
// não mais 1 OP por linha da tabela (que já não existe mais 1-por-semana).
//
// PEDIDO AO VIVO (2026-09-07), correção FINAL (varredura completa do
// original, aplicarProgAutomaticaNoGantt, app.js:13950): tentei em rodadas
// anteriores fazer esta função pré-fatiar cada semana em 1 OP POR DIA
// (chamando distribuirDias aqui) — mas lendo o original com calma do
// início ao fim, ele NUNCA faz isso: cria só 1 registro por produto×
// semana×máquina, com a quantidade da semana INTEIRA, datado pro 1º dia
// útil daquela máquina. Quem espalha a produção pelos dias de verdade no
// Gantt é o motor de agenda (buildProducaoSchedule, 63-producao-agenda.js),
// na hora de RENDERIZAR — não a gravação. Pré-fatiar aqui era redundante
// (duplicava o trabalho que o motor de agenda já faz) e prejudicial (vários
// registros pequenos do mesmo produto interagindo com o cursor de outros
// produtos na mesma máquina bagunçava a Programação Visual, mesmo com o
// cálculo certo por trás). Voltado a 1 OP por semana×máquina, como o
// original.
test('aplicarProducaoAutomatica: cria 1 OP por (semana × máquina) com a quantidade INTEIRA da semana — não fatia por dia (quem espalha pelos dias é o motor de agenda, na hora de desenhar o Gantt)', async () => {
  const { win, colRegistros } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 10, ativo: true } }],
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 10 } }],
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 5 }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const sugestoes = win._DTProgAutomaticaInternals.getSugestoes().filter(s => !s.semMaquina);
  assert.equal(sugestoes.length, 1, 'pré-condição: 1 linha consolidada pro produto');
  const semanasComAlocacao = sugestoes[0].semanasArr.filter(cx => cx > 0).length;
  assert.ok(semanasComAlocacao >= 2, 'pré-condição: a demanda deste teste precisa de mais de 1 semana pra ser atendida');
  await win.aplicarProducaoAutomatica();
  const ops = [...colRegistros._registro.values()];
  assert.equal(ops.length, semanasComAlocacao, 'exatamente 1 OP por semana com alocação — nunca 1 por dia');
  const totalCxGravado = ops.reduce((s, r) => s + (r.qntCaixas || 0), 0);
  assert.equal(totalCxGravado, sugestoes[0].cxAlocadasTotal, 'soma das OPs gravadas bate exatamente com o Total Mês mostrado na tabela');
});

// PEDIDO AO VIVO (2026-09-07): a data de cada OP tem que ser o 1º dia ÚTIL
// da máquina naquela semana, igual ao original (buildPlanejamento,
// app.js:13986-13991) — nunca sempre a segunda-feira quando a máquina não
// trabalha às segundas.
test('aplicarProducaoAutomatica: data da OP é o 1º dia útil da máquina na semana (não sempre segunda)', async () => {
  const { win, colRegistros } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 10, ativo: true } }],
    // Turnos cadastrados só a partir de quarta (dia 3) — segunda/terça
    // ficam de fora do objeto `turnos` de propósito: getTurnoMinutosDoDia
    // (63-producao-agenda.js) retorna 0 pra qualquer dia ausente do objeto
    // quando `turnos` já está definido (só cai no padrão seg-sex 540min
    // quando `turnos` inteiro está ausente/undefined).
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 10, turnos: {
      3: [{ ini: '08:00', fim: '17:00', ativo: true }], 4: [{ ini: '08:00', fim: '17:00', ativo: true }], 5: [{ ini: '08:00', fim: '17:00', ativo: true }],
    } } }],
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 300, estoqueAtual: 50 }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  await win.aplicarProducaoAutomatica();
  const ops = [...colRegistros._registro.values()];
  assert.ok(ops.length > 0, 'pré-condição: alguma OP foi gravada');
  ops.forEach(r => {
    const dia = new Date(r.data + 'T12:00:00').getDay();
    assert.ok(dia === 3 || dia === 4 || dia === 5, `data ${r.data} (dia da semana ${dia}) deveria cair num dia com turno cadastrado (qua/qui/sex), não segunda/terça sem turno`);
  });
});

// PEDIDO AO VIVO (2026-09-07), 3ª correção: "mudo a cobertura ali pra
// trinta, em vez dos produtos aumentar a quantidade não aumenta" —
// confirmado por reprodução isolada: o produto tinha metaCoberturaDias
// configurada (PCP → Parâmetros) e essa meta SEMPRE vencia o parâmetro
// da própria tela, silenciosamente. Decisão do usuário (pergunta direta,
// respondida ao vivo): o slider da tela manda sempre — a meta por produto
// não participa mais deste cálculo específico.
test('gerarSugestoes: "Cobertura Alvo" da tela manda sempre, mesmo quando o produto tem metaCoberturaDias própria configurada', async () => {
  const capacidadeFolgada = { produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true, metaCoberturaDias: 15 } }], maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }], projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 100 }] };

  const { win: win20, document: doc20 } = carregarPagina(capacidadeFolgada);
  await win20.renderProducaoProgAutomatica();
  doc20.getElementById('ppa-cobertura-alvo').value = '20';
  win20.gerarProducaoAutomaticaAvancada(false);
  const total20 = win20._DTProgAutomaticaInternals.getSugestoes().filter(s => !s.semMaquina)[0].cxAlocadasTotal;

  const { win: win40, document: doc40 } = carregarPagina(capacidadeFolgada);
  await win40.renderProducaoProgAutomatica();
  doc40.getElementById('ppa-cobertura-alvo').value = '40';
  win40.gerarProducaoAutomaticaAvancada(false);
  const total40 = win40._DTProgAutomaticaInternals.getSugestoes().filter(s => !s.semMaquina)[0].cxAlocadasTotal;

  assert.notEqual(total20, total40, 'com capacidade de sobra, mudar o slider de 20 pra 40 dias muda a quantidade total, mesmo o produto tendo metaCoberturaDias:15 configurada');
  assert.ok(total40 > total20, 'cobertura maior produz mais, não menos');
});

// PEDIDO AO VIVO (2026-09-07): "coloco vinte e quatro sugestões... aí mudo
// pra semana e recalculo... as horas de produção continua trezentos e
// quarenta e oito" — achado por leitura de código: o KPI "Horas de
// Produção" somava só reg.minutosSemanas[0] (Semana 1) pra TODAS as
// sugestões, mesmo em modo Mês — produtos cuja necessidade só aparece nas
// semanas 2-4 tinham minutosSemanas[0]=0 e não entravam na conta. Em modo
// Semana só existe a semana 0 mesmo, então o valor batia por coincidência,
// escondendo que o modo Mês estava subcontando as horas de verdade.
test('_desenharProgAutomatica: KPI "Horas de Produção" soma o plano INTEIRO (todas as semanas), não só a Semana 1', async () => {
  const { win, document } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 10, ativo: true } }],
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 10 } }],
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 5 }], // demanda excede a capacidade de 1 semana só — precisa de várias semanas
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const sugestoes = win._DTProgAutomaticaInternals.getSugestoes().filter(s => !s.semMaquina);
  const somaMinutosTotal = sugestoes.reduce((s, x) => s + (x.minutosTotal || x.minutos || 0), 0);
  const somaSoSemana1 = sugestoes.reduce((s, x) => s + (x.minutos || 0), 0);
  assert.ok(somaMinutosTotal > somaSoSemana1, 'pré-condição: este cenário produz em mais de uma semana, então o total do plano é maior que só a Semana 1');
  const html = document.getElementById('page-producao-prog-automatica').innerHTML;
  const horasEsperadas = (somaMinutosTotal / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const horasAntigasEsperadas = (somaSoSemana1 / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  assert.match(html, new RegExp(horasEsperadas.replace('.', '\\.') + 'h'), 'KPI mostra as horas do plano inteiro (minutosTotal), não só da Semana 1');
  assert.doesNotMatch(html, new RegExp('>' + horasAntigasEsperadas.replace('.', '\\.') + 'h<'), 'não mostra mais o valor antigo (só Semana 1), que subcontava o plano de várias semanas');
});

// PEDIDO AO VIVO (2026-09-07): "ele não pode colocar o mesmo produto em
// três máquinas diferentes se ele consegue produzir tudo em uma máquina só
// em vários dias... agora se realmente necessitar [risco crítico], aí sim
// usar as três máquinas ao mesmo tempo" — o score anterior preferia sempre
// a máquina MENOS carregada no instante da passagem do round-robin,
// espalhando um produto por todas as máquinas compatíveis mesmo quando uma
// só já dava conta da semana inteira. Corrigido com bônus de continuidade
// (ficar na mesma máquina já usada) e concentração (preferir a máquina que
// sozinha resolve tudo) — só ignorado quando o produto está em risco
// crítico (cobertura ≤ cobertura crítica), onde velocidade importa mais.
test('gerarSugestoes: produto NÃO crítico com capacidade de sobra numa máquina só fica NUMA máquina só, não se espalha pelas 3 compatíveis', async () => {
  const { win } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Milho Pipoca', pc_min: 10, ativo: true } }],
    maquinas: [
      { id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 10, produtosCompativeis: [{ produto: 'Milho Pipoca', velocidade: 10 }] } },
      { id: 'm2', data: { nome: 'Extrusora 2', ativo: true, pcMin: 10, produtosCompativeis: [{ produto: 'Milho Pipoca', velocidade: 10 }] } },
      { id: 'm3', data: { nome: 'Extrusora 3', ativo: true, pcMin: 10, produtosCompativeis: [{ produto: 'Milho Pipoca', velocidade: 10 }] } },
    ],
    // diária≈42.9cx, alvo(20d)≈857, estoque=700 -> necessidade da 1ª
    // semana≈157cx; nas semanas seguintes, só repor o consumo semanal
    // (300cx) já é suficiente pra manter a cobertura alvo. Cada máquina
    // sozinha comporta ~405cx/semana (capacidade padrão sem turnos
    // configurados) — tanto a semana 1 quanto a reposição semanal cabem
    // numa máquina só, em NENHUMA das 4 semanas do plano é preciso somar
    // uma 2ª máquina.
    projecao: [{ cod: '304', produto: 'Milho Pipoca', projSemanal: 300, estoqueAtual: 700 }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const s = win._DTProgAutomaticaInternals.getSugestoes().filter(s => !s.semMaquina)[0];
  assert.ok(s, 'produto entra na programação');
  assert.equal(s.maquinasUsadas.length, 1, 'não crítico e cabe numa máquina só — não deveria se espalhar pelas 3 compatíveis');
});

test('gerarSugestoes: produto EM RISCO CRÍTICO pode usar várias máquinas compatíveis ao mesmo tempo pra correr atrás mais rápido', async () => {
  const { win } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Milho Pipoca', pc_min: 10, ativo: true } }],
    maquinas: [
      { id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 10, produtosCompativeis: [{ produto: 'Milho Pipoca', velocidade: 10 }] } },
      { id: 'm2', data: { nome: 'Extrusora 2', ativo: true, pcMin: 10, produtosCompativeis: [{ produto: 'Milho Pipoca', velocidade: 10 }] } },
      { id: 'm3', data: { nome: 'Extrusora 3', ativo: true, pcMin: 10, produtosCompativeis: [{ produto: 'Milho Pipoca', velocidade: 10 }] } },
    ],
    // pcMin é UNIDADES POR MINUTO (não caixas/hora) — com unid=1 padrão,
    // 1 máquina sozinha comporta bem mais que os ~405cx/semana de antes
    // (era o cálculo com a fórmula errada). Pra continuar forçando o
    // cenário "precisa mesmo de mais de 1 máquina", a demanda aqui é bem
    // maior (necessidade >> capacidade de 1 máquina só).
    projecao: [{ cod: '304', produto: 'Milho Pipoca', projSemanal: 70000, estoqueAtual: 20 }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const s = win._DTProgAutomaticaInternals.getSugestoes().filter(s => !s.semMaquina)[0];
  assert.ok(s, 'produto entra na programação');
  assert.ok(s.maquinasUsadas.length > 1, 'risco crítico com necessidade acima da capacidade de 1 máquina — precisa usar mais de uma pra correr atrás');
});

// PEDIDO AO VIVO (2026-09-07): "os cálculos não estão certos... coloco pra
// calcular o mês, aí muda pra semana e recalcula, as horas de produção
// continuam as mesmas" — achado por rastreamento empírico (não suposição):
// `fila` era montada com `{...e,...}` (cópia rasa) a cada semana, então
// `e.estoque+=cx` durante o round-robin só mutava a cópia daquela semana,
// nunca voltava pro array `estados` (fonte da fila da semana SEGUINTE).
// Resultado: toda semana recomeçava a calcular necessidade a partir do
// estoque original (sem a produção que ELA MESMA tinha acabado de sugerir
// na semana anterior), inflando a quantidade sugerida a cada semana do mês
// sem nunca reconhecer o reabastecimento. Este teste prova que, com o fix,
// cada semana usa o estoque JÁ CONSIDERANDO a produção das semanas
// anteriores deste mesmo cálculo, convergindo pra exatamente a cobertura
// alvo, sem escalar.
test('gerarSugestoes: produção de uma semana entra no estoque projetado da semana SEGUINTE (não recomeça do zero a cada semana)', async () => {
  const { win } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }], // capacidade bem folgada — não é o gargalo aqui
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }],
    // diária=100cx, alvo padrão corrigido=30d=3000, estoque inicial=1700 ->
    // necessidade da semana 1 = 1300cx. Se a semana 1 entregar as 1300cx
    // (estoque vira 3000), a semana 2 só precisa repor o consumo (700cx),
    // nunca mais que isso — se o bug estivesse de volta, a semana 2 pediria
    // bem mais (o motor "esqueceria" que já produziu 300 na semana 1).
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 1700 }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const s = win._DTProgAutomaticaInternals.getSugestoes().filter(x => !x.semMaquina)[0];
  assert.ok(s, 'produto entra na programação');
  assert.equal(s.semanasArr[0], 1300, 'semana 1: exatamente o necessário pra fechar a cobertura alvo corrigida de 30 dias (3000 - 1700)');
  assert.equal(s.semanasArr[1], 700, 'semana 2: só repõe o consumo da semana (700) — nunca mais, prova que reconheceu os 300 já produzidos na semana 1');
  assert.equal(s.semanasArr[2], 700, 'semana 3: mesma reposição estável, sem escalar semana após semana');
  assert.equal(s.cxAlocadasTotal, 1300 + 700 + 700 + 700, 'total do mês é a soma exata das 4 semanas, sem inflar');
});

// PEDIDO AO VIVO (2026-09-07): "ficou um negócio estranho, produzindo o
// mesmo produto várias vezes em vários dias... vinte e cinco caixas por
// dia. Por que não pegou logo e não produziu essas caixas todas dentro de
// um dia só?" — distribuirDias() dividia a quantidade PROPORCIONALMENTE
// pelo peso (horas de turno) de cada dia disponível, sem saber quantas
// caixas cabem de fato num dia — fatiava em pedacinhos iguais mesmo quando
// o lote inteiro cabia num dia só. Agora recebe a velocidade da máquina e
// preenche os dias em sequência, só passando pro dia seguinte quando o
// atual não tem mais espaço.
test('distribuirDias: lote pequeno que cabe na capacidade de 1 dia fica INTEIRO num dia só — não fatia em pedacinhos pela semana toda', async () => {
  const { win } = carregarPagina({});
  await win.renderProducaoProgAutomatica();
  const distribuirDias = win._DTProgAutomaticaInternals.distribuirDias;
  const week = { inicio: new Date(2026, 8, 7), fim: new Date(2026, 8, 13) }; // segunda a domingo
  const maquina = {}; // sem turnos cadastrados -> cai no padrão Seg-Sex 540min/dia
  // pcMin é unidades/minuto (não caixas/hora); com unidPorCx=1 (padrão,
  // não passado aqui), pcMin=1 -> 1min/cx -> um turno padrão de 540min
  // comporta 540cx/dia, bem mais que as 126cx necessárias — cabe inteiro
  // num dia só.
  const dias = distribuirDias(126, week, maquina, 1);
  assert.equal(dias.length, 1, '126cx cabem inteiras num dia só — não devem virar 5 fatias de ~25cx espalhadas pela semana');
  assert.equal(dias[0].caixas, 126);
  assert.equal(dias[0].dia, 'Seg');
});

test('distribuirDias: lote grande demais pra 1 dia continua sendo dividido em SEQUÊNCIA (não mais proporcional por peso)', async () => {
  const { win } = carregarPagina({});
  await win.renderProducaoProgAutomatica();
  const distribuirDias = win._DTProgAutomaticaInternals.distribuirDias;
  const week = { inicio: new Date(2026, 8, 7), fim: new Date(2026, 8, 13) };
  const maquina = {};
  // pcMin=1 unid/min, unidPorCx=1 (padrão) -> 540cx/dia de capacidade;
  // pedindo 1300cx precisa de 3 dias (540+540+220), preenchendo Seg/Ter
  // até o talo antes de abrir Qua — nunca uma fatia igual e pequena em
  // todos os 5 dias úteis.
  const dias = distribuirDias(1300, week, maquina, 1);
  assert.equal(dias.length, 3, 'usa só os dias que realmente precisa (3), não os 5 dias úteis disponíveis');
  assert.equal(dias[0].caixas, 540); assert.equal(dias[0].dia, 'Seg');
  assert.equal(dias[1].caixas, 540); assert.equal(dias[1].dia, 'Ter');
  assert.equal(dias[2].caixas, 220); assert.equal(dias[2].dia, 'Qua');
});

// PEDIDO AO VIVO (2026-09-07), 2ª rodada: print real mostrando Milho Pipoca
// e Canjica Branca cada um dividido em 2 máquinas com só 20% de ocupação
// cada — mesmo com uma delas sobrando espaço de sobra.
//
// PEDIDO AO VIVO (2026-09-07), varredura geral: depois de portar o motor de
// concentração do original (achar 1 máquina que absorve tudo tem
// prioridade rígida sobre espalhar — sem round-robin fatiado, sem bônus de
// continuidade artificial), os 2 produtos podem legitimamente acabar na
// MESMA máquina (se ela sozinha comporta os dois) — isso não é bug, é
// exatamente a "concentração" fazendo seu trabalho; o nivelamento entre
// máquinas ociosas é uma fase SEPARADA (ainda não construída, equivalente
// ao "PASSO 4" do original). O que importa aqui é que NENHUM produto fica
// fatiado dentro de si mesmo.
test('gerarSugestoes: dois produtos disputando as mesmas 2 máquinas — nenhum fica fatiado, mesmo em risco crítico, quando uma máquina sozinha dá conta do seu próprio total', async () => {
  const { win } = carregarPagina({
    produtos: [
      { id: 'p1', data: { cod: '1614', nome: 'Canjica Branca', pc_min: 100, ativo: true, multiploProducao: 1167 } },
      { id: 'p2', data: { cod: '1618', nome: 'Milho Pipoca', pc_min: 100, ativo: true } },
    ],
    maquinas: [
      { id: 'm1', data: { nome: 'Alfateck 14', ativo: true, pcMin: 100, produtosCompativeis: [{ produto: 'Canjica Branca', velocidade: 100 }, { produto: 'Milho Pipoca', velocidade: 100 }] } },
      { id: 'm2', data: { nome: 'Alfateck 15', ativo: true, pcMin: 100, produtosCompativeis: [{ produto: 'Canjica Branca', velocidade: 100 }, { produto: 'Milho Pipoca', velocidade: 100 }] } },
    ],
    projecao: [
      { cod: '1614', produto: 'Canjica Branca', projSemanal: 200, estoqueAtual: 50 },
      { cod: '1618', produto: 'Milho Pipoca', projSemanal: 800, estoqueAtual: 200 }, // cobertura ~1,75d — "crítico" pelo limiar padrão, mas cabe numa máquina só
    ],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const sugestoes = win._DTProgAutomaticaInternals.getSugestoes().filter(s => !s.semMaquina);
  const milho = sugestoes.find(s => s.cod === '1618'), canjica = sugestoes.find(s => s.cod === '1614');
  assert.ok(milho && canjica);
  assert.equal(milho.maquinasUsadas.length, 1, 'Milho Pipoca (mesmo em risco crítico) fica numa máquina só — ela sozinha dava conta');
  assert.equal(canjica.maquinasUsadas.length, 1, 'Canjica Branca fica numa máquina só');
});

// PEDIDO AO VIVO (2026-09-07), varredura geral: "você sempre diz que
// ajustou, mas fica sempre do mesmo jeito" — achada a causa raiz de fundo:
// aplicarSugestoesSelecionadas() só ADICIONAVA OPs novas via .add(), nunca
// removia as sugestões automáticas ANTIGAS do mesmo produto/semana (nem as
// de antes de qualquer correção). Recalcular e aplicar de novo só
// empilhava em cima do que já existia — o Gantt continuava mostrando o
// resultado velho (às vezes SÓ o velho, se a nova sugestão não cobria mais
// aquele produto). Estes testes provam a limpeza: some o que é seguro
// substituir, nunca mexe no que não é.
test('aplicarProducaoAutomatica: substitui OPs automáticas ANTIGAS (pendentes, sem produção) do mesmo produto/semana em vez de empilhar em cima', async () => {
  const produtos = [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }];
  const maquinas = [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }];
  const projecao = [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 1700 }];
  const { win: sonda } = carregarPagina({ produtos, maquinas, projecao });
  await sonda.renderProducaoProgAutomatica();
  const semana0Iso = sonda._DTProgAutomaticaInternals.semanaIsoDoIndice(0);

  const { win, colRegistros } = carregarPagina({
    produtos, maquinas, projecao,
    registros: [{ id: 'antigoPendente', data: { produto: 'Tapioca', prodCod: '304', maquina: 'Extrusora 1', status: 'pendente', origem: 'programacao_automatica', semanaPlanejada: semana0Iso, qntCaixas: 50, data: semana0Iso } }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  await win.aplicarProducaoAutomatica();
  assert.ok(!colRegistros._registro.has('antigoPendente'), 'a OP automática antiga pendente do mesmo produto/semana foi removida antes de aplicar a nova');
  assert.ok([...colRegistros._registro.values()].some(r => r.produto === 'Tapioca'), 'a OP nova foi criada normalmente no lugar dela');
});

test('aplicarProducaoAutomatica: NUNCA remove OP criada manualmente (sem origem programacao_automatica), mesmo do mesmo produto/semana', async () => {
  const produtos = [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }];
  const maquinas = [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }];
  const projecao = [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 1700 }];
  const { win: sonda } = carregarPagina({ produtos, maquinas, projecao });
  await sonda.renderProducaoProgAutomatica();
  const semana0Iso = sonda._DTProgAutomaticaInternals.semanaIsoDoIndice(0);

  const { win, colRegistros } = carregarPagina({
    produtos, maquinas, projecao,
    registros: [{ id: 'manual1', data: { produto: 'Tapioca', prodCod: '304', maquina: 'Extrusora 1', status: 'pendente', semanaPlanejada: semana0Iso, qntCaixas: 50, data: semana0Iso } }], // sem origem: criada manualmente na tela de Programação
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  await win.aplicarProducaoAutomatica();
  assert.ok(colRegistros._registro.has('manual1'), 'OP manual nunca é removida pela limpeza automática');
});

test('aplicarProducaoAutomatica: NUNCA remove OP automática que já tem produção real apontada (mesmo pendente)', async () => {
  const produtos = [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }];
  const maquinas = [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }];
  const projecao = [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 1700 }];
  const { win: sonda } = carregarPagina({ produtos, maquinas, projecao });
  await sonda.renderProducaoProgAutomatica();
  const semana0Iso = sonda._DTProgAutomaticaInternals.semanaIsoDoIndice(0);

  const { win, colRegistros } = carregarPagina({
    produtos, maquinas, projecao,
    registros: [{ id: 'jaProduzindo', data: { produto: 'Tapioca', prodCod: '304', maquina: 'Extrusora 1', status: 'pendente', origem: 'programacao_automatica', semanaPlanejada: semana0Iso, qntCaixas: 300, qntProduzida: 120, data: semana0Iso } }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  await win.aplicarProducaoAutomatica();
  assert.ok(colRegistros._registro.has('jaProduzindo'), 'OP com produção real já apontada nunca é removida, mesmo sendo automática e "pendente"');
});

test('aplicarProducaoAutomatica: NUNCA remove OP automática já concluída', async () => {
  const produtos = [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }];
  const maquinas = [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }];
  const projecao = [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 1700 }];
  const { win: sonda } = carregarPagina({ produtos, maquinas, projecao });
  await sonda.renderProducaoProgAutomatica();
  const semana0Iso = sonda._DTProgAutomaticaInternals.semanaIsoDoIndice(0);

  const { win, colRegistros } = carregarPagina({
    produtos, maquinas, projecao,
    registros: [{ id: 'concluida1', data: { produto: 'Tapioca', prodCod: '304', maquina: 'Extrusora 1', status: 'concluido', origem: 'programacao_automatica', semanaPlanejada: semana0Iso, qntCaixas: 300, data: semana0Iso } }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  await win.aplicarProducaoAutomatica();
  assert.ok(colRegistros._registro.has('concluida1'), 'OP automática já concluída nunca é removida');
});

// PEDIDO AO VIVO (2026-09-07): "calcula certo, mas quando vai pra
// Programação Visual fica tudo errado — verifica o que acontece na hora de
// enviar" — achado um risco real ao investigar: aplicarSugestoesSelecionadas()
// recalculava `semanas` do ZERO a partir do formulário (parametros() +
// semanasPlanejamento()) no momento do clique em Aplicar, em vez de reusar
// as MESMAS semanas que geraram `_sugestoes`. Como `detalhesSemanas[0..3]`
// é posicional (índice de semana, não a data em si), se o período no
// formulário mudasse entre "Gerar/Recalcular" e "Aplicar" (usuário troca o
// mês/semana sem recalcular de novo antes de aplicar), as OPs eram
// gravadas nas datas do período NOVO (errado), não do período que foi
// realmente calculado. Corrigido: as semanas usadas no cálculo agora ficam
// congeladas e Aplicar sempre reusa exatamente elas.
test('aplicarProducaoAutomatica: usa as MESMAS semanas do cálculo, mesmo se o período do formulário mudar antes de clicar em Aplicar', async () => {
  const { win, document, colRegistros } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }],
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }],
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 100 }],
  });
  await win.renderProducaoProgAutomatica();
  // Modo padrão é "mês" (4 semanas) — captura as 4 datas ORIGINAIS que
  // vão alimentar o cálculo, antes de qualquer drift no formulário.
  const semanasOriginais = [0, 1, 2, 3].map(i => win._DTProgAutomaticaInternals.semanaIsoDoIndice(i));
  win.gerarProducaoAutomaticaAvancada(false);

  // Simula o formulário "andando" pra outro período ANTES do clique em
  // Aplicar (ex.: usuário mexeu no seletor sem recalcular de novo).
  const selMes = document.getElementById('ppa-mes');
  if (selMes) {
    const outraOpcao = document.createElement('option');
    outraOpcao.value = '2099-01'; // ano/mês bem diferente, impossível de coincidir
    outraOpcao.textContent = 'janeiro de 2099';
    selMes.appendChild(outraOpcao);
    selMes.value = '2099-01';
  }
  const radioSemana = document.querySelector('input[name="ppa-modo"][value="semana"]');
  if (radioSemana) radioSemana.checked = true; // também tenta "virar" o modo, sem recalcular

  await win.aplicarProducaoAutomatica();
  const ops = [...colRegistros._registro.values()];
  assert.ok(ops.length > 0, 'pré-condição: alguma OP foi gravada');
  assert.ok(ops.every(r => semanasOriginais.includes(r.semanaPlanejada)), 'toda OP usa uma das semanas do CÁLCULO original (mês inteiro, até 4 semanas) — nunca uma semana fora desse conjunto');
  assert.ok(ops.every(r => !r.data.startsWith('2099')), 'nenhuma OP foi gravada no período errado (2099) que o formulário passou a mostrar depois de calcular');
});

// PEDIDO AO VIVO (2026-09-07): "tem produto que está com onze dias, no
// final da produção está ficando com doze — isso não é pra ficar desse
// jeito" — achado com reprodução isolada (não suposição): registro() só
// criava a linha consolidada do produto NA HORA da 1ª alocação bem-
// sucedida, ou seja, DEPOIS de `e.estoque+=cx` já ter somado a primeira
// caixa alocada — as colunas "Cobertura Atual"/"Estoque" mostradas na
// tabela nasciam com o valor JÁ PARCIALMENTE PRODUZIDO, não o valor real
// de antes de calcular. Isso escondia o quanto a produção realmente
// melhorou a cobertura (o "antes" aparecia artificialmente perto do
// "depois"). Este teste prova que "Cobertura Atual" reflete o estoque
// ANTES de qualquer produção desta semana, não depois.
test('gerarSugestoes: "Cobertura Atual" reflete o estado ANTES da produção — não fica poluída pela 1ª alocação já aplicada', async () => {
  const { win } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }],
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }], // capacidade bem folgada — o produto atinge o alvo todo numa passada só
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 1204, estoqueAtual: 1991 }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const s = win._DTProgAutomaticaInternals.getSugestoes().filter(x => !x.semMaquina)[0];
  assert.ok(s, 'produto entra na programação');
  const diaria = 1204 / 7;
  const coberturaAntesEsperada = 1991 / diaria; // ~11.6d
  assert.ok(Math.abs(s.coberturaAtual - coberturaAntesEsperada) < 0.5, `Cobertura Atual deveria ser ~${coberturaAntesEsperada.toFixed(1)}d (estoque de antes), veio ${s.coberturaAtual.toFixed(1)}d`);
  assert.equal(s.estoque, 1991, 'Estoque mostrado é o valor de ANTES da produção, não o já somado com a 1ª caixa alocada');
  assert.ok(s.coberturaPos > s.coberturaAtual + 1, 'Cobertura Final é claramente maior que Cobertura Atual — o progresso real aparece, não fica escondido');
});

// PEDIDO AO VIVO (2026-09-07): "cada [produto] é vinte e oito vírgula zero
// cinco por minuto, pacotinhos. Cada caixa vem doze" — achado com repro
// isolada usando esses números exatos: pcMin é UNIDADES POR MINUTO, não
// caixas por hora (confirmado batendo com 63-producao-agenda.js:
// `cxPerMin=pcMin/unidPorCx`, e 62-producao-programacao.js:
// `_calcTempoHoras=qntUnid/pcMin/60` — os dois já certos). Este arquivo
// usava `minCx=60/pcMin`, tratando pcMin como caixas/hora — superestimava
// o tempo de produção em ~5x pros valores reais do usuário (28,05
// unid/min), fazendo o motor achar que a máquina já estava cheia bem antes
// da capacidade de verdade acabar — por isso produtos ficavam presos bem
// abaixo do alvo mesmo com a máquina "sobrando" espaço na tela.
test('gerarSugestoes: pcMin é unidades por minuto (não caixas/hora) — produto chega no alvo de cobertura em vez de ficar preso bem abaixo por causa de tempo de produção superestimado', async () => {
  const { win } = carregarPagina({
    // Números exatos do usuário: 28,05 unid/min, caixa de 12 unidades.
    produtos: [{ id: 'p1', data: { cod: '80643', nome: 'Milho Pipoca', maquina: 'Alfateck 15', pc_min: 28.05, unid: 12, ativo: true } }],
    maquinas: [{ id: 'm1', data: { nome: 'Alfateck 15', ativo: true, pcMin: 28.05 } }],
    projecao: [{ cod: '80643', produto: 'Milho Pipoca', projSemanal: 5696, estoqueAtual: 7240 }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const s = win._DTProgAutomaticaInternals.getSugestoes().filter(x => !x.semMaquina)[0];
  assert.ok(s, 'produto entra na programação');
  // diária=813.71, alvo(20d padrão)=16274, necessidade=16274-7240=9034 —
  // 1 máquina só, com o teto de 90% da capacidade (padrão), comporta
  // 5680cx/semana com a fórmula CERTA (28,05 unid/min) — bem mais que os
  // ~1262cx que a fórmula antiga (60/pcMin, tratando pcMin como
  // caixas/hora) produzia pros mesmos números reais do usuário.
  assert.ok(s.qtyCaixas > 4000, `deveria produzir bem mais que ~1262cx (o valor da fórmula antiga, errada) — veio ${s.qtyCaixas}`);
  assert.ok(s.coberturaPos >= 15, `cobertura final deveria melhorar bem mais que só ~10.4d (o resultado da fórmula antiga) — veio ${s.coberturaPos.toFixed(1)}`);
});

// PEDIDO AO VIVO (2026-09-07): "a produção vai ser baseada em cima do
// saldo, se o saldo está negativo ele tem que pôr o saldo pra chegar a
// zero e depois repor pra chegar aos trinta dias. Pra não produzir e
// acabar tendo pedido e já vai zerar logo em seguida" — pedidos pendentes
// (pcp_pedidos, mesma fórmula de "comprometido" de 78-pcp-central.js) agora
// descontam do estoque ANTES da necessidade ser calculada.
// Modo Semana (1 semana só) isola o efeito do comprometido sem o confundir
// com o consumo natural das semanas seguintes (que por si só já pediria
// reposição, mesmo sem nenhum pedido pendente).
function marcarModoSemana(document) {
  const radio = document.querySelector('input[name="ppa-modo"][value="semana"]');
  if (radio) radio.checked = true;
}

test('gerarSugestoes: pedidos pendentes (comprometido) descontam do estoque antes de calcular a necessidade', async () => {
  const produtos = [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }];
  const maquinas = [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }];
  const projecao = [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 3000 }]; // sem pedido: já cobre os 30d (alvo corrigido) sozinho

  const { win: semPedido, document: docSemPedido } = carregarPagina({ produtos, maquinas, projecao });
  await semPedido.renderProducaoProgAutomatica();
  marcarModoSemana(docSemPedido);
  semPedido.gerarProducaoAutomaticaAvancada(false);
  const sSemPedido = semPedido._DTProgAutomaticaInternals.getSugestoes().filter(x => !x.semMaquina)[0];
  assert.equal(sSemPedido?.cxAlocadasTotal || 0, 0, 'sem pedido pendente, estoque=3000 já cobre o alvo (30d=3000) — nenhuma produção necessária nesta semana');

  const { win: comPedido, document: docComPedido } = carregarPagina({
    produtos, maquinas, projecao,
    pedidos: [{ id: 'ped1', data: { prodCod: '304', produto: 'Tapioca', quantidade: 1500, quantidadeAtendida: 0, status: 'pendente' } }],
  });
  await comPedido.renderProducaoProgAutomatica();
  marcarModoSemana(docComPedido);
  comPedido.gerarProducaoAutomaticaAvancada(false);
  const sComPedido = comPedido._DTProgAutomaticaInternals.getSugestoes().filter(x => !x.semMaquina)[0];
  assert.ok(sComPedido, 'com 1500cx comprometidas, estoque líquido (3000-1500=1500) fica abaixo do alvo — precisa produzir');
  // necessidade = alvo(3000) - estoqueLiquido(1500) = 1500cx.
  assert.equal(sComPedido.semanasArr[0], 1500, `deveria produzir exatamente os 1500cx que faltam pro alvo depois de descontar o pedido — veio ${sComPedido.semanasArr[0]}`);
});

test('gerarSugestoes: pedido CANCELADO não desconta do estoque', async () => {
  const { win, document } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }],
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }],
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 3000 }],
    pedidos: [{ id: 'ped1', data: { prodCod: '304', produto: 'Tapioca', quantidade: 1500, quantidadeAtendida: 0, status: 'cancelado' } }],
  });
  await win.renderProducaoProgAutomatica();
  marcarModoSemana(document);
  win.gerarProducaoAutomaticaAvancada(false);
  const s = win._DTProgAutomaticaInternals.getSugestoes().filter(x => !x.semMaquina)[0];
  assert.equal(s?.cxAlocadasTotal || 0, 0, 'pedido cancelado não é comprometido de verdade — estoque=3000 continua cobrindo o alvo sozinho, nenhuma produção necessária nesta semana');
});

test('gerarSugestoes: pedido parcialmente atendido desconta só o que falta atender', async () => {
  const { win } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca', maquina: 'Extrusora 1', pc_min: 1000, ativo: true } }],
    maquinas: [{ id: 'm1', data: { nome: 'Extrusora 1', ativo: true, pcMin: 1000 } }],
    projecao: [{ cod: '304', produto: 'Tapioca', projSemanal: 700, estoqueAtual: 3000 }],
    // pedido de 1500, já atendeu 1400 -> falta atender só 100.
    pedidos: [{ id: 'ped1', data: { prodCod: '304', produto: 'Tapioca', quantidade: 1500, quantidadeAtendida: 1400, status: 'pendente' } }],
  });
  await win.renderProducaoProgAutomatica();
  win.gerarProducaoAutomaticaAvancada(false);
  const s = win._DTProgAutomaticaInternals.getSugestoes().filter(x => !x.semMaquina)[0];
  assert.ok(s, 'estoque líquido (3000-100=2900) fica abaixo do alvo (3000) — entra na fila de produção');
  // necessidade = alvo(3000) - estoqueLiquido(2900) = 100cx (só o que falta atender do pedido).
  assert.equal(s.semanasArr[0], 100, `deveria descontar só os 100cx ainda não atendidos, não os 1500cx do pedido inteiro — veio ${s.semanasArr[0]}`);
});
