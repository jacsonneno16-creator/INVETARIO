// BUG AO VIVO REAL (2026-09-03) — investigação em várias rodadas até achar
// a causa raiz de verdade:
// 1ª rodada: "Falha na última busca: chunk_1 cannot be written because its
//    size (1.084.326 bytes) exceeds 1.048.576 bytes" — TAMANHO_CHUNK=1000
//    só contava notas, nunca olhava bytes reais. Reduzido, ganhou
//    LIMITE_BYTES_CHUNK.
// 2ª/3ª rodada: a falha se repetiu com o MESMO tamanho — reduzir o limite
//    não dividia um pacote que JÁ estava grande demais desde antes.
// Causa raiz de verdade (achada com um relatório de diagnóstico real,
// pedido pelo usuário: "0 notas dentro, mas o documento pesa mais de
// 1MB"): `.set(ref, {'notas.'+chave: valor}, {merge:true})` NUNCA criou o
// mapa aninhado {notas:{chave:valor}} que toda a contagem/limite sempre
// assumiu — criou um campo LITERAL solto "notas.CHAVE" na raiz do
// documento (o ponto é parte do NOME do campo, não um caminho aninhado).
// Por isso todo chunk sempre "parecia" ter 0 notas, então o sistema sempre
// achava que tinha espaço de sobra e foi empilhando pra sempre — desde o
// início do recurso, não só hoje. Consertado: toda escrita de chunk agora
// é lê-modifica-grava (_lerEGravarChunk, sempre `.set()` sem merge com o
// mapa {notas:...} já completo), e a leitura (_notasDoDocumentoChunk) lê
// tanto o formato correto quanto os campos soltos legados, pra nenhuma
// nota antiga sumir. reconstruirTodosOsChunks() reconstrói tudo do zero
// (substituiu os reparos antigos, que tinham o mesmo problema de leitura).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const recusasCode = fs.readFileSync(path.join(base, '97-recebimento-recusas.js'), 'utf8');

const FIRESTORE_DELETE = { __firestoreDelete: true };

function criarColecao(nomeColecao, docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    _nome: nomeColecao,
    _registro: registro,
    get: async () => ({ empty: registro.size === 0, size: registro.size, docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, _colecao: nomeColecao, get: async () => ({ exists: registro.has(id), data: () => registro.get(id) }) }),
  };
}
function _aplicarMergeAninhado(destino, payload) {
  Object.entries(payload).forEach(([chavePath, valor]) => {
    const partes = chavePath.split('.');
    let alvo = destino;
    for (let i = 0; i < partes.length - 1; i++) {
      if (typeof alvo[partes[i]] !== 'object' || alvo[partes[i]] == null) alvo[partes[i]] = {};
      alvo = alvo[partes[i]];
    }
    const folha = partes[partes.length - 1];
    if (valor === FIRESTORE_DELETE) delete alvo[folha];
    else alvo[folha] = valor;
  });
}
function criarRawFirestore(colecoesPorNome) {
  return {
    batch: () => {
      const ops = [];
      return {
        set: (ref, payload, opts) => ops.push({ tipo: 'set', ref, payload, merge: !!opts?.merge }),
        delete: (ref) => ops.push({ tipo: 'delete', ref }),
        commit: async () => {
          ops.forEach(op => {
            const col = colecoesPorNome[op.ref._colecao];
            if (op.tipo === 'delete') { col._registro.delete(op.ref.id); return; }
            const atual = col._registro.get(op.ref.id) || {};
            if (op.merge) _aplicarMergeAninhado(atual, op.payload);
            else { Object.keys(atual).forEach(k => delete atual[k]); Object.assign(atual, op.payload); }
            col._registro.set(op.ref.id, atual);
          });
        },
      };
    },
  };
}

