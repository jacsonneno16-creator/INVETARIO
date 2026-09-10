// PEDIDO AO VIVO (2026-08-27): "deixa tudo via API lá, como as pastas está
// tudo na API, deixa tudo lá" — depois de confirmar ao vivo (curl real
// contra login.microsoftonline.com + Microsoft Graph, 14 arquivos
// encontrados no SharePoint) que a Cloud Function buscarArquivoBiGraphApi
// funciona, a pasta local sincronizada (File System Access API, IndexedDB)
// foi abandonada de vez como fonte de dados. bi-pasta-local.js virou um
// wrapper fino em cima dessa function — suportado()/status()/conectar()
// viraram no-ops que sempre dizem "tudo certo" (só pra não precisar
// reescrever as 5 telas que já chamavam esse fluxo); só lerJson() faz
// algo de verdade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const codigo = fs.readFileSync(path.join(__dirname, '../js/analista/bi-pasta-local.js'), 'utf8');

function carregarModulo(firebaseMock) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  if (firebaseMock !== undefined) win.firebase = firebaseMock;
  win.eval(codigo);
  return win;
}

test('suportado(): false quando o firebase ainda não carregou nesta página', () => {
  const win = carregarModulo(undefined);
  assert.equal(win.DTBiPastaLocal.suportado(), false);
});

test('suportado(): true quando firebase.app já existe (funciona em qualquer navegador agora, não depende mais de File System Access API)', () => {
  const win = carregarModulo({ app: () => ({}) });
  assert.equal(win.DTBiPastaLocal.suportado(), true);
});

test('status(): "sem-suporte" sem firebase, "conectado" com firebase — nunca mais "nao-conectado" (não existe mais conexão de pasta)', async () => {
  const semFirebase = carregarModulo(undefined);
  assert.equal(await semFirebase.DTBiPastaLocal.status(), 'sem-suporte');
  const comFirebase = carregarModulo({ app: () => ({}) });
  assert.equal(await comFirebase.DTBiPastaLocal.status(), 'conectado');
});

test('conectar(): sempre resolve ok (não existe mais nada pra conectar — a API não pede permissão de arquivo)', async () => {
  const win = carregarModulo({ app: () => ({}) });
  const resultado = await win.DTBiPastaLocal.conectar();
  assert.equal(JSON.stringify(resultado), JSON.stringify({ ok: true }));
});

test('lerJson(): sem firebase carregado, lança erro pedindo pra recarregar a página', async () => {
  const win = carregarModulo(undefined);
  await assert.rejects(() => win.DTBiPastaLocal.lerJson('notas_fiscais_jacson.json'), /Firebase ainda não carregou/);
});

test('lerJson(): chama a Cloud Function buscarArquivoBiGraphApi na região southamerica-east1, com o nome do arquivo', async () => {
  let regiaoUsada = '', nomeFuncaoUsada = '', argumentoEnviado = null;
  const win = carregarModulo({
    app: () => ({
      functions: (regiao) => { regiaoUsada = regiao; return { httpsCallable: (nome) => { nomeFuncaoUsada = nome; return async (arg) => { argumentoEnviado = arg; return { data: { ok: true, dados: [{ chave: '1' }] } }; }; } }; },
    }),
  });
  const resultado = await win.DTBiPastaLocal.lerJson('ficha_tecnica.json');
  assert.equal(regiaoUsada, 'southamerica-east1');
  assert.equal(nomeFuncaoUsada, 'buscarArquivoBiGraphApi');
  assert.equal(JSON.stringify(argumentoEnviado), JSON.stringify({ arquivo: 'ficha_tecnica.json' }));
  assert.equal(JSON.stringify(resultado), JSON.stringify([{ chave: '1' }]));
});

test('lerJson(): a function respondeu ok:false — lança erro em vez de devolver lixo', async () => {
  const win = carregarModulo({ app: () => ({ functions: () => ({ httpsCallable: () => async () => ({ data: { ok: false } }) }) }) });
  await assert.rejects(() => win.DTBiPastaLocal.lerJson('valor_insumos.json'), /Resposta inesperada da API do BI/);
});

test('lerJson(): a Cloud Function lança erro (ex.: permissão negada, arquivo não encontrado) — propaga direto pra quem chamou', async () => {
  const win = carregarModulo({ app: () => ({ functions: () => ({ httpsCallable: () => async () => { throw new Error('Seu login não pode buscar arquivos do BI.'); } }) }) });
  await assert.rejects(() => win.DTBiPastaLocal.lerJson('compras_produto.json'), /Seu login não pode buscar arquivos do BI/);
});
