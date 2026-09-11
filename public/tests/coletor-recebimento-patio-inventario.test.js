// Coletor > Recebimento > Inventário Inicial do Pátio (29-recebimento-
// patio-inventario.js) — "fotografa" notas já paradas no pátio que nunca
// passaram pelo fluxo normal de Entrada. Ver plano completo em
// structured-sprouting-hoare.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const baseColetor = path.join(__dirname, '../js/coletor');
const htmlCode = fs.readFileSync(path.join(__dirname, '../coletor.html'), 'utf8');
const navCode = fs.readFileSync(path.join(baseColetor, '10-navegacao-estorno.js'), 'utf8');
const patioCode = fs.readFileSync(path.join(baseColetor, '29-recebimento-patio-inventario.js'), 'utf8');

// Chave de NF-e de 44 dígitos com dígito verificador (mod-11) válido.
const CHAVE_VALIDA = '35260800123456780001235500100000123412345673';

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  const snapshot = entradas => ({ empty: entradas.length === 0, size: entradas.length, docs: entradas.map(([id, data]) => ({ id, data: () => data })) });
  const base = {
    get: async () => snapshot([...registro.entries()]),
    doc: id => ({
      id: id || ('novo' + (seq++)),
      get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; },
    }),
    add: async payload => { const docId = 'novo' + (seq++); registro.set(docId, payload); return { id: docId }; },
    _registro: registro,
  };
  base.where = (campo, op, valor) => ({
    get: async () => {
      const bate = data => { const v = data ? data[campo] : undefined; if (op === 'array-contains') return Array.isArray(v) && v.includes(valor); return true; };
      return snapshot([...registro.entries()].filter(([, data]) => bate(data)));
    },
  });
  return base;
}

// setInterval não é usado por este arquivo (sem polling), mas mantém o
// mesmo cuidado de fechar a janela jsdom por consistência com o resto da
// suíte de Recebimento.
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarColetor(colecoes) {
  const dom = new JSDOM(htmlCode, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window; const document = win.document;
  _janelasAbertas.push(win);
  win.getDTFirestore = () => ({ collection: nome => colecoes?.[nome] || mockColecao([]) });
  win.getDTAuth = () => ({ currentUser: { uid: 'u1', email: 'operador@daterrinha.com' } });
  win.toast = () => {};
  win.eval(navCode);
  win.eval(patioCode);
  return { win, document };
}

test('consultarChave + confirmarLancamento: nota nova (achada em recebimento_recusas_notas) grava doc com origem INVENTARIO_INICIAL, statusFisico NO_PATIO e Box informado', async () => {
  const notas = mockColecao([{ id: CHAVE_VALIDA, data: { numeroNota: '12345', destinatario: 'Mercado Atacadão' } }]);
  const recusas = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas_notas: notas, recebimento_recusas: recusas });
  win.APP = { operador: { name: 'Maria Operadora' } };

  await win.abrirInventarioPatio();
  document.getElementById('patio-chave-input').value = CHAVE_VALIDA;
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('patio-inventario-host').innerHTML, /12345/);
  assert.match(document.getElementById('patio-inventario-host').innerHTML, /Mercado Atacadão/);

  document.getElementById('patio-box-input').value = 'box 7';
  document.getElementById('patio-confirmar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(recusas._registro.size, 1);
  const doc = [...recusas._registro.values()][0];
  assert.equal(doc.origem, 'INVENTARIO_INICIAL');
  assert.equal(doc.statusFisico, 'NO_PATIO');
  assert.equal(doc.box, 'BOX 7');
  // Arrays criados dentro do realm do jsdom não são reference-equal aos
  // arrays do Node principal — deepEqual falha por causa disso mesmo com
  // conteúdo idêntico; comparar por Array.from()/length evita o falso negativo.
  assert.deepEqual(Array.from(doc.chaves), [CHAVE_VALIDA]);
  assert.deepEqual(Array.from(doc.numerosNotas), ['12345']);
  assert.equal(doc.notas.length, 1);
  assert.equal(doc.notas[0].chave, CHAVE_VALIDA);
  assert.equal(doc.notas[0].numeroNota, '12345');
  assert.equal(doc.notas[0].box, 'BOX 7');
  assert.equal(doc.notas[0].tratamento, undefined, 'tratamento não é definido aqui — o Analista classifica depois, igual toda nota nova');
  assert.match(document.getElementById('patio-inventario-host').innerHTML, /Nota lançada no pátio/);
  // PEDIDO AO VIVO (2026-09-11): "por que não tá trazendo a pessoa na
  // coluna de conferente? Na hora de criar o login já coloco o nome".
  assert.equal(doc.conferenteNome, 'Maria Operadora');
});

