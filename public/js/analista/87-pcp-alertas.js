// PCP — Fase 10: Central de Alertas. 100% derivada — nenhuma consulta nova,
// nenhum cálculo paralelo: usa construirVisao() + requisições/agendamentos
// já carregados pelo PCP, e o cruzamento de insumos já existente (65/85).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const ORDEM_COR = { red: 0, orange: 1, yellow: 2, green: 3 };

  async function _calcularAlertas() {
    const internos = global._pcpInternals;
    await internos.carregar();
    const visao = internos.construirVisao({ estoqueBi: internos.getEstoqueBi?.() });
    const reqs = internos.getReqs?.() || [];
    const agend = internos.getAgend?.() || [];
    const hojeStr = new Date().toISOString().slice(0, 10);
    const alertas = [];

    visao.forEach(item => {
      if (item.estoqueAtual <= 0) {
        alertas.push({ tipo: 'sem_estoque', cor: 'red', icone: '🔴', titulo: 'Sem estoque: ' + item.produto, detalhe: 'Estoque atual zerado ou negativo.', aba: 'estoque', key: item.key });
      } else if (item.coberturaDias != null && item.coberturaDias <= 3) {
        alertas.push({ tipo: 'critico', cor: 'red', icone: '🔴', titulo: 'Estoque crítico: ' + item.produto, detalhe: 'Cobertura de ' + item.coberturaDias.toFixed(1) + ' dias.', aba: 'estoque', key: item.key });
      } else if (item.coberturaProjetadaDias != null && item.coberturaProjetadaDias < item.diasAlvo) {
        alertas.push({ tipo: 'abaixo_cobertura', cor: 'orange', icone: '🟠', titulo: 'Abaixo da cobertura desejada: ' + item.produto, detalhe: 'Projetada ' + item.coberturaProjetadaDias.toFixed(1) + 'd, desejada ' + item.diasAlvo + 'd.', aba: 'pedidos-estoque', key: item.key });
      }
    });

    agend.filter(a => a.dataPrevista && a.dataPrevista < hojeStr && !/final/i.test(String(a.status || ''))).forEach(a => {
      alertas.push({ tipo: 'compra_atrasada', cor: 'red', icone: '🔴', titulo: 'Compra atrasada: ' + a.produto, detalhe: 'Previsão era ' + a.dataPrevista + '.', aba: 'agendamentos' });
    });

    reqs.filter(r => r.status === 'comprada' && n(r.quantidadeComprada) < n(r.quantidade)).forEach(r => {
      alertas.push({ tipo: 'compra_insuficiente', cor: 'orange', icone: '🟠', titulo: 'Compra não cobre a necessidade: ' + r.produto, detalhe: 'Solicitado ' + n(r.quantidade).toLocaleString('pt-BR') + ', comprado ' + n(r.quantidadeComprada).toLocaleString('pt-BR') + '.', aba: 'compras-acompanhamento' });
    });

    reqs.filter(r => r.tipoSolicitacao === 'insumo' && !(n(r.quantidadeComprada) > 0) && !/cancel|final/i.test(String(r.status || ''))).forEach(r => {
      alertas.push({ tipo: 'insumo_nao_comprado', cor: 'red', icone: '🔴', titulo: 'Insumo ainda não comprado: ' + r.produto, detalhe: 'Necessário para a produção programada.', aba: 'producao-insumo' });
    });

    try {
      if (typeof global.carregarProducaoInsumos === 'function' && typeof global.calcularNecessidadeInsumosPorOPs === 'function') {
        await global.carregarProducaoInsumos();
        const internosIns = global._producaoInsumosInternals || {};
        const registros = internosIns.getRegistros?.() || [];
        const fichas = internosIns.getFichas?.() || [];
        const estoque = internosIns.getEstoque?.() || [];
        const daqui30 = new Date(); daqui30.setDate(daqui30.getDate() + 30);
        const resultado = global.calcularNecessidadeInsumosPorOPs(registros, fichas, hojeStr, daqui30.toISOString().slice(0, 10));
        const estoqueMap = new Map(estoque.map(e => [norm(e.insumo || e.nome), e]));
        resultado.porInsumo.forEach(x => {
          const est = estoqueMap.get(norm(x.insumo));
          const disp = n(est?.quantidade);
          if (disp - x.necessidade < 0) {
            alertas.push({ tipo: 'producao_sem_insumo', cor: 'yellow', icone: '🟡', titulo: 'Produção sem insumo suficiente: ' + x.insumo, detalhe: 'Falta ' + (x.necessidade - disp).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' ' + (est?.unidade || ''), aba: 'producao-insumo' });
          }
        });
      }
    } catch (e) { console.warn('[pcp-alertas] insumos:', e); }

    const limite24h = Date.now() - 24 * 60 * 60 * 1000;
    agend.filter(a => a.recebidoEm && new Date(a.recebidoEm).getTime() > limite24h).forEach(a => {
      alertas.push({ tipo: 'compra_recebida', cor: 'green', icone: '🟢', titulo: 'Compra recebida: ' + a.produto, detalhe: 'Recebido em ' + String(a.recebidoEm).slice(0, 16).replace('T', ' ') + '.', aba: 'agendamentos' });
    });

    return alertas.sort((a, b) => (ORDEM_COR[a.cor] ?? 9) - (ORDEM_COR[b.cor] ?? 9));
  }

  async function renderPCPAlertas() {
    const pagina = document.getElementById('page-pcp-alertas');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Calculando alertas...</div></div>';
    try { _desenhar(await _calcularAlertas()); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; }
  }

  function _desenhar(alertas) {
    const pagina = document.getElementById('page-pcp-alertas');
    if (!pagina) return;
    const criticos = alertas.filter(a => a.cor === 'red').length;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">🚨 Central de Alertas</div><div style="font-size:.74rem;color:var(--muted)">${alertas.length} alerta(s) — ${criticos} crítico(s)</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-pcpal-refresh>↻ Atualizar</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${alertas.length ? alertas.map(a => `
          <div class="tc" style="padding:10px 14px;display:flex;align-items:center;gap:10px;cursor:pointer" data-pcpal-ir="${esc(a.aba)}" ${a.key ? `data-pcpal-key="${esc(a.key)}"` : ''}>
            <span style="font-size:1.2rem">${a.icone}</span>
            <div style="flex:1"><b>${esc(a.titulo)}</b><div style="font-size:.74rem;color:var(--muted)">${esc(a.detalhe)}</div></div>
            <span class="badge b-${a.cor === 'yellow' ? 'orange' : a.cor}">${esc(a.tipo)}</span>
          </div>`).join('') : '<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Nenhum alerta no momento</div></div>'}
      </div>`;
  }

  global.pcpRegistrarPagina?.('alertas', { elId: 'page-pcp-alertas', render: 'renderPCPAlertas', titulo: 'Alertas' });
  global.renderPCPAlertas = renderPCPAlertas;
  global._pcpAlertasInternals = { calcularAlertas: _calcularAlertas };

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-pcpal-refresh]')) { renderPCPAlertas(); return; }
    const card = event.target.closest('[data-pcpal-ir]');
    if (card) {
      const aba = card.getAttribute('data-pcpal-ir');
      const key = card.getAttribute('data-pcpal-key');
      const navId = 'nav-pcp-' + (aba === 'pedidos-estoque' ? 'cruzamento' : aba);
      global.pcpIrParaAba?.(aba, document.getElementById(navId));
      if (key) setTimeout(() => global.modalMemoria?.(key), 60);
    }
  });
})(window);
