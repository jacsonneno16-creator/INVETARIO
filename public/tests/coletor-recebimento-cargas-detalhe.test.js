// Coletor > Recebimento > Nova Movimentação > Transbordo de mercadorias >
// Detalhe da carga (EM_TRANSITO/RECEBIDA/CANCELADA).
//
// BUG AO VIVO REAL (2026-09-08): antes desta tela existir, abrir uma carga
// que não estava mais PENDENTE não tinha NENHUM lugar pra ir — a tela de
// Expedição só mostrava um toast "já foi expedida" e voltava pra lista.
// `abrirDetalheCarga` é a tela nova (só leitura, por enquanto — vínculo
// nota-produto e correção de capa entram nos próximos passos do plano)
// pra ver Notas Fiscais + Itens de uma carga já expedida/recebida.
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
  const listenersWhere = [];
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
      return { id: docId, get: async () => { const data = registro.get(docId); return { exists: data !== undefined, id: docId, data: () => data }; } };
    },
    where: (campo, op, valor) => {
      const filtrados = () => [...registro.entries()].filter(([, data]) => data && data[campo] === valor);
      return {
        get: async () => snapshot(filtrados()),
        // Simula o onSnapshot real: dispara imediato com o estado atual
        // (mesmo comportamento do Firestore de verdade) e devolve uma
        // função de "unsubscribe". `_dispararSnapshotsWhere()` (abaixo)
        // deixa o teste simular uma mudança remota chegando depois.
        onSnapshot: (cb, errCb) => {
          const entry = { campo, valor, cb, errCb };
          listenersWhere.push(entry);
          try { cb(snapshot(filtrados())); } catch (e) { if (errCb) errCb(e); }
          return () => { const i = listenersWhere.indexOf(entry); if (i >= 0) listenersWhere.splice(i, 1); };
        },
      };
    },
    _registro: registro,
    _dispararSnapshotsWhere: () => {
      listenersWhere.forEach(l => {
        const filtrados = [...registro.entries()].filter(([, data]) => data && data[l.campo] === l.valor);
        try { l.cb(snapshot(filtrados)); } catch (e) { if (l.errCb) l.errCb(e); }
      });
    },
  };
}

const SHELL = `<!doctype html><html><body>
<div id="cargas-lista-itens"></div>
<div id="carga-montagem-resumo"></div>
<div id="carga-montagem-pendencia"></div>
<input id="carga-montagem-capa">
<input id="carga-montagem-produto-codigo">
<div id="carga-montagem-produto-nome"></div>
<input id="carga-montagem-quantidade">
<div id="carga-montagem-status"></div>
<div id="carga-montagem-lista-itens"></div>
<div id="carga-expedicao-resumo"></div>
<select id="carga-expedicao-motorista"></select>
<div id="carga-expedicao-nf-lista"></div>
<div id="carga-expedicao-status"></div>
<div id="carga-detalhe-resumo"></div>
<div id="carga-detalhe-pendencia"></div>
<div id="carga-detalhe-nf"></div>
<div id="carga-detalhe-notas-produtos"></div>
<div id="carga-detalhe-itens"></div>
</body></html>`;

// `.batch()` reaproveita os próprios `.update()`/`.delete()` já definidos
// em cada doc-ref do mockColecao acima — mesmo espírito do mock de batch
// já usado em recebimento-cargas-cards-analista.test.js (Analista).
function mockBatch() {
  const ops = [];
  return {
    update: (ref, payload) => ops.push(() => ref.update(payload)),
    set: (ref, payload, opts) => ops.push(() => (ref.set ? ref.set(payload, opts) : ref.update(payload))),
    delete: ref => ops.push(() => ref.delete()),
    commit: async () => { for (const op of ops) await op(); },
  };
}

