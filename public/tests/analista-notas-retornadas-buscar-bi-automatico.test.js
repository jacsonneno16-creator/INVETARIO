// PEDIDO AO VIVO (2026-08-27): reforma grande — Notas Retornadas virou o
// LEDGER de VENDA (importado do BI), não mais devolução (isso foi pra
// 100-consulta-notas-fiscais.js). Também "pode tirar a api bluesoft" e
// "deixa só o buscar do BI" — sem seletor de arquivo manual, sem
// preview/revisão: "Buscar" grava direto, mesmo padrão de Ficha Técnica/
// Agenda. E depois: "tem como colocar em chunks de 1000... pra não gerar
// tanta leitura" — o Coletor continua lendo recebimento_recusas_notas
// documento-por-nota (não pode mudar, é o que ele bipa no caminhão), mas o
// Analista passou a ler de uma cópia resumida empacotada em
// recebimento_recusas_notas_chunks (poucos documentos, cada um com até
// 1000 notas dentro). O mock abaixo simula um Firestore de verdade o
// bastante pra isso: merge com caminho aninhado ("notas.CHAVE") e
// FieldValue.delete() pra remover só uma chave do mapa sem apagar as
// outras.
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
    doc: (id) => ({
      id, _colecao: nomeColecao,
      get: async () => ({ exists: registro.has(id), data: () => registro.get(id) }),
      update: async (payload) => { const atual = registro.get(id); if (atual) Object.assign(atual, payload); },
    }),
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

// desenhar() (97-recebimento-recusas.js) agenda um setInterval de auto-
// refresh a cada render — timer real em jsdom, que precisa ser derrubado
// com window.close() ou o node --test nunca sai sozinho.
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
  win.DTBiPastaLocal = dtBiPastaLocalMock;
  win.eval(recusasCode);
  return { win, document, colNotas: colecoes.recebimento_recusas_notas, colChunks: colecoes.recebimento_recusas_notas_chunks, colRecusas: colecoes.recebimento_recusas };
}

test('botão "Buscar" aparece quando DTBiPastaLocal.suportado() é true, sem nenhum seletor de arquivo manual', async () => {
  const { win, document } = carregarPagina({ suportado: () => true, status: async () => 'nao-conectado', conectar: async () => ({ ok: true }), lerJson: async () => [] });
  await win.renderRecebimentoRecusas();
  const html = document.getElementById('page-recebimento-recusas').innerHTML;
  assert.match(html, /data-recusa-buscar-bi="1">📊 Buscar</);
  assert.doesNotMatch(html, /type="file"/, 'não pode existir mais nenhum seletor de arquivo manual — só o botão Buscar');
});

test('botão "Buscar" NÃO aparece quando o navegador não suporta (Firefox/Safari)', async () => {
  const { win, document } = carregarPagina({ suportado: () => false });
  await win.renderRecebimentoRecusas();
  assert.doesNotMatch(document.getElementById('page-recebimento-recusas').innerHTML, /data-recusa-buscar-bi/);
});

