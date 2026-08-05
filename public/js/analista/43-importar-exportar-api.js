(function (global) {
  'use strict';

  var CFG_KEY = 'dt_integracao_api_v1';
  var QUEUE_KEY = 'dt_integracao_fila_v1';
  var HISTORY_KEY = 'dt_integracao_historico_v1';
  var currentPayload = null;

  function el(id) { return document.getElementById(id); }
  function value(id) { var node = el(id); return node ? String(node.value || '').trim() : ''; }
  function state() {
    try { return global.AnalistaStore.getState() || {}; } catch (_) { return {}; }
  }
  function toast(message, type) {
    if (typeof global.showToast === 'function') global.showToast(message, type || 'i');
    else alert(message);
  }
  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }
  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (_) { return fallback; }
  }
  function writeJson(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
  function fileStamp() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0');
  }
  function downloadBlob(content, filename, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], {type: mime || 'text/plain;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function normalizeDate(input) {
    if (!input) return '';
    try {
      if (typeof input.toDate === 'function') return input.toDate().toISOString();
      if (typeof input.toMillis === 'function') return new Date(input.toMillis()).toISOString();
      if (input.seconds) return new Date(Number(input.seconds) * 1000).toISOString();
      return new Date(input).toISOString();
    } catch (_) { return String(input); }
  }
  function plainRow(row) {
    var out = {};
    Object.keys(row || {}).forEach(function (key) {
      var val = row[key];
      if (val && (typeof val.toDate === 'function' || typeof val.toMillis === 'function' || val.seconds)) out[key] = normalizeDate(val);
      else if (val == null || typeof val !== 'object') out[key] = val == null ? '' : val;
      else out[key] = JSON.stringify(val);
    });
    return out;
  }
  function inventoryId(row) {
    return String((row && (row.inventario_id || row.inventarioId || row.id_inventario)) || '');
  }
  function inventoryRows(id) {
    return (state().contagens || []).filter(function (row) { return !id || inventoryId(row) === String(id); });
  }
  // Retorna exatamente o codigo lido pelo operador. O cadastro do produto
  // e usado apenas como fallback para registros legados que nao guardavam a leitura.
  function scannedCode(row) {
    if (!row) return '';
    var candidates = [row.codigoLido,row.codigo_lido,row.gtin_bipado,row.dunLido,row.dun_lido,
      row.codigo_bipado,row.barcode_lido,row.gtinLido,row.gtin_lido,row.gtin,row.ean,row.dun];
    for (var i=0;i<candidates.length;i++) {
      var code = String(candidates[i] == null ? '' : candidates[i]).trim().replace(/\s+/g,'');
      if (code) return code;
    }
    return String(row.codigo_produto || row.codigoProduto || row.produto_codigo || '').trim();
  }
  function countedQty(row) {
    if (!row) return 0;
    var value = row.quantidade;
    if (value == null) value = row.qtd;
    if (value == null) value = row.qtd_recontagem;
    if (value == null) value = row.qtd_segunda;
    if (value == null) value = row.qtd_terceira;
    return Number(String(value == null ? 0 : value).replace(',','.')) || 0;
  }
  function latestRecountReading(rec) {
    if (!rec) return null;
    var st = state();
    var recId = String(rec.id || rec.recontagem_id || '');
    var rows = (st.contagens || []).filter(function (c) {
      if (c._excluida || String(c.status || '').toUpperCase() === 'ESTORNADA') return false;
      if (String(c.tipo_contagem || '').toUpperCase() !== 'RECONTAGEM') return false;
      return recId && String(c.recontagem_id || '') === recId;
    });
    rows.sort(function(a,b){
      return String(a.timestamp || a.criado_em || a.dataHora || '').localeCompare(String(b.timestamp || b.criado_em || b.dataHora || ''));
    });
    return rows.length ? rows[rows.length-1] : null;
  }
  function flowKey(row) {
    var FK = global.InventoryFlowKey;
    if (FK && typeof FK.chave === 'function') {
      try { return FK.chave(row, state().inventarios || []); } catch(_){ console.warn("[Erro tratado]", _); }
    }
    return [inventoryId(row), String(row.endereco || '').trim().toUpperCase(),
      String(row.codigo_produto || row.codigoProduto || row.gtin || row.ean || row.dun || '').trim().toUpperCase()].join('|');
  }
  function completedRecount(row) {
    var status = String(row.status_recontagem || row.status || '').trim().toUpperCase();
    var blocked = ['PENDENTE','ATRIBUIDA','ATRIBUÍDA','EM_ANDAMENTO','ABERTA','CANCELADA','EXCLUIDA'].indexOf(status) >= 0;
    var hasQty = row.qtd_recontagem != null || row.qtd_segunda != null || row.qtd_terceira != null;
    var hasDate = !!(row.recontagem_concluida_em || row.concluida_em || row.finalizada_em || row.data_segunda || row.data_terceira);
    return hasQty && !blocked && (hasDate || ['CONCLUIDA','CONCLUÍDA','FINALIZADA','PROCESSADA','RESOLVIDA','AGUARDANDO_ANALISTA'].indexOf(status) >= 0);
  }
  function finalPhysicalRow(first) {
    var st = state(), FK = global.InventoryFlowKey;
    var divergences = (st.divergencias || []).filter(function (d) {
      if (inventoryId(d) !== inventoryId(first)) return false;
      if (String(d.endereco || '').trim().toUpperCase() !== String(first.endereco || '').trim().toUpperCase()) return false;
      return ['CANCELADA','EXCLUIDA','ESTORNADA'].indexOf(String(d.status || '').trim().toUpperCase()) < 0;
    });
    var cid = String(first.uuid || first.id || '');
    var div = divergences.find(function (d) {
      return cid && [d.contagem_uuid,d.contagem_id,d.origem_contagem_id].filter(Boolean).map(String).indexOf(cid) >= 0;
    });
    if (!div && FK && typeof FK.produto === 'function') {
      try {
        var prod = FK.produto(first);
        div = divergences.find(function (d) { return FK.produto(d) === prod; });
      } catch(_){ console.warn("[Erro tratado]", _); }
    }
    if (!div && divergences.length === 1) div = divergences[0];

    if (!div) {
      var status = String(first.status || '').trim().toUpperCase();
      if (first.divergente === true || status === 'DIVERGENTE') return null;
      return {
        rodada:1,
        codigo:scannedCode(first),
        descricao:first.descricao_produto || first.produtoLidoNome || first.produto_descricao || first.produto || '',
        quantidade:countedQty(first),
        validade:first.validade || first.data_validade || '',
        lote_produto:first.lote_produto || first.lote || first.numero_lote_produto || '',
        palete:first.palete || first.palete_key || first.capa_palete || first.capa || '',
        motivo:'PRIMEIRA_CONTAGEM'
      };
    }

    var recs = (st.recontagens || []).filter(function (r) {
      var same = String(r.divergencia_id || '') === String(div.id || '');
      if (!same && FK && typeof FK.mesmo === 'function') {
        try { same = FK.mesmo(r, div, st.inventarios || []); } catch(_){ console.warn("[Erro tratado]", _); }
      }
      return same && completedRecount(r);
    }).sort(function (a,b) {
      var na=Number(a.numero_recontagem || 0), nb=Number(b.numero_recontagem || 0);
      if (na !== nb) return na-nb;
      return String(a.data_terceira || a.recontagem_concluida_em || a.concluida_em || a.data_segunda || '')
        .localeCompare(String(b.data_terceira || b.recontagem_concluida_em || b.concluida_em || b.data_segunda || ''));
    }).slice(0,2);

    var history = {
      qtd_esperada: div.qtd_esperada,
      produto: div.produto || div.codigo_produto || first.codigo_produto || first.gtin || '',
      qtd_primeira: div.qtd_primeira != null ? div.qtd_primeira : (div.qtd_contada != null ? div.qtd_contada : first.quantidade),
      produto_primeira: div.produto_primeira || div.produto_contado || scannedCode(first),
      qtd_segunda: recs[0] ? (recs[0].qtd_segunda != null ? recs[0].qtd_segunda : recs[0].qtd_recontagem) : null,
      produto_segunda: recs[0] ? (recs[0].produto_segunda || recs[0].produto_recontagem || '') : '',
      qtd_terceira: recs[1] ? (recs[1].qtd_terceira != null ? recs[1].qtd_terceira : recs[1].qtd_recontagem) : null,
      produto_terceira: recs[1] ? (recs[1].produto_terceira || recs[1].produto_recontagem || '') : '',
      status: div.status,status_recontagem: div.status_recontagem,divergente: div.divergente,
      precisa_recontagem: div.precisa_recontagem,tipo_divergencia: div.tipo_divergencia
    };
    var evaluation = global.AnalistaDivergenciasRuntime && global.AnalistaDivergenciasRuntime.avaliarHistorico
      ? global.AnalistaDivergenciasRuntime.avaliarHistorico(history) : null;
    if (!evaluation || evaluation.estado !== 'RESOLVIDA' || !evaluation.resultado) return null;

    var source = evaluation.rodada === 1 ? first : latestRecountReading(recs[evaluation.rodada - 2]);
    var rec = evaluation.rodada > 1 ? recs[evaluation.rodada - 2] : null;
    var result = evaluation.resultado;
    var code = scannedCode(source) || scannedCode(rec) || result.produto || history.produto || '';
    var found = global.DTProdutos && global.DTProdutos.buscarSync ? global.DTProdutos.buscarSync(code) : null;
    return {
      rodada:evaluation.rodada,
      codigo:code,
      descricao:(source && (source.descricao_produto || source.produtoLidoNome || source.descricao)) ||
        (found && found.encontrado ? found.nomeProduto : '') || div.descricao_produto || first.descricao_produto || '',
      quantidade:source ? countedQty(source) : (Number(result.qtd) || 0),
      validade:(source && (source.validade || source.data_validade)) || (rec && (rec.validade || rec.data_validade)) || first.validade || '',
      lote_produto:(source && (source.lote_produto || source.lote || source.numero_lote_produto)) ||
        (rec && (rec.lote_produto || rec.lote || rec.numero_lote_produto)) || first.lote_produto || first.lote || '',
      palete:(source && (source.palete || source.palete_key || source.capa_palete || source.capa)) ||
        (rec && (rec.palete || rec.palete_key || rec.capa_palete || rec.capa)) || first.palete || first.palete_key || first.capa || '',
      motivo:evaluation.referencia || 'RESOLVIDA'
    };
  }
  function consolidatedRows(id) {
    // Exporta exclusivamente a fotografia física mais recente de cada endereço.
    // Se uma recontagem registrou menos paletes, os paletes das rodadas anteriores
    // não permanecem no arquivo e não são somados novamente.
    var source = global.InventoryAddressState && typeof global.InventoryAddressState.latestPhysicalRows === 'function'
      ? global.InventoryAddressState.latestPhysicalRows(state(),id)
      : global.DTContagemFisicaAtual && typeof global.DTContagemFisicaAtual.linhas === 'function'
      ? global.DTContagemFisicaAtual.linhas(id)
      : inventoryRows(id).filter(function(row){
          return !row._excluida && ['ESTORNADA','EXCLUIDA'].indexOf(String(row.status || '').toUpperCase()) < 0;
        });
    var seen = {};
    return source.map(function (row, index) {
      var code = scannedCode(row);
      var found = global.DTProdutos && global.DTProdutos.buscarSync ? global.DTProdutos.buscarSync(code) : null;
      var key = String(row.uuid || row.id || row.contagem_uuid || '') || [
        inventoryId(row), String(row.endereco || '').trim().toUpperCase(),
        String(row.palete || row.palete_key || row.capa_palete || row.capa || ''),
        code, countedQty(row), String(row.timestamp || row.criado_em || row.dataHora || index)
      ].join('|');
      if (seen[key]) return null;
      seen[key] = true;
      var rodada = String(row.tipo_contagem || 'PRIMEIRA').toUpperCase() === 'RECONTAGEM'
        ? Math.min(3, 1 + Math.max(1, Number(row.numero_recontagem || 1))) : 1;
      return {
        endereco:String(row.endereco || '').trim(),
        gtin:String(code || '').trim(),
        descricao_produto:row.descricao_produto || row.produtoLidoNome || row.produto_descricao || row.descricao ||
          (found && found.encontrado ? found.nomeProduto : ''),
        quantidade:countedQty(row),
        lote_produto:String(row.lote_produto || row.lote || row.numero_lote_produto || '').trim(),
        validade:String(row.validade || row.data_validade || '').trim(),
        palete:String(row.palete || row.palete_key || row.capa_palete || row.capa || '').trim(),
        rodada_resultado:rodada,
        motivo_resultado:rodada === 1 ? 'PRIMEIRA_CONTAGEM' : 'RECONTAGEM_' + (rodada - 1)
      };
    }).filter(Boolean);
  }
  function normalizeValidity(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '';
    // Aceita datas sem separador vindas do coletor/Excel: ddmmaaaa.
    if (/^\d{8}$/.test(text)) {
      return text.slice(0,2) + '/' + text.slice(2,4) + '/' + text.slice(4,8);
    }
    // Aceita datas com separador: d/m/aa, dd-mm-aaaa etc.
    var m = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (m) {
      var year = m[3].length === 2 ? '20' + m[3] : m[3];
      return m[1].padStart(2,'0') + '/' + m[2].padStart(2,'0') + '/' + year;
    }
    // Aceita serial de data do Excel quando recebido como número.
    if (/^\d{5}(?:\.\d+)?$/.test(text)) {
      var serial = Number(text);
      if (Number.isFinite(serial) && serial > 20000 && serial < 100000) {
        var utc = Math.round((serial - 25569) * 86400 * 1000);
        var d = new Date(utc);
        if (!Number.isNaN(d.getTime())) {
          return String(d.getUTCDate()).padStart(2,'0') + '/' +
            String(d.getUTCMonth()+1).padStart(2,'0') + '/' + d.getUTCFullYear();
        }
      }
    }
    return text;
  }
  function normalizeGtin(value) {
    var text = String(value == null ? '' : value).trim().replace(/\s+/g,'');
    if (!text) return '';
    // Evita notação científica criada pelo Excel (ex.: 1.7899E+13).
    if (/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)[eE][+-]?\d+$/.test(text)) {
      var num = Number(text.replace(',', '.'));
      if (Number.isFinite(num) && num >= 0) text = num.toFixed(0);
    }
    // Remove o sufixo .0 quando o código foi interpretado como número.
    text = text.replace(/^[+]/, '').replace(/\.0+$/, '');
    return text;
  }
  function decimalBR(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '';
    return String(n).replace('.', ',');
  }
  function bluesoftLayout(inv, selected) {
    if (selected && selected !== 'AUTO') return selected;
    var raw = String((inv && (inv.tipo_inventario_logistico || inv.tipo_logistico || inv.layout_bluesoft || inv.modo_contagem)) || '').toUpperCase();
    if (inv && (inv.com_endereco_logistico === true || inv.usa_enderecamento === true || /ENDERE/.test(raw))) return 'ENDERECAMENTO';
    if (inv && (inv.com_endereco_logistico === false || inv.usa_enderecamento === false || /GERAL|SEM_ENDERE/.test(raw))) return 'GERAL';
    return 'ENDERECAMENTO';
  }
  function buildBluesoftExport(invId, layout, loteContagem) {
    var rows = consolidatedRows(invId), errors = [], grouped = {}, palletAddress = {};
    rows.forEach(function(row, index){
      var line = index + 2;
      var gtin = normalizeGtin(row.gtin);
      var qty = Number(row.quantidade);
      var address = String(row.endereco || '').trim();
      var productLot = String(row.lote_produto || '').trim();
      var validity = normalizeValidity(row.validade);
      var pallet = String(row.palete || '').trim();
      if (!gtin) errors.push('Linha ' + line + ': codigo bipado ausente.');
      else if (!/^\d{1,14}$/.test(gtin)) errors.push('Linha ' + line + ': GTIN/PLU deve conter somente numeros e ter ate 14 digitos (' + gtin + ').');
      if (!Number.isFinite(qty) || qty < 0) errors.push('Linha ' + line + ': quantidade invalida.');
      if (layout === 'ENDERECAMENTO') {
        if (!address) errors.push('Linha ' + line + ': endereco logistico ausente.');
        if (productLot.length > 30) errors.push('Linha ' + line + ': lote do produto possui mais de 30 caracteres.');
        if (validity && !/^\d{2}\/\d{2}\/\d{4}$/.test(validity)) errors.push('Linha ' + line + ': validade deve estar em dd/mm/aaaa.');
        if (pallet && !/^\d{1,9}$/.test(pallet)) errors.push('Linha ' + line + ': palete deve ter somente numeros e ate 9 digitos.');
        if (pallet) {
          if (palletAddress[pallet] && palletAddress[pallet] !== address) errors.push('Palete ' + pallet + ' aparece em enderecos diferentes.');
          palletAddress[pallet] = address;
        }
        var k = [address,gtin,productLot,validity,pallet].join('|');
        if (!grouped[k]) grouped[k] = {endereco_logistico:address,gtin:gtin,quantidade:0,lote_produto:productLot,validade:validity,palete:pallet};
        grouped[k].quantidade += qty;
      } else {
        var lot = String(loteContagem || '').trim();
        if (!/^\d{1,7}$/.test(lot)) errors.push('Informe o lote de contagem Bluesoft com ate 7 digitos.');
        var kg = [lot,gtin].join('|');
        if (!grouped[kg]) grouped[kg] = {lote:lot,gtin:gtin,quantidade:0};
        grouped[kg].quantidade += qty;
      }
    });
    return {rows:Object.keys(grouped).map(function(k){return grouped[k];}),errors:Array.from(new Set(errors))};
  }
  function dataset(type) {
    var st = state();
    var rows = [];
    if (type === 'contagens') rows = consolidatedRows();
    else if (type === 'enderecos') rows = st.enderecosLista || [];
    else if (type === 'divergencias') rows = st.divergencias || [];
    else if (type === 'recontagens') rows = st.recontagens || [];
    else if (type === 'auditoria') rows = st.logs || [];
    else if (type === 'produtividade') {
      var byOperator = {};
      consolidatedRows().forEach(function (row) {
        var name = row.operador_nome || row.operador || 'Sem operador';
        if (!byOperator[name]) byOperator[name] = {operador:name, leituras:0, quantidade:0};
        byOperator[name].leituras++;
        byOperator[name].quantidade += Number(row.quantidade != null ? row.quantidade : row.qtd) || 0;
      });
      rows = Object.keys(byOperator).map(function (key) { return byOperator[key]; });
    } else if (type === 'pendencias') {
      var active = (st.inventarios || []).filter(function (inv) { return String(inv.status || '').toUpperCase() === 'ATIVO'; });
      active.forEach(function (inv) {
        var counted = {};
        inventoryRows(inv.id).forEach(function (row) { counted[String(row.endereco || '')] = true; });
        (inv.base || []).forEach(function (row) {
          if (!counted[String(row.endereco || '')]) rows.push(Object.assign({inventario_id:inv.id,inventario:inv.nome || inv.codigo || inv.id}, row));
        });
      });
    }
    return rows.map(plainRow);
  }
  function label(type) {
    return ({contagens:'contagens',enderecos:'enderecos',divergencias:'divergencias',
      recontagens:'recontagens',pendencias:'pendencias',auditoria:'logs_auditoria',
      produtividade:'produtividade'})[type] || type;
  }
  function csvEscape(value) {
    var text = String(value == null ? '' : value).replace(/"/g, '""');
    return /[;"\r\n]/.test(text) ? '"' + text + '"' : text;
  }
  function makeCsv(rows) {
    if (!rows.length) return '';
    var headers = [];
    rows.forEach(function (row) { Object.keys(row).forEach(function (key) { if (headers.indexOf(key) < 0) headers.push(key); }); });
    return '\uFEFF' + headers.map(csvEscape).join(';') + '\r\n' +
      rows.map(function (row) { return headers.map(function (key) { return csvEscape(row[key]); }).join(';'); }).join('\r\n');
  }

  global.exportarCSVTipo = function (type) {
    var rows = dataset(type);
    if (!rows.length) return toast('Não há dados para exportar.', 'w');
    downloadBlob(makeCsv(rows), label(type) + '_' + fileStamp() + '.csv', 'text/csv;charset=utf-8');
    toast(rows.length.toLocaleString('pt-BR') + ' registro(s) exportado(s).', 's');
  };
  global.exportarXLSXTipo = function (type) {
    var rows = dataset(type);
    if (!rows.length) return toast('Não há dados para exportar.', 'w');
    if (!global.XLSX) return toast('Biblioteca do Excel não foi carregada. Atualize a página com internet.', 'e');
    var sheet = global.XLSX.utils.json_to_sheet(rows);
    var book = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(book, sheet, label(type).slice(0, 31));
    global.XLSX.writeFile(book, label(type) + '_' + fileStamp() + '.xlsx');
    toast(rows.length.toLocaleString('pt-BR') + ' registro(s) exportado(s).', 's');
  };
  global.ieExportarProdutos = function () {
    if (typeof global.produtoExportar === 'function') return global.produtoExportar();
    toast('A base de produtos ainda não terminou de carregar.', 'w');
  };

  function updateCounts() {
    var st = state();
    var values = {
      'ie-count-contagens': (st.contagens || []).length,
      'ie-count-enderecos': (st.enderecosLista || []).length,
      'ie-count-divergencias': (st.divergencias || []).length,
      'ie-count-recontagens': (st.recontagens || []).length,
      'ie-count-logs': (st.logs || []).length,
      'ie-count-produtos': global.DTProdutos && global.DTProdutos.lista ? global.DTProdutos.lista().length : 0
    };
    Object.keys(values).forEach(function (id) { if (el(id)) el(id).textContent = Number(values[id]).toLocaleString('pt-BR'); });
  }
  function fillInventories() {
    var inventories = state().inventarios || [];
    ['ie-bluesoft-inv','ie-import-inv','ie-import-cont-inv','api-export-inv','api-import-inv','sim-inv-sel'].forEach(function (id) {
      var select = el(id); if (!select) return;
      var selected = select.value;
      select.innerHTML = '<option value="">Selecione...</option>' + inventories.map(function (inv) {
        return '<option value="' + escapeHtml(inv.id) + '">' + escapeHtml(inv.nome || inv.codigo || inv.id) + '</option>';
      }).join('');
      if (inventories.some(function (inv) { return String(inv.id) === selected; })) select.value = selected;
    });
  }
  function ensureQueuePanel() {
    if (el('ie-panel-fila')) return;
    var apiPanel = el('ie-panel-api');
    if (!apiPanel) return;
    var panel = document.createElement('div');
    panel.id = 'ie-panel-fila';
    panel.style.display = 'none';
    panel.innerHTML = '<div class="tc" style="border-top:3px solid var(--info)"><div class="tc-header" style="border-left:none;background:none"><div><div class="tc-title">🔄 Fila de integração</div><div style="font-size:.73rem;color:var(--muted);margin-top:3px">Envios aguardando processamento manual</div></div><button class="btn btn-primary btn-sm" onclick="apiProcessarFila()">▶ Processar fila</button></div><div id="ie-fila-lista" style="padding:16px"></div></div>';
    apiPanel.parentNode.insertBefore(panel, apiPanel.nextSibling);
  }
  global.ieSetTab = function (tab) {
    ensureQueuePanel();
    ['exportar','importar','api','fila'].forEach(function (name) {
      var panel = el('ie-panel-' + name), button = el('ie-tab-' + name);
      if (panel) panel.style.display = name === tab ? '' : 'none';
      if (button) {
        button.style.background = name === tab ? 'var(--orange)' : 'transparent';
        button.style.color = name === tab ? '#fff' : 'var(--muted)';
        button.style.boxShadow = name === tab ? 'var(--sh-orange)' : 'none';
      }
    });
    updateCounts(); fillInventories(); loadConfig(); renderHistory(); renderQueue();
  };
  global.ieAbrirPagina = function () { global.ieSetTab('exportar'); };
  global.ieAbrirImportBase = function () {
    if (!value('ie-import-inv')) return toast('Selecione o inventário de destino.', 'w');
    if (el('ie-file-base')) el('ie-file-base').click();
  };
  async function readRows(file) {
    if (!file) return [];
    if (!global.XLSX) throw new Error('Biblioteca do Excel não carregada.');
    var bytes = await file.arrayBuffer();
    var book = global.XLSX.read(bytes, {type:'array', raw:false, cellText:true});
    return global.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {defval:'', raw:false});
  }
  function normalizedObject(row) {
    var out = {};
    Object.keys(row || {}).forEach(function (key) {
      var norm = String(key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      out[norm] = row[key];
    });
    return out;
  }
  async function saveBatches(collection, rows, idMaker) {
    var db = global.getDTFirestore(), raw = global.getDTRawFirestore();
    for (var i = 0; i < rows.length; i += 300) {
      var batch = raw.batch();
      rows.slice(i, i + 300).forEach(function (row, offset) {
        batch.set(db.collection(collection).doc(idMaker(row, i + offset)), row, {merge:true});
      });
      await batch.commit();
    }
  }
  global.ieProcessarProdutos = async function (file) {
    if (!file) return;
    try {
      if (typeof global.produtoImportar !== 'function') throw new Error('Módulo de produtos ainda não carregado.');
      await global.produtoImportar(file);
      if (el('ie-file-produtos')) el('ie-file-produtos').value = '';
      updateCounts();
    } catch (error) { toast('Erro ao importar produtos: ' + error.message, 'e'); }
  };
  global.ieProcessarBase = async function (file) {
    var invId = value('ie-import-inv');
    if (!file || !invId) return;
    try {
      var rows = (await readRows(file)).map(normalizedObject).map(function (row) {
        return {
          endereco: String(row.endereco || row.local || '').trim(),
          codigo_produto: String(row.codigo_produto || row.codigo || row.sku || '').trim(),
          gtin: String(row.gtin || row.ean || '').trim(),
          descricao_produto: String(row.descricao_produto || row.descricao || row.produto || '').trim(),
          quantidade_esperada: Number(String(row.quantidade_esperada || row.saldo || row.quantidade || 0).replace(',', '.')) || 0
        };
      }).filter(function (row) { return row.endereco && row.codigo_produto; });
      if (!rows.length) throw new Error('Nenhuma linha válida. Verifique endereço e código do produto.');
      var db = global.getDTFirestore(), raw = global.getDTRawFirestore(), ref = db.collection('dt_inventarios').doc(invId);
      var old = await ref.collection('base_chunks').get();
      for (var d = 0; d < old.docs.length; d += 300) {
        var del = raw.batch(); old.docs.slice(d, d + 300).forEach(function (doc) { del.delete(doc.ref); }); await del.commit();
      }
      var totalChunks = Math.ceil(rows.length / 1000);
      for (var c = 0; c < totalChunks; c += 300) {
        var write = raw.batch();
        for (var part = c; part < Math.min(c + 300, totalChunks); part++) {
          write.set(ref.collection('base_chunks').doc(String(part + 1).padStart(5, '0')), {parte:part + 1,totalPartes:totalChunks,itens:rows.slice(part * 1000, (part + 1) * 1000)});
        }
        await write.commit();
      }
      await ref.set({base_total:rows.length,base_chunks:totalChunks,base_atualizada_em:new Date().toISOString(),arquivo:file.name}, {merge:true});
      toast(rows.length.toLocaleString('pt-BR') + ' registro(s) importado(s) na base.', 's');
    } catch (error) { toast('Erro ao importar base: ' + error.message, 'e'); }
    finally { if (el('ie-file-base')) el('ie-file-base').value = ''; }
  };
  global.ieProcessarContagens = async function (file) {
    if (!file) return;
    var selectedInv = value('ie-import-cont-inv');
    try {
      var rows = (await readRows(file)).map(normalizedObject).map(function (row, index) {
        return Object.assign({}, row, {
          inventario_id: selectedInv || row.inventario_id || '',
          quantidade: Number(String(row.quantidade || row.qtd || 0).replace(',', '.')) || 0,
          importado_em: new Date().toISOString(),
          origem: 'IMPORTACAO_ARQUIVO',
          _importIndex: index
        });
      }).filter(function (row) { return row.inventario_id && row.endereco; });
      if (!rows.length) throw new Error('Nenhuma contagem válida ou inventário de destino não selecionado.');
      await saveBatches('dt_contagens', rows, function (row) {
        var source = [row.inventario_id,row.operador,row.endereco,row.codigo_produto,row.gtin,row.timestamp,row._importIndex].join('|');
        var hash = 0; for (var i = 0; i < source.length; i++) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
        delete row._importIndex; return 'imp_' + Date.now().toString(36) + '_' + Math.abs(hash).toString(36);
      });
      toast(rows.length.toLocaleString('pt-BR') + ' contagem(ns) importada(s).', 's');
    } catch (error) { toast('Erro ao importar contagens: ' + error.message, 'e'); }
    finally { if (el('ie-file-contagens')) el('ie-file-contagens').value = ''; }
  };
  global.ieExportarBluesoft = function (formatoForcado, inventarioForcado) {
    var invId = String(inventarioForcado || value('ie-bluesoft-inv') || '').trim();
    if (!invId) return toast('Selecione o inventário.', 'w');
    var formato = String(formatoForcado || value('ie-bluesoft-formato') || 'csv').toLowerCase();
    if (formato !== 'txt') formato = 'csv';
    var result = buildBluesoftExport(invId, 'ENDERECAMENTO', '');
    if (!result.rows.length) return toast('Não há contagens resolvidas para exportar. Pendências sem decisão não entram no arquivo.', 'w');
    if (result.errors.length) {
      var preview = result.errors.slice(0,8).join('\n');
      if (result.errors.length > 8) preview += '\n... e mais ' + (result.errors.length-8) + ' erro(s).';
      alert('A exportação foi bloqueada pelas validações do layout Bluesoft:\n\n' + preview);
      return;
    }
    var headers = ['endereco_logistico','gtin','quantidade','lote_produto','validade','palete'];
    function campo(valor) {
      var texto = String(valor == null ? '' : valor);
      return texto.replace(/[\r\n]+/g, ' ').replace(/;/g, ',').trim();
    }
    var linhas = result.rows.map(function(row){
      return headers.map(function(h){
        return h === 'quantidade' ? campo(decimalBR(row[h])) : campo(row[h]);
      }).join(';');
    });
    var conteudo = '\uFEFF' + headers.join(';') + '\r\n' + linhas.join('\r\n');
    var extensao = formato === 'txt' ? 'txt' : 'csv';
    var mime = formato === 'txt' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8';
    downloadBlob(conteudo, 'bluesoft_enderecamento_' + invId + '_' + fileStamp() + '.' + extensao, mime);
    toast(result.rows.length.toLocaleString('pt-BR') + ' item(ns) exportado(s) em ' + extensao.toUpperCase() + '.', 's');
  };

  global.exportarContagensBluesoft = function (formato) {
    var seletor = document.getElementById('cont-finv');
    var invId = seletor ? String(seletor.value || '').trim() : '';
    if (!invId) return toast('Selecione um inventário no filtro da aba Contagens.', 'w');
    return global.ieExportarBluesoft(formato, invId);
  };

  global.ieBluesoftLayoutChanged = function () {};

  function configFromForm() {
    return {
      ambiente:value('api-env-badge') === 'PRD' ? 'producao' : (readJson(CFG_KEY, {}).ambiente || 'homologacao'),
      url_hml:value('api-url-hml'), url_prd:value('api-url-prd'), token:value('api-token'),
      timeout:Number(value('api-timeout')) || 30, warehouse_id:value('api-warehouse-id'),
      adapter:value('api-adapter-type') || 'custom',
      mapping:{endereco:value('fmap-endereco'),codigo_produto:value('fmap-codigo-produto'),descricao:value('fmap-descricao'),quantidade:value('fmap-qtd-esperada'),gtin:value('fmap-gtin')}
    };
  }
  function loadConfig() {
    var cfg = readJson(CFG_KEY, {});
    var fields = {'api-url-hml':cfg.url_hml,'api-url-prd':cfg.url_prd,'api-token':cfg.token,'api-timeout':cfg.timeout,'api-warehouse-id':cfg.warehouse_id,'api-adapter-type':cfg.adapter};
    Object.keys(fields).forEach(function (id) { if (el(id) && fields[id] != null) el(id).value = fields[id]; });
    if (cfg.mapping) {
      var maps = {'fmap-endereco':cfg.mapping.endereco,'fmap-codigo-produto':cfg.mapping.codigo_produto,'fmap-descricao':cfg.mapping.descricao,'fmap-qtd-esperada':cfg.mapping.quantidade,'fmap-gtin':cfg.mapping.gtin};
      Object.keys(maps).forEach(function (id) { if (el(id) && maps[id]) el(id).value = maps[id]; });
    }
    global.apiSetAmbiente(cfg.ambiente || 'homologacao', true);
    global.apiAdapterOnChange(cfg.adapter || 'custom');
  }
  global.apiSetAmbiente = function (environment, quiet) {
    var cfg = readJson(CFG_KEY, {}); cfg.ambiente = environment; writeJson(CFG_KEY, cfg);
    var prod = environment === 'producao';
    if (el('api-env-badge')) el('api-env-badge').textContent = prod ? 'PRD' : 'HML';
    if (el('api-url-env-tag')) el('api-url-env-tag').textContent = prod ? 'PRD' : 'HML';
    ['hml','prd'].forEach(function (key) {
      var button = el('api-env-btn-' + key), active = (prod ? key === 'prd' : key === 'hml');
      if (button) { button.style.background = active ? 'var(--info)' : 'transparent'; button.style.color = active ? '#fff' : 'var(--muted)'; }
    });
    global.apiSincUrl();
    if (!quiet) toast('Ambiente ' + (prod ? 'de produção' : 'de homologação') + ' selecionado.', 'i');
  };
  global.apiSincUrl = function () {
    var prod = el('api-env-badge') && el('api-env-badge').textContent === 'PRD';
    if (el('api-url')) el('api-url').value = value(prod ? 'api-url-prd' : 'api-url-hml');
  };
  global.apiSalvarConfig = function () { writeJson(CFG_KEY, configFromForm()); toast('Configuração da API salva.', 's'); };
  global.apiResetarMapeamento = function () {
    var defaults = {'fmap-endereco':'endereco,local,address','fmap-codigo-produto':'codigo_produto,codigo,sku,product_id','fmap-descricao':'descricao_produto,descricao,produto,description','fmap-qtd-esperada':'quantidade_esperada,saldo,qtd_esperada,expected_qty,saldo_erp','fmap-gtin':'gtin,ean,barcode,ean13,codigo_barras'};
    Object.keys(defaults).forEach(function (id) { if (el(id)) el(id).value = defaults[id]; });
    toast('Mapeamento padrão restaurado.', 's');
  };
  global.apiAdapterOnChange = function (type) {
    var descriptions = {custom:'Mapeamento manual de campos.',generic_rest:'API REST genérica com JSON.',bluesoft:'Formato de integração Bluesoft.',totvs:'Formato de integração TOTVS Protheus.',sap:'Formato de integração SAP.'};
    if (el('api-adapter-badge')) el('api-adapter-badge').textContent = String(type || 'custom').toUpperCase();
    if (el('api-adapter-desc')) { el('api-adapter-desc').style.display = 'block'; el('api-adapter-desc').textContent = descriptions[type] || descriptions.custom; }
  };
  function apiUrl(endpoint) {
    var base = value('api-url').replace(/\/+$/, ''), end = String(endpoint || '').trim();
    if (!base) throw new Error('Informe a URL da API.');
    return base + (end.charAt(0) === '/' ? end : '/' + end);
  }
  async function request(url, options) {
    var cfg = configFromForm(), controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, cfg.timeout * 1000);
    var headers = Object.assign({'Content-Type':'application/json'}, options && options.headers || {});
    if (cfg.token) headers.Authorization = /^Bearer /i.test(cfg.token) ? cfg.token : 'Bearer ' + cfg.token;
    try {
      var response = await fetch(url, Object.assign({}, options || {}, {headers:headers, signal:controller.signal}));
      var text = await response.text(), body = null;
      try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
      if (!response.ok) throw new Error('HTTP ' + response.status + (text ? ': ' + String(text).slice(0, 180) : ''));
      return body;
    } finally { clearTimeout(timer); }
  }
  global.apiTestarConexao = async function () {
    try { await request(apiUrl(''), {method:'GET'}); toast('Conexão com a API realizada.', 's'); }
    catch (error) { toast('Falha na conexão: ' + error.message, 'e'); }
  };
  function payloadFor(invId) {
    var cfg = configFromForm(), inv = (state().inventarios || []).find(function (item) { return String(item.id) === String(invId); });
    return {inventario_id:invId,inventario:inv ? (inv.nome || inv.codigo || inv.id) : invId,warehouse_id:cfg.warehouse_id,data_envio:new Date().toISOString(),contagens:consolidatedRows(invId)};
  }
  function addHistory(type, status, detail) {
    var rows = readJson(HISTORY_KEY, []); rows.unshift({data:new Date().toISOString(),tipo:type,status:status,detalhe:detail}); writeJson(HISTORY_KEY, rows.slice(0, 100)); renderHistory();
  }
  function renderHistory() {
    var target = el('api-historico-integracoes'); if (!target) return;
    var rows = readJson(HISTORY_KEY, []);
    target.innerHTML = rows.length ? rows.map(function (row) {
      return '<div style="display:grid;grid-template-columns:150px 110px 90px 1fr;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);font-size:.75rem"><span>' + escapeHtml(new Date(row.data).toLocaleString('pt-BR')) + '</span><b>' + escapeHtml(row.tipo) + '</b><span>' + escapeHtml(row.status) + '</span><span>' + escapeHtml(row.detalhe) + '</span></div>';
    }).join('') : '<div style="padding:32px;text-align:center;color:var(--muted-2);font-size:.8rem">Nenhuma integração registrada ainda.</div>';
  }
  global.apiLimparHistoricoIntegracoes = function () { writeJson(HISTORY_KEY, []); renderHistory(); toast('Histórico limpo.', 's'); };
  global.apiExportarInventario = async function () {
    var invId = value('api-export-inv');
    if (!invId) return toast('Selecione o inventário.', 'w');
    var payload = payloadFor(invId);
    if (!payload.contagens.length) return toast('O inventário não possui contagens para enviar.', 'w');
    try { await request(apiUrl(value('api-export-endpoint')), {method:'POST',body:JSON.stringify(payload)}); addHistory('EXPORTAÇÃO','SUCESSO',payload.contagens.length + ' registro(s)'); toast('Dados enviados para a API.', 's'); }
    catch (error) { addHistory('EXPORTAÇÃO','ERRO',error.message); toast('Erro ao enviar: ' + error.message, 'e'); }
  };
  global.apiEnviarParaFila = function () {
    var invId = value('api-export-inv'); if (!invId) return toast('Selecione o inventário.', 'w');
    var queue = readJson(QUEUE_KEY, []); queue.push({id:'q_' + Date.now(),criado_em:new Date().toISOString(),tentativas:0,endpoint:value('api-export-endpoint'),payload:payloadFor(invId)});
    writeJson(QUEUE_KEY, queue); renderQueue(); toast('Envio adicionado à fila.', 's');
  };
  function renderQueue() {
    ensureQueuePanel();
    var rows = readJson(QUEUE_KEY, []), target = el('ie-fila-lista'), badge = el('ie-fila-badge');
    if (badge) { badge.textContent = rows.length; badge.style.display = rows.length ? 'block' : 'none'; }
    if (!target) return;
    target.innerHTML = rows.length ? rows.map(function (row) {
      return '<div style="display:grid;grid-template-columns:150px 1fr 100px;gap:12px;align-items:center;padding:11px;border-bottom:1px solid var(--border)"><span>' + escapeHtml(new Date(row.criado_em).toLocaleString('pt-BR')) + '</span><span>Inventário ' + escapeHtml(row.payload.inventario || row.payload.inventario_id) + ' · ' + row.payload.contagens.length + ' registro(s)</span><button class="btn btn-danger btn-sm" onclick="apiRemoverFila(\'' + escapeHtml(row.id) + '\')">Remover</button></div>';
    }).join('') : '<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">Fila vazia</div><div class="empty-sub">Não há envios pendentes.</div></div>';
  }
  global.apiRemoverFila = function (id) { writeJson(QUEUE_KEY, readJson(QUEUE_KEY, []).filter(function (row) { return row.id !== id; })); renderQueue(); };
  global.apiProcessarFila = async function () {
    var queue = readJson(QUEUE_KEY, []), remaining = [];
    for (var i = 0; i < queue.length; i++) {
      try { await request(apiUrl(queue[i].endpoint), {method:'POST',body:JSON.stringify(queue[i].payload)}); addHistory('FILA','SUCESSO',queue[i].payload.contagens.length + ' registro(s)'); }
      catch (error) { queue[i].tentativas++; queue[i].ultimo_erro = error.message; remaining.push(queue[i]); addHistory('FILA','ERRO',error.message); }
    }
    writeJson(QUEUE_KEY, remaining); renderQueue(); toast(remaining.length ? 'Fila processada com ' + remaining.length + ' falha(s).' : 'Fila processada com sucesso.', remaining.length ? 'w' : 's');
  };

  function externalRows(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    return body.data || body.items || body.results || body.registros || [];
  }
  global.apiImportarDados = async function () {
    var type = value('api-import-tipo'), invId = value('api-import-inv');
    if (type !== 'enderecos' && !invId) return toast('Selecione o inventário de destino.', 'w');
    try {
      var body = await request(apiUrl(value('api-import-endpoint')), {method:'GET'}), rows = externalRows(body).map(normalizedObject);
      if (!rows.length) throw new Error('A API não retornou registros.');
      if (type === 'enderecos') {
        var addresses = rows.map(function (row) { return Object.assign({}, row, {endereco:row.endereco || row.local || row.address}); }).filter(function (row) { return row.endereco; });
        await saveBatches('dt_locais', addresses, function (row, index) { return String(row.endereco).replace(/[/.#$/[\]]/g, '_') || 'api_' + index; });
      } else if (type === 'contagens') {
        rows.forEach(function (row) { row.inventario_id = invId; row.origem = 'IMPORTACAO_API'; row.importado_em = new Date().toISOString(); });
        await saveBatches('dt_contagens', rows, function (_, index) { return 'api_' + Date.now().toString(36) + '_' + index; });
      } else {
        var ref = global.getDTFirestore().collection('dt_inventarios').doc(invId), raw = global.getDTRawFirestore(), total = Math.ceil(rows.length / 1000);
        for (var c = 0; c < total; c++) { var batch = raw.batch(); batch.set(ref.collection('base_chunks').doc(String(c + 1).padStart(5, '0')), {parte:c + 1,totalPartes:total,itens:rows.slice(c * 1000, (c + 1) * 1000)}); await batch.commit(); }
        await ref.set({base_total:rows.length,base_chunks:total,base_atualizada_em:new Date().toISOString()}, {merge:true});
      }
      addHistory('IMPORTAÇÃO','SUCESSO',rows.length + ' registro(s)'); toast(rows.length + ' registro(s) importado(s) da API.', 's');
    } catch (error) { addHistory('IMPORTAÇÃO','ERRO',error.message); toast('Erro na importação: ' + error.message, 'e'); }
  };

  global.apiAbrirSimulador = function () { fillInventories(); if (el('sim-adapter-sel')) el('sim-adapter-sel').value = value('api-adapter-type') || 'custom'; global.openModal('modal-api-simulador'); global.apiSimularPayload(); };
  global.apiSimularPayload = function () {
    var invId = value('sim-inv-sel'), output = el('sim-payload-out');
    if (!output) return;
    if (!invId) { currentPayload = null; output.textContent = '// Selecione um inventário para gerar o payload.'; return; }
    currentPayload = payloadFor(invId);
    var limit = Math.max(1, Math.min(20, Number(value('sim-limit')) || 3)), preview = Object.assign({}, currentPayload, {contagens:currentPayload.contagens.slice(0, limit)});
    output.textContent = JSON.stringify(preview, null, 2);
    if (el('sim-stats')) { el('sim-stats').style.display = 'block'; el('sim-stats').textContent = currentPayload.contagens.length + ' registro(s) no payload completo'; }
  };
  global.apiSimCopiar = async function () { if (!currentPayload) return toast('Gere um payload primeiro.', 'w'); await navigator.clipboard.writeText(JSON.stringify(currentPayload, null, 2)); toast('JSON copiado.', 's'); };
  global.apiSimBaixar = function () { if (!currentPayload) return toast('Gere um payload primeiro.', 'w'); downloadBlob(JSON.stringify(currentPayload, null, 2), 'payload_' + fileStamp() + '.json', 'application/json'); };

  document.addEventListener('DOMContentLoaded', function () {
    ensureQueuePanel(); updateCounts(); fillInventories(); loadConfig(); renderHistory(); renderQueue();
  });
})(window);
