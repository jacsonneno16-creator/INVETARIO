const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/coletor');
const recCode=fs.readFileSync(path.join(base,'22-recebimento.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const scannerCode=fs.readFileSync(path.join(base,'12-scanner-hardware.js'),'utf8');
const authCode=fs.readFileSync(path.join(base,'04-auth-login.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  let seq=0;
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    doc:(id)=>{
      const docId=id||('novo'+(seq++));
      return {
        id:docId,
        get: async()=>{ const data=registro.get(docId); return { exists: data!==undefined, id:docId, data:()=>data }; },
        set: async(p)=>{ const a=registro.get(docId)||{}; registro.set(docId,{...a,...p}); },
        update: async(p)=>{ const a=registro.get(docId); if(a===undefined) throw new Error('NOT_FOUND: no document to update'); registro.set(docId,{...a,...p}); },
        delete: async()=>{ registro.delete(docId); },
      };
    },
    add: async(payload)=>{ const docId='novo'+(seq++); registro.set(docId,payload); return {id:docId}; },
    where:(campo,op,valor)=>{
      const filtrados=()=>[...registro.entries()].filter(([,data])=>data && data[campo]===valor);
      return {
        get: async()=>snapshot(filtrados()),
        limit:(n)=>({ get: async()=>snapshot(filtrados().slice(0,n)) }),
      };
    },
    _registro: registro,
  };
}

// Migrado pra jsdom de verdade (era um objeto de elementos mockado à mão) —
// a tela de Nota Fiscal (22-recebimento.js) ganhou uma reescrita concorrente
// (volume por NF, linhas geradas dinamicamente via innerHTML + querySelector)
// que o mock antigo não suportava (não tinha querySelector, só querySelectorAll
// vazio) — mesma lição já aprendida nesta sessão pro Produção: só execução
// real via jsdom pega esse tipo de incompatibilidade de contrato de DOM.
const SHELL = `<!doctype html><html><body>
<div id="rec-abas"></div>
<input type="date" id="rec-gerados-data">
<div id="rec-gerados-atalhos"></div>
<div id="rec-lista-titulo"></div>
<div id="rec-lista-andamento"></div>
<input id="rec-scan-input">
<div id="rec-scan-status"></div>
<div id="rec-destino-lista"></div>
<div id="rec-nf-titulo"></div>
<div id="rec-nf-subtitulo"></div>
<div id="rec-obs-bloco"></div>
<div id="rec-nf-lista"></div>
<div id="rec-nf-status"></div>
<button id="rec-nf-btn"></button>
<div id="rec-conf-icone"></div>
<div id="rec-conf-titulo"></div>
<div id="rec-conf-corpo"></div>
</body></html>`;

function loadRecebimento(colecoes, opts){
  const telas=[];
  const toasts=[];
  const dom=new JSDOM(SHELL,{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window;
  const document=win.document;
  // Proxy: sempre busca o elemento AO VIVO no document — as linhas de NF são
  // recriadas (innerHTML reatribuído) a cada _redesenharListaNfRecebimento(),
  // então uma referência guardada uma vez só ficaria obsoleta (nó desanexado).
  const els=new Proxy({},{ get:(_,id)=>document.getElementById(id) });

  const lojas=mockColecao([{id: opts?.lojaId || 'loja1', data:{nome: opts?.lojaNome ?? 'Loja Matriz'}}]);
  win.FS={ collection:(nome)=>colecoes?.[nome]||mockColecao([]) };
  win.APP={ operador:{ email:'operador@daterrinha.com' } };
  win.goScreen=(id)=>{ telas.push(id); };
  win.toast=(msg,tipo)=>{ toasts.push({msg,tipo}); };
  win.obterDeviceId=opts?.obterDeviceId || (()=>'dt_teste123');
  win.getDTLojaAtiva=()=> (opts?.lojaId || 'loja1');
  win.getDTRawFirestore=()=>({
    collection:(nome)=>{
      if (nome!=='lojas') return mockColecao([]);
      return {
        ...lojas,
        doc:(id)=>{
          const docBase=lojas.doc(id);
          return { ...docBase, collection:(sub)=> (opts?.lojasParceiras?.[id]?.[sub]) || mockColecao([]) };
        },
      };
    },
  });
  win.confirm=opts?.confirm || (()=>true);
  if (opts?.showConfirm) win.showConfirm=opts.showConfirm;
  Object.defineProperty(win.navigator,'onLine',{ get:()=>opts?.online !== false, configurable:true });
  win.eval(recCode);
  return { ctx:win, els, telas, toasts, lojas, document };
}

// Preenche a NF (e, quando informado, o volume) da linha `idx` (0 = a
// primeira, com id fixo "rec-nf-input"; as demais só têm data-nf-input).
// SAÍDA exige volume > 0 por nota; CHEGADA não (só confere o número).
function preencherNf(document, idx, numero, volume){
  const numEl = idx===0 ? document.getElementById('rec-nf-input') : document.querySelector('[data-nf-input="'+idx+'"]');
  numEl.value = numero;
  if (volume!=null){
    const volEl = document.querySelector('[data-nf-volume="'+idx+'"]');
    if (volEl) volEl.value = String(volume);
  }
}

test('lista "em andamento" só traz TRANSBORDO nos status ativos, mais recente primeiro',async()=>{
  const recebimentos=mockColecao([
    {id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',horaSaida:'2026-08-14T06:00:00.000Z',identificadorCodigo:'TRB-1'}},
    {id:'r2',data:{tipo:'TRANSBORDO',status:'FINALIZADO',horaSaida:'2026-08-14T05:00:00.000Z',identificadorCodigo:'TRB-2'}},
    {id:'r3',data:{tipo:'FORNECEDOR',status:'EM_DESCARGA',horaSaida:'2026-08-14T07:00:00.000Z',identificadorCodigo:'FORN-1'}},
    {id:'r4',data:{tipo:'TRANSBORDO',status:'EM_DESCARGA',horaSaida:'2026-08-14T08:00:00.000Z',identificadorCodigo:'TRB-4'}},
  ]);
  const { ctx, els }=loadRecebimento({ recebimentos });
  await ctx.carregarRecebimentoColetor();
  const emAndamento=ctx._cargasEmAndamento();
  assert.deepEqual(emAndamento.map(r=>r._id),['r4','r1']); // r2 finalizado fica de fora, r3 é fornecedor (fica de fora)
  // por padrão a aba "Em Trânsito" é a ativa — só mostra r1 (EM_TRANSITO);
  // r4 (EM_DESCARGA) mora na aba "Em Andamento"
  assert.match(els['rec-lista-andamento'].innerHTML,/TRB-1/);
  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/TRB-4/);
  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/FORN-1/);

  ctx._selecionarAbaRecebimento('andamento');
  assert.match(els['rec-lista-andamento'].innerHTML,/TRB-4/);
  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/TRB-1/);
});

test('guarda replicada bate com a máquina de estados da FASE 3: só avança um passo por vez, na ordem certa',async()=>{
  const recebimentos=mockColecao([
    {id:'rA',data:{tipo:'TRANSBORDO',status:'EM_CONFERENCIA'}}, // depois da descarga, aguardando o Analista finalizar — Coletor não bipa mais nada aqui
    {id:'rB',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'999'}},
    {id:'rC',data:{tipo:'TRANSBORDO',status:'CANCELADO'}},
  ]);
  const { ctx, els, telas }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) });

  await ctx.abrirConfirmacaoParaRecebimento('rA');
  assert.equal(recebimentos._registro.get('rA').status,'EM_CONFERENCIA');
  assert.match(els['rec-conf-titulo'].textContent,/Não é possível avançar/);

  // EM_TRANSITO -> tela de conferência de NF primeiro, só aplica CHEGOU depois de confirmar
  await ctx.abrirConfirmacaoParaRecebimento('rB');
  assert.equal(recebimentos._registro.get('rB').status,'EM_TRANSITO'); // ainda não aplicou
  assert.ok(telas.includes('recebimento-nf'));
  preencherNf(els.document||ctx.document,0,'999'); // chegada — não exige volume
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get('rB').status,'CHEGOU');
  assert.match(els['rec-conf-titulo'].textContent,/Chegada registrada/);

  // CANCELADO: não deixa bipar de jeito nenhum
  await ctx.abrirConfirmacaoParaRecebimento('rC');
  assert.equal(recebimentos._registro.get('rC').status,'CANCELADO');
});

