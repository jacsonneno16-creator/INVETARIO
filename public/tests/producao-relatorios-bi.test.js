// PEDIDO AO VIVO (2026-08-27): "já aplica as outras, os outros arquivos...
// mapeia pra saber pra onde que vai cada informação, do compra, pcp e
// produção" — os 11 arquivos do BI restantes são, na maioria, relatórios já
// calculados (estoque x pedido, MRP, escadinha, consumo de insumos,
// ranking de fornecedor); viram consulta somente-leitura em
// 101-relatorios-bi.js, sem gravar nada no Firebase (nem leitura nem
// escrita), organizados em abas por setor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/101-relatorios-bi.js'), 'utf8');

let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function mockColecaoSomenteLeitura(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return { get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }), _registro: registro };
}

function carregarPagina(dtBiPastaLocalMock, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-relatorios-bi"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  win.showToast = () => {};
  win.aplicarPermissoesAnalista = () => {};
  win.DTBiPastaLocal = dtBiPastaLocalMock;
  const colecoes = opts.colecoes || {};
  win.getDTRawFirestore = () => ({ collection: (nome) => colecoes[nome] || mockColecaoSomenteLeitura([]) });
  // producao_produtos/pcp_produtos_bluesoft (cadastro real, loja ativa) —
  // mesmo objeto `colecoes`, nomes não colidem com as coleções globais acima.
  win.getDTFirestore = () => ({ collection: (nome) => colecoes[nome] || mockColecaoSomenteLeitura([]) });
  if (opts.firebase) win.firebase = opts.firebase;
  else win.firebase = { app:()=>({ functions:()=>({ httpsCallable:(nome)=>async(payload)=>{
    if(nome!=='buscarHistoricoComprasBigQuery') throw new Error('função não mockada: '+nome);
    const col=colecoes.relatorios_bi_compras_historico_chunks;
    const snap=col?await col.get():{docs:[]};
    const linhas=[]; snap.docs.forEach(d=>{const data=d.data()||{}; const regs=data.registros||{}; Object.values(regs).forEach(x=>linhas.push(x));});
    return {data:{ok:true,linhas}};
  } }) }) };
  win.eval(code);
  return { win, document, colecoes };
}

test('todos os 12 relatórios têm id único, arquivo do BI e ao menos 1 coluna', () => {
  const { win } = carregarPagina({});
  const relatorios = win._DTRelatoriosBiInternals.RELATORIOS;
  assert.equal(relatorios.length, 12);
  const ids = new Set(relatorios.map(r => r.id));
  assert.equal(ids.size, 12, 'nenhum id duplicado');
  relatorios.forEach(r => {
    assert.ok(r.arquivo.endsWith('.json'), r.id + ' precisa apontar pra um arquivo do BI');
    assert.ok(r.colunas.length > 0, r.id + ' precisa ter colunas');
    assert.ok(['Compras', 'PCP', 'Produção'].includes(r.setor), r.id + ' precisa estar em Compras/PCP/Produção');
  });
});

test('tela: mostra abas dos 3 setores e o botão Buscar quando suportado', async () => {
  const { win, document } = carregarPagina({ suportado: () => true });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /Compras/i);
  assert.match(html, /PCP/);
  assert.match(html, /Produção/);
  assert.match(html, /data-rbi-buscar="1">📊 Buscar</);
});

test('_linhasEstoqueDetalhado: extrai .produtos de arquivos com wrapper (dados-estoque/dados-insumos/mrp)', () => {
  const { win } = carregarPagina({});
  const r = win._DTRelatoriosBiInternals.RELATORIOS.find(x => x.id === 'estoque-produto-acabado');
  const linhas = r.linhas({ produtos: [{ sku: '1', produto: 'A' }] });
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].sku, '1');
});

test('estoque-produtos: ignora a linha de totais (produto_key null)', () => {
  const { win } = carregarPagina({});
  const r = win._DTRelatoriosBiInternals.RELATORIOS.find(x => x.id === 'estoque-produtos');
  const linhas = r.linhas([{ loja: 'X', produto_key: null, produto: null }, { loja: 'X', produto_key: 304, produto: 'Tapioca' }]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].produto, 'Tapioca');
});

