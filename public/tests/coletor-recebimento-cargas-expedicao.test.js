// Coletor > Recebimento > Nova Movimentação > Transbordo de mercadorias >
// Expedição de carga. Segunda metade do fluxo Montagem/Expedição — pega uma
// carga já com montagem finalizada (status PENDENTE + totalPaletesFisico
// preenchido) e, ao confirmar motorista+NF, GERA um transbordo de verdade
// na MESMA coleção `recebimentos` de sempre (via _criarTransbordoPorMotorista,
// 22-recebimento.js, com o parâmetro `opcoes` novo desta etapa), já em
// EM_TRANSITO (a "saída" já aconteceu — motorista+NF foram coletados no
// próprio formulário da carga, não faz sentido pedir de novo na tela padrão
// de confirmação de NF). Também alimenta o ledger de paletes na origem.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const base = path.join(__dirname, '../js/coletor');
const recCode = fs.readFileSync(path.join(base, '22-recebimento.js'), 'utf8');
const cargasCode = fs.readFileSync(path.join(base, '26-recebimento-cargas.js'), 'utf8');

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  const subcolecoes = new Map();
  let seq = 0;
  const snapshot = entradas => ({ empty: entradas.length === 0, size: entradas.length, docs: entradas.map(([id, data]) => ({ id, data: () => data, exists: true })) });
  return {
    get: async () => snapshot([...registro.entries()]),
    doc: id => {
      const docId = id || ('novo' + (seq++));
      return {
        id: docId,
        get: async () => { const data = registro.get(docId); return { exists: data !== undefined, id: docId, data: () => data }; },
        set: async p => { const a = registro.get(docId) || {}; registro.set(docId, { ...a, ...p }); },
        update: async p => { const a = registro.get(docId); if (a === undefined) throw new Error('NOT_FOUND'); registro.set(docId, { ...a, ...p }); },
        delete: async () => { registro.delete(docId); },
        collection: sub => {
          const chave = docId + '/' + sub;
          if (!subcolecoes.has(chave)) subcolecoes.set(chave, mockColecao([]));
          return subcolecoes.get(chave);
        },
      };
    },
    add: async payload => {
      const docId = 'novo' + (seq++);
      registro.set(docId, payload);
      return {
        id: docId,
        get: async () => { const data = registro.get(docId); return { exists: data !== undefined, id: docId, data: () => data }; },
      };
    },
    where: (campo, op, valor) => {
      const filtrados = () => [...registro.entries()].filter(([, data]) => data && data[campo] === valor);
      return { get: async () => snapshot(filtrados()) };
    },
    _registro: registro,
  };
}

const SHELL = `<!doctype html><html><body>
<div id="cargas-lista-itens"></div>
<div id="carga-expedicao-resumo"></div>
<select id="carga-expedicao-motorista"></select>
<div id="carga-expedicao-nf-lista"></div>
<div id="carga-expedicao-notas-produtos"></div>
<div id="carga-expedicao-status"></div>
</body></html>`;

const CARGA_PRONTA = {
  id: 'c1',
  data: {
    nomeCarga: 'Carga Filial 04/09', status: 'PENDENTE',
    origemLojaId: 'loja1', origemNome: 'Loja Matriz',
    destinoLojaId: 'loja2', destinoNome: 'Loja Filial',
    totalPaletesFisico: 3, totalVolumes: 65, notasFiscais: [],
  },
};

function loadCargas(colecoes, opts) {
  const telas = [];
  const toasts = [];
  const chamadasLedger = [];
  const dom = new JSDOM(SHELL, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const lojas = mockColecao([{ id: (opts && opts.lojaId) || 'loja1', data: { nome: (opts && opts.lojaNome) || 'Loja Matriz' } }]);
  win.FS = { collection: nome => (colecoes && colecoes[nome]) || mockColecao([]) };
  win.APP = { operador: { email: 'operador@daterrinha.com' } };
  win.goScreen = id => { telas.push(id); };
  win.toast = (msg, tipo) => { toasts.push({ msg, tipo }); };
  win.getDTLojaAtiva = () => (opts && opts.lojaId) || 'loja1';
  win.getDTRawFirestore = () => ({ collection: nome => (nome === 'lojas' ? lojas : mockColecao([])) });
  win._aplicarMovimentoLedger = async function (lojaId, tipo, deltas, referencia) {
    chamadasLedger.push({ lojaId, tipo, deltas, referencia });
    if (opts && opts.ledgerFalha) throw new Error('Falha simulada no ledger');
  };
  Object.defineProperty(win.navigator, 'onLine', { get: () => !opts || opts.online !== false, configurable: true });
  win.eval(recCode);
  win.eval(cargasCode);
  return { window: win, document, telas, toasts, chamadasLedger };
}

test('abrirExpedicaoCarga: manda de volta pra montagem se a montagem ainda não foi finalizada (sem totalPaletesFisico)', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga sem montagem', status: 'PENDENTE' } }]);
  const { window, telas, toasts } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.abrirExpedicaoCarga('c1');
  assert.ok(telas.includes('carga-montagem'));
  assert.ok(toasts.some(t => /finalize a montagem/i.test(t.msg)));
});