// Substituto leve de `_criarModal` (real em 07-etapa-endereco.js, não
// carregado aqui de propósito — arquivo grande e sem relação com Cargas).
// Reproduz só o essencial: os botões viram elementos clicáveis de verdade
// (`data-modal-botao`), e o clique remove o modal ANTES de rodar `acao()`
// — exatamente a ordem real (`_corrigirCapaBluesoft` captura a referência
// do input ANTES dessa remoção, por causa disso).
function instalarModalFake(win) {
  win._criarModal = function (opts) {
    const modal = win.document.createElement('div');
    modal.id = '_modal_teste';
    modal.innerHTML = '<div data-modal-icone>' + (opts.icone || '') + '</div><div data-modal-titulo>' + (opts.titulo || '') + '</div>'
      + opts.corpo + (opts.botoes || []).map((b, i) => '<button type="button" data-modal-botao="' + i + '">' + b.label + '</button>').join('');
    win.document.body.appendChild(modal);
    (opts.botoes || []).forEach((b, i) => {
      modal.querySelector('[data-modal-botao="' + i + '"]').addEventListener('click', function () {
        modal.remove();
        if (b.acao) b.acao();
      });
    });
  };
}

function loadCargas(colecoes, opts) {
  const telas = [];
  const toasts = [];
  const dom = new JSDOM(SHELL, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const lojas = mockColecao([{ id: (opts && opts.lojaId) || 'loja1', data: { nome: (opts && opts.lojaNome) || 'Loja Matriz' } }]);
  win.FS = { collection: nome => (colecoes && colecoes[nome]) || mockColecao([]), batch: mockBatch };
  win.APP = { operador: { email: 'operador@daterrinha.com' } };
  win.goScreen = id => { telas.push(id); };
  win.toast = (msg, tipo) => { toasts.push({ msg, tipo }); };
  win.getDTLojaAtiva = () => (opts && opts.lojaId) || 'loja1';
  win.getDTRawFirestore = () => ({ collection: nome => (nome === 'lojas' ? lojas : mockColecao([])) });
  win._aplicarMovimentoLedger = async () => {};
  instalarModalFake(win);
  Object.defineProperty(win.navigator, 'onLine', { get: () => true, configurable: true });
  win.eval(recCode);
  win.eval(cargasCode);
  return { window: win, document, telas, toasts };
}

test('abrirCargaPorId: carga PENDENTE sem paletes físicos vai pra montagem', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga', status: 'PENDENTE' } }]);
  const { window, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await window.abrirCargaPorId('c1');
  assert.ok(telas.includes('carga-montagem'));
});

test('abrirCargaPorId: carga PENDENTE pronta (com totalPaletesFisico) vai pra expedição', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga', status: 'PENDENTE', totalPaletesFisico: 3 } }]);
  const { window, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await window.abrirCargaPorId('c1');
  assert.ok(telas.includes('carga-expedicao'));
});

['EM_TRANSITO', 'RECEBIDA', 'CANCELADA'].forEach(status => {
  test('abrirCargaPorId: carga ' + status + ' vai pra tela de detalhe', async () => {
    const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga', status } }]);
    const { window, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });
    await window.abrirCargaPorId('c1');
    assert.ok(telas.includes('carga-detalhe'));
  });
});

test('abrirCargaPorId: carga inexistente avisa e não navega pra nenhuma tela', async () => {
  const cargas = mockColecao([]);
  const { window, telas, toasts } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await window.abrirCargaPorId('nao-existe');
  assert.equal(telas.length, 0);
  assert.ok(toasts.some(t => /não encontrada/i.test(t.msg)));
});

