// FASE 12: "Status de Retornos" — REESCRITO 2026-08-20 depois que o usuário
// mandou a planilha real de controle ("CONTROLE DE REENTREGAS E
// RECUSAS.xlsx") que a equipe já usa, pra validar contra o que tinha sido
// construído. Mudanças principais: status agora é seleção LIVRE, sem ordem
// forçada — "nem toda vez para em CTE, às vezes fica parado com fiscal".
//
// CORRIGIDO 2026-08-21 — a 1ª rodada de validação (2026-08-20) só olhou as
// primeiras linhas da planilha e saiu errada em 3 pontos, achados ao
// estudar de novo com números reais (~750 registros): faltava o status
// AGUARD_FISCAL (2º mais usado, 46 casos reais) e EM_TRATATIVA; faltava a
// 4ª data nomeada "dataSolicitacaoFiscalEm" (a métrica real "dias parado no
// fiscal/CTE" usa Solicitada→Recusa, não Liberou→Recusa); e o status OK
// (18 casos reais, todos SEM nenhuma data preenchida) tinha sido carimbado
// com liberadoParaRecusarEm por engano — confirmado com o usuário que OK é
// um atalho sem burocracia, não carimba nada.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const indicCode=fs.readFileSync(path.join(base,'98-recebimento-retornos-indicadores.js'),'utf8');
const statusCode=fs.readFileSync(path.join(base,'99-recebimento-retornos-status.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return {
    get: async()=>({ docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    doc:(id)=>({
      id,
      update: async(payload)=>{ const a=registro.get(id)||{}; registro.set(id,{...a,...payload}); },
    }),
    _registro: registro,
  };
}

function carregarPagina(colecoes,opts){
  opts=opts||{};
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-retornos-status"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window;
  win.getDTFirestore=()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) });
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }) };
  win.showToast=()=>{};
  if (opts.temPermissao) win.temPermissao=opts.temPermissao;
  win.eval(indicCode); // dashHorizontalBarChart, usado pelo dashboard de tempos
  win.eval(statusCode);
  return { win, document: win.document };
}

