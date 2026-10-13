// PEDIDO AO VIVO (2026-08-27): reforma grande — devolução (com regra de
// motivo/auto-recebimento) mudou de 97-recebimento-recusas.js pra
// 100-consulta-notas-fiscais.js ("Devoluções (BI)"). "as notas de
// devolução é pra ficar aonde que ficou as notas de venda agora que você
// fez" (inverteu o que tinha sido montado) + "é para gravar as nfs de
// devolução que tem motivo também" (regra do motivo não trava mais numa
// origem específica) + "as notas de devolução também têm que trazer o
// valor" + "os produtos não precisa mostrar pro analista. Mas no coletor
// quando a pessoa começar a receber, aí vai precisar pra ela poder
// conferir" (itens ficam guardados na nota, não aparecem na listagem).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const code = fs.readFileSync(path.join(base, '100-consulta-notas-fiscais.js'), 'utf8');

// buscarVendasBiAutomatico() agenda um setInterval de auto-refresh a cada
// render — timer real em jsdom, precisa ser derrubado com window.close().
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({ id, _registro: registro, set: async (payload, opts) => { const atual = registro.get(id) || {}; registro.set(id, opts?.merge ? { ...atual, ...payload } : payload); } }),
    add: async (payload) => { const id = 'novo' + (seq++); registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}

function mockBatch() {
  const ops = [];
  return {
    set: (ref, payload, opts) => ops.push(() => { const atual = ref._registro.get(ref.id) || {}; ref._registro.set(ref.id, opts?.merge ? { ...atual, ...payload } : payload); }),
    delete: (ref) => ops.push(() => ref._registro.delete(ref.id)),
    commit: async () => { ops.forEach(fn => fn()); },
  };
}

function carregarPagina(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-recebimento-consulta-notas"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  const colNotas = mockColecao(opts.notasIniciais || []);
  const colRecusas = mockColecao(opts.recusasIniciais || []);
  win.getDTFirestore = () => ({ collection: (nome) => ({ recebimento_recusas_notas: colNotas, recebimento_recusas: colRecusas }[nome] || mockColecao([])) });
  win.getDTRawFirestore = () => ({ ...win.getDTFirestore(), batch: mockBatch });
  win.firebase = { auth: () => ({ currentUser: { uid: 'u1', email: 'analista@daterrinha.com' } }) };
  win.showToast = () => {};
  win.aplicarPermissoesAnalista = () => {};
  win.DTBiPastaLocal = opts.dtBiPastaLocal;
  win.eval(code);
  return { win, document, colNotas, colRecusas };
}

const usuario = { uid: 'u1', email: 'analista@daterrinha.com' };

test('classificarMotivoTexto: reconhece as 7 categorias + "sem motivo no texto"', () => {
  const { win } = carregarPagina({});
  const c = win._DTConsultaNotasFiscaisInternals.classificarMotivoTexto;
  assert.equal(c('Devolução ref NF 123 - TROCA de produto'), 'TROCA');
  assert.equal(c('produto IMPROPRIO para consumo'), 'IMPRÓPRIO PARA CONSUMO/VENDA');
  assert.equal(c('mercadoria com AVARIA no transporte'), 'AVARIA');
  assert.equal(c('FALTA de mercadoria na carga'), 'FALTA NA CARGA/ENTREGA');
  assert.equal(c('produto ERRADO enviado'), 'PRODUTO ERRADO/DIVERGENTE');
  assert.equal(c('VENCIDO na data de entrega'), 'VENCIDO/VENCIMENTO');
  assert.equal(c('DESACORDO com o pedido de compra'), 'DESACORDO COM PEDIDO');
  assert.equal(c(''), '(SEM MOTIVO NO TEXTO)');
});

test('_motivoDispensaColetor: true só pras 4 categorias fora da exceção (pedido ao vivo)', () => {
  const { win } = carregarPagina({});
  const f = win._DTConsultaNotasFiscaisInternals._motivoDispensaColetor;
  assert.equal(f('TROCA'), false);
  assert.equal(f('AVARIA'), false);
  assert.equal(f('VENCIDO'), false);
  assert.equal(f(''), false);
  assert.equal(f('FALTA na entrega'), true);
});

