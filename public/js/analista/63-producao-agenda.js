// Produção — motor de agenda V341. Distribui OPs por capacidade/turnos,
// fila (sortOrder), hora de início, setup específico/padrão e realizado.
// Mantém a regra operacional do sistema original que absorve o setup quando
// existe um intervalo de dia inteiro entre duas OPs. Overflow continua
// desligado, como nas chamadas efetivamente usadas pelo original.
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
    if (!turnos) {
      let j = global.PRODUCAO_JORNADA;
      if (!Array.isArray(j) || j.length !== 7) { try { j = JSON.parse(localStorage.getItem('dt_producao_jornada_v341') || 'null'); } catch (e) { j = null; } }
      if (Array.isArray(j) && j.length === 7) return Math.max(0, Number(j[dayIdx]) || 0) * 60;
      return (dayIdx >= 1 && dayIdx <= 5) ? HORAS_PADRAO_SEM_TURNO * 60 : 0;
    }
    const faixas = turnos[String(dayIdx)];
    if (!Array.isArray(faixas) || !faixas.length) return 0;
    return faixas.reduce((soma, f) => soma + _parseFaixaMin(f), 0);
  }


  function _offsetHoraInicio(maquina, dayIdx, horaInicio) {
    if (!horaInicio) return 0;
    const [hh, mm] = String(horaInicio).split(':').map(Number);
    const alvo = (hh || 0) * 60 + (mm || 0);
    const faixas = maquina?.turnos?.[String(dayIdx)];
    if (!Array.isArray(faixas) || !faixas.length) return 0;
    const blocos = faixas.map(f => {
      const [hi, mi] = String(f.ini || '0:0').split(':').map(Number);
      const [hf, mf] = String(f.fim || '0:0').split(':').map(Number);
      let ini=(hi||0)*60+(mi||0), fim=(hf||0)*60+(mf||0); if(fim<=ini)fim+=1440;
      return {ini,fim};
    }).sort((a,b)=>a.ini-b.ini);
    let acc=0;
    for(const b of blocos){
      if(alvo <= b.ini) return acc;
      if(alvo < b.fim) return acc + Math.max(0, alvo-b.ini);
      acc += b.fim-b.ini;
    }
    return acc;
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
    const achado = (setups || []).find(s => s.maquina === nomeMaquina && (s.produtoOrigem ?? s.produto_origem) === produtoOrigem && (s.produtoDestino ?? s.produto_destino) === produtoDestino);
    if (achado) return Math.max(0, Number(achado.minutos ?? achado.tempo_setup) || 0);
    return Math.max(0, Number(maquina && (maquina.setupPadraoMin ?? maquina.tempoSetupPadrao)) || 0);
  }

  // weekStart: Date à meia-noite local do DOMINGO que inicia a semana exibida
  // (colunas do Gantt vão de Dom a Sáb, índice = chave de turno).
  // setups: array opcional de {maquina, produtoOrigem, produtoDestino, minutos}.
  function buildProducaoSchedule(weekStart, registros, maquinasPorNome, setups) {
    const weekEndIdx = 6;
    // Compatibilidade com a base original da Produção: registros antigos usam
    // dtDesejada/dtSolicitacao e status com rótulos; a integração usa data e
    // status normalizado. O motor aceita ambos para que Gantt/agenda não
    // 'percam' OPs migradas.
    const dataDoRegistro = r => r.data || r.dtDesejada || r.dtSolicitacao || '';
    const statusConcluido = r => {
      const st = String(r.status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return st === 'concluido' || st === 'finalizado';
    };
    const jsDayForIdx = idx => { const d = new Date(weekStart); d.setDate(d.getDate() + idx); return d.getDay(); };
    const ativos = (registros || []).filter(r => {
      if (statusConcluido(r)) return false;
      const data = _parseDataLocal(dataDoRegistro(r));
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

        const dataRec = _parseDataLocal(dataDoRegistro(rec));
        const desiredDayIdx = dataRec ? Math.min(weekEndIdx, Math.max(0, _diffDias(weekStart, dataRec))) : 0;
        const dayAntesDoAvanco = cursorDay;
        if (desiredDayIdx > cursorDay) { cursorDay = desiredDayIdx; cursorUsedMin = 0; }
        if (rec.horaInicio && cursorDay === desiredDayIdx && cursorUsedMin === 0) {
          cursorUsedMin = Math.min(getTurnoMinutosDoDia(maquina, jsDayForIdx(cursorDay)), _offsetHoraInicio(maquina, jsDayForIdx(cursorDay), rec.horaInicio));
        }

        const cxPerMin = pcMin / unidPorCx;
        let remainSetupMin = getSetupMin(maquina, produtoAnterior, rec.produto, setups);
        // Se a próxima OP foi empurrada para um dia posterior, a troca pode
        // ocorrer no intervalo ocioso, portanto não consome a jornada útil.
        if (produtoAnterior && desiredDayIdx > dayAntesDoAvanco) remainSetupMin = 0;
        const totalCaixas = Math.max(0, Number(rec.qntCaixas) || 0);
        const realizadoCaixas = Math.min(totalCaixas, Math.max(0, Number(rec.realizadoCaixas) || 0));
        const faltanteCaixas = Math.max(0, totalCaixas - realizadoCaixas);
        let remainProdMin = (faltanteCaixas * unidPorCx) / pcMin;

        while ((remainSetupMin > 0.001 || remainProdMin > 0.001) && cursorDay <= weekEndIdx) {
          const capacidadeDoDiaMin = getTurnoMinutosDoDia(maquina, jsDayForIdx(cursorDay));
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
      for (let d = 0; d <= weekEndIdx; d++) capacidadeMinutosSemana += getTurnoMinutosDoDia(maquina, jsDayForIdx(d));

      porMaquina[nomeMaquina] = { porDia, totalMinutosUsados, capacidadeMinutosSemana };
    });

    return { porMaquina };
  }

  global.buildProducaoSchedule = buildProducaoSchedule;
  global.getTurnoMinutosDoDia = getTurnoMinutosDoDia;
  global.getSetupMin = getSetupMin;
})(window);
