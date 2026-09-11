// PEDIDO AO VIVO (2026-08-27): "coloca também uma atualização automática...
// pra atualizar toda vez que o arquivo for atualizado" — sincronizarBiAgendado
// (index.js) roda no servidor, sem navegador nenhum aberto, pra Ficha
// Técnica e Agenda de Recebimento (os 2 fluxos mais simples — só merge,
// sem pacotes/exclusão como o ledger de venda). Duplica de propósito a
// mesma lógica já validada em produção do lado do cliente
// (_agruparFichaTecnicaBiPorProduto em 60-producao-ficha-tecnica.js e
// _agruparComprasAReceberBiPorPedido/_gravarAgendaPendentes em
// 90-bluesoft-service.js) — se a lógica de agrupamento mudar de um lado,
// replicar a mudança no outro.
//
// Não dá pra usar o emulador real do Firestore aqui (exige Java, não
// disponível neste ambiente) — em vez disso, troca admin.firestore() por
// um Firestore-em-memória simples (suporta collection/doc/collection
// aninhado + batch com merge) via Object.defineProperty (admin.firestore
// é um getter sem setter no SDK real).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Firestore de verdade interpreta chave com ponto ("notas.CHAVE") num
// set(...,{merge:true}) como caminho ANINHADO, não como nome de campo
// literal, e FieldValue.delete() apaga só aquela chave aninhada — sem
// isso os testes de chunk (_sincronizarNotasRetornadasVendaBiLoja) e de
// remoção passariam de mentira. Mesmo helper já usado em
// relatorios-bi-chunkeados.test.js.
function _ehSentinelDeDelete(valor) {
  return !!(valor && typeof valor === 'object' && valor.methodName === 'FieldValue.delete');
}
function _aplicarMergeAninhado(destino, payload) {
  Object.entries(payload).forEach(([caminho, valor]) => {
    const partes = caminho.split('.');
    let alvo = destino;
    for (let i = 0; i < partes.length - 1; i++) {
      if (typeof alvo[partes[i]] !== 'object' || alvo[partes[i]] == null) alvo[partes[i]] = {};
      alvo = alvo[partes[i]];
    }
    const ultima = partes[partes.length - 1];
    if (_ehSentinelDeDelete(valor)) delete alvo[ultima];
    else alvo[ultima] = valor;
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
          id,
          _path: caminho,
          collection(nome) { return colRef(caminho + '/' + nome); },
          async get() { return { exists: dados.has(caminho), id, data: () => dados.get(caminho) }; },
        };
      },
      async get() {
        const pfx = prefixo + '/';
        const docs = [];
        dados.forEach((valor, caminho) => {
          if (caminho.startsWith(pfx) && !caminho.slice(pfx.length).includes('/')) {
            docs.push({ id: caminho.slice(pfx.length), data: () => valor });
          }
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

function carregarComFirestoreFake() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  const fieldValueReal = admin.firestore.FieldValue; // preserva FieldValue.delete() real (sentinel de verdade), só troca o db
  const fakeDb = criarFirestoreFake();
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', { value: Object.assign(() => fakeDb, { FieldValue: fieldValueReal }), configurable: true });
  const indexModule = require(path.join(__dirname, '..', 'index.js'));
  return { fakeDb, internals: indexModule._graphBiInternals };
}

test('_sincronizarFichaTecnicaBiLoja: merge preserva campos manuais (maquina/pc_min), atualiza desc/insumos, e conta produto sem cadastro', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/producao_produtos/p1', { cod: '304', nome: 'Tapioca' });
  fakeDb._dump().set('lojas/loja1/producao_ficha_tecnica/f1', { cod: '304', desc: 'Tapioca (antiga)', maquina: 'Envasadora 1', pc_min: 40, insumos: [{ insumo: 'Antigo', qty: 1, categoria: '' }] });

  const registros = [
    { loja_key: 14, produto_key: 304, produto_acabado: 'TAPIOCA NOVA', descricao_insumo: 'Fécula', consumo_receita: 0.5 },
    { loja_key: 14, produto_key: 999, produto_acabado: 'PRODUTO SEM CADASTRO', descricao_insumo: 'X', consumo_receita: 1 },
  ];
  const resultado = await internals._sincronizarFichaTecnicaBiLoja('loja1', 14, registros);
  assert.equal(resultado.total, 2);
  assert.equal(resultado.semProduto, 1);

  const f1Depois = fakeDb._dump().get('lojas/loja1/producao_ficha_tecnica/f1');
  assert.equal(f1Depois.desc, 'TAPIOCA NOVA');
  assert.equal(f1Depois.maquina, 'Envasadora 1', 'merge:true não pode apagar campo que o sync nem manda');
  assert.equal(f1Depois.pc_min, 40);
  assert.equal(f1Depois.insumos[0].insumo, 'Fécula');

  let ficha999 = null;
  fakeDb._dump().forEach(v => { if (v.cod === '999') ficha999 = v; });
  assert.ok(ficha999, 'ficha do produto sem cadastro ainda deve ser criada');
});

test('_sincronizarFichaTecnicaBiLoja: filtra por loja_key — linha de outra loja não entra', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [{ loja_key: 99, produto_key: 1, produto_acabado: 'De outra loja', descricao_insumo: 'X', consumo_receita: 1 }];
  const resultado = await internals._sincronizarFichaTecnicaBiLoja('loja1', 14, registros);
  assert.equal(resultado.total, 0);
});

test('_sincronizarAgendaBiLoja: cria pedido novo, atualiza existente, e NUNCA apaga uma data confirmada manualmente', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_agendamentos/a1', { numeroPedido: '500', origem: 'bluesoft', dataAgendada: '2026-09-01', agendamentoConfirmadoManual: true });

  const registros = [
    { loja_key: 14, pedido_key: 500, qtd_unidades_pendentes: 10, fornecedor: 'Fornecedor X', comprador: 'João', data_entrega_inicial: '2026-08-30', data_entrega_final: '2026-08-31', produto_key: 1, descricao: 'Farinha' },
    { loja_key: 14, pedido_key: 600, qtd_unidades_pendentes: 5, fornecedor: 'Fornecedor Y', comprador: 'Maria', data_entrega_inicial: '2026-09-05', data_entrega_final: '2026-09-06', produto_key: 2, descricao: 'Açúcar' },
    { loja_key: 99, pedido_key: 700, qtd_unidades_pendentes: 5, fornecedor: 'Outra loja', comprador: '', data_entrega_inicial: '2026-09-05', data_entrega_final: '2026-09-06', produto_key: 3, descricao: 'Não pode entrar' },
  ];
  const resultado = await internals._sincronizarAgendaBiLoja('loja1', { id: 'loja1', nome: 'Loja 1', bluesoft_loja_key: 14 }, registros);
  assert.equal(resultado.criados, 1);
  assert.equal(resultado.atualizados, 1);

  const a1Depois = fakeDb._dump().get('lojas/loja1/recebimento_agendamentos/a1');
  assert.equal(a1Depois.dataAgendada, '2026-09-01', 'data confirmada manualmente nunca pode ser limpa pelo sync automático');
  assert.equal(a1Depois.fornecedorNome, 'Fornecedor X');
  assert.equal(a1Depois.origem, 'bi', 'REGRESSÃO: este sync já vem do SharePoint desde que foi criado — gravava origem:\'bluesoft\' por engano, copiado do payload antigo sem trocar o rótulo');

  let pedido600 = null;
  fakeDb._dump().forEach(v => { if (v.numeroPedido === '600') pedido600 = v; });
  assert.equal(pedido600.origem, 'bi', 'pedido novo criado por este sync também precisa vir rotulado como bi, não bluesoft');

  let pedido700 = null;
  fakeDb._dump().forEach(v => { if (v.numeroPedido === '700') pedido700 = v; });
  assert.equal(pedido700, null, 'pedido de outra loja não pode vazar pra loja1');
});

