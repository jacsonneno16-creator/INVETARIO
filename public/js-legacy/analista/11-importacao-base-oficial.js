var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
function state() { return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  6. IMPORTAÇÃO DE ARQUIVOS (BASE OFICIAL)
// ───────────────────────────────────────────────────────────────────
var CAMPOS_BASE = ['endereco', 'pallete_ou_capa', 'codigo_produto', 'descricao_produto', 'gtin', 'dun', 'quantidade_esperada', 'fator_caixa', 'setor', 'rua', 'nivel', 'custo_bruto', 'observacao'];
var ALIAS_BASE = {
    // ── Endereço ─────────────────────────────────────────────────────
    endereco: [
        // ⚡ Prioridade máxima — coluna padrão Da Terrinha
        'endereco_logistico_descritivo',
        // Demais colunas Da Terrinha
        'endereco_logistico_key',
        'end_logistico', 'localizacao', 'localizacao_estoque', 'posicao',
        // Padrão interno / genérico
        'endereco', 'endereço', 'end', 'address', 'cod_end', 'cod_endereco', 'codigo_endereco',
    ],
    // ── Palete / Capa ─────────────────────────────────────────────────
    pallete_ou_capa: [
        'pallete_ou_capa', 'pallete', 'pallet', 'capa', 'tipo', 'pallete ou capa',
        // Da Terrinha
        'palete_key', 'palete', 'pallet_key', 'num_palete', 'numero_palete',
    ],
    // ── Código do produto ─────────────────────────────────────────────
    codigo_produto: [
        'codigo_produto', 'codigo', 'código', 'sku', 'cod_produto', 'cod', 'item',
        // Da Terrinha
        'produto_key', 'produto_caixa_key', 'cod_item', 'codigo_item', 'item_key',
        'pessoa_key', // fallback se for o único identificador
    ],
    // ── Descrição ─────────────────────────────────────────────────────
    descricao_produto: [
        'descricao_produto', 'descricao', 'descrição', 'description', 'produto', 'desc', 'nome_produto',
        // Da Terrinha
        'descricao_ficha_estq_detalhe', 'descricao_local_estoque', 'nome_abreviado',
        'desc_produto', 'nome_produto', 'descricao_item',
    ],
    // ── GTIN ──────────────────────────────────────────────────────────
    gtin: [
        'gtin', 'ean', 'ean13', 'barcode', 'codigo_barras', 'codigo_de_barras', 'cod_barras', 'gtin_ean', 'gtinean', 'ean_gtin', 'eangtin', 'gtin_principal',
    ],
    // ── DUN ───────────────────────────────────────────────────────────
    dun: [
        'dun', 'dun14', 'ean14',
    ],
    // ── Quantidade esperada ───────────────────────────────────────────
    quantidade_esperada: [
        'estoque_total_unidades', 'estoque_unidades', 'total_unidades_estoque',
        'quantidade_esperada', 'saldo', 'saldo_estoque',
        'qtd_esperada', 'expected_qty', 'saldo_erp', 'qtd_sistema',
        'estoque_total', 'qtd_estoque', 'quantidade_enderecada', 'qtd_enderecada',
        'total_unidades', 'quantidade', 'qtd', 'qty', 'estoque', 'qtde', 'qtd_estoque',
        // Genéricos
        'quantidade', 'qtd', 'qty', 'estoque', 'qtde', 'fator_estoque',
    ],
    // ── Setor ─────────────────────────────────────────────────────────
    setor: [
        'setor', 'sector', 'area', 'área', 'local_area',
        // Da Terrinha
        'setor_armazenagem', 'descricao_setor_armazenagem', 'setor_estoque',
        'descricao_setor', 'area_armazenagem',
    ],
    // ── Rua / Corredor ────────────────────────────────────────────────
    rua: [
        'rua', 'corredor', 'aisle',
    ],
    // ── Nível ─────────────────────────────────────────────────────────
    nivel: [
        'nivel', 'nível', 'level', 'andar',
    ],
    // ── Custo unitário do produto ─────────────────────────────────────
    custo_bruto: [
        'custo_bruto', 'custo_unitario', 'custo_unit', 'custo', 'cost', 'unit_cost',
        'preco_custo', 'preco', 'valor_unitario',
        // Da Terrinha — variações comuns nos relatórios WMS
        'custo_liquido', 'custo_medio', 'custo_med', 'custo_un', 'custo_und',
        'vlr_custo', 'valor_custo', 'vl_custo', 'vl_unitario', 'vl_unit',
        'preco_medio', 'preco_med', 'preco_unitario', 'preco_unit',
        'custo_bruto_unit', 'custo_bruto_unitario', 'custo_liq',
    ],
    // ── Observação ────────────────────────────────────────────────────
    observacao: [
        'observacao', 'observação', 'obs', 'nota', 'notas',
        // Da Terrinha — campos extras mapeados como observação
        'curva', 'data_de_validade', 'numero_do_lote',
        'custo_bruto_total',
    ],
    fator_caixa: [
        'fator_caixa', 'fator_embalagem', 'fator', 'unid_cx', 'unidades_por_caixa',
        'unid_por_cx', 'fator_conversao', 'conv', 'factor', 'qty_per_box', 'fator_palete',
        'fator_cxa', 'und_cx', 'unid_embalagem', 'qtd_embalagem', 'emb', 'fator_und'
    ],
};
function autoMapBase(headers) {
    // Normaliza: lowercase, espaços→_, remove acentos e chars especiais
    var normalize = function (x) { return String(x).toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[\s\/\-]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, ''); };
    var h = headers.map(normalize);
    var mapa = {};
    CAMPOS_BASE.forEach(function (campo) {
        var aliases = (ALIAS_BASE[campo] || [campo]).map(normalize);
        // Itera aliases NA ORDEM da lista — o primeiro alias que existir no CSV vence
        // (não itera os headers do CSV, evitando que a ordem das colunas defina prioridade)
        var found = -1;
        for (var _i = 0, aliases_1 = aliases; _i < aliases_1.length; _i++) {
            var alias = aliases_1[_i];
            var idx = h.indexOf(alias);
            if (idx >= 0) {
                found = idx;
                break;
            }
        }
        if (found >= 0)
            mapa[campo] = found;
    });
    return mapa;
}
function parseRowsToBase(rows, headers) {
    var mapa = autoMapBase(headers);
    return rows.map(function (r) {
        var obj = {};
        CAMPOS_BASE.forEach(function (c) { var _a; obj[c] = mapa[c] !== undefined ? String((_a = r[mapa[c]]) !== null && _a !== void 0 ? _a : '').trim() : ''; });
        // Garantir que campos numéricos sejam números
        obj.quantidade_esperada = Math.max(0, parseFloat(obj.quantidade_esperada) || 0);
        obj.custo_bruto = Math.max(0, parseFloat(String(obj.custo_bruto).replace(',', '.')) || 0);
        return obj;
    }).filter(function (r) { return r.endereco || r.codigo_produto; });
}
// Drag & drop da base do inventário
function invDover(e) { e.preventDefault(); document.getElementById('inv-drop-zone').classList.add('drag'); }
function invDleave() { document.getElementById('inv-drop-zone').classList.remove('drag'); }
function invDdrop(e) { e.preventDefault(); invDleave(); if (e.dataTransfer.files[0])
    processFileInv(e.dataTransfer.files[0]); }
