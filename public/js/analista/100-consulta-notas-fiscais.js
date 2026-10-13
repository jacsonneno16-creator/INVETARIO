// Recebimento > Devoluções (BI)
// PEDIDO AO VIVO (2026-08-27): reforma grande — esta tela (antes "Consulta
// de Notas Fiscais", pensada pra vendas) virou o destino das notas de
// DEVOLUÇÃO importadas do BI. "as notas de devolução é pra ficar aonde que
// ficou as notas de venda agora que você fez" — inverteu o que eu tinha
// montado: NOTAS RETORNADAS (97-recebimento-recusas.js) agora é o ledger de
// VENDA, e aqui é devolução com motivo. PEDIDO AO VIVO (2026-08-27): "por
// que notas de devolução é pra aguardar no Firebase? Só é pra aguardar se
// ela tiver com os motivos que eu falei" — devolução só toca no Firebase
// quando o motivo indica que NÃO tem mercadoria física chegando (ver
// classificarMotivoTexto): nesse caso grava um recebimento_recusas já
// concluído, sem precisar do Coletor. Sem motivo qualificado, a nota só
// aparece na tela (_ultimasDevolucoes, em memória) — nunca vira documento
// nenhum. ATUALIZAÇÃO (2026-08-31): o JSON do BI agora traz o texto de
// "Informações Complementares" da nota no campo `mensagem` (confirmado com
// dados reais) — a regra que ficou pronta e dormente desde 2026-08-27
// passa a disparar de verdade a partir de agora. Ver
// [[notas-retornadas-motivo-auto-recebimento]] e [[notas-retornadas-gtin-bi-pendente]].
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_RECUSAS = 'recebimento_recusas';
  const ARQUIVO_BI_NOTAS = 'notas_fiscais_jacson.json';
  const INTERVALO_AUTO_BUSCA_MS = 30 * 60 * 1000; // pedido ao vivo: a cada 30 minutos

  let _containerId = 'page-recebimento-consulta-notas';
  let _ultimasDevolucoes = []; // resultado da última busca — só visual, não é uma coleção própria
  let _ultimaBuscaBiTexto = '';
  let _autoRefreshIniciado = false;

  function fs() { return global.getDTFirestore(); }
  function raw() { return typeof global.getDTRawFirestore === 'function' ? global.getDTRawFirestore() : fs(); }
  function agoraIso() { return new Date().toISOString(); }
  function fmtHora(v) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function usuarioAtual() {
    const u = global.firebase?.auth?.().currentUser;
    return u ? { uid: u.uid || '', email: u.email || '' } : { uid: '', email: '' };
  }

  // Categorização do texto de "Informações Complementares" — MESMAS
  // categorias/regex já validadas com o usuário no Excel de devoluções por
  // motivo (scratchpad gerar_motivo_por_mes.js). Movida de
  // 97-recebimento-recusas.js pra cá junto com a devolução (2026-08-27).
  // PEDIDO AO VIVO (2026-09-17): "padronizar, para não ficar duas coisas do
  // mesmo jeito" — categorias em maiúsculo pra nascer no mesmo padrão do
  // cadastro manual de motivos (recebimento_recusas_motivos), já que o
  // gráfico "Motivos da Volta" (98) agrupa por string exata, sem normalizar
  // caixa. Mesma lista duplicada em functions/index.js
  // (CATEGORIAS_MOTIVO_DEVOLUCAO_BI) — atualizar junto.
  const CATEGORIAS_MOTIVO_DEVOLUCAO = [
    ['TROCA', /\bTROCA/],
    ['IMPRÓPRIO PARA CONSUMO/VENDA', /IMPROPRI/],
    ['AVARIA', /AVARI/],
    ['FALTA NA CARGA/ENTREGA', /FALTA|FALTOU/],
    ['PRODUTO ERRADO/DIVERGENTE', /ERRAD|DIVERGEN/],
    ['VENCIDO/VENCIMENTO', /VENCID|VENC:/],
    ['DESACORDO COM PEDIDO', /DESACORDO/],
  ];
  const SEM_MOTIVO_NO_TEXTO = '(SEM MOTIVO NO TEXTO)';
  // PEDIDO AO VIVO (2026-09-01): "impróprio pra consumo também não é pra
  // gravar. Essas notas de impróprio pra consumo pode descartar também" —
  // entra pro mesmo grupo de Troca/Avaria/Vencido/sem-motivo (descartado,
  // não grava recebimento_recusas, não aguarda Coletor).
  const CATEGORIAS_MOTIVO_PRECISAM_COLETOR = new Set(['TROCA', 'AVARIA', 'VENCIDO/VENCIMENTO', 'IMPRÓPRIO PARA CONSUMO/VENDA', SEM_MOTIVO_NO_TEXTO]);
  function classificarMotivoTexto(texto) {
    const t = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const [nome, regex] of CATEGORIAS_MOTIVO_DEVOLUCAO) if (regex.test(t)) return nome;
    return SEM_MOTIVO_NO_TEXTO;
  }
  function _motivoDispensaColetor(informacoesComplementares) {
    if (!informacoesComplementares) return false;
    return !CATEGORIAS_MOTIVO_PRECISAM_COLETOR.has(classificarMotivoTexto(informacoesComplementares));
  }
  // Payload do recebimento_recusas AUTOMÁTICO — mesmo formato que o
  // Coletor grava em finalizar() (24-recebimento-recusas.js), só sem
  // motorista/box/conferente e já CONFERIDA. Pedido ao vivo: "todo motivo
  // que não for vencido troca avaria e sem motivo pode gravar
  // automaticamente" — regra vale pra qualquer origem com motivo
  // preenchido, não só PDF (hoje só o PDF trazia esse texto, mas o BI pode
  // vir a trazer também).
  // PEDIDO AO VIVO (2026-08-31): "puxar a data por lá também pra saber o
  // dia certo que foi emitida" — o registro só tinha `criadoEm` (quando
  // ESTE app importou), não a data real da nota fiscal. `dataEmissao` e
  // `rede` (rede/bandeira extraída de "REDE - loja", mesmo padrão visto
  // nos dados reais do BI, ex.: "ASSAI - 278") alimentam o indicador
  // separado de devoluções (102-devolucoes-bi-indicadores.js).
  function _extrairRede(destinatario) {
    const s = String(destinatario || '').trim();
    const idx = s.indexOf(' - ');
    return (idx > -1 ? s.slice(0, idx) : s).trim();
  }
  function _construirRecebimentoAutomatico(nota, usuario) {
    if (!_motivoDispensaColetor(nota.informacoesComplementares)) return null;
    const categoria = classificarMotivoTexto(nota.informacoesComplementares);
    return {
      chaves: [nota.chave],
      notas: [{ chave: nota.chave, numeroNota: nota.numeroNota, dataEmissao: nota.dataEmissao || '', volumeEsperado: 0, destinatario: nota.destinatario || '', valorTotal: Number(nota.valorTotal) || 0, itens: nota.itens || [] }],
      motoristaId: '', motoristaNome: '', motivoId: '', motivoNome: categoria,
      conferenteId: '', conferenteNome: '',
      volumeEsperado: 0, volumeInformado: 0, diferencaVolumes: 0, conferenciaStatus: 'CONFERIDO',
      box: '', pallets: null, statusConferenciaOperacional: 'CONFERIDA', itensConferidos: [],
      criadoEm: agoraIso(), criadoPorUid: usuario.uid || '', criadoPorEmail: usuario.email || usuario.uid || '',
      origem: 'AUTOMATICO', motivoAutomaticoTexto: nota.informacoesComplementares || '',
      dataEmissao: nota.dataEmissao || '', destinatario: nota.destinatario || '', rede: _extrairRede(nota.destinatario), valorTotal: Number(nota.valorTotal) || 0,
    };
  }

  // Uma linha do JSON é um ITEM da nota — junta por chave. Não filtra
  // vendedor/supervisor (devolução nunca traz isso preenchido no BI).
  function _agruparDevolucoesBiPorChave(itens) {
    const porChave = new Map();
    itens.forEach(it => {
      const chave = String(it.chave || '').trim();
      if (!chave) return;
      if (!porChave.has(chave)) {
        porChave.set(chave, {
          chave, numeroNota: it.nf_numero != null ? String(it.nf_numero) : '', serie: it.nf_serie != null ? String(it.nf_serie) : '',
          destinatario: it.cliente || '', dataEmissao: String(it.data_emissao || '').slice(0, 10), cfop: it.cfop || '',
          valorTotal: 0, informacoesComplementares: '', itens: [],
        });
      }
      const nota = porChave.get(chave);
      // PEDIDO AO VIVO (2026-09-01): "algumas vêm com data... não vem
      // mostrando outras informações" / "a outra que não traz a data, traz
      // as outras" — o primeiro item de uma chave às vezes vem com
      // cliente/data_emissao em branco mesmo quando outro item DA MESMA
      // nota traz o campo preenchido; antes só o primeiro item alimentava
      // esses campos e ficavam vazios pra sempre. Agora qualquer item da
      // mesma chave pode preencher o que ainda estiver vazio.
      if (!nota.numeroNota && it.nf_numero != null) nota.numeroNota = String(it.nf_numero);
      if (!nota.serie && it.nf_serie != null) nota.serie = String(it.nf_serie);
      if (!nota.destinatario && it.cliente) nota.destinatario = it.cliente;
      if (!nota.dataEmissao && it.data_emissao) nota.dataEmissao = String(it.data_emissao).slice(0, 10);
      if (!nota.cfop && it.cfop) nota.cfop = it.cfop;
      nota.valorTotal += Number(it.valor_nota) || 0;
      // PEDIDO AO VIVO (2026-08-31): o BI passou a trazer `dum`/`ean` por
      // item (DUN-14 da caixa / EAN-13 da unidade) e `mensagem` (texto
      // livre da nota, com o motivo da devolução embutido junto de outras
      // informações fiscais) — confirmado com dados reais do próprio
      // usuário, não mais vazio como antes (ver
      // [[notas-retornadas-gtin-bi-pendente]]). DUN preferido sobre EAN
      // pra bipagem (Coletor bipa a CAIXA que volta, não a unidade).
      // `informacoesComplementares` (motivo) é o mesmo texto pra todo item
      // da mesma nota — grava uma vez só, no primeiro item que trouxer.
      // PEDIDO AO VIVO (2026-09-02, 2ª rodada): "o gtin ficou com o dun
      // também, cada um no lugar certo" — cada campo agora é só a SUA
      // fonte: `gtin` = EAN-13 (unidade), `dun` = DUN-14 (caixa), sem
      // fallback cruzado (antes gtin virava o dun quando ele existia,
      // duplicando o mesmo valor nos dois campos). 24-recebimento-
      // recusas.js (bipagem no Coletor) compara o código escaneado com
      // `it.dun` também agora, então bipar a caixa continua funcionando.
      const gtinItem = it.ean != null ? String(it.ean) : '';
      const dunItem = it.dum != null ? String(it.dum) : '';
      nota.itens.push({ produtoKey: it.produto_key ?? null, descricao: it.produto || '', quantidade: Number(it.quantidade_faturada) || 0, gtin: gtinItem, dun: dunItem, ncm: '' });
      if (!nota.informacoesComplementares && it.mensagem) nota.informacoesComplementares = String(it.mensagem);
    });
    return [...porChave.values()];
  }

  // PEDIDO AO VIVO (2026-09-01): "a porra da data não vem pra essa tela,
  // motivo por mês não está gerando nada" — 301 dos 305 recebimento_recusas
  // AUTOMATICO já gravados (antes do fix de hoje em
  // _agruparDevolucoesBiPorChave) ficaram com dataEmissao OU destinatario
  // em branco pra sempre, porque só o primeiro item da chave alimentava
  // esses campos no momento da gravação. Documentos JÁ GRAVADOS não se
  // corrigem sozinhos — mapa agora traz docId+dataEmissao+destinatario de
  // cada chave já recebida, pra `_importarDevolucoesBiRegistros` conseguir
  // completar o que falta usando os dados frescos do próximo "Buscar".
  async function _chavesJaComRecebimento() {
    const snap = await fs().collection(COL_RECUSAS).get();
    const chaves = new Map();
    snap.docs.forEach(d => {
      const data = d.data() || {};
      (data.chaves || []).forEach(c => chaves.set(c, { docId: d.id, dataEmissao: data.dataEmissao || '', destinatario: data.destinatario || '' }));
    });
    return chaves;
  }

  // PEDIDO AO VIVO (2026-08-27): "por que notas de devolução é pra aguardar
  // no Firebase? Só é pra aguardar se ela tiver com os motivos que eu
  // falei" — devolução SÓ toca no Firebase quando o motivo dispensa o
  // Coletor (grava o recebimento_recusas já concluído). Isso também
  // corrige o contador de Notas Retornadas somando devolução junto com
  // venda (as duas liam a mesma coleção recebimento_recusas_notas).
  // PEDIDO AO VIVO (2026-08-31): "Troca/Avaria/Vencido esse descarta nem
  // grava e nem aguarda coletor" — essas 3 + "sem motivo no texto" (as
  // mesmas 4 categorias de CATEGORIAS_MOTIVO_PRECISAM_COLETOR) deixaram de
  // "aguardar o Coletor" — agora são DESCARTADAS: não geram
  // recebimento_recusas, não entram em nenhuma fila do Coletor, só ficam
  // marcadas como "descartado" na listagem (rastro/auditoria).
  async function _importarDevolucoesBiRegistros(registros) {
    if (!Array.isArray(registros)) throw new Error('Formato inesperado — esperava uma lista de registros.');
    const devolucoes = registros.filter(r => String(r.tipo_movimento || '').toUpperCase() === 'DEVOLUCAO');
    const notas = _agruparDevolucoesBiPorChave(devolucoes);
    const u = usuarioAtual();
    const chavesJaComRecebimento = await _chavesJaComRecebimento();
    let autoSalvas = 0;
    let descartadas = 0;
    let corrigidas = 0;
    const resultado = [];
    const patches = [];
    for (const nota of notas) {
      const motivoNome = classificarMotivoTexto(nota.informacoesComplementares);
      let status;
      if (chavesJaComRecebimento.has(nota.chave)) {
        status = 'ja-recebida';
        // PEDIDO AO VIVO (2026-09-01): documento já existe, mas pode ter
        // ficado com dataEmissao/destinatario em branco (bug antigo de
        // _agruparDevolucoesBiPorChave, corrigido hoje só pra importações
        // NOVAS) — completa o que faltar usando os dados frescos deste
        // "Buscar", sem tocar no que já está preenchido.
        const existente = chavesJaComRecebimento.get(nota.chave);
        const patch = {};
        if (!existente.dataEmissao && nota.dataEmissao) patch.dataEmissao = nota.dataEmissao;
        if (!existente.destinatario && nota.destinatario) { patch.destinatario = nota.destinatario; patch.rede = _extrairRede(nota.destinatario); }
        if (Object.keys(patch).length) { patches.push({ docId: existente.docId, patch }); corrigidas++; }
      } else {
        const payloadAuto = _construirRecebimentoAutomatico(nota, u);
        if (payloadAuto) {
          await fs().collection(COL_RECUSAS).add(payloadAuto);
          chavesJaComRecebimento.set(nota.chave, { docId: '', dataEmissao: nota.dataEmissao, destinatario: nota.destinatario });
          status = 'salvo-automatico';
          autoSalvas++;
        } else {
          // PEDIDO AO VIVO (2026-08-31): "Troca/Avaria/Vencido esse
          // descarta nem grava e nem aguarda coletor" — essas 3 categorias
          // + "sem motivo no texto" (as mesmas 4 que antes ficavam
          // "aguardando Coletor") não geram mais nenhuma pendência: não
          // grava recebimento_recusas, não aparece pro Coletor, só fica
          // marcada como descartada aqui na listagem pra rastro/auditoria.
          status = 'descartado';
          descartadas++;
        }
      }
      resultado.push({ chave: nota.chave, numeroNota: nota.numeroNota, dataEmissao: nota.dataEmissao, destinatario: nota.destinatario, cfop: nota.cfop, valorTotal: nota.valorTotal, motivoNome, status });
    }
    if (patches.length) {
      const rawFs = raw();
      for (let i = 0; i < patches.length; i += 300) {
        const lote = patches.slice(i, i + 300);
        const batch = rawFs.batch();
        lote.forEach(p => batch.set(fs().collection(COL_RECUSAS).doc(p.docId), p.patch, { merge: true }));
        await batch.commit();
      }
    }
    _ultimasDevolucoes = resultado;
    return { totalNotas: notas.length, totalLinhas: devolucoes.length, autoSalvas, descartadas, corrigidas };
  }

  async function buscarVendasBiAutomatico() {
    if (!global.DTBiPastaLocal?.suportado?.()) return;
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') {
      const resultado = await global.DTBiPastaLocal.conectar();
      if (!resultado.ok) { global.showToast?.(resultado.erro, 'error'); return; }
    }
    try {
      const registros = await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_NOTAS);
      const { totalNotas, totalLinhas, autoSalvas, descartadas, corrigidas } = await _importarDevolucoesBiRegistros(registros);
      _ultimaBuscaBiTexto = `Última atualização: ${fmtHora(agoraIso())} — ${totalNotas} devolução(ões) (de ${totalLinhas} linha(s) de item), ${autoSalvas} gravada(s) automaticamente, ${descartadas} descartada(s) (Troca/Avaria/Vencido/Impróprio para consumo/sem motivo), ${totalNotas - autoSalvas - descartadas} já recebida(s) antes${corrigidas ? ` (${corrigidas} com data/loja completada agora)` : ''}.`;
      _desenharConsultaNotas();
    } catch (e) {
      _ultimaBuscaBiTexto = `Falha na última busca (${fmtHora(agoraIso())}): ${e.message || e}`;
      global.showToast?.('Erro ao buscar no BI: ' + (e.message || e), 'error');
      _desenharConsultaNotas();
    }
  }
  function _iniciarAutoRefreshBi() {
    _autoRefreshIniciado = true; // sincronização já ocorre no servidor a cada 4h
  }

  const STATUS_INFO = {
    'salvo-automatico': { label: '⚡ Gravado automático (sem coletor)', cor: '#4a3114;color:#ffd18a' },
    'descartado': { label: '🗑 Descartado', cor: '#3a3a3a;color:#c9c9c9' },
    'ja-recebida': { label: '✓ Já recebida', cor: '#123a24;color:#8fdcb0' },
  };
  function _linhaDevolucao(n) {
    const st = STATUS_INFO[n.status] || STATUS_INFO['descartado'];
    return `<tr>
      <td class="mono" style="font-size:.68rem;max-width:200px;word-break:break-all">${esc(n.chave)}</td>
      <td>${esc(n.numeroNota || '—')}</td>
      <td>${esc(n.dataEmissao || '—')}</td>
      <td>${esc(n.destinatario || '—')}</td>
      <td style="font-size:.74rem">${esc(n.cfop || '—')}</td>
      <td>${Number(n.valorTotal || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
      <td style="font-size:.72rem">${esc(n.motivoNome || '—')}</td>
      <td><span class="badge" style="background:${st.cor};font-size:.65rem">${st.label}</span></td>
    </tr>`;
  }

  function _desenharConsultaNotas() {
    const pagina = document.getElementById(_containerId);
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div><h2 style="margin:0">📥 Devoluções (BI)</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Notas de devolução importadas do BI. Motivo Troca/Avaria/Vencido/Impróprio para consumo ou sem motivo no texto é descartado (não grava, não aguarda o Coletor); qualquer outro motivo (ex.: falta na entrega, produto errado) grava o recebimento automaticamente, sem precisar do Coletor.</div></div>
      </div>
      <div class="tc" style="padding:16px;margin:14px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px"><div><b>📊 Buscar devoluções (BI)</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">${global.DTBiPastaLocal?.suportado?.() ? 'Busca direto do SharePoint (API) — clique em Buscar, ou espere, atualiza sozinho a cada 30 min enquanto a tela estiver aberta.' : 'Serviço de busca do BI indisponível no momento (recarregue a página).'}</div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${global.DTBiPastaLocal?.suportado?.() ? '<button class="btn btn-primary" data-cnf-buscar-bi="1">📊 Buscar</button>' : ''}</div></div>
        ${_ultimaBuscaBiTexto ? `<div style="font-size:.72rem;color:var(--muted);margin:-4px 0 0;padding:8px 10px;border-radius:8px;background:#f3f4f6">${_ultimaBuscaBiTexto}</div>` : ''}
      </div>
      <div class="tc" style="padding:14px"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Chave</th><th>NF</th><th>Emissão</th><th>Destinatário</th><th>CFOP</th><th>Valor</th><th>Motivo</th><th>Status</th></tr></thead>
        <tbody>${_ultimasDevolucoes.length ? _ultimasDevolucoes.map(_linhaDevolucao).join('') : '<tr><td colspan="8"><div class="empty"><div class="empty-icon">📥</div><div class="empty-title">Nenhuma devolução buscada ainda</div></div></td></tr>'}</tbody>
      </table></div></div>`;
    global.aplicarPermissoesAnalista?.();
    _iniciarAutoRefreshBi();
  }

  async function renderConsultaNotasFiscais(containerId) {
    _containerId = containerId || 'page-recebimento-consulta-notas';
    _desenharConsultaNotas();
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-cnf-buscar-bi]')) { buscarVendasBiAutomatico(); return; }
  });

  global.renderConsultaNotasFiscais = renderConsultaNotasFiscais;
  global._DTConsultaNotasFiscaisInternals = { _agruparDevolucoesBiPorChave, _importarDevolucoesBiRegistros, classificarMotivoTexto, _motivoDispensaColetor, _construirRecebimentoAutomatico, buscarVendasBiAutomatico, ARQUIVO_BI_NOTAS };
})(window);