// PEDIDO AO VIVO (2026-08-27): "tira tudo da bluesoft... pra quando você
// linkar no SharePoint, puxar essas informações atualizadas" — antes da
// correção do rótulo (teste acima), docs antigos ficaram gravados com
// origem:'bluesoft' mesmo já vindo do SharePoint. limparPrevisaoAntiga
// precisa continuar reconhecendo esses docs legados como "veio de sync
// automático" (não confirmado manualmente), senão a previsão antiga fica
// presa pra sempre num doc que só está rotulado errado.
test('_sincronizarAgendaBiLoja: doc legado com origem:\'bluesoft\' (rótulo antigo, já vinha do SharePoint) ainda tem a previsão antiga limpa normalmente', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_agendamentos/a1', { numeroPedido: '500', origem: 'bluesoft', dataAgendada: '2026-09-01', agendamentoConfirmadoManual: false });
  const registros = [{ loja_key: 14, pedido_key: 500, qtd_unidades_pendentes: 10, fornecedor: 'Fornecedor X', comprador: 'João', data_entrega_inicial: '2026-08-30', data_entrega_final: '2026-08-31', produto_key: 1, descricao: 'Farinha' }];
  await internals._sincronizarAgendaBiLoja('loja1', { id: 'loja1', nome: 'Loja 1', bluesoft_loja_key: 14 }, registros);
  const a1Depois = fakeDb._dump().get('lojas/loja1/recebimento_agendamentos/a1');
  assert.equal(a1Depois.dataAgendada, '', 'não confirmado manualmente — previsão antiga deve ser limpa mesmo com rótulo legado bluesoft');
  assert.equal(a1Depois.origem, 'bi', 'a partir desta sincronização o rótulo já corrige pra bi');
});

// PEDIDO AO VIVO (2026-08-27): "traz os campos código do produto, valor,
// quantidade recebida pra dentro do pedido" — o arquivo já trazia esses
// campos, só não eram lidos pra dentro de itensPedido.
test('_sincronizarAgendaBiLoja: cada item carrega código do produto, custo unitário, quantidade recebida e valor pendente — somando entre parcelas do mesmo pedido/produto', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [
    { loja_key: 14, pedido_key: 800, qtd_unidades_pendentes: 100, qtd_unidades_recebidas: 20, valor_pendente: 500, custo_unitario: 5, fornecedor: 'Fornecedor Z', comprador: 'Ana', data_entrega_inicial: '2026-09-10', data_entrega_final: '2026-09-12', produto_key: 42, descricao: 'Embalagem 1kg' },
    { loja_key: 14, pedido_key: 800, qtd_unidades_pendentes: 30, qtd_unidades_recebidas: 10, valor_pendente: 150, custo_unitario: 5, fornecedor: 'Fornecedor Z', comprador: 'Ana', data_entrega_inicial: '2026-09-10', data_entrega_final: '2026-09-12', produto_key: 42, descricao: 'Embalagem 1kg' },
  ];
  await internals._sincronizarAgendaBiLoja('loja1', { id: 'loja1', nome: 'Loja 1', bluesoft_loja_key: 14 }, registros);
  let pedido800 = null;
  fakeDb._dump().forEach(v => { if (v.numeroPedido === '800') pedido800 = v; });
  assert.equal(pedido800.itensPedido.length, 1, 'as 2 parcelas do mesmo produto viram 1 item só');
  const item = pedido800.itensPedido[0];
  assert.equal(item.produtoKey, '42');
  assert.equal(item.custoUnitario, 5);
  assert.equal(item.quantidadePendente, 130, '100 + 30 das duas parcelas');
  assert.equal(item.quantidadeRecebida, 30, '20 + 10 das duas parcelas');
  assert.equal(item.valorPendente, 650, '500 + 150 das duas parcelas');
});

test('_sincronizarAgendaBiLoja: sem nenhum pedido pendente pra loja, não grava nada e não quebra', async () => {
  const { internals } = carregarComFirestoreFake();
  const resultado = await internals._sincronizarAgendaBiLoja('loja1', { id: 'loja1', bluesoft_loja_key: 14 }, []);
  assert.equal(resultado.totalPedidosPendentes, 0);
  assert.equal(resultado.criados, 0);
});

// PEDIDO AO VIVO (2026-08-27): "mas é para puxar do share point tudo nao
// mais da bluesoft" — pcp_estoque_bluesoft (lido por 66-producao-projecao.js
// e 78-pcp-central.js, tela "Pedidos x Estoque") passa a ser alimentado
// também por dados-insumos.json do BI, mesma coleção/doc-id que a Bluesoft
// já usava, só com origem:'bi'.
test('_sincronizarEstoqueInsumosBiLoja: grava estoqueAtual e consumoDiaMedioBluesoft, filtrando por loja (numérica)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [
    { sku: '09016', produto: 'FARINHA DE MANDIOCA CRUA GROSSA BIG BAG Kg', loja: '14', unidade: 'kg', estoque: 1200, consumoMensal: 900 },
    { sku: '99999', produto: 'De outra loja', loja: '99', unidade: 'kg', estoque: 500, consumoMensal: 300 },
  ];
  const resultado = await internals._sincronizarEstoqueInsumosBiLoja('loja1', 14, registros);
  assert.equal(resultado.total, 1);
  assert.equal(resultado.gravados, 1);

  const doc = fakeDb._dump().get('lojas/loja1/pcp_estoque_bluesoft/produto_09016');
  assert.ok(doc, 'doc deve existir com o mesmo id que a Bluesoft usava (produto_<cod>)');
  assert.equal(doc.cod, '09016');
  assert.equal(doc.estoqueAtual, 1200);
  assert.equal(doc.consumoDiaMedioBluesoft, 30);
  assert.equal(doc.origem, 'bi');

  let deOutraLoja = null;
  fakeDb._dump().forEach(v => { if (v.cod === '99999') deOutraLoja = v; });
  assert.equal(deOutraLoja, null, 'insumo de outra loja não pode vazar pra loja1');
});

