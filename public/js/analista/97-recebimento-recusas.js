// Recebimento > Notas Retornadas
// PEDIDO AO VIVO (2026-08-27): reforma grande — esta tela virou o LEDGER de
// notas de VENDA (importado do BI), usado como referência pra quando o
// Coletor precisar receber fisicamente algo que voltou. As notas de
// DEVOLUÇÃO (com motivo, decidindo sozinhas se gravam automático ou ficam
// só aguardando o Coletor) moraram pra 100-consulta-notas-fiscais.js — ver
// [[bi-json-importacao-pasta-local]]/[[notas-retornadas-motivo-auto-recebimento]]
// na memória. A API antiga da Bluesoft (Buscar 🔎 + agendamento 3x/dia) e o
// import manual de PDF foram removidos de propósito ("pode tirar a api
// bluesoft" / "tira o PDF de vez") — a única fonte agora é o BI, via API do
// SharePoint (bi-pasta-local.js → Cloud Function buscarArquivoBiGraphApi).
// PEDIDO AO VIVO (2026-08-29): "se eu quiser que ela atualize sozinha, vai
// atualizar" — até aqui, a única sincronização automática era um
// setInterval de 30min QUE SÓ RODAVA com esta aba aberta no navegador
// (_iniciarAutoRefreshBi, mais abaixo); passou a rodar também no SERVIDOR,
// dentro de sincronizarBiAgendado (functions/index.js,
// _sincronizarNotasRetornadasVendaBiLoja), a cada 30min, sem depender de
// nenhum navegador aberto. O botão "Buscar" e o setInterval do navegador
// continuam existindo (força uma atualização imediata sem esperar o
// próximo ciclo do servidor), mas deixaram de ser a única forma de a
// lista se manter em dia.
(function (global) {
  'use strict';

  const COL_NOTAS = 'recebimento_recusas_notas';
  // PEDIDO AO VIVO (2026-08-27): "tem como colocar em chunks de 1000... pra
  // não gerar tanta leitura" — o Coletor faz `doc(chave).get()` direto em
  // COL_NOTAS pra bipar uma nota (24-recebimento-recusas.js) e isso não
  // pode mudar (mexeria no fluxo físico de receber devolução). Por isso
  // COL_NOTAS continua documento-por-nota, intocado. Esta coleção NOVA é
  // só uma cópia resumida (sem itens[], que só o Coletor usa), empacotada
  // em até TAMANHO_CHUNK notas por documento — o Analista lê ESTA pra
  // montar a tela (poucas dezenas de leituras em vez de milhares), e
  // COL_NOTAS continua sendo gravada normalmente (fonte de verdade,
  // usada pelo Coletor). Cada doc individual em COL_NOTAS ganha um campo
  // `chunkIndex` pra saber, na hora de remover, de qual pacote tirar.
  const COL_NOTAS_CHUNKS = 'recebimento_recusas_notas_chunks';
  // BUG AO VIVO REAL (2026-09-03): "Falha na última busca: Document
  // .../recebimento_recusas_notas_chunks/chunk_1 cannot be written because
  // its size (1.084.326 bytes) exceeds the maximum allowed size of
  // 1.048.576 bytes" — TAMANHO_CHUNK=1000 era só uma contagem, nunca olhava
  // o tamanho real em bytes; 1000 notas (destinatario/vendedorNome variam
  // de tamanho) já passava do 1MB do Firestore. PRIMEIRA correção (700 +
  // LIMITE_BYTES_CHUNK=600000) NÃO foi suficiente — o mesmo erro se repetiu
  // (chunk_2, 1.073.252 bytes, ~1h depois): o culpado de verdade era a
  // sincronização AGENDADA no SERVIDOR (functions/index.js/
  // _sincronizarNotasRetornadasVendaBiLoja, roda sozinha a cada 30min),
  // ainda com TAMANHO_CHUNK_NOTAS_RETORNADAS=1000 sem nenhum conserto —
  // ambos os lados agora usam 400 (folga bem maior: 400 × ~1084 bytes/nota
  // reais ≈ 434.000, 41% do limite), alinhados de propósito (comentário no
  // arquivo do servidor: "se a lógica mudar de um lado, replicar no
  // outro"). LIMITE_BYTES_CHUNK continua como 2ª trava de defesa.
  const TAMANHO_CHUNK = 400;
  const LIMITE_BYTES_CHUNK = 350000; // ~33% do limite real (1.048.576) — folga generosa pro overhead do Firestore que o JSON.stringify não captura
  const COL_RECUSAS = 'recebimento_recusas';
  const COL_MOTORISTAS = 'recebimento_recusas_motoristas';
  const COL_MOTIVOS = 'recebimento_recusas_motivos';
  // Pedido ao vivo do usuário (planilha real de controle): "Conferente" é a
  // pessoa da equipe que confere a carga na chegada — cadastro próprio,
  // mesmo molde de Motoristas/Motivos.
  const COL_CONFERENTES = 'recebimento_recusas_conferentes';
  const COL_TAREFAS = 'recebimento_recusas_tarefas_conferencia';
  const COL_VENDEDORES_MERCADO = 'recebimento_recusas_vendedores_mercado';
  const ARQUIVO_BI_NOTAS = 'notas_fiscais_jacson.json';
  const INTERVALO_AUTO_BUSCA_MS = 30 * 60 * 1000; // pedido ao vivo: a cada 30 minutos

  let _notas = [];
  let _recusas = [];
  // PEDIDO AO VIVO (2026-09-09): "o código refaz sete consultas completas
  // toda vez que você entra" — carregarDados() rodava sem NENHUM cache,
  // mesmo trocando só entre "Notas Retornadas" e "Cadastros" (mesmos 7
  // dados, chamado de novo do zero). Chamadas depois de SALVAR algo
  // (criar/editar/excluir cadastro, atribuir conferência, importar BI)
  // continuam forçando busca nova de propósito — só os dois pontos de
  // ENTRADA na tela (renderRecebimentoRecusas/RecusasCadastros) e os
  // botões "Atualizar" respeitam/pedem a atualização.
  let _carregadoRecusas = false;
  let _motoristas = [];
  let _motivos = [];
  let _conferentes = [];
  let _vendedoresMercado = [];
  let _tarefas = new Map(); // FASE 8 — recusaId -> tarefa de conferência delegada
  let _filtro = '';
  let _filtroTratamento = ''; // FASE 9
  let _filtroConferencia = ''; // FASE 9
  let _filtroPeriodoInicio = ''; // FASE 9 — data (yyyy-mm-dd), sobre criadoEm
  let _filtroPeriodoFim = ''; // FASE 9
  let _recusaAtribuindoId = '';
  let _recusaDetalheId = '';
  // Diagnóstico persistente do último "Buscar do BI" — mesma ideia dos
  // diagnósticos antigos, mas agora só reflete a importação de venda do BI.
  let _ultimaBuscaBiTexto = '';
  let _autoRefreshIniciado = false;
  // Pedido ao vivo do usuário: importar Motoristas + Motivos (e placa) de
  // uma planilha (Veículo/Motorista, Placa, Motivo) de uma vez só, sem
  // repetir os que já existem. Preview antes de salvar.
  let _previewImportacaoCadastros = null;

  // FASE 9 — "Tratamento do retorno" é SEMPRE separado da "Natureza da NF"
  // (pedido explícito do usuário: nunca sobrescreve o dado da nota) e da
  // "Conferência de produtos" (statusConferenciaOperacional). Só o
  // Analista classifica — o Coletor nunca grava este campo.
  const TRATAMENTO_LABELS = { '': '— Não classificado —', RECUSA: 'Recusa', DEVOLUCAO: 'Devolução', REENTREGA: 'Reentrega', SUBSTITUICAO: 'Substituição', PENDENTE: 'Pendente', OUTRO: 'Outro' };
  // PEDIDO AO VIVO (2026-09-08): "ter as opções só de Reentrega ou
  // Recusa" — o dropdown de classificação (por linha) só oferece as 2
  // opções reais de agora em diante + o placeholder vazio. Registros
  // antigos com Devolução/Substituição/Pendente/Outro continuam mostrando
  // o rótulo certo (TRATAMENTO_LABELS não muda, só a lista do <select>) —
  // ninguém perde classificação já feita, só não dá mais pra ESCOLHER essas
  // opções de novo daqui pra frente. O filtro "TRATAMENTO" continua com a
  // lista cheia, pra dar pra achar esses registros antigos.
  const TRATAMENTO_OPCOES_SELECT = ['', 'RECUSA', 'REENTREGA'];

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
  // Mesmo mapeamento de 99-recebimento-retornos-status.js (duplicado de
  // propósito) — data nomeada que só é carimbada na 1ª vez que o status
  // ENTRA nesse valor.
  const DATA_POR_STATUS = { '': 'liberadoParaRecusarEm', AGUARD_FISCAL: 'dataSolicitacaoFiscalEm', CTE: 'dataDaRecusaEm', ENDERECANDO: 'dataDoEnderecamentoEm' };
  function statusRetornoLabels() {
    return (global._recebimentoRetornosStatusInternals && global._recebimentoRetornosStatusInternals.STATUS_RETORNO_LABELS) || { '': 'Aguard. Monitoramento' };
  }
  // PEDIDO AO VIVO (2026-09-08): "colocar mais uma coluna de status, onde
  // eu consiga adiantar quais vao ser os status" — dá pra classificar
  // Tratamento E já adiantar o Status (Aguard. Fiscal/CTE/Endereçando/
  // Finalizado, ou Data Programada/Saída se for Reentrega) sem sair desta
  // tela. Mesma escrita por nota de mudarStatusRetorno/salvarDataReentrega
  // (99-recebimento-retornos-status.js), duplicada aqui de propósito —
  // "Status de Retornos" continua existindo do jeito que está, esta tela
  // só ganha um atalho pro mesmo campo.
  function _acharOuCriarNota(r, notaChave) {
    const notas = Array.isArray(r.notas) ? r.notas.slice() : [];
    let idx = notas.findIndex(n => (n.chave || '') === notaChave);
    if (idx === -1) { if (notas.length) return null; idx = 0; notas.push({}); }
    return { notas, idx };
  }
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
    try {
      const notasAtualizadas = notas.map((n, i) => i === idx ? Object.assign({}, n, patchNota) : n);
      await fs().collection(COL_RECUSAS).doc(recusaId).update({ notas: notasAtualizadas });
      r.notas = notasAtualizadas;
      redesenharTabela();
    } catch (e) { global.showToast?.('Erro ao atualizar status: ' + (e.message || e), 'error'); }
  }
  async function salvarDataReentrega(recusaId, notaChave, campo, valorData) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const achado = _acharOuCriarNota(r, notaChave);
    if (!achado) return;
    const { notas, idx } = achado;
    const iso = valorData ? new Date(valorData + 'T00:00:00').toISOString() : null;
    try {
      const notasAtualizadas = notas.map((n, i) => i === idx ? Object.assign({}, n, { [campo]: iso }) : n);
      await fs().collection(COL_RECUSAS).doc(recusaId).update({ notas: notasAtualizadas });
      r.notas = notasAtualizadas;
    } catch (e) { global.showToast?.('Erro ao salvar data: ' + (e.message || e), 'error'); }
  }
  function isoParaInputDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  // Valor legado (Devolução/Substituição/Pendente/Outro) que não está mais
  // na lista de opções (TRATAMENTO_OPCOES_SELECT) precisa aparecer mesmo
  // assim — nunca mostrar em branco um valor que já foi classificado de
  // verdade (mesmo padrão do dropdown de Motivo, algumas linhas acima).
  function tratamentoSelectHtml(r) {
    const valor = r.tratamento || '';
    const opcoes = TRATAMENTO_OPCOES_SELECT.includes(valor) ? TRATAMENTO_OPCOES_SELECT : [...TRATAMENTO_OPCOES_SELECT, valor];
    return `<select class="field" style="padding:6px;font-size:.75rem" data-recusa-tratamento="${esc(r._recusaId)}|${esc(r._notaChave)}">${opcoes.map(k => `<option value="${k}" ${k === valor ? 'selected' : ''}>${esc(TRATAMENTO_LABELS[k] || k)}</option>`).join('')}</select>`;
  }
  function statusRetornoCelulaHtml(r) {
    if (r.tratamento === 'REENTREGA') {
      return `<div style="display:flex;flex-direction:column;gap:3px;font-size:.68rem">
        <label>Prog.: <input type="date" data-recusa-reentrega-data="${esc(r._recusaId)}|${esc(r._notaChave)}:dataProgramadaEm" value="${isoParaInputDate(r.dataProgramadaEm)}" style="padding:2px"></label>
        <label>Saída: <input type="date" data-recusa-reentrega-data="${esc(r._recusaId)}|${esc(r._notaChave)}:dataSaidaEm" value="${isoParaInputDate(r.dataSaidaEm)}" style="padding:2px"></label>
      </div>`;
    }
    if (r.tratamento !== 'RECUSA') return '—';
    const labels = statusRetornoLabels();
    return `<select class="field" style="padding:6px;font-size:.72rem" data-recusa-status="${esc(r._recusaId)}|${esc(r._notaChave)}">${Object.keys(labels).map(k => `<option value="${k}" ${k === (r.statusRetorno || '') ? 'selected' : ''}>${esc(labels[k])}</option>`).join('')}</select>`;
  }

  function fs() {
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    if (global.firebase && typeof global.firebase.firestore === 'function') return global.firebase.firestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function raw() {
    if (typeof global.getDTRawFirestore === 'function') return global.getDTRawFirestore();
    return fs();
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function agoraIso() { return new Date().toISOString(); }
  // Comparação sem acento/maiúscula pra dedup na importação de planilha —
  // "José Antonio" e "JOSE ANTONIO" contam como o mesmo motorista.
  function normUpper(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
  function usuarioAtual() {
    const u = global.firebase?.auth?.().currentUser;
    return u ? { uid: u.uid || '', email: u.email || '' } : { uid: '', email: '' };
  }
  function numero(v) {
    const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  function intVol(v) {
    const n = numero(v);
    return Number.isFinite(n) ? Math.round(n) : NaN;
  }
  function fmtDataHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return esc(v);
    return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function fmtHora(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  }
  function chaveNfeValida(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) {
      soma += Number(c[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    const dv = (resto === 0 || resto === 1) ? 0 : 11 - resto;
    return dv === Number(c[43]);
  }
  // Ainda usada por parseDanfeText/dividirTextoPorDanfes (mantidas puras e
  // testadas, mesmo sem UI de PDF ativa nesta tela — ver comentário no topo
  // do arquivo) e por qualquer outro código que precise validar uma chave.
  function extrairChave(texto) {
    const txt = String(texto || '');
    const idx = txt.search(/chave\s+de\s+acesso/i);
    const blocos = idx >= 0 ? [txt.slice(idx, idx + 650), txt] : [txt];
    for (const bloco of blocos) {
      const partes = bloco.match(/[0-9][0-9.\-\/\s]{42,180}/g) || [];
      for (const p of partes) {
        const dig = p.replace(/\D/g, '');
        for (let i = 0; i + 44 <= dig.length; i++) {
          const cand = dig.slice(i, i + 44);
          if (chaveNfeValida(cand)) return cand;
        }
      }
    }
    const exatos = txt.match(/\d{44}/g) || [];
    return exatos.find(chaveNfeValida) || exatos[0] || '';
  }
  function numeroNotaDaChave(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return '';
    return String(Number(c.slice(25, 34)) || '').trim();
  }
  // PEDIDO AO VIVO (2026-08-25): "quando vou importar um arquivo que tem
  // tipo umas 100 notas ele só lê a primeira" — parseDanfeText() usava
  // match() simples (1ª ocorrência) pra cada campo no texto INTEIRO do
  // PDF; com várias DANFEs concatenadas num PDF só, as outras 99 eram
  // descartadas em silêncio. "Chave de acesso" é o único marcador que
  // aparece uma vez por nota — divide o texto em um segmento por
  // ocorrência. Mantida pura/testada mesmo sem UI de PDF ativa (ver
  // comentário no topo do arquivo) — pode voltar a ser usada se um dia o
  // BI trouxer motivo e ainda assim precisar de um import por PDF avulso.
  function dividirTextoPorDanfes(texto) {
    const txt = String(texto || '');
    const posicoes = [];
    const re = /chave\s+de\s+acesso/gi;
    let m;
    while ((m = re.exec(txt))) posicoes.push(m.index);
    if (posicoes.length <= 1) return [txt];
    return posicoes.map((pos, i) => txt.slice(pos, i + 1 < posicoes.length ? posicoes[i + 1] : txt.length));
  }
  function parseDanfeText(texto) {
    const txt = String(texto || '').replace(/\u0000/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ');
    const chave = extrairChave(txt);
    let numeroNota = '';
    const mNf = txt.match(/N\s*[º°o]?\s*([0-9][0-9.\s]{3,20})\s*-?\s*S[ÉE]RIE/i) || txt.match(/NF-e\s*N\s*[º°o]?\s*([0-9.\s]{3,20})/i);
    if (mNf) numeroNota = (mNf[1] || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!numeroNota) numeroNota = numeroNotaDaChave(chave);

    let volumes = NaN;
    const iTransp = txt.search(/Transportador\s*\/\s*Volumes\s+Transportados/i);
    const trechoTransp = iTransp >= 0 ? txt.slice(iTransp, iTransp + 1800) : txt;
    const mVol = trechoTransp.match(/Quantidade\s+Esp[ée]cie\s+([0-9][0-9.,]*)/i)
      || trechoTransp.match(/Quantidade\s+([0-9][0-9.,]*)\s+(?:Esp[ée]cie|VOLUMES|Marca)/i)
      || trechoTransp.match(/Quantidade\s+([0-9][0-9.,]*)/i);
    if (mVol) volumes = intVol(mVol[1]);

    let destinatario = '';
    const mCliente = txt.match(/Cliente:\s*\(?\d+\)?\s+(.{3,120}?)\s+Pedido:/i);
    const mDest = txt.match(/Destinat[áa]rio\s*\/\s*Remetente[\s\S]{0,300}?Nome\s*\/\s*Raz[ãa]o\s+Social\s+(?:CNPJ\s+Data\s+da\s+Emiss[ãa]o\s+)?(.{3,120}?)(?=\s+\d{2}\.\d{3}\.\d{3}\/|\s+CNPJ|\s+CPF|\s+Endere[cç]o)/i);
    if (mCliente) destinatario = mCliente[1].trim();
    else if (mDest) destinatario = mDest[1].trim();

    let dataEmissao = '';
    const mData = txt.match(/Data\s+da\s+Emiss[ãa]o\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (mData) dataEmissao = mData[1];

    let transportadora = '';
    const mTransp = trechoTransp.match(/Raz[ãa]o\s+Social\s+Frete\s+Por\s+Conta\s+(.{3,100}?)(?=\s+1-Emitente|\s+C[óo]digo\s+ANTT|\s+Placa\s+do\s+Ve[íi]culo|\s+CNPJ)/i)
      || trechoTransp.match(/Raz[ãa]o\s+Social\s+(.{3,100}?)(?=\s+C[óo]digo\s+ANTT|\s+Placa\s+do\s+Ve[íi]culo|\s+CNPJ)/i);
    if (mTransp) transportadora = mTransp[1].trim();

    let informacoesComplementares = '';
    const iInfComp = txt.search(/Informa[çc][õo]es\s+Complementares/i);
    if (iInfComp >= 0) {
      let trecho = txt.slice(iInfComp, iInfComp + 700).replace(/^Informa[çc][õo]es\s+Complementares\s*/i, '');
      const iFisco = trecho.search(/Reservado\s+ao\s+Fisco/i);
      if (iFisco >= 0) trecho = trecho.slice(0, iFisco);
      informacoesComplementares = trecho.trim().replace(/\s{2,}/g, ' ').slice(0, 500);
    }

    return {
      chave,
      numeroNota,
      volumes: Number.isFinite(volumes) ? volumes : '',
      destinatario,
      dataEmissao,
      transportadora,
      informacoesComplementares,
      chaveValida: chaveNfeValida(chave)
    };
  }

  // Achata todos os documentos de COL_NOTAS_CHUNKS (cada um um mapa
  // {chave: notaResumida}) num array só, com chunkIndex anexado em cada
  // nota (extraído do id do doc, "chunk_7" -> 7) — é assim que
  // _gravarNotasVenda sabe de qual pacote remover uma nota depois.
  function _achatarChunks(chunksSnap) {
    const linhas = [];
    chunksSnap.docs.forEach(doc => {
      const chunkIndex = Number(String(doc.id).replace('chunk_', '')) || 0;
      Object.values(_notasDoDocumentoChunk(doc.data())).forEach(nota => linhas.push({ ...nota, chunkIndex }));
    });
    return linhas;
  }
  // BUG AO VIVO REAL (2026-09-03): "0 notas dentro, mas o documento pesa
  // mais de 1MB" — confirmado com o relatório de diagnóstico real: gravar
  // com `.set(ref, {'notas.'+chave: valor}, {merge:true})` NUNCA criou o
  // mapa aninhado {notas: {chave: valor}} que todo o resto do código
  // (contagem, limite de tamanho, remoção) sempre assumiu — criou um
  // CAMPO LITERAL solto na raiz do documento, chamado "notas.CHAVE" (com
  // o ponto fazendo parte do NOME do campo). Isso é por causa de set()
  // com merge:true — diferente de update(), não trata chave com ponto
  // como caminho aninhado quando o valor é um objeto plano, ela vira o
  // nome literal do campo. Resultado: TODA leitura de contagem sempre via
  // 0 notas em QUALQUER chunk (mesmo cheio até estourar 1MB de campos
  // soltos), então TODO o sistema sempre achava que tinha espaço de
  // sobra, e foi empilhando pra sempre — a causa raiz de tudo isso desde
  // o início do recurso, não só de hoje. Esta função lê os dois formatos
  // (o aninhado — o único formato CORRETO, que passa a ser o único usado
  // daqui pra frente — e os campos soltos legados, prefixo "notas.") pra
  // nenhuma nota antiga sumir enquanto o reparo definitivo não roda.
  function _notasDoDocumentoChunk(dados) {
    dados = dados || {};
    const notas = { ...(dados.notas || {}) };
    Object.keys(dados).forEach(k => {
      if (!k.startsWith('notas.')) return;
      const v = dados[k];
      if (v && typeof v === 'object') notas[k.slice(6)] = v;
    });
    return notas;
  }
  // Lê o estado REAL de um chunk (curando campos soltos automaticamente,
  // ver _notasDoDocumentoChunk) e devolve tanto o mapa quanto uma função
  // pra gravar de volta — sempre um `.set()` SEM merge, com o mapa
  // {notas:{...}} JÁ COMPLETO calculado aqui (nunca mais um merge cego
  // com chave de ponto) — é a única forma de garantir a estrutura
  // aninhada de verdade no Firestore.
  async function _lerEGravarChunk(chunkIndex, mudar) {
    const ref = fs().collection(COL_NOTAS_CHUNKS).doc('chunk_' + chunkIndex);
    const snap = await ref.get();
    const notas = _notasDoDocumentoChunk(snap.exists ? snap.data() : null);
    mudar(notas);
    // Grava via batch (mesmo padrão de escrita usado em todo o resto do
    // arquivo) em vez de ref.set() direto — raw()/getDTRawFirestore() é
    // quem sabe gravar de verdade aqui.
    const batch = raw().batch();
    batch.set(ref, { notas });
    await batch.commit();
  }

  // Migração de uma vez só: se COL_NOTAS_CHUNKS ainda não existe mas
  // COL_NOTAS já tem notas (importadas antes dos chunks existirem),
  // empacota tudo agora. Único momento em que lemos COL_NOTAS inteira —
  // depois disso, toda leitura normal usa só os poucos docs de chunk.
  async function _migrarParaChunksSeNecessario() {
    const chunksSnap = await fs().collection(COL_NOTAS_CHUNKS).get();
    if (!chunksSnap.empty) return _achatarChunks(chunksSnap);
    const individualSnap = await fs().collection(COL_NOTAS).get();
    if (individualSnap.empty) return [];
    const docs = individualSnap.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    const rawFs = raw();
    const { porChunk, comChunkIndex } = _empacotarEmChunks(docs);
    for (const [chunkIndex, mapaChunk] of porChunk) {
      const batchChunk = rawFs.batch();
      batchChunk.set(fs().collection(COL_NOTAS_CHUNKS).doc('chunk_' + chunkIndex), { notas: mapaChunk }, { merge: true });
      await batchChunk.commit();
    }
    for (let j = 0; j < comChunkIndex.length; j += 300) {
      const sublote = comChunkIndex.slice(j, j + 300);
      const batchIndex = rawFs.batch();
      sublote.forEach(d => batchIndex.set(fs().collection(COL_NOTAS).doc(d.chave), { chunkIndex: d.chunkIndex }, { merge: true }));
      await batchIndex.commit();
    }
    return comChunkIndex;
  }

  // Versão enxuta da nota pra caber muitas por documento — sem itens[]
  // (só o Coletor precisa disso, e ele lê o doc individual, não o chunk).
  function _notaResumida(n) {
    return {
      chave: n.chave, numeroNota: n.numeroNota, serie: n.serie, destinatario: n.destinatario || '',
      destinatarioCnpj: n.destinatarioCnpj || '', dataEmissao: n.dataEmissao || '', valorTotal: Number(n.valorTotal) || 0,
      cfop: n.cfop || '', naturezaLabel: n.naturezaLabel || '', tipoOperacao: n.tipoOperacao || '',
      informacoesComplementares: n.informacoesComplementares || '', pareceDevolucao: !!n.pareceDevolucao, origemImportacao: n.origemImportacao || '',
      vendedorNome: n.vendedorNome || '', vendedorEmail: n.vendedorEmail || '', supervisorNome: n.supervisorNome || '', supervisorEmail: n.supervisorEmail || '',
      ativo: n.ativo !== false, atualizadoEm: n.atualizadoEm || '',
    };
  }
  // Estimativa conservadora do tamanho (em bytes) que uma nota resumida
  // ocupa dentro do documento de chunk — não é o formato binário exato do
  // Firestore (que tem overhead por campo além do JSON), por isso
  // LIMITE_BYTES_CHUNK fica bem abaixo do limite real de 1.048.576: a folga
  // absorve essa imprecisão.
  function _tamanhoBytesEstimado(obj) {
    const json = JSON.stringify(obj);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
  }
  // Empacota uma lista de notas (com pelo menos `chave` + os campos que
  // _notaResumida lê) em chunks respeitando TAMANHO_CHUNK (contagem) E
  // LIMITE_BYTES_CHUNK (bytes estimados) — o que estourar primeiro fecha o
  // chunk atual e abre o próximo. `estado` deixa continuar de onde um chunk
  // já aberto parou (contagem/bytes reais de quem já está lá), usado tanto
  // ao gravar notas novas quanto ao reparar órfãs — só a migração inicial
  // começa do zero. Usado pelos 3 caminhos que gravam em COL_NOTAS_CHUNKS,
  // pra nunca reimplementar a regra de estouro em lugares diferentes.
  function _empacotarEmChunks(docs, estado) {
    let chunkAtual = (estado && estado.chunkInicial) || 0;
    let bytesNoChunkAtual = (estado && estado.bytesInicial) || 0;
    let contagemNoChunkAtual = (estado && estado.contagemInicial) || 0;
    const porChunk = new Map(); // chunkIndex -> {chave: resumida}
    const comChunkIndex = []; // [{...resumida, chunkIndex}]
    docs.forEach(d => {
      const resumida = _notaResumida(d);
      const tamanho = _tamanhoBytesEstimado(resumida);
      if (contagemNoChunkAtual > 0 && (contagemNoChunkAtual >= TAMANHO_CHUNK || bytesNoChunkAtual + tamanho > LIMITE_BYTES_CHUNK)) {
        chunkAtual++; bytesNoChunkAtual = 0; contagemNoChunkAtual = 0;
      }
      bytesNoChunkAtual += tamanho; contagemNoChunkAtual++;
      if (!porChunk.has(chunkAtual)) porChunk.set(chunkAtual, {});
      porChunk.get(chunkAtual)[d.chave] = resumida;
      comChunkIndex.push({ ...resumida, chunkIndex: chunkAtual });
    });
    // Estado final — o chamador passa isso de volta como `estado` na
    // próxima chamada (ex.: próximo lote de 300), pra continuar enchendo o
    // MESMO chunk aberto em vez de perder a contagem/bytes acumulados.
    const estadoFinal = { chunkInicial: chunkAtual, contagemInicial: contagemNoChunkAtual, bytesInicial: bytesNoChunkAtual };
    return { porChunk, comChunkIndex, estadoFinal };
  }

  async function carregarDados(forcar) {
    if (_carregadoRecusas && !forcar) return;
    const [notasChunks, r, m, mot, conf, tar, vm] = await Promise.all([
      _migrarParaChunksSeNecessario(),
      fs().collection(COL_RECUSAS).get(),
      fs().collection(COL_MOTORISTAS).get(),
      fs().collection(COL_MOTIVOS).get(),
      fs().collection(COL_CONFERENTES).get(),
      fs().collection(COL_TAREFAS).get(),
      fs().collection(COL_VENDEDORES_MERCADO).get(),
    ]);
    _notas = notasChunks;
    // PEDIDO AO VIVO (2026-08-31): devolução auto-gravada por
    // 100-consulta-notas-fiscais.js (origem:'AUTOMATICO') não é um
    // recebimento físico processado pelo Coletor — não deve aparecer na
    // fila de Notas Retornadas (motorista/box/conferência não existem pra
    // ela). Ela tem indicador próprio, separado (ver 102-devolucoes-bi-indicadores.js).
    // PEDIDO AO VIVO (2026-08-31, 3ª rodada): `origem` só passou a ser
    // gravado numa rodada posterior — registros auto-salvos antes disso não
    // têm esse campo, mas sempre tiveram `motivoAutomaticoTexto` (exclusivo
    // desse fluxo), que serve de marcador retroativo (ver 102-devolucoes-bi-indicadores.js).
    _recusas = r.docs.map(d => ({ _id:d.id, ...d.data() })).filter(x => x.origem !== 'AUTOMATICO' && x.motivoAutomaticoTexto == null).sort((a,b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
    _motoristas = m.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    _motivos = mot.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    _conferentes = conf.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    _vendedoresMercado = vm.docs.map(d => ({ _id:d.id, ...d.data() })).sort((a,b) => String(a.nomeMercado || '').localeCompare(String(b.nomeMercado || ''), 'pt-BR'));
    // FASE 8 — indexado por recusaId (o mesmo id do doc de tarefa, ver
    // confirmarAtribuicaoConferenciaRecusa) pra achar rápido se já existe
    // uma conferência delegada em andamento pra cada linha da tabela.
    _tarefas = new Map(tar.docs.map(d => [d.id, { _id:d.id, ...d.data() }]));
    _carregadoRecusas = true;
  }

  function resumoCards() {
    const hoje = new Date().toISOString().slice(0,10);
    const hojeQtd = _recusas.filter(r => String(r.criadoEm || '').slice(0,10) === hoje).length;
    const diverg = _recusas.filter(r => Number(r.diferencaVolumes || 0) !== 0).length;
    const vols = _recusas.reduce((s,r) => s + Number(r.volumeInformado || 0), 0);
    return `
      <div style="display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:10px;margin:12px 0 16px">
        <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">NOTAS DE VENDA (LEDGER)</div><div style="font-size:1.45rem;font-weight:850">${_notas.length}</div></div>
        <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">RETORNOS HOJE</div><div style="font-size:1.45rem;font-weight:850">${hojeQtd}</div></div>
        <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">VOLUMES RETORNADOS</div><div style="font-size:1.45rem;font-weight:850">${vols}</div></div>
        <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">COM DIVERGÊNCIA</div><div style="font-size:1.45rem;font-weight:850;color:${diverg ? '#dc2626':'inherit'}">${diverg}</div></div>
      </div>`;
  }

  // FASE 9 — filtros dedicados (período/tratamento/conferência), client-
  // side sobre o mesmo array já carregado em memória.
  // PEDIDO AO VIVO (2026-09-08): roda sobre `linhasPorNota(_recusas)` (1
  // linha por nota, não por documento) — `_recusas`/`resumoCards()`
  // continuam intocados (KPIs de topo são por evento físico, de
  // propósito).
  function filtrarRecusas() {
    const f = _filtro.trim().toLowerCase();
    return linhasPorNota(_recusas).filter(r => {
      if (f && !([r.motoristaNome,r.motivoNome,r.conferenteNome,r.box,(r.notas || []).map(n=>n.numeroNota).join(' '),(r.chaves || []).join(' ')].join(' ').toLowerCase().includes(f))) return false;
      if (_filtroTratamento && (r.tratamento || '') !== _filtroTratamento) return false;
      if (_filtroConferencia && (r.statusConferenciaOperacional || 'NAO_REALIZADA') !== _filtroConferencia) return false;
      const data = String(r.criadoEm || '').slice(0,10);
      if (_filtroPeriodoInicio && data && data < _filtroPeriodoInicio) return false;
      if (_filtroPeriodoFim && data && data > _filtroPeriodoFim) return false;
      return true;
    });
  }
  function filtrosHtml() {
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">DE</div><input class="field" id="recusas-filtro-periodo-ini" type="date" value="${esc(_filtroPeriodoInicio)}" style="padding:8px"></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input class="field" id="recusas-filtro-periodo-fim" type="date" value="${esc(_filtroPeriodoFim)}" style="padding:8px"></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">TRATAMENTO</div><select class="field" id="recusas-filtro-tratamento" style="padding:8px">${Object.keys(TRATAMENTO_LABELS).map(k=>`<option value="${k}" ${k===_filtroTratamento?'selected':''}>${esc(TRATAMENTO_LABELS[k])}</option>`).join('')}</select></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">CONFERÊNCIA</div><select class="field" id="recusas-filtro-conferencia" style="padding:8px"><option value="" ${!_filtroConferencia?'selected':''}>Todas</option><option value="NAO_REALIZADA" ${_filtroConferencia==='NAO_REALIZADA'?'selected':''}>Não realizada</option><option value="CONFERIDA" ${_filtroConferencia==='CONFERIDA'?'selected':''}>Conferida</option><option value="CONFERIDA_COM_DIVERGENCIA" ${_filtroConferencia==='CONFERIDA_COM_DIVERGENCIA'?'selected':''}>Conferida c/ divergência</option></select></div>
      <input class="field" id="recusas-filtro" value="${esc(_filtro)}" placeholder="Pesquisar NF, motorista, motivo, box..." style="max-width:280px;padding:8px">
    </div>`;
  }
  function renderRecusasTabela() {
    const lista = filtrarRecusas();
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Data/Hora</th><th>Notas</th><th>Origem</th><th>Motorista</th><th>Conferente</th><th>Motivo</th><th>Box</th><th>Esperado</th><th>Contado</th><th>Dif.</th><th>Status</th><th>Conferência de produtos</th><th>Tratamento</th><th>Status do retorno</th><th></th></tr></thead><tbody>${lista.length ? lista.map(r => {
      const dif = Number(r.diferencaVolumes || 0);
      const opcoesMotivo=_motivos.filter(m=>m.ativo!==false||m._id===r.motivoId).map(m=>`<option value="${esc(m._id)}" ${m._id===r.motivoId?'selected':''}>${esc(m.nome)}</option>`).join('');
      return `<tr><td>${fmtDataHora(r.criadoEm)}</td><td><b>${esc((r.notas || []).map(n => n.numeroNota).filter(Boolean).join(', ') || '—')}</b></td><td>${r.origem==='AUTOMATICO'?'<span class="badge" style="background:#4a3114;color:#ffd18a;font-size:.65rem">⚡ automático</span>':(r.origem==='COLETOR'?'<span class="badge b-blue" style="font-size:.65rem">📱 coletor</span>':'—')}</td><td>${esc(r.motoristaNome || '—')}</td><td>${esc(r.conferenteNome || '—')}</td><td><select class="field" style="min-width:150px;padding:6px;font-size:.72rem" data-recusa-motivo="${esc(r._id)}"><option value="">— Sem motivo —</option>${opcoesMotivo}${r.motivoId&&!_motivos.some(m=>m._id===r.motivoId)?`<option value="${esc(r.motivoId)}" selected>${esc(r.motivoNome||'Motivo antigo')}</option>`:''}</select></td><td><b>${esc(r.box || '—')}</b></td><td>${Number(r.volumeEsperado || 0)}</td><td>${Number(r.volumeInformado || 0)}</td><td style="font-weight:800;color:${dif ? '#dc2626':'#15803d'}">${dif > 0 ? '+' : ''}${dif}</td><td>${dif ? '<span class="badge red">Divergente</span>' : '<span class="badge green">Conferido</span>'}</td><td>${statusConferenciaHtml(r)}</td><td>${tratamentoSelectHtml(r)}</td><td>${statusRetornoCelulaHtml(r)}</td><td><button class="btn btn-ghost btn-sm" data-recusa-detalhe="${esc(r._id)}">🔍</button> <button class="btn btn-ghost btn-sm" data-recusa-excluir="${esc(r._id)}" title="Excluir esta nota retornada registrada">🗑️</button></td></tr>`;
    }).join('') : '<tr><td colspan="15"><div class="empty"><div class="empty-icon">↩️</div><div class="empty-title">Nenhuma nota retornada com esses filtros</div></div></td></tr>'}</tbody></table></div>`;
  }

  // FASE 8 — "Conferência de produtos" é um status PRÓPRIO e separado
  // (statusConferenciaOperacional), nunca confundido com conferenciaStatus
  // (que é só a checagem de VOLUME, já existente). NAO_REALIZADA com uma
  // tarefa pendente vira "aguardando fulano"; sem tarefa vira o botão de
  // solicitar.
  function statusConferenciaHtml(r) {
    const status = r.statusConferenciaOperacional || 'NAO_REALIZADA';
    if (status === 'CONFERIDA') return '<span class="badge green">✓ Conferida</span>';
    if (status === 'CONFERIDA_COM_DIVERGENCIA') return '<span class="badge red">⚠ Conferida c/ divergência</span>';
    const tarefa = _tarefas.get(r._id);
    if (tarefa && tarefa.status === 'PENDENTE') return `<span class="badge" style="background:#15263f;color:#9eb4cb">Aguardando ${esc(tarefa.atribuidoPara)}</span>`;
    return `<button class="btn btn-ghost btn-sm" data-recusa-solicitar-conf="${esc(r._id)}">📋 Solicitar conferência</button>`;
  }

  // Pedido ao vivo do usuário (planilha real de controle): "Conferente" —
  // 3º cadastro no mesmo molde de Motorista/Motivo.
  function arrCadastro(tipo) { return tipo === 'motorista' ? _motoristas : tipo === 'conferente' ? _conferentes : _motivos; }
  function colCadastro(tipo) { return tipo === 'motorista' ? COL_MOTORISTAS : tipo === 'conferente' ? COL_CONFERENTES : COL_MOTIVOS; }
  function cadastroLista(tipo) {
    const arr = arrCadastro(tipo);
    const ic = tipo === 'motorista' ? '👤' : tipo === 'conferente' ? '🧑‍🔧' : '📝';
    const title = tipo === 'motorista' ? 'Motoristas de entrega' : tipo === 'conferente' ? 'Conferentes' : 'Motivos de devolução';
    const ph = tipo === 'motorista' ? 'Nome do motorista' : tipo === 'conferente' ? 'Nome do conferente' : 'Ex.: Cliente fechado';
    // PEDIDO AO VIVO (2026-09-03): "o conferente não vai precisar nem
    // selecionar... vai descobrir pelo login" — o Coletor passou a resolver
    // o conferente sozinho comparando o e-mail de quem está logado com este
    // campo, em vez de pedir pra escolher na tela. Só o cadastro de
    // conferente ganha e-mail (motorista/motivo não precisam disso).
    const campoEmail = tipo === 'conferente' ? `<input class="field" id="recusas-${tipo}-novo-email" placeholder="E-mail de login (Coletor)" style="margin-top:6px">` : '';
    return `<div class="tc" style="padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px"><b>${ic} ${title}</b></div>
      <div style="margin-bottom:10px"><div style="display:flex;gap:7px"><input class="field" id="recusas-${tipo}-novo" placeholder="${ph}"><button class="btn btn-primary btn-sm" data-recusa-add="${tipo}">Adicionar</button></div>${campoEmail}</div>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto">${arr.length ? arr.map(x => `<div style="display:flex;align-items:center;justify-content:space-between;border:1px solid var(--border);border-radius:8px;padding:8px 10px"><span>${esc(x.nome || '')}${tipo === 'motorista' && x.placa ? ' <small style="color:var(--muted)">(' + esc(x.placa) + ')</small>' : ''}${tipo === 'conferente' ? ' <small style="color:var(--muted)">(' + esc(x.email || 'sem e-mail') + ')</small>' : ''}${x.ativo === false ? ' <small style="color:var(--muted)">(inativo)</small>' : ''}</span><div style="display:flex;gap:5px">${tipo === 'conferente' ? `<button class="btn btn-ghost btn-sm" data-recusa-editar-email="${esc(x._id)}">✉️</button>` : ''}<button class="btn btn-ghost btn-sm" data-recusa-toggle="${tipo}:${esc(x._id)}">${x.ativo === false ? 'Ativar':'Inativar'}</button><button class="btn btn-ghost btn-sm" data-recusa-del="${tipo}:${esc(x._id)}">🗑️</button></div></div>`).join('') : '<div class="empty-sub">Nenhum cadastro ainda.</div>'}</div>
    </div>`;
  }

  // ── Importação em massa de Motoristas + Motivos (+ Placa) por planilha ──
  async function lerPlanilhaMotoristasMotivos(file) {
    if (!global.XLSX) throw new Error('Biblioteca do Excel não carregada.');
    const buf = await file.arrayBuffer();
    const wb = global.XLSX.read(buf, { type: 'array' });
    const aba = wb.SheetNames[0];
    if (!aba) return [];
    const linhas = global.XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: '' });
    const semCabecalho = (linhas.length && /ve[ií]culo|motorista/i.test(String(linhas[0][0] || '')))
      ? linhas.slice(1) : linhas;
    return semCabecalho
      .map(l => ({ motorista: String(l[0] || '').trim(), placa: String(l[1] || '').trim(), motivo: String(l[2] || '').trim() }))
      .filter(l => l.motorista || l.motivo);
  }
  async function lerImportacaoCadastros() {
    const input = document.getElementById('recusas-import-cadastros-arquivo');
    const file = input?.files?.[0];
    if (!file) { global.showToast?.('Selecione uma planilha.', 'error'); return; }
    try {
      const linhas = await lerPlanilhaMotoristasMotivos(file);
      const motoristasExistentes = new Set(_motoristas.map(m => normUpper(m.nome)));
      const motivosExistentes = new Set(_motivos.map(m => normUpper(m.nome)));
      const placaPorMotorista = new Map();
      const motoristasNovos = new Map();
      const motivosNovos = new Map();
      linhas.forEach(l => {
        if (l.motorista) {
          const key = normUpper(l.motorista);
          if (l.placa) placaPorMotorista.set(key, l.placa);
          if (!motoristasExistentes.has(key) && !motoristasNovos.has(key)) motoristasNovos.set(key, { nome: l.motorista, placa: l.placa || '' });
        }
        if (l.motivo) {
          const key = normUpper(l.motivo);
          if (!motivosExistentes.has(key) && !motivosNovos.has(key)) motivosNovos.set(key, { nome: l.motivo });
        }
      });
      const motoristasParaAtualizarPlaca = _motoristas
        .filter(m => !m.placa && placaPorMotorista.has(normUpper(m.nome)))
        .map(m => ({ _id: m._id, nome: m.nome, placaNova: placaPorMotorista.get(normUpper(m.nome)) }));
      _previewImportacaoCadastros = {
        totalLinhas: linhas.length,
        motoristasNovos: [...motoristasNovos.values()],
        motivosNovos: [...motivosNovos.values()],
        motoristasParaAtualizarPlaca,
      };
      desenharCadastros();
    } catch (e) {
      global.showToast?.('Erro ao ler a planilha: ' + (e.message || e), 'error');
    }
  }
  async function salvarImportacaoCadastros() {
    const p = _previewImportacaoCadastros;
    if (!p) return;
    const agora = agoraIso();
    try {
      for (const m of p.motoristasNovos) {
        await fs().collection(COL_MOTORISTAS).add({ nome: m.nome, placa: m.placa || '', ativo: true, criadoEm: agora, atualizadoEm: agora });
      }
      for (const m of p.motivosNovos) {
        await fs().collection(COL_MOTIVOS).add({ nome: m.nome, ativo: true, criadoEm: agora, atualizadoEm: agora });
      }
      for (const m of p.motoristasParaAtualizarPlaca) {
        await fs().collection(COL_MOTORISTAS).doc(m._id).set({ placa: m.placaNova, atualizadoEm: agora }, { merge: true });
      }
      const resumo = `Importação concluída: ${p.motoristasNovos.length} motorista(s) novo(s), ${p.motivosNovos.length} motivo(s) novo(s), ${p.motoristasParaAtualizarPlaca.length} placa(s) preenchida(s).`;
      _previewImportacaoCadastros = null;
      await carregarDados(true);
      desenharCadastros();
      global.showToast?.(resumo, 'success');
    } catch (e) {
      global.showToast?.('Erro ao salvar importação: ' + (e.message || e), 'error');
    }
  }
  function renderPreviewImportacaoCadastros() {
    const p = _previewImportacaoCadastros;
    if (!p) return '';
    if (!p.motoristasNovos.length && !p.motivosNovos.length && !p.motoristasParaAtualizarPlaca.length) {
      return '<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px;font-size:.78rem;color:var(--muted)">Nada novo pra importar — todos os motoristas e motivos dessa planilha já estão cadastrados.</div>';
    }
    return `<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
      <div style="font-size:.78rem;margin-bottom:8px">${p.totalLinhas} linha(s) lida(s) na planilha · <b>${p.motoristasNovos.length}</b> motorista(s) novo(s) · <b>${p.motivosNovos.length}</b> motivo(s) novo(s) · <b>${p.motoristasParaAtualizarPlaca.length}</b> placa(s) a completar em motorista já cadastrado</div>
      <button class="btn btn-primary" data-recusa-salvar-import-cadastros="1">Confirmar importação</button>
    </div>`;
  }

  function desenharCadastros() {
    const pagina = document.getElementById('page-recebimento-recusas-cadastros');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div><h2 style="margin:0">🗂️ Cadastros — Notas Retornadas</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Motoristas de entrega, motivos de devolução, conferentes e vendedores por mercado usados ao registrar um retorno.</div></div>
        <button class="btn btn-ghost" data-recusa-cad-atualizar="1">↻ Atualizar</button>
      </div>
      <div class="tc" style="padding:14px;margin:14px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div><b>📥 Importar Motoristas + Motivos (planilha)</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Colunas: Veículo/Motorista, Placa, Motivo. Cadastra o que ainda não existe — nunca duplica.</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="recusas-import-cadastros-arquivo" type="file" accept=".xlsx,.xls,.csv" style="max-width:280px"><button class="btn btn-ghost" data-recusa-ler-import-cadastros="1">Ler planilha</button></div></div>
        ${renderPreviewImportacaoCadastros()}
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:14px">${cadastroLista('motorista')}${cadastroLista('motivo')}${cadastroLista('conferente')}</div>
      ${renderVendedoresMercado()}`;
    ligarEventosCadastros();
    global.aplicarPermissoesAnalista?.();
  }

  function renderVendedoresMercado() {
    const rows = _vendedoresMercado.map(v => `<tr>
      <td class="mono">${esc(v.cnpj || '—')}</td>
      <td>${esc(v.nomeMercado || '—')}</td>
      <td>${esc(v.vendedorNome || '—')}${v.vendedorEmail ? '<br><small>' + esc(v.vendedorEmail) + '</small>' : ''}</td>
      <td>${esc(v.supervisorNome || '—')}${v.supervisorEmail ? '<br><small>' + esc(v.supervisorEmail) + '</small>' : ''}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-vm-editar="${esc(v._id)}">✏️</button> <button type="button" class="btn btn-danger btn-sm" data-vm-excluir="${esc(v._id)}">🗑</button></td>
    </tr>`).join('');
    return `<div class="tc" style="padding:14px;margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div><b>🧑‍💼 Vendedores por Mercado</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Cadastro local por CNPJ — as notas de venda do BI já vêm com vendedor/supervisor preenchidos, mas esse cadastro continua disponível pra referência manual.</div></div>
        <button type="button" class="btn btn-primary btn-sm" data-vm-novo="1">＋ Novo mercado</button>
      </div>
      ${rows ? `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>CNPJ</th><th>Mercado</th><th>Vendedor</th><th>Supervisor</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><div class="empty-title">Nenhum mercado cadastrado</div><div class="empty-sub">Clique em "Novo mercado" pra começar.</div></div>'}
    </div>`;
  }
  function abrirModalVendedorMercado(v) {
    v = v || {};
    document.getElementById('vm-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="vm-modal" class="v295-overlay" role="dialog" aria-modal="true"><div class="v295-dialog"><div class="modal-hdr"><div class="modal-title">${v._id ? 'Editar' : 'Novo'} mercado</div><button type="button" class="modal-close" data-vm-close>✕</button></div><div class="v287-form-grid"><div class="fi full"><div class="fl">CNPJ *</div><input id="vm-cnpj" value="${esc(v.cnpj || '')}" placeholder="Só números ou com pontuação"></div><div class="fi full"><div class="fl">Mercado / Cliente</div><input id="vm-mercado" value="${esc(v.nomeMercado || '')}"></div><div class="fi"><div class="fl">Vendedor</div><input id="vm-vendedor-nome" value="${esc(v.vendedorNome || '')}"></div><div class="fi"><div class="fl">E-mail do vendedor</div><input id="vm-vendedor-email" value="${esc(v.vendedorEmail || '')}"></div><div class="fi"><div class="fl">Supervisor</div><input id="vm-supervisor-nome" value="${esc(v.supervisorNome || '')}"></div><div class="fi"><div class="fl">E-mail do supervisor</div><input id="vm-supervisor-email" value="${esc(v.supervisorEmail || '')}"></div></div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-vm-close>Cancelar</button><button type="button" class="btn btn-primary" id="vm-salvar">Salvar</button></div></div></div>`);
    document.querySelectorAll('#vm-modal [data-vm-close]').forEach(b => b.onclick = () => document.getElementById('vm-modal')?.remove());
    document.getElementById('vm-salvar').onclick = async () => {
      const cnpj = String(document.getElementById('vm-cnpj').value || '').replace(/\D/g, '');
      if (!cnpj) return global.showToast?.('Informe o CNPJ.', 'error');
      const payload = {
        cnpj, nomeMercado: String(document.getElementById('vm-mercado').value || '').trim(),
        vendedorNome: String(document.getElementById('vm-vendedor-nome').value || '').trim(),
        vendedorEmail: String(document.getElementById('vm-vendedor-email').value || '').trim(),
        supervisorNome: String(document.getElementById('vm-supervisor-nome').value || '').trim(),
        supervisorEmail: String(document.getElementById('vm-supervisor-email').value || '').trim(),
        atualizadoEm: agoraIso(),
      };
      const btn = document.getElementById('vm-salvar'); btn.disabled = true; btn.textContent = 'Salvando...';
      try {
        if (v._id) await fs().collection(COL_VENDEDORES_MERCADO).doc(v._id).set(payload, { merge: true });
        else await fs().collection(COL_VENDEDORES_MERCADO).add({ ...payload, criadoEm: payload.atualizadoEm });
        document.getElementById('vm-modal')?.remove();
        await carregarDados(true); desenharCadastros();
        global.showToast?.('Mercado salvo.', 'success');
      } catch (e) { global.showToast?.('Erro ao salvar mercado: ' + (e.message || e), 'error'); btn.disabled = false; btn.textContent = 'Salvar'; }
    };
  }
  async function excluirVendedorMercado(id) {
    if (!id || !confirm('Excluir este mercado do cadastro?')) return;
    try { await fs().collection(COL_VENDEDORES_MERCADO).doc(id).delete(); await carregarDados(true); desenharCadastros(); global.showToast?.('Mercado excluído.', 'success'); }
    catch (e) { global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error'); }
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-recusas');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div><h2 style="margin:0">↩️ Notas Retornadas</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Ledger de notas de VENDA (importado do BI) — o Coletor usa isso pra achar a nota quando algo voltar fisicamente. Motorista/Motivo/Conferente ficam na aba <b>Cadastros</b>. Devoluções com motivo ficam em <b>Devoluções (BI)</b>.</div></div>
        <button class="btn btn-ghost" data-recusa-atualizar="1">↻ Atualizar</button>
      </div>
      ${resumoCards()}
      <div class="tc" style="padding:16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div><b>📊 Buscar notas de venda (BI)</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">${global.DTBiPastaLocal?.suportado?.() ? 'Atualiza sozinho a cada 30 min direto no servidor (não depende de ninguém deixar essa tela aberta) — clique em Buscar só se quiser forçar uma atualização imediata.' : 'Serviço de busca do BI indisponível no momento (recarregue a página).'}</div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${global.DTBiPastaLocal?.suportado?.() ? '<button class="btn btn-primary" data-recusa-buscar-bi="1">📊 Buscar</button>' : ''}</div></div>
        ${_ultimaBuscaBiTexto ? `<div style="font-size:.72rem;color:var(--muted);margin:-4px 0 0;padding:8px 10px;border-radius:8px;background:#f3f4f6">${_ultimaBuscaBiTexto}</div>` : ''}
      </div>
      <div class="tc" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div><b>📋 Notas retornadas registradas</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">O volume esperado fica visível somente aqui no Analista. Tratamento é sempre separado da Natureza da nota — nunca sobrescreve o dado importado.</div></div><button class="btn btn-ghost" data-recusa-exportar="1">⬇ Exportar Excel</button></div>
        ${filtrosHtml()}
        <div id="recusas-tabela">${renderRecusasTabela()}</div>
      </div>`;
    ligarEventos();
    global.aplicarPermissoesAnalista?.();
    _iniciarAutoRefreshBi();
  }

  // Uma linha do JSON é um ITEM da nota (várias linhas por chave quando a
  // nota tem mais de um produto) — junta por chave antes de gravar. Função
  // duplicada de propósito da equivalente em 100-consulta-notas-fiscais.js
  // (devolução) — mesmo padrão do resto do arquivo, pra não acoplar as duas
  // telas independentes.
  // PEDIDO AO VIVO (2026-09-02): "verifica pq não apareceu o gtin e dun" —
  // aqui (venda) o gtin sempre saía gravado vazio, hardcoded, porque essa
  // função foi escrita quando dum/ean só apareciam preenchidos nas linhas
  // de DEVOLUCAO no BI (ver 100-consulta-notas-fiscais.js linha ~139); os
  // dados reais de hoje mostram que notas_fiscais_jacson.json já traz
  // dum/ean preenchidos em VENDA também (confirmado: nota 176045, 100% das
  // 22.215 linhas de VENDA têm os dois campos) — passou a mapear igual à
  // devolução (DUN preferido sobre EAN, mesma prioridade pra bipagem).
  function _agruparNotasBiPorChave(itens) {
    const porChave = new Map();
    itens.forEach(it => {
      const chave = String(it.chave || '').trim();
      if (!chave) return;
      if (!porChave.has(chave)) {
        porChave.set(chave, {
          chave, numeroNota: it.nf_numero != null ? String(it.nf_numero) : '', serie: it.nf_serie != null ? String(it.nf_serie) : '',
          destinatario: it.cliente || '', dataEmissao: String(it.data_emissao || '').slice(0, 10), cfop: it.cfop || '',
          valorTotal: 0, vendedorNome: it.vendedor || '', supervisorNome: it.supervisor || '', itens: [],
        });
      }
      const nota = porChave.get(chave);
      nota.valorTotal += Number(it.valor_nota) || 0;
      // PEDIDO AO VIVO (2026-09-02, 3ª rodada): "o gtin ficou com o dun
      // também, cada um no lugar certo" — a rodada anterior deixou `gtin`
      // igual ao `dun` (DUN-preferido-com-fallback-EAN), o que duplicava
      // o mesmo valor nos dois campos quando dum existia (visto ao vivo
      // pelo usuário no Firestore). Agora cada campo é só a SUA fonte:
      // `gtin` = EAN-13 (unidade), `dun` = DUN-14 (caixa) — sem fallback
      // cruzado. 24-recebimento-recusas.js (bipagem no Coletor) foi
      // ajustado pra comparar o código escaneado com `it.dun` também
      // (antes só comparava com `it.gtin`), então bipar a caixa continua
      // funcionando mesmo com gtin agora sendo só o EAN.
      const gtinItem = it.ean != null ? String(it.ean) : '';
      const dunItem = it.dum != null ? String(it.dum) : '';
      nota.itens.push({ produtoKey: it.produto_key ?? null, descricao: it.produto || '', quantidade: Number(it.quantidade_faturada) || 0, gtin: gtinItem, dun: dunItem, ncm: '' });
    });
    return [...porChave.values()];
  }

  // PEDIDO AO VIVO (2026-08-27): venda não precisa de revisão manual antes
  // de salvar (diferente de devolução, que pode disparar gravação
  // automática num status já concluído) — grava direto, mesmo padrão já
  // usado em Ficha Técnica/Agenda de Recebimento.
  // PEDIDO AO VIVO (2026-08-27): "se já existe, então pula, pra não ficar
  // gerando gravação à toa" — venda é dado histórico (não muda depois de
  // faturada), então uma vez importada, buscas seguintes pulam ela de
  // propósito. Reaproveita _notas (já carregado na tela antes do clique em
  // Buscar) pra saber o que já existe, sem gerar uma leitura adicional só
  // pra essa checagem.
  // PEDIDO AO VIVO (2026-08-27): "eu quero que esse retorno de notas aí
  // seja só notas em aberto... caso a nota sumiu, é pra excluir do Firebase
  // também... a que for recebida pelo Coletor, aí não vai apagar" — o
  // jacson.json só traz venda ainda EM ABERTO (não entregue); uma venda que
  // sumiu da busca de hoje não está mais em aberto (foi entregue sem
  // intercorrência) — remove da referência. EXCETO se já tem um
  // recebimento_recusas apontando pra essa chave (voltou de verdade e foi
  // processada pelo Coletor) — essa fica pra sempre, alimenta indicadores/
  // gráficos. Nunca reconcilia com uma busca vazia (mesmo cuidado já usado
  // nos removedores da Bluesoft antiga: uma falha/leitura parcial nunca
  // pode virar "apagar tudo").
  async function _gravarNotasVenda(notas) {
    const chavesExistentes = new Set(_notas.map(n => n.chave));
    const notasNovas = notas.filter(n => !chavesExistentes.has(n.chave));
    const rawFs = raw();
    const agora = agoraIso();

    // Acha o chunk "aberto" (com espaço) pra continuar enchendo, em vez de
    // sempre abrir um novo — só fecha quando o atual bate TAMANHO_CHUNK OU
    // LIMITE_BYTES_CHUNK (ver _empacotarEmChunks). Contagem/bytes do chunk
    // aberto vêm de _notas (já carregado em memória), sem leitura extra.
    const contagemPorChunk = new Map();
    const bytesPorChunk = new Map();
    _notas.forEach(n => {
      contagemPorChunk.set(n.chunkIndex, (contagemPorChunk.get(n.chunkIndex) || 0) + 1);
      bytesPorChunk.set(n.chunkIndex, (bytesPorChunk.get(n.chunkIndex) || 0) + _tamanhoBytesEstimado(_notaResumida(n)));
    });
    const chunkInicial = _notas.length ? Math.max(...[..._notas.map(n => n.chunkIndex ?? 0)]) : 0;
    let estadoChunk = { chunkInicial, contagemInicial: contagemPorChunk.get(chunkInicial) || 0, bytesInicial: bytesPorChunk.get(chunkInicial) || 0 };

    // BUG AO VIVO REAL (2026-09-03): "se não foi recebida, ela tem que
    // apagar... senão só vai juntando nota lixo" — o usuário achou o ponto
    // que os consertos anteriores (tamanho do chunk) não resolviam:
    // gravar as notas NOVAS e REMOVER as que saíram de "em aberto" são 2
    // passos independentes, mas viviam um atrás do outro sem try/catch —
    // se o passo de GRAVAR falhasse (ex.: chunk estourou o 1MB), a
    // exceção subia direto e o passo de REMOVER (mais embaixo) NUNCA
    // rodava. Ou seja: toda vez que a gravação falhava, a limpeza também
    // parava — as notas "lixo" (que já não estão mais em aberto)
    // continuavam empilhando pra sempre, deixando qualquer chunk cada vez
    // mais perto do limite, piorando exatamente o problema que causou a
    // falha original. Agora um erro ao gravar novas é reportado mas NUNCA
    // impede a limpeza de rodar — os dois passos são de verdade
    // independentes.
    let erroAoGravar = null;
    try {
      for (let i = 0; i < notasNovas.length; i += 300) {
        const lote = notasNovas.slice(i, i + 300);
        const payloadsCompletos = lote.map(n => ({
          chave: n.chave, numeroNota: n.numeroNota, serie: n.serie, volumes: null, destinatario: n.destinatario || '',
          dataEmissao: n.dataEmissao || '', transportadora: '', arquivoOrigem: ARQUIVO_BI_NOTAS,
          valorTotal: Number(n.valorTotal) || 0, cfop: n.cfop || '', naturezaLabel: 'Venda', tipoOperacao: 'SAIDA',
          destinatarioCnpj: '', notaOriginalChave: null, notaOriginalNumero: null, informacoesComplementares: '',
          itens: n.itens || [], pareceDevolucao: false, origemImportacao: 'BI',
          vendedorNome: n.vendedorNome || '', vendedorEmail: '', supervisorNome: n.supervisorNome || '', supervisorEmail: '',
          ativo: true, atualizadoEm: agora,
        }));
        const chaveParaPayload = new Map(payloadsCompletos.map(p => [p.chave, p]));
        const { porChunk, comChunkIndex, estadoFinal } = _empacotarEmChunks(payloadsCompletos, estadoChunk);
        const batchIndividual = rawFs.batch();
        comChunkIndex.forEach(d => batchIndividual.set(fs().collection(COL_NOTAS).doc(d.chave), { ...chaveParaPayload.get(d.chave), chunkIndex: d.chunkIndex }, { merge: true }));
        await batchIndividual.commit();
        // Lê-modifica-grava por chunk (nunca mais merge cego com
        // "notas.CHAVE" — ver _lerEGravarChunk) — de quebra, já cura
        // qualquer campo solto legado que esse chunk específico tivesse.
        for (const [idx, mapaResumidas] of porChunk) {
          await _lerEGravarChunk(idx, notas => Object.assign(notas, mapaResumidas));
        }
        // Próximo lote de 300 continua exatamente de onde este parou
        // (mesmo chunk aberto, mesma contagem/bytes acumulados) — nunca
        // reseta pro chunkInicial original.
        estadoChunk = estadoFinal;
      }
    } catch (e) {
      erroAoGravar = e;
    }

    let removidas = 0;
    if (notas.length) {
      const chavesAbertasAgora = new Set(notas.map(n => n.chave));
      const chavesComRecebimento = new Set(_recusas.flatMap(r => r.chaves || []));
      const paraRemover = _notas.filter(n => n.origemImportacao === 'BI' && n.naturezaLabel === 'Venda' && !chavesAbertasAgora.has(n.chave) && !chavesComRecebimento.has(n.chave));
      for (let i = 0; i < paraRemover.length; i += 300) {
        const lote = paraRemover.slice(i, i + 300);
        const batchIndividual = rawFs.batch();
        const porChunkNesseLote = new Map();
        lote.forEach(n => {
          batchIndividual.delete(fs().collection(COL_NOTAS).doc(n.chave));
          if (!porChunkNesseLote.has(n.chunkIndex)) porChunkNesseLote.set(n.chunkIndex, []);
          porChunkNesseLote.get(n.chunkIndex).push(n.chave);
        });
        await batchIndividual.commit();
        // Lê-modifica-grava (ver _lerEGravarChunk) — nunca mais
        // FieldValue.delete() numa chave de ponto solta.
        for (const [idx, chaves] of porChunkNesseLote) {
          await _lerEGravarChunk(idx, notas => chaves.forEach(c => delete notas[c]));
        }
      }
      removidas = paraRemover.length;
    }
    // A limpeza já rodou (mesmo com erro ao gravar) — agora sim relata a
    // falha, pra quem clicou em "Buscar" continuar vendo o toast de erro.
    if (erroAoGravar) throw erroAoGravar;
    return { novas: notasNovas.length, removidas };
  }

  // PEDIDO AO VIVO (2026-09-04): "essas são notas recebidas que ainda não
  // estavam no banco... agora atualizei, as informações vieram menos o
  // volume" — quando o Coletor recebe uma nota com a chave ausente do
  // banco (ver MANUAL_SEM_BANCO em 24-recebimento-recusas.js), grava o
  // recebimento_recusas com volumeEsperado:0 pra sempre (não tinha como
  // saber o volume certo naquela hora). Toda sincronização de venda agora
  // aproveita pra corrigir sozinha qualquer nota já recebida que ficou com
  // esperado 0 e cuja chave apareceu nesta busca com itens de verdade —
  // sem precisar de nenhum clique manual do Analista.
  async function _corrigirVolumeEsperadoRecusas(notasComItens) {
    const porChave = new Map(notasComItens.map(n => [n.chave, n]));
    let corrigidas = 0;
    for (const r of _recusas) {
      if (!Array.isArray(r.notas) || !r.notas.length) continue;
      let mudou = false;
      const notasAtualizadas = r.notas.map(n => {
        if (Number(n.volumeEsperado || 0) !== 0) return n;
        const fresca = porChave.get(n.chave);
        if (!fresca) return n;
        const volumeReal = (fresca.itens || []).reduce((s, it) => s + (Number(it.quantidade) || 0), 0);
        if (volumeReal <= 0) return n;
        mudou = true;
        return { ...n, volumeEsperado: volumeReal };
      });
      if (!mudou) continue;
      const esperadoNovo = notasAtualizadas.reduce((s, n) => s + Number(n.volumeEsperado || 0), 0);
      const dif = Number(r.volumeInformado || 0) - esperadoNovo;
      const payload = { notas: notasAtualizadas, volumeEsperado: esperadoNovo, diferencaVolumes: dif, conferenciaStatus: dif === 0 ? 'CONFERIDO' : 'DIVERGENTE' };
      await fs().collection(COL_RECUSAS).doc(r._id).update(payload);
      Object.assign(r, payload);
      corrigidas++;
    }
    return corrigidas;
  }
  async function _importarNotasVendaBiRegistros(registros) {
    if (!Array.isArray(registros)) throw new Error('Formato inesperado — esperava uma lista de registros.');
    const vendas = registros.filter(r => String(r.tipo_movimento || '').toUpperCase() === 'VENDA');
    const notas = _agruparNotasBiPorChave(vendas);
    const { novas, removidas } = await _gravarNotasVenda(notas);
    const volumesCorrigidos = await _corrigirVolumeEsperadoRecusas(notas);
    await carregarDados(true);
    return { totalNotas: novas, totalRemovidas: removidas, totalEncontradas: notas.length, totalLinhas: vendas.length, volumesCorrigidos };
  }

  // PEDIDO AO VIVO (2026-08-26/27): "ele nao consegue ficar conectado
  // direto na pasta e eu só clica em em buscar e puxar automatico" +
  // "pode tirar a api bluesoft" + "não precisa ficar aqueles negócio lá...
  // deixa só o buscar" — um único botão, conecta a pasta do BI (uma vez) e
  // lê sozinho; sem seletor de arquivo manual, sem API da Bluesoft.
  async function buscarBiAutomatico() {
    if (!global.DTBiPastaLocal?.suportado?.()) return;
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') {
      const resultado = await global.DTBiPastaLocal.conectar();
      if (!resultado.ok) { global.showToast?.(resultado.erro, 'error'); return; }
    }
    try {
      const registros = await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_NOTAS);
      const { totalNotas, totalRemovidas, totalEncontradas, totalLinhas, volumesCorrigidos } = await _importarNotasVendaBiRegistros(registros);
      _ultimaBuscaBiTexto = `Última atualização: ${fmtHora(agoraIso())} — ${totalEncontradas} nota(s) de venda em aberto (de ${totalLinhas} linha(s) de item), ${totalNotas} nova(s) gravada(s), ${totalEncontradas - totalNotas} já existiam e foram puladas${totalRemovidas ? `, ${totalRemovidas} não estão mais em aberto e foram removidas` : ''}${volumesCorrigidos ? `, ${volumesCorrigidos} recebimento(s) já registrado(s) tiveram o volume esperado corrigido` : ''}.`;
      desenhar();
    } catch (e) {
      _ultimaBuscaBiTexto = `Falha na última busca (${fmtHora(agoraIso())}): ${e.message || e}`;
      global.showToast?.('Erro ao buscar no BI: ' + (e.message || e), 'error');
      desenhar();
    }
  }
  // PEDIDO AO VIVO (2026-09-02): "verifica pq não apareceu o gtin e dun" —
  // o fix em _agruparNotasBiPorChave só vale pra importações NOVAS; notas
  // de venda já gravadas antes disso ficaram com gtin='' pra sempre,
  // porque _gravarNotasVenda pula chave que já existe (venda é histórico,
  // não muda depois de faturada). GTIN/DUN é atributo do PRODUTO (código
  // de barras), não da venda em si — não muda de nota pra nota — dá pra
  // corrigir qualquer nota já gravada (mesmo uma que não esteja mais "em
  // aberto" no BI, então nunca mais reapareceria numa busca normal) só
  // reaproveitando o mapa produto_key→gtin construído a partir do arquivo
  // atual do BI, sem precisar bater a chave da nota. Ação manual (botão),
  // não roda sozinha — não faz sentido ler a coleção inteira a cada 30 min
  // pra sempre só por causa de um conserto de uma vez só.
  async function _corrigirGtinNotasVenda() {
    if (!global.DTBiPastaLocal?.suportado?.()) { global.showToast?.('Serviço de BI indisponível no momento.', 'error'); return; }
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') { const r = await global.DTBiPastaLocal.conectar(); if (!r.ok) { global.showToast?.(r.erro, 'error'); return; } }
    try {
      const registros = await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_NOTAS);
      const porProduto = new Map();
      (Array.isArray(registros) ? registros : []).forEach(it => {
        const key = it.produto_key;
        if (key == null || porProduto.has(key)) return;
        const gtin = it.ean != null ? String(it.ean) : '';
        const dun = it.dum != null ? String(it.dum) : '';
        if (gtin || dun) porProduto.set(key, { gtin, dun });
      });
      const snap = await fs().collection(COL_NOTAS).get();
      const docsParaCorrigir = [];
      let itensCorrigidos = 0;
      // PEDIDO AO VIVO (2026-09-02, 2ª rodada): "o gtin ficou com o dun
      // também, cada um no lugar certo" — a rodada anterior deste botão já
      // tinha rodado e gravado gtin=dun (duplicado) nalgumas notas; por
      // isso SEMPRE recalcula gtin/dun a partir do BI quando há
      // correspondência (não só quando estava vazio), pra corrigir também
      // o que ficou errado da vez passada, não só o que faltava.
      snap.docs.forEach(d => {
        const data = d.data() || {};
        let mudou = false;
        const itensNovos = (data.itens || []).map(it => {
          const achado = porProduto.get(it.produtoKey);
          if (!achado) return it;
          const gtin = achado.gtin || it.gtin || '', dun = achado.dun || it.dun || '';
          if (gtin === (it.gtin || '') && dun === (it.dun || '')) return it;
          mudou = true; itensCorrigidos++;
          return { ...it, gtin, dun };
        });
        if (mudou) docsParaCorrigir.push({ id: d.id, itens: itensNovos });
      });
      const rawFs = raw();
      for (let i = 0; i < docsParaCorrigir.length; i += 300) {
        const lote = docsParaCorrigir.slice(i, i + 300);
        const batch = rawFs.batch();
        lote.forEach(n => batch.set(fs().collection(COL_NOTAS).doc(n.id), { itens: n.itens }, { merge: true }));
        await batch.commit();
      }
      global.showToast?.(docsParaCorrigir.length ? `${docsParaCorrigir.length} nota(s) corrigida(s), ${itensCorrigidos} item(ns) com GTIN/DUN preenchido.` : 'Nenhuma nota com GTIN/DUN faltando (ou produto sem código de barras no BI ainda).', 'success');
    } catch (e) {
      global.showToast?.('Erro ao corrigir GTIN: ' + (e.message || e), 'error');
    }
  }
  // BUG AO VIVO REAL (2026-09-03): "Falha na última busca: ...chunk_1
  // cannot be written because its size (1.084.326 bytes) exceeds the
  // maximum allowed size of 1.048.576 bytes" — quando um chunk já estava no
  // limite, o commit do PACOTE (chunk) falhava inteiro, mas o commit dos
  // docs INDIVIDUAIS (COL_NOTAS) já tinha rodado antes e tinha ido — essas
  // notas ficam com um chunkIndex que aponta pra um pacote que nunca as
  // recebeu de verdade: gravadas, mas invisíveis pra tela (que só lê os
  // chunks). Ação manual (leitura cara — lê COL_NOTAS inteira — só faz
  // sentido rodar sob pedido, nunca sozinha): acha essas órfãs comparando
  // com o que os chunks realmente têm, e reempacota (respeitando
  // TAMANHO_CHUNK/LIMITE_BYTES_CHUNK, agora corrigidos) a partir do estado
  // REAL do chunk mais recente — nunca confia no chunkIndex gravado nos
  // docs individuais pra isso, porque é exatamente esse campo que pode
  // estar errado no bug que estamos reparando.
  // Relatório de verdade, sem adivinhação: lê os pacotes REAIS e mostra o
  // tamanho de cada um — pra ver os números de verdade em vez de continuar
  // chutando por que o erro de 1MB do Firestore continua acontecendo.
  async function diagnosticoChunks() {
    const chunksSnap = await fs().collection(COL_NOTAS_CHUNKS).get();
    const linhas = chunksSnap.docs.map(doc => {
      const dados = doc.data() || {};
      const notas = Object.values(_notasDoDocumentoChunk(dados));
      const bytesReais = _tamanhoBytesEstimado(dados); // o documento INTEIRO como ele é gravado, não só as notas somadas
      // BUG AO VIVO REAL (2026-09-03): 0 notas dentro mas o documento pesa
      // mais de 1MB — a contagem lê `dados.notas`, mas claramente o peso
      // de verdade está em outro lugar do documento. Lista TODAS as chaves
      // de 1º nível (e quantas "sub-chaves" cada uma tem, se for objeto) —
      // pra achar exatamente onde o dado está de verdade, sem adivinhar.
      const chavesNivel1 = Object.keys(dados).map(k => {
        const v = dados[k];
        const ehObjeto = v && typeof v === 'object' && !Array.isArray(v);
        return `${k}${ehObjeto ? ' (' + Object.keys(v).length + ' sub-chave(s))' : Array.isArray(v) ? ' (array, ' + v.length + ')' : ''}`;
      });
      return { id: doc.id, qtd: notas.length, bytes: bytesReais, chaves: chavesNivel1 };
    }).sort((a, b) => b.bytes - a.bytes);
    return linhas;
  }
  // BUG AO VIVO REAL (2026-09-03, causa raiz de verdade): "0 notas dentro,
  // mas o documento pesa mais de 1MB" — confirmado com diagnóstico real
  // que .set(ref,{'notas.'+chave: valor},{merge:true}) NUNCA criou o mapa
  // aninhado {notas:{chave:valor}} — criou um campo LITERAL solto
  // "notas.CHAVE" na raiz do documento. Isso é desde o INÍCIO deste
  // recurso (não só de hoje) — todo chunk sempre "parecia" ter 0 notas
  // pra contagem/limite/remoção, então o sistema sempre achava que tinha
  // espaço de sobra e foi empilhando pra sempre. Os reparos anteriores
  // (repararNotasOrfasDosChunks/dividirChunksGrandesDemais) tinham o
  // MESMO problema — liam/gravavam do jeito errado, por isso nunca
  // resolviam nada de verdade. Substituídos por UMA reconstrução completa:
  // lê TUDO (docs individuais + todos os chunks, nos dois formatos —
  // aninhado e campo solto legado), junta numa lista única sem duplicar,
  // apaga os chunks antigos e reempacota do zero (chunk_0, chunk_1...)
  // com a estrutura CORRETA — sempre `.set(ref,{notas:mapaCompleto})`
  // (nunca mais merge com chave de ponto).
  async function reconstruirTodosOsChunks() {
    const [individualSnap, chunksSnap] = await Promise.all([
      fs().collection(COL_NOTAS).get(),
      fs().collection(COL_NOTAS_CHUNKS).get(),
    ]);
    const todasAsNotas = new Map(); // chave -> nota completa (dados suficientes pra _notaResumida)
    chunksSnap.docs.forEach(doc => {
      Object.entries(_notasDoDocumentoChunk(doc.data())).forEach(([chave, nota]) => {
        if (!todasAsNotas.has(chave)) todasAsNotas.set(chave, { ...nota, chave });
      });
    });
    let orfasEncontradas = 0;
    individualSnap.docs.forEach(d => {
      if (todasAsNotas.has(d.id)) return;
      orfasEncontradas++;
      todasAsNotas.set(d.id, { ...(d.data() || {}), chave: d.id });
    });
    const rawFs = raw();
    const { porChunk, comChunkIndex } = _empacotarEmChunks([...todasAsNotas.values()]);
    // Grava os chunks NOVOS primeiro (nunca deixa uma leitura no meio do
    // caminho ver menos notas do que existe de verdade).
    const chunksNovosIds = new Set([...porChunk.keys()].map(idx => 'chunk_' + idx));
    for (const [idx, mapaResumidas] of porChunk) {
      const batch = rawFs.batch();
      batch.set(fs().collection(COL_NOTAS_CHUNKS).doc('chunk_' + idx), { notas: mapaResumidas });
      await batch.commit();
    }
    // Some com qualquer chunk antigo que não faça mais parte do resultado
    // novo (ex.: um índice que ficou menor que antes, ou um doc só com o
    // lixo de campos soltos que já foi todo reaproveitado).
    for (const doc of chunksSnap.docs) {
      if (chunksNovosIds.has(doc.id)) continue;
      const batch = rawFs.batch();
      batch.delete(fs().collection(COL_NOTAS_CHUNKS).doc(doc.id));
      await batch.commit();
    }
    // Atualiza o chunkIndex de cada doc individual pra bater com onde a
    // nota realmente ficou depois da reconstrução.
    for (let i = 0; i < comChunkIndex.length; i += 300) {
      const sublote = comChunkIndex.slice(i, i + 300);
      const batch = rawFs.batch();
      sublote.forEach(d => batch.set(fs().collection(COL_NOTAS).doc(d.chave), { chunkIndex: d.chunkIndex }, { merge: true }));
      await batch.commit();
    }
    return { totalNotas: todasAsNotas.size, totalChunks: porChunk.size, orfasEncontradas, chunksRemovidos: chunksSnap.docs.filter(d => !chunksNovosIds.has(d.id)).length };
  }
  // Pedido ao vivo do usuário: atualizar sozinho de tempos em tempos (30
  // min), sem precisar clicar — só quando a pasta JÁ está conectada (nunca
  // pede permissão de pasta sozinho, isso sempre exige um clique humano).
  // Iniciado uma única vez por carregamento de página (guard de
  // idempotência) — desenhar() roda de novo a cada re-render da tela.
  function _iniciarAutoRefreshBi() {
    if (_autoRefreshIniciado) return;
    if (!global.DTBiPastaLocal?.suportado?.() || typeof global.setInterval !== 'function') return;
    _autoRefreshIniciado = true;
    global.setInterval(async () => {
      try {
        const status = await global.DTBiPastaLocal.status();
        if (status === 'conectado') await buscarBiAutomatico();
      } catch (e) { /* silencioso — só o clique manual mostra erro */ }
    }, INTERVALO_AUTO_BUSCA_MS);
  }

  // FASE 8 — modal injetado via JS.
  function _ensureAtribuirConferenciaModal() {
    let modal = document.getElementById('modal-recusa-atribuir-conferencia');
    if (modal) return modal;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-bg" id="modal-recusa-atribuir-conferencia"><div class="modal" style="max-width:480px">
<div class="modal-title">📋 Solicitar conferência</div>
<div id="recusa-atrib-resumo" style="font-size:.78rem;color:var(--muted);padding:9px 11px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px"></div>
<div class="form-group"><label>Operador responsável</label><select class="field" id="recusa-atrib-operador"><option value="">Selecione...</option></select></div>
<div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="window.closeModal?.('modal-recusa-atribuir-conferencia')">Cancelar</button><button class="btn btn-primary" type="button" onclick="window.confirmarAtribuicaoConferenciaRecusa?.()">Solicitar</button></div>
</div></div>`);
    return document.getElementById('modal-recusa-atribuir-conferencia');
  }
  async function abrirAtribuirConferencia(recusaId) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    _recusaAtribuindoId = recusaId;
    _ensureAtribuirConferenciaModal();
    const resumo = document.getElementById('recusa-atrib-resumo');
    if (resumo) resumo.innerHTML = `<b>${esc((r.notas || []).map(n => 'NF ' + n.numeroNota).join(' • ') || '—')}</b><br>Box ${esc(r.box || '—')}`;
    global.openModal?.('modal-recusa-atribuir-conferencia');
    if (typeof global.divPopularSelectOperadores === 'function') await global.divPopularSelectOperadores('recusa-atrib-operador');
  }
  async function confirmarAtribuicaoConferenciaRecusa() {
    const operador = document.getElementById('recusa-atrib-operador')?.value?.trim();
    if (!operador) { global.showToast?.('Selecione um operador.', 'error'); return; }
    const r = _recusas.find(x => x._id === _recusaAtribuindoId);
    if (!r) return;
    const u = usuarioAtual();
    try {
      await fs().collection(COL_TAREFAS).doc(r._id).set({
        recusaId: r._id, box: r.box || '', notas: r.notas || [],
        atribuidoPara: operador, atribuidoPor: u.email || u.uid || '', atribuidoEm: agoraIso(), status: 'PENDENTE',
      }, { merge:true });
      global.closeModal?.('modal-recusa-atribuir-conferencia');
      await carregarDados(true);
      desenhar();
      global.showToast?.('Conferência solicitada para ' + operador + '.', 'success');
    } catch (e) { global.showToast?.('Erro ao solicitar conferência: ' + (e.message || e), 'error'); }
  }
  global.confirmarAtribuicaoConferenciaRecusa = confirmarAtribuicaoConferenciaRecusa;

  // FASE 9 — tela de detalhe: junta o que está na RECUSA (retorno/
  // transporte/conferência/tratamento/auditoria) com o que está na NOTA
  // original (recebimento_recusas_notas, por chave — natureza/CFOP/
  // itens/vendedor), sem nunca misturar os dois conceitos num campo só.
  function _ensureDetalheModal() {
    let modal = document.getElementById('modal-recusa-detalhe');
    if (modal) return modal;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-bg" id="modal-recusa-detalhe"><div class="modal" style="max-width:720px;max-height:85vh;overflow:auto">
<div class="modal-title">🔍 Detalhe da nota retornada</div>
<div id="recusa-detalhe-corpo"></div>
<div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="window.closeModal?.('modal-recusa-detalhe')">Fechar</button></div>
</div></div>`);
    return document.getElementById('modal-recusa-detalhe');
  }
  function detalheNotaHtml(r) {
    const notasCompletas = (r.notas || []).map(n => _notas.find(x => x.chave === n.chave) || n);
    return notasCompletas.map(n => `<div class="tc" style="padding:11px;margin-bottom:8px">
      <div style="font-weight:800">NF ${esc(n.numeroNota || '—')}${n.serie ? ' · Série ' + esc(n.serie) : ''}</div>
      <div style="font-size:.76rem;color:var(--muted);margin-top:3px">CFOP ${esc(n.cfop || '—')} · ${esc(n.naturezaLabel || n.tipoOperacao || 'Natureza não informada')}${n.pareceDevolucao ? ' · <span style="color:#b45309">↩️ parece devolução</span>' : ''}</div>
      <div style="font-size:.78rem;margin-top:5px">Destinatário: ${esc(n.destinatario || n.destinatarioNome || '—')}${n.destinatarioCnpj ? ' (' + esc(n.destinatarioCnpj) + ')' : ''}</div>
      ${n.valorTotal != null ? `<div style="font-size:.78rem;margin-top:3px">Valor da nota: ${Number(n.valorTotal || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>` : ''}
      ${n.vendedorNome ? `<div style="font-size:.78rem;margin-top:3px">Vendedor: ${esc(n.vendedorNome)}${n.vendedorEmail ? ' — ' + esc(n.vendedorEmail) : ''}</div>` : ''}
      ${n.supervisorNome ? `<div style="font-size:.78rem">Supervisor: ${esc(n.supervisorNome)}${n.supervisorEmail ? ' — ' + esc(n.supervisorEmail) : ''}</div>` : ''}
      ${n.informacoesComplementares ? `<div style="font-size:.78rem;margin-top:5px;padding:8px;border-radius:6px;background:#4a3114;color:#ffd18a"><b>Motivo (informações complementares):</b> ${esc(n.informacoesComplementares)}</div>` : ''}
    </div>`).join('') || '<div class="empty-sub">Sem dados de nota disponíveis.</div>';
  }
  function detalheConferenciaHtml(r) {
    const status = r.statusConferenciaOperacional || 'NAO_REALIZADA';
    if (status === 'NAO_REALIZADA') return '<div style="padding:9px 11px;border-radius:8px;background:#f3f4f6;color:var(--muted);font-size:.8rem">Conferência de produtos: NÃO REALIZADA (só volume foi conferido).</div>';
    const itens = r.itensConferidos || [];
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>GTIN</th><th>Previsto</th><th>Conferido</th></tr></thead><tbody>${itens.map(it => {
      const div = Number(it.qtdConferida) !== Number(it.qtdPrevista);
      return `<tr><td>${esc(it.descricao || '—')}</td><td class="mono">${esc(it.gtin || '—')}</td><td>${Number(it.qtdPrevista) || 0}</td><td style="font-weight:800;color:${div ? '#dc2626' : '#15803d'}">${Number(it.qtdConferida) || 0}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  // PEDIDO AO VIVO (2026-09-08): Tratamento é por NOTA agora — o detalhe
  // não pode esconder isso atrás de uma linha só pro documento inteiro
  // quando as notas do mesmo evento tiverem tratamentos diferentes.
  function auditoriaTratamentoHtml(r) {
    return (r.notas || []).map(n => {
      const definidoPor = n.tratamentoDefinidoPor != null ? n.tratamentoDefinidoPor : r.tratamentoDefinidoPor;
      if (!definidoPor) return '';
      const definidoEm = n.tratamentoDefinidoEm != null ? n.tratamentoDefinidoEm : r.tratamentoDefinidoEm;
      const valor = n.tratamento != null ? n.tratamento : (r.tratamento || '');
      return `<div style="margin-top:3px">NF ${esc(n.numeroNota || '—')} — Tratamento definido por ${esc(definidoPor)} em ${fmtDataHora(definidoEm)}: ${esc(TRATAMENTO_LABELS[valor] || valor)}</div>`;
    }).join('');
  }
  function abrirDetalheRecusa(recusaId) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    _recusaDetalheId = recusaId;
    _ensureDetalheModal();
    const corpo = document.getElementById('recusa-detalhe-corpo');
    if (corpo) corpo.innerHTML = `
      <div style="font-size:.76rem;font-weight:800;color:var(--muted);margin:6px 0">NOTA(S) FISCAL(IS)</div>
      ${detalheNotaHtml(r)}
      <div style="font-size:.76rem;font-weight:800;color:var(--muted);margin:14px 0 6px">RETORNO E TRANSPORTE</div>
      <div class="tc" style="padding:11px"><div>Motorista: ${esc(r.motoristaNome || '—')} · Motivo: ${esc(r.motivoNome || '—')}${r.conferenteNome ? ' · Conferente: ' + esc(r.conferenteNome) : ''}</div><div style="margin-top:4px">Box ${esc(r.box || '—')}${r.pallets != null ? ' · ' + esc(r.pallets) + ' pallet(s)' : ''}</div><div style="margin-top:4px">Volume esperado ${Number(r.volumeEsperado || 0)} · Contado ${Number(r.volumeInformado || 0)}</div></div>
      <div style="font-size:.76rem;font-weight:800;color:var(--muted);margin:14px 0 6px">CONFERÊNCIA DE PRODUTOS</div>
      ${detalheConferenciaHtml(r)}
      <div style="font-size:.76rem;font-weight:800;color:var(--muted);margin:14px 0 6px">AUDITORIA</div>
      <div class="tc" style="padding:11px;font-size:.78rem">
        <div>Criado por ${esc(r.criadoPorEmail || '—')} em ${fmtDataHora(r.criadoEm)}</div>
        ${r.conferenciaConcluidaPorEmail ? `<div style="margin-top:3px">Conferência concluída por ${esc(r.conferenciaConcluidaPorEmail)} em ${fmtDataHora(r.conferenciaConcluidaEm)}</div>` : ''}
        ${auditoriaTratamentoHtml(r)}
      </div>`;
    global.openModal?.('modal-recusa-detalhe');
  }

  async function adicionarCadastro(tipo) {
    const input = document.getElementById(`recusas-${tipo}-novo`);
    const nome = String(input?.value || '').trim();
    if (!nome) { global.showToast?.('Informe o nome.', 'error'); return; }
    const col = colCadastro(tipo);
    const ja = arrCadastro(tipo).some(x => String(x.nome || '').toLowerCase() === nome.toLowerCase());
    if (ja) { global.showToast?.('Esse cadastro já existe.', 'error'); return; }
    const payload = { nome, ativo:true, criadoEm:agoraIso(), atualizadoEm:agoraIso() };
    if (tipo === 'conferente') {
      const inputEmail = document.getElementById('recusas-conferente-novo-email');
      payload.email = String(inputEmail?.value || '').trim().toLowerCase();
    }
    try {
      await fs().collection(col).add(payload);
      await carregarDados(true); desenharCadastros(); global.showToast?.('Cadastro salvo.', 'success');
    } catch(e) { global.showToast?.('Erro ao salvar cadastro: ' + (e.message || e), 'error'); }
  }
  async function editarEmailConferente(id) {
    const item = _conferentes.find(x => x._id === id); if (!item) return;
    const novo = prompt('E-mail de login (Coletor) deste conferente:', item.email || '');
    if (novo == null) return;
    try {
      await fs().collection(COL_CONFERENTES).doc(id).set({ email: String(novo).trim().toLowerCase(), atualizadoEm:agoraIso() }, {merge:true});
      await carregarDados(true); desenharCadastros(); global.showToast?.('E-mail atualizado.', 'success');
    } catch(e) { global.showToast?.('Erro: ' + (e.message || e), 'error'); }
  }
  async function toggleCadastro(tipo,id) {
    const item = arrCadastro(tipo).find(x => x._id === id); if (!item) return;
    const col = colCadastro(tipo);
    try { await fs().collection(col).doc(id).set({ ativo:item.ativo === false, atualizadoEm:agoraIso() }, {merge:true}); await carregarDados(true); desenharCadastros(); } catch(e){ global.showToast?.('Erro: '+(e.message||e),'error'); }
  }
  async function deletarCadastro(tipo,id) {
    const col = colCadastro(tipo);
    if (!confirm('Excluir este cadastro? Registros antigos de recusa continuarão com o nome salvo no histórico.')) return;
    try { await fs().collection(col).doc(id).delete(); await carregarDados(true); desenharCadastros(); } catch(e){ global.showToast?.('Erro: '+(e.message||e),'error'); }
  }

  function ligarBotoesTabela() {
    document.querySelectorAll('[data-recusa-solicitar-conf]').forEach(b => b.addEventListener('click', () => abrirAtribuirConferencia(b.dataset.recusaSolicitarConf)));
    document.querySelectorAll('[data-recusa-detalhe]').forEach(b => b.addEventListener('click', () => abrirDetalheRecusa(b.dataset.recusaDetalhe)));
    document.querySelectorAll('[data-recusa-excluir]').forEach(b => b.addEventListener('click', () => excluirRecusa(b.dataset.recusaExcluir)));
    document.querySelectorAll('[data-recusa-tratamento]').forEach(sel => sel.addEventListener('change', () => {
      const [recusaId, notaChave] = String(sel.dataset.recusaTratamento).split('|');
      alterarTratamento(recusaId, notaChave, sel.value);
    }));
    document.querySelectorAll('[data-recusa-motivo]').forEach(sel => sel.addEventListener('change', () => alterarMotivo(sel.dataset.recusaMotivo, sel.value)));
    document.querySelectorAll('[data-recusa-status]').forEach(sel => sel.addEventListener('change', () => {
      const [recusaId, notaChave] = String(sel.dataset.recusaStatus).split('|');
      mudarStatusRetorno(recusaId, notaChave, sel.value);
    }));
    document.querySelectorAll('[data-recusa-reentrega-data]').forEach(inp => inp.addEventListener('change', () => {
      const [idNota, campo] = String(inp.dataset.recusaReentregaData).split(':');
      const [recusaId, notaChave] = idNota.split('|');
      salvarDataReentrega(recusaId, notaChave, campo, inp.value);
    }));
  }
  function redesenharTabela() {
    const host = document.getElementById('recusas-tabela');
    if (host) host.innerHTML = renderRecusasTabela();
    ligarBotoesTabela();
  }

  async function excluirRecusa(recusaId) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const notasTxt = (r.notas || []).map(n => n.numeroNota).filter(Boolean).join(', ') || recusaId;
    if (!confirm(`Excluir a nota retornada registrada (NF ${notasTxt})? Essa ação não pode ser desfeita.`)) return;
    try {
      await fs().collection(COL_RECUSAS).doc(recusaId).delete();
      _recusas = _recusas.filter(x => x._id !== recusaId);
      desenhar();
      global.showToast?.('Nota retornada excluída.', 'success');
    } catch (e) { global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error'); }
  }
  // PEDIDO AO VIVO (2026-09-08): Tratamento agora é POR NOTA (o mesmo
  // evento de conferência pode trazer uma nota que vira Recusa e outra que
  // vira Reentrega) — grava dentro do item da nota em `notas[]`, nunca
  // mais no documento inteiro. `recusaId` identifica o documento,
  // `notaChave` identifica QUAL nota dentro dele.
  async function alterarTratamento(recusaId, notaChave, valor) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const notas = Array.isArray(r.notas) ? r.notas.slice() : [];
    let idx = notas.findIndex(n => (n.chave || '') === notaChave);
    // Documento antigo sem `notas` real (ou array vazio) — mesmo
    // placeholder que a renderização já usa (linhasPorNota: `[{}]`) — cria
    // de verdade no 1º clique em vez de descartar a edição.
    if (idx === -1) { if (notas.length) return; idx = 0; notas.push({}); }
    const u = usuarioAtual();
    const agora = agoraIso();
    const nota = notas[idx];
    const patchNota = { tratamento: valor, tratamentoDefinidoEm: agora, tratamentoDefinidoPor: u.email || u.uid || '' };
    // PEDIDO AO VIVO (2026-09-03, pt. 3): "a partir do momento que ela foi
    // liberada pra recusa... a partir desse dia aí que vai começar a
    // contar a média de dias parado" — `liberadoParaRecusarEm` é essa data,
    // carimbada só na 1ª vez que a NOTA vira Recusa (nunca sobrescrita se o
    // Analista mudar o tratamento de novo depois) — ver Indicadores de
    // Recusas (103-recusas-indicadores.js). Registro antigo (de antes desta
    // migração) já pode ter essa data no DOCUMENTO — herda o valor real em
    // vez de carimbar "agora" na 1ª edição pós-migração, senão perderia a
    // data histórica verdadeira.
    if (valor === 'RECUSA' && !nota.liberadoParaRecusarEm) patchNota.liberadoParaRecusarEm = nota.liberadoParaRecusarEm || r.liberadoParaRecusarEm || agora;
    const notasAtualizadas = notas.map((n, i) => i === idx ? Object.assign({}, n, patchNota) : n);
    try {
      await fs().collection(COL_RECUSAS).doc(recusaId).update({ notas: notasAtualizadas });
      r.notas = notasAtualizadas;
      // PEDIDO AO VIVO (2026-09-08): a coluna "Status do retorno" depende
      // do Tratamento (Recusa mostra o select de status, Reentrega mostra
      // as datas, em branco não mostra nada) — precisa redesenhar pra essa
      // célula aparecer assim que a nota é classificada, sem esperar outro
      // redesenho acontecer por acaso (ex.: mexer num filtro).
      redesenharTabela();
      global.showToast?.('Tratamento atualizado.', 'success');
    } catch (e) { global.showToast?.('Erro ao salvar tratamento: ' + (e.message || e), 'error'); }
  }
  async function alterarMotivo(recusaId, motivoId) {
    const r = _recusas.find(x => x._id === recusaId);
    if (!r) return;
    const motivo = _motivos.find(x => x._id === motivoId);
    const u = usuarioAtual(),quando=agoraIso();
    const payload={motivoId:motivoId||'',motivoNome:motivo?.nome||'',motivoAlteradoEm:quando,motivoAlteradoPor:u.email||u.uid||''};
    if(r.motivoOriginalId==null)payload.motivoOriginalId=r.motivoId||'';
    if(r.motivoOriginalNome==null)payload.motivoOriginalNome=r.motivoNome||'';
    try {
      await fs().collection(COL_RECUSAS).doc(recusaId).update(payload);
      Object.assign(r,payload);
      global.showToast?.('Motivo atualizado.', 'success');
    } catch(e){ redesenharTabela(); global.showToast?.('Erro ao salvar motivo: '+(e.message||e),'error'); }
  }

  // FASE 10 — Excel: uma linha por ITEM (cabeçalho da nota/retorno
  // repetido em cada linha). Exporta a lista JÁ FILTRADA.
  function linhasExportacao() {
    const linhas = [];
    filtrarRecusas().forEach(r => {
      const notasCompletas = (r.notas || []).map(n => ({ ...(_notas.find(x => x.chave === n.chave) || {}), ...n }));
      const itensPorNota = new Map();
      (r.itensConferidos || []).forEach(it => { const l = itensPorNota.get(it.notaChave) || []; l.push(it); itensPorNota.set(it.notaChave, l); });
      (notasCompletas.length ? notasCompletas : [{}]).forEach(n => {
        const itens = itensPorNota.get(n.chave) || [];
        (itens.length ? itens : [null]).forEach(it => {
          linhas.push({
            'Data/Hora': fmtDataHora(r.criadoEm), 'NF': n.numeroNota || '', 'Série': n.serie || '', 'CFOP': n.cfop || '',
            'Natureza (NF)': n.naturezaLabel || n.tipoOperacao || '', 'Valor Total NF': n.valorTotal ?? '', 'Motivo (informações complementares)': n.informacoesComplementares || '', 'Chave': n.chave || '',
            'Destinatário': n.destinatario || n.destinatarioNome || '', 'CNPJ Destinatário': n.destinatarioCnpj || '',
            'Vendedor': n.vendedorNome || '', 'E-mail Vendedor': n.vendedorEmail || '',
            'Supervisor': n.supervisorNome || '', 'E-mail Supervisor': n.supervisorEmail || '',
            'Motorista': r.motoristaNome || '', 'Conferente': r.conferenteNome || '', 'Motivo': r.motivoNome || '',
            'Box': r.box || '', 'Pallets': r.pallets ?? '', 'Origem': r.origem || '',
            'Volume Esperado': Number(r.volumeEsperado || 0), 'Volume Contado': Number(r.volumeInformado || 0),
            'Diferença Volume': Number(r.diferencaVolumes || 0), 'Conferência de Volume': r.conferenciaStatus || '',
            'Tratamento (Analista)': TRATAMENTO_LABELS[r.tratamento || ''] || r.tratamento || '',
            'Status Conferência de Produtos': r.statusConferenciaOperacional || 'NAO_REALIZADA',
            'Produto': it?.descricao || '', 'GTIN': it?.gtin || '',
            'Qtd Prevista': it ? (Number(it.qtdPrevista) || 0) : '', 'Qtd Conferida': it ? (Number(it.qtdConferida) || 0) : '',
            'Criado Por': r.criadoPorEmail || '', 'Conferência Concluída Por': r.conferenciaConcluidaPorEmail || '',
          });
        });
      });
    });
    return linhas;
  }
  function exportarNotasRetornadas() {
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    const linhas = linhasExportacao();
    if (!linhas.length) { global.showToast?.('Nenhuma nota retornada pra exportar (confira os filtros).', 'error'); return; }
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(linhas), 'Notas_Retornadas');
    global.XLSX.writeFile(wb, 'notas_retornadas_' + new Date().toISOString().slice(0,10) + '.xlsx');
  }

  function ligarEventos() {
    document.querySelector('[data-recusa-atualizar]')?.addEventListener('click', async()=>{ await carregarDados(true); desenhar(); });
    document.querySelector('[data-recusa-exportar]')?.addEventListener('click', exportarNotasRetornadas);
    document.querySelector('[data-recusa-buscar-bi]')?.addEventListener('click', buscarBiAutomatico);
    ligarBotoesTabela();
    document.getElementById('recusas-filtro')?.addEventListener('input', e => { _filtro=e.target.value || ''; redesenharTabela(); });
    document.getElementById('recusas-filtro-periodo-ini')?.addEventListener('change', e => { _filtroPeriodoInicio=e.target.value || ''; redesenharTabela(); });
    document.getElementById('recusas-filtro-periodo-fim')?.addEventListener('change', e => { _filtroPeriodoFim=e.target.value || ''; redesenharTabela(); });
    document.getElementById('recusas-filtro-tratamento')?.addEventListener('change', e => { _filtroTratamento=e.target.value || ''; redesenharTabela(); });
    document.getElementById('recusas-filtro-conferencia')?.addEventListener('change', e => { _filtroConferencia=e.target.value || ''; redesenharTabela(); });
  }

  function ligarEventosCadastros() {
    document.querySelector('[data-recusa-cad-atualizar]')?.addEventListener('click', async()=>{ await carregarDados(true); desenharCadastros(); });
    document.querySelector('[data-recusa-ler-import-cadastros]')?.addEventListener('click', lerImportacaoCadastros);
    document.querySelector('[data-recusa-salvar-import-cadastros]')?.addEventListener('click', salvarImportacaoCadastros);
    document.querySelectorAll('[data-recusa-add]').forEach(b => b.addEventListener('click', () => adicionarCadastro(b.dataset.recusaAdd)));
    document.querySelectorAll('[data-recusa-editar-email]').forEach(b => b.addEventListener('click', () => editarEmailConferente(b.dataset.recusaEditarEmail)));
    document.querySelectorAll('[data-recusa-toggle]').forEach(b => b.addEventListener('click', () => { const [t,id]=b.dataset.recusaToggle.split(':'); toggleCadastro(t,id); }));
    document.querySelectorAll('[data-recusa-del]').forEach(b => b.addEventListener('click', () => { const [t,id]=b.dataset.recusaDel.split(':'); deletarCadastro(t,id); }));
    document.querySelector('[data-vm-novo]')?.addEventListener('click', () => abrirModalVendedorMercado());
    document.querySelectorAll('[data-vm-editar]').forEach(b => b.addEventListener('click', () => abrirModalVendedorMercado(_vendedoresMercado.find(v => v._id === b.dataset.vmEditar))));
    document.querySelectorAll('[data-vm-excluir]').forEach(b => b.addEventListener('click', () => excluirVendedorMercado(b.dataset.vmExcluir)));
  }

  async function renderRecebimentoRecusas() {
    const pagina = document.getElementById('page-recebimento-recusas');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-title">Carregando Notas Retornadas...</div></div>';
    try { await carregarDados(); desenhar(); } catch(e) { pagina.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar Notas Retornadas</div><div class="empty-sub">${esc(e.message || e)}</div></div>`; }
  }
  async function renderRecebimentoRecusasCadastros() {
    const pagina = document.getElementById('page-recebimento-recusas-cadastros');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-title">Carregando Cadastros...</div></div>';
    try { await carregarDados(); desenharCadastros(); } catch(e) { pagina.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar Cadastros</div><div class="empty-sub">${esc(e.message || e)}</div></div>`; }
  }

  global.renderRecebimentoRecusas = renderRecebimentoRecusas;
  global.renderRecebimentoRecusasCadastros = renderRecebimentoRecusasCadastros;
  global.DTRecusasParser = { parseDanfeText, extrairChave, chaveNfeValida, numeroNotaDaChave, dividirTextoPorDanfes, _agruparNotasBiPorChave, _importarNotasVendaBiRegistros, buscarBiAutomatico, _corrigirGtinNotasVenda, _corrigirVolumeEsperadoRecusas, reconstruirTodosOsChunks, diagnosticoChunks, _empacotarEmChunks, _notaResumida, _tamanhoBytesEstimado, _notasDoDocumentoChunk, TAMANHO_CHUNK, LIMITE_BYTES_CHUNK, ARQUIVO_BI_NOTAS };
  // Reaproveitado por 98-recebimento-retornos-indicadores.js pro gráfico
  // "Notas por Ação (Tratamento)" — mesmo rótulo em toda a tela, sem
  // duplicar o mapa em dois arquivos.
  global.TRATAMENTO_LABELS = TRATAMENTO_LABELS;
})(window);
