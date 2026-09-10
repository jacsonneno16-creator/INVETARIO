// Analista > Recebimento > Cargas (Montagem/Expedição).
// Lê `recebimento_transbordo_cargas` (por loja) escrita pelo Coletor
// (26-recebimento-cargas.js) — consolida TODAS as lojas, mesmo padrão de
// recebimento-paletes-monitoramento.js (raw().collection('lojas').get() +
// loop). Clicar num card busca a subcoleção `itens` SOB DEMANDA (não
// antecipado pra toda carga).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../js/analista/104-recebimento-cargas-cards.js'), 'utf8');

function mockColecaoSimples(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: id => ({
      get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; },
      update: async payload => {
        const atual = registro.get(id);
        if (atual === undefined) throw new Error('NOT_FOUND: ' + id);
        registro.set(id, Object.assign({}, atual, payload));
      },
      delete: async () => { registro.delete(id); },
    }),
    _registro: registro,
  };
}

// lojas: [{id,nome}]; cargasPorLoja: {lojaId:[{id,data}]}; itensPorCarga: {`${lojaId}/${cargaId}`:[{id,data}]}
// Registro mutável por loja (Map id->data) — permite testar .update() nas
// cargas (ex.: adicionar/remover Nota Fiscal), não só leitura.
function mockRawFirestore(lojas, cargasPorLoja, itensPorCargaChave) {
  const colLojas = mockColecaoSimples(lojas.map(l => ({ id: l.id, data: l })));
  const registrosPorLoja = {};
  Object.keys(cargasPorLoja || {}).forEach(lojaId => {
    registrosPorLoja[lojaId] = new Map((cargasPorLoja[lojaId] || []).map(d => [d.id, d.data]));
  });
  function registroDaLoja(lojaId) {
    if (!registrosPorLoja[lojaId]) registrosPorLoja[lojaId] = new Map();
    return registrosPorLoja[lojaId];
  }
  // Cache por chave (lojaId/cargaId) — sem isso, cada `.collection('itens')`
  // criaria um mock NOVO (perdendo `.delete()`s anteriores), impossibilitando
  // testar que a exclusão de uma carga realmente apaga os itens da subcoleção.
  const itensColPorChave = {};
  return {
    collection: nome => {
      if (nome !== 'lojas') return mockColecaoSimples([]);
      return {
        get: colLojas.get,
        doc: lojaId => ({
          collection: sub => {
            if (sub !== 'recebimento_transbordo_cargas') return mockColecaoSimples([]);
            const registro = registroDaLoja(lojaId);
            return {
              get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
              where(campo, op, valor) {
                const construir = (condicoesAtuais) => ({
                  where: (c2, o2, v2) => construir([...condicoesAtuais, { campo: c2, op: o2, valor: v2 }]),
                  get: async () => {
                    const bate = (data) => condicoesAtuais.every(c => {
                      const v = data ? data[c.campo] : undefined;
                      if (c.op === '>=') return v >= c.valor;
                      if (c.op === '<=') return v <= c.valor;
                      if (c.op === '==') return v === c.valor;
                      if (c.op === 'in') return Array.isArray(c.valor) && c.valor.includes(v);
                      return true;
                    });
                    return { docs: [...registro.entries()].filter(([, data]) => bate(data)).map(([id, data]) => ({ id, data: () => data })) };
                  },
                });
                return construir([{ campo, op, valor }]);
              },
              doc: cargaId => ({
                get: async () => { const data = registro.get(cargaId); return { exists: data !== undefined, id: cargaId, data: () => data }; },
                update: async payload => {
                  const atual = registro.get(cargaId);
                  if (atual === undefined) throw new Error('NOT_FOUND: ' + cargaId);
                  registro.set(cargaId, Object.assign({}, atual, payload));
                },
                delete: async () => { registro.delete(cargaId); },
                collection: sub2 => {
                  const chave = lojaId + '/' + cargaId;
                  if (sub2 === 'itens') {
                    if (!itensColPorChave[chave]) itensColPorChave[chave] = mockColecaoSimples((itensPorCargaChave || {})[chave] || []);
                    return itensColPorChave[chave];
                  }
                  return mockColecaoSimples([]);
                },
              }),
            };
          },
        }),
      };
    },
    // `.batch()` reaproveita os próprios `.update()`/`.delete()` já
    // definidos em cada doc-ref acima (não precisa de convenção genérica
    // tipo `ref._registro`/`ref.id` — os refs deste mock já sabem se
    // gravar sozinhos). `commit()` não precisa ser atômico de verdade pra
    // testar (mesmo espírito de outros mocks de batch já usados na suíte).
    batch: () => {
      const ops = [];
      return {
        update: (ref, payload) => ops.push(() => ref.update(payload)),
        set: (ref, payload, opts) => ops.push(() => (ref.set ? ref.set(payload, opts) : ref.update(payload))),
        delete: ref => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    _registrosPorLoja: registrosPorLoja,
    _itensColPorChave: itensColPorChave,
  };
}

function carregarPagina(lojas, cargasPorLoja, itensPorCargaChave, opts) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-cargas"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const raw = mockRawFirestore(lojas || [], cargasPorLoja || {}, itensPorCargaChave || {});
  win.getDTRawFirestore = () => raw;
  const toasts = [];
  win.showToast = (msg, tipo) => toasts.push({ msg, tipo });
  win.confirm = () => (opts ? opts.confirmar !== false : true);
  const chamadasLedger = [];
  win._aplicarMovimentoLedger = async (lojaId, tipo, deltas, referencia) => { chamadasLedger.push({ lojaId, tipo, deltas, referencia }); };
  // Spy captura o HTML do elemento NA HORA da chamada (antes do `finally`
  // remover o container do DOM) — mesma convenção de mock usada pro resto
  // da suíte pra funções globais que a página chama e assume existir.
  const chamadasPdf = [];
  win.exportarElementoProducaoPDF = async (elementId, nomeArquivo) => {
    const el = win.document.getElementById(elementId);
    chamadasPdf.push({ elementId, nomeArquivo, html: el ? el.innerHTML : null });
  };
  win.eval(code);
  return { win, document: win.document, raw, toasts, chamadasLedger, chamadasPdf };
}

const LOJAS = [{ id: 'loja1', nome: 'Loja Matriz' }, { id: 'loja2', nome: 'Loja Filial' }];

test('carregarCargasAnalista: consolida cargas de TODAS as lojas ativas numa lista só', async () => {
  const { win } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga Matriz→Filial', status: 'EM_TRANSITO', origemNome: 'Loja Matriz', destinoNome: 'Loja Filial' } }],
    loja2: [{ id: 'c2', data: { nomeCarga: 'Carga Filial→Matriz', status: 'PENDENTE', origemNome: 'Loja Filial', destinoNome: 'Loja Matriz' } }],
  });
  await win._recebimentoCargasCardsInternals.carregarCargasAnalista();
  const cargas = win._recebimentoCargasCardsInternals.getCargas();
  assert.equal(cargas.length, 2);
  assert.ok(cargas.some(c => c._id === 'c1' && c.lojaId === 'loja1'));
  assert.ok(cargas.some(c => c._id === 'c2' && c.lojaId === 'loja2'));
});

