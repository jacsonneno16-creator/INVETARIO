// PEDIDO AO VIVO (2026-09-08): Notas Retornadas ganhou uma coluna "Status do
// retorno" — atalho pra classificar Tratamento E já adiantar o Status sem
// sair da tela (mesmo campo por nota que "Status de Retornos"/
// 99-recebimento-retornos-status.js já usa).
//
// REVERTIDO (2026-09-10, pedido ao vivo, confirmado explicitamente): "aqui na
// base geral não vai ficar, vai esse status de retorno vai aparecer lá na
// recusa" — dois lugares editando o mesmo campo (aqui e em Status de
// Retornos) foi considerado confuso demais. A coluna/atalho foi removida
// desta tela; o Status de retorno (e as datas de Reentrega) só se editam em
// Status de Retornos (99) a partir de agora. Esta suíte passou a confirmar a
// AUSÊNCIA do atalho, e que o Tratamento (que continua aqui, é a
// classificação em si) segue funcionando normalmente sem ele.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const recusasCode=fs.readFileSync(path.join(base,'97-recebimento-recusas.js'),'utf8');
const statusCode=fs.readFileSync(path.join(base,'99-recebimento-retornos-status.js'),'utf8');

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
test.afterEach(async () => {
  await new Promise(r => setTimeout(r, 0));
  _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} });
  _janelasAbertas = [];
});
function carregarPagina(colecoesEntrada){
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  const colecoes={...(colecoesEntrada||{})};
  if(!colecoes.recebimento_recusas_notas_chunks) colecoes.recebimento_recusas_notas_chunks=mockColecao([]);
  win.getDTFirestore=()=>({ collection:(nome)=>{ if(!colecoes[nome]) colecoes[nome]=mockColecao([]); return colecoes[nome]; } });
  win.getDTLojaAtiva=()=>'loja_matriz';
  win.firebase={
    auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }),
    app:()=>({ functions:()=>({ httpsCallable:(nomeFuncao)=>async(payload)=>{
      if(nomeFuncao!=='buscarIndicadoresRetornosBigQuery') throw new Error('função não mockada: '+nomeFuncao);
      const col=colecoes.recebimento_recusas||mockColecao([]);
      const r=await col.where('criadoEm','>=',payload.ini+'T00:00:00.000Z').where('criadoEm','<=',payload.fim+'T23:59:59.999Z').get();
      return { data: { recusas: r.docs.map(d=>({ _id:d.id, ...d.data() })) } };
    } }) }),
  };
  win.showToast=()=>{};
  win.aplicarPermissoesAnalista=()=>{};
  win.openModal=()=>{};
  win.closeModal=()=>{};
  win.eval(statusCode); // dono de STATUS_RETORNO_LABELS, que 97 ainda referencia via TRATAMENTO_LABELS de outros pontos
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

test('coluna/atalho "Status do retorno" NÃO existe mais em Notas Retornadas — nem para Recusa (select) nem para Reentrega (datas)', async()=>{
  const recusas=mockColecao([{id:'r1',data:{criadoEm:'2026-09-01T00:00:00.000Z',box:'BOX 1',notas:[
    {chave:'CH1',numeroNota:'601',tratamento:'RECUSA'},
    {chave:'CH2',numeroNota:'602',tratamento:'REENTREGA'},
  ]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(document.querySelector('[data-recusa-status]'), null, 'não existe mais nenhum select de status nesta tela');
  assert.equal(document.querySelector('[data-recusa-reentrega-data]'), null, 'não existem mais os campos de data de reentrega nesta tela');
  assert.doesNotMatch(document.getElementById('recusas-tabela').innerHTML, /Status do retorno/, 'cabeçalho da coluna removido');
});

test('Tratamento continua funcionando normalmente (é a classificação, ficou nesta tela) — só o atalho de status/data é que saiu', async()=>{
  const recusas=mockColecao([{id:'r1',data:{criadoEm:'2026-09-01T00:00:00.000Z',box:'BOX 1',origem:'COLETOR',notas:[{chave:'CH1',numeroNota:'601'}]}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));

  const selectTratamento = document.querySelector('[data-recusa-tratamento="r1|CH1"]');
  assert.ok(selectTratamento, 'select de Tratamento continua existindo');

  selectTratamento.value = 'RECUSA';
  selectTratamento.dispatchEvent(new win.Event('change'));
  await new Promise(r => setTimeout(r, 0));

  const salvo = recusas._registro.get('r1');
  assert.equal(salvo.notas[0].tratamento, 'RECUSA');
  // mesmo sem o atalho, classificar já recalcula o statusFisico do Pátio em
  // Tempo Real normalmente (alterarTratamento não mudou nesta remoção).
  assert.equal(salvo.statusFisico, 'NO_PATIO');
  assert.doesNotMatch(document.getElementById('recusas-tabela').innerHTML, /data-recusa-status/, 'classificar como Recusa não faz reaparecer o atalho removido');
});
