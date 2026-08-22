const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const dashCode=fs.readFileSync(path.join(base,'91-logistica-recebimento.js'),'utf8');

function mockColecaoVazia(){ return { get: async()=>({docs:[]}) }; }

function loadDashboard(recebimentosFake, ehHojeFn){
  const elementos=new Map();
  function elFake(id){ if(!elementos.has(id)) elementos.set(id,{id,value:'',textContent:'',innerHTML:''}); return elementos.get(id); }
  const clickHandlers=[];
  const document={
    addEventListener:(tipo,fn)=>{ if(tipo==='click') clickHandlers.push(fn); },
    getElementById:(id)=>elFake(id),
  };
  const window={
    getDTFirestore:()=>({ collection:()=>mockColecaoVazia() }),
    Chart:undefined,
    _recebimentoOperacaoInternals:{
      carregar: async()=>{},
      recebimentos: ()=>recebimentosFake,
      ehHoje: ehHojeFn,
    },
    recopAbrirComFiltro: ()=>{},
  };
  vm.runInNewContext(dashCode,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,Promise},{filename:'91-logistica-recebimento.js'});
  return {window,document,elFake,disparaClick:(target)=>{ clickHandlers.forEach(fn=>fn({target})); }};
}

const HOJE='2026-08-14';
const ehHojeFixo = iso => iso && String(iso).slice(0,10)===HOJE;

test('KPIs operacionais: separa corretamente recebimentos por status/hoje/andamento, sem misturar com o histórico Bluesoft',()=>{
  const recs=[
    {status:'CHEGOU',horaChegada:HOJE+'T08:00:00.000Z',tipo:'FORNECEDOR',fornecedorNome:'A',notas:[]},
    {status:'EM_DESCARGA',horaChegada:HOJE+'T09:00:00.000Z',tipo:'FORNECEDOR',fornecedorNome:'B',notas:[{numero:'1'}]},
    {status:'FINALIZADO',horaChegada:'2026-08-10T08:00:00.000Z',horaFechamentoRecebimento:HOJE+'T10:00:00.000Z',tipo:'FORNECEDOR',fornecedorNome:'C',notas:[{numero:'2'},{numero:'3'}],tempoEsperaMin:10,tempoDescargaMin:20,tempoTotalMin:30},
    {status:'CANCELADO',horaChegada:'2026-08-01T08:00:00.000Z',tipo:'FORNECEDOR',fornecedorNome:'D',notas:[]},
  ];
  const {window}=loadDashboard(recs,ehHojeFixo);
  const html=window._recebimentoInternals.kpisOperacionaisHtml();
  assert.match(html,/data-reb-kpi-hoje="1"/); // card "Recebimentos hoje" existe
  // 3 dos 4 recebimentos são de hoje (CHEGOU, EM_DESCARGA, e o horaFechamentoRecebimento de FINALIZADO é hoje mas horaChegada não é — "hoje" olha horaChegada||criadoEm, então só 2 contam pra "Recebimentos hoje")
  assert.match(html,/>2<\/div><div class="kpi-lbl">Recebimentos hoje/);
  // em andamento: CHEGOU + EM_DESCARGA = 2 (FINALIZADO e CANCELADO não contam)
  assert.match(html,/>2<\/div><div class="kpi-lbl">Em andamento/);
  // aguardando descarga (CHEGOU/AGUARDANDO_DOCA) = 1
  assert.match(html,/>1<\/div><div class="kpi-lbl">Aguardando descarga/);
  // notas fiscais registradas operacionalmente = 0+1+2+0 = 3
  assert.match(html,/>3<\/div><div class="kpi-lbl">Notas fiscais registradas/);
});

test('clicar num card do dashboard chama recopAbrirComFiltro com o status/hoje certos (navegação seção 3 do pedido)',()=>{
  let chamado=null;
  const {window,disparaClick}=loadDashboard([],ehHojeFixo);
  window.recopAbrirComFiltro=(opts)=>{ chamado=opts; };
  const fakeCard={
    closest:(sel)=> sel==='[data-reb-kpi-status]' ? {
      getAttribute:(nome)=> nome==='data-reb-kpi-status' ? 'EM_DESCARGA' : (nome==='data-reb-kpi-hoje' ? '' : null),
    } : null,
  };
  disparaClick(fakeCard);
  assert.ok(chamado);
  assert.equal(chamado.status,'EM_DESCARGA');
  assert.equal(chamado.hoje,false);
});
