var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
//  7-B. IMPORTAÇÃO DE ENDEREÇOS (com capacidade_paletes)
// ───────────────────────────────────────────────────────────────────
var ALIAS_END = {
    endereco: ['endereco', 'endereço', 'address', 'end', 'cod_end', 'codigo_end', 'endereço logístico'],
    loja: ['loja', 'loja_id', 'store', 'filial', 'cod_loja'],
    local: ['local', 'loc', 'localidade', 'pavilhao', 'pavilhão', 'galpao', 'galpão'],
    nome_local: ['nome_local', 'nome_do_local', 'local_nome', 'descricao_local', 'local_descricao', 'nome_setor', 'setor_nome', 'area_nome', 'nome_area', 'local_estoque', 'estoque_local', 'deposito', 'depósito', 'armazem', 'armazém', 'descr_local', 'desc_local'],
    area: ['area', 'área', 'area_id', 'zone', 'zona', 'sub_area'],
    rua: ['rua', 'corredor', 'aisle', 'row', 'corredor_rua'],
    coluna: ['coluna', 'col', 'column', 'col_id'],
    nivel: ['nivel', 'nível', 'level', 'andar', 'lvl'],
    sequencia: ['sequencia', 'sequência', 'seq', 'posicao', 'posição', 'pos'],
    observacao: ['observacao', 'observação', 'obs', 'descricao', 'descrição', 'nota'],
    tipo: ['tipo', 'type'],
    capacidade_paletes: ['capacidade_paletes', 'cap_paletes', 'capacidade', 'paletes', 'cap', 'capacidade_palete',
        'qtd_paletes', 'qtd_palete', 'num_paletes', 'slots'],
    ativo: ['ativo', 'active', 'status'],
};
// Definição dos campos para o mapeador de colunas
// pos: posição na montagem do endereço (1-7); null = campo extra não faz parte do código
var END_FIELDS = [
    { key: 'loja', label: 'Loja', pos: 1, icon: '🏪', hint: 'Código da loja/filial' },
    { key: 'local', label: 'Local', pos: 2, icon: '🏭', hint: 'Local / pavilhão' },
    { key: 'area', label: 'Área', pos: 3, icon: '🗂', hint: 'Área / setor' },
    { key: 'rua', label: 'Rua', pos: 4, icon: '🛣', hint: 'Corredor / rua' },
    { key: 'coluna', label: 'Coluna', pos: 5, icon: '📏', hint: 'Coluna' },
    { key: 'nivel', label: 'Nível', pos: 6, icon: '📐', hint: 'Nível / andar' },
    { key: 'sequencia', label: 'Seq', pos: 7, icon: '🔢', hint: 'Sequência' },
    { key: 'endereco', label: 'Endereço pronto', pos: null, icon: '🔗', hint: 'Coluna com endereço completo — sobrepõe os campos acima' },
    { key: 'capacidade_paletes', label: 'Cap. Paletes', pos: null, icon: '🏗', hint: 'Limite de paletes (0 = inativo)' },
    { key: 'ativo', label: 'Ativo (0/1)', pos: null, icon: '🟢', hint: 'Sim/Não ou 1/0' },
    { key: 'tipo', label: 'Tipo', pos: null, icon: '🏷', hint: 'ARMAZENAGEM, PISO, etc.' },
    { key: 'observacao', label: 'Observação', pos: null, icon: '📝', hint: 'Notas livres' },
];
// Estado da importação em andamento
var _endImport = { headers: [], rows: [], filename: '' };
// ── Helpers de drag/drop para endereços ──────────────────────────────────────
function endDover(e) { e.preventDefault(); document.getElementById('end-drop-zone').classList.add('drag'); }
function endDleave() { document.getElementById('end-drop-zone').classList.remove('drag'); }
function endDdrop(e) { e.preventDefault(); endDleave(); if (e.dataTransfer.files[0])
    processFileEnd(e.dataTransfer.files[0]); }
function handleFileEnd(e) { if (e.target.files[0])
    processFileEnd(e.target.files[0]); }
