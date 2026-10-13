'use strict';
// Logística › Estoque › Relatórios — FASE D (2026-10-02): implementação real
// das 4 telas (125-estoque-relatorios.js). Cobre exatamente o que o plano
// pediu pra esta fase: filtros/agrupamento/totais calculam certo a partir de
// uma resposta mockada do callable; nenhum setInterval sem limpeza; nenhum
// onclick="" inline, mesmo depois de carregar dados de verdade e redesenhar
// a tabela (não só no estado inicial "em construção" da Fase A).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '125-estoque-relatorios.js'), 'utf8');

function montarAmbiente({ callableResposta, lojaId } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="page-estoque-rel-inventario"></div>
    <div id="page-estoque-rel-descarte"></div>
    <div id="page-estoque-rel-requisicao"></div>
    <div id="page-estoque-rel-transformacao"></div>
  </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTLojaAtiva = () => (lojaId || 'loja1');
  win.showToast = () => {};
  win.temPermissao = () => true;
  win.aplicarPermissoesAnalista = () => {};
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: false };
  const chamadas = [];
  win.firebase = {
    app: () => ({
      functions: () => ({
        httpsCallable: (nome, opcoes) => async (payload) => {
          chamadas.push({ nome, payload, opcoes });
          if (nome === 'buscarRelatorioEstoqueBigQuery') return { data: callableResposta || { linhas: [], totais: { lancamentos: 0, quantidade: 0, valor: 0, produtosDistintos: 0 }, ultimaAtualizacao: null } };
          if (nome === 'sincronizarEstoqueBluesoftAgora') return { data: { ok: true, concluido: true, proximoDia: null } };
          return { data: {} };
        },
      }),
    }),
  };
  win.eval(CODIGO);
  win._chamadas = chamadas;
  return win;
}

