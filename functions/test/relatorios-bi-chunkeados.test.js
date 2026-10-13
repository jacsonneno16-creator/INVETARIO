// PEDIDO AO VIVO (2026-08-27): "quero gravar mais só os dados desse ano
// pra frente" + "que seja por chunks aí pra não gerar tanta leitura" —
// os relatórios grandes de PCP/Compras/Produção (começando pelo Histórico
// de Compras, 97 mil linhas / 87,8 MB) passam a gravar no Firestore em
// pacotes de até 1000 registros por documento, filtrados a partir de 2026,
// pulando quem já existe (é histórico — nota já emitida nunca muda).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Firestore de verdade interpreta chaves com ponto ("registros.CHAVE") num
// set(...,{merge:true}) como caminho aninhado, não como nome de campo
// literal — sem isso o teste passaria de mentira (gravaria tudo plano).
function _aplicarMergeAninhado(destino, payload) {
  Object.entries(payload).forEach(([caminho, valor]) => {
    const partes = caminho.split('.');
    let alvo = destino;
    for (let i = 0; i < partes.length - 1; i++) {
      if (typeof alvo[partes[i]] !== 'object' || alvo[partes[i]] == null) alvo[partes[i]] = {};
      alvo = alvo[partes[i]];
    }
    alvo[partes[partes.length - 1]] = valor;
  });
}
function criarFirestoreFake() {
  const dados = new Map();
  function colRef(prefixo) {
    return {
      doc(id) {
        id = id || 'auto_' + Math.random().toString(36).slice(2);
        const caminho = prefixo + '/' + id;
        return {
          id, _path: caminho,
          collection(nome) { return colRef(caminho + '/' + nome); },
          async get() { return { exists: dados.has(caminho), id, data: () => dados.get(caminho) }; },
        };
      },
      async get() {
        const pfx = prefixo + '/';
        const docs = [];
        dados.forEach((valor, caminho) => {
          if (caminho.startsWith(pfx) && !caminho.slice(pfx.length).includes('/')) docs.push({ id: caminho.slice(pfx.length), data: () => valor });
        });
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  return {
    collection(nome) { return colRef(nome); },
    batch() {
      const ops = [];
      return {
        set(ref, payload, opts) { ops.push({ tipo: 'set', ref, payload, merge: !!(opts && opts.merge) }); },
        delete(ref) { ops.push({ tipo: 'delete', ref }); },
        async commit() {
          ops.forEach(op => {
            if (op.tipo === 'delete') { dados.delete(op.ref._path); return; }
            const atual = dados.get(op.ref._path) || {};
            if (op.merge) _aplicarMergeAninhado(atual, op.payload);
            else { Object.keys(atual).forEach(k => delete atual[k]); Object.assign(atual, op.payload); }
            dados.set(op.ref._path, atual);
          });
        },
      };
    },
    _dump: () => dados,
  };
}


function criarBigQueryLoadFake() {
  return {
    dataset() {
      return { table() { return { async load() { return [{}]; } }; } };
    },
  };
}

function carregarComFirestoreFake() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  const fakeDb = criarFirestoreFake();
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', { value: () => fakeDb, configurable: true });
  const indexModule = require(path.join(__dirname, '..', 'index.js'));
  return { fakeDb, internals: indexModule._graphBiInternals };
}

test('_sincronizarComprasHistoricoBi: filtra por ano mínimo (2026), ignora registros antigos', async () => {
  const { internals } = carregarComFirestoreFake();
  const registros = [
    { nota_fiscal_item_key: 1, data_emissao: '2025-12-31T00:00:00', nf_numero: 1 },
    { nota_fiscal_item_key: 2, data_emissao: '2026-01-01T00:00:00', nf_numero: 2 },
  ];
  const resultado = await internals._sincronizarComprasHistoricoBi(registros, criarBigQueryLoadFake());
  assert.equal(resultado.totalFiltrados, 1, 'só o registro de 2026 deveria passar no filtro');
  assert.equal(resultado.novos, 1);
});

// PEDIDO AO VIVO (2026-08-27): "MRO sai fora, logística sai fora, e o
// compras eu quero... e o que é transferência da matriz pra filial, crie
// um campo Em Trânsito" — a tela "Histórico de Compras" precisa do
// departamento/grupo/seção e do tipo de operação pra filtrar e rotular.
test('_sincronizarComprasHistoricoBi: grava departamento/grupo/seção/tipo_operacao na linha do relatório', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [
    { nota_fiscal_item_key: 10, produto_key: 27745, descricao: 'Tapioca', grupo: 'TAPIOCA DA TERRINHA', Departamento: 'PRODUTO DE VENDA', Secao: 'TAPIOCA DA TERRINHA', TIPO_OPERACAO: 'TRANSFERENCIA', data_emissao: '2026-02-01T00:00:00', nf_numero: 10 },
    { nota_fiscal_item_key: 11, produto_key: 50095, descricao: 'Mandioca in natura', grupo: 'IN NATURA', Departamento: 'COMPRAS', Secao: 'IN NATURA', TIPO_OPERACAO: 'COMPRA', data_emissao: '2026-02-02T00:00:00', nf_numero: 11 },
  ];
  await internals._sincronizarComprasHistoricoBi(registros, criarBigQueryLoadFake());
  const linha10 = fakeDb._dump().get('relatorios_bi_compras_historico_chunks/chunk_0').registros['10'];
  assert.equal(linha10.departamento, 'PRODUTO DE VENDA');
  assert.equal(linha10.secao, 'TAPIOCA DA TERRINHA');
  assert.equal(linha10.tipo_operacao, 'TRANSFERENCIA');
  const linha11 = fakeDb._dump().get('relatorios_bi_compras_historico_chunks/chunk_0').registros['11'];
  assert.equal(linha11.departamento, 'COMPRAS');
  assert.equal(linha11.tipo_operacao, 'COMPRA');
});

test('_sincronizarRelatorioBiChunkeadoGlobal: grava em pacotes, pula quem já existe (histórico nunca muda)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros1 = [{ id: 'a', valor: 10 }, { id: 'b', valor: 20 }];
  const r1 = await internals._sincronizarRelatorioBiChunkeadoGlobal('teste_chunks', registros1, r => r.id, r => ({ id: r.id, valor: r.valor }));
  assert.equal(r1.novos, 2);
  assert.equal(r1.jaExistiam, 0);

  // roda de novo com os mesmos 2 + 1 novo — só o novo deve ser gravado
  const registros2 = [{ id: 'a', valor: 999 }, { id: 'b', valor: 999 }, { id: 'c', valor: 30 }];
  const r2 = await internals._sincronizarRelatorioBiChunkeadoGlobal('teste_chunks', registros2, r => r.id, r => ({ id: r.id, valor: r.valor }));
  assert.equal(r2.novos, 1, 'só "c" é novo — "a" e "b" já existiam e não podem ser regravados');
  assert.equal(r2.jaExistiam, 2);

  const chunk0 = fakeDb._dump().get('teste_chunks/chunk_0');
  assert.equal(chunk0.registros.a.valor, 10, 'valor de "a" não pode ter sido sobrescrito por 999 (histórico é imutável)');
  assert.equal(chunk0.registros.c.valor, 30);
});

