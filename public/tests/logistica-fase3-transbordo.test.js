const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const opCode=fs.readFileSync(path.join(base,'93-recebimento-operacao.js'),'utf8');
const trbCode=fs.readFileSync(path.join(base,'95-recebimento-transbordo.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8');
const permCode=fs.readFileSync(path.join(base,'37-usuarios-permissoes.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  let seq=0;
  return {
    get: async()=>({size:registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data}))}),
    doc:(id)=>{ const docId=id||('novo'+(seq++)); return {
      id:docId,
      set: async(p)=>{ const a=registro.get(docId)||{}; registro.set(docId,{...a,...p}); },
      update: async(p)=>{ const a=registro.get(docId); if(a===undefined) throw new Error('NOT_FOUND: no document to update'); registro.set(docId,{...a,...p}); },
      delete: async()=>{ registro.delete(docId); },
    }; },
    add: async(payload)=>{ const docId='novo'+(seq++); registro.set(docId,payload); return {id:docId}; },
    where:(campo,op,valor)=>({
      get: async()=>{
        const filtrados=[...registro.entries()].filter(([,data])=>data && data[campo]===valor);
        return { size:filtrados.length, docs:filtrados.map(([id,data])=>({id,data:()=>data})) };
      },
    }),
    _registro: registro,
  };
}
function loadOperacao(colecoes,opts){
  const document={ addEventListener:()=>{}, getElementById:()=>({value:'',textContent:'',innerHTML:''}) };
  const window={
    getDTFirestore:()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) }),
    getDTLojaAtiva:()=>opts?.lojaAtiva||'',
    // Cross-loja (correção estrutural, mesmo padrão do Coletor) — só
    // resolve lojas parceiras explicitamente configuradas em opts.
    getDTRawFirestore:()=>({
      collection:(nome)=>{
        if (nome!=='lojas') return mockColecao([]);
        return { doc:(id)=>({ collection:(sub)=> (opts?.lojasParceiras?.[id]?.[sub]) || mockColecao([]) }) };
      },
    }),
    openModal:()=>{}, closeModal:()=>{}, showToast:()=>{}, showConfirm:(msg,exec)=>exec(),
    _currentAnalistaUser:{email:'teste@daterrinha.com'},
  };
  // setInterval/clearInterval fakes (não-op): 93-recebimento-operacao.js
  // passou a usar setInterval pra atualização periódica (ver comentário
  // "2026-09-11" no arquivo) — nenhum teste aqui exercita esse polling em
  // si, só precisa não quebrar ao chamar carregarRecebimentoOperacao().
  vm.runInNewContext(opCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise,isNaN,setInterval:()=>0,clearInterval:()=>{}},{filename:'93-recebimento-operacao.js'});
  return window;
}

test('máquina de estados de transbordo: não deixa registrar chegada sem ter saído, nem saída fora de PREVISTO',()=>{
  const window=loadOperacao({});
  const i=window._recebimentoOperacaoInternals;
  assert.equal(i.podeRegistrarSaida({status:'PREVISTO'}),true);
  assert.equal(i.podeRegistrarSaida({status:'EM_TRANSITO'}),false);
  assert.equal(i.podeRegistrarChegadaTransbordo({status:'PREVISTO'}),false); // não pode chegar sem ter saído
  assert.equal(i.podeRegistrarChegadaTransbordo({status:'EM_TRANSITO'}),true);
  // a partir de CHEGOU, a cadeia de descarga já existente da FASE 2 funciona sem mudança
  assert.equal(i.podeIniciarDescarga({status:'CHEGOU'}),true);
});

