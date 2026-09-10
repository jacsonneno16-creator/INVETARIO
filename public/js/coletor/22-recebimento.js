// ═══════════════════════════════════════════════════
//  RECEBIMENTO — Transbordo (fase 15/FASE 4)
//  Reaproveita a MESMA coleção `recebimentos`/`recebimento_identificadores`
//  que o Analista já usa (90-95-recebimento-*.js) — mesma máquina de
//  estados. coletor.html não carrega o bundle do Analista (apps
//  separados), então a guarda é replicada aqui, mas com os MESMOS nomes de
//  status/campo, pra nunca divergir. Só Transbordo bipa pelo Coletor —
//  fornecedor comum continua sendo tratado pela nota fiscal/Analista.
// ═══════════════════════════════════════════════════

const COL_RECEBIMENTOS = 'recebimentos';
const COL_IDENTIFICADORES = 'recebimento_identificadores';
const COL_REC_AUDITORIA = 'recebimento_auditoria';
const COL_MOTORISTAS = 'recebimento_motoristas';
const COL_VEICULOS = 'recebimento_veiculos';
const COL_CONFIG_GERAL = 'recebimento_config_geral';
const COL_ROTAS = 'recebimento_rotas_transbordo';
const COL_OBSERVACOES_TRANSBORDO = 'recebimento_observacoes_transbordo';
const REC_STATUS_LABEL = {
  PREVISTO: 'Previsto',
  EM_TRANSITO: 'Em trânsito',
  CHEGOU: 'Chegou',
  AGUARDANDO_DOCA: 'Aguardando doca',
  EM_DESCARGA: 'Em descarga',
  DESCARGA_FINALIZADA: 'Descarga finalizada',
  EM_CONFERENCIA: 'Em conferência',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
  ATRASADO: 'Atrasado'
};
let RECEBIMENTOS_CACHE = [];
let IDENTIFICADORES_CACHE = [];
let MOTORISTAS_CACHE = [];
let VEICULOS_CACHE = [];
let CONFIG_GERAL_CACHE = {};
let ROTAS_CACHE = [];
let OBSERVACOES_TRANSBORDO_CACHE = [];
let _observacaoTransbordoSelecionada = null;
let _lojaNomeCache = '';
// PEDIDO AO VIVO (usuário: "quando a carga estiver em andamento, a pessoa
// poder colocar em qualquer etapa algum motivo, para justificar uma
// possível demora") — id da carga aguardando escolha de motivo pelo botão
// "📝 Motivo" de um card já em andamento (distinto do fluxo antigo, que só
// deixava escolher observação na tela de NF da SAÍDA). Quando este id está
// preenchido, o modal de seleção (o MESMO reaproveitado da saída) grava
// direto no registro em vez de alimentar a tela de NF.
let _cargaPendenteMotivoId = null;

// Auditoria pedida ao vivo ("verifica se o coletor separa realmente a loja
// quando você seleciona"): nenhum desses caches era limpo ao trocar de loja
// pelo menu (trocarLojaColetor, em 04-auth-login.js) — só `setDTLojaAtiva()`
// dispara o evento global 'dt-loja-alterada', mas nada aqui escutava. Na
// prática o próximo `carregarRecebimentoColetor()` (chamado de novo ao
// reabrir a tela de Recebimento) já SOBRESCREVE tudo com dados da loja
// nova — mas até isso acontecer, os dados antigos (de outra loja) ficavam
// em memória, e `_lojaNomeCache` (nome da loja pro campo "origem" do
// transbordo) nunca era limpo — se o operador trocasse de loja SEM recarregar
// a página, um novo transbordo criado na loja B ainda saía com "origem" da
// loja A. Limpa tudo no exato momento da troca, não só na próxima leitura.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('dt-loja-alterada', function () {
    RECEBIMENTOS_CACHE = [];
    IDENTIFICADORES_CACHE = [];
    MOTORISTAS_CACHE = [];
    VEICULOS_CACHE = [];
    CONFIG_GERAL_CACHE = {};
    ROTAS_CACHE = [];
    OBSERVACOES_TRANSBORDO_CACHE = [];
    _observacaoTransbordoSelecionada = null;
    _cargaPendenteMotivoId = null;
    _lojaNomeCache = '';
  });
}
function _escRec(v) {
  return String(v !== null && v !== void 0 ? v : '').replace(/[<>&]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;'
  })[c]);
}
function _fmtMinRec(m) {
  return m == null ? '—' : m >= 60 ? (m / 60).toFixed(1) + 'h' : Math.round(m) + 'min';
}
function _minutosEntreRec(iso1, iso2) {
  if (!iso1 || !iso2) return null;
  const diff = Math.round((new Date(iso2) - new Date(iso1)) / 60000);
  return isNaN(diff) ? null : diff;
}

// ── Transbordo entre lojas (fase 15/FASE 4h) ────────────────────────────
// Um transbordo nasce na loja de ORIGEM (quem bipa a saída) e é continuado
// pela loja de DESTINO (quem bipa a chegada) — Matriz e Filial são lojas
// (tenants) DIFERENTES neste sistema, então o doc do transbordo mora só na
// coleção da loja que o criou (`lojas/{lojaOrigem}/recebimentos`). Pra a
// loja de destino enxergar e continuar a MESMA carga, o Coletor cruza a
// leitura com as ROTAS cadastradas (coleção global `recebimento_rotas_
// transbordo`, {origemLojaId, destinoLojaId} — cadastrada uma vez só pelo
// Analista, nunca por loja) e, quando o registro é de lá, lê/escreve
// direto no caminho daquela loja (bypassando o FS "com prefixo
// automático", que só enxerga a loja ativa no aparelho). As regras do
// Firestore já permitem isso (canAccessStore/hasPermission dependem da
// CONTA do operador, não da loja selecionada no aparelho) — só precisa a
// conta ter acesso às duas lojas.
//
// Antes disso era config POR LOJA (precisava marcar dos dois lados) — bug
// ao vivo relatado: "gerei de uma loja mas não apareceu para a outra,
// gerando da outra já apareceu para a outra" (um lado esquecido de
// configurar). Uma rota global elimina essa assimetria: uma única entrada
// A→B já habilita os dois sentidos.
function _lojaAtivaRec() {
  return typeof getDTLojaAtiva === 'function' ? getDTLojaAtiva() : '';
}
function _refRecCrossLoja(lojaId, docId) {
  if (!lojaId || lojaId === _lojaAtivaRec()) return FS.collection(COL_RECEBIMENTOS).doc(docId);
  return getDTRawFirestore().collection('lojas').doc(lojaId).collection(COL_RECEBIMENTOS).doc(docId);
}
function _refAuditoriaCrossLoja(lojaId) {
  if (!lojaId || lojaId === _lojaAtivaRec()) return FS.collection(COL_REC_AUDITORIA);
  return getDTRawFirestore().collection('lojas').doc(lojaId).collection(COL_REC_AUDITORIA);
}
// Destinos possíveis a partir desta loja (rotas onde ela é a remetente) —
// usado tanto pra decidir se cria o transbordo automático (0 ou 1 destino)
// ou pergunta pro operador (2+), quanto pra preencher a tela de escolha.
function _destinosPossiveis() {
  return ROTAS_CACHE.filter(r => r.origemLojaId === _lojaAtivaRec()).map(r => ({
    id: r.destinoLojaId,
    nome: r.destinoNome || r.destinoLojaId
  }));
}
// Backstop pro cache de rotas desatualizado (bug ao vivo real: abrirScanRecebimento
// dispara o recarregamento de ROTAS_CACHE em segundo plano, SEM esperar —
// se o operador bipar rápido demais, ou a rede estiver lenta, o cache ainda
// está vazio nesse instante). Sem isso, `destinos.length===0` era
// interpretado como "esta loja não tem rota nenhuma cadastrada" e o
// transbordo era criado SEM destinoLojaId — o que desliga a proteção de
// posse (_lojaResponsavelAtual) PRA SEMPRE naquele registro, porque o campo
// nunca é preenchido depois. Confirmado com um documento real em produção
// (destinoLojaId: null, destino: "" apesar da rota existir cadastrada).
// Mesmo padrão já usado em _buscarMotoristaPorCodigoAoVivo pro mesmo motivo.
async function _destinosPossiveisAoVivo() {
  try {
    const snap = await FS.collection(COL_ROTAS).where('origemLojaId', '==', _lojaAtivaRec()).get();
    const rotas = snap.docs.map(d => ({
      _id: d.id,
      ...d.data()
    }));
    if (rotas.length) {
      // Alimenta o cache em memória também — bips seguintes na mesma sessão
      // não precisam repetir esta consulta.
      const idsJaConhecidos = new Set(ROTAS_CACHE.map(r => r._id));
      rotas.forEach(r => {
        if (!idsJaConhecidos.has(r._id)) ROTAS_CACHE.push(r);
      });
    }
    return rotas.map(r => ({
      id: r.destinoLojaId,
      nome: r.destinoNome || r.destinoLojaId
    }));
  } catch (e) {
    console.warn('[Recebimento] Falha ao buscar rotas de transbordo ao vivo:', (e === null || e === void 0 ? void 0 : e.message) || e);
    return [];
  }
}
// Origens a cruzar (rotas onde esta loja é o destino) — usado só pra saber
// quais outras lojas consultar em carregarRecebimentoColetor().
function _origensParaCruzar() {
  return ROTAS_CACHE.filter(r => r.destinoLojaId === _lojaAtivaRec()).map(r => ({
    id: r.origemLojaId,
    nome: r.origemNome || r.origemLojaId
  }));
}

// Navegação hierárquica (pedido ao vivo do usuário): "Recebimento" não deve
// mais entrar direto no Transbordo — abre uma tela de escolha
// (screen-recebimento-modo, mesmo padrão de screen-mode/Inventário) e só
// depois de escolher o módulo é que a funcionalidade real abre.
// abrirTransbordoRecebimento() é o corpo antigo de abrirAreaRecebimento(),
// agora acionado pelo card "Transbordo" daquela tela de escolha.
function abrirAreaRecebimento() {
  goScreen('recebimento-modo');
}
function abrirTransbordoRecebimento() {
  goScreen('recebimento');
  carregarRecebimentoColetor();
}

