function state(){ return window.AnalistaStore.getState(); }

function _produtoContagemExibicao(c){
  const codigo=c?.codigo_produto||c?.codigoProduto||c?.gtin||c?.ean||c?.dun||c?.codigo_lido||c?.codigoLido||'';
  const atual=String(c?.descricao_produto||c?.descricaoProduto||c?.descricao||'').trim();
  const placeholder=!atual||/^(PRODUTO NAO IDENTIFICADO|PRODUTO NÃO IDENTIFICADO|PRODUTO NAO CADASTRADO|PRODUTO NÃO CADASTRADO|CODIGO SEM CADASTRO|CÓDIGO SEM CADASTRO)$/i.test(atual);
  const ach=window.DTProdutos?.buscarSync?.(codigo);
  return {codigo:codigo||ach?.codigoInterno||ach?.gtin||ach?.dun||'',descricao:(!placeholder?atual:'')||(ach?.encontrado?ach.nomeProduto:'Código sem cadastro')};
}

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
  const st = state();
  const FK = window.InventoryFlowKey;
  if (!FK) return { texto:'⚠️ Status indisponível', cls:'b-orange' };
  const invCanonico = FK.inventario(c, st.inventarios);
  const end = FK.endereco(c.endereco);
  const produto = FK.produto(c);
  const idContagem = String(c.uuid || c.id || '');

  // O vínculo é resolvido em três níveis, sempre dentro do mesmo inventário e
  // endereço: ID explícito da contagem, chave operacional completa e, por fim,
  // única divergência do endereço. Registros antigos podem usar ID/código/nome
  // do inventário e GTIN/código interno do produto.
  const divsMesmoEndereco = (st.divergencias || []).filter(d =>
    FK.inventario(d, st.inventarios) === invCanonico &&
    FK.endereco(d.endereco) === end &&
    !['CANCELADA','EXCLUIDA','ESTORNADA'].includes(String(d.status || '').trim().toUpperCase())
  );
  const divPorId = divsMesmoEndereco.find(d =>
    idContagem && [d.contagem_uuid,d.contagem_id,d.origem_contagem_id]
      .filter(Boolean).map(String).includes(idContagem)
  );
  const divPorProduto = divsMesmoEndereco.find(d => FK.produto(d) === produto);
  const ativas = divsMesmoEndereco.filter(d => {
    const sd=String(d.status || '').trim().toUpperCase();
    const sr=String(d.status_recontagem || '').trim().toLowerCase();
    return ['ABERTA','DIVERGENTE','PENDENTE','EM_RECONTAGEM'].includes(sd) ||
      ['pendente','atribuida','atribuída','em_andamento','aguardando_analista'].includes(sr) ||
      d.divergente === true || d.precisa_recontagem === true;
  });
  const div = divPorId || divPorProduto || (ativas.length === 1 ? ativas[0] : null) ||
    (divsMesmoEndereco.length === 1 ? divsMesmoEndereco[0] : null);

  if (!div) {
    const statusContagem = String(c.status || '').trim().toUpperCase();
    const possuiSinalDivergencia = c.divergente === true || c._alertaQtd === true ||
      c.divergencia_potencial === true || statusContagem === 'DIVERGENTE' ||
      divsMesmoEndereco.length > 0;

    if (possuiSinalDivergencia) {
      return { texto:'❌ Divergente — aguardando decisão', cls:'b-red' };
    }

    // Ausência momentânea de divergência não significa que a 1ª contagem foi
    // aprovada. A análise que compara a contagem com a base é assíncrona e pode
    // ainda não ter criado/vinculado a divergência. Portanto, OK 1ª somente é
    // exibido depois que o processamento marcou explicitamente a contagem como
    // PROCESSADO (ou um status equivalente de conclusão).
    const primeiraProcessada = ['PROCESSADO','OK','CONCLUIDA','CONCLUÍDA','RESOLVIDA']
      .includes(statusContagem);
    if (String(c.tipo_contagem || 'PRIMEIRA').toUpperCase() !== 'RECONTAGEM' && primeiraProcessada) {
      return { texto:'✅ OK 1ª', cls:'b-green' };
    }

    if (String(c.tipo_contagem || 'PRIMEIRA').toUpperCase() !== 'RECONTAGEM') {
      return { texto:'⏳ Aguardando processamento', cls:'b-orange' };
    }
    return null;
  }

  const statusConcluido = r => {
    const status = String(r.status_recontagem || r.status || '').trim().toUpperCase();
    const dataConclusao = r.recontagem_concluida_em || r.concluida_em ||
      r.data_conclusao || r.finalizada_em || r.processada_em || null;
    const statusOk = ['CONCLUIDA','CONCLUÍDA','FINALIZADA','PROCESSADA','RESOLVIDA'].includes(status);
    const statusBloqueado = ['PENDENTE','ATRIBUIDA','ATRIBUÍDA','EM_ANDAMENTO','ABERTA','CANCELADA','EXCLUIDA'].includes(status);
    return r.qtd_recontagem != null && !statusBloqueado && (statusOk || Boolean(dataConclusao));
  };

  // Só considera recontagens realmente concluídas e vinculadas à divergência exata.
  const recs = (st.recontagens || [])
    .filter(r => (String(r.divergencia_id || '') === String(div.id || '') || FK.mesmo(r, div, st.inventarios)) && statusConcluido(r))
    .sort((a,b) => {
      const na=Number(a.numero_recontagem || 0), nb=Number(b.numero_recontagem || 0);
      if (na !== nb) return na - nb;
      return String(a.recontagem_concluida_em || a.concluida_em || a.finalizada_em || '')
        .localeCompare(String(b.recontagem_concluida_em || b.concluida_em || b.finalizada_em || ''));
    });

  // A própria existência de uma divergência ativa prevalece sobre um possível
  // empate acidental entre a leitura e um qtd_esperada parcial/legado. Sem uma
  // recontagem concluída, esta linha ainda está divergente e jamais pode ser OK 1ª.
  const statusDiv = String(div.status || '').trim().toUpperCase();
  const statusRecDiv = String(div.status_recontagem || '').trim().toLowerCase();
  const divergenciaAtiva =
    ['ABERTA','DIVERGENTE','PENDENTE','EM_RECONTAGEM'].includes(statusDiv) ||
    ['pendente','em_andamento','aguardando_analista'].includes(statusRecDiv);
  if (divergenciaAtiva && recs.length === 0) {
    return { texto:'❌ Divergente — aguardando recontagem', cls:'b-red' };
  }

  const base = {
    qtd_esperada: div.qtd_esperada,
    produto: div.produto || div.produto_contado || produto,
    qtd_primeira: div.qtd_primeira ?? div.qtd_contada ?? c.quantidade,
    produto_primeira: div.produto_primeira || div.produto_contado || produto,
    qtd_segunda: recs[0]?.qtd_recontagem ?? null,
    produto_segunda: recs[0]?.produto_recontagem || recs[0]?.produto || produto,
    qtd_terceira: recs[1]?.qtd_recontagem ?? null,
    produto_terceira: recs[1]?.produto_recontagem || recs[1]?.produto || produto
  };

  const avaliacao = window.AnalistaDivergenciasRuntime?.avaliarHistorico?.(base);
  if (!avaliacao) return { texto:'❌ Divergente — aguardando decisão', cls:'b-red' };

  // Trava de segurança: a rodada exibida nunca pode ser maior que a quantidade
  // de recontagens realmente concluídas (1ª + até duas recontagens).
  const rodadaMaximaReal = 1 + Math.min(recs.length, 2);
  const rodadaReal = Math.min(Number(avaliacao.rodada || 1), rodadaMaximaReal);

  if (avaliacao.estado === 'RESOLVIDA') {
    // Uma divergência encerrada manualmente, sem recontagem concluída, não pode
    // virar OK 1ª. OK 1ª só existe quando o próprio processamento registrou que
    // a primeira leitura bateu com o sistema.
    if (rodadaReal === 1) {
      const motivo = String(div.motivo_resolucao || div.referencia_resolucao || div.resultado || '').toUpperCase();
      const okPrimeiraExplicito = motivo.includes('OK_PRIMEIRA') || motivo.includes('OK 1') ||
        div.ok_primeira === true || div.resultado_primeira === 'OK';
      return okPrimeiraExplicito
        ? { texto:'✅ OK 1ª', cls:'b-green' }
        : { texto:'✅ Resolvida pelo analista', cls:'b-green' };
    }
    return { texto:`✅ OK ${rodadaReal}ª`, cls:'b-green' };
  }
  if (recs.length >= 2 && avaliacao.estado === 'PERSISTENTE') {
    return { texto:'🔴 Persistente (3 rodadas)', cls:'b-red' };
  }
  if (recs.length === 1) return { texto:'⏳ Aguardando 3ª contagem', cls:'b-orange' };
  return { texto:'❌ Divergente — aguardando decisão', cls:'b-red' };
}

