// PCP — Fase 2.4: Insumo 360°.
// Drill-down de matéria-prima/embalagem usando EXCLUSIVAMENTE dados já
// carregados em memória pelo PCP Central (dados-insumos.json) e pelo MRP de
// Produção (65/85). Este arquivo não acessa Firestore nem BI diretamente.
(function (global) {
  'use strict';

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const fmt = (v, casas) => n(v).toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 2 : casas });
  let _chave = '';
  let _nome = '';

  function _norm(v) {
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  }
  function _canon(v) {
    const fn = global._producaoInsumosInternals && global._producaoInsumosInternals.canonInsumo;
    if (typeof fn === 'function') return fn(v);
    return _norm(v).replace(/^\s*\d+[^A-Z0-9]*/, '').replace(/^\s*(MP|MAT(?:ERIA)?\s*PRIMA|MATERIA\s*PRIMA|LOGISTICA)[^A-Z0-9]+/, '').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function _insumoDaFicha(i) {
    i = i || {};
    return {
      nome: i.insumo || i.nome || i.desc_insumo || i.descricao || '',
      cod: String(i.bluesoftProdutoKey != null ? i.bluesoftProdutoKey : (i.produtoKey != null ? i.produtoKey : (i.cod != null ? i.cod : (i.codigo != null ? i.codigo : '')))).trim(),
      qty: n(i.qty != null ? i.qty : (i.qtd != null ? i.qtd : (i.quantidade != null ? i.quantidade : i.consumoPorCaixa))),
      categoria: i.categoria || i.cat || ''
    };
  }
  function _match(cod, nome, candidatoCod, candidatoNome) {
    if (cod && candidatoCod && String(cod) === String(candidatoCod)) return true;
    return !!nome && !!candidatoNome && _canon(nome) === _canon(candidatoNome);
  }
  function _acharBi() {
    const lista = global._pcpInternals && global._pcpInternals.getInsumosBi ? (global._pcpInternals.getInsumosBi() || []) : [];
    return lista.find(x => _match(_chave, _nome, x.cod, x.produto)) || null;
  }
  function _produtosQueUsam() {
    const internos = global._producaoInsumosInternals || {};
    const fichas = internos.getFichas ? (internos.getFichas() || []) : [];
    const out = [];
    fichas.forEach(f => {
      const itens = Array.isArray(f.insumos) ? f.insumos : [];
      itens.forEach(raw => {
        const i = _insumoDaFicha(raw);
        if (_match(_chave, _nome, i.cod, i.nome)) {
          out.push({ codProduto: String(f.cod != null ? f.cod : (f.codigo != null ? f.codigo : (f.produtoCod != null ? f.produtoCod : ''))), produto: f.desc || f.descricao || f.produto || f.nome || 'Produto sem descrição', qty: i.qty, categoria: i.categoria });
        }
      });
    });
    return out.sort((a, b) => String(a.produto).localeCompare(String(b.produto), 'pt-BR'));
  }
  function _opsRelacionadas() {
    const ultimo = global._pcpProducaoInsumosInternals && global._pcpProducaoInsumosInternals.getUltimoCalculo ? global._pcpProducaoInsumosInternals.getUltimoCalculo() : null;
    const ops = ultimo && Array.isArray(ultimo.porOP) ? ultimo.porOP : [];
    const out = [];
    ops.forEach(op => {
      (op.insumos || []).forEach(i => {
        if (_match(_chave, _nome, i.cod, i.insumo)) out.push({ produto: op.produto || '', maquina: op.maquina || '', data: op.data || '', caixas: n(op.qntCaixas), necessidade: n(i.necessidade) });
      });
    });
    return out.sort((a, b) => String(a.data).localeCompare(String(b.data)));
  }
  function _necessidadeProgramada() {
    const ultimo = global._pcpProducaoInsumosInternals && global._pcpProducaoInsumosInternals.getUltimoCalculo ? global._pcpProducaoInsumosInternals.getUltimoCalculo() : null;
    const lista = ultimo && Array.isArray(ultimo.porInsumo) ? ultimo.porInsumo : [];
    return lista.find(x => _match(_chave, _nome, x.cod, x.insumo)) || null;
  }
  function _riscoPorOps(estoque, ops) {
    let saldo = Math.max(0, n(estoque));
    let rupturaEm = '';
    for (const op of ops) {
      saldo -= n(op.necessidade);
      if (!rupturaEm && saldo < 0) rupturaEm = op.data || '';
    }
    return { saldoProjetado: saldo, rupturaEm: rupturaEm };
  }
  function _estado(bi, necessidade, ops) {
    const estoque = bi ? n(bi.estoque) : n(necessidade && necessidade.disponivel);
    const consumo = bi ? n(bi.consumoMensal) : 0;
    const cob = bi && bi.coberturaDias != null ? Number(bi.coberturaDias) : null;
    const necProd = necessidade ? n(necessidade.necessidade) : ops.reduce((s, x) => s + n(x.necessidade), 0);
    const riscoOps = _riscoPorOps(estoque, ops);
    const faltaProd = Math.max(0, -riscoOps.saldoProjetado);
    const alvo = bi ? n(bi.estoqueAlvo) : 0;
    const reposicaoCobertura = bi ? Math.max(0, alvo - estoque) : 0;
    return { estoque, consumoMensal: consumo, coberturaDias: cob, necessidadeProducao: necProd, saldoAposProgramacao: riscoOps.saldoProjetado, faltaProducao: faltaProd, rupturaEm: riscoOps.rupturaEm, reposicaoCobertura, sugestao: Math.max(faltaProd, reposicaoCobertura) };
  }

  function abrirInsumo360(chave, nome) {
    _chave = String(chave || '');
    _nome = String(nome || chave || '');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('on'));
    const page = document.getElementById('page-pcp-insumo-360');
    if (page) page.classList.add('on');
    const titulo = document.getElementById('page-title');
    if (titulo) titulo.textContent = 'PCP · Insumo 360°';
    renderPCPInsumo360();
  }

  function renderPCPInsumo360() {
    const pagina = document.getElementById('page-pcp-insumo-360');
    if (!pagina) return;
    const bi = _acharBi();
    const necessidade = _necessidadeProgramada();
    const produtos = _produtosQueUsam();
    const ops = _opsRelacionadas();
    const estado = _estado(bi, necessidade, ops);
    const nome = (bi && bi.produto) || (necessidade && necessidade.insumo) || _nome || _chave;
    const cod = (bi && bi.cod) || (necessidade && necessidade.cod) || (_chave !== _nome ? _chave : '');
    const unidade = (bi && bi.unidade) || (necessidade && necessidade.unidade) || '';
    const grupo = bi ? (bi.grupo === 'materia-prima' ? 'Matéria-prima' : 'Insumo / embalagem') : ((necessidade && necessidade.categoria) || '—');
    const tipo = bi ? (bi.tipo || bi.categoria || '—') : ((necessidade && necessidade.categoria) || '—');
    const horizonte = global._pcpProducaoInsumosInternals && global._pcpProducaoInsumosInternals.getHorizonte ? global._pcpProducaoInsumosInternals.getHorizonte() : 30;
    const alertaDados = !bi ? '<div class="tc" style="padding:10px;margin-bottom:12px;border-left:3px solid var(--warning)"><b>Estoque/consumo do BI não carregado nesta sessão.</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Abra PCP › Insumos e use “Buscar do BI”. O Insumo 360° não faz uma leitura nova por conta própria.</div></div>' : '';
    const alertaMrp = !produtos.length && !ops.length ? '<div class="tc" style="padding:10px;margin-bottom:12px"><b>Detalhamento de produção ainda não está em memória.</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px">Abra “Insumos da Produção” para carregar ficha técnica e OPs. Esta tela reaproveita esse cache e não dispara uma nova consulta.</div></div>' : '';
    const acao = estado.sugestao > 0 ? ('Repor aproximadamente ' + fmt(Math.ceil(estado.sugestao), 0) + (unidade ? ' ' + esc(unidade) : '')) : 'Sem reposição sugerida pelos dados carregados';

    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.2rem">🧪 ${esc(nome)}</div><div style="font-size:.74rem;color:var(--muted)">${cod ? 'Cód. ' + esc(cod) + ' · ' : ''}${esc(grupo)} · ${esc(tipo)}</div></div>
        <button class="btn btn-ghost btn-sm" type="button" data-pcp-insumo-voltar>← Voltar para Insumos</button>
      </div>
      ${alertaDados}${alertaMrp}
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${fmt(estado.estoque, 2)}</div><div class="kpi-lbl">Estoque${unidade ? ' (' + esc(unidade) + ')' : ''}</div></div>
        <div class="kpi purple"><div class="kpi-val">${fmt(estado.consumoMensal, 2)}</div><div class="kpi-lbl">Consumo mensal</div></div>
        <div class="kpi ${estado.coberturaDias==null?'blue':(global._pcpInternals?.riscoCoberturaInsumo?.(estado.coberturaDias)||'b-blue').replace('b-','')}"><div class="kpi-val">${estado.coberturaDias == null ? '—' : estado.coberturaDias.toFixed(1) + 'd'}</div><div class="kpi-lbl">Cobertura atual</div></div>
        <div class="kpi ${estado.faltaProducao > 0 ? 'red' : 'teal'}"><div class="kpi-val">${fmt(estado.necessidadeProducao, 2)}</div><div class="kpi-lbl">Necessário na programação (${horizonte}d)</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
        <div class="tc" style="padding:12px"><b>📦 Situação do material</b><table class="dt-table" style="margin-top:8px"><tbody>
          <tr><td>Estoque atual</td><td style="text-align:right">${fmt(estado.estoque, 2)} ${esc(unidade)}</td></tr>
          <tr><td>Estoque alvo / meta</td><td style="text-align:right">${bi ? fmt(bi.estoqueAlvo, 2) + ' ' + esc(unidade) + ' / ' + n(bi.diasAlvo).toFixed(0) + 'd' : '—'}</td></tr>
          <tr><td>Necessidade pela cobertura</td><td style="text-align:right">${fmt(estado.reposicaoCobertura, 2)} ${esc(unidade)}</td></tr>
          <tr><td>Fornecedor</td><td style="text-align:right">${esc((bi && bi.fornecedor) || '—')}</td></tr>
        </tbody></table></div>
        <div class="tc" style="padding:12px"><b>🏭 Impacto na produção programada</b><table class="dt-table" style="margin-top:8px"><tbody>
          <tr><td>Necessário pelas OPs carregadas</td><td style="text-align:right">${fmt(estado.necessidadeProducao, 2)} ${esc(unidade)}</td></tr>
          <tr><td>Saldo após OPs</td><td style="text-align:right;font-weight:700;color:${estado.saldoAposProgramacao < 0 ? 'var(--danger)' : 'inherit'}">${fmt(estado.saldoAposProgramacao, 2)} ${esc(unidade)}</td></tr>
          <tr><td>Falta para executar programação</td><td style="text-align:right">${fmt(estado.faltaProducao, 2)} ${esc(unidade)}</td></tr>
          <tr><td>Primeira ruptura pelas OPs</td><td style="text-align:right">${estado.rupturaEm ? esc(estado.rupturaEm) : 'não prevista nas OPs carregadas'}</td></tr>
        </tbody></table></div>
      </div>
      <div class="tc" style="padding:12px;margin-top:14px"><b>🎯 Ação sugerida</b><div style="font-size:1rem;font-weight:700;margin-top:7px">${acao}</div><div style="font-size:.7rem;color:var(--muted);margin-top:4px">A sugestão usa o maior risco entre cobertura do BI e falta provocada pelas OPs já carregadas. Nada é comprado automaticamente.</div></div>
      <div class="tc" style="padding:12px;margin-top:14px"><b>🧾 Produtos que consomem este insumo</b><div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Código</th><th>Produto</th><th>Uso por caixa</th><th>Categoria do componente</th></tr></thead><tbody>
        ${produtos.length ? produtos.map(x => `<tr><td>${esc(x.codProduto || '—')}</td><td><b>${esc(x.produto)}</b></td><td>${fmt(x.qty, 4)} ${esc(unidade)}</td><td>${esc(x.categoria || '—')}</td></tr>`).join('') : '<tr><td colspan="4">Nenhuma ficha técnica carregada usando este insumo.</td></tr>'}
      </tbody></table></div></div>
      <div class="tc" style="padding:12px;margin-top:14px"><b>📅 OPs que vão consumir este insumo</b><div style="overflow:auto;margin-top:8px"><table class="dt-table"><thead><tr><th>Data</th><th>Produto</th><th>Máquina</th><th>Caixas restantes</th><th>Consumo do insumo</th></tr></thead><tbody>
        ${ops.length ? ops.map(x => `<tr><td>${esc(x.data || '—')}</td><td><b>${esc(x.produto || '—')}</b></td><td>${esc(x.maquina || '—')}</td><td>${fmt(x.caixas, 0)}</td><td>${fmt(x.necessidade, 2)} ${esc(unidade)}</td></tr>`).join('') : '<tr><td colspan="5">Nenhuma OP carregada consumindo este insumo no horizonte atual.</td></tr>'}
      </tbody></table></div></div>`;
  }

  global.pcpRegistrarPagina && global.pcpRegistrarPagina('insumo-360', { elId: 'page-pcp-insumo-360', render: 'renderPCPInsumo360', titulo: 'Insumo 360°' });
  global.abrirInsumo360 = abrirInsumo360;
  global.renderPCPInsumo360 = renderPCPInsumo360;
  global._pcpInsumo360Internals = { _acharBi, _produtosQueUsam, _opsRelacionadas, _necessidadeProgramada, _riscoPorOps, _estado, _match };

  document.addEventListener('click', function (event) {
    const abrir = event.target.closest('[data-pcp-insumo-360]');
    if (abrir) { abrirInsumo360(abrir.getAttribute('data-pcp-insumo-360'), abrir.getAttribute('data-pcp-insumo-nome') || ''); return; }
    if (event.target.closest('[data-pcp-insumo-voltar]')) {
      if (typeof global.pcpIrParaAba === 'function') global.pcpIrParaAba('insumos', document.getElementById('nav-pcp-insumos'));
    }
  });
})(window);
