// Setor Produção — motor de agenda (fase 3c; setup entra na fase 3e). Versão
// simplificada de buildSchedule() do app.js original: distribui as OPs de
// producao_registros pelos dias da semana respeitando a capacidade de turno
// de cada máquina, em fila FIFO por sortOrder, e agora também consome o
// tempo de troca (setup) quando o produto muda de uma OP pra outra na mesma
// máquina.
//
// Simplificações deliberadas (documentadas no plano, evitar cópia cega de
// uma feature com partes não usadas na original):
// - Setup sempre consome capacidade do dia — sem a regra secundária da
//   original de "absorver de graça" o setup quando o gap cai virando o dia
//   (ganho marginal, complexidade alta).
// - Sem uso de horaInicio pra posicionar dentro do bloco de turno.
// - Sem overflow entre semanas (cada semana é calculada de forma
//   independente, igual à original — includeOverflow nunca era ligado lá).
// - Sem descontar "quantidade já produzida" (isso só existirá com a fase de
//   Apontamento) — cada OP é tratada como precisando de 100% da quantidade.
//
// Sem UI — função pura, reusada por Máquinas (ocupação), Gantt (grade),
// Insumos, Relatórios e Programação Automática.
(function (global) {
  'use strict';

  const HORAS_PADRAO_SEM_TURNO = 9; // Seg-Sex, quando a máquina não tem `turnos` configurado ainda

  function _parseFaixaMin(faixa) {
    const [hi, mi] = String(faixa.ini || '0:0').split(':').map(Number);
    const [hf, mf] = String(faixa.fim || '0:0').split(':').map(Number);
    let ini = (hi || 0) * 60 + (mi || 0);
    let fim = (hf || 0) * 60 + (mf || 0);
    if (fim <= ini) fim += 24 * 60; // faixa cruzando meia-noite
    return fim - ini;
  }

  // dayIdx: 0=Dom ... 6=Sáb (getDay() padrão do JS), igual à chave usada em maquina.turnos.
  function getTurnoMinutosDoDia(maquina, dayIdx) {
    const turnos = maquina && maquina.turnos;
    if (!turnos) return (dayIdx >= 1 && dayIdx <= 5) ? HORAS_PADRAO_SEM_TURNO * 60 : 0;
    const faixas = turnos[String(dayIdx)];
    if (!Array.isArray(faixas) || !faixas.length) return 0;
    return faixas.reduce((soma, f) => soma + _parseFaixaMin(f), 0);
  }

  function _parseDataLocal(str) {
    const [y, m, d] = String(str || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function _diffDias(weekStart, data) {
    const ms = data.getTime() - weekStart.getTime();
    return Math.round(ms / 86400000);
  }

  // Tempo de setup entre dois produtos numa máquina: procura entrada
  // específica em `setups` (lista de producao_setup); se não achar, cai no
  // `setupPadraoMin` cadastrado na própria máquina; se nada existir, 0min
  // (mesmo comportamento de antes de a fase 3e existir).
  function getSetupMin(maquina, produtoOrigem, produtoDestino, setups) {
    if (!produtoOrigem || produtoOrigem === produtoDestino) return 0;
    const nomeMaquina = maquina && maquina.nome;
    const achado = (setups || []).find(s => s.maquina === nomeMaquina && s.produtoOrigem === produtoOrigem && s.produtoDestino === produtoDestino);
    if (achado) return Math.max(0, Number(achado.minutos) || 0);
    return Math.max(0, Number(maquina && maquina.setupPadraoMin) || 0);
  }

  // weekStart: Date à meia-noite local do DOMINGO que inicia a semana exibida
  // (colunas do Gantt vão de Dom a Sáb, índice = chave de turno).
  // setups: array opcional de {maquina, produtoOrigem, produtoDestino, minutos}.
  function buildProducaoSchedule(weekStart, registros, maquinasPorNome, setups) {
    const weekEndIdx = 6;
    const ativos = (registros || []).filter(r => {
      if (r.status === 'concluido') return false;
      const data = _parseDataLocal(r.data);
      if (!data) return false;
      const idx = _diffDias(weekStart, data);
      return idx >= 0 && idx <= weekEndIdx;
    });

    const porMaquinaFila = {};
    ativos.forEach(r => {
      const nome = r.maquina || '';
      (porMaquinaFila[nome] = porMaquinaFila[nome] || []).push(r);
    });
    Object.values(porMaquinaFila).forEach(fila => fila.sort((a, b) => {
      const sa = a.sortOrder != null ? a.sortOrder : (a.criadoEm || '');
      const sb = b.sortOrder != null ? b.sortOrder : (b.criadoEm || '');
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    }));

    const porMaquina = {};
    Object.keys(porMaquinaFila).forEach(nomeMaquina => {
      const maquina = (maquinasPorNome || {})[nomeMaquina] || null;
      const porDia = [[], [], [], [], [], [], []];
      let cursorDay = 0, cursorUsedMin = 0, totalMinutosUsados = 0, produtoAnterior = null;

      porMaquinaFila[nomeMaquina].forEach(rec => {
        const pcMin = Number(rec.pcMin) || 0;
        const unidPorCx = Number(rec.unidPorCx) || 1;
        if (pcMin <= 0) { produtoAnterior = rec.produto; return; } // sem velocidade definida — não é possível agendar

        const dataRec = _parseDataLocal(rec.data);
        const desiredDayIdx = dataRec ? Math.min(weekEndIdx, Math.max(0, _diffDias(weekStart, dataRec))) : 0;
        if (desiredDayIdx > cursorDay) { cursorDay = desiredDayIdx; cursorUsedMin = 0; }

        const cxPerMin = pcMin / unidPorCx;
        let remainSetupMin = getSetupMin(maquina, produtoAnterior, rec.produto, setups);
        let remainProdMin = (Number(rec.qntUnid) || (Number(rec.qntCaixas) || 0) * unidPorCx) / pcMin;

        while ((remainSetupMin > 0.001 || remainProdMin > 0.001) && cursorDay <= weekEndIdx) {
          const capacidadeDoDiaMin = getTurnoMinutosDoDia(maquina, cursorDay);
          const disponivelMin = capacidadeDoDiaMin - cursorUsedMin;
          if (disponivelMin <= 0.001) { cursorDay++; cursorUsedMin = 0; continue; }

          if (remainSetupMin > 0.001) {
            const useSetup = Math.min(remainSetupMin, disponivelMin);
            porDia[cursorDay].push({ tipo: 'setup', registroId: rec._firestoreId, produto: 'Setup: ' + (produtoAnterior || '—') + ' → ' + rec.produto, caixasNoDia: 0, minutosNoDia: useSetup, inicioMin: cursorUsedMin, capacidadeDoDiaMin });
            cursorUsedMin += useSetup; totalMinutosUsados += useSetup; remainSetupMin -= useSetup;
            continue;
          }

          const useMin = Math.min(remainProdMin, disponivelMin);
          const caixasNoDia = Math.round(cxPerMin * useMin);
          if (caixasNoDia > 0) {
            porDia[cursorDay].push({ tipo: 'producao', registroId: rec._firestoreId, produto: rec.produto, caixasNoDia, minutosNoDia: useMin, inicioMin: cursorUsedMin, capacidadeDoDiaMin });
          }
          cursorUsedMin += useMin;
          totalMinutosUsados += useMin;
          remainProdMin -= useMin;
        }
        produtoAnterior = rec.produto;
      });

      let capacidadeMinutosSemana = 0;
      for (let d = 0; d <= weekEndIdx; d++) capacidadeMinutosSemana += getTurnoMinutosDoDia(maquina, d);

      porMaquina[nomeMaquina] = { porDia, totalMinutosUsados, capacidadeMinutosSemana };
    });

    return { porMaquina };
  }

  global.buildProducaoSchedule = buildProducaoSchedule;
  global.getTurnoMinutosDoDia = getTurnoMinutosDoDia;
  global.getSetupMin = getSetupMin;
})(window);