function resetEndImport() {
    _endImport = { headers: [], rows: [], filename: '' };
    document.getElementById('end-upload-zone').style.display = '';
    document.getElementById('end-mapper-zone').style.display = 'none';
    document.getElementById('end-import-fb').innerHTML = '';
    var btn = document.getElementById('btn-conf-end');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '✓ Importar Endereços';
    }
    var fi = document.getElementById('file-end');
    if (fi)
        fi.value = '';
}
function processFileEnd(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    var reader = new FileReader();
    reader.onload = function (ev) {
        try {
            var headers_1 = [], rows = [];
            if (ext === 'csv') {
                // ── CSV — robusto (BOM + separador automático) ───────
                var parsed = parseCSVRobust(ev.target.result);
                if (!parsed.headers.length) {
                    endFbErr('Arquivo CSV vazio.');
                    return;
                }
                headers_1 = parsed.headers.map(function (h) { return String(h).trim(); });
                rows = parsed.rows.filter(function (r) { return r.some(function (c) { return String(c || '').trim(); }); });
            }
            else {
                // ── XLSX / XLS ────────────────────────────────────────
                // Ler como array buffer (evita problema de encoding)
                var wb = void 0;
                try {
                    wb = XLSX.read(ev.target.result, { type: 'array' });
                }
                catch (e1) {
                    // fallback: tentar com Uint8Array
                    wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
                }
                var wsName = wb.SheetNames[0];
                if (!wsName) {
                    endFbErr('Planilha sem abas detectadas.');
                    return;
                }
                var ws = wb.Sheets[wsName];
                // sheet_to_json com header:1 devolve array de arrays
                var raw_1 = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
                if (!raw_1.length) {
                    endFbErr('Planilha vazia.');
                    return;
                }
                // Primeira linha: headers
                headers_1 = (raw_1[0] || []).map(function (h) { return String(h !== null && h !== void 0 ? h : '').trim(); });
                // Remover colunas completamente vazias
                var colsValidas_1 = headers_1.map(function (h, i) { return i; }).filter(function (i) {
                    var header = headers_1[i];
                    if (header)
                        return true;
                    // verificar se alguma linha tem valor nessa coluna
                    return raw_1.slice(1).some(function (r) { var _a; return String((_a = r[i]) !== null && _a !== void 0 ? _a : '').trim() !== ''; });
                });
                headers_1 = colsValidas_1.map(function (i) { return headers_1[i] || "Col".concat(i + 1); });
                rows = raw_1.slice(1)
                    .filter(function (r) { return r.some(function (c) { return String(c !== null && c !== void 0 ? c : '').trim() !== ''; }); }) // remover linhas vazias
                    .map(function (r) { return colsValidas_1.map(function (i) { var _a; return String((_a = r[i]) !== null && _a !== void 0 ? _a : '').trim(); }); });
            }
            if (!headers_1.length || !rows.length) {
                endFbErr('Nenhum dado encontrado no arquivo.');
                return;
            }
            // Guardar estado e mostrar o mapeador
            _endImport = { headers: headers_1, rows: rows, filename: file.name };
            document.getElementById('end-upload-zone').style.display = 'none';
            document.getElementById('end-mapper-zone').style.display = '';
            renderColMapper();
            document.getElementById('end-import-fb').innerHTML = '';
            document.getElementById('btn-conf-end').disabled = false;
        }
        catch (err) {
            endFbErr('Erro ao ler arquivo: ' + err.message);
            console.error(err);
        }
    };
    if (ext === 'csv')
        reader.readAsText(file, 'UTF-8');
    else
        reader.readAsArrayBuffer(file);
}
function endFbErr(msg) {
    document.getElementById('end-import-fb').innerHTML =
        "<div class=\"status-box err\"><div class=\"sb-icon\">\u274C</div><div><div class=\"sb-text\">Erro</div><div class=\"sb-sub\">".concat(msg, "</div></div></div>");
}
/** Detecta automaticamente qual coluna do arquivo mapeia para cada campo via ALIAS_END */
function autoDetectCols(headers) {
    var h = headers.map(function (x) { return x.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''); });
    var mapping = {};
    Object.entries(ALIAS_END).forEach(function (_a) {
        var campo = _a[0], aliases = _a[1];
        var idx = h.findIndex(function (hh) { return aliases.some(function (a) { return hh === a || hh.startsWith(a); }); });
        if (idx >= 0)
            mapping[campo] = idx;
    });
    return mapping;
}
/** Retorna o valor de um campo da linha raw conforme o select do mapper */
function _getMapVal(row, fieldKey) {
    var _a;
    var sel = document.getElementById("map-sel-".concat(fieldKey));
    if (!sel || sel.value === '')
        return '';
    var idx = parseInt(sel.value);
    if (isNaN(idx))
        return '';
    return String((_a = row[idx]) !== null && _a !== void 0 ? _a : '').trim();
}
/** Monta o endereço a partir de uma linha raw usando os selects atuais do mapper */
function _buildAddrFromRow(row) {
    var end = _getMapVal(row, 'endereco');
    if (end)
        return { endereco: end, fromDirect: true, parts: end.split('.') };
    var parts = ['loja', 'local', 'area', 'rua', 'coluna', 'nivel', 'sequencia'].map(function (k) { return _getMapVal(row, k); });
    var endereco = parts.filter(Boolean).join('.');
    return { endereco: endereco, fromDirect: false, parts: parts };
}
function renderColMapper() {
    var headers = _endImport.headers, rows = _endImport.rows, filename = _endImport.filename;
    var autoMap = autoDetectCols(headers);
    // Gerar opções para os selects (com exemplo da 1ª linha)
    var optsFor = function (key) {
        var detected = autoMap[key];
        return "<option value=\"\">\u2014 n\u00E3o mapear \u2014</option>" +
            headers.map(function (h, i) {
                var _a;
                var ex = rows[0] ? String((_a = rows[0][i]) !== null && _a !== void 0 ? _a : '').trim().slice(0, 20) : '';
                var sel = (detected !== undefined && detected === i) ? ' selected' : '';
                return "<option value=\"".concat(i, "\"").concat(sel, ">").concat(h).concat(ex ? " \u00B7 ".concat(ex) : '', "</option>");
            }).join('');
    };
    document.getElementById('end-mapper-content').innerHTML = "\n    <div class=\"mapper-wrap\">\n      <div style=\"margin-bottom:10px\">\n        <div style=\"font-weight:700;font-size:.88rem\">\uD83D\uDCC4 ".concat(filename, "</div>\n        <div style=\"font-size:.7rem;color:var(--muted);margin-top:2px\">").concat(rows.length.toLocaleString('pt-BR'), " linhas \u00B7 ").concat(headers.length, " colunas detectadas</div>\n      </div>\n\n      <div style=\"background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:.75rem;color:#1d4ed8\">\n        \uD83D\uDCA1 O sistema extrai automaticamente as 7 partes do endere\u00E7o separando pelo ponto <strong>(loja \u00B7 local \u00B7 \u00E1rea \u00B7 rua \u00B7 coluna \u00B7 n\u00EDvel \u00B7 seq)</strong>.<br>\n        Voc\u00EA s\u00F3 precisa dizer <strong>qual coluna cont\u00E9m o endere\u00E7o</strong> e <strong>qual cont\u00E9m a capacidade de paletes</strong>.\n      </div>\n\n      <div style=\"display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px\">\n        <div>\n          <div style=\"font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text);margin-bottom:5px\">\n            \uD83D\uDD17 Coluna do Endere\u00E7o <span style=\"color:var(--danger)\">*</span>\n          </div>\n          <select class=\"mapper-select\" id=\"map-sel-endereco\" onchange=\"updateMapperPreview()\" style=\"width:100%\">\n            ").concat(optsFor('endereco'), "\n          </select>\n          <div id=\"map-ex-endereco\" style=\"font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-top:3px\">\u2014</div>\n        </div>\n        <div>\n          <div style=\"font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text);margin-bottom:5px\">\n            \uD83C\uDFD7 Capacidade de Paletes <span style=\"color:var(--danger)\">*</span>\n          </div>\n          <select class=\"mapper-select\" id=\"map-sel-capacidade_paletes\" onchange=\"updateMapperPreview()\" style=\"width:100%\">\n            ").concat(optsFor('capacidade_paletes'), "\n          </select>\n          <div id=\"map-ex-capacidade_paletes\" style=\"font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-top:3px\">\u2014</div>\n        </div>\n        <div>\n          <div style=\"font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:5px\">\n            \uD83D\uDFE2 Ativo (0/1) <span style=\"color:var(--muted);font-weight:400\">opcional</span>\n          </div>\n          <select class=\"mapper-select\" id=\"map-sel-ativo\" onchange=\"updateMapperPreview()\" style=\"width:100%\">\n            ").concat(optsFor('ativo'), "\n          </select>\n          <div id=\"map-ex-ativo\" style=\"font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-top:3px\">\u2014</div>\n        </div>\n        <div>\n          <div style=\"font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:5px\">\n            \uD83C\uDFF7 Tipo <span style=\"color:var(--muted);font-weight:400\">opcional</span>\n          </div>\n          <select class=\"mapper-select\" id=\"map-sel-tipo\" onchange=\"updateMapperPreview()\" style=\"width:100%\">\n            ").concat(optsFor('tipo'), "\n          </select>\n          <div id=\"map-ex-tipo\" style=\"font-family:var(--mono);font-size:.7rem;color:var(--muted);margin-top:3px\">\u2014</div>\n        </div>\n      </div>\n\n      <div style=\"margin-bottom:12px;padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px\">\n        <div style=\"font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#166534;margin-bottom:8px\">\n          \uD83C\uDFED Nome do Local de Estoque <span style=\"font-weight:400;color:#16a34a\">\u2014 usado para agrupar e filtrar os endere\u00E7os</span>\n        </div>\n        <select class=\"mapper-select\" id=\"map-sel-nome_local\" onchange=\"updateMapperPreview()\" style=\"width:100%;border-color:#86efac\">\n          ").concat(optsFor('nome_local'), "\n        </select>\n        <div id=\"map-ex-nome_local\" style=\"font-family:var(--mono);font-size:.7rem;color:#16a34a;margin-top:4px\">\u2014</div>\n        <div style=\"font-size:.68rem;color:#4ade80;margin-top:3px\">Se n\u00E3o selecionado, o sistema usar\u00E1 a parte num\u00E9rica do endere\u00E7o como agrupamento</div>\n      </div>\n\n      <div class=\"addr-preview-wrap\" id=\"end-addr-preview\">\n        <div class=\"addr-preview-header\">\uD83D\uDC41 Pr\u00E9via \u2014 primeiros registros</div>\n        <div style=\"padding:14px;text-align:center;color:var(--muted);font-size:.8rem\">Selecione a coluna do endere\u00E7o para ver a pr\u00E9via</div>\n      </div>\n    </div>");
    updateMapperPreview();
}
function updateMapperPreview() {
    var rows = _endImport.rows;
    if (!rows.length)
        return;
    var SIMPLE_KEYS = ['endereco', 'capacidade_paletes', 'ativo', 'tipo', 'nome_local'];
    SIMPLE_KEYS.forEach(function (key) {
        var _a, _b;
        var sel = document.getElementById("map-sel-".concat(key));
        var exEl = document.getElementById("map-ex-".concat(key));
        if (!sel || !exEl)
            return;
        if (sel.value === '') {
            exEl.textContent = '—';
            return;
        }
        var idx = parseInt(sel.value);
        exEl.textContent = String((_b = (_a = rows[0]) === null || _a === void 0 ? void 0 : _a[idx]) !== null && _b !== void 0 ? _b : '').trim().slice(0, 30) || '(vazio)';
    });
    // Prévia com decomposição automática
    var PLABELS = ['Loja', 'Local', 'Área', 'Rua', 'Col', 'Nív', 'Seq'];
    var PCOLORS = ['#dbeafe', '#dcfce7', '#fef9c3', '#fce7f3', '#ede9fe', '#ffedd5', '#e0f2fe'];
    var PTXT = ['#1d4ed8', '#16a34a', '#a16207', '#be185d', '#6d28d9', '#c2410c', '#0369a1'];
    var preview = rows.slice(0, 5);
    var rowsHtml = preview.map(function (row) {
        var endereco = _buildAddrFromRow(row).endereco;
        if (!endereco)
            return '';
        var parts = endereco.split('.');
        var capVal = _getMapVal(row, 'capacidade_paletes');
        var ativoVal = _getMapVal(row, 'ativo');
        var partsHtml = parts.map(function (p, i) { return p ? "\n      <span class=\"addr-part\" style=\"background:".concat(PCOLORS[i] || '#f1f5f9', "\">\n        <span class=\"addr-part-lbl\" style=\"color:").concat(PTXT[i] || '#64748b', "\">").concat(PLABELS[i] || 'P' + (i + 1), "</span>\n        <span class=\"addr-part-val\" style=\"color:").concat(PTXT[i] || '#1e293b', "\">").concat(p, "</span>\n      </span>") : ''; }).join('');
        var nomeLocalVal = _getMapVal(row, 'nome_local');
        var extras = [];
        if (nomeLocalVal !== '')
            extras.push("\uD83C\uDFED local: <strong>".concat(nomeLocalVal, "</strong>"));
        if (capVal !== '')
            extras.push("\uD83C\uDFD7 cap: <strong>".concat(capVal, "</strong>"));
        if (ativoVal !== '')
            extras.push("ativo: ".concat(ativoVal));
        return "<div class=\"addr-preview-row\">\n      <div class=\"addr-code\">".concat(endereco, "\n        ").concat(extras.length ? "<span style=\"font-size:.68rem;color:var(--muted);font-weight:400;margin-left:8px\">".concat(extras.join(' · '), "</span>") : '', "\n      </div>\n      <div class=\"addr-parts\">").concat(partsHtml || '<span style="font-size:.72rem;color:var(--warn)">⚠️ Endereço sem partes reconhecidas — verifique o separador "."</span>', "</div>\n    </div>");
    }).filter(Boolean).join('');
    document.getElementById('end-addr-preview').innerHTML = "\n    <div class=\"addr-preview-header\">\uD83D\uDC41 Pr\u00E9via \u2014 primeiros ".concat(preview.length, " registros (decomposi\u00E7\u00E3o autom\u00E1tica por \".\")</div>\n    ").concat(rowsHtml || '<div style="padding:14px;text-align:center;color:var(--muted);font-size:.8rem">Selecione a coluna do endereço para ver a prévia</div>');
}
function confirmarImportEnderecos() {
    var rows = _endImport.rows;
    if (!rows.length) {
        showToast('Nenhum arquivo carregado', 'e');
        return;
    }
    // Validar campo obrigatório — endereço
    var selEnd = document.getElementById('map-sel-endereco');
    if (!selEnd || selEnd.value === '') {
        showToast('⚠️ Selecione a coluna do Endereço antes de importar', 'w');
        return;
    }
    var PLABELS = ['loja', 'local', 'area', 'rua', 'coluna', 'nivel', 'sequencia'];
    var built = [];
    rows.forEach(function (row) {
        var _a, _b, _c, _d, _e;
        // Ler endereço diretamente da coluna mapeada
        var endIdx = parseInt(document.getElementById('map-sel-endereco').value);
        var endereco = String((_a = row[endIdx]) !== null && _a !== void 0 ? _a : '').trim();
        if (!endereco)
            return;
        // Decompor automaticamente pelo separador "."
        var parts = endereco.split('.');
        var loja = parts[0] || '';
        var local = parts[1] || '';
        var area = parts[2] || '';
        var rua = parts[3] || '';
        var coluna = parts[4] || '';
        var nivel = parts[5] || '';
        var sequencia = parts[6] || '';
        // ── Capacidade de paletes ─────────────────────────────────────────
        // Ler diretamente do índice mapeado (não via _getMapVal que usa o select pelo id key)
        var cap = null;
        var selCap = document.getElementById('map-sel-capacidade_paletes');
        if (selCap && selCap.value !== '') {
            var capIdx = parseInt(selCap.value);
            var rawCap = String((_b = row[capIdx]) !== null && _b !== void 0 ? _b : '').trim().replace(',', '.').replace(/[^\d]/g, '');
            if (rawCap !== '') {
                var n = parseInt(rawCap, 10);
                if (!isNaN(n) && n >= 0)
                    cap = n;
            }
        }
        // ── Status ativo ──────────────────────────────────────────────────
        var ativo = true;
        var selAtivo = document.getElementById('map-sel-ativo');
        if (selAtivo && selAtivo.value !== '') {
            var rawAtivo = String((_c = row[parseInt(selAtivo.value)]) !== null && _c !== void 0 ? _c : '').trim().toLowerCase();
            if (rawAtivo !== '') {
                ativo = !['0', 'false', 'não', 'nao', 'inativo', 'n', 'no'].includes(rawAtivo);
            }
        }
        if (cap === 0)
            ativo = false;
        // ── Tipo ──────────────────────────────────────────────────────────
        var tipo = 'ARMAZENAGEM';
        var selTipo = document.getElementById('map-sel-tipo');
        if (selTipo && selTipo.value !== '') {
            var rawTipo = String((_d = row[parseInt(selTipo.value)]) !== null && _d !== void 0 ? _d : '').trim().toUpperCase();
            if (rawTipo)
                tipo = rawTipo;
        }
        // ── Nome do Local de Estoque ──────────────────────────────────────
        var nomeLocal = '';
        var selNomeLocal = document.getElementById('map-sel-nome_local');
        if (selNomeLocal && selNomeLocal.value !== '') {
            nomeLocal = String((_e = row[parseInt(selNomeLocal.value)]) !== null && _e !== void 0 ? _e : '').trim();
        }
        built.push({
            id: _idSeq++,
            endereco: endereco,
            loja: loja,
            local: local,
            area: area,
            rua: rua,
            coluna: coluna,
            nivel: nivel,
            sequencia: sequencia,
            local_area: local || area || '',
            nome_local: nomeLocal,
            tipo: tipo,
            observacao: '',
            capacidade_paletes: cap,
            ativo: ativo,
            setor: nomeLocal || local || area || 'SEM LOCAL',
        });
    });
    if (!built.length) {
        showToast('⚠️ Nenhum endereços válido encontrado', 'w');
        return;
    }
    // Se há endereços existentes E nenhum nome_local foi selecionado, avisar
    var temNomeLocal = built.some(function (e) { return e.nome_local; });
    var existentes = state().enderecosLista.length;
    if (existentes > 0 && !temNomeLocal) {
        showConfirm('Você não selecionou a coluna "Nome do Local de Estoque". Sem isso, os endereços serão agrupados pelo número do endereço (ex: 1520, 1540...). Deseja continuar assim mesmo?', function () { return _finalizarImportacaoEnderecos(built); }, { title: "⚠️ Sem Nome do Local", icon: "⚠️", okLabel: "Continuar assim mesmo", okClass: "btn-warn" });
        return;
    }
    // Caminho normal: tudo certo, importar diretamente
    _finalizarImportacaoEnderecos(built);
}
function _finalizarImportacaoEnderecos(built) {
    built.forEach(function (e) { return _addEndDB(e); });
    var totalImport = built.length;
    var inativos = state().enderecosLista.filter(function (e) { return !e.ativo; }).length;
    var capZero = state().enderecosLista.filter(function (e) { return e.capacidade_paletes === 0; }).length;
    var semCap = state().enderecosLista.filter(function (e) { return e.capacidade_paletes === null; }).length;
    window.AnalistaState.set('enderecosTemp', [], { source: 'finalizarImportacaoEnderecos' });
    storageSave(KEYS.enderecos, state().enderecosLista);
    atualizarEnderecos();
    closeModal('modal-end-import');
    resetEndImport();
    var btn = document.getElementById('btn-conf-end');
    if (btn)
        btn.disabled = true;
    logSistema('ENDERECO', "".concat(totalImport, " endere\u00E7os importados (").concat(inativos, " inativos, ").concat(capZero, " cap=0, ").concat(semCap, " sem cap)"), {});
    showToast("\u2705 ".concat(totalImport.toLocaleString('pt-BR'), " endere\u00E7os importados").concat(capZero ? " \u00B7 ".concat(capZero, " inativos (cap=0)") : '').concat(semCap ? " \u00B7 ".concat(semCap, " sem cap") : ''), 's');
}
/**
 * Adiciona um endereço ao ENDDB (memória).
 * Regra de negócio:
 *   - capacidade_paletes não informada → default null (sem limite definido)
 *   - capacidade_paletes = 0 → força ativo = false (endereço inativo para operação)
 *   - capacidade_paletes > 0 → mantém o valor; ativo não é alterado por aqui
 */
