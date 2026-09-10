// PEDIDO AO VIVO (2026-08-24): substitui a API de comissão (exigia
// permissão extra e expunha dado de remuneração) por um cadastro local —
// "vou ter que cadastrar cada um manualmente, e de lá o sistema puxar,
// mercado tal vai na base e pega o vendedor supervisor". Testa a tela de
// Cadastros → Vendedores por Mercado: criar, editar e excluir um mercado,
// sempre por CNPJ. Sem gerente de propósito (pedido ao vivo anterior:
// "sempre será 1 pq de gerente só tem ele", sem valor por nota).
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const recusasCode=fs.readFileSync(path.join(base,'97-recebimento-recusas.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return {
    get: async()=>({ empty: registro.size===0, size: registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    doc:(id)=>({
      id,
      set: async(payload)=>{ const a=registro.get(id)||{}; registro.set(id,{...a,...payload}); },
      delete: async()=>{ registro.delete(id); },
    }),
    add: async(payload)=>{ const id='novo_'+(registro.size+1); registro.set(id,payload); return {id}; },
    _registro: registro,
  };
}

function carregarPaginaCadastros(colecoes){
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas-cadastros"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  win.getDTFirestore=()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) });
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }) };
  win.showToast=()=>{};
  win.aplicarPermissoesAnalista=()=>{};
  win.confirm=()=>true;
  win.eval(recusasCode);
  return { win, document };
}
function colVendedoresMercado(docs){
  return mockColecao((docs||[]).map((d,i)=>({id:d.id||('v'+i),data:d})));
}
function colecoesVazias(extra){
  return Object.assign({ recebimento_recusas_notas:mockColecao([]), recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]), recebimento_recusas_conferentes:mockColecao([]), recebimento_recusas_tarefas_conferencia:mockColecao([]) }, extra||{});
}

test('Cadastros mostra a lista de mercados já cadastrados, sem coluna Gerente', async()=>{
  const vendedoresMercado=colVendedoresMercado([{ cnpj:'12345678000199', nomeMercado:'Atacadão', vendedorNome:'João Vendas', vendedorEmail:'joao@x.com', supervisorNome:'Pedro Supervisor' }]);
  const { win, document }=carregarPaginaCadastros(colecoesVazias({ recebimento_recusas_vendedores_mercado:vendedoresMercado }));
  await win.renderRecebimentoRecusasCadastros();
  const html=document.getElementById('page-recebimento-recusas-cadastros').innerHTML;
  assert.match(html,/Vendedores por Mercado/);
  assert.match(html,/12345678000199/);
  assert.match(html,/Atacadão/);
  assert.match(html,/João Vendas/);
  assert.match(html,/Pedro Supervisor/);
  assert.doesNotMatch(html,/Gerente/i,'sem gerente de propósito');
});

test('"Novo mercado" abre o modal, salva por CNPJ e a lista atualiza sem precisar recarregar a página', async()=>{
  const vendedoresMercado=colVendedoresMercado([]);
  const { win, document }=carregarPaginaCadastros(colecoesVazias({ recebimento_recusas_vendedores_mercado:vendedoresMercado }));
  await win.renderRecebimentoRecusasCadastros();

  document.querySelector('[data-vm-novo]').click();
  assert.ok(document.getElementById('vm-modal'),'modal precisa abrir');
  document.getElementById('vm-cnpj').value='11.222.333/0001-44';
  document.getElementById('vm-mercado').value='Mercado Teste';
  document.getElementById('vm-vendedor-nome').value='Maria Vendas';
  document.getElementById('vm-supervisor-nome').value='Carlos Supervisor';
  document.getElementById('vm-salvar').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(document.getElementById('vm-modal'),null,'modal fecha depois de salvar');
  const salvo=[...vendedoresMercado._registro.values()][0];
  assert.ok(salvo,'precisa ter gravado um doc novo');
  assert.equal(salvo.cnpj,'11222333000144','CNPJ salvo só com dígitos, mesmo digitado com pontuação');
  assert.equal(salvo.vendedorNome,'Maria Vendas');
  const html=document.getElementById('page-recebimento-recusas-cadastros').innerHTML;
  assert.match(html,/Maria Vendas/,'lista já mostra o mercado recém-criado, sem precisar de F5');
});

test('CNPJ vazio não salva e mostra aviso', async()=>{
  const vendedoresMercado=colVendedoresMercado([]);
  const toasts=[];
  const { win, document }=carregarPaginaCadastros(colecoesVazias({ recebimento_recusas_vendedores_mercado:vendedoresMercado }));
  win.showToast=(m,t)=>toasts.push({m,t});
  await win.renderRecebimentoRecusasCadastros();
  document.querySelector('[data-vm-novo]').click();
  document.getElementById('vm-vendedor-nome').value='Sem CNPJ';
  document.getElementById('vm-salvar').click();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(vendedoresMercado._registro.size,0,'nada deveria ter sido salvo sem CNPJ');
  assert.ok(toasts.some(t=>/CNPJ/.test(t.m)));
});

test('editar um mercado já cadastrado pré-preenche o modal e atualiza o mesmo registro (não cria um novo)', async()=>{
  const vendedoresMercado=colVendedoresMercado([{ id:'v1', cnpj:'12345678000199', nomeMercado:'Atacadão', vendedorNome:'João Vendas' }]);
  const { win, document }=carregarPaginaCadastros(colecoesVazias({ recebimento_recusas_vendedores_mercado:vendedoresMercado }));
  await win.renderRecebimentoRecusasCadastros();

  document.querySelector('[data-vm-editar="v1"]').click();
  assert.equal(document.getElementById('vm-cnpj').value,'12345678000199');
  assert.equal(document.getElementById('vm-vendedor-nome').value,'João Vendas');
  document.getElementById('vm-vendedor-nome').value='João Vendas Atualizado';
  document.getElementById('vm-salvar').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(vendedoresMercado._registro.size,1,'edição não pode criar um segundo registro');
  assert.equal(vendedoresMercado._registro.get('v1').vendedorNome,'João Vendas Atualizado');
});

test('excluir um mercado remove do cadastro depois de confirmar', async()=>{
  const vendedoresMercado=colVendedoresMercado([{ id:'v1', cnpj:'12345678000199', nomeMercado:'Atacadão', vendedorNome:'João Vendas' }]);
  const { win, document }=carregarPaginaCadastros(colecoesVazias({ recebimento_recusas_vendedores_mercado:vendedoresMercado }));
  await win.renderRecebimentoRecusasCadastros();

  document.querySelector('[data-vm-excluir="v1"]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(vendedoresMercado._registro.size,0);
  assert.doesNotMatch(document.getElementById('page-recebimento-recusas-cadastros').innerHTML,/Atacadão/);
});
