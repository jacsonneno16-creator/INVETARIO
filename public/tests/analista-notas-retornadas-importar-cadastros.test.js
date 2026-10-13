// Pedido ao vivo do usuário: subir uma planilha (Veículo/Motorista, Placa,
// Motivo) e cadastrar Motoristas + Motivos de uma vez só, sem duplicar
// quem já existe, guardando a placa também. Mesmo padrão de "ler →
// pré-visualizar → confirmar" já usado pro import de PDF/Bluesoft nesta
// mesma tela.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const recusasCode=fs.readFileSync(path.join(base,'97-recebimento-recusas.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  let seq=0;
  return {
    get: async()=>({ docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    doc:(id)=>({
      id,
      set: async(p)=>{ const a=registro.get(id)||{}; registro.set(id,{...a,...p}); },
    }),
    add: async(payload)=>{ const id='novo'+(seq++); registro.set(id,payload); return {id}; },
    _registro: registro,
    // Usado por _buscarRecusasPeriodo (97-recebimento-recusas.js).
    where(campo, op, valor) {
      const construir = condicoesAtuais => ({
        where: (c2, o2, v2) => construir([...condicoesAtuais, { campo: c2, op: o2, valor: v2 }]),
        get: async () => {
          const bate = data => condicoesAtuais.every(c => {
            const v = data ? data[c.campo] : undefined;
            if (c.op === '>=') return v >= c.valor;
            if (c.op === '<=') return v <= c.valor;
            if (c.op === '==') return v === c.valor;
            return true;
          });
          const filtrados = [...registro.entries()].filter(([, data]) => bate(data));
          return { docs: filtrados.map(([id, data]) => ({ id, data: () => data })) };
        },
      });
      return construir([{ campo, op, valor }]);
    },
  };
}

// Linhas de exemplo (subconjunto da planilha real do pedido), no formato
// array-de-arrays que sheet_to_json({header:1}) devolveria: [Veículo/Motorista, Placa, Motivo]
const LINHAS_PLANILHA=[
  ['Veículo','Placa','Motivo'], // cabeçalho — deve ser pulado
  ['ROTEIRO-CARRETA','AAA1110','RECUSADO PELO CLIENTE'],
  ['ROGERIO APARECIDO','DDA4J00','SEM AGENDAMENTO'],
  ['JOSÉ ANTONIO','ELQ1J17','VALIDADE CURTA'],
];

// buscarBiAutomatico() (97-recebimento-recusas.js) agenda um setInterval de
// auto-refresh a cada render — timer real em jsdom, que precisa ser
// derrubado com window.close() ou o node --test nunca sai sozinho.
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(colecoes){
  // PEDIDO AO VIVO (usuário: "as partes de cadastro da parte de recebimento
  // fazer em um menu só... deixar bem separado e organizado") — a
  // importação em massa por planilha saiu da tela de Notas Retornadas e
  // virou parte da tela própria de Cadastros.
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div><div id="page-recebimento-recusas-cadastros"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  _janelasAbertas.push(win);
  win.getDTFirestore=()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) });
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }) };
  win.showToast=()=>{};
  win.aplicarPermissoesAnalista=()=>{};
  win.XLSX={
    read:()=>({ SheetNames:['Sheet1'], Sheets:{ Sheet1:{} } }),
    utils:{ sheet_to_json:()=>LINHAS_PLANILHA },
  };
  win.eval(recusasCode);
  return { win, document };
}
// PEDIDO AO VIVO (2026-09-17): "o importar motorista pode ficar ali, na
// adicionar — na hora que eu clicar, aparecem as duas opções, importar e
// manual" — a importação por planilha saiu de card próprio sempre visível
// e virou um modo alternativo dentro do card de Motoristas (padrão manual
// por default); precisa clicar no botão "Importar planilha" pra revelar o
// input de arquivo antes de qualquer coisa.
function abrirModoImportar(document){
  document.querySelector('[data-recusa-motorista-modo="importar"]').click();
}
function selecionarArquivoFalso(document){
  const input=document.getElementById('recusas-import-cadastros-arquivo');
  Object.defineProperty(input,'files',{ value:[{ name:'motoristas.xlsx', arrayBuffer: async()=>new ArrayBuffer(0) }], configurable:true });
  return input;
}

