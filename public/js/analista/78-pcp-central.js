// PCP — Fase 2: central de planejamento. Reutiliza estoque/projecao e OPs da Produção.
(function(global){'use strict';
const CPED='pcp_pedidos', CREQ='pcp_requisicoes_compra', CAGE='pcp_agendamentos', CPRODREQ='pcp_solicitacoes_producao_global', CREGR='compras_regras_comprador';
const CPROD='producao_produtos', CPRODAPI='pcp_produtos_bluesoft', CPROJ='producao_projecao', CESTAPI='pcp_estoque_bluesoft', COP='producao_registros';
// PEDIDO AO VIVO (2026-09-21): "quero um único lugar gravando todas as
// informações dos produtos" — CPRODMESTRE é global (não por loja, ao
// contrário de CPROD/CPRODAPI acima), key = cod. Ainda vazia em produção
// até o script scripts/migrar-produtos-mestre.js rodar; até lá o merge
// abaixo é um no-op inofensivo. CBICLASS é a classificação REAL da
// Bluesoft (departamento/seção/grupo), já sincronizada há tempos por
// sincronizarComprasHistoricoBiAgendado (functions/index.js) mas nunca lida
// por nenhuma tela até agora — usada aqui só como fallback de categoria,
// antes do último recurso (_categoriaDoNome, primeira palavra do nome).
const CPRODMESTRE='produtos_mestre', CBICLASS='bi_classificacao_produtos';
let pedidos=[],reqs=[],agend=[],solProd=[],produtos=[],projecao=[],ops=[],regrasCompradores=[],usuariosCompras=[],lojas=[],aba='pedidos',carregado=false;
let solicitacoesVisao='solicitar';
let _produtosMestre=new Map(),_biClassificacao=new Map(),_fornecedorVinculosPorProduto=new Map(),_fornecedoresPorId=new Map();
// PEDIDO AO VIVO (2026-09-18): "não quero fazer uma solicitação de cada
// vez... selecionar fornecedor, ver os produtos dele, quantidade e várias
// datas de entrega de uma vez, tipo minha planilha de Excel" — cadastro em
// lote por fornecedor. Estado do modal só existe enquanto ele está aberto.
let loteFornecedores=[],loteFornecedorId='',loteProdutosFornecedor=[],loteLinhas=[];
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
let _estoqueBi=null,_estoqueBiRaw=null,_escadinhaBiRaw=null,_codsValidosBi=null,_ultimaBuscaEstoqueBi='';
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
let _insumosBi=null,_insumosBiRaw=null,_ultimaBuscaInsumosBi='';
let filtrosInsumos={loja:'',grupo:'',tipo:'',busca:''};
let filtros={loja:'',busca:'',marca:'',categoria:'',situacao:'',acao:'',ocultarZerados:true};
// Cache da visão pesada do PCP. Troca de aba reaproveita o mesmo cálculo enquanto
// dados-base/estoque não mudarem; filtros visuais continuam aplicados depois.
let _visaoRevision=0,_visaoCalcCount=0,_visaoBaseCache=new Map(),_transferenciasCache={rev:-1,valor:null};
function invalidarVisao(){_visaoRevision+=1;_visaoBaseCache.clear();_transferenciasCache={rev:-1,valor:null};}
function _visaoBaseMemo(usarBi){const key=String(_visaoRevision)+'|'+(usarBi?'bi':'sem-bi')+'|'+String(filtros.loja||'');if(_visaoBaseCache.has(key))return _visaoBaseCache.get(key);const valor=construirVisao({...dadosFiltrados(),estoqueBi:usarBi?_estoqueBi:null});_visaoCalcCount+=1;_visaoBaseCache.set(key,valor);return valor;}
function _sugestoesTransferenciaMemo(){if(_transferenciasCache.rev===_visaoRevision&&Array.isArray(_transferenciasCache.valor))return _transferenciasCache.valor;const valor=calcularSugestoesTransferencia();_transferenciasCache={rev:_visaoRevision,valor};return valor;}
let _transferenciasPlanejamento=new Map();
let _carregamentoPcpPendente=null;
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
// PEDIDO AO VIVO (2026-09-21): a categoria por primeira-palavra-do-nome
// acima gerava 122 categorias fragmentadas de verdade (ex.: "BOBINA CANELA
// PO" virava categoria BOBINA, "CANELA DA TERRINHA 20G" virava CANELA —
// mesmo tempero, categorias diferentes). bi_classificacao_produtos já tem a
// classificação REAL da Bluesoft (departamento/seção/grupo, sincronizada a
// cada 4h por sincronizarComprasHistoricoBiAgendado em functions/index.js),
// só nunca foi lida por nenhuma tela. Ordem de preferência isolada numa
// constante só pra poder trocar com 1 linha se `grupo` não for o nível
// certo de granularidade quando confrontado com a planilha real.
const ORDEM_CATEGORIA_BLUESOFT=['grupo','secao','departamento'];
// PEDIDO AO VIVO (2026-09-25, 3ª rodada): "nas categorias nao precisa
// aparecer insumos e materia prima" — Planejamento (e o alias legado
// 'estoque') é a visão de produto acabado; essas 2 categorias da planilha
// revisada não fazem sentido nem como opção de filtro nem como linha aqui.
const CATEGORIAS_OCULTAS_PLANEJAMENTO=['insumos','materia prima'];
// PEDIDO AO VIVO (2026-09-25, 4ª rodada): "aqui nao precisa aparecer os
// produtos em und" — lista curada à mão pelo usuário (planilha
// produtos-categorias.csv, aba nova com as variantes de venda avulsa,
// sufixo "- UND", que já têm uma irmã em caixa/fardo). O heurístico
// automático (embalagemKeyBluesoft==='UN', ver buscarEstoqueBi) já se
// provou não confiável o bastante (comentário logo acima) pra esconder
// linha inteira da tabela, só serve pro merge de estoque BI — por isso
// esta lista fixa, exportada pelo usuário, em vez de inferir sozinho.
const CODIGOS_UND_PLANEJAMENTO=new Set(['48722','48782','48059','48063','70230','70376','70387','70232','71309','70244','70287','70236','71688','71747','71749','71692','70289','70291','70293','70242','70238','70240','70307','72229','72249','72231','72233','76399','72237','77520','77864','118319','118352','118385','118418','118451','96143','96244','96341','75878','75876','97661','114260','114299','114293','114301','114295','114303','114297','114305','50099','50101','72169','38151','48785','48666','48683','61827','48302','80604','52687','70372','62234','62231','90700','90780','90800','90820','90940','90960','90980','50103','96644','96737','96968','78982','78983','78984','78985','79001','48744','48882','50721','75955','75344','71700','48704','72105','72569','86800','86820','50105','50107','80606','33732','48055','48049','48057','48053','48051','48022','87681','48042','83800','108023','108058','108059','28962','28964','72087','32769','32775','78642','85776','52749','54147','78460','78440','53047','48002','47962','108063','96506','96576','96575','80648','80380','80520','80640','48748','75371','72107','72568','48262','80642','100862','60847','70273','40575','40576','40581','40583','40585','40593','70275','70277','70267','70269','70271','75895','48695','97001','96972','96971','41537','41539','41543','77780','48763','51327','118484','118517','48627','48602','40587','40589','70374','48342','50113','50115','48162','48144','86860','83380','50121','1','2','25444','72010','111919','77902','80646','58729','32477','4744','9924','45222','51807','49202','49262','49242','68407','76200','76202','98387','98389','143498','963','32787','7144','7145','69167','50125','50127','50129','50144','48122','108062','96803','80980']);
function _categoriaDeBluesoft(item){
  const cod=String(item?.cod||item?.bluesoftProdutoKey||'').trim();
  const cls=cod&&_biClassificacao.get(cod);
  if(!cls)return '';
  for(const campo of ORDEM_CATEGORIA_BLUESOFT){const v=String(cls[campo]||'').trim();if(v)return v.toUpperCase();}
  return '';
}
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
// PEDIDO AO VIVO (2026-10-01): "quero que verifique se não mostra que o
// estoque está negativo também... para saber que é um erro no sistema e
// tem que ajustar via inventário lá no Bluesoft" — qtd() acima SEMPRE
// floora em 0, o que escondia estoque genuinamente negativo (erro real de
// inventário na Bluesoft, confirmado contra o BI: produto com -144 em
// estoque aparecia como 0 na coluna Estoque). qtdReal() é igual, só sem o
// piso — usada especificamente na coluna Estoque (nunca em Pedidos/
// Necessidade/Consumo mensal, que continuam legitimamente não-negativos).
const qtdReal=v=>Math.ceil(n(v));
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
// Quando existe loja explicitamente selecionada, permite às telas de detalhe
// responderem pelo abastecimento daquela loja. Sem loja, mantém a regra
// consolidada histórica do PCP (produzido em qualquer variante = interno).
function produzidoInternamenteNaLoja(key,lojaId=''){
  const loja=String(lojaId||'').trim();
  if(!loja)return produzidoInternamente(key);
  const variantes=produtos.filter(p=>keyOf(p)===key&&String(p.lojaId||'')===loja);
  return variantes.some(p=>!!(p.empresaProdutoraId||p.maquina));
}
function aliasesProduto(key){
  const k=String(key||'').trim(),campos=['cod','prodCod','prodKey','bluesoftProdutoKey','produtoUnitarioKey','produtoUnitarioKeyBluesoft','canonicalKey'];
  const out=new Set(k?[k]:[]);
  produtos.filter(p=>keyOf(p)===k).forEach(p=>campos.forEach(c=>{const v=String(p?.[c]??'').trim();if(v)out.add(v);}));
  const cad=resolverCadastroProduto(k);campos.forEach(c=>{const v=String(cad?.[c]??'').trim();if(v)out.add(v);});
  return [...out];
}
// Cadastro canônico do produto para todas as telas do PCP. `produtos_mestre`
// fornece somente identidade global (nome/categoria/tipo/ativo); parâmetros
// operacionais continuam pertencendo à variante/loja. A variante local é
// escolhida de forma determinística, priorizando a loja selecionada/ativa
// e depois o registro mais completo — nunca o maior valor numérico.
function resolverCadastroProduto(key,{lista=produtos,lojaId=''}={}){
  const k=String(key||'').trim(), candidatos=(lista||[]).filter(x=>keyOf(x)===k);
  const alvo=String(lojaId||filtros.loja||global.getDTLojaAtiva?.()||'');
  const score=x=>{
    let s=0;if(alvo&&String(x.lojaId||'')===alvo)s+=100;
    if(x.nome&&!/^Produto\s+\d+$/i.test(String(x.nome)))s+=20;
    if(x.empresaProdutoraId||x.maquina)s+=10;
    ['metaCoberturaDias','estoqueMinimo','estoqueMaximo','estoqueSeguranca','leadTimeDias','loteMinimoCompra','multiploCompra','fornecedorPadraoId'].forEach(c=>{if(x[c]!==undefined&&x[c]!==null&&x[c]!=='')s+=1;});
    return s;
  };
  const ordenados=candidatos.slice().sort((a,b)=>score(b)-score(a)||String(a.lojaId||'').localeCompare(String(b.lojaId||''))||String(a._id||a._firestoreId||'').localeCompare(String(b._id||b._firestoreId||'')));
  const base=ordenados[0]||{};
  const cod=String(base.cod||k).trim();
  const mestre=_produtosMestre.get(cod)||{};
  // `produtos_mestre` é identidade global do SKU. Parâmetros operacionais
  // (cobertura, segurança, lead time, lote, produção, fornecedor etc.)
  // continuam vindo da variante/loja selecionada; nunca deixe o último
  // salvamento de outra loja sobrescrever silenciosamente esses campos.
  const mestreGlobal={};
  ['cod','nome','descricao','categoria','classificacao','marcaPropria','tipoProduto','bluesoftTipoProduto','ativo','produtoAtivo','pc_min','unid','fatorCaixaBluesoft','embalagemKeyBluesoft','produtoUnitarioKeyBluesoft','canonicalKey'].forEach(c=>{if(mestre[c]!==undefined)mestreGlobal[c]=mestre[c];});
  return {...base,...mestreGlobal,fornecedorPadraoId:String(base.fornecedorPadraoId||base.fornecedorId||''),fornecedorPadrao:base.fornecedorPadrao||base.fornecedor||'',cod:mestreGlobal.cod||base.cod||cod,_variantes:candidatos};
}
function _dataMs(v){const d=v?new Date(v):null;return d&&!isNaN(d.getTime())?d.getTime():null;}
function _medianaNumerica(valores){const xs=(valores||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return null;const m=Math.floor(xs.length/2);return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;}
// Fonte única de lead time do PCP. Hierarquia única:
// 1) manual SKU/loja; 2) vínculo fornecedor×produto escolhido; 3) histórico
// real do SKU/fornecedor; 4) padrão do fornecedor mestre; 5) fallback global.
// Produto fabricado internamente não herda lead time de compras.
function _vinculosFornecedorProduto(k){
  const aliases=new Set(aliasesProduto(k).map(String));aliases.add(String(k||''));
  const out=[];aliases.forEach(a=>(_fornecedorVinculosPorProduto.get(a)||[]).forEach(v=>out.push(v)));
  const unicos=new Map();out.forEach(v=>unicos.set(String(v._id||v.fornecedorId+'|'+v.produtoId),v));return Array.from(unicos.values());
}
function _fornecedorEscolhidoLeadTime(cad,k){
  const preferidoId=String(cad?.fornecedorPadraoId||cad?.fornecedorId||'').trim();
  const vinculos=_vinculosFornecedorProduto(k).filter(v=>v&&v.homologado!==false);
  let vinculo=preferidoId?vinculos.find(v=>String(v.fornecedorId||'')===preferidoId):null;
  if(!vinculo&&vinculos.length===1)vinculo=vinculos[0];
  const fornecedorId=String(vinculo?.fornecedorId||preferidoId||'').trim();
  const fornecedor=_fornecedoresPorId.get(fornecedorId)||null;
  return {fornecedorId,vinculo,fornecedor};
}
function resolverLeadTimeProduto(key,{produto=null,agendamentos=agend,requisicoes=reqs,lojaId='',minAmostras=3,maxAmostras=12}={}){
  const k=String(key||'').trim(),cad=produto||resolverCadastroProduto(k,{lojaId});
  const manual=n(cad?.leadTimeDias??cad?.lead_time_dias);
  if(manual>0)return {dias:manual,fonte:'manual',rotulo:'Configurado manualmente no SKU/loja',amostras:0};
  const loja=String(lojaId||filtros.loja||global.getDTLojaAtiva?.()||'');
  const interno=loja?produzidoInternamenteNaLoja(k,loja):produzidoInternamente(k);
  if(interno){
    const padraoInterno=Math.max(0,n(global.PCP_DEMANDA_PARAMETROS?.defaultLeadTimeDays)||7);
    return {dias:padraoInterno,fonte:'padrao',rotulo:'Padrão operacional · produção sem lead time manual',amostras:0};
  }
  const escolha=_fornecedorEscolhidoLeadTime(cad,k);
  const leadVinculo=n(escolha.vinculo?.leadTimeDias);
  if(leadVinculo>0)return {dias:leadVinculo,fonte:'fornecedor_produto',rotulo:'Vínculo fornecedor × produto',amostras:0,fornecedorId:escolha.fornecedorId};

  const reqPorId=new Map(),reqPorPedido=new Map();
  (requisicoes||[]).forEach(r=>{if(loja&&String(r.lojaId||'')!==loja)return;if(r._id)reqPorId.set(String(r._id),r);if(r.numeroCompra)reqPorPedido.set(String(r.numeroCompra),r);});
  const amostras=[];
  (agendamentos||[]).forEach(a=>{
    if(loja&&String(a.lojaId||'')!==loja)return;
    const req=(a.requisicaoId&&reqPorId.get(String(a.requisicaoId)))||(a.numeroCompra&&reqPorPedido.get(String(a.numeroCompra)))||null;
    const chaveA=keyOf(a),chaveR=req?keyOf(req):'';
    if(chaveA!==k&&chaveR!==k)return;
    if(/cancel|rejeit/i.test(String(a.status||'')))return;
    const fornecedorId=String(a.fornecedorId||req?.fornecedorId||'').trim();
    if(escolha.fornecedorId&&fornecedorId&&fornecedorId!==escolha.fornecedorId)return;
    if(escolha.fornecedorId&&!fornecedorId){
      const nomeEsperado=norm(escolha.fornecedor?.nomeFantasia||escolha.fornecedor?.razaoSocial||cad?.fornecedorPadrao||'');
      const nomeRegistro=norm(a.fornecedor||a.fornecedorNome||req?.fornecedor||'');
      if(nomeEsperado&&nomeRegistro&&nomeEsperado!==nomeRegistro)return;
    }
    const recebido=a.recebidoEm||a.dataRecebimento||'';
    const total=n(a.quantidade),qtdRecebida=n(a.quantidadeRecebida);
    const status=String(a.status||'').toLowerCase();
    const final=/^finalizada?$|^recebida?$/.test(status)||(total>0&&qtdRecebida>=total);
    if(!final||!recebido)return;
    const inicio=req?.compradoEm||a.compradoEm||a.criadoEm||'';
    const ini=_dataMs(inicio),fim=_dataMs(recebido);if(ini==null||fim==null||fim<ini)return;
    const dias=Math.round((fim-ini)/86400000);if(dias<0||dias>365)return;
    amostras.push({dias,recebido:String(recebido)});
  });
  amostras.sort((a,b)=>b.recebido.localeCompare(a.recebido));
  const usados=amostras.slice(0,Math.max(1,n(maxAmostras)||12));
  if(usados.length>=Math.max(1,n(minAmostras)||3)){
    const med=_medianaNumerica(usados.map(x=>x.dias));
    if(med!=null)return {dias:Math.max(0,Math.round(med)),fonte:'historico_fornecedor',rotulo:`Histórico real · mediana de ${usados.length} recebimentos do SKU/fornecedor`,amostras:usados.length,valores:usados.map(x=>x.dias),fornecedorId:escolha.fornecedorId};
  }
  const leadFornecedor=n(escolha.fornecedor?.leadTimePadraoDias);
  if(leadFornecedor>0)return {dias:leadFornecedor,fonte:'fornecedor_padrao',rotulo:'Padrão do fornecedor mestre',amostras:0,fornecedorId:escolha.fornecedorId};
  const padrao=Math.max(0,n(global.PCP_DEMANDA_PARAMETROS?.defaultLeadTimeDays)||7);
  return {dias:padrao,fonte:'padrao',rotulo:'Padrão operacional · histórico/fornecedor insuficiente',amostras:0,fornecedorId:escolha.fornecedorId};
}
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
function _juntarEstoqueBi(dadosProdutosEstoque,dadosEscadinha,mesIndice,codsUnidade,lojaFiltro){
  if(mesIndice==null)mesIndice=new Date().getMonth();
  const mesRef=(mesIndice-1+12)%12;
  const porCodEscadinha=new Map();
  (dadosEscadinha?.produtos||[]).forEach(p=>{const cod=String(p.cod??'').trim();if(cod)porCodEscadinha.set(cod,p);});
  const hoje=new Date(),diasNoMes=new Date(hoje.getFullYear(),mesIndice+1,0).getDate();
  let linhas=Array.isArray(dadosProdutosEstoque)?dadosProdutosEstoque:[];
  if(lojaFiltro){
    const alvo=typeof lojaFiltro==='object'?lojaFiltro:(lojas.find(l=>String(l.id)===String(lojaFiltro))||{id:lojaFiltro});
    const nomes=[alvo.nome,alvo.codigo,alvo.razaoSocial].filter(Boolean).map(norm);
    const chaves=[alvo.id,alvo.lojaKey,alvo.loja_key,alvo.codigoExterno,alvo.bluesoft_loja_key].filter(v=>v!=null&&String(v)!=='').map(String);
    linhas=linhas.filter(it=>{
      const rk=String(it.loja_key??it.lojaId??it.loja_id??'');
      const rn=norm(it.loja||it.lojaNome||'');
      return (rk&&chaves.includes(rk))||(rn&&nomes.some(nm=>nm&&(rn===nm||rn.includes(nm)||nm.includes(rn))));
    });
  }
  const basesComCaixaOuFardo=new Set();
  linhas.forEach(it=>{if(/-\s*(CX|FD)\s*\d*\s*$/i.test(it.produto||''))basesComCaixaOuFardo.add(_baseDescricaoSemEmbalagem(it.produto));});
  const porChave=new Map();
  linhas.forEach(it=>{
    const cod=String(it.produto_key??'').trim();if(!cod)return;
    if(codsUnidade&&codsUnidade.has(cod))return;
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
    // PEDIDO AO VIVO (2026-09-30): "agora é o nome que não veio escrito por
    // completo" — dados-escadinha.json guarda o produto SEM o código
    // numérico na frente (ex.: "MILHOCA OISHII 500 G - CX 20"), enquanto
    // produtos_estoque.json traz o nome completo (ex.: "14009 MILHOCA
    // OISHII 500 G - CX 20"). Antes, quando existia linha correspondente no
    // escadinha, o nome truncado dele sempre ganhava — escondendo o código
    // de produtos sem cadastro (que não têm prod.nome pra sobrescrever isso
    // em construirVisao). Agora fica o texto mais completo dos dois.
    const nomeEsc=esc?.produto||'';
    const produtoFinal=nomeEsc.length>acc.produto.length?nomeEsc:acc.produto;
    out.set(cod,{cod,produto:produtoFinal,estoque:acc.estoque,pedido:Math.max(0,acc.pedido),consumoDia:consumoMensal>0?consumoMensal/diasNoMes:0,consumoMensal,previsaoMensal,plano});
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
    // PEDIDO AO VIVO (2026-09-30): "tem que aparecer todos os novos
    // produtos" — codsValidos era uma ALLOWLIST (só cod já cadastrado em
    // producao_produtos/pcp_produtos_bluesoft entrava), criada originalmente
    // pra barrar "lixo" misturado no arquivo (ex.: um item tipo "FOGÃO
    // ELÉTRICO" que não era produto de verdade). Efeito colateral real
    // descoberto ao vivo: produto genuíno que ainda não foi cadastrado
    // também ficava invisível, mesmo com estoque real e "Risco de falta"
    // (12 de 14 produtos de um terceiro/cliente sumiam do Planejamento).
    // O usuário confirmou que os filtros de relevância que já existem
    // (ocultar sem estoque/pedido/necessidade etc.) são suficientes — não
    // precisa mais exigir cadastro prévio. Mantém só a exclusão de verdade
    // (variante solta em UN, ver comentário logo abaixo) como blocklist.
    const codsUnidade=new Set(produtos.filter(p=>String(p.embalagemKeyBluesoft||'').toUpperCase()==='UN').map(p=>String(p.cod||'')));
    const [dadosProdutosEstoque,dadosEscadinha]=await Promise.all([global.DTBiPastaLocal.lerJson(ARQUIVO_BI_ESTOQUE),global.DTBiPastaLocal.lerJson(ARQUIVO_BI_ESCADINHA)]);
    _estoqueBiRaw=dadosProdutosEstoque; _escadinhaBiRaw=dadosEscadinha; _codsValidosBi=codsUnidade;
    const lojaFiltro=filtros.loja?(lojas.find(l=>String(l.id)===String(filtros.loja))||filtros.loja):null;
    _estoqueBi=_juntarEstoqueBi(dadosProdutosEstoque,dadosEscadinha,null,codsUnidade,lojaFiltro);invalidarVisao();
    _ultimaBuscaEstoqueBi=`Última atualização: ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — ${_estoqueBi.size} produto(s) do BI.`;
    desenhar();
  }catch(e){
    _ultimaBuscaEstoqueBi=`Falha na última busca: ${e.message||e}`;
    global.showToast?.('Erro ao buscar estoque no BI: '+(e.message||e),'error');
    desenhar();
  }
}
function _recalcularEstoqueBiPorLoja(){
  if(!_estoqueBiRaw||!_escadinhaBiRaw)return;
  const lojaFiltro=filtros.loja?(lojas.find(l=>String(l.id)===String(filtros.loja))||filtros.loja):null;
  _estoqueBi=_juntarEstoqueBi(_estoqueBiRaw,_escadinhaBiRaw,null,_codsValidosBi,lojaFiltro);
}

// FASE 2.2 — transferência entre lojas ANTES de uma compra nova.
// Não lê Firestore e não cria movimentação automaticamente. Usa somente as
// lojas/produtos/projeções/estoques que o PCP já carregou nesta sessão.
// Regra conservadora: uma loja de origem só pode ceder o estoque físico
// DISPONÍVEL que estiver acima do maior entre estoque-alvo, segurança e
// mínimo. Entrada futura/produção futura nunca contam como saldo transferível.
function _alocarTransferencias(visoesPorLoja,ehInterno){
  const sugestoes=[];
  const porProduto=new Map();
  (visoesPorLoja||[]).forEach(l=>{
    (l.itens||[]).forEach(item=>{
      const key=String(item.key||'');if(!key)return;
      const arr=porProduto.get(key)||[];arr.push({lojaId:String(l.lojaId||''),lojaNome:l.lojaNome||l.lojaId||'',item});porProduto.set(key,arr);
    });
  });
  porProduto.forEach((linhas,key)=>{
    if(ehInterno?.(key))return; // esta fase atua na necessidade de COMPRA
    const destinos=linhas.filter(x=>n(x.item.necessidade)>0).sort((a,b)=>n(b.item.necessidade)-n(a.item.necessidade));
    const fontes=linhas.map(x=>{
      const reserva=Math.max(n(x.item.estoqueAlvo),n(x.item.estoqueSeguranca),n(x.item.estoqueMinimo));
      // Sem qualquer parâmetro/demanda não é seguro concluir que o saldo é sobra.
      const baseConhecida=reserva>0||n(x.item.consumoDia)>0;
      const transferivel=baseConhecida?Math.max(0,n(x.item.estoqueDisponivel)-reserva):0;
      return {...x,reserva,transferivel};
    }).filter(x=>x.transferivel>0).sort((a,b)=>b.transferivel-a.transferivel);
    destinos.forEach(dest=>{
      let restante=Math.max(0,n(dest.item.necessidade));
      for(const fonte of fontes){
        if(restante<=0)break;
        if(fonte.lojaId===dest.lojaId||fonte.transferivel<=0)continue;
        const quantidade=Math.min(restante,fonte.transferivel);
        if(quantidade<=0)continue;
        fonte.transferivel-=quantidade;restante-=quantidade;
        sugestoes.push({
          key,produto:dest.item.produto||fonte.item.produto||key,
          origemLojaId:fonte.lojaId,origemLojaNome:fonte.lojaNome,
          destinoLojaId:dest.lojaId,destinoLojaNome:dest.lojaNome,
          quantidade,necessidadeDestino:n(dest.item.necessidade),necessidadeRestante:Math.max(0,restante),
          estoqueDisponivelOrigem:n(fonte.item.estoqueDisponivel),reservaOrigem:fonte.reserva,
          // PEDIDO AO VIVO (2026-10-01): item.coberturaDias vem floorado em
          // 0 (construirVisao) — recalcula sem o piso aqui só pro texto
          // mostrado na tabela de transferências sugeridas.
          coberturaOrigem:fonte.item.consumoDia>0?fonte.item.estoqueDisponivel/fonte.item.consumoDia:null,coberturaDestino:dest.item.consumoDia>0?dest.item.estoqueDisponivel/dest.item.consumoDia:null,
          dataAcao:global._pcpTimelineInternals?.calcularRiscoTemporal?.(dest.item)?.pontoPedidoEm||''
        });
      }
    });
  });
  return sugestoes;
}
function calcularSugestoesTransferencia(){
  if(!lojas.length)return [];
  const visoes=[];
  lojas.forEach(loja=>{
    const id=String(loja.id||'');
    const filtra=a=>(a||[]).filter(x=>String(x.lojaId||x.origemLojaId||'')===id);
    // Se o BI foi carregado, reaproveita as linhas cruas em memória para obter
    // o estoque físico da loja, sem ler arquivo/Firebase novamente. O consumo,
    // porém, continua vindo da projeção específica da loja já carregada.
    const mapaBi=_estoqueBiRaw?_juntarEstoqueBi(_estoqueBiRaw,_escadinhaBiRaw,null,_codsValidosBi,loja):null;
    const itens=filtrarProdutosPlanejaveis(construirVisao({produtos:filtra(produtos),projecao:filtra(projecao),pedidos:filtra(pedidos),ops:filtra(ops),agendamentos:filtra(agend),requisicoes:filtra(reqs),estoqueBi:(mapaBi&&mapaBi.size)?mapaBi:null,usarConsumoBi:false}));
    visoes.push({lojaId:id,lojaNome:loja.nome||loja.codigo||id,itens});
  });
  return _alocarTransferencias(visoes,produzidoInternamente);
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
function _juntarInsumosBi(dadosInsumos,mesIndice,lojaFiltro){
  if(mesIndice==null)mesIndice=new Date().getMonth();
  const hoje=new Date(),diasNoMes=new Date(hoje.getFullYear(),mesIndice+1,0).getDate(),porSku=new Map(),filtro=norm(lojaFiltro||'');
  const linhas=Array.isArray(dadosInsumos)?dadosInsumos:(dadosInsumos?.produtos||dadosInsumos?.dados||dadosInsumos?.linhas||[]);
  const numero=(...valores)=>{for(const v of valores){if(v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v)))return Number(v);}return 0;};
  linhas.forEach(it=>{
    const lojaValor=String(it.lojaId??it.loja_id??it.loja??it.filial??it.nomeLoja??it.lojaNome??'').trim();if(filtro&&norm(lojaValor)!==filtro)return;
    const sku=String(it.sku??it.produto_key??it.produtoKey??it.cod??it.codigo??'').trim();if(!sku)return;
    const produto=it.produto||it.descricao||it.nome||sku,tipo=it.tipo||it.tipoProduto||'',categoria=it.categoria||it.classificacao||'';
    const classificacao=norm(tipo+' '+categoria);
    // dados-insumos deve conter somente materiais. Ainda assim, se a fonte
    // vier contaminada com uma linha explicitamente marcada como produto
    // acabado, ela não entra nesta tela.
    if(/produto\s*acabado/.test(classificacao))return;
    const acc=porSku.get(sku)||{sku,produto,tipo,categoria,fornecedor:it.fornecedor||it.fornecedorNome||'',unidade:it.unidade||it.um||'',estoque:0,projecaoBom:0};
    let estoqueLinha=numero(it.estoque,it.quantidade_estoque,it.quantidadeEstoque,it.estoqueAtual);
    // Alguns layouts do dados-insumos trazem o saldo disponível preenchido
    // mesmo quando a coluna `estoque` vem zerada/vazia. Não esconder esse
    // material: usa saldo positivo como fallback de disponibilidade.
    const saldoLinha=numero(it.saldo,it.saldoAtual,it.saldo_disponivel,it.disponivel);
    if(!(estoqueLinha>0)&&saldoLinha>0)estoqueLinha=saldoLinha;
    const consumoLinha=numero(it.projecaoBom,it.projecao_bom,it.consumoProjetado,it.consumoMensal);
    acc.estoque+=estoqueLinha;acc.projecaoBom+=Math.max(0,consumoLinha);
    if(String(produto).length>String(acc.produto||'').length)acc.produto=produto;if(!acc.tipo&&tipo)acc.tipo=tipo;if(!acc.categoria&&categoria)acc.categoria=categoria;if(!acc.fornecedor&&(it.fornecedor||it.fornecedorNome))acc.fornecedor=it.fornecedor||it.fornecedorNome;if(!acc.unidade&&(it.unidade||it.um))acc.unidade=it.unidade||it.um;porSku.set(sku,acc);
  });
  const out=[];porSku.forEach(acc=>{
    // PEDIDO AO VIVO (2026-09-20): "não traz o saldo de todos os insumos" —
    // dados-insumos.json às vezes vem com a coluna de estoque zerada/vazia
    // pra um material que TEM saldo real (mesmo tendo consumo > 0 nesse
    // mesmo arquivo). produtos_estoque.json (mesmo BI que alimenta
    // Planejamento/Estoque X Pedidos, já carregado em _estoqueBi por
    // código, pra TODOS os produtos cadastrados, não só produto acabado)
    // é a fonte mais completa — usa como saldo de reserva só quando o
    // dados-insumos não trouxe nada, nunca sobrescreve um valor real.
    let estoque=acc.estoque;
    if(!(estoque>0)){const doEstoqueBi=_estoqueBi?.get?.(acc.sku);if(doEstoqueBi&&doEstoqueBi.estoque>0)estoque=doEstoqueBi.estoque;}
    if(!(estoque>0||acc.projecaoBom>0))return;
    const consumoMensal=Math.max(0,acc.projecaoBom),consumoDia=consumoMensal>0?consumoMensal/diasNoMes:0,estoqueAlvo=consumoDia*META_COBERTURA_INSUMO_DIAS,texto=norm(acc.tipo+' '+acc.categoria+' '+acc.produto),materiaPrima=/mat.?\s*prima|materia.?\s*prima|ingrediente|(^|\s)mp(\s|$)/.test(texto);
    out.push({cod:acc.sku,produto:acc.produto,tipo:acc.tipo,categoria:acc.categoria,grupo:materiaPrima?'materia-prima':'insumo',fornecedor:acc.fornecedor,unidade:acc.unidade,estoque,consumoMensal,consumoDia,coberturaDias:consumoDia>0?estoque/consumoDia:null,diasAlvo:META_COBERTURA_INSUMO_DIAS,estoqueAlvo,necessidade:Math.max(0,estoqueAlvo-estoque)});
  });
  return out.sort((a,b)=>(b.necessidade-a.necessidade)||((a.coberturaDias??999999)-(b.coberturaDias??999999)));
}
async function buscarInsumosBi(){
  if(!global.DTBiPastaLocal?.suportado?.())return;
  const status=await global.DTBiPastaLocal.status();
  if(status!=='conectado'){const r=await global.DTBiPastaLocal.conectar();if(!r.ok){global.showToast?.(r.erro,'error');return;}}
  try{
    const dadosInsumos=await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_INSUMOS);
    _insumosBiRaw=dadosInsumos;
    _insumosBi=_juntarInsumosBi(dadosInsumos,null,filtrosInsumos.loja);
    _ultimaBuscaInsumosBi=`Última atualização: ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} — ${_insumosBi.length} insumo(s) com estoque ou necessidade.`;
    desenhar();
  }catch(e){
    _ultimaBuscaInsumosBi=`Falha na última busca: ${e.message||e}`;
    global.showToast?.('Erro ao buscar insumos no BI: '+(e.message||e),'error');
    desenhar();
  }
}
function _consolidarItensPorLoja(key,itens){
  const xs=(itens||[]).filter(Boolean);if(!xs.length)return null;
  const soma=campo=>xs.reduce((a,x)=>a+n(x?.[campo]),0);
  const consumo=soma('consumoDia'),disponivel=soma('estoqueDisponivel'),saldo=soma('saldo');
  const pesos=xs.map(x=>Math.max(0,n(x.consumoDia))),pesoTotal=pesos.reduce((a,b)=>a+b,0);
  const mediaPonderada=campo=>pesoTotal>0?xs.reduce((a,x,i)=>a+n(x?.[campo])*pesos[i],0)/pesoTotal:Math.max(...xs.map(x=>n(x?.[campo])));
  const eventos=[];xs.forEach(x=>(x.eventos||[]).forEach(ev=>eventos.push({...ev,lojaId:x.lojaId||'',lojaNome:x.lojaNome||''})));eventos.sort((a,b)=>String(a.data||'').localeCompare(String(b.data||'')));
  const rupturas=xs.map(x=>x.rupturaEm).filter(Boolean).sort();
  const alertas=[];xs.forEach(x=>(x.alertasCalculo||[]).forEach(a=>alertas.push({...a,lojaId:x.lojaId||'',lojaNome:x.lojaNome||''})));
  const primeiro=xs[0];
  return {...primeiro,key,lojaId:'',lojaNome:'Todas as lojas',_consolidadoLojas:true,_lojasDetalhe:xs,
    estoqueAtual:soma('estoqueAtual'),estoqueComprometido:soma('estoqueComprometido'),estoqueDisponivel:disponivel,
    estoqueMinimo:soma('estoqueMinimo'),estoqueAlvo:soma('estoqueAlvo'),pedidos:soma('pedidos'),atendida:soma('atendida'),pendente:soma('pendente'),
    producaoProgramada:soma('producaoProgramada'),comprasProgramadas:soma('comprasProgramadas'),entradasPrevistas:soma('entradasPrevistas'),saldo,
    necessidade:soma('necessidade'),quantidadeSugerida:soma('quantidadeSugerida'),excesso:soma('excesso'),consumoDia:consumo,consumoMensal:soma('consumoMensal'),previsaoMensal:soma('previsaoMensal'),
    estoqueSeguranca:soma('estoqueSeguranca'),estoqueSegurancaConfigurado:soma('estoqueSegurancaConfigurado'),pontoPedido:soma('pontoPedido'),
    coberturaDias:consumo>0?Math.max(0,disponivel)/consumo:null,coberturaProjetadaDias:consumo>0?Math.max(0,saldo)/consumo:null,
    diasAlvo:mediaPonderada('diasAlvo'),leadTimeDias:Math.max(...xs.map(x=>n(x.leadTimeDias))),leadTimeFonte:'consolidado_lojas',leadTimeRotulo:'Consolidado por loja (maior prazo para risco)',leadTimeAmostras:soma('leadTimeAmostras'),
    demandaHistoricaDia:xs.every(x=>x.demandaHistoricaDia!=null)?soma('demandaHistoricaDia'):null,previsaoFuturaDia:xs.every(x=>x.previsaoFuturaDia!=null)?soma('previsaoFuturaDia'):null,
    eventos,proximoEvento:eventos[0]||null,rupturaEm:rupturas[0]||null,piorSaldo:Math.min(...xs.map(x=>n(x.piorSaldo))),alertasCalculo:alertas,
  };
}
function _filtrarPorLoja(arr,loja){return (arr||[]).filter(x=>String(x.lojaId||x.origemLojaId||'')===String(loja));}
function construirVisao({produtos:pp=produtos,projecao:pj=projecao,pedidos:pd=pedidos,ops:oo=ops,agendamentos:aa=agend,requisicoes:rr=reqs,estoqueBi=null,usarConsumoBi=true,lojaContexto='',_semConsolidar=false}={}){
  // Contrato de loja: informar `lojaContexto` significa calcular TUDO para
  // aquela unidade (cadastro, pedidos, OPs, entradas, requisicoes e estoque
  // BI), não apenas escolher os parametros daquela loja.
  if(lojaContexto&&!_semConsolidar){
    pp=_filtrarPorLoja(pp,lojaContexto);pj=_filtrarPorLoja(pj,lojaContexto);pd=_filtrarPorLoja(pd,lojaContexto);oo=_filtrarPorLoja(oo,lojaContexto);aa=_filtrarPorLoja(aa,lojaContexto);rr=_filtrarPorLoja(rr,lojaContexto);
    if(estoqueBi&&_estoqueBiRaw&&_escadinhaBiRaw){const lf=lojas.find(l=>String(l.id)===String(lojaContexto))||lojaContexto;estoqueBi=_juntarEstoqueBi(_estoqueBiRaw,_escadinhaBiRaw,null,_codsValidosBi,lf);}
  }
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
    if(!_semConsolidar&&!lojaContexto){
      const lojasChave=[...new Set((pp||[]).filter(x=>keyOf(x)===k).map(x=>String(x.lojaId||'')).filter(Boolean))];
      if(lojasChave.length>1){
        const itensLoja=[];
        for(const lid of lojasChave){
          let estoqueLoja=null;
          if(estoqueBi&&_estoqueBiRaw&&_escadinhaBiRaw){const lf=lojas.find(l=>String(l.id)===lid)||lid;estoqueLoja=_juntarEstoqueBi(_estoqueBiRaw,_escadinhaBiRaw,null,_codsValidosBi,lf);}
          const parcial=construirVisao({produtos:_filtrarPorLoja(pp,lid),projecao:_filtrarPorLoja(pj,lid),pedidos:_filtrarPorLoja(pd,lid),ops:_filtrarPorLoja(oo,lid),agendamentos:_filtrarPorLoja(aa,lid),requisicoes:_filtrarPorLoja(rr,lid),estoqueBi:estoqueLoja,usarConsumoBi,lojaContexto:lid,_semConsolidar:true}).find(x=>x.key===k);
          if(parcial)itensLoja.push({...parcial,lojaId:lid,lojaNome:(lojas.find(l=>String(l.id)===lid)?.nome)||lid});
        }
        const consolidado=_consolidarItensPorLoja(k,itensLoja);if(consolidado){out.push(consolidado);continue;}
      }
    }
    const prod=resolverCadastroProduto(k,{lista:pp,lojaId:lojaContexto}), pr=(pj||[]).find(x=>keyOf(x)===k)||{}, calc=pcalc.get(k)||{};
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
    const comprasProg=(rr||[]).filter(x=>keyOf(x)===k&&!/cancel|rejeit|finaliz/i.test(String(x.status||''))).reduce((s,x)=>s+Math.max(0,n(x.quantidade)-n(x.quantidadeComprada)),0);
    // Motor único do PCP. IMPORTANTE: não faz leitura nenhuma — recebe apenas
    // os dados que esta tela já carregou. Quando a fonte é BI, preserva o
    // consumo diário da Escadinha via override; quando não é BI, usa o
    // histórico/previsão já carregados do Firestore como antes.
    // metaCoberturaDias=0 significa "sem meta própria" no cadastro; remove o
    // zero antes do motor para ele aplicar o padrão configurado (30d hoje).
    const motorProduct={...prod};
    if(!(n(motorProduct.metaCoberturaDias)>0))delete motorProduct.metaCoberturaDias;
    if(!(n(motorProduct.coberturaMetaDias)>0))delete motorProduct.coberturaMetaDias;
    const lojasContexto=[...new Set((pp||[]).map(x=>String(x.lojaId||'')).filter(Boolean))],lojaLead=String(lojaContexto||filtros.loja||(lojasContexto.length===1?lojasContexto[0]:'')||'');
    const leadTimeInfo=resolverLeadTimeProduto(k,{produto:prod,agendamentos:aa,requisicoes:rr,lojaId:lojaLead});
    motorProduct.leadTimeDias=leadTimeInfo.dias;
    const motor=global.PCPDemandEngine?.calculate?.({product:motorProduct,forecast:{...pr,...calc},operational:{availableStock:estoque,inbound:entradas,production:prodProg,committedDemand:comprometido,dailyDemandOverride:(bi&&usarConsumoBi)?bi.consumoDia:null},parameters:global.PCP_DEMANDA_PARAMETROS||{}})||null;
    // Com estoqueBi, o consumo diário vem do `plano` do dados-escadinha.json
    // (ver _juntarEstoqueBi) — não do motor de demanda nem da projeção do
    // Firestore, que são a fonte antiga que esta troca substitui nessas 2
    // abas.
    const consumoDia=(bi&&usarConsumoBi)?bi.consumoDia:(motor?.dailyDemand??((n(calc.projFinal??calc.projSemanal)||(n(pr.venda_m1)*.5+n(pr.venda_m2)*.3+n(pr.venda_m3)*.2)/4.33)/7)), estoqueMin=n(prod.estoqueMinimo??pr.estoqueMinimo);
    // PEDIDO AO VIVO (2026-09-07): "não quero consumo dia... quero consumo
    // mesmo, a média dos 3 últimos meses" — igual ao consumoDia acima, só
    // que em base mensal; produto sem BI usa a mesma média de venda_m1/m2/m3
    // já calculada em `calc`/`pr` (ponderada 50/30/20), sem reinventar fonte.
    const consumoMensal=(bi&&usarConsumoBi)?bi.consumoMensal:(n(calc.projFinal??calc.projSemanal)||(n(pr.venda_m1)*.5+n(pr.venda_m2)*.3+n(pr.venda_m3)*.2));
    // Sem BI, usa a mesma previsão futura (50/30/20) já calculada no motor
    // de demanda (pr.previsao_m1/m2/m3, escrita por 66-producao-projecao.js
    // na mesma coleção producao_projecao).
    const previsaoMensal=(bi&&usarConsumoBi)?bi.previsaoMensal:(n(pr.previsao_m1)*.5+n(pr.previsao_m2)*.3+n(pr.previsao_m3)*.2);
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
    const diasAlvo=temMetaConfigurada?Math.max(0,n(metaConfigurada)):(motor?.targetDays??META_COBERTURA_PRODUTO_DIAS), estoqueAlvo=motor?.targetStock??Math.max(estoqueMin,consumoDia*diasAlvo);
    // A quantidade sugerida agora passa sempre pelo mesmo motor (inclusive BI),
    // respeitando segurança, lote mínimo, múltiplo e máximo sem novas leituras.
    const necessidade=motor?.suggestedQuantity??Math.max(0,estoqueAlvo+comprometido-estoque-prodProg-entradas);
    const cobertura=motor?.coverageDays??(consumoDia>0?Math.max(0,disponivel)/consumoDia:null), coberturaProj=motor?.projectedCoverageDays??(consumoDia>0?Math.max(0,saldo)/consumoDia:null);
    const eventos=[];
    peds.forEach(x=>{const q=Math.max(0,n(x.quantidade)-n(x.quantidadeAtendida));if(q>0)eventos.push({data:x.dataNecessaria||'',tipo:'pedido',descricao:'Pedido '+(x.pedido||x.destino||''),delta:-q});});
    (oo||[]).filter(x=>keyOf(x)===k&&!/conclu|cancel/i.test(String(x.status||''))).forEach(x=>{const q=Math.max(0,n(x.qntCaixas)-n(x.realizadoCaixas));if(q>0)eventos.push({data:x.data||'',tipo:'producao',descricao:'Produção '+(x.maquina||''),delta:q});});
    (aa||[]).filter(x=>keyOf(x)===k&&!/cancel|finaliz/i.test(String(x.status||''))).forEach(x=>{const q=Math.max(0,n(x.quantidade)-n(x.quantidadeRecebida));if(q>0)eventos.push({data:x.dataPrevista||'',tipo:'entrada',descricao:'Entrega '+(x.fornecedor||x.numeroCompra||''),delta:q});});
    const ordemTipo={entrada:0,producao:1,pedido:2};eventos.sort((a,b)=>String(a.data).localeCompare(String(b.data))+(ordemTipo[a.tipo]-ordemTipo[b.tipo]));
    let saldoLinha=estoque,ruptura=null,piorSaldo=estoque;for(const ev of eventos){saldoLinha+=ev.delta;ev.saldoApos=saldoLinha;ev.coberturaApos=consumoDia>0?Math.max(0,saldoLinha)/consumoDia:null;piorSaldo=Math.min(piorSaldo,saldoLinha);if(!ruptura&&saldoLinha<0)ruptura=ev.data||'sem data';}
    const prox=eventos[0]||null;
    out.push({key:k,cod,produto:nome,fonteEstoque:bi?'bi':'interno',timelineSaldoInicial:bi?disponivel:estoque,estoqueAtual:estoque,estoqueComprometido:comprometido,estoqueDisponivel:disponivel,estoqueMinimo:estoqueMin,estoqueAlvo,diasAlvo,pedidos:qtdPedidos,atendida,pendente:comprometido,producaoProgramada:prodProg,comprasProgramadas:comprasProg,entradasPrevistas:entradas,saldo,necessidade,excesso:Math.max(0,saldo-estoqueAlvo),consumoDia,coberturaDias:cobertura,coberturaProjetadaDias:coberturaProj,eventos,proximoEvento:prox,rupturaEm:ruptura,piorSaldo,estoqueSeguranca:motor?.safetyStock??n(prod.estoqueSeguranca),estoqueSegurancaConfigurado:n(prod.estoqueSeguranca),pontoPedido:motor?.reorderPoint??0,leadTimeDias:motor?.leadTime??leadTimeInfo.dias,leadTimeFonte:leadTimeInfo.fonte,leadTimeRotulo:leadTimeInfo.rotulo,leadTimeAmostras:leadTimeInfo.amostras,demandaHistoricaDia:motor?.historicalDailyDemand??null,previsaoFuturaDia:motor?.forecastDailyDemand??null,consumoMensal,previsaoMensal,quantidadeSugerida:motor?.suggestedQuantity??necessidade,alertasCalculo:motor?.alerts||[],memoriaDemanda:motor?.memory||null,planoEscadinha:bi?.plano||null});
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
// PEDIDO AO VIVO (2026-09-25): "não dá pra deixar só um botão, com o nome
// Buscar?" — Planejamento tinha 2 botões (↻ Atualizar só recarregava o
// Firestore; 📊 Atualizar BI buscava o estoque à parte) e a pessoa
// precisava saber clicar nos dois pra ver o número certo — foi exatamente
// essa confusão que atrasou achar que o estoque duplicado era só aba
// antiga em cache. Agora 1 botão só faz as 3 coisas em sequência: sincroniza
// o SharePoint no servidor (sincronizarBiAgendadoAgora), recarrega o
// Firestore (carregar) e, nas abas que mostram estoque (planejamento/
// produção), busca o estoque fresco (buscarEstoqueBi) — só então redesenha.
async function pcpAtualizarComSync(btn){
  const original=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='⏳ Buscando...';}
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
  try{
    await carregar(true);
    if((aba==='planejamento'||aba==='producao')&&global.DTBiPastaLocal?.suportado?.())await buscarEstoqueBi();
    desenhar();
  }
  finally{if(btn){btn.disabled=false;btn.innerHTML=original||'🔄 Buscar';}}
}
async function carregar(forcar=false){
  if(carregado&&!forcar)return;
  if(_carregamentoPcpPendente)return _carregamentoPcpPendente;
  _carregamentoPcpPendente=(async()=>{
    const vazio={docs:[]},lojasSnap=await raw().collection('lojas').get();
    lojas=lojasSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.ativa!==false);
    const colecoes=[CPED,CREQ,CAGE,CPROD,CPRODAPI,CPROJ,CESTAPI,COP,CREGR];
    const tudo={};colecoes.forEach(c=>tudo[c]=[]);
    if(lojas.length){
      // Cada loja é independente: consultar em paralelo reduz a latência total
      // sem mudar coleções, filtros ou ordem final de mescla.
      const resultadosPorLoja=await Promise.all(lojas.map(async loja=>{
        const base=raw().collection('lojas').doc(loja.id);
        const snaps=await Promise.all(colecoes.map(c=>base.collection(c).get().catch(()=>vazio)));
        return {loja,snaps};
      }));
      resultadosPorLoja.forEach(({loja,snaps})=>snaps.forEach((snap,i)=>snap.docs.forEach(d=>tudo[colecoes[i]].push({_id:d.id,lojaId:loja.id,lojaNome:loja.nome||loja.codigo||loja.id,...d.data()}))));
    }
    else {const lojaId=global.getDTLojaAtiva?.()||'';const snaps=await Promise.all(colecoes.map(c=>fs().collection(c).get().catch(()=>vazio)));snaps.forEach((snap,i)=>snap.docs.forEach(d=>tudo[colecoes[i]].push({_id:d.id,lojaId,...d.data()})));if(lojaId)lojas=[{id:lojaId,nome:'Loja ativa'}];}
    pedidos=tudo[CPED];reqs=tudo[CREQ].filter(x=>String(x.origem||'').toUpperCase()!=='COMPRAS_COTACAO');agend=tudo[CAGE];ops=tudo[COP];regrasCompradores=tudo[CREGR];
    const usuariosSnap=await raw().collection('usuarios_acessos').get().catch(()=>vazio);
    usuariosCompras=usuariosSnap.docs.map(d=>({uid:d.id,...d.data()})).filter(u=>u.ativo!==false);
    const prodMap=new Map();[...tudo[CPRODAPI],...tudo[CPROD]].forEach(x=>{const k=(x.lojaId||'')+'|'+keyOf(x),atual=prodMap.get(k)||{};prodMap.set(k,{...atual,...x});});produtos=Array.from(prodMap.values());
    // PEDIDO AO VIVO (2026-09-21): busca aditiva do cadastro único global
    // (produtos_mestre) e da classificação real da Bluesoft
    // (bi_classificacao_produtos) — nenhuma das duas é por loja, por isso
    // fica fora do Promise.all por loja acima. Sem impacto se ainda
    // estiverem vazias (migração/sync ainda não rodou pra esse ambiente).
    const [mestreSnap,biClassSnap]=await Promise.all([raw().collection(CPRODMESTRE).get().catch(()=>vazio),raw().collection(CBICLASS).get().catch(()=>vazio)]);
    _produtosMestre=new Map(mestreSnap.docs.map(d=>[String(d.id),d.data()]));
    _biClassificacao=new Map(biClassSnap.docs.map(d=>d.data()).filter(x=>x&&x.produtoKey).map(x=>[String(x.produtoKey),x]));
    // Catálogo mestre de fornecedores é carregado uma vez junto com o PCP para
    // que resolverLeadTimeProduto continue síncrono durante construirVisao().
    // Se o serviço não estiver disponível, os mapas ficam vazios e o motor cai
    // de forma segura para histórico/fallback sem quebrar a tela.
    const svcF=global._fornecedoresService;
    const [vinculosF,fornecedoresF]=await Promise.all([
      svcF?.listarVinculosHomologados?.().catch(()=>[])||Promise.resolve([]),
      svcF?.listar?.({limit:100000}).catch(()=>[])||Promise.resolve([])
    ]);
    _fornecedorVinculosPorProduto=new Map();
    (vinculosF||[]).forEach(v=>{const pid=String(v.produtoId||'').trim();if(!pid)return;const arr=_fornecedorVinculosPorProduto.get(pid)||[];arr.push(v);_fornecedorVinculosPorProduto.set(pid,arr);});
    _fornecedoresPorId=new Map((fornecedoresF||[]).map(f=>[String(f.fornecedorId||''),f]).filter(x=>x[0]));
    const projMap=new Map();[...tudo[CESTAPI],...tudo[CPROJ]].forEach(x=>{const k=(x.lojaId||'')+'|'+keyOf(x),atual=projMap.get(k)||{};projMap.set(k,{...atual,...x});});projecao=Array.from(projMap.values());
    const lojaId=global.getDTLojaAtiva?.()||'',d=lojaId?await raw().collection(CPRODREQ).where('origemLojaId','==',lojaId).get().catch(()=>vazio):vazio;solProd=d.docs.map(x=>({_id:x.id,...x.data()}));invalidarVisao();carregado=true;
  })();
  try{return await _carregamentoPcpPendente;}finally{_carregamentoPcpPendente=null;}
}

// Consolida produtos/projeção por chave ANTES de chegar em construirVisao(),
// ignorando qualquer filtro de loja. Extraído de dadosFiltrados() pra poder
// ser chamado por telas que NUNCA devem herdar o filtro de loja que sobrou
// de outra aba (Dashboard, Timeline, Alertas) — ver correção de desempenho
// abaixo. Sem essa deduplicação prévia, construirVisao() recebe produto
// repetido por loja e cai no pior caso (recalcula a visão inteira, loja por
// loja, pra cada produto presente em mais de uma loja — medido em ~293s com
// o catálogo real de produção, contra ~2s já deduplicado).
function _dadosConsolidadosTodasLojas(){
  const chaves=new Set(produtos.map(keyOf).filter(Boolean)),pm=new Map();chaves.forEach(k=>pm.set(k,resolverCadastroProduto(k,{lista:produtos})));
  const em=new Map();projecao.forEach(x=>{const k=keyOf(x),a=em.get(k)||{cod:x.cod,produto:x.produto};const soma=['estoqueAtual','estoqueAtualUnidades','estoqueReservadoVenda','estoqueReservado','estoqueEmTransito'];soma.forEach(c=>a[c]=n(a[c])+n(x[c]));['fatorCaixa','unidadeExibicao','consumoDiaMedioBluesoft'].forEach(c=>{if(x[c]!=null)a[c]=x[c];});if(!a.produto||/^Produto\s+\d+$/i.test(a.produto))a.produto=x.produto;em.set(k,a);});
  return {produtos:Array.from(pm.values()),projecao:Array.from(em.values()),pedidos,ops,agendamentos:agend,requisicoes:reqs};
}
function dadosFiltrados(){
  const loja=filtros.loja,filtra=a=>loja?a.filter(x=>String(x.lojaId||x.origemLojaId||'')===loja):a;
  if(loja)return {produtos:filtra(produtos),projecao:filtra(projecao),pedidos:filtra(pedidos),ops:filtra(ops),agendamentos:filtra(agend),requisicoes:filtra(reqs)};
  return _dadosConsolidadosTodasLojas();
}
function metaProduto(item){const p=resolverCadastroProduto(item.key),nome=item.produto||p.nome||'',mestre=_produtosMestre.get(String(p.cod||item.key||'').trim());
  // PEDIDO AO VIVO (2026-09-21): categoria agora prefere, nessa ordem, o
  // cadastro único (produtos_mestre, quando a migração já rodou), depois a
  // classificação real da Bluesoft, só caindo pra primeira-palavra-do-nome
  // como último recurso. marcaPropria também passa a existir de verdade
  // (produtos_mestre) em vez de só o regex /DA TERRINHA/i no nome.
  return {p,nome,marcaPropria:mestre?.marcaPropria===true||p.marcaPropria===true||/DA TERRINHA/i.test(nome),categoria:mestre?.categoria||_categoriaDeBluesoft(p)||_categoriaDoNome(nome),tipo:mestre?.tipoProduto||p.bluesoftTipoProduto||p.tipoProduto||''};}
// PEDIDO AO VIVO (2026-09-18): "Estoque X Pedidos" (aba 'estoque') só
// produto acabado; "Insumos" (aba 'pedidos-estoque') só matéria-prima —
// antes as duas mostravam tudo junto misturado. Mesmo critério de
// produzidoInternamente() já usado em Produtos 360°/Compras (Fase 6a):
// tem empresaProdutoraId ou máquina cadastrada = fabricado aqui dentro.
// Regra estrutural única dos produtos que podem compor o Planejamento/Dashboard.
// Não aplica filtros de tela (busca, marca, loja, situação ou ação): remove apenas
// itens que não pertencem à visão de produto acabado/comercial. Assim Dashboard e
// Planejamento deixam de contar populações diferentes para os mesmos KPIs.
function filtrarProdutosPlanejaveis(visao){
  return (visao||[]).filter(x=>{
    const m=metaProduto(x);
    // O cadastro único é a fonte oficial de ativo/inativo. Aplicar aqui
    // garante a MESMA população em Planejamento, Dashboard, Alertas e Transferências.
    if(!_ativoNoCadastroUnico(m.p?.cod||x.cod,m.p?.ativo))return false;
    if(String(m.tipo||'').toUpperCase()==='CONSUMO')return false;
    if(CATEGORIAS_OCULTAS_PLANEJAMENTO.includes(norm(m.categoria)))return false;
    if(CODIGOS_UND_PLANEJAMENTO.has(String(x.cod||'')))return false;
    return true;
  });
}
// Regra única de criticidade usada por Planejamento e Dashboard.
// Mantê-la centralizada evita que o mesmo SKU seja crítico em uma tela e normal em outra.
function itemCriticoPlanejamento(item){
  if(!item)return false;
  const cobertura=item.coberturaProjetadaDias!=null?item.coberturaProjetadaDias:item.coberturaDias;
  const temDemanda=n(item.consumoDia)>0||n(item.necessidade)>0||n(item.estoqueComprometido)>0;
  // Estoque zero, sozinho, nao e criticidade: SKU sem giro/necessidade nao deve
  // aparecer como ruptura. A mesma regra ja e usada pela Central de Excecoes.
  if(n(item.estoqueDisponivel)<=0&&temDemanda)return true;
  if(!!item.rupturaEm)return true;
  if(cobertura!=null&&n(item.leadTimeDias)>0&&n(cobertura)<n(item.leadTimeDias))return true;
  return (item.alertasCalculo||[]).some(a=>String(a?.code||a?.tipo||'').toUpperCase().includes('COBERTURA_MENOR_LEADTIME'));
}
function visaoFiltrada(){
  let v=_visaoBaseMemo(true);
  if(aba==='planejamento'||aba==='estoque')v=filtrarProdutosPlanejaveis(v);
  const busca=norm(filtros.busca);
  return v.filter(x=>{
    const m=metaProduto(x),txt=norm((x.cod||'')+' '+m.nome);
    if(String(m.tipo||'').toUpperCase()==='CONSUMO')return false;
    // Rotas antigas continuam reconhecidas internamente, mas a navegação
    // nova usa Planejamento como visão única de produtos acabados/comerciais.
    if(aba==='estoque'&&!produzidoInternamente(x.key))return false;
    if(aba==='pedidos-estoque'&&produzidoInternamente(x.key))return false;
    if(busca&&!txt.includes(busca))return false;
    if(filtros.marca==='sim'&&!m.marcaPropria)return false;
    if(filtros.marca==='nao'&&m.marcaPropria)return false;
    if(filtros.categoria&&norm(m.categoria)!==norm(filtros.categoria))return false;
    if(filtros.situacao==='ruptura'&&!x.rupturaEm)return false;
    if(filtros.situacao==='estoque'&&x.estoqueAtual<=0)return false;
    if(filtros.situacao==='pedidos'&&x.pendente<=0)return false;
    if(filtros.ocultarZerados&&x.estoqueAtual<=0&&x.pendente<=0&&x.necessidade<=0)return false;
    const acao=_acaoPlanejamento(x);
    if(filtros.acao==='critico'){
      if(!itemCriticoPlanejamento(x))return false;
    }else if(filtros.acao&&acao.chave!==filtros.acao)return false;
    return true;
  }).map(x=>{const m=metaProduto(x);return {...x,produto:(!/^Produto\s+\d+$/i.test(m.nome)?m.nome:x.produto),_meta:m};});
}

function _primeiroNomePessoa(v){return norm(String(v||'').trim().split(/[.\s]+/)[0]);}
function _usuarioPorPrimeiroNome(nome){const primeiro=_primeiroNomePessoa(nome);if(!primeiro)return null;const encontrados=usuariosCompras.filter(u=>_primeiroNomePessoa(u.nome||u.name||u.email)===primeiro);return encontrados.length===1?encontrados[0]:null;}
function resolverComprador(produtoOuKey,regras=regrasCompradores,listaProdutos=produtos){
  const p=typeof produtoOuKey==='object'?produtoOuKey:(listaProdutos.find(x=>keyOf(x)===String(produtoOuKey)||String(x.cod||x.nome)===String(produtoOuKey))||{});
  const agendaRef=agend.find(a=>keyOf(a)===keyOf(p)&&String(a.bluesoftCompradorNome||a.compradorFonte||'').trim());
  const compradorFonte=p.comprador||p.compradorNome||p.bluesoftCompradorNome||p.comprador_nome||agendaRef?.bluesoftCompradorNome||agendaRef?.compradorFonte||'';
  // Regras configuradas são determinísticas e têm precedência sobre heurística
  // por primeiro nome. Isso evita encaminhar para a pessoa errada quando há
  // dois compradores com o mesmo primeiro nome.
  const fornecedorId=String(p.fornecedorPadraoId||p.fornecedorId||'').trim();
  if(fornecedorId){
    const porId=(regras||[]).find(x=>String(x.tipo||'')==='fornecedor'&&String(x.fornecedorId||'').trim()===fornecedorId&&x.ativo!==false);
    if(porId)return {compradorUid:porId.compradorUid||'',compradorEmail:porId.compradorEmail||'',compradorNome:porId.compradorNome||'',regraId:porId._id||'',regraTipo:'fornecedor_id',regraValor:fornecedorId};
  }
  const candidatos=[
    ['produto',String(p.cod||'')],['produto',String(p.nome||'')],
    ['categoria',String(p.categoria||'')],['categoria',String(p.classificacao||'')],
    ['fornecedor',String(p.fornecedorPadrao||p.fornecedor||'')]
  ].filter(x=>x[1]);
  for(const [tipo,valor] of candidatos){
    const r=(regras||[]).find(x=>String(x.tipo||'')===tipo&&norm(x.valor)===norm(valor)&&x.ativo!==false);
    if(r)return {compradorUid:r.compradorUid||'',compradorEmail:r.compradorEmail||'',compradorNome:r.compradorNome||'',regraId:r._id||'',regraTipo:tipo,regraValor:valor};
  }
  const usuarioAuto=_usuarioPorPrimeiroNome(compradorFonte);
  if(usuarioAuto)return {compradorUid:usuarioAuto.uid||usuarioAuto._id||'',compradorEmail:usuarioAuto.email||'',compradorNome:usuarioAuto.nome||usuarioAuto.name||usuarioAuto.email||'',regraId:'auto_primeiro_nome',regraTipo:'comprador_base',regraValor:compradorFonte};
  return {compradorUid:'',compradorEmail:'',compradorNome:'',regraId:'',regraTipo:'',regraValor:''};
}

// PEDIDO AO VIVO (2026-09-18): renomeação de telas do PCP — 'pedidos' vira
// a tela de CRIAR solicitação de compra ("Solicitação de Compra"; a lista
// dela é a antiga "Pedidos"); 'estoque' passa a mostrar só produto acabado
// ("Estoque X Pedidos"); 'pedidos-estoque' passa a mostrar só matéria-
// prima/insumo comprado ("Insumos" — nome novo, sem colisão real: o
// 'insumos' desta lista é órfão, nenhum nav-item chama pcpIrParaAba com
// esse valor, só 'producao-insumo', que é uma página externa separada);
// 'agendamentos' (pedidos de compra JÁ confirmados/sincronizados) vira
// "Pedidos" — nome que sobrou livre de 'pedidos' ter mudado.
const ABAS=[['pedidos','Solicitação de Compra'],['planejamento','Planejamento'],['insumos','Insumos'],['agendamentos','Pedidos'],['producao','Programação Produção']];
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
function pcpIrParaAba(nome,el,opcoes){
  if(typeof global.temPermissao==='function'&&!global.temPermissao('pcp-central','visualizar')){global.showToast?.('Você não possui acesso a esta aba.','error');return;}
  // Compatibilidade: URLs/chamadas antigas não somem, mas apontam para a
  // visão consolidada em vez de manter cinco telas com a mesma informação.
  const legado={estoque:'planejamento','pedidos-estoque':'planejamento',compras:'planejamento',alertas:'planejamento','producao-insumo':'insumos'};
  nome=legado[nome]||nome;
  if(nome==='planejamento'&&opcoes&&typeof opcoes==='object'){filtros={...filtros,...opcoes};}
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));
  if(el)el.classList.add('on');
  const externa=_paginasExternas[nome];
  if(externa){
    const pageEl=document.getElementById(externa.elId);if(pageEl)pageEl.classList.add('on');
    const tituloEl=document.getElementById('page-title');if(tituloEl)tituloEl.textContent='PCP · '+externa.titulo;
    const fn=global[externa.render];if(typeof fn==='function')fn();return;
  }
  const pageEl=document.getElementById('page-pcp-central');if(pageEl)pageEl.classList.add('on');
  const tituloEl=document.getElementById('page-title');if(tituloEl)tituloEl.textContent='PCP · '+(ABAS.find(x=>x[0]===nome)?.[1]||nome);
  aba=nome;
  if(nome==='insumos'&&!_insumosBi&&global.DTBiPastaLocal?.suportado?.()){
    buscarInsumosBi().catch(()=>{});
    // Sem isso, o saldo de reserva de _juntarInsumosBi (ver comentário lá)
    // fica sem dado nenhum quando a pessoa abre Insumos direto, sem nunca
    // ter passado pelo Planejamento antes (só ali que _estoqueBi carrega).
    // _insumosBi já pode ter ficado pronto (acima) ANTES de _estoqueBi
    // responder — por isso recalcula de novo na volta, com o saldo de
    // reserva agora disponível, em vez de deixar a tela presa no 1º cálculo.
    if(!_estoqueBi)buscarEstoqueBi().then(()=>{if(_insumosBiRaw){_insumosBi=_juntarInsumosBi(_insumosBiRaw,null,filtrosInsumos.loja);if(aba==='insumos')desenhar();}}).catch(()=>{});
  }
  if(!carregado)render();else desenhar();
}
function _produtosComprados(){return produtos.filter(x=>_ativoNoCadastroUnico(x.cod,x.ativo)&&!produzidoInternamente(keyOf(x))).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));}
function produtoOpts(sel='',somenteCompra=false){const lista=(somenteCompra?_produtosComprados():produtos.filter(x=>_ativoNoCadastroUnico(x.cod,x.ativo)));return `<option value="">Selecione...</option>${lista.sort((a,b)=>String(a.nome).localeCompare(String(b.nome),'pt-BR')).map(x=>`<option value="${esc(x.cod||x.nome)}" ${String(sel)===String(x.cod||x.nome)?'selected':''}>${esc(x.cod?x.cod+' — ':'')}${esc(x.nome)}</option>`).join('')}`;}
function produtoInputCompraHtml(id){const lista=_produtosComprados();return `<input class="field" id="${id}" list="${id}-lista" placeholder="Digite o nome ou código do produto"><datalist id="${id}-lista">${lista.map(x=>`<option value="${esc(x.cod?x.cod+' — '+x.nome:x.nome)}"></option>`).join('')}</datalist>`;}
function produtoByValue(v){const rawV=String(v||'').trim(),cod=rawV.split(' — ')[0].trim();const porCod=produtos.filter(x=>String(x.cod||'')===cod);if(porCod.length)return resolverCadastroProduto(keyOf(porCod[0])||cod);const porNome=produtos.filter(x=>norm(x.nome)===norm(rawV));const chaves=[...new Set(porNome.map(keyOf).filter(Boolean))];return chaves.length===1?resolverCadastroProduto(chaves[0]):{};}
function _reqTotalComprado(x){return global.DTPCPSolicitacoesWorkflow?.totalComprado?.(x)??n(x.quantidadeComprada);}
function _reqMinha(x){const uid=global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'',email=String(global._currentAnalistaUser?.email||'').toLowerCase();return (!!uid&&String(x.pcpUid||'')===String(uid))||!!(email&&[x.pcpResponsavel,x.criadoPor].some(v=>String(v||'').toLowerCase()===email));}
function _reqMesAtual(x){const ym=new Date().toISOString().slice(0,7);return String(x.dataNecessaria||x.criadoEm||'').slice(0,7)===ym;}
function _reqEncerrada(x){return /final|cancel|rejeit/i.test(String(x.status||''));}
function _reqAlteracaoLabel(x){const p=x.pcpAlteracaoPendente;if(p?.status==='pendente')return `<span class="badge b-orange">PCP: ${esc(p.tipo)}</span>`;const r=x.pcpUltimoRetornoCompras;if(r?.respondidoEm)return `<span class="badge ${r.aceita?'b-green':'b-red'}">${r.aceita?'Alteração aceita':'Alteração recusada'}</span>`;return '—';}
function _reqHistoricoTexto(ev){const nomes={criada_pcp:'Solicitação criada pelo PCP',cancelada_pcp:'Cancelada pelo PCP',cancelamento_solicitado:'Cancelamento solicitado ao Compras',postergada_pcp:'Data necessária postergada pelo PCP',postergacao_solicitada:'Postergação solicitada ao Compras',quantidade_alterada_pcp:'Quantidade alterada pelo PCP',quantidade_alteracao_solicitada:'Alteração de quantidade solicitada ao Compras',alteracao_pcp_recusada:'Compras não confirmou a alteração',cancelamento_confirmado_compras:'Compras confirmou o cancelamento',postergacao_confirmada_compras:'Compras confirmou a postergação',quantidade_alteracao_confirmada_compras:'Compras confirmou a nova quantidade',em_analise_compras:'Compras iniciou análise',compra_registrada:'Compra registrada'};return nomes[ev?.tipo]||String(ev?.tipo||'Atualização');}
function _solicitacoesFiltradas(){let xs=reqs.slice();if(solicitacoesVisao==='solicitar')xs=xs.filter(x=>!_reqEncerrada(x));else if(solicitacoesVisao==='minhas')xs=xs.filter(_reqMinha);else if(solicitacoesVisao==='mes')xs=xs.filter(_reqMesAtual);return xs.sort((a,b)=>String(a.dataNecessaria||a.criadoEm||'').localeCompare(String(b.dataNecessaria||b.criadoEm||'')));}
function _solicitacoesKpis(){const mes=reqs.filter(_reqMesAtual),ativas=mes.filter(x=>!_reqEncerrada(x)),compradas=mes.filter(x=>_reqTotalComprado(x)>0&&!/cancel/i.test(String(x.status||''))),semCompra=ativas.filter(x=>_reqTotalComprado(x)<=0),alteracoes=mes.filter(x=>x.pcpAlteracaoPendente?.status==='pendente'),canceladas=mes.filter(x=>/cancel/i.test(String(x.status||'')));return {mes:mes.length,semCompra:semCompra.length,compradas:compradas.length,alteracoes:alteracoes.length,canceladas:canceladas.length};}
function pedidosHtml(){
  const xs=_solicitacoesFiltradas(),k=_solicitacoesKpis(),abertas=reqs.filter(x=>!_reqEncerrada(x));
  const tabs=[['solicitar','Solicitar'],['minhas','Minhas solicitações'],['mes','Este mês'],['historico','Histórico']].map(([id,nome])=>`<button class="btn ${solicitacoesVisao===id?'btn-primary':'btn-ghost'} btn-sm" data-pcp-solic-visao="${id}">${nome}</button>`).join('');
  const alertas=reqs.filter(x=>x.pcpUltimoRetornoCompras?.respondidoEm).slice().sort((a,b)=>String(b.pcpUltimoRetornoCompras.respondidoEm).localeCompare(String(a.pcpUltimoRetornoCompras.respondidoEm))).slice(0,3);
  const resumo=`<div class="kpi-grid" style="margin-bottom:12px"><div class="kpi blue"><div class="kpi-val">${k.mes}</div><div class="kpi-lbl">Solicitadas para este mês</div></div><div class="kpi orange"><div class="kpi-val">${k.semCompra}</div><div class="kpi-lbl">Ainda não compradas</div></div><div class="kpi green"><div class="kpi-val">${k.compradas}</div><div class="kpi-lbl">Com compra registrada</div></div><div class="kpi teal"><div class="kpi-val">${k.alteracoes}</div><div class="kpi-lbl">Alterações aguardando Compras</div></div><div class="kpi red"><div class="kpi-val">${k.canceladas}</div><div class="kpi-lbl">Canceladas no mês</div></div></div>`;
  const avisos=alertas.length?`<div class="tc" style="padding:10px 12px;margin-bottom:12px;border-left:4px solid #3b82f6"><b>🔔 Retornos recentes de Compras</b><div style="margin-top:6px;display:grid;gap:5px">${alertas.map(x=>{const r=x.pcpUltimoRetornoCompras;return `<div style="font-size:.74rem"><b>${esc(x.produto)}</b> — ${r.aceita?'✅ alteração confirmada':'⚠️ alteração não confirmada'} (${esc(r.tipo||'')})${r.observacao?' · '+esc(r.observacao):''}</div>`}).join('')}</div></div>`:'';
  const topo=`<div class="tc" style="padding:12px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><b>Solicitação de Compra</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Acompanhe o que o PCP solicitou, o que Compras já executou e alterações de data/quantidade/cancelamento.</div></div>${tem('criar')?'<button class="btn btn-primary btn-sm" data-pcp-lote-abrir>+ Nova solicitação</button>':''}</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${tabs}</div></div>`;
  const tabela=`<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Solicitado</th><th>Comprado</th><th>Pendente</th><th>Data necessária</th><th>Destino</th><th>Comprador</th><th>Status</th><th>Alteração PCP</th><th>Ações</th></tr></thead><tbody>${xs.length?xs.map(x=>{const solicitado=n(x.quantidade),comprado=_reqTotalComprado(x),pend=Math.max(0,solicitado-comprado),enc=_reqEncerrada(x);return `<tr><td><b>${esc(x.produto)}</b><small style="display:block;color:var(--muted)">${esc(x.motivo||'')}</small></td><td>${solicitado.toLocaleString('pt-BR')}</td><td>${comprado.toLocaleString('pt-BR')}</td><td><span class="badge ${pend>0?'b-orange':'b-green'}">${pend.toLocaleString('pt-BR')}</span></td><td>${esc(x.dataNecessaria||'—')}</td><td>${esc(x.destino||'—')}</td><td>${esc(x.compradorNome||x.compradorEmail||'Não direcionado')}</td><td>${statusBadge(x.status)}</td><td>${_reqAlteracaoLabel(x)}</td><td style="white-space:nowrap"><button class="acao-lapis" data-pcp-req-hist="${esc(x._id)}" title="Ver histórico">🕘</button>${tem('editar')&&!enc&&!x.pcpAlteracaoPendente?`<button class="acao-lapis" data-pcp-req-postergar="${esc(x._id)}" title="Postergar data">📅</button><button class="acao-lapis" data-pcp-req-qtd="${esc(x._id)}" title="Alterar quantidade">✏️</button><button class="acao-lapis" data-pcp-req-cancelar="${esc(x._id)}" title="Cancelar solicitação">❌</button>`:''}</td></tr>`}).join(''):'<tr><td colspan="10">Nenhuma solicitação encontrada nesta visão.</td></tr>'}</tbody></table></div><div style="font-size:.68rem;color:var(--muted);margin-top:7px">Abertas agora: <b>${abertas.length}</b></div></div>`;
  const legado=pedidos.length?`<details class="tc" style="padding:12px;margin-top:12px"><summary style="cursor:pointer;font-weight:700">Pedidos legados (${pedidos.length})</summary><div style="font-size:.68rem;color:var(--muted);margin:6px 0">Registros antigos de pcp_pedidos, mantidos apenas para consulta e compatibilidade.</div></details>`:'';
  return topo+resumo+avisos+tabela+legado;
}
function _reqPorId(id){return reqs.find(x=>String(x._id)===String(id));}
function abrirHistoricoSolicitacao(id){const x=_reqPorId(id),host=document.getElementById('pcp-modal-host');if(!x||!host)return;const h=Array.isArray(x.historicoSolicitacao)?x.historicoSolicitacao.slice().reverse():[];host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:760px"><div class="modal-header"><div><b>Histórico — ${esc(x.produto)}</b><small>Solicitação ${esc(x._id)}</small></div><button class="modal-x" data-pcp-modal-close>×</button></div><div class="modal-body">${h.length?`<div style="display:grid;gap:8px">${h.map(ev=>`<div class="tc" style="padding:10px"><b>${esc(_reqHistoricoTexto(ev))}</b><div style="font-size:.7rem;color:var(--muted);margin-top:3px">${esc(String(ev.data||'').replace('T',' ').slice(0,16))} · ${esc(ev.por||'sistema')}</div>${ev.motivo||ev.observacao?`<div style="font-size:.74rem;margin-top:4px">${esc(ev.motivo||ev.observacao)}</div>`:''}${ev.de!=null||ev.para!=null?`<div style="font-size:.72rem;margin-top:3px">${esc(ev.de??'')} → ${esc(ev.para??'')}</div>`:''}</div>`).join('')}</div>`:'<div class="empty">Ainda não há eventos detalhados nesta solicitação antiga.</div>'}</div><div class="modal-footer"><button class="btn btn-ghost" data-pcp-modal-close>Fechar</button></div></div></div>`;}
function abrirAlteracaoSolicitacao(id,tipo){const x=_reqPorId(id),host=document.getElementById('pcp-modal-host');if(!x||!host)return;const comprado=_reqTotalComprado(x),titulo=tipo==='cancelamento'?'Cancelar solicitação':tipo==='postergacao'?'Postergar data necessária':'Alterar quantidade';host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:560px"><div class="modal-header"><div><b>${titulo}</b><small>${esc(x.produto)}${comprado>0?' · já existe compra registrada: a alteração será enviada para Compras confirmar':''}</small></div><button class="modal-x" data-pcp-modal-close>×</button></div><div class="modal-body">${tipo==='postergacao'?`<div class="form-group"><label>Nova data necessária</label><input class="field" id="pcp-req-alt-valor" type="date" value="${esc(x.dataNecessaria||'')}"></div>`:tipo==='quantidade'?`<div class="form-group"><label>Nova quantidade</label><input class="field" id="pcp-req-alt-valor" type="number" min="0" value="${n(x.quantidade)}"></div>`:''}<div class="form-group"><label>Motivo</label><textarea class="field" id="pcp-req-alt-motivo" rows="3" placeholder="Informe o motivo da alteração"></textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" data-pcp-modal-close>Voltar</button><button class="btn ${tipo==='cancelamento'?'btn-danger':'btn-primary'}" data-pcp-req-alt-save="${esc(id)}|${tipo}">${comprado>0?'Enviar para Compras':'Confirmar'}</button></div></div></div>`;}
async function salvarAlteracaoSolicitacao(id,tipo){if(!tem('editar'))return;const svc=global.DTPCPSolicitacoesWorkflow;if(!svc)throw new Error('Workflow de solicitações indisponível.');const valor=document.getElementById('pcp-req-alt-valor')?.value||'',motivo=document.getElementById('pcp-req-alt-motivo')?.value.trim()||'';let r;if(tipo==='cancelamento')r=await svc.cancelarOuSolicitar(id,motivo);else if(tipo==='postergacao')r=await svc.postergarOuSolicitar(id,valor,motivo);else r=await svc.alterarQuantidadeOuSolicitar(id,valor,motivo);document.getElementById('pcp-modal-host').innerHTML='';await carregar(true);desenhar();global.showToast?.(r.direto?'Solicitação atualizada.':'Alteração enviada para Compras confirmar.',r.direto?'success':'warning');}
function risco(v){return v==null?'b-gray':v<=3?'b-red':v<=7?'b-orange':v<=14?'b-yellow':'b-green';}
function riscoCoberturaInsumo(v){if(v==null)return 'b-gray';const pct=n(v)/META_COBERTURA_INSUMO_DIAS;return pct<0.5?'b-red':pct<0.75?'b-orange':pct<1?'b-yellow':'b-green';}
function _acaoPlanejamento(item){
  const transf=_transferenciasPlanejamento.get(item.key);
  if(transf&&transf.length)return {chave:'transferir',rotulo:'TRANSFERIR',classe:'b-blue'};
  try{
    const ex=global._pcpAlertasInternals?.excecoesDoProduto?.(item,produzidoInternamente)||[];
    const peso=x=>{const p=String(x.prioridade||'').toLowerCase(),c=String(x.cor||'').toLowerCase();return p==='critica'||c==='red'?0:p==='alta'||c==='orange'?1:2;};
    const pri=ex.slice().sort((a,b)=>peso(a)-peso(b))[0];
    if(pri){
      const ac=String(pri.acao||'').toUpperCase();
      if(ac.includes('REVISAR')&&(ac.includes('COMPR')||ac.includes('PRODU')))return {chave:'excesso',rotulo:ac,classe:'b-yellow'};
      if(ac.includes('COMPR'))return {chave:'comprar',rotulo:ac,classe:'b-orange'};
      if(ac.includes('PRODU'))return {chave:'produzir',rotulo:ac,classe:'b-purple'};
      if(ac.includes('TRANSFER'))return {chave:'transferir',rotulo:ac,classe:'b-blue'};
    }
  }catch(_){}
  if(item.necessidade>0){
    return produzidoInternamente(item.key)?{chave:'produzir',rotulo:'PRODUZIR',classe:item.estoqueDisponivel<=0||item.rupturaEm?'b-red':'b-purple'}:{chave:'comprar',rotulo:'COMPRAR',classe:item.estoqueDisponivel<=0||item.rupturaEm?'b-red':'b-orange'};
  }
  if(itemCriticoPlanejamento(item))return {chave:'critico',rotulo:'CRÍTICO',classe:'b-red'};
  if(item.excesso>0)return {chave:'excesso',rotulo:'EXCESSO',classe:'b-yellow'};
  return {chave:'ok',rotulo:'SEM AÇÃO',classe:'b-green'};
}
function _saldoEstoquePedido(item){return item&&item.estoqueDisponivel!=null?n(item.estoqueDisponivel):n(item?.estoqueAtual)-n(item?.pendente);}
function _dataLimitePlanejamento(item){
  try{
    const r=global._pcpTimelineInternals?.calcularRiscoTemporal?.(item,365);
    return r?.dataAcao||r?.dataLimiteAcao||r?.pontoPedidoEm||'';
  }catch(_){return '';}
}
function _redesenharComFoco(selector){
  const ativo=document.activeElement,valor=ativo?.value,inicio=ativo?.selectionStart,fim=ativo?.selectionEnd;
  desenhar();
  const novo=document.querySelector(selector);
  if(novo){
    novo.focus();
    if(valor!=null&&novo.value!==valor)novo.value=valor;
    try{if(inicio!=null)novo.setSelectionRange(inicio,fim==null?inicio:fim);}catch(_){}
  }
}
function filtrosHtml(){
  // PEDIDO AO VIVO (2026-09-25): "vou em categoria, aparece todas as
  // antigas ainda" — a lista do dropdown usava _categoriaDoNome() direto
  // (primeira palavra do nome), enquanto o filtro de verdade (mais abaixo,
  // "filtros.categoria&&norm(m.categoria)...") já usa metaProduto(), que
  // prefere produtos_mestre/Bluesoft. As duas fontes precisam ser a MESMA,
  // senão o dropdown oferece categoria que não bate com nenhum produto de
  // verdade (a categoria revisada nunca aparecia como opção).
  // PEDIDO AO VIVO (2026-09-25, 2ª rodada): "ainda ta aparecendo mais de 30
  // tipos de categoria" — os 714 produtos INATIVOS (fora da planilha
  // revisada) ainda entravam na lista, caindo no fallback Bluesoft/nome e
  // inflando a lista de 19 categorias reais pra mais de 30. Só produto
  // ativo no cadastro único entra na lista de categorias do filtro.
  const cats=[...new Set(produtos.filter(x=>_ativoNoCadastroUnico(x.cod,x.ativo)).map(x=>metaProduto({key:keyOf(x),produto:x.nome}).categoria).filter(Boolean).filter(c=>!CATEGORIAS_OCULTAS_PLANEJAMENTO.includes(norm(c))))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
  return `<div class="tc" style="padding:9px 10px;margin-bottom:10px"><div style="display:grid;grid-template-columns:minmax(180px,1.6fr) repeat(5,minmax(120px,1fr)) auto;gap:6px;align-items:center"><input class="field" style="font-size:.7rem;height:34px" data-pcp-filtro="busca" value="${esc(filtros.busca)}" placeholder="Produto, código, tapioca, alho..."><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="loja"><option value="">Todas as lojas (consolidado)</option>${lojas.map(l=>`<option value="${esc(l.id)}" ${filtros.loja===l.id?'selected':''}>${esc(l.nome||l.codigo||l.id)}</option>`).join('')}</select><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="marca"><option value="">Todas as marcas</option><option value="sim" ${filtros.marca==='sim'?'selected':''}>Marca própria</option><option value="nao" ${filtros.marca==='nao'?'selected':''}>Outras marcas</option></select><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="categoria"><option value="">Todas as categorias</option>${cats.map(c=>`<option ${filtros.categoria===String(c)?'selected':''}>${esc(c)}</option>`).join('')}</select><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="situacao"><option value="">Todas as situações</option><option value="estoque" ${filtros.situacao==='estoque'?'selected':''}>Com estoque</option><option value="pedidos" ${filtros.situacao==='pedidos'?'selected':''}>Com pedidos</option><option value="ruptura" ${filtros.situacao==='ruptura'?'selected':''}>Risco de ruptura</option></select><select class="field" style="font-size:.68rem;height:34px" data-pcp-filtro="acao"><option value="">Todas as ações</option><option value="comprar" ${filtros.acao==='comprar'?'selected':''}>Comprar</option><option value="produzir" ${filtros.acao==='produzir'?'selected':''}>Produzir</option><option value="transferir" ${filtros.acao==='transferir'?'selected':''}>Transferir</option><option value="critico" ${filtros.acao==='critico'?'selected':''}>Crítico</option><option value="excesso" ${filtros.acao==='excesso'?'selected':''}>Excesso</option><option value="ok" ${filtros.acao==='ok'?'selected':''}>Sem ação</option></select><button class="btn btn-ghost btn-sm" data-pcp-limpar-filtros>Limpar</button></div><label style="display:flex;align-items:center;gap:6px;font-size:.72rem;color:var(--muted);margin-top:8px;cursor:pointer"><input type="checkbox" data-pcp-filtro-check="ocultarZerados" ${filtros.ocultarZerados?'checked':''}> Ocultar produtos sem estoque, pedido e necessidade</label></div>`;
}
function th(campo,label){return `<th style="cursor:pointer;white-space:nowrap" data-pcp-sort="${esc(campo)}" title="Ordenar">${esc(label)}${setaOrdenacao(campo)}</th>`;}
// PEDIDO AO VIVO (2026-09-07): "eu quero que coloque consumo mesmo, que
// vai pegar a média dos três últimos meses e vai colocar lá, a soma... não
// quero consumo dia não" — troca "Consumo/dia" por "Consumo" mostrando a
// média mensal (soma dos 3 últimos meses fechados ÷ 3) já calculada em
// consumoMensal; consumoDia continua existindo por baixo (cobertura e
// necessidade em dias dependem dele), só não aparece mais na tabela.
function estoqueHtml(v){
  return filtrosHtml()+`<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr>${th('produto','Produto')}${th('estoqueAtual','Estoque')}${th('pendente','Pedidos')}${th('saldo','Saldo')}${th('coberturaDias','Cobertura')}${th('necessidade','Necessidade')}<th>Ação recomendada</th><th>Data limite</th><th></th></tr></thead><tbody>${v.map(x=>{
    const saldo=_saldoEstoquePedido(x),neg=saldo<0,acao=_acaoPlanejamento(x),data=_dataLimitePlanejamento(x);
    const vermelho=neg?'background:#c0392b;color:#fff':'';
    // PEDIDO AO VIVO (2026-10-01): "quero saber quantos dias negativos fica
    // com o saldo negativo" — x.coberturaDias vem com Math.max(0,...) por
    // dentro (construirVisao), de propósito, pra ordenação/classificação de
    // risco/sugestão de transferência não mudarem; aqui, igual já era feito
    // em comprasHtml/cruzamentoHtml, recalcula sem esse piso só pro texto
    // mostrado — produto já negativo mostra os dias negativos de verdade.
    const coberturaReal=x.consumoDia>0?saldo/x.consumoDia:null;
    return `<tr><td><b style="cursor:pointer" data-pcp-360="${esc(x.key)}">${esc(x.produto)}</b><div style="font-size:.65rem;opacity:.75">${esc(x.cod||'')}</div></td><td>${qtdReal(x.estoqueAtual).toLocaleString('pt-BR')}</td><td>${qtd(x.pendente).toLocaleString('pt-BR')}</td><td style="${vermelho}"><b>${Math.ceil(saldo).toLocaleString('pt-BR')}</b></td><td><span class="badge ${risco(coberturaReal)}">${coberturaReal==null?'—':coberturaReal.toLocaleString('pt-BR',{maximumFractionDigits:1})+'d'}</span></td><td>${qtd(x.necessidade).toLocaleString('pt-BR')}</td><td><span class="badge ${acao.classe}">${esc(acao.rotulo)}</span></td><td>${data?esc(String(data).split('-').reverse().join('/')):'—'}</td><td><button class="acao-lapis" title="Abrir Produto 360°" data-pcp-360="${esc(x.key)}">🔎</button></td></tr>`;
  }).join('')||'<tr><td colspan="9">Nenhum produto para os filtros selecionados.</td></tr>'}</tbody></table></div></div>`;
}
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
function cruzamentoHtml(v){return filtrosHtml()+`<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr>${th('produto','Produto')}${th('estoqueAtual','Estoque')}${th('pendente','Pedidos')}${th('saldo','Saldo')}<th>Cobertura</th><th></th></tr></thead><tbody>${v.map(x=>{const saldoSimples=_saldoEstoquePedido(x),negativo=saldoSimples<0,cobertura=x.consumoDia>0?saldoSimples/x.consumoDia:null;return `<tr><td><b style="cursor:pointer" data-pcp-360="${esc(x.key)}">${esc(x.produto)}</b></td><td>${qtdReal(x.estoqueAtual).toLocaleString('pt-BR')}</td><td>${qtd(x.pendente).toLocaleString('pt-BR')}</td><td${negativo?' style="background:#c0392b;color:#fff"':''}><b>${Math.ceil(saldoSimples).toLocaleString('pt-BR')}</b></td><td>${cobertura==null?'—':Math.round(cobertura).toLocaleString('pt-BR')+'d'}</td><td><button class="acao-lapis" title="Ver relatório do produto" data-pcp-memoria="${esc(x.key)}">🧮</button></td></tr>`;}).join('')||'<tr><td colspan="6">Nenhum produto para os filtros selecionados.</td></tr>'}</tbody></table></div></div>`;}
// Aba Insumos — sem filtrosHtml() (é lista própria, não passa por
// dadosFiltrados/visaoFiltrada dos produtos) nem drill-down pro Produto
// 360° (insumo não é produto). Ordenado por necessidade (já vem assim de
// _juntarInsumosBi).
function insumosHtml(v){const tipos=[...new Set(v.map(x=>x.tipo||x.categoria).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR')),lojasBi=[...new Set((_insumosBiRaw?.produtos||[]).map(x=>String(x.lojaId??x.loja_id??x.loja??x.filial??x.nomeLoja??x.lojaNome??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));const lista=v.filter(x=>(!filtrosInsumos.grupo||x.grupo===filtrosInsumos.grupo)&&(!filtrosInsumos.tipo||String(x.tipo||x.categoria)===filtrosInsumos.tipo)&&(!filtrosInsumos.busca||norm(x.cod+' '+x.produto+' '+x.tipo+' '+x.categoria).includes(norm(filtrosInsumos.busca))));return `<div class="tc" style="padding:10px;margin-bottom:10px"><div style="display:grid;grid-template-columns:minmax(220px,1.6fr) repeat(3,minmax(150px,1fr)) auto;gap:7px"><input class="field" data-pcp-ins-filtro="busca" value="${esc(filtrosInsumos.busca)}" placeholder="Pesquisar código ou material..."><select class="field" data-pcp-ins-filtro="loja"><option value="">Todas as lojas (consolidado)</option>${lojasBi.map(l=>`<option value="${esc(l)}" ${filtrosInsumos.loja===l?'selected':''}>${esc(l)}</option>`).join('')}</select><select class="field" data-pcp-ins-filtro="grupo"><option value="">Matéria-prima + insumos</option><option value="materia-prima" ${filtrosInsumos.grupo==='materia-prima'?'selected':''}>Matéria-prima</option><option value="insumo" ${filtrosInsumos.grupo==='insumo'?'selected':''}>Insumos / embalagens</option></select><select class="field" data-pcp-ins-filtro="tipo"><option value="">Todos os tipos</option>${tipos.map(t=>`<option value="${esc(t)}" ${filtrosInsumos.tipo===t?'selected':''}>${esc(t)}</option>`).join('')}</select><button class="btn btn-ghost btn-sm" data-pcp-ins-limpar>Limpar</button></div></div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Código</th><th>Material</th><th>Grupo</th><th>Tipo</th><th>Estoque</th><th>Consumo mensal</th><th>Cobertura</th><th>Meta</th><th></th></tr></thead><tbody>${lista.map(x=>`<tr><td>${esc(x.cod||'—')}</td><td><b>${esc(x.produto)}</b></td><td><span class="badge ${x.grupo==='materia-prima'?'b-blue':'b-orange'}">${x.grupo==='materia-prima'?'Matéria-prima':'Insumo'}</span></td><td>${esc(x.tipo||x.categoria||'—')}</td><td>${qtdReal(x.estoque).toLocaleString('pt-BR')}</td><td>${qtd(x.consumoMensal).toLocaleString('pt-BR')}</td><td><span class="badge ${riscoCoberturaInsumo(x.coberturaDias)}">${x.coberturaDias==null?'—':x.coberturaDias.toFixed(1)+'d'}</span></td><td>${META_COBERTURA_INSUMO_DIAS}d</td><td><button class="acao-lapis" title="Abrir Insumo 360°" data-pcp-insumo-360="${esc(x.cod||x.produto)}" data-pcp-insumo-nome="${esc(x.produto)}">🔎</button></td></tr>`).join('')||'<tr><td colspan="9">Nenhum material para os filtros selecionados.</td></tr>'}</tbody></table></div></div>`;}
function memoriaDeCalculo(item){
  const cad=resolverCadastroProduto(item?.key||item?.cod||'');
  const metaConfigurada=n(cad?.metaCoberturaDias??cad?.coberturaMetaDias)>0;
  const formulaCobertura=metaConfigurada?'Parâmetro configurado em PCP · Parâmetros':`Padrão do motor PCP (${META_COBERTURA_PRODUTO_DIAS} dias) — não há meta específica configurada`;
  return [
  {passo:'Demanda histórica diária (3 meses)',valor:item.demandaHistoricaDia??'—',formula:'M1 50% + M2 30% + M3 20%, normalizados pelos dias de cada mês'},
  {passo:'Previsão futura diária',valor:item.previsaoFuturaDia??'—',formula:'P1 50% + P2 30% + P3 20%; usa a projeção semanal quando os períodos futuros não existem'},
  {passo:'Demanda diária combinada',valor:item.consumoDia,formula:'50% histórico + 50% previsão; fallback automático quando uma fonte não existe'},
  {passo:'Estoque atual',valor:item.estoqueAtual,formula:'Saldo em producao_projecao.estoqueAtual'},
  {passo:'(−) Comprometido (pedidos pendentes)',valor:-item.estoqueComprometido,formula:'Pedidos com quantidade ainda não atendida'},
  {passo:'(+) Produção programada',valor:item.producaoProgramada,formula:'OPs abertas ainda não concluídas'},
  {passo:'(+) Entradas previstas',valor:item.entradasPrevistas,formula:'Agendamentos/compras a caminho'},
  {passo:'= Saldo projetado',valor:item.saldo,formula:'Estoque atual − comprometido + produção + entradas',destaque:true},
  {passo:'Lead time',valor:(item.leadTimeDias??'—')+' dias',formula:item.leadTimeRotulo||'Fonte resolvida pelo motor do PCP'},
  {passo:'Estoque de segurança configurado',valor:item.estoqueSegurancaConfigurado??0,formula:'Valor manual cadastrado para este produto/loja'},
  {passo:'Estoque de segurança usado no cálculo',valor:item.estoqueSeguranca,formula:'máx(configurado, fator de serviço × desvio da demanda × √lead time)'},
  {passo:'Ponto de pedido',valor:item.pontoPedido,formula:'demanda diária × lead time + estoque de segurança'},
  {passo:'Cobertura desejada',valor:item.diasAlvo+' dias',formula:formulaCobertura},
  {passo:'Estoque alvo',valor:item.estoqueAlvo,formula:'máx(estoque mínimo, consumo diário × cobertura desejada)'},
  {passo:'= Necessidade',valor:item.necessidade,formula:'máx(0, estoque alvo − saldo projetado)',destaque:true},
];
}
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
async function salvarCoberturaMemoria(key){
  if(!tem('configurar'))return;
  const dias=Math.max(0,Math.ceil(n(document.getElementById('pcp-mem-cobertura')?.value))),candidatos=produtos.filter(x=>keyOf(x)===key),alvo=String(filtros.loja||global.getDTLojaAtiva?.()||''),variantes=(alvo?candidatos.filter(x=>String(x.lojaId||'')===alvo):candidatos);
  if(!variantes.length)throw new Error('Produto não encontrado no cadastro desta loja.');
  const payload={metaCoberturaDias:dias,atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||''};
  await Promise.all(variantes.filter(x=>x._id||x._firestoreId).map(x=>raw().collection('lojas').doc(x.lojaId||alvo).collection(CPROD).doc(x._id||x._firestoreId).set(payload,{merge:true})));
  const cod=String(variantes[0].cod||key||'').trim();
  carregado=false;await carregar(true);desenhar();modalMemoria(key);global.showToast?.('Cobertura salva em todas as variantes e cálculo atualizado.','success');
}
// PEDIDO AO VIVO (2026-09-02): "dividir esses produtos por linhas...
// colocar uma tabela organizada... e qualquer coisa colocar já alguma
// coisa que já envia automaticamente o pedido pra compras direto" —
// trocada a nuvem de botões por tabela normal (1 produto por linha,
// colunas), com botão de enviar direto (sem abrir modal) por linha e um
// "Enviar todos" pro lote inteiro. Quem quiser customizar quantidade/data/
// destino antes de enviar ainda pode clicar no produto, que abre o modal
// de sempre.
function comprasHtml(v){const nec=v.filter(x=>x.necessidade>0&&!produzidoInternamente(x.key)),transf=calcularSugestoesTransferencia(),transfPorKey=new Map();transf.forEach(t=>{const a=transfPorKey.get(t.key)||[];a.push(t);transfPorKey.set(t.key,a);});const blocoTransf=transf.length?`<div class="tc" style="padding:12px;margin-bottom:12px;border-left:4px solid #3b82f6"><b>🔄 Transferências sugeridas entre lojas (${transf.length})</b><div style="font-size:.7rem;color:var(--muted);margin:3px 0 8px">Sugestão somente. A origem nunca é reduzida abaixo do estoque-alvo/segurança/mínimo e nenhuma transferência é criada automaticamente.</div><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Origem</th><th>Destino</th><th>Qtd sugerida</th><th>Cobertura origem</th><th>Cobertura destino</th><th>Necessidade local restante</th></tr></thead><tbody>${transf.map(t=>`<tr><td><b>${esc(t.produto)}</b></td><td>${esc(t.origemLojaNome)}</td><td>${esc(t.destinoLojaNome)}</td><td><b>${Math.ceil(t.quantidade).toLocaleString('pt-BR')}</b></td><td>${t.coberturaOrigem==null?'—':Number(t.coberturaOrigem).toFixed(1)+'d'}</td><td>${t.coberturaDestino==null?'—':Number(t.coberturaDestino).toFixed(1)+'d'}</td><td>${Math.ceil(t.necessidadeRestante).toLocaleString('pt-BR')}</td></tr>`).join('')}</tbody></table></div></div>`:'';return blocoTransf+`<div class="tc" style="padding:12px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>Necessidades calculadas (${nec.length})</b><div style="display:flex;gap:6px">${tem('criar')&&nec.length?'<button class="btn btn-primary btn-sm" data-pcp-nec-enviar-todos>📤 Enviar todos</button>':''}</div></div><div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Produto</th><th>Estoque disp.</th><th>Necessidade (cx)</th><th>Cobertura atual</th><th>Motivo</th><th>Transferência</th>${tem('criar')?'<th></th>':''}</tr></thead><tbody>${nec.length?nec.map(x=>{
  // PEDIDO AO VIVO (2026-09-04): "não mostra a cobertura de dias" —
  // x.coberturaDias vem com Math.max(0,...) por dentro (construirVisao), de
  // propósito, pra outros relatórios que preferem não mostrar negativo;
  // igual já foi feito em cruzamentoHtml (Pedidos x Estoque), recalcula sem
  // esse piso aqui — produto já negativo mostra os dias negativos de
  // verdade, não um "0.0d" genérico que esconde o tamanho do problema.
  const coberturaReal=x.consumoDia>0?x.estoqueDisponivel/x.consumoDia:null;
  return `<tr><td><b style="cursor:pointer" data-pcp-req-prod="${esc(x.key)}">${esc(x.produto)}</b></td><td>${Math.ceil(x.estoqueDisponivel).toLocaleString('pt-BR')}</td><td><b>${Math.ceil(x.necessidade).toLocaleString('pt-BR')}</b></td><td>${coberturaReal==null?'—':coberturaReal.toFixed(1)+'d'}</td><td>${x.rupturaEm?'Risco de ruptura':'Abaixo do estoque-alvo'}</td><td>${(transfPorKey.get(x.key)||[]).length?`<span class="badge b-blue">🔄 ${(transfPorKey.get(x.key)||[]).reduce((s,t)=>s+t.quantidade,0).toLocaleString('pt-BR',{maximumFractionDigits:0})} cx</span>`:'—'}</td>${tem('criar')?`<td><button class="btn btn-ghost btn-sm" data-pcp-nec-enviar="${esc(x.key)}">📤 Enviar pedido</button></td>`:''}</tr>`;
}).join(''):`<tr><td colspan="${tem('criar')?7:6}">Nenhuma necessidade de compra calculada.</td></tr>`}</tbody></table></div></div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Solicitado</th><th>Comprado</th><th>Saldo pendente</th><th>Data necessária</th><th>Destino</th><th>Motivo</th><th>Prioridade</th><th>Comprador</th><th>Status</th></tr></thead><tbody>${reqs.length?reqs.map(x=>{const solicitado=n(x.quantidade),comprado=n(x.quantidadeComprada),saldoPend=Math.max(0,solicitado-comprado);return `<tr><td><b>${esc(x.produto)}</b></td><td>${solicitado.toLocaleString('pt-BR')}</td><td>${comprado.toLocaleString('pt-BR')}</td><td><span class="badge ${saldoPend>0?'b-orange':'b-green'}">${saldoPend.toLocaleString('pt-BR')}</span></td><td>${esc(x.dataNecessaria||'')}</td><td>${esc(x.destino||'')}</td><td>${esc(x.motivo||'')}</td><td>${esc(x.prioridade||'normal')}</td><td>${esc(x.compradorNome||x.compradorEmail||'Não direcionado')}</td><td>${statusBadge(x.status)}</td></tr>`}).join(''):'<tr><td colspan="10">Nenhuma requisição criada.</td></tr>'}</tbody></table></div></div>`;}
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
  _buscaPedido=null;_buscaPedidoErro='';desenhar();
  try{
    const lojaId=global.getDTLojaAtiva?.()||'';
    const snap=await raw().collection('lojas').doc(lojaId).collection('recebimento_agendamentos').where('numeroPedido','==',numero).limit(1).get();
    if(snap.empty)throw new Error('Pedido não encontrado no espelho do BI. Aguarde a sincronização do SharePoint ou confira o número.');
    const pedido=snap.docs[0].data()||{};
    _buscaPedido={numeroPedido:numero,fornecedorNome:pedido.fornecedorNome||'',entregaPendente:!pedido.dataRecebida,
      itens:(pedido.itensPedido||[]).map(it=>{const cod=String(it.produtoKey||it.cod||'');const cadastrado=produtos.some(p=>String(p.cod||'')===cod);return {cod,produtoNome:it.produto||('Produto '+cod),quantidadePedida:n(it.quantidadePendente)+n(it.quantidadeRecebida),quantidadePendente:n(it.quantidadePendente),cadastradoNaProducao:cadastrado};})};
  }catch(e){_buscaPedidoErro=e.message||String(e);}
  desenhar();
}
function usarItemBuscaPedidoAgenda(idx){
  if(!_buscaPedido)return;
  const it=_buscaPedido.itens[idx];if(!it||!it.cadastradoNaProducao)return;
  const campo=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  campo('pcp-age-prod',it.cod);campo('pcp-age-forn',_buscaPedido.fornecedorNome);
  campo('pcp-age-qtd',it.quantidadePendente||it.quantidadePedida);campo('pcp-age-compra',_buscaPedido.numeroPedido);
  global.showToast?.('Preenchido a partir do pedido sincronizado pelo BI — confirme a data real de entrega.','success');
}
function agendHtml(){return `<div class="tc" style="padding:12px;margin-bottom:12px">${tem('criar')?`<div style="display:flex;gap:7px;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)"><input class="field" id="pcp-age-busca-num" placeholder="Nº do pedido no BI" style="max-width:220px"><button type="button" class="btn btn-ghost btn-sm" data-pcp-age-buscar>🔎 Buscar pedido sincronizado</button></div>${_buscaPedidoHtml()}<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:7px;margin-top:10px">${produtoInputCompraHtml('pcp-age-prod')}<input class="field" id="pcp-age-forn" placeholder="Fornecedor"><input class="field" id="pcp-age-qtd" type="number" min="0" placeholder="Quantidade"><input class="field" id="pcp-age-data" type="date" title="Data real confirmada pelo fornecedor"><input class="field" id="pcp-age-compra" placeholder="Nº compra/pedido"><button class="btn btn-primary btn-sm" data-pcp-age-save>+ Agendar</button></div>`:''}</div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Fornecedor</th><th>Qtd</th><th>Entrega</th><th>Comprador</th><th>Compra/Pedido</th><th>Recebido</th><th>Pendente</th><th>Status</th><th></th></tr></thead><tbody>${agend.length?agend.map(x=>`<tr><td><b>${esc(x.produto)}</b></td><td>${esc(x.fornecedor||'')}</td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td><td>${esc(x.dataPrevista||'')} ${esc(x.horario||'')}</td><td>${esc(x.compradorNome||x.compradorEmail||'')}</td><td>${esc(x.numeroCompra||'')}</td><td>${n(x.quantidadeRecebida).toLocaleString('pt-BR')}</td><td>${Math.max(0,n(x.quantidade)-n(x.quantidadeRecebida)).toLocaleString('pt-BR')}</td><td>${statusBadge(x.status)}</td><td>${tem('editar')&&!/finaliz|cancel/i.test(String(x.status||''))?`<button class="btn btn-ghost btn-sm" data-pcp-age-receber="${esc(x._id)}">Receber</button>`:''}</td></tr>`).join(''):'<tr><td colspan="10">Nenhum agendamento.</td></tr>'}</tbody></table></div></div>`;}
// PEDIDO AO VIVO (2026-09-07): "da programação de produção, que está
// vendo a média, media dia. É pra colocar venda média, mensal. Previsão
// dia. É pra colocar previsão mensal" — trocado demandaHistoricaDia/
// previsaoFuturaDia (só populados pelo motor de demanda antigo, sempre
// "—" pros produtos vindos do BI, que são a maioria hoje) por
// consumoMensal/previsaoMensal, que existem pras 2 fontes (BI e motor).
function _proximoDiaUtilIso(){const d=new Date();do{d.setDate(d.getDate()+1);}while(d.getDay()===0||d.getDay()===6);return d.toISOString().slice(0,10);}
function _quantidadeProducaoAjustada(item){
  // Em "Todas as lojas", cada unidade precisa ser arredondada com SUA
  // producao minima/multiplo antes da soma; aplicar uma unica loja ao total
  // consolidado reintroduziria a mistura de parametros ja corrigida no motor.
  if(item?._consolidadoLojas&&Array.isArray(item._lojasDetalhe)){
    const partes=item._lojasDetalhe.filter(x=>produzidoInternamenteNaLoja(item.key,x.lojaId)).map(x=>_quantidadeProducaoAjustada(x));
    const multiplos=[...new Set(partes.map(x=>n(x.multiplo)).filter(x=>x>0))];
    return {necessidade:partes.reduce((s,x)=>s+n(x.necessidade),0),minimo:partes.reduce((s,x)=>s+n(x.minimo),0),multiplo:multiplos.length===1?multiplos[0]:0,multiploTexto:multiplos.length>1?'Por loja':'',quantidade:partes.reduce((s,x)=>s+n(x.quantidade),0),porLoja:true};
  }
  const loja=item?.lojaId||filtros.loja||global.getDTLojaAtiva?.()||'';
  const p=resolverCadastroProduto(item.key,{lojaId:loja});const necessidade=Math.max(0,Math.ceil(n(item.necessidade))),minimo=Math.max(0,n(p.producaoMinima)),multiplo=Math.max(0,n(p.multiploProducao));let q=Math.max(necessidade,minimo);if(multiplo>0)q=Math.ceil(q/multiplo)*multiplo;return {necessidade,minimo,multiplo,quantidade:q};
}
function _dataNecessariaProducao(item){
  try{const r=global._pcpTimelineInternals?.calcularRiscoTemporal?.(item,365);return r?.pontoPedidoEm||r?.dataAcao||r?.rupturaEm||_proximoDiaUtilIso();}catch(_){return _proximoDiaUtilIso();}
}
function prodReqHtml(v){
  const sugestoes=[];
  (v||[]).forEach(x=>{
    if(x?._consolidadoLojas&&Array.isArray(x._lojasDetalhe)){
      x._lojasDetalhe.forEach(d=>{if(n(d.necessidade)>0&&produzidoInternamenteNaLoja(x.key,d.lojaId))sugestoes.push(d);});
    }else if(n(x.necessidade)>0&&produzidoInternamenteNaLoja(x.key,x.lojaId||filtros.loja||global.getDTLojaAtiva?.()||''))sugestoes.push(x);
  });
  sugestoes.sort((a,b)=>n(b.necessidade)-n(a.necessidade));
  const lista=sugestoes.slice(0,50);
  const filtroLoja=`<div class="tc" style="padding:9px 10px;margin-bottom:10px"><div style="max-width:360px"><label style="font-size:.7rem;font-weight:700">Loja da necessidade</label><select class="field" data-pcp-filtro="loja"><option value="">Todas as lojas (consolidado)</option>${lojas.map(l=>`<option value="${esc(l.id)}" ${filtros.loja===l.id?'selected':''}>${esc(l.nome||l.codigo||l.id)}</option>`).join('')}</select></div></div>`;
  return filtroLoja+`<div class="tc" style="margin-bottom:12px"><div style="padding:12px 14px;border-bottom:1px solid var(--border)"><b>Sugestões de produção</b><div style="font-size:.7rem;color:var(--muted);margin-top:3px">Necessidade calculada por loja e ajustada pela produção mínima/múltiplo daquela unidade. A data exibida é a data necessária de referência; a programação/capacidade da fábrica define o início executável.</div></div><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Loja</th><th>Estoque disp.</th><th>Venda média mensal</th><th>Previsão mensal</th><th>Necessidade calculada</th><th>Produção mínima</th><th>Múltiplo</th><th>Qtd necessária</th><th>Data necessária</th><th></th></tr></thead><tbody>${lista.length?lista.map(x=>{const a=_quantidadeProducaoAjustada(x);return `<tr><td><b>${esc(x.produto)}</b><div style="font-size:.66rem;color:var(--muted)">${esc(x.cod||'')}</div></td><td>${esc(x.lojaNome||x.lojaId||'—')}</td><td>${Math.ceil(x.estoqueDisponivel).toLocaleString('pt-BR')}</td><td>${x.consumoMensal==null?'—':Math.round(x.consumoMensal).toLocaleString('pt-BR')}</td><td>${x.previsaoMensal==null?'—':Math.round(x.previsaoMensal).toLocaleString('pt-BR')}</td><td>${a.necessidade.toLocaleString('pt-BR')}</td><td>${a.minimo?a.minimo.toLocaleString('pt-BR'):'—'}</td><td>${a.multiploTexto|| (a.multiplo?a.multiplo.toLocaleString('pt-BR'):'—')}</td><td><b>${a.quantidade.toLocaleString('pt-BR')} cx</b></td><td>${_dataNecessariaProducao(x).split('-').reverse().join('/')}</td><td>${tem('criar')?`<button class="btn btn-primary btn-sm" data-pcp-prod-prod="${esc(x.key)}" data-pcp-prod-loja="${esc(x.lojaId||'')}">Programar</button>`:''}</td></tr>`;}).join(''):'<tr><td colspan="11">Sem necessidade de produção calculada.</td></tr>'}</tbody></table></div></div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Qtd</th><th>Data</th><th>Destino</th><th>Prioridade</th><th>Empresa produtora</th><th>Origem</th><th>Status</th></tr></thead><tbody>${solProd.length?solProd.map(x=>`<tr><td><b>${esc(x.produto)}</b></td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td><td>${esc(x.dataProgramada||'')}</td><td>${esc(x.destino||'')}</td><td>${esc(x.prioridade||'normal')}</td><td>${esc(x.empresaProdutoraNome||x.empresaProdutoraId||'Não definida')}</td><td>${esc(x.origem||'PCP')}</td><td>${statusBadge(x.status)}</td></tr>`).join(''):'<tr><td colspan="8">Nenhuma solicitação de produção.</td></tr>'}</tbody></table></div></div>`;
}
function modalSolic(tipo,key,lojaId=''){
  const base=construirVisao({...dadosFiltrados(),estoqueBi:_estoqueBi}).find(x=>x.key===key)||{};
  const loja=String(lojaId||'');
  const v=loja&&base?._lojasDetalhe?.length?(base._lojasDetalhe.find(x=>String(x.lojaId||'')===loja)||base):base;
  const host=document.getElementById('pcp-modal-host');if(!host)return;
  const compra=tipo==='compra',ajuste=compra?null:_quantidadeProducaoAjustada(v),qInicial=compra?Math.ceil(v.necessidade||0):ajuste.quantidade,dataInicial=compra?'':_dataNecessariaProducao(v);
  host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:620px"><div class="modal-header"><b>${compra?'Nova necessidade de compra':'Nova solicitação de produção'}</b><button class="modal-x" data-pcp-modal-close>×</button></div><div class="modal-body"><input type="hidden" id="pcp-s-key" value="${esc(v.key)}"><input type="hidden" id="pcp-s-loja" value="${esc(v.lojaId||loja||'')}"><div class="form-group"><label>Produto</label><input class="field" id="pcp-s-prod" value="${esc(v.produto||'')}"></div><div class="grid2"><div class="form-group"><label>Quantidade</label><input class="field" id="pcp-s-qtd" type="number" min="0" value="${qInicial}"></div><div class="form-group"><label>Data necessária</label><input class="field" id="pcp-s-data" type="date" value="${dataInicial}"></div><div class="form-group"><label>Destino/loja</label><input class="field" id="pcp-s-dest" value="${esc(v.lojaNome||'')}"></div><div class="form-group"><label>Prioridade</label><select class="field" id="pcp-s-prio"><option>normal</option><option>alta</option><option>urgente</option></select></div></div><div class="form-group"><label>${compra?'Motivo':'Observação'}</label><textarea class="field" id="pcp-s-obs" rows="3">${compra&&v.necessidade>0?'Estoque insuficiente / saldo projetado negativo':''}</textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" data-pcp-modal-close>Cancelar</button><button class="btn btn-primary" data-pcp-s-save="${tipo}">Salvar</button></div></div></div>`;
}
// Núcleo compartilhado entre o modal (salvarSolic) e o envio direto sem
// modal (enviarNecessidadeDireto/enviarTodasNecessidades) — mesmo roteamento
// automático de comprador dos dois jeitos.
async function _criarRequisicaoCompra(key,produtoNome,opts){
  const q=Math.max(0,n(opts.quantidade));
  if(!produtoNome||q<=0||!opts.dataNecessaria)throw new Error('Informe produto, quantidade e data.');
  if(produzidoInternamente(String(key||''))&&opts?.permitirProduzido!==true)throw new Error('Este produto é abastecido por produção interna e não pode gerar solicitação de compra.');
  const prodBase=produtos.find(x=>keyOf(x)===key)||produtos.find(x=>norm(x.nome)===norm(produtoNome))||{};
  // opts.fornecedorNome (novo): a solicitação em lote sabe o fornecedor de
  // verdade (veio do vínculo fornecedor→produto escolhido no modal), então
  // o roteamento usa ele direto — sem depender do produto estar cadastrado
  // em Produção (produzido internamente muitas vezes nem tem cadastro lá).
  const prod={...prodBase};
  if(opts.fornecedorNome)prod.fornecedorPadrao=opts.fornecedorNome;
  if(opts.categoria&&!prod.categoria)prod.categoria=opts.categoria;
  const roteamento=resolverComprador(prod);
  const base={produto:produtoNome,prodKey:key,quantidade:q,dataNecessaria:opts.dataNecessaria,destino:opts.destino||'',prioridade:opts.prioridade||'normal',lojaId:String(opts.lojaId||filtros.loja||global.getDTLojaAtiva?.()||''),criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||'',pcpResponsavel:global._currentAnalistaUser?.email||'',pcpUid:global._currentAnalistaUser?.uid||''};
  await fs().collection(CREQ).add({...base,motivo:opts.motivo||'',status:roteamento.compradorUid?'solicitada':'sem_comprador',origem:'PCP',fornecedorId:prod.fornecedorPadraoId||prod.fornecedorId||'',fornecedorSugerido:prod.fornecedorPadrao||prod.fornecedor||'',categoria:prod.categoria||prod.classificacao||'',historicoSolicitacao:[{tipo:'criada_pcp',data:base.criadoEm,porUid:base.pcpUid,por:base.pcpResponsavel,quantidade:q,dataNecessaria:opts.dataNecessaria}],...roteamento});
  return roteamento;
}
// Cadastro em lote por categoria. O fornecedor exibido vem do cadastro/BI
// disponível no PCP; o vínculo dedicado fornecedor→produto pertence ao módulo
// de Compras e não é presumido aqui. Cada produto x data vira uma requisição
// separada pelo mesmo núcleo (_criarRequisicaoCompra).
async function abrirModalSolicLote(){if(!tem('criar'))return;loteFornecedorId='';loteProdutosFornecedor=[];loteLinhas=[];const host=document.getElementById('pcp-modal-host');if(host)host.innerHTML=modalSolicLoteHtml();}
async function _garantirCatalogosSolicitacao(categoria){
  if(!loteFornecedores.length&&global._fornecedoresService?.listarVinculosHomologados){
    loteFornecedores=await global._fornecedoresService.listarVinculosHomologados().catch(()=>[]);
  }
  if(!global.DTBiPastaLocal?.suportado?.())return;
  // Reutiliza os mesmos carregadores do PCP, inclusive conexão/cache e
  // tratamento de erro. Não cria nenhuma leitura Firestore paralela.
  if(categoria==='materia-prima'||categoria==='insumos'){
    // _juntarInsumosBi usa o estoque de produto como fallback quando o arquivo
    // de insumos vem zerado; por isso o estoque precisa existir ANTES do join.
    if(!_estoqueBiRaw)await buscarEstoqueBi();
    if(!_insumosBi)await buscarInsumosBi();
    else if(_insumosBiRaw)_insumosBi=_juntarInsumosBi(_insumosBiRaw,null,filtrosInsumos.loja);
  }
  if(categoria==='produto-acabado'&&!_estoqueBiRaw)await buscarEstoqueBi();
}
// PEDIDO AO VIVO (2026-09-25): "tem como colocar pra aparecer só os
// produtos ativos?" — já filtrava por `ativo` do cadastro antigo por loja
// (producao_produtos/pcp_produtos_bluesoft), mas esse campo tinha valor
// desatualizado/esquecido de outra época pra maioria dos produtos (mesmo
// bug real encontrado e corrigido na migração do cadastro único). Agora o
// cadastro único (produtos_mestre) já tem o ativo/inativo revisado de
// verdade pelo usuário — usa ele como fonte, com fallback pro campo antigo
// só pra quem ainda não passou pela migração (nunca esconde por acidente
// um produto que nem chegou a ser avaliado).
function _ativoNoCadastroUnico(cod,ativoAntigo){
  const mestre=_produtosMestre.get(String(cod||'').trim());
  if(mestre)return mestre.ativo!==false;
  return ativoAntigo!==false;
}
function _vinculoFornecedorProduto(cod){
  const c=String(cod||'').trim();if(!c)return null;
  const ids=new Set(aliasesProduto(c).map(String));ids.add(c);
  const candidatos=(loteFornecedores||[]).filter(v=>ids.has(String(v.produtoId||'').trim())&&v.homologado!==false);
  if(!candidatos.length)return null;
  return candidatos.slice().sort((a,b)=>String(b.ultimaCompraEm||'').localeCompare(String(a.ultimaCompraEm||''))||String(a.fornecedorNome||'').localeCompare(String(b.fornecedorNome||''),'pt-BR'))[0];
}
function _catalogoProdutoAcabadoCompleto(){
  // Usa a mesma visão calculada do Planejamento para estoque/consumo/necessidade
  // e exclui produto fabricado internamente: solicitação de COMPRA não pode
  // oferecer item cujo abastecimento oficial é produção interna.
  const visao=filtrarProdutosPlanejaveis(_visaoBaseMemo(true));
  const mapa=new Map();
  (visao||[]).forEach(item=>{
    const k=item.key||item.cod;if(!k||produzidoInternamente(k))return;
    const cad=resolverCadastroProduto(k),vinc=_vinculoFornecedorProduto(cad.cod||item.cod||k);
    if(!_ativoNoCadastroUnico(cad.cod||item.cod,cad.ativo))return;
    const meta=metaProduto(item);
    mapa.set(String(k),{
      produtoId:String(k),produtoNomeSnapshot:item.produto||cad.nome||String(k),
      categoria:meta.categoria||cad.categoria||cad.classificacao||'',fornecedor:vinc?.fornecedorNome||cad.fornecedorPadrao||cad.fornecedor||'',fornecedorId:vinc?.fornecedorId||'',
      // PEDIDO AO VIVO (2026-10-01): item.coberturaDias vem floorado em 0
      // (construirVisao) — recalcula sem o piso aqui, na origem deste
      // catálogo (só alimenta a tela de montar lote, nada de ordenação
      // depende disso), pra mostrar os dias negativos de verdade.
      coberturaDias:item.consumoDia>0?item.estoqueDisponivel/item.consumoDia:null,estoque:item.estoqueDisponivel,consumoDia:item.consumoDia,necessidade:item.necessidade,eventos:item.eventos||[],
      entradasPrevistas:item.entradasPrevistas||0,producaoProgramada:item.producaoProgramada||0,
      loteMinimoCompra:Math.max(0,n(vinc?.quantidadeMinima||cad.loteMinimoCompra)),multiploCompra:Math.max(1,n(vinc?.multiplo||cad.multiploCompra)||1),leadTimeFornecedorDias:Math.max(0,n(vinc?.leadTimeDias))
    });
  });
  return [...mapa.values()].sort((a,b)=>String(a.produtoNomeSnapshot).localeCompare(String(b.produtoNomeSnapshot),'pt-BR'));
}
function _loteCatalogoCategoria(cat){
  if(cat==='materia-prima'||cat==='insumos'){
    const grupo=cat==='materia-prima'?'materia-prima':'insumo';
    return (_insumosBi||[]).filter(x=>x.grupo===grupo&&_ativoNoCadastroUnico(x.cod,true)).map(x=>{
      const cad=resolverCadastroProduto(String(x.cod||''));
      const eventos=agend.filter(a=>keyOf(a)===String(x.cod||'')&&!/cancel|final|conclu/i.test(String(a.status||''))&&a.dataPrevista)
        .map(a=>({data:a.dataPrevista,tipo:'entrada',delta:Math.max(0,n(a.quantidade)-n(a.quantidadeRecebida))})).filter(ev=>ev.delta>0);
      const vinc=_vinculoFornecedorProduto(String(x.cod||''));
      return {produtoId:x.cod,produtoNomeSnapshot:x.produto,categoria:x.tipo||x.categoria||'',fornecedor:vinc?.fornecedorNome||x.fornecedor||cad.fornecedorPadrao||cad.fornecedor||'',fornecedorId:vinc?.fornecedorId||'',coberturaDias:x.coberturaDias,estoque:x.estoque,consumoDia:x.consumoDia,necessidade:x.necessidade,eventos,
        loteMinimoCompra:Math.max(0,n(vinc?.quantidadeMinima||cad.loteMinimoCompra)),multiploCompra:Math.max(1,n(vinc?.multiplo||cad.multiploCompra)||1),leadTimeFornecedorDias:Math.max(0,n(vinc?.leadTimeDias))};
    });
  }
  if(cat==='produto-acabado')return _catalogoProdutoAcabadoCompleto();
  return [];
}
function _loteParcelas(l){
  if(Array.isArray(l?.parcelas)&&l.parcelas.length)return l.parcelas;
  const datas=(l?.datas&&l.datas.length?l.datas:['']);
  return datas.map((data,i)=>({data,quantidade:i===0?(l?.quantidade||''):''}));
}
function _loteSincronizarForm(){
  loteLinhas.forEach((l,idx)=>{
    l.parcelas=_loteParcelas(l).map((p,di)=>({
      data:document.getElementById('lote-data-'+idx+'-'+di)?.value??p.data??'',
      quantidade:document.getElementById('lote-qtd-'+idx+'-'+di)?.value??p.quantidade??''
    }));
    l.datas=l.parcelas.map(p=>p.data);
    l.quantidade=l.parcelas.length===1?l.parcelas[0].quantidade:'';
  });
}
function _loteDiasAte(data){
  if(!data)return null;
  const hoje=new Date();hoje.setHours(0,0,0,0);
  const alvo=new Date(String(data)+'T00:00:00');
  if(Number.isNaN(alvo.getTime()))return null;
  return Math.max(0,Math.ceil((alvo-hoje)/86400000));
}
function _loteCoberturaNaChegada(l,di){
  const consumoDia=n(l?.consumoDia),estoque=n(l?.estoque),parcelas=_loteParcelas(l);
  if(!(consumoDia>0)||!parcelas[di]?.data)return null;
  // O preview usa a mesma regra do salvar: datas fora de ordem não geram
  // uma cobertura aparentemente válida. Assim o usuário enxerga o erro antes
  // de tentar confirmar o lote.
  const datas=parcelas.map(p=>String(p?.data||'')).filter(Boolean);
  if(datas.some((d,i)=>i>0&&d<datas[i-1]))return {erro:'datas_fora_ordem'};
  const dias=_loteDiasAte(parcelas[di].data);if(dias==null)return null;
  let recebido=0;for(let i=0;i<=di;i++)recebido+=Math.max(0,n(parcelas[i]?.quantidade));
  // Considera suprimentos já programados antes da data escolhida. O estoque
  // inicial do catálogo é o disponível (reservas já descontadas), portanto
  // só somamos eventos positivos para não descontar a mesma demanda duas vezes.
  const limite=String(parcelas[di].data||'');
  const suprimentoExistente=(l?.eventos||[]).filter(ev=>n(ev?.delta)>0&&ev?.data&&String(ev.data)<=limite).reduce((s,ev)=>s+n(ev.delta),0);
  const saldoProjetado=estoque-(consumoDia*dias)+suprimentoExistente+recebido;
  return {diasCobertura:saldoProjetado/consumoDia,saldoProjetado,diasAte:dias,recebidoAcumulado:recebido,suprimentoExistente};
}
function _loteCoberturaTexto(l,di){
  const c=_loteCoberturaNaChegada(l,di);if(!c)return '—';
  if(c.erro==='datas_fora_ordem')return '⚠ datas fora de ordem';
  return c.diasCobertura.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'d';
}
function _loteAtualizarCoberturasDOM(idx){
  _loteSincronizarForm();const l=loteLinhas[idx];if(!l)return;
  _loteParcelas(l).forEach((_,di)=>{const el=document.querySelector(`[data-lote-cobertura="${idx}|${di}"]`);if(el)el.textContent=_loteCoberturaTexto(l,di);});
}
function _loteRoteamentoHtml(){
  if(!loteLinhas.length)return '';
  const grupos=new Map();
  loteLinhas.forEach(l=>{const forn=l.fornecedor||'Fornecedor a definir por Compras';const arr=grupos.get(forn)||[];arr.push(l.produtoNome);grupos.set(forn,arr);});
  return `<div class="tc" style="padding:10px 12px;margin-top:12px"><b style="font-size:.76rem">Organização prevista por fornecedor</b><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${[...grupos].map(([forn,itens])=>`<span class="badge b-blue" title="${esc(itens.join(', '))}">${esc(forn)} · ${itens.length} item(ns)</span>`).join('')}</div></div>`;
}
function modalSolicLoteHtml(){
  const categoria=loteFornecedorId||'';
  const opcoes=`<option value="">Selecione a categoria...</option><option value="insumos" ${categoria==='insumos'?'selected':''}>Insumos / embalagens</option><option value="materia-prima" ${categoria==='materia-prima'?'selected':''}>Matéria-prima</option><option value="produto-acabado" ${categoria==='produto-acabado'?'selected':''}>Produto acabado</option>`;
  const disponiveis=loteProdutosFornecedor.filter(p=>!loteLinhas.some(l=>String(l.produtoId)===String(p.produtoId)));
  const linhas=loteLinhas.map((l,idx)=>{
    const parcelas=_loteParcelas(l).map((p,di)=>`<div style="display:grid;grid-template-columns:150px 105px 90px auto;gap:5px;align-items:center;margin-bottom:5px"><input class="field" type="date" id="lote-data-${idx}-${di}" data-lote-parcela="${idx}|${di}" value="${esc(p.data||'')}"><input class="field" type="number" min="0" step="any" id="lote-qtd-${idx}-${di}" data-lote-parcela="${idx}|${di}" value="${esc(p.quantidade??'')}" placeholder="Qtd."><span class="badge b-blue" data-lote-cobertura="${idx}|${di}" title="Cobertura projetada após esta chegada">${_loteCoberturaTexto(l,di)}</span>${di===0?`<button type="button" class="btn btn-ghost btn-sm" data-lote-add-data="${idx}" title="Adicionar outra data e quantidade">+ data</button>`:`<button type="button" class="acao-lapis" data-lote-remover-data="${idx}|${di}" title="Remover data/quantidade">✕</button>`}</div>`).join('');
    return `<tr><td><b>${esc(l.produtoNome)}</b><small style="display:block;color:var(--muted)">${esc(l.categoria||'')}</small></td><td>${esc(l.fornecedor||'A definir')}</td><td>${l.estoque!=null?qtdReal(l.estoque).toLocaleString('pt-BR'):'—'}</td><td>${l.coberturaDias==null?'—':Number(l.coberturaDias).toFixed(1)+'d'}</td><td>${parcelas}<small style="display:block;color:var(--muted);margin-top:3px">Cada data tem sua quantidade. A cobertura considera o consumo até a chegada e soma as quantidades das datas anteriores.</small></td><td><button type="button" class="acao-lapis" data-lote-remover-linha="${idx}">🗑️</button></td></tr>`;
  }).join('');
  // PEDIDO AO VIVO (2026-10-01): "quando coloco muito produto... não tem
  // uma barra de rolagem... não consigo fazer nada nem preencher todas as
  // datas" — .modal-card não tinha altura máxima (só .modal-body tinha
  // overflow-y:auto, que é inofensivo sem um teto pra estourar); com
  // muitos produtos/datas o card crescia pra fora da tela, incluindo o
  // botão "Criar solicitações" no rodapé. max-height+overflow:auto aqui
  // é o mesmo padrão já usado em modalMemoria (🧮 Relatório do Produto).
  return `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:1180px;max-height:90vh;overflow:auto"><div class="modal-header"><div><b>Nova solicitação de compra</b><small>Selecione a categoria e os itens. Para cada data informe a quantidade; a cobertura projetada é recalculada em sequência.</small></div><button class="modal-x" data-pcp-modal-close>×</button></div><div class="modal-body"><div style="display:grid;grid-template-columns:220px 1fr;gap:8px;margin-bottom:12px"><select class="field" id="lote-fornecedor">${opcoes}</select>${categoria?`<div style="display:grid;grid-template-columns:1fr auto;gap:6px"><input class="field" id="lote-add-produto-busca" list="lote-produtos-sugestoes" autocomplete="off" placeholder="Digite o nome ou código do produto/material..."><datalist id="lote-produtos-sugestoes">${disponiveis.map(p=>`<option value="${esc(p.produtoNomeSnapshot)}">${esc(p.produtoId)}</option>`).join('')}</datalist><button type="button" class="btn btn-ghost" data-lote-add-produto-busca>Adicionar</button></div>`:'<div></div>'}</div>${categoria?`<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto / material</th><th>Fornecedor</th><th>Estoque</th><th>Cobertura atual</th><th>Data / quantidade / cobertura na chegada</th><th></th></tr></thead><tbody>${linhas||'<tr><td colspan="6">Adicione os itens que deseja solicitar.</td></tr>'}</tbody></table></div>${_loteRoteamentoHtml()}`:'<div class="empty" style="padding:16px">Escolha uma categoria para começar.</div>'}</div><div class="modal-footer"><button class="btn btn-ghost" data-pcp-modal-close>Cancelar</button>${loteLinhas.length?'<button class="btn btn-primary" data-lote-salvar>Criar solicitações</button>':''}</div></div></div>`;
}
async function loteSelecionarFornecedor(categoria){
  _loteSincronizarForm();loteFornecedorId=categoria;loteLinhas=[];
  await _garantirCatalogosSolicitacao(categoria);
  loteProdutosFornecedor=_loteCatalogoCategoria(categoria);
  const host=document.getElementById('pcp-modal-host');if(host)host.innerHTML=modalSolicLoteHtml();
}
function _ajustarQuantidadeCompraCatalogo(p){
  const necessidade=Math.max(0,n(p?.necessidade));if(!(necessidade>0))return '';
  const minimo=Math.max(0,n(p?.loteMinimoCompra)),multiplo=Math.max(1,n(p?.multiploCompra)||1);
  return Math.ceil(Math.max(necessidade,minimo)/multiplo)*multiplo;
}
function loteAdicionarProduto(produtoId){_loteSincronizarForm();const p=loteProdutosFornecedor.find(x=>String(x.produtoId)===String(produtoId));if(!p||loteLinhas.some(l=>String(l.produtoId)===String(produtoId)))return;loteLinhas.push({produtoId:p.produtoId,produtoNome:p.produtoNomeSnapshot||p.produtoId,categoria:p.categoria||'',fornecedor:p.fornecedor||'',estoque:p.estoque,coberturaDias:p.coberturaDias,consumoDia:p.consumoDia,necessidade:p.necessidade,eventos:p.eventos||[],parcelas:[{data:'',quantidade:_ajustarQuantidadeCompraCatalogo(p)}]});const host=document.getElementById('pcp-modal-host');if(host)host.innerHTML=modalSolicLoteHtml();}
function loteAdicionarProdutoBusca(valor){
  const busca=norm(valor);if(!busca)return false;
  const disponiveis=loteProdutosFornecedor.filter(p=>!loteLinhas.some(l=>String(l.produtoId)===String(p.produtoId)));
  let encontrados=disponiveis.filter(p=>norm(p.produtoNomeSnapshot)===busca||norm(p.produtoId)===busca);
  if(!encontrados.length)encontrados=disponiveis.filter(p=>norm(p.produtoNomeSnapshot).includes(busca)||norm(p.produtoId).includes(busca));
  if(encontrados.length!==1){global.showToast?.(encontrados.length?'Há mais de um produto com esse texto. Continue digitando ou escolha uma sugestão.':'Produto/material não encontrado nesta categoria.','warning');return false;}
  loteAdicionarProduto(encontrados[0].produtoId);return true;
}
function loteRemoverLinha(idx){_loteSincronizarForm();loteLinhas.splice(idx,1);const host=document.getElementById('pcp-modal-host');if(host)host.innerHTML=modalSolicLoteHtml();}
function loteAdicionarData(idx){_loteSincronizarForm();const l=loteLinhas[idx];if(!l)return;l.parcelas=_loteParcelas(l);l.parcelas.push({data:'',quantidade:''});const host=document.getElementById('pcp-modal-host');if(host)host.innerHTML=modalSolicLoteHtml();}
function loteRemoverData(idx,di){_loteSincronizarForm();const l=loteLinhas[idx];if(!l)return;l.parcelas=_loteParcelas(l);if(l.parcelas.length<=1)return;l.parcelas.splice(di,1);const host=document.getElementById('pcp-modal-host');if(host)host.innerHTML=modalSolicLoteHtml();}
async function loteSalvar(){
  if(!tem('criar')||!loteLinhas.length)return;
  _loteSincronizarForm();
  let criadas=0,semComprador=0;const erros=[];
  for(const l of loteLinhas){
    const parcelas=_loteParcelas(l);
    const datasValidas=parcelas.map(p=>p.data).filter(Boolean);
    if(datasValidas.some((d,i)=>i>0&&d<datasValidas[i-1])){erros.push(l.produtoNome+' · datas fora de ordem');continue;}
    for(const parcela of parcelas){
      const q=Math.max(0,n(parcela.quantidade)),data=parcela.data||'';
      if(q<=0||!data){erros.push(l.produtoNome);continue;}
      try{const r=await _criarRequisicaoCompra(l.produtoId,l.produtoNome,{quantidade:q,dataNecessaria:data,prioridade:'normal',motivo:'Solicitação por categoria — '+l.categoria,fornecedorNome:l.fornecedor||'',categoria:l.categoria||''});criadas++;if(!r.compradorUid)semComprador++;}
      catch(e){erros.push(l.produtoNome+' · '+data);}
    }
  }
  const host=document.getElementById('pcp-modal-host');if(host)host.innerHTML='';await carregar(true);desenhar();
  global.showToast?.(`${criadas} solicitação(ões) criada(s)${semComprador?' · '+semComprador+' sem comprador':''}${erros.length?' · '+erros.length+' com pendência':''}.`,erros.length?'warning':'success');
}