test('nota já registrada e ainda no pátio: bloqueia com a mensagem certa, não cria duplicata', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', statusFisico: 'NO_PATIO', box: 'BOX 3', chaves: [CHAVE_VALIDA], notas: [{ chave: CHAVE_VALIDA, numeroNota: '999', tratamento: 'RECUSA' }] } },
  ]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas, recebimento_recusas_notas: mockColecao([]) });

  await win.abrirInventarioPatio();
  document.getElementById('patio-chave-input').value = CHAVE_VALIDA;
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('patio-inventario-host').innerHTML;
  assert.match(html, /já está registrada no pátio/);
  assert.match(html, /BOX 3/);
  assert.doesNotMatch(html, /patio-box-input/, 'não oferece o formulário de lançamento — é bloqueio, não edição');
  assert.equal(recusas._registro.size, 1, 'nenhum documento novo foi criado');
});

test('nota já registrada MAS já saiu do pátio (Recusa finalizada): NÃO bloqueia — permite lançar de novo (voltou fisicamente)', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', statusFisico: 'SAIU', box: 'BOX 3', chaves: [CHAVE_VALIDA], notas: [{ chave: CHAVE_VALIDA, numeroNota: '999', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }] } },
  ]);
  const notas = mockColecao([{ id: CHAVE_VALIDA, data: { numeroNota: '999', destinatario: 'Mercado Y' } }]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas, recebimento_recusas_notas: notas });

  await win.abrirInventarioPatio();
  document.getElementById('patio-chave-input').value = CHAVE_VALIDA;
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('patio-inventario-host').innerHTML;
  assert.doesNotMatch(html, /já está registrada no pátio/);
  assert.match(html, /patio-box-input/);
});

// PEDIDO AO VIVO (2026-09-11): "na hora de fazer o inventário inicial e já
// ter recebido, ele vai falar que já foi recebida" — mesmo não bloqueando
// (o teste acima já cobre o "voltou fisicamente de novo"), tem que avisar
// que já passou pelo sistema antes.
test('nota já registrada MAS já saiu do pátio: mostra aviso "já foi recebida antes", com o Box do lançamento anterior', async () => {
  const recusas = mockColecao([
    { id: 'r1', data: { origem: 'COLETOR', statusFisico: 'SAIU', box: 'BOX 3', chaves: [CHAVE_VALIDA], notas: [{ chave: CHAVE_VALIDA, numeroNota: '999', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }] } },
  ]);
  const notas = mockColecao([{ id: CHAVE_VALIDA, data: { numeroNota: '999', destinatario: 'Mercado Y' } }]);
  const { win, document } = carregarColetor({ recebimento_recusas: recusas, recebimento_recusas_notas: notas });

  await win.abrirInventarioPatio();
  document.getElementById('patio-chave-input').value = CHAVE_VALIDA;
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('patio-inventario-host').innerHTML;
  assert.match(html, /já foi recebida antes/);
  assert.match(html, /BOX 3/);
});

test('nota SEM banco (não achada em recebimento_recusas_notas): cai no fluxo manual, pré-preenche número extraído da chave, e ainda lança normalmente', async () => {
  const { win, document } = carregarColetor({ recebimento_recusas_notas: mockColecao([]), recebimento_recusas: mockColecao([]) });

  await win.abrirInventarioPatio();
  document.getElementById('patio-chave-input').value = CHAVE_VALIDA;
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('patio-inventario-host').innerHTML;
  assert.match(html, /ainda não está no sistema/);
  const numeroInput = document.getElementById('patio-numero-input');
  assert.ok(numeroInput.value, 'número pré-preenchido a partir da própria chave');

  document.getElementById('patio-box-input').value = 'BOX 9';
  document.getElementById('patio-confirmar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const recusas = document.defaultView.getDTFirestore().collection('recebimento_recusas');
  assert.equal(recusas._registro.size, 1);
});

test('sem Box informado: bloqueia a confirmação com aviso, não grava nada', async () => {
  const notas = mockColecao([{ id: CHAVE_VALIDA, data: { numeroNota: '1', destinatario: 'X' } }]);
  const recusas = mockColecao([]);
  const { win, document } = carregarColetor({ recebimento_recusas_notas: notas, recebimento_recusas: recusas });
  let avisoMostrado = '';
  win.toast = m => { avisoMostrado = m; };

  await win.abrirInventarioPatio();
  document.getElementById('patio-chave-input').value = CHAVE_VALIDA;
  document.getElementById('patio-consultar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  document.getElementById('patio-box-input').value = '';
  document.getElementById('patio-confirmar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(avisoMostrado, /Box/);
  assert.equal(recusas._registro.size, 0);
});
