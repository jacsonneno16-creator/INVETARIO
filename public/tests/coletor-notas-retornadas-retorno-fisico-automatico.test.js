// PEDIDO AO VIVO (2026-09-03): "as notas podem gravar direto [automático,
// por motivo tipo falta de produto], mas ainda vai continuar recebendo por
// aqui também... quando o conferência aqui receber ela, aí vai mudar o
// gráfico [pra] recebida" — devolução com motivo qualificado já vira um
// recebimento_recusas com origem:'AUTOMATICO' (100-consulta-notas-fiscais.js)
// sem passar pelo Coletor, mas isso só confirma que a NOTA existe, nunca que
// a carga física voltou. O Coletor agora aceita bipar a chave da PRÓPRIA
// nota de devolução (que nunca está no ledger de venda,
// recebimento_recusas_notas — só chave de VENDA fica lá) usando os dados já
// gravados no registro automático, e o retorno físico é criado como um
// SEGUNDO recebimento_recusas (origem:'COLETOR') compartilhando a mesma
// chave — é esse cruzamento que 102-devolucoes-bi-indicadores.js usa pra
// saber se a devolução "já retornou fisicamente".
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const baseColetor=path.join(__dirname,'../js/coletor');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const navCode=fs.readFileSync(path.join(baseColetor,'10-navegacao-estorno.js'),'utf8');
const recusasCode=fs.readFileSync(path.join(baseColetor,'24-recebimento-recusas.js'),'utf8');

const CHAVE_DEVOLUCAO='35260800123456780001235500100000123412345673';

function mockColecaoNotas(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return {
    get: async()=>({ docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data,exists:true})) }),
    doc:(id)=>({ id, get: async()=>{ const data=registro.get(id); return { exists: data!==undefined, id, data:()=>data }; } }),
  };
}
// Diferente do mockColecao genérico dos outros arquivos de teste — este
// `where('chaves','array-contains',chave)` FILTRA de verdade, porque as
// novas regras de adicionarChave() em 24-recebimento-recusas.js precisam
// distinguir um registro AUTOMATICO (deixa bipar) de um físico de verdade
// (bloqueia), e isso exige achar o registro certo, não só "existe algo".
function mockColecaoRecusas(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  let seq=0;
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    doc:(id)=>({ id: id||('novo'+(seq++)), get: async()=>{ const data=registro.get(id); return { exists: data!==undefined, id, data:()=>data }; } }),
    add: async(payload)=>{ const docId='novo'+(seq++); registro.set(docId,payload); return {id:docId}; },
    where:(campo,_op,valor)=>({
      get: async()=>snapshot([...registro.entries()].filter(([,data])=>Array.isArray(data[campo]) && data[campo].includes(valor))),
    }),
    _registro: registro,
  };
}
function mockColecaoCadastro(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return { get: async()=>({ docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }) };
}
function carregarColetorReal(colecoes){
  const dom=new JSDOM(htmlCode,{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  win.FS={ collection:(nome)=>colecoes?.[nome]||mockColecaoCadastro([]) };
  win.getDTFirestore=()=>win.FS;
  win.toast=()=>{};
  Object.defineProperty(win.navigator,'onLine',{ get:()=>true, configurable:true });
  win.eval(navCode);
  win.eval(recusasCode);
  return { win, document };
}
function selecionarComboOpcao(document,prefixo,valor){
  const win=document.defaultView;
  const opcao=document.querySelector(`[data-combo-opcao="${prefixo}"][data-combo-valor="${valor}"]`);
  opcao.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true}));
}
function cadastrosPadrao(extra){
  return Object.assign({
    recebimento_recusas_motoristas: mockColecaoCadastro([{id:'m1',data:{nome:'João',ativo:true}}]),
    recebimento_recusas_motivos: mockColecaoCadastro([{id:'v1',data:{nome:'Cliente ausente',ativo:true}}]),
  }, extra);
}

