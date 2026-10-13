// Coletor > Recebimento > Inventário do Pátio
// PEDIDO AO VIVO (2026-09-10): ferramenta de implantação/conciliação —
// "fotografa" as notas que já estão fisicamente paradas no pátio (Recusa/
// Reentrega) mas que nunca passaram pelo fluxo normal de Entrada.
// PEDIDO AO VIVO (2026-09-22): "quero apagar as notas do pátio, mas sem
// mexer no banco de notas retornadas... fazer um inventário: digita tudo
// que tem, e o que não digitar sai do pátio sozinho" — a tela virou um
// fluxo só (não precisava de tela nova separada, pedido ao vivo): pra cada
// número digitado, ou a nota já é conhecida (só CONFIRMA presença, sem
// gravar nada) ou é nova/tinha saído (pede o Box e CADASTRA, igual sempre
// foi). Ao apertar "Finalizar", qualquer nota que estava marcada como
// presente e NÃO foi digitada é ENCERRADA (statusFisico:'SAIU') — nunca
// apaga o documento, o histórico em Notas Retornadas continua pra sempre,
// só a classificação de "onde ela está" muda:
//   - Recusa não encontrada    → statusRetorno vira FINALIZADO (mesmo campo
//     que 99-recebimento-retornos-status.js/mudarStatusRetorno já usa).
//   - Reentrega não encontrada → dataSaidaEm = agora (mesmo campo que
//     confirmarSaida() em 24-recebimento-recusas.js já usa).
//   - Sem classificação nenhuma → confirmadoAusenteEm = agora (campo NOVO,
//     ver comentário em estaNoPatio() abaixo — sem classificação não existe
//     outro jeito de "sair").
// PEDIDO AO VIVO (2026-09-22, também): identificação por NÚMERO da nota,
// não mais pela chave de acesso de 44 dígitos — mesma busca em 2 passos já
// usada por "Rastrear"/"Saída" em 24-recebimento-recusas.js
// (_buscarRecusaPorNumero: numerosNotas indexado, senão escaneia notas[]
// por numeroNota), duplicada aqui de propósito (bundle separado do
// Coletor).
// IMPORTANTE (ver 25-recebimento-paletes.js): NUNCA usar ?./?? neste
// arquivo — coletores industriais antigos (Memor K, WebView Chromium
// 66/2018) travam com SyntaxError nessa sintaxe e derrubam o arquivo
// inteiro (nenhuma função dele fica definida — o botão de menu que chama
// abrirInventarioPatio() simplesmente não responde ao toque). Sempre
// `x && x.y` / ternário em vez disso.
(function (global) {
  'use strict';

  const COL_RECUSAS = 'recebimento_recusas';

  let S = {
    etapa: 'bipar', // bipar | novo | resumo | concluido
    confirmadas: [], // [numeroNota] já vistos nesta conferência (achados OU recém cadastrados), sem duplicar
    pendenteNovo: '', // número não encontrado (ou já tinha saído), aguardando Box pra (re)cadastrar
    carregando: false,
    resumo: null, // {aEncerrar, qtdRecusa, qtdReentrega, qtdSemClassificacao, qtdEncontradas, qtdTotalEncerrar}
  };

  function fs() {
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }
  function toast(m, t) { if (typeof global.toast === 'function') global.toast(m, t); else alert(m); }
  function usuario() {
    const authObj = global.getDTAuth && global.getDTAuth();
    const u = authObj && authObj.currentUser;
    return u ? { uid: u.uid || '', email: u.email || '' } : { uid: '', email: '' };
  }
  // PEDIDO AO VIVO (2026-09-11): "por que não tá trazendo a pessoa na
  // coluna de conferente? Na hora de criar o login já coloco o nome" —
  // mesmo raciocínio aplicado em 24-recebimento-recusas.js: usa direto o
  // nome já gravado no login (APP.operador.name), sem exigir nenhum
  // cadastro extra.
  function _nomeLoginAtual() {
    return (typeof APP !== 'undefined' && APP.operador && APP.operador.name) || '';
  }
  function _maisRecenteDaLista(docs) {
    return docs.slice().sort(function (a, b) { return String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')); })[0];
  }
  // Mesma busca em 2 passos de 24-recebimento-recusas.js/
  // _buscarRecusaPorNumero (duplicada de propósito, bundle separado): 1º
  // tenta `numerosNotas` (indexado, barato), só cai pra escanear a coleção
  // inteira (já loja-escopada) quando a via rápida não acha nada — cobre
  // registro antigo sem esse campo.
  async function _buscarRecusaPorNumero(numero) {
    let doc = null;
    const snapRapido = await fs().collection(COL_RECUSAS).where('numerosNotas', 'array-contains', numero).get();
    if (!snapRapido.empty) {
      doc = _maisRecenteDaLista(snapRapido.docs.map(function (d) { return Object.assign({ _id: d.id }, d.data()); }));
    } else {
      const snapTudo = await fs().collection(COL_RECUSAS).get();
      const achados = snapTudo.docs.map(function (d) { return Object.assign({ _id: d.id }, d.data()); })
        .filter(function (r) { return (r.notas || []).some(function (n) { return String(n.numeroNota || '').trim() === numero; }); });
      if (achados.length) doc = _maisRecenteDaLista(achados);
    }
    if (!doc) return null;
    const nota = (doc.notas || []).find(function (n) { return String(n.numeroNota || '').trim() === numero; });
    if (!nota) return null;
    return { doc: doc, nota: nota };
  }
  // MESMA regra de "está no pátio" de 24/97/99/105 — os 5 lugares que
  // decidem isso precisam concordar sempre.
  function estaNoPatio(doc, nota) {
    if (doc.origem !== 'COLETOR' && doc.origem !== 'INVENTARIO_INICIAL') return false;
    // PEDIDO AO VIVO (2026-09-22): o "Finalizar" (ver confirmarFinalizacao
    // abaixo) confirma que uma nota SEM classificação (nem Recusa nem
    // Reentrega) não está mais lá — as 2 branches abaixo são os únicos
    // jeitos de "sair" hoje, então sem este campo uma nota em branco nunca
    // teria como deixar de contar como presente.
    const confirmadoAusente = nota.confirmadoAusenteEm != null ? nota.confirmadoAusenteEm : doc.confirmadoAusenteEm;
    if (confirmadoAusente) return false;
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
    return notas.some(function (n) { return estaNoPatio(doc, n); }) ? 'NO_PATIO' : 'SAIU';
  }

  function reset() {
    S = { etapa: 'bipar', confirmadas: [], pendenteNovo: '', carregando: false, resumo: null };
  }

  function abrirInventarioPatio() {
    reset();
    if (global.goScreen) global.goScreen('recebimento-patio-inventario');
    render();
    focarNumero();
  }
  function focarNumero() {
    setTimeout(function () { const el = document.getElementById('patio-numero-input'); if (el) el.focus(); }, 80);
  }

  // Pra cada número digitado: já conhecida e presente → só confirma (sem
  // gravar nada). Não encontrada, ou encontrada mas já tinha saído (voltou
  // fisicamente de novo) → pede o Box e (re)cadastra, igual sempre foi.
  async function consultarNumero() {
    const input = document.getElementById('patio-numero-input');
    const numero = String((input && input.value) || '').trim();
    if (!numero) { toast('Informe o número da nota.', 'error'); if (input) input.focus(); return; }
    if (S.confirmadas.indexOf(numero) !== -1) {
      toast('Essa nota já foi confirmada nesta conferência.', 'warning');
      if (input) input.value = '';
      focarNumero();
      return;
    }
    S.carregando = true; render();
    try {
      const achado = await _buscarRecusaPorNumero(numero);
      if (achado && estaNoPatio(achado.doc, achado.nota)) {
        S.confirmadas.push(numero);
        toast('Nota ' + numero + ' confirmada (' + S.confirmadas.length + ').', 'success');
        if (input) input.value = '';
        S.carregando = false;
        render();
        focarNumero();
        return;
      }
      // Não achou nenhum registro, ou achou mas já tinha saído do pátio
      // antes (voltou fisicamente de novo) — os dois casos pedem o Box e
      // cadastram um novo evento de presença.
      S.pendenteNovo = numero;
      S.etapa = 'novo';
      render();
    } catch (e) {
      toast('Erro ao consultar a nota: ' + (e.message || e), 'error');
      render();
    } finally {
      S.carregando = false;
    }
  }

  async function confirmarNovoLancamento() {
    const boxInput = document.getElementById('patio-box-input');
    const box = String((boxInput && boxInput.value) || '').trim().toUpperCase();
    if (!box) { toast('Informe o Box onde a nota está.', 'error'); if (boxInput) boxInput.focus(); return; }
    const numero = S.pendenteNovo;
    // PEDIDO AO VIVO (2026-09-22): "não pede motorista não, né? Só vai
    // pedir o Box e a quantidade de pallet" — mesmo critério já usado em
    // "Identificar" (identificarSalvar, 24-recebimento-recusas.js): quem
    // não bipou a nota na Entrada normal não tem como saber quem foi o
    // motorista, então nem pede — só Box (obrigatório) e pallets
    // (opcional). Mesmo nome de campo (`pallets`, número topo do doc) pra
    // ficar consistente com o resto do sistema.
    const palletsInput = document.getElementById('patio-pallets-input');
    const pallets = String((palletsInput && palletsInput.value) || '').trim();
    const u = usuario();
    const agora = new Date().toISOString();
    const payload = {
      numerosNotas: [numero],
      notas: [{ numeroNota: numero, box: box }],
      box: box,
      pallets: pallets !== '' ? Number(pallets) : null,
      conferenteNome: _nomeLoginAtual(),
      origem: 'INVENTARIO_INICIAL',
      statusFisico: 'NO_PATIO',
      criadoEm: agora,
      criadoPorUid: u.uid,
      criadoPorEmail: u.email,
    };
    const btn = document.getElementById('patio-confirmar-btn');
    if (btn) btn.disabled = true;
    try {
      await fs().collection(COL_RECUSAS).add(payload);
      S.confirmadas.push(numero);
      S.pendenteNovo = '';
      S.etapa = 'bipar';
      toast('Nota ' + numero + ' cadastrada e confirmada.', 'success');
      render();
      focarNumero();
    } catch (e) {
      toast('Erro ao cadastrar: ' + (e.message || e), 'error');
      if (btn) btn.disabled = false;
    }
  }

  function removerConfirmada(numero) {
    S.confirmadas = S.confirmadas.filter(function (n) { return n !== numero; });
    render();
  }

  // Consulta TODAS as notas ainda marcadas NO_PATIO (statusFisico é
  // indexado pra isso, nunca escaneia a coleção inteira) e separa em "vai
  // ficar" (foi confirmada) vs "vai ser encerrada" (não foi confirmada).
  async function _prepararResumo() {
    const snap = await fs().collection(COL_RECUSAS).where('statusFisico', '==', 'NO_PATIO').get();
    const numerosConfirmados = {};
    S.confirmadas.forEach(function (numero) { numerosConfirmados[numero] = true; });
    const aEncerrar = []; // [{docId, doc, numeros:[numeroNota,...]}]
    let qtdRecusa = 0, qtdReentrega = 0, qtdSemClassificacao = 0, qtdEncontradas = 0;
    snap.docs.forEach(function (d) {
      const doc = d.data() || {};
      const notas = Array.isArray(doc.notas) && doc.notas.length ? doc.notas : [{}];
      const numerosParaEncerrar = [];
      notas.forEach(function (nota) {
        if (!estaNoPatio(doc, nota)) return;
        const numeroNota = String(nota.numeroNota || '').trim();
        if (numeroNota && numerosConfirmados[numeroNota]) { qtdEncontradas++; return; }
        const tratamento = nota.tratamento != null ? nota.tratamento : (doc.tratamento || '');
        if (tratamento === 'RECUSA') qtdRecusa++;
        else if (tratamento === 'REENTREGA') qtdReentrega++;
        else qtdSemClassificacao++;
        numerosParaEncerrar.push(numeroNota);
      });
      if (numerosParaEncerrar.length) aEncerrar.push({ docId: d.id, doc: doc, numeros: numerosParaEncerrar });
    });
    S.resumo = { aEncerrar: aEncerrar, qtdRecusa: qtdRecusa, qtdReentrega: qtdReentrega, qtdSemClassificacao: qtdSemClassificacao, qtdEncontradas: qtdEncontradas, qtdTotalEncerrar: qtdRecusa + qtdReentrega + qtdSemClassificacao };
  }

  async function irParaResumo() {
    if (!S.confirmadas.length) {
      toast('Confirme ao menos 1 nota antes de finalizar, ou volte sem finalizar.', 'error');
      return;
    }
    S.carregando = true; render();
    try {
      await _prepararResumo();
      S.etapa = 'resumo';
    } catch (e) {
      toast('Erro ao preparar o resumo: ' + (e.message || e), 'error');
    } finally {
      S.carregando = false; render();
    }
  }

  // Grava de verdade — só chamado depois da tela de resumo, com o operador
  // já tendo visto quantas notas vão ser encerradas. 1 lote por documento
  // (mesmo padrão read-modify-write de confirmarSaida()/mudarStatusRetorno
  // — nunca troca statusFisico sem recalcular a partir das notas[] já
  // atualizadas).
  async function confirmarFinalizacao() {
    if (!S.resumo || !S.resumo.aEncerrar.length) { S.etapa = 'concluido'; render(); return; }
    const btn = document.getElementById('patio-finalizar-confirmar-btn');
    if (btn) btn.disabled = true;
    const u = usuario();
    const agora = new Date().toISOString();
    const notasEncerradas = []; // [{numeroNota, docId, tratamento}] — pro snapshot da sessão (ver abaixo)
    try {
      for (let i = 0; i < S.resumo.aEncerrar.length; i++) {
        const item = S.resumo.aEncerrar[i];
        const doc = item.doc;
        const numerosSet = {};
        item.numeros.forEach(function (n) { numerosSet[n] = true; });
        const notasAtuais = Array.isArray(doc.notas) && doc.notas.length ? doc.notas : [{}];
        const notasAtualizadas = notasAtuais.map(function (nota) {
          const numeroNota = String(nota.numeroNota || '').trim();
          if (!numerosSet[numeroNota]) return nota;
          const tratamento = nota.tratamento != null ? nota.tratamento : (doc.tratamento || '');
          if (tratamento === 'RECUSA') {
            notasEncerradas.push({ numeroNota: numeroNota, docId: item.docId, tratamento: 'RECUSA' });
            const evento = { status: 'FINALIZADO', em: agora, por: u.email || u.uid || 'inventario-patio' };
            const historicoBase = Array.isArray(nota.statusRetornoHistorico) ? nota.statusRetornoHistorico : (Array.isArray(doc.statusRetornoHistorico) ? doc.statusRetornoHistorico : []);
            return Object.assign({}, nota, { statusRetorno: 'FINALIZADO', statusRetornoHistorico: historicoBase.concat([evento]) });
          }
          if (tratamento === 'REENTREGA') {
            notasEncerradas.push({ numeroNota: numeroNota, docId: item.docId, tratamento: 'REENTREGA' });
            return Object.assign({}, nota, { dataSaidaEm: agora });
          }
          // PEDIDO AO VIVO (2026-09-22): "quando tiver um não classificado
          // e ele não foi encontrado, pode botar ele como reentrega e
          // finalizado" — nota SEM classificação nenhuma que some do pátio
          // é tratada como Reentrega já concluída (mesmo par
          // tratamento+dataSaidaEm de uma Reentrega normal que saiu),
          // então passa a contar em Notas Retornadas igual qualquer outra
          // Reentrega finalizada, em vez de ficar pra sempre "sem
          // classificação". confirmadoAusenteEm continua existindo só como
          // rede de segurança pros valores legados (PENDENTE/DEVOLUCAO/
          // SUBSTITUICAO/OUTRO) que nem aparecem mais no seletor hoje.
          if (tratamento === '') {
            notasEncerradas.push({ numeroNota: numeroNota, docId: item.docId, tratamento: 'SEM_CLASSIFICACAO' });
            return Object.assign({}, nota, { tratamento: 'REENTREGA', dataSaidaEm: agora });
          }
          notasEncerradas.push({ numeroNota: numeroNota, docId: item.docId, tratamento: 'SEM_CLASSIFICACAO' });
          return Object.assign({}, nota, { confirmadoAusenteEm: agora });
        });
        const statusFisico = recalcularStatusFisico(Object.assign({}, doc, { notas: notasAtualizadas }));
        await fs().collection(COL_RECUSAS).doc(item.docId).update({ notas: notasAtualizadas, statusFisico: statusFisico });
      }
      // PEDIDO AO VIVO (2026-10-02): "teria que ter uma aba de relatório de
      // inventário de notas no pátio, para saber quais notas foram
      // encontradas naquele inventário" — grava um retrato imutável desta
      // sessão (mesmo padrão de producao_import_historico em
      // 95-producao-importzip.js: 1 documento por execução concluída).
      // Try/catch PRÓPRIO, separado do encerramento acima: uma falha só em
      // registrar o histórico nunca pode desfazer o encerramento já
      // gravado nem impedir o operador de ver "Inventário finalizado".
      try {
        await fs().collection('recebimento_patio_inventarios').add({
          data: agora,
          operadorUid: u.uid || '',
          operadorEmail: u.email || '',
          operadorNome: _nomeLoginAtual(),
          notasEncontradas: S.confirmadas.slice(),
          qtdEncontradas: S.resumo.qtdEncontradas,
          notasEncerradas: notasEncerradas,
          qtdRecusa: S.resumo.qtdRecusa,
          qtdReentrega: S.resumo.qtdReentrega,
          qtdSemClassificacao: S.resumo.qtdSemClassificacao,
          qtdTotalEncerrar: S.resumo.qtdTotalEncerrar,
        });
      } catch (eHist) { /* histórico é best-effort — ver comentário acima */ }
      S.etapa = 'concluido';
      render();
      toast('Inventário finalizado.', 'success');
    } catch (e) {
      toast('Erro ao finalizar o inventário: ' + (e.message || e), 'error');
      if (btn) btn.disabled = false;
    }
  }

  function etapaBipar() {
    const lista = S.confirmadas.map(function (numero, i) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #23374d"><span style="font-size:.82rem">' + (i + 1) + '. ' + esc(numero) + '</span><button type="button" data-patio-remover="' + esc(numero) + '" style="background:none;border:none;color:#ff8a8a;font-size:.9rem">✕</button></div>';
    }).join('');
    return `
    <div><div class="screen-title">📦 Inventário do Pátio</div><div class="screen-sub">Digite o número de CADA nota que está fisicamente no pátio agora. Ao finalizar, qualquer nota marcada como presente que você NÃO confirmar será encerrada automaticamente (sai do Pátio) — nada é apagado, o histórico continua em Notas Retornadas.</div></div>
    <input id="patio-numero-input" class="field" inputmode="numeric" autocomplete="off" placeholder="Número da nota" style="font-size:1.05rem;padding:15px;text-align:center;font-weight:850">
    <button class="btn btn-primary" id="patio-consultar-btn" ${S.carregando ? 'disabled' : ''} style="padding:14px">${S.carregando ? '⏳ Consultando...' : 'Confirmar nota'}</button>
    <div class="card" style="padding:0;max-height:220px;overflow:auto">
      <div style="padding:8px 10px;font-size:.72rem;color:#6f89a6;border-bottom:1px solid #23374d">CONFIRMADAS: ${S.confirmadas.length}</div>
      ${lista || '<div style="padding:12px;font-size:.8rem;color:#6f89a6">Nenhuma nota confirmada ainda.</div>'}
    </div>
    <button class="btn btn-primary" id="patio-ver-resumo-btn" ${S.carregando ? 'disabled' : ''} style="padding:14px">Ver resumo e finalizar →</button>
    <button class="btn btn-ghost" data-patio-voltar="1" style="padding:12px">← Voltar sem finalizar</button>`;
  }
  function etapaNovo() {
    return `
    <div><div class="screen-title">🆕 Nota não encontrada no pátio</div><div class="screen-sub">Número ${esc(S.pendenteNovo)} — não está registrada como presente (é nova, ou já tinha saído e voltou). Sem motorista aqui — só Box e, se souber, a quantidade de pallets.</div></div>
    <input id="patio-box-input" class="field" autocomplete="off" placeholder="Ex.: BOX 12" style="font-size:1.1rem;padding:17px;text-align:center;font-weight:850;text-transform:uppercase">
    <input id="patio-pallets-input" class="field" inputmode="numeric" autocomplete="off" placeholder="Quantidade de pallets (opcional)" style="font-size:1rem;padding:14px;text-align:center">
    <button class="btn btn-primary" id="patio-confirmar-btn" style="padding:15px">Confirmar e continuar →</button>
    <button class="btn btn-ghost" data-patio-cancelar-novo="1" style="padding:12px">← Cancelar</button>`;
  }
  function etapaResumo() {
    const r = S.resumo || { qtdEncontradas: 0, qtdTotalEncerrar: 0, qtdRecusa: 0, qtdReentrega: 0, qtdSemClassificacao: 0 };
    return `
    <div><div class="screen-title">📋 Resumo da conferência</div></div>
    <div class="card" style="padding:14px;border:1px solid #1e6f4e;background:#132a1d">
      <div style="font-size:.85rem;color:#8fd9a8">✅ ${r.qtdEncontradas} nota(s) confirmada(s) — continuam no pátio, sem nenhuma mudança.</div>
    </div>
    ${r.qtdTotalEncerrar ? `
    <div class="card" style="padding:14px;border:1px solid #7a4a1f;background:#2a1c0c">
      <div style="font-size:.85rem;color:#ffd18a">⚠️ ${r.qtdTotalEncerrar} nota(s) NÃO foram encontradas e vão SAIR do Pátio:</div>
      <div style="font-size:.76rem;color:#ffd18a;margin-top:6px">• ${r.qtdRecusa} Recusa(s) → status vira Finalizado<br>• ${r.qtdReentrega} Reentrega(s) → sai como saída confirmada<br>• ${r.qtdSemClassificacao} sem classificação → vira Reentrega finalizada</div>
    </div>` : `<div class="card" style="padding:14px"><div style="font-size:.85rem;color:#8fd9a8">Nenhuma nota ficará de fora — tudo que estava no pátio foi confirmado.</div></div>`}
    <button class="btn btn-primary" id="patio-finalizar-confirmar-btn" style="padding:15px">${r.qtdTotalEncerrar ? 'Confirmar e encerrar ' + r.qtdTotalEncerrar + ' nota(s)' : 'Concluir conferência'}</button>
    <button class="btn btn-ghost" data-patio-cancelar-resumo="1" style="padding:12px">← Voltar e confirmar mais notas</button>`;
  }
  function etapaConcluido() {
    return `<div style="text-align:center;font-size:3rem">✅</div><div class="screen-title" style="text-align:center">Inventário finalizado</div><div class="card" style="padding:16px;text-align:center">${esc(String(S.confirmadas.length))} nota(s) confirmada(s) no pátio.</div><button class="btn btn-primary" data-patio-voltar="1" style="padding:16px">Voltar ao Recebimento</button>`;
  }
  const ETAPAS = { bipar: etapaBipar, novo: etapaNovo, resumo: etapaResumo, concluido: etapaConcluido };

  function render() {
    const host = document.getElementById('patio-inventario-host');
    if (!host) return;
    host.innerHTML = (ETAPAS[S.etapa] || etapaBipar)();
    ligar();
  }
  function ligar() {
    const numeroInput = document.getElementById('patio-numero-input');
    if (numeroInput) numeroInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); consultarNumero(); } });
    const btnConsultar = document.getElementById('patio-consultar-btn');
    if (btnConsultar) btnConsultar.addEventListener('click', consultarNumero);
    const btnConfirmarNovo = document.getElementById('patio-confirmar-btn');
    if (btnConfirmarNovo) btnConfirmarNovo.addEventListener('click', confirmarNovoLancamento);
    const btnResumo = document.getElementById('patio-ver-resumo-btn');
    if (btnResumo) btnResumo.addEventListener('click', irParaResumo);
    const btnFinalizarConfirmar = document.getElementById('patio-finalizar-confirmar-btn');
    if (btnFinalizarConfirmar) btnFinalizarConfirmar.addEventListener('click', confirmarFinalizacao);
    document.querySelectorAll('[data-patio-remover]').forEach(function (b) { b.addEventListener('click', function () { removerConfirmada(b.getAttribute('data-patio-remover')); }); });
    document.querySelectorAll('[data-patio-cancelar-novo]').forEach(function (b) { b.addEventListener('click', function () { S.pendenteNovo = ''; S.etapa = 'bipar'; render(); focarNumero(); }); });
    document.querySelectorAll('[data-patio-cancelar-resumo]').forEach(function (b) { b.addEventListener('click', function () { S.etapa = 'bipar'; render(); focarNumero(); }); });
    document.querySelectorAll('[data-patio-voltar]').forEach(function (b) { b.addEventListener('click', function () { if (global.goScreen) global.goScreen('recebimento-modo'); }); });
  }

  global.abrirInventarioPatio = abrirInventarioPatio;
  global._patioInventarioInternals = { estaNoPatio: estaNoPatio, recalcularStatusFisico: recalcularStatusFisico, consultarNumero: consultarNumero, confirmarNovoLancamento: confirmarNovoLancamento, irParaResumo: irParaResumo, confirmarFinalizacao: confirmarFinalizacao, getEstado: function () { return S; } };
})(window);
