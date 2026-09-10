'use strict';
/**
 * PEDIDO AO VIVO (2026-08-23, print real do Network do usuário): centenas
 * de páginas voltavam com dado real da BlueSoft, mas se UMA página no meio
 * de uma busca longa batesse no 500 aleatório e genérico que a própria
 * BlueSoft às vezes devolve ("Ocorreu um erro inesperado" — confirmado no
 * corpo real da resposta, não é bug do nosso proxy), _paginarTudo()
 * descartava TUDO que já tinha sido buscado com sucesso até ali. Com
 * centenas de páginas, a chance de nenhuma falhar no meio é quase zero —
 * por isso "funciona muito, mas no final não salva nada". Este arquivo
 * trava o comportamento da correção: _requestBluesoft tenta de novo (até
 * 3 tentativas) só pra falha passageira (429/5xx/rede), e falha na hora
 * pra erro de configuração real (401/400) — tentar de novo não ajudaria.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = path.join(__dirname, '../js/analista');
const servicoCode = fs.readFileSync(path.join(base, '90-bluesoft-service.js'), 'utf8');

// _config() faz um lookup por-loja→global (lojas/{id}/dt_config/... antes de
// cair pro dt_config global) — o mock da loja precisa simular os 2 níveis
// (get + collection), senão .collection() em cima de um objeto sem esse
// método joga um TypeError síncrono que o catch geral de _config() engole
// silenciosamente, virando config vazia (mesma causa raiz já documentada
// nesta sessão pros outros arquivos de teste da BlueSoft).
function mockConfigFs() {
  return { collection: (nome) => {
    if (nome === 'lojas') return { doc: () => ({ get: async () => ({ exists: false }), collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }) };
    return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ token: 'tok', url_hml: 'https://hml.exemplo', ambiente: 'homologacao', timeout: 30 }) }) }) };
  } };
}

function loadServico(fetchMock) {
  const document = { addEventListener: () => {} };
  const window = {
    fetch: fetchMock,
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'idtoken' } }) },
    getDTRawFirestore: () => mockConfigFs(),
    getDTFirestore: () => ({ collection: () => ({ get: async () => ({ docs: [] }) }) }),
    getDTLojaAtiva: () => 'loja1',
  };
  vm.runInNewContext(servicoCode, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, Promise, URLSearchParams, JSON, AbortController, setTimeout, clearTimeout }, { filename: '90-bluesoft-service.js' });
  return window;
}

function respostaJson(status, corpo) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(corpo) };
}

test('500 genérico da BlueSoft (mesmo formato real: type/title/status/erros) é tentado de novo, e no 3º acerto devolve o dado normalmente', async () => {
  let chamadas = 0;
  const w = loadServico(async () => {
    chamadas++;
    if (chamadas < 3) return respostaJson(500, { type: 'about:blank', title: 'Ocorreu um erro inesperado.', status: 500, message: 'Ocorreu um erro inesperado.', erros: [{ mensagem: 'Ocorreu um erro inesperado.' }], validations: {} });
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [{ produtoKey: 1 }] });
  });
  const cfg = await w._bluesoftServiceInternals._config();
  const dados = await w._bluesoftServiceInternals._requestBluesoft('/api/comercial/produtos?currentPage=0', cfg);
  assert.equal(chamadas, 3, 'deveria ter tentado 3 vezes (2 falhas + 1 sucesso)');
  assert.deepEqual(dados.data, [{ produtoKey: 1 }]);
});

test('429 (limite de requisições) também é tentado de novo, não falha na hora', async () => {
  let chamadas = 0;
  const w = loadServico(async () => {
    chamadas++;
    if (chamadas === 1) return respostaJson(429, { erro: 'Limite' });
    return respostaJson(200, { currentPage: 0, pageSize: 200, data: [] });
  });
  const cfg = await w._bluesoftServiceInternals._config();
  const dados = await w._bluesoftServiceInternals._requestBluesoft('/api/comercial/produtos?currentPage=0', cfg);
  assert.equal(chamadas, 2);
  assert.deepEqual(dados.data, []);
});

test('depois de 3 tentativas sem sucesso, desiste e propaga o erro real (não trava esperando pra sempre)', async () => {
  let chamadas = 0;
  const w = loadServico(async () => {
    chamadas++;
    return respostaJson(500, { message: 'Ocorreu um erro inesperado.' });
  });
  const cfg = await w._bluesoftServiceInternals._config();
  await assert.rejects(
    () => w._bluesoftServiceInternals._requestBluesoft('/api/comercial/produtos?currentPage=0', cfg),
    /HTTP 500/
  );
  assert.equal(chamadas, 3, 'no máximo 3 tentativas — não pode ficar tentando pra sempre');
});

test('401 (token inválido) NÃO tenta de novo — é erro de configuração, retry não ajudaria', async () => {
  let chamadas = 0;
  const w = loadServico(async () => {
    chamadas++;
    return respostaJson(401, { erro: 'Token inválido' });
  });
  const cfg = await w._bluesoftServiceInternals._config();
  await assert.rejects(
    () => w._bluesoftServiceInternals._requestBluesoft('/api/comercial/produtos?currentPage=0', cfg),
    /Token inválido ou expirado/
  );
  assert.equal(chamadas, 1, '401 deveria falhar na 1ª tentativa, sem retry');
});

test('PEDIDO AO VIVO CONFIRMADO: quando uma página falha SEMPRE (esgota as 3 tentativas, não só passageiro), a busca não joga fora as outras páginas boas — continua e devolve o que deu certo, com a falha registrada em .falhas', async () => {
  const w = loadServico(async (_url, opts) => {
    const corpoReq = JSON.parse(opts.body);
    const qs = new URLSearchParams(corpoReq.path.split('?')[1] || '');
    const page = Number(qs.get('currentPage'));
    if (page === 1) return respostaJson(500, { type: 'about:blank', title: 'Ocorreu um erro inesperado.', status: 500, message: 'Ocorreu um erro inesperado.', erros: [{ mensagem: 'Ocorreu um erro inesperado.' }], validations: {} });
    const data = page < 3 ? Array.from({ length: 200 }, (_, i) => ({ produtoKey: page * 1000 + i })) : [];
    return respostaJson(200, { currentPage: page, pageSize: 200, data });
  });
  const cfg = await w._bluesoftServiceInternals._config();
  const itens = await w._bluesoftServiceInternals._paginarTudo('/api/comercial/produtos', {}, cfg, item => item.produtoKey);
  assert.equal(itens.length, 400, 'páginas 0 e 2 (boas) precisam ter sido coletadas mesmo com a página 1 quebrada de vez');
  assert.equal(itens.falhas.length, 1, 'a página 1 tem que aparecer registrada como falha, não sumir silenciosamente');
  assert.equal(itens.falhas[0].pagina, 1);
});

test('_paginarTudo: uma falha passageira numa página cheia (200 itens, não é a última) não descarta as OUTRAS páginas do mesmo lote — a retentativa resolve antes de propagar', async () => {
  // Páginas 0 e 1 vêm cheias (200 itens = "tem mais"), página 1 falha uma
  // vez antes de acertar; página 2 vem vazia (sinal real de fim). Sem a
  // retentativa, a falha da página 1 derrubaria o Promise.all inteiro e
  // _buscarProdutosPorTipos jogaria fora as 200 páginas já coletadas com
  // sucesso — exatamente o "funciona muito, mas no final não salva nada"
  // relatado ao vivo.
  let falhouUmaVez = false;
  const w = loadServico(async (_url, opts) => {
    const corpoReq = JSON.parse(opts.body);
    const qs = new URLSearchParams(corpoReq.path.split('?')[1] || '');
    const page = Number(qs.get('currentPage'));
    if (page === 1 && !falhouUmaVez) { falhouUmaVez = true; return respostaJson(500, { type: 'about:blank', title: 'Ocorreu um erro inesperado.', status: 500, message: 'Ocorreu um erro inesperado.', erros: [{ mensagem: 'Ocorreu um erro inesperado.' }], validations: {} }); }
    const data = page < 2 ? Array.from({ length: 200 }, (_, i) => ({ produtoKey: page * 1000 + i })) : [];
    return respostaJson(200, { currentPage: page, pageSize: 200, data });
  });
  const cfg = await w._bluesoftServiceInternals._config();
  const itens = await w._bluesoftServiceInternals._paginarTudo('/api/comercial/produtos', {}, cfg, item => item.produtoKey);
  assert.equal(itens.length, 400, 'as 400 linhas reais (2 páginas cheias) deveriam ter sido coletadas, mesmo com uma falha passageira numa delas');
});
