// ═══════════════════════════════════════════════════
//  RECEBIMENTO — Montagem/Expedição de Carga (Transbordo planejado)
//  Segunda forma de chegar a um transbordo, além do QR fixo do motorista
//  (22-recebimento.js): "Nova Movimentação" → montar a carga com
//  antecedência (produto por produto, palete por palete) e só depois
//  expedir de verdade (motorista/NF), gerando um transbordo real na MESMA
//  coleção `recebimentos` de sempre. Coleção própria
//  `recebimento_transbordo_cargas` (+ subcoleção `itens`, só existe
//  enquanto a carga está PENDENTE).
//
//  Reaproveita utilitários já globais de 22-recebimento.js (_escRec,
//  _lojaAtivaRec, _obterNomeLojaAtiva, ROTAS_CACHE/_destinosPossiveis/
//  _destinosPossiveisAoVivo — mesmo mecanismo de "destino" já usado pelo
//  Transbordo ad-hoc) — carregado antes deste arquivo em coletor.html.
//
//  Lookup de produto por capa/GTIN/código: cache PRÓPRIO deste arquivo
//  (mesmo padrão de 24-recebimento-recusas.js:203-222 — nunca um Map
//  compartilhado entre arquivos, só o PADRÃO é reaproveitado).
//
//  IMPORTANTE (lição ao vivo real desta sessão): NUNCA usar `?.`/`??` neste
//  arquivo — coletores industriais antigos travam com SyntaxError nessa
//  sintaxe. Sempre `x && x.y` / ternário.
// ═══════════════════════════════════════════════════

const COL_CARGAS = 'recebimento_transbordo_cargas';
const COL_CARGAS_PRODUTOS = 'producao_produtos';
// BUG AO VIVO REAL (2026-09-06): "os motoristas que aparecem ali tem que
// ser os cadastrados para transbordo" — usava por engano o MESMO cadastro
// de recebimento_recusas_motoristas de 25-recebimento-paletes.js (motorista
// de Notas Retornadas/Paletes, por loja) — mas Expedição de Carga gera um
// TRANSBORDO de verdade (via _criarTransbordoPorMotorista, 22-recebimento.js),
// que é o cadastro GLOBAL recebimento_motoristas (ver 92-recebimento-
// config.js e o comentário em 22-recebimento.js sobre esse cadastro ter
// virado global pra não prender motorista numa loja só).
const COL_CARGAS_MOTORISTAS = 'recebimento_motoristas';
let CARGAS_CACHE = [];
let _cargasProdutosPorCod = new Map();
let _cargasProdutosPorGtin = new Map();
let _cargasProdutosPorNome = new Map();
let _cargasCarregado = false;
let _cargaAtualId = null; // carga aberta na tela de montagem/expedição
let _cargaItensCache = []; // itens da carga aberta
let CARGAS_MOTORISTAS_CACHE = [];
let _cargaNotasFiscaisEmEdicao = [{ numero: '', volumes: '' }];

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('dt-loja-alterada', function () {
    CARGAS_CACHE = [];
    _cargasProdutosPorCod = new Map();
    _cargasProdutosPorGtin = new Map();
    _cargasProdutosPorNome = new Map();
    _cargasCarregado = false;
    CARGAS_MOTORISTAS_CACHE = [];
    // PEDIDO AO VIVO (2026-09-08): notificação de capa-palete com erro em
    // TEMPO REAL, mesmo em outra tela — `dt-loja-alterada` já dispara tanto
    // no login quanto na troca de loja (02-sync-dispositivo.js/04-auth-
    // login.js), então é o único ponto de entrada que garante que o
    // listener (re)inicia assim que o operador tem uma loja ativa de
    // verdade, sem duplicar lógica de bootstrap.
    _reiniciarListenerPendenciasCarga();
  });
}

// ── Menu "Nova Movimentação" ────────────────────────────────────────────
function abrirNovaMovimentacaoRecebimento() {
  if(typeof coletorExigirPermissao==='function'&&!coletorExigirPermissao('recebimento-transbordo','criar'))return;
  goScreen('nova-movimentacao-menu');
}

// ── Lista de cargas (PENDENTE/EM_TRANSITO) ──────────────────────────────
function abrirCargasRecebimento() {
  if(typeof coletorExigirPermissao==='function'&&!coletorExigirPermissao('recebimento-transbordo','criar'))return;
  goScreen('cargas-lista');
  carregarCargasColetor();
}

let _cargaCarregamentoEmAndamento = null;
function carregarCargasColetor(forcar) {
  if (_cargaCarregamentoEmAndamento) return _cargaCarregamentoEmAndamento;
  _cargaCarregamentoEmAndamento = _carregarCargasColetorImpl(forcar).finally(function () {
    _cargaCarregamentoEmAndamento = null;
  });
  return _cargaCarregamentoEmAndamento;
}
async function _carregarCargasColetorImpl(forcar) {
  if (_cargasCarregado && !forcar) {
    _desenharListaCargas();
    return;
  }
  const lista = document.getElementById('cargas-lista-itens');
  if (lista && !CARGAS_CACHE.length) lista.innerHTML = '<div style="text-align:center;padding:20px;color:#5a7a9a">Carregando...</div>';
  try {
    const snap = await FS.collection(COL_CARGAS).get();
    CARGAS_CACHE = snap.docs.map(function (d) { return Object.assign({ _id: d.id }, d.data()); });
    _cargasCarregado = true;
  } catch (e) {
    console.warn('[Cargas] Falha ao carregar:', e && e.message ? e.message : e);
  }
  _desenharListaCargas();
}

function _cargasEmAberto() {
  return CARGAS_CACHE.filter(function (c) { return c.status === 'PENDENTE' || c.status === 'EM_TRANSITO'; })
    .sort(function (a, b) { return String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')); });
}

var _impressorasRedeCache = null;
async function _listarImpressorasRedeCarga() {
  if (_impressorasRedeCache) return _impressorasRedeCache;
  var raw = typeof getDTRawFirestore === 'function' ? getDTRawFirestore() : null;
  if (!raw) return [];
  var lojaId = (typeof getDTLojaAtiva === 'function' && getDTLojaAtiva()) || (APP.lojaAtual && APP.lojaAtual.id) || APP.lojaId || '';
  var snap = await raw.collection('impressoras_rede').get();
  _impressorasRedeCache = snap.docs.map(function(d){return Object.assign({_id:d.id}, d.data() || {});}).filter(function(x){return x.ativo !== false && (!x.lojaId || x.lojaId === lojaId);});
  return _impressorasRedeCache;
}
function _documentosImprimiveisCarga(carga) {
  return ((carga && carga.notasFiscaisProdutos) || []).filter(function(n){return n.produtos && n.produtos.length && n.documentoUrl;});
}
async function imprimirDocumentosCarga(cargaId) {
  var carga = CARGAS_CACHE.find(function(c){return c._id === cargaId;});
  if (!carga) return toast('Carga não encontrada.', 'e');
  var docs = _documentosImprimiveisCarga(carga);
  if (!docs.length) return toast('Ainda não há PDF de nota disponível para impressão.', 'w');
  var impressoras = [];
  try { impressoras = await _listarImpressorasRedeCarga(); } catch(e) { return toast('Não foi possível carregar as impressoras cadastradas.', 'e'); }
  if (!impressoras.length) return toast('Nenhuma impressora de rede disponível para esta loja.', 'w');
  var opcoes = impressoras.map(function(x,i){return (i+1) + ' - ' + (x.nome || x.modelo || 'Impressora');}).join('\n');
  var escolha = window.prompt('Escolha a impressora:\n' + opcoes, '1');
  if (escolha == null) return;
  var imp = impressoras[Number(escolha)-1];
  if (!imp) return toast('Impressora inválida.', 'e');
  var endpoint = String(imp.endpoint || '').replace(/\/$/, '');
  try {
    for (var i=0;i<docs.length;i++) {
      var n=docs[i];
      var r=await fetch(endpoint + '/print', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentUrl:n.documentoUrl,documentName:n.documentoNome || ('NF-'+n.numero+'.pdf'),nota:n.numero,cargaId:cargaId,cargaNome:carga.nomeCarga || '',printerName:imp.nome || '',printerModel:imp.modelo || ''})});
      if (!r.ok) throw new Error('HTTP '+r.status);
    }
    toast(docs.length + ' documento(s) enviado(s) para ' + (imp.nome || 'impressora') + '.', 's');
  } catch(e) { toast('Falha ao imprimir: ' + (e && e.message ? e.message : e), 'e'); }
}

