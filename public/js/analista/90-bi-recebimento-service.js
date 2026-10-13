// Serviço leve do Recebimento para dados já materializados pelo BI/SharePoint.
// Não contém URL, proxy nem chamada à API BlueSoft. É carregado sob demanda
// somente quando o setor Recebimento é aberto.
(function (global) {
  'use strict';

  const TIPOS_DEVOLUCAO = ['DEVOLUCAO_ENTRE_LOJAS', 'DEVOLUCAO_CLIENTE'];
  const RE_NATUREZA_NAO_RECEBIMENTO = /\bDEV(OL|\.)|\bRETORNO\b/;
  const norm = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const raw = () => global.getDTRawFirestore();

  function ehNotaDevolucao(nota) {
    return TIPOS_DEVOLUCAO.includes(nota?.tipoTransferencia)
      || RE_NATUREZA_NAO_RECEBIMENTO.test(norm(nota?.natureza));
  }

  function categoriaNota(nota) {
    if (ehNotaDevolucao(nota)) return 'DEVOLUCAO';
    if (nota?.tipoTransferencia === 'TRANSFERENCIA_ENTRE_LOJAS') return 'TRANSBORDO';
    if (norm(nota?.natureza).includes('TRANSFER')) return 'TRANSBORDO';
    return 'FORNECEDOR';
  }

  function agruparComprasPorPedido(itens, lojaKeyFiltro) {
    const porPedido = new Map();
    (itens || []).forEach(item => {
      if (lojaKeyFiltro != null && String(item.loja_key) !== String(lojaKeyFiltro)) return;
      const pendente = Number(item.qtd_unidades_pendentes) || 0;
      const numeroPedido = item.pedido_key != null ? String(item.pedido_key) : '';
      if (pendente <= 0 || !numeroPedido) return;
      if (!porPedido.has(numeroPedido)) {
        porPedido.set(numeroPedido, {
          numeroPedido, fornecedorNome: item.fornecedor || '', compradorNome: item.comprador || '',
          dataEntregaInicial: '', dataEntregaFinal: '', itensPorProduto: new Map(),
        });
      }
      const pedido = porPedido.get(numeroPedido);
      const dataIni = item.data_entrega_inicial ? String(item.data_entrega_inicial).slice(0, 10) : '';
      const dataFim = item.data_entrega_final ? String(item.data_entrega_final).slice(0, 10) : '';
      if (dataIni && (!pedido.dataEntregaInicial || dataIni < pedido.dataEntregaInicial)) pedido.dataEntregaInicial = dataIni;
      if (dataFim && (!pedido.dataEntregaFinal || dataFim > pedido.dataEntregaFinal)) pedido.dataEntregaFinal = dataFim;
      const produtoKey = item.produto_key != null ? String(item.produto_key) : String(item.descricao || '');
      const produto = pedido.itensPorProduto.get(produtoKey) || { produto: item.descricao || '', tipoProduto: '', quantidadePendente: 0 };
      produto.quantidadePendente += pendente;
      pedido.itensPorProduto.set(produtoKey, produto);
    });
    return [...porPedido.values()].map(pedido => ({
      numeroPedido: pedido.numeroPedido, fornecedorNome: pedido.fornecedorNome,
      compradorNome: pedido.compradorNome, entregaPendente: true,
      dataEntregaInicial: pedido.dataEntregaInicial, dataEntregaFinal: pedido.dataEntregaFinal,
      itens: [...pedido.itensPorProduto.values()],
    }));
  }

  async function gravarAgendaMaterializada(pendentes, loja) {
    const fs = global.getDTFirestore();
    const numeros = [...new Set(pendentes.map(p => String(p.numeroPedido || '')).filter(Boolean))];
    const existentes = new Map();
    // Consulta somente os pedidos presentes no arquivo manual. Não há fallback
    // para leitura integral da coleção se uma consulta direcionada falhar.
    for (let i = 0; i < numeros.length; i += 10) {
      const lote = numeros.slice(i, i + 10);
      const snap = await fs.collection('recebimento_agendamentos').where('numeroPedido', 'in', lote).get();
      snap.docs.forEach(doc => {
        const dados = doc.data() || {};
        if (dados.numeroPedido != null) existentes.set(String(dados.numeroPedido), { id: doc.id, dados });
      });
    }

    const agora = new Date().toISOString();
    let criados = 0;
    let atualizados = 0;
    for (let i = 0; i < pendentes.length; i += 300) {
      const batch = raw().batch();
      pendentes.slice(i, i + 300).forEach(pedido => {
        const existente = existentes.get(String(pedido.numeroPedido));
        const ref = existente
          ? fs.collection('recebimento_agendamentos').doc(existente.id)
          : fs.collection('recebimento_agendamentos').doc();
        const base = {
          origem: 'bi', lojaId: loja.id, lojaNome: loja.nome || loja.codigo || loja.id,
          numeroPedido: pedido.numeroPedido, fornecedorNome: pedido.fornecedorNome || 'Fornecedor',
          dataPrevista: pedido.dataEntregaInicial || '', dataEntregaFinal: pedido.dataEntregaFinal || null,
          compradorNome: pedido.compradorNome || '', itensPedido: pedido.itens || [],
          biSincronizadoEm: agora, atualizadoEm: agora,
        };
        if (existente) {
          batch.set(ref, base, { merge: true });
          atualizados++;
        } else {
          batch.set(ref, Object.assign(base, {
            dataAgendada: '', horaAgendada: '', codigo: 'PC-' + pedido.numeroPedido,
            motoristaNome: '', placa: '', status: 'AGENDADO',
            observacao: 'Pedido de compra #' + pedido.numeroPedido + ' — importado do BI/SharePoint',
            criadoEm: agora,
          }), { merge: true });
          criados++;
        }
      });
      await batch.commit();
    }
    return { criados, atualizados };
  }

  async function importarComprasAReceberBiJson(registros) {
    if (!Array.isArray(registros)) throw new Error('Formato inesperado — esperava uma lista de registros.');
    const lojaId = global.getDTLojaAtiva?.();
    if (!lojaId) throw new Error('Nenhuma loja selecionada.');
    const lojaSnap = await raw().collection('lojas').doc(lojaId).get();
    if (!lojaSnap.exists) throw new Error('Loja não encontrada.');
    const loja = { id: lojaId, ...lojaSnap.data() };
    const pendentes = agruparComprasPorPedido(registros, loja.bluesoft_loja_key ?? null);
    if (!pendentes.length) throw new Error('Nenhum pedido de compra pendente encontrado para esta loja.');
    const resultado = await gravarAgendaMaterializada(pendentes, loja);
    return { totalPedidosPendentes: pendentes.length, ...resultado };
  }

  global.ehNotaDevolucaoBluesoft = ehNotaDevolucao;
  global.categoriaNotaBluesoft = categoriaNota;
  global.importarComprasAReceberBiJson = importarComprasAReceberBiJson;
  global._biRecebimentoServiceInternals = { agruparComprasPorPedido, gravarAgendaMaterializada };
})(window);