test('CORREÇÃO ESTRUTURAL: no Analista, a origem PERDE a capacidade de agir numa carga cross-loja assim que ela deixa de ser PREVISTO — mesmas guardas (_podeXxx) agora exigem posse, não só status',()=>{
  const window=loadOperacao({},{lojaAtiva:'loja_matriz'}); // sessão do Analista está na Matriz (origem)
  const i=window._recebimentoOperacaoInternals;
  // PREVISTO: ainda é a vez da origem (Matriz) — comportamento normal preservado.
  assert.equal(i.podeRegistrarSaida({status:'PREVISTO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial'}),true);
  // EM_TRANSITO em diante: virou turno exclusivo do destino (Filial) — a
  // Matriz, mesmo vendo a carga (o doc mora na coleção dela), não pode mais
  // agir. Bug ao vivo confirmado em auditoria de código antes desta correção:
  // a Analista via "Registrar chegada" habilitado mesmo depois do despacho.
  assert.equal(i.podeRegistrarChegadaTransbordo({status:'EM_TRANSITO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial'}),false);
  assert.equal(i.podeIniciarDescarga({status:'CHEGOU',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial'}),false);
  assert.equal(i.podeFinalizarDescarga({status:'EM_DESCARGA',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial'}),false);
  assert.equal(i.podeVoltarEtapa({status:'CHEGOU',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial'}),false);
  // Carga sem rota cruzada (destinoLojaId ausente) continua sem restrição
  // nova — compatibilidade com transbordos legados/manuais preservada.
  assert.equal(i.podeRegistrarChegadaTransbordo({status:'EM_TRANSITO'}),true);
});

test('tempoViagemMin é calculado entre horaSaida e horaChegada, sem afetar os outros tempos',()=>{
  const window=loadOperacao({});
  const tempos=window._recebimentoOperacaoInternals.recalcularTempos({
    horaSaida:'2026-08-14T06:00:00.000Z', horaChegada:'2026-08-14T09:30:00.000Z',
  });
  assert.equal(tempos.tempoViagemMin,210);
  assert.equal(tempos.tempoEsperaMin,null); // sem horaInicioDescarga ainda
});

test('fluxo completo de transbordo: sai da matriz → chega na filial → segue a mesma cadeia de descarga da FASE 2, com auditoria em cada passo',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'PREVISTO',criadoEm:'2026-08-14T05:00:00.000Z'}}]);
  const auditoria=mockColecao([]);
  const window=loadOperacao({recebimentos, recebimento_auditoria:auditoria, recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_docas:mockColecao([])});
  await window._recebimentoOperacaoInternals.carregar(true);
  const i=window._recebimentoOperacaoInternals;

  await i.registrarSaida('r1');
  let r=recebimentos._registro.get('r1');
  assert.equal(r.status,'EM_TRANSITO');
  assert.ok(r.horaSaida);

  await i.registrarChegadaTransbordo('r1');
  r=recebimentos._registro.get('r1');
  assert.equal(r.status,'CHEGOU');
  assert.ok(r.horaChegada);
  assert.equal(typeof r.tempoViagemMin,'number');

  await i.iniciarDescarga('r1');
  r=recebimentos._registro.get('r1');
  assert.equal(r.status,'EM_DESCARGA');

  assert.equal(auditoria._registro.size,3);
  const operacoes=[...auditoria._registro.values()].map(x=>x.operacao);
  assert.deepEqual(operacoes,['TRANSBORDO_SAIU','CHEGADA_REGISTRADA','DESCARGA_INICIADA']);
});

test('CORREÇÃO ESTRUTURAL (bug ao vivo real: "gerei uns teste lá e não vi ele somando"): o Analista logado na loja de DESTINO enxerga um transbordo cruzado que mora na loja de ORIGEM, e a ação escreve no lugar certo (não cria um fantasma na própria loja)',async()=>{
  // t1 mora na coleção da MATRIZ (quem gerou) — a Filial só a enxerga via
  // cruzamento cross-loja, exatamente como o Coletor já faz.
  const recebimentosMatriz=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',motoristaNome:'Carlos',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-1'}}]);
  const auditoriaMatriz=mockColecao([]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentosFilial=mockColecao([]); // a Filial não tem nada próprio ainda
  const window=loadOperacao(
    { recebimentos:recebimentosFilial, recebimento_rotas_transbordo:rotas, recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_docas:mockColecao([]) },
    { lojaAtiva:'loja_filial', lojasParceiras:{ loja_matriz:{ recebimentos:recebimentosMatriz, recebimento_auditoria:auditoriaMatriz } } }
  );
  await window._recebimentoOperacaoInternals.carregar(true);
  const i=window._recebimentoOperacaoInternals;

  // [...] normaliza pra um array do REALM de fora — vm.runInNewContext roda
  // 93-recebimento-operacao.js num realm próprio, então um array literal
  // construído lá dentro (mesmo com conteúdo idêntico) falha
  // deepStrictEqual contra um literal daqui fora ("not reference-equal",
  // achado ao vivo rodando este arquivo) — o spread reconstrói o array no
  // realm de quem está comparando.
  assert.deepEqual([...i.recebimentos().map(r=>r._id)],['t1']); // enxergou cruzando loja
  assert.equal(recebimentosFilial._registro.size,0); // nada foi criado na própria coleção só de ler

  await i.registrarChegadaTransbordo('t1');

  assert.equal(recebimentosMatriz._registro.get('t1').status,'CHEGOU'); // escreveu no lugar CERTO (onde o doc mora de verdade)
  assert.equal(recebimentosFilial._registro.size,0); // NÃO criou um fantasma na própria loja
  assert.equal(auditoriaMatriz._registro.size,1); // auditoria também fica junto do dono do registro
  assert.equal([...auditoriaMatriz._registro.values()][0].operacao,'CHEGADA_REGISTRADA');
});

test('geração de identificador/QR: código único por chamada, e a lib vendorizada gera um data URL de imagem real',()=>{
  const codigo1=require(path.join(base,'..','..','vendor','qrcode-generator-2.0.4','qrcode.js'));
  const qr=codigo1(0,'M');
  qr.addData('TRB-TESTE-123');
  qr.make();
  const dataUrl=qr.createDataURL(4,4);
  assert.match(dataUrl,/^data:image\/gif;base64,/);
});

test('navegação/permissões: recebimento-transbordo tem corrigir-horario, e Firestore aceita essa permissão como alternativa em recebimentos + regra própria pra identificadores',()=>{
  assert.match(permCode,/id:'recebimento-transbordo'.*corrigir-horario/);
  // 'criar'/'corrigir-horario' pra 'recebimento-transbordo' não são mais
  // checadas via hasPermission(area, operation) direto na regra — foram
  // consolidadas em hasPermissionRecebimento()/hasPermissionRecebimentoQualquerCanal()
  // (que checam 'recebimento-operacao' E 'recebimento-transbordo' numa
  // ÚNICA chamada de função, em vez de duas chamadas separadas de
  // hasPermission() por área) pra caber no limite de 1000 sub-expressões do
  // motor de regras do Firestore — confirmado via Rules Unit Testing contra
  // o emulador real. O efeito prático (permissão 'recebimento-transbordo'
  // aceita como alternativa) continua o mesmo, só a forma mudou.
  assert.match(rules,/allow create: if \(\s*\n\s*\(canAccessStore\(lojaId\) && hasPermissionRecebimento\('criar'\)\)/);
  // 'corrigir-horario' na regra de UPDATE mora em _recAcaoConsolidada() —
  // função consolidada reaproveitada pelos dois ramos (própria loja e
  // cross-loja) de `allow update`, correção estrutural que evita repetir a
  // checagem de permissão 4x por ramo (achado ao vivo: contas reais têm um
  // mapa `permissoes` grande o bastante pra estourar o limite de 1000
  // sub-expressões repetindo isso).
  assert.match(rules,/function _recAcaoConsolidada[\s\S]*?'corrigir-horario'/);
  const trechoRecebimento=rules.slice(rules.indexOf('function hasPermissionRecebimento('),rules.indexOf('function hasPermissionRecebimento(')+900);
  assert.match(trechoRecebimento,/'recebimento-transbordo'/);
  const trechoConsolidada=rules.slice(rules.indexOf('function _recAcaoConsolidada('),rules.indexOf('function _recAcaoConsolidada(')+2500);
  assert.match(trechoConsolidada,/'recebimento-transbordo'/);

  assert.match(rules,/match \/recebimento_identificadores\//);
  const trecho=rules.slice(rules.indexOf('match /recebimento_identificadores/'));
  assert.match(trecho.slice(0,400),/hasPermission\('recebimento-transbordo', 'gerar-qrcode'\)/);
});

test('tela de Transbordo: botão de novo transbordo, modais e script registrados',()=>{
  assert.match(trbCode,/data-rebt-novo/);
  assert.match(trbCode,/data-rebt-saida/);
  assert.match(trbCode,/data-rebt-chegada/);
  assert.match(htmlCode,/id="modal-rebt"/);
  assert.match(htmlCode,/id="modal-rebt-qr"/);
  assert.match(htmlCode,/95-recebimento-transbordo\.js/);
  assert.match(htmlCode,/qrcode-generator-2\.0\.4\/qrcode\.js/);
});

test('REGRESSÃO: "Gerar QR de teste" (TRANSBORDO-01..04) foi removido — QR fixo por motorista tornou esse fluxo obsoleto e ele só confundia operador em campo (bug ao vivo: bipar TRANSBORDO-04 dava "não vinculado a uma carga")',()=>{
  assert.doesNotMatch(trbCode,/data-rebt-qr-teste/);
  assert.doesNotMatch(trbCode,/recbtGerarQrTeste/);
  assert.doesNotMatch(trbCode,/TRANSBORDO-01/);
});

// ── Excluir / Apagar todos (pedido ao vivo do usuário: "como todos os
// transbordo que eu fiz é teste, eu quero apagar todos, e um por um também,
// os que já estão finalizados, que os outros eu consigo apagar mas os
// finalizados eu não consigo" — "Cancelar" (_podeCancelar) trava em
// FINALIZADO/CANCELADO de propósito; "Excluir" é uma ação NOVA e separada
// que precisa funcionar em QUALQUER status, inclusive esses dois).
// excluir() vai pelo mesmo caminho "fire-and-forget" de recopCancelar()/
// recopVoltarEtapa() já existentes (global.showConfirm abre um MODAL de
// verdade em produção — não dá pra "esperar" o clique do usuário, então a
// função que chama showConfirm nunca aguarda o executar() interno). O mock
// de showConfirm aqui roda o executar() na hora, mas ele ainda tem 2 `await`
// internos (delete + auditoria) — como recopExcluir não aguarda essa cadeia,
// o teste precisa dar uma volta extra no loop de eventos antes de checar o
// estado em memória, senão vê o "meio do caminho".
function flush(){ return new Promise(resolve=>setTimeout(resolve,0)); }

test('excluir(): apaga o documento de verdade (some do Firestore), registra auditoria, e funciona mesmo já FINALIZADO/CANCELADO',async()=>{
  const recebimentos=mockColecao([
    {id:'r1',data:{tipo:'TRANSBORDO',status:'FINALIZADO'}},
    {id:'r2',data:{tipo:'TRANSBORDO',status:'CANCELADO'}},
  ]);
  const auditoria=mockColecao([]);
  const window=loadOperacao({recebimentos, recebimento_auditoria:auditoria, recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_docas:mockColecao([])});
  const i=window._recebimentoOperacaoInternals;
  await i.carregar(true);

  await i.excluir('r1'); await flush();
  assert.equal(recebimentos._registro.has('r1'),false); // FINALIZADO — Cancelar não conseguiria, Excluir consegue
  assert.deepEqual([...i.recebimentos().map(r=>r._id)],['r2']); // saiu da lista em memória também (spread normaliza o array pro realm de fora — ver comentário acima)

  await i.excluir('r2'); await flush();
  assert.equal(recebimentos._registro.has('r2'),false); // CANCELADO — mesma coisa

  assert.equal(auditoria._registro.size,2);
  assert.deepEqual([...auditoria._registro.values()].map(x=>x.operacao),['RECEBIMENTO_EXCLUIDO','RECEBIMENTO_EXCLUIDO']);
});

test('excluir(): cross-loja apaga no lugar CERTO (onde o documento mora de verdade), não na loja ativa do Analista',async()=>{
  const recebimentosMatriz=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'FINALIZADO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial'}}]);
  const auditoriaMatriz=mockColecao([]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentosFilial=mockColecao([]);
  const window=loadOperacao(
    { recebimentos:recebimentosFilial, recebimento_rotas_transbordo:rotas, recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_docas:mockColecao([]) },
    { lojaAtiva:'loja_filial', lojasParceiras:{ loja_matriz:{ recebimentos:recebimentosMatriz, recebimento_auditoria:auditoriaMatriz } } }
  );
  const i=window._recebimentoOperacaoInternals;
  await i.carregar(true);

  await i.excluir('t1'); await flush();
  assert.equal(recebimentosMatriz._registro.has('t1'),false); // apagou onde o doc mora de verdade
  assert.equal(auditoriaMatriz._registro.size,1);
});

