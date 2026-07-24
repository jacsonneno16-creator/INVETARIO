(function(global){
  'use strict';
  const cache={lista:[],porDun:new Map(),porGtin:new Map(),porCodigo:new Map(),porTodos:new Map(),ambiguos:new Map(),carregado:false,carregando:null,loja:'',versao:'',ultimaVerificacao:0};
  function texto(v){return String(v==null?'':v).trim();}
  function codigo(v){return texto(v).replace(/[\s.\-\/()]/g,'').toUpperCase();}
  function inferirFamilia(nome,unidade){
    var n=texto(nome).replace(/\s+-\s+(CX|FD|FARDO|UND|UNIDADE)(?:\s+\d+)?\s*$/i,'').trim();
    var m=n.match(/^(\d{4,6})\s+(.+)$/);
    return {familiaCodigo:m?m[1]:'',familiaNome:n,embalagem:inferirEmbalagem(nome,unidade)};
  }
  function inferirEmbalagem(nome,unidade){
    var u=texto(unidade).toUpperCase(); var n=texto(nome).toUpperCase();
    if(/(^|\s)(UND|UNIDADE)(\s|$)/.test(u+' '+n))return 'UND';
    if(/(^|\s)(FD|FARDO)(\s|$)/.test(u+' '+n))return 'FD';
    if(/(^|\s)(CX|CAIXA)(\s|$)/.test(u+' '+n))return 'CX';
    return u||'OUTRO';
  }
  function produto(raw,id){
    var nome=texto(raw.nomeProduto||raw.nome_produto||raw.produto||raw.descricao);
    var unidade=texto(raw.unidade||raw.un||raw.embalagem);
    var fam=inferirFamilia(nome,unidade);
    var gtin=texto(raw.gtin||raw.ean||raw.gtin_principal||raw.gtinPrincipal||raw.gtin_ean||raw.ean_gtin||raw.codigo_barras||raw.codigo_de_barras||raw.codigoBarras||raw.barcode);
    var dun=texto(raw.dun||raw.dun14||raw.dun_14||raw.codigo_dun||raw.codigoDun);
    var interno=texto(raw.codigoInterno||raw.codigo_interno||raw.codigo_produto||raw.codigoProduto||raw.codigo||raw.sku||raw.cod_interno);
    var extras=[raw.gtin,raw.ean,raw.gtin_principal,raw.gtinPrincipal,raw.gtin_ean,raw.ean_gtin,raw.codigo_barras,raw.codigo_de_barras,raw.codigoBarras,raw.barcode,raw.dun,raw.dun14,raw.dun_14,raw.codigo_dun,raw.codigoDun,raw.codigoInterno,raw.codigo_interno,raw.codigo_produto,raw.codigoProduto,raw.codigo,raw.sku,raw.cod_interno].map(texto).filter(Boolean);
    return {id:id||raw.id||'',produtoId:id||raw.produtoId||raw.produto_id||raw.id||'',codigoInterno:interno,nomeProduto:nome,dun:dun,gtin:gtin,codigosExtras:extras,unidade:unidade,embalagem:texto(raw.embalagem)||fam.embalagem,familiaCodigo:texto(raw.familiaCodigo||raw.familia_codigo)||fam.familiaCodigo,familiaNome:texto(raw.familiaNome||raw.familia_nome||raw.produtoPrincipal)||fam.familiaNome,produtoPrincipal:texto(raw.produtoPrincipal)||texto(raw.familiaNome)||fam.familiaNome,ativo:raw.ativo!==false,criadoEm:raw.criadoEm||raw.criado_em||null,atualizadoEm:raw.atualizadoEm||raw.atualizado_em||null};
  }
  function atualizarContadorNav(total){
    var el=global.document&&global.document.getElementById('nb-produtos');
    if(el)el.textContent=Number(total||0).toLocaleString('pt-BR');
  }
  function indexar(lista){
    cache.lista=(lista||[]).map(x=>produto(x,x.id));
    cache.porDun.clear();cache.porGtin.clear();cache.porCodigo.clear();cache.porTodos.clear();cache.ambiguos.clear();
    function addCodigo(valor,p,tipo){
      var k=codigo(valor); if(!k)return;
      var arr=cache.porTodos.get(k)||[];
      if(!arr.some(function(x){return String(x.produtoId||x.id||'')===String(p.produtoId||p.id||'') && x.nomeProduto===p.nomeProduto;}))arr.push(p);
      cache.porTodos.set(k,arr);
      if(tipo==='dun')cache.porDun.set(k,p);else if(tipo==='gtin')cache.porGtin.set(k,p);else cache.porCodigo.set(k,p);
    }
    cache.lista.forEach(function(p){
      if(!p.ativo)return;
      addCodigo(p.dun,p,'dun');addCodigo(p.gtin,p,'gtin');addCodigo(p.codigoInterno,p,'interno');
      (p.codigosExtras||[]).forEach(function(x){addCodigo(x,p,'extra');});
    });
    cache.porTodos.forEach(function(arr,k){if(arr.length>1)cache.ambiguos.set(k,arr.slice());});
    cache.carregado=true;cache.loja=global.getDTLojaAtiva?.()||'';try{localStorage.setItem('dt_produtos_cache__'+cache.loja,JSON.stringify(cache.lista));}catch(e){}
    atualizarContadorNav(cache.lista.length);
    global.dispatchEvent(new CustomEvent('dt-produtos-atualizados',{detail:{total:cache.lista.length,ambiguos:cache.ambiguos.size}})); return cache.lista;
  }
  function carregarLocal(){const loja=global.getDTLojaAtiva?.()||'';try{const raw=localStorage.getItem('dt_produtos_cache__'+loja);if(raw)indexar(JSON.parse(raw));}catch(e){} }
  async function carregar(force=false){
    const loja=global.getDTLojaAtiva?.()||'';
    if(cache.carregando)return cache.carregando;
    if(!navigator.onLine){
      if(!cache.carregado||cache.loja!==loja)carregarLocal();
      return cache.lista;
    }
    cache.carregando=(async()=>{
      try{
        const fs=global.getDTFirestore();
        const versaoKey='dt_produtos_versao__'+loja;
        let versaoServidor='';
        try{
          const meta=await fs.collection('dt_produtos_meta').doc('versao').get();
          if(meta.exists)versaoServidor=texto(meta.data().versao||meta.data().atualizadoEm||'');
        }catch(_e){}
        const versaoLocal=localStorage.getItem(versaoKey)||cache.versao||'';
        cache.ultimaVerificacao=Date.now();
        if(!force&&cache.carregado&&cache.loja===loja&&versaoServidor&&versaoLocal===versaoServidor){
          cache.versao=versaoServidor;
          return cache.lista;
        }
        const chunks=await Promise.race([
          fs.collection('dt_produtos_chunks').orderBy('parte').get(),
          new Promise(function(_,reject){setTimeout(function(){reject(new Error('Tempo excedido ao carregar chunks de produtos'));},30000);})
        ]);
        let docs=chunks.docs||[];
        if(versaoServidor){
          const daVersao=docs.filter(function(d){return texto((d.data()||{}).versao)===versaoServidor;});
          if(daVersao.length)docs=daVersao;
        }
        let rows=[];
        if(docs.length){
          docs.forEach(function(d){const x=d.data()||{};const itens=x.itens||x.dados||x.registros||[];rows=rows.concat(itens);});
          console.log('[Produtos] Base atualizada em chunks:',docs.length,'documentos /',rows.length,'produtos / versão',versaoServidor||'legada');
        }else{
          const snap=await fs.collection((global.DT_FCOL&&global.DT_FCOL.produtos)||'dt_produtos').get();
          rows=snap.docs.map(d=>({id:d.id,...d.data()}));
          console.warn('[Produtos] Chunks ausentes; usando coleção individual:',rows.length);
        }
        const result=indexar(rows);
        cache.versao=versaoServidor;
        if(versaoServidor)try{localStorage.setItem(versaoKey,versaoServidor);}catch(_e){}
        return result;
      }catch(e){
        console.warn('[Produtos] Falha ao atualizar base:',e);
        if(!cache.carregado||cache.loja!==loja)carregarLocal();
        return cache.lista;
      }finally{cache.carregando=null;}
    })();
    return cache.carregando;
  }
  function buscarSync(valor){
    const c=codigo(valor);if(!c)return {encontrado:false,codigoLido:texto(valor)};
    const arr=(cache.porTodos.get(c)||[]).slice();
    if(!arr.length)return {encontrado:false,codigoLido:texto(valor)};
    if(arr.length>1)return {encontrado:false,ambiguo:true,codigoLido:texto(valor),candidatos:arr.map(function(p){return {produtoId:p.produtoId,codigoInterno:p.codigoInterno,nomeProduto:p.nomeProduto,gtin:p.gtin,dun:p.dun};})};
    return {encontrado:true,...arr[0]};
  }
  async function buscar(valor){if(!cache.carregado||cache.loja!==(global.getDTLojaAtiva?.()||''))await carregar();return buscarSync(valor);}
  function enriquecer(reg){const r={...reg};const atual=texto(r.produtoLidoNome||r.produtoLido);const placeholder=!atual||/^(PRODUTO NAO IDENTIFICADO|PRODUTO NÃO IDENTIFICADO|PRODUTO NAO CADASTRADO|PRODUTO NÃO CADASTRADO|CODIGO SEM CADASTRO|CÓDIGO SEM CADASTRO)$/i.test(atual);if(!placeholder)return r;const cod=r.dunLido||r.gtinLido||r.codigoLido||r.gtin_bipado||r.gtin;const ach=buscarSync(cod);if(ach.encontrado){r.produtoLidoNome=ach.nomeProduto;r.produtoLido=ach.nomeProduto;r.produtoLidoId=ach.produtoId;}return r;}
  carregarLocal();
  if(global.document){
    if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',function(){atualizarContadorNav(cache.lista.length);});
    else atualizarContadorNav(cache.lista.length);
  }
  if(!global.__dtProdutosPreloadLoja){
    global.__dtProdutosPreloadLoja=true;
    global.addEventListener('dt-loja-alterada',function(){
      limparCache();atualizarContadorNav(0);
      setTimeout(function(){if(global.getDTLojaAtiva?.()&&global.getDTFirestore)carregar(true).catch(function(e){console.warn('[Produtos] Pré-carga após troca de loja:',e);});},250);
    });
  }
  function familias(){var mapa={};cache.lista.forEach(function(p){if(!p.ativo)return;var k=p.familiaCodigo||p.familiaNome;if(!k)return;if(!mapa[k])mapa[k]={id:k,nome:p.familiaNome||p.produtoPrincipal||p.nomeProduto,codigo:p.familiaCodigo,produtos:[],unidade:null};mapa[k].produtos.push(p);if(p.embalagem==='UND')mapa[k].unidade=p;});return Object.keys(mapa).map(function(k){return mapa[k];}).sort(function(a,b){return a.nome.localeCompare(b.nome);});}
  function limparCache(){cache.lista=[];cache.porDun.clear();cache.porGtin.clear();cache.porCodigo.clear();cache.porTodos.clear();cache.ambiguos.clear();cache.carregado=false;cache.carregando=null;cache.loja='';cache.versao='';cache.ultimaVerificacao=0;}
  global.DTProdutos={cache,normalizarCodigo:codigo,normalizarProduto:produto,indexar,carregar,buscar,buscarSync,enriquecer,familias:familias,inferirFamilia:inferirFamilia,inferirEmbalagem:inferirEmbalagem,limparCache:limparCache,atualizarContador:atualizarContadorNav};
  global.buscarProdutoPorCodigo=buscar;
  global.enriquecerProdutoLido=enriquecer;
})(window);
