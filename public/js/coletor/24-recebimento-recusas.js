// Coletor > Recebimento > Notas Retornadas
(function (global) {
  'use strict';

  const COL_NOTAS = 'recebimento_recusas_notas';
  const COL_RECUSAS = 'recebimento_recusas';
  const COL_MOTORISTAS = 'recebimento_recusas_motoristas';
  const COL_MOTIVOS = 'recebimento_recusas_motivos';
  // Pedido ao vivo do usuário (planilha real de controle): "Conferente" é a
  // pessoa da equipe que confere a carga na chegada — cadastro próprio,
  // mesmo molde de Motorista/Motivo.
  const COL_CONFERENTES = 'recebimento_recusas_conferentes';
  const COL_TAREFAS = 'recebimento_recusas_tarefas_conferencia';
  const COL_PRODUTOS = 'producao_produtos';
  // PEDIDO AO VIVO (2026-09-08): "vai aparecer a opção de saída e entrada"
  // — campos novos de S ficam agrupados aqui, reaproveitados nos dois
  // lugares que inicializam S (declaração + reset()).
  const _ESTADO_SAIDA_INICIAL = {
    saidaNumeroBusca: '',
    saidaBuscaErro: '',
    saidaRecusaEncontrada: null, // doc inteiro de recebimento_recusas achado pela busca
    saidaNotaEncontrada: null, // qual item de `notas[]` daquele doc bate com o número digitado
    saidaConfirmada: false
  };
  let S = {
    etapa: 'modo',
    notas: [],
    motoristas: [],
    motivos: [],
    conferentes: [],
    motoristaId: '',
    motivoId: '',
    conferenteId: '',
    buscaMotorista: null,
    buscaMotivo: null,
    volume: '',
    box: '',
    pallets: '',
    modoConferencia: null,
    itensConferidos: [],
    tarefasPendentes: [],
    modoTarefa: false,
    tarefaId: '',
    recusaIdOriginal: '',
    carregando: false,
    // PEDIDO AO VIVO (2026-09-03): "o banco de dados não está atualizado...
    // deixar prosseguir, bipar normal a chave... e colocar manualmente o
    // número da nota, já que ela não vai trazer" — chave bipada que não bate
    // com NADA (nem ledger de venda, nem devolução automática) fica
    // pendente aqui até o operador confirmar/corrigir o número da nota.
    pendenteChaveManual: '',
    pendenteNumeroManual: '',
    ..._ESTADO_SAIDA_INICIAL
  };
  // BUG AO VIVO REAL (2026-08-29): "não mostra o produto, mostra só
  // escrito produto" + bipagem nunca funcionava — o BI (notas_fiscais_
  // jacson.json) não traz GTIN por item, então itens[] chega sempre com
  // gtin:'' (ver 97-recebimento-recusas.js/100-consulta-notas-fiscais.js/
  // functions/index.js, todos gravam gtin:'' de propósito por falta do
  // dado na fonte) — sem GTIN pra comparar, bipagemConferencia() nunca
  // achava o item. Backfill por produtoKey contra producao_produtos (que
  // TEM gtin/nome cadastrado) resolve os dois problemas de uma vez:
  // mostra o nome real e permite bipar de verdade.
  let _produtosPorCod = new Map();
  let _produtosPorGtin = new Map();
  function fs() {
    // BUG AO VIVO REAL (2026-09-08): "Firebase: No Firebase App '[DEFAULT]'
    // has been created" aparecia toda vez, num alert() nativo feio. A causa
    // era este 2º fallback: `global.firebase.firestore()` chama o SDK cru
    // sem nome de app nenhum, ou seja, sempre tenta o app '[DEFAULT]' — mas
    // o Coletor NUNCA cria um app '[DEFAULT]' (usa um app nomeado, ver
    // window.DT_FIREBASE_APP_NOME em firebase-shared.js), então esse
    // fallback tava garantido pra quebrar toda vez que fosse realmente
    // usado. Também nunca teria respeitado o escopo por loja (Proxy de
    // getDTFirestore), então mesmo funcionando por acaso ele leria/gravaria
    // no caminho errado. Melhor cair direto na mensagem clara de baixo.
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[s]);
  }
  function _norm(v) {
    return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function chaveValida(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return false;
    let soma = 0,
      p = 2;
    for (let i = 42; i >= 0; i--) {
      soma += Number(c[i]) * p;
      p = p === 9 ? 2 : p + 1;
    }
    const r = soma % 11,
      d = r === 0 || r === 1 ? 0 : 11 - r;
    return d === Number(c[43]);
  }
  // Número da nota (nNF) vem embutido na própria chave (posições 26-34,
  // 9 dígitos) — mesma extração de numeroNotaDaChave() em
  // 97-recebimento-recusas.js, duplicada aqui (bundle separado do Coletor)
  // só pra pré-preencher o campo manual quando a nota não está no banco
  // ainda, nunca escondida do operador (ele confirma/corrige antes de continuar).
  function numeroNotaDaChave(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return '';
    return String(Number(c.slice(25, 34)) || '').trim();
  }
  // Saldo do "Pátio em Tempo Real" (105-recebimento-patio-tempo-real.js,
  // Analista) — duplicado aqui de propósito (bundle separado do Coletor,
  // mesma convenção de TRATAMENTO_LABELS_SAIDA logo abaixo). `estaNoPatio`
  // é a MESMA regra usada nos 3 lugares que escrevem esses eventos
  // (finalizar/confirmarSaida aqui, alterarTratamento em 97, mudarStatusRetorno
  // em 99) — nunca decidir "saiu do pátio" de um jeito diferente em cada um.
  function estaNoPatio(doc, nota) {
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
  function recalcularStatusFisico(doc) {
    const notas = Array.isArray(doc.notas) && doc.notas.length ? doc.notas : [{}];
    return notas.some(n => estaNoPatio(doc, n)) ? 'NO_PATIO' : 'SAIU';
  }
  // BUG AO VIVO REAL (2026-09-09): "No Firebase App '[DEFAULT]' has been
  // created" de novo, agora nesta função — `global.firebase.auth()` (SDK
  // cru, sem nome de app) sempre tenta o app '[DEFAULT]', que o Coletor
  // nunca cria (usa um app nomeado, ver window.DT_FIREBASE_APP_NOME em
  // firebase-shared.js). Mesma causa raiz já corrigida em fs() logo acima;
  // essa aqui tinha passado batido porque é uma função separada. Correção
  // igual: usar o helper com escopo de app certo (getDTAuth(), o mesmo que
  // 01-core-firebase-cache.js e o resto do Coletor já usam).
  function usuario() {
    // NUNCA usar ?./?? neste arquivo (ver 25-recebimento-paletes.js) —
    // coletores industriais antigos (Memor K, WebView Chromium 66/2018)
    // travam com SyntaxError nessa sintaxe e derrubam o arquivo inteiro.
    const authObj = global.getDTAuth && global.getDTAuth();
    const u = authObj && authObj.currentUser;
    return u ? {
      uid: u.uid || '',
      email: u.email || ''
    } : {
      uid: '',
      email: ''
    };
  }
  // BUG AO VIVO REAL (2026-09-09): checava `global.showToast` (nome usado
  // do lado do Analista) em vez de `global.toast` (o nome real do toast do
  // Coletor, definido em 14-toast.js) — `global.showToast` nunca existe
  // aqui, então TODO toast desta tela caía sempre no alert() nativo feio,
  // mesmo em erros comuns. `global.toast` (não o `toast` local desta
  // função, que seria recursivo) é o global de verdade, intacto — a
  // declaração local não sobrescreve window.toast, só sombra o nome dentro
  // deste arquivo. `typeof ... === 'function'` (em vez de só truthy) evita
  // um 2º gotcha: elemento HTML com id="toast" vira global automaticamente
  // (quirk de named-property do próprio navegador/jsdom) quando o
  // 14-toast.js real ainda não carregou — nesse caso global.toast é o
  // <div>, não a função, e chamar direto quebraria com "not a function".
  function toast(m, t) {
    if (typeof global.toast === 'function') global.toast(m, t);else alert(m);
  }
  function reset() {
    S = {
      etapa: 'modo',
      notas: [],
      motoristas: [],
      motivos: [],
      conferentes: [],
      motoristaId: '',
      motivoId: '',
      conferenteId: '',
      buscaMotorista: null,
      buscaMotivo: null,
      volume: '',
      box: '',
      pallets: '',
      modoConferencia: null,
      itensConferidos: [],
      tarefasPendentes: [],
      modoTarefa: false,
      tarefaId: '',
      recusaIdOriginal: '',
      carregando: false,
      pendenteChaveManual: '',
      pendenteNumeroManual: '',
      ..._ESTADO_SAIDA_INICIAL
    };
  }
  // Config genérica dos combos com busca (motorista/motivo/conferente) —
  // um lugar só listando qual campo de S guarda o id selecionado e qual
  // guarda o texto digitado, pra ligarCombosBusca()/comboItens() não
  // precisarem de um if/else por combo.
  const COMBO_CAMPOS = {
    'recusa-motorista': {
      itens: 'motoristas',
      id: 'motoristaId',
      busca: 'buscaMotorista'
    },
    'recusa-motivo': {
      itens: 'motivos',
      id: 'motivoId',
      busca: 'buscaMotivo'
    }
  };
  // PEDIDO AO VIVO (2026-09-03): "o conferente não vai precisar nem
  // selecionar... vai descobrir pelo login" — em vez de um combo manual
  // (como motorista/motivo), casa o e-mail de quem está logado no Coletor
  // com o cadastro de conferentes (campo `email`, preenchido pelo Analista
  // em Cadastros › Conferentes). Roda assim que os cadastros terminam de
  // carregar, pra já aparecer resolvido na etapa de motorista.
  function resolverConferenteAutomatico() {
    const email = String(usuario().email || '').trim().toLowerCase();
    const achado = email ? S.conferentes.find(c => String(c.email || '').trim().toLowerCase() === email) : null;
    S.conferenteId = achado ? achado._id : '';
  }
  // PEDIDO AO VIVO (usuário: "quando clico em cima [motorista/motivo], tem
  // que deixar a pessoa digitar também para não ficar procurando durante
  // um tempão") — os dois <select> nativos viraram uma busca com lista
  // filtrada, porque com ~30 motoristas cadastrados rolar um <select>
  // nativo num coletor é lento. Estado (S.buscaMotorista/buscaMotivo)
  // guarda o texto digitado à parte do ID selecionado, porque render()
  // reconstrói o HTML inteiro a cada mudança de etapa — sem isso o texto
  // digitado sumiria ao trocar de campo.
  function comboBuscaHtml(prefixo, itens, selecionadoId, busca) {
    const selecionado = itens.find(x => x._id === selecionadoId);
    const termo = busca != null ? busca : selecionado ? selecionado.nome || '' : '';
    const termoNorm = _norm(termo);
    const filtrados = termoNorm ? itens.filter(x => _norm(x.nome).includes(termoNorm)) : itens;
    return `<div style="position:relative">
      <input class="field" id="${prefixo}-busca" autocomplete="off" placeholder="Digite para buscar ou toque pra ver todos" value="${esc(termo)}" data-combo-input="${prefixo}">
      <div id="${prefixo}-lista" class="combo-lista" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:40;max-height:230px;overflow:auto;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.45)">${comboOpcoesHtml(prefixo, filtrados)}</div>
    </div>`;
  }
  function comboOpcoesHtml(prefixo, filtrados) {
    if (!filtrados.length) return '<div style="padding:12px 14px;font-size:.85rem;color:var(--muted)">Nenhum resultado</div>';
    return filtrados.map(x => `<div class="combo-opcao" data-combo-opcao="${prefixo}" data-combo-valor="${esc(x._id)}" style="padding:13px 14px;font-size:.88rem;border-bottom:1px solid var(--border);cursor:pointer">${esc(x.nome)}</div>`).join('');
  }
  function comboItens(prefixo) {
    return S[COMBO_CAMPOS[prefixo].itens];
  }
  // PEDIDO AO VIVO (2026-09-09): "caso não tenha cadastrado, cadastre e
  // deixe seguir em frente a que o operador colocar" — antes disso, digitar
  // um motorista/motivo que não batia com nenhum item da lista travava o
  // operador com "Selecione o motorista/motivo", mesmo já tendo digitado o
  // nome certo. Texto digitado sem correspondência agora cadastra na hora
  // (mesma coleção que o Analista usa em Notas Retornadas › Cadastros) e
  // segue em frente — nunca bloqueia o recebimento físico por falta de
  // cadastro prévio.
  async function garantirItemComboSelecionado(prefixo) {
    const campo = COMBO_CAMPOS[prefixo];
    if (S[campo.id]) return true;
    const nome = String(S[campo.busca] || '').trim();
    if (!nome) return false;
    const colecao = prefixo === 'recusa-motorista' ? COL_MOTORISTAS : COL_MOTIVOS;
    const agora = new Date().toISOString();
    const ref = await fs().collection(colecao).add({ nome, ativo: true, criadoEm: agora, atualizadoEm: agora });
    const novo = { _id: ref.id, nome, ativo: true };
    const lista = comboItens(prefixo);
    lista.push(novo);
    lista.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    S[campo.id] = novo._id;
    S[campo.busca] = nome;
    return true;
  }
  async function carregarCadastros() {
    const [m, mo, c, p] = await Promise.all([fs().collection(COL_MOTORISTAS).get(), fs().collection(COL_MOTIVOS).get(), fs().collection(COL_CONFERENTES).get(), fs().collection(COL_PRODUTOS).get().catch(() => ({
      docs: []
    }))]);
    S.motoristas = m.docs.map(d => ({
      _id: d.id,
      ...d.data()
    })).filter(x => x.ativo !== false).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    S.motivos = mo.docs.map(d => ({
      _id: d.id,
      ...d.data()
    })).filter(x => x.ativo !== false).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    S.conferentes = c.docs.map(d => ({
      _id: d.id,
      ...d.data()
    })).filter(x => x.ativo !== false).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    _produtosPorCod = new Map(p.docs.map(d => {
      const x = d.data() || {};
      return [String(x.cod || ''), {
        nome: x.nome || '',
        gtin: x.gtin || ''
      }];
    }).filter(([cod]) => cod));
    // PEDIDO AO VIVO (2026-09-03): "seria legal se na hora da conferência...
    // mostrar qual é o produto que ele bipou" — quando a nota não veio do
    // banco (chave não achada, ver adicionarChave()), não existe itens[]
    // esperado nenhum pra comparar; bipagemConferencia() usa este índice por
    // GTIN pra reconhecer o produto na hora e criar a linha, em vez de só
    // dizer "não encontrado".
    _produtosPorGtin = new Map(p.docs.map(d => {
      const x = d.data() || {};
      return [String(x.gtin || ''), {
        cod: x.cod || '',
        nome: x.nome || ''
      }];
    }).filter(([gtin]) => gtin));
  }
  // FASE 8 — tarefas de conferência que o Analista delegou pra ESTE
  // operador (matching por e-mail do login, mesmo padrão simples de
  // dt_atribuicoes_contagem). Nunca trava a entrada na tela se falhar
  // (rede fraca, etc.) — só fica sem a lista de tarefas.
  async function carregarTarefasPendentes() {
    const email = usuario().email;
    if (!email) {
      S.tarefasPendentes = [];
      return;
    }
    try {
      const snap = await fs().collection(COL_TAREFAS).where('atribuidoPara', '==', email).get();
      S.tarefasPendentes = snap.docs.map(d => ({
        _id: d.id,
        ...d.data()
      })).filter(t => t.status === 'PENDENTE');
    } catch (e) {
      S.tarefasPendentes = [];
    }
  }
  async function abrirRecusasRecebimento() {
    var _global$goScreen;
    reset();
    (_global$goScreen = global.goScreen) === null || _global$goScreen === void 0 || _global$goScreen.call(global, 'recebimento-recusas');
    render();
    try {
      await Promise.all([carregarCadastros(), carregarTarefasPendentes()]);
      resolverConferenteAutomatico();
      render();
      focarScan();
    } catch (e) {
      toast('Não foi possível carregar motoristas/motivos: ' + (e.message || e), 'error');
    }
  }
  function focarScan() {
    setTimeout(() => {
      var _document$getElementB;
      return (_document$getElementB = document.getElementById('recusa-chave-input')) === null || _document$getElementB === void 0 ? void 0 : _document$getElementB.focus();
    }, 80);
  }
  function focarSaidaInput() {
    setTimeout(() => {
      const el = document.getElementById('saida-numero-input');
      if (el) el.focus();
    }, 80);
  }
  function _maisRecenteDaLista(docs) {
    return docs.slice().sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')))[0];
  }
  // PEDIDO AO VIVO (2026-09-08, pergunta certeira do usuário: "não
  // consegue trazer notas recebidas antes da função existir, se tá tudo
  // gravado no banco?"): busca por NÚMERO da nota, em 2 passos. 1º tenta
  // `numerosNotas` (array irmão de `chaves`, só existe em registros
  // gravados DEPOIS desta função — finalizar() só passou a escrever esse
  // campo agora) — consulta indexada e barata, cobre o caso comum sem
  // baixar a coleção inteira. Só quando essa via rápida não acha nada
  // (numerosNotas ausente, exatamente o caso de um registro ANTIGO), cai
  // pra escanear a coleção inteira (já é loja-escopada, não é a base
  // toda) e filtra no cliente por `notas[].numeroNota` — o dado sempre
  // esteve lá, só não estava numa forma indexável antes; agora nenhuma
  // nota fica de fora, só o caminho comum continua barato.
  async function buscarSaida() {
    const input = document.getElementById('saida-numero-input');
    const numero = String((input && input.value) || '').trim();
    if (!numero) { S.saidaBuscaErro = 'Informe o número da nota.'; render(); focarSaidaInput(); return; }
    S.saidaNumeroBusca = numero;
    S.saidaBuscaErro = '';
    const btn = document.getElementById('saida-buscar-btn');
    if (btn) btn.disabled = true;
    try {
      let doc = null;
      const snapRapido = await fs().collection(COL_RECUSAS).where('numerosNotas', 'array-contains', numero).get();
      if (!snapRapido.empty) {
        doc = _maisRecenteDaLista(snapRapido.docs.map(d => Object.assign({ _id: d.id }, d.data())));
      } else {
        const snapTudo = await fs().collection(COL_RECUSAS).get();
        const achados = snapTudo.docs.map(d => Object.assign({ _id: d.id }, d.data()))
          .filter(r => (r.notas || []).some(n => String(n.numeroNota || '').trim() === numero));
        if (achados.length) doc = _maisRecenteDaLista(achados);
      }
      if (!doc) {
        S.saidaBuscaErro = 'Nota não encontrada. Confira se o número está certo.';
        render();
        return;
      }
      const nota = (doc.notas || []).find(n => String(n.numeroNota || '').trim() === numero);
      if (!nota) { S.saidaBuscaErro = 'Nota não encontrada.'; render(); return; }
      S.saidaRecusaEncontrada = doc;
      S.saidaNotaEncontrada = nota;
      S.etapa = 'saida-resultado';
      render();
    } catch (e) {
      S.saidaBuscaErro = 'Erro ao buscar: ' + (e.message || e);
      render();
    }
  }
  // Confirma a saída SÓ da nota bipada (não do grupo inteiro que veio
  // junto) — mesmo padrão ler→clonar→achar por `chave`→gravar o array
  // inteiro de volta usado por alterarTratamento/mudarStatusRetorno no
  // Analista (97/99-recebimento-*.js), duplicado aqui pro Coletor
  // conseguir escrever o mesmo campo (`dataSaidaEm`, já usado pra
  // Reentrega desde a migração de Tratamento/Status por nota).
  async function confirmarSaida() {
    const doc = S.saidaRecusaEncontrada, nota = S.saidaNotaEncontrada;
    if (!doc || !nota) return;
    const notasAtuais = Array.isArray(doc.notas) ? doc.notas : [];
    const idx = notasAtuais.findIndex(n => n.chave === nota.chave);
    if (idx === -1) return;
    const btn = document.getElementById('saida-confirmar-btn');
    if (btn) btn.disabled = true;
    const agora = new Date().toISOString();
    const notasAtualizadas = notasAtuais.map((n, i) => i === idx ? Object.assign({}, n, { dataSaidaEm: agora }) : n);
    const docAtualizado = Object.assign({}, doc, { notas: notasAtualizadas });
    const statusFisico = recalcularStatusFisico(docAtualizado);
    try {
      await fs().collection(COL_RECUSAS).doc(doc._id).update({ notas: notasAtualizadas, statusFisico });
      S.saidaRecusaEncontrada = Object.assign({}, docAtualizado, { statusFisico });
      S.saidaNotaEncontrada = notasAtualizadas[idx];
      render();
      toast('Saída confirmada.', 'success');
    } catch (e) {
      toast('Erro ao confirmar saída: ' + (e.message || e), 'error');
      if (btn) btn.disabled = false;
    }
  }

  // Pula direto pra conferência de itens de uma tarefa já delegada pelo
  // Analista — motorista/motivo/volume/box já foram preenchidos na
  // recusa original, só falta bipar os produtos. Refaz o merge de itens[]
  // (mesma lógica de 'recusa-conf-itens') a partir das notas ORIGINAIS
  // (a recusa não guarda itens, só a nota guarda).
  async function iniciarConferenciaDelegada(tarefa) {
    var _global$goScreen2;
    reset();
    S.modoTarefa = true;
    S.tarefaId = tarefa._id;
    S.recusaIdOriginal = tarefa.recusaId;
    S.box = tarefa.box || '';
    (_global$goScreen2 = global.goScreen) === null || _global$goScreen2 === void 0 || _global$goScreen2.call(global, 'recebimento-recusas');
    S.etapa = 'itens';
    render();
    try {
      const chaves = (tarefa.notas || []).map(n => n.chave).filter(Boolean);
      const docs = await Promise.all(chaves.map(c => fs().collection(COL_NOTAS).doc(c).get()));
      const itensBrutos = [];
      docs.forEach((doc, i) => {
        var _i;
        if (!doc.exists) return;
        const d = doc.data() || {};
        const numeroNota = ((_i = (tarefa.notas || [])[i]) === null || _i === void 0 ? void 0 : _i.numeroNota) || '';
        (d.itens || []).forEach(it => {
          var _it$produtoKey;
          return itensBrutos.push({
            produtoKey: (_it$produtoKey = it.produtoKey) !== null && _it$produtoKey !== void 0 ? _it$produtoKey : null,
            descricao: it.descricao || '',
            gtin: it.gtin || '',
            dun: it.dun || '',
            qtdPrevista: Number(it.quantidade) || 0,
            notaChave: chaves[i],
            notaNumero: numeroNota
          });
        });
      });
      S.modoConferencia = 'ITENS';
      S.itensConferidos = _mesclarItensPorProduto(itensBrutos);
      render();
      setTimeout(() => {
        var _document$getElementB2;
        return (_document$getElementB2 = document.getElementById('recusa-conf-scan')) === null || _document$getElementB2 === void 0 ? void 0 : _document$getElementB2.focus();
      }, 80);
    } catch (e) {
      toast('Erro ao carregar produtos da conferência: ' + (e.message || e), 'error');
    }
  }
  function tarefasPendentesHtml() {
    if (!S.tarefasPendentes.length) return '';
    return `<div class="card" style="padding:12px;border:1px solid #7a4a1f;background:#2a1c0c">
      <div style="font-size:.76rem;font-weight:800;margin-bottom:8px;color:#ffd18a">📋 Conferências pendentes pra você</div>
      ${S.tarefasPendentes.map(t => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)"><div><div style="font-weight:800">${esc((t.notas || []).map(n => 'NF ' + n.numeroNota).join(' • ') || '—')}</div><div style="font-size:.7rem;color:#9eb4cb">Box ${esc(t.box || '—')}</div></div><button type="button" class="btn btn-primary" style="padding:8px 12px" data-tarefa-iniciar="${esc(t._id)}">Iniciar</button></div>`).join('')}
    </div>`;
  }

  // Badge só informativo (pedido explícito do usuário: o operador NUNCA
  // classifica a nota) — só aparece quando a nota veio da sincronização
  // Bluesoft (só ali existe o sinal pareceDevolucao); nota importada por
  // PDF fica sem badge (sem dado pra opinar).
  function badgeIdentificacao(n) {
    // PEDIDO AO VIVO (2026-09-03): "as notas podem gravar direto [automático,
    // por motivo]... mas ainda vai continuar recebendo por aqui também" —
    // devolução com motivo qualificado (ex.: falta de produto) já vira um
    // recebimento_recusas com origem:'AUTOMATICO' assim que o BI traz a nota
    // (ver 100-consulta-notas-fiscais.js), sem passar pelo Coletor. Esse
    // badge avisa o operador que, ao bipar a MESMA chave aqui, ele está
    // confirmando o retorno FÍSICO de uma nota que já tinha sido só
    // registrada (ver adicionarChave() e [[notas-retornadas-controle-retorno-fisico]]).
    if (n.origemImportacao === 'AUTOMATICO') return '<div style="margin-top:4px"><span class="badge" style="background:#4a3114;color:#ffd18a;font-size:.62rem">⚡ Devolução já registrada automaticamente — confirmando o retorno físico</span></div>';
    // PEDIDO AO VIVO (2026-09-03, pt. 2): "o banco de dados não está
    // atualizado... deixar prosseguir... colocar manualmente o número da
    // nota" — sem nenhum dado da nota (nem venda, nem devolução automática),
    // o operador digitou o número à mão pra não travar o recebimento.
    if (n.origemImportacao === 'MANUAL_SEM_BANCO') return '<div style="margin-top:4px"><span class="badge" style="background:#3a2a12;color:#ffb84d;font-size:.62rem">✍️ Número digitado manualmente — nota ainda não estava no banco</span></div>';
    if (n.origemImportacao !== 'BLUESOFT') return '';
    return n.pareceDevolucao ? '<div style="margin-top:4px"><span class="badge" style="background:#4a3114;color:#ffd18a;font-size:.62rem">↩️ Nota de devolução identificada</span></div>' : '<div style="margin-top:4px"><span class="badge" style="background:#132a1d;color:#8fd9a8;font-size:.62rem">Nota de venda identificada</span></div>';
  }
  function notasHtml() {
    if (!S.notas.length) return '<div style="border:1px dashed #284567;border-radius:10px;padding:16px;text-align:center;color:#6f89a6;font-size:.82rem">Nenhuma nota lida ainda.</div>';
    return S.notas.map((n, i) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#101f34;border:1px solid #284567;border-radius:10px;padding:11px 12px"><div><div style="font-weight:850">NF ${esc(n.numeroNota)}</div><div style="font-size:.7rem;color:#6f89a6">${esc(n.destinatario || 'Nota identificada')}</div>${badgeIdentificacao(n)}</div><button type="button" class="btn btn-ghost" style="padding:7px 10px;color:#ff7b7b" data-recusa-remover="${i}">×</button></div>`).join('');
  }
  // PEDIDO AO VIVO (2026-09-03, pt. 2): quando a chave bipada não bate com
  // NADA (nem ledger de venda, nem devolução automática — ver
  // adicionarChave()), em vez de travar o operador com "nota não
  // encontrada", pede só o número da nota (pré-preenchido a partir da
  // própria chave, via numeroNotaDaChave — o operador confirma ou corrige)
  // e deixa seguir o fluxo inteiro normalmente.
  function pendenteManualHtml() {
    if (!S.pendenteChaveManual) return '';
    return `<div class="card" style="padding:12px;border:1px solid #7a4a1f;background:#2a1c0c">
      <div style="font-size:.76rem;font-weight:800;margin-bottom:6px;color:#ffd18a">⚠️ Nota ainda não está no sistema</div>
      <div style="font-size:.74rem;color:#9eb4cb;margin-bottom:10px">O banco pode estar desatualizado. Confirme (ou corrija) o número da nota pra continuar mesmo assim — na hora de conferir os produtos, dá pra bipar livremente.</div>
      <input id="recusa-chave-manual-numero" class="field" inputmode="numeric" autocomplete="off" placeholder="Número da nota" value="${esc(S.pendenteNumeroManual)}" style="font-size:1.05rem;padding:14px;text-align:center;font-weight:850;margin-bottom:8px">
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="recusa-chave-manual-cancelar" style="padding:12px;flex:1">Cancelar</button>
        <button class="btn btn-primary" id="recusa-chave-manual-confirmar" style="padding:12px;flex:2">Continuar assim mesmo →</button>
      </div>
    </div>`;
  }
  // PEDIDO AO VIVO (2026-09-08): "vai aparecer a opção de saída e entrada,
  // entrada é para receber a nota que tá voltando, a saída é para as que
  // vão sair" — tela de escolha, primeira coisa que aparece ao abrir
  // Notas Retornadas. Entrada é o fluxo que já existia (bipar chave...);
  // Saída é novo (buscar pelo NÚMERO da nota, ver etapaSaidaBuscar/
  // etapaSaidaResultado abaixo).
  function etapaModo() {
    return `
    ${tarefasPendentesHtml()}
    <div><div class="screen-title">↩️ Notas Retornadas</div><div class="screen-sub">Entrada é pra registrar uma nota que voltou. Saída é pra confirmar que uma nota já registrada foi embora de novo (reentrega).</div></div>
    <button class="btn btn-primary" data-recusa-modo="entrada" style="padding:18px;font-size:1.05rem">📥 Entrada</button>
    <button class="btn btn-ghost" data-recusa-modo="saida" style="padding:18px;font-size:1.05rem">📤 Saída</button>`;
  }
  // Rótulo local de Tratamento — este arquivo (Coletor) não carrega
  // TRATAMENTO_LABELS do Analista (97-recebimento-recusas.js, bundle
  // separado); duplicado aqui só pro texto amigável na tela de Saída,
  // mesma convenção de numeroNotaDaChave() já duplicada acima.
  const TRATAMENTO_LABELS_SAIDA = { '': 'Não classificado', RECUSA: 'Recusa', DEVOLUCAO: 'Devolução', REENTREGA: 'Reentrega', SUBSTITUICAO: 'Substituição', PENDENTE: 'Pendente', OUTRO: 'Outro' };
  function fmtDataSaida(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function etapaSaidaBuscar() {
    return `
    <div><div class="screen-title">📤 Saída — buscar nota</div><div class="screen-sub">Digite ou bipe o NÚMERO da nota (não a chave de 44 dígitos) pra achar o registro de entrada dela.</div></div>
    <input id="saida-numero-input" class="field" inputmode="numeric" autocomplete="off" placeholder="Número da nota" value="${esc(S.saidaNumeroBusca)}" style="font-size:1.1rem;padding:16px;text-align:center;font-weight:700">
    <button class="btn btn-primary" id="saida-buscar-btn" style="padding:15px">Buscar</button>
    ${S.saidaBuscaErro ? `<div style="padding:12px;border-radius:10px;background:#4a1f1f;border:1px solid #7a2b2b;font-size:.82rem;color:#ffb3b3">${esc(S.saidaBuscaErro)}</div>` : ''}
    <button class="btn btn-ghost" data-recusa-modo="voltar" style="padding:12px">← Voltar</button>`;
  }
  function etapaSaidaResultado() {
    const r = S.saidaRecusaEncontrada;
    const n = S.saidaNotaEncontrada;
    if (!r || !n) return etapaSaidaBuscar();
    const tratamento = n.tratamento || '';
    const outrasNotas = (r.notas || []).filter(x => x.chave !== n.chave).map(x => x.numeroNota).filter(Boolean);
    let acao = '';
    if (n.dataSaidaEm) {
      acao = `<div style="padding:12px;border-radius:10px;background:#132a1d;border:1px solid #1e6f4e;font-size:.85rem;color:#8fd9a8">✅ Essa nota já saiu em ${fmtDataSaida(n.dataSaidaEm)}</div>`;
    } else if (tratamento === 'REENTREGA') {
      acao = `<button class="btn btn-primary" id="saida-confirmar-btn" style="padding:16px">Confirmar Saída</button>`;
    } else {
      acao = `<div style="padding:12px;border-radius:10px;background:#4a3114;color:#ffd18a;font-size:.82rem">Esta nota ainda não foi classificada como Reentrega pelo Analista — fale com ele antes de confirmar a saída.</div>`;
    }
    return `
    <div><div class="screen-title">📤 Saída — NF ${esc(n.numeroNota || '—')}</div><div class="screen-sub">Confira as informações antes de confirmar.</div></div>
    <div class="card" style="padding:13px">
      <div style="font-size:.72rem;color:#6f89a6">BOX</div><div style="font-weight:800;margin-bottom:8px">${esc(r.box || '—')}</div>
      <div style="font-size:.72rem;color:#6f89a6">MOTORISTA QUE TROUXE</div><div style="font-weight:800;margin-bottom:8px">${esc(r.motoristaNome || '—')}</div>
      <div style="font-size:.72rem;color:#6f89a6">TRATAMENTO</div><div style="font-weight:800;margin-bottom:8px">${esc(TRATAMENTO_LABELS_SAIDA[tratamento] || tratamento || '—')}</div>
      <div style="font-size:.72rem;color:#6f89a6">NOTAS QUE VIERAM JUNTO NESTE RETORNO</div><div style="font-weight:800">${esc(([n.numeroNota].concat(outrasNotas)).join(' • '))}</div>
    </div>
    ${acao}
    <button class="btn btn-ghost" id="saida-buscar-outra-btn" style="padding:12px">← Buscar outra nota</button>
    <button class="btn btn-ghost" data-recusa-modo="voltar" style="padding:12px">Concluir</button>`;
  }
  function etapaChave() {
    return `
    ${tarefasPendentesHtml()}
    <div><div class="screen-title">↩️ Notas Retornadas</div><div class="screen-sub">Bipe a chave de acesso da NF-e. Você pode incluir várias notas no mesmo retorno.</div></div>
    <input id="recusa-chave-input" class="field" inputmode="numeric" autocomplete="off" placeholder="Bipe a chave de acesso (44 dígitos)" style="font-size:1rem;padding:15px;text-align:center">
    <button class="btn btn-primary" id="recusa-add-chave" style="padding:14px">Adicionar nota</button>
    ${pendenteManualHtml()}
    <div id="recusa-notas-lista" style="display:flex;flex-direction:column;gap:7px;max-height:min(38vh,320px);overflow-y:auto;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch;padding-right:2px">${notasHtml()}</div>
    <button class="btn btn-primary" id="recusa-continuar-1" ${S.notas.length ? '' : 'disabled'} style="padding:15px">Continuar (${S.notas.length} nota${S.notas.length === 1 ? '' : 's'}) →</button>`;
  }
  // PEDIDO AO VIVO (2026-09-03): "o conferente que vai ficar naquele ali não
  // vai precisar nem selecionar... vai descobrir pelo login" — antes era um
  // combo manual igual motorista/motivo; agora é só um aviso, resolvido em
  // resolverConferenteAutomatico() pelo e-mail de quem está logado.
  function conferenteAutoHtml() {
    if (S.conferenteId) {
      const c = S.conferentes.find(x => x._id === S.conferenteId);
      return `<div style="padding:10px 12px;border-radius:9px;background:#15263f;border:1px solid #29486d;font-size:.8rem;color:#9eb4cb">🧑‍🔧 Conferente: <b style="color:#e8f1fb">${esc((c && c.nome) || '—')}</b> <span style="color:#6f89a6">(pelo seu login)</span></div>`;
    }
    return `<div style="padding:10px 12px;border-radius:9px;background:#4a3114;color:#ffd18a;font-size:.78rem">⚠️ Não foi possível identificar o conferente pelo seu login. Peça ao Analista para cadastrar seu e-mail em Cadastros › Conferentes.</div>`;
  }
  function etapaMotorista() {
    return `
    <div><div class="screen-title">Motorista e motivo</div><div class="screen-sub">Selecione quem retornou com a carga e o motivo da devolução.</div></div>
    <div class="card" style="padding:12px"><div style="font-size:.72rem;color:#6f89a6;margin-bottom:5px">NOTAS LIDAS</div><div style="font-weight:800">${S.notas.map(n => 'NF ' + esc(n.numeroNota)).join(' • ')}</div></div>
    <div><div style="font-size:.76rem;font-weight:800;margin-bottom:5px">MOTORISTA</div>${comboBuscaHtml('recusa-motorista', S.motoristas, S.motoristaId, S.buscaMotorista)}</div>
    <div><div style="font-size:.76rem;font-weight:800;margin-bottom:5px">MOTIVO DA VOLTA</div>${comboBuscaHtml('recusa-motivo', S.motivos, S.motivoId, S.buscaMotivo)}</div>
    ${conferenteAutoHtml()}
    ${!S.motoristas.length || !S.motivos.length ? '<div style="padding:10px;border-radius:9px;background:#4a3114;color:#ffd18a;font-size:.78rem">O Analista precisa cadastrar pelo menos um motorista e um motivo na aba Notas Retornadas.</div>' : ''}
    <button class="btn btn-ghost" id="recusa-voltar-2" style="padding:12px">← Voltar</button>
    <button class="btn btn-primary" id="recusa-continuar-2" style="padding:15px">Continuar →</button>`;
  }
  // Pedido ao vivo do usuário: "quando coloca o volume, ele tem que mostrar
  // pro conferente se colocou o volume certo ou não, mostrar tipo o volume
  // correto da nota" — inverteu o comportamento anterior (que escondia de
  // propósito o volume esperado). Agora mostra sempre o esperado, e compara
  // ao vivo (a cada dígito) com o que foi contado.
  // BUG AO VIVO REAL (2026-08-29): "o volume esperado é zero" — desde que
  // o import de PDF (única fonte que trazia "volumes" de verdade, extraído
  // do DANFE) foi removido, toda nota vinda do BI grava volumes:null (o
  // JSON do BI não tem essa informação — ver 97-recebimento-recusas.js).
  // Sem fallback, "esperado" ficava sempre 0, mesmo pra nota com produtos
  // de verdade. Fallback pra soma das quantidades dos itens da nota — não
  // é "volume" no sentido físico (caixa/pallet), mas é o melhor número
  // disponível, e nunca mais fica zerado à toa quando existe itens[].
  function volumeEsperadoNota(n) {
    const v = Number(n.volumes || 0);
    if (v > 0) return v;
    return (n.itens || []).reduce((s, it) => s + Number(it.quantidade || 0), 0);
  }
  function volumeEsperadoTotal() {
    return S.notas.reduce((s, n) => s + volumeEsperadoNota(n), 0);
  }
  // Preenche nome/GTIN a partir do cadastro (producao_produtos) quando a
  // nota (BI) não trouxe — ver comentário de _produtosPorCod acima.
  function _enriquecerItem(it) {
    const cat = _produtosPorCod.get(String(it.produtoKey || ''));
    return {
      ...it,
      descricao: it.descricao || (cat === null || cat === void 0 ? void 0 : cat.nome) || '',
      gtin: it.gtin || (cat === null || cat === void 0 ? void 0 : cat.gtin) || ''
    };
  }
  // PEDIDO AO VIVO (2026-08-29): "vou receber de uma vez três notas do
  // mesmo motorista... vem cinco de um produto numa nota e três na outra,
  // ele vai pedir total de oito" — antes, cada nota virava linhas
  // separadas pro mesmo produto (bipar uma delas nunca completava a
  // outra). Mescla por produtoKey (fallback pra gtin, depois descrição,
  // nessa ordem) somando qtdPrevista e guardando TODAS as notas que
  // contribuíram, pra continuar rastreável na tela.
  function _mesclarItensPorProduto(itensBrutos) {
    const porChave = new Map();
    itensBrutos.forEach(bruto => {
      const it = _enriquecerItem(bruto);
      const chave = String(it.produtoKey || it.gtin || it.descricao || Math.random());
      const atual = porChave.get(chave);
      if (atual) {
        atual.qtdPrevista += it.qtdPrevista;
        if (it.notaNumero && !atual.notasNumeros.includes(it.notaNumero)) atual.notasNumeros.push(it.notaNumero);
      } else {
        porChave.set(chave, {
          ...it,
          qtdConferida: 0,
          notasNumeros: it.notaNumero ? [it.notaNumero] : []
        });
      }
    });
    return [...porChave.values()];
  }
  function feedbackVolumeHtml() {
    const esperado = volumeEsperadoTotal();
    const v = String(S.volume == null ? '' : S.volume).trim();
    if (v === '') {
      return `<div style="padding:12px;border-radius:10px;background:#15263f;border:1px solid #29486d;font-size:.82rem;color:#9eb4cb">Volume esperado da nota: <b>${esperado}</b></div>`;
    }
    const n = Number(v);
    const dif = n - esperado;
    if (!Number.isFinite(n)) return '';
    return dif === 0 ? `<div style="padding:12px;border-radius:10px;background:#132a1d;border:1px solid #1e6f4e;font-size:.85rem;color:#8fd9a8">✅ Confere — volume esperado: ${esperado}</div>` : `<div style="padding:12px;border-radius:10px;background:#4a1f1f;border:1px solid #7a2b2b;font-size:.85rem;color:#ffb3b3">⚠️ Divergente — esperado ${esperado}, contado ${n} (${dif > 0 ? '+' : ''}${dif})</div>`;
  }
  function etapaVolume() {
    return `
    <div><div class="screen-title">Conferência de volumes</div><div class="screen-sub">Conte fisicamente os volumes devolvidos e informe o total encontrado.</div></div>
    <div id="recusa-volume-feedback">${feedbackVolumeHtml()}</div>
    <input id="recusa-volume" class="field" type="number" min="0" step="1" inputmode="numeric" placeholder="Quantidade de volumes contados" value="${esc(S.volume)}" style="font-size:1.15rem;padding:17px;text-align:center;font-weight:850">
    <button class="btn btn-ghost" id="recusa-voltar-3" style="padding:12px">← Voltar</button>
    <button class="btn btn-primary" id="recusa-continuar-3" style="padding:15px">Continuar →</button>`;
  }
  // PEDIDO AO VIVO (2026-09-03): "a última coisa a pedir... é o box e a
  // quantidade de pallets" — passou a ser o ÚLTIMO passo do fluxo normal
  // (depois da conferência dos produtos, ou de "somente volume"), em vez de
  // vir antes da escolha de conferência. Confirmar aqui já grava tudo
  // (finalizar()), não avança pra mais nenhuma etapa de coleta de dado.
  function etapaBox() {
    var _S$motoristas$find, _S$motivos$find, _S$conferentes$find;
    return `
    <div><div class="screen-title">Box e pallets</div><div class="screen-sub">Última etapa: informe onde a carga retornada ficará armazenada.</div></div>
    <input id="recusa-box" class="field" autocomplete="off" placeholder="Ex.: BOX 12" value="${esc(S.box)}" style="font-size:1.1rem;padding:17px;text-align:center;font-weight:850;text-transform:uppercase">
    <input id="recusa-pallets" class="field" type="number" min="0" step="1" inputmode="numeric" placeholder="Quantidade de pallets (opcional)" value="${esc(S.pallets)}" style="font-size:1.05rem;padding:15px;text-align:center">
    <div class="card" style="padding:13px"><div style="font-size:.72rem;color:#6f89a6">RESUMO</div><div style="margin-top:5px;font-weight:800">${S.notas.map(n => 'NF ' + esc(n.numeroNota)).join(' • ')}</div><div style="margin-top:5px;font-size:.78rem;color:#9eb4cb">Motorista: ${esc(((_S$motoristas$find = S.motoristas.find(x => x._id === S.motoristaId)) === null || _S$motoristas$find === void 0 ? void 0 : _S$motoristas$find.nome) || '—')}<br>Motivo: ${esc(((_S$motivos$find = S.motivos.find(x => x._id === S.motivoId)) === null || _S$motivos$find === void 0 ? void 0 : _S$motivos$find.nome) || '—')}${S.conferenteId ? '<br>Conferente: ' + esc(((_S$conferentes$find = S.conferentes.find(x => x._id === S.conferenteId)) === null || _S$conferentes$find === void 0 ? void 0 : _S$conferentes$find.nome) || '—') : ''}<br>Volumes contados: ${esc(S.volume)}</div></div>
    <button class="btn btn-ghost" id="recusa-voltar-4" style="padding:12px">← Voltar</button>
    <button class="btn btn-primary" id="recusa-continuar-4" style="padding:15px">Concluir →</button>`;
  }
  // Escolha entre conferir item a item (quando pelo menos uma nota trouxe
  // itens[] previstos — sincronização Bluesoft/BI — OU quando a nota entrou
  // "sem banco" e por isso a conferência precisa ser livre, bipando contra
  // o catálogo geral de produtos ao vivo — ver bipagemConferencia()) ou
  // receber só o volume (o caminho padrão de sempre, sem mudança de
  // comportamento pra quem não usa conferência de produtos).
  function temItensDisponiveis() {
    return S.notas.some(n => (n.itens || []).length > 0 || n.origemImportacao === 'MANUAL_SEM_BANCO');
  }
  function etapaConferenciaEscolha() {
    return `
    <div><div class="screen-title">Conferência de produtos</div><div class="screen-sub">Escolha como registrar o recebimento desta carga.</div></div>
    ${temItensDisponiveis() ? '' : '<div style="padding:10px;border-radius:9px;background:#15263f;color:#9eb4cb;font-size:.78rem">Nenhuma nota lida tem lista de produtos disponível (só vem da sincronização Bluesoft) — só é possível receber o volume.</div>'}
    <button class="btn btn-primary" id="recusa-conf-itens" ${temItensDisponiveis() ? '' : 'disabled'} style="padding:16px">📦 Conferir produtos</button>
    <button class="btn btn-ghost" id="recusa-conf-somente-volume" style="padding:16px">Receber somente o volume</button>
    <button class="btn btn-ghost" id="recusa-voltar-conferencia" style="padding:12px">← Voltar</button>`;
  }
  function etapaItens() {
    const total = S.itensConferidos.length;
    const conferidos = S.itensConferidos.filter(it => Number(it.qtdConferida) > 0).length;
    // PEDIDO AO VIVO (2026-09-03, pt. 2): quando a nota veio "sem banco"
    // (ver adicionarChave()), não existe itens[] previsto pra bipar contra
    // — cada bipagem cria a linha na hora, buscando no catálogo geral de
    // produtos (ver bipagemConferencia()). Item marcado `semExpectativa`
    // nunca fica com a borda de "divergente" (não tem o que divergir de
    // verdade, porque nunca houve uma quantidade esperada) e mostra "Bipado
    // agora" no lugar de "Previsto".
    return `
    <div><div class="screen-title">Bipe os produtos</div><div class="screen-sub">Bipe o GTIN de cada produto (soma 1 por bipagem) ou digite a quantidade direto. ${conferidos}/${total} produto(s) já conferido(s).</div></div>
    <input id="recusa-conf-scan" class="field" inputmode="numeric" autocomplete="off" placeholder="Bipe o GTIN do produto" style="font-size:1rem;padding:15px;text-align:center">
    <div style="display:flex;flex-direction:column;gap:7px;max-height:340px;overflow:auto">${S.itensConferidos.map((it, i) => {
      const divergente = !it.semExpectativa && Number(it.qtdConferida) !== Number(it.qtdPrevista);
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#101f34;border:1px solid ${divergente ? '#7a4a1f' : '#284567'};border-radius:10px;padding:10px 12px">
        <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.85rem">${esc(it.descricao || 'Produto ' + (it.gtin || it.produtoKey || ''))}</div><div style="font-size:.68rem;color:#6f89a6">GTIN ${esc(it.gtin || '—')} · NF ${esc((it.notasNumeros || []).join(', ') || it.notaNumero || '—')} · ${it.semExpectativa ? 'Bipado agora (fora da lista prevista)' : 'Previsto ' + it.qtdPrevista}</div></div>
        <input class="field conf-item-qtd" type="number" min="0" step="1" style="width:70px;padding:7px;text-align:center;font-size:1.05rem;font-weight:800" value="${esc(it.qtdConferida)}" data-conf-item-qtd="${i}">
      </div>`;
    }).join('')}</div>
    <button class="btn btn-primary" id="recusa-conf-concluir" style="padding:16px">Concluir conferência →</button>
    ${S.modoTarefa ? '' : '<button class="btn btn-ghost" id="recusa-voltar-itens" style="padding:12px">← Voltar</button>'}`;
  }
  function etapaSucesso() {
    const titulo = S.modoTarefa ? 'Conferência concluída' : 'Nota retornada registrada';
    const detalhe = S.modoTarefa ? `<div style="font-weight:850">Box ${esc(S.box)}</div>` : `<div style="font-weight:850">${S.notas.map(n => 'NF ' + esc(n.numeroNota)).join(' • ')}</div><div style="margin-top:7px;color:#9eb4cb">Box ${esc(S.box)}</div>`;
    return `<div style="text-align:center;font-size:3rem">✅</div><div class="screen-title" style="text-align:center">${titulo}</div><div class="card" style="padding:16px;text-align:center">${detalhe}</div><button class="btn btn-primary" id="recusa-nova" style="padding:16px">Registrar outra nota retornada</button><button class="btn btn-ghost" id="recusa-voltar-recebimento" style="padding:14px">Voltar ao Recebimento</button>`;
  }
  const ETAPAS = {
    modo: etapaModo,
    'saida-buscar': etapaSaidaBuscar,
    'saida-resultado': etapaSaidaResultado,
    chave: etapaChave,
    motorista: etapaMotorista,
    volume: etapaVolume,
    conferencia: etapaConferenciaEscolha,
    itens: etapaItens,
    box: etapaBox,
    sucesso: etapaSucesso
  };
  function render() {
    const host = document.getElementById('recusa-fluxo-host');
    if (!host) return;
    host.innerHTML = (ETAPAS[S.etapa] || etapaModo)();
    ligar();
  }
  // Filtragem ao digitar troca só o innerHTML da lista (nunca host.innerHTML
  // inteiro, que recriaria o <input> e derrubaria o foco/cursor no meio da
  // digitação). Seleção via mousedown (não click) — dispara ANTES do blur
  // do input esconder a lista, senão o toque nunca chega a registrar.
  function ligarCombosBusca() {
    Object.keys(COMBO_CAMPOS).forEach(prefixo => {
      const campo = COMBO_CAMPOS[prefixo];
      const input = document.getElementById(prefixo + '-busca');
      const lista = document.getElementById(prefixo + '-lista');
      if (!input || !lista) return;
      input.addEventListener('focus', () => {
        lista.style.display = 'block';
      });
      input.addEventListener('input', () => {
        S[campo.busca] = input.value;
        const itens = comboItens(prefixo);
        const selecionadoAtual = itens.find(x => x._id === S[campo.id]);
        // se o texto não bate mais com o item que estava selecionado, limpa
        // a seleção — evita salvar um motorista/motivo/conferente que não é
        // mais o que está escrito na tela.
        if (!selecionadoAtual || _norm(selecionadoAtual.nome) !== _norm(input.value)) S[campo.id] = '';
        const termoNorm = _norm(input.value);
        const filtrados = termoNorm ? itens.filter(x => _norm(x.nome).includes(termoNorm)) : itens;
        lista.innerHTML = comboOpcoesHtml(prefixo, filtrados);
        lista.style.display = 'block';
      });
      input.addEventListener('blur', () => {
        setTimeout(() => {
          lista.style.display = 'none';
        }, 150);
      });
      lista.addEventListener('mousedown', e => {
        const opcao = e.target.closest('[data-combo-opcao]');
        if (!opcao) return;
        e.preventDefault();
        const valor = opcao.dataset.comboValor;
        const item = comboItens(prefixo).find(x => x._id === valor);
        S[campo.id] = valor;
        S[campo.busca] = (item === null || item === void 0 ? void 0 : item.nome) || '';
        render();
      });
    });
  }
  function ligar() {
    var _document$getElementB3, _document$getElementB4, _document$getElementB5, _document$getElementB7, _document$getElementB8, _document$getElementB0, _document$getElementB10, _document$getElementB11, _document$getElementB12, _document$getElementB13, _document$getElementB16, _document$getElementB19, _document$getElementB21, _document$getElementB22, _document$getElementB23, _document$getElementB24, _document$getElementB25;
    document.querySelectorAll('[data-recusa-modo]').forEach(btn => btn.addEventListener('click', () => {
      const modo = btn.getAttribute('data-recusa-modo');
      if (modo === 'entrada') { S.etapa = 'chave'; render(); focarScan(); return; }
      if (modo === 'saida') { S.etapa = 'saida-buscar'; render(); focarSaidaInput(); return; }
      if (modo === 'voltar') {
        S.etapa = 'modo';
        S.saidaNumeroBusca = '';
        S.saidaBuscaErro = '';
        S.saidaRecusaEncontrada = null;
        S.saidaNotaEncontrada = null;
        render();
      }
    }));
    const saidaInput = document.getElementById('saida-numero-input');
    if (saidaInput) saidaInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscarSaida(); } });
    const saidaBuscarBtn = document.getElementById('saida-buscar-btn');
    if (saidaBuscarBtn) saidaBuscarBtn.addEventListener('click', buscarSaida);
    const saidaConfirmarBtn = document.getElementById('saida-confirmar-btn');
    if (saidaConfirmarBtn) saidaConfirmarBtn.addEventListener('click', confirmarSaida);
    const saidaBuscarOutraBtn = document.getElementById('saida-buscar-outra-btn');
    if (saidaBuscarOutraBtn) saidaBuscarOutraBtn.addEventListener('click', () => {
      S.etapa = 'saida-buscar';
      S.saidaBuscaErro = '';
      S.saidaRecusaEncontrada = null;
      S.saidaNotaEncontrada = null;
      render();
      focarSaidaInput();
    });
    const input = document.getElementById('recusa-chave-input');
    input === null || input === void 0 || input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        adicionarChave();
      }
    });
    (_document$getElementB3 = document.getElementById('recusa-add-chave')) === null || _document$getElementB3 === void 0 || _document$getElementB3.addEventListener('click', adicionarChave);
    var _document$getElementBt = document.getElementById('recusa-chave-manual-cancelar');
    _document$getElementBt === null || _document$getElementBt === void 0 || _document$getElementBt.addEventListener('click', () => {
      S.pendenteChaveManual = '';
      S.pendenteNumeroManual = '';
      render();
      focarScan();
    });
    var _document$getElementBu = document.getElementById('recusa-chave-manual-confirmar');
    _document$getElementBu === null || _document$getElementBu === void 0 || _document$getElementBu.addEventListener('click', () => {
      const numInput = document.getElementById('recusa-chave-manual-numero');
      const numero = String((numInput === null || numInput === void 0 ? void 0 : numInput.value) || '').trim();
      if (!numero) return toast('Informe o número da nota.', 'error');
      S.notas.push({
        chave: S.pendenteChaveManual,
        numeroNota: numero,
        destinatario: '',
        volumes: 0,
        pareceDevolucao: false,
        tipoOperacao: '',
        origemImportacao: 'MANUAL_SEM_BANCO',
        itens: []
      });
      S.pendenteChaveManual = '';
      S.pendenteNumeroManual = '';
      const chaveInput = document.getElementById('recusa-chave-input');
      if (chaveInput) chaveInput.value = '';
      render();
      focarScan();
    });
    document.querySelectorAll('[data-recusa-remover]').forEach(b => b.addEventListener('click', () => {
      S.notas.splice(Number(b.dataset.recusaRemover), 1);
      render();
      focarScan();
    }));
    document.querySelectorAll('[data-tarefa-iniciar]').forEach(b => b.addEventListener('click', () => {
      const t = S.tarefasPendentes.find(x => x._id === b.dataset.tarefaIniciar);
      if (t) iniciarConferenciaDelegada(t);
    }));
    (_document$getElementB4 = document.getElementById('recusa-continuar-1')) === null || _document$getElementB4 === void 0 || _document$getElementB4.addEventListener('click', () => {
      if (!S.notas.length) return;
      S.etapa = 'motorista';
      render();
    });
    ligarCombosBusca();
    (_document$getElementB5 = document.getElementById('recusa-continuar-2')) === null || _document$getElementB5 === void 0 || _document$getElementB5.addEventListener('click', () => {
      const prosseguir = () => {
        if (!S.motoristaId) return toast('Digite o motorista.', 'error');
        if (!S.motivoId) return toast('Digite o motivo da volta.', 'error');
        S.etapa = 'volume';
        render();
        setTimeout(() => {
          var _document$getElementB6;
          return (_document$getElementB6 = document.getElementById('recusa-volume')) === null || _document$getElementB6 === void 0 ? void 0 : _document$getElementB6.focus();
        }, 80);
      };
      // Caminho comum (motorista/motivo já escolhidos de um item existente
      // da lista) continua 100% síncrono, igual sempre foi — só entra no
      // caminho assíncrono (cadastra na hora) quando falta mesmo cadastrar
      // algo novo, digitado sem corresponder a nenhum item já existente.
      if (S.motoristaId && S.motivoId) return prosseguir();
      const botao = document.getElementById('recusa-continuar-2');
      const textoOriginal = botao ? botao.textContent : '';
      (async () => {
        try {
          if (botao) { botao.disabled = true; botao.textContent = 'Verificando...'; }
          await garantirItemComboSelecionado('recusa-motorista');
          await garantirItemComboSelecionado('recusa-motivo');
        } catch (e) {
          toast('Erro ao cadastrar: ' + (e.message || e), 'error');
          return;
        } finally {
          if (botao) { botao.disabled = false; botao.textContent = textoOriginal; }
        }
        prosseguir();
      })();
    });
    // Pedido ao vivo do usuário: "aperto em voltar para ajustar o anterior
    // ele volta tudo e tem que refazer tudo" — nenhum passo tinha botão de
    // voltar antes disso; só mudam S.etapa, nunca reset(), então tudo que
    // já foi preenchido continua lá quando o operador volta a avançar.
    (_document$getElementB7 = document.getElementById('recusa-voltar-2')) === null || _document$getElementB7 === void 0 || _document$getElementB7.addEventListener('click', () => {
      S.etapa = 'chave';
      render();
      focarScan();
    });
    (_document$getElementB8 = document.getElementById('recusa-voltar-3')) === null || _document$getElementB8 === void 0 || _document$getElementB8.addEventListener('click', () => {
      var _document$getElementB9;
      S.volume = String(((_document$getElementB9 = document.getElementById('recusa-volume')) === null || _document$getElementB9 === void 0 ? void 0 : _document$getElementB9.value) || S.volume || '');
      S.etapa = 'motorista';
      render();
    });
    (_document$getElementB10 = document.getElementById('recusa-voltar-conferencia')) === null || _document$getElementB10 === void 0 || _document$getElementB10.addEventListener('click', () => {
      S.etapa = 'volume';
      render();
      setTimeout(() => {
        var _document$getElementBv;
        return (_document$getElementBv = document.getElementById('recusa-volume')) === null || _document$getElementBv === void 0 ? void 0 : _document$getElementBv.focus();
      }, 80);
    });
    (_document$getElementB11 = document.getElementById('recusa-voltar-itens')) === null || _document$getElementB11 === void 0 || _document$getElementB11.addEventListener('click', () => {
      S.etapa = 'conferencia';
      render();
    });
    // Box virou o ÚLTIMO passo (depois da conferência/escolha) — voltar dali
    // precisa cair na etapa que realmente veio antes dele: "itens" se o
    // operador escolheu conferir produto a produto, ou "conferencia" (a tela
    // de escolha) se escolheu "Receber somente o volume".
    (_document$getElementB0 = document.getElementById('recusa-voltar-4')) === null || _document$getElementB0 === void 0 || _document$getElementB0.addEventListener('click', () => {
      S.etapa = S.modoConferencia === 'ITENS' ? 'itens' : 'conferencia';
      render();
    });
    // Feedback de volume ao vivo (a cada dígito) — só troca o innerHTML do
    // bloco de feedback, nunca o input inteiro, senão perde o foco/cursor
    // no meio da digitação.
    (_document$getElementB12 = document.getElementById('recusa-volume')) === null || _document$getElementB12 === void 0 || _document$getElementB12.addEventListener('input', e => {
      S.volume = e.target.value === '' ? '' : Number(e.target.value);
      const alvo = document.getElementById('recusa-volume-feedback');
      if (alvo) alvo.innerHTML = feedbackVolumeHtml();
    });
    (_document$getElementB13 = document.getElementById('recusa-continuar-3')) === null || _document$getElementB13 === void 0 || _document$getElementB13.addEventListener('click', () => {
      var _document$getElementB14;
      const v = String(((_document$getElementB14 = document.getElementById('recusa-volume')) === null || _document$getElementB14 === void 0 ? void 0 : _document$getElementB14.value) || '').trim();
      const n = Number(v);
      if (v === '' || !Number.isInteger(n) || n < 0) return toast('Informe a quantidade de volumes contados.', 'error');
      S.volume = n;
      S.etapa = 'conferencia';
      render();
    });
    // Box/pallets agora é o ÚLTIMO passo (depois da conferência dos
    // produtos, ou de "somente volume") — confirmar aqui já grava o
    // registro (finalizar()), em vez de avançar pra mais uma etapa.
    (_document$getElementB16 = document.getElementById('recusa-continuar-4')) === null || _document$getElementB16 === void 0 || _document$getElementB16.addEventListener('click', () => {
      var _document$getElementB17, _document$getElementB18;
      const box = String(((_document$getElementB17 = document.getElementById('recusa-box')) === null || _document$getElementB17 === void 0 ? void 0 : _document$getElementB17.value) || '').trim().toUpperCase();
      if (!box) return toast('Informe o número do Box.', 'error');
      const pallets = String(((_document$getElementB18 = document.getElementById('recusa-pallets')) === null || _document$getElementB18 === void 0 ? void 0 : _document$getElementB18.value) || '').trim();
      S.box = box;
      S.pallets = pallets;
      finalizar();
    });
    (_document$getElementB19 = document.getElementById('recusa-conf-itens')) === null || _document$getElementB19 === void 0 || _document$getElementB19.addEventListener('click', () => {
      S.modoConferencia = 'ITENS';
      const itensBrutos = S.notas.flatMap(n => (n.itens || []).map(it => {
        var _it$produtoKey2;
        return {
          produtoKey: (_it$produtoKey2 = it.produtoKey) !== null && _it$produtoKey2 !== void 0 ? _it$produtoKey2 : null,
          descricao: it.descricao || '',
          gtin: it.gtin || '',
          dun: it.dun || '',
          qtdPrevista: Number(it.quantidade) || 0,
          notaChave: n.chave,
          notaNumero: n.numeroNota
        };
      }));
      S.itensConferidos = _mesclarItensPorProduto(itensBrutos);
      S.etapa = 'itens';
      render();
      setTimeout(() => {
        var _document$getElementB20;
        return (_document$getElementB20 = document.getElementById('recusa-conf-scan')) === null || _document$getElementB20 === void 0 ? void 0 : _document$getElementB20.focus();
      }, 80);
    });
    (_document$getElementB21 = document.getElementById('recusa-conf-somente-volume')) === null || _document$getElementB21 === void 0 || _document$getElementB21.addEventListener('click', () => {
      S.modoConferencia = 'SOMENTE_VOLUME';
      S.itensConferidos = [];
      S.etapa = 'box';
      render();
      setTimeout(() => {
        var _document$getElementBx;
        return (_document$getElementBx = document.getElementById('recusa-box')) === null || _document$getElementBx === void 0 ? void 0 : _document$getElementBx.focus();
      }, 80);
    });
    (_document$getElementB22 = document.getElementById('recusa-conf-scan')) === null || _document$getElementB22 === void 0 || _document$getElementB22.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        bipagemConferencia();
      }
    });
    document.querySelectorAll('[data-conf-item-qtd]').forEach(el => el.addEventListener('input', () => {
      const i = Number(el.dataset.confItemQtd);
      const v = Number(el.value);
      if (S.itensConferidos[i]) S.itensConferidos[i].qtdConferida = Number.isFinite(v) && v >= 0 ? v : 0;
    }));
    // Fluxo normal: concluir a bipagem dos itens leva pro último passo (Box
    // + pallets), NÃO grava ainda. Conferência DELEGADA (modoTarefa) não tem
    // passo de Box nesse fluxo (já veio da recusa original) — continua
    // gravando direto, como sempre (finalizar() despacha pra
    // concluirConferenciaDelegada() nesse caso).
    (_document$getElementB23 = document.getElementById('recusa-conf-concluir')) === null || _document$getElementB23 === void 0 || _document$getElementB23.addEventListener('click', () => {
      if (S.modoTarefa) return finalizar();
      S.etapa = 'box';
      render();
      setTimeout(() => {
        var _document$getElementBy;
        return (_document$getElementBy = document.getElementById('recusa-box')) === null || _document$getElementBy === void 0 ? void 0 : _document$getElementBy.focus();
      }, 80);
    });
    (_document$getElementB24 = document.getElementById('recusa-nova')) === null || _document$getElementB24 === void 0 || _document$getElementB24.addEventListener('click', abrirRecusasRecebimento);
    (_document$getElementB25 = document.getElementById('recusa-voltar-recebimento')) === null || _document$getElementB25 === void 0 || _document$getElementB25.addEventListener('click', () => {
      var _global$goScreen3;
      return (_global$goScreen3 = global.goScreen) === null || _global$goScreen3 === void 0 ? void 0 : _global$goScreen3.call(global, 'recebimento-modo');
    });
  }

  // Bipagem item a item — mesmo padrão já usado nesta tela (listener local
  // de Enter no campo focado, sem precisar de câmera/ZXing: o leitor de
  // hardware funciona como teclado). Cada bipagem soma 1 na quantidade
  // conferida do item cujo GTIN bateu.
  function bipagemConferencia() {
    const input = document.getElementById('recusa-conf-scan');
    const codigo = String((input === null || input === void 0 ? void 0 : input.value) || '').trim();
    if (!codigo) return;
    // PEDIDO AO VIVO (2026-09-02): "o gtin ficou com o dun também, cada um
    // no lugar certo" — gtin (Analista) passou a guardar só o EAN
    // (unidade); quem bate o código da CAIXA que volta continua batendo,
    // porque agora compara também com `it.dun` (DUN-14 da caixa), que é
    // o item novo gravado separado.
    const idx = S.itensConferidos.findIndex(it => (it.dun && it.dun === codigo) || (it.gtin && it.gtin === codigo));
    if (idx < 0) {
      // PEDIDO AO VIVO (2026-09-03, pt. 2): "mostrar qual é o produto que
      // ele bipou" — nota sem itens[] previsto (banco desatualizado) não
      // tem NADA nesta lista pra bater; em vez de só dizer "não encontrado",
      // procura no catálogo geral de produtos (por GTIN) e cria a linha na
      // hora. Sem achar nem lá (código estranho, ou é um DUN de caixa —
      // producao_produtos só cadastra GTIN de unidade), aí sim é erro de
      // verdade.
      const prod = _produtosPorGtin.get(codigo);
      if (!prod) {
        toast('Produto não encontrado nesta carga.', 'error');
        input.value = '';
        return;
      }
      S.itensConferidos.push({
        produtoKey: prod.cod || null,
        descricao: prod.nome || '',
        gtin: codigo,
        dun: '',
        qtdPrevista: 0,
        qtdConferida: 1,
        notasNumeros: [],
        semExpectativa: true
      });
      input.value = '';
      render();
      setTimeout(() => {
        var _document$getElementBz;
        return (_document$getElementBz = document.getElementById('recusa-conf-scan')) === null || _document$getElementBz === void 0 ? void 0 : _document$getElementBz.focus();
      }, 80);
      return;
    }
    S.itensConferidos[idx].qtdConferida = Number(S.itensConferidos[idx].qtdConferida || 0) + 1;
    input.value = '';
    render();
    setTimeout(() => {
      var _document$getElementB26;
      return (_document$getElementB26 = document.getElementById('recusa-conf-scan')) === null || _document$getElementB26 === void 0 ? void 0 : _document$getElementB26.focus();
    }, 80);
  }
  async function adicionarChave() {
    if (S.carregando) return;
    const input = document.getElementById('recusa-chave-input');
    const chave = String((input === null || input === void 0 ? void 0 : input.value) || '').replace(/\D/g, '');
    if (chave.length !== 44 || !chaveValida(chave)) {
      toast('Chave de acesso inválida. Bipe os 44 dígitos da NF-e.', 'error');
      input === null || input === void 0 || input.select();
      return;
    }
    if (S.notas.some(n => n.chave === chave)) {
      toast('Essa nota já foi adicionada neste retorno.', 'error');
      input.value = '';
      focarScan();
      return;
    }
    S.carregando = true;
    try {
      // PEDIDO AO VIVO (2026-09-03): "as notas podem gravar direto, mas
      // ainda vai continuar recebendo por aqui também... quando o
      // conferência aqui receber ela, aí vai mudar o gráfico [pra]
      // recebida" — devolução com motivo qualificado (falta de produto,
      // produto errado, etc.) já vira um recebimento_recusas automático
      // (origem:'AUTOMATICO', ver 100-consulta-notas-fiscais.js) assim que
      // o BI traz a nota, sem passar pelo Coletor. Isso NÃO significa que a
      // carga física já voltou — só um busca ONE vez por chave (nunca por
      // .limit(1), que poderia pegar o doc errado quando os dois existem)
      // pra descobrir se: (a) já existe um retorno FÍSICO de verdade pra
      // essa chave (qualquer origem != 'AUTOMATICO') — bloqueia, igual
      // sempre foi; (b) só existe o automático — deixa bipar, e o registro
      // que o finalizar() criar aqui (origem:'COLETOR') é o que confirma o
      // retorno físico pro gráfico de Indicadores de Devoluções.
      const hist = await fs().collection(COL_RECUSAS).where('chaves', 'array-contains', chave).get();
      const registroFisico = hist.docs.find(d => (d.data() || {}).origem !== 'AUTOMATICO');
      if (registroFisico) {
        toast('ATENÇÃO: esta NF já possui um retorno registrado. Procure o Analista antes de lançar novamente.', 'error');
        return;
      }
      const registroAutomatico = hist.docs.find(d => (d.data() || {}).origem === 'AUTOMATICO');
      const doc = await fs().collection(COL_NOTAS).doc(chave).get();
      if (doc.exists) {
        const d = doc.data() || {};
        S.notas.push({
          chave,
          numeroNota: d.numeroNota || '',
          destinatario: d.destinatario || '',
          volumes: Number(d.volumes || 0),
          pareceDevolucao: !!d.pareceDevolucao,
          tipoOperacao: d.tipoOperacao || '',
          origemImportacao: d.origemImportacao || '',
          itens: Array.isArray(d.itens) ? d.itens : []
        });
      } else if (registroAutomatico) {
        // A chave bipada é a da própria nota de DEVOLUÇÃO (não está no
        // ledger de venda, que só guarda chave de VENDA) — os dados vêm do
        // recebimento_recusas automático que o BI já gravou.
        const dadosAuto = registroAutomatico.data() || {};
        const notaAuto = (dadosAuto.notas || [])[0] || {};
        toast('Nota de devolução já registrada automaticamente (motivo: ' + (dadosAuto.motivoNome || '—') + '). Confirmando o recebimento físico agora.', 'success');
        S.notas.push({
          chave,
          numeroNota: notaAuto.numeroNota || '',
          destinatario: dadosAuto.destinatario || notaAuto.destinatario || '',
          volumes: 0,
          pareceDevolucao: true,
          tipoOperacao: 'DEVOLUCAO_AUTOMATICA',
          origemImportacao: 'AUTOMATICO',
          itens: Array.isArray(notaAuto.itens) ? notaAuto.itens : []
        });
      } else {
        // PEDIDO AO VIVO (2026-09-03, pt. 2): "o banco de dados não está
        // atualizado... deixar prosseguir, e ele vai bipar normal a chave
        // de acesso, e aí caso não ache a pessoa vai colocar manualmente o
        // número da nota" — em vez de travar aqui, fica pendente até o
        // operador confirmar (ou corrigir) o número, pré-preenchido a
        // partir da própria chave (numeroNotaDaChave).
        S.pendenteChaveManual = chave;
        S.pendenteNumeroManual = numeroNotaDaChave(chave);
        render();
        setTimeout(() => {
          var _document$getElementBw;
          return (_document$getElementBw = document.getElementById('recusa-chave-manual-numero')) === null || _document$getElementBw === void 0 ? void 0 : _document$getElementBw.focus();
        }, 80);
        return;
      }
      input.value = '';
      render();
      focarScan();
    } catch (e) {
      toast('Erro ao consultar a nota: ' + (e.message || e), 'error');
    } finally {
      S.carregando = false;
    }
  }

  // FASE 8 — conclui uma conferência DELEGADA: atualiza a recusa original
  // (nunca cria um segundo registro pra mesma carga) e marca a tarefa como
  // concluída. Caminho totalmente separado do finalizar() normal — os dois
  // só dividem o cálculo de divergência.
  async function concluirConferenciaDelegada() {
    const u = usuario();
    // `semExpectativa` (item bipado livremente porque a nota não tinha
    // itens[] previsto — ver bipagemConferencia()) nunca conta pra
    // divergência: não existe quantidade esperada pra comparar contra.
    const temDivergenciaItens = S.itensConferidos.some(it => !it.semExpectativa && Number(it.qtdConferida) !== Number(it.qtdPrevista));
    const statusConferenciaOperacional = temDivergenciaItens ? 'CONFERIDA_COM_DIVERGENCIA' : 'CONFERIDA';
    try {
      const btn = document.getElementById('recusa-conf-concluir');
      if (btn) btn.disabled = true;
      await fs().collection(COL_RECUSAS).doc(S.recusaIdOriginal).update({
        statusConferenciaOperacional,
        itensConferidos: S.itensConferidos,
        conferenciaConcluidaEm: new Date().toISOString(),
        conferenciaConcluidaPorUid: u.uid,
        conferenciaConcluidaPorEmail: u.email
      });
      await fs().collection(COL_TAREFAS).doc(S.tarefaId).update({
        status: 'CONCLUIDA',
        concluidaEm: new Date().toISOString(),
        concluidaPorUid: u.uid,
        concluidaPorEmail: u.email
      });
      S.etapa = 'sucesso';
      render();
    } catch (e) {
      toast('Erro ao concluir conferência: ' + (e.message || e), 'error');
      const btn = document.getElementById('recusa-conf-concluir');
      if (btn) btn.disabled = false;
    }
  }
  async function finalizar() {
    if (S.modoTarefa) return concluirConferenciaDelegada();
    const mot = S.motoristas.find(x => x._id === S.motoristaId),
      motivo = S.motivos.find(x => x._id === S.motivoId);
    if (!mot || !motivo) return toast('Motorista ou motivo inválido. Volte e selecione novamente.', 'error');
    if (!S.box) return toast('Informe o número do Box.', 'error');
    const esperado = volumeEsperadoTotal(),
      informado = Number(S.volume || 0),
      dif = informado - esperado,
      u = usuario();
    let statusConferenciaOperacional = 'NAO_REALIZADA';
    if (S.modoConferencia === 'ITENS') {
      const temDivergenciaItens = S.itensConferidos.some(it => !it.semExpectativa && Number(it.qtdConferida) !== Number(it.qtdPrevista));
      statusConferenciaOperacional = temDivergenciaItens ? 'CONFERIDA_COM_DIVERGENCIA' : 'CONFERIDA';
    }
    const conferente = S.conferentes.find(x => x._id === S.conferenteId);
    const payload = {
      chaves: S.notas.map(n => n.chave),
      // PEDIDO AO VIVO (2026-09-08): "Saída" (ver mais abaixo) busca a nota
      // pelo NÚMERO impresso (o que o operador tem em mãos), não pela
      // chave de 44 dígitos — mesmo padrão de `chaves` acima (array irmão
      // só pra permitir `.where('numerosNotas','array-contains',...)`,
      // sem baixar a coleção inteira pra filtrar no cliente).
      numerosNotas: S.notas.map(n => n.numeroNota),
      // Box por nota (Pátio em Tempo Real, 105-recebimento-patio-tempo-
      // real.js) — mesmo valor pra todas aqui (é o mesmo evento de
      // conferência, chegam juntas no mesmo Box); `payload.box` abaixo
      // continua gravado por compatibilidade com telas antigas que só
      // leem o campo do documento.
      notas: S.notas.map(n => ({
        chave: n.chave,
        numeroNota: n.numeroNota,
        volumeEsperado: volumeEsperadoNota(n),
        destinatario: n.destinatario || '',
        box: S.box
      })),
      motoristaId: mot._id,
      motoristaNome: mot.nome || '',
      motivoId: motivo._id,
      motivoNome: motivo.nome || '',
      conferenteId: (conferente === null || conferente === void 0 ? void 0 : conferente._id) || '',
      conferenteNome: (conferente === null || conferente === void 0 ? void 0 : conferente.nome) || '',
      volumeEsperado: esperado,
      volumeInformado: informado,
      diferencaVolumes: dif,
      conferenciaStatus: dif === 0 ? 'CONFERIDO' : 'DIVERGENTE',
      box: S.box,
      pallets: S.pallets !== '' ? Number(S.pallets) : null,
      statusConferenciaOperacional,
      itensConferidos: S.itensConferidos,
      criadoEm: new Date().toISOString(),
      criadoPorUid: u.uid,
      criadoPorEmail: u.email,
      origem: 'COLETOR',
      // Pátio em Tempo Real (105-recebimento-patio-tempo-real.js) — toda
      // entrada nova começa fisicamente presente.
      statusFisico: 'NO_PATIO'
    };
    try {
      const btn = document.getElementById('recusa-continuar-4');
      if (btn) {
        btn.disabled = true;
      }
      await fs().collection(COL_RECUSAS).add(payload);
      S.etapa = 'sucesso';
      render();
    } catch (e) {
      toast('Erro ao registrar nota retornada: ' + (e.message || e), 'error');
      const btn = document.getElementById('recusa-continuar-4');
      if (btn) {
        btn.disabled = false;
      }
    }
  }

  // Navegação hierárquica (pedido ao vivo do usuário): a entrada não é mais
  // um botão dentro da tela do Transbordo — virou um card na nova tela de
  // escolha (screen-recebimento-modo, onclick="abrirRecusasRecebimento()"),
  // mesmo padrão simples já usado por abrirModoInventario()/
  // abrirModoAuditoria(). Sem mais wiring por listener delegado.
  global.abrirRecusasRecebimento = abrirRecusasRecebimento;
})(window);