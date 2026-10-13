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
    <input id="op-nome"><input id="op-senha"><input id="op-email-login"><input id="op-email-recuperacao"><datalist id="op-emails-recuperacao"></datalist><div id="op-logins-preview"></div>
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
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'dangerously' });
  dom.window.eval(codigoPermissoes);
  return dom.window;
}
const flush = () => new Promise(r => setTimeout(r, 0));

function marcarPermissao(win, prefix, moduloId, acao) {
  const chk = win.document.querySelector(`#op-permissoes-${prefix} [data-modulo="${moduloId}"][data-acao="${acao}"]`);
  assert.ok(chk, 'checkbox de permissão não encontrado: ' + moduloId + '/' + acao);
  chk.checked = true;
}

test('cadastro envia permissões e canais para o endpoint seguro; navegador não grava réplicas',async()=>{
 const w=novoAmbiente(htmlFormularioCriar()),chamadas=[];
 w.DT_USUARIO_ACESSO_ATUAL={perfil:'administrador',ativo:true};w.DTLoja={garantirLojaInicial:async()=>[{id:'loja_matriz',nome:'Matriz'}]};
 w.firebase={app:()=>({functions:()=>({httpsCallable:n=>async d=>{chamadas.push({n,d});return {data:{ok:true,uid:'novo'}};}})})};
 w.getDTRawFirestore=()=>{throw new Error('Não deve gravar acesso diretamente');};
 w.opAbrirModalCriar();await flush();w.document.getElementById('op-nome').value='João Silva';w.document.getElementById('op-senha').value='123456';w.document.getElementById('op-email-login').value='login.escolhido@example.com';w.document.getElementById('op-email-recuperacao').value='gestao@example.com';marcarPermissao(w,'criar','recebimento-transbordo','criar');await w.criarOperador();
 assert.equal(chamadas[0].n,'salvarUsuarioArea');assert.equal(chamadas[0].d.acesso.permissoes['recebimento-transbordo'].criar,true);assert.equal(chamadas[0].d.emailColetor,'login.escolhido@example.com');assert.equal(chamadas[0].d.acesso.canais_acesso.coletor,true);
});
test('marcar módulo e setor atualiza parcial e contadores; seleção respeita canal',async()=>{
 const w=novoAmbiente(htmlFormularioCriar());w.DT_USUARIO_ACESSO_ATUAL={perfil:'administrador',ativo:true};w.DTLoja={garantirLojaInicial:async()=>[{id:'loja_matriz',nome:'Matriz'}]};w.opAbrirModalCriar();await flush();
 const d=w.document;d.querySelector('[data-modulo-all="inventarios"]').click();assert.equal(d.querySelector('[data-modulo="inventarios"][data-acao="contar"]').checked,true);
 d.querySelector('[data-modulo="inventarios"][data-acao="contar"]').checked=false;w.opAtualizarContagemModulo('criar','inventarios');assert.equal(d.querySelector('[data-modulo-all="inventarios"]').indeterminate,true);
 d.querySelector('[data-setor-all="logistica"]').click();assert.equal(d.querySelector('[data-setor-all="logistica"]').checked,true);assert.equal(d.querySelector('[data-modulo="dashboard"][data-acao="visualizar"]').checked,false,'Analista não está liberado');
 w.opMarcarPermissoes('criar',true);assert.equal(d.querySelector('[data-modulo="compras-central"][data-acao="visualizar"]').checked,false,'Compras escondido não deve ganhar acesso');
 w.opMarcarSetor('criar','logistica',false);assert.equal(d.querySelector('[data-modulo-all="inventarios"]').checked,false);
});
test('responsável não consegue marcar ações fora do limite nem via selecionar tudo',async()=>{
 const w=novoAmbiente(htmlFormularioCriar());w.DT_USUARIO_ACESSO_ATUAL={perfil:'analista',ativo:true,permissoes:{inventarios:{visualizar:true,contar:true}},gestao_areas:{areas:['inventario'],canais:{coletor:true},operacoes:{criar:true,atribuir:true},permissoes:{inventarios:{visualizar:true,contar:true}}}};w.DTLoja={garantirLojaInicial:async()=>[{id:'loja_matriz',nome:'Matriz'}]};w.opAbrirModalCriar();await flush();
 w.opMarcarPermissoes('criar',true);const d=w.document;assert.equal(d.querySelector('[data-modulo="inventarios"][data-acao="contar"]').checked,true);assert.equal(d.querySelector('[data-modulo="inventarios"][data-acao="excluir"]').checked,false);assert.equal(d.querySelector('[data-modulo="inventarios"][data-acao="excluir"]').disabled,true);
});
test('modelo cadastrado preenche formulário, permite ajuste individual e envia vínculo',async()=>{
 const w=novoAmbiente(htmlFormularioCriar()+htmlFormularioEditarELista()),calls=[];w.DT_USUARIO_ACESSO_ATUAL={perfil:'administrador',ativo:true};w.DTLoja={garantirLojaInicial:async()=>[{id:'loja_matriz',nome:'Matriz'}]};
 w.firebase={app:()=>({functions:()=>({httpsCallable:n=>async d=>{calls.push({n,d});return {data:n==='listarGestaoAcessos'?{usuarios:[],modelos:[{id:'monitor',nome:'Monitoramento',ativo:true,canais:{analista:true},permissoes:{inventarios:{visualizar:true},acompanhamento:{visualizar:true}}}]}:{ok:true,uid:'novo'}};}})})};w.getDTRawFirestore=()=>({collection:()=>({doc:()=>({collection:()=>({limit:()=>({get:async()=>({docs:[]})})})})})});
 await w.listarOperadores();w.opAbrirModalCriar();await flush();w.opSelecionarModelo('criar','monitor');assert.equal(w.document.querySelector('[data-modulo="inventarios"][data-acao="visualizar"]').checked,true);assert.equal(w.document.querySelector('[data-modulo="inventarios"][data-acao="excluir"]').checked,false);assert.equal(w.document.getElementById('op-modelo-criar').value,'monitor');
 w.opMarcarModulo('criar','acompanhamento',false);w.document.getElementById('op-nome').value='João Silva';w.document.getElementById('op-senha').value='123456';w.document.getElementById('op-email-login').value='login.escolhido@example.com';w.document.getElementById('op-email-recuperacao').value='gestao@example.com';await w.criarOperador();const save=calls.find(x=>x.n==='salvarUsuarioArea');assert.equal(save.d.acesso.modelo_acesso_id,'monitor');assert.equal(save.d.acesso.permissoes.acompanhamento.visualizar,false);
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
  win.firebase={app:()=>({functions:()=>({httpsCallable:()=>async()=>({data:{modelos:[],usuarios:[...access._registro.entries()].filter(([id,u])=>!u.conta_secundaria).map(([id,u])=>({id,...u}))}})})})};

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
  win.firebase={app:()=>({functions:()=>({httpsCallable:()=>async()=>({data:{modelos:[],usuarios:[...access._registro.entries()].filter(([id,u])=>!u.conta_secundaria).map(([id,u])=>({id,...u}))}})})})};

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
