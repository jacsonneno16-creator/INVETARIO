// PEDIDO AO VIVO (pendência #2, rodada de correção): "importzip" ficava
// em SEM_TELA mostrando "ainda não implementado". Implementado um leitor
// de ZIP PRÓPRIO (95-producao-importzip.js) — sem nenhuma dependência
// externa, usando só formato binário ZIP (DataView) + DecompressionStream
// nativo (a mesma API que qualquer Chrome/Edge atual já tem embutida, e
// que o Node também expõe globalmente — por isso dá pra testar o fluxo
// REAL de ponta a ponta aqui, sem mockar a descompressão).
//
// Este arquivo constrói ZIPs de verdade nos testes (formato binário real,
// função _construirZip abaixo) e dirige o fluxo completo: selecionar →
// ler ZIP → validar → restaurar, contra um Firestore mockado. Os 16
// cenários pedidos:
//  1. ZIP válido                    9. Validação sem gravação
//  2. Extensão inválida            10. Restauração com criação
//  3. ZIP corrompido               11. Restauração com atualização
//  4. ZIP sem JSON                 12. Cancelamento
//  5. JSON inválido                13. Falha parcial de lote
//  6. Backup sem versão            14. Respeito à loja ativa
//  7. Coleção desconhecida         15. Ausência de permissão
//  8. Registro malformado          16. Duplo clique
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Espera por polling em vez de setTimeout fixo — rodando a suíte inteira
// (node --test tests/*.test.js) a máquina fica mais carregada e um atraso
// fixo de poucos ms pode checar o estado ANTES da restauração (que faz
// vários hops de microtask/macrotask entre lotes) realmente terminar.
async function esperarAte(condicaoFn, timeoutMs) {
  const inicio = Date.now();
  while (!condicaoFn()) {
    if (Date.now() - inicio > (timeoutMs || 2000)) throw new Error('esperarAte: tempo esgotado esperando a condição.');
    await new Promise(r => setTimeout(r, 5));
  }
}
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/95-producao-importzip.js'), 'utf8');

// ── Construtor de ZIP real (formato binário ZIP mínimo, STORED ou DEFLATE) ──
function _construirZip(arquivos, opts) {
  opts = opts || {};
  const partesLocais = [];
  const centrais = [];
  let offset = 0;
  for (const { nome, conteudo } of arquivos) {
    const dadosOriginais = Buffer.from(conteudo, 'utf8');
    const usarDeflate = opts.method !== 0;
    const dados = usarDeflate ? zlib.deflateRawSync(dadosOriginais) : dadosOriginais;
    const method = usarDeflate ? 8 : 0;
    const nomeBuf = Buffer.from(nome, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // versão mínima
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10); // hora
    lfh.writeUInt16LE(0, 12); // data
    lfh.writeUInt32LE(0, 14); // crc32 (não verificado pelo leitor)
    lfh.writeUInt32LE(dados.length, 18); // compSize
    lfh.writeUInt32LE(dadosOriginais.length, 22); // uncompSize
    lfh.writeUInt16LE(nomeBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extraLen
    partesLocais.push(lfh, nomeBuf, dados);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(0, 16);
    cdh.writeUInt32LE(dados.length, 20);
    cdh.writeUInt32LE(dadosOriginais.length, 24);
    cdh.writeUInt16LE(nomeBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    centrais.push(Buffer.concat([cdh, nomeBuf]));

    offset += lfh.length + nomeBuf.length + dados.length;
  }
  const localBuf = Buffer.concat(partesLocais);
  const centralBuf = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(arquivos.length, 8);
  eocd.writeUInt16LE(arquivos.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  const zipBuf = Buffer.concat([localBuf, centralBuf, eocd]);
  return zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength);
}

function _backupPadrao(extra) {
  return JSON.stringify(Object.assign({
    versao: 1,
    exportadoEm: '2026-08-20T10:00:00.000Z',
    loja: 'loja-teste',
    colecoes: {
      producao_maquinas: [{ nome: 'ENVASADORA 1', pcMin: 20, status: 'ativa' }],
      producao_produtos: [{ cod: '101', nome: 'Produto A' }],
    },
  }, extra || {}));
}

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, set: async (payload, opts) => { const a = (opts && opts.merge) ? (registro.get(id) || {}) : {}; registro.set(id, { ...a, ...payload }); } }),
    add: async (payload) => { const id = 'novo' + registro.size + '_' + Math.random().toString(36).slice(2, 6); registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}

