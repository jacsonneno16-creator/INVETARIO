// PCP — Fase 2: central de planejamento. Reutiliza estoque/projecao e OPs da Produção.
(function(global){'use strict';
const CPED='pcp_pedidos', CREQ='pcp_requisicoes_compra', CAGE='pcp_agendamentos', CPRODREQ='pcp_solicitacoes_producao_global', CREGR='compras_regras_comprador';
const CPROD='producao_produtos', CPRODAPI='pcp_produtos_bluesoft', CPROJ='producao_projecao', CESTAPI='pcp_estoque_bluesoft', COP='producao_registros';
let pedidos=[],reqs=[],agend=[],solProd=[],produtos=[],projecao=[],ops=[],regrasCompradores=[],lojas=[],aba='pedidos',carregado=false;
// PEDIDO AO VIVO (2026-09-02): "esse dados-estoque... só é pra trazer o
// estoque mesmo... aí tem outro arquivo, dados-escadinha, que também tem o
// nome do mesmo produto... é só bater um produto com outro, pelo código —
// no escadinha está como cod, no estoque está como sku" — só as abas
// Estoque e Pedidos x Estoque passam a usar essas 2 fontes (produto/
// estoque/consumo vêm do BI, não mais do cadastro/Bluesoft-sync); as
// demais abas (Pedidos, Compras, Agendamentos, Programação) continuam
// exatamente como estavam. "Se o produto não aparece aqui, não é pra
// aparecer no estoque versus pedido".
// PEDIDO AO VIVO (2026-09-02, 4ª rodada): "verifica essa aba, tá puxando o
// saldo errado" — comparado com uma tela de referência real (Power BI), os
// números batiam com `produtos_estoque.json` (742 linhas, UMA POR LOJA —
// MATRIZ/FILIAL SP/CAMBUCI/etc — precisa SOMAR estoque e quantidadePedidos
// de todas as lojas por produto_key), não com `dados-estoque.json` (81
// itens, um só por produto) que eu tinha usado a manhã toda. Trocado.
// `dados-estoque.json` não é mais usado por este arquivo.
const ARQUIVO_BI_ESTOQUE='produtos_estoque.json', ARQUIVO_BI_ESCADINHA='dados-escadinha.json';
let _estoqueBi=null,_ultimaBuscaEstoqueBi='';
// PEDIDO AO VIVO (2026-09-02): nova aba "Insumos" — mesmo padrão da aba
// Estoque, mas pra insumo (embalagem/matéria-prima), fonte dados-insumos.json
// (472 itens, já vem com tipo/categoria/estoque/projecaoBom prontos do BI).
// "Só os produtos que tenham estoque ou que vão ser necessário o uso" —
// filtra estoque>0 || projecaoBom>0. Cobertura/necessidade recalculadas por
// nós (usuário pediu "recalcular do zero", não usar o status/sugestaoCompra
// já pronto do BI) — consumo de entrada é o `projecaoBom` (não
// consumoMensal), dividido pelos dias do mês atual, com meta de 30 dias
// (mesmo padrão usado pra produto, ver 81-pcp-parametros).
const ARQUIVO_BI_INSUMOS='dados-insumos.json';
const META_COBERTURA_INSUMO_DIAS=30;
// PEDIDO AO VIVO (2026-09-04): "necessidades de compra e de produção...
// em cima do saldo, vê o quanto tem e vê o quanto precisa pro estoque
// durar 30 dias depois do produto entrar em estoque" — meta padrão de
// cobertura pra produto acabado quando os dados vêm do BI (saldo real).
// Só entra quando o produto NÃO tem meta própria configurada no cadastro
// (metaCoberturaDias/coberturaMetaDias) — essa continua tendo prioridade.
const META_COBERTURA_PRODUTO_DIAS=30;
let _insumosBi=null,_ultimaBuscaInsumosBi='';
let filtros={loja:'',busca:'',marca:'',categoria:'',situacao:'',ocultarZerados:true};
// PEDIDO AO VIVO (2026-09-04): "vamos supor é alho, aí ele mostra um alho
// triturado, alho pasta... toda coisa que for alho, ela só vai ficar ali a
// categoria alho" — a categoria crua (Bluesoft: categoria/subGrupoProduto/
// classificacao) é granular demais e vira uma opção por variante/sabor.
// Deriva a categoria pela PRIMEIRA PALAVRA do nome do produto (ignorando o
// código numérico no início) — "ALHO TRITURADO", "ALHO PASTA" e "ALHO
// FRITO GRANULADO" viram todos "ALHO"; "TAPIOCA DA TERRINHA..." e "TAPIOCA
// MERC..." viram todos "TAPIOCA". Usada só pro filtro/agrupamento desta
// tela — não mexe em `categoria`/`classificacao` crus, que
// resolverComprador() ainda usa pra rotear pedido de compra por categoria
// Bluesoft de verdade.
function _categoriaDoNome(nome){return String(nome||'').replace(/^\d+\s*/,'').trim().split(/\s+/)[0]?.toUpperCase()||'';}
// PEDIDO AO VIVO (2026-08-27): "não quero que fique aparecendo produto
// zerados de pedido e de estoque" + "quando eu clicar no nome do produto
// filtra por ordem alfabética e as de valores ordenar por decrescente ou
// crescente" — ordenação clicável nas colunas de Estoque/Pedidos x
// Estoque, e um filtro pra esconder produto sem estoque E sem pedido
// pendente (ruído, sem ação nenhuma a tomar). `sortCampo=null` mantém a
// ordenação padrão de necessidade (já existente em construirVisao).
let sortCampo=null,sortDir=1;
function aplicarOrdenacao(v){
  if(!sortCampo)return v;
  return v.slice().sort((a,b)=>{
    const va=a[sortCampo],vb=b[sortCampo];
    if(sortCampo==='produto')return sortDir*String(va||'').localeCompare(String(vb||''),'pt-BR');
    return sortDir*((n(va)??0)-(n(vb)??0));
  });
}
function pcpOrdenarPor(campo){
  if(sortCampo===campo)sortDir=-sortDir;else{sortCampo=campo;sortDir=1;}
  desenhar();
}
function setaOrdenacao(campo){return sortCampo!==campo?'':(sortDir===1?' ▲':' ▼');}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v)||0; const fs=()=>global.getDTFirestore(); const raw=()=>global.getDTRawFirestore();
const tem=a=>typeof global.temPermissao!=='function'||global.temPermissao('pcp-central',a);
const norm=v=>String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const keyOf=x=>String(x?.cod??x?.prodCod??x?.prodKey??'').trim()||norm(x?.produto??x?.nome??x?.descricao??'');
const qtd=v=>Math.ceil(Math.max(0,n(v)));
// PEDIDO AO VIVO (2026-08-27): "o que tiver cadastrado lá na produção vai
// aparecer como produto pra compras? Vai desaparecer pros compradores...
// os produtos que não tiver cadastro de loja que produz, vai ter cadastro
// do fornecedor, aí sim vai entrar em solicitações de pedido" — produto com
// empresaProdutoraId cadastrado (produzido pela própria empresa) nunca
// deve virar sugestão de COMPRA; só entra como sugestão de PRODUÇÃO. O
// inverso (sem empresa produtora) só entra como sugestão de compra.
// PEDIDO AO VIVO (2026-09-02): "tem produto que tá cadastrado na produção
// que ainda aparece na tela de necessidade de compra" — na prática quase
// nenhum produto tem empresaProdutoraId preenchido (é um campo opcional,
// "empresa produtora", que o usuário raramente lembra de marcar); o sinal
// que realmente já existe pra todo produto cadastrado em Produção ›
// Cadastro de Produtos é a máquina (60-producao-ficha-tecnica.js:pftSalvar
// grava `maquina` em producao_produtos pra toda variante) — ter uma
// máquina cadastrada já é prova de que o produto é fabricado internamente,
// então agora conta como critério também. Trocado find()+?. por some()
// porque o merge por lojaId em carregar() pode gerar mais de uma entrada
// pro mesmo cod (uma vinda do Bluesoft sem máquina, outra do cadastro
// interno com máquina) — só olhar a primeira encontrada perdia a evidência.
const produzidoInternamente=key=>produtos.some(p=>keyOf(p)===key&&!!(p.empresaProdutoraId||p.maquina));
function now(){return new Date().toISOString();}
function statusBadge(s){s=String(s||'pendente');const c=/sem_comprador|sem_empresa_produtora/i.test(s)?'b-red':/cancel|rejeit/i.test(s)?'b-red':/parcial/i.test(s)?'b-orange':/final|recebid|atendid|produzid/i.test(s)?'b-green':/andamento|programad|comprad|em_producao|em_analise/i.test(s)?'b-blue':'b-orange';return `<span class="badge ${c}">${esc(s)}</span>`;}
function projLinhas(){try{return global.calcularProjecaoComRisco?.(global.getParametrosProducaoProjecao?.()||global.PRODUCAO_PROJECAO_PARAMETROS||{})||[];}catch(e){return [];}}
// PEDIDO AO VIVO (2026-09-02, 4ª rodada): "verifica essa aba, tá puxando o
// saldo errado" — comparado com uma tela de referência real (Power BI), os
// números batiam com produtos_estoque.json (742 linhas — UMA POR LOJA:
// MATRIZ/FILIAL SP/CAMBUCI/etc, mesmo produto_key repetido) SOMADO entre
// todas as lojas, não com o arquivo de 1-linha-por-produto usado antes.
// Depois soma por produto_key, junta com dados-escadinha.json (plano[12]
// por mês, pelo mesmo código) só pra alimentar consumo/cobertura — estoque
// e pedidos NUNCA vêm da escadinha, só do arquivo de estoque somado.
// Proteção contra "lixo" misturado no arquivo (confirmado antes em outro
// relatório BI: "mistura produto de venda de verdade com lixo tipo MKT
// TRADE - FOGAO ELETRICO"): só entra produto_key que já está cadastrado em
// producao_produtos/pcp_produtos_bluesoft (`codsValidos`, opcional — já
// vem carregado no `produtos` deste mesmo arquivo, sem leitura nova).
// PEDIDO AO VIVO (2026-09-02, 5ª rodada): "quero que o consumo dia seja
// calculado dos 3 últimos meses tipo junho+julho+agosto=/3" — consumoDia
// deixa de vir do plano (previsão) do mês corrente e passa a vir da MÉDIA
// dos 3 últimos meses FECHADOS de venda real (real[12] da escadinha, não
// plano[12]), igual ao dia em que essa conversa aconteceu (2026-09-02): mês
// corrente = setembro, então médio de junho+julho+agosto. Mesmo padrão que
// _calcularVendaMesesEscadinha (66-producao-projecao.js) já usa pro
// venda_m1/m2/m3, só que lido direto do BI (sem depender de alguém ter
// clicado "Buscar do BI" na tela de Projeção nem do dado poder ficar
// velho lá). plano[12] continua guardado à parte só pra Linha do Tempo
// (83-pcp-timeline.js) projetar o consumo mês a mês no FUTURO — ali faz
// sentido usar previsão, aqui (consumo de hoje) faz sentido usar o real.
// PEDIDO AO VIVO (2026-09-04): "verifica pq não foi atualizado
// corretamente... todos os números" — comparado linha a linha com
// produtos_estoque.json, a tela mostrava a linha "CX 24" com o NOME certo
// mas os NÚMEROS da variante solta ("UND") de outro produto_key. Causa
// raiz: a mesma descrição comercial aparece 2x no arquivo com produto_key
// DIFERENTE — um pro caixa/fardo de verdade (ex.: produto_key 305, "...CX
// 24") e outro pra venda avulsa do MESMO item físico (ex.: produto_key 2,
// "...UND"). codsValidos (ver buscarEstoqueBi) tentava excluir a variante
// solta pelo cadastro (embalagemKeyBluesoft==='UN'), mas esse sinal não é
// confiável — o cadastro pode não ter mais um doc separado pra ela, ou o
// alias produtoUnitarioKeyBluesoft do caixa aponta de volta pra ela,
// fazendo a agregação por canon() (construirVisao) SOBRESCREVER o valor
// certo do caixa com o da solta (map com a mesma chave final, o BI lista o
// item solto DEPOIS do caixa no arquivo, então ele "ganha"). Corrigido
// direto na fonte, sem depender do cadastro: quando existe uma linha "- CX"
// ou "- FD" no PRÓPRIO arquivo com a mesma descrição-base (sem o sufixo de
// embalagem), a linha irmã "- UND"/"- UN" é ignorada por inteiro — é
// duplicata do mesmo produto físico, PCP planeja em caixa. Produto que só
// existe em unidade (sem irmão CX/FD nenhum — ~65 casos reais: temperos,
// farinhas pequenas etc.) continua aparecendo normalmente.
const SUFIXO_EMBALAGEM_RE=/-\s*(CX|FD|UND?)\s*\d*\s*$/i;
function _baseDescricaoSemEmbalagem(nome){return String(nome||'').replace(SUFIXO_EMBALAGEM_RE,'').trim().toUpperCase();}
function _juntarEstoqueBi(dadosProdutosEstoque,dadosEscadinha,mesIndice,codsValidos){
  if(mesIndice==null)mesIndice=new Date().getMonth();
  const mesRef=(mesIndice-1+12)%12;
  const porCodEscadinha=new Map();
  (dadosEscadinha?.produtos||[]).forEach(p=>{const cod=String(p.cod??'').trim();if(cod)porCodEscadinha.set(cod,p);});
  const hoje=new Date(),diasNoMes=new Date(hoje.getFullYear(),mesIndice+1,0).getDate();
  const linhas=Array.isArray(dadosProdutosEstoque)?dadosProdutosEstoque:[];
  const basesComCaixaOuFardo=new Set();
  linhas.forEach(it=>{if(/-\s*(CX|FD)\s*\d*\s*$/i.test(it.produto||''))basesComCaixaOuFardo.add(_baseDescricaoSemEmbalagem(it.produto));});
  const porChave=new Map();
  linhas.forEach(it=>{
    const cod=String(it.produto_key??'').trim();if(!cod)return;
    if(codsValidos&&codsValidos.size&&!codsValidos.has(cod))return;
    if(/-\s*UND?\s*$/i.test(it.produto||'')&&basesComCaixaOuFardo.has(_baseDescricaoSemEmbalagem(it.produto)))return;
    const acc=porChave.get(cod)||{cod,produto:it.produto||cod,estoque:0,pedido:0};
    acc.estoque+=n(it.quantidade_estoque);
    acc.pedido+=n(it.quantidadePedidos);
    if((it.produto||'').length>acc.produto.length)acc.produto=it.produto;
    porChave.set(cod,acc);
  });
  const out=new Map();
  porChave.forEach((acc,cod)=>{
    const esc=porCodEscadinha.get(cod);
    const real=esc?.real||[];
    const consumoMensal=esc?(n(real[mesRef])+n(real[(mesRef-1+12)%12])+n(real[(mesRef-2+12)%12]))/3:0;
    // PEDIDO AO VIVO (2026-09-07): "previsão... é pra colocar previsão
    // mensal" — mesma lógica de previsao_m1 de 66-producao-projecao.js
    // (_calcularVendaMesesEscadinha): mês seguinte ao mês corrente, vindo
    // do plano[] (meta/orçamento do ano, o único com dado de verdade pra
    // mês futuro — real[] é sempre 0 antes de acontecer). Nunca embrulha
    // pro ano seguinte (fica 0/omitido se cair fora do ano coberto).
    const plano=esc?.plano||null,idxPrevisao=mesRef+2;
    const previsaoMensal=plano&&idxPrevisao<=11?n(plano[idxPrevisao]):0;
    // PEDIDO AO VIVO (2026-09-02): "a linha do tempo pode usar a escadinha
    // pra saber até quando o estoque vai durar" — guarda o plano[12]
    // inteiro (não só o consumo do mês atual), pra Linha do Tempo
    // (83-pcp-timeline) descontar o consumo do MÊS certo conforme a
    // caminhada atravessa vários meses, em vez de uma taxa fixa.
    // PEDIDO AO VIVO (2026-09-07): "não quero consumo dia não... quero
    // consumo mesmo, que vai pegar a média dos três últimos meses" —
    // consumoMensal já era calculado aqui (média dos 3 meses fechados),
    // só não saía do escopo desta função; consumoDia continua existindo
    // igual (cobertura/necessidade em dias precisam dele), consumoMensal
    // passa a ir junto pra estoqueHtml poder mostrar o valor mensal de
    // verdade em vez de reconstruir por aproximação (consumoDia×dias).
    out.set(cod,{cod,produto:esc?.produto||acc.produto,estoque:acc.estoque,pedido:Math.max(0,acc.pedido),consumoDia:consumoMensal>0?consumoMensal/diasNoMes:0,consumoMensal,previsaoMensal,plano});
  });
  return out;
}
async function buscarEstoqueBi(){
  if(!global.DTBiPastaLocal?.suportado?.())return;
  const status=await global.DTBiPastaLocal.status();
  if(status!=='conectado'){const r=await global.DTBiPastaLocal.conectar();if(!r.ok){global.showToast?.(r.erro,'error');return;}}
  try{
    if(!produtos.length)await carregar();
    // PEDIDO AO VIVO (2026-09-02): "esses produtos que lá no arquivo fala
    // que tá em unidade não é pra aparecer" — cod do cadastro (pcp_produtos_
    // bluesoft) marcado com embalagemKeyBluesoft==='UN' é a variante vendida
    // solta (ex.: "01614 CANJICA BRANCA... 400 G - UND", produto_key 80604),
    // sempre existindo ao lado da variante em caixa de verdade (produto_key
    // 80605, embalagem CX) — mesmo produto físico, cod diferente. PCP
    // planeja em caixas; a variante solta só duplicava linha na tela sem
    // fazer sentido pra compra/produção. Exclusão é por COD inteiro (não por
    // linha do arquivo de estoque), então nunca corta a variante em caixa.
    const codsUnidade=new Set(produtos.filter(p=>String(p.embalagemKeyBluesoft||'').toUpperCase()==='UN').map(p=>String(p.cod||'')));
    const codsValidos=new Set(produtos.map(p=>String(p.cod||'')).filter(c=>c&&!codsUnidade.has(c)));
    const [dadosProdutosEstoque,dadosEscadinha]=await Promise.all([global.DTBiPastaLocal.lerJson(ARQUIVO_BI_ESTOQUE),global.DTBiPastaLocal.lerJson(ARQUIVO_BI_ESCADINHA)]);
    _estoqueBi=_juntarEstoqueBi(dadosProdutosEstoque,dadosEscadinha,null,codsValidos);
    _ultimaBuscaEstoqueBi=`Última atualização: ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — ${_estoqueBi.size} produto(s) do BI.`;
    desenhar();
  }catch(e){
    _ultimaBuscaEstoqueBi=`Falha na última busca: ${e.message||e}`;
    global.showToast?.('Erro ao buscar estoque no BI: '+(e.message||e),'error');
    desenhar();
  }
}
// dados-insumos.json não precisa de junção com outro arquivo (já traz
// produto/tipo/categoria/estoque/projecaoBom prontos por sku) — só filtra
// e recalcula cobertura/necessidade do zero, mesma disciplina do estoque de
// produto acabado.
// BUG AO VIVO REAL (2026-09-04): "os insumos não tá atualizando certo" —
// diferente de produtos_estoque.json (que tem 1 linha por LOJA e sempre foi
// somado por produto_key em _juntarEstoqueBi), dados-insumos.json TAMBÉM
// tem 1 linha por loja pro mesmo sku (confirmado: sku 79922 "SUSPENSÃO
// OLEOSA URUCUM" aparece separado pra loja 11 e loja 14) — mas esta função
// nunca somava, só empurrava cada linha crua pro array de saída. Um insumo
// usado em mais de uma loja virava 2+ linhas na tela, cada uma só com uma
// fração do estoque real. Agora soma estoque/projecaoBom por sku primeiro,
// igual _juntarEstoqueBi já faz pra produto acabado.
function _juntarInsumosBi(dadosInsumos,mesIndice){
  if(mesIndice==null)mesIndice=new Date().getMonth();
  const hoje=new Date(),diasNoMes=new Date(hoje.getFullYear(),mesIndice+1,0).getDate();
  const porSku=new Map();
  (dadosInsumos?.produtos||[]).forEach(it=>{
    const sku=String(it.sku??'').trim();if(!sku)return;
    const acc=porSku.get(sku)||{sku,produto:it.produto||sku,tipo:it.tipo||'',categoria:it.categoria||'',fornecedor:it.fornecedor||'',unidade:it.unidade||'',estoque:0,projecaoBom:0};
    acc.estoque+=n(it.estoque);
    acc.projecaoBom+=n(it.projecaoBom);
    if((it.produto||'').length>acc.produto.length)acc.produto=it.produto;
    if(!acc.fornecedor&&it.fornecedor)acc.fornecedor=it.fornecedor;
    porSku.set(sku,acc);
  });
  const out=[];
  porSku.forEach(acc=>{
    if(!(acc.estoque>0||acc.projecaoBom>0))return;
    const consumoDia=acc.projecaoBom>0?acc.projecaoBom/diasNoMes:0;
    const disponivel=acc.estoque,estoqueAlvo=consumoDia*META_COBERTURA_INSUMO_DIAS;
    out.push({
      cod:acc.sku,produto:acc.produto,tipo:acc.tipo,categoria:acc.categoria,
      fornecedor:acc.fornecedor,unidade:acc.unidade,
      estoque:acc.estoque,consumoDia,coberturaDias:consumoDia>0?disponivel/consumoDia:null,
      diasAlvo:META_COBERTURA_INSUMO_DIAS,estoqueAlvo,necessidade:Math.max(0,estoqueAlvo-acc.estoque),
    });
  });
  return out.sort((a,b)=>(b.necessidade-a.necessidade)||((a.coberturaDias??999999)-(b.coberturaDias??999999)));
}
async function buscarInsumosBi(){
  if(!global.DTBiPastaLocal?.suportado?.())return;
  const status=await global.DTBiPastaLocal.status();
  if(status!=='conectado'){const r=await global.DTBiPastaLocal.conectar();if(!r.ok){global.showToast?.(r.erro,'error');return;}}
  try{
    const dadosInsumos=await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_INSUMOS);
    _insumosBi=_juntarInsumosBi(dadosInsumos);
    _ultimaBuscaInsumosBi=`Última atualização: ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — ${_insumosBi.length} insumo(s) com estoque ou necessidade.`;
    desenhar();
  }catch(e){
    _ultimaBuscaInsumosBi=`Falha na última busca: ${e.message||e}`;
    global.showToast?.('Erro ao buscar insumos no BI: '+(e.message||e),'error');
    desenhar();
  }
}
function construirVisao({produtos:pp=produtos,projecao:pj=projecao,pedidos:pd=pedidos,ops:oo=ops,agendamentos:aa=agend,requisicoes:rr=reqs,estoqueBi=null}={}){
  // Une código comercial/caixa, produto unitário e aliases da BlueSoft
  // antes de cruzar estoque, pedido e histórico. Sem isso o mesmo produto
  // podia aparecer com pedido em uma chave e estoque zero em outra.
  const alias=new Map(),camposAlias=['cod','prodCod','prodKey','bluesoftProdutoKey','produtoUnitarioKey','produtoUnitarioKeyBluesoft','canonicalKey'];
  const registrar=x=>{const canon=String(x?.cod??x?.canonicalKey??x?.bluesoftProdutoKey??x?.prodKey??'').trim();if(!canon)return;camposAlias.forEach(c=>{const v=String(x?.[c]??'').trim();if(v&&!alias.has(v))alias.set(v,canon);});};
  (pp||[]).forEach(registrar);(pj||[]).forEach(registrar);
  const canon=x=>{for(const c of camposAlias){const v=String(x?.[c]??'').trim();if(v&&alias.has(v))return alias.get(v);}return keyOf(x);};
  const normalizar=arr=>(arr||[]).map(x=>({...x,cod:canon(x)||x.cod}));
  pp=normalizar(pp);pj=normalizar(pj);pd=normalizar(pd);oo=normalizar(oo);aa=normalizar(aa);rr=normalizar(rr);
  // Quando `estoqueBi` é passado (abas Estoque/Pedidos x Estoque, ver
  // buscarEstoqueBi), re-chaveia pelo MESMO canon() usado pro resto — o
  // código do BI (sku/cod) pode ter um alias diferente já registrado no
  // cadastro (bluesoftProdutoKey etc.), e sem isso o produto podia entrar
  // duplicado (uma linha do BI, outra do cadastro) em vez de se juntar.
  const estoqueBiCanon=estoqueBi?new Map([...estoqueBi].map(([cod,v])=>[canon({cod}),v])):null;
  const projCalc=projLinhas(), pcalc=new Map(projCalc.map(x=>[keyOf(x),x]));
  // PEDIDO AO VIVO (2026-09-02): "se o produto não aparece aqui [dados-
  // estoque.json], não é pra aparecer no estoque versus pedido" — quando
  // estoqueBi está presente, a lista de chaves é EXATAMENTE a dele, não a
  // união de tudo que existe no Firestore (senão produto sem estoque no BI
  // continuaria aparecendo com estoque zerado, e o contrário: produto do BI
  // sem nenhum registro em pedidos/produção também precisa aparecer).
  const keys=estoqueBiCanon?new Set(estoqueBiCanon.keys()):new Set();
  if(!estoqueBiCanon)[pp,pj,pd,oo,aa,rr].forEach(arr=>(arr||[]).forEach(x=>keys.add(keyOf(x))));
  const out=[];
  for(const k of keys){if(!k)continue;
    const prod=(pp||[]).find(x=>keyOf(x)===k)||{}, pr=(pj||[]).find(x=>keyOf(x)===k)||{}, calc=pcalc.get(k)||{};
    const bi=estoqueBiCanon?.get(k)||null;
    // PEDIDO AO VIVO (2026-09-02, 3ª rodada): "o nome tem que vir completo,
    // falta os números que fazem parte da descrição" — o texto do BI vem
    // sem o código-prefixo (ex.: "TAPIOCA DA TERRINHA 1 KG - CX 12"), mas o
    // cadastro interno (producao_produtos) já guarda o nome completo com o
    // prefixo (ex.: "00001 TAPIOCA DA TERRINHA 1 KG - CX 12") — cadastro
    // agora tem prioridade sobre o texto do BI, só cai pro BI quando o
    // produto ainda não está cadastrado.
    const nome=prod.nome||bi?.produto||pr.produto||(pd||[]).find(x=>keyOf(x)===k)?.produto||(oo||[]).find(x=>keyOf(x)===k)?.produto||k;
    const cod=prod.cod||pr.cod||(pd||[]).find(x=>keyOf(x)===k)?.cod||bi?.cod||'';
    const peds=(pd||[]).filter(x=>keyOf(x)===k&&!/cancel/i.test(String(x.status||'')));
    const qtdPedidos=peds.reduce((s,x)=>s+Math.max(0,n(x.quantidade)),0), atendida=peds.reduce((s,x)=>s+Math.max(0,n(x.quantidadeAtendida)),0), pendente=Math.max(0,qtdPedidos-atendida);
    const estoque=bi?bi.estoque:n(calc.estoqueNormalizado??pr.estoqueNormalizado??pr.estoqueAtual), reservaVendaBluesoft=n(pr.estoqueReservadoVenda);
    // PEDIDO AO VIVO (2026-09-02, 2ª rodada): com estoqueBi, "Pedidos" vem
    // de estoque−saldo do dados-estoque.json (ver _juntarEstoqueBi) — fonte
    // única e confiável, substitui pcp_pedidos/reservaVendaBluesoft só pros
    // 81 produtos do BI (as outras abas/produtos continuam como antes).
    const comprometido=bi?bi.pedido:(peds.length?pendente:reservaVendaBluesoft), disponivel=estoque-comprometido;
    const prodProg=(oo||[]).filter(x=>keyOf(x)===k&&!/conclu|cancel/i.test(String(x.status||''))).reduce((s,x)=>s+Math.max(0,n(x.qntCaixas)-n(x.realizadoCaixas)),0);
    const entradas=(aa||[]).filter(x=>keyOf(x)===k&&!/cancel|finaliz/i.test(String(x.status||''))).reduce((s,x)=>s+Math.max(0,n(x.quantidade)-n(x.quantidadeRecebida)),0);
    const comprasProg=(rr||[]).filter(x=>keyOf(x)===k&&!/cancel|rejeit|finaliz/i.test(String(x.status||''))).reduce((s,x)=>s+Math.max(0,n(x.quantidade)),0);
    // A reserva BlueSoft e os pedidos importados representam a mesma
    // demanda em muitos retornos. Usa apenas a fonte escolhida em
    // `comprometido`, impedindo desconto duplo no saldo projetado.
    const motor=bi?null:global.PCPDemandEngine?.calculate?.({product:prod,forecast:{...pr,...calc},operational:{availableStock:estoque,inbound:entradas,production:prodProg,committedDemand:comprometido},parameters:global.PCP_DEMANDA_PARAMETROS||{}})||null;
    // Com estoqueBi, o consumo diário vem do `plano` do dados-escadinha.json
    // (ver _juntarEstoqueBi) — não do motor de demanda nem da projeção do
    // Firestore, que são a fonte antiga que esta troca substitui nessas 2
    // abas.
    const consumoDia=bi?bi.consumoDia:(motor?.dailyDemand??((n(calc.projFinal??calc.projSemanal)||(n(pr.venda_m1)*.5+n(pr.venda_m2)*.3+n(pr.venda_m3)*.2)/4.33)/7)), estoqueMin=n(prod.estoqueMinimo??pr.estoqueMinimo);
    // PEDIDO AO VIVO (2026-09-07): "não quero consumo dia... quero consumo
    // mesmo, a média dos 3 últimos meses" — igual ao consumoDia acima, só
    // que em base mensal; produto sem BI usa a mesma média de venda_m1/m2/m3
    // já calculada em `calc`/`pr` (ponderada 50/30/20), sem reinventar fonte.
    const consumoMensal=bi?bi.consumoMensal:(n(calc.projFinal??calc.projSemanal)||(n(pr.venda_m1)*.5+n(pr.venda_m2)*.3+n(pr.venda_m3)*.2));
    // Sem BI, usa a mesma previsão futura (50/30/20) já calculada no motor
    // de demanda (pr.previsao_m1/m2/m3, escrita por 66-producao-projecao.js
    // na mesma coleção producao_projecao).
    const previsaoMensal=bi?bi.previsaoMensal:(n(pr.previsao_m1)*.5+n(pr.previsao_m2)*.3+n(pr.previsao_m3)*.2);
    // PEDIDO AO VIVO (2026-08-28): "Pedidos x Estoque... estava tudo
    // zerado" — saldo/necessidade ainda somavam o `pendente` LEGADO
    // (pcp_pedidos, vazio pra quem migrou pro BI), ignorando o fallback pra
    // `reservaVendaBluesoft` que `comprometido`/`disponivel` já usavam (ver
    // comentário acima). Agora os três (disponível, saldo, necessidade)
    // usam a MESMA fonte de demanda reservada, sem desconto duplo nem
    // buraco quando não existe pedido manual cadastrado.
    const saldo=estoque-comprometido+prodProg+entradas;
    // BUG AO VIVO REAL (2026-09-04): "a necessidade só cobre o negativo, não
    // coloca um saldo pros 30 dias" — todo produto NOVO cadastrado em Ficha
    // Técnica (60-producao-ficha-tecnica.js) grava metaCoberturaDias:0 por
    // padrão, a não ser que alguém preencha manualmente o campo "Cobertura
    // desejada". Isso fazia `temMetaConfigurada` dar TRUE com meta=0 (0 não é
    // undefined/null/''), zerando diasAlvo/estoqueAlvo pra praticamente todo
    // produto sem ninguém ter configurado nada de propósito — necessidade
    // virava só "cobrir o saldo negativo", sem nenhum colchão pros 30 dias
    // (ou pros dias configurados de verdade). 0 (ou negativo) agora conta
    // como "sem meta própria", igual undefined/null/vazio.
    const metaConfigurada=prod.metaCoberturaDias??prod.coberturaMetaDias,temMetaConfigurada=metaConfigurada!==undefined&&metaConfigurada!==null&&metaConfigurada!==''&&n(metaConfigurada)>0;
    const diasAlvo=temMetaConfigurada?Math.max(0,n(metaConfigurada)):(bi?META_COBERTURA_PRODUTO_DIAS:(motor?.targetDays??0)), estoqueAlvo=temMetaConfigurada?Math.max(estoqueMin,consumoDia*diasAlvo):(motor?.targetStock??Math.max(estoqueMin,consumoDia*diasAlvo));
    const necessidade=temMetaConfigurada?Math.max(0,estoqueAlvo+comprometido-estoque-prodProg-entradas):(motor?.suggestedQuantity??Math.max(0,estoqueAlvo+comprometido-estoque-prodProg-entradas));
    const cobertura=bi?(consumoDia>0?Math.max(0,disponivel)/consumoDia:null):(motor?.coverageDays??(consumoDia>0?Math.max(0,disponivel)/consumoDia:null)), coberturaProj=bi?(consumoDia>0?Math.max(0,saldo)/consumoDia:null):(motor?.projectedCoverageDays??(consumoDia>0?Math.max(0,saldo)/consumoDia:null));
    const eventos=[];
    peds.forEach(x=>{const q=Math.max(0,n(x.quantidade)-n(x.quantidadeAtendida));if(q>0)eventos.push({data:x.dataNecessaria||'',tipo:'pedido',descricao:'Pedido '+(x.pedido||x.destino||''),delta:-q});});
    (oo||[]).filter(x=>keyOf(x)===k&&!/conclu|cancel/i.test(String(x.status||''))).forEach(x=>{const q=Math.max(0,n(x.qntCaixas)-n(x.realizadoCaixas));if(q>0)eventos.push({data:x.data||'',tipo:'producao',descricao:'Produção '+(x.maquina||''),delta:q});});
    (aa||[]).filter(x=>keyOf(x)===k&&!/cancel|finaliz/i.test(String(x.status||''))).forEach(x=>{const q=Math.max(0,n(x.quantidade)-n(x.quantidadeRecebida));if(q>0)eventos.push({data:x.dataPrevista||'',tipo:'entrada',descricao:'Entrega '+(x.fornecedor||x.numeroCompra||''),delta:q});});
    const ordemTipo={entrada:0,producao:1,pedido:2};eventos.sort((a,b)=>String(a.data).localeCompare(String(b.data))+(ordemTipo[a.tipo]-ordemTipo[b.tipo]));
    let saldoLinha=estoque,ruptura=null,piorSaldo=estoque;for(const ev of eventos){saldoLinha+=ev.delta;ev.saldoApos=saldoLinha;ev.coberturaApos=consumoDia>0?Math.max(0,saldoLinha)/consumoDia:null;piorSaldo=Math.min(piorSaldo,saldoLinha);if(!ruptura&&saldoLinha<0)ruptura=ev.data||'sem data';}
    const prox=eventos[0]||null;
    out.push({key:k,cod,produto:nome,estoqueAtual:estoque,estoqueComprometido:comprometido,estoqueDisponivel:disponivel,estoqueMinimo:estoqueMin,estoqueAlvo,diasAlvo,pedidos:qtdPedidos,atendida,pendente:comprometido,producaoProgramada:prodProg,comprasProgramadas:comprasProg,entradasPrevistas:entradas,saldo,necessidade,excesso:Math.max(0,saldo-estoqueAlvo),consumoDia,coberturaDias:cobertura,coberturaProjetadaDias:coberturaProj,eventos,proximoEvento:prox,rupturaEm:ruptura,piorSaldo,estoqueSeguranca:motor?.safetyStock??n(prod.estoqueSeguranca),pontoPedido:motor?.reorderPoint??0,leadTimeDias:motor?.leadTime??n(prod.leadTimeDias),demandaHistoricaDia:motor?.historicalDailyDemand??null,previsaoFuturaDia:motor?.forecastDailyDemand??null,consumoMensal,previsaoMensal,quantidadeSugerida:motor?.suggestedQuantity??necessidade,alertasCalculo:motor?.alerts||[],memoriaDemanda:motor?.memory||null,planoEscadinha:bi?.plano||null});
  }
  return out.sort((a,b)=>(b.necessidade-a.necessidade)||((a.coberturaDias??999999)-(b.coberturaDias??999999))||a.produto.localeCompare(b.produto,'pt-BR'));
}
// PEDIDO AO VIVO (2026-08-27): "parece que nao atualiza" (estoque negativo
// na aba Pedidos x Estoque) — o "↻ Atualizar" só relia Firestore
// (carregar(true)), nunca disparava a sincronização do BI/SharePoint que
// alimenta pcp_estoque_bluesoft (ver sincronizarBiAgendadoAgora em
// functions/index.js, que já roda sozinha a cada 30min, mas o usuário não
// tinha como forçar fora desse intervalo). Chamada best-effort: função é
// admin-only nas Firestore/Functions rules, então uma conta comum recebe
// permission-denied e o botão simplesmente cai no recarregamento normal —
// nunca trava a tela por causa de permissão.
// PEDIDO AO VIVO (2026-08-27): "quando eu coloco pra buscar ele tem que
// mostrar buscando tipo matriz ok, terrinha... da mesma forma [que o
// BlueSoft mostrava]?" — usuário topou a versão simples (resumo só ao
// terminar, sem progresso loja-por-loja ao vivo, que exigiria reestruturar
// a sincronização pra rodar loja por loja a partir do navegador). Mesma
// formatação usada em 89-compras-dashboard.js e 79-compras-central.js —
// duplicada de propósito (mesmo padrão já usado no resto do arquivo pra
// não acoplar telas independentes), nunca importada de um lado pro outro.
// PEDIDO AO VIVO (2026-08-27): "tá trazendo nada" (estoque zerado só na
// Filial, depois de confirmar que o cod do produto bate com o produto_key
// do SharePoint) — o resumo só dizia "N loja(s) verificada(s)", sem
// detalhe nenhum de QUANTO cada loja realmente gravou. Sem esse detalhe,
// investigar exige acesso direto ao Firestore (que não temos aqui) e
// depender do usuário descrever a tela. Loja com poucos/nenhum gravado
// aparece destacada — é exatamente o sinal que falta pra achar a causa.
function _resumoSincronizacaoBi(resultados){
  if(!Array.isArray(resultados)||!resultados.length)return '';
  const falhas=resultados.filter(r=>r&&r.erro);
  const porLoja=resultados.filter(r=>r&&r.estoqueProdutos).map(r=>r.loja+': '+r.estoqueProdutos.gravados+'/'+r.estoqueProdutos.total).join(', ');
  return resultados.length+' loja(s) verificada(s) no SharePoint'+(falhas.length?', '+falhas.length+' falharam ('+falhas.map(f=>f.loja).join(', ')+')':'')+(porLoja?' · Produto acabado gravado/relevante por loja: '+porLoja:'')+'.';
}
async function pcpAtualizarComSync(btn){
  const original=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='⏳ Sincronizando...';}
  try{
    if(typeof global.firebase?.app==='function'){
      const callable=global.firebase.app().functions('southamerica-east1').httpsCallable('sincronizarBiAgendadoAgora');
      const resp=await callable({});
      const resumo=_resumoSincronizacaoBi(resp?.data?.resultados);
      if(resumo)global.showToast?.('SharePoint: '+resumo,'success');
    }
  }catch(e){
    // BUG AO VIVO REAL: erro sendo engolido em silêncio escondia que a
    // sincronização estava falhando toda vez — usuário só via um aviso
    // antigo, sem nunca saber que a busca nova nem estava rodando. Só
    // permission-denied/unauthenticated (conta comum, sem acesso admin) é
    // esperado e continua silencioso; qualquer outro erro agora aparece.
    if(e?.code!=='permission-denied'&&e?.code!=='unauthenticated'){
      global.showToast?.('Falha ao sincronizar com o SharePoint: '+(e.message||e),'error');
      console.error('[PCP] sincronizarBiAgendadoAgora falhou:',e);
    }
  }
  try{await carregar(true);desenhar();}
  finally{if(btn){btn.disabled=false;btn.innerHTML=original||'↻ Atualizar';}}
}
async function carregar(forcar=false){
  if(carregado&&!forcar)return;const vazio={docs:[]},lojasSnap=await raw().collection('lojas').get();
  lojas=lojasSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.ativa!==false&&x.bluesoft_loja_key);
  const colecoes=[CPED,CREQ,CAGE,CPROD,CPRODAPI,CPROJ,CESTAPI,COP,CREGR];
  const tudo={};colecoes.forEach(c=>tudo[c]=[]);
  if(lojas.length){for(const loja of lojas){const base=raw().collection('lojas').doc(loja.id);const snaps=await Promise.all(colecoes.map(c=>base.collection(c).get().catch(()=>vazio)));snaps.forEach((s,i)=>s.docs.forEach(d=>tudo[colecoes[i]].push({_id:d.id,lojaId:loja.id,lojaNome:loja.nome||loja.codigo||loja.id,...d.data()})));}}
  else {const lojaId=global.getDTLojaAtiva?.()||'';const snaps=await Promise.all(colecoes.map(c=>fs().collection(c).get().catch(()=>vazio)));snaps.forEach((s,i)=>s.docs.forEach(d=>tudo[colecoes[i]].push({_id:d.id,lojaId,...d.data()})));if(lojaId)lojas=[{id:lojaId,nome:'Loja ativa'}];}
  pedidos=tudo[CPED];reqs=tudo[CREQ];agend=tudo[CAGE];ops=tudo[COP];regrasCompradores=tudo[CREGR];
  const prodMap=new Map();[...tudo[CPRODAPI],...tudo[CPROD]].forEach(x=>{const k=(x.lojaId||'')+'|'+keyOf(x),atual=prodMap.get(k)||{};prodMap.set(k,{...atual,...x});});produtos=Array.from(prodMap.values());
  const projMap=new Map();[...tudo[CESTAPI],...tudo[CPROJ]].forEach(x=>{const k=(x.lojaId||'')+'|'+keyOf(x),atual=projMap.get(k)||{};projMap.set(k,{...atual,...x});});projecao=Array.from(projMap.values());
  const lojaId=global.getDTLojaAtiva?.()||'',d=lojaId?await raw().collection(CPRODREQ).where('origemLojaId','==',lojaId).get().catch(()=>vazio):vazio;solProd=d.docs.map(x=>({_id:x.id,...x.data()}));carregado=true;
}

