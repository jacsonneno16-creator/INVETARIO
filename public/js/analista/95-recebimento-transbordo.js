// Recebimento — Transbordo Matriz → Filial (fase 15/FASE 3). Reaproveita
// TODA a máquina de estados, cálculo de tempo e auditoria de
// 93-recebimento-operacao.js (mesma coleção `recebimentos`, tipo:
// 'TRANSBORDO') — só adiciona o passo de saída/QR que fornecedor não tem
// (seção 15: "Matriz gera carga → QR acompanha motorista → Filial bipa
// chegada → ..."). QR gerado com a lib vendorizada
// public/vendor/qrcode-generator-2.0.4 (não existia nenhuma no projeto —
// mapeado na fase 1 do coletor).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const fmtMin = m => m == null ? '—' : (m >= 60 ? (m / 60).toFixed(1) + 'h' : Math.round(m) + 'min');
  // Datas do Firestore ficam em ISO/UTC. Exibir com Date evita mostrar +3h no Brasil
  // quando o Analista informa um horário em <input type="datetime-local">.
  const _dtValida = iso => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  const fmtHora = iso => { const d = _dtValida(iso); return d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'; };
  const fmtData = iso => { const d = _dtValida(iso); return d ? d.toLocaleDateString('pt-BR') : '—'; };
  const dataLocalChave = iso => { const d = _dtValida(iso); return d ? d.toLocaleDateString('en-CA') : ''; };
  const COL_IDENTIFICADORES = 'recebimento_identificadores';
  const COL_OBSERVACOES_TRANSBORDO = 'recebimento_observacoes_transbordo';

  function fs() { return global.getDTFirestore(); }
  function opInternals() { return global._recebimentoOperacaoInternals; }
  // BUG AO VIVO REAL (achado pelo usuário direto no painel, não suposição):
  // esta função tinha sua PRÓPRIA cópia do mesmo erro já corrigido em
  // 93-recebimento-operacao.js (_deduplicarRecebimentos) — agrupava por
  // `identificadorCodigo`, que é o QR FIXO POR MOTORISTA (o mesmo motorista
  // reaproveita o mesmo código em toda viagem, de propósito). Duas viagens
  // DIFERENTES do mesmo motorista (documentos distintos, horários
  // diferentes) colidiam na mesma chave, e só a mais recente sobrevivia —
  // a mais antiga (mesmo ainda EM_TRANSITO) sumia da tela de Transbordo
  // inteira. A identidade real de uma carga é sempre loja+documento, nunca
  // o código do motorista — corrigir aqui TAMBÉM era necessário porque
  // esta função roda DEPOIS da de 93, então repetia o mesmo erro mesmo com
  // a lista de 93 já correta.
  function transbordos() {
    const vistos = new Set();
    return (opInternals()?.recebimentos?.() || []).filter(r => r.tipo === 'TRANSBORDO').filter(r => {
      const chave = String(r._lojaId || '') + ':' + String(r._id || '');
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  }
  const charts = [];
  function _destruirGraficosTransbordo() { while (charts.length) charts.pop().destroy(); }

  function _gerarCodigo() {
    return 'TRB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  function _gerarQrDataUrl(texto) {
    if (typeof global.qrcode !== 'function') return null;
    try {
      const qr = global.qrcode(0, 'M');
      qr.addData(texto);
      qr.make();
      return qr.createDataURL(6, 8);
    } catch (e) { return null; }
  }

  // Funções de QR usadas abaixo e exportadas no final do módulo. Elas tinham
  // sido removidas acidentalmente em uma atualização anterior, deixando uma
  // referência a `_mostrarQr` no final do arquivo. Isso gerava ReferenceError
  // durante o carregamento e impedia TODOS os listeners de clique definidos
  // depois daquela linha de serem registrados.
  function _mostrarQr(codigo, titulo) {
    const dataUrl = _gerarQrDataUrl(codigo);
    const tituloEl = document.getElementById('rebt-qr-titulo');
    const codigoEl = document.getElementById('rebt-qr-codigo');
    const img = document.getElementById('rebt-qr-img');
    if (tituloEl) tituloEl.textContent = titulo || codigo;
    if (codigoEl) codigoEl.textContent = codigo;
    if (img) img.src = dataUrl || '';
    const modal = document.getElementById('modal-rebt-qr');
    if (modal) modal.classList.add('open');
  }
  function recbtVerQrRecebimento(recebimentoId) {
    const r = transbordos().find(x => x._id === recebimentoId);
    if (r?.identificadorCodigo) _mostrarQr(r.identificadorCodigo, (r.origem || '') + ' → ' + (r.destino || ''));
  }

  let _identificadores = [];
  let _observacoesTransbordo = [];
  let _carregado = false;
  let _ouvinteRegistrado = false;
  // Período com início E fim (pedido ao vivo do usuário: "eu posso escolher
  // só um dia, eu posso escolher uma semana" — o antigo filtro de mês único
  // não deixava escolher um intervalo livre). 'AAAA-MM-DD' — vazio de
  // qualquer um dos dois lados = sem limite naquela ponta.
  let _filtroDataInicio = '';
  let _filtroDataFim = '';

  async function _carregarIdentificadores(forcar) {
    if (_carregado && !forcar) return;
    const snap = await fs().collection(COL_IDENTIFICADORES).get();
    _identificadores = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    _carregado = true;
  }

  async function _carregarObservacoesTransbordo() {
    const snap = await fs().collection(COL_OBSERVACOES_TRANSBORDO).get();
    _observacoesTransbordo = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a,b) => String(a.texto || '').localeCompare(String(b.texto || ''), 'pt-BR'));
    return _observacoesTransbordo;
  }
  function _normalizarTextoObs(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
  async function recbtCadastrarObservacao() {
    const input = document.getElementById('rebt-obs-cadastro');
    const texto = _normalizarTextoObs(input?.value);
    if (!texto) { global.showToast?.('Digite a observação que deseja cadastrar.', 'error'); return; }
    if (_observacoesTransbordo.some(o => _normalizarTextoObs(o.texto).toLocaleLowerCase('pt-BR') === texto.toLocaleLowerCase('pt-BR'))) {
      global.showToast?.('Essa observação já está cadastrada.', 'i'); return;
    }
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    try {
      await fs().collection(COL_OBSERVACOES_TRANSBORDO).add({ texto, ativa: true, criadoEm: agora, criadoPor: autor, atualizadoEm: agora, atualizadoPor: autor });
      if (input) input.value = '';
      await _carregarObservacoesTransbordo();
      _desenharTransbordo();
      global.showToast?.('Observação cadastrada e disponível no Coletor.', 'success');
    } catch (e) { global.showToast?.('Erro ao cadastrar observação: ' + (e?.message || e), 'error'); }
  }
  async function recbtExcluirObservacao(id) {
    const item = _observacoesTransbordo.find(o => o._id === id);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_OBSERVACOES_TRANSBORDO).doc(id).delete();
        await _carregarObservacoesTransbordo();
        _desenharTransbordo();
        global.showToast?.('Observação removida do cadastro.', 'success');
      } catch (e) { global.showToast?.('Erro ao excluir observação: ' + (e?.message || e), 'error'); }
    };
    const msg = 'Excluir a observação “' + (item.texto || '') + '”? Cargas antigas que já usaram essa observação continuam com o texto salvo.';
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Excluir observação', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm(msg)) executar();
  }

  async function renderRecebimentoTransbordo() {
    const pagina = document.getElementById('page-recebimento-transbordo');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    // Pedido ao vivo do usuário: a tela de Transbordo passa a mostrar SÓ os
    // transbordos gerados pelo nosso próprio sistema (Coletor) — nada de
    // importação/cruzamento com a Bluesoft aqui. O Coletor já registra
    // motorista, nota, e cada horário da linha do tempo sozinho.
    // force=true — mesmo motivo do renderRecebimentoOperacao() (93): o
    // canal de tempo real do Firestore (onSnapshot) caindo na rede do
    // usuário (confirmado no console dele: ERR_CONNECTION_CLOSED/504/erro
    // de transporte no stream 'Listen') deixava a tela congelada na
    // última leitura bem-sucedida, sem nenhum jeito de se recuperar sozinha
    // — nem F5 ajudava, porque a mesma instabilidade se repetia na hora. Um
    // `.get()` único aqui garante dado fresco toda vez que a tela abre,
    // independente da saúde da conexão em tempo real.
    try { await Promise.all([opInternals()?.carregar?.(true), _carregarIdentificadores(), _carregarObservacoesTransbordo()]); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    if (!_ouvinteRegistrado) { opInternals()?.onMudanca?.(() => _desenharTransbordo()); _ouvinteRegistrado = true; }
    _desenharTransbordo();
  }

  // Extraído pra ser reaproveitado pelo "Apagar todos" (pedido ao vivo do
  // usuário: cargas de teste) — o botão apaga exatamente o que a tela está
  // mostrando no momento, respeitando o filtro de data ativo (limpar o
  // filtro antes = apagar tudo; deixar só um dia selecionado = apagar só
  // aquele dia).
  function _transbordosFiltrados() {
    return transbordos()
      .filter(r => {
        const dia = dataLocalChave(r.horaSaida || r.criadoEm);
        return (!_filtroDataInicio || dia >= _filtroDataInicio) && (!_filtroDataFim || dia <= _filtroDataFim);
      })
      .sort((a, b) => String(b.horaSaida || b.criadoEm || '').localeCompare(String(a.horaSaida || a.criadoEm || '')));
  }

  function _desenharTransbordo() {
    const pagina = document.getElementById('page-recebimento-transbordo');
    if (!pagina) return;
    const i = opInternals();
    const linhas = _transbordosFiltrados();
    const media = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    const hojeArr = linhas.filter(r => i?.ehHoje?.(r.horaSaida || r.criadoEm));
    const previstos = linhas.filter(r => r.status === 'PREVISTO');
    const emTransito = linhas.filter(r => r.status === 'EM_TRANSITO');
    const aguardandoDescarga = linhas.filter(r => ['CHEGOU', 'AGUARDANDO_DOCA'].includes(r.status));
    const emDescarga = linhas.filter(r => r.status === 'EM_DESCARGA');
    const finalizados = linhas.filter(r => r.status === 'FINALIZADO');
    const atrasados = linhas.filter(r => r.status === 'ATRASADO');
    const cancelados = linhas.filter(r => r.status === 'CANCELADO');
    const tempoMedioViagem = media(linhas.map(r => r.tempoViagemMin).filter(v => v != null));
    const tempoMedioEspera = media(linhas.map(r => r.tempoEsperaMin).filter(v => v != null));
    const tempoMedioDescarga = media(linhas.map(r => r.tempoDescargaMin).filter(v => v != null));
    const tempoMedioTotal = media(linhas.map(r => r.tempoTotalMin).filter(v => v != null));
    const volumes = linhas.reduce((s, r) => s + n(r.volumes), 0);
    const veiculosDistintos = new Set(linhas.map(r => r.placa).filter(Boolean)).size;
    const motoristasDistintos = new Set(linhas.map(r => r.motoristaNome).filter(Boolean)).size;

    // ── Tempo médio por dia (últimos 14 dias com dado), só Transbordo ──
    const porDia = new Map();
    linhas.forEach(r => {
      const dia = dataLocalChave(r.horaSaida || r.criadoEm);
      if (!dia) return;
      const acc = porDia.get(dia) || { viagem: [], espera: [], descarga: [], total: [] };
      if (r.tempoViagemMin != null) acc.viagem.push(r.tempoViagemMin);
      if (r.tempoEsperaMin != null) acc.espera.push(r.tempoEsperaMin);
      if (r.tempoDescargaMin != null) acc.descarga.push(r.tempoDescargaMin);
      if (r.tempoTotalMin != null) acc.total.push(r.tempoTotalMin);
      porDia.set(dia, acc);
    });
    const dias = [...porDia.keys()].sort().slice(-14);

    // ── Ranking por motorista (quem mais viajou, tempo médio) ──
    const porMotorista = new Map();
    linhas.filter(r => r.motoristaNome).forEach(r => {
      const acc = porMotorista.get(r.motoristaNome) || { viagens: 0, totais: [] };
      acc.viagens++;
      if (r.tempoTotalMin != null) acc.totais.push(r.tempoTotalMin);
      porMotorista.set(r.motoristaNome, acc);
    });
    const rankingMotoristas = [...porMotorista.entries()]
      .map(([nome, acc]) => ({ nome, viagens: acc.viagens, tempoMedioTotal: media(acc.totais) }))
      .sort((a, b) => b.viagens - a.viagens);

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">🚛 Transbordo</div><div style="font-size:.74rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} transbordo(s) — remetente → destino (Coletor ou Analista)</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span style="font-size:.72rem;color:var(--muted)">De</span>
          <input type="date" class="field" id="rebt-f-data-inicio" value="${esc(_filtroDataInicio)}" style="max-width:150px" title="Data de início (dia da saída) — deixe em branco pra não limitar">
          <span style="font-size:.72rem;color:var(--muted)">até</span>
          <input type="date" class="field" id="rebt-f-data-fim" value="${esc(_filtroDataFim)}" style="max-width:150px" title="Data de fim (dia da saída) — deixe em branco pra não limitar">
          <button type="button" class="btn btn-ghost btn-sm" data-rebt-f-hoje="1" title="Filtrar só hoje">Hoje</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rebt-f-semana="1" title="Últimos 7 dias">7 dias</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rebt-f-limpar="1" title="Remover o filtro de data">Limpar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-rebt-atualizar="1" title="Buscar os dados mais recentes">↻ Atualizar</button>
          <button type="button" class="btn btn-danger btn-sm" data-rebt-excluir-todos="1" title="Apaga PRA SEMPRE todos os transbordos listados abaixo (respeita o filtro de data)">🗑️ Apagar todos</button>
          <button type="button" class="btn btn-primary btn-sm" data-rebt-novo="1">+ Novo Transbordo</button>
        </div>
      </div>
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${hojeArr.length}</div><div class="kpi-lbl">Transbordos hoje</div></div>
        <div class="kpi yellow"><div class="kpi-val">${emTransito.length}</div><div class="kpi-lbl">Em trânsito</div></div>
        <div class="kpi purple"><div class="kpi-val">${aguardandoDescarga.length}</div><div class="kpi-lbl">Aguardando descarga</div></div>
        <div class="kpi orange"><div class="kpi-val">${emDescarga.length}</div><div class="kpi-lbl">Em descarga</div></div>
        <div class="kpi green"><div class="kpi-val">${finalizados.length}</div><div class="kpi-lbl">Finalizados</div></div>
        <div class="kpi ${atrasados.length ? 'red' : 'green'}"><div class="kpi-val">${atrasados.length}</div><div class="kpi-lbl">Atrasados</div></div>
        <div class="kpi teal"><div class="kpi-val">${fmtMin(tempoMedioViagem)}</div><div class="kpi-lbl">Tempo médio de viagem</div></div>
        <div class="kpi blue"><div class="kpi-val">${fmtMin(tempoMedioEspera)}</div><div class="kpi-lbl">Tempo médio de espera</div></div>
        <div class="kpi purple"><div class="kpi-val">${fmtMin(tempoMedioDescarga)}</div><div class="kpi-lbl">Tempo médio de descarga</div></div>
        <div class="kpi teal"><div class="kpi-val">${fmtMin(tempoMedioTotal)}</div><div class="kpi-lbl">Tempo total</div></div>
        <div class="kpi lime"><div class="kpi-val">${volumes.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Volumes transportados</div></div>
        <div class="kpi orange"><div class="kpi-val">${veiculosDistintos}</div><div class="kpi-lbl">Veículos utilizados</div></div>
        <div class="kpi blue"><div class="kpi-val">${motoristasDistintos}</div><div class="kpi-lbl">Motoristas</div></div>
      </div>
      <div class="tc" style="padding:12px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <div><b>📝 Cadastro de observações do Coletor</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Cadastre as opções que aparecem na saída da carga. O preenchimento no Coletor é opcional.</div></div>
          <div style="font-size:.7rem;color:var(--muted)">${_observacoesTransbordo.length} cadastrada(s)</div>
        </div>
        <div style="display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:8px;margin-top:10px">
          <input class="field" id="rebt-obs-cadastro" placeholder="Ex.: Avaria na embalagem, carga urgente, palete misto..." maxlength="120">
          <button type="button" class="btn btn-primary btn-sm" data-rebt-obs-cadastrar="1">+ Cadastrar observação</button>
        </div>
        <input class="field" id="rebt-obs-filtro" placeholder="🔎 Pesquisar observações cadastradas" style="margin-top:8px">
        <div id="rebt-obs-lista" style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px">
          ${_observacoesTransbordo.length ? _observacoesTransbordo.map(o => `<span data-rebt-obs-item="1" data-rebt-obs-texto="${esc(String(o.texto || '').toLocaleLowerCase('pt-BR'))}" class="badge b-blue" style="display:inline-flex;align-items:center;gap:7px;padding:7px 9px;font-size:.72rem">${esc(o.texto || '—')}<button type="button" data-rebt-obs-excluir="${esc(o._id)}" title="Excluir observação" style="border:0;background:transparent;color:inherit;cursor:pointer;font-size:.95rem;line-height:1;padding:0">×</button></span>`).join('') : '<span style="font-size:.76rem;color:var(--muted)">Nenhuma observação cadastrada ainda.</span>'}
        </div>
      </div>
      <div style="margin:6px 0 10px"><b style="font-size:.92rem">📊 Análise</b></div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:14px">
        <div class="tc" style="padding:12px"><b>📈 Tempo médio por dia (últimos 14 dias com dado)</b><div style="height:240px;margin-top:8px"><canvas id="rebt-graf-tempos"></canvas></div></div>
        <div class="tc" style="padding:12px"><b>🚛 Transbordos por status</b><div style="height:240px;margin-top:8px"><canvas id="rebt-graf-status"></canvas></div></div>
      </div>
      <div class="tc" style="padding:12px;margin-bottom:14px">
        <b>🧑‍✈️ Por motorista</b>
        <table class="dt-table" style="margin-top:8px"><thead><tr><th>Motorista</th><th>Viagens</th><th>Tempo médio total</th></tr></thead><tbody>
        ${rankingMotoristas.length ? rankingMotoristas.map(m => `<tr><td>${esc(m.nome)}</td><td>${m.viagens}</td><td>${fmtMin(m.tempoMedioTotal)}</td></tr>`).join('') : '<tr><td colspan="3">Sem motorista registrado ainda.</td></tr>'}
        </tbody></table>
      </div>
      <div class="tc"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Carga</th><th>Motorista</th><th>Placa</th><th>Nota Fiscal / Volume</th><th>Observação</th><th>Origem → Destino</th><th>Saída</th><th>Chegada</th><th>Descarga</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas.length ? linhas.map(r => {
          const st = i?.statusInfo?.(r.status) || { label: r.status, cor: 'b-gray' };
          const podeSaida = i?.podeRegistrarSaida?.(r);
          const podeChegada = i?.podeRegistrarChegadaTransbordo?.(r);
          const podeIniciar = i?.podeIniciarDescarga?.(r);
          const podeFimDescarga = i?.podeFinalizarDescarga?.(r);
          const podeFinal = i?.podeFinalizar?.(r);
          const podeCancelar = i?.podeCancelar?.(r);
          const podeVoltar = i?.podeVoltarEtapa?.(r);
          const detalhesNf = Array.isArray(r.notasVolumesTransferencia) ? r.notasVolumesTransferencia : [];
          const tagNf = detalhesNf.length ? detalhesNf.map(x => esc(x.numero || '—') + ' <span style="color:var(--muted);font-size:.65rem">(' + (Number(x.volumes) || 0) + ' vol)</span>').join('<br>') : (r.notaFiscalTransferencia ? esc(r.notaFiscalTransferencia) + (Number(r.volumes) ? ' <span style="color:var(--muted);font-size:.65rem">(' + Number(r.volumes) + ' vol)</span>' : '') : '<span style="color:var(--muted)">—</span>');
          return `<tr>
            <td class="mono">${esc(r.identificadorCodigo || '—')}</td>
            <td>${esc(r.motoristaNome || '—')}</td>
            <td class="mono">${esc(r.placa || '—')}</td>
            <td class="mono">${tagNf}</td>
            <td style="max-width:220px;white-space:normal">${r.observacao ? esc(r.observacao) : '<span style="color:var(--muted)">—</span>'}</td>
            <td>${esc(r.origem || '—')} → ${esc(r.destino || '—')}</td>
            <td>${fmtData(r.horaSaida)} ${fmtHora(r.horaSaida)}</td>
            <td>${fmtData(r.horaChegada)} ${fmtHora(r.horaChegada)}</td>
            <td>${fmtMin(r.tempoDescargaMin)}</td>
            <td><span class="badge ${st.cor}" style="font-size:.62rem">${esc(st.label)}</span></td>
            <td style="white-space:nowrap">
              ${podeSaida ? `<button type="button" class="btn btn-ghost btn-sm" data-rebt-saida="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">🚚 Registrar saída</button>` : ''}
              ${podeChegada ? `<button type="button" class="btn btn-ghost btn-sm" data-rebt-chegada="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">📍 Registrar chegada</button>` : ''}
              ${podeIniciar ? `<button type="button" class="btn btn-ghost btn-sm" data-rebt-iniciar="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">▶ Iniciar descarga</button>` : ''}
              ${podeFimDescarga ? `<button type="button" class="btn btn-ghost btn-sm" data-rebt-fim-descarga="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">⏹ Finalizar descarga</button>` : ''}
              ${podeFinal ? `<button type="button" class="btn btn-primary btn-sm" data-rebt-finalizar="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">✅ Finalizar</button>` : ''}
              ${podeVoltar ? `<button type="button" class="btn btn-ghost btn-sm" title="Corrige um bip errado, sem apagar o resto do registro" data-rebt-voltar="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">⏪ Voltar etapa</button>` : ''}
              <button type="button" class="btn btn-ghost btn-sm" title="Corrigir remetente e destino sem alterar horários, status, notas ou volumes" data-rebt-corrigir-rota="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">⇄ Inverter lojas</button>
              <button type="button" class="acao-lapis" title="Editar horários, nota fiscal e volume — funciona em qualquer status, mesmo já finalizado pelo Coletor" data-rebt-editar-completo="${esc(r._id)}">✏️</button>
              ${r.identificadorCodigo ? `<button type="button" class="acao-lapis" title="Ver QR" data-rebt-ver-qr-recebimento="${esc(r._id)}">🔳</button>` : ''}
              ${podeCancelar ? `<button type="button" class="acao-lapis" title="Cancelar" data-rebt-cancelar="${esc(r._id)}">🗑️</button>` : ''}
              <button type="button" class="acao-lapis" title="Excluir definitivamente (funciona mesmo já finalizado/cancelado)" data-rebt-excluir="${esc(r._id)}">❌</button>
            </td>
          </tr>`;
        }).join('') : '<tr><td colspan="11"><div class="empty"><div class="empty-icon">🚛</div><div class="empty-title">Nenhum transbordo registrado</div><div class="empty-sub">Clique em "+ Novo Transbordo" para criar uma carga pelo Analista ou gere pelo Coletor.</div></div></td></tr>'}</tbody>
      </table></div></div>`;
    _vincularBotoesCriticosTransbordo();
    global.aplicarPermissoesAnalista?.();

    _destruirGraficosTransbordo();
    if (global.Chart) {
      const ctxTempos = document.getElementById('rebt-graf-tempos');
      if (ctxTempos) {
        charts.push(new global.Chart(ctxTempos, {
          type: 'bar',
          data: {
            labels: dias,
            datasets: [
              { label: 'Viagem', data: dias.map(d => media(porDia.get(d)?.viagem)), backgroundColor: '#14b8a6' },
              { label: 'Espera', data: dias.map(d => media(porDia.get(d)?.espera)), backgroundColor: '#3b82f6' },
              { label: 'Descarga', data: dias.map(d => media(porDia.get(d)?.descarga)), backgroundColor: '#8b5cf6' },
              { label: 'Total', data: dias.map(d => media(porDia.get(d)?.total)), backgroundColor: '#f59e0b' },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
        }));
      }
      const ctxStatus = document.getElementById('rebt-graf-status');
      if (ctxStatus) {
        const dadosStatus = [
          { label: 'Previsto', valor: previstos.length, cor: '#6b7280' },
          { label: 'Em trânsito', valor: emTransito.length, cor: '#eab308' },
          { label: 'Aguardando descarga', valor: aguardandoDescarga.length, cor: '#a855f7' },
          { label: 'Em descarga', valor: emDescarga.length, cor: '#f97316' },
          { label: 'Finalizado', valor: finalizados.length, cor: '#22c55e' },
          { label: 'Atrasado', valor: atrasados.length, cor: '#ef4444' },
          { label: 'Cancelado', valor: cancelados.length, cor: '#374151' },
        ].filter(x => x.valor > 0);
        charts.push(new global.Chart(ctxStatus, {
          type: 'doughnut',
          data: { labels: dadosStatus.map(x => x.label), datasets: [{ data: dadosStatus.map(x => x.valor), backgroundColor: dadosStatus.map(x => x.cor) }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } },
        }));
      }
    }
  }

  // Liga os dois botões críticos DIRETAMENTE aos elementos recém-renderizados.
  // Não depende de onclick inline nem de delegação no document. Isso evita
  // interferência de CSP, stopPropagation e outros listeners do Analista.
  function _vincularBotoesCriticosTransbordo() {
    const novo = document.querySelector('[data-rebt-novo]');
    if (novo && !novo.dataset.rebtBound) {
      novo.dataset.rebtBound = '1';
      novo.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        Promise.resolve(recbtNovo()).catch(err => {
          console.error('[Transbordo] Falha ao abrir Novo Transbordo', err);
          const msg = 'Falha ao abrir Novo Transbordo: ' + (err?.message || err);
          if (global.showToast) global.showToast(msg, 'error'); else global.alert?.(msg);
        });
      });
    }
    document.querySelectorAll('[data-rebt-corrigir-rota]').forEach(btn => {
      if (btn.dataset.rebtBound) return;
      btn.dataset.rebtBound = '1';
      btn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        const id = btn.getAttribute('data-rebt-corrigir-rota');
        Promise.resolve(recbtInverterRotaDireto(id)).catch(err => {
          console.error('[Transbordo] Falha no botão Inverter lojas', err);
          const msg = 'Falha ao inverter lojas: ' + (err?.message || err);
          if (global.showToast) global.showToast(msg, 'error'); else global.alert?.(msg);
        });
      });
    });
  }

  // ── "+ Novo Transbordo" — criação manual pelo Analista ─────────────
  // O Analista pode escolher remetente/destino e informar toda a linha do
  // tempo. O documento é salvo fisicamente na loja REMETENTE para manter o
  // mesmo contrato do Coletor e das consultas cross-loja.
  let _lojasParaDestino = [];
  let _todasLojasNovoTransbordo = [];

  function _optionLojasNovo(lojas, selecionada) {
    return '<option value="">— Selecionar —</option>' + lojas.map(l => `<option value="${esc(l.id)}"${String(l.id) === String(selecionada || '') ? ' selected' : ''}>${esc(l.nome || l.id)}</option>`).join('');
  }
  // BUG AO VIVO REAL (relatado pelo usuário: "na hora de colocar a hora tem
  // que ficar arrastando lá... é mais fácil a hora ser digitada") — o campo
  // único `type="datetime-local"` embute um seletor de hora que em vários
  // navegadores exige arrastar/rolar em vez de digitar direto. Substituído
  // por DOIS campos comuns (`type="date"` + `type="time"`), que aceitam
  // digitação normal — combinados aqui na hora de ler o valor.
  function _valorDataHoraCombinada(prefixo) {
    const data = String(document.getElementById(prefixo + '-data')?.value || '').trim();
    if (!data) return null;
    const hora = String(document.getElementById(prefixo + '-hora')?.value || '').trim() || '00:00';
    const dt = new Date(data + 'T' + hora + ':00');
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  // Caminho inverso — preenche os dois campos a partir de um ISO já salvo
  // (edição de uma carga existente). '' limpa os dois campos.
  function _preencherDataHora(prefixo, iso) {
    const elData = document.getElementById(prefixo + '-data'), elHora = document.getElementById(prefixo + '-hora');
    const d = _dtValida(iso);
    if (elData) elData.value = d ? d.toLocaleDateString('en-CA') : '';
    if (elHora) elHora.value = d ? d.toTimeString().slice(0, 5) : '';
  }
  // [sufixo-do-id, rótulo, campo no documento do Firestore]
  const _HORARIOS_TRANSBORDO = [
    ['saida', 'Saída', 'horaSaida'], ['chegada', 'Chegada', 'horaChegada'],
    ['inicio-descarga', 'Início da descarga', 'horaInicioDescarga'],
    ['fim-descarga', 'Fim da descarga', 'horaFimDescarga'],
    ['fechamento', 'Fechamento / finalização', 'horaFechamentoRecebimento'],
  ];
  function _minEntre(a, b) {
    if (!a || !b) return null;
    const v = Math.round((new Date(b) - new Date(a)) / 60000);
    return Number.isFinite(v) ? v : null;
  }
  function _statusPorHorarios(h) {
    if (h.horaFechamentoRecebimento) return 'FINALIZADO';
    if (h.horaFimDescarga) return 'DESCARGA_FINALIZADA';
    if (h.horaInicioDescarga) return 'EM_DESCARGA';
    if (h.horaChegada) return 'CHEGOU';
    if (h.horaSaida) return 'EM_TRANSITO';
    return 'PREVISTO';
  }
  function _validarHorariosNovo(h) {
    const seq = [
      ['Saída', h.horaSaida],
      ['Chegada', h.horaChegada],
      ['Início da descarga', h.horaInicioDescarga],
      ['Fim da descarga', h.horaFimDescarga],
      ['Fechamento', h.horaFechamentoRecebimento],
    ];
    // Não deixa uma etapa posterior existir sem a anterior. Isso evita
    // criar registros impossíveis e protege os cards de tempo/performance.
    let encontrouVazio = false;
    for (const [rotulo, valor] of seq) {
      if (!valor) { encontrouVazio = true; continue; }
      if (encontrouVazio) return `Preencha as etapas anteriores antes de informar “${rotulo}”.`;
    }
    for (let idx = 1; idx < seq.length; idx++) {
      const ant = seq[idx - 1][1], atual = seq[idx][1];
      if (ant && atual && new Date(atual) < new Date(ant)) return `${seq[idx][0]} não pode ser anterior a ${seq[idx - 1][0].toLowerCase()}.`;
    }
    return '';
  }
  function _atualizarResumoHorariosNovo() {
    const el = document.getElementById('rebt-horarios-status');
    if (!el) return;
    const h = {
      horaSaida: _valorDataHoraCombinada('rebt-hora-saida'),
      horaChegada: _valorDataHoraCombinada('rebt-hora-chegada'),
      horaInicioDescarga: _valorDataHoraCombinada('rebt-hora-inicio-descarga'),
      horaFimDescarga: _valorDataHoraCombinada('rebt-hora-fim-descarga'),
      horaFechamentoRecebimento: _valorDataHoraCombinada('rebt-hora-fechamento'),
    };
    const erro = _validarHorariosNovo(h);
    if (erro) { el.textContent = erro; el.style.color = 'var(--danger,#ef4444)'; return; }
    const status = _statusPorHorarios(h);
    const info = opInternals()?.statusInfo?.(status) || { label: status };
    el.textContent = 'Status ao criar: ' + (info.label || status) + '. Os tempos serão calculados automaticamente.';
    el.style.color = 'var(--muted)';
  }
  function _atualizarDestinosNovo() {
    const origemId = String(document.getElementById('rebt-origem')?.value || '');
    const selDestino = document.getElementById('rebt-destino');
    const atual = String(selDestino?.value || '');
    _lojasParaDestino = _todasLojasNovoTransbordo.filter(l => String(l.id) !== origemId && l.ativa !== false);
    if (selDestino) {
      selDestino.innerHTML = _optionLojasNovo(_lojasParaDestino, _lojasParaDestino.some(l => String(l.id) === atual) ? atual : '');
    }
  }

  function _ensureNovoTransbordoModal() {
    let modal = document.getElementById('modal-rebt');
    if (modal) return modal;
    // Compatibilidade defensiva: se o HTML antigo continuar em cache, o JS
    // cria o modal sozinho. Assim o botão funciona mesmo antes do analista.html
    // novo entrar no navegador.
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-bg" id="modal-rebt"><div class="modal" style="max-width:720px">
<div class="modal-title">🚛 Novo Transbordo — Analista</div>
<div style="font-size:.76rem;color:var(--muted);margin:-2px 0 10px">Cadastre remetente, destino e, se necessário, os horários reais da operação.</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
<div class="form-group"><label>Remetente</label><select class="field" id="rebt-origem"><option value="">— Selecionar —</option></select></div>
<div class="form-group"><label>Destino</label><select class="field" id="rebt-destino"><option value="">— Selecionar —</option></select></div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
<div class="form-group"><label>Motorista</label><select class="field" id="rebt-motorista"></select></div>
<div class="form-group"><label>Veículo</label><select class="field" id="rebt-veiculo"></select></div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
<div class="form-group"><label>Volumes</label><input class="field" id="rebt-volumes" type="number" min="0"/></div>
<div class="form-group"><label>Responsável pelo envio</label><input class="field" id="rebt-responsavel-envio" placeholder="Nome"/></div>
</div>
<div class="form-group"><label>Nota(s) Fiscal(is) <span style="font-size:.68rem;font-weight:400;color:var(--muted)">(opcional — pode informar mais de uma)</span></label>
<div id="rebt-nf-novo-lista" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
<div style="display:flex;gap:8px">
<input class="field" id="rebt-nf-novo-numero" placeholder="Ex.: 123456" autocomplete="off" style="flex:1"/>
<button type="button" class="btn btn-ghost" onclick="adicionarNotaFiscalTransbordo('novo')" title="Adicionar outra nota fiscal">+</button>
</div>
<div id="rebt-nf-novo-status" style="font-size:.78rem;color:var(--muted);min-height:18px"></div>
</div>
<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:3px 0 10px;background:var(--surface-2,#f7f8fa)">
<div style="font-size:.78rem;font-weight:700;margin-bottom:8px">🕓 Horários da operação <span style="font-size:.68rem;font-weight:400;color:var(--muted)">(opcionais — data e hora digitáveis)</span></div>
<div class="form-group" style="margin:0 0 8px"><label>Saída</label><div style="display:flex;gap:6px"><input class="field" id="rebt-hora-saida-data" type="date" style="flex:1.3"/><input class="field" id="rebt-hora-saida-hora" type="time" style="flex:1"/></div></div>
<div class="form-group" style="margin:0 0 8px"><label>Chegada</label><div style="display:flex;gap:6px"><input class="field" id="rebt-hora-chegada-data" type="date" style="flex:1.3"/><input class="field" id="rebt-hora-chegada-hora" type="time" style="flex:1"/></div></div>
<div class="form-group" style="margin:0 0 8px"><label>Início da descarga</label><div style="display:flex;gap:6px"><input class="field" id="rebt-hora-inicio-descarga-data" type="date" style="flex:1.3"/><input class="field" id="rebt-hora-inicio-descarga-hora" type="time" style="flex:1"/></div></div>
<div class="form-group" style="margin:0 0 8px"><label>Fim da descarga</label><div style="display:flex;gap:6px"><input class="field" id="rebt-hora-fim-descarga-data" type="date" style="flex:1.3"/><input class="field" id="rebt-hora-fim-descarga-hora" type="time" style="flex:1"/></div></div>
<div class="form-group" style="margin:0"><label>Fechamento / finalização</label><div style="display:flex;gap:6px"><input class="field" id="rebt-hora-fechamento-data" type="date" style="flex:1.3"/><input class="field" id="rebt-hora-fechamento-hora" type="time" style="flex:1"/></div></div>
<div id="rebt-horarios-status" style="font-size:.7rem;color:var(--muted);margin-top:8px">Sem horários: o transbordo será criado como Previsto.</div>
</div>
<div class="form-group"><label>Observação</label><input class="field" id="rebt-observacao" placeholder="Opcional"/></div>
<div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="window.closeModal?closeModal('modal-rebt'):document.getElementById('modal-rebt').classList.remove('open')">Cancelar</button><button class="btn btn-primary" type="button" id="rebt-salvar" onclick="window.recbtSalvar()">Criar transbordo</button></div>
</div></div>`);
    return document.getElementById('modal-rebt');
  }

  async function recbtNovo() {
    const modal = _ensureNovoTransbordoModal();
    if (!modal) throw new Error('Modal de Novo Transbordo não foi encontrado nem pôde ser criado.');
    // Abre primeiro. Mesmo que algum cadastro auxiliar falhe, o usuário vê
    // o formulário e recebe uma mensagem explícita em vez de um botão morto.
    modal.classList.add('open');
    try {
      const i = opInternals();
      const origemAtiva = global.getDTLojaAtiva ? global.getDTLojaAtiva() : '';
      const selOrigem = document.getElementById('rebt-origem');
      const selDestino = document.getElementById('rebt-destino');
      if (selOrigem) selOrigem.innerHTML = '<option value="">Carregando...</option>';
      if (selDestino) selDestino.innerHTML = '<option value="">Carregando...</option>';
      const volumes = document.getElementById('rebt-volumes'); if (volumes) volumes.value = '';
      const resp = document.getElementById('rebt-responsavel-envio'); if (resp) resp.value = '';
      const obs = document.getElementById('rebt-observacao'); if (obs) obs.value = '';
      _HORARIOS_TRANSBORDO.forEach(([sufixo]) => _preencherDataHora('rebt-hora-' + sufixo, ''));
      const nfNovoNumero = document.getElementById('rebt-nf-novo-numero'); if (nfNovoNumero) nfNovoNumero.value = '';
      const nfNovoStatus = document.getElementById('rebt-nf-novo-status'); if (nfNovoStatus) nfNovoStatus.textContent = '';
      _notasFiscaisPorModo.novo = [];
      _redesenharListaNfTransbordo('novo');
      const selMot = document.getElementById('rebt-motorista');
      if (selMot) selMot.innerHTML = '<option value="">— Selecionar —</option>' + (i?.motoristas?.() || []).map(m => `<option value="${esc(m._id)}">${esc(m.nome)}</option>`).join('');
      const selVeic = document.getElementById('rebt-veiculo');
      if (selVeic) selVeic.innerHTML = '<option value="">— Selecionar —</option>' + (i?.veiculos?.() || []).map(v => `<option value="${esc(v._id)}">${esc(v.placa)} — ${esc(v.modelo || v.tipo || '')}</option>`).join('');
      try {
        const todasLojas = global.DTLoja ? await global.DTLoja.listar(false) : [];
        _todasLojasNovoTransbordo = (todasLojas || []).filter(l => l.ativa !== false);
        if (!_todasLojasNovoTransbordo.length) throw new Error('Nenhuma loja ativa foi encontrada.');
        if (selOrigem) selOrigem.innerHTML = _optionLojasNovo(_todasLojasNovoTransbordo, origemAtiva);
        _atualizarDestinosNovo();
      } catch (e) {
        console.error('[Transbordo] Falha ao carregar lojas no Novo Transbordo', e);
        _todasLojasNovoTransbordo = [];
        if (selOrigem) selOrigem.innerHTML = '<option value="">Falha ao carregar lojas</option>';
        if (selDestino) selDestino.innerHTML = '<option value="">Falha ao carregar lojas</option>';
        const msg = 'O formulário abriu, mas não foi possível carregar as lojas: ' + (e?.message || e);
        if (global.showToast) global.showToast(msg, 'error'); else global.alert?.(msg);
      }
      _atualizarResumoHorariosNovo();
    } catch (e) {
      console.error('[Transbordo] Erro ao preparar Novo Transbordo', e);
      const msg = 'O formulário abriu, mas houve erro ao preparar os campos: ' + (e?.message || e);
      if (global.showToast) global.showToast(msg, 'error'); else global.alert?.(msg);
    }
  }

  async function recbtSalvar() {
    const origemLojaId = String(document.getElementById('rebt-origem')?.value || '').trim();
    const destinoLojaId = String(document.getElementById('rebt-destino')?.value || '').trim();
    if (!origemLojaId || !destinoLojaId) { global.showToast?.('Selecione remetente e destino.', 'error'); return; }
    if (origemLojaId === destinoLojaId) { global.showToast?.('Remetente e destino precisam ser lojas diferentes.', 'error'); return; }
    const origemLoja = _todasLojasNovoTransbordo.find(l => String(l.id) === origemLojaId);
    const destinoLoja = _todasLojasNovoTransbordo.find(l => String(l.id) === destinoLojaId);
    if (!origemLoja || !destinoLoja) { global.showToast?.('Loja inválida. Feche e abra o cadastro novamente.', 'error'); return; }

    const horarios = {
      horaSaida: _valorDataHoraCombinada('rebt-hora-saida'),
      horaChegada: _valorDataHoraCombinada('rebt-hora-chegada'),
      horaInicioDescarga: _valorDataHoraCombinada('rebt-hora-inicio-descarga'),
      horaFimDescarga: _valorDataHoraCombinada('rebt-hora-fim-descarga'),
      horaFechamentoRecebimento: _valorDataHoraCombinada('rebt-hora-fechamento'),
    };
    const erroHorarios = _validarHorariosNovo(horarios);
    if (erroHorarios) { global.showToast?.(erroHorarios, 'error'); return; }

    const i = opInternals();
    const motoristaId = document.getElementById('rebt-motorista').value || '';
    const veiculoId = document.getElementById('rebt-veiculo').value || '';
    const motorista = (i?.motoristas?.() || []).find(m => m._id === motoristaId);
    const veiculo = (i?.veiculos?.() || []).find(v => v._id === veiculoId);
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    const codigo = _gerarCodigo();
    const status = _statusPorHorarios(horarios);
    const origem = origemLoja.nome || origemLoja.id;
    const destino = destinoLoja.nome || destinoLoja.id;
    // Pedido ao vivo do usuário: "lá não tem o espaço pra mim colocar a
    // nota... tem que ter a opção pra colocar mais de uma nota" — mesmo
    // padrão de lista+"+" já usado na Nota Fiscal de saída/chegada; o texto
    // ainda digitado (não adicionado com o "+") entra também, mesmo cuidado
    // de lá.
    const restanteNfNovo = String(document.getElementById('rebt-nf-novo-numero')?.value || '').trim();
    if (restanteNfNovo && !_listaNfEmEdicao('novo').includes(restanteNfNovo)) _listaNfEmEdicao('novo').push(restanteNfNovo);
    const notaFiscalTransferencia = _listaNfEmEdicao('novo').length ? _juntarNotasFiscais(_listaNfEmEdicao('novo')) : null;
    const payload = {
      tipo: 'TRANSBORDO', status,
      origem, origemLojaId, destino, destinoLojaId,
      motoristaId, motoristaNome: motorista?.nome || '', veiculoId, placa: veiculo?.placa || '',
      transportadora: motorista?.transportadora || veiculo?.transportadora || '',
      volumes: Number(document.getElementById('rebt-volumes').value) || 0,
      responsavelEnvio: String(document.getElementById('rebt-responsavel-envio').value || '').trim(),
      identificadorCodigo: codigo, observacao: String(document.getElementById('rebt-observacao').value || '').trim(),
      responsavel: autor, criadoEm: agora, criadoPor: autor, atualizadoEm: agora, atualizadoPor: autor,
      ...horarios,
      notaFiscalTransferencia, notasVolumesTransferencia: null,
      notaFiscalConfirmadaEm: null, notaFiscalConfirmadaPor: null,
    };
    // Mesmo cálculo oficial de 93-recebimento-operacao.js; assim os cards
    // de Transbordo e Tempos/Performance recebem os números corretos já na
    // criação manual.
    const tempos = i?.recalcularTempos ? i.recalcularTempos(payload) : {
      tempoViagemMin: _minEntre(payload.horaSaida, payload.horaChegada),
      tempoEsperaMin: _minEntre(payload.horaChegada, payload.horaInicioDescarga),
      tempoDescargaMin: _minEntre(payload.horaInicioDescarga, payload.horaFimDescarga),
      tempoTotalMin: _minEntre(payload.horaChegada, payload.horaFimDescarga),
      tempoAteFechamentoMin: _minEntre(payload.horaChegada, payload.horaFechamentoRecebimento),
    };
    Object.assign(payload, tempos);

    const btn = document.getElementById('rebt-salvar');
    const antigo = btn?.innerHTML || 'Criar transbordo';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Criando...'; }
    try {
      const raw = typeof global.getDTRawFirestore === 'function' ? global.getDTRawFirestore() : null;
      if (!raw) throw new Error('Firestore indisponível.');
      // O documento sempre mora na loja remetente, mesmo que o Analista
      // esteja visualizando outra loja no momento do cadastro.
      const recCol = raw.collection('lojas').doc(origemLojaId).collection('recebimentos');
      const ref = await recCol.add(payload);

      // O QR é auxiliar. Se o usuário não tiver permissão de QR na loja
      // remetente, o transbordo manual continua válido; só mostramos aviso.
      let qrRegistrado = false;
      try {
        await raw.collection('lojas').doc(origemLojaId).collection(COL_IDENTIFICADORES).add({
          codigo, tipo: 'TRANSBORDO', recebimentoId: ref.id, motoristaNome: motorista?.nome || '', placa: veiculo?.placa || '',
          origem, destino, transportadora: payload.transportadora, observacao: payload.observacao,
          status: status === 'FINALIZADO' ? 'FINALIZADO' : 'EM_USO', criadoEm: agora, criadoPor: autor,
        });
        qrRegistrado = true;
      } catch (eQr) { console.warn('[Transbordo] Criado sem registro auxiliar de QR:', eQr?.message || eQr); }

      global.closeModal?.('modal-rebt');
      await Promise.all([i?.carregar?.(true), _carregarIdentificadores(true).catch(() => null)]);
      _desenharTransbordo();
      if (qrRegistrado) _mostrarQr(codigo, 'Transbordo ' + origem + ' → ' + destino);
      global.showToast?.('Transbordo criado' + (horarios.horaSaida ? ' com horários informados' : '') + (qrRegistrado ? ' e QR gerado.' : '. QR não disponível para esta loja.'), 'success');
    } catch (e) {
      const traduzido = typeof global.traduzirErroPermissao === 'function' ? global.traduzirErroPermissao(e, { acao: 'criar transbordo manual' }) : null;
      global.showToast?.(traduzido || ('Erro ao criar transbordo: ' + (e?.message || e)), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = antigo; }
    }
  }

  // ── Correção de remetente/destino pelo Analista ───────────────────────
  // Ajusta SOMENTE os quatro campos da rota. Horários, status, NF, volumes,
  // motorista e qualquer outro dado operacional permanecem intocados.
  // Isto cobre o caso comum em que o coletor foi aberto na loja errada e o
  // transbordo acabou salvo como Filial → Matriz quando deveria ser
  // Matriz → Filial.
  let _rotaEdicaoId = '';
  let _lojasEdicaoRota = [];

  function _optionLojasRota(lojas) {
    return '<option value="">— Selecionar —</option>' + lojas.map(l => `<option value="${esc(l.id)}">${esc(l.nome || l.id)}</option>`).join('');
  }

  async function recbtInverterRotaDireto(id) {
    const r = transbordos().find(x => x._id === id);
    if (!r) { global.showToast?.('Transbordo não encontrado.', 'error'); return; }
    const confirmar = global.confirm ? global.confirm(`Inverter remetente e destino?\n\n${r.origem || '—'} → ${r.destino || '—'}\n\nNenhum horário ou outro dado será alterado.`) : true;
    if (!confirmar) return;
    let origemLojaId = String(r.origemLojaId || r._lojaId || '').trim();
    let destinoLojaId = String(r.destinoLojaId || '').trim();
    let origemNome = String(r.origem || '').trim();
    let destinoNome = String(r.destino || '').trim();
    // Em registros antigos o destinoLojaId pode não existir. Tenta descobrir
    // pelo cadastro de lojas, mas a inversão não depende do modal.
    if (!destinoLojaId || !origemLojaId) {
      try {
        const lojas = global.DTLoja ? await global.DTLoja.listar(false) : [];
        const norm = v => String(v || '').trim().toLocaleLowerCase('pt-BR');
        const achar = nome => lojas.find(l => norm(l.nome || l.id) === norm(nome));
        origemLojaId = origemLojaId || String(achar(origemNome)?.id || '');
        destinoLojaId = destinoLojaId || String(achar(destinoNome)?.id || '');
      } catch (_) {}
    }
    if (!origemLojaId || !destinoLojaId) {
      global.showToast?.('Não consegui identificar o ID das duas lojas deste registro. Atualize a página e tente novamente.', 'error');
      return;
    }
    if (origemLojaId === destinoLojaId) { global.showToast?.('Remetente e destino estão com o mesmo ID de loja.', 'error'); return; }
    const lojaDocumento = String(r._lojaId || origemLojaId || '').trim();
    const raw = typeof global.getDTRawFirestore === 'function' ? global.getDTRawFirestore() : null;
    if (!raw || !lojaDocumento) { global.showToast?.('Firestore ou loja física do documento indisponível.', 'error'); return; }
    const patch = {
      origem: destinoNome || destinoLojaId,
      origemLojaId: destinoLojaId,
      destino: origemNome || origemLojaId,
      destinoLojaId: origemLojaId,
    };
    try {
      await raw.collection('lojas').doc(lojaDocumento).collection('recebimentos').doc(r._id).update(patch);
      await opInternals()?.carregar?.(true);
      _desenharTransbordo();
      global.showToast?.('Remetente e destino invertidos. Horários preservados.', 'success');
    } catch (e) {
      console.error('[Transbordo] Falha ao inverter lojas', e);
      const traduzido = typeof global.traduzirErroPermissao === 'function' ? global.traduzirErroPermissao(e, { acao: 'inverter remetente e destino' }) : null;
      const msg = traduzido || ('Erro ao inverter lojas: ' + (e?.message || e));
      if (global.showToast) global.showToast(msg, 'error'); else global.alert?.(msg);
    }
  }

  async function recbtAbrirCorrigirRota(id) {
    const r = transbordos().find(x => x._id === id);
    if (!r) { global.showToast?.('Transbordo não encontrado.', 'error'); return; }
    _rotaEdicaoId = id;
    const selOrigem = document.getElementById('rebt-edit-origem');
    const selDestino = document.getElementById('rebt-edit-destino');
    const info = document.getElementById('rebt-edit-rota-info');
    if (info) info.innerHTML = `<b>${esc(r.identificadorCodigo || 'Transbordo')}</b><br>${esc(r.origem || r.origemLojaId || '—')} → ${esc(r.destino || r.destinoLojaId || '—')}`;
    if (selOrigem) selOrigem.innerHTML = '<option value="">Carregando...</option>';
    if (selDestino) selDestino.innerHTML = '<option value="">Carregando...</option>';
    global.openModal?.('modal-rebt-editar-rota');
    try {
      const todas = global.DTLoja ? await global.DTLoja.listar(false) : [];
      _lojasEdicaoRota = todas.filter(l => l.ativa !== false);
      const opts = _optionLojasRota(_lojasEdicaoRota);
      if (selOrigem) selOrigem.innerHTML = opts;
      if (selDestino) selDestino.innerHTML = opts;
      const normalizaNomeLoja = v => String(v || '').trim().toLocaleLowerCase('pt-BR');
      const acharIdPorNome = nome => {
        const alvo = normalizaNomeLoja(nome);
        if (!alvo) return '';
        const achada = _lojasEdicaoRota.find(l => normalizaNomeLoja(l.nome || l.id) === alvo);
        return achada ? String(achada.id) : '';
      };
      const origemAtual = String(r.origemLojaId || acharIdPorNome(r.origem) || r._lojaId || '');
      const destinoAtual = String(r.destinoLojaId || acharIdPorNome(r.destino) || '');
      if (selOrigem) selOrigem.value = origemAtual;
      if (selDestino) selDestino.value = destinoAtual;
    } catch (e) {
      _lojasEdicaoRota = [];
      if (selOrigem) selOrigem.innerHTML = '<option value="">Falha ao carregar lojas</option>';
      if (selDestino) selDestino.innerHTML = '<option value="">Falha ao carregar lojas</option>';
      global.showToast?.('Não foi possível carregar as lojas: ' + (e?.message || e), 'error');
    }
  }

  async function recbtInverterRota() {
    const origem = document.getElementById('rebt-edit-origem');
    const destino = document.getElementById('rebt-edit-destino');
    if (!origem || !destino) return;

    // O botão de inversão agora EXECUTA a correção de verdade. Antes ele
    // apenas trocava os dois selects e ainda exigia clicar em "Salvar", o
    // que dava a impressão de que não tinha funcionado.
    const origemAntes = String(origem.value || '');
    const destinoAntes = String(destino.value || '');
    if (!origemAntes || !destinoAntes) {
      global.showToast?.('Não consegui identificar as duas lojas para inverter. Selecione remetente e destino e tente novamente.', 'error');
      return;
    }
    if (origemAntes === destinoAntes) {
      global.showToast?.('Remetente e destino são a mesma loja.', 'error');
      return;
    }

    origem.value = destinoAntes;
    destino.value = origemAntes;

    // Persiste imediatamente sem mexer em horários ou em nenhum outro dado.
    // recbtSalvarRota faz update somente dos quatro campos da rota.
    await recbtSalvarRota();
  }

  async function recbtSalvarRota() {
    const r = transbordos().find(x => x._id === _rotaEdicaoId);
    if (!r) { global.showToast?.('Transbordo não encontrado.', 'error'); return; }
    const origemLojaId = String(document.getElementById('rebt-edit-origem')?.value || '').trim();
    const destinoLojaId = String(document.getElementById('rebt-edit-destino')?.value || '').trim();
    if (!origemLojaId || !destinoLojaId) { global.showToast?.('Selecione remetente e destino.', 'error'); return; }
    if (origemLojaId === destinoLojaId) { global.showToast?.('Remetente e destino precisam ser lojas diferentes.', 'error'); return; }
    const origemLoja = _lojasEdicaoRota.find(l => String(l.id) === origemLojaId);
    const destinoLoja = _lojasEdicaoRota.find(l => String(l.id) === destinoLojaId);
    if (!origemLoja || !destinoLoja) { global.showToast?.('Loja inválida. Atualize e tente novamente.', 'error'); return; }

    const patch = {
      origem: origemLoja.nome || origemLoja.id,
      origemLojaId,
      destino: destinoLoja.nome || destinoLoja.id,
      destinoLojaId,
    };
    const igual = String(r.origemLojaId || r._lojaId || '') === origemLojaId && String(r.destinoLojaId || '') === destinoLojaId && String(r.origem || '') === String(patch.origem) && String(r.destino || '') === String(patch.destino);
    if (igual) { global.closeModal?.('modal-rebt-editar-rota'); return; }

    const btn = document.getElementById('rebt-edit-rota-salvar');
    const original = btn?.innerHTML || 'Salvar correção';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Salvando...'; }
    try {
      // Usa a loja FÍSICA em que o documento está armazenado (_lojaId).
      // Isso é importante justamente no caso de loja selecionada errada: o
      // caminho do Firestore continua sendo o original, mas os quatro campos
      // de rota passam a refletir a operação correta. Nenhum horário entra no
      // update abaixo.
      const lojaDocumento = String(r._lojaId || (global.getDTLojaAtiva ? global.getDTLojaAtiva() : ''));
      if (!lojaDocumento) throw new Error('Não foi possível identificar a loja em que o transbordo está salvo.');
      const raw = typeof global.getDTRawFirestore === 'function' ? global.getDTRawFirestore() : null;
      if (!raw) throw new Error('Firestore indisponível.');
      await raw.collection('lojas').doc(lojaDocumento).collection('recebimentos').doc(r._id).update(patch);
      global.closeModal?.('modal-rebt-editar-rota');
      await opInternals()?.carregar?.(true);
      _desenharTransbordo();
      global.showToast?.('Remetente e destino corrigidos. Horários e demais dados foram preservados.', 'success');
    } catch (e) {
      const traduzido = typeof global.traduzirErroPermissao === 'function' ? global.traduzirErroPermissao(e, { acao: 'corrigir remetente e destino do transbordo' }) : null;
      global.showToast?.(traduzido || ('Erro ao corrigir lojas: ' + (e?.message || e)), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
  }

  // ── Controle de Nota Fiscal (seção adicional) ───────────────────────────
  // Pedido ao vivo do usuário: "ter a opção de colocar mais de uma" — o
  // campo do banco (notaFiscalTransferencia) continua sendo UMA string só
  // (sem mexer em firestore.rules), as notas entram juntas nele separadas
  // por ", " — mesmo padrão do Coletor (22-recebimento.js), replicado aqui.
  // Estado por MODO (era só 'saida'/'chegada' até aqui, fixo por ternário) —
  // generalizado pra um mapa pra caber os dois modos novos ('novo': criação
  // manual do transbordo; 'editar': edição completa de uma carga já
  // existente, pedido ao vivo do usuário: "lá também tem que ter a opção
  // pra colocar mais de uma nota") sem duplicar toda a lógica de novo.
  // 'saida'/'chegada' continuam com os MESMOS ids de sempre (nenhum HTML
  // existente quebra); os dois novos seguem o mesmo padrão de nome.
  const _notasFiscaisPorModo = { saida: [], chegada: [], novo: [], editar: [] };
  function _juntarNotasFiscais(lista) { return lista.join(', '); }
  // Compara como CONJUNTO, não como string exata — quem confere na chegada
  // pode digitar as notas numa ordem diferente de quem registrou na saída.
  function _notasFiscaisIguais(a, b) {
    const normalizar = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean).sort();
    const na = normalizar(a), nb = normalizar(b);
    return na.length === nb.length && na.every((v, i) => v === nb[i]);
  }
  function _listaNfEmEdicao(modo) { return _notasFiscaisPorModo[modo] || (_notasFiscaisPorModo[modo] = []); }
  function _idListaNf(modo) { return 'rebt-nf-' + modo + '-lista'; }
  function _idNumeroNf(modo) { return 'rebt-nf-' + modo + '-numero'; }
  function _idStatusNf(modo) { return modo === 'chegada' ? 'rebt-nf-chegada-erro' : 'rebt-nf-' + modo + '-status'; }
  function _redesenharListaNfTransbordo(modo) {
    const listaEl = document.getElementById(_idListaNf(modo));
    if (!listaEl) return;
    listaEl.innerHTML = _listaNfEmEdicao(modo).map((nf, idx) => `<span class="badge b-blue" style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;font-size:.8rem">${esc(nf)} <button type="button" data-nf-remover="${idx}" data-nf-modo="${modo}" title="Remover" style="background:transparent;border:none;color:inherit;font-weight:700;cursor:pointer;padding:0;font-size:1rem;line-height:1">×</button></span>`).join('');
  }
  function adicionarNotaFiscalTransbordo(modo) {
    const input = document.getElementById(_idNumeroNf(modo));
    const status = document.getElementById(_idStatusNf(modo));
    const digitado = String(input?.value || '').trim();
    if (!digitado) return;
    const arr = _listaNfEmEdicao(modo);
    if (arr.includes(digitado)) { if (status) status.textContent = 'Essa nota já foi adicionada.'; if (input) { input.value = ''; input.focus(); } return; }
    arr.push(digitado);
    if (input) { input.value = ''; input.focus(); }
    if (status) status.textContent = '';
    _redesenharListaNfTransbordo(modo);
  }

  // Saída: exige o número da NF antes de concluir — vai junto com a mesma
  // escrita de status/horaSaida (recopRegistrarSaida já mescla `campos`).
  function recbtAbrirNfSaida(id) {
    document.getElementById('rebt-nf-saida-id').value = id;
    document.getElementById('rebt-nf-saida-numero').value = '';
    const status = document.getElementById('rebt-nf-saida-status');
    if (status) status.textContent = '';
    _notasFiscaisPorModo.saida = [];
    _redesenharListaNfTransbordo('saida');
    global.openModal?.('modal-rebt-nf-saida');
    setTimeout(() => document.getElementById('rebt-nf-saida-numero')?.focus(), 60);
  }
  async function recbtConfirmarNfSaida() {
    const id = document.getElementById('rebt-nf-saida-id').value;
    const input = document.getElementById('rebt-nf-saida-numero');
    const status = document.getElementById('rebt-nf-saida-status');
    // Texto ainda digitado (não adicionado com o "+") entra também — não
    // perde o que já foi digitado só por não ter tocado no botão.
    const restante = String(input?.value || '').trim();
    if (restante && !_listaNfEmEdicao('saida').includes(restante)) _listaNfEmEdicao('saida').push(restante);
    if (input) input.value = '';
    if (!_listaNfEmEdicao('saida').length) { global.showToast?.('Informe o número da Nota Fiscal.', 'error'); return; }
    _redesenharListaNfTransbordo('saida');
    const numero = _juntarNotasFiscais(_listaNfEmEdicao('saida'));
    await opInternals()?.registrarSaida?.(id, { notaFiscalTransferencia: numero });
    global.closeModal?.('modal-rebt-nf-saida');
  }

  // Chegada: mostra a NF registrada na saída e exige que o responsável
  // redigite pra confirmar — divergência bloqueia a chegada (não conclui
  // automaticamente, seção 2 do pedido). Mesma checagem que o Coletor faz
  // (22-recebimento.js), só que aqui é o Analista registrando manualmente.
  function recbtAbrirNfChegada(id) {
    const r = transbordos().find(x => x._id === id);
    document.getElementById('rebt-nf-chegada-id').value = id;
    document.getElementById('rebt-nf-chegada-registrada').textContent = r?.notaFiscalTransferencia || '—';
    document.getElementById('rebt-nf-chegada-numero').value = '';
    document.getElementById('rebt-nf-chegada-erro').textContent = '';
    _notasFiscaisPorModo.chegada = [];
    _redesenharListaNfTransbordo('chegada');
    global.openModal?.('modal-rebt-nf-chegada');
    setTimeout(() => document.getElementById('rebt-nf-chegada-numero')?.focus(), 60);
  }
  async function recbtConfirmarNfChegada() {
    const id = document.getElementById('rebt-nf-chegada-id').value;
    const input = document.getElementById('rebt-nf-chegada-numero');
    const erroEl = document.getElementById('rebt-nf-chegada-erro');
    const restante = String(input?.value || '').trim();
    if (restante && !_listaNfEmEdicao('chegada').includes(restante)) _listaNfEmEdicao('chegada').push(restante);
    if (input) input.value = '';
    if (!_listaNfEmEdicao('chegada').length) { if (erroEl) erroEl.textContent = 'Digite o número de pelo menos uma Nota Fiscal.'; return; }
    _redesenharListaNfTransbordo('chegada');
    const digitado = _juntarNotasFiscais(_listaNfEmEdicao('chegada'));
    const r = transbordos().find(x => x._id === id);
    const registrada = r?.notaFiscalTransferencia || '';
    if (!_notasFiscaisIguais(digitado, registrada)) {
      if (erroEl) erroEl.textContent = '❌ Não confere com a(s) Nota(s) Fiscal(is) da saída (' + (registrada || '—') + '). Confira e tente de novo.';
      // Limpa — digitar de novo é "começar do zero", não "somar em cima da tentativa errada" (ver mesmo cuidado no Coletor).
      _notasFiscaisPorModo.chegada = [];
      _redesenharListaNfTransbordo('chegada');
      return; // não conclui a chegada — fica no modal pro responsável tentar de novo
    }
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    await opInternals()?.registrarChegadaTransbordo?.(id, { notaFiscalConfirmadaEm: agora, notaFiscalConfirmadaPor: autor });
    global.closeModal?.('modal-rebt-nf-chegada');
  }

  // ── Editar carga completa (pedido ao vivo do usuário) ───────────────────
  // "já tem uma carga que foi finalizada pelo coletor, mas faltou alguma
  // informação... eu clique lá em editar, ela abre mostrando tudo e eu
  // edite qualquer informação que tenha, horário, nota, volume" — diferente
  // de "Corrigir remetente e destino" (só lojas) e de "Voltar etapa" (só
  // reverte 1 etapa): aqui o Analista corrige horários/NF/volume de uma
  // carga JÁ EXISTENTE, em QUALQUER status (inclusive já finalizada),
  // usando a MESMA permissão administrativa "corrigir-horario" que "Voltar
  // etapa" já usa — sem permissão nova, sem mexer em firestore.rules (o
  // conjunto de campos que essa ação já pode gravar — status, os 5
  // horários, tempos calculados, notaFiscalTransferencia, volumes — já
  // cobre exatamente o que este modal edita).
  let _edicaoCompletaId = null;
  // Mesma compatibilidade defensiva de _ensureNovoTransbordoModal() — se o
  // HTML antigo (sem este modal) continuar em cache, o botão ✏️ ainda
  // funciona.
  function _ensureEdicaoCompletaModal() {
    let modal = document.getElementById('modal-rebt-editar-completo');
    if (modal) return modal;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-bg" id="modal-rebt-editar-completo"><div class="modal" style="max-width:520px">
<div class="modal-title">✏️ Editar Transbordo</div>
<div id="rebt-edit-completo-info" style="font-size:.78rem;color:var(--muted);padding:9px 11px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px"></div>
<div class="form-group"><label>Motorista</label><select class="field" id="rebtedit-motorista"></select></div>
<div class="form-group"><label>Volumes</label><input class="field" id="rebt-edit-completo-volumes" type="number" min="0"/></div>
<div class="form-group"><label>Nota(s) Fiscal(is)</label>
<div id="rebt-nf-editar-lista" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
<div style="display:flex;gap:8px">
<input class="field" id="rebt-nf-editar-numero" placeholder="Ex.: 123456" autocomplete="off" style="flex:1"/>
<button type="button" class="btn btn-ghost" type="button" onclick="window.adicionarNotaFiscalTransbordo('editar')" title="Adicionar outra nota fiscal">+</button>
</div>
<div id="rebt-nf-editar-status" style="font-size:.78rem;color:var(--muted);min-height:18px"></div>
</div>
<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:3px 0 10px;background:var(--surface-2,#f7f8fa)">
<div style="font-size:.78rem;font-weight:700;margin-bottom:8px">🕓 Horários da operação <span style="font-size:.68rem;font-weight:400;color:var(--muted)">(data e hora digitáveis)</span></div>
<div class="form-group" style="margin:0 0 8px"><label>Saída</label><div style="display:flex;gap:6px"><input class="field" id="rebtedit-hora-saida-data" type="date" style="flex:1.3"/><input class="field" id="rebtedit-hora-saida-hora" type="time" style="flex:1"/></div></div>
<div class="form-group" style="margin:0 0 8px"><label>Chegada</label><div style="display:flex;gap:6px"><input class="field" id="rebtedit-hora-chegada-data" type="date" style="flex:1.3"/><input class="field" id="rebtedit-hora-chegada-hora" type="time" style="flex:1"/></div></div>
<div class="form-group" style="margin:0 0 8px"><label>Início da descarga</label><div style="display:flex;gap:6px"><input class="field" id="rebtedit-hora-inicio-descarga-data" type="date" style="flex:1.3"/><input class="field" id="rebtedit-hora-inicio-descarga-hora" type="time" style="flex:1"/></div></div>
<div class="form-group" style="margin:0 0 8px"><label>Fim da descarga</label><div style="display:flex;gap:6px"><input class="field" id="rebtedit-hora-fim-descarga-data" type="date" style="flex:1.3"/><input class="field" id="rebtedit-hora-fim-descarga-hora" type="time" style="flex:1"/></div></div>
<div class="form-group" style="margin:0"><label>Fechamento / finalização</label><div style="display:flex;gap:6px"><input class="field" id="rebtedit-hora-fechamento-data" type="date" style="flex:1.3"/><input class="field" id="rebtedit-hora-fechamento-hora" type="time" style="flex:1"/></div></div>
<div id="rebt-edit-completo-status" style="font-size:.7rem;color:var(--danger,#ef4444);margin-top:8px"></div>
</div>
<div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="window.closeModal?closeModal('modal-rebt-editar-completo'):document.getElementById('modal-rebt-editar-completo').classList.remove('open')">Cancelar</button><button class="btn btn-primary" type="button" id="rebt-edit-completo-salvar" onclick="window.recbtSalvarEdicaoCompleta()">Salvar</button></div>
</div></div>`);
    return document.getElementById('modal-rebt-editar-completo');
  }
  async function recbtAbrirEdicaoCompleta(id) {
    const r = transbordos().find(x => x._id === id);
    if (!r) { global.showToast?.('Transbordo não encontrado.', 'error'); return; }
    _ensureEdicaoCompletaModal();
    _edicaoCompletaId = id;
    const info = document.getElementById('rebt-edit-completo-info');
    if (info) info.textContent = (r.origem || '—') + ' → ' + (r.destino || '—') + (r.placa ? ' · ' + r.placa : '');
    // PEDIDO AO VIVO (usuário: "eu consigo ajustar tudo, menos troca o
    // motorista que veio, quando saiu de um lugar eles biparam o motorista
    // errado") — motorista virou campo editável (antes só aparecia como
    // texto na linha de info acima, sem jeito de corrigir um bip errado no
    // Coletor). Mesmo cadastro/padrão de <select> já usado no "+ Novo
    // Transbordo" (rebt-motorista).
    const selMotorista = document.getElementById('rebtedit-motorista');
    if (selMotorista) {
      const motoristas = opInternals()?.motoristas?.() || [];
      selMotorista.innerHTML = '<option value="">— Selecionar —</option>' + motoristas.map(m => `<option value="${esc(m._id)}">${esc(m.nome)}</option>`).join('');
      selMotorista.value = r.motoristaId || '';
    }
    // `?? ''` (não `|| ''`) — volumes:0 é um valor real (era exatamente o
    // que faltava no relato ao vivo), `||` trataria 0 como "sem valor" e
    // limparia o campo à toa.
    const volumes = document.getElementById('rebt-edit-completo-volumes');
    if (volumes) volumes.value = r.volumes ?? '';
    _HORARIOS_TRANSBORDO.forEach(([sufixo, , campo]) => _preencherDataHora('rebtedit-hora-' + sufixo, r[campo]));
    _notasFiscaisPorModo.editar = String(r.notaFiscalTransferencia || '').split(',').map(s => s.trim()).filter(Boolean);
    _redesenharListaNfTransbordo('editar');
    const nfNumero = document.getElementById('rebt-nf-editar-numero'); if (nfNumero) nfNumero.value = '';
    const nfStatus = document.getElementById('rebt-nf-editar-status'); if (nfStatus) nfStatus.textContent = '';
    const statusEl = document.getElementById('rebt-edit-completo-status'); if (statusEl) statusEl.textContent = '';
    global.openModal?.('modal-rebt-editar-completo');
  }
  async function recbtSalvarEdicaoCompleta() {
    const r = transbordos().find(x => x._id === _edicaoCompletaId);
    if (!r) { global.showToast?.('Transbordo não encontrado.', 'error'); return; }

    const restante = String(document.getElementById('rebt-nf-editar-numero')?.value || '').trim();
    if (restante && !_listaNfEmEdicao('editar').includes(restante)) _listaNfEmEdicao('editar').push(restante);
    _redesenharListaNfTransbordo('editar');

    const horarios = {
      horaSaida: _valorDataHoraCombinada('rebtedit-hora-saida'),
      horaChegada: _valorDataHoraCombinada('rebtedit-hora-chegada'),
      horaInicioDescarga: _valorDataHoraCombinada('rebtedit-hora-inicio-descarga'),
      horaFimDescarga: _valorDataHoraCombinada('rebtedit-hora-fim-descarga'),
      horaFechamentoRecebimento: _valorDataHoraCombinada('rebtedit-hora-fechamento'),
    };
    const erro = _validarHorariosNovo(horarios);
    const statusEl = document.getElementById('rebt-edit-completo-status');
    if (erro) { if (statusEl) { statusEl.textContent = erro; statusEl.style.color = 'var(--danger,#ef4444)'; } return; }
    if (statusEl) statusEl.textContent = '';

    const i = opInternals();
    const status = _statusPorHorarios(horarios);
    const notaFiscalTransferencia = _listaNfEmEdicao('editar').length ? _juntarNotasFiscais(_listaNfEmEdicao('editar')) : null;
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    // Motorista errado bipado na saída (pedido ao vivo do usuário) — troca
    // igual ao "+ Novo Transbordo": resolve pelo cadastro e grava id+nome
    // juntos, nunca só um dos dois solto.
    const motoristaId = document.getElementById('rebtedit-motorista')?.value || '';
    const motorista = (i?.motoristas?.() || []).find(m => m._id === motoristaId);
    const payload = {
      status, ...horarios,
      motoristaId, motoristaNome: motorista?.nome || '',
      transportadora: motorista?.transportadora || r.transportadora || '',
      volumes: Number(document.getElementById('rebt-edit-completo-volumes')?.value) || 0,
      notaFiscalTransferencia,
      atualizadoEm: agora, atualizadoPor: autor,
    };
    const tempos = i?.recalcularTempos ? i.recalcularTempos({ ...r, ...payload }) : null;
    if (tempos) Object.assign(payload, tempos);

    const btn = document.getElementById('rebt-edit-completo-salvar');
    const original = btn?.innerHTML || 'Salvar';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Salvando...'; }
    try {
      const lojaDocumento = String(r._lojaId || (global.getDTLojaAtiva ? global.getDTLojaAtiva() : ''));
      if (!lojaDocumento) throw new Error('Não foi possível identificar a loja em que o transbordo está salvo.');
      const raw = typeof global.getDTRawFirestore === 'function' ? global.getDTRawFirestore() : null;
      if (!raw) throw new Error('Firestore indisponível.');
      await raw.collection('lojas').doc(lojaDocumento).collection('recebimentos').doc(r._id).update(payload);
      try { await i?.registrarAuditoria?.(r._id, 'EDICAO_COMPLETA', r.status, status, lojaDocumento); } catch (eAud) { /* auditoria nunca trava a ação */ }
      global.closeModal?.('modal-rebt-editar-completo');
      await opInternals()?.carregar?.(true);
      _desenharTransbordo();
      global.showToast?.('Transbordo atualizado.', 'success');
    } catch (e) {
      const traduzido = typeof global.traduzirErroPermissao === 'function' ? global.traduzirErroPermissao(e, { mensagem: 'Você não possui permissão para editar este transbordo. Peça pro Analista liberar "corrigir horário" em Usuários e Permissões.' }) : null;
      global.showToast?.(traduzido || ('Erro ao salvar: ' + (e?.message || e)), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
  }

  // "Apagar todos" (pedido ao vivo do usuário) — respeita o filtro de data
  // já visível na tela (a mesma lista que _desenharTransbordo mostra), pra
  // não obrigar a escolher entre "tudo" ou "nada": limpar o filtro apaga
  // tudo, deixar um dia selecionado apaga só aquele dia.
  function recbtExcluirTodos() {
    const linhas = _transbordosFiltrados();
    if (!linhas.length) { global.showToast?.('Nenhum transbordo pra apagar com o filtro atual.', 'i'); return; }
    const ids = linhas.map(r => r._id);
    const executar = () => opInternals()?.excluirEmMassa?.(ids);
    const msg = `Apagar ${ids.length} transbordo(s) definitivamente? Essa ação não pode ser desfeita.`;
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Apagar todos', icon: '🗑️', okLabel: 'Apagar todos', okClass: 'btn-danger' });
    else if (confirm(msg)) executar();
  }

  function recbtImprimirQr() {
    const img = document.getElementById('rebt-qr-img');
    const codigo = document.getElementById('rebt-qr-codigo')?.textContent || '';
    const janela = global.open?.('', '_blank');
    if (!janela || !img) return;
    janela.document.write('<html><head><title>' + codigo + '</title></head><body style="text-align:center;font-family:sans-serif"><img src="' + img.src + '"/><div style="font-size:14px;margin-top:8px">' + codigo + '</div></body></html>');
    janela.document.close();
    janela.print?.();
  }

  global.renderRecebimentoTransbordo = renderRecebimentoTransbordo;
  global.recbtNovo = recbtNovo;
  global.recbtSalvar = recbtSalvar;
  global.recbtCadastrarObservacao = recbtCadastrarObservacao;
  global.recbtExcluirObservacao = recbtExcluirObservacao;
  global.recbtConfirmarNfSaida = recbtConfirmarNfSaida;
  global.recbtConfirmarNfChegada = recbtConfirmarNfChegada;
  global.recbtInverterRotaDireto = recbtInverterRotaDireto;
  global.recbtAbrirCorrigirRota = recbtAbrirCorrigirRota;
  global.recbtInverterRota = recbtInverterRota;
  global.recbtSalvarRota = recbtSalvarRota;
  global.recbtAbrirEdicaoCompleta = recbtAbrirEdicaoCompleta;
  global.recbtSalvarEdicaoCompleta = recbtSalvarEdicaoCompleta;
  global.adicionarNotaFiscalTransbordo = adicionarNotaFiscalTransbordo;
  global._recebimentoTransbordoInternals = { carregarIdentificadores: _carregarIdentificadores, identificadores: () => _identificadores, gerarCodigo: _gerarCodigo, gerarQrDataUrl: _gerarQrDataUrl, abrirNfSaida: recbtAbrirNfSaida, abrirNfChegada: recbtAbrirNfChegada, abrirNovo: recbtNovo };
  // Reusado por 92-recebimento-config.js pro botão "Ver QR" do código fixo
  // do motorista — mesmo modal (#modal-rebt-qr), sem duplicar UI de QR.
  global.recbtMostrarQr = _mostrarQr;

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-rebt-atualizar]')) {
      const btn = event.target.closest('[data-rebt-atualizar]');
      const original = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳ Atualizando...';
      Promise.resolve(opInternals()?.carregar?.(true)).then(() => { _desenharTransbordo(); global.showToast?.('Transbordos atualizados.', 'success'); }).catch(e => global.showToast?.('Falha ao atualizar: ' + (e?.message || e), 'error')).finally(() => { btn.disabled = false; btn.innerHTML = original; });
      return;
    }
    if (event.target.closest('[data-rebt-obs-cadastrar]')) { recbtCadastrarObservacao(); return; }
    const excluirObs = event.target.closest('[data-rebt-obs-excluir]'); if (excluirObs) { recbtExcluirObservacao(excluirObs.getAttribute('data-rebt-obs-excluir')); return; }
    if (event.target.closest('[data-rebt-novo]')) { recbtNovo(); return; }
    if (event.target.closest('[data-rebt-imprimir-qr]')) { recbtImprimirQr(); return; }
    const verQrRec = event.target.closest('[data-rebt-ver-qr-recebimento]'); if (verQrRec) { recbtVerQrRecebimento(verQrRec.getAttribute('data-rebt-ver-qr-recebimento')); return; }
    const corrigirRota = event.target.closest('[data-rebt-corrigir-rota]'); if (corrigirRota) { recbtInverterRotaDireto(corrigirRota.getAttribute('data-rebt-corrigir-rota')); return; }
    const editarCompleto = event.target.closest('[data-rebt-editar-completo]'); if (editarCompleto) { recbtAbrirEdicaoCompleta(editarCompleto.getAttribute('data-rebt-editar-completo')); return; }
    // Saída e chegada agora sempre passam pelo modal de Nota Fiscal (controle
    // de NF) em vez de registrar a transição direto.
    const saida = event.target.closest('[data-rebt-saida]'); if (saida) { recbtAbrirNfSaida(saida.getAttribute('data-rebt-saida')); return; }
    const chegada = event.target.closest('[data-rebt-chegada]'); if (chegada) { recbtAbrirNfChegada(chegada.getAttribute('data-rebt-chegada')); return; }
    const nfRemover = event.target.closest('[data-nf-remover]');
    if (nfRemover) {
      const modo = nfRemover.getAttribute('data-nf-modo');
      _listaNfEmEdicao(modo).splice(Number(nfRemover.getAttribute('data-nf-remover')), 1);
      _redesenharListaNfTransbordo(modo);
      return;
    }
    const iniciar = event.target.closest('[data-rebt-iniciar]'); if (iniciar) { opInternals()?.iniciarDescarga?.(iniciar.getAttribute('data-rebt-iniciar')); return; }
    const fimDescarga = event.target.closest('[data-rebt-fim-descarga]'); if (fimDescarga) { opInternals()?.finalizarDescarga?.(fimDescarga.getAttribute('data-rebt-fim-descarga')); return; }
    const finalizar = event.target.closest('[data-rebt-finalizar]'); if (finalizar) { opInternals()?.finalizar?.(finalizar.getAttribute('data-rebt-finalizar')); return; }
    const cancelar = event.target.closest('[data-rebt-cancelar]'); if (cancelar) { opInternals()?.cancelar?.(cancelar.getAttribute('data-rebt-cancelar')); return; }
    const excluir = event.target.closest('[data-rebt-excluir]'); if (excluir) { opInternals()?.excluir?.(excluir.getAttribute('data-rebt-excluir')); return; }
    if (event.target.closest('[data-rebt-excluir-todos]')) { recbtExcluirTodos(); return; }
    const voltar = event.target.closest('[data-rebt-voltar]'); if (voltar) { opInternals()?.voltarEtapa?.(voltar.getAttribute('data-rebt-voltar')); return; }
    // Atalhos de data (pedido ao vivo do usuário: "eu posso escolher só um
    // dia, eu posso escolher uma semana") — mesmo formato 'AAAA-MM-DD' do
    // <input type="date">, pra ficar redigitável nele.
    if (event.target.closest('[data-rebt-f-hoje]')) {
      const hoje = new Date().toLocaleDateString('en-CA');
      _filtroDataInicio = hoje; _filtroDataFim = hoje;
      _desenharTransbordo();
      return;
    }
    if (event.target.closest('[data-rebt-f-semana]')) {
      const fim = new Date();
      const inicio = new Date(fim); inicio.setDate(inicio.getDate() - 6);
      _filtroDataInicio = inicio.toLocaleDateString('en-CA'); _filtroDataFim = fim.toLocaleDateString('en-CA');
      _desenharTransbordo();
      return;
    }
    if (event.target.closest('[data-rebt-f-limpar]')) {
      _filtroDataInicio = ''; _filtroDataFim = '';
      _desenharTransbordo();
      return;
    }
  });


  document.addEventListener('input', function (event) {
    if (/^rebt-hora-(saida|chegada|inicio-descarga|fim-descarga|fechamento)-(data|hora)$/.test(event.target.id)) _atualizarResumoHorariosNovo();
    if (event.target.id === 'rebt-obs-filtro') {
      const termo = String(event.target.value || '').trim().toLocaleLowerCase('pt-BR');
      document.querySelectorAll('[data-rebt-obs-item]').forEach(el => {
        el.style.display = !termo || String(el.getAttribute('data-rebt-obs-texto') || '').includes(termo) ? 'inline-flex' : 'none';
      });
    }
  });

  document.addEventListener('change', function (event) {
    if (event.target.id === 'rebt-origem') { _atualizarDestinosNovo(); return; }
    if (/^rebt-hora-(saida|chegada|inicio-descarga|fim-descarga|fechamento)-(data|hora)$/.test(event.target.id)) _atualizarResumoHorariosNovo();
    if (event.target.id === 'rebt-f-data-inicio') { _filtroDataInicio = event.target.value || ''; _desenharTransbordo(); }
    if (event.target.id === 'rebt-f-data-fim') { _filtroDataFim = event.target.value || ''; _desenharTransbordo(); }
  });
})(window);
