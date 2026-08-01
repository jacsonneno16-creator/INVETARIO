/* ============================================================================
 * ANALISTA — MODULO CANONICO DE DIVERGENCIAS E RECONTAGENS
 * ----------------------------------------------------------------------------
 * Substitui as antigas secoes de renderizacao, selecao, atribuicao,
 * desvinculacao, resolucao, indicadores e exportacao.
 *
 * Premissas mantidas:
 * - window.AnalistaStore.getState()
 * - window.InventoryFlowKey
 * - window.AnalistaDivergenciasRuntime (opcional)
 * - window.Store / window.Actions (opcionais)
 * - fsSalvarDivergencia / fsSalvarRecontagem (fallback)
 * - FS_AN ou firebase.firestore() para transacoes
 * - helpers existentes: escHTML, fmtTs, showToast, openModal, closeModal,
 *   showConfirm, getEnderecoInfo, logSistema
 *
 * IMPORTANTE:
 * - Renderizacao nao grava e nao processa divergencias.
 * - A unidade operacional e inventario canonico + endereco canonico.
 * - Produto nao compoe a chave do fluxo consolidado.
 * - Tela, KPIs e exportacoes usam a mesma ViewModel.
 * ========================================================================== */

(() => {
  'use strict';

  const G = window;
  const FK = G.InventoryFlowKey;

  if (!G.AnalistaStore?.getState) {
    console.error('[DivergenciasModule] AnalistaStore nao encontrado.');
    return;
  }
  if (!FK) {
    console.error('[DivergenciasModule] InventoryFlowKey nao encontrado.');
    return;
  }

  const state = () => G.AnalistaStore.getState();

  const STATUS = Object.freeze({
    ABERTA: 'ABERTA',
    EM_RECONTAGEM: 'EM_RECONTAGEM',
    AGUARDANDO_ANALISTA: 'AGUARDANDO_ANALISTA',
    RESOLVIDA: 'RESOLVIDA',
    PERSISTENTE: 'PERSISTENTE',
    CANCELADA: 'CANCELADA',
    EXCLUIDA: 'EXCLUIDA'
  });

  const STATUS_REC = Object.freeze({
    PENDENTE: 'pendente',
    EM_ANDAMENTO: 'em_andamento',
    AGUARDANDO_ANALISTA: 'aguardando_analista',
    CONCLUIDA: 'concluida',
    SEM_DIVERGENCIA: 'sem_divergencia',
    RESOLVIDA: 'resolvida',
    PERSISTENTE: 'persistente',
    CANCELADA: 'cancelada',
    EXCLUIDA: 'excluida'
  });

  const ENCERRADOS = new Set([
    STATUS.RESOLVIDA,
    STATUS.PERSISTENTE,
    STATUS.CANCELADA,
    STATUS.EXCLUIDA
  ]);

  const REC_ENCERRADOS = new Set([
    STATUS_REC.SEM_DIVERGENCIA,
    STATUS_REC.RESOLVIDA,
    STATUS_REC.PERSISTENTE,
    STATUS_REC.CANCELADA,
    STATUS_REC.EXCLUIDA
  ]);

  const operacoesEmAndamento = new Set();
  const selecao = new Set();

  let visaoDivergencias = [];
  let visaoRecontagens = [];
  let mapaFluxosVisiveis = new Map();
  let filtroRapidoAtivo = '';
  let recAtribuirDireto = null;

  /* ------------------------------------------------------------------------
   * UTILITARIOS
   * --------------------------------------------------------------------- */

  const texto = value => String(value ?? '').trim();
  const upper = value => texto(value).toUpperCase();
  const lower = value => texto(value).toLowerCase();

  function escapeHtml(value) {
    if (typeof G.escHTML === 'function') return G.escHTML(value);
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatarData(value) {
    if (!value) return '—';
    if (typeof G.fmtTs === 'function') return G.fmtTs(value);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
  }

  function toast(message, type = 'w') {
    if (typeof G.showToast === 'function') G.showToast(message, type);
    else console[type === 'e' ? 'error' : 'log'](message);
  }

  function normalizarNumero(value) {
    if (value === null || value === undefined || texto(value) === '') return null;
    const normalized = typeof value === 'string'
      ? value.replace(/\s/g, '').replace(',', '.')
      : value;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  function quantidadesIguais(a, b, tolerancia = 1e-9) {
    const x = normalizarNumero(a);
    const y = normalizarNumero(b);
    if (x === null || y === null) return false;
    return Math.abs(x - y) <= tolerancia;
  }

  function timestampValue(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function compararMaisRecente(a, b) {
    const ta = timestampValue(
      a?.updated_at || a?.atualizado_em || a?.recontagem_concluida_em ||
      a?.concluida_em || a?.criada_em || a?.created_at
    );
    const tb = timestampValue(
      b?.updated_at || b?.atualizado_em || b?.recontagem_concluida_em ||
      b?.concluida_em || b?.criada_em || b?.created_at
    );
    return tb - ta;
  }

  function obterUsuarioAtual() {
    const u = G._currentAnalistaUser || {};
    return {
      uid: texto(u.uid),
      email: texto(u.email),
      nome: texto(u.displayName || u.nome || u.email || 'Analista')
    };
  }

  function inventarioCanonico(obj) {
    return texto(FK.inventario(obj || {}, state().inventarios || []));
  }

  function enderecoCanonico(value) {
    return texto(FK.endereco(value));
  }

  function produtoCanonico(obj) {
    return texto(FK.produto(obj || {}));
  }

  function lojaCanonica(obj) {
    return texto(
      obj?.loja_id ??
      obj?.lojaId ??
      state().lojaAtual?.id ??
      state().loja_id ??
      state().lojaId ??
      ''
    );
  }

  function chaveFluxo(obj) {
    const loja = lojaCanonica(obj);
    const inventario = inventarioCanonico(obj);
    const endereco = enderecoCanonico(obj?.endereco);

    if (!inventario || !endereco) return null;
    return [loja, inventario, endereco].join('|');
  }

  function chaveDomId(prefix, key) {
    let hash = 2166136261;
    const input = `${prefix}|${key}`;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${prefix}-${(hash >>> 0).toString(36)}`;
  }

  function getInventarioByCanonical(canonicalId) {
    return (state().inventarios || []).find(i => inventarioCanonico(i) === canonicalId) || null;
  }

  function obterNomeProduto(value) {
    const codigo = texto(value);
    if (!codigo) return 'Produto nao informado';

    try {
      const found = G.DTProdutos?.buscarSync?.(codigo);
      if (found?.encontrado) {
        return texto(
          found.nomeProduto ||
          found.descricao ||
          found.descricaoProduto ||
          found.produto_nome ||
          codigo
        );
      }
    } catch (error) {
      console.warn('[DivergenciasModule] DTProdutos.buscarSync:', error);
    }

    const p = (state().produtos || []).find(item =>
      [
        item.codigo,
        item.codigo_produto,
        item.codigoInterno,
        item.codigo_interno,
        item.gtin,
        item.ean,
        item.dun
      ].filter(Boolean).map(String).includes(codigo)
    );

    return texto(p?.descricao || p?.nome || p?.descricao_produto || codigo);
  }

  function obterQuantidadeEsperadaItem(item) {
    const raw =
      item?.quantidade_esperada ??
      item?.quantidadeEsperada ??
      item?.qtd_esperada ??
      item?.qtdEsperada ??
      item?.quantidade_enderecada ??
      item?.qtd_enderecada ??
      item?.saldo_estoque ??
      item?.saldo ??
      item?.saldo_erp ??
      item?.qtd_sistema ??
      item?.qtd_estoque ??
      item?.estoque_total ??
      item?.estoque ??
      item?.quantidade ??
      item?.qtd ??
      item?.qtde;

    return normalizarNumero(raw) ?? 0;
  }

  function obterItensEsperadosFluxo(obj) {
    const inv = getInventarioByCanonical(inventarioCanonico(obj));
    const endereco = enderecoCanonico(obj?.endereco);

    const base = (inv?.base || []).filter(item =>
      enderecoCanonico(item?.endereco) === endereco
    );

    if (base.length) return base;

    if (Array.isArray(obj?.itens_esperados) && obj.itens_esperados.length) {
      return obj.itens_esperados;
    }

    return [];
  }

  function obterTotalEsperadoFluxo(obj) {
    const itens = obterItensEsperadosFluxo(obj);
    if (itens.length) {
      return itens.reduce((sum, item) => sum + obterQuantidadeEsperadaItem(item), 0);
    }

    return normalizarNumero(
      obj?.qtd_esperada ??
      obj?.quantidade_esperada ??
      obj?.qtd_sistema
    );
  }

  function obterStatusCanonico(obj) {
    const status = upper(obj?.status);
    const statusRec = lower(obj?.status_recontagem);

    if (status === STATUS.PERSISTENTE || statusRec === STATUS_REC.PERSISTENTE) {
      return STATUS.PERSISTENTE;
    }
    if (
      status === STATUS.RESOLVIDA ||
      statusRec === STATUS_REC.RESOLVIDA ||
      statusRec === STATUS_REC.SEM_DIVERGENCIA
    ) {
      return STATUS.RESOLVIDA;
    }
    if (status === STATUS.CANCELADA || statusRec === STATUS_REC.CANCELADA) {
      return STATUS.CANCELADA;
    }
    if (status === STATUS.EXCLUIDA || statusRec === STATUS_REC.EXCLUIDA) {
      return STATUS.EXCLUIDA;
    }
    if (statusRec === STATUS_REC.AGUARDANDO_ANALISTA) {
      return STATUS.AGUARDANDO_ANALISTA;
    }
    if (
      status === STATUS.EM_RECONTAGEM ||
      statusRec === STATUS_REC.PENDENTE ||
      statusRec === STATUS_REC.EM_ANDAMENTO
    ) {
      return STATUS.EM_RECONTAGEM;
    }
    return STATUS.ABERTA;
  }

  function statusPersistencia(statusFluxo) {
    switch (statusFluxo) {
      case STATUS.ABERTA:
        return { status: STATUS.ABERTA, status_recontagem: null };
      case STATUS.EM_RECONTAGEM:
        return { status: STATUS.EM_RECONTAGEM, status_recontagem: STATUS_REC.PENDENTE };
      case STATUS.AGUARDANDO_ANALISTA:
        return { status: STATUS.ABERTA, status_recontagem: STATUS_REC.AGUARDANDO_ANALISTA };
      case STATUS.RESOLVIDA:
        return { status: STATUS.RESOLVIDA, status_recontagem: STATUS_REC.SEM_DIVERGENCIA };
      case STATUS.PERSISTENTE:
        return { status: STATUS.PERSISTENTE, status_recontagem: STATUS_REC.PERSISTENTE };
      case STATUS.CANCELADA:
        return { status: STATUS.CANCELADA, status_recontagem: STATUS_REC.CANCELADA };
      case STATUS.EXCLUIDA:
        return { status: STATUS.EXCLUIDA, status_recontagem: STATUS_REC.EXCLUIDA };
      default:
        throw new Error(`Status de fluxo desconhecido: ${statusFluxo}`);
    }
  }

  function isRecontagemConcluida(rec) {
    return (
      upper(rec?.status) === 'CONCLUIDA' ||
      lower(rec?.status_recontagem) === STATUS_REC.CONCLUIDA ||
      Boolean(rec?.recontagem_concluida_em || rec?.concluida_em || rec?.finalizada_em)
    );
  }

  function isRecontagemIniciada(rec) {
    if (G.RecontagemAssignmentPolicy?.foiIniciada) {
      return Boolean(G.RecontagemAssignmentPolicy.foiIniciada(rec));
    }
    return (
      upper(rec?.status) === 'EM_ANDAMENTO' ||
      lower(rec?.status_recontagem) === STATUS_REC.EM_ANDAMENTO ||
      Boolean(rec?.iniciada_em || rec?.recontagem_iniciada_em)
    );
  }

  function numeroRodada(rec, fallbackIndex = null) {
    const explicit = normalizarNumero(
      rec?.numero_recontagem ??
      rec?.rodada ??
      rec?.numero_rodada
    );

    if (explicit === 1 || explicit === 2) return explicit;

    if (
      rec?.qtd_terceira != null ||
      rec?.produto_terceira ||
      rec?.operador_terceira
    ) return 2;

    if (
      rec?.qtd_segunda != null ||
      rec?.produto_segunda ||
      rec?.operador_segunda
    ) return 1;

    return fallbackIndex;
  }

  function consolidarRodadas(recontagens) {
    const validas = (recontagens || [])
      .filter(rec => {
        const st = upper(rec?.status);
        const sr = lower(rec?.status_recontagem);
        return !['CANCELADA', 'EXCLUIDA'].includes(st) &&
          ![STATUS_REC.CANCELADA, STATUS_REC.EXCLUIDA].includes(sr);
      })
      .sort((a, b) => {
        const na = numeroRodada(a, 999);
        const nb = numeroRodada(b, 999);
        return na - nb || -compararMaisRecente(a, b);
      });

    const porRodada = new Map();

    validas.forEach((rec, index) => {
      let rodada = numeroRodada(rec, null);

      if (rodada !== 1 && rodada !== 2) {
        if (!isRecontagemConcluida(rec)) return;
        rodada = porRodada.has(1) ? 2 : 1;
      }

      const atual = porRodada.get(rodada);
      if (!atual || compararMaisRecente(rec, atual) < 0) {
        porRodada.set(rodada, rec);
      }
    });

    return {
      segunda: porRodada.get(1) || null,
      terceira: porRodada.get(2) || null,
      todas: validas
    };
  }

  function extrairPrimeiraContagem(fluxoKey, divergencias) {
    const contagens = (state().contagens || [])
      .filter(c =>
        chaveFluxo(c) === fluxoKey &&
        upper(c.tipo_contagem) !== 'RECONTAGEM' &&
        !c._excluida &&
        !['ESTORNADA', 'EXCLUIDA'].includes(upper(c.status))
      )
      .sort((a, b) => timestampValue(a.criado_em || a.dataHora || a.timestamp) -
        timestampValue(b.criado_em || b.dataHora || b.timestamp));

    const primeiraContagem = contagens[0] || null;

    const divComPrimeira = (divergencias || []).find(d =>
      d.qtd_primeira != null || d.qtd_contada != null || d.quantidade_contada != null
    ) || divergencias?.[0] || null;

    const origem = divComPrimeira || primeiraContagem || {};

    return {
      documento: origem,
      quantidade:
        origem.qtd_primeira ??
        origem.qtd_contada ??
        origem.quantidade_contada ??
        origem.quantidade ??
        origem.qtd_caixas ??
        null,
      produto:
        origem.produto_primeira ||
        origem.produto_contado ||
        origem.gtin_bipado ||
        origem.gtin ||
        origem.codigo_produto ||
        origem.codigoLido ||
        origem.produto ||
        '',
      operador:
        origem.operador_primeira ||
        origem.operador ||
        origem.operador_nome ||
        '',
      data:
        origem.data_primeira ||
        origem.criada_em ||
        origem.criado_em ||
        origem.dataHora ||
        origem.timestamp ||
        ''
    };
  }

  function extrairRodada(rec, numero) {
    if (!rec) {
      return { documento: null, quantidade: null, produto: '', operador: '', data: '' };
    }

    const segunda = numero === 2;

    return {
      documento: rec,
      quantidade: segunda
        ? (rec.qtd_segunda ?? rec.qtd_recontagem ?? rec.quantidade_recontagem ?? rec.quantidade)
        : (rec.qtd_terceira ?? rec.qtd_recontagem ?? rec.quantidade_recontagem ?? rec.quantidade),
      produto: segunda
        ? (rec.produto_segunda || rec.produto_recontagem || rec.produto || rec.gtin || '')
        : (rec.produto_terceira || rec.produto_recontagem || rec.produto || rec.gtin || ''),
      operador: segunda
        ? (rec.operador_segunda || rec.operador_recontagem || rec.operador || '')
        : (rec.operador_terceira || rec.operador_recontagem || rec.operador || ''),
      data: segunda
        ? (rec.data_segunda || rec.recontagem_concluida_em || rec.concluida_em || '')
        : (rec.data_terceira || rec.recontagem_concluida_em || rec.concluida_em || '')
    };
  }

  function avaliarFluxo(fluxo, totalEsperado) {
    const payload = {
      ...fluxo.principal,
      qtd_primeira: fluxo.primeira.quantidade,
      produto_primeira: fluxo.primeira.produto,
      qtd_segunda: fluxo.segunda.quantidade,
      produto_segunda: fluxo.segunda.produto,
      qtd_terceira: fluxo.terceira.quantidade,
      produto_terceira: fluxo.terceira.produto,
      qtd_esperada: totalEsperado,
      comparacao_somente_quantidade: true,
      fluxo_consolidado_endereco: true
    };

    const runtime = G.AnalistaDivergenciasRuntime;
    const result =
      runtime?.avaliarResumo?.(payload, totalEsperado) ||
      runtime?.avaliarHistorico?.(payload);

    if (result) return result;

    const primeira = normalizarNumero(fluxo.primeira.quantidade);
    const segunda = normalizarNumero(fluxo.segunda.quantidade);
    const terceira = normalizarNumero(fluxo.terceira.quantidade);
    const esperado = normalizarNumero(totalEsperado);

    const resposta = (estado, referencia, rodada, qtd) => ({
      estado,
      referencia,
      rodada,
      resultado: qtd == null ? null : { qtd, produto: 'TOTAL_ENDERECO' },
      esperado,
      fluxoConsolidado: true
    });

    if (primeira != null && esperado != null && quantidadesIguais(primeira, esperado)) {
      return resposta(STATUS.RESOLVIDA, 'OK_PRIMEIRA_TOTAL_ENDERECO', 1, primeira);
    }

    if (segunda != null) {
      if (esperado != null && quantidadesIguais(segunda, esperado)) {
        return resposta(STATUS.RESOLVIDA, 'OK_SEGUNDA_TOTAL_ENDERECO', 2, segunda);
      }
      if (primeira != null && quantidadesIguais(segunda, primeira)) {
        return resposta(STATUS.RESOLVIDA, 'OK_SEGUNDA_PRIMEIRA_TOTAL_ENDERECO', 2, segunda);
      }
    }

    if (terceira != null) {
      if (esperado != null && quantidadesIguais(terceira, esperado)) {
        return resposta(STATUS.RESOLVIDA, 'OK_TERCEIRA_TOTAL_ENDERECO', 3, terceira);
      }
      if (primeira != null && quantidadesIguais(terceira, primeira)) {
        return resposta(STATUS.RESOLVIDA, 'OK_TERCEIRA_PRIMEIRA_TOTAL_ENDERECO', 3, terceira);
      }
      if (segunda != null && quantidadesIguais(terceira, segunda)) {
        return resposta(STATUS.RESOLVIDA, 'OK_TERCEIRA_SEGUNDA_TOTAL_ENDERECO', 3, terceira);
      }
      return resposta(STATUS.PERSISTENTE, 'TERCEIRA_SEM_CONSENSO_TOTAL_ENDERECO', 3, terceira);
    }

    return resposta(
      STATUS.AGUARDANDO_ANALISTA,
      null,
      segunda != null ? 2 : 1,
      segunda ?? primeira
    );
  }

  function escolherDocumentoPrincipal(divergencias, recontagens) {
    const candidatos = [...(divergencias || [])].sort((a, b) => {
      const sa = obterStatusCanonico(a);
      const sb = obterStatusCanonico(b);

      const peso = status => {
        if (status === STATUS.AGUARDANDO_ANALISTA) return 50;
        if (status === STATUS.EM_RECONTAGEM) return 40;
        if (status === STATUS.ABERTA) return 30;
        if (status === STATUS.PERSISTENTE) return 20;
        if (status === STATUS.RESOLVIDA) return 10;
        return 0;
      };

      return peso(sb) - peso(sa) || compararMaisRecente(a, b);
    });

    if (candidatos.length) return candidatos[0];

    return [...(recontagens || [])].sort(compararMaisRecente)[0] || null;
  }

  /* ------------------------------------------------------------------------
   * PROJECAO CANONICA
   * --------------------------------------------------------------------- */

  function construirFluxosCanonicos() {
    const grupos = new Map();

    const adicionar = (obj, tipo) => {
      const key = chaveFluxo(obj);
      if (!key) return;

      const group = grupos.get(key) || {
        chaveFluxo: key,
        divergencias: [],
        recontagens: []
      };

      group[tipo].push(obj);
      grupos.set(key, group);
    };

    (state().divergencias || []).forEach(d => adicionar(d, 'divergencias'));
    (state().recontagens || []).forEach(r => adicionar(r, 'recontagens'));

    return [...grupos.values()].map(group => {
      const principal = escolherDocumentoPrincipal(group.divergencias, group.recontagens);
      if (!principal) return null;

      const rodadas = consolidarRodadas(group.recontagens);
      const primeira = extrairPrimeiraContagem(group.chaveFluxo, group.divergencias);
      const segunda = extrairRodada(rodadas.segunda, 2);
      const terceira = extrairRodada(rodadas.terceira, 3);

      const inventarioId = inventarioCanonico(principal);
      const inventario = getInventarioByCanonical(inventarioId);
      const totalEsperado = obterTotalEsperadoFluxo(principal);
      const avaliacao = avaliarFluxo(
        { principal, primeira, segunda, terceira },
        totalEsperado
      );

      const statusPersistido = obterStatusCanonico(principal);
      const statusCalculado = avaliacao?.estado || statusPersistido;

      const tarefaAtiva = [...group.recontagens]
        .filter(r => {
          const st = upper(r.status);
          const sr = lower(r.status_recontagem);
          return (
            ['PENDENTE', 'EM_ANDAMENTO'].includes(st) ||
            [STATUS_REC.PENDENTE, STATUS_REC.EM_ANDAMENTO].includes(sr)
          ) && !REC_ENCERRADOS.has(sr);
        })
        .sort(compararMaisRecente)[0] || null;

      const motivos = [...new Set(
        group.divergencias.flatMap(d =>
          Array.isArray(d.motivos_divergencia)
            ? d.motivos_divergencia
            : [d.tipo_divergencia]
        ).filter(Boolean)
      )];

      const tipoDivergencia = texto(
        principal.tipo_divergencia ||
        motivos[0] ||
        'DIVERGENCIA_QUANTIDADE'
      );

      const diferenca = (
        primeira.quantidade != null && totalEsperado != null
      ) ? normalizarNumero(primeira.quantidade) - normalizarNumero(totalEsperado) : null;

      const statusEfetivo = statusCalculado;
      const statusRecEfetivo = statusPersistencia(statusEfetivo).status_recontagem;

      const inconsistencias = [];

      if (statusPersistido !== statusCalculado) {
        inconsistencias.push({
          codigo: 'STATUS_DIVERGENTE',
          persistido: statusPersistido,
          calculado: statusCalculado
        });
      }

      if (!group.divergencias.length && group.recontagens.length) {
        inconsistencias.push({ codigo: 'RECONTAGEM_ORFA' });
      }

      if (group.divergencias.length > 1) {
        const statuses = new Set(group.divergencias.map(obterStatusCanonico));
        if (statuses.size > 1) {
          inconsistencias.push({ codigo: 'STATUS_DIVERGENCIAS_INCONSISTENTE' });
        }
      }

      return {
        chaveFluxo: group.chaveFluxo,
        domId: chaveDomId('fluxo', group.chaveFluxo),
        lojaId: lojaCanonica(principal),
        inventarioId,
        inventarioNome: texto(
          principal.inventario_nome ||
          inventario?.nome ||
          inventario?.codigo ||
          inventarioId
        ),
        endereco: enderecoCanonico(principal.endereco),
        rua: texto(G.getEnderecoInfo?.(principal.endereco)?.rua || '—'),
        nivel: texto(
          G.getEnderecoInfo?.(principal.endereco)?.nivel ||
          G.getEnderecoInfo?.(principal.endereco)?.andar ||
          ''
        ),
        setor: texto(
          G.getEnderecoInfo?.(principal.endereco)?.setor ||
          G.getEnderecoInfo?.(principal.endereco)?.local ||
          G.getEnderecoInfo?.(principal.endereco)?.nome_local ||
          ''
        ),
        produto: texto(principal.produto || primeira.produto),
        descricao: texto(
          principal.descricao ||
          principal.descricao_produto ||
          obterNomeProduto(principal.produto || primeira.produto)
        ),
        tipoDivergencia,
        motivos,
        diferenca,
        itensEsperados: obterItensEsperadosFluxo(principal),
        totalEsperado,
        primeira,
        segunda,
        terceira,
        vezesContado:
          (primeira.quantidade != null ? 1 : 0) +
          (segunda.quantidade != null ? 1 : 0) +
          (terceira.quantidade != null ? 1 : 0),
        avaliacao,
        statusPersistido,
        status: statusEfetivo,
        statusRecontagem: statusRecEfetivo,
        resolvida: statusEfetivo === STATUS.RESOLVIDA,
        persistente: statusEfetivo === STATUS.PERSISTENTE,
        encerrada: ENCERRADOS.has(statusEfetivo),
        tarefaAtiva,
        operadorResponsavel: texto(
          tarefaAtiva?.operador_responsavel ||
          tarefaAtiva?.operador_nome ||
          tarefaAtiva?.operador ||
          principal.operador_responsavel ||
          ''
        ),
        operadorId: texto(
          tarefaAtiva?.operador_id ||
          tarefaAtiva?.operador_uid ||
          principal.operador_id ||
          principal.operador_uid ||
          ''
        ),
        atribuidoEm: tarefaAtiva?.atribuido_em || principal.atribuido_em || '',
        atribuidoPor: texto(
          tarefaAtiva?.atribuido_por ||
          principal.atribuido_por ||
          ''
        ),
        executadoPor: texto(
          terceira.operador ||
          segunda.operador ||
          principal.operador_recontagem ||
          ''
        ),
        executadoEm:
          terceira.data ||
          segunda.data ||
          principal.recontagem_concluida_em ||
          '',
        criadaEm: principal.criada_em || principal.created_at || '',
        divergenciaIds: group.divergencias.map(d => texto(d.id)).filter(Boolean),
        recontagemIds: group.recontagens.map(r => texto(r.id)).filter(Boolean),
        documentosDivergencia: group.divergencias,
        documentosRecontagem: group.recontagens,
        principal,
        inconsistente: inconsistencias.length > 0,
        inconsistencias,
        bloqueadaParaEdicao:
          inconsistencias.some(i => i.codigo === 'RECONTAGEM_ORFA')
      };
    }).filter(Boolean);
  }

  function podeSelecionarFluxo(fluxo) {
    if (!fluxo || fluxo.bloqueadaParaEdicao || fluxo.encerrada) return false;
    if (fluxo.terceira.quantidade != null) return false;

    const ativaIniciada = fluxo.documentosRecontagem.some(rec => {
      const st = upper(rec.status);
      const sr = lower(rec.status_recontagem);
      const ativa =
        ['PENDENTE', 'EM_ANDAMENTO'].includes(st) ||
        [STATUS_REC.PENDENTE, STATUS_REC.EM_ANDAMENTO].includes(sr);

      const atribuida = Boolean(
        rec.operador_id ||
        rec.operador_uid ||
        rec.operador_responsavel ||
        rec.operador
      );

      return ativa && atribuida && isRecontagemIniciada(rec);
    });

    if (ativaIniciada) return false;

    const concluidas = new Set();
    fluxo.documentosRecontagem.forEach(rec => {
      if (!isRecontagemConcluida(rec)) return;
      const rodada = numeroRodada(rec, null);
      if (rodada === 1 || rodada === 2) concluidas.add(rodada);
    });

    if (concluidas.size >= 2) return false;

    return [
      STATUS.ABERTA,
      STATUS.EM_RECONTAGEM,
      STATUS.AGUARDANDO_ANALISTA
    ].includes(fluxo.status);
  }

  function aplicarFiltrosDivergencias(fluxos) {
    const value = id => texto(document.getElementById(id)?.value);
    const busca = lower(value('div-busca'));
    const fInv = value('div-sel-inv');
    const fStatus = value('div-fstatus');
    const fTipo = value('div-ftipo');
    const fRua = value('div-frua');
    const fNivel = value('div-fnivel');
    const fSetor = value('div-fsetor');
    const fProduto = value('div-fproduto');
    const fOperador = value('div-foperador');
    const fStatusRec = value('div-fstatus-rec');
    const fData = value('div-fdata');
    const ford = value('div-ford');

    let result = fluxos.slice();

    if (fInv) result = result.filter(f => f.inventarioId === fInv);
    if (fStatus) result = result.filter(f => f.status === fStatus);
    if (fRua) result = result.filter(f => f.rua === fRua);
    if (fNivel) result = result.filter(f => f.nivel === fNivel);
    if (fSetor) result = result.filter(f => f.setor === fSetor);
    if (fProduto) result = result.filter(f => f.produto === fProduto);
    if (fOperador) result = result.filter(f =>
      f.operadorResponsavel === fOperador ||
      f.primeira.operador === fOperador ||
      f.segunda.operador === fOperador ||
      f.terceira.operador === fOperador
    );

    if (fTipo === 'FALTA') result = result.filter(f => f.diferenca != null && f.diferenca < 0);
    else if (fTipo === 'SOBRA') result = result.filter(f => f.diferenca != null && f.diferenca > 0);
    else if (fTipo) result = result.filter(f => f.tipoDivergencia === fTipo);

    if (fStatusRec === 'nao_atribuida') {
      result = result.filter(f => !f.operadorResponsavel);
    } else if (fStatusRec) {
      result = result.filter(f => f.statusRecontagem === fStatusRec);
    }

    if (fData) {
      const now = new Date();
      result = result.filter(f => {
        const dt = new Date(f.criadaEm);
        if (Number.isNaN(dt.getTime())) return false;
        if (fData === 'hoje') return dt.toDateString() === now.toDateString();
        if (fData === '7d') return now - dt <= 7 * 86400000;
        if (fData === '30d') return now - dt <= 30 * 86400000;
        return true;
      });
    }

    if (filtroRapidoAtivo === 'nao_atribuidas') {
      result = result.filter(f => !f.operadorResponsavel);
    } else if (filtroRapidoAtivo === 'minhas') {
      const me = obterUsuarioAtual();
      result = result.filter(f =>
        f.atribuidoPor === me.nome ||
        f.atribuidoPor === me.email ||
        f.principal?.atribuido_por_uid === me.uid
      );
    } else if (filtroRapidoAtivo === 'pendentes') {
      result = result.filter(f => f.statusRecontagem === STATUS_REC.PENDENTE);
    } else if (filtroRapidoAtivo === 'aguardando_analista') {
      result = result.filter(f => f.status === STATUS.AGUARDANDO_ANALISTA);
    } else if (filtroRapidoAtivo === 'concluidas') {
      result = result.filter(f => f.encerrada);
    }

    if (busca) {
      result = result.filter(f =>
        [
          f.endereco,
          f.produto,
          f.descricao,
          f.inventarioNome,
          f.operadorResponsavel,
          f.primeira.operador,
          f.segunda.operador,
          f.terceira.operador
        ].some(item => lower(item).includes(busca))
      );
    }

    if (ford === 'maior_diff') {
      result.sort((a, b) => Math.abs(b.diferenca ?? 0) - Math.abs(a.diferenca ?? 0));
    } else if (ford === 'menor_diff') {
      result.sort((a, b) => Math.abs(a.diferenca ?? 0) - Math.abs(b.diferenca ?? 0));
    } else if (ford === 'endereco') {
      result.sort((a, b) => a.endereco.localeCompare(b.endereco, 'pt-BR'));
    } else {
      result.sort((a, b) => timestampValue(b.criadaEm) - timestampValue(a.criadaEm));
    }

    return result;
  }

  function aplicarFiltrosRecontagens(fluxos) {
    const value = id => texto(document.getElementById(id)?.value);
    const busca = lower(value('rec-busca'));
    const fInv = value('rec-sel-inv');
    const fStatus = value('rec-fstatus');
    const fStatusRec = value('rec-fstatus-rec');
    const fOperador = value('rec-foperador');
    const fRua = value('rec-frua');
    const ford = value('rec-ford');

    let result = fluxos.filter(f =>
      ![STATUS.RESOLVIDA, STATUS.CANCELADA, STATUS.EXCLUIDA].includes(f.status)
    );

    if (fInv) result = result.filter(f => f.inventarioId === fInv);
    if (fStatus) result = result.filter(f => f.status === fStatus);
    if (fRua) result = result.filter(f => f.rua === fRua);

    if (fStatusRec === 'nao_atribuida') {
      result = result.filter(f => !f.operadorResponsavel);
    } else if (fStatusRec) {
      result = result.filter(f => f.statusRecontagem === fStatusRec);
    }

    if (fOperador) {
      result = result.filter(f =>
        f.operadorResponsavel === fOperador ||
        f.executadoPor === fOperador
      );
    }

    if (busca) {
      result = result.filter(f =>
        [
          f.endereco,
          f.produto,
          f.descricao,
          f.inventarioNome,
          f.operadorResponsavel,
          f.executadoPor
        ].some(item => lower(item).includes(busca))
      );
    }

    if (ford === 'maior_diff') {
      result.sort((a, b) => Math.abs(b.diferenca ?? 0) - Math.abs(a.diferenca ?? 0));
    } else if (ford === 'endereco') {
      result.sort((a, b) => a.endereco.localeCompare(b.endereco, 'pt-BR'));
    } else if (ford === 'atribuicao') {
      result.sort((a, b) => timestampValue(b.atribuidoEm) - timestampValue(a.atribuidoEm));
    } else {
      result.sort((a, b) => timestampValue(b.criadaEm) - timestampValue(a.criadaEm));
    }

    return result;
  }

  /* ------------------------------------------------------------------------
   * FIRESTORE / SERVICOS
   * --------------------------------------------------------------------- */

  function firestoreDb() {
    if (G.FS_AN?.runTransaction) return G.FS_AN;
    if (G.firebase?.firestore) return G.firebase.firestore();
    return null;
  }

  function serverTimestamp() {
    return (
      G.firebase?.firestore?.FieldValue?.serverTimestamp?.() ||
      new Date().toISOString()
    );
  }

  function increment(value = 1) {
    return G.firebase?.firestore?.FieldValue?.increment?.(value) ?? value;
  }

  function divergenciaRef(id) {
    const db = firestoreDb();
    return db?.collection?.('dt_divergencias')?.doc?.(id) || null;
  }

  function recontagemRef(id) {
    const db = firestoreDb();
    return db?.collection?.('dt_recontagens')?.doc?.(id) || null;
  }

  async function executarOperacao(chave, callback) {
    if (operacoesEmAndamento.has(chave)) {
      throw new Error('Esta atividade ja esta sendo atualizada.');
    }

    operacoesEmAndamento.add(chave);
    try {
      return await callback();
    } finally {
      operacoesEmAndamento.delete(chave);
    }
  }

  async function persistirFallback(updates) {
    for (const item of updates) {
      if (item.tipo === 'divergencia') {
        const original = (state().divergencias || []).find(d => texto(d.id) === item.id) || {};
        await G.fsSalvarDivergencia?.({ ...original, ...item.data, id: item.id });
      } else {
        const original = (state().recontagens || []).find(r => texto(r.id) === item.id) || {};
        await G.fsSalvarRecontagem?.({ ...original, ...item.data, id: item.id });
      }
    }
  }

  async function atualizarDocumentosAtomicamente(updates) {
    const db = firestoreDb();

    if (!db?.runTransaction) {
      await persistirFallback(updates);
      return;
    }

    await db.runTransaction(async transaction => {
      const reads = [];

      for (const item of updates) {
        const ref = item.tipo === 'divergencia'
          ? divergenciaRef(item.id)
          : recontagemRef(item.id);

        if (!ref) throw new Error(`Referencia Firestore invalida: ${item.tipo}/${item.id}`);
        reads.push({ item, ref, snap: await transaction.get(ref) });
      }

      for (const { item, ref, snap } of reads) {
        if (!snap.exists) {
          if (item.allowCreate) transaction.set(ref, item.data, { merge: true });
          else throw new Error(`Documento nao encontrado: ${item.tipo}/${item.id}`);
          continue;
        }

        const atual = snap.data() || {};
        if (
          item.revisionEsperada != null &&
          Number(atual.revision || 0) !== Number(item.revisionEsperada)
        ) {
          const error = new Error('O fluxo foi atualizado por outro usuario. Atualize a tela.');
          error.code = 'REVISION_CONFLICT';
          throw error;
        }

        transaction.update(ref, item.data);
      }
    });
  }

  function dispatchUpsert(collection, entity, source) {
    if (G.Store?.dispatch && G.Actions?.upsertEntity) {
      G.Store.dispatch(G.Actions.upsertEntity(collection, entity, { source }));
    }
  }

  function atualizarStoreLocal(updates, source) {
    updates.forEach(item => {
      const collection = item.tipo === 'divergencia' ? 'divergencias' : 'recontagens';
      const list = state()[collection] || [];
      const original = list.find(x => texto(x.id) === item.id) || { id: item.id };
      dispatchUpsert(collection, { ...original, ...item.data, id: item.id }, source);
    });
  }

  async function atribuirFluxos(chaves, operador, observacao) {
    const usuario = obterUsuarioAtual();
    const now = new Date().toISOString();
    const updates = [];

    for (const key of chaves) {
      const fluxo = mapaFluxosVisiveis.get(key);
      if (!fluxo || !podeSelecionarFluxo(fluxo)) {
        throw new Error(`Fluxo indisponivel para atribuicao: ${fluxo?.endereco || key}`);
      }

      const tarefa = fluxo.tarefaAtiva;
      const numeroProximaRodada = fluxo.segunda.quantidade == null ? 1 : 2;

      if (tarefa) {
        updates.push({
          tipo: 'recontagem',
          id: texto(tarefa.id),
          revisionEsperada: tarefa.revision,
          data: {
            operador_id: operador.id,
            operador_uid: operador.uid || null,
            operador_nome: operador.nome,
            operador: operador.nome,
            operador_responsavel: operador.nome,
            atribuido_por: usuario.nome,
            atribuido_por_uid: usuario.uid || null,
            atribuido_em: serverTimestamp(),
            observacao_atribuicao: observacao || '',
            status: 'PENDENTE',
            status_recontagem: STATUS_REC.PENDENTE,
            numero_recontagem: numeroRodada(tarefa, numeroProximaRodada),
            chave_fluxo: key,
            revision: increment(1),
            updated_at: serverTimestamp()
          }
        });
      } else {
        const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        updates.push({
          tipo: 'recontagem',
          id,
          allowCreate: true,
          data: {
            id,
            divergencia_id: fluxo.divergenciaIds[0] || null,
            divergencia_ids: fluxo.divergenciaIds,
            chave_fluxo: key,
            loja_id: fluxo.lojaId || null,
            inventario_id: fluxo.inventarioId,
            inventario_nome: fluxo.inventarioNome,
            endereco: fluxo.endereco,
            produto: fluxo.produto,
            descricao: fluxo.descricao,
            qtd_esperada: fluxo.totalEsperado,
            numero_recontagem: numeroProximaRodada,
            operador_id: operador.id,
            operador_uid: operador.uid || null,
            operador_nome: operador.nome,
            operador: operador.nome,
            operador_responsavel: operador.nome,
            atribuido_por: usuario.nome,
            atribuido_por_uid: usuario.uid || null,
            atribuido_em: serverTimestamp(),
            observacao_atribuicao: observacao || '',
            status: 'PENDENTE',
            status_recontagem: STATUS_REC.PENDENTE,
            criada_em: serverTimestamp(),
            updated_at: serverTimestamp(),
            revision: 1
          }
        });
      }

      for (const d of fluxo.documentosDivergencia) {
        updates.push({
          tipo: 'divergencia',
          id: texto(d.id),
          revisionEsperada: d.revision,
          data: {
            status: STATUS.EM_RECONTAGEM,
            status_recontagem: STATUS_REC.PENDENTE,
            operador_id: operador.id,
            operador_uid: operador.uid || null,
            operador_responsavel: operador.nome,
            atribuido_por: usuario.nome,
            atribuido_por_uid: usuario.uid || null,
            atribuido_em: serverTimestamp(),
            observacao_atribuicao: observacao || '',
            chave_fluxo: key,
            revision: increment(1),
            updated_at: serverTimestamp()
          }
        });
      }
    }

    await atualizarDocumentosAtomicamente(updates);
    atualizarStoreLocal(updates, 'atribuirFluxos');
    return updates;
  }

  async function desvincularFluxo(key) {
    const fluxo = mapaFluxosVisiveis.get(key);
    if (!fluxo) throw new Error('Fluxo nao encontrado.');
    if (fluxo.encerrada) throw new Error('Fluxo encerrado nao pode ser desvinculado.');

    const usuario = obterUsuarioAtual();
    const updates = [];

    fluxo.documentosDivergencia.forEach(d => {
      updates.push({
        tipo: 'divergencia',
        id: texto(d.id),
        revisionEsperada: d.revision,
        data: {
          operador_id: null,
          operador_uid: null,
          operador_responsavel: null,
          atribuido_por: null,
          atribuido_por_uid: null,
          atribuido_em: null,
          observacao_atribuicao: null,
          status: STATUS.ABERTA,
          status_recontagem: null,
          revision: increment(1),
          updated_at: serverTimestamp()
        }
      });
    });

    fluxo.documentosRecontagem
      .filter(rec => {
        const st = upper(rec.status);
        const sr = lower(rec.status_recontagem);
        return ['PENDENTE', 'EM_ANDAMENTO'].includes(st) ||
          [STATUS_REC.PENDENTE, STATUS_REC.EM_ANDAMENTO].includes(sr);
      })
      .forEach(rec => {
        if (isRecontagemIniciada(rec)) {
          throw new Error('A recontagem ja foi iniciada e nao pode ser desvinculada.');
        }

        updates.push({
          tipo: 'recontagem',
          id: texto(rec.id),
          revisionEsperada: rec.revision,
          data: {
            status: 'CANCELADA',
            status_recontagem: STATUS_REC.CANCELADA,
            cancelada_em: serverTimestamp(),
            cancelada_por: usuario.nome,
            cancelada_por_uid: usuario.uid || null,
            revision: increment(1),
            updated_at: serverTimestamp()
          }
        });
      });

    await atualizarDocumentosAtomicamente(updates);
    atualizarStoreLocal(updates, 'desvincularFluxo');
    return updates;
  }

  async function resolverFluxoManual(key, justificativa) {
    const fluxo = mapaFluxosVisiveis.get(key);
    if (!fluxo) throw new Error('Fluxo nao encontrado.');
    if (fluxo.encerrada) throw new Error('Fluxo ja encerrado.');
    if (!texto(justificativa)) throw new Error('Informe a justificativa da resolucao manual.');

    if (fluxo.documentosRecontagem.some(isRecontagemIniciada)) {
      throw new Error('Existe recontagem em andamento.');
    }

    const usuario = obterUsuarioAtual();
    const updates = [];

    fluxo.documentosDivergencia.forEach(d => {
      updates.push({
        tipo: 'divergencia',
        id: texto(d.id),
        revisionEsperada: d.revision,
        data: {
          status: STATUS.RESOLVIDA,
          status_recontagem: STATUS_REC.SEM_DIVERGENCIA,
          resolucao_tipo: 'MANUAL_ANALISTA',
          resolucao_justificativa: justificativa,
          resolvida_em: serverTimestamp(),
          resolvida_por: usuario.nome,
          resolvida_por_uid: usuario.uid || null,
          operador_id: null,
          operador_uid: null,
          operador_responsavel: null,
          encerrada_definitivamente: true,
          revision: increment(1),
          updated_at: serverTimestamp()
        }
      });
    });

    fluxo.documentosRecontagem
      .filter(rec => !REC_ENCERRADOS.has(lower(rec.status_recontagem)))
      .forEach(rec => {
        updates.push({
          tipo: 'recontagem',
          id: texto(rec.id),
          revisionEsperada: rec.revision,
          data: {
            status: 'CONCLUIDA',
            status_recontagem: STATUS_REC.SEM_DIVERGENCIA,
            resolucao_tipo: 'MANUAL_ANALISTA',
            resolucao_justificativa: justificativa,
            concluida_em: serverTimestamp(),
            resolvida_por: usuario.nome,
            resolvida_por_uid: usuario.uid || null,
            operador_id: null,
            operador_uid: null,
            operador_responsavel: null,
            revision: increment(1),
            updated_at: serverTimestamp()
          }
        });
      });

    await atualizarDocumentosAtomicamente(updates);
    atualizarStoreLocal(updates, 'resolverFluxoManual');
    return updates;
  }

  /* ------------------------------------------------------------------------
   * SELECTS / FILTROS
   * --------------------------------------------------------------------- */

  function setSelectOptions(id, values, emptyLabel, labelFn = value => value) {
    const select = document.getElementById(id);
    if (!select) return;

    const current = select.value;
    select.replaceChildren();

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = emptyLabel;
    select.appendChild(empty);

    values.forEach(value => {
      const option = document.createElement('option');
      option.value = typeof value === 'object' ? value.value : value;
      option.textContent = labelFn(value);
      select.appendChild(option);
    });

    if ([...select.options].some(option => option.value === current)) {
      select.value = current;
    }
  }

  function popularFiltros(fluxos) {
    setSelectOptions(
      'div-sel-inv',
      (state().inventarios || []).map(i => ({
        value: inventarioCanonico(i),
        label: `${texto(i.codigo)} — ${texto(i.nome)}`
      })),
      'Todos os inventarios',
      item => item.label
    );

    setSelectOptions(
      'rec-sel-inv',
      (state().inventarios || []).map(i => ({
        value: inventarioCanonico(i),
        label: `${texto(i.codigo)} — ${texto(i.nome)}`
      })),
      'Todos os inventarios',
      item => item.label
    );

    const unique = selector => [...new Set(fluxos.map(selector).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

    setSelectOptions('div-frua', unique(f => f.rua), 'Todas as ruas');
    setSelectOptions('div-fnivel', unique(f => f.nivel), 'Todos os niveis');
    setSelectOptions('div-fsetor', unique(f => f.setor), 'Todos os setores');
    setSelectOptions('div-fproduto', unique(f => f.produto), 'Todos os produtos');
    setSelectOptions(
      'div-foperador',
      unique(f => f.operadorResponsavel || f.primeira.operador),
      'Todos os operadores'
    );

    setSelectOptions('rec-frua', unique(f => f.rua), 'Todas as ruas');
    setSelectOptions(
      'rec-foperador',
      unique(f => f.operadorResponsavel || f.executadoPor),
      'Todos os operadores'
    );
  }

  async function carregarOperadores() {
    const result = new Map();

    if (Array.isArray(G._opListaCompleta)) {
      G._opListaCompleta
        .filter(o => o.ativo !== false && lower(o.tipo) !== 'analista')
        .forEach(o => {
          const id = texto(o.id || o.uid || o.email || o.nome);
          if (!id) return;
          result.set(id, {
            id,
            uid: texto(o.uid),
            nome: texto(o.nome),
            cargo: texto(o.cargo)
          });
        });
    }

    if (!result.size && G.FS_AN?.collection) {
      try {
        const snap = await G.FS_AN.collection('dt_operadores')
          .where('ativo', '==', true)
          .get();

        snap.docs.forEach(doc => {
          const data = doc.data() || {};
          if (lower(data.tipo) === 'analista') return;
          result.set(doc.id, {
            id: doc.id,
            uid: texto(data.uid),
            nome: texto(data.nome),
            cargo: texto(data.cargo)
          });
        });
      } catch (error) {
        console.warn('[DivergenciasModule] carregar operadores:', error);
      }
    }

    if (!result.size) {
      [
        ...(state().contagens || []).map(c => c.operador),
        ...(state().recontagens || []).map(r => r.operador)
      ].filter(Boolean).forEach(name => {
        result.set(texto(name), {
          id: texto(name),
          uid: '',
          nome: texto(name),
          cargo: ''
        });
      });
    }

    return [...result.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async function popularSelectOperadores(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const current = select.value;
    select.disabled = true;
    select.replaceChildren();

    const loading = document.createElement('option');
    loading.value = '';
    loading.textContent = 'Carregando operadores...';
    select.appendChild(loading);

    const operadores = await carregarOperadores();

    select.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = operadores.length
      ? 'Selecione o operador...'
      : 'Nenhum operador cadastrado';
    select.appendChild(empty);

    operadores.forEach(op => {
      const option = document.createElement('option');
      option.value = op.id;
      option.dataset.uid = op.uid;
      option.dataset.nome = op.nome;
      option.textContent = op.cargo ? `${op.nome} — ${op.cargo}` : op.nome;
      select.appendChild(option);
    });

    select.disabled = false;
    if ([...select.options].some(option => option.value === current)) {
      select.value = current;
    }
  }

  /* ------------------------------------------------------------------------
   * RENDER HELPERS
   * --------------------------------------------------------------------- */

  function badgeStatus(status) {
    switch (status) {
      case STATUS.ABERTA: return ['b-red', 'ABERTA'];
      case STATUS.EM_RECONTAGEM: return ['b-orange', 'EM RECONTAGEM'];
      case STATUS.AGUARDANDO_ANALISTA: return ['b-purple', 'AGUARD. ANALISTA'];
      case STATUS.RESOLVIDA: return ['b-green', 'RESOLVIDA'];
      case STATUS.PERSISTENTE: return ['b-red', 'PERSISTENTE'];
      case STATUS.CANCELADA: return ['b-gray', 'CANCELADA'];
      default: return ['b-gray', status || '—'];
    }
  }

  function badgeStatusRec(status) {
    switch (status) {
      case STATUS_REC.PENDENTE: return ['b-yellow', 'Pendente'];
      case STATUS_REC.EM_ANDAMENTO: return ['b-orange', 'Em andamento'];
      case STATUS_REC.AGUARDANDO_ANALISTA: return ['b-purple', 'Aguard. analista'];
      case STATUS_REC.CONCLUIDA: return ['b-green', 'Concluida'];
      case STATUS_REC.SEM_DIVERGENCIA:
      case STATUS_REC.RESOLVIDA: return ['b-green', 'Sem divergencia'];
      case STATUS_REC.PERSISTENTE: return ['b-red', 'Persistente'];
      case STATUS_REC.CANCELADA: return ['b-gray', 'Cancelada'];
      default: return ['b-gray', '—'];
    }
  }

  function tipoVisual(fluxo) {
    switch (fluxo.tipoDivergencia) {
      case 'PRODUTO_NAO_IDENTIFICADO':
        return ['b-red', 'Produto nao identificado'];
      case 'PRODUTO_FORA_ENDERECO':
        return ['b-purple', 'Fora do endereco'];
      case 'VAZIO_COM_PRODUTO_NA_BASE':
        return ['b-yellow', 'Vazio com produto'];
      default:
        if (fluxo.diferenca > 0) return ['b-yellow', 'Sobra'];
        if (fluxo.diferenca < 0) return ['b-red', 'Falta'];
        return ['b-gray', fluxo.tipoDivergencia || 'Divergencia'];
    }
  }

  function renderRodadaCell(rodada, totalEsperado, label) {
    const td = document.createElement('td');

    if (rodada.quantidade == null) {
      td.textContent = '—';
      td.style.color = 'var(--muted)';
      td.style.textAlign = 'center';
      return td;
    }

    const codigo = texto(rodada.produto);
    const nome = obterNomeProduto(codigo);
    const bateu = totalEsperado != null &&
      quantidadesIguais(rodada.quantidade, totalEsperado);

    if (bateu) {
      td.style.background = 'rgba(34,197,94,.12)';
      td.style.boxShadow = 'inset 3px 0 0 var(--success)';
    }

    const name = document.createElement('div');
    name.style.fontWeight = '800';
    name.style.color = bateu ? 'var(--success)' : 'inherit';
    name.title = codigo ? `Codigo: ${codigo}` : label;
    name.textContent = `${bateu ? '✓ ' : ''}${nome || 'Produto nao informado'}`;

    const qty = document.createElement('div');
    qty.style.fontFamily = 'var(--mono)';
    qty.style.fontSize = '.72rem';
    qty.style.marginTop = '2px';
    qty.style.fontWeight = bateu ? '900' : '600';
    qty.style.color = bateu ? 'var(--success)' : 'inherit';
    qty.textContent = `Qtd ${rodada.quantidade}${bateu ? ' · conferida' : ''}`;

    td.append(name, qty);
    return td;
  }

  function criarBotao({ text, action, key, className = 'btn btn-ghost btn-sm', title = '' }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.dataset.action = action;
    button.dataset.fluxoKey = key;
    button.title = title;
    button.style.fontSize = '.7rem';
    return button;
  }

  function renderKpisDivergencias(fluxos) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    const abertas = fluxos.filter(f => f.status === STATUS.ABERTA).length;
    const emRec = fluxos.filter(f => f.status === STATUS.EM_RECONTAGEM).length;
    const aguardando = fluxos.filter(f => f.status === STATUS.AGUARDANDO_ANALISTA).length;
    const resolvidas = fluxos.filter(f => f.status === STATUS.RESOLVIDA).length;
    const persistentes = fluxos.filter(f => f.status === STATUS.PERSISTENTE).length;
    const pendentes = fluxos.filter(f => f.statusRecontagem === STATUS_REC.PENDENTE).length;
    const total = fluxos.length;

    set('dk-abertas', abertas);
    set('dk-em-rec', emRec);
    set('dk-resolvidas', resolvidas);
    set('dk-pct', total ? `${Math.round((resolvidas / total) * 100)}%` : '0%');
    set('dk-persistente', persistentes);
    set('dk-pendentes', pendentes);
    set('dk-aguard-analista', aguardando);
    set('dk-nao-ident', fluxos.filter(f => f.tipoDivergencia === 'PRODUTO_NAO_IDENTIFICADO').length);
    set('dk-fora-end', fluxos.filter(f => f.tipoDivergencia === 'PRODUTO_FORA_ENDERECO').length);
  }

  function renderKpisRecontagens(fluxos) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    const pendentes = fluxos.filter(f => f.statusRecontagem === STATUS_REC.PENDENTE).length;
    const concluidas = fluxos.filter(f =>
      [STATUS.RESOLVIDA, STATUS.PERSISTENTE].includes(f.status)
    ).length;
    const atribuidas = fluxos.filter(f => f.operadorResponsavel).length;
    const naoAtribuidas = fluxos.filter(f => !f.operadorResponsavel).length;
    const maiorDiff = fluxos.length
      ? Math.max(...fluxos.map(f => Math.abs(f.diferenca ?? 0)))
      : 0;

    set('rk-pendentes', pendentes);
    set('rk-concluidas', concluidas);
    set('rk-atribuidas', atribuidas);
    set('rk-nao-atribuidas', naoAtribuidas);
    set('rk-persistentes', fluxos.filter(f => f.status === STATUS.PERSISTENTE).length);
    set('rk-maior-diff', maiorDiff || '—');
    set('rk-pct', fluxos.length ? `${Math.round((concluidas / fluxos.length) * 100)}%` : '0%');
  }

  function atualizarBarraSelecao() {
    const bar = document.getElementById('div-sel-bar');
    const count = document.getElementById('div-sel-count');
    if (!bar || !count) return;

    if (selecao.size) {
      bar.style.display = 'flex';
      count.textContent = `${selecao.size} endereco${selecao.size === 1 ? '' : 's'} selecionado${selecao.size === 1 ? '' : 's'}`;
    } else {
      bar.style.display = 'none';
    }

    const master = document.getElementById('div-chk-all');
    if (master) {
      const selectable = visaoDivergencias.filter(podeSelecionarFluxo);
      const selectedVisible = selectable.filter(f => selecao.has(f.chaveFluxo)).length;
      master.checked = selectable.length > 0 && selectedVisible === selectable.length;
      master.indeterminate = selectedVisible > 0 && selectedVisible < selectable.length;
    }
  }

  /* ------------------------------------------------------------------------
   * RENDER DIVERGENCIAS
   * --------------------------------------------------------------------- */

  function renderDivergencias() {
    const todos = construirFluxosCanonicos();
    mapaFluxosVisiveis = new Map(todos.map(f => [f.chaveFluxo, f]));

    popularFiltros(todos);

    const fInv = texto(document.getElementById('div-sel-inv')?.value);
    const baseKpis = fInv ? todos.filter(f => f.inventarioId === fInv) : todos;

    visaoDivergencias = aplicarFiltrosDivergencias(todos);
    renderKpisDivergencias(baseKpis);

    for (const key of [...selecao]) {
      const fluxo = mapaFluxosVisiveis.get(key);
      if (!fluxo || !visaoDivergencias.some(v => v.chaveFluxo === key) || !podeSelecionarFluxo(fluxo)) {
        selecao.delete(key);
      }
    }

    const container = document.getElementById('div-table-wrap');
    if (!container) return;

    container.replaceChildren();

    if (!visaoDivergencias.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<div class="empty-icon">✓</div><div class="empty-title">Nenhum conflito encontrado</div><div class="empty-sub">Nao ha fluxos que correspondam aos filtros atuais.</div>';
      container.appendChild(empty);
      atualizarBarraSelecao();
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'tbl-wrap';
    const table = document.createElement('table');

    const headers = [
      '', 'Inventario', 'Rua', 'Endereco', 'Vezes contado',
      'Operador contagem', 'Data', 'Tipo', 'Esperado no endereco',
      '1a contagem', '2a contagem', '3a contagem', 'Resultado',
      'Status', 'Status recontagem', 'Atribuido para', 'Executado por',
      'Acoes'
    ];

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    headers.forEach((header, index) => {
      const th = document.createElement('th');
      if (index === 0) {
        const master = document.createElement('input');
        master.type = 'checkbox';
        master.id = 'div-chk-all';
        master.title = 'Selecionar todos os fluxos visiveis';
        master.dataset.action = 'toggle-all';
        th.appendChild(master);
      } else {
        th.textContent = header;
      }
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    visaoDivergencias.forEach(fluxo => {
      const tr = document.createElement('tr');
      tr.dataset.fluxoKey = fluxo.chaveFluxo;

      if (selecao.has(fluxo.chaveFluxo)) {
        tr.style.background = 'rgba(232,117,26,.06)';
      }

      const tdSelect = document.createElement('td');
      if (podeSelecionarFluxo(fluxo)) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'div-row-chk';
        checkbox.checked = selecao.has(fluxo.chaveFluxo);
        checkbox.dataset.action = 'toggle-one';
        checkbox.dataset.fluxoKey = fluxo.chaveFluxo;
        tdSelect.appendChild(checkbox);
      }
      tr.appendChild(tdSelect);

      const simpleCell = (textValue, className = '', style = {}) => {
        const td = document.createElement('td');
        if (className) td.className = className;
        Object.assign(td.style, style);
        td.textContent = textValue ?? '—';
        return td;
      };

      tr.appendChild(simpleCell(fluxo.inventarioNome, '', { fontSize: '.75rem', color: 'var(--muted)' }));
      tr.appendChild(simpleCell(fluxo.rua, 'mono', { fontWeight: '600' }));
      tr.appendChild(simpleCell(fluxo.endereco, 'mono'));

      const tdTimes = document.createElement('td');
      tdTimes.style.textAlign = 'center';
      const timesBadge = document.createElement('span');
      timesBadge.className = 'badge b-purple';
      timesBadge.textContent = `${fluxo.vezesContado}x`;
      tdTimes.appendChild(timesBadge);
      tr.appendChild(tdTimes);

      tr.appendChild(simpleCell(fluxo.primeira.operador || '—', '', { fontSize: '.8rem' }));
      tr.appendChild(simpleCell(formatarData(fluxo.criadaEm), 'mono', {
        fontSize: '.72rem',
        color: 'var(--muted)',
        whiteSpace: 'nowrap'
      }));

      const [tipoClass, tipoLabel] = tipoVisual(fluxo);
      const tdTipo = document.createElement('td');
      const tipoBadge = document.createElement('span');
      tipoBadge.className = `badge ${tipoClass}`;
      tipoBadge.textContent = tipoLabel;
      tdTipo.appendChild(tipoBadge);
      tr.appendChild(tdTipo);

      const tdExpected = document.createElement('td');
      const expectedButton = criarBotao({
        text: fluxo.totalEsperado == null
          ? 'Esperado nao disponivel'
          : `Total esperado: ${fluxo.totalEsperado}`,
        action: 'details',
        key: fluxo.chaveFluxo,
        className: 'btn btn-ghost btn-sm',
        title: 'Visualizar composicao do total esperado'
      });
      expectedButton.style.width = '100%';
      expectedButton.style.minWidth = '145px';
      expectedButton.style.textAlign = 'left';
      tdExpected.appendChild(expectedButton);
      tr.appendChild(tdExpected);

      tr.appendChild(renderRodadaCell(fluxo.primeira, fluxo.totalEsperado, '1a contagem'));
      tr.appendChild(renderRodadaCell(fluxo.segunda, fluxo.totalEsperado, '2a contagem'));
      tr.appendChild(renderRodadaCell(fluxo.terceira, fluxo.totalEsperado, '3a contagem'));

      const tdResult = document.createElement('td');
      const result = document.createElement('div');
      result.style.fontFamily = 'var(--mono)';
      result.style.fontWeight = '800';
      result.style.color = fluxo.resolvida ? 'var(--success)' : 'var(--danger)';
      result.textContent = fluxo.resolvida
        ? '✓ Conferido'
        : fluxo.persistente
          ? 'Persistente'
          : 'Divergente';
      tdResult.appendChild(result);
      tr.appendChild(tdResult);

      const [statusClass, statusLabel] = badgeStatus(fluxo.status);
      const tdStatus = document.createElement('td');
      const statusBadge = document.createElement('span');
      statusBadge.className = `badge ${statusClass}`;
      statusBadge.textContent = statusLabel;
      tdStatus.appendChild(statusBadge);

      if (fluxo.inconsistente) {
        const warning = document.createElement('div');
        warning.style.fontSize = '.62rem';
        warning.style.color = 'var(--danger)';
        warning.style.marginTop = '4px';
        warning.textContent = 'Inconsistencia detectada';
        warning.title = fluxo.inconsistencias.map(i => i.codigo).join(', ');
        tdStatus.appendChild(warning);
      }
      tr.appendChild(tdStatus);

      const [recClass, recLabel] = badgeStatusRec(fluxo.statusRecontagem);
      const tdStatusRec = document.createElement('td');
      const recBadge = document.createElement('span');
      recBadge.className = `badge ${recClass}`;
      recBadge.textContent = recLabel;
      tdStatusRec.appendChild(recBadge);
      tr.appendChild(tdStatusRec);

      const tdAssigned = document.createElement('td');
      if (fluxo.operadorResponsavel) {
        const name = document.createElement('div');
        name.style.fontWeight = '600';
        name.textContent = fluxo.operadorResponsavel;
        tdAssigned.appendChild(name);

        if (fluxo.atribuidoEm) {
          const date = document.createElement('div');
          date.style.fontSize = '.65rem';
          date.style.color = 'var(--muted)';
          date.textContent = formatarData(fluxo.atribuidoEm);
          tdAssigned.appendChild(date);
        }
      } else {
        tdAssigned.textContent = 'Nao atribuido';
        tdAssigned.style.color = 'var(--muted)';
      }
      tr.appendChild(tdAssigned);

      const tdExecuted = document.createElement('td');
      tdExecuted.textContent = fluxo.executadoPor || '—';
      if (fluxo.executadoPor) {
        tdExecuted.style.fontWeight = '700';
        tdExecuted.style.color = 'var(--success)';
      }
      tr.appendChild(tdExecuted);

      const tdActions = document.createElement('td');
      tdActions.style.whiteSpace = 'nowrap';
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '4px';
      actions.style.flexWrap = 'wrap';

      if (fluxo.encerrada) {
        const locked = document.createElement('span');
        locked.textContent = 'Encerrado';
        locked.style.fontSize = '.68rem';
        locked.style.fontWeight = '700';
        locked.style.color = fluxo.persistente ? 'var(--danger)' : 'var(--success)';
        actions.appendChild(locked);
      } else if (fluxo.bloqueadaParaEdicao) {
        const warning = document.createElement('span');
        warning.textContent = 'Requer reconciliacao';
        warning.style.fontSize = '.68rem';
        warning.style.color = 'var(--danger)';
        actions.appendChild(warning);
      } else {
        actions.appendChild(criarBotao({
          text: 'Resolver',
          action: 'resolve',
          key: fluxo.chaveFluxo,
          className: 'btn btn-success btn-sm',
          title: 'Resolver manualmente com justificativa'
        }));

        if (fluxo.operadorResponsavel) {
          actions.appendChild(criarBotao({
            text: 'Desvincular',
            action: 'unlink',
            key: fluxo.chaveFluxo,
            className: 'btn btn-ghost btn-sm',
            title: 'Remover atribuicao ainda nao iniciada'
          }));
        } else if (podeSelecionarFluxo(fluxo)) {
          actions.appendChild(criarBotao({
            text: 'Atribuir',
            action: 'assign',
            key: fluxo.chaveFluxo,
            className: 'btn btn-ghost btn-sm',
            title: 'Atribuir recontagem'
          }));
        }
      }

      tdActions.appendChild(actions);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    atualizarBarraSelecao();
  }

  /* ------------------------------------------------------------------------
   * RENDER RECONTAGENS
   * --------------------------------------------------------------------- */

  function renderRecontagens() {
    const todos = construirFluxosCanonicos();
    mapaFluxosVisiveis = new Map(todos.map(f => [f.chaveFluxo, f]));
    popularFiltros(todos);

    visaoRecontagens = aplicarFiltrosRecontagens(todos);
    renderKpisRecontagens(visaoRecontagens);

    const container = document.getElementById('rec-table-wrap');
    if (!container) return;

    container.replaceChildren();

    if (!visaoRecontagens.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<div class="empty-icon">↻</div><div class="empty-title">Nenhuma recontagem encontrada</div><div class="empty-sub">Nao ha atividades que correspondam aos filtros atuais.</div>';
      container.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'tbl-wrap';
    const table = document.createElement('table');

    const headers = [
      'Inventario', 'Rua', 'Endereco', 'Produto', 'Qtd sistema',
      'Contagem 1', 'Contagem 2', 'Contagem 3', 'Atribuido para',
      'Executado por', 'Status', 'Acoes'
    ];

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    visaoRecontagens.forEach(fluxo => {
      const tr = document.createElement('tr');
      tr.dataset.fluxoKey = fluxo.chaveFluxo;

      const simpleCell = (value, className = '') => {
        const td = document.createElement('td');
        td.className = className;
        td.textContent = value ?? '—';
        return td;
      };

      tr.appendChild(simpleCell(fluxo.inventarioNome));
      tr.appendChild(simpleCell(fluxo.rua, 'mono'));
      tr.appendChild(simpleCell(fluxo.endereco, 'mono'));

      const tdProduct = document.createElement('td');
      const product = document.createElement('div');
      product.style.fontWeight = '600';
      product.textContent = fluxo.produto || '—';
      const description = document.createElement('div');
      description.style.fontSize = '.7rem';
      description.style.color = 'var(--muted)';
      description.textContent = fluxo.descricao || '';
      tdProduct.append(product, description);
      tr.appendChild(tdProduct);

      tr.appendChild(simpleCell(fluxo.totalEsperado ?? 'Nao disponivel', 'mono'));
      tr.appendChild(renderRodadaCell(fluxo.primeira, fluxo.totalEsperado, '1a contagem'));
      tr.appendChild(renderRodadaCell(fluxo.segunda, fluxo.totalEsperado, '2a contagem'));
      tr.appendChild(renderRodadaCell(fluxo.terceira, fluxo.totalEsperado, '3a contagem'));

      tr.appendChild(simpleCell(fluxo.operadorResponsavel || 'Nao atribuido'));
      tr.appendChild(simpleCell(fluxo.executadoPor || '—'));

      const [statusClass, statusLabel] = badgeStatus(fluxo.status);
      const tdStatus = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `badge ${statusClass}`;
      badge.textContent = statusLabel;
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      const tdActions = document.createElement('td');
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '4px';
      actions.style.flexWrap = 'wrap';

      if (fluxo.encerrada) {
        const label = document.createElement('span');
        label.textContent = 'Encerrado';
        label.style.fontSize = '.68rem';
        label.style.fontWeight = '700';
        actions.appendChild(label);
      } else if (fluxo.bloqueadaParaEdicao) {
        const label = document.createElement('span');
        label.textContent = 'Requer reconciliacao';
        label.style.fontSize = '.68rem';
        label.style.color = 'var(--danger)';
        actions.appendChild(label);
      } else {
        if (!fluxo.operadorResponsavel && podeSelecionarFluxo(fluxo)) {
          actions.appendChild(criarBotao({
            text: 'Atribuir',
            action: 'assign',
            key: fluxo.chaveFluxo
          }));
        }

        if (fluxo.tarefaAtiva && typeof G.abrirRegistrarRecontagem === 'function') {
          actions.appendChild(criarBotao({
            text: 'Registrar',
            action: 'register',
            key: fluxo.chaveFluxo,
            className: 'btn btn-primary btn-sm'
          }));
        }
      }

      tdActions.appendChild(actions);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  /* ------------------------------------------------------------------------
   * MODAIS / ACOES
   * --------------------------------------------------------------------- */

  async function abrirAtribuicao(chaves = null) {
    if (Array.isArray(chaves)) {
      selecao.clear();
      chaves.forEach(key => {
        const fluxo = mapaFluxosVisiveis.get(key);
        if (podeSelecionarFluxo(fluxo)) selecao.add(key);
      });
    }

    for (const key of [...selecao]) {
      if (!podeSelecionarFluxo(mapaFluxosVisiveis.get(key))) selecao.delete(key);
    }

    atualizarBarraSelecao();

    if (!selecao.size) {
      toast('Selecione pelo menos um endereco.', 'w');
      return;
    }

    const resumo = document.getElementById('atrib-resumo');
    if (resumo) {
      resumo.replaceChildren();

      const title = document.createElement('div');
      title.style.fontWeight = '700';
      title.style.marginBottom = '8px';
      title.textContent = `${selecao.size} endereco${selecao.size === 1 ? '' : 's'} selecionado${selecao.size === 1 ? '' : 's'}:`;
      resumo.appendChild(title);

      const list = document.createElement('div');
      list.style.display = 'flex';
      list.style.flexWrap = 'wrap';
      list.style.gap = '4px';

      [...selecao].forEach(key => {
        const fluxo = mapaFluxosVisiveis.get(key);
        const badge = document.createElement('span');
        badge.className = 'badge b-orange';
        badge.textContent = fluxo?.endereco || key;
        list.appendChild(badge);
      });

      resumo.appendChild(list);
    }

    G.openModal?.('modal-atribuir-recontagem');

    const obs = document.getElementById('atrib-obs');
    if (obs) obs.value = '';

    await popularSelectOperadores('atrib-operador');
  }

  async function confirmarAtribuicao() {
    const select = document.getElementById('atrib-operador');
    const option = select?.selectedOptions?.[0];
    const observacao = texto(document.getElementById('atrib-obs')?.value);

    if (!option?.value) {
      toast('Selecione um operador.', 'e');
      return;
    }

    const operador = {
      id: option.value,
      uid: texto(option.dataset.uid),
      nome: texto(option.dataset.nome || option.textContent)
    };

    const chaves = [...selecao];
    if (!chaves.length && recAtribuirDireto?.chaveFluxo) {
      chaves.push(recAtribuirDireto.chaveFluxo);
    }

    try {
      await executarOperacao(`assign:${chaves.sort().join(',')}`, async () => {
        await atribuirFluxos(chaves, operador, observacao);
      });

      G.closeModal?.('modal-atribuir-recontagem');
      selecao.clear();
      recAtribuirDireto = null;

      renderDivergencias();
      renderRecontagens();
      G.atualizarBadgesNav?.();

      G.logSistema?.(
        'ATRIBUICAO_RECONTAGEM',
        `${chaves.length} fluxo(s) atribuido(s) a ${operador.nome}`,
        { chaves, operadorId: operador.id }
      );

      toast(`Atribuicao concluida para ${operador.nome}.`, 's');
    } catch (error) {
      console.error('[DivergenciasModule] confirmarAtribuicao:', error);
      toast(error.message || 'Nao foi possivel concluir a atribuicao.', 'e');
    }
  }

  async function confirmarDesvinculacao(key) {
    const fluxo = mapaFluxosVisiveis.get(key);
    if (!fluxo) return;

    const confirmed = await confirmar(
      `Desvincular ${fluxo.operadorResponsavel || 'o operador'} do endereco ${fluxo.endereco}?`
    );

    if (!confirmed) return;

    try {
      await executarOperacao(`unlink:${key}`, () => desvincularFluxo(key));
      renderDivergencias();
      renderRecontagens();
      G.atualizarBadgesNav?.();

      G.logSistema?.('DESVINCULACAO_RECONTAGEM', 'Fluxo desvinculado', {
        chaveFluxo: key,
        endereco: fluxo.endereco
      });

      toast('Recontagem desvinculada. A divergencia permanece aberta.', 's');
    } catch (error) {
      console.error('[DivergenciasModule] desvincular:', error);
      toast(error.message || 'Nao foi possivel desvincular.', 'e');
    }
  }

  async function confirmarResolucaoManual(key) {
    const fluxo = mapaFluxosVisiveis.get(key);
    if (!fluxo) return;

    const justificativa = G.prompt?.(
      `Informe a justificativa para resolver manualmente o endereco ${fluxo.endereco}:`
    );

    if (!texto(justificativa)) return;

    const confirmed = await confirmar(
      `Confirmar resolucao manual do endereco ${fluxo.endereco}?`
    );

    if (!confirmed) return;

    try {
      await executarOperacao(`resolve:${key}`, () =>
        resolverFluxoManual(key, texto(justificativa))
      );

      renderDivergencias();
      renderRecontagens();
      G.atualizarBadgesNav?.();

      G.logSistema?.('DIVERGENCIA_RESOLVIDA_MANUALMENTE', 'Fluxo resolvido manualmente', {
        chaveFluxo: key,
        endereco: fluxo.endereco,
        justificativa
      });

      toast('Divergencia resolvida manualmente.', 's');
    } catch (error) {
      console.error('[DivergenciasModule] resolver:', error);
      toast(error.message || 'Nao foi possivel resolver a divergencia.', 'e');
    }
  }

  function confirmar(message) {
    if (typeof G.showConfirm === 'function') {
      return new Promise(resolve => {
        G.showConfirm(message, () => resolve(true), {
          title: 'Confirmacao',
          okLabel: 'Confirmar'
        });
        setTimeout(() => {
          // O modal existente controla o cancelamento; este fallback nao resolve
          // automaticamente para evitar confirmar sem acao do usuario.
        }, 0);
      });
    }
    return Promise.resolve(G.confirm(message));
  }

  function abrirDetalhes(key) {
    const fluxo = mapaFluxosVisiveis.get(key);
    if (!fluxo) {
      toast('Fluxo nao localizado.', 'e');
      return;
    }

    document.getElementById('modal-paletes-esperados-bg')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'modal-paletes-esperados-bg';
    overlay.className = 'modal-bg open';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '99999';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '820px';
    modal.style.width = 'min(820px,94vw)';
    modal.style.padding = '0';
    modal.style.overflow = 'hidden';

    const header = document.createElement('div');
    header.className = 'modal-hdr';
    header.style.padding = '18px 20px';

    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = 'Esperado e comparacao das contagens';

    const subtitle = document.createElement('div');
    subtitle.style.fontSize = '.72rem';
    subtitle.style.color = 'var(--muted)';
    subtitle.style.marginTop = '3px';
    subtitle.textContent = `Endereco ${fluxo.endereco} · ${fluxo.itensEsperados.length} item(ns)`;

    titleWrap.append(title, subtitle);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal-close';
    close.textContent = '×';
    close.addEventListener('click', () => overlay.remove());

    header.append(titleWrap, close);
    modal.appendChild(header);

    const items = document.createElement('div');
    items.style.maxHeight = '42vh';
    items.style.overflow = 'auto';
    items.style.borderTop = '1px solid var(--border)';
    items.style.borderBottom = '1px solid var(--border)';

    const expectedItems = fluxo.itensEsperados.length
      ? fluxo.itensEsperados
      : [{
          produto: fluxo.produto,
          descricao: fluxo.descricao,
          quantidade_esperada: fluxo.totalEsperado
        }];

    expectedItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'minmax(90px,.7fr) minmax(170px,1.7fr) auto';
      row.style.gap = '12px';
      row.style.alignItems = 'center';
      row.style.padding = '11px 12px';
      row.style.borderBottom = '1px solid var(--border)';

      const identifier = texto(
        item.palete ||
        item.pallet ||
        item.numero_palete ||
        item.numeroPalete ||
        item.sscc ||
        item.lote ||
        `Item ${index + 1}`
      );

      const code = texto(
        item.codigo_produto ||
        item.codigoProduto ||
        item.codigo_interno ||
        item.codigoInterno ||
        item.gtin ||
        item.ean ||
        item.dun ||
        item.produto ||
        '—'
      );

      const description = texto(
        item.descricao_produto ||
        item.descricaoProduto ||
        item.descricao ||
        item.nomeProduto ||
        obterNomeProduto(code)
      );

      const left = document.createElement('div');
      left.innerHTML = `<div style="font-size:.65rem;color:var(--muted)">ITEM</div><div class="mono" style="font-weight:800">${escapeHtml(identifier)}</div>`;

      const center = document.createElement('div');
      const codeEl = document.createElement('div');
      codeEl.className = 'mono';
      codeEl.style.fontWeight = '800';
      codeEl.textContent = code;
      const descEl = document.createElement('div');
      descEl.style.fontSize = '.69rem';
      descEl.style.color = 'var(--muted)';
      descEl.textContent = description;
      center.append(codeEl, descEl);

      const right = document.createElement('div');
      right.style.textAlign = 'right';
      const qtyLabel = document.createElement('div');
      qtyLabel.style.fontSize = '.65rem';
      qtyLabel.style.color = 'var(--muted)';
      qtyLabel.textContent = 'QUANTIDADE';
      const qtyValue = document.createElement('div');
      qtyValue.className = 'mono';
      qtyValue.style.fontSize = '1rem';
      qtyValue.style.fontWeight = '900';
      qtyValue.textContent = String(obterQuantidadeEsperadaItem(item));
      right.append(qtyLabel, qtyValue);

      row.append(left, center, right);
      items.appendChild(row);
    });

    modal.appendChild(items);

    const totalBar = document.createElement('div');
    totalBar.style.display = 'flex';
    totalBar.style.justifyContent = 'space-between';
    totalBar.style.alignItems = 'center';
    totalBar.style.padding = '14px 20px';
    totalBar.style.background = 'rgba(59,130,246,.07)';

    const totalLabel = document.createElement('div');
    totalLabel.textContent = 'TOTAL CONSOLIDADO DO ENDERECO';
    totalLabel.style.fontSize = '.68rem';
    totalLabel.style.color = 'var(--muted)';

    const totalValue = document.createElement('div');
    totalValue.className = 'mono';
    totalValue.style.fontSize = '1.35rem';
    totalValue.style.fontWeight = '950';
    totalValue.textContent = fluxo.totalEsperado == null
      ? 'Nao disponivel'
      : String(fluxo.totalEsperado);

    totalBar.append(totalLabel, totalValue);
    modal.appendChild(totalBar);

    const comparisons = document.createElement('div');
    comparisons.style.padding = '16px 20px';
    comparisons.style.display = 'grid';
    comparisons.style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
    comparisons.style.gap = '10px';

    [
      ['1a contagem', fluxo.primeira],
      ['2a contagem', fluxo.segunda],
      ['3a contagem', fluxo.terceira]
    ].forEach(([label, rodada]) => {
      const card = document.createElement('div');
      const hit = fluxo.totalEsperado != null &&
        rodada.quantidade != null &&
        quantidadesIguais(rodada.quantidade, fluxo.totalEsperado);

      card.style.border = `1px solid ${hit ? 'rgba(34,197,94,.45)' : 'var(--border)'}`;
      card.style.background = hit ? 'rgba(34,197,94,.11)' : 'var(--surface)';
      card.style.borderRadius = '12px';
      card.style.padding = '12px';

      const cardTitle = document.createElement('strong');
      cardTitle.textContent = label;

      const name = document.createElement('div');
      name.style.fontSize = '.72rem';
      name.style.color = 'var(--muted)';
      name.style.marginTop = '8px';
      name.textContent = rodada.quantidade == null
        ? 'Sem registro'
        : obterNomeProduto(rodada.produto);

      const qty = document.createElement('div');
      qty.className = 'mono';
      qty.style.fontSize = '1.05rem';
      qty.style.fontWeight = '950';
      qty.style.marginTop = '4px';
      qty.style.color = hit ? 'var(--success)' : 'inherit';
      qty.textContent = rodada.quantidade == null ? '—' : `Qtd ${rodada.quantidade}`;

      card.append(cardTitle, name, qty);
      comparisons.appendChild(card);
    });

    modal.appendChild(comparisons);
    overlay.appendChild(modal);

    overlay.addEventListener('click', event => {
      if (event.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  /* ------------------------------------------------------------------------
   * EXPORTACAO
   * --------------------------------------------------------------------- */

  function exportarXlsx(nomeArquivo, nomeAba, rows) {
    if (!G.XLSX) {
      toast('Biblioteca Excel nao carregada.', 'e');
      return;
    }
    if (!rows.length) {
      toast('Nao ha dados nos filtros atuais.', 'w');
      return;
    }

    const ws = G.XLSX.utils.json_to_sheet(rows);
    const wb = G.XLSX.utils.book_new();
    G.XLSX.utils.book_append_sheet(wb, ws, nomeAba.slice(0, 31));
    G.XLSX.writeFile(wb, nomeArquivo);
  }

  function exportarDivergencias() {
    const rows = visaoDivergencias.map(f => ({
      'Inventario': f.inventarioNome,
      'Rua': f.rua,
      'Endereco': f.endereco,
      'Produto': f.produto,
      'Descricao': f.descricao,
      'Tipo': f.tipoDivergencia,
      'Total esperado no endereco': f.totalEsperado ?? '',
      '1a contagem': f.primeira.quantidade ?? '',
      'Operador 1a': f.primeira.operador,
      '2a contagem': f.segunda.quantidade ?? '',
      'Operador 2a': f.segunda.operador,
      '3a contagem': f.terceira.quantidade ?? '',
      'Operador 3a': f.terceira.operador,
      'Diferenca inicial': f.diferenca ?? '',
      'Status exibido': f.status,
      'Status persistido': f.statusPersistido,
      'Status recontagem': f.statusRecontagem || '',
      'Atribuido para': f.operadorResponsavel,
      'Executado por': f.executadoPor,
      'Inconsistencia detectada': f.inconsistente ? f.inconsistencias.map(i => i.codigo).join(', ') : '',
      'Chave do fluxo': f.chaveFluxo,
      'Criada em': formatarData(f.criadaEm)
    }));

    exportarXlsx('divergencias-filtradas.xlsx', 'Divergencias', rows);
  }

  function exportarRecontagens() {
    const rows = visaoRecontagens.map(f => ({
      'Inventario': f.inventarioNome,
      'Rua': f.rua,
      'Endereco': f.endereco,
      'Produto': f.produto,
      'Descricao': f.descricao,
      'Total esperado no endereco': f.totalEsperado ?? '',
      '1a contagem': f.primeira.quantidade ?? '',
      'Operador 1a': f.primeira.operador,
      '2a contagem': f.segunda.quantidade ?? '',
      'Operador 2a': f.segunda.operador,
      '3a contagem': f.terceira.quantidade ?? '',
      'Operador 3a': f.terceira.operador,
      'Status': f.status,
      'Status recontagem': f.statusRecontagem || '',
      'Atribuido para': f.operadorResponsavel,
      'Executado por': f.executadoPor,
      'Atribuida em': formatarData(f.atribuidoEm),
      'Executada em': formatarData(f.executadoEm),
      'Chave do fluxo': f.chaveFluxo
    }));

    exportarXlsx('recontagens-filtradas.xlsx', 'Recontagens', rows);
  }

  /* ------------------------------------------------------------------------
   * EVENTOS DELEGADOS
   * --------------------------------------------------------------------- */

  function handleTableAction(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const key = target.dataset.fluxoKey;

    if (action === 'toggle-all') {
      const checked = target.checked;
      visaoDivergencias.forEach(fluxo => {
        if (!podeSelecionarFluxo(fluxo)) return;
        if (checked) selecao.add(fluxo.chaveFluxo);
        else selecao.delete(fluxo.chaveFluxo);
      });
      renderDivergencias();
      return;
    }

    if (action === 'toggle-one') {
      const fluxo = mapaFluxosVisiveis.get(key);
      if (target.checked && podeSelecionarFluxo(fluxo)) selecao.add(key);
      else selecao.delete(key);
      atualizarBarraSelecao();
      return;
    }

    if (action === 'assign') {
      abrirAtribuicao([key]);
      return;
    }

    if (action === 'unlink') {
      confirmarDesvinculacao(key);
      return;
    }

    if (action === 'resolve') {
      confirmarResolucaoManual(key);
      return;
    }

    if (action === 'details') {
      abrirDetalhes(key);
      return;
    }

    if (action === 'register') {
      const fluxo = mapaFluxosVisiveis.get(key);
      if (fluxo?.tarefaAtiva?.id) G.abrirRegistrarRecontagem?.(fluxo.tarefaAtiva.id);
    }
  }

  function bindEvents() {
    const divWrap = document.getElementById('div-table-wrap');
    const recWrap = document.getElementById('rec-table-wrap');

    if (divWrap && !divWrap.dataset.canonicalEvents) {
      divWrap.addEventListener('click', handleTableAction);
      divWrap.addEventListener('change', handleTableAction);
      divWrap.dataset.canonicalEvents = '1';
    }

    if (recWrap && !recWrap.dataset.canonicalEvents) {
      recWrap.addEventListener('click', handleTableAction);
      recWrap.dataset.canonicalEvents = '1';
    }
  }

  /* ------------------------------------------------------------------------
   * API DE COMPATIBILIDADE
   * --------------------------------------------------------------------- */

  G.renderDivergencias = function renderDivergenciasPublic() {
    bindEvents();
    return renderDivergencias();
  };

  G.renderRecontagens = function renderRecontagensPublic() {
    bindEvents();
    return renderRecontagens();
  };

  G.divPodeSelecionar = obj => {
    if (obj?.chaveFluxo) return podeSelecionarFluxo(obj);
    const key = chaveFluxo(obj);
    return podeSelecionarFluxo(mapaFluxosVisiveis.get(key));
  };

  G.divToggleSel = function divToggleSelCompat(idOrKey, checked) {
    let key = idOrKey;
    if (!mapaFluxosVisiveis.has(key)) {
      const raw = (state().divergencias || []).find(d => texto(d.id) === texto(idOrKey));
      key = raw ? chaveFluxo(raw) : key;
    }

    const fluxo = mapaFluxosVisiveis.get(key);
    if (checked && podeSelecionarFluxo(fluxo)) selecao.add(key);
    else selecao.delete(key);

    atualizarBarraSelecao();
  };

  G.divToggleTodos = function divToggleTodosCompat(checked) {
    visaoDivergencias.forEach(fluxo => {
      if (!podeSelecionarFluxo(fluxo)) return;
      if (checked) selecao.add(fluxo.chaveFluxo);
      else selecao.delete(fluxo.chaveFluxo);
    });
    renderDivergencias();
  };

  G.divDeselecionarTodos = function divDeselecionarTodos() {
    selecao.clear();
    renderDivergencias();
  };

  G.divAtualizarBarraSel = atualizarBarraSelecao;

  G.divFiltroRapido = function divFiltroRapido(tipo) {
    if (tipo === 'limpar') {
      filtroRapidoAtivo = '';
      [
        'div-busca', 'div-frua', 'div-fnivel', 'div-fsetor',
        'div-fproduto', 'div-foperador', 'div-fstatus-rec',
        'div-fdata', 'div-ftipo', 'div-fstatus', 'div-ford',
        'div-sel-inv'
      ].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
      });
    } else {
      filtroRapidoAtivo = filtroRapidoAtivo === tipo ? '' : tipo;
    }

    ['nao_atribuidas', 'minhas', 'pendentes', 'aguardando_analista', 'concluidas']
      .forEach(name => {
        const button = document.getElementById(`fq-${name}`);
        if (!button) return;
        const active = filtroRapidoAtivo === name;
        button.style.background = active ? 'var(--orange)' : '';
        button.style.color = active ? '#fff' : '';
        button.style.borderColor = active ? 'var(--orange)' : '';
      });

    renderDivergencias();
  };

  G.divPopularSelectOperadores = popularSelectOperadores;
  G.abrirAtribuirRecontagem = () => abrirAtribuicao();
  G.confirmarAtribuicao = confirmarAtribuicao;

  G.divAtribuirRapido = function divAtribuirRapido(idOrKey) {
    let key = idOrKey;
    if (!mapaFluxosVisiveis.has(key)) {
      const raw = (state().divergencias || []).find(d => texto(d.id) === texto(idOrKey));
      key = raw ? chaveFluxo(raw) : key;
    }
    return abrirAtribuicao([key]);
  };

  G.divAtribuirPorRec = function divAtribuirPorRec(recId) {
    const rec = (state().recontagens || []).find(r => texto(r.id) === texto(recId));
    if (!rec) {
      toast('Recontagem nao encontrada.', 'e');
      return;
    }

    const key = chaveFluxo(rec);
    recAtribuirDireto = { ...rec, chaveFluxo: key };
    abrirAtribuicao([key]);
  };

  G.desvincularRecontagem = function desvincularRecontagemCompat(idOrKey) {
    let key = idOrKey;
    if (!mapaFluxosVisiveis.has(key)) {
      const raw = (state().divergencias || []).find(d => texto(d.id) === texto(idOrKey));
      key = raw ? chaveFluxo(raw) : key;
    }
    return confirmarDesvinculacao(key);
  };

  G.marcarDivergenciaResolvida = function marcarDivergenciaResolvidaCompat(idOrKey) {
    let key = idOrKey;
    if (!mapaFluxosVisiveis.has(key)) {
      const raw = (state().divergencias || []).find(d => texto(d.id) === texto(idOrKey));
      key = raw ? chaveFluxo(raw) : key;
    }
    return confirmarResolucaoManual(key);
  };

  G._marcarDivResolvida = G.marcarDivergenciaResolvida;
  G.exportarDivergencias = exportarDivergencias;
  G.exportarRecontagens = exportarRecontagens;
  G.abrirDetalhePaletesEsperados = function abrirDetalheCompat(idOrKey) {
    let key = idOrKey;
    if (!mapaFluxosVisiveis.has(key)) {
      const raw = (state().divergencias || []).find(d => texto(d.id) === texto(idOrKey));
      key = raw ? chaveFluxo(raw) : key;
    }
    abrirDetalhes(key);
  };
  G.fecharDetalhePaletesEsperados = () => {
    document.getElementById('modal-paletes-esperados-bg')?.remove();
  };

  G.AnalistaDivergenciasModule = Object.freeze({
    STATUS,
    STATUS_REC,
    chaveFluxo,
    construirFluxosCanonicos,
    consolidarRodadas,
    avaliarFluxo,
    podeSelecionarFluxo,
    atribuirFluxos,
    desvincularFluxo,
    resolverFluxoManual,
    renderDivergencias,
    renderRecontagens,
    exportarDivergencias,
    exportarRecontagens
  });

  bindEvents();
})();
