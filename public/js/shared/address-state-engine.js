(function (global) {
  'use strict';

  const EPSILON = 1e-9;
  const CLOSED = new Set(['CANCELADA', 'CANCELADO', 'EXCLUIDA', 'EXCLUIDO', 'ESTORNADA', 'ESTORNADO']);
  const text = value => String(value == null ? '' : value).trim().toUpperCase();
  const number = value => {
    if (value == null || String(value).trim() === '') return null;
    const raw = String(value).trim().replace(/\s/g, '');
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const qty = value => {
    var _number;
    return (_number = number(value)) !== null && _number !== void 0 ? _number : 0;
  };
  const same = (a, b) => a != null && b != null && Math.abs(a - b) < EPSILON;
  const address = row => text(row === null || row === void 0 ? void 0 : row.endereco);
  const timestamp = row => String((row === null || row === void 0 ? void 0 : row.atualizado_em) || (row === null || row === void 0 ? void 0 : row.finalizada_em) || (row === null || row === void 0 ? void 0 : row.recontagem_concluida_em) || (row === null || row === void 0 ? void 0 : row.concluida_em) || (row === null || row === void 0 ? void 0 : row.timestamp) || (row === null || row === void 0 ? void 0 : row.criado_em) || (row === null || row === void 0 ? void 0 : row.dataHora) || '');
  const rawInventoryId = row => {
    var _ref, _ref2, _ref3, _row$inventario_id;
    return String((_ref = (_ref2 = (_ref3 = (_row$inventario_id = row === null || row === void 0 ? void 0 : row.inventario_id) !== null && _row$inventario_id !== void 0 ? _row$inventario_id : row === null || row === void 0 ? void 0 : row.inventarioId) !== null && _ref3 !== void 0 ? _ref3 : row === null || row === void 0 ? void 0 : row.inventario) !== null && _ref2 !== void 0 ? _ref2 : row === null || row === void 0 ? void 0 : row.inv_id) !== null && _ref !== void 0 ? _ref : '').trim();
  };
  const aliases = inv => [inv === null || inv === void 0 ? void 0 : inv.id, inv === null || inv === void 0 ? void 0 : inv.codigo, inv === null || inv === void 0 ? void 0 : inv.nome, inv === null || inv === void 0 ? void 0 : inv.inventario_id, inv === null || inv === void 0 ? void 0 : inv.inventarioId].filter(Boolean).map(String);
  const canonicalInventoryId = (row, inventories) => {
    const raw = rawInventoryId(row);
    const found = (inventories || []).find(inv => aliases(inv).includes(raw));
    return String((found === null || found === void 0 ? void 0 : found.id) || raw);
  };
  const isClosed = row => CLOSED.has(text(row === null || row === void 0 ? void 0 : row.status)) || CLOSED.has(text(row === null || row === void 0 ? void 0 : row.status_recontagem)) || (row === null || row === void 0 ? void 0 : row._excluida) === true;
  const isRecountReading = row => text(row === null || row === void 0 ? void 0 : row.tipo_contagem) === 'RECONTAGEM';
  const productCode = row => {
    var _ref4, _ref5, _ref6, _ref7, _ref8, _ref9, _ref0, _ref1, _ref10, _row$codigo_produto;
    return text((_ref4 = (_ref5 = (_ref6 = (_ref7 = (_ref8 = (_ref9 = (_ref0 = (_ref1 = (_ref10 = (_row$codigo_produto = row === null || row === void 0 ? void 0 : row.codigo_produto) !== null && _row$codigo_produto !== void 0 ? _row$codigo_produto : row === null || row === void 0 ? void 0 : row.codigoProduto) !== null && _ref10 !== void 0 ? _ref10 : row === null || row === void 0 ? void 0 : row.codigo_interno) !== null && _ref1 !== void 0 ? _ref1 : row === null || row === void 0 ? void 0 : row.sku) !== null && _ref0 !== void 0 ? _ref0 : row === null || row === void 0 ? void 0 : row.gtin) !== null && _ref9 !== void 0 ? _ref9 : row === null || row === void 0 ? void 0 : row.gtinLido) !== null && _ref8 !== void 0 ? _ref8 : row === null || row === void 0 ? void 0 : row.produto) !== null && _ref7 !== void 0 ? _ref7 : row === null || row === void 0 ? void 0 : row.produto_recontagem) !== null && _ref6 !== void 0 ? _ref6 : row === null || row === void 0 ? void 0 : row.ean) !== null && _ref5 !== void 0 ? _ref5 : row === null || row === void 0 ? void 0 : row.dun) !== null && _ref4 !== void 0 ? _ref4 : 'SEM_PRODUTO');
  };
  const productDescription = row => String((row === null || row === void 0 ? void 0 : row.descricao_produto) || (row === null || row === void 0 ? void 0 : row.descricao) || (row === null || row === void 0 ? void 0 : row.nome_produto) || '').trim();
  const palletId = row => {
    var _ref11, _ref12, _ref13, _ref14, _ref15, _row$palete_id;
    return String((_ref11 = (_ref12 = (_ref13 = (_ref14 = (_ref15 = (_row$palete_id = row === null || row === void 0 ? void 0 : row.palete_id) !== null && _row$palete_id !== void 0 ? _row$palete_id : row === null || row === void 0 ? void 0 : row.pallet_id) !== null && _ref15 !== void 0 ? _ref15 : row === null || row === void 0 ? void 0 : row.palete) !== null && _ref14 !== void 0 ? _ref14 : row === null || row === void 0 ? void 0 : row.pallet) !== null && _ref13 !== void 0 ? _ref13 : row === null || row === void 0 ? void 0 : row.numero_palete) !== null && _ref12 !== void 0 ? _ref12 : row === null || row === void 0 ? void 0 : row.capa_palete) !== null && _ref11 !== void 0 ? _ref11 : '').trim();
  };
  function uniqueOperationalRows(rows) {
    const seen = new Set();
    return (rows || []).filter((row, index) => {
      const explicit = String((row === null || row === void 0 ? void 0 : row.uuid) || (row === null || row === void 0 ? void 0 : row.id) || (row === null || row === void 0 ? void 0 : row.contagem_uuid) || (row === null || row === void 0 ? void 0 : row.recontagem_id) || (row === null || row === void 0 ? void 0 : row.divergencia_id) || '').trim();
      // Só deduplica por identidade explícita. Linhas iguais sem ID podem ser pallets reais distintos.
      if (!explicit) return true;
      const key = explicit;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function expectedQuantity(row) {
    var _ref16, _ref17, _ref18, _ref19, _ref20, _ref21, _ref22, _ref23, _ref24, _ref25, _ref26, _ref27, _ref28, _ref29, _ref30, _ref31, _row$quantidade_esper;
    return (_ref16 = (_ref17 = (_ref18 = (_ref19 = (_ref20 = (_ref21 = (_ref22 = (_ref23 = (_ref24 = (_ref25 = (_ref26 = (_ref27 = (_ref28 = (_ref29 = (_ref30 = (_ref31 = (_row$quantidade_esper = row === null || row === void 0 ? void 0 : row.quantidade_esperada) !== null && _row$quantidade_esper !== void 0 ? _row$quantidade_esper : row === null || row === void 0 ? void 0 : row.quantidadeEsperada) !== null && _ref31 !== void 0 ? _ref31 : row === null || row === void 0 ? void 0 : row.qtd_esperada) !== null && _ref30 !== void 0 ? _ref30 : row === null || row === void 0 ? void 0 : row.qtdEsperada) !== null && _ref29 !== void 0 ? _ref29 : row === null || row === void 0 ? void 0 : row.quantidade_sistema) !== null && _ref28 !== void 0 ? _ref28 : row === null || row === void 0 ? void 0 : row.quantidadeSistema) !== null && _ref27 !== void 0 ? _ref27 : row === null || row === void 0 ? void 0 : row.quantidade_enderecada) !== null && _ref26 !== void 0 ? _ref26 : row === null || row === void 0 ? void 0 : row.qtd_enderecada) !== null && _ref25 !== void 0 ? _ref25 : row === null || row === void 0 ? void 0 : row.saldo_estoque) !== null && _ref24 !== void 0 ? _ref24 : row === null || row === void 0 ? void 0 : row.saldo) !== null && _ref23 !== void 0 ? _ref23 : row === null || row === void 0 ? void 0 : row.saldo_erp) !== null && _ref22 !== void 0 ? _ref22 : row === null || row === void 0 ? void 0 : row.qtd_sistema) !== null && _ref21 !== void 0 ? _ref21 : row === null || row === void 0 ? void 0 : row.qtd_estoque) !== null && _ref20 !== void 0 ? _ref20 : row === null || row === void 0 ? void 0 : row.estoque_total) !== null && _ref19 !== void 0 ? _ref19 : row === null || row === void 0 ? void 0 : row.estoque) !== null && _ref18 !== void 0 ? _ref18 : row === null || row === void 0 ? void 0 : row.quantidade) !== null && _ref17 !== void 0 ? _ref17 : row === null || row === void 0 ? void 0 : row.qtd) !== null && _ref16 !== void 0 ? _ref16 : row === null || row === void 0 ? void 0 : row.qtde;
  }
  function readingQuantity(row) {
    var _ref32, _ref33, _ref34, _row$quantidade;
    return (_ref32 = (_ref33 = (_ref34 = (_row$quantidade = row === null || row === void 0 ? void 0 : row.quantidade) !== null && _row$quantidade !== void 0 ? _row$quantidade : row === null || row === void 0 ? void 0 : row.qtd_caixas) !== null && _ref34 !== void 0 ? _ref34 : row === null || row === void 0 ? void 0 : row.qtd_contada) !== null && _ref33 !== void 0 ? _ref33 : row === null || row === void 0 ? void 0 : row.qtd_primeira) !== null && _ref32 !== void 0 ? _ref32 : row === null || row === void 0 ? void 0 : row.qtd;
  }
  function recountQuantity(row, round) {
    var _ref35, _ref36, _row$qtd_segunda, _ref37, _ref38, _row$qtd_terceira;
    return round === 1 ? (_ref35 = (_ref36 = (_row$qtd_segunda = row === null || row === void 0 ? void 0 : row.qtd_segunda) !== null && _row$qtd_segunda !== void 0 ? _row$qtd_segunda : row === null || row === void 0 ? void 0 : row.qtd_recontagem) !== null && _ref36 !== void 0 ? _ref36 : row === null || row === void 0 ? void 0 : row.quantidade) !== null && _ref35 !== void 0 ? _ref35 : row === null || row === void 0 ? void 0 : row.qtd : (_ref37 = (_ref38 = (_row$qtd_terceira = row === null || row === void 0 ? void 0 : row.qtd_terceira) !== null && _row$qtd_terceira !== void 0 ? _row$qtd_terceira : row === null || row === void 0 ? void 0 : row.qtd_recontagem) !== null && _ref38 !== void 0 ? _ref38 : row === null || row === void 0 ? void 0 : row.quantidade) !== null && _ref37 !== void 0 ? _ref37 : row === null || row === void 0 ? void 0 : row.qtd;
  }
  function groupItems(rows, quantityGetter) {
    const grouped = new Map();
    (rows || []).forEach(row => {
      const code = productCode(row);
      const amount = number(quantityGetter(row));
      if (amount == null) return;
      const current = grouped.get(code) || {
        codigo_produto: code,
        descricao_produto: productDescription(row),
        quantidade: 0,
        paletes: [],
        registros: 0
      };
      current.quantidade += amount;
      current.registros += 1;
      const pallet = palletId(row);
      if (pallet && !current.paletes.includes(pallet)) current.paletes.push(pallet);
      if (!current.descricao_produto) current.descricao_produto = productDescription(row);
      grouped.set(code, current);
    });
    return [...grouped.values()].sort((a, b) => a.codigo_produto.localeCompare(b.codigo_produto));
  }
  function snapshotExpected(inventory, targetAddress) {
    const target = text(targetAddress);
    const baseRows = ((inventory === null || inventory === void 0 ? void 0 : inventory.base) || []).filter(row => address(row) === target);
    const seenIds = new Set();
    const valid = baseRows.filter(row => {
      const explicit = String((row === null || row === void 0 ? void 0 : row.id) || (row === null || row === void 0 ? void 0 : row.uuid) || (row === null || row === void 0 ? void 0 : row.base_id) || (row === null || row === void 0 ? void 0 : row.registro_id) || '').trim();
      if (!explicit) return true;
      if (seenIds.has(explicit)) return false;
      seenIds.add(explicit);
      return true;
    });
    return groupItems(valid, expectedQuantity).map(item => ({
      codigo_produto: item.codigo_produto,
      descricao_produto: item.descricao_produto,
      quantidade_esperada: item.quantidade,
      quantidade_paletes_base: item.registros,
      paletes: item.paletes
    }));
  }
  function roundSnapshot(rows, quantityGetter, n) {
    const clean = uniqueOperationalRows(rows).filter(r => number(quantityGetter(r)) != null);
    if (!clean.length) return null;
    const items = groupItems(clean, quantityGetter);
    const operators = [...new Set(clean.map(r => String((r === null || r === void 0 ? void 0 : r.operador_recontagem) || (r === null || r === void 0 ? void 0 : r.operador) || (r === null || r === void 0 ? void 0 : r.operador_nome) || '').trim()).filter(Boolean))];
    const dates = clean.map(timestamp).filter(Boolean).sort();
    return Object.freeze({
      numero: n,
      total: items.reduce((t, i) => t + i.quantidade, 0),
      itens: items,
      operadores: operators,
      data: dates[dates.length - 1] || null,
      registros: clean.length,
      origens: clean
    });
  }
  function evaluateTotals(expected, first, second, third) {
    if (expected == null) return Object.freeze({
      estado: 'SEM_BASE',
      referencia: 'TOTAL_ESPERADO_INDISPONIVEL',
      rodada: 0,
      resultado: null,
      rodadasQueBateram: [],
      esperado: null,
      fluxoConsolidado: true
    });
    const rounds = [{
      n: 1,
      v: first
    }, {
      n: 2,
      v: second
    }, {
      n: 3,
      v: third
    }];
    const matched = rounds.filter(r => same(r.v, expected)).map(r => r.n);
    const hit = rounds.find(r => same(r.v, expected));
    if (hit) return Object.freeze({
      estado: 'RESOLVIDA',
      referencia: `OK_${hit.n}_TOTAL_ENDERECO`,
      rodada: hit.n,
      resultado: {
        qtd: hit.v,
        produto: 'TOTAL_ENDERECO'
      },
      rodadasQueBateram: matched,
      esperado: expected,
      fluxoConsolidado: true
    });
    if (first == null) return Object.freeze({
      estado: 'AGUARDANDO_CONTAGEM',
      referencia: null,
      rodada: 0,
      resultado: null,
      rodadasQueBateram: matched,
      esperado: expected,
      fluxoConsolidado: true
    });
    if (third != null) return Object.freeze({
      estado: 'PERSISTENTE',
      referencia: 'TERCEIRA_DIVERGENTE_TOTAL_ENDERECO',
      rodada: 3,
      resultado: {
        qtd: third,
        produto: 'TOTAL_ENDERECO'
      },
      rodadasQueBateram: matched,
      esperado: expected,
      fluxoConsolidado: true
    });
    return Object.freeze({
      estado: 'AGUARDANDO_RECONTAGEM',
      referencia: null,
      rodada: second != null ? 2 : 1,
      resultado: {
        qtd: second !== null && second !== void 0 ? second : first,
        produto: 'TOTAL_ENDERECO'
      },
      rodadasQueBateram: matched,
      esperado: expected,
      fluxoConsolidado: true
    });
  }
  function consolidate(input) {
    var _divergences$map$find, _round1$total, _round, _round2$total, _round3$total, _round1$total2, _round2, _round2$total2, _round3$total2;
    const state = (input === null || input === void 0 ? void 0 : input.state) || {},
      inventories = state.inventarios || [];
    const source = (input === null || input === void 0 ? void 0 : input.record) || {
      inventario_id: input === null || input === void 0 ? void 0 : input.inventarioId,
      endereco: input === null || input === void 0 ? void 0 : input.endereco
    };
    const invId = canonicalInventoryId(source, inventories),
      targetAddress = address(source);
    const sameAddress = row => canonicalInventoryId(row, inventories) === invId && address(row) === targetAddress;
    const inventory = inventories.find(inv => String(inv === null || inv === void 0 ? void 0 : inv.id) === invId || aliases(inv).includes(invId)) || null;
    const expectedItems = snapshotExpected(inventory, targetAddress);
    const counts = uniqueOperationalRows((state.contagens || []).filter(row => sameAddress(row) && !isClosed(row)));
    const divergences = uniqueOperationalRows((state.divergencias || []).filter(row => sameAddress(row) && !isClosed(row)));
    const recountDocs = uniqueOperationalRows((state.recontagens || []).filter(row => sameAddress(row) && !isClosed(row)));
    let expected = expectedItems.length ? expectedItems.reduce((t, i) => t + qty(i.quantidade_esperada), 0) : null;
    if (expected == null) expected = (_divergences$map$find = divergences.map(d => {
      var _d$qtd_esperada;
      return number((_d$qtd_esperada = d === null || d === void 0 ? void 0 : d.qtd_esperada) !== null && _d$qtd_esperada !== void 0 ? _d$qtd_esperada : d === null || d === void 0 ? void 0 : d.quantidade_esperada);
    }).find(v => v != null)) !== null && _divergences$map$find !== void 0 ? _divergences$map$find : number(source === null || source === void 0 ? void 0 : source.qtd_esperada);
    const firstRows = counts.filter(row => !isRecountReading(row));
    let round1 = roundSnapshot(firstRows, readingQuantity, 1);
    if (!round1) round1 = roundSnapshot(divergences, r => {
      var _r$qtd_primeira;
      return (_r$qtd_primeira = r === null || r === void 0 ? void 0 : r.qtd_primeira) !== null && _r$qtd_primeira !== void 0 ? _r$qtd_primeira : r === null || r === void 0 ? void 0 : r.qtd_contada;
    }, 1);
    function recountRound(round) {
      const readings = counts.filter(isRecountReading).filter(r => Number((r === null || r === void 0 ? void 0 : r.numero_recontagem) || 1) === round);
      const fromReadings = roundSnapshot(readings, readingQuantity, round + 1);
      if (fromReadings) return fromReadings;
      const docs = recountDocs.filter(r => Number((r === null || r === void 0 ? void 0 : r.numero_recontagem) || 1) === round);
      const fromDocs = roundSnapshot(docs, r => recountQuantity(r, round), round + 1);
      if (fromDocs) return fromDocs;
      return roundSnapshot(divergences, r => round === 1 ? r === null || r === void 0 ? void 0 : r.qtd_segunda : r === null || r === void 0 ? void 0 : r.qtd_terceira, round + 1);
    }
    const round2 = recountRound(1),
      round3 = recountRound(2);
    const evaluation = evaluateTotals(expected, (_round1$total = (_round = round1) === null || _round === void 0 ? void 0 : _round.total) !== null && _round1$total !== void 0 ? _round1$total : null, (_round2$total = round2 === null || round2 === void 0 ? void 0 : round2.total) !== null && _round2$total !== void 0 ? _round2$total : null, (_round3$total = round3 === null || round3 === void 0 ? void 0 : round3.total) !== null && _round3$total !== void 0 ? _round3$total : null);
    const status = evaluation.estado === 'RESOLVIDA' ? 'RESOLVIDA' : evaluation.estado === 'PERSISTENTE' ? 'PERSISTENTE' : evaluation.estado === 'SEM_BASE' ? 'SEM_BASE' : evaluation.estado === 'AGUARDANDO_CONTAGEM' ? 'PENDENTE' : round2 ? 'EM_RECONTAGEM' : 'DIVERGENTE';
    const all = [...counts, ...divergences, ...recountDocs];
    return Object.freeze({
      chave: `${invId}|${targetAddress}`,
      inventario_id: invId,
      inventario: inventory,
      endereco: targetAddress,
      esperado: expected,
      primeira: (_round1$total2 = (_round2 = round1) === null || _round2 === void 0 ? void 0 : _round2.total) !== null && _round1$total2 !== void 0 ? _round1$total2 : null,
      segunda: (_round2$total2 = round2 === null || round2 === void 0 ? void 0 : round2.total) !== null && _round2$total2 !== void 0 ? _round2$total2 : null,
      terceira: (_round3$total2 = round3 === null || round3 === void 0 ? void 0 : round3.total) !== null && _round3$total2 !== void 0 ? _round3$total2 : null,
      rodadas: Object.freeze([round1, round2, round3]),
      ultimaRodada: round3 || round2 || round1 || null,
      status,
      status_recontagem: evaluation.estado === 'RESOLVIDA' ? 'sem_divergencia' : evaluation.estado === 'PERSISTENTE' ? 'persistente' : evaluation.estado === 'SEM_BASE' ? 'sem_base' : round2 ? 'aguardando_analista' : 'aguardando_recontagem',
      divergente: evaluation.estado !== 'RESOLVIDA',
      precisa_recontagem: ['AGUARDANDO_RECONTAGEM'].includes(evaluation.estado),
      avaliacao: evaluation,
      itens_esperados: expectedItems,
      contagens: counts,
      divergencias: divergences,
      recontagens: recountDocs,
      atualizado_em: all.map(timestamp).filter(Boolean).sort().pop() || null
    });
  }
  function decorate(record, state) {
    const s = consolidate({
      state,
      record
    });
    return Object.assign({}, record, {
      _estado_endereco: s,
      status: s.status,
      status_recontagem: s.status_recontagem,
      divergente: s.divergente,
      precisa_recontagem: s.precisa_recontagem,
      qtd_esperada: s.esperado,
      qtd_primeira: s.primeira,
      qtd_segunda: s.segunda,
      qtd_terceira: s.terceira
    });
  }
  function list(state) {
    const rows = [...((state === null || state === void 0 ? void 0 : state.contagens) || []), ...((state === null || state === void 0 ? void 0 : state.divergencias) || []), ...((state === null || state === void 0 ? void 0 : state.recontagens) || [])],
      inventories = (state === null || state === void 0 ? void 0 : state.inventarios) || [],
      keys = new Map();
    rows.filter(r => !isClosed(r) && address(r)).forEach(r => {
      const k = `${canonicalInventoryId(r, inventories)}|${address(r)}`;
      if (!keys.has(k)) keys.set(k, r);
    });
    return [...keys.values()].map(record => consolidate({
      state,
      record
    }));
  }
  function fromHistory(h) {
    var _h$qtd_primeira, _h$qtd_segunda;
    return evaluateTotals(number(h === null || h === void 0 ? void 0 : h.qtd_esperada), number((_h$qtd_primeira = h === null || h === void 0 ? void 0 : h.qtd_primeira) !== null && _h$qtd_primeira !== void 0 ? _h$qtd_primeira : h === null || h === void 0 ? void 0 : h.qtd_contada), number((_h$qtd_segunda = h === null || h === void 0 ? void 0 : h.qtd_segunda) !== null && _h$qtd_segunda !== void 0 ? _h$qtd_segunda : h === null || h === void 0 ? void 0 : h.qtd_recontagem), number(h === null || h === void 0 ? void 0 : h.qtd_terceira));
  }

  // Fotografia operacional canônica. O histórico preserva todas as rodadas,
  // mas tela, totais e exportações recebem somente a rodada concluída mais
  // recente de cada inventário/endereço. Uma recontagem nunca é somada à
  // primeira contagem: ela a substitui integralmente, inclusive quando possui
  // menos paletes.
  function physicalRound(row) {
    return isRecountReading(row) ? Math.min(3, 1 + Math.max(1, Number((row === null || row === void 0 ? void 0 : row.numero_recontagem) || 1))) : 1;
  }
  function recountCompleted(row, state) {
    if (physicalRound(row) === 1) return true;
    const status = text((row === null || row === void 0 ? void 0 : row.status_recontagem) || (row === null || row === void 0 ? void 0 : row.status));
    if (['CANCELADA', 'CANCELADO', 'EXCLUIDA', 'EXCLUIDO', 'ESTORNADA', 'ESTORNADO', 'PENDENTE', 'ATRIBUIDA', 'ATRIBUÍDA', 'EM_ANDAMENTO', 'ABERTA'].includes(status)) return false;
    const rid = String((row === null || row === void 0 ? void 0 : row.recontagem_id) || '').trim(),
      did = String((row === null || row === void 0 ? void 0 : row.divergencia_id) || '').trim();
    const round = Math.max(1, Number((row === null || row === void 0 ? void 0 : row.numero_recontagem) || 1));
    const task = ((state === null || state === void 0 ? void 0 : state.recontagens) || []).find(rec => {
      if (rid && String((rec === null || rec === void 0 ? void 0 : rec.id) || (rec === null || rec === void 0 ? void 0 : rec.recontagem_id) || '') === rid) return true;
      if (did && String((rec === null || rec === void 0 ? void 0 : rec.divergencia_id) || '') === did && Number((rec === null || rec === void 0 ? void 0 : rec.numero_recontagem) || round) === round) return true;
      return canonicalInventoryId(rec, (state === null || state === void 0 ? void 0 : state.inventarios) || []) === canonicalInventoryId(row, (state === null || state === void 0 ? void 0 : state.inventarios) || []) && address(rec) === address(row) && Number((rec === null || rec === void 0 ? void 0 : rec.numero_recontagem) || 0) === round;
    });
    const source = task || row,
      taskStatus = text((source === null || source === void 0 ? void 0 : source.status_recontagem) || (source === null || source === void 0 ? void 0 : source.status));
    if (['CANCELADA', 'CANCELADO', 'EXCLUIDA', 'EXCLUIDO', 'ESTORNADA', 'ESTORNADO', 'PENDENTE', 'ATRIBUIDA', 'ATRIBUÍDA', 'EM_ANDAMENTO', 'ABERTA'].includes(taskStatus)) return false;
    return Boolean((source === null || source === void 0 ? void 0 : source.recontagem_concluida_em) || (source === null || source === void 0 ? void 0 : source.concluida_em) || (source === null || source === void 0 ? void 0 : source.finalizada_em) || (source === null || source === void 0 ? void 0 : source.data_segunda) || (source === null || source === void 0 ? void 0 : source.data_terceira)) || ['CONCLUIDA', 'CONCLUÍDA', 'FINALIZADA', 'PROCESSADA', 'RESOLVIDA', 'AGUARDANDO_ANALISTA', 'SEM_DIVERGENCIA'].includes(taskStatus);
  }
  function physicalPalletKey(row, index) {
    var _ref39, _ref40, _ref41, _ref42, _ref43, _ref44, _row$palete, _readingQuantity;
    const pallet = text((_ref39 = (_ref40 = (_ref41 = (_ref42 = (_ref43 = (_ref44 = (_row$palete = row === null || row === void 0 ? void 0 : row.palete) !== null && _row$palete !== void 0 ? _row$palete : row === null || row === void 0 ? void 0 : row.pallet) !== null && _ref44 !== void 0 ? _ref44 : row === null || row === void 0 ? void 0 : row.numero_palete) !== null && _ref43 !== void 0 ? _ref43 : row === null || row === void 0 ? void 0 : row.numeroPalete) !== null && _ref42 !== void 0 ? _ref42 : row === null || row === void 0 ? void 0 : row.palete_key) !== null && _ref41 !== void 0 ? _ref41 : row === null || row === void 0 ? void 0 : row.capa_palete) !== null && _ref40 !== void 0 ? _ref40 : row === null || row === void 0 ? void 0 : row.capa) !== null && _ref39 !== void 0 ? _ref39 : row === null || row === void 0 ? void 0 : row.sscc);
    if (pallet) return `PAL:${pallet}`;
    const explicit = String((row === null || row === void 0 ? void 0 : row.uuid) || (row === null || row === void 0 ? void 0 : row.id) || (row === null || row === void 0 ? void 0 : row.contagem_uuid) || '').trim();
    if (explicit) return `DOC:${explicit}`;
    return `LINHA:${productCode(row)}|${(_readingQuantity = readingQuantity(row)) !== null && _readingQuantity !== void 0 ? _readingQuantity : ''}|${timestamp(row) || index}`;
  }
  function latestPhysicalRows(state, inventoryId) {
    const inventories = (state === null || state === void 0 ? void 0 : state.inventarios) || [],
      groups = new Map();
    ((state === null || state === void 0 ? void 0 : state.contagens) || []).forEach((row, index) => {
      if (isClosed(row) || !address(row) || !recountCompleted(row, state)) return;
      const inv = canonicalInventoryId(row, inventories);
      if (inventoryId && inv !== canonicalInventoryId({
        inventario_id: inventoryId
      }, inventories)) return;
      const key = `${inv}|${address(row)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        row,
        index,
        round: physicalRound(row)
      });
    });
    const output = [];
    groups.forEach(entries => {
      const latest = Math.max(...entries.map(entry => entry.round));
      const unique = new Map();
      entries.filter(entry => entry.round === latest).forEach(entry => {
        const key = physicalPalletKey(entry.row, entry.index),
          previous = unique.get(key);
        if (!previous || timestamp(entry.row) >= timestamp(previous)) unique.set(key, entry.row);
      });
      unique.forEach(row => output.push(row));
    });
    return output;
  }
  global.InventoryAddressState = Object.freeze({
    consolidate,
    decorate,
    list,
    evaluateTotals,
    fromHistory,
    snapshotExpected,
    latestPhysicalRows,
    number,
    text
  });
})(window);