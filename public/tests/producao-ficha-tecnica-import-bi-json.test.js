// PEDIDO AO VIVO (2026-08-26): "agora aplica os outros arquivos" — depois de
// notas_fiscais_jacson.json, o próximo export do BI a alimentar o sistema é
// ficha_tecnica.json (uma linha por par produto_acabado/insumo). Precisa
// agrupar por produto_key antes de gravar em producao_ficha_tecnica (que é
// UM doc por produto, com insumos[] dentro). Também precisa respeitar o
// pedido "clico em Buscar e puxa automático" (DTBiPastaLocal, mockado aqui).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/60-producao-ficha-tecnica.js'), 'utf8');

function mockColecaoEscrivel(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({
      id,
      set: async (payload, opts) => { const atual = registro.get(id) || {}; registro.set(id, opts?.merge ? { ...atual, ...payload } : payload); },
      delete: async () => { registro.delete(id); },
    }),
    add: async (payload) => { const id = 'novo' + (seq++); registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}

// pftBuscarBiAutomatico() (60-producao-ficha-tecnica.js) agenda um
// setInterval de auto-refresh a cada render da tela somente-leitura — timer
// real em jsdom, que precisa ser derrubado com window.close() ou o
// node --test nunca sai sozinho.
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="pcfg-embed-host"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  const colProdutos = mockColecaoEscrivel(opts.produtos || []);
  const colFichas = mockColecaoEscrivel(opts.fichas || []);
  const colMaquinas = mockColecaoEscrivel([]);
  const colBluesoft = mockColecaoEscrivel(opts.produtosBluesoft || []);
  win.getDTFirestore = () => ({
    collection: (nome) => ({ producao_produtos: colProdutos, producao_ficha_tecnica: colFichas, producao_maquinas: colMaquinas, pcp_produtos_bluesoft: colBluesoft }[nome] || mockColecaoEscrivel([])),
  });
  win.getDTRawFirestore = () => ({
    batch: () => {
      const dels = [];
      return { delete: (ref) => dels.push(ref), commit: async () => { for (const ref of dels) await ref.delete(); } };
    },
  });
  win.getDTLojaAtiva = () => opts.lojaAtivaId || 'loja1';
  win.DTLoja = { listar: async () => opts.lojas || [{ id: 'loja1', bluesoft_loja_key: 14 }] };
  win.showToast = () => {};
  win.DTBiPastaLocal = opts.dtBiPastaLocal;
  win.eval(code);
  return { win, document, colProdutos, colFichas };
}

test('_agruparFichaTecnicaBiPorProduto: várias linhas do mesmo produto_key viram UM registro com insumos[]', () => {
  const { win } = carregarPagina({});
  const linhas = [
    { loja_key: 14, produto_key: 304, produto_acabado: '00001 TAPIOCA 1 KG', produto_key_insumo: 900, descricao_insumo: 'Fécula de mandioca', consumo_receita: 0.5 },
    { loja_key: 14, produto_key: 304, produto_acabado: '00001 TAPIOCA 1 KG', produto_key_insumo: 901, descricao_insumo: 'Água', consumo_receita: 0.2 },
    { loja_key: 14, produto_key: 999, produto_acabado: 'OUTRO PRODUTO', produto_key_insumo: 902, descricao_insumo: 'Sal', consumo_receita: 0.01 },
  ];
  const grupos = win._DTFichaTecnicaBiInternals._agruparFichaTecnicaBiPorProduto(linhas, null);
  assert.equal(grupos.length, 2);
  const tapioca = grupos.find(g => g.cod === '304');
  assert.equal(tapioca.desc, '00001 TAPIOCA 1 KG');
  assert.equal(tapioca.insumos.length, 2);
  assert.equal(tapioca.insumos[0].insumo, 'Fécula de mandioca');
  assert.equal(tapioca.insumos[0].qty, 0.5);
});

