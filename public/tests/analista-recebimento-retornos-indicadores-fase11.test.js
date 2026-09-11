// FASE 11: aba "Indicadores de Retornos" — ranking de mercados/motivos/
// vendedores/supervisores/transportadora que mais devolvem, generalizando o
// padrão visual CSS de acompColumnChart (dashRankedBarChart) em vez de
// introduzir Chart.js.
//
// REESCRITO 2026-08-20 — pedido ao vivo do usuário, com print de um
// dashboard Power BI de referência: "quero que os indicadores de retorno
// funcionem com essas informações, e que sejam interativos caso clique em
// alguma informação as outras atualizem". Escopo combinado via
// AskUserQuestion: construir agora com dado real (sem Ação/Status, que são
// a Fase 12 ainda deliberadamente adiada), "Transportadora" usa o campo
// Motorista, e Valor (R$) passa a ser gravado a partir de agora.
//
// ATUALIZADO 2026-08-21 — Fase 12 (Status de Retornos) já existe, então
// Ação (Tratamento) e Status saem do adiamento e entram como mais dois
// gráficos, no mesmo padrão clique-pra-filtrar. Testes carregam também
// 97-recebimento-recusas.js (dono de TRATAMENTO_LABELS, exportado
// globalmente) e 99-recebimento-retornos-status.js (dono de
// STATUS_RETORNO_LABELS) — sem os dois, a dimensão cai pro rótulo cru.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const indicCode=fs.readFileSync(path.join(base,'98-recebimento-retornos-indicadores.js'),'utf8');
const statusCode=fs.readFileSync(path.join(base,'99-recebimento-retornos-status.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return {
    get: async()=>({ docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    where(campo, op, valor) {
      const construir = (condicoesAtuais) => ({
        where: (c2, o2, v2) => construir([...condicoesAtuais, { campo: c2, op: o2, valor: v2 }]),
        get: async () => {
          const bate = (data) => condicoesAtuais.every(c => {
            const v = data ? data[c.campo] : undefined;
            if (c.op === '>=') return v >= c.valor;
            if (c.op === '<=') return v <= c.valor;
            if (c.op === '==') return v === c.valor;
            return true;
          });
          return { docs: [...registro.entries()].filter(([, data]) => bate(data)).map(([id, data]) => ({ id, data: () => data })) };
        },
      });
      return construir([{ campo, op, valor }]);
    },
  };
}

// `comLabels` carrega junto o mapa de status (99) — só usado nos testes que
// precisam do rótulo humano; os demais testam sem ele de propósito, pra
// travar o fallback pro valor cru quando o mapa ainda não carregou.
//
// PEDIDO AO VIVO (2026-09-11, Fase 2 do espelho BigQuery): a busca de
// recebimento_recusas por período passou a ir por uma Cloud Function
// (buscarIndicadoresRetornosBigQuery) em vez do Firestore direto — o mock
// de firebase.app().functions().httpsCallable() abaixo lê da MESMA
// coleção recebimento_recusas já usada nos testes (via o `.where()` que
// mockColecao já suporta), devolvendo no mesmo formato {data:{recusas}}
// que a função real devolve — os ~30 testes deste arquivo continuam
// passando sem precisar mudar cada um.
function carregarPagina(colecoes,opts){
  opts=opts||{};
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-retornos-indicadores"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window;
  const colRecusas=colecoes?.recebimento_recusas||mockColecao([]);
  win.getDTFirestore=()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) });
  win.getDTLojaAtiva=()=>'loja_matriz';
  win.firebase={ app:()=>({ functions:()=>({ httpsCallable:(nomeFuncao)=>async(payload)=>{
    if(nomeFuncao!=='buscarIndicadoresRetornosBigQuery') throw new Error('função não mockada: '+nomeFuncao);
    const r=await colRecusas.where('criadoEm','>=',payload.ini+'T00:00:00.000Z').where('criadoEm','<=',payload.fim+'T23:59:59.999Z').get();
    return { data: { recusas: r.docs.map(d=>({ _id:d.id, ...d.data() })) } };
  } }) }) };
  win.TRATAMENTO_LABELS=opts.tratamentoLabels;
  win.eval(indicCode);
  if (opts.comStatusLabels) win.eval(statusCode);
  return { win, document: win.document };
}

