// Recebimento > Pátio em Tempo Real
// PEDIDO AO VIVO (2026-09-10): saldo FÍSICO atual de notas paradas no
// pátio (Recusa + Reentrega) — não é histórico, é "o que está parado
// agora". Reaproveita 100% as regras/coleções que já existem hoje pra
// Recusas/Reentregas (recebimento_recusas) — não cria nenhuma coleção
// nova, nenhum status novo. Ver plano completo em
// structured-sprouting-hoare.md.
(function (global) {
  'use strict';
  // Ver mesmo bloco/comentário em 97-recebimento-recusas.js.
  global.DT_RETORNOS_DIRTY = global.DT_RETORNOS_DIRTY || { patio: false, indicadores: false, status: false, recusas: false };
  const COL_RECUSAS = 'recebimento_recusas';
  const COL_NOTAS = 'recebimento_recusas_notas';

  function fs() { return global.getDTFirestore(); }
  function raw() { return global.getDTRawFirestore(); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }
  function fmtBRL(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDataHora(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }
  // "2h35min" / "1 dia 4h20min" — não existe um helper assim hoje (o
  // fmtDuracao de 96-recebimento-performance.js só faz HH:MM sem dias).
  function fmtTempoParado(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '—';
    const ms = Date.now() - d.getTime();
    if (ms < 0) return '—';
    const minTotais = Math.floor(ms / 60000);
    const dias = Math.floor(minTotais / 1440);
    const horas = Math.floor((minTotais % 1440) / 60);
    const min = minTotais % 60;
    return (dias ? dias + ' dia' + (dias > 1 ? 's' : '') + ' ' : '') + horas + 'h' + String(min).padStart(2, '0') + 'min';
  }

  // Saldo do Pátio — MESMA regra duplicada em 97-recebimento-recusas.js
  // (alterarTratamento), 99-recebimento-retornos-status.js
  // (mudarStatusRetorno/salvarDataReentrega) e 24-recebimento-recusas.js
  // do Coletor (finalizar/confirmarSaida) — os 4 lugares que decidem se
  // uma nota está fisicamente presente têm que concordar sempre.
  function estaNoPatio(doc, nota) {
    if (doc.origem !== 'COLETOR' && doc.origem !== 'INVENTARIO_INICIAL') return false;
    const tratamento = nota.tratamento != null ? nota.tratamento : (doc.tratamento || '');
    if (tratamento === 'REENTREGA') {
      const saida = nota.dataSaidaEm != null ? nota.dataSaidaEm : doc.dataSaidaEm;
      return !saida;
    }
    if (tratamento === 'RECUSA') {
      const status = nota.statusRetorno != null ? nota.statusRetorno : (doc.statusRetorno || '');
      return status !== 'FINALIZADO';
    }
    return true; // '', PENDENTE, DEVOLUCAO, SUBSTITUICAO, OUTRO — sem evento de saída ainda
  }
  function recalcularStatusFisico(doc) {
    const notas = Array.isArray(doc.notas) && doc.notas.length ? doc.notas : [{}];
    return notas.some(n => estaNoPatio(doc, n)) ? 'NO_PATIO' : 'SAIU';
  }

  // Mesmo padrão de "1 linha por nota" já usado em 97/99/103 — campos que
  // podem morar na nota OU herdar do documento (nota vence quando existe).
  const CAMPOS_POR_NOTA = ['tratamento', 'statusRetorno', 'dataSaidaEm', 'dataProgramadaEm', 'box', 'numeroNota', 'chave', 'destinatario', 'volumeEsperado'];
  function _linhaDaNota(r, nota) {
    const linha = Object.assign({}, r, { notas: [nota], _recusaId: r._id, _notaChave: nota.chave || '' });
    CAMPOS_POR_NOTA.forEach(c => { linha[c] = nota[c] != null ? nota[c] : r[c]; });
    if (linha.tratamento == null) linha.tratamento = '';
    if (linha.statusRetorno == null) linha.statusRetorno = '';
    return linha;
  }
  function linhasPorNota(recusas) {
    const linhas = [];
    recusas.forEach(r => (Array.isArray(r.notas) && r.notas.length ? r.notas : [{}]).forEach(n => linhas.push(_linhaDaNota(r, n))));
    return linhas;
  }

  const TRATAMENTO_LABELS_PATIO = global.TRATAMENTO_LABELS || { '': '— Não classificado —', RECUSA: 'Recusa', DEVOLUCAO: 'Devolução', REENTREGA: 'Reentrega', SUBSTITUICAO: 'Substituição', PENDENTE: 'Pendente', OUTRO: 'Outro' };
  const STATUS_RETORNO_LABELS_PATIO = global.STATUS_RETORNO_LABELS || { '': 'Aguard. Monitoramento', AGUARD_FISCAL: 'Aguard. Fiscal', EM_TRATATIVA: 'Em tratativa', OK: 'OK', CTE: 'CTE', ENDERECANDO: 'Endereçando', FINALIZADO: 'Finalizado' };

  let _linhas = [];
  let _carregado = false;
  let _carregando = false;
  let _erro = '';
  let _intervalId = null;
  let _filtroTipo = '';
  let _filtroMercado = '';
  let _filtroStatus = '';
  let _filtroBox = '';
  let _filtroVendedor = '';
  let _filtroSupervisor = '';
  let _filtroDataInicio = '';
  let _filtroDataFim = '';

  // Enriquecimento (mercado/vendedor/supervisor/valor) — busca DIRECIONADA
  // só pelas chaves que realmente estão no pátio agora (Promise.all de
  // `.doc(chave).get()`, mesmo padrão já usado em
  // iniciarConferenciaDelegada do Coletor), nunca a coleção
  // recebimento_recusas_notas inteira (fica pra outra rodada o mesmo
  // ajuste em 98-recebimento-retornos-indicadores.js, documentado lá).
  async function _enriquecerComNotas(linhas) {
    const chaves = [...new Set(linhas.map(l => l.chave).filter(Boolean))];
    if (!chaves.length) return linhas;
    const docs = await Promise.all(chaves.map(c => fs().collection(COL_NOTAS).doc(c).get().catch(() => null)));
    const porChave = new Map();
    docs.forEach(d => { if (d && d.exists) porChave.set(d.id, d.data()); });
    return linhas.map(l => {
      const n = porChave.get(l.chave) || {};
      return Object.assign({}, l, {
        destinatario: l.destinatario || n.destinatario || '',
        vendedorNome: n.vendedorNome || '',
        supervisorNome: n.supervisorNome || '',
        valorTotal: Number(l.valorTotal != null ? l.valorTotal : n.valorTotal) || 0,
      });
    });
  }

  // PEDIDO AO VIVO (2026-09-11): "a parte do Analista pode puxar do
  // BigQuery, 1 a 5 minutos de atraso não tem problema" — troca a busca
  // direta no Firestore pela Cloud Function buscarPatioTempoRealBigQuery
  // (mesma view "_raw_latest", filtro por statusFisico=NO_PATIO em vez de
  // período). O polling de 45s e o enriquecimento por nota (via
  // recebimento_recusas_notas) continuam iguais — só a origem da lista
  // principal muda. migrarStatusFisico() continua lendo o Firestore
  // direto de propósito (precisa ver TODOS os documentos, inclusive os
  // sem statusFisico ainda, pra fazer o backfill).
  async function carregarPatio(forcar) {
    if (_carregado && !forcar) return;
    if (_carregando) return;
    _carregando = true;
    _erro = '';
    try {
      const lojaId = typeof global.getDTLojaAtiva === 'function' ? global.getDTLojaAtiva() : '';
      if (!lojaId) throw new Error('Nenhuma loja selecionada.');
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarPatioTempoRealBigQuery');
      const resposta = await callable({ lojaId });
      const docs = (resposta && resposta.data && resposta.data.recusas) || [];
      const todasLinhas = linhasPorNota(docs).filter(l => estaNoPatio(l, l));
      _linhas = await _enriquecerComNotas(todasLinhas);
      _carregado = true;
    } catch (e) {
      _erro = e.message || String(e);
    } finally {
      _carregando = false;
    }
  }

  // Migração única (backfill) — documentos gravados ANTES desta feature
  // não têm `statusFisico`, ficariam invisíveis pra sempre na consulta
  // nova mesmo estando abertos de verdade. Sempre visível (não dá pra
  // consultar "campo ausente" no Firestore de forma barata) — idempotente,
  // rodar de novo não altera nada nos que já têm o campo certo.
  async function migrarStatusFisico() {
    const btn = document.getElementById('patio-migrar-btn');
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Preparando...'; }
    try {
      const snap = await fs().collection(COL_RECUSAS).get();
      const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      const paraCorrigir = docs.filter(d => d.statusFisico == null).map(d => ({ id: d._id, statusFisico: recalcularStatusFisico(d) }));
      const rawFs = raw();
      for (let i = 0; i < paraCorrigir.length; i += 300) {
        const lote = paraCorrigir.slice(i, i + 300);
        const batch = rawFs.batch();
        lote.forEach(item => batch.update(fs().collection(COL_RECUSAS).doc(item.id), { statusFisico: item.statusFisico }));
        await batch.commit();
      }
      global.showToast?.(`${paraCorrigir.length} registro(s) preparado(s).`, 'success');
      await carregarPatio(true);
      desenhar();
    } catch (e) {
      global.showToast?.('Erro ao preparar dados: ' + (e.message || e), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
  }

  function _filtradas() {
    return _linhas.filter(l => {
      if (_filtroTipo === 'RECUSA' && l.tratamento !== 'RECUSA') return false;
      if (_filtroTipo === 'REENTREGA' && l.tratamento !== 'REENTREGA') return false;
      if (_filtroTipo === 'OUTROS' && (l.tratamento === 'RECUSA' || l.tratamento === 'REENTREGA')) return false;
      if (_filtroMercado && (l.destinatario || '') !== _filtroMercado) return false;
      if (_filtroStatus && (l.statusRetorno || '') !== _filtroStatus) return false;
      if (_filtroBox && !String(l.box || '').toUpperCase().includes(_filtroBox.toUpperCase())) return false;
      if (_filtroVendedor && !String(l.vendedorNome || '').toUpperCase().includes(_filtroVendedor.toUpperCase())) return false;
      if (_filtroSupervisor && !String(l.supervisorNome || '').toUpperCase().includes(_filtroSupervisor.toUpperCase())) return false;
      const dia = String(l.criadoEm || '').slice(0, 10);
      if (_filtroDataInicio && dia && dia < _filtroDataInicio) return false;
      if (_filtroDataFim && dia && dia > _filtroDataFim) return false;
      return true;
    });
  }

  function kpis() {
    const todas = _linhas;
    const recusas = todas.filter(l => l.tratamento === 'RECUSA');
    const reentregas = todas.filter(l => l.tratamento === 'REENTREGA');
    const emTratamento = recusas.filter(l => l.statusRetorno && l.statusRetorno !== 'FINALIZADO');
    const somaValor = arr => arr.reduce((s, l) => s + Number(l.valorTotal || 0), 0);
    return {
      total: todas.length, valorTotal: somaValor(todas),
      recusas: recusas.length, valorRecusas: somaValor(recusas),
      reentregas: reentregas.length, valorReentregas: somaValor(reentregas),
      emTratamento: emTratamento.length,
    };
  }

  function _cardsHtml() {
    const k = kpis();
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:12px 0 16px">
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">TOTAL NO PÁTIO</div><div style="font-size:1.55rem;font-weight:850">${k.total.toLocaleString('pt-BR')}</div><div style="font-size:.78rem;color:var(--muted)">${fmtBRL(k.valorTotal)}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">RECUSAS</div><div style="font-size:1.55rem;font-weight:850">${k.recusas.toLocaleString('pt-BR')}</div><div style="font-size:.78rem;color:var(--muted)">${fmtBRL(k.valorRecusas)}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">REENTREGAS</div><div style="font-size:1.55rem;font-weight:850">${k.reentregas.toLocaleString('pt-BR')}</div><div style="font-size:.78rem;color:var(--muted)">${fmtBRL(k.valorReentregas)}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">NOTAS EM TRATAMENTO</div><div style="font-size:1.55rem;font-weight:850">${k.emTratamento.toLocaleString('pt-BR')}</div><div style="font-size:.78rem;color:var(--muted)">Aguard. Fiscal/CTE/Endereçando</div></div>
    </div>`;
  }

  function _rankingMercados() {
    const mapa = new Map();
    _linhas.forEach(l => {
      const m = l.destinatario || '— Sem mercado —';
      const acc = mapa.get(m) || { mercado: m, qtd: 0, valor: 0, recusas: 0, reentregas: 0 };
      acc.qtd++; acc.valor += Number(l.valorTotal || 0);
      if (l.tratamento === 'RECUSA') acc.recusas++;
      if (l.tratamento === 'REENTREGA') acc.reentregas++;
      mapa.set(m, acc);
    });
    return [...mapa.values()].sort((a, b) => b.qtd - a.qtd);
  }

  function _rankingHtml() {
    const ranking = _rankingMercados().slice(0, 15);
    if (!ranking.length) return '<div class="empty"><div class="empty-title">Sem dados para exibir</div></div>';
    return `<div style="overflow-x:auto"><table class="dt-table"><thead><tr><th>#</th><th>Mercado</th><th>Qtd.</th><th>Valor</th><th>Recusas</th><th>Reentregas</th></tr></thead><tbody>
      ${ranking.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.mercado)}</td><td>${r.qtd}</td><td>${fmtBRL(r.valor)}</td><td>${r.recusas}</td><td>${r.reentregas}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  function _opcoesMercado() {
    return [...new Set(_linhas.map(l => l.destinatario).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function _filtrosHtml() {
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">DE (entrada)</div><input type="date" class="field" id="patio-f-data-ini" value="${esc(_filtroDataInicio)}" style="padding:7px"></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input type="date" class="field" id="patio-f-data-fim" value="${esc(_filtroDataFim)}" style="padding:7px"></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">TIPO</div><select class="field" id="patio-f-tipo" style="padding:7px">
        <option value="">Todos</option>
        <option value="RECUSA" ${_filtroTipo === 'RECUSA' ? 'selected' : ''}>Recusa</option>
        <option value="REENTREGA" ${_filtroTipo === 'REENTREGA' ? 'selected' : ''}>Reentrega</option>
        <option value="OUTROS" ${_filtroTipo === 'OUTROS' ? 'selected' : ''}>Outros/Não classificado</option>
      </select></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">MERCADO</div><select class="field" id="patio-f-mercado" style="padding:7px;max-width:220px">
        <option value="">Todos</option>
        ${_opcoesMercado().map(m => `<option value="${esc(m)}" ${_filtroMercado === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
      </select></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">STATUS</div><select class="field" id="patio-f-status" style="padding:7px">
        <option value="">Todos</option>
        ${Object.keys(STATUS_RETORNO_LABELS_PATIO).filter(k => k).map(k => `<option value="${k}" ${_filtroStatus === k ? 'selected' : ''}>${esc(STATUS_RETORNO_LABELS_PATIO[k])}</option>`).join('')}
      </select></div>
      <input class="field" id="patio-f-box" placeholder="Box" value="${esc(_filtroBox)}" style="padding:7px;max-width:110px">
      <input class="field" id="patio-f-vendedor" placeholder="Vendedor" value="${esc(_filtroVendedor)}" style="padding:7px;max-width:150px">
      <input class="field" id="patio-f-supervisor" placeholder="Supervisor" value="${esc(_filtroSupervisor)}" style="padding:7px;max-width:150px">
    </div>`;
  }

  function _tabelaHtml() {
    const linhas = _filtradas().sort((a, b) => String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')));
    if (!linhas.length) return '<div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Nenhuma nota parada com esses filtros</div></div>';
    return `<div style="overflow-x:auto"><table class="dt-table"><thead><tr>
      <th>Nota</th><th>Tipo</th><th>Mercado</th><th>Valor</th><th>Box</th><th>Entrada</th><th>Status</th><th>Vendedor</th><th>Supervisor</th><th>Motivo</th><th>Tempo parado</th><th>Responsável</th>
    </tr></thead><tbody>
      ${linhas.map(l => `<tr>
        <td class="mono">${esc(l.numeroNota || '—')}</td>
        <td>${esc(TRATAMENTO_LABELS_PATIO[l.tratamento] || l.tratamento || '—')}</td>
        <td>${esc(l.destinatario || '—')}</td>
        <td style="text-align:right;white-space:nowrap">${fmtBRL(l.valorTotal)}</td>
        <td>${esc(l.box || '—')}</td>
        <td>${fmtDataHora(l.criadoEm)}</td>
        <td>${l.tratamento === 'REENTREGA' ? (l.dataProgramadaEm ? 'Programada' : 'Aguardando') : esc(STATUS_RETORNO_LABELS_PATIO[l.statusRetorno] || l.statusRetorno || '—')}</td>
        <td>${esc(l.vendedorNome || '—')}</td>
        <td>${esc(l.supervisorNome || '—')}</td>
        <td>${esc(l.motivoNome || '—')}</td>
        <td style="font-weight:700;white-space:nowrap">${fmtTempoParado(l.criadoEm)}</td>
        <td>${esc(l.conferenteNome || '—')}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  function _carregandoHtml() {
    return _carregando ? '<div style="font-size:.76rem;color:var(--muted);margin-bottom:8px">⏳ Atualizando...</div>' : '';
  }
  function _erroHtml() {
    if (!_erro) return '';
    return `<div style="font-size:.76rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px"><span>⚠️ Não foi possível atualizar: ${esc(_erro)}</span><button type="button" class="btn btn-ghost btn-sm" data-patio-atualizar="1">Tentar de novo</button></div>`;
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-patio-tempo-real');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
        <div><h2 style="margin:0">📦 Pátio em Tempo Real</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Saldo físico atual de Recusas/Reentregas paradas — atualiza sozinho a cada 45s. Não é histórico: uma nota sai daqui quando é finalizada (Recusa) ou tem a saída confirmada (Reentrega).</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" id="patio-migrar-btn" title="Roda 1x — organiza registros antigos que ainda não têm o campo novo desta tela">🔧 Preparar dados antigos</button>
          <button class="btn btn-ghost" data-patio-atualizar="1">↻ Atualizar</button>
        </div>
      </div>
      ${_carregandoHtml()}
      ${_erroHtml()}
      ${_cardsHtml()}
      <div class="tc" style="padding:16px;margin-bottom:14px"><div class="tc-title">🏪 Maiores mercados parados</div>${_rankingHtml()}</div>
      <div class="tc" style="padding:16px">
        <div class="tc-title" style="margin-bottom:10px">📋 Notas paradas no pátio</div>
        ${_filtrosHtml()}
        ${_tabelaHtml()}
      </div>`;
    _ligarEventos();
    global.aplicarPermissoesAnalista?.();
  }

  function _ligarEventos() {
    document.querySelector('[data-patio-atualizar]')?.addEventListener('click', async () => { await carregarPatio(true); desenhar(); });
    document.getElementById('patio-migrar-btn')?.addEventListener('click', migrarStatusFisico);
    document.getElementById('patio-f-data-ini')?.addEventListener('change', e => { _filtroDataInicio = e.target.value || ''; desenhar(); });
    document.getElementById('patio-f-data-fim')?.addEventListener('change', e => { _filtroDataFim = e.target.value || ''; desenhar(); });
    document.getElementById('patio-f-tipo')?.addEventListener('change', e => { _filtroTipo = e.target.value || ''; desenhar(); });
    document.getElementById('patio-f-mercado')?.addEventListener('change', e => { _filtroMercado = e.target.value || ''; desenhar(); });
    document.getElementById('patio-f-status')?.addEventListener('change', e => { _filtroStatus = e.target.value || ''; desenhar(); });
    document.getElementById('patio-f-box')?.addEventListener('input', e => { _filtroBox = e.target.value || ''; desenhar(); });
    document.getElementById('patio-f-vendedor')?.addEventListener('input', e => { _filtroVendedor = e.target.value || ''; desenhar(); });
    document.getElementById('patio-f-supervisor')?.addEventListener('input', e => { _filtroSupervisor = e.target.value || ''; desenhar(); });
  }

  // Polling leve (45s) — decisão tomada com o usuário (não usar
  // onSnapshot, ver histórico de instabilidade em 93/95-recebimento-*.js
  // e a tentativa revertida em 97 no mesmo dia deste plano). O próprio
  // callback do interval se desliga quando a página não está mais ativa —
  // não precisa de hook novo de "saída de página" em 03-core-navigation.js.
  function _iniciarPolling() {
    if (_intervalId) return;
    _intervalId = setInterval(() => {
      const pagina = document.getElementById('page-recebimento-patio-tempo-real');
      if (!pagina || !pagina.classList.contains('on')) { clearInterval(_intervalId); _intervalId = null; return; }
      carregarPatio(true).then(() => desenhar());
    }, 45000);
  }

  async function renderPatioTempoReal() {
    const pagina = document.getElementById('page-recebimento-patio-tempo-real');
    if (!pagina) return;
    desenhar();
    // PEDIDO AO VIVO (2026-09-11): normalmente o polling de 45s já cobre a
    // atualização; isso aqui só garante que, ao REENTRAR na tela logo após
    // editar algo em Notas Retornadas, não fica esperando o próximo tick do
    // polling pra mostrar o dado fresco.
    const forcar = !!(global.DT_RETORNOS_DIRTY && global.DT_RETORNOS_DIRTY.patio && _carregado);
    if (forcar) global.DT_RETORNOS_DIRTY.patio = false;
    await carregarPatio(forcar);
    desenhar();
    _iniciarPolling();
  }

  global.renderPatioTempoReal = renderPatioTempoReal;
  global._recebimentoPatioTempoRealInternals = {
    estaNoPatio, recalcularStatusFisico, linhasPorNota, carregarPatio, kpis,
    rankingMercados: _rankingMercados, fmtTempoParado, migrarStatusFisico,
    getLinhas: () => _linhas,
    setFiltroTipo: v => { _filtroTipo = v || ''; }, getFiltroTipo: () => _filtroTipo,
    setFiltroMercado: v => { _filtroMercado = v || ''; },
    setFiltroStatus: v => { _filtroStatus = v || ''; },
    setFiltroBox: v => { _filtroBox = v || ''; },
    setFiltroVendedor: v => { _filtroVendedor = v || ''; },
    setFiltroSupervisor: v => { _filtroSupervisor = v || ''; },
    setFiltroPeriodo: (ini, fim) => { _filtroDataInicio = ini || ''; _filtroDataFim = fim || ''; },
    filtradas: _filtradas,
  };
})(window);