function dadosFiltrados(){
  const loja=filtros.loja,filtra=a=>loja?a.filter(x=>String(x.lojaId||x.origemLojaId||'')===loja):a;
  if(loja)return {produtos:filtra(produtos),projecao:filtra(projecao),pedidos:filtra(pedidos),ops:filtra(ops),agendamentos:filtra(agend),requisicoes:filtra(reqs)};
  const pm=new Map();produtos.forEach(x=>{const k=keyOf(x),a=pm.get(k)||{};pm.set(k,{...a,...x,nome:(!a.nome||/^Produto\s+\d+$/i.test(a.nome))?x.nome:a.nome,metaCoberturaDias:Math.max(n(a.metaCoberturaDias),n(x.metaCoberturaDias))});});
  const em=new Map();projecao.forEach(x=>{const k=keyOf(x),a=em.get(k)||{cod:x.cod,produto:x.produto};const soma=['estoqueAtual','estoqueAtualUnidades','estoqueReservadoVenda','estoqueReservado','estoqueEmTransito'];soma.forEach(c=>a[c]=n(a[c])+n(x[c]));['fatorCaixa','unidadeExibicao','consumoDiaMedioBluesoft'].forEach(c=>{if(x[c]!=null)a[c]=x[c];});if(!a.produto||/^Produto\s+\d+$/i.test(a.produto))a.produto=x.produto;em.set(k,a);});
  return {produtos:Array.from(pm.values()),projecao:Array.from(em.values()),pedidos,ops,agendamentos:agend,requisicoes:reqs};
}
function metaProduto(item){const candidatos=produtos.filter(p=>keyOf(p)===item.key),p=(filtros.loja?candidatos.find(x=>x.lojaId===filtros.loja):null)||candidatos.find(x=>x.nome&&!/^Produto\s+\d+$/i.test(x.nome))||candidatos[0]||{};const nome=item.produto||p.nome||'';return {p,nome,marcaPropria:p.marcaPropria===true||/DA TERRINHA/i.test(nome),categoria:_categoriaDoNome(nome),tipo:p.bluesoftTipoProduto||p.tipoProduto||''};}
function visaoFiltrada(){let v=construirVisao({...dadosFiltrados(),estoqueBi:_estoqueBi});const busca=norm(filtros.busca);return v.filter(x=>{const m=metaProduto(x),txt=norm((x.cod||'')+' '+m.nome);if(String(m.tipo||'').toUpperCase()==='CONSUMO')return false;if(busca&&!txt.includes(busca))return false;if(filtros.marca==='sim'&&!m.marcaPropria)return false;if(filtros.marca==='nao'&&m.marcaPropria)return false;if(filtros.categoria&&norm(m.categoria)!==norm(filtros.categoria))return false;if(filtros.situacao==='ruptura'&&!x.rupturaEm)return false;if(filtros.situacao==='estoque'&&x.estoqueAtual<=0)return false;if(filtros.situacao==='pedidos'&&x.pendente<=0)return false;if(filtros.ocultarZerados&&x.estoqueAtual<=0&&x.pendente<=0)return false;return true;}).map(x=>{const m=metaProduto(x);return {...x,produto:(!/^Produto\s+\d+$/i.test(m.nome)?m.nome:x.produto),_meta:m};});}

