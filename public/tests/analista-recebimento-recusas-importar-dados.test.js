// PEDIDO AO VIVO (2026-09-11): "se eu baixar um arquivo com todas as notas
// você consegue ler e cadastra em cada uma o mercado e o valor NF que
// faltam, e outro arquivo para você colocar o tratamento nas notas se é
// recusa ou reentrega e os motivos" — 2 planilhas reais de negócio
// (Relatorio de Viagens e CONTROLE DE REENTREGAS E RECUSAS, aba "BASE
// GERAL" escolhida explicitamente pelo usuário) completam campos que
// faltam em notas já existentes em recebimento_recusas. Mesmo padrão
// "ler → pré-visualizar → confirmar" de analista-notas-retornadas-
// importar-cadastros.test.js, mas "nunca sobrescreve, só completa" (regra
// pedida ao vivo, testada explicitamente abaixo).
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
      _registro: registro,
      set: async(p,opts)=>{ const a=registro.get(id)||{}; registro.set(id, opts&&opts.merge ? {...a,...p} : p); },
    }),
    add: async(payload)=>{ const id='novo'+(seq++); registro.set(id,payload); return {id}; },
    _registro: registro,
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

// batch() vive no objeto Firestore (raw()/fs()), não na coleção — precisa
// ser genérico o bastante pra gravar em qualquer coleção passada, por isso
// cada doc-ref carrega consigo o Map da própria coleção (_registro).
function mockFirestore(colecoes){
  return {
    collection:(nome)=>colecoes[nome]||mockColecao([]),
    batch:()=>{
      const ops=[];
      return {
        update:(ref,patch)=>ops.push({ref,patch}),
        set:(ref,patch)=>ops.push({ref,patch}),
        commit: async()=>{ ops.forEach(({ref,patch})=>{ const atual=ref._registro.get(ref.id)||{}; ref._registro.set(ref.id,Object.assign({},atual,patch)); }); },
      };
    },
  };
}

let _janelasAbertas = [];
test.afterEach(() => { _janelasAbertas.forEach(w => { try { w.close(); } catch (_) {} }); _janelasAbertas = []; });

function carregarPagina(colecoes, linhasPlanilha){
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div><div id="page-recebimento-recusas-cadastros"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  _janelasAbertas.push(win);
  const fsMock = mockFirestore(colecoes);
  win.getDTFirestore=()=>fsMock;
  win.getDTRawFirestore=()=>fsMock;
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }) };
  win.showToast=()=>{};
  win.aplicarPermissoesAnalista=()=>{};
  win.XLSX={
    read:()=>({ SheetNames:['LOG BRUTO','BASE GERAL'], Sheets:{ 'LOG BRUTO':{}, 'BASE GERAL':{} } }),
    utils:{ sheet_to_json:()=>linhasPlanilha },
  };
  win.eval(recusasCode);
  return { win, document };
}

function colecoesBase(recusas){
  return {
    recebimento_recusas_motoristas: mockColecao([]),
    recebimento_recusas_motivos: mockColecao([]),
    recebimento_recusas_conferentes: mockColecao([]),
    recebimento_recusas_notas: mockColecao([]),
    recebimento_recusas: recusas,
  };
}

function selecionarArquivo(document, inputId){
  const input=document.getElementById(inputId);
  Object.defineProperty(input,'files',{ value:[{ name:'planilha.xlsx', arrayBuffer: async()=>new ArrayBuffer(0) }], configurable:true });
  return input;
}

async function lerEClicar(document, tipo){
  selecionarArquivo(document, tipo==='mercado' ? 'recusas-import-mercado-arquivo' : 'recusas-import-tratamento-arquivo');
  document.querySelector(`[data-recusa-ler-import-dados="${tipo}"]`).click();
  await new Promise(r=>setTimeout(r,0));
}

// ── Mercado/valor (Relatório de Viagens) ──────────────────────────────
test('mercado/valor: completa só quem está sem destinatário/valor, nunca sobrescreve quem já tem, e normaliza o sufixo "-N" da NF',async()=>{
  const linhas=[
    { 'N° NF/CF':'100-1', 'Destinatário':'Mercado X', 'Valor NF/CF':'500,00' },
    { 'N° NF/CF':'200', 'Destinatário':'Outro Mercado', 'Valor NF/CF':'999' },
    { 'N° NF/CF':'300-2', 'Destinatário':'Mercado Y', 'Valor NF/CF':'700' },
  ];
  const recusas=mockColecao([
    { id:'docA', data:{ numeroNota:'100', destinatario:'', valorTotal:0, notas:[{numeroNota:'100'}] } },
    { id:'docB', data:{ numeroNota:'200', destinatario:'Já Cadastrado', valorTotal:300, notas:[{numeroNota:'200'}] } },
    { id:'docC', data:{ notas:[{numeroNota:'300-2', destinatario:'', valorTotal:0}] } },
  ]);
  const { win, document }=carregarPagina(colecoesBase(recusas), linhas);
  await win.renderRecebimentoRecusasCadastros();
  await lerEClicar(document, 'mercado');

  const html=document.getElementById('page-recebimento-recusas-cadastros').innerHTML;
  assert.match(html,/<b>2<\/b>\s*nota\(s\) do sistema vão ganhar mercado\/valor/,'só docA e docC estão faltando dado — docB já tem tudo preenchido');

  document.querySelector('[data-recusa-salvar-import-dados]').click();
  await new Promise(r=>setTimeout(r,0));

  const a=recusas._registro.get('docA');
  assert.equal(a.notas[0].destinatario,'Mercado X');
  assert.equal(a.notas[0].valorTotal,500);

  const b=recusas._registro.get('docB');
  assert.equal(b.destinatario,'Já Cadastrado','nunca sobrescreve o que já estava preenchido (campo no nível do documento, a nota não tinha override)');
  assert.equal(b.valorTotal,300);

  const c=recusas._registro.get('docC');
  assert.equal(c.notas[0].destinatario,'Mercado Y','NF "300-2" da planilha casou com a nota "300-2" normalizada');
  assert.equal(c.notas[0].valorTotal,700);
});

