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
//  14. RENDERIZAÇÃO — CONTAGENS
// ───────────────────────────────────────────────────────────────────
function renderContagens() {
    var _a, _b, _c, _d, _e, _f, _g;
    var busca = (((_a = document.getElementById('cont-busca')) === null || _a === void 0 ? void 0 : _a.value) || '').toLowerCase();
    var fInv = ((_b = document.getElementById('cont-finv')) === null || _b === void 0 ? void 0 : _b.value) || '';
    var fTipo = ((_c = document.getElementById('cont-ftipo')) === null || _c === void 0 ? void 0 : _c.value) || '';
    var fStatus = ((_d = document.getElementById('cont-fstatus')) === null || _d === void 0 ? void 0 : _d.value) || '';
    var fRua = ((_e = document.getElementById('cont-frua')) === null || _e === void 0 ? void 0 : _e.value) || '';
    var fOp = ((_f = document.getElementById('cont-foperador')) === null || _f === void 0 ? void 0 : _f.value) || '';
    var fPeriodo = ((_g = document.getElementById('cont-fperiodo')) === null || _g === void 0 ? void 0 : _g.value) || '';
    // Popular selects de inventários
    var selInv = document.getElementById('cont-finv');
    if (selInv && !selInv.options.length || (selInv && selInv.options.length === 1)) {
        var cur_1 = selInv.value;
        selInv.innerHTML = '<option value="">Todos os inventários</option>' +
            state().inventarios.map(function (i) { return "<option value=\"".concat(i.id, "\" ").concat(i.id === cur_1 ? 'selected' : '', ">").concat(i.codigo, " \u2014 ").concat(i.nome, "</option>"); }).join('');
        if (cur_1)
            selInv.value = cur_1;
    }
    var dados = state().contagens;
    if (fInv)
        dados = dados.filter(function (c) { return c.inventario_id === fInv; });
    if (fTipo)
        dados = dados.filter(function (c) { return c.tipo_contagem === fTipo; });
    if (fStatus) {
        if (fStatus === 'DIVERGENTE') {
            // c.divergente é o campo real (boolean) — status='DIVERGENTE' nunca é usado
            dados = dados.filter(function (c) { return c.divergente === true; });
        }
        else {
            dados = dados.filter(function (c) { return c.status === fStatus; });
        }
    }
    if (fOp)
        dados = dados.filter(function (c) { return (c.operador || '') === fOp; });
    // Filtro por rua (baseado no endereço do cadastro)
    if (fRua)
        dados = dados.filter(function (c) {
            var info = getEnderecoInfo(c.endereco);
            return ((info === null || info === void 0 ? void 0 : info.rua) || '—') === fRua;
        });
    // Filtro por período
    if (fPeriodo) {
        var hoje_1 = new Date();
        hoje_1.setHours(0, 0, 0, 0);
        var ontem_1 = new Date(hoje_1);
        ontem_1.setDate(ontem_1.getDate() - 1);
        var set7_1 = new Date(hoje_1);
        set7_1.setDate(set7_1.getDate() - 7);
        dados = dados.filter(function (c) {
            var ts = c.timestamp ? new Date(c.timestamp) : null;
            if (!ts)
                return false;
            if (fPeriodo === 'hoje')
                return ts >= hoje_1;
            if (fPeriodo === 'ontem')
                return ts >= ontem_1 && ts < hoje_1;
            if (fPeriodo === '7d')
                return ts >= set7_1;
            return true;
        });
    }
    if (busca)
        dados = dados.filter(function (c) {
            return (c.operador || '').toLowerCase().includes(busca) ||
                (c.endereco || '').toLowerCase().includes(busca) ||
                (c.codigo_produto || '').toLowerCase().includes(busca) ||
                (c.descricao_produto || '').toLowerCase().includes(busca);
        });
    dados = __spreadArray([], dados, true).sort(function (a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });
    // KPIs Contagens
    var _allConts = state().contagens.filter(function (c) { return !c._excluida && c.status !== 'ESTORNADA'; });
    var _setCK = function (id, v) { var el = document.getElementById(id); if (el)
        el.textContent = v; };
    _setCK('ck-total', _allConts.length);
    _setCK('ck-processadas', _allConts.filter(function (c) { return c.status === 'PROCESSADO'; }).length);
    _setCK('ck-divergentes', _allConts.filter(function (c) { return c.status === 'DIVERGENTE'; }).length);
    _setCK('ck-pendentes', _allConts.filter(function (c) { return !c.status || c.status === 'PENDENTE'; }).length);
    _setCK('ck-recontagens', _allConts.filter(function (c) { return c.tipo_contagem === 'RECONTAGEM'; }).length);
    // Atualizar selects dinâmicos (rua e operador)
    var selRua = document.getElementById('cont-frua');
    if (selRua) {
        var ruas = __spreadArray([], new Set(state().contagens.map(function (c) { var i = getEnderecoInfo(c.endereco); return (i === null || i === void 0 ? void 0 : i.rua) || '—'; }).filter(Boolean)), true).sort();
        selRua.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(function (r) { return "<option value=\"".concat(r, "\" ").concat(r === fRua ? 'selected' : '', ">").concat(r, "</option>"); }).join('');
    }
    var selOp = document.getElementById('cont-foperador');
    if (selOp) {
        var ops = __spreadArray([], new Set(state().contagens.map(function (c) { return c.operador; }).filter(Boolean)), true).sort();
        selOp.innerHTML = '<option value="">Todos os operadores</option>' + ops.map(function (o) { return "<option value=\"".concat(o, "\" ").concat(o === fOp ? 'selected' : '', ">").concat(o, "</option>"); }).join('');
    }
    if (!dados.length) {
        document.getElementById('cont-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDCCB</div><div class=\"empty-title\">Nenhuma contagem encontrada</div><div class=\"empty-sub\">As contagens dos coletores aparecem aqui automaticamente</div></div>";
        return;
    }
    document.getElementById('cont-table-wrap').innerHTML = "\n    <div class=\"tbl-wrap\"><table>\n      <thead><tr>\n        <th>Data/Hora</th><th>Operador</th><th>Invent\u00E1rio</th>\n        <th>Endere\u00E7o</th><th>Produto</th><th>Quantidade</th>\n        <th>Tipo</th><th>Status</th><th>A\u00E7\u00F5es</th>\n      </tr></thead>\n      <tbody>\n        ".concat(dados.map(function (c) {
        var _a;
        var inv = getInventarioPorId(c.inventario_id);
        var excluida = c._excluida === true;
        var rowStyle = excluida ? 'opacity:.45;background:#fafafa' : '';
        var end = getEnderecoInfo(c.endereco);
        var capInfo = end && end.capacidade_paletes !== null
            ? "<span style=\"font-size:.65rem;color:var(--muted)\"> \u00B7 cap:".concat(end.capacidade_paletes, "</span>") : '';
        var ruaInfo = (end === null || end === void 0 ? void 0 : end.rua) ? "<div style=\"font-size:.65rem;color:var(--muted)\">Rua: ".concat(end.rua, "</div>") : '';
        return "<tr style=\"".concat(rowStyle, "\">\n            <td class=\"mono\" style=\"white-space:nowrap;font-size:.75rem\">").concat(fmtTs(c.timestamp), "</td>\n            <td>\n              <div style=\"display:flex;align-items:center;gap:6px\">\n                <div class=\"u-avatar\" style=\"width:24px;height:24px;font-size:.65rem;flex-shrink:0\">").concat((c.operador || '?')[0].toUpperCase(), "</div>\n                <span style=\"font-weight:600;font-size:.82rem\">").concat(c.operador || '—', "</span>\n              </div>\n            </td>\n            <td style=\"font-size:.75rem;color:var(--muted)\">").concat((inv === null || inv === void 0 ? void 0 : inv.codigo) || c.inventario_id, "</td>\n            <td class=\"mono\">").concat(c.endereco || '—').concat(capInfo).concat(ruaInfo, "</td>\n            <td>\n              <div style=\"font-weight:600;font-size:.82rem\">").concat(c.codigo_produto || '—', "</div>\n              <div style=\"font-size:.72rem;color:var(--muted)\">").concat(c.descricao_produto || '', "</div>\n            </td>\n            <td class=\"mono\" style=\"font-weight:700;font-size:.9rem\">").concat((c.qtd_caixas != null && c.fator_caixa > 1)
            ? "".concat(c.qtd_caixas, " CX")
            : ((_a = c.quantidade) !== null && _a !== void 0 ? _a : '—'), "</td>\n            <td><span class=\"badge ").concat(c.tipo_contagem === 'RECONTAGEM' ? 'b-purple' : 'b-blue', "\">").concat(c.tipo_contagem || 'PRIMEIRA', "</span></td>\n            <td>\n              ").concat(excluida
            ? "<span class=\"badge b-gray\">\uD83D\uDDD1 Exclu\u00EDda</span>"
            : "<span class=\"badge ".concat(contStatusBadge(c.status), "\">").concat(c.status || 'PENDENTE', "</span>"), "\n            </td>\n            <td>\n              ").concat(excluida
            ? "<button class=\"btn btn-ghost btn-sm\" onclick=\"restaurarContagem('".concat(c.id, "')\" title=\"Restaurar contagem\">\u21A9 Restaurar</button>")
            : "<div style=\"display:flex;gap:4px\">\n                     <button class=\"btn btn-danger btn-sm\" onclick=\"abrirEstorno('".concat(c.id, "')\" title=\"Estornar \u2014 libera endere\u00E7o com registro\">\u21A9 Estornar</button>\n                   </div>"), "\n            </td>\n          </tr>");
    }).join(''), "\n      </tbody>\n    </table></div>");
}
// ───────────────────────────────────────────────────────────────────
//  15. RENDERIZAÇÃO — PENDÊNCIAS
// ───────────────────────────────────────────────────────────────────
function renderPendencias() {
    var _a, _b, _c, _d;
    var selInv = document.getElementById('pend-sel-inv');
    var busca = (((_a = document.getElementById('pend-busca')) === null || _a === void 0 ? void 0 : _a.value) || '').toLowerCase();
    var fStatus = ((_b = document.getElementById('pend-fstatus')) === null || _b === void 0 ? void 0 : _b.value) || '';
    var fLocal = ((_c = document.getElementById('pend-flocal')) === null || _c === void 0 ? void 0 : _c.value) || '';
    var fRua = ((_d = document.getElementById('pend-frua')) === null || _d === void 0 ? void 0 : _d.value) || '';
    var invId = (selInv === null || selInv === void 0 ? void 0 : selInv.value) || '';
    // Preencher select de inventários
    if (selInv) {
        var cur_2 = selInv.value;
        selInv.innerHTML = '<option value="">Selecione uma auditoria...</option>' +
            state().inventarios.filter(function (i) { var _a; return i.status === 'ATIVO' || ((_a = i.enderecos_selecionados) === null || _a === void 0 ? void 0 : _a.length); }).map(function (i) {
                return "<option value=\"".concat(i.id, "\" ").concat(i.id === cur_2 ? 'selected' : '', ">").concat(i.codigo, " \u2014 ").concat(i.nome, "</option>");
            }).join('');
        if (cur_2)
            selInv.value = cur_2;
    }
    if (!invId) {
        document.getElementById('pend-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\u23F3</div><div class=\"empty-title\">Selecione uma auditoria</div></div>";
        ['pk-total', 'pk-contados', 'pk-pendentes', 'pk-pct'].forEach(function (id) { return document.getElementById(id).textContent = '—'; });
        return;
    }
    var inv = getInventarioPorId(invId);
    if (!inv)
        return;
    // Usar state().enderecosLista como base oficial de endereços
    var conts = state().contagens.filter(function (c) { return c.inventario_id === invId && !c._excluida; });
    var endsContadosSet = new Set(conts.filter(function (c) { return !_isVazio(c); }).map(function (c) { return c.endereco; }));
    var endsVaziosConfSet = new Set(conts.filter(function (c) { return _isVazio(c) && c.status !== 'ESTORNADA'; }).map(function (c) { return c.endereco; }));
    // Enriquecer state().enderecosLista com status de contagem
    var lista = state().enderecosLista.map(function (e) {
        var _a;
        var endInfo = e; // já é o objeto completo do ENDDB
        var contado = endsContadosSet.has(e.endereco);
        var vazioConf = endsVaziosConfSet.has(e.endereco);
        var inativo = e.ativo === false;
        var cap = (_a = e.capacidade_paletes) !== null && _a !== void 0 ? _a : null;
        var usados = getPaletesUsados(invId, e.endereco);
        var limiteTingido = !inativo && cap !== null && cap > 0 && usados >= cap;
        var status_pend;
        if (contado)
            status_pend = 'CONTADO';
        else if (vazioConf)
            status_pend = 'VAZIO_CONFIRMADO';
        else if (inativo)
            status_pend = 'INATIVO';
        else if (limiteTingido)
            status_pend = 'LIMITE_ATINGIDO';
        else
            status_pend = 'PENDENTE';
        return __assign(__assign({}, e), { contado: contado, vazioConf: vazioConf, inativo: inativo, limiteTingido: limiteTingido, usados: usados, status_pend: status_pend });
    });
    // Filtro de locais
    var locFlt = document.getElementById('pend-flocal');
    if (locFlt) {
        var locais = __spreadArray([], new Set(lista.map(function (e) { return e.setor || '—'; })), true).sort();
        locFlt.innerHTML = '<option value="">Todos os locais</option>' + locais.map(function (l) { return "<option value=\"".concat(l, "\" ").concat(l === fLocal ? 'selected' : '', ">").concat(l, "</option>"); }).join('');
    }
    // Filtro de ruas
    var ruaFlt = document.getElementById('pend-frua');
    if (ruaFlt) {
        var ruas = __spreadArray([], new Set(lista.map(function (e) { return e.rua || extrairRua(e.endereco) || '—'; })), true).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
        ruaFlt.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(function (r) { return "<option value=\"".concat(r, "\" ").concat(r === fRua ? 'selected' : '', ">Rua ").concat(r, "</option>"); }).join('');
    }
    // Filtros
    var filtrado = lista;
    if (fStatus)
        filtrado = filtrado.filter(function (e) { return e.status_pend === fStatus; });
    if (fLocal)
        filtrado = filtrado.filter(function (e) { return (e.setor || '—') === fLocal; });
    if (fRua)
        filtrado = filtrado.filter(function (e) { return (e.rua || extrairRua(e.endereco) || '—') === fRua; });
    if (busca)
        filtrado = filtrado.filter(function (e) {
            return e.endereco.toLowerCase().includes(busca) ||
                (e.setor || '').toLowerCase().includes(busca) ||
                (e.rua || extrairRua(e.endereco) || '').toLowerCase().includes(busca);
        });
    // KPIs — conferidos = contados + vazios_confirmados (ambos saem das pendências)
    var total = lista.length;
    var contados = lista.filter(function (e) { return e.status_pend === 'CONTADO'; }).length;
    var vaziosConf = lista.filter(function (e) { return e.status_pend === 'VAZIO_CONFIRMADO'; }).length;
    var conferidos = contados + vaziosConf;
    var pendentes = lista.filter(function (e) { return e.status_pend === 'PENDENTE'; }).length;
    var inativos = lista.filter(function (e) { return e.status_pend === 'INATIVO'; }).length;
    var limiteAting = lista.filter(function (e) { return e.status_pend === 'LIMITE_ATINGIDO'; }).length;
    var elegíveis = total - inativos; // base real para % de progresso
    var pct = elegíveis > 0 ? Math.round((conferidos / elegíveis) * 100) : 0;
    document.getElementById('pk-total').textContent = total.toLocaleString('pt-BR');
    document.getElementById('pk-contados').textContent = "".concat(conferidos.toLocaleString('pt-BR')).concat(vaziosConf > 0 ? " (".concat(vaziosConf, " vaz.)") : '');
    document.getElementById('pk-pendentes').textContent = "".concat(pendentes, " + ").concat(limiteAting, "\uD83D\uDD12");
    document.getElementById('pk-pct').textContent = pct + '%';
    if (!filtrado.length) {
        document.getElementById('pend-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\u2705</div><div class=\"empty-title\">Nenhum endere\u00E7o encontrado com esses filtros</div></div>";
    }
    else {
        var statusLabel_1 = {
            CONTADO: { cls: 'b-green', txt: '✓ Contado' },
            VAZIO_CONFIRMADO: { cls: 'b-gray', txt: '🔲 Vazio' },
            PENDENTE: { cls: 'b-yellow', txt: '⏳ Pendente' },
            INATIVO: { cls: 'b-gray', txt: '⛔ Inativo' },
            LIMITE_ATINGIDO: { cls: 'b-blocked', txt: '🔒 Limite' },
        };
        document.getElementById('pend-table-wrap').innerHTML = "\n    ".concat(inativos > 0 ? "<div class=\"alert warn\" style=\"margin:12px 16px 0;border-radius:8px\">\u26D4 ".concat(inativos, " endere\u00E7o(s) inativo(s) n\u00E3o ser\u00E3o contabilizados no progresso.</div>") : '', "\n    ").concat(limiteAting > 0 ? "<div class=\"alert warn\" style=\"margin:8px 16px 0;border-radius:8px\">\uD83D\uDD12 ".concat(limiteAting, " endere\u00E7o(s) com limite de paletes atingido.</div>") : '', "\n    <div class=\"tbl-wrap\"><table>\n      <thead><tr><th>Endere\u00E7o</th><th>Local/\u00C1rea</th><th>Rua</th><th>N\u00EDvel</th><th>Tipo</th><th>Paletes (usados/cap)</th><th>Status</th></tr></thead>\n      <tbody>\n        ").concat(filtrado.map(function (e) {
            var s = statusLabel_1[e.status_pend] || { cls: 'b-gray', txt: e.status_pend };
            var cap = e.capacidade_paletes !== null ? String(e.capacidade_paletes) : '∞';
            return "<tr style=\"".concat(e.inativo || e.limiteTingido ? 'opacity:.6' : '', "\">\n            <td class=\"mono\">").concat(e.endereco, "</td>\n            <td>").concat(e.setor || '—', "</td>\n            <td>").concat(e.rua || '—', "</td>\n            <td>").concat(e.nivel || '—', "</td>\n            <td>").concat(e.tipo || '—', "</td>\n            <td class=\"mono\" style=\"font-weight:700;color:").concat(e.limiteTingido ? 'var(--danger)' : 'inherit', "\">").concat(e.usados, "/").concat(cap, "</td>\n            <td><span class=\"badge ").concat(s.cls, "\">").concat(s.txt, "</span></td>\n          </tr>");
        }).join(''), "\n      </tbody>\n    </table></div>");
    }
    // Update end count display
    var endCountEl = document.getElementById('pend-end-count');
    if (endCountEl)
        endCountEl.textContent = "".concat(pendentes, " endere\u00E7o(s) aguardando de ").concat(total, " total");
    // ── SEÇÃO: Recontagens pendentes ──────────────────────────────────
    var recPend = state().recontagens.filter(function (r) { return r.inventario_id === invId && r.status === 'PENDENTE'; });
    var recSec = document.getElementById('pend-rec-section');
    var pkRecPend = document.getElementById('pk-rec-pend');
    if (pkRecPend)
        pkRecPend.textContent = recPend.length.toLocaleString('pt-BR');
    if (recSec) {
        if (recPend.length > 0) {
            recSec.style.display = '';
            document.getElementById('pend-rec-count').textContent = "".concat(recPend.length, " recontagem(ns) pendente(s)");
            document.getElementById('pend-rec-wrap').innerHTML = "\n        <div class=\"tbl-wrap\"><table>\n          <thead><tr><th>Endere\u00E7o</th><th>Produto</th><th>Qtd Sistema</th><th>1\u00AA Contagem</th><th>Diferen\u00E7a</th><th>A\u00E7\u00E3o</th></tr></thead>\n          <tbody>\n            ".concat(recPend.slice(0, 10).map(function (r) {
                var diff = r.qtd_primeira - r.qtd_esperada;
                return "<tr>\n                <td class=\"mono\">".concat(r.endereco, "</td>\n                <td style=\"font-size:.82rem\">").concat(r.produto, "</td>\n                <td class=\"mono\">").concat(r.qtd_esperada, "</td>\n                <td class=\"mono\" style=\"color:var(--danger);font-weight:700\">").concat(r.qtd_primeira, "</td>\n                <td class=\"mono\" style=\"font-weight:800;color:").concat(diff > 0 ? 'var(--warn)' : 'var(--danger)', "\">\n                  ").concat(diff > 0 ? '+' : '').concat(diff, "\n                </td>\n                <td><button class=\"btn btn-primary btn-sm\" onclick=\"abrirRegistrarRecontagem('").concat(r.id, "')\">\uD83D\uDCDD Registrar</button></td>\n              </tr>");
            }).join(''), "\n          </tbody>\n        </table></div>\n        ").concat(recPend.length > 10 ? "<div style=\"padding:8px 16px;font-size:.75rem;color:var(--muted)\">... e mais ".concat(recPend.length - 10, ". Veja a aba Rodadas.</div>") : '');
        }
        else {
            recSec.style.display = 'none';
        }
    }
    // ── SEÇÃO: Divergências abertas ──────────────────────────────────
    var divAbertas = state().divergencias.filter(function (d) { return d.inventario_id === invId && d.status === 'ABERTA'; });
    var divSec = document.getElementById('pend-div-section');
    var pkDivAbertas = document.getElementById('pk-div-abertas');
    if (pkDivAbertas)
        pkDivAbertas.textContent = divAbertas.length.toLocaleString('pt-BR');
    if (divSec) {
        if (divAbertas.length > 0) {
            divSec.style.display = '';
            document.getElementById('pend-div-count').textContent = "".concat(divAbertas.length, " diverg\u00EAncia(s) aberta(s)");
            document.getElementById('pend-div-wrap').innerHTML = "\n        <div class=\"tbl-wrap\"><table>\n          <thead><tr><th>Endere\u00E7o</th><th>Produto</th><th>Qtd Sistema</th><th>Qtd Contada</th><th>Diferen\u00E7a</th><th>Status</th></tr></thead>\n          <tbody>\n            ".concat(divAbertas.slice(0, 10).map(function (d) {
                var difColor = d.diferenca > 0 ? 'var(--warn)' : 'var(--danger)';
                return "<tr>\n                <td class=\"mono\">".concat(escHTML(d.endereco), "</td>\n                <td style=\"font-size:.82rem\">").concat(escHTML(d.produto), "</td>\n                <td class=\"mono\">").concat(d.qtd_esperada, "</td>\n                <td class=\"mono\" style=\"font-weight:700;color:").concat(d.qtd_contada < d.qtd_esperada ? 'var(--danger)' : 'var(--warn)', "\">").concat(d.qtd_contada, "</td>\n                <td class=\"mono\" style=\"font-weight:800;color:").concat(difColor, "\">").concat(d.diferenca > 0 ? '+' : '').concat(d.diferenca, "</td>\n                <td><span class=\"badge b-red\">Aberta</span></td>\n              </tr>");
            }).join(''), "\n          </tbody>\n        </table></div>\n        ").concat(divAbertas.length > 10 ? "<div style=\"padding:8px 16px;font-size:.75rem;color:var(--muted)\">... e mais ".concat(divAbertas.length - 10, ". Veja a aba Em Conflito.</div>") : '');
        }
        else {
            divSec.style.display = 'none';
        }
    }
}