// Polling de Chart.js no popup da análise completa: aceito porque é limitado
// (máx. 80 tentativas) e tem clearInterval em todos os caminhos de saída.
test('125-estoque-relatorios.js: todo setInterval tem clearInterval (polling sempre limitado e limpo)', () => {
  const abrir = (CODIGO.match(/setInterval\(/g) || []).length;
  const fechar = (CODIGO.match(/clearInterval\(/g) || []).length;
  assert.ok(fechar >= abrir, 'setInterval sem clearInterval correspondente');
});

test('_agrupar: agrupamento "produto" soma quantidade/valor por produto e conta lançamentos certo', () => {
  const win = montarAmbiente();
  const { RELATORIOS, _agrupar } = win._estoqueRelatoriosInternals;
  const linhas = [
    { produto_key: 'p1', produto_descricao: 'Produto 1', quantidade: 10, valor: 100 },
    { produto_key: 'p1', produto_descricao: 'Produto 1', quantidade: 5, valor: 50 },
    { produto_key: 'p2', produto_descricao: 'Produto 2', quantidade: 3, valor: 30 },
  ];
  const agrupado = _agrupar(RELATORIOS.inventario, linhas, 'produto');
  assert.equal(agrupado.linhas.length, 2);
  const p1 = agrupado.linhas.find(l => l.rotulo === 'Produto 1');
  assert.equal(p1.lancamentos, 2);
  assert.equal(p1.quantidade, 15);
  assert.equal(p1.valor, 150);
  const p2 = agrupado.linhas.find(l => l.rotulo === 'Produto 2');
  assert.equal(p2.lancamentos, 1);
  assert.equal(p2.quantidade, 3);
});

test('_agrupar: agrupamento "dia" soma por data_movimento', () => {
  const win = montarAmbiente();
  const { RELATORIOS, _agrupar } = win._estoqueRelatoriosInternals;
  const linhas = [
    { data_movimento: '2026-04-01', quantidade: 1, valor: 10 },
    { data_movimento: '2026-04-01', quantidade: 2, valor: 20 },
    { data_movimento: '2026-04-02', quantidade: 4, valor: 40 },
  ];
  const agrupado = _agrupar(RELATORIOS.descarte, linhas, 'dia');
  assert.equal(agrupado.linhas.length, 2);
  const dia1 = agrupado.linhas.find(l => l.rotulo === '01/04/2026');
  assert.equal(dia1.quantidade, 3);
  assert.equal(dia1.valor, 30);
});

test('_agrupar: "Por inventário" mostra o NOME (inventario_descricao) junto do número, não só o código — PEDIDO AO VIVO 2026-10-03', () => {
  const win = montarAmbiente();
  const { RELATORIOS, _agrupar } = win._estoqueRelatoriosInternals;
  const comNome = _agrupar(RELATORIOS.inventario, [{ inventario_key: '49305', inventario_numero: '49305', inventario_descricao: 'Inventário Mensal Junho', quantidade: 1, valor: 1 }], 'inventario');
  assert.equal(comNome.linhas[0].rotulo, 'Inventário Mensal Junho (49305)');

  const semNome = _agrupar(RELATORIOS.inventario, [{ inventario_key: '49305', inventario_numero: '49305', inventario_descricao: null, quantidade: 1, valor: 1 }], 'inventario');
  assert.equal(semNome.linhas[0].rotulo, '49305', 'sem descrição ainda coletada, cai pro número/código');
});

test('_agrupar: transformação agrupa "produto" pelo DESTINO e "origem" pela ORIGEM — não são a mesma coisa', () => {
  const win = montarAmbiente();
  const { RELATORIOS, _agrupar } = win._estoqueRelatoriosInternals;
  const linhas = [
    { produto_origem_key: 'oA', produto_origem_descricao: 'Origem A', produto_destino_key: 'dX', produto_destino_descricao: 'Destino X', saida_quantidade: 10, saida_valor: 100, entrada_quantidade: 8, entrada_valor: 80 },
    { produto_origem_key: 'oA', produto_origem_descricao: 'Origem A', produto_destino_key: 'dY', produto_destino_descricao: 'Destino Y', saida_quantidade: 5, saida_valor: 50, entrada_quantidade: 4, entrada_valor: 40 },
  ];
  const porDestino = _agrupar(RELATORIOS.transformacao, linhas, 'produto');
  assert.equal(porDestino.linhas.length, 2, 'destinos diferentes (dX/dY) não podem cair na mesma linha');
  const porOrigem = _agrupar(RELATORIOS.transformacao, linhas, 'origem');
  assert.equal(porOrigem.linhas.length, 1, 'mesma origem (oA) tem que juntar as 2 linhas');
  assert.equal(porOrigem.linhas[0].saida_quantidade, 15);
  assert.equal(porOrigem.linhas[0].entrada_quantidade, 12);
});

test('_agrupar: "lancamento" devolve null (sinal pra tela usar a tabela flat, sem agrupar)', () => {
  const win = montarAmbiente();
  const { RELATORIOS, _agrupar } = win._estoqueRelatoriosInternals;
  assert.equal(_agrupar(RELATORIOS.inventario, [{ produto_key: 'p1' }], 'lancamento'), null);
});

test('renderEstoqueRelInventario → clicar em Buscar chama o callable certo e preenche os KPIs com os totais da resposta', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [{ produto_key: 'p1', produto_descricao: 'Produto 1', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false }],
      totais: { lancamentos: 1, quantidade: 10, valor: 100, produtosDistintos: 1 },
      ultimaAtualizacao: '2026-04-01',
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  assert.match(pagina.innerHTML, /Escolha o período e clique em Buscar/);

  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));

  assert.equal(win._chamadas.length, 1);
  assert.equal(win._chamadas[0].nome, 'buscarRelatorioEstoqueBigQuery');
  assert.equal(win._chamadas[0].payload.relatorio, 'inventario');
  // PEDIDO AO VIVO (2026-10-03) "filtro de loja pra todos": a tela não manda
  // mais lojaId nenhum — o servidor decide quais lojas o login enxerga.
  assert.equal(win._chamadas[0].payload.lojaId, undefined);

  const html = pagina.innerHTML;
  assert.match(html, />10,00</, 'KPI de quantidade com o total da resposta');
  assert.match(html, /R\$ 100,00/, 'KPI de valor com o total da resposta');
  assert.match(html, /Produto 1/);
  assert.doesNotMatch(html, /onclick=/, 'nenhum onclick inline mesmo com a tabela real desenhada');
});

