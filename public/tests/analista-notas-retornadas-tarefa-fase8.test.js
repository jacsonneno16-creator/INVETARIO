// FASE 8 (ponta Analista): "Solicitar conferência" na tabela de Notas
// Retornadas cria uma tarefa em recebimento_recusas_tarefas_conferencia
// (id determinístico = id da recusa, no molde de dt_atribuicoes_contagem)
// e a linha passa a mostrar "Aguardando <operador>" em vez do botão.
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
    doc:(id)=>({ id, set: async(payload)=>{ const a=registro.get(id)||{}; registro.set(id,{...a,...payload}); } }),
    _registro: registro,
  };
}

// buscarBiAutomatico() (97-recebimento-recusas.js) agenda um setInterval de
// auto-refresh a cada render — timer real em jsdom, que precisa ser
// derrubado com window.close() ou o node --test nunca sai sozinho.
let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(colecoes){
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  _janelasAbertas.push(win);
  win.getDTFirestore=()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) });
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }) };
  win.showToast=()=>{};
  win.aplicarPermissoesAnalista=()=>{};
  const modaisAbertos=[];
  win.openModal=(id)=>modaisAbertos.push(id);
  win.closeModal=()=>{};
  win.divPopularSelectOperadores=async(selectId)=>{
    const sel=document.getElementById(selectId);
    if(sel) sel.innerHTML='<option value="">Selecione...</option><option value="joao@daterrinha.com">João (Coletor)</option>';
  };
  win.eval(recusasCode);
  return { win, document, modaisAbertos };
}

test('"Solicitar conferência" abre o modal, popula o select de operadores e ao confirmar cria a tarefa com id = id da recusa',async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 9',statusConferenciaOperacional:'NAO_REALIZADA',notas:[{numeroNota:'321'}],criadoEm:'2026-08-19T10:00:00.000Z'}}]);
  const tarefas=mockColecao([]);
  const { win, document, modaisAbertos }=carregarPagina({ recebimento_recusas:recusas, recebimento_recusas_tarefas_conferencia:tarefas, recebimento_recusas_notas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });

  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  assert.match(document.getElementById('recusas-tabela').innerHTML,/Solicitar conferência/);

  document.querySelector('[data-recusa-solicitar-conf]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.ok(modaisAbertos.includes('modal-recusa-atribuir-conferencia'));
  assert.match(document.getElementById('recusa-atrib-resumo').innerHTML,/NF 321/);
  assert.match(document.getElementById('recusa-atrib-resumo').innerHTML,/BOX 9/);
  assert.match(document.getElementById('recusa-atrib-operador').innerHTML,/João \(Coletor\)/);

  document.getElementById('recusa-atrib-operador').value='joao@daterrinha.com';
  await win.confirmarAtribuicaoConferenciaRecusa();

  const tarefa=tarefas._registro.get('r1');
  assert.ok(tarefa,'a tarefa deveria ter sido criada com o MESMO id da recusa');
  assert.equal(tarefa.atribuidoPara,'joao@daterrinha.com');
  assert.equal(tarefa.atribuidoPor,'analista@daterrinha.com');
  assert.equal(tarefa.status,'PENDENTE');
  assert.equal(tarefa.box,'BOX 9');

  // depois de recarregar, a linha mostra "Aguardando" em vez do botão
  assert.match(document.getElementById('recusas-tabela').innerHTML,/Aguardando joao@daterrinha\.com/);
  assert.doesNotMatch(document.getElementById('recusas-tabela').innerHTML,/Solicitar conferência/);
});

test('recusa já CONFERIDA não mostra botão de solicitar nem "aguardando" — mostra o badge de conferida',async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 9',statusConferenciaOperacional:'CONFERIDA',notas:[],criadoEm:'2026-08-19T10:00:00.000Z'}}]);
  const { win, document }=carregarPagina({ recebimento_recusas:recusas, recebimento_recusas_notas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  assert.match(document.getElementById('recusas-tabela').innerHTML,/✓ Conferida/);
  assert.doesNotMatch(document.getElementById('recusas-tabela').innerHTML,/Solicitar conferência/);
});

test('filtro de texto redesenha a tabela e os botões de "Solicitar conferência" continuam clicáveis (regressão de re-wiring)',async()=>{
  const recusas=mockColecao([{id:'r1',data:{box:'BOX 9',statusConferenciaOperacional:'NAO_REALIZADA',motoristaNome:'João',notas:[{numeroNota:'321'}],criadoEm:'2026-08-19T10:00:00.000Z'}}]);
  const tarefas=mockColecao([]);
  const { win, document, modaisAbertos }=carregarPagina({ recebimento_recusas:recusas, recebimento_recusas_tarefas_conferencia:tarefas, recebimento_recusas_notas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) });
  await win.renderRecebimentoRecusas();
  win.document.getElementById('recusas-buscar-periodo').click();
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('recusas-filtro').value='joão';
  document.getElementById('recusas-filtro').dispatchEvent(new win.Event('input'));
  document.querySelector('[data-recusa-solicitar-conf]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.ok(modaisAbertos.includes('modal-recusa-atribuir-conferencia'),'o botão precisa continuar funcionando depois do filtro redesenhar a tabela sozinho');
});