// PEDIDO AO VIVO (2026-09-10): "tela de carga montagem demorando" — a busca
// padrão passou a trazer só cargas ATIVAS (PENDENTE/EM_TRANSITO); RECEBIDA/
// CANCELADA (histórico que só cresce) só entram quando pedido de verdade.
test('carregarCargasAnalista: por padrão (sem incluirFinalizadas) só traz cargas ATIVAS — RECEBIDA/CANCELADA ficam de fora', async () => {
  const { win } = carregarPagina(LOJAS, {
    loja1: [
      { id: 'c1', data: { nomeCarga: 'Ativa', status: 'EM_TRANSITO' } },
      { id: 'c2', data: { nomeCarga: 'Já recebida', status: 'RECEBIDA' } },
      { id: 'c3', data: { nomeCarga: 'Cancelada', status: 'CANCELADA' } },
    ],
  });
  await win._recebimentoCargasCardsInternals.carregarCargasAnalista();
  const cargas = win._recebimentoCargasCardsInternals.getCargas();
  assert.equal(cargas.length, 1);
  assert.equal(cargas[0]._id, 'c1');
  assert.equal(win._recebimentoCargasCardsInternals.getCargasComFinalizadas(), false);
});
test('carregarCargasAnalista(forcar, incluirFinalizadas=true): traz TODAS, inclusive RECEBIDA/CANCELADA', async () => {
  const { win } = carregarPagina(LOJAS, {
    loja1: [
      { id: 'c1', data: { nomeCarga: 'Ativa', status: 'EM_TRANSITO' } },
      { id: 'c2', data: { nomeCarga: 'Já recebida', status: 'RECEBIDA' } },
    ],
  });
  await win._recebimentoCargasCardsInternals.carregarCargasAnalista(true, true);
  const cargas = win._recebimentoCargasCardsInternals.getCargas();
  assert.equal(cargas.length, 2);
  assert.equal(win._recebimentoCargasCardsInternals.getCargasComFinalizadas(), true);
});
test('PEDIDO AO VIVO: escolher "Recebida" no filtro de status busca o histórico completo sozinho, sem precisar clicar em Atualizar', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [
      { id: 'c1', data: { nomeCarga: 'Ativa', status: 'EM_TRANSITO' } },
      { id: 'c2', data: { nomeCarga: 'Já recebida', status: 'RECEBIDA' } },
    ],
  });
  await win.renderRecebimentoCargas();
  assert.doesNotMatch(document.getElementById('cargas-lista').innerHTML, /Já recebida/, 'busca padrão não trouxe a recebida');

  document.getElementById('cargas-f-status').value = 'RECEBIDA';
  document.getElementById('cargas-f-status').dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('cargas-lista').innerHTML, /Já recebida/, 'ao filtrar por Recebida, busca o histórico sozinho');
});

test('carregarCargasAnalista: loja inativa é excluída, e falha numa loja não derruba as outras', async () => {
  const lojasComInativa = LOJAS.concat([{ id: 'loja3', nome: 'Loja Fechada', ativa: false }]);
  const { win } = carregarPagina(lojasComInativa, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  });
  await win._recebimentoCargasCardsInternals.carregarCargasAnalista();
  assert.equal(win._recebimentoCargasCardsInternals.getCargas().length, 1);
  assert.equal(win._recebimentoCargasCardsInternals.getLojas().length, 2, 'loja3 (ativa:false) não deve entrar na lista de lojas');
});

test('renderRecebimentoCargas: mostra nome/origem→destino/motorista/NF/volumes/paletes/status no card', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{
      id: 'c1', data: {
        nomeCarga: 'Carga Filial 04/09', status: 'EM_TRANSITO',
        origemNome: 'Loja Matriz', destinoNome: 'Loja Filial', motoristaNome: 'Carlos',
        notasFiscais: [{ numero: '55501', volumes: 65 }], totalVolumes: 65, totalPaletesFisico: 3,
      },
    }],
  });
  await win.renderRecebimentoCargas();
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /Carga Filial 04\/09/);
  assert.match(html, /Loja Matriz.*→.*Loja Filial/);
  assert.match(html, /Carlos/);
  assert.match(html, /55501/);
  assert.match(html, /65 volume/);
  assert.match(html, /3 palete/);
  assert.match(html, /Expedida/);
});

