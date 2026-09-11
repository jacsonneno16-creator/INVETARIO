// FASE 13: "Indicadores de Recusas" — aba nova, separada de Indicadores de
// Retornos (98-recebimento-retornos-indicadores.js, que continua "geral" e
// intocada). Só entra tratamento==='RECUSA'; a métrica central ("dias
// parado") conta a partir de liberadoParaRecusarEm (carimbado em
// alterarTratamento, 97-recebimento-recusas.js) até a nota entrar em
// FINALIZADO (statusRetornoHistorico) — ou "agora", se ainda aberta.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const codeStatus = fs.readFileSync(path.join(base, '99-recebimento-retornos-status.js'), 'utf8');
const code = fs.readFileSync(path.join(base, '103-recusas-indicadores.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
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
            return true;
          });
          const filtrados = [...registro.entries()].filter(([, data]) => bate(data));
          return { docs: filtrados.map(([id, data]) => ({ id, data: () => data })) };
        },
      });
      return construir([{ campo, op, valor }]);
    },
    _registro: registro,
  };
}

function carregarPagina(recusasIniciais) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas-indicadores"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  const col = mockColecao(recusasIniciais || []);
  win.getDTFirestore = () => ({ collection: () => col });
  win.getDTLojaAtiva = () => 'loja_matriz';
  // PEDIDO AO VIVO (2026-09-11): carregarDados() passou a buscar via
  // Cloud Function (buscarIndicadoresRetornosBigQuery, a mesma que 97/98/
  // 99 já usam) em vez de Firestore direto — o mock abaixo reaproveita o
  // MESMO `col.where()` de sempre, preservando as asserções de filtro por
  // período já escritas nos testes existentes.
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nomeFuncao => async payload => {
    if (nomeFuncao !== 'buscarIndicadoresRetornosBigQuery') throw new Error('função não mockada: ' + nomeFuncao);
    const snap = await col
      .where('criadoEm', '>=', payload.ini + 'T00:00:00.000Z')
      .where('criadoEm', '<=', payload.fim + 'T23:59:59.999Z')
      .get();
    return { data: { recusas: snap.docs.map(d => ({ _id: d.id, ...d.data() })) } };
  } }) }) };
  win.aplicarPermissoesAnalista = () => {};
  // 99-recebimento-recusas-status.js precisa carregar primeiro (mesma
  // ordem do analista.html) — é de lá que vem STATUS_RETORNO_LABELS que
  // 103 usa pra rotular status.
  win.eval(codeStatus);
  win.eval(code);
  return { win, document, col };
}

const AGORA = new Date();
function diasAtras(n) { const d = new Date(AGORA.getTime() - n * 86400000); return d.toISOString(); }

test('carregarDados: só entra tratamento RECUSA, exclui devolução automática e outros tratamentos', async () => {
  const { win } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5) } },
    { id: 'r2', data: { tratamento: 'DEVOLUCAO', criadoEm: diasAtras(5) } },
    { id: 'r3', data: { origem: 'AUTOMATICO', tratamento: 'RECUSA', criadoEm: diasAtras(5) } },
    { id: 'r4', data: { tratamento: '', criadoEm: diasAtras(5) } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const recusas = win._recusasIndicadoresInternals.getRecusas();
  assert.equal(recusas.length, 1);
  assert.equal(recusas[0]._id, 'r1');
});

test('diasParadoDaRecusa: conta a partir de liberadoParaRecusarEm, NUNCA da emissão/criação', async () => {
  const { win } = carregarPagina([]);
  const r = { liberadoParaRecusarEm: diasAtras(10), criadoEm: diasAtras(20), statusRetornoHistorico: [] };
  const dias = win._recusasIndicadoresInternals.diasParadoDaRecusa(r);
  assert.ok(dias >= 9.9 && dias <= 10.1, `esperado ~10 dias (desde liberadoParaRecusarEm), veio ${dias}`);
});

test('diasParadoDaRecusa: sem liberadoParaRecusarEm não dá pra calcular (null, nunca inventa data)', async () => {
  const { win } = carregarPagina([]);
  const r = { criadoEm: diasAtras(20) };
  assert.equal(win._recusasIndicadoresInternals.diasParadoDaRecusa(r), null);
});

test('diasParadoDaRecusa: quando finalizada, para de contar na data do evento FINALIZADO (não continua até agora)', async () => {
  const { win } = carregarPagina([]);
  const r = {
    liberadoParaRecusarEm: diasAtras(15),
    statusRetornoHistorico: [
      { status: 'AGUARD_FISCAL', em: diasAtras(12) },
      { status: 'FINALIZADO', em: diasAtras(5) },
    ],
  };
  const dias = win._recusasIndicadoresInternals.diasParadoDaRecusa(r);
  assert.ok(dias >= 9.9 && dias <= 10.1, `esperado ~10 dias (15-5), veio ${dias}`);
});