test('dashRankedBarChart não introduz Chart.js — usa as mesmas classes dash-column-* já existentes',()=>{
  const { win }=carregarPagina({});
  const html=win.dashRankedBarChart([{label:'Mercado A',value:5},{label:'Mercado B',value:3}],{limit:10});
  assert.match(html,/dash-column-chart/);
  assert.match(html,/dash-column auditados/);
  assert.doesNotMatch(html,/new Chart\(/);
  assert.doesNotMatch(indicCode,/new Chart\(/); // biblioteca em si nunca é instanciada (o arquivo só MENCIONA em comentário que optou por não usá-la)
});

test('PEDIDO AO VIVO ("os gráficos dos cards quero idênticos" a um dashboard de referência): rankings usam barra HORIZONTAL (dash-hbar-*), não coluna vertical',()=>{
  const { win }=carregarPagina({});
  const html=win.dashHorizontalBarChart([{label:'Maju Logística',value:70},{label:'JG Alves',value:50},{label:'Maio',value:30}],{limit:15,dim:'transportadora'});
  assert.match(html,/dash-hbar-chart/);
  assert.match(html,/dash-hbar-row/);
  assert.match(html,/dash-hbar-fill/);
  assert.doesNotMatch(html,/new Chart\(/);
  // maior valor primeiro (ranqueado, igual ao print de referência) e a
  // barra do maior precisa ocupar 100% da largura (é o próprio máximo).
  const primeiraLinha=html.split('dash-hbar-row')[1];
  assert.match(primeiraLinha,/Maju Logística/);
  assert.match(primeiraLinha,/width:100%/);
});

test('cardChart usa barra horizontal pros rankings (transportadora/motivo/mercado/vendedor/supervisor) e coluna vertical só pro mês (igual ao print de referência)',async()=>{
  const notas=mockColecao([{id:'A',data:{chave:'A',destinatario:'Mercado 1'}}]);
  const recusas=mockColecao([{id:'r1',data:{notas:[{chave:'A'}],motoristaNome:'Transp X',motivoNome:'Sem Pedido',criadoEm:'2026-04-10T10:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  // "Ocorrências por Transportadora" (ranking) tem que estar dentro de um
  // bloco dash-hbar-chart; "Retornos por Mês" tem que estar num
  // dash-column-chart (vertical) — checagem por proximidade no HTML.
  const blocoTransportadora=html.split('Ocorrências por Transportadora')[1].split('</div></div>')[0];
  assert.match(blocoTransportadora,/dash-hbar-chart/);
  const blocoMes=html.split('Retornos por Mês')[1].split('Média de dias')[0];
  assert.match(blocoMes,/dash-column-chart/);
});

test('PEDIDO AO VIVO (2026-09-11): agregarPorCampoDaNota soma por NOTA, não por evento — 2 notas do mesmo mercado na mesma carga contam 2',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado Atacadão'}},
    {id:'B',data:{chave:'B',destinatario:'Mercado Atacadão'}}, // mesma loja, nota diferente, mesma carga
    {id:'C',data:{chave:'C',destinatario:'Mercado Central'}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'},{chave:'B'}],criadoEm:'2026-06-01T00:00:00.000Z'}}, // 1 carga com 2 notas do MESMO mercado — conta 2
    {id:'r2',data:{notas:[{chave:'C'}],criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const ranking=win._recebimentoRetornosIndicadoresInternals.agregarPorCampoDaNota('destinatario');
  assert.equal(ranking.find(x=>x.label==='Mercado Atacadão').value,2);
  assert.equal(ranking.find(x=>x.label==='Mercado Central').value,1);
});

test('PEDIDO AO VIVO (2026-09-11): "Ocorrências por Transportadora" soma por NOTA — motorista trouxe 1 vez mas com 2 notas conta 2',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado A'}},
    {id:'B',data:{chave:'B',destinatario:'Mercado B'}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'},{chave:'B'}],motoristaNome:'João',criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const ranking=win._recebimentoRetornosIndicadoresInternals.agregarPorDimensao('transportadora');
  assert.equal(ranking.find(x=>x.label==='João').value,2);
});

test('página mostra os blocos do PRINT de referência: transportadora (via motorista), motivo, mercado, vendedor, supervisor e mês',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado 1',supervisorNome:'Rodolfo',vendedorNome:'João'}},
    {id:'B',data:{chave:'B',destinatario:'Mercado 2',supervisorNome:'Rodolfo',vendedorNome:'Pedro'}},
    {id:'C',data:{chave:'C',destinatario:'Mercado 3',supervisorNome:'Ana',vendedorNome:'João'}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],motoristaNome:'Maju Logística',motivoNome:'Sem Pedido',criadoEm:'2026-04-10T10:00:00.000Z'}},
    {id:'r2',data:{notas:[{chave:'B'}],motoristaNome:'Maju Logística',motivoNome:'Duplicidade',criadoEm:'2026-04-11T10:00:00.000Z'}},
    {id:'r3',data:{notas:[{chave:'C'}],motoristaNome:'JG Alves',motivoNome:'Sem Pedido',criadoEm:'2026-05-02T10:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Ocorrências por Transportadora/);
  assert.match(html,/Motivos da Volta/);
  assert.match(html,/Notas por Cliente\/Mercado/);
  assert.match(html,/Notas por Vendedor/);
  assert.match(html,/Notas por Supervisor/);
  assert.match(html,/Retornos por Mês/);
  assert.match(html,/Média de dias p\/ finalizar por mês/);

  const porTransportadora=win._recebimentoRetornosIndicadoresInternals.agregarPorDimensao('transportadora');
  assert.equal(porTransportadora[0].label,'Maju Logística','usa Motorista como Transportadora, pedido combinado com o usuário');
  assert.equal(porTransportadora[0].value,2);

  const porSupervisor=win._recebimentoRetornosIndicadoresInternals.agregarPorDimensao('supervisor');
  assert.equal(porSupervisor.find(x=>x.label==='Rodolfo').value,2);
});

test('sem nenhum retorno registrado, mostra "Sem dados" em vez de gráfico quebrado',async()=>{
  const { win, document }=carregarPagina({});
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  assert.match(document.getElementById('page-recebimento-retornos-indicadores').innerHTML,/Sem dados para exibir/);
});

test('KPIs somam pallets, volume informado e valor (deduplicado por chave da nota) do conjunto filtrado',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',valorTotal:1000}},
    {id:'B',data:{chave:'B',valorTotal:500}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],pallets:3,volumeInformado:10,criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r2',data:{notas:[{chave:'B'}],pallets:2,volumeInformado:5,criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(k.totalRetornos,2);
  assert.equal(k.somaPallets,5);
  assert.equal(k.somaVolume,15);
  assert.equal(k.somaValor,1500);
});

test('PEDIDO AO VIVO ("nos gráficos tem que ter a opção de período, para filtrar no período"): filtro De/Até por data restringe KPIs e gráficos, combinado com o filtro cruzado',async()=>{
  const notas=mockColecao([{id:'A',data:{chave:'A',valorTotal:100}},{id:'B',data:{chave:'B',valorTotal:200}}]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],pallets:1,criadoEm:'2026-01-10T10:00:00.000Z'}}, // fora do período
    {id:'r2',data:{notas:[{chave:'B'}],pallets:4,criadoEm:'2026-03-05T10:00:00.000Z'}}, // dentro do período
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));

  let k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(k.totalRetornos,2,'sem período ativo, os dois entram');

  win._recebimentoRetornosIndicadoresInternals.setPeriodo('2026-03-01','2026-03-31');
  k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(k.totalRetornos,1,'só o retorno de março fica depois do filtro de período');
  assert.equal(k.somaPallets,4);
  assert.equal(k.somaValor,200);
});

// PEDIDO AO VIVO (2026-09-10): "todas as telas que trazem dados na parte de
// Recebimento, colocar para buscar manualmente" — a busca ao SERVIDOR só
// acontece ao clicar em Buscar, mas dentro do que já foi trazido (período
// de até 2 anos), mudar os campos de data ainda refiltra a tela na hora,
// sem precisar reconsultar a API pra um período mais estreito.
test('período de datas é aplicado direto pelos campos <input type="date"> da tela, dentro do que já foi buscado',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[],motoristaNome:'Fora do período',criadoEm:'2026-01-10T10:00:00.000Z'}},
    {id:'r2',data:{notas:[],motoristaNome:'Dentro do período',criadoEm:'2026-03-05T10:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:mockColecao([]), recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));

  const ini=document.getElementById('indic-periodo-ini'), fim=document.getElementById('indic-periodo-fim');
  assert.ok(ini && fim,'os dois campos de data precisam existir na tela');
  ini.value='2026-03-01'; ini.dispatchEvent(new win.Event('change',{bubbles:true}));
  fim.value='2026-03-31'; fim.dispatchEvent(new win.Event('change',{bubbles:true}));

  const html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Dentro do período/);
  assert.doesNotMatch(html,/Fora do período/);
});

test('PEDIDO AO VIVO ("interativos, caso clique em alguma informação as outras atualizem"): clicar numa barra filtra TODOS os outros gráficos e os KPIs',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado 1',vendedorNome:'João',valorTotal:100}},
    {id:'B',data:{chave:'B',destinatario:'Mercado 2',vendedorNome:'Pedro',valorTotal:200}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],motoristaNome:'Transp X',motivoNome:'Sem Pedido',pallets:1,criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r2',data:{notas:[{chave:'B'}],motoristaNome:'Transp Y',motivoNome:'Duplicidade',pallets:4,criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));

  // Antes do clique: os dois vendedores aparecem.
  let html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/João/);
  assert.match(html,/Pedro/);

  // Clica na barra "Transp X" (transportadora) — deve filtrar TUDO pra
  // essa recusa só, inclusive o gráfico de vendedor e os KPIs.
  const barraTranspX=[...document.querySelectorAll('[data-indic-dim="transportadora"]')].find(el=>el.dataset.indicVal==='Transp X');
  assert.ok(barraTranspX,'a barra da transportadora precisa existir e ser clicável');
  barraTranspX.click();

  html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/João/);
  assert.doesNotMatch(html,/Pedro/,'vendedor da OUTRA transportadora some do gráfico depois do filtro cruzado');
  assert.match(html,/Filtrando por/);

  const k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(k.totalRetornos,1);
  assert.equal(k.somaPallets,1);
  assert.equal(k.somaValor,100);

  // Clicar de NOVO na mesma barra limpa o filtro.
  const barraDeNovo=[...document.querySelectorAll('[data-indic-dim="transportadora"]')].find(el=>el.dataset.indicVal==='Transp X');
  barraDeNovo.click();
  html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Pedro/,'clicar de novo na mesma barra limpa o filtro cruzado');
  assert.doesNotMatch(html,/Filtrando por/);
});

