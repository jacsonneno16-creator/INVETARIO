// Devoluções unificadas (2026-10-13): testa 106-devolucoes.js, a nova
// página única do Analista (Controle/Relatórios/Indicadores) que substitui
// 100-consulta-notas-fiscais.js e 102-devolucoes-bi-indicadores.js. Cobre
// os 3 critérios de aceite centrais do prompt: (1) Controle consulta o
// catálogo fiscal novo via BigQuery, sem listar o arquivo BI inteiro; (2)
// Relatórios bipa a própria chave da devolução e confirma via a MESMA
// transação atômica do Coletor — nunca duplica um "primeiro recebimento";
// (3) Indicadores lê do catálogo novo (devolucoes_notas), não mais de
// recebimento_recusas.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '106-devolucoes.js'), 'utf8');

const CHAVE1 = '33333333333333333333333333333333333333333336';
const CHAVE2 = '44444444444444444444444444444444444444444448';

function carregarPagina(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-devolucoes"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const chamadasCallable = [];
  const respostas = opts.respostas || {};
  win.getDTLojaAtiva = () => 'matriz';
  win.temPermissao = opts.temPermissao || (() => true);
  win.showToast = () => {};
  win.aplicarPermissoesAnalista = () => {};
  const localStorageFake = (() => {
    let dados = {};
    return {
      getItem: (k) => (k in dados ? dados[k] : null),
      setItem: (k, v) => { dados[k] = String(v); },
      removeItem: (k) => { delete dados[k]; },
    };
  })();
  Object.defineProperty(win, 'localStorage', { value: localStorageFake, configurable: true });
  win.getDTRawFirestore = () => opts.rawFs || { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }), add: async () => ({ id: 'novo-relatorio-1' }) }), batch: () => ({ set: () => {}, commit: async () => {} }) };
  win.getDTFirestore = win.getDTRawFirestore;
  win.firebase = {
    auth: () => ({ currentUser: { uid: 'u1', email: 'analista@daterrinha.com' } }),
    app: () => ({
      functions: () => ({
        httpsCallable: (nome) => (dados) => {
          chamadasCallable.push({ nome, dados });
          const resposta = typeof respostas[nome] === 'function' ? respostas[nome](dados) : (respostas[nome] || { ok: true });
          return Promise.resolve({ data: resposta });
        },
      }),
    }),
  };
  win.eval(code);
  return { win, document, chamadasCallable };
}

test('renderRecebimentoDevolucoes: desenha o shell com as 3 abas, Controle ativa por padrão', async () => {
  const { win, document } = carregarPagina();
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  const html = document.getElementById('page-recebimento-devolucoes').innerHTML;
  assert.match(html, /Controle/);
  assert.match(html, /Relatórios/);
  assert.match(html, /Indicadores/);
  assert.match(html, /Escolha os filtros e clique em Consultar/);
});

test('Controle: consultar chama listarDevolucoesBigQuery com a lojaId ativa e desenha as notas', async () => {
  const { win, document, chamadasCallable } = carregarPagina({
    respostas: { listarDevolucoesBigQuery: { notas: [{ chave: CHAVE1, numeroNota: '777', dataEmissao: '2026-10-01', destinatario: 'Mercado Novo', valorTotal: 150.5, motivoNormalizado: 'TROCA', estado: 'PENDENTE' }] } },
  });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-consultar]').click();
  await new Promise(r => setTimeout(r, 0));
  const chamada = chamadasCallable.find(c => c.nome === 'listarDevolucoesBigQuery');
  assert.ok(chamada, 'deveria ter chamado o callable de consulta paginada');
  assert.equal(chamada.dados.lojaId, 'matriz');
  const html = document.getElementById('page-recebimento-devolucoes').innerHTML;
  assert.match(html, /NF 777|777/);
  assert.match(html, /Mercado Novo/);
  assert.match(html, /⏳ Pendente/);
});

test('Controle: botão "Atualizar do BI" só aparece com permissão importar', async () => {
  const { win, document } = carregarPagina({ temPermissao: (modulo, acao) => acao !== 'importar' });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  assert.doesNotMatch(document.getElementById('page-recebimento-devolucoes').innerHTML, /data-devol-atualizar-bi/);
});

test('Controle: "Atualizar do BI" chama sincronizarBiAgendadoAgora e mostra o resumo agregado', async () => {
  const { win, document, chamadasCallable } = carregarPagina({
    respostas: { sincronizarBiAgendadoAgora: { resultados: [{ loja: 'Matriz', devolucoesBi: { novas: 3, atualizadas: 1, invalidas: 0 } }, { loja: 'Filial', devolucoesBi: { novas: 2, atualizadas: 0, invalidas: 1 } }] } },
  });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-atualizar-bi]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(chamadasCallable.some(c => c.nome === 'sincronizarBiAgendadoAgora'));
  const html = document.getElementById('page-recebimento-devolucoes').innerHTML;
  assert.match(html, /5 nova\(s\)/);
  assert.match(html, /1 atualizada\(s\)/);
  assert.match(html, /1 inválida\(s\)/);
});