test('bipar a chave de uma devolução já gravada automaticamente (não está no ledger de venda) é aceito, com os dados vindos do registro automático', async()=>{
  const notasVenda=mockColecaoNotas([]); // ledger de venda vazio — a chave é de DEVOLUÇÃO, nunca fica lá
  const recusas=mockColecaoRecusas([{id:'auto1',data:{
    origem:'AUTOMATICO', chaves:[CHAVE_DEVOLUCAO], motivoNome:'Falta na carga/entrega', destinatario:'Mercado ABC',
    notas:[{chave:CHAVE_DEVOLUCAO,numeroNota:'555',itens:[{descricao:'Produto X',quantidade:3,gtin:'123',dun:'456'}]}],
  }}]);
  const { win, document }=carregarColetorReal({...cadastrosPadrao(), recebimento_recusas_notas:notasVenda, recebimento_recusas:recusas});
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_DEVOLUCAO;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));

  const listaHtml=document.getElementById('recusa-notas-lista').innerHTML;
  assert.match(listaHtml,/NF 555/,'nota entra na lista mesmo sem estar no ledger de venda');
  assert.match(listaHtml,/já registrada automaticamente/,'badge avisa que essa devolução já tinha sido gravada automática');
  assert.equal(recusas._registro.size,1,'ainda não gravou nada novo — só leu o registro automático existente');
});

test('chave que já tem retorno FÍSICO registrado (origem COLETOR) continua bloqueando uma segunda bipagem', async()=>{
  const notasVenda=mockColecaoNotas([]);
  const recusas=mockColecaoRecusas([
    {id:'auto1',data:{origem:'AUTOMATICO', chaves:[CHAVE_DEVOLUCAO], motivoNome:'Falta na carga/entrega', notas:[{chave:CHAVE_DEVOLUCAO,numeroNota:'555',itens:[]}]}},
    {id:'fisico1',data:{origem:'COLETOR', chaves:[CHAVE_DEVOLUCAO], motoristaNome:'João'}},
  ]);
  const toasts=[];
  const { win, document }=carregarColetorReal({...cadastrosPadrao(), recebimento_recusas_notas:notasVenda, recebimento_recusas:recusas});
  win.toast=(m,t)=>toasts.push({m,t});
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_DEVOLUCAO;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));

  assert.ok(toasts.some(t=>/já possui um retorno registrado/.test(t.m)),'já existe um retorno físico de verdade — continua bloqueando');
  assert.doesNotMatch(document.getElementById('recusa-notas-lista').innerHTML,/NF 555/);
});

test('concluir o fluxo normal pra uma devolução automática cria um SEGUNDO recebimento_recusas (origem COLETOR) com a mesma chave — não sobrescreve nem duplica o automático', async()=>{
  const notasVenda=mockColecaoNotas([]);
  const recusas=mockColecaoRecusas([{id:'auto1',data:{
    origem:'AUTOMATICO', chaves:[CHAVE_DEVOLUCAO], motivoNome:'Falta na carga/entrega',
    notas:[{chave:CHAVE_DEVOLUCAO,numeroNota:'555',itens:[]}],
  }}]);
  const { win, document }=carregarColetorReal({...cadastrosPadrao(), recebimento_recusas_notas:notasVenda, recebimento_recusas:recusas});
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  document.getElementById('recusa-chave-input').value=CHAVE_DEVOLUCAO;
  document.getElementById('recusa-add-chave').click();
  await new Promise(r=>setTimeout(r,0));
  document.getElementById('recusa-continuar-1').click();
  selecionarComboOpcao(document,'recusa-motorista','m1');
  selecionarComboOpcao(document,'recusa-motivo','v1');
  document.getElementById('recusa-continuar-2').click();
  document.getElementById('recusa-volume').value='3';
  document.getElementById('recusa-continuar-3').click();
  document.getElementById('recusa-conf-somente-volume').click();
  document.getElementById('recusa-box').value='box 1';
  document.getElementById('recusa-continuar-4').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(recusas._registro.size,2,'o automático original continua, e um novo registro físico foi criado');
  const novo=[...recusas._registro.values()].find(r=>r.origem==='COLETOR');
  assert.ok(novo,'o novo registro é origem COLETOR (retorno físico de verdade)');
  assert.equal(novo.chaves.length,1);
  assert.equal(novo.chaves[0],CHAVE_DEVOLUCAO,'compartilha a mesma chave do automático — é esse cruzamento que o indicador usa');
});