test('controle de Nota Fiscal: bip de SAÍDA na Matriz informa a NF pela 1ª vez, identifica o motorista e libera a carga pra viagem',async()=>{
  const recebimentos=mockColecao([{id:'m1',data:{tipo:'TRANSBORDO',status:'PREVISTO',motoristaNome:'Carlos',placa:'XYZ9A87',origem:'Matriz',destino:'Filial 3'}}]);
  const auditoria=mockColecao([]);
  const { ctx, els, telas }=loadRecebimento({ recebimentos, recebimento_auditoria:auditoria });

  await ctx.abrirConfirmacaoParaRecebimento('m1');
  assert.ok(telas.includes('recebimento-nf'));
  assert.match(els['rec-nf-subtitulo'].textContent,/Carlos/); // motorista identificado antes de pedir a NF
  assert.equal(recebimentos._registro.get('m1').status,'PREVISTO'); // ainda não aplicou

  preencherNf(ctx.document,0,'NF-4321',10); // saída exige volume > 0
  await ctx.confirmarNotaFiscalRecebimento();

  const r=recebimentos._registro.get('m1');
  assert.equal(r.status,'EM_TRANSITO');
  assert.equal(r.notaFiscalTransferencia,'NF-4321');
  assert.ok(r.horaSaida);
  assert.equal([...auditoria._registro.values()][0].operacao,'TRANSBORDO_SAIU');
});

test('PEDIDO AO VIVO: "ter a opção de colocar mais de uma nota fiscal" — adicionar() empilha várias linhas (NF+volume) na mesma saída, e a chegada confere como CONJUNTO (ordem diferente ainda bate)',async()=>{
  const recebimentos=mockColecao([{id:'m1',data:{tipo:'TRANSBORDO',status:'PREVISTO',motoristaNome:'Carlos'}}]);
  const { ctx }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) });

  await ctx.abrirConfirmacaoParaRecebimento('m1');
  preencherNf(ctx.document,0,'NF-1',5);
  ctx.adicionarNotaFiscalRecebimento();
  assert.match(ctx.document.getElementById('rec-nf-lista').innerHTML,/NF-1/);
  preencherNf(ctx.document,1,'NF-2',5);
  ctx.adicionarNotaFiscalRecebimento();
  assert.match(ctx.document.getElementById('rec-nf-lista').innerHTML,/NF-2/);
  preencherNf(ctx.document,2,'NF-3',5); // 3ª linha, sem clicar em "+" de novo — confirmar tem que pegar ela também
  await ctx.confirmarNotaFiscalRecebimento();

  const r=recebimentos._registro.get('m1');
  assert.equal(r.status,'EM_TRANSITO');
  assert.equal(r.notaFiscalTransferencia,'NF-1, NF-2, NF-3');
  assert.equal(r.volumes,15); // 5+5+5

  // Filial confere as 3 notas, mas digitadas em ORDEM diferente — ainda tem que bater (conjunto, não string exata)
  await ctx.abrirConfirmacaoParaRecebimento('m1');
  preencherNf(ctx.document,0,'NF-3');
  ctx.adicionarNotaFiscalRecebimento();
  preencherNf(ctx.document,1,'NF-1');
  ctx.adicionarNotaFiscalRecebimento();
  preencherNf(ctx.document,2,'NF-2');
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get('m1').status,'CHEGOU');
});

test('PEDIDO AO VIVO: notas repetidas não empilham duas vezes, e uma nota errada na chegada não fica "grudada" numa tentativa seguinte',async()=>{
  const recebimentos=mockColecao([{id:'m1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'NF-1, NF-2'}}]);
  const { ctx }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) });

  await ctx.abrirConfirmacaoParaRecebimento('m1');
  preencherNf(ctx.document,0,'NF-1');
  ctx.adicionarNotaFiscalRecebimento(); // linha 0 fica com NF-1, cria a linha 1 (em branco)
  preencherNf(ctx.document,1,'NF-1'); // repetida de propósito, na linha recém-criada
  ctx.adicionarNotaFiscalRecebimento();
  assert.match(ctx.document.getElementById('rec-nf-status').textContent,/já foi adicionada/i);

  // erra a 2ª nota — nega, e a lista some (não gruda pra próxima tentativa)
  preencherNf(ctx.document,1,'NF-ERRADA');
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get('m1').status,'EM_TRANSITO');
  assert.doesNotMatch(ctx.document.getElementById('rec-nf-lista').innerHTML,/NF-1|NF-ERRADA/); // limpou pra tentar de novo do zero

  preencherNf(ctx.document,0,'NF-1');
  ctx.adicionarNotaFiscalRecebimento();
  preencherNf(ctx.document,1,'NF-2');
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get('m1').status,'CHEGOU');
});

test('controle de Nota Fiscal: NF divergente bloqueia a chegada e não conclui automaticamente',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'123456'}}]);
  const { ctx, els, telas }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) });

  await ctx.abrirConfirmacaoParaRecebimento('r1');
  assert.match(els['rec-nf-subtitulo'].textContent,/123456/);

  preencherNf(ctx.document,0,'000000'); // número errado
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get('r1').status,'EM_TRANSITO'); // continua sem avançar
  assert.match(els['rec-nf-status'].textContent,/não confere/i);
  assert.equal(telas.includes('recebimento-confirmacao'),false); // não navegou pra confirmação de sucesso

  // corrige e confirma de novo, sem sair da tela
  preencherNf(ctx.document,0,'123456');
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get('r1').status,'CHEGOU');
  assert.ok(recebimentos._registro.get('r1').notaFiscalConfirmadaEm);
});

test('fluxo completo online por toque na lista: chegada → início descarga → fim descarga, com auditoria e tempos calculados',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',horaSaida:'2026-08-14T06:00:00.000Z',motoristaNome:'João',placa:'ABC1D23',origem:'Matriz',destino:'Filial 2',notaFiscalTransferencia:'555'}}]);
  const auditoria=mockColecao([]);
  const { ctx, els }=loadRecebimento({ recebimentos, recebimento_auditoria:auditoria });

  await ctx.abrirConfirmacaoParaRecebimento('r1'); // vai pra tela de conferência de NF
  preencherNf(ctx.document,0,'555');
  await ctx.confirmarNotaFiscalRecebimento();
  let r=recebimentos._registro.get('r1');
  assert.equal(r.status,'CHEGOU');
  assert.ok(r.horaChegada);
  assert.equal(typeof r.tempoViagemMin,'number');
  assert.ok(r.notaFiscalConfirmadaEm);

  await ctx.abrirConfirmacaoParaRecebimento('r1');
  r=recebimentos._registro.get('r1');
  assert.equal(r.status,'EM_DESCARGA');
  assert.ok(r.horaInicioDescarga);

  await ctx.abrirConfirmacaoParaRecebimento('r1');
  r=recebimentos._registro.get('r1');
  assert.equal(r.status,'DESCARGA_FINALIZADA');
  assert.ok(r.horaFimDescarga);
  assert.equal(typeof r.tempoEsperaMin,'number');
  assert.equal(typeof r.tempoDescargaMin,'number');
  assert.equal(typeof r.tempoTotalMin,'number');
  assert.match(els['rec-conf-corpo'].innerHTML,/Espera/);
  assert.match(els['rec-conf-corpo'].innerHTML,/Descarga/);
  assert.match(els['rec-conf-corpo'].innerHTML,/Total/);

  assert.equal(auditoria._registro.size,3);
  const operacoes=[...auditoria._registro.values()].map(x=>x.operacao);
  assert.deepEqual(operacoes,['CHEGADA_REGISTRADA','DESCARGA_INICIADA','DESCARGA_FINALIZADA']);
  const ultima=[...auditoria._registro.values()].pop();
  assert.equal(ultima.dispositivo,'dt_teste123');
  assert.equal(ultima.usuario,'operador@daterrinha.com');
});

test('PEDIDO AO VIVO ("hoje ele só clica e já vai"): todo bip (início/fim de descarga, conferência) passa por uma caixinha de confirmação antes de gravar — cancelar não grava nada',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'CHEGOU',horaSaida:'2026-08-14T06:00:00.000Z',horaChegada:'2026-08-14T07:00:00.000Z',motoristaNome:'João'}}]);
  const auditoria=mockColecao([]);
  const chamadas=[]; // { msg, opts }
  let deveConfirmar=false;
  const showConfirmMock=(msg,onOk,opts)=>{ chamadas.push({msg,opts}); if (deveConfirmar) onOk(); else opts.onCancel(); };
  const { ctx }=loadRecebimento({ recebimentos, recebimento_auditoria:auditoria },{ showConfirm:showConfirmMock });

  // Cancelar: a caixinha aparece, mas nada é gravado.
  await ctx.abrirConfirmacaoParaRecebimento('r1');
  assert.equal(chamadas.length,1);
  assert.match(chamadas[0].msg,/[Cc]onfirmar/);
  assert.equal(chamadas[0].opts.title,'Descarga iniciada');
  assert.equal(recebimentos._registro.get('r1').status,'CHEGOU'); // continua CHEGOU — nada aplicado

  // Confirmar: agora sim aplica.
  deveConfirmar=true;
  await ctx.abrirConfirmacaoParaRecebimento('r1');
  assert.equal(recebimentos._registro.get('r1').status,'EM_DESCARGA');
});

