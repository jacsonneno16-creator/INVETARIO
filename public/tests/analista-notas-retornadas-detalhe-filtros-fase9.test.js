// FASE 9 (ponta Analista): filtros dedicados (período/tratamento/
// conferência), campo Tratamento editável e SEPARADO da Natureza da nota
// e da Conferência de produtos, e a tela de detalhe (nota+retorno+
// conferência+auditoria) juntando recebimento_recusas com
// recebimento_recusas_notas por chave.
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

// buscarBiAutomatico() (97-recebimento-recusas.js) agenda um setInterval
// de auto-refresh a cada render — em jsdom isso é um timer REAL que
// mantém o processo do node --test vivo pra sempre se a janela não for
// fechada. window.close() derruba os timers internos do jsdom.
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

// PEDIDO AO VIVO (2026-08-27): recebimento_recusas_notas agora migra pra
// recebimento_recusas_notas_chunks na primeira leitura (ver
// _migrarParaChunksSeNecessario em 97-recebimento-recusas.js) — isso usa
// getDTRawFirestore().batch(), que esta suíte não tinha antes. Cada
// coleção do mock ganha um `.doc(id)` que já carrega o nome da coleção
// (`_colecao`), pra o batch saber onde aplicar cada operação.
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

test('filtro de Tratamento esconde recusas com tratamento diferente do selecionado',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{box:'BOX 1',tratamento:'RECUSA',notas:[{numeroNota:'1'}],criadoEm:'2026-08-19T10:00:00.000Z'}},
    {id:'r2',data:{box:'BOX 2',tratamento:'DEVOLUCAO',notas:[{numeroNota:'2'}],criadoEm:'2026-08-19T11:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('recusas-filtro-tratamento').value='RECUSA';
  document.getElementById('recusas-filtro-tratamento').dispatchEvent(new win.Event('change'));
  assert.match(document.getElementById('recusas-tabela').innerHTML,/BOX 1/);
  assert.doesNotMatch(document.getElementById('recusas-tabela').innerHTML,/BOX 2/);
});

test('filtro de período (DE/ATÉ) usa a data de criadoEm',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{box:'BOX ANTIGA',notas:[],criadoEm:'2026-08-01T10:00:00.000Z'}},
    {id:'r2',data:{box:'BOX NOVA',notas:[],criadoEm:'2026-08-19T10:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('recusas-filtro-periodo-ini').value='2026-08-15';
  document.getElementById('recusas-filtro-periodo-ini').dispatchEvent(new win.Event('change'));
  assert.match(document.getElementById('recusas-tabela').innerHTML,/BOX NOVA/);
  assert.doesNotMatch(document.getElementById('recusas-tabela').innerHTML,/BOX ANTIGA/);
});

test('filtro de status de Conferência isola CONFERIDA_COM_DIVERGENCIA',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{box:'BOX OK',statusConferenciaOperacional:'CONFERIDA',notas:[],criadoEm:'2026-08-19T10:00:00.000Z'}},
    {id:'r2',data:{box:'BOX DIV',statusConferenciaOperacional:'CONFERIDA_COM_DIVERGENCIA',notas:[],criadoEm:'2026-08-19T10:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('recusas-filtro-conferencia').value='CONFERIDA_COM_DIVERGENCIA';
  document.getElementById('recusas-filtro-conferencia').dispatchEvent(new win.Event('change'));
  assert.match(document.getElementById('recusas-tabela').innerHTML,/BOX DIV/);
  assert.doesNotMatch(document.getElementById('recusas-tabela').innerHTML,/BOX OK/);
});

// PEDIDO AO VIVO (2026-09-08): Tratamento passou de campo do documento pra
// campo de cada item de `notas[]` — grava dentro de `notas[i]`, não mais
// solto no documento (data-recusa-tratamento virou chave composta
// `${recusaId}|${chaveDaNota}`; sem `notas` real, a tela usa um
// placeholder de chave vazia, mesmo criado de verdade na 1ª edição).
test('trocar o select de Tratamento grava tratamento+tratamentoDefinidoPor/Em na NOTA, sem mexer em nenhum outro campo',async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 1',notas:[],criadoEm:'2026-08-19T10:00:00.000Z',statusConferenciaOperacional:'NAO_REALIZADA'}}]);
  const { win, document }=carregarPagina(baseColecoes(recusas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const sel=document.querySelector('[data-recusa-tratamento="r1|"]');
  sel.value='REENTREGA';
  sel.dispatchEvent(new win.Event('change'));
  await new Promise(r=>setTimeout(r,0));
  const doc=recusas._registro.get('r1');
  assert.equal(doc.notas[0].tratamento,'REENTREGA');
  assert.equal(doc.notas[0].tratamentoDefinidoPor,'analista@daterrinha.com');
  assert.ok(doc.notas[0].tratamentoDefinidoEm);
  assert.equal(doc.box,'BOX 1'); // nada além do tratamento foi tocado
  assert.equal(doc.statusConferenciaOperacional,'NAO_REALIZADA'); // conferência não é sobrescrita pelo tratamento
});

test('detalhe da recusa junta nota (natureza/CFOP/vendedor) + retorno + conferência com itens + auditoria, sem misturar os conceitos',async()=>{
  const notas=mockColecao([{id:'CHAVEX',data:{chave:'CHAVEX',numeroNota:'321',cfop:'1202',tipoOperacao:'ENTRADA',pareceDevolucao:true,destinatario:'Mercado X',destinatarioCnpj:'12345678000199',vendedorNome:'João Vendas',vendedorEmail:'joao@x.com'}}]);
  const recusas=mockColecao([{id:'r1',data:{
    box:'BOX 7',pallets:3,motoristaNome:'Pedro',motivoNome:'Cliente ausente',volumeEsperado:10,volumeInformado:8,
    notas:[{chave:'CHAVEX',numeroNota:'321'}],
    statusConferenciaOperacional:'CONFERIDA_COM_DIVERGENCIA',
    itensConferidos:[{descricao:'Refrigerante 2L',gtin:'789',qtdPrevista:2,qtdConferida:1}],
    criadoEm:'2026-08-19T10:00:00.000Z',criadoPorEmail:'coletor@daterrinha.com',
    conferenciaConcluidaPorEmail:'operador2@daterrinha.com',conferenciaConcluidaEm:'2026-08-19T12:00:00.000Z',
    tratamento:'RECUSA',tratamentoDefinidoPor:'analista@daterrinha.com',tratamentoDefinidoEm:'2026-08-19T13:00:00.000Z',
  }}]);
  const { win, document }=carregarPagina(baseColecoes(recusas,notas));
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  document.querySelector('[data-recusa-detalhe="r1"]').click();
  const corpo=document.getElementById('recusa-detalhe-corpo').innerHTML;
  assert.match(corpo,/NF 321/);
  assert.match(corpo,/CFOP 1202/);
  assert.match(corpo,/parece devolução/);
  assert.match(corpo,/João Vendas/);
  assert.match(corpo,/Pedro/);
  assert.match(corpo,/BOX 7/);
  assert.match(corpo,/3 pallet/);
  assert.match(corpo,/Refrigerante 2L/);
  assert.match(corpo,/coletor@daterrinha\.com/);
  assert.match(corpo,/operador2@daterrinha\.com/);
  assert.match(corpo,/analista@daterrinha\.com/);
  assert.match(corpo,/Recusa/); // label do tratamento, não o código RECUSA cru
});