test('PEDIDO AO VIVO ("nem toda vez para em CTE, às vezes fica parado com fiscal"): status é seleção LIVRE — dá pra pular direto pra Endereçando sem passar por CTE',async()=>{
  const recusas=mockColecao([{id:'r1',data:{notas:[{chave:'A',numeroNota:'1'}],criadoEm:'2026-08-01T08:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosStatus();

  const select=document.querySelector('[data-status-mudar]');
  assert.ok(select,'o status precisa ser um <select> de escolha livre, não um botão de próximo passo');
  const valores=[...select.options].map(o=>o.value);
  assert.deepEqual(valores,['','AGUARD_FISCAL','EM_TRATATIVA','OK','CTE','ENDERECANDO','FINALIZADO']);

  select.value='ENDERECANDO';
  select.dispatchEvent(new win.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,0));

  const doc=recusas._registro.get('r1');
  assert.equal(doc.notas[0].statusRetorno,'ENDERECANDO','pulou CTE de propósito — tem que ser aceito sem exigir passar por ele antes');
  assert.equal(doc.notas[0].statusRetornoHistorico.length,1);
});

test('as 4 datas nomeadas (liberadoParaRecusarEm/dataSolicitacaoFiscalEm/dataDaRecusaEm/dataDoEnderecamentoEm) são gravadas na 1ª vez que o status entra nesse valor, e NUNCA sobrescritas depois — mesmo voltando pra trás',async()=>{
  const recusas=mockColecao([{id:'r1',data:{notas:[],criadoEm:'2026-08-01T08:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosStatus();

  const mudar=async(valor)=>{
    const select=document.querySelector('[data-status-mudar]');
    select.value=valor; select.dispatchEvent(new win.Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,0));
  };
  // começa em '' (Aguard. Monitoramento) — pula direto pro fiscal.
  await mudar('AGUARD_FISCAL');
  const doc1=recusas._registro.get('r1');
  assert.ok(doc1.notas[0].dataSolicitacaoFiscalEm,'entrar em Aguard. Fiscal grava dataSolicitacaoFiscalEm');
  assert.ok(!doc1.notas[0].liberadoParaRecusarEm,'pulou o "Aguard. Monitoramento" de propósito — não grava a data dele');
  const solicitadaOriginal=doc1.notas[0].dataSolicitacaoFiscalEm;

  await mudar(''); // volta pra "Aguard. Monitoramento"
  const doc2=recusas._registro.get('r1');
  assert.ok(doc2.notas[0].liberadoParaRecusarEm,'entrar em Aguard. Monitoramento grava liberadoParaRecusarEm');

  await mudar('AGUARD_FISCAL'); // e entra em Aguard. Fiscal de novo
  const doc3=recusas._registro.get('r1');
  assert.equal(doc3.notas[0].dataSolicitacaoFiscalEm,solicitadaOriginal,'nunca regrava a data — a 1ª vez é a que vale, mesmo voltando e entrando de novo');

  await mudar('CTE');
  const doc4=recusas._registro.get('r1');
  assert.ok(doc4.notas[0].dataDaRecusaEm,'entrar em CTE grava dataDaRecusaEm');

  await mudar('ENDERECANDO');
  const doc5=recusas._registro.get('r1');
  assert.ok(doc5.notas[0].dataDoEnderecamentoEm,'entrar em Endereçando grava dataDoEnderecamentoEm');
  assert.equal(doc5.notas[0].statusRetornoHistorico.length,5,'todo clique conta no histórico, inclusive o "voltar pra trás"');
});

// BUG AO VIVO CORRIGIDO 2026-08-21: a 1ª versão carimbava liberadoParaRecusarEm
// quando o status entrava em OK — errado. Confirmado com o usuário: OK é um
// atalho SEM burocracia (a nota nem passa pelo fiscal/CTE), 18 casos reais
// na planilha, todos sem NENHUMA data preenchida.
test('status OK (e Em tratativa) nunca carimbam nenhuma das 4 datas nomeadas — são atalhos sem data associada',async()=>{
  const recusas=mockColecao([{id:'r1',data:{notas:[],criadoEm:'2026-08-01T08:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosStatus();
  const mudar=async(valor)=>{
    const select=document.querySelector('[data-status-mudar]');
    select.value=valor; select.dispatchEvent(new win.Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,0));
  };
  await mudar('OK');
  let doc=recusas._registro.get('r1');
  assert.ok(!doc.notas[0].liberadoParaRecusarEm && !doc.notas[0].dataSolicitacaoFiscalEm && !doc.notas[0].dataDaRecusaEm && !doc.notas[0].dataDoEnderecamentoEm, 'OK não carimba nenhuma data');

  await mudar('EM_TRATATIVA');
  doc=recusas._registro.get('r1');
  assert.ok(!doc.notas[0].liberadoParaRecusarEm && !doc.notas[0].dataSolicitacaoFiscalEm && !doc.notas[0].dataDaRecusaEm && !doc.notas[0].dataDoEnderecamentoEm, 'Em tratativa também não carimba nenhuma data');
});

test('diasParadoFiscalCte e diasOperacao são calculados a partir das datas nomeadas, contando até AGORA quando ainda em aberto',()=>{
  const { win }=carregarPagina({});
  const internals=win._recebimentoRetornosStatusInternals;
  const agora=new Date();
  const doisDiasAtras=new Date(agora.getTime()-2*86400000).toISOString();
  // dataSolicitacaoFiscalEm→dataDaRecusaEm (não liberadoParaRecusarEm→
  // dataDaRecusaEm — CONFIRMADO contra os números reais da planilha
  // linha a linha: usar "liberou" no lugar de "solicitou" dá um valor
  // diferente do real).
  const r={ criadoEm:'2026-08-01T08:00:00.000Z', liberadoParaRecusarEm:'2026-08-01T12:00:00.000Z', dataSolicitacaoFiscalEm:'2026-08-02T08:00:00.000Z', dataDaRecusaEm:'2026-08-04T08:00:00.000Z', dataDoEnderecamentoEm:'2026-08-05T08:00:00.000Z' };
  assert.equal(Math.round(internals.diasParadoFiscalCte(r)),2,'02/08 (solicitada) até 04/08 (recusa) = 2 dias parado no fiscal/CTE');
  assert.equal(Math.round(internals.diasOperacao(r)),4,'01/08 (chegada) até 05/08 (endereçamento) = 4 dias de operação');

  const rAindaAberto={ criadoEm:doisDiasAtras };
  assert.ok(internals.diasOperacao(rAindaAberto)>1.9,'sem endereçamento ainda, conta até agora — não fica null pra sempre');
});

test('PEDIDO AO VIVO (planilha real: "Reentrega é diferente"): nota de Reentrega mostra Data Programada/Data de Saída em vez do status de fiscal/CTE, com "dias parado" próprio',async()=>{
  const recusas=mockColecao([{id:'r1',data:{notas:[{chave:'A',numeroNota:'1'}],tratamento:'REENTREGA',criadoEm:'2026-08-01T08:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosStatus();

  assert.equal(document.querySelector('[data-status-mudar]'),null,'reentrega não usa o status de fiscal/CTE');
  const inputProgramada=document.querySelector('[data-reentrega-data$=":dataProgramadaEm"]');
  const inputSaida=document.querySelector('[data-reentrega-data$=":dataSaidaEm"]');
  assert.ok(inputProgramada && inputSaida,'os dois campos de data de reentrega precisam aparecer');

  inputSaida.value='2026-08-03';
  inputSaida.dispatchEvent(new win.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,0));

  const doc=recusas._registro.get('r1');
  assert.ok(doc.notas[0].dataSaidaEm,'data de saída da reentrega foi salva');
  const internals=win._recebimentoRetornosStatusInternals;
  assert.equal(Math.round(internals.diasParadoReentrega({ criadoEm: doc.criadoEm, dataSaidaEm: doc.notas[0].dataSaidaEm })),2,'01/08 até 03/08 = 2 dias parado (reentrega)');
});

test('KPIs contam por status e calculam a média das 2 métricas reais (dias parado no fiscal/CTE e dias de operação) só das notas que NÃO são reentrega',async()=>{
  // r1 e r2 totalmente resolvidos (as 2 pontas de cada data preenchidas) —
  // dá pra conferir a média exata sem depender de "agora" (não-determinístico
  // em teste — uma nota ainda em aberto conta até agora, de propósito, mas
  // isso já foi coberto no teste de diasParadoFiscalCte/diasOperacao
  // isoladamente). r4 é reentrega — nunca deveria entrar nessas 2 médias.
  const recusas=mockColecao([
    {id:'r1',data:{notas:[],statusRetorno:'FINALIZADO',criadoEm:'2026-08-01T08:00:00.000Z',dataSolicitacaoFiscalEm:'2026-08-01T08:00:00.000Z',dataDaRecusaEm:'2026-08-02T08:00:00.000Z',dataDoEnderecamentoEm:'2026-08-03T08:00:00.000Z'}}, // 1 dia parado, 2 dias operação
    {id:'r2',data:{notas:[],statusRetorno:'FINALIZADO',criadoEm:'2026-08-01T08:00:00.000Z',dataSolicitacaoFiscalEm:'2026-08-01T08:00:00.000Z',dataDaRecusaEm:'2026-08-04T08:00:00.000Z',dataDoEnderecamentoEm:'2026-08-06T08:00:00.000Z'}}, // 3 dias parado, 5 dias operação
    {id:'r4',data:{notas:[],statusRetorno:'',tratamento:'REENTREGA',criadoEm:'2026-08-01T08:00:00.000Z'}}, // reentrega não conta nas médias de fiscal/CTE
  ]);
  const { win }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosStatus();
  const k=win._recebimentoRetornosStatusInternals.kpis();
  assert.equal(k.total,3);
  assert.equal(k.emAberto,1,'r1 e r2 já finalizados; r4 (reentrega) ainda em aberto');
  assert.equal(k.mediaDiasParadoFiscalCte,2,'média de 1 e 3 dias parado (r1/r2) = 2');
  assert.equal(k.mediaDiasOperacao,3.5,'média de 2 e 5 dias de operação (r1/r2) = 3.5');
});

test('PEDIDO AO VIVO: sem permissão de editar, o status vira só um badge (não dá pra mudar), e os campos de reentrega ficam desabilitados',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[],criadoEm:'2026-08-01T08:00:00.000Z'}},
    {id:'r2',data:{notas:[],tratamento:'REENTREGA',criadoEm:'2026-08-01T08:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas },{ temPermissao:(modulo,acao)=> !(modulo==='recebimento-recusas' && acao==='editar') });
  await win.renderRecebimentoRetornosStatus();
  assert.equal(document.querySelector('[data-status-mudar]'),null,'sem permissão, não aparece select — só o badge');
  assert.match(document.getElementById('page-recebimento-retornos-status').innerHTML,/Aguard\. Monitoramento/);
  const inputs=document.querySelectorAll('[data-reentrega-data]');
  assert.ok(inputs.length>0 && [...inputs].every(i=>i.disabled),'campos de data de reentrega ficam desabilitados sem permissão');
});

test('filtro de status "Em aberto" esconde finalizados, filtro de Tratamento isola Reentrega, e filtro de período restringe por criadoEm',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[],motoristaNome:'Aberto',statusRetorno:'CTE',criadoEm:'2026-08-05T08:00:00.000Z'}},
    {id:'r2',data:{notas:[],motoristaNome:'Ja Finalizado',statusRetorno:'FINALIZADO',criadoEm:'2026-08-05T08:00:00.000Z'}},
    {id:'r3',data:{notas:[],motoristaNome:'Nota Reentrega',tratamento:'REENTREGA',criadoEm:'2026-08-05T08:00:00.000Z'}},
    {id:'r4',data:{notas:[],motoristaNome:'Fora Do Periodo',criadoEm:'2026-01-01T08:00:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosStatus();

  document.getElementById('status-filtro-status').value='ABERTOS';
  document.getElementById('status-filtro-status').dispatchEvent(new win.Event('change',{bubbles:true}));
  let html=document.getElementById('page-recebimento-retornos-status').innerHTML;
  assert.match(html,/Aberto/); assert.match(html,/Nota Reentrega/);
  assert.doesNotMatch(html,/Ja Finalizado/);

  document.getElementById('status-filtro-status').value='';
  document.getElementById('status-filtro-status').dispatchEvent(new win.Event('change',{bubbles:true}));
  document.getElementById('status-filtro-tratamento').value='REENTREGA';
  document.getElementById('status-filtro-tratamento').dispatchEvent(new win.Event('change',{bubbles:true}));
  html=document.getElementById('page-recebimento-retornos-status').innerHTML;
  assert.match(html,/Nota Reentrega/);
  assert.doesNotMatch(html,/Ja Finalizado/); assert.doesNotMatch(html,/>Aberto</);

  document.getElementById('status-filtro-tratamento').value='';
  document.getElementById('status-filtro-tratamento').dispatchEvent(new win.Event('change',{bubbles:true}));
  document.getElementById('status-periodo-ini').value='2026-08-01';
  document.getElementById('status-periodo-ini').dispatchEvent(new win.Event('change',{bubbles:true}));
  html=document.getElementById('page-recebimento-retornos-status').innerHTML;
  assert.doesNotMatch(html,/Fora Do Periodo/);
});

test('sem nenhum retorno registrado, mostra "Nenhum retorno" em vez de tabela quebrada',async()=>{
  const { win, document }=carregarPagina({});
  await win.renderRecebimentoRetornosStatus();
  assert.match(document.getElementById('page-recebimento-retornos-status').innerHTML,/Nenhum retorno com esses filtros/);
});

// TRAVA DE REGRESSÃO 2026-08-21 — o catálogo real de status (aba "BASE" da
// planilha, coluna B) tem 6 valores + blank; documenta o mapeamento
// status→campo de data exatamente como confirmado contra os dados reais,
// pra qualquer mudança futura precisar alterar este teste de propósito.
test('TRAVA DE REGRESSÃO: catálogo de status e mapeamento status→data batem com o confirmado contra a planilha real',()=>{
  const { win }=carregarPagina({});
  const { STATUS_RETORNO_LABELS, DATA_POR_STATUS }=win._recebimentoRetornosStatusInternals;
  assert.deepEqual(Object.keys(STATUS_RETORNO_LABELS),['','AGUARD_FISCAL','EM_TRATATIVA','OK','CTE','ENDERECANDO','FINALIZADO']);
  // objeto veio de win.eval (outro realm) — deepStrictEqual falharia por
  // prototype diferente mesmo com o mesmo conteúdo; compara via JSON.
  assert.equal(JSON.stringify(DATA_POR_STATUS),JSON.stringify({ '':'liberadoParaRecusarEm', AGUARD_FISCAL:'dataSolicitacaoFiscalEm', CTE:'dataDaRecusaEm', ENDERECANDO:'dataDoEnderecamentoEm' }));
});

test('PEDIDO AO VIVO: filtro de Tratamento inclui "Pendente" (planilha real: 120 casos — carga com pendência tipo canhoto faltando, mesmo fluxo/telas)',async()=>{
  const { win, document }=carregarPagina({});
  await win.renderRecebimentoRetornosStatus();
  const select=document.getElementById('status-filtro-tratamento');
  const valores=[...select.options].map(o=>o.value);
  assert.ok(valores.includes('PENDENTE'),'Pendente precisa aparecer como opção de tratamento');
});

// PEDIDO AO VIVO (2026-09-08): "cada nota tem que gerar uma linha... se
// ela tiver junta e uma for reentrega e a outra for recusa" — Status
// passou de campo do documento pra campo de cada item de `notas[]`.
test('2 notas do mesmo evento progridem de status de forma INDEPENDENTE — mudar uma não mexe na outra',async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 1',criadoEm:'2026-08-01T08:00:00.000Z',notas:[
    { chave:'CH1', numeroNota:'601' },
    { chave:'CH2', numeroNota:'602' },
  ]}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosStatus();

  const selectCH1=document.querySelector('[data-status-mudar="r1|CH1"]');
  const selectCH2=document.querySelector('[data-status-mudar="r1|CH2"]');
  assert.ok(selectCH1 && selectCH2,'cada nota precisa da sua própria linha/select de status');

  selectCH1.value='CTE'; selectCH1.dispatchEvent(new win.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,0));

  const doc=recusas._registro.get('r1');
  const n1=doc.notas.find(n=>n.chave==='CH1'), n2=doc.notas.find(n=>n.chave==='CH2');
  assert.equal(n1.statusRetorno,'CTE');
  assert.equal(n2.statusRetorno,undefined,'a outra nota do mesmo evento não pode ter sido alterada junto');
});

test('registro antigo (1 nota só) com statusRetorno/datas gravados no DOCUMENTO — a tela mostra e edita através da nota, herdando o valor antigo em vez de perder o histórico',async()=>{
  const recusas=mockColecao([{id:'r1',data:{
    box:'BOX 1', criadoEm:'2026-08-01T08:00:00.000Z',
    statusRetorno:'AGUARD_FISCAL', dataSolicitacaoFiscalEm:'2026-08-02T08:00:00.000Z',
    statusRetornoHistorico:[{status:'AGUARD_FISCAL',em:'2026-08-02T08:00:00.000Z',por:'analista@daterrinha.com'}],
    notas:[{ chave:'CH1', numeroNota:'1' }],
  }}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas });
  await win.renderRecebimentoRetornosStatus();
  const select=document.querySelector('[data-status-mudar="r1|CH1"]');
  assert.equal(select.value,'AGUARD_FISCAL','herda o status do documento antigo enquanto a nota não tiver o próprio');

  // Avança pra CTE — a data nomeada de AGUARD_FISCAL (dataSolicitacaoFiscalEm)
  // já existia no documento antigo, então não muda; mas o histórico da nota
  // precisa CONTINUAR a partir do histórico antigo do documento, não
  // começar do zero.
  select.value='CTE'; select.dispatchEvent(new win.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,0));

  const doc=recusas._registro.get('r1');
  assert.equal(doc.notas[0].dataSolicitacaoFiscalEm,undefined,'nunca escreve de volta a data herdada do documento — só o valor efetivo de LEITURA herda');
  assert.ok(doc.notas[0].dataDaRecusaEm,'entrar em CTE carimba a data nova, na nota');
  assert.equal(doc.notas[0].statusRetornoHistorico.length,2,'histórico da nota começou a partir do histórico antigo do documento (1) + o evento novo (1)');
  assert.equal(doc.notas[0].statusRetornoHistorico[0].status,'AGUARD_FISCAL','preserva o evento antigo do documento');
});
