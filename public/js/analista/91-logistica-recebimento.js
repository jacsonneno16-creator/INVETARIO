// Logística — Recebimento (fase 15). Dashboard alimentado 100% pela API
// real da Bluesoft (status-processamento-nfe + recebimentocargas + entregas
// de pedido de compra, todas em 90-bluesoft-service.js) — sem upload manual.
// Único campo digitado nesta tela é "chegada na portaria": a Bluesoft não
// tem endpoint de portaria/pátio/YMS confirmado, e o YMS usado aqui não tem
// API disponível hoje — fica manual até existir uma integração real.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const charts = [];
  function _destruirGraficos() { while (charts.length) charts.pop().destroy(); }
  function fs() { return global.getDTFirestore(); }
  function fmtMin(m) { return m == null ? '—' : (m >= 60 ? (m / 60).toFixed(1) + 'h' : Math.round(m) + 'min'); }
  function fmtData(d) { return d ? String(d).slice(0, 16).replace('T', ' ') : '—'; }
  const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  // Rótulo de mês por extenso curto + ano completo (ex.: "fev/2026") — o
  // gráfico usava a string crua "AAAA-MM" como rótulo e, dependendo da
  // largura disponível, o Chart.js cortava o texto no meio do ano,
  // deixando "01/02/2" sem dar pra saber se é 2025 ou 2026 (relatado ao
  // vivo). Assim o rótulo já sai curto e sem ambiguidade nenhuma.
  function _fmtMesLabel(mesAAAAMM) {
    const m = String(mesAAAAMM || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return String(mesAAAAMM || '—');
    return (MESES_PT[Number(m[2]) - 1] || '?') + '/' + m[1];
  }
  // BUG AO VIVO REAL (2026-09-08): "esses meses abaixo das colunas deixar só
  // o mês e o ano... na sequência correta" — os gráficos agrupavam por
  // `.slice(0,7)` direto na data crua, assumindo formato ISO ('AAAA-MM-DD').
  // A Bluesoft não garante isso pra todo campo (`processamento`/
  // `dataRecebimento`/`dataGeracao` vêm de endpoints/sincronizações
  // diferentes) — um valor em 'DD/MM/AAAA' virava uma chave tipo '29/01/2'
  // (nem bate com `_fmtMesLabel`, que só reconhece 'AAAA-MM', nem ordena
  // certo num sort alfabético). Normaliza pra 'AAAA-MM' de verdade não
  // importa o formato de entrada, então agrupamento/ordenação/filtro de
  // período passam a funcionar igual pra qualquer um dos dois formatos.
  function _mesChave(valor) {
    const s = String(valor || '').trim();
    if (!s) return '';
    let m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return m[1] + '-' + m[2];
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return m[3] + '-' + m[2];
    const d = new Date(s);
    if (!isNaN(d)) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return '';
  }

  let _notas = [];
  let _cargas = [];
  let _carregado = false;
  let _filtroDashPeriodo = ''; // 'AAAA-MM' — filtra só os cards/gráficos agregados do Dashboard
  let _filtroDashCategoria = ''; // '' = FORNECEDOR (padrão) | 'FORNECEDOR' | 'TRANSBORDO' | 'DEVOLUCAO' | 'TODAS'
  let _ultimoSync = '';

  async function carregarLogisticaRecebimento(forcar) {
    if (_carregado && !forcar) return;
    const [notasSnap, cargasSnap] = await Promise.all([
      fs().collection('recebimento_notas').get(),
      fs().collection('recebimento_cargas').get(),
    ]);
    _notas = notasSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
    _cargas = cargasSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
    _carregado = true;
  }

  // BUG AO VIVO REAL (2026-09-09): "por que não tá puxando os meses mais
  // próximos, tipo julho agosto" — os gráficos "Notas recebidas por mês" e
  // "Valor recebido por mês" vinham de `recebimento_notas`, que só ganha
  // dado novo quando alguém aperta "Buscar recebimento" (API ao vivo da
  // Bluesoft) — ninguém apertou desde junho, então os meses mais recentes
  // simplesmente não existiam gravados. `relatorios_bi_compras_historico_
  // chunks` (101-relatorios-bi.js, aba "Histórico de Compras") já tem
  // exatamente esse dado — sincronizado SOZINHO a cada 4h por
  // sincronizarComprasHistoricoBiAgendado (functions/index.js), confirmado
  // rodando com sucesso hoje (ver firebase functions:log). Só os 2
  // gráficos de "por mês" passam a usar essa fonte — o resto do Dashboard
  // (KPIs de tempo/divergência, ranking de fornecedores, caption "X notas
  // neste período") continua em `_notas`/Bluesoft ao vivo de propósito:
  // tempoLancamentoMin/temDivergencia/comparavel não existem no BI de
  // compras, misturar as duas fontes ali bagunçaria os números.
  let _comprasBi = [];
  let _comprasBiCarregado = false;
  async function _carregarComprasBi(forcar) {
    if (_comprasBiCarregado && !forcar) return;
    _comprasBi = [];
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) { _comprasBiCarregado = true; return; }
    try {
      const lojaSnap = await fs().collection('lojas').doc(lojaId).get();
      const chaveBluesoft = lojaSnap.exists ? String(lojaSnap.data().bluesoft_loja_key || '').trim() : '';
      if (!chaveBluesoft) { _comprasBiCarregado = true; return; } // loja não vinculada à Bluesoft — nada pra cruzar
      const todas = typeof global.obterHistoricoComprasRealBi === 'function' ? await global.obterHistoricoComprasRealBi(forcar) : [];
      // TIPO_OPERACAO 'COMPRA' = fornecedor de verdade — TRANSFERENCIA
      // (entre lojas) e outros tipos já têm tela própria (Transbordo), mesmo
      // recorte que o resto desta tela já aplica em cima de `_notas`.
      _comprasBi = todas.filter(r => String(r.loja_key) === chaveBluesoft && String(r.tipo_operacao || '').toUpperCase() === 'COMPRA');
    } catch (e) {
      console.warn('[Recebimento] Falha ao ler histórico de compras (BI):', e && e.message ? e.message : e);
    }
    _comprasBiCarregado = true;
  }

  // Dashboard/histórico geral é a tela de FORNECEDOR — devolução NUNCA conta
  // nem aparece, ponto (não é recebimento de mercadoria — pedido explícito
  // do usuário: "tirar fora", não é pra virar opção de filtro). Transbordo
  // (transferência entre lojas) tem tela própria
  // (95-recebimento-transbordo.js, pedido ao vivo do usuário: os dados
  // puxados da Bluesoft têm que aparecer lá, não ficar misturados aqui). Por
  // padrão só FORNECEDOR aparece; o filtro de categoria só alterna entre
  // Fornecedor/Transbordo/Todas (as duas primeiras) — devolução nunca é uma
  // opção selecionável.
  function _notasFiltradas() {
    return _notas.filter(x => !global.ehNotaDevolucaoBluesoft?.(x))
      .filter(x => {
        const cat = global.categoriaNotaBluesoft?.(x) || 'FORNECEDOR';
        return _filtroDashCategoria === 'TODAS' || cat === (_filtroDashCategoria || 'FORNECEDOR');
      }).filter(x => !_filtroDashPeriodo || _mesChave(x.processamento || x.dataRecebimento) === _filtroDashPeriodo);
  }
  function _cargasFiltradas() {
    return _cargas.filter(c => !_filtroDashPeriodo || _mesChave(c.dataGeracao) === _filtroDashPeriodo);
  }
  // Não existe endpoint de portaria/pátio confirmado na Bluesoft (ver
  // cabeçalho do arquivo) — na falta desse dado, o tempo de recebimento
  // usa o que a própria Bluesoft já informa por carga. Os dois campos são
  // confirmados no schema oficial como eventos reais (não proxy): o
  // endpoint `iniciarRecebimento` documenta que grava `dataInicioRecebimento`
  // ("Inicia o processo de recebimento de uma carga"), e `finalizarRecebimento`
  // documenta que grava `dataFimRecebimento` ("Finaliza e fecha a carga").
  // Isso permite quebrar o tempo total em duas etapas — espera (carga
  // gerada mas ainda ninguém começou a conferir) e conferência (conferência
  // em si) — em vez de só um número só (pedido ao vivo do usuário).
  function _tempoEsperaMin(carga) {
    if (!carga.dataGeracao || !carga.dataInicioRecebimento) return null;
    const diff = Math.round((new Date(carga.dataInicioRecebimento) - new Date(carga.dataGeracao)) / 60000);
    return isNaN(diff) ? null : diff;
  }
  function _tempoConferenciaMin(carga) {
    if (!carga.dataInicioRecebimento || !carga.dataFimRecebimento) return null;
    const diff = Math.round((new Date(carga.dataFimRecebimento) - new Date(carga.dataInicioRecebimento)) / 60000);
    return isNaN(diff) ? null : diff;
  }
  function _tempoRecebimentoMin(carga) {
    if (!carga.dataGeracao || !carga.dataFimRecebimento) return null;
    const diff = Math.round((new Date(carga.dataFimRecebimento) - new Date(carga.dataGeracao)) / 60000);
    return isNaN(diff) ? null : diff;
  }
  function _rankingFornecedoresBluesoft(linhas) {
    const porFornecedor = new Map();
    linhas.filter(x => x.fornecedorNome).forEach(x => {
      const acc = porFornecedor.get(x.fornecedorNome) || { entregas: 0, valor: 0 };
      acc.entregas++; acc.valor += n(x.valor);
      porFornecedor.set(x.fornecedorNome, acc);
    });
    return [...porFornecedor.entries()].map(([nome, acc]) => ({ nome, entregas: acc.entregas, valor: acc.valor })).sort((a, b) => b.entregas - a.entregas);
  }

  async function renderRecebimentoDashboard() {
    const pagina = document.getElementById('page-recebimento-dashboard');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try {
      await Promise.all([carregarLogisticaRecebimento(), global._recebimentoOperacaoInternals?.carregar?.(), _carregarComprasBi()]);
    }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenhar();
  }

  // ── KPIs operacionais (fase 15/FASE 2c) — vêm de `recebimentos`
  // (93-recebimento-operacao.js), não da Bluesoft. Seção 3 do pedido: cards
  // clicáveis que abrem Recebimentos já filtrado.
  function _cardOperacional(cor, valor, label, filtro) {
    const attr = filtro ? ' data-reb-kpi-status="' + esc(filtro.status || '') + '" data-reb-kpi-hoje="' + (filtro.hoje ? '1' : '') + '"' : '';
    return '<div class="kpi ' + cor + '"' + (filtro ? ' style="cursor:pointer"' : '') + attr + '><div class="kpi-val">' + esc(valor) + '</div><div class="kpi-lbl">' + esc(label) + '</div></div>';
  }
  function _kpisOperacionaisHtml() {
    const i = global._recebimentoOperacaoInternals;
    const recs = i?.recebimentos?.() || [];
    const ehHoje = i?.ehHoje || (() => false);
    const hoje = r => ehHoje(r.horaChegada || r.criadoEm);
    const media = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    const hojeArr = recs.filter(hoje);
    const emAndamento = recs.filter(r => ['CHEGOU', 'AGUARDANDO_DOCA', 'EM_DESCARGA', 'DESCARGA_FINALIZADA', 'EM_CONFERENCIA'].includes(r.status));
    const finalizadosHoje = recs.filter(r => r.status === 'FINALIZADO' && ehHoje(r.horaFechamentoRecebimento));
    const aguardandoDescarga = recs.filter(r => ['CHEGOU', 'AGUARDANDO_DOCA'].includes(r.status));
    const emDescarga = recs.filter(r => r.status === 'EM_DESCARGA');
    const atrasadas = recs.filter(r => r.status === 'ATRASADO');
    const notasOperacionais = recs.reduce((s, r) => s + (r.notas || []).length, 0);
    const semNota = recs.filter(r => !(r.notas || []).length && r.status !== 'CANCELADO');
    const tempoMedioEspera = media(recs.map(r => r.tempoEsperaMin).filter(v => v != null));
    const tempoMedioDescarga = media(recs.map(r => r.tempoDescargaMin).filter(v => v != null));
    const tempoMedioTotal = media(recs.map(r => r.tempoTotalMin).filter(v => v != null));
    const fornecedoresHoje = new Set(hojeArr.map(r => r.fornecedorNome).filter(Boolean)).size;
    const transbordosAndamento = recs.filter(r => r.tipo === 'TRANSBORDO' && !['FINALIZADO', 'CANCELADO'].includes(r.status)).length;
    const transbordosFinalizados = recs.filter(r => r.tipo === 'TRANSBORDO' && r.status === 'FINALIZADO').length;

    return '<div class="kpi-grid" style="margin-bottom:14px">' +
      _cardOperacional('blue', hojeArr.length, 'Recebimentos hoje', { hoje: true }) +
      _cardOperacional('purple', emAndamento.length, 'Em andamento') +
      _cardOperacional('green', finalizadosHoje.length, 'Finalizados hoje', { status: 'FINALIZADO', hoje: true }) +
      _cardOperacional('yellow', aguardandoDescarga.length, 'Aguardando descarga', { status: 'AGUARDANDO_DOCA' }) +
      _cardOperacional('orange', emDescarga.length, 'Em descarga', { status: 'EM_DESCARGA' }) +
      _cardOperacional(atrasadas.length ? 'red' : 'green', atrasadas.length, 'Cargas atrasadas', { status: 'ATRASADO' }) +
      _cardOperacional('teal', notasOperacionais, 'Notas fiscais registradas') +
      _cardOperacional(semNota.length ? 'orange' : 'green', semNota.length, 'Recebimentos sem nota') +
      _cardOperacional('blue', fmtMin(tempoMedioEspera), 'Tempo médio de espera') +
      _cardOperacional('purple', fmtMin(tempoMedioDescarga), 'Tempo médio de descarga') +
      _cardOperacional('teal', fmtMin(tempoMedioTotal), 'Tempo médio total') +
      _cardOperacional('lime', fornecedoresHoje, 'Fornecedores recebidos hoje') +
      _cardOperacional('blue', transbordosAndamento, 'Transbordos em andamento') +
      _cardOperacional('green', transbordosFinalizados, 'Transbordos finalizados') +
      '</div>';
  }

  function _desenhar() {
    const pagina = document.getElementById('page-recebimento-dashboard');
    if (!pagina) return;
    const linhas = _notasFiltradas();
    const cargasLinhas = _cargasFiltradas();
    const notasDoPeriodo = _notas.filter(x => !_filtroDashPeriodo || _mesChave(x.processamento || x.dataRecebimento) === _filtroDashPeriodo);
    const transbordoNoPeriodo = notasDoPeriodo.filter(x => (global.categoriaNotaBluesoft?.(x) || 'FORNECEDOR') === 'TRANSBORDO').length;
    const devolucoesExcluidas = notasDoPeriodo.filter(x => global.ehNotaDevolucaoBluesoft?.(x)).length;

    const categoriaAtiva = _filtroDashCategoria || 'FORNECEDOR';
    const rotuloCategoria = { FORNECEDOR: 'de fornecedor', TRANSBORDO: 'de transbordo', TODAS: '' }[categoriaAtiva] || '';
    // Devolução nunca é opção de filtro (pedido do usuário: "tirar fora", não
    // "deixar escondida atrás de um filtro") — o aviso abaixo é só
    // informativo, sempre visível, não depende da categoria escolhida.
    const notaRodape = [
      devolucoesExcluidas ? devolucoesExcluidas.toLocaleString('pt-BR') + ' devolução(ões) não contam como recebimento' : '',
      categoriaAtiva === 'FORNECEDOR' && transbordoNoPeriodo ? transbordoNoPeriodo.toLocaleString('pt-BR') + ' transbordo(s) não contam aqui — veja na aba Transbordo' : '',
      categoriaAtiva === 'TRANSBORDO' ? 'esses mesmos dados também aparecem na aba Transbordo' : '',
    ].filter(Boolean).join(' · ');
    const totalNotas = linhas.length;
    const fornecedoresDistintos = new Set(linhas.map(x => x.fornecedorNome).filter(Boolean)).size;
    const comTempo = linhas.filter(x => x.tempoLancamentoMin != null);
    const tempoMedioLancamento = comTempo.length ? comTempo.reduce((s, x) => s + x.tempoLancamentoMin, 0) / comTempo.length : null;
    const comparaveis = linhas.filter(x => x.comparavel);
    const comDivergencia = linhas.filter(x => x.temDivergencia).length;
    const pctDivergencia = comparaveis.length ? (comDivergencia / comparaveis.length * 100) : null;
    const valorTotal = linhas.reduce((s, x) => s + n(x.valor), 0);
    const temposRecebimento = cargasLinhas.map(_tempoRecebimentoMin).filter(v => v != null);
    const tempoMedioRecebimento = temposRecebimento.length ? temposRecebimento.reduce((s, v) => s + v, 0) / temposRecebimento.length : null;
    const temposEspera = cargasLinhas.map(_tempoEsperaMin).filter(v => v != null);
    const tempoMedioEspera = temposEspera.length ? temposEspera.reduce((s, v) => s + v, 0) / temposEspera.length : null;
    const temposConferencia = cargasLinhas.map(_tempoConferenciaMin).filter(v => v != null);
    const tempoMedioConferencia = temposConferencia.length ? temposConferencia.reduce((s, v) => s + v, 0) / temposConferencia.length : null;

    // ── Séries por mês (notas: quantidade e valor; cargas: tempo de recebimento) ──
    // Fonte: _comprasBi (relatorios_bi_compras_historico_chunks, atualizado
    // sozinho a cada 4h) — não `linhas`/_notas (só atualiza com clique
    // manual em "Buscar recebimento"). Ver comentário em _carregarComprasBi.
    // O BI vem por ITEM da nota (1 linha por produto) — conta nota única por
    // loja+número+emissão pra não multiplicar "notas recebidas" pela
    // quantidade de produtos dela; valor soma todos os itens normalmente
    // (a soma dos itens já É o valor da nota).
    const notasChavesPorMes = new Map();
    const valorPorMes = new Map();
    _comprasBi.forEach(x => {
      const mes = _mesChave(x.data_recebimento || x.data_emissao);
      if (!mes) return;
      const chaveNota = x.loja_key + '|' + x.nf_numero + '|' + String(x.data_emissao || '').slice(0, 10);
      if (!notasChavesPorMes.has(mes)) notasChavesPorMes.set(mes, new Set());
      notasChavesPorMes.get(mes).add(chaveNota);
      valorPorMes.set(mes, (valorPorMes.get(mes) || 0) + n(x.Custo_liquido_total));
    });
    const notasPorMes = new Map([...notasChavesPorMes.entries()].map(([mes, set]) => [mes, set.size]));
    const tempoRecebPorMes = new Map();
    const tempoEsperaPorMes = new Map();
    const tempoConferenciaPorMes = new Map();
    cargasLinhas.forEach(c => {
      const mes = _mesChave(c.dataGeracao);
      if (!mes) return;
      const t = _tempoRecebimentoMin(c);
      if (t != null) { const arr = tempoRecebPorMes.get(mes) || []; arr.push(t); tempoRecebPorMes.set(mes, arr); }
      const te = _tempoEsperaMin(c);
      if (te != null) { const arr = tempoEsperaPorMes.get(mes) || []; arr.push(te); tempoEsperaPorMes.set(mes, arr); }
      const tc = _tempoConferenciaMin(c);
      if (tc != null) { const arr = tempoConferenciaPorMes.get(mes) || []; arr.push(tc); tempoConferenciaPorMes.set(mes, arr); }
    });
    const meses = [...new Set([...notasPorMes.keys(), ...tempoRecebPorMes.keys()])].sort().slice(-14);
    const mediaArr = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    const rankingFornecedores = _rankingFornecedoresBluesoft(linhas).slice(0, 10);

    pagina.innerHTML = `
      <div style="margin-bottom:10px">
        <div class="page-title" style="font-size:1.15rem">🚚 Recebimento</div>
        <div style="font-size:.74rem;color:var(--muted)">Visão operacional de hoje — clique num card pra ver a lista filtrada</div>
      </div>
      ${_kpisOperacionaisHtml()}
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:22px 0 14px;align-items:center">
        <div><b>📊 Histórico</b><div style="font-size:.74rem;color:var(--muted)">${totalNotas.toLocaleString('pt-BR')} nota(s) ${rotuloCategoria} neste período — números de nota individuais ficam na aba "Notas Fiscais"${notaRodape ? ' · ' + notaRodape : ''}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select class="field" id="reb-f-categoria" style="max-width:170px" title="Categoria da nota — devolução nunca conta como recebimento">
            <option value=""${!_filtroDashCategoria ? ' selected' : ''}>Fornecedor (padrão)</option>
            <option value="TRANSBORDO"${_filtroDashCategoria === 'TRANSBORDO' ? ' selected' : ''}>Transbordo</option>
            <option value="TODAS"${_filtroDashCategoria === 'TODAS' ? ' selected' : ''}>Todas</option>
          </select>
          <input type="month" class="field" id="reb-f-periodo" value="${esc(_filtroDashPeriodo)}" style="max-width:150px" title="Filtrar por período">
          <button type="button" class="btn btn-primary btn-sm" data-reb-sync>🔎 Buscar recebimento</button>
        </div>
      </div>
      <div id="reb-sync-status" style="font-size:.72rem;color:var(--muted);margin:-8px 0 12px">${esc(_ultimoSync)}</div>
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${totalNotas.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Notas recebidas</div></div>
        <div class="kpi teal"><div class="kpi-val">${fornecedoresDistintos}</div><div class="kpi-lbl">Fornecedores distintos</div></div>
        <div class="kpi purple"><div class="kpi-val">${fmtMin(tempoMedioLancamento)}</div><div class="kpi-lbl">Tempo médio de lançamento</div></div>
        <div class="kpi ${comDivergencia ? 'red' : 'green'}"><div class="kpi-val">${pctDivergencia == null ? '—' : pctDivergencia.toFixed(1) + '%'}</div><div class="kpi-lbl">Com divergência (${comDivergencia} de ${comparaveis.length} comparável)</div></div>
        <div class="kpi orange"><div class="kpi-val">${valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div><div class="kpi-lbl">Valor total recebido</div></div>
        <div class="kpi lime"><div class="kpi-val">${fmtMin(tempoMedioRecebimento)}</div><div class="kpi-lbl">Tempo total (geração da carga → fechamento)</div></div>
        <div class="kpi yellow"><div class="kpi-val">${fmtMin(tempoMedioEspera)}</div><div class="kpi-lbl">Tempo médio de espera (geração → início da conferência)</div></div>
        <div class="kpi purple"><div class="kpi-val">${fmtMin(tempoMedioConferencia)}</div><div class="kpi-lbl">Tempo médio de conferência (início → fechamento)</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:12px"><b>📈 Notas recebidas por mês</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Compras (BI) — atualiza sozinho a cada 4h, sem precisar clicar em nada</div><div style="height:220px;margin-top:8px"><canvas id="reb-graf-notas"></canvas></div></div>
        <div class="tc" style="padding:12px"><b>💰 Valor recebido por mês</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Custo líquido das compras (BI) — atualiza sozinho a cada 4h</div><div style="height:220px;margin-top:8px"><canvas id="reb-graf-valor"></canvas></div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:12px"><b>⏱️ Tempo de recebimento por mês (espera + conferência)</b><div style="height:220px;margin-top:8px"><canvas id="reb-graf-tempo"></canvas></div></div>
        <div class="tc" style="padding:12px"><b>🏢 Fornecedores com mais entregas</b><div style="height:220px;margin-top:8px"><canvas id="reb-graf-fornecedores"></canvas></div></div>
      </div>
      <div class="tc" style="padding:12px">
        <b>🏆 Ranking de fornecedores</b>
        <table class="dt-table" style="margin-top:8px"><thead><tr><th>Fornecedor</th><th>Entregas</th><th>Valor recebido</th></tr></thead><tbody>
        ${rankingFornecedores.length ? rankingFornecedores.map(f => `<tr><td>${esc(f.nome)}</td><td>${f.entregas}</td><td>${f.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>`).join('') : '<tr><td colspan="3">Sem dados suficientes ainda.</td></tr>'}
        </tbody></table>
      </div>`;

    _destruirGraficos();
    if (global.Chart) {
      const ctxNotas = document.getElementById('reb-graf-notas');
      if (ctxNotas) charts.push(new global.Chart(ctxNotas, { type: 'bar', data: { labels: meses.map(_fmtMesLabel), datasets: [{ label: 'Notas recebidas', data: meses.map(m => notasPorMes.get(m) || 0), backgroundColor: '#3b82f6' }] }, options: { responsive: true, maintainAspectRatio: false } }));
      const ctxValor = document.getElementById('reb-graf-valor');
      if (ctxValor) charts.push(new global.Chart(ctxValor, { type: 'bar', data: { labels: meses.map(_fmtMesLabel), datasets: [{ label: 'Valor recebido (R$)', data: meses.map(m => valorPorMes.get(m) || 0), backgroundColor: '#f59e0b' }] }, options: { responsive: true, maintainAspectRatio: false } }));
      const ctxTempo = document.getElementById('reb-graf-tempo');
      if (ctxTempo) charts.push(new global.Chart(ctxTempo, {
        type: 'bar',
        data: {
          labels: meses.map(_fmtMesLabel),
          datasets: [
            { label: 'Espera (min)', data: meses.map(m => Math.round(mediaArr(tempoEsperaPorMes.get(m) || []))), backgroundColor: '#eab308', stack: 'tempo' },
            { label: 'Conferência (min)', data: meses.map(m => Math.round(mediaArr(tempoConferenciaPorMes.get(m) || []))), backgroundColor: '#8b5cf6', stack: 'tempo' },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true } } },
      }));
      const ctxFornec = document.getElementById('reb-graf-fornecedores');
      if (ctxFornec) charts.push(new global.Chart(ctxFornec, { type: 'bar', data: { labels: rankingFornecedores.map(f => f.nome), datasets: [{ label: 'Entregas', data: rankingFornecedores.map(f => f.entregas), backgroundColor: '#14b8a6' }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' } }));
    }
  }

  async function _sincronizar() {
    const statusEl = document.getElementById('reb-sync-status');
    if (typeof global.sincronizarRecebimentoBluesoft !== 'function') { global.showToast?.('Serviço de busca indisponível.', 'error'); return; }
    if (statusEl) statusEl.textContent = '⏳ Buscando recebimento...';
    try {
      const r = await global.sincronizarRecebimentoBluesoft({
        meses: 12,
        onProgresso: n2 => { if (statusEl) statusEl.textContent = '⏳ ' + n2.toLocaleString('pt-BR') + ' nota(s) recebida(s)...'; },
      });
      _ultimoSync = r.totalNotas.toLocaleString('pt-BR') + ' nota(s) (' + r.criadas + ' nova(s), ' + r.atualizadas + ' atualizada(s)) — ' +
        r.comDivergencia + ' com divergência — ' + r.totalCargas.toLocaleString('pt-BR') + ' carga(s) — últimos ' + r.meses + ' mês(es) · ' + new Date().toLocaleString('pt-BR');
      await carregarLogisticaRecebimento(true);
      _desenhar();
      global.showToast?.('Recebimento sincronizado: ' + r.criadas + ' nova(s), ' + r.atualizadas + ' atualizada(s).', 'success');
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Erro: ' + (e.message || e);
      global.showToast?.('Erro ao sincronizar recebimento: ' + (e.message || e), 'error');
    }
  }

  // Chegada na portaria é o único campo manual desta tela (ver cabeçalho do
  // arquivo) — grava junto o tempo já calculado até o recebimento, pra não
  // recalcular isso toda hora que a tabela renderiza.
  // A edição da chegada na portaria mora na tabela de notas (aba "Notas
  // Fiscais", 94-recebimento-relatorios.js) — essa função continua aqui
  // porque já mexe direto em `_notas` (a mesma referência compartilhada via
  // `notasTodas()`) e grava no Firestore; quem chama é que redesenha a
  // própria tela depois (por isso não chama _desenhar() sozinha mais).
  async function _salvarPortaria(notaFiscalKey, valorDatetimeLocal) {
    const nota = _notas.find(x => String(x.notaFiscalKey) === String(notaFiscalKey));
    if (!nota) return;
    const chegada = valorDatetimeLocal ? new Date(valorDatetimeLocal).toISOString() : null;
    let tempoPortariaAteRecebimentoMin = null;
    if (chegada) {
      const alvo = nota.dataRecebimento || nota.fimLancamento || nota.processamento;
      if (alvo) {
        const diffMin = Math.round((new Date(alvo) - new Date(chegada)) / 60000);
        if (!isNaN(diffMin)) tempoPortariaAteRecebimentoMin = diffMin;
      }
    }
    try {
      await fs().collection('recebimento_notas').doc(nota._id).set({
        chegadaPortaria: chegada, tempoPortariaAteRecebimentoMin,
        atualizadoEm: new Date().toISOString(), atualizadoPor: global._currentAnalistaUser?.email || '',
      }, { merge: true });
      nota.chegadaPortaria = chegada; nota.tempoPortariaAteRecebimentoMin = tempoPortariaAteRecebimentoMin;
    } catch (e) {
      global.showToast?.('Erro ao salvar chegada na portaria: ' + (e.message || e), 'error');
    }
  }

  // Demais páginas da sidebar de Recebimento (fase 15/FASE 1) — só o
  // esqueleto de navegação nesta fase; conteúdo real entra na FASE 2
  // (Recebimento Analista) e FASE 3 (Transbordo), um de cada vez, validado
  // antes de seguir pra próxima — mesmo padrão de placeholder já usado pro
  // setor sem módulo liberado (`irParaSetor`, `37-usuarios-permissoes.js`).
  function _renderRecebimentoPlaceholder(pageId, titulo, icone, fase) {
    const pagina = document.getElementById('page-' + pageId);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">' + icone + '</div><div class="empty-title">' + esc(titulo) + '</div><div class="empty-sub">🚧 Em construção — chega na ' + esc(fase) + ' do módulo de Recebimento.</div></div>';
  }
  // renderRecebimentoNotas/Fornecedores/Agendamentos/Historico reais ficam
  // em 94-recebimento-relatorios.js (fase 2d); renderRecebimentoTransbordo
  // real fica em 95-recebimento-transbordo.js (fase 3).
  // ── Tempos / Performance (fase 15/FASE 2c) — seções 4 e 28 do pedido:
  // tempo médio por etapa, evolução diária e quais cargas mais demoraram.
  let _filtroPerfMes = new Date().toISOString().slice(0, 7);
  let _ouvintePerfRegistrado = false;
  function _isoValido(v) { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; }
  function _fmtHHMM(min) {
    if (min == null || !isFinite(min)) return '—';
    const total = Math.max(0, Math.round(min));
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }
  function _mesDe(r) { return String(r.horaSaida || r.horaChegada || r.criadoEm || '').slice(0, 7); }
  function _diaDe(r) { return String(r.horaSaida || r.horaChegada || r.criadoEm || '').slice(0, 10); }
  function _volumesRec(r) {
    const direto = n(r.volumes);
    if (direto) return direto;
    return (r.notas || []).reduce((s, nt) => s + n(nt.quantidadeVolumes), 0);
  }
  function _placaRec(r) { return String(r.placa || 'SEM PLACA').trim().toUpperCase(); }
  function _motoristaRec(r) { return String(r.motoristaNome || r.fornecedorNome || 'Sem motorista').trim(); }
  function _media(arr) { const vals = (arr || []).filter(v => v != null && isFinite(v)); return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : null; }
  function _soma(arr) { return (arr || []).reduce((s,v)=>s+(Number(v)||0),0); }
  function _pct(num, den) { return den ? (num / den) * 100 : 0; }
  function _inicioFimMes(mes) {
    const [a,m] = String(mes || '').split('-').map(Number);
    if (!a || !m) return null;
    return { inicio: new Date(a, m - 1, 1), fim: new Date(a, m, 1) };
  }
  function _mesLabelLongo(mes) {
    const [a,m] = String(mes || '').split('-').map(Number);
    const nomes = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    return a && m ? nomes[m-1] + ' de ' + a : mes;
  }
  function _minEntre(a,b) {
    const da=_isoValido(a), db=_isoValido(b); if(!da||!db) return null;
    const v=(db-da)/60000; return isFinite(v) && v >= 0 ? v : null;
  }
  function _escapeAttr(v){ return esc(v).replace(/`/g,'&#96;'); }
  function _corStatus(valor, meta, inverso) {
    if (valor == null) return 'gray';
    const ok = inverso ? valor >= meta : valor <= meta;
    return ok ? 'green' : 'red';
  }
  function _barraPct(valor) { return Math.max(0, Math.min(100, Number(valor) || 0)); }

  async function renderRecebimentoTempos() {
    const pagina = document.getElementById('page-recebimento-tempos');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando performance...</div></div>';
    try {
      await Promise.all([
        global._recebimentoOperacaoInternals?.carregar?.(),
        global._recebimentoConfigInternals?.carregar?.(),
      ]);
    } catch (e) {
      pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>';
      return;
    }
    if (!_ouvintePerfRegistrado) {
      global._recebimentoOperacaoInternals?.onMudanca?.(() => {
        const p = document.getElementById('page-recebimento-tempos');
        if (p && (p.classList.contains('active') || p.offsetParent !== null)) _desenharRecebimentoTempos();
      });
      _ouvintePerfRegistrado = true;
    }
    _desenharRecebimentoTempos();
  }

  function _desenharRecebimentoTempos() {
    const pagina = document.getElementById('page-recebimento-tempos');
    if (!pagina) return;
    const todos = global._recebimentoOperacaoInternals?.recebimentos?.() || [];
    const config = global._recebimentoConfigInternals;
    const veiculosCad = config?.veiculos?.() || [];

    // A tela é de performance logística. As métricas de viagem/frota abaixo usam
    // só Transbordos, porque são os registros que têm saída -> chegada e placa.
    const transbordos = todos.filter(r => r.tipo === 'TRANSBORDO');
    const linhas = transbordos.filter(r => !_filtroPerfMes || _mesDe(r) === _filtroPerfMes);
    const recsMes = todos.filter(r => !_filtroPerfMes || _mesDe(r) === _filtroPerfMes);

    const META_DESCARGA = 60;       // 01:00
    const META_INTERVALO = 120;     // 02:00
    const META_VIAGENS_DIA = 5;     // 5 viagens por carreta/dia

    const viagens = linhas.filter(r => r.horaSaida || r.status === 'FINALIZADO');
    const volumes = _soma(linhas.map(_volumesRec));
    const descargas = linhas.map(r => r.tempoDescargaMin).filter(v => v != null);
    const mediaDescarga = _media(descargas);
    const dentroMetaDescarga = linhas.filter(r => r.tempoDescargaMin != null && r.tempoDescargaMin <= META_DESCARGA).length;
    const pctMetaDescarga = _pct(dentroMetaDescarga, descargas.length);

    const diasOperacaoSet = new Set(viagens.map(_diaDe).filter(Boolean));
    const diasOperacao = diasOperacaoSet.size;
    const mediaViagensDia = diasOperacao ? viagens.length / diasOperacao : 0;

    const placasUsadas = new Set(viagens.map(_placaRec).filter(p => p && p !== 'SEM PLACA'));
    const veiculosAtivos = veiculosCad.filter(v => v.ativo !== false);
    const totalVeiculosCad = veiculosCad.length;
    const disponiveis = veiculosAtivos.length;
    const indisponiveis = Math.max(0, totalVeiculosCad - disponiveis);
    const disponibilidade = totalVeiculosCad ? _pct(disponiveis, totalVeiculosCad) : (placasUsadas.size ? 100 : 0);
    const utilizacao = disponiveis ? _pct(placasUsadas.size, disponiveis) : (placasUsadas.size ? 100 : 0);
    const mediaViagensCarretaMes = placasUsadas.size ? viagens.length / placasUsadas.size : 0;

    // Intervalos: saída de uma viagem -> próxima chegada da mesma placa no mesmo dia.
    const porPlacaDia = new Map();
    viagens.forEach(r => {
      const placa = _placaRec(r); const dia = _diaDe(r);
      if (!placa || placa === 'SEM PLACA' || !dia) return;
      const k = placa + '|' + dia; const arr = porPlacaDia.get(k) || []; arr.push(r); porPlacaDia.set(k, arr);
    });
    const intervalos = [];
    const intervalosPorPlaca = new Map();
    porPlacaDia.forEach(arr => {
      arr.sort((a,b) => String(a.horaSaida || '').localeCompare(String(b.horaSaida || '')));
      for (let x=0;x<arr.length-1;x++) {
        const atual = arr[x], prox = arr[x+1];
        const min = _minEntre(atual.horaSaida, prox.horaChegada || prox.horaSaida);
        if (min == null) continue;
        intervalos.push({ placa:_placaRec(atual), motorista:_motoristaRec(atual), min, atual, prox });
        const ap = intervalosPorPlaca.get(_placaRec(atual)) || []; ap.push(min); intervalosPorPlaca.set(_placaRec(atual), ap);
      }
    });
    const mediaIntervalo = _media(intervalos.map(x => x.min));

    // Jornada por carreta/dia: primeira chegada/saída até último fechamento/saída.
    const jornadas = [];
    porPlacaDia.forEach((arr, chave) => {
      const tempos = [];
      arr.forEach(r => {
        [r.horaChegada, r.horaSaida, r.horaInicioDescarga, r.horaFimDescarga, r.horaFechamentoRecebimento].forEach(v => { const d=_isoValido(v); if(d) tempos.push(d); });
      });
      if (tempos.length < 2) return;
      tempos.sort((a,b)=>a-b);
      jornadas.push({ chave, horas:(tempos[tempos.length-1]-tempos[0])/3600000, viagens:arr.length });
    });
    const mediaHorasCarretaDia = _media(jornadas.map(j => j.horas));
    const horasAcumuladas = _soma(jornadas.map(j => j.horas));
    const viagensPorHora = horasAcumuladas ? viagens.length / horasAcumuladas : 0;

    const metaViagens = diasOperacao && disponiveis ? diasOperacao * disponiveis * META_VIAGENS_DIA : 0;
    const pctMetaViagens = metaViagens ? _pct(viagens.length, metaViagens) : 0;

    // Ranking por carreta.
    const porPlaca = new Map();
    linhas.forEach(r => {
      const placa = _placaRec(r); if (!placa || placa === 'SEM PLACA') return;
      const acc = porPlaca.get(placa) || { placa, motoristas:new Map(), viagens:0, volumes:0, descargas:[], totais:[], dias:new Set(), horas:0 };
      acc.viagens++; acc.volumes += _volumesRec(r); acc.dias.add(_diaDe(r));
      if (r.tempoDescargaMin != null) acc.descargas.push(r.tempoDescargaMin);
      if (r.tempoTotalMin != null) acc.totais.push(r.tempoTotalMin);
      const mot=_motoristaRec(r); acc.motoristas.set(mot,(acc.motoristas.get(mot)||0)+1);
      porPlaca.set(placa,acc);
    });
    jornadas.forEach(j => { const placa=j.chave.split('|')[0]; const acc=porPlaca.get(placa); if(acc) acc.horas += j.horas; });
    const rankingCarretas = [...porPlaca.values()].map(acc => ({
      ...acc,
      motorista:[...acc.motoristas.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] || '—',
      mediaDescarga:_media(acc.descargas), mediaTotal:_media(acc.totais),
      mediaHorasDia: acc.dias.size ? acc.horas/acc.dias.size : 0,
      mediaIntervalo:_media(intervalosPorPlaca.get(acc.placa)||[]),
      pctMeta: acc.dias.size ? _pct(acc.viagens, acc.dias.size*META_VIAGENS_DIA) : 0,
    })).sort((a,b) => (b.viagens-a.viagens) || String(a.placa).localeCompare(String(b.placa)));

    // Tendência 1ª x 2ª metade do mês, usando descarga média.
    const metade1 = linhas.filter(r => Number(_diaDe(r).slice(8,10)) <= 15).map(r=>r.tempoDescargaMin).filter(v=>v!=null);
    const metade2 = linhas.filter(r => Number(_diaDe(r).slice(8,10)) > 15).map(r=>r.tempoDescargaMin).filter(v=>v!=null);
    const m1=_media(metade1), m2=_media(metade2), variacao=(m1!=null&&m2!=null)?m2-m1:null;

    // Faixas de intervalo.
    const faixas = [
      { label:'Até 02:00', min:0, max:120 },
      { label:'De 02:01 a 03:00', min:120, max:180 },
      { label:'De 03:01 a 04:00', min:180, max:240 },
      { label:'Acima de 04:00', min:240, max:Infinity },
    ].map((f,idx)=>({...f, qtd:intervalos.filter(x => idx===0 ? x.min<=f.max : (x.min>f.min && x.min<=f.max)).length}));
    const maxFaixa = Math.max(1, ...faixas.map(f=>f.qtd));

    // Alertas operacionais baseados apenas em dados realmente existentes.
    const acimaDescarga = linhas.filter(r=>r.tempoDescargaMin!=null && r.tempoDescargaMin>META_DESCARGA).length;
    const alertas = [];
    if (acimaDescarga) alertas.push({ tipo:'red', texto:`⏱️ ${acimaDescarga} viagem(ns) acima de ${_fmtHHMM(META_DESCARGA)} de descarga no mês.` });
    if (descargas.length && pctMetaDescarga < 90) alertas.push({ tipo:'yellow', texto:`🎯 Cumprimento da meta de descarga em ${pctMetaDescarga.toFixed(1).replace('.',',')}%, abaixo de 90%.` });
    if (disponiveis && placasUsadas.size < disponiveis) alertas.push({ tipo:'orange', texto:`🚛 ${placasUsadas.size} de ${disponiveis} veículo(s) disponível(is) rodaram no período.` });
    if (indisponiveis) alertas.push({ tipo:'yellow', texto:`🛠️ ${indisponiveis} veículo(s) cadastrado(s) está(ão) inativo(s)/indisponível(is).` });
    if (!alertas.length) alertas.push({ tipo:'green', texto:'✅ Nenhum alerta operacional relevante no período selecionado.' });

    const rankingRetorno = rankingCarretas.filter(x=>x.mediaIntervalo!=null).slice().sort((a,b)=>a.mediaIntervalo-b.mediaIntervalo);
    const maiorDescarga = rankingCarretas.filter(x=>x.mediaDescarga!=null).slice().sort((a,b)=>b.mediaDescarga-a.mediaDescarga)[0];
    const motivosMap = new Map();
    linhas.forEach(r => {
      const motivo = String(r.motivo || r.observacao || '').trim();
      if (!motivo) return;
      const chave = motivo.toLocaleLowerCase('pt-BR');
      const atual = motivosMap.get(chave) || { texto: motivo, qtd: 0 };
      atual.qtd++; motivosMap.set(chave, atual);
    });
    const rankingMotivos = [...motivosMap.values()].sort((a,b)=>b.qtd-a.qtd).slice(0,8);

    const tempoMedioEspera = _media(recsMes.map(r => r.tempoEsperaMin).filter(v => v != null));
    const tempoMedioTotal = _media(recsMes.map(r => r.tempoTotalMin).filter(v => v != null));
    const tempoMedioFechamento = _media(recsMes.map(r => r.tempoAteFechamentoMin).filter(v => v != null));

    const card = (icone, valor, titulo, sub, classe='blue') => `<div class="kpi ${classe}" style="min-height:116px"><div style="font-size:1rem;margin-bottom:6px">${icone}</div><div class="kpi-val">${valor}</div><div class="kpi-lbl">${titulo}</div>${sub?`<div style="font-size:.66rem;color:var(--muted);margin-top:5px">${sub}</div>`:''}</div>`;
    const statMini = (valor, titulo) => `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--card)"><div style="font-size:1.05rem;font-weight:800">${valor}</div><div style="font-size:.66rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-top:3px">${titulo}</div></div>`;

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.2rem">⏱️ Tempos / Performance</div><div style="font-size:.74rem;color:var(--muted)">Painel completo de eficiência dos transbordos e tempos de recebimento</div></div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <label style="font-size:.7rem;color:var(--muted)">Mês<br><input id="rebperf-mes" class="field" type="month" value="${_escapeAttr(_filtroPerfMes)}" style="min-width:145px"></label>
          <button type="button" class="btn btn-ghost btn-sm" data-rebperf-atualizar="1">↻ Atualizar</button>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:14px">
        ${card('🚚', viagens.length.toLocaleString('pt-BR'), 'Total de viagens no mês', _mesLabelLongo(_filtroPerfMes), 'blue')}
        ${card('📦', volumes.toLocaleString('pt-BR'), 'Volumes no mês', _mesLabelLongo(_filtroPerfMes), 'purple')}
        ${card('⏱️', _fmtHHMM(mediaDescarga), 'Tempo médio de descarga', mediaDescarga!=null ? (mediaDescarga>META_DESCARGA?'⚠ Acima da meta de '+_fmtHHMM(META_DESCARGA):'✓ Dentro da meta de '+_fmtHHMM(META_DESCARGA)) : 'Sem descarga finalizada', _corStatus(mediaDescarga,META_DESCARGA,false))}
        ${card('🎯', _fmtHHMM(META_DESCARGA), 'Meta de descarga', 'Tempo máximo permitido', 'orange')}
        ${card('🚛', `${mediaViagensDia.toFixed(1).replace('.',',')} / ${META_VIAGENS_DIA}`, 'Média de viagens por dia', `${diasOperacao} dia(s) com operação`, 'teal')}
        ${card('📊', mediaViagensCarretaMes.toFixed(1).replace('.',','), 'Média de viagens por carreta no mês', `${placasUsadas.size} carreta(s) utilizada(s)`, 'blue')}
        ${card('🛠️', disponibilidade.toFixed(1).replace('.',',')+'%', 'Disponibilidade da frota', totalVeiculosCad ? `${disponiveis} disponível(is) · ${indisponiveis} inativo(s)` : 'Sem cadastro de frota; baseado no uso', disponibilidade>=80?'green':'yellow')}
        ${card('✅', pctMetaDescarga.toFixed(1).replace('.',',')+'%', 'Viagens dentro da meta', `${dentroMetaDescarga} de ${descargas.length} viagem(ns) com descarga medida`, pctMetaDescarga>=90?'green':'red')}
        ${card('📈', utilizacao.toFixed(1).replace('.',',')+'%', 'Percentual de utilização', `${placasUsadas.size} de ${disponiveis || placasUsadas.size} disponível(is)`, utilizacao>=80?'green':'yellow')}
        ${card('🔄', _fmtHHMM(mediaIntervalo), 'Média entre viagens', `${intervalos.length} intervalo(s) calculado(s) · meta ${_fmtHHMM(META_INTERVALO)}`, _corStatus(mediaIntervalo,META_INTERVALO,false))}
        ${card('🏁', metaViagens ? `${viagens.length} / ${metaViagens}` : `${viagens.length}`, 'Meta de viagens', metaViagens ? `${META_VIAGENS_DIA} viagens × ${disponiveis} carreta(s) × ${diasOperacao} dia(s)` : 'Meta calculada quando houver frota ativa', pctMetaViagens>=100?'green':'yellow')}
        ${card('🕒', mediaHorasCarretaDia!=null ? mediaHorasCarretaDia.toFixed(1).replace('.',',')+'h' : '—', 'Média de horas por carreta/dia', `${horasAcumuladas.toFixed(1).replace('.',',')}h acumuladas no mês`, 'purple')}
        ${card('⚙️', viagensPorHora.toFixed(2).replace('.',','), 'Viagens por hora', 'Total de viagens ÷ horas acumuladas', 'teal')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:14px">
          <b>🚛 Tempo médio por carreta</b><div style="font-size:.68rem;color:var(--muted);margin:2px 0 10px">Eficiência individual por placa e motorista no mês selecionado</div>
          <div style="display:grid;gap:8px">${rankingCarretas.length ? rankingCarretas.slice(0,10).map(x=>`<div style="border:1px solid var(--border);border-radius:9px;padding:10px;display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b class="mono">🚛 ${esc(x.placa)}</b> <span style="font-size:.68rem;color:var(--muted)">👤 ${esc(x.motorista)} · ${x.viagens} viagem(ns) · ${x.volumes.toLocaleString('pt-BR')} volumes</span></div><div style="text-align:right"><b>${_fmtHHMM(x.mediaDescarga)}</b><div style="font-size:.62rem;color:${x.mediaDescarga!=null&&x.mediaDescarga>META_DESCARGA?'var(--danger)':'var(--success)'}">${x.mediaDescarga==null?'Sem descarga medida':(x.mediaDescarga>META_DESCARGA?'Acima da meta':'Dentro da meta')}</div></div></div>`).join('') : '<div class="empty-sub">Sem viagens com placa no período.</div>'}</div>
        </div>
        <div class="tc" style="padding:14px">
          <b>🧰 Alertas operacionais</b><div style="font-size:.68rem;color:var(--muted);margin:2px 0 10px">Pontos que exigem atenção no período selecionado</div>
          <div style="display:grid;gap:8px">${alertas.map(a=>`<div style="padding:10px 12px;border-radius:9px;border:1px solid var(--border);background:${a.tipo==='red'?'rgba(239,68,68,.08)':a.tipo==='yellow'?'rgba(245,158,11,.10)':a.tipo==='orange'?'rgba(249,115,22,.09)':'rgba(34,197,94,.08)'}">${esc(a.texto)}</div>`).join('')}</div>
        </div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:14px">
        <b>🛠️ Ranking de motivos / observações</b><div style="font-size:.68rem;color:var(--muted);margin:2px 0 10px">Principais causas registradas nos transbordos para demora ou ocorrência.</div>
        ${rankingMotivos.length ? `<div style="display:grid;gap:8px">${rankingMotivos.map((m,idx)=>`<div style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding:7px 2px"><span>${idx+1}. ${esc(m.texto)}</span><b>${m.qtd}</b></div>`).join('')}</div>` : '<div style="padding:20px;text-align:center;color:var(--muted)">Ainda não há motivo/observação preenchido nos transbordos. Quando houver, o ranking aparece automaticamente aqui.</div>'}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:14px">
          <b>📉 Tendência do mês</b><div style="font-size:.68rem;color:var(--muted);margin:2px 0 10px">Comparação do tempo médio de descarga entre a primeira e a segunda metade</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${statMini(_fmtHHMM(m1),'1ª metade')}${statMini(_fmtHHMM(m2),'2ª metade')}${statMini(variacao==null?'—':((variacao>0?'+':'')+Math.round(variacao)+' min'),'Variação')}</div>
          ${variacao!=null?`<div style="margin-top:10px;font-size:.68rem;font-weight:700;color:${variacao>0?'var(--danger)':'var(--success)'}">${variacao>0?'⚠ Piora de '+Math.round(variacao)+' min':'✓ Melhora de '+Math.abs(Math.round(variacao))+' min'}</div>`:''}
        </div>
        <div class="tc" style="padding:14px">
          <b>⏳ Faixas de tempo entre viagens</b><div style="font-size:.68rem;color:var(--muted);margin:2px 0 10px">Distribuição dos retornos para localizar carretas com demora</div>
          <div style="display:grid;gap:10px">${faixas.map((f,idx)=>`<div><div style="display:flex;justify-content:space-between;font-size:.72rem"><span>${idx===0?'🟢':idx===1?'🟡':idx===2?'🟠':'🔴'} <b>${f.label}</b></span><b>${f.qtd}</b></div><div style="height:5px;background:var(--border);border-radius:99px;margin-top:5px;overflow:hidden"><div style="height:100%;width:${(f.qtd/maxFaixa)*100}%;background:${idx===0?'#22c55e':idx===1?'#eab308':idx===2?'#f97316':'#ef4444'}"></div></div></div>`).join('')}</div>
        </div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:14px">
        <b>🔄 Tempo entre viagens das carretas</b><div style="font-size:.68rem;color:var(--muted);margin:2px 0 10px">Calculado automaticamente entre a saída de uma viagem e a próxima chegada/saída da mesma carreta no mesmo dia.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px">${statMini('SAÍDA','Início do cálculo')}${statMini(_fmtHHMM(mediaIntervalo),'Tempo médio fora')}${statMini('CHEGADA','Fim do cálculo')}</div>
        <div style="padding:10px 12px;border-radius:9px;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.2);margin-bottom:10px">🔄 Tempo médio entre viagens no mesmo dia: <b>${_fmtHHMM(mediaIntervalo)}</b> — saída da carreta até a próxima chegada/saída registrada.</div>
        <div style="display:grid;gap:8px">${rankingRetorno.length ? rankingRetorno.slice(0,12).map((x,idx)=>`<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;display:flex;justify-content:space-between;gap:10px"><span>${idx+1}. 🚛 <b class="mono">${esc(x.placa)}</b> <span style="font-size:.68rem;color:var(--muted)">👤 ${esc(x.motorista)} · ${(intervalosPorPlaca.get(x.placa)||[]).length} intervalo(s)</span></span><span><b>${_fmtHHMM(x.mediaIntervalo)}</b> <span class="badge ${x.mediaIntervalo<=META_INTERVALO?'b-green':'b-red'}" style="font-size:.58rem">${x.mediaIntervalo<=META_INTERVALO?'Dentro da meta':'Crítico'}</span></span></div>`).join('') : '<div class="empty-sub">Ainda não há duas viagens da mesma placa no mesmo dia para calcular intervalos.</div>'}</div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:14px">
        <b>🏁 Meta, jornada e gargalos por carreta</b><div style="font-size:.68rem;color:var(--muted);margin:2px 0 10px">Meta fixa de ${META_VIAGENS_DIA} viagens por carreta/dia. Jornada calculada da primeira movimentação à última movimentação registrada do dia.</div>
        <div style="overflow:auto"><table class="dt-table"><thead><tr><th>Carreta / motorista</th><th>Viagens</th><th>% da meta</th><th>Média horas/dia</th><th>Descarga média</th><th>Entre viagens</th><th>Análise</th></tr></thead><tbody>${rankingCarretas.length ? rankingCarretas.map(x=>{ const analise = x.mediaDescarga!=null && x.mediaDescarga>META_DESCARGA ? 'Tempo de descarga acima da meta: possível gargalo na doca.' : x.pctMeta<80 ? 'Poucas viagens no período: verificar jornada, disponibilidade ou dados incompletos.' : x.mediaIntervalo!=null && x.mediaIntervalo>META_INTERVALO ? 'Intervalo entre viagens acima da meta.' : 'Operação dentro dos parâmetros principais.'; return `<tr><td><b class="mono">${esc(x.placa)}</b><br><span style="font-size:.65rem;color:var(--muted)">${esc(x.motorista)}</span></td><td>${x.viagens}</td><td>${x.pctMeta.toFixed(0)}%</td><td>${x.mediaHorasDia.toFixed(1).replace('.',',')}h</td><td>${_fmtHHMM(x.mediaDescarga)}</td><td>${_fmtHHMM(x.mediaIntervalo)}</td><td>${esc(analise)}</td></tr>`;}).join('') : '<tr><td colspan="7">Sem dados de carreta no período.</td></tr>'}</tbody></table></div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:14px">
        <b>📊 Tempos gerais de recebimento</b><div style="font-size:.68rem;color:var(--muted);margin:2px 0 10px">Mantém os indicadores que já existiam nesta tela, incluindo fornecedor e transbordo.</div>
        <div class="kpi-grid">
          ${card('🕐', fmtMin(tempoMedioEspera), 'Tempo médio de espera', `${recsMes.length} recebimento(s) no período`, 'blue')}
          ${card('📦', fmtMin(_media(recsMes.map(r=>r.tempoDescargaMin).filter(v=>v!=null))), 'Tempo médio de descarga', 'Todos os recebimentos', 'purple')}
          ${card('⏳', fmtMin(tempoMedioTotal), 'Tempo médio total', 'Todos os recebimentos', 'teal')}
          ${card('✅', fmtMin(tempoMedioFechamento), 'Tempo médio até fechamento', 'Todos os recebimentos', 'orange')}
        </div>
      </div>`;

    _destruirGraficos();
  }
  // renderRecebimentoConfig real fica em 92-recebimento-config.js (fase 2a),
  // renderRecebimentoOperacao em 93-recebimento-operacao.js (fase 2b),
  // renderRecebimentoNotas/Fornecedores/Agendamentos/Historico reais em
  // 94-recebimento-relatorios.js (fase 2d); renderRecebimentoTransbordo em
  // 95-recebimento-transbordo.js (fase 3).

  global.renderRecebimentoDashboard = renderRecebimentoDashboard;
  global.renderRecebimentoTempos = renderRecebimentoTempos;
  // `notasTodas` (sem filtro) existe separado de `notasFiltradas` porque
  // outras telas (ex.: cruzamento de NF do Transbordo em
  // 95-recebimento-transbordo.js) não podem depender do filtro de período/
  // fornecedor que o usuário deixou configurado na tela de Notas Fiscais —
  // senão uma NF de transbordo recente podia sumir do cruzamento só porque
  // alguém filtrou por outro mês em outra aba.
  global._recebimentoInternals = {
    carregar: carregarLogisticaRecebimento, notasFiltradas: _notasFiltradas, notasTodas: () => _notas,
    cargasTodas: () => _cargas, tempoRecebimentoMin: _tempoRecebimentoMin, tempoEsperaMin: _tempoEsperaMin, tempoConferenciaMin: _tempoConferenciaMin, salvarPortaria: _salvarPortaria,
    fmtMesLabel: _fmtMesLabel, kpisOperacionaisHtml: _kpisOperacionaisHtml,
  };

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-reb-sync]')) _sincronizar();
    const perfAtualizar = event.target.closest('[data-rebperf-atualizar]');
    if (perfAtualizar) { global._recebimentoOperacaoInternals?.carregar?.(true).then(() => _desenharRecebimentoTempos()).catch(e => global.showToast?.('Erro ao atualizar performance: ' + (e.message || e), 'error')); }
    const kpi = event.target.closest('[data-reb-kpi-status]');
    if (kpi) global.recopAbrirComFiltro?.({ status: kpi.getAttribute('data-reb-kpi-status') || '', hoje: kpi.getAttribute('data-reb-kpi-hoje') === '1' });
  });
  document.addEventListener('change', function (event) {
    if (event.target.id === 'reb-f-periodo') { _filtroDashPeriodo = event.target.value || ''; _desenhar(); }
    if (event.target.id === 'reb-f-categoria') { _filtroDashCategoria = event.target.value || ''; _desenhar(); }
    if (event.target.id === 'rebperf-mes') { _filtroPerfMes = event.target.value || ''; _desenharRecebimentoTempos(); }
  });
})(window);