test('_sincronizarEstoqueInsumosBiLoja: merge preserva campos gravados por outra origem (ex.: estoqueReservadoVenda da Bluesoft)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_09016', { cod: '09016', estoqueAtual: 5, estoqueReservadoVenda: 40, origem: 'bluesoft' });
  const registros = [{ sku: '09016', produto: 'FARINHA', loja: '14', unidade: 'kg', estoque: 1200, consumoMensal: 900 }];
  await internals._sincronizarEstoqueInsumosBiLoja('loja1', 14, registros);
  const doc = fakeDb._dump().get('lojas/loja1/pcp_estoque_bluesoft/produto_09016');
  assert.equal(doc.estoqueAtual, 1200, 'valor mais recente (BI) substitui o antigo');
  assert.equal(doc.estoqueReservadoVenda, 40, 'merge:true não pode apagar campo que só a Bluesoft preenche');
  assert.equal(doc.origem, 'bi');
});

test('_sincronizarEstoqueInsumosBiLoja: sem registros, não grava nada e não quebra', async () => {
  const { internals } = carregarComFirestoreFake();
  const resultado = await internals._sincronizarEstoqueInsumosBiLoja('loja1', 14, []);
  assert.equal(resultado.total, 0);
  assert.equal(resultado.gravados, 0);
});

// PEDIDO AO VIVO (2026-08-27): "migra tudo" — produtos_estoque.json cobre
// o produto ACABADO (dados-insumos.json só cobria matéria-prima/embalagem).
// loja_key é numérico aqui (confirmado nos dados reais), diferente de
// dados-estoque.json (loja por nome de cliente/marca, fora de escopo).
// quantidadePedidos = pedido de venda pendente/reservado — mesmo campo
// (`estoqueReservadoVenda`) que 78-pcp-central.js:35 já lê pra calcular
// `disponivel=estoque-comprometido`.
test('_sincronizarEstoqueProdutoAcabadoBiLoja: grava estoqueAtual e estoqueReservadoVenda, só pra produto já cadastrado, filtrando por loja_key', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/producao_produtos/p1', { cod: '304', nome: 'Tapioca' });
  const registros = [
    { loja: 'DA TERRINHA - MATRIZ', loja_key: 1, produto_key: 304, produto: '00001 TAPIOCA DA TERRINHA 1 KG - CX 12', quantidade_estoque: 1482, quantidadePedidos: 2240, coberturaDias: -0.54 },
    { loja: 'Outra loja', loja_key: 99, produto_key: 999, produto: 'De outra loja', quantidade_estoque: 10, quantidadePedidos: 5 },
  ];
  const resultado = await internals._sincronizarEstoqueProdutoAcabadoBiLoja('loja1', 1, registros);
  assert.equal(resultado.total, 1);
  assert.equal(resultado.gravados, 1);

  const doc = fakeDb._dump().get('lojas/loja1/pcp_estoque_bluesoft/produto_304');
  assert.ok(doc, 'doc deve existir com o mesmo id que a Bluesoft usava (produto_<cod>)');
  assert.equal(doc.cod, '304');
  assert.equal(doc.estoqueAtual, 1482);
  assert.equal(doc.estoqueReservadoVenda, 2240, 'quantidadePedidos vira estoqueReservadoVenda — mesmo campo que o PCP já lê pro cálculo de disponível');
  assert.equal(doc.origem, 'bi');

  let deOutraLoja = null;
  fakeDb._dump().forEach(v => { if (v.cod === '999') deOutraLoja = v; });
  assert.equal(deOutraLoja, null, 'produto de outra loja não pode vazar pra loja1');
});

// PEDIDO AO VIVO (2026-08-27): "aquele cadastro da produção é o que produz
// nela, mas tem produtos que vem de fornecedores, então não pode usar o
// que tá lá para o restante do estoque" — restringir só a producao_produtos
// (fabricação) excluía todo produto comprado de fornecedor e revendido
// pela loja. cod cadastrado em pcp_produtos_bluesoft (o cadastro mais
// amplo que 78-pcp-central.js já une com producao_produtos) também conta.
test('_sincronizarEstoqueProdutoAcabadoBiLoja: aceita cod cadastrado em pcp_produtos_bluesoft (produto de fornecedor, não fabricado nesta loja)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/pcp_produtos_bluesoft/p1', { cod: '304', nome: 'Tapioca (comprada de fornecedor)' });
  const registros = [{ loja: 'DA TERRINHA - MATRIZ', loja_key: 1, produto_key: 304, produto: 'TAPIOCA', quantidade_estoque: 1482, quantidadePedidos: 2240 }];
  const resultado = await internals._sincronizarEstoqueProdutoAcabadoBiLoja('loja1', 1, registros);
  assert.equal(resultado.gravados, 1, 'produto sem cadastro em producao_produtos, mas cadastrado em pcp_produtos_bluesoft, ainda deve ser gravado');
  const doc = fakeDb._dump().get('lojas/loja1/pcp_estoque_bluesoft/produto_304');
  assert.equal(doc.estoqueAtual, 1482);
});

// BUG AO VIVO REAL (2026-08-27): "Estoque atual (CX)" do Dashboard do PCP
// pulou pra 15 milhões — produtos_estoque.json mistura produto acabado em
// CAIXA com matéria-prima em KG de outras plantas (ex.: loja_key 7
// "TERRAFEC FECULA MANDIOCA", "000002 FECULA KG": 806.000), sem campo de
// unidade pra distinguir. Regressão coberta aqui: um produto_key que não
// está cadastrado em producao_produtos desta loja NUNCA é gravado, mesmo
// se o loja_key bater — é exatamente esse tipo de linha (código
// desconhecido, quantidade enorme) que inflava o KPI.
test('_sincronizarEstoqueProdutoAcabadoBiLoja: REGRESSÃO — ignora produto_key que não está cadastrado em producao_produtos, mesmo com loja_key correto (bug real: matéria-prima de outra planta inflando o estoque em milhões)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/producao_produtos/p1', { cod: '304', nome: 'Tapioca' });
  const registros = [
    { loja: 'DA TERRINHA - MATRIZ', loja_key: 1, produto_key: 304, produto: 'TAPIOCA', quantidade_estoque: 1482, quantidadePedidos: 2240 },
    { loja: 'DA TERRINHA - MATRIZ', loja_key: 1, produto_key: 75915, produto: '000002 FECULA KG', quantidade_estoque: 806000, quantidadePedidos: null },
  ];
  const resultado = await internals._sincronizarEstoqueProdutoAcabadoBiLoja('loja1', 1, registros);
  assert.equal(resultado.total, 1, 'a fécula (não cadastrada) nem entra na contagem de relevantes');
  assert.equal(resultado.gravados, 1);
  let fecula = null;
  fakeDb._dump().forEach(v => { if (v.cod === '75915') fecula = v; });
  assert.equal(fecula, null, 'matéria-prima de outra planta, sem cadastro em producao_produtos, nunca pode ser gravada como estoque de produto acabado');
});