test('clicar em "Buscar" já conectado: lê notas_fiscais_jacson.json, filtra só VENDA e grava direto (sem preview/revisão), no doc individual E no chunk', async () => {
  let conectarChamado = false;
  const registros = [
    { tipo_movimento: 'VENDA', nf_numero: 1, nf_serie: '1', cliente: 'Mercado A', valor_nota: 10, data_emissao: '2026-06-01', quantidade_faturada: 1, produto: 'X', vendedor: 'João', supervisor: 'Pedro', chave: '1'.repeat(44) },
    { tipo_movimento: 'DEVOLUCAO', nf_numero: 2, nf_serie: '1', cliente: 'Mercado B', valor_nota: 5, data_emissao: '2026-06-01', quantidade_faturada: 1, produto: 'Y', chave: '2'.repeat(44) },
  ];
  const { win, colNotas, colChunks } = carregarPagina({
    suportado: () => true, status: async () => 'conectado',
    conectar: async () => { conectarChamado = true; return { ok: true }; },
    lerJson: async (nome) => { assert.equal(nome, 'notas_fiscais_jacson.json'); return registros; },
  });
  await win.renderRecebimentoRecusas();
  await win.DTRecusasParser.buscarBiAutomatico();
  assert.equal(conectarChamado, false, 'já estava conectado — não devia pedir conexão de novo');
  assert.equal(colNotas._registro.size, 1, 'só a linha de VENDA deve ser gravada no doc individual (pro Coletor)');
  const gravada = colNotas._registro.get('1'.repeat(44));
  assert.equal(gravada.naturezaLabel, 'Venda');
  assert.equal(gravada.pareceDevolucao, false);
  assert.equal(gravada.tipoOperacao, 'SAIDA');
  assert.equal(gravada.vendedorNome, 'João');
  assert.equal(gravada.chunkIndex, 0, 'primeira nota importada cai no chunk 0');
  assert.equal(colNotas._registro.has('2'.repeat(44)), false, 'devolução não vai pra este ledger');
  assert.equal(colChunks._registro.size, 1, 'exatamente 1 documento de chunk');
  const chunk0 = colChunks._registro.get('chunk_0');
  assert.ok(chunk0.notas['1'.repeat(44)], 'a nota tem que estar no mapa do chunk também');
  assert.equal(chunk0.notas['1'.repeat(44)].vendedorNome, 'João');
  assert.equal('itens' in chunk0.notas['1'.repeat(44)], false, 'o chunk (lido pelo Analista) não guarda itens — só o doc individual (pro Coletor)');
});

test('clicar em "Buscar" sem conectar ainda: conecta primeiro e depois lê', async () => {
  const ordem = [];
  const { win } = carregarPagina({
    suportado: () => true, status: async () => 'nao-conectado',
    conectar: async () => { ordem.push('conectar'); return { ok: true }; },
    lerJson: async () => { ordem.push('lerJson'); return []; },
  });
  await win.renderRecebimentoRecusas();
  await win.DTRecusasParser.buscarBiAutomatico();
  assert.deepEqual(ordem, ['conectar', 'lerJson']);
});

test('conexão recusada/cancelada: mostra o erro e não trava', async () => {
  const { win } = carregarPagina({
    suportado: () => true, status: async () => 'nao-conectado',
    conectar: async () => ({ ok: false, erro: 'Seleção cancelada.' }),
    lerJson: async () => { throw new Error('não deveria ser chamado'); },
  });
  let toastMsg = '';
  win.showToast = (msg) => { toastMsg = msg; };
  await win.renderRecebimentoRecusas();
  await win.DTRecusasParser.buscarBiAutomatico();
  assert.equal(toastMsg, 'Seleção cancelada.');
});

test('_importarNotasVendaBiRegistros: agrupa por chave e soma valorTotal (venda com 2 itens)', async () => {
  const { win, colNotas } = carregarPagina({ suportado: () => false });
  const registros = [
    { tipo_movimento: 'VENDA', chave: '9'.repeat(44), nf_numero: 1, cliente: 'X', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'A' },
    { tipo_movimento: 'VENDA', chave: '9'.repeat(44), nf_numero: 1, cliente: 'X', valor_nota: 20, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'B' },
  ];
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);
  assert.equal(resultado.totalNotas, 1);
  assert.equal(resultado.totalLinhas, 2);
  assert.equal(colNotas._registro.get('9'.repeat(44)).valorTotal, 30);
});

