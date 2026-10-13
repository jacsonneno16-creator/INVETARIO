// Recebimento · Inventários do Pátio (Relatório)
// PEDIDO AO VIVO (2026-10-02): "depois que eu fecho um inventário que eu
// fiz, daqui 10 dias eu consigo consultar quais foram as notas encontradas
// nesse inventário?" — a resposta era não: o Coletor (29-recebimento-
// patio-inventario.js, confirmarFinalizacao()) nunca salvava nada além de
// atualizar o status das notas individuais; o resumo da sessão (quantas
// foram encontradas, quantas saíram) só existia na tela enquanto ela
// estava aberta. Um filtro por período (como em 99-recebimento-retornos-
// status.js) não resolve, porque mistura notas que chegaram DEPOIS do
// inventário já ter sido fechado — o usuário foi explícito: precisa de uma
// aba mostrando exatamente o que foi encontrado NAQUELE inventário.
//
// Esta tela só LÊ a coleção `recebimento_patio_inventarios`, gravada pelo
// Coletor a cada "Finalizar" (1 documento por sessão, nunca editado depois
// — é um retrato congelado, por isso não sofre contaminação por notas
// futuras). Mesmo padrão de leitura direta (sem BigQuery) do histórico de
// `95-producao-importzip.js`: é uma coleção pequena (1 doc por sessão
// fechada), então orderBy+limit direto no Firestore já é suficiente.
(function (global) {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—';
  const fmtHora = iso => iso ? String(iso).slice(11, 16) : '—';
  const fmtDataHora = iso => iso ? (fmtData(iso) + ' ' + fmtHora(iso)) : '—';
  const COL = 'recebimento_patio_inventarios';
  const LIMITE = 100;

  function fs() { return global.getDTFirestore(); }

  const TRATAMENTO_LABELS = { RECUSA: 'Recusa', REENTREGA: 'Reentrega', SEM_CLASSIFICACAO: 'Sem classificação' };

  let _sessoes = [];
  let _porId = new Map();
  let _carregando = false;
  let _erro = '';

  async function _carregarSessoes(forcar) {
    if (_sessoes.length && !forcar) return _sessoes;
    _carregando = true;
    try {
      const snap = await fs().collection(COL).orderBy('data', 'desc').limit(LIMITE).get();
      _sessoes = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      _porId = new Map(_sessoes.map(s => [s._id, s]));
      _erro = '';
    } catch (e) {
      _erro = e && e.message ? e.message : String(e);
    } finally {
      _carregando = false;
    }
    return _sessoes;
  }

  function _tabelaHtml() {
    if (_erro) return `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">${esc(_erro)}</div></div>`;
    if (!_sessoes.length) return '<div class="empty"><div class="empty-icon">🗒️</div><div class="empty-title">Nenhum inventário do pátio registrado ainda</div><div class="empty-sub">Toda vez que o Coletor finalizar um "Inventário do Pátio", a sessão aparece aqui.</div></div>';
    return `<div class="tc"><div style="overflow:auto"><table class="dt-table">
      <thead><tr><th>Quando</th><th>Operador</th><th>Notas encontradas</th><th>Notas encerradas</th><th></th></tr></thead>
      <tbody>${_sessoes.map(s => `<tr>
        <td>${fmtDataHora(s.data)}</td>
        <td>${esc(s.operadorNome || s.operadorEmail || '—')}</td>
        <td>${Number(s.qtdEncontradas || 0).toLocaleString('pt-BR')}</td>
        <td>${Number(s.qtdTotalEncerrar || 0).toLocaleString('pt-BR')}</td>
        <td><button type="button" class="acao-lapis" title="Ver notas desta sessão" data-patio-inv-detalhe="${esc(s._id)}">🔎</button></td>
      </tr>`).join('')}</tbody>
    </table></div></div>`;
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-patio-inventarios');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
        <div><h2 style="margin:0">🗒️ Inventários do Pátio</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Retrato de cada "Inventário do Pátio" finalizado no Coletor — o que foi encontrado em cada sessão, sem mistura com notas que chegaram depois.</div></div>
        <button class="btn btn-ghost" data-patio-inv-atualizar="1">↻ Atualizar</button>
      </div>
      ${_carregando ? '<div style="font-size:.76rem;color:var(--muted);margin:8px 0">⏳ Carregando...</div>' : ''}
      ${_tabelaHtml()}`;
    global.aplicarPermissoesAnalista?.();
  }

  async function renderPatioInventariosRelatorio() {
    const pagina = document.getElementById('page-recebimento-patio-inventarios');
    if (!pagina) return;
    desenhar();
    await _carregarSessoes(false);
    desenhar();
  }

  function _notaLinha(numero, tratamentoLabel) {
    return `<tr><td class="mono">${esc(numero)}</td><td>${tratamentoLabel ? esc(tratamentoLabel) : ''}</td></tr>`;
  }

  async function _verDetalheSessao(sessaoId) {
    const corpo = document.getElementById('patio-inv-detalhe-corpo');
    global.openModal?.('modal-patio-inventario-detalhe');
    const s = _porId.get(sessaoId);
    if (!corpo) return;
    if (!s) { corpo.innerHTML = '<div class="empty"><div class="empty-title">Sessão não encontrada</div></div>'; return; }
    const encontradas = Array.isArray(s.notasEncontradas) ? s.notasEncontradas : [];
    const encerradas = Array.isArray(s.notasEncerradas) ? s.notasEncerradas : [];
    corpo.innerHTML = `
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:10px">${fmtDataHora(s.data)} · ${esc(s.operadorNome || s.operadorEmail || '—')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <div class="tc-title" style="margin-bottom:6px">✅ Encontradas (${encontradas.length})</div>
          ${encontradas.length ? `<table class="dt-table"><thead><tr><th>Nota</th></tr></thead><tbody>${encontradas.map(n => `<tr><td class="mono">${esc(n)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="empty-title">Nenhuma</div></div>'}
        </div>
        <div>
          <div class="tc-title" style="margin-bottom:6px">⛔ Encerradas (${encerradas.length})</div>
          ${encerradas.length ? `<table class="dt-table"><thead><tr><th>Nota</th><th>Motivo</th></tr></thead><tbody>${encerradas.map(it => _notaLinha(it.numeroNota, TRATAMENTO_LABELS[it.tratamento] || it.tratamento)).join('')}</tbody></table>` : '<div class="empty"><div class="empty-title">Nenhuma</div></div>'}
        </div>
      </div>
      <div style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" data-patio-inv-exportar="${esc(sessaoId)}">⬇ Exportar CSV</button></div>`;
  }

  function _exportarSessaoCsv(sessaoId) {
    const s = _porId.get(sessaoId);
    if (!s) return;
    const encontradas = (Array.isArray(s.notasEncontradas) ? s.notasEncontradas : []).map(n => [n, 'ENCONTRADA']);
    const encerradas = (Array.isArray(s.notasEncerradas) ? s.notasEncerradas : []).map(it => [it.numeroNota, TRATAMENTO_LABELS[it.tratamento] || it.tratamento || 'ENCERRADA']);
    const cab = ['NotaFiscal', 'Situacao'];
    const csv = [cab, ...encontradas, ...encerradas].map(linha => linha.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'inventario-patio-' + String(s.data || '').slice(0, 10) + '.csv';
    a.click();
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-patio-inv-atualizar]')) { _carregarSessoes(true).then(desenhar); return; }
    const detalhe = event.target.closest('[data-patio-inv-detalhe]');
    if (detalhe) { _verDetalheSessao(detalhe.getAttribute('data-patio-inv-detalhe')); return; }
    const exportar = event.target.closest('[data-patio-inv-exportar]');
    if (exportar) { _exportarSessaoCsv(exportar.getAttribute('data-patio-inv-exportar')); return; }
  });

  global.renderPatioInventariosRelatorio = renderPatioInventariosRelatorio;
  global._patioInventariosRelatorioInternals = { carregarSessoes: _carregarSessoes, verDetalheSessao: _verDetalheSessao };
})(window);