test('cenário do pedido ao vivo: emitida dia 1, retornou dia 2, liberada pra recusa só dia 12 (10 dias depois do retorno) — a média conta a partir do dia 12, não do dia 1 nem do dia 2', async () => {
  const emissao = diasAtras(30); // "emitida no dia 1º"
  const retornoFisico = diasAtras(29); // "retornou dia 2" — vira criadoEm do recebimento_recusas
  const liberacao = diasAtras(19); // "ficou parada 10 dias, liberada pra recusa só no dia 11/12"
  const { win } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: retornoFisico, liberadoParaRecusarEm: liberacao, notas: [{ dataEmissao: emissao }], statusRetornoHistorico: [] } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const r = win._recusasIndicadoresInternals.getRecusas()[0];
  const dias = win._recusasIndicadoresInternals.diasParadoDaRecusa(r);
  // liberacao foi há 19 dias, ainda não finalizada — conta até agora (~19d),
  // bem diferente dos ~30d (emissão) ou ~29d (retorno físico) que o cálculo
  // antigo (98-recebimento-retornos-indicadores.js) usaria.
  assert.ok(dias >= 18.9 && dias <= 19.1, `esperado ~19 dias (desde a liberação, não a emissão/retorno), veio ${dias}`);
});

test('kpis: recusa sem liberadoParaRecusarEm entra no total mas fica de fora da média (semLiberacao conta ela)', async () => {
  const { win } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5), liberadoParaRecusarEm: diasAtras(3) } },
    { id: 'r2', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5) } }, // sem liberadoParaRecusarEm — legado
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const k = win._recusasIndicadoresInternals.kpis();
  assert.equal(k.total, 2);
  assert.equal(k.semLiberacao, 1);
  assert.ok(k.mediaDias != null && k.mediaDias >= 2.9 && k.mediaDias <= 3.1, 'média só considera a que tem liberadoParaRecusarEm (~3 dias)');
});

test('kpis: finalizadas x em aberto contam pelo statusRetorno atual', async () => {
  const { win } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5), statusRetorno: 'FINALIZADO' } },
    { id: 'r2', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5), statusRetorno: 'CTE' } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const k = win._recusasIndicadoresInternals.kpis();
  assert.equal(k.finalizadas, 1);
  assert.equal(k.emAberto, 1);
});

test('tela: mostra só recusas, título/descrição deixam claro que é separado da visão geral, e a tabela lista Liberada em / Dias parado', async () => {
  const { win, document } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5), liberadoParaRecusarEm: diasAtras(3), notas: [{ numeroNota: '999', destinatario: 'Mercado X' }] } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-recebimento-recusas-indicadores').innerHTML;
  assert.match(html, /<h2[^>]*>📊 Recusas<\/h2>/);
  assert.match(html, /Tratamento = Recusa/);
  assert.match(html, /999/);
  assert.match(html, /Mercado X/);
  assert.match(html, /Liberada em/);
  assert.match(html, /Dias parado/);
});

// PEDIDO AO VIVO (2026-09-11): "colocar mais duas colunas que vai mostrar
// o box que tá e quantidade de paletes".
test('PEDIDO AO VIVO: tabela mostra as colunas Box e Paletes', async () => {
  const { win, document } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5), liberadoParaRecusarEm: diasAtras(3), box: 'BOX 7', pallets: 3, notas: [{ numeroNota: '999', destinatario: 'Mercado X' }] } },
    { id: 'r2', data: { tratamento: 'RECUSA', criadoEm: diasAtras(4), liberadoParaRecusarEm: diasAtras(2), notas: [{ numeroNota: '888' }] } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-recebimento-recusas-indicadores').innerHTML;
  assert.match(html, /<th>Box<\/th>/);
  assert.match(html, /<th>Paletes<\/th>/);
  assert.match(html, /BOX 7/);
  assert.match(html, />3</); // quantidade de paletes do r1
  const linhaSemBoxPallets = html.split('888')[1];
  assert.match(linhaSemBoxPallets, /<td>—<\/td>\s*<td>—<\/td>/); // sem box/pallets nunca quebra, mostra —
});

test('tela: recusa sem liberadoParaRecusarEm mostra aviso "sem data" na tabela e no KPI, sem travar a renderização', async () => {
  const { win, document } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5), notas: [{ numeroNota: '111' }] } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-recebimento-recusas-indicadores').innerHTML;
  assert.match(html, /sem data/);
  assert.match(html, /SEM DATA DE LIBERAÇÃO/);
});