let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(dtBiPastaLocalMock, recusasIniciais) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  const colecoes = {
    recebimento_recusas_notas: criarColecao('recebimento_recusas_notas', []),
    recebimento_recusas_notas_chunks: criarColecao('recebimento_recusas_notas_chunks', []),
    recebimento_recusas: criarColecao('recebimento_recusas', recusasIniciais || []),
    recebimento_recusas_motoristas: criarColecao('recebimento_recusas_motoristas', []),
    recebimento_recusas_motivos: criarColecao('recebimento_recusas_motivos', []),
    recebimento_recusas_conferentes: criarColecao('recebimento_recusas_conferentes', []),
    recebimento_recusas_tarefas_conferencia: criarColecao('recebimento_recusas_tarefas_conferencia', []),
    recebimento_recusas_vendedores_mercado: criarColecao('recebimento_recusas_vendedores_mercado', []),
  };
  win.getDTFirestore = () => ({ collection: (nome) => colecoes[nome] || criarColecao(nome, []) });
  win.getDTRawFirestore = () => criarRawFirestore(colecoes);
  win.firebase = { auth: () => ({ currentUser: { uid: 'u1', email: 'analista@daterrinha.com' } }), firestore: { FieldValue: { delete: () => FIRESTORE_DELETE } } };
  win.showToast = () => {};
  win.aplicarPermissoesAnalista = () => {};
  win.DTBiPastaLocal = dtBiPastaLocalMock || { suportado: () => false };
  win.eval(recusasCode);
  return { win, document, colNotas: colecoes.recebimento_recusas_notas, colChunks: colecoes.recebimento_recusas_notas_chunks };
}

test('_empacotarEmChunks: nota gigante (destinatario/vendedor longos) fecha o chunk por BYTES, bem antes de bater TAMANHO_CHUNK em contagem', () => {
  const { win } = carregarPagina();
  const { TAMANHO_CHUNK, LIMITE_BYTES_CHUNK, _empacotarEmChunks } = win.DTRecusasParser;
  const textao = 'X'.repeat(2000); // ~2KB por nota — bem maior que uma nota típica
  const notas = [];
  const necessarias = Math.ceil(LIMITE_BYTES_CHUNK / 2000) + 5; // certeza de estourar bytes antes de TAMANHO_CHUNK
  assert.ok(necessarias < TAMANHO_CHUNK, 'pré-condição do teste: o estouro precisa vir do limite de bytes, não do de contagem');
  for (let i = 0; i < necessarias; i++) {
    notas.push({ chave: 'N' + String(i).padStart(6, '0'), numeroNota: String(i), destinatario: textao, vendedorNome: '' });
  }
  const { porChunk } = _empacotarEmChunks(notas);
  assert.ok(porChunk.size >= 2, `com notas de ~2KB cada, ${necessarias} notas precisam estourar LIMITE_BYTES_CHUNK e abrir um 2º chunk`);
  porChunk.forEach(mapa => {
    const tamanho = Object.values(mapa).reduce((s, r) => s + win.DTRecusasParser._tamanhoBytesEstimado(r), 0);
    assert.ok(tamanho <= LIMITE_BYTES_CHUNK, `nenhum chunk pode passar de LIMITE_BYTES_CHUNK (ficou ${tamanho})`);
  });
});

test('_empacotarEmChunks: `estado` (contagem/bytes de um chunk já aberto) é respeitado — não reseta pro zero', () => {
  const { win } = carregarPagina();
  const { _empacotarEmChunks, TAMANHO_CHUNK } = win.DTRecusasParser;
  const notas = [{ chave: 'A', numeroNota: '1' }, { chave: 'B', numeroNota: '2' }];
  // chunk 3 já tem TAMANHO_CHUNK-1 notas — só espaço pra mais 1.
  const { porChunk } = _empacotarEmChunks(notas, { chunkInicial: 3, contagemInicial: TAMANHO_CHUNK - 1, bytesInicial: 100 });
  assert.ok(porChunk.get(3)['A'], 'a 1ª ainda cabe no chunk 3 (tinha espaço pra mais 1)');
  assert.ok(porChunk.get(4) && porChunk.get(4)['B'], 'a 2ª já não cabia mais — precisa ir pro chunk 4');
});