test('_agruparFichaTecnicaBiPorProduto: filtra por loja_key quando informado', () => {
  const { win } = carregarPagina({});
  const linhas = [
    { loja_key: 14, produto_key: 1, produto_acabado: 'A', descricao_insumo: 'X', consumo_receita: 1 },
    { loja_key: 11, produto_key: 2, produto_acabado: 'B', descricao_insumo: 'Y', consumo_receita: 1 },
  ];
  const grupos = win._DTFichaTecnicaBiInternals._agruparFichaTecnicaBiPorProduto(linhas, '14');
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].cod, '1');
});

test('_agruparFichaTecnicaBiPorProduto: linha sem produto_key é ignorada', () => {
  const { win } = carregarPagina({});
  const grupos = win._DTFichaTecnicaBiInternals._agruparFichaTecnicaBiPorProduto([{ produto_acabado: 'Sem key', descricao_insumo: 'X', consumo_receita: 1 }], null);
  assert.equal(grupos.length, 0);
});

test('_importarFichaTecnicaBiRegistros: grava com merge — preserva maquina/pc_min já configurados manualmente', async () => {
  const { win, colFichas } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Tapioca' } }],
    fichas: [{ id: 'f1', data: { cod: '304', desc: 'Tapioca (antigo)', maquina: 'Envasadora 1', pc_min: 40, insumos: [{ insumo: 'Antigo', qty: 1, categoria: '' }] } }],
  });
  const registros = [{ loja_key: 14, produto_key: 304, produto_acabado: 'TAPIOCA NOVA', descricao_insumo: 'Fécula', consumo_receita: 0.5 }];
  const resultado = await win._DTFichaTecnicaBiInternals._importarFichaTecnicaBiRegistros(registros);
  assert.equal(resultado.total, 1);
  assert.equal(resultado.semProduto, 0);
  const gravado = colFichas._registro.get('f1');
  assert.equal(gravado.desc, 'TAPIOCA NOVA');
  assert.equal(gravado.insumos.length, 1);
  assert.equal(gravado.insumos[0].insumo, 'Fécula');
  assert.equal(gravado.maquina, 'Envasadora 1', 'merge:true não pode apagar campo que o import nem manda');
  assert.equal(gravado.pc_min, 40);
});

test('_importarFichaTecnicaBiRegistros: produto sem cadastro em producao_produtos ainda grava a ficha, mas conta em semProduto', async () => {
  const { win } = carregarPagina({ produtos: [], fichas: [] });
  const registros = [{ loja_key: 14, produto_key: 555, produto_acabado: 'Novo Produto', descricao_insumo: 'X', consumo_receita: 1 }];
  const resultado = await win._DTFichaTecnicaBiInternals._importarFichaTecnicaBiRegistros(registros);
  assert.equal(resultado.total, 1);
  assert.equal(resultado.semProduto, 1);
});

test('_importarFichaTecnicaBiRegistros: sem nenhuma linha pra loja ativa, lança erro claro em vez de gravar vazio', async () => {
  const { win } = carregarPagina({ lojas: [{ id: 'loja1', bluesoft_loja_key: 14 }] });
  const registros = [{ loja_key: 11, produto_key: 1, produto_acabado: 'A', descricao_insumo: 'X', consumo_receita: 1 }];
  await assert.rejects(() => win._DTFichaTecnicaBiInternals._importarFichaTecnicaBiRegistros(registros), /Nenhuma ficha técnica encontrada/);
});

test('tela Ficha Técnica: mostra "Buscar" quando o navegador suporta pasta local', async () => {
  const { win, document } = carregarPagina({ dtBiPastaLocal: { suportado: () => true } });
  await win.renderProducaoFichaTecnicaSomenteLeitura('pcfg-embed-host');
  assert.match(document.getElementById('pcfg-embed-host').innerHTML, /data-pft-buscar-bi="1">📊 Buscar</);
});