test('botão "✕ limpar" do chip de filtro também remove o filtro cruzado',async()=>{
  const notas=mockColecao([{id:'A',data:{chave:'A',destinatario:'Mercado 1'}}]);
  const recusas=mockColecao([{id:'r1',data:{notas:[{chave:'A'}],motoristaNome:'Transp X',criadoEm:'2026-06-01T00:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  document.querySelector('[data-indic-dim="transportadora"]').click();
  assert.match(document.getElementById('page-recebimento-retornos-indicadores').innerHTML,/Filtrando por/);
  document.querySelector('[data-indic-limpar-filtro]').click();
  assert.doesNotMatch(document.getElementById('page-recebimento-retornos-indicadores').innerHTML,/Filtrando por/);
});

test('"Retornos por Mês" e "Média de dias p/ finalizar por mês" ficam em ordem cronológica, não por valor',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',dataEmissao:'2026-01-01T00:00:00.000Z'}},
    {id:'B',data:{chave:'B',dataEmissao:'2026-03-01T00:00:00.000Z'}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],criadoEm:'2026-03-05T00:00:00.000Z'}}, // março, 1 retorno
    {id:'r2',data:{notas:[{chave:'B'}],criadoEm:'2026-01-10T00:00:00.000Z'}}, // janeiro, 1 retorno
    {id:'r3',data:{notas:[{chave:'B'}],criadoEm:'2026-01-15T00:00:00.000Z'}}, // janeiro de novo — vira o maior valor
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const porMes=win._recebimentoRetornosIndicadoresInternals.agregarPorDimensao('mes');
  // Sem ordenação cronológica isso viria com 01/2026 (valor 2) primeiro; a
  // função de agregação em si não ordena por data — quem faz isso é o
  // dashRankedBarChart com cronologico:true, então testamos o helper que
  // o alimenta.
  assert.equal(porMes.find(x=>x.label==='01/2026').value,2);
  assert.equal(porMes.find(x=>x.label==='03/2026').value,1);
});

// PEDIDO AO VIVO (2026-08-21, correção depois de um 2º print do mesmo
// dashboard): "ação devolução pendente recusa reentregas nao sao graficos
// é um card que eu seleciono... é que nem os status" — confirmado abrindo
// o .pbix real do usuário (Report/Layout): AÇÃO e STATUS são
// visualType:"slicer", mode:"Basic" (painel de checkbox multi-seleção),
// nunca uma barra. Aqui viram 2 painéis de checkbox — não entram no
// gráfico nenhum, só filtram os OUTROS gráficos e os KPIs, igual à
// planilha real: "só aparecem caso tenha alguma [nota] com ela".
test('PEDIDO AO VIVO: painel de Ação (Tratamento) mostra só os valores REAIS presentes nos dados, com o rótulo humano (TRATAMENTO_LABELS)',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[],tratamento:'RECUSA',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r2',data:{notas:[],tratamento:'RECUSA',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r3',data:{notas:[],tratamento:'PENDENTE',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r4',data:{notas:[],criadoEm:'2026-06-01T00:00:00.000Z'}}, // sem tratamento — cai em "Não classificado"
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ tratamentoLabels:{ '':'— Não classificado —', RECUSA:'Recusa', PENDENTE:'Pendente', DEVOLUCAO:'Devolução', REENTREGA:'Reentrega', SUBSTITUICAO:'Substituição' } });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  const caixas=[...document.querySelectorAll('[data-indic-painel="tratamento"]')].map(el=>el.dataset.indicPainelValor);
  assert.deepEqual(caixas.sort(),['— Não classificado —','Pendente','Recusa'].sort(),'só os valores que realmente ocorrem nos dados aparecem no painel — Devolução/Reentrega/Substituição ficam de fora por não terem nenhuma nota');
  assert.doesNotMatch(html,/Notas por Ação/,'não é mais um gráfico — só um painel de filtro');
});