test('_construirClassificacaoProdutosComprasBi: um registro por produto, com o Departamento/Grupo/Seção mais recente', () => {
  const { internals } = carregarComFirestoreFake();
  const registros = [
    { produto_key: 100, descricao: 'Parafuso', grupo: 'MANUTENCAO', Departamento: 'MRO', Secao: 'MANUTENCAO', data_emissao: '2024-01-01T00:00:00' },
    { produto_key: 100, descricao: 'Parafuso', grupo: 'MANUTENCAO', Departamento: 'MRO', Secao: 'MANUTENCAO', data_emissao: '2026-03-01T00:00:00' },
    { produto_key: 200, descricao: 'Tapioca 1kg', grupo: 'TAPIOCA DA TERRINHA', Departamento: 'PRODUTO DE VENDA', Secao: 'TAPIOCA DA TERRINHA', data_emissao: '2025-05-01T00:00:00' },
    { produto_key: 300, descricao: null, grupo: null, Departamento: null, Secao: null, data_emissao: '2025-01-01T00:00:00' },
  ];
  const classificados = internals._construirClassificacaoProdutosComprasBi(registros);
  assert.equal(classificados.length, 3, 'um registro por produto distinto, mesmo com 2 lançamentos do produto 100');
  const p100 = classificados.find(c => c.produtoKey === '100');
  assert.equal(p100.departamento, 'MRO');
  assert.ok(!('_emissao' in p100), 'campo interno de desempate não pode vazar no resultado');
  const p200 = classificados.find(c => c.produtoKey === '200');
  assert.equal(p200.departamento, 'PRODUTO DE VENDA');
});