test('renderEstoqueRelDescarte → "incluir estornos" desmarcado por padrão é respeitado no payload enviado ao callable', async () => {
  const win = montarAmbiente({ callableResposta: { linhas: [], totais: { lancamentos: 0, quantidade: 0, valor: 0, produtosDistintos: 0 }, ultimaAtualizacao: null } });
  win.renderEstoqueRelDescarte();
  const pagina = win.document.getElementById('page-estoque-rel-descarte');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(win._chamadas[0].payload.incluirEstornos, false);
});

test('renderEstoqueRelInventario: trocar "Ver por" pra Produto redesenha a tabela agrupada (coluna "Produto"/"Lançamentos" no lugar das colunas originais)', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [
        { produto_key: 'p1', produto_descricao: 'Produto 1', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false },
        { produto_key: 'p1', produto_descricao: 'Produto 1', data_movimento: '2026-04-02', quantidade: 5, valor: 50, eh_estorno: false },
      ],
      totais: { lancamentos: 2, quantidade: 15, valor: 150, produtosDistintos: 1 },
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));

  const select = pagina.querySelector('[data-estoque-agrupamento]');
  select.value = 'produto';
  select.dispatchEvent(new win.Event('change', { bubbles: true }));

  const html = pagina.innerHTML;
  assert.match(html, /Lançamentos/);
  assert.match(html, />2</, 'os 2 lançamentos do produto único somados numa linha só');
  assert.doesNotMatch(html, /onclick=/);
});

// ═══════════════════════════════════════════════════════════════════════
// PEDIDO AO VIVO (2026-10-03) #1: mostrar a descrição do produto como
// coluna principal, caindo pro código só quando a descrição ainda não foi
// coletada (fallback "chave|chave").
// ═══════════════════════════════════════════════════════════════════════
test('_valorColuna: chave composta "descricao|codigo" usa a descrição quando existe, cai pro código quando não existe', () => {
  const win = montarAmbiente();
  const { _valorColuna } = win._estoqueRelatoriosInternals;
  assert.equal(_valorColuna({ produto_descricao: 'Arroz 5kg', produto_key: 'p1' }, 'produto_descricao|produto_key'), 'Arroz 5kg');
  assert.equal(_valorColuna({ produto_descricao: null, produto_key: 'p1' }, 'produto_descricao|produto_key'), 'p1', 'sem descrição ainda coletada, cai pro código');
  assert.equal(_valorColuna({ produto_descricao: '', produto_key: 'p1' }, 'produto_descricao|produto_key'), 'p1', 'descrição vazia também conta como "sem descrição"');
});

test('renderEstoqueRelInventario: a tabela mostra a DESCRIÇÃO do produto como coluna principal "Produto", com o código numa coluna "Código" separada', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [{ produto_key: '28962', produto_descricao: 'Farinha de Trigo 1kg', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false }],
      totais: { lancamentos: 1, quantidade: 10, valor: 100, produtosDistintos: 1 },
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const html = pagina.innerHTML;
  assert.match(html, /<th[^>]*>Produto</, 'coluna "Produto" existe (a descrição)');
  assert.match(html, /<th[^>]*>Código</, 'coluna "Código" separada existe');
  assert.match(html, /Farinha de Trigo 1kg/, 'a descrição real aparece na tabela');
});

test('renderEstoqueRelInventario: produto SEM descrição ainda coletada mostra o código na coluna "Produto" (nunca uma célula vazia)', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [{ produto_key: '77928', produto_descricao: null, data_movimento: '2026-04-01', quantidade: 4, valor: 0, eh_estorno: false }],
      totais: { lancamentos: 1, quantidade: 4, valor: 0, produtosDistintos: 1 },
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  // "77928" tem que aparecer na tabela (caiu pro código) — não pode sobrar
  // "—" na coluna de produto por falta de fallback.
  assert.match(pagina.innerHTML, /77928/);
});

