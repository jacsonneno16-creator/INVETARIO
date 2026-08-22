// Bug ao vivo real (2026-08-19): "Write stream exhausted maximum allowed
// queued writes" — processarDivergencias() (21-divergencias-recontagens.js)
// fazia uma escrita SOLTA (fire-and-forget, sem lote) por documento de
// dt_contagens, e roda automaticamente a cada mudança relevante do Store
// (scheduleBusinessReprocess, app-controller.js). Um inventário grande com
// muitas contagens mudando de status de uma vez disparava centenas/
// milhares de escritas individuais ao mesmo tempo, estourando a fila de
// escrita do Firestore. Corrigido: _gravarPendentesDtContagensEmLotes()
// agrupa tudo em lotes de até 300 via FS_AN.batch(). Este teste isola só
// essa função (exposta em global._divergenciasInternals) — não precisa
// montar o state()/mock inteiro de processarDivergencias() pra confirmar
// que a gravação em si é batelada, não individual.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const divergenciasCode=fs.readFileSync(path.join(base,'21-divergencias-recontagens.js'),'utf8');

function mockFirestore(){
  const registro=new Map();
  let chamadasBatch=0;
  let maiorLoteSet=0;
  return {
    fs:{
      collection:(nome)=>({
        doc:(id)=>({ id, _nome:nome }),
      }),
      batch:()=>{
        chamadasBatch++;
        let nDesteLote=0;
        const pendentes=[];
        return {
          set:(ref,payload,opts)=>{
            nDesteLote++;
            if(nDesteLote>maiorLoteSet) maiorLoteSet=nDesteLote;
            pendentes.push(()=>{ registro.set(ref._nome+'/'+ref.id, {...(registro.get(ref._nome+'/'+ref.id)||{}), ...payload}); });
          },
          commit: async()=>{ pendentes.forEach(fn=>fn()); },
        };
      },
    },
    registro,
    contarChamadasBatch:()=>chamadasBatch,
    maiorLote:()=>maiorLoteSet,
  };
}

function carregarModulo(fsMock){
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window;
  // Dependências exigidas só pra o arquivo carregar sem estourar no topo
  // do IIFE (const MAX_CONTAGENS = DivSvc.MAX_CONTAGENS) — o teste não usa
  // processarDivergencias() nem precisa de um Store real.
  win.AnalistaStore={ getState:()=>({}) };
  win.AnalistaActions={};
  win.AnalistaDivergenciaService={ MAX_CONTAGENS:999 };
  win.FS_AN=fsMock.fs;
  win.eval(divergenciasCode);
  return win;
}

test('_gravarPendentesDtContagensEmLotes usa FS_AN.batch() (gravação em lote), não um .set()/.update() solto por documento',async()=>{
  const fsMock=mockFirestore();
  const win=carregarModulo(fsMock);
  const pendentes=[
    { docId:'c1', payload:{ status:'PROCESSADO' } },
    { docId:'c2', payload:{ status:'DIVERGENTE', descricao:'Produto X' } },
  ];
  win._divergenciasInternals._gravarPendentesDtContagensEmLotes(pendentes);
  await new Promise(r=>setTimeout(r,0)); // a gravação é fire-and-forget (IIFE async interna)
  assert.equal(fsMock.contarChamadasBatch(),1,'2 pendentes cabem num lote só');
  assert.equal(fsMock.registro.get('dt_contagens/c1').status,'PROCESSADO');
  assert.equal(fsMock.registro.get('dt_contagens/c2').status,'DIVERGENTE');
  assert.equal(fsMock.registro.get('dt_contagens/c2').descricao,'Produto X');
});

test('REGRESSÃO: com mais de 300 pendentes, divide em múltiplos lotes de até 300 (nunca um lote gigante, nunca uma escrita solta por documento)',async()=>{
  const fsMock=mockFirestore();
  const win=carregarModulo(fsMock);
  const pendentes=Array.from({length:730},(_,i)=>({ docId:'c'+i, payload:{ status:'PROCESSADO' } }));
  win._divergenciasInternals._gravarPendentesDtContagensEmLotes(pendentes);
  await new Promise(r=>setTimeout(r,0));
  assert.equal(fsMock.contarChamadasBatch(),3,'730 pendentes = 3 lotes (300+300+130)');
  assert.ok(fsMock.maiorLote()<=300,'nenhum lote pode passar de 300 (a mesma margem já usada em 90-bluesoft-service.js)');
  assert.equal(fsMock.registro.get('dt_contagens/c0').status,'PROCESSADO');
  assert.equal(fsMock.registro.get('dt_contagens/c729').status,'PROCESSADO');
});

test('lista vazia não chama FS_AN.batch() nenhuma vez (nada pra gravar, nada de rede)',async()=>{
  const fsMock=mockFirestore();
  const win=carregarModulo(fsMock);
  win._divergenciasInternals._gravarPendentesDtContagensEmLotes([]);
  await new Promise(r=>setTimeout(r,0));
  assert.equal(fsMock.contarChamadasBatch(),0);
});

test('falha num lote não impede os lotes seguintes de serem gravados (erro isolado, não propaga)',async()=>{
  const registro=new Map();
  let chamada=0;
  const fs={
    collection:(nome)=>({ doc:(id)=>({id,_nome:nome}) }),
    batch:()=>{
      chamada++;
      const numeroDoLote=chamada;
      const pendentes=[];
      return {
        set:(ref,payload)=>{ pendentes.push(()=>registro.set(ref._nome+'/'+ref.id,payload)); },
        commit: async()=>{ if(numeroDoLote===1) throw new Error('Falha de rede simulada no lote 1'); pendentes.forEach(fn=>fn()); },
      };
    },
  };
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window;
  win.AnalistaStore={ getState:()=>({}) };
  win.AnalistaActions={};
  win.AnalistaDivergenciaService={ MAX_CONTAGENS:999 };
  win.FS_AN=fs;
  win.console={ ...console, error:()=>{} }; // silencia o log esperado do lote que falha
  win.eval(divergenciasCode);
  const pendentes=[
    ...Array.from({length:300},(_,i)=>({ docId:'lote1-'+i, payload:{status:'X'} })),
    { docId:'lote2-0', payload:{ status:'PROCESSADO' } },
  ];
  win._divergenciasInternals._gravarPendentesDtContagensEmLotes(pendentes);
  await new Promise(r=>setTimeout(r,0));
  assert.equal(registro.get('dt_contagens/lote1-0'),undefined,'lote 1 falhou, nada dele foi gravado');
  assert.equal(registro.get('dt_contagens/lote2-0').status,'PROCESSADO','lote 2 grava normalmente mesmo com o lote 1 tendo falhado');
});