// PEDIDO AO VIVO (2026-09-02): "Rank PCP — Estoque vs Pedidos... só quatro
// colunas, produto/estoque/pedidos/saldo, saldo é estoque menos pedido" —
// mesma fonte já validada de 'estoque-produtos' (produtos_estoque.json),
// só que enxuto e ranqueado (maior falta de estoque primeiro).
test('rank-estoque-vs-pedidos: só 4 colunas (produto/estoque/pedidos/saldo), saldo = estoque - pedidos, ordenado do menor saldo pro maior', () => {
  const { win } = carregarPagina({});
  const r = win._DTRelatoriosBiInternals.RELATORIOS.find(x => x.id === 'rank-estoque-vs-pedidos');
  assert.equal(JSON.stringify(r.colunas.map(c => c[0])), JSON.stringify(['produto', 'estoque', 'pedidos', 'saldo']));
  const linhas = r.linhas([
    { produto_key: 1, produto: 'A', quantidade_estoque: 100, quantidadePedidos: 40 },
    { produto_key: 2, produto: 'B', quantidade_estoque: 50, quantidadePedidos: 80 },
    { produto_key: null, produto: null, quantidade_estoque: 9999, quantidadePedidos: 0 },
  ]);
  assert.equal(linhas.length, 2, 'linha de totais (produto_key null) fica de fora');
  assert.equal(linhas[0].produto, 'B');
  assert.equal(linhas[0].saldo, -30, 'B está em falta: 50 - 80');
  assert.equal(linhas[1].produto, 'A');
  assert.equal(linhas[1].saldo, 60, 'A está sobrando: 100 - 40');
});

test('escadinha-desvios: lê de dados.desvios, não de dados.produtos', () => {
  const { win } = carregarPagina({});
  const r = win._DTRelatoriosBiInternals.RELATORIOS.find(x => x.id === 'escadinha-desvios');
  const linhas = r.linhas({ produtos: [{ cod: 1 }], desvios: [{ cod: 1, produto: 'X', desvio: -10 }] });
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].desvio, -10);
});

test('fornecedores-ranking: achata materia_prima e produto_acabado, todos os anos, num só array de linhas', () => {
  const { win } = carregarPagina({});
  const r = win._DTRelatoriosBiInternals.RELATORIOS.find(x => x.id === 'fornecedores-ranking');
  const dados = {
    materia_prima: { anoData: { '2025': { top: [{ f: 'Fornecedor A', valor: 100, kg: 10, caixas: 0 }] }, '2026': { top: [{ f: 'Fornecedor B', valor: 200, kg: 20, caixas: 5 }] } } },
    produto_acabado: { anoData: { '2025': { top: [{ f: 'Fornecedor C', valor: 50, kg: 5, caixas: 1 }] } } },
  };
  const linhas = r.linhas(dados);
  assert.equal(linhas.length, 3);
  assert.ok(linhas.some(l => l.categoria === 'Matéria-prima' && l.ano === '2025' && l.fornecedor === 'Fornecedor A'));
  assert.ok(linhas.some(l => l.categoria === 'Produto acabado' && l.fornecedor === 'Fornecedor C'));
});

test('compras-historico: marcado como "grande" com campoData — vai ganhar filtro de período padrão ao buscar', () => {
  const { win } = carregarPagina({});
  const r = win._DTRelatoriosBiInternals.RELATORIOS.find(x => x.id === 'compras-historico');
  assert.equal(r.grande, true);
  assert.equal(r.campoData, 'data_emissao');
});

test('clicar em "Buscar" no relatório ativo: lê o arquivo certo (via DTBiPastaLocal) e desenha as linhas na tabela', async () => {
  const registros = { produtos: [{ sku: '304', produto: 'TAPIOCA', loja: 'Matriz', fornecedor: 'X', estoque: 100, saldo: 90, cobertura: 5, status: 'OK' }] };
  const { win, document } = carregarPagina({
    suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
    lerJson: async (nome) => { assert.equal(nome, 'dados-estoque.json'); return registros; },
  });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="estoque-produto-acabado"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /TAPIOCA/);
  assert.match(html, /1 linha\(s\) lida\(s\) de dados-estoque\.json/);
});

test('trocar de aba troca o arquivo buscado (cada relatório é independente)', async () => {
  const chamadas = [];
  const { win, document } = carregarPagina({
    suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
    lerJson: async (nome) => { chamadas.push(nome); return []; },
  });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="valor-insumos"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  document.querySelector('[data-rbi-tab="fornecedores-ranking"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(chamadas, ['valor_insumos.json', 'fornecedores_agregado.json']);
});

test('busca vazia mostra "0 linha(s) lida(s)" e a tabela some vazia, sem quebrar', async () => {
  const { win, document } = carregarPagina({
    suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
    lerJson: async () => [],
  });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /0 linha\(s\) lida\(s\)/);
});

