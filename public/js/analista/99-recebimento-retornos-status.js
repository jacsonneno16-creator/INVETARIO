// Recebimento > Notas Retornadas > Status de Retornos (FASE 12)
// Acompanha o retorno DEPOIS de registrado pelo Coletor, com um dashboard
// de tempo médio gasto em cada etapa.
//
// REESCRITO 2026-08-20, CORRIGIDO 2026-08-21 — a 1ª versão (2026-08-20) foi
// validada só de olho nas primeiras linhas da planilha real
// ("CONTROLE DE REENTREGAS E RECUSAS.xlsx") e saiu com 3 erros, achados ao
// estudar de novo com números reais (contagem de uso de cada status +
// cruzamento status × quais datas ficam preenchidas em ~750 registros):
// 1. Faltava o status "AGUARD FISCAL" (o 2º mais usado depois de
//    Finalizado, 46 casos) e "EM TRATATIVA" (existe no cadastro da
//    planilha, raro na prática) — a 1ª versão só tinha
//    Aguard.Monitoramento/OK/CTE/Endereçando/Finalizado.
// 2. Faltava uma 4ª data nomeada: "DATA SOLICITADA P/ RECUSA" — a planilha
//    tem 4 datas (Liberou → Solicitada → Recusa → Endereçamento), a 1ª
//    versão só usava 3 e por isso calculava "dias parados no fiscal/CTE"
//    errado (usava Liberou→Recusa; o valor real da planilha é sempre
//    Solicitada→Recusa, confirmado batendo os números reais linha a linha).
// 3. O status "OK" (18 casos reais, TODOS sem nenhuma data preenchida) tinha
//    sido carimbado com liberadoParaRecusarEm por engano — confirmado com o
//    usuário: OK é um atalho SEM burocracia (a nota nem passa pelo fiscal/
//    CTE), então não carimba data nenhuma.
// Catálogo real de status (aba "BASE" da planilha, coluna B): Aguard.
// Monitoramento (vazio) → Aguard. Fiscal → CTE → Endereçando → Finalizado,
// mais os atalhos OK e Em tratativa — seleção LIVRE, sem ordem obrigatória
// (usuário: "nem toda vez para em CTE, às vezes fica parado com fiscal").
// Reentrega continua um fluxo DIFERENTE (Data Programada + Data de Saída,
// "dias parado" simples, sem fiscal/CTE — a aba REENTREGA da planilha nem
// tem essas colunas).
// "Tratamento" ganhou PENDENTE (120 casos reais na planilha — carga com
// pendência tipo canhoto faltando, produto não entregue — usuário pediu
// pra usar o MESMO fluxo/telas já prontos, não uma aba separada).
//
// Reaproveita os MESMOS registros de recebimento_recusas (decisão de design
// já tomada no plano desta feature) — não é uma segunda fonte de dado, só
// uma tela nova olhando pro mesmo dado com outro recorte. A permissão de
// "editar" em recebimento_recusas já existe (firestore.rules) — NENHUMA
// regra nova foi necessária (evita o orçamento de sub-expressões que este
// projeto já estourou duas vezes). Módulo desta página só tem ação
// "visualizar" — quem pode mudar o status é checado manualmente contra a
// permissão 'editar' de recebimento-recusas (o módulo que já governa a
// escrita nesse registro), não uma ação granular nova.
(function (global) {
  'use strict';

  const COL_RECUSAS = 'recebimento_recusas';

  const STATUS_RETORNO_LABELS = {
    '': 'Aguard. Monitoramento',
    AGUARD_FISCAL: 'Aguard. Fiscal',
    EM_TRATATIVA: 'Em tratativa',
    OK: 'OK',
    CTE: 'CTE',
    ENDERECANDO: 'Endereçando',
    FINALIZADO: 'Finalizado',
  };
  const STATUS_CORES = {
    '': 'background:#4a3114;color:#ffd18a',
    AGUARD_FISCAL: 'background:#4a3114;color:#ffb347',
    EM_TRATATIVA: 'background:#3a2f52;color:#c9a8f5',
    OK: 'background:#1e3a5f;color:#8ecbff',
    CTE: 'background:#4a1f4a;color:#e8a8e8',
    ENDERECANDO: 'background:#1f4a2e;color:#8ee8a8',
    FINALIZADO: 'background:#15803d;color:#fff',
  };
  // Campo de data que fica gravado (1ª vez só) quando o status ENTRA nesse
  // valor — alimenta os 2 indicadores reais da planilha. "" (Aguard.
  // Monitoramento) = liberou pra recusar; AGUARD_FISCAL = solicitou ao
  // fiscal (é essa data, não a de "liberou", que entra no cálculo de "dias
  // parados no fiscal/CTE" — confirmado batendo os números reais da
  // planilha linha a linha). OK e EM_TRATATIVA nunca carimbam nada — são
  // atalhos sem burocracia/sem data associada na planilha real.
  const DATA_POR_STATUS = { '': 'liberadoParaRecusarEm', AGUARD_FISCAL: 'dataSolicitacaoFiscalEm', CTE: 'dataDaRecusaEm', ENDERECANDO: 'dataDoEnderecamentoEm' };

  let _recusas = [];
  let _filtroStatus = ''; // '' = todos, 'ABERTOS' = tudo que não é FINALIZADO, ou um status específico
  let _filtroTratamento = '';
  let _periodoInicio = '';
  let _periodoFim = '';

  function fs() {
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    if (global.firebase && typeof global.firebase.firestore === 'function') return global.firebase.firestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function usuarioAtual() {
    const u = global.firebase?.auth?.().currentUser;
    return u ? { uid: u.uid || '', email: u.email || '' } : { uid: '', email: '' };
  }
  function fmtDataHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return esc(v);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function ehReentrega(r) { return (r.tratamento || '') === 'REENTREGA'; }

  async function carregarDados() {
    const snap = await fs().collection(COL_RECUSAS).get();
    _recusas = snap.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  }

  function recusasFiltradas() {
    return _recusas.filter(r => {
      if (_periodoInicio || _periodoFim) {
        const d = r.criadoEm ? new Date(r.criadoEm) : null;
        if (!d || isNaN(d)) return false;
        if (_periodoInicio && d < new Date(_periodoInicio + 'T00:00:00')) return false;
        if (_periodoFim && d > new Date(_periodoFim + 'T23:59:59')) return false;
      }
      const status = r.statusRetorno || '';
      if (_filtroStatus === 'ABERTOS' && status === 'FINALIZADO') return false;
      if (_filtroStatus && _filtroStatus !== 'ABERTOS' && status !== _filtroStatus) return false;
      if (_filtroTratamento && (r.tratamento || '') !== _filtroTratamento) return false;
      return true;
    });
  }

  function diasEntre(inicioIso, fimIso) {
    if (!inicioIso) return null;
    const ini = new Date(inicioIso);
    const fim = fimIso ? new Date(fimIso) : new Date();
    if (isNaN(ini) || isNaN(fim)) return null;
    const dias = (fim - ini) / 86400000;
    return dias >= 0 ? dias : null;
  }
  // As 2 métricas REAIS da planilha (aba RECUSAS): "dias parados no
  // fiscal/CTE" (solicitou ao fiscal → recusa efetivada — CONFIRMADO
  // batendo os números reais da planilha linha a linha; usar "liberou" no
  // lugar de "solicitou" dá um valor diferente do real) e "dias de
  // operação" (chegada → endereçamento). Ainda em aberto conta até agora,
  // pra já refletir retorno parado há muito tempo numa etapa.
  function diasParadoFiscalCte(r) { return diasEntre(r.dataSolicitacaoFiscalEm, r.dataDaRecusaEm); }
  function diasOperacao(r) { return diasEntre(r.criadoEm, r.dataDoEnderecamentoEm); }
  // Reentrega usa um indicador mais simples, sem fiscal/CTE (a planilha tem
  // uma aba própria — REENTREGA — com "DIAS PARADO" único).
  function diasParadoReentrega(r) { return diasEntre(r.criadoEm, r.dataSaidaEm); }

  function mediaDe(lista, fn) {
    const valores = lista.map(fn).filter(v => v != null);
    if (!valores.length) return null;
    return Math.round((valores.reduce((s, x) => s + x, 0) / valores.length) * 10) / 10;
  }

  function kpis() {
    const filtradas = recusasFiltradas();
    const naoReentrega = filtradas.filter(r => !ehReentrega(r));
    const reentregas = filtradas.filter(ehReentrega);
    const porStatus = { '': 0, AGUARD_FISCAL: 0, EM_TRATATIVA: 0, OK: 0, CTE: 0, ENDERECANDO: 0, FINALIZADO: 0 };
    filtradas.forEach(r => { const s = r.statusRetorno || ''; if (s in porStatus) porStatus[s]++; });
    return {
      total: filtradas.length,
      emAberto: filtradas.length - porStatus.FINALIZADO,
      porStatus,
      mediaDiasParadoFiscalCte: mediaDe(naoReentrega, diasParadoFiscalCte),
      mediaDiasOperacao: mediaDe(naoReentrega, diasOperacao),
      mediaDiasParadoReentrega: mediaDe(reentregas, diasParadoReentrega),
    };
  }
  function graficoResumo() {
    const k = kpis();
    return [
      k.mediaDiasParadoFiscalCte != null ? { label: 'Parado no Fiscal/CTE', value: k.mediaDiasParadoFiscalCte } : null,
      k.mediaDiasOperacao != null ? { label: 'Dias de operação (total)', value: k.mediaDiasOperacao } : null,
      k.mediaDiasParadoReentrega != null ? { label: 'Reentrega — dias parado', value: k.mediaDiasParadoReentrega } : null,
    ].filter(Boolean);
  }

  // Pedido ao vivo do usuário ("nem toda vez para em CTE, às vezes fica
  // parado com fiscal"): status agora é seleção LIVRE, sem ordem forçada —
  // qualquer valor pode ser escolhido a qualquer momento. As datas
  // nomeadas (DATA_POR_STATUS) só são gravadas na 1ª vez que o status
  // ENTRA nesse valor — nunca sobrescritas, mesmo voltando pra trás.
  async function mudarStatusRetorno(recusaId, novoStatus) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    if ((r.statusRetorno || '') === novoStatus) return;
    const u = usuarioAtual();
    const evento = { status: novoStatus, em: new Date().toISOString(), por: u.email || u.uid || '' };
    const historico = [...(Array.isArray(r.statusRetornoHistorico) ? r.statusRetornoHistorico : []), evento];
    const payload = { statusRetorno: novoStatus, statusRetornoHistorico: historico };
    const campoData = DATA_POR_STATUS[novoStatus];
    if (campoData && !r[campoData]) payload[campoData] = evento.em;
    const select = document.querySelector('[data-status-mudar="' + recusaId + '"]');
    if (select) select.disabled = true;
    try {
      await fs().collection(COL_RECUSAS).doc(recusaId).update(payload);
      Object.assign(r, payload);
      desenhar();
      global.showToast?.('Status atualizado: ' + STATUS_RETORNO_LABELS[novoStatus], 'success');
    } catch (e) {
      global.showToast?.('Erro ao atualizar status: ' + (e.message || e), 'error');
      if (select) select.disabled = false;
    }
  }
  // Datas de Reentrega (Data Programada / Data de Saída) — campos livres,
  // editados direto, sem depender do status (igual à planilha real).
  async function salvarDataReentrega(recusaId, campo, valorData) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const iso = valorData ? new Date(valorData + 'T00:00:00').toISOString() : null;
    try {
      await fs().collection(COL_RECUSAS).doc(recusaId).update({ [campo]: iso });
      r[campo] = iso;
      desenhar();
    } catch (e) { global.showToast?.('Erro ao salvar data: ' + (e.message || e), 'error'); }
  }

  function badgeStatusHtml(status) {
    return `<span class="badge" style="${STATUS_CORES[status] || ''}">${esc(STATUS_RETORNO_LABELS[status] || status)}</span>`;
  }

  function resumoHtml() {
    const k = kpis();
    return `<div style="display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;margin:12px 0 4px">
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">TOTAL</div><div style="font-size:1.4rem;font-weight:850">${k.total}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">EM ABERTO</div><div style="font-size:1.4rem;font-weight:850;color:${k.emAberto ? '#dc2626' : 'inherit'}">${k.emAberto}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">AGUARD. MONIT.</div><div style="font-size:1.4rem;font-weight:850">${k.porStatus['']}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">NO FISCAL/CTE</div><div style="font-size:1.4rem;font-weight:850">${k.porStatus.AGUARD_FISCAL + k.porStatus.CTE}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">MÉDIA PARADO FISCAL/CTE</div><div style="font-size:1.4rem;font-weight:850">${k.mediaDiasParadoFiscalCte == null ? '—' : k.mediaDiasParadoFiscalCte + 'd'}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">MÉDIA DIAS DE OPERAÇÃO</div><div style="font-size:1.4rem;font-weight:850">${k.mediaDiasOperacao == null ? '—' : k.mediaDiasOperacao + 'd'}</div></div>
    </div>`;
  }

  function filtrosHtml() {
    return `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:10px 0">
      <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">STATUS</div><select class="field" id="status-filtro-status" style="padding:8px">
        <option value="" ${_filtroStatus===''?'selected':''}>Todos</option>
        <option value="ABERTOS" ${_filtroStatus==='ABERTOS'?'selected':''}>Em aberto (não finalizado)</option>
        ${Object.keys(STATUS_RETORNO_LABELS).filter(k=>k).map(k=>`<option value="${k}" ${k===_filtroStatus?'selected':''}>${esc(STATUS_RETORNO_LABELS[k])}</option>`).join('')}
      </select></div>
      <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">TRATAMENTO</div><select class="field" id="status-filtro-tratamento" style="padding:8px">
        <option value="" ${_filtroTratamento===''?'selected':''}>Todos</option>
        ${['RECUSA','DEVOLUCAO','REENTREGA','SUBSTITUICAO','PENDENTE','OUTRO'].map(t=>`<option value="${t}" ${t===_filtroTratamento?'selected':''}>${esc(t.charAt(0)+t.slice(1).toLowerCase())}</option>`).join('')}
      </select></div>
      <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">PERÍODO — DE</div><input type="date" class="field" id="status-periodo-ini" value="${esc(_periodoInicio)}" style="padding:8px"></div>
      <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input type="date" class="field" id="status-periodo-fim" value="${esc(_periodoFim)}" style="padding:8px"></div>
    </div>`;
  }

  // A escrita em recebimento_recusas já é 100% governada por
  // hasPermissionRecusas('editar') no firestore.rules — checa a MESMA
  // permissão aqui (não a do módulo desta página, que só tem
  // "visualizar") pra travar os controles de quem não tem 'editar' em vez
  // de deixar mexer e a escrita ser rejeitada pelo banco.
  function podeEditar() {
    return typeof global.temPermissao !== 'function' || global.temPermissao('recebimento-recusas', 'editar');
  }

  function isoParaInputDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }

  function celulaDetalheHtml(r, podeEditarFlag) {
    if (ehReentrega(r)) {
      const dias = diasParadoReentrega(r);
      return `<div style="display:flex;flex-direction:column;gap:4px;font-size:.72rem">
        <label>Programada: <input type="date" data-reentrega-data="${esc(r._id)}:dataProgramadaEm" value="${isoParaInputDate(r.dataProgramadaEm)}" ${podeEditarFlag ? '' : 'disabled'} style="padding:3px"></label>
        <label>Saída: <input type="date" data-reentrega-data="${esc(r._id)}:dataSaidaEm" value="${isoParaInputDate(r.dataSaidaEm)}" ${podeEditarFlag ? '' : 'disabled'} style="padding:3px"></label>
        <span style="color:var(--muted)">${dias == null ? '—' : Math.round(dias) + ' dia(s) parado'}</span>
      </div>`;
    }
    const parado = diasParadoFiscalCte(r);
    const operacao = diasOperacao(r);
    return `<div style="font-size:.72rem;color:var(--muted)">
      ${parado == null ? 'Ainda não solicitado ao fiscal' : Math.round(parado) + 'd parado fiscal/CTE'}<br>
      ${operacao == null ? 'Ainda não endereçado' : Math.round(operacao) + 'd de operação'}
    </div>`;
  }

  function tabelaHtml() {
    const lista = recusasFiltradas();
    if (!lista.length) return '<div class="empty"><div class="empty-icon">🧾</div><div class="empty-title">Nenhum retorno com esses filtros</div></div>';
    const podeEditarFlag = podeEditar();
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Data/Hora</th><th>Notas</th><th>Motorista</th><th>Conferente</th><th>Tratamento</th><th>Status</th><th>Detalhe</th></tr></thead><tbody>${lista.map(r => {
      const status = r.statusRetorno || '';
      // Reentrega não usa esse status (fluxo próprio, ver celulaDetalheHtml)
      // — pedido ao vivo do usuário, validado contra a planilha real: a
      // aba REENTREGA nem tem as colunas de fiscal/CTE.
      const statusSelect = ehReentrega(r)
        ? '<span style="color:var(--muted);font-size:.72rem">— (reentrega)</span>'
        : podeEditarFlag
          ? `<select class="field" style="padding:5px;font-size:.75rem" data-status-mudar="${esc(r._id)}">${Object.keys(STATUS_RETORNO_LABELS).map(k => `<option value="${k}" ${k===status?'selected':''}>${esc(STATUS_RETORNO_LABELS[k])}</option>`).join('')}</select>`
          : badgeStatusHtml(status);
      return `<tr><td>${fmtDataHora(r.criadoEm)}</td><td><b>${esc((r.notas || []).map(n => n.numeroNota).filter(Boolean).join(', ') || '—')}</b></td><td>${esc(r.motoristaNome || '—')}</td><td>${esc(r.conferenteNome || '—')}</td><td>${esc(r.tratamento || '—')}</td><td>${statusSelect}</td><td>${celulaDetalheHtml(r, podeEditarFlag)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-retornos-status');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">🧾 Status de Retornos</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Aguard. Monitoramento, Aguard. Fiscal, OK, Em tratativa, CTE, Endereçando ou Finalizado — escolha livre, sem ordem obrigatória. Reentrega usa Data Programada/Saída em vez disso.</div></div>
        <button class="btn btn-ghost" data-status-atualizar="1">↻ Atualizar</button>
      </div>
      ${resumoHtml()}
      <div class="tc" style="padding:16px;margin:14px 0"><div class="tc-title">📊 Tempo médio (dias)</div>${global.dashHorizontalBarChart ? global.dashHorizontalBarChart(graficoResumo(), { limit: 10 }) : ''}</div>
      <div class="tc" style="padding:16px">
        ${filtrosHtml()}
        <div id="status-tabela">${tabelaHtml()}</div>
      </div>`;

    if (!pagina._statusListenerBound) {
      pagina.addEventListener('click', ev => {
        if (ev.target.closest('[data-status-atualizar]')) { carregarDados().then(desenhar); }
      });
      pagina.addEventListener('change', ev => {
        if (ev.target.id === 'status-filtro-status') { _filtroStatus = ev.target.value || ''; desenhar(); return; }
        if (ev.target.id === 'status-filtro-tratamento') { _filtroTratamento = ev.target.value || ''; desenhar(); return; }
        if (ev.target.id === 'status-periodo-ini') { _periodoInicio = ev.target.value || ''; desenhar(); return; }
        if (ev.target.id === 'status-periodo-fim') { _periodoFim = ev.target.value || ''; desenhar(); return; }
        const selectStatus = ev.target.closest('[data-status-mudar]');
        if (selectStatus) { mudarStatusRetorno(selectStatus.dataset.statusMudar, selectStatus.value); return; }
        const inputReentrega = ev.target.closest('[data-reentrega-data]');
        if (inputReentrega) {
          const [id, campo] = inputReentrega.dataset.reentregaData.split(':');
          salvarDataReentrega(id, campo, inputReentrega.value);
        }
      });
      pagina._statusListenerBound = true;
    }
  }

  async function renderRecebimentoRetornosStatus() {
    const pagina = document.getElementById('page-recebimento-retornos-status');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-title">Carregando Status de Retornos...</div></div>';
    try { await carregarDados(); desenhar(); } catch (e) { pagina.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar Status de Retornos</div><div class="empty-sub">${esc(e.message || e)}</div></div>`; }
  }

  global.renderRecebimentoRetornosStatus = renderRecebimentoRetornosStatus;
  global._recebimentoRetornosStatusInternals = {
    STATUS_RETORNO_LABELS, DATA_POR_STATUS, diasParadoFiscalCte, diasOperacao, diasParadoReentrega, kpis, ehReentrega,
    setFiltroStatus(v) { _filtroStatus = v || ''; }, setFiltroTratamento(v) { _filtroTratamento = v || ''; },
    setPeriodo(ini, fim) { _periodoInicio = ini || ''; _periodoFim = fim || ''; },
  };
})(window);