function _addEndDB(e) {
    // Suporte à estrutura de 7 partes: loja.local.area.rua.coluna.nivel.seq
    // setor = campo de agrupamento (local > area > local_area > setor)
    var setor = e.nome_local || e.setor || e.local || e.area || e.local_area || 'SEM LOCAL';
    // Auto-extrair rua do código do endereço se não vier explicitamente
    // Estrutura: loja.local.area.rua.col.niv.seq → rua = partes[3]
    var ruaFinal = e.rua || '';
    if (!ruaFinal && e.endereco) {
        var parts = String(e.endereco).split('.');
        ruaFinal = parts.length >= 4 ? (parts[3] || '') : (parts[0] || '');
    }
    // Auto-extrair nome_local do código se não vier explicitamente
    // local = partes[1] (posição 1: loja.LOCAL.area.rua...)
    var nomLocalFinal = e.nome_local || e.local_area || e.local || '';
    if (!nomLocalFinal && e.endereco) {
        var parts = String(e.endereco).split('.');
        nomLocalFinal = parts.length >= 2 ? (parts[1] || '') : '';
    }
    // Normalizar capacidade_paletes
    var cap = e.capacidade_paletes;
    if (cap !== undefined && cap !== null && cap !== '') {
        cap = parseInt(cap, 10);
        if (isNaN(cap))
            cap = null;
    }
    else {
        cap = null;
    }
    // Regra: cap === 0 → forçar inativo
    var ativo = e.ativo !== undefined ? Boolean(e.ativo) : true;
    if (cap === 0)
        ativo = false;
    var obj = __assign(__assign({}, e), { id: e.id || (_idSeq++), setor: setor, rua: ruaFinal, nome_local: nomLocalFinal, local_area: e.local || e.area || e.local_area || nomLocalFinal, capacidade_paletes: cap, ativo: ativo });
    // Upsert: se já existe, atualiza; senão, insere
    var existIdx = state().enderecosLista.findIndex(function (x) { return x.endereco === e.endereco; });
    if (existIdx >= 0) {
        // Remover do porSetor antigo
        var setorAntigo = state().enderecosLista[existIdx].setor;
        if (state().enderecosPorSetor[setorAntigo]) {
            state().enderecosPorSetor[setorAntigo] = state().enderecosPorSetor[setorAntigo].filter(function (x) { return x.endereco !== e.endereco; });
            if (!state().enderecosPorSetor[setorAntigo].length)
                delete state().enderecosPorSetor[setorAntigo];
        }
        obj.id = state().enderecosLista[existIdx].id; // Preservar id
        state().enderecosLista[existIdx] = obj;
    }
    else {
        window.AnalistaState.replaceSlice('enderecosLista', __spreadArray(__spreadArray([], (state().enderecosLista || []), true), [obj], false), { source: 'addEnderecoDB' });
    }
    // Inserir/atualizar no porSetor novo
    if (!state().enderecosPorSetor[setor])
        state().enderecosPorSetor[setor] = [];
    var posSetor = state().enderecosPorSetor[setor].findIndex(function (x) { return x.endereco === e.endereco; });
    if (posSetor >= 0)
        state().enderecosPorSetor[setor][posSetor] = obj;
    else
        state().enderecosPorSetor[setor].push(obj);
}
// Endereço manual
function previewNem() {
    var vals = ['nem-loja', 'nem-local', 'nem-area', 'nem-rua', 'nem-coluna', 'nem-nivel', 'nem-seq'].map(function (id) { var _a; return ((_a = document.getElementById(id)) === null || _a === void 0 ? void 0 : _a.value.trim()) || ''; });
    document.getElementById('nem-preview').textContent = vals.filter(Boolean).join('.') || '—';
}
function salvarEnderecoManual() {
    var _a, _b, _c;
    var loja = document.getElementById('nem-loja').value.trim();
    var local = document.getElementById('nem-local').value.trim();
    var area = document.getElementById('nem-area').value.trim();
    var rua = document.getElementById('nem-rua').value.trim();
    var col = document.getElementById('nem-coluna').value.trim();
    var nivel = document.getElementById('nem-nivel').value.trim();
    var seq = document.getElementById('nem-seq').value.trim();
    if (!loja || !local || !rua) {
        showToast('Preencha loja, local e rua', 'e');
        return;
    }
    var endereco = [loja, local, area, rua, col, nivel, seq].filter(Boolean).join('.');
    if (state().enderecosLista.some(function (e) { return e.endereco === endereco; })) {
        showToast('Endereço já cadastrado', 'w');
        return;
    }
    // Capacidade de paletes
    var cap = null;
    var capRaw = (_b = (_a = document.getElementById('nem-cap')) === null || _a === void 0 ? void 0 : _a.value) === null || _b === void 0 ? void 0 : _b.trim();
    if (capRaw !== '' && capRaw !== undefined) {
        cap = parseInt(capRaw, 10);
        if (isNaN(cap) || cap < 0) {
            showToast('Capacidade inválida (use 0 ou número positivo)', 'e');
            return;
        }
    }
    // cap = 0 → força inativo
    var ativo = document.getElementById('nem-ativo').value === '1';
    if (cap === 0)
        ativo = false;
    var nomeLocal = ((_c = document.getElementById('nem-nome-local')) === null || _c === void 0 ? void 0 : _c.value.trim()) || '';
    var obj = {
        id: _idSeq++,
        endereco: endereco,
        loja: loja,
        local: local,
        area: area,
        local_area: local || area || '', // campo legado
        nome_local: nomeLocal,
        rua: rua,
        coluna: col,
        nivel: nivel,
        sequencia: seq,
        tipo: document.getElementById('nem-tipo').value,
        ativo: ativo,
        capacidade_paletes: cap,
        observacao: document.getElementById('nem-obs').value.trim(),
        setor: nomeLocal || local || area || 'SEM LOCAL',
    };
    _addEndDB(obj);
    storageSave(KEYS.enderecos, state().enderecosLista);
    atualizarEnderecos();
    closeModal('modal-end-manual');
    logSistema('ENDERECO', "Endere\u00E7o ".concat(endereco, " cadastrado manualmente (cap=").concat(cap !== null && cap !== void 0 ? cap : 'N/A', ", ativo=").concat(ativo, ")"), {});
    showToast("\u2705 Endere\u00E7o ".concat(endereco, " salvo!").concat(cap === 0 ? ' (inativo — capacidade 0)' : ''), 's');
}
// Seleção de endereços para inventário
function abrirSelecaoEnderecos() {
    window.AnalistaState.set('ui.selecionadosSetores', new Set(Object.keys(state().enderecosPorSetor)), { source: 'selecionarTodosSetores' });
    document.getElementById('sel-end-busca').value = '';
    renderSelEnd();
    openModal('modal-sel-end');
}
function renderSelEnd() {
    var _a;
    var busca = (((_a = document.getElementById('sel-end-busca')) === null || _a === void 0 ? void 0 : _a.value) || '').toLowerCase().trim();
    var lista = document.getElementById('sel-end-lista');
    var setores = Object.keys(state().enderecosPorSetor).sort();
    var filtrados = busca ? setores.filter(function (s) { return s.toLowerCase().includes(busca) || state().enderecosPorSetor[s].some(function (e) { return e.endereco.toLowerCase().includes(busca); }); }) : setores;
    if (!filtrados.length) {
        lista.innerHTML = "<div style=\"padding:20px;text-align:center;color:var(--muted);font-size:.82rem\">Nenhum local encontrado</div>";
        atualizarContSelEnd();
        return;
    }
    lista.innerHTML = filtrados.map(function (setor) {
        var count = state().enderecosPorSetor[setor].length;
        var ativo = state().ui.selecionadosSetores.has(setor);
        return "<div onclick=\"toggleSelSetor('".concat(setor.replace(/'/g, "\\'"), "',this)\"\n      style=\"display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border);cursor:pointer;background:").concat(ativo ? '#eff6ff' : '#fff', ";transition:background .12s\">\n      <div style=\"width:18px;height:18px;border-radius:4px;border:2px solid ").concat(ativo ? 'var(--accent)' : '#d1d5db', ";background:").concat(ativo ? 'var(--accent)' : '#fff', ";display:flex;align-items:center;justify-content:center;flex-shrink:0\">\n        ").concat(ativo ? '<span style="color:#fff;font-size:10px;font-weight:800">✓</span>' : '', "\n      </div>\n      <div style=\"flex:1\">\n        <div style=\"font-weight:600;font-size:.83rem\">").concat(setor, "</div>\n        <div style=\"font-size:.7rem;color:var(--muted);margin-top:1px\">").concat(count, " endere\u00E7os</div>\n      </div>\n      <span class=\"badge ").concat(ativo ? 'b-blue' : 'b-gray', "\">").concat(count, "</span>\n    </div>");
    }).join('');
    atualizarContSelEnd();
}
function toggleSelSetor(setor) {
    var nextSelecionados = new Set(Array.from(state().ui.selecionadosSetores || []));
    if (nextSelecionados.has(setor))
        nextSelecionados.delete(setor);
    else
        nextSelecionados.add(setor);
    window.AnalistaState.set('ui.selecionadosSetores', nextSelecionados, { source: 'toggleSetor' });
    renderSelEnd();
}
function selecionarTodosEnd(v) {
    window.AnalistaState.set('ui.selecionadosSetores', v ? new Set(Object.keys(state().enderecosPorSetor)) : new Set(), { source: 'toggleTodosSetores' });
    renderSelEnd();
}
function atualizarContSelEnd() {
    var total = __spreadArray([], state().ui.selecionadosSetores, true).reduce(function (a, s) { var _a; return a + (((_a = state().enderecosPorSetor[s]) === null || _a === void 0 ? void 0 : _a.length) || 0); }, 0);
    document.getElementById('sel-end-count').textContent = "".concat(total.toLocaleString('pt-BR'), " endere\u00E7os selecionados de ").concat(state().ui.selecionadosSetores.size, " local(is)");
}
function confirmarSelecaoEnderecos() {
    var ends = [];
    state().ui.selecionadosSetores.forEach(function (s) { if (state().enderecosPorSetor[s])
        ends.push.apply(ends, state().enderecosPorSetor[s]); });
    if (state().ui.inventarioImportCtx) {
        // Atualizar resumo no modal de novo inventário
        document.getElementById('inv-end-resumo-txt').textContent = "".concat(ends.length, " endere\u00E7os de ").concat(state().ui.selecionadosSetores.size, " local(is) selecionados");
    }
    closeModal('modal-sel-end');
    showToast("\u2705 ".concat(ends.length.toLocaleString('pt-BR'), " endere\u00E7os selecionados!"), 's');
}
// ───────────────────────────────────────────────────────────────────
