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
//  18. RENDERIZAÇÃO — ENDEREÇOS
// ───────────────────────────────────────────────────────────────────
function atualizarEnderecos(renderToo) {
    if (renderToo === void 0) { renderToo = true; }
    var setores = Object.keys(state().enderecosPorSetor);
    var ativos = state().enderecosLista.filter(function (e) { return e.ativo; }).length;
    var inativos = state().enderecosLista.filter(function (e) { return !e.ativo; }).length;
    var capZero = state().enderecosLista.filter(function (e) { return e.capacidade_paletes === 0; }).length;
    // Calcular endereços com limite atingido no inventário ativo atual
    var invAtivo = getInventariosAtivos()[0] || null;
    var bloqueados = 0;
    if (invAtivo) {
        state().enderecosLista.filter(function (e) { return e.ativo && e.capacidade_paletes !== null && e.capacidade_paletes > 0; }).forEach(function (e) {
            var usados = getPaletesUsados(invAtivo.id, e.endereco);
            if (usados >= e.capacidade_paletes)
                bloqueados++;
        });
    }
    document.getElementById('ek-total').textContent = state().enderecosLista.length.toLocaleString('pt-BR');
    document.getElementById('ek-locais').textContent = setores.length;
    document.getElementById('ek-ativos').textContent = ativos.toLocaleString('pt-BR');
    document.getElementById('ek-inativos').textContent = inativos.toLocaleString('pt-BR');
    document.getElementById('ek-bloqueados').textContent = bloqueados.toLocaleString('pt-BR');
    document.getElementById('ek-bloqueados-sub').textContent = invAtivo ? "Em: ".concat(invAtivo.codigo) : 'Nenhum inv. ativo';
    document.getElementById('ek-cap-zero').textContent = capZero.toLocaleString('pt-BR');
    document.getElementById('nb-enderecos').textContent = state().enderecosLista.length;
    // Badge capas duplicadas
    var _capaDupCount = _agruparCapasDuplicadas('').length;
    var _badgeCap = document.getElementById('nb-capas-dup');
    if (_badgeCap) {
        _badgeCap.textContent = _capaDupCount;
        _badgeCap.style.display = _capaDupCount > 0 ? '' : 'none';
    }
    var fLocal = document.getElementById('end-flocal');
    if (fLocal) {
        var cur_1 = fLocal.value;
        fLocal.innerHTML = '<option value="">Todos os Locais de Estoque</option>' +
            setores.sort().map(function (s) { return "<option value=\"".concat(s, "\" ").concat(s === cur_1 ? 'selected' : '', ">").concat(s, " (").concat(state().enderecosPorSetor[s].length, ")</option>"); }).join('');
    }
    if (renderToo)
        renderEnderecos();
}
function renderEnderecos() {
    var _a, _b, _c, _d;
    var busca = (((_a = document.getElementById('end-busca')) === null || _a === void 0 ? void 0 : _a.value) || '').toLowerCase();
    var fLocal = ((_b = document.getElementById('end-flocal')) === null || _b === void 0 ? void 0 : _b.value) || '';
    var fStatus = ((_c = document.getElementById('end-fstatus')) === null || _c === void 0 ? void 0 : _c.value) || '';
    var fLoja = ((_d = document.getElementById('end-floja')) === null || _d === void 0 ? void 0 : _d.value) || '';
    // Popular select de lojas se ainda não foi
    _popularEndLojaSelect();
    var invAtivo = getInventariosAtivos()[0] || null;
    var lista = state().enderecosLista.map(function (e) {
        var usados = invAtivo ? getPaletesUsados(invAtivo.id, e.endereco) : 0;
        var limiteTingido = e.ativo && e.capacidade_paletes !== null && e.capacidade_paletes > 0 && usados >= e.capacidade_paletes;
        return __assign(__assign({}, e), { _usados: usados, _limiteTingido: limiteTingido });
    });
    if (fLoja === '__sem_loja__')
        lista = lista.filter(function (e) { return !e.loja || e.loja === ''; });
    else if (fLoja)
        lista = lista.filter(function (e) { return e.loja === fLoja; });
    if (fLocal)
        lista = lista.filter(function (e) { return (e.setor || e.nome_local || e.local) === fLocal; });
    if (fStatus === 'ativo')
        lista = lista.filter(function (e) { return e.ativo && !e._limiteTingido; });
    if (fStatus === 'inativo')
        lista = lista.filter(function (e) { return !e.ativo; });
    if (fStatus === 'cap_zero')
        lista = lista.filter(function (e) { return e.capacidade_paletes === 0; });
    if (fStatus === 'bloqueado')
        lista = lista.filter(function (e) { return e._limiteTingido; });
    if (busca)
        lista = lista.filter(function (e) {
            return e.endereco.toLowerCase().includes(busca) ||
                (e.nome_local || '').toLowerCase().includes(busca) ||
                (e.setor || '').toLowerCase().includes(busca) ||
                (e.local || '').toLowerCase().includes(busca) ||
                (e.rua || '').toLowerCase().includes(busca);
        });
    if (!lista.length) {
        document.getElementById('end-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDCCD</div><div class=\"empty-title\">Nenhum endere\u00E7o encontrado</div><div class=\"empty-sub\">Ajuste os filtros ou importe uma planilha de endere\u00E7os</div></div>";
        return;
    }
    function endStatusBadge(e) {
        if (!e.ativo && e.capacidade_paletes === 0)
            return "<span class=\"badge b-gray\">\u26D4 Cap.Zero</span>";
        if (!e.ativo)
            return "<span class=\"badge b-gray\">\u26D4 Inativo</span>";
        if (e._limiteTingido)
            return "<span class=\"badge b-blocked\">\uD83D\uDD12 Limite</span>";
        return "<span class=\"badge b-green\">\u2705 Ativo</span>";
    }
    function capCell(e) {
        var capStr = e.capacidade_paletes !== null ? String(e.capacidade_paletes) : '∞';
        var usadosStr = invAtivo ? String(e._usados) : '0';
        var cor = e._limiteTingido ? 'var(--danger)' : (e.capacidade_paletes === 0 ? 'var(--muted)' : 'var(--text)');
        return "<div style=\"display:flex;align-items:center;gap:6px\">\n      <span class=\"mono\" style=\"font-weight:700;color:".concat(cor, "\">").concat(usadosStr, "/").concat(capStr, "</span>\n      <button onclick=\"editarCapacidade('").concat(e.endereco.replace(/'/g, "\\'"), "')\" class=\"btn btn-ghost btn-sm\" style=\"padding:2px 6px;font-size:.65rem\" title=\"Editar capacidade\">\u270F</button>\n    </div>");
    }
    // Decompose address into labeled parts for display
    var PLABELS = ['Loja', 'Local', 'Área', 'Rua', 'Col', 'Nív', 'Seq'];
    var PCOLORS = ['#dbeafe', '#dcfce7', '#fef9c3', '#fce7f3', '#ede9fe', '#ffedd5', '#e0f2fe'];
    var PTXT = ['#1d4ed8', '#16a34a', '#a16207', '#be185d', '#6d28d9', '#c2410c', '#0369a1'];
    function partsHtml(endereco) {
        var parsed = (window.DTEnderecos && window.DTEnderecos.partes) ? window.DTEnderecos.partes(endereco) : {};
        var parts = [parsed.loja, parsed.local, parsed.area, parsed.rua, parsed.coluna, parsed.nivel, parsed.sequencia];
        return parts.map(function (parte, i) {
            if (!parte)
                return '';
            return '<span style="display:inline-flex;flex-direction:column;align-items:center;background:' + (PCOLORS[i] || '#f1f5f9') + ';border-radius:5px;padding:1px 5px;min-width:28px;margin-right:2px"><span style="font-size:.5rem;font-weight:700;text-transform:uppercase;color:' + (PTXT[i] || '#64748b') + '">' + (PLABELS[i] || 'P' + (i + 1)) + '</span><span style="font-family:var(--mono);font-size:.71rem;font-weight:700;color:' + (PTXT[i] || '#1e293b') + '">' + escHTML(parte) + '</span></span>';
        }).join('');
    }

    function lojaTagHtml(e) {
        if (!e.loja)
            return "<span style=\"font-size:.68rem;color:var(--muted-2,#94a3b8);font-style:italic\">Sem loja</span>";
        return "<span style=\"display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);font-size:.68rem;font-weight:700;color:#92400e;font-family:var(--mono)\">".concat(escHTML(e.loja), "</span>");
    }
    function rowHtml(e) {
        var safe = e.endereco.replace(/'/g, "\\'");
        return "<tr class=\"".concat(!e.ativo ? 'end-inativo' : '', "\">\n      <td class=\"mono\" style=\"font-size:.77rem;white-space:nowrap\">").concat(e.endereco, "</td>\n      <td><div style=\"display:flex;flex-wrap:wrap;gap:2px\">").concat(partsHtml(e.endereco), "</div></td>\n      <td><span class=\"badge b-gray\" style=\"font-size:.65rem\">").concat(e.tipo || 'ARM.', "</span></td>\n      <td>").concat(lojaTagHtml(e), "</td>\n      <td>").concat(capCell(e), "</td>\n      <td>").concat(endStatusBadge(e), "</td>\n      <td style=\"white-space:nowrap\">\n        <div style=\"display:flex;gap:3px\">\n          <button onclick=\"endVincularLoja('").concat(safe, "')\"\n            class=\"btn btn-ghost btn-sm\"\n            style=\"font-size:.7rem;padding:3px 7px\" title=\"Vincular a uma loja\">\uD83C\uDFEA</button>\n          <button onclick=\"toggleAtivacaoEndereco('").concat(safe, "')\"\n            class=\"btn ").concat(e.ativo ? 'btn-ghost' : 'btn-success', " btn-sm\"\n            style=\"font-size:.7rem\">\n            ").concat(e.ativo ? '⛔ Desativar' : '✅ Ativar', "\n          </button>\n          <button onclick=\"excluirEndereco('").concat(safe, "')\"\n            class=\"btn btn-danger btn-sm\" style=\"font-size:.7rem\" title=\"Excluir endere\u00E7o\">\uD83D\uDDD1</button>\n        </div>\n      </td>\n    </tr>");
    }
    // ── Agrupar por LOCAL (parte 1 do endereço ou campo local/setor) ──────────
    // Se há busca ativa ou filtros, mostrar tabela plana (sem accordion)
    var usarGrupos = !busca && !fStatus;
    if (!usarGrupos) {
        // Modo plano — sem agrupamento
        document.getElementById('end-table-wrap').innerHTML = "\n      <div class=\"tbl-wrap\">\n        <table>\n          <thead><tr><th>Endere\u00E7o</th><th>Estrutura</th><th>Tipo</th><th>Loja</th><th>Paletes usados/cap</th><th>Status</th><th>A\u00E7\u00F5es</th></tr></thead>\n          <tbody>".concat(lista.slice(0, 1000).map(rowHtml).join(''), "</tbody>\n        </table>\n      </div>\n      ").concat(lista.length > 1000 ? "<div style=\"text-align:center;padding:8px;font-size:.73rem;color:var(--muted)\">Exibindo 1.000 de ".concat(lista.length.toLocaleString('pt-BR'), " endere\u00E7os \u2014 use os filtros para refinar</div>") : '');
        return;
    }
    // Modo agrupado por Local de Estoque
    var grupos = {};
    lista.forEach(function (e) {
        var grpKey = e.setor || e.nome_local || e.local || 'SEM LOCAL';
        if (!grupos[grpKey])
            grupos[grpKey] = [];
        grupos[grpKey].push(e);
    });
    var gruposHtml = Object.entries(grupos).sort(function (a, b) { return a[0].localeCompare(b[0]); }).map(function (_a) {
        var local = _a[0], ends = _a[1];
        var ativos = ends.filter(function (e) { return e.ativo; }).length;
        var inativos = ends.filter(function (e) { return !e.ativo; }).length;
        var bloqueados = ends.filter(function (e) { return e._limiteTingido; }).length;
        var grpId = 'grp-' + local.replace(/[^a-z0-9]/gi, '_');
        return "<div class=\"loc-group\">\n      <div class=\"loc-group-header\" onclick=\"toggleLocGroup('".concat(grpId, "')\">\n        <span class=\"loc-group-chevron\" id=\"").concat(grpId, "-chev\">\u25B6</span>\n        <span style=\"font-weight:700;font-size:.85rem\">\uD83C\uDFED ").concat(local, "</span>\n        <span style=\"font-size:.73rem;color:var(--muted);margin-left:4px\">").concat(ends.length, " endere\u00E7o(s)</span>\n        <div style=\"margin-left:auto;display:flex;gap:5px\">\n          ").concat(ativos ? "<span class=\"badge b-green\" style=\"font-size:.65rem\">".concat(ativos, " ativos</span>") : '', "\n          ").concat(inativos ? "<span class=\"badge b-gray\" style=\"font-size:.65rem\">\u26D4 ".concat(inativos, " inativos</span>") : '', "\n          ").concat(bloqueados ? "<span class=\"badge b-blocked\" style=\"font-size:.65rem\">\uD83D\uDD12 ".concat(bloqueados, " limite</span>") : '', "\n        </div>\n      </div>\n      <div class=\"loc-group-body\" id=\"").concat(grpId, "\">\n        <div class=\"tbl-wrap\">\n          <table>\n            <thead><tr><th>Endere\u00E7o</th><th>Estrutura</th><th>Tipo</th><th>Loja</th><th>Paletes usados/cap</th><th>Status</th><th>A\u00E7\u00F5es</th></tr></thead>\n            <tbody>").concat(ends.map(rowHtml).join(''), "</tbody>\n          </table>\n        </div>\n      </div>\n    </div>");
    }).join('');
    document.getElementById('end-table-wrap').innerHTML = "\n    <div style=\"padding:10px 14px;background:#f8fafc;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between\">\n      <div style=\"font-size:.73rem;color:var(--muted)\">".concat(lista.length.toLocaleString('pt-BR'), " endere\u00E7os em ").concat(Object.keys(grupos).length, " local(is)</div>\n      <div style=\"display:flex;gap:6px\">\n        <button class=\"btn btn-ghost btn-sm\" style=\"font-size:.7rem\" onclick=\"toggleAllLocGroups(true)\">\u25B6 Recolher todos</button>\n        <button class=\"btn btn-ghost btn-sm\" style=\"font-size:.7rem\" onclick=\"toggleAllLocGroups(false)\">\u25BC Expandir todos</button>\n      </div>\n    </div>\n    <div style=\"padding:10px\">").concat(gruposHtml, "</div>");
}
function toggleLocGroup(grpId) {
    var body = document.getElementById(grpId);
    var chev = document.getElementById(grpId + '-chev');
    if (!body)
        return;
    var isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    if (chev) {
        chev.textContent = isOpen ? '▶' : '▼';
        chev.classList.toggle('open', !isOpen);
    }
}
function toggleAllLocGroups(recolher) {
    document.querySelectorAll('.loc-group-body').forEach(function (body) {
        body.classList.toggle('open', !recolher);
    });
    document.querySelectorAll('.loc-group-chevron').forEach(function (chev) {
        chev.textContent = recolher ? '▶' : '▼';
        chev.classList.toggle('open', !recolher);
    });
}
/**
 * Abre prompt inline para editar a capacidade de paletes de um endereço.
 */
function editarCapacidade(endCod) {
    var end = state().enderecosLista.find(function (e) { return e.endereco === endCod; });
    if (!end)
        return;
    var atual = end.capacidade_paletes !== null ? String(end.capacidade_paletes) : '';
    var nova = prompt("Capacidade de paletes para ".concat(endCod, ":\n(0 = inativo, vazio = sem limite)"), atual);
    if (nova === null)
        return; // cancelou
    if (nova.trim() === '') {
        salvarCapacidade(endCod, null);
        return;
    }
    salvarCapacidade(endCod, nova.trim());
}
// Sobrescreve salvarCapacidade para aceitar null (sem limite)
function salvarCapacidade(endCod, novaCap) {
    var result = dtSalvarCapacidadeEndereco(endCod, novaCap, {
        allowNull: true,
        refresh: function (cap) {
            atualizarEnderecos();
            logSistema('ENDERECO', "Capacidade de ".concat(endCod, " alterada para ").concat(cap !== null && cap !== void 0 ? cap : 'sem limite'), { endCod: endCod, cap: cap });
            showToast("\u2705 Capacidade de ".concat(endCod, ": ").concat(cap !== null ? cap + ' palete(s)' : 'sem limite'), 's');
        }
    });
    if (!result.ok) {
        showToast('Capacidade inválida', 'e');
        return;
    }
}
// ───────────────────────────────────────────────────────────────────
//  18b. EXCLUSÃO DE ENDEREÇOS
// ───────────────────────────────────────────────────────────────────
function excluirEndereco(endCod) {
    showConfirm("Excluir o endere\u00E7o ".concat(escHTML(endCod), "? Esta a\u00E7\u00E3o n\u00E3o pode ser desfeita."), function () { return _excluirEnderecoConfirmado(endCod); }, { title: 'Excluir endereço', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    return;
}
function _excluirEnderecoConfirmado(endCod) {
    var _a;
    var setor = ((_a = state().enderecosLista.find(function (e) { return e.endereco === endCod; })) === null || _a === void 0 ? void 0 : _a.setor) || 'SEM LOCAL';
    var lista = (state().enderecosLista || []).filter(function (e) { return e.endereco !== endCod; });
    var porSetor = __assign({}, (state().enderecosPorSetor || {}));
    if (porSetor[setor]) {
        porSetor[setor] = porSetor[setor].filter(function (e) { return e.endereco !== endCod; });
        if (!porSetor[setor].length)
            delete porSetor[setor];
    }
    window.AnalistaState.batch([
        window.AnalistaActions.replaceSlice('enderecosLista', lista, { source: 'excluirEndereco' }),
        window.AnalistaActions.replaceSlice('enderecosPorSetor', porSetor, { source: 'excluirEndereco' })
    ]);
    storageSave(KEYS.enderecos, lista);
    atualizarEnderecos();
    logSistema('ENDERECO', "Endere\u00E7o ".concat(endCod, " exclu\u00EDdo"), { endCod: endCod });
    showToast("\uD83D\uDDD1 Endere\u00E7o ".concat(endCod, " exclu\u00EDdo"), 's');
}
function excluirTodosEnderecos() {
    var total = state().enderecosLista.length;
    if (!total) {
        showToast('Nenhum endereço para excluir', 'w');
        return;
    }
    showConfirm("Excluir TODOS os ".concat(total.toLocaleString('pt-BR'), " endere\u00E7os cadastrados? Esta a\u00E7\u00E3o n\u00E3o pode ser desfeita."), function () { return _excluirTodosEnderecosConfirmado(); }, { title: 'Excluir todos os endereços', icon: '🗑️', okLabel: 'Excluir tudo', okClass: 'btn-danger' });
    return;
}
function _excluirTodosEnderecosConfirmado() {
    var total = state().enderecosLista.length;
    window.AnalistaState.batch([
        window.AnalistaActions.replaceSlice('enderecosLista', [], { source: 'excluirTodosEnderecos' }),
        window.AnalistaActions.replaceSlice('enderecosPorSetor', {}, { source: 'excluirTodosEnderecos' })
    ]);
    storageSave(KEYS.enderecos, []);
    atualizarEnderecos();
    logSistema('ENDERECO', "Todos os ".concat(total, " endere\u00E7os foram exclu\u00EDdos"), {});
    showToast("\uD83D\uDDD1 ".concat(total.toLocaleString('pt-BR'), " endere\u00E7os exclu\u00EDdos"), 's');
}
// ───────────────────────────────────────────────────────────────────
//  18c. FILTRO POR LOJA — popular select dinamicamente
// ───────────────────────────────────────────────────────────────────
var _endLojaSelectPopulado = false;
function _popularEndLojaSelect() {
    var sel = document.getElementById('end-floja');
    if (!sel)
        return;
    // Recalcular sempre que a lista mudar (flag resetada em atualizarEnderecos)
    var lojas = __spreadArray([], new Set((state().enderecosLista || []).map(function (e) { return (e.loja || '').trim(); }).filter(Boolean)), true).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    // Só re-renderiza se o conteúdo realmente mudou
    var hash = lojas.join('|');
    if (sel.dataset.lojasHash === hash)
        return;
    sel.dataset.lojasHash = hash;
    var cur = sel.value;
    sel.innerHTML =
        '<option value="">Todas as Lojas</option>' +
            '<option value="__sem_loja__">⚠ Sem loja vinculada</option>' +
            lojas.map(function (l) { return "<option value=\"".concat(escHTML(l), "\" ").concat(l === cur ? 'selected' : '', ">").concat(escHTML(l), "</option>"); }).join('');
}
// ───────────────────────────────────────────────────────────────────
//  18d. VINCULAR ENDEREÇO A UMA LOJA
// ───────────────────────────────────────────────────────────────────
function endVincularLoja(endCod) {
    var end = state().enderecosLista.find(function (e) { return e.endereco === endCod; });
    if (!end) {
        showToast('Endereço não encontrado', 'e');
        return;
    }
    var lojas = __spreadArray([], new Set((state().enderecosLista || []).map(function (e) { return (e.loja || '').trim(); }).filter(Boolean)), true).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    var dica = lojas.length
        ? "Lojas cadastradas: ".concat(lojas.join(', '), "\n\n")
        : '';
    var novaLoja = prompt("\uD83C\uDFEA Vincular endere\u00E7o \"".concat(endCod, "\" a qual loja?\n\n") +
        dica +
        "Digite o c\u00F3digo da loja ou deixe em branco para remover o v\u00EDnculo.", end.loja || '');
    if (novaLoja === null)
        return; // usuário cancelou
    end.loja = novaLoja.trim();
    // Invalidar hash do select para forçar re-popular
    var sel = document.getElementById('end-floja');
    if (sel)
        sel.dataset.lojasHash = '';
    storageSave(KEYS.enderecos, state().enderecosLista);
    atualizarEnderecos();
    if (end.loja) {
        showToast("\uD83C\uDFEA Loja \"".concat(escHTML(end.loja), "\" vinculada a ").concat(endCod), 's');
        logSistema('ENDERECO', "Loja de ".concat(endCod, " alterada para \"").concat(end.loja, "\""), { endCod: endCod, loja: end.loja });
    }
    else {
        showToast("\uD83C\uDFEA V\u00EDnculo de loja removido de ".concat(endCod), 's');
        logSistema('ENDERECO', "Loja de ".concat(endCod, " removida"), { endCod: endCod });
    }
}