// BUG AO VIVO REAL (2026-09-08): "vinculei pelo analista as notas nos
// produtos e não apareceu as notas" — o badge de NF do card só olhava
// `notasFiscais` (a NF manual) — uma carga com produtos vinculados por
// nota (`notasFiscaisProdutos`, sem nenhuma NF manual) mostrava "sem NF"
// mesmo já tendo nota vinculada.
test('renderRecebimentoCargas: badge de NF do card também mostra números vinculados via produto→nota (notasFiscaisProdutos), não só a NF manual', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{
      id: 'c1', data: {
        nomeCarga: 'Carga com vínculo', status: 'PENDENTE', totalPaletesFisico: 5,
        notasFiscais: [], // nenhuma NF manual
        notasFiscaisProdutos: [{ numero: '197825', produtos: [{ codigoProduto: '1001', nomeProduto: 'Tapioca' }] }],
      },
    }],
  });
  await win.renderRecebimentoCargas();
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /197825/);
  assert.doesNotMatch(html, /sem NF/);
});

test('renderRecebimentoCargas: sem NF manual E sem vínculo produto→nota, badge continua mostrando "sem NF"', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga sem nada', status: 'PENDENTE' } }],
  });
  await win.renderRecebimentoCargas();
  assert.match(document.getElementById('page-recebimento-cargas').innerHTML, /sem NF/);
});

// BUG AO VIVO REAL (2026-09-06): "quando finalizo a montagem ela não
// finaliza" — montagem finalizada grava totalPaletesFisico mas o status
// continua PENDENTE de propósito (só a Expedição muda) — o card mostrava
// "Em montagem" igual a antes de finalizar, dando a impressão de que nada
// tinha acontecido.
test('renderRecebimentoCargas: carga PENDENTE com totalPaletesFisico já gravado mostra "Pronta pra expedição", não "Em montagem"', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga Pronta', status: 'PENDENTE', totalPaletesFisico: 4, totalVolumes: 220 } }],
  });
  await win.renderRecebimentoCargas();
  const card = document.querySelector('[data-carga-card="c1"]').innerHTML;
  assert.match(card, /Pronta pra expedição/);
  assert.doesNotMatch(card, /Em montagem/);
});

test('renderRecebimentoCargas: carga PENDENTE ainda sem paletes físicos continua mostrando "Em montagem"', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga Montando', status: 'PENDENTE' } }],
  });
  await win.renderRecebimentoCargas();
  const card = document.querySelector('[data-carga-card="c1"]').innerHTML;
  assert.match(card, /Em montagem/);
});

test('filtro por loja e status: só mostra cargas que passam nos dois filtros', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga A', status: 'PENDENTE' } }],
    loja2: [{ id: 'c2', data: { nomeCarga: 'Carga B', status: 'EM_TRANSITO' } }],
  });
  await win.renderRecebimentoCargas();

  document.getElementById('cargas-f-loja').value = 'loja2';
  document.getElementById('cargas-f-loja').dispatchEvent(new win.Event('change', { bubbles: true }));
  let html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /Carga B/);
  assert.doesNotMatch(html, /Carga A/, 'filtro de loja=loja2 não deve mostrar a carga da loja1');

  document.getElementById('cargas-f-loja').value = '';
  document.getElementById('cargas-f-loja').dispatchEvent(new win.Event('change', { bubbles: true }));
  document.getElementById('cargas-f-status').value = 'PENDENTE';
  document.getElementById('cargas-f-status').dispatchEvent(new win.Event('change', { bubbles: true }));
  html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /Carga A/);
  assert.doesNotMatch(html, /Carga B/, 'filtro de status=PENDENTE não deve mostrar a carga EM_TRANSITO');
});

test('filtro de busca por texto: casa nome da carga OU nome do motorista', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [
      { id: 'c1', data: { nomeCarga: 'Carga Especial', status: 'PENDENTE', motoristaNome: 'Zé' } },
      { id: 'c2', data: { nomeCarga: 'Carga Comum', status: 'PENDENTE', motoristaNome: 'Carlos' } },
    ],
  });
  await win.renderRecebimentoCargas();
  document.getElementById('cargas-f-busca').value = 'carlos';
  document.getElementById('cargas-f-busca').dispatchEvent(new win.Event('input', { bubbles: true }));
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /Carga Comum/);
  assert.doesNotMatch(html, /Carga Especial/);
});

test('resumoPorProduto: soma quantidade por codigoProduto entre múltiplos itens do mesmo produto', () => {
  const { win } = carregarPagina(LOJAS, {});
  const itens = [
    { capa: 'C1', codigoProduto: '1001', nomeProduto: 'Arroz 5kg', quantidade: 40 },
    { capa: 'C2', codigoProduto: '1001', nomeProduto: 'Arroz 5kg', quantidade: 25 },
    { capa: 'C3', codigoProduto: '1002', nomeProduto: 'Feijão 1kg', quantidade: 10 },
  ];
  const resumo = win._recebimentoCargasCardsInternals.resumoPorProduto(itens);
  const arroz = resumo.find(r => r.codigoProduto === '1001');
  const feijao = resumo.find(r => r.codigoProduto === '1002');
  assert.equal(arroz.quantidade, 65);
  assert.equal(feijao.quantidade, 10);
});

// BUG AO VIVO REAL (2026-09-06): "o resumo não pode somar os dois juntos" —
// mesmo código interno (Base de Produtos) pode ter variantes de embalagem
// diferentes (ex.: CX 12 e FD 12 do mesmo produto) — o resumo agrupava só
// por codigoProduto e somava as duas embalagens numa linha só.
test('resumoPorProduto: NÃO soma junto variantes de embalagem diferentes do mesmo código (CX 12 vs FD 12)', () => {
  const { win } = carregarPagina(LOJAS, {});
  const itens = [
    { capa: 'C1', codigoProduto: '00001', nomeProduto: '00001 TAPIOCA DA TERRINHA 1 KG - CX 12', quantidade: 50 },
    { capa: 'C2', codigoProduto: '00001', nomeProduto: '00001 TAPIOCA DA TERRINHA 1 KG - FD 12', quantidade: 60 },
    { capa: 'C3', codigoProduto: '00001', nomeProduto: '00001 TAPIOCA DA TERRINHA 1 KG - CX 12', quantidade: 50 },
    { capa: 'C4', codigoProduto: '00001', nomeProduto: '00001 TAPIOCA DA TERRINHA 1 KG - FD 12', quantidade: 60 },
  ];
  const resumo = win._recebimentoCargasCardsInternals.resumoPorProduto(itens);
  assert.equal(resumo.length, 2, 'CX 12 e FD 12 têm que ficar em linhas separadas');
  const cx = resumo.find(r => r.nomeProduto.includes('CX 12'));
  const fd = resumo.find(r => r.nomeProduto.includes('FD 12'));
  assert.equal(cx.quantidade, 100);
  assert.equal(fd.quantidade, 120);
});