// ═══════════════════════════════════════════════════════════════════════
// PEDIDO AO VIVO (2026-10-03) #2: clicar num inventário em "Por
// inventário" entra só naquele inventário (drill-down).
// ═══════════════════════════════════════════════════════════════════════
test('Drill-down "Por inventário": clicar numa linha agrupada filtra pra mostrar só os lançamentos daquele inventário, com botão de voltar', async () => {
  const win = montarAmbiente({
    callableResposta: {
      // loja_id/loja_nome presentes porque a chave do agrupamento "Por
      // inventário" agora é composta (loja+inventário) — PEDIDO AO VIVO
      // (2026-10-03) "filtro de loja pra todos": com várias lojas numa
      // busca só, o MESMO código de inventário pode existir em lojas
      // diferentes, então não basta mais o código sozinho pra identificar.
      linhas: [
        { produto_key: 'p1', produto_descricao: 'Produto 1', loja_id: 'loja1', loja_nome: 'Loja 1', inventario_key: 'invA', inventario_numero: 'INV-001', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false },
        { produto_key: 'p2', produto_descricao: 'Produto 2', loja_id: 'loja1', loja_nome: 'Loja 1', inventario_key: 'invB', inventario_numero: 'INV-002', data_movimento: '2026-04-02', quantidade: 5, valor: 50, eh_estorno: false },
      ],
      totais: { lancamentos: 2, quantidade: 15, valor: 150, produtosDistintos: 2 },
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));

  const select = pagina.querySelector('[data-estoque-agrupamento]');
  select.value = 'inventario';
  select.dispatchEvent(new win.Event('change', { bubbles: true }));

  const linhaInvA = pagina.querySelector('[data-estoque-drill-inventario="loja1|invA"]');
  assert.ok(linhaInvA, 'linha agrupada do inventário invA (loja1) precisa estar clicável');
  linhaInvA.dispatchEvent(new win.Event('click', { bubbles: true }));

  let html = pagina.innerHTML;
  assert.match(html, /Produto 1/, 'mostra o lançamento do inventário invA');
  assert.doesNotMatch(html, /Produto 2/, 'não mostra o lançamento do OUTRO inventário (invB)');
  assert.match(html, /Voltar pro agrupamento/);

  pagina.querySelector('[data-estoque-voltar-drill]').dispatchEvent(new win.Event('click', { bubbles: true }));
  html = pagina.innerHTML;
  // Voltando pro AGRUPADO (não mais o flat), a tabela mostra os rótulos de
  // inventário, não a descrição de produto — essa só aparece no drill-down.
  assert.match(html, /INV-001/);
  assert.match(html, /INV-002/, 'voltando, os 2 inventários aparecem nos agrupados de novo');
  assert.doesNotMatch(html, /Voltar pro agrupamento/, 'o botão de voltar some depois de já ter voltado');
});

test('Drill-down: trocar o agrupamento enquanto estiver "dentro" de um inventário sai do drill-down automaticamente', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [{ produto_key: 'p1', inventario_key: 'invA', inventario_numero: 'INV-001', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false }],
      totais: { lancamentos: 1, quantidade: 10, valor: 100, produtosDistintos: 1 },
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const estado = win._estoqueRelatoriosInternals._estadoDe('inventario');
  estado.agrupamento = 'inventario';
  estado.drillInventarioKey = 'invA';
  estado.drillInventarioRotulo = 'INV-001';

  const select = pagina.querySelector('[data-estoque-agrupamento]');
  select.value = 'dia';
  select.dispatchEvent(new win.Event('change', { bubbles: true }));

  assert.equal(estado.drillInventarioKey, null);
});

// ═══════════════════════════════════════════════════════════════════════
// PEDIDO AO VIVO (2026-10-03) #3: filtro de produto em lista com checkbox
// (estilo Excel), filtrando em cima do que já foi buscado — NUNCA um novo
// pedido ao servidor por clique. "Não é ficar escrevendo um por um."
// ═══════════════════════════════════════════════════════════════════════
test('Filtro de produto: nunca manda produto/produtosIncluir/produtosExcluir no payload — o filtro é 100% client-side', async () => {
  const win = montarAmbiente({ callableResposta: { linhas: [], totais: { lancamentos: 0, quantidade: 0, valor: 0, produtosDistintos: 0 }, ultimaAtualizacao: null } });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  assert.ok(!pagina.querySelector('[data-estoque-produto]'), 'não existe mais campo de texto único');
  assert.ok(!pagina.querySelector('[data-estoque-chip-input]'), 'não existe mais chip de incluir/excluir');

  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(win._chamadas[0].payload.produto, undefined);
  assert.equal(win._chamadas[0].payload.produtosIncluir, undefined);
  assert.equal(win._chamadas[0].payload.produtosExcluir, undefined);
});