test('cenário do bug real: chunk_0 já quase no limite de bytes — importar notas novas abre chunk_1 (não tenta estourar o chunk_0)', async () => {
  const { win, colNotas, colChunks } = carregarPagina({ suportado: () => false });
  const { LIMITE_BYTES_CHUNK } = win.DTRecusasParser;
  // Monta um chunk_0 já perto do limite (não estourado — Firestore só
  // aceita o que já commitou com sucesso antes desta correção existir).
  const textao = 'Y'.repeat(1500);
  const notasExistentes = {};
  const docsIndividuais = [];
  let bytesAcumulados = 0;
  let i = 0;
  while (bytesAcumulados < LIMITE_BYTES_CHUNK - 3000) {
    const chave = 'E' + String(i).padStart(6, '0');
    const resumida = { chave, numeroNota: String(i), destinatario: textao, naturezaLabel: 'Venda' };
    notasExistentes[chave] = resumida;
    docsIndividuais.push({ id: chave, data: { ...resumida, chunkIndex: 0 } });
    bytesAcumulados += win.DTRecusasParser._tamanhoBytesEstimado(resumida);
    i++;
  }
  colChunks._registro.set('chunk_0', { notas: notasExistentes });
  docsIndividuais.forEach(d => colNotas._registro.set(d.id, d.data));

  await win.renderRecebimentoRecusas(); // dispara a leitura dos chunks pra _notas

  const registros = [{ tipo_movimento: 'VENDA', chave: '9'.repeat(44), nf_numero: 9999, nf_serie: '1', cliente: textao, valor_nota: 1, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'A' }];
  await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);

  const novaGravada = colNotas._registro.get('9'.repeat(44));
  assert.ok(novaGravada, 'a nota nova precisa ter sido gravada no doc individual');
  assert.equal(novaGravada.chunkIndex, 1, 'chunk_0 já estava quase cheio (bytes) — a nova precisa ir pro chunk_1, não estourar o chunk_0');
  assert.ok(colChunks._registro.get('chunk_1')?.notas['9'.repeat(44)], 'chunk_1 precisa ter sido criado com a nota nova dentro');
  const bytesChunk0Final = Object.values(colChunks._registro.get('chunk_0').notas).reduce((s, r) => s + win.DTRecusasParser._tamanhoBytesEstimado(r), 0);
  assert.ok(bytesChunk0Final <= LIMITE_BYTES_CHUNK, 'chunk_0 nunca pode passar do limite — é exatamente isso que causava a falha real');
});

test('_notasDoDocumentoChunk: lê tanto o formato correto (aninhado) quanto o campo solto legado ("notas.CHAVE" na raiz) — o sintoma real do bug de origem', () => {
  const { win } = carregarPagina();
  const dados = {
    notas: { A: { chave: 'A', numeroNota: '1' } }, // formato correto
    'notas.B': { chave: 'B', numeroNota: '2' }, // campo solto legado (bug de origem)
    'notas.C': { chave: 'C', numeroNota: '3' },
  };
  const notas = win.DTRecusasParser._notasDoDocumentoChunk(dados);
  assert.deepEqual(Object.keys(notas).sort(), ['A', 'B', 'C']);
  assert.equal(notas.B.numeroNota, '2');
});

