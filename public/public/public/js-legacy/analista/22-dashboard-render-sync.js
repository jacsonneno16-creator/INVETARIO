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
//  11. RENDERIZAÇÃO — DASHBOARD
// ───────────────────────────────────────────────────────────────────
function limparFiltrosDash() {
    ['dash-finv', 'dash-frua', 'dash-flocal'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el)
            el.value = '';
    });
    renderDashboard();
}
var _dashCache = null;
function renderDashboard() {
    var _a;
    // ── Preencher selects de filtro ──
    var fInvEl = document.getElementById('dash-finv');
    var fRuaEl = document.getElementById('dash-frua');
    var fLocalEl = document.getElementById('dash-flocal');
    var fInvId = (fInvEl === null || fInvEl === void 0 ? void 0 : fInvEl.value) || '';
    var fRua = (fRuaEl === null || fRuaEl === void 0 ? void 0 : fRuaEl.value) || '';
    var fLocal = (fLocalEl === null || fLocalEl === void 0 ? void 0 : fLocalEl.value) || '';
    // Preencher select de inventários ativos
    if (fInvEl) {
        var cur_1 = fInvEl.value;
        fInvEl.innerHTML = '<option value="">Todos os inventários ativos</option>' +
            getInventariosAtivos().map(function (i) { return "<option value=\"".concat(i.id, "\" ").concat(i.id === cur_1 ? 'selected' : '', ">").concat(i.codigo, " \u2014 ").concat(i.nome, "</option>"); }).join('');
        if (cur_1)
            fInvEl.value = cur_1;
    }
    // Endereços base (ativos)
    var endsBaseAtivos = state().enderecosLista.filter(function (e) { return e.ativo !== false; });
    // Preencher selects de rua e local
    if (fRuaEl) {
        var cur_2 = fRuaEl.value;
        var ruas = __spreadArray([], new Set(endsBaseAtivos.map(function (e) { return e.rua || extrairRua(e.endereco) || 'SEM RUA'; })), true).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
        fRuaEl.innerHTML = '<option value="">Todas as ruas</option>' + ruas.map(function (r) { return "<option value=\"".concat(r, "\" ").concat(r === cur_2 ? 'selected' : '', ">Rua ").concat(r, "</option>"); }).join('');
        if (cur_2)
            fRuaEl.value = cur_2;
    }
    if (fLocalEl) {
        var cur_3 = fLocalEl.value;
        var locais = __spreadArray([], new Set(endsBaseAtivos.map(function (e) { return e.setor || 'SEM LOCAL'; })), true).sort();
        fLocalEl.innerHTML = '<option value="">Todos os locais</option>' + locais.map(function (l) { return "<option value=\"".concat(l, "\" ").concat(l === cur_3 ? 'selected' : '', ">").concat(l, "</option>"); }).join('');
        if (cur_3)
            fLocalEl.value = cur_3;
    }
    // Inventários a considerar (filtrado por select ou todos ativos)
    var ativos = getInventariosAtivos();
    var invsConsiderados = fInvId ? ativos.filter(function (i) { return i.id === fInvId; }) : ativos;
    // Endereços filtrados por rua/local
    var endsFiltered = endsBaseAtivos;
    if (fRua)
        endsFiltered = endsFiltered.filter(function (e) { return (e.rua || extrairRua(e.endereco) || 'SEM RUA') === fRua; });
    if (fLocal)
        endsFiltered = endsFiltered.filter(function (e) { return (e.setor || 'SEM LOCAL') === fLocal; });
    var endsFilteredSet = new Set(endsFiltered.map(function (e) { return e.endereco; }));
    var totalEnds = state().enderecosLista.length;
    var totalConts = state().contagens.filter(function (c) { return !c._excluida; }).length;
    var endContadosTotal = 0;
    var pendentesTotal = 0;
    invsConsiderados.forEach(function (inv) {
        var contsInv = state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida; });
        var contados = new Set(contsInv.filter(function (c) { return !_isVazio(c); }).map(function (c) { return c.endereco; }));
        var vaziosConf = new Set(contsInv.filter(function (c) { return _isVazio(c) && c.status !== 'ESTORNADA'; }).map(function (c) { return c.endereco; }));
        endsFiltered.forEach(function (e) {
            if (contados.has(e.endereco) || vaziosConf.has(e.endereco))
                endContadosTotal++;
            else
                pendentesTotal++;
        });
    });
    var divAbertos = state().divergencias.filter(function (d) {
        if (fInvId && d.inventario_id !== fInvId)
            return false;
        return d.status === 'ABERTA';
    }).length;
    var recPend = state().recontagens.filter(function (r) {
        if (fInvId && r.inventario_id !== fInvId)
            return false;
        return r.status === 'PENDENTE';
    }).length;
    var base4Pct = endsFiltered.length > 0 ? endsFiltered.length : endsBaseAtivos.length;
    var pctGeral = base4Pct > 0 && invsConsiderados.length > 0
        ? Math.round((endContadosTotal / (base4Pct * invsConsiderados.length)) * 100) : 0;
    var contagensConsideradas = state().contagens.filter(function (c) {
        if (c._excluida)
            return false;
        if (fInvId && c.inventario_id !== fInvId)
            return false;
        if (fRua || fLocal) {
            var end = state().enderecosLista.find(function (e) { return e.endereco === c.endereco; }) || {};
            var rua = end.rua || extrairRua(c.endereco) || 'SEM RUA';
            var local = end.setor || 'SEM LOCAL';
            if (fRua && rua !== fRua)
                return false;
            if (fLocal && local !== fLocal)
                return false;
        }
        return true;
    });
    // Operadores ativos
    var opsAtivos = new Set();
    invsConsiderados.forEach(function (inv) {
        state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida && c.operador; }).forEach(function (c) { return opsAtivos.add(c.operador); });
    });
    document.getElementById('kd-inventarios').textContent = invsConsiderados.length;
    document.getElementById('kd-enderecos').textContent = endsFiltered.length.toLocaleString('pt-BR');
    document.getElementById('kd-end-contados').textContent = endContadosTotal.toLocaleString('pt-BR');
    document.getElementById('kd-contagens').textContent = totalConts.toLocaleString('pt-BR');
    document.getElementById('kd-pendencias').textContent = pendentesTotal.toLocaleString('pt-BR');
    document.getElementById('kd-diverg').textContent = divAbertos.toLocaleString('pt-BR');
    document.getElementById('kd-recount').textContent = recPend.toLocaleString('pt-BR');
    document.getElementById('kd-pct-geral').textContent = pctGeral + '%';
    document.getElementById('kd-operadores').textContent = opsAtivos.size;
    _dashCache = {
        filtros: { inventarioId: fInvId, rua: fRua, local: fLocal },
        invsConsiderados: invsConsiderados,
        endsBaseAtivos: endsBaseAtivos,
        endsBase: endsFiltered.length ? endsFiltered : endsBaseAtivos,
        endsFiltered: endsFiltered,
        contagensConsideradas: contagensConsideradas,
        pctGeral: pctGeral,
        endContadosTotal: endContadosTotal,
        pendentesTotal: pendentesTotal,
        divAbertos: divAbertos,
        recPend: recPend,
        opsAtivos: __spreadArray([], opsAtivos, true)
    };
    // Alertas
    var pausados = state().inventarios.filter(function (i) { return i.status === 'PAUSADO'; });
    var alertas = '';
    if (ativos.length === 0) {
        alertas += "<div class=\"alert info\" style=\"margin-bottom:8px\">\uD83D\uDCE6 Nenhum invent\u00E1rio ativo. <a href=\"#\" onclick=\"abrirNovoInventario()\" style=\"color:var(--accent)\">Criar novo invent\u00E1rio</a></div>";
    }
    if (pausados.length > 0) {
        alertas += "<div class=\"alert warn\" style=\"margin-bottom:8px\">\u23F8\uFE0F ".concat(pausados.length, " invent\u00E1rio(s) <strong>PAUSADO(s)</strong>: ").concat(pausados.map(function (i) { return i.nome; }).join(', '), " \u2014 verifique se deve ser retomado.</div>");
    }
    if (divAbertos > 5) {
        alertas += "<div class=\"alert warn\" style=\"margin-bottom:8px\">\u26A0\uFE0F <strong>".concat(divAbertos, "</strong> contagens em conflito aguardando resolu\u00E7\u00E3o. <a href=\"#\" onclick=\"goPage('divergencias',document.getElementById('nav-divergencias'))\" style=\"color:var(--accent)\">Ver conflitos \u2192</a></div>");
    }
    if (recPend > 0) {
        alertas += "<div class=\"alert warn\" style=\"margin-bottom:8px\">\uD83D\uDD04 <strong>".concat(recPend, "</strong> rodada(s) pendente(s) aguardando execu\u00E7\u00E3o. <a href=\"#\" onclick=\"goPage('recontagens',document.getElementById('nav-recontagens'))\" style=\"color:var(--accent)\">Ver rodadas \u2192</a></div>");
    }
    // Alerta: contagens com inventario_id='local' — coletor salvou sem inventário definido
    var contagensLocais = state().contagens.filter(function (c) { return c.inventario_id === 'local' && !c._excluida; });
    if (contagensLocais.length > 0) {
        alertas += "<div class=\"alert warn\" style=\"margin-bottom:8px\">\u26A0\uFE0F <strong>".concat(contagensLocais.length, " contagem(ns)</strong> chegaram sem v\u00EDnculo de invent\u00E1rio (operador contou antes de selecionar o invent\u00E1rio corretamente). <a href=\"#\" onclick=\"goPage('contagens',document.getElementById('nav-contagens'))\" style=\"color:var(--accent)\">Ver contagens \u2192</a></div>");
    }
    if (pctGeral >= 100 && invsConsiderados.length > 0) {
        alertas += "<div class=\"alert info\" style=\"margin-bottom:8px\">\uD83C\uDF89 Todos os endere\u00E7os foram contados! Verifique as diverg\u00EAncias e feche o invent\u00E1rio.</div>";
    }
    if (fInvId || fRua || fLocal) {
        var tags = [fInvId && "invent\u00E1rio: ".concat(((_a = invsConsiderados[0]) === null || _a === void 0 ? void 0 : _a.nome) || fInvId), fRua && "rua: ".concat(fRua), fLocal && "local: ".concat(fLocal)].filter(Boolean).join(' · ');
        alertas = "<div class=\"alert info\" style=\"margin-bottom:8px\">\uD83D\uDD0E Filtros ativos: <strong>".concat(tags, "</strong> \u2014 KPIs calculados para a sele\u00E7\u00E3o.</div>") + alertas;
    }
    document.getElementById('dash-alert-wrap').innerHTML = alertas;
    // Barras de progresso
    var endsBase = endsFiltered.length ? endsFiltered : endsBaseAtivos;
    var progressHtml = '';
    invsConsiderados.slice(0, 3).forEach(function (inv) {
        var contsInv2 = state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida; });
        var contados2 = new Set(contsInv2.filter(function (c) { return !_isVazio(c); }).map(function (c) { return c.endereco; }));
        var vaziosConf2 = new Set(contsInv2.filter(function (c) { return _isVazio(c) && c.status !== 'ESTORNADA'; }).map(function (c) { return c.endereco; }));
        var conferidos2 = function (cod) { return contados2.has(cod) || vaziosConf2.has(cod); };
        var conferidosAtivosInv = endsBase.filter(function (e) { return conferidos2(e.endereco); }).length;
        var pct = endsBase.length > 0 ? Math.round((conferidosAtivosInv / endsBase.length) * 100) : 0;
        var color = pct >= 80 ? 'green' : pct >= 50 ? 'blue' : 'yellow';
        progressHtml += "\n      <div style=\"padding:14px 20px;border-bottom:1px solid var(--border)\">\n        <div style=\"display:flex;justify-content:space-between;margin-bottom:8px\">\n          <span style=\"font-weight:600;font-size:.83rem\">".concat(escHTML(inv.nome), "</span>\n          <span class=\"badge ").concat(statusBadge(inv.status), "\">").concat(inv.status, "</span>\n        </div>\n        <div class=\"prog-wrap\">\n          <div class=\"prog\"><div class=\"prog-fill ").concat(color, "\" style=\"width:").concat(pct, "%\"></div></div>\n          <span class=\"prog-label\">").concat(pct, "%</span>\n        </div>\n        <div style=\"font-size:.7rem;color:var(--muted);margin-top:4px\">").concat(conferidosAtivosInv, " de ").concat(endsBase.length, " endere\u00E7os").concat(fRua || fLocal ? ' (filtrados)' : '', " conferidos</div>\n      </div>");
    });
    document.getElementById('dash-progress-wrap').innerHTML = progressHtml ? "<div class=\"tc\">".concat(progressHtml, "</div>") : '';
    // ── Progresso por Rua e Local ──
    _renderDashboardCharts();
    _renderDashRuas(endsBase, invsConsiderados);
    _renderDashLocais(endsBase, invsConsiderados);
    // Tabela resumo
    if (!state().inventarios.length) {
        document.getElementById('dash-inv-table').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDCE6</div><div class=\"empty-title\">Nenhum invent\u00E1rio</div><div class=\"empty-sub\">Clique em + Novo Invent\u00E1rio</div></div>";
        return;
    }
    document.getElementById('dash-inv-table').innerHTML = "\n    <div class=\"tbl-wrap\">\n      <table>\n        <thead><tr><th>C\u00F3digo</th><th>Nome</th><th>Data</th><th>Status</th><th>Progresso</th><th>A\u00E7\u00F5es</th></tr></thead>\n        <tbody>\n          ".concat(state().inventarios.slice(0, 8).map(function (inv) {
        var contsInv3 = state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida; });
        var contadosSet3 = new Set(contsInv3.filter(function (c) { return !_isVazio(c); }).map(function (c) { return c.endereco; }));
        var vaziosConfSet3 = new Set(contsInv3.filter(function (c) { return _isVazio(c) && c.status !== 'ESTORNADA'; }).map(function (c) { return c.endereco; }));
        var conferidos3 = new Set(__spreadArray(__spreadArray([], contadosSet3, true), vaziosConfSet3, true));
        var endsAtivosTotal = state().enderecosLista.filter(function (e) { return e.ativo !== false; }).length;
        var pct = endsAtivosTotal > 0 ? Math.round((conferidos3.size / endsAtivosTotal) * 100) : 0;
        return "<tr>\n              <td class=\"mono\">".concat(inv.codigo, "</td>\n              <td style=\"font-weight:600\">").concat(escHTML(inv.nome), "</td>\n              <td class=\"mono\" style=\"color:var(--muted)\">").concat(fmtData(inv.data_inicio), "</td>\n              <td><span class=\"badge ").concat(statusBadge(inv.status), "\">").concat(inv.status, "</span></td>\n              <td>\n                <div class=\"prog-wrap\">\n                  <div class=\"prog\"><div class=\"prog-fill ").concat(pct >= 80 ? 'green' : pct >= 50 ? 'blue' : 'yellow', "\" style=\"width:").concat(pct, "%\"></div></div>\n                  <span class=\"prog-label\">").concat(pct, "%</span>\n                </div>\n              </td>\n              <td><button class=\"btn btn-ghost btn-sm\" onclick=\"verBase('").concat(inv.id, "')\">Ver Base</button></td>\n            </tr>");
    }).join(''), "\n        </tbody>\n      </table>\n    </div>");
}
// ───────────────────────────────────────────────────────────────────
//  11b. DASHBOARD — Progresso por Rua e por Local
// ───────────────────────────────────────────────────────────────────
function _renderDashRuas(endsBase, invsConsiderados) {
    var el = document.getElementById('dash-ruas-wrap');
    if (!el)
        return;
    if (!endsBase.length) {
        el.innerHTML = "<div class=\"empty\" style=\"padding:16px\"><div class=\"empty-icon\">\uD83D\uDEE3\uFE0F</div><div class=\"empty-title\">Sem endere\u00E7os</div></div>";
        return;
    }
    var invs = invsConsiderados || getInventariosAtivos();
    // Mapear contagens e vazios dos inventários considerados
    var contadosSet = new Set();
    var vaziosConfSet = new Set();
    invs.forEach(function (inv) {
        state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida; }).forEach(function (c) {
            if (_isVazio(c) && c.status !== 'ESTORNADA')
                vaziosConfSet.add(c.endereco);
            else
                contadosSet.add(c.endereco);
        });
    });
    // Agrupar por rua
    var ruas = {};
    endsBase.forEach(function (e) {
        var rua = e.rua || extrairRua(e.endereco) || 'SEM RUA';
        if (!ruas[rua])
            ruas[rua] = { total: 0, contados: 0 };
        ruas[rua].total++;
        if (contadosSet.has(e.endereco) || vaziosConfSet.has(e.endereco))
            ruas[rua].contados++;
    });
    var sorted = Object.entries(ruas).sort(function (a, b) {
        var pctA = a[1].total > 0 ? a[1].contados / a[1].total : 0;
        var pctB = b[1].total > 0 ? b[1].contados / b[1].total : 0;
        return pctA - pctB; // menor progresso primeiro
    });
    if (!sorted.length) {
        el.innerHTML = "<div class=\"empty\" style=\"padding:16px\"><div class=\"empty-icon\">\uD83D\uDEE3\uFE0F</div><div class=\"empty-title\">Sem ruas mapeadas</div></div>";
        return;
    }
    el.innerHTML = sorted.map(function (_a) {
        var rua = _a[0], d = _a[1];
        var pct = d.total > 0 ? Math.round((d.contados / d.total) * 100) : 0;
        var color = pct >= 80 ? 'green' : pct >= 40 ? 'orange' : 'red';
        return "<div style=\"margin-bottom:10px\">\n      <div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:4px\">\n        <span style=\"font-size:.78rem;font-weight:600\">".concat(rua, "</span>\n        <span style=\"font-size:.7rem;color:var(--muted);font-family:var(--mono)\">").concat(d.contados, "/").concat(d.total, " \u00B7 ").concat(pct, "%</span>\n      </div>\n      <div style=\"display:flex;align-items:center;gap:8px\">\n        <div class=\"mini-prog\"><div class=\"mini-prog-fill ").concat(color, "\" style=\"width:").concat(pct, "%\"></div></div>\n      </div>\n    </div>");
    }).join('');
}
function _renderDashLocais(endsBase, invsConsiderados) {
    var el = document.getElementById('dash-locais-wrap');
    if (!el)
        return;
    if (!endsBase.length) {
        el.innerHTML = "<div class=\"empty\" style=\"padding:16px\"><div class=\"empty-icon\">\uD83C\uDFED</div><div class=\"empty-title\">Sem endere\u00E7os</div></div>";
        return;
    }
    var invs = invsConsiderados || getInventariosAtivos();
    var contadosSet = new Set();
    var vaziosConfSet = new Set();
    invs.forEach(function (inv) {
        state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida; }).forEach(function (c) {
            if (_isVazio(c) && c.status !== 'ESTORNADA')
                vaziosConfSet.add(c.endereco);
            else
                contadosSet.add(c.endereco);
        });
    });
    var locais = {};
    endsBase.forEach(function (e) {
        var local = e.setor || 'SEM LOCAL';
        if (!locais[local])
            locais[local] = { total: 0, contados: 0 };
        locais[local].total++;
        if (contadosSet.has(e.endereco) || vaziosConfSet.has(e.endereco))
            locais[local].contados++;
    });
    var sorted = Object.entries(locais).sort(function (a, b) {
        var pctA = a[1].total > 0 ? a[1].contados / a[1].total : 0;
        var pctB = b[1].total > 0 ? b[1].contados / b[1].total : 0;
        return pctA - pctB;
    });
    if (!sorted.length) {
        el.innerHTML = "<div class=\"empty\" style=\"padding:16px\"><div class=\"empty-icon\">\uD83C\uDFED</div><div class=\"empty-title\">Sem locais mapeados</div></div>";
        return;
    }
    el.innerHTML = sorted.map(function (_a) {
        var local = _a[0], d = _a[1];
        var pct = d.total > 0 ? Math.round((d.contados / d.total) * 100) : 0;
        var pend = d.total - d.contados;
        var color = pct >= 80 ? 'green' : pct >= 40 ? 'orange' : 'red';
        return "<div style=\"margin-bottom:10px\">\n      <div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:4px\">\n        <span style=\"font-size:.78rem;font-weight:600\">".concat(local, "</span>\n        <span style=\"font-size:.7rem;color:var(--muted);font-family:var(--mono)\">").concat(d.contados, "/").concat(d.total, " \u00B7 ").concat(pct, "%</span>\n      </div>\n      <div style=\"display:flex;align-items:center;gap:8px;margin-bottom:2px\">\n        <div class=\"mini-prog\"><div class=\"mini-prog-fill ").concat(color, "\" style=\"width:").concat(pct, "%\"></div></div>\n      </div>\n      <div style=\"font-size:.65rem;color:var(--muted)\">").concat(pend > 0 ? "".concat(pend, " pendentes") : '✅ Concluído', "</div>\n    </div>");
    }).join('');
}
function _dashSafe(str) {
    return escHTML(String(str !== null && str !== void 0 ? str : ''));
}
function _dashBuildBreakdown(endsBase, invsConsiderados, keyFn) {
    var invs = invsConsiderados || getInventariosAtivos();
    var contadosSet = new Set();
    var vaziosConfSet = new Set();
    invs.forEach(function (inv) {
        state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida; }).forEach(function (c) {
            if (_isVazio(c) && c.status !== 'ESTORNADA')
                vaziosConfSet.add(c.endereco);
            else
                contadosSet.add(c.endereco);
        });
    });
    var groups = {};
    endsBase.forEach(function (e) {
        var key = keyFn(e) || 'SEM DADO';
        if (!groups[key])
            groups[key] = { total: 0, contados: 0 };
        groups[key].total++;
        if (contadosSet.has(e.endereco) || vaziosConfSet.has(e.endereco))
            groups[key].contados++;
    });
    return Object.entries(groups).map(function (_a) {
        var label = _a[0], d = _a[1];
        var pendentes = Math.max(0, d.total - d.contados);
        var pct = d.total > 0 ? Math.round((d.contados / d.total) * 100) : 0;
        return { label: label, total: d.total, contados: d.contados, pendentes: pendentes, pct: pct };
    });
}
function _dashTopOperadores(contagensConsideradas) {
    var mapa = {};
    (contagensConsideradas || []).forEach(function (c) {
        var op = c.operador || c.usuario || 'SEM OPERADOR';
        if (!mapa[op])
            mapa[op] = { operador: op, total: 0, enderecos: new Set(), divergencias: 0 };
        mapa[op].total++;
        if (c.endereco)
            mapa[op].enderecos.add(c.endereco);
        if (c.status === 'CONFLITO' || c.em_conflito)
            mapa[op].divergencias++;
    });
    return Object.values(mapa)
        .map(function (x) { return (__assign(__assign({}, x), { enderecos: x.enderecos.size })); })
        .sort(function (a, b) { return b.total - a.total; })
        .slice(0, 8);
}
function _dashHourlySeries(contagensConsideradas) {
    var buckets = Array.from({ length: 24 }, function (_, h) { return ({ hora: h, total: 0 }); });
    (contagensConsideradas || []).forEach(function (c) {
        var raw = c.criado_em || c.created_at || c.data_hora || c.ts || c.updated_at;
        if (!raw)
            return;
        var d = null;
        if (raw && typeof raw.toDate === 'function')
            d = raw.toDate();
        else
            d = new Date(raw);
        if (!(d instanceof Date) || isNaN(d))
            return;
        buckets[d.getHours()].total++;
    });
    return buckets;
}
function _dashMiniBars(items, opts) {
    if (opts === void 0) { opts = {}; }
    var clickable = !!opts.clickable;
    if (!items.length)
        return "<div class=\"empty\" style=\"padding:20px\"><div class=\"empty-icon\">\uD83D\uDCCA</div><div class=\"empty-title\">Sem dados para o gr\u00E1fico</div></div>";
    var max = Math.max.apply(Math, __spreadArray(__spreadArray([], items.map(function (i) { return i.value; }), false), [1], false));
    return items.map(function (item) {
        var pct = Math.max(4, Math.round((item.value / max) * 100));
        var buttonOpen = clickable ? "<button class=\"btn btn-ghost btn-sm\" style=\"width:100%;justify-content:flex-start;padding:10px 12px;border-radius:12px\" onclick=\"".concat(item.onclick, "\">") : "<div style=\"padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2)\">";
        var buttonClose = clickable ? "</button>" : "</div>";
        return "".concat(buttonOpen, "\n      <div style=\"display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px\">\n        <span style=\"font-size:.76rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">").concat(_dashSafe(item.label), "</span>\n        <span style=\"font-size:.68rem;color:var(--muted);font-family:var(--mono)\">").concat(item.valueLabel || item.value, "</span>\n      </div>\n      <div style=\"height:10px;background:var(--border);border-radius:999px;overflow:hidden\">\n        <div style=\"height:100%;width:").concat(pct, "%;background:").concat(item.color || 'linear-gradient(90deg,var(--orange),var(--orange-h))', ";border-radius:999px\"></div>\n      </div>\n      ").concat(item.sub ? "<div style=\"margin-top:6px;font-size:.67rem;color:var(--muted)\">".concat(_dashSafe(item.sub), "</div>") : '', "\n    ").concat(buttonClose);
    }).join('');
}
function _renderDashboardCharts() {
    var wrap = document.getElementById('dash-charts-wrap');
    if (!wrap)
        return;
    var dc = _dashCache;
    if (!dc || !dc.endsBase || !dc.invsConsiderados) {
        wrap.innerHTML = '';
        return;
    }
    var ruas = _dashBuildBreakdown(dc.endsBase, dc.invsConsiderados, function (e) { return e.rua || extrairRua(e.endereco) || 'SEM RUA'; })
        .sort(function (a, b) { return b.pendentes - a.pendentes || a.pct - b.pct; })
        .slice(0, 6);
    var locais = _dashBuildBreakdown(dc.endsBase, dc.invsConsiderados, function (e) { return e.setor || 'SEM LOCAL'; })
        .sort(function (a, b) { return b.pendentes - a.pendentes || a.pct - b.pct; })
        .slice(0, 6);
    var operadores = _dashTopOperadores(dc.contagensConsideradas);
    var serieHoras = _dashHourlySeries(dc.contagensConsideradas);
    var totalHoraMax = Math.max.apply(Math, __spreadArray(__spreadArray([], serieHoras.map(function (x) { return x.total; }), false), [1], false));
    var pct = Math.max(0, Math.min(100, dc.pctGeral || 0));
    var pendPct = 100 - pct;
    var ruasHtml = _dashMiniBars(ruas.map(function (r) { return ({
        label: "Rua ".concat(r.label),
        value: r.pendentes,
        valueLabel: "".concat(r.pendentes, " pend."),
        sub: "".concat(r.contados, "/").concat(r.total, " conferidos \u00B7 ").concat(r.pct, "%"),
        color: 'linear-gradient(90deg,#ef4444,#f97316)',
        onclick: "dashApplyRuaFilter(".concat(JSON.stringify(r.label), ")")
    }); }), { clickable: true });
    var locaisHtml = _dashMiniBars(locais.map(function (l) { return ({
        label: l.label,
        value: l.pendentes,
        valueLabel: "".concat(l.pendentes, " pend."),
        sub: "".concat(l.contados, "/").concat(l.total, " conferidos \u00B7 ").concat(l.pct, "%"),
        color: 'linear-gradient(90deg,#0ea5e9,#22c55e)',
        onclick: "dashApplyLocalFilter(".concat(JSON.stringify(l.label), ")")
    }); }), { clickable: true });
    var operadoresHtml = operadores.length ? operadores.map(function (op, idx) { return "\n    <button class=\"btn btn-ghost btn-sm\" style=\"width:100%;justify-content:flex-start;padding:10px 12px;border-radius:12px\" onclick=\"dashApplyOperadorFilter(".concat(JSON.stringify(op.operador), ")\">\n      <div style=\"display:flex;align-items:center;gap:10px;width:100%\">\n        <div style=\"width:28px;height:28px;border-radius:10px;background:").concat(idx === 0 ? 'var(--orange-soft)' : 'var(--surface-3)', ";display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:.72rem;font-weight:700;color:").concat(idx === 0 ? 'var(--orange)' : 'var(--muted)', "\">").concat(idx + 1, "</div>\n        <div style=\"flex:1;min-width:0;text-align:left\">\n          <div style=\"font-size:.78rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">").concat(_dashSafe(op.operador), "</div>\n          <div style=\"font-size:.67rem;color:var(--muted)\">").concat(op.enderecos, " end. \u00FAnicos \u00B7 ").concat(op.divergencias, " conflito(s)</div>\n        </div>\n        <div style=\"font-family:var(--mono);font-size:.82rem;font-weight:700;color:var(--green-mid)\">").concat(op.total, "</div>\n      </div>\n    </button>\n  "); }).join('') : "<div class=\"empty\" style=\"padding:20px\"><div class=\"empty-icon\">\uD83D\uDC65</div><div class=\"empty-title\">Sem operadores no filtro</div></div>";
    var hourBars = serieHoras.map(function (b) {
        var h = Math.max(8, Math.round((b.total / totalHoraMax) * 100));
        var active = b.total > 0;
        return "<div title=\"".concat(String(b.hora).padStart(2, '0'), ":00 \u00B7 ").concat(b.total, " contagem(ns)\" style=\"display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0\">\n      <div style=\"height:110px;width:100%;display:flex;align-items:flex-end;justify-content:center\">\n        <div style=\"width:100%;max-width:22px;height:").concat(active ? h : 8, "%;border-radius:8px 8px 4px 4px;background:").concat(active ? 'linear-gradient(180deg,var(--orange-h),var(--orange))' : 'var(--border)', ";transition:height .25s\"></div>\n      </div>\n      <div style=\"font-size:.61rem;font-family:var(--mono);color:").concat(active ? 'var(--text-2)' : 'var(--muted-2)', "\">").concat(String(b.hora).padStart(2, '0'), "</div>\n    </div>");
    }).join('');
    wrap.innerHTML = "\n    <div style=\"display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:16px;margin-bottom:4px\">\n      <div class=\"tc\" style=\"overflow:hidden\">\n        <div class=\"tc-header\"><div><div class=\"tc-title\">\uD83D\uDCC8 Conclus\u00E3o do filtro</div><div class=\"sec-sub\">Clique nas barras ao lado para refinar a an\u00E1lise</div></div></div>\n        <div style=\"padding:18px 20px;display:flex;gap:20px;align-items:center;flex-wrap:wrap\">\n          <div style=\"width:180px;height:180px;border-radius:50%;background:conic-gradient(var(--green-light) 0 ".concat(pct, "%, var(--border) ").concat(pct, "% 100%);display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0;margin:auto\">\n            <div style=\"width:118px;height:118px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;flex-direction:column;box-shadow:inset 0 0 0 1px var(--border)\">\n              <div style=\"font-family:var(--mono);font-size:1.8rem;font-weight:800;color:var(--green-mid)\">").concat(pct, "%</div>\n              <div style=\"font-size:.64rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em\">conclu\u00EDdo</div>\n            </div>\n          </div>\n          <div style=\"flex:1;min-width:220px;display:grid;grid-template-columns:1fr 1fr;gap:10px\">\n            <div style=\"padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)\"><div style=\"font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)\">Conferidos</div><div style=\"font-family:var(--mono);font-size:1.2rem;font-weight:800;color:var(--green-mid)\">").concat(dc.endContadosTotal.toLocaleString('pt-BR'), "</div></div>\n            <div style=\"padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)\"><div style=\"font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)\">Pendentes</div><div style=\"font-family:var(--mono);font-size:1.2rem;font-weight:800;color:var(--danger)\">").concat(dc.pendentesTotal.toLocaleString('pt-BR'), "</div></div>\n            <div style=\"padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)\"><div style=\"font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)\">Conflitos</div><div style=\"font-family:var(--mono);font-size:1.2rem;font-weight:800;color:var(--warn)\">").concat(dc.divAbertos.toLocaleString('pt-BR'), "</div></div>\n            <div style=\"padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border)\"><div style=\"font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)\">Recontagem</div><div style=\"font-family:var(--mono);font-size:1.2rem;font-weight:800;color:var(--orange)\">").concat(dc.recPend.toLocaleString('pt-BR'), "</div></div>\n          </div>\n        </div>\n      </div>\n      <div class=\"tc\">\n        <div class=\"tc-header\"><div><div class=\"tc-title\">\uD83D\uDEE3\uFE0F Ruas com mais pend\u00EAncias</div><div class=\"sec-sub\">Clique para filtrar a rua</div></div></div>\n        <div style=\"padding:14px;display:flex;flex-direction:column;gap:8px\">").concat(ruasHtml, "</div>\n      </div>\n      <div class=\"tc\">\n        <div class=\"tc-header\"><div><div class=\"tc-title\">\uD83C\uDFED Locais com mais pend\u00EAncias</div><div class=\"sec-sub\">Clique para filtrar o local</div></div></div>\n        <div style=\"padding:14px;display:flex;flex-direction:column;gap:8px\">").concat(locaisHtml, "</div>\n      </div>\n    </div>\n    <div style=\"display:grid;grid-template-columns:1.2fr .8fr;gap:16px;margin-bottom:16px\">\n      <div class=\"tc\">\n        <div class=\"tc-header\"><div><div class=\"tc-title\">\u23F1\uFE0F Contagens por hora</div><div class=\"sec-sub\">Distribui\u00E7\u00E3o operacional do filtro atual</div></div></div>\n        <div style=\"padding:18px 16px 12px\">\n          <div style=\"display:flex;gap:8px;align-items:flex-end\">").concat(hourBars, "</div>\n        </div>\n      </div>\n      <div class=\"tc\">\n        <div class=\"tc-header\"><div><div class=\"tc-title\">\uD83D\uDC65 Ranking de operadores</div><div class=\"sec-sub\">Clique para abrir as contagens j\u00E1 filtradas por operador</div></div></div>\n        <div style=\"padding:14px;display:flex;flex-direction:column;gap:8px\">").concat(operadoresHtml, "</div>\n      </div>\n    </div>");
}
function dashApplyRuaFilter(rua) {
    var el = document.getElementById('dash-frua');
    if (!el)
        return;
    el.value = rua || '';
    renderDashboard();
}
function dashApplyLocalFilter(local) {
    var el = document.getElementById('dash-flocal');
    if (!el)
        return;
    el.value = local || '';
    renderDashboard();
}
function dashApplyOperadorFilter(operador) {
    goPage('contagens', document.getElementById('nav-contagens'));
    var campo = document.getElementById('cont-busca');
    var selOp = document.getElementById('cont-foperador');
    if (selOp)
        selOp.value = operador || '';
    if (campo) {
        campo.value = operador || '';
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    }
    else if (typeof renderContagens === 'function') {
        renderContagens();
    }
}
// ───────────────────────────────────────────────────────────────────