test('tela Ficha Técnica: sem suporte no navegador, não mostra o botão nem nenhum seletor de arquivo manual', async () => {
  const { win, document } = carregarPagina({ dtBiPastaLocal: { suportado: () => false } });
  await win.renderProducaoFichaTecnicaSomenteLeitura('pcfg-embed-host');
  const html = document.getElementById('pcfg-embed-host').innerHTML;
  assert.doesNotMatch(html, /data-pft-buscar-bi/);
  assert.doesNotMatch(html, /type="file"/);
});

test('clicar em "Buscar do BI" já conectado: lê o JSON, agrupa e grava — sem pedir conexão de novo', async () => {
  let conectarChamado = false;
  const registros = [{ loja_key: 14, produto_key: 304, produto_acabado: 'TAPIOCA', descricao_insumo: 'Fécula', consumo_receita: 0.5 }];
  const { win, document, colFichas } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304' } }],
    dtBiPastaLocal: {
      suportado: () => true,
      status: async () => 'conectado',
      conectar: async () => { conectarChamado = true; return { ok: true }; },
      lerJson: async (nome) => { if (nome === 'dados-insumos.json') return { produtos: [] }; assert.equal(nome, 'ficha_tecnica.json'); return registros; },
    },
  });
  await win.renderProducaoFichaTecnicaSomenteLeitura('pcfg-embed-host');
  document.querySelector('[data-pft-buscar-bi]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(conectarChamado, false);
  assert.match(document.getElementById('pcfg-embed-host').innerHTML, /1 ficha\(s\) técnica\(s\) atualizada\(s\)/);
  assert.equal(colFichas._registro.get('novo0').insumos[0].insumo, 'Fécula');
});

// PEDIDO AO VIVO (2026-09-02): "atualizar a ficha técnica com o arquivo de
// insumos... trazer se é embalagem primária, secundária, matéria-prima" —
// dados-insumos.json classifica por nome (ficha_tecnica.json não tem
// código de insumo, só nome).
test('_classificarInsumosComBi: casa insumo por nome normalizado com dados-insumos.json e preenche categoria', () => {
  const { win } = carregarPagina({});
  const fichasAgrupadas = [{ cod: '304', desc: 'Tapioca', insumos: [{ insumo: 'fécula de mandioca', qty: 0.5, categoria: '' }] }];
  const dadosInsumos = { produtos: [{ produto: 'FÉCULA DE MANDIOCA', categoria: 'MATERIA PRIMA' }] };
  win._DTFichaTecnicaBiInternals._classificarInsumosComBi(fichasAgrupadas, [], dadosInsumos);
  assert.equal(fichasAgrupadas[0].insumos[0].categoria, 'MATERIA PRIMA');
});
test('_classificarInsumosComBi: sem correspondência no BI, categoria fica vazia (nunca inventa classificação)', () => {
  const { win } = carregarPagina({});
  const fichasAgrupadas = [{ cod: '1', desc: 'X', insumos: [{ insumo: 'Insumo qualquer sem match', qty: 1, categoria: '' }] }];
  win._DTFichaTecnicaBiInternals._classificarInsumosComBi(fichasAgrupadas, [], { produtos: [] });
  assert.equal(fichasAgrupadas[0].insumos[0].categoria, '');
});
test('_classificarInsumosComBi: categoria já configurada manualmente numa ficha existente NUNCA é sobrescrita pelo BI', () => {
  const { win } = carregarPagina({});
  const fichasExistentes = [{ cod: '304', insumos: [{ insumo: 'Fécula de mandioca', categoria: 'Categoria escolhida manualmente' }] }];
  const fichasAgrupadas = [{ cod: '304', desc: 'Tapioca', insumos: [{ insumo: 'Fécula de mandioca', qty: 0.5, categoria: '' }] }];
  const dadosInsumos = { produtos: [{ produto: 'FÉCULA DE MANDIOCA', categoria: 'MATERIA PRIMA (do BI, não devia ganhar)' }] };
  win._DTFichaTecnicaBiInternals._classificarInsumosComBi(fichasAgrupadas, fichasExistentes, dadosInsumos);
  assert.equal(fichasAgrupadas[0].insumos[0].categoria, 'Categoria escolhida manualmente');
});
test('_importarFichaTecnicaBiRegistros: aceita dadosInsumos e grava a categoria já classificada', async () => {
  const { win, colFichas } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304' } }],
  });
  const registros = [{ loja_key: 14, produto_key: 304, produto_acabado: 'TAPIOCA', descricao_insumo: 'Fécula de mandioca', consumo_receita: 0.5 }];
  const dadosInsumos = { produtos: [{ produto: 'FÉCULA DE MANDIOCA', categoria: 'MATERIA PRIMA' }] };
  await win._DTFichaTecnicaBiInternals._importarFichaTecnicaBiRegistros(registros, dadosInsumos);
  const salva = [...colFichas._registro.values()][0];
  assert.equal(salva.insumos[0].categoria, 'MATERIA PRIMA');
});