function _desenharListaCargas() {
  const lista = document.getElementById('cargas-lista-itens');
  if (!lista) return;
  const itens = _cargasEmAberto();
  if (!itens.length) {
    lista.innerHTML = '<div style="text-align:center;padding:16px;color:#5a7a9a;font-size:.85rem">Nenhuma carga em andamento. Toque em "+ Nova carga" pra começar a montar.</div>';
    return;
  }
  // BUG AO VIVO REAL (2026-09-06): "quando finalizo a montagem ela não
  // finaliza" — finalizar montagem SALVA certo (totalPaletesFisico/
  // totalVolumes gravados, volta pra lista) mas o status continua
  // PENDENTE de propósito (só a Expedição muda pra EM_TRANSITO) — o rótulo
  // "Em montagem" não mudava nadinha, dando a impressão de que nada tinha
  // acontecido. Carga com totalPaletesFisico já gravado mostra um rótulo
  // diferente, deixando claro que a montagem terminou e falta só expedir.
  const STATUS_LABEL = { PENDENTE: 'Em montagem', EM_TRANSITO: 'Expedida' };
  // PEDIDO AO VIVO (2026-09-08): "inverte o nome da carga com o origem
  // destino, e coloca o número das notas que tá vinculadas visíveis" — o
  // nome que o operador deu à carga (o jeito que ele reconhece qual é
  // qual) virou o destaque; origem→destino é só contexto, igual placa/
  // rota já são em outras telas. Números de nota juntam as duas fontes
  // (NF manual + vínculo produto→nota do Analista, mesmo critério já
  // usado no badge do card do Analista em 104-recebimento-cargas-cards.js).
  lista.innerHTML = itens.map(function (c) {
    const rotulo = _cargaProntaParaExpedicao(c) ? 'Pronta pra expedição' : (STATUS_LABEL[c.status] || c.status);
    const numerosNf = (c.notasFiscais || []).map(function (n) { return n.numero; })
      .concat((c.notasFiscaisProdutos || []).filter(function (n) { return n.produtos && n.produtos.length; }).map(function (n) { return n.numero; }));
    const nfUnicas = numerosNf.filter(function (numero, idx) { return numerosNf.indexOf(numero) === idx; });
    const badgeNf = nfUnicas.length ? '<span class="badge badge-info">NF ' + _escRec(nfUnicas.join(', ')) + '</span>' : '';
    const podeImprimir = c.notasProdutosCompletas === true && _documentosImprimiveisCarga(c).length > 0;
    const botaoImprimir = podeImprimir ? '<button type="button" class="btn btn-ghost btn-sm" data-carga-imprimir="' + _escRec(c._id) + '" title="Imprimir nota(s)">🖨️</button>' : '';
    return '<div class="inv-card" data-carga-id="' + _escRec(c._id) + '">'
      + '<div class="inv-card-code">' + _escRec(c.origemNome || '—') + ' → ' + _escRec(c.destinoNome || '—') + '</div>'
      + '<div class="inv-card-name">' + _escRec(c.nomeCarga || '(sem nome)') + '</div>'
      + '<div class="inv-card-meta"><span class="badge badge-info">' + _escRec(rotulo) + '</span>' + badgeNf + botaoImprimir + '</div>'
      + '</div>';
  }).join('');
  // BUG AO VIVO REAL (2026-09-06): "clico nela e aparece a opção de
  // adicionar mais paletes, e por onde eu seleciono essa carga pra virar um
  // transbordo" — todo PENDENTE ia sempre pra Montagem, mesmo já "Pronta
  // pra expedição" (montagem finalizada é PENDENTE de propósito, só muda no
  // status na Expedição) — não existia NENHUM jeito de chegar na Expedição
  // clicando no card. Mesmo critério do rótulo acima decide pra onde abrir.
  Array.prototype.forEach.call(lista.querySelectorAll('[data-carga-imprimir]'), function(btn){
    btn.addEventListener('click', function(ev){ev.stopPropagation(); imprimirDocumentosCarga(btn.getAttribute('data-carga-imprimir'));});
  });
  Array.prototype.forEach.call(lista.querySelectorAll('[data-carga-id]'), function (card) {
    card.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('[data-carga-imprimir]')) return;
      abrirCargaPorId(card.getAttribute('data-carga-id'));
    });
  });
}

// BUG AO VIVO REAL (2026-09-08): abrir uma carga EM_TRANSITO/RECEBIDA/
// CANCELADA não tinha NENHUMA tela — abrirExpedicaoCarga só mostrava um
// toast "já foi expedida" e voltava pra lista. Função única de roteamento
// (reaproveitada pelo clique na lista E pelo botão "Corrigir agora" do
// alerta de pendência de capa) decide pra onde cada status vai.
async function abrirCargaPorId(cargaId) {
  let carga = CARGAS_CACHE.find(function (c) { return c._id === cargaId; });
  if (!carga) {
    try {
      const doc = await FS.collection(COL_CARGAS).doc(cargaId).get();
      if (doc && doc.exists) { carga = Object.assign({ _id: cargaId }, doc.data()); CARGAS_CACHE.push(carga); }
    } catch (e) { console.warn('[Cargas] Falha ao buscar carga:', e && e.message ? e.message : e); }
  }
  if (!carga) { toast('Carga não encontrada.', 'e'); return; }
  // BUG AO VIVO REAL (2026-09-08): "clico em corrigir... ele abre como se
  // fosse expedir a carga (motorista/nota)... tem que aparecer os paletes
  // e poder alterar a capa" — uma carga PENDENTE já "pronta pra expedição"
  // (montagem finalizada, mas ainda não expedida) COM pendência de capa
  // caía direto na tela de Expedição (motorista/NF), que não mostra item
  // nenhum. Só continua indo pra Montagem quando a montagem em si ainda
  // não terminou — nesse caso o banner de pendência já aparece lá mesmo
  // (abrirMontagemCarga), sem precisar desviar.
  if (carga.status === 'PENDENTE' && !_cargaProntaParaExpedicao(carga)) { abrirMontagemCarga(cargaId); }
  else if (carga.status === 'PENDENTE' && !carga.temPendenciaCapa) { abrirExpedicaoCarga(cargaId); }
  else { abrirDetalheCarga(cargaId); }
}
function _cargaProntaParaExpedicao(c) {
  return !!(c && c.status === 'PENDENTE' && c.totalPaletesFisico > 0);
}

// ── Nova carga ───────────────────────────────────────────────────────────
async function abrirNovaCarga() {
  const nome = document.getElementById('carga-nova-nome'); if (nome) nome.value = '';
  const status = document.getElementById('carga-nova-status'); if (status) status.textContent = '';
  const sel = document.getElementById('carga-nova-destino');
  if (sel) sel.innerHTML = '<option value="">Carregando destinos...</option>';
  goScreen('carga-nova');
  let destinos = _destinosPossiveis();
  if (!destinos.length && navigator.onLine) {
    try { destinos = await _destinosPossiveisAoVivo(); } catch (e) { console.warn('[Cargas] Falha ao buscar destinos:', e && e.message ? e.message : e); }
  }
  if (sel) {
    sel.innerHTML = '<option value="">— Selecionar —</option>' + destinos.map(function (d) {
      return '<option value="' + _escRec(d.id) + '">' + _escRec(d.nome) + '</option>';
    }).join('');
  }
}

async function confirmarNovaCarga() {
  const status = document.getElementById('carga-nova-status');
  const elNome = document.getElementById('carga-nova-nome');
  const elDestino = document.getElementById('carga-nova-destino');
  const nomeCarga = (elNome ? elNome.value : '').trim();
  const destinoLojaId = elDestino ? elDestino.value : '';
  if (!nomeCarga) { if (status) status.textContent = 'Dê um nome pra essa carga.'; return; }
  if (!destinoLojaId) { if (status) status.textContent = 'Selecione o destino.'; return; }
  const destinos = _destinosPossiveis().concat(await _destinosPossiveisAoVivo().catch(function () { return []; }));
  const destino = destinos.find(function (d) { return d.id === destinoLojaId; });
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const lojaId = _lojaAtivaRec();
  const nomeOrigem = await _obterNomeLojaAtiva();
  const payload = {
    nomeCarga: nomeCarga,
    origemLojaId: lojaId,
    origemNome: nomeOrigem,
    destinoLojaId: destinoLojaId,
    destinoNome: (destino && destino.nome) || destinoLojaId,
    status: 'PENDENTE',
    totalPaletesFisico: null,
    totalVolumes: 0,
    motoristaId: null, motoristaNome: null, placa: null,
    notasFiscais: [],
    recebimentoId: null,
    criadoEm: agora, criadoPor: autor, atualizadoEm: agora, atualizadoPor: autor,
    expedidoEm: null, expedidoPor: null, recebidoEm: null, recebidoPor: null
  };
  if (status) status.textContent = 'Salvando...';
  try {
    const ref = await FS.collection(COL_CARGAS).add(payload);
    CARGAS_CACHE.push(Object.assign({ _id: ref.id }, payload));
    toast('Carga criada! Agora monte os itens.', 's');
    abrirMontagemCarga(ref.id);
  } catch (e) {
    if (status) status.textContent = 'Erro ao salvar: ' + (e && e.message ? e.message : e);
  }
}