test('PEDIDO AO VIVO: painel de Status usa o rótulo humano (STATUS_RETORNO_LABELS) e EXCLUI reentrega (que não usa esse status)',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[],statusRetorno:'AGUARD_FISCAL',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r2',data:{notas:[],statusRetorno:'FINALIZADO',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r3',data:{notas:[],tratamento:'REENTREGA',statusRetorno:'',criadoEm:'2026-06-01T00:00:00.000Z'}}, // reentrega — fica de fora deste painel
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ comStatusLabels:true });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const caixas=[...document.querySelectorAll('[data-indic-painel="status"]')].map(el=>el.dataset.indicPainelValor);
  assert.deepEqual(caixas.sort(),['Aguard. Fiscal','Finalizado'].sort());
});

test('sem o rótulo humano carregado ainda, o painel de Status cai pro valor cru (nunca quebra)',async()=>{
  const recusas=mockColecao([{id:'r1',data:{notas:[],statusRetorno:'CTE',criadoEm:'2026-06-01T00:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas }); // sem comStatusLabels — 99 não foi carregado
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const caixas=[...document.querySelectorAll('[data-indic-painel="status"]')].map(el=>el.dataset.indicPainelValor);
  assert.deepEqual(caixas,['CTE']);
});

test('sem nenhuma nota com Ação/Status preenchido, o painel correspondente nem aparece na tela (nunca mostra painel vazio)',async()=>{
  const recusas=mockColecao([{id:'r1',data:{notas:[],criadoEm:'2026-06-01T00:00:00.000Z'}}]); // sem tratamento nem statusRetorno definidos
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ tratamentoLabels:{} });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  // "Não classificado"/"Aguard. Monitoramento" ainda são valores REAIS
  // (o registro existe, só não foi classificado ainda) — o painel some
  // só quando não há NENHUM registro, não quando o valor está vazio.
  assert.equal(document.querySelectorAll('[data-indic-painel="tratamento"]').length,1);
});

test('PEDIDO AO VIVO: marcar uma caixa no painel de Ação filtra os KPIs e os OUTROS gráficos (mercado/vendedor/etc.), sem virar gráfico ela mesma',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado 1',valorTotal:100}},
    {id:'B',data:{chave:'B',destinatario:'Mercado 2',valorTotal:200}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],tratamento:'RECUSA',pallets:1,criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r2',data:{notas:[{chave:'B'}],tratamento:'DEVOLUCAO',pallets:4,criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa', DEVOLUCAO:'Devolução' } });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  let html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Mercado 1/); assert.match(html,/Mercado 2/);

  const caixaRecusa=[...document.querySelectorAll('[data-indic-painel="tratamento"]')].find(el=>el.dataset.indicPainelValor==='Recusa');
  assert.ok(caixaRecusa,'a caixa de Recusa precisa existir no painel');
  caixaRecusa.checked=true;
  caixaRecusa.dispatchEvent(new win.Event('change',{bubbles:true}));

  html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Mercado 1/);
  assert.doesNotMatch(html,/Mercado 2/,'mercado da outra ação some dos OUTROS gráficos depois de marcar o painel');
  const k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(k.totalRetornos,1);
  assert.equal(k.somaPallets,1);

  // desmarcar volta a mostrar tudo — precisa reconsultar o checkbox: o
  // re-render trocou pagina.innerHTML, então o nó antigo (caixaRecusa) já
  // não está mais no documento e um evento disparado nele não bubble mais
  // pro listener delegado.
  const caixaRecusaDeNovo=[...document.querySelectorAll('[data-indic-painel="tratamento"]')].find(el=>el.dataset.indicPainelValor==='Recusa');
  caixaRecusaDeNovo.checked=false;
  caixaRecusaDeNovo.dispatchEvent(new win.Event('change',{bubbles:true}));
  html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Mercado 2/);
});