test('PEDIDO AO VIVO: a caixinha de confirmação também aparece pro bip offline (fila) — cancelar não enfileira nada',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'CHEGOU',horaSaida:'2026-08-14T06:00:00.000Z',horaChegada:'2026-08-14T07:00:00.000Z',motoristaNome:'João'}}]);
  const showConfirmMock=(msg,onOk,opts)=>{ opts.onCancel(); }; // sempre cancela
  const { ctx }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) },{ showConfirm:showConfirmMock, online:false });

  await ctx.abrirConfirmacaoParaRecebimento('r1');
  assert.equal(recebimentos._registro.get('r1').status,'CHEGOU'); // nada mudou, nada foi enfileirado
});

test('scan por código: resolve identificador -> recebimentoId e leva pra conferência de NF (mesmo bip da lista)',async()=>{
  const identificadores=mockColecao([{id:'i1',data:{codigo:'TRB-XYZ',recebimentoId:'r9'}}]);
  const recebimentos=mockColecao([{id:'r9',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',notaFiscalTransferencia:'777'}}]);
  const { ctx, els, telas }=loadRecebimento({ recebimento_identificadores:identificadores, recebimentos, recebimento_auditoria:mockColecao([]) });
  await ctx.carregarRecebimentoColetor(); // popula IDENTIFICADORES_CACHE (resolução de código não depende mais de consulta ao vivo)

  els['rec-scan-input'].value='trb-xyz'; // digitado em minúsculo — precisa normalizar
  await ctx.confirmarCodigoRecebimento();
  assert.ok(telas.includes('recebimento-nf'));
  assert.equal(recebimentos._registro.get('r9').status,'EM_TRANSITO'); // ainda não aplicou, falta confirmar a NF

  preencherNf(ctx.document,0,'777');
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get('r9').status,'CHEGOU');
  assert.ok(telas.includes('recebimento-confirmacao'));
});

test('scan por código inexistente não trava e avisa na tela, sem gravar nada',async()=>{
  const { ctx, els }=loadRecebimento({ recebimento_identificadores:mockColecao([]) });
  await ctx.carregarRecebimentoColetor();
  els['rec-scan-input'].value='NAO-EXISTE';
  await ctx.confirmarCodigoRecebimento();
  assert.match(els['rec-scan-status'].textContent,/não encontrado/i);
});

test('REGRESSÃO/FASE 4b: bip do código FIXO do motorista (sem transbordo em andamento) cria o transbordo sozinho — sem o Analista preencher formulário nenhum, com origem=loja atual, destino=padrão configurado e veículo habitual',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123',transportadora:'Transp X',ativo:true}}]);
  const veiculos=mockColecao([{id:'v1',data:{placa:'XYZ9A87',motoristaHabitualId:'mo1',transportadora:'Transp X'}}]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja1',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentos=mockColecao([]);
  const { ctx, els, telas }=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:veiculos, recebimento_rotas_transbordo:rotas, recebimentos, recebimento_identificadores:mockColecao([]) }, { lojaNome:'Loja Matriz' });
  await ctx.carregarRecebimentoColetor();

  els['rec-scan-input'].value='mot-abc123'; // minúsculo — precisa normalizar
  await ctx.confirmarCodigoRecebimento();

  assert.equal(recebimentos._registro.size,1); // criou sozinho, sem Analista
  const novo=[...recebimentos._registro.values()][0];
  assert.equal(novo.status,'PREVISTO');
  assert.equal(novo.motoristaId,'mo1');
  assert.equal(novo.motoristaNome,'Carlos Silva');
  assert.equal(novo.origem,'Loja Matriz'); // loja atual do Coletor
  assert.equal(novo.destino,'Filial Centro'); // padrão configurado
  assert.equal(novo.destinoLojaId,'loja_filial'); // id real da loja parceira, usado pro cruzamento cross-loja
  assert.equal(novo.placa,'XYZ9A87'); // veículo habitual do motorista
  assert.equal(novo.identificadorCodigo,'MOT-ABC123');
  // REGRESSÃO (bug ao vivo: "erro de permissão" bem na hora de confirmar a
  // NF da saída) — firestore.rules trata campo AUSENTE e campo `null` como
  // coisas diferentes; o guard de primeira-escrita derruba a regra inteira
  // se o campo nunca existiu no documento. Este mock não reproduz essa
  // distinção sozinho (por isso o bug passou batido antes), então a
  // checagem explícita abaixo é o que realmente trava a regressão.
  ['horaChegada','horaSaida','horaInicioDescarga','horaFimDescarga','horaFechamentoRecebimento','notaFiscalTransferencia','notaFiscalConfirmadaEm','notaFiscalConfirmadaPor'].forEach(campo=>{
    assert.ok(Object.prototype.hasOwnProperty.call(novo,campo),'campo '+campo+' precisa existir no documento (mesmo que null)');
    assert.equal(novo[campo],null,'campo '+campo+' precisa ser null explícito, não ausente');
  });
  assert.ok(telas.includes('recebimento-nf')); // já entra direto na tela de NF da saída
  assert.match(els['rec-nf-subtitulo'].textContent,/Carlos Silva/);

  // completa a NF — vira a saída de verdade (mesmo fluxo de sempre)
  preencherNf(ctx.document,0,'NF-999',3);
  await ctx.confirmarNotaFiscalRecebimento();
  const atualizado=recebimentos._registro.get([...recebimentos._registro.keys()][0]);
  assert.equal(atualizado.status,'EM_TRANSITO');
  assert.equal(atualizado.notaFiscalTransferencia,'NF-999');
});

test('CORREÇÃO ESTRUTURAL (bug ao vivo real, documento em produção com destinoLojaId:null apesar da rota existir): ROTAS_CACHE vazio no instante do bip (carregarRecebimentoColetor não foi chamado antes, ou ainda não terminou) consulta o Firestore ao vivo antes de criar sem destino',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123',ativo:true}}]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja1',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentos=mockColecao([]);
  const { ctx, els }=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimentos, recebimento_identificadores:mockColecao([]) }, { lojaNome:'Loja Matriz' });
  // Propositalmente NÃO chama carregarRecebimentoColetor() antes — simula o
  // bip acontecendo antes do carregamento de fundo terminar (abrirScanRecebimento
  // dispara isso sem esperar). MOTORISTAS_CACHE também fica vazio, então o
  // código cai no backstop _buscarMotoristaPorCodigoAoVivo (já existente) —
  // aqui o que importa é o backstop NOVO, de rotas.
  els['rec-scan-input'].value='mot-abc123';
  await ctx.confirmarCodigoRecebimento();

  assert.equal(recebimentos._registro.size,1,'tinha que ter criado o transbordo (rota existe, só não estava em cache)');
  const novo=[...recebimentos._registro.values()][0];
  assert.equal(novo.destinoLojaId,'loja_filial','NUNCA pode ficar null quando existe rota real — isso desliga a proteção de posse pra sempre neste registro');
  assert.equal(novo.destino,'Filial Centro');
});

test('CORREÇÃO ESTRUTURAL: sem NENHUMA rota cadastrada (nem em cache, nem no Firestore), bloqueia a criação com aviso claro em vez de criar um transbordo sem dono',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123',ativo:true}}]);
  const recebimentos=mockColecao([]);
  const { ctx, els }=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:mockColecao([]), recebimentos, recebimento_identificadores:mockColecao([]) }, { lojaNome:'Loja Matriz' });

  els['rec-scan-input'].value='mot-abc123';
  await ctx.confirmarCodigoRecebimento();

  assert.equal(recebimentos._registro.size,0,'NUNCA pode criar um transbordo sem destino — isso desliga a proteção de posse pra sempre');
  assert.match(els['rec-scan-status'].textContent,/nenhuma rota/i);
});

test('FASE 4b: bipar o código do motorista DE NOVO enquanto já tem viagem em andamento continua ela — não cria um transbordo duplicado',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123'}}]);
  const recebimentos=mockColecao([{id:'rX',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',motoristaId:'mo1',motoristaNome:'Carlos Silva',notaFiscalTransferencia:'NF-999'}}]);
  const { ctx, els, telas }=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_config_geral:mockColecao([]), recebimentos, recebimento_identificadores:mockColecao([]) });
  await ctx.carregarRecebimentoColetor();

  els['rec-scan-input'].value='MOT-ABC123';
  await ctx.confirmarCodigoRecebimento();

  assert.equal(recebimentos._registro.size,1); // não duplicou
  assert.ok(telas.includes('recebimento-nf')); // segue pro próximo passo (confirmar NF da chegada) da MESMA carga
  assert.match(els['rec-nf-subtitulo'].textContent,/NF-999/);
});