// ── Montagem de itens ────────────────────────────────────────────────────
// Mesma normalização de nome já usada em 78-pcp-central.js (keyOf/norm) —
// minúsculo, sem acento — pra cruzar produto entre bases diferentes.
function _normNomeCarga(v) {
  return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
async function _garantirProdutosCargasCarregados() {
  if (_cargasProdutosPorCod.size || _cargasProdutosPorGtin.size) return;
  try {
    const snap = await FS.collection(COL_CARGAS_PRODUTOS).get();
    _cargasProdutosPorCod = new Map(snap.docs.map(function (d) {
      const x = d.data() || {};
      return [String(x.cod || ''), { nome: x.nome || '', gtin: x.gtin || '' }];
    }).filter(function (par) { return par[0]; }));
    _cargasProdutosPorGtin = new Map(snap.docs.map(function (d) {
      const x = d.data() || {};
      return [String(x.gtin || ''), { cod: x.cod || '', nome: x.nome || '' }];
    }).filter(function (par) { return par[0]; }));
    // BUG AO VIVO REAL (2026-09-06): "não tá reconhecendo o produto bipado"
    // — producao_produtos NUNCA teve campo gtin (nem no template Excel, nem
    // no import de 71-producao-excel.js) — bipar um código de barras real
    // NUNCA batia com nada aqui. cod/prodCod/prodKey são numerações
    // DIFERENTES em cada base (confirmado: dt_produtos.codigoInterno vem do
    // produto_key do Bluesoft; producao_produtos.cod é o código legado da
    // PCP) — cruzar os dois direto por igualdade de código arriscaria pegar
    // o produto ERRADO num contexto de carregar caminhão. A ponte segura,
    // já usada em outras telas de PCP (78-pcp-central.js: keyOf/norm), é
    // pelo NOME normalizado, não pelo código. Índice por nome aqui é só
    // fallback: só é usado quando o código batido não é achado direto em
    // nenhum dos dois mapas acima.
    _cargasProdutosPorNome = new Map(snap.docs.map(function (d) {
      const x = d.data() || {};
      const chave = _normNomeCarga(x.nome);
      return [chave, { cod: x.cod || '', nome: x.nome || '', gtin: x.gtin || '' }];
    }).filter(function (par) { return par[0]; }));
  } catch (e) {
    console.warn('[Cargas] Falha ao carregar produtos:', e && e.message ? e.message : e);
  }
}

// BUG AO VIVO REAL (2026-09-06): "o que tem a ver fazer uma carga com PCP e
// produção?" — pergunta certa do usuário. Bipar um pallet pra carregar um
// caminhão é logística pura (transbordo entre lojas), não precisa de nenhum
// campo exclusivo da Produção (máquina, cobertura de estoque, prioridade
// etc.) — a dependência de producao_produtos aqui era só um padrão copiado
// de outra tela, sem necessidade real. A Base de Produtos do Inventário
// (window.DTProdutos) É o catálogo certo pra isso: tem GTIN/DUN de verdade,
// já é usada pelo scanner do inventário, e é onde "todo produto cadastrado"
// realmente vive. Agora ela é a fonte PRINCIPAL; producao_produtos só entra
// como reforço pra produto que por algum motivo só está cadastrado na PCP
// (ex.: insumo interno sem venda, sem entrada na Base de Produtos ainda).
function _buscarProdutoPorCodigo(codigoDigitado) {
  const codigo = String(codigoDigitado || '').trim();
  if (!codigo) return null;
  if (typeof window !== 'undefined' && window.DTProdutos && typeof window.DTProdutos.buscarSync === 'function') {
    const achadoInventario = window.DTProdutos.buscarSync(codigo);
    if (achadoInventario && achadoInventario.encontrado && !achadoInventario.ambiguo) {
      return {
        cod: achadoInventario.codigoInterno || codigo,
        nome: achadoInventario.nomeProduto,
        gtin: achadoInventario.gtin || achadoInventario.dun || codigo,
      };
    }
  }
  // Reforço: produto cadastrado só na PCP (ainda não está na Base de
  // Produtos do Inventário).
  if (_cargasProdutosPorGtin.has(codigo)) {
    const p = _cargasProdutosPorGtin.get(codigo);
    return { cod: p.cod, nome: p.nome, gtin: codigo };
  }
  if (_cargasProdutosPorCod.has(codigo)) {
    const p = _cargasProdutosPorCod.get(codigo);
    return { cod: codigo, nome: p.nome, gtin: p.gtin };
  }
  return null;
}

// PEDIDO AO VIVO (2026-09-08): "o produto às vezes demora pra carregar...
// ver se tem como consultar na hora que bipar, quando os produtos ainda
// não tiver atualizado/baixado no aparelho" — até aqui, sem o catálogo
// local (window.DTProdutos, baixado em chunks — pode ser grande e demorar
// numa conexão ruim), o único jeito era esperar o download inteiro
// terminar. `dt_produtos` (a coleção-fonte, 1 documento por produto, de
// onde os chunks são gerados em 39-base-produtos.js/publicarChunksProdutos)
// já é lida por qualquer usuário ativo (firestore.rules:2240) — dá pra
// consultar só o código bipado, direto, sem baixar a base inteira.
// Consulta pelos 3 campos em paralelo (Firestore não faz OR entre campos
// diferentes numa query só) — cobre GTIN, DUN e código interno, iguais
// aos 3 jeitos que buscarSync() já reconhece localmente.
async function _buscarProdutoAoVivo(codigoDigitado) {
  const codigo = String(codigoDigitado || '').trim();
  if (!codigo) return null;
  const raw = typeof getDTRawFirestore === 'function' ? getDTRawFirestore() : null;
  if (!raw) return null;
  const vazio = { empty: true, docs: [] };
  try {
    const col = raw.collection('dt_produtos');
    const resultados = await Promise.all([
      col.where('gtin', '==', codigo).limit(1).get().catch(function () { return vazio; }),
      col.where('dun', '==', codigo).limit(1).get().catch(function () { return vazio; }),
      col.where('codigoInterno', '==', codigo).limit(1).get().catch(function () { return vazio; }),
    ]);
    const snapAchado = resultados.find(function (s) { return s && !s.empty && s.docs.length; });
    if (!snapAchado) return null;
    const x = snapAchado.docs[0].data() || {};
    const achado = { cod: x.codigoInterno || codigo, nome: x.nomeProduto || '', gtin: x.gtin || x.dun || codigo };
    // Guarda no cache local (mesmo formato de _garantirProdutosCargasCarregados)
    // — o resto da bipagem desta carga (inclusive adicionarItemMontagemCarga)
    // já acha o produto sem precisar consultar de novo.
    if (achado.gtin) _cargasProdutosPorGtin.set(achado.gtin, { cod: achado.cod, nome: achado.nome });
    if (achado.cod) _cargasProdutosPorCod.set(achado.cod, { nome: achado.nome, gtin: achado.gtin });
    return achado;
  } catch (e) {
    console.warn('[Cargas] Falha na consulta ao vivo de produto:', e && e.message ? e.message : e);
    return null;
  }
}

// Chamado só quando _buscarProdutoPorCodigo() já retornou null, pra
// explicar o motivo real (catálogo geral ainda não carregou / código
// ambíguo / código genuinamente não cadastrado em lugar nenhum) em vez de
// deixar o operador chutando o que fazer.
function _explicarProdutoNaoEncontrado(codigoDigitado) {
  const codigo = String(codigoDigitado || '').trim();
  if (!codigo) return '';
  if (typeof window === 'undefined' || !window.DTProdutos || typeof window.DTProdutos.buscarSync !== 'function') {
    return 'Produto não encontrado — confira o código/GTIN.';
  }
  const cacheDT = window.DTProdutos.cache;
  if (!cacheDT || !cacheDT.carregado || !cacheDT.lista || !cacheDT.lista.length) {
    return 'Catálogo geral de produtos ainda não carregou neste aparelho — abra a tela de Produtos uma vez ou aguarde alguns segundos e bipe de novo.';
  }
  const achado = window.DTProdutos.buscarSync(codigo);
  if (achado && achado.ambiguo) {
    return 'Esse código está cadastrado em mais de um produto na Base de Produtos — corrija o cadastro antes de bipar.';
  }
  return 'Produto não encontrado — esse código não está cadastrado nem na Base de Produtos nem na Produção (PCP).';
}

async function abrirMontagemCarga(cargaId) {
  let carga = CARGAS_CACHE.find(function (c) { return c._id === cargaId; });
  if (!carga) {
    // Cache pode estar vazio (deep-link direto pra montagem, sem passar
    // antes pela lista) — busca o doc direto antes de desistir.
    try {
      const doc = await FS.collection(COL_CARGAS).doc(cargaId).get();
      if (doc && doc.exists) {
        carga = Object.assign({ _id: cargaId }, doc.data());
        CARGAS_CACHE.push(carga);
      }
    } catch (e) {
      console.warn('[Cargas] Falha ao buscar carga:', e && e.message ? e.message : e);
    }
  }
  if (!carga) { toast('Carga não encontrada.', 'e'); return; }
  _cargaAtualId = cargaId;
  const resumo = document.getElementById('carga-montagem-resumo');
  if (resumo) resumo.textContent = (carga.nomeCarga || '—') + ' → ' + (carga.destinoNome || '—');
  // PEDIDO AO VIVO (2026-09-08): "quando o operador abrir uma carga que
  // possui uma capa-palete com erro, mostrar claramente que existe uma
  // pendência" — uma carga pode ganhar pendência de capa AINDA em
  // montagem (o Analista marca a qualquer momento), não só depois de
  // expedida — por isso o mesmo banner aparece nas duas telas.
  _desenharBannerPendenciaCarga(carga, 'carga-montagem-pendencia');
  const capa = document.getElementById('carga-montagem-capa'); if (capa) capa.value = '';
  const codigo = document.getElementById('carga-montagem-produto-codigo'); if (codigo) codigo.value = '';
  const nomeProduto = document.getElementById('carga-montagem-produto-nome');
  const qtd = document.getElementById('carga-montagem-quantidade'); if (qtd) qtd.value = '';
  const status = document.getElementById('carga-montagem-status'); if (status) status.textContent = '';
  // BUG AO VIVO REAL (2026-09-04): "na hora de montar uma carga não tá
  // reconhecendo o produto bipado" — a tela ficava interativa (goScreen)
  // ANTES do cache de produtos terminar de carregar; um operador rápido
  // conseguia bipar o primeiro produto antes do Map estar pronto e via
  // "não encontrado" mesmo com o código certo. Mesmo bug já visto antes
  // nesta sessão com o cache de motoristas de Paletes (abrirNovaSaidaPaletes,
  // 25-recebimento-paletes.js) — mesma correção: avisa "carregando" e só
  // libera o campo depois que o cache realmente chegou.
  const produtosJaCarregados = _cargasProdutosPorCod.size > 0 || _cargasProdutosPorGtin.size > 0;
  if (nomeProduto) nomeProduto.textContent = produtosJaCarregados ? '' : 'Carregando catálogo de produtos...';
  goScreen('carga-montagem');
  await _carregarItensCarga(cargaId);
  _desenharItensCarga();
  await _garantirProdutosCargasCarregados();
  if (nomeProduto && !produtosJaCarregados) nomeProduto.textContent = '';
}

async function _carregarItensCarga(cargaId) {
  try {
    const snap = await FS.collection(COL_CARGAS).doc(cargaId).collection('itens').get();
    _cargaItensCache = snap.docs.map(function (d) { return Object.assign({ _id: d.id }, d.data()); });
  } catch (e) {
    _cargaItensCache = [];
    console.warn('[Cargas] Falha ao carregar itens:', e && e.message ? e.message : e);
  }
}

// Reaproveitado pelas duas telas que mostram itens (Montagem, ainda
// editável, e Detalhe, só leitura + correção de capa) — mesmo template de
// card, cada tela só decide EM QUAL container jogar o HTML. Mesma
// coloração vermelho/amarelo do Analista (104-recebimento-cargas-cards.js)
// pra capa pendente/corrigida.
function _itensCargaHtml() {
  if (!_cargaItensCache.length) {
    return '<div style="text-align:center;padding:12px;color:#5a7a9a;font-size:.8rem">Nenhum item bipado ainda.</div>';
  }
  return _cargaItensCache.map(function (it) {
    const estilo = it.bluesoftPendente ? 'border-left:3px solid var(--danger)'
      : it.bluesoftCorrigido ? 'border-left:3px solid var(--warn)' : '';
    const botaoCorrigir = it.bluesoftPendente
      ? '<button type="button" data-corrigir-capa="' + _escRec(it._id) + '" style="margin-top:6px;padding:8px 12px;border:1px solid var(--danger);border-radius:8px;background:transparent;color:var(--danger);font-weight:700;font-size:.78rem;cursor:pointer">CORRIGIR CAPA</button>'
      : '';
    return '<div class="inv-card" style="' + estilo + '">'
      + '<div class="inv-card-code">Capa ' + _escRec(it.capa) + '</div>'
      + '<div class="inv-card-name">' + _escRec(it.nomeProduto || it.codigoProduto || '—') + '</div>'
      + '<div class="inv-card-meta"><span class="badge badge-info">Qtd: ' + _escRec(it.quantidade) + '</span></div>'
      + botaoCorrigir
      + '</div>';
  }).join('');
}
// Sanitizador global do app remove `onclick=""` de HTML jogado via
// innerHTML (mesmo motivo de todo o resto do Coletor) — o botão "CORRIGIR
// CAPA" precisa de addEventListener depois de desenhado, nunca inline.
function _religarBotoesCorrigirCapa(lista) {
  if (!lista) return;
  Array.prototype.forEach.call(lista.querySelectorAll('[data-corrigir-capa]'), function (btn) {
    btn.addEventListener('click', function () { _corrigirCapaBluesoft(btn.getAttribute('data-corrigir-capa')); });
  });
}
function _desenharItensCarga() {
  const lista = document.getElementById('carga-montagem-lista-itens');
  if (lista) { lista.innerHTML = _itensCargaHtml(); _religarBotoesCorrigirCapa(lista); }
}
function _desenharItensDetalheCarga() {
  const lista = document.getElementById('carga-detalhe-itens');
  if (lista) { lista.innerHTML = _itensCargaHtml(); _religarBotoesCorrigirCapa(lista); }
}

// PEDIDO AO VIVO (2026-09-08): "bipei capa palete já pula para produto,
// bipar produto já pula para quantidade" — um leitor de código de barras
// funciona como teclado (digita os caracteres e manda um Enter no final,
// sozinho, sem o operador tocar em nada) — ouvir o Enter é exatamente
// "reagir ao bipe". `onkeydown` inline (mesmo padrão já usado no
// `oninput` do campo de produto, linha do HTML) — reatribuir o atributo
// toda vez que a tela abre nunca acumula listener duplicado, diferente de
// `addEventListener` num campo estático que sobrevive a várias visitas à
// mesma tela.
function _avancarAoEnterMontagem(event, idProximoCampo) {
  if (!event || event.key !== 'Enter') return true;
  event.preventDefault();
  const atual = event.target;
  if (!atual || !String(atual.value || '').trim()) return false;
  const proximo = document.getElementById(idProximoCampo);
  if (proximo) proximo.focus();
  return false;
}
window._avancarAoEnterMontagem = _avancarAoEnterMontagem;

// Lookup de produto disparado ao sair do campo de código/GTIN (mesmo
// padrão de outras telas do Coletor: bipar preenche, só a quantidade e a
// confirmação exigem toque manual).
let _debounceBuscaAoVivoMontagem = null;
function buscarProdutoMontagemCarga() {
  const elCodigo = document.getElementById('carga-montagem-produto-codigo');
  const elNome = document.getElementById('carga-montagem-produto-nome');
  const codigoDigitado = String(elCodigo ? elCodigo.value : '').trim();
  clearTimeout(_debounceBuscaAoVivoMontagem);
  if (!codigoDigitado) { if (elNome) elNome.textContent = ''; return; }
  const produto = _buscarProdutoPorCodigo(codigoDigitado);
  if (produto) { if (elNome) elNome.textContent = produto.nome; return; }
  // PEDIDO AO VIVO (2026-09-08): "o produto às vezes demora pra carregar"
  // — antes, "catálogo vazio" só olhava os mapas de reforço da PCP
  // (_cargasProdutosPorCod/Gtin), então mostrava "Carregando..." mesmo
  // quando a Base de Produtos do Inventário (window.DTProdutos) já tinha
  // terminado de baixar — a mensagem errada escondia um "não encontrado"
  // de verdade. Agora só considera "catálogo vazio" quando NENHUMA das
  // duas fontes carregou ainda.
  const catalogoDTCarregado = typeof window !== 'undefined' && window.DTProdutos && window.DTProdutos.cache && window.DTProdutos.cache.carregado;
  const catalogoVazio = !_cargasProdutosPorCod.size && !_cargasProdutosPorGtin.size && !catalogoDTCarregado;
  if (elNome) elNome.textContent = catalogoVazio ? 'Catálogo ainda não baixou neste aparelho — consultando direto no servidor...' : _explicarProdutoNaoEncontrado(codigoDigitado);
  // Sem achar no catálogo local, consulta ao vivo (debounce curto — um
  // bipe inteiro chega quase instantâneo, então isso raramente atrasa de
  // verdade a exibição, e evita 1 leitura por tecla digitada à mão).
  _debounceBuscaAoVivoMontagem = setTimeout(function () {
    if (!elCodigo || elCodigo.value.trim() !== codigoDigitado) return;
    _buscarProdutoAoVivo(codigoDigitado).then(function (achado) {
      if (!achado) return;
      if (!elCodigo || elCodigo.value.trim() !== codigoDigitado) return; // valor mudou enquanto buscava
      if (elNome) elNome.textContent = achado.nome;
    });
  }, 200);
}

async function adicionarItemMontagemCarga() {
  const status = document.getElementById('carga-montagem-status');
  if (!_cargaAtualId) { if (status) status.textContent = 'Carga não encontrada — volte e tente de novo.'; return; }
  const elCapa = document.getElementById('carga-montagem-capa');
  const elCodigo = document.getElementById('carga-montagem-produto-codigo');
  const elQtd = document.getElementById('carga-montagem-quantidade');
  const capa = (elCapa ? elCapa.value : '').trim();
  const codigoDigitado = (elCodigo ? elCodigo.value : '').trim();
  const quantidade = Number(elQtd ? elQtd.value : '');
  if (!capa) { if (status) status.textContent = 'Bipe a capa do palete.'; return; }
  if (_cargaItensCache.some(function (it) { return String(it.capa) === capa; })) {
    if (status) status.textContent = 'Essa capa já foi bipada nesta carga.';
    return;
  }
  // Defensivo (mesmo bug ao vivo real do comentário em abrirMontagemCarga):
  // se o catálogo ainda não tinha carregado quando o operador bipou rápido
  // demais, garante de novo aqui — nunca decide "não encontrado" sem ter
  // certeza que o catálogo já chegou pelo menos uma vez.
  if (!_cargasProdutosPorCod.size && !_cargasProdutosPorGtin.size) {
    if (status) status.textContent = 'Carregando catálogo de produtos...';
    await _garantirProdutosCargasCarregados();
  }
  let produto = _buscarProdutoPorCodigo(codigoDigitado);
  // PEDIDO AO VIVO (2026-09-08): "o produto às vezes demora pra carregar
  // ... consultar na hora que bipar" — mesma garantia defensiva do
  // catálogo acima, agora pro caso em que o catálogo GERAL (window.
  // DTProdutos, baixado em chunks à parte, pode ser grande) ainda não
  // terminou: antes de desistir, consulta só o código bipado direto em
  // dt_produtos (a coleção-fonte de 1 doc por produto — ver
  // _buscarProdutoAoVivo), sem esperar a base inteira.
  if (!produto) {
    if (status) status.textContent = 'Consultando produto no servidor...';
    produto = await _buscarProdutoAoVivo(codigoDigitado);
  }
  if (!produto) { if (status) status.textContent = _explicarProdutoNaoEncontrado(codigoDigitado); return; }
  if (!Number.isFinite(quantidade) || quantidade <= 0) { if (status) status.textContent = 'Informe uma quantidade válida.'; return; }
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const payload = {
    capa: capa,
    codigoProduto: produto.cod,
    nomeProduto: produto.nome,
    quantidade: Math.round(quantidade),
    criadoEm: agora, criadoPor: autor
  };
  if (status) status.textContent = 'Salvando...';
  try {
    const ref = await FS.collection(COL_CARGAS).doc(_cargaAtualId).collection('itens').add(payload);
    _cargaItensCache.push(Object.assign({ _id: ref.id }, payload));
    _desenharItensCarga();
    if (elCapa) elCapa.value = '';
    if (elCodigo) elCodigo.value = '';
    const elNome = document.getElementById('carga-montagem-produto-nome'); if (elNome) elNome.textContent = '';
    if (elQtd) elQtd.value = '';
    if (status) status.textContent = 'Item adicionado! Bipe o próximo.';
    if (elCapa) elCapa.focus();
  } catch (e) {
    if (status) status.textContent = 'Erro ao salvar: ' + (e && e.message ? e.message : e);
  }
}

// ── Finalizar montagem (paletes físicos, sem tocar ledger) ──────────────
function abrirFinalizarMontagemCarga() {
  if (!_cargaAtualId) return;
  const qtd = document.getElementById('carga-finalizar-paletes'); if (qtd) qtd.value = '';
  const status = document.getElementById('carga-finalizar-status'); if (status) status.textContent = '';
  goScreen('carga-finalizar');
}

async function confirmarFinalizarMontagemCarga() {
  const status = document.getElementById('carga-finalizar-status');
  if (!_cargaAtualId) { if (status) status.textContent = 'Carga não encontrada — volte e tente de novo.'; return; }
  if (!_cargaItensCache.length) { if (status) status.textContent = 'Bipe pelo menos 1 item antes de finalizar.'; return; }
  const elQtd = document.getElementById('carga-finalizar-paletes');
  const valorDigitado = (elQtd ? elQtd.value : '').trim();
  const totalPaletesFisico = Number(valorDigitado);
  if (!valorDigitado || !Number.isFinite(totalPaletesFisico) || totalPaletesFisico <= 0) {
    if (status) status.textContent = 'Informe a quantidade física real de paletes.';
    return;
  }
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const totalVolumes = _cargaItensCache.reduce(function (soma, it) { return soma + (Number(it.quantidade) || 0); }, 0);
  const payload = {
    status: 'PENDENTE',
    totalPaletesFisico: Math.round(totalPaletesFisico),
    totalVolumes: totalVolumes,
    atualizadoEm: agora, atualizadoPor: autor
  };
  if (status) status.textContent = 'Salvando...';
  try {
    await FS.collection(COL_CARGAS).doc(_cargaAtualId).update(payload);
    const carga = CARGAS_CACHE.find(function (c) { return c._id === _cargaAtualId; });
    if (carga) Object.assign(carga, payload);
    toast('Montagem finalizada! Carga pronta pra expedição.', 's');
    goScreen('cargas-lista');
    _desenharListaCargas();
  } catch (e) {
    if (status) status.textContent = 'Erro ao salvar: ' + (e && e.message ? e.message : e);
  }
}

// ── Expedição de carga (motorista/placa/NF → gera o transbordo de verdade) ──
async function _garantirMotoristasCargasCarregados() {
  if (CARGAS_MOTORISTAS_CACHE.length) return;
  try {
    const snap = await FS.collection(COL_CARGAS_MOTORISTAS).get();
    CARGAS_MOTORISTAS_CACHE = snap.docs.map(function (d) { return Object.assign({ _id: d.id }, d.data()); });
  } catch (e) {
    console.warn('[Cargas] Falha ao carregar motoristas:', e && e.message ? e.message : e);
  }
}
function _preencherSelectMotoristasCarga() {
  const sel = document.getElementById('carga-expedicao-motorista');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Selecionar —</option>' + CARGAS_MOTORISTAS_CACHE.map(function (m) {
    return '<option value="' + _escRec(m._id) + '">' + _escRec(m.nome) + '</option>';
  }).join('');
}