// Simula um File real (arrayBuffer/name/size) sem depender de Blob do jsdom
function _arquivoFalso(nome, arrayBuffer) {
  return { name: nome, size: arrayBuffer.byteLength, arrayBuffer: async () => arrayBuffer };
}

function carregarPagina(colecoesIniciais, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-producao-importzip"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  // jsdom não expõe TextDecoder/DecompressionStream/Blob/Response no
  // objeto window por padrão — são as MESMAS APIs padrão de qualquer
  // navegador real, só que o Node já as tem globalmente, então usa as
  // implementações reais do Node (spec-compliant) em vez de mockar.
  win.TextDecoder = global.TextDecoder;
  win.TextEncoder = global.TextEncoder;
  win.DecompressionStream = global.DecompressionStream;
  win.Blob = global.Blob;
  win.Response = global.Response;
  const colecoes = {};
  Object.keys(colecoesIniciais || {}).forEach(k => { colecoes[k] = mockColecao(colecoesIniciais[k]); });
  const historico = mockColecao([]);
  win.getDTFirestore = () => ({ collection: (nome) => { if (nome === 'producao_import_historico') return historico; if (!colecoes[nome]) colecoes[nome] = mockColecao([]); return colecoes[nome]; } });
  win.getDTLojaAtiva = () => opts.loja || 'loja-ativa-1';
  win.temPermissao = opts.temPermissao || (() => true);
  win.showToast = () => {};
  win.showConfirm = (msg, executar) => executar();
  win.DTProducao = { registrarInvalidacao: () => {} };
  win.eval(code);
  return { win, document, colecoes, historico };
}

// 1) ZIP válido ──────────────────────────────────────────────────────────
test('1) ZIP válido: lê o backup, mostra a prévia com as coleções e contagens corretas', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: _backupPadrao() }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /Prévia do backup/);
  assert.match(html, /producao_maquinas/);
  assert.match(html, /producao_produtos/);
});

// 2) Extensão inválida ───────────────────────────────────────────────────
test('2) Extensão inválida: rejeita arquivo que não termina em .zip', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.txt', new ArrayBuffer(10)));
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /Extensão inválida/);
});

// 3) ZIP corrompido ──────────────────────────────────────────────────────
test('3) ZIP corrompido: rejeita bytes que não formam um ZIP válido', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const lixo = Buffer.from('isto nao e um zip de verdade, so texto qualquer preenchendo espaco');
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('quebrado.zip', lixo.buffer));
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /não é um ZIP válido|corrompido/);
});

// 4) ZIP sem JSON ────────────────────────────────────────────────────────
test('4) ZIP sem JSON: rejeita ZIP válido que não contém nenhum arquivo .json', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'leia-me.txt', conteudo: 'sem backup aqui' }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('sem-json.zip', buf));
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /Nenhum arquivo \.json/);
});

// 5) JSON inválido ───────────────────────────────────────────────────────
test('5) JSON inválido: rejeita quando o .json dentro do ZIP não parseia', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: '{ isto nao fecha' }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('invalido.zip', buf));
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /não é um JSON válido/);
});

// 6) Backup sem versão ───────────────────────────────────────────────────
test('6) Backup sem versão: validarBackupJson reprova e a tela mostra o erro', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const semVersao = JSON.stringify({ colecoes: { producao_maquinas: [] } });
  const buf = _construirZip([{ nome: 'backup.json', conteudo: semVersao }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('sem-versao.zip', buf));
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /sem campo "versao"/);
});