test('Filtro de produto (estilo Excel): abre a lista com todos os produtos do período já marcados, desmarcar 1 filtra a tabela e recalcula os KPIs na hora (sem nova chamada ao servidor)', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [
        { produto_key: 'p1', produto_descricao: 'Arroz 5kg', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false },
        { produto_key: 'p2', produto_descricao: 'Feijão 1kg', data_movimento: '2026-04-02', quantidade: 5, valor: 50, eh_estorno: false },
      ],
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const chamadasAntes = win._chamadas.length;

  pagina.querySelector('[data-estoque-filtro-produto-toggle]').dispatchEvent(new win.Event('click', { bubbles: true }));
  let html = pagina.innerHTML;
  assert.match(html, /Arroz 5kg/, 'lista do dropdown mostra os produtos do período (pela descrição)');
  assert.match(html, /Feijão 1kg/);

  const checkboxFeijao = pagina.querySelector('[data-estoque-filtro-produto-item="p2"]');
  assert.ok(checkboxFeijao.checked, 'tudo começa marcado (sem filtro = mostra tudo)');
  checkboxFeijao.checked = false;
  checkboxFeijao.dispatchEvent(new win.Event('change', { bubbles: true }));

  // A LISTA do dropdown continua mostrando os 2 produtos (desmarcado ainda
  // precisa aparecer pra poder remarcar) — só a TABELA embaixo reflete o
  // filtro, por isso a checagem é na tabela especificamente, não na página
  // inteira (que inclui o dropdown ainda aberto).
  const tabela = pagina.querySelector('[data-estoque-tabela]').innerHTML;
  assert.match(tabela, /Arroz 5kg/, 'Arroz continua aparecendo na tabela');
  assert.doesNotMatch(tabela, /Feijão 1kg/, 'Feijão sumiu da tabela — desmarcado no filtro');
  html = pagina.innerHTML;
  assert.match(html, />1</, 'KPI de lançamentos recalculado pro 1 que sobrou');
  assert.match(html, />10,00</, 'KPI de quantidade recalculado (só o Arroz)');
  assert.equal(win._chamadas.length, chamadasAntes, 'nenhuma chamada nova ao servidor só por filtrar');
});

test('Filtro de produto: "Limpar" esconde tudo, "Selecionar todos" volta a mostrar tudo', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [{ produto_key: 'p1', produto_descricao: 'Arroz 5kg', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false }],
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelDescarte();
  const pagina = win.document.getElementById('page-estoque-rel-descarte');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  pagina.querySelector('[data-estoque-filtro-produto-toggle]').dispatchEvent(new win.Event('click', { bubbles: true }));

  pagina.querySelector('[data-estoque-filtro-produto-limpar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.match(pagina.innerHTML, /Nenhum lançamento com os filtros de produto\/loja\/lançamento selecionados/);

  // O dropdown continua aberto depois de "Limpar" (clicar no toggle de novo
  // FECHARIA ele, já que ele já tá aberto) — clica direto em "Selecionar todos".
  pagina.querySelector('[data-estoque-filtro-produto-todos]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.match(pagina.querySelector('[data-estoque-tabela]').innerHTML, /Arroz 5kg/, 'Selecionar todos trouxe o lançamento de volta');
});

test('Filtro de produto: buscar dentro do dropdown filtra só a LISTA de checkboxes (não a tabela), sem refazer a tela inteira', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [
        { produto_key: 'p1', produto_descricao: 'Arroz 5kg', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false },
        { produto_key: 'p2', produto_descricao: 'Feijão 1kg', data_movimento: '2026-04-02', quantidade: 5, valor: 50, eh_estorno: false },
      ],
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelRequisicao();
  const pagina = win.document.getElementById('page-estoque-rel-requisicao');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  pagina.querySelector('[data-estoque-filtro-produto-toggle]').dispatchEvent(new win.Event('click', { bubbles: true }));

  const buscaInput = pagina.querySelector('[data-estoque-filtro-produto-busca]');
  buscaInput.value = 'arroz';
  buscaInput.dispatchEvent(new win.Event('input', { bubbles: true }));

  const lista = pagina.querySelector('[data-estoque-filtro-produto-lista]');
  assert.match(lista.innerHTML, /Arroz 5kg/);
  assert.doesNotMatch(lista.innerHTML, /Feijão 1kg/, 'busca escondeu o Feijão da LISTA do dropdown');
  // A tabela por baixo não foi afetada pela busca do dropdown (só filtra a
  // lista de checkboxes, não os lançamentos — ninguém desmarcou nada ainda).
  assert.match(pagina.innerHTML, /Feijão 1kg/, 'a tabela continua mostrando os 2 — a busca é só da lista do dropdown');
});