test('reconstruirTodosOsChunks: junta notas espalhadas em campos soltos legados + formato correto + órfãs, e reescreve tudo do zero na estrutura certa', async () => {
  const { win, colNotas, colChunks } = carregarPagina();
  // chunk_0 tem 1 nota no formato CORRETO e 1 no formato QUEBRADO (campo
  // solto "notas.B") — exatamente a mistura real encontrada em produção.
  colChunks._registro.set('chunk_0', { notas: { A: { chave: 'A', numeroNota: '1' } }, 'notas.B': { chave: 'B', numeroNota: '2' } });
  colNotas._registro.set('A', { chave: 'A', numeroNota: '1', chunkIndex: 0 });
  colNotas._registro.set('B', { chave: 'B', numeroNota: '2', chunkIndex: 0 });
  // "C" existe só como doc individual — órfã, nenhum chunk sabe dela.
  colNotas._registro.set('C', { chave: 'C', numeroNota: '3', destinatario: 'Órfã de verdade', chunkIndex: 0 });

  const resultado = await win.DTRecusasParser.reconstruirTodosOsChunks();
  assert.equal(resultado.totalNotas, 3);
  assert.equal(resultado.orfasEncontradas, 1);

  const chunk0Depois = colChunks._registro.get('chunk_0');
  assert.ok(chunk0Depois, 'chunk_0 continua existindo (é o único índice necessário pra 3 notas)');
  assert.deepEqual(Object.keys(chunk0Depois.notas).sort(), ['A', 'B', 'C'], 'as 3 notas (incluindo a que estava em campo solto e a órfã) ficam juntas, no formato certo');
  assert.equal(Object.keys(chunk0Depois).filter(k => k.startsWith('notas.')).length, 0, 'nenhum campo solto sobra depois da reconstrução');
});

test('reconstruirTodosOsChunks: pacote grande demais é dividido em vários pacotes menores', async () => {
  const { win, colNotas, colChunks } = carregarPagina();
  const { TAMANHO_CHUNK } = win.DTRecusasParser;
  const notasGrandesDemais = {};
  const excedente = 150;
  for (let i = 0; i < TAMANHO_CHUNK + excedente; i++) {
    const chave = 'G' + String(i).padStart(6, '0');
    notasGrandesDemais[chave] = { chave, numeroNota: String(i) };
    colNotas._registro.set(chave, { chave, numeroNota: String(i), chunkIndex: 0 });
  }
  colChunks._registro.set('chunk_0', { notas: notasGrandesDemais });

  const resultado = await win.DTRecusasParser.reconstruirTodosOsChunks();
  assert.equal(resultado.totalNotas, TAMANHO_CHUNK + excedente);
  assert.equal(resultado.totalChunks, 2, 'precisa de 2 pacotes pra caber tudo dentro do limite');

  const chunk0Depois = colChunks._registro.get('chunk_0');
  const chunk1Depois = colChunks._registro.get('chunk_1');
  assert.equal(Object.keys(chunk0Depois.notas).length, TAMANHO_CHUNK);
  assert.equal(Object.keys(chunk1Depois.notas).length, excedente);
  const chaveMovida = Object.keys(chunk1Depois.notas)[0];
  assert.equal(colNotas._registro.get(chaveMovida).chunkIndex, 1, 'chunkIndex do doc individual bate com o pacote novo');
});

test('reconstruirTodosOsChunks: sobra de pacote antigo (índice que não é mais necessário depois da reconstrução) é removida', async () => {
  const { win, colNotas, colChunks } = carregarPagina();
  // 3 pacotes pequenos que juntos cabem tudo num só depois de reconstruir.
  colChunks._registro.set('chunk_0', { notas: { A: { chave: 'A', numeroNota: '1' } } });
  colChunks._registro.set('chunk_1', { notas: { B: { chave: 'B', numeroNota: '2' } } });
  colChunks._registro.set('chunk_2', { notas: { C: { chave: 'C', numeroNota: '3' } } });
  colNotas._registro.set('A', { chave: 'A', chunkIndex: 0 });
  colNotas._registro.set('B', { chave: 'B', chunkIndex: 1 });
  colNotas._registro.set('C', { chave: 'C', chunkIndex: 2 });

  const resultado = await win.DTRecusasParser.reconstruirTodosOsChunks();
  assert.equal(resultado.totalChunks, 1, 'só 1 pacote é necessário pra 3 notas pequenas');
  assert.equal(resultado.chunksRemovidos, 2, 'os outros 2 índices que sobraram são removidos');
  assert.ok(!colChunks._registro.has('chunk_1'));
  assert.ok(!colChunks._registro.has('chunk_2'));
  assert.deepEqual(Object.keys(colChunks._registro.get('chunk_0').notas).sort(), ['A', 'B', 'C']);
});

