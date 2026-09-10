// ═══════════════════════════════════════════════════
//  RECEBIMENTO — Transferência de Paletes entre lojas (Nova Movimentação)
//  Movimento simples: mover paletes VAZIOS de uma loja pra outra, sem
//  produto/NF (isso é Transbordo, 26-recebimento-cargas.js). Coleção
//  própria `recebimento_transferencias_paletes`, vive na loja de ORIGEM
//  (igual `recebimentos`/TRANSBORDO) — a loja de DESTINO cruza via o MESMO
//  mecanismo de rotas do Transbordo (ROTAS_CACHE/_origensParaCruzar,
//  22-recebimento.js), já que ambas usam o mesmo grafo de parceiros.
//
//  Retorno parcial (quantidadeRecebida < quantidade enviada): o que não
//  chegar continua contando como "em trânsito" na origem pra sempre — MESMO
//  padrão já aceito em confirmarRetornoPaletes() (25-recebimento-paletes.js)
//  pro palete de mercado externo. Nenhuma regra nova inventada aqui.
//
//  IMPORTANTE (lição ao vivo real desta sessão): NUNCA usar `?.`/`??` neste
//  arquivo — coletores industriais antigos travam com SyntaxError nessa
//  sintaxe. Sempre `x && x.y` / ternário.
// ═══════════════════════════════════════════════════

const COL_TRANSFERENCIAS = 'recebimento_transferencias_paletes';
let TRANSFERENCIAS_PENDENTES_CACHE = []; // pendentes de RECEBIMENTO nesta loja (cross-loja)
let _transferenciaConfirmarAtual = null; // {_id, _origemLojaId, ...} selecionada pra confirmar recebimento

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('dt-loja-alterada', function () {
    TRANSFERENCIAS_PENDENTES_CACHE = [];
  });
}

function abrirTransferenciaMenu() {
  goScreen('transferencia-menu');
}

// ── Enviar (origem) ──────────────────────────────────────────────────────
async function abrirTransferenciaPaletes() {
  const qtd = document.getElementById('transferencia-quantidade'); if (qtd) qtd.value = '';
  const obs = document.getElementById('transferencia-observacao'); if (obs) obs.value = '';
  const status = document.getElementById('transferencia-status'); if (status) status.textContent = '';
  const sel = document.getElementById('transferencia-destino');
  if (sel) sel.innerHTML = '<option value="">Carregando destinos...</option>';
  goScreen('transferencia-paletes');
  let destinos = _destinosPossiveis();
  if (!destinos.length && navigator.onLine) {
    try { destinos = await _destinosPossiveisAoVivo(); } catch (e) { console.warn('[Transferencia] Falha ao buscar destinos:', e && e.message ? e.message : e); }
  }
  if (sel) {
    sel.innerHTML = '<option value="">— Selecionar —</option>' + destinos.map(function (d) {
      return '<option value="' + _escRec(d.id) + '">' + _escRec(d.nome) + '</option>';
    }).join('');
  }
}

async function confirmarTransferenciaPaletes() {
  const status = document.getElementById('transferencia-status');
  const elDestino = document.getElementById('transferencia-destino');
  const elQtd = document.getElementById('transferencia-quantidade');
  const elObs = document.getElementById('transferencia-observacao');
  const destinoLojaId = elDestino ? elDestino.value : '';
  const quantidade = Number(elQtd ? elQtd.value : '');
  const observacao = (elObs ? elObs.value : '').trim();
  if (!destinoLojaId) { if (status) status.textContent = 'Selecione o destino.'; return; }
  if (!Number.isFinite(quantidade) || quantidade <= 0) { if (status) status.textContent = 'Informe uma quantidade válida de paletes.'; return; }
  const destinos = _destinosPossiveis().concat(await _destinosPossiveisAoVivo().catch(function () { return []; }));
  const destino = destinos.find(function (d) { return d.id === destinoLojaId; });
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const lojaId = _lojaAtivaRec();
  const nomeOrigem = await _obterNomeLojaAtiva();
  const payload = {
    origemLojaId: lojaId,
    origemNome: nomeOrigem,
    destinoLojaId: destinoLojaId,
    destinoNome: (destino && destino.nome) || destinoLojaId,
    quantidade: Math.round(quantidade),
    observacao: observacao,
    status: 'EM_TRANSITO',
    horaSaida: agora,
    horaRecebimento: null,
    quantidadeRecebida: null,
    criadoEm: agora, criadoPor: autor, atualizadoEm: agora, atualizadoPor: autor
  };
  if (status) status.textContent = 'Salvando...';
  try {
    const ref = await FS.collection(COL_TRANSFERENCIAS).add(payload);
    try {
      await _aplicarMovimentoLedger(lojaId, 'TRANSFERENCIA_EXPEDICAO',
        { disponivelDelta: -Math.round(quantidade), emTransitoDelta: Math.round(quantidade) },
        { colecao: COL_TRANSFERENCIAS, id: ref.id });
    } catch (eLedger) {
      console.warn('[Transferencia] Falha ao atualizar ledger na saída:', eLedger && eLedger.message ? eLedger.message : eLedger);
    }
    toast('Transferência registrada!', 's');
    goScreen('transferencia-menu');
  } catch (e) {
    if (status) status.textContent = 'Erro ao salvar: ' + (e && e.message ? e.message : e);
  }
}

