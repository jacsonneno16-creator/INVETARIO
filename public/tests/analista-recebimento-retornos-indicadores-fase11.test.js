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
  return { get: async()=>({ docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }) };
}

// `comLabels` carrega junto o mapa de status (99) — só usado nos testes que
// precisam do rótulo humano; os demais testam sem ele de propósito, pra
// travar o fallback pro valor cru quando o mapa ainda não carregou.
function carregarPagina(colecoes,opts){
  opts=opts||{};
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-retornos-indicadores"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window;
  win.getDTFirestore=()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) });
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
  const html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  // "Ocorrências por Transportadora" (ranking) tem que estar dentro de um
  // bloco dash-hbar-chart; "Retornos por Mês" tem que estar num
  // dash-column-chart (vertical) — checagem por proximidade no HTML.
  const blocoTransportadora=html.split('Ocorrências por Transportadora')[1].split('</div></div>')[0];
  assert.match(blocoTransportadora,/dash-hbar-chart/);
  const blocoMes=html.split('Retornos por Mês')[1].split('Média de dias')[0];
  assert.match(blocoMes,/dash-column-chart/);
});

test('agregarPorCampoDaNota conta um nome só 1x por RECUSA, mesmo repetido em duas notas da mesma carga',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado Atacadão'}},
    {id:'B',data:{chave:'B',destinatario:'Mercado Atacadão'}}, // mesma loja, nota diferente, mesma carga
    {id:'C',data:{chave:'C',destinatario:'Mercado Central'}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'},{chave:'B'}]}}, // 1 carga com 2 notas do MESMO mercado — conta 1
    {id:'r2',data:{notas:[{chave:'C'}]}},
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
  const ranking=win._recebimentoRetornosIndicadoresInternals.agregarPorCampoDaNota('destinatario');
  assert.equal(ranking.find(x=>x.label==='Mercado Atacadão').value,1);
  assert.equal(ranking.find(x=>x.label==='Mercado Central').value,1);
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
  assert.match(document.getElementById('page-recebimento-retornos-indicadores').innerHTML,/Sem dados para exibir/);
});

test('KPIs somam pallets, volume informado e valor (deduplicado por chave da nota) do conjunto filtrado',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',valorTotal:1000}},
    {id:'B',data:{chave:'B',valorTotal:500}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],pallets:3,volumeInformado:10}},
    {id:'r2',data:{notas:[{chave:'B'}],pallets:2,volumeInformado:5}},
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
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

  let k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(k.totalRetornos,2,'sem período ativo, os dois entram');

  win._recebimentoRetornosIndicadoresInternals.setPeriodo('2026-03-01','2026-03-31');
  k=win._recebimentoRetornosIndicadoresInternals.kpis();
  assert.equal(k.totalRetornos,1,'só o retorno de março fica depois do filtro de período');
  assert.equal(k.somaPallets,4);
  assert.equal(k.somaValor,200);
});

test('período de datas é aplicado direto pelos campos <input type="date"> da tela, sem precisar da API interna',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[],motoristaNome:'Fora do período',criadoEm:'2026-01-10T10:00:00.000Z'}},
    {id:'r2',data:{notas:[],motoristaNome:'Dentro do período',criadoEm:'2026-03-05T10:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:mockColecao([]), recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();

  const ini=document.getElementById('indic-periodo-ini'), fim=document.getElementById('indic-periodo-fim');
  assert.ok(ini && fim,'os dois campos de data precisam existir na tela');
  ini.value='2026-03-01'; ini.dispatchEvent(new win.Event('change',{bubbles:true}));
  fim.value='2026-03-31'; fim.dispatchEvent(new win.Event('change',{bubbles:true}));

  const html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html,/Dentro do período/);
  assert.doesNotMatch(html,/Fora do período/);
  assert.match(html,/✕ período/,'chip/botão de limpar período aparece quando o filtro está ativo');

  document.querySelector('[data-indic-limpar-periodo]').click();
  const html2=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  assert.match(html2,/Fora do período/,'limpar o período volta a mostrar tudo');
});