test('Relatórios: "Montar relatório" cria o cabeçalho (RASCUNHO) e guarda o rascunho no localStorage', async () => {
  let criado = null;
  const rawFs = {
    collection: () => ({ doc: () => ({ collection: () => ({ add: async (payload) => { criado = payload; return { id: 'rel-abc' }; } }) }) }),
    batch: () => ({ set: () => {}, commit: async () => {} }),
  };
  const { win, document } = carregarPagina({ rawFs });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-aba="relatorios"]').click();
  document.querySelector('[data-devol-rel-iniciar]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(criado, 'deveria ter criado o doc de cabeçalho do relatório');
  assert.equal(criado.status, 'RASCUNHO');
  assert.equal(criado.lojaId, 'matriz');
  assert.ok(win.localStorage.getItem('dt_devol_relatorio_rascunho'), 'rascunho precisa estar salvo no localStorage');
});

test('Relatórios: bipar uma chave PENDENTE consulta, confirma e marca como confirmada', async () => {
  const rawFs = { collection: () => ({ doc: () => ({ collection: () => ({ add: async () => ({ id: 'rel-1' }) }) }) }), batch: () => ({ set: () => {}, commit: async () => {} }) };
  const { win, document, chamadasCallable } = carregarPagina({
    rawFs,
    respostas: {
      consultarDevolucaoPorChave: { nota: { chave: CHAVE1, numeroNota: '777', destinatario: 'Mercado Novo', valorTotal: 99.9 } },
      confirmarRecebimentoDevolucao: { ok: true, jaRecebida: false, recebimento: { confirmadoPor: 'analista@daterrinha.com', confirmadoEm: '2026-10-13T10:00:00.000Z' } },
    },
  });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-aba="relatorios"]').click();
  document.querySelector('[data-devol-rel-iniciar]').click();
  await new Promise(r => setTimeout(r, 0));
  const input = document.getElementById('devol-rel-scan');
  input.value = CHAVE1;
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  const confirmou = chamadasCallable.find(c => c.nome === 'confirmarRecebimentoDevolucao');
  assert.ok(confirmou, 'deveria ter chamado a confirmação atômica');
  assert.equal(confirmou.dados.chave, CHAVE1);
  assert.equal(confirmou.dados.origem, 'ANALISTA');
  assert.equal(confirmou.dados.relatorioId, 'rel-1');
  const html = document.getElementById('page-recebimento-devolucoes').innerHTML;
  assert.match(html, /✓ Confirmada/);
  assert.match(html, /777/);
});

test('Relatórios: bipar uma chave já recebida (ex.: pelo Coletor) mostra aviso distinto, não "confirmada"', async () => {
  const rawFs = { collection: () => ({ doc: () => ({ collection: () => ({ add: async () => ({ id: 'rel-1' }) }) }) }), batch: () => ({ set: () => {}, commit: async () => {} }) };
  const { win, document } = carregarPagina({
    rawFs,
    respostas: {
      consultarDevolucaoPorChave: { nota: { chave: CHAVE1, numeroNota: '777' } },
      confirmarRecebimentoDevolucao: { ok: true, jaRecebida: true, recebimento: { origem: 'COLETOR', confirmadoEm: '2026-10-12T10:00:00.000Z', confirmadoPor: 'coletor@daterrinha.com' } },
    },
  });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-aba="relatorios"]').click();
  document.querySelector('[data-devol-rel-iniciar]').click();
  await new Promise(r => setTimeout(r, 0));
  const input = document.getElementById('devol-rel-scan');
  input.value = CHAVE1;
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('page-recebimento-devolucoes').innerHTML;
  assert.match(html, /⚠ Já recebida/);
  assert.match(html, /Já recebida por COLETOR/);
  assert.doesNotMatch(html, /✓ Confirmada/);
});