test('"Atualizar agora": período de ~1 ano que precisa de VÁRIAS rodadas (proximoDia) chama sincronizarEstoqueBluesoftAgora de novo até concluido=true, sem parar nas 8 tentativas antigas', async () => {
  const win = montarAmbiente({ callableResposta: { linhas: [], totais: { lancamentos: 0, quantidade: 0, valor: 0, produtosDistintos: 0 }, ultimaAtualizacao: '2026-06-30' } });
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  let chamadasSync = 0;
  const opcoesPorChamada = [];
  win.firebase.app = () => ({
    functions: () => ({
      httpsCallable: (nome, opcoes) => async (payload) => {
        win._chamadas.push({ nome, payload });
        if (nome === 'sincronizarEstoqueBluesoftAgora') opcoesPorChamada.push(opcoes);
        if (nome === 'sincronizarEstoqueBluesoftAgora') {
          chamadasSync++;
          // Simula 12 rodadas (mais que as 8 antigas) antes de concluir —
          // prova que o cap novo (20) aguenta um backfill de ~1 ano.
          if (chamadasSync < 12) return { data: { ok: true, concluido: false, proximoDia: '2026-0' + (1 + (chamadasSync % 9)) + '-01' } };
          return { data: { ok: true, concluido: true, proximoDia: null } };
        }
        return { data: { linhas: [], totais: { lancamentos: 0, quantidade: 0, valor: 0, produtosDistintos: 0 }, ultimaAtualizacao: null } };
      },
    }),
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  const estado = win._estoqueRelatoriosInternals._estadoDe('inventario');
  estado.periodoInicio = '2025-10-03';
  estado.periodoFim = '2026-10-03';

  pagina.querySelector('[data-estoque-atualizar-agora]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));

  assert.equal(chamadasSync, 12, 'precisou de 12 rodadas e todas aconteceram (não travou nas 8 antigas)');
  assert.ok(opcoesPorChamada.every(o => o && o.timeout === 540000), 'BUG AO VIVO REAL — sem isso o SDK desiste sozinho em ~70s ("deadline-exceeded") bem antes da function (540s) terminar');
});

test('"Atualizar agora": "vou precisar ficar atualizando várias vezes?" — movimentos já concluídos (concluido=true) mas produtosPendentes/inventariosItensPendentes ainda true chama de novo sozinho, sem o usuário precisar clicar manualmente', async () => {
  const win = montarAmbiente({ callableResposta: { linhas: [], totais: { lancamentos: 0, quantidade: 0, valor: 0, produtosDistintos: 0 }, ultimaAtualizacao: null } });
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  let chamadasSync = 0;
  win.firebase.app = () => ({
    functions: () => ({
      httpsCallable: (nome) => async (payload) => {
        win._chamadas.push({ nome, payload });
        if (nome === 'sincronizarEstoqueBluesoftAgora') {
          chamadasSync++;
          // Movimentos sempre concluido=true (nada a ver com proximoDia) —
          // só produto/item de inventário ainda pendentes nas 2 primeiras
          // rodadas, terminando de verdade na 3ª.
          if (chamadasSync === 1) return { data: { ok: true, concluido: true, proximoDia: null, produtosPendentes: true, inventariosItensPendentes: false } };
          if (chamadasSync === 2) return { data: { ok: true, concluido: true, proximoDia: null, produtosPendentes: false, inventariosItensPendentes: true } };
          return { data: { ok: true, concluido: true, proximoDia: null, produtosPendentes: false, inventariosItensPendentes: false } };
        }
        return { data: { linhas: [], totais: { lancamentos: 0, quantidade: 0, valor: 0, produtosDistintos: 0 }, ultimaAtualizacao: null } };
      },
    }),
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-atualizar-agora]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));

  assert.equal(chamadasSync, 3, 'continuou chamando sozinho enquanto produto/item de inventário ainda tinham pendência');
});

// ═══════════════════════════════════════════════════════════════════════
// PEDIDO AO VIVO (2026-10-03) #4: "filtro de loja pra todos" — a tela busca
// em todas as lojas que o login enxerga de uma vez (o servidor decide quais
// via lojasPermitidas/acesso_todas_lojas, nunca manda lojaId do cliente) e
// deixa filtrar por loja com o MESMO estilo de lista com checkbox do
// produto, nos 4 relatórios.
// ═══════════════════════════════════════════════════════════════════════
test('Coluna "Loja": aparece na tabela com o nome da loja (loja_nome), não o id', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [{ produto_key: 'p1', produto_descricao: 'Arroz 5kg', loja_id: 'loja1', loja_nome: 'Matriz', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false }],
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const html = pagina.innerHTML;
  assert.match(html, /<th[^>]*>Loja</, 'coluna "Loja" existe');
  assert.match(html, /Matriz/, 'nome da loja aparece na tabela');
});

test('Filtro de loja (estilo Excel): abre a lista com todas as lojas do período já marcadas, desmarcar 1 filtra tabela+KPIs sem nova chamada ao servidor', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [
        { produto_key: 'p1', produto_descricao: 'Arroz 5kg', loja_id: 'loja1', loja_nome: 'Matriz', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false },
        { produto_key: 'p2', produto_descricao: 'Feijão 1kg', loja_id: 'loja2', loja_nome: 'Filial Sul', data_movimento: '2026-04-02', quantidade: 5, valor: 50, eh_estorno: false },
      ],
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelInventario();
  const pagina = win.document.getElementById('page-estoque-rel-inventario');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const chamadasAntes = win._chamadas.length;

  pagina.querySelector('[data-estoque-filtro-loja-toggle]').dispatchEvent(new win.Event('click', { bubbles: true }));
  let html = pagina.innerHTML;
  assert.match(html, /Matriz/);
  assert.match(html, /Filial Sul/);

  const checkboxFilial = pagina.querySelector('[data-estoque-filtro-loja-item="loja2"]');
  assert.ok(checkboxFilial.checked, 'tudo começa marcado (sem filtro = mostra todas as lojas)');
  checkboxFilial.checked = false;
  checkboxFilial.dispatchEvent(new win.Event('change', { bubbles: true }));

  const tabela = pagina.querySelector('[data-estoque-tabela]').innerHTML;
  assert.match(tabela, /Arroz 5kg/, 'Matriz continua aparecendo');
  assert.doesNotMatch(tabela, /Feijão 1kg/, 'Filial Sul sumiu da tabela — desmarcada no filtro');
  html = pagina.innerHTML;
  assert.match(html, />1</, 'KPI de lançamentos recalculado pro 1 que sobrou');
  assert.equal(win._chamadas.length, chamadasAntes, 'nenhuma chamada nova ao servidor só por filtrar loja');
});