// ── Confirmar recebimento (destino, cross-loja) ─────────────────────────
async function abrirConfirmarRecebimentoTransferencia() {
  goScreen('transferencia-confirmar-lista');
  await carregarTransferenciasPendentes();
}

let _transferenciasCarregamentoEmAndamento = null;
function carregarTransferenciasPendentes() {
  if (_transferenciasCarregamentoEmAndamento) return _transferenciasCarregamentoEmAndamento;
  _transferenciasCarregamentoEmAndamento = _carregarTransferenciasPendentesImpl().finally(function () {
    _transferenciasCarregamentoEmAndamento = null;
  });
  return _transferenciasCarregamentoEmAndamento;
}
async function _carregarTransferenciasPendentesImpl() {
  const lista = document.getElementById('transferencia-confirmar-lista-itens');
  if (lista) lista.innerHTML = '<div style="text-align:center;padding:20px;color:#5a7a9a">Carregando...</div>';
  const minhaLoja = _lojaAtivaRec();
  let origens = _origensParaCruzar();
  if (!origens.length && navigator.onLine) {
    // _destinosPossiveisAoVivo() só busca rotas ONDE EU SOU ORIGEM (filtra
    // por origemLojaId) — não serve aqui, onde preciso do sentido contrário
    // (rotas onde EU SOU DESTINO). Consulta própria, sem mexer em
    // ROTAS_CACHE (arquivo isolado, mesmo espírito de nunca compartilhar
    // estado mutável direto entre arquivos — só o padrão é reaproveitado).
    try {
      const snap = await FS.collection('recebimento_rotas_transbordo').get();
      origens = snap.docs.map(function (d) { return Object.assign({ _id: d.id }, d.data()); })
        .filter(function (r) { return r.destinoLojaId === minhaLoja; })
        .map(function (r) { return { id: r.origemLojaId, nome: r.origemNome || r.origemLojaId }; });
    } catch (e) { console.warn('[Transferencia] Falha ao buscar rotas ao vivo:', e && e.message ? e.message : e); }
  }
  const resultados = await Promise.all(origens.map(async function (p) {
    try {
      const snap = await getDTRawFirestore().collection('lojas').doc(p.id).collection(COL_TRANSFERENCIAS).where('destinoLojaId', '==', minhaLoja).get();
      return snap.docs.map(function (d) {
        const dados = d.data() || {};
        return Object.assign({ _id: d.id, _origemLojaId: p.id }, dados);
      }).filter(function (t) { return t.status === 'EM_TRANSITO'; });
    } catch (e) {
      console.warn('[Transferencia] Falha ao buscar pendentes da loja ' + p.id + ':', e && e.message ? e.message : e);
      return [];
    }
  }));
  TRANSFERENCIAS_PENDENTES_CACHE = [].concat.apply([], resultados);
  _desenharListaTransferenciasPendentes();
}

function _desenharListaTransferenciasPendentes() {
  const lista = document.getElementById('transferencia-confirmar-lista-itens');
  if (!lista) return;
  if (!TRANSFERENCIAS_PENDENTES_CACHE.length) {
    lista.innerHTML = '<div style="text-align:center;padding:16px;color:#5a7a9a;font-size:.85rem">Nenhuma transferência pendente de recebimento.</div>';
    return;
  }
  lista.innerHTML = TRANSFERENCIAS_PENDENTES_CACHE.map(function (t) {
    return '<div class="inv-card" data-transferencia-id="' + _escRec(t._id) + '" data-transferencia-origem="' + _escRec(t._origemLojaId) + '">'
      + '<div class="inv-card-code">' + _escRec(t.origemNome || '—') + ' → ' + _escRec(t.destinoNome || '—') + '</div>'
      + '<div class="inv-card-meta"><span class="badge badge-info">' + _escRec(t.quantidade || 0) + ' palete(s)</span></div>'
      + '</div>';
  }).join('');
  Array.prototype.forEach.call(lista.querySelectorAll('[data-transferencia-id]'), function (card) {
    card.addEventListener('click', function () {
      abrirConfirmarRecebimentoDetalhe(card.getAttribute('data-transferencia-id'), card.getAttribute('data-transferencia-origem'));
    });
  });
}