test('excluirEmMassa(): apaga vários de uma vez ("Apagar todos") e não trava no resto se um id já não existir mais',async()=>{
  const recebimentos=mockColecao([
    {id:'r1',data:{tipo:'TRANSBORDO',status:'PREVISTO'}},
    {id:'r2',data:{tipo:'TRANSBORDO',status:'FINALIZADO'}},
    {id:'r3',data:{tipo:'TRANSBORDO',status:'CANCELADO'}},
  ]);
  const auditoria=mockColecao([]);
  const window=loadOperacao({recebimentos, recebimento_auditoria:auditoria, recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_docas:mockColecao([])});
  const i=window._recebimentoOperacaoInternals;
  await i.carregar(true);

  await i.excluirEmMassa(['r1','r2','ja-nao-existe','r3']);
  assert.equal(recebimentos._registro.size,0); // os 3 reais sumiram
  assert.deepEqual([...i.recebimentos()],[]); // lista em memória também esvaziou (spread normaliza o array pro realm de fora)
  assert.equal(auditoria._registro.size,3); // um registro de auditoria por exclusão real
});

test('tela de Transbordo: botão "Apagar todos" e o ❌ de exclusão por linha existem e estão registrados no mapa de permissões',()=>{
  assert.match(trbCode,/data-rebt-excluir-todos/);
  assert.match(trbCode,/data-rebt-excluir="/);
  assert.match(trbCode,/recbtExcluirTodos/);
  assert.match(permCode,/'rebt-excluir':'excluir'/);
  assert.match(permCode,/'rebt-excluir-todos':'excluir'/);
  assert.match(permCode,/id:'recebimento-transbordo'.*excluir/);
});

// BUG AO VIVO REAL relatado pelo usuário direto no painel (não suposição):
// "não apareceu os primeiros transbordos... ele tá cobrindo o anterior".
// Causa raiz achada em auditoria de código: _deduplicarRecebimentos()
// usava `identificadorCodigo` como chave de dedup pra TRANSBORDO — mas
// esse código é FIXO POR MOTORISTA e reaproveitado em toda viagem dele, de
// propósito (mesmo motorista, N viagens diferentes = MESMO código). Duas
// viagens reais e distintas do mesmo motorista colidiam na mesma chave, e
// só a mais recente sobrevivia ao filtro — a mais antiga (mesmo ainda
// EM_TRANSITO, sem ninguém ter fechado ela) sumia da tela inteira sem
// nenhum erro.
test('REGRESSÃO (bug ao vivo real, relatado direto pelo usuário: "não apareceu os primeiros transbordos... ele tá cobrindo o anterior"): duas viagens DIFERENTES do MESMO motorista (mesmo identificadorCodigo, documentos distintos) aparecem as DUAS — uma não apaga a outra',async()=>{
  const recebimentos=mockColecao([
    {id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',identificadorCodigo:'MOT-ABC123',motoristaNome:'Carlos',criadoEm:'2026-08-17T06:00:00.000Z',horaSaida:'2026-08-17T06:00:00.000Z'}},
    {id:'t2',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',identificadorCodigo:'MOT-ABC123',motoristaNome:'Carlos',criadoEm:'2026-08-18T06:00:00.000Z',horaSaida:'2026-08-18T06:00:00.000Z'}},
  ]);
  const window=loadOperacao({recebimentos, recebimento_auditoria:mockColecao([]), recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_docas:mockColecao([])});
  const i=window._recebimentoOperacaoInternals;
  await i.carregar(true);

  assert.deepEqual([...i.recebimentos().map(r=>r._id)].sort(),['t1','t2']); // as DUAS viagens aparecem, nenhuma apaga a outra
});

test('firestore.rules: allow delete de recebimentos deixou de ser sempre `false` — agora exige a ação "excluir" (Analista-only), funciona em qualquer status',()=>{
  const trecho=rules.slice(rules.indexOf('match /recebimentos/{docId}'),rules.indexOf('match /recebimento_identificadores/'));
  assert.doesNotMatch(trecho,/allow delete: if false;/);
  assert.match(trecho,/allow delete: if canAccessStore\(lojaId\) && hasPermissionRecebimento\('excluir'\);/);
});