test('_construirClassificacaoProdutosComprasBi: registro sem produto_key é ignorado (não dá pra classificar sem código)', () => {
  const { internals } = carregarComFirestoreFake();
  const classificados = internals._construirClassificacaoProdutosComprasBi([{ descricao: 'Sem código', grupo: 'X' }]);
  assert.equal(classificados.length, 0);
});

test('_gravarClassificacaoProdutosComprasBi: grava um doc por produto na coleção global, silenciosa (não é lida por nenhum relatório visível)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const resultado = await internals._gravarClassificacaoProdutosComprasBi([
    { produtoKey: '100', descricao: 'Parafuso', grupo: 'MANUTENCAO', departamento: 'MRO', secao: 'MANUTENCAO' },
    { produtoKey: '200', descricao: 'Tapioca 1kg', grupo: 'TAPIOCA DA TERRINHA', departamento: 'PRODUTO DE VENDA', secao: 'TAPIOCA DA TERRINHA' },
  ]);
  assert.equal(resultado.gravados, 2);
  const doc100 = fakeDb._dump().get('bi_classificacao_produtos/100');
  assert.equal(doc100.departamento, 'MRO');
  assert.ok(doc100.atualizadoEm);
});

test('_sincronizarComprasHistoricoBi: também grava a classificação de produtos, usando TODOS os anos (não só 2026+)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [
    { nota_fiscal_item_key: 1, produto_key: 100, descricao: 'Parafuso', grupo: 'MANUTENCAO', Departamento: 'MRO', Secao: 'MANUTENCAO', data_emissao: '2024-01-01T00:00:00', nf_numero: 1 },
    { nota_fiscal_item_key: 2, produto_key: 200, descricao: 'Tapioca 1kg', grupo: 'TAPIOCA DA TERRINHA', Departamento: 'PRODUTO DE VENDA', Secao: 'TAPIOCA DA TERRINHA', data_emissao: '2026-01-01T00:00:00', nf_numero: 2 },
  ];
  const resultado = await internals._sincronizarComprasHistoricoBi(registros, criarBigQueryLoadFake());
  assert.equal(resultado.totalFiltrados, 1, 'a tela de Histórico continua vendo só 2026+, sem mudar nada visível');
  assert.equal(resultado.classificacaoProdutos.gravados, 2, 'mas a classificação usa os 2 produtos, mesmo o de 2024');
  assert.ok(fakeDb._dump().get('bi_classificacao_produtos/100'), 'produto de 2024 (fora do filtro visível) ainda fica classificado');
});

// PEDIDO AO VIVO (2026-08-28): "ranking de fornecedores que você não
// aplicou lá no Compras" — grava um doc por categoria+ano (pequeno, sem
// chunking) pra Compras ler sem buscar o arquivo de 6MB toda vez.
test('_sincronizarFornecedoresAgregadoBi: grava um doc por categoria+ano com o top de fornecedores', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const dados = {
    materia_prima: { anoData: { '2025': { top: [{ f: 'Fornecedor A', valor: 100, kg: 10, caixas: 0 }] }, '2026': { top: [{ f: 'Fornecedor B', valor: 200, kg: 20, caixas: 5 }] } } },
    produto_acabado: { anoData: { '2025': { top: [{ f: 'Fornecedor C', valor: 50, kg: 5, caixas: 1 }] } } },
  };
  const resultado = await internals._sincronizarFornecedoresAgregadoBi(dados);
  assert.equal(resultado.gravados, 3);
  const doc = fakeDb._dump().get('bi_fornecedores_agregado/materia_prima_2026');
  assert.equal(doc.categoria, 'materia_prima');
  assert.equal(doc.ano, '2026');
  assert.equal(doc.top[0].f, 'Fornecedor B');
  assert.ok(fakeDb._dump().get('bi_fornecedores_agregado/produto_acabado_2025'));
});

