function state(){ return window.AnalistaStore.getState(); }

function _paleteContagem(c){
  const valor=c?.palete ?? c?.pallet ?? c?.numero_palete ?? c?.numeroPalete ??
    c?.palete_key ?? c?.capa_palete ?? c?.pallete_ou_capa ?? c?.capa ?? '';
  return String(valor ?? '').trim();
}

function _ordemPaleteContagem(c){
  const pal=_paleteContagem(c);
  const num=Number(pal);
  if(pal && Number.isFinite(num)) return {grupo:0, valor:num, texto:pal};
  return {grupo:1, valor:0, texto:pal || String(c?.criado_em || c?.dataHora || c?.timestamp || '')};
}


// Fonte única da visão física atual: para cada inventário/endereço, retorna
// somente os paletes da rodada mais recente. Rodadas anteriores ficam apenas
// no histórico e nunca entram nos totais ou exportações operacionais.
function _linhasFisicasAtuais(inventarioId){
  if(window.InventoryAddressState?.latestPhysicalRows){
    return window.InventoryAddressState.latestPhysicalRows(state(),inventarioId);
  }
  const runtime=window.AnalistaDivergenciasRuntime;
  if(runtime?.fotografiaFisicaAtual) return runtime.fotografiaFisicaAtual(inventarioId);
  // Fallback de segurança apenas durante o carregamento inicial do runtime.
  return (state().contagens||[]).filter(c=>{
    if(c?._excluida || ['ESTORNADA','EXCLUIDA','CANCELADA'].includes(String(c?.status||'').toUpperCase())) return false;
    const id=String(c?.inventario_id||c?.inventarioId||'');
    return !inventarioId || id===String(inventarioId);
  });
}
window.DTContagemFisicaAtual={linhas:_linhasFisicasAtuais};
function _produtoContagemExibicao(c){
  const codigo=c?.codigo_produto||c?.codigoProduto||c?.gtin||c?.ean||c?.dun||c?.codigo_lido||c?.codigoLido||'';
  const atual=String(c?.descricao_produto||c?.descricaoProduto||c?.descricao||'').trim();
  const placeholder=!atual||/^(PRODUTO NAO IDENTIFICADO|PRODUTO NÃO IDENTIFICADO|PRODUTO NAO CADASTRADO|PRODUTO NÃO CADASTRADO|CODIGO SEM CADASTRO|CÓDIGO SEM CADASTRO)$/i.test(atual);
  const ach=window.DTProdutos?.buscarSync?.(codigo);
  return {codigo:codigo||ach?.codigoInterno||ach?.gtin||ach?.dun||'',descricao:(!placeholder?atual:'')||(ach?.encontrado?ach.nomeProduto:'Código sem cadastro')};
}


// Retorna a rodada mais recente concluida para exibicao na aba Contagens.
// O registro original permanece intacto; esta funcao apenas monta a visao
// operacional com produto, quantidade, operador e data da ultima rodada.
function _ultimaRodadaContagem(c){
  const st=state();
  const FK=window.InventoryFlowKey;
  const primeira={
    rodada:1,
    quantidade:c?.quantidade ?? c?.qtd ?? c?.qtd_contada ?? null,
    produto:c?.gtin_bipado || c?.gtinLido || c?.gtin_lido || c?.codigo_lido || c?.codigoLido || c?.codigo_produto || c?.codigoProduto || c?.gtin || c?.ean || c?.dun || '',
    descricao:c?.descricao_produto || c?.descricaoProduto || c?.produto_descricao || c?.descricao || '',
    operador:c?.operador || c?.operador_nome || '',
    data:c?.timestamp || c?.criado_em || c?.dataHora || ''
  };
  if(!FK) return primeira;

  const inv=FK.inventario(c,st.inventarios);
  const end=FK.endereco(c?.endereco);
  const prod=FK.produto(c);
  const cid=String(c?.uuid || c?.id || '');
  const divs=(st.divergencias || []).filter(d =>
    FK.inventario(d,st.inventarios)===inv && FK.endereco(d?.endereco)===end &&
    !['CANCELADA','EXCLUIDA','ESTORNADA'].includes(String(d?.status || '').toUpperCase())
  );
  const div=divs.find(d => cid && [d?.contagem_uuid,d?.contagem_id,d?.origem_contagem_id].filter(Boolean).map(String).includes(cid)) ||
    divs.find(d => FK.produto(d)===prod) || (divs.length===1 ? divs[0] : null);
  if(!div) return primeira;

  const concluida=r => {
    const status=String(r?.status_recontagem || r?.status || '').trim().toUpperCase();
    const bloqueada=['PENDENTE','ATRIBUIDA','ATRIBUÍDA','EM_ANDAMENTO','ABERTA','CANCELADA','EXCLUIDA'].includes(status);
    const temQtd=r?.qtd_recontagem != null || r?.qtd_segunda != null || r?.qtd_terceira != null;
    const temData=Boolean(r?.recontagem_concluida_em || r?.concluida_em || r?.finalizada_em || r?.data_segunda || r?.data_terceira);
    return temQtd && !bloqueada && (temData || ['CONCLUIDA','CONCLUÍDA','FINALIZADA','PROCESSADA','RESOLVIDA','AGUARDANDO_ANALISTA'].includes(status));
  };
  const recs=(st.recontagens || []).filter(r =>
    (String(r?.divergencia_id || '')===String(div?.id || '') || FK.mesmo(r,div,st.inventarios)) && concluida(r)
  ).sort((a,b) => {
    const na=Number(a?.numero_recontagem || 0), nb=Number(b?.numero_recontagem || 0);
    if(na!==nb) return na-nb;
    return String(a?.data_terceira || a?.recontagem_concluida_em || a?.concluida_em || a?.data_segunda || '')
      .localeCompare(String(b?.data_terceira || b?.recontagem_concluida_em || b?.concluida_em || b?.data_segunda || ''));
  });
  if(!recs.length) return primeira;

  const r=recs[recs.length-1];
  const numeroRodada=Math.max(1,Number(r?.numero_recontagem || recs.length));
  const rodada=Math.min(3,1+numeroRodada);

  // A tarefa de recontagem guarda o TOTAL do endereço, mas a aba Contagens
  // precisa continuar exibindo cada palete bipado separadamente. Por isso,
  // buscamos as leituras brutas da rodada em dt_contagens e associamos cada
  // leitura ao palete original (primeiro pelo número da capa/palete e, para
  // dados antigos sem o mesmo identificador, pela posição ordenada).
  const recontagensBrutas=(st.contagens || []).filter(x => {
    if(String(x?.tipo_contagem || '').toUpperCase()!=='RECONTAGEM') return false;
    if(x?._excluida || ['ESTORNADA','EXCLUIDA'].includes(String(x?.status || '').toUpperCase())) return false;
    if(FK.inventario(x,st.inventarios)!==inv || FK.endereco(x?.endereco)!==end) return false;
    const vinculada=String(x?.recontagem_id || '')===String(r?.id || '') ||
      String(x?.divergencia_id || '')===String(div?.id || '');
    const mesmaRodada=!x?.numero_recontagem || Number(x.numero_recontagem)===numeroRodada;
    return vinculada && mesmaRodada;
  }).sort((a,b) => {
    const oa=_ordemPaleteContagem(a), ob=_ordemPaleteContagem(b);
    if(oa.grupo!==ob.grupo) return oa.grupo-ob.grupo;
    if(oa.valor!==ob.valor) return oa.valor-ob.valor;
    return oa.texto.localeCompare(ob.texto);
  });

  let leituraPalete=null;
  const paleteOriginal=_paleteContagem(c);
  if(paleteOriginal){
    leituraPalete=recontagensBrutas.find(x => _paleteContagem(x)===paleteOriginal) || null;
  }
  if(!leituraPalete && recontagensBrutas.length){
    const originais=(st.contagens || []).filter(x =>
      String(x?.tipo_contagem || 'PRIMEIRA').toUpperCase()!=='RECONTAGEM' &&
      !x?._excluida && !['ESTORNADA','EXCLUIDA'].includes(String(x?.status || '').toUpperCase()) &&
      FK.inventario(x,st.inventarios)===inv && FK.endereco(x?.endereco)===end &&
      FK.produto(x)===prod
    ).sort((a,b) => {
      const oa=_ordemPaleteContagem(a), ob=_ordemPaleteContagem(b);
      if(oa.grupo!==ob.grupo) return oa.grupo-ob.grupo;
      if(oa.valor!==ob.valor) return oa.valor-ob.valor;
      return oa.texto.localeCompare(ob.texto);
    });
    const indice=originais.findIndex(x => String(x?.uuid || x?.id || '')===cid);
    if(indice>=0 && recontagensBrutas[indice]) leituraPalete=recontagensBrutas[indice];
  }

  const fonte=leituraPalete || r;
  return {
    rodada,
    // Nunca replica o total consolidado da tarefa em cada linha de palete.
    // Quando a rodada não possui leitura individual vinculável a este palete,
    // a linha permanece sem quantidade; o status do endereço continua vindo
    // exclusivamente do motor consolidado.
    quantidade:leituraPalete
      ? (leituraPalete?.quantidade ?? leituraPalete?.qtd ?? leituraPalete?.qtd_contada ?? null)
      : null,
    produto:leituraPalete
      ? (leituraPalete?.gtin_bipado || leituraPalete?.codigoLido || leituraPalete?.dunLido || leituraPalete?.gtinLido || leituraPalete?.gtin || leituraPalete?.codigo_produto || primeira.produto)
      : primeira.produto,
    descricao:fonte?.descricao_produto || fonte?.produto_descricao || fonte?.produtoLidoNome || fonte?.descricao || primeira.descricao,
    operador:fonte?.operador_terceira || fonte?.operador_segunda || fonte?.operador_recontagem || fonte?.operador || fonte?.operador_nome || primeira.operador,
    data:fonte?.data_terceira || fonte?.data_segunda || fonte?.recontagem_concluida_em || fonte?.concluida_em || fonte?.finalizada_em || fonte?.criado_em || fonte?.dataHora || primeira.data,
    palete:_paleteContagem(leituraPalete) || paleteOriginal,
    leitura_individual:Boolean(leituraPalete)
  };
}


