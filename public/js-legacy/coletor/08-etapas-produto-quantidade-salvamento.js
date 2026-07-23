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
// ═══════════════════════════════════════════════════
//  ETAPA 2: CAPA/PALETE
// ═══════════════════════════════════════════════════
function _capaNumero(val) {
    if (!/^\d+$/.test(String(val || '').trim()))
        return NaN;
    return parseInt(String(val).trim(), 10);
}
function _capaExisteNaBase(val) {
    var alvo = String(val || '').trim().replace(/^0+(?=\d)/, '');
    if (!alvo)
        return false;
    return (APP.base || []).some(function (r) {
        var _a, _b, _c, _d, _e;
        var bruto = (_e = (_d = (_c = (_b = (_a = r.pallete_ou_capa) !== null && _a !== void 0 ? _a : r.capa_palete) !== null && _b !== void 0 ? _b : r.capa) !== null && _c !== void 0 ? _c : r.palete_key) !== null && _d !== void 0 ? _d : r.pallet) !== null && _e !== void 0 ? _e : '';
        return String(bruto).trim().replace(/^0+(?=\d)/, '') === alvo;
    });
}
function _validarCapaInformada(val) {
    var texto = String(val == null ? '' : val).replace(/\D/g, '');
    var n = _capaNumero(texto);
    if (!texto || isNaN(n) || n < 1)
        return { ok: false, msg: 'Capa Palete inválida' };
    if (texto.length === 7) {
        return { ok: true, existente: _capaExisteNaBase(texto), manualSeteDigitos: true, n: n, valor: texto };
    }
    if (texto.length < 7) {
        var range = APP.capaRange;
        if (!range || !range.min || !range.max)
            return { ok: false, msg: 'Range do operador ainda não foi reservado. Atualize a base e tente novamente.' };
        if (n < range.min || n > range.max)
            return { ok: false, msg: 'Capas com menos de 7 dígitos só podem ser usadas dentro do seu range (' + String(range.min).padStart(3, '0') + '–' + String(range.max).padStart(3, '0') + ')' };
        return { ok: true, existente: _capaExisteNaBase(texto), nova: !_capaExisteNaBase(texto), n: n, valor: String(n).padStart(3, '0') };
    }
    return { ok: false, msg: 'A capa deve ter exatamente 7 dígitos ou estar dentro do range reservado.' };
}
function onCapaInput() {
    var elCapa = document.getElementById('f-capa');
    elCapa.value = elCapa.value.replace(/\D/g, '').slice(0, 7);
    var val = elCapa.value.trim();
    var fb = document.getElementById('fb-capa');
    if (!val) {
        fb.innerHTML = '';
        APP.atual.capaGerada = false;
        return;
    }
    var v = _validarCapaInformada(val);
    if (!v.ok) {
        fb.innerHTML = "<div class=\"fb err\">\u2717 ".concat(v.msg, "</div>");
        elCapa.className = 'field field-err';
        return;
    }
    fb.innerHTML = v.manualSeteDigitos
        ? "<div class=\"fb ok\">\u2713 Capa de 7 d\u00EDgitos aceita: ".concat(v.valor, "</div>")
        : (v.existente
            ? "<div class=\"fb ok\">\u2713 Capa dentro do seu range: ".concat(v.valor, "</div>")
            : "<div class=\"fb info\">\u26A1 Nova capa dentro do seu range: ".concat(v.valor, "</div>"));
    elCapa.className = 'field field-ok';
}
function confirmarCapa() {
    var input = document.getElementById('f-capa');
    var val = input.value.trim();
    var v = _validarCapaInformada(val);
    if (!v.ok) {
        toast(v.msg, 'e');
        beepErr();
        return;
    }
    var capaFinal = v.manualSeteDigitos ? v.valor : (v.valor || String(v.n).padStart(3, '0'));
    input.value = capaFinal;
    beepSuave();
    APP.atual.capa = capaFinal;
    APP.atual.capaGerada = !!v.nova;
    APP.atual.step = 3;
    if (APP.atual.somentesDun) {
        document.getElementById('gtin-label').textContent = '🔢 Etapa 3 — DUN (obrigatório)';
        document.getElementById('gtin-sublabel').textContent = 'Este endereço só aceita DUN';
        var _glt = document.getElementById('gtin-label-txt');
        if (_glt)
            _glt.textContent = 'DUN (obrigatório)';
        document.getElementById('f-gtin').placeholder = 'DUN (14 dígitos)';
    }
    else {
        document.getElementById('gtin-label').textContent = '🔢 Etapa 3 — GTIN / DUN';
        document.getElementById('gtin-sublabel').textContent = 'Bipe ou digite o código';
        var _glt2 = document.getElementById('gtin-label-txt');
        if (_glt2)
            _glt2.textContent = 'GTIN / DUN';
        document.getElementById('f-gtin').placeholder = 'GTIN (13) ou DUN (14)';
    }
    document.getElementById('f-gtin').value = '';
    document.getElementById('fb-gtin').innerHTML = '';
    document.getElementById('prod-found-box').style.display = 'none';
    updateSteps();
    setTimeout(function () { return document.getElementById('f-gtin').focus(); }, 100);
}
// ═══════════════════════════════════════════════════
//  ETAPA 3: GTIN / DUN  (melhoria 2: usa base normalizada)
// ═══════════════════════════════════════════════════
function onGtinInput() {
    var val = document.getElementById('f-gtin').value.trim();
    var fb = document.getElementById('fb-gtin');
    var pbox = document.getElementById('prod-found-box');
    if (!val) {
        fb.innerHTML = '';
        pbox.style.display = 'none';
        APP.atual.produtoAtual = null;
        return;
    }
    var isDun = val.length === 14;
    if (APP.atual.somentesDun && !isDun) {
        fb.innerHTML = "<div class=\"fb err\">\u2717 Este endere\u00E7o s\u00F3 aceita DUN (14 d\u00EDgitos). Digitado: ".concat(val.length, "</div>");
        document.getElementById('f-gtin').className = 'field icon-r field-err';
        APP.atual.produtoAtual = null;
        pbox.style.display = 'none';
        return;
    }
    if (APP.base.length) {
        // Busca com normalização forte — elimina diferenças de case/espaços do scanner
        var valNorm_1 = normProd(val);
        var _match_1 = function (r) {
            return normProd(r.gtin) === valNorm_1 ||
                normProd(r.dun) === valNorm_1 ||
                normProd(r.codigo_produto) === valNorm_1;
        };
        var reg = APP.base.find(_match_1);
        if (reg) {
            APP.atual.produtoAtual = reg;
            // Verificar divergência de endereço usando _end
            var endNorm_1 = APP.atual._endNorm || _normStr(APP.atual.endereco);
            var pertenceAoEnd = APP.base.some(function (r) { return r._end === endNorm_1 && _match_1(r); });
            APP.atual.produtoDivergenteEnd = endNorm_1 && !pertenceAoEnd;
            if (APP.atual.produtoDivergenteEnd) {
                fb.innerHTML = "<div class=\"fb warn\">\u26A0 Produto fora deste endere\u00E7o \u2014 ser\u00E1 avaliado pelo analista</div>";
                document.getElementById('f-gtin').className = 'field icon-r field-warn';
                // ► SEM SOM AQUI — o som forte toca em confirmarGtin() quando Enter chega
            }
            else {
                fb.innerHTML = "<div class=\"fb ok\">\u2713 Produto encontrado na base</div>";
                document.getElementById('f-gtin').className = 'field icon-r field-ok';
                // ► SEM SOM AQUI — o som suave toca em confirmarGtin() quando Enter chega
            }
            pbox.style.display = '';
            pbox.innerHTML = "\n        <div class=\"prod-card\">\n          <div class=\"prod-icon\">\uD83D\uDCE6</div>\n          <div>\n            <div class=\"prod-name\">".concat(reg.descricao_produto || '—', "</div>\n            <div class=\"prod-code\">").concat(reg.codigo_produto || '', " \u00B7 ").concat(isDun ? 'DUN' : 'GTIN', ": ").concat(val, "</div>\n          </div>\n        </div>");
        }
        else {
            APP.atual.produtoAtual = null;
            APP.atual.produtoDivergenteEnd = false;
            fb.innerHTML = "<div class=\"fb err\">\u2717 C\u00F3digo n\u00E3o encontrado na base</div>";
            document.getElementById('f-gtin').className = 'field icon-r field-err';
            pbox.style.display = 'none';
            // ► SEM SOM AQUI — o som toca em confirmarGtin() quando Enter chega
        }
    }
    else {
        fb.innerHTML = "<div class=\"fb warn\" style=\"flex-direction:column;align-items:flex-start;gap:6px\">\n      <b>\u26A0 Base n\u00E3o carregada</b>\n      <span style=\"font-size:.72rem\">Volte e selecione o invent\u00E1rio para baixar a base.</span>\n      <button onclick=\"voltarInventarios()\" style=\"padding:5px 12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;margin-top:2px\">\u21A9 Recarregar</button>\n    </div>";
        APP.atual.produtoAtual = { descricao_produto: 'Código sem cadastro', codigo_produto: val, gtin: val };
        APP.atual.produtoDivergenteEnd = false;
        pbox.style.display = 'none';
    }
}
function confirmarGtin() {
    var val = document.getElementById('f-gtin').value.trim();
    if (!val) {
        toast('Informe o código', 'e');
        beepErr();
        return;
    }
    if (APP.atual.somentesDun && val.length !== 14) {
        toast('Este endereço só aceita DUN (14 dígitos)', 'e');
        beepErr();
        return;
    }
    // Se produto não encontrado na base, avisa mas DEIXA PROSSEGUIR
    if (!APP.atual.produtoAtual && APP.base.length) {
        // Registrar como produto não identificado — não bloqueia
        APP.atual.produtoAtual = {
            descricao_produto: 'Código sem cadastro',
            codigo_produto: normProd(val),
            gtin: normProd(val),
            _nao_encontrado: true
        };
        APP.atual.produtoDivergenteEnd = false;
        toast('⚠ Código não está na base — registrando assim mesmo', 'w');
        // sem beep — não é erro, é aviso; o beep correto vem abaixo
    }
    // ── Som: depende se o produto pertence ou não ao endereço ──────────────
    // APP.atual.produtoDivergenteEnd já foi calculado por onGtinInput()
    if (APP.atual.produtoDivergenteEnd) {
        beepErroForte(); // ✗ produto bipado não pertence ao endereço informado
    }
    else if (APP.atual.produtoAtual && !APP.atual.produtoAtual._nao_encontrado) {
        beepSuave(); // ✓ produto correto para este endereço
    }
    // ────────────────────────────────────────────────────────────────────────
    APP.atual.gtin = normProd(val);
    APP.atual.step = 4;
    document.getElementById('f-validade').value = '';
    document.getElementById('fb-validade').innerHTML = '';
    updateSteps();
    setTimeout(function () { return document.getElementById('f-validade').focus(); }, 100);
}
// ═══════════════════════════════════════════════════
//  ETAPA 4: VALIDADE  (DD/MM/AAAA)
// ═══════════════════════════════════════════════════
function onValidadeInput() {
    var raw = document.getElementById('f-validade').value.replace(/\D/g, '');
    // Formatar como DD/MM/AAAA
    var fmt = '';
    if (raw.length > 0)
        fmt = raw.slice(0, 2);
    if (raw.length > 2)
        fmt += '/' + raw.slice(2, 4);
    if (raw.length > 4)
        fmt += '/' + raw.slice(4, 8);
    document.getElementById('f-validade').value = fmt;
    var fb = document.getElementById('fb-validade');
    if (fmt.length < 10) {
        fb.innerHTML = '';
        return;
    }
    var _a = fmt.split('/').map(Number), dd = _a[0], mm = _a[1], aaaa = _a[2];
    var dataVal = new Date(aaaa, mm - 1, dd);
    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (!dd || dd < 1 || dd > 31 || !mm || mm < 1 || mm > 12 || !aaaa || aaaa < 2000
        || isNaN(dataVal.getTime()) || dataVal.getDate() !== dd) {
        fb.innerHTML = "<div class=\"fb err\">\u2717 Data inv\u00E1lida \u2014 use DD/MM/AAAA</div>";
        document.getElementById('f-validade').className = 'field field-err';
        return;
    }
    if (dataVal < hoje) {
        fb.innerHTML = "<div class=\"fb err\">\u2717 Validade no passado \u2014 produto vencido!</div>";
        document.getElementById('f-validade').className = 'field field-err';
        return;
    }
    var maxData = new Date(hoje.getFullYear() + 5, hoje.getMonth(), hoje.getDate());
    if (dataVal > maxData) {
        fb.innerHTML = "<div class=\"fb warn\">\u26A0 Validade muito distante \u2014 confirme se est\u00E1 correta</div>";
        document.getElementById('f-validade').className = 'field field-warn';
        return;
    }
    var diasRestantes = Math.round((dataVal - hoje) / 86400000);
    var aviso = diasRestantes <= 90 ? " \u00B7 \u26A0 Vence em ".concat(diasRestantes, " dia(s)") : '';
    fb.innerHTML = "<div class=\"fb ok\">\u2713 V\u00E1lido at\u00E9 ".concat(fmt).concat(aviso, "</div>");
    document.getElementById('f-validade').className = 'field field-ok';
    // Auto-avança se digitou os 10 chars (DD/MM/AAAA) e data é válida
    if (fmt.length === 10 && !aviso.includes('⚠')) {
        setTimeout(function () { return confirmarValidade(); }, 300);
    }
}
function confirmarValidade() {
    var val = document.getElementById('f-validade').value;
    if (val.length < 10) {
        toast('Informe a validade completa (DD/MM/AAAA)', 'e');
        beepErr();
        return;
    }
    var _a = val.split('/').map(Number), dd = _a[0], mm = _a[1], aaaa = _a[2];
    var dataVal = new Date(aaaa, mm - 1, dd);
    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (!dd || dd < 1 || dd > 31 || !mm || mm < 1 || mm > 12 || !aaaa || aaaa < 2000
        || isNaN(dataVal.getTime()) || dataVal.getDate() !== dd) {
        toast('Data inválida (DD/MM/AAAA)', 'e');
        beepErr();
        return;
    }
    if (dataVal < hoje) {
        toast('Produto vencido!', 'e');
        beepErr();
        return;
    }
    APP.atual.validade = val;
    APP.atual.step = 5;
    beepOk();
    _calcExpr = '';
    _calcResultado = null;
    _calcMode = false;
    document.getElementById('f-qty').value = ''; // vazio — operador deve digitar
    // Esconder calculadora ao entrar na etapa
    var cw = document.getElementById('calc-wrap');
    if (cw)
        cw.style.display = 'none';
    updateSteps();
    setTimeout(function () { return document.getElementById('f-qty').focus(); }, 100);
}
// ═══════════════════════════════════════════════════
//  ETAPA 5: QUANTIDADE + CALCULADORA
// ═══════════════════════════════════════════════════
function _onQtyInput() {
    var _a;
    // Sincroniza digitação manual no campo f-qty com _calcExpr e _calcResultado
    var val = (((_a = document.getElementById('f-qty')) === null || _a === void 0 ? void 0 : _a.value) || '').trim();
    if (val === '') {
        _calcExpr = '';
        _calcResultado = null;
        return;
    }
    // Se não tem operador, é um número puro — atualizar resultado
    if (/^\d+$/.test(val)) {
        _calcExpr = val;
        _calcResultado = parseInt(val);
    }
    else {
        // Tem expressão — guardar como expr mas não calcular ainda
        _calcExpr = val;
    }
}
function changeQty(d) {
    // Se calculadora estiver ativa, não interfere
    if (_calcMode)
        return;
    var f = document.getElementById('f-qty');
    var cur = parseInt(f.value || '0');
    var novo = Math.max(0, cur + d);
    f.value = String(novo);
    _calcExpr = String(novo);
    _calcResultado = novo;
}
function mostrarCalculadora() {
    var cw = document.getElementById('calc-wrap');
    if (cw)
        cw.style.display = '';
}
function toggleCalculadora() {
    var cw = document.getElementById('calc-wrap');
    if (!cw)
        return;
    var aberta = cw.style.display !== 'none';
    if (aberta) {
        // Fechar: se tem resultado, confirma no campo; desativa modo calc
        cw.style.display = 'none';
        _calcMode = false;
        // Se campo tem expressão incompleta, limpar
        if (_calcExpr && /[+\-*/]/.test(_calcExpr.slice(-1))) {
            _calcExpr = '';
            if (_calcResultado !== null)
                _qtyDisplay(String(_calcResultado));
            else
                _qtyDisplay('');
        }
    }
    else {
        // Abrir: ativar modo calc
        cw.style.display = '';
        _calcMode = true;
        // Se campo já tem número, usa como ponto de partida
        var cur = document.getElementById('f-qty').value;
        if (cur && !isNaN(parseInt(cur))) {
            _calcExpr = cur;
            _calcResultado = parseInt(cur);
        }
        else {
            _calcExpr = '';
            _calcResultado = null;
            _qtyDisplay('');
        }
    }
}
// ═══════════════════════════════════════════════════
//  ETAPA 5: CALCULADORA  (usa f-qty como display)
// ═══════════════════════════════════════════════════
var _calcExpr = ''; // expressão em construção
var _calcResultado = null; // último resultado confirmado
var _calcMode = false; // true enquanto calculadora estiver aberta
function _qtyDisplay(val) {
    var el = document.getElementById('f-qty');
    if (el)
        el.value = val;
}
function calcNum(n) {
    // Se acabou de calcular um resultado e digita número novo, recomeça
    if (_calcResultado !== null && _calcExpr === '') {
        _calcResultado = null;
    }
    _calcExpr += n;
    _qtyDisplay(_calcExpr);
}
function calcOp(op) {
    // Se expressão vazia mas tem resultado anterior, continua a partir dele
    if (!_calcExpr && _calcResultado !== null) {
        _calcExpr = String(_calcResultado);
    }
    _calcExpr += op;
    _qtyDisplay(_calcExpr);
}
function calcAc() {
    _calcExpr = '';
    _calcResultado = null;
    APP.calc = { expr: '', resultado: null };
    _qtyDisplay('');
    document.getElementById('f-qty').placeholder = '0';
}
function calcEq() {
    if (!_calcExpr)
        return;
    try {
        var safe = _calcExpr.replace(/[^0-9+\-*/().]/g, '');
        var res = Function('"use strict"; return (' + safe + ')')();
        var arredondado = Math.round(res * 100) / 100;
        _calcResultado = arredondado;
        APP.calc.resultado = arredondado;
        _calcExpr = ''; // limpa expressão, mantém resultado para continuar operando
        _qtyDisplay(String(arredondado));
    }
    catch (_a) {
        _qtyDisplay('ERRO');
        setTimeout(function () {
            _calcExpr = '';
            _qtyDisplay('');
        }, 800);
    }
}
function calcUsar() { }
function atualizarCalcDisplay() { }
// ═══════════════════════════════════════════════════
//  SALVAR CONTAGEM
// ═══════════════════════════════════════════════════
// ── Anti-duplo disparo (Enter repetido / scanner duplo / clique duplo) ──────
var _salvandoContagem = false;
var _ultimaAssinaturaContagem = null;
var _ultimoSalvamentoTs = 0;
function _assinaturaContagem(atual, qty) {
    var _a;
    return [
        String(atual._endNorm || atual.endereco || '').trim().toUpperCase(),
        String(atual.capa || '').trim().toUpperCase(),
        String(atual.gtin || '').trim().toUpperCase(),
        String(atual.validade || '').trim(),
        Number(qty),
        String(((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || '').trim().toUpperCase(),
    ].join('|');
}
function salvarContagem() {
    var _a;
    // Trava: não abrir modal se já existe um em progresso
    if (_salvandoContagem)
        return;
    // Pegar valor do campo — pode ser resultado de cálculo ou digitação direta
    var rawVal = document.getElementById('f-qty').value.trim();
    if (!rawVal || rawVal === 'ERRO') {
        toast('Informe a quantidade', 'e');
        return;
    }
    // Se a expressão tiver operadores pendentes, calcular antes de salvar
    var qty;
    if (_calcExpr && /[+\-*/]/.test(_calcExpr)) {
        try {
            var safe = _calcExpr.replace(/[^0-9+\-*/().]/g, '');
            var res = Function('"use strict"; return (' + safe + ')')();
            qty = Math.round(res);
            _qtyDisplay(String(qty));
            _calcResultado = qty;
            _calcExpr = '';
        }
        catch (_b) {
            toast('Expressão inválida — use = antes de salvar', 'e');
            return;
        }
    }
    else {
        qty = parseInt(rawVal);
    }
    if (isNaN(qty) || qty < 0) {
        toast('Quantidade inválida', 'e');
        return;
    }
    var a = APP.atual;
    // ── Modal de confirmação com resumo ──────────────────────────
    var modal = document.createElement('div');
    modal.style.cssText = "\n    position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;\n    display:flex;align-items:center;justify-content:center;padding:20px;\n  ";
    modal.innerHTML = "\n    <div style=\"\n      background:var(--surface);border:1px solid var(--border);border-radius:18px;\n      padding:24px 20px;max-width:340px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5);\n    \">\n      <div style=\"font-size:1.3rem;text-align:center;margin-bottom:10px\">\u2705</div>\n      <div style=\"font-weight:800;font-size:.95rem;text-align:center;margin-bottom:16px;color:var(--text)\">Confirmar contagem?</div>\n      <div style=\"display:flex;flex-direction:column;gap:6px;margin-bottom:20px;font-size:.78rem\">\n        <div style=\"display:flex;justify-content:space-between;padding:7px 10px;background:var(--card);border-radius:8px\">\n          <span style=\"color:var(--muted)\">\uD83D\uDCCD Endere\u00E7o</span>\n          <span style=\"font-family:var(--mono);font-weight:700;color:var(--text)\">".concat(a.endereco, "</span>\n        </div>\n        <div style=\"display:flex;justify-content:space-between;padding:7px 10px;background:var(--card);border-radius:8px\">\n          <span style=\"color:var(--muted)\">\uD83C\uDFF7\uFE0F Capa Palete</span>\n          <span style=\"font-family:var(--mono);font-weight:700;color:var(--text)\">").concat(a.capa, "</span>\n        </div>\n        <div style=\"display:flex;justify-content:space-between;padding:7px 10px;background:var(--card);border-radius:8px;gap:8px\">\n          <span style=\"color:var(--muted);flex-shrink:0\">\uD83D\uDCE6 Produto</span>\n          <span style=\"font-weight:600;color:var(--text);text-align:right;font-size:.72rem\">").concat(((_a = a.produtoAtual) === null || _a === void 0 ? void 0 : _a.descricao_produto) || a.gtin, "</span>\n        </div>\n        <div style=\"display:flex;justify-content:space-between;padding:7px 10px;background:var(--card);border-radius:8px\">\n          <span style=\"color:var(--muted)\">\uD83D\uDCC5 Validade</span>\n          <span style=\"font-family:var(--mono);font-weight:700;color:var(--text)\">").concat(a.validade, "</span>\n        </div>\n        <div style=\"display:flex;justify-content:space-between;padding:10px 12px;background:rgba(232,117,26,.08);border:1px solid rgba(232,117,26,.2);border-radius:8px\">\n          <span style=\"color:var(--muted);font-weight:700\">\uD83D\uDD22 Quantidade</span>\n          <span style=\"font-family:var(--mono);font-weight:800;font-size:1.2rem;color:var(--accent)\">").concat((function () {
        var _gBip = normProd(a.gtin || '');
        if (_gBip.length === 14) {
            return '<b>' + qty + '</b> CX';
        }
        return '<b>' + qty + '</b> und';
    })(), "</span>\n        </div>\n      </div>\n      <div style=\"display:flex;gap:10px\">\n        <button id=\"btn-conf-cancelar\" style=\"\n          flex:1;padding:12px;border-radius:10px;border:1px solid var(--border);\n          background:transparent;color:var(--muted);font-size:.88rem;font-family:var(--sans);cursor:pointer\n        \">\u2717 Corrigir</button>\n        <button id=\"btn-conf-ok\" style=\"\n          flex:1;padding:12px;border-radius:10px;border:none;\n          background:linear-gradient(135deg,var(--success),#00a86b);\n          color:#060d1a;font-size:.88rem;font-weight:800;font-family:var(--sans);cursor:pointer\n        \">\u2713 Confirmar</button>\n      </div>\n    </div>");
    document.body.appendChild(modal);
    document.getElementById('btn-conf-ok').onclick = function () {
        var btnOk = document.getElementById('btn-conf-ok');
        if (btnOk) {
            btnOk.disabled = true;
            btnOk.textContent = 'Salvando…';
        }
        modal.remove();
        _executarSalvar(qty);
    };
    document.getElementById('btn-conf-cancelar').onclick = function () { modal.remove(); };
    modal.addEventListener('click', function (e) { if (e.target === modal)
        modal.remove(); });
}
function _executarSalvar(qty) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    // ── Trava anti-duplo: bloquear re-execução dentro de 1500ms com mesma assinatura ──
    if (_salvandoContagem)
        return;
    var _assin = _assinaturaContagem(APP.atual, qty);
    var _agora = Date.now();
    if (_ultimaAssinaturaContagem === _assin && (_agora - _ultimoSalvamentoTs) < 1500) {
        console.warn('[DT] Contagem duplicada bloqueada:', _assin);
        return;
    }
    _salvandoContagem = true;
    _ultimaAssinaturaContagem = _assin;
    _ultimoSalvamentoTs = _agora;
    setTimeout(function () { _salvandoContagem = false; }, 800);
    // ── Verificar se o inventário ainda está ativo antes de salvar ──
    if (!APP.inventario) {
        toast('⚠ Nenhum inventário ativo — selecione um inventário antes de contar.', 'e');
        _salvandoContagem = false;
        return;
    }
    if (APP.inventario.status && APP.inventario.status !== 'ATIVO') {
        toast("\u26A0 Invent\u00E1rio \"".concat(APP.inventario.nome, "\" est\u00E1 ").concat(APP.inventario.status, ". Contagem bloqueada."), 'e');
        _salvandoContagem = false;
        voltarInventarios();
        return;
    }
    if (!APP.inventario.id || APP.inventario.id === 'local') {
        toast('⚠ Inventário sem ID válido — sincronize e tente novamente.', 'e');
        _salvandoContagem = false;
        return;
    }
    var a = APP.atual;
    var qtdEsp = (_a = a.produtoAtual) === null || _a === void 0 ? void 0 : _a.quantidade_esperada;
    // Divergência real é decidida pelo analista ao processar — o coletor apenas registra.
    // Manter divergente=false para não contaminar o cálculo de divergências com
    // avaliação local de quantidade. O alerta abaixo é apenas visual/informativo.
    var divergente = false;
    var _alertaQtd = (qtdEsp !== '' &&
        qtdEsp !== undefined &&
        qty !== parseInt(qtdEsp));
    // Salvar sempre a quantidade como informada pelo operador (caixas ou unidades)
    // A conversão para unidades ocorre APENAS na Análise por Produto do analista
    var _gtinBipado = normProd(a.gtin);
    var _isDunBipado = _gtinBipado.length === 14;
    var _fatorCx = Math.max(1, parseFloat((_b = a.produtoAtual) === null || _b === void 0 ? void 0 : _b.fator_caixa) || 1);
    var _produtoGlobal = ((_c = window.DTProdutos) === null || _c === void 0 ? void 0 : _c.buscarSync(_gtinBipado)) || { encontrado: false };
    var _nomeProdutoLido = _produtoGlobal.encontrado
        ? _produtoGlobal.nomeProduto
        : (((_d = a.produtoAtual) === null || _d === void 0 ? void 0 : _d.descricao_produto) || 'Produto não identificado');
    var contagem = {
        id: Date.now(),
        uuid: gerarUUID(),
        inventario_id: ((_e = APP.inventario) === null || _e === void 0 ? void 0 : _e.id) || '',
        inventario_nome: ((_f = APP.inventario) === null || _f === void 0 ? void 0 : _f.nome) || '',
        inventario_codigo: ((_g = APP.inventario) === null || _g === void 0 ? void 0 : _g.codigo) || '',
        endereco: a.endereco,
        capa: a.capa,
        gtin: _gtinBipado,
        codigo_produto: normProd(((_h = a.produtoAtual) === null || _h === void 0 ? void 0 : _h.codigo_produto) || a.gtin),
        produto_codigo: normProd(((_j = a.produtoAtual) === null || _j === void 0 ? void 0 : _j.codigo_produto) || a.gtin),
        codigoLido: _gtinBipado,
        dunLido: _gtinBipado.length === 14 ? _gtinBipado : '',
        gtinLido: _gtinBipado.length !== 14 ? _gtinBipado : (_produtoGlobal.gtin || ''),
        produtoLidoId: _produtoGlobal.encontrado ? _produtoGlobal.produtoId : '',
        produtoLidoNome: _nomeProdutoLido,
        descricao: _nomeProdutoLido,
        descricao_produto: _nomeProdutoLido,
        validade: a.validade,
        quantidade: qty, // sempre em caixas (ou unidades, se GTIN)
        qtd_caixas: _isDunBipado ? qty : null, // quantas caixas o operador informou
        fator_caixa: _isDunBipado ? _fatorCx : null, // fator de conversão cx→und
        tipo_bipagem: _isDunBipado ? 'DUN' : 'GTIN', // qual código foi bipado
        quantidade_esperada: qtdEsp || '',
        divergente: divergente,
        operador: ((_k = APP.operador) === null || _k === void 0 ? void 0 : _k.name) || '',
        operador_email: ((_l = APP.operador) === null || _l === void 0 ? void 0 : _l.email) || '',
        coletor_id: localStorage.getItem('dt_device_id') || '',
        origem: 'COLETOR',
        tipo_contagem: APP.modoRecontagem ? 'RECONTAGEM' : 'PRIMEIRA',
        recontagem_id: ((_m = APP.modoRecontagem) === null || _m === void 0 ? void 0 : _m.id) || null,
        divergencia_id: ((_o = APP.modoRecontagem) === null || _o === void 0 ? void 0 : _o.divergencia_id) || null,
        dataHora: new Date(),
        criado_em: new Date().toISOString(),
        numero: APP.contagens.filter(function (c) { return c.endereco === a.endereco && c.gtin === a.gtin; }).length + 1,
    };
    contagem.bateu_auditoria = false;
    _marcarAuditoriaBatidaSeHouver(contagem).then(function (ok) {
        if (ok) {
            contagem.bateu_auditoria = true;
            renderHistorico();
            toast('✅ Bateu com auditoria', 's');
        }
    });
    APP.contagens.unshift(contagem);
    var n = parseInt(a.capa);
    if (!isNaN(n) && n >= APP.proximoCapa)
        APP.proximoCapa = n + 1;
    enfileirarContagem(__assign(__assign({}, contagem), { dataHora: contagem.dataHora.toISOString() }));
    renderHistorico();
    updateStats();
    // Toast de confirmação (sempre positivo — divergência real é processada no analista)
    toast('✓ Salvo: ' + contagem.descricao + ' × ' + qty, 's');
    beepOk();
    // Alerta informativo de quantidade — puramente visual, não influencia o fluxo
    if (_alertaQtd) {
        setTimeout(function () {
            toast("\u26A0 Aten\u00E7\u00E3o: esperado ".concat(qtdEsp, " \u00B7 contado ").concat(qty, ". Valida\u00E7\u00E3o final no analista."), 'w');
        }, 600);
    }
    // Em recontagem: concluir e voltar para aba de recontagens
    if (APP.modoRecontagem) {
        resetContagem();
        _concluirRecontagem();
        return;
    }
    // ── Verificar capacidade após salvar ─────────────────────────────────
    // Re-ler capacidade diretamente do mapa (mais confiável que APP.atual.capacidadeEnd)
    var _capMapa = (_r = (_q = (_p = APP.endCapacidade) === null || _p === void 0 ? void 0 : _p[a._endNorm]) !== null && _q !== void 0 ? _q : a.capacidadeEnd) !== null && _r !== void 0 ? _r : 0;
    var _cap = _capMapa;
    var _usados = _palletsNoEnderecoAtual(a._endNorm);
    // Regra explícita: capacidade 1 → encerrar após o primeiro pallet
    if (_cap === 1 && _usados >= 1) {
        toast('✅ Endereço encerrado (capacidade 1) — próximo endereço', 's');
        beepOk();
        finalizarEnderecoAtual();
        return;
    }
    // Regra geral: qualquer capacidade atingida → encerrar
    if (_cap > 0 && _usados >= _cap) {
        toast("\u2705 Capacidade do endere\u00E7o atingida (".concat(_usados, "/").concat(_cap, ") \u2014 pr\u00F3ximo endere\u00E7o"), 's');
        beepOk();
        finalizarEnderecoAtual();
        return;
    }
    // Ainda há vaga → manter endereço ativo para próximo pallet
    _manterEnderecoAtivo(a.endereco, a._endNorm, _cap || a.capacidadeEnd, a.somentesDun);
}
/**
 * Após salvar um pallet, mantém o endereço ativo e volta para a etapa 2 (Capa/Palete).
 * O botão END. VAZIO fica sempre disponível para o operador encerrar quando quiser.
 */
/**
 * Encerra completamente o endereço atual e volta para leitura de novo endereço.
 * Chamado quando: capacidade atingida, operador escolhe vazio com pallets já contados,
 * ou qualquer outra finalização sem entrar no modo rebipar.
 */
function finalizarEnderecoAtual() {
    _loteReset();
    APP.atual = {
        step: 1,
        endereco: '',
        _endNorm: '',
        enderecoValido: false,
        capacidadeEnd: 0,
        capa: '',
        gtin: '',
        produtoAtual: null,
        produtoDivergenteEnd: false,
        validade: '',
        quantidade: 0,
        somentesDun: false,
    };
    _endVerif = null;
    // Garantir bloco travado oculto e step-endereco visível
    var blocoTravado = document.getElementById('bloco-endereco-travado');
    if (blocoTravado)
        blocoTravado.style.display = 'none';
    var stepEnd = document.getElementById('step-endereco');
    if (stepEnd)
        stepEnd.style.display = '';
    // Limpar inputs
    ['f-endereco', 'f-capa', 'f-gtin', 'f-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.className = el.className.replace(/field-(ok|err|warn)/g, '').trim();
            el.disabled = false;
        }
    });
    var fqty = document.getElementById('f-qty');
    if (fqty)
        fqty.value = '';
    _calcExpr = '';
    _calcResultado = null;
    _calcMode = false;
    var cw = document.getElementById('calc-wrap');
    if (cw)
        cw.style.display = 'none';
    calcAc === null || calcAc === void 0 ? void 0 : calcAc();
    // Limpar feedbacks
    ['fb-endereco', 'fb-capa', 'fb-gtin', 'fb-validade', 'fb-rebipar'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.innerHTML = '';
    });
    var pb = document.getElementById('prod-found-box');
    if (pb)
        pb.style.display = 'none';
    // Ocultar botão vazio (nada confirmado ainda no próximo endereço)
    var vaziow = document.getElementById('btn-vazio-wrap');
    if (vaziow)
        vaziow.style.display = 'none';
    updateSteps();
    setTimeout(function () { try {
        document.getElementById('f-endereco').focus();
    }
    catch (e) { } }, 100);
}
function _manterEnderecoAtivo(endereco, endNorm, cap, somentesDun) {
    var palletsContados = _palletsNoEnderecoAtual(endNorm);
    // Guarda estado de "aguardando rebipar" — endereço travado
    APP.atual = {
        step: 1,
        endereco: '',
        _endNorm: '',
        enderecoValido: true, // libera botão VAZIO
        capacidadeEnd: cap,
        capa: '',
        gtin: '',
        produtoAtual: null,
        produtoDivergenteEnd: false,
        validade: '',
        quantidade: 0,
        somentesDun: somentesDun || false,
        _pendingEndereco: endNorm, // sinaliza modo travado
        _pendingPallets: palletsContados,
    };
    // Limpar campos das etapas 2-5
    ['f-capa', 'f-gtin', 'f-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.className = el.className.replace(/\bfield-(ok|err|warn)\b/g, '').trim();
            el.disabled = false;
        }
    });
    var fqty = document.getElementById('f-qty');
    if (fqty)
        fqty.value = '';
    _calcExpr = '';
    _calcResultado = null;
    _calcMode = false;
    var cw = document.getElementById('calc-wrap');
    if (cw)
        cw.style.display = 'none';
    calcAc();
    ['fb-capa', 'fb-gtin', 'fb-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.innerHTML = '';
    });
    var pb = document.getElementById('prod-found-box');
    if (pb)
        pb.style.display = 'none';
    // Limpar sf-val de todas as etapas
    ['sf-val-endereco', 'sf-val-capa', 'sf-val-gtin', 'sf-val-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.style.display = 'none';
        }
        var stepMap = { 'sf-val-endereco': 'step-endereco', 'sf-val-capa': 'step-capa', 'sf-val-gtin': 'step-gtin', 'sf-val-validade': 'step-validade' };
        var stepEl = document.getElementById(stepMap[id]);
        if (stepEl) {
            var inp = stepEl.querySelector('.sf-input-wrap .field');
            if (inp)
                inp.style.display = '';
        }
    });
    // Esconder o step-endereco normal e mostrar o bloco travado
    var stepEnd = document.getElementById('step-endereco');
    if (stepEnd)
        stepEnd.style.display = 'none';
    var blocoTravado = document.getElementById('bloco-endereco-travado');
    if (blocoTravado)
        blocoTravado.style.display = '';
    // Preencher info no bloco travado
    var txtEnd = document.getElementById('txt-endereco-travado');
    if (txtEnd)
        txtEnd.textContent = endereco.toUpperCase();
    var txtCap = document.getElementById('txt-cap-travado');
    if (txtCap) {
        if (cap > 0) {
            var restantes = Math.max(0, cap - palletsContados);
            txtCap.innerHTML = "\u2705 Pallet <b>".concat(palletsContados, "</b> salvo &nbsp;\u00B7&nbsp; Capacidade: <b>").concat(cap, "</b> &nbsp;\u00B7&nbsp; Restantes: <b>").concat(restantes, "</b>");
        }
        else {
            txtCap.innerHTML = "\u2705 Pallet <b>".concat(palletsContados, "</b> salvo");
        }
    }
    // Limpar campo de rebipar e feedback
    var fReb = document.getElementById('f-rebipar-endereco');
    if (fReb) {
        fReb.value = '';
        fReb.className = 'field';
    }
    var fbReb = document.getElementById('fb-rebipar');
    if (fbReb)
        fbReb.innerHTML = '';
    // Mostrar botão VAZIO
    var vaziow = document.getElementById('btn-vazio-wrap');
    if (vaziow)
        vaziow.style.display = '';
    // Esconder botão 🔄 reset (operador não pode sair livremente)
    var btnReset = document.getElementById('btn-reset-endereco');
    if (btnReset)
        btnReset.style.display = 'none';
    updateSteps();
    setTimeout(function () { try {
        document.getElementById('f-rebipar-endereco').focus();
    }
    catch (e) { } }, 100);
}
/** Confirma o rebipar do endereço no estado travado */
function confirmarRebipar() {
    var _a, _b, _c;
    var fReb = document.getElementById('f-rebipar-endereco');
    var fbReb = document.getElementById('fb-rebipar');
    if (!fReb || !fbReb)
        return;
    var val = _normStr(fReb.value);
    var esperado = _normStr(APP.atual._pendingEndereco || '');
    if (!val) {
        fbReb.innerHTML = "<div class=\"fb err\">\uD83D\uDEAB Bipe o endere\u00E7o primeiro</div>";
        beepErr();
        return;
    }
    if (val !== esperado) {
        fbReb.innerHTML = "<div class=\"fb err\">\uD83D\uDEAB Endere\u00E7o incorreto \u2014 esperado: <b>".concat((APP.atual._pendingEndereco || '').toUpperCase(), "</b></div>");
        fReb.className = 'field field-err';
        beepErr();
        return;
    }
    // Endereço correto — sair do modo travado
    var endNorm = APP.atual._pendingEndereco;
    var capRebipar = APP.atual.capacidadeEnd || 0;
    APP.atual._pendingEndereco = null;
    APP.atual._pendingPallets = null;
    // Re-ler capacidade do mapa (mais confiável)
    var capRebiparMapa = (_c = (_b = (_a = APP.endCapacidade) === null || _a === void 0 ? void 0 : _a[endNorm]) !== null && _b !== void 0 ? _b : capRebipar) !== null && _c !== void 0 ? _c : 0;
    // Verificar capacidade ANTES de prosseguir — pode já estar cheia
    var usadosRebipar = _palletsNoEnderecoAtual(endNorm);
    if (capRebiparMapa === 1 && usadosRebipar >= 1) {
        toast('✅ Endereço encerrado (capacidade 1) — próximo endereço', 's');
        finalizarEnderecoAtual();
        return;
    }
    if (capRebiparMapa > 0 && usadosRebipar >= capRebiparMapa) {
        // Capacidade já atingida — não deixar adicionar mais
        toast("\u2705 Capacidade atingida (".concat(usadosRebipar, "/").concat(capRebipar, ") \u2014 pr\u00F3ximo endere\u00E7o"), 's');
        finalizarEnderecoAtual();
        return;
    }
    // Restaurar step-endereco normal e esconder bloco travado
    var stepEnd = document.getElementById('step-endereco');
    if (stepEnd)
        stepEnd.style.display = '';
    var blocoTravado = document.getElementById('bloco-endereco-travado');
    if (blocoTravado)
        blocoTravado.style.display = 'none';
    _prosseguirComEndereco(endNorm);
}
function resetContagem() {
    APP.atual = { step: 1, endereco: '', _endNorm: '', enderecoValido: false, capa: '', gtin: '', produtoAtual: null, produtoDivergenteEnd: false, validade: '', quantidade: 0, somentesDun: false, capacidadeEnd: 0 };
    _endVerif = null; // invalidar cache de verificação
    _loteReset(); // limpar estado de lançamento rápido
    // Garantir que o bloco travado esteja oculto e o step-endereco visível
    var blocoTravado = document.getElementById('bloco-endereco-travado');
    if (blocoTravado)
        blocoTravado.style.display = 'none';
    var stepEnd = document.getElementById('step-endereco');
    if (stepEnd)
        stepEnd.style.display = '';
    // Limpar inputs e classes de validação
    ['f-endereco', 'f-capa', 'f-gtin', 'f-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.className = el.className.replace(/\bfield-(ok|err|warn)\b/g, '').trim();
            el.disabled = false;
        }
    });
    // Limpar qty e calculadora
    var fqty = document.getElementById('f-qty');
    if (fqty)
        fqty.value = '';
    _calcExpr = '';
    _calcResultado = null;
    _calcMode = false;
    var cw = document.getElementById('calc-wrap');
    if (cw)
        cw.style.display = 'none';
    calcAc();
    // Limpar feedbacks
    ['fb-endereco', 'fb-capa', 'fb-gtin', 'fb-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.innerHTML = '';
    });
    var pb = document.getElementById('prod-found-box');
    if (pb)
        pb.style.display = 'none';
    // Limpar sf-val (valor inline)
    ['sf-val-endereco', 'sf-val-capa', 'sf-val-gtin', 'sf-val-validade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.style.display = 'none';
        }
        // Restaurar input visível na linha
        var stepMap = { 'sf-val-endereco': 'step-endereco', 'sf-val-capa': 'step-capa', 'sf-val-gtin': 'step-gtin', 'sf-val-validade': 'step-validade' };
        var stepEl = document.getElementById(stepMap[id]);
        if (stepEl) {
            var inp = stepEl.querySelector('.sf-input-wrap .field');
            if (inp)
                inp.style.display = '';
        }
    });
    // Ocultar botão vazio
    var vaziow = document.getElementById('btn-vazio-wrap');
    if (vaziow)
        vaziow.style.display = 'none';
    // Limpar classes dos step-fields
    ['step-endereco', 'step-capa', 'step-gtin', 'step-validade', 'step-quantidade'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.classList.remove('done', 'ativo');
    });
    updateSteps();
    setTimeout(function () { var el = document.getElementById('f-endereco'); if (el)
        el.focus(); }, 80);
}
