// Recebimento > Notas Retornadas > Indicadores de Recusas (FASE 13)
// PEDIDO AO VIVO (2026-09-03, pt. 3): "aquela média dias para finalizar,
// trata só pra recusa"... "uma nota de recusa... a partir do momento que
// ela foi liberada pra recusa... liberou a nota emitida no dia 1º, ela
// retornou dia 2, mas se ficar parada há dez dias... lá no dia 11/12 que
// foi liberado pra recusa. A partir desse dia que vai começar a contar a
// média de dias parado... crie uma nova aba, nome recusas, que vai mostrar
// só as notas que são de recusas. A outra lá já fica geral."
//
// 98-recebimento-retornos-indicadores.js CONTINUA intocada (a "geral" que o
// usuário pediu pra manter) — mistura todo tratamento (recusa/devolução/
// reentrega/substituição/pendente/outro) e conta os dias a partir da
// EMISSÃO da nota. Esta tela nova só olha tratamento==='RECUSA' e conta os
// dias a partir de `liberadoParaRecusarEm` (carimbado em 97-recebimento-
// recusas.js/alterarTratamento, na 1ª vez que vira Recusa — nunca antes
// disso, porque o campo não existia de verdade pras notas novas) até a
// nota entrar em status FINALIZADO (statusRetornoHistorico, ver 99-
// recebimento-retornos-status.js) — ou "agora", se ainda em aberto (mesma
// convenção do diasEntre() de lá: ainda parado conta pra média, pra não
// esconder quem está preso há muito tempo).
//
// Notas classificadas como Recusa ANTES desta correção não têm
// liberadoParaRecusarEm — ficam de fora da média (não tem como saber
// quando "liberaram" de verdade), mas continuam contadas no total/tabela,
// com um aviso explícito (nunca um valor inventado).
(function (global) {
  'use strict';

  const COL_RECUSAS = 'recebimento_recusas';

  // PEDIDO AO VIVO (2026-09-08): "cada nota tem que gerar uma linha... se
  // ela tiver junta e uma for reentrega e a outra for recusa" — um
  // documento de recebimento_recusas é 1 EVENTO de conferência (motorista
  // chegou com N notas bipadas juntas), mas Tratamento/Status precisam ser
  // decididos por NOTA, não pro evento inteiro. Campos novos ficam DENTRO
  // de cada item de `notas[i]` (opcionais — ausente = nunca editado nesta
  // nota desde esta migração, cai pro valor antigo do documento, que
  // continua intocado, cobrindo 100% do histórico sem migração em massa).
  // Duplicada de propósito em 97/99/103 (mesmo padrão de
  // `_agruparNotasBiPorChave`, duplicada entre 97 e 100 — telas
  // independentes, sem acoplar).
  const CAMPOS_POR_NOTA = ['tratamento', 'tratamentoDefinidoEm', 'tratamentoDefinidoPor',
    'liberadoParaRecusarEm', 'statusRetorno', 'statusRetornoHistorico',
    'dataSolicitacaoFiscalEm', 'dataDaRecusaEm', 'dataDoEnderecamentoEm',
    'dataProgramadaEm', 'dataSaidaEm'];
  function _linhaDaNota(r, nota) {
    const linha = Object.assign({}, r, { notas: [nota], _recusaId: r._id, _notaChave: nota.chave || '' });
    CAMPOS_POR_NOTA.forEach(c => { linha[c] = nota[c] != null ? nota[c] : r[c]; });
    if (linha.tratamento == null) linha.tratamento = '';
    if (linha.statusRetorno == null) linha.statusRetorno = '';
    if (!Array.isArray(linha.statusRetornoHistorico)) linha.statusRetornoHistorico = [];
    return linha;
  }
  function linhasPorNota(recusas) {
    const linhas = [];
    recusas.forEach(r => (Array.isArray(r.notas) && r.notas.length ? r.notas : [{}]).forEach(n => linhas.push(_linhaDaNota(r, n))));
    return linhas;
  }

  let _recusas = [];
  let _periodoInicio = '';
  let _periodoFim = '';
  let _filtroStatusSet = new Set();

  function fs() {
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    if (global.firebase && typeof global.firebase.firestore === 'function') return global.firebase.firestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function fmtDataHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return esc(v);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // PEDIDO AO VIVO (2026-09-09): "os indicadores que tá demorando" — sem
  // cache, refazia essa busca do zero toda vez que reentrava na tela.
  let _carregadoRecusasIndic = false;
  async function carregarDados(forcar) {
    if (_carregadoRecusasIndic && !forcar) return;
    const snap = await fs().collection(COL_RECUSAS).get();
    // Mesma exclusão de devolução automática que as outras telas de
    // indicadores (origem:'AUTOMATICO' nunca é uma recusa de verdade —
    // ver 98/99/102) — e aqui SÓ o tratamento explicitamente marcado como
    // Recusa entra ("trata só pra recusa").
    const docsBrutos = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .filter(x => x.origem !== 'AUTOMATICO' && x.motivoAutomaticoTexto == null);
    // PEDIDO AO VIVO (2026-09-08): achata por NOTA antes de filtrar — cada
    // nota decide por si se é Recusa, não mais o documento (evento)
    // inteiro. Um evento com 1 nota Recusa e outra Reentrega agora só
    // traz a nota Recusa pra cá.
    _recusas = linhasPorNota(docsBrutos).filter(x => (x.tratamento || '') === 'RECUSA');
    _filtroStatusSet = new Set();
    _carregadoRecusasIndic = true;
  }

  function statusLabels() {
    return (global._recebimentoRetornosStatusInternals && global._recebimentoRetornosStatusInternals.STATUS_RETORNO_LABELS) || { '': 'Aguard. Monitoramento' };
  }
  function labelStatusDe(r) {
    const v = r.statusRetorno || '';
    const labels = statusLabels();
    return labels[v] || v || 'Aguard. Monitoramento';
  }

  // Data em que a recusa entrou em FINALIZADO pela 1ª vez — statusRetorno-
  // Historico é gravado a cada mudança de status (99-recebimento-retornos-
  // status.js/mudarStatusRetorno), então dá pra achar exatamente quando ela
  // cruzou a linha de chegada, mesmo que o status mude de novo depois.
  function dataFinalizacaoDe(r) {
    const hist = Array.isArray(r.statusRetornoHistorico) ? r.statusRetornoHistorico : [];
    const evento = hist.find(e => e && e.status === 'FINALIZADO');
    return evento ? evento.em : null;
  }
  function diasEntre(inicioIso, fimIso) {
    if (!inicioIso) return null;
    const ini = new Date(inicioIso);
    const fim = fimIso ? new Date(fimIso) : new Date();
    if (isNaN(ini) || isNaN(fim)) return null;
    const dias = (fim - ini) / 86400000;
    return dias >= 0 ? dias : null;
  }
  // A métrica central desta tela — dias entre "liberada pra recusa" e
  // "finalizada" (ou até agora, se ainda aberta). NUNCA usa dataEmissao/
  // criadoEm (isso é o que 98-recebimento-retornos-indicadores.js já faz,
  // "geral" — o pedido foi corrigir só aqui, pra recusa).
  function diasParadoDaRecusa(r) {
    return diasEntre(r.liberadoParaRecusarEm, dataFinalizacaoDe(r));
  }

  function recusaPassaPeriodo(r) {
    if (!_periodoInicio && !_periodoFim) return true;
    const d = r.criadoEm ? new Date(r.criadoEm) : null;
    if (!d || isNaN(d)) return false;
    if (_periodoInicio && d < new Date(_periodoInicio + 'T00:00:00')) return false;
    if (_periodoFim && d > new Date(_periodoFim + 'T23:59:59')) return false;
    return true;
  }
  function recusaPassaFiltros(r) {
    if (!recusaPassaPeriodo(r)) return false;
    if (_filtroStatusSet.size && !_filtroStatusSet.has(labelStatusDe(r))) return false;
    return true;
  }
  function recusasFiltradas() { return _recusas.filter(recusaPassaFiltros); }

  function kpis() {
    const filtradas = recusasFiltradas();
    const comLiberacao = filtradas.filter(r => r.liberadoParaRecusarEm);
    const finalizadas = filtradas.filter(r => (r.statusRetorno || '') === 'FINALIZADO').length;
    const validos = comLiberacao.map(diasParadoDaRecusa).filter(d => d != null);
    const mediaDias = validos.length ? Math.round((validos.reduce((s, x) => s + x, 0) / validos.length) * 10) / 10 : null;
    return {
      total: filtradas.length,
      finalizadas,
      emAberto: filtradas.length - finalizadas,
      semLiberacao: filtradas.length - comLiberacao.length,
      mediaDias,
    };
  }

  function resumoHtml() {
    const k = kpis();
    return `<div style="display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:10px;margin:12px 0 4px">
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">RECUSAS</div><div style="font-size:1.45rem;font-weight:850">${k.total}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">EM ABERTO</div><div style="font-size:1.45rem;font-weight:850;color:${k.emAberto ? '#dc2626' : 'inherit'}">${k.emAberto}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">FINALIZADAS</div><div style="font-size:1.45rem;font-weight:850">${k.finalizadas}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">MÉDIA DE DIAS PARADO</div><div style="font-size:1.45rem;font-weight:850">${k.mediaDias == null ? '—' : k.mediaDias + 'd'}</div></div>
      <div class="tc" style="padding:14px;${k.semLiberacao ? 'border-color:#7a4a1f' : ''}"><div style="font-size:.72rem;color:var(--muted)">SEM DATA DE LIBERAÇÃO</div><div style="font-size:1.45rem;font-weight:850;${k.semLiberacao ? 'color:#ffd18a' : ''}">${k.semLiberacao}</div></div>
    </div>
    ${k.semLiberacao ? `<div style="padding:10px 12px;border-radius:9px;background:#4a3114;color:#ffd18a;font-size:.76rem;margin-bottom:4px">⚠️ ${k.semLiberacao} recusa(s) foram classificadas como Recusa antes desta contagem existir — não têm data de liberação registrada, então ficam de fora da média (não dá pra inventar quando "liberaram" de verdade). Mudar o Tratamento delas (mesmo que seja pra Recusa de novo) NÃO carimba retroativamente.</div>` : ''}`;
  }

  function painelStatusHtml() {
    const vistos = new Set();
    _recusas.filter(recusaPassaPeriodo).forEach(r => vistos.add(labelStatusDe(r)));
    const opcoes = [...vistos].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!opcoes.length) return '';
    return `<div style="width:fit-content;flex:0 0 auto">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:.74rem;font-weight:700;color:var(--text);text-transform:uppercase;white-space:nowrap">Status</div>
        ${_filtroStatusSet.size ? '<button class="btn btn-ghost btn-sm" data-recind-painel-limpar="1" style="padding:1px 6px;font-size:.64rem;white-space:nowrap">limpar</button>' : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:7px;max-height:180px;overflow:auto">
        ${opcoes.map(v => `<label style="display:flex;align-items:center;gap:7px;font-size:.78rem;color:var(--text);cursor:pointer;white-space:nowrap">
          <input type="checkbox" data-recind-painel-valor="${esc(v)}" ${_filtroStatusSet.has(v) ? 'checked' : ''}>
          ${esc(v)}
        </label>`).join('')}
      </div>
    </div>`;
  }

  function tabelaHtml() {
    // Mais parado primeiro (nunca finalizado) — é o que precisa de atenção.
    const lista = [...recusasFiltradas()].sort((a, b) => {
      const da = diasParadoDaRecusa(a), db = diasParadoDaRecusa(b);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return db - da;
    });
    if (!lista.length) return '<div class="empty"><div class="empty-icon">🧾</div><div class="empty-title">Nenhuma recusa com esses filtros</div></div>';
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Notas</th><th>Mercado</th><th>Liberada em</th><th>Status</th><th>Dias parado</th></tr></thead><tbody>${lista.map(r => {
      const dias = diasParadoDaRecusa(r);
      const finalizada = (r.statusRetorno || '') === 'FINALIZADO';
      return `<tr>
        <td><b>${esc((r.notas || []).map(n => n.numeroNota).filter(Boolean).join(', ') || '—')}</b></td>
        <td>${esc(r.destinatario || (r.notas && r.notas[0] && r.notas[0].destinatario) || '—')}</td>
        <td>${r.liberadoParaRecusarEm ? fmtDataHora(r.liberadoParaRecusarEm) : '<span style="color:#ffd18a">— sem data</span>'}</td>
        <td>${esc(labelStatusDe(r))}</td>
        <td style="font-weight:800;${!finalizada && dias != null && dias > 7 ? 'color:#dc2626' : ''}">${dias == null ? '—' : Math.round(dias) + 'd'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-recusas-indicadores');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">📊 Recusas</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Só notas com Tratamento = Recusa. "Dias parado" conta a partir de quando a nota foi liberada pra recusa (Tratamento definido), não da emissão — separado da visão geral em Indicadores de Retornos.</div></div>
        <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap">
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">PERÍODO (REGISTRO) — DE</div><input type="date" class="field" id="recind-periodo-ini" value="${esc(_periodoInicio)}" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input type="date" class="field" id="recind-periodo-fim" value="${esc(_periodoFim)}" style="padding:7px"></div>
          ${(_periodoInicio || _periodoFim) ? '<button class="btn btn-ghost btn-sm" data-recind-limpar-periodo="1">✕ período</button>' : ''}
          <button class="btn btn-ghost" data-recind-atualizar="1">↻ Atualizar</button>
        </div>
      </div>
      <div style="display:flex;gap:40px;flex-wrap:wrap;align-items:flex-start;margin:14px 0">${painelStatusHtml()}</div>
      ${resumoHtml()}
      <div class="tc" style="padding:16px;margin-top:14px"><div class="tc-title">🧾 Recusas (mais paradas primeiro)</div>${tabelaHtml()}</div>`;

    if (!pagina._recindListenerBound) {
      pagina.addEventListener('click', ev => {
        if (ev.target.closest('[data-recind-limpar-periodo]')) { _periodoInicio = ''; _periodoFim = ''; desenhar(); return; }
        if (ev.target.closest('[data-recind-painel-limpar]')) { _filtroStatusSet.clear(); desenhar(); return; }
      });
      pagina.addEventListener('change', ev => {
        if (ev.target.id === 'recind-periodo-ini') { _periodoInicio = ev.target.value || ''; desenhar(); return; }
        if (ev.target.id === 'recind-periodo-fim') { _periodoFim = ev.target.value || ''; desenhar(); return; }
        const chk = ev.target.closest('[data-recind-painel-valor]');
        if (chk) {
          const valor = chk.getAttribute('data-recind-painel-valor');
          if (chk.checked) _filtroStatusSet.add(valor); else _filtroStatusSet.delete(valor);
          desenhar();
        }
      });
      pagina._recindListenerBound = true;
    }
    const btnAtualizar = document.querySelector('[data-recind-atualizar]');
    if (btnAtualizar) btnAtualizar.addEventListener('click', async () => { await carregarDados(true); desenhar(); });
  }

  async function renderRecusasIndicadores() {
    const pagina = document.getElementById('page-recebimento-recusas-indicadores');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-title">Carregando Indicadores de Recusas...</div></div>';
    try { await carregarDados(); desenhar(); } catch (e) { pagina.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar Indicadores de Recusas</div><div class="empty-sub">${esc(e.message || e)}</div></div>`; }
  }

  global.renderRecusasIndicadores = renderRecusasIndicadores;
  global._recusasIndicadoresInternals = {
    kpis, diasParadoDaRecusa, dataFinalizacaoDe,
    getRecusas: () => _recusas,
    setPeriodo(ini, fim) { _periodoInicio = ini || ''; _periodoFim = fim || ''; }, getPeriodo() { return { ini: _periodoInicio, fim: _periodoFim }; },
    setFiltroStatus(arr) { _filtroStatusSet = new Set(arr || []); }, getFiltroStatus() { return [..._filtroStatusSet]; },
  };
})(window);