test('lê a planilha, pula o cabeçalho e mostra prévia com contagem de motoristas/motivos novos e placas a completar',async()=>{
  const motoristas=mockColecao([{id:'m1',data:{nome:'Rogerio Aparecido',ativo:true}}]); // já existe, SEM placa — a planilha tem a placa dele
  const motivos=mockColecao([]);
  const { win, document }=carregarPagina({ recebimento_recusas_motoristas:motoristas, recebimento_recusas_motivos:motivos, recebimento_recusas_notas:mockColecao([]), recebimento_recusas:mockColecao([]) });
  await win.renderRecebimentoRecusasCadastros();
  abrirModoImportar(document);
  selecionarArquivoFalso(document);
  document.querySelector('[data-recusa-ler-import-cadastros]').click();
  await new Promise(r=>setTimeout(r,0));

  const html=document.getElementById('page-recebimento-recusas-cadastros').innerHTML;
  assert.match(html,/3 linha\(s\) lida/,'cabeçalho não deveria contar como linha de dado');
  assert.match(html,/<b>2<\/b> motorista\(s\) novo\(s\)/); // ROTEIRO-CARRETA e JOSÉ ANTONIO (Rogerio já existe)
  assert.match(html,/<b>3<\/b> motivo\(s\) novo\(s\)/);
  assert.match(html,/<b>1<\/b> placa\(s\) a completar/); // Rogerio já cadastrado, sem placa — a planilha completa
});

test('confirmar a importação grava os motoristas/motivos novos, completa a placa de quem já existia, e nunca duplica',async()=>{
  const motoristas=mockColecao([{id:'m1',data:{nome:'Rogerio Aparecido',ativo:true}}]);
  const motivos=mockColecao([{id:'v1',data:{nome:'Validade curta',ativo:true}}]); // já existe (case-insensitive) — não deve duplicar
  const { win, document }=carregarPagina({ recebimento_recusas_motoristas:motoristas, recebimento_recusas_motivos:motivos, recebimento_recusas_notas:mockColecao([]), recebimento_recusas:mockColecao([]) });
  await win.renderRecebimentoRecusasCadastros();
  abrirModoImportar(document);
  selecionarArquivoFalso(document);
  document.querySelector('[data-recusa-ler-import-cadastros]').click();
  await new Promise(r=>setTimeout(r,0));

  document.querySelector('[data-recusa-salvar-import-cadastros]').click();
  await new Promise(r=>setTimeout(r,0));

  // 2 motoristas novos (ROTEIRO-CARRETA, JOSÉ ANTONIO) + o original = 3 no total
  assert.equal(motoristas._registro.size,3);
  const novos=[...motoristas._registro.values()];
  assert.ok(novos.some(m=>m.nome==='ROTEIRO-CARRETA' && m.placa==='AAA1110'));
  assert.ok(novos.some(m=>m.nome==='JOSÉ ANTONIO' && m.placa==='ELQ1J17'));
  // Rogerio (já existia) ganhou a placa da planilha, sem virar um registro novo
  assert.equal(motoristas._registro.get('m1').placa,'DDA4J00');

  // "VALIDADE CURTA" já existia (case-insensitive) — não duplicou; só os outros 2 motivos novos
  assert.equal(motivos._registro.size,3); // 1 original + RECUSADO PELO CLIENTE + SEM AGENDAMENTO
  const nomesMotivos=[...motivos._registro.values()].map(m=>m.nome);
  assert.ok(nomesMotivos.includes('RECUSADO PELO CLIENTE'));
  assert.ok(nomesMotivos.includes('SEM AGENDAMENTO'));
  assert.equal(nomesMotivos.filter(n=>/validade curta/i.test(n)).length,1,'não duplicou o motivo que já existia');
});