// PEDIDO AO VIVO (2026-09-02): "quando colocar para adicionar produto ele
// trazer de alguma base para eu selecionar tipo vários produtos de uma
// vez, ele já cadastrar e já trazer os insumos dele também, e ele vai
// levar a empresa produtora por onde ele for cadastrado, se eu cadastrar
// pela loja filial lá vai ser a empresa produtora" — cadastro em lote a
// partir do catálogo do BI (ficha_tecnica.json), com insumos e
// empresaProdutoraId/Nome = loja ativa no momento do cadastro.
test('pftAbrirModalCatalogo: lista só produtos do BI que AINDA não estão cadastrados, filtrados pela loja ativa', async () => {
  const { win, document } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'Já cadastrado' } }],
    lojas: [{ id: 'loja1', nome: 'DA TERRINHA - FILIAL SP', bluesoft_loja_key: 14 }],
    dtBiPastaLocal: {
      suportado: () => true,
      status: async () => 'conectado',
      conectar: async () => ({ ok: true }),
      lerJson: async (nome) => {
        if (nome === 'dados-insumos.json') return { produtos: [] };
        return [
          { loja_key: 14, produto_key: 304, produto_acabado: '00001 TAPIOCA JÁ CADASTRADA', descricao_insumo: 'Fécula', consumo_receita: 0.5 },
          { loja_key: 14, produto_key: 555, produto_acabado: '00099 PRODUTO NOVO DO CATALOGO', descricao_insumo: 'Insumo X', consumo_receita: 1 },
          { loja_key: 11, produto_key: 777, produto_acabado: 'PRODUTO DE OUTRA LOJA', descricao_insumo: 'Insumo Y', consumo_receita: 1 },
        ];
      },
    },
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftAbrirModalCatalogo();
  const catalogo = win._DTFichaTecnicaBiInternals.getCatalogo();
  assert.equal(catalogo.length, 1, 'só o produto novo da loja ativa entra — o já cadastrado e o de outra loja ficam de fora');
  assert.equal(catalogo[0].cod, '555');
  assert.equal(catalogo[0].insumos[0].insumo, 'Insumo X');
  const html = document.getElementById('modal-pft-catalogo').innerHTML;
  assert.match(html, /PRODUTO NOVO DO CATALOGO/);
  assert.doesNotMatch(html, /JÁ CADASTRADA/);
  assert.match(html, /DA TERRINHA - FILIAL SP/, 'avisa qual vai ser a empresa produtora antes de confirmar');
});