test('_sincronizarEstoqueProdutoAcabadoBiLoja: merge preserva campos gravados por outra origem (ex.: custoUltimaCompra da Bluesoft)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/producao_produtos/p1', { cod: '304', nome: 'Tapioca' });
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_304', { cod: '304', estoqueAtual: 5, custoUltimaCompra: 12.5, origem: 'bluesoft' });
  const registros = [{ loja_key: 1, produto_key: 304, produto: 'TAPIOCA', quantidade_estoque: 1482, quantidadePedidos: 2240 }];
  await internals._sincronizarEstoqueProdutoAcabadoBiLoja('loja1', 1, registros);
  const doc = fakeDb._dump().get('lojas/loja1/pcp_estoque_bluesoft/produto_304');
  assert.equal(doc.estoqueAtual, 1482, 'valor mais recente (BI) substitui o antigo');
  assert.equal(doc.custoUltimaCompra, 12.5, 'merge:true não pode apagar campo que só a Bluesoft preenche');
  assert.equal(doc.origem, 'bi');
});

test('_sincronizarEstoqueProdutoAcabadoBiLoja: sem registros, não grava nada e não quebra', async () => {
  const { internals } = carregarComFirestoreFake();
  const resultado = await internals._sincronizarEstoqueProdutoAcabadoBiLoja('loja1', 1, []);
  assert.equal(resultado.total, 0);
  assert.equal(resultado.gravados, 0);
});

// PEDIDO AO VIVO (2026-08-27): "migra tudo" — último dado que faltava:
// venda_m1/m2/m3 (histórico de vendas usado na demanda ponderada do PCP).
// notas_fiscais_jacson.json é estrutura PLANA (1 item por linha, confirmado
// nos dados reais) com tipo_movimento 'VENDA' ou 'DEVOLUCAO'.
test('_sincronizarHistoricoVendasBiLoja: soma quantidade_faturada por produto/mês, só tipo_movimento VENDA, e detecta os 3 meses mais recentes sozinho', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/producao_projecao/p1', { cod: '304' });
  const registros = [
    { loja_key: 14, produto_key: 304, tipo_movimento: 'VENDA', data_emissao: '2026-08-10T00:00:00', quantidade_faturada: 10 },
    { loja_key: 14, produto_key: 304, tipo_movimento: 'VENDA', data_emissao: '2026-08-20T00:00:00', quantidade_faturada: 5 },
    { loja_key: 14, produto_key: 304, tipo_movimento: 'DEVOLUCAO', data_emissao: '2026-08-15T00:00:00', quantidade_faturada: 999 },
    { loja_key: 14, produto_key: 304, tipo_movimento: 'VENDA', data_emissao: '2026-07-01T00:00:00', quantidade_faturada: 7 },
    { loja_key: 14, produto_key: 304, tipo_movimento: 'VENDA', data_emissao: '2026-06-01T00:00:00', quantidade_faturada: 3 },
    { loja_key: 99, produto_key: 304, tipo_movimento: 'VENDA', data_emissao: '2026-08-10T00:00:00', quantidade_faturada: 1000 },
  ];
  const resultado = await internals._sincronizarHistoricoVendasBiLoja('loja1', 14, registros);
  assert.deepEqual(resultado.meses, ['2026-08', '2026-07', '2026-06']);
  assert.equal(resultado.gravados, 1);

  const doc304 = fakeDb._dump().get('lojas/loja1/producao_projecao/p1');
  assert.equal(doc304.venda_m1, 15, 'agosto: 10+5, devolução e outra loja não entram');
  assert.equal(doc304.venda_m2, 7);
  assert.equal(doc304.venda_m3, 3);
  assert.equal(doc304.origem, 'bi');
});

// BUG AO VIVO REAL (mesma causa raiz de _sincronizarEstoqueProdutoAcabadoBiLoja
// acima): criar um producao_projecao NOVO pra qualquer produto_key vendido
// — mesmo matéria-prima interna como fécula — vira linha fantasma nos KPIs
// do PCP (78-pcp-central.js lê tudo de producao_projecao sem filtrar
// cadastro). Corrigido pra só atualizar doc já existente, nunca criar.
test('_sincronizarHistoricoVendasBiLoja: REGRESSÃO — nunca cria producao_projecao novo, só atualiza o que já existe', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [{ loja_key: 14, produto_key: 75915, tipo_movimento: 'VENDA', data_emissao: '2026-08-10T00:00:00', quantidade_faturada: 806000 }];
  const resultado = await internals._sincronizarHistoricoVendasBiLoja('loja1', 14, registros);
  assert.equal(resultado.gravados, 0, 'produto sem producao_projecao cadastrado não pode virar doc novo');
  let fecula = null;
  fakeDb._dump().forEach(v => { if (v.cod === '75915') fecula = v; });
  assert.equal(fecula, null);
});

test('_sincronizarHistoricoVendasBiLoja: merge preserva campos manuais (maquina, projeção manual) do producao_projecao', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/producao_projecao/p1', { cod: '304', maquina: 'Envasadora 1', projecaoManual: 500 });
  const registros = [{ loja_key: 14, produto_key: 304, tipo_movimento: 'VENDA', data_emissao: '2026-08-10T00:00:00', quantidade_faturada: 10 }];
  await internals._sincronizarHistoricoVendasBiLoja('loja1', 14, registros);
  const depois = fakeDb._dump().get('lojas/loja1/producao_projecao/p1');
  assert.equal(depois.venda_m1, 10);
  assert.equal(depois.maquina, 'Envasadora 1', 'merge:true não pode apagar campo manual que o sync nem manda');
  assert.equal(depois.projecaoManual, 500);
});

test('_sincronizarHistoricoVendasBiLoja: sem registros, não grava nada e não quebra', async () => {
  const { internals } = carregarComFirestoreFake();
  const resultado = await internals._sincronizarHistoricoVendasBiLoja('loja1', 14, []);
  assert.equal(resultado.total, 0);
  assert.equal(resultado.gravados, 0);
  assert.deepEqual(resultado.meses, []);
});