function handleFileInv(e) { if (e.target.files[0])
    processFileInv(e.target.files[0]); }
/* ── Utilitários de importação ── */
function stripBOM(str) {
    return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}
function detectSep(firstLine) {
    var sc = (firstLine.match(/;/g) || []).length;
    var cc = (firstLine.match(/,/g) || []).length;
    return sc >= cc ? ';' : ',';
}
function parseCSVRobust(text) {
    var clean = stripBOM(text);
    var lines = clean.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length)
        return { headers: [], rows: [] };
    var sep = detectSep(lines[0]);
    var parseL = function (line) {
        var result = [];
        var cur = '', inQ = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') {
                if (inQ && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                }
                else
                    inQ = !inQ;
            }
            else if (ch === sep && !inQ) {
                result.push(cur.trim());
                cur = '';
            }
            else
                cur += ch;
        }
        result.push(cur.trim());
        return result;
    };
    return { headers: parseL(lines[0]), rows: lines.slice(1).map(parseL) };
}
// ── Contexto temporário para o mapeador da base ──────────────────────
var _invRawCtx = null; // { headers, rows, arquivo }
function processFileInv(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    var isCsv = ext === 'csv';
    function _process(rawResult) {
        var _a;
        var rows, headers;
        if (isCsv) {
            var text = rawResult;
            if (/\uFFFD/.test(text)) {
                invFbErr('Arquivo CSV com encoding inválido. Salve como UTF-8 ou XLSX e tente novamente.');
                return;
            }
            (_a = parseCSVRobust(text), headers = _a.headers, rows = _a.rows);
        }
        else {
            try {
                var wb = XLSX.read(new Uint8Array(rawResult), { type: 'array', cellDates: true, raw: false });
                var ws = wb.Sheets[wb.SheetNames[0]];
                var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
                headers = (raw[0] || []).map(String);
                rows = raw.slice(1);
            }
            catch (e) {
                invFbErr('Erro ao ler XLSX: ' + e.message);
                return;
            }
        }
        if (!headers.length) {
            invFbErr('Arquivo vazio ou sem cabeçalho.');
            return;
        }
        _invRawCtx = { headers: headers, rows: rows, arquivo: file.name };
        window.AnalistaState.set('ui.inventarioImportCtx', null, { source: 'arquivo-import-reset' });
        habilitarBtnCriar();
        // Limpar feedback anterior
        document.getElementById('inv-import-fb').innerHTML = '';
        document.getElementById('inv-end-sel-wrap').style.display = 'none';
        // Mostrar o mapeador
        renderInvMapper();
    }
    var reader = new FileReader();
    reader.onerror = function () { return invFbErr('Não foi possível ler o arquivo. Tente novamente.'); };
    reader.onload = function (ev) { try {
        _process(ev.target.result);
    }
    catch (err) {
        invFbErr('Erro ao processar arquivo: ' + err.message);
    } };
    if (isCsv)
        reader.readAsText(file, 'UTF-8');
    else
        reader.readAsArrayBuffer(file);
}
// ── Configuração dos campos do mapeador ──────────────────────────────
var INV_MAP_CAMPOS = [
    { key: 'endereco', label: 'Endereço', obrig: true, icon: '📍', hint: 'Código do endereço (ex: 01.02.A.01.01)' },
    { key: 'codigo_produto', label: 'Código do Produto', obrig: true, icon: '🔑', hint: 'SKU, código ou chave do produto' },
    { key: 'descricao_produto', label: 'Descrição do Produto', obrig: false, icon: '📝', hint: 'Nome ou descrição do produto' },
    { key: 'quantidade_esperada', label: 'Quantidade Esperada (Unidades)', obrig: true, icon: '🔢', hint: 'Quantidade total esperada já em unidades. Não informe caixas neste campo: a importação não multiplica esta quantidade pelo fator.' },
    { key: 'custo_bruto', label: 'Custo Unitário (R$)', obrig: false, icon: '💰', hint: 'Custo unitário do produto — usado para calcular Valor Ganho/Perda na Análise por Produto' },
    { key: 'setor', label: 'Setor / Área', obrig: false, icon: '🏭', hint: 'Setor de armazenagem' },
    { key: 'rua', label: 'Rua / Corredor', obrig: false, icon: '🛤️', hint: 'Rua ou corredor do endereço' },
    { key: 'pallete_ou_capa', label: 'Palete / Capa', obrig: false, icon: '🪵', hint: 'Identificador de palete ou capa' },
    { key: 'gtin', label: 'GTIN / EAN', obrig: false, icon: '📊', hint: 'Código de barras unitário' },
    { key: 'dun', label: 'DUN / EAN-14', obrig: false, icon: '📦', hint: 'Código de barras de caixa' },
    { key: 'observacao', label: 'Observação', obrig: false, icon: '💬', hint: 'Lote, validade, curva ou observação extra' },
    { key: 'fator_caixa', label: 'Fator Caixa (Und/Cx)', obrig: false, icon: '📦', hint: 'Quantidade de unidades por caixa. Este fator é enviado ao coletor e usado somente quando o operador bipar um código de caixa (DUN); ele não altera a quantidade esperada durante a importação.' },
];
function renderInvMapper() {
    var headers = _invRawCtx.headers, rows = _invRawCtx.rows, arquivo = _invRawCtx.arquivo;
    var autoMap = autoMapBase(headers); // { campo: colIndex }
    // Opções de <select>: "" + cada coluna do arquivo
    var opts = "<option value=\"\">\u2014 n\u00E3o usar \u2014</option>" +
        headers.map(function (h, i) { return "<option value=\"".concat(i, "\">").concat(h, "</option>"); }).join('');
    // Prévia: primeiros 3 valores de uma coluna
    var preview3 = function (idx) {
        if (idx === '' || idx === undefined)
            return '';
        var vals = rows.slice(0, 3).map(function (r) { return String(r[idx] || '').trim(); }).filter(Boolean);
        return vals.length ? vals.join(', ') : '';
    };
    var camposHtml = INV_MAP_CAMPOS.map(function (c) {
        var autoIdx = autoMap[c.key] !== undefined ? autoMap[c.key] : '';
        var sel = "<select id=\"imap-".concat(c.key, "\" onchange=\"invMapperPreview()\" style=\"flex:1;min-width:160px;font-size:.8rem;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface)\">\n      ").concat(opts.replace("value=\"".concat(autoIdx, "\""), "value=\"".concat(autoIdx, "\" selected")), "\n    </select>");
        var prevId = "imap-ex-".concat(c.key);
        return "\n    <div style=\"display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;background:".concat(c.obrig ? '#f0fdf4' : 'var(--bg)', ";border:1px solid ").concat(c.obrig ? '#bbf7d0' : 'var(--border)', "\">\n      <div style=\"min-width:24px;font-size:1rem;margin-top:2px\">").concat(c.icon, "</div>\n      <div style=\"flex:1;min-width:0\">\n        <div style=\"display:flex;align-items:center;gap:6px;margin-bottom:4px\">\n          <span style=\"font-size:.8rem;font-weight:700;color:var(--text)\">").concat(c.label, "</span>\n          ").concat(c.obrig ? '<span style="font-size:.65rem;background:#dcfce7;color:#16a34a;padding:1px 5px;border-radius:4px;font-weight:700">OBRIGATÓRIO</span>' : '', "\n          <span style=\"font-size:.68rem;color:var(--muted)\">").concat(c.hint, "</span>\n        </div>\n        <div style=\"display:flex;align-items:center;gap:8px\">").concat(sel, "</div>\n        <div id=\"").concat(prevId, "\" style=\"margin-top:4px;font-size:.7rem;color:#0369a1;font-family:var(--mono);min-height:14px\"></div>\n      </div>\n    </div>");
    }).join('');
    document.getElementById('inv-mapper-zone').style.display = 'block';
    document.getElementById('inv-mapper-zone').innerHTML = "\n    <div style=\"border:1px solid #bae6fd;border-radius:10px;background:#f0f9ff;padding:14px\">\n      <div style=\"display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px\">\n        <div>\n          <div style=\"font-weight:700;font-size:.88rem;color:#0369a1\">\uD83D\uDDC2\uFE0F Mapeamento de Colunas \u2014 <span style=\"font-weight:400\">".concat(arquivo, "</span></div>\n          <div style=\"font-size:.73rem;color:var(--muted);margin-top:2px\">").concat(headers.length, " colunas detectadas \u00B7 ").concat(rows.length.toLocaleString('pt-BR'), " linhas \u00B7 Para cada campo, escolha a coluna correspondente do seu arquivo</div>\n        </div>\n        <button class=\"btn btn-ghost btn-sm\" onclick=\"resetInvImport()\" style=\"white-space:nowrap;flex-shrink:0\">\u21A9 Outro arquivo</button>\n      </div>\n\n      <!-- Pr\u00E9via r\u00E1pida do arquivo -->\n      <div style=\"margin-bottom:12px;overflow-x:auto;border-radius:7px;border:1px solid #bae6fd\">\n        <table style=\"font-size:.7rem;border-collapse:collapse;width:100%;min-width:400px\">\n          <thead><tr style=\"background:#dbeafe\">\n            ").concat(headers.map(function (h) { return "<th style=\"padding:5px 8px;text-align:left;color:#1d4ed8;font-weight:700;white-space:nowrap\">".concat(h, "</th>"); }).join(''), "\n          </tr></thead>\n          <tbody>\n            ").concat(rows.slice(0, 3).map(function (r) { return "<tr style=\"border-top:1px solid #e0f2fe\">".concat(headers.map(function (_, i) { return "<td style=\"padding:4px 8px;color:var(--text);white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis\">".concat(String(r[i] || '').trim().slice(0, 40), "</td>"); }).join(''), "</tr>"); }).join(''), "\n          </tbody>\n        </table>\n      </div>\n\n      <div style=\"display:flex;flex-direction:column;gap:6px\">").concat(camposHtml, "</div>\n\n      <div style=\"margin-top:12px;text-align:right\">\n        <button class=\"btn btn-success\" onclick=\"confirmarInvMapper()\">\u2713 Aplicar Mapeamento e Importar</button>\n      </div>\n    </div>");
    // ── Carregar mapeamento salvo se houver ──
    try {
        var headerKey = headers.join('|').toLowerCase();
        var savedMaps = JSON.parse(localStorage.getItem('inv_col_map') || '{}');
        var saved_1 = savedMaps[headerKey];
        if (saved_1 === null || saved_1 === void 0 ? void 0 : saved_1.mapa) {
            INV_MAP_CAMPOS.forEach(function (c) {
                var sel = document.getElementById("imap-".concat(c.key));
                // quantidade_esperada: sempre usar autoMap (nunca restaurar valor salvo)
                // para evitar que mapeamento antigo fique com coluna errada
                if (c.key === 'quantidade_esperada')
                    return;
                if (sel && saved_1.mapa[c.key] !== undefined) {
                    sel.value = saved_1.mapa[c.key];
                }
            });
            dbg('[Mapper] Mapeamento anterior restaurado de', saved_1.arquivo);
            // Mostrar aviso
            var mapperZone = document.getElementById('inv-mapper-zone');
            if (mapperZone) {
                var aviso = document.createElement('div');
                aviso.style.cssText = 'margin-bottom:8px;padding:8px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:.75rem;color:#92400e;display:flex;justify-content:space-between;align-items:center';
                aviso.innerHTML = "<span>\u2705 Mapeamento anterior restaurado automaticamente (".concat(saved_1.arquivo, ")</span>\n          <button onclick=\"this.parentElement.remove()\" style=\"background:none;border:none;cursor:pointer;color:#92400e;font-size:.9rem\">\u2715</button>");
                mapperZone.insertBefore(aviso, mapperZone.firstChild);
            }
        }
    }
    catch (e) { }
    // Popular prévias com o auto-mapeamento
    invMapperPreview();
}
function invMapperPreview() {
    if (!_invRawCtx)
        return;
    var rows = _invRawCtx.rows;
    INV_MAP_CAMPOS.forEach(function (c) {
        var sel = document.getElementById("imap-".concat(c.key));
        var ex = document.getElementById("imap-ex-".concat(c.key));
        if (!sel || !ex)
            return;
        if (sel.value === '') {
            ex.textContent = '';
            return;
        }
        var idx = parseInt(sel.value);
        var vals = rows.slice(0, 3).map(function (r) { return String(r[idx] || '').trim(); }).filter(Boolean);
        ex.textContent = vals.length ? '👁 ' + vals.join(' · ') : '(vazio nas primeiras linhas)';
    });
}
function confirmarInvMapper() {
    var _a, _b;
    if (!_invRawCtx)
        return;
    var headers = _invRawCtx.headers, rows = _invRawCtx.rows, arquivo = _invRawCtx.arquivo;
    // Validar obrigatórios
    var missing = INV_MAP_CAMPOS.filter(function (c) { var _a; return c.obrig && !((_a = document.getElementById("imap-".concat(c.key))) === null || _a === void 0 ? void 0 : _a.value); });
    if (missing.length) {
        invFbErr("Campos obrigat\u00F3rios n\u00E3o mapeados: ".concat(missing.map(function (c) { return c.label; }).join(', ')));
        return;
    }
    // Montar mapa { campo: colIndex } — autoMap como fallback, seleção do usuário tem prioridade
    var autoMap = autoMapBase(headers);
    var mapa = {};
    // Aplica autoMap como base (garante custo_bruto e outros campos sem UI no mapper)
    CAMPOS_BASE.forEach(function (campo) {
        if (autoMap[campo] !== undefined)
            mapa[campo] = autoMap[campo];
    });
    // Sobrescreve com escolhas explícitas do usuário
    INV_MAP_CAMPOS.forEach(function (c) {
        var sel = document.getElementById("imap-".concat(c.key));
        if (sel && sel.value !== '')
            mapa[c.key] = parseInt(sel.value);
        else if (sel && sel.value === '' && autoMap[c.key] !== undefined)
            delete mapa[c.key]; // usuário optou por "não usar"
    });
    // Log para diagnóstico
    console.log('[Mapper] mapa final:', JSON.stringify(mapa));
    console.log('[Mapper] fator_caixa col index:', mapa['fator_caixa'], '| ex valor linha0:', mapa['fator_caixa'] !== undefined ? String((_b = (_a = rows[0]) === null || _a === void 0 ? void 0 : _a[mapa['fator_caixa']]) !== null && _b !== void 0 ? _b : '') : 'NÃO MAPEADO');
    // Processar linhas com o mapa final
    var base = rows.map(function (r) {
        var obj = {};
        CAMPOS_BASE.forEach(function (campo) {
            var _a;
            obj[campo] = mapa[campo] !== undefined ? String((_a = r[mapa[campo]]) !== null && _a !== void 0 ? _a : '').trim() : '';
        });
        var fatorCx = Math.max(1, parseFloat(String(obj.fator_caixa || '').replace(',', '.')) || 1);
        obj.fator_caixa = fatorCx;
        // quantidade_esperada já está em UNIDADES no arquivo — NÃO multiplicar pelo fator
        // O fator é enviado ao coletor para que ele converta DUN(caixas)→unidades na hora de contar
        obj.quantidade_esperada = Math.max(0, parseFloat(obj.quantidade_esperada) || 0);
        obj.custo_bruto = Math.max(0, parseFloat(String(obj.custo_bruto).replace(',', '.')) || 0);
        return obj;
    }).filter(function (r) { return r.endereco && r.codigo_produto; }); // obrigatório: endereço E produto
    if (!base.length) {
        invFbErr('Nenhum registro válido após o mapeamento. Verifique as colunas selecionadas.');
        return;
    }
    window.AnalistaState.set('ui.inventarioImportCtx', { base: base, arquivo: arquivo, headers: headers, rows: rows }, { source: 'arquivo-import-ok' });
    // ── Salvar mapeamento para reutilizar na próxima importação ──
    try {
        var mapaUser_1 = {};
        INV_MAP_CAMPOS.forEach(function (c) {
            var sel = document.getElementById("imap-".concat(c.key));
            if (sel)
                mapaUser_1[c.key] = sel.value; // salva o índice selecionado
        });
        // Chave baseada nos nomes das colunas (independente da ordem das linhas)
        var headerKey = headers.join('|').toLowerCase();
        var savedMaps = JSON.parse(localStorage.getItem('inv_col_map') || '{}');
        savedMaps[headerKey] = { mapa: mapaUser_1, arquivo: arquivo, ts: Date.now() };
        // Manter só os 5 mais recentes
        var entries = Object.entries(savedMaps).sort(function (a, b) { return (b[1].ts || 0) - (a[1].ts || 0); }).slice(0, 5);
        localStorage.setItem('inv_col_map', JSON.stringify(Object.fromEntries(entries)));
        dbg('[Mapper] Mapeamento salvo para', headers.length, 'colunas');
    }
    catch (e) { }
    // Ocultar mapeador e mostrar resultado
    document.getElementById('inv-mapper-zone').style.display = 'none';
    var endsU = __spreadArray([], new Set(base.map(function (r) { return r.endereco; }).filter(Boolean)), true).length;
    var prodsU = __spreadArray([], new Set(base.map(function (r) { return r.codigo_produto; }).filter(Boolean)), true).length;
    document.getElementById('inv-import-fb').innerHTML = "\n    <div class=\"status-box ok\">\n      <div class=\"sb-icon\">\u2705</div>\n      <div>\n        <div class=\"sb-text\">".concat(base.length.toLocaleString('pt-BR'), " registros importados com mapeamento personalizado</div>\n        <div class=\"sb-sub\">").concat(arquivo, " \u00B7 ").concat(endsU, " endere\u00E7os \u00FAnicos \u00B7 ").concat(prodsU, " produtos \u00FAnicos\n          <button class=\"btn btn-ghost btn-sm\" onclick=\"document.getElementById('inv-mapper-zone').style.display='block'\" style=\"margin-left:8px;font-size:.7rem;padding:2px 8px\">\u270F\uFE0F Editar mapeamento</button>\n        </div>\n      </div>\n    </div>");
    document.getElementById('inv-end-sel-wrap').style.display = 'block';
    document.getElementById('inv-end-resumo-txt').textContent = "".concat(endsU, " endere\u00E7os \u00FAnicos da base ser\u00E3o inclu\u00EDdos automaticamente");
    habilitarBtnCriar();
}
function resetInvImport() {
    _invRawCtx = null;
    window.AnalistaState.set('ui.inventarioImportCtx', null, { source: 'reset-import' });
    document.getElementById('inv-mapper-zone').style.display = 'none';
    document.getElementById('inv-mapper-zone').innerHTML = '';
    document.getElementById('inv-import-fb').innerHTML = '';
    document.getElementById('inv-end-sel-wrap').style.display = 'none';
    document.getElementById('file-inv').value = '';
    document.getElementById('inv-drop-zone').classList.remove('drag');
    habilitarBtnCriar();
}
function invFbErr(msg) {
    document.getElementById('inv-import-fb').innerHTML = "<div class=\"status-box err\"><div class=\"sb-icon\">\u274C</div><div><div class=\"sb-text\">Erro na importa\u00E7\u00E3o</div><div class=\"sb-sub\">".concat(msg, "</div></div></div>");
    window.AnalistaState.set('ui.inventarioImportCtx', null, { source: 'reset-import' });
    habilitarBtnCriar();
}