test('_construirRecebimentoAutomatico: motivo preenchido gera payload mesmo sem ser de PDF (regra não trava por origem)', () => {
  const { win } = carregarPagina({});
  const payload = win._DTConsultaNotasFiscaisInternals._construirRecebimentoAutomatico({ chave: '1'.repeat(44), numeroNota: '100', destinatario: 'Mercado X', valorTotal: 50, informacoesComplementares: 'FALTA na entrega' }, usuario);
  assert.ok(payload);
  assert.equal(payload.origem, 'AUTOMATICO');
  assert.equal(payload.motivoNome, 'FALTA NA CARGA/ENTREGA');
  assert.equal(payload.statusConferenciaOperacional, 'CONFERIDA');
  assert.equal(payload.notas[0].valorTotal, 50, 'valor da nota precisa ir junto (pedido ao vivo)');
});

test('_agruparDevolucoesBiPorChave: junta itens por chave e soma valorTotal', () => {
  const { win } = carregarPagina({});
  const linhas = [
    { chave: '1'.repeat(44), nf_numero: 1, cliente: 'A', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'X' },
    { chave: '1'.repeat(44), nf_numero: 1, cliente: 'A', valor_nota: 20, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'Y' },
  ];
  const notas = win._DTConsultaNotasFiscaisInternals._agruparDevolucoesBiPorChave(linhas);
  assert.equal(notas.length, 1);
  assert.equal(notas[0].valorTotal, 30);
  assert.equal(notas[0].itens.length, 2);
});

test('_importarDevolucoesBiRegistros: PEDIDO AO VIVO "por que notas de devolução é pra aguardar no Firebase? Só é pra aguardar se ela tiver com os motivos" — sem motivo qualificado, NADA é gravado (nem em recebimento_recusas_notas)', async () => {
  const { win, colNotas, colRecusas } = carregarPagina({});
  const registros = [
    { tipo_movimento: 'DEVOLUCAO', chave: '1'.repeat(44), nf_numero: 100, cliente: 'Mercado X', valor_nota: 18.8, data_emissao: '2026-05-26', quantidade_faturada: 2, produto: 'Tapioca' },
    { tipo_movimento: 'VENDA', chave: '2'.repeat(44), nf_numero: 1, cliente: 'Y', valor_nota: 5, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'Z' },
  ];
  const resultado = await win._DTConsultaNotasFiscaisInternals._importarDevolucoesBiRegistros(registros);
  assert.equal(resultado.totalNotas, 1);
  assert.equal(resultado.totalLinhas, 1);
  assert.equal(colNotas._registro.size, 0, 'sem motivo qualificado, não grava em recebimento_recusas_notas — só aparece na tela');
  assert.equal(colRecusas._registro.size, 0, 'e não gera recebimento nenhum');
});

// PEDIDO AO VIVO (2026-09-01): "a porra da data não vem pra essa tela,
// motivo por mês não está gerando nada" — 301 dos 305 recebimento_recusas
// AUTOMATICO já gravados ficaram com dataEmissao ou destinatario em branco
// (bug antigo, corrigido hoje só pra importações NOVAS). Documento já
// gravado precisa ser completado, não regravado.
test('_importarDevolucoesBiRegistros: nota já recebida com dataEmissao em branco é completada (não regravada) no próximo Buscar', async () => {
  const chave = '3'.repeat(44);
  const { win, colRecusas } = carregarPagina({
    recusasIniciais: [{ id: 'doc1', data: { chaves: [chave], origem: 'AUTOMATICO', motivoNome: 'Falta na carga/entrega', destinatario: 'Mercado X', dataEmissao: '' } }],
  });
  const registros = [{ tipo_movimento: 'DEVOLUCAO', chave, nf_numero: 100, cliente: '', valor_nota: 10, data_emissao: '2026-07-05', quantidade_faturada: 1, produto: 'A', mensagem: 'FALTA na entrega' }];
  const resultado = await win._DTConsultaNotasFiscaisInternals._importarDevolucoesBiRegistros(registros);
  assert.equal(resultado.autoSalvas, 0, 'chave já tem documento — não pode gerar um segundo');
  assert.equal(resultado.corrigidas, 1);
  assert.equal(colRecusas._registro.size, 1, 'continua sendo 1 único documento, só completado');
  assert.equal(colRecusas._registro.get('doc1').dataEmissao, '2026-07-05');
  assert.equal(colRecusas._registro.get('doc1').destinatario, 'Mercado X', 'destinatario que já existia não é sobrescrito');
});

