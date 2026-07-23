(function(global){
  'use strict';
  const cache={lista:[],porDun:new Map(),porGtin:new Map(),porCodigo:new Map(),carregado:false,carregando:null,loja:''};
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
    return {id:id||raw.id||'',produtoId:id||raw.produtoId||raw.id||'',codigoInterno:texto(raw.codigoInterno||raw.codigo_interno||raw.codigo||raw.sku),nomeProduto:nome,dun:texto(raw.dun),gtin:texto(raw.gtin||raw.ean),unidade:unidade,embalagem:texto(raw.embalagem)||fam.embalagem,familiaCodigo:texto(raw.familiaCodigo||raw.familia_codigo)||fam.familiaCodigo,familiaNome:texto(raw.familiaNome||raw.familia_nome||raw.produtoPrincipal)||fam.familiaNome,produtoPrincipal:texto(raw.produtoPrincipal)||texto(raw.familiaNome)||fam.familiaNome,ativo:raw.ativo!==false,criadoEm:raw.criadoEm||raw.criado_em||null,atualizadoEm:raw.atualizadoEm||raw.atualizado_em||null};
  }
  function indexar(lista){
    cache.lista=(lista||[]).map(x=>produto(x,x.id)); cache.porDun.clear();cache.porGtin.clear();cache.porCodigo.clear();
    cache.lista.forEach(p=>{if(!p.ativo)return;const d=codigo(p.dun),g=codigo(p.gtin),c=codigo(p.codigoInterno);if(d)cache.porDun.set(d,p);if(g)cache.porGtin.set(g,p);if(c)cache.porCodigo.set(c,p);});
    cache.carregado=true;cache.loja=global.getDTLojaAtiva?.()||'';try{localStorage.setItem('dt_produtos_cache__'+cache.loja,JSON.stringify(cache.lista));}catch(e){}
    global.dispatchEvent(new CustomEvent('dt-produtos-atualizados',{detail:{total:cache.lista.length}})); return cache.lista;
  }
  function carregarLocal(){const loja=global.getDTLojaAtiva?.()||'';try{const raw=localStorage.getItem('dt_produtos_cache__'+loja);if(raw)indexar(JSON.parse(raw));}catch(e){} }
  async function carregar(force=false){
    const loja=global.getDTLojaAtiva?.()||'';
    if(!force&&cache.carregado&&cache.loja===loja)return cache.lista;
    if(cache.carregando)return cache.carregando;
    cache.carregando=(async()=>{
      try{
        const fs=global.getDTFirestore();
        const versaoKey='dt_produtos_versao__'+loja;
        let versaoServidor='';
        try{const meta=await fs.collection('dt_produtos_meta').doc('versao').get();if(meta.exists)versaoServidor=texto(meta.data().versao||meta.data().atualizadoEm||'');}catch(_e){}
        const versaoLocal=localStorage.getItem(versaoKey)||'';
        if(!force&&versaoServidor&&versaoLocal===versaoServidor){
          carregarLocal();
          if(cache.carregado&&cache.loja===loja)return cache.lista;
        }
        const chunks=await Promise.race([
          fs.collection('dt_produtos_chunks').orderBy('parte').get(),
          new Promise(function(_,reject){setTimeout(function(){reject(new Error('Tempo excedido ao carregar chunks de produtos'));},12000);})
        ]);
        let rows=[];
        if(!chunks.empty){
          chunks.docs.forEach(function(d){const x=d.data()||{};const itens=x.itens||x.dados||x.registros||[];rows=rows.concat(itens);});
          console.log('[Produtos] Base carregada em chunks:',chunks.docs.length,'documentos /',rows.length,'produtos');
        }else{
          const snap=await fs.collection((global.DT_FCOL&&global.DT_FCOL.produtos)||'dt_produtos').get();
          rows=snap.docs.map(d=>({id:d.id,...d.data()}));
          console.warn('[Produtos] Chunks ausentes; usando coleção individual:',rows.length);
        }
        const result=indexar(rows);
        if(versaoServidor)try{localStorage.setItem(versaoKey,versaoServidor);}catch(_e){}
        return result;
      }catch(e){console.warn('[Produtos] Falha ao carregar base:',e);carregarLocal();return cache.lista;}
      finally{cache.carregando=null;}
    })();
    return cache.carregando;
  }
  function buscarSync(valor){const c=codigo(valor);if(!c)return {encontrado:false,codigoLido:texto(valor)};const p=cache.porDun.get(c)||cache.porGtin.get(c)||cache.porCodigo.get(c);return p?{encontrado:true,...p}:{encontrado:false,codigoLido:texto(valor)};}
  async function buscar(valor){if(!cache.carregado||cache.loja!==(global.getDTLojaAtiva?.()||''))await carregar();return buscarSync(valor);}
  function enriquecer(reg){const r={...reg};if(r.produtoLidoNome||r.produtoLido)return r;const cod=r.dunLido||r.gtinLido||r.codigoLido||r.gtin_bipado||r.gtin;const ach=buscarSync(cod);if(ach.encontrado){r.produtoLidoNome=ach.nomeProduto;r.produtoLido=ach.nomeProduto;r.produtoLidoId=ach.produtoId;}return r;}
  carregarLocal();
  function familias(){var mapa={};cache.lista.forEach(function(p){if(!p.ativo)return;var k=p.familiaCodigo||p.familiaNome;if(!k)return;if(!mapa[k])mapa[k]={id:k,nome:p.familiaNome||p.produtoPrincipal||p.nomeProduto,codigo:p.familiaCodigo,produtos:[],unidade:null};mapa[k].produtos.push(p);if(p.embalagem==='UND')mapa[k].unidade=p;});return Object.keys(mapa).map(function(k){return mapa[k];}).sort(function(a,b){return a.nome.localeCompare(b.nome);});}
  function limparCache(){cache.lista=[];cache.porDun.clear();cache.porGtin.clear();cache.porCodigo.clear();cache.carregado=false;cache.carregando=null;cache.loja='';}
  global.DTProdutos={cache,normalizarCodigo:codigo,normalizarProduto:produto,indexar,carregar,buscar,buscarSync,enriquecer,familias:familias,inferirFamilia:inferirFamilia,inferirEmbalagem:inferirEmbalagem,limparCache:limparCache};
  global.buscarProdutoPorCodigo=buscar;
  global.enriquecerProdutoLido=enriquecer;
})(window);