test('REGRESSÃO/FASE 4e: motorista cadastrado DEPOIS que o Coletor já tinha carregado a tela (cache desatualizado) ainda é reconhecido — busca ao vivo no Firestore como backstop, sem depender de reabrir o app (bug ao vivo: "código não encontrado" logo após cadastrar)',async()=>{
  const motoristas=mockColecao([]); // Coletor carrega ANTES do motorista existir
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja1',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentos=mockColecao([]);
  const { ctx, els }=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_config_geral:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimentos, recebimento_identificadores:mockColecao([]) });
  await ctx.carregarRecebimentoColetor(); // cache vazio de motoristas, de propósito

  // só DEPOIS o motorista é cadastrado (simula o Analista criando em outra sessão)
  motoristas._registro.set('mo9',{nome:'Ana Nova',codigo:'MOT-NOVO99'});

  els['rec-scan-input'].value='mot-novo99'; // minúsculo — precisa normalizar igual nos outros casos
  await ctx.confirmarCodigoRecebimento();

  assert.doesNotMatch(els['rec-scan-status'].textContent||'',/não encontrado/i);
  assert.equal(recebimentos._registro.size,1); // achou o motorista ao vivo e criou o transbordo normalmente
  assert.equal([...recebimentos._registro.values()][0].motoristaNome,'Ana Nova');
});

test('FASE 4b: bipar código de motorista sem transbordo em andamento OFFLINE agora entra na fila durável (mesmo padrão dos bips) em vez de recusar — bug ao vivo real: sem isso, a criação sem rede ficava pendurada pra sempre no SDK e sumia se o app fosse fechado antes da internet voltar',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123'}}]);
  const recebimentos=mockColecao([]);
  const { ctx, els }=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_config_geral:mockColecao([]), recebimentos, recebimento_identificadores:mockColecao([]) }, { online:false });
  await ctx.carregarRecebimentoColetor();
  // Fila durável (23-recebimento-offline.js) não foi carregada neste harness
  // — só 22-recebimento.js. `_enfileirarCriacaoTransbordoPendente` referencia
  // `recIdbPut`/`atualizarIndicadorPendenciasRecebimento`, que não existem
  // aqui — cai no catch da função (nada quebra, mas também não enfileira de
  // verdade). O que importa pra este teste é o comportamento OBSERVÁVEL:
  // nada é criado no servidor, sem crash.
  ctx.recIdbPut=async()=>{};
  ctx.atualizarIndicadorPendenciasRecebimento=async()=>{};

  els['rec-scan-input'].value='MOT-ABC123';
  await ctx.confirmarCodigoRecebimento();

  assert.equal(recebimentos._registro.size,0); // nada criado no servidor — ficou só na fila local
});

test('FASE 4b: motorista sem veículo habitual cadastrado não quebra — placa fica vazia',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Ana',codigo:'MOT-SOLO'}}]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja1',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentos=mockColecao([]);
  const { ctx, els }=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_config_geral:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimentos, recebimento_identificadores:mockColecao([]) });
  await ctx.carregarRecebimentoColetor();

  els['rec-scan-input'].value='MOT-SOLO';
  await ctx.confirmarCodigoRecebimento();

  const novo=[...recebimentos._registro.values()][0];
  assert.equal(novo.placa,'');
  assert.equal(novo.veiculoId,'');
});

test('REGRESSÃO/FASE 4d: fluxo completo bipando SEMPRE o mesmo QR fixo do motorista — matriz gera, filial confirma chegada/descarga/fim, e um 5º bip fecha a conferência da nota (pedido ao vivo do usuário: "o QR Code fixo do motorista é o identificador de todo o processo")',async()=>{
  // Reescrito pra usar DOIS aparelhos/lojas de verdade (Matriz e Filial),
  // não o mesmo ctx pros 5 bips — desde a correção estrutural que garante
  // destinoLojaId sempre preenchido (bug ao vivo real: documento em produção
  // com destinoLojaId:null apesar da rota existir, porque o teste antigo
  // simulava "o mesmo aparelho faz tudo" e nunca exercitava a posse
  // operacional de verdade), só o destino pode avançar a carga a partir da
  // chegada — o mesmo aparelho da Matriz bipando de novo já não é mais dono.
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123'}}]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja1',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentos=mockColecao([]);
  const auditoria=mockColecao([]);
  const matriz=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_config_geral:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimentos, recebimento_identificadores:mockColecao([]), recebimento_auditoria:auditoria });
  const filial=loadRecebimento({ recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_config_geral:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimentos:mockColecao([]), recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_filial', lojaNome:'Filial Centro', lojasParceiras:{ loja1:{ recebimentos, recebimento_auditoria:auditoria } } });
  await matriz.ctx.carregarRecebimentoColetor();

  // 1) Matriz: bipa o QR do motorista pela 1ª vez — gera o transbordo sozinho
  matriz.els['rec-scan-input'].value='MOT-ABC123';
  await matriz.ctx.confirmarCodigoRecebimento();
  assert.equal(recebimentos._registro.size,1); // nenhuma carga pré-existente, nenhum código de carga pedido
  const id=[...recebimentos._registro.keys()][0];
  assert.equal(recebimentos._registro.get(id).status,'PREVISTO');
  preencherNf(matriz.ctx.document,0,'NF-777',7);
  await matriz.ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get(id).status,'EM_TRANSITO');
  assert.equal(recebimentos._registro.get(id).notaFiscalTransferencia,'NF-777');

  // 2) Filial: bipa o MESMO QR — chegou
  await filial.ctx.carregarRecebimentoColetor(true);
  filial.els['rec-scan-input'].value='MOT-ABC123';
  await filial.ctx.confirmarCodigoRecebimento();
  assert.ok(filial.telas.includes('recebimento-nf')); // confere a NF antes de concluir a chegada
  preencherNf(filial.ctx.document,0,'NF-777');
  await filial.ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.get(id).status,'CHEGOU');

  // 3) Filial bipa de novo — início da descarga
  await filial.ctx.carregarRecebimentoColetor(true);
  filial.els['rec-scan-input'].value='MOT-ABC123';
  await filial.ctx.confirmarCodigoRecebimento();
  assert.equal(recebimentos._registro.get(id).status,'EM_DESCARGA');
  assert.ok(recebimentos._registro.get(id).horaInicioDescarga);

  // 4) Filial bipa de novo — fim da descarga (carga ainda tem que aparecer na lista "em andamento" pro 5º bip)
  await filial.ctx.carregarRecebimentoColetor(true);
  assert.ok(filial.ctx._cargasEmAndamento().some(r=>r._id===id));
  filial.els['rec-scan-input'].value='MOT-ABC123';
  await filial.ctx.confirmarCodigoRecebimento();
  assert.equal(recebimentos._registro.get(id).status,'DESCARGA_FINALIZADA');
  assert.ok(recebimentos._registro.get(id).horaFimDescarga);

  // 5) Filial bipa de novo — conferência da nota, fecha o processo
  await filial.ctx.carregarRecebimentoColetor(true);
  assert.ok(filial.ctx._cargasEmAndamento().some(r=>r._id===id)); // continua "em andamento" até este último bip
  filial.els['rec-scan-input'].value='MOT-ABC123';
  await filial.ctx.confirmarCodigoRecebimento();
  const final=recebimentos._registro.get(id);
  assert.equal(final.status,'FINALIZADO');
  assert.ok(final.horaFechamentoRecebimento);
  assert.match(filial.els['rec-conf-titulo'].textContent,/conferida|finalizado/i);

  await filial.ctx.carregarRecebimentoColetor(true);
  assert.ok(!filial.ctx._cargasEmAndamento().some(r=>r._id===id)); // some da lista só depois de FINALIZADO

  // Matriz também não vê mais a carga (nem antes nem depois de finalizada) —
  // desde a saída, ela deixou de ser "dela".
  await matriz.ctx.carregarRecebimentoColetor(true);
  assert.ok(!matriz.ctx._cargasEmAndamento().some(r=>r._id===id));

  const operacoes=[...auditoria._registro.values()].map(x=>x.operacao);
  assert.deepEqual(operacoes,['TRANSBORDO_SAIU','CHEGADA_REGISTRADA','DESCARGA_INICIADA','DESCARGA_FINALIZADA','RECEBIMENTO_FINALIZADO']);
});

