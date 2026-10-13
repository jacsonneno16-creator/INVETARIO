// Recebimento > Devoluções — unificado (PROMPT-DEVOLUCOES-UNIFICADAS-
// 2026-10-13). Substitui 100-consulta-notas-fiscais.js ("Devoluções (BI)")
// e 102-devolucoes-bi-indicadores.js ("Indicadores de Devoluções") por uma
// única entrada com 3 abas: Controle (consulta o catálogo fiscal novo,
// devolucoes_notas, que já importa TODOS os motivos como PENDENTE desde o
// primeiro momento — ver _sincronizarDevolucoesBiLoja em functions/
// index.js), Relatórios (bipagem — "Montar relatório" confirma o
// recebimento fiscal da própria NF de devolução, usando a MESMA transação
// atômica que devolucoes_recebimentos/{chave} usa pro Coletor, então nunca
// cria 2 "primeiros recebimentos" pra mesma chave) e Indicadores (adapta
// os gráficos/KPIs do painel antigo pra ler do catálogo novo).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDataBR = iso => iso ? String(iso).split('-').reverse().join('/') : '—';
  const fmtHora = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  function tem(acao) { return typeof global.temPermissao !== 'function' || global.temPermissao('recebimento-devolucoes', acao); }
  function lojaAtiva() { return typeof global.getDTLojaAtiva === 'function' ? global.getDTLojaAtiva() : ''; }
  function fs() { return global.getDTFirestore(); }
  function raw() { return typeof global.getDTRawFirestore === 'function' ? global.getDTRawFirestore() : fs(); }
  function call(nome, dados) { return global.firebase.app().functions('southamerica-east1').httpsCallable(nome)(dados || {}).then(r => r.data || {}); }
  function usuarioAtual() {
    const u = global.firebase?.auth?.().currentUser;
    return u ? { uid: u.uid || '', email: u.email || '' } : { uid: '', email: '' };
  }
  function mesAnoDe(iso) {
    const s = String(iso || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(s)) return '';
    const [ano, mes] = s.split('-');
    return mes + '/' + ano;
  }
  function extrairRede(destinatario) {
    const s = String(destinatario || '').trim();
    const idx = s.indexOf(' - ');
    return (idx > -1 ? s.slice(0, idx) : s).trim();
  }

  let _containerId = 'page-recebimento-devolucoes';
  let _aba = 'controle';

  // ───────────────────────── ABA CONTROLE ─────────────────────────
  let _ctrlFiltros = { estado: '', motivo: '', numeroNota: '', chave: '', mercado: '', ini: '', fim: '', campoData: 'emissao' };
  let _ctrlNotas = [];
  let _ctrlCarregando = false;
  let _ctrlErro = '';
  let _ctrlBuscouAlgumaVez = false;
  let _ctrlSyncTexto = '';
  let _ctrlSincronizando = false;

  async function _ctrlBuscar() {
    _ctrlCarregando = true; _ctrlErro = ''; _desenharAbaAtiva();
    try {
      const payload = { lojaId: lojaAtiva(), campoData: _ctrlFiltros.campoData };
      ['estado', 'motivo', 'numeroNota', 'chave', 'mercado', 'ini', 'fim'].forEach(k => { if (_ctrlFiltros[k]) payload[k] = _ctrlFiltros[k]; });
      const r = await call('listarDevolucoesBigQuery', payload);
      _ctrlNotas = r.notas || [];
      _ctrlBuscouAlgumaVez = true;
    } catch (e) { _ctrlErro = e.message || String(e); }
    _ctrlCarregando = false; _desenharAbaAtiva();
  }

  async function _ctrlAtualizarBi() {
    _ctrlSincronizando = true; _desenharAbaAtiva();
    try {
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('sincronizarBiAgendadoAgora');
      const resp = await callable({});
      const resultados = resp?.data?.resultados || [];
      const comDevolucao = resultados.filter(r0 => r0 && r0.devolucoesBi && !r0.erro);
      const totais = comDevolucao.reduce((a, r0) => ({
        novas: a.novas + (r0.devolucoesBi.novas || 0),
        atualizadas: a.atualizadas + (r0.devolucoesBi.atualizadas || 0),
        invalidas: a.invalidas + (r0.devolucoesBi.invalidas || 0),
      }), { novas: 0, atualizadas: 0, invalidas: 0 });
      _ctrlSyncTexto = `Última atualização: ${fmtHora(new Date().toISOString())} — ${totais.novas} nova(s), ${totais.atualizadas} atualizada(s)${totais.invalidas ? `, ${totais.invalidas} inválida(s)` : ''} (todas as lojas).`;
      global.showToast?.('BI: ' + _ctrlSyncTexto, 'success');
      if (_ctrlBuscouAlgumaVez) await _ctrlBuscar();
    } catch (e) {
      if (e?.code !== 'permission-denied' && e?.code !== 'unauthenticated') {
        global.showToast?.('Falha ao atualizar do BI: ' + (e.message || e), 'error');
      } else {
        global.showToast?.('Somente administrador pode atualizar do BI agora — a sincronização automática roda sozinha 2x/dia.', 'i');
      }
    }
    _ctrlSincronizando = false; _desenharAbaAtiva();
  }

  function _ctrlLinhaHtml(n) {
    const pendente = n.estado !== 'RECEBIDA';
    return `<tr>
      <td class="mono" style="font-size:.68rem;max-width:180px;word-break:break-all">${esc(n.chave)}</td>
      <td>${esc(n.numeroNota || '—')}</td>
      <td>${fmtDataBR(n.dataEmissao)}</td>
      <td>${esc(n.destinatario || '—')}</td>
      <td>${fmtBRL(n.valorTotal)}</td>
      <td style="font-size:.72rem">${esc(n.motivoNormalizado || '—')}</td>
      <td>${pendente ? '<span class="badge" style="background:#4a3114;color:#ffd18a;font-size:.65rem">⏳ Pendente</span>' : '<span class="badge" style="background:#123a24;color:#8fdcb0;font-size:.65rem">✓ Recebida</span>'}</td>
    </tr>`;
  }

  function desenharControle() {
    const alvo = document.getElementById('devol-conteudo');
    if (!alvo) return;
    const f = _ctrlFiltros;
    alvo.innerHTML = `
      <div style="color:var(--muted);font-size:.78rem;margin-bottom:10px">Catálogo fiscal de devoluções — TODOS os motivos importados como pendente desde o primeiro momento, consultável mesmo antes do retorno físico.</div>
      <div class="tc" style="padding:14px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <b>📊 Importação do BI</b>
          ${tem('importar') ? `<button type="button" class="btn btn-primary btn-sm" data-devol-atualizar-bi="1" ${_ctrlSincronizando ? 'disabled' : ''}>${_ctrlSincronizando ? '⏳ Atualizando...' : '📊 Atualizar do BI'}</button>` : ''}
        </div>
        ${_ctrlSyncTexto ? `<div style="font-size:.72rem;color:var(--muted);margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--surface-2)">${esc(_ctrlSyncTexto)}</div>` : ''}
      </div>
      <div class="tc" style="padding:14px;margin-bottom:12px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ESTADO</div><select class="field" id="devol-f-estado" style="padding:7px">
            <option value="">Todas</option><option value="PENDENTE" ${f.estado === 'PENDENTE' ? 'selected' : ''}>Pendente</option><option value="RECEBIDA" ${f.estado === 'RECEBIDA' ? 'selected' : ''}>Recebida</option>
          </select></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">MOTIVO</div><input class="field" id="devol-f-motivo" value="${esc(f.motivo)}" placeholder="ex.: TROCA" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">Nº NF</div><input class="field" id="devol-f-numero" value="${esc(f.numeroNota)}" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">CHAVE EXATA</div><input class="field" id="devol-f-chave" value="${esc(f.chave)}" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">MERCADO/REDE</div><input class="field" id="devol-f-mercado" value="${esc(f.mercado)}" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">CAMPO DE DATA</div><select class="field" id="devol-f-campo-data" style="padding:7px">
            <option value="emissao" ${f.campoData === 'emissao' ? 'selected' : ''}>Emissão</option><option value="recebimento" ${f.campoData === 'recebimento' ? 'selected' : ''}>Recebimento</option>
          </select></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">DE</div><input type="date" class="field" id="devol-f-ini" value="${esc(f.ini)}" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input type="date" class="field" id="devol-f-fim" value="${esc(f.fim)}" style="padding:7px"></div>
        </div>
        <div style="margin-top:10px"><button type="button" class="btn btn-primary btn-sm" data-devol-consultar="1" ${_ctrlCarregando ? 'disabled' : ''}>${_ctrlCarregando ? '⏳ Consultando...' : '🔍 Consultar'}</button></div>
      </div>
      ${_ctrlErro ? `<div style="font-size:.76rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin-bottom:10px">⚠️ ${esc(_ctrlErro)}</div>` : ''}
      <div class="tc" style="padding:14px"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Chave</th><th>NF</th><th>Emissão</th><th>Destinatário</th><th>Valor</th><th>Motivo</th><th>Estado</th></tr></thead>
        <tbody>${_ctrlNotas.length ? _ctrlNotas.map(_ctrlLinhaHtml).join('') : `<tr><td colspan="7"><div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">${_ctrlBuscouAlgumaVez ? 'Nenhuma nota para os filtros aplicados' : 'Escolha os filtros e clique em Consultar'}</div></div></td></tr>`}</tbody>
      </table></div><div style="font-size:.68rem;color:var(--muted);margin-top:6px">Mostrando até 500 notas mais recentes para os filtros aplicados.</div></div>`;
  }

  // ───────────────────────── ABA RELATÓRIOS (bipagem) ─────────────────────────
  const LS_KEY_RASCUNHO = 'dt_devol_relatorio_rascunho';
  let _rel = null; // {relatorioId, lojaId, linhas:[{chave,seq,estado,numeroNota,destinatario,valorTotal,erroMsg,confirmadoPor,confirmadoEm,origemAnterior}]}
  let _relProcessando = false;
  let _relSeq = 0;

  function _relCarregarDoStorage() {
    try {
      const txt = localStorage.getItem(LS_KEY_RASCUNHO);
      if (!txt) return null;
      const dados = JSON.parse(txt);
      if (dados && dados.relatorioId && Array.isArray(dados.linhas)) return dados;
    } catch (_e) { /* storage indisponível/corrompido — começa do zero */ }
    return null;
  }
  function _relSalvarNoStorage() {
    if (!_rel) { try { localStorage.removeItem(LS_KEY_RASCUNHO); } catch (_e) { /* ignora */ } return; }
    try { localStorage.setItem(LS_KEY_RASCUNHO, JSON.stringify(_rel)); } catch (_e) { /* ignora — pior caso perde o rascunho num refresh */ }
  }

  async function _relIniciar() {
    const existente = _relCarregarDoStorage();
    if (existente && existente.lojaId === lojaAtiva()) { _rel = existente; _relSeq = existente.linhas.reduce((m, l) => Math.max(m, l.seq || 0), 0) + 1; desenharRelatorios(); return; }
    const u = usuarioAtual();
    const doc = await raw().collection('lojas').doc(lojaAtiva()).collection('devolucoes_relatorios').add({
      lojaId: lojaAtiva(), status: 'RASCUNHO', criadoEm: new Date().toISOString(), criadoPorUid: u.uid, criadoPorEmail: u.email,
    });
    _rel = { relatorioId: doc.id, lojaId: lojaAtiva(), linhas: [] };
    _relSeq = 0;
    _relSalvarNoStorage();
    desenharRelatorios();
  }

  function _relChaveJaNaFila(chave) { return _rel.linhas.some(l => l.chave === chave); }

  function _relScan(chaveBruta) {
    const chave = String(chaveBruta || '').replace(/\D/g, '');
    if (chave.length !== 44) { global.showToast?.('Chave inválida — precisa ter 44 dígitos.', 'error'); return; }
    if (_relChaveJaNaFila(chave)) { global.showToast?.('Essa chave já está nesta fila de bipagem.', 'i'); return; }
    _rel.linhas.push({ chave, seq: _relSeq++, estado: 'queued' });
    _relSalvarNoStorage();
    desenharRelatorios();
    _relProcessarFila();
  }

  async function _relProcessarFila() {
    if (_relProcessando || !_rel) return;
    _relProcessando = true;
    try {
      let linha;
      while ((linha = _rel.linhas.filter(l => l.estado === 'queued').sort((a, b) => a.seq - b.seq)[0])) {
        linha.estado = 'consultando'; _relSalvarNoStorage(); desenharRelatorios();
        try {
          const { nota } = await call('consultarDevolucaoPorChave', { lojaId: _rel.lojaId, chave: linha.chave });
          if (!nota) { linha.estado = 'erro'; linha.erroMsg = 'Nota de devolução não encontrada no catálogo fiscal — atualize do BI e tente de novo.'; _relSalvarNoStorage(); desenharRelatorios(); continue; }
          linha.numeroNota = nota.numeroNota || ''; linha.destinatario = nota.destinatario || ''; linha.valorTotal = Number(nota.valorTotal) || 0;
          const r = await call('confirmarRecebimentoDevolucao', { lojaId: _rel.lojaId, chave: linha.chave, relatorioId: _rel.relatorioId, origem: 'ANALISTA' });
          if (r.jaRecebida) {
            linha.estado = 'ja_recebida';
            linha.origemAnterior = r.recebimento?.origem || '';
            linha.confirmadoEm = r.recebimento?.confirmadoEm || '';
            linha.confirmadoPor = r.recebimento?.confirmadoPor || '';
          } else {
            linha.estado = 'confirmada';
            linha.confirmadoEm = r.recebimento?.confirmadoEm || '';
            linha.confirmadoPor = r.recebimento?.confirmadoPor || '';
          }
        } catch (e) {
          linha.estado = 'erro'; linha.erroMsg = e.message || String(e);
        }
        _relSalvarNoStorage(); desenharRelatorios();
      }
    } finally { _relProcessando = false; }
  }

  function _relTentarDeNovo(chave) {
    const linha = _rel.linhas.find(l => l.chave === chave);
    if (!linha) return;
    linha.estado = 'queued'; linha.erroMsg = '';
    _relSalvarNoStorage(); desenharRelatorios();
    _relProcessarFila();
  }

  function _relPodeFinalizar() { return !!_rel && _rel.linhas.length > 0 && !_rel.linhas.some(l => l.estado === 'queued' || l.estado === 'consultando' || l.estado === 'erro'); }

  async function _relFinalizar() {
    if (!_relPodeFinalizar()) return;
    const u = usuarioAtual();
    const agora = new Date().toISOString();
    const colLinhas = raw().collection('lojas').doc(_rel.lojaId).collection('devolucoes_relatorios').doc(_rel.relatorioId).collection('linhas');
    for (let i = 0; i < _rel.linhas.length; i += 450) {
      const lote = _rel.linhas.slice(i, i + 450);
      const batch = raw().batch();
      lote.forEach(l => batch.set(colLinhas.doc(l.chave), {
        chave: l.chave, numeroNota: l.numeroNota || '', destinatario: l.destinatario || '', valorTotal: l.valorTotal || 0,
        estado: l.estado, origemAnterior: l.origemAnterior || null, confirmadoEm: l.confirmadoEm || '', confirmadoPor: l.confirmadoPor || '',
        relatorioStatus: 'FINALIZADO',
      }));
      await batch.commit();
    }
    await raw().collection('lojas').doc(_rel.lojaId).collection('devolucoes_relatorios').doc(_rel.relatorioId).update({
      status: 'FINALIZADO', finalizadoEm: agora, finalizadoPorUid: u.uid, finalizadoPorEmail: u.email,
    });
    global.showToast?.(`Relatório finalizado com ${_rel.linhas.length} nota(s).`, 'success');
    _rel = null; _relSalvarNoStorage();
    desenharRelatorios();
  }

  const REL_ESTADO_INFO = {
    queued: { label: '⏳ Na fila', cor: '#3a3a3a;color:#c9c9c9' },
    consultando: { label: '🔄 Consultando...', cor: '#1e3a5f;color:#9ec5ff' },
    confirmada: { label: '✓ Confirmada', cor: '#123a24;color:#8fdcb0' },
    ja_recebida: { label: '⚠ Já recebida', cor: '#4a3114;color:#ffd18a' },
    erro: { label: '✗ Erro', cor: '#4a1414;color:#ffb3b3' },
  };
  function _relLinhaHtml(l) {
    const info = REL_ESTADO_INFO[l.estado] || REL_ESTADO_INFO.queued;
    let detalhe = '';
    if (l.estado === 'ja_recebida') detalhe = `Já recebida por ${esc(l.origemAnterior || '—')} em ${l.confirmadoEm ? fmtDataBR(String(l.confirmadoEm).slice(0, 10)) : '—'}`;
    else if (l.estado === 'erro') detalhe = `<span style="color:#ffb3b3">${esc(l.erroMsg || 'Falha desconhecida')}</span> <button type="button" class="btn btn-ghost btn-sm" data-devol-rel-retry="${esc(l.chave)}">↻ Tentar de novo</button>`;
    return `<tr>
      <td class="mono" style="font-size:.68rem;max-width:180px;word-break:break-all">${esc(l.chave)}</td>
      <td>${esc(l.numeroNota || '—')}</td>
      <td>${esc(l.destinatario || '—')}</td>
      <td><span class="badge" style="background:${info.cor};font-size:.65rem">${info.label}</span></td>
      <td style="font-size:.74rem">${detalhe}</td>
    </tr>`;
  }

  function desenharRelatorios() {
    const alvo = document.getElementById('devol-conteudo');
    if (!alvo) return;
    if (!_rel) {
      alvo.innerHTML = `
        <div style="color:var(--muted);font-size:.78rem;margin-bottom:10px">Bipe a chave da própria nota de devolução pra confirmar que ela voltou fisicamente — sem duplicar com o que o Coletor já tiver confirmado.</div>
        ${tem('relatorio_criar') ? '<button type="button" class="btn btn-primary" data-devol-rel-iniciar="1">📋 Montar relatório</button>' : '<div class="empty"><div class="empty-title">Sem permissão pra montar relatório</div></div>'}`;
      return;
    }
    const podeFinalizar = _relPodeFinalizar();
    alvo.innerHTML = `
      <div class="tc" style="padding:14px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div><b>📋 Relatório em andamento</b><div style="font-size:.7rem;color:var(--muted);margin-top:2px">Bipe (ou digite) a chave de 44 dígitos e tecle Enter.</div></div>
          ${tem('relatorio_finalizar') ? `<button type="button" class="btn btn-primary btn-sm" data-devol-rel-finalizar="1" ${podeFinalizar ? '' : 'disabled'}>✅ Finalizar relatório</button>` : ''}
        </div>
        <input type="text" class="field" id="devol-rel-scan" placeholder="Chave de acesso (44 dígitos)" style="margin-top:10px;padding:9px;font-size:1rem" autofocus>
      </div>
      <div class="tc" style="padding:14px"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Chave</th><th>NF</th><th>Destinatário</th><th>Status</th><th>Detalhe</th></tr></thead>
        <tbody>${_rel.linhas.length ? [..._rel.linhas].sort((a, b) => a.seq - b.seq).map(_relLinhaHtml).join('') : '<tr><td colspan="5"><div class="empty"><div class="empty-title">Nenhuma chave bipada ainda</div></div></td></tr>'}</tbody>
      </table></div></div>`;
    document.getElementById('devol-rel-scan')?.focus();
  }

  // ───────────────────────── ABA INDICADORES ─────────────────────────
  const PALETA_MOTIVO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#e34948', '#008300'];
  function _corMotivo(mo) {
    let h = 0; const s = String(mo || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETA_MOTIVO[h % PALETA_MOTIVO.length];
  }
  const DIAS_MAX_PERIODO_IND = 731;
  let _indNotas = [];
  let _indPeriodoBuscado = '';
  let _indPeriodoInicio = '';
  let _indPeriodoFim = '';
  let _indFiltroMes = '';
  let _indFiltroMotivo = '';
  let _indFiltroRede = '';
  let _indFiltroEstado = '';
  let _indBusca = '';
  let _indPagina = 0;
  let _indCarregando = false;
  let _indErro = '';

  function _indPeriodoPadrao() {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - (DIAS_MAX_PERIODO_IND - 1) * 86400000);
    const d = x => x.toISOString().slice(0, 10);
    return { ini: d(inicio), fim: d(fim) };
  }
  function _indPeriodoValido(ini, fim) {
    if (!ini || !fim) return false;
    const dIni = new Date(ini + 'T00:00:00'), dFim = new Date(fim + 'T00:00:00');
    if (isNaN(dIni) || isNaN(dFim) || dIni > dFim) return false;
    return (dFim - dIni) / 86400000 <= DIAS_MAX_PERIODO_IND;
  }
  async function _indCarregar(forcar) {
    const chave = _indPeriodoInicio + '|' + _indPeriodoFim;
    if (_indPeriodoBuscado === chave && !forcar) return;
    const r = await call('listarDevolucoesBigQuery', { lojaId: lojaAtiva(), ini: _indPeriodoInicio, fim: _indPeriodoFim, campoData: 'emissao', limite: 5000 });
    _indNotas = r.notas || [];
    _indPeriodoBuscado = chave;
  }
  function _indRedeDe(n) { return extrairRede(n.destinatario); }
  function _indPassaPeriodo() { return true; } // já veio filtrado do servidor pelo período
  function _indMatch(n, excluir) {
    excluir = excluir || {};
    if (!excluir.mes && _indFiltroMes && mesAnoDe(n.dataEmissao) !== _indFiltroMes) return false;
    if (!excluir.motivo && _indFiltroMotivo && (n.motivoNormalizado || '—') !== _indFiltroMotivo) return false;
    if (!excluir.rede && _indFiltroRede && _indRedeDe(n) !== _indFiltroRede) return false;
    if (_indFiltroEstado && n.estado !== _indFiltroEstado) return false;
    if (_indBusca) {
      const q = _indBusca.trim().toUpperCase();
      if (q && String(n.destinatario || '').toUpperCase().indexOf(q) === -1 && _indRedeDe(n).toUpperCase().indexOf(q) === -1) return false;
    }
    return true;
  }
  function _indFiltradas() { return _indNotas.filter(n => _indMatch(n, {})); }
  function _indKpis(itens) {
    const totalDevolucoes = itens.length;
    const somaValor = itens.reduce((a, n) => a + (Number(n.valorTotal) || 0), 0);
    const redes = new Set(itens.map(n => _indRedeDe(n)).filter(Boolean));
    const mercados = new Set(itens.map(n => n.destinatario).filter(Boolean));
    const contagemMotivo = new Map();
    itens.forEach(n => { const m = n.motivoNormalizado || '—'; contagemMotivo.set(m, (contagemMotivo.get(m) || 0) + 1); });
    let motivoTop = '—', motivoTopQtd = 0;
    contagemMotivo.forEach((qtd, nome) => { if (qtd > motivoTopQtd) { motivoTopQtd = qtd; motivoTop = nome; } });
    const aguardandoRetorno = itens.filter(n => n.estado !== 'RECEBIDA').length;
    return { totalDevolucoes, somaValor, redesUnicas: redes.size, mercadosUnicos: mercados.size, motivoTop, aguardandoRetorno };
  }
  function _indResumoHtml(k) {
    return `<div style="display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:10px;margin:12px 0 4px">
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">DEVOLUÇÕES</div><div style="font-size:1.45rem;font-weight:850">${k.totalDevolucoes.toLocaleString('pt-BR')}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">VALOR TOTAL</div><div style="font-size:1.3rem;font-weight:850">${fmtBRL(k.somaValor)}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">REDES ÚNICAS</div><div style="font-size:1.45rem;font-weight:850">${k.redesUnicas.toLocaleString('pt-BR')}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">MERCADOS ÚNICOS</div><div style="font-size:1.45rem;font-weight:850">${k.mercadosUnicos.toLocaleString('pt-BR')}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">MOTIVO MAIS COMUM</div><div style="font-size:.95rem;font-weight:850">${esc(k.motivoTop)}</div></div>
      <div class="tc" style="padding:14px;${k.aguardandoRetorno ? 'border-color:#7a4a1f' : ''}"><div style="font-size:.72rem;color:var(--muted)">AGUARDANDO RETORNO FÍSICO</div><div style="font-size:1.45rem;font-weight:850;${k.aguardandoRetorno ? 'color:#ffd18a' : ''}">${k.aguardandoRetorno.toLocaleString('pt-BR')}</div></div>
    </div>`;
  }
  function _indAgrupar(itens, campoFn) {
    const m = new Map();
    itens.forEach(n => { const v = String(campoFn(n) || '').trim(); if (!v) return; m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].map(([label, value]) => ({ label, value }));
  }
  function _indBarChart(pares, opts) {
    opts = opts || {};
    const limit = opts.limit || 10;
    if (!pares.length) return '<div class="empty"><div class="empty-title">Sem dados para exibir</div></div>';
    const dados = (opts.cronologico ? pares : [...pares].sort((a, b) => b.value - a.value)).slice(0, limit);
    const max = Math.max(...dados.map(x => x.value), 1);
    const filtroAtivo = opts.filtroAtivo || '', filterKey = opts.filterKey || '';
    return `<div style="display:flex;flex-direction:column;gap:6px">${dados.map((x, idx) => {
      const selecionado = !!filtroAtivo && filtroAtivo === x.label;
      const dim = !!filtroAtivo && !selecionado;
      const clique = filterKey ? ` data-devind-filtro="${esc(filterKey)}" data-devind-valor="${esc(x.label)}" role="button" tabindex="0"` : '';
      const cor = filterKey === 'motivo' ? _corMotivo(x.label) : 'var(--orange)';
      return `<div${filterKey ? ' class="devind-barrow' + (selecionado ? ' sel' : '') + (dim ? ' dim' : '') + '"' : ''}${clique}>
        <div style="display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:2px"><span><em style="color:var(--muted)">${idx + 1}.</em> ${esc(x.label)}</span><b>${x.value.toLocaleString('pt-BR')}</b></div>
        <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.max(2, (x.value / max) * 100)}%;background:${cor}"></div></div>
      </div>`;
    }).join('')}</div>`;
  }
  function _indMesesDisponiveis() {
    const set = new Set();
    _indNotas.forEach(n => { if (_indMatch(n, { mes: true, motivo: true })) { const m = mesAnoDe(n.dataEmissao); if (m) set.add(m); } });
    return [...set].sort((a, b) => { const [ma, ya] = a.split('/').map(Number), [mb, yb] = b.split('/').map(Number); return (ya * 12 + ma) - (yb * 12 + mb); });
  }
  function _indMatrizHtml() {
    const meses = _indMesesDisponiveis();
    if (!meses.length) return '<div class="empty"><div class="empty-title">Sem dados para exibir</div></div>';
    const motivosBase = [...new Set(_indNotas.filter(n => _indMatch(n, { mes: true, motivo: true })).map(n => n.motivoNormalizado || '—'))];
    const motivoAtivo = !!_indFiltroMotivo;
    const motivos = motivoAtivo ? [_indFiltroMotivo] : motivosBase;
    const grid = new Map();
    meses.forEach(m => grid.set(m, new Map()));
    _indNotas.forEach(n => {
      if (!_indMatch(n, { mes: true, motivo: true })) return;
      const m = mesAnoDe(n.dataEmissao);
      if (!grid.has(m)) return;
      const mo = n.motivoNormalizado || '—';
      const cel = grid.get(m).get(mo) || { qtd: 0, valor: 0 };
      cel.qtd++; cel.valor += Number(n.valorTotal) || 0;
      grid.get(m).set(mo, cel);
    });
    const celTxt = c => c ? `${c.qtd.toLocaleString('pt-BR')}<br><small style="color:var(--muted);font-weight:400">${fmtBRL(c.valor)}</small>` : '<span style="color:var(--muted)">—</span>';
    const somaCels = arr => arr.reduce((a, c) => c ? { qtd: a.qtd + c.qtd, valor: a.valor + c.valor } : a, { qtd: 0, valor: 0 });
    const totalPorMotivo = new Map(motivos.map(mo => [mo, somaCels(meses.map(m => grid.get(m).get(mo)))]));
    const totalGeral = somaCels([...totalPorMotivo.values()]);
    const header = `<th style="padding:6px 10px;text-align:left">Mês</th>${motivos.map(mo => `<th class="devind-mtx-cell" data-devind-filtro="motivo" data-devind-valor="${esc(mo)}" role="button" tabindex="0" style="padding:6px 10px;text-align:center;cursor:pointer;${motivoAtivo ? 'background:var(--surface-2)' : ''}"><span class="dot" style="background:${_corMotivo(mo)};display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px"></span>${esc(mo)}</th>`).join('')}<th style="padding:6px 10px;text-align:center">Total</th>`;
    const linhas = meses.map(m => {
      const mesSelecionado = _indFiltroMes === m;
      const cel = grid.get(m);
      const totalMes = somaCels(motivos.map(mo => cel.get(mo)));
      const tds = motivos.map(mo => { const c = cel.get(mo); return `<td class="devind-mtx-cell" data-devind-mes="${esc(m)}" data-devind-motivo="${esc(mo)}" role="button" tabindex="0" style="padding:6px 10px;text-align:center;cursor:pointer">${celTxt(c)}</td>`; }).join('');
      return `<tr style="border-top:1px solid var(--surface-2)">
        <td class="devind-mtx-cell" data-devind-mes-total="${esc(m)}" role="button" tabindex="0" style="padding:6px 10px;cursor:pointer;font-weight:${mesSelecionado ? 800 : 600}">${esc(m)}</td>
        ${tds}<td style="padding:6px 10px;text-align:center;font-weight:700">${celTxt(totalMes)}</td>
      </tr>`;
    }).join('');
    const linhaTotal = `<tr style="border-top:2px solid var(--surface-2);font-weight:700"><td style="padding:6px 10px">Total</td>${motivos.map(mo => `<td style="padding:6px 10px;text-align:center">${celTxt(totalPorMotivo.get(mo))}</td>`).join('')}<td style="padding:6px 10px;text-align:center">${celTxt(totalGeral)}</td></tr>`;
    return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.76rem"><thead><tr style="border-bottom:1px solid var(--surface-2)">${header}</tr></thead><tbody>${linhas}${linhaTotal}</tbody></table></div>`;
  }
  const IND_PAGE_SIZE = 50;
  function _indTabelaHtml() {
    const itens = [..._indFiltradas()].sort((a, b) => (b.dataEmissao || '').localeCompare(a.dataEmissao || ''));
    const total = itens.length;
    const totalPaginas = Math.max(1, Math.ceil(total / IND_PAGE_SIZE));
    if (_indPagina >= totalPaginas) _indPagina = totalPaginas - 1;
    if (_indPagina < 0) _indPagina = 0;
    const slice = itens.slice(_indPagina * IND_PAGE_SIZE, _indPagina * IND_PAGE_SIZE + IND_PAGE_SIZE);
    const linhas = slice.map(n => `<tr>
        <td style="padding:6px 8px">${esc(n.destinatario || '—')}</td>
        <td style="padding:6px 8px">${esc(_indRedeDe(n) || '—')}</td>
        <td style="padding:6px 8px">${esc(n.numeroNota || '—')}</td>
        <td style="padding:6px 8px">${fmtDataBR(n.dataEmissao)}</td>
        <td style="padding:6px 8px;text-align:right;white-space:nowrap">${fmtBRL(n.valorTotal)}</td>
        <td style="padding:6px 8px"><span class="devind-tag"><span class="dot" style="background:${_corMotivo(n.motivoNormalizado)}"></span>${esc(n.motivoNormalizado || '—')}</span></td>
        <td style="padding:6px 8px">${n.estado === 'RECEBIDA' ? '<span class="badge" style="background:#123a24;color:#8fdcb0;font-size:.65rem">✓ Recebida</span>' : '<span class="badge" style="background:#4a3114;color:#ffd18a;font-size:.65rem">Aguardando retorno</span>'}</td>
      </tr>`).join('');
    const de = total === 0 ? 0 : _indPagina * IND_PAGE_SIZE + 1, ate = Math.min(total, _indPagina * IND_PAGE_SIZE + IND_PAGE_SIZE);
    return `<div class="tc" style="padding:16px;margin-top:14px">
      <div class="tc-title">🧾 Notas de devolução (${total.toLocaleString('pt-BR')})</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead><tr style="text-align:left;border-bottom:1px solid var(--surface-2)"><th style="padding:6px 8px">Loja</th><th style="padding:6px 8px">Rede</th><th style="padding:6px 8px">NF</th><th style="padding:6px 8px">Emissão</th><th style="padding:6px 8px;text-align:right">Valor</th><th style="padding:6px 8px">Motivo</th><th style="padding:6px 8px">Estado</th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="7" style="padding:10px;color:var(--muted)">Nenhuma nota para os filtros aplicados.</td></tr>'}</tbody>
      </table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:.74rem;color:var(--muted)">
        <span>Mostrando ${de}–${ate} de ${total}</span>
        <span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-devind-pagina="-1" ${_indPagina <= 0 ? 'disabled' : ''}>‹ Anterior</button><button class="btn btn-ghost btn-sm" data-devind-pagina="1" ${_indPagina >= totalPaginas - 1 ? 'disabled' : ''}>Próxima ›</button></span>
      </div>
    </div>`;
  }
  function _indEstilosHtml() {
    return `<style>
      .devind-mtx-cell{transition:background .12s} .devind-mtx-cell:hover{background:var(--surface-2)}
      .devind-barrow{cursor:pointer;border-radius:6px;padding:3px;transition:opacity .12s,background .12s}
      .devind-barrow:hover{background:var(--surface-2)} .devind-barrow.dim{opacity:.4} .devind-barrow.sel{background:var(--surface-2)}
      .devind-tag{display:inline-flex;align-items:center;gap:5px;font-size:.68rem;white-space:nowrap} .devind-tag .dot{width:7px;height:7px;border-radius:2px;flex:none}
    </style>`;
  }
  function desenharIndicadores() {
    const alvo = document.getElementById('devol-conteudo');
    if (!alvo) return;
    if (!_indPeriodoInicio || !_indPeriodoFim) { const p = _indPeriodoPadrao(); _indPeriodoInicio = _indPeriodoInicio || p.ini; _indPeriodoFim = _indPeriodoFim || p.fim; }
    const itens = _indFiltradas();
    const k = _indKpis(itens);
    const porMotivo = _indAgrupar(_indNotas.filter(n => _indMatch(n, { motivo: true })), n => n.motivoNormalizado);
    const porMes = _indAgrupar(_indNotas.filter(n => _indMatch(n, { mes: true })), n => mesAnoDe(n.dataEmissao)).sort((a, b) => { const [ma, ya] = a.label.split('/').map(Number), [mb, yb] = b.label.split('/').map(Number); return (ya * 12 + ma) - (yb * 12 + mb); });
    const porRede = _indAgrupar(_indNotas.filter(n => _indMatch(n, { rede: true })), n => _indRedeDe(n));
    const porMercado = _indAgrupar(itens, n => n.destinatario);
    const temFiltro = !!(_indFiltroMes || _indFiltroMotivo || _indFiltroRede || _indFiltroEstado || _indBusca);
    alvo.innerHTML = `${_indEstilosHtml()}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="color:var(--muted);font-size:.78rem">Clique em qualquer coluna, barra ou segmento pra filtrar; período filtra pela data de emissão real da nota.</div>
        <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap">
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">EMISSÃO — DE</div><input type="date" class="field" id="devind-periodo-ini" value="${esc(_indPeriodoInicio)}" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input type="date" class="field" id="devind-periodo-fim" value="${esc(_indPeriodoFim)}" style="padding:7px"></div>
          <button class="btn btn-primary btn-sm" data-devind-buscar-periodo="1" style="padding:7px 14px">🔍 Buscar</button>
          <div style="font-size:.64rem;color:var(--muted);align-self:center">Máx. 2 anos</div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ESTADO</div><select class="field" id="devind-filtro-estado" style="padding:7px">
            <option value="" ${_indFiltroEstado === '' ? 'selected' : ''}>Todas</option><option value="PENDENTE" ${_indFiltroEstado === 'PENDENTE' ? 'selected' : ''}>Aguardando retorno</option><option value="RECEBIDA" ${_indFiltroEstado === 'RECEBIDA' ? 'selected' : ''}>Já retornou</option>
          </select></div>
          <button class="btn btn-ghost" data-devind-atualizar="1">↻ Atualizar</button>
        </div>
      </div>
      ${_indCarregando ? '<div style="font-size:.76rem;color:var(--muted);padding:6px 0">⏳ Atualizando...</div>' : ''}
      ${_indErro ? `<div style="font-size:.76rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin:8px 0">⚠️ Não foi possível atualizar: ${esc(_indErro)}</div>` : ''}
      ${!_indPeriodoBuscado ? '<div class="empty" style="margin-top:14px"><div class="empty-icon">🔍</div><div class="empty-title">Escolha o período e clique em Buscar</div></div>' : `
      ${_indResumoHtml(k)}
      <div class="tc" style="padding:16px;margin-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div class="tc-title" style="margin:0">🔥 Motivo por mês</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="search" class="field" id="devind-busca" placeholder="Buscar loja ou rede…" value="${esc(_indBusca)}" style="padding:6px 8px;font-size:.78rem;min-width:200px">
            ${temFiltro ? '<button class="btn btn-ghost btn-sm" data-devind-limpar-filtros="1">✕ limpar filtros</button>' : ''}
          </div>
        </div>
        ${_indMatrizHtml()}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-top:10px">
        <div class="tc" style="padding:16px"><div class="tc-title">↩️ Motivo da devolução</div>${_indBarChart(porMotivo, { limit: 10, filterKey: 'motivo', filtroAtivo: _indFiltroMotivo })}</div>
        <div class="tc" style="padding:16px"><div class="tc-title">📅 Devoluções por mês</div>${_indBarChart(porMes, { cronologico: true, limit: 24, filterKey: 'mes', filtroAtivo: _indFiltroMes })}</div>
        <div class="tc" style="padding:16px"><div class="tc-title">🏬 Top redes/bandeiras</div>${_indBarChart(porRede, { limit: 10, filterKey: 'rede', filtroAtivo: _indFiltroRede })}</div>
        <div class="tc" style="padding:16px"><div class="tc-title">🏪 Top mercados/lojas</div>${_indBarChart(porMercado, { limit: 10 })}</div>
      </div>
      ${_indTabelaHtml()}`}`;
  }
  async function _indAtualizarDados(forcar) {
    if (!_indPeriodoValido(_indPeriodoInicio, _indPeriodoFim)) { global.showToast?.('Escolha um período válido de até 2 anos.', 'error'); return; }
    _indCarregando = true; _indErro = ''; desenharIndicadores();
    try { await _indCarregar(forcar); } catch (e) { _indErro = e.message || String(e); }
    _indCarregando = false; desenharIndicadores();
  }

  // ───────────────────────── SHELL / ABAS ─────────────────────────
  function _tabBtn(id, label) {
    const ativo = _aba === id;
    return `<button type="button" class="btn ${ativo ? 'btn-primary' : 'btn-ghost'} btn-sm" data-devol-aba="${id}" style="border-radius:8px 8px 0 0">${label}</button>`;
  }
  function _desenharAbaAtiva() {
    if (_aba === 'controle') desenharControle();
    else if (_aba === 'relatorios') desenharRelatorios();
    else desenharIndicadores();
  }
  function desenharShell() {
    const pagina = document.getElementById(_containerId);
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h2 style="margin:0">📥 Devoluções</h2></div>
      <div style="display:flex;gap:6px;margin:12px 0 0;border-bottom:1px solid var(--surface-2)">
        ${_tabBtn('controle', '🔍 Controle')}${_tabBtn('relatorios', '📋 Relatórios')}${_tabBtn('indicadores', '📊 Indicadores')}
      </div>
      <div id="devol-conteudo" style="padding-top:12px"></div>`;
    _desenharAbaAtiva();
    global.aplicarPermissoesAnalista?.();
  }

  async function renderRecebimentoDevolucoes(containerId) {
    _containerId = containerId || 'page-recebimento-devolucoes';
    if (!_rel) { const existente = _relCarregarDoStorage(); if (existente && existente.lojaId === lojaAtiva()) { _rel = existente; _relSeq = existente.linhas.reduce((m, l) => Math.max(m, l.seq || 0), 0) + 1; } }
    desenharShell();
  }

  document.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-devol-aba]');
    if (tabBtn) { _aba = tabBtn.getAttribute('data-devol-aba'); desenharShell(); return; }
    if (e.target.closest('[data-devol-consultar]')) { _ctrlBuscar(); return; }
    if (e.target.closest('[data-devol-atualizar-bi]')) { _ctrlAtualizarBi(); return; }
    if (e.target.closest('[data-devol-rel-iniciar]')) { _relIniciar(); return; }
    if (e.target.closest('[data-devol-rel-finalizar]')) { _relFinalizar(); return; }
    const retry = e.target.closest('[data-devol-rel-retry]');
    if (retry) { _relTentarDeNovo(retry.getAttribute('data-devol-rel-retry')); return; }

    if (e.target.closest('[data-devind-buscar-periodo]')) { _indAtualizarDados(true); return; }
    if (e.target.closest('[data-devind-atualizar]')) { if (_indPeriodoBuscado) _indAtualizarDados(true); return; }
    if (e.target.closest('[data-devind-limpar-filtros]')) { _indFiltroMes = ''; _indFiltroMotivo = ''; _indFiltroRede = ''; _indFiltroEstado = ''; _indBusca = ''; _indPagina = 0; desenharIndicadores(); return; }
    const mesTotal = e.target.closest('[data-devind-mes-total]');
    if (mesTotal) { const m = mesTotal.getAttribute('data-devind-mes-total'); _indFiltroMes = (_indFiltroMes === m) ? '' : m; _indPagina = 0; desenharIndicadores(); return; }
    const seg = e.target.closest('.devind-mtx-cell[data-devind-mes]');
    if (seg) { const m = seg.getAttribute('data-devind-mes'), mo = seg.getAttribute('data-devind-motivo'); if (_indFiltroMes === m && _indFiltroMotivo === mo) { _indFiltroMes = ''; _indFiltroMotivo = ''; } else { _indFiltroMes = m; _indFiltroMotivo = mo; } _indPagina = 0; desenharIndicadores(); return; }
    const barra = e.target.closest('[data-devind-filtro]');
    if (barra) { const chave = barra.getAttribute('data-devind-filtro'), valor = barra.getAttribute('data-devind-valor'); if (chave === 'motivo') _indFiltroMotivo = (_indFiltroMotivo === valor) ? '' : valor; else if (chave === 'rede') _indFiltroRede = (_indFiltroRede === valor) ? '' : valor; else if (chave === 'mes') _indFiltroMes = (_indFiltroMes === valor) ? '' : valor; _indPagina = 0; desenharIndicadores(); return; }
    if (e.target.closest('[data-devind-pagina="-1"]')) { _indPagina = Math.max(0, _indPagina - 1); desenharIndicadores(); return; }
    if (e.target.closest('[data-devind-pagina="1"]')) { _indPagina++; desenharIndicadores(); return; }
  });
  document.addEventListener('keydown', e => {
    if (e.target && e.target.id === 'devol-rel-scan' && e.key === 'Enter') {
      e.preventDefault();
      const valor = e.target.value; e.target.value = '';
      _relScan(valor);
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const alvo = e.target.closest('[data-devind-mes-total],.devind-mtx-cell,[data-devind-filtro]');
    if (alvo) { e.preventDefault(); alvo.click(); }
  });
  document.addEventListener('change', e => {
    if (e.target && (e.target.id === 'devol-f-estado' || e.target.id === 'devol-f-motivo' || e.target.id === 'devol-f-numero' || e.target.id === 'devol-f-chave' || e.target.id === 'devol-f-mercado' || e.target.id === 'devol-f-campo-data' || e.target.id === 'devol-f-ini' || e.target.id === 'devol-f-fim')) {
      _ctrlFiltros = {
        estado: document.getElementById('devol-f-estado')?.value || '',
        motivo: document.getElementById('devol-f-motivo')?.value || '',
        numeroNota: document.getElementById('devol-f-numero')?.value || '',
        chave: document.getElementById('devol-f-chave')?.value || '',
        mercado: document.getElementById('devol-f-mercado')?.value || '',
        campoData: document.getElementById('devol-f-campo-data')?.value || 'emissao',
        ini: document.getElementById('devol-f-ini')?.value || '',
        fim: document.getElementById('devol-f-fim')?.value || '',
      };
      return;
    }
    if (e.target && (e.target.id === 'devind-periodo-ini' || e.target.id === 'devind-periodo-fim')) {
      _indPeriodoInicio = document.getElementById('devind-periodo-ini')?.value || '';
      _indPeriodoFim = document.getElementById('devind-periodo-fim')?.value || '';
      if (_indPeriodoInicio && _indPeriodoFim && !_indPeriodoValido(_indPeriodoInicio, _indPeriodoFim)) {
        if (e.target.id === 'devind-periodo-ini') _indPeriodoFim = new Date(new Date(_indPeriodoInicio + 'T00:00:00').getTime() + DIAS_MAX_PERIODO_IND * 86400000).toISOString().slice(0, 10);
        else _indPeriodoInicio = new Date(new Date(_indPeriodoFim + 'T00:00:00').getTime() - DIAS_MAX_PERIODO_IND * 86400000).toISOString().slice(0, 10);
        global.showToast?.('Período ajustado — máximo de 2 anos.', 'i');
      }
      _indPagina = 0; desenharIndicadores();
      return;
    }
    if (e.target && e.target.id === 'devind-filtro-estado') { _indFiltroEstado = e.target.value || ''; _indPagina = 0; desenharIndicadores(); }
  });
  document.addEventListener('input', e => { if (e.target && e.target.id === 'devind-busca') { _indBusca = e.target.value || ''; _indPagina = 0; desenharIndicadores(); } });

  global.renderRecebimentoDevolucoes = renderRecebimentoDevolucoes;
  global._DTDevolucoesInternals = {
    _ctrlBuscar, _ctrlAtualizarBi, getCtrlNotas: () => _ctrlNotas, getCtrlFiltros: () => _ctrlFiltros,
    _relIniciar, _relScan, _relProcessarFila, _relTentarDeNovo, _relFinalizar, _relPodeFinalizar, getRel: () => _rel, resetRel: () => { _rel = null; _relSalvarNoStorage(); },
    _indKpis, _indAgrupar, mesAnoDe, _indCarregar, getIndNotas: () => _indNotas, _corMotivo,
    setAba: (a) => { _aba = a; },
  };
})(window);
