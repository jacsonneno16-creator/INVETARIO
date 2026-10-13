// Recebimento — Tempos / Performance da frota/transbordos.
// Calcula os indicadores SEM confiar nos campos de tempo persistidos: sempre
// deriva das marcas de tempo brutas (saída, chegada, início/fim da descarga e
// fechamento). Isso evita cards errados quando um registro antigo ficou com
// tempo calculado desatualizado.
(function (global) {
  'use strict';

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const round1 = v => Math.round((Number(v) || 0) * 10) / 10;
  const media = arr => arr && arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const soma = arr => (arr || []).reduce((s, v) => s + (Number(v) || 0), 0);
  const pad2 = n => String(n).padStart(2, '0');
  const mesAtual = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); };
  const mesLabel = mes => {
    const nomes = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const m = String(mes || '').match(/^(\d{4})-(\d{2})$/);
    return m ? nomes[Number(m[2]) - 1] + ' de ' + m[1] : String(mes || '');
  };
  // PEDIDO AO VIVO (usuário: "na parte de tempos e performance colocar
  // filtro de periodos") — antes só dava pra escolher um mês inteiro
  // (<input type="month">); agora é um intervalo livre De/até, mesmo
  // padrão já usado e validado em 95-recebimento-transbordo.js.
  const fmtDataBr = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  function periodoLabel(inicio, fim) {
    if (!inicio && !fim) return 'todo o período';
    if (inicio && fim) return inicio === fim ? fmtDataBr(inicio) : `${fmtDataBr(inicio)} até ${fmtDataBr(fim)}`;
    return inicio ? `a partir de ${fmtDataBr(inicio)}` : `até ${fmtDataBr(fim)}`;
  }
  function minEntre(a, b) {
    if (!a || !b) return null;
    const x = new Date(a).getTime(), y = new Date(b).getTime();
    if (!Number.isFinite(x) || !Number.isFinite(y) || y < x) return null;
    return Math.round((y - x) / 60000);
  }
  function fmtDuracao(min) {
    if (min == null || !Number.isFinite(Number(min))) return '—';
    const m = Math.max(0, Math.round(Number(min)));
    const h = Math.floor(m / 60), r = m % 60;
    return h ? `${pad2(h)}:${pad2(r)}` : `00:${pad2(r)}`;
  }
  function fmtHorasDec(h) { return h == null ? '—' : (Math.round(h * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function fmtPct(v) { return v == null ? '—' : round1(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
  function fmtNumero(v, casas) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 }); }
  // BUG AO VIVO REAL (2026-09-17, mesmo bug encontrado em 97-recebimento-
  // recusas.js): fatiar a string ISO direto pega a data em UTC, não a
  // local — um registro de fim de noite (Brasília) contava pro dia
  // seguinte. Agora sempre converte pra data local antes de comparar.
  function _dataLocalDe(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dataDoRegistro(r) { return _dataLocalDe(r.horaSaida || r.criadoEm || r.horaChegada || ''); }
  function mesDoRegistro(r) { return dataDoRegistro(r).slice(0, 7); }
  function placaDe(r) { return String(r.placa || '').trim().toUpperCase(); }
  function terminalDe(r) { return r.horaFechamentoRecebimento || r.horaFimDescarga || r.horaChegada || null; }
  function volumesDe(r) {
    const direto = num(r.volumes);
    if (direto > 0) return direto;
    const itens = Array.isArray(r.notasVolumesTransferencia) ? r.notasVolumesTransferencia : [];
    return itens.reduce((s, x) => s + Math.max(0, num(x && x.volumes)), 0);
  }
  function motivoDe(r) {
    return String(r.motivo || r.observacao || r.observacaoMotivo || '').trim();
  }
  function veiculoEmManutencao(v) {
    const status = String(v.status || v.situacao || '').trim().toUpperCase();
    return v.emManutencao === true || v.manutencao === true || status === 'MANUTENCAO' || status === 'MANUTENÇÃO' || status === 'EM MANUTENCAO' || status === 'EM MANUTENÇÃO';
  }

  // Retornos = fim da descarga/fechamento de uma viagem -> próxima chegada
  // da MESMA carreta. Só usa pares cronologicamente válidos e do mesmo dia,
  // porque misturar dias diferentes distorce a eficiência diária.
  function calcularIntervalos(linhas) {
    const porPlaca = new Map();
    linhas.forEach(r => {
      const p = placaDe(r); if (!p) return;
      const arr = porPlaca.get(p) || []; arr.push(r); porPlaca.set(p, arr);
    });
    const intervalos = [];
    porPlaca.forEach((arr, placa) => {
      arr.sort((a, b) => String(a.horaChegada || a.horaSaida || '').localeCompare(String(b.horaChegada || b.horaSaida || '')));
      for (let i = 0; i < arr.length - 1; i++) {
        const atual = arr[i], prox = arr[i + 1];
        const fim = atual.horaFimDescarga || atual.horaFechamentoRecebimento;
        const chegada = prox.horaChegada;
        if (!fim || !chegada || String(fim).slice(0,10) !== String(chegada).slice(0,10)) continue;
        const minutos = minEntre(fim, chegada);
        if (minutos == null) continue;
        intervalos.push({ placa, motoristaNome: prox.motoristaNome || atual.motoristaNome || '', minutos, de: fim, ate: chegada });
      }
    });
    return intervalos;
  }

  function calcularPerformance(recebimentos, veiculos, periodo, config) {
    config = config || {};
    const metaDescargaMin = Math.max(1, num(config.metaDescargaMin) || 60);
    const metaViagensCarretaDia = Math.max(1, num(config.metaViagensCarretaDia) || 5);
    const alvoCumprimentoPct = Math.max(1, num(config.alvoCumprimentoPct) || 90);

    const todosTransbordos = (recebimentos || []).filter(r => r && r.tipo === 'TRANSBORDO' && r.status !== 'CANCELADO');
    // Intervalo livre (De/até), 'AAAA-MM-DD' — vazio de qualquer um dos dois
    // lados = sem limite naquela ponta. Ponta vazia dos dois lados = todo o
    // histórico.
    const periodoInicio = (periodo && periodo.inicio) || '';
    const periodoFim = (periodo && periodo.fim) || '';
    const linhas = todosTransbordos.filter(r => {
      const d = dataDoRegistro(r);
      return d && (!periodoInicio || d >= periodoInicio) && (!periodoFim || d <= periodoFim);
    });
    // Viagem conta a partir da saída; PREVISTO ainda não rodou.
    const viagens = linhas.filter(r => !!r.horaSaida);
    const descargas = viagens.map(r => ({ r, min: minEntre(r.horaInicioDescarga, r.horaFimDescarga) })).filter(x => x.min != null);
    const temposDescarga = descargas.map(x => x.min);
    const tempoMedioDescarga = media(temposDescarga);
    const viagensDentroMeta = descargas.filter(x => x.min <= metaDescargaMin).length;
    const pctDentroMeta = descargas.length ? viagensDentroMeta / descargas.length * 100 : null;
    const volumesMes = soma(viagens.map(volumesDe));

    const diasOperacao = [...new Set(viagens.map(dataDoRegistro).filter(Boolean))].sort();
    const placasMes = [...new Set(viagens.map(placaDe).filter(Boolean))];
    const placaDia = new Map();
    viagens.forEach(r => {
      const d = dataDoRegistro(r), p = placaDe(r); if (!d || !p) return;
      const s = placaDia.get(d) || new Set(); s.add(p); placaDia.set(d, s);
    });
    const mediaCarretasDia = diasOperacao.length ? media(diasOperacao.map(d => (placaDia.get(d) || new Set()).size)) : 0;

    const frotaAtiva = (veiculos || []).filter(v => v && v.ativo !== false && !veiculoEmManutencao(v));
    const frotaManutencao = (veiculos || []).filter(v => v && v.ativo !== false && veiculoEmManutencao(v));
    // Se o cadastro ainda estiver vazio, não inventa uma frota: usa apenas
    // as placas que realmente apareceram no período como base operacional.
    const placasFrota = new Set(frotaAtiva.map(v => String(v.placa || '').trim().toUpperCase()).filter(Boolean));
    if (!placasFrota.size) placasMes.forEach(p => placasFrota.add(p));
    const totalFrotaOperacional = placasFrota.size;
    const agoraAtivas = todosTransbordos.filter(r => !['FINALIZADO','CANCELADO'].includes(r.status) && placaDe(r));
    const placasEmOperacao = new Set(agoraAtivas.map(placaDe));
    const disponiveisAgora = Math.max(0, totalFrotaOperacional - [...placasEmOperacao].filter(p => placasFrota.has(p)).length);
    const disponibilidadePct = totalFrotaOperacional ? disponiveisAgora / totalFrotaOperacional * 100 : null;
    const utilizacaoPct = totalFrotaOperacional ? placasMes.filter(p => placasFrota.has(p)).length / totalFrotaOperacional * 100 : null;

    const intervalos = calcularIntervalos(viagens);
    const mediaEntreViagens = media(intervalos.map(x => x.minutos));

    // Jornada por carreta/dia = primeira saída -> último encerramento do dia.
    const jornadas = new Map();
    viagens.forEach(r => {
      const placa = placaDe(r), dia = dataDoRegistro(r); if (!placa || !dia || !r.horaSaida) return;
      const chave = placa + '|' + dia;
      const acc = jornadas.get(chave) || { placa, dia, inicio: r.horaSaida, fim: terminalDe(r), viagens: 0, motoristaNome: r.motoristaNome || '' };
      if (String(r.horaSaida) < String(acc.inicio)) acc.inicio = r.horaSaida;
      const term = terminalDe(r); if (term && (!acc.fim || String(term) > String(acc.fim))) acc.fim = term;
      acc.viagens++; if (!acc.motoristaNome && r.motoristaNome) acc.motoristaNome = r.motoristaNome;
      jornadas.set(chave, acc);
    });
    const jornadasValidas = [...jornadas.values()].map(j => ({ ...j, minutos: minEntre(j.inicio, j.fim) })).filter(j => j.minutos != null);
    const horasAcumuladas = soma(jornadasValidas.map(j => j.minutos)) / 60;
    const mediaHorasCarretaDia = jornadasValidas.length ? horasAcumuladas / jornadasValidas.length : null;
    const viagensNaJornada = soma(jornadasValidas.map(j => j.viagens));
    const viagensPorHora = horasAcumuladas > 0 ? viagensNaJornada / horasAcumuladas : null;

    // Meta em carreta-dia: soma, dia a dia, só das carretas que REALMENTE
    // rodaram naquele dia — não o tamanho da frota inteira × dias com
    // operação de qualquer carreta. Carreta que não roda num dia (ou no mês
    // inteiro) não conta meta nesse dia (ou não conta nada, se não aparece
    // em nenhum dia) — pedido ao vivo: "vai multiplicar se o carro
    // trabalhou, se o carro não trabalhou, não conta".
    const carretasDiaMeta = diasOperacao.reduce((soma, d) => soma + (placaDia.get(d) || new Set()).size, 0);
    const metaViagensTotal = metaViagensCarretaDia * carretasDiaMeta;
    const pctMetaViagens = metaViagensTotal ? viagens.length / metaViagensTotal * 100 : null;

    // Ponto médio CRONOLÓGICO dos dias com descarga válida — antes era fixo
    // no dia 16 do mês (fazia sentido só quando o filtro era sempre "um mês
    // inteiro"); com período livre (pode ser 1 semana, 3 meses, etc.) o
    // corte precisa acompanhar o intervalo real que tem dado.
    const diasComDescarga = [...new Set(descargas.map(x => dataDoRegistro(x.r)).filter(Boolean))].sort();
    let metade1 = [], metade2 = [];
    if (diasComDescarga.length) {
      const meioMs = new Date(diasComDescarga[0]).getTime() + (new Date(diasComDescarga[diasComDescarga.length - 1]).getTime() - new Date(diasComDescarga[0]).getTime()) / 2;
      const meioIso = new Date(meioMs).toISOString().slice(0, 10);
      metade1 = descargas.filter(x => dataDoRegistro(x.r) <= meioIso).map(x => x.min);
      metade2 = descargas.filter(x => dataDoRegistro(x.r) > meioIso).map(x => x.min);
    }
    const mediaPrimeiraMetade = media(metade1), mediaSegundaMetade = media(metade2);
    const variacaoMetades = mediaPrimeiraMetade != null && mediaSegundaMetade != null ? mediaSegundaMetade - mediaPrimeiraMetade : null;

    const motivosMap = new Map();
    linhas.forEach(r => { const m = motivoDe(r); if (m) motivosMap.set(m, (motivosMap.get(m) || 0) + 1); });
    const rankingMotivos = [...motivosMap.entries()].map(([motivo, quantidade]) => ({ motivo, quantidade })).sort((a,b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, 'pt-BR'));

    const porPlacaMap = new Map();
    viagens.forEach(r => {
      const placa = placaDe(r); if (!placa) return;
      const acc = porPlacaMap.get(placa) || { placa, motoristaNome: r.motoristaNome || '', viagens: 0, volumes: 0, descargas: [], dias: new Set(), horas: 0, intervalos: [] };
      acc.viagens++; acc.volumes += volumesDe(r); acc.dias.add(dataDoRegistro(r));
      const td = minEntre(r.horaInicioDescarga, r.horaFimDescarga); if (td != null) acc.descargas.push(td);
      if (!acc.motoristaNome && r.motoristaNome) acc.motoristaNome = r.motoristaNome;
      porPlacaMap.set(placa, acc);
    });
    jornadasValidas.forEach(j => { const acc = porPlacaMap.get(j.placa); if (acc) acc.horas += j.minutos / 60; });
    intervalos.forEach(it => { const acc = porPlacaMap.get(it.placa); if (acc) acc.intervalos.push(it.minutos); });
    const porCarreta = [...porPlacaMap.values()].map(acc => {
      // Meta individual usa os dias que ESSA carreta trabalhou (acc.dias),
      // não o calendário de dias com operação de qualquer carreta — cada
      // carreta só é cobrada pelos dias em que de fato rodou.
      const metaCarreta = metaViagensCarretaDia * acc.dias.size;
      const mediaDescarga = media(acc.descargas), mediaIntervalo = media(acc.intervalos);
      const mediaHorasDia = acc.dias.size ? acc.horas / acc.dias.size : null;
      const pctMeta = metaCarreta ? acc.viagens / metaCarreta * 100 : null;
      let analise = 'Operação dentro do padrão observado.';
      if (mediaDescarga != null && mediaDescarga > metaDescargaMin) analise = 'Tempo de descarga acima da meta: possível gargalo na doca.';
      else if (pctMeta != null && pctMeta < 70) analise = 'Baixo volume de viagens para a meta do período.';
      else if (mediaIntervalo != null && mediaIntervalo > 180) analise = 'Retorno entre viagens elevado: revisar rota, espera ou disponibilidade.';
      else if (mediaHorasDia != null && mediaHorasDia < 4 && acc.viagens < metaCarreta) analise = 'Poucas horas registradas: verificar início tardio, encerramento antecipado ou dados incompletos.';
      return {
        placa: acc.placa, motoristaNome: acc.motoristaNome, viagens: acc.viagens, volumes: acc.volumes,
        diasAtivos: acc.dias.size, mediaDescarga, mediaIntervalo, horas: acc.horas, mediaHorasDia,
        metaViagens: metaCarreta, pctMeta, analise,
      };
    }).sort((a,b) => a.mediaDescarga == null ? 1 : b.mediaDescarga == null ? -1 : b.mediaDescarga - a.mediaDescarga);

    const rankingRetorno = porCarreta.filter(x => x.mediaIntervalo != null).slice().sort((a,b) => a.mediaIntervalo - b.mediaIntervalo);
    const faixasRetorno = [
      { rotulo: 'Até 02:00', min: 0, max: 120, quantidade: intervalos.filter(x => x.minutos <= 120).length },
      { rotulo: 'De 02:01 a 03:00', min: 121, max: 180, quantidade: intervalos.filter(x => x.minutos > 120 && x.minutos <= 180).length },
      { rotulo: 'Acima de 03:00', min: 181, max: Infinity, quantidade: intervalos.filter(x => x.minutos > 180).length },
    ];

    const acimaMetaDescarga = descargas.filter(x => x.min > metaDescargaMin).length;
    const rodaramHoje = new Set(todosTransbordos.filter(r => dataDoRegistro(r) === _dataLocalDe(new Date()) && r.horaSaida).map(placaDe).filter(Boolean));
    const alertas = [];
    if (acimaMetaDescarga) alertas.push({ tipo:'danger', texto:`${acimaMetaDescarga} viagem(ns) acima de ${fmtDuracao(metaDescargaMin)} no mês.` });
    if (pctDentroMeta != null && pctDentroMeta < alvoCumprimentoPct) alertas.push({ tipo:'warn', texto:`Cumprimento da meta em ${fmtPct(pctDentroMeta)}, abaixo de ${fmtPct(alvoCumprimentoPct)}.` });
    if (totalFrotaOperacional && rodaramHoje.size >= totalFrotaOperacional) alertas.push({ tipo:'info', texto:`Todas as ${totalFrotaOperacional} carretas operacionais rodaram hoje.` });
    if (frotaManutencao.length) alertas.push({ tipo:'warn', texto:`${frotaManutencao.length} carreta(s) marcada(s) em manutenção.` });
    if (!alertas.length) alertas.push({ tipo:'ok', texto:'Nenhum alerta operacional crítico no período selecionado.' });

    return {
      periodoInicio, periodoFim, metaDescargaMin, metaViagensCarretaDia, alvoCumprimentoPct,
      totalViagens: viagens.length, volumesMes, tempoMedioDescarga, viagensDentroMeta, totalDescargasValidas: descargas.length, pctDentroMeta,
      diasOperacao, placasMes, mediaCarretasDia, totalFrotaOperacional, frotaManutencao: frotaManutencao.length,
      disponiveisAgora, placasEmOperacao: placasEmOperacao.size, disponibilidadePct, utilizacaoPct,
      intervalos, mediaEntreViagens, jornadasValidas, horasAcumuladas, mediaHorasCarretaDia, viagensNaJornada, viagensPorHora,
      carretasDiaMeta, metaViagensTotal, pctMetaViagens, mediaPrimeiraMetade, mediaSegundaMetade, variacaoMetades,
      rankingMotivos, porCarreta, rankingRetorno, faixasRetorno, alertas,
    };
  }

  let _filtroInicio = '';
  let _filtroFim = '';
  let _config = { metaDescargaMin: 60, metaViagensCarretaDia: 5, alvoCumprimentoPct: 90 };
  let _ouvinte = false;

  function _mesMaisRecente(recs) {
    const meses = (recs || []).filter(r => r && r.tipo === 'TRANSBORDO' && r.status !== 'CANCELADO').map(mesDoRegistro).filter(Boolean).sort();
    return meses.length ? meses[meses.length - 1] : mesAtual();
  }
  // Início/fim do calendário do mês recebido em 'AAAA-MM'.
  function _limitesDoMes(mes) {
    const m = String(mes || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return { inicio: '', fim: '' };
    const ano = Number(m[1]), mesIdx = Number(m[2]) - 1;
    const primeiro = new Date(ano, mesIdx, 1), ultimo = new Date(ano, mesIdx + 1, 0);
    return { inicio: primeiro.toLocaleDateString('en-CA'), fim: ultimo.toLocaleDateString('en-CA') };
  }
  async function _carregarConfig() {
    try {
      const snap = await global.getDTFirestore().collection('recebimento_config_geral').doc('padrao').get();
      const c = snap.exists ? (snap.data() || {}) : {};
      _config = {
        metaDescargaMin: Math.max(1, num(c.metaDescargaMin || c.metaTempoDescargaMin) || 60),
        metaViagensCarretaDia: Math.max(1, num(c.metaViagensCarretaDia) || 5),
        alvoCumprimentoPct: Math.max(1, num(c.alvoCumprimentoPct) || 90),
      };
    } catch (e) { /* mantém os padrões seguros */ }
  }
  async function renderRecebimentoTempos() {
    const pagina = document.getElementById('page-recebimento-tempos');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Calculando indicadores...</div></div>';
    try {
      await Promise.all([global._recebimentoOperacaoInternals?.carregar?.(), _carregarConfig()]);
      const recs = global._recebimentoOperacaoInternals?.recebimentos?.() || [];
      if (!_filtroInicio && !_filtroFim) { const lim = _limitesDoMes(_mesMaisRecente(recs)); _filtroInicio = lim.inicio; _filtroFim = lim.fim; }
      if (!_ouvinte) {
        global._recebimentoOperacaoInternals?.onMudanca?.(() => {
          if (document.getElementById('page-recebimento-tempos')?.classList.contains('active')) _desenhar();
        });
        _ouvinte = true;
      }
      _desenhar();
    } catch (e) {
      pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>';
    }
  }

  function _card(icone, valor, titulo, subtitulo, classe) {
    return `<div class="rebperf-card ${classe || ''}"><div class="rebperf-icon">${icone}</div><div class="rebperf-value">${valor}</div><div class="rebperf-label">${esc(titulo)}</div>${subtitulo ? `<div class="rebperf-sub">${subtitulo}</div>` : ''}</div>`;
  }
  function _bar(pct) { const p = Math.max(0, Math.min(100, Number(pct) || 0)); return `<div class="rebperf-bar"><span style="width:${p}%"></span></div>`; }
  function _ensureStyle() {
    if (document.getElementById('rebperf-style')) return;
    const st = document.createElement('style'); st.id = 'rebperf-style'; st.textContent = `
      .rebperf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:12px}
      .rebperf-card{background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:11px;padding:11px 13px;min-height:112px;box-sizing:border-box}
      .rebperf-icon{font-size:1rem;margin-bottom:4px}.rebperf-value{font-size:1.55rem;font-weight:900;line-height:1.05;color:var(--text,#111827)}
      .rebperf-label{font-size:.68rem;font-weight:900;text-transform:uppercase;letter-spacing:.035em;margin-top:7px}.rebperf-sub{font-size:.68rem;color:var(--muted,#6b7280);margin-top:5px;line-height:1.3}
      .rebperf-bar{height:5px;background:rgba(127,127,127,.16);border-radius:99px;margin-top:8px;overflow:hidden}.rebperf-bar span{display:block;height:100%;background:linear-gradient(90deg,#f97316,#dc2626);border-radius:99px}
      .rebperf-two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.rebperf-panel{padding:13px}
      .rebperf-row{display:grid;grid-template-columns:minmax(115px,1fr) minmax(90px,.55fr) minmax(80px,.45fr);gap:8px;align-items:center;padding:9px 10px;border:1px solid var(--border,#e5e7eb);border-radius:8px;margin-top:7px;font-size:.74rem}
      .rebperf-alert{padding:10px 12px;border-radius:8px;margin-top:8px;font-size:.76rem;border:1px solid rgba(127,127,127,.18)}
      .rebperf-alert.danger{background:rgba(239,68,68,.10)} .rebperf-alert.warn{background:rgba(245,158,11,.11)} .rebperf-alert.info{background:rgba(59,130,246,.09)} .rebperf-alert.ok{background:rgba(34,197,94,.09)}
      @media(max-width:900px){.rebperf-two{grid-template-columns:1fr}.rebperf-grid{grid-template-columns:repeat(auto-fit,minmax(165px,1fr))}.rebperf-card{min-height:104px;padding:10px}.rebperf-value{font-size:1.35rem}}
    `; document.head.appendChild(st);
  }
  function _desenhar() {
    const pagina = document.getElementById('page-recebimento-tempos'); if (!pagina) return;
    _ensureStyle();
    const i = global._recebimentoOperacaoInternals;
    const k = calcularPerformance(i?.recebimentos?.() || [], i?.veiculos?.() || [], { inicio: _filtroInicio, fim: _filtroFim }, _config);
    const metaTxt = `${k.totalViagens} / ${k.metaViagensTotal || 0}`;
    const manutSub = k.frotaManutencao ? ` · ${k.frotaManutencao} em manutenção` : '';
    const variacao = k.variacaoMetades == null ? '—' : ((k.variacaoMetades > 0 ? '+' : '') + Math.round(k.variacaoMetades) + ' min');
    const maxFaixa = Math.max(1, ...k.faixasRetorno.map(f => f.quantidade));
    const rotuloPeriodo = periodoLabel(k.periodoInicio, k.periodoFim);

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <div><div class="page-title" style="font-size:1.15rem">⏱️ Tempos / Performance</div><div style="font-size:.74rem;color:var(--muted)">Indicadores calculados pelos horários reais dos transbordos — ${esc(rotuloPeriodo)}</div></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:.72rem;color:var(--muted)">De</span>
          <input type="date" class="field" id="rebperf-f-data-inicio" value="${esc(_filtroInicio)}" style="max-width:150px" title="Data de início — deixe em branco pra não limitar">
          <span style="font-size:.72rem;color:var(--muted)">até</span>
          <input type="date" class="field" id="rebperf-f-data-fim" value="${esc(_filtroFim)}" style="max-width:150px" title="Data de fim — deixe em branco pra não limitar">
          <button type="button" class="btn btn-ghost btn-sm" data-rebperf-f-mes="1" title="Mês atual">Este mês</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rebperf-f-semana="1" title="Últimos 7 dias">7 dias</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rebperf-f-limpar="1" title="Ver todo o período, sem limite de data">Limpar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rebperf-atualizar>↻ Atualizar</button>
        </div>
      </div>
      <div class="rebperf-grid">
        ${_card('🚚', fmtNumero(k.totalViagens), 'Total de viagens no período', esc(rotuloPeriodo))}
        ${_card('📦', fmtNumero(k.volumesMes), 'Volumes no período', esc(rotuloPeriodo))}
        ${_card('⏱️', fmtDuracao(k.tempoMedioDescarga), 'Tempo médio de descarga', k.tempoMedioDescarga != null && k.tempoMedioDescarga > k.metaDescargaMin ? '<span style="color:#dc2626;font-weight:800">⚠ Acima da meta</span>' : 'Dentro/sem dado para a meta')}
        ${_card('🎯', fmtDuracao(k.metaDescargaMin), 'Meta de descarga', 'Tempo máximo permitido')}
        ${_card('🚛', fmtHorasDec(k.mediaCarretasDia) + ' / ' + fmtNumero(k.totalFrotaOperacional), 'Média de carretas por dia', `${k.diasOperacao.length} dia(s) com operação`)}
        ${_card('📊', fmtHorasDec(k.mediaCarretasDia), 'Média de carretas no período', `${esc(rotuloPeriodo)} · ${k.diasOperacao.length} dia(s) com operação`)}
        ${_card('🛠️', fmtPct(k.disponibilidadePct), 'Disponibilidade da frota', `${k.disponiveisAgora} disponível(is) · ${k.placasEmOperacao} em operação${manutSub}`)}
        ${_card('✅', fmtPct(k.pctDentroMeta), 'Viagens dentro da meta', `${k.viagensDentroMeta} de ${k.totalDescargasValidas} descarga(s) válida(s)` + _bar(k.pctDentroMeta))}
        ${_card('📈', fmtPct(k.utilizacaoPct), 'Percentual de utilização', `${k.placasMes.length} de ${k.totalFrotaOperacional} carreta(s) operacional(is)` + _bar(k.utilizacaoPct))}
        ${_card('🔄', fmtDuracao(k.mediaEntreViagens), 'Média entre viagens', `Baseado em ${k.intervalos.length} retorno(s): fim da descarga → próxima chegada`)}
        ${_card('🏁', metaTxt, 'Meta de viagens', `${k.metaViagensCarretaDia} viagens × ${k.carretasDiaMeta} carreta-dia` + _bar(k.pctMetaViagens))}
        ${_card('🕒', fmtDuracao(k.mediaHorasCarretaDia == null ? null : k.mediaHorasCarretaDia * 60), 'Média de horas por carreta/dia', `${fmtDuracao(k.horasAcumuladas * 60)} acumuladas em ${k.jornadasValidas.length} carreta-dia`)}
        ${_card('⚙️', k.viagensPorHora == null ? '—' : k.viagensPorHora.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}), 'Viagens por hora', 'Viagens ÷ horas acumuladas de jornada')}
      </div>

      <div class="rebperf-two">
        <div class="tc rebperf-panel"><b>🚛 Tempo médio por carreta</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Eficiência individual por placa e motorista no período selecionado</div>
          ${k.porCarreta.length ? k.porCarreta.map(x => `<div class="rebperf-row"><div><b>🚛 ${esc(x.placa)}</b><div style="color:var(--muted);font-size:.68rem">👤 ${esc(x.motoristaNome || '—')} · ${x.viagens} viagem(ns) · ${fmtNumero(x.volumes)} volumes</div></div><div style="text-align:right"><b>${fmtDuracao(x.mediaDescarga)}</b><div style="font-size:.65rem;color:${x.mediaDescarga != null && x.mediaDescarga > k.metaDescargaMin ? '#dc2626':'#16a34a'}">${x.mediaDescarga == null ? 'sem descarga' : (x.mediaDescarga > k.metaDescargaMin ? 'Acima da meta':'Dentro da meta')}</div></div><div style="text-align:right"><b>${fmtPct(x.pctMeta)}</b><div style="font-size:.65rem;color:var(--muted)">da meta</div></div></div>`).join('') : '<div class="empty"><div class="empty-title">Sem viagens no período</div></div>'}
        </div>
        <div class="tc rebperf-panel"><b>🛠️ Ranking de motivos</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Observações/motivos preenchidos nas cargas</div>
          ${k.rankingMotivos.length ? k.rankingMotivos.slice(0,10).map((x,idx) => `<div class="rebperf-row" style="grid-template-columns:32px 1fr 55px"><b>${idx+1}.</b><span>${esc(x.motivo)}</span><b style="text-align:right">${x.quantidade}</b></div>`).join('') : '<div style="padding:28px 8px;text-align:center;color:var(--muted);font-size:.78rem">Ainda não há motivos/observações preenchidos no período.</div>'}
        </div>
      </div>

      <div class="rebperf-two">
        <div class="tc rebperf-panel"><b>📈 Tendência do período</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Comparação do tempo médio de descarga entre as duas metades do período selecionado</div>
          <div class="rebperf-grid" style="margin:10px 0 0"><div class="rebperf-card"><div class="rebperf-value">${fmtDuracao(k.mediaPrimeiraMetade)}</div><div class="rebperf-label">1ª metade</div></div><div class="rebperf-card"><div class="rebperf-value">${fmtDuracao(k.mediaSegundaMetade)}</div><div class="rebperf-label">2ª metade</div></div><div class="rebperf-card"><div class="rebperf-value">${esc(variacao)}</div><div class="rebperf-label">Variação</div></div></div>
        </div>
        <div class="tc rebperf-panel"><b>🚨 Alertas operacionais</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Pontos que exigem atenção com base nos dados atuais</div>${k.alertas.map(a => `<div class="rebperf-alert ${a.tipo}">${esc(a.texto)}</div>`).join('')}</div>
      </div>

      <div class="rebperf-two">
        <div class="tc rebperf-panel"><b>🏁 Ranking de retorno das carretas</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Da menor para a maior média: fim da descarga → próxima chegada, no mesmo dia</div>
          ${k.rankingRetorno.length ? k.rankingRetorno.map((x,idx) => `<div class="rebperf-row"><div><b>${idx+1}. 🚛 ${esc(x.placa)}</b><div style="font-size:.67rem;color:var(--muted)">👤 ${esc(x.motoristaNome || '—')} · ${x.diasAtivos} dia(s)</div></div><div></div><div style="text-align:right"><b>${fmtDuracao(x.mediaIntervalo)}</b><div style="font-size:.65rem;color:${x.mediaIntervalo <= 120 ? '#16a34a':x.mediaIntervalo <= 180 ? '#d97706':'#dc2626'}">${x.mediaIntervalo <= 120 ? 'Dentro da meta':x.mediaIntervalo <= 180 ? 'Atenção':'Crítico'}</div></div></div>`).join('') : '<div style="padding:24px;text-align:center;color:var(--muted)">Sem retornos consecutivos suficientes.</div>'}
        </div>
        <div class="tc rebperf-panel"><b>🟢 Faixas de tempo entre viagens</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Distribuição dos retornos válidos</div>
          ${k.faixasRetorno.map((f,idx) => `<div style="margin-top:12px"><div style="display:flex;justify-content:space-between;font-size:.74rem"><b>${idx===0?'🟢':idx===1?'🟡':'🔴'} ${esc(f.rotulo)}</b><b>${f.quantidade}</b></div><div class="rebperf-bar"><span style="width:${f.quantidade/maxFaixa*100}%"></span></div></div>`).join('')}
        </div>
      </div>

      <div class="tc rebperf-panel" style="margin-bottom:12px"><b>🔄 Tempo entre viagens das carretas</b><div style="font-size:.7rem;color:var(--muted);margin:2px 0 10px">Média geral ${fmtDuracao(k.mediaEntreViagens)} — calculada do fim de uma descarga até a próxima chegada da mesma placa, no mesmo dia.</div>
        ${k.rankingRetorno.length ? k.rankingRetorno.map(x => `<div class="rebperf-row"><div><b>🚛 ${esc(x.placa)}</b> <span style="color:var(--muted)">👤 ${esc(x.motoristaNome || '—')}</span></div><div>${x.viagens} viagem(ns)</div><div style="text-align:right"><b>${fmtDuracao(x.mediaIntervalo)}</b></div></div>`).join('') : '<div style="color:var(--muted);font-size:.75rem">Sem intervalos suficientes.</div>'}
      </div>

      <div class="tc rebperf-panel"><b>🎯 Meta, jornada e gargalos por carreta</b><div style="font-size:.7rem;color:var(--muted);margin:2px 0 10px">Meta fixa de ${k.metaViagensCarretaDia} viagens por carreta/dia. Jornada = primeira saída → último encerramento registrado no dia.</div>
        <div style="overflow:auto"><table class="dt-table"><thead><tr><th>Carreta / motorista</th><th>Viagens / meta</th><th>% meta</th><th>Horas acumuladas</th><th>Média h/dia</th><th>Descarga média</th><th>Entre viagens</th><th>Análise</th></tr></thead><tbody>
        ${k.porCarreta.length ? k.porCarreta.map(x => `<tr><td><b>${esc(x.placa)}</b><br><span style="font-size:.68rem;color:var(--muted)">${esc(x.motoristaNome || '—')} · ${x.diasAtivos} dia(s) ativo(s)</span></td><td>${x.viagens} / ${x.metaViagens}</td><td><b>${fmtPct(x.pctMeta)}</b></td><td>${fmtDuracao(x.horas*60)}</td><td>${fmtDuracao(x.mediaHorasDia == null ? null : x.mediaHorasDia*60)}</td><td>${fmtDuracao(x.mediaDescarga)}</td><td>${fmtDuracao(x.mediaIntervalo)}</td><td style="max-width:320px">${esc(x.analise)}</td></tr>`).join('') : '<tr><td colspan="8">Sem viagens no período selecionado.</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  global.renderRecebimentoTempos = renderRecebimentoTempos;
  global._recebimentoPerformanceInternals = { calcularPerformance, calcularIntervalos, minEntre, volumesDe, periodoLabel, dataDoRegistro };

  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'rebperf-f-data-inicio') { _filtroInicio = ev.target.value || ''; _desenhar(); }
    if (ev.target.id === 'rebperf-f-data-fim') { _filtroFim = ev.target.value || ''; _desenhar(); }
  });
  document.addEventListener('click', async function (ev) {
    // Atalhos de período, mesmo padrão já usado em 95-recebimento-transbordo.js.
    if (ev.target.closest('[data-rebperf-f-mes]')) {
      const lim = _limitesDoMes(mesAtual());
      _filtroInicio = lim.inicio; _filtroFim = lim.fim;
      _desenhar();
      return;
    }
    if (ev.target.closest('[data-rebperf-f-semana]')) {
      const fim = new Date();
      const inicio = new Date(fim); inicio.setDate(inicio.getDate() - 6);
      _filtroInicio = inicio.toLocaleDateString('en-CA'); _filtroFim = fim.toLocaleDateString('en-CA');
      _desenhar();
      return;
    }
    if (ev.target.closest('[data-rebperf-f-limpar]')) {
      _filtroInicio = ''; _filtroFim = '';
      _desenhar();
      return;
    }
    if (!ev.target.closest('[data-rebperf-atualizar]')) return;
    try { await global._recebimentoOperacaoInternals?.carregar?.(true); await _carregarConfig(); _desenhar(); }
    catch (e) { global.showToast?.('Erro ao atualizar performance: ' + (e.message || e), 'error'); }
  });
})(window);