// Busca recebimentos + identificadores no Firestore. Offline (ou sem sinal
// ainda), cai pro espelho local salvo no último carregamento com sucesso —
// sem isso, um reload do app no meio de um turno sem internet ficaria com o
// hub vazio mesmo tendo cargas em andamento.
//
// Guardado contra chamadas concorrentes (bug ao vivo encontrado escrevendo
// o teste das 3 abas): _aplicarBipRecebimento chama isto sem esperar
// (fire-and-forget) logo depois de gravar um bip; se ALGO MAIS chamar
// carregarRecebimentoColetor() nesse meio tempo (reabrir a tela, sincronizar
// a fila), as duas chamadas rodavam em paralelo e podiam se entrelaçar —
// cada uma reseta RECEBIMENTOS_CACHE e depois faz `.concat(...)` com o
// resultado da leitura cross-loja; se uma terminar bem no meio da outra, o
// concat da mais lenta soma em cima do array que a mais rápida já tinha
// preenchido, duplicando cards na lista. Chamadas concorrentes agora
// esperam a MESMA leitura em vez de disparar leituras próprias.
let _cargaRecebimentoEmAndamento = null;
function carregarRecebimentoColetor() {
  if (_cargaRecebimentoEmAndamento) return _cargaRecebimentoEmAndamento;
  _cargaRecebimentoEmAndamento = _carregarRecebimentoColetorImpl().finally(() => {
    _cargaRecebimentoEmAndamento = null;
  });
  return _cargaRecebimentoEmAndamento;
}
async function _carregarRecebimentoColetorImpl() {
  const lista = document.getElementById('rec-lista-andamento');
  if (lista && !RECEBIMENTOS_CACHE.length) lista.innerHTML = '<div style="text-align:center;padding:20px;color:#5a7a9a">Carregando...</div>';
  try {
    const [snapRec, snapIdent, snapMot, snapVeic, snapGeral, snapRotas, snapObs] = await Promise.all([FS.collection(COL_RECEBIMENTOS).get(), FS.collection(COL_IDENTIFICADORES).get(), FS.collection(COL_MOTORISTAS).get(), FS.collection(COL_VEICULOS).get(), FS.collection(COL_CONFIG_GERAL).doc('padrao').get(), FS.collection(COL_ROTAS).get(), FS.collection(COL_OBSERVACOES_TRANSBORDO).get()]);
    const lojaAtiva = _lojaAtivaRec();
    RECEBIMENTOS_CACHE = snapRec.docs.map(d => ({
      _id: d.id,
      _lojaId: lojaAtiva,
      ...d.data()
    }));
    IDENTIFICADORES_CACHE = snapIdent.docs.map(d => ({
      _id: d.id,
      ...d.data()
    }));
    MOTORISTAS_CACHE = snapMot.docs.map(d => ({
      _id: d.id,
      ...d.data()
    }));
    VEICULOS_CACHE = snapVeic.docs.map(d => ({
      _id: d.id,
      ...d.data()
    }));
    CONFIG_GERAL_CACHE = snapGeral.exists ? snapGeral.data() || {} : {};
    ROTAS_CACHE = snapRotas.docs.map(d => ({
      _id: d.id,
      ...d.data()
    }));
    OBSERVACOES_TRANSBORDO_CACHE = snapObs.docs.map(d => ({
      _id: d.id,
      ...d.data()
    })).filter(x => x.ativa !== false).sort((a, b) => String(a.texto || '').localeCompare(String(b.texto || ''), 'pt-BR'));
    // Cruza com TODAS as origens que têm rota pra esta loja (fase 15/
    // FASE 4h) — só assim cada destino vê o transbordo que a origem
    // despachou pra ela. Nunca trava o carregamento por conta disso: sem
    // nenhuma rota configurada, ou se alguma consulta cross-loja falhar
    // (ex.: conta sem acesso àquela loja), o hub continua funcionando
    // normalmente com o que a loja ativa tem — as outras rotas seguem
    // tentando à parte.
    const origens = _origensParaCruzar();
    if (origens.length) {
      const resultados = await Promise.all(origens.map(async p => {
        try {
          // `.where('tipo','==','TRANSBORDO')` não é só otimização — é
          // exigido pela regra do Firestore. O `get()` cru (sem filtro)
          // pediria TODOS os recebimentos daquela loja (fornecedor incluso);
          // como a regra de leitura cross-loja só libera TRANSBORDO por
          // permissão (sem exigir acesso à loja em si), uma query sem esse
          // filtro falharia inteira com permission-denied — o Firestore nega
          // a consulta INTEIRA se algum documento que ela poderia retornar
          // falhasse a regra, mesmo que nenhum resultado real fosse um
          // fornecedor. Com o filtro, o Firestore consegue provar que só
          // documentos permitidos entrariam no resultado.
          const snapParc = await getDTRawFirestore().collection('lojas').doc(p.id).collection(COL_RECEBIMENTOS).where('tipo', '==', 'TRANSBORDO').get();
          return snapParc.docs.map(d => ({
            _id: d.id,
            _lojaId: p.id,
            ...d.data()
          }));
        } catch (e) {
          console.warn('[Recebimento] Falha ao buscar transbordos da loja parceira ' + p.id + ':', (e === null || e === void 0 ? void 0 : e.message) || e);
          return [];
        }
      }));
      resultados.forEach(recsParceira => {
        RECEBIMENTOS_CACHE = RECEBIMENTOS_CACHE.concat(recsParceira);
      });
    }
    if (typeof recCacheSave === 'function') recCacheSave(RECEBIMENTOS_CACHE);
    if (typeof recIdentCacheSave === 'function') recIdentCacheSave(IDENTIFICADORES_CACHE);
  } catch (e) {
    console.warn('[Recebimento] Falha ao carregar, usando espelho local:', (e === null || e === void 0 ? void 0 : e.message) || e);
    if (!RECEBIMENTOS_CACHE.length && typeof recCacheLoad === 'function') RECEBIMENTOS_CACHE = recCacheLoad();
    if (!IDENTIFICADORES_CACHE.length && typeof recIdentCacheLoad === 'function') IDENTIFICADORES_CACHE = recIdentCacheLoad();
    // Motoristas/veículos/padrão de destino só importam pra CRIAR um
    // transbordo novo a partir do bip — e isso já exige internet (ver
    // _resolverBipPorMotorista). Sem eles aqui, o bip cai pro fluxo antigo
    // de identificador por viagem, que continua funcionando igual.
  }
  if (typeof atualizarIndicadorPendenciasRecebimento === 'function') await atualizarIndicadorPendenciasRecebimento();else _desenharListaRecebimento();
  if (navigator.onLine && typeof sincronizarFilaRecebimento === 'function') sincronizarFilaRecebimento().catch(e => console.warn('[Recebimento] Falha ao sincronizar fila:', e));
}

// Dona operacional ATUAL de uma carga, segundo status (correção estrutural
// — antes disso só existia `_minhaVezDeAgir`, aplicada em pouquíssimos
// lugares; ver auditoria completa no plano). `r.origemLojaId` é o campo
// persistido (gravado a partir de agora em toda carga nova); `r._lojaId` é
// só o fallback pra cargas legadas sem esse campo (anotação client-side de
// qual coleção o doc foi lido, nunca um campo real do documento).
function _lojaResponsavelAtual(r) {
  const origem = r.origemLojaId || r._lojaId;
  // Sem loja de destino cruzada (fluxo antigo de trip-QR, transbordo criado
  // sem rota, ou carga legada sem os campos novos): a MESMA loja cuida do
  // processo do início ao fim — sem dono exclusivo, ninguém é bloqueado.
  if (!r.destinoLojaId) return null;
  // PREVISTO ainda não foi despachado — é turno de quem criou (origem). Da
  // etapa seguinte em diante (EM_TRANSITO+), quem despachou não tem mais
  // nada a fazer ali; passa a ser turno exclusivo da loja de destino.
  return r.status === 'PREVISTO' ? origem : r.destinoLojaId;
}

// "De quem é a vez" de agir numa carga — usado pra decidir o que aparece
// na lista "em andamento", pra achar a carga "ativa" de um motorista ao
// bipar o código dele de novo (_resolverBipPorMotorista), e (correção
// estrutural) por TODO ponto de entrada que abre/altera uma carga
// (abrirConfirmacaoParaRecebimento, voltarEtapaRecebimento,
// _aplicarBipRecebimento) — não só as listas. Sem essa 2ª aplicação
// original, um bug ao vivo aparecia: a Matriz despachava a carga A (virou
// EM_TRANSITO, agora é turno da Filial) e, ao bipar o MESMO motorista pra
// uma carga B nova, o sistema achava a carga A antiga como "ativa" e pedia
// a confirmação de NF dela de novo, em vez de criar a B — mesmo ela já não
// tendo mais nada a ver com a Matriz. E sem aplicar nos pontos de
// escrita/abertura direta por ID, a origem conseguia continuar agindo numa
// carga já despachada (clique num card em cache, código ainda físico na
// mão, "voltar etapa") mesmo já não sendo mais dela — a lista escondia o
// card, mas nada impedia agir por fora dela.
function _minhaVezDeAgir(r) {
  const responsavel = _lojaResponsavelAtual(r);
  return responsavel === null || responsavel === _lojaAtivaRec();
}
function _cargasEmAndamento() {
  // PREVISTO entra aqui também — é a carga que a Matriz ainda vai despachar
  // (bip de saída), não só as que já estão a caminho ou na Filial.
  // DESCARGA_FINALIZADA também precisa continuar aparecendo — falta o 5º
  // bip (conferência da nota, que fecha o processo); se sumisse da lista
  // aqui, o operador não teria como tocar o card pra dar esse último passo.
  return RECEBIMENTOS_CACHE.filter(r => r.tipo === 'TRANSBORDO' && ['PREVISTO', 'EM_TRANSITO', 'CHEGOU', 'AGUARDANDO_DOCA', 'EM_DESCARGA', 'DESCARGA_FINALIZADA'].includes(r.status)).filter(_minhaVezDeAgir).sort((a, b) => String(b.horaSaida || b.criadoEm || '').localeCompare(String(a.horaSaida || a.criadoEm || '')));
}

// ── 3 abas do hub de Recebimento (fase 15/FASE 4i, pedido ao vivo do
// usuário) — reaproveita _minhaVezDeAgir em cada aba, então o mesmo
// princípio "só aparece pra quem está com a bola" vale dentro de qualquer
// aba: a Matriz vê PREVISTO em "Em Trânsito" (falta despachar); depois de
// despachar (EM_TRANSITO), some da Matriz e passa a aparecer na aba "Em
// Trânsito" da FILIAL (carga a caminho, ainda não chegou); "Em Andamento"
// só mostra o que já chegou e está sendo processado NESTA loja; "Recebidas"
// mostra o que foi finalizado aqui.
const ABA_REC_STATUS = {
  transito: ['PREVISTO', 'EM_TRANSITO'],
  andamento: ['CHEGOU', 'AGUARDANDO_DOCA', 'EM_DESCARGA', 'DESCARGA_FINALIZADA'],
  recebidas: ['FINALIZADO']
};
// "Transbordos" (pedido ao vivo do usuário) — 4ª aba, só pra ORIGEM: depois
// que despacha, a carga sai de todas as outras abas (vira turno do
// destino) e o remetente perde qualquer jeito de ver o que ele mesmo
// gerou. Esta aba é histórico PURO, por data de geração — mostra status
// mas nunca abre pra ação nenhuma (o card não tem data-recid, então o
// clique-delegado de _desenharListaRecebimento nem tenta abrir nada; sem
// isso, um toque aqui reabriria uma carga que já não é mais desta loja).
// Não é filtrada por status nenhum (ao contrário das outras 3 abas) — é
// filtrada por QUEM gerou (origemLojaId) + QUANDO (dia local de criadoEm),
// pra não virar uma lista que só cresce pra sempre.
const ABA_REC_LABEL = {
  transito: '🚛 Em Trânsito',
  andamento: '📦 Em Andamento',
  recebidas: '✅ Recebidas',
  gerados: '📤 Transbordos'
};
const ABAS_REC_VALIDAS = ['transito', 'andamento', 'recebidas', 'gerados'];
// PEDIDO AO VIVO (usuário: "na parte de notas recebidas tem que ter a mesma
// função de data do recebimento para filtrar, para mostrar só o do dia") —
// "Recebidas" crescia pra sempre (todo FINALIZADO desde o início, sem
// filtro nenhum). Reaproveita o MESMO filtro de data + atalhos Hoje/Ontem
// que "Transbordos" já tinha (_dataFiltroGerados virou um mapa por aba,
// _dataFiltroPorAba, pra não duplicar a UI/lógica pras duas abas).
const ABAS_COM_FILTRO_DATA = ['gerados', 'recebidas'];
let _abaRecColetor = 'transito';
let _dataFiltroPorAba = {
  gerados: _dataLocalHoje(),
  recebidas: _dataLocalHoje()
};
function _dataLocalHoje() {
  return new Date().toLocaleDateString('en-CA');
} // 'en-CA' = YYYY-MM-DD, respeita fuso local (não corta o dia errado perto da meia-noite como um slice() em ISO UTC faria)
function _dataLocalDoTransbordo(r) {
  const iso = r.criadoEm || r.horaSaida || '';
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('en-CA') : '';
}
// Dia em que a carga foi efetivamente RECEBIDA (fechamento do processo) —
// usado só pela aba "Recebidas"; diferente de _dataLocalDoTransbordo
// (criação/saída), que é o que "Transbordos" usa.
function _dataLocalDoRecebimento(r) {
  const iso = r.horaFechamentoRecebimento || r.criadoEm || '';
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('en-CA') : '';
}
function _horaLocalDoTransbordo(r) {
  const iso = r.criadoEm || r.horaSaida || '';
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }) : '—';
}
function _cargasPorAba(aba) {
  return RECEBIMENTOS_CACHE.filter(r => r.tipo === 'TRANSBORDO' && (ABA_REC_STATUS[aba] || []).includes(r.status)).filter(r => aba !== 'recebidas' || _dataLocalDoRecebimento(r) === _dataFiltroPorAba.recebidas).filter(_minhaVezDeAgir).sort((a, b) => String(b.horaSaida || b.criadoEm || '').localeCompare(String(a.horaSaida || a.criadoEm || '')));
}
function _cargasGeradasPorMim(data) {
  const lojaAtiva = _lojaAtivaRec();
  return RECEBIMENTOS_CACHE.filter(r => r.tipo === 'TRANSBORDO' && (r.origemLojaId || r._lojaId) === lojaAtiva && _dataLocalDoTransbordo(r) === data).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
}
function _selecionarAbaRecebimento(aba) {
  if (ABAS_REC_VALIDAS.indexOf(aba) === -1) return;
  _abaRecColetor = aba;
  _desenharListaRecebimento();
}