// PEDIDO AO VIVO (2026-08-27): "quero gravar mais só os dados desse ano
// pra frente" + "que seja por chunks" — compras-historico não busca mais
// o arquivo (87MB) direto do BI; lê os pacotes já sincronizados pelo
// servidor (relatorios_bi_compras_historico_chunks).
test('compras-historico: tem origemFirestore e funcaoSincronizacao configurados (não usa mais DTBiPastaLocal.lerJson)', () => {
  const { win } = carregarPagina({});
  const r = win._DTRelatoriosBiInternals.RELATORIOS.find(x => x.id === 'compras-historico');
  assert.equal(r.origemFirestore, 'relatorios_bi_compras_historico_chunks');
  assert.equal(r.funcaoSincronizacao, 'sincronizarComprasHistoricoBiAgora');
});

test('compras-historico: "Buscar" lê os pacotes do Firestore (não chama DTBiPastaLocal.lerJson) e aparece mesmo sem File System Access API', async () => {
  const colChunks = mockColecaoSomenteLeitura([
    { id: 'chunk_0', data: { registros: { a: { data_emissao: '2026-01-01', nf_numero: 1 }, b: { data_emissao: '2026-01-02', nf_numero: 2 } } } },
  ]);
  const { win, document } = carregarPagina(
    { suportado: () => false, lerJson: async () => { throw new Error('não deveria chamar a pasta local pra este relatório'); } },
    { colecoes: { relatorios_bi_compras_historico_chunks: colChunks } }
  );
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="compras-historico"]').click();
  assert.match(document.getElementById('page-producao-relatorios-bi').innerHTML, /data-rbi-buscar="1">📊 Buscar</, 'botão de buscar aparece mesmo sem suporte a pasta local, porque lê do Firestore');
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /2 linha\(s\) já sincronizada/);
});

// PEDIDO AO VIVO (2026-08-27): "MRO sai fora, logística sai fora, e o
// compras eu quero, mas com a seção... acrescente lá nos filtros bobina,
// matéria-prima" + "o que é transferência da matriz pra filial, crie um
// campo Em Trânsito" (sempre histórico — nenhum arquivo do BI mostra
// transferência pendente/tempo real).
test('compras-historico: MRO e Logística nunca aparecem na tabela, mesmo sem nenhum filtro escolhido', async () => {
  const hoje = new Date().toISOString().slice(0, 10); // dentro dos filtro padrão de 30 dias
  const colChunks = mockColecaoSomenteLeitura([{ id: 'chunk_0', data: { registros: {
    a: { nf_numero: 1, data_emissao: hoje, descricao: 'Parafuso', departamento: 'MRO', secao: 'MANUTENCAO', tipo_operacao: 'COMPRA' },
    b: { nf_numero: 2, data_emissao: hoje, descricao: 'Oleo Diesel', departamento: 'LOGISTICA', secao: 'MANUTENCAO', tipo_operacao: 'COMPRA' },
    c: { nf_numero: 3, data_emissao: hoje, descricao: 'Bobina Farofa', departamento: 'COMPRAS', secao: 'BOBINAS', tipo_operacao: 'COMPRA' },
  } } }]);
  const { win, document } = carregarPagina({ suportado: () => false }, { colecoes: { relatorios_bi_compras_historico_chunks: colChunks } });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="compras-historico"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.doesNotMatch(html, /Parafuso/, 'MRO excluído por padrão');
  assert.doesNotMatch(html, /Oleo Diesel/, 'Logística excluída por padrão');
  assert.match(html, /Bobina Farofa/, 'Compras continua aparecendo');
  assert.doesNotMatch(html, /<option value="MRO"/);
  assert.doesNotMatch(html, /<option value="LOGISTICA"/);
});

test('compras-historico: filtro de Seção restringe dentro do departamento (bobinas, matéria-prima etc.)', async () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const colChunks = mockColecaoSomenteLeitura([{ id: 'chunk_0', data: { registros: {
    a: { nf_numero: 1, data_emissao: hoje, descricao: 'Bobina Farofa', departamento: 'COMPRAS', secao: 'BOBINAS', tipo_operacao: 'COMPRA' },
    b: { nf_numero: 2, data_emissao: hoje, descricao: 'Mandioca In Natura', departamento: 'COMPRAS', secao: 'IN NATURA', tipo_operacao: 'COMPRA' },
  } } }]);
  const { win, document } = carregarPagina({ suportado: () => false }, { colecoes: { relatorios_bi_compras_historico_chunks: colChunks } });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="compras-historico"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('rbi-filtro-secao').value = 'BOBINAS';
  document.getElementById('rbi-filtro-secao').dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /Bobina Farofa/);
  assert.doesNotMatch(html, /Mandioca In Natura/);
});