function _avaliarDistribuicaoPaletes(c){
  return null; /* validacao autoritativa e somente pelo total do endereco */
  /*
  const st=state();
  const FK=window.InventoryFlowKey;
  if(!FK) return null;
  const inv=FK.inventario(c,st.inventarios);
  const end=FK.endereco(c?.endereco);
  const prod=FK.produto(c);
  const invObj=(st.inventarios||[]).find(i=>FK.inventario(i,st.inventarios)===inv);
  const num=v=>{ if(v===null||v===undefined||String(v).trim()==='') return 0; const n=Number(String(v).replace(',','.')); return Number.isFinite(n)?n:0; };
  const pal=x=>String(x?.palete ?? x?.pallet ?? x?.numero_palete ?? x?.numeroPalete ?? x?.palete_key ?? x?.capa_palete ?? x?.capa ?? '').trim();
  const qtd=x=>num(x?.quantidade_esperada ?? x?.qtd_esperada ?? x?.quantidade_enderecada ?? x?.saldo_estoque ?? x?.qtd_sistema ?? x?.estoque ?? x?.quantidade ?? x?.qtd ?? x?.qtde);
  const base=(invObj?.base||[]).filter(x=>FK.endereco(x?.endereco)===end && (!prod || FK.produto(x)===prod));
  const esperado=new Map();
  base.forEach(x=>{ const k=pal(x); if(k) esperado.set(k,(esperado.get(k)||0)+qtd(x)); });
  if(esperado.size<2) return null;
  const validas=(st.contagens||[]).filter(x=>!x?._excluida && !['ESTORNADA','EXCLUIDA'].includes(String(x?.status||'').toUpperCase()) && FK.inventario(x,st.inventarios)===inv && FK.endereco(x?.endereco)===end && (!prod || FK.produto(x)===prod));
  if(!validas.length) return null;
  const rodada=x=>String(x?.tipo_contagem||'PRIMEIRA').toUpperCase()==='RECONTAGEM' ? Math.min(3,1+Math.max(1,Number(x?.numero_recontagem||1))) : 1;
  const ultima=Math.max(...validas.map(rodada));
  const atual=new Map();
  validas.filter(x=>rodada(x)===ultima).forEach(x=>{ const k=pal(x); if(k) atual.set(k,(atual.get(k)||0)+num(x?.quantidade ?? x?.qtd ?? x?.qtd_contada)); });
  if(!atual.size) return null;
  const totalEsp=[...esperado.values()].reduce((a,b)=>a+b,0);
  const totalAt=[...atual.values()].reduce((a,b)=>a+b,0);
  const chaves=new Set([...esperado.keys(),...atual.keys()]);
  const divergentes=[...chaves].filter(k=>Math.abs((esperado.get(k)||0)-(atual.get(k)||0))>1e-9);
  return {rodada:ultima,totalEsperado:totalEsp,totalContado:totalAt,totalBate:Math.abs(totalEsp-totalAt)<1e-9,divergentes,quantidadeDivergente:divergentes.length};
  */
}
window.avaliarDistribuicaoPaletes=_avaliarDistribuicaoPaletes;

function contStatusBadge(status){
  const st = String(status || 'PENDENTE').toUpperCase();
  if (st === 'PROCESSADO' || st === 'OK' || st === 'CONCLUIDA') return 'b-green';
  if (st === 'DIVERGENTE' || st === 'CONFLITO' || st === 'PERSISTENTE') return 'b-red';
  if (st === 'ESTORNADA' || st === 'EXCLUIDA') return 'b-gray';
  if (st === 'EM_RECONTAGEM' || st === 'RECONTAGEM') return 'b-purple';
  return 'b-orange';
}
window.contStatusBadge = window.contStatusBadge || contStatusBadge;

// Resume o resultado final das rodadas (1ª/2ª/3ª contagem) de um endereço em
// um único badge, em vez de o endereço aparecer uma vez por rodada na lista
// de Contagens. Usa a mesma regra de avaliação da aba Recontagem, então os
// dois lugares sempre concordam sobre qual rodada "bateu".
function _resultadoRodadaEndereco(c){
  const runtime = window.AnalistaDivergenciasRuntime;
  if (!runtime?.resolverEndereco) return { texto:'⚠️ Motor único indisponível', cls:'b-orange' };
  const resultado = runtime.resolverEndereco(c);
  const prefixo = resultado.estado === 'RESOLVIDA' ? '✅ ' : resultado.estado === 'PERSISTENTE' ? '🔴 ' : '⏳ ';
  return {
    texto: prefixo + resultado.texto,
    cls: resultado.classe,
    estado: resultado.estado,
    rodada: resultado.rodada,
    referencia: resultado.referencia,
    qtdFinal: resultado.qtd_final
  };
}