// BUG AO VIVO REAL (2026-09-08): antes disso, abrir uma carga já expedida
// só mostrava um toast "já foi expedida" e voltava pra lista — não tinha
// NENHUMA tela de detalhe pra EM_TRANSITO/RECEBIDA/CANCELADA. Agora manda
// pra `abrirDetalheCarga` (guarda defensiva — o roteamento normal já não
// chama `abrirExpedicaoCarga` pra uma carga não-PENDENTE, ver
// `abrirCargaPorId`, mas essa função continua exposta em `window` e pode
// ser chamada direto).
test('abrirExpedicaoCarga: carga já expedida (EM_TRANSITO) manda pra tela de detalhe, não reabre o formulário nem só avisa e volta', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga já expedida', status: 'EM_TRANSITO', destinoNome: 'Loja Filial' } }]);
  const { window, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.abrirExpedicaoCarga('c1');
  assert.ok(telas.includes('carga-detalhe'));
  assert.ok(!telas.includes('carga-expedicao'), 'não pode reabrir o formulário de expedição pra uma carga já expedida');
});

// BUG AO VIVO REAL (2026-09-06): "clico nela e aparece a opção de
// adicionar mais paletes, e por onde eu seleciono essa carga pra virar um
// transbordo" — o clique no card da lista sempre abria Montagem pra
// qualquer carga PENDENTE, mesmo já "Pronta pra expedição" (o status
// continua PENDENTE de propósito até a Expedição de verdade acontecer) —
// não existia NENHUM jeito de chegar na tela de Expedição pelo clique.
test('clique no card da lista: carga PENDENTE "pronta pra expedição" (já tem totalPaletesFisico) abre EXPEDIÇÃO, não Montagem de novo', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos', placa: 'ABC1D23' } }]);
  const { window, document, telas } = loadCargas({ recebimento_transbordo_cargas: cargas, recebimento_motoristas: motoristas });

  await window.carregarCargasColetor();
  document.querySelector('[data-carga-id="c1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await Promise.resolve(); await Promise.resolve(); // deixa as promises de abrirExpedicaoCarga assentarem

  assert.ok(telas.includes('carga-expedicao'), 'devia ter aberto a Expedição');
  assert.ok(!telas.includes('carga-montagem'), 'não devia reabrir a Montagem pra uma carga já pronta');
});

test('clique no card da lista: carga PENDENTE ainda em montagem (sem totalPaletesFisico) continua abrindo Montagem', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga Montando', status: 'PENDENTE' } }]);
  const { window, document, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.carregarCargasColetor();
  document.querySelector('[data-carga-id="c1"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await Promise.resolve(); await Promise.resolve();

  assert.ok(telas.includes('carga-montagem'));
});

test('abrirExpedicaoCarga: pronta pra expedir preenche o resumo e a lista de motoristas', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos', placa: 'ABC1D23' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, recebimento_motoristas: motoristas });

  await window.abrirExpedicaoCarga('c1');
  assert.match(document.getElementById('carga-expedicao-resumo').textContent, /Carga Filial 04\/09/);
  assert.match(document.getElementById('carga-expedicao-resumo').textContent, /Loja Filial/);
  assert.match(document.getElementById('carga-expedicao-motorista').innerHTML, /Carlos/);
});