test('compras-historico: transferência (matriz→filial) aparece rotulada "Em Trânsito", compra de verdade aparece rotulada "Compra"', async () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const colChunks = mockColecaoSomenteLeitura([{ id: 'chunk_0', data: { registros: {
    a: { nf_numero: 1, data_emissao: hoje, descricao: 'Tapioca 1kg', departamento: 'PRODUTO DE VENDA', secao: 'TAPIOCA', tipo_operacao: 'TRANSFERENCIA' },
    b: { nf_numero: 2, data_emissao: hoje, descricao: 'Mandioca In Natura', departamento: 'COMPRAS', secao: 'IN NATURA', tipo_operacao: 'COMPRA' },
  } } }]);
  const { win, document } = carregarPagina({ suportado: () => false }, { colecoes: { relatorios_bi_compras_historico_chunks: colChunks } });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="compras-historico"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /Em Trânsito/);
  assert.match(html, /🛒 Compra/);
});

// PEDIDO AO VIVO (2026-08-28): "não precisa nem ser puxado direto de
// novo, o todo já foi carregado nas outras abas... dez vezes e nenhuma
// funciona" — obterHistoricoComprasRealBi é o cache COMPARTILHADO que o
// Dashboard de Compras (89-compras-dashboard.js) passa a reaproveitar, em
// vez de fazer sua própria busca (uma leitura a menos que pode falhar).
test('obterHistoricoComprasRealBi: busca uma vez, cacheia, e reaproveita por período', async () => {
  let chamadasFn = 0;
  const firebase={app:()=>({functions:()=>({httpsCallable:()=>async()=>{chamadasFn++;return{data:{linhas:[{nf_numero:1,data_emissao:'2026-09-01'}]}};}})})};
  const { win } = carregarPagina({ suportado: () => false }, { firebase });
  const filtro={inicio:'2026-09-01',fim:'2026-09-30'};
  const linhas1 = await win.obterHistoricoComprasRealBi(false,filtro);
  assert.equal(linhas1.length, 1); assert.equal(chamadasFn,1);
  const linhas2 = await win.obterHistoricoComprasRealBi(false,filtro);
  assert.equal(chamadasFn,1); assert.deepEqual(linhas2,linhas1);
  await win.obterHistoricoComprasRealBi(true,filtro);
  assert.equal(chamadasFn,2);
});

test('obterHistoricoComprasRealBi: aba Histórico de Compras reaproveita o cache do mesmo período', async () => {
  let chamadasFn=0;
  const firebase={app:()=>({functions:()=>({httpsCallable:()=>async()=>{chamadasFn++;return{data:{linhas:[{nf_numero:1,data_emissao:new Date().toISOString().slice(0,10)}]}};}})})};
  const { win, document } = carregarPagina({ suportado: () => false }, { firebase });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="compras-historico"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(chamadasFn,1);
  const ini=document.getElementById('rbi-filtro-ini').value, fim=document.getElementById('rbi-filtro-fim').value;
  const linhas=await win.obterHistoricoComprasRealBi(false,{inicio:ini,fim});
  assert.equal(chamadasFn,1); assert.equal(linhas.length,1);
});

test('"Forçar sincronização agora" chama a Cloud Function certa e depois relê o período', async () => {
  const funcoesChamadas = [];
  const colChunks = mockColecaoSomenteLeitura([{ id: 'chunk_0', data: { registros: { a: { data_emissao: '2026-01-01' } } } }]);
  const { win, document } = carregarPagina(
    { suportado: () => false },
    {
      colecoes: { relatorios_bi_compras_historico_chunks: colChunks },
      firebase: { app: () => ({ functions: () => ({ httpsCallable: (nome) => { funcoesChamadas.push(nome); return async () => nome === 'buscarHistoricoComprasBigQuery' ? ({ data: { ok: true, linhas: [{ data_emissao: '2026-09-01' }] } }) : ({ data: { ok: true, resultado: { novos: 5 } } }); } }) }) },
    }
  );
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="compras-historico"]').click();
  document.querySelector('[data-rbi-forcar-sync]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.ok(funcoesChamadas.includes('sincronizarComprasHistoricoBiAgora'));
  assert.ok(funcoesChamadas.includes('buscarHistoricoComprasBigQuery'), 'depois do sync relê somente o período pelo BigQuery');
});

