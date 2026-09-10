// ═══════════════════════════════════════════════════
//  RECEBIMENTO — Paletes (saída/entrada com mercados externos)
//  Coleção PRÓPRIA `recebimento_paletes` (por loja) — de propósito NÃO
//  reaproveita `recebimentos`/tipo:'TRANSBORDO' (aquela regra do Firestore
//  já é complexa o bastante, com histórico real de estourar o limite de
//  1000 sub-expressões do motor de regras). Sem cross-loja (aqui não existe
//  "loja de destino" — o destino é sempre um mercado externo, texto livre,
//  digitado a cada viagem), sem NF, sem rotas pré-cadastradas.
//  PEDIDO AO VIVO (2026-09-04): "os motorista que vai aparecer lá são os
//  mesmo motoristas da parte de notas retornadas" — reaproveita o MESMO
//  cadastro de motoristas de Notas Retornadas (recebimento_recusas_
//  motoristas — nome da coleção INLINE de propósito, nunca uma const
//  compartilhada: um `const` de mesmo nome em dois arquivos carregados
//  como <script> separados colide de verdade no navegador — SyntaxError
//  "already been declared" — mesmo funcionando "por acaso" se alguém
//  tentasse reaproveitar o identificador), com cache/estado PRÓPRIO desta
//  tela. Diferente do cadastro global de motoristas do Transbordo
//  (recebimento_motoristas) — este é POR LOJA (via FS, o proxy loja-
//  scoped), igual o resto de Notas Retornadas. Reaproveita _escRec()/
//  _lojaAtivaRec() (funções,
//  não const — essas sim já são utilitários compartilhados do domínio
//  Recebimento, definidos em 22-recebimento.js e carregados antes deste
//  arquivo em coletor.html).
//  IMPORTANTE (lição ao vivo real desta mesma sessão): NUNCA usar `?.`/`??`
//  neste arquivo — coletores industriais antigos (Datalogic Memor K,
//  WebView Chromium 66/2018) travam com SyntaxError nessa sintaxe e
//  derrubam a tela inteira. Sempre `x && x.y` / ternário em vez disso.
// ═══════════════════════════════════════════════════

const COL_PALETES = 'recebimento_paletes';
const COL_PALETES_MOTORISTAS = 'recebimento_recusas_motoristas';
let PALETES_CACHE = [];
let PALETES_MOTORISTAS_CACHE = [];
let _paletesCarregado = false;
let _paletesRetornoId = null; // viagem selecionada pra registrar retorno

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('dt-loja-alterada', function () {
    PALETES_CACHE = [];
    PALETES_MOTORISTAS_CACHE = [];
    _paletesCarregado = false;
  });
}

// PEDIDO AO VIVO (2026-09-04): "o nome lá vai mudar... 'controle de
// paletes'... vai ter duas opções, paletes em estoque e saída de paletes"
// — o card do menu de Recebimento agora abre este menu intermediário
// (screen-paletes-menu), não mais direto a lista de trânsito.
function abrirControlePaletes() {
  goScreen('paletes-menu');
}

function abrirPaletesRecebimento() {
  goScreen('paletes');
  carregarPaletesColetor();
}

let _cargaPaletesEmAndamento = null;
function carregarPaletesColetor(forcar) {
  if (_cargaPaletesEmAndamento) return _cargaPaletesEmAndamento;
  _cargaPaletesEmAndamento = _carregarPaletesColetorImpl(forcar).finally(function () {
    _cargaPaletesEmAndamento = null;
  });
  return _cargaPaletesEmAndamento;
}
async function _carregarPaletesColetorImpl(forcar) {
  if (_paletesCarregado && !forcar) {
    _desenharListaPaletes();
    return;
  }
  const lista = document.getElementById('paletes-lista-transito');
  if (lista && !PALETES_CACHE.length) lista.innerHTML = '<div style="text-align:center;padding:20px;color:#5a7a9a">Carregando...</div>';
  try {
    const resultados = await Promise.all([
      FS.collection(COL_PALETES).get(),
      FS.collection(COL_PALETES_MOTORISTAS).get()
    ]);
    const snapPal = resultados[0], snapMot = resultados[1];
    PALETES_CACHE = snapPal.docs.map(function (d) { return Object.assign({ _id: d.id }, d.data()); });
    PALETES_MOTORISTAS_CACHE = snapMot.docs.map(function (d) { return Object.assign({ _id: d.id }, d.data()); });
    _paletesCarregado = true;
  } catch (e) {
    console.warn('[Paletes] Falha ao carregar:', e && e.message ? e.message : e);
  }
  _desenharListaPaletes();
}

function _paletesEmTransito() {
  return PALETES_CACHE.filter(function (p) { return p.status === 'EM_TRANSITO'; })
    .sort(function (a, b) { return String(b.horaSaida || '').localeCompare(String(a.horaSaida || '')); });
}