async function abrirExpedicaoCarga(cargaId) {
  let carga = CARGAS_CACHE.find(function (c) { return c._id === cargaId; });
  if (!carga) {
    try {
      const doc = await FS.collection(COL_CARGAS).doc(cargaId).get();
      if (doc && doc.exists) { carga = Object.assign({ _id: cargaId }, doc.data()); CARGAS_CACHE.push(carga); }
    } catch (e) { console.warn('[Cargas] Falha ao buscar carga:', e && e.message ? e.message : e); }
  }
  if (!carga) { toast('Carga não encontrada.', 'e'); return; }
  if (carga.status !== 'PENDENTE' || carga.temPendenciaCapa) {
    // Já expedida (EM_TRANSITO) ou além — não tem mais o que preencher
    // aqui; o avanço de status daqui pra frente é o bip normal do
    // Transbordo (22-recebimento.js), na loja de destino. Guarda defensiva
    // (o roteamento normal em abrirCargaPorId já não deixa chegar aqui) —
    // manda pra tela de detalhe em vez de só voltar com um toast. Mesma
    // guarda pra carga com capa pendente: precisa corrigir a capa antes
    // de expedir, não faz sentido pedir motorista/NF nesse meio tempo.
    abrirDetalheCarga(cargaId);
    return;
  }
  if (!carga.totalPaletesFisico) {
    toast('Finalize a montagem (quantidade física de paletes) antes de expedir.', 'w');
    abrirMontagemCarga(cargaId);
    return;
  }
  _cargaAtualId = cargaId;
  const resumo = document.getElementById('carga-expedicao-resumo');
  if (resumo) resumo.textContent = (carga.nomeCarga || '—') + ' → ' + (carga.destinoNome || '—') + ' · ' + (carga.totalPaletesFisico || 0) + ' palete(s)';
  const sel = document.getElementById('carga-expedicao-motorista');
  if (sel && !CARGAS_MOTORISTAS_CACHE.length) sel.innerHTML = '<option value="">Carregando motoristas...</option>';
  const status = document.getElementById('carga-expedicao-status'); if (status) status.textContent = '';
  goScreen('carga-expedicao');
  await _carregarItensCarga(cargaId);
  if (!_preencherNotasFiscaisDaVinculacao(carga)) _cargaNotasFiscaisEmEdicao = [{ numero: '', volumes: '' }];
  _desenharNotasProdutosDetalheCarga(carga, 'carga-expedicao-notas-produtos');
  await _garantirMotoristasCargasCarregados();
  _preencherSelectMotoristasCarga();
  _redesenharListaNfCarga(0);
}

