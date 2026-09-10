const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'78-pcp-central.js'),'utf8');
function load(calc=[]){const document={addEventListener:()=>{},getElementById:()=>null};const window={calcularProjecaoComRisco:()=>calc,getParametrosProducaoProjecao:()=>({}),temPermissao:()=>true};vm.runInNewContext(code,{window,document,console,Date,Math,Number,String,Array,Object,Set,Map,confirm:()=>true,prompt:()=>null});return window._pcpInternals;}
test('PCP exemplo estoque 1000 pedidos 700 consumo 100/dia resulta saldo 300 cobertura 3 dias',()=>{const h=load([{cod:'X',produto:'Produto X',estoqueNormalizado:1000,projFinal:700,projSemanal:700}]);const v=h.construirVisao({produtos:[{cod:'X',nome:'Produto X'}],projecao:[{cod:'X',produto:'Produto X'}],pedidos:[{cod:'X',produto:'Produto X',quantidade:700,quantidadeAtendida:0,status:'pendente'}],ops:[],agendamentos:[],requisicoes:[]})[0];assert.equal(v.estoqueAtual,1000);assert.equal(v.pendente,700);assert.equal(v.saldo,300);assert.equal(v.estoqueDisponivel,300);assert.equal(v.coberturaDias,3);});
test('PCP soma produção programada e entrada prevista sem contar duas vezes compra sem entrega',()=>{const h=load([{cod:'A',produto:'A',estoqueNormalizado:500,projFinal:700,projSemanal:700}]);const v=h.construirVisao({produtos:[{cod:'A',nome:'A'}],projecao:[{cod:'A'}],pedidos:[{cod:'A',quantidade:800,status:'pendente'}],ops:[{prodCod:'A',qntCaixas:400,realizadoCaixas:100,status:'programado'}],agendamentos:[{cod:'A',quantidade:1000,quantidadeRecebida:200,status:'prevista'}],requisicoes:[{prodKey:'A',quantidade:500,status:'solicitada'}]})[0];assert.equal(v.producaoProgramada,300);assert.equal(v.entradasPrevistas,800);assert.equal(v.comprasProgramadas,500);assert.equal(v.saldo,800);});
test('PCP possui seis abas da fase 2 e fontes únicas da Produção',()=>{for(const t of ['pedidos','estoque','pedidos-estoque','compras','agendamentos','producao'])assert.match(code,new RegExp("'"+t+"'"));assert.match(code,/CPROJ='producao_projecao'/);assert.match(code,/COP='producao_registros'/);assert.match(code,/CPED='pcp_pedidos'/);assert.match(code,/pcp_requisicoes_compra/);assert.match(code,/pcp_agendamentos/);assert.match(code,/pcp_solicitacoes_producao/);});
test('PCP está ligado à navegação permissões setor e Firestore',()=>{const nav=fs.readFileSync(path.join(base,'03-core-navigation.js'),'utf8'),perm=fs.readFileSync(path.join(base,'37-usuarios-permissoes.js'),'utf8'),rules=fs.readFileSync(path.join(__dirname,'../../firestore.rules'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8')+fs.readFileSync(path.join(base,'00-lazy-areas.js'),'utf8');assert.match(nav,/pcp-central/);assert.match(nav,/renderPCPCentral/);assert.match(perm,/id:'pcp-central'/);assert.match(perm,/setor-pcp-shell/);assert.match(html,/id="setor-pcp-shell"/);assert.match(html,/78-pcp-central\.js/);for(const c of ['pcp_pedidos','pcp_requisicoes_compra','pcp_agendamentos','pcp_solicitacoes_producao'])assert.match(rules,new RegExp('match /'+c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));});
test('PCP calcula linha do tempo e identifica ruptura por data',()=>{const h=load([{cod:'T',produto:'T',estoqueNormalizado:100,projFinal:70,projSemanal:70}]);const v=h.construirVisao({produtos:[{cod:'T',nome:'T'}],projecao:[{cod:'T'}],pedidos:[{cod:'T',quantidade:150,quantidadeAtendida:0,status:'pendente',dataNecessaria:'2026-08-20'}],ops:[{prodCod:'T',qntCaixas:30,realizadoCaixas:0,status:'programado',data:'2026-08-18'}],agendamentos:[],requisicoes:[]})[0];assert.equal(v.eventos.length,2);assert.equal(v.proximoEvento.tipo,'producao');assert.equal(v.proximoEvento.saldoApos,130);assert.equal(v.rupturaEm,'2026-08-20');});

// PEDIDO AO VIVO (2026-09-02): "dados-estoque só é pra trazer o estoque
// mesmo... dados-escadinha também tem o nome do mesmo produto, bate um
// produto com outro pelo código — no escadinha é cod, no estoque é sku" —
// as abas Estoque/Pedidos x Estoque passam a montar a lista de produtos a
// partir desses 2 arquivos do BI (não mais do cadastro), com o plano do
// escadinha alimentando o consumo mensal/cobertura.
// PEDIDO AO VIVO (2026-09-02, 4ª rodada): "verifica essa aba, tá puxando o
// saldo errado" — comparado com uma tela de referência real (Power BI), o
// arquivo certo é produtos_estoque.json (742 linhas, UMA POR LOJA —
// MATRIZ/FILIAL SP/CAMBUCI — precisa SOMAR estoque e quantidadePedidos de
// todas as lojas pelo mesmo produto_key), não o arquivo de 1 linha por
// produto usado antes. Escadinha só entra pra alimentar consumo/cobertura.
// PEDIDO AO VIVO (2026-09-02, 5ª rodada): "quero que o consumo dia seja
// calculado dos 3 últimos meses tipo junho+julho+agosto=/3" — consumoDia
// passou de plano[mesIndice] (previsão do mês corrente) pra média dos 3
// últimos meses FECHADOS de venda real (real[12]); mesIndice=7 (agosto)
// então o mês corrente é agosto e os 3 fechados são maio/junho/julho
// (índices 4/5/6).
test('_juntarEstoqueBi: soma estoque e pedidos de TODAS as lojas do mesmo produto_key; consumo vira a média real dos 3 últimos meses fechados',()=>{
  const h=load();
  const dadosProdutosEstoque=[
    {loja:'DA TERRINHA - MATRIZ',produto_key:304,produto:'00001 TAPIOCA DA TERRINHA 1 KG - CX 12',quantidade_estoque:100,quantidadePedidos:50},
    {loja:'DA TERRINHA - FILIAL SP',produto_key:304,produto:'00001 TAPIOCA DA TERRINHA 1 KG - CX 12',quantidade_estoque:800,quantidadePedidos:250},
  ];
  const dadosEscadinha={produtos:[{cod:304,produto:'TAPIOCA DA TERRINHA 1 KG - CX 12',plano:[644,800,900,1000,1100,1100,850,850,850,850,850,850],real:[600,700,750,650,600,700,800,0,0,0,0,0]}]};
  const mapa=h._juntarEstoqueBi(dadosProdutosEstoque,dadosEscadinha,7);
  const item=mapa.get('304');
  assert.ok(item);
  assert.equal(item.estoque,900,'100 (matriz) + 800 (filial sp) somados');
  assert.equal(item.pedido,300,'50 + 250 somados');
  assert.equal(item.consumoDia,(800+700+600)/3/31,'média de julho(800)+junho(700)+maio(600) dividida pelos 31 dias de agosto (mês corrente, índice 7)');
  assert.deepEqual(item.plano,dadosEscadinha.produtos[0].plano,'plano[12] continua guardado inteiro só pra Linha do Tempo projetar meses futuros');
  // PEDIDO AO VIVO (2026-09-07): "não quero consumo dia... quero consumo
  // mesmo, a média dos 3 últimos meses" — consumoMensal é a mesma média,
  // sem dividir pelos dias.
  assert.equal(item.consumoMensal,(800+700+600)/3,'média de julho+junho+maio, sem dividir pelos dias do mês');
  // "previsão... é pra colocar previsão mensal" — mês seguinte ao mês
  // corrente (agosto, índice 7), vindo do plano[]: setembro, índice 8.
  assert.equal(item.previsaoMensal,850,'plano[8] = setembro, o mês seguinte ao mês corrente (agosto)');
});
test('_juntarEstoqueBi: previsaoMensal fica 0 (não embrulha pro ano seguinte) quando o mês seguinte cai fora do ano coberto pelo plano[]',()=>{
  const h=load();
  const dadosProdutosEstoque=[{loja:'MATRIZ',produto_key:1,produto:'X',quantidade_estoque:10,quantidadePedidos:0}];
  // mesIndice=11 (dezembro, "hoje"=dezembro) -> mesRef=10 (novembro) ->
  // idxPrevisao=12, fora do array (só tem índices 0-11) -> não pode virar
  // janeiro DESTE ano (índice 0) por engano.
  const dadosEscadinha={produtos:[{cod:1,produto:'X',plano:[1,2,3,4,5,6,7,8,9,10,11,12],real:new Array(12).fill(0)}]};
  const mapa=h._juntarEstoqueBi(dadosProdutosEstoque,dadosEscadinha,11);
  const item=mapa.get('1');
  assert.equal(item.previsaoMensal,0,'mês seguinte (índice 12) não existe no plano deste ano — fica 0, nunca vira o índice 0 (janeiro deste ano) por engano');
});
test('_juntarEstoqueBi: sem correspondência no escadinha, estoque/pedido continuam somados normalmente, só consumo fica 0 (nunca perde o produto)',()=>{
  const h=load();
  const dadosProdutosEstoque=[{loja:'MATRIZ',produto_key:99999,produto:'SEM ESCADINHA DA TERRINHA',quantidade_estoque:100,quantidadePedidos:20}];
  const mapa=h._juntarEstoqueBi(dadosProdutosEstoque,{produtos:[]},0);
  const item=mapa.get('99999');
  assert.equal(item.produto,'SEM ESCADINHA DA TERRINHA');
  assert.equal(item.estoque,100);
  assert.equal(item.pedido,20);
  assert.equal(item.consumoDia,0);
});
// PEDIDO AO VIVO (2026-09-02, 4ª rodada, "codsValidos"): mesma proteção
// contra lixo que 101-relatorios-bi.js já usa (produtos_estoque.json
// mistura produto de venda de verdade com item que não é cadastro real) —
// só entra produto_key que já está no cadastro (producao_produtos ∪
// pcp_produtos_bluesoft, já carregado em `produtos`, sem leitura nova).
test('_juntarEstoqueBi: com codsValidos, produto_key fora do cadastro real não entra',()=>{
  const h=load();
  const dadosProdutosEstoque=[
    {loja:'MATRIZ',produto_key:304,produto:'TAPIOCA DA TERRINHA 1 KG - CX 12',quantidade_estoque:100,quantidadePedidos:20},
    {loja:'MATRIZ',produto_key:999,produto:'MKT TRADE - FOGAO ELETRICO',quantidade_estoque:5,quantidadePedidos:0},
  ];
  const codsValidos=new Set(['304']);
  const mapa=h._juntarEstoqueBi(dadosProdutosEstoque,{produtos:[]},0,codsValidos);
  assert.equal(mapa.has('304'),true);
  assert.equal(mapa.has('999'),false,'produto_key fora do cadastro real não entra, mesmo tendo linha no arquivo');
});
// BUG AO VIVO REAL (2026-09-04, "verifica pq não foi atualizado
// corretamente"): a mesma descrição comercial aparece 2x em
// produtos_estoque.json com produto_key DIFERENTE — o caixa/fardo de
// verdade ("...CX 24", produto_key 305) e a venda avulsa do MESMO item
// físico ("...UND", produto_key 2, listada DEPOIS no arquivo). A tela
// mostrava o NOME do caixa mas os NÚMEROS da variante solta — confirmado
// comparando com o produtos_estoque.json real (TAPIOCA 500G: linha exibida
// como "CX 24" com estoque 31.921/pedido 0, que são exatamente os números
// da linha "UND", enquanto o caixa de verdade tinha 18.270/11.054).
test('_juntarEstoqueBi: linha "- UND" é ignorada quando existe uma linha irmã "- CX"/"- FD" com a MESMA descrição-base (mesmo produto físico, produto_key diferente)',()=>{
  const h=load();
  const dadosProdutosEstoque=[
    {loja:'DA TERRINHA - MATRIZ',produto_key:305,produto:'00002 TAPIOCA DA TERRINHA 500 G - CX 24',quantidade_estoque:1200,quantidadePedidos:450},
    {loja:'DA TERRINHA - FILIAL SP',produto_key:305,produto:'00002 TAPIOCA DA TERRINHA 500 G - CX 24',quantidade_estoque:17070,quantidadePedidos:10604},
    {loja:'DA TERRINHA - FILIAL SP',produto_key:2,produto:'00002 TAPIOCA DA TERRINHA 500 G - UND',quantidade_estoque:31921,quantidadePedidos:null},
  ];
  const mapa=h._juntarEstoqueBi(dadosProdutosEstoque,{produtos:[]},0);
  assert.equal(mapa.has('2'),false,'a linha solta (UND) não vira uma entrada própria — é duplicata do caixa');
  const caixa=mapa.get('305');
  assert.ok(caixa,'o caixa (produto_key real) continua presente');
  assert.equal(caixa.estoque,18270,'1200+17070 — NUNCA soma com a linha UND (31921)');
  assert.equal(caixa.pedido,11054,'450+10604');
  assert.equal(caixa.produto,'00002 TAPIOCA DA TERRINHA 500 G - CX 24');
});
test('_juntarEstoqueBi: produto que SÓ existe em "- UND" (sem irmão CX/FD nenhum) continua aparecendo normalmente — não é duplicata de nada',()=>{
  const h=load();
  const dadosProdutosEstoque=[
    {loja:'MATRIZ',produto_key:1701,produto:'01701 ACAFRAO DA TERRINHA 30 g - UND',quantidade_estoque:40,quantidadePedidos:5},
  ];
  const mapa=h._juntarEstoqueBi(dadosProdutosEstoque,{produtos:[]},0);
  const item=mapa.get('1701');
  assert.ok(item,'produto vendido só em unidade não pode sumir da tela');
  assert.equal(item.estoque,40);
  assert.equal(item.pedido,5);
});
test('_juntarEstoqueBi: linha "- UN" (2 letras, mesma convenção de venda avulsa) também é reconhecida e ignorada quando há irmã CX/FD',()=>{
  const h=load();
  const dadosProdutosEstoque=[
    {loja:'MATRIZ',produto_key:50,produto:'00050 PRODUTO TESTE 1 KG - CX 10',quantidade_estoque:500,quantidadePedidos:100},
    {loja:'MATRIZ',produto_key:51,produto:'00050 PRODUTO TESTE 1 KG - UN',quantidade_estoque:9999,quantidadePedidos:0},
  ];
  const mapa=h._juntarEstoqueBi(dadosProdutosEstoque,{produtos:[]},0);
  assert.equal(mapa.has('51'),false);
  assert.equal(mapa.get('50').estoque,500);
});
// PEDIDO AO VIVO (2026-09-04): "vamos supor é alho, aí ele mostra um alho
// triturado, alho pasta... toda coisa que for alho, ela só vai ficar ali a
// categoria alho, aí vai mostrar todas quando selecionar alho" — a
// categoria crua do Bluesoft (categoria/subGrupoProduto/classificacao) é
// granular demais (vira uma opção por variante/sabor); a categoria do
// filtro agora vem da PRIMEIRA PALAVRA do nome do produto.
test('_categoriaDoNome: primeira palavra do nome, ignorando o código numérico no início',()=>{
  const h=load();
  assert.equal(h._categoriaDoNome('00002 TAPIOCA DA TERRINHA 500 G - CX 24'),'TAPIOCA');
  assert.equal(h._categoriaDoNome('31101 ALHO PASTA DA TERRINHA 400 G - UND'),'ALHO');
  assert.equal(h._categoriaDoNome('01703 ALHO DESID FLOCOS DA TERRINHA 25 g'),'ALHO');
  assert.equal(h._categoriaDoNome('TAPIOCA DA TERRINHA 1 KG - CX 12'),'TAPIOCA','nome vindo da escadinha, sem código no início, funciona igual');
  assert.equal(h._categoriaDoNome(''),'');
  assert.equal(h._categoriaDoNome(null),'');
});
test('PEDIDO AO VIVO: filtrar por categoria "ALHO" mostra TODAS as variantes (triturado, pasta...) juntas — não uma categoria por variante',()=>{
  const h=load();
  h.setProdutos([
    {cod:'1',nome:'01703 ALHO DESID FLOCOS DA TERRINHA 25 g'},
    {cod:'2',nome:'31101 ALHO PASTA DA TERRINHA 400 G'},
    {cod:'3',nome:'00002 TAPIOCA DA TERRINHA 500 G - CX 24'},
  ]);
  h.setEstoqueBi(new Map([
    ['1',{cod:'1',produto:'01703 ALHO DESID FLOCOS DA TERRINHA 25 g',estoque:10,pedido:0}],
    ['2',{cod:'2',produto:'31101 ALHO PASTA DA TERRINHA 400 G',estoque:20,pedido:0}],
    ['3',{cod:'3',produto:'00002 TAPIOCA DA TERRINHA 500 G - CX 24',estoque:30,pedido:0}],
  ]));
  h.setFiltros({categoria:'ALHO'});
  const v=h.visaoFiltrada();
  assert.equal(v.length,2,'as 2 variantes de alho aparecem juntas');
  assert.ok(v.every(x=>/ALHO/.test(x.produto)));
  assert.ok(!v.some(x=>/TAPIOCA/.test(x.produto)),'tapioca não entra no filtro de alho');
});
test('filtrosHtml: dropdown "Todos os tipos" foi removido; categorias aparecem agrupadas (uma opção "ALHO", não uma por variante)',()=>{
  const h=load();
  h.setProdutos([
    {cod:'1',nome:'01703 ALHO DESID FLOCOS DA TERRINHA 25 g'},
    {cod:'2',nome:'31101 ALHO PASTA DA TERRINHA 400 G'},
    {cod:'3',nome:'00002 TAPIOCA DA TERRINHA 500 G - CX 24'},
  ]);
  const html=h.filtrosHtml();
  assert.doesNotMatch(html,/Todos os tipos/,'dropdown de tipo removido da tela');
  assert.doesNotMatch(html,/data-pcp-filtro="tipo"/);
  const opcoesCategoria=[...html.matchAll(/<option\s*>([^<]+)<\/option>/g)].map(m=>m[1]);
  assert.deepEqual(opcoesCategoria.sort(),['ALHO','TAPIOCA'],'2 categorias agrupadas, não 3 (uma por produto)');
});
// PEDIDO AO VIVO (2026-09-04): "necessidades de compra e de produção...
// em cima do saldo ve o quanto tem e ve o quanto precisa pra o estoque
// durar 30 dias depois do produto entrar em estoque" — com estoqueBi
// (Estoque/Pedidos x Estoque/Compras/Produção), a meta de cobertura sem
// configuração própria no produto tinha um bug silencioso: o `motor`
// (PCPDemandEngine) é forçado a null quando `bi` existe, então
// `motor?.targetDays??0` sempre caía pro 0 — necessidade praticamente
// zerada pra todo produto sem meta manual configurada. Agora o padrão é
// 30 dias fixos.
test('construirVisao com estoqueBi: sem meta configurada no produto, a meta de cobertura é 30 dias fixos (antes caía silenciosamente pra 0, via motor=null)',()=>{
  const h=load();
  const estoqueBi=new Map([['1',{cod:'1',produto:'PRODUTO X',estoque:100,pedido:0,consumoDia:10}]]);
  const v=h.construirVisao({produtos:[{cod:'1',nome:'PRODUTO X'}],projecao:[],pedidos:[],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.diasAlvo,30);
  assert.equal(v.estoqueAlvo,300,'consumoDia(10) * 30 dias');
  assert.equal(v.necessidade,200,'precisa de mais 200 (300 de meta - 100 que já tem) pro estoque durar 30 dias');
});
test('construirVisao com estoqueBi: meta própria configurada no produto (metaCoberturaDias) continua tendo prioridade sobre os 30 dias padrão',()=>{
  const h=load();
  const estoqueBi=new Map([['1',{cod:'1',produto:'PRODUTO X',estoque:100,pedido:0,consumoDia:10}]]);
  const v=h.construirVisao({produtos:[{cod:'1',nome:'PRODUTO X',metaCoberturaDias:45}],projecao:[],pedidos:[],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.diasAlvo,45,'meta manual do produto (45) vence o padrão de 30');
  assert.equal(v.estoqueAlvo,450);
});
test('construirVisao com estoqueBi: necessidade desconta produção programada e entradas previstas — "depois do produto entrar em estoque"',()=>{
  const h=load();
  const estoqueBi=new Map([['1',{cod:'1',produto:'PRODUTO X',estoque:50,pedido:0,consumoDia:10}]]);
  const v=h.construirVisao({
    produtos:[{cod:'1',nome:'PRODUTO X'}],projecao:[],pedidos:[],
    ops:[{prodCod:'1',qntCaixas:100,realizadoCaixas:0,status:'programado'}],
    agendamentos:[{cod:'1',quantidade:80,quantidadeRecebida:0,status:'prevista'}],
    requisicoes:[],estoqueBi,
  })[0];
  // meta 300 (10*30) - estoque 50 - produção programada 100 - entrada prevista 80 = 70
  assert.equal(v.necessidade,70,'já considera o que está programado/agendado pra entrar antes de sugerir mais');
});
test('construirVisao com estoqueBi: saldo já cobre os 30 dias — necessidade zerada, não fica negativa',()=>{
  const h=load();
  const estoqueBi=new Map([['1',{cod:'1',produto:'PRODUTO X',estoque:1000,pedido:0,consumoDia:10}]]);
  const v=h.construirVisao({produtos:[{cod:'1',nome:'PRODUTO X'}],projecao:[],pedidos:[],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.necessidade,0);
});
test('construirVisao com estoqueBi: sem produto cadastrado (nunca teve empresaProdutoraId/maquina) e nenhuma pedido/produção/entrada — mesmo assim calcula a necessidade em cima do saldo do BI',()=>{
  const h=load();
  const estoqueBi=new Map([['70268',{cod:'70268',produto:'MOLHO ARABE',estoque:0,pedido:0,consumoDia:5}]]);
  const v=h.construirVisao({produtos:[],projecao:[],pedidos:[],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.necessidade,150,'sem nada em estoque, precisa de 5*30=150 pra cobrir 30 dias');
});
// BUG AO VIVO REAL (2026-09-04): "a necessidade só cobre o negativo, não
// coloca um saldo pros 30 dias ou os dias configurados pro produto" —
// achada a causa raiz: TODO produto novo cadastrado em Ficha Técnica
// (60-producao-ficha-tecnica.js, linha do template `_novo:true`) grava
// metaCoberturaDias:0 por padrão. 0 não é undefined/null/'', então
// temMetaConfigurada dava TRUE com meta zero — diasAlvo/estoqueAlvo
// zerados pra praticamente todo produto que ninguém configurou de
// propósito.
test('construirVisao com estoqueBi: metaCoberturaDias:0 (valor padrão de todo produto novo em Ficha Técnica) NÃO conta como meta configurada — cai pro padrão de 30 dias',()=>{
  const h=load();
  const estoqueBi=new Map([['1',{cod:'1',produto:'PRODUTO X',estoque:100,pedido:0,consumoDia:10}]]);
  const v=h.construirVisao({produtos:[{cod:'1',nome:'PRODUTO X',metaCoberturaDias:0}],projecao:[],pedidos:[],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.diasAlvo,30,'meta 0 é tratada como "não configurada", não como "configurada pra zero"');
  assert.equal(v.necessidade,200,'volta a incluir o colchão de 30 dias, não só cobrir o saldo negativo');
});
test('construirVisao com estoqueBi: metaCoberturaDias negativo também não conta como configurada (defensivo, mesmo tratamento do 0)',()=>{
  const h=load();
  const estoqueBi=new Map([['1',{cod:'1',produto:'PRODUTO X',estoque:100,pedido:0,consumoDia:10}]]);
  const v=h.construirVisao({produtos:[{cod:'1',nome:'PRODUTO X',metaCoberturaDias:-5}],projecao:[],pedidos:[],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.diasAlvo,30);
});
test('comprasHtml: coluna "Cobertura atual" mostra o valor NEGATIVO de verdade (não um "0.0d" genérico) quando o produto já está abaixo do comprometido',()=>{
  const h=load();
  const item={key:'1',cod:'1',produto:'PRODUTO NEGATIVO',necessidade:200,estoqueDisponivel:-90,consumoDia:10,rupturaEm:null};
  const html=h.comprasHtml([item]);
  assert.match(html,/-9\.0d/,'cobertura real: -90 disponível / 10 por dia = -9 dias, não 0.0d');
  assert.doesNotMatch(html,/>0\.0d</);
});
test('construirVisao com estoqueBi: coberturaDias GLOBAL continua com o piso em 0 (Math.max(0,...)) — comportamento existente preservado pros relatórios que dependem dele',()=>{
  const h=load();
  const estoqueBi=new Map([['1',{cod:'1',produto:'PRODUTO X',estoque:10,pedido:100,consumoDia:10}]]);
  const v=h.construirVisao({produtos:[],projecao:[],pedidos:[],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.estoqueDisponivel,-90);
  assert.equal(v.coberturaDias,0,'campo global permanece com piso 0 — quem quer o valor negativo de verdade recalcula localmente (comprasHtml/cruzamentoHtml)');
});
test('construirVisao com estoqueBi: nome do produto vem do cadastro interno (número completo), não do texto cru do BI',()=>{
  const h=load();
  const estoqueBi=new Map([['304',{cod:'304',produto:'TAPIOCA DA TERRINHA 1 KG - CX 12',estoque:1000,consumoDia:10}]]);
  const v=h.construirVisao({produtos:[{cod:'304',nome:'00001 TAPIOCA DA TERRINHA 1 KG - CX 12'}],projecao:[],pedidos:[],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.produto,'00001 TAPIOCA DA TERRINHA 1 KG - CX 12','nome completo do cadastro, não o texto sem prefixo do BI');
});
test('construirVisao com estoqueBi: a lista de produtos vira só a do BI — produto com pedido cadastrado mas fora do BI some da tela',()=>{
  const h=load();
  const estoqueBi=new Map([['70268',{cod:'70268',produto:'MOLHO ARABE',estoque:912,consumoDia:850/30}]]);
  const v=h.construirVisao({produtos:[],projecao:[],pedidos:[{cod:'OUTRO',produto:'Fora do BI',quantidade:50,status:'pendente'}],ops:[],agendamentos:[],requisicoes:[],estoqueBi});
  assert.equal(v.length,1,'só o produto do BI aparece, o pedido de um produto fora do BI não gera linha');
  assert.equal(v[0].produto,'MOLHO ARABE');
  assert.equal(v[0].estoqueAtual,912);
});
// PEDIDO AO VIVO (2026-09-02, 2ª rodada): "nem tem um arquivo que mostra
// quanto tem de pedido" — com estoqueBi, "Pedidos" vem de
// quantidadePedidos (produtos_estoque.json, somado entre lojas via
// _juntarEstoqueBi), não mais de pcp_pedidos (Firestore, cadastro manual).
test('construirVisao com estoqueBi: "Pedidos" vem do bi.pedido (produtos_estoque.json), não de pcp_pedidos (Firestore é ignorado pros produtos do BI)',()=>{
  const h=load();
  const estoqueBi=new Map([['304',{cod:'304',produto:'TAPIOCA',estoque:1000,consumoDia:100,pedido:700}]]);
  const v=h.construirVisao({produtos:[],projecao:[],pedidos:[{cod:'304',produto:'Tapioca',quantidade:99999,quantidadeAtendida:0,status:'pendente'}],ops:[],agendamentos:[],requisicoes:[],estoqueBi})[0];
  assert.equal(v.estoqueAtual,1000);
  assert.equal(v.pendente,700,'usa bi.pedido (700), ignora o valor absurdo que veio do Firestore (99999)');
  assert.equal(v.saldo,300);
  assert.equal(v.coberturaDias,3,'disponível (300) / consumoDia (100)');
});

// PEDIDO AO VIVO (2026-09-02): nova aba Insumos — "só os produtos que
// tenham estoque ou que vão ser necessário o uso", cobertura/necessidade
// recalculadas do zero (não usa status/sugestaoCompra que o BI já traz
// pronto), consumo de entrada = projecaoBom (não consumoMensal).
// BUG AO VIVO REAL (2026-09-04): "os insumos não tá atualizando certo" —
// dados-insumos.json tem 1 linha por LOJA pro mesmo sku (igual
// produtos_estoque.json), mas _juntarInsumosBi nunca somava — um insumo
// usado em mais de uma loja virava várias linhas, cada uma só com uma
// fração do estoque real (confirmado com o BI de verdade: sku 79922
// "SUSPENSÃO OLEOSA URUCUM" tinha 363kg na loja 11 e 660kg na loja 14,
// separados).
test('_juntarInsumosBi: soma estoque e projecaoBom de TODAS as lojas do mesmo sku (igual _juntarEstoqueBi já faz pra produto acabado)',()=>{
  const h=load();
  const dadosInsumos={produtos:[
    {sku:'79922',produto:'MP – SUSPENSÃO OLEOSA URUCUM KG',estoque:363,projecaoBom:183,unidade:'kg',categoria:'MATERIA PRIMA'},
    {sku:'79922',produto:'MP – SUSPENSÃO OLEOSA URUCUM KG',estoque:660,projecaoBom:317,unidade:'kg',categoria:'MATERIA PRIMA'},
  ]};
  const lista=h._juntarInsumosBi(dadosInsumos,0);
  assert.equal(lista.length,1,'as 2 linhas (uma por loja) viram 1 só, não 2 duplicadas');
  assert.equal(lista[0].estoque,1023,'363+660 somado, não a última linha sobrescrevendo a primeira');
});
test('_juntarInsumosBi: filtra só estoque>0 ou projecaoBom>0, recalcula cobertura/necessidade com meta de 30 dias',()=>{
  const h=load();
  const dadosInsumos={produtos:[
    {sku:'1',produto:'Com estoque parado',tipo:'Embalagem',categoria:'EMBALAGEM PRIMARIA',estoque:100,projecaoBom:0,status:'Excesso',sugestaoCompra:999},
    {sku:'2',produto:'Precisa comprar',tipo:'Matéria-prima',categoria:'MATERIA PRIMA',estoque:10,projecaoBom:310},
    {sku:'3',produto:'Sem estoque e sem necessidade',tipo:'Embalagem',categoria:'EMBALAGEM',estoque:0,projecaoBom:0},
  ]};
  const lista=h._juntarInsumosBi(dadosInsumos,0); // janeiro, 31 dias
  assert.equal(lista.length,2,'insumo sem estoque e sem projecaoBom fica de fora');
  const precisa=lista.find(x=>x.cod==='2');
  assert.equal(precisa.consumoDia,10,'projecaoBom(310)/31 dias de janeiro');
  assert.equal(precisa.estoqueAlvo,300,'consumoDia(10) * meta de 30 dias');
  assert.equal(precisa.necessidade,290,'estoqueAlvo(300) - estoque(10)');
  const paradoItem=lista.find(x=>x.cod==='1');
  assert.equal(paradoItem.necessidade,0,'sem projecaoBom, não gera necessidade mesmo com status/sugestaoCompra do BI dizendo outra coisa');
});
test('_juntarInsumosBi: ordena por necessidade decrescente (maior falta primeiro)',()=>{
  const h=load();
  const dadosInsumos={produtos:[
    {sku:'A',produto:'Falta pouco',estoque:290,projecaoBom:310},
    {sku:'B',produto:'Falta muito',estoque:0,projecaoBom:310},
  ]};
  const lista=h._juntarInsumosBi(dadosInsumos,0);
  assert.equal(lista[0].cod,'B');
  assert.equal(lista[1].cod,'A');
});
// PEDIDO AO VIVO (2026-09-02): "deixe parecido [com o Power BI de
// referência], se ficar negativo colocar o fundo vermelho e letra branca
// no saldo, e colocar a coluna de cobertura, a cobertura vai ser calculada
// em cima da coluna saldo"
test('cruzamentoHtml: saldo negativo ganha fundo vermelho/letra branca e coluna Cobertura é saldo/consumoDia (aceita negativo)',()=>{
  const h=load();
  const html=h.cruzamentoHtml([
    {key:'k1',produto:'Produto Positivo',estoqueAtual:100,pendente:20,saldo:80,consumoDia:10},
    {key:'k2',produto:'Produto Negativo',estoqueAtual:10,pendente:50,saldo:-40,consumoDia:10},
    {key:'k3',produto:'Sem Consumo',estoqueAtual:5,pendente:0,saldo:5,consumoDia:0},
  ]);
  assert.match(html,/<th>Cobertura<\/th>/);
  const linhaPositiva=html.slice(html.indexOf('Produto Positivo'),html.indexOf('Produto Negativo'));
  assert.doesNotMatch(linhaPositiva,/background:#c0392b/,'saldo positivo não ganha fundo vermelho');
  assert.match(linhaPositiva,/>8d<\/td>/,'cobertura = saldo(80)\/consumoDia(10) = 8 dias');
  const linhaNegativa=html.slice(html.indexOf('Produto Negativo'),html.indexOf('Sem Consumo'));
  assert.match(linhaNegativa,/style="background:#c0392b;color:#fff"/,'saldo negativo ganha fundo vermelho e letra branca');
  assert.match(linhaNegativa,/>-4d<\/td>/,'cobertura negativa = saldo(-40)\/consumoDia(10) = -4 dias, sem clamp em 0');
  const linhaSemConsumo=html.slice(html.indexOf('Sem Consumo'));
  assert.match(linhaSemConsumo,/>—<\/td>/,'sem consumoDia, cobertura fica indefinida (travessão)');
});

// PEDIDO AO VIVO (2026-09-07): "o saldo que é pra aparecer lá não é pra
// trazer saldo de compra, saldo de produção... é estoque menos pedido, que
// dá o saldo. Não é pra trazer 'ah tem compra disso, vai ficar o saldo
// tal'" — item.saldo (usado em Necessidades de Compra e no 🧮 memória de
// cálculo) soma produção programada + entradas previstas de propósito, mas
// a tabela Pedidos x Estoque tem que mostrar só Estoque − Pedidos, batendo
// exatamente com as 2 colunas visíveis ao lado — nunca o saldo "cheio".
test('cruzamentoHtml: Saldo da tabela é SEMPRE Estoque − Pedidos, mesmo quando item.saldo (cheio, com produção/entradas somadas) é diferente',()=>{
  const h=load();
  const html=h.cruzamentoHtml([
    // item.saldo=5000 (bem maior que 100-9219=-9119) simula produção
    // programada/entradas grandes já somadas no campo cheio — a tabela não
    // pode mostrar esse 5000, só a conta simples das colunas visíveis.
    {key:'k1',produto:'Bicarbonato Simulado',estoqueAtual:4471,pendente:9219,saldo:5000,consumoDia:250},
  ]);
  assert.match(html,/-4\.748<\/b>/,'Saldo mostrado é 4471-9219=-4748, não os 5000 de item.saldo');
  assert.doesNotMatch(html,/5\.000<\/b>/,'o saldo "cheio" (com produção/entradas) nunca aparece nesta tabela');
  assert.match(html,/style="background:#c0392b;color:#fff"/,'saldo simples negativo (-4748) ainda ganha o destaque vermelho');
});

// PEDIDO AO VIVO (2026-09-07): "eu quero que coloque consumo mesmo, que
// vai pegar a média dos três últimos meses... não quero consumo dia não"
test('estoqueHtml: mostra "Consumo" (mensal), não "Consumo/dia"',()=>{
  const h=load();
  const html=h.estoqueHtml([{key:'k1',produto:'Produto X',estoqueAtual:100,estoqueComprometido:20,estoqueDisponivel:80,estoqueMinimo:10,consumoMensal:930,coberturaDias:8,diasAlvo:30,necessidade:50}]);
  assert.doesNotMatch(html,/Consumo\/dia/,'cabeçalho antigo "Consumo/dia" não aparece mais');
  assert.match(html,/>Consumo</,'cabeçalho novo é só "Consumo"');
  assert.match(html,/>930</,'mostra o valor mensal (930), não um valor diário');
});

// PEDIDO AO VIVO (2026-09-07): "da programação de produção... é pra
// colocar venda média mensal. Previsão dia é pra colocar previsão mensal"
test('prodReqHtml: mostra "Venda média mensal" e "Previsão mensal" (consumoMensal/previsaoMensal), não os campos diários do motor antigo',()=>{
  const h=load();
  h.setSolProd([]);
  // produzidoInternamente(key) exige um cadastro com máquina — sem isso a
  // linha some do filtro (é o critério real de "produto de produção própria").
  h.setProdutos([{cod:'80643',nome:'Milho Pipoca',maquina:'Alfateck 15'}]);
  const html=h.prodReqHtml([{key:'80643',cod:'80643',produto:'Milho Pipoca',necessidade:500,estoqueDisponivel:7240,consumoMensal:5696,previsaoMensal:6000,pendente:0,diasAlvo:30,rupturaEm:null}]);
  assert.match(html,/Venda média mensal/);
  assert.match(html,/Previsão mensal/);
  assert.doesNotMatch(html,/Venda média\/dia/);
  assert.doesNotMatch(html,/Previsão\/dia/);
  assert.match(html,/>5\.696</,'venda média mensal mostra consumoMensal, não demandaHistoricaDia (que ficava sempre "—" pros produtos do BI)');
  assert.match(html,/>6\.000</,'previsão mensal mostra previsaoMensal, não previsaoFuturaDia');
});