test('alternarDetalheCarga: busca os itens SOB DEMANDA (só quando o card é aberto) e mostra Capa | Produto | Nome | Quantidade', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga A', status: 'PENDENTE' } }],
  }, {
    'loja1/c1': [
      { id: 'i1', data: { capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Arroz 5kg', quantidade: 40 } },
      { id: 'i2', data: { capa: 'CAPA-002', codigoProduto: '1002', nomeProduto: 'Feijão 1kg', quantidade: 10 } },
    ],
  });
  await win.renderRecebimentoCargas();
  assert.equal(Object.keys(win._recebimentoCargasCardsInternals.getItensPorCarga()).length, 0, 'não deve buscar itens antes de abrir o card');

  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /CAPA-001/);
  assert.match(html, /CAPA-002/);
  assert.match(html, /Arroz 5kg/);
  assert.match(html, /Feijão 1kg/);
  assert.equal(win._recebimentoCargasCardsInternals.getItensPorCarga().c1.length, 2);

  // Fechar de novo (toggle) esconde o detalhe sem precisar buscar de novo.
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');
  const htmlFechado = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.doesNotMatch(htmlFechado, /CAPA-001/);
});

test('carga sem nenhum item bipado mostra "Nenhum item bipado ainda" no lugar das tabelas', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga vazia', status: 'PENDENTE' } }],
  }, { 'loja1/c1': [] });
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /Nenhum item bipado ainda/);
});

// BUG AO VIVO REAL (2026-09-06): "carrega a lista, depois começa a
// recarregar e não aparece mais" — redesenhar a lista inteira (ex.: botão
// Atualizar) sempre revertia um card já expandido pro placeholder
// "Carregando itens...", mesmo com os itens já buscados/cacheados antes —
// e não existia caminho pra buscar de novo (clicar de novo no card fecha,
// é um toggle). Ficava preso pra sempre.
test('redesenhar a lista inteira (ex.: Atualizar) NÃO reverte um card já expandido pro placeholder de carregamento — usa o cache já buscado', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, { 'loja1/c1': [{ id: 'i1', data: { capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Arroz 5kg', quantidade: 40 } }] });
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');
  let html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /CAPA-001/, 'detalhe carregou normalmente na primeira vez');

  // Simula um redesenho completo da lista (o que o botão "Atualizar" faz),
  // SEM fechar o card (_cargaExpandidaId continua 'c1').
  document.querySelector('[data-cargas-atualizar]').click();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

  html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /CAPA-001/, 'detalhe tem que continuar visível depois de atualizar, não travar em "Carregando itens..."');
  assert.doesNotMatch(html, /Carregando itens/);
});

// PEDIDO AO VIVO (2026-09-08): "esse palete depois da correção a linha
// dele também tem que ficar em amarela" — causa raiz real: _itensPorCarga
// nunca era invalidado pelo botão Atualizar, então uma correção feita pelo
// Coletor em outro aparelho nunca aparecia sem um F5 completo da página.
test('clicar "Atualizar" com o card aberto busca os itens de novo — capa corrigida pelo Coletor (em outro aparelho) vira amarela sem precisar fechar/reabrir o card nem recarregar a página', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'EM_TRANSITO' } }],
  }, { 'loja1/c1': [{ id: 'i1', data: { capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Arroz 5kg', quantidade: 40, bluesoftPendente: true } }] });
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');
  let html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /var\(--danger\)/, 'antes da correção, linha vermelha');

  // Simula a correção que o COLETOR gravaria em outro aparelho — escreve
  // direto no registro mockado, sem passar por nenhuma função desta tela.
  const registroItens = raw._itensColPorChave['loja1/c1']._registro;
  registroItens.set('i1', Object.assign({}, registroItens.get('i1'), {
    capa: 'CAPA-999', bluesoftPendente: false, bluesoftCorrigido: true,
    bluesoftHistorico: [{ capaAnterior: 'CAPA-001', capaNova: 'CAPA-999', corrigidoPor: 'operador@daterrinha.com', corrigidoEm: '2026-09-08T10:00:00.000Z' }],
  }));

  document.querySelector('[data-cargas-atualizar]').click();
  await new Promise(r => setTimeout(r, 0));

  html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /var\(--warn\)/, 'depois de Atualizar, a linha da capa corrigida fica amarela');
  assert.doesNotMatch(html, /var\(--danger\)/, 'não fica mais vermelha');
  assert.match(html, /CAPA-999/, 'mostra a capa nova, não a antiga cacheada');
});

test('adicionarNotaFiscalCarga: acrescenta NF+volumes na carga e grava no Firestore, sem mexer em totalVolumes', async () => {
  const { win, document, raw, toasts } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE', totalVolumes: 65, notasFiscais: [] } }],
  }, { 'loja1/c1': [] });
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  document.getElementById('nf-novo-numero-c1').value = '55501';
  document.getElementById('nf-novo-volumes-c1').value = '12';
  await win._recebimentoCargasCardsInternals.adicionarNotaFiscalCarga('c1');

  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.notasFiscais.length, 1);
  assert.equal(cargaSalva.notasFiscais[0].numero, '55501');
  assert.equal(cargaSalva.notasFiscais[0].volumes, 12);
  assert.equal(cargaSalva.totalVolumes, 65, 'totalVolumes (soma das quantidades bipadas) não deve mudar ao adicionar NF');
  assert.equal(win._recebimentoCargasCardsInternals.getCargas().find(c => c._id === 'c1').notasFiscais.length, 1);
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /55501/);
  assert.ok(toasts.some(t => /adicionada/i.test(t.msg)));
});