test('_importarNotasVendaBiRegistros: PEDIDO AO VIVO "se sumiu, é pra excluir" — venda que não veio mais na busca (não tá mais em aberto) é removida do doc individual E do chunk', async () => {
  const { win, colNotas, colChunks } = carregarPagina({ suportado: () => false });
  colNotas._registro.set('1'.repeat(44), { chave: '1'.repeat(44), naturezaLabel: 'Venda', origemImportacao: 'BI', destinatario: 'Sumiu' });
  colNotas._registro.set('2'.repeat(44), { chave: '2'.repeat(44), naturezaLabel: 'Venda', origemImportacao: 'BI', destinatario: 'Continua' });
  await win.renderRecebimentoRecusas(); // dispara a migração automática (docs individuais sem chunkIndex) pros chunks
  // A migração roda em segundo plano (nunca bloqueia o render, ver BUG AO
  // VIVO REAL 2026-09-10 no comentário de _carregarCadastrosRecusas) —
  // aguarda ela terminar de verdade antes de checar o resultado.
  await win.DTRecusasParser._carregarNotasVendaLedger();
  assert.equal(colChunks._registro.get('chunk_0').notas['1'.repeat(44)].destinatario, 'Sumiu', 'migração já deve ter empacotado as 2 notas existentes');
  const registros = [{ tipo_movimento: 'VENDA', chave: '2'.repeat(44), nf_numero: 2, cliente: 'Continua', valor_nota: 20, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'B' }];
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);
  assert.equal(resultado.totalRemovidas, 1, 'a que sumiu (não veio mais) deve ser removida');
  assert.equal(colNotas._registro.has('1'.repeat(44)), false, 'removida de verdade do doc individual');
  assert.equal(colNotas._registro.has('2'.repeat(44)), true, 'a que continua em aberto permanece');
  assert.equal('1'.repeat(44) in colChunks._registro.get('chunk_0').notas, false, 'e removida do chunk também, sem apagar a outra chave do mesmo pacote');
  assert.ok(colChunks._registro.get('chunk_0').notas['2'.repeat(44)], 'a chave que continua não pode ter sumido do chunk');
});

test('_importarNotasVendaBiRegistros: venda que sumiu MAS já foi recebida pelo Coletor NUNCA é removida (alimenta indicadores)', async () => {
  const { win, colNotas } = carregarPagina({ suportado: () => false }, [{ id: 'r1', data: { chaves: ['1'.repeat(44)] } }]);
  colNotas._registro.set('1'.repeat(44), { chave: '1'.repeat(44), naturezaLabel: 'Venda', origemImportacao: 'BI', destinatario: 'Já recebida' });
  await win.renderRecebimentoRecusas();
  const registros = [{ tipo_movimento: 'VENDA', chave: '9'.repeat(44), nf_numero: 9, cliente: 'Outra', valor_nota: 1, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'X' }];
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);
  assert.equal(resultado.totalRemovidas, 0);
  assert.equal(colNotas._registro.has('1'.repeat(44)), true, 'já foi recebida pelo Coletor — nunca apaga, mesmo sumindo da busca');
});

test('_importarNotasVendaBiRegistros: busca vazia NUNCA remove nada (proteção contra falha/leitura parcial)', async () => {
  const { win, colNotas } = carregarPagina({ suportado: () => false });
  colNotas._registro.set('1'.repeat(44), { chave: '1'.repeat(44), naturezaLabel: 'Venda', origemImportacao: 'BI', destinatario: 'Não pode sumir' });
  await win.renderRecebimentoRecusas();
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros([]);
  assert.equal(resultado.totalRemovidas, 0);
  assert.equal(colNotas._registro.has('1'.repeat(44)), true, 'busca vazia não pode apagar a base inteira');
});

test('_importarNotasVendaBiRegistros: PEDIDO AO VIVO "se já existe, então pula" — nota já gravada não é reescrita, nem conta como nova', async () => {
  const { win, colNotas } = carregarPagina({ suportado: () => false });
  colNotas._registro.set('1'.repeat(44), { chave: '1'.repeat(44), naturezaLabel: 'Venda', valorTotal: 999 });
  await win.renderRecebimentoRecusas(); // carrega _notas com o que já existe (via migração), antes da busca
  const registros = [
    { tipo_movimento: 'VENDA', chave: '1'.repeat(44), nf_numero: 1, cliente: 'Já existia', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'A' },
    { tipo_movimento: 'VENDA', chave: '2'.repeat(44), nf_numero: 2, cliente: 'Nova', valor_nota: 20, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'B' },
  ];
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);
  assert.equal(resultado.totalEncontradas, 2, 'encontrou as 2 no arquivo');
  assert.equal(resultado.totalNotas, 1, 'só 1 é realmente nova — a outra já existia e foi pulada');
  assert.equal(colNotas._registro.get('1'.repeat(44)).valorTotal, 999, 'não reescreveu a que já existia');
  assert.equal(colNotas._registro.get('2'.repeat(44)).destinatario, 'Nova');
});