// ── Tratamento/motivo (CONTROLE DE REENTREGAS E RECUSAS › BASE GERAL) ──
test('tratamento/motivo: classifica só quem está sem tratamento, ignora linha sem ACAO reconhecida, carimba liberadoParaRecusarEm só em Recusa, e recalcula statusFisico',async()=>{
  const linhas=[
    { 'NOTA FISCAL':'500', ACAO:'Recusa', MOTIVO:'Cliente ausente' },
    { 'NOTA FISCAL':'600', ACAO:'Reentrega', MOTIVO:'Sem agendamento' },
    { 'NOTA FISCAL':'700', ACAO:'', MOTIVO:'' }, // sem classificação — deve ser ignorada
    { 'NOTA FISCAL':'800', ACAO:'Recusa', MOTIVO:'Nota errada' }, // vai bater numa nota já classificada — não deve mexer
  ];
  const recusas=mockColecao([
    { id:'docRecusa', data:{ origem:'COLETOR', notas:[{numeroNota:'500', chave:'CH500'}] } },
    { id:'docReentrega', data:{ origem:'COLETOR', notas:[{numeroNota:'600', chave:'CH600'}] } },
    { id:'docSemAcao', data:{ origem:'COLETOR', notas:[{numeroNota:'700'}] } },
    { id:'docJaClassificado', data:{ origem:'COLETOR', motivoNome:'Motivo antigo', notas:[{numeroNota:'800', tratamento:'REENTREGA'}] } },
  ]);
  const { win, document }=carregarPagina(colecoesBase(recusas), linhas);
  await win.renderRecebimentoRecusasCadastros();
  await lerEClicar(document, 'tratamento');

  const html=document.getElementById('page-recebimento-recusas-cadastros').innerHTML;
  assert.match(html,/<b>2<\/b>\s*nota\(s\) do sistema vão ganhar tratamento\/motivo/,'só docRecusa e docReentrega estão sem tratamento — docSemAcao não tem ACAO reconhecida na planilha, docJaClassificado já tinha tratamento');

  document.querySelector('[data-recusa-salvar-import-dados]').click();
  await new Promise(r=>setTimeout(r,0));

  const recusa=recusas._registro.get('docRecusa');
  assert.equal(recusa.notas[0].tratamento,'RECUSA');
  assert.ok(recusa.notas[0].tratamentoDefinidoEm);
  assert.equal(recusa.notas[0].tratamentoDefinidoPor,'Importação de planilha');
  assert.ok(recusa.notas[0].liberadoParaRecusarEm,'Recusa carimba liberadoParaRecusarEm');
  assert.equal(recusa.motivoNome,'Cliente ausente');
  assert.equal(recusa.statusFisico,'NO_PATIO','Recusa sem statusRetorno=FINALIZADO ainda está no pátio');

  const reentrega=recusas._registro.get('docReentrega');
  assert.equal(reentrega.notas[0].tratamento,'REENTREGA');
  assert.equal(reentrega.notas[0].liberadoParaRecusarEm,undefined,'Reentrega não carimba liberadoParaRecusarEm — campo é só de Recusa');
  assert.equal(reentrega.motivoNome,'Sem agendamento');
  assert.equal(reentrega.statusFisico,'NO_PATIO','Reentrega sem dataSaidaEm ainda está no pátio');

  const semAcao=recusas._registro.get('docSemAcao');
  assert.equal(semAcao.notas[0].tratamento,undefined,'linha da planilha sem ACAO reconhecida (nem RECUSA nem REENTREGA) nunca classifica');

  const jaClassificado=recusas._registro.get('docJaClassificado');
  assert.equal(jaClassificado.notas[0].tratamento,'REENTREGA','já estava classificado — planilha não pode reclassificar');
  assert.equal(jaClassificado.motivoNome,'Motivo antigo','nunca sobrescreve o motivo já cadastrado');
});

test('planilha sem nenhuma nota faltando o dado mostra mensagem clara em vez do botão de confirmar',async()=>{
  const linhas=[ { 'N° NF/CF':'100', 'Destinatário':'Mercado X', 'Valor NF/CF':'500' } ];
  const recusas=mockColecao([
    { id:'docA', data:{ notas:[{numeroNota:'100', destinatario:'Já tem', valorTotal:500}] } },
  ]);
  const { win, document }=carregarPagina(colecoesBase(recusas), linhas);
  await win.renderRecebimentoRecusasCadastros();
  await lerEClicar(document, 'mercado');

  assert.match(document.getElementById('page-recebimento-recusas-cadastros').innerHTML,/nenhuma nota do sistema está faltando mercado\/valor/);
  assert.equal(document.querySelector('[data-recusa-salvar-import-dados]'),null);
});

test('sem arquivo selecionado, avisa e não tenta ler nada',async()=>{
  const recusas=mockColecao([]);
  const { win, document }=carregarPagina(colecoesBase(recusas), []);
  const toasts=[];
  win.showToast=(m,t)=>toasts.push({m,t});
  await win.renderRecebimentoRecusasCadastros();
  document.querySelector('[data-recusa-ler-import-dados="tratamento"]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.ok(toasts.some(t=>/Selecione uma planilha/.test(t.m)));
});