// ── NF repetíveis (mesmo padrão de _notasFiscaisEmEdicao em 22-recebimento.js,
// cópia própria com DOM/estado isolados — nunca compartilhado entre telas) ──
function _sincronizarNotasFiscaisCargaDosCampos() {
  const lista = document.getElementById('carga-expedicao-nf-lista');
  if (!lista) return _cargaNotasFiscaisEmEdicao;
  const itens = [];
  Array.prototype.forEach.call(lista.querySelectorAll('[data-cnf-row]'), function (row) {
    const idx = Number(row.getAttribute('data-cnf-row'));
    const inputNumero = row.querySelector('[data-cnf-input]');
    const inputVolume = row.querySelector('[data-cnf-volume]');
    itens[idx] = {
      numero: String(inputNumero ? inputNumero.value : '').trim(),
      volumes: (inputVolume && inputVolume.value !== '') ? Number(inputVolume.value) : ''
    };
  });
  _cargaNotasFiscaisEmEdicao = itens.length ? itens : [{ numero: '', volumes: '' }];
  return _cargaNotasFiscaisEmEdicao;
}
function _redesenharListaNfCarga(focarIndice) {
  const lista = document.getElementById('carga-expedicao-nf-lista');
  if (!lista) return;
  if (!_cargaNotasFiscaisEmEdicao.length) _cargaNotasFiscaisEmEdicao = [{ numero: '', volumes: '' }];
  lista.innerHTML = _cargaNotasFiscaisEmEdicao.map(function (item, idx) {
    return '<div data-cnf-row="' + idx + '" style="display:grid;grid-template-columns:minmax(0,1.65fr) minmax(92px,.65fr) ' + (_cargaNotasFiscaisEmEdicao.length > 1 ? '38px' : '') + ';gap:7px;align-items:center;width:100%;margin-top:6px">'
      + '<input data-cnf-input="' + idx + '" class="field" autocomplete="off" inputmode="numeric" placeholder="Nota Fiscal' + (idx ? ' ' + (idx + 1) : '') + '" value="' + _escRec(item.numero) + '" style="min-width:0;font-size:1rem;padding:13px 10px;text-align:center;font-weight:700;box-sizing:border-box">'
      + '<input data-cnf-volume="' + idx + '" class="field" type="number" min="1" step="1" inputmode="numeric" placeholder="Volume" value="' + (item.volumes === '' ? '' : _escRec(item.volumes)) + '" style="min-width:0;font-size:.95rem;padding:13px 8px;text-align:center;font-weight:700;box-sizing:border-box">'
      + (_cargaNotasFiscaisEmEdicao.length > 1 ? '<button type="button" data-cnf-remover="' + idx + '" style="width:38px;height:46px;border:1px solid #3a5a7a;border-radius:9px;background:transparent;color:#ff6b6b;font-size:1.05rem;font-weight:800;cursor:pointer">×</button>' : '')
      + '</div>';
  }).join('');
  Array.prototype.forEach.call(lista.querySelectorAll('[data-cnf-input],[data-cnf-volume]'), function (input) {
    input.addEventListener('input', function () { _sincronizarNotasFiscaisCargaDosCampos(); });
  });
  Array.prototype.forEach.call(lista.querySelectorAll('[data-cnf-remover]'), function (btn) {
    btn.addEventListener('click', function () {
      _sincronizarNotasFiscaisCargaDosCampos();
      _cargaNotasFiscaisEmEdicao.splice(Number(btn.getAttribute('data-cnf-remover')), 1);
      if (!_cargaNotasFiscaisEmEdicao.length) _cargaNotasFiscaisEmEdicao = [{ numero: '', volumes: '' }];
      _redesenharListaNfCarga(Math.max(0, _cargaNotasFiscaisEmEdicao.length - 1));
    });
  });
}
function adicionarNotaFiscalCarga() {
  const status = document.getElementById('carga-expedicao-status');
  _sincronizarNotasFiscaisCargaDosCampos();
  const preenchidas = _cargaNotasFiscaisEmEdicao.map(function (v) { return String(v.numero || '').trim(); }).filter(Boolean);
  if (new Set(preenchidas).size !== preenchidas.length) {
    if (status) status.textContent = 'Essa nota já foi adicionada.';
    return;
  }
  _cargaNotasFiscaisEmEdicao.push({ numero: '', volumes: '' });
  if (status) status.textContent = '';
  _redesenharListaNfCarga(_cargaNotasFiscaisEmEdicao.length - 1);
}

