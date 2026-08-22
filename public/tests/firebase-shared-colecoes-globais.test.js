const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const sharedCode=fs.readFileSync(path.join(__dirname,'../js/shared/firebase-shared.js'),'utf8');

// getDTFirestore() é um Proxy em cima do Firestore "cru" que auto-prefixa
// `lojas/{lojaAtiva}/{colecao}` pra tudo, EXCETO uma lista curta de coleções
// que precisam ser vistas por qualquer loja (lojas, usuarios_acessos,
// dt_coletores). recebimento_motoristas/recebimento_veiculos entraram nessa
// lista nesta leva (pedido ao vivo do usuário: "o motorista cadastrado tem
// que ficar cadastrado para todas as lojas") — sem isso, um motorista
// cadastrado na Matriz dava "código não encontrado" no bip feito na Filial,
// porque cada loja tinha sua própria subcoleção isolada.
// window PRECISA ser o próprio objeto global do sandbox (não uma propriedade
// dele) — o código-fonte faz `window.getDTRawFirestore = function(){ return
// getDTFirebaseApp().firestore(); }`, ou seja, ATRIBUI em window.X mas
// REFERENCIA por identificador solto (getDTFirebaseApp, sem "window."),
// contando com a semântica de browser onde window === globalThis. Sem essa
// auto-referência, o identificador solto não resolveria dentro do sandbox.
function loadShared(lojaAtiva){
  function fakeCollection(path){
    return {
      _path: path,
      doc:(id)=>({ _path: path+'/'+id, id, collection:(sub)=>fakeCollection(path+'/'+id+'/'+sub) }),
    };
  }
  const context={
    console,
    localStorage:{ getItem:()=>lojaAtiva||'', setItem(){}, removeItem(){} },
    dispatchEvent:()=>{},
    firebase:{ app:()=>({ firestore:()=>({ collection: fakeCollection }) }) },
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(sharedCode,context,{filename:'firebase-shared.js'});
  return {window:context};
}

test('REGRESSÃO: recebimento_motoristas/recebimento_veiculos são coleções globais (nunca prefixadas por loja) — motorista cadastrado numa loja precisa ser reconhecido em qualquer outra',()=>{
  const {window}=loadShared('loja_matriz');
  const colMot=window.getDTFirestore().collection('recebimento_motoristas');
  const colVeic=window.getDTFirestore().collection('recebimento_veiculos');
  assert.equal(colMot._path,'recebimento_motoristas'); // caminho puro, sem passar por lojas/{id}/...
  assert.equal(colVeic._path,'recebimento_veiculos');
});

test('coleções globais pré-existentes continuam sem prefixo (lojas, usuarios_acessos, dt_coletores) — não regride com a mudança desta leva',()=>{
  const {window}=loadShared('loja_matriz');
  assert.equal(window.getDTFirestore().collection('lojas')._path,'lojas');
  assert.equal(window.getDTFirestore().collection('usuarios_acessos')._path,'usuarios_acessos');
  assert.equal(window.getDTFirestore().collection('dt_coletores')._path,'dt_coletores');
});

test('coleção operacional normal (ex.: recebimentos) continua prefixada pela loja ativa — só motorista/veículo viraram globais, o resto do modelo multiloja não muda',()=>{
  const {window}=loadShared('loja_matriz');
  const doc=window.getDTFirestore().collection('recebimentos');
  // fluxo real: raw.collection('lojas').doc(lojaId).collection(nome) — o
  // caminho final precisa ter passado pelo doc(lojaId) no meio (prefixo por
  // loja), diferente do atalho direto que motorista/veículo agora usam.
  assert.equal(doc._path,'lojas/loja_matriz/recebimentos');
});

test('sem loja ativa selecionada, uma coleção normal ainda explode com erro claro — mas as globais (incluindo motorista/veículo) continuam funcionando sem precisar de loja nenhuma',()=>{
  const {window}=loadShared('');
  assert.doesNotThrow(()=>window.getDTFirestore().collection('recebimento_motoristas'));
  assert.doesNotThrow(()=>window.getDTFirestore().collection('recebimento_veiculos'));
  assert.throws(()=>window.getDTFirestore().collection('recebimentos'),/Nenhuma loja selecionada/);
});

test('CORREÇÃO ESTRUTURAL (Prioridade 11 — mensagens de erro compreensíveis): traduzirErroPermissao() só traduz permission-denied, deixa qualquer outro erro passar direto (null) pro chamador tratar como sempre',()=>{
  const {window}=loadShared('loja_matriz');
  assert.equal(window.traduzirErroPermissao({code:'unavailable',message:'offline'},{acao:'x'}),null);
  assert.equal(window.traduzirErroPermissao(null,{acao:'x'}),null);
  assert.equal(window.traduzirErroPermissao(undefined,{acao:'x'}),null);
});

test('traduzirErroPermissao(): contexto.mensagem tem prioridade — usado pelos pontos que já sabem exatamente o que aconteceu (ex.: "voltar etapa" sem a permissão certa)',()=>{
  const {window}=loadShared('loja_matriz');
  const msg=window.traduzirErroPermissao({code:'permission-denied'},{mensagem:'Mensagem específica do chamador.'});
  assert.equal(msg,'Mensagem específica do chamador.');
});

test('traduzirErroPermissao(): sem canal liberado (ex.: conta só-Analista tentando uma ação que exige canal Coletor) dá uma mensagem específica de canal, não a genérica',()=>{
  const {window}=loadShared('loja_matriz');
  window.DT_USUARIO_ACESSO_ATUAL={canais_acesso:{coletor:false,analista:true}};
  const msg=window.traduzirErroPermissao({code:'permission-denied'},{acao:'bipar uma carga',canalNecessario:'coletor'});
  assert.match(msg,/canal necessário/);
});

test('traduzirErroPermissao(): com canal ok, usa a mensagem de ação (contexto.acao) — sem contexto nenhum, cai na mensagem genérica de loja/permissão',()=>{
  const {window}=loadShared('loja_matriz');
  window.DT_USUARIO_ACESSO_ATUAL={canais_acesso:{coletor:true,analista:false}};
  const comAcao=window.traduzirErroPermissao({code:'permission-denied'},{acao:'criar um transbordo',canalNecessario:'coletor'});
  assert.match(comAcao,/criar um transbordo/);
  const semContexto=window.traduzirErroPermissao({code:'permission-denied'});
  assert.match(semContexto,/não pertence mais à sua loja/);
});
