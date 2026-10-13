// Logística › Estoque › Relatórios (Inventário, Descarte, Baixa de
// Requisição, Transformação) — dados vêm de um BigQuery alimentado por
// coleta SÓ-LEITURA (GET) na Bluesoft (ver functions/index.js:
// sincronizarEstoqueBluesoftAgendado/Agora, buscarRelatorioEstoqueBigQuery).
// FASE D (2026-10-02): implementação real das 4 telas — filtros (período
// com atalhos, produto, mostrar estornos), KPIs, agrupamento ("Ver por"),
// tabela ordenável, exportar Excel (SheetJS, já global — ver
// 101-relatorios-bi.js), "Atualizado em" + "Atualizar agora" (admin).
// Busca sempre MANUAL (igual 99-recebimento-retornos-status.js) — nunca
// dispara sozinha ao entrar na tela.
// PEDIDO AO VIVO (2026-10-03), depois dos dados reais aparecerem pela 1ª
// vez: (1) mostrar a DESCRIÇÃO do produto como coluna principal (o código
// vira secundário); (2) clicar num inventário em "Por inventário" entra só
// naquele inventário (drill-down); (3) filtro de produto virou uma lista
// com checkbox (estilo Excel) nos 4 relatórios, em cima do que já foi
// buscado — "não é ficar escrevendo um por um", é selecionar da lista;
// (4) "filtro de loja pra todos" — a tela não fica mais presa na loja ativa
// lá em cima, busca em TODAS as lojas que o login enxerga de uma vez (o
// servidor que decide quais, nunca confia no cliente) e filtra loja com o
// MESMO estilo de lista com checkbox do produto.
// PEDIDO AO VIVO (2026-10-03) #5: "colocar filtro do tipo de lançamento" —
// mesmo estilo Excel dos filtros de produto/loja, sobre a coluna
// tipo_movimento ("Lançamento"), combinando com os outros 2 filtros (AND).
(function (global) {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DIAS_MAX_PERIODO = 366;

  // ── Config de cada relatório — colunas da tabela "por lançamento" e
  // agrupamentos extras disponíveis em "Ver por". Uma chave de coluna com
  // "|" é uma lista de fallback (primeiro valor não-vazio vence) — usado
  // pra mostrar a descrição do produto como principal, caindo pro código
  // só quando a descrição ainda não foi coletada.
  const RELATORIOS = {
    inventario: {
      titulo: '📋 Relatório de Inventário', icone: '📋', pageId: 'page-estoque-rel-inventario',
      colunas: [
        ['loja_nome', 'Loja'], ['data_movimento', 'Data'], ['produto_descricao|produto_key', 'Produto'], ['produto_key', 'Código'],
        ['inventario_numero', 'Inventário'], ['inventario_tipo', 'Tipo Invent.'], ['tipo_movimento', 'Lançamento'],
        ['quantidade_sistema', 'Qtd. Sistema'], ['quantidade_contada', 'Qtd. Contada'],
        ['quantidade', 'Quantidade'], ['valor', 'Valor'], ['eh_estorno', 'Estorno'],
      ],
      agrupamentos: [['lancamento', 'Lançamento'], ['produto', 'Produto'], ['dia', 'Dia'], ['inventario', 'Por inventário']],
    },
    descarte: {
      titulo: '🗑️ Relatório de Descarte', icone: '🗑️', pageId: 'page-estoque-rel-descarte',
      colunas: [
        ['loja_nome', 'Loja'], ['data_movimento', 'Data'], ['produto_descricao|produto_key', 'Produto'], ['produto_key', 'Código'],
        ['nf_numero', 'Nota'], ['cfop', 'CFOP'], ['fornecedor_key', 'Fornecedor'], ['tipo_movimento', 'Lançamento'],
        ['quantidade', 'Quantidade'], ['valor', 'Valor'], ['observacao_saldo', 'Observação'], ['eh_estorno', 'Estorno'],
      ],
      agrupamentos: [['lancamento', 'Lançamento'], ['produto', 'Produto'], ['dia', 'Dia'], ['nota', 'Por nota'], ['fornecedor', 'Por fornecedor']],
    },
    requisicao: {
      titulo: '📤 Relatório de Baixa de Requisição', icone: '📤', pageId: 'page-estoque-rel-requisicao',
      colunas: [
        ['loja_nome', 'Loja'], ['data_movimento', 'Data'], ['produto_descricao|produto_key', 'Produto'], ['produto_key', 'Código'],
        ['nf_numero', 'Nota'], ['tipo_movimento', 'Lançamento'],
        ['quantidade', 'Quantidade'], ['valor', 'Valor'], ['eh_estorno', 'Estorno'],
      ],
      agrupamentos: [['lancamento', 'Lançamento'], ['produto', 'Produto'], ['dia', 'Dia'], ['nota', 'Por nota']],
    },
    transformacao: {
      titulo: '🔄 Relatório de Transformação', icone: '🔄', pageId: 'page-estoque-rel-transformacao', ehTransformacao: true,
      colunas: [
        ['loja_nome', 'Loja'], ['data_movimento', 'Data'],
        ['produto_origem_descricao|produto_origem_key', 'Produto Origem'], ['produto_origem_key', 'Código Origem'],
        ['produto_destino_descricao|produto_destino_key', 'Produto Destino'], ['produto_destino_key', 'Código Destino'],
        ['saida_quantidade', 'Qtd. Saída'], ['entrada_quantidade', 'Qtd. Entrada'],
        ['fator_real', 'Fator Real'], ['fator_transformacao_cadastrado', 'Fator Cadastrado'],
        ['sem_par', 'Sem Par'], ['saida_eh_estorno', 'Estorno'],
      ],
      agrupamentos: [['lancamento', 'Lançamento'], ['produto', 'Produto (destino)'], ['dia', 'Dia'], ['origem', 'Por produto de origem']],
    },
  };

  // Chave composta loja+inventário — com várias lojas de uma vez, o MESMO
  // código de inventário pode existir em lojas diferentes (tenants
  // separados na Bluesoft); sem isso o agrupamento "Por inventário" juntaria
  // coisas de lojas diferentes por engano.
  function _chaveInventario(l) { return (l.loja_id || '') + '|' + (l.inventario_key || ''); }

  // ── Definição de cada agrupamento de "Ver por" (chave/rótulo por linha) ─
  const GRUPOS_CAMPO = {
    produto: {
      chaveDe: (l, cfg) => cfg.ehTransformacao ? l.produto_destino_key : l.produto_key,
      rotuloDe: (l, cfg) => cfg.ehTransformacao ? (l.produto_destino_descricao || l.produto_destino_key) : (l.produto_descricao || l.produto_key),
      rotuloColuna: 'Produto',
    },
    origem: {
      chaveDe: l => l.produto_origem_key,
      rotuloDe: l => l.produto_origem_descricao || l.produto_origem_key,
      rotuloColuna: 'Produto de Origem',
    },
    dia: { chaveDe: l => l.data_movimento, rotuloDe: l => fmtData(l.data_movimento), rotuloColuna: 'Dia' },
    // PEDIDO AO VIVO (2026-10-03): "poderia vim também o nome do
    // inventário" — inventario_numero é só o código mesmo (a Bluesoft não
    // tem um "número" separado), o nome de verdade é inventario_descricao.
    // Com várias lojas junto, o rótulo também leva o nome da loja — senão
    // "INV-001" de 2 lojas diferentes pareceria 1 inventário só.
    inventario: {
      chaveDe: l => _chaveInventario(l),
      rotuloDe: l => {
        const nomeInv = l.inventario_descricao ? (l.inventario_descricao + ' (' + (l.inventario_numero || l.inventario_key) + ')') : (l.inventario_numero || l.inventario_key);
        return l.loja_nome ? (l.loja_nome + ' — ' + nomeInv) : nomeInv;
      },
      rotuloColuna: 'Inventário',
    },
    nota: { chaveDe: l => l.nf_key, rotuloDe: l => l.nf_numero || l.nf_key, rotuloColuna: 'Nota' },
    fornecedor: { chaveDe: l => l.fornecedor_key, rotuloDe: l => l.fornecedor_key || '(sem fornecedor)', rotuloColuna: 'Fornecedor' },
  };

  function _agrupar(cfg, linhas, agrupamentoId) {
    const g = GRUPOS_CAMPO[agrupamentoId];
    if (!g) return null; // 'lancamento' (ou desconhecido) = usa a tabela flat
    const porChave = new Map();
    linhas.forEach(l => {
      const chaveBruta = g.chaveDe(l, cfg);
      const chave = chaveBruta == null || chaveBruta === '' ? '(vazio)' : chaveBruta;
      if (!porChave.has(chave)) {
        porChave.set(chave, cfg.ehTransformacao
          ? { _chave: chave, rotulo: g.rotuloDe(l, cfg) || '(vazio)', lancamentos: 0, saida_quantidade: 0, saida_valor: 0, entrada_quantidade: 0, entrada_valor: 0 }
          : { _chave: chave, rotulo: g.rotuloDe(l, cfg) || '(vazio)', lancamentos: 0, quantidade: 0, valor: 0 });
      }
      const acc = porChave.get(chave);
      acc.lancamentos++;
      if (cfg.ehTransformacao) {
        acc.saida_quantidade += Number(l.saida_quantidade) || 0;
        acc.saida_valor += Number(l.saida_valor) || 0;
        acc.entrada_quantidade += Number(l.entrada_quantidade) || 0;
        acc.entrada_valor += Number(l.entrada_valor) || 0;
      } else {
        acc.quantidade += Number(l.quantidade) || 0;
        acc.valor += Number(l.valor) || 0;
      }
    });
    const colunas = cfg.ehTransformacao
      ? [['rotulo', g.rotuloColuna], ['lancamentos', 'Lançamentos'], ['saida_quantidade', 'Qtd. Saída'], ['saida_valor', 'Valor Saída'], ['entrada_quantidade', 'Qtd. Entrada'], ['entrada_valor', 'Valor Entrada']]
      : [['rotulo', g.rotuloColuna], ['lancamentos', 'Lançamentos'], ['quantidade', 'Quantidade'], ['valor', 'Valor']];
    return { colunas, linhas: [...porChave.values()].sort((a, b) => String(a.rotulo).localeCompare(String(b.rotulo), 'pt-BR')) };
  }

  function fmtData(v) {
    if (!v) return '—';
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : esc(v);
  }
  function fmtDataHora(v) {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return fmtData(v);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtNumero(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  }
  // Resolve uma chave de coluna, que pode ser "campoPrincipal|campoFallback"
  // (ex.: mostrar a descrição do produto, caindo pro código quando a
  // descrição ainda não foi coletada da Bluesoft).
  function _valorColuna(linha, chaveComposta) {
    const chaves = chaveComposta.split('|');
    for (const c of chaves) {
      const v = linha[c];
      if (v != null && v !== '') return v;
    }
    return linha[chaves[0]];
  }
  function _formatarCelula(chaveComposta, valor) {
    const chave = chaveComposta.split('|')[0];
    if (valor == null || valor === '') return '—';
    if (/^data_/.test(chave)) return fmtData(valor);
    if (chave === 'eh_estorno' || chave === 'saida_eh_estorno' || chave === 'sem_par') return valor === true || valor === 'true' ? 'Sim' : 'Não';
    if (/quantidade|^valor$|valor_|custo|fator/.test(chave)) return fmtNumero(valor);
    return esc(valor);
  }

  // ── Estado por relatório (filtros/dados/UI) — independente entre as 4
  // telas, cada uma com seu próprio período/produto/agrupamento ──────────
  const _estado = {};
  function _estadoDe(id) {
    if (!_estado[id]) {
      _estado[id] = {
        periodoInicio: '', periodoFim: '', incluirEstornos: false, agrupamento: 'lancamento',
        // Filtros estilo Excel: null = todos selecionados (sem filtro
        // ainda aplicado); um Set = só essas chaves aparecem. Filtram em
        // cima do que já foi buscado — nunca disparam nova busca.
        produtosSelecionados: null, produtoFiltroAberto: false, produtoFiltroBusca: '',
        lojasSelecionadas: null, lojaFiltroAberto: false,
        lancamentosSelecionados: null, lancamentoFiltroAberto: false,
        // Drill-down: 1 inventário específico selecionado a partir do
        // agrupamento "Por inventário" — só faz sentido no relatório de
        // Inventário, mas existir nos outros não causa efeito nenhum.
        drillInventarioKey: null, drillInventarioRotulo: null,
        linhas: [], ultimaAtualizacao: null,
        carregando: false, erro: '', buscado: '', promiseEmVoo: null, atualizandoAgora: false,
        ordenarCampo: '', ordenarAsc: true,
      };
    }
    return _estado[id];
  }
  function _periodoPadrao() {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - 29 * 86400000);
    return { ini: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
  }
  function _periodoValido(ini, fim) {
    if (!ini || !fim) return false;
    const dIni = new Date(ini + 'T00:00:00'), dFim = new Date(fim + 'T23:59:59');
    if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime()) || dIni > dFim) return false;
    return (dFim - dIni) / 86400000 <= DIAS_MAX_PERIODO;
  }

  function _ehAdmin() {
    const a = global.DT_USUARIO_ACESSO_ATUAL || {};
    return a.admin_mestre === true || a.administrador_mestre === true || a.perfil === 'administrador';
  }
  function podeExportar(relatorioId) {
    return typeof global.temPermissao !== 'function' || global.temPermissao('estoque-rel-' + relatorioId, 'exportar');
  }

  async function carregarDados(relatorioId, forcar) {
    const estado = _estadoDe(relatorioId);
    if (!_periodoValido(estado.periodoInicio, estado.periodoFim)) throw new Error('Escolha um período válido de até ' + DIAS_MAX_PERIODO + ' dias.');
    const chave = [estado.periodoInicio, estado.periodoFim, estado.incluirEstornos].join('|');
    if (estado.buscado === chave && !forcar) return;
    if (estado.promiseEmVoo) return estado.promiseEmVoo;
    estado.promiseEmVoo = (async () => {
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarRelatorioEstoqueBigQuery');
      // PEDIDO AO VIVO (2026-10-03): "filtro de loja pra todos" — nunca
      // manda lojaId; o servidor já devolve todas as lojas que o login
      // enxerga de uma vez (o filtro de loja, igual o de produto, é
      // 100% client-side por cima do que já veio).
      const resposta = await callable({
        relatorio: relatorioId, dataInicial: estado.periodoInicio, dataFinal: estado.periodoFim,
        incluirEstornos: estado.incluirEstornos,
      });
      const dados = (resposta && resposta.data) || {};
      estado.linhas = Array.isArray(dados.linhas) ? dados.linhas : [];
      estado.ultimaAtualizacao = dados.ultimaAtualizacao || null;
      estado.buscado = chave;
      // Dado novo chegou — filtros/drill-down não necessariamente ainda
      // fazem sentido pro novo resultado (códigos diferentes podem nem
      // existir mais).
      estado.produtosSelecionados = null;
      estado.produtoFiltroAberto = false;
      estado.produtoFiltroBusca = '';
      estado.lojasSelecionadas = null;
      estado.lojaFiltroAberto = false;
      estado.lancamentosSelecionados = null;
      estado.lancamentoFiltroAberto = false;
      estado.drillInventarioKey = null;
      estado.drillInventarioRotulo = null;
    })();
    try { await estado.promiseEmVoo; } finally { estado.promiseEmVoo = null; }
  }

  function _aplicarAtalhoPeriodo(relatorioId, dias) {
    const estado = _estadoDe(relatorioId);
    const fim = new Date();
    const inicio = new Date(fim.getTime() - (dias - 1) * 86400000);
    estado.periodoInicio = inicio.toISOString().slice(0, 10);
    estado.periodoFim = fim.toISOString().slice(0, 10);
    _desenhar(relatorioId);
  }

  async function _atualizarDados(relatorioId, forcar) {
    const estado = _estadoDe(relatorioId);
    estado.carregando = true; estado.erro = '';
    _desenhar(relatorioId);
    try { await carregarDados(relatorioId, forcar); } catch (e) { estado.erro = e.message || String(e); }
    estado.carregando = false;
    _desenhar(relatorioId);
  }

  // PEDIDO (plano Fase D): botão admin que chama sincronizarEstoqueBluesoftAgora
  // pro período em tela, repetindo a chamada enquanto concluido=false (a
  // Cloud Function processa um dia por vez dentro do limite de 540s).
  // PEDIDO AO VIVO (2026-10-03): período de até 1 ano pode exigir mais de
  // uma rodada de 540s — bump de 8 pra 20 tentativas (cada rodada já cobre
  // bem mais de 1 dia sozinha; 20 é só margem de segurança) + toast avisando
  // o progresso a cada rodada, já que isso pode levar alguns minutos.
  // PEDIDO AO VIVO (2026-10-03): "vou precisar ficar atualizando várias
  // vezes?" — depois que os MOVIMENTOS terminam, a descrição de produto e
  // os itens de inventário fechado ainda podem levar mais de 1 rodada (vêm
  // em lotes, pra nunca estourar o tempo de 1 chamada só). O servidor avisa
  // via produtosPendentes/inventariosItensPendentes — o botão continua
  // chamando sozinho enquanto qualquer um dos três ainda tiver pendência,
  // até o usuário não precisar clicar de novo manualmente.
  // "filtro de loja pra todos": também não manda mais lojaId — sincroniza
  // TODAS as lojas configuradas de uma vez (o backend já aceita lojaId
  // opcional desde a Fase C, só nunca tinha sido usado assim do cliente).
  async function _atualizarAgora(relatorioId) {
    const estado = _estadoDe(relatorioId);
    if (estado.atualizandoAgora) return;
    if (!_periodoValido(estado.periodoInicio, estado.periodoFim)) { global.showToast?.('Escolha um período válido antes de atualizar.', 'error'); return; }
    estado.atualizandoAgora = true;
    _desenhar(relatorioId);
    const MAX_TENTATIVAS = 20;
    try {
      // PEDIDO AO VIVO (2026-10-03): "Erro ao sincronizar: deadline-exceeded"
      // — o SDK do Firebase desiste de esperar uma chamada depois de ~70s
      // por padrão, bem menos que o orçamento real de 540s da function do
      // servidor (um dia com muitos registros reais pode legitimamente
      // levar mais que isso). `timeout` alinha o cliente com o mesmo
      // orçamento do servidor.
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('sincronizarEstoqueBluesoftAgora', { timeout: 540000 });
      let dataInicial = estado.periodoInicio;
      let concluidoDeVerdade = false;
      let tentativas = 0;
      while (tentativas < MAX_TENTATIVAS) {
        tentativas++;
        global.showToast?.('Sincronizando com a Bluesoft... (' + fmtData(dataInicial) + ' até ' + fmtData(estado.periodoFim) + ')', 'i');
        const resposta = await callable({ dataInicial, dataFinal: estado.periodoFim });
        const r = (resposta && resposta.data) || {};
        if (!r.concluido && r.proximoDia) { dataInicial = r.proximoDia; continue; }
        if (r.produtosPendentes || r.inventariosItensPendentes) continue; // mesmo período — só completa produto/inventário
        concluidoDeVerdade = !!r.concluido;
        break;
      }
      if (concluidoDeVerdade) global.showToast?.('Sincronização com a Bluesoft concluída.', 'success');
      else global.showToast?.('Ainda não terminou — clique em "Atualizar agora" de novo pra continuar de onde parou.', 'i');
      await carregarDados(relatorioId, true);
    } catch (e) {
      global.showToast?.('Erro ao sincronizar: ' + (e.message || e), 'error');
    }
    estado.atualizandoAgora = false;
    _desenhar(relatorioId);
  }

  // ── Filtro de produto estilo Excel (lista com checkbox, em cima do que
  // já foi buscado) ────────────────────────────────────────────────────
  function _produtosDisponiveis(cfg, linhas) {
    const mapa = new Map();
    linhas.forEach(l => {
      if (cfg.ehTransformacao) {
        if (l.produto_origem_key) mapa.set(String(l.produto_origem_key), l.produto_origem_descricao || l.produto_origem_key);
        if (l.produto_destino_key) mapa.set(String(l.produto_destino_key), l.produto_destino_descricao || l.produto_destino_key);
      } else if (l.produto_key) {
        mapa.set(String(l.produto_key), l.produto_descricao || l.produto_key);
      }
    });
    return [...mapa.entries()].map(([key, rotulo]) => ({ key, rotulo: String(rotulo) })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  }
  // null = sem filtro (mostra tudo) — nunca precisa materializar o Set
  // inteiro só pra "selecionar todos".
  function _linhasFiltradasPorProduto(cfg, linhas, selecionados) {
    if (!selecionados) return linhas;
    return linhas.filter(l => cfg.ehTransformacao
      ? selecionados.has(String(l.produto_origem_key)) || selecionados.has(String(l.produto_destino_key))
      : selecionados.has(String(l.produto_key)));
  }
  // ── Filtro de loja estilo Excel — PEDIDO AO VIVO (2026-10-03) ───────────
  function _lojasDisponiveis(linhas) {
    const mapa = new Map();
    linhas.forEach(l => { if (l.loja_id) mapa.set(String(l.loja_id), l.loja_nome || l.loja_id); });
    return [...mapa.entries()].map(([key, rotulo]) => ({ key, rotulo: String(rotulo) })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  }
  function _linhasFiltradasPorLoja(linhas, selecionados) {
    if (!selecionados) return linhas;
    return linhas.filter(l => selecionados.has(String(l.loja_id)));
  }
  // ── Filtro de tipo de lançamento estilo Excel — PEDIDO AO VIVO
  // (2026-10-03): coluna "Lançamento" (tipo_movimento) com muitos valores
  // distintos (Troca Descarte (Perda), Descarte de Troca de Produto...) —
  // mesmo padrão de lista com checkbox do produto/loja. Transformação não
  // tem essa coluna (campo não existe na view) — a lista fica vazia e o
  // botão aparece desabilitado, sem precisar de tratamento especial.
  function _lancamentosDisponiveis(linhas) {
    const mapa = new Map();
    linhas.forEach(l => { if (l.tipo_movimento) mapa.set(String(l.tipo_movimento), l.tipo_movimento); });
    return [...mapa.entries()].map(([key, rotulo]) => ({ key, rotulo: String(rotulo) })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  }
  function _linhasFiltradasPorLancamento(linhas, selecionados) {
    if (!selecionados) return linhas;
    return linhas.filter(l => selecionados.has(String(l.tipo_movimento)));
  }
  function _kpisDeLinhas(cfg, linhas) {
    const campoQtd = cfg.ehTransformacao ? 'saida_quantidade' : 'quantidade';
    const campoValor = cfg.ehTransformacao ? 'saida_valor' : 'valor';
    const campoProduto = cfg.ehTransformacao ? 'produto_origem_key' : 'produto_key';
    const produtosDistintos = new Set();
    let somaQtd = 0, somaValor = 0;
    linhas.forEach(l => {
      somaQtd += Number(l[campoQtd]) || 0;
      somaValor += Number(l[campoValor]) || 0;
      if (l[campoProduto]) produtosDistintos.add(l[campoProduto]);
    });
    return { lancamentos: linhas.length, quantidade: somaQtd, valor: somaValor, produtosDistintos: produtosDistintos.size };
  }

  function _exportarExcel(relatorioId) {
    const cfg = RELATORIOS[relatorioId];
    const estado = _estadoDe(relatorioId);
    if (!global.XLSX) { global.showToast?.('Exportação indisponível (biblioteca não carregada).', 'error'); return; }
    let linhasBase = _linhasFiltradasPorLancamento(_linhasFiltradasPorLoja(_linhasFiltradasPorProduto(cfg, estado.linhas, estado.produtosSelecionados), estado.lojasSelecionadas), estado.lancamentosSelecionados);
    if (estado.drillInventarioKey) linhasBase = linhasBase.filter(l => _chaveInventario(l) === estado.drillInventarioKey);
    const agrupado = estado.drillInventarioKey ? null : _agrupar(cfg, linhasBase, estado.agrupamento);
    const colunas = agrupado ? agrupado.colunas : cfg.colunas;
    const linhas = agrupado ? agrupado.linhas : linhasBase;
    if (!linhas.length) { global.showToast?.('Nenhuma linha pra exportar (busque ou ajuste os filtros).', 'error'); return; }
    const linhasExcel = linhas.map(l => {
      const obj = {};
      colunas.forEach(([chave, rotulo]) => { obj[rotulo] = _valorColuna(l, chave) ?? ''; });
      return obj;
    });
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(linhasExcel), cfg.titulo.replace(/[^\w ]/g, '').trim().slice(0, 31));
    global.XLSX.writeFile(wb, 'estoque_' + relatorioId + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  function _ordenar(linhas, campo, asc) {
    if (!campo) return linhas;
    const copia = linhas.slice();
    copia.sort((a, b) => {
      const va = _valorColuna(a, campo), vb = _valorColuna(b, campo);
      const na = Number(va), nb = Number(vb);
      let cmp;
      if (Number.isFinite(na) && Number.isFinite(nb) && va !== '' && vb !== '') cmp = na - nb;
      else cmp = String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'pt-BR');
      return asc ? cmp : -cmp;
    });
    return copia;
  }

  const LIMITE_LINHAS_TELA = 1000;

  function _kpisHtml(t) {
    return `<div style="display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;margin:12px 0 4px">
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">LANÇAMENTOS</div><div style="font-size:1.4rem;font-weight:850">${t.lancamentos}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">QUANTIDADE</div><div style="font-size:1.4rem;font-weight:850">${fmtNumero(t.quantidade)}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">VALOR</div><div style="font-size:1.4rem;font-weight:850">R$ ${fmtNumero(t.valor)}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">PRODUTOS DISTINTOS</div><div style="font-size:1.4rem;font-weight:850">${t.produtosDistintos}</div></div>
    </div>`;
  }

  // ── Filtro em dropdown genérico (lista com checkbox, estilo Excel) ──────
  // Reaproveitado por produto E por loja — só muda a fonte dos itens
  // disponíveis, o texto do botão e os atributos data-* usados.
  function _dropdownListaHtml(prefixo, visiveis, selecionados) {
    if (!visiveis.length) return '<div style="color:var(--muted);font-size:.76rem;padding:6px 2px">Nenhum item encontrado</div>';
    return visiveis.map(p => `<label style="display:flex;align-items:center;gap:6px;padding:3px 2px;font-size:.78rem;cursor:pointer">
      <input type="checkbox" data-estoque-filtro-${prefixo}-item="${esc(p.key)}" ${(selecionados === null || selecionados.has(p.key)) ? 'checked' : ''}>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.rotulo)}">${esc(p.rotulo)}</span>
    </label>`).join('');
  }
  function _filtroProdutoListaHtml(visiveis, selecionados) { return _dropdownListaHtml('produto', visiveis, selecionados); }
  function _filtroLojaListaHtml(visiveis, selecionados) { return _dropdownListaHtml('loja', visiveis, selecionados); }
  function _filtroLancamentoListaHtml(visiveis, selecionados) { return _dropdownListaHtml('lancamento', visiveis, selecionados); }

  function _filtroProdutoHtml(cfg, estado) {
    const disponiveis = _produtosDisponiveis(cfg, estado.linhas);
    const selecionados = estado.produtosSelecionados;
    const totalSelecionados = selecionados === null ? disponiveis.length : selecionados.size;
    const busca = (estado.produtoFiltroBusca || '').toLowerCase();
    const visiveis = busca ? disponiveis.filter(p => p.rotulo.toLowerCase().includes(busca) || p.key.toLowerCase().includes(busca)) : disponiveis;
    const rotuloBotao = disponiveis.length === 0 ? 'Nenhum produto ainda'
      : totalSelecionados === disponiveis.length ? 'Todos os produtos (' + disponiveis.length + ')'
      : totalSelecionados + ' de ' + disponiveis.length + ' selecionado(s)';
    return `<div style="position:relative">
      <div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">PRODUTO</div>
      <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-produto-toggle style="padding:8px 12px;min-width:190px;text-align:left" ${disponiveis.length === 0 ? 'disabled' : ''}>🔍 ${esc(rotuloBotao)} ▾</button>
      ${estado.produtoFiltroAberto ? `<div style="position:absolute;z-index:20;top:100%;left:0;margin-top:4px;background:var(--bg-card,#fff);color:inherit;border:1px solid var(--border,#d1d5db);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.18);width:300px;padding:8px">
        <input type="text" data-estoque-filtro-produto-busca placeholder="Buscar produto ou código..." value="${esc(estado.produtoFiltroBusca || '')}" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid var(--border,#d1d5db);border-radius:6px;font-size:.8rem;box-sizing:border-box">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-produto-todos style="flex:1;font-size:.72rem;padding:4px">Selecionar todos</button>
          <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-produto-limpar style="flex:1;font-size:.72rem;padding:4px">Limpar</button>
        </div>
        <div data-estoque-filtro-produto-lista style="max-height:240px;overflow:auto;border-top:1px solid var(--border,#e5e7eb);padding-top:4px">${_filtroProdutoListaHtml(visiveis, selecionados)}</div>
        <button type="button" class="btn btn-primary btn-sm" data-estoque-filtro-produto-fechar style="width:100%;margin-top:6px;padding:5px">Aplicar</button>
      </div>` : ''}
    </div>`;
  }
  // PEDIDO AO VIVO (2026-10-03): "filtro de loja pra todos" — mesmo estilo
  // do filtro de produto, sem campo de busca (lista de lojas costuma ser
  // bem menor que a de produtos, não precisa).
  function _filtroLojaHtml(estado) {
    const disponiveis = _lojasDisponiveis(estado.linhas);
    const selecionados = estado.lojasSelecionadas;
    const totalSelecionados = selecionados === null ? disponiveis.length : selecionados.size;
    const rotuloBotao = disponiveis.length === 0 ? 'Nenhuma loja ainda'
      : totalSelecionados === disponiveis.length ? 'Todas as lojas (' + disponiveis.length + ')'
      : totalSelecionados + ' de ' + disponiveis.length + ' selecionada(s)';
    return `<div style="position:relative">
      <div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">LOJA</div>
      <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-loja-toggle style="padding:8px 12px;min-width:170px;text-align:left" ${disponiveis.length === 0 ? 'disabled' : ''}>🏬 ${esc(rotuloBotao)} ▾</button>
      ${estado.lojaFiltroAberto ? `<div style="position:absolute;z-index:20;top:100%;left:0;margin-top:4px;background:var(--bg-card,#fff);color:inherit;border:1px solid var(--border,#d1d5db);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.18);width:240px;padding:8px">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-loja-todos style="flex:1;font-size:.72rem;padding:4px">Selecionar todas</button>
          <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-loja-limpar style="flex:1;font-size:.72rem;padding:4px">Limpar</button>
        </div>
        <div data-estoque-filtro-loja-lista style="max-height:220px;overflow:auto;border-top:1px solid var(--border,#e5e7eb);padding-top:4px">${_filtroLojaListaHtml(disponiveis, selecionados)}</div>
        <button type="button" class="btn btn-primary btn-sm" data-estoque-filtro-loja-fechar style="width:100%;margin-top:6px;padding:5px">Aplicar</button>
      </div>` : ''}
    </div>`;
  }

  // PEDIDO AO VIVO (2026-10-03): "colocar filtro do tipo de lançamento" —
  // mesmo estilo do filtro de loja (sem busca, lista costuma ser curta).
  function _filtroLancamentoHtml(estado) {
    const disponiveis = _lancamentosDisponiveis(estado.linhas);
    const selecionados = estado.lancamentosSelecionados;
    const totalSelecionados = selecionados === null ? disponiveis.length : selecionados.size;
    const rotuloBotao = disponiveis.length === 0 ? 'Nenhum lançamento ainda'
      : totalSelecionados === disponiveis.length ? 'Todos os lançamentos (' + disponiveis.length + ')'
      : totalSelecionados + ' de ' + disponiveis.length + ' selecionado(s)';
    return `<div style="position:relative">
      <div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">LANÇAMENTO</div>
      <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-lancamento-toggle style="padding:8px 12px;min-width:190px;text-align:left" ${disponiveis.length === 0 ? 'disabled' : ''}>🏷️ ${esc(rotuloBotao)} ▾</button>
      ${estado.lancamentoFiltroAberto ? `<div style="position:absolute;z-index:20;top:100%;left:0;margin-top:4px;background:var(--bg-card,#fff);color:inherit;border:1px solid var(--border,#d1d5db);border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.18);width:280px;padding:8px">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-lancamento-todos style="flex:1;font-size:.72rem;padding:4px">Selecionar todos</button>
          <button type="button" class="btn btn-ghost btn-sm" data-estoque-filtro-lancamento-limpar style="flex:1;font-size:.72rem;padding:4px">Limpar</button>
        </div>
        <div data-estoque-filtro-lancamento-lista style="max-height:260px;overflow:auto;border-top:1px solid var(--border,#e5e7eb);padding-top:4px">${_filtroLancamentoListaHtml(disponiveis, selecionados)}</div>
        <button type="button" class="btn btn-primary btn-sm" data-estoque-filtro-lancamento-fechar style="width:100%;margin-top:6px;padding:5px">Aplicar</button>
      </div>` : ''}
    </div>`;
  }

  function _filtrosHtml(relatorioId, cfg, estado) {
    return `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:10px 0">
      <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">PERÍODO — DE</div><input type="date" class="field" data-estoque-periodo-ini value="${esc(estado.periodoInicio)}" style="padding:8px"></div>
      <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input type="date" class="field" data-estoque-periodo-fim value="${esc(estado.periodoFim)}" style="padding:8px"></div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" data-estoque-atalho="7">7 dias</button>
        <button class="btn btn-ghost btn-sm" data-estoque-atalho="30">30 dias</button>
        <button class="btn btn-ghost btn-sm" data-estoque-atalho="90">90 dias</button>
        <button class="btn btn-ghost btn-sm" data-estoque-atalho="366">Ano</button>
      </div>
      ${_filtroLojaHtml(estado)}
      ${_filtroProdutoHtml(cfg, estado)}
      ${_filtroLancamentoHtml(estado)}
      <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;padding-bottom:9px"><input type="checkbox" data-estoque-estornos ${estado.incluirEstornos ? 'checked' : ''}> Mostrar estornos</label>
      <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">VER POR</div><select class="field" data-estoque-agrupamento style="padding:8px">
        ${cfg.agrupamentos.map(([id, label]) => `<option value="${id}" ${id === estado.agrupamento ? 'selected' : ''}>${esc(label)}</option>`).join('')}
      </select></div>
      <button class="btn btn-primary btn-sm" data-estoque-buscar style="padding:8px 14px">🔍 Buscar</button>
      ${podeExportar(relatorioId) ? `<button class="btn btn-ghost btn-sm" data-estoque-exportar style="padding:8px 14px">⬇️ Exportar Excel</button>` : ''}
      <div style="font-size:.64rem;color:var(--muted);align-self:center">Máx. ${DIAS_MAX_PERIODO} dias</div>
    </div>`;
  }

  function _atualizadoEmHtml(relatorioId, estado) {
    const texto = !estado.ultimaAtualizacao ? 'nunca sincronizado'
      : /^\d{4}-\d{2}-\d{2}$/.test(estado.ultimaAtualizacao) ? 'dados até ' + fmtData(estado.ultimaAtualizacao)
      : fmtDataHora(estado.ultimaAtualizacao);
    const botaoAdmin = _ehAdmin()
      ? `<button class="btn btn-ghost btn-sm" data-estoque-atualizar-agora ${estado.atualizandoAgora ? 'disabled' : ''} style="padding:5px 10px">${estado.atualizandoAgora ? '🔄 Sincronizando…' : '↻ Atualizar agora'}</button>`
      : '';
    return `<div style="display:flex;align-items:center;gap:10px;font-size:.72rem;color:var(--muted);margin-top:6px">
      <span>Atualizado em: ${esc(texto)}</span>${botaoAdmin}
    </div>`;
  }

  function _statusCarregandoHtml(estado) {
    if (estado.carregando) return '<div style="font-size:.76rem;color:var(--muted);margin:8px 0">🔄 Buscando...</div>';
    if (estado.erro) return '<div style="font-size:.76rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;gap:10px"><span>⚠️ Não foi possível buscar: ' + esc(estado.erro) + '</span><button type="button" class="btn btn-ghost btn-sm" data-estoque-tentar-de-novo="1">Tentar de novo</button></div>';
    return '';
  }

  // Monta só o <table> (cabeçalho ordenável + corpo) — reaproveitado tanto
  // pela visão normal (agrupada ou flat) quanto pelo drill-down de 1
  // inventário específico.
  function _tabelaBaseHtml(colunas, linhas, estado, linhaAtributos) {
    const total = linhas.length;
    const limitadas = linhas.slice(0, LIMITE_LINHAS_TELA);
    const aviso = total > LIMITE_LINHAS_TELA ? `<div style="font-size:.7rem;color:var(--muted);margin:6px 0">Mostrando as primeiras ${LIMITE_LINHAS_TELA} de ${total} linhas — refine o período ou o produto para ver o restante (a exportação em Excel leva as ${total} linhas inteiras).</div>` : '';
    return `${aviso}<div style="overflow:auto"><table class="dt-table"><thead><tr>${colunas.map(([chave, rotulo]) => `<th style="cursor:pointer" data-estoque-ordenar="${esc(chave)}">${esc(rotulo)}${estado.ordenarCampo === chave ? (estado.ordenarAsc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${limitadas.map(l => `<tr${linhaAtributos ? linhaAtributos(l) : ''}>${colunas.map(([chave]) => `<td>${_formatarCelula(chave, _valorColuna(l, chave))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function _tabelaHtml(relatorioId, cfg, estado, linhasFiltradas) {
    if (!estado.buscado) return '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">Escolha o período e clique em Buscar</div></div>';
    if (!estado.linhas.length) return '<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">Nenhum lançamento com esses filtros</div></div>';
    if (!linhasFiltradas.length) return '<div class="empty"><div class="empty-icon">🔎</div><div class="empty-title">Nenhum lançamento com os filtros de produto/loja/lançamento selecionados</div></div>';

    // PEDIDO AO VIVO (2026-10-03): drill-down — clicou num inventário no
    // agrupamento "Por inventário", mostra só os lançamentos daquele
    // (mesma loja + mesmo código de inventário).
    if (estado.drillInventarioKey) {
      const linhasDrill = _ordenar(linhasFiltradas.filter(l => _chaveInventario(l) === estado.drillInventarioKey), estado.ordenarCampo, estado.ordenarAsc);
      const cabecalho = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost btn-sm" data-estoque-voltar-drill>← Voltar pro agrupamento</button>
        <b>Inventário: ${esc(estado.drillInventarioRotulo || estado.drillInventarioKey)}</b>
        <span style="color:var(--muted);font-size:.75rem">${linhasDrill.length} lançamento(s)</span>
      </div>`;
      if (!linhasDrill.length) return cabecalho + '<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">Nenhum lançamento nesse inventário com os filtros atuais</div></div>';
      return cabecalho + _tabelaBaseHtml(cfg.colunas, linhasDrill, estado);
    }

    const agrupado = _agrupar(cfg, linhasFiltradas, estado.agrupamento);
    const colunas = agrupado ? agrupado.colunas : cfg.colunas;
    let linhas = agrupado ? agrupado.linhas : linhasFiltradas;
    linhas = _ordenar(linhas, estado.ordenarCampo, estado.ordenarAsc);
    // PEDIDO AO VIVO (2026-10-03): no agrupamento "Por inventário", cada
    // linha da tabela vira um link clicável pro drill-down.
    const clicavelInventario = agrupado && estado.agrupamento === 'inventario';
    const atributos = clicavelInventario
      ? (l => ` data-estoque-drill-inventario="${esc(l._chave)}" data-estoque-drill-rotulo="${esc(l.rotulo)}" style="cursor:pointer" title="Clique pra ver só este inventário"`)
      : null;
    return _tabelaBaseHtml(colunas, linhas, estado, atributos);
  }

  function _desenhar(relatorioId) {
    const cfg = RELATORIOS[relatorioId];
    const estado = _estadoDe(relatorioId);
    const pagina = document.getElementById(cfg.pageId);
    if (!pagina) return;
    const linhasFiltradas = _linhasFiltradasPorLancamento(_linhasFiltradasPorLoja(_linhasFiltradasPorProduto(cfg, estado.linhas, estado.produtosSelecionados), estado.lojasSelecionadas), estado.lancamentosSelecionados);
    const kpis = _kpisDeLinhas(cfg, linhasFiltradas);
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">${esc(cfg.titulo)}</h2>${_atualizadoEmHtml(relatorioId, estado)}</div>
        <button class="btn btn-ghost" data-estoque-recarregar>↻ Atualizar</button>
      </div>
      ${_statusCarregandoHtml(estado)}
      ${_kpisHtml(kpis)}
      <div class="tc" style="padding:16px">
        ${_filtrosHtml(relatorioId, cfg, estado)}
        <div data-estoque-tabela>${_tabelaHtml(relatorioId, cfg, estado, linhasFiltradas)}</div>
      </div>`;

    if (!pagina._estoqueListenerBound) {
      pagina.addEventListener('click', ev => {
        const atalho = ev.target.closest('[data-estoque-atalho]');
        if (atalho) { _aplicarAtalhoPeriodo(relatorioId, Number(atalho.dataset.estoqueAtalho)); return; }
        if (ev.target.closest('[data-estoque-buscar]')) {
          const e = _estadoDe(relatorioId);
          if (!_periodoValido(e.periodoInicio, e.periodoFim)) { global.showToast?.('Escolha um período válido de até ' + DIAS_MAX_PERIODO + ' dias.', 'error'); return; }
          _atualizarDados(relatorioId, true);
          return;
        }
        if (ev.target.closest('[data-estoque-recarregar]') || ev.target.closest('[data-estoque-tentar-de-novo]')) { _atualizarDados(relatorioId, true); return; }
        if (ev.target.closest('[data-estoque-exportar]')) { _exportarExcel(relatorioId); return; }
        if (ev.target.closest('[data-estoque-atualizar-agora]')) { _atualizarAgora(relatorioId); return; }
        if (ev.target.closest('[data-estoque-filtro-produto-toggle]')) {
          const e = _estadoDe(relatorioId);
          e.produtoFiltroAberto = !e.produtoFiltroAberto;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-produto-todos]')) {
          const e = _estadoDe(relatorioId);
          e.produtosSelecionados = null;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-produto-limpar]')) {
          const e = _estadoDe(relatorioId);
          e.produtosSelecionados = new Set();
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-produto-fechar]')) {
          const e = _estadoDe(relatorioId);
          e.produtoFiltroAberto = false;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-loja-toggle]')) {
          const e = _estadoDe(relatorioId);
          e.lojaFiltroAberto = !e.lojaFiltroAberto;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-loja-todos]')) {
          const e = _estadoDe(relatorioId);
          e.lojasSelecionadas = null;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-loja-limpar]')) {
          const e = _estadoDe(relatorioId);
          e.lojasSelecionadas = new Set();
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-loja-fechar]')) {
          const e = _estadoDe(relatorioId);
          e.lojaFiltroAberto = false;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-lancamento-toggle]')) {
          const e = _estadoDe(relatorioId);
          e.lancamentoFiltroAberto = !e.lancamentoFiltroAberto;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-lancamento-todos]')) {
          const e = _estadoDe(relatorioId);
          e.lancamentosSelecionados = null;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-lancamento-limpar]')) {
          const e = _estadoDe(relatorioId);
          e.lancamentosSelecionados = new Set();
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-filtro-lancamento-fechar]')) {
          const e = _estadoDe(relatorioId);
          e.lancamentoFiltroAberto = false;
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.closest('[data-estoque-voltar-drill]')) {
          const e = _estadoDe(relatorioId);
          e.drillInventarioKey = null; e.drillInventarioRotulo = null;
          _desenhar(relatorioId);
          return;
        }
        const trDrill = ev.target.closest('[data-estoque-drill-inventario]');
        if (trDrill) {
          const e = _estadoDe(relatorioId);
          e.drillInventarioKey = trDrill.dataset.estoqueDrillInventario;
          e.drillInventarioRotulo = trDrill.dataset.estoqueDrillRotulo;
          e.ordenarCampo = '';
          _desenhar(relatorioId);
          return;
        }
        const th = ev.target.closest('[data-estoque-ordenar]');
        if (th) {
          const e = _estadoDe(relatorioId);
          const campo = th.dataset.estoqueOrdenar;
          if (e.ordenarCampo === campo) e.ordenarAsc = !e.ordenarAsc; else { e.ordenarCampo = campo; e.ordenarAsc = true; }
          _desenhar(relatorioId);
        }
      });
      pagina.addEventListener('change', ev => {
        const e = _estadoDe(relatorioId);
        if (ev.target.hasAttribute('data-estoque-periodo-ini') || ev.target.hasAttribute('data-estoque-periodo-fim')) {
          e.periodoInicio = pagina.querySelector('[data-estoque-periodo-ini]')?.value || '';
          e.periodoFim = pagina.querySelector('[data-estoque-periodo-fim]')?.value || '';
          _desenhar(relatorioId);
          return;
        }
        if (ev.target.hasAttribute('data-estoque-estornos')) { e.incluirEstornos = !!ev.target.checked; return; }
        if (ev.target.hasAttribute('data-estoque-agrupamento')) {
          e.agrupamento = ev.target.value; e.ordenarCampo = '';
          e.drillInventarioKey = null; e.drillInventarioRotulo = null;
          _desenhar(relatorioId);
          return;
        }
        const chkProduto = ev.target.closest('[data-estoque-filtro-produto-item]');
        if (chkProduto) {
          const cfgR = RELATORIOS[relatorioId];
          const disponiveis = _produtosDisponiveis(cfgR, e.linhas).map(p => p.key);
          let sel = e.produtosSelecionados;
          if (sel === null) sel = new Set(disponiveis); // materializa "todos" antes de tirar/marcar 1
          const key = chkProduto.dataset.estoqueFiltroProdutoItem;
          if (chkProduto.checked) sel.add(key); else sel.delete(key);
          e.produtosSelecionados = sel;
          _desenhar(relatorioId);
          return;
        }
        const chkLoja = ev.target.closest('[data-estoque-filtro-loja-item]');
        if (chkLoja) {
          const disponiveis = _lojasDisponiveis(e.linhas).map(p => p.key);
          let sel = e.lojasSelecionadas;
          if (sel === null) sel = new Set(disponiveis);
          const key = chkLoja.dataset.estoqueFiltroLojaItem;
          if (chkLoja.checked) sel.add(key); else sel.delete(key);
          e.lojasSelecionadas = sel;
          _desenhar(relatorioId);
          return;
        }
        const chkLancamento = ev.target.closest('[data-estoque-filtro-lancamento-item]');
        if (chkLancamento) {
          const disponiveis = _lancamentosDisponiveis(e.linhas).map(p => p.key);
          let sel = e.lancamentosSelecionados;
          if (sel === null) sel = new Set(disponiveis);
          const key = chkLancamento.dataset.estoqueFiltroLancamentoItem;
          if (chkLancamento.checked) sel.add(key); else sel.delete(key);
          e.lancamentosSelecionados = sel;
          _desenhar(relatorioId);
          return;
        }
      });
      // Busca dentro do dropdown de produto: atualiza só a LISTA de
      // checkboxes (não a tela inteira), pra não perder o foco do campo de
      // texto a cada letra. Loja não tem busca (lista costuma ser curta).
      pagina.addEventListener('input', ev => {
        const buscaInput = ev.target.closest('[data-estoque-filtro-produto-busca]');
        if (buscaInput) {
          const e = _estadoDe(relatorioId);
          e.produtoFiltroBusca = buscaInput.value || '';
          const cfgR = RELATORIOS[relatorioId];
          const disponiveis = _produtosDisponiveis(cfgR, e.linhas);
          const busca = e.produtoFiltroBusca.toLowerCase();
          const visiveis = busca ? disponiveis.filter(p => p.rotulo.toLowerCase().includes(busca) || p.key.toLowerCase().includes(busca)) : disponiveis;
          const listaEl = pagina.querySelector('[data-estoque-filtro-produto-lista]');
          if (listaEl) listaEl.innerHTML = _filtroProdutoListaHtml(visiveis, e.produtosSelecionados);
          return;
        }
      });
      pagina._estoqueListenerBound = true;
    }
  }


  // ═══════════════════════════════════════════════════════════════════════
  // ANÁLISE GERAL DE INVENTÁRIOS — dashboard histórico + drill-down
  // ═══════════════════════════════════════════════════════════════════════
  const ANALISE_RELEASE_ESPERADO = '20261005-v7-carregamento-rapido';
  const _analiseEstado = {
    carregando: false, erro: '', carregado: false, atualizadoEm: null, releaseBackend: null, revalidacaoHistorico: null,
    inventarios: [], produtos: [], historicoProdutos: [], lojas: [],
    buscaProduto: '', produtoAberto: null,
    filtros: {lojaId:'', dataInicio:'', dataFim:''},
    detalhe: {carregando:false, erro:'', inventario:null, itens:[]},
    charts: [], detalheCharts: [],
  };

  function _n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
  function _pct(v) { return _n(v).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '%'; }
  function _money(v) { return 'R$ ' + _n(v).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
  function _qty(v) { return _n(v).toLocaleString('pt-BR', {minimumFractionDigits: 0, maximumFractionDigits: 2}); }
  function _dataAnalise(v) { return fmtData(v && String(v).slice(0, 10)); }
  function _nomeInventario(x) {
    const base = x.inventario_descricao || x.inventario_numero || x.inventario_key || 'Inventário';
    const cod = x.inventario_descricao && (x.inventario_numero || x.inventario_key) ? ' (' + (x.inventario_numero || x.inventario_key) + ')' : '';
    return base + cod;
  }
  function _destruirCharts(lista) {
    (lista || []).forEach(c => { try { c.destroy(); } catch (_) {} });
    lista.length = 0;
  }
  function _chart(id, config, detalhe) {
    if (!global.Chart) return null;
    const el = document.getElementById(id); if (!el) return null;
    const c = new global.Chart(el, config);
    (detalhe ? _analiseEstado.detalheCharts : _analiseEstado.charts).push(c);
    return c;
  }
  function _corAcuracidade(v) { return _n(v) >= 98 ? '#15803d' : _n(v) >= 95 ? '#b45309' : '#b91c1c'; }
  function _periodoTexto() {
    const f = _analiseEstado.filtros;
    if (!f.dataInicio && !f.dataFim) return 'Todo o histórico';
    if (f.dataInicio && f.dataFim) return _dataAnalise(f.dataInicio) + ' a ' + _dataAnalise(f.dataFim);
    if (f.dataInicio) return 'A partir de ' + _dataAnalise(f.dataInicio);
    return 'Até ' + _dataAnalise(f.dataFim);
  }

  function _parametrosDetalheInventarioDaUrl() {
    const h = String(global.location.hash || '').replace(/^#\/?/, '');
    const partes = h.split('?');
    const params = new URLSearchParams(partes[1] || '');
    return {inventarioKey: params.get('inventario') || '', lojaId: params.get('loja') || ''};
  }
  function _popupDetalheHtmlBase(titulo, corpo) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo||'Análise do Inventário')}</title><link rel="stylesheet" href="/css/analista.css?v=20261001-foto-volta-sem-moldura"><script src="/vendor/chartjs-4.4.4/chart.umd.min.js"><\/script><style>html,body{margin:0;min-height:100%;background:var(--bg,#f5f7f8);font-family:'Plus Jakarta Sans',Arial,sans-serif}body{overflow-y:auto}.popup-wrap{min-height:100vh;background:var(--bg,#f5f7f8)}.popup-loading{min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--text,#1f2937)}.popup-loading .ico{font-size:2rem;margin-bottom:10px}.popup-loading-logo{display:block;width:150px;max-width:38vw;height:auto;margin:0 auto 16px;animation:dtLoadingLogoPulse 1.6s ease-in-out infinite;transform-origin:center center;will-change:filter,opacity,transform}.popup-loading-title{font-weight:700}.popup-loading-subtitle{font-size:.78rem;color:#64748b;margin-top:6px}@keyframes dtLoadingLogoPulse{0%,100%{opacity:.62;filter:brightness(.72) saturate(.9);transform:scale(.985)}50%{opacity:1;filter:brightness(1.22) saturate(1.08);transform:scale(1.025)}}@media (prefers-reduced-motion:reduce){.popup-loading-logo{animation:none;opacity:1;filter:none;transform:none}}.dt-table{width:100%}</style></head><body><div class="popup-wrap">${corpo||''}</div></body></html>`;
  }

  function _renderizarChartsPopup(win) {
    if (!win || win.closed || !win.Chart) return;
    const d = _analiseEstado.detalhe;
    if (!(d && d.inventario && !d.carregando && !d.erro)) return;
    const i = d.inventario, it = d.itens || [];
    const c1 = win.document.getElementById('estoque-chart-detalhe-status');
    if (c1) new win.Chart(c1, {type:'doughnut',data:{labels:['Corretos','Perda','Ganho'],datasets:[{data:[_n(i.produtos_corretos),_n(i.produtos_perda),_n(i.produtos_ganho)],backgroundColor:['#16a34a','#dc2626','#2563eb']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});
    const imp = it.filter(x=>Math.abs(_n(x.diferenca_valor))>0).sort((a,b)=>Math.abs(_n(b.diferenca_valor))-Math.abs(_n(a.diferenca_valor))).slice(0,10);
    const c2 = win.document.getElementById('estoque-chart-detalhe-impacto');
    if (c2) new win.Chart(c2, {type:'bar',data:{labels:imp.map(x=>String(x.produto_descricao||x.produto_key).slice(0,30)),datasets:[{label:'Impacto (R$)',data:imp.map(x=>_n(x.diferenca_valor)),backgroundColor:imp.map(x=>_n(x.diferenca_valor)<0?'rgba(185,28,28,.78)':'rgba(21,128,61,.78)')}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}}}});
  }

  function _renderizarPopupDetalhe(win) {
    if (!win || win.closed) return;
    const d = _analiseEstado.detalhe || {};
    let corpo = _detalheInventarioHtml();
    corpo = corpo.replace(/Fechar aba/g, 'Fechar janela');
    const titulo = d.inventario ? ('Inventário ' + _nomeInventario(d.inventario)) : 'Análise do Inventário';
    try {
      win.document.open();
      win.document.write(_popupDetalheHtmlBase(titulo, corpo));
      win.document.close();
      win.document.addEventListener('click', function(ev){ if(ev.target.closest('[data-estoque-detalhe-fechar]')) win.close(); });
      let tentativas = 0;
      const t = win.setInterval(function(){
        tentativas++;
        if (win.closed) { try { win.clearInterval(t); } catch (_) {} return; }
        if (win.Chart) { try { win.clearInterval(t); } catch (_) {}; _renderizarChartsPopup(win); }
        else if (tentativas > 80) { try { win.clearInterval(t); } catch (_) {} }
      }, 50);
      try { win.focus(); } catch (_) {}
    } catch (e) {
      try { win.document.body.innerHTML = '<div style="padding:24px;font-family:Arial;color:#b91c1c">Não foi possível montar a análise: ' + esc(e && e.message ? e.message : e) + '</div>'; } catch (_) {}
    }
  }

  function _irParaTelaDetalheInventario(inv) {
    if (!inv || inv.inventario_key == null) return;

    // V10: abre uma JANELA separada do navegador (popup), como no Bluesoft.
    // Ela nasce em about:blank no mesmo domínio da página atual e recebe os dados
    // da sessão já aberta; por isso não passa novamente pela tela de login.
    const sw = (global.screen && global.screen.availWidth) || 1440;
    const sh = (global.screen && global.screen.availHeight) || 900;
    const w = Math.max(980, Math.min(1450, Math.round(sw * 0.88)));
    const h = Math.max(700, Math.min(920, Math.round(sh * 0.88)));
    const left = Math.max(0, Math.round(((global.screenX || 0) + (global.outerWidth || sw) / 2) - w / 2));
    const top = Math.max(0, Math.round(((global.screenY || 0) + (global.outerHeight || sh) / 2) - h / 2));
    const nomeJanela = 'dtInventarioAnalise_' + String(inv.inventario_key).replace(/[^0-9A-Za-z_-]/g,'');
    const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`;
    const win = global.open('', nomeJanela, features);
    if (!win) {
      global.alert('O navegador bloqueou a janela. Libere pop-ups para este site e tente novamente.');
      return;
    }
    try {
      win.document.open();
      win.document.write(_popupDetalheHtmlBase('Carregando inventário…', '<div class="popup-loading"><div><img class="popup-loading-logo" src="/assets/brand/da-terrinha-loading.png?v=20261005-v11-loading-logo" alt="Da Terrinha Alimentos"><div class="popup-loading-title">Carregando análise completa do inventário…</div><div class="popup-loading-subtitle">Consultando todos os produtos e conferindo os dados na Bluesoft.</div></div></div>'));
      win.document.close();
      win.focus();
    } catch (_) {}

    _abrirDetalheInventario(inv).then(function(){ _renderizarPopupDetalhe(win); });
  }
  function _redesenharDetalheOuDashboard() {
    const pg = document.getElementById('page-estoque-rel-analise-inventario');
    if (pg && pg.classList.contains('on')) _desenharTelaDetalheInventario();
    else _desenharAnaliseInventarios();
  }

  async function _carregarLojasClienteAnalise() {
    try {
      const xs = global.DTLoja && typeof global.DTLoja.listar === 'function' ? await global.DTLoja.listar(false) : [];
      return (Array.isArray(xs) ? xs : []).filter(l => l && l.ativa !== false && l.bluesoft_loja_key != null && String(l.bluesoft_loja_key) !== '')
        .map(l => ({id:String(l.id || l.lojaId || ''), nome:l.nome || l.descricao || l.id || l.lojaId, bluesoft_loja_key:String(l.bluesoft_loja_key)}))
        .filter(l => l.id);
    } catch (_) { return []; }
  }

  function _mesclarLojasAnalise(a, b) {
    const m = new Map();
    [...(a||[]), ...(b||[])].forEach(l => {
      if (!l) return;
      const id = String(l.id != null ? l.id : '').trim();
      if (!id) return;
      const atual = m.get(id) || {};
      m.set(id, Object.assign({}, atual, l, {id, nome:(l.nome || atual.nome || id)}));
    });
    return Array.from(m.values());
  }

  async function _carregarAnaliseInventarios(forcar) {
    if (_analiseEstado.carregando || (_analiseEstado.carregado && !forcar)) return;
    _analiseEstado.carregando = true; _analiseEstado.erro = '';
    _desenharAnaliseInventarios();
    try {
      const lojasClientePromise = _carregarLojasClienteAnalise();
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarAnaliseInventariosBigQuery', {timeout: 60000});
      // V7: uma única consulta ao BigQuery. O histórico já sincronizado é mostrado
      // imediatamente; a Bluesoft só é consultada ao abrir um inventário específico.
      const resp = await callable({..._analiseEstado.filtros});
      const d = (resp && resp.data) || {};
      _analiseEstado.releaseBackend = d.release || null;
      if (d.release !== ANALISE_RELEASE_ESPERADO) {
        throw new Error('A Cloud Function de análise ainda está em versão antiga. Publique a função buscarAnaliseInventariosBigQuery da V7 antes de validar os números. Front=' + ANALISE_RELEASE_ESPERADO + ' / Backend=' + (d.release || 'sem versão'));
      }
      _analiseEstado.revalidacaoHistorico = d.revalidacaoHistorico || null;
      const lojasCliente = await lojasClientePromise;
      _analiseEstado.inventarios = Array.isArray(d.inventarios) ? d.inventarios : [];
      _analiseEstado.produtos = Array.isArray(d.produtos) ? d.produtos : [];
      _analiseEstado.historicoProdutos = Array.isArray(d.historicoProdutos) ? d.historicoProdutos : [];
      _analiseEstado.lojas = _mesclarLojasAnalise(Array.isArray(d.lojas) ? d.lojas : [], lojasCliente);
      _analiseEstado.atualizadoEm = d.atualizadoEm || null;
      _analiseEstado.carregado = true;
      _analiseEstado.detalhe = {carregando:false, erro:'', inventario:null, itens:[], validacaoBluesoft:null};
    } catch (e) {
      _analiseEstado.erro = e && e.message ? e.message : String(e);
    }
    _analiseEstado.carregando = false;
    _desenharAnaliseInventarios();
  }

  async function _abrirDetalheInventario(inv) {
    if (!inv || _analiseEstado.detalhe.carregando) return;
    _analiseEstado.detalhe = {carregando:true, erro:'', inventario:inv, itens:[], validacaoBluesoft:null};
    _redesenharDetalheOuDashboard();
    try {
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarAnaliseInventariosBigQuery', {timeout: 60000});
      const resp = await callable({modo:'inventario', inventarioKey: inv.inventario_key, lojaId: inv.loja_id || ''});
      const d = (resp && resp.data) || {};
      if (d.release !== ANALISE_RELEASE_ESPERADO) {
        throw new Error('Detalhe retornado por uma Cloud Function antiga. Publique a V6. Backend=' + (d.release || 'sem versão'));
      }
      const itensDetalhe = Array.isArray(d.itens) ? d.itens : [];
      const cabTotal = _n((d.inventario || inv).produtos_total);
      const invalidos = itensDetalhe.filter(x => x && (x.dados_validos === false || x.diferenca_quantidade == null || !Number.isFinite(Number(x.diferenca_quantidade)))).length;
      if (!itensDetalhe.length && cabTotal > 0) {
        throw new Error('A análise recebeu o cabeçalho com ' + cabTotal + ' produto(s), mas nenhum item detalhado. Para não mostrar números incorretos, o dashboard foi bloqueado.');
      }
      if (cabTotal > 0 && itensDetalhe.length !== cabTotal && d.fonte === 'bluesoft-live') {
        throw new Error('Inconsistência na resposta da Bluesoft: cabeçalho=' + cabTotal + ' e itens=' + itensDetalhe.length + '. O dashboard foi bloqueado para não misturar bases.');
      }
      if (invalidos > 0) {
        throw new Error(invalidos + ' item(ns) vieram sem quantidade de sistema/contada válida. O dashboard foi bloqueado para não classificar como correto indevidamente.');
      }
      // Os cards e gráficos do detalhe são SEMPRE derivados dos mesmos itens exibidos
      // na tabela. Isso impede um cabeçalho antigo/inconsistente de dizer, por exemplo,
      // 250 produtos / 56 corretos / 0 perda / 0 ganho.
      const invAtualizado = _recalcularResumoDetalhePelosItens(d.inventario || inv, itensDetalhe);
      const somaClasses = _n(invAtualizado.produtos_corretos) + _n(invAtualizado.produtos_perda) + _n(invAtualizado.produtos_ganho) + _n(invAtualizado.produtos_sem_dados);
      if (somaClasses !== itensDetalhe.length) {
        throw new Error('Falha de integridade: ' + itensDetalhe.length + ' itens recebidos, mas ' + somaClasses + ' classificados.');
      }
      _analiseEstado.detalhe = {carregando:false, erro:'', inventario:invAtualizado, itens:itensDetalhe, validacaoBluesoft:d.validacaoBluesoft || null, fonte:d.fonte || '', diagnostico:d.diagnostico || null};
      // O detalhe é revalidado direto na Bluesoft. Substitui também a linha usada pelos
      // gráficos gerais para não continuar exibindo o valor antigo do cache na mesma tela.
      const idxInv = _analiseEstado.inventarios.findIndex(x=>String(x.inventario_key)===String(invAtualizado.inventario_key) && String(x.loja_id||'')===String(invAtualizado.loja_id||''));
      if(idxInv>=0) _analiseEstado.inventarios[idxInv] = Object.assign({}, _analiseEstado.inventarios[idxInv], invAtualizado);
    } catch (e) {
      _analiseEstado.detalhe.carregando = false;
      _analiseEstado.detalhe.erro = e && e.message ? e.message : String(e);
    }
    _redesenharDetalheOuDashboard();
  }

  function _resumoAnalise() {
    const invs = _analiseEstado.inventarios, prods = _analiseEstado.produtos;
    let itens = 0, corretos = 0, perdaQtd = 0, ganhoQtd = 0, perdaValor = 0, ganhoValor = 0, divergentes = 0;
    invs.forEach(i => {
      itens += _n(i.produtos_total); corretos += _n(i.produtos_corretos); divergentes += (_n(i.produtos_total)-_n(i.produtos_corretos));
      perdaQtd += _n(i.perda_quantidade); ganhoQtd += _n(i.ganho_quantidade);
      perdaValor += _n(i.perda_valor); ganhoValor += _n(i.ganho_valor);
    });
    const acs = invs.map(i=>_n(i.acuracidade_itens)).filter(Number.isFinite);
    const melhor = invs.length ? invs.slice().sort((a,b)=>_n(b.acuracidade_itens)-_n(a.acuracidade_itens))[0] : null;
    const pior = invs.length ? invs.slice().sort((a,b)=>_n(a.acuracidade_itens)-_n(b.acuracidade_itens))[0] : null;
    return {inventarios:invs.length, produtos:prods.length, itens, corretos, divergentes,
      acuracidade: itens ? corretos*100/itens : 0, perdaQtd, ganhoQtd, perdaValor, ganhoValor,
      saldoQtd:ganhoQtd-perdaQtd, saldoValor:ganhoValor-perdaValor,
      mediaInventarios: acs.length ? acs.reduce((a,b)=>a+b,0)/acs.length : 0, melhor, pior};
  }

  function _topProdutos(tipo, limite) {
    const campoV = tipo === 'perda' ? 'perda_valor' : 'ganho_valor';
    const campoQ = tipo === 'perda' ? 'perda_quantidade' : 'ganho_quantidade';
    return _analiseEstado.produtos.filter(p => _n(p[campoQ]) > 0).slice().sort((a,b) => {
      const va = _n(a[campoV]), vb = _n(b[campoV]); if (va || vb) return vb-va; return _n(b[campoQ])-_n(a[campoQ]);
    }).slice(0, limite || 3);
  }

  function _topCardHtml(titulo, tipo, itens) {
    const perda = tipo === 'perda', cor = perda ? '#b91c1c' : '#15803d', bg = perda ? '#fff7f7' : '#f4fff7';
    return `<div class="tc" style="padding:15px;border-top:3px solid ${cor}"><div style="font-weight:850;margin-bottom:10px;color:${cor}">${titulo}</div>
      ${itens.length ? itens.map((p,idx)=>`<div style="display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:center;padding:8px;border-radius:8px;background:${bg};margin-bottom:6px"><b>${idx+1}º</b><div style="min-width:0"><div style="font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(p.produto_descricao || p.produto_key)}">${esc(p.produto_descricao || p.produto_key)}</div><div style="font-size:.68rem;color:var(--muted)">Cód. ${esc(p.produto_key || '—')} · ${_n(p.inventarios_divergentes)} invent. divergentes</div></div><div style="text-align:right"><b>${_qty(perda?p.perda_quantidade:p.ganho_quantidade)}</b><div style="font-size:.68rem;color:${cor}">${_money(perda?p.perda_valor:p.ganho_valor)}</div></div></div>`).join('') : '<div style="color:var(--muted);font-size:.76rem">Nenhuma divergência encontrada.</div>'}
    </div>`;
  }

  function _lojasFiltroAnalise() {
    const mapa = new Map();
    (_analiseEstado.lojas || []).forEach(l => {
      const key = String(l && l.id != null ? l.id : '').trim();
      if (!key) return;
      mapa.set(key, {id:key, nome:l.nome || l.loja_nome || l.bluesoft_loja_key || key});
    });
    // Fallback importante: se a função não conseguiu devolver o cadastro de lojas,
    // monta o seletor com as próprias lojas que vieram nos inventários.
    (_analiseEstado.inventarios || []).forEach(i => {
      const lojaKey = String(i && i.loja_key != null ? i.loja_key : '').trim();
      const key = String(i && i.loja_id != null && i.loja_id !== '' ? i.loja_id : (lojaKey ? 'bq:' + lojaKey : '')).trim();
      if (!key) return;
      if (!mapa.has(key)) mapa.set(key, {id:key, nome:i.loja_nome || lojaKey || key});
    });
    return Array.from(mapa.values()).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
  }

  function _recalcularResumoDetalhePelosItens(inv, itens) {
    const arr = Array.isArray(itens) ? itens : [];
    if (!arr.length) return inv || {};
    const EPS = 0.000001;
    let corretos=0, perdas=0, ganhos=0, semDados=0, perdaQtd=0, ganhoQtd=0, perdaValor=0, ganhoValor=0, absQtd=0, absValor=0;
    arr.forEach(x=>{
      if (!x || x.dados_validos === false || x.diferenca_quantidade == null || !Number.isFinite(Number(x.diferenca_quantidade))) { semDados++; return; }
      const dif=Number(x.diferenca_quantidade);
      const val=Number.isFinite(Number(x.diferenca_valor)) ? Number(x.diferenca_valor) : 0;
      if (dif < -EPS) { perdas++; perdaQtd += -dif; perdaValor += Math.abs(val); }
      else if (dif > EPS) { ganhos++; ganhoQtd += dif; ganhoValor += Math.abs(val); }
      else corretos++;
      absQtd += Math.abs(dif); absValor += Math.abs(val);
    });
    const total=arr.length, validos=total-semDados;
    return Object.assign({}, inv || {}, {
      produtos_total: total,
      produtos_corretos: corretos,
      produtos_perda: perdas,
      produtos_ganho: ganhos,
      produtos_sem_dados: semDados,
      acuracidade_itens: validos ? (corretos*100/validos) : 0,
      perda_quantidade: perdaQtd,
      ganho_quantidade: ganhoQtd,
      perda_valor: perdaValor,
      ganho_valor: ganhoValor,
      ajuste_liquido_quantidade: ganhoQtd-perdaQtd,
      ajuste_liquido_valor: ganhoValor-perdaValor,
      divergencia_absoluta_quantidade: absQtd,
      divergencia_absoluta_valor: absValor,
    });
  }

  function _filtrosAnaliseHtml() {
    const f = _analiseEstado.filtros;
    return `<div class="tc" style="padding:13px;margin:12px 0"><div style="display:flex;align-items:end;gap:10px;flex-wrap:wrap">
      <div style="min-width:190px;flex:1"><div style="font-size:.65rem;color:var(--muted);margin-bottom:4px">LOJA</div><select class="input" data-estoque-analise-loja style="width:100%"><option value="">Todas as lojas</option>${_lojasFiltroAnalise().map(l=>`<option value="${esc(l.id)}" ${String(f.lojaId)===String(l.id)?'selected':''}>${esc(l.nome)}</option>`).join('')}</select></div>
      <div><div style="font-size:.65rem;color:var(--muted);margin-bottom:4px">DE</div><input type="date" class="input" data-estoque-analise-inicio value="${esc(f.dataInicio||'')}"></div>
      <div><div style="font-size:.65rem;color:var(--muted);margin-bottom:4px">ATÉ</div><input type="date" class="input" data-estoque-analise-fim value="${esc(f.dataFim||'')}"></div>
      <button class="btn btn-primary" data-estoque-analise-aplicar>🔎 Aplicar filtros</button><button class="btn btn-ghost" data-estoque-analise-limpar>Limpar</button>
    </div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px"><span style="font-size:.67rem;color:var(--muted);padding:5px 0">Atalhos:</span><button class="btn btn-ghost" style="padding:5px 9px" data-estoque-periodo="30">30 dias</button><button class="btn btn-ghost" style="padding:5px 9px" data-estoque-periodo="90">90 dias</button><button class="btn btn-ghost" style="padding:5px 9px" data-estoque-periodo="365">12 meses</button><button class="btn btn-ghost" style="padding:5px 9px" data-estoque-periodo="all">Todo período</button><span style="margin-left:auto;font-size:.68rem;color:var(--muted);padding:5px 0">Exibindo: <b>${esc(_periodoTexto())}</b></span></div></div>`;
  }

  function _inventariosAnaliseHtml() {
    const linhas = _analiseEstado.inventarios.slice().sort((a,b)=>String(b.data_fechamento||b.data_abertura||'').localeCompare(String(a.data_fechamento||a.data_abertura||'')));
    if (!linhas.length) return '<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">Nenhum inventário fechado no período</div></div>';
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Inventário</th><th>Loja</th><th>Fechamento</th><th>Produtos</th><th>Acuracidade</th><th>Perdas</th><th>Ganhos</th><th>Saldo</th><th></th></tr></thead><tbody>${linhas.slice(0,150).map(i=>`<tr data-estoque-analise-inventario="${esc(i.inventario_key)}" data-loja-id="${esc(i.loja_id||'')}" style="cursor:pointer" title="Clique para abrir a análise completa em uma nova janela"><td><b>${esc(_nomeInventario(i))}</b><div style="font-size:.67rem;color:var(--muted)">${esc(i.inventario_tipo||'')}</div></td><td>${esc(i.loja_nome||i.loja_key||'—')}</td><td>${_dataAnalise(i.data_fechamento||i.data_abertura)}</td><td>${_n(i.produtos_total).toLocaleString('pt-BR')}</td><td><b style="color:${_corAcuracidade(i.acuracidade_itens)}">${_pct(i.acuracidade_itens)}</b><div style="font-size:.66rem;color:var(--muted)">Qtd.: ${_pct(i.acuracidade_quantitativa)}</div></td><td style="color:#b91c1c">${_qty(i.perda_quantidade)}<div style="font-size:.66rem">${_money(i.perda_valor)}</div></td><td style="color:#15803d">${_qty(i.ganho_quantidade)}<div style="font-size:.66rem">${_money(i.ganho_valor)}</div></td><td><b>${_qty(i.ajuste_liquido_quantidade)}</b><div style="font-size:.66rem">${_money(i.ajuste_liquido_valor)}</div></td><td style="font-size:1.05rem">›</td></tr>`).join('')}</tbody></table></div>${linhas.length>150?`<div style="font-size:.7rem;color:var(--muted);margin-top:6px">Mostrando os 150 mais recentes de ${linhas.length} inventários.</div>`:''}`;
  }

  function _historicoProdutoHtml(produtoKey) {
    const h = _analiseEstado.historicoProdutos.filter(x=>String(x.produto_key)===String(produtoKey));
    if (!h.length) return '<div style="padding:10px;color:var(--muted)">Sem histórico detalhado.</div>';
    return `<div style="padding:10px 14px;background:var(--bg);border-top:1px solid var(--border)"><div style="font-weight:800;margin-bottom:7px">Últimos inventários deste produto no filtro atual</div><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Data</th><th>Inventário</th><th>Loja</th><th>Sistema</th><th>Contado</th><th>Diferença</th><th>Acuracidade</th></tr></thead><tbody>${h.map(x=>{const d=_n(x.diferenca_quantidade),cor=d<0?'#b91c1c':d>0?'#15803d':'inherit';return `<tr><td>${_dataAnalise(x.data_fechamento||x.data_abertura)}</td><td>${esc(_nomeInventario(x))}</td><td>${esc(x.loja_nome||x.loja_key||'—')}</td><td>${_qty(x.quantidade_sistema)}</td><td>${_qty(x.quantidade_contada)}</td><td style="color:${cor};font-weight:800">${d>0?'+':''}${_qty(d)}<div style="font-size:.66rem">${_money(x.diferenca_valor)}</div></td><td>${_pct(x.acuracidade_quantitativa)}</td></tr>`;}).join('')}</tbody></table></div></div>`;
  }

  function _produtosAnaliseHtml() {
    const busca=(_analiseEstado.buscaProduto||'').trim().toLowerCase();
    let linhas=_analiseEstado.produtos.filter(p=>!busca||String(p.produto_key||'').toLowerCase().includes(busca)||String(p.produto_descricao||'').toLowerCase().includes(busca));
    linhas=linhas.slice().sort((a,b)=>_n(a.acuracidade_itens)-_n(b.acuracidade_itens)||_n(b.inventarios_divergentes)-_n(a.inventarios_divergentes));
    if(!linhas.length)return '<div class="empty"><div class="empty-icon">🔎</div><div class="empty-title">Nenhum produto encontrado</div></div>';
    return `<div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Inventários</th><th>Reincidências</th><th>Acuracidade</th><th>Perdas</th><th>Ganhos</th><th>Saldo</th><th>Último inventário</th></tr></thead><tbody>${linhas.slice(0,500).map(p=>{const aberto=String(_analiseEstado.produtoAberto||'')===String(p.produto_key||'');return `<tr data-estoque-analise-produto="${esc(p.produto_key)}" style="cursor:pointer"><td><b>${esc(p.produto_descricao||p.produto_key)}</b><div style="font-size:.67rem;color:var(--muted)">Cód. ${esc(p.produto_key||'—')} ${aberto?'▲':'▼'}</div></td><td>${_n(p.inventarios_total)}</td><td><b>${_n(p.inventarios_divergentes)}</b><div style="font-size:.65rem;color:var(--muted)">com divergência</div></td><td><b style="color:${_corAcuracidade(p.acuracidade_itens)}">${_pct(p.acuracidade_itens)}</b><div style="font-size:.66rem;color:var(--muted)">Qtd.: ${_pct(p.acuracidade_quantitativa)}</div></td><td style="color:#b91c1c">${_qty(p.perda_quantidade)}<div style="font-size:.66rem">${_money(p.perda_valor)}</div></td><td style="color:#15803d">${_qty(p.ganho_quantidade)}<div style="font-size:.66rem">${_money(p.ganho_valor)}</div></td><td>${_qty(p.ajuste_liquido_quantidade)}<div style="font-size:.66rem">${_money(p.ajuste_liquido_valor)}</div></td><td>${_dataAnalise(p.ultimo_inventario_em)}</td></tr>${aberto?`<tr><td colspan="8" style="padding:0">${_historicoProdutoHtml(p.produto_key)}</td></tr>`:''}`;}).join('')}</tbody></table></div>${linhas.length>500?`<div style="font-size:.7rem;color:var(--muted);margin-top:6px">Mostrando 500 de ${linhas.length} produtos. Use a busca para localizar os demais.</div>`:''}`;
  }

  function _detalheInventarioHtml() {
    const d=_analiseEstado.detalhe;
    if(!d.inventario && !d.carregando && !d.erro)return '';
    const i=d.inventario||{};
    const shell=(conteudo)=>`<div id="estoque-analise-detalhe" style="width:100%;padding-bottom:28px">${conteudo}</div>`;
    if(d.carregando)return shell(`<div style="padding:36px"><div class="empty"><div class="empty-icon">🔄</div><div class="empty-title">Montando análise completa de ${esc(_nomeInventario(i))}…</div><div style="font-size:.72rem;color:var(--muted);margin-top:5px">Consultando e conferindo todos os produtos do inventário.</div></div></div>`);
    if(d.erro)return shell(`<div style="padding:22px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><b>⚠️ Não foi possível abrir o inventário</b><div style="color:#b91c1c;margin-top:8px">${esc(d.erro)}</div></div><button class="btn btn-ghost" data-estoque-detalhe-fechar>✕ Fechar janela</button></div></div>`);
    const itens=d.itens||[], perdas=itens.filter(x=>_n(x.diferenca_quantidade)<0).sort((a,b)=>Math.abs(_n(b.diferenca_valor))-Math.abs(_n(a.diferenca_valor))), ganhos=itens.filter(x=>_n(x.diferenca_quantidade)>0).sort((a,b)=>Math.abs(_n(b.diferenca_valor))-Math.abs(_n(a.diferenca_valor)));
    const vb=d.validacaoBluesoft||null;
    const seloValidacao=vb&&vb.ok?`<div style="display:inline-flex;gap:6px;align-items:center;margin-top:7px;padding:5px 8px;border-radius:999px;background:#ecfdf5;color:#166534;font-size:.66rem;font-weight:800">✓ Validado agora na Bluesoft · ${_n(vb.itens)} item(ns)${d.fonte?' · '+esc(d.fonte):''}</div>`:vb&&vb.erro?`<div style="margin-top:7px;padding:6px 8px;border-radius:8px;background:#fff7ed;color:#9a3412;font-size:.66rem">⚠ Não foi possível revalidar na Bluesoft: ${esc(vb.erro)}</div>`:'';
    const conteudo=`<div style="position:sticky;top:0;z-index:5;background:var(--card,#fff);border-bottom:1px solid var(--border);padding:18px 20px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font-size:.68rem;color:var(--muted);font-weight:800;letter-spacing:.02em">ANÁLISE COMPLETA DO INVENTÁRIO</div><h2 style="margin:4px 0 2px">${esc(_nomeInventario(i))}</h2><div style="font-size:.74rem;color:var(--muted)">${esc(i.loja_nome||i.loja_key||'—')} · ${_dataAnalise(i.data_fechamento||i.data_abertura)} · ${esc(i.inventario_tipo||'')}</div>${seloValidacao}</div><button class="btn btn-ghost" data-estoque-detalhe-fechar>✕ Fechar janela</button></div>
      <div style="padding:18px 20px 24px">
      <div style="display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;margin-bottom:14px"><div class="tc" style="padding:11px"><small>PRODUTOS</small><div style="font-size:1.3rem;font-weight:900">${_n(i.produtos_total)}</div></div><div class="tc" style="padding:11px"><small>ACURACIDADE</small><div style="font-size:1.3rem;font-weight:900;color:${_corAcuracidade(i.acuracidade_itens)}">${_pct(i.acuracidade_itens)}</div></div><div class="tc" style="padding:11px"><small>CORRETOS</small><div style="font-size:1.3rem;font-weight:900">${_n(i.produtos_corretos)}</div></div><div class="tc" style="padding:11px"><small>COM PERDA</small><div style="font-size:1.3rem;font-weight:900;color:#b91c1c">${_n(i.produtos_perda)}</div></div><div class="tc" style="padding:11px"><small>COM GANHO</small><div style="font-size:1.3rem;font-weight:900;color:#15803d">${_n(i.produtos_ganho)}</div></div><div class="tc" style="padding:11px"><small>DIVERGÊNCIA ABS.</small><div style="font-size:1.05rem;font-weight:900">${_money(i.divergencia_absoluta_valor)}</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px"><div class="tc" style="padding:12px"><b>Distribuição dos produtos</b><div style="height:250px"><canvas id="estoque-chart-detalhe-status"></canvas></div></div><div class="tc" style="padding:12px"><b>Maiores impactos financeiros</b><div style="height:250px"><canvas id="estoque-chart-detalhe-impacto"></canvas></div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">${_topDetalheHtml('🔻 Maiores perdas',perdas.slice(0,5),'perda')}${_topDetalheHtml('🔺 Maiores ganhos',ganhos.slice(0,5),'ganho')}</div>
      <div class="tc" style="padding:14px;margin-top:14px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:8px"><div><b>📦 Todos os produtos do inventário</b><div style="font-size:.68rem;color:var(--muted);margin-top:3px">${itens.length.toLocaleString('pt-BR')} produto(s) carregado(s). Sistema x contado, diferença, custo, impacto e acuracidade individual.</div></div></div><div style="overflow:auto;border:1px solid var(--border);border-radius:10px"><table class="dt-table"><thead style="position:sticky;top:0;z-index:2;background:var(--card,#fff)"><tr><th>Produto</th><th>Sistema</th><th>Contado</th><th>Diferença</th><th>Custo un.</th><th>Impacto</th><th>Acuracidade</th></tr></thead><tbody>${itens.map(x=>{const dif=_n(x.diferenca_quantidade),cor=dif<0?'#b91c1c':dif>0?'#15803d':'inherit';return `<tr><td><b>${esc(x.produto_descricao||x.produto_key)}</b><div style="font-size:.65rem;color:var(--muted)">Cód. ${esc(x.produto_key||'—')}</div></td><td>${_qty(x.quantidade_sistema)}</td><td>${_qty(x.quantidade_contada)}</td><td style="font-weight:800;color:${cor}">${dif>0?'+':''}${_qty(dif)}</td><td>${_money(x.custo_unitario)}</td><td style="font-weight:800;color:${cor}">${_money(x.diferenca_valor)}</td><td style="color:${_corAcuracidade(x.acuracidade_quantitativa)};font-weight:800">${_pct(x.acuracidade_quantitativa)}</td></tr>`;}).join('')}</tbody></table></div></div>
      </div>`;
    return shell(conteudo);
  }

  function _topDetalheHtml(titulo,itens,tipo){const perda=tipo==='perda',cor=perda?'#b91c1c':'#15803d';return `<div class="tc" style="padding:12px"><b style="color:${cor}">${titulo}</b>${itens.length?itens.map((x,idx)=>`<div style="display:grid;grid-template-columns:24px 1fr auto;gap:7px;padding:7px 0;border-bottom:1px solid var(--border)"><b>${idx+1}º</b><div style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.produto_descricao||x.produto_key)}</div><div style="font-weight:800;color:${cor}">${_money(Math.abs(_n(x.diferenca_valor)))}</div></div>`).join(''):'<div style="padding:10px;color:var(--muted)">Nenhum item.</div>'}</div>`;}

  function _renderChartsDetalheInventario() {
    _destruirCharts(_analiseEstado.detalheCharts);
    if (!global.Chart) return;
    const d=_analiseEstado.detalhe;
    if(!(d.inventario && !d.carregando && !d.erro)) return;
    const i=d.inventario,it=d.itens||[];
    _chart('estoque-chart-detalhe-status',{type:'doughnut',data:{labels:['Corretos','Perda','Ganho'],datasets:[{data:[_n(i.produtos_corretos),_n(i.produtos_perda),_n(i.produtos_ganho)],backgroundColor:['#16a34a','#dc2626','#2563eb']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}},true);
    const imp=it.filter(x=>Math.abs(_n(x.diferenca_valor))>0).sort((a,b)=>Math.abs(_n(b.diferenca_valor))-Math.abs(_n(a.diferenca_valor))).slice(0,10);
    _chart('estoque-chart-detalhe-impacto',{type:'bar',data:{labels:imp.map(x=>String(x.produto_descricao||x.produto_key).slice(0,30)),datasets:[{label:'Impacto (R$)',data:imp.map(x=>_n(x.diferenca_valor)),backgroundColor:imp.map(x=>_n(x.diferenca_valor)<0?'rgba(185,28,28,.78)':'rgba(21,128,61,.78)')}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}}}},true);
  }

  function _desenharTelaDetalheInventario() {
    const pagina=document.getElementById('page-estoque-rel-analise-inventario'); if(!pagina)return;
    _destruirCharts(_analiseEstado.detalheCharts);
    pagina.innerHTML=_detalheInventarioHtml();
    requestAnimationFrame(_renderChartsDetalheInventario);
    if(!pagina._estoqueDetalheBound){
      pagina.addEventListener('click',ev=>{
        if(ev.target.closest('[data-estoque-detalhe-fechar]')){
          // Como esta tela é aberta por window.open(), o navegador permite fechá-la.
          // Se alguém acessar a URL diretamente, volta ao dashboard como fallback.
          try { global.close(); } catch (_) {}
          setTimeout(function(){
            if (!global.closed) global.location.hash='#/logistica/estoque/relatorios/analise';
          }, 80);
        }
      });
      pagina._estoqueDetalheBound=true;
    }
  }

  function _renderChartsAnalise() {
    _destruirCharts(_analiseEstado.charts); _destruirCharts(_analiseEstado.detalheCharts);
    if (!global.Chart || !_analiseEstado.carregado) return;
    const invAsc=_analiseEstado.inventarios.slice().sort((a,b)=>String(a.data_fechamento||a.data_abertura||'').localeCompare(String(b.data_fechamento||b.data_abertura||'')));
    const ult=invAsc.slice(-30);
    _chart('estoque-chart-acuracidade',{type:'line',data:{labels:ult.map(i=>_dataAnalise(i.data_fechamento||i.data_abertura)),datasets:[{label:'Acuracidade por itens (%)',data:ult.map(i=>_n(i.acuracidade_itens)),borderColor:'#0f766e',backgroundColor:'rgba(15,118,110,.10)',fill:true,tension:.3,pointRadius:3},{label:'Acuracidade quantitativa (%)',data:ult.map(i=>_n(i.acuracidade_quantitativa)),borderColor:'#2563eb',backgroundColor:'rgba(37,99,235,.06)',tension:.3,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{suggestedMin:80,max:100}},plugins:{legend:{position:'bottom'}}}});
    _chart('estoque-chart-perdas-ganhos',{type:'bar',data:{labels:ult.map(i=>String(i.inventario_numero||i.inventario_key||'').slice(-10)),datasets:[{label:'Perdas (R$)',data:ult.map(i=>_n(i.perda_valor)),backgroundColor:'rgba(185,28,28,.75)'},{label:'Ganhos (R$)',data:ult.map(i=>_n(i.ganho_valor)),backgroundColor:'rgba(21,128,61,.75)'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{x:{stacked:false}}}});
    const r=_resumoAnalise();
    _chart('estoque-chart-status',{type:'doughnut',data:{labels:['Corretos','Com divergência'],datasets:[{data:[r.corretos,r.divergentes],backgroundColor:['#16a34a','#dc2626']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});
    const porLoja={}; _analiseEstado.inventarios.forEach(i=>{const k=i.loja_nome||i.loja_key||'Loja'; if(!porLoja[k])porLoja[k]={t:0,c:0,p:0,g:0}; porLoja[k].t+=_n(i.produtos_total);porLoja[k].c+=_n(i.produtos_corretos);porLoja[k].p+=_n(i.perda_valor);porLoja[k].g+=_n(i.ganho_valor);});
    const lojas=Object.keys(porLoja);
    _chart('estoque-chart-lojas',{type:'bar',data:{labels:lojas,datasets:[{label:'Acuracidade (%)',data:lojas.map(k=>porLoja[k].t?100*porLoja[k].c/porLoja[k].t:0),backgroundColor:'rgba(37,99,235,.78)'}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',scales:{x:{min:0,max:100}},plugins:{legend:{display:false}}}});
    const reinc=_analiseEstado.produtos.filter(p=>_n(p.inventarios_divergentes)>0).sort((a,b)=>_n(b.inventarios_divergentes)-_n(a.inventarios_divergentes)).slice(0,10);
    _chart('estoque-chart-reincidencia',{type:'bar',data:{labels:reinc.map(p=>String(p.produto_descricao||p.produto_key).slice(0,35)),datasets:[{label:'Inventários com divergência',data:reinc.map(p=>_n(p.inventarios_divergentes)),backgroundColor:'rgba(180,83,9,.78)'}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}}}});
    const impacto=_analiseEstado.produtos.slice().sort((a,b)=>(Math.abs(_n(b.perda_valor))+Math.abs(_n(b.ganho_valor)))-(Math.abs(_n(a.perda_valor))+Math.abs(_n(a.ganho_valor)))).slice(0,10);
    _chart('estoque-chart-impacto',{type:'bar',data:{labels:impacto.map(p=>String(p.produto_descricao||p.produto_key).slice(0,35)),datasets:[{label:'Perda (R$)',data:impacto.map(p=>-_n(p.perda_valor)),backgroundColor:'rgba(185,28,28,.75)'},{label:'Ganho (R$)',data:impacto.map(p=>_n(p.ganho_valor)),backgroundColor:'rgba(21,128,61,.75)'}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{position:'bottom'}}}});

    const d=_analiseEstado.detalhe;
    if(d.inventario && !d.carregando && !d.erro){const i=d.inventario,it=d.itens||[];
      _chart('estoque-chart-detalhe-status',{type:'doughnut',data:{labels:['Corretos','Perda','Ganho'],datasets:[{data:[_n(i.produtos_corretos),_n(i.produtos_perda),_n(i.produtos_ganho)],backgroundColor:['#16a34a','#dc2626','#2563eb']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}},true);
      const imp=it.filter(x=>Math.abs(_n(x.diferenca_valor))>0).sort((a,b)=>Math.abs(_n(b.diferenca_valor))-Math.abs(_n(a.diferenca_valor))).slice(0,10);
      _chart('estoque-chart-detalhe-impacto',{type:'bar',data:{labels:imp.map(x=>String(x.produto_descricao||x.produto_key).slice(0,30)),datasets:[{label:'Impacto (R$)',data:imp.map(x=>_n(x.diferenca_valor)),backgroundColor:imp.map(x=>_n(x.diferenca_valor)<0?'rgba(185,28,28,.78)':'rgba(21,128,61,.78)')}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}}}},true);
    }
  }

  function _exportarAnaliseInventarios() {
    if(!global.XLSX){global.showToast?.('Exportação indisponível (biblioteca não carregada).','error');return;}
    if(!_analiseEstado.carregado){global.showToast?.('Carregue a análise antes de exportar.','error');return;}
    const r=_resumoAnalise(), wb=global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet([{'Loja':_analiseEstado.filtros.lojaId||'Todas','Período':_periodoTexto(),'Inventários analisados':r.inventarios,'Produtos distintos':r.produtos,'Itens analisados':r.itens,'Acuracidade por itens (%)':r.acuracidade,'Perda quantidade':r.perdaQtd,'Perda valor':r.perdaValor,'Ganho quantidade':r.ganhoQtd,'Ganho valor':r.ganhoValor,'Saldo quantidade':r.saldoQtd,'Saldo valor':r.saldoValor}]),'Resumo');
    global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(_analiseEstado.inventarios),'Inventarios');
    global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(_analiseEstado.produtos),'Produtos');
    global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(_analiseEstado.historicoProdutos),'Historico Produtos');
    if(_analiseEstado.detalhe.inventario&&_analiseEstado.detalhe.itens.length)global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(_analiseEstado.detalhe.itens),'Inventario Selecionado');
    global.XLSX.writeFile(wb,'estoque_analise_inventarios_'+new Date().toISOString().slice(0,10)+'.xlsx');
  }

  function _desenharAnaliseInventarios() {
    const pagina=document.getElementById('page-estoque-rel-analise'); if(!pagina)return;
    _destruirCharts(_analiseEstado.charts); _destruirCharts(_analiseEstado.detalheCharts);
    const r=_resumoAnalise(), perdas=_topProdutos('perda',3), ganhos=_topProdutos('ganho',3);
    const pior=r.pior, melhor=r.melhor;
    pagina.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><h2 style="margin:0">📊 Análise de Inventários</h2><div style="font-size:.72rem;color:var(--muted);margin-top:5px">Dashboard de acuracidade, perdas, ganhos, reincidências e evolução histórica dos inventários fechados.</div>${_analiseEstado.atualizadoEm?`<div style="font-size:.68rem;color:var(--muted);margin-top:3px">Base atualizada em: ${esc(fmtDataHora(_analiseEstado.atualizadoEm))}</div>`:''}<div style="font-size:.62rem;color:var(--muted);margin-top:2px">Versão análise: ${esc(ANALISE_RELEASE_ESPERADO)}${_analiseEstado.releaseBackend?' · backend '+esc(_analiseEstado.releaseBackend):''}</div></div><div style="display:flex;gap:8px"><button class="btn btn-ghost" data-estoque-analise-recarregar ${_analiseEstado.carregando?'disabled':''}>${_analiseEstado.carregando?'🔄 Analisando…':'↻ Atualizar análise'}</button>${podeExportar('analise')?'<button class="btn btn-ghost" data-estoque-analise-exportar>⬇️ Exportar Excel</button>':''}</div></div>
      ${_filtrosAnaliseHtml()}
      ${_analiseEstado.erro?`<div style="margin:10px 0;padding:10px 12px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;color:#b91c1c">⚠️ ${esc(_analiseEstado.erro)}</div>`:''}
      
      ${_analiseEstado.carregando&&!_analiseEstado.carregado?'<div class="empty"><div class="empty-icon">🔄</div><div class="empty-title">Analisando histórico de inventários…</div></div>':!_analiseEstado.carregado?'<div class="empty"><div class="empty-icon">📊</div><div class="empty-title">Preparando análise…</div></div>':`
      <div style="display:grid;grid-template-columns:repeat(6,minmax(125px,1fr));gap:9px;margin:14px 0"><div class="tc" style="padding:13px"><div style="font-size:.65rem;color:var(--muted)">INVENTÁRIOS</div><div style="font-size:1.45rem;font-weight:900">${r.inventarios}</div></div><div class="tc" style="padding:13px"><div style="font-size:.65rem;color:var(--muted)">PRODUTOS</div><div style="font-size:1.45rem;font-weight:900">${r.produtos}</div></div><div class="tc" style="padding:13px"><div style="font-size:.65rem;color:var(--muted)">ACURACIDADE GERAL</div><div style="font-size:1.45rem;font-weight:900;color:${_corAcuracidade(r.acuracidade)}">${_pct(r.acuracidade)}</div><div style="font-size:.64rem;color:var(--muted)">${r.divergentes.toLocaleString('pt-BR')} itens divergentes</div></div><div class="tc" style="padding:13px"><div style="font-size:.65rem;color:#b91c1c">PERDAS</div><div style="font-size:1.25rem;font-weight:900;color:#b91c1c">${_qty(r.perdaQtd)}</div><div style="font-size:.64rem;color:#b91c1c">${_money(r.perdaValor)}</div></div><div class="tc" style="padding:13px"><div style="font-size:.65rem;color:#15803d">GANHOS</div><div style="font-size:1.25rem;font-weight:900;color:#15803d">${_qty(r.ganhoQtd)}</div><div style="font-size:.64rem;color:#15803d">${_money(r.ganhoValor)}</div></div><div class="tc" style="padding:13px"><div style="font-size:.65rem;color:var(--muted)">SALDO LÍQUIDO</div><div style="font-size:1.25rem;font-weight:900">${r.saldoQtd>0?'+':''}${_qty(r.saldoQtd)}</div><div style="font-size:.64rem;color:var(--muted)">${_money(r.saldoValor)}</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0"><div class="tc" style="padding:14px"><b>📈 Evolução da acuracidade</b><div style="font-size:.67rem;color:var(--muted)">Até 30 inventários mais recentes do filtro.</div><div style="height:280px;margin-top:8px"><canvas id="estoque-chart-acuracidade"></canvas></div></div><div class="tc" style="padding:14px"><b>💰 Perdas x ganhos por inventário</b><div style="font-size:.67rem;color:var(--muted)">Impacto financeiro dos ajustes.</div><div style="height:280px;margin-top:8px"><canvas id="estoque-chart-perdas-ganhos"></canvas></div></div></div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:12px 0"><div class="tc" style="padding:14px"><b>🎯 Integridade das contagens</b><div style="height:245px"><canvas id="estoque-chart-status"></canvas></div></div><div class="tc" style="padding:14px"><b>🏬 Acuracidade por loja</b><div style="height:245px"><canvas id="estoque-chart-lojas"></canvas></div></div><div class="tc" style="padding:14px"><b>🔁 Produtos reincidentes</b><div style="height:245px"><canvas id="estoque-chart-reincidencia"></canvas></div></div></div>
      <div class="tc" style="padding:14px;margin:12px 0"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div><b>⚠️ Produtos de maior impacto financeiro</b><div style="font-size:.67rem;color:var(--muted)">Top 10 pelo valor absoluto das divergências.</div></div><div style="font-size:.68rem;color:var(--muted)">${pior?`Pior inventário: <b>${esc(_nomeInventario(pior))}</b> (${_pct(pior.acuracidade_itens)})`:''}${melhor?` · Melhor: <b>${esc(_nomeInventario(melhor))}</b> (${_pct(melhor.acuracidade_itens)})`:''}</div></div><div style="height:300px;margin-top:8px"><canvas id="estoque-chart-impacto"></canvas></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0">${_topCardHtml('🔻 3 maiores perdas','perda',perdas)}${_topCardHtml('🔺 3 maiores ganhos','ganho',ganhos)}</div>
      <div class="tc" style="padding:15px;margin-top:12px"><div style="margin-bottom:10px"><b>📋 Inventários do período</b><div style="font-size:.68rem;color:var(--muted)">Clique em qualquer inventário para abrir a análise completa em uma nova aba do navegador, sem sair deste dashboard.</div></div>${_inventariosAnaliseHtml()}</div>
      <div class="tc" style="padding:15px;margin-top:12px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:10px"><div><b>📦 Saúde por produto</b><div style="font-size:.68rem;color:var(--muted)">Acuracidade e reincidência de divergência no histórico filtrado. Clique no produto para abrir seus últimos inventários.</div></div><div><div style="font-size:.65rem;color:var(--muted);margin-bottom:3px">BUSCAR PRODUTO</div><input class="input" data-estoque-analise-busca value="${esc(_analiseEstado.buscaProduto)}" placeholder="Código ou descrição" style="min-width:240px"></div></div><div data-estoque-analise-produtos>${_produtosAnaliseHtml()}</div></div>`}`;

    requestAnimationFrame(_renderChartsAnalise);
    if(!pagina._estoqueAnaliseBound){
      pagina.addEventListener('click',ev=>{
        if(ev.target.closest('[data-estoque-analise-recarregar]')){_carregarAnaliseInventarios(true);return;}
        if(ev.target.closest('[data-estoque-analise-exportar]')){_exportarAnaliseInventarios();return;}
        if(ev.target.closest('[data-estoque-analise-aplicar]')){const loja=pagina.querySelector('[data-estoque-analise-loja]'),ini=pagina.querySelector('[data-estoque-analise-inicio]'),fim=pagina.querySelector('[data-estoque-analise-fim]');_analiseEstado.filtros={lojaId:loja?.value||'',dataInicio:ini?.value||'',dataFim:fim?.value||''};_carregarAnaliseInventarios(true);return;}
        if(ev.target.closest('[data-estoque-analise-limpar]')){_analiseEstado.filtros={lojaId:'',dataInicio:'',dataFim:''};_carregarAnaliseInventarios(true);return;}
        const per=ev.target.closest('[data-estoque-periodo]'); if(per){const dias=per.dataset.estoquePeriodo;if(dias==='all'){_analiseEstado.filtros.dataInicio='';_analiseEstado.filtros.dataFim='';}else{const fim=new Date(),ini=new Date();ini.setDate(fim.getDate()-Number(dias)+1);_analiseEstado.filtros.dataInicio=ini.toISOString().slice(0,10);_analiseEstado.filtros.dataFim=fim.toISOString().slice(0,10);}_carregarAnaliseInventarios(true);return;}
        const trInv=ev.target.closest('[data-estoque-analise-inventario]'); if(trInv){const key=trInv.dataset.estoqueAnaliseInventario,lojaId=trInv.dataset.lojaId;const inv=_analiseEstado.inventarios.find(x=>String(x.inventario_key)===String(key)&&String(x.loja_id||'')===String(lojaId||''))||_analiseEstado.inventarios.find(x=>String(x.inventario_key)===String(key));_irParaTelaDetalheInventario(inv||{inventario_key:key,loja_id:lojaId});return;}
        const tr=ev.target.closest('[data-estoque-analise-produto]'); if(tr){const key=tr.dataset.estoqueAnaliseProduto;_analiseEstado.produtoAberto=String(_analiseEstado.produtoAberto||'')===String(key)?null:key;const host=pagina.querySelector('[data-estoque-analise-produtos]');if(host)host.innerHTML=_produtosAnaliseHtml();return;}
      });
      pagina.addEventListener('input',ev=>{if(!ev.target.hasAttribute('data-estoque-analise-busca'))return;_analiseEstado.buscaProduto=ev.target.value||'';const host=pagina.querySelector('[data-estoque-analise-produtos]');if(host)host.innerHTML=_produtosAnaliseHtml();});
      pagina._estoqueAnaliseBound=true;
    }
  }

  function renderEstoqueRelAnalise(){_desenharAnaliseInventarios();_carregarAnaliseInventarios(false);global.aplicarPermissoesAnalista?.();}

  function renderEstoqueRelAnaliseInventario(){
    const p=_parametrosDetalheInventarioDaUrl();
    const key=String(p.inventarioKey||'').trim();
    const lojaId=String(p.lojaId||'').trim();
    if(!key){
      _analiseEstado.detalhe={carregando:false,erro:'Inventário não informado na URL.',inventario:{inventario_key:'—'},itens:[],validacaoBluesoft:null};
      _desenharTelaDetalheInventario();
      global.aplicarPermissoesAnalista?.();
      return;
    }
    const d=_analiseEstado.detalhe||{};
    const mesmo=d.inventario&&String(d.inventario.inventario_key)===key&&String(d.inventario.loja_id||'')===lojaId;
    if(mesmo&&(d.carregando||d.itens?.length||d.erro)){
      _desenharTelaDetalheInventario();
    }else{
      _analiseEstado.detalhe={carregando:false,erro:'',inventario:null,itens:[],validacaoBluesoft:null};
      _abrirDetalheInventario({inventario_key:key,inventario_numero:key,loja_id:lojaId});
    }
    global.aplicarPermissoesAnalista?.();
  }

  function _renderRelatorio(relatorioId) {
    const cfg = RELATORIOS[relatorioId];
    const pagina = document.getElementById(cfg.pageId);
    if (!pagina) return;
    const estado = _estadoDe(relatorioId);
    if (!estado.periodoInicio || !estado.periodoFim) {
      const p = _periodoPadrao();
      estado.periodoInicio = estado.periodoInicio || p.ini;
      estado.periodoFim = estado.periodoFim || p.fim;
    }
    _desenhar(relatorioId);
    global.aplicarPermissoesAnalista?.();
  }

  function renderEstoqueRelInventario() { _renderRelatorio('inventario'); }
  function renderEstoqueRelDescarte() { _renderRelatorio('descarte'); }
  function renderEstoqueRelRequisicao() { _renderRelatorio('requisicao'); }
  function renderEstoqueRelTransformacao() { _renderRelatorio('transformacao'); }

  global.renderEstoqueRelAnalise = renderEstoqueRelAnalise;
  global.renderEstoqueRelAnaliseInventario = renderEstoqueRelAnaliseInventario;
  global.renderEstoqueRelInventario = renderEstoqueRelInventario;
  global.renderEstoqueRelDescarte = renderEstoqueRelDescarte;
  global.renderEstoqueRelRequisicao = renderEstoqueRelRequisicao;
  global.renderEstoqueRelTransformacao = renderEstoqueRelTransformacao;

  global._estoqueRelatoriosInternals = {
    RELATORIOS, GRUPOS_CAMPO, _agrupar, _formatarCelula, _valorColuna, fmtData, fmtDataHora, fmtNumero,
    _produtosDisponiveis, _linhasFiltradasPorProduto, _lojasDisponiveis, _linhasFiltradasPorLoja,
    _lancamentosDisponiveis, _linhasFiltradasPorLancamento, _chaveInventario, _kpisDeLinhas,
    _estadoDe, carregarDados, _periodoValido, _ordenar, _ehAdmin, podeExportar, _resumoAnalise, _topProdutos,
    _resetarEstado(id) { delete _estado[id]; },
  };
})(window);