test('filtro de período usa criadoEm (data do registro), igual às outras telas de indicadores', async () => {
  const { win, document } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: '2026-07-01T10:00:00.000Z', liberadoParaRecusarEm: '2026-07-01T10:00:00.000Z', notas: [{ numeroNota: 'ANTIGA' }] } },
    { id: 'r2', data: { tratamento: 'RECUSA', criadoEm: '2026-09-01T10:00:00.000Z', liberadoParaRecusarEm: '2026-09-01T10:00:00.000Z', notas: [{ numeroNota: 'NOVA' }] } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('recind-periodo-ini').value = '2026-08-01';
  document.getElementById('recind-periodo-ini').dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-recebimento-recusas-indicadores').innerHTML;
  assert.match(html, /NOVA/);
  assert.doesNotMatch(html, /ANTIGA/);
});

test('painel de Status filtra a tabela e os KPIs', async () => {
  const { win, document } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5), liberadoParaRecusarEm: diasAtras(5), statusRetorno: 'CTE', notas: [{ numeroNota: 'A' }] } },
    { id: 'r2', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5), liberadoParaRecusarEm: diasAtras(5), statusRetorno: 'FINALIZADO', notas: [{ numeroNota: 'B' }] } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const chk = [...document.querySelectorAll('[data-recind-painel-valor]')].find(el => el.getAttribute('data-recind-painel-valor') === 'Finalizado');
  assert.ok(chk, 'checkbox de status Finalizado precisa existir (só aparece porque tem dado real com esse status)');
  chk.checked = true;
  chk.dispatchEvent(new win.Event('change', { bubbles: true }));
  const html = document.getElementById('page-recebimento-recusas-indicadores').innerHTML;
  assert.match(html, />B</);
  assert.doesNotMatch(html, />A</);
});

// PEDIDO AO VIVO (2026-09-08): "cada nota tem que gerar uma linha... se
// ela tiver junta e uma for reentrega e a outra for recusa" — um mesmo
// evento de conferência (1 documento) pode ter notas com Tratamento
// diferente. Só a nota classificada Recusa entra aqui, não o evento
// inteiro.
test('evento com 2 notas — só a nota classificada RECUSA entra em Indicadores de Recusas, a outra (Reentrega) fica de fora', async () => {
  const { win } = carregarPagina([
    { id: 'r1', data: { criadoEm: diasAtras(5), notas: [
      { chave: 'CH1', numeroNota: '601', tratamento: 'RECUSA', liberadoParaRecusarEm: diasAtras(5) },
      { chave: 'CH2', numeroNota: '602', tratamento: 'REENTREGA' },
    ] } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const recusas = win._recusasIndicadoresInternals.getRecusas();
  assert.equal(recusas.length, 1, 'só 1 das 2 notas do evento é Recusa');
  assert.equal(recusas[0].notas[0].numeroNota, '601');
});

test('registro antigo (1 nota só) com tratamento RECUSA gravado no DOCUMENTO — continua entrando aqui através do valor herdado pela nota', async () => {
  const { win } = carregarPagina([
    { id: 'r1', data: { tratamento: 'RECUSA', liberadoParaRecusarEm: diasAtras(3), criadoEm: diasAtras(5), notas: [{ chave: 'CH1', numeroNota: '1' }] } },
  ]);
  await win.renderRecusasIndicadores();
  win.document.getElementById('recind-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const recusas = win._recusasIndicadoresInternals.getRecusas();
  assert.equal(recusas.length, 1);
  assert.equal(recusas[0].liberadoParaRecusarEm, diasAtras(3));
});

// PEDIDO AO VIVO (2026-09-11): mesma trava de concorrência já aplicada em
// 97/98/99/104 (BUG AO VIVO REAL achado no log do servidor: navegação
// disparando o render mais de uma vez cria consultas duplicadas).
test('chamadas concorrentes de carregarDados pro MESMO período compartilham a mesma consulta (nunca duplica)', async () => {
  const { win, col } = carregarPagina([{ id: 'r1', data: { tratamento: 'RECUSA', criadoEm: diasAtras(5) } }]);
  let chamadas = 0;
  win.firebase = { app: () => ({ functions: () => ({ httpsCallable: nomeFuncao => async payload => {
    chamadas++;
    const snap = await col.where('criadoEm', '>=', payload.ini + 'T00:00:00.000Z').where('criadoEm', '<=', payload.fim + 'T23:59:59.999Z').get();
    return { data: { recusas: snap.docs.map(d => ({ _id: d.id, ...d.data() })) } };
  } }) }) };
  await win.renderRecusasIndicadores();
  const btn = win.document.getElementById('recind-buscar-periodo');
  btn.click(); btn.click(); btn.click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chamadas, 1, '3 cliques quase simultâneos no mesmo período disparam só 1 consulta');
});