test('PEDIDO AO VIVO: marcar DUAS caixas no mesmo painel usa OU entre elas (mesmo comportamento do slicer real, mode:"Basic")',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado 1'}},
    {id:'B',data:{chave:'B',destinatario:'Mercado 2'}},
    {id:'C',data:{chave:'C',destinatario:'Mercado 3'}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],tratamento:'RECUSA',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r2',data:{notas:[{chave:'B'}],tratamento:'DEVOLUCAO',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r3',data:{notas:[{chave:'C'}],tratamento:'PENDENTE',criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa', DEVOLUCAO:'Devolução', PENDENTE:'Pendente' } });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  win._recebimentoRetornosIndicadoresInternals.setFiltroAcao(['Recusa','Pendente']);
  const k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(k.totalRetornos,2,'Recusa OU Pendente — Devolução fica de fora');
});

test('botão "limpar" do painel remove só o filtro DAQUELE painel — o outro continua ativo',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado Recusa Finalizada'}},
    {id:'B',data:{chave:'B',destinatario:'Mercado Devolução Finalizada'}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],tratamento:'RECUSA',statusRetorno:'FINALIZADO',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r2',data:{notas:[{chave:'B'}],tratamento:'DEVOLUCAO',statusRetorno:'FINALIZADO',criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa', DEVOLUCAO:'Devolução' }, comStatusLabels:true });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));

  const marcar=(dim,valor)=>{
    const el=[...document.querySelectorAll(`[data-indic-painel="${dim}"]`)].find(x=>x.dataset.indicPainelValor===valor);
    el.checked=true; el.dispatchEvent(new win.Event('change',{bubbles:true}));
  };
  marcar('tratamento','Recusa');
  marcar('status','Finalizado');
  let html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Mercado Recusa Finalizada/);
  assert.doesNotMatch(html,/Mercado Devolução Finalizada/,'os dois painéis combinados (E) já restringem pra só essa nota — a outra é Devolução, não Recusa');

  document.querySelector('[data-indic-painel-limpar="tratamento"]').click();
  html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Mercado Devolução Finalizada/,'limpar SÓ o painel de Ação já traz a nota de Devolução de volta, mesmo com Status="Finalizado" ainda marcado — ela também é Finalizada, só não era Recusa');
});