// ───────────────────────────────────────────────────────────────────
//  14. RENDERIZAÇÃO — CONTAGENS
// ───────────────────────────────────────────────────────────────────

function renderContagens() {
  const scrollAnterior=document.querySelector('#cont-table-wrap .cont-table-scroll')?.scrollLeft || 0;
  const FK = window.InventoryFlowKey;
  if (!FK) throw new Error('InventoryFlowKey não carregado');
  const busca    = (document.getElementById('cont-busca')?.value || '').toLowerCase();
  const fInv     = document.getElementById('cont-finv')?.value || '';
  const fTipo    = document.getElementById('cont-ftipo')?.value || '';
  const fStatus  = document.getElementById('cont-fstatus')?.value || '';
  const fRua     = document.getElementById('cont-frua')?.value || '';
  const fOp      = document.getElementById('cont-foperador')?.value || '';
  const fPeriodo = document.getElementById('cont-fperiodo')?.value || '';

  // Popular selects de inventários
  const selInv = document.getElementById('cont-finv');
  if (selInv && !selInv.options.length || (selInv && selInv.options.length === 1)) {
    const cur = selInv.value;
    selInv.innerHTML = '<option value="">Todos os inventários</option>' +
      state().inventarios.map(i => `<option value="${i.id}" ${i.id === cur ? 'selected' : ''}>${escHTML(i.codigo)} — ${escHTML(i.nome)}</option>`).join('');
    if (cur) selInv.value = cur;
  }

  let dados = state().contagens || [];
  if (!fTipo) {
    dados=_linhasFisicasAtuais().map(c => {
      const produto=_produtoContagemExibicao(c);
      const rodada=String(c?.tipo_contagem || 'PRIMEIRA').toUpperCase()==='RECONTAGEM'
        ? Math.min(3,1+Math.max(1,Number(c?.numero_recontagem || 1))) : 1;
      return Object.assign({},c,{_ultima_visao:{
        rodada,
        quantidade:c?.quantidade ?? c?.qtd ?? c?.qtd_contada ?? null,
        produto:c?.gtin_bipado || c?.gtinLido || c?.gtin_lido || c?.codigo_lido || c?.codigoLido || c?.dunLido || c?.codigo_produto || c?.codigoProduto || c?.gtin || c?.ean || c?.dun || produto.codigo || '',
        descricao:c?.descricao_produto || c?.descricaoProduto || c?.produto_descricao || c?.descricao || produto.descricao || '',
        operador:c?.operador || c?.operador_nome || '',
        data:c?.timestamp || c?.criado_em || c?.dataHora || '',
        palete:_paleteContagem(c),
        leitura_individual:true
      }});
    });
  }
  if (fInv)    dados = dados.filter(c => String(c.inventario_id || c.inventarioId || '') === String(fInv));
  if (fTipo)   dados = dados.filter(c => c.tipo_contagem === fTipo);
  if (fStatus) {
    if (fStatus === 'DIVERGENTE') {
      // c.divergente é o campo real (boolean) — status='DIVERGENTE' nunca é usado
      dados = dados.filter(c => c.divergente === true);
    } else {
      dados = dados.filter(c => c.status === fStatus);
    }
  }
  if (fOp)     dados = dados.filter(c => (c.operador || '') === fOp);

  // Filtro por rua (baseado no endereço do cadastro)
  if (fRua) dados = dados.filter(c => {
    const info = getEnderecoInfo(c.endereco);
    return (info?.rua || '—') === fRua;
  });

  // Filtro por período
  if (fPeriodo) {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate()-1);
    const set7 = new Date(hoje); set7.setDate(set7.getDate()-7);
    dados = dados.filter(c => {
      const valorData = c.timestamp || c.criado_em || c.dataHora || null;
      const ts = valorData ? new Date(valorData) : null;
      if (!ts) return false;
      if (fPeriodo === 'hoje') return ts >= hoje;
      if (fPeriodo === 'ontem') return ts >= ontem && ts < hoje;
      if (fPeriodo === '7d') return ts >= set7;
      return true;
    });
  }

  if (busca) dados = dados.filter(c =>
    (c.operador||'').toLowerCase().includes(busca) ||
    (c.endereco||'').toLowerCase().includes(busca) ||
    (c.codigo_produto||'').toLowerCase().includes(busca) ||
    (c.descricao_produto||'').toLowerCase().includes(busca)
  );
  dados = [...dados].sort((a,b) => String(b.timestamp||b.criado_em||b.dataHora||'').localeCompare(String(a.timestamp||a.criado_em||a.dataHora||'')));

  // A exportacao deve refletir exatamente a lista visivel, incluindo filtros,
  // agrupamento por fluxo e a ultima rodada concluida usada na tela.
  window.__contagensVisiveis = dados.slice();

  // KPIs Contagens
  const _allConts = _linhasFisicasAtuais();
  const _setCK = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  _setCK('ck-total',       _allConts.length);
  _setCK('ck-processadas', _allConts.filter(c => c.status === 'PROCESSADO').length);
  _setCK('ck-divergentes', _allConts.filter(c => c.divergente === true).length);
  _setCK('ck-pendentes',   _allConts.filter(c => !c.status || c.status === 'PENDENTE').length);
  _setCK('ck-recontagens', _allConts.filter(c => c.tipo_contagem === 'RECONTAGEM').length);

  // Atualizar selects dinâmicos (rua e operador)
  const selRua = document.getElementById('cont-frua');
  if (selRua) {
    const ruas = [...new Set(state().contagens.map(c => { const i = getEnderecoInfo(c.endereco); return i?.rua || '—'; }).filter(Boolean))].sort();
    selRua.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(r => `<option value="${escHTML(r)}" ${r===fRua?'selected':''}>${escHTML(r)}</option>`).join('');
  }
  const selOp = document.getElementById('cont-foperador');
  if (selOp) {
    const ops = [...new Set(state().contagens.map(c => c.operador).filter(Boolean))].sort();
    selOp.innerHTML = '<option value="">Todos os operadores</option>' + ops.map(o => `<option value="${escHTML(o)}" ${o===fOp?'selected':''}>${escHTML(o)}</option>`).join('');
  }

  if (!dados.length) {
    document.getElementById('cont-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma contagem encontrada</div><div class="empty-sub">As contagens dos coletores aparecem aqui automaticamente</div></div>`;
    return;
  }

  document.getElementById('cont-table-wrap').innerHTML = `
    <style>
      #cont-table-wrap{width:100%;max-width:100%;overflow:hidden}
      #cont-table-wrap .cont-table-scroll{width:100%;overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch}
      #cont-table-wrap .cont-resumo-table{min-width:1540px;width:max-content;border-collapse:collapse}
      #cont-table-wrap .cont-resumo-table th,#cont-table-wrap .cont-resumo-table td{white-space:nowrap;vertical-align:middle}
      #cont-table-wrap .cont-resumo-table thead th{position:sticky;top:0;z-index:2;background:var(--card,#fff)}
      #cont-table-wrap .cont-col-produto{min-width:330px;max-width:420px;overflow:hidden;text-overflow:ellipsis}
    </style>
    <div class="tbl-wrap cont-table-scroll"><table class="cont-resumo-table">
      <thead><tr>
        <th>Última atualização</th><th>Operador</th><th>Inventário</th>
        <th>Endereço</th><th>Código</th><th class="cont-col-produto">Produto</th>
        <th>DUN/GTIN</th><th>Quantidade</th><th>Última etapa</th>
        <th>Status</th><th>Ações</th>
      </tr></thead>
      <tbody>
        ${dados.map(c => {
          const inv      = getInventarioPorId(c.inventario_id);
          const excluida = c._excluida === true;
          const rowStyle = excluida ? 'opacity:.45;background:#fafafa' : '';
          const ultima=c?._ultima_visao || _ultimaRodadaContagem(c);
          const codigoBipado=String(ultima.produto || '').trim();
          const cadastro=window.DTProdutos?.buscarSync?.(codigoBipado);
          const codigoInterno=String(cadastro?.codigoInterno || cadastro?.codigo_interno || cadastro?.codigoProduto || c?.codigo_produto || c?.codigoProduto || '').trim();
          const produto=String(ultima.descricao || (cadastro?.encontrado ? cadastro.nomeProduto : '') || 'Código sem cadastro').trim();
          const etapa=ultima.rodada === 1 ? '1ª contagem' : `${ultima.rodada}ª contagem`;
          return `<tr style="${rowStyle}">
            <td class="mono" style="font-size:.75rem">${fmtTs(ultima.data || c.timestamp || c.criado_em || c.dataHora)}</td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <div class="u-avatar" style="width:24px;height:24px;font-size:.65rem;flex-shrink:0">${escHTML((ultima.operador||c.operador||'?')[0].toUpperCase())}</div>
                <span style="font-weight:600;font-size:.82rem">${escHTML(ultima.operador || c.operador || '—')}</span>
              </div>
            </td>
            <td style="font-size:.75rem;color:var(--muted)">${escHTML(inv?.codigo || c.inventario_id || '—')}</td>
            <td class="mono">${escHTML(c.endereco || '—')}</td>
            <td class="mono">${escHTML(codigoInterno || '—')}</td>
            <td class="cont-col-produto" title="${escHTML(produto)}">${escHTML(produto)}</td>
            <td class="mono">${escHTML(codigoBipado || '—')}</td>
            <td class="mono" style="font-weight:700;font-size:.9rem;text-align:right">${ultima.quantidade ?? '—'}</td>
            <td><span class="badge b-blue">${etapa}</span></td>
            <td>
              ${excluida
                ? `<span class="badge b-gray">🗑 Excluída</span>`
                : (() => {
                    const rodada = _resultadoRodadaEndereco(c);
                    return rodada
                      ? `<span class="badge ${rodada.cls}" title="Resultado final considerando as rodadas de recontagem">${rodada.texto}</span>`
                      : `<span class="badge ${contStatusBadge(c.status)}">${c.status || 'PENDENTE'}</span>`;
                  })()
              }
            </td>
            <td>
              ${excluida
                ? `<button class="btn btn-ghost btn-sm" onclick="restaurarContagem('${c.id}')" title="Restaurar contagem">↩ Restaurar</button>`
                : `<div style="display:flex;gap:4px">
                     <button class="btn btn-danger btn-sm" onclick="abrirEstorno('${c.id}')" title="Estornar — libera endereço com registro">↩ Estornar</button>
                   </div>`
              }
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  requestAnimationFrame(() => {
    const sc=document.querySelector('#cont-table-wrap .cont-table-scroll');
    if(sc) sc.scrollLeft=scrollAnterior;
  });
 }