test('PEDIDO AO VIVO "chunks de 1000 ou até de mais": migração automática empacota notas antigas (importadas antes de existir chunk) na primeira leitura', async () => {
  const { win, colNotas, colChunks } = carregarPagina({ suportado: () => false });
  colNotas._registro.set('1'.repeat(44), { chave: '1'.repeat(44), naturezaLabel: 'Venda', destinatario: 'Antiga 1' });
  colNotas._registro.set('2'.repeat(44), { chave: '2'.repeat(44), naturezaLabel: 'Venda', destinatario: 'Antiga 2' });
  assert.equal(colChunks._registro.size, 0, 'ainda não migrou nada');
  await win.renderRecebimentoRecusas();
  await win.DTRecusasParser._carregarNotasVendaLedger(); // migração roda em segundo plano — espera terminar
  assert.equal(colChunks._registro.size, 1, 'as 2 notas antigas couberam num chunk só');
  const chunk0 = colChunks._registro.get('chunk_0');
  assert.equal(Object.keys(chunk0.notas).length, 2);
  assert.equal(colNotas._registro.get('1'.repeat(44)).chunkIndex, 0, 'doc individual ganhou o chunkIndex de volta, pra remoção futura saber de onde tirar');
});

test('chunk cheio (TAMANHO_CHUNK atingido): a próxima nota nova abre um chunk_1 novo, sem estourar o chunk_0', async () => {
  const { win, colNotas, colChunks } = carregarPagina({ suportado: () => false });
  // Simula um chunk_0 já cheio (1000 notas) — sem precisar gerar 1000 chaves de 44 dígitos de verdade, já que a contagem só olha pro chunkIndex em memória.
  const notasCheias = {};
  for (let i = 0; i < 1000; i++) { const chave = 'X'.repeat(40) + String(i).padStart(4, '0'); colNotas._registro.set(chave, { chave, naturezaLabel: 'Venda', chunkIndex: 0 }); notasCheias[chave] = { chave }; }
  colChunks._registro.set('chunk_0', { notas: notasCheias });
  await win.renderRecebimentoRecusas();
  const registros = [{ tipo_movimento: 'VENDA', chave: '9'.repeat(44), nf_numero: 1, cliente: 'Nova', valor_nota: 1, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'A' }];
  await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);
  assert.equal(colNotas._registro.get('9'.repeat(44)).chunkIndex, 1, 'chunk_0 já estava cheio (1000) — a nova precisa ir pro chunk_1');
  assert.ok(colChunks._registro.get('chunk_1')?.notas['9'.repeat(44)], 'chunk_1 tem que ter sido criado com a nota nova');
  assert.equal(Object.keys(colChunks._registro.get('chunk_0').notas).length, 1000, 'chunk_0 continua com as 1000 originais, intocado');
});