// PEDIDO AO VIVO (2026-09-08): "cada nota tem que gerar uma linha... se
// ela tiver junta e uma for reentrega e a outra for recusa" — Tratamento/
// Status passaram de campo do documento pra campo de cada nota. Este
// arquivo (98) continua contando EVENTOS pros KPIs de quantidade física
// (não explode em linhas), mas os painéis de Ação/Status agora enxergam
// os dois valores quando as notas do mesmo evento divergem.
test('PEDIDO AO VIVO: evento com 2 notas de Tratamento diferente conta nas DUAS barras do painel de Ação (mesmo evento contribui pros dois)',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[
      {chave:'CH1',tratamento:'RECUSA'},
      {chave:'CH2',tratamento:'REENTREGA'},
    ],criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa', REENTREGA:'Reentrega' } });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const caixas=[...document.querySelectorAll('[data-indic-painel="tratamento"]')].map(el=>el.dataset.indicPainelValor);
  assert.deepEqual(caixas.sort(),['Recusa','Reentrega'].sort(),'as 2 classificações do mesmo evento aparecem, cada uma vinda de uma nota diferente');
});

test('PEDIDO AO VIVO: filtrar pelo painel de Ação por "Recusa" mantém o evento mesmo se OUTRA nota dele for Reentrega (evento passa se QUALQUER nota bater)',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[
      {chave:'CH1',tratamento:'RECUSA'},
      {chave:'CH2',tratamento:'REENTREGA'},
    ],motoristaNome:'Motorista Misto',criadoEm:'2026-06-01T00:00:00.000Z'}},
    {id:'r2',data:{notas:[{chave:'CH3',tratamento:'DEVOLUCAO'}],motoristaNome:'Motorista Só Devolução',criadoEm:'2026-06-01T00:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa', REENTREGA:'Reentrega', DEVOLUCAO:'Devolução' } });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const chk=[...document.querySelectorAll('[data-indic-painel="tratamento"]')].find(el=>el.dataset.indicPainelValor==='Recusa');
  chk.checked=true; chk.dispatchEvent(new win.Event('change',{bubbles:true}));
  const html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Motorista Misto/);
  assert.doesNotMatch(html,/Motorista Só Devolução/);
});