// BUG AO VIVO REAL (2026-09-08): "vinculei pelo analista as notas nos
// produtos e não apareceu as notas para o operador" — a Expedição sempre
// abria com o formulário de NF em branco, mesmo com o Analista já tendo
// vinculado produto→nota (104-recebimento-cargas-cards.js). Agora
// pré-preenche número+volume (volume = soma dos produtos daquela nota,
// recalculado ao vivo) e mostra o detalhe por produto — ainda editável,
// o operador não é OBRIGADO a aceitar como está.
test('abrirExpedicaoCarga: pré-preenche a(s) Nota(s) Fiscal(is) com o que o Analista já vinculou (número + volume somado), e mostra o detalhe por produto', async () => {
  const carga = {
    id: 'c1', data: Object.assign({}, CARGA_PRONTA.data, {
      notasFiscaisProdutos: [
        { numero: '123456', produtos: [{ codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }, { codigoProduto: '1002', nomeProduto: 'Produto B' }] },
      ],
    }),
  };
  const cargas = mockColecao([carga]);
  await cargas.doc('c1').collection('itens').add({ capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20 });
  await cargas.doc('c1').collection('itens').add({ capa: 'CAPA-002', codigoProduto: '1002', nomeProduto: 'Produto B', quantidade: 15 });
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, recebimento_motoristas: mockColecao([]) });

  await window.abrirExpedicaoCarga('c1');

  const nfLista = document.getElementById('carga-expedicao-nf-lista');
  assert.equal(nfLista.querySelector('[data-cnf-input="0"]').value, '123456');
  assert.equal(nfLista.querySelector('[data-cnf-volume="0"]').value, '35', '20 (Tapioca) + 15 (Produto B) = 35, somado ao vivo');
  const notasProdutos = document.getElementById('carga-expedicao-notas-produtos').innerHTML;
  assert.match(notasProdutos, /Nota 123456/);
  assert.match(notasProdutos, /Tapioca 1kg Fardo/);
  assert.match(notasProdutos, /Produto B/);
});

test('abrirExpedicaoCarga: sem nenhum vínculo produto→nota, o formulário continua abrindo em branco (comportamento de sempre)', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, recebimento_motoristas: mockColecao([]) });

  await window.abrirExpedicaoCarga('c1');

  const nfLista = document.getElementById('carga-expedicao-nf-lista');
  assert.equal(nfLista.querySelector('[data-cnf-input="0"]').value, '');
  assert.equal(document.getElementById('carga-expedicao-notas-produtos').innerHTML, '');
});

test('abrirExpedicaoCarga: NF pré-preenchida continua editável — o operador pode ajustar/adicionar antes de confirmar', async () => {
  const carga = {
    id: 'c1', data: Object.assign({}, CARGA_PRONTA.data, {
      notasFiscaisProdutos: [{ numero: '123456', produtos: [{ codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }] }],
    }),
  };
  const cargas = mockColecao([carga]);
  await cargas.doc('c1').collection('itens').add({ capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20 });
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, recebimento_motoristas: motoristas });

  await window.abrirExpedicaoCarga('c1');
  document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-volume="0"]').value = '99';
  document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-volume="0"]').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('carga-expedicao-motorista').value = 'm1';

  await window.confirmarExpedicaoCarga();

  const cargaSalva = cargas._registro.get('c1');
  assert.equal(cargaSalva.notasFiscais[0].volumes, 99, 'ajuste manual do operador tem que prevalecer sobre o valor pré-preenchido');
});

