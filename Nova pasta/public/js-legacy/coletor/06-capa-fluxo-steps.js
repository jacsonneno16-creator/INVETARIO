var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
// ═══════════════════════════════════════════════════
//  NUMERAÇÃO CAPA/PALETE
// ═══════════════════════════════════════════════════
function calcularProximoCapa() {
    var _a, _b, _c, _d;
    // Pegar todos os números já usados: na sessão atual + na base (campo pallete_ou_capa)
    var numsContagens = APP.contagens
        .filter(function (c) { return !c._excluida && c.status !== 'ESTORNADA' && c.status !== 'EXCLUIDA'; })
        .map(function (c) { return parseInt(c.capa); })
        .filter(function (n) { return !isNaN(n); });
    var numsBase = APP.base
        .map(function (r) { return parseInt(r.pallete_ou_capa || r.capa || 0); })
        .filter(function (n) { return !isNaN(n) && n > 0; });
    var todosUsados = new Set(__spreadArray(__spreadArray([], numsContagens, true), numsBase, true));
    // Se o operador tem range definido, começar do início do range
    var range = APP.capaRange;
    if (range && range.min && range.max) {
        // Encontrar o próximo número disponível dentro do range
        for (var n = range.min; n <= range.max; n++) {
            if (!todosUsados.has(n))
                return n;
        }
        // Range esgotado
        return range.max + 1;
    }
    // Sem range: pegar o maior usado + 1, respeitando início configurado (padrão = 1)
    var inicioBase = Math.max(1, parseInt((_d = (_b = (_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.capa_inicio_base) !== null && _b !== void 0 ? _b : (_c = APP.inventario) === null || _c === void 0 ? void 0 : _c.capa_inicio) !== null && _d !== void 0 ? _d : 1) || 1);
    var todos = __spreadArray(__spreadArray([], numsContagens, true), numsBase, true);
    var maximo = todos.length ? Math.max.apply(Math, todos) : (inicioBase - 1);
    return Math.max(inicioBase, maximo + 1);
}
function gerarNumeroCapa() {
    var n = APP.proximoCapa;
    document.getElementById('f-capa').value = String(n).padStart(3, '0');
    APP.atual.capaGerada = true;
    _atualizarHintCapa();
    document.getElementById('fb-capa').innerHTML = "<div class=\"fb info\">\u26A1 N\u00FAmero ".concat(n, " gerado automaticamente</div>");
    onCapaInput();
}
// ═══════════════════════════════════════════════════
//  FLUXO DE ETAPAS
// ═══════════════════════════════════════════════════
function updateSteps() {
    var _a;
    var s = APP.atual.step;
    // ── Indicador de progresso (dots) ──
    for (var i = 1; i <= 5; i++) {
        var dot = document.getElementById('sd-' + i);
        var line = document.getElementById('sl-' + i);
        if (!dot)
            continue;
        if (i < s) {
            dot.className = 'step-dot done';
            dot.textContent = '✓';
        }
        else if (i === s) {
            dot.className = 'step-dot active';
            dot.textContent = i;
        }
        else {
            dot.className = 'step-dot';
            dot.textContent = i;
        }
        if (line)
            line.className = 'step-line' + (i < s ? ' done' : '');
    }
    // ── Mostrar / ocultar step-fields ──
    var ordem = ['step-endereco', 'step-capa', 'step-gtin', 'step-validade', 'step-quantidade'];
    ordem.forEach(function (id, idx) {
        var el = document.getElementById(id);
        if (!el)
            return;
        var num = idx + 1; // etapa 1-based
        el.style.display = (s >= num) ? '' : 'none';
        // Classe ativo/done
        el.classList.remove('ativo', 'done');
        if (s === num)
            el.classList.add('ativo');
        else if (s > num)
            el.classList.add('done');
    });
    // ── Desabilitar inputs de etapas já concluídas ──
    var inputs = ['f-endereco', 'f-capa', 'f-gtin', 'f-validade'];
    inputs.forEach(function (id, idx) {
        var el = document.getElementById(id);
        if (el)
            el.disabled = (s > idx + 1);
    });
    // ── sf-val: mostrar valor confirmado inline na linha ──
    var a = APP.atual;
    _sfVal('step-endereco', 'sf-val-endereco', a.step > 1, a.endereco);
    _sfVal('step-capa', 'sf-val-capa', a.step > 2, a.capa);
    _sfVal('step-gtin', 'sf-val-gtin', a.step > 3, ((_a = a.produtoAtual) === null || _a === void 0 ? void 0 : _a.descricao_produto) ? a.produtoAtual.descricao_produto.slice(0, 26) : a.gtin);
    _sfVal('step-validade', 'sf-val-validade', a.step > 4, a.validade);
    // ── Botão END. VAZIO: aparece sempre que o endereço estiver confirmado,
    //    exceto quando o painel lote estiver ativo (tem seu próprio botão de encerrar)
    var vaziow = document.getElementById('btn-vazio-wrap');
    if (vaziow) {
        var loteAtivo = !!APP.lote; // painel lote assume o controle quando ativo
        vaziow.style.display = (!loteAtivo && (s >= 2 || (s === 1 && a.enderecoValido))) ? '' : 'none';
    }
    // ── Botão 🔄 reset: só aparece no primeiro pallet (sem pallets contados ainda) ──
    var btnReset = document.getElementById('btn-reset-endereco');
    if (btnReset && s > 1) {
        var endNorm_1 = a._endNorm || a._pendingEndereco;
        var temPallets = endNorm_1 && APP.contagens.some(function (c) {
            return c.endereco === endNorm_1 &&
                c.tipo_contagem !== 'VAZIO' &&
                !c._excluida &&
                c.status !== 'ESTORNADA' &&
                c.status !== 'EXCLUIDA';
        });
        btnReset.style.display = temPallets ? 'none' : '';
    }
    // resumo-atual não usado no novo layout
    var r = document.getElementById('resumo-atual');
    if (r)
        r.style.display = 'none';
}
/** Mostra o valor confirmado no sf-val e esconde o input na linha */
function _sfVal(stepId, valId, show, texto) {
    var stepEl = document.getElementById(stepId);
    var valEl = document.getElementById(valId);
    if (!stepEl || !valEl)
        return;
    if (show && texto) {
        valEl.textContent = texto;
        valEl.style.display = '';
        var inp = stepEl.querySelector('.sf-input-wrap .field');
        if (inp)
            inp.style.display = 'none';
    }
    else {
        valEl.style.display = 'none';
        var inp = stepEl.querySelector('.sf-input-wrap .field');
        if (inp)
            inp.style.display = '';
    }
}
function atualizarResumo() {
    // Compatibilidade — toda a lógica foi absorvida por updateSteps()
    updateSteps();
}