function resolverComprador(produtoOuKey,regras=regrasCompradores,listaProdutos=produtos){
  const p=typeof produtoOuKey==='object'?produtoOuKey:(listaProdutos.find(x=>keyOf(x)===String(produtoOuKey)||String(x.cod||x.nome)===String(produtoOuKey))||{});
  const candidatos=[
    ['produto',String(p.cod||'')],['produto',String(p.nome||'')],
    ['categoria',String(p.categoria||'')],['categoria',String(p.classificacao||'')],
    ['fornecedor',String(p.fornecedorPadrao||p.fornecedor||'')]
  ].filter(x=>x[1]);
  for(const [tipo,valor] of candidatos){
    const r=(regras||[]).find(x=>String(x.tipo||'')===tipo&&norm(x.valor)===norm(valor)&&x.ativo!==false);
    if(r)return {compradorUid:r.compradorUid||'',compradorEmail:r.compradorEmail||'',compradorNome:r.compradorNome||'',regraId:r._id||'',regraTipo:tipo,regraValor:valor};
  }
  return {compradorUid:'',compradorEmail:'',compradorNome:'',regraId:'',regraTipo:'',regraValor:''};
}

const ABAS=[['pedidos','Pedidos'],['estoque','Estoque'],['pedidos-estoque','Pedidos x Estoque'],['insumos','Insumos'],['compras','Compras / Necessidades'],['agendamentos','Agendamentos'],['producao','Programação Produção']];
// Fase 7+: páginas novas do PCP (Parâmetros, Dashboard, Timeline...) vivem
// em arquivos próprios, cada uma com sua .page — diferente das 6 abas
// acima, que continuam todas dentro de #page-pcp-central. Cada arquivo novo
// se registra aqui via pcpRegistrarPagina() no próprio carregamento do
// script (que roda depois deste arquivo), sem 78 precisar conhecê-los.
let _paginasExternas={};
function pcpRegistrarPagina(nome,{elId,render,titulo}){_paginasExternas[nome]={elId,render,titulo};}
// Navegação das abas mora na sidebar do setor PCP (mesmo padrão do setor
// Produção), não mais numa barra de botões dentro da página — troca de aba
// só redesenha (sem recarregar o Firestore) quando os dados já foram
// buscados uma vez; goPage() forçaria um carregar(true) a cada clique.
function pcpIrParaAba(nome,el){
  if(typeof global.temPermissao==='function'&&!global.temPermissao('pcp-central','visualizar')){global.showToast?.('Você não possui acesso a esta aba.','error');return;}
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));
  if(el)el.classList.add('on');
  const externa=_paginasExternas[nome];
  if(externa){
    const pageEl=document.getElementById(externa.elId);if(pageEl)pageEl.classList.add('on');
    const tituloEl=document.getElementById('page-title');if(tituloEl)tituloEl.textContent='PCP · '+externa.titulo;
    const fn=global[externa.render];
    if(typeof fn==='function')fn();
    return;
  }
  const pageEl=document.getElementById('page-pcp-central');if(pageEl)pageEl.classList.add('on');
  const tituloEl=document.getElementById('page-title');if(tituloEl)tituloEl.textContent='PCP · '+(ABAS.find(x=>x[0]===nome)?.[1]||nome);
  aba=nome;
  if(!carregado)render();else desenhar();
}
function produtoOpts(sel=''){return `<option value="">Selecione...</option>${produtos.filter(x=>x.ativo!==false).sort((a,b)=>String(a.nome).localeCompare(String(b.nome),'pt-BR')).map(x=>`<option value="${esc(x.cod||x.nome)}" ${String(sel)===String(x.cod||x.nome)?'selected':''}>${esc(x.cod?x.cod+' — ':'')}${esc(x.nome)}</option>`).join('')}`;}
function produtoByValue(v){return produtos.find(x=>String(x.cod||x.nome)===String(v))||{};}
function pedidosHtml(){return `<div class="tc" style="padding:12px;margin-bottom:12px">${tem('criar')?`<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:7px"><select class="field" id="pcp-ped-prod">${produtoOpts()}</select><input class="field" id="pcp-ped-qtd" type="number" min="0" placeholder="Quantidade"><input class="field" id="pcp-ped-loja" placeholder="Loja/destino"><input class="field" id="pcp-ped-data" type="date"><input class="field" id="pcp-ped-num" placeholder="Pedido"><button class="btn btn-primary btn-sm" data-pcp-ped-save>+ Pedido</button></div>`:'<span style="color:var(--muted)">Consulta de pedidos</span>'}</div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Pedido</th><th>Destino</th><th>Data necessária</th><th>Qtd</th><th>Atendida</th><th>Pendente</th><th>Status</th><th></th></tr></thead><tbody>${pedidos.length?pedidos.sort((a,b)=>String(a.dataNecessaria||'').localeCompare(String(b.dataNecessaria||''))).map(x=>`<tr><td><b>${esc(x.produto)}</b></td><td>${esc(x.pedido||'')}</td><td>${esc(x.destino||'')}</td><td>${esc(x.dataNecessaria||'')}</td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td><td>${n(x.quantidadeAtendida).toLocaleString('pt-BR')}</td><td>${Math.max(0,n(x.quantidade)-n(x.quantidadeAtendida)).toLocaleString('pt-BR')}</td><td>${statusBadge(x.status)}</td><td>${tem('editar')?`<button class="acao-lapis" data-pcp-ped-atender="${esc(x._id)}" title="Informar atendido">✅</button>`:''}${tem('excluir')?`<button class="acao-lapis" data-pcp-del="pedido|${esc(x._id)}">🗑️</button>`:''}</td></tr>`).join(''):'<tr><td colspan="9">Nenhum pedido.</td></tr>'}</tbody></table></div></div>`;}
function risco(v){return v==null?'b-gray':v<=3?'b-red':v<=7?'b-orange':v<=14?'b-yellow':'b-green';}
function filtrosHtml(){const cats=[...new Set(produtos.map(x=>_categoriaDoNome(x.nome)).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));return `<div class="tc" style="padding:9px 10px;margin-bottom:10px"><div style="display:grid;grid-template-columns:minmax(180px,1.6fr) repeat(4,minmax(125px,1fr)) auto;gap:6px;align-items:center"><input class="field" style="font-size:.7rem;height:34px" data-pcp-filtro="busca" value="${esc(filtros.busca)}" placeholder="Produto, código, tapioca, alho..."><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="loja"><option value="">Todas as lojas (consolidado)</option>${lojas.map(l=>`<option value="${esc(l.id)}" ${filtros.loja===l.id?'selected':''}>${esc(l.nome||l.codigo||l.id)}</option>`).join('')}</select><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="marca"><option value="">Todas as marcas</option><option value="sim" ${filtros.marca==='sim'?'selected':''}>Marca própria</option><option value="nao" ${filtros.marca==='nao'?'selected':''}>Outras marcas</option></select><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="categoria"><option value="">Todas as categorias</option>${cats.map(c=>`<option ${filtros.categoria===String(c)?'selected':''}>${esc(c)}</option>`).join('')}</select><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="situacao"><option value="">Todas as situações</option><option value="estoque" ${filtros.situacao==='estoque'?'selected':''}>Com estoque</option><option value="pedidos" ${filtros.situacao==='pedidos'?'selected':''}>Com pedidos</option><option value="ruptura" ${filtros.situacao==='ruptura'?'selected':''}>Risco de ruptura</option></select><button class="btn btn-ghost btn-sm" data-pcp-limpar-filtros>Limpar</button></div><label style="display:flex;align-items:center;gap:6px;font-size:.72rem;color:var(--muted);margin-top:8px;cursor:pointer"><input type="checkbox" data-pcp-filtro-check="ocultarZerados" ${filtros.ocultarZerados?'checked':''}> Ocultar produtos sem estoque e sem pedido pendente</label></div>`;}
function th(campo,label){return `<th style="cursor:pointer;white-space:nowrap" data-pcp-sort="${esc(campo)}" title="Ordenar">${esc(label)}${setaOrdenacao(campo)}</th>`;}
// PEDIDO AO VIVO (2026-09-07): "eu quero que coloque consumo mesmo, que
// vai pegar a média dos três últimos meses e vai colocar lá, a soma... não
// quero consumo dia não" — troca "Consumo/dia" por "Consumo" mostrando a
// média mensal (soma dos 3 últimos meses fechados ÷ 3) já calculada em
// consumoMensal; consumoDia continua existindo por baixo (cobertura e
// necessidade em dias dependem dele), só não aparece mais na tabela.
function estoqueHtml(v){return filtrosHtml()+`<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr>${th('produto','Produto')}${th('estoqueAtual','Estoque atual')}${th('estoqueComprometido','Comprometido')}${th('estoqueDisponivel','Disponível')}${th('estoqueMinimo','Mínimo')}${th('consumoMensal','Consumo')}${th('coberturaDias','Cobertura')}${th('diasAlvo','Meta')}${th('necessidade','Necessidade futura')}<th></th></tr></thead><tbody>${v.map(x=>`<tr><td><b style="cursor:pointer" data-pcp-360="${esc(x.key)}">${esc(x.produto)}</b></td><td>${qtd(x.estoqueAtual).toLocaleString('pt-BR')}</td><td>${qtd(x.estoqueComprometido).toLocaleString('pt-BR')}</td><td>${Math.ceil(x.estoqueDisponivel).toLocaleString('pt-BR')}</td><td>${qtd(x.estoqueMinimo).toLocaleString('pt-BR')}</td><td>${qtd(x.consumoMensal).toLocaleString('pt-BR')}</td><td><span class="badge ${risco(x.coberturaDias)}">${x.coberturaDias==null?'—':x.coberturaDias.toLocaleString('pt-BR',{maximumFractionDigits:1})+'d'}</span></td><td>${qtd(x.diasAlvo)}d</td><td>${qtd(x.necessidade).toLocaleString('pt-BR')}</td><td><button class="acao-lapis" title="Ver relatório do produto" data-pcp-memoria="${esc(x.key)}">🧮</button></td></tr>`).join('')||'<tr><td colspan="10">Nenhum produto para os filtros selecionados.</td></tr>'}</tbody></table></div></div>`;}
// PEDIDO AO VIVO (2026-09-02): "olha o monte de coluna que tem aí... acho
// que é pra deixar só quatro colunas, produto/estoque/pedidos/saldo" —
// tabela enxugada pras 4 colunas pedidas; o cálculo em construirVisao()
// (produção prog./compras prog./entradas previstas/cobertura/próximo
// evento/ruptura) continua intacto, só não aparece mais nesta tabela — o
// botão 🧮 continua levando pro relatório completo (memoriaDeCalculo) pra
// quem precisar do detalhe.
// PEDIDO AO VIVO (2026-09-02): "deixe parecido [com o print do Power BI de
// referência], se ficar negativo colocar o fundo vermelho e letra branca
// no saldo, e colocar a coluna de cobertura, a cobertura vai ser calculada
// em cima da coluna saldo" — cobertura aqui é sempre saldo/consumoDia, sem
// o Math.max(0,...) que coberturaProjetadaDias usa lá em construirVisao()
// (aquele campo é pra outros relatórios, que preferem não mostrar negativo);
// nesta tabela o pedido foi explícito: cobertura negativa deve aparecer,
// espelhando o saldo negativo.
// PEDIDO AO VIVO (2026-09-07): "o saldo que é pra aparecer lá não é pra
// trazer saldo de compra, saldo de produção... é estoque menos pedido, que
// dá o saldo. Não é pra trazer 'ah tem compra disso, vai ficar o saldo
// tal'" — nesta tabela especificamente, Saldo = Estoque − Pedidos, ponto
// (`saldoSimples`, só pra esta tela). O campo `item.saldo` cheio (com
// produção programada + entradas previstas somadas) continua existindo e
// alimentando as Necessidades de Compra e o 🧮 memória de cálculo — que
// mostra o detalhe completo pra quem clicar, mas a tabela em si fica com a
// conta simples que bate exatamente com as 2 colunas visíveis ao lado.
function cruzamentoHtml(v){return filtrosHtml()+`<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr>${th('produto','Produto')}${th('estoqueAtual','Estoque')}${th('pendente','Pedidos')}${th('saldo','Saldo')}<th>Cobertura</th><th></th></tr></thead><tbody>${v.map(x=>{const saldoSimples=x.estoqueAtual-x.pendente,negativo=saldoSimples<0,cobertura=x.consumoDia>0?saldoSimples/x.consumoDia:null;return `<tr><td><b style="cursor:pointer" data-pcp-360="${esc(x.key)}">${esc(x.produto)}</b></td><td>${qtd(x.estoqueAtual).toLocaleString('pt-BR')}</td><td>${qtd(x.pendente).toLocaleString('pt-BR')}</td><td${negativo?' style="background:#c0392b;color:#fff"':''}><b>${Math.ceil(saldoSimples).toLocaleString('pt-BR')}</b></td><td>${cobertura==null?'—':Math.round(cobertura).toLocaleString('pt-BR')+'d'}</td><td><button class="acao-lapis" title="Ver relatório do produto" data-pcp-memoria="${esc(x.key)}">🧮</button></td></tr>`;}).join('')||'<tr><td colspan="6">Nenhum produto para os filtros selecionados.</td></tr>'}</tbody></table></div></div>`;}
// Aba Insumos — sem filtrosHtml() (é lista própria, não passa por
// dadosFiltrados/visaoFiltrada dos produtos) nem drill-down pro Produto
// 360° (insumo não é produto). Ordenado por necessidade (já vem assim de
// _juntarInsumosBi).
function insumosHtml(v){return `<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Tipo</th><th>Categoria</th><th>Insumo</th><th>Fornecedor</th><th>Estoque</th><th>Consumo/dia</th><th>Cobertura</th><th>Necessidade</th></tr></thead><tbody>${v.map(x=>`<tr><td>${esc(x.tipo||'—')}</td><td>${esc(x.categoria||'—')}</td><td><b>${esc(x.produto)}</b><div style="font-size:.62rem;color:var(--muted)">${esc(x.cod||'')}</div></td><td>${esc(x.fornecedor||'—')}</td><td>${qtd(x.estoque).toLocaleString('pt-BR')} ${esc(x.unidade||'')}</td><td>${x.consumoDia?x.consumoDia.toLocaleString('pt-BR',{maximumFractionDigits:1}):'—'}</td><td>${x.coberturaDias==null?'—':x.coberturaDias.toFixed(1)+'d'}</td><td><span class="badge ${x.necessidade>0?'b-red':'b-green'}">${qtd(x.necessidade).toLocaleString('pt-BR')}</span></td></tr>`).join('')||'<tr><td colspan="8">Nenhum insumo com estoque ou necessidade — clique em Buscar do BI.</td></tr>'}</tbody></table></div></div>`;}
function memoriaDeCalculo(item){return [
  {passo:'Demanda histórica diária (3 meses)',valor:item.demandaHistoricaDia??'—',formula:'M1 50% + M2 30% + M3 20%, normalizados pelos dias de cada mês'},
  {passo:'Previsão futura diária',valor:item.previsaoFuturaDia??'—',formula:'P1 50% + P2 30% + P3 20%; usa a projeção semanal quando os períodos futuros não existem'},
  {passo:'Demanda diária combinada',valor:item.consumoDia,formula:'50% histórico + 50% previsão; fallback automático quando uma fonte não existe'},
  {passo:'Estoque atual',valor:item.estoqueAtual,formula:'Saldo em producao_projecao.estoqueAtual'},
  {passo:'(−) Comprometido (pedidos pendentes)',valor:-item.estoqueComprometido,formula:'Pedidos com quantidade ainda não atendida'},
  {passo:'(+) Produção programada',valor:item.producaoProgramada,formula:'OPs abertas ainda não concluídas'},
  {passo:'(+) Entradas previstas',valor:item.entradasPrevistas,formula:'Agendamentos/compras a caminho'},
  {passo:'= Saldo projetado',valor:item.saldo,formula:'Estoque atual − comprometido + produção + entradas',destaque:true},
  {passo:'Estoque de segurança',valor:item.estoqueSeguranca,formula:'máx(configurado, fator de serviço × desvio da demanda × √lead time)'},
  {passo:'Ponto de pedido',valor:item.pontoPedido,formula:'demanda diária × lead time + estoque de segurança'},
  {passo:'Cobertura desejada',valor:item.diasAlvo+' dias',formula:'Parâmetro configurado em PCP · Parâmetros'},
  {passo:'Estoque alvo',valor:item.estoqueAlvo,formula:'máx(estoque mínimo, consumo diário × cobertura desejada)'},
  {passo:'= Necessidade',valor:item.necessidade,formula:'máx(0, estoque alvo − saldo projetado)',destaque:true},
];}
// PEDIDO AO VIVO (2026-08-28): "nem vai chamar mais cálculo, coloca lá
// outro nome, relatório do produto... vai mostrar todo esse resumo" — a
// antiga "Memória de Cálculo" ganha o histórico de cortes/faturamento por
// mês (bi_cortes_mensal, mesmo cache da aba Cortes — pcp-cortes.js) embaixo
// da conta de estoque que já existia. Async só por causa dessa parte nova;
// o corpo de estoque continua 100% síncrono/local, sem esperar nada.
// PCP nunca mostra valor monetário (regra existente, testada) — faturamento
// entra como quantidade faturada em caixas, não em moeda.
function _linhaHistoricoProduto(h){const atingimento=h.quantidadePedidaCx>0?(h.quantidadeFaturadaCx/h.quantidadePedidaCx)*100:null;const [ano,mes]=String(h.mes||'').split('-');return `<tr><td>${mes&&ano?mes+'/'+ano:h.mes}</td><td>${n(h.quantidadePedidaCx).toLocaleString('pt-BR')}</td><td>${n(h.quantidadeFaturadaCx).toLocaleString('pt-BR')}</td><td>${n(h.corteRoteiroCx).toLocaleString('pt-BR')}</td><td>${atingimento==null?'—':atingimento.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</td></tr>`;}
async function modalMemoria(key){if(!carregado)await carregar();const item=visaoFiltrada().find(x=>x.key===key),host=document.getElementById('pcp-modal-host');if(!host||!item)return;const passos=memoriaDeCalculo(item);const historico=await global._pcpCortesInternals?.buscarHistoricoProduto?.(item.cod||item.key).catch(()=>[])||[];host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:680px;max-height:90vh;overflow:auto"><div class="modal-header"><b>Relatório do Produto — ${esc(item.produto)}</b><button class="modal-x" data-pcp-modal-close>×</button></div><div class="modal-body"><div class="tc" style="padding:10px;margin-bottom:10px"><label style="display:block;font-size:.72rem;font-weight:700;margin-bottom:5px">Cobertura desejada deste produto (dias)</label><div style="display:flex;gap:7px"><input class="field" id="pcp-mem-cobertura" type="number" min="0" step="1" value="${qtd(item.diasAlvo)}" ${tem('configurar')?'':'disabled'}><button class="btn btn-primary btn-sm" data-pcp-mem-save="${esc(item.key)}" ${tem('configurar')?'':'disabled'}>Salvar e recalcular</button></div><div style="font-size:.68rem;color:var(--muted);margin-top:5px">A necessidade futura e o estoque-alvo usam esta quantidade de dias.</div></div><table class="dt-table"><tbody>${passos.map(p=>`<tr ${p.destaque?'style="font-weight:700;background:var(--surface-2)"':''}><td>${esc(p.passo)}</td><td style="text-align:right">${typeof p.valor==='number'?p.valor.toLocaleString('pt-BR',{maximumFractionDigits:1}):esc(p.valor)}</td></tr><tr><td colspan="2" style="font-size:.68rem;color:var(--muted);padding-top:0">${esc(p.formula)}</td></tr>`).join('')}</tbody></table>${historico.length?`<div style="margin-top:14px"><b style="font-size:.8rem">✂️ Cortes por mês</b><div style="overflow:auto;margin-top:6px"><table class="dt-table"><thead><tr><th>Mês</th><th>Pedida (cx)</th><th>Faturada (cx)</th><th>Corte (cx)</th><th>% Atingimento</th></tr></thead><tbody>${historico.slice(0,6).map(_linhaHistoricoProduto).join('')}</tbody></table></div></div>`:''}</div><div class="modal-footer"><button class="btn btn-ghost" data-pcp-modal-close>Fechar</button></div></div></div>`;}
async function salvarCoberturaMemoria(key){if(!tem('configurar'))return;const dias=Math.max(0,Math.ceil(n(document.getElementById('pcp-mem-cobertura')?.value))),candidatos=produtos.filter(x=>keyOf(x)===key),p=(filtros.loja?candidatos.find(x=>x.lojaId===filtros.loja):null)||candidatos.find(x=>x.lojaId===global.getDTLojaAtiva?.())||candidatos[0];if(!p?._id)throw new Error('Produto não encontrado no cadastro desta loja.');await raw().collection('lojas').doc(p.lojaId||global.getDTLojaAtiva?.()).collection(CPROD).doc(p._id).set({metaCoberturaDias:dias,atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true});carregado=false;await carregar(true);desenhar();modalMemoria(key);global.showToast?.('Cobertura salva e cálculo atualizado.','success');}
// PEDIDO AO VIVO (2026-09-02): "dividir esses produtos por linhas...
// colocar uma tabela organizada... e qualquer coisa colocar já alguma
// coisa que já envia automaticamente o pedido pra compras direto" —
// trocada a nuvem de botões por tabela normal (1 produto por linha,
// colunas), com botão de enviar direto (sem abrir modal) por linha e um
// "Enviar todos" pro lote inteiro. Quem quiser customizar quantidade/data/
// destino antes de enviar ainda pode clicar no produto, que abre o modal
// de sempre.
function comprasHtml(v){const nec=v.filter(x=>x.necessidade>0&&!produzidoInternamente(x.key));return `<div class="tc" style="padding:12px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>Necessidades calculadas (${nec.length})</b>${tem('criar')&&nec.length?'<button class="btn btn-primary btn-sm" data-pcp-nec-enviar-todos>📤 Enviar todos</button>':''}</div><div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Produto</th><th>Estoque disp.</th><th>Necessidade (cx)</th><th>Cobertura atual</th><th>Motivo</th>${tem('criar')?'<th></th>':''}</tr></thead><tbody>${nec.length?nec.map(x=>{
  // PEDIDO AO VIVO (2026-09-04): "não mostra a cobertura de dias" —
  // x.coberturaDias vem com Math.max(0,...) por dentro (construirVisao), de
  // propósito, pra outros relatórios que preferem não mostrar negativo;
  // igual já foi feito em cruzamentoHtml (Pedidos x Estoque), recalcula sem
  // esse piso aqui — produto já negativo mostra os dias negativos de
  // verdade, não um "0.0d" genérico que esconde o tamanho do problema.
  const coberturaReal=x.consumoDia>0?x.estoqueDisponivel/x.consumoDia:null;
  return `<tr><td><b style="cursor:pointer" data-pcp-req-prod="${esc(x.key)}">${esc(x.produto)}</b></td><td>${Math.ceil(x.estoqueDisponivel).toLocaleString('pt-BR')}</td><td><b>${Math.ceil(x.necessidade).toLocaleString('pt-BR')}</b></td><td>${coberturaReal==null?'—':coberturaReal.toFixed(1)+'d'}</td><td>${x.rupturaEm?'Risco de ruptura':'Abaixo do estoque-alvo'}</td>${tem('criar')?`<td><button class="btn btn-ghost btn-sm" data-pcp-nec-enviar="${esc(x.key)}">📤 Enviar pedido</button></td>`:''}</tr>`;
}).join(''):`<tr><td colspan="${tem('criar')?6:5}">Nenhuma necessidade de compra calculada.</td></tr>`}</tbody></table></div></div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Solicitado</th><th>Comprado</th><th>Saldo pendente</th><th>Data necessária</th><th>Destino</th><th>Motivo</th><th>Prioridade</th><th>Comprador</th><th>Status</th></tr></thead><tbody>${reqs.length?reqs.map(x=>{const solicitado=n(x.quantidade),comprado=n(x.quantidadeComprada),saldoPend=Math.max(0,solicitado-comprado);return `<tr><td><b>${esc(x.produto)}</b></td><td>${solicitado.toLocaleString('pt-BR')}</td><td>${comprado.toLocaleString('pt-BR')}</td><td><span class="badge ${saldoPend>0?'b-orange':'b-green'}">${saldoPend.toLocaleString('pt-BR')}</span></td><td>${esc(x.dataNecessaria||'')}</td><td>${esc(x.destino||'')}</td><td>${esc(x.motivo||'')}</td><td>${esc(x.prioridade||'normal')}</td><td>${esc(x.compradorNome||x.compradorEmail||'Não direcionado')}</td><td>${statusBadge(x.status)}</td></tr>`}).join(''):'<tr><td colspan="10">Nenhuma requisição criada.</td></tr>'}</tbody></table></div></div>`;}
// PEDIDO AO VIVO: previsão (data ainda não confirmada pelo fornecedor) e
// agenda real (fornecedor já confirmou) são o MESMO formulário — o
// comprador digitava tudo à mão nas duas vezes. Agora, quando o fornecedor
// confirma, o comprador só digita o nº do pedido; a busca acha o pedido na
// Bluesoft (produto/fornecedor/quantidade pendente) e preenche o formulário
// — só a data real da entrega continua sendo digitada na hora, porque é
// exatamente o dado que o fornecedor está confirmando agora.
let _buscaPedido=null,_buscaPedidoErro='';
function _buscaPedidoHtml(){
  if(_buscaPedidoErro)return `<div class="tc" style="padding:10px 12px;margin-top:8px;border-left:3px solid #ef4444;font-size:.78rem">⚠️ ${esc(_buscaPedidoErro)}</div>`;
  if(!_buscaPedido)return '';
  const p=_buscaPedido;
  return `<div class="tc" style="padding:10px 12px;margin-top:8px">
    <div style="font-size:.76rem;color:var(--muted);margin-bottom:6px">Pedido <b>${esc(p.numeroPedido)}</b> · ${esc(p.fornecedorNome)} · ${p.entregaPendente?'<span class="badge b-orange">entrega pendente</span>':'<span class="badge b-green">já entregue</span>'}</div>
    <div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Qtd pedida</th><th>Qtd pendente</th><th></th></tr></thead><tbody>
    ${p.itens.map((it,idx)=>`<tr><td>${it.cadastradoNaProducao?esc(it.produtoNome):`<span title="Cadastre este produto em Produção antes de agendar">⚠️ Produto ${esc(it.cod)} não cadastrado</span>`}</td><td>${it.quantidadePedida.toLocaleString('pt-BR')}</td><td>${it.quantidadePendente.toLocaleString('pt-BR')}</td><td>${it.cadastradoNaProducao?`<button type="button" class="btn btn-ghost btn-sm" data-pcp-age-usar="${idx}">Usar este item</button>`:''}</td></tr>`).join('')}
    </tbody></table></div>
  </div>`;
}
async function buscarPedidoAgendaBluesoft(){
  const numero=document.getElementById('pcp-age-busca-num')?.value.trim()||'';
  if(!numero)return global.showToast?.('Informe o número do pedido.','warning');
  if(typeof global.buscarPedidoCompraBluesoftPorNumero!=='function'){global.showToast?.('Serviço de integração Bluesoft indisponível.','error');return;}
  _buscaPedido=null;_buscaPedidoErro='';desenhar();
  try{
    _buscaPedido=await global.buscarPedidoCompraBluesoftPorNumero(numero);
  }catch(e){_buscaPedidoErro=e.message||String(e);}
  desenhar();
}
function usarItemBuscaPedidoAgenda(idx){
  if(!_buscaPedido)return;
  const it=_buscaPedido.itens[idx];if(!it||!it.cadastradoNaProducao)return;
  const campo=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  campo('pcp-age-prod',it.cod);campo('pcp-age-forn',_buscaPedido.fornecedorNome);
  campo('pcp-age-qtd',it.quantidadePendente||it.quantidadePedida);campo('pcp-age-compra',_buscaPedido.numeroPedido);
  global.showToast?.('Preenchido a partir do pedido Bluesoft — confirme a data real de entrega.','success');
}
function agendHtml(){return `<div class="tc" style="padding:12px;margin-bottom:12px">${tem('criar')?`<div style="display:flex;gap:7px;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)"><input class="field" id="pcp-age-busca-num" placeholder="Nº do pedido Bluesoft" style="max-width:220px"><button type="button" class="btn btn-ghost btn-sm" data-pcp-age-buscar>🔎 Buscar pedido na Bluesoft</button></div>${_buscaPedidoHtml()}<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:7px;margin-top:10px"><select class="field" id="pcp-age-prod">${produtoOpts()}</select><input class="field" id="pcp-age-forn" placeholder="Fornecedor"><input class="field" id="pcp-age-qtd" type="number" min="0" placeholder="Quantidade"><input class="field" id="pcp-age-data" type="date" title="Data real confirmada pelo fornecedor"><input class="field" id="pcp-age-compra" placeholder="Nº compra/pedido"><button class="btn btn-primary btn-sm" data-pcp-age-save>+ Agendar</button></div>`:''}</div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Fornecedor</th><th>Qtd</th><th>Entrega</th><th>Comprador</th><th>Compra/Pedido</th><th>Recebido</th><th>Pendente</th><th>Status</th><th></th></tr></thead><tbody>${agend.length?agend.map(x=>`<tr><td><b>${esc(x.produto)}</b></td><td>${esc(x.fornecedor||'')}</td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td><td>${esc(x.dataPrevista||'')} ${esc(x.horario||'')}</td><td>${esc(x.compradorNome||x.compradorEmail||'')}</td><td>${esc(x.numeroCompra||'')}</td><td>${n(x.quantidadeRecebida).toLocaleString('pt-BR')}</td><td>${Math.max(0,n(x.quantidade)-n(x.quantidadeRecebida)).toLocaleString('pt-BR')}</td><td>${statusBadge(x.status)}</td><td>${tem('editar')&&!/finaliz|cancel/i.test(String(x.status||''))?`<button class="btn btn-ghost btn-sm" data-pcp-age-receber="${esc(x._id)}">Receber</button>`:''}</td></tr>`).join(''):'<tr><td colspan="10">Nenhum agendamento.</td></tr>'}</tbody></table></div></div>`;}
// PEDIDO AO VIVO (2026-09-07): "da programação de produção, que está
// vendo a média, media dia. É pra colocar venda média, mensal. Previsão
// dia. É pra colocar previsão mensal" — trocado demandaHistoricaDia/
// previsaoFuturaDia (só populados pelo motor de demanda antigo, sempre
// "—" pros produtos vindos do BI, que são a maioria hoje) por
// consumoMensal/previsaoMensal, que existem pras 2 fontes (BI e motor).
function prodReqHtml(v){const sugestoes=v.filter(x=>x.necessidade>0&&produzidoInternamente(x.key)).slice(0,50);return `<div class="tc" style="margin-bottom:12px"><div style="padding:12px 14px;border-bottom:1px solid var(--border)"><b>Sugestões de produção</b><div style="font-size:.7rem;color:var(--muted);margin-top:3px">Quantidade provável baseada em vendas, previsão futura, pedidos, estoque, entradas e cobertura desejada.</div></div><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Estoque disp.</th><th>Venda média mensal</th><th>Previsão mensal</th><th>Pedidos</th><th>Meta</th><th>Qtd provável</th><th>Motivo</th><th></th></tr></thead><tbody>${sugestoes.length?sugestoes.map(x=>`<tr><td><b>${esc(x.produto)}</b><div style="font-size:.66rem;color:var(--muted)">${esc(x.cod||'')}</div></td><td>${Math.ceil(x.estoqueDisponivel).toLocaleString('pt-BR')}</td><td>${x.consumoMensal==null?'—':Math.round(x.consumoMensal).toLocaleString('pt-BR')}</td><td>${x.previsaoMensal==null?'—':Math.round(x.previsaoMensal).toLocaleString('pt-BR')}</td><td>${Math.ceil(x.pendente).toLocaleString('pt-BR')}</td><td>${Math.ceil(x.diasAlvo)}d</td><td><b>${Math.ceil(x.necessidade).toLocaleString('pt-BR')} cx</b></td><td>${x.rupturaEm?'Risco de ruptura':'Abaixo do estoque-alvo'}</td><td>${tem('criar')?`<button class="btn btn-primary btn-sm" data-pcp-prod-prod="${esc(x.key)}">Programar</button>`:''}</td></tr>`).join(''):'<tr><td colspan="9">Sem necessidade de produção calculada.</td></tr>'}</tbody></table></div></div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Qtd</th><th>Data</th><th>Destino</th><th>Prioridade</th><th>Empresa produtora</th><th>Origem</th><th>Status</th></tr></thead><tbody>${solProd.length?solProd.map(x=>`<tr><td><b>${esc(x.produto)}</b></td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td><td>${esc(x.dataProgramada||'')}</td><td>${esc(x.destino||'')}</td><td>${esc(x.prioridade||'normal')}</td><td>${esc(x.empresaProdutoraNome||x.empresaProdutoraId||'Não definida')}</td><td>${esc(x.origem||'PCP')}</td><td>${statusBadge(x.status)}</td></tr>`).join(''):'<tr><td colspan="8">Nenhuma solicitação de produção.</td></tr>'}</tbody></table></div></div>`;}
function modalSolic(tipo,key){const v=construirVisao().find(x=>x.key===key)||{},host=document.getElementById('pcp-modal-host');if(!host)return;const compra=tipo==='compra';host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:620px"><div class="modal-header"><b>${compra?'Nova necessidade de compra':'Nova solicitação de produção'}</b><button class="modal-x" data-pcp-modal-close>×</button></div><div class="modal-body"><input type="hidden" id="pcp-s-key" value="${esc(v.key)}"><div class="form-group"><label>Produto</label><input class="field" id="pcp-s-prod" value="${esc(v.produto||'')}"></div><div class="grid2"><div class="form-group"><label>Quantidade</label><input class="field" id="pcp-s-qtd" type="number" min="0" value="${Math.ceil(v.necessidade||0)}"></div><div class="form-group"><label>Data necessária</label><input class="field" id="pcp-s-data" type="date"></div><div class="form-group"><label>Destino/loja</label><input class="field" id="pcp-s-dest"></div><div class="form-group"><label>Prioridade</label><select class="field" id="pcp-s-prio"><option>normal</option><option>alta</option><option>urgente</option></select></div></div><div class="form-group"><label>${compra?'Motivo':'Observação'}</label><textarea class="field" id="pcp-s-obs" rows="3">${compra&&v.necessidade>0?'Estoque insuficiente / saldo projetado negativo':''}</textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" data-pcp-modal-close>Cancelar</button><button class="btn btn-primary" data-pcp-s-save="${tipo}">Salvar</button></div></div></div>`;}
// Núcleo compartilhado entre o modal (salvarSolic) e o envio direto sem
// modal (enviarNecessidadeDireto/enviarTodasNecessidades) — mesmo roteamento
// automático de comprador dos dois jeitos.
async function _criarRequisicaoCompra(key,produtoNome,opts){
  const q=Math.max(0,n(opts.quantidade));
  if(!produtoNome||q<=0||!opts.dataNecessaria)throw new Error('Informe produto, quantidade e data.');
  const prod=produtos.find(x=>keyOf(x)===key)||produtos.find(x=>norm(x.nome)===norm(produtoNome))||{};
  const roteamento=resolverComprador(prod);
  const base={produto:produtoNome,prodKey:key,quantidade:q,dataNecessaria:opts.dataNecessaria,destino:opts.destino||'',prioridade:opts.prioridade||'normal',criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||'',pcpResponsavel:global._currentAnalistaUser?.email||'',pcpUid:global._currentAnalistaUser?.uid||''};
  await fs().collection(CREQ).add({...base,motivo:opts.motivo||'',status:roteamento.compradorUid?'solicitada':'sem_comprador',origem:'PCP',fornecedorSugerido:prod.fornecedorPadrao||prod.fornecedor||'',categoria:prod.categoria||prod.classificacao||'',...roteamento});
  return roteamento;
}
async function salvarSolic(tipo){if(!tem('criar'))return;const key=document.getElementById('pcp-s-key')?.value||'',produto=document.getElementById('pcp-s-prod')?.value.trim()||'',q=Math.max(0,n(document.getElementById('pcp-s-qtd')?.value)),data=document.getElementById('pcp-s-data')?.value||'',destino=document.getElementById('pcp-s-dest')?.value.trim()||'',prioridade=document.getElementById('pcp-s-prio')?.value||'normal',obs=document.getElementById('pcp-s-obs')?.value.trim()||'';if(!produto||q<=0||!data){global.showToast?.('Informe produto, quantidade e data.','warning');return;}if(tipo==='compra'){const roteamento=await _criarRequisicaoCompra(key,produto,{quantidade:q,dataNecessaria:data,destino,prioridade,motivo:obs});if(!roteamento.compradorUid)global.showToast?.('Requisição criada, mas não existe regra de comprador para este produto/categoria/fornecedor.','warning');}else {const base={produto,prodKey:key,quantidade:q,dataNecessaria:data,destino,prioridade,criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||'',pcpResponsavel:global._currentAnalistaUser?.email||'',pcpUid:global._currentAnalistaUser?.uid||''};const prod=produtos.find(x=>keyOf(x)===key)||produtos.find(x=>norm(x.nome)===norm(produto))||{},lojaId=global.getDTLojaAtiva?.()||'';const empresaProdutoraId=String(prod.empresaProdutoraId||''),empresaProdutoraNome=String(prod.empresaProdutoraNome||'');await raw().collection(CPRODREQ).add({...base,dataProgramada:data,observacao:obs,status:empresaProdutoraId?'solicitada':'sem_empresa_produtora',origem:'PCP',origemLojaId:lojaId,empresaProdutoraId,empresaProdutoraNome});if(!empresaProdutoraId)global.showToast?.('Solicitação criada, mas o produto não possui empresa produtora cadastrada.','warning');}document.getElementById('pcp-modal-host').innerHTML='';await carregar(true);desenhar();}
// PEDIDO AO VIVO (2026-09-02): "colocar já alguma coisa que já envia
// automaticamente o pedido pra compras direto" — mesmos defaults que o
// modal já sugeria (quantidade=necessidade arredondada, motivo padrão,
// prioridade normal, data=hoje), sem abrir modal nenhum.
const MOTIVO_NECESSIDADE_PADRAO='Estoque insuficiente / saldo projetado negativo';
async function enviarNecessidadeDireto(key){
  if(!tem('criar'))return;
  const item=construirVisao().find(x=>x.key===key);
  if(!item||!(item.necessidade>0))return;
  try{
    const roteamento=await _criarRequisicaoCompra(key,item.produto,{quantidade:Math.ceil(item.necessidade),dataNecessaria:new Date().toISOString().slice(0,10),prioridade:'normal',motivo:MOTIVO_NECESSIDADE_PADRAO});
    global.showToast?.(roteamento.compradorUid?`Pedido enviado para ${roteamento.compradorNome||roteamento.compradorEmail}.`:'Pedido criado, mas sem comprador cadastrado pra esse produto/categoria/fornecedor.',roteamento.compradorUid?'success':'warning');
  }catch(e){global.showToast?.(e.message,'error');}
  await carregar(true);desenhar();
}
async function enviarTodasNecessidades(){
  if(!tem('criar'))return;
  const alvos=construirVisao(dadosFiltrados()).filter(x=>x.necessidade>0&&!produzidoInternamente(x.key));
  if(!alvos.length){global.showToast?.('Nenhuma necessidade de compra pra enviar.','warning');return;}
  if(!confirm(`Enviar pedido de compra pra ${alvos.length} produto(s)?`))return;
  const hoje=new Date().toISOString().slice(0,10);
  let ok=0,semComprador=0;
  for(const item of alvos){
    try{const roteamento=await _criarRequisicaoCompra(item.key,item.produto,{quantidade:Math.ceil(item.necessidade),dataNecessaria:hoje,prioridade:'normal',motivo:MOTIVO_NECESSIDADE_PADRAO});ok++;if(!roteamento.compradorUid)semComprador++;}
    catch(e){/* segue tentando os demais */}
  }
  global.showToast?.(`${ok} pedido(s) enviado(s)`+(semComprador?`, ${semComprador} sem comprador cadastrado`:'')+'.','success');
  await carregar(true);desenhar();
}
async function salvarPedido(){if(!tem('criar'))return;const pv=document.getElementById('pcp-ped-prod')?.value,p=produtoByValue(pv),q=Math.max(0,n(document.getElementById('pcp-ped-qtd')?.value)),destino=document.getElementById('pcp-ped-loja')?.value.trim()||'',data=document.getElementById('pcp-ped-data')?.value||'',pedido=document.getElementById('pcp-ped-num')?.value.trim()||'';if(!p.nome||q<=0||!data){global.showToast?.('Informe produto, quantidade e data necessária.','warning');return;}await fs().collection(CPED).add({cod:p.cod||'',produto:p.nome,quantidade:q,quantidadeAtendida:0,destino,dataNecessaria:data,pedido,status:'pendente',criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||''});await carregar(true);desenhar();}
async function atenderPedido(id){if(!tem('editar'))return;const x=pedidos.find(z=>z._id===id);if(!x)return;const val=prompt('Quantidade atendida',String(n(x.quantidadeAtendida)));if(val==null)return;const qa=Math.max(0,Math.min(n(x.quantidade),n(val))),status=qa>=n(x.quantidade)?'atendido':qa>0?'parcial':'pendente';await fs().collection(CPED).doc(id).set({quantidadeAtendida:qa,status,atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true});await carregar(true);desenhar();}

function modalRecebimentoAgendamento(id){const x=agend.find(a=>a._id===id),host=document.getElementById('pcp-modal-host');if(!x||!host)return;const restante=Math.max(0,n(x.quantidade)-n(x.quantidadeRecebida));host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:480px"><div class="modal-header"><b>Recebimento — ${esc(x.produto)}</b><button class="modal-x" data-pcp-modal-close>×</button></div><div class="modal-body"><div class="form-group"><label>Quantidade recebida agora</label><input class="field" id="pcp-age-rec-qtd" type="number" min="0" max="${restante}" value="${restante}"></div><div style="font-size:.72rem;color:var(--muted)">Já recebido: ${n(x.quantidadeRecebida)} · Pendente: ${restante}</div></div><div class="modal-footer"><button class="btn btn-ghost" data-pcp-modal-close>Cancelar</button><button class="btn btn-primary" data-pcp-age-rec-save="${esc(id)}">Confirmar recebimento</button></div></div></div>`;}
async function receberAgendamento(id){if(!tem('editar'))return;const x=agend.find(a=>a._id===id);if(!x)return;const agoraQtd=Math.max(0,n(document.getElementById('pcp-age-rec-qtd')?.value)),anterior=n(x.quantidadeRecebida),total=Math.min(n(x.quantidade),anterior+agoraQtd);if(agoraQtd<=0)return global.showToast?.('Informe a quantidade recebida.','warning');const final=total>=n(x.quantidade),st=final?'finalizada':'parcial',deltaRecebido=total-anterior;if(typeof global.aplicarEntradaEstoqueProducao!=='function')throw new Error('Motor de estoque da Produção indisponível.');await global.aplicarEntradaEstoqueProducao({prodKey:x.prodKey||x.cod||'',produto:x.produto||'',qtdCx:deltaRecebido,movimentoId:'compra_'+id+'_'+total,tipo:'recebimento_compra',origemId:id});await fs().collection(CAGE).doc(id).set({quantidadeRecebida:total,status:st,recebidoEm:now(),recebidoPor:global._currentAnalistaUser?.email||'',atualizadoEm:now()},{merge:true});if(x.requisicaoId)await fs().collection(CREQ).doc(x.requisicaoId).set({status:final?'finalizada':'parcialmente_recebida',quantidadeRecebida:total,atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true});document.getElementById('pcp-modal-host').innerHTML='';await carregar(true);desenhar();}
async function salvarAgendamento(){if(!tem('criar'))return;const pv=document.getElementById('pcp-age-prod')?.value,p=produtoByValue(pv),q=Math.max(0,n(document.getElementById('pcp-age-qtd')?.value)),fornecedor=document.getElementById('pcp-age-forn')?.value.trim()||'',data=document.getElementById('pcp-age-data')?.value||'',num=document.getElementById('pcp-age-compra')?.value.trim()||'';if(!p.nome||q<=0||!data)return global.showToast?.('Informe produto, quantidade e data.','warning');await fs().collection(CAGE).add({cod:p.cod||'',produto:p.nome,fornecedor,quantidade:q,quantidadeRecebida:0,dataPrevista:data,numeroCompra:num,status:'prevista',criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||''});_buscaPedido=null;_buscaPedidoErro='';await carregar(true);desenhar();}
async function excluir(tipo,id){if(!tem('excluir')||!confirm('Excluir este registro do PCP?'))return;const col=tipo==='pedido'?CPED:null;if(!col)return;await fs().collection(col).doc(id).delete();await carregar(true);desenhar();}
function desenhar(){const p=document.getElementById('page-pcp-central');if(!p)return;
  if(aba==='insumos'){
    const vi=_insumosBi||[],necIns=vi.filter(x=>x.necessidade>0).length;
    p.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">📋 PCP — Central de Planejamento</div><div style="font-size:.74rem;color:var(--muted)">Insumos (embalagem/matéria-prima) — estoque e necessidade recalculados a partir do BI${_ultimaBuscaInsumosBi?' · '+esc(_ultimaBuscaInsumosBi):''}</div></div><div style="display:flex;gap:8px">${global.DTBiPastaLocal?.suportado?.()?'<button class="btn btn-ghost btn-sm" data-pcp-buscar-insumos-bi>📊 Buscar do BI</button>':''}<button class="btn btn-ghost btn-sm" data-pcp-refresh>↻ Atualizar</button></div></div><div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${vi.length}</div><div class="kpi-lbl">Insumos com estoque/necessidade</div></div><div class="kpi orange"><div class="kpi-val">${necIns}</div><div class="kpi-lbl">Insumos com necessidade</div></div></div><div>${insumosHtml(vi)}</div>`;
    return;
  }
  // PEDIDO AO VIVO (2026-09-04): "necessidades de compra e de produção...
  // em cima do saldo" — Compras/Produção usavam uma fonte totalmente
  // separada (Firestore/PCPDemandEngine), divergente do saldo real (BI) já
  // usado em Estoque/Pedidos x Estoque desde 2026-09-02. Agora as 4 abas
  // compartilham a mesma base (_estoqueBi, quando já buscado) — sem filtro
  // de texto/categoria (essas abas nunca tiveram esse filtro na tela),
  // só a fonte de dados muda.
  const usaBi=aba==='estoque'||aba==='pedidos-estoque'||aba==='compras'||aba==='producao';
  const v=(aba==='estoque'||aba==='pedidos-estoque')?aplicarOrdenacao(visaoFiltrada()):construirVisao({...dadosFiltrados(),estoqueBi:(aba==='compras'||aba==='producao')?_estoqueBi:null});const falta=v.filter(x=>x.necessidade>0).length,pend=v.reduce((s,x)=>s+x.pendente,0),saldo=v.reduce((s,x)=>s+x.saldo,0);p.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">📋 PCP — Central de Planejamento</div><div style="font-size:.74rem;color:var(--muted)">Pedidos + estoque + produção programada + entradas previstas · ${filtros.loja?esc(lojas.find(l=>l.id===filtros.loja)?.nome||'Loja selecionada'):'todas as lojas consolidadas'}${usaBi&&_ultimaBuscaEstoqueBi?' · '+esc(_ultimaBuscaEstoqueBi):''}</div></div><div style="display:flex;gap:8px">${usaBi&&global.DTBiPastaLocal?.suportado?.()?'<button class="btn btn-ghost btn-sm" data-pcp-buscar-estoque-bi>📊 Buscar do BI</button>':''}<button class="btn btn-ghost btn-sm" data-pcp-refresh>↻ Atualizar</button></div></div><div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${qtd(pend).toLocaleString('pt-BR')}</div><div class="kpi-lbl">Pedidos pendentes</div></div><div class="kpi orange"><div class="kpi-val">${falta}</div><div class="kpi-lbl">Produtos com necessidade</div></div><div class="kpi teal"><div class="kpi-val">${reqs.filter(x=>(!filtros.loja||x.lojaId===filtros.loja)&&!/final|cancel|rejeit/i.test(String(x.status||''))).length}</div><div class="kpi-lbl">Requisições abertas</div></div><div class="kpi green"><div class="kpi-val">${Math.ceil(saldo).toLocaleString('pt-BR')}</div><div class="kpi-lbl">Saldo projetado total</div></div></div><div>${aba==='pedidos'?pedidosHtml():aba==='estoque'?estoqueHtml(v):aba==='pedidos-estoque'?cruzamentoHtml(v):aba==='compras'?comprasHtml(v):aba==='agendamentos'?agendHtml():prodReqHtml(v)}</div>`;}
async function render(){const p=document.getElementById('page-pcp-central');if(!p)return;p.innerHTML='<div class="empty">Carregando PCP...</div>';try{await carregar(true);desenhar();}catch(e){p.innerHTML='<div class="empty">Falha ao carregar PCP: '+esc(e.message||e)+'</div>';}}
document.addEventListener('click',e=>{if(e.target.closest('[data-pcp-limpar-filtros]')){filtros={loja:'',busca:'',marca:'',categoria:'',situacao:'',ocultarZerados:true};desenhar();return;}const sortTh=e.target.closest('[data-pcp-sort]');if(sortTh){pcpOrdenarPor(sortTh.dataset.pcpSort);return;}const btnRefresh=e.target.closest('[data-pcp-refresh]');if(btnRefresh){pcpAtualizarComSync(btnRefresh);return;}if(e.target.closest('[data-pcp-buscar-estoque-bi]')){buscarEstoqueBi();return;}if(e.target.closest('[data-pcp-buscar-insumos-bi]')){buscarInsumosBi();return;}if(e.target.closest('[data-pcp-ped-save]')){salvarPedido().catch(x=>global.showToast?.(x.message,'error'));return;}const at=e.target.closest('[data-pcp-ped-atender]');if(at){atenderPedido(at.dataset.pcpPedAtender).catch(x=>global.showToast?.(x.message,'error'));return;}const rq=e.target.closest('[data-pcp-req-prod]');if(rq){modalSolic('compra',rq.dataset.pcpReqProd);return;}const ne=e.target.closest('[data-pcp-nec-enviar]');if(ne){enviarNecessidadeDireto(ne.dataset.pcpNecEnviar).catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-pcp-nec-enviar-todos]')){enviarTodasNecessidades().catch(x=>global.showToast?.(x.message,'error'));return;}const sp=e.target.closest('[data-pcp-prod-prod]');if(sp){modalSolic('producao',sp.dataset.pcpProdProd);return;}const sv=e.target.closest('[data-pcp-s-save]');if(sv){salvarSolic(sv.dataset.pcpSSave).catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-pcp-age-save]')){salvarAgendamento().catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-pcp-age-buscar]')){buscarPedidoAgendaBluesoft();return;}const usar=e.target.closest('[data-pcp-age-usar]');if(usar){usarItemBuscaPedidoAgenda(Number(usar.dataset.pcpAgeUsar));return;}const ar=e.target.closest('[data-pcp-age-receber]');if(ar){modalRecebimentoAgendamento(ar.dataset.pcpAgeReceber);return;}const ars=e.target.closest('[data-pcp-age-rec-save]');if(ars){receberAgendamento(ars.dataset.pcpAgeRecSave).catch(x=>global.showToast?.(x.message,'error'));return;}const del=e.target.closest('[data-pcp-del]');if(del){const [tipo,id]=del.dataset.pcpDel.split('|');excluir(tipo,id).catch(x=>global.showToast?.(x.message,'error'));return;}const mem=e.target.closest('[data-pcp-memoria]');if(mem){modalMemoria(mem.dataset.pcpMemoria);return;}if(e.target.closest('[data-pcp-modal-close]')){const h=document.getElementById('pcp-modal-host');if(h)h.innerHTML='';}});
document.addEventListener('change',e=>{const el=e.target.closest('[data-pcp-filtro]');if(el){filtros[el.dataset.pcpFiltro]=el.value;desenhar();return;}const chk=e.target.closest('[data-pcp-filtro-check]');if(chk){filtros[chk.dataset.pcpFiltroCheck]=chk.checked;desenhar();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-pcp-mem-save]');if(b)salvarCoberturaMemoria(b.dataset.pcpMemSave).catch(x=>global.showToast?.(x.message||String(x),'error'));});
document.addEventListener('input',e=>{const el=e.target.closest('[data-pcp-filtro="busca"]');if(el){filtros.busca=el.value;clearTimeout(global.__pcpFiltroTimer);global.__pcpFiltroTimer=setTimeout(desenhar,180);}});
function pcpGetAbaAtual(){return aba;}
global.pcpGetAbaAtual=pcpGetAbaAtual;
global.renderPCPCentral=render;global.pcpIrParaAba=pcpIrParaAba;global.pcpRegistrarPagina=pcpRegistrarPagina;global.modalMemoria=modalMemoria;global._pcpInternals={construirVisao,keyOf,norm,resolverComprador,memoriaDeCalculo,carregar,getReqs:()=>reqs,getAgend:()=>agend,getProdutos:()=>produtos,getProjecao:()=>projecao,_juntarEstoqueBi,buscarEstoqueBi,getEstoqueBi:()=>_estoqueBi,setEstoqueBi:v=>{_estoqueBi=v;},setAba:v=>{aba=v;},produzidoInternamente,_juntarInsumosBi,buscarInsumosBi,getInsumosBi:()=>_insumosBi,setInsumosBi:v=>{_insumosBi=v;},insumosHtml,cruzamentoHtml,_criarRequisicaoCompra,enviarNecessidadeDireto,enviarTodasNecessidades,_categoriaDoNome,metaProduto,visaoFiltrada,filtrosHtml,setProdutos:v=>{produtos=v;},getFiltros:()=>filtros,setFiltros:v=>{filtros={...filtros,...v};},comprasHtml,getUltimaBuscaInsumosBi:()=>_ultimaBuscaInsumosBi,estoqueHtml,prodReqHtml,setSolProd:v=>{solProd=v;}};
})(window);