test('confirmarExpedicaoCarga: cria o transbordo de verdade (recebimentos) já EM_TRANSITO com cargaId e NF, atualiza a carga e o ledger', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos', placa: 'ABC1D23' } }]);
  const recebimentos = mockColecao([]);
  const { window, document, chamadasLedger } = loadCargas({
    recebimento_transbordo_cargas: cargas,
    recebimento_motoristas: motoristas,
    recebimentos: recebimentos,
  });

  await window.abrirExpedicaoCarga('c1');
  document.getElementById('carga-expedicao-motorista').value = 'm1';
  const linha0 = document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-input="0"]');
  const vol0 = document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-volume="0"]');
  linha0.value = '55501';
  vol0.value = '65';
  await window.confirmarExpedicaoCarga();

  assert.equal(recebimentos._registro.size, 1);
  const transbordo = [...recebimentos._registro.values()][0];
  assert.equal(transbordo.tipo, 'TRANSBORDO');
  assert.equal(transbordo.status, 'EM_TRANSITO');
  assert.equal(transbordo.cargaId, 'c1');
  assert.equal(transbordo.notaFiscalTransferencia, '55501');
  assert.equal(transbordo.notasVolumesTransferencia[0].numero, '55501');
  assert.equal(transbordo.notasVolumesTransferencia[0].volumes, 65);
  assert.equal(transbordo.volumes, 65);
  assert.ok(transbordo.horaSaida);
  assert.equal(transbordo.destinoLojaId, 'loja2');
  assert.equal(transbordo.origemLojaId, 'loja1');
  assert.equal(transbordo.motoristaNome, 'Carlos');

  const cargaAtualizada = cargas._registro.get('c1');
  assert.equal(cargaAtualizada.status, 'EM_TRANSITO');
  assert.equal(cargaAtualizada.recebimentoId, [...recebimentos._registro.keys()][0]);
  assert.equal(cargaAtualizada.motoristaNome, 'Carlos');

  // PEDIDO AO VIVO (2026-09-08): "se o palete tiver em trânsito ele tem
  // que tá com o número na loja de destino, não da loja que tá saindo" —
  // o Disponível some da ORIGEM (quem expediu), mas o Em Trânsito agora
  // aparece na linha do DESTINO (quem vai receber), não mais na origem.
  assert.equal(chamadasLedger.length, 2);
  const origem = chamadasLedger.find(c => c.lojaId === 'loja1');
  const destino = chamadasLedger.find(c => c.lojaId === 'loja2');
  assert.ok(origem, 'origem perde o Disponível');
  assert.ok(destino, 'destino ganha o Em Trânsito');
  assert.equal(origem.tipo, 'TRANSBORDO_EXPEDICAO');
  assert.equal(origem.deltas.disponivelDelta, -3);
  assert.equal(origem.deltas.emTransitoDelta, undefined, 'origem não carrega mais Em Trânsito nenhum');
  assert.equal(destino.tipo, 'TRANSBORDO_EXPEDICAO');
  assert.equal(destino.deltas.emTransitoDelta, 3);
  assert.equal(destino.deltas.disponivelDelta, undefined, 'destino só recebe o Em Trânsito, o Disponível só muda na chegada');
  assert.equal(origem.referencia.id, 'c1');
  assert.equal(destino.referencia.id, 'c1');
});

// BUG AO VIVO REAL (2026-09-06): "os motoristas que aparecem ali tem que
// ser os cadastrados para transbordo" — usava por engano o cadastro de
// Notas Retornadas/Paletes (recebimento_recusas_motoristas, por loja) em
// vez do cadastro GLOBAL de motoristas do Transbordo (recebimento_
// motoristas) — trocado nos testes acima. recebimento_motoristas não tem
// campo placa (fica em recebimento_veiculos, ligado por
// motoristaHabitualId) — confirma que a placa da carga vem do transbordo
// recém-criado (que já resolve isso via VEICULOS_CACHE), não de um
// hipotético motorista.placa (que nem existe nessa base).
test('confirmarExpedicaoCarga: placa vem do veículo vinculado ao motorista (recebimento_veiculos), não de um campo placa no motorista', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos', transportadora: 'Log Rápido' } }]);
  const veiculos = mockColecao([{ id: 'v1', data: { placa: 'XYZ9A87', motoristaHabitualId: 'm1', transportadora: 'Log Rápido' } }]);
  const recebimentos = mockColecao([]);
  const { window, document } = loadCargas({
    recebimento_transbordo_cargas: cargas,
    recebimento_motoristas: motoristas,
    recebimento_veiculos: veiculos,
    recebimentos: recebimentos,
  });
  await window.carregarRecebimentoColetor();

  await window.abrirExpedicaoCarga('c1');
  document.getElementById('carga-expedicao-motorista').value = 'm1';
  const linha0 = document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-input="0"]');
  const vol0 = document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-volume="0"]');
  linha0.value = '55501';
  vol0.value = '65';
  await window.confirmarExpedicaoCarga();

  const transbordo = [...recebimentos._registro.values()][0];
  assert.equal(transbordo.placa, 'XYZ9A87');
  const cargaAtualizada = cargas._registro.get('c1');
  assert.equal(cargaAtualizada.placa, 'XYZ9A87', 'a placa da carga tem que vir do veículo, refletindo o transbordo real');
});

test('confirmarExpedicaoCarga: recusa sem motorista, sem NF, com NF repetida, ou com volume inválido', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, recebimento_motoristas: motoristas, recebimentos: mockColecao([]) });
  await window.abrirExpedicaoCarga('c1');

  await window.confirmarExpedicaoCarga();
  assert.match(document.getElementById('carga-expedicao-status').textContent, /motorista/i);

  document.getElementById('carga-expedicao-motorista').value = 'm1';
  await window.confirmarExpedicaoCarga();
  assert.match(document.getElementById('carga-expedicao-status').textContent, /pelo menos uma nota fiscal/i);

  const lista = document.getElementById('carga-expedicao-nf-lista');
  lista.querySelector('[data-cnf-input="0"]').value = '100';
  lista.querySelector('[data-cnf-volume="0"]').value = '0'; // inválido
  await window.confirmarExpedicaoCarga();
  assert.match(document.getElementById('carga-expedicao-status').textContent, /volume maior que zero/i);
});