function _desenharListaPaletes() {
  const lista = document.getElementById('paletes-lista-transito');
  if (!lista) return;
  const itens = _paletesEmTransito();
  if (!itens.length) {
    lista.innerHTML = '<div style="text-align:center;padding:16px;color:#5a7a9a;font-size:.85rem">Nenhuma viagem em trânsito.</div>';
    return;
  }
  lista.innerHTML = itens.map(function (p) {
    return '<div class="inv-card" data-paletes-id="' + _escRec(p._id) + '">'
      + '<div class="inv-card-code">Viagem ' + _escRec(p.numeroViagem || '—') + '</div>'
      + '<div class="inv-card-name">' + _escRec(p.motoristaNome || '—') + ' → ' + _escRec(p.mercado || '—') + '</div>'
      + '<div class="inv-card-meta"><span class="badge badge-info">' + _escRec(p.paletesSaida || 0) + ' palete(s) na saída</span></div>'
      + '</div>';
  }).join('');
  Array.prototype.forEach.call(lista.querySelectorAll('[data-paletes-id]'), function (card) {
    card.addEventListener('click', function () {
      abrirRetornoPaletes(card.getAttribute('data-paletes-id'));
    });
  });
}

// ── Nova saída ──────────────────────────────────────────────────────────
function _preencherSelectMotoristasPaletes() {
  const sel = document.getElementById('paletes-saida-motorista');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Selecionar —</option>' + PALETES_MOTORISTAS_CACHE.map(function (m) {
    return '<option value="' + _escRec(m._id) + '">' + _escRec(m.nome) + '</option>';
  }).join('');
}
// BUG evitado (achado escrevendo o teste desta função): construir o
// <select> ANTES de garantir que PALETES_MOTORISTAS_CACHE já carregou —
// se o operador entra direto em "Nova saída" sem ter passado pela lista
// (screen-paletes) antes, o cache estava vazio e o dropdown ficava
// permanentemente sem opção nenhuma, mesmo depois do carregamento em
// segundo plano terminar (nada o repovoava depois). Agora espera o
// carregamento terminar (se o cache ainda estiver vazio) antes de montar
// as opções.
async function abrirNovaSaidaPaletes() {
  const mercado = document.getElementById('paletes-saida-mercado'); if (mercado) mercado.value = '';
  const viagem = document.getElementById('paletes-saida-viagem'); if (viagem) viagem.value = '';
  const qtd = document.getElementById('paletes-saida-quantidade'); if (qtd) qtd.value = '';
  const status = document.getElementById('paletes-saida-status'); if (status) status.textContent = '';
  const sel = document.getElementById('paletes-saida-motorista');
  if (sel && !PALETES_MOTORISTAS_CACHE.length) sel.innerHTML = '<option value="">Carregando motoristas...</option>';
  goScreen('paletes-nova-saida');
  if (!PALETES_MOTORISTAS_CACHE.length && navigator.onLine) {
    try { await carregarPaletesColetor(); } catch (e) { console.warn('[Paletes] Falha ao carregar motoristas:', e && e.message ? e.message : e); }
  }
  _preencherSelectMotoristasPaletes();
}

async function confirmarSaidaPaletes() {
  const status = document.getElementById('paletes-saida-status');
  const elMotorista = document.getElementById('paletes-saida-motorista');
  const elMercado = document.getElementById('paletes-saida-mercado');
  const elViagem = document.getElementById('paletes-saida-viagem');
  const elQtd = document.getElementById('paletes-saida-quantidade');
  const motoristaId = elMotorista ? elMotorista.value : '';
  const mercado = (elMercado ? elMercado.value : '').trim();
  const viagem = (elViagem ? elViagem.value : '').trim();
  const quantidade = Number(elQtd ? elQtd.value : '');
  if (!motoristaId) { if (status) status.textContent = 'Selecione o motorista.'; return; }
  if (!mercado) { if (status) status.textContent = 'Informe o mercado.'; return; }
  if (!viagem) { if (status) status.textContent = 'Informe o número da viagem.'; return; }
  if (!Number.isFinite(quantidade) || quantidade <= 0) { if (status) status.textContent = 'Informe uma quantidade válida de paletes.'; return; }
  const motorista = PALETES_MOTORISTAS_CACHE.find(function (m) { return m._id === motoristaId; });
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const lojaId = _lojaAtivaRec();
  const nomeLoja = await _obterNomeLojaPaletes(lojaId);
  const payload = {
    motoristaId: motoristaId,
    motoristaNome: (motorista && motorista.nome) || '',
    placa: (motorista && motorista.placa) || '',
    mercado: mercado,
    numeroViagem: viagem,
    paletesSaida: Math.round(quantidade),
    paletesRetorno: null,
    horaSaida: agora,
    horaRetorno: null,
    status: 'EM_TRANSITO',
    origemLojaId: lojaId,
    origem: nomeLoja,
    criadoEm: agora, criadoPor: autor, atualizadoEm: agora, atualizadoPor: autor
  };
  if (status) status.textContent = 'Salvando...';
  try {
    const ref = await FS.collection(COL_PALETES).add(payload);
    PALETES_CACHE.push(Object.assign({ _id: ref.id }, payload));
    // Ledger é alimentado DEPOIS do registro principal já estar salvo — uma
    // falha aqui não pode travar a operação (o log de movimentos permite
    // reconciliar manualmente depois, ver 28-recebimento-paletes-ledger.js).
    try {
      await _aplicarMovimentoLedger(lojaId, 'SAIDA_EXTERNA',
        { disponivelDelta: -Math.round(quantidade), emTransitoDelta: Math.round(quantidade) },
        { colecao: COL_PALETES, id: ref.id });
    } catch (eLedger) {
      console.warn('[Paletes] Falha ao atualizar ledger na saída:', eLedger && eLedger.message ? eLedger.message : eLedger);
    }
    toast('Saída de paletes registrada!', 's');
    goScreen('paletes');
    _desenharListaPaletes();
  } catch (e) {
    if (status) status.textContent = 'Erro ao salvar: ' + (e && e.message ? e.message : e);
  }
}