test('adicionarNotaFiscalCarga: recusa NF sem número, sem volume, ou repetida', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE', notasFiscais: [{ numero: '111', volumes: 5 }] } }],
  }, { 'loja1/c1': [] });
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  document.getElementById('nf-novo-numero-c1').value = '';
  document.getElementById('nf-novo-volumes-c1').value = '10';
  await win._recebimentoCargasCardsInternals.adicionarNotaFiscalCarga('c1');
  assert.match(document.getElementById('nf-status-c1').textContent, /número/i);

  document.getElementById('nf-novo-numero-c1').value = '222';
  document.getElementById('nf-novo-volumes-c1').value = '0';
  await win._recebimentoCargasCardsInternals.adicionarNotaFiscalCarga('c1');
  assert.match(document.getElementById('nf-status-c1').textContent, /volume/i);

  document.getElementById('nf-novo-numero-c1').value = '111';
  document.getElementById('nf-novo-volumes-c1').value = '8';
  await win._recebimentoCargasCardsInternals.adicionarNotaFiscalCarga('c1');
  assert.match(document.getElementById('nf-status-c1').textContent, /já está cadastrada/i);

  assert.equal(raw._registrosPorLoja.loja1.get('c1').notasFiscais.length, 1, 'nenhuma das 3 tentativas inválidas devia ter gravado nada');
});

test('removerNotaFiscalCarga: remove a NF pelo índice e grava no Firestore', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE', notasFiscais: [{ numero: '111', volumes: 5 }, { numero: '222', volumes: 8 }] } }],
  }, { 'loja1/c1': [] });
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  await win._recebimentoCargasCardsInternals.removerNotaFiscalCarga('c1', 0);

  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.notasFiscais.length, 1);
  assert.equal(cargaSalva.notasFiscais[0].numero, '222');
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.doesNotMatch(html, />111</);
  assert.match(html, /222/);
});

// PEDIDO AO VIVO (2026-09-08): "no início a gente sempre faz testes... isso
// serve pra novas funções" — o Analista precisa apagar cargas de teste
// direto da tela de Cargas (Montagem/Expedição), sem depender de mexer no
// Firestore manualmente.
test('excluirCarga: apaga a carga E os itens da subcoleção, some da lista e mostra toast', async () => {
  const { win, document, raw, toasts } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga de teste', status: 'PENDENTE' } }],
  }, { 'loja1/c1': [{ id: 'i1', data: { capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Arroz 5kg', quantidade: 40 } }] }, { confirmar: true });
  await win.renderRecebimentoCargas();

  await win._recebimentoCargasCardsInternals.excluirCarga('c1', 'loja1');

  assert.equal(raw._registrosPorLoja.loja1.has('c1'), false, 'o documento da carga tem que ter sido apagado');
  assert.equal(raw._itensColPorChave['loja1/c1']._registro.size, 0, 'os itens da subcoleção também têm que ter sido apagados');
  assert.equal(win._recebimentoCargasCardsInternals.getCargas().length, 0);
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.doesNotMatch(html, /Carga de teste/);
  assert.ok(toasts.some(t => /exclu[ií]da/i.test(t.msg)));
});

test('excluirCarga: se o usuário não confirmar, não apaga nada', async () => {
  const { win, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga de teste', status: 'PENDENTE' } }],
  }, { 'loja1/c1': [] }, { confirmar: false });
  await win.renderRecebimentoCargas();

  await win._recebimentoCargasCardsInternals.excluirCarga('c1', 'loja1');

  assert.equal(raw._registrosPorLoja.loja1.has('c1'), true, 'sem confirmar, a carga tem que continuar lá');
  assert.equal(win._recebimentoCargasCardsInternals.getCargas().length, 1);
});

test('clique no botão de excluir do card aciona excluirCarga com o id e a loja certos, sem abrir/fechar o detalhe', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga de teste', status: 'PENDENTE' } }],
  }, { 'loja1/c1': [] }, { confirmar: true });
  await win.renderRecebimentoCargas();

  document.querySelector('[data-carga-excluir="c1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  assert.equal(raw._registrosPorLoja.loja1.has('c1'), false);
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.doesNotMatch(html, /Carregando itens/, 'o clique no excluir não pode ter acionado o toggle de abrir o card');
});

// PEDIDO AO VIVO (2026-09-08): "excluir as cargas e as saídas de paletes
// mas ainda continuou em trânsito, ele tem que voltar para o estoque de
// origem" — uma carga EM_TRANSITO já tinha debitado o Disponível e
// creditado o Em Trânsito na expedição (Coletor); excluí-la sem desfazer
// isso deixava esse saldo preso. Agora devolve pro ledger de origem.
test('excluirCarga: carga EM_TRANSITO devolve o Disponível pra origem e desconta o Em Trânsito do DESTINO', async () => {
  const { win, raw, chamadasLedger } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga expedida', status: 'EM_TRANSITO', totalPaletesFisico: 5, destinoLojaId: 'loja2' } }],
  }, { 'loja1/c1': [] }, { confirmar: true });
  await win.renderRecebimentoCargas();

  await win._recebimentoCargasCardsInternals.excluirCarga('c1', 'loja1');

  assert.equal(raw._registrosPorLoja.loja1.has('c1'), false);
  // PEDIDO AO VIVO (2026-09-08): "se o palete tiver em trânsito ele tem
  // que tá com o número na loja de destino, não da loja que tá saindo" —
  // desfazer precisa espelhar isso: Disponível volta pra origem, Em
  // Trânsito é descontado do DESTINO (é lá que ele estava lançado).
  assert.equal(chamadasLedger.length, 2);
  const origem = chamadasLedger.find(c => c.lojaId === 'loja1');
  const destino = chamadasLedger.find(c => c.lojaId === 'loja2');
  assert.ok(origem, 'origem recebe o Disponível de volta');
  assert.ok(destino, 'destino perde o Em Trânsito que tinha ganhado na expedição');
  assert.equal(origem.deltas.disponivelDelta, 5);
  assert.equal(origem.deltas.emTransitoDelta, undefined);
  assert.equal(destino.deltas.emTransitoDelta, -5);
  assert.equal(destino.deltas.disponivelDelta, undefined);
});

