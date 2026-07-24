(function(global){
  // ── Referências ao store / actions ──────────────────────────────────────────
  const Store   = global.AnalistaStore;
  const Actions = global.AnalistaActions;
  const DivSvc  = global.AnalistaDivergenciaService;

  function state(){ return Store.getState(); }

  // Constante local alinhada com o serviço
  const MAX_CONTAGENS = DivSvc.MAX_CONTAGENS;

  // Meta padrão para dispatches de lógica de negócio — impede re-trigger do AppController
  const BIZMETA = { source: 'business-reprocess' };

  // Persistência canônica. Estas funções eram chamadas em todo o fluxo, mas não
  // possuíam implementação carregada, fazendo o processamento parar justamente
  // quando encontrava a primeira divergência real.
  async function fsSalvarDivergencia(div){
    if(!div || !div.id) return false;
    if(!navigator.onLine || !global.FS_AN) return false;
    const payload=Object.assign({},div,{ atualizado_em:new Date().toISOString() });
    await global.FS_AN.collection('dt_divergencias').doc(String(div.id)).set(payload,{merge:true});
    return true;
  }

  async function fsSalvarRecontagem(rec){
    if(!rec || !rec.id) return false;
    if(!navigator.onLine || !global.FS_AN) return false;
    const payload=Object.assign({},rec,{ atualizado_em:new Date().toISOString() });
    await global.FS_AN.collection('dt_recontagens').doc(String(rec.id)).set(payload,{merge:true});
    return true;
  }

  global.fsSalvarDivergencia=fsSalvarDivergencia;
  global.fsSalvarRecontagem=fsSalvarRecontagem;

  // ── Helpers de normalização ─────────────────────────────────────────────────
  const _nd = v => String(v || '').trim().toUpperCase();

  // Identificadores equivalentes do mesmo produto. A contagem pode chegar com
  // GTIN/EAN/DUN, enquanto a base do inventário normalmente guarda código interno.
  function _idsProduto(obj){
    const vals = [
      obj?.codigo_produto, obj?.codigoProduto, obj?.produto, obj?.produto_id,
      obj?.codigo_interno, obj?.codigoInterno, obj?.sku,
      obj?.gtin, obj?.ean, obj?.dun, obj?.gtin_bipado,
      obj?.codigo_lido, obj?.codigoLido
    ].map(_nd).filter(Boolean);
    const lido = vals[0] || '';
    const geral = global.DTProdutos?.buscarSync?.(lido);
    if (geral?.encontrado){
      vals.push(_nd(geral.codigoInterno), _nd(geral.gtin), _nd(geral.dun), _nd(geral.produtoId));
    }
    return [...new Set(vals.filter(Boolean))];
  }

  function _produtoGeral(obj){
    for (const id of _idsProduto(obj)){
      const ach = global.DTProdutos?.buscarSync?.(id);
      if (ach?.encontrado) return ach;
    }
    return null;
  }

  function _descricaoProduto(item, cont){
    return String(
      item?.descricao_produto || item?.descricaoProduto || item?.descricao ||
      cont?.descricao_produto || cont?.descricaoProduto || cont?.descricao ||
      _produtoGeral(cont || item)?.nomeProduto || ''
    ).trim();
  }

  function _idPrincipalBase(item){
    return _nd(item?.codigo_produto || item?.codigoProduto || item?.codigo_interno || item?.codigoInterno || item?.gtin || item?.ean || item?.dun);
  }

  function _mesmoProduto(a,b){
    const aa = new Set(_idsProduto(a));
    return _idsProduto(b).some(x => aa.has(x));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  9. LÓGICA DE DIVERGÊNCIAS
  // ─────────────────────────────────────────────────────────────────────────────

  function _divExistente(invId, endereco, produto, tipo){
    const endN = _nd(endereco);
    if (tipo === 'VAZIO_COM_PRODUTO_NA_BASE'){
      return state().divergencias.find(d =>
        String(d.inventario_id || d.inventarioId || d.inventario || d.inv_id || '') === String(invId) && _nd(d.endereco) === endN &&
        d.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE'
      ) || null;
    }
    const prodN = _nd(produto);
    return state().divergencias.find(d =>
      String(d.inventario_id || d.inventarioId || d.inventario || d.inv_id || '') === String(invId) && _nd(d.endereco) === endN &&
      _nd(d.produto) === prodN && d.tipo_divergencia === tipo
    ) || null;
  }

  /**
   * Atualiza o status das contagens vinculadas a uma divergência (via dispatch imutável).
   */
  function _atualizarStatusContagensRec(divergenciaId, novoStatus){
    const div = state().divergencias.find(d => d.id === divergenciaId);
    if (!div) return;
    let houve = false;
    const updated = state().contagens.map(c => {
      if (String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') !== String(div.inventario_id || div.inventarioId || div.inventario || div.inv_id || '')) return c;
      if (_nd(c.endereco)  !== _nd(div.endereco))  return c;
      if (c.status === novoStatus) return c;
      houve = true;
      return Object.assign({}, c, { status: novoStatus });
    });
    if (houve) Store.dispatch(Actions.replaceSlice('contagens', updated, BIZMETA));
  }

  /**
   * Marca divergência como PERSISTENTE e encerra todas as recontagens abertas.
   * Usa dispatch imutável — sem mutação direta de objetos do state.
   */
  function finalizarComoPersistente(rec, agora){
    agora = agora || new Date().toISOString();
    const div = state().divergencias.find(d => d.id === rec.divergencia_id);
    const nd  = _nd;

    const updatedRec = Object.assign({}, rec, {
      status:              'CONCLUIDA',
      status_recontagem:   'persistente',
      status_bloqueio:     'PERSISTENTE_BLOQUEADO',
      concluida_em:        agora,
      resultado_final:     div ? (div.qtd_resultado_final ?? null) : null,
      divergencia_resolvida: false
    });

    const batchActions = [];

    if (div){
      const qtdFinal = rec.qtd_terceira ?? rec.qtd_segunda ?? rec.qtd_primeira ?? null;
      const updatedDiv = Object.assign({}, div, {
        status:              'PERSISTENTE',
        status_bloqueio:     'PERSISTENTE_BLOQUEADO',
        status_recontagem:   'concluida',
        resolvida_em:        agora,
        qtd_resultado_final: qtdFinal,
        contagem_aceita:     'TERCEIRA_SEM_CONSENSO'
      });
      fsSalvarDivergencia(updatedDiv);
      dbg('[Max] Divergência finalizada como PERSISTENTE:', updatedDiv.endereco);

      // Cancelar todas as outras recontagens pendentes do mesmo endereço
      const updatedRecontagens = state().recontagens.map(r => {
        if (r.id === rec.id) return updatedRec;
        if (r.inventario_id !== div.inventario_id) return r;
        if (nd(r.endereco)  !== nd(div.endereco))  return r;
        if (r.status === 'CONCLUIDA' || r.status === 'CANCELADA') return r;
        const cancelada = Object.assign({}, r, {
          status:           'CANCELADA',
          status_recontagem:'cancelada',
          cancelada_em:     agora,
          cancelada_motivo: 'PERSISTENTE_BLOQUEADO'
        });
        fsSalvarRecontagem(cancelada);
        dbg('[Max] Recontagem extra cancelada:', cancelada.id, cancelada.endereco);
        return cancelada;
      });

      batchActions.push(
        Actions.upsertEntity('divergencias', updatedDiv, BIZMETA),
        Actions.replaceSlice('recontagens', updatedRecontagens, BIZMETA),
        Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
      );
    } else {
      batchActions.push(
        Actions.upsertEntity('recontagens', updatedRec, BIZMETA),
        Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
      );
    }

    fsSalvarRecontagem(updatedRec);
    Store.dispatch(Actions.batch(batchActions, BIZMETA));
    _atualizarStatusContagensRec(rec.divergencia_id, 'DIVERGENTE');
  }

  // ── Helpers de quantidade ────────────────────────────────────────────────────

  function _qtdEmUnidades(c){
    const fator = parseFloat(c.fator_caixa) || 1;
    const qtdCx = parseFloat(c.qtd_caixas);
    if (!isNaN(qtdCx) && qtdCx > 0 && fator > 1) return qtdCx * fator;
    return parseFloat(c.quantidade) || 0;
  }

  function _isVazio(c){
    return c.tipo_contagem === 'VAZIO' || c.tipo === 'VAZIO_CONFIRMADO';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  processarDivergencias — lógica de cruzamento com dispatch imutável
  // ─────────────────────────────────────────────────────────────────────────────

  function processarDivergencias({ criarRecontagens = true } = {}){
    const invId      = document.getElementById('div-sel-inv')?.value || '';
    const statusAtivos = new Set(['ATIVO','ABERTO','PUBLICADO','LIBERADO','EM_ANDAMENTO','PAUSADO']);
    const inventarios = invId
      ? [state().inventarios.find(i => String(i.id) === String(invId))].filter(Boolean)
      : state().inventarios.filter(i => i && (statusAtivos.has(String(i.status || '').toUpperCase()) || (Array.isArray(i.base) && i.base.length)));

    let novos = 0;

    // Acumuladores para batch final
    const novasDivs  = [];   // divergências novas a upsert
    const novasRecs  = [];   // recontagens novas a upsert
    const divsUpdate = [];   // divergências existentes a atualizar
    // Map de contagens a atualizar: uuid/id → objeto atualizado
    const contagensMap = new Map();

    inventarios.forEach(inv => {
      if (!inv.base?.length) return;

      const conts = state().contagens.filter(c =>
        String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') === String(inv.id) &&
        c.tipo_contagem !== 'RECONTAGEM' &&
        !c._excluida &&
        c.status !== 'ESTORNADA' &&
        c.status !== 'EXCLUIDA' &&
        !_isVazio(c)
      );

      const _normKey = (end, prod) => `${_nd(end)}||${_nd(prod)}`;
      const basePorEndereco = new Map();
      const basePorId = new Map();
      const mapaBase = {};
      inv.base.forEach((item, idx) => {
        const end = _nd(item.endereco);
        const key = `${end}||BASE_${idx}`;
        item.__dtKey = key;
        item.__dtIds = _idsProduto(item);
        if (!basePorEndereco.has(end)) basePorEndereco.set(end, []);
        basePorEndereco.get(end).push(item);
        item.__dtIds.forEach(id => {
          if (!basePorId.has(id)) basePorId.set(id, []);
          basePorId.get(id).push(item);
        });
        mapaBase[key] = item;
      });

      function localizarItemBase(cont, somenteEndereco=true){
        const candidatos = somenteEndereco
          ? (basePorEndereco.get(_nd(cont.endereco)) || [])
          : inv.base;
        return candidatos.find(item => _mesmoProduto(item, cont)) || null;
      }

      // Deduplicação de contagens
      const _seenConts = new Set();
      const contsUnicas = [];
      conts.forEach(c => {
        const dedupKey = c.uuid
          ? String(c.uuid).trim()
          : [c.inventario_id, _nd(c.endereco), _nd(c.capa), _idsProduto(c).join(','),
             Number(c.quantidade || 0), _nd(c.operador), _nd(c.tipo_contagem),
             String(c.criado_em || c.dataHora || '').slice(0, 16)].join('|');
        if (_seenConts.has(dedupKey)){ dbg('[Dedup] Contagem duplicada ignorada:', dedupKey); return; }
        _seenConts.add(dedupKey);
        contsUnicas.push(c);
      });

      const mapaConts = {};
      const infoContagem = new Map();
      contsUnicas.forEach(c => {
        const itemBase = localizarItemBase(c, true);
        const geral = _produtoGeral(c);
        const key = itemBase?.__dtKey || _normKey(c.endereco, _idsProduto(c)[0] || 'SEM_PRODUTO');
        mapaConts[key] = (mapaConts[key] || 0) + _qtdEmUnidades(c);
        infoContagem.set(c, { itemBase, geral, key });
      });

      // ── Atualizar status de contagens normais ──
      contsUnicas.forEach(c => {
        const info = infoContagem.get(c) || {};
        const itemBase = info.itemBase || null;
        const qtdCont = mapaConts[info.key] ?? null;
        const novoStatus = !itemBase ? 'DIVERGENTE'
          : ((qtdCont === (parseFloat(itemBase.quantidade_esperada) || 0)) ? 'PROCESSADO' : 'DIVERGENTE');
        const descricao = _descricaoProduto(itemBase, c);
        const codigoBase = _idPrincipalBase(itemBase);
        if (c.status !== novoStatus || (descricao && !c.descricao) || (codigoBase && !c.codigo_produto)){
          const updated = Object.assign({}, c, {
            status: novoStatus,
            descricao: descricao || c.descricao || '',
            descricao_produto: descricao || c.descricao_produto || '',
            codigo_produto: codigoBase || c.codigo_produto || c.gtin || ''
          });
          contagensMap.set(c.uuid || c.id, updated);
          const docId = c.uuid || String(c.id);
          if (navigator.onLine) FS_AN.collection('dt_contagens').doc(docId).set({
            status: novoStatus,
            descricao: updated.descricao,
            descricao_produto: updated.descricao_produto,
            codigo_produto: updated.codigo_produto
          }, {merge:true}).catch(() => {});
        }
      });

      // ── Atualizar status de RECONTAGEMs ──
      state().contagens.filter(c =>
        String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') === String(inv.id) && c.tipo_contagem === 'RECONTAGEM' &&
        !c._excluida && c.status !== 'ESTORNADA'
      ).forEach(c => {
        const divRef = c.divergencia_id
          ? state().divergencias.find(d => d.id === c.divergencia_id)
          : state().divergencias.find(d =>
              d.inventario_id === c.inventario_id &&
              _nd(d.endereco) === _nd(c.endereco)
            );
        const novoStatus = !divRef ? 'PROCESSADO'
          : divRef.status === 'RESOLVIDA'   ? 'PROCESSADO'
          : divRef.status === 'PERSISTENTE' ? 'DIVERGENTE'
          : 'DIVERGENTE';
        if (c.status !== novoStatus){
          contagensMap.set(c.uuid || c.id, Object.assign({}, c, { status: novoStatus }));
          const docId = c.uuid || String(c.id);
          if (navigator.onLine) FS_AN.collection('dt_contagens').doc(docId).update({ status: novoStatus }).catch(() => {});
        }
      });

      // Repara divergências antigas criadas como "produto não identificado" quando
      // o GTIN/DUN pertence a um produto cadastrado e também existe na base do inventário.
      contsUnicas.forEach(c => {
        const info = infoContagem.get(c) || {};
        if (!info.itemBase) return;
        const antigos = state().divergencias.filter(d =>
          String(d.inventario_id || d.inventarioId || '') === String(inv.id) &&
          _nd(d.endereco) === _nd(c.endereco) &&
          d.tipo_divergencia === 'PRODUTO_NAO_IDENTIFICADO' &&
          (!d.contagem_uuid || !c.uuid || String(d.contagem_uuid) === String(c.uuid))
        );
        antigos.forEach(d => {
          const qtdEsp = parseFloat(info.itemBase.quantidade_esperada) || 0;
          const qtdCont = mapaConts[info.key] || 0;
          const diferenca = qtdCont - qtdEsp;
          const atualizado = Object.assign({}, d, {
            produto: _idPrincipalBase(info.itemBase),
            produto_contado: _idsProduto(c)[0] || d.produto_contado,
            descricao: _descricaoProduto(info.itemBase, c),
            qtd_esperada: qtdEsp,
            qtd_contada: qtdCont,
            diferenca,
            tipo_divergencia: 'QUANTIDADE_DIFERENTE',
            motivos_divergencia: ['QUANTIDADE_DIFERENTE'],
            status: diferenca === 0 ? 'RESOLVIDA' : 'EM_RECONTAGEM',
            precisa_recontagem: diferenca !== 0,
            corrigida_em: new Date().toISOString()
          });
          divsUpdate.push(atualizado);
          fsSalvarDivergencia(atualizado);
        });
      });

      // ── 1a. Divergências de quantidade ──
      inv.base.forEach(item => {
        const key = item.__dtKey;
        const qtdEsp = parseFloat(item.quantidade_esperada) || 0;
        const qtdCont = mapaConts[key] !== undefined ? mapaConts[key] : null;
        if (qtdCont === null) return;

        const produtoBase = _idPrincipalBase(item);
        const descricaoBase = _descricaoProduto(item, item);
        const diferenca = qtdCont - qtdEsp;
        if (diferenca === 0){
          const divExistente = state().divergencias.find(d =>
            String(d.inventario_id || d.inventarioId || '') === String(inv.id) &&
            _nd(d.endereco) === _nd(item.endereco) && _mesmoProduto(d, item) &&
            ['ABERTA','EM_RECONTAGEM'].includes(d.status)
          );
          if (divExistente){
            const updatedDiv = Object.assign({}, divExistente, {
              produto: produtoBase, descricao: descricaoBase,
              qtd_esperada: qtdEsp, qtd_contada: qtdCont, diferenca: 0,
              status: 'RESOLVIDA', resolvida_em: new Date().toISOString(), resolvida_por: 'sistema (correção)'
            });
            divsUpdate.push(updatedDiv);
            fsSalvarDivergencia(updatedDiv);
          }
          return;
        }

        const existente = state().divergencias.find(d =>
          String(d.inventario_id || d.inventarioId || '') === String(inv.id) &&
          _nd(d.endereco) === _nd(item.endereco) && _mesmoProduto(d, item) &&
          ['QUANTIDADE_DIFERENTE','PRODUTO_NAO_IDENTIFICADO'].includes(d.tipo_divergencia)
        );
        if (existente){
          const atualizado = Object.assign({}, existente, {
            produto: produtoBase, descricao: descricaoBase,
            qtd_esperada: qtdEsp, qtd_contada: qtdCont, diferenca,
            tipo_divergencia: 'QUANTIDADE_DIFERENTE', motivos_divergencia: ['QUANTIDADE_DIFERENTE'],
            status: existente.status === 'PERSISTENTE' ? 'PERSISTENTE' : 'EM_RECONTAGEM',
            precisa_recontagem: true
          });
          divsUpdate.push(atualizado);
          fsSalvarDivergencia(atualizado);
          return;
        }

        const div = {
          id: gerarId('DIV'), inventario_id: inv.id, inventario_nome: inv.nome,
          endereco: item.endereco, produto: produtoBase, descricao: descricaoBase,
          qtd_esperada: qtdEsp, qtd_contada: qtdCont, diferenca,
          tipo_divergencia: 'QUANTIDADE_DIFERENTE', motivos_divergencia: ['QUANTIDADE_DIFERENTE'],
          status: 'EM_RECONTAGEM', precisa_recontagem: true,
          criada_em: new Date().toISOString(), criada_por: _currentAnalistaUser?.email || 'sistema',
        };
        novasDivs.push(div);
        fsSalvarDivergencia(div);
        novos++;
        if (criarRecontagens) _criarRecontagemParaDivergencia(div, inv, qtdCont, novasRecs);
      });

      // ── 1b. Produto realmente não identificado ──
      contsUnicas.forEach(c => {
        const info = infoContagem.get(c) || {};
        if (info.itemBase || info.geral) return;
        const prodCod = _idsProduto(c)[0] || '';
        if (_divExistente(inv.id, c.endereco, prodCod, 'PRODUTO_NAO_IDENTIFICADO')) return;
        const div = {
          id: gerarId('DIV'), inventario_id: inv.id, inventario_nome: inv.nome,
          endereco: c.endereco, produto: prodCod, produto_contado: prodCod,
          descricao: _descricaoProduto(null, c) || 'Produto não identificado', gtin_bipado: _nd(c.gtin || prodCod),
          qtd_esperada: null, qtd_contada: _qtdEmUnidades(c), diferenca: null,
          tipo_divergencia: 'PRODUTO_NAO_IDENTIFICADO', motivos_divergencia: ['PRODUTO_NAO_IDENTIFICADO'],
          contagem_uuid: c.uuid, operador: c.operador,
          status: 'ABERTA', precisa_recontagem: true,
          criada_em: new Date().toISOString(), criada_por: _currentAnalistaUser?.email || 'sistema',
        };
        novasDivs.push(div);
        fsSalvarDivergencia(div);
        novos++;
        if (criarRecontagens) _criarRecontagemParaDivergencia(div, inv, _qtdEmUnidades(c), novasRecs);
      });

      // ── 1c. Produto cadastrado, porém fora do endereço correto ──
      contsUnicas.forEach(c => {
        const info = infoContagem.get(c) || {};
        if (info.itemBase) return;
        const itemEmOutroEndereco = localizarItemBase(c, false);
        if (!itemEmOutroEndereco && !info.geral) return;
        const prodCod = _idPrincipalBase(itemEmOutroEndereco) || _idsProduto(c)[0] || '';
        if (_divExistente(inv.id, c.endereco, prodCod, 'PRODUTO_FORA_ENDERECO')) return;
        const qtdEsp = itemEmOutroEndereco ? (parseFloat(itemEmOutroEndereco.quantidade_esperada) || 0) : null;
        const div = {
          id: gerarId('DIV'), inventario_id: inv.id, inventario_nome: inv.nome,
          endereco: c.endereco, endereco_correto: itemEmOutroEndereco?.endereco || null,
          produto: prodCod, produto_contado: _idsProduto(c)[0] || prodCod,
          descricao: _descricaoProduto(itemEmOutroEndereco, c), qtd_esperada: qtdEsp,
          qtd_contada: _qtdEmUnidades(c), diferenca: qtdEsp == null ? null : (_qtdEmUnidades(c) - qtdEsp),
          tipo_divergencia: 'PRODUTO_FORA_ENDERECO', motivos_divergencia: ['PRODUTO_FORA_ENDERECO'],
          contagem_uuid: c.uuid, operador: c.operador,
          status: 'ABERTA', precisa_recontagem: true,
          criada_em: new Date().toISOString(), criada_por: _currentAnalistaUser?.email || 'sistema',
        };
        novasDivs.push(div);
        fsSalvarDivergencia(div);
        novos++;
        if (criarRecontagens) _criarRecontagemParaDivergencia(div, inv, _qtdEmUnidades(c), novasRecs);
      });

      // ── 1d. Endereço vazio mas base espera produto ──
      state().contagens.filter(c =>
        String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') === String(inv.id) && _isVazio(c) && !c._excluida &&
        c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA'
      ).forEach(vazio => {
        const itensEsperados = inv.base.filter(item =>
          _nd(item.endereco) === _nd(vazio.endereco)
        );
        if (!itensEsperados.length) return;
        if (_divExistente(inv.id, vazio.endereco, '', 'VAZIO_COM_PRODUTO_NA_BASE')) return;
        const produtosEsperados = itensEsperados.map(i =>
          `${i.codigo_produto}${i.descricao_produto ? ' — ' + i.descricao_produto : ''}`
        ).join('; ');
        const div = {
          id: gerarId('DIV'), inventario_id: inv.id, inventario_nome: inv.nome,
          endereco: vazio.endereco, produto: itensEsperados[0]?.codigo_produto || '',
          descricao: `Endereço vazio, mas base esperava: ${produtosEsperados}`,
          qtd_esperada: itensEsperados.reduce((s, i) => s + (parseFloat(i.quantidade_esperada) || 0), 0),
          qtd_contada: 0, diferenca: null,
          tipo_divergencia: 'VAZIO_COM_PRODUTO_NA_BASE', motivos_divergencia: ['VAZIO_COM_PRODUTO_NA_BASE'],
          contagem_uuid: vazio.uuid, operador: vazio.operador,
          itens_esperados: itensEsperados.map(i => ({
            codigo_produto: i.codigo_produto, descricao_produto: i.descricao_produto,
            quantidade_esperada: i.quantidade_esperada,
          })),
          status: 'ABERTA', precisa_recontagem: true,
          criada_em: new Date().toISOString(), criada_por: _currentAnalistaUser?.email || 'sistema',
        };
        novasDivs.push(div);
        fsSalvarDivergencia(div);
        novos++;
        if (criarRecontagens) _criarRecontagemParaDivergencia(div, inv, 0, novasRecs);
      });
    });

    // ── Garantia: toda divergência aberta deve possuir recontagem pendente ──
    if (criarRecontagens) {
      const candidatas = [...state().divergencias, ...novasDivs, ...divsUpdate];
      const vistos = new Set();
      candidatas.forEach(div => {
        if (!div || vistos.has(div.id)) return;
        vistos.add(div.id);
        const st = String(div.status || 'ABERTA').toUpperCase();
        if (st === 'RESOLVIDA' || st === 'PERSISTENTE' || div.precisa_recontagem === false) return;
        const jaExiste = [...state().recontagens, ...novasRecs].some(r =>
          String(r.divergencia_id || '') === String(div.id) &&
          !['CONCLUIDA','CANCELADA'].includes(String(r.status || '').toUpperCase())
        );
        if (jaExiste) return;
        const inv = inventarios.find(i => String(i.id) === String(div.inventario_id || div.inventarioId || ''));
        if (!inv) return;
        _criarRecontagemParaDivergencia(div, inv, Number(div.qtd_contada || 0), novasRecs);
      });
    }

    // ── Deduplicação final de divergências ──
    const _seenDiv = new Set();
    const todasDivs = [...state().divergencias, ...novasDivs, ...divsUpdate.map(d => {
      // divsUpdate já foram computadas mas precisam sobrescrever o state atual
      return d;
    })];
    // Reconstituir lista completa com atualizações e dedup
    const divsById = new Map();
    // Prioridade: atualizações > novas > existentes
    state().divergencias.forEach(d => divsById.set(d.id, d));
    divsUpdate.forEach(d => divsById.set(d.id, d));
    novasDivs.forEach(d => divsById.set(d.id, d));

    const divergenciasDedupe = Array.from(divsById.values()).filter(d => {
      if (d.status === 'RESOLVIDA' || d.status === 'PERSISTENTE') return true;
      const prodKey = d.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE' ? '' : _nd(d.produto);
      const key = `${d.inventario_id}|${_nd(d.endereco)}|${prodKey}|${d.tipo_divergencia}`;
      if (_seenDiv.has(key)){ dbg('[Dedup] div duplicada removida:', key); return false; }
      _seenDiv.add(key);
      return true;
    });

    // ── Aplicar contagens atualizadas ──
    let finalContagens = state().contagens;
    if (contagensMap.size > 0){
      finalContagens = state().contagens.map(c => contagensMap.get(c.uuid || c.id) || c);
    }

    // ── Batch final ──
    const batchActions = [
      Actions.replaceSlice('divergencias', divergenciasDedupe, BIZMETA),
    ];
    if (contagensMap.size > 0) batchActions.push(Actions.replaceSlice('contagens', finalContagens, BIZMETA));
    // Propagar produto/descrição/quantidade esperada corrigidos para recontagens
    // já existentes. Assim registros antigos deixam de exibir null e código sem cadastro.
    const divAtualPorId = new Map(divergenciasDedupe.map(d => [String(d.id), d]));
    let houveRecAtualizada = false;
    const recsFinais = state().recontagens.map(r => {
      const d = divAtualPorId.get(String(r.divergencia_id || ''));
      if (!d) return r;
      const atualizado = Object.assign({}, r, {
        produto: d.produto || r.produto || '',
        descricao: d.descricao || r.descricao || '',
        qtd_esperada: d.qtd_esperada != null ? d.qtd_esperada : r.qtd_esperada,
        qtd_primeira: d.qtd_contada != null ? d.qtd_contada : r.qtd_primeira
      });
      if (JSON.stringify(atualizado) !== JSON.stringify(r)) {
        houveRecAtualizada = true;
        fsSalvarRecontagem(atualizado);
      }
      return atualizado;
    });
    novasRecs.forEach(r => {
      const idx = recsFinais.findIndex(x => x.id === r.id);
      if (idx >= 0) recsFinais[idx] = r; else recsFinais.push(r);
    });
    if (novasRecs.length > 0 || houveRecAtualizada) {
      batchActions.push(Actions.replaceSlice('recontagens', recsFinais, BIZMETA));
    }
    Store.dispatch(Actions.batch(batchActions, BIZMETA));

    if (typeof logSistema === 'function') logSistema('DIVERGENCIA', `${novos} divergências processadas`, { inventario_id: invId });
    if (typeof showToast === 'function') showToast(novos > 0 ? `⚠️ ${novos} divergências encontradas!` : '✅ Nenhuma nova divergência encontrada', novos > 0 ? 'w' : 's');
    return novos;
  }

  // ── Helper: criar recontagem para divergência (sem mutação, acumula em array) ──
  function _criarRecontagemParaDivergencia(div, inv, qtdCont, novasRecs){
    if (DivSvc.isFluxoEncerrado(div)){ dbg('[Rec] Criação bloqueada — fluxo encerrado:', div.endereco, div.status); return; }
    if (DivSvc.obterRecontagemAtivaPorDivergencia(div.id)){ dbg('[Rec] Bloqueado — rec ativa já existe:', div.endereco); return; }

    const recsAnt = state().recontagens
      .filter(r => r.divergencia_id === div.id && r.status === 'CONCLUIDA')
      .sort((a, b) => (a.numero_recontagem || 1) - (b.numero_recontagem || 1));
    const ultimaRec     = recsAnt[recsAnt.length - 1] || null;
    const numeroNovaRec = ultimaRec ? (ultimaRec.numero_recontagem || 1) + 1 : 1;

    if (numeroNovaRec > MAX_CONTAGENS){ dbg('[Rec] Bloqueado — MAX_CONTAGENS atingido:', div.endereco, numeroNovaRec); return; }

    const qtd1  = ultimaRec?.qtd_primeira    ?? qtdCont;
    const prod1 = ultimaRec?.produto_primeira ??
      (div.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE' ? 'VAZIO' : _nd(div.produto));

    const rec = {
      id: gerarId('REC'), divergencia_id: div.id,
      inventario_id: inv.id, inventario_nome: inv.nome,
      endereco: div.endereco, produto: div.produto, descricao: div.descricao,
      qtd_esperada: div.qtd_esperada,
      qtd_primeira: qtd1, produto_primeira: prod1,
      qtd_segunda: ultimaRec?.qtd_segunda ?? null, produto_segunda: ultimaRec?.produto_segunda ?? null,
      qtd_terceira: null, produto_terceira: null,
      operador_primeira: ultimaRec?.operador_primeira ?? null,
      operador_segunda:  ultimaRec?.operador_segunda  ?? null,
      operador_terceira: null,
      data_primeira: ultimaRec?.data_primeira ?? null,
      data_segunda:  ultimaRec?.data_segunda  ?? null,
      data_terceira: null,
      numero_recontagem: numeroNovaRec,
      historico_recontagens: [...(ultimaRec?.historico_recontagens || [])],
      contagem_original_uuid: ultimaRec?.contagem_original_uuid ?? null,
      qtd_recontagem: null, produto_recontagem: null, operador: null,
      status: 'PENDENTE', status_recontagem: 'pendente',
      criada_em: new Date().toISOString(), concluida_em: null, observacao: '',
      criada_por: _currentAnalistaUser?.email || 'sistema',
    };

    // Vincular contagem original
    const contOriginal = state().contagens.find(c =>
      String(c.inventario_id || c.inventarioId || c.inventario || c.inv_id || '') === String(inv.id) &&
      _nd(c.endereco) === _nd(div.endereco) &&
      (_nd(c.codigo_produto) === _nd(div.produto) || _nd(c.gtin) === _nd(div.produto)) &&
      !c._excluida && c.status !== 'ESTORNADA'
    );
    if (contOriginal){
      rec.contagem_original_uuid = contOriginal.uuid || String(contOriginal.id);
      rec.operador_primeira      = contOriginal.operador || null;
      rec.coletor_id_primeira    = contOriginal.coletor_id || null;
      rec.data_primeira          = contOriginal.dataHora || contOriginal.criado_em || null;
    }

    novasRecs.push(rec);
    fsSalvarRecontagem(rec);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  corrigirOrfas — remove recontagens sem divergência vinculada
  // ─────────────────────────────────────────────────────────────────────────────
  function corrigirOrfas(){
    const divIds = new Set(state().divergencias.map(d => d.id));
    const orfas  = state().recontagens.filter(r => r.divergencia_id && !divIds.has(r.divergencia_id));
    if (!orfas.length) return 0;
    const novasRecs = state().recontagens.filter(r => !orfas.includes(r));
    Store.dispatch(Actions.replaceSlice('recontagens', novasRecs, BIZMETA));
    dbg('[CorrigirOrfas] removidas:', orfas.length);
    return orfas.length;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  10. RECONTAGENS
  // ─────────────────────────────────────────────────────────────────────────────

  async function abrirRegistrarRecontagem(recId){
    const recontagemCtx = state().recontagens.find(r => r.id === recId) || null;
    Store.dispatch(Actions.setPath('ui.recontagemCtx', recontagemCtx, { source: 'abrirRegistrarRecontagem' }));
    if (!recontagemCtx) return;

    if (DivSvc.isFluxoEncerrado(recontagemCtx)){
      showToast('🔒 Fluxo encerrado — não é possível registrar nova contagem para este endereço.', 'e');
      return;
    }

    const _numAtual = recontagemCtx.numero_recontagem || 1;
    if (_numAtual >= MAX_CONTAGENS && recontagemCtx.qtd_terceira != null){
      showToast(`⛔ Limite de ${MAX_CONTAGENS} contagens atingido para este endereço. Divergência finalizada.`, 'w');
      return;
    }

    const _fmt = v => (v != null) ? `<b style="color:var(--warn)">${v}</b>` : `<span style="color:var(--muted)">—</span>`;
    const _row = (label, val, op) => `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 10px;background:var(--card);border-radius:8px;gap:8px">
        <span style="font-size:.68rem;color:var(--muted);text-transform:uppercase;font-weight:700;white-space:nowrap">${label}</span>
        <span style="font-family:var(--mono);font-weight:800;font-size:.95rem">${_fmt(val)}</span>
        ${op ? `<span style="font-size:.68rem;color:var(--muted);white-space:nowrap">👤 ${op}</span>` : ''}
      </div>`;

    const ctx = state().ui.recontagemCtx;
    const historico = (ctx.historico_recontagens || []).map((h, i) => _row(`Contagem ${i + 2}`, h.qtd, h.operador)).join('');

    document.getElementById('rec-modal-info').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:6px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div><div style="font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--muted)">Endereço</div>
               <div style="font-family:var(--mono);font-weight:700">${ctx.endereco}</div></div>
          <div><div style="font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--muted)">Produto</div>
               <div style="font-weight:600;font-size:.82rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ctx.produto}</div></div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:6px;display:flex;flex-direction:column;gap:4px">
          <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:2px">Histórico de contagens</div>
          ${_row('Sistema (esperado)', ctx.qtd_esperada)}
          ${_row('1ª Contagem', ctx.qtd_primeira, ctx.operador_primeira)}
          ${ctx.qtd_segunda  != null ? _row('2ª Contagem', ctx.qtd_segunda,  ctx.operador_segunda)  : ''}
          ${ctx.qtd_terceira != null ? _row('3ª Contagem', ctx.qtd_terceira, ctx.operador_terceira) : ''}
          ${historico}
        </div>
        ${ctx.operador ? `<div style="padding:5px 10px;background:rgba(232,117,26,.08);border-radius:8px;font-size:.72rem">👤 Atribuído para: <b>${ctx.operador}</b></div>` : ''}
        ${ctx.observacao_atribuicao ? `<div style="padding:5px 10px;background:rgba(255,179,0,.06);border:1px solid rgba(255,179,0,.2);border-radius:8px;font-size:.72rem;color:#fbbf24">💬 ${ctx.observacao_atribuicao}</div>` : ''}
      </div>`;

    const _recProdEl = document.getElementById('rec-produto');
    if (_recProdEl){
      _recProdEl.value = '';
      _recProdEl.placeholder = ctx.tipo_divergencia === 'VAZIO_COM_PRODUTO_NA_BASE'
        ? 'VAZIO' : _nd(ctx.produto) || 'Código do produto bipado';
    }
    const _recProdInfo = document.getElementById('rec-produto-info');
    if (_recProdInfo){
      _recProdInfo.textContent = ctx.produto
        ? `Esperado: ${_nd(ctx.produto)}${ctx.descricao ? ' — ' + ctx.descricao : ''}` : '';
    }

    openModal('modal-reg-recontagem');
    document.getElementById('rec-qtd').value = '';
    document.getElementById('rec-obs').value = ctx.observacao || '';

    await divPopularSelectOperadores('rec-operador');

    const selOp = document.getElementById('rec-operador');
    if (selOp && ctx.operador){
      const opt = [...selOp.options].find(o => o.value === ctx.operador);
      if (opt) selOp.value = ctx.operador;
    }
  }

  // ── Helpers de validação ─────────────────────────────────────────────────────

  const _PROD_VAZIO = 'VAZIO';

  function _normProduto(v){
    return String(v || '').trim().toUpperCase().replace(/\s+/g, ' ') || null;
  }
  function _normQtd(v){
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function _resolveDivergenciaCompleta(novaQtd, novoProduto, recCtx){
    const qtdAtual  = _normQtd(novaQtd);
    const prodAtual = _normProduto(novoProduto);
    if (qtdAtual === null || !prodAtual) return { resolveu: false, referencia: null };

    const referencias = [
      { origem: 'SISTEMA',    qtd: _normQtd(recCtx.qtd_esperada), produto: _normProduto(recCtx.produto) },
      { origem: 'CONTAGEM_1', qtd: _normQtd(recCtx.qtd_primeira), produto: _normProduto(recCtx.produto_primeira || recCtx.produto) },
      { origem: 'CONTAGEM_2', qtd: _normQtd(recCtx.qtd_segunda),  produto: _normProduto(recCtx.produto_segunda) },
      { origem: 'CONTAGEM_3', qtd: _normQtd(recCtx.qtd_terceira), produto: _normProduto(recCtx.produto_terceira) },
      ...(recCtx.historico_recontagens || []).map((h, i) => ({
        origem: `HISTORICO_${i + 1}`, qtd: _normQtd(h.qtd), produto: _normProduto(h.produto),
      })),
    ].filter(r => r.qtd !== null && r.produto);

    for (const ref of referencias){
      if (qtdAtual === ref.qtd && prodAtual === ref.produto){
        dbg('[Resolve] ✅ Bate com', ref.origem, '| qtd=', qtdAtual, 'prod=', prodAtual);
        return { resolveu: true, referencia: ref.origem };
      }
    }
    dbg('[Resolve] ❌ Não resolve | qtd=', qtdAtual, 'prod=', prodAtual);
    return { resolveu: false, referencia: null };
  }

  // ── aplicarResultadoRecontagem — imutável ────────────────────────────────────

  function aplicarResultadoRecontagem(recCtx, qtd, produto, operador, agora, decisao){
    const numeroAtual = Number(recCtx.numero_recontagem || 1);

    // Campos comuns da rodada
    let updatedRec = Object.assign({}, recCtx, {
      qtd_recontagem: qtd, produto_recontagem: produto, operador,
      status: 'CONCLUIDA', concluida_em: agora, status_recontagem: 'concluida',
      operador_recontagem: operador || recCtx.operador_recontagem || ''
    });
    if (numeroAtual === 1){
      updatedRec = Object.assign({}, updatedRec, { qtd_segunda: qtd, produto_segunda: produto, operador_segunda: operador, data_segunda: agora });
    } else if (numeroAtual >= 2){
      updatedRec = Object.assign({}, updatedRec, { qtd_terceira: qtd, produto_terceira: produto, operador_terceira: operador, data_terceira: agora });
    }

    const div = state().divergencias.find(d => d.id === recCtx.divergencia_id);
    if (!div){
      fsSalvarRecontagem(updatedRec);
      Store.dispatch(Actions.batch([
        Actions.upsertEntity('recontagens', updatedRec, BIZMETA),
        Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
      ], BIZMETA));
      return;
    }

    let updatedDiv = Object.assign({}, div, { qtd_recontagem: qtd, produto_recontagem: produto });
    if (numeroAtual === 1){
      updatedDiv = Object.assign({}, updatedDiv, { qtd_segunda: qtd, produto_segunda: produto, operador_segunda: operador, data_segunda: agora });
    } else if (numeroAtual >= 2){
      updatedDiv = Object.assign({}, updatedDiv, { qtd_terceira: qtd, produto_terceira: produto, operador_terceira: operador, data_terceira: agora });
    }

    // ── RESOLVIDA ──
    if (decisao.resolveu){
      updatedDiv = Object.assign({}, updatedDiv, {
        status: 'RESOLVIDA', status_recontagem: 'sem_divergencia',
        resolvida_em: agora, resolvida_por: _currentAnalistaUser?.email || 'Analista',
        qtd_resultado_final: qtd, produto_resultado_final: produto,
        contagem_aceita: decisao.referencia,
        divergencia_resolvida: true, encerrada_definitivamente: true,
        operador_responsavel: null, status_bloqueio: null
      });
      updatedRec = Object.assign({}, updatedRec, {
        divergencia_resolvida: true, encerrada_definitivamente: true,
        contagem_aceita: decisao.referencia, status_recontagem: 'sem_divergencia', operador: null
      });
      fsSalvarDivergencia(updatedDiv);
      fsSalvarRecontagem(updatedRec);
      Store.dispatch(Actions.batch([
        Actions.upsertEntity('divergencias', updatedDiv, BIZMETA),
        Actions.upsertEntity('recontagens', updatedRec, BIZMETA),
        Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
      ], BIZMETA));
      showToast('✅ Divergência resolvida — contagem confirmada!', 's');
      return;
    }

    // ── PERSISTENTE (3ª rodada sem consenso) ──
    if (numeroAtual >= 2){
      updatedDiv = Object.assign({}, updatedDiv, {
        status: 'PERSISTENTE', status_bloqueio: 'PERSISTENTE_BLOQUEADO', status_recontagem: 'concluida',
        divergencia_resolvida: false, encerrada_definitivamente: true,
        resolvida_em: agora, resolvida_por: _currentAnalistaUser?.email || 'Analista',
        qtd_resultado_final: qtd, contagem_aceita: 'TERCEIRA_SEM_CONSENSO'
      });
      updatedRec = Object.assign({}, updatedRec, {
        divergencia_resolvida: false, encerrada_definitivamente: true, contagem_aceita: 'TERCEIRA_SEM_CONSENSO'
      });

      const updatedRecontagens = state().recontagens.map(r => {
        if (r.id === updatedRec.id) return updatedRec;
        if (r.inventario_id !== div.inventario_id) return r;
        if (_nd(r.endereco) !== _nd(div.endereco)) return r;
        if (r.status === 'CONCLUIDA' || r.status === 'CANCELADA') return r;
        const cancelada = Object.assign({}, r, {
          status: 'CANCELADA', status_recontagem: 'cancelada',
          cancelada_em: agora, cancelada_motivo: 'PERSISTENTE_BLOQUEADO'
        });
        fsSalvarRecontagem(cancelada);
        return cancelada;
      });

      fsSalvarDivergencia(updatedDiv);
      Store.dispatch(Actions.batch([
        Actions.upsertEntity('divergencias', updatedDiv, BIZMETA),
        Actions.replaceSlice('recontagens', updatedRecontagens, BIZMETA),
        Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
      ], BIZMETA));
      showToast(`🔴 Divergência PERSISTENTE em ${div.endereco}. Nenhuma das ${numeroAtual + 1} contagens chegou a consenso.`, 'e');
      return;
    }

    // ── 2ª rodada sem consenso → criar 3ª recontagem ──
    updatedDiv = Object.assign({}, updatedDiv, {
      status_recontagem: 'aguardando_analista', operador_responsavel: null, status: 'EM_RECONTAGEM',
      qtd_segunda: qtd, produto_segunda: produto, operador_segunda: operador, data_segunda: agora
    });

    const _proxNum = numeroAtual + 1;
    if (_proxNum <= MAX_CONTAGENS){
      const qtdEspLog  = Number(recCtx.qtd_esperada);
      const qtdPrimLog = Number(recCtx.qtd_primeira);
      const rec3 = {
        id: gerarId('REC'), divergencia_id: div.id,
        inventario_id: recCtx.inventario_id, inventario_nome: recCtx.inventario_nome,
        endereco: recCtx.endereco, produto: recCtx.produto, descricao: recCtx.descricao,
        qtd_esperada: recCtx.qtd_esperada,
        qtd_primeira: recCtx.qtd_primeira, produto_primeira: _nd(recCtx.produto_primeira || recCtx.produto),
        qtd_segunda: qtd, produto_segunda: produto,
        qtd_terceira: null, produto_terceira: null,
        operador_primeira: recCtx.operador_primeira, operador_segunda: operador, operador_terceira: null,
        data_segunda: agora, data_terceira: null,
        numero_recontagem: _proxNum, tipo: _proxNum >= MAX_CONTAGENS ? 'TERCEIRA_CONTAGEM' : 'RECONTAGEM',
        historico_recontagens: [
          ...(recCtx.historico_recontagens || []),
          { numero: 1, qtd, produto, operador, data: agora },
        ],
        contagem_original_uuid: recCtx.contagem_original_uuid,
        qtd_recontagem: null, produto_recontagem: null, operador: null,
        status: 'PENDENTE', status_recontagem: 'pendente',
        criada_em: agora, concluida_em: null,
        observacao: `${_proxNum}ª contagem necessária — 2ª não confirmou. 1ª=${isFinite(qtdPrimLog)?qtdPrimLog:'—'}(${_nd(recCtx.produto_primeira||recCtx.produto)}) | 2ª=${qtd}(${produto}) | sistema=${isFinite(qtdEspLog)?qtdEspLog:'—'}(${_nd(recCtx.produto)})`,
        criada_por: _currentAnalistaUser?.email || 'analista',
      };

      const recsAtualizadas = state().recontagens.map(r => r.id === updatedRec.id ? updatedRec : r);
      if (!recsAtualizadas.find(r => r.id === rec3.id)) recsAtualizadas.push(rec3);

      fsSalvarRecontagem(rec3);
      fsSalvarDivergencia(updatedDiv);
      Store.dispatch(Actions.batch([
        Actions.upsertEntity('divergencias', updatedDiv, BIZMETA),
        Actions.replaceSlice('recontagens', recsAtualizadas, BIZMETA),
        Actions.setPath('ui.recontagemCtx', updatedRec, BIZMETA)
      ], BIZMETA));
      showToast(`⚠️ 2ª contagem (${qtd}) sem consenso. ${_proxNum}ª recontagem criada!`, 'w');
    } else {
      finalizarComoPersistente(updatedRec, agora);
      showToast(`🔴 Limite de ${MAX_CONTAGENS} contagens atingido — divergência finalizada como PERSISTENTE.`, 'w');
    }

    fsSalvarDivergencia(updatedDiv);
  }

  // ── confirmarRecontagem ──────────────────────────────────────────────────────

  function confirmarRecontagem(){
    const ctx = state().ui.recontagemCtx;
    if (!ctx) return;

    if (DivSvc.isFluxoEncerrado(ctx)){
      showToast('🔒 Endereço com fluxo encerrado — não é possível registrar nova contagem.', 'e');
      closeModal('modal-reg-recontagem');
      return;
    }

    const _numManual = ctx.numero_recontagem || 1;
    if (_numManual > MAX_CONTAGENS){
      showToast(`⛔ Limite de ${MAX_CONTAGENS} contagens atingido. Registre como PERSISTENTE.`, 'w');
      closeModal('modal-reg-recontagem');
      finalizarComoPersistente(ctx);
      return;
    }

    const selOp  = document.getElementById('rec-operador');
    const operador = (selOp?.value || selOp?.querySelector('option:checked')?.text || '').trim();
    const qtd    = parseFloat(document.getElementById('rec-qtd').value);
    const produto = (document.getElementById('rec-produto')?.value || '').trim().toUpperCase();

    if (!operador){ showToast('Selecione o operador', 'e'); return; }
    if (isNaN(qtd)){ showToast('Informe a quantidade', 'e'); return; }
    if (!produto)  { showToast('Informe o código do produto bipado', 'e'); return; }

    const agora = new Date().toISOString();

    // Passo 1: capturar decisão ANTES de qualquer escrita
    const decisao = _resolveDivergenciaCompleta(qtd, produto, ctx);

    // Passo 2: guardar histórico da rodada anterior
    const historicoAtual = Array.isArray(ctx.historico_recontagens) ? [...ctx.historico_recontagens] : [];
    if (ctx.qtd_recontagem != null){
      historicoAtual.push({
        numero: ctx.numero_recontagem, qtd: ctx.qtd_recontagem,
        produto: ctx.produto_recontagem || null,
        operador: ctx.operador, data: ctx.concluida_em || agora,
      });
    }

    // Atualizar histórico e observação no ctx antes de passar para aplicarResultado
    const ctxComHistorico = Object.assign({}, ctx, {
      historico_recontagens: historicoAtual,
      observacao: document.getElementById('rec-obs').value.trim()
    });
    Store.dispatch(Actions.setPath('ui.recontagemCtx', ctxComHistorico, BIZMETA));

    // Passo 3: aplicar resultado (despacha as alterações finais)
    aplicarResultadoRecontagem(ctxComHistorico, qtd, produto, operador, agora, decisao);

    // Log e fechar modal — salvamento de cache fica a cargo do AppController
    if (typeof logSistema === 'function'){
      const rec = state().ui.recontagemCtx;
      logSistema('RECONTAGEM_CONCLUIDA', `Recontagem ${rec.id} — qtd: ${qtd} prod: ${produto} — resolveu: ${decisao.resolveu}`, {
        id: rec.id, divergencia_id: rec.divergencia_id, endereco: rec.endereco,
        produto_esperado: rec.produto, produto_contado: produto,
        qtd_esperada: rec.qtd_esperada, resultado_final: rec.resultado_final,
        numero_recontagem: _numManual, resolve: decisao.resolveu, operador,
      });
    }

    closeModal('modal-reg-recontagem');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  atribuirRecontagemSegura (migrado de 01-core-base-storage)
  //  Usa dispatch imutável — sem mutação direta em d ou recAtiva.
  // ─────────────────────────────────────────────────────────────────────────────

  function atribuirRecontagemSegura(d, operador, atribPor, obs, agora){
    if (!d) return null;
    agora = agora || new Date().toISOString();

    if (DivSvc.isFluxoEncerrado(d)){
      showToast(`🔒 ${d.endereco} já está encerrado. Não é possível atribuir.`, 'e');
      return null;
    }

    const recAtiva = DivSvc.obterRecontagemAtivaPorDivergencia(d.id);
    if (recAtiva){
      if (!recAtiva.operador){
        const updatedRecAtiva = Object.assign({}, recAtiva, {
          operador, atribuido_por: atribPor, atribuido_em: agora,
          status_recontagem: 'pendente', observacao_atribuicao: obs || ''
        });
        const updatedD = Object.assign({}, d, {
          operador_responsavel: operador, atribuido_por: atribPor,
          atribuido_em: agora, status_recontagem: 'pendente'
        });
        fsSalvarRecontagem(updatedRecAtiva).catch(() => {});
        fsSalvarDivergencia(updatedD).catch(() => {});
        Store.dispatch(Actions.batch([
          Actions.upsertEntity('recontagens', updatedRecAtiva, { source: 'atribuirRecontagemSegura' }),
          Actions.upsertEntity('divergencias', updatedD,       { source: 'atribuirRecontagemSegura' })
        ], { source: 'atribuirRecontagemSegura' }));
        dbg('[Atribuir] Operador atribuído ao rec existente:', updatedRecAtiva.id, operador);
        return updatedRecAtiva;
      }
      showToast(`⚠️ ${d.endereco} já possui recontagem pendente atribuída a ${recAtiva.operador}. Aguarde a conclusão.`, 'w');
      return null;
    }

    const recConcluida = state().recontagens.find(r =>
      r.divergencia_id === d.id && r.status === 'CONCLUIDA' && !DivSvc.isFluxoEncerrado(r)
    );
    if (recConcluida && d.status_recontagem !== 'aguardando_analista'){
      showToast(`🔒 ${d.endereco} já possui recontagem concluída. O analista deve decidir manualmente o próximo passo.`, 'e');
      return null;
    }

    const numeroAtualRec = Number(
      state().recontagens.filter(r => r.divergencia_id === d.id)
        .reduce((max, r) => Math.max(max, r.numero_recontagem || 1), 0)
    );
    if (numeroAtualRec >= MAX_CONTAGENS){
      showToast(`🔒 ${d.endereco} já atingiu o limite de ${MAX_CONTAGENS} contagens.`, 'e');
      return null;
    }

    const updatedD = Object.assign({}, d, {
      operador_responsavel:  operador,
      atribuido_por:         atribPor,
      atribuido_em:          agora,
      status:                d.status === 'ABERTA' ? 'EM_RECONTAGEM' : d.status,
      status_recontagem:     'pendente',
      observacao_atribuicao: obs || ''
    });

    const rec = {
      id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      divergencia_id: d.id, inventario_id: d.inventario_id, inventario_nome: d.inventario_nome,
      endereco: d.endereco, produto: d.produto, descricao: d.descricao,
      qtd_esperada: d.qtd_esperada,
      qtd_primeira: d.qtd_contada,
      produto_primeira: _nd(d.produto_contado || d.produto),
      qtd_segunda: d.qtd_segunda ?? null, produto_segunda: d.produto_segunda ?? null,
      operador_primeira: d.operador || null, operador_segunda: d.operador_segunda || null,
      data_segunda: d.data_segunda || null,
      qtd_recontagem: null, produto_recontagem: null,
      operador, atribuido_por: atribPor, atribuido_em: agora,
      status: 'PENDENTE', status_recontagem: 'pendente',
      observacao_atribuicao: obs || '',
      criada_em: agora, numero_recontagem: numeroAtualRec + 1,
    };

    Store.dispatch(Actions.batch([
      Actions.upsertEntity('divergencias', updatedD, { source: 'atribuirRecontagemSegura' }),
      Actions.upsertEntity('recontagens', rec,        { source: 'atribuirRecontagemSegura' })
    ], { source: 'atribuirRecontagemSegura' }));
    fsSalvarDivergencia(updatedD).catch(() => {});
    fsSalvarRecontagem(rec).catch(() => {});

    return rec;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Registro do runtime — ativa o DivergenciaService.processarDivergencias
  // ─────────────────────────────────────────────────────────────────────────────
  global.AnalistaDivergenciasRuntime = {
    processar:     processarDivergencias,
    corrigirOrfas: corrigirOrfas
  };

  // Exportações globais para chamadas via onclick no HTML e outros módulos
  global.processarDivergencias    = processarDivergencias;
  global.confirmarRecontagem      = confirmarRecontagem;
  global.abrirRegistrarRecontagem = abrirRegistrarRecontagem;
  global.atribuirRecontagemSegura = atribuirRecontagemSegura;
  global.finalizarComoPersistente = finalizarComoPersistente;

  // Registrar AnalistaRecontagemService para o alias em 01-core-base-storage
  global.AnalistaRecontagemService = { atribuirRecontagemSegura };

})(window);