test('REGRESSÃO/FASE 4f: "Voltar etapa" aparece nos cards em andamento e reverte o status certo, limpando só o horário daquela etapa (pedido ao vivo do usuário: "não quero que uma ação errada deixe o transbordo preso em uma etapa sem possibilidade de correção")',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'CHEGOU',motoristaNome:'Carlos',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-1',horaChegada:'2026-08-14T07:00:00.000Z',notaFiscalConfirmadaEm:'2026-08-14T07:00:05.000Z',notaFiscalConfirmadaPor:'x@x.com'}}]);
  const auditoria=mockColecao([]);
  const { ctx, els }=loadRecebimento({ recebimentos, recebimento_auditoria:auditoria });
  await ctx.carregarRecebimentoColetor();
  ctx._selecionarAbaRecebimento('andamento'); // CHEGOU mora na aba "Em Andamento"

  assert.match(els['rec-lista-andamento'].innerHTML,/data-recid-voltar="r1"/); // botão aparece pro status revertível

  await ctx.voltarEtapaRecebimento('r1');
  const doc=recebimentos._registro.get('r1');
  assert.equal(doc.status,'EM_TRANSITO');
  assert.equal(doc.horaChegada,null);
  assert.equal(doc.notaFiscalConfirmadaEm,null);
  assert.equal(doc.notaFiscalConfirmadaPor,null);
  assert.equal(doc.horaSaida,'2026-08-14T06:00:00.000Z'); // etapa anterior intacta
  assert.equal(doc.notaFiscalTransferencia,'NF-1');
  assert.equal(doc.motoristaNome,'Carlos');
  assert.equal([...auditoria._registro.values()][0].operacao,'ETAPA_REVERTIDA');
});

test('FASE 4f: sem confirmação do operador, "Voltar etapa" não grava nada',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',horaSaida:'2026-08-14T06:00:00.000Z'}}]);
  const { ctx }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) }, { confirm:()=>false });
  await ctx.carregarRecebimentoColetor();

  await ctx.voltarEtapaRecebimento('r1');
  assert.equal(recebimentos._registro.get('r1').status,'EM_TRANSITO'); // não mudou
});

test('FASE 4f: sem permissão de corrigir-horário, o Firestore nega e o operador vê uma mensagem clara (não um erro genérico)',async()=>{
  const registro=new Map([['r1',{tipo:'TRANSBORDO',status:'EM_TRANSITO',horaSaida:'2026-08-14T06:00:00.000Z'}]]);
  const recebimentosNegados={
    get: async()=>({ size:registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data,exists:true})) }),
    doc:(id)=>({
      id,
      get: async()=>({ exists:registro.has(id), id, data:()=>registro.get(id) }),
      set: async()=>{ const erro=new Error('Missing or insufficient permissions.'); erro.code='permission-denied'; throw erro; },
      update: async()=>{ const erro=new Error('Missing or insufficient permissions.'); erro.code='permission-denied'; throw erro; },
    }),
    _registro: registro,
  };
  const { ctx, toasts }=loadRecebimento({ recebimentos:recebimentosNegados, recebimento_auditoria:mockColecao([]) });
  await ctx.carregarRecebimentoColetor();

  await ctx.voltarEtapaRecebimento('r1');
  assert.equal(registro.get('r1').status,'EM_TRANSITO'); // não mudou
  const ultimoToast=toasts[toasts.length-1];
  assert.match(ultimoToast.msg,/permissão.*corrigir horário|corrigir horário.*permissão/i);
});

test('REGRESSÃO/FASE 4d: Filial enxerga um transbordo criado pela Matriz (loja parceira configurada) e continua a MESMA carga bipando o código do motorista — sem duplicar',async()=>{
  // Matriz (loja_matriz) já criou e despachou o transbordo — o doc mora só
  // na coleção DELA (bug ao vivo relatado: a Filial não achava porque cada
  // loja tinha sua própria coleção isolada). A Filial (loja ativa neste
  // teste) tem loja_matriz configurada como parceira.
  const recebimentosMatriz=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',motoristaId:'mo1',motoristaNome:'Carlos Silva',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-1'}}]);
  const auditoriaMatriz=mockColecao([]);
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123'}}]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentosFilial=mockColecao([]); // Filial não tem nada próprio ainda
  const { ctx, els, telas }=loadRecebimento(
    { recebimentos:recebimentosFilial, recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimento_auditoria:mockColecao([]), recebimento_identificadores:mockColecao([]) },
    { lojaId:'loja_filial', lojaNome:'Filial Centro', lojasParceiras:{ loja_matriz:{ recebimentos:recebimentosMatriz, recebimento_auditoria:auditoriaMatriz } } }
  );
  await ctx.carregarRecebimentoColetor();

  els['rec-scan-input'].value='mot-abc123';
  await ctx.confirmarCodigoRecebimento();

  assert.equal(recebimentosFilial._registro.size,0); // NÃO criou um novo transbordo na Filial
  assert.ok(telas.includes('recebimento-nf')); // reconheceu a carga da Matriz e foi direto pra confirmar a chegada (NF)

  preencherNf(ctx.document,0,'NF-1'); // confere com a NF registrada na saída
  await ctx.confirmarNotaFiscalRecebimento();

  // a escrita da chegada foi pro doc da MATRIZ (onde ele mora de verdade), não pra Filial
  assert.equal(recebimentosMatriz._registro.get('t1').status,'CHEGOU');
  assert.equal(recebimentosFilial._registro.size,0);
  assert.equal(auditoriaMatriz._registro.size,1); // auditoria também fica junto do dono do registro
  assert.equal([...auditoriaMatriz._registro.values()][0].operacao,'CHEGADA_REGISTRADA');
});

test('REGRESSÃO/FASE 4d: depois que a Matriz despacha (bipa a saída), a carga some da lista "em andamento" DELA — não é mais sua responsabilidade, e o botão "Voltar etapa" some junto (bug ao vivo: continuava aparecendo pra reverter mesmo sem nada a fazer ali)',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123'}}]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentos=mockColecao([]);
  const { ctx, els }=loadRecebimento(
    { recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimentos, recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_matriz', lojaNome:'Loja Matriz' }
  );
  await ctx.carregarRecebimentoColetor();

  els['rec-scan-input'].value='MOT-ABC123';
  await ctx.confirmarCodigoRecebimento(); // cria PREVISTO — ainda é da Matriz, precisa despachar
  const id=[...recebimentos._registro.keys()][0];
  assert.ok(ctx._cargasEmAndamento().some(r=>r._id===id)); // aparece: falta bipar a saída

  preencherNf(ctx.document,0,'NF-777',4);
  await ctx.confirmarNotaFiscalRecebimento(); // bip de saída — vira EM_TRANSITO
  assert.equal(recebimentos._registro.get(id).status,'EM_TRANSITO');

  await ctx.carregarRecebimentoColetor(true);
  assert.ok(!ctx._cargasEmAndamento().some(r=>r._id===id)); // sumiu da Matriz — já despachou, agora é problema da Filial
});

test('CORREÇÃO ESTRUTURAL (Camada 2/3 — bypass direto por ID): a Matriz não consegue mais abrir/agir numa carga já EM_TRANSITO mesmo tocando um card que ainda estava em cache — antes disso só a LISTA escondia o card, mas abrirConfirmacaoParaRecebimento não validava posse',async()=>{
  const recebimentos=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',motoristaNome:'Carlos',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-1'}}]);
  const { ctx, toasts }=loadRecebimento(
    { recebimentos, recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:mockColecao([]), recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_matriz', lojaNome:'Loja Matriz' }
  );
  await ctx.carregarRecebimentoColetor();

  await ctx.abrirConfirmacaoParaRecebimento('t1');
  assert.equal(recebimentos._registro.get('t1').status,'EM_TRANSITO'); // nada mudou — a ação foi recusada
  assert.ok(toasts.some(t=>/não pode mais ser operada/.test(t.msg)));
});

test('CORREÇÃO ESTRUTURAL (Camada 2/3): "Voltar etapa" também recusa se a carga já não é mais desta loja',async()=>{
  const recebimentos=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'CHEGOU',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',motoristaNome:'Carlos',horaSaida:'2026-08-14T06:00:00.000Z',horaChegada:'2026-08-14T07:00:00.000Z'}}]);
  const { ctx, toasts }=loadRecebimento(
    { recebimentos, recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:mockColecao([]), recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_matriz', lojaNome:'Loja Matriz' } // Matriz é a ORIGEM — CHEGOU já é turno da Filial
  );
  await ctx.carregarRecebimentoColetor();

  await ctx.voltarEtapaRecebimento('t1');
  assert.equal(recebimentos._registro.get('t1').status,'CHEGOU'); // nada mudou
  assert.ok(toasts.some(t=>/não pertence mais a esta loja/.test(t.msg)));
});

test('CORREÇÃO ESTRUTURAL (Camada 3 — revalidação contra o servidor antes de escrever): se a posse mudou no servidor entre abrir a carga e confirmar o bip (ex.: tela de NF), a escrita é recusada mesmo com um `r` em cache desatualizado',async()=>{
  // Simula exatamente a janela de corrida: o card foi aberto quando ainda
  // era EM_TRANSITO (turno da Filial mesmo, ok pra ela agir) — mas ANTES do
  // bip ser de fato aplicado, o servidor já avançou pra CHEGOU (por outro
  // aparelho/sincronização) — nesse ponto intermediário, seria também
  // ainda turno da Filial (CHEGOU é destino), então pra testar a
  // revalidação de verdade simulamos a Matriz (origem) tentando aplicar um
  // bip nessa carga que, no cache dela, ainda parecia PREVISTO (turno
  // dela), mas no servidor já foi despachada por outro caminho.
  const recebimentos=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',motoristaNome:'Carlos',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-1'}}]);
  const { ctx }=loadRecebimento(
    { recebimentos, recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:mockColecao([]), recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_matriz', lojaNome:'Loja Matriz' }
  );
  // `r` desatualizado — como se tivesse sido lido ANTES do despacho (ainda
  // PREVISTO, turno da própria Matriz), mas o servidor (mock `recebimentos`
  // acima) já está em EM_TRANSITO de verdade.
  const rDesatualizado={ _id:'t1', _lojaId:'loja_matriz', tipo:'TRANSBORDO', status:'PREVISTO', origemLojaId:'loja_matriz', destinoLojaId:'loja_filial', motoristaNome:'Carlos' };
  await assert.rejects(
    ctx._aplicarBipRecebimento(rDesatualizado,'TRANSBORDO_SAIU',{status:'EM_TRANSITO',horaSaida:'2026-08-14T06:05:00.000Z'},'Saída registrada',{silencioso:true}),
    (e)=>e.code==='posse-invalida'
  );
  // o status real no servidor não foi sobrescrito pela escrita indevida
  assert.equal(recebimentos._registro.get('t1').horaSaida,'2026-08-14T06:00:00.000Z');
});