async function salvarSolic(tipo){if(!tem('criar'))return;const key=document.getElementById('pcp-s-key')?.value||'',lojaRef=document.getElementById('pcp-s-loja')?.value||filtros.loja||global.getDTLojaAtiva?.()||'',produto=document.getElementById('pcp-s-prod')?.value.trim()||'',q=Math.max(0,n(document.getElementById('pcp-s-qtd')?.value)),data=document.getElementById('pcp-s-data')?.value||'',destino=document.getElementById('pcp-s-dest')?.value.trim()||'',prioridade=document.getElementById('pcp-s-prio')?.value||'normal',obs=document.getElementById('pcp-s-obs')?.value.trim()||'';if(!produto||q<=0||!data){global.showToast?.('Informe produto, quantidade e data.','warning');return;}if(tipo==='compra'){const roteamento=await _criarRequisicaoCompra(key,produto,{quantidade:q,dataNecessaria:data,destino,prioridade,motivo:obs,lojaId:lojaRef});if(!roteamento.compradorUid)global.showToast?.('Requisição criada, mas não existe regra de comprador para este produto/categoria/fornecedor.','warning');}else {const base={produto,prodKey:key,quantidade:q,dataNecessaria:data,destino,prioridade,criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||'',pcpResponsavel:global._currentAnalistaUser?.email||'',pcpUid:global._currentAnalistaUser?.uid||''};const prod=resolverCadastroProduto(key,{lojaId:lojaRef})||{},lojaId=String(lojaRef||'');const empresaProdutoraId=String(prod.empresaProdutoraId||''),empresaProdutoraNome=String(prod.empresaProdutoraNome||'');await raw().collection(CPRODREQ).add({...base,dataProgramada:data,observacao:obs,status:empresaProdutoraId?'solicitada':'sem_empresa_produtora',origem:'PCP',origemLojaId:lojaId,empresaProdutoraId,empresaProdutoraNome});if(!empresaProdutoraId)global.showToast?.('Solicitação criada, mas o produto não possui empresa produtora cadastrada nesta loja.','warning');}document.getElementById('pcp-modal-host').innerHTML='';await carregar(true);desenhar();}
// PEDIDO AO VIVO (2026-09-02): "colocar já alguma coisa que já envia
// automaticamente o pedido pra compras direto" — mesmos defaults que o
// modal já sugeria (quantidade=necessidade arredondada, motivo padrão,
// prioridade normal, data=hoje), sem abrir modal nenhum.
const MOTIVO_NECESSIDADE_PADRAO='Estoque insuficiente / saldo projetado negativo';
async function enviarNecessidadeDireto(key){
  if(!tem('criar'))return;
  const item=filtrarProdutosPlanejaveis(_visaoBaseMemo(true)).find(x=>x.key===key);
  if(!item||!(item.necessidade>0))return;
  try{
    const roteamento=await _criarRequisicaoCompra(key,item.produto,{quantidade:Math.ceil(item.necessidade),dataNecessaria:new Date().toISOString().slice(0,10),prioridade:'normal',motivo:MOTIVO_NECESSIDADE_PADRAO});
    global.showToast?.(roteamento.compradorUid?`Pedido enviado para ${roteamento.compradorNome||roteamento.compradorEmail}.`:'Pedido criado, mas sem comprador cadastrado pra esse produto/categoria/fornecedor.',roteamento.compradorUid?'success':'warning');
  }catch(e){global.showToast?.(e.message,'error');}
  await carregar(true);desenhar();
}
async function enviarTodasNecessidades(){
  if(!tem('criar'))return;
  const alvos=filtrarProdutosPlanejaveis(construirVisao({...dadosFiltrados(),estoqueBi:_estoqueBi})).filter(x=>x.necessidade>0&&!produzidoInternamente(x.key));
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
async function receberAgendamento(id){if(!tem('editar'))return;const x=agend.find(a=>a._id===id);if(!x)return;const agoraQtd=Math.max(0,n(document.getElementById('pcp-age-rec-qtd')?.value)),anterior=n(x.quantidadeRecebida),total=Math.min(n(x.quantidade),anterior+agoraQtd);if(agoraQtd<=0)return global.showToast?.('Informe a quantidade recebida.','warning');const final=total>=n(x.quantidade),st=final?'finalizada':'parcial',deltaRecebido=total-anterior;if(typeof global.aplicarEntradaEstoqueProducao!=='function')throw new Error('Motor de estoque da Produção indisponível.');await global.aplicarEntradaEstoqueProducao({prodKey:x.prodKey||x.cod||'',produto:x.produto||'',qtdCx:deltaRecebido,movimentoId:'compra_'+id+'_'+total,tipo:'recebimento_compra',origemId:id});await fs().collection(CAGE).doc(id).set({quantidadeRecebida:total,status:st,recebidoEm:now(),recebidoPor:global._currentAnalistaUser?.email||'',atualizadoEm:now()},{merge:true});if(x.requisicaoId)await fs().collection(CREQ).doc(x.requisicaoId).set({status:final?'finalizada':'parcial',quantidadeRecebida:total,atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true});document.getElementById('pcp-modal-host').innerHTML='';await carregar(true);desenhar();}
async function salvarAgendamento(){if(!tem('criar'))return;const pv=document.getElementById('pcp-age-prod')?.value,p=produtoByValue(pv),q=Math.max(0,n(document.getElementById('pcp-age-qtd')?.value)),fornecedor=document.getElementById('pcp-age-forn')?.value.trim()||'',data=document.getElementById('pcp-age-data')?.value||'',num=document.getElementById('pcp-age-compra')?.value.trim()||'';if(!p.nome||q<=0||!data)return global.showToast?.('Informe produto, quantidade e data.','warning');await fs().collection(CAGE).add({cod:p.cod||'',produto:p.nome,fornecedor,quantidade:q,quantidadeRecebida:0,dataPrevista:data,numeroCompra:num,status:'prevista',criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||''});_buscaPedido=null;_buscaPedidoErro='';await carregar(true);desenhar();}
async function excluir(tipo,id){if(!tem('excluir')||!confirm('Excluir este registro do PCP?'))return;const col=tipo==='pedido'?CPED:null;if(!col)return;await fs().collection(col).doc(id).delete();await carregar(true);desenhar();}
function desenhar(){
  const p=document.getElementById('page-pcp-central');if(!p)return;
  if(aba==='insumos'){
    const vi=_insumosBi||[],necIns=vi.filter(x=>x.necessidade>0).length;
    p.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">🧱 Insumos</div><div style="font-size:.74rem;color:var(--muted)">Somente matéria-prima, embalagens e insumos · estoque, consumo, cobertura e necessidade${_ultimaBuscaInsumosBi?' · '+esc(_ultimaBuscaInsumosBi):''}</div></div><div style="display:flex;gap:8px">${global.DTBiPastaLocal?.suportado?.()?'<button class="btn btn-ghost btn-sm" data-pcp-buscar-insumos-bi>📊 Atualizar BI</button>':''}<button class="btn btn-ghost btn-sm" data-pcp-refresh>↻ Atualizar</button></div></div><div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${vi.length}</div><div class="kpi-lbl">Materiais</div></div><div class="kpi orange"><div class="kpi-val">${necIns}</div><div class="kpi-lbl">Com necessidade</div></div></div>${insumosHtml(vi)}`;
    return;
  }
  const usaBi=aba==='planejamento'||aba==='producao';
  if(aba==='planejamento'){
    const transf=_sugestoesTransferenciaMemo();
    _transferenciasPlanejamento=new Map();
    transf.forEach(t=>{const arr=_transferenciasPlanejamento.get(t.key)||[];arr.push(t);_transferenciasPlanejamento.set(t.key,arr);});
  }
  const v=aba==='planejamento'?aplicarOrdenacao(visaoFiltrada()):_visaoBaseMemo(aba==='producao');
  const falta=v.filter(x=>x.necessidade>0).length,pend=v.reduce((sum,x)=>sum+n(x.pendente),0),saldo=v.reduce((sum,x)=>sum+n(x.saldo),0);
  p.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">${aba==='planejamento'?'📦 Planejamento':'📋 PCP — Central de Planejamento'}</div><div style="font-size:.74rem;color:var(--muted)">${aba==='planejamento'?'Uma única visão para estoque, pedidos, saldo, cobertura, necessidade e ação recomendada':'Execução do planejamento'}${usaBi&&_ultimaBuscaEstoqueBi?' · '+esc(_ultimaBuscaEstoqueBi):''}</div></div><div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" data-pcp-refresh>🔄 Buscar</button></div></div><div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${qtd(pend).toLocaleString('pt-BR')}</div><div class="kpi-lbl">Pedidos pendentes</div></div><div class="kpi orange"><div class="kpi-val">${falta}</div><div class="kpi-lbl">Produtos com necessidade</div></div><div class="kpi teal"><div class="kpi-val">${reqs.filter(x=>!/final|cancel|rejeit/i.test(String(x.status||''))).length}</div><div class="kpi-lbl">Requisições abertas</div></div><div class="kpi green"><div class="kpi-val">${Math.ceil(saldo).toLocaleString('pt-BR')}</div><div class="kpi-lbl">Saldo projetado total</div></div></div><div>${aba==='pedidos'?pedidosHtml():aba==='planejamento'?estoqueHtml(v):aba==='agendamentos'?agendHtml():prodReqHtml(v)}</div>`;
}
// PEDIDO AO VIVO (2026-10-01): "não tem como vir a estrutura e ter um
// botão ali de buscar... vim toda a estrutura, não vim o estoque" — antes,
// render() trocava a tela inteira por um placeholder de texto genérico até
// TODO o carregar() do Firestore terminar, só então desenhar() pintava
// cabeçalho/KPIs/tabela de uma vez. Agora render() pinta uma "casca" leve
// (mesmo cabeçalho/botão/grade de KPI/cabeçalho de tabela, com "…" e uma
// linha "Carregando…" no lugar dos dados) de forma SÍNCRONA, antes do
// primeiro await — o navegador já pinta isso antes de carregar() suspender
// — e desenhar() (inalterada) sobrescreve a casca com o conteúdo real
// quando os dados chegam. Cada _shellX() espelha o <thead>/KPIs da função
// de pintura final correspondente (estoqueHtml/insumosHtml/pedidosHtml) —
// se uma coluna mudar lá, ajustar aqui também.
function _shellLinha(colspan){return `<tr><td colspan="${colspan}" style="text-align:center;color:var(--muted)">Carregando…</td></tr>`;}
function _shellPlanejamento(){
  return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">📦 Planejamento</div><div style="font-size:.74rem;color:var(--muted)">Uma única visão para estoque, pedidos, saldo, cobertura, necessidade e ação recomendada</div></div><div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" data-pcp-refresh>🔄 Buscar</button></div></div><div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">…</div><div class="kpi-lbl">Pedidos pendentes</div></div><div class="kpi orange"><div class="kpi-val">…</div><div class="kpi-lbl">Produtos com necessidade</div></div><div class="kpi teal"><div class="kpi-val">…</div><div class="kpi-lbl">Requisições abertas</div></div><div class="kpi green"><div class="kpi-val">…</div><div class="kpi-lbl">Saldo projetado total</div></div></div><div>${filtrosHtml()}<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr>${th('produto','Produto')}${th('estoqueAtual','Estoque')}${th('pendente','Pedidos')}${th('saldo','Saldo')}${th('coberturaDias','Cobertura')}${th('necessidade','Necessidade')}<th>Ação recomendada</th><th>Data limite</th><th></th></tr></thead><tbody>${_shellLinha(9)}</tbody></table></div></div></div>`;
}
function _shellInsumos(){
  return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">🧱 Insumos</div><div style="font-size:.74rem;color:var(--muted)">Somente matéria-prima, embalagens e insumos · estoque, consumo, cobertura e necessidade</div></div><div style="display:flex;gap:8px">${global.DTBiPastaLocal?.suportado?.()?'<button class="btn btn-ghost btn-sm" data-pcp-buscar-insumos-bi>📊 Atualizar BI</button>':''}<button class="btn btn-ghost btn-sm" data-pcp-refresh>↻ Atualizar</button></div></div><div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">…</div><div class="kpi-lbl">Materiais</div></div><div class="kpi orange"><div class="kpi-val">…</div><div class="kpi-lbl">Com necessidade</div></div></div><div class="tc" style="padding:10px;margin-bottom:10px"><div style="display:grid;grid-template-columns:minmax(220px,1.6fr) repeat(3,minmax(150px,1fr)) auto;gap:7px"><input class="field" data-pcp-ins-filtro="busca" placeholder="Pesquisar código ou material..."><select class="field" data-pcp-ins-filtro="loja"><option value="">Todas as lojas (consolidado)</option></select><select class="field" data-pcp-ins-filtro="grupo"><option value="">Matéria-prima + insumos</option><option value="materia-prima">Matéria-prima</option><option value="insumo">Insumos / embalagens</option></select><select class="field" data-pcp-ins-filtro="tipo"><option value="">Todos os tipos</option></select><button class="btn btn-ghost btn-sm" data-pcp-ins-limpar>Limpar</button></div></div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Código</th><th>Material</th><th>Grupo</th><th>Tipo</th><th>Estoque</th><th>Consumo mensal</th><th>Cobertura</th><th>Meta</th><th></th></tr></thead><tbody>${_shellLinha(9)}</tbody></table></div></div>`;
}
function _shellPedidos(){
  const tabsShell=[['solicitar','Solicitar'],['minhas','Minhas solicitações'],['mes','Este mês'],['historico','Histórico']].map(([id,nome])=>`<button class="btn ${solicitacoesVisao===id?'btn-primary':'btn-ghost'} btn-sm" data-pcp-solic-visao="${id}">${nome}</button>`).join('');
  const topo=`<div class="tc" style="padding:12px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><b>Solicitação de Compra</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Acompanhe o que o PCP solicitou, o que Compras já executou e alterações de data/quantidade/cancelamento.</div></div>${tem('criar')?'<button class="btn btn-primary btn-sm" data-pcp-lote-abrir>+ Nova solicitação</button>':''}</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${tabsShell}</div></div>`;
  const resumo=`<div class="kpi-grid" style="margin-bottom:12px"><div class="kpi blue"><div class="kpi-val">…</div><div class="kpi-lbl">Solicitadas para este mês</div></div><div class="kpi orange"><div class="kpi-val">…</div><div class="kpi-lbl">Ainda não compradas</div></div><div class="kpi green"><div class="kpi-val">…</div><div class="kpi-lbl">Com compra registrada</div></div><div class="kpi teal"><div class="kpi-val">…</div><div class="kpi-lbl">Alterações aguardando Compras</div></div><div class="kpi red"><div class="kpi-val">…</div><div class="kpi-lbl">Canceladas no mês</div></div></div>`;
  const tabela=`<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Solicitado</th><th>Comprado</th><th>Pendente</th><th>Data necessária</th><th>Destino</th><th>Comprador</th><th>Status</th><th>Alteração PCP</th><th>Ações</th></tr></thead><tbody>${_shellLinha(10)}</tbody></table></div></div>`;
  return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">📋 PCP — Central de Planejamento</div><div style="font-size:.74rem;color:var(--muted)">Execução do planejamento</div></div><div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" data-pcp-refresh>🔄 Buscar</button></div></div><div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">…</div><div class="kpi-lbl">Pedidos pendentes</div></div><div class="kpi orange"><div class="kpi-val">…</div><div class="kpi-lbl">Produtos com necessidade</div></div><div class="kpi teal"><div class="kpi-val">…</div><div class="kpi-lbl">Requisições abertas</div></div><div class="kpi green"><div class="kpi-val">…</div><div class="kpi-lbl">Saldo projetado total</div></div></div><div>${topo}${resumo}${tabela}</div>`;
}
function _pcpShellAtual(){
  if(aba==='planejamento')return _shellPlanejamento();
  if(aba==='insumos')return _shellInsumos();
  if(aba==='pedidos')return _shellPedidos();
  return '<div class="empty">Carregando PCP...</div>';
}
async function render(){const p=document.getElementById('page-pcp-central');if(!p)return;p.innerHTML=_pcpShellAtual();try{await carregar(true);desenhar();}catch(e){p.innerHTML='<div class="empty">Falha ao carregar PCP: '+esc(e.message||e)+'</div>';}}
document.addEventListener('click',e=>{if(e.target.closest('[data-pcp-limpar-filtros]')){filtros={loja:'',busca:'',marca:'',categoria:'',situacao:'',acao:'',ocultarZerados:true};desenhar();return;}const sortTh=e.target.closest('[data-pcp-sort]');if(sortTh){pcpOrdenarPor(sortTh.dataset.pcpSort);return;}const btnRefresh=e.target.closest('[data-pcp-refresh]');if(btnRefresh){pcpAtualizarComSync(btnRefresh);return;}if(e.target.closest('[data-pcp-buscar-insumos-bi]')){buscarInsumosBi();return;}if(e.target.closest('[data-pcp-ped-save]')){salvarPedido().catch(x=>global.showToast?.(x.message,'error'));return;}const at=e.target.closest('[data-pcp-ped-atender]');if(at){atenderPedido(at.dataset.pcpPedAtender).catch(x=>global.showToast?.(x.message,'error'));return;}const rq=e.target.closest('[data-pcp-req-prod]');if(rq){modalSolic('compra',rq.dataset.pcpReqProd);return;}const ne=e.target.closest('[data-pcp-nec-enviar]');if(ne){enviarNecessidadeDireto(ne.dataset.pcpNecEnviar).catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-pcp-nec-enviar-todos]')){enviarTodasNecessidades().catch(x=>global.showToast?.(x.message,'error'));return;}const sp=e.target.closest('[data-pcp-prod-prod]');if(sp){modalSolic('producao',sp.dataset.pcpProdProd,sp.dataset.pcpProdLoja||'');return;}const sv=e.target.closest('[data-pcp-s-save]');if(sv){salvarSolic(sv.dataset.pcpSSave).catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-pcp-age-save]')){salvarAgendamento().catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-pcp-age-buscar]')){buscarPedidoAgendaBluesoft();return;}const usar=e.target.closest('[data-pcp-age-usar]');if(usar){usarItemBuscaPedidoAgenda(Number(usar.dataset.pcpAgeUsar));return;}const ar=e.target.closest('[data-pcp-age-receber]');if(ar){modalRecebimentoAgendamento(ar.dataset.pcpAgeReceber);return;}const ars=e.target.closest('[data-pcp-age-rec-save]');if(ars){receberAgendamento(ars.dataset.pcpAgeRecSave).catch(x=>global.showToast?.(x.message,'error'));return;}const del=e.target.closest('[data-pcp-del]');if(del){const [tipo,id]=del.dataset.pcpDel.split('|');excluir(tipo,id).catch(x=>global.showToast?.(x.message,'error'));return;}const mem=e.target.closest('[data-pcp-memoria]');if(mem){modalMemoria(mem.dataset.pcpMemoria);return;}const svw=e.target.closest('[data-pcp-solic-visao]');if(svw){solicitacoesVisao=svw.dataset.pcpSolicVisao||'solicitar';desenhar();return;}const rh=e.target.closest('[data-pcp-req-hist]');if(rh){abrirHistoricoSolicitacao(rh.dataset.pcpReqHist);return;}const rp=e.target.closest('[data-pcp-req-postergar]');if(rp){abrirAlteracaoSolicitacao(rp.dataset.pcpReqPostergar,'postergacao');return;}const rqtd=e.target.closest('[data-pcp-req-qtd]');if(rqtd){abrirAlteracaoSolicitacao(rqtd.dataset.pcpReqQtd,'quantidade');return;}const rc=e.target.closest('[data-pcp-req-cancelar]');if(rc){abrirAlteracaoSolicitacao(rc.dataset.pcpReqCancelar,'cancelamento');return;}const ras=e.target.closest('[data-pcp-req-alt-save]');if(ras){const [id,tipo]=ras.dataset.pcpReqAltSave.split('|');salvarAlteracaoSolicitacao(id,tipo).catch(x=>global.showToast?.(x.message||x,'error'));return;}if(e.target.closest('[data-pcp-modal-close]')){const h=document.getElementById('pcp-modal-host');if(h)h.innerHTML='';return;}
  if(e.target.closest('[data-pcp-ins-limpar]')){filtrosInsumos={loja:'',grupo:'',tipo:'',busca:''};if(_insumosBiRaw)_insumosBi=_juntarInsumosBi(_insumosBiRaw);desenhar();return;}
  if(e.target.closest('[data-pcp-lote-abrir]')){abrirModalSolicLote().catch(x=>global.showToast?.(x.message,'error'));return;}
  const remLinha=e.target.closest('[data-lote-remover-linha]');if(remLinha){loteRemoverLinha(Number(remLinha.dataset.loteRemoverLinha));return;}
  const addData=e.target.closest('[data-lote-add-data]');if(addData){loteAdicionarData(Number(addData.dataset.loteAddData));return;}
  const remData=e.target.closest('[data-lote-remover-data]');if(remData){const [idx,di]=remData.dataset.loteRemoverData.split('|').map(Number);loteRemoverData(idx,di);return;}
  if(e.target.closest('[data-lote-add-produto-busca]')){const inp=document.getElementById('lote-add-produto-busca');if(inp&&loteAdicionarProdutoBusca(inp.value))inp.value='';return;}
  if(e.target.closest('[data-lote-salvar]')){loteSalvar().catch(x=>global.showToast?.(x.message,'error'));return;}
});
document.addEventListener('change',e=>{const el=e.target.closest('[data-pcp-filtro]');if(el){filtros[el.dataset.pcpFiltro]=el.value;if(el.dataset.pcpFiltro==='loja')_recalcularEstoqueBiPorLoja();desenhar();return;}const chk=e.target.closest('[data-pcp-filtro-check]');if(chk){filtros[chk.dataset.pcpFiltroCheck]=chk.checked;desenhar();return;}
  if(e.target.id==='lote-fornecedor'){loteSelecionarFornecedor(e.target.value).catch(x=>global.showToast?.(x.message,'error'));return;}
  if(e.target.id==='lote-add-produto'){if(e.target.value)loteAdicionarProduto(e.target.value);return;}
  if(e.target.id==='lote-add-produto-busca'){loteAdicionarProdutoBusca(e.target.value);return;}
});
document.addEventListener('click',e=>{const b=e.target.closest('[data-pcp-mem-save]');if(b)salvarCoberturaMemoria(b.dataset.pcpMemSave).catch(x=>global.showToast?.(x.message||String(x),'error'));});
document.addEventListener('input',e=>{const parcela=e.target.closest('[data-lote-parcela]');if(parcela){const idx=Number(String(parcela.dataset.loteParcela||'').split('|')[0]);_loteAtualizarCoberturasDOM(idx);return;}});
document.addEventListener('keydown',e=>{if(e.target?.id==='lote-add-produto-busca'&&e.key==='Enter'){e.preventDefault();if(loteAdicionarProdutoBusca(e.target.value))e.target.value='';}});
document.addEventListener('input',e=>{const el=e.target.closest('[data-pcp-filtro="busca"]');if(el){filtros.busca=el.value;clearTimeout(global.__pcpFiltroTimer);global.__pcpFiltroTimer=setTimeout(()=>_redesenharComFoco('[data-pcp-filtro="busca"]'),220);}});
function pcpGetAbaAtual(){return aba;}
global.pcpGetAbaAtual=pcpGetAbaAtual;
document.addEventListener('input',e=>{if(e.target?.dataset?.pcpInsFiltro==='busca'){filtrosInsumos.busca=e.target.value;clearTimeout(global.__pcpInsumoFiltroTimer);global.__pcpInsumoFiltroTimer=setTimeout(()=>_redesenharComFoco('[data-pcp-ins-filtro="busca"]'),220);}});
document.addEventListener('change',e=>{if(e.target?.dataset?.pcpInsFiltro){const k=e.target.dataset.pcpInsFiltro;filtrosInsumos[k]=e.target.value;if(k==='loja'&&_insumosBiRaw)_insumosBi=_juntarInsumosBi(_insumosBiRaw,null,filtrosInsumos.loja);desenhar();}});
global.renderPCPCentral=render;global.pcpIrParaAba=pcpIrParaAba;global.pcpRegistrarPagina=pcpRegistrarPagina;global.modalMemoria=modalMemoria;global._pcpInternals={construirVisao,dadosFiltrados,dadosConsolidadosTodasLojas:_dadosConsolidadosTodasLojas,keyOf,norm,resolverCadastroProduto,resolverComprador,memoriaDeCalculo,carregar,getReqs:()=>reqs,getAgend:()=>agend,getProdutos:()=>produtos,getProjecao:()=>projecao,getLojas:()=>lojas,_juntarEstoqueBi,_recalcularEstoqueBiPorLoja,calcularSugestoesTransferencia,_alocarTransferencias,buscarEstoqueBi,getEstoqueBi:()=>_estoqueBi,getEscadinhaBiRaw:()=>_escadinhaBiRaw,setEstoqueBi:v=>{_estoqueBi=v;invalidarVisao();},setAba:v=>{aba=v;},produzidoInternamente,produzidoInternamenteNaLoja,aliasesProduto,_quantidadeProducaoAjustada,_juntarInsumosBi,buscarInsumosBi,getInsumosBi:()=>_insumosBi,getInsumosBiRaw:()=>_insumosBiRaw,setInsumosBi:v=>{_insumosBi=v;},insumosHtml,cruzamentoHtml,_criarRequisicaoCompra,enviarNecessidadeDireto,enviarTodasNecessidades,_categoriaDoNome,metaProduto,filtrarProdutosPlanejaveis,itemCriticoPlanejamento,visaoFiltrada,filtrosHtml,setProdutos:v=>{produtos=v;invalidarVisao();},getFiltros:()=>filtros,setFiltros:v=>{filtros={...filtros,...v};},invalidarVisao,_visaoBaseMemo,getVisaoCalcCount:()=>_visaoCalcCount,comprasHtml,getUltimaBuscaInsumosBi:()=>_ultimaBuscaInsumosBi,estoqueHtml,prodReqHtml,setSolProd:v=>{solProd=v;},abrirModalSolicLote,loteSelecionarFornecedor,loteAdicionarProduto,loteAdicionarProdutoBusca,loteRemoverLinha,loteAdicionarData,loteRemoverData,loteSalvar,_loteCoberturaNaChegada,_loteSincronizarForm,getLoteLinhas:()=>loteLinhas,getLoteFornecedorId:()=>loteFornecedorId,getLoteFornecedores:()=>loteFornecedores,_loteCatalogoCategoria,_catalogoProdutoAcabadoCompleto,_garantirCatalogosSolicitacao,_acaoPlanejamento,_saldoEstoquePedido,desenhar,_categoriaDeBluesoft,resolverLeadTimeProduto,riscoCoberturaInsumo,_consolidarItensPorLoja,_dataNecessariaProducao,getProdutosMestre:()=>_produtosMestre,setProdutosMestre:v=>{_produtosMestre=v;},getBiClassificacao:()=>_biClassificacao,setBiClassificacao:v=>{_biClassificacao=v;},getFornecedorVinculosPorProduto:()=>_fornecedorVinculosPorProduto,getFornecedoresPorId:()=>_fornecedoresPorId};
})(window);
