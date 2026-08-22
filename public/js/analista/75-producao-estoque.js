// Setor Produção — Estoque via Bluesoft (fase 3f da unificação com o
// Sistema de Produção; fase 11 migrou a busca/paginação/normalização pro
// serviço compartilhado 90-bluesoft-service.js, em vez de manter uma cópia
// própria; fase 12b passou a trazer só produto relevante — com estoque OU
// com pedido/reserva pendente — e paginar o resultado na tela, porque um
// catálogo grande (10-20 mil produtos) travava o navegador ao renderizar
// tudo de uma vez numa tabela só). A original tinha SUA PRÓPRIA
// configuração Bluesoft (token/URL num projeto Firebase separado,
// "programacao-producao"). Aqui não duplicamos nada disso: reaproveitamos a
// MESMA configuração (`dt_config/integracao_api`), a MESMA Cloud Function
// de proxy (`bluesoftProxy`, já existente neste projeto) e o MESMO vínculo
// loja→Bluesoft (`bluesoft_loja_key`/`bluesoft_loja_cd` em `lojas`, editado
// em Gestão de Lojas) que o Inventário já usa pra abrir inventário via API.
// Só a consulta “quanto tem agora” é nova aqui — sem gerar inventário, sem
// tocar em endereços/lotes.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const ITENS_POR_PAGINA = 100;

  let _lojas = [];
  let _lojaSelecionada = '';
  let _carregado = false;
  let _consultando = false;
  let _pagina = 1;
  let _ultimoResultado = null; // { itens, totalRecebido, lojaNome, atualizadoEm }

  function raw() { return global.getDTRawFirestore(); }

  async function carregarProducaoEstoque(forcar) {
    if (_carregado && !forcar) return;
    const snap = await raw().collection('lojas').get();
    _lojas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => l.bluesoft_loja_key);
    _carregado = true;
  }

  async function renderProducaoEstoque() {
    const pagina = document.getElementById('page-producao-estoque');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoEstoque(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoEstoque();
  }

  function _desenharProducaoEstoque() {
    const pagina = document.getElementById('page-producao-estoque');
    if (!pagina) return;

    if (!_lojas.length) {
      pagina.innerHTML = `
        <div style="margin-bottom:16px">
          <div class="page-title" style="font-size:1.1rem">📦 Estoque (Bluesoft)</div>
        </div>
        <div class="empty">
          <div class="empty-icon">🔗</div>
          <div class="empty-title">Nenhuma loja vinculada à Bluesoft</div>
          <div class="empty-sub">Vá em Gestão de Lojas e vincule ao menos uma loja a um código da Bluesoft para consultar estoque aqui.</div>
        </div>`;
      return;
    }

    const opcoes = _lojas.map(l => `<option value="${esc(l.id)}" ${_lojaSelecionada === l.id ? 'selected' : ''}>${esc(l.nome || l.codigo || l.id)}</option>`).join('');
    const resultado = _ultimoResultado;
    const itensOrdenados = resultado ? resultado.itens.slice().sort((a, b) => (b.estoqueAtual || 0) - (a.estoqueAtual || 0)) : [];
    const totalPaginas = Math.max(1, Math.ceil(itensOrdenados.length / ITENS_POR_PAGINA));
    if (_pagina > totalPaginas) _pagina = totalPaginas;
    const itensDaPagina = itensOrdenados.slice((_pagina - 1) * ITENS_POR_PAGINA, _pagina * ITENS_POR_PAGINA);

    let status = '';
    if (resultado) {
      status = itensOrdenados.length.toLocaleString('pt-BR') + ' produto(s) relevante(s) — com estoque ou pedido pendente';
      if (resultado.totalRecebido > itensOrdenados.length) status += ' (de ' + resultado.totalRecebido.toLocaleString('pt-BR') + ' recebido(s) da Bluesoft)';
      if (resultado.rotaSimplificada) status += ' · rota simplificada (sem reserva/trânsito/custo — a rota completa não retornou dados pra essa loja)';
      status += ' — ' + esc(resultado.lojaNome) + ' · atualizado ' + esc(resultado.atualizadoEm);
    }

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">📦 Estoque (Bluesoft)</div>
          <div style="font-size:.72rem;color:var(--muted)">Consulta em tempo real do saldo de estoque por loja/CD, via integração Bluesoft já configurada em Importar/Exportar. Só traz produto com saldo, reserva, trânsito ou pedido pendente — produto zerado e sem movimento fica de fora. Lojas comuns também trazem disponível, reservado, em trânsito, pedidos pendentes, consumo médio/dia e custo — o mesmo dado que alimenta o PCP.</div>
        </div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:16px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select id="pest-loja-sel" class="field" style="min-width:240px">
            <option value="">Selecione a loja...</option>
            ${opcoes}
          </select>
          <button type="button" class="btn btn-primary btn-sm" id="pest-btn-atualizar" ${_consultando ? 'disabled' : ''}>${_consultando ? '⏳ Buscando...' : '🔄 Consultar estoque'}</button>
          <span style="font-size:.76rem;color:var(--muted)" id="pest-status">${status}</span>
        </div>
      </div>

      <div class="tc">
        <div style="overflow:auto;max-height:65vh">
          <table class="dt-table">
            <thead><tr><th>Código</th><th>Produto</th><th style="text-align:right">Atual</th><th style="text-align:right">Disponível</th><th style="text-align:right">Reservado</th><th style="text-align:right">Em trânsito</th><th style="text-align:right">Pedidos pend.</th><th style="text-align:right">Consumo/dia</th><th style="text-align:right">Custo últ. compra</th></tr></thead>
            <tbody id="pest-tbody">
              ${resultado ? _linhasTabela(itensDaPagina) : `<tr><td colspan="9"><div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Selecione uma loja e clique em Consultar</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      ${resultado && itensOrdenados.length > ITENS_POR_PAGINA ? `
      <div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:12px">
        <button type="button" class="btn btn-ghost btn-sm" data-pest-pg="${_pagina - 1}" ${_pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
        <span style="font-size:.72rem;color:var(--muted)">Página ${_pagina} de ${totalPaginas}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-pest-pg="${_pagina + 1}" ${_pagina >= totalPaginas ? 'disabled' : ''}>Próxima ›</button>
      </div>` : ''}
    `;
  }

  function _linhasTabela(itens) {
    if (!itens.length) return `<tr><td colspan="9"><div class="empty"><div class="empty-title">Nenhum produto encontrado</div></div></td></tr>`;
    return itens.map(i => `<tr>
        <td style="font-family:monospace">${esc(i.cod)}</td>
        <td>${esc(i.descricao || '—')}</td>
        <td style="text-align:right;font-weight:700">${fmt(i.estoqueAtual)}</td>
        <td style="text-align:right">${fmt(i.estoqueDisponivel)}</td>
        <td style="text-align:right">${fmt(i.estoqueReservado)}</td>
        <td style="text-align:right">${fmt(i.estoqueEmTransito)}</td>
        <td style="text-align:right">${fmt(i.pedidosPendentes)}</td>
        <td style="text-align:right">${fmt(i.consumoDiaMedio)}</td>
        <td style="text-align:right">${i.custoUltimaCompra == null ? '—' : Number(i.custoUltimaCompra).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
      </tr>`).join('');
  }

  // Estoque de UMA loja via o serviço compartilhado (90-bluesoft-service.js)
  // — sem endereço/lote/validade (isso é específico do fluxo de abertura de
  // inventário, em 43-importar-exportar-api.js). O nome do produto não vem
  // no endpoint de estoque; reaproveita o catálogo (cacheado 24h) em vez de
  // fazer uma chamada nova só pra descrição.
  async function _consultarEstoqueLoja(loja) {
    const [resultadoEstoque, catalogo] = await Promise.all([
      global.obterEstoqueBluesoft(loja, true),
      global.obterCatalogoBluesoft(false).catch(() => []),
    ]);
    const nomesPorCod = new Map(catalogo.map(p => [p.cod, p.nome]));
    return {
      itens: resultadoEstoque.itens.map(i => ({ ...i, descricao: nomesPorCod.get(i.cod) || '' })),
      totalRecebido: resultadoEstoque.totalRecebido,
      rotaSimplificada: resultadoEstoque.rotaSimplificada,
    };
  }

  async function pestAtualizar() {
    const lojaId = document.getElementById('pest-loja-sel')?.value || '';
    if (!lojaId) { global.showToast?.('Selecione uma loja.', 'error'); return; }
    const loja = _lojas.find(l => l.id === lojaId);
    if (!loja) return;
    _lojaSelecionada = lojaId;
    _consultando = true;
    _pagina = 1;
    _desenharProducaoEstoque();
    try {
      const { itens, totalRecebido, rotaSimplificada } = await _consultarEstoqueLoja(loja);
      _ultimoResultado = { itens, totalRecebido, rotaSimplificada, lojaNome: loja.nome || loja.codigo || loja.id, atualizadoEm: new Date().toLocaleString('pt-BR') };
      global.showToast?.(itens.length.toLocaleString('pt-BR') + ' produto(s) relevante(s) encontrado(s).', 'success');
    } catch (e) {
      global.showToast?.('Erro ao buscar estoque: ' + (e.message || e), 'error');
    } finally {
      _consultando = false;
      _desenharProducaoEstoque();
    }
  }

  function pestIrPara(p) { _pagina = Math.max(1, p); _desenharProducaoEstoque(); }

  global.renderProducaoEstoque = renderProducaoEstoque;
  global.pestAtualizar = pestAtualizar;

  document.addEventListener('click', function (event) {
    if (event.target.closest('#pest-btn-atualizar')) { pestAtualizar(); return; }
    const pg = event.target.closest('[data-pest-pg]');
    if (pg) { pestIrPara(Number(pg.getAttribute('data-pest-pg'))); }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pest-loja-sel') { _lojaSelecionada = event.target.value; }
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _lojas=[]; _lojaSelecionada=''; _pagina=1; _ultimoResultado=null; });
})(window);
