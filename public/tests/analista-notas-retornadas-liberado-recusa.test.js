// PEDIDO AO VIVO (2026-09-03, pt. 3): "a partir do momento que ela foi
// liberada pra recusa... a partir desse dia aí que vai começar a contar a
// média de dias parado" — `liberadoParaRecusarEm` já existia no código
// (99-recebimento-retornos-status.js/DATA_POR_STATUS) mas nunca era
// carimbado de verdade pras notas novas. Confirmado com o usuário
// (AskUserQuestion): o momento certo é quando o Analista classifica
// Tratamento = Recusa, aqui em 97-recebimento-recusas.js/alterarTratamento.
//
// PEDIDO AO VIVO (2026-09-08): "cada nota tem que gerar uma linha... se
// ela tiver junta e uma for reentrega e a outra for recusa" — Tratamento
// (e `liberadoParaRecusarEm`) passou de campo do DOCUMENTO pra campo de
// cada item de `notas[]` — um evento com 2 notas agora pode ter uma
// Recusa e outra Reentrega ao mesmo tempo. `data-recusa-tratamento` virou
// chave composta `${recusaId}|${chaveDaNota}`.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const recusasCode=fs.readFileSync(path.join(base,'97-recebimento-recusas.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return {
    get: async()=>({ empty: registro.size===0, size: registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    where(campo, op, valor) {
      const construir = (condicoesAtuais) => ({
        where: (c2, o2, v2) => construir([...condicoesAtuais, { campo: c2, op: o2, valor: v2 }]),
        onSnapshot: (cb, errCb) => {
          construir(condicoesAtuais).get().then(cb).catch(e => errCb && errCb(e));
          return () => {};
        },
        get: async () => {
          const bate = (data) => condicoesAtuais.every(c => {
            const v = data ? data[c.campo] : undefined;
            if (c.op === '>=') return v >= c.valor;
            if (c.op === '<=') return v <= c.valor;
            if (c.op === '==') return v === c.valor;
            if (c.op === 'array-contains') return Array.isArray(v) && v.includes(c.valor);
            if (c.op === 'in') return Array.isArray(c.valor) && c.valor.includes(v);
            return true;
          });
          const filtrados = [...registro.entries()].filter(([, data]) => bate(data));
          return { empty: filtrados.length === 0, size: filtrados.length, docs: filtrados.map(([id, data]) => ({ id, data: () => data })) };
        },
      });
      return construir([{ campo, op, valor }]);
    },
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
function mudarTratamento(document, win, recusaId, notaChave, valor){
  const select=document.querySelector(`[data-recusa-tratamento="${recusaId}|${notaChave}"]`);
  select.value=valor;
  select.dispatchEvent(new win.Event('change'));
  return new Promise(r=>setTimeout(r,0));
}

test('marcar Tratamento = Recusa carimba liberadoParaRecusarEm na 1ª vez', async()=>{
  const recusas=mockColecao([{id:'r1',data:{criadoEm:'2026-09-01T00:00:00.000Z',box:'BOX 1',origem:'COLETOR',notas:[{chave:'CH1',numeroNota:'1'}],criadoEm:'2026-09-01T10:00:00.000Z'}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  await mudarTratamento(document, win, 'r1', 'CH1', 'RECUSA');
  const salvo=recusas._registro.get('r1');
  assert.equal(salvo.notas[0].tratamento,'RECUSA');
  assert.ok(salvo.notas[0].liberadoParaRecusarEm,'liberadoParaRecusarEm precisa ser gravado ao classificar como Recusa');
  assert.equal(salvo.statusFisico,'NO_PATIO','recém classificada como Recusa, ainda sem FINALIZADO — continua no pátio');
});

test('trocar o tratamento de novo (Recusa -> outro -> Recusa) NÃO sobrescreve liberadoParaRecusarEm já existente', async()=>{
  const recusas=mockColecao([{id:'r1',data:{criadoEm:'2026-09-01T00:00:00.000Z',box:'BOX 1',notas:[{chave:'CH1',tratamento:'RECUSA',liberadoParaRecusarEm:'2026-09-01T08:00:00.000Z'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  await mudarTratamento(document, win, 'r1', 'CH1', 'REENTREGA');
  await mudarTratamento(document, win, 'r1', 'CH1', 'RECUSA');
  const salvo=recusas._registro.get('r1');
  assert.equal(salvo.notas[0].tratamento,'RECUSA');
  assert.equal(salvo.notas[0].liberadoParaRecusarEm,'2026-09-01T08:00:00.000Z','data original da liberação precisa continuar intacta');
});

test('classificar como qualquer outro tratamento (não Recusa) nunca grava liberadoParaRecusarEm', async()=>{
  const recusas=mockColecao([{id:'r1',data:{criadoEm:'2026-09-01T00:00:00.000Z',box:'BOX 1',notas:[{chave:'CH1'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  await mudarTratamento(document, win, 'r1', 'CH1', 'REENTREGA');
  const salvo=recusas._registro.get('r1');
  assert.equal(salvo.notas[0].tratamento,'REENTREGA');
  assert.equal(salvo.notas[0].liberadoParaRecusarEm,undefined);
});

test('registro antigo sem `notas` real (array vazio) ainda consegue classificar — cria o item na 1ª edição', async()=>{
  const recusas=mockColecao([{id:'r1',data:{criadoEm:'2026-09-01T00:00:00.000Z',box:'BOX 1',notas:[]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  await mudarTratamento(document, win, 'r1', '', 'RECUSA');
  const salvo=recusas._registro.get('r1');
  assert.equal(salvo.notas.length,1);
  assert.equal(salvo.notas[0].tratamento,'RECUSA');
});

// PEDIDO AO VIVO (2026-09-08) — o cenário central do pedido: 2 notas do
// MESMO evento (mesmo motorista/box/data), cada uma com um Tratamento
// diferente, sem uma pisar na outra.
test('2 notas do mesmo evento: uma vira Recusa e a outra Reentrega, cada linha grava só na sua própria nota', async()=>{
  const recusas=mockColecao([{id:'r1',data:{criadoEm:'2026-09-01T00:00:00.000Z',box:'BOX 1',motoristaNome:'João',origem:'COLETOR',notas:[
    {chave:'CH1',numeroNota:'601'},
    {chave:'CH2',numeroNota:'602'},
  ]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));

  assert.ok(document.querySelector('[data-recusa-tratamento="r1|CH1"]'),'nota 601 precisa da sua própria linha/select');
  assert.ok(document.querySelector('[data-recusa-tratamento="r1|CH2"]'),'nota 602 precisa da sua própria linha/select');
  const html = document.getElementById('recusas-tabela').innerHTML;
  assert.match(html, /601/); assert.match(html, /602/);

  await mudarTratamento(document, win, 'r1', 'CH1', 'RECUSA');
  await mudarTratamento(document, win, 'r1', 'CH2', 'REENTREGA');

  const salvo=recusas._registro.get('r1');
  const n1=salvo.notas.find(n=>n.chave==='CH1'), n2=salvo.notas.find(n=>n.chave==='CH2');
  assert.equal(n1.tratamento,'RECUSA');
  assert.ok(n1.liberadoParaRecusarEm);
  assert.equal(n2.tratamento,'REENTREGA');
  assert.equal(n2.liberadoParaRecusarEm,undefined,'nota que virou Reentrega nunca deveria ganhar liberadoParaRecusarEm');
  assert.equal(salvo.statusFisico,'NO_PATIO','Recusa não finalizada e Reentrega sem saída — as duas continuam fisicamente no pátio');
});

test('registro antigo (1 nota só) com tratamento/liberadoParaRecusarEm gravados no DOCUMENTO — a tela mostra e edita através da nota, herdando o valor antigo', async()=>{
  const recusas=mockColecao([{id:'r1',data:{criadoEm:'2026-09-01T00:00:00.000Z',box:'BOX 1',tratamento:'RECUSA',liberadoParaRecusarEm:'2026-08-01T00:00:00.000Z',notas:[{chave:'CH1',numeroNota:'1'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const select=document.querySelector('[data-recusa-tratamento="r1|CH1"]');
  assert.equal(select.value,'RECUSA','herda o tratamento do documento antigo enquanto a nota não tiver o próprio');

  // 1ª edição pós-migração: já era Recusa antes, continua Recusa — não
  // pode reescrever liberadoParaRecusarEm com "agora", tem que herdar a
  // data real do documento antigo.
  await mudarTratamento(document, win, 'r1', 'CH1', 'RECUSA');
  const salvo=recusas._registro.get('r1');
  assert.equal(salvo.notas[0].liberadoParaRecusarEm,'2026-08-01T00:00:00.000Z');
});
