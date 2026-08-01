/* ============================================================================
 * ANALISTA — CONTAGENS E PENDENCIAS CANONICAS
 * ----------------------------------------------------------------------------
 * Substitui:
 *   - _resultadoRodadaEndereco
 *   - renderContagens
 *   - renderPendencias
 *
 * Dependencia principal:
 *   window.AnalistaDivergenciasModule
 *
 * Objetivos:
 *   - Uma unica fonte de verdade para status do fluxo.
 *   - Contagens, Pendencias, Divergencias e Recontagens sempre concordam.
 *   - Nenhuma regra de negocio dentro da renderizacao.
 *   - Nenhuma gravacao durante renderizacao.
 *   - KPIs, filtros, tabelas e exportacoes usam a mesma projecao.
 * ========================================================================== */

(() => {
  'use strict';

  const G = window;

  if (!G.AnalistaStore?.getState) {
    console.error('[ContagensPendenciasCanonico] AnalistaStore nao encontrado.');
    return;
  }

  const state = () => G.AnalistaStore.getState();

  function texto(value) {
    return String(value ?? '').trim();
  }

  function upper(value) {
    return texto(value).toUpperCase();
  }

  function lower(value) {
    return texto(value).toLowerCase();
  }

  function numero(value) {
    if (value === null || value === undefined || texto(value) === '') return null;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function timestamp(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function formatarData(value) {
    if (!value) return '—';
    if (typeof G.fmtTs === 'function') return G.fmtTs(value);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
  }

  function escapeHtml(value) {
    if (typeof G.escHTML === 'function') return G.escHTML(value);
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getCanonicalModule() {
    const module = G.AnalistaDivergenciasModule;
    if (!module?.construirFluxosCanonicos || !module?.chaveFluxo) {
      throw new Error(
        'AnalistaDivergenciasModule nao carregado. Carregue modulo-divergencias-reescrito.js antes deste arquivo.'
      );
    }
    return module;
  }

  function obterProdutoContagem(c) {
    const codigo = texto(
      c?.codigo_produto ||
      c?.codigoProduto ||
      c?.gtin ||
      c?.ean ||
      c?.dun ||
      c?.codigo_lido ||
      c?.codigoLido
    );

    const atual = texto(
      c?.descricao_produto ||
      c?.descricaoProduto ||
      c?.descricao
    );

    const placeholder = !atual ||
      /^(PRODUTO NAO IDENTIFICADO|PRODUTO NÃO IDENTIFICADO|PRODUTO NAO CADASTRADO|PRODUTO NÃO CADASTRADO|CODIGO SEM CADASTRO|CÓDIGO SEM CADASTRO)$/i.test(atual);

    let ach = null;
    try {
      ach = G.DTProdutos?.buscarSync?.(codigo) || null;
    } catch (error) {
      console.warn('[ContagensPendenciasCanonico] DTProdutos.buscarSync:', error);
    }

    return {
      codigo: codigo || texto(ach?.codigoInterno || ach?.gtin || ach?.dun),
      descricao:
        (!placeholder ? atual : '') ||
        (ach?.encontrado ? texto(ach.nomeProduto) : 'Codigo sem cadastro')
    };
  }

  function obterInventarioCanonicoId(obj) {
    const module = getCanonicalModule();
    const key = module.chaveFluxo(obj);
    if (!key) return '';
    const parts = key.split('|');
    return parts[parts.length - 2] || '';
  }

  function obterInventarioPorCanonico(obj) {
    const id = obterInventarioCanonicoId(obj);
    return (state().inventarios || []).find(inv => {
      try {
        return obterInventarioCanonicoId(inv) === id;
      } catch {
        return false;
      }
    }) || null;
  }

  function obterFluxosCanonicos() {
    return getCanonicalModule().construirFluxosCanonicos();
  }

  function mapaFluxos() {
    return new Map(obterFluxosCanonicos().map(fluxo => [fluxo.chaveFluxo, fluxo]));
  }

  function obterFluxoDaContagem(contagem, map = null) {
    const module = getCanonicalModule();
    const key = module.chaveFluxo(contagem);
    if (!key) return null;
    return (map || mapaFluxos()).get(key) || null;
  }

  function resultadoCanonicoDaContagem(contagem, fluxo) {
    if (!fluxo) {
      if (
        contagem?.divergente === true ||
        upper(contagem?.status) === 'DIVERGENTE'
      ) {
        return {
          texto: 'Divergente — sem fluxo consolidado',
          cls: 'b-red',
          estado: 'INCONSISTENTE'
        };
      }

      if (upper(contagem?.tipo_contagem || 'PRIMEIRA') !== 'RECONTAGEM') {
        return {
          texto: 'OK 1a',
          cls: 'b-green',
          estado: 'RESOLVIDA'
        };
      }

      return {
        texto: upper(contagem?.status || 'PENDENTE'),
        cls: 'b-orange',
        estado: 'SEM_FLUXO'
      };
    }

    switch (fluxo.status) {
      case 'RESOLVIDA': {
        const rodada = Number(fluxo.avaliacao?.rodada || fluxo.vezesContado || 1);
        return {
          texto: `OK ${Math.max(1, Math.min(rodada, 3))}a`,
          cls: 'b-green',
          estado: fluxo.status
        };
      }

      case 'PERSISTENTE':
        return {
          texto: 'Persistente (3 rodadas)',
          cls: 'b-red',
          estado: fluxo.status
        };

      case 'AGUARDANDO_ANALISTA':
        return {
          texto: fluxo.segunda?.quantidade != null
            ? 'Aguardando 3a contagem'
            : 'Aguardando analista',
          cls: 'b-orange',
          estado: fluxo.status
        };

      case 'EM_RECONTAGEM':
        return {
          texto: fluxo.operadorResponsavel
            ? `Em recontagem — ${fluxo.operadorResponsavel}`
            : 'Em recontagem',
          cls: 'b-purple',
          estado: fluxo.status
        };

      case 'ABERTA':
      default:
        return {
          texto: 'Divergente — aguardando atribuicao',
          cls: 'b-red',
          estado: fluxo.status
        };
    }
  }

  function statusBadgeContagem(status) {
    const st = upper(status || 'PENDENTE');
    if (['PROCESSADO', 'OK', 'CONCLUIDA', 'RESOLVIDA'].includes(st)) return 'b-green';
    if (['DIVERGENTE', 'CONFLITO', 'PERSISTENTE'].includes(st)) return 'b-red';
    if (['ESTORNADA', 'EXCLUIDA', 'CANCELADA'].includes(st)) return 'b-gray';
    if (['EM_RECONTAGEM', 'RECONTAGEM', 'AGUARDANDO_ANALISTA'].includes(st)) return 'b-purple';
    return 'b-orange';
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setSelectOptions(id, values, emptyLabel, currentValue) {
    const select = document.getElementById(id);
    if (!select) return;

    const current = currentValue ?? select.value;
    select.replaceChildren();

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = emptyLabel;
    select.appendChild(empty);

    values.forEach(item => {
      const option = document.createElement('option');

      if (typeof item === 'object') {
        option.value = texto(item.value);
        option.textContent = texto(item.label);
      } else {
        option.value = texto(item);
        option.textContent = texto(item);
      }

      select.appendChild(option);
    });

    if ([...select.options].some(option => option.value === current)) {
      select.value = current;
    }
  }

  function obterChaveContagem(contagem) {
    return getCanonicalModule().chaveFluxo(contagem);
  }

  function escolherPrimeiraContagemPorFluxo(contagens) {
    const grupos = new Map();

    contagens.forEach(contagem => {
      const key = obterChaveContagem(contagem);
      if (!key) return;

      const atual = grupos.get(key);
      const atualTs = timestamp(atual?.timestamp || atual?.criado_em || atual?.dataHora);
      const novoTs = timestamp(contagem.timestamp || contagem.criado_em || contagem.dataHora);

      if (!atual || novoTs < atualTs) grupos.set(key, contagem);
    });

    return [...grupos.values()];
  }

  function criarCelula(textValue, className = '', style = null) {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (style) Object.assign(td.style, style);
    td.textContent = textValue ?? '—';
    return td;
  }

  function criarBadge(textValue, className) {
    const badge = document.createElement('span');
    badge.className = `badge ${className}`;
    badge.textContent = textValue;
    return badge;
  }

  function criarBotao(textValue, action, id, className = 'btn btn-ghost btn-sm') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = textValue;
    button.dataset.action = action;
    button.dataset.id = texto(id);
    return button;
  }

  /* ------------------------------------------------------------------------
   * CONTAGENS
   * --------------------------------------------------------------------- */

  function renderContagens() {
    const busca = lower(document.getElementById('cont-busca')?.value);
    const fInv = texto(document.getElementById('cont-finv')?.value);
    const fTipo = texto(document.getElementById('cont-ftipo')?.value);
    const fStatus = texto(document.getElementById('cont-fstatus')?.value);
    const fRua = texto(document.getElementById('cont-frua')?.value);
    const fOp = texto(document.getElementById('cont-foperador')?.value);
    const fPeriodo = texto(document.getElementById('cont-fperiodo')?.value);

    const fluxos = obterFluxosCanonicos();
    const fluxoMap = new Map(fluxos.map(fluxo => [fluxo.chaveFluxo, fluxo]));

    setSelectOptions(
      'cont-finv',
      (state().inventarios || []).map(inv => ({
        value: obterInventarioCanonicoId(inv),
        label: `${texto(inv.codigo)} — ${texto(inv.nome)}`
      })),
      'Todos os inventarios',
      fInv
    );

    let dados = (state().contagens || []).filter(contagem =>
      !contagem._excluida ||
      fStatus === 'EXCLUIDA'
    );

    if (!fTipo) {
      dados = dados.filter(contagem => upper(contagem.tipo_contagem) !== 'RECONTAGEM');
      dados = escolherPrimeiraContagemPorFluxo(dados);
    }

    if (fInv) {
      dados = dados.filter(contagem =>
        obterInventarioCanonicoId(contagem) === fInv
      );
    }

    if (fTipo) {
      dados = dados.filter(contagem => texto(contagem.tipo_contagem) === fTipo);
    }

    if (fStatus) {
      dados = dados.filter(contagem => {
        const fluxo = obterFluxoDaContagem(contagem, fluxoMap);

        if (fStatus === 'DIVERGENTE') {
          return Boolean(
            fluxo &&
            !['RESOLVIDA', 'CANCELADA', 'EXCLUIDA'].includes(fluxo.status)
          );
        }

        if (fStatus === 'RESOLVIDA') {
          return fluxo?.status === 'RESOLVIDA';
        }

        if (fStatus === 'PERSISTENTE') {
          return fluxo?.status === 'PERSISTENTE';
        }

        if (fStatus === 'EM_RECONTAGEM') {
          return ['EM_RECONTAGEM', 'AGUARDANDO_ANALISTA'].includes(fluxo?.status);
        }

        if (fStatus === 'EXCLUIDA') return contagem._excluida === true;

        return upper(contagem.status) === upper(fStatus);
      });
    }

    if (fOp) {
      dados = dados.filter(contagem => texto(contagem.operador) === fOp);
    }

    if (fRua) {
      dados = dados.filter(contagem =>
        texto(G.getEnderecoInfo?.(contagem.endereco)?.rua || '—') === fRua
      );
    }

    if (fPeriodo) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const ontem = new Date(hoje);
      ontem.setDate(ontem.getDate() - 1);

      const seteDias = new Date(hoje);
      seteDias.setDate(seteDias.getDate() - 7);

      dados = dados.filter(contagem => {
        const dt = new Date(
          contagem.timestamp ||
          contagem.criado_em ||
          contagem.dataHora ||
          ''
        );

        if (Number.isNaN(dt.getTime())) return false;
        if (fPeriodo === 'hoje') return dt >= hoje;
        if (fPeriodo === 'ontem') return dt >= ontem && dt < hoje;
        if (fPeriodo === '7d') return dt >= seteDias;
        return true;
      });
    }

    if (busca) {
      dados = dados.filter(contagem => {
        const produto = obterProdutoContagem(contagem);
        const fluxo = obterFluxoDaContagem(contagem, fluxoMap);

        return [
          contagem.operador,
          contagem.endereco,
          produto.codigo,
          produto.descricao,
          fluxo?.inventarioNome,
          fluxo?.operadorResponsavel
        ].some(value => lower(value).includes(busca));
      });
    }

    dados.sort((a, b) =>
      timestamp(b.timestamp || b.criado_em || b.dataHora) -
      timestamp(a.timestamp || a.criado_em || a.dataHora)
    );

    const contagensValidas = (state().contagens || []).filter(contagem =>
      !contagem._excluida &&
      !['ESTORNADA', 'EXCLUIDA'].includes(upper(contagem.status))
    );

    const fluxosComContagem = fluxos.filter(fluxo =>
      contagensValidas.some(contagem => obterChaveContagem(contagem) === fluxo.chaveFluxo)
    );

    setText('ck-total', escolherPrimeiraContagemPorFluxo(
      contagensValidas.filter(c => upper(c.tipo_contagem) !== 'RECONTAGEM')
    ).length);

    setText('ck-processadas', fluxosComContagem.filter(f => f.status === 'RESOLVIDA').length);

    setText(
      'ck-divergentes',
      fluxosComContagem.filter(f =>
        ['ABERTA', 'EM_RECONTAGEM', 'AGUARDANDO_ANALISTA', 'PERSISTENTE'].includes(f.status)
      ).length
    );

    setText(
      'ck-pendentes',
      fluxosComContagem.filter(f =>
        ['ABERTA', 'AGUARDANDO_ANALISTA'].includes(f.status)
      ).length
    );

    setText(
      'ck-recontagens',
      fluxosComContagem.filter(f =>
        f.segunda?.quantidade != null || f.terceira?.quantidade != null
      ).length
    );

    setSelectOptions(
      'cont-frua',
      [...new Set(
        (state().contagens || []).map(c =>
          texto(G.getEnderecoInfo?.(c.endereco)?.rua || '—')
        )
      )].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
      'Todas as ruas',
      fRua
    );

    setSelectOptions(
      'cont-foperador',
      [...new Set(
        (state().contagens || []).map(c => texto(c.operador)).filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      'Todos os operadores',
      fOp
    );

    const container = document.getElementById('cont-table-wrap');
    if (!container) return;

    container.replaceChildren();

    if (!dados.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<div class="empty-icon">📋</div><div class="empty-title">Nenhuma contagem encontrada</div><div class="empty-sub">As contagens dos coletores aparecem aqui automaticamente.</div>';
      container.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'tbl-wrap';

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    [
      'Data/Hora',
      'Operador',
      'Inventario',
      'Endereco',
      'Produto',
      'Quantidade',
      'Tipo',
      'Resultado consolidado',
      'Acoes'
    ].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    dados.forEach(contagem => {
      const fluxo = obterFluxoDaContagem(contagem, fluxoMap);
      const produto = obterProdutoContagem(contagem);
      const inventario = obterInventarioPorCanonico(contagem);
      const enderecoInfo = G.getEnderecoInfo?.(contagem.endereco) || {};
      const excluida = contagem._excluida === true;
      const resultado = resultadoCanonicoDaContagem(contagem, fluxo);

      const tr = document.createElement('tr');
      if (excluida) {
        tr.style.opacity = '.45';
        tr.style.background = '#fafafa';
      }

      tr.appendChild(criarCelula(
        formatarData(contagem.timestamp || contagem.criado_em || contagem.dataHora),
        'mono',
        { whiteSpace: 'nowrap', fontSize: '.75rem' }
      ));

      const tdOperator = document.createElement('td');
      const operatorWrap = document.createElement('div');
      operatorWrap.style.display = 'flex';
      operatorWrap.style.alignItems = 'center';
      operatorWrap.style.gap = '6px';

      const avatar = document.createElement('div');
      avatar.className = 'u-avatar';
      avatar.style.width = '24px';
      avatar.style.height = '24px';
      avatar.style.fontSize = '.65rem';
      avatar.style.flexShrink = '0';
      avatar.textContent = texto(contagem.operador || '?').charAt(0).toUpperCase();

      const operatorName = document.createElement('span');
      operatorName.style.fontWeight = '600';
      operatorName.style.fontSize = '.82rem';
      operatorName.textContent = texto(contagem.operador || '—');

      operatorWrap.append(avatar, operatorName);
      tdOperator.appendChild(operatorWrap);
      tr.appendChild(tdOperator);

      tr.appendChild(criarCelula(
        texto(inventario?.codigo || fluxo?.inventarioNome || contagem.inventario_id),
        '',
        { fontSize: '.75rem', color: 'var(--muted)' }
      ));

      const tdAddress = document.createElement('td');
      tdAddress.className = 'mono';

      const address = document.createElement('div');
      address.textContent = texto(contagem.endereco || '—');
      tdAddress.appendChild(address);

      if (enderecoInfo.rua) {
        const street = document.createElement('div');
        street.style.fontSize = '.65rem';
        street.style.color = 'var(--muted)';
        street.textContent = `Rua: ${enderecoInfo.rua}`;
        tdAddress.appendChild(street);
      }

      if (enderecoInfo.capacidade_paletes != null) {
        const capacity = document.createElement('div');
        capacity.style.fontSize = '.65rem';
        capacity.style.color = 'var(--muted)';
        capacity.textContent = `Capacidade: ${enderecoInfo.capacidade_paletes}`;
        tdAddress.appendChild(capacity);
      }

      tr.appendChild(tdAddress);

      const tdProduct = document.createElement('td');
      const productCode = document.createElement('div');
      productCode.style.fontWeight = '600';
      productCode.style.fontSize = '.82rem';
      productCode.textContent = produto.codigo || '—';

      const productDescription = document.createElement('div');
      productDescription.style.fontSize = '.72rem';
      productDescription.style.color = 'var(--muted)';
      productDescription.textContent = produto.descricao || '';

      tdProduct.append(productCode, productDescription);
      tr.appendChild(tdProduct);

      const quantity = (
        contagem.qtd_caixas != null &&
        numero(contagem.fator_caixa) > 1
      ) ? `${contagem.qtd_caixas} CX` : (
        contagem.quantidade ??
        contagem.qtd_caixas ??
        '—'
      );

      tr.appendChild(criarCelula(quantity, 'mono', {
        fontWeight: '700',
        fontSize: '.9rem'
      }));

      const tdType = document.createElement('td');
      tdType.appendChild(criarBadge(
        texto(contagem.tipo_contagem || 'PRIMEIRA'),
        upper(contagem.tipo_contagem) === 'RECONTAGEM' ? 'b-purple' : 'b-blue'
      ));
      tr.appendChild(tdType);

      const tdResult = document.createElement('td');

      if (excluida) {
        tdResult.appendChild(criarBadge('Excluida', 'b-gray'));
      } else {
        const badge = criarBadge(resultado.texto, resultado.cls);
        badge.title = fluxo
          ? `Estado canonico: ${fluxo.status}`
          : 'Sem fluxo consolidado correspondente';
        tdResult.appendChild(badge);

        if (fluxo?.inconsistente) {
          const warning = document.createElement('div');
          warning.style.fontSize = '.65rem';
          warning.style.color = 'var(--danger)';
          warning.style.marginTop = '4px';
          warning.textContent = 'Inconsistencia detectada';
          warning.title = fluxo.inconsistencias.map(i => i.codigo).join(', ');
          tdResult.appendChild(warning);
        }
      }

      tr.appendChild(tdResult);

      const tdActions = document.createElement('td');

      if (excluida) {
        tdActions.appendChild(
          criarBotao('Restaurar', 'restore-count', contagem.id)
        );
      } else {
        tdActions.appendChild(
          criarBotao(
            'Estornar',
            'reverse-count',
            contagem.id,
            'btn btn-danger btn-sm'
          )
        );
      }

      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  /* ------------------------------------------------------------------------
   * PENDENCIAS
   * --------------------------------------------------------------------- */

  function getEnderecoId(item) {
    return texto(
      typeof item === 'string'
        ? item
        : item?.endereco || item?.id
    );
  }

  function isVazioConfirmado(contagem) {
    if (typeof G._isVazio === 'function') return Boolean(G._isVazio(contagem));

    return (
      contagem?.vazio === true ||
      contagem?.endereco_vazio === true ||
      upper(contagem?.resultado) === 'VAZIO' ||
      numero(contagem?.quantidade) === 0
    );
  }

  function construirPendenciasInventario(inventario, fluxos) {
    const canonicalId = obterInventarioCanonicoId(inventario);

    const selected = Array.isArray(inventario.enderecos_selecionados)
      ? inventario.enderecos_selecionados
      : [];

    const selectedIds = new Set(selected.map(getEnderecoId).filter(Boolean));

    let base;

    if (selectedIds.size) {
      base = (state().enderecosLista || []).filter(endereco =>
        selectedIds.has(getEnderecoId(endereco))
      );
    } else if (Array.isArray(inventario.base) && inventario.base.length) {
      const unique = new Map();
      inventario.base.forEach(item => {
        const id = getEnderecoId(item);
        if (id && !unique.has(id)) unique.set(id, item);
      });
      base = [...unique.values()];
    } else {
      base = state().enderecosLista || [];
    }

    const contagens = (state().contagens || []).filter(contagem =>
      obterInventarioCanonicoId(contagem) === canonicalId &&
      !contagem._excluida &&
      !['ESTORNADA', 'EXCLUIDA'].includes(upper(contagem.status))
    );

    const fluxoPorEndereco = new Map();

    fluxos
      .filter(fluxo => fluxo.inventarioId === canonicalId)
      .forEach(fluxo => fluxoPorEndereco.set(texto(fluxo.endereco), fluxo));

    const contagensPorEndereco = new Map();

    contagens.forEach(contagem => {
      const endereco = texto(contagem.endereco);
      const list = contagensPorEndereco.get(endereco) || [];
      list.push(contagem);
      contagensPorEndereco.set(endereco, list);
    });

    return base.map(enderecoBase => {
      const endereco = getEnderecoId(enderecoBase);
      const fluxo = fluxoPorEndereco.get(endereco) || null;
      const registros = contagensPorEndereco.get(endereco) || [];

      const primeiraValida = registros.find(contagem =>
        upper(contagem.tipo_contagem) !== 'RECONTAGEM'
      ) || null;

      const vazioConfirmado = registros.some(isVazioConfirmado);
      const possuiContagem = Boolean(primeiraValida);

      const inativo = enderecoBase.ativo === false;
      const capacidade = enderecoBase.capacidade_paletes ?? null;

      const usados = typeof G.getPaletesUsados === 'function'
        ? G.getPaletesUsados(inventario.id, endereco)
        : 0;

      const limiteAtingido =
        !inativo &&
        capacidade !== null &&
        numero(capacidade) > 0 &&
        numero(usados) >= numero(capacidade);

      let statusPendencia;
      let statusFluxo = fluxo?.status || null;

      if (inativo) {
        statusPendencia = 'INATIVO';
      } else if (limiteAtingido && !possuiContagem) {
        statusPendencia = 'LIMITE_ATINGIDO';
      } else if (!possuiContagem && !vazioConfirmado) {
        statusPendencia = 'PENDENTE_CONTAGEM';
      } else if (fluxo) {
        switch (fluxo.status) {
          case 'RESOLVIDA':
            statusPendencia = vazioConfirmado
              ? 'VAZIO_CONFIRMADO'
              : 'CONCLUIDO';
            break;
          case 'PERSISTENTE':
            statusPendencia = 'PERSISTENTE';
            break;
          case 'EM_RECONTAGEM':
            statusPendencia = 'EM_RECONTAGEM';
            break;
          case 'AGUARDANDO_ANALISTA':
            statusPendencia = 'AGUARDANDO_ANALISTA';
            break;
          case 'ABERTA':
          default:
            statusPendencia = 'DIVERGENCIA_ABERTA';
            break;
        }
      } else if (vazioConfirmado) {
        statusPendencia = 'VAZIO_CONFIRMADO';
      } else {
        statusPendencia = 'CONCLUIDO';
      }

      return {
        ...enderecoBase,
        endereco,
        fluxo,
        registros,
        primeiraValida,
        possuiContagem,
        vazioConfirmado,
        inativo,
        capacidade,
        usados,
        limiteAtingido,
        statusPendencia,
        statusFluxo,
        setor: texto(enderecoBase.setor || enderecoBase.local || '—'),
        rua: texto(
          enderecoBase.rua ||
          G.extrairRua?.(endereco) ||
          G.getEnderecoInfo?.(endereco)?.rua ||
          '—'
        ),
        nivel: texto(
          enderecoBase.nivel ||
          enderecoBase.andar ||
          G.getEnderecoInfo?.(endereco)?.nivel ||
          '—'
        ),
        tipo: texto(enderecoBase.tipo || '—')
      };
    });
  }

  function statusPendenciaVisual(status) {
    const map = {
      CONCLUIDO: ['b-green', 'Concluido'],
      VAZIO_CONFIRMADO: ['b-green', 'Vazio confirmado'],
      PENDENTE_CONTAGEM: ['b-yellow', 'Pendente contagem'],
      DIVERGENCIA_ABERTA: ['b-red', 'Divergencia aberta'],
      EM_RECONTAGEM: ['b-purple', 'Em recontagem'],
      AGUARDANDO_ANALISTA: ['b-orange', 'Aguardando analista'],
      PERSISTENTE: ['b-red', 'Persistente'],
      INATIVO: ['b-gray', 'Inativo'],
      LIMITE_ATINGIDO: ['b-blocked', 'Limite atingido']
    };

    return map[status] || ['b-gray', status || '—'];
  }

  function renderResumoFluxosPendencias(lista) {
    const recPend = lista.filter(item =>
      ['EM_RECONTAGEM', 'AGUARDANDO_ANALISTA'].includes(item.statusPendencia)
    );

    const divAbertas = lista.filter(item =>
      ['DIVERGENCIA_ABERTA', 'PERSISTENTE'].includes(item.statusPendencia)
    );

    setText('pk-rec-pend', recPend.length.toLocaleString('pt-BR'));
    setText('pk-div-abertas', divAbertas.length.toLocaleString('pt-BR'));

    const recSection = document.getElementById('pend-rec-section');

    if (recSection) {
      if (!recPend.length) {
        recSection.style.display = 'none';
      } else {
        recSection.style.display = '';
        setText('pend-rec-count', `${recPend.length} atividade(s) de recontagem`);

        const wrap = document.getElementById('pend-rec-wrap');
        if (wrap) {
          wrap.replaceChildren();

          const tableWrap = document.createElement('div');
          tableWrap.className = 'tbl-wrap';
          const table = document.createElement('table');

          const thead = document.createElement('thead');
          const hr = document.createElement('tr');
          ['Endereco', 'Esperado', '1a', '2a', '3a', 'Status', 'Responsavel', 'Acao']
            .forEach(label => {
              const th = document.createElement('th');
              th.textContent = label;
              hr.appendChild(th);
            });
          thead.appendChild(hr);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');

          recPend.slice(0, 10).forEach(item => {
            const fluxo = item.fluxo;
            const tr = document.createElement('tr');

            tr.appendChild(criarCelula(item.endereco, 'mono'));
            tr.appendChild(criarCelula(fluxo?.totalEsperado ?? '—', 'mono'));
            tr.appendChild(criarCelula(fluxo?.primeira?.quantidade ?? '—', 'mono'));
            tr.appendChild(criarCelula(fluxo?.segunda?.quantidade ?? '—', 'mono'));
            tr.appendChild(criarCelula(fluxo?.terceira?.quantidade ?? '—', 'mono'));

            const tdStatus = document.createElement('td');
            const [cls, label] = statusPendenciaVisual(item.statusPendencia);
            tdStatus.appendChild(criarBadge(label, cls));
            tr.appendChild(tdStatus);

            tr.appendChild(criarCelula(fluxo?.operadorResponsavel || 'Nao atribuido'));

            const tdAction = document.createElement('td');

            if (fluxo?.tarefaAtiva?.id && typeof G.abrirRegistrarRecontagem === 'function') {
              tdAction.appendChild(
                criarBotao(
                  'Registrar',
                  'register-recount',
                  fluxo.tarefaAtiva.id,
                  'btn btn-primary btn-sm'
                )
              );
            }

            tr.appendChild(tdAction);
            tbody.appendChild(tr);
          });

          table.appendChild(tbody);
          tableWrap.appendChild(table);
          wrap.appendChild(tableWrap);

          if (recPend.length > 10) {
            const more = document.createElement('div');
            more.style.padding = '8px 16px';
            more.style.fontSize = '.75rem';
            more.style.color = 'var(--muted)';
            more.textContent = `... e mais ${recPend.length - 10}. Veja a aba Recontagem.`;
            wrap.appendChild(more);
          }
        }
      }
    }

    const divSection = document.getElementById('pend-div-section');

    if (divSection) {
      if (!divAbertas.length) {
        divSection.style.display = 'none';
      } else {
        divSection.style.display = '';
        setText('pend-div-count', `${divAbertas.length} divergencia(s) aberta(s)`);

        const wrap = document.getElementById('pend-div-wrap');
        if (wrap) {
          wrap.replaceChildren();

          const tableWrap = document.createElement('div');
          tableWrap.className = 'tbl-wrap';
          const table = document.createElement('table');

          const thead = document.createElement('thead');
          const hr = document.createElement('tr');
          ['Endereco', 'Esperado', '1a', '2a', '3a', 'Status', 'Responsavel']
            .forEach(label => {
              const th = document.createElement('th');
              th.textContent = label;
              hr.appendChild(th);
            });
          thead.appendChild(hr);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');

          divAbertas.slice(0, 10).forEach(item => {
            const fluxo = item.fluxo;
            const tr = document.createElement('tr');

            tr.appendChild(criarCelula(item.endereco, 'mono'));
            tr.appendChild(criarCelula(fluxo?.totalEsperado ?? '—', 'mono'));
            tr.appendChild(criarCelula(fluxo?.primeira?.quantidade ?? '—', 'mono'));
            tr.appendChild(criarCelula(fluxo?.segunda?.quantidade ?? '—', 'mono'));
            tr.appendChild(criarCelula(fluxo?.terceira?.quantidade ?? '—', 'mono'));

            const tdStatus = document.createElement('td');
            const [cls, label] = statusPendenciaVisual(item.statusPendencia);
            tdStatus.appendChild(criarBadge(label, cls));
            tr.appendChild(tdStatus);

            tr.appendChild(criarCelula(fluxo?.operadorResponsavel || 'Nao atribuido'));
            tbody.appendChild(tr);
          });

          table.appendChild(tbody);
          tableWrap.appendChild(table);
          wrap.appendChild(tableWrap);

          if (divAbertas.length > 10) {
            const more = document.createElement('div');
            more.style.padding = '8px 16px';
            more.style.fontSize = '.75rem';
            more.style.color = 'var(--muted)';
            more.textContent = `... e mais ${divAbertas.length - 10}. Veja a aba Divergencias.`;
            wrap.appendChild(more);
          }
        }
      }
    }
  }

  function renderPendencias() {
    const selectInv = document.getElementById('pend-sel-inv');
    const busca = lower(document.getElementById('pend-busca')?.value);
    const fStatus = texto(document.getElementById('pend-fstatus')?.value);
    const fLocal = texto(document.getElementById('pend-flocal')?.value);
    const fRua = texto(document.getElementById('pend-frua')?.value);
    const currentInv = texto(selectInv?.value);

    const inventariosElegiveis = (state().inventarios || []).filter(inv =>
      ['ATIVO', 'ABERTO', 'PUBLICADO', 'LIBERADO', 'EM_ANDAMENTO', 'PAUSADO']
        .includes(upper(inv.status)) ||
      Array.isArray(inv.enderecos_selecionados)
    );

    setSelectOptions(
      'pend-sel-inv',
      inventariosElegiveis.map(inv => ({
        value: obterInventarioCanonicoId(inv),
        label: `${texto(inv.codigo)} — ${texto(inv.nome)}`
      })),
      'Selecione um inventario...',
      currentInv
    );

    const invId = texto(document.getElementById('pend-sel-inv')?.value);

    if (!invId) {
      const container = document.getElementById('pend-table-wrap');
      if (container) {
        container.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Selecione um inventario</div></div>';
      }

      ['pk-total', 'pk-contados', 'pk-pendentes', 'pk-pct', 'pk-rec-pend', 'pk-div-abertas']
        .forEach(id => setText(id, '—'));

      return;
    }

    const inventario = inventariosElegiveis.find(inv =>
      obterInventarioCanonicoId(inv) === invId
    );

    if (!inventario) return;

    const fluxos = obterFluxosCanonicos();
    const lista = construirPendenciasInventario(inventario, fluxos);

    setSelectOptions(
      'pend-flocal',
      [...new Set(lista.map(item => item.setor).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR')),
      'Todos os locais',
      fLocal
    );

    setSelectOptions(
      'pend-frua',
      [...new Set(lista.map(item => item.rua).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
      'Todas as ruas',
      fRua
    );

    let filtrada = lista.slice();

    if (fStatus) {
      filtrada = filtrada.filter(item => item.statusPendencia === fStatus);
    }

    if (fLocal) {
      filtrada = filtrada.filter(item => item.setor === fLocal);
    }

    if (fRua) {
      filtrada = filtrada.filter(item => item.rua === fRua);
    }

    if (busca) {
      filtrada = filtrada.filter(item =>
        [
          item.endereco,
          item.setor,
          item.rua,
          item.fluxo?.produto,
          item.fluxo?.descricao,
          item.fluxo?.operadorResponsavel
        ].some(value => lower(value).includes(busca))
      );
    }

    const total = lista.length;
    const concluidos = lista.filter(item =>
      ['CONCLUIDO', 'VAZIO_CONFIRMADO'].includes(item.statusPendencia)
    ).length;

    const pendentesContagem = lista.filter(item =>
      item.statusPendencia === 'PENDENTE_CONTAGEM'
    ).length;

    const pendenciasFluxo = lista.filter(item =>
      [
        'DIVERGENCIA_ABERTA',
        'EM_RECONTAGEM',
        'AGUARDANDO_ANALISTA',
        'PERSISTENTE'
      ].includes(item.statusPendencia)
    ).length;

    const inativos = lista.filter(item => item.statusPendencia === 'INATIVO').length;
    const limite = lista.filter(item => item.statusPendencia === 'LIMITE_ATINGIDO').length;
    const elegiveis = total - inativos;
    const pct = elegiveis > 0 ? Math.round((concluidos / elegiveis) * 100) : 0;

    setText('pk-total', total.toLocaleString('pt-BR'));
    setText('pk-contados', concluidos.toLocaleString('pt-BR'));
    setText(
      'pk-pendentes',
      `${pendentesContagem + pendenciasFluxo}${limite ? ` + ${limite} bloqueado(s)` : ''}`
    );
    setText('pk-pct', `${pct}%`);

    renderResumoFluxosPendencias(lista);

    const container = document.getElementById('pend-table-wrap');
    if (!container) return;

    container.replaceChildren();

    if (inativos > 0) {
      const warning = document.createElement('div');
      warning.className = 'alert warn';
      warning.style.margin = '12px 16px 0';
      warning.style.borderRadius = '8px';
      warning.textContent = `${inativos} endereco(s) inativo(s) nao entram no progresso.`;
      container.appendChild(warning);
    }

    if (limite > 0) {
      const warning = document.createElement('div');
      warning.className = 'alert warn';
      warning.style.margin = '8px 16px 0';
      warning.style.borderRadius = '8px';
      warning.textContent = `${limite} endereco(s) com limite de paletes atingido.`;
      container.appendChild(warning);
    }

    if (!filtrada.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<div class="empty-icon">✓</div><div class="empty-title">Nenhum endereco encontrado com esses filtros</div>';
      container.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'tbl-wrap';
    const table = document.createElement('table');

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');

    [
      'Endereco',
      'Local/Area',
      'Rua',
      'Nivel',
      'Tipo',
      'Paletes',
      'Status operacional',
      'Status do fluxo',
      'Responsavel'
    ].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      hr.appendChild(th);
    });

    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    filtrada.forEach(item => {
      const tr = document.createElement('tr');

      if (item.inativo || item.limiteAtingido) tr.style.opacity = '.6';

      tr.appendChild(criarCelula(item.endereco, 'mono'));
      tr.appendChild(criarCelula(item.setor));
      tr.appendChild(criarCelula(item.rua));
      tr.appendChild(criarCelula(item.nivel));
      tr.appendChild(criarCelula(item.tipo));

      const capacidade = item.capacidade == null ? '∞' : item.capacidade;
      tr.appendChild(criarCelula(`${item.usados}/${capacidade}`, 'mono', {
        fontWeight: '700',
        color: item.limiteAtingido ? 'var(--danger)' : 'inherit'
      }));

      const [statusClass, statusLabel] = statusPendenciaVisual(item.statusPendencia);
      const tdOperational = document.createElement('td');
      tdOperational.appendChild(criarBadge(statusLabel, statusClass));
      tr.appendChild(tdOperational);

      const tdFlow = document.createElement('td');

      if (item.fluxo) {
        const flowBadgeClass = item.fluxo.status === 'RESOLVIDA'
          ? 'b-green'
          : item.fluxo.status === 'PERSISTENTE'
            ? 'b-red'
            : item.fluxo.status === 'EM_RECONTAGEM'
              ? 'b-purple'
              : item.fluxo.status === 'AGUARDANDO_ANALISTA'
                ? 'b-orange'
                : 'b-red';

        tdFlow.appendChild(criarBadge(item.fluxo.status, flowBadgeClass));
      } else {
        tdFlow.appendChild(criarBadge('SEM DIVERGENCIA', 'b-gray'));
      }

      tr.appendChild(tdFlow);
      tr.appendChild(criarCelula(item.fluxo?.operadorResponsavel || '—'));
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);

    setText(
      'pend-end-count',
      `${pendentesContagem + pendenciasFluxo} endereco(s) aguardando de ${total} total`
    );
  }

  /* ------------------------------------------------------------------------
   * EVENTOS
   * --------------------------------------------------------------------- */

  function handleAction(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === 'restore-count') {
      G.restaurarContagem?.(id);
      return;
    }

    if (action === 'reverse-count') {
      G.abrirEstorno?.(id);
      return;
    }

    if (action === 'register-recount') {
      G.abrirRegistrarRecontagem?.(id);
    }
  }

  function bindEvents() {
    const contWrap = document.getElementById('cont-table-wrap');
    const pendRecWrap = document.getElementById('pend-rec-wrap');

    if (contWrap && !contWrap.dataset.canonicalEvents) {
      contWrap.addEventListener('click', handleAction);
      contWrap.dataset.canonicalEvents = '1';
    }

    if (pendRecWrap && !pendRecWrap.dataset.canonicalEvents) {
      pendRecWrap.addEventListener('click', handleAction);
      pendRecWrap.dataset.canonicalEvents = '1';
    }
  }

  G._produtoContagemExibicao = obterProdutoContagem;
  G.contStatusBadge = statusBadgeContagem;
  G._resultadoRodadaEndereco = function resultadoRodadaEnderecoCompat(contagem) {
    const map = mapaFluxos();
    return resultadoCanonicoDaContagem(contagem, obterFluxoDaContagem(contagem, map));
  };

  G.renderContagens = function renderContagensPublic() {
    bindEvents();
    return renderContagens();
  };

  G.renderPendencias = function renderPendenciasPublic() {
    bindEvents();
    return renderPendencias();
  };

  G.AnalistaContagensPendenciasModule = Object.freeze({
    obterProdutoContagem,
    resultadoCanonicoDaContagem,
    construirPendenciasInventario,
    renderContagens,
    renderPendencias
  });

  bindEvents();
})();