test('_importarDevolucoesBiRegistros: nota já recebida e já completa não é tocada de novo', async () => {
  const chave = '4'.repeat(44);
  const { win, colRecusas } = carregarPagina({
    recusasIniciais: [{ id: 'doc1', data: { chaves: [chave], origem: 'AUTOMATICO', motivoNome: 'Falta na carga/entrega', destinatario: 'Mercado X', dataEmissao: '2026-07-05' } }],
  });
  const registros = [{ tipo_movimento: 'DEVOLUCAO', chave, nf_numero: 100, cliente: 'Outro Nome', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'A', mensagem: 'FALTA na entrega' }];
  const resultado = await win._DTConsultaNotasFiscaisInternals._importarDevolucoesBiRegistros(registros);
  assert.equal(resultado.corrigidas, 0, 'já estava completo, nada pra corrigir');
  assert.equal(colRecusas._registro.get('doc1').dataEmissao, '2026-07-05', 'não sobrescreve dado já correto com dado diferente vindo depois');
});

// PEDIDO AO VIVO (2026-09-03, pt. 2): "quando o banco de dados atualizar
// ele bater com essa nota, pra saber que ela retornou" — quando o Coletor
// não achava NADA pra uma chave bipada (banco desatualizado), o operador
// passou a poder digitar o número da nota manualmente e seguir o fluxo
// normal (ver 24-recebimento-recusas.js/adicionarChave()), gravando um
// recebimento_recusas comum (origem:'COLETOR', mesma chave). Este teste
// prova que _chavesJaComRecebimento()/_importarDevolucoesBiRegistros já
// reconhece esse doc quando o BI trouxer essa mesma devolução depois — sem
// distinguir por origem, então não cria um AUTOMATICO duplicado nem
// conflitante quando o "banco atualiza".
test('_importarDevolucoesBiRegistros: chave já recebida pelo Coletor (origem COLETOR, nota entrou sem estar no banco) — BI reconhece "já recebida" e NÃO cria um AUTOMATICO duplicado', async () => {
  const chave = '5'.repeat(44);
  const { win, colRecusas } = carregarPagina({
    recusasIniciais: [{ id: 'doc-coletor', data: { chaves: [chave], origem: 'COLETOR', motoristaNome: 'João', box: 'BOX 1', destinatario: '', dataEmissao: '' } }],
  });
  const registros = [{ tipo_movimento: 'DEVOLUCAO', chave, nf_numero: 100, cliente: 'Mercado Y', valor_nota: 50, data_emissao: '2026-07-10', quantidade_faturada: 1, produto: 'A', mensagem: 'FALTA na entrega' }];
  const resultado = await win._DTConsultaNotasFiscaisInternals._importarDevolucoesBiRegistros(registros);
  assert.equal(resultado.autoSalvas, 0, 'já existe um recebimento físico de verdade pra essa chave — não grava automático');
  assert.equal(colRecusas._registro.size, 1, 'continua sendo só o registro do Coletor — nenhum segundo doc criado');
  assert.equal(colRecusas._registro.get('doc-coletor').origem, 'COLETOR', 'o registro original não muda de origem');
  assert.equal(colRecusas._registro.get('doc-coletor').destinatario, 'Mercado Y', 'completa o destinatário que faltava, agora que o BI trouxe');
  assert.equal(colRecusas._registro.get('doc-coletor').dataEmissao, '2026-07-10', 'completa a data de emissão que faltava');
});

test('_construirRecebimentoAutomatico: quando o motivo qualifica, o payload leva os itens junto (pro Coletor conferir depois)', () => {
  const { win } = carregarPagina({});
  const nota = { chave: '1'.repeat(44), numeroNota: '100', destinatario: 'Mercado X', valorTotal: 18.8, informacoesComplementares: 'FALTA na entrega', itens: [{ produtoKey: 1, descricao: 'Tapioca', quantidade: 2 }] };
  const payload = win._DTConsultaNotasFiscaisInternals._construirRecebimentoAutomatico(nota, usuario);
  assert.ok(payload);
  assert.equal(payload.notas[0].itens.length, 1);
  assert.equal(payload.notas[0].itens[0].descricao, 'Tapioca');
});