// PEDIDO AO VIVO (2026-09-02, 4ª rodada): "os que cadastrou automaticamente
// não traz a quantidade que vem na caixa" — ficha_tecnica.json não tem essa
// informação (só produto+insumos), mas o cadastro sincronizado da Bluesoft
// (pcp_produtos_bluesoft) já tem, em `fatorCaixaBluesoft` (mesmo campo que a
// tela mostra como "un/cx"). Velocidade de produção (und/min) foi conferida
// nos 15 arquivos do BI — nenhum traz esse dado, por isso só un/cx é
// preenchido automaticamente; velocidade continua manual (usuário confirmou
// que vai preencher de outra fonte).
test('pftAbrirModalCatalogo: preenche unid (un/cx) cruzando com fatorCaixaBluesoft de pcp_produtos_bluesoft', async () => {
  const { win } = carregarPagina({
    produtos: [],
    produtosBluesoft: [{ id: 'b1', data: { cod: '555', fatorCaixaBluesoft: 24 } }],
    lojas: [{ id: 'loja1', bluesoft_loja_key: 14 }],
    dtBiPastaLocal: {
      suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
      lerJson: async (nome) => (nome === 'dados-insumos.json' ? { produtos: [] } : [
        { loja_key: 14, produto_key: 555, produto_acabado: 'COM FATOR CAIXA NO BLUESOFT', descricao_insumo: 'X', consumo_receita: 1 },
        { loja_key: 14, produto_key: 999, produto_acabado: 'SEM FATOR CAIXA (NÃO SINCRONIZADO)', descricao_insumo: 'Y', consumo_receita: 1 },
      ]),
    },
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftAbrirModalCatalogo();
  const catalogo = win._DTFichaTecnicaBiInternals.getCatalogo();
  assert.equal(catalogo.find(p => p.cod === '555').unid, 24, 'un/cx veio do fatorCaixaBluesoft');
  assert.equal(catalogo.find(p => p.cod === '999').unid, 1, 'sem correspondência na Bluesoft, cai pro padrão 1 (nunca quebra)');
});

test('pftCatalogoCadastrarSelecionados: grava o unid (un/cx) vindo do catálogo, não fixo em 1', async () => {
  const { win, colProdutos } = carregarPagina({
    produtos: [],
    produtosBluesoft: [{ id: 'b1', data: { cod: '555', fatorCaixaBluesoft: 24 } }],
    lojas: [{ id: 'loja1', nome: 'FILIAL', bluesoft_loja_key: 14 }],
    dtBiPastaLocal: {
      suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
      lerJson: async (nome) => (nome === 'dados-insumos.json' ? { produtos: [] } : [{ loja_key: 14, produto_key: 555, produto_acabado: 'PRODUTO', descricao_insumo: 'X', consumo_receita: 1 }]),
    },
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftAbrirModalCatalogo();
  win._DTFichaTecnicaBiInternals.getCatalogoSelecionados().add('555');
  await win._DTFichaTecnicaBiInternals.pftCatalogoCadastrarSelecionados();
  const salvo = [...colProdutos._registro.values()].find(p => p.cod === '555');
  assert.equal(salvo.unid, 24, 'un/cx gravado igual ao fatorCaixaBluesoft, não fixo em 1');
});

test('pftCatalogoCadastrarSelecionados: cria producao_produtos com empresaProdutoraId da loja ativa E grava os insumos junto', async () => {
  const { win, colProdutos, colFichas } = carregarPagina({
    produtos: [],
    lojas: [{ id: 'loja_filial', nome: 'DA TERRINHA - FILIAL SP', bluesoft_loja_key: 14 }],
    dtBiPastaLocal: {
      suportado: () => true,
      status: async () => 'conectado',
      conectar: async () => ({ ok: true }),
      lerJson: async (nome) => {
        if (nome === 'dados-insumos.json') return { produtos: [] };
        return [{ loja_key: 14, produto_key: 555, produto_acabado: '00099 PRODUTO NOVO', descricao_insumo: 'Insumo X', consumo_receita: 2.5 }];
      },
    },
    lojaAtivaId: 'loja_filial',
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftAbrirModalCatalogo();
  win._DTFichaTecnicaBiInternals.getCatalogoSelecionados().add('555');
  await win._DTFichaTecnicaBiInternals.pftCatalogoCadastrarSelecionados();
  const produtoSalvo = [...colProdutos._registro.values()].find(p => p.cod === '555');
  assert.ok(produtoSalvo, 'producao_produtos foi criado pro produto selecionado');
  assert.equal(produtoSalvo.nome, '00099 PRODUTO NOVO');
  assert.equal(produtoSalvo.empresaProdutoraId, 'loja_filial', 'empresa produtora = loja ativa no momento do cadastro');
  assert.equal(produtoSalvo.empresaProdutoraNome, 'DA TERRINHA - FILIAL SP');
  assert.equal(produtoSalvo.ativo, true);
  const fichaSalva = [...colFichas._registro.values()].find(f => f.cod === '555');
  assert.ok(fichaSalva, 'ficha técnica (insumos) também foi criada junto, sem precisar de um segundo passo');
  assert.equal(fichaSalva.insumos[0].insumo, 'Insumo X');
  assert.equal(fichaSalva.insumos[0].qty, 2.5);
});

// PEDIDO AO VIVO (2026-09-03): "Insumos Geral" mostra tudo em "OUTROS" em
// vez de agrupado por categoria (Mat. Prima/Emb. Primária/etc, igual ao
// original) — a tela já agrupa certo, o problema é que fichas técnicas
// gravadas ANTES de _classificarInsumosComBi existir nunca tiveram
// categoria preenchida, e o import só classifica no momento do import,
// nunca corrige o que já está salvo. Confirmado com dados reais: "MP -
// FEIJAO BRANCO KG" bate EXATO em dados-insumos.json ("MATERIA PRIMA").
test('pftCorrigirCategoriaInsumos: preenche categoria vazia usando dados-insumos.json, sem tocar em quem já tem categoria', async () => {
  const { win, colFichas } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'TAPIOCA' } }],
    fichas: [
      { id: 'f1', data: { cod: '304', desc: 'TAPIOCA', insumos: [
        { insumo: 'MP - FEIJAO BRANCO KG', qty: 1, categoria: '' },
        { insumo: 'JA CLASSIFICADO MANUALMENTE', qty: 1, categoria: 'OUTROS' },
        { insumo: 'SEM CORRESPONDENCIA NO BI', qty: 1, categoria: '' },
      ] } },
    ],
    dtBiPastaLocal: {
      suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
      lerJson: async () => ({ produtos: [{ produto: 'MP - FEIJAO BRANCO KG', categoria: 'MATERIA PRIMA' }] }),
    },
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftCorrigirCategoriaInsumos();
  const insumos = colFichas._registro.get('f1').insumos;
  assert.equal(insumos[0].categoria, 'MATERIA PRIMA', 'insumo sem categoria, com match exato no BI, foi corrigido');
  assert.equal(insumos[1].categoria, 'OUTROS', 'insumo que já tinha categoria (manual) não foi sobrescrito');
  assert.equal(insumos[2].categoria, '', 'sem correspondência no BI, continua vazio — não inventa categoria');
});

test('pftCorrigirCategoriaInsumos: nada pra corrigir, avisa e não escreve', async () => {
  const { win, colFichas } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'TAPIOCA' } }],
    fichas: [{ id: 'f1', data: { cod: '304', desc: 'TAPIOCA', insumos: [{ insumo: 'X', qty: 1, categoria: 'MATERIA PRIMA' }] } }],
    dtBiPastaLocal: {
      suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
      lerJson: async () => ({ produtos: [] }),
    },
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftCorrigirCategoriaInsumos();
  assert.equal(colFichas._registro.get('f1').insumos[0].categoria, 'MATERIA PRIMA');
});