test('_sincronizarFornecedoresAgregadoBi: sem dados (bloco ausente), não grava nada e não quebra', async () => {
  const { internals } = carregarComFirestoreFake();
  const resultado = await internals._sincronizarFornecedoresAgregadoBi(null);
  assert.equal(resultado.gravados, 0);
});

// PEDIDO AO VIVO (2026-08-28): "a quantidade que usa de cada insumo, você
// não aplicou" — soma mediaMensal/totalPeriodo por sku (perde granularidade
// de loja de propósito, a visão pedida é por produto).
test('_construirConsumoInsumosResumoBi: soma mediaMensal e totalPeriodo de todas as lojas do mesmo sku', () => {
  const { internals } = carregarComFirestoreFake();
  const dados = { produtos: [
    { sku: '1', produto: 'Farinha', categoria: 'INSUMO', mediaMensal: 10, totalPeriodo: 100 },
    { sku: '1', produto: 'Farinha', categoria: 'INSUMO', mediaMensal: 5, totalPeriodo: 50 },
    { sku: '2', produto: 'Sal', mediaMensal: 2, totalPeriodo: 20 },
  ] };
  const lista = internals._construirConsumoInsumosResumoBi(dados);
  assert.equal(lista.length, 2);
  const farinha = lista.find(x => x.sku === '1');
  assert.equal(farinha.mediaMensal, 15);
  assert.equal(farinha.totalPeriodo, 150);
});

test('_gravarConsumoInsumosResumoBi: grava um doc por sku', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const resultado = await internals._gravarConsumoInsumosResumoBi([{ sku: '1', produto: 'Farinha', mediaMensal: 15, totalPeriodo: 150 }]);
  assert.equal(resultado.gravados, 1);
  const doc = fakeDb._dump().get('bi_consumo_insumos_resumo/1');
  assert.equal(doc.produto, 'Farinha');
  assert.equal(doc.mediaMensal, 15);
});

// PEDIDO AO VIVO (2026-08-28): "eu quero uma aba de cortes... só puxe o
// total... vai somar o que aconteceu, vai colocar por mês, por produtos" —
// dados_cortes.json (53 mil linhas) agregado por mês+produto, nunca cru.
// PEDIDO AO VIVO (2026-09-17): "só precisa ler do dia anterior pra frente,
// é dados que não mudam" — só agrega mês atual + anterior (referência
// injetável via agoraISO, pra o teste ficar determinístico e não depender
// do dia real em que a suíte roda); meses mais antigos que isso nunca
// mais são reprocessados. "Só a 2JM Amidos é intercompany" — loja_key 11
// nunca entra; TODAS as outras entram normalmente (Terrinha Matriz/Filial,
// OK Matriz/Filial, J E Comércio etc. também fazem venda real pra cliente).
test('_construirCortesResumoMensalBi: soma por mês+produto (só mês atual/anterior, loja 11 sempre fora), ignora linha sem data, sem produto_key, da 2JM Amidos, ou de mês fechado antigo', () => {
  const { internals } = carregarComFirestoreFake();
  const agoraISO = '2026-08-15T12:00:00.000Z'; // "hoje" simulado — mês atual=2026-08, anterior=2026-07
  const registros = [
    { data: '2026-07-05T00:00:00', loja_key: '1', produto_key: 100, descricao: 'Tapioca', quantidadePedidaCx: 50, quantidadeFaturadaCx: 45, corteRoteiroCx: 5, valorPedidoTotal: 500, faturamentoRs: 450 },
    { data: '2026-07-20T00:00:00', loja_key: '17', produto_key: 100, descricao: 'Tapioca', quantidadePedidaCx: 30, quantidadeFaturadaCx: 30, corteRoteiroCx: 0, valorPedidoTotal: 300, faturamentoRs: 300 },
    { data: '2026-08-01T00:00:00', loja_key: '1', produto_key: 100, descricao: 'Tapioca', quantidadePedidaCx: 10, quantidadeFaturadaCx: 10, corteRoteiroCx: 0, valorPedidoTotal: 100, faturamentoRs: 100 },
    { data: null, loja_key: '1', produto_key: 200, descricao: 'Sem data' },
    { data: '2026-07-01T00:00:00', loja_key: '1', produto_key: null, descricao: 'Sem produto' },
    { data: '2026-07-10T00:00:00', loja_key: '11', produto_key: 100, descricao: 'Tapioca', quantidadePedidaCx: 999, quantidadeFaturadaCx: 999, corteRoteiroCx: 999, valorPedidoTotal: 9999, faturamentoRs: 9999 }, // 2JM Amidos — fora
    { data: '2026-05-10T00:00:00', loja_key: '1', produto_key: 100, descricao: 'Tapioca', quantidadePedidaCx: 999, quantidadeFaturadaCx: 999, corteRoteiroCx: 999, valorPedidoTotal: 9999, faturamentoRs: 9999 }, // mês fechado antigo — fora
  ];
  const itens = internals._construirCortesResumoMensalBi(registros, agoraISO);
  assert.equal(itens.length, 2, 'julho/produto100 (loja 1) somado + agosto/produto100 — loja 17 (OK Filial) soma junto no mesmo produto/mês, só a 11 (2JM) e o mês antigo ficam fora');
  const julho = itens.find(x => x.mes === '2026-07' && x.produtoKey === '100');
  assert.equal(julho.quantidadePedidaCx, 80);
  assert.equal(julho.quantidadeFaturadaCx, 75);
  assert.equal(julho.corteRoteiroCx, 5);
  assert.equal(julho.valorPedidoTotal, 800);
  const agosto = itens.find(x => x.mes === '2026-08');
  assert.equal(agosto.quantidadePedidaCx, 10);
});