test('_importarDevolucoesBiRegistros: sem `mensagem` no registro (nota antiga, campo ausente), é DESCARTADA (não grava, não aguarda Coletor)', async () => {
  const { win, colRecusas } = carregarPagina({});
  const registros = [{ tipo_movimento: 'DEVOLUCAO', chave: '1'.repeat(44), nf_numero: 100, cliente: 'X', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'A' }];
  const resultado = await win._DTConsultaNotasFiscaisInternals._importarDevolucoesBiRegistros(registros);
  assert.equal(resultado.autoSalvas, 0, 'sem mensagem, não tem motivo pra classificar — cai em "(sem motivo no texto)"');
  assert.equal(resultado.descartadas, 1, 'PEDIDO AO VIVO 2026-08-31: sem motivo agora é descartada, não fica mais "aguardando Coletor"');
  assert.equal(colRecusas._registro.size, 0);
});

// PEDIDO AO VIVO (2026-08-31): o BI passou a trazer o texto de motivo no
// campo `mensagem` de cada item (confirmado com dados reais do usuário) —
// a regra dormente desde 2026-08-27 dispara de verdade agora.
// PEDIDO AO VIVO (2026-09-01): "impróprio pra consumo também não é pra
// gravar" — motivo Impróprio saiu da lista de auto-gravação e passou a
// ser descartado, igual Troca/Avaria/Vencido/sem-motivo.
test('_importarDevolucoesBiRegistros: motivo "impróprio" é descartado (nem grava, nem aguarda Coletor)', async () => {
  const { win, colRecusas } = carregarPagina({});
  const registros = [{ tipo_movimento: 'DEVOLUCAO', chave: '1'.repeat(44), nf_numero: 100, cliente: 'X', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto_key: 79003, produto: '00932 COCO RALADO', ean: 7898693230858, dum: 17898693230855, mensagem: 'Devolucao de produto improprio para o consumo' }];
  const resultado = await win._DTConsultaNotasFiscaisInternals._importarDevolucoesBiRegistros(registros);
  assert.equal(resultado.autoSalvas, 0, 'PEDIDO AO VIVO 2026-09-01: impróprio agora descarta, não grava mais automático');
  assert.equal(resultado.descartadas, 1);
  assert.equal(colRecusas._registro.size, 0);
});

test('_agruparDevolucoesBiPorChave: quando o primeiro item da chave vem sem cliente/data, um item seguinte da mesma nota preenche o que faltou', () => {
  const { win } = carregarPagina({});
  const linhas = [
    { chave: '1'.repeat(44), nf_numero: 1, cliente: '', data_emissao: '', valor_nota: 10, quantidade_faturada: 1, produto: 'X' },
    { chave: '1'.repeat(44), nf_numero: 1, cliente: 'Mercado X', data_emissao: '2026-07-05', valor_nota: 20, quantidade_faturada: 1, produto: 'Y' },
  ];
  const notas = win._DTConsultaNotasFiscaisInternals._agruparDevolucoesBiPorChave(linhas);
  assert.equal(notas.length, 1);
  assert.equal(notas[0].destinatario, 'Mercado X', 'destinatário não pode ficar vazio se algum item da mesma nota trouxe');
  assert.equal(notas[0].dataEmissao, '2026-07-05', 'data de emissão não pode ficar vazia se algum item da mesma nota trouxe');
  assert.equal(notas[0].valorTotal, 30);
});

test('_importarDevolucoesBiRegistros: motivo "TROCA" é descartado (nem grava, nem aguarda Coletor)', async () => {
  const { win, colRecusas } = carregarPagina({});
  const registros = [{ tipo_movimento: 'DEVOLUCAO', chave: '1'.repeat(44), nf_numero: 100, cliente: 'X', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'A', mensagem: 'NF REF TROCA' }];
  const resultado = await win._DTConsultaNotasFiscaisInternals._importarDevolucoesBiRegistros(registros);
  assert.equal(resultado.autoSalvas, 0);
  assert.equal(resultado.descartadas, 1, 'PEDIDO AO VIVO 2026-08-31: Troca/Avaria/Vencido/sem-motivo agora descartam, não ficam mais "aguardando Coletor"');
  assert.equal(colRecusas._registro.size, 0);
});

