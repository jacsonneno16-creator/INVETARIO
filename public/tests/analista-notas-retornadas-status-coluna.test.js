// PEDIDO AO VIVO (2026-09-08): "e colocar mais uma coluna de status, onde
// eu consiga adiantar quais vao ser os status que vai aparecer lá, tipo o
// tratamento é recusa, o status aguard. fiscal" — Notas Retornadas ganha
// uma coluna "Status do retorno" pra classificar Tratamento E já adiantar
// o Status sem sair da tela (mesmo campo por nota que "Status de
// Retornos"/99-recebimento-retornos-status.js já usa — aquela tela
// continua existindo do jeito que está, esta é só um atalho a mais pro
// mesmo dado). Também trava o dropdown de Tratamento em só Recusa/
// Reentrega (as opções antigas continuam sendo EXIBIDAS certas em
// registros já classificados assim, só não dá mais pra ESCOLHER de novo).
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const recusasCode=fs.readFileSync(path.join(base,'97-recebimento-recusas.js'),'utf8');
const statusCode=fs.readFileSync(path.join(base,'99-recebimento-retornos-status.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return {
    get: async()=>({ empty: registro.size===0, size: registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    doc:(id)=>({
      id,
      set: async(payload)=>{ const a=registro.get(id)||{}; registro.set(id,{...a,...payload}); },
      update: async(payload)=>{ const a=registro.get(id); if(a===undefined) throw new Error('NOT_FOUND'); registro.set(id,{...a,...payload}); },
    }),
    _registro: registro,
  };
}
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });
function _comColecaoNoDoc(colecao, nome){
  const docOriginal = colecao.doc;
  colecao.doc = (id) => ({ ...docOriginal(id), _colecao: nome });
  return colecao;
}
function mockRawFirestore(colecoes){
  return { batch:()=>{
    const ops=[];
    return {
      set:(ref,payload,opts)=>ops.push({ref,payload,merge:!!opts?.merge}),
      delete:(ref)=>ops.push({ref,excluir:true}),
      commit: async()=>{ ops.forEach(op=>{
        const col=colecoes[op.ref._colecao];
        if(!col)return;
        if(op.excluir){ col._registro.delete(op.ref.id); return; }
        const atual=col._registro.get(op.ref.id)||{};
        col._registro.set(op.ref.id, op.merge?{...atual,...op.payload}:op.payload);
      }); },
    };
  } };
}
function carregarPagina(colecoesEntrada){
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  const colecoes={...(colecoesEntrada||{})};
  if(!colecoes.recebimento_recusas_notas_chunks) colecoes.recebimento_recusas_notas_chunks=mockColecao([]);
  Object.keys(colecoes).forEach(nome=>_comColecaoNoDoc(colecoes[nome],nome));
  win.getDTFirestore=()=>({ collection:(nome)=>{ if(!colecoes[nome]) colecoes[nome]=_comColecaoNoDoc(mockColecao([]),nome); return colecoes[nome]; } });
  win.getDTRawFirestore=()=>mockRawFirestore(colecoes);
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }) };
  win.showToast=()=>{};
  win.aplicarPermissoesAnalista=()=>{};
  win.openModal=()=>{};
  win.closeModal=()=>{};
  win.eval(statusCode); // dono de STATUS_RETORNO_LABELS, que 97 reaproveita
  win.eval(recusasCode);
  _janelasAbertas.push(win);
  return { win, document };
}
function baseColecoes(recusas,notas){
  return {
    recebimento_recusas: recusas, recebimento_recusas_notas: notas || mockColecao([]),
    recebimento_recusas_motoristas: mockColecao([]), recebimento_recusas_motivos: mockColecao([]),
  };
}

test('dropdown de Tratamento só oferece Recusa e Reentrega (mais o vazio) — não Devolução/Substituição/Pendente/Outro', async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 1',notas:[{chave:'CH1'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  const select=document.querySelector('[data-recusa-tratamento="r1|CH1"]');
  const valores=[...select.options].map(o=>o.value);
  assert.deepEqual(valores,['','RECUSA','REENTREGA']);
});