// 7) Coleção desconhecida ────────────────────────────────────────────────
test('7) Coleção desconhecida: aparece como aviso na prévia e nunca é gravada', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const backup = _backupPadrao({ colecoes: { producao_maquinas: [{ nome: 'M1' }], usuarios_do_sistema: [{ email: 'x@x.com' }] } });
  const buf = _construirZip([{ nome: 'backup.json', conteudo: backup }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('desconhecida.zip', buf));
  let html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /coleção\(ões\) desconhecida\(s\)/);
  assert.match(html, /usuarios_do_sistema/);

  document.querySelector('[data-pzip-restaurar]').click();
  await esperarAte(() => document.getElementById('page-producao-importzip').innerHTML.includes('Resumo da restauração'));
  // nunca deveria ter sido criada uma collection pra "usuarios_do_sistema"
  assert.equal(win.getDTFirestore().collection('usuarios_do_sistema')._registro.size, 0);
});

// 8) Registro malformado ─────────────────────────────────────────────────
test('8) Registro malformado (não é objeto): é ignorado, não trava a importação', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const backup = _backupPadrao({ colecoes: { producao_maquinas: [{ nome: 'M1' }, 'string invalida', 42, null] } });
  const buf = _construirZip([{ nome: 'backup.json', conteudo: backup }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('malformado.zip', buf));
  document.querySelector('[data-pzip-restaurar]').click();
  await esperarAte(() => document.getElementById('page-producao-importzip').innerHTML.includes('Resumo da restauração'));
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /Resumo da restauração/);
  assert.match(html, />1</, 'só o único registro válido deveria contar como criado');
  assert.match(html, />3</, 'os 3 registros malformados deveriam contar como ignorados');
});

// 9) Validação sem gravação ──────────────────────────────────────────────
test('9) Modo "Somente validar": não grava nada no Firestore', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: _backupPadrao() }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  document.querySelector('[data-pzip-validar]').click();
  await esperarAte(() => document.getElementById('page-producao-importzip').innerHTML.includes('nada foi gravado'));
  assert.equal(win.getDTFirestore().collection('producao_maquinas')._registro.size, 0, 'validar não deveria gravar nada');
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /nada foi gravado/);
});

// 10) Restauração com criação ────────────────────────────────────────────
test('10) Restaurar: cria documentos novos quando não existe registro com a mesma chave natural', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: _backupPadrao() }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  document.querySelector('[data-pzip-restaurar]').click();
  await esperarAte(() => document.getElementById('page-producao-importzip').innerHTML.includes('Resumo da restauração'));
  const maquinas = win.getDTFirestore().collection('producao_maquinas');
  assert.equal(maquinas._registro.size, 1);
  const doc = [...maquinas._registro.values()][0];
  assert.equal(doc.nome, 'ENVASADORA 1');
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, />2</); // 2 criados no total (1 máquina + 1 produto, as duas coleções do backup padrão)
});

// 11) Restauração com atualização ────────────────────────────────────────
test('11) Restaurar: ATUALIZA (merge) quando já existe registro com a mesma chave natural (nome)', async () => {
  const { win, document } = carregarPagina({ producao_maquinas: [{ id: 'existente1', data: { nome: 'ENVASADORA 1', pcMin: 5, setor: 'Linha antiga' } }] });
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: _backupPadrao() }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  document.querySelector('[data-pzip-restaurar]').click();
  await esperarAte(() => document.getElementById('page-producao-importzip').innerHTML.includes('Resumo da restauração'));
  const maquinas = win.getDTFirestore().collection('producao_maquinas');
  assert.equal(maquinas._registro.size, 1, 'não deveria duplicar — deveria ATUALIZAR o doc existente');
  const doc = maquinas._registro.get('existente1');
  assert.equal(doc.pcMin, 20, 'pcMin deveria vir do backup (20), não ficar o antigo (5)');
  assert.equal(doc.setor, 'Linha antiga', 'merge:true deveria preservar campos não presentes no backup');
});

// 12) Cancelamento ───────────────────────────────────────────────────────
test('12) Cancelar: volta pro estado inicial sem gravar nada', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: _backupPadrao() }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  assert.match(document.getElementById('page-producao-importzip').innerHTML, /Prévia do backup/);
  document.querySelector('[data-pzip-cancelar]').click();
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.doesNotMatch(html, /Prévia do backup/);
  assert.equal(win.getDTFirestore().collection('producao_maquinas')._registro.size, 0);
});