// PEDIDO AO VIVO (2026-09-08): botão "Reconstruir pacotes" (e "Corrigir
// GTIN/DUN"/"Ver tamanho dos pacotes") removidos da tela de Notas
// Retornadas — eram ferramentas de manutenção pontuais, não uma ação do
// dia a dia do Analista. As funções continuam existindo e testáveis via
// DTRecusasParser (ferramenta de bastidor, chamável pelo console se algum
// dia for necessário reconstruir os pacotes de novo).
test('reconstruirTodosOsChunks continua acessível via DTRecusasParser mesmo sem botão na tela', async () => {
  const { win, colNotas, colChunks } = carregarPagina({ suportado: () => false });
  colChunks._registro.set('chunk_0', { notas: {} });
  colNotas._registro.set('B', { chave: 'B', numeroNota: '2', chunkIndex: 0 });
  await win.renderRecebimentoRecusas();

  const resultado = await win.DTRecusasParser.reconstruirTodosOsChunks();

  assert.equal(resultado.totalNotas, 1);
  const btn = win.document.querySelector('[data-recusa-reconstruir-chunks]');
  assert.equal(btn, null, 'botão não aparece mais na tela');
});

// PEDIDO AO VIVO (2026-09-03, pergunta certeira do usuário depois de vários
// consertos que não seguravam): "se não foi recebida, ela tem que apagar...
// senão só vai juntando nota lixo." Gravar as notas NOVAS e REMOVER as que
// saíram de "em aberto" são 2 passos independentes em _gravarNotasVenda,
// mas viviam um atrás do outro sem try/catch — um erro no 1º (gravar)
// subia direto e o 2º (remover) NUNCA rodava, deixando "nota lixo" se
// acumular pra sempre.
test('_gravarNotasVenda (via _importarNotasVendaBiRegistros): erro ao GRAVAR no chunk NÃO pode impedir a LIMPEZA de rodar — nota que saiu de "em aberto" precisa ser removida mesmo com falha', async () => {
  const { win, colNotas, colChunks } = carregarPagina();
  colChunks._registro.set('chunk_0', { notas: { LIXO: { chave: 'LIXO', numeroNota: '1', origemImportacao: 'BI', naturezaLabel: 'Venda' } } });
  colNotas._registro.set('LIXO', { chave: 'LIXO', numeroNota: '1', origemImportacao: 'BI', naturezaLabel: 'Venda', chunkIndex: 0 });
  await win.renderRecebimentoRecusas();

  // Simula a escrita no PACOTE (chunk) falhando, como se o Firestore
  // tivesse recusado por estourar 1MB — identifica pelo alvo da escrita
  // (não pela ordem das chamadas, que mudou com o read-modify-write).
  const getRawOriginal = win.getDTRawFirestore;
  win.getDTRawFirestore = () => {
    const real = getRawOriginal();
    const batchOriginal = real.batch.bind(real);
    real.batch = () => {
      const b = batchOriginal();
      let tocaChunk = false;
      return {
        set: (ref, payload, opts) => { if (ref._colecao === 'recebimento_recusas_notas_chunks') tocaChunk = true; return b.set(ref, payload, opts); },
        delete: (ref) => b.delete(ref),
        commit: async () => { if (tocaChunk) throw new Error('Simulado: chunk estourou 1MB'); return b.commit(); },
      };
    };
    return real;
  };

  const registros = [{ tipo_movimento: 'VENDA', chave: 'NOVA', nf_numero: '2', nf_serie: '1', cliente: 'X', data_emissao: '2026-08-12', valor_nota: 1, quantidade_faturada: 1, produto_key: 1, produto: 'Y' }];
  await assert.rejects(() => win.DTRecusasParser._importarNotasVendaBiRegistros(registros), /Simulado/, 'a falha ainda precisa ser relatada — só não pode BLOQUEAR a limpeza');

  assert.ok(!colNotas._registro.has('LIXO'), 'mesmo com erro ao gravar no pacote, a nota que saiu de "em aberto" precisa ter sido removida do doc individual');
});