test('Relatórios: "Confirmar" (botão) bipa a chave sem precisar apertar Enter', async () => {
  const rawFs = { collection: () => ({ doc: () => ({ collection: () => ({ add: async () => ({ id: 'rel-1' }) }) }) }), batch: () => ({ set: () => {}, commit: async () => {} }) };
  const { win, document } = carregarPagina({
    rawFs,
    respostas: {
      consultarDevolucaoPorChave: { nota: { chave: CHAVE1, numeroNota: '777' } },
      confirmarRecebimentoDevolucao: { ok: true, jaRecebida: false, recebimento: { confirmadoPor: 'analista@daterrinha.com', confirmadoEm: '2026-10-14T10:00:00.000Z' } },
    },
  });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-aba="relatorios"]').click();
  document.querySelector('[data-devol-rel-iniciar]').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('devol-rel-scan').value = CHAVE1;
  document.querySelector('[data-devol-rel-confirmar-chave]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('page-recebimento-devolucoes').innerHTML;
  assert.match(html, /✓ Confirmada/);
  assert.equal(document.getElementById('devol-rel-scan').value, '', 'campo limpa depois de confirmar, igual o Enter já fazia');
});

test('Relatórios: chave que não existe no catálogo fiscal vira linha de erro, com botão de tentar de novo — não trava as outras', async () => {
  const rawFs = { collection: () => ({ doc: () => ({ collection: () => ({ add: async () => ({ id: 'rel-1' }) }) }) }), batch: () => ({ set: () => {}, commit: async () => {} }) };
  const { win, document } = carregarPagina({
    rawFs,
    respostas: { consultarDevolucaoPorChave: { nota: null } },
  });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-aba="relatorios"]').click();
  document.querySelector('[data-devol-rel-iniciar]').click();
  await new Promise(r => setTimeout(r, 0));
  const input = document.getElementById('devol-rel-scan');
  input.value = CHAVE1;
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  let html = document.getElementById('page-recebimento-devolucoes').innerHTML;
  assert.match(html, /✗ Erro/);
  assert.match(html, /não encontrada no catálogo fiscal/);
  assert.ok(document.querySelector('[data-devol-rel-retry]'), 'precisa ter botão de tentar de novo só nessa linha');
  assert.ok(document.querySelector('[data-devol-rel-finalizar]').disabled, 'não pode finalizar com linha em erro');
});

test('Relatórios: Finalizar só habilita quando nenhuma linha está queued/consultando/erro, e grava as linhas + status FINALIZADO', async () => {
  const linhasGravadas = [];
  let statusFinal = null;
  const relatorioDocRef = {
    collection: (nome) => ({ doc: (id) => ({ _id: id }), _nome: nome }),
    update: async (payload) => { statusFinal = payload; },
  };
  const rawFs = {
    collection: () => ({
      doc: () => ({
        collection: () => ({ add: async () => ({ id: 'rel-1' }), doc: () => relatorioDocRef }),
      }),
    }),
    batch: () => ({ set: (ref, payload) => linhasGravadas.push(payload), commit: async () => {} }),
  };
  const { win, document } = carregarPagina({
    rawFs,
    respostas: {
      consultarDevolucaoPorChave: (dados) => ({ nota: { chave: dados.chave, numeroNota: '1', destinatario: 'X', valorTotal: 10 } }),
      confirmarRecebimentoDevolucao: { ok: true, jaRecebida: false, recebimento: { confirmadoPor: 'a@b.com', confirmadoEm: '2026-10-13T10:00:00.000Z' } },
    },
  });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-aba="relatorios"]').click();
  document.querySelector('[data-devol-rel-iniciar]').click();
  await new Promise(r => setTimeout(r, 0));
  let input = document.getElementById('devol-rel-scan');
  input.value = CHAVE1; input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  input = document.getElementById('devol-rel-scan'); // re-render trocou o nó do input
  input.value = CHAVE2; input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));

  assert.equal(document.querySelector('[data-devol-rel-finalizar]').disabled, false, 'tudo confirmado — pode finalizar');
  document.querySelector('[data-devol-rel-finalizar]').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(linhasGravadas.length, 2);
  assert.ok(linhasGravadas.every(l => l.relatorioStatus === 'FINALIZADO'));
  assert.equal(statusFinal.status, 'FINALIZADO');
  assert.equal(win.localStorage.getItem('dt_devol_relatorio_rascunho'), null, 'rascunho precisa sumir do localStorage depois de finalizar');
});

test('Indicadores: _indKpis conta aguardandoRetorno a partir do estado da nota (PENDENTE), não mais de retornouFisicamente', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTLojaAtiva = () => 'matriz'; win.firebase = { auth: () => ({}) };
  win.eval(code);
  const itens = [
    { motivoNormalizado: 'TROCA', valorTotal: 10, destinatario: 'A - 1', estado: 'PENDENTE' },
    { motivoNormalizado: 'TROCA', valorTotal: 20, destinatario: 'A - 1', estado: 'RECEBIDA' },
    { motivoNormalizado: 'AVARIA', valorTotal: 5, destinatario: 'B - 2', estado: 'PENDENTE' },
  ];
  const k = win._DTDevolucoesInternals._indKpis(itens);
  assert.equal(k.totalDevolucoes, 3);
  assert.equal(k.somaValor, 35);
  assert.equal(k.aguardandoRetorno, 2);
  assert.equal(k.motivoTop, 'TROCA');
});