// Genérico pras 2 abas com filtro de data (gerados/recebidas) — sempre
// mexe na aba ATUALMENTE ativa (_abaRecColetor), que é a única com o
// seletor de data visível na tela.
function _selecionarDataAbaAtiva(data) {
  if (!data || !ABAS_COM_FILTRO_DATA.includes(_abaRecColetor)) return;
  _dataFiltroPorAba[_abaRecColetor] = data;
  _desenharListaRecebimento();
}
// Bug ao vivo real: "fizemos transbordos ontem, fui olhar hoje sumiu tudo"
// — os dados nunca sumiram, a aba "Transbordos" sempre filtrou por UM dia
// só (_dataLocalHoje() no carregamento), e não tinha nenhum jeito rápido de
// voltar um dia sem digitar a data manualmente no seletor. Atalho
// "◀ Ontem" resolve o caso mais comum sem precisar entender que existe um
// filtro de data ali — mesmo atalho agora reaproveitado por "Recebidas".
function _dataOntem(baseISO) {
  const d = new Date(baseISO + 'T12:00:00'); // meio-dia local evita cair no dia errado por causa de fuso
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
}
function _selecionarDataAbaAtivaOntem() {
  _selecionarDataAbaAtiva(_dataOntem(_dataFiltroPorAba[_abaRecColetor] || _dataLocalHoje()));
}
function _selecionarDataAbaAtivaHoje() {
  _selecionarDataAbaAtiva(_dataLocalHoje());
}
function _desenharAbasRecebimento() {
  const abas = document.getElementById('rec-abas');
  if (!abas) return;
  abas.innerHTML = ABAS_REC_VALIDAS.map(aba => {
    const n = aba === 'gerados' ? _cargasGeradasPorMim(_dataFiltroPorAba.gerados).length : _cargasPorAba(aba).length;
    const ativa = aba === _abaRecColetor;
    return `<button type="button" data-rec-aba="${aba}" style="flex:1;min-width:90px;padding:8px 6px;font-size:.72rem;font-weight:700;border-radius:8px;border:1px solid ${ativa ? '#1e6f4e' : '#3a5a7a'};background:${ativa ? '#1e6f4e' : 'transparent'};color:${ativa ? '#fff' : '#8fb3d9'}">${ABA_REC_LABEL[aba]} (${n})</button>`;
  }).join('');
  Array.prototype.forEach.call(abas.querySelectorAll('[data-rec-aba]'), function (btn) {
    btn.addEventListener('click', function () {
      _selecionarAbaRecebimento(btn.getAttribute('data-rec-aba'));
    }, false);
  });
  // Mesmo par de elementos (fixos no HTML, fora de #rec-abas) reaproveitado
  // pelas 2 abas com filtro de data — troca só o VALOR mostrado/gravado
  // conforme qual aba está ativa (_dataFiltroPorAba[_abaRecColetor]).
  const filtraPorData = ABAS_COM_FILTRO_DATA.includes(_abaRecColetor);
  const dataAtiva = _dataFiltroPorAba[_abaRecColetor] || _dataLocalHoje();
  const inputData = document.getElementById('rec-gerados-data');
  if (inputData) {
    // Elemento fixo no HTML (fora de #rec-abas, que é reconstruído a cada
    // render) — o listener só precisa ser ligado uma vez; um dataset-flag
    // evita empilhar um novo a cada _desenharAbasRecebimento().
    if (!inputData.dataset.wired) {
      inputData.dataset.wired = '1';
      inputData.addEventListener('change', function () {
        _selecionarDataAbaAtiva(inputData.value);
      }, false);
    }
    inputData.style.display = filtraPorData ? '' : 'none';
    if (inputData.value !== dataAtiva) inputData.value = dataAtiva;
  }
  const atalhos = document.getElementById('rec-gerados-atalhos');
  if (atalhos) {
    if (!atalhos.dataset.wired) {
      atalhos.dataset.wired = '1';
      atalhos.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-rec-gerados-ontem]')) _selecionarDataAbaAtivaOntem();else if (ev.target.closest('[data-rec-gerados-hoje]')) _selecionarDataAbaAtivaHoje();
      }, false);
    }
    atalhos.style.display = filtraPorData ? 'flex' : 'none';
  }
}
function _desenharListaRecebimento() {
  const lista = document.getElementById('rec-lista-andamento');
  if (!lista) return;
  _desenharAbasRecebimento();
  const mapaPendentes = typeof PENDENTES_REC_MAP !== 'undefined' && PENDENTES_REC_MAP || {};
  const titulo = document.getElementById('rec-lista-titulo');
  if (titulo) {
    const nPend = Object.values(mapaPendentes).filter(p => p.status_sync === 'pendente').length;
    const nConf = Object.values(mapaPendentes).filter(p => p.status_sync === 'conflito').length;
    titulo.textContent = (ABA_REC_LABEL[_abaRecColetor] || 'CARGAS').toUpperCase() + (nPend ? ` · 🕓 ${nPend} não sincronizado(s)` : '') + (nConf ? ` · ⚠️ ${nConf} conflito(s)` : '');
  }
  const souAbaGerados = _abaRecColetor === 'gerados';
  const emAndamento = souAbaGerados ? _cargasGeradasPorMim(_dataFiltroPorAba.gerados) : _cargasPorAba(_abaRecColetor);
  if (!emAndamento.length) {
    const msgVazio = souAbaGerados ? 'Nenhum transbordo gerado nesta data.' : _abaRecColetor === 'recebidas' ? 'Nenhuma carga recebida nesta data.' : 'Nenhuma carga nesta aba agora.';
    lista.innerHTML = '<div style="text-align:center;padding:24px;color:#5a7a9a">' + msgVazio + '</div>';
    return;
  }
  // "Transbordos" (aba somente-leitura, ver comentário em ABA_REC_LABEL) —
  // cards SEM data-recid e SEM botão "Voltar etapa": nunca deve ser
  // possível agir por aqui, só ver o histórico do que esta loja gerou.
  if (souAbaGerados) {
    lista.innerHTML = emAndamento.map(r => `
    <div class="inv-card" style="cursor:default">
      <div class="inv-card-code">${_escRec(r.motoristaNome || r.identificadorCodigo || '—')}</div>
      <div class="inv-card-name">${_escRec(r.origem || '')} → ${_escRec(r.destino || '')}</div>
      <div class="inv-card-meta"><span class="badge badge-info">${_escRec(REC_STATUS_LABEL[r.status] || r.status)}</span> <span style="color:#5a7a9a;font-size:.72rem">gerado às ${_escRec(_horaLocalDoTransbordo(r))}</span></div>
      <div style="color:#5a7a9a;font-size:.72rem;margin-top:2px">🧾 NF: ${r.notaFiscalTransferencia ? _escRec(r.notaFiscalTransferencia) : '—'}</div>
    </div>`).join('');
    return;
  }
  lista.innerHTML = emAndamento.map(r => {
    const pend = mapaPendentes[r._id];
    const tagPend = !pend ? '' : pend.status_sync === 'conflito' ? ' <span class="badge" style="background:rgba(255,71,87,.15);color:var(--danger)">⚠️ conflito</span>' : ' <span class="badge badge-warn">🕓 não sincronizado</span>';
    const botaoVoltar = _VOLTAR_ETAPA[r.status] ? `<button type="button" data-recid-voltar="${_escRec(r._id)}" title="Corrigir bip errado, voltando pra etapa anterior" style="font-size:.75rem;padding:4px 10px;border-radius:8px;border:1px solid #3a5a7a;background:transparent;color:#8fb3d9">⏪ Voltar etapa</button>` : '';
    // PEDIDO AO VIVO: "colocar em qualquer etapa algum motivo, para
    // justificar uma possível demora" — disponível em toda carga ainda em
    // andamento (nunca em FINALIZADO/CANCELADO, que já fecharam o processo).
    const podeMotivo = r.status !== 'FINALIZADO' && r.status !== 'CANCELADO';
    const botaoMotivo = podeMotivo ? `<button type="button" data-recid-motivo="${_escRec(r._id)}" title="Registrar um motivo pra justificar demora nesta etapa" style="font-size:.75rem;padding:4px 10px;border-radius:8px;border:1px solid #7a5a1f;background:transparent;color:#ffb347">📝 ${r.observacao ? 'Trocar motivo' : 'Motivo'}</button>` : '';
    const acoesRow = botaoVoltar || botaoMotivo ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${botaoVoltar}${botaoMotivo}</div>` : '';
    const linhaNf = r.notaFiscalTransferencia ? `<div style="color:#5a7a9a;font-size:.72rem;margin-top:2px">🧾 NF: ${_escRec(r.notaFiscalTransferencia)}</div>` : '';
    const linhaMotivo = r.observacao ? `<div style="color:#ffb347;font-size:.72rem;margin-top:2px">📝 ${_escRec(r.observacao)}</div>` : '';
    return `
    <div class="inv-card" data-recid="${_escRec(r._id)}">
      <div class="inv-card-code">${_escRec(r.motoristaNome || r.identificadorCodigo || '—')}</div>
      <div class="inv-card-name">${_escRec(r.origem || '')} → ${_escRec(r.destino || '')}</div>
      <div class="inv-card-meta"><span class="badge badge-info">${_escRec(REC_STATUS_LABEL[r.status] || r.status)}</span>${tagPend}</div>
      ${linhaNf}
      ${linhaMotivo}
      ${acoesRow}
    </div>`;
  }).join('');
  // Liga o clique via addEventListener (não onclick inline) — o
  // sanitizador global de innerHTML (js/shared/common-utils.js) remove
  // qualquer atributo on* de HTML inserido dinamicamente como defesa
  // contra XSS, então onclick="..." aqui nunca disparava (sem erro
  // nenhum, só ficava mudo). Mesmo padrão já usado em
  // 05-inventarios-download.js/17-auditoria-meta.js pro mesmo motivo.
  Array.prototype.forEach.call(lista.querySelectorAll('.inv-card[data-recid]'), function (card) {
    card.addEventListener('click', _onCardRecebimentoClick, false);
  });
  // Botão "Voltar etapa" fica DENTRO do card (mesmo clique-delegado por
  // addEventListener, mesmo motivo) — precisa de stopPropagation, senão o
  // clique nele também dispararia o avanço normal do card por baixo.
  Array.prototype.forEach.call(lista.querySelectorAll('[data-recid-voltar]'), function (btn) {
    btn.addEventListener('click', _onBotaoVoltarEtapaClick, false);
  });
  // Mesmo padrão do "Voltar etapa" acima — delegado, dentro do card,
  // precisa de stopPropagation pra não disparar o avanço normal por baixo.
  Array.prototype.forEach.call(lista.querySelectorAll('[data-recid-motivo]'), function (btn) {
    btn.addEventListener('click', _onBotaoMotivoClick, false);
  });
}
function _onBotaoVoltarEtapaClick(event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const recebimentoId = btn && btn.getAttribute('data-recid-voltar');
  if (recebimentoId) voltarEtapaRecebimento(recebimentoId);
}
function _onBotaoMotivoClick(event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const recebimentoId = btn && btn.getAttribute('data-recid-motivo');
  if (recebimentoId) abrirSeletorMotivoEtapa(recebimentoId);
}
function _onCardRecebimentoClick(event) {
  const card = event && event.currentTarget ? event.currentTarget : this;
  const recebimentoId = card && card.getAttribute('data-recid');
  if (recebimentoId) abrirConfirmacaoParaRecebimento(recebimentoId);
}
function abrirScanRecebimento() {
  goScreen('recebimento-scan');
  const input = document.getElementById('rec-scan-input');
  const status = document.getElementById('rec-scan-status');
  if (status) status.textContent = '';
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 80);
  }
  // Atualiza motoristas/cargas em segundo plano toda vez que abre a tela de
  // bip — sem isso, um motorista cadastrado depois que o Coletor já tinha
  // carregado a tela (turno em andamento, app não reaberto) ficava "código
  // não encontrado" até fechar e abrir o app de novo (bug ao vivo
  // relatado). Não bloqueia o foco no campo — roda por trás.
  if (navigator.onLine) carregarRecebimentoColetor().catch(() => {});
}

// Resolve pelo cache em memória (populado por carregarRecebimentoColetor,
// que por sua vez cai pro espelho local quando offline) — nunca depende de
// uma consulta ao vivo, então funciona bipando offline também.
//
// Dois tipos de código coexistem (fase 15/FASE 4b — pedido ao vivo do
// usuário): o código FIXO por motorista (novo, permanente, reaproveitado em
// toda viagem — checado primeiro) e o código por-viagem antigo
// (`recebimento_identificadores`, ainda funciona pra quem criar um
// transbordo manualmente pela tela do Analista).
//
// Mesmo com o refresh em abrirScanRecebimento, ainda existe uma janela onde
// o cache local pode estar desatualizado (ex.: o operador já estava na tela
// de bip quando o motorista foi cadastrado). Por isso, antes de desistir e
// avisar "código não encontrado", confere direto no Firestore quando online
// — só nesse caso, sem custo nenhum quando o código já resolve pelo cache.
async function confirmarCodigoRecebimento() {
  const input = document.getElementById('rec-scan-input');
  const status = document.getElementById('rec-scan-status');
  const codigo = ((input === null || input === void 0 ? void 0 : input.value) || '').trim().toUpperCase();
  if (!codigo) {
    if (status) status.textContent = 'Digite ou bipe um código.';
    return;
  }
  let motorista = MOTORISTAS_CACHE.find(m => String(m.codigo || '').toUpperCase() === codigo);
  if (!motorista && navigator.onLine) motorista = await _buscarMotoristaPorCodigoAoVivo(codigo);
  if (motorista) {
    await _resolverBipPorMotorista(motorista);
    return;
  }
  const ident = IDENTIFICADORES_CACHE.find(i => String(i.codigo || '').toUpperCase() === codigo);
  if (!ident) {
    if (status) status.textContent = 'Código não encontrado.';
    return;
  }
  if (!ident.recebimentoId) {
    if (status) status.textContent = 'Este código ainda não está vinculado a uma carga.';
    return;
  }
  await abrirConfirmacaoParaRecebimento(ident.recebimentoId);
}

// Backstop pro cache desatualizado — busca direto no Firestore quando o
// código não resolve pelo MOTORISTAS_CACHE em memória. Alimenta o cache com
// o resultado (evita repetir a consulta se o mesmo código for bipado de
// novo na mesma sessão, ex.: retry depois de um erro).
async function _buscarMotoristaPorCodigoAoVivo(codigo) {
  try {
    const snap = await FS.collection(COL_MOTORISTAS).where('codigo', '==', codigo).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const motorista = {
      _id: doc.id,
      ...doc.data()
    };
    if (!MOTORISTAS_CACHE.some(m => m._id === motorista._id)) MOTORISTAS_CACHE.push(motorista);
    return motorista;
  } catch (e) {
    console.warn('[Recebimento] Falha ao buscar motorista ao vivo:', (e === null || e === void 0 ? void 0 : e.message) || e);
    return null;
  }
}

// Carga já em andamento pra esse motorista (bipou a saída, agora bipando de
// novo pra avançar chegada/descarga) → continua ela, igual sempre. Nenhuma
// em andamento → bipar de novo é começar uma viagem nova (mesmo código,
// reaproveitado — é assim que o QR fixo por motorista funciona).
async function _resolverBipPorMotorista(motorista) {
  // `_minhaVezDeAgir` entra aqui também (bug ao vivo: bipar o MESMO
  // motorista pra uma carga NOVA reabria a carga antiga já despachada, que
  // já não tinha mais nada a ver com esta loja, pedindo a NF dela de novo
  // em vez de criar a nova) — sem isso, uma carga que já virou turno da
  // outra loja continuava sendo achada como "ativa" aqui.
  const ativo = RECEBIMENTOS_CACHE.find(r => r.tipo === 'TRANSBORDO' && r.motoristaId === motorista._id && !['FINALIZADO', 'CANCELADO'].includes(r.status) && _minhaVezDeAgir(r));
  if (ativo) {
    await abrirConfirmacaoParaRecebimento(ativo._id);
    return;
  }
  if (!navigator.onLine) {
    // Criar peça nova offline exigiria gerar um id sem conflito e
    // reconciliar na volta da internet — a fila offline de hoje só sabe
    // ATUALIZAR uma carga que já existe (ver 23-recebimento-offline.js).
    // Continuar uma carga já em andamento (o caso comum de bipar offline)
    // segue funcionando normalmente pelo ramo acima.
    const status = document.getElementById('rec-scan-status');
    if (status) status.textContent = 'Sem internet — não é possível iniciar um novo transbordo agora. Tente de novo com conexão.';else toast('Sem internet — não é possível iniciar um novo transbordo agora.', 'e');
    return;
  }
  // Mais de uma rota de destino a partir desta loja — pergunta pra qual vai
  // essa viagem (pedido ao vivo do usuário: "colocar a opção de mais de um
  // destino"). Com 0 ou 1 rota, segue automático como sempre (sem esse
  // passo a mais pro operador).
  let destinos = _destinosPossiveis();
  // Cache vazio não é prova de "sem rota cadastrada" — confere direto no
  // Firestore antes de decidir (ver comentário em _destinosPossiveisAoVivo).
  if (!destinos.length) destinos = await _destinosPossiveisAoVivo();
  if (!destinos.length) {
    // NUNCA cria um transbordo sem destino silenciosamente — isso desliga a
    // proteção de posse pra sempre nesse registro (origem e destino
    // conseguiriam mexer nele o tempo todo, sem exclusividade nenhuma).
    const status = document.getElementById('rec-scan-status');
    const msg = 'Nenhuma rota de transbordo cadastrada saindo desta loja. Peça pro Analista cadastrar em Configurações de Recebimento → Rotas de Transbordo antes de continuar.';
    if (status) status.textContent = msg;else toast(msg, 'e');
    return;
  }
  if (destinos.length > 1) {
    _abrirEscolhaDestino(motorista, destinos);
    return;
  }
  await _criarTransbordoPorMotorista(motorista, destinos[0]);
}

// Tela de escolha de destino (só aparece quando a loja tem mais de um
// destino configurado) — guarda o motorista pendente até o operador tocar
// numa opção.
let _motoristaPendenteDestino = null;
function _abrirEscolhaDestino(motorista, parceiras) {
  _motoristaPendenteDestino = motorista;
  const lista = document.getElementById('rec-destino-lista');
  if (lista) {
    lista.innerHTML = parceiras.map(p => `<div class="inv-card" data-destino-id="${_escRec(p.id)}"><div class="inv-card-name">${_escRec(p.nome || p.id)}</div></div>`).join('');
    Array.prototype.forEach.call(lista.querySelectorAll('[data-destino-id]'), function (card) {
      card.addEventListener('click', function () {
        const lojaId = card.getAttribute('data-destino-id');
        const escolhida = parceiras.find(p => p.id === lojaId) || null;
        _confirmarEscolhaDestino(escolhida);
      });
    });
  }
  goScreen('recebimento-destino');
}
async function _confirmarEscolhaDestino(destino) {
  const motorista = _motoristaPendenteDestino;
  _motoristaPendenteDestino = null;
  if (!motorista) return;
  await _criarTransbordoPorMotorista(motorista, destino);
}
async function _obterNomeLojaAtiva() {
  if (_lojaNomeCache) return _lojaNomeCache;
  const lojaId = typeof getDTLojaAtiva === 'function' ? getDTLojaAtiva() : '';
  if (!lojaId) return '';
  try {
    var _doc$data;
    const raw = typeof getDTRawFirestore === 'function' ? getDTRawFirestore() : null;
    const doc = raw ? await raw.collection('lojas').doc(lojaId).get() : null;
    _lojaNomeCache = doc && doc.exists ? ((_doc$data = doc.data()) === null || _doc$data === void 0 ? void 0 : _doc$data.nome) || lojaId : lojaId;
  } catch (e) {
    _lojaNomeCache = lojaId;
  }
  return _lojaNomeCache;
}

// Bug ao vivo real (não suposição): sem timeout nem fila offline, um
// `.add()` feito sem internet fica PENDENTE pra sempre no SDK do Firestore
// (não rejeita, não resolve — o SDK só confirma a Promise quando o servidor
// realmente recebe a escrita, e sem `enablePersistence()` a fila do próprio
// SDK não sobrevive a fechar o app). Se o operador, achando o app travado,
// fechasse e reabrisse antes de a internet voltar, a criação simplesmente
// nunca tinha acontecido — sem NENHUM erro em lugar nenhum, porque a Promise
// nem chegou a rejeitar. Resultado exato do relato ao vivo: "fizemos
// transbordos ontem, fui olhar hoje sumiu tudo" — o card aparecia na hora
// (RECEBIMENTOS_CACHE.push otimista, só em memória) e desaparecia pra sempre
// no próximo carregamento, porque nunca existiu de verdade no servidor. Fila
// durável (MESMO padrão/store já usado pros bips em 23-recebimento-offline.js,
// que sobrevive a fechar o app) elimina essa janela de perda.
const CRIAR_TRANSBORDO_TIMEOUT_MS = 15000;
function _comTimeoutCriarTransbordo(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Tempo excedido ao conectar com o servidor.'), {
    code: 'timeout-criacao'
  })), ms))]);
}
// Cria o transbordo sozinho, a partir só do bip do código fixo do motorista
// — sem o Analista preencher formulário nenhum (pedido ao vivo do usuário).
// Origem = loja atual (onde o Coletor está bipando); destino = a loja
// escolhida (0 ou 1 destino configurado → automático; 2+ → operador escolhe
// em _abrirEscolhaDestino antes de chegar aqui); veículo = o cadastrado como
// "habitual" desse motorista, quando existir. Depois de criado, entra no
// MESMO fluxo de sempre (abrirConfirmacaoParaRecebimento), que já sabe que
// PREVISTO significa "próximo bip é a saída" e abre a tela de NF.
//
// Sem internet (ou conexão morta demais pro timeout acima), a criação NÃO
// tenta seguir otimista com um ID falso — isso obrigaria reconciliar depois
// qualquer bip que o operador desse em cima dele (saída, NF...), reabrindo a
// MESMA classe de risco que este fix existe pra fechar. Em vez disso: fica
// PENDENTE numa fila durável (sincronizada em segundo plano, mesmo padrão
// dos bips), e o operador só continua o fluxo (registrar saída/NF) quando a
// carga realmente existir no servidor — ou seja, com internet.
// `opcoes` (novo, 2026-09-04 — Expedição de Carga em 26-recebimento-cargas.js):
// {cargaId, notasFiscais:[{numero,volumes}]} — quando presente, o transbordo
// já nasce em EM_TRANSITO (não PREVISTO) com a(s) NF(s) já preenchidas, e a
// função RETORNA o `ref` criado em vez de navegar pra tela padrão de
// confirmação de NF (screen-recebimento-nf) — a Expedição de Carga já
// coletou motorista+NF no PRÓPRIO formulário, então não faz sentido pedir
// de novo. Sem `opcoes`, comportamento 100% igual ao de sempre (bip do QR
// fixo do motorista, cria PREVISTO, abre a tela de NF). LIMITAÇÃO
// CONHECIDA (aceita de propósito, mesmo espírito da decisão #1 do plano):
// só funciona ONLINE — expedir uma carga offline não teria como preencher
// `recebimentoId`/aplicar o ledger de forma consistente com a fila durável
// existente (essa fila só sabe criar TRANSBORDO "cru", não já com NF).
async function _criarTransbordoPorMotorista(motorista, destinoParceira, opcoes) {
  try {
    const origem = await _obterNomeLojaAtiva();
    const destino = destinoParceira ? destinoParceira.nome || destinoParceira.id : '';
    const veiculo = VEICULOS_CACHE.find(v => v.motoristaHabitualId === motorista._id);
    const agora = new Date().toISOString();
    const autor = typeof APP !== 'undefined' && APP.operador && APP.operador.email || '';
    const payload = {
      tipo: 'TRANSBORDO',
      status: 'PREVISTO',
      // origemLojaId gravado explicitamente (correção estrutural — antes só
      // destinoLojaId existia, e a origem era inferida pelo caminho do
      // documento, nunca um campo real) — usado por _lojaResponsavelAtual
      // pra decidir de quem é a vez sem depender de anotação client-side.
      origem,
      origemLojaId: _lojaAtivaRec(),
      destino,
      destinoLojaId: destinoParceira ? destinoParceira.id : null,
      motoristaId: motorista._id,
      motoristaNome: motorista.nome || '',
      veiculoId: (veiculo === null || veiculo === void 0 ? void 0 : veiculo._id) || '',
      placa: (veiculo === null || veiculo === void 0 ? void 0 : veiculo.placa) || '',
      transportadora: motorista.transportadora || (veiculo === null || veiculo === void 0 ? void 0 : veiculo.transportadora) || '',
      volumes: 0,
      responsavelEnvio: '',
      identificadorCodigo: motorista.codigo || '',
      observacao: '',
      responsavel: autor,
      criadoEm: agora,
      criadoPor: autor,
      atualizadoEm: agora,
      atualizadoPor: autor,
      // Precisam existir como `null` explícito, não só "ausentes" — o
      // firestore.rules trata campo ausente e campo null como coisas
      // diferentes (acessar um campo que nunca existiu no documento
      // derruba a regra inteira, negando a escrita — bug ao vivo relatado:
      // "erro de permissão" bem na hora de confirmar a NF da saída, porque
      // o guard de horaSaida/notaFiscalTransferencia esperava null e achava
      // um campo inexistente). Mesma causa-raiz do bug de notaFiscalKey
      // undefined corrigido antes hoje em 90-bluesoft-service.js.
      horaChegada: null,
      horaSaida: null,
      horaInicioDescarga: null,
      horaFimDescarga: null,
      horaFechamentoRecebimento: null,
      notaFiscalTransferencia: null,
      notasVolumesTransferencia: null,
      notaFiscalConfirmadaEm: null,
      notaFiscalConfirmadaPor: null
    };
    if (opcoes && opcoes.cargaId) {
      payload.cargaId = opcoes.cargaId;
      if (opcoes.notasFiscais && opcoes.notasFiscais.length) {
        const volumeTotal = opcoes.notasFiscais.reduce((s, x) => s + (Number(x.volumes) || 0), 0);
        payload.status = 'EM_TRANSITO';
        payload.horaSaida = agora;
        payload.notaFiscalTransferencia = opcoes.notasFiscais.map(x => x.numero).join(', ');
        payload.notasVolumesTransferencia = opcoes.notasFiscais;
        payload.volumes = volumeTotal;
      }
    }
    // Offline detectado ANTES de tentar — não faz sentido nem começar a
    // escrita, ela só ficaria pendurada sem erro nenhum até o timeout.
    // Expedição de Carga é ONLINE-ONLY (ver comentário na assinatura da
    // função) — não enfileira, falha de forma clara pro operador tentar de
    // novo com internet.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (opcoes && opcoes.cargaId) throw Object.assign(new Error('Sem conexão — expedir uma carga exige internet.'), { code: 'sem-conexao-expedicao-carga' });
      await _enfileirarCriacaoTransbordoPendente(payload);
      return;
    }
    let ref;
    try {
      ref = await _comTimeoutCriarTransbordo(FS.collection(COL_RECEBIMENTOS).add(payload), CRIAR_TRANSBORDO_TIMEOUT_MS);
    } catch (e) {
      // Erro de REDE/timeout (sem internet de verdade, ou conexão morta
      // demais pra responder a tempo) → fila durável, não perde o trabalho
      // do operador. Erro de PERMISSÃO ou outra recusa real do servidor
      // (chegou a responder) NÃO entra na fila — reenviar sozinho de novo
      // não vai resolver, e esconder isso numa fila silenciosa só adiaria
      // um erro que o operador precisa ver e corrigir agora.
      const semConexao = (e === null || e === void 0 ? void 0 : e.code) === 'timeout-criacao' || (e === null || e === void 0 ? void 0 : e.code) === 'unavailable' || typeof navigator !== 'undefined' && navigator.onLine === false;
      if (semConexao) {
        if (opcoes && opcoes.cargaId) throw Object.assign(new Error('Sem conexão — expedir uma carga exige internet.'), { code: 'sem-conexao-expedicao-carga' });
        await _enfileirarCriacaoTransbordoPendente(payload);
        return;
      }
      throw e;
    }
    RECEBIMENTOS_CACHE.push({
      _id: ref.id,
      _lojaId: _lojaAtivaRec(),
      ...payload
    });
    if (opcoes && opcoes.cargaId) return ref;
    await abrirConfirmacaoParaRecebimento(ref.id);
  } catch (e) {
    console.error('[Recebimento] Falha ao criar transbordo pelo bip do motorista:', e);
    if (typeof window.dtAddDiag === 'function') window.dtAddDiag('Falha ao criar transbordo: ' + ((e === null || e === void 0 ? void 0 : e.code) || 'sem código') + ' — ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
    if (opcoes && opcoes.cargaId) throw e; // Expedição de Carga trata o erro do próprio jeito (ver confirmarExpedicaoCarga)
    const traduzido = typeof window.traduzirErroPermissao === 'function' ? window.traduzirErroPermissao(e, {
      acao: 'criar um transbordo',
      canalNecessario: 'coletor'
    }) : null;
    toast(traduzido || 'Erro ao iniciar o transbordo: ' + ((e === null || e === void 0 ? void 0 : e.message) || e), 'e');
  }
}

// Guarda a criação na MESMA fila durável dos bips (recIdbPut/REC_IDB_STORE,
// definida em 01-core-firebase-cache.js — sobrevive a fechar o app,
// diferente do que o SDK do Firestore faz sozinho sem `enablePersistence()`).
// `operacao:'CRIAR_TRANSBORDO'` é distinto dos bips normais (que sempre têm
// um `recebimentoId` de um doc que já existe) — sincronizarFilaRecebimento
// (23-recebimento-offline.js) trata esse caso à parte, fazendo o `.add()`
// de verdade quando a conexão voltar.
async function _enfileirarCriacaoTransbordoPendente(payload) {
  const uuid = typeof gerarUUID === 'function' ? gerarUUID() : 'rec_criar_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  await recIdbPut({
    uuid,
    operacao: 'CRIAR_TRANSBORDO',
    payload,
    // `recebimentoId: uuid` (placeholder, nunca bate com um ID real do
    // Firestore) — só existe pra dar uma CHAVE PRÓPRIA em
    // atualizarIndicadorPendenciasRecebimento() (PENDENTES_REC_MAP é indexado
    // por recebimentoId; sem isso, 2+ criações pendentes colidiam todas na
    // mesma chave `undefined` e o contador "N não sincronizado(s)" subcontava).
    recebimentoId: uuid,
    lojaId: _lojaAtivaRec(),
    status_sync: 'pendente',
    tentativas: 0,
    criado_em: new Date().toISOString(),
    seq: _recSeqCounter++
  });
  await atualizarIndicadorPendenciasRecebimento();
  toast('📡 Sem conexão — o transbordo foi guardado neste aparelho e será criado assim que a internet voltar. Não feche o app até sincronizar.', 'w');
}

// Pura: dado o status ATUAL da carga, decide qual é o único próximo bip
// válido (nunca deixa pular etapa) — usada tanto pro bip ao vivo quanto pela
// revalidação da fila offline (23-recebimento-offline.js), que roda a MESMA
// função contra o status mais recente do servidor antes de aplicar algo que
// foi bipado enquanto o aparelho estava sem internet.
function _proximoBipPara(status, timestampIso) {
  const ts = timestampIso || new Date().toISOString();
  if (status === 'PREVISTO') return {
    operacao: 'TRANSBORDO_SAIU',
    mudancas: {
      status: 'EM_TRANSITO',
      horaSaida: ts
    },
    titulo: 'Saída registrada',
    confirmarMsg: 'Confirmar a saída deste transbordo?',
    nf: 'informar'
  };
  if (status === 'EM_TRANSITO') return {
    operacao: 'CHEGADA_REGISTRADA',
    mudancas: {
      status: 'CHEGOU',
      horaChegada: ts
    },
    titulo: 'Chegada registrada',
    confirmarMsg: 'Confirmar a chegada desta carga?',
    nf: 'confirmar'
  };
  if (status === 'CHEGOU' || status === 'AGUARDANDO_DOCA') return {
    operacao: 'DESCARGA_INICIADA',
    mudancas: {
      status: 'EM_DESCARGA',
      horaInicioDescarga: ts
    },
    titulo: 'Descarga iniciada',
    confirmarMsg: 'Confirmar início da descarga?'
  };
  if (status === 'EM_DESCARGA') return {
    operacao: 'DESCARGA_FINALIZADA',
    mudancas: {
      status: 'DESCARGA_FINALIZADA',
      horaFimDescarga: ts
    },
    titulo: 'Descarga finalizada',
    confirmarMsg: 'Confirmar que a descarga terminou?'
  };
  // 5º bip (pedido ao vivo do usuário) — quem faz a conferência da nota
  // bipa o mesmo QR do motorista de novo pra fechar o processo. Vai direto
  // pra FINALIZADO (mesmo destino de recopFinalizar em 93-recebimento-
  // operacao.js — _podeFinalizar já aceita DESCARGA_FINALIZADA como
  // origem), sem passar por EM_CONFERENCIA como etapa separada: aqui não
  // tem "conferir e depois finalizar", é um bip só que faz as duas coisas.
  if (status === 'DESCARGA_FINALIZADA') return {
    operacao: 'RECEBIMENTO_FINALIZADO',
    mudancas: {
      status: 'FINALIZADO',
      horaFechamentoRecebimento: ts
    },
    titulo: 'Nota conferida — transbordo finalizado',
    confirmarMsg: 'Confirmar a nota conferida e finalizar este transbordo?'
  };
  return null;
}

// "Voltar etapa" (pedido ao vivo do usuário) — replicado do MESMO mapa de
// 93-recebimento-operacao.js (Analista), com os MESMOS nomes de status/
// campo, pra nunca divergir (coletor.html não carrega o bundle do
// Analista, então essa guarda precisa existir aqui também). Corrige um bip
// errado sem apagar o resto do registro (motorista, placa, origem/destino,
// NF de etapas anteriores continuam intactos).
const _VOLTAR_ETAPA = {
  EM_TRANSITO: {
    anterior: 'PREVISTO',
    limpar: ['horaSaida', 'notaFiscalTransferencia', 'notasVolumesTransferencia'],
    zerar: ['volumes']
  },
  CHEGOU: {
    anterior: 'EM_TRANSITO',
    limpar: ['horaChegada', 'notaFiscalConfirmadaEm', 'notaFiscalConfirmadaPor']
  },
  AGUARDANDO_DOCA: {
    anterior: 'EM_TRANSITO',
    limpar: ['horaChegada', 'notaFiscalConfirmadaEm', 'notaFiscalConfirmadaPor']
  },
  EM_DESCARGA: {
    anterior: 'CHEGOU',
    limpar: ['horaInicioDescarga']
  },
  DESCARGA_FINALIZADA: {
    anterior: 'EM_DESCARGA',
    limpar: ['horaFimDescarga']
  },
  FINALIZADO: {
    anterior: 'DESCARGA_FINALIZADA',
    limpar: ['horaFechamentoRecebimento']
  }
};

// A escrita exige a permissão administrativa "corrigir-horario" — o
// Coletor não tem como checar isso localmente (não carrega o sistema de
// permissões do Analista), então o botão aparece sempre que a etapa é
// revertível e deixa o próprio Firestore negar (com aviso claro) quem não
// tiver essa permissão liberada. Decisão confirmada: permissão separada,
// não abrir pra qualquer operador que já bipa normalmente.
async function voltarEtapaRecebimento(recebimentoId) {
  const r = RECEBIMENTOS_CACHE.find(x => x._id === recebimentoId);
  if (!r) {
    toast('Carga não encontrada.', 'e');
    return;
  }
  if (!_minhaVezDeAgir(r)) {
    toast('Esta carga não pertence mais a esta loja — não é possível corrigi-la por aqui.', 'e');
    return;
  }
  const regra = _VOLTAR_ETAPA[r.status];
  if (!regra) {
    toast('Essa carga não tem etapa anterior pra voltar.', 'e');
    return;
  }
  if (!confirm('Voltar esta carga pra "' + (REC_STATUS_LABEL[regra.anterior] || regra.anterior) + '"? O horário registrado nesta etapa será apagado.')) return;
  try {
    const agora = new Date().toISOString();
    const autor = typeof APP !== 'undefined' && APP.operador && APP.operador.email || '';
    const payload = {
      status: regra.anterior,
      atualizadoEm: agora,
      atualizadoPor: autor
    };
    regra.limpar.forEach(campo => {
      payload[campo] = null;
    });
    (regra.zerar || []).forEach(campo => {
      payload[campo] = 0;
    });
    const mesclado = {
      ...r,
      ...payload
    };
    payload.tempoViagemMin = _minutosEntreRec(mesclado.horaSaida, mesclado.horaChegada);
    payload.tempoEsperaMin = _minutosEntreRec(mesclado.horaChegada, mesclado.horaInicioDescarga);
    payload.tempoDescargaMin = _minutosEntreRec(mesclado.horaInicioDescarga, mesclado.horaFimDescarga);
    payload.tempoTotalMin = _minutosEntreRec(mesclado.horaChegada, mesclado.horaFimDescarga);
    payload.tempoAteFechamentoMin = _minutosEntreRec(mesclado.horaChegada, mesclado.horaFechamentoRecebimento);
    // .update() (não .set(merge:true)) — a carga sempre já existe aqui
    // (achada em RECEBIMENTOS_CACHE antes). Além de mais correto (um
    // .set(merge) num doc que já existe é ambíguo pro Firestore: não sabe
    // de antemão se é create ou update, então avalia as DUAS regras — achado
    // real desta sessão: isso quase dobrava o custo de avaliação da regra de
    // update em contas com o mapa `permissoes` grande, o bastante pra
    // estourar o limite de 1000 sub-expressões do motor em produção).
    // .update() é inequívoco: só a regra de update é avaliada.
    await _refRecCrossLoja(r._lojaId, recebimentoId).update(payload);
    try {
      await _refAuditoriaCrossLoja(r._lojaId).add({
        usuario: autor,
        dataHora: agora,
        operacao: 'ETAPA_REVERTIDA',
        recebimentoId,
        valorAnterior: r.status,
        valorNovo: regra.anterior,
        dispositivo: (typeof obterDeviceId === 'function' ? obterDeviceId() : '') || ''
      });
    } catch (e) {/* auditoria nunca trava a ação */}
    toast('Etapa revertida.', 's');
    carregarRecebimentoColetor();
  } catch (e) {
    const permissao = e && e.code === 'permission-denied';
    toast(permissao ? 'Você não tem permissão pra voltar etapa. Peça pro Analista liberar "corrigir horário" em Usuários e Permissões.' : 'Erro ao voltar etapa: ' + ((e === null || e === void 0 ? void 0 : e.message) || e), 'e');
  }
}

// Chamado tanto pelo scan quanto pelo toque num card da lista "em andamento".
// Bipa tanto na Matriz (saída) quanto na Filial (chegada/descarga) — o
// mesmo bip único, guardado por status, decide o que fazer.
async function abrirConfirmacaoParaRecebimento(recebimentoId) {
  try {
    let r = RECEBIMENTOS_CACHE.find(x => x._id === recebimentoId);
    if (navigator.onLine) {
      try {
        var _r, _r2;
        const doc = await _refRecCrossLoja((_r = r) === null || _r === void 0 ? void 0 : _r._lojaId, recebimentoId).get();
        if (doc.exists) r = {
          _id: recebimentoId,
          _lojaId: ((_r2 = r) === null || _r2 === void 0 ? void 0 : _r2._lojaId) || _lojaAtivaRec(),
          ...doc.data()
        };
      } catch (e) {/* segue com o cache local */}
    }
    if (!r) {
      toast('Carga não encontrada.', 'e');
      return;
    }

    // Camada 2/3 da correção estrutural: mesmo que a lista já filtre por
    // _minhaVezDeAgir, este é o chokepoint real (clique no card, código
    // escaneado, retomada por motorista) — sem checar aqui de novo, um card
    // ainda em cache ou um código físico na mão bastava pra agir numa carga
    // que já não é mais desta loja. Firestore Rules é a camada final (Fase
    // 1.5), não a única.
    if (!_minhaVezDeAgir(r)) {
      const dono = _lojaResponsavelAtual(r);
      toast('Esta carga pertence à loja ' + (dono === r.destinoLojaId ? r.destino || dono : r.origem || dono) + ' e não pode mais ser operada por aqui.', 'e');
      return;
    }
    const proximo = _proximoBipPara(r.status);
    if (!proximo) {
      _mostrarConfirmacao('⚠️', 'Não é possível avançar', [{
        label: 'Status atual',
        valor: REC_STATUS_LABEL[r.status] || r.status
      }, {
        label: 'Motivo',
        valor: 'Essa carga não está pronta pra próxima etapa a partir daqui.'
      }]);
      return;
    }

    // Controle de Nota Fiscal: na SAÍDA (Matriz) o responsável informa o
    // número pela 1ª vez; na CHEGADA (Filial) só confere se bate com o que
    // foi registrado na saída — nunca aplica o bip direto nesses dois casos.
    // Início/fim de descarga seguem exatamente como antes.
    if (proximo.nf === 'informar') {
      _abrirTelaNfSaida(r, proximo);
      return;
    }
    if (proximo.nf === 'confirmar') {
      _abrirTelaNfChegada(r, proximo);
      return;
    }
    await _aplicarProximoBip(r, proximo);
  } catch (e) {
    // Nunca deixar o toque no card falhar em silêncio — sem isto, um erro
    // aqui vira uma promise rejeitada sem handler (onclick não dá await),
    // o navegador só loga no console e o operador não vê nada acontecer.
    console.error('[Recebimento] Falha ao abrir carga:', e);
    if (typeof window.dtAddDiag === 'function') window.dtAddDiag('Falha ao abrir carga: ' + ((e === null || e === void 0 ? void 0 : e.code) || 'sem código') + ' — ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
    const traduzido = typeof window.traduzirErroPermissao === 'function' ? window.traduzirErroPermissao(e, {
      acao: 'abrir esta carga',
      canalNecessario: 'coletor'
    }) : null;
    toast(traduzido || 'Erro ao abrir a carga: ' + ((e === null || e === void 0 ? void 0 : e.message) || e), 'e');
  }
}

// Pedido ao vivo do usuário: "hoje ele só clica e já vai" — todo bip
// (chegada, início/fim de descarga, conferência) aplicava direto no toque,
// sem chance de desfazer um toque errado. Agora TODO bip passa por uma
// caixinha de confirmação (Confirmar/Cancelar) antes de gravar qualquer
// coisa — mesmo modal já usado no resto do Coletor (sair, voltar sem
// salvar, atualizar base), só que agora também pro fluxo de recebimento.
// Cancelar não grava nada e não fecha a tela — o operador pode tentar de
// novo ou sair sem consequência.
function _confirmarBip(proximo) {
  return new Promise(resolve => {
    if (typeof showConfirm !== 'function') {
      resolve(true);
      return;
    } // sem o modal (ex.: ambiente de teste) não bloqueia o fluxo
    showConfirm(proximo.confirmarMsg || 'Confirmar "' + proximo.titulo + '"?', () => resolve(true), {
      title: proximo.titulo,
      icon: '❓',
      okLabel: 'Confirmar',
      okColor: '#00d68f',
      onCancel: () => resolve(false)
    });
  });
}
async function _aplicarProximoBip(r, proximo) {
  if (!(await _confirmarBip(proximo))) return; // operador cancelou — nada muda
  if (!navigator.onLine) {
    if (typeof enfileirarBipRecebimento !== 'function') {
      toast('Sem internet e fila offline indisponível.', 'e');
      return;
    }
    await enfileirarBipRecebimento(r, proximo);
    _mostrarConfirmacao('🕓', proximo.titulo + ' (offline)', [{
      label: 'Status',
      valor: 'Registrado neste aparelho'
    }, {
      label: 'Sincronização',
      valor: 'Envia sozinho quando a internet voltar'
    }]);
    _desenharListaRecebimento();
    return;
  }
  await _aplicarBipRecebimento(r, proximo.operacao, proximo.mudancas, proximo.titulo);
}

// ── Observação opcional da saída ──────────────────────────────────────
// As opções são cadastradas pelo Analista em Transbordo. No Coletor a
// observação não é digitada livremente: toca no campo, pesquisa e seleciona
// uma opção cadastrada. É totalmente opcional e só é gravada junto da saída.
function _atualizarCampoObservacaoTransbordo() {
  const btn = document.getElementById('rec-obs-seletor-btn');
  const limpar = document.getElementById('rec-obs-limpar-btn');
  if (btn) {
    var _observacaoTransbordo;
    const txt = ((_observacaoTransbordo = _observacaoTransbordoSelecionada) === null || _observacaoTransbordo === void 0 ? void 0 : _observacaoTransbordo.texto) || '';
    btn.textContent = txt ? '📝 ' + txt : '📝 Selecionar observação (opcional)';
    btn.title = txt || 'Selecionar observação';
  }
  if (limpar) limpar.style.display = _observacaoTransbordoSelecionada ? 'inline-flex' : 'none';
}
async function _carregarObservacoesTransbordoAoVivo() {
  try {
    const snap = await FS.collection(COL_OBSERVACOES_TRANSBORDO).get();
    OBSERVACOES_TRANSBORDO_CACHE = snap.docs.map(d => ({
      _id: d.id,
      ...d.data()
    })).filter(x => x.ativa !== false).sort((a, b) => String(a.texto || '').localeCompare(String(b.texto || ''), 'pt-BR'));
  } catch (e) {
    console.warn('[Recebimento] Falha ao carregar observações:', (e === null || e === void 0 ? void 0 : e.message) || e);
  }
  return OBSERVACOES_TRANSBORDO_CACHE;
}
function _renderizarOpcoesObservacaoTransbordo(filtro) {
  const lista = document.getElementById('rec-obs-opcoes');
  if (!lista) return;
  const termo = String(filtro || '').trim().toLocaleLowerCase('pt-BR');
  const itens = OBSERVACOES_TRANSBORDO_CACHE.filter(o => !termo || String(o.texto || '').toLocaleLowerCase('pt-BR').includes(termo));
  lista.innerHTML = itens.length ? itens.map(o => `
    <button type="button" data-rec-obs-id="${_escRec(o._id)}" style="width:100%;text-align:left;padding:13px 12px;border:1px solid #2b4566;border-radius:10px;background:#101f35;color:#fff;font-size:.92rem;cursor:pointer">
      ${_escRec(o.texto || '—')}
    </button>`).join('') : '<div style="padding:18px;text-align:center;color:#6f89a6;font-size:.85rem">Nenhuma observação encontrada.</div>';
}
// Modal ÚNICO reaproveitado nos 2 modos: escolher a observação da SAÍDA
// (alimenta a tela de NF, fluxo antigo) e registrar/trocar o motivo de uma
// carga JÁ em andamento (grava direto no Firestore, pedido ao vivo novo) —
// distinguidos por `_cargaPendenteMotivoId` estar preenchido ou não.
async function _abrirModalObservacoes() {
  const modal = document.getElementById('rec-obs-modal');
  const busca = document.getElementById('rec-obs-busca');
  if (!modal) return;
  modal.style.display = 'flex';
  if (busca) busca.value = '';
  _renderizarOpcoesObservacaoTransbordo('');
  await _carregarObservacoesTransbordoAoVivo();
  _renderizarOpcoesObservacaoTransbordo('');
  setTimeout(() => busca === null || busca === void 0 ? void 0 : busca.focus(), 50);
}
async function abrirSeletorObservacaoTransbordo() {
  _cargaPendenteMotivoId = null;
  const titulo = document.getElementById('rec-obs-titulo');
  const subtitulo = document.getElementById('rec-obs-subtitulo');
  const rodape = document.getElementById('rec-obs-rodape-btn');
  if (titulo) titulo.textContent = '📝 Selecionar observação';
  if (subtitulo) subtitulo.textContent = 'Opcional. Pesquise e toque em uma observação cadastrada pelo Analista.';
  if (rodape) rodape.textContent = 'Continuar sem observação';
  await _abrirModalObservacoes();
}
async function abrirSeletorMotivoEtapa(recebimentoId) {
  _cargaPendenteMotivoId = recebimentoId;
  const r = RECEBIMENTOS_CACHE.find(x => x._id === recebimentoId);
  const titulo = document.getElementById('rec-obs-titulo');
  const subtitulo = document.getElementById('rec-obs-subtitulo');
  const rodape = document.getElementById('rec-obs-rodape-btn');
  if (titulo) titulo.textContent = '📝 Motivo da demora';
  if (subtitulo) subtitulo.textContent = 'Pesquise e toque num motivo cadastrado pelo Analista pra justificar o atraso desta carga na etapa atual.';
  if (rodape) rodape.textContent = r !== null && r !== void 0 && r.observacao ? 'Remover motivo atual' : 'Cancelar';
  await _abrirModalObservacoes();
}
function fecharSeletorObservacaoTransbordo() {
  const modal = document.getElementById('rec-obs-modal');
  if (modal) modal.style.display = 'none';
}
function limparObservacaoTransbordo() {
  _observacaoTransbordoSelecionada = null;
  _atualizarCampoObservacaoTransbordo();
}
// Botão de rodapé do modal — comportamento muda conforme o modo (ver
// comentário de _abrirModalObservacoes).
async function _acaoRodapeObservacaoTransbordo() {
  if (_cargaPendenteMotivoId) {
    const recebimentoId = _cargaPendenteMotivoId;
    _cargaPendenteMotivoId = null;
    fecharSeletorObservacaoTransbordo();
    await _salvarMotivoEtapaAgora(recebimentoId, {
      id: '',
      texto: ''
    });
    return;
  }
  limparObservacaoTransbordo();
  fecharSeletorObservacaoTransbordo();
}
async function selecionarObservacaoTransbordo(id) {
  const item = OBSERVACOES_TRANSBORDO_CACHE.find(o => o._id === id);
  if (!item) return;
  const selecionado = {
    id: item._id,
    texto: String(item.texto || '').trim()
  };
  if (_cargaPendenteMotivoId) {
    const recebimentoId = _cargaPendenteMotivoId;
    _cargaPendenteMotivoId = null;
    fecharSeletorObservacaoTransbordo();
    await _salvarMotivoEtapaAgora(recebimentoId, selecionado);
    return;
  }
  _observacaoTransbordoSelecionada = selecionado;
  _atualizarCampoObservacaoTransbordo();
  fecharSeletorObservacaoTransbordo();
}
// Grava o motivo direto no registro, em QUALQUER etapa em andamento (pedido
// ao vivo do usuário) — reaproveita o MESMO cadastro de motivos da saída
// (nunca texto livre). Sobrescreve o texto atual (é a justificativa
// CORRENTE do atraso, não um histórico acumulado) — a auditoria
// (recebimento_auditoria) preserva o valor anterior de quem quiser ver o
// que mudou. Mesmo padrão simples de voltarEtapaRecebimento (sem fila
// offline própria — escrita pontual, não uma transição de estado crítica).
async function _salvarMotivoEtapaAgora(recebimentoId, selecionado) {
  const r = RECEBIMENTOS_CACHE.find(x => x._id === recebimentoId);
  if (!r) {
    toast('Carga não encontrada.', 'e');
    return;
  }
  if (!_minhaVezDeAgir(r)) {
    toast('Esta carga não pertence mais a esta loja — não é possível editar o motivo por aqui.', 'e');
    return;
  }
  const agora = new Date().toISOString();
  const autor = typeof APP !== 'undefined' && APP.operador && APP.operador.email || '';
  const payload = {
    observacao: selecionado.texto,
    observacaoId: selecionado.id || null,
    atualizadoEm: agora,
    atualizadoPor: autor
  };
  try {
    await _refRecCrossLoja(r._lojaId, recebimentoId).update(payload);
    try {
      await _refAuditoriaCrossLoja(r._lojaId).add({
        usuario: autor,
        dataHora: agora,
        operacao: 'MOTIVO_ATUALIZADO',
        recebimentoId,
        valorAnterior: r.observacao || '',
        valorNovo: selecionado.texto,
        dispositivo: (typeof obterDeviceId === 'function' ? obterDeviceId() : '') || ''
      });
    } catch (e) {/* auditoria nunca trava a ação */}
    Object.assign(r, payload);
    toast(selecionado.texto ? 'Motivo registrado: ' + selecionado.texto : 'Motivo removido.', 's');
    _desenharListaRecebimento();
  } catch (e) {
    const traduzido = typeof window.traduzirErroPermissao === 'function' ? window.traduzirErroPermissao(e, {
      acao: 'registrar o motivo',
      canalNecessario: 'coletor'
    }) : null;
    toast(traduzido || 'Erro ao registrar motivo: ' + ((e === null || e === void 0 ? void 0 : e.message) || e), 'e');
  }
}

// ── Controle de Nota Fiscal + volumes (saída + chegada) ────────────────
// Cada Nota Fiscal recebe seu próprio volume na SAÍDA. O total continua no
// campo `volumes` (compatível com os cards antigos) e o detalhamento fica em
// `notasVolumesTransferencia: [{numero, volumes}]` para manter a associação
// NF ↔ caixas. Na CHEGADA o operador redigita a NF e vê o volume registrado,
// sem poder alterar o volume já informado na origem.
let _nfPendente = null; // { r, proximo, modo:'saida'|'chegada' }
let _notasFiscaisEmEdicao = [{
  numero: '',
  volumes: ''
}];
function _juntarNotasFiscais(lista) {
  return lista.map(x => String(x.numero || '').trim()).filter(Boolean).join(', ');
}
function _notasFiscaisIguais(a, b) {
  const normalizar = x => String(x || '').split(',').map(v => v.trim()).filter(Boolean).sort();
  const na = normalizar(a),
    nb = normalizar(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}
function _detalhesNfRegistrados(r) {
  const salvos = Array.isArray(r === null || r === void 0 ? void 0 : r.notasVolumesTransferencia) ? r.notasVolumesTransferencia : [];
  if (salvos.length) return salvos.map(x => ({
    numero: String((x === null || x === void 0 ? void 0 : x.numero) || ''),
    volumes: Number(x === null || x === void 0 ? void 0 : x.volumes) || 0
  }));
  const nfs = String((r === null || r === void 0 ? void 0 : r.notaFiscalTransferencia) || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!nfs.length) return [];
  const total = Number(r === null || r === void 0 ? void 0 : r.volumes) || 0;
  return nfs.map((numero, idx) => ({
    numero,
    volumes: idx === 0 ? total : 0
  }));
}
function _sincronizarNotasFiscaisDosCampos() {
  const lista = document.getElementById('rec-nf-lista');
  if (!lista) return _notasFiscaisEmEdicao;
  const itens = [];
  Array.prototype.forEach.call(lista.querySelectorAll('[data-nf-row]'), function (row) {
    var _row$querySelector, _notasFiscaisEmEdicao2, _notasFiscaisEmEdicao3;
    const idx = Number(row.getAttribute('data-nf-row'));
    const numero = ((_row$querySelector = row.querySelector('[data-nf-input]')) === null || _row$querySelector === void 0 ? void 0 : _row$querySelector.value) || '';
    const volumeEl = row.querySelector('[data-nf-volume]');
    const volume = volumeEl ? volumeEl.value : (_notasFiscaisEmEdicao2 = (_notasFiscaisEmEdicao3 = _notasFiscaisEmEdicao[idx]) === null || _notasFiscaisEmEdicao3 === void 0 ? void 0 : _notasFiscaisEmEdicao3.volumes) !== null && _notasFiscaisEmEdicao2 !== void 0 ? _notasFiscaisEmEdicao2 : '';
    itens[idx] = {
      numero: String(numero).trim(),
      volumes: volume === '' ? '' : Number(volume)
    };
  });
  _notasFiscaisEmEdicao = itens.length ? itens : [{
    numero: '',
    volumes: ''
  }];
  return _notasFiscaisEmEdicao;
}
function _redesenharListaNfRecebimento(focarIndice) {
  var _nfPendente2;
  const lista = document.getElementById('rec-nf-lista');
  if (!lista) return;
  if (!_notasFiscaisEmEdicao.length) _notasFiscaisEmEdicao = [{
    numero: '',
    volumes: ''
  }];
  const chegada = ((_nfPendente2 = _nfPendente) === null || _nfPendente2 === void 0 ? void 0 : _nfPendente2.modo) === 'chegada';
  lista.innerHTML = _notasFiscaisEmEdicao.map((item, idx) => `
    <div data-nf-row="${idx}" style="display:grid;grid-template-columns:minmax(0,1.65fr) minmax(92px,.65fr) ${_notasFiscaisEmEdicao.length > 1 ? '38px' : ''};gap:7px;align-items:center;width:100%">
      <input ${idx === 0 ? 'id="rec-nf-input"' : ''} data-nf-input="${idx}" class="field" autocomplete="off" inputmode="numeric" placeholder="Nota Fiscal${idx ? ' ' + (idx + 1) : ''}" value="${_escRec(item.numero)}" style="min-width:0;font-size:1rem;padding:13px 10px;text-align:center;font-weight:700;letter-spacing:.02em;box-sizing:border-box">
      <input data-nf-volume="${idx}" class="field" type="number" min="1" step="1" inputmode="numeric" placeholder="Volume" value="${item.volumes === '' ? '' : _escRec(item.volumes)}" ${chegada ? 'readonly aria-readonly="true"' : ''} style="min-width:0;font-size:.95rem;padding:13px 8px;text-align:center;font-weight:700;box-sizing:border-box;${chegada ? 'opacity:.82' : ''}">
      ${_notasFiscaisEmEdicao.length > 1 ? `<button type="button" data-nf-remover="${idx}" title="Remover esta nota" style="width:38px;height:46px;border:1px solid #3a5a7a;border-radius:9px;background:transparent;color:#ff6b6b;font-size:1.05rem;font-weight:800;cursor:pointer">×</button>` : ''}
    </div>`).join('');
  Array.prototype.forEach.call(lista.querySelectorAll('[data-nf-input],[data-nf-volume]'), function (input) {
    input.addEventListener('input', function () {
      _sincronizarNotasFiscaisDosCampos();
    }, false);
  });
  Array.prototype.forEach.call(lista.querySelectorAll('[data-nf-remover]'), function (btn) {
    btn.addEventListener('click', function () {
      _sincronizarNotasFiscaisDosCampos();
      _notasFiscaisEmEdicao.splice(Number(btn.getAttribute('data-nf-remover')), 1);
      if (!_notasFiscaisEmEdicao.length) _notasFiscaisEmEdicao = [{
        numero: '',
        volumes: ''
      }];
      _redesenharListaNfRecebimento(Math.max(0, _notasFiscaisEmEdicao.length - 1));
    }, false);
  });
  if (Number.isInteger(focarIndice)) {
    const alvo = lista.querySelector(`[data-nf-input="${focarIndice}"]`);
    if (alvo) setTimeout(() => alvo.focus(), 40);
  }
}
function adicionarNotaFiscalRecebimento() {
  const status = document.getElementById('rec-nf-status');
  _sincronizarNotasFiscaisDosCampos();
  const preenchidas = _notasFiscaisEmEdicao.map(v => String(v.numero || '').trim()).filter(Boolean);
  if (new Set(preenchidas).size !== preenchidas.length) {
    if (status) status.textContent = 'Essa nota já foi adicionada.';
    return;
  }
  // Na chegada, cria outra linha apenas quando necessário; volume fica vazio
  // se não houver um detalhe salvo correspondente.
  _notasFiscaisEmEdicao.push({
    numero: '',
    volumes: ''
  });
  if (status) status.textContent = '';
  _redesenharListaNfRecebimento(_notasFiscaisEmEdicao.length - 1);
}
function _abrirTelaNfSaida(r, proximo) {
  _nfPendente = {
    r,
    proximo,
    modo: 'saida'
  };
  _notasFiscaisEmEdicao = [{
    numero: '',
    volumes: ''
  }];
  _observacaoTransbordoSelecionada = null;
  const blocoObs = document.getElementById('rec-obs-bloco');
  if (blocoObs) blocoObs.style.display = 'block';
  _atualizarCampoObservacaoTransbordo();
  const titulo = document.getElementById('rec-nf-titulo');
  const subtitulo = document.getElementById('rec-nf-subtitulo');
  const btn = document.getElementById('rec-nf-btn');
  const status = document.getElementById('rec-nf-status');
  if (titulo) titulo.textContent = '🧾 Nota Fiscal e Volume da Saída';
  if (subtitulo) subtitulo.textContent = 'Motorista: ' + (r.motoristaNome || '—') + (r.placa ? ' · ' + r.placa : '') + ' · Informe a NF e o volume de caixas.';
  if (btn) btn.textContent = 'Confirmar Saída';
  if (status) status.textContent = '';
  _redesenharListaNfRecebimento(0);
  goScreen('recebimento-nf');
}
function _abrirTelaNfChegada(r, proximo) {
  _nfPendente = {
    r,
    proximo,
    modo: 'chegada'
  };
  _observacaoTransbordoSelecionada = null;
  const blocoObs = document.getElementById('rec-obs-bloco');
  if (blocoObs) blocoObs.style.display = 'none';
  const detalhes = _detalhesNfRegistrados(r);
  _notasFiscaisEmEdicao = (detalhes.length ? detalhes : [{
    numero: '',
    volumes: ''
  }]).map(x => ({
    numero: '',
    volumes: x.volumes || ''
  }));
  const titulo = document.getElementById('rec-nf-titulo');
  const subtitulo = document.getElementById('rec-nf-subtitulo');
  const btn = document.getElementById('rec-nf-btn');
  const status = document.getElementById('rec-nf-status');
  if (titulo) titulo.textContent = '🧾 Confirme a Nota Fiscal';
  if (subtitulo) subtitulo.textContent = 'Motorista: ' + (r.motoristaNome || '—') + ' · NF da saída: ' + (r.notaFiscalTransferencia || '—') + ' · Volume total: ' + (Number(r.volumes) || 0);
  if (btn) btn.textContent = 'Confirmar Nota';
  if (status) status.textContent = '';
  _redesenharListaNfRecebimento(0);
  goScreen('recebimento-nf');
}
async function confirmarNotaFiscalRecebimento() {
  if (!_nfPendente) return;
  try {
    var _observacaoTransbordo2, _observacaoTransbordo3;
    const status = document.getElementById('rec-nf-status');
    _sincronizarNotasFiscaisDosCampos();
    const itensComNumero = _notasFiscaisEmEdicao.filter(v => String(v.numero || '').trim());
    const numeros = itensComNumero.map(v => String(v.numero || '').trim());
    if (!numeros.length) {
      if (status) status.textContent = 'Digite o número de pelo menos uma Nota Fiscal.';
      return;
    }
    if (new Set(numeros).size !== numeros.length) {
      if (status) status.textContent = 'Há Nota Fiscal repetida. Remova a duplicada antes de confirmar.';
      return;
    }
    const {
      r,
      proximo,
      modo
    } = _nfPendente;
    const agora = new Date().toISOString();
    const autor = typeof APP !== 'undefined' && APP.operador && APP.operador.email || '';
    const digitado = numeros.join(', ');
    if (modo === 'chegada') {
      const registrada = r.notaFiscalTransferencia || '';
      if (!_notasFiscaisIguais(digitado, registrada)) {
        if (status) status.textContent = '❌ Não confere com a(s) Nota(s) Fiscal(is) da saída (' + (registrada || '—') + '). Confira e tente de novo.';
        const detalhes = _detalhesNfRegistrados(r);
        _notasFiscaisEmEdicao = (detalhes.length ? detalhes : [{
          volumes: ''
        }]).map(x => ({
          numero: '',
          volumes: x.volumes || ''
        }));
        _redesenharListaNfRecebimento(0);
        return;
      }
      const proximoComNf = {
        ...proximo,
        mudancas: {
          ...proximo.mudancas,
          notaFiscalConfirmadaEm: agora,
          notaFiscalConfirmadaPor: autor
        }
      };
      _nfPendente = null;
      await _aplicarProximoBip(r, proximoComNf);
      return;
    }
    const invalidos = itensComNumero.filter(v => !Number.isFinite(Number(v.volumes)) || Number(v.volumes) <= 0);
    if (invalidos.length) {
      if (status) status.textContent = 'Informe um volume maior que zero para cada Nota Fiscal.';
      return;
    }
    const detalhes = itensComNumero.map(v => ({
      numero: String(v.numero).trim(),
      volumes: Math.round(Number(v.volumes))
    }));
    const volumeTotal = detalhes.reduce((s, x) => s + x.volumes, 0);
    const proximoComNf = {
      ...proximo,
      mudancas: {
        ...proximo.mudancas,
        notaFiscalTransferencia: digitado,
        notasVolumesTransferencia: detalhes,
        volumes: volumeTotal,
        observacao: ((_observacaoTransbordo2 = _observacaoTransbordoSelecionada) === null || _observacaoTransbordo2 === void 0 ? void 0 : _observacaoTransbordo2.texto) || '',
        observacaoId: ((_observacaoTransbordo3 = _observacaoTransbordoSelecionada) === null || _observacaoTransbordo3 === void 0 ? void 0 : _observacaoTransbordo3.id) || null
      }
    };
    _nfPendente = null;
    await _aplicarProximoBip(r, proximoComNf);
  } catch (e) {
    console.error('[Recebimento] Falha ao confirmar NF/volume:', e);
    toast('Erro ao confirmar a Nota Fiscal e volume: ' + ((e === null || e === void 0 ? void 0 : e.message) || e), 'e');
  }
}
async function _aplicarBipRecebimento(r, operacao, mudancas, tituloConfirmacao, opts) {
  const silencioso = !!(opts && opts.silencioso);
  const agora = new Date().toISOString();
  const autor = typeof APP !== 'undefined' && APP.operador && APP.operador.email || '';
  const mesclado = {
    ...r,
    ...mudancas
  };
  const payload = {
    ...mudancas,
    tempoViagemMin: _minutosEntreRec(mesclado.horaSaida, mesclado.horaChegada),
    tempoEsperaMin: _minutosEntreRec(mesclado.horaChegada, mesclado.horaInicioDescarga),
    tempoDescargaMin: _minutosEntreRec(mesclado.horaInicioDescarga, mesclado.horaFimDescarga),
    tempoTotalMin: _minutosEntreRec(mesclado.horaChegada, mesclado.horaFimDescarga),
    tempoAteFechamentoMin: _minutosEntreRec(mesclado.horaChegada, mesclado.horaFechamentoRecebimento),
    atualizadoEm: agora,
    atualizadoPor: autor
  };
  try {
    // Camada 3 da correção estrutural: revalida contra o estado mais atual
    // do servidor imediatamente antes de escrever — nunca confia cegamente
    // no `r` recebido, que pode ter ficado desatualizado no intervalo entre
    // abrir a carga e confirmar (ex.: tela de NF, onde o operador demora pra
    // digitar). Se a posse mudou nesse meio-tempo, recusa aqui mesmo, antes
    // de tocar o Firestore — a regra de segurança (Fase 1.5) é o backstop
    // final, não a única camada.
    const atualSnap = await _refRecCrossLoja(r._lojaId, r._id).get();
    let jaEstavaChegou = false;
    if (atualSnap.exists) {
      const atual = {
        _id: r._id,
        _lojaId: r._lojaId,
        ...atualSnap.data()
      };
      if (!_minhaVezDeAgir(atual)) {
        const erro = new Error('Esta carga não pertence mais a esta loja.');
        erro.code = 'posse-invalida';
        throw erro;
      }
      // Usado logo abaixo pra decidir se dispara o ledger de paletes na
      // chegada — sem isso, um retry/corrida que reaplicasse o MESMO bip
      // CHEGOU duas vezes debitaria/creditaria o saldo em dobro.
      jaEstavaChegou = atual.status === 'CHEGOU';
    }
    // .update() (não .set(merge:true)) — mesma razão do voltarEtapaRecebimento
    // acima: a carga já foi confirmada existente pela releitura logo acima
    // (atualSnap.exists), e .update() evita a avaliação ambígua de
    // create+update que estourava o limite de 1000 sub-expressões do motor
    // de regras em contas reais (achado ao vivo, não suposição).
    await _refRecCrossLoja(r._lojaId, r._id).update(payload);
    // Ledger de paletes na chegada de um transbordo GERADO por uma carga
    // (Montagem/Expedição, 26-recebimento-cargas.js) — CHEGOU (não
    // FINALIZADO) é o gatilho: é onde o destino confirma posse física de
    // verdade, esperar a conferência de NF atrasaria o saldo sem
    // necessidade (decisão já validada no plano desta feature). Nunca
    // bloqueia o bip principal (já aplicado com sucesso acima) — uma falha
    // aqui só fica registrada pro log de movimentos permitir reconciliar
    // manualmente depois.
    if (payload.status === 'CHEGOU' && r.cargaId && !jaEstavaChegou) {
      try {
        const cargaDoc = await getDTRawFirestore().collection('lojas').doc(r.origemLojaId).collection('recebimento_transbordo_cargas').doc(r.cargaId).get();
        const totalPaletes = cargaDoc && cargaDoc.exists ? Math.round(Number(cargaDoc.data().totalPaletesFisico) || 0) : 0;
        if (totalPaletes > 0) {
          const referencia = { colecao: 'recebimentos', id: r._id };
          // PEDIDO AO VIVO (2026-09-08): "Em Trânsito" agora é lançado na
          // loja de DESTINO desde a expedição (26-recebimento-cargas.js),
          // não mais na origem — então a chegada só precisa fechar o ciclo
          // no destino (tira do Em Trânsito, põe no Disponível). A origem
          // não carrega mais esse saldo, não há nada pra debitar lá.
          await _aplicarMovimentoLedger(r.destinoLojaId, 'TRANSBORDO_RECEBIMENTO', { emTransitoDelta: -totalPaletes, disponivelDelta: totalPaletes }, referencia);
        }
      } catch (eLedger) {
        console.warn('[Recebimento] Falha ao atualizar ledger de paletes na chegada da carga:', eLedger && eLedger.message ? eLedger.message : eLedger);
      }
    }
    try {
      await _refAuditoriaCrossLoja(r._lojaId).add({
        usuario: autor,
        dataHora: agora,
        operacao,
        recebimentoId: r._id,
        valorAnterior: r.status,
        valorNovo: payload.status,
        dispositivo: (typeof obterDeviceId === 'function' ? obterDeviceId() : '') || ''
      });
    } catch (e) {/* auditoria nunca trava o bip */}
    if (silencioso) return payload; // sincronização em segundo plano: quem chamou cuida do refresh da tela

    const corpo = [{
      label: 'Motorista',
      valor: r.motoristaNome || '—'
    }, {
      label: 'Veículo',
      valor: r.placa || '—'
    }, {
      label: 'Origem → Destino',
      valor: (r.origem || '—') + ' → ' + (r.destino || '—')
    }, {
      label: 'Hora',
      valor: new Date(agora).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      })
    }];
    if (payload.status === 'DESCARGA_FINALIZADA') {
      corpo.push({
        label: 'Espera',
        valor: _fmtMinRec(payload.tempoEsperaMin)
      });
      corpo.push({
        label: 'Descarga',
        valor: _fmtMinRec(payload.tempoDescargaMin)
      });
      corpo.push({
        label: 'Total',
        valor: _fmtMinRec(payload.tempoTotalMin)
      });
    }
    if (payload.status === 'FINALIZADO') {
      corpo.push({
        label: 'Nota Fiscal',
        valor: r.notaFiscalTransferencia || '—'
      });
      corpo.push({
        label: 'Total até fechamento',
        valor: _fmtMinRec(payload.tempoAteFechamentoMin)
      });
    }
    _mostrarConfirmacao('✅', tituloConfirmacao, corpo);
    carregarRecebimentoColetor();
  } catch (e) {
    if (silencioso) throw e; // deixa a fila offline decidir o que fazer com a falha (retry/conflito)
    if (typeof window.dtAddDiag === 'function') window.dtAddDiag('Falha ao registrar bip (' + operacao + '): ' + ((e === null || e === void 0 ? void 0 : e.code) || 'sem código') + ' — ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
    const traduzido = typeof window.traduzirErroPermissao === 'function' ? window.traduzirErroPermissao(e, {
      acao: 'registrar esta etapa',
      canalNecessario: 'coletor'
    }) : null;
    toast(traduzido || 'Erro ao registrar: ' + ((e === null || e === void 0 ? void 0 : e.message) || e), 'e');
  }
}
function _mostrarConfirmacao(icone, titulo, campos) {
  const elIcone = document.getElementById('rec-conf-icone');
  const elTitulo = document.getElementById('rec-conf-titulo');
  const elCorpo = document.getElementById('rec-conf-corpo');
  if (elIcone) elIcone.textContent = icone;
  if (elTitulo) elTitulo.textContent = titulo;
  if (elCorpo) elCorpo.innerHTML = campos.map(c => `
    <div style="display:flex;justify-content:space-between;gap:10px">
      <span style="color:#5a7a9a;font-size:.82rem">${_escRec(c.label)}</span>
      <span style="font-weight:700">${_escRec(c.valor)}</span>
    </div>`).join('');
  goScreen('recebimento-confirmacao');
}

// Seletor de observação (delegação porque a lista é redesenhada a cada busca).
document.addEventListener('click', function (event) {
  const opt = event.target.closest && event.target.closest('[data-rec-obs-id]');
  if (opt) {
    selecionarObservacaoTransbordo(opt.getAttribute('data-rec-obs-id'));
    return;
  }
  if (event.target && event.target.id === 'rec-obs-modal') fecharSeletorObservacaoTransbordo();
});
document.addEventListener('input', function (event) {
  if (event.target && event.target.id === 'rec-obs-busca') _renderizarOpcoesObservacaoTransbordo(event.target.value || '');
});
window.abrirSeletorObservacaoTransbordo = abrirSeletorObservacaoTransbordo;
window.fecharSeletorObservacaoTransbordo = fecharSeletorObservacaoTransbordo;
window.limparObservacaoTransbordo = limparObservacaoTransbordo;
window.abrirSeletorMotivoEtapa = abrirSeletorMotivoEtapa;
window._acaoRodapeObservacaoTransbordo = _acaoRodapeObservacaoTransbordo;