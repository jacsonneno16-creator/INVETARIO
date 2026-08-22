const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const syncCode=fs.readFileSync(path.join(__dirname,'../js/coletor/02-sync-dispositivo.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');

// Bug ao vivo relatado: um login novo (só acesso ao Coletor, uma única
// loja) dava "Não foi possível registrar o aparelho no Firebase" — mas a
// tela de Diagnóstico dizia "tudo correto". Causa: registrarColetorNoFirestore
// trata o erro internamente (try/catch que nunca vira unhandledrejection),
// então o erro REAL do Firestore (code/message) nunca chegava aos "Últimos
// erros" que a tela de Diagnóstico mostra — só erros JS soltos/promises
// rejeitadas sem handler são capturados automaticamente. Corrigido expondo
// window.dtAddDiag (definido em 19-runtime-estavel-v15.js) e chamando ele
// no catch. Este teste tranca esse comportamento pra não regredir.
function loadSync(refImpl){
  const localStore={};
  const context={
    console,
    firebase:{ firestore:{ FieldValue:{ serverTimestamp:()=>'SERVER_TS', delete:()=>'DELETE_FIELD' } } },
    FCOL:{ coletores:'dt_coletores' },
    FS:{ collection:(nome)=> (nome==='dt_coletores' ? { doc:(id)=>refImpl } : { doc:()=>refImpl }) },
    APP:{},
    localStorage:{
      getItem:(k)=> Object.prototype.hasOwnProperty.call(localStore,k) ? localStore[k] : null,
      setItem:(k,v)=>{ localStore[k]=v; },
      removeItem:(k)=>{ delete localStore[k]; },
    },
    sessionStorage:{ getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
    navigator:{ userAgent:'teste', onLine:true },
    screen:{ width:100, height:100, colorDepth:24 },
    Intl, Date, Math, JSON, String, Number, Array, Object, Set, Map, Promise,
    fetch: async()=>({ json: async()=>({ip:'0.0.0.0'}) }),
    dbg:()=>{},
    document:{ createElement:()=>({ getContext:()=>({ fillText(){}, fillRect(){} }), toDataURL:()=>'data:x' }) },
  };
  context.window=context;
  context.localStorage.setItem('dt_device_id','dt_teste123'); // evita depender do fingerprint completo
  vm.createContext(context);
  vm.runInContext(syncCode,context,{filename:'02-sync-dispositivo.js'});
  return context;
}

test('REGRESSÃO: erro do Firestore ao registrar o aparelho (ex.: permission-denied) fica visível na tela de Diagnóstico via window.dtAddDiag — antes sumia sem deixar rastro',async()=>{
  const erro=new Error('Missing or insufficient permissions.');
  erro.code='permission-denied';
  const refQueFalha={ get: async()=>{ throw erro; } };
  const ctx=loadSync(refQueFalha);
  const diagChamadas=[];
  ctx.dtAddDiag=(msg)=>diagChamadas.push(msg);

  const status=await ctx.registrarColetorNoFirestore({ email:'novo.login@daterrinhaalimentos.com.br', name:'Novo Login', uid:'uid123' });

  assert.equal(status,'erro');
  assert.equal(diagChamadas.length,1);
  assert.match(diagChamadas[0],/permission-denied/);
  assert.match(diagChamadas[0],/Missing or insufficient permissions/);
  assert.match(diagChamadas[0],/uid123/);
});

test('sem window.dtAddDiag disponível (versão mais antiga do bundle em cache), não quebra o registro — só não regista o diagnóstico',async()=>{
  const erro=new Error('offline');
  const refQueFalha={ get: async()=>{ throw erro; } };
  const ctx=loadSync(refQueFalha);
  // dtAddDiag propositalmente ausente
  const status=await ctx.registrarColetorNoFirestore({ email:'x@daterrinhaalimentos.com.br', name:'X', uid:'u1' });
  assert.equal(status,'erro');
});

test('aparelho novo (sem doc ainda) registra normalmente, sem chamar o diagnóstico de erro',async()=>{
  let payloadSalvo=null;
  const refNovo={
    get: async()=>({ exists:false }),
    set: async(payload)=>{ payloadSalvo=payload; },
  };
  const ctx=loadSync(refNovo);
  const diagChamadas=[];
  ctx.dtAddDiag=(msg)=>diagChamadas.push(msg);

  const status=await ctx.registrarColetorNoFirestore({ email:'novo@daterrinhaalimentos.com.br', name:'Novo', uid:'uidNovo' });

  assert.equal(status,'pendente');
  assert.equal(payloadSalvo.uid,'uidNovo');
  assert.equal(payloadSalvo.aprovado,'pendente');
  assert.equal(diagChamadas.length,0); // caminho feliz não registra erro nenhum
});

test('REGRESSÃO (causa raiz real, confirmada com o erro do Diagnóstico ao vivo): dt_coletores permite qualquer conta ATIVA ler o registro de um aparelho — não só quem já é o "dono" (uid) salvo nele ou quem é Analista',()=>{
  // Causa raiz de verdade: um aparelho físico é usado por VÁRIOS operadores
  // diferentes ao longo do tempo (turnos diferentes, mesmo coletor físico)
  // — o próprio update já foi desenhado pra permitir essa troca de "dono".
  // Mas o `get`/`list` antigo só liberava leitura pra quem JÁ era o uid
  // salvo no doc (o operador do login anterior) ou pra Analista — então
  // uma conta só-Coletor tentando assumir um aparelho que outra pessoa usou
  // por último nem conseguia LER o doc pra saber que existia e tava
  // aprovado. "Um login vai, o outro não" era sempre o dono salvo (ou
  // Analista, que sempre passa) funcionando, e qualquer conta diferente
  // falhando — confirmado com o texto exato do erro (permission-denied)
  // reportado ao vivo.
  const trecho=rules.slice(rules.indexOf('match /dt_coletores/'),rules.indexOf('match /dt_coletores/')+2300);
  assert.match(trecho,/allow get: if active\(\);/);
  assert.match(trecho,/allow list: if active\(\);/);
  // write continua restrito: só o próprio uid (auto-registro/troca de
  // operador) ou quem tem a permissão administrativa de coletores
  assert.match(trecho,/allow update: if hasPermission\('coletores', 'editar'\) \|\| \(/);
});

test('REGRESSÃO (causa raiz real, confirmada com erro ao vivo "Missing or insufficient permissions" ao cruzar loja parceira): recebimentos de tipo TRANSBORDO têm uma via de acesso baseada em PERMISSÃO, não só em canAccessStore(lojaId) — sem isso, uma conta restrita a uma única loja nunca conseguiria ler/escrever o transbordo que mora na loja parceira, não importa qual permissão administrativa ganhasse',()=>{
  // Causa raiz: canAccessStore(lojaId) checa se a CONTA tem aquela loja em
  // lojas_permitidas — mas transbordo é uma operação ENTRE lojas por
  // natureza; o documento mora na loja de origem, e quem opera na loja de
  // destino (ou vice-versa) muitas vezes só tem acesso à PRÓPRIA loja
  // (contas de operador são propositalmente restritas a uma loja só). Dar
  // a permissão "recebimento-transbordo" pro usuário não resolvia nada,
  // porque o bloqueio nunca foi de permissão — sempre foi de loja.
  const trecho=rules.slice(rules.indexOf('match /recebimentos/{docId}'),rules.indexOf('match /recebimento_identificadores'));
  assert.match(trecho,/allow read: if canAccessStore\(lojaId\) \|\| \(\s*\n\s*active\(\) && resource\.data\.tipo == 'TRANSBORDO' &&\s*\n\s*hasPermissionColetorRecebimento\('editar'\)/);
  assert.match(trecho,/allow create: if \(\s*\n\s*\(canAccessStore\(lojaId\) && hasPermissionRecebimento\('criar'\)\)/);
  // Update foi reestruturado (correção estrutural de posse operacional,
  // sessão seguinte): dois ramos separados — dono da loja (só enquanto
  // ainda é a vez dele) e cross-loja (só quem tem acesso real à loja de
  // DESTINO) — em vez de um único gate de loja compartilhado. Depois
  // (mesma sessão, achado ao vivo em produção): o `||` entre os dois ramos
  // virou `?:` (ternário) — o motor de regras não garantia economia de
  // custo com `||` mesmo com o lado esquerdo falso de forma óbvia, o que
  // estourava o limite de 1000 sub-expressões em contas reais e permitia
  // uma escrita indevida passar. Ver testes dedicados de posse operacional
  // pro comportamento completo.
  // `_recPodeCorrigirRotaNaLoja(lojaId) ||` na frente (sessão seguinte):
  // ramo isolado e propositalmente estreito (só corrige origem/destino de
  // um TRANSBORDO com a loja ativa errada, sem tocar status/horário/NF) —
  // ver o teste dedicado dessa função abaixo.
  assert.match(trecho,/allow update: if resource != null && \(\s*\n\s*_recPodeCorrigirRotaNaLoja\(lojaId\) \|\|\s*\n\s*\(\s*\n\s*_lojaAindaTemAVez\(\)\s*\n\s*\? \(canAccessStore\(lojaId\) && _recPodeEditarNaPropriaLoja\(\)\)\s*\n\s*: \(active\(\) && _recPodeEditarCrossLoja\(resource\.data\.destinoLojaId\)\)/);
  assert.match(rules,/function _lojaAindaTemAVez\(\) \{\s*\n\s*return resource\.data\.tipo != 'TRANSBORDO'\s*\n\s*\|\| !resource\.data\.keys\(\)\.hasAny\(\['destinoLojaId'\]\)\s*\n\s*\|\| resource\.data\.destinoLojaId == null\s*\n\s*\|\| resource\.data\.status == 'PREVISTO';/);
  assert.match(rules,/function _recPodeEditarCrossLoja\(loja\) \{/);

  const trechoAud=rules.slice(rules.indexOf('match /recebimento_auditoria/'),rules.indexOf('match /recebimento_auditoria/')+1200);
  assert.match(trechoAud,/allow create: if \(\s*\n\s*\(canAccessStore\(lojaId\) && \(/);
  assert.match(trechoAud,/hasPermissionRecebimento\('criar'\)/); // antes só aceitava recebimento-operacao, negando auditoria até na própria loja
});

test('REGRESSÃO (causa raiz DEFINITIVA — as duas correções de recebimentos/auditoria acima não adiantavam nada sozinhas): hasPermission() aceitava permissão marcada só pra conta com canal Analista — uma conta só-Coletor NUNCA passava, não importa o que o admin marcasse em Usuários e Permissões',()=>{
  // Esta é a causa raiz de fato do "erro de permissão sendo que eu já dei
  // permissão pro usuário" relatado ao vivo, depois de DUAS tentativas de
  // corrigir só as regras de recebimentos/recebimento_auditoria não
  // resolverem: hasPermission(area,operation) sempre exigiu canUseAnalista()
  // — nunca teve efeito prático enquanto só telas do Analista chamavam
  // hasPermission() pra ações de Recebimento, mas o fluxo de bip fixo por
  // motorista (fase 15) passou a exigir uma checagem equivalente em ações
  // disparadas DIRETO pelo Coletor. Uma conta só-Coletor (canUseAnalista()==
  // false sempre) nunca passava nessa checagem, então TODA permissão
  // marcada em Usuários e Permissões pra essa conta era ignorada nas regras
  // — o painel de permissões (corrigido antes) até deixava marcar, mas a
  // marcação nunca surtia efeito no Firestore. A correção NÃO mudou
  // hasPermission() (ela é chamada centenas de vezes no resto do arquivo —
  // mudar sua definição pra sempre aceitar os dois canais estourou o limite
  // de 1000 sub-expressões do motor de regras do Firestore numa verificação
  // real contra o emulador). Em vez disso, hasPermission() permanece
  // analista-only, e funções SEPARADAS (hasPermissionColetorRecebimento(),
  // hasPermissionRecebimento(), hasPermissionRecebimentoQualquerCanal())
  // cobrem o canal Coletor só nos pontos que genuinamente precisam — cada
  // uma evitando redundância de chamar admin()/canUseAnalista()/
  // canUseColetor() mais de uma vez por operação, já que o arquivo inteiro
  // já opera perto do teto de 1000 sub-expressões por requisição.
  const trecho=rules.slice(rules.indexOf('function hasPermission('),rules.indexOf('function hasPermission(')+700);
  assert.match(trecho,/canUseAnalista\(\) &&/);
  assert.doesNotMatch(trecho,/canUseColetor\(\)/);

  assert.match(rules,/function hasPermissionColetorRecebimento\(operation\) \{/);
  assert.match(rules,/function hasPermissionRecebimento\(operation\) \{/);
  assert.match(rules,/function hasPermissionRecebimentoQualquerCanal\(operation\) \{/);
});