// BUG AO VIVO REAL (2026-08-27) — limpeza retroativa: a versão anterior (sem
// guarda) de _sincronizarEstoqueProdutoAcabadoBiLoja já tinha gravado
// entradas contaminadas (matéria-prima de outra planta, tipo "FECULA KG")
// antes da correção existir. _limparEstoqueBiContaminadoLoja remove só isso
// — nunca origem:'bluesoft' (essa é uma limpeza separada, ainda pendente,
// do dado antigo de verdade da Bluesoft).
test('_limparEstoqueBiContaminadoLoja: remove doc origem:bi cujo cod não está cadastrado, preserva o resto', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/producao_produtos/p1', { cod: '304', nome: 'Tapioca' });
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_304', { cod: '304', estoqueAtual: 1482, origem: 'bi' });
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_75915', { cod: '75915', estoqueAtual: 806000, origem: 'bi' });
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_999', { cod: '999', estoqueAtual: 50, origem: 'bluesoft' });

  const resultado = await internals._limparEstoqueBiContaminadoLoja('loja1');
  assert.equal(resultado.verificados, 3);
  assert.equal(resultado.removidos, 1);

  assert.ok(fakeDb._dump().has('lojas/loja1/pcp_estoque_bluesoft/produto_304'), 'produto cadastrado, origem bi, permanece');
  assert.ok(!fakeDb._dump().has('lojas/loja1/pcp_estoque_bluesoft/produto_75915'), 'matéria-prima contaminada, origem bi, sem cadastro — removida');
  assert.ok(fakeDb._dump().has('lojas/loja1/pcp_estoque_bluesoft/produto_999'), 'origem bluesoft nunca é tocada por esta limpeza, mesmo sem cadastro');
});

test('_limparEstoqueBiContaminadoLoja: nada contaminado, não remove nada', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/producao_produtos/p1', { cod: '304' });
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_304', { cod: '304', origem: 'bi' });
  const resultado = await internals._limparEstoqueBiContaminadoLoja('loja1');
  assert.equal(resultado.removidos, 0);
});

// PEDIDO AO VIVO (2026-08-27): mesma correção de guarda ampla que
// _sincronizarEstoqueProdutoAcabadoBiLoja — cod cadastrado só em
// pcp_produtos_bluesoft (produto de fornecedor) nunca pode ser tratado
// como contaminação e apagado.
test('_limparEstoqueBiContaminadoLoja: preserva cod cadastrado em pcp_produtos_bluesoft (produto de fornecedor), mesmo sem estar em producao_produtos', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/pcp_produtos_bluesoft/p1', { cod: '304' });
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_304', { cod: '304', origem: 'bi' });
  const resultado = await internals._limparEstoqueBiContaminadoLoja('loja1');
  assert.equal(resultado.removidos, 0, 'produto de fornecedor cadastrado só em pcp_produtos_bluesoft não pode ser removido');
  assert.ok(fakeDb._dump().has('lojas/loja1/pcp_estoque_bluesoft/produto_304'));
});

// PEDIDO AO VIVO (2026-08-27): "vou apagar todo o banco... só estoque,
// pedido antigo da Bluesoft, não é pra apagar configurações nem nada do
// tipo" — pcp_pedidos/pcp_agendamentos são coleções MISTAS (manual da
// equipe + Bluesoft, sem diferença de coleção); salvarPedido()/
// salvarAgendamento() (78-pcp-central.js) nunca gravam `origem`, então
// filtrar por origem==='bluesoft' nunca toca no que foi criado à mão.
// pcp_produtos_bluesoft (cadastro fino) fica de fora de propósito.
test('_limparDadosAntigosBluesoftLoja: remove só origem:bluesoft de estoque/pedidos/agendamentos, preserva manual e origem:bi', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_1', { cod: '1', origem: 'bluesoft' });
  fakeDb._dump().set('lojas/loja1/pcp_estoque_bluesoft/produto_2', { cod: '2', origem: 'bi' });
  fakeDb._dump().set('lojas/loja1/pcp_pedidos/p1', { produto: 'X', origem: 'bluesoft' });
  fakeDb._dump().set('lojas/loja1/pcp_pedidos/p2', { produto: 'Manual, sem origem' });
  fakeDb._dump().set('lojas/loja1/pcp_agendamentos/a1', { fornecedor: 'Y', origem: 'bluesoft' });
  fakeDb._dump().set('lojas/loja1/pcp_agendamentos/a2', { fornecedor: 'Manual, sem origem' });

  const resultado = await internals._limparDadosAntigosBluesoftLoja('loja1');
  assert.equal(resultado.estoque.removidos, 1);
  assert.equal(resultado.pedidos.removidos, 1);
  assert.equal(resultado.agendamentos.removidos, 1);

  assert.ok(!fakeDb._dump().has('lojas/loja1/pcp_estoque_bluesoft/produto_1'), 'origem bluesoft removida');
  assert.ok(fakeDb._dump().has('lojas/loja1/pcp_estoque_bluesoft/produto_2'), 'origem bi (SharePoint) preservada');
  assert.ok(!fakeDb._dump().has('lojas/loja1/pcp_pedidos/p1'), 'pedido origem bluesoft removido');
  assert.ok(fakeDb._dump().has('lojas/loja1/pcp_pedidos/p2'), 'pedido manual (sem origem) preservado');
  assert.ok(!fakeDb._dump().has('lojas/loja1/pcp_agendamentos/a1'), 'agendamento origem bluesoft removido');
  assert.ok(fakeDb._dump().has('lojas/loja1/pcp_agendamentos/a2'), 'agendamento manual (sem origem) preservado');
});

test('_limparDadosAntigosBluesoftLoja: nada com origem bluesoft, não remove nada', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/pcp_pedidos/p1', { produto: 'Manual' });
  const resultado = await internals._limparDadosAntigosBluesoftLoja('loja1');
  assert.equal(resultado.pedidos.removidos, 0);
  assert.equal(resultado.estoque.removidos, 0);
  assert.equal(resultado.agendamentos.removidos, 0);
});