async function _obterNomeLojaPaletes(lojaId) {
  if (!lojaId) return '';
  try {
    const raw = typeof getDTRawFirestore === 'function' ? getDTRawFirestore() : null;
    if (!raw) return lojaId;
    const doc = await raw.collection('lojas').doc(lojaId).get();
    if (doc && doc.exists) {
      const dados = doc.data();
      return (dados && dados.nome) || lojaId;
    }
    return lojaId;
  } catch (e) {
    return lojaId;
  }
}

// ── Registrar retorno ───────────────────────────────────────────────────
function abrirRetornoPaletes(id) {
  const p = PALETES_CACHE.find(function (x) { return x._id === id; });
  if (!p) { toast('Viagem não encontrada.', 'e'); return; }
  _paletesRetornoId = id;
  const resumo = document.getElementById('paletes-retorno-resumo');
  if (resumo) resumo.textContent = (p.motoristaNome || '—') + ' → ' + (p.mercado || '—') + ' · ' + (p.paletesSaida || 0) + ' palete(s) na saída';
  const viagem = document.getElementById('paletes-retorno-viagem'); if (viagem) viagem.value = '';
  const qtd = document.getElementById('paletes-retorno-quantidade'); if (qtd) qtd.value = '';
  const status = document.getElementById('paletes-retorno-status'); if (status) status.textContent = '';
  goScreen('paletes-retorno');
}

async function confirmarRetornoPaletes() {
  const status = document.getElementById('paletes-retorno-status');
  const p = PALETES_CACHE.find(function (x) { return x._id === _paletesRetornoId; });
  if (!p) { if (status) status.textContent = 'Viagem não encontrada — volte e tente de novo.'; return; }
  const elViagem = document.getElementById('paletes-retorno-viagem');
  const elQtd = document.getElementById('paletes-retorno-quantidade');
  const viagemDigitada = (elViagem ? elViagem.value : '').trim();
  const quantidade = Number(elQtd ? elQtd.value : '');
  if (!viagemDigitada) { if (status) status.textContent = 'Digite o número da viagem.'; return; }
  // Confere a viagem redigitada contra a registrada na saída — mesma
  // checagem de integridade que o Transbordo já usa na chegada (NF), pra
  // não fechar a viagem errada por engano de toque na lista.
  if (String(viagemDigitada) !== String(p.numeroViagem || '')) {
    if (status) status.textContent = '❌ Não confere com a viagem registrada na saída (' + (p.numeroViagem || '—') + '). Confira e tente de novo.';
    return;
  }
  if (!Number.isFinite(quantidade) || quantidade < 0) { if (status) status.textContent = 'Informe uma quantidade válida de paletes.'; return; }
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const payload = {
    paletesRetorno: Math.round(quantidade),
    horaRetorno: agora,
    status: 'FINALIZADO',
    atualizadoEm: agora, atualizadoPor: autor
  };
  if (status) status.textContent = 'Salvando...';
  try {
    await FS.collection(COL_PALETES).doc(p._id).update(payload);
    Object.assign(p, payload);
    // Delta usa o que REALMENTE voltou (paletesRetorno), não o que saiu
    // (paletesSaida) — o que não voltar continua contando como "em
    // trânsito" pra sempre, igual saldoDe() do monitoramento do Analista já
    // expõe hoje (sem bucket de perda, decisão já validada no plano).
    try {
      const lojaId = p.origemLojaId || _lojaAtivaRec();
      await _aplicarMovimentoLedger(lojaId, 'RETORNO_EXTERNO',
        { disponivelDelta: Math.round(quantidade), emTransitoDelta: -Math.round(quantidade) },
        { colecao: COL_PALETES, id: p._id });
    } catch (eLedger) {
      console.warn('[Paletes] Falha ao atualizar ledger no retorno:', eLedger && eLedger.message ? eLedger.message : eLedger);
    }
    toast('Retorno de paletes registrado!', 's');
    goScreen('paletes');
    _desenharListaPaletes();
  } catch (e) {
    if (status) status.textContent = 'Erro ao salvar: ' + (e && e.message ? e.message : e);
  }
}

