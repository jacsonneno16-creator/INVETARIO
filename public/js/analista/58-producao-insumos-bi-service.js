// Fonte única de estoque de insumos para Produção.
// Lê dados-insumos.json diretamente via API do BI (DTBiPastaLocal), sem
// depender do PCP Central ter sido aberto ou do cache de outra tela.
(function(global){
  'use strict';
  var cache=null, cacheLoja='', carregando=null;
  function norm(v){return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();}
  function canon(v){return norm(v).replace(/^\s*\d+[^A-Z0-9]*/,'').replace(/^\s*(MP|MAT(?:ERIA)?\s*PRIMA|MATERIA\s*PRIMA|LOGISTICA)[^A-Z0-9]+/,'').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
  function num(){for(var i=0;i<arguments.length;i++){var v=arguments[i];if(v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v)))return Number(v);}return 0;}
  function linhas(raw){return Array.isArray(raw)?raw:(raw&&Array.isArray(raw.produtos)?raw.produtos:(raw&&Array.isArray(raw.dados)?raw.dados:(raw&&Array.isArray(raw.linhas)?raw.linhas:[])));}
  function lojaAtiva(){return String(typeof global.getDTLojaAtiva==='function'?global.getDTLojaAtiva():'').trim();}
  function consolidar(raw,lojaId){
    var todas=linhas(raw), temLoja=todas.some(function(it){return String(it.lojaId!=null?it.lojaId:(it.loja_id!=null?it.loja_id:(it.loja!=null?it.loja:(it.filial!=null?it.filial:'')))).trim();});
    var alvo=norm(lojaId), map=new Map();
    todas.forEach(function(it){
      var lid=String(it.lojaId!=null?it.lojaId:(it.loja_id!=null?it.loja_id:(it.loja!=null?it.loja:(it.filial!=null?it.filial:'')))).trim();
      if(alvo&&temLoja&&norm(lid)!==alvo)return;
      var cod=String(it.sku!=null?it.sku:(it.produto_key!=null?it.produto_key:(it.produtoKey!=null?it.produtoKey:(it.cod!=null?it.cod:(it.codigo!=null?it.codigo:''))))).trim();
      var nome=String(it.produto||it.descricao||it.nome||cod).trim(); if(!nome&&!cod)return;
      var key=cod||canon(nome); if(!key)return;
      var tipo=it.tipo||it.tipoProduto||'',categoria=it.categoria||it.classificacao||'';
      if(/PRODUTO\s*ACABADO/.test(norm(tipo+' '+categoria)))return;
      var est=num(it.estoque,it.quantidade_estoque,it.quantidadeEstoque,it.estoqueAtual);
      var saldo=num(it.saldo,it.saldoAtual,it.saldo_disponivel,it.disponivel); if(!(est>0)&&saldo>0)est=saldo;
      var atual=map.get(key)||{cod:cod,insumo:nome,produto:nome,quantidade:0,estoque:0,unidade:it.unidade||it.um||'',categoria:categoria||'Outros',tipo:tipo,fonte:'bi'};
      atual.quantidade+=est; atual.estoque=atual.quantidade;
      if(!atual.unidade&&(it.unidade||it.um))atual.unidade=it.unidade||it.um;
      if((!atual.categoria||atual.categoria==='Outros')&&categoria)atual.categoria=categoria;
      map.set(key,atual);
    });
    return Array.from(map.values());
  }
  async function carregar(forcar){
    var lid=lojaAtiva();
    if(!forcar&&cache&&cacheLoja===lid)return cache;
    if(!forcar&&carregando)return carregando;
    carregando=(async function(){
      if(!global.DTBiPastaLocal||typeof global.DTBiPastaLocal.lerJson!=='function')throw new Error('Serviço do BI indisponível.');
      var raw=await global.DTBiPastaLocal.lerJson('dados-insumos.json',{forcar:!!forcar});
      cache=consolidar(raw,lid);cacheLoja=lid;return cache;
    })();
    try{return await carregando;}finally{carregando=null;}
  }
  function mapa(){var m=new Map();(cache||[]).forEach(function(i){m.set(canon(i.insumo||i.produto||''),Number(i.quantidade||i.estoque)||0);});return m;}
  function limpar(){cache=null;cacheLoja='';}
  global.DTProducaoInsumosBI={carregar:carregar,get:function(){return cache||[];},mapa:mapa,canon:canon,limpar:limpar,consolidar:consolidar};
})(window);
