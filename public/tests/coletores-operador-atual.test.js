// BUGS AO VIVO REAIS relatados pelo usuário direto no painel (não
// suposição): (1) "sempre que pede autorização de um coletor e eu vou
// autorizar eu já coloco um nome novo, ele nunca salva com o nome que eu
// coloco, só salva quando coloco depois" — o modal "Configurar Coletor"
// tinha o campo de nome e os botões de ação (aprovar/reprovar/...) como
// DUAS escritas totalmente separadas; clicar em "Aprovar acesso" nunca lia
// o campo de nome. (2) "fica com o nome da pessoa o tempo todo... quando
// não tiver ninguém logado tem que ficar vazio" — `operador_atual` era
// gravado no login mas nunca limpo no logout (só no encerramento formal de
// turno), então a tela do Analista mostrava o operador anterior pra
// sempre, mesmo com o coletor offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const jsColetor = path.join(__dirname, '..', 'js', 'coletor');
const jsAnalista = path.join(__dirname, '..', 'js', 'analista');
const jsShared = path.join(__dirname, '..', 'js', 'shared');

// ── (1) Coletor: marcarColetorOffline() limpa operador_atual/sessao no logout ──
test('marcarColetorOffline(): logout normal (sem encerrar turno) limpa operador_atual/email/uid e sessao — não deixa "fantasma" do operador anterior', async () => {
  const escritas = [];
  const doc = {
    update: async (payload) => { escritas.push(payload); },
  };
  const context = {
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => 'FV_DELETE' } } },
    ST: () => 'SERVER_TS', // const ST = firebase.firestore.FieldValue.serverTimestamp — fora do trecho recortado abaixo
    FCOL: { coletores: 'dt_coletores' },
    FS: { collection: () => ({ doc: () => doc }) },
    APP: { turnoEncerrado: false },
    obterDeviceId: () => 'dev123',
    dbg: () => {},
    console,
  };
  vm.createContext(context);
  const codigo = fs.readFileSync(path.join(jsColetor, '02-sync-dispositivo.js'), 'utf8');
  // Só a função que este teste exercita — o arquivo inteiro depende de
  // muita coisa de tela (goScreen, toast, AUTH...) que não importa aqui.
  const trecho = codigo.slice(codigo.indexOf('async function marcarColetorOffline'), codigo.indexOf('/**\n * Encerra o turno'));
  vm.runInContext(trecho + '\nthis.marcarColetorOffline = marcarColetorOffline;', context, { filename: '02-sync-dispositivo.js' });

  await context.marcarColetorOffline();

  assert.equal(escritas.length, 1);
  const payload = escritas[0];
  assert.equal(payload.status, 'offline');
  assert.equal(payload.sessao, null); // sem depender de turnoEncerrado
  assert.equal(payload.operador_atual, null);
  assert.equal(payload.operador_email, null);
  assert.equal(payload.operador_uid, null);
});

// ── (2) Analista: logoutOperadorColetor() agora escreve no Firestore também ──
function loadColetoresAnalista(colecoes) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const registroFS = new Map(Object.entries(colecoes || {}));
  win.FS_AN = {
    collection: (nome) => ({
      doc: (id) => ({
        set: async (payload, opts) => {
          const atual = registroFS.get(id) || {};
          registroFS.set(id, (opts && opts.merge) ? { ...atual, ...payload } : payload);
        },
      }),
    }),
  };
  win.firebase = { auth: () => ({ currentUser: null }), firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => 'FV_DELETE' } } };
  win.openModal = () => {}; win.closeModal = () => {};
  win.showToast = () => {};
  win.logAuditoria = () => {};
  win.renderColetores = () => {}; // definida em 35-coletores-render.js, não carregado aqui — este teste só cobre a escrita/estado, não a tela
  const estado = { coletores: [], contagens: [], inventarios: [] };
  win.AnalistaStore = { getState: () => estado };
  win.AnalistaState = { replaceSlice: (chave, valor) => { estado[chave] = valor; } };
  win.localStorage = { getItem: () => null, setItem: () => {} };
  // 34-coletores-modelo-dispositivo.js chama setInterval(verificarStatusColetores,
  // 15000) no topo do arquivo — sem cancelar, isso mantém o processo do
  // Node vivo pra sempre em teste (achado ao vivo rodando esta suíte: o
  // teste "travava" sem nunca terminar). Não precisamos desse polling aqui.
  win.setInterval = () => 0;
  // common-utils.js começa com 'use strict' — concatenar no MESMO eval que
  // 34 faz o script INTEIRO rodar em modo estrito, e nesse caso as
  // declarações de função de 34 silenciosamente PARAM de virar propriedade
  // de window (achado ao vivo rodando esta suíte: `typeof
  // win.logoutOperadorColetor` virava 'undefined' sem erro nenhum). Evals
  // SEPARADOS evitam isso — window.esc/etc já ficam expostos globalmente
  // pelo primeiro eval, então o segundo enxerga normalmente.
  const commonUtils = fs.readFileSync(path.join(jsShared, 'common-utils.js'), 'utf8');
  const codigo34 = fs.readFileSync(path.join(jsAnalista, '34-coletores-modelo-dispositivo.js'), 'utf8');
  win.eval(commonUtils);
  win.eval(codigo34);
  return { window: win, registroFS, estado };
}