test('REGRESSÃO/FASE 4d: a mesma carga desaparecida da Matriz aparece na lista "em andamento" da Filial assim que ela é despachada (loja parceira configurada nos dois sentidos)',async()=>{
  const recebimentosMatriz=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',motoristaId:'mo1',motoristaNome:'Carlos Silva',destinoLojaId:'loja_filial',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-777'}}]);
  const rotasFilial=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const { ctx }=loadRecebimento(
    { recebimentos:mockColecao([]), recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:rotasFilial, recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_filial', lojaNome:'Filial Centro', lojasParceiras:{ loja_matriz:{ recebimentos:recebimentosMatriz, recebimento_auditoria:mockColecao([]) } } }
  );
  await ctx.carregarRecebimentoColetor();

  const cargas=ctx._cargasEmAndamento();
  assert.equal(cargas.length,1);
  assert.equal(cargas[0]._id,'t1');
  assert.equal(cargas[0].status,'EM_TRANSITO');
});

test('REGRESSÃO/FASE 4h: loja com MAIS DE UMA rota de entrada (duas origens apontando pra ela) cruza a leitura com TODAS elas — enxerga cargas despachadas por qualquer uma das origens',async()=>{
  const recebimentosMatriz=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',motoristaId:'mo1',motoristaNome:'Carlos',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-1'}}]);
  const recebimentosNorte=mockColecao([{id:'t2',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',motoristaId:'mo2',motoristaNome:'Ana',horaSaida:'2026-08-14T07:00:00.000Z',notaFiscalTransferencia:'NF-2'}}]);
  const rotas=mockColecao([
    {id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}},
    {id:'rt2',data:{origemLojaId:'loja_norte',origemNome:'Filial Norte',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}},
  ]);
  const { ctx }=loadRecebimento(
    { recebimentos:mockColecao([]), recebimento_motoristas:mockColecao([]), recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_filial', lojaNome:'Filial Centro', lojasParceiras:{ loja_matriz:{ recebimentos:recebimentosMatriz, recebimento_auditoria:mockColecao([]) }, loja_norte:{ recebimentos:recebimentosNorte, recebimento_auditoria:mockColecao([]) } } }
  );
  await ctx.carregarRecebimentoColetor();

  const cargas=ctx._cargasEmAndamento();
  assert.equal(cargas.length,2);
  assert.ok(cargas.some(r=>r._id==='t1'));
  assert.ok(cargas.some(r=>r._id==='t2'));
});

test('REGRESSÃO/FASE 4h: com MAIS DE UMA rota de saída (duas rotas partindo desta loja), bipar um motorista sem carga ativa pergunta pra qual loja vai a viagem antes de criar — não escolhe sozinho',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123'}}]);
  const rotas=mockColecao([
    {id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}},
    {id:'rt2',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_norte',destinoNome:'Filial Norte'}},
  ]);
  const recebimentos=mockColecao([]);
  const { ctx, els, telas }=loadRecebimento(
    { recebimento_motoristas:motoristas, recebimento_veiculos:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimentos, recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_matriz', lojaNome:'Loja Matriz' }
  );
  await ctx.carregarRecebimentoColetor();

  els['rec-scan-input'].value='MOT-ABC123';
  await ctx.confirmarCodigoRecebimento();

  assert.equal(recebimentos._registro.size,0); // ainda não criou nada — falta escolher o destino
  assert.ok(telas.includes('recebimento-destino'));
  const html=els['rec-destino-lista'].innerHTML;
  assert.match(html,/Filial Centro/);
  assert.match(html,/Filial Norte/);
  assert.match(html,/data-destino-id="loja_filial"/);
  assert.match(html,/data-destino-id="loja_norte"/);

  // simula o toque na opção "Filial Norte" (chama o handler interno
  // diretamente, reproduzindo o mesmo caminho de código que o clique real dispara)
  await ctx._confirmarEscolhaDestino({ id:'loja_norte', nome:'Filial Norte' });

  assert.equal(recebimentos._registro.size,1);
  const novo=[...recebimentos._registro.values()][0];
  assert.equal(novo.destino,'Filial Norte');
  assert.equal(novo.destinoLojaId,'loja_norte');
  assert.ok(telas.includes('recebimento-nf')); // depois de escolher, segue pro fluxo normal de NF da saída
});

test('REGRESSÃO/FASE 4d: bipar o MESMO motorista de novo na Matriz depois de já ter despachado a carga anterior (EM_TRANSITO) cria uma carga NOVA — não reabre a antiga pedindo a NF dela de novo (bug ao vivo: "gerando outro B.O., pede a confirmação da nota da outra que já não tem mais nada a ver")',async()=>{
  const motoristas=mockColecao([{id:'mo1',data:{nome:'Carlos Silva',codigo:'MOT-ABC123'}}]);
  const veiculos=mockColecao([]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentos=mockColecao([]);
  const { ctx, els }=loadRecebimento(
    { recebimento_motoristas:motoristas, recebimento_veiculos:veiculos, recebimento_rotas_transbordo:rotas, recebimentos, recebimento_identificadores:mockColecao([]), recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_matriz', lojaNome:'Loja Matriz' }
  );
  await ctx.carregarRecebimentoColetor();

  // 1ª carga: cria e despacha (vira EM_TRANSITO — já não é mais "minha vez")
  els['rec-scan-input'].value='MOT-ABC123';
  await ctx.confirmarCodigoRecebimento();
  preencherNf(ctx.document,0,'NF-AAA',2);
  await ctx.confirmarNotaFiscalRecebimento();
  assert.equal(recebimentos._registro.size,1);
  const idPrimeira=[...recebimentos._registro.keys()][0];
  assert.equal(recebimentos._registro.get(idPrimeira).status,'EM_TRANSITO');

  await ctx.carregarRecebimentoColetor(true); // recarrega, como aconteceria entre uma carga e outra

  // 2ª carga: bipa o MESMO motorista de novo — tem que criar uma carga NOVA,
  // não reabrir a NF da primeira (que já não tem mais nada a ver com a Matriz)
  els['rec-scan-input'].value='MOT-ABC123';
  await ctx.confirmarCodigoRecebimento();
  assert.match(els['rec-nf-titulo'].textContent,/Saída/); // é a tela de NF da SAÍDA (nova carga), não "Confirme a Nota Fiscal" (chegada)
  assert.equal(recebimentos._registro.size,2); // criou a 2ª, não reaproveitou a 1ª

  preencherNf(ctx.document,0,'NF-BBB',2);
  await ctx.confirmarNotaFiscalRecebimento();
  const idSegunda=[...recebimentos._registro.keys()].find(id=>id!==idPrimeira);
  assert.equal(recebimentos._registro.get(idSegunda).notaFiscalTransferencia,'NF-BBB');
  assert.equal(recebimentos._registro.get(idPrimeira).notaFiscalTransferencia,'NF-AAA'); // a 1ª carga não foi tocada
});

test('sem loja parceira configurada (fluxo antigo de trip-QR ou destino sem loja de verdade): carga continua visível em TODAS as etapas na mesma loja, como sempre — não regride quem não usa loja parceira',async()=>{
  const recebimentos=mockColecao([{id:'r1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',destinoLojaId:null}}]);
  const { ctx }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) });
  await ctx.carregarRecebimentoColetor();
  assert.ok(ctx._cargasEmAndamento().some(r=>r._id==='r1'));
});