test('_gravarCortesResumoMensalBi: grava um doc por mês, cada um com a lista de produtos daquele mês', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const resultado = await internals._gravarCortesResumoMensalBi([
    { mes: '2026-07', produtoKey: '100', quantidadePedidaCx: 80 },
    { mes: '2026-07', produtoKey: '200', quantidadePedidaCx: 20 },
    { mes: '2026-08', produtoKey: '100', quantidadePedidaCx: 10 },
  ]);
  assert.equal(resultado.totalMeses, 2);
  assert.equal(resultado.totalItens, 3);
  const julho = fakeDb._dump().get('bi_cortes_mensal/2026-07');
  assert.equal(julho.itens.length, 2);
  const agosto = fakeDb._dump().get('bi_cortes_mensal/2026-08');
  assert.equal(agosto.itens.length, 1);
});

// BUG AO VIVO REAL (2026-09-03): TAMANHO_CHUNK_RELATORIOS caiu de 1000 pra
// 400 — mesmo conserto do TAMANHO_CHUNK_NOTAS_RETORNADAS (recebimento_
// recusas_notas_chunks estourou o limite real de 1MB do Firestore com
// 1000 registros por pacote; 400 dá bem mais folga).
test('_sincronizarRelatorioBiChunkeadoGlobal: quando um pacote enche (400), o próximo registro abre um pacote novo', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const quatrocentos = Array.from({ length: 400 }, (_, i) => ({ id: 'r' + i, valor: i }));
  await internals._sincronizarRelatorioBiChunkeadoGlobal('teste_chunks_cheio', quatrocentos, r => r.id, r => ({ id: r.id, valor: r.valor }));
  const resultado = await internals._sincronizarRelatorioBiChunkeadoGlobal('teste_chunks_cheio', [{ id: 'novo', valor: 9999 }], r => r.id, r => ({ id: r.id, valor: r.valor }));
  assert.equal(resultado.novos, 1);
  assert.equal(fakeDb._dump().has('teste_chunks_cheio/chunk_1'), true, 'pacote 0 já tinha 400 — o novo registro precisa abrir o pacote 1');
  assert.equal(Object.keys(fakeDb._dump().get('teste_chunks_cheio/chunk_0').registros).length, 400, 'pacote 0 continua com os 400 originais, intocado');
});