test('_agruparDevolucoesBiPorChave: gtin é sempre o ean (unidade), com ou sem dum', () => {
  const { win } = carregarPagina({});
  const linhas = [{ chave: '1'.repeat(44), nf_numero: 1, cliente: 'A', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'X', ean: 7898693230858, dum: null }];
  const notas = win._DTConsultaNotasFiscaisInternals._agruparDevolucoesBiPorChave(linhas);
  assert.equal(notas[0].itens[0].gtin, '7898693230858');
  assert.equal(notas[0].itens[0].dun, '', 'sem dum, o campo dun (separado do gtin) fica vazio, não herda o ean');
});

// PEDIDO AO VIVO (2026-09-02, 2ª/3ª rodada): "quero que grave o dun" →
// "o gtin ficou com o dun também, cada um no lugar certo" — gtin (EAN-13,
// unidade) e dun (DUN-14, caixa) são campos independentes, sem fallback
// cruzado entre eles.
test('_agruparDevolucoesBiPorChave: com `dum`, gtin (ean) e dun (dum) ficam com valores DIFERENTES, cada um no seu campo', () => {
  const { win } = carregarPagina({});
  const linhas = [{ chave: '1'.repeat(44), nf_numero: 1, cliente: 'A', valor_nota: 10, data_emissao: '2026-01-01', quantidade_faturada: 1, produto: 'X', ean: 7898693230858, dum: 17898693230671 }];
  const notas = win._DTConsultaNotasFiscaisInternals._agruparDevolucoesBiPorChave(linhas);
  assert.equal(notas[0].itens[0].gtin, '7898693230858', 'gtin é o ean');
  assert.equal(notas[0].itens[0].dun, '17898693230671', 'dun é o dum, diferente do gtin');
});

test('tela: mostra "Buscar" quando DTBiPastaLocal.suportado() é true, e nenhuma coluna de produtos na listagem', async () => {
  const { win, document } = carregarPagina({ dtBiPastaLocal: { suportado: () => true } });
  await win.renderConsultaNotasFiscais('page-recebimento-consulta-notas');
  const html = document.getElementById('page-recebimento-consulta-notas').innerHTML;
  assert.match(html, /data-cnf-buscar-bi="1">📊 Buscar</);
  assert.doesNotMatch(html, /Produtos?<\/th>/i, 'produtos não devem aparecer na listagem do Analista (pedido ao vivo)');
});

test('clicar em "Buscar": lê o JSON, importa devoluções e atualiza a tabela com o valor da nota', async () => {
  const registros = [{ tipo_movimento: 'DEVOLUCAO', chave: '9'.repeat(44), nf_numero: 500, cliente: 'Mercado Gama', valor_nota: 99.9, data_emissao: '2026-08-01', quantidade_faturada: 3, produto: 'Tapioca' }];
  const { win, document } = carregarPagina({
    dtBiPastaLocal: {
      suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }),
      lerJson: async (nome) => { assert.equal(nome, 'notas_fiscais_jacson.json'); return registros; },
    },
  });
  await win.renderConsultaNotasFiscais('page-recebimento-consulta-notas');
  document.querySelector('[data-cnf-buscar-bi]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-recebimento-consulta-notas').innerHTML;
  assert.match(html, /Mercado Gama/);
  assert.match(html, /99,90|99\.90/);
  assert.match(html, /Descartado/, 'sem mensagem/motivo, cai em "(sem motivo no texto)" — descartada, não mais "Aguardando Coletor"');
});

test('tela: tabela mostra uma coluna Motivo com o motivo classificado de cada devolução', async () => {
  const registros = [{ tipo_movimento: 'DEVOLUCAO', chave: '9'.repeat(44), nf_numero: 500, cliente: 'Mercado Gama', valor_nota: 99.9, data_emissao: '2026-08-01', quantidade_faturada: 3, produto: 'Tapioca', mensagem: 'produto IMPROPRIO para consumo' }];
  const { win, document } = carregarPagina({
    dtBiPastaLocal: { suportado: () => true, status: async () => 'conectado', conectar: async () => ({ ok: true }), lerJson: async () => registros },
  });
  await win.renderConsultaNotasFiscais('page-recebimento-consulta-notas');
  document.querySelector('[data-cnf-buscar-bi]').click();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  const html = document.getElementById('page-recebimento-consulta-notas').innerHTML;
  assert.match(html, /<th>Motivo<\/th>/, 'cabeçalho precisa ter a coluna Motivo (pedido ao vivo)');
  assert.match(html, /IMPRÓPRIO PARA CONSUMO\/VENDA/);
});
