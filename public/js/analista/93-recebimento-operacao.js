// Recebimento — Recebimentos/Operação (fase 15/FASE 2b). Núcleo operacional
// do módulo: tabela de cargas com status guardado (seção 12 do pedido —
// não deixa pular etapa) e cálculo automático dos 4 tempos (espera,
// descarga, total, até fechamento). "+ Novo Recebimento" aqui é o
// equivalente manual do 1º bip do Coletor (que chega na FASE 4) — mesma
// coleção `recebimentos`, mesmos campos; o Coletor só vai passar a escrever
// no mesmo lugar depois, nunca numa base separada (seção 21 do pedido).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_RECEBIMENTOS = 'recebimentos';
  const COL_AUDITORIA = 'recebimento_auditoria';
  const COL_ROTAS = 'recebimento_rotas_transbordo';
  const ITENS_POR_PAGINA = 50;

  let _recebimentos = [];
  let _motoristas = [];
  let _veiculos = [];
  let _docas = [];
  let _rotas = [];
  let _cadastrosAuxCarregados = false;
  let _cadastrosAuxPromise = null;
  let _carregado = false;
  let _carregando = false;
  let _carregamentoPromise = null;
  let _erroCarregamento = '';
  let _lojaCarregada = '';
  let _assinaturaTempoReal = '';
  let _pagina = 1;
  let _filtroHoje = false;
  let _notasEditando = [];
  let _agendasCompra = [];

  // ── Organização em 3 abas (pedido ao vivo do usuário) — substitui o
  // filtro de status solto por um agrupamento fixo, mais fácil de ler de
  // relance: o que ainda não chegou, o que já está sendo processado na
  // filial, e o que já foi concluído/cancelado (histórico).
  const ABA_STATUS = {
    transito: ['PREVISTO', 'EM_TRANSITO'],
    andamento: ['CHEGOU', 'AGUARDANDO_DOCA', 'EM_DESCARGA', 'DESCARGA_FINALIZADA', 'EM_CONFERENCIA', 'ATRASADO'],
    finalizados: ['FINALIZADO', 'CANCELADO'],
  };
  const ABA_INFO = {
    transito: { label: '🚛 Em Trânsito', sub: 'Gerado, mas ainda não chegou na filial' },
    andamento: { label: '📦 Em Andamento', sub: 'Chegou e está passando pelas etapas de recebimento' },
    finalizados: { label: '✅ Finalizados', sub: 'Histórico — concluídos ou cancelados' },
  };
  function _abaDoStatus(status) { return Object.keys(ABA_STATUS).find(aba => ABA_STATUS[aba].includes(status)) || 'andamento'; }
  let _abaRecebimento = 'transito';

  // BUG AO VIVO REAL (2026-09-17, mesmo bug encontrado em 97-recebimento-
  // recusas.js): comparar em UTC (toISOString) faz um registro de fim de
  // noite (Brasília) já virar "amanhã" em UTC — o filtro "Hoje" escondia
  // registros que, no relógio local, são de hoje mesmo. Comparação agora é
  // sempre em data local, nos dois lados.
  function _dataLocalDe(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function _ehHoje(iso) { return !!iso && _dataLocalDe(iso) === _dataLocalDe(new Date()); }

  function fs() { return global.getDTFirestore(); }
  function _lojaAtivaOp() { return (typeof global.getDTLojaAtiva === 'function') ? global.getDTLojaAtiva() : ''; }

  // CORREÇÃO ESTRUTURAL (bug ao vivo real: "gerei uns teste lá e não vi ele
  // somando" — transbordo mora sempre na coleção da ORIGEM; a loja de
  // DESTINO nunca via nada, porque o Analista só lia a própria coleção
  // ativa, nunca cruzava com a origem). Mesmo padrão do Coletor
  // (22-recebimento.js/_refRecCrossLoja/_origensParaCruzar), replicado aqui
  // com o MESMO contrato pra nunca divergir entre os dois bundles (cada um
  // carrega seu próprio arquivo, nenhum importa o outro).
  function _refRecCrossLoja(lojaId, docId) {
    if (!lojaId || lojaId === _lojaAtivaOp()) return fs().collection(COL_RECEBIMENTOS).doc(docId);
    return global.getDTRawFirestore().collection('lojas').doc(lojaId).collection(COL_RECEBIMENTOS).doc(docId);
  }
  function _refAuditoriaCrossLoja(lojaId) {
    if (!lojaId || lojaId === _lojaAtivaOp()) return fs().collection(COL_AUDITORIA);
    return global.getDTRawFirestore().collection('lojas').doc(lojaId).collection(COL_AUDITORIA);
  }
  // Origens a cruzar (rotas onde esta loja é o destino) — mesma função do
  // Coletor, mesmo nome, mesmo contrato.
  function _origensParaCruzar() {
    const ativa = _lojaAtivaOp();
    const vistos = new Set();
    return _rotas
      .filter(r => r.destinoLojaId === ativa && r.origemLojaId && r.origemLojaId !== ativa)
      .map(r => ({ id: r.origemLojaId, nome: r.origemNome || r.origemLojaId }))
      .filter(r => !vistos.has(r.id) && vistos.add(r.id));
  }

  // Mantém uma única ocorrência de cada carga — protege contra a MESMA
  // origem aparecer duas vezes (ex.: leitura local + leitura cross-loja se
  // uma rota apontar pra própria loja por engano) ou uma leitura em
  // andamento se sobrepor à anterior.
  //
  // BUG AO VIVO REAL (achado direto pelo usuário, não suposição): a chave
  // de dedup usava `identificadorCodigo` pra TRANSBORDO — mas esse código é
  // FIXO POR MOTORISTA e reaproveitado em TODA viagem dele, de propósito
  // (ver comentário em 22-recebimento.js: "o código FIXO por motorista...
  // reaproveitado em toda viagem"). Isso faz duas viagens DIFERENTES do
  // MESMO motorista (ex.: uma ontem, outra hoje) colidirem na mesma chave —
  // só a mais recente sobrevivia ao filtro, e a anterior (mesmo ainda
  // EM_TRANSITO, sem ninguém ter fechado ela) simplesmente sumia da tela,
  // sem nenhum erro. A identidade real e única de uma carga é sempre
  // loja+documento — nunca o código do motorista.
  function _deduplicarRecebimentos(lista) {
    const vistos = new Set();
    return [...(lista || [])].sort((a,b) => String(b.atualizadoEm || b.horaSaida || b.criadoEm || '').localeCompare(String(a.atualizadoEm || a.horaSaida || a.criadoEm || ''))).filter(r => {
      const chave = String(r._lojaId || '') + ':' + String(r._id || '');
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  }

  // Abertura e permanência na tela nunca iniciam leituras. O temporizador de
  // 45 s que atualizava esta tela em segundo plano foi removido: dados só são
  // consultados por uma ação manual explícita no botão "Buscar dados".
  let _intervalTempoReal = null;
  function _pararTempoRealRecebimento() {
    if (_intervalTempoReal) { clearInterval(_intervalTempoReal); _intervalTempoReal = null; }
    _assinaturaTempoReal = '';
  }
  function _algumaTelaUsandoRecebimentosEstaAberta() {
    const op = document.getElementById('page-recebimento-operacao');
    const tr = document.getElementById('page-recebimento-transbordo');
    return !!((op && op.classList.contains('on')) || (tr && tr.classList.contains('on')));
  }
  function _ativarTempoRealRecebimento() {
    _pararTempoRealRecebimento();
  }

  // Dona operacional ATUAL de uma carga (correção estrutural — mesma regra
  // do Coletor, `22-recebimento.js`, replicada aqui com o MESMO contrato
  // pra nunca divergir entre os dois bundles: coletor.html não carrega este
  // arquivo, então cada lado precisa da própria cópia). `r.origemLojaId` é
  // o campo persistido a partir de agora; `r._lojaId` é o fallback pra
  // cargas legadas (anotação no momento da leitura, indicando de qual loja
  // o doc veio — agora que o Analista cruza lojas igual o Coletor, essa
  // anotação reflete a loja REAL de origem, não sempre a ativa).
  function _lojaResponsavelAtual(r) {
    const origem = r.origemLojaId || r._lojaId;
    if (!r.destinoLojaId) return null; // sem rota cruzada: sem dono exclusivo
    return r.status === 'PREVISTO' ? origem : r.destinoLojaId;
  }
  // "De quem é a vez" — aplicada nas guardas de transição (_podeXxx) E na
  // escrita (_aplicarTransicao), não só como filtro visual: sem isso, uma
  // conta Analista com a loja de ORIGEM ativa continuava enxergando "Registrar
  // chegada"/"Iniciar descarga"/etc. habilitados pra uma carga que, desde
  // EM_TRANSITO, já não é mais responsabilidade dela — bug ao vivo
  // confirmado em auditoria de código. Pra FORNECEDOR (nunca tem
  // destinoLojaId) isto é sempre `true` — não muda nada do fluxo normal.
  function _minhaVezDeAgir(r) {
    const responsavel = _lojaResponsavelAtual(r);
    return responsavel === null || responsavel === _lojaAtivaOp();
  }

  const STATUS_INFO = {
    PREVISTO: { label: 'Previsto', cor: 'b-gray' },
    EM_TRANSITO: { label: 'Em trânsito', cor: 'b-yellow' },
    CHEGOU: { label: 'Chegou', cor: 'b-blue' },
    AGUARDANDO_DOCA: { label: 'Aguardando doca', cor: 'b-yellow' },
    EM_DESCARGA: { label: 'Em descarga', cor: 'b-orange' },
    DESCARGA_FINALIZADA: { label: 'Descarga finalizada', cor: 'b-teal' },
    EM_CONFERENCIA: { label: 'Em conferência', cor: 'b-purple' },
    FINALIZADO: { label: 'Finalizado', cor: 'b-green' },
    CANCELADO: { label: 'Cancelado', cor: 'b-gray' },
    ATRASADO: { label: 'Atrasado', cor: 'b-red' },
  };
  function _statusInfo(s) { return STATUS_INFO[s] || STATUS_INFO.PREVISTO; }

  // ── Guardas de transição (seção 12 — não deixa pular etapa) ─────────────
  // Todas as guardas ganharam `&& _minhaVezDeAgir(r)` (correção estrutural)
  // — pra FORNECEDOR (sem destinoLojaId) isso é sempre `true`, então o
  // fluxo normal continua idêntico; só passa a restringir de verdade quando
  // é TRANSBORDO com rota cruzada definida.
  function _podeAtribuirDoca(r) { return ['CHEGOU', 'AGUARDANDO_DOCA'].includes(r.status) && _minhaVezDeAgir(r); }
  function _podeIniciarDescarga(r) { return ['CHEGOU', 'AGUARDANDO_DOCA'].includes(r.status) && _minhaVezDeAgir(r); }
  function _podeFinalizarDescarga(r) { return r.status === 'EM_DESCARGA' && _minhaVezDeAgir(r); }
  function _podeEnviarConferencia(r) { return r.status === 'DESCARGA_FINALIZADA' && _minhaVezDeAgir(r); }
  function _podeFinalizar(r) { return ['DESCARGA_FINALIZADA', 'EM_CONFERENCIA'].includes(r.status) && _minhaVezDeAgir(r); }
  function _podeCancelar(r) { return !['FINALIZADO', 'CANCELADO'].includes(r.status); }
  // Transbordo (fase 3) — só entra ANTES do "chegou": Matriz gera a carga
  // (PREVISTO), registra a saída (EM_TRANSITO) e só depois a Filial registra
  // a chegada, que é quando entra na MESMA cadeia de descarga/finalização
  // já usada por recebimento de fornecedor (seção 15: "Matriz gera carga →
  // QR acompanha motorista → Filial bipa chegada → ...").
  function _podeRegistrarSaida(r) { return r.status === 'PREVISTO' && _minhaVezDeAgir(r); }
  function _podeRegistrarChegadaTransbordo(r) { return r.status === 'EM_TRANSITO' && _minhaVezDeAgir(r); }

  function _minutosEntre(iso1, iso2) {
    if (!iso1 || !iso2) return null;
    const diff = Math.round((new Date(iso2) - new Date(iso1)) / 60000);
    return isNaN(diff) ? null : diff;
  }
  function _recalcularTempos(r) {
    return {
      tempoViagemMin: _minutosEntre(r.horaSaida, r.horaChegada),
      tempoEsperaMin: _minutosEntre(r.horaChegada, r.horaInicioDescarga),
      tempoDescargaMin: _minutosEntre(r.horaInicioDescarga, r.horaFimDescarga),
      tempoTotalMin: _minutosEntre(r.horaChegada, r.horaFimDescarga),
      tempoAteFechamentoMin: _minutosEntre(r.horaChegada, r.horaFechamentoRecebimento),
    };
  }

  async function _registrarAuditoria(recebimentoId, operacao, valorAnterior, valorNovo, lojaId) {
    try {
      // A auditoria acompanha o registro — mesma loja de onde o
      // recebimento realmente mora, não a loja ativa do Analista.
      await _refAuditoriaCrossLoja(lojaId).add({
        usuario: global._currentAnalistaUser?.email || '', dataHora: new Date().toISOString(),
        operacao, recebimentoId, valorAnterior: valorAnterior ?? null, valorNovo: valorNovo ?? null,
      });
    } catch (e) { /* auditoria nunca trava a operação principal */ }
  }

  // PEDIDO AO VIVO (2026-09-09): "a tela precisa ficar o tempo todo em
  // carregamento?" — Promise.allSettled em vez de Promise.all: antes, UMA
  // coleção lenta (ex.: rotas) segurava as outras 4 já prontas e derrubava
  // a tela inteira num erro genérico. Agora cada fonte que responde é
  // usada normalmente; só uma REJEIÇÃO real vira aviso pontual — sem
  // timeout artificial por fonte (Promise.race com timeout não cancela a
  // busca real, só desiste de esperar; numa coleção só lenta isso
  // transformava "vai chegar" em "erro pra sempre").
  async function carregarRecebimentoOperacao(forcar) {
    const lojaAtual = _lojaAtivaOp();
    if (_lojaCarregada && _lojaCarregada !== lojaAtual) forcar = true;
    if (_carregado && !forcar) return;
    if (_carregamentoPromise) return _carregamentoPromise;
    _carregando = true;
    _erroCarregamento = '';
    _carregamentoPromise = (async () => {
      // A coleção operacional cresce sem limite. Em vez de reler todos os
      // documentos do Firestore a cada entrada, usa o espelho atual do
      // BigQuery. Falha do BigQuery é exibida; não há fallback integral.
      // O formato devolvido é o mesmo ({_id, _lojaId, ...dados}), então
      // filtros, transições e regras da tela permanecem inalterados.
      const carregarRecebimentosPrincipal = async () => {
        try {
          const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarRecebimentosOperacaoBigQuery');
          const resp = await callable({ lojaId: lojaAtual });
          const lista = resp && resp.data && Array.isArray(resp.data.recebimentos) ? resp.data.recebimentos : [];
          return { __dtListaPronta: true, lista, incluiTransbordosParceiros: resp?.data?.incluiTransbordosParceiros === true };
        } catch (eBq) {
          console.warn('[Recebimento] BigQuery operacional indisponível:', eBq?.message || eBq);
          throw eBq;
        }
      };
      const fontes = [
        ['recebimentos', carregarRecebimentosPrincipal()],
        ['rotas', fs().collection(COL_ROTAS).get()],
      ];
      const resultados = await Promise.allSettled(fontes.map(([, promise]) => promise));
      const snap = indice => resultados[indice].status === 'fulfilled' ? resultados[indice].value : { docs: [] };
      const falhas = resultados.map((r, i) => r.status === 'rejected' ? fontes[i][0] : '').filter(Boolean);
      const [snapRec, snapRotas] = [snap(0), snap(1)];
      const _lojaDaLeitura = _lojaAtivaOp();
      const backendIncluiParceiros = !!(snapRec && snapRec.__dtListaPronta && snapRec.incluiTransbordosParceiros);
      if (resultados[0].status === 'fulfilled') {
        _recebimentos = snapRec && snapRec.__dtListaPronta
          ? snapRec.lista.map(r => ({ ...r, _lojaId: r._lojaId || _lojaDaLeitura }))
          : snapRec.docs.map(d => ({ _id: d.id, _lojaId: _lojaDaLeitura, ...d.data() }));
      }
      if (resultados[1].status === 'fulfilled') _rotas = snapRotas.docs.map(d => ({ _id: d.id, ...d.data() }));
      // Cruza com TODAS as origens que têm rota pra esta loja — mesmo padrão
      // do Coletor (ver comentário em _refRecCrossLoja acima). Nunca trava o
      // carregamento por conta disso: sem rota configurada, ou se alguma
      // consulta cross-loja falhar, o resto continua funcionando normalmente.
      const origens = backendIncluiParceiros ? [] : _origensParaCruzar();
      if (origens.length) {
        const resultadosParceira = await Promise.all(origens.map(async p => {
          try {
            // `.where('tipo','==','TRANSBORDO')` exigido pela regra do
            // Firestore (mesmo motivo do Coletor) — sem o filtro, a consulta
            // falha inteira com permission-denied.
            const snapParc = await global.getDTRawFirestore().collection('lojas').doc(p.id).collection(COL_RECEBIMENTOS).where('tipo', '==', 'TRANSBORDO').get();
            return snapParc.docs.map(d => ({ _id: d.id, _lojaId: p.id, ...d.data() }));
          } catch (e) {
            console.warn('[Recebimento] Falha ao buscar transbordos da loja parceira ' + p.id + ':', e?.message || e);
            return [];
          }
        }));
        resultadosParceira.forEach(recsParceira => { _recebimentos = _recebimentos.concat(recsParceira); });
      }
      _recebimentos = _deduplicarRecebimentos(_recebimentos);
      _lojaCarregada = lojaAtual;
      _carregado = true;
      _erroCarregamento = falhas.length ? 'Não responderam: ' + falhas.join(', ') + '. Os demais dados foram carregados.' : '';
      _ativarTempoRealRecebimento();
    })();
    try {
      await _carregamentoPromise;
    } finally {
      _carregando = false;
      _carregamentoPromise = null;
    }
  }
  // Renderizar esta rota monta somente a interface. Nenhuma consulta é
  // iniciada aqui; a única porta de entrada para leitura é a função manual
  // abaixo, chamada exclusivamente pelos botões de busca/tentativa.
  function renderRecebimentoOperacao() {
    const pagina = document.getElementById('page-recebimento-operacao');
    if (!pagina) return;
    _desenharRecebimentoOperacao();
  }

  async function _buscarRecebimentosManual() {
    if (_carregando) return;
    _desenharRecebimentoOperacao();
    try {
      await carregarRecebimentoOperacao(true);
    } catch (e) {
      _carregando = false;
      _erroCarregamento = e.message || String(e);
    }
    _desenharRecebimentoOperacao();
  }

  function fmtMin(m) { return m == null ? '—' : (m >= 60 ? (m / 60).toFixed(1) + 'h' : Math.round(m) + 'min'); }
  function fmtHora(iso) { return iso ? String(iso).slice(11, 16) : '—'; }
  function fmtData(iso) { return iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'; }

  function _desenharRecebimentoOperacao() {
    const pagina = document.getElementById('page-recebimento-operacao');
    if (!pagina) return;
    const contagemAba = { transito: 0, andamento: 0, finalizados: 0 };
    _recebimentos.forEach(r => { contagemAba[_abaDoStatus(r.status)]++; });
    const linhas = _recebimentos
      .filter(r => ABA_STATUS[_abaRecebimento].includes(r.status))
      .filter(r => !_filtroHoje || _ehHoje(r.horaChegada || r.criadoEm))
      .sort((a, b) => String(b.horaChegada || b.criadoEm || '').localeCompare(String(a.horaChegada || a.criadoEm || '')));
    const totalPaginas = Math.max(1, Math.ceil(linhas.length / ITENS_POR_PAGINA));
    if (_pagina > totalPaginas) _pagina = totalPaginas;
    const linhasPagina = linhas.slice((_pagina - 1) * ITENS_POR_PAGINA, _pagina * ITENS_POR_PAGINA);

    pagina.innerHTML = `
      ${_carregando ? '<div style="font-size:.76rem;color:var(--muted);margin-bottom:10px">🔄 Atualizando recebimentos...</div>' : ''}
      ${!_carregado && !_carregando && !_erroCarregamento ? '<div style="font-size:.76rem;color:var(--muted);background:var(--surface-2,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:8px 12px;margin-bottom:10px">Selecione os filtros desejados e clique em <b>Buscar dados</b>. Abrir esta tela não consulta nenhuma base.</div>' : ''}
      ${_erroCarregamento ? '<div style="font-size:.76rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;margin-bottom:10px">⚠️ ' + esc(_erroCarregamento) + ' <button type="button" class="btn btn-ghost btn-sm" data-recop-recarregar="1">Tentar novamente</button></div>' : ''}
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">🚚 Recebimentos</div><div style="font-size:.74rem;color:var(--muted)">${_recebimentos.length.toLocaleString('pt-BR')} carga(s) registrada(s)</div></div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-ghost btn-sm" data-recop-atualizar="1" title="Buscar os dados mais recentes">🔎 Buscar dados</button>
          <button type="button" class="btn btn-primary btn-sm" data-recop-novo="1">+ Novo Recebimento</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        ${Object.keys(ABA_INFO).map(aba => `<button type="button" class="btn ${aba === _abaRecebimento ? 'btn-primary' : 'btn-ghost'} btn-sm" data-recop-aba="${aba}">${ABA_INFO[aba].label} (${contagemAba[aba]})</button>`).join('')}
        <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;margin-left:auto"><input type="checkbox" id="recop-f-hoje" ${_filtroHoje ? 'checked' : ''}> Só de hoje</label>
      </div>
      <div style="font-size:.72rem;color:var(--muted);margin:-6px 0 10px">${ABA_INFO[_abaRecebimento].sub}</div>
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Status</th><th>Fornecedor</th><th>Motorista</th><th>Placa</th><th>Nota(s)</th><th>Data</th><th>Chegada</th><th>Início descarga</th><th>Fim descarga</th><th>Espera</th><th>Descarga</th><th>Total</th><th>Doca</th><th>Responsável</th><th></th></tr></thead>
            <tbody>
              ${linhasPagina.length ? linhasPagina.map(r => {
                const st = _statusInfo(r.status);
                const notas = (r.notas || []).map(n => n.numero).filter(Boolean).join(', ') || '—';
                return `<tr>
                  <td><span class="badge ${st.cor}" style="font-size:.62rem">${esc(st.label)}</span></td>
                  <td><b>${esc(r.fornecedorNome || '—')}</b></td>
                  <td>${esc(r.motoristaNome || '—')}</td>
                  <td class="mono">${esc(r.placa || '—')}</td>
                  <td>${esc(notas)}</td>
                  <td>${fmtData(r.horaChegada || r.criadoEm)}</td>
                  <td>${fmtHora(r.horaChegada)}</td>
                  <td>${fmtHora(r.horaInicioDescarga)}</td>
                  <td>${fmtHora(r.horaFimDescarga)}</td>
                  <td>${fmtMin(r.tempoEsperaMin)}</td>
                  <td>${fmtMin(r.tempoDescargaMin)}</td>
                  <td>${fmtMin(r.tempoTotalMin)}</td>
                  <td>${esc(r.docaNome || '—')}</td>
                  <td style="font-size:.68rem;color:var(--muted)">${esc(r.responsavel || '—')}</td>
                  <td style="white-space:nowrap">
                    ${_podeIniciarDescarga(r) ? `<button type="button" class="btn btn-ghost btn-sm" data-recop-iniciar-descarga="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">▶ Iniciar descarga</button>` : ''}
                    ${_podeFinalizarDescarga(r) ? `<button type="button" class="btn btn-ghost btn-sm" data-recop-finalizar-descarga="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">⏹ Finalizar descarga</button>` : ''}
                    ${_podeEnviarConferencia(r) ? `<button type="button" class="btn btn-ghost btn-sm" data-recop-conferencia="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">🔍 Conferência</button>` : ''}
                    ${_podeFinalizar(r) ? `<button type="button" class="btn btn-primary btn-sm" data-recop-finalizar="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">✅ Finalizar</button>` : ''}
                    ${_podeVoltarEtapa(r) ? `<button type="button" class="btn btn-ghost btn-sm" title="Corrige um bip/avanço errado, sem apagar o resto do registro" data-recop-voltar="${esc(r._id)}" style="font-size:.65rem;padding:3px 7px">⏪ Voltar etapa</button>` : ''}
                    <button type="button" class="acao-lapis" title="Detalhes / Corrigir horário" data-recop-detalhes="${esc(r._id)}">✏️</button>
                    ${_podeCancelar(r) ? `<button type="button" class="acao-lapis" title="Cancelar" data-recop-cancelar="${esc(r._id)}">🗑️</button>` : ''}
                  </td>
                </tr>`;
              }).join('') : '<tr><td colspan="15"><div class="empty"><div class="empty-icon">🚚</div><div class="empty-title">Nenhum recebimento registrado</div><div class="empty-sub">Clique em "+ Novo Recebimento" pra registrar uma chegada.</div></div></td></tr>'}
            </tbody>
          </table>
        </div>
        ${totalPaginas > 1 ? `<div style="display:flex;justify-content:center;gap:8px;align-items:center;padding:10px"><button type="button" class="btn btn-ghost btn-sm" data-recop-pg="-1" ${_pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button><span style="font-size:.75rem;color:var(--muted)">Página ${_pagina} de ${totalPaginas}</span><button type="button" class="btn btn-ghost btn-sm" data-recop-pg="1" ${_pagina >= totalPaginas ? 'disabled' : ''}>Próxima ›</button></div>` : ''}
      </div>`;
    global.aplicarPermissoesAnalista?.();
  }


  async function _carregarCadastrosAuxiliares(forcar) {
    if (_cadastrosAuxCarregados && !forcar) return;
    if (_cadastrosAuxPromise) return _cadastrosAuxPromise;
    _cadastrosAuxPromise = (async () => {
      const fontes = [
        fs().collection('recebimento_motoristas').get(),
        fs().collection('recebimento_veiculos').get(),
        fs().collection('recebimento_docas').get(),
      ];
      const resultados = await Promise.allSettled(fontes);
      const snap = i => resultados[i].status === 'fulfilled' ? resultados[i].value : { docs: [] };
      if (resultados[0].status === 'fulfilled') _motoristas = snap(0).docs.map(d => ({ _id: d.id, ...d.data() })).filter(m => m.ativo !== false);
      if (resultados[1].status === 'fulfilled') _veiculos = snap(1).docs.map(d => ({ _id: d.id, ...d.data() })).filter(v => v.ativo !== false);
      if (resultados[2].status === 'fulfilled') _docas = snap(2).docs.map(d => ({ _id: d.id, ...d.data() })).filter(d => d.ativo !== false);
      _cadastrosAuxCarregados = resultados.some(r => r.status === 'fulfilled');
      const falhas = resultados.filter(r => r.status === 'rejected').length;
      if (falhas) console.warn('[Recebimento] Cadastros auxiliares incompletos: ' + falhas + ' fonte(s) falharam.');
    })();
    try { await _cadastrosAuxPromise; } finally { _cadastrosAuxPromise = null; }
  }

  async function _carregarAgendasCompra() {
    const snap = await fs().collection('recebimento_agendamentos').get().catch(() => ({ docs: [] }));
    _agendasCompra = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .filter(a => a.numeroPedido && !/final|cancel/i.test(String(a.status || '')))
      .sort((a,b) => String(a.dataPrevista || a.dataAgendada || '').localeCompare(String(b.dataPrevista || b.dataAgendada || '')));
    return _agendasCompra;
  }

  // ── "+ Novo Recebimento" (equivalente manual do 1º bip, seção 9) ────────
  async function recopNovo() {
    await Promise.all([_carregarCadastrosAuxiliares(), _carregarAgendasCompra()]);
    _notasEditando = [];
    document.getElementById('recop-doc-id').value = '';
    document.getElementById('recop-fornecedor').value = '';
    const selPedido = document.getElementById('recop-pedido');
    if (selPedido) selPedido.innerHTML = '<option value="">— Sem vínculo / recebimento avulso —</option>' + _agendasCompra.map(a => `<option value="${esc(a._id)}">Pedido ${esc(a.numeroPedido)} · ${esc(a.fornecedorNome || 'Fornecedor')} · ${esc(a.dataPrevista || a.dataAgendada || 'sem data')}</option>`).join('');
    document.getElementById('recop-observacao').value = '';
    const selMot = document.getElementById('recop-motorista');
    if (selMot) selMot.innerHTML = '<option value="">— Selecionar —</option>' + _motoristas.map(m => `<option value="${esc(m._id)}">${esc(m.nome)}</option>`).join('');
    const selVeic = document.getElementById('recop-veiculo');
    if (selVeic) selVeic.innerHTML = '<option value="">— Selecionar —</option>' + _veiculos.map(v => `<option value="${esc(v._id)}" data-placa="${esc(v.placa)}">${esc(v.placa)} — ${esc(v.modelo || v.tipo || '')}</option>`).join('');
    const selDoca = document.getElementById('recop-doca');
    if (selDoca) selDoca.innerHTML = '<option value="">— Ainda não definida —</option>' + _docas.map(d => `<option value="${esc(d._id)}">${esc(d.nome)}</option>`).join('');
    _redesenharNotasEditando();
    global.openModal?.('modal-recop');
  }
  function _redesenharNotasEditando() {
    const wrap = document.getElementById('recop-notas-list');
    if (!wrap) return;
    wrap.innerHTML = _notasEditando.map((n, i) => `
      <div style="display:flex;gap:6px;align-items:center">
        <input class="field" style="flex:1" placeholder="Número" value="${esc(n.numero)}" data-recop-nota-campo="numero" data-recop-nota-idx="${i}">
        <input class="field" style="flex:1" placeholder="Série" value="${esc(n.serie)}" data-recop-nota-campo="serie" data-recop-nota-idx="${i}">
        <input class="field" style="flex:1" type="number" step="any" placeholder="Valor" value="${esc(n.valor)}" data-recop-nota-campo="valor" data-recop-nota-idx="${i}">
        <input class="field" style="flex:1" type="number" step="1" placeholder="Volumes" value="${esc(n.quantidadeVolumes)}" data-recop-nota-campo="quantidadeVolumes" data-recop-nota-idx="${i}">
        <button type="button" class="btn btn-ghost btn-sm" data-recop-nota-remover="${i}">✕</button>
      </div>`).join('') || '<div style="font-size:.75rem;color:var(--muted)">Nenhuma nota adicionada ainda.</div>';
  }
  function recopNotaAdicionar() { _notasEditando.push({ numero: '', serie: '', valor: '', quantidadeVolumes: '' }); _redesenharNotasEditando(); }
  function recopNotaRemover(i) { _notasEditando.splice(i, 1); _redesenharNotasEditando(); }
  function recopNotaCampoAlterado(i, campo, valor) { if (_notasEditando[i]) _notasEditando[i][campo] = valor; }

  function recopPedidoAlterado() {
    const id = document.getElementById('recop-pedido')?.value || '';
    const agenda = _agendasCompra.find(a => a._id === id);
    if (!agenda) return;
    const f = document.getElementById('recop-fornecedor');
    if (f && !String(f.value || '').trim()) f.value = agenda.fornecedorNome || '';
  }

  function recopMotoristaAlterado() {
    const motId = document.getElementById('recop-motorista')?.value || '';
    if (!motId) return;
    const veicHabitual = _veiculos.find(v => v.motoristaHabitualId === motId);
    if (veicHabitual) {
      const selVeic = document.getElementById('recop-veiculo');
      if (selVeic) selVeic.value = veicHabitual._id;
    }
  }

  async function recopSalvar() {
    const agendaId = document.getElementById('recop-pedido')?.value || '';
    const agendaCompra = _agendasCompra.find(a => a._id === agendaId) || null;
    const fornecedorNome = String(document.getElementById('recop-fornecedor').value || agendaCompra?.fornecedorNome || '').trim();
    if (!fornecedorNome) { global.showToast?.('Informe o fornecedor.', 'error'); return; }
    const motoristaId = document.getElementById('recop-motorista').value || '';
    const veiculoId = document.getElementById('recop-veiculo').value || '';
    const docaId = document.getElementById('recop-doca').value || '';
    const motorista = _motoristas.find(m => m._id === motoristaId);
    const veiculo = _veiculos.find(v => v._id === veiculoId);
    const doca = _docas.find(d => d._id === docaId);
    const notas = _notasEditando.filter(n => n.numero).map(n => ({
      numero: n.numero, serie: n.serie || '', fornecedor: fornecedorNome,
      valor: Number(n.valor) || 0, quantidadeVolumes: Number(n.quantidadeVolumes) || 0,
    }));
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    const payload = {
      tipo: 'FORNECEDOR', status: docaId ? 'AGUARDANDO_DOCA' : 'CHEGOU', horaChegada: agora,
      fornecedorNome, numeroPedido: agendaCompra?.numeroPedido || '', agendamentoRecebimentoId: agendaCompra?._id || '', motoristaId, motoristaNome: motorista?.nome || '', veiculoId, placa: veiculo?.placa || '',
      transportadora: motorista?.transportadora || veiculo?.transportadora || '', docaId, docaNome: doca?.nome || '',
      notas, observacao: String(document.getElementById('recop-observacao').value || '').trim(),
      responsavel: autor, criadoEm: agora, criadoPor: autor, atualizadoEm: agora, atualizadoPor: autor,
      // Precisam existir como `null` explícito (não "ausentes") — o
      // firestore.rules trata os dois de jeitos diferentes; acessar um
      // campo que nunca existiu no documento derruba a regra inteira,
      // negando a escrita seguinte de horaInicioDescarga/horaFimDescarga/
      // horaFechamentoRecebimento (bug ao vivo encontrado no Transbordo,
      // mesma causa-raiz também afeta Fornecedor, mesma coleção/regra).
      horaSaida: null, horaInicioDescarga: null, horaFimDescarga: null, horaFechamentoRecebimento: null,
      notaFiscalTransferencia: null, notaFiscalConfirmadaEm: null, notaFiscalConfirmadaPor: null,
    };
    try {
      const ref = await fs().collection(COL_RECEBIMENTOS).add(payload);
      await _registrarAuditoria(ref.id, 'CARGA_CRIADA', null, payload.status);
      global.closeModal?.('modal-recop');
      global.showToast?.('Recebimento registrado.', 'success');
      await carregarRecebimentoOperacao(true);
      _desenharRecebimentoOperacao();
    } catch (e) {
      const traduzido = typeof global.traduzirErroPermissao === 'function' ? global.traduzirErroPermissao(e, { acao: 'registrar este recebimento' }) : null;
      global.showToast?.(traduzido || ('Erro ao registrar: ' + (e.message || e)), 'error');
    }
  }

  // ── Transições de status guardadas ───────────────────────────────────────
  // `_ouvintesMudanca` (fase 3) — outras telas que reaproveitam essas ações
  // (ex.: 95-recebimento-transbordo.js) se inscrevem aqui pra saber quando
  // redesenhar a própria tela, sem duplicar a máquina de estados.
  const _ouvintesMudanca = [];
  function _notificarMudanca() { _ouvintesMudanca.forEach(fn => { try { fn(); } catch (e) { /* melhor esforço */ } }); }

  async function _aplicarTransicao(id, guarda, mudancas, operacao) {
    const r = _recebimentos.find(x => x._id === id);
    if (!r) return;
    if (!guarda(r)) { global.showToast?.('Essa carga não está em condição de passar por essa etapa.', 'error'); return; }
    const statusAnterior = r.status;
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    const payload = { ...mudancas, atualizadoEm: agora, atualizadoPor: autor };
    const mesclado = { ...r, ...payload };
    Object.assign(payload, _recalcularTempos(mesclado));
    try {
      // Camada 3 da correção estrutural: `guarda(r)` acima já cobre posse
      // (todas as guardas _podeXxx agora exigem _minhaVezDeAgir) — sem
      // reler do servidor de novo aqui: diferente do Coletor (fila offline,
      // aparelhos físicos, janelas reais de horas sem conexão), o Analista
      // já recarrega o cache a cada ação (_notificarMudanca/carregar) e não
      // tem essa janela de obsolescência longa; o backstop de verdade contra
      // uma condição de corrida genuína é o Firestore Rules (Fase 1.5), não
      // uma releitura redundante aqui.
      // .update() (não .set(merge:true)) — `r` já foi confirmada existente
      // acima (_recebimentos.find). Evita a avaliação ambígua create+update
      // que estourava o limite de 1000 sub-expressões do motor de regras em
      // contas reais (achado ao vivo, não suposição — mesmo motivo do
      // Coletor em 22-recebimento.js).
      // _refRecCrossLoja (não fs() direto) — `r._lojaId` pode ser a loja de
      // ORIGEM, diferente da loja ativa do Analista, quando ele está vendo
      // um transbordo cruzado como destino (correção estrutural: antes
      // disso, a escrita ia sempre pro caminho da loja ativa, que dava
      // NOT_FOUND ou criava um documento fantasma na loja errada quando o
      // registro real morava em outro lugar).
      await _refRecCrossLoja(r._lojaId, id).update(payload);
      await _registrarAuditoria(id, operacao, statusAnterior, payload.status || statusAnterior, r._lojaId);
      Object.assign(r, payload);
      _desenharRecebimentoOperacao();
      _notificarMudanca();
    } catch (e) {
      const traduzido = typeof global.traduzirErroPermissao === 'function' ? global.traduzirErroPermissao(e, { acao: 'avançar esta etapa (ou esta carga já não pertence mais à sua loja)' }) : null;
      global.showToast?.(traduzido || ('Erro ao atualizar: ' + (e.message || e)), 'error');
    }
  }
  // `campos` (opcional) mescla dados extras na mesma transição — hoje usado
  // pra gravar a Nota Fiscal da transferência junto com a saída/chegada, sem
  // precisar de uma segunda escrita separada (controle de NF, seção adicional).
  function recopRegistrarSaida(id, campos) { return _aplicarTransicao(id, _podeRegistrarSaida, { status: 'EM_TRANSITO', horaSaida: new Date().toISOString(), ...(campos || {}) }, 'TRANSBORDO_SAIU'); }
  function recopRegistrarChegadaTransbordo(id, campos) { return _aplicarTransicao(id, _podeRegistrarChegadaTransbordo, { status: 'CHEGOU', horaChegada: new Date().toISOString(), ...(campos || {}) }, 'CHEGADA_REGISTRADA'); }
  function recopIniciarDescarga(id) { return _aplicarTransicao(id, _podeIniciarDescarga, { status: 'EM_DESCARGA', horaInicioDescarga: new Date().toISOString() }, 'DESCARGA_INICIADA'); }
  function recopFinalizarDescarga(id) { return _aplicarTransicao(id, _podeFinalizarDescarga, { status: 'DESCARGA_FINALIZADA', horaFimDescarga: new Date().toISOString() }, 'DESCARGA_FINALIZADA'); }
  function recopEnviarConferencia(id) { return _aplicarTransicao(id, _podeEnviarConferencia, { status: 'EM_CONFERENCIA' }, 'EM_CONFERENCIA'); }
  function recopFinalizar(id) { return _aplicarTransicao(id, _podeFinalizar, { status: 'FINALIZADO', horaFechamentoRecebimento: new Date().toISOString() }, 'RECEBIMENTO_FINALIZADO'); }
  function recopCancelar(id) {
    const r = _recebimentos.find(x => x._id === id);
    if (!r || !_podeCancelar(r)) return;
    const executar = () => _aplicarTransicao(id, _podeCancelar, { status: 'CANCELADO' }, 'RECEBIMENTO_CANCELADO');
    if (global.showConfirm) global.showConfirm('Cancelar este recebimento?', executar, { title: 'Cancelar recebimento', icon: '🗑️', okLabel: 'Cancelar', okClass: 'btn-danger' });
    else if (confirm('Cancelar este recebimento?')) executar();
  }

  // ── Voltar etapa (pedido ao vivo do usuário) ────────────────────────────
  // "Não quero que uma ação errada deixe o transbordo preso em uma etapa
  // sem possibilidade de correção." Reverte pro status anterior e limpa só
  // o(s) horário(s)/NF que aquele passo específico tinha gravado — os
  // demais campos (motorista, placa, origem/destino, notas anteriores)
  // ficam intactos. Usa a MESMA permissão de corrigir-horario (separada da
  // permissão normal de bipar/editar, de propósito — decisão confirmada:
  // só quem tiver essa permissão liberada consegue voltar etapa, evitando
  // correção indevida por qualquer operador).
  const _VOLTAR_ETAPA = {
    EM_TRANSITO: { anterior: 'PREVISTO', limpar: ['horaSaida', 'notaFiscalTransferencia'] },
    CHEGOU: { anterior: 'EM_TRANSITO', limpar: ['horaChegada', 'notaFiscalConfirmadaEm', 'notaFiscalConfirmadaPor'] },
    AGUARDANDO_DOCA: { anterior: 'EM_TRANSITO', limpar: ['horaChegada', 'notaFiscalConfirmadaEm', 'notaFiscalConfirmadaPor'] },
    EM_DESCARGA: { anterior: 'CHEGOU', limpar: ['horaInicioDescarga'] },
    DESCARGA_FINALIZADA: { anterior: 'EM_DESCARGA', limpar: ['horaFimDescarga'] },
    EM_CONFERENCIA: { anterior: 'DESCARGA_FINALIZADA', limpar: [] },
    FINALIZADO: { anterior: 'DESCARGA_FINALIZADA', limpar: ['horaFechamentoRecebimento'] },
  };
  function _podeVoltarEtapa(r) { return !!_VOLTAR_ETAPA[r.status] && _minhaVezDeAgir(r); }
  async function recopVoltarEtapa(id) {
    const r = _recebimentos.find(x => x._id === id);
    if (!r) return;
    if (!_minhaVezDeAgir(r)) { global.showToast?.('Esta carga não pertence mais a esta loja — não é possível corrigi-la por aqui.', 'error'); return; }
    const regra = _VOLTAR_ETAPA[r.status];
    if (!regra) { global.showToast?.('Essa carga não tem etapa anterior pra voltar.', 'error'); return; }
    const executar = async () => {
      const agora = new Date().toISOString();
      const autor = global._currentAnalistaUser?.email || '';
      const payload = { status: regra.anterior, atualizadoEm: agora, atualizadoPor: autor };
      regra.limpar.forEach(campo => { payload[campo] = null; });
      const mesclado = { ...r, ...payload };
      Object.assign(payload, _recalcularTempos(mesclado));
      try {
        // .update() — mesmo motivo do _aplicarTransicao acima.
        // _refRecCrossLoja — mesmo motivo do _aplicarTransicao acima.
        await _refRecCrossLoja(r._lojaId, id).update(payload);
        await _registrarAuditoria(id, 'ETAPA_REVERTIDA', r.status, regra.anterior, r._lojaId);
        Object.assign(r, payload);
        _desenharRecebimentoOperacao();
        _notificarMudanca();
        global.showToast?.('Etapa revertida.', 'success');
      } catch (e) {
        const traduzido = typeof global.traduzirErroPermissao === 'function' ? global.traduzirErroPermissao(e, { mensagem: 'Você não possui permissão para voltar esta etapa. Peça pro Analista liberar "corrigir horário" em Usuários e Permissões.' }) : null;
        global.showToast?.(traduzido || ('Erro ao voltar etapa: ' + (e.message || e)), 'error');
      }
    };
    const rotuloAnterior = _statusInfo(regra.anterior).label;
    if (global.showConfirm) global.showConfirm('Voltar esta carga pra "' + rotuloAnterior + '"? O horário registrado nesta etapa será apagado.', executar, { title: 'Voltar etapa', icon: '⏪', okLabel: 'Voltar', okClass: 'btn-danger' });
    else if (confirm('Voltar esta carga pra "' + rotuloAnterior + '"?')) await executar();
  }

  // ── Excluir (pedido ao vivo do usuário: cargas de TESTE, geradas na hora
  // de validar o fluxo, precisam sumir de vez — diferente de "Cancelar"
  // acima, que só muda o status pra CANCELADO e mantém o histórico. Excluir
  // apaga o documento de verdade e funciona em QUALQUER status, inclusive
  // FINALIZADO/CANCELADO (o "Cancelar" trava nesses dois — ver _podeCancelar
  // acima; era exatamente essa combinação que antes não tinha saída
  // nenhuma). O gate real é o firestore.rules (`allow delete`); aqui só
  // existe a confirmação — sem ela, um clique errado perde o registro pra
  // sempre, sem chance de "Voltar etapa".
  async function recopExcluir(id) {
    const r = _recebimentos.find(x => x._id === id);
    if (!r) return;
    const executar = async () => {
      try {
        await _refRecCrossLoja(r._lojaId, id).delete();
        await _registrarAuditoria(id, 'RECEBIMENTO_EXCLUIDO', r.status, null, r._lojaId);
        _recebimentos = _recebimentos.filter(x => x._id !== id);
        _desenharRecebimentoOperacao();
        _notificarMudanca();
        global.showToast?.('🗑️ Registro excluído.', 'success');
      } catch (e) {
        const traduzido = typeof global.traduzirErroPermissao === 'function' ? global.traduzirErroPermissao(e, { acao: 'excluir este registro' }) : null;
        global.showToast?.(traduzido || ('Erro ao excluir: ' + (e.message || e)), 'error');
      }
    };
    if (global.showConfirm) global.showConfirm('Excluir este registro definitivamente? Essa ação não pode ser desfeita.', executar, { title: 'Excluir', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir este registro definitivamente? Essa ação não pode ser desfeita.')) await executar();
  }

  // Exclusão em massa (mesmo pedido — "apagar todos") — recebe a lista de
  // ids já filtrada por quem chamou (95-recebimento-transbordo.js decide O
  // QUÊ apagar, respeitando o filtro de data ativo na tela; aqui só executa
  // um `.delete()` por item e reporta quantos falharam, sem travar os
  // outros por causa de um só erro).
  async function recopExcluirEmMassa(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    let falhas = 0;
    for (const id of ids) {
      const r = _recebimentos.find(x => x._id === id);
      if (!r) continue;
      try {
        await _refRecCrossLoja(r._lojaId, id).delete();
        await _registrarAuditoria(id, 'RECEBIMENTO_EXCLUIDO', r.status, null, r._lojaId);
      } catch (e) { falhas++; }
    }
    _recebimentos = _recebimentos.filter(x => !ids.includes(x._id));
    _desenharRecebimentoOperacao();
    _notificarMudanca();
    const sucesso = ids.length - falhas;
    if (falhas && sucesso) global.showToast?.(`🗑️ ${sucesso} excluído(s). ${falhas} não puderam ser excluído(s) (sem permissão ou já removido).`, 'w');
    else if (falhas) global.showToast?.('Nenhum registro pôde ser excluído — verifique sua permissão.', 'error');
    else global.showToast?.(`🗑️ ${sucesso} registro(s) excluído(s).`, 'success');
  }

  // Navegação vinda dos cards do Dashboard (fase 2c) — abre Recebimentos já
  // filtrado (seção 3 do pedido: "cards clicáveis que abrem a lista
  // correspondente já filtrada").
  function recopAbrirComFiltro(opcoes) {
    opcoes = opcoes || {};
    _abaRecebimento = opcoes.status ? _abaDoStatus(opcoes.status) : 'andamento';
    _filtroHoje = opcoes.hoje === true;
    _pagina = 1;
    global.goPage?.('recebimento-operacao', document.getElementById('nav-recebimento-operacao'));
  }

  global.renderRecebimentoOperacao = renderRecebimentoOperacao;
  global.recopSalvar = recopSalvar;
  global.recopPedidoAlterado = recopPedidoAlterado;
  global.recopAbrirComFiltro = recopAbrirComFiltro;
  global._recebimentoOperacaoInternals = {
    carregar: carregarRecebimentoOperacao, recebimentos: () => _recebimentos,
    motoristas: () => _motoristas, veiculos: () => _veiculos, docas: () => _docas,
    podeIniciarDescarga: _podeIniciarDescarga, podeFinalizarDescarga: _podeFinalizarDescarga,
    podeEnviarConferencia: _podeEnviarConferencia, podeFinalizar: _podeFinalizar, podeCancelar: _podeCancelar,
    podeRegistrarSaida: _podeRegistrarSaida, podeRegistrarChegadaTransbordo: _podeRegistrarChegadaTransbordo,
    minutosEntre: _minutosEntre, recalcularTempos: _recalcularTempos, ehHoje: _ehHoje,
    // Ações de transição (fase 3) — reaproveitadas pela tela de Transbordo
    // (95-recebimento-transbordo.js), mesma máquina de estados, nunca duplicada.
    registrarSaida: recopRegistrarSaida, registrarChegadaTransbordo: recopRegistrarChegadaTransbordo,
    iniciarDescarga: recopIniciarDescarga, finalizarDescarga: recopFinalizarDescarga,
    enviarConferencia: recopEnviarConferencia, finalizar: recopFinalizar, cancelar: recopCancelar,
    podeVoltarEtapa: _podeVoltarEtapa, voltarEtapa: recopVoltarEtapa,
    excluir: recopExcluir, excluirEmMassa: recopExcluirEmMassa,
    // Reaproveitado por 95-recebimento-transbordo.js pra edição completa
    // (horários/NF/volume de uma carga já existente, ver recbtSalvarEdicaoCompleta) —
    // mesma escrita cross-loja que toda ação daqui já usa, sem duplicar a lógica.
    refCrossLoja: _refRecCrossLoja, registrarAuditoria: _registrarAuditoria,
    statusInfo: _statusInfo, onMudanca: fn => _ouvintesMudanca.push(fn),
    // Correção estrutural — posse operacional (mesmo contrato do Coletor).
    lojaResponsavelAtual: _lojaResponsavelAtual, minhaVezDeAgir: _minhaVezDeAgir,
    carregarCadastrosAuxiliares: _carregarCadastrosAuxiliares,
  };
  global.recopVoltarEtapa = recopVoltarEtapa;
  global._recebimentoOperacaoBuscaInternals = {
    buscarManual: _buscarRecebimentosManual,
    carregado: () => _carregado,
  };

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-recop-recarregar]')) { _buscarRecebimentosManual(); return; }
    if (event.target.closest('[data-recop-atualizar]')) { _buscarRecebimentosManual(); return; }
    if (event.target.closest('[data-recop-novo]')) { recopNovo(); return; }
    const pg = event.target.closest('[data-recop-pg]'); if (pg) { _pagina += Number(pg.dataset.recopPg); _desenharRecebimentoOperacao(); return; }
    if (event.target.closest('[data-recop-nota-adicionar]')) { recopNotaAdicionar(); return; }
    const remNota = event.target.closest('[data-recop-nota-remover]'); if (remNota) { recopNotaRemover(Number(remNota.getAttribute('data-recop-nota-remover'))); return; }
    const iniciar = event.target.closest('[data-recop-iniciar-descarga]'); if (iniciar) { recopIniciarDescarga(iniciar.getAttribute('data-recop-iniciar-descarga')); return; }
    const finDescarga = event.target.closest('[data-recop-finalizar-descarga]'); if (finDescarga) { recopFinalizarDescarga(finDescarga.getAttribute('data-recop-finalizar-descarga')); return; }
    const conf = event.target.closest('[data-recop-conferencia]'); if (conf) { recopEnviarConferencia(conf.getAttribute('data-recop-conferencia')); return; }
    const fin = event.target.closest('[data-recop-finalizar]'); if (fin) { recopFinalizar(fin.getAttribute('data-recop-finalizar')); return; }
    const canc = event.target.closest('[data-recop-cancelar]'); if (canc) { recopCancelar(canc.getAttribute('data-recop-cancelar')); return; }
    const voltar = event.target.closest('[data-recop-voltar]'); if (voltar) { recopVoltarEtapa(voltar.getAttribute('data-recop-voltar')); return; }
    const aba = event.target.closest('[data-recop-aba]'); if (aba) { _abaRecebimento = aba.getAttribute('data-recop-aba'); _pagina = 1; _desenharRecebimentoOperacao(); return; }
  });
  document.addEventListener('change', function (event) {
    if (event.target.id === 'recop-f-hoje') { _filtroHoje = event.target.checked; _pagina = 1; _desenharRecebimentoOperacao(); return; }
    if (event.target.id === 'recop-motorista') { recopMotoristaAlterado(); return; }
    const notaCampo = event.target.closest('[data-recop-nota-campo]');
    if (notaCampo) recopNotaCampoAlterado(Number(notaCampo.getAttribute('data-recop-nota-idx')), notaCampo.getAttribute('data-recop-nota-campo'), notaCampo.value);
  });
})(window);
