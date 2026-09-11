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

  // Ver mesmo bloco/comentário em 97-recebimento-recusas.js — objeto
  // compartilhado que marca as telas irmãs (Pátio/Indicadores/Status/
  // Recusas) como desatualizadas depois de uma edição, pra próxima vez que
  // o usuário entrar nelas já vir com dado fresco sem precisar clicar
  // "Atualizar" (PEDIDO AO VIVO 2026-09-11).
  global.DT_RETORNOS_DIRTY = global.DT_RETORNOS_DIRTY || { patio: false, indicadores: false, status: false, recusas: false };
  function _marcarRetornosDesatualizados(exceto) {
    Object.keys(global.DT_RETORNOS_DIRTY).forEach(k => { if (k !== exceto) global.DT_RETORNOS_DIRTY[k] = true; });
  }

  const COL_RECUSAS = 'recebimento_recusas';

  // Saldo do "Pátio em Tempo Real" (105-recebimento-patio-tempo-real.js) —
  // duplicado de propósito (bundle separado), MESMA regra usada nos 3
  // lugares que escrevem esses eventos (aqui, 97-recebimento-recusas.js/
  // alterarTratamento, e 24-recebimento-recusas.js do Coletor).
  function _estaNoPatio(doc, nota) {
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
  function _recalcularStatusFisico(doc) {
    const notas = Array.isArray(doc.notas) && doc.notas.length ? doc.notas : [{}];
    return notas.some(n => _estaNoPatio(doc, n)) ? 'NO_PATIO' : 'SAIU';
  }
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
  let _filtroStatus = ''; // '' = todos, 'ABERTOS' = tudo que não é FINALIZADO, ou um status específico
  let _filtroTratamento = '';
  let _periodoInicio = '';
  let _periodoFim = '';
  // PEDIDO AO VIVO (2026-09-09): a estrutura da tela (título, filtros,
  // botão Atualizar) não depende do Firestore pra existir — só a tabela
  // depende. desenhar() já é seguro com _recusas vazio (mostra zerado).
  let _statusCarregando = false;
  let _statusErro = '';
  // PEDIDO AO VIVO (2026-09-09): "os indicadores que tá demorando" —
  // carregarDados() buscava recebimento_recusas do zero toda vez, mesmo
  // reentrando na tela segundos depois. Só busca de novo quando ainda não
  // carregou nada, ou quando pedido explicitamente (Atualizar/Tentar de
  // novo).
  const DIAS_MAX_PERIODO = 92; // ~3 meses — PEDIDO AO VIVO (2026-09-10)
  let _periodoBuscado = ''; // chave "ini|fim" do último período buscado com sucesso — vazio = ainda não buscou

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

  // Sem timeout artificial: uma coleção grande pode legitimamente levar
  // mais tempo, e Promise.race com timeout não cancela a busca real, só
  // desiste de esperar — a estrutura da tela já aparece na hora (ver
  // renderRecebimentoRetornosStatus/_atualizarDados), então uma consulta
  // lenta não deixa mais a tela em branco, só demora um pouco pra
  // atualizar os dados.
  function _periodoPadrao() {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - (DIAS_MAX_PERIODO - 1) * 86400000);
    return { ini: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
  }
  function _periodoValido(ini, fim) {
    if (!ini || !fim) return false;
    const dIni = new Date(ini + 'T00:00:00'), dFim = new Date(fim + 'T23:59:59');
    if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime()) || dIni > dFim) return false;
    return (dFim - dIni) / 86400000 <= DIAS_MAX_PERIODO;
  }
  // PEDIDO AO VIVO (2026-09-11): "a parte do Analista pode puxar do
  // BigQuery, 1 a 5 minutos de atraso não tem problema" — mesma Cloud
  // Function já criada pra Indicadores de Retornos (98) e Notas Retornadas
  // (97): mesmo filtro (loja + período + exclusão de origem:'AUTOMATICO'),
  // devolve os documentos crus no mesmo formato {_id, ...dados}. As ações
  // de clique desta tela (mudarStatusRetorno/salvarDataReentrega) não
  // mudam — continuam gravando direto no Firestore.
  // BUG AO VIVO REAL (2026-09-11, achado no log do servidor em Cargas/
  // Transbordo): sem trava contra chamada concorrente, uma navegação
  // disparando o render mais de uma vez (ou clique duplo) enquanto a
  // busca ainda não voltou cria uma consulta NOVA em cima da anterior.
  // `_statusCarregandoPromise` garante que quem chegar nesse meio tempo
  // espera a MESMA promessa.
  let _statusCarregandoPromise = null;
  async function carregarDados(ini, fim, forcar) {
    if (!_periodoValido(ini, fim)) throw new Error('Escolha um período válido de até 3 meses.');
    const chave = ini + '|' + fim;
    if (_periodoBuscado === chave && !forcar) return;
    if (_statusCarregandoPromise) return _statusCarregandoPromise;
    _statusCarregandoPromise = (async () => {
      const lojaId = typeof global.getDTLojaAtiva === 'function' ? global.getDTLojaAtiva() : '';
      if (!lojaId) throw new Error('Nenhuma loja selecionada.');
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarIndicadoresRetornosBigQuery');
      const resposta = await callable({ lojaId, ini, fim });
      const docs = (resposta && resposta.data && resposta.data.recusas) || [];
      // PEDIDO AO VIVO (2026-08-31): devolução auto-gravada (origem:
      // 'AUTOMATICO') já nasce CONFERIDA — não tem sentido nenhum ela
      // ficar "Aguard. Monitoramento"/fiscal/CTE, esse fluxo é só pra
      // recebimento físico real processado pelo Coletor. Indicador
      // próprio em 102-devolucoes-bi-indicadores.js.
      _recusas = docs.filter(x => x.origem !== 'AUTOMATICO' && x.motivoAutomaticoTexto == null).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
      _periodoBuscado = chave;
    })();
    try {
      await _statusCarregandoPromise;
    } finally {
      _statusCarregandoPromise = null;
    }
  }

  // PEDIDO AO VIVO (2026-09-08): roda sobre `linhasPorNota(_recusas)` (1
  // linha por nota, não por documento) — o resto do arquivo (kpis, tabela,
  // médias de dias parado) já opera em cima do que isto devolve, sem
  // precisar saber que antes era por documento.
  function recusasFiltradas() {
    return linhasPorNota(_recusas).filter(r => {
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

  // PEDIDO AO VIVO (2026-09-08): Status (e as datas nomeadas) passaram de
  // campo do documento pra campo de cada item de `notas[]` — mesmo mote de
  // `alterarTratamento` em 97-recebimento-recusas.js. `recusaId` acha o
  // documento, `notaChave` acha QUAL nota dentro dele; se o documento
  // ainda não tem `notas` real (registro bem antigo), cria o placeholder
  // que a tela já mostrava (mesmo comportamento de `linhasPorNota`).
  function _acharOuCriarNota(r, notaChave) {
    const notas = Array.isArray(r.notas) ? r.notas.slice() : [];
    let idx = notas.findIndex(n => (n.chave || '') === notaChave);
    if (idx === -1) { if (notas.length) return null; idx = 0; notas.push({}); }
    return { notas, idx };
  }

  // Pedido ao vivo do usuário ("nem toda vez para em CTE, às vezes fica
  // parado com fiscal"): status agora é seleção LIVRE, sem ordem forçada —
  // qualquer valor pode ser escolhido a qualquer momento. As datas
  // nomeadas (DATA_POR_STATUS) só são gravadas na 1ª vez que o status
  // ENTRA nesse valor — nunca sobrescritas, mesmo voltando pra trás. Se o
  // documento antigo já tinha essa data (de antes desta migração), a NOTA
  // herda o valor real em vez de carimbar "agora" na 1ª edição pós-
  // migração — não perde histórico de verdade.
  async function mudarStatusRetorno(recusaId, notaChave, novoStatus) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const achado = _acharOuCriarNota(r, notaChave);
    if (!achado) return;
    const { notas, idx } = achado;
    const nota = notas[idx];
    const statusAtual = nota.statusRetorno != null ? nota.statusRetorno : (r.statusRetorno || '');
    if (statusAtual === novoStatus) return;
    const u = usuarioAtual();
    const evento = { status: novoStatus, em: new Date().toISOString(), por: u.email || u.uid || '' };
    const historicoBase = Array.isArray(nota.statusRetornoHistorico) ? nota.statusRetornoHistorico
      : (Array.isArray(r.statusRetornoHistorico) ? r.statusRetornoHistorico : []);
    const patchNota = { statusRetorno: novoStatus, statusRetornoHistorico: [...historicoBase, evento] };
    const campoData = DATA_POR_STATUS[novoStatus];
    if (campoData && !nota[campoData]) patchNota[campoData] = r[campoData] || evento.em;
    const select = document.querySelector('[data-status-mudar="' + recusaId + '|' + notaChave + '"]');
    if (select) select.disabled = true;
    try {
      const notasAtualizadas = notas.map((n, i) => i === idx ? Object.assign({}, n, patchNota) : n);
      const statusFisico = _recalcularStatusFisico(Object.assign({}, r, { notas: notasAtualizadas }));
      await fs().collection(COL_RECUSAS).doc(recusaId).update({ notas: notasAtualizadas, statusFisico });
      r.notas = notasAtualizadas;
      r.statusFisico = statusFisico;
      desenhar();
      _marcarRetornosDesatualizados('status');
      global.showToast?.('Status atualizado: ' + STATUS_RETORNO_LABELS[novoStatus], 'success');
    } catch (e) {
      global.showToast?.('Erro ao atualizar status: ' + (e.message || e), 'error');
      if (select) select.disabled = false;
    }
  }
  // Datas de Reentrega (Data Programada / Data de Saída) — campos livres,
  // editados direto, sem depender do status (igual à planilha real). Por
  // NOTA, mesmo mecanismo de mudarStatusRetorno acima.
  async function salvarDataReentrega(recusaId, notaChave, campo, valorData) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const achado = _acharOuCriarNota(r, notaChave);
    if (!achado) return;
    const { notas, idx } = achado;
    const iso = valorData ? new Date(valorData + 'T00:00:00').toISOString() : null;
    try {
      const notasAtualizadas = notas.map((n, i) => i === idx ? Object.assign({}, n, { [campo]: iso }) : n);
      const statusFisico = _recalcularStatusFisico(Object.assign({}, r, { notas: notasAtualizadas }));
      await fs().collection(COL_RECUSAS).doc(recusaId).update({ notas: notasAtualizadas, statusFisico });
      r.notas = notasAtualizadas;
      r.statusFisico = statusFisico;
      desenhar();
      _marcarRetornosDesatualizados('status');
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
      <button class="btn btn-primary btn-sm" id="status-buscar-periodo" style="padding:8px 14px">🔍 Buscar</button>
      <div style="font-size:.64rem;color:var(--muted);align-self:center">Máx. 3 meses</div>
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
        <label>Programada: <input type="date" data-reentrega-data="${esc(r._recusaId)}|${esc(r._notaChave)}:dataProgramadaEm" value="${isoParaInputDate(r.dataProgramadaEm)}" ${podeEditarFlag ? '' : 'disabled'} style="padding:3px"></label>
        <label>Saída: <input type="date" data-reentrega-data="${esc(r._recusaId)}|${esc(r._notaChave)}:dataSaidaEm" value="${isoParaInputDate(r.dataSaidaEm)}" ${podeEditarFlag ? '' : 'disabled'} style="padding:3px"></label>
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
    if (!_periodoBuscado) return '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">Escolha o período e clique em Buscar</div></div>';
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
          ? `<select class="field" style="padding:5px;font-size:.75rem" data-status-mudar="${esc(r._recusaId)}|${esc(r._notaChave)}">${Object.keys(STATUS_RETORNO_LABELS).map(k => `<option value="${k}" ${k===status?'selected':''}>${esc(STATUS_RETORNO_LABELS[k])}</option>`).join('')}</select>`
          : badgeStatusHtml(status);
      return `<tr><td>${fmtDataHora(r.criadoEm)}</td><td><b>${esc((r.notas || []).map(n => n.numeroNota).filter(Boolean).join(', ') || '—')}</b></td><td>${esc(r.motoristaNome || '—')}</td><td>${esc(r.conferenteNome || '—')}</td><td>${esc(r.tratamento || '—')}</td><td>${statusSelect}</td><td>${celulaDetalheHtml(r, podeEditarFlag)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  // Banner pequeno, só sobre a área de dados — nunca substitui a tela
  // inteira (pedido ao vivo: a estrutura tem que aparecer na hora).
  function _statusCarregandoHtml() {
    if (_statusCarregando) return '<div style="font-size:.76rem;color:var(--muted);margin:8px 0">🔄 Atualizando...</div>';
    if (_statusErro) return '<div style="font-size:.76rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;gap:10px"><span>⚠️ Não foi possível atualizar: ' + esc(_statusErro) + '</span><button type="button" class="btn btn-ghost btn-sm" data-status-tentar-de-novo="1">Tentar de novo</button></div>';
    return '';
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-retornos-status');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">🧾 Status de Retornos</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Aguard. Monitoramento, Aguard. Fiscal, OK, Em tratativa, CTE, Endereçando ou Finalizado — escolha livre, sem ordem obrigatória. Reentrega usa Data Programada/Saída em vez disso.</div></div>
        <button class="btn btn-ghost" data-status-atualizar="1">↻ Atualizar</button>
      </div>
      ${_statusCarregandoHtml()}
      ${resumoHtml()}
      <div class="tc" style="padding:16px;margin:14px 0"><div class="tc-title">📊 Tempo médio (dias)</div>${global.dashHorizontalBarChart ? global.dashHorizontalBarChart(graficoResumo(), { limit: 10 }) : ''}</div>
      <div class="tc" style="padding:16px">
        ${filtrosHtml()}
        <div id="status-tabela">${tabelaHtml()}</div>
      </div>`;

    if (!pagina._statusListenerBound) {
      pagina.addEventListener('click', ev => {
        if (ev.target.closest('[data-status-tentar-de-novo]')) { _atualizarDadosNoPeriodo(true); return; }
        if (ev.target.closest('[data-status-atualizar]')) { _atualizarDadosNoPeriodo(true); return; }
        if (ev.target.id === 'status-buscar-periodo') {
          if (!_periodoValido(_periodoInicio, _periodoFim)) { global.showToast?.('Escolha um período válido de até 3 meses.', 'error'); return; }
          _atualizarDadosNoPeriodo(true);
        }
      });
      pagina.addEventListener('change', ev => {
        if (ev.target.id === 'status-filtro-status') { _filtroStatus = ev.target.value || ''; desenhar(); return; }
        if (ev.target.id === 'status-filtro-tratamento') { _filtroTratamento = ev.target.value || ''; desenhar(); return; }
        if (ev.target.id === 'status-periodo-ini' || ev.target.id === 'status-periodo-fim') {
          _periodoInicio = document.getElementById('status-periodo-ini')?.value || '';
          _periodoFim = document.getElementById('status-periodo-fim')?.value || '';
          if (_periodoInicio && _periodoFim && !_periodoValido(_periodoInicio, _periodoFim)) {
            if (ev.target.id === 'status-periodo-ini') _periodoFim = new Date(new Date(_periodoInicio + 'T00:00:00').getTime() + DIAS_MAX_PERIODO * 86400000).toISOString().slice(0, 10);
            else _periodoInicio = new Date(new Date(_periodoFim + 'T00:00:00').getTime() - DIAS_MAX_PERIODO * 86400000).toISOString().slice(0, 10);
            global.showToast?.('Período ajustado — máximo de 3 meses.', 'i');
          }
          desenhar();
          return;
        }
        const selectStatus = ev.target.closest('[data-status-mudar]');
        if (selectStatus) {
          const [recusaId, notaChave] = String(selectStatus.dataset.statusMudar).split('|');
          mudarStatusRetorno(recusaId, notaChave, selectStatus.value);
          return;
        }
        const inputReentrega = ev.target.closest('[data-reentrega-data]');
        if (inputReentrega) {
          const [idNota, campo] = inputReentrega.dataset.reentregaData.split(':');
          const [recusaId, notaChave] = idNota.split('|');
          salvarDataReentrega(recusaId, notaChave, campo, inputReentrega.value);
        }
      });
      pagina._statusListenerBound = true;
    }
  }

  // PEDIDO AO VIVO (2026-09-09): "a tela precisa ficar o tempo todo em
  // carregamento sem mostrar nem a estrutura?" — desenhar() já é seguro com
  // _recusas vazio, então chama ela ANTES do fetch (estrutura/filtros/
  // botão aparecem na hora) e de novo depois (com o dado real ou o aviso de
  // erro, sem nunca esconder a estrutura). Usada tanto no 1º carregamento
  // quanto nos botões "Atualizar"/"Tentar de novo".
  // PEDIDO AO VIVO (2026-09-10): busca manual — só chama carregarDados()
  // quando pedida de verdade (Buscar/Atualizar/Tentar de novo), nunca
  // sozinha ao entrar na tela.
  async function _atualizarDadosNoPeriodo(forcar) {
    _statusCarregando = true;
    _statusErro = '';
    desenhar();
    try { await carregarDados(_periodoInicio, _periodoFim, forcar); } catch (e) { _statusErro = e.message || String(e); }
    _statusCarregando = false;
    desenhar();
  }

  async function renderRecebimentoRetornosStatus() {
    const pagina = document.getElementById('page-recebimento-retornos-status');
    if (!pagina) return;
    if (!_periodoInicio || !_periodoFim) {
      const p = _periodoPadrao();
      _periodoInicio = _periodoInicio || p.ini;
      _periodoFim = _periodoFim || p.fim;
    }
    // PEDIDO AO VIVO (2026-09-11): se algo mudou em Notas Retornadas (ou
    // noutra tela irmã) desde a última vez que ESTA tela já carregou dados,
    // refaz a busca sozinha uma vez ao entrar — sem exigir clique em
    // "Atualizar". Só dispara quando já havia algo carregado antes (não
    // força a 1ª busca, que continua manual por decisão de hoje mais cedo).
    if (global.DT_RETORNOS_DIRTY && global.DT_RETORNOS_DIRTY.status && _periodoBuscado) {
      global.DT_RETORNOS_DIRTY.status = false;
      await _atualizarDadosNoPeriodo(true);
      return;
    }
    desenhar();
  }

  global.renderRecebimentoRetornosStatus = renderRecebimentoRetornosStatus;
  global._recebimentoRetornosStatusInternals = {
    STATUS_RETORNO_LABELS, DATA_POR_STATUS, diasParadoFiscalCte, diasOperacao, diasParadoReentrega, kpis, ehReentrega,
    setFiltroStatus(v) { _filtroStatus = v || ''; }, setFiltroTratamento(v) { _filtroTratamento = v || ''; },
    setPeriodo(ini, fim) { _periodoInicio = ini || ''; _periodoFim = fim || ''; },
  };
})(window);
