// Motor operacional do PCP. Não recebe, calcula ou devolve valores monetários.
(function (global) {
  'use strict';
  const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const first = (obj, names, fallback = null) => { for (const name of names) if (obj?.[name] !== undefined && obj[name] !== null && obj[name] !== '') return num(obj[name]); return fallback; };
  const weighted = (values, weights) => { let sum = 0, used = 0; values.forEach((v, i) => { if (v !== null) { sum += v * weights[i]; used += weights[i]; } }); return used ? sum / used : null; };
  const stddev = values => { const xs = values.filter(v => v !== null); if (xs.length < 2) return 0; const avg = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + ((x - avg) ** 2), 0) / (xs.length - 1)); };
  const roundMultiple = (value, multiple) => Math.ceil(Math.max(0, value) / Math.max(1, multiple)) * Math.max(1, multiple);
  const zByService = service => service >= 99 ? 2.33 : service >= 98 ? 2.05 : service >= 97 ? 1.88 : service >= 95 ? 1.65 : service >= 90 ? 1.28 : 1.04;

  function calculate({ product = {}, forecast = {}, operational = {}, parameters = {} } = {}) {
    // M1 is always the newest month, M2 the previous one and M3 the oldest.
    // Use the exact number of days from the YYYY-MM labels saved by sync.
    const monthLabels = Array.isArray(forecast.historicoVendasMeses) ? forecast.historicoVendasMeses : [];
    const labelDays = monthLabels.map(label => {
      const match = /^(\d{4})-(\d{2})$/.exec(String(label || ''));
      return match ? new Date(Number(match[1]), Number(match[2]), 0).getDate() : null;
    });
    const days = parameters.monthDays || [labelDays[0] || 31, labelDays[1] || 30, labelDays[2] || 31];
    const historyTotals = [first(forecast, ['venda_m1', 'historico_m1', 'vendasMes1']), first(forecast, ['venda_m2', 'historico_m2', 'vendasMes2']), first(forecast, ['venda_m3', 'historico_m3', 'vendasMes3'])];
    const historyDaily = historyTotals.map((v, i) => v === null ? null : v / Math.max(1, days[i] || 30));
    const futureLabels = Array.isArray(forecast.previsaoMesesSelecionados) ? forecast.previsaoMesesSelecionados : [];
    const futureDays = futureLabels.map(label => {
      const match = /^(\d{4})-(\d{2})$/.exec(String(label || ''));
      return match ? new Date(Number(match[1]), Number(match[2]), 0).getDate() : null;
    });
    const futureTotals = [first(forecast, ['previsao_m1', 'projecao_m1', 'prev_m1']), first(forecast, ['previsao_m2', 'projecao_m2', 'prev_m2']), first(forecast, ['previsao_m3', 'projecao_m3', 'prev_m3'])];
    const futureDaily = futureTotals.map((v, i) => v === null ? null : v / Math.max(1, futureDays[i] || days[i] || 30));
    const history = weighted(historyDaily, parameters.historyWeights || [.5, .3, .2]);
    let future = weighted(futureDaily, parameters.forecastWeights || [.5, .3, .2]);
    if (future === null) { const weekly = first(forecast, ['projFinal', 'projSemanal']); if (weekly !== null) future = weekly / 7; }
    // PEDIDO AO VIVO (2026-09-07): "vai somar esses dois resultados e vai
    // dividir por dois" — média simples histórico/previsão (era 40%/60%);
    // continua configurável via parameters pra quem realmente precisar de
    // outro peso.
    const historicalWeight = num(parameters.historicalWeight, .5), forecastWeight = num(parameters.forecastWeight, .5);
    let dailyDemand = history !== null && future !== null ? history * historicalWeight + future * forecastWeight : (future ?? history ?? 0);
    dailyDemand = Math.max(0, dailyDemand);
    const leadTime = Math.max(0, first(product, ['leadTimeDias', 'lead_time_dias'], num(parameters.defaultLeadTimeDays, 7)));
    const serviceLevel = Math.min(99.9, Math.max(50, first(product, ['nivelServico', 'nivel_servico'], num(parameters.serviceLevel, 95))));
    const variability = stddev(historyDaily);
    const calculatedSafety = zByService(serviceLevel) * variability * Math.sqrt(Math.max(1, leadTime));
    const safetyStock = Math.max(first(product, ['estoqueSeguranca', 'estoque_seguranca'], 0), calculatedSafety);
    const targetDays = Math.max(0, first(product, ['metaCoberturaDias', 'coberturaMetaDias'], num(parameters.targetCoverageDays, 30)));
    const reorderPoint = dailyDemand * leadTime + safetyStock;
    const targetStock = Math.max(first(product, ['estoqueMinimo'], 0), dailyDemand * targetDays + safetyStock);
    const projectedPosition = num(operational.availableStock) + num(operational.inbound) + num(operational.production) - num(operational.committedDemand);
    const rawNeed = Math.max(0, targetStock - projectedPosition);
    let suggestedQuantity = roundMultiple(rawNeed, first(product, ['multiploCompra', 'multiplo_compra'], 1));
    const minimum = first(product, ['loteMinimo', 'compraMinima'], 0); if (suggestedQuantity > 0) suggestedQuantity = Math.max(suggestedQuantity, minimum);
    const maximum = first(product, ['estoqueMaximo'], null); if (maximum !== null) suggestedQuantity = Math.min(suggestedQuantity, Math.max(0, maximum - projectedPosition));
    const coverageDays = dailyDemand > 0 ? Math.max(0, num(operational.availableStock)) / dailyDemand : null;
    const projectedCoverageDays = dailyDemand > 0 ? Math.max(0, projectedPosition) / dailyDemand : null;
    const alerts = [];
    if (dailyDemand <= 0) alerts.push({ severity: 'warning', code: 'SEM_DEMANDA', message: 'Sem histórico ou previsão suficiente.' });
    if (projectedPosition < 0) alerts.push({ severity: 'critical', code: 'RUPTURA_PROJETADA', message: 'Saldo projetado negativo.' });
    else if (projectedPosition <= reorderPoint) alerts.push({ severity: 'high', code: 'PONTO_PEDIDO', message: 'Produto atingiu o ponto de pedido.' });
    if (coverageDays !== null && coverageDays < leadTime) alerts.push({ severity: 'critical', code: 'COBERTURA_MENOR_LEADTIME', message: 'Cobertura menor que o prazo de reposição.' });
    return { dailyDemand, weeklyDemand: dailyDemand * 7, historicalDailyDemand: history, forecastDailyDemand: future, safetyStock, reorderPoint, targetStock, targetDays, leadTime, serviceLevel, projectedPosition, coverageDays, projectedCoverageDays, rawNeed, suggestedQuantity, alerts, memory: { historyTotals, historyDaily, futureTotals, futureDaily, historicalWeight, forecastWeight, variability } };
  }
  global.PCPDemandEngine = { calculate, weighted, stddev, roundMultiple };
})(window);
