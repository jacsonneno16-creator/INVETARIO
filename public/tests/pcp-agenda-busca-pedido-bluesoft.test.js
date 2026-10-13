'use strict';
/**
 * PEDIDO AO VIVO: hoje o comprador digita a "previsão de entrega" (produto,
 * fornecedor, quantidade, nº do pedido) totalmente à mão na aba
 * Agendamentos do PCP. Quando o fornecedor confirma a agenda de verdade, em
 * vez de redigitar tudo, o comprador só informa o número do pedido — a
 * busca acha ESSE pedido na Bluesoft (numeroDoPedido, filtro real e
 * confirmado no schema oficial) e preenche produto/fornecedor/quantidade;
 * só a data real de entrega continua sendo digitada na hora, porque é
 * exatamente o dado que o fornecedor está confirmando. Depois, o comprador
 * usa o MESMO botão "+ Agendar" de sempre — nenhuma coleção nova, nenhum
 * fluxo paralelo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');

function colecaoVazia() { return { get: async () => ({ docs: [] }), where: () => ({ get: async () => ({ docs: [] }) }) }; }

async function montarAmbiente({ buscarPedido, produtosCadastrados = [] } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  const chamadas = [];
  win.temPermissao = () => true;
  win.calcularProjecaoComRisco = () => [];
  win.getParametrosProducaoProjecao = () => ({});
  win.getDTLojaAtiva = () => 'loja1';
  win.showToast = (msg, tipo) => chamadas.push(['toast', tipo, msg]);
  win._currentAnalistaUser = { email: 'comprador@teste.com' };
  // O <select> de produto (pcp-age-prod) só ganha a <option> certa se o
  // produto já estiver na lista que 78-pcp-central.js carregou de
  // producao_produtos — igual precisa estar em produção pra "Usar este
  // item" funcionar de verdade (o mesmo cadastro que o serviço Bluesoft
  // checa em cadastradoNaProducao).
  win.getDTFirestore = () => ({
    collection: (nome) => nome === 'producao_produtos'
      ? { get: async () => ({ docs: produtosCadastrados.map((p, i) => ({ id: 'p' + i, data: () => p })) }) }
      : colecaoVazia(),
  });
  win.getDTRawFirestore = () => ({ collection: (nome) => {
    if (nome === 'lojas') return {
      get: async () => ({ docs: [{ id:'loja1', data:()=>({ nome:'Loja 1', ativa:true, bluesoft_loja_key:1 }) }] }),
      doc: () => ({ collection: (sub) => {
        if (sub === 'producao_produtos') return { get: async()=>({docs:produtosCadastrados.map((p,i)=>({id:'p'+i,data:()=>p}))}) };
        if (sub === 'recebimento_agendamentos') return {
          where: (_campo,_op,numero) => ({ limit: () => ({ get: async () => {
            try {
              const p = await (buscarPedido || (async () => { throw new Error('não deveria ser chamado neste teste'); }))(numero);
              const itensPedido=(p.itens||[]).map(it=>({produtoKey:it.produtoKey||it.cod,cod:it.cod,produto:it.produtoNome||it.produto,quantidadePendente:it.quantidadePendente||0,quantidadeRecebida:Math.max(0,(it.quantidadePedida||0)-(it.quantidadePendente||0))}));
              return { empty:false, docs:[{ data:()=>({numeroPedido:p.numeroPedido,fornecedorNome:p.fornecedorNome,dataRecebida:p.entregaPendente?null:'2026-01-01',itensPedido}) }] };
            } catch(e) { if (/não encontrado/i.test(e.message||'')) return { empty:true, docs:[] }; throw e; }
          } }) })
        };
        return colecaoVazia();
      } })
    };
    return { where:()=>({get:async()=>({docs:[]})}), get:async()=>({docs:[]}) };
  } });
  win.buscarPedidoCompraBluesoftPorNumero = () => { throw new Error('serviço Bluesoft antigo não deve ser usado'); };
  vm.runInContext(code, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  await win.renderPCPCentral();
  win._pcpInternals.setAba('agendamentos');
  await win.renderPCPCentral();
  return { win, chamadas };
}

test('busca por número do pedido: mostra fornecedor, itens e "Usar este item" quando o produto já está cadastrado em Produção', async () => {
  const { win } = await montarAmbiente({
    produtosCadastrados: [{ cod: '101', nome: 'Farinha Especial' }],
    buscarPedido: async (numero) => {
      assert.equal(numero, '4521');
      return {
        numeroPedido: '4521', fornecedorNome: 'Distribuidora Trigo LTDA', entregaPendente: true,
        itens: [{ produtoKey: '101', cod: '101', produtoNome: 'Farinha Especial', cadastradoNaProducao: true, quantidadePedida: 50, quantidadePendente: 50 }],
      };
    },
  });
  win.document.getElementById('pcp-age-busca-num').value = '4521';
  win.document.querySelector('[data-pcp-age-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const html = win.document.getElementById('page-pcp-central').innerHTML;
  assert.match(html, /Distribuidora Trigo LTDA/);
  assert.match(html, /Farinha Especial/);
  assert.match(html, /Usar este item/);
});

test('"Usar este item" preenche produto/fornecedor/quantidade/nº do pedido, e deixa a data em branco pro comprador confirmar', async () => {
  const { win } = await montarAmbiente({
    produtosCadastrados: [{ cod: '9', nome: 'Açúcar Cristal' }],
    buscarPedido: async () => ({
      numeroPedido: '777', fornecedorNome: 'Insumos Sul', entregaPendente: true,
      itens: [{ produtoKey: '9', cod: '9', produtoNome: 'Açúcar Cristal', cadastradoNaProducao: true, quantidadePedida: 20, quantidadePendente: 15 }],
    }),
  });
  win.document.getElementById('pcp-age-busca-num').value = '777';
  win.document.querySelector('[data-pcp-age-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  win.document.querySelector('[data-pcp-age-usar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(win.document.getElementById('pcp-age-prod').value, '9');
  assert.equal(win.document.getElementById('pcp-age-forn').value, 'Insumos Sul');
  assert.equal(win.document.getElementById('pcp-age-qtd').value, '15'); // usa o PENDENTE, não o pedido total
  assert.equal(win.document.getElementById('pcp-age-compra').value, '777');
  assert.equal(win.document.getElementById('pcp-age-data').value, '', 'data real da entrega continua em branco — é o que o fornecedor está confirmando agora');
});

test('produto do pedido Bluesoft ainda não cadastrado em Produção: mostra aviso, sem oferecer "Usar este item"', async () => {
  const { win } = await montarAmbiente({
    buscarPedido: async () => ({
      numeroPedido: '999', fornecedorNome: 'Fornecedor X', entregaPendente: true,
      itens: [{ produtoKey: '555', cod: '555', produtoNome: null, cadastradoNaProducao: false, quantidadePedida: 10, quantidadePendente: 10 }],
    }),
  });
  win.document.getElementById('pcp-age-busca-num').value = '999';
  win.document.querySelector('[data-pcp-age-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const html = win.document.getElementById('page-pcp-central').innerHTML;
  assert.match(html, /não cadastrado/);
  assert.doesNotMatch(html, /Usar este item/);
});

test('pedido não encontrado na Bluesoft: mostra o erro específico, não trava a tela', async () => {
  const { win } = await montarAmbiente({ buscarPedido: async () => { throw new Error('Pedido nº 123 não encontrado na Bluesoft para esta loja.'); } });
  win.document.getElementById('pcp-age-busca-num').value = '123';
  win.document.querySelector('[data-pcp-age-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const html = win.document.getElementById('page-pcp-central').innerHTML;
  assert.match(html, /não encontrado no espelho do BI/);
});

test('depois de salvar o agendamento com sucesso, o resultado da busca some da tela (não fica um pedido velho preso ali)', async () => {
  let salvo = null;
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.calcularProjecaoComRisco = () => [];
  win.getParametrosProducaoProjecao = () => ({});
  win.getDTLojaAtiva = () => 'loja1';
  win.showToast = () => {};
  win._currentAnalistaUser = { email: 'comprador@teste.com' };
  win.getDTFirestore = () => ({
    collection: (nome) => {
      if (nome === 'pcp_agendamentos') return { get: async () => ({ docs: [] }), add: async (doc) => { salvo = doc; return { id: 'novo' }; } };
      if (nome === 'producao_produtos') return { get: async () => ({ docs: [{ id: 'p3', data: () => ({ cod: '3', nome: 'Fermento' }) }] }) };
      return colecaoVazia();
    },
  });
  win.getDTRawFirestore = () => ({ collection: (nome) => {
    if (nome==='lojas') return {
      get:async()=>({docs:[{id:'loja1',data:()=>({nome:'Loja 1',ativa:true,bluesoft_loja_key:1})}]}),
      doc:()=>({collection:(sub)=>{
        if(sub==='producao_produtos') return {get:async()=>({docs:[{id:'p3',data:()=>({cod:'3',nome:'Fermento'})}]})};
        if(sub==='pcp_agendamentos') return {get:async()=>({docs:[]}),add:async(doc)=>{salvo=doc;return{id:'novo'};}};
        if(sub==='recebimento_agendamentos') return {where:()=>({limit:()=>({get:async()=>({empty:false,docs:[{data:()=>({numeroPedido:'42',fornecedorNome:'Fornecedor Y',itensPedido:[{produtoKey:'3',produto:'Fermento',quantidadePendente:8,quantidadeRecebida:0}]})}]})})})};
        return colecaoVazia();
      }})
    };
    return {where:()=>({get:async()=>({docs:[]})}),get:async()=>({docs:[]})};
  } });
  win.buscarPedidoCompraBluesoftPorNumero = () => { throw new Error('serviço Bluesoft antigo não deve ser usado'); };
  vm.runInContext(code, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  await win.renderPCPCentral();
  win._pcpInternals.setAba('agendamentos');
  await win.renderPCPCentral();

  win.document.getElementById('pcp-age-busca-num').value = '42';
  win.document.querySelector('[data-pcp-age-buscar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  win.document.querySelector('[data-pcp-age-usar]').dispatchEvent(new win.Event('click', { bubbles: true }));
  win.document.getElementById('pcp-age-data').value = '2026-09-01';
  win.document.querySelector('[data-pcp-age-save]').dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));

  assert.ok(salvo, 'o agendamento precisa ter sido gravado');
  assert.equal(salvo.produto, 'Fermento');
  assert.equal(salvo.numeroCompra, '42');
  assert.doesNotMatch(win.document.getElementById('page-pcp-central').innerHTML, /Fornecedor Y/, 'resultado da busca anterior não pode continuar exibido depois de agendar');
});
