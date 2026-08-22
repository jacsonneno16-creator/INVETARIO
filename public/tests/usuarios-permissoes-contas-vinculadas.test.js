'use strict';
/**
 * CORREÇÃO ESTRUTURAL — contas vinculadas (Analista + Coletor) da mesma
 * pessoa. Causa raiz confirmada em auditoria de código: Firestore Rules
 * resolve permissão estritamente por UID autenticado
 * (usuarios_acessos/{request.auth.uid}), sem indireção nenhuma — então duas
 * contas Firebase Auth (login Analista + login Coletor) são DOIS documentos
 * usuarios_acessos nunca cruzados entre si pelo motor de regras. `criarOperador()`
 * gravava a conta secundária (Coletor) com `permissoes:{}` fixo, ignorando o
 * que foi marcado no formulário; `opSalvarEdicao()` só atualizava a conta
 * principal, nunca a secundária — então mesmo reeditando as permissões
 * depois, a conta Coletor nunca era corrigida. "Administrador libera a
 * permissão, mas o Coletor continua com permission-denied" era sempre isso.
 *
 * Usa jsdom (mesmo padrão de analista-fase5-permissoes-recebimento.test.js)
 * porque criarOperador()/opSalvarEdicao() dependem de querySelectorAll/
 * closest/checked reais pra ler o formulário.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const codigoPermissoes = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '37-usuarios-permissoes.js'), 'utf8');

function mockAccessCollection(seed) {
  const registro = new Map((seed || []).map(d => [d.id, d.data]));
  const escritas = [];
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    doc: (id) => ({
      id,
      get: async () => ({ exists: registro.has(id), data: () => registro.get(id) }),
      set: async (payload, opts) => {
        const atual = registro.get(id) || {};
        const novo = (opts && opts.merge) ? { ...atual, ...payload } : payload;
        registro.set(id, novo);
        escritas.push({ id, payload, merge: !!(opts && opts.merge) });
      },
    }),
    _registro: registro,
    _escritas: escritas,
  };
}

function mockDtOperadoresPorLoja() {
  const colecoes = new Map(); // "lojaId" -> mockAccessCollection
  return {
    doc: (lojaId) => ({
      collection: (sub) => {
        const chave = lojaId + '/' + sub;
        if (!colecoes.has(chave)) colecoes.set(chave, mockAccessCollection([]));
        const col = colecoes.get(chave);
        return { ...col, limit: () => col };
      },
    }),
    _colecoes: colecoes,
  };
}

function htmlFormularioCriar() {
  return `
    <input id="op-nome"><input id="op-senha"><input id="op-username" readonly><div id="op-logins-preview"></div>
    <label><input type="radio" name="op-tipo" value="analista"></label>
    <label><input type="radio" name="op-tipo" value="operador" checked></label>
    <div id="op-canais-criar"></div>
    <div id="op-setores-criar"></div>
    <div id="op-permissoes-criar"></div>
    <label><input type="radio" name="op-lojas-criar-modo" value="todas" checked></label>
    <label><input type="radio" name="op-lojas-criar-modo" value="selecionadas"></label>
    <div id="op-lojas-criar-box" style="display:none"></div>
    <div id="op-lojas-criar-lista"></div>
    <div id="op-modal-criar-bg" style="display:none"></div>`;
}
function htmlFormularioEditarELista() {
  return `
    <div id="op-lista-wrap"></div><input id="op-busca"><select id="op-filtro-perfil"></select><select id="op-filtro-status"></select>
    <input id="opedit-nome"><input id="opedit-cargo"><input id="opedit-setor"><input id="opedit-senha">
    <label><input type="radio" name="op-lojas-editar-modo" value="todas"></label>
    <label><input type="radio" name="op-lojas-editar-modo" value="selecionadas"></label>
    <div id="op-lojas-editar-box" style="display:none"></div>
    <div id="op-lojas-editar-lista"></div>
    <div id="op-canais-editar"></div>
    <div id="op-setores-editar"></div>
    <div id="op-permissoes-editar"></div>
    <button type="button" data-op-diagnostico-abrir="1"></button>
    <div id="op-diagnostico" style="display:none"></div>
    <button id="btn-excluir-oped"></button>
    <div id="op-modal-bg" style="display:none"></div>`;
}

function novoAmbiente(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'outside-only' });
  dom.window.eval(codigoPermissoes);
  return dom.window;
}
const flush = () => new Promise(r => setTimeout(r, 0));

function marcarPermissao(win, prefix, moduloId, acao) {
  const chk = win.document.querySelector(`#op-permissoes-${prefix} [data-modulo="${moduloId}"][data-acao="${acao}"]`);
  assert.ok(chk, 'checkbox de permissão não encontrado: ' + moduloId + '/' + acao);
  chk.checked = true;
}

test('CORREÇÃO ESTRUTURAL: criarOperador() grava a MESMA permissão marcada no formulário pra conta secundária do Coletor — não mais permissoes:{} fixo', async () => {
  const access = mockAccessCollection([]);
  const dtOperadores = mockDtOperadoresPorLoja();
  const win = novoAmbiente(htmlFormularioCriar());
  win.getDTRawFirestore = () => ({
    collection: (nome) => nome === 'usuarios_acessos' ? access : (nome === 'lojas' ? { doc: dtOperadores.doc } : mockAccessCollection([])),
  });
  win.DTLoja = { garantirLojaInicial: async () => [{ id: 'loja_matriz', nome: 'Matriz' }], listar: async () => [{ id: 'loja_matriz', nome: 'Matriz' }] };
  win._currentAnalistaUser = { email: 'admin@daterrinhaalimentos.com.br' };
  win.firebase = {
    app: () => ({
      functions: () => ({
        httpsCallable: (nome) => {
          assert.equal(nome, 'criarUsuarioVinculado');
          return async () => ({ data: { ok: true, uid: 'uidPrincipal', analista_uid: null, coletor_uid: 'uidColetor', conta_existente: false } });
        },
      }),
    }),
  };

  win.opAbrirModalCriar();
  await flush(); await flush(); await flush();

  win.document.getElementById('op-nome').value = 'João Silva';
  win.opGerarUsername?.();
  win.document.getElementById('op-senha').value = 'Senha1234';
  // Permissão administrativa real marcada no formulário (o cenário exato do
  // bug ao vivo: "recebimento-transbordo → criar" liberado pro operador).
  marcarPermissao(win, 'criar', 'recebimento-transbordo', 'criar');

  await win.criarOperador();

  const principal = access._registro.get('uidPrincipal');
  const secundaria = access._registro.get('uidColetor');
  assert.ok(principal, 'conta principal não foi gravada');
  assert.ok(secundaria, 'conta secundária (Coletor) não foi gravada');
  assert.equal(principal.permissoes['recebimento-transbordo'].criar, true);
  // A asserção que prova a correção: a conta secundária tem a MESMA
  // permissão, não um mapa vazio.
  assert.equal(secundaria.permissoes['recebimento-transbordo'].criar, true);
  assert.deepEqual(secundaria.permissoes, principal.permissoes);
  assert.equal(secundaria.conta_secundaria, true);
  assert.equal(secundaria.cadastro_principal_uid, 'uidPrincipal');
});

test('CORREÇÃO ESTRUTURAL: opSalvarEdicao() propaga a permissão editada pra TODOS os UIDs vinculados (analista_uid/coletor_uid/uids_vinculados), não só a conta principal', async () => {
  // Estado inicial: exatamente o bug ao vivo — conta principal (Analista)
  // já tinha uma permissão, a secundária (Coletor) ainda está com
  // permissoes:{} (como ficava presa antes desta correção).
  const access = mockAccessCollection([
    { id: 'uidPrincipal', data: { uid: 'uidPrincipal', coletor_uid: 'uidColetor', email: 'joao@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'analista', ativo: true, canais_acesso: { coletor: true, analista: true }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: { 'recebimento-transbordo': { visualizar: true, criar: true } } } },
    { id: 'uidColetor', data: { uid: 'uidColetor', email: 'joao.silva@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'operador', ativo: true, canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: {}, conta_secundaria: true, cadastro_principal_uid: 'uidPrincipal' } },
  ]);
  const dtOperadores = mockDtOperadoresPorLoja();
  const win = novoAmbiente(htmlFormularioEditarELista());
  win.getDTRawFirestore = () => ({
    collection: (nome) => nome === 'usuarios_acessos' ? access : (nome === 'lojas' ? { doc: dtOperadores.doc } : mockAccessCollection([])),
  });
  win.DTLoja = { garantirLojaInicial: async () => [{ id: 'loja_matriz', nome: 'Matriz' }], listar: async () => [{ id: 'loja_matriz', nome: 'Matriz' }] };
  // O admin logado É a própria conta sendo editada (já existe no mock) —
  // evita que coletarUsuariosExistentes() insira uma 2ª conta (a do admin)
  // na lista, o que mudaria o índice esperado.
  win._currentAnalistaUser = { uid: 'uidPrincipal', email: 'joao@daterrinhaalimentos.com.br', admin_mestre: true };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true, permissoes: {} };

  await win.listarOperadores();
  const indice = 0; // só um usuário na lista (uidColetor é conta_secundaria, filtrada)
  await win.opEditarUsuario(indice);

  // Admin adiciona uma NOVA permissão que o funcionário não tinha.
  marcarPermissao(win, 'editar', 'recebimento-transbordo', 'editar');

  await win.opSalvarEdicao();

  const principal = access._registro.get('uidPrincipal');
  const secundaria = access._registro.get('uidColetor');
  assert.equal(principal.permissoes['recebimento-transbordo'].editar, true);
  // A asserção que prova a correção: a conta do Coletor (secundária) também
  // recebeu a permissão nova — antes disso ficava presa em permissoes:{}
  // pra sempre, mesmo depois de reeditar.
  assert.equal(secundaria.permissoes['recebimento-transbordo'].editar, true);
  assert.deepEqual(secundaria.permissoes, principal.permissoes);
});

// BUG AO VIVO REAL (relatado pelo usuário: "mesmo colocando [uma senha com
// letras e números] tá dando erro"): a validação de opSalvarEdicao()
// (trocar senha de um usuário JÁ existente — diferente de criarOperador(),
// que valida certo) usava `/\\d/` (uma regex que procura o texto literal
// "\d", nunca um dígito de verdade) em vez de `/\d/` — a checagem "tem
// número" nunca passava pra nenhuma senha normal, então NENHUMA senha válida
// conseguia ser salva, sempre voltando o mesmo erro de "mínimo 8
// caracteres, com letras e números" independente do que fosse digitado.
test('REGRESSÃO: opSalvarEdicao() aceita uma senha nova válida (8+ caracteres, letras E números) e chama alterarSenhaUsuario — antes disso a checagem de dígito nunca passava pra nenhuma senha real', async () => {
  const access = mockAccessCollection([
    // Só canal Coletor (analista:false) — evita a checagem "libere ao menos
    // uma aba do Analista" de validarAcesso(), irrelevante pro que este
    // teste cobre (a validação da SENHA, não de permissões de módulo).
    { id: 'uidPrincipal', data: { uid: 'uidPrincipal', coletor_uid: 'uidColetor', email: 'joao@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'operador', ativo: true, canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: {} } },
  ]);
  const dtOperadores = mockDtOperadoresPorLoja();
  const win = novoAmbiente(htmlFormularioEditarELista());
  win.getDTRawFirestore = () => ({
    collection: (nome) => nome === 'usuarios_acessos' ? access : (nome === 'lojas' ? { doc: dtOperadores.doc } : mockAccessCollection([])),
  });
  win.DTLoja = { garantirLojaInicial: async () => [{ id: 'loja_matriz', nome: 'Matriz' }], listar: async () => [{ id: 'loja_matriz', nome: 'Matriz' }] };
  win._currentAnalistaUser = { uid: 'uidPrincipal', email: 'joao@daterrinhaalimentos.com.br', admin_mestre: true };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true, permissoes: {} };
  const toasts = [];
  win.showToast = (msg, tipo) => toasts.push({ msg, tipo });
  let chamadaAlterarSenha = null;
  win.firebase = {
    app: () => ({
      functions: () => ({
        httpsCallable: (nome) => {
          assert.equal(nome, 'alterarSenhaUsuario');
          return async (args) => { chamadaAlterarSenha = args; return { data: { ok: true } }; };
        },
      }),
    }),
  };

  await win.listarOperadores();
  await win.opEditarUsuario(0);
  win.document.getElementById('opedit-senha').value = 'Senha1234'; // letras E números, 8+ caracteres — válida de verdade

  await win.opSalvarEdicao();

  assert.equal(toasts.some(t => /mínimo 6 caracteres/.test(t.msg)), false, 'não devia mostrar o erro de senha inválida pra uma senha que já tem 8+ caracteres');
  assert.ok(chamadaAlterarSenha, 'alterarSenhaUsuario precisava ter sido chamada');
  assert.equal(chamadaAlterarSenha.senha, 'Senha1234');
  assert.deepEqual([...chamadaAlterarSenha.uids].sort(), ['uidColetor', 'uidPrincipal']);
});

// PEDIDO AO VIVO (usuário: "deixar colocar senha de 4 dígitos, podendo ser só
// números... hoje lá tá falando que pode colocar com 6 mas quando coloco dá
// erro falando que tem que ter 8 entre letra e números") — 4 dígitos não dá
// porque o Firebase Authentication tem piso fixo de 6 caracteres (não
// configurável), mas a exigência de letra+número foi removida: 6 dígitos só
// números já é senha válida agora, tanto pra criar quanto pra editar.
test('PEDIDO AO VIVO: senha só com números (6+ caracteres) é aceita — não exige mais letra junto', async () => {
  const access = mockAccessCollection([
    { id: 'uidPrincipal', data: { uid: 'uidPrincipal', coletor_uid: 'uidColetor', email: 'joao@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'operador', ativo: true, canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: {} } },
  ]);
  const dtOperadores = mockDtOperadoresPorLoja();
  const win = novoAmbiente(htmlFormularioEditarELista());
  win.getDTRawFirestore = () => ({
    collection: (nome) => nome === 'usuarios_acessos' ? access : (nome === 'lojas' ? { doc: dtOperadores.doc } : mockAccessCollection([])),
  });
  win.DTLoja = { garantirLojaInicial: async () => [{ id: 'loja_matriz', nome: 'Matriz' }], listar: async () => [{ id: 'loja_matriz', nome: 'Matriz' }] };
  win._currentAnalistaUser = { uid: 'uidPrincipal', email: 'joao@daterrinhaalimentos.com.br', admin_mestre: true };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true, permissoes: {} };
  const toasts = [];
  win.showToast = (msg, tipo) => toasts.push({ msg, tipo });
  let chamadaAlterarSenha = null;
  win.firebase = {
    app: () => ({
      functions: () => ({
        httpsCallable: (nome) => async (args) => { chamadaAlterarSenha = args; return { data: { ok: true } }; },
      }),
    }),
  };

  await win.listarOperadores();
  await win.opEditarUsuario(0);
  win.document.getElementById('opedit-senha').value = '123456';

  await win.opSalvarEdicao();

  assert.equal(toasts.some(t => t.tipo === 'error'), false, 'senha numérica de 6 dígitos não devia disparar erro de validação');
  assert.ok(chamadaAlterarSenha, 'alterarSenhaUsuario precisava ter sido chamada com a senha numérica');
  assert.equal(chamadaAlterarSenha.senha, '123456');
});

test('PEDIDO AO VIVO: senha numérica com menos de 6 dígitos ainda é rejeitada (piso real do Firebase Authentication)', async () => {
  const access = mockAccessCollection([
    { id: 'uidPrincipal', data: { uid: 'uidPrincipal', coletor_uid: 'uidColetor', email: 'joao@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'operador', ativo: true, canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: {} } },
  ]);
  const dtOperadores = mockDtOperadoresPorLoja();
  const win = novoAmbiente(htmlFormularioEditarELista());
  win.getDTRawFirestore = () => ({
    collection: (nome) => nome === 'usuarios_acessos' ? access : (nome === 'lojas' ? { doc: dtOperadores.doc } : mockAccessCollection([])),
  });
  win.DTLoja = { garantirLojaInicial: async () => [{ id: 'loja_matriz', nome: 'Matriz' }], listar: async () => [{ id: 'loja_matriz', nome: 'Matriz' }] };
  win._currentAnalistaUser = { uid: 'uidPrincipal', email: 'joao@daterrinhaalimentos.com.br', admin_mestre: true };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true, permissoes: {} };
  const toasts = [];
  win.showToast = (msg, tipo) => toasts.push({ msg, tipo });
  let chamou = false;
  win.firebase = {
    app: () => ({
      functions: () => ({
        httpsCallable: () => async (args) => { chamou = true; return { data: { ok: true } }; },
      }),
    }),
  };

  await win.listarOperadores();
  await win.opEditarUsuario(0);
  win.document.getElementById('opedit-senha').value = '1234';

  await win.opSalvarEdicao();

  assert.equal(chamou, false, '4 dígitos não é aceito — abaixo do piso real do Firebase Authentication');
  assert.ok(toasts.some(t => /mínimo 6 caracteres/.test(t.msg)));
});

test('Diagnóstico de acesso: mostra "não sincronizado" pra uma conta já dessincronizada, e "Ressincronizar" corrige sem mexer em quem já está ok', async () => {
  const access = mockAccessCollection([
    { id: 'uidPrincipal', data: { uid: 'uidPrincipal', coletor_uid: 'uidColetor', email: 'joao@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'analista', ativo: true, canais_acesso: { coletor: true, analista: true }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: { 'recebimento-transbordo': { visualizar: true, editar: true } } } },
    // Conta já dessincronizada de antes desta correção existir (o cenário
    // exato que o painel precisa detectar e o botão precisa corrigir).
    { id: 'uidColetor', data: { uid: 'uidColetor', email: 'joao.silva@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'operador', ativo: true, canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: {}, conta_secundaria: true, cadastro_principal_uid: 'uidPrincipal' } },
  ]);
  const win = novoAmbiente(htmlFormularioEditarELista());
  const dtOperadoresDiag = mockDtOperadoresPorLoja();
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'usuarios_acessos' ? access : (nome === 'lojas' ? { doc: dtOperadoresDiag.doc } : mockAccessCollection([])) });
  win.DTLoja = { garantirLojaInicial: async () => [{ id: 'loja_matriz', nome: 'Matriz' }], listar: async () => [{ id: 'loja_matriz', nome: 'Matriz' }] };
  win._currentAnalistaUser = { uid: 'uidPrincipal', email: 'joao@daterrinhaalimentos.com.br', admin_mestre: true };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true, permissoes: {} };

  await win.listarOperadores();
  await win.opEditarUsuario(0);
  await win.opAbrirDiagnostico();

  const diag = win.document.getElementById('op-diagnostico');
  assert.match(diag.innerHTML, /não sincronizado/);
  const btnResync = win.document.querySelector('[data-op-diagnostico-ressincronizar]');
  assert.ok(btnResync, 'botão de ressincronizar não apareceu pra conta dessincronizada');

  await win.opRessincronizarPermissoes(btnResync.getAttribute('data-op-diagnostico-ressincronizar'));

  const secundariaCorrigida = access._registro.get('uidColetor');
  assert.deepEqual(secundariaCorrigida.permissoes, access._registro.get('uidPrincipal').permissoes);
  assert.match(win.document.getElementById('op-diagnostico').innerHTML, /sincronizadas/);
});

test('Diagnóstico de acesso: conta já sincronizada não mostra alerta nem botão de ressincronizar', async () => {
  const permissoesIguais = { 'recebimento-transbordo': { visualizar: true, editar: true } };
  const access = mockAccessCollection([
    { id: 'uidPrincipal', data: { uid: 'uidPrincipal', coletor_uid: 'uidColetor', email: 'joao@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'analista', ativo: true, canais_acesso: { coletor: true, analista: true }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: permissoesIguais } },
    { id: 'uidColetor', data: { uid: 'uidColetor', email: 'joao.silva@daterrinhaalimentos.com.br', nome: 'João Silva', perfil: 'operador', ativo: true, canais_acesso: { coletor: true, analista: false }, acesso_todas_lojas: true, lojas_permitidas: [], permissoes: permissoesIguais, conta_secundaria: true, cadastro_principal_uid: 'uidPrincipal' } },
  ]);
  const win = novoAmbiente(htmlFormularioEditarELista());
  const dtOperadoresDiag = mockDtOperadoresPorLoja();
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'usuarios_acessos' ? access : (nome === 'lojas' ? { doc: dtOperadoresDiag.doc } : mockAccessCollection([])) });
  win.DTLoja = { garantirLojaInicial: async () => [{ id: 'loja_matriz', nome: 'Matriz' }], listar: async () => [{ id: 'loja_matriz', nome: 'Matriz' }] };
  win._currentAnalistaUser = { uid: 'uidPrincipal', email: 'joao@daterrinhaalimentos.com.br', admin_mestre: true };
  win.DT_USUARIO_ACESSO_ATUAL = { admin_mestre: true, permissoes: {} };

  await win.listarOperadores();
  await win.opEditarUsuario(0);
  await win.opAbrirDiagnostico();

  const diag = win.document.getElementById('op-diagnostico');
  assert.match(diag.innerHTML, /sincronizadas/);
  assert.doesNotMatch(diag.innerHTML, /não sincronizada/);
  assert.equal(win.document.querySelector('[data-op-diagnostico-ressincronizar]'), null);
});

function htmlComBuscaUid() {
  return htmlFormularioEditarELista() + '<input id="op-busca-uid"><button data-op-buscar-uid="1"></button><div id="op-busca-uid-resultado" style="display:none"></div>';
}

test('Buscar por UID: acha uma conta órfã (login criado via "Primeiro acesso" com um usuário diferente do cadastrado) que NUNCA apareceria na lista principal', async () => {
  // Cenário ao vivo relatado: um operador digitou um login levemente
  // diferente do que o Analista cadastrou durante "Primeiro acesso" no
  // Coletor — o Firebase Auth aceita numa boa (é um e-mail diferente, sem
  // colisão), mas o app NUNCA grava usuarios_acessos pra essa conta.
  // "Buscar por UID" precisa achar isso direto pelo UID, sem depender da
  // listagem (que só lista quem tem entrada em usuarios_acessos).
  const access = mockAccessCollection([
    { id: 'uidOrfaoComDoc', data: { uid: 'uidOrfaoComDoc', email: 'rafael.souza@daterrinhaalimentos.com.br', nome: 'Rafael Souza', perfil: 'operador', ativo: true, canais_acesso: { coletor: true, analista: false }, permissoes: {} } },
  ]);
  const win = novoAmbiente(htmlComBuscaUid());
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'usuarios_acessos' ? access : mockAccessCollection([]) });

  win.document.getElementById('op-busca-uid').value = 'uidOrfaoComDoc';
  await win.opBuscarPorUid();
  const resultado = win.document.getElementById('op-busca-uid-resultado');
  assert.match(resultado.innerHTML, /rafael\.souza@daterrinhaalimentos\.com\.br/);
  assert.match(resultado.innerHTML, /nenhuma — permissoes/); // confirma pra quem está sem nenhuma permissão marcada
});

test('Buscar por UID: quando NEM documento existe (o caso real de "Primeiro acesso" com login errado — app nunca grava usuarios_acessos), mostra aviso explicando o motivo mais provável, não um erro genérico', async () => {
  const access = mockAccessCollection([]); // nenhum documento pra nenhum uid
  const win = novoAmbiente(htmlComBuscaUid());
  win.getDTRawFirestore = () => ({ collection: (nome) => nome === 'usuarios_acessos' ? access : mockAccessCollection([]) });

  win.document.getElementById('op-busca-uid').value = 'SmogUoHN3PgayD6tQGQkF7NW83o1';
  await win.opBuscarPorUid();
  const resultado = win.document.getElementById('op-busca-uid-resultado');
  assert.match(resultado.innerHTML, /Nenhum documento usuarios_acessos encontrado/);
  assert.match(resultado.innerHTML, /Primeiro acesso/); // explica a causa mais provável, não só "não encontrado"
});
