// PCP — Fase 9: Acompanhamento de Compras. Cruza pcp_requisicoes_compra +
// pcp_agendamentos + construirVisao() (já carregados pelo próprio PCP) —
// não faz nenhuma consulta nova nem recalcula estoque/cobertura.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;

  let _f = { produto: '', categoria: '', fornecedor: '', status: '', prioridade: '', comprador: '', de: '', ate: '', atrasadas: false, criticas: false };

  function _statusBadge(s) {
    s = String(s || 'pendente');
    const c = /sem_comprador|sem_empresa_produtora|cancel|rejeit/i.test(s) ? 'b-red' : /parcial/i.test(s) ? 'b-orange' : /final|recebid|atendid|produzid/i.test(s) ? 'b-green' : /andamento|programad|comprad|em_producao|em_analise/i.test(s) ? 'b-blue' : 'b-orange';
    return `<span class="badge ${c}">${esc(s)}</span>`;
  }

  function _linhas() {
    const internos = global._pcpInternals || {};
    const reqs = internos.getReqs?.() || [];
    const agend = internos.getAgend?.() || [];
    const visao = internos.construirVisao?.() || [];
    const keyOf = internos.keyOf || (x => String(x.prodKey || x.cod || ''));
    const hojeStr = new Date().toISOString().slice(0, 10);
    return reqs.map(r => {
      const ag = agend.find(a => a.requisicaoId === r._id) || agend.find(a => a._id === 'req_' + r._id);
      const item = visao.find(v => v.key === keyOf(r));
      const solicitado = n(r.quantidade), comprado = n(r.quantidadeComprada), recebido = n(ag?.quantidadeRecebida);
      const saldo = Math.max(0, solicitado - comprado);
      const atrasada = !!(r.dataPrevista && r.dataPrevista < hojeStr && !/final/i.test(String(r.status || '')));
      const critica = (item?.coberturaDias != null && item.coberturaDias <= 3) || String(r.prioridade || '') === 'urgente';
      const dias = r.dataPrevista ? Math.round((new Date(r.dataPrevista + 'T00:00:00') - new Date(hojeStr + 'T00:00:00')) / 86400000) : null;
      const produtoCad = (internos.getProdutos?.() || []).find(p => keyOf(p) === keyOf(r));
      return { ...r, solicitado, comprado, recebido, saldo, atrasada, critica, dias, impactoCobertura: item?.coberturaProjetadaDias ?? null, categoriaProduto: produtoCad?.categoria || '' };
    });
  }

  function _filtradas() {
    const busca = _f.produto.trim().toLowerCase();
    return _linhas().filter(x =>
      (!busca || String(x.produto || '').toLowerCase().includes(busca)) &&
      (!_f.categoria || x.categoriaProduto === _f.categoria) &&
      (!_f.fornecedor || String(x.fornecedor || '').toLowerCase().includes(_f.fornecedor.toLowerCase())) &&
      (!_f.status || x.status === _f.status) &&
      (!_f.prioridade || x.prioridade === _f.prioridade) &&
      (!_f.comprador || x.compradorEmail === _f.comprador || x.compradorNome === _f.comprador) &&
      (!_f.de || (x.dataNecessaria || '') >= _f.de) &&
      (!_f.ate || (x.dataNecessaria || '') <= _f.ate) &&
      (!_f.atrasadas || x.atrasada) &&
      (!_f.criticas || x.critica)
    );
  }

  async function renderPCPComprasAcompanhamento() {
    const pagina = document.getElementById('page-pcp-compras-acompanhamento');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await global._pcpInternals.carregar(); } catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenhar();
  }

  function _desenhar() {
    const pagina = document.getElementById('page-pcp-compras-acompanhamento');
    if (!pagina) return;
    const linhas = _filtradas();
    const reqs = global._pcpInternals.getReqs?.() || [];
    const categorias = [...new Set((global._pcpInternals.getProdutos?.() || []).map(p => p.categoria).filter(Boolean))].sort();
    const compradores = [...new Set(reqs.map(r => r.compradorNome || r.compradorEmail).filter(Boolean))].sort();
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📦 Acompanhamento de Compras</div><div style="font-size:.74rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} requisição(ões) — solicitado × comprado × recebido × saldo</div></div>
      </div>
      <div class="tc" style="padding:10px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        <input class="field" id="pcpca-f-produto" placeholder="Produto" value="${esc(_f.produto)}" style="max-width:190px">
        <select class="field" id="pcpca-f-categoria" style="max-width:170px"><option value="">Todas categorias</option>${categorias.map(c => `<option ${c === _f.categoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <input class="field" id="pcpca-f-fornecedor" placeholder="Fornecedor" value="${esc(_f.fornecedor)}" style="max-width:170px">
        <select class="field" id="pcpca-f-status" style="max-width:170px"><option value="">Todos status</option>${['solicitada', 'sem_comprador', 'em_analise', 'comprada', 'parcialmente_recebida', 'finalizada'].map(s => `<option value="${s}" ${s === _f.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select class="field" id="pcpca-f-prioridade" style="max-width:150px"><option value="">Toda prioridade</option>${['normal', 'alta', 'urgente'].map(p => `<option value="${p}" ${p === _f.prioridade ? 'selected' : ''}>${p}</option>`).join('')}</select>
        <select class="field" id="pcpca-f-comprador" style="max-width:190px"><option value="">Todo comprador</option>${compradores.map(c => `<option ${c === _f.comprador ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <input type="date" class="field" id="pcpca-f-de" value="${esc(_f.de)}" style="max-width:145px" title="Data necessária de">
        <input type="date" class="field" id="pcpca-f-ate" value="${esc(_f.ate)}" style="max-width:145px" title="Data necessária até">
        <label style="display:flex;align-items:center;gap:5px;font-size:.76rem"><input type="checkbox" id="pcpca-f-atrasadas" ${_f.atrasadas ? 'checked' : ''}> Atrasadas</label>
        <label style="display:flex;align-items:center;gap:5px;font-size:.76rem"><input type="checkbox" id="pcpca-f-criticas" ${_f.criticas ? 'checked' : ''}> Críticas</label>
      </div>
      <div class="tc"><div style="overflow:auto"><table class="dt-table">
        <thead><tr><th>Produto</th><th>Solicitado</th><th>Comprado</th><th>Recebido</th><th>Saldo</th><th>Fornecedor</th><th>Preço unit.</th><th>Data pedido</th><th>Previsão</th><th>Dias</th><th>Status</th><th>Impacto cobertura</th></tr></thead>
        <tbody>${linhas.length ? linhas.map(x => `<tr ${x.atrasada ? 'style="background:rgba(239,68,68,.08)"' : ''}><td><b style="cursor:pointer" data-pcp-360="${esc(global._pcpInternals?.keyOf?.(x) || '')}">${esc(x.produto)}</b>${x.critica ? ' <span class="badge b-red" style="font-size:.6rem">crítico</span>' : ''}</td><td>${x.solicitado.toLocaleString('pt-BR')}</td><td>${x.comprado.toLocaleString('pt-BR')}</td><td>${x.recebido.toLocaleString('pt-BR')}</td><td><span class="badge ${x.saldo > 0 ? 'b-orange' : 'b-green'}">${x.saldo.toLocaleString('pt-BR')}</span></td><td>${esc(x.fornecedor || '—')}</td><td>${x.precoUnitario ? Number(x.precoUnitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td><td>${esc(x.compradoEm ? String(x.compradoEm).slice(0, 10) : '—')}</td><td>${esc(x.dataPrevista || '—')}</td><td>${x.dias == null ? '—' : (x.dias < 0 ? `<span class="badge b-red">${x.dias}d</span>` : x.dias + 'd')}</td><td>${_statusBadge(x.status)}</td><td>${x.impactoCobertura == null ? '—' : x.impactoCobertura.toFixed(1) + 'd'}</td></tr>`).join('') : '<tr><td colspan="12">Nenhuma requisição encontrada com os filtros atuais.</td></tr>'}</tbody>
      </table></div></div>`;
  }

  global.pcpRegistrarPagina?.('compras-acompanhamento', { elId: 'page-pcp-compras-acompanhamento', render: 'renderPCPComprasAcompanhamento', titulo: 'Acompanhamento de Compras' });
  global.renderPCPComprasAcompanhamento = renderPCPComprasAcompanhamento;

  document.addEventListener('input', function (event) {
    const id = event.target && event.target.id;
    if (id === 'pcpca-f-produto') { _f.produto = event.target.value; _desenhar(); }
    else if (id === 'pcpca-f-fornecedor') { _f.fornecedor = event.target.value; _desenhar(); }
  });
  document.addEventListener('change', function (event) {
    const el = event.target; if (!el || !el.id || !el.id.startsWith('pcpca-f-')) return;
    const campo = el.id.replace('pcpca-f-', '');
    const map = { categoria: 'categoria', status: 'status', prioridade: 'prioridade', comprador: 'comprador', de: 'de', ate: 'ate' };
    if (map[campo]) { _f[map[campo]] = el.value; _desenhar(); return; }
    if (campo === 'atrasadas') { _f.atrasadas = el.checked; _desenhar(); return; }
    if (campo === 'criticas') { _f.criticas = el.checked; _desenhar(); return; }
  });
})(window);