test('pftCatalogoCadastrarSelecionados: sem nenhum selecionado, não faz nada (nem lê nem escreve)', async () => {
  const { win, colProdutos } = carregarPagina({});
  await win._DTFichaTecnicaBiInternals.pftCatalogoCadastrarSelecionados();
  assert.equal(colProdutos._registro.size, 0);
});

// PEDIDO AO VIVO (2026-09-02, 2ª rodada): "os produtos duplicou" — o
// confirmar do modal de catálogo não tinha proteção nenhuma contra clique
// duplo/reenvio, então um segundo clique (ou toque duplo em tela sensível)
// enquanto a primeira gravação ainda estava em andamento criava um SEGUNDO
// producao_produtos pro mesmo cod. Corrigido com trava de "já está
// salvando" + reconferência contra o banco (não só o cache) na hora exata
// de gravar.
test('pftCatalogoCadastrarSelecionados: reconfere contra o banco na hora de gravar — cod que já existe (criado por outra aba/clique) NÃO duplica', async () => {
  const { win, colProdutos, colFichas } = carregarPagina({
    produtos: [],
    lojas: [{ id: 'loja1', nome: 'DA TERRINHA - FILIAL SP', bluesoft_loja_key: 14 }],
    dtBiPastaLocal: {
      suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
      lerJson: async (nome) => (nome === 'dados-insumos.json' ? { produtos: [] } : [{ loja_key: 14, produto_key: 555, produto_acabado: 'PRODUTO', descricao_insumo: 'Insumo X', consumo_receita: 1 }]),
    },
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftAbrirModalCatalogo();
  win._DTFichaTecnicaBiInternals.getCatalogoSelecionados().add('555');
  // simula: entre abrir o modal e confirmar, o produto já foi cadastrado
  // por outro caminho (outra aba, ou um clique anterior que já processou).
  colProdutos._registro.set('externo1', { cod: '555', nome: 'Já existia' });
  await win._DTFichaTecnicaBiInternals.pftCatalogoCadastrarSelecionados();
  const comCod555 = [...colProdutos._registro.values()].filter(p => p.cod === '555');
  assert.equal(comCod555.length, 1, 'não pode ter 2 documentos com o mesmo cod — o que já existia continua único');
  assert.equal(colFichas._registro.size, 0, 'ficha também não é regravada pra quem já tinha produto');
});

// PEDIDO AO VIVO (2026-09-02, 3ª rodada): "os produtos duplicou" —
// confirmado ao vivo (console real do usuário): 109 cods, TODOS com
// exatamente 2 documentos, mesma máquina ('' nos dois), só 2 timestamps
// de criação (13s de diferença) pros 218 docs — reenvio duplo de ANTES da
// trava (rodada anterior). Botão "🧹 Corrigir N duplicado(s)" limpa o que
// já ficou salvo errado, mantendo sempre a cópia mais antiga.
test('pftLimparProdutosDuplicados: mantém o documento mais antigo (por criadoEm) e apaga o(s) redundante(s) — mesmo cod + mesma máquina', async () => {
  const { win, colProdutos } = carregarPagina({
    produtos: [
      { id: 'novo0', data: { cod: '555', nome: 'PRODUTO X', maquina: '', criadoEm: '2026-09-02T19:53:42.873Z' } },
      { id: 'novo1', data: { cod: '555', nome: 'PRODUTO X', maquina: '', criadoEm: '2026-09-02T19:53:55.943Z' } },
      { id: 'novo2', data: { cod: '999', nome: 'PRODUTO ÚNICO, SEM DUPLICATA', maquina: '', criadoEm: '2026-09-02T10:00:00.000Z' } },
    ],
  });
  win.confirm = () => true;
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftLimparProdutosDuplicados();
  const restantesCod555 = [...colProdutos._registro.entries()].filter(([, p]) => p.cod === '555');
  assert.equal(restantesCod555.length, 1, 'só sobra 1 documento pro cod duplicado');
  assert.equal(restantesCod555[0][0], 'novo0', 'sobrou o mais antigo (criadoEm menor)');
  assert.ok(colProdutos._registro.has('novo2'), 'produto sem duplicata nunca é tocado');
});

// Produtos com o MESMO cod mas máquinas DIFERENTES são variantes
// legítimas (o sistema original permite o mesmo código em máquinas
// diferentes) — nunca podem ser tratados como duplicata.
test('pftLimparProdutosDuplicados: mesmo cod em máquinas DIFERENTES não é duplicata — nenhum dos dois é apagado', async () => {
  const { win, colProdutos } = carregarPagina({
    produtos: [
      { id: 'p1', data: { cod: '304', nome: 'TAPIOCA', maquina: 'Extrusora 1', criadoEm: '2026-08-01T00:00:00.000Z' } },
      { id: 'p2', data: { cod: '304', nome: 'TAPIOCA', maquina: 'Extrusora 2', criadoEm: '2026-08-01T00:00:01.000Z' } },
    ],
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftLimparProdutosDuplicados();
  assert.equal(colProdutos._registro.size, 2, 'as 2 variantes de máquina continuam existindo — não é o bug de duplicação');
});

test('pftLimparProdutosDuplicados: sem duplicata nenhuma, não apaga nada e avisa', async () => {
  const { win, colProdutos } = carregarPagina({
    produtos: [{ id: 'p1', data: { cod: '304', nome: 'TAPIOCA', maquina: '', criadoEm: '2026-08-01T00:00:00.000Z' } }],
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftLimparProdutosDuplicados();
  assert.equal(colProdutos._registro.size, 1);
});

test('tela Cadastro de Produtos: botão "Corrigir duplicados" só aparece quando existe duplicata de verdade', async () => {
  const { win: comDup, document: docComDup } = carregarPagina({
    produtos: [
      { id: 'a', data: { cod: '555', nome: 'X', maquina: '', criadoEm: '2026-09-02T19:53:42.873Z' } },
      { id: 'b', data: { cod: '555', nome: 'X', maquina: '', criadoEm: '2026-09-02T19:53:55.943Z' } },
    ],
  });
  await comDup.renderProducaoFichaTecnica('pcfg-embed-host');
  assert.match(docComDup.getElementById('pcfg-embed-host').innerHTML, /data-pft-limpar-duplicados="1"[^>]*>🧹 Corrigir 1 duplicado/);

  const { win: semDup, document: docSemDup } = carregarPagina({
    produtos: [{ id: 'a', data: { cod: '304', nome: 'TAPIOCA', maquina: '', criadoEm: '2026-08-01' } }],
  });
  await semDup.renderProducaoFichaTecnica('pcfg-embed-host');
  assert.doesNotMatch(docSemDup.getElementById('pcfg-embed-host').innerHTML, /data-pft-limpar-duplicados/);
});

test('pftCatalogoCadastrarSelecionados: segunda chamada concorrente (clique duplo) enquanto a primeira ainda está em andamento é ignorada', async () => {
  let resolverPrimeiroGet;
  const { win, colProdutos } = carregarPagina({
    produtos: [],
    lojas: [{ id: 'loja1', nome: 'FILIAL', bluesoft_loja_key: 14 }],
    dtBiPastaLocal: {
      suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
      lerJson: async (nome) => (nome === 'dados-insumos.json' ? { produtos: [] } : [{ loja_key: 14, produto_key: 555, produto_acabado: 'PRODUTO', descricao_insumo: 'X', consumo_receita: 1 }]),
    },
  });
  await win.renderProducaoFichaTecnica('pcfg-embed-host');
  await win._DTFichaTecnicaBiInternals.pftAbrirModalCatalogo();
  win._DTFichaTecnicaBiInternals.getCatalogoSelecionados().add('555');
  // dispara duas chamadas "ao mesmo tempo", como um clique duplo faria.
  const p1 = win._DTFichaTecnicaBiInternals.pftCatalogoCadastrarSelecionados();
  const p2 = win._DTFichaTecnicaBiInternals.pftCatalogoCadastrarSelecionados();
  await Promise.all([p1, p2]);
  const comCod555 = [...colProdutos._registro.values()].filter(p => p.cod === '555');
  assert.equal(comCod555.length, 1, 'a segunda chamada concorrente não pode criar um segundo documento');
});
