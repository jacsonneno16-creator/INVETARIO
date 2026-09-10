// PEDIDO AO VIVO (2026-09-08): "quero que em todo login criado, no
// primeiro acesso da pessoa peça pra alterar para uma nova senha, com
// confirmação, mas isso só pra acessos de pessoas que têm Analista, só
// pra Coletor não é necessário" — 00-auth-login.js (login do Analista)
// não tinha NENHUM teste até esta mudança; harness novo do zero.
//
// `usuarios_acessos/{uid}.precisaTrocarSenha` só existe em contas criadas
// depois desta mudança (37-usuarios-permissoes.js/criarOperador, coberto
// em usuarios-permissoes-contas-vinculadas.test.js) e só quando o canal
// Analista é marcado — o Coletor (04-auth-login.js, arquivo/app
// totalmente separado) nunca lê este campo, então não precisa de nenhum
// teste aqui pra "provar que não afeta o Coletor".
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '../js/analista/00-auth-login.js'), 'utf8');

function mockColecaoAcesso(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  return {
    doc: id => ({
      get: async () => { const data = registro.get(id); return { exists: data !== undefined, id, data: () => data }; },
      update: async payload => {
        const atual = registro.get(id);
        if (atual === undefined) throw new Error('NOT_FOUND: ' + id);
        registro.set(id, Object.assign({}, atual, payload));
      },
    }),
    add: async payload => { const id = 'novo' + registro.size; registro.set(id, payload); return { id }; }, // logSistema (dt_logs_analista) usa .add — não é o foco do teste, só evita ruído no console
    _registro: registro,
  };
}

const SHELL = `<!doctype html><html><body>
<div class="ativo" id="screen-login" style="display:none">
  <input id="an-email"><input id="an-pass"><input id="an-remember" type="checkbox">
  <button id="btn-login-analista"></button>
  <div id="login-error-msg"></div>
</div>
<div id="screen-primeiro-acesso" style="display:none">
  <input id="pa-senha" type="password"><input id="pa-senha-confirmar" type="password">
  <button id="btn-primeiro-acesso"></button>
  <div id="primeiro-acesso-erro"></div>
</div>
<div id="app-main" style="display:none">
  <div id="user-name-display"></div><div id="avatar-initials"></div>
  <div id="dt-loja-atual-label"></div>
</div>
<div id="toast"></div>
</body></html>`;