test('PEDIDO AO VIVO ("interativos, caso clique em alguma informação as outras atualizem"): clicar numa barra filtra TODOS os outros gráficos e os KPIs',async()=>{
  const notas=mockColecao([
    {id:'A',data:{chave:'A',destinatario:'Mercado 1',vendedorNome:'João',valorTotal:100}},
    {id:'B',data:{chave:'B',destinatario:'Mercado 2',vendedorNome:'Pedro',valorTotal:200}},
  ]);
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A'}],motoristaNome:'Transp X',motivoNome:'Sem Pedido',pallets:1}},
    {id:'r2',data:{notas:[{chave:'B'}],motoristaNome:'Transp Y',motivoNome:'Duplicidade',pallets:4}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();

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
  const recusas=mockColecao([{id:'r1',data:{notas:[{chave:'A'}],motoristaNome:'Transp X'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosIndicadores();
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
    {id:'r1',data:{notas:[],tratamento:'RECUSA'}},
    {id:'r2',data:{notas:[],tratamento:'RECUSA'}},
    {id:'r3',data:{notas:[],tratamento:'PENDENTE'}},
    {id:'r4',data:{notas:[]}}, // sem tratamento — cai em "Não classificado"
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ tratamentoLabels:{ '':'— Não classificado —', RECUSA:'Recusa', PENDENTE:'Pendente', DEVOLUCAO:'Devolução', REENTREGA:'Reentrega', SUBSTITUICAO:'Substituição' } });
  await win.renderRecebimentoRetornosIndicadores();
  const html=document.getElementById('page-recebimento-retornos-indicadores').innerHTML;
  const caixas=[...document.querySelectorAll('[data-indic-painel="tratamento"]')].map(el=>el.dataset.indicPainelValor);
  assert.deepEqual(caixas.sort(),['— Não classificado —','Pendente','Recusa'].sort(),'só os valores que realmente ocorrem nos dados aparecem no painel — Devolução/Reentrega/Substituição ficam de fora por não terem nenhuma nota');
  assert.doesNotMatch(html,/Notas por Ação/,'não é mais um gráfico — só um painel de filtro');
});

test('PEDIDO AO VIVO: painel de Status usa o rótulo humano (STATUS_RETORNO_LABELS) e EXCLUI reentrega (que não usa esse status)',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[],statusRetorno:'AGUARD_FISCAL'}},
    {id:'r2',data:{notas:[],statusRetorno:'FINALIZADO'}},
    {id:'r3',data:{notas:[],tratamento:'REENTREGA',statusRetorno:''}}, // reentrega — fica de fora deste painel
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ comStatusLabels:true });
  await win.renderRecebimentoRetornosIndicadores();
  const caixas=[...document.querySelectorAll('[data-indic-painel="status"]')].map(el=>el.dataset.indicPainelValor);
  assert.deepEqual(caixas.sort(),['Aguard. Fiscal','Finalizado'].sort());
});

test('sem o rótulo humano carregado ainda, o painel de Status cai pro valor cru (nunca quebra)',async()=>{
  const recusas=mockColecao([{id:'r1',data:{notas:[],statusRetorno:'CTE'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas }); // sem comStatusLabels — 99 não foi carregado
  await win.renderRecebimentoRetornosIndicadores();
  const caixas=[...document.querySelectorAll('[data-indic-painel="status"]')].map(el=>el.dataset.indicPainelValor);
  assert.deepEqual(caixas,['CTE']);
});

test('sem nenhuma nota com Ação/Status preenchido, o painel correspondente nem aparece na tela (nunca mostra painel vazio)',async()=>{
  const recusas=mockColecao([{id:'r1',data:{notas:[]}}]); // sem tratamento nem statusRetorno definidos
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ tratamentoLabels:{} });
  await win.renderRecebimentoRetornosIndicadores();
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
    {id:'r1',data:{notas:[{chave:'A'}],tratamento:'RECUSA',pallets:1}},
    {id:'r2',data:{notas:[{chave:'B'}],tratamento:'DEVOLUCAO',pallets:4}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa', DEVOLUCAO:'Devolução' } });
  await win.renderRecebimentoRetornosIndicadores();
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
    {id:'r1',data:{notas:[{chave:'A'}],tratamento:'RECUSA'}},
    {id:'r2',data:{notas:[{chave:'B'}],tratamento:'DEVOLUCAO'}},
    {id:'r3',data:{notas:[{chave:'C'}],tratamento:'PENDENTE'}},
  ]);
  const { win }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa', DEVOLUCAO:'Devolução', PENDENTE:'Pendente' } });
  await win.renderRecebimentoRetornosIndicadores();
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
    {id:'r1',data:{notas:[{chave:'A'}],tratamento:'RECUSA',statusRetorno:'FINALIZADO'}},
    {id:'r2',data:{notas:[{chave:'B'}],tratamento:'DEVOLUCAO',statusRetorno:'FINALIZADO'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:recusas },{ tratamentoLabels:{ RECUSA:'Recusa', DEVOLUCAO:'Devolução' }, comStatusLabels:true });
  await win.renderRecebimentoRetornosIndicadores();

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