test('excluirCarga: carga PENDENTE (nunca expedida) NÃO mexe no ledger — nunca chegou a debitar nada', async () => {
  const { win, chamadasLedger } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga em montagem', status: 'PENDENTE', totalPaletesFisico: 5 } }],
  }, { 'loja1/c1': [] }, { confirmar: true });
  await win.renderRecebimentoCargas();

  await win._recebimentoCargasCardsInternals.excluirCarga('c1', 'loja1');

  assert.equal(chamadasLedger.length, 0);
});

test('excluirCarga: carga RECEBIDA também NÃO mexe no ledger (a parte de origem já foi zerada pelo bip de chegada — mexer aqui bagunçaria o lado destino)', async () => {
  const { win, chamadasLedger } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga já recebida', status: 'RECEBIDA', totalPaletesFisico: 5 } }],
  }, { 'loja1/c1': [] }, { confirmar: true });
  await win.renderRecebimentoCargas();

  await win._recebimentoCargasCardsInternals.excluirCarga('c1', 'loja1');

  assert.equal(chamadasLedger.length, 0);
});

// PEDIDO AO VIVO (2026-09-08): "seleciona os produtos através dos flags...
// informa o número da nota... clica em Adicionar... os produtos
// selecionados ficam vinculados àquela nota" — vínculo produto→nota,
// ADICIONAL ao "+ Adicionar NF" manual (que continua existindo).
const ITENS_2_PRODUTOS = {
  'loja1/c1': [
    { id: 'i1', data: { capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20 } },
    { id: 'i2', data: { capa: 'CAPA-002', codigoProduto: '1002', nomeProduto: 'Produto B', quantidade: 15 } },
  ],
};

function marcarCheckbox(document, cargaId, chave) {
  const container = document.querySelector('[data-carga-detalhe="' + cargaId + '"]');
  const cb = container.querySelector('[data-produto-check="' + chave + '"]');
  cb.checked = true;
  return cb;
}

test('vincularProdutosANota: marca 1 produto, informa a nota, vincula — grava notasFiscaisProdutos e mostra a quantidade já bipada (sem digitar de novo)', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  marcarCheckbox(document, 'c1', '1001|Tapioca 1kg Fardo');
  document.getElementById('npv-numero-c1').value = '123456';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');

  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.notasFiscaisProdutos.length, 1);
  assert.equal(cargaSalva.notasFiscaisProdutos[0].numero, '123456');
  assert.equal(cargaSalva.notasFiscaisProdutos[0].produtos.length, 1);
  assert.equal(cargaSalva.notasFiscaisProdutos[0].produtos[0].codigoProduto, '1001');
  assert.ok(!('volumes' in cargaSalva.notasFiscaisProdutos[0].produtos[0]), 'não guarda volume/quantidade no vínculo — é recalculado ao vivo');
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /data-npv-numero="123456"/, 'número da nota aparece na coluna "Nota" do próprio resumo, sem tabela nova');
  assert.match(html, /Tapioca 1kg Fardo/);
  assert.match(html, />20</, 'quantidade já bipada (20) aparece automaticamente, sem precisar digitar de novo');
});

test('vincularProdutosANota: marca 2 produtos numa vez, todos vão pra mesma nota', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  marcarCheckbox(document, 'c1', '1001|Tapioca 1kg Fardo');
  marcarCheckbox(document, 'c1', '1002|Produto B');
  document.getElementById('npv-numero-c1').value = '123456';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');

  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.notasFiscaisProdutos.length, 1);
  assert.equal(cargaSalva.notasFiscaisProdutos[0].produtos.length, 2);
});

test('vincularProdutosANota: dá pra vincular produtos diferentes a notas diferentes, cada vinculação separada', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  marcarCheckbox(document, 'c1', '1001|Tapioca 1kg Fardo');
  document.getElementById('npv-numero-c1').value = '123456';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');

  marcarCheckbox(document, 'c1', '1002|Produto B');
  document.getElementById('npv-numero-c1').value = '789012';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');

  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.notasFiscaisProdutos.length, 2);
  const nota1 = cargaSalva.notasFiscaisProdutos.find(n => n.numero === '123456');
  const nota2 = cargaSalva.notasFiscaisProdutos.find(n => n.numero === '789012');
  assert.equal(nota1.produtos[0].codigoProduto, '1001');
  assert.equal(nota2.produtos[0].codigoProduto, '1002');
});

test('vincularProdutosANota: vincular um produto que já estava em outra nota MOVE ele (remove da nota antiga, nota antiga some se ficar vazia)', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  marcarCheckbox(document, 'c1', '1001|Tapioca 1kg Fardo');
  document.getElementById('npv-numero-c1').value = '123456';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');

  marcarCheckbox(document, 'c1', '1001|Tapioca 1kg Fardo');
  document.getElementById('npv-numero-c1').value = '789012';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');

  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.notasFiscaisProdutos.length, 1, 'nota 123456 ficou vazia e sumiu — só sobra a 789012');
  assert.equal(cargaSalva.notasFiscaisProdutos[0].numero, '789012');
});