// PEDIDO AO VIVO (2026-08-29): "se eu quiser que ela atualize sozinha, vai
// atualizar" — o ledger de Notas Retornadas (recebimento_recusas_notas)
// só era alimentado por clique manual em "Buscar" ou por um setInterval
// que só roda com a tela aberta no navegador. Passa a rodar aqui, no
// mesmo sync agendado de 30min do servidor — mesma lógica de
// agrupamento/chunk/skip/remoção que já existia do lado cliente em
// 97-recebimento-recusas.js (_agruparNotasBiPorChave/_gravarNotasVenda).
test('_sincronizarNotasRetornadasVendaBiLoja: agrupa itens por chave, grava em recebimento_recusas_notas e no chunk, filtrando por loja e só tipo_movimento VENDA', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [
    { loja_key: 14, chave: 'NF1', nf_numero: '100', cliente: 'Mercado X', data_emissao: '2026-08-10', cfop: '5102', valor_nota: 50, vendedor: 'João', tipo_movimento: 'VENDA', produto_key: 304, produto: 'Tapioca', quantidade_faturada: 5 },
    { loja_key: 14, chave: 'NF1', nf_numero: '100', cliente: 'Mercado X', data_emissao: '2026-08-10', cfop: '5102', valor_nota: 30, vendedor: 'João', tipo_movimento: 'VENDA', produto_key: 305, produto: 'Fécula', quantidade_faturada: 2 },
    { loja_key: 14, chave: 'NF2', nf_numero: '101', cliente: 'Mercado Y', data_emissao: '2026-08-11', cfop: '5102', valor_nota: 20, vendedor: 'Ana', tipo_movimento: 'DEVOLUCAO', produto_key: 304, produto: 'Tapioca', quantidade_faturada: 1 },
    { loja_key: 99, chave: 'NF3', nf_numero: '102', cliente: 'Outra loja', data_emissao: '2026-08-11', cfop: '5102', valor_nota: 20, vendedor: 'Zé', tipo_movimento: 'VENDA', produto_key: 1, produto: 'X', quantidade_faturada: 1 },
  ];
  const resultado = await internals._sincronizarNotasRetornadasVendaBiLoja('loja1', 14, registros);
  assert.equal(resultado.total, 1, 'só NF1 é venda desta loja — NF2 é devolução, NF3 é de outra loja');
  assert.equal(resultado.novas, 1);

  const nf1 = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas/NF1');
  assert.ok(nf1, 'nota deve ser gravada com o mesmo id/chave que o lado cliente usa');
  assert.equal(nf1.numeroNota, '100');
  assert.equal(nf1.valorTotal, 80, '50 + 30 dos dois itens da mesma nota');
  assert.equal(nf1.itens.length, 2);
  assert.equal(nf1.naturezaLabel, 'Venda');
  assert.equal(nf1.origemImportacao, 'BI');

  const chunk0 = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0');
  assert.ok(chunk0, 'deve gravar também a cópia resumida no chunk, mesmo formato que o cliente usa pra montar a tela sem 1 leitura por nota');
  assert.equal(chunk0.notas.NF1.numeroNota, '100');
});

// BUG AO VIVO REAL (2026-09-03, duas vezes seguidas): "Falha na última
// busca: Document .../recebimento_recusas_notas_chunks/chunk_N cannot be
// written because its size (~1.08MB) exceeds o máximo de 1.048.576 bytes"
// — a sincronização AGENDADA no servidor (roda sozinha a cada 30min, sem
// nenhum navegador aberto) era a causa de verdade: TAMANHO_CHUNK_NOTAS_
// RETORNADAS=1000 nunca olhava o tamanho real em bytes, e o lado cliente
// tinha sido corrigido primeiro sem perceber que este duplicado servidor
// também precisava do mesmo conserto. Caiu pra 400 aqui também.
test('_sincronizarNotasRetornadasVendaBiLoja: chunk já com 400 notas (TAMANHO_CHUNK_NOTAS_RETORNADAS atingido) — a próxima nova abre chunk_1, nunca tenta estourar o chunk_0', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const notasCheias = {};
  // Cada uma das 400 já existentes precisa continuar "em aberto" no lote
  // (registros), senão a regra de remoção ("sumiu da busca = não tá mais
  // em aberto = apaga") derruba todas — não é isso que este teste quer
  // provar, só o comportamento de rollover do chunk cheio.
  const registros = [];
  for (let i = 0; i < 400; i++) {
    const chave = 'X'.repeat(30) + String(i).padStart(4, '0');
    notasCheias[chave] = { chave, numeroNota: String(i), origemImportacao: 'BI', naturezaLabel: 'Venda' };
    registros.push({ loja_key: 14, chave, nf_numero: String(i), cliente: 'X', data_emissao: '2026-08-12', valor_nota: 1, tipo_movimento: 'VENDA', produto_key: 1, produto: 'Y', quantidade_faturada: 1 });
  }
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0', { notas: notasCheias });
  registros.push({ loja_key: 14, chave: 'NOVA-CHAVE', nf_numero: '9999', cliente: 'X', data_emissao: '2026-08-12', valor_nota: 10, tipo_movimento: 'VENDA', produto_key: 1, produto: 'Y', quantidade_faturada: 1 });
  const resultado = await internals._sincronizarNotasRetornadasVendaBiLoja('loja1', 14, registros);
  assert.equal(resultado.novas, 1);
  const chunk0 = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0');
  assert.equal(Object.keys(chunk0.notas).length, 400, 'chunk_0 já estava cheio (400) — continua intocado, sem a nota nova');
  const chunk1 = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas_chunks/chunk_1');
  assert.ok(chunk1 && chunk1.notas['NOVA-CHAVE'], 'chunk_1 precisa ter sido criado com a nota nova dentro');
  const doc = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas/NOVA-CHAVE');
  assert.equal(doc.chunkIndex, 1);
});

// BUG AO VIVO REAL (2026-09-03, terceira vez — 21:04, MESMO tamanho de
// bytes da falha anterior): reduzir o limite não resolveu sozinho porque o
// pacote que falha já estava com muito mais notas que o normal, guardado
// de ANTES do limite existir — reduzir o limite só evita que um pacote
// NOVO fique grande, nunca divide um que JÁ está grande. O reparo manual
// (botão em 97-recebimento-recusas.js) resolve, mas depende de alguém
// clicar — e esta sincronização roda SOZINHA a cada 30min, sem ninguém
// olhando. _dividirChunksNotasRetornadasGrandesDemaisSeNecessario() agora
// roda automaticamente dentro da própria sincronização, ANTES de tentar
// gravar qualquer nota nova — sem depender de ação manual nenhuma.
test('_sincronizarNotasRetornadasVendaBiLoja: pacote JÁ estava grande demais (herdado de antes do limite existir) — a sincronização se autorepara sozinha, sem precisar de nenhum clique manual', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const notasHerdadas = {};
  const registros = [];
  const totalHerdado = 900; // bem mais que TAMANHO_CHUNK_NOTAS_RETORNADAS (400) — simula um pacote antigo, de antes do limite existir
  for (let i = 0; i < totalHerdado; i++) {
    const chave = 'H' + String(i).padStart(6, '0');
    notasHerdadas[chave] = { chave, numeroNota: String(i), origemImportacao: 'BI', naturezaLabel: 'Venda' };
    registros.push({ loja_key: 14, chave, nf_numero: String(i), cliente: 'X', data_emissao: '2026-08-12', valor_nota: 1, tipo_movimento: 'VENDA', produto_key: 1, produto: 'Y', quantidade_faturada: 1 });
  }
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas_chunks/chunk_1', { notas: notasHerdadas });
  const resultado = await internals._sincronizarNotasRetornadasVendaBiLoja('loja1', 14, registros);
  assert.equal(resultado.novas, 0, 'todas as 900 já existiam (herdadas) — nenhuma nota nova pra gravar');

  const chunk1Depois = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas_chunks/chunk_1');
  assert.equal(Object.keys(chunk1Depois.notas).length, 400, 'chunk_1 (o que estava quebrado) precisa ter sido dividido sozinho, sem clique nenhum');
  const totalNotasChunks = ['chunk_1', 'chunk_2', 'chunk_3'].reduce((s, id) => {
    const c = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas_chunks/' + id);
    return s + (c ? Object.keys(c.notas).length : 0);
  }, 0);
  assert.equal(totalNotasChunks, totalHerdado, 'nenhuma nota pode ter sido perdida na divisão — 900 continuam existindo, só espalhadas em mais pacotes');
});

