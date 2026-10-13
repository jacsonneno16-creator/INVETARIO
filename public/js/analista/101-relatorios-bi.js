// Produção > Relatórios BI (Compras / PCP / Produção)
// PEDIDO AO VIVO (2026-08-27): "já aplica as outras, os outros arquivos, já
// mapeia tudo... mas deixa pronto, que amanhã eu vou colocar pra ir via a
// API [Graph/SharePoint], que aí fica mais fácil... mapeia pra saber pra
// onde que vai cada informação, do compra, pcp e produção" — os 11 arquivos
// do BI que faltavam mapear são, na maioria, RELATÓRIOS JÁ CALCULADOS
// (estoque x pedido, MRP, escadinha, consumo de insumos, ranking de
// fornecedor), não dado operacional pra sincronizar num fluxo — por isso
// viram consulta somente-leitura aqui, sem gravar nada no Firebase (nem
// leitura nem escrita — só mostra o que está no arquivo, igual um
// PowerBI). Mesmo padrão de conexão de pasta das outras telas
// (bi-pasta-local.js); trocar a fonte pra API do SharePoint amanhã só
// exige mudar QUEM fornece o JSON pra cada relatório — a lista de colunas/
// transformação abaixo não muda nada.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Cada relatório: id, rótulo, setor (só organizacional, mostrado como
  // badge), arquivo do BI, colunas (chave+rótulo+opcional formatador), e
  // linhas() que extrai/achata o JSON bruto num array de objetos planos.
  // campoData + grande:true --> aplica filtro de período (padrão: últimos
  // 30 dias) antes de desenhar, pra nunca tentar renderizar dezenas de
  // milhares de linhas de uma vez.
  const fmtMoeda = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtNum = (casas) => v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 2 });
  const fmtData10 = v => String(v || '').slice(0, 10) || '—';
  // PEDIDO AO VIVO (2026-08-28): "cobertura de estoque... dezoito mil dias,
  // não entende nada como funciona aquilo ali" — confirmado nos dados reais
  // (dados-insumos.json chegou a mostrar 11.103 dias pra item com estoque
  // parado e consumo mensal baixíssimo: a conta bate, só não fica claro que
  // é excesso/item parado, não um erro). SÓ formatação — a conta em si (o
  // valor de `cobertura` que já vem pronto do arquivo) não muda; o usuário
  // ainda vai explicar como prefere calcular cobertura, então nada de
  // recalcular aqui.
  const fmtCoberturaDias = v => {
    if (v == null) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (n > 365) return 'Excesso (' + Math.round(n / 30).toLocaleString('pt-BR') + ' meses parado)';
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  };
  // PEDIDO AO VIVO (2026-08-27): "o que é transferência da matriz pra
  // filial, crie um campo Em Trânsito" — sempre HISTÓRICO (já recebido),
  // nunca tempo real: nenhum arquivo do BI hoje mostra uma transferência
  // ainda não chegada, só o que já foi recebido rotulado como transferência
  // em vez de compra.
  const fmtTipoOperacao = v => { const t = String(v || '').toUpperCase(); if (t === 'TRANSFERENCIA') return '🚚 Em Trânsito'; if (t === 'COMPRA') return '🛒 Compra'; if (t.startsWith('BONIFICA')) return '🎁 Bonificação'; return v || '—'; };
  // "MRO sai fora, logística sai fora" — decisão já fechada; os demais
  // departamentos continuam visíveis até o usuário decidir o resto.
  const DEPARTAMENTOS_EXCLUIDOS_COMPRAS = ['MRO', 'LOGISTICA'];

  function _linhasEstoqueDetalhado(dados) {
    return (dados.produtos || []).map(p => ({ ...p }));
  }

  const RELATORIOS = [
    {
      // PEDIDO AO VIVO (2026-08-28): "esse estoque versus pedidos tem que
      // aparecer só produto acabado, não pode aparecer insumo, porque não
      // vende insumo" — confirmado nos dados reais: produtos_estoque.json
      // mistura produto de venda de verdade com lixo tipo "MKT TRADE -
      // FOGAO ELETRICO..." (mercadoria/brinde, não é produto acabado nem
      // insumo). O arquivo não tem campo de tipo — filtrado por cruzamento
      // com o cadastro real (producao_produtos ∪ pcp_produtos_bluesoft,
      // mesma união já usada pra evitar contaminação no sync ao vivo do
      // PCP). Nunca some a lista inteira se a consulta falhar/vier vazia.
      id: 'estoque-produtos', label: 'Estoque de Produtos', setor: 'PCP', arquivo: 'produtos_estoque.json',
      somenteProdutoAcabado: true,
      linhas: dados => (Array.isArray(dados) ? dados : []).filter(d => d.produto_key != null),
      colunas: [
        ['loja', 'Loja'], ['produto_key', 'Cód.'], ['produto', 'Produto'],
        ['quantidade_estoque', 'Estoque', fmtNum(0)], ['quantidadePedidos', 'Pedidos', fmtNum(0)], ['coberturaDias', 'Cobertura (dias)', fmtNum(1)],
      ],
    },
    {
      // PEDIDO AO VIVO (2026-09-02): "Rank PCP — Estoque vs Pedidos... só
      // quatro colunas, produto/estoque/pedidos/saldo, saldo é estoque
      // menos pedido" — mesma fonte e mesmo filtro de produto acabado já
      // validados em 'estoque-produtos' (produtos_estoque.json já traz
      // quantidade_estoque e quantidadePedidos prontos por produto),
      // mas enxuto só nessas 4 colunas e ranqueado pelo saldo (menor
      // primeiro = maior falta de estoque frente ao pedido em aberto).
      id: 'rank-estoque-vs-pedidos', label: 'Rank — Estoque x Pedidos', setor: 'PCP', arquivo: 'produtos_estoque.json',
      somenteProdutoAcabado: true,
      linhas: dados => (Array.isArray(dados) ? dados : [])
        .filter(d => d.produto_key != null)
        .map(d => ({ produto: d.produto, estoque: Number(d.quantidade_estoque) || 0, pedidos: Number(d.quantidadePedidos) || 0, saldo: (Number(d.quantidade_estoque) || 0) - (Number(d.quantidadePedidos) || 0) }))
        .sort((a, b) => a.saldo - b.saldo),
      colunas: [
        ['produto', 'Produto'], ['estoque', 'Estoque', fmtNum(0)], ['pedidos', 'Pedidos', fmtNum(0)], ['saldo', 'Saldo', fmtNum(0)],
      ],
    },
    {
      id: 'estoque-produto-acabado', label: 'Estoque x Pedido — Produto Acabado', setor: 'PCP', arquivo: 'dados-estoque.json',
      linhas: _linhasEstoqueDetalhado,
      colunas: [
        ['sku', 'SKU'], ['produto', 'Produto'], ['loja', 'Loja'], ['fornecedor', 'Fornecedor'],
        ['estoque', 'Estoque', fmtNum(0)], ['saldo', 'Saldo', fmtNum(0)], ['cobertura', 'Cobertura (dias)', fmtCoberturaDias],
        ['consumoMensal', 'Consumo Mensal', fmtNum(0)], ['faturado', 'Faturado', fmtNum(0)], ['atingimento', 'Atingimento %', fmtNum(1)],
        ['sugestaoCompra', 'Sugestão de Compra', fmtNum(0)], ['status', 'Status'], ['motivoStatus', 'Motivo'], ['proximaEntrada', 'Próxima Entrada', fmtData10],
      ],
    },
    {
      id: 'estoque-insumos', label: 'Estoque x Pedido — Embalagens/Insumos', setor: 'Compras', arquivo: 'dados-insumos.json',
      linhas: _linhasEstoqueDetalhado,
      colunas: [
        ['sku', 'SKU'], ['produto', 'Produto'], ['loja', 'Loja'], ['fornecedor', 'Fornecedor'], ['tipo', 'Tipo'], ['categoria', 'Categoria'],
        ['estoque', 'Estoque', fmtNum(0)], ['saldo', 'Saldo', fmtNum(0)], ['cobertura', 'Cobertura (dias)', fmtCoberturaDias],
        ['consumoMensal', 'Consumo Mensal', fmtNum(0)], ['sugestaoCompra', 'Sugestão de Compra', fmtNum(0)], ['status', 'Status'], ['proximaEntrada', 'Próxima Entrada', fmtData10],
      ],
    },
    {
      id: 'mrp-terceiros', label: 'MRP — Terceiro e Revenda', setor: 'PCP', arquivo: 'dados-mrp-terceiros.json',
      linhas: _linhasEstoqueDetalhado,
      colunas: [
        ['sku', 'SKU'], ['produto', 'Produto'], ['secao', 'Seção'], ['estoqueFilial', 'Estoque Filial', fmtNum(0)], ['carteira', 'Carteira', fmtNum(0)],
        ['saldo', 'Saldo', fmtNum(0)], ['cobertura', 'Cobertura (dias)', fmtCoberturaDias], ['planoMes', 'Plano do Mês', fmtNum(0)], ['realMes', 'Real do Mês', fmtNum(0)],
        ['percentualPlano', '% do Plano', v => v == null ? '—' : (Number(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'], ['corteMes', 'Corte do Mês', fmtNum(0)],
        // PEDIDO AO VIVO (2026-08-28): "tem muita coisa que você não está
        // usando" — o arquivo já traz 3 meses de histórico (realMes1/2/3,
        // corteMes1/2/3), só o mês mais recente aparecia.
        ['realMes1', 'Real M-1', fmtNum(0)], ['realMes2', 'Real M-2', fmtNum(0)], ['realMes3', 'Real M-3', fmtNum(0)],
        ['corteMes1', 'Corte M-1', fmtNum(0)], ['corteMes2', 'Corte M-2', fmtNum(0)], ['corteMes3', 'Corte M-3', fmtNum(0)],
      ],
    },
    {
      id: 'escadinha-desvios', label: 'Escadinha — Desvios de Plano', setor: 'Produção', arquivo: 'dados-escadinha.json',
      linhas: dados => dados.desvios || [],
      colunas: [
        ['cod', 'Cód.'], ['produto', 'Produto'], ['marca', 'Marca'], ['categoria', 'Categoria'], ['mes', 'Mês'],
        ['planoAnterior', 'Plano Anterior', fmtNum(0)], ['planoAtual', 'Plano Atual', fmtNum(0)], ['desvio', 'Desvio', fmtNum(0)], ['desvioPercentual', 'Desvio %', fmtNum(1)],
      ],
    },
    {
      id: 'consumo-insumos-resumo', label: 'Consumo de Insumos — Resumo Mensal', setor: 'Compras', arquivo: 'dados-consumo-insumos.json',
      linhas: dados => dados.produtos || [],
      colunas: [
        ['sku', 'SKU'], ['produto', 'Produto'], ['lojaNome', 'Loja'], ['fornecedor', 'Fornecedor'], ['tipo', 'Tipo'], ['categoria', 'Categoria'],
        ['mediaMensal', 'Média Mensal', fmtNum(1)], ['totalPeriodo', 'Total no Período', fmtNum(0)],
      ],
    },
    {
      // PEDIDO AO VIVO (2026-08-28): "cruzar valor_insumos.json com a mesma
      // exclusão de MRO/Logística já pronta" — o arquivo já traz
      // Departamento por linha, mesmo tratamento do Histórico de Compras.
      id: 'valor-insumos', label: 'Valor de Insumos em Estoque', setor: 'Compras', arquivo: 'valor_insumos.json',
      excluirDepartamentosCompras: true,
      linhas: dados => Array.isArray(dados) ? dados : [],
      colunas: [
        ['data', 'Data', fmtData10], ['loja', 'Loja'], ['departamento', 'Departamento'], ['categoria', 'Categoria'], ['grupo', 'Grupo'],
        ['descricao', 'Produto'], ['valorEstoque', 'Valor em Estoque', fmtMoeda], ['custoContabil', 'Custo Contábil', fmtMoeda],
      ],
    },
    {
      id: 'fornecedores-ranking', label: 'Ranking de Fornecedores', setor: 'Compras', arquivo: 'fornecedores_agregado.json',
      linhas: dados => {
        const linhas = [];
        [['materia_prima', 'Matéria-prima'], ['produto_acabado', 'Produto acabado']].forEach(([chave, rotulo]) => {
          const bloco = dados[chave];
          if (!bloco || !bloco.anoData) return;
          Object.keys(bloco.anoData).forEach(ano => {
            (bloco.anoData[ano].top || []).forEach(t => linhas.push({ categoria: rotulo, ano, fornecedor: t.f, valor: t.valor, kg: t.kg, caixas: t.caixas }));
          });
        });
        return linhas;
      },
      colunas: [
        ['categoria', 'Categoria'], ['ano', 'Ano'], ['fornecedor', 'Fornecedor'], ['valor', 'Valor Total', fmtMoeda], ['kg', 'Kg', fmtNum(0)], ['caixas', 'Caixas', fmtNum(0)],
      ],
    },
    {
      id: 'compras-historico', label: 'Histórico de Compras', setor: 'Compras', arquivo: 'compras_produto.json',
      // PEDIDO AO VIVO (2026-08-27): "quero gravar mais só os dados desse
      // ano pra frente" — este é grande demais (87MB, 97 mil linhas) pra
      // buscar inteiro toda vez só pra mostrar; um robô no servidor já
      // sincroniza sozinho a cada 4h (functions/index.js,
      // sincronizarComprasHistoricoBiAgendado), gravando em pacotes na
      // coleção abaixo, só a partir de 2026. Esta tela LÊ os pacotes já
      // prontos (poucas leituras) em vez de buscar o arquivo pela API —
      // "Buscar" aqui só recarrega o que já está gravado; pra forçar o
      // servidor a buscar de novo do zero, use "Forçar sincronização".
      origemFirestore: 'relatorios_bi_compras_historico_chunks', funcaoSincronizacao: 'sincronizarComprasHistoricoBiAgora',
      excluirDepartamentosCompras: true,
      linhas: dados => Array.isArray(dados) ? dados : [], grande: true, campoData: 'data_emissao',
      colunas: [
        ['data_emissao', 'Emissão', fmtData10], ['data_recebimento', 'Recebimento', fmtData10], ['nf_numero', 'NF'], ['nome_abreviado', 'Fornecedor'],
        ['descricao', 'Produto'], ['departamento', 'Departamento'], ['secao', 'Seção'], ['tipo_operacao', 'Tipo', fmtTipoOperacao],
        ['quantidade_faturada', 'Qtd. Faturada', fmtNum(0)], ['custo_liq_unit', 'Custo Unit. Líquido', fmtMoeda],
        ['Custo_liquido_total', 'Custo Total Líquido', fmtMoeda], ['comprador_nome', 'Comprador'],
      ],
    },
    {
      id: 'cortes-pedido', label: 'Cortes de Pedido', setor: 'PCP', arquivo: 'dados_cortes.json',
      linhas: dados => Array.isArray(dados) ? dados : [], grande: true, campoData: 'data',
      colunas: [
        ['data', 'Data', fmtData10], ['produto_key', 'Cód.'], ['descricao', 'Produto'], ['quantidadePedidaCx', 'Qtd. Pedida (Cx)', fmtNum(0)],
        ['quantidadeFaturadaCx', 'Qtd. Faturada (Cx)', fmtNum(0)], ['corteRoteiroCx', 'Corte (Cx)', fmtNum(0)], ['valorPedidoTotal', 'Valor Pedido', fmtMoeda], ['faturamentoRs', 'Faturamento', fmtMoeda],
      ],
    },
    {
      id: 'consumo-insumos-detalhado', label: 'Consumo de Insumos — Movimentos', setor: 'Compras', arquivo: 'consumo_insumos.json',
      linhas: dados => Array.isArray(dados) ? dados : [], grande: true, campoData: 'data',
      colunas: [
        ['data', 'Data', fmtData10], ['loja', 'Loja'], ['produto', 'Insumo'], ['tipoMovimento', 'Tipo de Movimento'], ['quantidadeSinal', 'Quantidade', fmtNum(2)],
      ],
    },
  ];

  let _containerId = 'page-producao-relatorios-bi';
  let _relatorioAtivoId = RELATORIOS[0].id;
  let _linhasPorRelatorio = new Map(); // id -> linhas já lidas (só em memória, nunca persiste)
  let _ultimaBuscaPorRelatorio = new Map(); // id -> texto de status
  let _filtroTexto = '';
  let _filtroPeriodoIni = '';
  let _filtroPeriodoFim = '';
  // PEDIDO AO VIVO (2026-08-27): "o compras eu quero, mas com a seção...
  // acrescente lá nos filtros bobina, matéria-prima, essas coisas" — só
  // usados no relatório 'compras-historico', que tem departamento/seção.
  let _filtroDepartamentoCompras = '';
  let _filtroSecaoCompras = '';

  function _relatorioAtivo() { return RELATORIOS.find(r => r.id === _relatorioAtivoId) || RELATORIOS[0]; }

  function _linhasFiltradas() {
    const r = _relatorioAtivo();
    let linhas = _linhasPorRelatorio.get(r.id) || [];
    if (r.excluirDepartamentosCompras) linhas = linhas.filter(l => !DEPARTAMENTOS_EXCLUIDOS_COMPRAS.includes(String(l.departamento || '').toUpperCase()));
    if (r.id === 'compras-historico') {
      if (_filtroDepartamentoCompras) linhas = linhas.filter(l => l.departamento === _filtroDepartamentoCompras);
      if (_filtroSecaoCompras) linhas = linhas.filter(l => l.secao === _filtroSecaoCompras);
    }
    if (r.campoData && (_filtroPeriodoIni || _filtroPeriodoFim)) {
      linhas = linhas.filter(l => {
        const d = String(l[r.campoData] || '').slice(0, 10);
        if (!d) return false;
        if (_filtroPeriodoIni && d < _filtroPeriodoIni) return false;
        if (_filtroPeriodoFim && d > _filtroPeriodoFim) return false;
        return true;
      });
    }
    const f = _filtroTexto.trim().toLowerCase();
    if (f) linhas = linhas.filter(l => r.colunas.some(([chave]) => String(l[chave] ?? '').toLowerCase().includes(f)));
    return linhas;
  }

  // "não pode aparecer insumo, porque não vende insumo" — cruza com o
  // cadastro real da loja ativa (mesma união producao_produtos ∪
  // pcp_produtos_bluesoft já usada pra evitar contaminação no sync ao vivo
  // do PCP). Se a consulta falhar ou o cadastro vier vazio, devolve as
  // linhas sem filtrar — nunca esconde tudo por causa de uma falha de rede.
  async function _filtrarSomenteProdutoAcabado(linhas) {
    try {
      const [pp, pb] = await Promise.all([
        global.getDTFirestore().collection('producao_produtos').get(),
        global.getDTFirestore().collection('pcp_produtos_bluesoft').get(),
      ]);
      const cods = new Set();
      pp.docs.forEach(d => { const c = (d.data() || {}).cod; if (c != null) cods.add(String(c)); });
      pb.docs.forEach(d => { const c = (d.data() || {}).cod; if (c != null) cods.add(String(c)); });
      if (!cods.size) return linhas;
      return linhas.filter(l => cods.has(String(l.produto_key)));
    } catch (_) { return linhas; }
  }

  // Achata os documentos de uma coleção de chunks (cada um um mapa
  // {chave: registroResumido}) num array só — mesmo formato usado pro
  // ledger de venda em 97-recebimento-recusas.js.
  function _achatarChunks(snap) {
    const linhas = [];
    snap.docs.forEach(doc => { Object.values((doc.data() || {}).registros || {}).forEach(l => linhas.push(l)); });
    return linhas;
  }

  // PEDIDO AO VIVO (2026-08-28): "não precisa nem ser puxado direto de
  // novo, o todo ali é as informações que você já carregou nas outras
  // abas... dez vezes e nenhuma das dez funciona" — o Dashboard de Compras
  // (89-compras-dashboard.js) fazia sua PRÓPRIA busca de
  // relatorios_bi_compras_historico_chunks, uma leitura a mais que podia
  // falhar por conta própria. Agora reaproveita o MESMO cache desta tela
  // (se já foi aberta a aba Histórico de Compras, nem busca de novo) — uma
  // busca só, compartilhada por quem precisar deste histórico.
  // BUG AO VIVO REAL (2026-09-09): "aquilo lá ainda não estava gravado nem
  // tinha puxado nenhuma vez" — coleção grande (31 mil+ registros) sem
  // NENHUM limite de tempo; numa rede degradada, esse .get() ficava
  // pendurado pra sempre, sem erro nenhum. Ponto único usado por 3
  // chamadores (esta aba, 89-compras-dashboard.js e o Dashboard de
  // Recebimento) — protegendo aqui protege todos de uma vez. Mesmo padrão
  // de 30s já usado em produtos-service.js/99-recebimento-retornos-status.js.
  let _historicoComprasCarregandoPromise = null;
  let _historicoComprasFiltroCache = '';
  async function obterHistoricoComprasRealBi(forcar, filtros) {
    const inicio = filtros && filtros.inicio ? String(filtros.inicio) : '';
    const fim = filtros && filtros.fim ? String(filtros.fim) : '';
    const chaveFiltro = inicio && fim ? [inicio, fim, filtros.lojaKey || '', filtros.tipoOperacao || ''].join('|') : '';
    if (!forcar && _linhasPorRelatorio.has('compras-historico') && (!chaveFiltro || chaveFiltro === _historicoComprasFiltroCache)) return _linhasPorRelatorio.get('compras-historico');
    // Uma busca desse histórico pode ser pedida ao mesmo tempo pelo
    // Dashboard de Compras, Dashboard de Recebimento e Relatórios BI.
    // Enquanto a primeira estiver em andamento, todos aguardam a MESMA
    // consulta em vez de abrir outra leitura gigante em paralelo.
    if (_historicoComprasCarregandoPromise) return _historicoComprasCarregandoPromise;
    _historicoComprasCarregandoPromise = (async () => {
      // Caminho profissional: quando há um período explícito, o BigQuery já
      // filtra no servidor e devolve apenas as linhas pedidas. O fallback
      // Firestore fica temporariamente para a transição/primeiro deploy.
      if (inicio && fim && global.firebase && global.firebase.app) {
        try {
          const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarHistoricoComprasBigQuery');
          const resp = await callable({ inicio, fim, lojaKey: filtros.lojaKey || '', tipoOperacao: filtros.tipoOperacao || '' });
          const linhasBq = (resp && resp.data && Array.isArray(resp.data.linhas)) ? resp.data.linhas : [];
          _linhasPorRelatorio.set('compras-historico', linhasBq);
          _historicoComprasFiltroCache = chaveFiltro;
          return linhasBq;
        } catch (e) { throw new Error('Histórico indisponível no BigQuery: ' + (e && e.message ? e.message : e)); }
      }
      throw new Error('Informe um período para consultar o histórico de compras no BigQuery.');
    })();
    try {
      return await _historicoComprasCarregandoPromise;
    } finally {
      _historicoComprasCarregandoPromise = null;
    }
  }
  global.obterHistoricoComprasRealBi = obterHistoricoComprasRealBi;

  async function _buscarRelatorioAtivo() {
    const r = _relatorioAtivo();
    // PEDIDO AO VIVO (2026-08-27): relatório com origemFirestore já foi
    // sincronizado por um robô no servidor (a cada 4h) — só lê os poucos
    // pacotes já gravados (poucas leituras), nunca busca o arquivo inteiro
    // pela API. "Forçar sincronização" (botão separado) é quem pede pro
    // servidor buscar de novo.
    if (r.origemFirestore) {
      try {
        // Relatório grande já define o período ANTES da leitura: assim o
        // BigQuery filtra na origem em vez de baixar o histórico inteiro e
        // só depois aplicar os 30 dias no navegador.
        if (r.grande && !_filtroPeriodoIni && !_filtroPeriodoFim) {
          const fim = new Date(); const ini = new Date(); ini.setDate(ini.getDate() - 30);
          _filtroPeriodoIni = ini.toISOString().slice(0, 10);
          _filtroPeriodoFim = fim.toISOString().slice(0, 10);
        }
        // O histórico de compras já possui carregador compartilhado entre
        // três telas. Usá-lo aqui evita que a própria aba Relatórios BI
        // abra uma segunda leitura da mesma coleção enquanto outro dashboard
        // ainda está carregando.
        let linhas;
        if (r.id === 'compras-historico') linhas = await obterHistoricoComprasRealBi(true, {inicio: _filtroPeriodoIni, fim: _filtroPeriodoFim});
        else {
          const snap = await global.getDTRawFirestore().collection(r.origemFirestore).get();
          linhas = _achatarChunks(snap);
        }
        if (r.somenteProdutoAcabado) linhas = await _filtrarSomenteProdutoAcabado(linhas);
        _linhasPorRelatorio.set(r.id, linhas);
        _ultimaBuscaPorRelatorio.set(r.id, `${linhas.length.toLocaleString('pt-BR')} linha(s) já sincronizada(s) (o servidor atualiza sozinho a cada 4h).`);
        _desenhar();
      } catch (e) {
        _ultimaBuscaPorRelatorio.set(r.id, `Falha ao ler os dados sincronizados: ${e.message || e}`);
        global.showToast?.('Erro ao ler os dados: ' + (e.message || e), 'error');
        _desenhar();
      }
      return;
    }
    if (!global.DTBiPastaLocal?.suportado?.()) return;
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') {
      const resultado = await global.DTBiPastaLocal.conectar();
      if (!resultado.ok) { global.showToast?.(resultado.erro, 'error'); return; }
    }
    try {
      const dados = await global.DTBiPastaLocal.lerJson(r.arquivo);
      let linhas = r.linhas(dados) || [];
      if (r.somenteProdutoAcabado) linhas = await _filtrarSomenteProdutoAcabado(linhas);
      _linhasPorRelatorio.set(r.id, linhas);
      // Relatório "grande" (dezenas de milhares de linhas) já entra com um
      // período padrão (últimos 30 dias) pra nunca tentar renderizar tudo
      // de uma vez — o Analista pode alargar a janela manualmente depois.
      if (r.grande && !_filtroPeriodoIni && !_filtroPeriodoFim) {
        const fim = new Date(); const ini = new Date(); ini.setDate(ini.getDate() - 30);
        _filtroPeriodoIni = ini.toISOString().slice(0, 10);
        _filtroPeriodoFim = fim.toISOString().slice(0, 10);
      }
      _ultimaBuscaPorRelatorio.set(r.id, `${linhas.length.toLocaleString('pt-BR')} linha(s) lida(s) de ${r.arquivo}.`);
      _desenhar();
    } catch (e) {
      _ultimaBuscaPorRelatorio.set(r.id, `Falha ao buscar ${r.arquivo}: ${e.message || e}`);
      global.showToast?.('Erro ao buscar no BI: ' + (e.message || e), 'error');
      _desenhar();
    }
  }

  // Pede pro SERVIDOR buscar de novo do zero (não espera as 4h do
  // agendamento) — mesmo padrão do antigo "Rodar automático agora" da
  // Bluesoft, só que aqui chama a function de sincronização deste
  // relatório específico. Depois de rodar, já relê os pacotes atualizados.
  async function _forcarSincronizacaoRelatorioAtivo() {
    const r = _relatorioAtivo();
    if (!r.funcaoSincronizacao) return;
    const btn = document.querySelector('[data-rbi-forcar-sync]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando...'; }
    try {
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable(r.funcaoSincronizacao);
      const resposta = await callable({});
      global.showToast?.('Sincronização concluída: ' + JSON.stringify(resposta?.data?.resultado || resposta?.data || {}), 'success');
      await _buscarRelatorioAtivo();
    } catch (e) {
      global.showToast?.('Erro ao forçar sincronização: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Forçar sincronização agora'; }
    }
  }

  function _exportarRelatorioAtivo() {
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    const r = _relatorioAtivo();
    const linhas = _linhasFiltradas();
    if (!linhas.length) { global.showToast?.('Nenhuma linha pra exportar (busque ou ajuste os filtros).', 'error'); return; }
    const linhasExcel = linhas.map(l => {
      const obj = {};
      r.colunas.forEach(([chave, rotulo]) => { obj[rotulo] = l[chave] ?? ''; });
      return obj;
    });
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(linhasExcel), r.label.slice(0, 31));
    global.XLSX.writeFile(wb, r.id + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  function _tabsHtml() {
    const grupos = new Map();
    RELATORIOS.forEach(r => { if (!grupos.has(r.setor)) grupos.set(r.setor, []); grupos.get(r.setor).push(r); });
    return [...grupos.entries()].map(([setor, relatorios]) => `
      <div style="margin-bottom:6px"><span style="font-size:.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.03em">${esc(setor)}</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${relatorios.map(r => `<button type="button" class="btn ${r.id === _relatorioAtivoId ? 'btn-primary' : 'btn-ghost'} btn-sm" data-rbi-tab="${r.id}">${esc(r.label)}</button>`).join('')}</div></div>`).join('');
  }

  function _tabelaHtml() {
    const r = _relatorioAtivo();
    const linhas = _linhasFiltradas();
    const total = (_linhasPorRelatorio.get(r.id) || []).length;
    return `<div class="tc" style="padding:14px">
      <div style="overflow:auto"><table class="dt-table">
        <thead><tr>${r.colunas.map(([, rotulo]) => `<th>${esc(rotulo)}</th>`).join('')}</tr></thead>
        <tbody>${linhas.length ? linhas.slice(0, 300).map(l => `<tr>${r.colunas.map(([chave, , fmt]) => `<td>${esc(fmt ? fmt(l[chave]) : (l[chave] ?? '—'))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${r.colunas.length}"><div class="empty"><div class="empty-icon">📊</div><div class="empty-title">${total ? 'Nenhuma linha com esse filtro' : 'Clique em Buscar pra carregar este relatório'}</div></div></td></tr>`}</tbody>
      </table></div>
      ${linhas.length > 300 ? `<div style="font-size:.72rem;color:var(--muted);margin-top:8px">Mostrando as 300 primeiras de ${linhas.length.toLocaleString('pt-BR')} — refine o filtro ou exporte pro Excel pra ver tudo.</div>` : ''}
    </div>`;
  }

  // Opções dos dois seletores de 'compras-historico', calculadas a partir
  // do que já foi lido (MRO/LOGISTICA nunca aparecem — exclusão fixa).
  function _opcoesDepartamentoCompras() {
    const linhas = _linhasPorRelatorio.get('compras-historico') || [];
    const deps = new Set();
    linhas.forEach(l => { const d = String(l.departamento || '').trim(); if (d && !DEPARTAMENTOS_EXCLUIDOS_COMPRAS.includes(d.toUpperCase())) deps.add(d); });
    return [...deps].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  function _opcoesSecaoCompras() {
    const linhas = _linhasPorRelatorio.get('compras-historico') || [];
    const secoes = new Set();
    linhas.forEach(l => { if (_filtroDepartamentoCompras && l.departamento !== _filtroDepartamentoCompras) return; const s = String(l.secao || '').trim(); if (s) secoes.add(s); });
    return [...secoes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function _desenhar() {
    const pagina = document.getElementById(_containerId);
    if (!pagina) return;
    const r = _relatorioAtivo();
    const statusTexto = _ultimaBuscaPorRelatorio.get(r.id) || '';
    pagina.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div><h2 style="margin:0">📊 Relatórios BI</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Relatórios já calculados do BI (Compras/PCP/Produção). Escolha o relatório abaixo e clique em Buscar.</div></div>
      </div>
      <div class="tc" style="padding:14px;margin:14px 0">${_tabsHtml()}</div>
      <div class="tc" style="padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
          <div><b>${esc(r.label)}</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">${r.origemFirestore ? 'Já gravado no Firebase — todo mundo vê igual, atualiza sozinho no servidor a cada 4h.' : `Arquivo: <code>${esc(r.arquivo)}</code> — só nessa tela, não fica gravado.${global.DTBiPastaLocal?.suportado?.() ? '' : ' Serviço de busca do BI indisponível no momento (recarregue a página).'}`}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${(r.origemFirestore || global.DTBiPastaLocal?.suportado?.()) ? '<button type="button" class="btn btn-primary btn-sm" data-rbi-buscar="1">📊 Buscar</button>' : ''}
            ${r.funcaoSincronizacao ? '<button type="button" class="btn btn-ghost btn-sm" data-rbi-forcar-sync="1">🔄 Forçar sincronização agora</button>' : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-rbi-exportar="1">⬇ Exportar Excel</button>
          </div>
        </div>
        ${statusTexto ? `<div style="font-size:.7rem;color:var(--muted);margin-bottom:10px;padding:6px 10px;border-radius:8px;background:#f3f4f6">${esc(statusTexto)}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          ${r.campoData ? `<div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">DE</div><input class="field" id="rbi-filtro-ini" type="date" value="${esc(_filtroPeriodoIni)}" style="padding:8px"></div><div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input class="field" id="rbi-filtro-fim" type="date" value="${esc(_filtroPeriodoFim)}" style="padding:8px"></div>` : ''}
          ${r.id === 'compras-historico' ? `
          <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">DEPARTAMENTO</div><select class="field" id="rbi-filtro-departamento" style="padding:8px"><option value="">Todos (exceto MRO e Logística)</option>${_opcoesDepartamentoCompras().map(d => `<option value="${esc(d)}" ${_filtroDepartamentoCompras === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
          <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:3px">SEÇÃO</div><select class="field" id="rbi-filtro-secao" style="padding:8px"><option value="">Todas</option>${_opcoesSecaoCompras().map(s => `<option value="${esc(s)}" ${_filtroSecaoCompras === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>` : ''}
          <input class="field" id="rbi-filtro-texto" value="${esc(_filtroTexto)}" placeholder="Pesquisar..." style="max-width:240px;padding:8px">
        </div>
      </div>
      ${_tabelaHtml()}`;
    global.aplicarPermissoesAnalista?.();
  }

  async function renderRelatoriosBi(containerId) {
    _containerId = containerId || 'page-producao-relatorios-bi';
    _desenhar();
  }

  document.addEventListener('click', function (event) {
    const tab = event.target.closest('[data-rbi-tab]');
    if (tab) { _relatorioAtivoId = tab.getAttribute('data-rbi-tab'); _filtroTexto = ''; _filtroPeriodoIni = ''; _filtroPeriodoFim = ''; _filtroDepartamentoCompras = ''; _filtroSecaoCompras = ''; _desenhar(); return; }
    if (event.target.closest('[data-rbi-buscar]')) { _buscarRelatorioAtivo(); return; }
    if (event.target.closest('[data-rbi-forcar-sync]')) { _forcarSincronizacaoRelatorioAtivo(); return; }
    if (event.target.closest('[data-rbi-exportar]')) { _exportarRelatorioAtivo(); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target?.id === 'rbi-filtro-texto') { _filtroTexto = event.target.value || ''; _desenhar(); const el = document.getElementById('rbi-filtro-texto'); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} } }
  });
  document.addEventListener('change', function (event) {
    if (event.target?.id === 'rbi-filtro-ini') { _filtroPeriodoIni = event.target.value || ''; _desenhar(); }
    if (event.target?.id === 'rbi-filtro-fim') { _filtroPeriodoFim = event.target.value || ''; _desenhar(); }
    if (event.target?.id === 'rbi-filtro-departamento') { _filtroDepartamentoCompras = event.target.value || ''; _filtroSecaoCompras = ''; _desenhar(); }
    if (event.target?.id === 'rbi-filtro-secao') { _filtroSecaoCompras = event.target.value || ''; _desenhar(); }
  });

  global.renderRelatoriosBi = renderRelatoriosBi;
  global._DTRelatoriosBiInternals = { RELATORIOS, _linhasFiltradas, _buscarRelatorioAtivo, _forcarSincronizacaoRelatorioAtivo };
})(window);
