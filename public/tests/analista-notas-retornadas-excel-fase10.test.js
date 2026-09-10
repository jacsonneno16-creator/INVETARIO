// FASE 10 (ponta Analista): exportação Excel — uma linha por ITEM
// conferido (cabeçalho da nota/retorno repetido), sem perder a relação
// nota↔itens; recusa sem itens ainda gera uma linha (com colunas de
// produto em branco), nunca some do relatório. Exporta a lista JÁ
// FILTRADA pela tela (mesmo princípio de "exporta o que você está vendo").
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const recusasCode=fs.readFileSync(path.join(base,'97-recebimento-recusas.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return {
    get: async()=>({ empty: registro.size===0, size: registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    doc:(id)=>({ id, set: async()=>{}, update: async()=>{} }),
    _registro: registro,
  };
}
// PEDIDO AO VIVO (2026-08-27): recebimento_recusas_notas agora migra pra
// recebimento_recusas_notas_chunks na primeira leitura (ver
// _migrarParaChunksSeNecessario em 97-recebimento-recusas.js) — isso usa
// getDTRawFirestore().batch(), que esta suíte não tinha antes.
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

// buscarBiAutomatico() (97-recebimento-recusas.js) agenda um setInterval de
// auto-refresh a cada render — timer real em jsdom, que precisa ser
// derrubado com window.close() ou o node --test nunca sai sozinho.
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(colecoesEntrada){
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  _janelasAbertas.push(win);
  const colecoes={...(colecoesEntrada||{})};
  if(!colecoes.recebimento_recusas_notas_chunks) colecoes.recebimento_recusas_notas_chunks=mockColecao([]);
  Object.keys(colecoes).forEach(nome=>_comColecaoNoDoc(colecoes[nome],nome));
  win.getDTFirestore=()=>({ collection:(nome)=>{ if(!colecoes[nome]) colecoes[nome]=_comColecaoNoDoc(mockColecao([]),nome); return colecoes[nome]; } });
  win.getDTRawFirestore=()=>mockRawFirestore(colecoes);
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }) };
  win.showToast=()=>{};
  win.aplicarPermissoesAnalista=()=>{};
  const planilhas=[];
  let arquivoGravado='';
  win.XLSX={
    utils:{
      book_new:()=>({}),
      json_to_sheet:(linhas)=>{ planilhas.push(linhas); return {}; },
      book_append_sheet:()=>{},
    },
    writeFile:(_wb,nome)=>{ arquivoGravado=nome; },
  };
  win.eval(recusasCode);
  return { win, document, planilhas: ()=>planilhas, arquivoGravado: ()=>arquivoGravado };
}

test('exportação gera UMA LINHA POR ITEM, repetindo os dados da nota/retorno em cada linha',async()=>{
  const notas=mockColecao([{id:'CHAVEX',data:{chave:'CHAVEX',numeroNota:'321',cfop:'1202',tipoOperacao:'ENTRADA',destinatario:'Mercado X',vendedorNome:'João Vendas'}}]);
  const recusas=mockColecao([{id:'r1',data:{
    box:'BOX 7',pallets:3,motoristaNome:'Pedro',motivoNome:'Cliente ausente',volumeEsperado:10,volumeInformado:8,diferencaVolumes:-2,conferenciaStatus:'DIVERGENTE',
    notas:[{chave:'CHAVEX',numeroNota:'321'}],
    statusConferenciaOperacional:'CONFERIDA_COM_DIVERGENCIA',
    itensConferidos:[
      {notaChave:'CHAVEX',descricao:'Refrigerante 2L',gtin:'789',qtdPrevista:2,qtdConferida:1},
      {notaChave:'CHAVEX',descricao:'Água 500ml',gtin:'790',qtdPrevista:5,qtdConferida:5},
    ],
    criadoEm:'2026-08-19T10:00:00.000Z',criadoPorEmail:'coletor@daterrinha.com',tratamento:'RECUSA',
  }}]);
  const { win, planilhas, arquivoGravado }=carregarPagina({ recebimento_recusas:recusas, recebimento_recusas_notas:notas, recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });
  await win.renderRecebimentoRecusas();
  win.document.querySelector('[data-recusa-exportar]').click();

  const linhas=planilhas()[0];
  assert.equal(linhas.length,2,'2 itens conferidos = 2 linhas');
  assert.equal(linhas[0]['NF'],'321');
  assert.equal(linhas[0]['CFOP'],'1202');
  assert.equal(linhas[0]['Vendedor'],'João Vendas');
  assert.equal(linhas[0]['Box'],'BOX 7');
  assert.equal(linhas[0]['Pallets'],3);
  assert.equal(linhas[0]['Produto'],'Refrigerante 2L');
  assert.equal(linhas[0]['Qtd Prevista'],2);
  assert.equal(linhas[0]['Qtd Conferida'],1);
  assert.equal(linhas[1]['Produto'],'Água 500ml');
  assert.equal(linhas[0]['Tratamento (Analista)'],'Recusa'); // label, não o código cru
  assert.equal(linhas[0]['Status Conferência de Produtos'],'CONFERIDA_COM_DIVERGENCIA');
  assert.match(arquivoGravado(),/notas_retornadas_.*\.xlsx/);
});

test('recusa SEM conferência de itens ainda gera 1 linha (colunas de produto em branco) — nunca some do relatório',async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 2',notas:[{chave:'Y',numeroNota:'55'}],statusConferenciaOperacional:'NAO_REALIZADA',criadoEm:'2026-08-19T10:00:00.000Z'}}]);
  const { win, planilhas }=carregarPagina({ recebimento_recusas:recusas, recebimento_recusas_notas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });
  await win.renderRecebimentoRecusas();
  win.document.querySelector('[data-recusa-exportar]').click();
  const linhas=planilhas()[0];
  assert.equal(linhas.length,1);
  assert.equal(linhas[0]['NF'],'55');
  assert.equal(linhas[0]['Produto'],'');
  assert.equal(linhas[0]['Status Conferência de Produtos'],'NAO_REALIZADA');
});

test('exportação respeita o filtro de Tratamento já aplicado na tela',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{box:'BOX A',tratamento:'RECUSA',notas:[{numeroNota:'1'}],criadoEm:'2026-08-19T10:00:00.000Z'}},
    {id:'r2',data:{box:'BOX B',tratamento:'DEVOLUCAO',notas:[{numeroNota:'2'}],criadoEm:'2026-08-19T10:00:00.000Z'}},
  ]);
  const { win, document, planilhas }=carregarPagina({ recebimento_recusas:recusas, recebimento_recusas_notas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });
  await win.renderRecebimentoRecusas();
  document.getElementById('recusas-filtro-tratamento').value='RECUSA';
  document.getElementById('recusas-filtro-tratamento').dispatchEvent(new win.Event('change'));
  document.querySelector('[data-recusa-exportar]').click();
  const linhas=planilhas()[0];
  assert.equal(linhas.length,1);
  assert.equal(linhas[0]['Box'],'BOX A');
});

test('sem nenhuma nota (lista filtrada vazia), avisa e não chama XLSX.writeFile',async()=>{
  const { win, arquivoGravado }=carregarPagina({ recebimento_recusas:mockColecao([]), recebimento_recusas_notas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });
  const toasts=[];
  win.showToast=(m,t)=>toasts.push({m,t});
  await win.renderRecebimentoRecusas();
  win.document.querySelector('[data-recusa-exportar]').click();
  assert.equal(arquivoGravado(),'');
  assert.ok(toasts.some(t=>/Nenhuma nota retornada/.test(t.m)));
});
