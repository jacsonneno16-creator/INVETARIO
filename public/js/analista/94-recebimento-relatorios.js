// Recebimento — Notas Fiscais, Fornecedores, Agenda/Cargas e Histórico
// (fase 15/FASE 2d). Todas as 4 telas leem de `recebimentos` (fonte
// operacional única, via _recebimentoOperacaoInternals de
// 93-recebimento-operacao.js) — Fornecedores também cruza com
// `recebimento_notas` (histórico real da Bluesoft, via _recebimentoInternals
// de 91-logistica-recebimento.js) só pra achar divergência, sem duplicar
// cadastro de fornecedor nenhum.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const fmtMin = m => m == null ? '—' : (m >= 60 ? (m / 60).toFixed(1) + 'h' : Math.round(m) + 'min');
  const fmtData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—';
  const normFornecedor = v => String(v || '').trim().toUpperCase();
  const COL_AGENDAMENTOS = 'recebimento_agendamentos';
  const COL_AUDITORIA = 'recebimento_auditoria';
  const fmtHora = iso => iso ? String(iso).slice(11, 16) : '—';
  const fmtDataHora = iso => iso ? (fmtData(iso) + ' ' + fmtHora(iso)) : '—';

  function fs() { return global.getDTFirestore(); }
  function recebimentosOperacionais() { return global._recebimentoOperacaoInternals?.recebimentos?.() || []; }
  const ITENS_POR_PAGINA_BS = 50;

  // ── Notas Fiscais — seção principal: histórico completo direto da
  // Bluesoft (movida do Dashboard, que virou só um resumo agregado —
  // números de nota individuais bagunçavam a leitura de "visão geral" de
  // lá). Seção secundária: view achatada de recebimentos[].notas
  // (o que o Analista/Coletor anotou na hora do check-in, antes da
  // Bluesoft sincronizar). ─────────────────────────────────────────────
  let _filtroBsPeriodo = '';
  let _filtroBsFornecedor = '';
  let _filtroBsStatus = '';
  let _filtroBsNatureza = '';
  let _filtroBsSoDivergencia = false;
  let _filtroBsCategoria = ''; // '' = FORNECEDOR (padrão) | 'FORNECEDOR' | 'TRANSBORDO' | 'TODAS' (Fornecedor+Transbordo) — devolução some sempre (nunca é opção de filtro) e transbordo tem tela própria (95), por padrão (pedido ao vivo do usuário)
  let _paginaBs = 1;
  let _filtroNotasPeriodo = '';
  let _filtroNotasFornecedor = '';
  function _notasAchatadas() {
    const linhas = [];
    recebimentosOperacionais().forEach(r => (r.notas || []).forEach(nt => linhas.push({
      numero: nt.numero, serie: nt.serie, valor: n(nt.valor), quantidadeVolumes: n(nt.quantidadeVolumes),
      fornecedorNome: r.fornecedorNome, motoristaNome: r.motoristaNome, placa: r.placa, status: r.status,
      data: r.horaChegada || r.criadoEm,
    })));
    return linhas;
  }
  // Devolução nunca é opção de filtro (pedido do usuário: "tirar fora", não
  // "deixar escondida atrás de um filtro") — some sempre, com ou sem
  // categoria escolhida.
  function _notasBluesoftFiltradas() {
    const todas = global._recebimentoInternals?.notasTodas?.() || [];
    return todas.filter(x => {
      if (global.ehNotaDevolucaoBluesoft?.(x)) return false;
      const cat = global.categoriaNotaBluesoft?.(x) || 'FORNECEDOR';
      if (_filtroBsCategoria !== 'TODAS' && cat !== (_filtroBsCategoria || 'FORNECEDOR')) return false;
      if (_filtroBsPeriodo && String(x.processamento || x.dataRecebimento || '').slice(0, 7) !== _filtroBsPeriodo) return false;
      if (_filtroBsFornecedor && x.fornecedorNome !== _filtroBsFornecedor) return false;
      if (_filtroBsStatus && x.statusRecebimento !== _filtroBsStatus) return false;
      if (_filtroBsNatureza && x.natureza !== _filtroBsNatureza) return false;
      if (_filtroBsSoDivergencia && !x.temDivergencia) return false;
      return true;
    }).sort((a, b) => String(b.dataRecebimento || b.processamento || '').localeCompare(String(a.dataRecebimento || a.processamento || '')));
  }
  async function renderRecebimentoNotas() {
    const pagina = document.getElementById('page-recebimento-notas');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await Promise.all([global._recebimentoOperacaoInternals?.carregar?.(), global._recebimentoInternals?.carregar?.()]); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharRecebimentoNotas();
  }
  async function _salvarPortariaBs(notaFiscalKey, valorDatetimeLocal) {
    await global._recebimentoInternals?.salvarPortaria?.(notaFiscalKey, valorDatetimeLocal);
    _desenharRecebimentoNotas();
  }
  function _desenharRecebimentoNotas() {
    const pagina = document.getElementById('page-recebimento-notas');
    if (!pagina) return;

    // Bluesoft (principal)
    const todasBs = global._recebimentoInternals?.notasTodas?.() || [];
    const linhasBs = _notasBluesoftFiltradas();
    const fornecedoresOptsBs = [...new Set(todasBs.map(x => x.fornecedorNome).filter(Boolean))].sort();
    const statusOptsBs = [...new Set(todasBs.map(x => x.statusRecebimento).filter(Boolean))].sort();
    const naturezaOptsBs = [...new Set(todasBs.map(x => x.natureza).filter(Boolean))].sort();
    const totalPaginasBs = Math.max(1, Math.ceil(linhasBs.length / ITENS_POR_PAGINA_BS));
    if (_paginaBs > totalPaginasBs) _paginaBs = totalPaginasBs;
    const linhasBsPagina = linhasBs.slice((_paginaBs - 1) * ITENS_POR_PAGINA_BS, _paginaBs * ITENS_POR_PAGINA_BS);

    // Achatada (secundária, registrada manualmente nos recebimentos)
    const todas = _notasAchatadas();
    const linhas = todas
      .filter(x => !_filtroNotasPeriodo || String(x.data || '').slice(0, 7) === _filtroNotasPeriodo)
      .filter(x => !_filtroNotasFornecedor || x.fornecedorNome === _filtroNotasFornecedor)
      .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
    const fornecedoresOpts = [...new Set(todas.map(x => x.fornecedorNome).filter(Boolean))].sort();
    const valorTotal = linhas.reduce((s, x) => s + x.valor, 0);
    const volumesTotal = linhas.reduce((s, x) => s + x.quantidadeVolumes, 0);

    pagina.innerHTML = `
      <div style="margin-bottom:14px">
        <div class="page-title" style="font-size:1.15rem">📄 Notas Fiscais</div>
        <div style="font-size:.74rem;color:var(--muted)">${linhasBs.length.toLocaleString('pt-BR')} nota(s)${(_filtroBsCategoria || 'FORNECEDOR') === 'FORNECEDOR' ? ' (categoria: Fornecedor — transbordo fica na aba Transbordo)' : ''}</div>
      </div>
      <div class="tc" style="padding:12px;margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input type="month" class="field" id="recnf-bs-f-periodo" value="${esc(_filtroBsPeriodo)}" style="max-width:160px">
        <select class="field" id="recnf-bs-f-fornecedor" style="max-width:220px"><option value="">Todo fornecedor</option>${fornecedoresOptsBs.map(f => `<option ${f === _filtroBsFornecedor ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <select class="field" id="recnf-bs-f-status" style="max-width:200px"><option value="">Todo status</option>${statusOptsBs.map(s => `<option ${s === _filtroBsStatus ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select class="field" id="recnf-bs-f-natureza" style="max-width:200px"><option value="">Toda natureza</option>${naturezaOptsBs.map(nat => `<option ${nat === _filtroBsNatureza ? 'selected' : ''}>${esc(nat)}</option>`).join('')}</select>
        <select class="field" id="recnf-bs-f-categoria" style="max-width:170px" title="Categoria da nota — transbordo também aparece na aba Transbordo; devolução nunca conta como recebimento">
          <option value=""${!_filtroBsCategoria ? ' selected' : ''}>Fornecedor (padrão)</option>
          <option value="TRANSBORDO"${_filtroBsCategoria === 'TRANSBORDO' ? ' selected' : ''}>Transbordo</option>
          <option value="TODAS"${_filtroBsCategoria === 'TODAS' ? ' selected' : ''}>Todas</option>
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:.78rem"><input type="checkbox" id="recnf-bs-f-divergencia" ${_filtroBsSoDivergencia ? 'checked' : ''}> Só com divergência</label>
      </div>
      <div class="tc" style="margin-bottom:14px">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr><th>Nota</th><th>Fornecedor</th><th>Natureza</th><th>Recebimento</th><th>Tempo lançamento</th><th>Status</th><th>Divergência</th><th>Chegada portaria</th><th>Tempo até recebimento</th><th>Valor</th></tr></thead>
            <tbody>
              ${linhasBsPagina.length ? linhasBsPagina.map(x => `
                <tr>
                  <td class="mono">${esc(x.numeroNota ?? '—')}</td>
                  <td>${esc(x.fornecedorNome || '—')}</td>
                  <td>${esc(x.natureza || '—')}${global.categoriaNotaBluesoft?.(x) === 'TRANSBORDO' ? ' <span class="badge b-blue" style="font-size:.58rem">transbordo</span>' : ''}</td>
                  <td>${fmtData(x.dataRecebimento || x.processamento)}</td>
                  <td>${fmtMin(x.tempoLancamentoMin)}</td>
                  <td>${esc(x.statusRecebimento || x.status || '—')}</td>
                  <td>${x.comparavel ? (x.temDivergencia ? `<span class="badge b-red">${x.divergencia > 0 ? '+' : ''}${Number(x.divergencia).toLocaleString('pt-BR')}</span>` : '<span class="badge b-green">OK</span>') : '<span class="badge b-yellow" style="font-size:.6rem">sem comparação</span>'}</td>
                  <td><input type="datetime-local" class="field" style="font-size:.72rem;padding:4px 6px;min-width:170px" value="${x.chegadaPortaria ? esc(String(x.chegadaPortaria).slice(0, 16)) : ''}" data-recnf-bs-portaria="${esc(x.notaFiscalKey)}"></td>
                  <td>${fmtMin(x.tempoPortariaAteRecebimentoMin)}</td>
                  <td>${n(x.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                </tr>`).join('') : '<tr><td colspan="10"><div class="empty"><div class="empty-icon">🚚</div><div class="empty-title">Nenhuma nota encontrada</div><div class="empty-sub">Busque os dados no Dashboard pra trazer as notas.</div></div></td></tr>'}
            </tbody>
          </table>
        </div>
        ${totalPaginasBs > 1 ? `<div style="display:flex;justify-content:center;gap:8px;align-items:center;padding:10px"><button type="button" class="btn btn-ghost btn-sm" data-recnf-bs-pg="-1" ${_paginaBs <= 1 ? 'disabled' : ''}>‹ Anterior</button><span style="font-size:.75rem;color:var(--muted)">Página ${_paginaBs} de ${totalPaginasBs}</span><button type="button" class="btn btn-ghost btn-sm" data-recnf-bs-pg="1" ${_paginaBs >= totalPaginasBs ? 'disabled' : ''}>Próxima ›</button></div>` : ''}
      </div>
      <div style="margin:18px 0 10px"><b style="font-size:.92rem">📋 Notas registradas nos recebimentos (Fornecedor/Transbordo)</b><div style="font-size:.72rem;color:var(--muted)">Anotadas na hora do check-in — podem chegar antes da busca</div></div>
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${linhas.length.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Notas</div></div>
        <div class="kpi teal"><div class="kpi-val">${valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div><div class="kpi-lbl">Valor total</div></div>
        <div class="kpi purple"><div class="kpi-val">${volumesTotal.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Volumes</div></div>
      </div>
      <div class="tc" style="padding:12px;margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap">
        <input type="month" class="field" id="recnf-f-periodo" value="${esc(_filtroNotasPeriodo)}" style="max-width:160px">
        <select class="field" id="recnf-f-fornecedor" style="max-width:220px"><option value="">Todo fornecedor</option>${fornecedoresOpts.map(f => `<option ${f === _filtroNotasFornecedor ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
      </div>
      <div class="tc"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Número</th><th>Série</th><th>Fornecedor</th><th>Valor</th><th>Volumes</th><th>Motorista</th><th>Placa</th><th>Status</th><th>Data</th></tr></thead>
        <tbody>${linhas.length ? linhas.map(x => `<tr><td class="mono">${esc(x.numero)}</td><td>${esc(x.serie || '—')}</td><td>${esc(x.fornecedorNome || '—')}</td><td>${x.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${x.quantidadeVolumes.toLocaleString('pt-BR')}</td><td>${esc(x.motoristaNome || '—')}</td><td class="mono">${esc(x.placa || '—')}</td><td>${esc(x.status)}</td><td>${fmtData(x.data)}</td></tr>`).join('') : '<tr><td colspan="9"><div class="empty"><div class="empty-icon">📄</div><div class="empty-title">Nenhuma nota registrada ainda</div></div></td></tr>'}</tbody>
      </table></div></div>`;
  }

  // ── Fornecedores (ranking, seção 5) ──────────────────────────────────────
  async function renderRecebimentoFornecedores() {
    const pagina = document.getElementById('page-recebimento-fornecedores');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await Promise.all([global._recebimentoOperacaoInternals?.carregar?.(), global._recebimentoInternals?.carregar?.()]); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharRecebimentoFornecedores();
  }
  function _agregarFornecedores() {
    const recs = recebimentosOperacionais().filter(r => r.tipo === 'FORNECEDOR' && r.fornecedorNome);
    // O ranking não pode herdar filtros deixados na tela de Notas Fiscais:
    // usa a base completa e apenas cruza as divergências do fornecedor.
    const notasBluesoft = typeof global._recebimentoInternals?.notasTodas === 'function'
      ? global._recebimentoInternals.notasTodas()
      : (global._recebimentoInternals?.notasFiltradas?.() || []);
    const divergenciasPorFornecedor = new Map();
    notasBluesoft.forEach(x => {
      if (!x.temDivergencia || !x.fornecedorNome) return;
      const chave = normFornecedor(x.fornecedorNome);
      divergenciasPorFornecedor.set(chave, (divergenciasPorFornecedor.get(chave) || 0) + 1);
    });
    const porFornecedor = new Map();
    recs.forEach(r => {
      const chave = r.fornecedorNome;
      const acc = porFornecedor.get(chave) || {
        fornecedor: chave, qtdEntregas: 0, esperas: [], descargas: [], totais: [], qtdNotas: 0, volumes: 0, ultimo: null,
      };
      acc.qtdEntregas++;
      if (r.tempoEsperaMin != null) acc.esperas.push(r.tempoEsperaMin);
      if (r.tempoDescargaMin != null) acc.descargas.push(r.tempoDescargaMin);
      if (r.tempoTotalMin != null) acc.totais.push(r.tempoTotalMin);
      acc.qtdNotas += (r.notas || []).length;
      acc.volumes += (r.notas || []).reduce((s, nt) => s + (Number(nt.quantidadeVolumes) || 0), 0);
      const data = r.horaChegada || r.criadoEm;
      if (data && (!acc.ultimo || data > acc.ultimo)) acc.ultimo = data;
      porFornecedor.set(chave, acc);
    });
    const media = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    return [...porFornecedor.values()].map(acc => ({
      fornecedor: acc.fornecedor, qtdEntregas: acc.qtdEntregas,
      tempoMedioEspera: media(acc.esperas), tempoMedioDescarga: media(acc.descargas), tempoMedioTotal: media(acc.totais),
      qtdNotas: acc.qtdNotas, volumes: acc.volumes, ultimo: acc.ultimo,
      divergencias: divergenciasPorFornecedor.get(normFornecedor(acc.fornecedor)) || 0,
    }));
  }
  function _desenharRecebimentoFornecedores() {
    const pagina = document.getElementById('page-recebimento-fornecedores');
    if (!pagina) return;
    const linhas = _agregarFornecedores().sort((a, b) => b.qtdEntregas - a.qtdEntregas);
    const comTempo = linhas.filter(x => x.tempoMedioTotal != null);
    const maisPontuais = comTempo.slice().sort((a, b) => a.tempoMedioTotal - b.tempoMedioTotal).slice(0, 5);
    const maioresDescarga = linhas.filter(x => x.tempoMedioDescarga != null).sort((a, b) => b.tempoMedioDescarga - a.tempoMedioDescarga).slice(0, 5);
    const maioresEspera = linhas.filter(x => x.tempoMedioEspera != null).sort((a, b) => b.tempoMedioEspera - a.tempoMedioEspera).slice(0, 5);
    const maisDivergencias = linhas.filter(x => x.divergencias > 0).sort((a, b) => b.divergencias - a.divergencias).slice(0, 5);
    const maiorVolume = linhas.slice().sort((a, b) => b.volumes - a.volumes).slice(0, 5);

    const listaRanking = (titulo, itens, campo, fmt) => `
      <div class="tc" style="padding:12px">
        <b>${titulo}</b>
        <table class="dt-table" style="margin-top:8px"><tbody>
        ${itens.length ? itens.map(x => `<tr><td>${esc(x.fornecedor)}</td><td style="text-align:right;font-weight:700">${fmt(x[campo])}</td></tr>`).join('') : '<tr><td>Sem dados suficientes ainda.</td></tr>'}
        </tbody></table>
      </div>`;

    pagina.innerHTML = `
      <div style="margin-bottom:14px">
        <div class="page-title" style="font-size:1.15rem">🏢 Fornecedores</div>
        <div style="font-size:.74rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} fornecedor(es) com entrega registrada</div>
      </div>
      <div class="tc" style="margin-bottom:14px"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Fornecedor</th><th>Entregas</th><th>Espera méd.</th><th>Descarga méd.</th><th>Total méd.</th><th>Notas</th><th>Volumes</th><th>Divergências</th><th>Último recebimento</th></tr></thead>
        <tbody>${linhas.length ? linhas.map(x => `<tr><td><b>${esc(x.fornecedor)}</b></td><td>${x.qtdEntregas}</td><td>${fmtMin(x.tempoMedioEspera)}</td><td>${fmtMin(x.tempoMedioDescarga)}</td><td>${fmtMin(x.tempoMedioTotal)}</td><td>${x.qtdNotas}</td><td>${x.volumes.toLocaleString('pt-BR')}</td><td>${x.divergencias ? `<span class="badge b-red" style="font-size:.62rem">${x.divergencias}</span>` : '—'}</td><td>${fmtData(x.ultimo)}</td></tr>`).join('') : '<tr><td colspan="9"><div class="empty"><div class="empty-icon">🏢</div><div class="empty-title">Nenhum fornecedor com entrega registrada ainda</div></div></td></tr>'}</tbody>
      </table></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
        ${listaRanking('🏆 Mais pontuais (menor tempo total)', maisPontuais, 'tempoMedioTotal', fmtMin)}
        ${listaRanking('🐌 Maiores tempos de descarga', maioresDescarga, 'tempoMedioDescarga', fmtMin)}
        ${listaRanking('⏳ Maiores tempos de espera', maioresEspera, 'tempoMedioEspera', fmtMin)}
        ${listaRanking('⚠️ Mais divergências', maisDivergencias, 'divergencias', v => String(v))}
        ${listaRanking('📦 Maior volume recebido', maiorVolume, 'volumes', v => v.toLocaleString('pt-BR'))}
      </div>`;
  }

  // ── Agenda / Cargas (CRUD, seção 18) ─────────────────────────────────────
  let _agendamentos = [];
  let _agendamentosCarregados = false;
  let _filtrosAgenda = { loja: '', produto: '', tipo: '', agendado: '' };
  // Precisa ser estado do módulo (não só textContent do elemento) porque
  // _sincronizarAgenda chama _desenharRecebimentoAgendamentos logo depois de
  // escrever o status — isso reconstrói pagina.innerHTML do zero, criando um
  // #recag-sync-status NOVO e vazio, apagando a mensagem que acabou de ser
  // escrita (bug ao vivo relatado: toast aparece, mas a linha de status fica
  // em branco). Mesmo padrão de _ultimoSync em 91-logistica-recebimento.js.
  let _ultimoSyncAgenda = '';
  async function _carregarAgendamentos(forcar) {
    if (_agendamentosCarregados && !forcar) return;
    const snap = await fs().collection(COL_AGENDAMENTOS).get();
    _agendamentos = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    _agendamentosCarregados = true;
  }
  async function renderRecebimentoAgendamentos() {
    const pagina = document.getElementById('page-recebimento-agendamentos');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await _carregarAgendamentos(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharRecebimentoAgendamentos();
  }
  const AGENDA_STATUS_INFO = { AGENDADO: { label: 'Agendado', cor: 'b-blue' }, UTILIZADO: { label: 'Utilizado', cor: 'b-green' }, CANCELADO: { label: 'Cancelado', cor: 'b-gray' } };
  function _tipoItemAgenda(item) { const t=String(item?.tipoProduto||'').toUpperCase(),p=String(item?.produto||'').toUpperCase(); return t==='INSUMO'||/^MP\s*[-–]/.test(p)?'materia_prima':t==='PRODUTO_ACABADO'||t==='VENDA'?'produto_acabado':'outros'; }
  function _desenharRecebimentoAgendamentos() {
    const pagina = document.getElementById('page-recebimento-agendamentos');
    if (!pagina) return;
    const lojas=[...new Map(_agendamentos.map(a=>[String(a.lojaId||''),a.lojaNome||a.lojaId||'Loja ativa'])).entries()],produtos=[...new Set(_agendamentos.flatMap(a=>(a.itensPedido||[]).map(i=>i.produto)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const linhas = _agendamentos.filter(a=>{const itens=a.itensPedido||[],ag=!!a.dataAgendada;if(_filtrosAgenda.loja&&String(a.lojaId||'')!==_filtrosAgenda.loja)return false;if(_filtrosAgenda.produto&&!itens.some(i=>i.produto===_filtrosAgenda.produto))return false;if(_filtrosAgenda.tipo&&!itens.some(i=>_tipoItemAgenda(i)===_filtrosAgenda.tipo))return false;if(_filtrosAgenda.agendado==='sim'&&!ag)return false;if(_filtrosAgenda.agendado==='nao'&&ag)return false;return true;}).sort((a, b) => String(a.dataAgendada || a.dataPrevista || '').localeCompare(String(b.dataAgendada || b.dataPrevista || '')));
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📅 Agenda / Cargas</div><div style="font-size:.74rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} agendamento(s) — pedidos de compra pendentes de entrega são puxados automaticamente ao sincronizar</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn btn-ghost btn-sm" data-recag-sync="1">🔎 Buscar pedidos pendentes</button>
          ${global.DTBiPastaLocal?.suportado?.() ? '<button type="button" class="btn btn-ghost btn-sm" data-recag-buscar-bi="1">📊 Buscar do BI</button>' : ''}
          <button type="button" class="btn btn-primary btn-sm" data-recag-novo="1">+ Novo Agendamento</button>
        </div>
      </div>
      <div id="recag-sync-status" style="font-size:.72rem;color:var(--muted);margin:-8px 0 6px">${esc(_ultimoSyncAgenda)}</div>
      ${_ultimaBuscaBiCompras ? `<div style="font-size:.7rem;color:var(--muted);margin:0 0 12px;padding:6px 10px;border-radius:8px;background:#f3f4f6">${esc(_ultimaBuscaBiCompras)}</div>` : ''}
      <div class="tc" style="padding:10px;margin-bottom:12px;display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:7px"><select class="field" data-recag-filter="loja"><option value="">Todas as lojas</option>${lojas.map(([id,nome])=>`<option value="${esc(id)}" ${_filtrosAgenda.loja===id?'selected':''}>${esc(nome)}</option>`).join('')}</select><select class="field" data-recag-filter="produto"><option value="">Todos os produtos</option>${produtos.map(p=>`<option ${_filtrosAgenda.produto===p?'selected':''}>${esc(p)}</option>`).join('')}</select><select class="field" data-recag-filter="tipo"><option value="">Matéria-prima + produto acabado</option><option value="materia_prima" ${_filtrosAgenda.tipo==='materia_prima'?'selected':''}>Matéria-prima</option><option value="produto_acabado" ${_filtrosAgenda.tipo==='produto_acabado'?'selected':''}>Produto acabado</option><option value="outros" ${_filtrosAgenda.tipo==='outros'?'selected':''}>Outros</option></select><select class="field" data-recag-filter="agendado"><option value="">Agendados e não agendados</option><option value="sim" ${_filtrosAgenda.agendado==='sim'?'selected':''}>Agendados</option><option value="nao" ${_filtrosAgenda.agendado==='nao'?'selected':''}>Não agendados</option></select></div>
      <div class="tc"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Origem</th><th>Loja</th><th>Pedido</th><th>Fornecedor</th><th>Produtos</th><th>Previsto</th><th>Agendado</th><th>Hora</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas.length ? linhas.map(a => { const st = AGENDA_STATUS_INFO[a.status] || AGENDA_STATUS_INFO.AGENDADO,itens=a.itensPedido||[]; return `<tr><td>${a.origem==='bi'?'<span class="badge b-blue" style="font-size:.6rem">🔗 SharePoint</span>':a.origem==='bluesoft'?'<span class="badge b-blue" style="font-size:.6rem">🔗 Bluesoft</span>':'<span class="badge b-gray" style="font-size:.6rem">Manual</span>'}</td><td>${esc(a.lojaNome||a.lojaId||'—')}</td><td class="mono">${esc(a.numeroPedido||a.codigo||'—')}</td><td><b>${esc(a.fornecedorNome)}</b></td><td>${itens.length?itens.map(i=>`<div><b>${esc(i.produto||'Produto')}</b> · ${Number(i.quantidadePendente||0).toLocaleString('pt-BR')}</div>`).join(''):'—'}</td><td>${fmtData(a.dataPrevista)}</td><td>${a.dataAgendada?`<span class="badge b-green">${fmtData(a.dataAgendada)}</span>`:'<span class="badge b-orange">Não agendado</span>'}</td><td>${esc(a.horaAgendada || '—')}</td><td><span class="badge ${st.cor}" style="font-size:.62rem">${st.label}</span></td><td style="white-space:nowrap"><button type="button" class="acao-lapis" title="Editar" data-recag-editar="${esc(a._id)}">✏️</button><button type="button" class="acao-lapis" title="Excluir" data-recag-excluir="${esc(a._id)}">🗑️</button></td></tr>`; }).join('') : '<tr><td colspan="10"><div class="empty"><div class="empty-icon">📅</div><div class="empty-title">Nenhum agendamento encontrado</div></div></td></tr>'}</tbody>
      </table></div></div>`;
    global.aplicarPermissoesAnalista?.();
    _iniciarAutoRefreshBiCompras();
  }
  async function _sincronizarAgenda() {
    const statusEl = document.getElementById('recag-sync-status');
    if (typeof global.sincronizarAgendaBluesoft !== 'function') { global.showToast?.('Serviço de busca indisponível.', 'error'); return; }
    if (statusEl) statusEl.textContent = '⏳ Buscando pedidos de compra pendentes...';
    try {
      const r = await global.sincronizarAgendaBluesoft();
      const avisoSemPedidos = r.totalPedidos === 0 ? ' — esta loja não tem nenhum Pedido de Compra cadastrado (provavelmente lança nota direto, sem PO)' : '';
      _ultimoSyncAgenda = r.totalPedidosPendentes.toLocaleString('pt-BR') + ' de ' + r.totalPedidos.toLocaleString('pt-BR') + ' pedido(s) pendente(s) (' + r.criados + ' novo(s), ' + r.atualizados + ' atualizado(s))' + avisoSemPedidos + ' · ' + new Date().toLocaleString('pt-BR');
      await _carregarAgendamentos(true);
      _desenharRecebimentoAgendamentos();
      global.showToast?.('Agenda sincronizada: ' + r.criados + ' novo(s), ' + r.atualizados + ' atualizado(s).', 'success');
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Erro: ' + (e.message || e);
      global.showToast?.('Erro ao sincronizar agenda: ' + (e.message || e), 'error');
    }
  }
  // PEDIDO AO VIVO (2026-08-26): mesmo padrão "conecta a pasta do BI uma
  // vez, clica em Buscar" das outras telas — compras_a_receber.json alimenta
  // a MESMA Agenda de Recebimento (recebimento_agendamentos), via
  // importarComprasAReceberBiJson (90-bluesoft-service.js).
  const ARQUIVO_BI_COMPRAS_A_RECEBER = 'compras_a_receber.json';
  const INTERVALO_AUTO_BUSCA_BI_MS = 30 * 60 * 1000; // pedido ao vivo: a cada 30 minutos
  let _ultimaBuscaBiCompras = '';
  let _autoRefreshBiComprasIniciado = false;
  function _fmtHoraCompras(v) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function _resultadoImportComprasBiTexto(r) {
    return `${r.totalPedidosPendentes.toLocaleString('pt-BR')} pedido(s) pendente(s) do BI (${r.criados} novo(s), ${r.atualizados} atualizado(s))`;
  }
  async function _processarComprasAReceberBiRegistros(registros) {
    if (typeof global.importarComprasAReceberBiJson !== 'function') { global.showToast?.('Serviço de importação indisponível.', 'error'); return; }
    const r = await global.importarComprasAReceberBiJson(registros);
    await _carregarAgendamentos(true);
    return r;
  }
  async function _buscarComprasAReceberBiAutomatico() {
    if (!global.DTBiPastaLocal?.suportado?.()) return;
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') {
      const resultado = await global.DTBiPastaLocal.conectar();
      if (!resultado.ok) { global.showToast?.(resultado.erro, 'error'); return; }
    }
    try {
      const registros = await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_COMPRAS_A_RECEBER);
      const r = await _processarComprasAReceberBiRegistros(registros);
      _ultimaBuscaBiCompras = `Última atualização: ${_fmtHoraCompras(new Date().toISOString())} — ${_resultadoImportComprasBiTexto(r)}.`;
      _desenharRecebimentoAgendamentos();
    } catch (e) {
      _ultimaBuscaBiCompras = `Falha na última busca (${_fmtHoraCompras(new Date().toISOString())}): ${e.message || e}`;
      global.showToast?.('Erro ao buscar no BI: ' + (e.message || e), 'error');
      _desenharRecebimentoAgendamentos();
    }
  }
  function _iniciarAutoRefreshBiCompras() {
    if (_autoRefreshBiComprasIniciado) return;
    if (!global.DTBiPastaLocal?.suportado?.() || typeof global.setInterval !== 'function') return;
    _autoRefreshBiComprasIniciado = true;
    global.setInterval(async () => {
      try {
        const status = await global.DTBiPastaLocal.status();
        if (status === 'conectado') await _buscarComprasAReceberBiAutomatico();
      } catch (e) { /* silencioso — só o clique manual mostra erro */ }
    }, INTERVALO_AUTO_BUSCA_BI_MS);
  }
  function recagNovo() { _abrirModalRecag({ _novo: true, fornecedorNome: '', dataAgendada: '', horaAgendada: '', codigo: '', motoristaNome: '', placa: '', status: 'AGENDADO', observacao: '' }); }
  function recagEditar(id) { const item = _agendamentos.find(a => a._id === id); if (item) _abrirModalRecag(item); }
  function _abrirModalRecag(item) {
    document.getElementById('recag-title').textContent = item._novo ? 'Novo agendamento' : 'Editar agendamento';
    document.getElementById('recag-doc-id').value = item._id || '';
    document.getElementById('recag-fornecedor').value = item.fornecedorNome || '';
    document.getElementById('recag-data').value = item.dataAgendada || '';
    document.getElementById('recag-hora').value = item.horaAgendada || '';
    document.getElementById('recag-codigo').value = item.codigo || '';
    document.getElementById('recag-motorista').value = item.motoristaNome || '';
    document.getElementById('recag-placa').value = item.placa || '';
    document.getElementById('recag-status').value = item.status || 'AGENDADO';
    document.getElementById('recag-observacao').value = item.observacao || '';
    global.openModal?.('modal-recag');
  }
  async function recagSalvar() {
    const fornecedorNome = String(document.getElementById('recag-fornecedor').value || '').trim();
    const dataAgendada = document.getElementById('recag-data').value || '';
    if (!fornecedorNome || !dataAgendada) { global.showToast?.('Informe fornecedor e data.', 'error'); return; }
    const payload = {
      fornecedorNome, dataAgendada, horaAgendada: document.getElementById('recag-hora').value || '',
      codigo: String(document.getElementById('recag-codigo').value || '').trim(),
      motoristaNome: String(document.getElementById('recag-motorista').value || '').trim(),
      placa: String(document.getElementById('recag-placa').value || '').trim().toUpperCase(),
      status: document.getElementById('recag-status').value || 'AGENDADO',
      observacao: String(document.getElementById('recag-observacao').value || '').trim(),
      agendamentoConfirmadoManual: true,
      lojaId: global.getDTLojaAtiva?.() || '',
      lojaNome: global.getDTLojaAtivaNome?.() || global.getDTLojaAtiva?.() || '',
      atualizadoEm: new Date().toISOString(),
    };
    const docId = document.getElementById('recag-doc-id').value || '';
    try {
      if (docId) await fs().collection(COL_AGENDAMENTOS).doc(docId).set(payload, { merge: true });
      else { payload.criadoEm = payload.atualizadoEm; await fs().collection(COL_AGENDAMENTOS).add(payload); }
      global.closeModal?.('modal-recag');
      global.showToast?.('Agendamento salvo.', 'success');
      await _carregarAgendamentos(true);
      _desenharRecebimentoAgendamentos();
    } catch (e) { global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error'); }
  }
  async function recagExcluir(id) {
    const item = _agendamentos.find(a => a._id === id);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_AGENDAMENTOS).doc(id).delete();
        global.showToast?.('Agendamento excluído.', 'success');
        await _carregarAgendamentos(true);
        _desenharRecebimentoAgendamentos();
      } catch (e) { global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error'); }
    };
    if (global.showConfirm) global.showConfirm('Excluir o agendamento de "' + item.fornecedorNome + '"?', executar, { title: 'Excluir agendamento', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir agendamento?')) await executar();
  }

  // ── Histórico (finalizados/cancelados + export CSV, seção 27) ──────────
  let _filtroHistPeriodo = '';
  async function renderRecebimentoHistorico() {
    const pagina = document.getElementById('page-recebimento-historico');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await global._recebimentoOperacaoInternals?.carregar?.(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharRecebimentoHistorico();
  }
  function _historicoFiltrado() {
    return recebimentosOperacionais()
      .filter(r => ['FINALIZADO', 'CANCELADO'].includes(r.status))
      .filter(r => !_filtroHistPeriodo || String(r.horaChegada || r.criadoEm || '').slice(0, 7) === _filtroHistPeriodo)
      .sort((a, b) => String(b.horaChegada || b.criadoEm || '').localeCompare(String(a.horaChegada || a.criadoEm || '')));
  }
  function _desenharRecebimentoHistorico() {
    const pagina = document.getElementById('page-recebimento-historico');
    if (!pagina) return;
    const linhas = _historicoFiltrado();
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📋 Histórico</div><div style="font-size:.74rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} recebimento(s) finalizado(s)/cancelado(s)</div></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="month" class="field" id="recist-f-periodo" value="${esc(_filtroHistPeriodo)}" style="max-width:160px">
          <button type="button" class="btn btn-ghost btn-sm" data-recist-exportar="1">⬇ Exportar CSV</button>
        </div>
      </div>
      <div class="tc"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Status</th><th>Fornecedor/Motorista</th><th>Nota Fiscal</th><th>Placa</th><th>Saída</th><th>Chegada</th><th>Tempo viagem</th><th>Início descarga</th><th>Fim descarga</th><th>Descarga</th><th>Conferência</th><th>Espera</th><th>Total</th><th>Responsável</th><th></th></tr></thead>
        <tbody>${linhas.length ? linhas.map(r => `<tr><td><span class="badge ${r.status === 'FINALIZADO' ? 'b-green' : 'b-gray'}" style="font-size:.62rem">${esc(r.status)}</span></td><td>${esc(r.fornecedorNome || r.motoristaNome || '—')}</td><td class="mono">${esc(r.notaFiscalTransferencia || '—')}</td><td class="mono">${esc(r.placa || '—')}</td><td>${fmtDataHora(r.horaSaida)}</td><td>${fmtDataHora(r.horaChegada)}</td><td>${fmtMin(r.tempoViagemMin)}</td><td>${fmtDataHora(r.horaInicioDescarga)}</td><td>${fmtDataHora(r.horaFimDescarga)}</td><td>${fmtMin(r.tempoDescargaMin)}</td><td>${fmtDataHora(r.horaFechamentoRecebimento)}</td><td>${fmtMin(r.tempoEsperaMin)}</td><td>${fmtMin(r.tempoTotalMin)}</td><td style="font-size:.68rem;color:var(--muted)">${esc(r.responsavel || '—')}</td><td><button type="button" class="acao-lapis" title="Ver histórico das etapas" data-recist-etapas="${esc(r._id)}">🕓</button></td></tr>`).join('') : '<tr><td colspan="15"><div class="empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhum recebimento finalizado/cancelado ainda</div></div></td></tr>'}</tbody>
      </table></div></div>`;
    global.aplicarPermissoesAnalista?.();
  }
  function _exportarHistoricoCsv() {
    const linhas = _historicoFiltrado();
    const cab = ['Status', 'Fornecedor', 'Motorista', 'NotaFiscal', 'Placa', 'Saida', 'Chegada', 'TempoViagemMin', 'InicioDescarga', 'FimDescarga', 'DescargaMin', 'Conferencia', 'EsperaMin', 'TotalMin', 'Responsavel'];
    const corpo = linhas.map(r => [r.status, r.fornecedorNome || '', r.motoristaNome || '', r.notaFiscalTransferencia || '', r.placa || '', r.horaSaida || '', r.horaChegada || '', r.tempoViagemMin ?? '', r.horaInicioDescarga || '', r.horaFimDescarga || '', r.tempoDescargaMin ?? '', r.horaFechamentoRecebimento || '', r.tempoEsperaMin ?? '', r.tempoTotalMin ?? '', r.responsavel || '']);
    const csv = [cab, ...corpo].map(linha => linha.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'recebimento-historico-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  }

  // ── Histórico das etapas (item 5 do pedido: "Histórico das etapas" como
  // campo do relatório) — lê direto de recebimento_auditoria, que já é
  // gravado a cada transição pelo próprio fluxo (nunca Bluesoft). ─────────
  const _auditoriaPorRecebimento = new Map();
  async function _carregarAuditoriaTodas(recebimentoId, forcar) {
    if (_auditoriaPorRecebimento.has(recebimentoId) && !forcar) return _auditoriaPorRecebimento.get(recebimentoId);
    const snap = await fs().collection(COL_AUDITORIA).where('recebimentoId', '==', recebimentoId).get();
    const etapas = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    _auditoriaPorRecebimento.set(recebimentoId, etapas);
    return etapas;
  }
  function _etapasDoRecebimento(recebimentoId) {
    return (_auditoriaPorRecebimento.get(recebimentoId) || []).slice().sort((a, b) => String(a.dataHora || '').localeCompare(String(b.dataHora || '')));
  }
  async function _verEtapasHistorico(recebimentoId) {
    const r = recebimentosOperacionais().find(x => x._id === recebimentoId);
    const corpo = document.getElementById('recist-etapas-corpo');
    if (corpo) corpo.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    global.openModal?.('modal-recist-etapas');
    try { await _carregarAuditoriaTodas(recebimentoId); } catch (e) { if (corpo) corpo.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div></div>'; return; }
    const etapas = _etapasDoRecebimento(recebimentoId);
    if (!corpo) return;
    corpo.innerHTML = `
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:10px">${esc(r?.motoristaNome || r?.fornecedorNome || '')}${r?.notaFiscalTransferencia ? ' · NF ' + esc(r.notaFiscalTransferencia) : ''}</div>
      ${etapas.length ? `<table class="dt-table"><thead><tr><th>Quando</th><th>Etapa</th><th>De</th><th>Para</th><th>Usuário</th></tr></thead><tbody>
        ${etapas.map(a => `<tr><td>${fmtDataHora(a.dataHora)}</td><td>${esc(a.operacao)}</td><td>${esc(a.valorAnterior ?? '—')}</td><td>${esc(a.valorNovo ?? '—')}</td><td style="font-size:.7rem;color:var(--muted)">${esc(a.usuario || '—')}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty"><div class="empty-icon">🕓</div><div class="empty-title">Nenhuma etapa registrada</div></div>'}`;
  }

  global.renderRecebimentoNotas = renderRecebimentoNotas;
  global.renderRecebimentoFornecedores = renderRecebimentoFornecedores;
  global.renderRecebimentoAgendamentos = renderRecebimentoAgendamentos;
  global.renderRecebimentoHistorico = renderRecebimentoHistorico;
  global.recagSalvar = recagSalvar;
  global._recebimentoRelatoriosInternals = { notasAchatadas: _notasAchatadas, notasBluesoftFiltradas: _notasBluesoftFiltradas, agregarFornecedores: _agregarFornecedores, historicoFiltrado: _historicoFiltrado, sincronizarAgenda: _sincronizarAgenda, etapasDoRecebimento: _etapasDoRecebimento, carregarAuditoriaTodas: _carregarAuditoriaTodas, verEtapasHistorico: _verEtapasHistorico, buscarComprasAReceberBiAutomatico: _buscarComprasAReceberBiAutomatico, ARQUIVO_BI_COMPRAS_A_RECEBER };

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-recag-sync]')) { _sincronizarAgenda(); return; }
    if (event.target.closest('[data-recag-buscar-bi]')) { _buscarComprasAReceberBiAutomatico(); return; }
    if (event.target.closest('[data-recag-novo]')) { recagNovo(); return; }
    const edit = event.target.closest('[data-recag-editar]'); if (edit) { recagEditar(edit.getAttribute('data-recag-editar')); return; }
    const del = event.target.closest('[data-recag-excluir]'); if (del) { recagExcluir(del.getAttribute('data-recag-excluir')); return; }
    if (event.target.closest('[data-recist-exportar]')) { _exportarHistoricoCsv(); return; }
    const pgBs = event.target.closest('[data-recnf-bs-pg]'); if (pgBs) { _paginaBs += Number(pgBs.getAttribute('data-recnf-bs-pg')); _desenharRecebimentoNotas(); return; }
    const etapas = event.target.closest('[data-recist-etapas]'); if (etapas) { _verEtapasHistorico(etapas.getAttribute('data-recist-etapas')); return; }
  });
  document.addEventListener('change', function (event) {
    const agendaFiltro=event.target.closest('[data-recag-filter]'); if(agendaFiltro){_filtrosAgenda[agendaFiltro.getAttribute('data-recag-filter')]=agendaFiltro.value;_desenharRecebimentoAgendamentos();return;}
    if (event.target.id === 'recnf-f-periodo') { _filtroNotasPeriodo = event.target.value; _desenharRecebimentoNotas(); return; }
    if (event.target.id === 'recnf-f-fornecedor') { _filtroNotasFornecedor = event.target.value; _desenharRecebimentoNotas(); return; }
    if (event.target.id === 'recist-f-periodo') { _filtroHistPeriodo = event.target.value; _desenharRecebimentoHistorico(); return; }
    if (event.target.id === 'recnf-bs-f-periodo') { _filtroBsPeriodo = event.target.value; _paginaBs = 1; _desenharRecebimentoNotas(); return; }
    if (event.target.id === 'recnf-bs-f-fornecedor') { _filtroBsFornecedor = event.target.value; _paginaBs = 1; _desenharRecebimentoNotas(); return; }
    if (event.target.id === 'recnf-bs-f-status') { _filtroBsStatus = event.target.value; _paginaBs = 1; _desenharRecebimentoNotas(); return; }
    if (event.target.id === 'recnf-bs-f-natureza') { _filtroBsNatureza = event.target.value; _paginaBs = 1; _desenharRecebimentoNotas(); return; }
    if (event.target.id === 'recnf-bs-f-divergencia') { _filtroBsSoDivergencia = event.target.checked; _paginaBs = 1; _desenharRecebimentoNotas(); return; }
    if (event.target.id === 'recnf-bs-f-categoria') { _filtroBsCategoria = event.target.value || ''; _paginaBs = 1; _desenharRecebimentoNotas(); return; }
    const portariaBs = event.target.closest('[data-recnf-bs-portaria]'); if (portariaBs) { _salvarPortariaBs(portariaBs.getAttribute('data-recnf-bs-portaria'), portariaBs.value); return; }
  });
})(window);