test('vincularProdutosANota: recusa sem nenhum produto marcado, e sem número de nota', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  document.getElementById('npv-numero-c1').value = '123456';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');
  assert.match(document.getElementById('npv-status-c1').textContent, /marque pelo menos um produto/i);

  marcarCheckbox(document, 'c1', '1001|Tapioca 1kg Fardo');
  document.getElementById('npv-numero-c1').value = '';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');
  assert.match(document.getElementById('npv-status-c1').textContent, /digite o número/i);

  assert.equal(raw._registrosPorLoja.loja1.get('c1').notasFiscaisProdutos, undefined, 'nenhuma das 2 tentativas inválidas devia ter gravado nada');
});

test('vincularProdutosANota: quantidade exibida é recalculada ao vivo — bipar mais um item do mesmo produto muda a quantidade mostrada sem precisar revincular', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');
  marcarCheckbox(document, 'c1', '1001|Tapioca 1kg Fardo');
  document.getElementById('npv-numero-c1').value = '123456';
  await win._recebimentoCargasCardsInternals.vincularProdutosANota('c1');

  // Bipa mais um item do MESMO produto direto na subcoleção (simula o
  // operador continuando a montagem) e reabre o detalhe.
  raw._itensColPorChave['loja1/c1']._registro.set('i3', { capa: 'CAPA-003', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 5 });
  delete win._recebimentoCargasCardsInternals.getItensPorCarga().c1; // força reler os itens
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1'); // fecha
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1'); // reabre, relê itens

  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, />25</, '20 (já vinculado) + 5 (bipado depois) = 25, sem precisar revincular');
});

test('desvincularProdutoDaNota: remove o produto da nota e grava no Firestore; nota some se ficar sem nenhum produto', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE', notasFiscaisProdutos: [{ numero: '123456', produtos: [{ codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }] }] } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');
  // Nunca casa com o "123456" solto — o input de vincular sempre tem
  // "Ex.: 123456" como placeholder, presente mesmo sem nenhum vínculo.
  assert.match(document.getElementById('page-recebimento-cargas').innerHTML, /data-npv-numero="123456"/);

  await win._recebimentoCargasCardsInternals.desvincularProdutoDaNota('c1', '123456', '1001|Tapioca 1kg Fardo');

  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.notasFiscaisProdutos.length, 0);
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.doesNotMatch(html, /data-npv-numero="123456"/);
});

// PEDIDO AO VIVO (2026-09-08): "quando colocar uma nota vinculada com os
// produtos não precisa criar mais novas linhas... ali mesmo no resumo do
// produto pode ter uma coluna com essa informação" — a tabela separada
// "Notas × Produtos" foi removida; a nota de cada produto vira só mais uma
// coluna do Resumo por produto (com botão de desvincular quando tem nota).
test('_detalheHtml: resumo por produto mostra checkbox de seleção E a coluna "Nota" (— quando não vinculado, número + desvincular quando vinculado), sem tabela separada', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE', notasFiscaisProdutos: [{ numero: '123456', produtos: [{ codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }] }] } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /data-produto-check="1001\|Tapioca 1kg Fardo"/);
  assert.match(html, /data-produto-check="1002\|Produto B"/);
  assert.doesNotMatch(html, /Notas × Produtos/, 'a tabela separada não pode mais existir');
  assert.match(html, /<th>Nota<\/th>/);
  assert.match(html, /data-npv-desvincular="c1" data-npv-numero="123456" data-npv-chave="1001\|Tapioca 1kg Fardo"/, 'produto vinculado mostra o número da nota + botão de desvincular na própria linha do resumo');
});

// PEDIDO AO VIVO (2026-09-08): "adicionar uma opção pra indicar que
// determinada capa-palete não existe no Bluesoft... a linha fica
// vermelha... o sistema deve registrar aquela capa-palete como uma
// pendência... o coletor/operador deve receber uma notificação".
test('marcarCapaBluesoftPendente: marca o item + grava pendenciasCapaAbertas/temPendenciaCapa na carga, num único batch', async () => {
  const { win, document, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  await win._recebimentoCargasCardsInternals.marcarCapaBluesoftPendente('loja1', 'c1', 'i1', true);

  const itemSalvo = raw._itensColPorChave['loja1/c1']._registro.get('i1');
  assert.equal(itemSalvo.bluesoftPendente, true);
  assert.ok(itemSalvo.bluesoftPendenteDesde);
  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.temPendenciaCapa, true);
  assert.equal(cargaSalva.pendenciasCapaAbertas.length, 1);
  assert.equal(cargaSalva.pendenciasCapaAbertas[0].itemId, 'i1');
  assert.equal(cargaSalva.pendenciasCapaAbertas[0].capa, 'CAPA-001');
  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /var\(--danger\)/, 'linha da capa pendente fica vermelha');
});

test('marcarCapaBluesoftPendente: desmarcar (falso alarme) tira a pendência, sem mexer em bluesoftCorrigido/bluesoftHistorico', async () => {
  const { win, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');
  await win._recebimentoCargasCardsInternals.marcarCapaBluesoftPendente('loja1', 'c1', 'i1', true);

  await win._recebimentoCargasCardsInternals.marcarCapaBluesoftPendente('loja1', 'c1', 'i1', false);

  const itemSalvo = raw._itensColPorChave['loja1/c1']._registro.get('i1');
  assert.equal(itemSalvo.bluesoftPendente, false);
  assert.equal(itemSalvo.bluesoftCorrigido, undefined);
  const cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.temPendenciaCapa, false);
  assert.equal(cargaSalva.pendenciasCapaAbertas.length, 0);
});