test('confirmarExpedicaoCarga: sem conexão, recusa expedir (limitação conhecida — expedição de carga é online-only)', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos' } }]);
  const { window, document } = loadCargas(
    { recebimento_transbordo_cargas: cargas, recebimento_motoristas: motoristas, recebimentos: mockColecao([]) },
    { online: false }
  );
  await window.abrirExpedicaoCarga('c1');
  document.getElementById('carga-expedicao-motorista').value = 'm1';
  const lista = document.getElementById('carga-expedicao-nf-lista');
  lista.querySelector('[data-cnf-input="0"]').value = '100';
  lista.querySelector('[data-cnf-volume="0"]').value = '10';
  await window.confirmarExpedicaoCarga();

  assert.match(document.getElementById('carga-expedicao-status').textContent, /sem conexão/i);
  assert.equal(cargas._registro.get('c1').status, 'PENDENTE', 'carga não pode ser marcada como expedida sem o transbordo ter sido criado de verdade');
});

test('confirmarExpedicaoCarga: se o ledger falhar, a expedição em si (recebimentos + carga) continua salva, MAS avisa por toast (não só console) — antes o Controle de Paletes perdia os paletes em silêncio', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos' } }]);
  const { window, document, telas, toasts } = loadCargas(
    { recebimento_transbordo_cargas: cargas, recebimento_motoristas: motoristas, recebimentos: mockColecao([]) },
    { ledgerFalha: true }
  );
  await window.abrirExpedicaoCarga('c1');
  document.getElementById('carga-expedicao-motorista').value = 'm1';
  const lista = document.getElementById('carga-expedicao-nf-lista');
  lista.querySelector('[data-cnf-input="0"]').value = '100';
  lista.querySelector('[data-cnf-volume="0"]').value = '10';
  await window.confirmarExpedicaoCarga();

  assert.equal(cargas._registro.get('c1').status, 'EM_TRANSITO', 'falha no ledger não pode impedir a expedição real de salvar');
  assert.ok(telas.includes('cargas-lista'));
  const ultimoToast = toasts[toasts.length - 1];
  assert.match(ultimoToast.msg, /NÃO entraram no Controle de Paletes/);
  assert.equal(ultimoToast.tipo, 'e');
  assert.ok(!toasts.some(t => t.msg === 'Carga expedida!'), 'o toast de sucesso genérico não pode mascarar a falha do ledger');
});

test('confirmarExpedicaoCarga: ledger funcionando normalmente mostra só o toast de sucesso (sem aviso de falha)', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const motoristas = mockColecao([{ id: 'm1', data: { nome: 'Carlos' } }]);
  const { window, document, toasts } = loadCargas(
    { recebimento_transbordo_cargas: cargas, recebimento_motoristas: motoristas, recebimentos: mockColecao([]) }
  );
  await window.abrirExpedicaoCarga('c1');
  document.getElementById('carga-expedicao-motorista').value = 'm1';
  const lista = document.getElementById('carga-expedicao-nf-lista');
  lista.querySelector('[data-cnf-input="0"]').value = '100';
  lista.querySelector('[data-cnf-volume="0"]').value = '10';
  await window.confirmarExpedicaoCarga();

  assert.ok(toasts.some(t => t.msg === 'Carga expedida!' && t.tipo === 's'));
  assert.ok(!toasts.some(t => /Controle de Paletes/.test(t.msg)));
});

test('adicionarNotaFiscalCarga: acrescenta uma 2ª linha de NF, e recusa repetida', async () => {
  const cargas = mockColecao([CARGA_PRONTA]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas, recebimento_motoristas: mockColecao([]) });
  await window.abrirExpedicaoCarga('c1');

  document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-input="0"]').value = '100';
  window.adicionarNotaFiscalCarga();
  assert.ok(document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-input="1"]'), 'deveria ter aberto uma 2ª linha de NF');

  document.getElementById('carga-expedicao-nf-lista').querySelector('[data-cnf-input="1"]').value = '100';
  window.adicionarNotaFiscalCarga();
  assert.match(document.getElementById('carga-expedicao-status').textContent, /já foi adicionada/i);
});