async function confirmarExpedicaoCarga() {
  const status = document.getElementById('carga-expedicao-status');
  const carga = CARGAS_CACHE.find(function (c) { return c._id === _cargaAtualId; });
  if (!carga) { if (status) status.textContent = 'Carga não encontrada — volte e tente de novo.'; return; }
  const elMotorista = document.getElementById('carga-expedicao-motorista');
  const motoristaId = elMotorista ? elMotorista.value : '';
  if (!motoristaId) { if (status) status.textContent = 'Selecione o motorista.'; return; }
  const motorista = CARGAS_MOTORISTAS_CACHE.find(function (m) { return m._id === motoristaId; });
  _sincronizarNotasFiscaisCargaDosCampos();
  const itensComNumero = _cargaNotasFiscaisEmEdicao.filter(function (v) { return String(v.numero || '').trim(); });
  const numeros = itensComNumero.map(function (v) { return String(v.numero).trim(); });
  if (!numeros.length) { if (status) status.textContent = 'Digite o número de pelo menos uma Nota Fiscal.'; return; }
  if (new Set(numeros).size !== numeros.length) { if (status) status.textContent = 'Há Nota Fiscal repetida. Remova a duplicada antes de confirmar.'; return; }
  const invalidos = itensComNumero.filter(function (v) { return !Number.isFinite(Number(v.volumes)) || Number(v.volumes) <= 0; });
  if (invalidos.length) { if (status) status.textContent = 'Informe um volume maior que zero para cada Nota Fiscal.'; return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { if (status) status.textContent = 'Sem conexão — expedir uma carga exige internet.'; return; }
  const notasFiscais = itensComNumero.map(function (v) { return { numero: String(v.numero).trim(), volumes: Math.round(Number(v.volumes)) }; });
  const destinoParceira = { id: carga.destinoLojaId, nome: carga.destinoNome };
  if (status) status.textContent = 'Expedindo...';
  try {
    const ref = await _criarTransbordoPorMotorista(motorista, destinoParceira, { cargaId: _cargaAtualId, notasFiscais: notasFiscais });
    if (!ref || !ref.id) { if (status) status.textContent = 'Erro ao expedir — tente de novo.'; return; }
    // recebimento_motoristas (ver comentário no COL_CARGAS_MOTORISTAS) não
    // guarda placa — quem resolve isso é _criarTransbordoPorMotorista, via
    // VEICULOS_CACHE (motoristaHabitualId). Em vez de duplicar essa lógica
    // aqui (e arriscar dessincronizar), relê o próprio transbordo recém-
    // criado — fonte única de verdade pra placa/transportadora.
    let placaExpedicao = '', transportadoraExpedicao = '';
    try {
      const transbordoSnap = await ref.get();
      const dadosTransbordo = transbordoSnap.exists ? (transbordoSnap.data() || {}) : {};
      placaExpedicao = dadosTransbordo.placa || '';
      transportadoraExpedicao = dadosTransbordo.transportadora || '';
    } catch (e) {
      console.warn('[Cargas] Falha ao reler placa do transbordo recém-criado:', e && e.message ? e.message : e);
    }
    const agora = new Date().toISOString();
    const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
    const lojaId = carga.origemLojaId || _lojaAtivaRec();
    const payload = {
      status: 'EM_TRANSITO',
      motoristaId: motoristaId,
      motoristaNome: (motorista && motorista.nome) || '',
      placa: placaExpedicao,
      transportadora: transportadoraExpedicao,
      notasFiscais: notasFiscais,
      recebimentoId: ref.id,
      expedidoEm: agora, expedidoPor: autor,
      atualizadoEm: agora, atualizadoPor: autor
    };
    await FS.collection(COL_CARGAS).doc(_cargaAtualId).update(payload);
    Object.assign(carga, payload);
    // Ledger DEPOIS do registro principal já salvo — mesma disciplina de
    // 25-recebimento-paletes.js (uma falha aqui não pode travar a
    // expedição, que já aconteceu de verdade; log de movimentos permite
    // reconciliar depois).
    let falhaLedger = false;
    try {
      const totalPaletes = Math.round(Number(carga.totalPaletesFisico) || 0);
      // PEDIDO AO VIVO (2026-09-08): "se o palete tiver em trânsito ele tem
      // que tá com o número na loja de destino, não da loja que tá saindo"
      // — o palete some do Disponível de quem EXPEDIU (origem), mas o
      // "Em Trânsito" precisa aparecer na linha de quem vai RECEBER
      // (destino), não mais na origem.
      const referenciaLedger = { colecao: COL_CARGAS, id: _cargaAtualId };
      await Promise.all([
        _aplicarMovimentoLedger(lojaId, 'TRANSBORDO_EXPEDICAO', { disponivelDelta: -totalPaletes }, referenciaLedger),
        _aplicarMovimentoLedger(carga.destinoLojaId, 'TRANSBORDO_EXPEDICAO', { emTransitoDelta: totalPaletes }, referenciaLedger)
      ]);
    } catch (eLedger) {
      // PEDIDO AO VIVO (2026-09-18): "Controle de Paletes não captura os
      // paletes de uma carga em trânsito" — a carga em si sempre é expedida
      // certa (o payload principal já foi salvo antes desta tentativa), mas
      // até aqui uma falha no ledger só ia pro console (nunca visível pra
      // quem expediu) — os paletes ficavam "perdidos" sem nenhum aviso.
      // Isto não corrige a causa raiz (não reproduzida em código: o
      // roteamento já bloqueia expedir com totalPaletesFisico zerado) — só
      // torna a falha visível na hora, pra poder reconciliar manualmente e
      // ajudar a identificar a causa se acontecer de novo.
      console.warn('[Cargas] Falha ao atualizar ledger na expedição:', eLedger && eLedger.message ? eLedger.message : eLedger);
      falhaLedger = true;
    }
    if (falhaLedger) toast('Carga expedida, mas os paletes NÃO entraram no Controle de Paletes (avise o suporte).', 'e');
    else toast('Carga expedida!', 's');
    goScreen('cargas-lista');
    _desenharListaCargas();
  } catch (e) {
    if (status) status.textContent = 'Erro ao expedir: ' + (e && e.message ? e.message : e);
  }
}

// ── Detalhe da carga (EM_TRANSITO/RECEBIDA/CANCELADA) — só leitura do que
// o Analista já cadastrou (Passo 1: casco; NF-produtos e correção de capa
// entram nos próximos passos). ────────────────────────────────────────
const STATUS_LABEL_CARGA = { PENDENTE: 'Em montagem', EM_TRANSITO: 'Expedida', RECEBIDA: 'Recebida', CANCELADA: 'Cancelada' };

function _desenharNotasFiscaisDetalheCarga(carga) {
  const el = document.getElementById('carga-detalhe-nf');
  if (!el) return;
  const notas = (carga && carga.notasFiscais) || [];
  if (!notas.length) {
    el.innerHTML = '<div style="text-align:center;padding:10px;color:#5a7a9a;font-size:.8rem">Nenhuma nota fiscal registrada.</div>';
    return;
  }
  el.innerHTML = notas.map(function (n) {
    return '<div class="inv-card"><div class="inv-card-code">NF ' + _escRec(n.numero) + '</div>'
      + '<div class="inv-card-meta"><span class="badge badge-info">' + _escRec(n.volumes) + ' volume(s)</span></div></div>';
  }).join('');
}

// Mesmo padrão já usado em `_buscarProdutoPorCodigo` (comentário no topo
// do arquivo): cache/lógica PRÓPRIA deste arquivo, nunca compartilhada com
// 104-recebimento-cargas-cards.js — só o PADRÃO de agrupar por
// codigoProduto+nomeProduto é reaproveitado (evita somar embalagens
// diferentes do mesmo código numa linha só).
function _resumoPorProdutoCarga(itens) {
  const mapa = new Map();
  itens.forEach(function (it) {
    const chave = (it.codigoProduto || '—') + '|' + (it.nomeProduto || '—');
    const atual = mapa.get(chave) || { codigoProduto: it.codigoProduto || '', nomeProduto: it.nomeProduto || '—', quantidade: 0 };
    atual.quantidade += Number(it.quantidade) || 0;
    mapa.set(chave, atual);
  });
  return Array.from(mapa.values());
}

function _qtdPorChaveDoResumo() {
  const resumo = _resumoPorProdutoCarga(_cargaItensCache);
  const qtdPorChave = {};
  resumo.forEach(function (r) { qtdPorChave[(r.codigoProduto || '—') + '|' + (r.nomeProduto || '—')] = r.quantidade; });
  return qtdPorChave;
}

// PEDIDO AO VIVO (2026-09-08): "quando o operador abrir a carga, o sistema
// apresenta: Nota 123456 / produto — volumes" — lê `notasFiscaisProdutos`
// que o Analista já vinculou (104-recebimento-cargas-cards.js), sem o
// operador precisar digitar nota/produto/volume de novo. Quantidade
// sempre recalculada ao vivo (mesma regra do Analista — nunca guardada no
// vínculo em si). Reaproveitado nas duas telas que precisam mostrar isso
// (Detalhe E Expedição — ver comentário/BUG abaixo em abrirExpedicaoCarga).
function _desenharNotasProdutosDetalheCarga(carga, containerId) {
  const el = document.getElementById(containerId || 'carga-detalhe-notas-produtos');
  if (!el) return;
  const notas = ((carga && carga.notasFiscaisProdutos) || []).filter(function (n) { return n.produtos && n.produtos.length; });
  if (!notas.length) { el.innerHTML = ''; return; }
  const qtdPorChave = _qtdPorChaveDoResumo();
  const blocos = notas.map(function (n) {
    const linhas = n.produtos.map(function (p) {
      const chave = (p.codigoProduto || '—') + '|' + (p.nomeProduto || '—');
      const qtd = qtdPorChave.hasOwnProperty(chave) ? qtdPorChave[chave] : 0;
      return '<div class="inv-card"><div class="inv-card-name">' + _escRec(p.nomeProduto) + '</div>'
        + '<div class="inv-card-meta"><span class="badge badge-info">' + _escRec(qtd) + ' volume(s)</span></div></div>';
    }).join('');
    return '<div style="margin-top:6px"><div style="font-weight:700;font-size:.8rem;color:var(--muted,#5a7a9a);margin-bottom:2px">Nota ' + _escRec(n.numero) + '</div>' + linhas + '</div>';
  }).join('');
  el.innerHTML = '<label style="font-size:.78rem;color:var(--muted,#5a7a9a);font-weight:700;margin-top:8px;display:block">📎 Notas × Produtos</label>' + blocos;
}

// BUG AO VIVO REAL (2026-09-08): "vinculei pelo analista as notas nos
// produtos e não apareceu as notas para o operador" — a expedição
// (motorista+NF) sempre abria com o formulário de NF EM BRANCO, mesmo
// quando o Analista já tinha vinculado notas a produtos — o operador não
// tinha como ver nem reaproveitar isso, e ainda tinha que redigitar
// número+volume do zero (contrariando o pedido original de "o operador
// NÃO deve precisar digitar novamente"). Pré-preenche o formulário de NF
// (ainda editável, o operador pode corrigir/completar) com os números já
// vinculados e o volume recalculado ao vivo (soma dos produtos daquela
// nota). Retorna `true` quando havia algo pra pré-preencher.
function _preencherNotasFiscaisDaVinculacao(carga) {
  const notas = ((carga && carga.notasFiscaisProdutos) || []).filter(function (n) { return n.produtos && n.produtos.length; });
  if (!notas.length) return false;
  const qtdPorChave = _qtdPorChaveDoResumo();
  _cargaNotasFiscaisEmEdicao = notas.map(function (n) {
    const total = n.produtos.reduce(function (soma, p) {
      const chave = (p.codigoProduto || '—') + '|' + (p.nomeProduto || '—');
      return soma + (qtdPorChave.hasOwnProperty(chave) ? qtdPorChave[chave] : 0);
    }, 0);
    return { numero: n.numero, volumes: total };
  });
  return true;
}

// PEDIDO AO VIVO (2026-09-08): "quando o operador abrir uma carga que
// possui uma capa-palete com erro, mostrar claramente que existe uma
// pendência" — lido via `.get()` normal (a mesma carga já carregada), sem
// depender do listener em tempo real (esse cobre só o alerta cross-tela).
function _bannerPendenciaHtml(carga) {
  const pendencias = (carga && carga.pendenciasCapaAbertas) || [];
  if (!pendencias.length) return '';
  return '<div style="background:rgba(217,32,32,.12);border:1px solid var(--danger);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:.85rem;font-weight:700;color:var(--danger)">'
    + '⚠️ Esta carga tem ' + pendencias.length + ' capa(s) pendente(s) — corrija abaixo</div>';
}
function _desenharBannerPendenciaCarga(carga, containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = _bannerPendenciaHtml(carga);
}

// PEDIDO AO VIVO (2026-09-08): "selecionar a capa-palete que está errada,
// excluir/remover a capa-palete incorreta, informar o novo número da
// capa-palete, enviar a correção... o histórico da capa-palete antiga NÃO
// pode ser apagado" — o item continua o MESMO doc (mesmo _id), só o
// campo `capa` muda de valor de verdade; `bluesoftHistorico` guarda o
// registro completo (capa anterior/nova/quem/quando), nunca sobrescrito.
// Nunca mexe em `status` da carga — corrigir a capa só fecha a pendência.
function _corrigirCapaBluesoft(itemId) {
  const cargaId = _cargaAtualId;
  const carga = CARGAS_CACHE.find(function (c) { return c._id === cargaId; });
  const item = _cargaItensCache.filter(function (it) { return it._id === itemId; })[0];
  if (!carga || !item) { toast('Item não encontrado.', 'e'); return; }
  const capaAntiga = item.capa;
  // `_criarModal` fecha o modal ASSIM QUE qualquer botão é clicado, antes
  // de rodar `acao()` — por isso o input é lido pela referência capturada
  // aqui (o elemento continua acessível mesmo depois de removido do DOM),
  // nunca por um `document.getElementById` novo dentro de `acao` (que já
  // não acharia mais nada). Validação que falhar avisa por `toast()`, já
  // que o modal já fechou de qualquer jeito nesse momento.
  let elNova;
  _criarModal({
    icone: '🏷️',
    titulo: 'Corrigir capa-palete',
    corBorda: 'var(--danger)',
    corpo: '<div style="font-size:.85rem;color:var(--muted,#5a7a9a);margin-bottom:10px">Capa atual (errada): <b style="color:var(--text,#fff)">' + _escRec(capaAntiga) + '</b><br>Produto: ' + _escRec(item.nomeProduto || item.codigoProduto || '—') + '</div>'
      + '<div class="form-group"><label>Nova capa</label><input class="field" id="_corr_capa_nova" autocomplete="off" placeholder="Bipe ou digite a capa correta"></div>',
    botoes: [
      { label: 'Cancelar', estilo: 'ghost' },
      {
        label: 'Confirmar', estilo: 'primary', acao: function () {
          _confirmarCorrecaoCapa(cargaId, itemId, capaAntiga, elNova);
        }
      }
    ]
  });
  elNova = document.getElementById('_corr_capa_nova');
}

async function _confirmarCorrecaoCapa(cargaId, itemId, capaAntiga, elNova) {
  const novaCapa = (elNova ? elNova.value : '').trim();
  if (!novaCapa) { toast('Digite a nova capa.', 'e'); return; }
  if (novaCapa === capaAntiga) { toast('A nova capa precisa ser diferente da errada.', 'e'); return; }
  // Mesma checagem de duplicidade já usada em adicionarItemMontagemCarga —
  // não pode corrigir pra uma capa que já existe na mesma carga.
  if (_cargaItensCache.some(function (it) { return it._id !== itemId && String(it.capa) === novaCapa; })) {
    toast('Essa capa já existe nesta carga.', 'e');
    return;
  }
  const carga = CARGAS_CACHE.find(function (c) { return c._id === cargaId; });
  const item = _cargaItensCache.filter(function (it) { return it._id === itemId; })[0];
  if (!carga || !item) return;
  const agora = new Date().toISOString();
  const autor = (typeof APP !== 'undefined' && APP.operador && APP.operador.email) || '';
  const historicoNovo = (item.bluesoftHistorico || []).concat([{ capaAnterior: capaAntiga, capaNova: novaCapa, corrigidoPor: autor, corrigidoEm: agora }]);
  const patchItem = { capa: novaCapa, bluesoftPendente: false, bluesoftCorrigido: true, bluesoftHistorico: historicoNovo };
  const pendenciasRestantes = (carga.pendenciasCapaAbertas || []).filter(function (p) { return p.itemId !== itemId; });
  const patchCarga = { pendenciasCapaAbertas: pendenciasRestantes, temPendenciaCapa: pendenciasRestantes.length > 0 };
  try {
    const itemRef = FS.collection(COL_CARGAS).doc(cargaId).collection('itens').doc(itemId);
    const cargaRef = FS.collection(COL_CARGAS).doc(cargaId);
    const batch = FS.batch();
    batch.update(itemRef, patchItem);
    batch.update(cargaRef, patchCarga);
    await batch.commit();
    Object.assign(item, patchItem);
    Object.assign(carga, patchCarga);
    toast('Capa corrigida!', 's');
    // Redesenha qualquer uma das duas telas que estiver ativa (containers
    // que não existirem no DOM atual simplesmente não fazem nada).
    _desenharItensCarga();
    _desenharItensDetalheCarga();
    _desenharBannerPendenciaCarga(carga, 'carga-montagem-pendencia');
    _desenharBannerPendenciaCarga(carga, 'carga-detalhe-pendencia');
  } catch (e) {
    toast('Erro ao salvar: ' + (e && e.message ? e.message : e), 'e');
  }
}

// PEDIDO AO VIVO (2026-09-08): "essa notificação deve aparecer para o
// operador mesmo que ele esteja em outra tela/login... tempo real" — 1
// listener só, filtrado por `where('temPendenciaCapa','==',true)` numa
// coleção pequena, escopado à loja ATIVA (`FS` já auto-escopa — nunca é
// um listener "broadcast" pra qualquer loja/aparelho, mesmo espírito do
// que o app já reprova nos comentários de 02-sync-dispositivo.js sobre
// custo de leitura de listener sem filtro).
let _pendenciaListenerUnsub = null;
let _pendenciasCapaJaAlertadas = new Set();
let _filaAlertasPendencia = [];

function _reiniciarListenerPendenciasCarga() {
  if (_pendenciaListenerUnsub) { try { _pendenciaListenerUnsub(); } catch (e) { } _pendenciaListenerUnsub = null; }
  _pendenciasCapaJaAlertadas = new Set();
  _filaAlertasPendencia = [];
  if (typeof FS === 'undefined' || !FS || typeof FS.collection !== 'function') return;
  try {
    const query = FS.collection(COL_CARGAS).where('temPendenciaCapa', '==', true);
    if (!query || typeof query.onSnapshot !== 'function') return;
    _pendenciaListenerUnsub = query.onSnapshot(function (snap) {
      snap.docs.forEach(function (d) {
        const carga = Object.assign({ _id: d.id }, d.data());
        // BUG AO VIVO REAL (2026-09-08, VOLTOU): "clico em Corrigir e abre a
        // tela de expedir de novo" — o roteamento de abrirCargaPorId já
        // estava certo (rota pra abrirDetalheCarga quando temPendenciaCapa),
        // mas ele lê de CARGAS_CACHE, e este listener nunca atualizava esse
        // cache — só empilhava um objeto `carga` FRESCO à parte, na fila de
        // alerta. "CORRIGIR AGORA" chamava abrirCargaPorId(carga._id) só
        // com o ID; se a lista de cargas já tinha sido carregada ANTES do
        // Analista marcar a pendência (cenário comum: operador com o app
        // aberto na lista, Analista marca em outra sessão), CARGAS_CACHE
        // ainda tinha temPendenciaCapa:false/undefined — o roteamento via
        // pra Expedição por engano, usando dado velho. Atualiza o cache
        // aqui, na chegada de cada snapshot, pra abrirCargaPorId nunca mais
        // decidir com base num dado que já mudou.
        const idxCache = CARGAS_CACHE.findIndex(function (c) { return c._id === carga._id; });
        if (idxCache === -1) CARGAS_CACHE.push(carga);
        else CARGAS_CACHE[idxCache] = Object.assign({}, CARGAS_CACHE[idxCache], carga);
        (carga.pendenciasCapaAbertas || []).forEach(function (p) {
          const chave = carga._id + '|' + p.itemId;
          if (!_pendenciasCapaJaAlertadas.has(chave)) {
            _pendenciasCapaJaAlertadas.add(chave);
            _filaAlertasPendencia.push({ carga: carga, item: p });
          }
        });
      });
      _mostrarProximoAlertaPendenciaSeLivre();
    }, function (err) {
      console.warn('[Cargas] listener de pendência de capa:', err && err.message ? err.message : err);
    });
  } catch (e) {
    console.warn('[Cargas] Falha ao iniciar listener de pendência de capa:', e && e.message ? e.message : e);
  }
}

// `_criarModal` é singleton (sempre remove `#_modal_end_bloq` antes de
// criar outro) — a fila garante 1 card por vez, avançando quando o
// operador clica em qualquer um dos 2 botões (o próprio `_criarModal` já
// remove o modal ANTES de chamar `acao()`, então checar se ainda existe
// `#_modal_end_bloq` no DOM basta pra saber se está "livre").
function _mostrarProximoAlertaPendenciaSeLivre() {
  if (!_filaAlertasPendencia.length) return;
  if (typeof document === 'undefined' || document.getElementById('_modal_end_bloq')) return;
  const proximo = _filaAlertasPendencia.shift();
  _mostrarAlertaPendenciaCapa(proximo.carga, proximo.item);
}

function _mostrarAlertaPendenciaCapa(carga, item) {
  _criarModal({
    icone: '⚠️',
    titulo: 'ATENÇÃO — CAPA-PALETE COM ERRO',
    corBorda: 'var(--danger)',
    corpo: '<div style="font-size:.85rem;text-align:center">'
      + '<div>Capa-palete: <b>' + _escRec(item.capa) + '</b></div>'
      + '<div>Produto: ' + _escRec(item.nomeProduto || '—') + '</div>'
      + '<div style="margin-top:6px;color:var(--muted,#5a7a9a);font-size:.78rem">Carga: ' + _escRec(carga.nomeCarga || '—') + '</div>'
      + '</div>',
    botoes: [
      // FECHAR só esconde o card — a pendência continua no Firestore até
      // ser corrigida de verdade (não escreve nada aqui).
      { label: 'FECHAR', estilo: 'ghost', acao: function () { _mostrarProximoAlertaPendenciaSeLivre(); } },
      { label: 'CORRIGIR AGORA', estilo: 'primary', acao: function () { abrirCargaPorId(carga._id); _mostrarProximoAlertaPendenciaSeLivre(); } }
    ]
  });
}

async function abrirDetalheCarga(cargaId) {
  let carga = CARGAS_CACHE.find(function (c) { return c._id === cargaId; });
  if (!carga) {
    try {
      const doc = await FS.collection(COL_CARGAS).doc(cargaId).get();
      if (doc && doc.exists) { carga = Object.assign({ _id: cargaId }, doc.data()); CARGAS_CACHE.push(carga); }
    } catch (e) { console.warn('[Cargas] Falha ao buscar carga:', e && e.message ? e.message : e); }
  }
  if (!carga) { toast('Carga não encontrada.', 'e'); return; }
  _cargaAtualId = cargaId;
  const resumo = document.getElementById('carga-detalhe-resumo');
  if (resumo) resumo.textContent = (carga.nomeCarga || '—') + ' → ' + (carga.destinoNome || '—') + ' · ' + (STATUS_LABEL_CARGA[carga.status] || carga.status);
  goScreen('carga-detalhe');
  _desenharBannerPendenciaCarga(carga, 'carga-detalhe-pendencia');
  _desenharNotasFiscaisDetalheCarga(carga);
  await _carregarItensCarga(cargaId);
  _desenharItensDetalheCarga();
  _desenharNotasProdutosDetalheCarga(carga);
}

window.abrirNovaMovimentacaoRecebimento = abrirNovaMovimentacaoRecebimento;
window.abrirCargasRecebimento = abrirCargasRecebimento;
window.carregarCargasColetor = carregarCargasColetor;
window.abrirNovaCarga = abrirNovaCarga;
window.confirmarNovaCarga = confirmarNovaCarga;
window.abrirMontagemCarga = abrirMontagemCarga;
window.buscarProdutoMontagemCarga = buscarProdutoMontagemCarga;
window.adicionarItemMontagemCarga = adicionarItemMontagemCarga;
window.abrirFinalizarMontagemCarga = abrirFinalizarMontagemCarga;
window.confirmarFinalizarMontagemCarga = confirmarFinalizarMontagemCarga;
window.abrirExpedicaoCarga = abrirExpedicaoCarga;
window.adicionarNotaFiscalCarga = adicionarNotaFiscalCarga;
window.confirmarExpedicaoCarga = confirmarExpedicaoCarga;
window.imprimirDocumentosCarga = imprimirDocumentosCarga;
window.abrirCargaPorId = abrirCargaPorId;
window.abrirDetalheCarga = abrirDetalheCarga;
window._recebimentoCargasInternals = {
  getCargas: function () { return CARGAS_CACHE; },
  getItensCarga: function () { return _cargaItensCache; },
  getCargaAtualId: function () { return _cargaAtualId; },
  getMotoristas: function () { return CARGAS_MOTORISTAS_CACHE; },
  corrigirCapaBluesoft: _corrigirCapaBluesoft,
  confirmarCorrecaoCapa: _confirmarCorrecaoCapa,
  reiniciarListenerPendenciasCarga: _reiniciarListenerPendenciasCarga,
  getFilaAlertasPendencia: function () { return _filaAlertasPendencia; },
  getPendenciasCapaJaAlertadas: function () { return _pendenciasCapaJaAlertadas; }
};