test('_sincronizarNotasRetornadasVendaBiLoja: nota já existente no chunk é pulada (venda é histórico, nunca reescreve)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0', { notas: { NF1: { chave: 'NF1', numeroNota: '100', origemImportacao: 'BI', naturezaLabel: 'Venda' } } });
  const registros = [{ loja_key: 14, chave: 'NF1', nf_numero: '100', cliente: 'X', data_emissao: '2026-08-10', valor_nota: 50, tipo_movimento: 'VENDA', produto_key: 304, produto: 'Tapioca', quantidade_faturada: 5 }];
  const resultado = await internals._sincronizarNotasRetornadasVendaBiLoja('loja1', 14, registros);
  assert.equal(resultado.novas, 0, 'nota que já existe no chunk não deve ser regravada');
});

test('_sincronizarNotasRetornadasVendaBiLoja: nota que saiu da busca (não está mais em aberto) é removida do doc e do chunk', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas/NF-ANTIGA', { chave: 'NF-ANTIGA', origemImportacao: 'BI', naturezaLabel: 'Venda', chunkIndex: 0 });
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0', { notas: { 'NF-ANTIGA': { chave: 'NF-ANTIGA', origemImportacao: 'BI', naturezaLabel: 'Venda' } } });
  const registros = [{ loja_key: 14, chave: 'NF-NOVA', nf_numero: '200', cliente: 'X', data_emissao: '2026-08-12', valor_nota: 10, tipo_movimento: 'VENDA', produto_key: 1, produto: 'Y', quantidade_faturada: 1 }];
  const resultado = await internals._sincronizarNotasRetornadasVendaBiLoja('loja1', 14, registros);
  assert.equal(resultado.removidas, 1);
  assert.ok(!fakeDb._dump().has('lojas/loja1/recebimento_recusas_notas/NF-ANTIGA'), 'nota que não está mais em aberto deve ser removida');
  const chunk0 = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0');
  assert.equal(chunk0.notas['NF-ANTIGA'], undefined, 'também some do resumo do chunk');
});

test('_sincronizarNotasRetornadasVendaBiLoja: nota que já virou um recebimento real (recebimento_recusas.chaves) NUNCA é removida, mesmo saindo da busca', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas/NF-RECEBIDA', { chave: 'NF-RECEBIDA', origemImportacao: 'BI', naturezaLabel: 'Venda', chunkIndex: 0 });
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0', { notas: { 'NF-RECEBIDA': { chave: 'NF-RECEBIDA', origemImportacao: 'BI', naturezaLabel: 'Venda' } } });
  fakeDb._dump().set('lojas/loja1/recebimento_recusas/r1', { chaves: ['NF-RECEBIDA'] });
  const resultado = await internals._sincronizarNotasRetornadasVendaBiLoja('loja1', 14, []);
  assert.equal(resultado.removidas, 0, 'nota já processada pelo Coletor (tem recebimento_recusas apontando pra ela) nunca pode ser apagada');
  assert.ok(fakeDb._dump().has('lojas/loja1/recebimento_recusas_notas/NF-RECEBIDA'));
});

test('_sincronizarNotasRetornadasVendaBiLoja: busca vazia NUNCA reconcilia/remove nada (proteção contra falha/leitura parcial)', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas/NF-QUALQUER', { chave: 'NF-QUALQUER', origemImportacao: 'BI', naturezaLabel: 'Venda', chunkIndex: 0 });
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0', { notas: { 'NF-QUALQUER': { chave: 'NF-QUALQUER', origemImportacao: 'BI', naturezaLabel: 'Venda' } } });
  const resultado = await internals._sincronizarNotasRetornadasVendaBiLoja('loja1', 14, []);
  assert.equal(resultado.removidas, 0);
  assert.ok(fakeDb._dump().has('lojas/loja1/recebimento_recusas_notas/NF-QUALQUER'));
});

// PEDIDO AO VIVO (2026-09-03, pergunta certeira do usuário depois de vários
// consertos que não seguravam): "se não foi recebida, ela tem que apagar...
// senão só vai juntando nota lixo." Achado o bug real: gravar as notas
// NOVAS e REMOVER as que saíram de "em aberto" são 2 passos independentes,
// mas viviam um atrás do outro sem try/catch — um erro no 1º (gravar,
// ex.: chunk estourou 1MB) subia direto e o 2º (remover) NUNCA rodava.
// Ou seja: toda vez que a gravação falhava, a "faxina" também parava, as
// notas lixo se acumulavam pra sempre, e o próximo chunk também ficava
// mais perto do limite de novo — o motivo real de os consertos anteriores
// (só no tamanho do chunk) não resolverem de vez.
// PEDIDO AO VIVO (2026-09-11): "vou sair de férias... se ninguém entrar no
// site vai atualizar?" — Devoluções (BI) (100-consulta-notas-fiscais.js) só
// atualizava com alguém com aquela aba aberta (setInterval de 30min,
// cliente). _sincronizarDevolucoesBiLoja duplica a mesma lógica de
// classificação/gravação já validada em produção do lado do cliente
// (_importarDevolucoesBiRegistros/classificarMotivoTexto/
// _construirRecebimentoAutomatico), agora rodando dentro do sync agendado
// do servidor — mesmo padrão que Notas Retornadas (venda) já ganhou acima.
test('_sincronizarDevolucoesBiLoja: motivo que DISPENSA o Coletor (ex.: "Desacordo com pedido") grava recebimento_recusas automático já conferido, filtrando por loja e só tipo_movimento DEVOLUCAO', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [
    { loja_key: 14, chave: 'NFD1', nf_numero: '900', cliente: 'Mercado Z', data_emissao: '2026-08-20', valor_nota: 40, tipo_movimento: 'DEVOLUCAO', produto_key: 1, produto: 'Tapioca', quantidade_faturada: 2, mensagem: 'DESACORDO COM PEDIDO' },
    { loja_key: 99, chave: 'NFD2', nf_numero: '901', cliente: 'Outra loja', data_emissao: '2026-08-20', valor_nota: 10, tipo_movimento: 'DEVOLUCAO', produto_key: 1, produto: 'X', quantidade_faturada: 1, mensagem: 'DESACORDO COM PEDIDO' },
    { loja_key: 14, chave: 'NFD3', nf_numero: '902', cliente: 'Mercado Z', data_emissao: '2026-08-20', valor_nota: 5, tipo_movimento: 'VENDA', produto_key: 1, produto: 'X', quantidade_faturada: 1 },
  ];
  const resultado = await internals._sincronizarDevolucoesBiLoja('loja1', 14, registros);
  assert.equal(resultado.total, 1, 'só NFD1 é devolução desta loja — NFD2 é de outra loja, NFD3 é venda');
  assert.equal(resultado.autoSalvas, 1);

  let doc = null;
  fakeDb._dump().forEach(v => { if (Array.isArray(v.chaves) && v.chaves[0] === 'NFD1') doc = v; });
  assert.ok(doc, 'deve gravar um recebimento_recusas automático');
  assert.equal(doc.origem, 'AUTOMATICO');
  assert.equal(doc.motivoNome, 'Desacordo com pedido');
  assert.equal(doc.conferenciaStatus, 'CONFERIDO');
  assert.equal(doc.valorTotal, 40);
});