test('marcarCapaBluesoftPendente: 2 itens pendentes na mesma carga — temPendenciaCapa só volta a false quando o ÚLTIMO for desmarcado', async () => {
  const { win, raw } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'PENDENTE' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  await win._recebimentoCargasCardsInternals.marcarCapaBluesoftPendente('loja1', 'c1', 'i1', true);
  await win._recebimentoCargasCardsInternals.marcarCapaBluesoftPendente('loja1', 'c1', 'i2', true);
  assert.equal(raw._registrosPorLoja.loja1.get('c1').pendenciasCapaAbertas.length, 2);

  await win._recebimentoCargasCardsInternals.marcarCapaBluesoftPendente('loja1', 'c1', 'i1', false);
  let cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.temPendenciaCapa, true, 'i2 ainda está pendente');
  assert.equal(cargaSalva.pendenciasCapaAbertas.length, 1);

  await win._recebimentoCargasCardsInternals.marcarCapaBluesoftPendente('loja1', 'c1', 'i2', false);
  cargaSalva = raw._registrosPorLoja.loja1.get('c1');
  assert.equal(cargaSalva.temPendenciaCapa, false);
});

test('_detalheHtml: item corrigido (bluesoftCorrigido) fica amarelo e mostra a capa anterior no histórico — nunca junto com o vermelho', async () => {
  const itensComCorrecao = {
    'loja1/c1': [
      { id: 'i1', data: { capa: 'CAPA-999', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20, bluesoftCorrigido: true, bluesoftHistorico: [{ capaAnterior: 'CAPA-001', capaNova: 'CAPA-999', corrigidoPor: 'operador@daterrinha.com', corrigidoEm: '2026-09-08T10:00:00.000Z' }] } },
    ],
  };
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'EM_TRANSITO' } }],
  }, itensComCorrecao);
  await win.renderRecebimentoCargas();
  await win._recebimentoCargasCardsInternals.alternarDetalheCarga('c1');

  const html = document.getElementById('page-recebimento-cargas').innerHTML;
  assert.match(html, /var\(--warn\)/, 'linha corrigida fica amarela');
  assert.doesNotMatch(html, /var\(--danger\)/, 'não pode ficar vermelha ao mesmo tempo');
  assert.match(html, /Capa anterior.*CAPA-001/);
  assert.match(html, /operador@daterrinha\.com/);
});

// PEDIDO AO VIVO (2026-09-08): "ter a opção de fazer download em pdf com
// as informações da carga" — botão 📄 PDF no card, exporta um bloco
// só-leitura (fora do card interativo) via `exportarElementoProducaoPDF`.
test('baixarPdfCarga: chama exportarElementoProducaoPDF com um nome de arquivo baseado no nome da carga', async () => {
  const { win, chamadasPdf } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga Matriz → Filial', status: 'EM_TRANSITO', origemNome: 'Loja Matriz', destinoNome: 'Loja Filial' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();

  await win._recebimentoCargasCardsInternals.baixarPdfCarga('c1');

  assert.equal(chamadasPdf.length, 1);
  assert.equal(chamadasPdf[0].nomeArquivo, 'carga_carga_matriz_filial.pdf');
});

test('baixarPdfCarga: o elemento exportado é removido do DOM depois (não fica lixo na página)', async () => {
  const { win, document } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'EM_TRANSITO' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();

  await win._recebimentoCargasCardsInternals.baixarPdfCarga('c1');

  assert.equal(document.getElementById('_pdf_carga_c1'), null);
});

test('baixarPdfCarga: se exportarElementoProducaoPDF não existir na página, avisa por toast e não quebra', async () => {
  const { win, toasts } = carregarPagina(LOJAS, {
    loja1: [{ id: 'c1', data: { nomeCarga: 'Carga 1', status: 'EM_TRANSITO' } }],
  }, ITENS_2_PRODUTOS);
  await win.renderRecebimentoCargas();
  delete win.exportarElementoProducaoPDF;

  await win._recebimentoCargasCardsInternals.baixarPdfCarga('c1');

  assert.ok(toasts.some(t => /PDF/i.test(t.msg)));
});

test('pdfCargaHtml: traz nome/origem-destino, resumo por produto com a coluna Nota, e status da capa por item — nada de checkbox/input (é só leitura)', async () => {
  const { win } = carregarPagina(LOJAS, {
    loja1: [{
      id: 'c1', data: {
        nomeCarga: 'Carga 1', status: 'EM_TRANSITO', origemNome: 'Loja Matriz', destinoNome: 'Loja Filial',
        motoristaNome: 'João', placa: 'ABC1D23', totalPaletesFisico: 2, totalVolumes: 35,
        notasFiscaisProdutos: [{ numero: '123456', produtos: [{ codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }] }],
      },
    }],
  }, {
    'loja1/c1': [
      { id: 'i1', data: { capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20 } },
      { id: 'i2', data: { capa: 'CAPA-002', codigoProduto: '1002', nomeProduto: 'Produto B', quantidade: 15, bluesoftPendente: true } },
    ],
  });
  await win.renderRecebimentoCargas();
  const carga = win._recebimentoCargasCardsInternals.getCargas().find(c => c._id === 'c1');
  const itens = [
    { id: 'i1', capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20 },
    { id: 'i2', capa: 'CAPA-002', codigoProduto: '1002', nomeProduto: 'Produto B', quantidade: 15, bluesoftPendente: true },
  ];

  const html = win._recebimentoCargasCardsInternals.pdfCargaHtml(carga, itens);

  assert.match(html, /Carga 1/);
  assert.match(html, /Loja Matriz.*→.*Loja Filial/);
  assert.match(html, /João/);
  assert.match(html, /123456/, 'nota vinculada aparece na lista de notas fiscais');
  assert.match(html, /Tapioca 1kg Fardo/);
  assert.match(html, /CAPA-002/);
  assert.match(html, /Pendente \(capa não existe no Bluesoft\)/);
  assert.doesNotMatch(html, /<input/, 'bloco do PDF é só leitura — sem input');
  assert.doesNotMatch(html, /type="checkbox"/, 'bloco do PDF é só leitura — sem checkbox');
});