// ───────────────────────────────────────────────────────────────────
//  14. RENDERIZAÇÃO — CONTAGENS
// ───────────────────────────────────────────────────────────────────

function renderContagens() {
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
      state().inventarios.map(i => `<option value="${i.id}" ${i.id === cur ? 'selected' : ''}>${i.codigo} — ${i.nome}</option>`).join('');
    if (cur) selInv.value = cur;
  }

  let dados = state().contagens || [];
  // Cada rodada de recontagem gerava sua própria linha aqui, então um endereço
  // recontado 2x aparecia 3x na lista (1ª + 2ª + 3ª) — confuso e redundante,
  // já que essas rodadas já são exibidas com detalhe na aba Recontagem. Por
  // padrão mostramos só a 1ª contagem de cada endereço, com um badge dizendo
  // em qual rodada ele finalmente bateu. Quem quiser ver as rodadas de
  // recontagem em si pode filtrar explicitamente por Tipo = Recontagem.
  if (!fTipo) {
    dados = dados.filter(c => c.tipo_contagem !== 'RECONTAGEM');
    const grupos = new Map();
    const chaveContagem = c => {
      const id=String(c.inventario_id || c.inventarioId || '');
      const inv=(state().inventarios || []).find(i =>
        [i.id,i.codigo,i.nome,i.inventario_id,i.inventarioId]
          .filter(Boolean).map(String).includes(id));
      return FK.chave(Object.assign({}, c, { inventario_id: inv?.id || id }), state().inventarios);
    };
    dados.forEach(c => {
      const chave=chaveContagem(c);
      const atual=grupos.get(chave);
      const data=x=>String(x.timestamp || x.criado_em || x.dataHora || '');
      if (!atual || data(c).localeCompare(data(atual)) < 0) grupos.set(chave,c);
    });
    dados=[...grupos.values()];
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

  // KPIs Contagens
  const _allConts = state().contagens.filter(c => !c._excluida && c.status !== 'ESTORNADA');
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
    selRua.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(r => `<option value="${r}" ${r===fRua?'selected':''}>${r}</option>`).join('');
  }
  const selOp = document.getElementById('cont-foperador');
  if (selOp) {
    const ops = [...new Set(state().contagens.map(c => c.operador).filter(Boolean))].sort();
    selOp.innerHTML = '<option value="">Todos os operadores</option>' + ops.map(o => `<option value="${o}" ${o===fOp?'selected':''}>${o}</option>`).join('');
  }

  if (!dados.length) {
    document.getElementById('cont-table-wrap').innerHTML = `<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma contagem encontrada</div><div class="empty-sub">As contagens dos coletores aparecem aqui automaticamente</div></div>`;
    return;
  }

  document.getElementById('cont-table-wrap').innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th>Data/Hora</th><th>Operador</th><th>Inventário</th>
        <th>Endereço</th><th>Produto</th><th>Quantidade</th>
        <th>Tipo</th><th>Status</th><th>Ações</th>
      </tr></thead>
      <tbody>
        ${dados.map(c => {
          const inv      = getInventarioPorId(c.inventario_id);
          const excluida = c._excluida === true;
          const rowStyle = excluida ? 'opacity:.45;background:#fafafa' : '';
          const end      = getEnderecoInfo(c.endereco);
          const capInfo  = end && end.capacidade_paletes !== null
            ? `<span style="font-size:.65rem;color:var(--muted)"> · cap:${end.capacidade_paletes}</span>` : '';
          const ruaInfo  = end?.rua ? `<div style="font-size:.65rem;color:var(--muted)">Rua: ${end.rua}</div>` : '';

          const prodExib=_produtoContagemExibicao(c);
          return `<tr style="${rowStyle}">
            <td class="mono" style="white-space:nowrap;font-size:.75rem">${fmtTs(c.timestamp || c.criado_em || c.dataHora)}</td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <div class="u-avatar" style="width:24px;height:24px;font-size:.65rem;flex-shrink:0">${(c.operador||'?')[0].toUpperCase()}</div>
                <span style="font-weight:600;font-size:.82rem">${c.operador || '—'}</span>
              </div>
            </td>
            <td style="font-size:.75rem;color:var(--muted)">${inv?.codigo || c.inventario_id}</td>
            <td class="mono">${c.endereco || '—'}${capInfo}${ruaInfo}</td>
            <td>
              <div style="font-weight:600;font-size:.82rem">${prodExib.codigo || '—'}</div>
              <div style="font-size:.72rem;color:var(--muted)">${prodExib.descricao || ''}</div>
            </td>
            <td class="mono" style="font-weight:700;font-size:.9rem">${
              (c.qtd_caixas != null && c.fator_caixa > 1)
                ? `${c.qtd_caixas} CX`
                : (c.quantidade ?? '—')
            }</td>
            <td><span class="badge ${c.tipo_contagem === 'RECONTAGEM' ? 'b-purple' : 'b-blue'}">${c.tipo_contagem || 'PRIMEIRA'}</span></td>
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
}

// ───────────────────────────────────────────────────────────────────
//  15. RENDERIZAÇÃO — PENDÊNCIAS
// ───────────────────────────────────────────────────────────────────

function renderPendencias() {
  const selInv = document.getElementById('pend-sel-inv');
  const busca  = (document.getElementById('pend-busca')?.value || '').toLowerCase();
  const fStatus= document.getElementById('pend-fstatus')?.value || '';
  const fLocal = document.getElementById('pend-flocal')?.value || '';
  const fRua   = document.getElementById('pend-frua')?.value || '';
  const invId  = selInv?.value || '';

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
  const conts   = (state().contagens || []).filter(c => String(c.inventario_id || c.inventarioId || '') === String(invId) && !c._excluida && c.status !== 'ESTORNADA');
  const endsContadosSet = new Set(conts.filter(c => !_isVazio(c)).map(c => c.endereco));
  const endsVaziosConfSet = new Set(conts.filter(c => _isVazio(c) && c.status !== 'ESTORNADA').map(c => c.endereco));

  // Usar somente os endereços pertencentes ao inventário selecionado.
  const selecionados = Array.isArray(inv.enderecos_selecionados) ? inv.enderecos_selecionados : [];
  const selecionadosSet = new Set(selecionados.map(x => String(typeof x === 'string' ? x : (x.endereco || x.id || ''))).filter(Boolean));
  const baseInventario = selecionadosSet.size
    ? (state().enderecosLista || []).filter(e => selecionadosSet.has(String(e.endereco || e.id || '')))
    : (Array.isArray(inv.base) && inv.base.length ? inv.base : (state().enderecosLista || []));

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

    return { ...e, contado, vazioConf, inativo, limiteTingido, usados, status_pend };
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
  if (busca)   filtrado = filtrado.filter(e =>
    e.endereco.toLowerCase().includes(busca) ||
    (e.setor || '').toLowerCase().includes(busca) ||
    (e.rua || extrairRua(e.endereco) || '').toLowerCase().includes(busca)
  );

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
    <div class="tbl-wrap"><table>
      <thead><tr><th>Endereço</th><th>Local/Área</th><th>Rua</th><th>Nível</th><th>Tipo</th><th>Paletes (usados/cap)</th><th>Status</th></tr></thead>
      <tbody>
        ${filtrado.map(e => {
          const s = statusLabel[e.status_pend] || { cls:'b-gray', txt: e.status_pend };
          const cap = e.capacidade_paletes !== null ? String(e.capacidade_paletes) : '∞';
          return `<tr style="${e.inativo || e.limiteTingido ? 'opacity:.6' : ''}">
            <td class="mono">${e.endereco}</td>
            <td>${e.setor || '—'}</td>
            <td>${e.rua || '—'}</td>
            <td>${e.nivel || '—'}</td>
            <td>${e.tipo || '—'}</td>
            <td class="mono" style="font-weight:700;color:${e.limiteTingido?'var(--danger)':'inherit'}">${e.usados}/${cap}</td>
            <td><span class="badge ${s.cls}">${s.txt}</span></td>
          </tr>`;
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