test('Indicadores: buscar usa listarDevolucoesBigQuery com limite maior que o padrão da aba Controle', async () => {
  const { win, document, chamadasCallable } = carregarPagina({ respostas: { listarDevolucoesBigQuery: { notas: [] } } });
  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-aba="indicadores"]').click();
  document.querySelector('[data-devind-buscar-periodo]').click();
  await new Promise(r => setTimeout(r, 0));
  const chamada = chamadasCallable.find(c => c.nome === 'listarDevolucoesBigQuery');
  assert.ok(chamada);
  assert.equal(chamada.dados.limite, 5000);
});

// BUG AO VIVO REAL (2026-10-14): "aperto Tentar de novo e fala que não
// tenho permissão" — 37-usuarios-permissoes.js tem uma 2ª camada global
// (document.addEventListener('click',...,true)) que INFERE a ação de um
// botão pelo texto quando ele não declara data-perm-acao explícito
// (_inferirAcaoElemento). "Tentar de NOVO" contém a palavra "novo", que
// bate no regex de 'criar' — 'criar' nem existe no catálogo de
// recebimento-devolucoes, então a checagem nega pra todo mundo, sempre.
// Os testes acima (carregarPagina) stubavam win.temPermissao/
// aplicarPermissoesAnalista, então nunca exercitavam essa 2ª camada de
// verdade — por isso o bug passou despercebido. Estes testes carregam o
// 37-usuarios-permissoes.js REAL (não stubado) ao lado de 106-devolucoes.js,
// simulando um analista com permissões granulares de verdade.
test('REGRESSÃO: clicar em "Tentar de novo"/"Confirmar"/"Finalizar relatório" não é bloqueado pela 2ª camada global de permissões (ela inferia a ação errado a partir do texto do botão)', async () => {
  const permCode = fs.readFileSync(path.join(base, '37-usuarios-permissoes.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><body><div class="page on" id="page-recebimento-devolucoes"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const toasts = [];
  win.showToast = (m) => toasts.push(m);
  win.getDTLojaAtiva = () => 'matriz';
  win.getDTRawFirestore = () => ({ collection: () => ({ doc: () => ({ collection: () => ({ add: async () => ({ id: 'rel-1' }), doc: () => ({ collection: () => ({ doc: () => ({}) }), update: async () => {} }) }) }) }), batch: () => ({ set: () => {}, commit: async () => {} }) });
  win.getDTFirestore = win.getDTRawFirestore;
  win.firebase = {
    auth: () => ({ currentUser: { uid: 'u1', email: 'analista@daterrinha.com' } }),
    app: () => ({ functions: () => ({ httpsCallable: (nome) => () => {
      // Propositalmente "não encontrada" — não importa pra este teste se a
      // chave existe de verdade, só que clicar nos botões nunca seja
      // barrado pela 2ª camada de permissões.
      if (nome === 'consultarDevolucaoPorChave') return Promise.resolve({ data: { nota: null } });
      return Promise.resolve({ data: {} });
    } }) }),
  };
  // Analista real: tem relatorio_criar e relatorio_finalizar, mas NÃO tem
  // confirmar/estornar/excluir — exatamente o que a migração grava (ver
  // scripts/migrar-permissoes-devolucoes-unificadas.js, "sempre false").
  win.DT_USUARIO_ACESSO_ATUAL = { permissoes: { 'recebimento-devolucoes': { visualizar: true, importar: false, confirmar: false, relatorio_criar: true, relatorio_finalizar: true, exportar: false, estornar: false, excluir: false } } };
  win.eval(permCode);
  win.eval(code);

  await win.renderRecebimentoDevolucoes('page-recebimento-devolucoes');
  document.querySelector('[data-devol-aba="relatorios"]').click();
  document.querySelector('[data-devol-rel-iniciar]').click();
  await new Promise(r => setTimeout(r, 0));

  // 1) "Confirmar" (botão do scan) — chave não encontrada na 1ª tentativa, vira erro
  document.getElementById('devol-rel-scan').value = CHAVE1;
  document.querySelector('[data-devol-rel-confirmar-chave]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(toasts, [], 'nenhum toast de "sem permissão" ao clicar em Confirmar');
  assert.match(document.getElementById('page-recebimento-devolucoes').innerHTML, /✗ Erro/);

  // 2) "Tentar de novo" — é o botão que disparou o bug ao vivo
  document.querySelector('[data-devol-rel-retry]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(!toasts.some(t => /possui permiss/.test(t)), 'clicar em "Tentar de novo" não pode ser barrado por permissão');
});