// ── Paletes em Estoque (registro diário) ────────────────────────────────
// PEDIDO AO VIVO (2026-09-04): "paletes em estoque é onde a pessoa vai
// colocar todo dia a quantidade de paletes que tem" — 1 doc por LOJA+DIA
// (doc id = data local AAAA-MM-DD), pra reenviar no mesmo dia atualizar em
// vez de duplicar, e pro Analista enxergar o histórico dia a dia por loja.
const COL_PALETES_ESTOQUE = 'recebimento_paletes_estoque';
function _dataHojeIsoPaletes() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
async function abrirPaletesEstoque() {
  const qtd = document.getElementById('paletes-estoque-quantidade'); if (qtd) qtd.value = '';
  const status = document.getElementById('paletes-estoque-status'); if (status) status.textContent = '';
  const ultimo = document.getElementById('paletes-estoque-ultimo'); if (ultimo) ultimo.textContent = 'Carregando...';
  goScreen('paletes-estoque');
  try {
    const hoje = _dataHojeIsoPaletes();
    const doc = await FS.collection(COL_PALETES_ESTOQUE).doc(hoje).get();
    if (doc && doc.exists) {
      const dados = doc.data();
      if (qtd) qtd.value = dados && dados.quantidade != null ? dados.quantidade : '';
      if (ultimo) ultimo.textContent = 'Já registrado hoje: ' + (dados && dados.quantidade != null ? dados.quantidade : '—') + ' palete(s). Salvar de novo substitui.';
    } else if (ultimo) {
      ultimo.textContent = 'Ainda não registrado hoje.';
    }
  } catch (e) {
    if (ultimo) ultimo.textContent = '';
    console.warn('[Paletes] Falha ao carregar estoque de hoje:', e && e.message ? e.message : e);
  }
}
async function confirmarPaletesEstoque() {
  const status = document.getElementById('paletes-estoque-status');
  const elQtd = document.getElementById('paletes-estoque-quantidade');
  const valorDigitado = (elQtd ? elQtd.value : '').trim();
  const quantidade = Number(valorDigitado);
  // Campo vazio ("" -> Number("")=0) não pode passar como "0 paletes"
  // digitado de propósito — checa a string antes de converter.
  if (!valorDigitado || !Number.isFinite(quantidade) || quantidade < 0) { if (status) status.textContent = 'Informe uma quantidade válida de paletes.'; return; }
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const lojaId = _lojaAtivaRec();
  const nomeLoja = await _obterNomeLojaPaletes(lojaId);
  const payload = {
    data: _dataHojeIsoPaletes(),
    quantidade: Math.round(quantidade),
    origemLojaId: lojaId,
    origem: nomeLoja,
    registradoEm: agora, registradoPor: autor,
    atualizadoEm: agora, atualizadoPor: autor
  };
  if (status) status.textContent = 'Salvando...';
  try {
    await FS.collection(COL_PALETES_ESTOQUE).doc(payload.data).set(payload, { merge: true });
    toast('Estoque de paletes registrado!', 's');
    goScreen('paletes-menu');
  } catch (e) {
    if (status) status.textContent = 'Erro ao salvar: ' + (e && e.message ? e.message : e);
  }
}

window.abrirControlePaletes = abrirControlePaletes;
window.abrirPaletesEstoque = abrirPaletesEstoque;
window.confirmarPaletesEstoque = confirmarPaletesEstoque;
window.abrirPaletesRecebimento = abrirPaletesRecebimento;
window.carregarPaletesColetor = carregarPaletesColetor;
window.abrirNovaSaidaPaletes = abrirNovaSaidaPaletes;
window.confirmarSaidaPaletes = confirmarSaidaPaletes;
window.abrirRetornoPaletes = abrirRetornoPaletes;
window.confirmarRetornoPaletes = confirmarRetornoPaletes;
window._recebimentoPaletesInternals = {
  getPaletes: function () { return PALETES_CACHE; },
  getMotoristas: function () { return PALETES_MOTORISTAS_CACHE; },
  dataHojeIso: _dataHojeIsoPaletes
};