// Exporta exatamente as linhas atualmente exibidas na aba Contagens.
// A leitura original permanece no historico, mas os campos operacionais
// (produto, quantidade, operador e horario) usam a ultima rodada concluida.
function exportarContagens(){
  const lista = Array.isArray(window.__contagensVisiveis)
    ? window.__contagensVisiveis.slice()
    : [];

  if(!lista.length){
    if(typeof toast === 'function') toast('Nenhuma contagem visivel para exportar.', 'w');
    else alert('Nenhuma contagem visivel para exportar.');
    return;
  }

  const st = state();
  const textoStatus = c => {
    const r = _resultadoRodadaEndereco(c);
    return r?.texto ? String(r.texto).replace(/[✅❌⏳🔴⚠️]/g,'').trim() : String(c.status || 'PENDENTE');
  };
  const inventarioTexto = c => {
    const inv = (st.inventarios || []).find(i =>
      [i.id,i.codigo,i.nome,i.inventario_id,i.inventarioId]
        .filter(Boolean).map(String)
        .includes(String(c.inventario_id || c.inventarioId || ''))
    );
    return inv ? `${inv.codigo || inv.id || ''}${inv.nome ? ' - ' + inv.nome : ''}` : String(c.inventario_id || c.inventarioId || '');
  };
  const valorSeguro = v => {
    const t = String(v ?? '');
    return /^[=+@]/.test(t) || /^-\D/.test(t) ? "'" + t : t;
  };

  const linhas = lista.map(c => {
    const ultima = _ultimaRodadaContagem(c);
    const codigoBipado = String(ultima.produto || '').trim();
    const cadastro = window.DTProdutos?.buscarSync?.(codigoBipado);
    const codigoInterno = String(cadastro?.codigoInterno || cadastro?.codigo_interno || cadastro?.codigoProduto || c?.codigo_produto || c?.codigoProduto || '').trim();
    const produto = String(ultima.descricao || (cadastro?.encontrado ? cadastro.nomeProduto : '') || 'Código sem cadastro').trim();
    return {
      'Última atualização': fmtTs(ultima.data || c.timestamp || c.criado_em || c.dataHora),
      'Operador': ultima.operador || c.operador || '',
      'Inventário': inventarioTexto(c),
      'Endereço': c.endereco || '',
      'Código': valorSeguro(codigoInterno),
      'Produto': valorSeguro(produto),
      'DUN/GTIN': valorSeguro(codigoBipado),
      'Quantidade': ultima.quantidade ?? '',
      'Última etapa': ultima.rodada === 1 ? '1ª contagem' : `${ultima.rodada}ª contagem`,
      'Status': textoStatus(c)
    };
  });
  const agora = new Date();
  const carimbo = agora.toISOString().slice(0,19).replace(/[:T]/g,'-');
  const nome = `contagens-${carimbo}.xlsx`;

  if(window.XLSX?.utils?.json_to_sheet && window.XLSX?.writeFile){
    const ws = XLSX.utils.json_to_sheet(linhas);
    const larguras = Object.keys(linhas[0] || {}).map(chave => ({
      wch: Math.min(48, Math.max(chave.length + 2, ...linhas.map(l => String(l[chave] ?? '').length + 2)))
    }));
    ws['!cols'] = larguras;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contagens');
    XLSX.writeFile(wb, nome);
  } else {
    const colunas = Object.keys(linhas[0] || {});
    const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv = '\uFEFF' + [colunas.map(esc).join(';')]
      .concat(linhas.map(l => colunas.map(k => esc(l[k])).join(';')))
      .join('\r\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome.replace(/\.xlsx$/i,'.csv');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if(typeof toast === 'function') toast(`${linhas.length} contagem(ns) exportada(s).`, 's');
}
window.exportarContagens = exportarContagens;



// ───────────────────────────────────────────────────────────────────
//  ATRIBUIÇÃO DE ENDEREÇOS PENDENTES
// ───────────────────────────────────────────────────────────────────
let _pendSelecionados = new Set();
let _pendAtribuicoes = new Map();
let _pendAtribInvCarregado = '';
let _pendAtribCarregando = false;

function _pendChave(invId, endereco) {
  return `${String(invId || '').trim()}|${String(endereco || '').trim().toUpperCase()}`;
}
function _pendDocId(invId, endereco) {
  return encodeURIComponent(_pendChave(invId, endereco)).replace(/%/g, '_');
}
function _pendAtribuicao(invId, endereco) {
  return _pendAtribuicoes.get(_pendChave(invId, endereco)) || null;
}
async function _pendCarregarAtribuicoes(invId) {
  if (!invId || _pendAtribCarregando || _pendAtribInvCarregado === String(invId)) return;
  _pendAtribCarregando = true;
  try {
    const raw = window.getDTRawFirestore?.() || window.FS_AN;
    if (!raw) return;
    const snap = await raw.collection('dt_atribuicoes_contagem').where('inventario_id', '==', String(invId)).get();
    _pendAtribuicoes = new Map();
    snap.docs.forEach(doc => {
      const a = { id: doc.id, ...doc.data() };
      if (String(a.status || 'PENDENTE').toUpperCase() !== 'CANCELADA') {
        _pendAtribuicoes.set(_pendChave(a.inventario_id, a.endereco), a);
      }
    });
    _pendAtribInvCarregado = String(invId);
  } catch (e) {
    console.warn('[Pendências] Falha ao carregar atribuições:', e?.message || e);
  } finally {
    _pendAtribCarregando = false;
    if (document.getElementById('pend-sel-inv')?.value === String(invId)) renderPendencias();
  }
}
function pendToggleEndereco(endereco, checked) {
  const key = String(endereco || '');
  if (checked) _pendSelecionados.add(key); else _pendSelecionados.delete(key);
  pendAtualizarBarraSelecao();
}
function pendToggleTodos(checked) {
  document.querySelectorAll('.pend-row-check:not(:disabled)').forEach(cb => {
    cb.checked = checked;
    const end = cb.getAttribute('data-endereco');
    if (checked) _pendSelecionados.add(end); else _pendSelecionados.delete(end);
  });
  pendAtualizarBarraSelecao();
}
function pendAtualizarBarraSelecao() {
  const bar = document.getElementById('pend-selection-bar');
  const count = document.getElementById('pend-selection-count');
  if (bar) bar.style.display = _pendSelecionados.size ? 'flex' : 'none';
  if (count) count.textContent = `${_pendSelecionados.size} endereço${_pendSelecionados.size === 1 ? '' : 's'} selecionado${_pendSelecionados.size === 1 ? '' : 's'}`;
}
async function abrirAtribuirPendencias(endereco) {
  if (endereco) {
    _pendSelecionados.clear();
    _pendSelecionados.add(String(endereco));
  }
  if (!_pendSelecionados.size) { showToast('Selecione pelo menos um endereço pendente', 'w'); return; }
  const resumo = document.getElementById('pend-atrib-resumo');
  if (resumo) resumo.innerHTML = `<div style="font-weight:700;margin-bottom:8px">📍 ${_pendSelecionados.size} endereço${_pendSelecionados.size===1?'':'s'}:</div><div style="display:flex;flex-wrap:wrap;gap:4px">${[..._pendSelecionados].map(e=>`<span class="badge b-yellow" style="font-size:.72rem">${escHTML(e)}</span>`).join('')}</div>`;
  const obs = document.getElementById('pend-atrib-obs');
  if (obs) obs.value = '';
  openModal('modal-atribuir-pendencias');
  if (typeof divPopularSelectOperadores === 'function') await divPopularSelectOperadores('pend-atrib-operador');
}
async function confirmarAtribuicaoPendencias() {
  const invId = document.getElementById('pend-sel-inv')?.value || '';
  const operador = document.getElementById('pend-atrib-operador')?.value?.trim();
  const obs = document.getElementById('pend-atrib-obs')?.value?.trim() || '';
  if (!invId) { showToast('Selecione um inventário', 'e'); return; }
  if (!operador) { showToast('Selecione um operador', 'e'); return; }
  const raw = window.getDTRawFirestore?.() || window.FS_AN;
  if (!raw) { showToast('Firebase indisponível', 'e'); return; }
  const agora = new Date().toISOString();
  const atribPor = window._currentAnalistaUser?.displayName || window._currentAnalistaUser?.email || 'Analista';
  const ends = [..._pendSelecionados];
  try {
    await Promise.all(ends.map(endereco => {
      const doc = {
        inventario_id: String(invId), endereco, operador, operador_responsavel: operador,
        atribuido_por: atribPor, atribuido_em: agora, observacao: obs,
        status: 'PENDENTE', tipo: 'CONTAGEM', atualizado_em: agora
      };
      _pendAtribuicoes.set(_pendChave(invId, endereco), doc);
      return raw.collection('dt_atribuicoes_contagem').doc(_pendDocId(invId, endereco)).set(doc, { merge:true });
    }));
    closeModal('modal-atribuir-pendencias');
    _pendSelecionados.clear();
    pendAtualizarBarraSelecao();
    renderPendencias();
    showToast(`✅ ${ends.length} endereço${ends.length===1?'':'s'} atribuído${ends.length===1?'':'s'} para ${operador}`, 's');
  } catch (e) {
    console.error('[Pendências] Erro ao atribuir:', e);
    showToast('Não foi possível salvar a atribuição', 'e');
  }
}
async function desvincularPendencia(endereco) {
  const invId = document.getElementById('pend-sel-inv')?.value || '';
  const raw = window.getDTRawFirestore?.() || window.FS_AN;
  if (!raw || !invId || !endereco) return;
  try {
    await raw.collection('dt_atribuicoes_contagem').doc(_pendDocId(invId, endereco)).set({ status:'CANCELADA', operador:null, operador_responsavel:null, cancelada_em:new Date().toISOString() }, { merge:true });
    _pendAtribuicoes.delete(_pendChave(invId, endereco));
    renderPendencias();
    showToast('Endereço desvinculado', 's');
  } catch (e) { showToast('Não foi possível desvincular', 'e'); }
}
window.pendToggleEndereco = pendToggleEndereco;
window.pendToggleTodos = pendToggleTodos;
window.abrirAtribuirPendencias = abrirAtribuirPendencias;
window.confirmarAtribuicaoPendencias = confirmarAtribuicaoPendencias;
window.desvincularPendencia = desvincularPendencia;


// ───────────────────────────────────────────────────────────────────
//  PRODUTOS / PALETES ESPERADOS NAS PENDÊNCIAS
// ───────────────────────────────────────────────────────────────────
function _pendNumero(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return 0;
  const n = Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function _pendQtdBase(item) {
  return _pendNumero(item?.quantidade_esperada ?? item?.quantidadeEsperada ?? item?.qtd_esperada ?? item?.qtdEsperada ??
    item?.quantidade_enderecada ?? item?.qtd_enderecada ?? item?.saldo_estoque ?? item?.saldo ?? item?.saldo_erp ??
    item?.qtd_sistema ?? item?.qtd_estoque ?? item?.estoque_total ?? item?.estoque ?? item?.quantidade ?? item?.qtd ?? item?.qtde);
}
function _pendCodigoProdutoBase(item) {
  return String(item?.codigo_produto ?? item?.codigoProduto ?? item?.codigo_interno ?? item?.codigoInterno ??
    item?.produto_codigo ?? item?.produtoCodigo ?? item?.gtin ?? item?.ean ?? item?.dun ?? item?.produto ?? 'SEM_PRODUTO').trim();
}
function _pendDescricaoProdutoBase(item, codigo) {
  const propria = String(item?.descricao_produto ?? item?.descricaoProduto ?? item?.produto_descricao ??
    item?.nomeProduto ?? item?.nome_produto ?? item?.descricao ?? '').trim();
  if (propria) return propria;
  const ach = window.DTProdutos?.buscarSync?.(codigo);
  return ach?.encontrado ? String(ach.nomeProduto || ach.descricao || '').trim() : '';
}
function _pendIdPaleteBase(item, indice) {
  return String(item?.palete ?? item?.pallet ?? item?.numero_palete ?? item?.numeroPalete ?? item?.capa_palete ??
    item?.capa ?? item?.sscc ?? item?.lote ?? `Palete ${indice + 1}`).trim();
}
function _pendProdutosEndereco(inv, endereco) {
  const norm = v => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const itens = (Array.isArray(inv?.base) ? inv.base : []).filter(item => norm(item?.endereco) === norm(endereco));
  const grupos = new Map();
  itens.forEach((item, indice) => {
    const codigo = _pendCodigoProdutoBase(item);
    const descricao = _pendDescricaoProdutoBase(item, codigo);
    const chave = `${String(codigo).toUpperCase()}|${String(descricao).toUpperCase()}`;
    if (!grupos.has(chave)) grupos.set(chave, { chave, codigo, descricao, quantidade_total:0, paletes:[] });
    const grupo = grupos.get(chave);
    const quantidade = _pendQtdBase(item);
    grupo.quantidade_total += quantidade;
    grupo.paletes.push({ identificador:_pendIdPaleteBase(item, indice), quantidade, item });
  });
  return [...grupos.values()].sort((a,b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', {numeric:true}));
}
function abrirDetalheProdutoPendencia(invId, endereco, produtoChave) {
  const inv = getInventarioPorId(invId);
  if (!inv) return showToast('Inventário não encontrado.', 'e');
  const produto = _pendProdutosEndereco(inv, endereco).find(p => p.chave === produtoChave);
  if (!produto) return showToast('Produto não encontrado na base desse endereço.', 'e');
  document.getElementById('modal-pend-produto-bg')?.remove();
  const linhas = produto.paletes.map((p, i) => `<div style="display:grid;grid-template-columns:minmax(120px,1fr) minmax(110px,.45fr);gap:14px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border)">
    <div><div style="font-size:.65rem;color:var(--muted);font-weight:700">PALETE ${i+1}</div><div class="mono" style="font-weight:850;margin-top:2px">${escHTML(p.identificador)}</div></div>
    <div style="text-align:right"><div style="font-size:.65rem;color:var(--muted);font-weight:700">QUANTIDADE</div><div class="mono" style="font-size:1.05rem;font-weight:900">${escHTML(p.quantidade)}</div></div>
  </div>`).join('');
  document.body.insertAdjacentHTML('beforeend', `<div id="modal-pend-produto-bg" class="modal-bg open" style="display:flex;z-index:99999" onclick="if(event.target===this)this.remove()">
    <div class="modal" style="width:min(720px,94vw);max-height:88vh;overflow:hidden;display:flex;flex-direction:column">
      <div class="modal-head"><div><div class="modal-title">📦 Paletes do produto</div><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Endereço <span class="mono">${escHTML(endereco)}</span></div></div><button class="modal-x" onclick="document.getElementById('modal-pend-produto-bg')?.remove()">×</button></div>
      <div style="padding:14px 16px;background:rgba(59,130,246,.06);border-bottom:1px solid var(--border)">
        <div class="mono" style="font-weight:900">${escHTML(produto.codigo)}</div>
        <div style="font-size:.82rem;margin-top:3px">${escHTML(produto.descricao || 'Produto sem descrição')}</div>
        <div style="display:flex;gap:18px;margin-top:10px;font-size:.78rem"><strong>${produto.paletes.length} palete${produto.paletes.length===1?'':'s'}</strong><strong>Total: <span class="mono">${escHTML(produto.quantidade_total)}</span></strong></div>
      </div>
      <div style="overflow:auto">${linhas || '<div class="empty"><div class="empty-title">Nenhum palete cadastrado</div></div>'}</div>
    </div>
  </div>`);
}
window.abrirDetalheProdutoPendencia = abrirDetalheProdutoPendencia;

// ───────────────────────────────────────────────────────────────────
//  15. RENDERIZAÇÃO — PENDÊNCIAS
// ───────────────────────────────────────────────────────────────────

function renderPendencias() {
  const selInv = document.getElementById('pend-sel-inv');
  const buscaBruta = String(document.getElementById('pend-busca')?.value || '').trim().toLowerCase();
  const normalizarBuscaPend = v => String(v ?? '').trim().toLowerCase();
  const normalizarEnderecoPend = v => normalizarBuscaPend(v).replace(/[^a-z0-9]/g, '');
  const buscaEndereco = normalizarEnderecoPend(buscaBruta);
  const fStatus= document.getElementById('pend-fstatus')?.value || '';
  const fLocal = document.getElementById('pend-flocal')?.value || '';
  const fRua   = document.getElementById('pend-frua')?.value || '';
  const invId  = selInv?.value || '';
  if (invId && _pendAtribInvCarregado !== String(invId)) _pendCarregarAtribuicoes(invId);

  // Preencher select de inventários
  if (selInv) {
    const cur = selInv.value;
    selInv.innerHTML = '<option value="">Selecione um inventário...</option>' +
      state().inventarios.filter(i => ['ATIVO','ABERTO','PUBLICADO','LIBERADO','EM_ANDAMENTO','PAUSADO'].includes(String(i.status||'').toUpperCase()) || i.enderecos_selecionados?.length).map(i =>
        `<option value="${i.id}" ${i.id === cur ? 'selected' : ''}>${i.codigo} — ${i.nome}</option>`
      ).join('');
    if (cur) selInv.value = cur;
  }

  if (!invId) {
    document.getElementById('pend-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Selecione um inventário</div></div>`;
    ['pk-total','pk-contados','pk-pendentes','pk-pct'].forEach(id => document.getElementById(id).textContent = '—');
    return;
  }

  const inv = getInventarioPorId(invId);
  if (!inv) return;

  // Usar state().enderecosLista como base oficial de endereços
  const st = state();
  const conts = (st.contagens || []).filter(c => String(c.inventario_id || c.inventarioId || '') === String(invId) && !c._excluida && c.status !== 'ESTORNADA');
  const endsContadosSet = new Set(conts.filter(c => !_isVazio(c)).map(c => c.endereco));
  const endsVaziosConfSet = new Set(conts.filter(c => _isVazio(c) && c.status !== 'ESTORNADA').map(c => c.endereco));
  const enderecosLista = st.enderecosLista || [];

  const selecionados = Array.isArray(inv.enderecos_selecionados) ? inv.enderecos_selecionados : [];
  const selecionadosSet = new Set(selecionados.map(x => String(typeof x === 'string' ? x : (x.endereco || x.id || ''))).filter(Boolean));
  const baseInventario = selecionadosSet.size
    ? enderecosLista.filter(e => selecionadosSet.has(String(e.endereco || e.id || '')))
    : (Array.isArray(inv.base) && inv.base.length ? inv.base : enderecosLista);

  // Enriquecer a base do inventário com status de contagem
  const lista = baseInventario.map(e => {
    const endInfo  = e; // já é o objeto completo do ENDDB
    const contado  = endsContadosSet.has(e.endereco);
    const vazioConf = endsVaziosConfSet.has(e.endereco);
    const inativo  = e.ativo === false;
    const cap      = e.capacidade_paletes ?? null;
    const usados   = getPaletesUsados(invId, e.endereco);
    const limiteTingido = !inativo && cap !== null && cap > 0 && usados >= cap;

    let status_pend;
    if (contado)             status_pend = 'CONTADO';
    else if (vazioConf)      status_pend = 'VAZIO_CONFIRMADO';
    else if (inativo)        status_pend = 'INATIVO';
    else if (limiteTingido)  status_pend = 'LIMITE_ATINGIDO';
    else                     status_pend = 'PENDENTE';

    const atribuicao = _pendAtribuicao(invId, e.endereco);
    const produtos = _pendProdutosEndereco(inv, e.endereco);
    return { ...e, contado, vazioConf, inativo, limiteTingido, usados, status_pend, atribuicao, produtos };
  });

  // Filtro de locais
  const locFlt = document.getElementById('pend-flocal');
  if (locFlt) {
    const locais = [...new Set(lista.map(e => e.setor || '—'))].sort();
    locFlt.innerHTML = '<option value="">Todos os locais</option>' + locais.map(l => `<option value="${l}" ${l === fLocal ? 'selected' : ''}>${l}</option>`).join('');
  }

  // Filtro de ruas
  const ruaFlt = document.getElementById('pend-frua');
  if (ruaFlt) {
    const ruas = [...new Set(lista.map(e => e.rua || extrairRua(e.endereco) || '—'))].sort((a,b) => a.localeCompare(b,'pt-BR',{numeric:true}));
    ruaFlt.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(r => `<option value="${r}" ${r === fRua ? 'selected' : ''}>Rua ${r}</option>`).join('');
  }

  // Filtros
  let filtrado = lista;
  if (fStatus) filtrado = filtrado.filter(e => e.status_pend === fStatus);
  if (fLocal)  filtrado = filtrado.filter(e => (e.setor || '—') === fLocal);
  if (fRua)    filtrado = filtrado.filter(e => (e.rua || extrairRua(e.endereco) || '—') === fRua);
  if (buscaBruta) filtrado = filtrado.filter(e => {
    const endereco = normalizarBuscaPend(e.endereco);
    const enderecoNormalizado = normalizarEnderecoPend(e.endereco);
    const setor = normalizarBuscaPend(e.setor);
    const rua = normalizarBuscaPend(e.rua || extrairRua(e.endereco));
    const produtosTexto = normalizarBuscaPend((e.produtos || []).map(p => `${p.codigo} ${p.descricao}`).join(' '));
    return endereco.includes(buscaBruta) ||
      (buscaEndereco && enderecoNormalizado.includes(buscaEndereco)) ||
      setor.includes(buscaBruta) ||
      rua.includes(buscaBruta) ||
      produtosTexto.includes(buscaBruta);
  });
  window.__pendenciasVisiveis = filtrado.map(e => ({
    inventario: inv.codigo || inv.nome || inv.id,
    endereco: e.endereco || '',
    produto: (e.produtos || []).map(p => `${p.codigo || ''} ${p.descricao || ''}`.trim()).join(' | '),
    quantidade: (e.produtos || []).reduce((total, p) => total + Number(p.quantidade_total || 0), 0),
    local: e.setor || e.local || '',
    rua: e.rua || extrairRua(e.endereco) || '',
    status: e.status_pend || ''
  }));

  // KPIs — conferidos = contados + vazios_confirmados (ambos saem das pendências)
  const total        = lista.length;
  const contados     = lista.filter(e => e.status_pend === 'CONTADO').length;
  const vaziosConf   = lista.filter(e => e.status_pend === 'VAZIO_CONFIRMADO').length;
  const conferidos   = contados + vaziosConf;
  const pendentes    = lista.filter(e => e.status_pend === 'PENDENTE').length;
  const inativos     = lista.filter(e => e.status_pend === 'INATIVO').length;
  const limiteAting  = lista.filter(e => e.status_pend === 'LIMITE_ATINGIDO').length;
  const elegíveis    = total - inativos;  // base real para % de progresso
  const pct          = elegíveis > 0 ? Math.round((conferidos / elegíveis) * 100) : 0;

  document.getElementById('pk-total').textContent    = total.toLocaleString('pt-BR');
  document.getElementById('pk-contados').textContent  = `${conferidos.toLocaleString('pt-BR')}${vaziosConf > 0 ? ` (${vaziosConf} vaz.)` : ''}`;
  document.getElementById('pk-pendentes').textContent = `${pendentes} + ${limiteAting}🔒`;
  document.getElementById('pk-pct').textContent       = pct + '%';

  if (!filtrado.length) {
    document.getElementById('pend-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Nenhum endereço encontrado com esses filtros</div></div>`;
  } else {

  const statusLabel = {
    CONTADO:          { cls: 'b-green',   txt: '✓ Contado' },
    VAZIO_CONFIRMADO: { cls: 'b-gray',    txt: '🔲 Vazio' },
    PENDENTE:         { cls: 'b-yellow',  txt: '⏳ Pendente' },
    INATIVO:          { cls: 'b-gray',    txt: '⛔ Inativo' },
    LIMITE_ATINGIDO:  { cls: 'b-blocked', txt: '🔒 Limite' },
  };

  document.getElementById('pend-table-wrap').innerHTML = `
    ${inativos > 0 ? `<div class="alert warn" style="margin:12px 16px 0;border-radius:8px">⛔ ${inativos} endereço(s) inativo(s) não serão contabilizados no progresso.</div>` : ''}
    ${limiteAting > 0 ? `<div class="alert warn" style="margin:8px 16px 0;border-radius:8px">🔒 ${limiteAting} endereço(s) com limite de paletes atingido.</div>` : ''}
    <div id="pend-selection-bar" style="display:${_pendSelecionados.size?'flex':'none'};align-items:center;justify-content:space-between;gap:12px;margin:12px 16px 0;padding:10px 12px;border:1px solid rgba(232,117,26,.28);background:rgba(232,117,26,.06);border-radius:10px"><strong id="pend-selection-count">${_pendSelecionados.size} endereço(s) selecionado(s)</strong><button class="btn btn-primary btn-sm" onclick="abrirAtribuirPendencias()">👥 Atribuir selecionados</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th style="width:38px"><input type="checkbox" onchange="pendToggleTodos(this.checked)" title="Selecionar pendentes"></th><th>Endereço</th><th>Produto</th><th>Quantidade total</th><th>Paletes do produto</th><th>Local/Área</th><th>Operador atribuído</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>
        ${filtrado.flatMap(e => {
          const s = statusLabel[e.status_pend] || { cls:'b-gray', txt: e.status_pend };
          const cap = e.capacidade_paletes !== null ? String(e.capacidade_paletes) : '∞';
          const podeAtribuir = e.status_pend === 'PENDENTE';
          const op = e.atribuicao?.operador || e.atribuicao?.operador_responsavel || '';
          const opCurto = typeof _nomeCurtoOperador === 'function' ? _nomeCurtoOperador(op) : op;
          const produtos = e.produtos?.length ? e.produtos : [{chave:'SEM_PRODUTO',codigo:'—',descricao:'Nenhum produto cadastrado',quantidade_total:0,paletes:[]}];
          return produtos.map((produto, indiceProduto) => `<tr style="${e.inativo || e.limiteTingido ? 'opacity:.6' : ''}">
            <td><input class="pend-row-check" data-endereco="${escHTML(e.endereco)}" type="checkbox" ${_pendSelecionados.has(e.endereco)?'checked':''} ${podeAtribuir?'':'disabled'} onchange="pendToggleEndereco('${escHTML(e.endereco)}',this.checked)"></td>
            <td class="mono">${escHTML(e.endereco)}</td>
            <td><div style="text-align:left;white-space:normal;cursor:pointer" onclick="abrirDetalheProdutoPendencia('${escHTML(invId)}','${escHTML(e.endereco)}',${JSON.stringify(produto.chave)})"><span><span class="mono" style="font-weight:850">${escHTML(produto.codigo)}</span>${produto.descricao?`<span style="display:block;font-size:.69rem;color:var(--muted);margin-top:2px">${escHTML(produto.descricao)}</span>`:''}</span></div></td>
            <td class="mono" style="font-weight:900">${escHTML(produto.quantidade_total)}</td>
            <td><div role="button" style="text-align:left;white-space:normal;justify-content:flex-start;padding:0;margin:0;cursor:pointer" onclick="abrirDetalheProdutoPendencia('${escHTML(invId)}','${escHTML(e.endereco)}',${JSON.stringify(produto.chave)})">📦 ${produto.paletes.length} — detalhar</div></td>
            <td>${escHTML(e.setor || '—')}</td>
            <td>${op ? `<span class="badge b-purple">👤 ${escHTML(opCurto)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
            <td><span class="badge ${s.cls}">${s.txt}</span></td>
            <td>${podeAtribuir ? (op ? `<button class="btn btn-ghost btn-sm" onclick="desvincularPendencia('${escHTML(e.endereco)}')">Desvincular</button>` : `<button class="btn btn-primary btn-sm" onclick="abrirAtribuirPendencias('${escHTML(e.endereco)}')">👥 Atribuir</button>`) : '—'}</td>
          </tr>`);
        }).join('')}
      </tbody>
    </table></div>`;
  }

  // Update end count display
  const endCountEl = document.getElementById('pend-end-count');
  if (endCountEl) endCountEl.textContent = `${pendentes} endereço(s) aguardando de ${total} total`;

  // ── SEÇÃO: Recontagens pendentes ──────────────────────────────────
  const recPend = (state().recontagens || []).filter(r => String(r.inventario_id || r.inventarioId || '') === String(invId) && String(r.status || '').toUpperCase() === 'PENDENTE');
  const recSec = document.getElementById('pend-rec-section');
  const pkRecPend = document.getElementById('pk-rec-pend');
  if (pkRecPend) pkRecPend.textContent = recPend.length.toLocaleString('pt-BR');
  if (recSec) {
    if (recPend.length > 0) {
      recSec.style.display = '';
      document.getElementById('pend-rec-count').textContent = `${recPend.length} recontagem(ns) pendente(s)`;
      document.getElementById('pend-rec-wrap').innerHTML = `
        <div class="tbl-wrap"><table>
          <thead><tr><th>Endereço</th><th>Produto</th><th>Qtd Sistema</th><th>1ª Contagem</th><th>Diferença</th><th>Ação</th></tr></thead>
          <tbody>
            ${recPend.slice(0,10).map(r => {
              const diff = r.qtd_primeira - r.qtd_esperada;
              return `<tr>
                <td class="mono">${r.endereco}</td>
                <td style="font-size:.82rem">${r.produto}</td>
                <td class="mono">${r.qtd_esperada}</td>
                <td class="mono" style="color:var(--danger);font-weight:700">${r.qtd_primeira}</td>
                <td class="mono" style="font-weight:800;color:${diff>0?'var(--warn)':'var(--danger)'}">
                  ${diff>0?'+':''}${diff}
                </td>
                <td><button class="btn btn-primary btn-sm" onclick="abrirRegistrarRecontagem('${r.id}')">📝 Registrar</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
        ${recPend.length > 10 ? `<div style="padding:8px 16px;font-size:.75rem;color:var(--muted)">... e mais ${recPend.length-10}. Veja a aba Recontagem.</div>` : ''}`;
    } else {
      recSec.style.display = 'none';
    }
  }

  // ── SEÇÃO: Divergências abertas ──────────────────────────────────
  const divAbertas = (state().divergencias || []).filter(d => String(d.inventario_id || d.inventarioId || '') === String(invId) && ['ABERTA','DIVERGENTE','PENDENTE','PERSISTENTE','EM_RECONTAGEM'].includes(String(d.status || '').toUpperCase()));
  const divSec = document.getElementById('pend-div-section');
  const pkDivAbertas = document.getElementById('pk-div-abertas');
  if (pkDivAbertas) pkDivAbertas.textContent = divAbertas.length.toLocaleString('pt-BR');
  if (divSec) {
    if (divAbertas.length > 0) {
      divSec.style.display = '';
      document.getElementById('pend-div-count').textContent = `${divAbertas.length} divergência(s) aberta(s)`;
      document.getElementById('pend-div-wrap').innerHTML = `
        <div class="tbl-wrap"><table>
          <thead><tr><th>Endereço</th><th>Produto</th><th>Qtd Sistema</th><th>Qtd Contada</th><th>Diferença</th><th>Status</th></tr></thead>
          <tbody>
            ${divAbertas.slice(0,10).map(d => {
              const difColor = d.diferenca > 0 ? 'var(--warn)' : 'var(--danger)';
              return `<tr>
                <td class="mono">${escHTML(d.endereco)}</td>
                <td style="font-size:.82rem">${escHTML(d.produto)}</td>
                <td class="mono">${d.qtd_esperada}</td>
                <td class="mono" style="font-weight:700;color:${d.qtd_contada<d.qtd_esperada?'var(--danger)':'var(--warn)'}">${d.qtd_contada}</td>
                <td class="mono" style="font-weight:800;color:${difColor}">${d.diferenca>0?'+':''}${d.diferenca}</td>
                <td><span class="badge ${d.status === 'EM_RECONTAGEM' ? 'b-orange' : 'b-red'}">${d.status === 'EM_RECONTAGEM' ? 'Em Recontagem' : 'Aberta'}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
        ${divAbertas.length > 10 ? `<div style="padding:8px 16px;font-size:.75rem;color:var(--muted)">... e mais ${divAbertas.length-10}. Veja a aba Recontagem.</div>` : ''}`;
    } else {
      divSec.style.display = 'none';
    }
  }
}