function abrirConfirmarRecebimentoDetalhe(id, origemLojaId) {
  const t = TRANSFERENCIAS_PENDENTES_CACHE.find(function (x) { return x._id === id; });
  if (!t) { toast('Transferência não encontrada.', 'e'); return; }
  _transferenciaConfirmarAtual = t;
  const resumo = document.getElementById('transferencia-confirmar-resumo');
  if (resumo) resumo.textContent = (t.origemNome || '—') + ' → ' + (t.destinoNome || '—') + ' · enviado: ' + (t.quantidade || 0) + ' palete(s)';
  const qtd = document.getElementById('transferencia-confirmar-quantidade'); if (qtd) qtd.value = t.quantidade != null ? t.quantidade : '';
  const status = document.getElementById('transferencia-confirmar-status'); if (status) status.textContent = '';
  goScreen('transferencia-confirmar-detalhe');
}

async function confirmarRecebimentoTransferencia() {
  const status = document.getElementById('transferencia-confirmar-status');
  const t = _transferenciaConfirmarAtual;
  if (!t) { if (status) status.textContent = 'Transferência não encontrada — volte e tente de novo.'; return; }
  const elQtd = document.getElementById('transferencia-confirmar-quantidade');
  const quantidadeRecebida = Number(elQtd ? elQtd.value : '');
  if (!Number.isFinite(quantidadeRecebida) || quantidadeRecebida < 0) { if (status) status.textContent = 'Informe uma quantidade válida de paletes.'; return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { if (status) status.textContent = 'Sem conexão — confirmar recebimento exige internet.'; return; }
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const payload = {
    status: 'FINALIZADO',
    quantidadeRecebida: Math.round(quantidadeRecebida),
    horaRecebimento: agora,
    atualizadoEm: agora, atualizadoPor: autor
  };
  if (status) status.textContent = 'Salvando...';
  try {
    await getDTRawFirestore().collection('lojas').doc(t._origemLojaId).collection(COL_TRANSFERENCIAS).doc(t._id).update(payload);
    TRANSFERENCIAS_PENDENTES_CACHE = TRANSFERENCIAS_PENDENTES_CACHE.filter(function (x) { return x._id !== t._id; });
    // Recebido de verdade: debita emTransito na ORIGEM (cross-loja — mesma
    // sessão do destino escrevendo lá, ver hasPermissionPaletesNaLoja em
    // firestore.rules) e credita disponível no DESTINO (própria loja).
    // Delta usa o que REALMENTE chegou (quantidadeRecebida), não o que
    // saiu — o que não chegar fica contando como "em trânsito" pra sempre
    // na origem, mesmo padrão já aceito em confirmarRetornoPaletes().
    try {
      const destinoLojaId = t.destinoLojaId || _lojaAtivaRec();
      const referencia = { colecao: COL_TRANSFERENCIAS, id: t._id };
      await Promise.all([
        _aplicarMovimentoLedger(t._origemLojaId, 'TRANSFERENCIA_RECEBIMENTO', { emTransitoDelta: -Math.round(quantidadeRecebida) }, referencia),
        _aplicarMovimentoLedger(destinoLojaId, 'TRANSFERENCIA_RECEBIMENTO', { disponivelDelta: Math.round(quantidadeRecebida) }, referencia)
      ]);
    } catch (eLedger) {
      console.warn('[Transferencia] Falha ao atualizar ledger no recebimento:', eLedger && eLedger.message ? eLedger.message : eLedger);
    }
    toast('Recebimento de paletes confirmado!', 's');
    _transferenciaConfirmarAtual = null;
    goScreen('transferencia-confirmar-lista');
    _desenharListaTransferenciasPendentes();
  } catch (e) {
    if (status) status.textContent = 'Erro ao salvar: ' + (e && e.message ? e.message : e);
  }
}

window.abrirTransferenciaMenu = abrirTransferenciaMenu;
window.abrirTransferenciaPaletes = abrirTransferenciaPaletes;
window.confirmarTransferenciaPaletes = confirmarTransferenciaPaletes;
window.abrirConfirmarRecebimentoTransferencia = abrirConfirmarRecebimentoTransferencia;
window.carregarTransferenciasPendentes = carregarTransferenciasPendentes;
window.abrirConfirmarRecebimentoDetalhe = abrirConfirmarRecebimentoDetalhe;
window.confirmarRecebimentoTransferencia = confirmarRecebimentoTransferencia;
window._transferenciaPaletesInternals = {
  getPendentes: function () { return TRANSFERENCIAS_PENDENTES_CACHE; },
  getAtual: function () { return _transferenciaConfirmarAtual; }
};