test('_sincronizarDevolucoesBiLoja: motivo que PRECISA do Coletor (Troca/Avaria/Vencido/Impróprio/sem motivo) é descartado — nunca grava nem aguarda', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  const registros = [
    { loja_key: 14, chave: 'NFD-TROCA', nf_numero: '1', cliente: 'X', data_emissao: '2026-08-20', valor_nota: 1, tipo_movimento: 'DEVOLUCAO', produto_key: 1, produto: 'Y', quantidade_faturada: 1, mensagem: 'TROCA DE PRODUTO' },
    { loja_key: 14, chave: 'NFD-SEM-MOTIVO', nf_numero: '2', cliente: 'X', data_emissao: '2026-08-20', valor_nota: 1, tipo_movimento: 'DEVOLUCAO', produto_key: 1, produto: 'Y', quantidade_faturada: 1, mensagem: 'ALGO SEM CATEGORIA' },
  ];
  const resultado = await internals._sincronizarDevolucoesBiLoja('loja1', 14, registros);
  assert.equal(resultado.total, 2);
  assert.equal(resultado.autoSalvas, 0);
  assert.equal(resultado.descartadas, 2);
  assert.equal([...fakeDb._dump().values()].filter(v => Array.isArray(v.chaves)).length, 0, 'nenhum recebimento_recusas deve ter sido criado');
});

test('_sincronizarDevolucoesBiLoja: chave que já virou recebimento_recusas antes NÃO duplica — só completa dataEmissao/destinatario que estava em branco', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_recusas/rExistente', { chaves: ['NFD1'], dataEmissao: '', destinatario: '' });
  const registros = [{ loja_key: 14, chave: 'NFD1', nf_numero: '900', cliente: 'Mercado Z - 278', data_emissao: '2026-08-20', valor_nota: 40, tipo_movimento: 'DEVOLUCAO', produto_key: 1, produto: 'X', quantidade_faturada: 1, mensagem: 'DESACORDO COM PEDIDO' }];
  const resultado = await internals._sincronizarDevolucoesBiLoja('loja1', 14, registros);
  assert.equal(resultado.autoSalvas, 0, 'já existe recebimento pra essa chave — não cria outro');
  assert.equal(resultado.corrigidas, 1);
  const depois = fakeDb._dump().get('lojas/loja1/recebimento_recusas/rExistente');
  assert.equal(depois.dataEmissao, '2026-08-20');
  assert.equal(depois.destinatario, 'Mercado Z - 278');
  assert.equal(depois.rede, 'Mercado Z');
});

test('_sincronizarDevolucoesBiLoja: sem registros, não grava nada e não quebra', async () => {
  const { internals } = carregarComFirestoreFake();
  const resultado = await internals._sincronizarDevolucoesBiLoja('loja1', 14, []);
  assert.equal(resultado.total, 0);
  assert.equal(resultado.autoSalvas, 0);
});

test('_sincronizarNotasRetornadasVendaBiLoja: erro ao GRAVAR notas novas NÃO pode impedir a LIMPEZA de rodar — nota que saiu de "em aberto" precisa ser removida mesmo com falha', async () => {
  const { fakeDb, internals } = carregarComFirestoreFake();
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0', { notas: { LIXO: { chave: 'LIXO', numeroNota: '1', origemImportacao: 'BI', naturezaLabel: 'Venda' } } });
  fakeDb._dump().set('lojas/loja1/recebimento_recusas_notas/LIXO', { chave: 'LIXO', numeroNota: '1', origemImportacao: 'BI', naturezaLabel: 'Venda', chunkIndex: 0 });

  // Simula a 1ª escrita de verdade (gravar a nota nova no chunk) falhando
  // como se o Firestore tivesse recusado por estourar 1MB — sem esse
  // conserto, isso derrubaria a limpeza da nota "LIXO" junto.
  let chamadas = 0;
  const batchOriginal = fakeDb.batch.bind(fakeDb);
  fakeDb.batch = () => {
    chamadas++;
    const real = batchOriginal();
    if (chamadas === 1) return { set: real.set, delete: real.delete, commit: async () => { throw new Error('Simulado: chunk estourou 1MB'); } };
    return real;
  };

  // "LIXO" não vem mais na busca de hoje (não está mais em aberto) — precisa ser removida.
  const registros = [{ loja_key: 14, chave: 'NOVA', nf_numero: '2', cliente: 'X', data_emissao: '2026-08-12', valor_nota: 1, tipo_movimento: 'VENDA', produto_key: 1, produto: 'Y', quantidade_faturada: 1 }];
  await assert.rejects(() => internals._sincronizarNotasRetornadasVendaBiLoja('loja1', 14, registros), /Simulado/, 'a falha ainda precisa ser relatada — só não pode BLOQUEAR a limpeza');

  assert.ok(!fakeDb._dump().has('lojas/loja1/recebimento_recusas_notas/LIXO'), 'mesmo com erro ao gravar a nota nova, a nota que saiu de "em aberto" precisa ter sido removida');
  const chunk0Depois = fakeDb._dump().get('lojas/loja1/recebimento_recusas_notas_chunks/chunk_0');
  assert.equal(chunk0Depois.notas.LIXO, undefined, 'também precisa ter sumido do resumo do pacote');
});