test('registro antigo (1 nota só) com tratamento gravado no DOCUMENTO — o painel de Ação continua enxergando através do valor herdado pela nota',async()=>{
  const recusas=mockColecao([{id:'r1',data:{tratamento:'RECUSA',notas:[{chave:'CH1'}],criadoEm:'2026-06-01T00:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa' } });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const caixas=[...document.querySelectorAll('[data-indic-painel="tratamento"]')].map(el=>el.dataset.indicPainelValor);
  assert.deepEqual(caixas,['Recusa']);
});

// PEDIDO AO VIVO (2026-09-08): "a soma MÉDIA DE DIAS P/ FINALIZAR vai ser
// a partir de quando colocar o STATUS em ENDEREÇANDO" — substitui o proxy
// antigo (emissão da NF → registro da volta) pela métrica real: Endereçando
// → Finalizado (ou até agora, se ainda não finalizou), usando o status POR
// NOTA (ver 97/99/103).
test('diasParaFinalizarDaRecusa: conta de dataDoEnderecamentoEm até o evento FINALIZADO do histórico da nota',async()=>{
  const { win }=carregarPagina({});
  const r = { notas: [{ chave:'CH1', dataDoEnderecamentoEm:'2026-08-01T00:00:00.000Z', statusRetornoHistorico:[
    { status:'ENDERECANDO', em:'2026-08-01T00:00:00.000Z' },
    { status:'FINALIZADO', em:'2026-08-04T00:00:00.000Z' },
  ] }] };
  const dias = win._recebimentoRetornosIndicadoresInternals.diasParaFinalizarDaRecusa(r);
  assert.equal(Math.round(dias), 3);
});

test('diasParaFinalizarDaRecusa: nota que nunca chegou em Endereçando não entra na média (nunca inventa data)',async()=>{
  const { win }=carregarPagina({});
  const r = { notas: [{ chave:'CH1', statusRetorno:'AGUARD_FISCAL' }] };
  assert.equal(win._recebimentoRetornosIndicadoresInternals.diasParaFinalizarDaRecusa(r), null);
});

test('diasParaFinalizarDaRecusa: ainda não finalizada conta até AGORA (não fica parada em null)',async()=>{
  const { win }=carregarPagina({});
  const tresDiasAtras = new Date(Date.now() - 3*86400000).toISOString();
  const r = { notas: [{ chave:'CH1', dataDoEnderecamentoEm: tresDiasAtras, statusRetornoHistorico:[{ status:'ENDERECANDO', em: tresDiasAtras }] }] };
  const dias = win._recebimentoRetornosIndicadoresInternals.diasParaFinalizarDaRecusa(r);
  assert.ok(dias > 2.9, 'ainda em aberto — conta até agora, não some da média');
});

test('registro antigo (1 nota só) com dataDoEnderecamentoEm/statusRetornoHistorico gravados no DOCUMENTO — a métrica continua funcionando através do valor herdado',async()=>{
  const { win }=carregarPagina({});
  const r = { dataDoEnderecamentoEm:'2026-08-01T00:00:00.000Z', statusRetornoHistorico:[{ status:'FINALIZADO', em:'2026-08-03T00:00:00.000Z' }], notas:[{ chave:'CH1' }] };
  const dias = win._recebimentoRetornosIndicadoresInternals.diasParaFinalizarDaRecusa(r);
  assert.equal(Math.round(dias), 2);
});

test('KPI "MÉDIA DE DIAS P/ FINALIZAR" na tela usa a nova métrica (Endereçando → Finalizado)',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A',dataDoEnderecamentoEm:'2026-08-01T00:00:00.000Z',statusRetornoHistorico:[{status:'FINALIZADO',em:'2026-08-05T00:00:00.000Z'}]}],criadoEm:'2026-08-01T00:00:00.000Z'}},
  ]);
  const { win }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  win.document.getElementById('indic-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  const k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(Math.round(k.mediaDias), 4);
});