test('logoutOperadorColetor() (Analista, "Forçar logout"): agora grava no Firestore, limpando operador_atual/sessao — antes só mexia em estado local, deixando o nome "fantasma" sobreviver à próxima leitura', async () => {
  const { window, registroFS, estado } = loadColetoresAnalista({
    col1: { operador_atual: 'Ana', sessao: { operador: 'Ana' }, status: 'online' },
  });
  estado.coletores = [{ id: 'col1', numero: '01', sessao: { operador: 'Ana' }, status: 'online', operador_atual: 'Ana' }];

  await window.logoutOperadorColetor('col1');

  const gravado = registroFS.get('col1');
  assert.equal(gravado.operador_atual, null);
  assert.equal(gravado.operador_email, null);
  assert.equal(gravado.operador_uid, null);
  assert.equal(gravado.sessao, null);
  assert.equal(gravado.status, 'offline');
  // estado local também some, pra tela não esperar um refresh
  assert.equal(estado.coletores[0].operador_atual, null);
});

// ── (3) Analista: modal "Configurar Coletor" salva o nome digitado JUNTO com aprovar/reprovar/etc ──
function loadModalConfigColetor(col) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const registroFS = new Map();
  win.FS_AN = {
    collection: () => ({
      doc: (id) => ({
        update: async (payload) => { registroFS.set(id, { ...(registroFS.get(id) || {}), ...payload }); },
        set: async (payload, opts) => { const atual = registroFS.get(id) || {}; registroFS.set(id, (opts && opts.merge) ? { ...atual, ...payload } : payload); },
      }),
    }),
  };
  win.firebase = { auth: () => ({ currentUser: null }), firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', delete: () => 'FV_DELETE' } } };
  win.showToast = () => {};
  win.logAuditoria = () => {};
  const estado = { coletores: [col], contagens: [], inventarios: [] };
  win.AnalistaStore = { getState: () => estado };
  win.AnalistaState = { replaceSlice: (chave, valor) => { estado[chave] = valor; } };
  win.localStorage = { getItem: () => null, setItem: () => {} };
  win.setInterval = () => 0; // ver comentário em loadColetoresAnalista acima
  // Evals separados — mesmo motivo do 'use strict' em loadColetoresAnalista acima.
  const commonUtils = fs.readFileSync(path.join(jsShared, 'common-utils.js'), 'utf8');
  const codigo34 = fs.readFileSync(path.join(jsAnalista, '34-coletores-modelo-dispositivo.js'), 'utf8');
  const codigo35 = fs.readFileSync(path.join(jsAnalista, '35-coletores-render.js'), 'utf8');
  win.eval(commonUtils);
  win.eval(codigo34);
  win.eval(codigo35);
  return { window: win, document: win.document, registroFS, estado };
}

// ── (4) Analista: excluirColetor() atualiza a tela na hora, sem esperar o onSnapshot ──
// BUG AO VIVO REAL: "fala que foi excluído mas não some" — a escrita no
// Firestore acontecia normal (por isso o toast de sucesso aparecia), mas a
// linha continuava na tabela porque nada atualizava o estado local nem
// chamava renderColetores() — a tela dependia inteiramente do listener em
// tempo real voltar. Mesma classe de bug já corrigida em
// logoutOperadorColetor() (teste acima).
test('REGRESSÃO ("fala que foi excluído mas não some"): excluirColetor() remove o item do estado local e chama renderColetores() na hora, sem esperar o Firestore avisar de volta', async () => {
  const { window, registroFS, estado } = loadColetoresAnalista({
    col1: { aprovado: 'aprovado', status: 'online', numero: '01' },
  });
  estado.coletores = [{ id: 'col1', numero: '01', aprovado: 'aprovado', status: 'online' }];
  window.confirm = () => true;
  let renderChamado = 0;
  window.renderColetores = () => { renderChamado++; };

  const resultado = await window.excluirColetor('col1');

  assert.equal(resultado, true);
  assert.equal(estado.coletores.length, 0, 'o coletor excluído precisa sumir do estado local imediatamente');
  assert.equal(renderChamado, 1, 'a tela precisa ser redesenhada na hora, não só quando o onSnapshot voltar');
  const gravado = registroFS.get('col1');
  assert.equal(gravado.excluido, true);
  assert.equal(gravado.aprovado, 'revogado');
});

test('REGRESSÃO: aprovarColetor() também atualiza o estado local e redesenha a tela na hora', async () => {
  const { window, estado } = loadColetoresAnalista({
    col2: { aprovado: 'pendente', status: 'pendente', numero: '02' },
  });
  estado.coletores = [{ id: 'col2', numero: '02', aprovado: 'pendente', status: 'pendente' }];
  let renderChamado = 0;
  window.renderColetores = () => { renderChamado++; };

  await window.aprovarColetor('col2');

  assert.equal(estado.coletores[0].aprovado, 'aprovado', 'o status precisa mudar no estado local na hora, não só depois de um refresh');
  assert.equal(renderChamado, 1);
});

test('REGRESSÃO (bug ao vivo real: "eu já coloco um nome novo, ele nunca salva... só salva quando coloco depois"): digitar um nome novo e clicar em "Aprovar acesso" salva o nome E aprova na MESMA ação', async () => {
  const { window, document, registroFS } = loadModalConfigColetor({
    id: 'colX', numero: '07', device_id: 'DEV-XYZ-0000000000', aprovado: 'pendente', status: 'offline', nome_exibicao: '', sessao: null,
  });

  window.abrirConfigColetor('colX');
  const input = document.getElementById('modal-nome-coletor-input');
  input.value = 'Coletor Câmara Fria';
  const btnAprovar = document.querySelector('[data-cfg-acao="aprovar"]');
  assert.ok(btnAprovar, 'botão de aprovar precisa existir pra um coletor pendente');

  btnAprovar.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  // dá uma volta no loop de eventos pros awaits internos (salvarNomeSeAlterado + aprovarColetor) completarem
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  const gravado = registroFS.get('colX');
  assert.equal(gravado.nome_exibicao, 'Coletor Câmara Fria'); // o nome digitado NÃO se perdeu
  assert.equal(gravado.aprovado, 'aprovado'); // e a aprovação também aconteceu
});