test('registro antigo classificado como Devolução continua mostrando "Devolução" no select (não fica em branco), mesmo sem poder escolher de novo', async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 1',notas:[{chave:'CH1',tratamento:'DEVOLUCAO'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  const select=document.querySelector('[data-recusa-tratamento="r1|CH1"]');
  assert.equal(select.value,'DEVOLUCAO');
  assert.match(select.outerHTML,/Devolução/);
});

test('nota ainda não classificada não mostra select nem input de status — só um traço', async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 1',notas:[{chave:'CH1'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  assert.equal(document.querySelector('[data-recusa-status]'),null);
  assert.equal(document.querySelector('[data-recusa-reentrega-data]'),null);
});

test('classificar como Recusa faz aparecer o select de Status (Aguard. Fiscal/CTE/Endereçando/Finalizado) na mesma linha, e mudar o status grava na nota', async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 1',notas:[{chave:'CH1'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();

  document.querySelector('[data-recusa-tratamento="r1|CH1"]').value='RECUSA';
  document.querySelector('[data-recusa-tratamento="r1|CH1"]').dispatchEvent(new win.Event('change'));
  await new Promise(r=>setTimeout(r,0));

  const selectStatus=document.querySelector('[data-recusa-status="r1|CH1"]');
  assert.ok(selectStatus,'select de status precisa aparecer assim que Tratamento vira Recusa');
  const rotulos=[...selectStatus.options].map(o=>o.textContent);
  assert.ok(rotulos.includes('Aguard. Fiscal') && rotulos.includes('CTE') && rotulos.includes('Endereçando') && rotulos.includes('Finalizado'));

  selectStatus.value='AGUARD_FISCAL';
  selectStatus.dispatchEvent(new win.Event('change'));
  await new Promise(r=>setTimeout(r,0));

  const salvo=recusas._registro.get('r1');
  assert.equal(salvo.notas[0].statusRetorno,'AGUARD_FISCAL');
  assert.ok(salvo.notas[0].dataSolicitacaoFiscalEm,'data nomeada carimbada, mesma regra de Status de Retornos');
});

test('classificar como Reentrega mostra Data Programada/Saída em vez do select de status', async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 1',notas:[{chave:'CH1'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();

  document.querySelector('[data-recusa-tratamento="r1|CH1"]').value='REENTREGA';
  document.querySelector('[data-recusa-tratamento="r1|CH1"]').dispatchEvent(new win.Event('change'));
  await new Promise(r=>setTimeout(r,0));

  assert.equal(document.querySelector('[data-recusa-status="r1|CH1"]'),null,'reentrega não usa o funil de status fiscal/CTE');
  const inputSaida=document.querySelector('[data-recusa-reentrega-data="r1|CH1:dataSaidaEm"]');
  assert.ok(inputSaida);

  inputSaida.value='2026-09-10';
  inputSaida.dispatchEvent(new win.Event('change'));
  await new Promise(r=>setTimeout(r,0));

  const salvo=recusas._registro.get('r1');
  assert.ok(salvo.notas[0].dataSaidaEm);
});

test('2 notas do mesmo evento: uma Recusa (mostra select de status) e outra Reentrega (mostra datas) — cada linha com o controle certo', async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 1',notas:[
    {chave:'CH1',numeroNota:'601',tratamento:'RECUSA'},
    {chave:'CH2',numeroNota:'602',tratamento:'REENTREGA'},
  ]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();

  assert.ok(document.querySelector('[data-recusa-status="r1|CH1"]'),'nota Recusa mostra select de status');
  assert.ok(document.querySelector('[data-recusa-reentrega-data="r1|CH2:dataSaidaEm"]'),'nota Reentrega mostra as datas');
  assert.equal(document.querySelector('[data-recusa-status="r1|CH2"]'),null,'a nota de Reentrega não pode ter o select de status');
});