// 13) Falha parcial de lote ──────────────────────────────────────────────
test('13) Falha parcial: um erro num registro não impede os outros de serem gravados, e aparece no resumo', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const backup = _backupPadrao({ colecoes: { producao_maquinas: [{ nome: 'BOA 1' }, { nome: 'QUEBRA' }, { nome: 'BOA 2' }] } });
  const buf = _construirZip([{ nome: 'backup.json', conteudo: backup }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  // injeta uma falha só pro documento "QUEBRA"
  const colOriginal = win.getDTFirestore().collection('producao_maquinas');
  const addOriginal = colOriginal.add.bind(colOriginal);
  colOriginal.add = async (payload) => { if (payload.nome === 'QUEBRA') throw new Error('Falha simulada de rede'); return addOriginal(payload); };
  document.querySelector('[data-pzip-restaurar]').click();
  await esperarAte(() => document.getElementById('page-producao-importzip').innerHTML.includes('Resumo da restauração'));
  assert.equal(colOriginal._registro.size, 2, 'BOA 1 e BOA 2 deveriam ter sido gravadas mesmo com a falha em QUEBRA');
  const html = document.getElementById('page-producao-importzip').innerHTML;
  assert.match(html, /Falha simulada de rede/);
});

// 14) Respeito à loja ativa ──────────────────────────────────────────────
test('14) Respeita a loja ativa: usa getDTFirestore() (já escopado por loja em todo o app), nunca um caminho fixo', async () => {
  const src = code;
  assert.doesNotMatch(src, /collection\('lojas'\)\.doc\(/, 'não deveria montar o caminho da loja manualmente — usa getDTFirestore() como todo o resto do app');
  assert.match(src, /fs\(\)\.collection\(nomeCol\)/);
  const { win, document } = carregarPagina({});
  let lojaConsultada = null;
  win.getDTLojaAtiva = () => { lojaConsultada = 'loja-ativa-1'; return 'loja-ativa-1'; };
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: _backupPadrao() }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  document.querySelector('[data-pzip-restaurar]').click();
  await esperarAte(() => document.getElementById('page-producao-importzip').innerHTML.includes('Resumo da restauração'));
  assert.equal(lojaConsultada, 'loja-ativa-1');
});

// 15) Ausência de permissão ──────────────────────────────────────────────
test('15) Sem permissão de editar: botão Restaurar fica desabilitado e a restauração é recusada', async () => {
  const { win, document } = carregarPagina({}, { temPermissao: (modulo, acao) => acao !== 'editar' });
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: _backupPadrao() }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  const btn = document.querySelector('[data-pzip-restaurar]');
  assert.equal(btn.hasAttribute('disabled'), true);
  await win._producaoImportZipInternals.restaurar(false);
  assert.equal(win.getDTFirestore().collection('producao_maquinas')._registro.size, 0, 'sem permissão, restaurar() não deveria gravar nada mesmo chamado diretamente');
});

// 16) Duplo clique ───────────────────────────────────────────────────────
test('16) Duplo clique: dois cliques rápidos em Restaurar só executam a importação UMA vez', async () => {
  const { win, document } = carregarPagina({});
  win.renderProducaoImportarZip('page-producao-importzip');
  const buf = _construirZip([{ nome: 'backup.json', conteudo: _backupPadrao() }]);
  await win._producaoImportZipInternals.processarArquivo(_arquivoFalso('backup.zip', buf));
  const btn = document.querySelector('[data-pzip-restaurar]');
  btn.click();
  btn.click(); // segundo clique imediato, antes do primeiro terminar
  await esperarAte(() => document.getElementById('page-producao-importzip').innerHTML.includes('Resumo da restauração'));
  const maquinas = win.getDTFirestore().collection('producao_maquinas');
  assert.equal(maquinas._registro.size, 1, 'duplo clique não deveria duplicar a criação (nem rodar a importação duas vezes)');
});