test('Filtro de loja: "Limpar" esconde tudo, "Selecionar todas" volta a mostrar tudo', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [{ produto_key: 'p1', produto_descricao: 'Arroz 5kg', loja_id: 'loja1', loja_nome: 'Matriz', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false }],
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelDescarte();
  const pagina = win.document.getElementById('page-estoque-rel-descarte');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  pagina.querySelector('[data-estoque-filtro-loja-toggle]').dispatchEvent(new win.Event('click', { bubbles: true }));

  pagina.querySelector('[data-estoque-filtro-loja-limpar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.match(pagina.innerHTML, /Nenhum lançamento com os filtros de produto\/loja\/lançamento selecionados/);

  pagina.querySelector('[data-estoque-filtro-loja-todos]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.match(pagina.querySelector('[data-estoque-tabela]').innerHTML, /Arroz 5kg/, 'Selecionar todas trouxe o lançamento de volta');
});

// ═══════════════════════════════════════════════════════════════════════
// PEDIDO AO VIVO (2026-10-03) #5: "colocar filtro do tipo de lançamento" —
// mesmo estilo Excel dos filtros de produto/loja, sobre tipo_movimento.
// ═══════════════════════════════════════════════════════════════════════
test('Filtro de lançamento (estilo Excel): abre a lista com todos os tipos do período já marcados, desmarcar 1 filtra tabela+KPIs sem nova chamada ao servidor', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [
        { produto_key: 'p1', produto_descricao: 'Arroz 5kg', tipo_movimento: 'Troca Descarte (Perda)', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false },
        { produto_key: 'p2', produto_descricao: 'Feijão 1kg', tipo_movimento: 'Descarte de Troca de Produto', data_movimento: '2026-04-02', quantidade: 5, valor: 50, eh_estorno: false },
      ],
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelDescarte();
  const pagina = win.document.getElementById('page-estoque-rel-descarte');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const chamadasAntes = win._chamadas.length;

  pagina.querySelector('[data-estoque-filtro-lancamento-toggle]').dispatchEvent(new win.Event('click', { bubbles: true }));
  let html = pagina.innerHTML;
  assert.match(html, /Troca Descarte \(Perda\)/);
  assert.match(html, /Descarte de Troca de Produto/);

  const checkboxTroca = pagina.querySelector('[data-estoque-filtro-lancamento-item="Descarte de Troca de Produto"]');
  assert.ok(checkboxTroca.checked, 'tudo começa marcado (sem filtro = mostra todos os lançamentos)');
  checkboxTroca.checked = false;
  checkboxTroca.dispatchEvent(new win.Event('change', { bubbles: true }));

  const tabela = pagina.querySelector('[data-estoque-tabela]').innerHTML;
  assert.match(tabela, /Arroz 5kg/, 'o outro tipo de lançamento continua aparecendo');
  assert.doesNotMatch(tabela, /Feijão 1kg/, 'sumiu da tabela — desmarcado no filtro de lançamento');
  html = pagina.innerHTML;
  assert.match(html, />1</, 'KPI de lançamentos recalculado pro 1 que sobrou');
  assert.equal(win._chamadas.length, chamadasAntes, 'nenhuma chamada nova ao servidor só por filtrar lançamento');
});