test('planilha sem nada de novo (tudo já cadastrado) mostra mensagem clara em vez do botão de confirmar',async()=>{
  const motoristas=mockColecao([
    {id:'m1',data:{nome:'ROTEIRO-CARRETA',placa:'AAA1110',ativo:true}},
    {id:'m2',data:{nome:'ROGERIO APARECIDO',placa:'DDA4J00',ativo:true}},
    {id:'m3',data:{nome:'JOSÉ ANTONIO',placa:'ELQ1J17',ativo:true}},
  ]);
  const motivos=mockColecao([
    {id:'v1',data:{nome:'RECUSADO PELO CLIENTE',ativo:true}},
    {id:'v2',data:{nome:'SEM AGENDAMENTO',ativo:true}},
    {id:'v3',data:{nome:'VALIDADE CURTA',ativo:true}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_motoristas:motoristas, recebimento_recusas_motivos:motivos, recebimento_recusas_notas:mockColecao([]), recebimento_recusas:mockColecao([]) });
  await win.renderRecebimentoRecusasCadastros();
  abrirModoImportar(document);
  selecionarArquivoFalso(document);
  document.querySelector('[data-recusa-ler-import-cadastros]').click();
  await new Promise(r=>setTimeout(r,0));

  assert.match(document.getElementById('page-recebimento-recusas-cadastros').innerHTML,/já estão cadastrados/);
  assert.equal(document.querySelector('[data-recusa-salvar-import-cadastros]'),null);
});

test('sem arquivo selecionado, avisa e não tenta ler nada',async()=>{
  const { win, document }=carregarPagina({ recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]), recebimento_recusas_notas:mockColecao([]), recebimento_recusas:mockColecao([]) });
  const toasts=[];
  win.showToast=(m,t)=>toasts.push({m,t});
  await win.renderRecebimentoRecusasCadastros();
  abrirModoImportar(document);
  document.querySelector('[data-recusa-ler-import-cadastros]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.ok(toasts.some(t=>/Selecione uma planilha/.test(t.m)));
});

// PEDIDO AO VIVO (usuário: "as partes de cadastro da parte de recebimento
// fazer em um menu só recebimento notas retornadas, qualquer um que
// precisa de cadastro, mas deixar bem separado e organizado") — Motorista/
// Motivo/Conferente + importação em massa por planilha viviam misturados
// dentro da própria tela de Notas Retornadas; agora vivem SÓ na tela de
// Cadastros, deixando a tela principal (tabela de notas) limpa.
test('PEDIDO AO VIVO: tela de Notas Retornadas NÃO mostra mais cadastro de motorista/motivo/conferente nem a importação por planilha — só a tela de Cadastros mostra',async()=>{
  const motoristas=mockColecao([{id:'m1',data:{nome:'Carlos',ativo:true}}]);
  const motivos=mockColecao([{id:'v1',data:{nome:'Sem pedido',ativo:true}}]);
  const conferentes=mockColecao([{id:'c1',data:{nome:'Ana',ativo:true}}]);
  const colecoes={ recebimento_recusas_motoristas:motoristas, recebimento_recusas_motivos:motivos, recebimento_recusas_conferentes:conferentes, recebimento_recusas_notas:mockColecao([]), recebimento_recusas:mockColecao([]), recebimento_recusas_tarefas_conferencia:mockColecao([]) };

  const { win: win1, document: doc1 }=carregarPagina(colecoes);
  await win1.renderRecebimentoRecusas();
  const htmlPrincipal=doc1.getElementById('page-recebimento-recusas').innerHTML;
  assert.doesNotMatch(htmlPrincipal,/Carlos/,'motorista cadastrado não aparece mais na tela principal');
  assert.doesNotMatch(htmlPrincipal,/Importar Motoristas \+ Motivos/);
  assert.equal(doc1.querySelector('[data-recusa-add]'),null,'botão de adicionar cadastro saiu da tela principal');

  const { win: win2, document: doc2 }=carregarPagina(colecoes);
  await win2.renderRecebimentoRecusasCadastros();
  const htmlCadastros=doc2.getElementById('page-recebimento-recusas-cadastros').innerHTML;
  assert.match(htmlCadastros,/Carlos/);
  assert.match(htmlCadastros,/Sem pedido/);
  assert.match(htmlCadastros,/Ana/);
  assert.equal(doc2.querySelectorAll('[data-recusa-add]').length,3,'os 3 cadastros (motorista/motivo/conferente) aparecem juntos, bem separados em cards próprios, no modo manual (padrão)');
  abrirModoImportar(doc2);
  assert.match(doc2.getElementById('page-recebimento-recusas-cadastros').innerHTML,/Importar Motoristas \+ Motivos/,'importação por planilha continua existindo, só que atrás do modo "Importar" no card de Motoristas');
});
