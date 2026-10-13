// Agenda de entregas do Recebimento. Carrega somente o dia escolhido.
(function () {
  'use strict';
  var COL = 'recebimento_agendamentos';
  var cacheDia = '';
  var cacheItens = [];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
  }
  function hojeIso() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function qtdItem(i) {
    var n = Number(i && (i.quantidadePendente != null ? i.quantidadePendente : i.quantidade));
    return Number.isFinite(n) ? n.toLocaleString('pt-BR') : '—';
  }
  function desenhar() {
    var host = document.getElementById('recebimento-agenda-lista');
    var status = document.getElementById('recebimento-agenda-status');
    if (!host) return;
    if (status) status.textContent = cacheItens.length + ' entrega(s) agendada(s).';
    if (!cacheItens.length) { host.innerHTML = '<div style="text-align:center;padding:22px;color:#5a7a9a">Nenhuma entrega agendada para este dia.</div>'; return; }
    host.innerHTML = cacheItens.map(function (a, idx) {
      var tipo = String(a.tipoCarga || 'PALETIZADA').toUpperCase();
      var batida = tipo === 'BATIDA';
      var itens = Array.isArray(a.itensPedido) ? a.itensPedido : [];
      var corTexto = '#17212b';
      var corSecundaria = '#4f6475';
      var badgeStyle = batida
        ? 'background:#fee4e2;color:#b42318;border:1px solid #fecdca;'
        : 'background:#dcfae6;color:#067647;border:1px solid #abefc6;';
      return '<div class="inv-card agenda-entrega-card" data-agenda-idx="' + idx + '" style="cursor:pointer;color:' + corTexto + ';-webkit-text-fill-color:' + corTexto + ';' + (batida ? 'border:2px solid #d92d20;background:#fff1f0;' : 'border:1px solid #b7e4c7;background:#f4fff7;') + '">' +
        '<div class="inv-card-name" style="font-weight:800;color:' + corTexto + ';-webkit-text-fill-color:' + corTexto + ';">' + esc(a.fornecedorNome || 'Fornecedor') + '</div>' +
        '<div class="inv-card-meta"><span class="badge" style="' + badgeStyle + '">' + (batida ? 'BATIDA' : 'PALETIZADA') + '</span></div>' +
        '<div id="agenda-det-' + idx + '" style="display:none;margin-top:10px;border-top:1px solid rgba(0,0,0,.10);padding-top:8px;color:' + corTexto + ';-webkit-text-fill-color:' + corTexto + ';">' +
          (itens.length ? itens.map(function (i) { return '<div style="padding:6px 0;color:' + corTexto + ';-webkit-text-fill-color:' + corTexto + ';"><b style="color:' + corTexto + ';-webkit-text-fill-color:' + corTexto + ';">' + esc(i.produto || i.descricao || 'Produto') + '</b><div style="font-size:.8rem;color:' + corSecundaria + ';-webkit-text-fill-color:' + corSecundaria + ';">Quantidade: ' + qtdItem(i) + '</div></div>'; }).join('') : '<div style="color:' + corSecundaria + ';-webkit-text-fill-color:' + corSecundaria + ';">Sem itens informados.</div>') +
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-agenda-idx]'), function (card) {
      card.addEventListener('click', function () {
        var d = document.getElementById('agenda-det-' + card.getAttribute('data-agenda-idx'));
        if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
      });
    });
  }
  async function carregar(data) {
    data = data || hojeIso();
    var input = document.getElementById('recebimento-agenda-data'); if (input) input.value = data;
    var status = document.getElementById('recebimento-agenda-status'); if (status) status.textContent = 'Carregando...';
    try {
      var snap = await FS.collection(COL).where('dataAgendada', '==', data).get();
      cacheDia = data;
      cacheItens = snap.docs.map(function (d) { return Object.assign({_id:d.id}, d.data()); })
        .filter(function (a) { return !!a.dataAgendada; })
        .sort(function (a,b) { return String(a.fornecedorNome || '').localeCompare(String(b.fornecedorNome || ''), 'pt-BR'); });
      desenhar();
    } catch (e) {
      cacheItens = [];
      if (status) status.textContent = 'Erro ao carregar agenda: ' + (e && e.message ? e.message : e);
      var host = document.getElementById('recebimento-agenda-lista'); if (host) host.innerHTML = '';
    }
  }
  function abrir() { goScreen('recebimento-agenda'); carregar(hojeIso()); }
  window.abrirAgendaEntregasColetor = abrir;
  window.carregarAgendaEntregasColetor = carregar;
  window._recebimentoAgendaInternals = { hojeIso: hojeIso, getItens: function(){ return cacheItens; }, getDia: function(){ return cacheDia; } };
})();