test('REGRESSÃO (auditoria pedida ao vivo: "verifica se o coletor separa realmente a loja quando você seleciona"): trocar de loja (evento dt-loja-alterada) limpa os caches de recebimento — sem isso, dado de uma loja podia ficar em memória e vazar pra outra até a próxima leitura completa',async()=>{
  const recebimentosLoja1=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO'}}]);
  const { ctx }=loadRecebimento({ recebimentos:recebimentosLoja1, recebimento_motoristas:mockColecao([{id:'mo1',data:{nome:'Carlos'}}]), recebimento_auditoria:mockColecao([]) });
  await ctx.carregarRecebimentoColetor();
  assert.ok(ctx._cargasEmAndamento().some(r=>r._id==='t1')); // cache populado com dado da loja 1

  ctx.dispatchEvent(new ctx.Event('dt-loja-alterada'));

  assert.equal(ctx._cargasEmAndamento().length,0); // limpou na hora, não espera a próxima tela/leitura
});

test('REGRESSÃO: depois do dt-loja-alterada, o nome da loja usado como "origem" de um transbordo novo é re-consultado — não fica preso ao nome da loja anterior (_lojaNomeCache também é limpo)',async()=>{
  const { ctx }=loadRecebimento({ recebimento_auditoria:mockColecao([]) },{ lojaId:'loja1', lojaNome:'Loja Matriz' });
  const nome1=await ctx._obterNomeLojaAtiva();
  assert.equal(nome1,'Loja Matriz'); // cacheado agora

  ctx.getDTLojaAtiva=()=>'loja2'; // simula ter trocado de loja
  const nomeAindaCacheado=await ctx._obterNomeLojaAtiva();
  assert.equal(nomeAindaCacheado,'Loja Matriz'); // sem o evento, o cache antigo (correto) ainda prende o valor errado

  ctx.dispatchEvent(new ctx.Event('dt-loja-alterada'));
  // troca o mock de "lojas" pra já refletir a loja2 sendo consultada de verdade
  const lojas2=mockColecao([{id:'loja2',data:{nome:'Filial Centro'}}]);
  ctx.getDTRawFirestore=()=>({ collection:(nome)=> nome==='lojas' ? lojas2 : mockColecao([]) });
  const nomeAposTroca=await ctx._obterNomeLojaAtiva();
  assert.equal(nomeAposTroca,'Filial Centro'); // recalculou, não ficou preso à Matriz
});

test('REGRESSÃO/FASE 4i: 3 abas do hub (pedido ao vivo: "Em trânsito, Em andamento e recebidas") — cada aba respeita de quem é a vez, igual ao resto do fluxo',async()=>{
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const recebimentosMatriz=mockColecao([
    {id:'p1',data:{tipo:'TRANSBORDO',status:'PREVISTO',destinoLojaId:'loja_filial',criadoEm:'2026-08-14T05:00:00.000Z'}}, // falta despachar — Matriz ainda vê
    {id:'f1',data:{tipo:'TRANSBORDO',status:'FINALIZADO',destinoLojaId:'loja_filial',horaFechamentoRecebimento:'2026-08-14T09:00:00.000Z'}}, // finalizada em outro lugar — Matriz não é quem recebeu
  ]);
  const { ctx }=loadRecebimento(
    { recebimentos:recebimentosMatriz, recebimento_rotas_transbordo:rotas, recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_matriz', lojaNome:'Loja Matriz' }
  );
  await ctx.carregarRecebimentoColetor();

  assert.deepEqual(ctx._cargasPorAba('transito').map(r=>r._id),['p1']); // PREVISTO ainda é dela
  assert.deepEqual(ctx._cargasPorAba('andamento').map(r=>r._id),[]); // nada chegou nela pra processar
  assert.deepEqual(ctx._cargasPorAba('recebidas').map(r=>r._id),[]); // quem recebeu foi a Filial, não ela
});

test('REGRESSÃO/FASE 4i: na Filial, a mesma carga (despachada pela Matriz) passa pelas 3 abas na ordem certa conforme avança — nunca em duas ao mesmo tempo',async()=>{
  // t1 mora na coleção da MATRIZ (quem criou/despachou) — a Filial só a
  // enxerga via cruzamento cross-loja, exatamente como acontece de verdade.
  const recebimentosMatriz=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'EM_TRANSITO',destinoLojaId:'loja_filial',motoristaNome:'Carlos',horaSaida:'2026-08-14T06:00:00.000Z',notaFiscalTransferencia:'NF-1'}}]);
  const auditoriaMatriz=mockColecao([]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const { ctx, els }=loadRecebimento(
    { recebimentos:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_filial', lojaNome:'Filial Centro', lojasParceiras:{ loja_matriz:{ recebimentos:recebimentosMatriz, recebimento_auditoria:auditoriaMatriz } } }
  );
  await ctx.carregarRecebimentoColetor();

  assert.deepEqual(ctx._cargasPorAba('transito').map(r=>r._id),['t1']); // a caminho — Em Trânsito
  assert.deepEqual(ctx._cargasPorAba('andamento').map(r=>r._id),[]);
  assert.deepEqual(ctx._cargasPorAba('recebidas').map(r=>r._id),[]);

  await ctx.abrirConfirmacaoParaRecebimento('t1');
  preencherNf(ctx.document,0,'NF-1');
  await ctx.confirmarNotaFiscalRecebimento(); // CHEGOU
  await ctx.carregarRecebimentoColetor(true);

  assert.deepEqual(ctx._cargasPorAba('transito').map(r=>r._id),[]); // saiu de Em Trânsito
  assert.deepEqual(ctx._cargasPorAba('andamento').map(r=>r._id),['t1']); // entrou em Em Andamento
  assert.deepEqual(ctx._cargasPorAba('recebidas').map(r=>r._id),[]);
});

test('PEDIDO AO VIVO: aba "Transbordos" (só-leitura, filtrada por data de geração) mostra na ORIGEM tudo que ela gerou naquele dia, mesmo já não sendo mais dela — não fica escondido só porque já é turno do destino',async()=>{
  const recebimentos=mockColecao([
    {id:'p1',data:{tipo:'TRANSBORDO',status:'PREVISTO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',identificadorCodigo:'TRB-P1',criadoEm:'2026-08-14T05:00:00.000Z'}},
    {id:'f1',data:{tipo:'TRANSBORDO',status:'FINALIZADO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',identificadorCodigo:'TRB-F1',criadoEm:'2026-08-14T06:00:00.000Z',horaFechamentoRecebimento:'2026-08-14T09:00:00.000Z',notaFiscalTransferencia:'NF-777'}}, // já não é mais dela — mesmo assim aparece aqui
    {id:'outro-dia',data:{tipo:'TRANSBORDO',status:'FINALIZADO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',identificadorCodigo:'TRB-ONTEM',criadoEm:'2026-08-13T06:00:00.000Z'}}, // dia diferente — não pode somar junto
  ]);
  const { ctx, els }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) },{ lojaId:'loja_matriz', lojaNome:'Loja Matriz' });
  await ctx.carregarRecebimentoColetor();

  assert.deepEqual(ctx._cargasGeradasPorMim('2026-08-14').map(r=>r._id).sort(),['f1','p1']);
  assert.deepEqual(ctx._cargasGeradasPorMim('2026-08-13').map(r=>r._id),['outro-dia']);

  // _selecionarDataGerados virou _selecionarDataAbaAtiva (genérico pras 2
  // abas com filtro de data) — só tem efeito com a aba certa já ativa.
  ctx._selecionarAbaRecebimento('gerados');
  ctx._selecionarDataAbaAtiva('2026-08-14');
  assert.match(els['rec-lista-andamento'].innerHTML,/TRB-P1/);
  assert.match(els['rec-lista-andamento'].innerHTML,/TRB-F1/);
  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/TRB-ONTEM/); // dia errado, não aparece
  assert.match(els['rec-lista-andamento'].innerHTML,/NF: NF-777/); // pedido ao vivo: mostrar a nota fiscal também
  assert.match(els['rec-lista-andamento'].innerHTML,/NF: —/); // p1 ainda não tem NF (nem saiu)
});

test('PEDIDO AO VIVO: aba "Transbordos" é somente-leitura — os cards não têm data-recid nem botão "Voltar etapa", então o clique-delegado normal nunca consegue abrir/agir neles',async()=>{
  const recebimentos=mockColecao([
    {id:'f1',data:{tipo:'TRANSBORDO',status:'FINALIZADO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',identificadorCodigo:'TRB-F1',criadoEm:'2026-08-14T06:00:00.000Z'}},
  ]);
  const { ctx, els }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) },{ lojaId:'loja_matriz', lojaNome:'Loja Matriz' });
  await ctx.carregarRecebimentoColetor();
  ctx._selecionarAbaRecebimento('gerados');
  ctx._selecionarDataAbaAtiva('2026-08-14');

  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/data-recid=/);
  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/data-recid-voltar=/);
  assert.match(els['rec-lista-andamento'].innerHTML,/Finalizado/i); // status continua visível
});

