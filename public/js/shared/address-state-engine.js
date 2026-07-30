(function (global) {
  'use strict';

  const EPSILON = 1e-9;
  const CLOSED = new Set(['CANCELADA', 'EXCLUIDA', 'ESTORNADA']);

  const text = value => String(value == null ? '' : value).trim().toUpperCase();
  const number = value => {
    if (value == null || String(value).trim() === '') return null;
    const raw = String(value).trim().replace(/\s/g, '');
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const qty = value => number(value) ?? 0;
  const sum = (rows, getter) => rows.reduce((total, row) => total + qty(getter(row)), 0);
  const sameNumber = (a, b) => a != null && b != null && Math.abs(a - b) < EPSILON;
  const inventoryId = row => String(row?.inventario_id ?? row?.inventarioId ?? row?.inventario ?? row?.inv_id ?? row?.id ?? '').trim();
  const address = row => text(row?.endereco);
  const timestamp = row => String(row?.timestamp || row?.criado_em || row?.dataHora || row?.atualizado_em || '');
  const isClosed = row => CLOSED.has(text(row?.status)) || CLOSED.has(text(row?.status_recontagem)) || row?._excluida === true;
  const isRecountReading = row => text(row?.tipo_contagem) === 'RECONTAGEM';

  function aliases(inventory) {
    return [inventory?.id, inventory?.codigo, inventory?.nome, inventory?.inventario_id, inventory?.inventarioId]
      .filter(value => value != null && String(value).trim())
      .map(value => String(value).trim());
  }

  function canonicalInventoryId(row, inventories) {
    const raw = inventoryId(row);
    const found = (inventories || []).find(inventory => aliases(inventory).includes(raw));
    return String(found?.id || raw);
  }

  function unique(rows) {
    const seen = new Set();
    return (rows || []).filter(row => {
      const id = String(row?.uuid || row?.id || row?.contagem_uuid || row?.recontagem_id || row?.divergencia_id || '');
      const fallback = JSON.stringify([
        canonicalInventoryId(row, []), address(row), text(row?.tipo_contagem), Number(row?.numero_recontagem || 0),
        row?.palete ?? row?.pallet ?? row?.capa_palete ?? '', row?.quantidade ?? row?.qtd_recontagem ?? '', timestamp(row)
      ]);
      const key = id || fallback;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function expectedQuantity(row) {
    return row?.quantidade_esperada ?? row?.quantidadeEsperada ?? row?.qtd_esperada ?? row?.qtdEsperada ??
      row?.quantidade_sistema ?? row?.quantidadeSistema ?? row?.quantidade_enderecada ?? row?.qtd_enderecada ??
      row?.saldo_estoque ?? row?.saldo ?? row?.saldo_erp ?? row?.qtd_sistema ?? row?.qtd_estoque ??
      row?.estoque_total ?? row?.estoque ?? row?.quantidade ?? row?.qtd ?? row?.qtde;
  }

  function readingQuantity(row) {
    return row?.quantidade ?? row?.qtd_caixas ?? row?.qtd_contada ?? row?.qtd_primeira ?? row?.qtd;
  }

  function recountQuantity(row, round) {
    if (round === 1) return row?.qtd_segunda ?? row?.qtd_recontagem ?? row?.quantidade ?? row?.qtd;
    return row?.qtd_terceira ?? row?.qtd_recontagem ?? row?.quantidade ?? row?.qtd;
  }

  function snapshotExpected(inventory, targetAddress) {
    const target = text(targetAddress);
    const seen = new Set();
    const grouped = new Map();
    (inventory?.base || []).filter(row => address(row) === target).forEach(row => {
      const product = text(row?.codigo_produto ?? row?.codigoProduto ?? row?.codigo_interno ?? row?.sku ?? row?.gtin ?? row?.ean ?? row?.dun ?? 'SEM_PRODUTO');
      const pallet = text(row?.palete_id ?? row?.pallet_id ?? row?.palete ?? row?.pallet ?? row?.numero_palete ?? '');
      const lot = text(row?.lote ?? row?.lote_id ?? row?.numero_lote ?? '');
      const validity = text(row?.validade ?? row?.data_validade ?? '');
      const amount = qty(expectedQuantity(row));
      const identity = [target, pallet, product, lot, validity, amount].join('|');
      if (seen.has(identity)) return;
      seen.add(identity);
      const current = grouped.get(product) || { codigo_produto: product, descricao_produto: row?.descricao_produto || row?.descricao || '', quantidade_esperada: 0, quantidade_paletes_base: 0 };
      current.quantidade_esperada += amount;
      current.quantidade_paletes_base += 1;
      grouped.set(product, current);
    });
    return [...grouped.values()];
  }

  function evaluateTotals(expected, first, second, third) {
    const matchedRounds = [];
    if (sameNumber(first, expected)) matchedRounds.push(1);
    if (sameNumber(second, expected)) matchedRounds.push(2);
    if (sameNumber(third, expected)) matchedRounds.push(3);
    const result = (state, reference, round, value) => ({
      estado: state, referencia: reference, rodada: round, resultado: value == null ? null : { qtd: value, produto: 'TOTAL_ENDERECO' },
      rodadasQueBateram: matchedRounds, esperado: expected, fluxoConsolidado: true
    });
    if (sameNumber(first, expected)) return result('RESOLVIDA', 'OK_PRIMEIRA_TOTAL_ENDERECO', 1, first);
    if (second != null) {
      if (sameNumber(second, expected)) return result('RESOLVIDA', 'OK_SEGUNDA_TOTAL_ENDERECO', 2, second);
      if (sameNumber(second, first)) return result('RESOLVIDA', 'OK_SEGUNDA_PRIMEIRA_TOTAL_ENDERECO', 2, second);
    }
    if (third != null) {
      if (sameNumber(third, expected)) return result('RESOLVIDA', 'OK_TERCEIRA_TOTAL_ENDERECO', 3, third);
      if (sameNumber(third, first)) return result('RESOLVIDA', 'OK_TERCEIRA_PRIMEIRA_TOTAL_ENDERECO', 3, third);
      if (sameNumber(third, second)) return result('RESOLVIDA', 'OK_TERCEIRA_SEGUNDA_TOTAL_ENDERECO', 3, third);
      return result('PERSISTENTE', 'TERCEIRA_SEM_CONSENSO_TOTAL_ENDERECO', 3, third);
    }
    return result('AGUARDANDO_RECONTAGEM', null, second != null ? 2 : 1, second ?? first);
  }

  function consolidate(input) {
    const state = input?.state || {};
    const inventories = state.inventarios || [];
    const invId = canonicalInventoryId(input?.record || { inventario_id: input?.inventarioId }, inventories);
    const targetAddress = address(input?.record || { endereco: input?.endereco });
    const sameAddress = row => canonicalInventoryId(row, inventories) === invId && address(row) === targetAddress;
    const inventory = inventories.find(item => canonicalInventoryId(item, inventories) === invId) || null;
    const expectedItems = snapshotExpected(inventory, targetAddress);
    let expected = expectedItems.reduce((total, item) => total + qty(item.quantidade_esperada), 0);

    const counts = unique((state.contagens || []).filter(row => sameAddress(row) && !isClosed(row)));
    const firstRows = counts.filter(row => !isRecountReading(row));
    const recountReadings = counts.filter(isRecountReading);
    const divergences = unique((state.divergencias || []).filter(row => sameAddress(row) && !isClosed(row)));
    const recountDocs = unique((state.recontagens || []).filter(row => sameAddress(row) && !isClosed(row)));

    if (!expectedItems.length) {
      const fallback = divergences.map(row => number(row?.qtd_esperada)).find(value => value != null);
      expected = fallback ?? 0;
    }
    const first = firstRows.length ? sum(firstRows, readingQuantity) : divergences.reduce((total, row) => total + qty(row?.qtd_primeira ?? row?.qtd_contada), 0);
    const roundTotal = round => {
      const readings = recountReadings.filter(row => Number(row?.numero_recontagem || 1) === round);
      if (readings.length) return sum(readings, readingQuantity);
      const docs = recountDocs.filter(row => Number(row?.numero_recontagem || 1) === round && recountQuantity(row, round) != null);
      return docs.length ? sum(docs, row => recountQuantity(row, round)) : null;
    };
    const second = roundTotal(1);
    const third = roundTotal(2);
    const evaluation = evaluateTotals(expected, first, second, third);
    const status = evaluation.estado === 'RESOLVIDA' ? 'RESOLVIDA' : evaluation.estado === 'PERSISTENTE' ? 'PERSISTENTE' : (second == null ? 'DIVERGENTE' : 'EM_RECONTAGEM');

    return Object.freeze({
      chave: `${invId}|${targetAddress}`, inventario_id: invId, endereco: targetAddress,
      esperado: expected, primeira: first, segunda: second, terceira: third,
      status, status_recontagem: evaluation.estado === 'RESOLVIDA' ? 'sem_divergencia' : evaluation.estado === 'PERSISTENTE' ? 'persistente' : 'pendente',
      divergente: evaluation.estado !== 'RESOLVIDA', precisa_recontagem: evaluation.estado !== 'RESOLVIDA' && evaluation.estado !== 'PERSISTENTE',
      avaliacao: evaluation, itens_esperados: expectedItems, contagens: counts, divergencias: divergences, recontagens: recountDocs,
      atualizado_em: [counts, divergences, recountDocs].flat().map(timestamp).sort().pop() || null
    });
  }

  function fromHistory(history) {
    return evaluateTotals(number(history?.qtd_esperada) ?? 0, number(history?.qtd_primeira ?? history?.qtd_contada) ?? 0,
      number(history?.qtd_segunda ?? history?.qtd_recontagem), number(history?.qtd_terceira));
  }

  global.InventoryAddressState = Object.freeze({ consolidate, evaluateTotals, fromHistory, snapshotExpected, number, text });
})(window);