function carregarPagina(usuariosAcessos, opts) {
  opts = opts || {};
  const dom = new JSDOM(SHELL, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const colAcesso = usuariosAcessos || mockColecaoAcesso([]);
  const rawFs = { collection: nome => (nome === 'usuarios_acessos' ? colAcesso : mockColecaoAcesso([])) };
  win.getDTFirebaseApp = () => ({});
  win.getDTRawFirestore = () => rawFs;
  win.getDTFirestore = () => rawFs; // usuarios_acessos é coleção global — mesmo raw serve nos dois
  const authStateCallbacks = [];
  const persistenciasUsadas = [];
  const auth = {
    currentUser: null,
    setPersistence: async valor => { persistenciasUsadas.push(valor); },
    signInWithEmailAndPassword: async () => {},
    signOut: async () => {},
    sendPasswordResetEmail: async () => {},
    onAuthStateChanged: cb => { authStateCallbacks.push(cb); cb(null); },
  };
  auth._persistenciasUsadas = persistenciasUsadas;
  win.getDTAuth = () => auth;
  win.firebase = { auth: { Auth: { Persistence: { NONE: 'NONE', LOCAL: 'LOCAL', SESSION: 'SESSION' } } } };
  win.DTLoja = {
    garantirLojaInicial: opts.garantirLojaInicial || (async () => [{ id: 'loja1', nome: 'Loja Matriz' }]),
    selecionarInterativamente: async () => {},
    listar: async () => [{ id: 'loja1', nome: 'Loja Matriz' }],
  };
  win.getDTLojaAtiva = () => 'loja1';
  win.setDTLojaAtiva = () => {};
  win.escHTML = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  win.eval(code);
  return { win, document, colAcesso, auth };
}

function fakeUser(uid, email, updatePasswordImpl) {
  return {
    uid, email,
    displayName: '',
    updatePassword: updatePasswordImpl || (async () => {}),
  };
}

test('conta com precisaTrocarSenha=true (canal Analista) mostra a tela de troca de senha e NUNCA monta o app', async () => {
  const acessos = mockColecaoAcesso([{ id: 'u1', data: { ativo: true, canais_acesso: { analista: true }, precisaTrocarSenha: true } }]);
  const { win, document } = carregarPagina(acessos);
  const user = fakeUser('u1', 'joao@daterrinhaalimentos.com.br');

  await win._authLoginInternals.onAnalistaLogado(user);

  assert.equal(document.getElementById('screen-primeiro-acesso').style.display, 'flex');
  assert.notEqual(document.getElementById('app-main').style.display, 'flex');
});

test('conta com precisaTrocarSenha ausente (ou false) segue o fluxo normal — comportamento de hoje intocado', async () => {
  const acessos = mockColecaoAcesso([{ id: 'u1', data: { ativo: true, canais_acesso: { analista: true } } }]);
  const { win, document } = carregarPagina(acessos);
  const user = fakeUser('u1', 'joao@daterrinhaalimentos.com.br');

  await win._authLoginInternals.onAnalistaLogado(user);

  assert.equal(document.getElementById('app-main').style.display, 'flex');
  assert.notEqual(document.getElementById('screen-primeiro-acesso').style.display, 'flex');
});

test('confirmarNovaSenhaPrimeiroAcesso: senha curta (<6) mostra erro e não chama updatePassword', async () => {
  const acessos = mockColecaoAcesso([{ id: 'u1', data: { ativo: true, canais_acesso: { analista: true }, precisaTrocarSenha: true } }]);
  const { win, document, auth } = carregarPagina(acessos);
  let chamouUpdate = false;
  auth.currentUser = fakeUser('u1', 'joao@x.com', async () => { chamouUpdate = true; });
  await win._authLoginInternals.onAnalistaLogado(auth.currentUser);

  document.getElementById('pa-senha').value = '123';
  document.getElementById('pa-senha-confirmar').value = '123';
  await win.confirmarNovaSenhaPrimeiroAcesso();

  assert.equal(chamouUpdate, false);
  assert.match(document.getElementById('primeiro-acesso-erro').textContent, /mínimo 6 caracteres/);
});

test('confirmarNovaSenhaPrimeiroAcesso: senhas diferentes mostra erro e não chama updatePassword', async () => {
  const acessos = mockColecaoAcesso([{ id: 'u1', data: { ativo: true, canais_acesso: { analista: true }, precisaTrocarSenha: true } }]);
  const { win, document, auth } = carregarPagina(acessos);
  let chamouUpdate = false;
  auth.currentUser = fakeUser('u1', 'joao@x.com', async () => { chamouUpdate = true; });
  await win._authLoginInternals.onAnalistaLogado(auth.currentUser);

  document.getElementById('pa-senha').value = 'novaSenha123';
  document.getElementById('pa-senha-confirmar').value = 'outraSenha456';
  await win.confirmarNovaSenhaPrimeiroAcesso();

  assert.equal(chamouUpdate, false);
  assert.match(document.getElementById('primeiro-acesso-erro').textContent, /não coincidem/);
});

test('confirmarNovaSenhaPrimeiroAcesso: senha válida e confirmada troca a senha, limpa a flag no Firestore, e prossegue pro app', async () => {
  const acessos = mockColecaoAcesso([{ id: 'u1', data: { ativo: true, canais_acesso: { analista: true }, precisaTrocarSenha: true } }]);
  const { win, document, auth, colAcesso } = carregarPagina(acessos);
  let senhaRecebida = null;
  auth.currentUser = fakeUser('u1', 'joao@x.com', async novaSenha => { senhaRecebida = novaSenha; });
  await win._authLoginInternals.onAnalistaLogado(auth.currentUser);
  assert.equal(document.getElementById('screen-primeiro-acesso').style.display, 'flex');

  document.getElementById('pa-senha').value = 'minhaNovaSenha1';
  document.getElementById('pa-senha-confirmar').value = 'minhaNovaSenha1';
  await win.confirmarNovaSenhaPrimeiroAcesso();

  assert.equal(senhaRecebida, 'minhaNovaSenha1');
  assert.equal(colAcesso._registro.get('u1').precisaTrocarSenha, false, 'flag apagada no Firestore');
  assert.equal(document.getElementById('screen-primeiro-acesso').style.display, 'none', 'tela de primeiro acesso fecha');
  assert.equal(document.getElementById('app-main').style.display, 'flex', 'segue pro app depois de trocar a senha');
});

test('confirmarNovaSenhaPrimeiroAcesso: updatePassword falhando (ex.: sessão expirada) mostra erro, não apaga a flag, não entra no app', async () => {
  const acessos = mockColecaoAcesso([{ id: 'u1', data: { ativo: true, canais_acesso: { analista: true }, precisaTrocarSenha: true } }]);
  const { win, document, auth, colAcesso } = carregarPagina(acessos);
  auth.currentUser = fakeUser('u1', 'joao@x.com', async () => { const e = new Error('sessão velha'); e.code = 'auth/requires-recent-login'; throw e; });
  await win._authLoginInternals.onAnalistaLogado(auth.currentUser);

  document.getElementById('pa-senha').value = 'minhaNovaSenha1';
  document.getElementById('pa-senha-confirmar').value = 'minhaNovaSenha1';
  await win.confirmarNovaSenhaPrimeiroAcesso();

  assert.match(document.getElementById('primeiro-acesso-erro').textContent, /sessão expirou/i);
  assert.equal(colAcesso._registro.get('u1').precisaTrocarSenha, true, 'flag continua true — nada foi trocado de verdade');
  assert.equal(document.getElementById('app-main').style.display, 'none');
});

// BUG AO VIVO REAL (2026-09-09): "conseguia logar, mas ele sai do login" —
// relatado ao vivo pelo usuário testando no celular (Chrome e Safari, sem
// VPN/perfil de gerenciamento — confirmado que não era interceptação de
// rede). O login em si funcionava, mas a checagem de permissões/loja logo
// depois não tinha limite de tempo nenhum, e QUALQUER falha nela (mesmo só
// uma soneca de rede) chamava signOut() incondicional — mesmo com senha
// certa, o usuário caía de volta pro login. Só deve deslogar quando é
// REJEIÇÃO DE ACESSO de verdade (conta inativa, sem canal Analista, sem
// loja liberada — marcadas com erro.acessoNegado=true).
test('BUG AO VIVO REAL: falha de REDE (não de permissão) ao ler usuarios_acessos NÃO desloga — mantém a sessão e oferece tentar de novo', async () => {
  const colAcesso = {
    doc: () => ({ get: async () => { throw new Error('Tempo excedido — conexão instável.'); } }),
  };
  const { win, document, auth } = carregarPagina(colAcesso);
  let chamouSignOut = false;
  auth.signOut = async () => { chamouSignOut = true; };
  const user = fakeUser('u1', 'joao@daterrinhaalimentos.com.br');

  await win._authLoginInternals.onAnalistaLogado(user);

  assert.equal(chamouSignOut, false, 'não pode deslogar por causa de uma falha de rede — a senha estava certa');
  assert.notEqual(document.getElementById('app-main').style.display, 'flex', 'também não entra no app sem confirmar o acesso de verdade');
  assert.match(document.getElementById('login-error-msg').innerHTML, /Tentar de novo/, 'oferece tentar de novo, sem pedir senha outra vez');
});

test('BUG AO VIVO REAL: clicar em "Tentar de novo" reprocessa o MESMO usuário autenticado, sem exigir novo login', async () => {
  let tentativas = 0;
  const colAcesso = {
    doc: () => ({
      get: async () => {
        tentativas++;
        if (tentativas === 1) throw new Error('Tempo excedido — conexão instável.');
        return { exists: true, data: () => ({ ativo: true, canais_acesso: { analista: true } }) };
      },
    }),
  };
  const { win, document } = carregarPagina(colAcesso);
  const user = fakeUser('u1', 'joao@daterrinhaalimentos.com.br');

  await win._authLoginInternals.onAnalistaLogado(user);
  assert.notEqual(document.getElementById('app-main').style.display, 'flex');

  document.getElementById('login-error-msg').querySelector('[data-login-tentar-de-novo]').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(document.getElementById('app-main').style.display, 'flex', 'na 2ª tentativa (mesmo usuário, sem digitar senha de novo) o login completa');
});

test('REGRESSÃO: conta genuinamente sem acesso (ativo:false) continua deslogando — não é o mesmo caso da falha de rede', async () => {
  const acessos = mockColecaoAcesso([{ id: 'u1', data: { ativo: false, canais_acesso: { analista: true } } }]);
  const { win, document, auth } = carregarPagina(acessos);
  let chamouSignOut = false;
  auth.signOut = async () => { chamouSignOut = true; };
  const user = fakeUser('u1', 'joao@daterrinhaalimentos.com.br');

  await win._authLoginInternals.onAnalistaLogado(user);

  assert.equal(chamouSignOut, true, 'rejeição de acesso de verdade continua deslogando, como sempre foi');
  assert.match(document.getElementById('login-error-msg').textContent, /não possui acesso ativo/);
});

// BUG AO VIVO REAL (2026-09-09): "no celular o login continua saindo
// sozinho" — a causa de verdade (achada depois do fix de signOut() em erro
// de rede, que era outro problema real mas não este): persistência NONE
// nunca grava a sessão em lugar nenhum, só sobrevive enquanto a aba
// continua rodando na memória. Celular recarrega abas em 2º plano o tempo
// todo pra economizar memória — cada recarga perdia a sessão inteira.
test('BUG AO VIVO REAL: a persistência preparada (no boot e/ou no login) é LOCAL, não NONE — sessão precisa sobreviver a recarregar a aba (celular recarrega abas em 2º plano o tempo todo)', async () => {
  const { win, document, auth } = carregarPagina();
  document.getElementById('an-email').value = 'joao@daterrinhaalimentos.com.br';
  document.getElementById('an-pass').value = 'senhaCorreta123';

  await win.doLoginAnalista();

  assert.ok(auth._persistenciasUsadas.includes('LOCAL'), 'NONE faz a sessão inteira sumir ao recarregar a aba — celular faz isso o tempo todo em 2º plano. Chamadas: ' + JSON.stringify(auth._persistenciasUsadas));
});

// BUG AO VIVO REAL (2026-09-09, achado por último — os 2 fixes anteriores,
// sozinhos, não resolviam): o listener de auth deslogava IMEDIATAMENTE
// qualquer sessão restaurada automaticamente pelo Firebase (sem o usuário
// ter clicado "Entrar" NESTE carregamento de página) — exatamente o que
// acontece toda vez que o celular recarrega a aba em 2º plano. Mesmo com
// persistência LOCAL gravando certinho, essa sessão restaurada era
// desfeita na hora por este código, não pela falta de persistência.
test('BUG AO VIVO REAL: sessão restaurada pelo Firebase (sem clique em Entrar nesta página) NÃO é deslogada — autorização real continua sendo validada em _onAnalistaLogado', async () => {
  const acessos = mockColecaoAcesso([{ id: 'u1', data: { ativo: true, canais_acesso: { analista: true } } }]);
  const dom = new JSDOM(SHELL, { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;
  const rawFs = { collection: nome => (nome === 'usuarios_acessos' ? acessos : mockColecaoAcesso([])) };
  win.getDTFirebaseApp = () => ({});
  win.getDTRawFirestore = () => rawFs;
  win.getDTFirestore = () => rawFs;
  let chamouSignOut = false;
  const user = fakeUser('u1', 'joao@daterrinhaalimentos.com.br');
  const auth = {
    currentUser: null,
    setPersistence: async () => {},
    signInWithEmailAndPassword: async () => {},
    signOut: async () => { chamouSignOut = true; },
    sendPasswordResetEmail: async () => {},
    // Simula sessão restaurada pelo Firebase sozinho — SEM doLoginAnalista()
    // ter rodado nesta página (é exatamente isso que acontece quando o
    // celular reconstrói a aba em 2º plano com uma sessão LOCAL já salva).
    onAuthStateChanged: cb => cb(user),
  };
  win.getDTAuth = () => auth;
  win.firebase = { auth: { Auth: { Persistence: { NONE: 'NONE', LOCAL: 'LOCAL', SESSION: 'SESSION' } } } };
  win.DTLoja = {
    garantirLojaInicial: async () => [{ id: 'loja1', nome: 'Loja Matriz' }],
    selecionarInterativamente: async () => {},
    listar: async () => [{ id: 'loja1', nome: 'Loja Matriz' }],
  };
  win.getDTLojaAtiva = () => 'loja1';
  win.setDTLojaAtiva = () => {};
  win.escHTML = s => String(s == null ? '' : s);
  win.eval(code);
  await new Promise(r => setTimeout(r, 0));

  assert.equal(chamouSignOut, false, 'sessão restaurada nunca pode ser deslogada só por não ter vindo de um clique em Entrar nesta página');
  assert.equal(document.getElementById('app-main').style.display, 'flex', 'com acesso válido de verdade, a sessão restaurada entra no app normalmente');
});
