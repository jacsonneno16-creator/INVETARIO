// PCP — Fase 10: Relatórios + exportação. Cada relatório é só um recorte
// diferente sobre construirVisao()/requisições já carregadas — nenhuma
// consulta nova. Exportação reaproveita o mesmo padrão de XLSX já usado em
// 71-producao-excel.js e o exportarElementoProducaoPDF já genérico em
// 76-producao-importacao.js — sem criar um exportador paralelo.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const RELATORIOS = [
    ['necessidade', 'Necessidade de Compra'],
    ['demandas', 'Demandas Enviadas para Compras'],
    ['ruptura', 'Ruptura de Estoque'],
    ['cobertura', 'Cobertura de Estoque'],
    ['estoque-projetado', 'Estoque Projetado'],
  ];
  let _relatorio = 'necessidade';

  function _linhas() {
    const internos = global._pcpInternals;
    const visao = internos.construirVisao({ estoqueBi: internos.getEstoqueBi?.() });
    const reqs = internos.getReqs?.() || [];
    const produtos = internos.getProdutos?.() || [];
    const produzidoInternamente = internos.produzidoInternamente || (() => false);
    switch (_relatorio) {
      case 'necessidade': {
        // PEDIDO AO VIVO (2026-09-02): produzido internamente não é "de
        // compra" — mesmo filtro que comprasHtml (78-pcp-central.js) já usa.
        // PEDIDO AO VIVO (2026-09-07): "eu queria que somasse e colocasse a
        // data necessária de umas três compras futuras... toda vez que
        // consultar ele vai ajustando" — Data1ª/2ª/3ª Compra e as
        // quantidades correspondentes vêm de calcularProximasDatasCompra
        // (83-pcp-timeline.js), recalculado do zero a cada render — nunca
        // uma data fixada/salva. DataNecessaria/Prioridade da requisição
        // MANUAL (quando existe uma já criada por alguém) continuam
        // aparecendo à parte — são coisas diferentes: uma é o que o
        // sistema PROJETA que vai precisar, a outra é o que uma PESSOA já
        // decidiu pedir.
        const calc = global._pcpTimelineInternals?.calcularProximasDatasCompra;
        return visao.filter(x => x.necessidade > 0 && !produzidoInternamente(x.key)).map(x => {
          const prod = produtos.find(p => internos.keyOf(p) === x.key);
          const multiplo = Math.max(1, n(prod?.multiploCompra) || 1);
          const sugerida = Math.ceil(x.necessidade / multiplo) * multiplo;
          const reqProduto = reqs.find(r => internos.keyOf(r) === x.key);
          const proximasCompras = calc ? calc(x, 3) : [];
          const [c1, c2, c3] = proximasCompras;
          return {
            Produto: x.produto, Estoque: x.estoqueAtual, Cobertura: x.coberturaDias, Necessidade: x.necessidade, QuantidadeSugerida: sugerida,
            DataNecessaria: reqProduto?.dataNecessaria || '', Prioridade: reqProduto?.prioridade || '',
            Data1aCompra: c1?.dataNecessaria || '', Qtd1aCompra: c1?.quantidadeSugerida ?? '',
            Data2aCompra: c2?.dataNecessaria || '', Qtd2aCompra: c2?.quantidadeSugerida ?? '',
            Data3aCompra: c3?.dataNecessaria || '', Qtd3aCompra: c3?.quantidadeSugerida ?? '',
          };
        });
      }
      case 'demandas':
        return reqs.map(r => ({ Data: r.criadoEm, Produto: r.produto, Quantidade: n(r.quantidade), PCPResponsavel: r.pcpResponsavel || '', Status: r.status || '', Comprador: r.compradorNome || r.compradorEmail || '', QuantidadeComprada: n(r.quantidadeComprada), Saldo: Math.max(0, n(r.quantidade) - n(r.quantidadeComprada)) }));
      case 'ruptura':
        return visao.filter(x => x.rupturaEm && x.rupturaEm !== 'sem data').map(x => ({ Produto: x.produto, Estoque: x.estoqueAtual, RupturaEm: x.rupturaEm, Cobertura: x.coberturaDias }));
      case 'cobertura':
        return visao.map(x => ({ Produto: x.produto, CoberturaAtual: x.coberturaDias, CoberturaDesejada: x.diasAlvo, Situacao: x.coberturaDias == null ? 'sem dados' : x.coberturaDias < x.diasAlvo ? 'abaixo' : x.coberturaDias > x.diasAlvo * 1.5 ? 'acima' : 'dentro' }));
      case 'estoque-projetado':
        return visao.map(x => ({ Produto: x.produto, EstoqueAtual: x.estoqueAtual, SaldoProjetado: x.saldo, Necessidade: x.necessidade, Excesso: x.excesso }));
      default: return [];
    }
  }

  async function renderPCPRelatorios() {
    const pagina = document.getElementById('page-pcp-relatorios');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await global._pcpInternals.carregar(); _desenhar(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; }
  }

  function _desenhar() {
    const pagina = document.getElementById('page-pcp-relatorios');
    if (!pagina) return;
    const linhas = _linhas();
    const colunas = linhas.length ? Object.keys(linhas[0]) : [];
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📄 Relatórios do PCP</div><div style="font-size:.74rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} linha(s)</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select id="pcprel-tipo" class="field" style="min-width:220px">${RELATORIOS.map(([id, label]) => `<option value="${id}" ${id === _relatorio ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-pcprel-excel>📊 Excel</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pcprel-csv>📄 CSV</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pcprel-pdf>🖨️ PDF</button>
        </div>
      </div>
      <div class="tc" id="pcprel-tabela-wrap"><div style="overflow:auto"><table class="dt-table">
        <thead><tr>${colunas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${linhas.length ? linhas.map(l => `<tr>${colunas.map(c => `<td>${typeof l[c] === 'number' ? l[c].toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : esc(l[c] ?? '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${Math.max(1, colunas.length)}">Sem dados para este relatório.</td></tr>`}</tbody>
      </table></div></div>`;
  }

  function _baixarCSV(linhas, nomeArquivo) {
    if (!global.XLSX) { global.showToast?.('Biblioteca Excel não carregada.', 'error'); return; }
    const csv = global.XLSX.utils.sheet_to_csv(global.XLSX.utils.json_to_sheet(linhas));
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function _exportarExcel() {
    if (!global.XLSX) { global.showToast?.('Biblioteca Excel não carregada.', 'error'); return; }
    const linhas = _linhas();
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(linhas), RELATORIOS.find(r => r[0] === _relatorio)[1].slice(0, 31));
    global.XLSX.writeFile(wb, 'pcp_' + _relatorio + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  global.pcpRegistrarPagina?.('relatorios', { elId: 'page-pcp-relatorios', render: 'renderPCPRelatorios', titulo: 'Relatórios' });
  global.renderPCPRelatorios = renderPCPRelatorios;
  global._pcpRelatoriosInternals = { _linhas, setRelatorio: v => { _relatorio = v; } };

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-pcprel-excel]')) { _exportarExcel(); return; }
    if (event.target.closest('[data-pcprel-csv]')) { _baixarCSV(_linhas(), 'pcp_' + _relatorio + '_' + new Date().toISOString().slice(0, 10) + '.csv'); return; }
    if (event.target.closest('[data-pcprel-pdf]')) { global.exportarElementoProducaoPDF?.('pcprel-tabela-wrap', 'pcp_' + _relatorio + '.pdf'); return; }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pcprel-tipo') { _relatorio = event.target.value; _desenhar(); }
  });
})(window);