test('PEDIDO AO VIVO: aba "Transbordos" só mostra o que ESTA loja gerou como origem — não soma o que ela recebeu como destino (isso já é "Recebidas")',async()=>{
  // t1 mora na coleção da MATRIZ (quem criou) — a Filial só a enxerga via
  // cruzamento cross-loja, igual ao resto do fluxo.
  const recebimentosMatriz=mockColecao([{id:'t1',data:{tipo:'TRANSBORDO',status:'FINALIZADO',origemLojaId:'loja_matriz',destinoLojaId:'loja_filial',identificadorCodigo:'TRB-1',criadoEm:'2026-08-14T06:00:00.000Z',horaFechamentoRecebimento:'2026-08-14T09:00:00.000Z'}}]);
  const rotas=mockColecao([{id:'rt1',data:{origemLojaId:'loja_matriz',origemNome:'Loja Matriz',destinoLojaId:'loja_filial',destinoNome:'Filial Centro'}}]);
  const { ctx, els }=loadRecebimento(
    { recebimentos:mockColecao([]), recebimento_rotas_transbordo:rotas, recebimento_auditoria:mockColecao([]) },
    { lojaId:'loja_filial', lojaNome:'Filial Centro', lojasParceiras:{ loja_matriz:{ recebimentos:recebimentosMatriz, recebimento_auditoria:mockColecao([]) } } }
  );
  await ctx.carregarRecebimentoColetor();

  // "Recebidas" agora também filtra por data (pedido ao vivo do usuário:
  // "mesma função de data do recebimento pra filtrar") — precisa da aba
  // ativa + a data certa pra t1 (horaFechamentoRecebimento) entrar na conta.
  ctx._selecionarAbaRecebimento('recebidas');
  ctx._selecionarDataAbaAtiva('2026-08-14');
  assert.deepEqual(ctx._cargasPorAba('recebidas').map(r=>r._id),['t1']); // a Filial RECEBEU — aparece em Recebidas

  assert.deepEqual(ctx._cargasGeradasPorMim('2026-08-14'),[]); // mas não GEROU — não aparece em Transbordos
  ctx._selecionarAbaRecebimento('gerados');
  ctx._selecionarDataAbaAtiva('2026-08-14');
  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/TRB-1/);
});

// PEDIDO AO VIVO (usuário: "na parte de notas recebidas tem que ter a mesma
// função de data do recebimento para filtrar, para mostrar só o do dia") —
// "Recebidas" crescia pra sempre, sem filtro nenhum. Ganhou o MESMO filtro
// de data (+ atalhos Hoje/Ontem) que "Transbordos" já tinha, mostrando só o
// dia selecionado por padrão (hoje).
test('PEDIDO AO VIVO: aba "Recebidas" filtra por data (mesma função já usada em "Transbordos") — por padrão mostra só HOJE, e o atalho "Ontem" volta um dia',async()=>{
  const hoje=new Date().toLocaleDateString('en-CA');
  const recebimentos=mockColecao([
    {id:'r-hoje',data:{tipo:'TRANSBORDO',status:'FINALIZADO',destinoLojaId:'loja_filial',identificadorCodigo:'TRB-HOJE',horaFechamentoRecebimento:hoje+'T09:00:00.000Z'}},
    {id:'r-14ago',data:{tipo:'TRANSBORDO',status:'FINALIZADO',destinoLojaId:'loja_filial',identificadorCodigo:'TRB-14AGO',horaFechamentoRecebimento:'2026-08-14T09:00:00.000Z'}},
  ]);
  const { ctx, els }=loadRecebimento({ recebimentos, recebimento_auditoria:mockColecao([]) },{ lojaId:'loja_filial', lojaNome:'Filial Centro' });
  await ctx.carregarRecebimentoColetor();

  // padrão (sem mexer em nada) já filtra por HOJE — a de 14/08 não aparece.
  ctx._selecionarAbaRecebimento('recebidas');
  assert.deepEqual(ctx._cargasPorAba('recebidas').map(r=>r._id),['r-hoje']);
  assert.match(els['rec-lista-andamento'].innerHTML,/TRB-HOJE/);
  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/TRB-14AGO/);

  // o mesmo seletor de data (compartilhado com "Transbordos") aparece pra
  // esta aba também.
  assert.notEqual(els['rec-gerados-data'].style.display,'none');
  assert.equal(els['rec-gerados-atalhos'].style.display,'flex');

  // escolher a data de 14/08 na tela troca o que aparece.
  ctx._selecionarDataAbaAtiva('2026-08-14');
  assert.deepEqual(ctx._cargasPorAba('recebidas').map(r=>r._id),['r-14ago']);
  assert.match(els['rec-lista-andamento'].innerHTML,/TRB-14AGO/);
  assert.doesNotMatch(els['rec-lista-andamento'].innerHTML,/TRB-HOJE/);

  // atalho "Ontem" some com o filtro de novo — a partir de 14/08 vira 13/08 (sem carga nenhuma).
  ctx._selecionarDataAbaAtivaOntem();
  assert.deepEqual(ctx._cargasPorAba('recebidas'),[]);

  // atalho "Hoje" volta pro dia de hoje.
  ctx._selecionarDataAbaAtivaHoje();
  assert.deepEqual(ctx._cargasPorAba('recebidas').map(r=>r._id),['r-hoje']);
});

test('PEDIDO AO VIVO: trocar de aba pra fora de "Recebidas"/"Transbordos" esconde o filtro de data (só faz sentido pras 2 abas de histórico)',async()=>{
  const { ctx, els }=loadRecebimento({ recebimento_auditoria:mockColecao([]) },{ lojaId:'loja_filial', lojaNome:'Filial Centro' });
  await ctx.carregarRecebimentoColetor();
  ctx._selecionarAbaRecebimento('recebidas');
  assert.notEqual(els['rec-gerados-data'].style.display,'none');
  ctx._selecionarAbaRecebimento('transito');
  assert.equal(els['rec-gerados-data'].style.display,'none');
  assert.equal(els['rec-gerados-atalhos'].style.display,'none');
});

test('roteamento: coletor.html tem as 4 telas da fase 4 e os 3 pontos de login vão pra screen-acesso, não direto pra screen-mode',()=>{
  assert.match(htmlCode,/id="screen-acesso"/);
  assert.match(htmlCode,/id="screen-recebimento"/);
  assert.match(htmlCode,/id="screen-recebimento-scan"/);
  assert.match(htmlCode,/id="screen-recebimento-confirmacao"/);
  assert.match(htmlCode,/id="screen-recebimento-nf"/);
  assert.match(htmlCode,/id="screen-recebimento-destino"/);
  assert.match(htmlCode,/id="rec-abas"/);
  assert.match(htmlCode,/22-recebimento\.js/);
  const chamadasAcesso=[...authCode.matchAll(/goScreen\('acesso'\)/g)];
  assert.equal(chamadasAcesso.length,2); // doLogin() e doCriarConta()
  const chamadasMode=[...authCode.matchAll(/goScreen\('mode'\)/g)];
  assert.equal(chamadasMode.length,1); // só trocarLojaColetor(), que continua igual de propósito
});

test('scanner de hardware: Enter em rec-scan-input confirma o código; num campo de NF (qualquer linha, [data-nf-input]) ADICIONA a nota à lista (pedido ao vivo: dá pra bipar mais de uma NF em sequência antes de confirmar)',()=>{
  assert.match(scannerCode,/rec-scan-input.*confirmarCodigoRecebimento/);
  assert.match(scannerCode,/\[data-nf-input\].*adicionarNotaFiscalRecebimento/);
});

test('REGRESSÃO: menu de três pontinhos e "Trocar loja" ficam na parte superior (top-bar) das telas iniciais de cada etapa (pedido ao vivo do usuário) — Acesso, Modo e Recebimento',()=>{
  ['acesso','mode','recebimento','recebimento-modo'].forEach(tela=>{
    assert.match(htmlCode,new RegExp('id="btn-menu3pts-'+tela+'"'),'menu de 3 pontinhos falta em '+tela);
    const inicio=htmlCode.indexOf('id="menu3pts-dropdown-'+tela+'"');
    assert.ok(inicio>=0,'dropdown de '+tela+' não encontrado');
    const trecho=htmlCode.slice(inicio,inicio+900); // janela generosa — o dropdown inteiro cabe bem antes disso
    assert.match(trecho,/trocarLojaColetor\(event\)/,'🏬 Trocar loja falta dentro do dropdown de '+tela);
  });
  // botão fixo antigo (só existia dentro do card da tela de Modo) não existe
  // mais — a ação virou item de menu, reaproveitável em qualquer tela
  assert.doesNotMatch(htmlCode,/id="coletor-trocar-loja"/);
});