// BUG AO VIVO REAL (2026-09-08): "quando eu clico em corrigir... ele abre
// como se fosse expedir a carga, coloca pra selecionar o motorista e
// colocar a nota, mas tem que aparecer os paletes que foram adicionados e
// ele poder alterar o número da capa" — uma carga PENDENTE já "pronta pra
// expedição" (montagem finalizada, `totalPaletesFisico` gravado) mas AINDA
// não expedida caía na tela de Expedição (motorista/NF) mesmo tendo uma
// pendência de capa aberta — a tela de Expedição não mostra item nenhum.
test('abrirCargaPorId: carga PENDENTE "pronta pra expedição" mas COM pendência de capa vai pra tela de DETALHE (itens + correção), não pra Expedição', async () => {
  const cargas = mockColecao([{
    id: 'c1', data: {
      nomeCarga: 'Carga', status: 'PENDENTE', totalPaletesFisico: 3, temPendenciaCapa: true,
      pendenciasCapaAbertas: [{ itemId: 'i1', capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca' }],
    },
  }]);
  const { window, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await window.abrirCargaPorId('c1');
  assert.ok(telas.includes('carga-detalhe'));
  assert.ok(!telas.includes('carga-expedicao'), 'não pode pedir motorista/NF antes de corrigir a capa');
});

test('abrirCargaPorId: carga PENDENTE "pronta pra expedição" SEM pendência continua indo normalmente pra Expedição', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga', status: 'PENDENTE', totalPaletesFisico: 3 } }]);
  const { window, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await window.abrirCargaPorId('c1');
  assert.ok(telas.includes('carga-expedicao'));
});

test('abrirExpedicaoCarga (chamada direta): guarda defensiva manda pra tela de detalhe quando a carga tem pendência de capa, mesmo ainda PENDENTE', async () => {
  const cargas = mockColecao([{
    id: 'c1', data: { nomeCarga: 'Carga', status: 'PENDENTE', totalPaletesFisico: 3, temPendenciaCapa: true },
  }]);
  const { window, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await window.abrirExpedicaoCarga('c1');
  assert.ok(telas.includes('carga-detalhe'));
  assert.ok(!telas.includes('carga-expedicao'));
});

test('abrirDetalheCarga: mostra resumo (nome → destino · status), Notas Fiscais e Itens (por capa)', async () => {
  const cargas = mockColecao([{
    id: 'c1', data: {
      nomeCarga: 'Carga Filial 08/09', status: 'EM_TRANSITO', destinoNome: 'Loja Filial',
      notasFiscais: [{ numero: '55501', volumes: 65 }],
    },
  }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });
  // Bipa 1 item direto na subcoleção antes de abrir, pra confirmar que a
  // tela de detalhe também carrega itens (mesma função _carregarItensCarga
  // já usada pela Montagem, sem leitura nova).
  await cargas.doc('c1').collection('itens').add({ capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Arroz 5kg', quantidade: 40 });

  await window.abrirDetalheCarga('c1');

  const resumo = document.getElementById('carga-detalhe-resumo').textContent;
  assert.match(resumo, /Carga Filial 08\/09/);
  assert.match(resumo, /Loja Filial/);
  assert.match(resumo, /Expedida/);
  const nf = document.getElementById('carga-detalhe-nf').innerHTML;
  assert.match(nf, /55501/);
  assert.match(nf, /65 volume/);
  const itens = document.getElementById('carga-detalhe-itens').innerHTML;
  assert.match(itens, /CAPA-001/);
  assert.match(itens, /Arroz 5kg/);
});

test('abrirDetalheCarga: sem notas fiscais e sem itens, mostra os dois avisos de "nenhum" (não quebra, não fica em branco)', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga vazia', status: 'RECEBIDA' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.abrirDetalheCarga('c1');

  assert.match(document.getElementById('carga-detalhe-nf').innerHTML, /Nenhuma nota fiscal registrada/);
  assert.match(document.getElementById('carga-detalhe-itens').innerHTML, /Nenhum item bipado ainda/);
});

test('abrirDetalheCarga: carga inexistente avisa e não navega', async () => {
  const cargas = mockColecao([]);
  const { window, telas, toasts } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await window.abrirDetalheCarga('nao-existe');
  assert.equal(telas.length, 0);
  assert.ok(toasts.some(t => /não encontrada/i.test(t.msg)));
});

// PEDIDO AO VIVO (2026-09-08): "quando o operador abrir a carga... o
// sistema apresenta: Nota 123456 / produto — volumes... sem digitar de
// novo" — lê `notasFiscaisProdutos` que o Analista já vinculou, e mostra a
// quantidade JÁ BIPADA (soma dos itens, recalculada ao vivo — nunca lida
// de um campo de volume salvo no vínculo).
test('abrirDetalheCarga: mostra "Notas × Produtos" com a quantidade já bipada, sem pedir pra digitar de novo', async () => {
  const cargas = mockColecao([{
    id: 'c1', data: {
      nomeCarga: 'Carga Filial', status: 'EM_TRANSITO', destinoNome: 'Loja Filial',
      notasFiscaisProdutos: [{ numero: '123456', produtos: [{ codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }] }],
    },
  }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await cargas.doc('c1').collection('itens').add({ capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20 });

  await window.abrirDetalheCarga('c1');

  const html = document.getElementById('carga-detalhe-notas-produtos').innerHTML;
  assert.match(html, /Nota 123456/);
  assert.match(html, /Tapioca 1kg Fardo/);
  assert.match(html, /20 volume/);
});

test('abrirDetalheCarga: quantidade da nota-produto é recalculada ao vivo — soma TODOS os itens do mesmo produto, mesmo em capas diferentes', async () => {
  const cargas = mockColecao([{
    id: 'c1', data: {
      nomeCarga: 'Carga Filial', status: 'EM_TRANSITO',
      notasFiscaisProdutos: [{ numero: '123456', produtos: [{ codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }] }],
    },
  }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });
  await cargas.doc('c1').collection('itens').add({ capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20 });
  await cargas.doc('c1').collection('itens').add({ capa: 'CAPA-002', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 5 });

  await window.abrirDetalheCarga('c1');

  assert.match(document.getElementById('carga-detalhe-notas-produtos').innerHTML, /25 volume/);
});

test('abrirDetalheCarga: sem nenhum produto vinculado a nota, a seção "Notas × Produtos" fica vazia (não mostra título nem quebra)', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga', status: 'RECEBIDA' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.abrirDetalheCarga('c1');

  assert.equal(document.getElementById('carga-detalhe-notas-produtos').innerHTML, '');
});

// PEDIDO AO VIVO (2026-09-08): "quando o operador abrir uma carga que
// possui uma capa-palete com erro, mostrar claramente que existe uma
// pendência" — banner de aviso, lido via .get() normal (sem depender do
// listener em tempo real), tanto na tela de Detalhe quanto na de Montagem
// (uma carga pode ganhar pendência ainda em montagem).
test('banner de pendência: aparece em abrirDetalheCarga quando a carga tem pendenciasCapaAbertas', async () => {
  const cargas = mockColecao([{
    id: 'c1', data: {
      nomeCarga: 'Carga', status: 'EM_TRANSITO', temPendenciaCapa: true,
      pendenciasCapaAbertas: [{ itemId: 'i1', capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca' }],
    },
  }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.abrirDetalheCarga('c1');

  assert.match(document.getElementById('carga-detalhe-pendencia').innerHTML, /1 capa\(s\) pendente/);
});

test('banner de pendência: aparece em abrirMontagemCarga (a carga pode ganhar pendência ainda sendo montada)', async () => {
  const cargas = mockColecao([{
    id: 'c1', data: { nomeCarga: 'Carga', status: 'PENDENTE', temPendenciaCapa: true, pendenciasCapaAbertas: [{ itemId: 'i1', capa: 'CAPA-001' }, { itemId: 'i2', capa: 'CAPA-002' }] },
  }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.abrirMontagemCarga('c1');

  assert.match(document.getElementById('carga-montagem-pendencia').innerHTML, /2 capa\(s\) pendente/);
});

test('banner de pendência: sem nenhuma pendência, fica vazio (não quebra, não mostra nada)', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga', status: 'EM_TRANSITO' } }]);
  const { window, document } = loadCargas({ recebimento_transbordo_cargas: cargas });

  await window.abrirDetalheCarga('c1');

  assert.equal(document.getElementById('carga-detalhe-pendencia').innerHTML, '');
});

// PEDIDO AO VIVO (2026-09-08): "selecionar a capa-palete que está errada...
// informar o novo número... enviar a correção" — item continua o MESMO
// doc, só `capa` muda de valor de verdade; `bluesoftHistorico` guarda o
// registro completo, nunca sobrescrito; NUNCA mexe em `status` da carga.
async function montarCargaComItemPendente() {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga', status: 'EM_TRANSITO' } }]);
  const itemRef = await cargas.doc('c1').collection('itens').add({
    capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', quantidade: 20,
    bluesoftPendente: true, bluesoftPendenteDesde: '2026-09-08T10:00:00.000Z', bluesoftPendenteMarcadoPor: 'analista@daterrinha.com',
  });
  await cargas.doc('c1').update({
    temPendenciaCapa: true,
    pendenciasCapaAbertas: [{ itemId: itemRef.id, capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo', marcadoEm: '2026-09-08T10:00:00.000Z', marcadoPor: 'analista@daterrinha.com' }],
  });
  const ambiente = loadCargas({ recebimento_transbordo_cargas: cargas });
  await ambiente.window.abrirDetalheCarga('c1');
  return Object.assign(ambiente, { cargas, itemId: itemRef.id });
}

test('corrigirCapaBluesoft: corrige a capa, marca bluesoftCorrigido, anexa histórico, e fecha a pendência da carga (sem mexer em status)', async () => {
  const { window, document, cargas, itemId } = await montarCargaComItemPendente();

  window._recebimentoCargasInternals.corrigirCapaBluesoft(itemId);
  document.getElementById('_corr_capa_nova').value = 'CAPA-999';
  document.querySelector('[data-modal-botao="1"]').click();
  await new Promise(r => setTimeout(r, 0));

  const itemSalvo = (await cargas.doc('c1').collection('itens').doc(itemId).get()).data();
  assert.equal(itemSalvo.capa, 'CAPA-999');
  assert.equal(itemSalvo.bluesoftPendente, false);
  assert.equal(itemSalvo.bluesoftCorrigido, true);
  assert.equal(itemSalvo.bluesoftHistorico.length, 1);
  assert.equal(itemSalvo.bluesoftHistorico[0].capaAnterior, 'CAPA-001');
  assert.equal(itemSalvo.bluesoftHistorico[0].capaNova, 'CAPA-999');
  assert.equal(itemSalvo.bluesoftHistorico[0].corrigidoPor, 'operador@daterrinha.com');

  const cargaSalva = (await cargas.doc('c1').get()).data();
  assert.equal(cargaSalva.temPendenciaCapa, false);
  assert.equal(cargaSalva.pendenciasCapaAbertas.length, 0);
  assert.equal(cargaSalva.status, 'EM_TRANSITO', 'corrigir a capa não pode mexer no status da carga');

  assert.doesNotMatch(document.getElementById('carga-detalhe-pendencia').innerHTML, /pendente/);
  assert.match(document.getElementById('carga-detalhe-itens').innerHTML, /CAPA-999/);
});

test('corrigirCapaBluesoft: recusa capa nova vazia — não grava nada', async () => {
  const { window, document, cargas, itemId } = await montarCargaComItemPendente();

  window._recebimentoCargasInternals.corrigirCapaBluesoft(itemId);
  document.getElementById('_corr_capa_nova').value = '';
  document.querySelector('[data-modal-botao="1"]').click();
  await new Promise(r => setTimeout(r, 0));

  const itemSalvo = (await cargas.doc('c1').collection('itens').doc(itemId).get()).data();
  assert.equal(itemSalvo.capa, 'CAPA-001', 'não pode ter mudado');
  assert.equal(itemSalvo.bluesoftCorrigido, undefined);
});

test('corrigirCapaBluesoft: recusa capa nova igual à antiga', async () => {
  const { window, document, cargas, itemId } = await montarCargaComItemPendente();

  window._recebimentoCargasInternals.corrigirCapaBluesoft(itemId);
  document.getElementById('_corr_capa_nova').value = 'CAPA-001';
  document.querySelector('[data-modal-botao="1"]').click();
  await new Promise(r => setTimeout(r, 0));

  const cargaSalva = (await cargas.doc('c1').get()).data();
  assert.equal(cargaSalva.temPendenciaCapa, true, 'não pode ter fechado a pendência com uma "correção" que não corrigiu nada');
});

test('corrigirCapaBluesoft: recusa capa que já existe em OUTRO item da mesma carga (mesma checagem da montagem)', async () => {
  const { window, document, cargas, itemId } = await montarCargaComItemPendente();
  await cargas.doc('c1').collection('itens').add({ capa: 'CAPA-002', codigoProduto: '1002', nomeProduto: 'Produto B', quantidade: 10 });
  await window.abrirDetalheCarga('c1'); // relê itens (agora com CAPA-002 também)

  window._recebimentoCargasInternals.corrigirCapaBluesoft(itemId);
  document.getElementById('_corr_capa_nova').value = 'CAPA-002';
  document.querySelector('[data-modal-botao="1"]').click();
  await new Promise(r => setTimeout(r, 0));

  const itemSalvo = (await cargas.doc('c1').collection('itens').doc(itemId).get()).data();
  assert.equal(itemSalvo.capa, 'CAPA-001', 'não pode ter trocado pra uma capa duplicada');
});

test('corrigirCapaBluesoft: "Cancelar" não altera nada', async () => {
  const { window, document, cargas, itemId } = await montarCargaComItemPendente();

  window._recebimentoCargasInternals.corrigirCapaBluesoft(itemId);
  document.querySelector('[data-modal-botao="0"]').click(); // Cancelar

  const itemSalvo = (await cargas.doc('c1').collection('itens').doc(itemId).get()).data();
  assert.equal(itemSalvo.capa, 'CAPA-001');
  assert.equal(itemSalvo.bluesoftPendente, true);
});

test('item pendente mostra o botão "CORRIGIR CAPA"; item sem pendência não mostra', async () => {
  const { document } = await montarCargaComItemPendente();
  assert.ok(document.querySelector('[data-corrigir-capa]'), 'item pendente precisa ter o botão de corrigir');
});

// PEDIDO AO VIVO (2026-09-08): "essa notificação deve aparecer para o
// operador mesmo que ele esteja em outra tela/login... tempo real" — 1
// listener só (`where('temPendenciaCapa','==',true)`), reiniciado no
// evento `dt-loja-alterada` (dispara tanto no login quanto na troca de
// loja). "FECHAR" só esconde — a pendência continua até ser corrigida de
// verdade.
function montarCargaComPendenciaParaListener(dadosExtrasNaData) {
  const cargas = mockColecao([{
    id: 'c1', data: Object.assign({
      nomeCarga: 'Carga com erro', status: 'EM_TRANSITO', temPendenciaCapa: true,
      pendenciasCapaAbertas: [{ itemId: 'i1', capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }],
    }, dadosExtrasNaData || {}),
  }]);
  const ambiente = loadCargas({ recebimento_transbordo_cargas: cargas });
  return Object.assign(ambiente, { cargas });
}

test('listener de pendência: dispara o card de alerta assim que reinicia (dt-loja-alterada), com capa/produto/carga certos', () => {
  const { window, document, cargas } = montarCargaComPendenciaParaListener();

  window._recebimentoCargasInternals.reiniciarListenerPendenciasCarga();

  const modal = document.getElementById('_modal_teste');
  assert.ok(modal, 'card de alerta precisa aparecer');
  assert.match(modal.innerHTML, /ATENÇÃO — CAPA-PALETE COM ERRO/);
  assert.match(modal.innerHTML, /CAPA-001/);
  assert.match(modal.innerHTML, /Tapioca 1kg Fardo/);
  assert.match(modal.innerHTML, /Carga com erro/);
  assert.match(modal.innerHTML, /FECHAR/);
  assert.match(modal.innerHTML, /CORRIGIR AGORA/);
});

test('listener de pendência: "FECHAR" só esconde o card — não escreve nada no Firestore, pendência continua', () => {
  const { window, document, cargas } = montarCargaComPendenciaParaListener();
  window._recebimentoCargasInternals.reiniciarListenerPendenciasCarga();
  assert.ok(document.getElementById('_modal_teste'));

  document.querySelector('[data-modal-botao="0"]').click(); // FECHAR

  assert.equal(document.getElementById('_modal_teste'), null, 'card some da tela');
  const cargaSalva = cargas._registro.get('c1');
  assert.equal(cargaSalva.temPendenciaCapa, true, 'pendência continua no Firestore — FECHAR não resolve nada');
});

test('listener de pendência: "CORRIGIR AGORA" navega pra tela da carga (abrirCargaPorId) e fecha o card', async () => {
  const { window, document, telas } = montarCargaComPendenciaParaListener();
  window._recebimentoCargasInternals.reiniciarListenerPendenciasCarga();

  document.querySelector('[data-modal-botao="1"]').click(); // CORRIGIR AGORA
  await new Promise(r => setTimeout(r, 0));

  assert.equal(document.getElementById('_modal_teste'), null);
  assert.ok(telas.includes('carga-detalhe'), 'carga EM_TRANSITO tem que abrir a tela de detalhe');
});

// BUG AO VIVO REAL (2026-09-08, "VOLTOU"): "clico em corrigir... aparece na
// tela de expedir carga" — de novo, mas por um motivo NOVO desta vez. O
// roteamento de abrirCargaPorId em si estava certo; o problema era que ele
// lê de CARGAS_CACHE, e o listener de pendência NUNCA atualizava esse
// cache — só empilhava um objeto carga fresco à parte, na fila de alerta.
// Cenário real: operador já com a lista de cargas carregada (cache com
// temPendenciaCapa:false) quando o Analista marca a pendência em outra
// sessão — "CORRIGIR AGORA" chamava abrirCargaPorId só com o ID, que lia
// o cache DESATUALIZADO e mandava pra Expedição por engano.
test('BUG AO VIVO REAL (voltou): carga PENDENTE pronta cuja pendência chegou DEPOIS da lista já carregada (cache desatualizado) — "CORRIGIR AGORA" precisa ir pro detalhe, nunca pra expedição', async () => {
  const cargas = mockColecao([{ id: 'c1', data: { nomeCarga: 'Carga com erro', status: 'PENDENTE', totalPaletesFisico: 5, temPendenciaCapa: false } }]);
  const { window, document, telas } = loadCargas({ recebimento_transbordo_cargas: cargas });

  // Lista já carregada ANTES de existir qualquer pendência — cache fica
  // com temPendenciaCapa:false, exatamente o estado real de quando o
  // operador abriu a tela de Cargas mais cedo.
  await window.carregarCargasColetor();
  assert.equal(window._recebimentoCargasInternals.getCargas().find(c => c._id === 'c1').temPendenciaCapa, false);

  // Analista marca a pendência (grava direto no "Firestore", sem o
  // operador ter recarregado a lista).
  cargas._registro.set('c1', Object.assign({}, cargas._registro.get('c1'), {
    temPendenciaCapa: true,
    pendenciasCapaAbertas: [{ itemId: 'i1', capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' }],
  }));
  window._recebimentoCargasInternals.reiniciarListenerPendenciasCarga();

  document.querySelector('[data-modal-botao="1"]').click(); // CORRIGIR AGORA
  await new Promise(r => setTimeout(r, 0));

  assert.ok(telas.includes('carga-detalhe'), 'tem pendência ativa — precisa ir pro detalhe');
  assert.ok(!telas.includes('carga-expedicao'), 'nunca deveria cair na tela de expedição com pendência ativa');
});

test('listener de pendência: a MESMA pendência não gera um segundo alerta (dedup) mesmo com outro snapshot chegando sem mudança nenhuma', () => {
  const { window, document, cargas } = montarCargaComPendenciaParaListener();
  window._recebimentoCargasInternals.reiniciarListenerPendenciasCarga();
  document.querySelector('[data-modal-botao="0"]').click(); // fecha o 1º alerta
  assert.equal(document.getElementById('_modal_teste'), null);

  cargas._dispararSnapshotsWhere(); // simula o Firestore re-emitindo o mesmo doc

  assert.equal(document.getElementById('_modal_teste'), null, 'já foi alertado nesta sessão — não pode reaparecer sozinho');
  assert.equal(window._recebimentoCargasInternals.getFilaAlertasPendencia().length, 0);
});

test('listener de pendência: 2 capas pendentes na mesma carga viram 2 alertas em fila, um de cada vez', () => {
  const { window, document, cargas } = montarCargaComPendenciaParaListener({
    pendenciasCapaAbertas: [
      { itemId: 'i1', capa: 'CAPA-001', codigoProduto: '1001', nomeProduto: 'Tapioca 1kg Fardo' },
      { itemId: 'i2', capa: 'CAPA-002', codigoProduto: '1002', nomeProduto: 'Produto B' },
    ],
  });

  window._recebimentoCargasInternals.reiniciarListenerPendenciasCarga();
  assert.match(document.getElementById('_modal_teste').innerHTML, /CAPA-001/);

  document.querySelector('[data-modal-botao="0"]').click(); // fecha o 1º

  assert.match(document.getElementById('_modal_teste').innerHTML, /CAPA-002/, 'o 2º alerta aparece assim que o 1º fecha');
});

test('listener de pendência: dt-loja-alterada reinicia o listener (dispara de novo o dedup do zero)', () => {
  const { window, document, cargas } = montarCargaComPendenciaParaListener();

  window.dispatchEvent(new window.Event('dt-loja-alterada'));

  assert.ok(document.getElementById('_modal_teste'), 'o próprio evento de troca de loja já reinicia o listener e mostra o alerta');
});
