// PEDIDO AO VIVO (2026-10-12): o <select> nativo de Motivo, na tabela de
// Notas Retornadas, virou uma lista comprida de rolar (cadastro cresce sem
// limite) — trocado por um <input> com <datalist> (busca ao digitar),
// preservando o MESMO contrato de escrita (alterarMotivo(recusaId,motivoId)).
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
        onSnapshot: (cb, errCb) => { construir(condicoesAtuais).get().then(cb).catch(e => errCb && errCb(e)); return () => {}; },
        get: async () => {
          const bate = (data) => condicoesAtuais.every(c => {
            const v = data ? data[c.campo] : undefined;
            if (c.op === '>=') return v >= c.valor;
            if (c.op === '<=') return v <= c.valor;
            if (c.op === '==') return v === c.valor;
            return true;
          });
          const filtrados = [...registro.entries()].filter(([, data]) => bate(data));
          return { empty: filtrados.length === 0, size: filtrados.length, docs: filtrados.map(([id, data]) => ({ id, data: () => data })) };
        },
      });
      return construir([{ campo, op, valor }]);
    },
    doc:(id)=>({ id, update: async(payload)=>{ const a=registro.get(id)||{}; registro.set(id,{...a,...payload}); }, set: async(payload)=>{ const a=registro.get(id)||{}; registro.set(id,{...a,...payload}); } }),
    _registro: registro,
  };
}

let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(colecoes){
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  _janelasAbertas.push(win);
  win.getDTFirestore=()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) });
  win.getDTLojaAtiva=()=>'loja_matriz';
  win.firebase={
    auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }),
    app:()=>({ functions:()=>({ httpsCallable:(nomeFuncao)=>async(payload)=>{
      if(nomeFuncao!=='buscarIndicadoresRetornosBigQuery') throw new Error('função não mockada: '+nomeFuncao);
      const col=colecoes?.recebimento_recusas||mockColecao([]);
      const r=await col.where('criadoEm','>=',payload.ini+'T00:00:00.000Z').where('criadoEm','<=',payload.fim+'T23:59:59.999Z').get();
      return { data: { recusas: r.docs.map(d=>({ _id:d.id, ...d.data() })) } };
    } }) }),
  };
  const toasts=[];
  win.showToast=(msg,tipo)=>toasts.push({msg,tipo});
  win.aplicarPermissoesAnalista=()=>{};
  win.openModal=()=>{};
  win.closeModal=()=>{};
  win.eval(recusasCode);
  return { win, document, toasts };
}

async function montar(motivosIniciais) {
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 9',notas:[{numeroNota:'321'}],criadoEm:'2026-08-19T10:00:00.000Z',motivoId:'',motivoNome:''}}]);
  const motivos=mockColecao(motivosIniciais||[{id:'m1',data:{nome:'PEDIDO CANCELADO NO SISTEMA DA LOJA',ativo:true}},{id:'m2',data:{nome:'RECUSA',ativo:true}}]);
  const { win, document, toasts }=carregarPagina({ recebimento_recusas:recusas, recebimento_recusas_notas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:motivos });
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  return { win, document, toasts, recusas };
}

test('motivo vira um campo de busca (datalist), não select comprido', async () => {
  const { document } = await montar();
  const tabela = document.getElementById('recusas-tabela').innerHTML;
  assert.doesNotMatch(tabela, /<select[^>]*data-recusa-motivo/);
  assert.match(tabela, /data-recusa-motivo="r1"/);
  assert.match(tabela, /list="recusas-motivos-datalist"/);
  assert.match(tabela, /<datalist id="recusas-motivos-datalist">/);
  assert.match(tabela, /<option value="RECUSA">/);
});

test('digitar um motivo real da lista e disparar change grava o mesmo motivoId de antes (contrato preservado)', async () => {
  const { document, recusas } = await montar();
  const campo = document.querySelector('[data-recusa-motivo="r1"]');
  campo.value = 'RECUSA';
  campo.dispatchEvent(new document.defaultView.Event('change'));
  await new Promise(r => setTimeout(r, 0));
  const doc = recusas._registro.get('r1');
  assert.equal(doc.motivoId, 'm2');
  assert.equal(doc.motivoNome, 'RECUSA');
});

test('texto que não bate com nenhum motivo cadastrado é recusado: não grava e devolve o campo pro valor anterior', async () => {
  const { document, recusas, toasts } = await montar();
  const campo = document.querySelector('[data-recusa-motivo="r1"]');
  campo.value = 'coisa que não existe na lista';
  campo.dispatchEvent(new document.defaultView.Event('change'));
  await new Promise(r => setTimeout(r, 0));
  const doc = recusas._registro.get('r1');
  assert.equal(doc.motivoId, '', 'não deveria ter alterado o motivo (continua o valor original do fixture)');
  assert.equal(campo.value, '', 'campo devolvido pro valor anterior (vazio, não tinha motivo antes)');
  assert.ok(toasts.some(t => t.tipo === 'error'), 'deveria avisar que o motivo não foi reconhecido');
});

test('apagar o campo remove o motivo (motivoId vazio), sem exigir escolher da lista', async () => {
  const motivos=[{id:'m1',data:{nome:'PEDIDO CANCELADO NO SISTEMA DA LOJA',ativo:true}}];
  const { document, recusas } = await montar(motivos);
  const campo = document.querySelector('[data-recusa-motivo="r1"]');
  campo.value = 'PEDIDO CANCELADO NO SISTEMA DA LOJA';
  campo.dispatchEvent(new document.defaultView.Event('change'));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(recusas._registro.get('r1').motivoId, 'm1');
  campo.value = '';
  campo.dispatchEvent(new document.defaultView.Event('change'));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(recusas._registro.get('r1').motivoId, '');
});

test('motivo inativo cadastrado não aparece no datalist (lista some ficar maior à toa), mas segue selecionável se já era o valor atual da linha', async () => {
  const motivos=[{id:'m1',data:{nome:'ANTIGO INATIVO',ativo:false}},{id:'m2',data:{nome:'ATIVO',ativo:true}}];
  const { document } = await montar(motivos);
  const tabela = document.getElementById('recusas-tabela').innerHTML;
  assert.doesNotMatch(tabela, /<option value="ANTIGO INATIVO">/);
  assert.match(tabela, /<option value="ATIVO">/);
});
