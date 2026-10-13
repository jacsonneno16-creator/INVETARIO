// PEDIDO AO VIVO (2026-09-18): "não quero fazer uma solicitação de cada
// vez... selecionar por categoria, escolher produtos e datas, e depois o
// sistema organiza por fornecedor/comprador. Cada produto x cada data vira
// uma requisição separada pelo mesmo núcleo de criação.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const codeCentral = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');

// _loteDiasAte() (78-pcp-central.js) compara com "hoje" no fuso LOCAL
// (new Date() + setHours(0,0,0,0)), de propósito — é o mesmo critério de
// data usado pra "hoje" em todo o resto do PCP. new Date().toISOString()
// devolve a data em UTC, que diverge da local sempre que o horário local
// já passou das ~21h em horário de Brasília (UTC-3) — o dia UTC já virou
// amanhã enquanto ainda é hoje aqui. Usar isso como "hoje" no teste conta
// 1 dia de diferença que não existe de verdade, e o teste falha à noite
// sem nenhum bug real por trás. hojeLocal() usa as mesmas partes de data
// que Date usaria localmente, igual ao que a função de produção faz.
function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function diasDepois(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mockColecao(docsIniciais) {
  const registro = new Map((docsIniciais || []).map(d => [d.id, d.data]));
  let seq = 0;
  return {
    get: async () => ({ docs: [...registro.entries()].map(([id, data]) => ({ id, data: () => data })) }),
    where: () => ({ get: async () => ({ docs: [] }) }),
    doc: (id) => ({ id, set: async () => {} }),
    add: async (payload) => { const id = 'auto' + (++seq); registro.set(id, payload); return { id }; },
    _registro: registro,
  };
}

function montarAmbiente(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.showToast = () => {};
  win.confirm = () => true;
  win._currentAnalistaUser = { email: 'pcp@teste.com', uid: 'u-pcp' };
  win.getDTLojaAtiva = () => 'loja1';
  const colReqs = opts.colReqs || mockColecao([]);
  const colRegras = mockColecao(opts.regras || []);
  const cols = { pcp_requisicoes_compra: colReqs, compras_regras_comprador: colRegras };
  win.getDTFirestore = () => ({ collection: (nome) => cols[nome] || mockColecao([]) });
  win.getDTRawFirestore = () => ({ collection: (nome) => (nome === 'lojas' ? mockColecao([]) : (cols[nome] || mockColecao([]))) });
  win.carregarScriptsDeArea = async () => {};
  vm.runInContext(codeCentral, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  win._pcpInternals.setInsumosBi(opts.insumos || [
    { cod: '700', produto: 'Batata Palha Tradicional 1kg', grupo: 'insumo', tipo: 'Embalagem', fornecedor: 'Ebrali Embalagens', estoque: 20, consumoDia: 10, coberturaDias: 2 },
    { cod: '701', produto: 'Batata Palha Extra Fina 1kg', grupo: 'insumo', tipo: 'Embalagem', fornecedor: 'Ebrali Embalagens', estoque: 10, consumoDia: 5, coberturaDias: 2 },
  ]);
  return { win, document: win.document, colReqs };
}

// PEDIDO AO VIVO (2026-10-01): "quando eu coloco muito produto... não tem
// uma barra de rolagem... não consigo fazer nada nem preencher todas as
// datas" — .modal-card não tinha altura máxima, então com muitos produtos/
// datas o card crescia pra fora da tela, incluindo o botão "Criar
// solicitações" no rodapé, sem nenhum jeito de rolar até ele.
test('Nova solicitação em lote: o modal tem altura máxima e rolagem, pra não estourar a tela com muitos produtos/datas', async () => {
  const { win, document } = montarAmbiente();
  await win._pcpInternals.carregar();
  await win._pcpInternals.abrirModalSolicLote();
  const html = document.getElementById('pcp-modal-host').innerHTML;
  assert.match(html, /class="modal-card" style="[^"]*max-height:90vh[^"]*overflow:auto/, 'modal-card precisa de teto de altura + rolagem, senão overflow-y:auto do modal-body nunca tem o que estourar');
});

test('Nova solicitação em lote: escolher categoria mostra os produtos dela e o fornecedor de cada item', async () => {
  const { win, document } = montarAmbiente();
  await win._pcpInternals.carregar();
  await win._pcpInternals.abrirModalSolicLote();
  let html = document.getElementById('pcp-modal-host').innerHTML;
  assert.match(html, /Insumos \/ embalagens/, 'categoria aparece na lista pra escolher');

  await win._pcpInternals.loteSelecionarFornecedor('insumos');
  html = document.getElementById('pcp-modal-host').innerHTML;
  assert.match(html, /Batata Palha Tradicional 1kg/);
  assert.match(html, /Batata Palha Extra Fina 1kg/);
  assert.match(html, /id="lote-add-produto-busca"/,'campo permite digitar o nome/código do produto');
  assert.match(html, /datalist id="lote-produtos-sugestoes"/,'campo mantém sugestões pesquisáveis');
  // O fornecedor é exibido na linha selecionada, não no catálogo de opções.
  // Isso mantém a escolha inicial simples por categoria e só mostra o
  // roteamento comercial dos itens que realmente entrarão na solicitação.
  win._pcpInternals.loteAdicionarProduto('700');
  html = document.getElementById('pcp-modal-host').innerHTML;
  assert.match(html, /Ebrali Embalagens/);
});

test('Nova solicitação em lote: pode adicionar digitando nome ou código do produto', async () => {
  const { win } = montarAmbiente();
  await win._pcpInternals.carregar();
  await win._pcpInternals.abrirModalSolicLote();
  await win._pcpInternals.loteSelecionarFornecedor('insumos');
  assert.equal(win._pcpInternals.loteAdicionarProdutoBusca('Batata Palha Tradicional 1kg'), true);
  assert.equal(win._pcpInternals.getLoteLinhas()[0].produtoId, '700');
});

test('Nova solicitação em lote: 2 produtos, cada um com várias datas — cria 1 requisição por produto x data, todas roteadas pro comprador certo', async () => {
  const { win, document, colReqs } = montarAmbiente({
    regras: [{ id: 'r1', data: { tipo: 'fornecedor', valor: 'Ebrali Embalagens', compradorUid: 'u-fabricio', compradorNome: 'Fabricio Silva', ativo: true } }],
  });
  await win._pcpInternals.carregar();
  await win._pcpInternals.abrirModalSolicLote();
  await win._pcpInternals.loteSelecionarFornecedor('insumos');
  win._pcpInternals.loteAdicionarProduto('700'); // batata tradicional
  win._pcpInternals.loteAdicionarProduto('701'); // batata extra fina
  win._pcpInternals.loteAdicionarData(0); // 2ª data pro 1º produto

  document.getElementById('lote-qtd-0-0').value = '50';
  document.getElementById('lote-data-0-0').value = '2026-10-05';
  document.getElementById('lote-qtd-0-1').value = '25';
  document.getElementById('lote-data-0-1').value = '2026-10-20';
  document.getElementById('lote-qtd-1-0').value = '30';
  document.getElementById('lote-data-1-0').value = '2026-10-05';

  await win._pcpInternals.loteSalvar();

  const criadas = [...colReqs._registro.values()];
  assert.equal(criadas.length, 3, '2 datas da batata tradicional + 1 data da extra fina = 3 requisições');
  assert.ok(criadas.every(r => r.compradorUid === 'u-fabricio'), 'todas roteadas pro comprador do fornecedor');
  assert.ok(criadas.every(r => r.origem === 'PCP'));
  const tradicional = criadas.filter(r => r.produto === 'Batata Palha Tradicional 1kg');
  assert.equal(tradicional.length, 2);
  assert.deepEqual(tradicional.map(r => r.dataNecessaria).sort(), ['2026-10-05', '2026-10-20']);
  const qtdsTradicional=tradicional.sort((a,b)=>a.dataNecessaria.localeCompare(b.dataNecessaria)).map(r=>r.quantidade);
  assert.deepEqual(qtdsTradicional,[50,25],'cada data mantém sua própria quantidade');
  const extraFina = criadas.find(r => r.produto === 'Batata Palha Extra Fina 1kg');
  assert.equal(extraFina.quantidade, 30);
  assert.equal(extraFina.dataNecessaria, '2026-10-05');

  // modal fechou depois de salvar
  assert.equal(document.getElementById('pcp-modal-host').innerHTML, '');
});

test('Nova solicitação em lote: cada data tem quantidade própria e cobertura na chegada acumula as quantidades anteriores', async () => {
  const { win, document } = montarAmbiente();
  await win._pcpInternals.carregar();
  await win._pcpInternals.abrirModalSolicLote();
  await win._pcpInternals.loteSelecionarFornecedor('insumos');
  win._pcpInternals.loteAdicionarProduto('700');
  win._pcpInternals.loteAdicionarData(0);
  const hoje=hojeLocal();
  document.getElementById('lote-data-0-0').value=hoje;
  document.getElementById('lote-qtd-0-0').value='50';
  document.getElementById('lote-data-0-1').value=hoje;
  document.getElementById('lote-qtd-0-1').value='30';
  win._pcpInternals._loteSincronizarForm();
  const linha=win._pcpInternals.getLoteLinhas()[0];
  const c1=win._pcpInternals._loteCoberturaNaChegada(linha,0);
  const c2=win._pcpInternals._loteCoberturaNaChegada(linha,1);
  assert.equal(c1.diasCobertura,7,'estoque 20 + primeira chegada 50 / consumo 10 = 7 dias');
  assert.equal(c2.diasCobertura,10,'segunda cobertura soma 50 anterior + 30 atual: (20+80)/10 = 10 dias');
});

// PEDIDO AO VIVO (2026-10-01): "verifica se realmente o cálculo da
// cobertura de dias... soma tudo certo" — o teste acima usa a mesma data
// (hoje) nas duas parcelas, então nunca exercitava o desconto de consumo
// até a chegada (consumoDia×dias) — só a soma das quantidades. Este teste
// usa uma data futura de propósito pra travar essa segunda parte da conta.
test('Nova solicitação em lote: cobertura na chegada desconta o consumo diário até a data, não só soma a quantidade recebida', async () => {
  const { win, document } = montarAmbiente();
  await win._pcpInternals.carregar();
  await win._pcpInternals.abrirModalSolicLote();
  await win._pcpInternals.loteSelecionarFornecedor('insumos');
  win._pcpInternals.loteAdicionarProduto('700'); // estoque 20, consumo 10/dia
  document.getElementById('lote-data-0-0').value = diasDepois(5);
  document.getElementById('lote-qtd-0-0').value = '70';
  win._pcpInternals._loteSincronizarForm();
  const linha = win._pcpInternals.getLoteLinhas()[0];
  const c = win._pcpInternals._loteCoberturaNaChegada(linha, 0);
  // estoque 20 − consumo até lá (10×5=50) + chegada 70 = 40 → 40/10 = 4 dias
  assert.equal(c.diasCobertura, 4, 'desconta 10×5=50 de consumo até a chegada, não só soma os 70 recebidos (que sozinhos dariam 9d)');
});

test('Nova solicitação em lote: produto sem quantidade ou sem data nenhuma é pulado, com aviso — não trava os outros', async () => {
  const { win, document, colReqs } = montarAmbiente({
    regras: [{ id: 'r1', data: { tipo: 'fornecedor', valor: 'Ebrali Embalagens', compradorUid: 'u-fabricio', compradorNome: 'Fabricio Silva', ativo: true } }],
  });
  let ultimoToast = null;
  win.showToast = (msg, tipo) => { ultimoToast = { msg, tipo }; };
  await win._pcpInternals.carregar();
  await win._pcpInternals.abrirModalSolicLote();
  await win._pcpInternals.loteSelecionarFornecedor('insumos');
  win._pcpInternals.loteAdicionarProduto('700');
  win._pcpInternals.loteAdicionarProduto('701');
  // produto 700 fica sem quantidade/data (inválido); só o 701 é preenchido
  document.getElementById('lote-qtd-1-0').value = '10';
  document.getElementById('lote-data-1-0').value = '2026-10-05';

  await win._pcpInternals.loteSalvar();
  const criadas = [...colReqs._registro.values()];
  assert.equal(criadas.length, 1, 'só a linha válida vira requisição');
  assert.match(ultimoToast.msg, /1 solicitação/);
  assert.match(ultimoToast.tipo, /warning/);
});

test('Nova solicitação em lote: sem regra de comprador pro fornecedor, cria mesmo assim (sem_comprador) e avisa', async () => {
  const { win, colReqs } = montarAmbiente(); // sem regras
  await win._pcpInternals.carregar();
  await win._pcpInternals.abrirModalSolicLote();
  await win._pcpInternals.loteSelecionarFornecedor('insumos');
  win._pcpInternals.loteAdicionarProduto('700');
  win.document.getElementById('lote-qtd-0-0').value = '5';
  win.document.getElementById('lote-data-0-0').value = '2026-10-05';
  await win._pcpInternals.loteSalvar();
  const criada = [...colReqs._registro.values()][0];
  assert.equal(criada.status, 'sem_comprador');
  assert.equal(criada.compradorUid, '');
});