// PEDIDO AO VIVO (2026-08-28): "esse estoque versus pedidos tem que
// aparecer só produto acabado, não pode aparecer insumo" — confirmado nos
// dados reais que produtos_estoque.json mistura produto de venda com lixo
// tipo "MKT TRADE - FOGAO ELETRICO..." — filtrado cruzando com o cadastro
// real (producao_produtos ∪ pcp_produtos_bluesoft).
test('estoque-produtos: some da tabela produto não cadastrado (nem produção, nem fornecedor) — só o que está registrado de verdade', async () => {
  const produtosCadastrados = mockColecaoSomenteLeitura([{ id: 'p1', data: { cod: '304' } }]);
  const { win, document } = carregarPagina(
    { suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }), lerJson: async () => ([{ produto_key: 304, produto: 'Tapioca de verdade' }, { produto_key: 99999, produto: 'MKT TRADE - FOGAO ELETRICO' }]) },
    { colecoes: { producao_produtos: produtosCadastrados } }
  );
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="estoque-produtos"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /Tapioca de verdade/);
  assert.doesNotMatch(html, /FOGAO ELETRICO/);
});

test('estoque-produtos: se o cadastro vier vazio (falha/sem dados), não esconde a lista inteira', async () => {
  const { win, document } = carregarPagina(
    { suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }), lerJson: async () => ([{ produto_key: 304, produto: 'Tapioca' }]) },
    { colecoes: {} }
  );
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="estoque-produtos"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /Tapioca/, 'cadastro vazio não pode apagar a lista inteira');
});

// PEDIDO AO VIVO (2026-08-28): "cobertura de estoque... dezoito mil dias,
// não entende nada como funciona aquilo ali" — só tratamento visual, a
// conta em si (o valor que já vem pronto do arquivo) não muda.
test('estoque-insumos: cobertura acima de 365 dias vira "Excesso (Xm parado)", abaixo mostra o número normal', async () => {
  const { win, document } = carregarPagina({
    suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
    lerJson: async () => ({ produtos: [
      { sku: '1', produto: 'Filme Stretch', cobertura: 11103.8 },
      { sku: '2', produto: 'Balde Alho', cobertura: 18.2 },
    ] }),
  });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="estoque-insumos"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /Excesso \(370 meses parado\)/);
  assert.match(html, />18,2</);
});

// PEDIDO AO VIVO (2026-08-28): "cruzar valor_insumos.json com a mesma
// exclusão de MRO/Logística já pronta".
test('valor-insumos: MRO e Logística também somem aqui, mesma regra do Histórico de Compras', async () => {
  const { win, document } = carregarPagina({
    suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
    lerJson: async () => ([
      { data: '2026-08-01', loja: 'Matriz', departamento: 'MRO', descricao: 'Parafuso', valorEstoque: 10 },
      { data: '2026-08-01', loja: 'Matriz', departamento: 'COMPRAS', descricao: 'Bobina Farofa', valorEstoque: 500 },
    ]),
  });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="valor-insumos"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.doesNotMatch(html, /Parafuso/);
  assert.match(html, /Bobina Farofa/);
});

// PEDIDO AO VIVO (2026-08-28): "tem muita coisa que você não está usando"
// — dados-mrp-terceiros.json já trazia 3 meses de histórico.
test('mrp-terceiros: mostra o histórico de 3 meses (realMes1/2/3, corteMes1/2/3), não só o mês atual', async () => {
  const { win, document } = carregarPagina({
    suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
    lerJson: async () => ({ produtos: [{ sku: '1', produto: 'X', realMes1: 100, realMes2: 200, realMes3: 300, corteMes1: 1, corteMes2: 2, corteMes3: 3 }] }),
  });
  await win.renderRelatoriosBi('page-producao-relatorios-bi');
  document.querySelector('[data-rbi-tab="mrp-terceiros"]').click();
  document.querySelector('[data-rbi-buscar]').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-producao-relatorios-bi').innerHTML;
  assert.match(html, /Real M-1/);
  assert.match(html, />300</);
  assert.match(html, /Corte M-3/);
});