// PEDIDO AO VIVO (2026-09-04): "essas são notas recebidas que ainda não
// estavam no banco... agora atualizei, as informações vieram menos o
// volume" — quando o Coletor recebe uma nota MANUAL_SEM_BANCO (chave
// ausente do banco na hora), o recebimento_recusas grava volumeEsperado:0
// pra sempre. Depois que o BI traz a nota de verdade (com itens/
// quantidade), a sincronização de venda tem que corrigir esse 0 sozinha,
// sem nenhum clique do Analista.
test('_corrigirVolumeEsperadoRecusas: nota recebida com volumeEsperado 0 (banco não tinha o registro na hora) é corrigida quando a busca do BI traz os itens de verdade — soma as quantidades (5+7=12), corrige a diferença e o status', async () => {
  const recusaExistente = {
    id: 'r1',
    data: {
      chaves: ['1'.repeat(44)],
      notas: [{ chave: '1'.repeat(44), numeroNota: '100', volumeEsperado: 0, destinatario: '' }],
      volumeEsperado: 0, volumeInformado: 12, diferencaVolumes: 12, conferenciaStatus: 'DIVERGENTE',
    },
  };
  const { win, colNotas, colRecusas } = carregarPagina({ suportado: () => false }, [recusaExistente]);
  await win.renderRecebimentoRecusas();
  const registros = [
    { tipo_movimento: 'VENDA', chave: '1'.repeat(44), nf_numero: 100, cliente: 'X', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 5, produto: 'A' },
    { tipo_movimento: 'VENDA', chave: '1'.repeat(44), nf_numero: 100, cliente: 'X', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 7, produto: 'B' },
  ];
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);
  assert.equal(resultado.volumesCorrigidos, 1);
  assert.equal(colNotas._registro.get('1'.repeat(44)).valorTotal, 20, 'a venda em si foi gravada normalmente');
  const gravado = colRecusas._registro.get('r1');
  assert.equal(gravado.notas[0].volumeEsperado, 12, 'a nota individual dentro do recebimento ganhou o esperado real (5+7)');
  assert.equal(gravado.volumeEsperado, 12, 'o total do recebimento também foi recalculado');
  assert.equal(gravado.diferencaVolumes, 0, '12 informado - 12 esperado = 0');
  assert.equal(gravado.conferenciaStatus, 'CONFERIDO', 'não é mais divergente depois da correção');
});

test('_corrigirVolumeEsperadoRecusas: notas com volumeEsperado já preenchido (>0) NUNCA são sobrescritas', async () => {
  const recusaExistente = {
    id: 'r1',
    data: {
      chaves: ['1'.repeat(44)],
      notas: [{ chave: '1'.repeat(44), numeroNota: '100', volumeEsperado: 999, destinatario: '' }],
      volumeEsperado: 999, volumeInformado: 12, diferencaVolumes: -987, conferenciaStatus: 'DIVERGENTE',
    },
  };
  const { win } = carregarPagina({ suportado: () => false }, [recusaExistente]);
  await win.renderRecebimentoRecusas();
  const registros = [{ tipo_movimento: 'VENDA', chave: '1'.repeat(44), nf_numero: 100, cliente: 'X', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 5, produto: 'A' }];
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);
  assert.equal(resultado.volumesCorrigidos, 0, 'já tinha um esperado real (999) — não pode ser mexido, mesmo divergente');
});

test('_corrigirVolumeEsperadoRecusas: chave ainda NÃO apareceu nesta busca do BI — continua 0, sem erro, aguardando a próxima sincronização', async () => {
  const recusaExistente = {
    id: 'r1',
    data: { chaves: ['1'.repeat(44)], notas: [{ chave: '1'.repeat(44), numeroNota: '100', volumeEsperado: 0 }], volumeEsperado: 0, volumeInformado: 12, diferencaVolumes: 12, conferenciaStatus: 'DIVERGENTE' },
  };
  const { win } = carregarPagina({ suportado: () => false }, [recusaExistente]);
  await win.renderRecebimentoRecusas();
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros([]);
  assert.equal(resultado.volumesCorrigidos, 0);
});

test('_corrigirVolumeEsperadoRecusas: recebimento com VÁRIAS notas corrige só a que estava zerada, soma o total certo', async () => {
  const recusaExistente = {
    id: 'r1',
    data: {
      chaves: ['1'.repeat(44), '2'.repeat(44)],
      notas: [
        { chave: '1'.repeat(44), numeroNota: '100', volumeEsperado: 8, destinatario: '' },
        { chave: '2'.repeat(44), numeroNota: '200', volumeEsperado: 0, destinatario: '' },
      ],
      volumeEsperado: 8, volumeInformado: 20, diferencaVolumes: 12, conferenciaStatus: 'DIVERGENTE',
    },
  };
  const { win } = carregarPagina({ suportado: () => false }, [recusaExistente]);
  await win.renderRecebimentoRecusas();
  const registros = [{ tipo_movimento: 'VENDA', chave: '2'.repeat(44), nf_numero: 200, cliente: 'Y', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 12, produto: 'C' }];
  const resultado = await win.DTRecusasParser._importarNotasVendaBiRegistros(registros);
  assert.equal(resultado.volumesCorrigidos, 1);
});