test('Filtro de lançamento: "Limpar" esconde tudo, "Selecionar todos" volta a mostrar tudo', async () => {
  const win = montarAmbiente({
    callableResposta: {
      linhas: [{ produto_key: 'p1', produto_descricao: 'Arroz 5kg', tipo_movimento: 'Troca Descarte (Perda)', data_movimento: '2026-04-01', quantidade: 10, valor: 100, eh_estorno: false }],
      ultimaAtualizacao: null,
    },
  });
  win.renderEstoqueRelDescarte();
  const pagina = win.document.getElementById('page-estoque-rel-descarte');
  pagina.querySelector('[data-estoque-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  pagina.querySelector('[data-estoque-filtro-lancamento-toggle]').dispatchEvent(new win.Event('click', { bubbles: true }));

  pagina.querySelector('[data-estoque-filtro-lancamento-limpar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.match(pagina.innerHTML, /Nenhum lançamento com os filtros de produto\/loja\/lançamento selecionados/);

  pagina.querySelector('[data-estoque-filtro-lancamento-todos]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.match(pagina.querySelector('[data-estoque-tabela]').innerHTML, /Arroz 5kg/, 'Selecionar todos trouxe o lançamento de volta');
});

test('admin vê o botão "Atualizar agora"; usuário comum não vê', () => {
  const semAdmin = montarAmbiente();
  semAdmin.renderEstoqueRelInventario();
  assert.doesNotMatch(semAdmin.document.getElementById('page-estoque-rel-inventario').innerHTML, /Atualizar agora/);

  const comAdmin = montarAmbiente();
  comAdmin.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true };
  comAdmin.renderEstoqueRelInventario();
  assert.match(comAdmin.document.getElementById('page-estoque-rel-inventario').innerHTML, /Atualizar agora/);
});
