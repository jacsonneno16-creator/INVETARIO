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
//  12. RENDERIZAÇÃO — INVENTÁRIOS
// ───────────────────────────────────────────────────────────────────
function filtrarInv(v) { window.AnalistaState.set('ui.filtroInventarioTexto', v.toLowerCase(), { source: 'ui-filter' }); renderInvTable(); }
function filtrarInvStatus(v) { window.AnalistaState.set('ui.filtroInventarioStatus', v, { source: 'ui-filter' }); renderInvTable(); }
function renderInvTable() {
    var dados = state().inventarios;
    if (state().ui.filtroInventarioTexto)
        dados = dados.filter(function (i) { return i.nome.toLowerCase().includes(state().ui.filtroInventarioTexto) || i.codigo.toLowerCase().includes(state().ui.filtroInventarioTexto); });
    if (state().ui.filtroInventarioStatus)
        dados = dados.filter(function (i) { return i.status === state().ui.filtroInventarioStatus; });
    if (!dados.length) {
        document.getElementById('inv-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDCE6</div><div class=\"empty-title\">Nenhum invent\u00E1rio encontrado</div><div class=\"empty-sub\">Clique em + Novo Invent\u00E1rio para come\u00E7ar</div></div>";
        return;
    }
    document.getElementById('inv-table-wrap').innerHTML = "\n    <div class=\"tbl-wrap\">\n      <table>\n        <thead><tr>\n          <th>C\u00F3digo</th><th>Nome</th><th>Data In\u00EDcio</th><th>Respons\u00E1vel</th>\n          <th>Status</th><th>Registros</th><th>Endere\u00E7os</th><th>Progresso</th><th>A\u00E7\u00F5es</th>\n        </tr></thead>\n        <tbody>\n          ".concat(dados.map(function (inv) {
        var contados = __spreadArray([], new Set(state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida; }).map(function (c) { return c.endereco; })), true);
        var endsAtivosTotal = state().enderecosLista.filter(function (e) { return e.ativo !== false; }).length;
        var pct = endsAtivosTotal > 0 ? Math.round((contados.length / endsAtivosTotal) * 100) : 0;
        return "<tr>\n              <td class=\"mono\">".concat(inv.codigo, "</td>\n              <td style=\"font-weight:600\">").concat(escapeHTML(inv.nome)).concat(inv.setor ? "<br><span style=\"font-size:.7rem;color:var(--muted)\">".concat(escapeHTML(inv.setor), "</span>") : '').concat(inv.loja_principal ? "<br><span style=\"font-size:.7rem;color:var(--muted)\">Loja: ".concat(escapeHTML(inv.loja_principal)).concat((inv.lojas_espelho || []).length ? " \u00B7 Espelho: ".concat(escapeHTML((inv.lojas_espelho || []).join(', '))) : '', "</span>") : '', "</td>\n              <td class=\"mono\" style=\"color:var(--muted)\">").concat(fmtData(inv.data_inicio), "</td>\n              <td style=\"font-size:.8rem\">").concat(inv.responsavel || '—', "</td>\n              <td><span class=\"badge ").concat(statusBadge(inv.status), "\">").concat(inv.status, "</span></td>\n              <td class=\"mono\">").concat((inv.total_registros || 0).toLocaleString('pt-BR'), "</td>\n              <td class=\"mono\">").concat(endsAtivosTotal.toLocaleString('pt-BR'), "</td>\n              <td style=\"min-width:120px\">\n                <div class=\"prog-wrap\">\n                  <div class=\"prog\"><div class=\"prog-fill ").concat(pct >= 80 ? 'green' : pct >= 50 ? 'blue' : 'yellow', "\" style=\"width:").concat(pct, "%\"></div></div>\n                  <span class=\"prog-label\">").concat(pct, "%</span>\n                </div>\n              </td>\n              <td>\n                <div style=\"display:flex;gap:4px;flex-wrap:wrap\">\n                  <button class=\"btn btn-ghost btn-sm\" onclick=\"verBase('").concat(inv.id, "')\">\uD83D\uDCC2 Base</button>\n                  <button class=\"btn btn-ghost btn-sm\" onclick=\"toggleInvVisibilidade('").concat(inv.id, "')\" title=\"").concat(inv.oculto_coletor ? 'Inventário oculto no coletor — clique para mostrar' : 'Inventário visível no coletor — clique para ocultar', "\" style=\"").concat(inv.oculto_coletor ? 'color:var(--danger);border-color:rgba(217,32,32,.3)' : '', "\">\n                    ").concat(inv.oculto_coletor ? '🙈 Oculto' : '👁 Visível', "\n                  </button>\n                  ").concat(inv.status === 'ATIVO' ? "\n                    <button class=\"btn btn-sm\" onclick=\"abrirReimportarBase('".concat(inv.id, "')\" title=\"Reimportar o CSV da base e publicar para os coletores\" style=\"background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.3);padding:4px 8px;font-size:.72rem\">\uD83D\uDCC2 Reimportar Base</button>\n                    <button class=\"btn btn-sm\" onclick=\"republicarBaseInventario('").concat(inv.id, "')\" title=\"Publicar base no Firebase para que os coletores possam baixar\" style=\"background:rgba(59,130,246,.12);color:#60a5fa;border:1px solid rgba(59,130,246,.3);padding:4px 8px;font-size:.72rem\">\uD83D\uDD25 Publicar Base</button>\n                    <button class=\"btn btn-ghost btn-sm\" onclick=\"pausarInventario('").concat(inv.id, "')\">\u23F8</button>\n                    <button class=\"btn btn-danger btn-sm\" onclick=\"abrirFecharInventario('").concat(inv.id, "')\">Fechar</button>\n                  ") : inv.status === 'PAUSADO' ? "\n                    <button class=\"btn btn-success btn-sm\" onclick=\"pausarInventario('".concat(inv.id, "')\">\u25B6 Reativar</button>\n                  ") : "\n                    <button class=\"btn btn-export btn-sm\" onclick=\"validarExportacaoBluesoft('".concat(inv.id, "')\" title=\"Validar e exportar para o Bluesoft\">\uD83D\uDCE4 Bluesoft</button>\n                    <span style=\"font-size:.72rem;color:var(--muted)\">").concat(fmtData(inv.fechado_em), "</span>\n                  "), "\n                  <button class=\"btn btn-sm\" onclick=\"excluirInventario('").concat(inv.id, "')\" title=\"Excluir invent\u00E1rio permanentemente\" style=\"background:rgba(217,32,32,.10);color:var(--danger);border:1px solid rgba(217,32,32,.22);padding:4px 8px\">\uD83D\uDDD1 Excluir</button>\n                </div>\n              </td>\n            </tr>");
    }).join(''), "\n        </tbody>\n      </table>\n    </div>");
}
// ───────────────────────────────────────────────────────────────────
//  13. RENDERIZAÇÃO — ACOMPANHAMENTO
// ───────────────────────────────────────────────────────────────────
function trocarInventarioAcomp() {
    window.AnalistaState.set('ui.acompanhamentoInventarioId', document.getElementById('acomp-sel-inv').value || null, { source: 'ui-select-acomp' });
    renderAcompanhamento();
}
function renderAcompanhamento() {
    var sel = document.getElementById('acomp-sel-inv');
    if (sel) {
        var ativos = state().inventarios.filter(function (i) { return i.status === 'ATIVO'; });
        sel.innerHTML = '<option value="">Selecione uma auditoria...</option>' +
            ativos.map(function (i) { return "<option value=\"".concat(i.id, "\" ").concat(i.id === state().ui.acompanhamentoInventarioId ? 'selected' : '', ">").concat(i.codigo, " \u2014 ").concat(i.nome, "</option>"); }).join('');
    }
    var inv = state().ui.acompanhamentoInventarioId ? getInventarioPorId(state().ui.acompanhamentoInventarioId) : (getInventariosAtivos()[0] || null);
    if (!inv) {
        document.getElementById('acomp-inv-nome').textContent = 'Selecione uma auditoria para monitorar';
        ['ak-total', 'ak-contados', 'ak-pendentes', 'ak-diverg', 'ak-recount', 'ak-pct'].forEach(function (id) {
            document.getElementById(id).textContent = '—';
        });
        var ruasGrid_1 = document.getElementById('acomp-ruas-grid');
        if (ruasGrid_1)
            ruasGrid_1.innerHTML = "<div class=\"empty\" style=\"grid-column:1/-1\"><div class=\"empty-icon\">\uD83C\uDFAF</div><div class=\"empty-title\">Selecione uma auditoria</div></div>";
        document.getElementById('acomp-progress-detail').innerHTML = '';
        document.getElementById('acomp-coletores-wrap').innerHTML = '';
        return;
    }
    if (!state().ui.acompanhamentoInventarioId)
        window.AnalistaState.set('ui.acompanhamentoInventarioId', inv.id, { source: 'ui-default-acomp' });
    document.getElementById('acomp-inv-nome').textContent = "".concat(inv.codigo, " \u2014 ").concat(inv.nome);
    // Banner de inventário fechado
    var closedBanner = document.getElementById('acomp-closed-banner');
    if (inv.status === 'FECHADO') {
        if (!document.getElementById('acomp-closed-banner')) {
            var b = document.createElement('div');
            b.id = 'acomp-closed-banner';
            b.className = 'alert danger';
            b.style.marginBottom = '8px';
            b.innerHTML = "\uD83D\uDD12 <strong>Invent\u00E1rio Encerrado em ".concat(fmtTs(inv.fechado_em), "</strong> \u2014 Novas contagens e envios est\u00E3o bloqueados. Modo somente leitura.");
            document.getElementById('acomp-alertas').before(b);
        }
    }
    else {
        var existing = document.getElementById('acomp-closed-banner');
        if (existing)
            existing.remove();
    }
    // ──────────────────────────────────────────────────────────────────
    // REGRA: progresso sempre baseado em state().enderecosLista (endereços cadastrados)
    // conferidos = contados com produto + vazios_confirmados
    // ──────────────────────────────────────────────────────────────────
    var contsInv = state().contagens.filter(function (c) { return c.inventario_id === inv.id && !c._excluida; });
    var endsContados = new Set(contsInv.filter(function (c) { return !_isVazio(c); }).map(function (c) { return c.endereco; }));
    // Vazios confirmados (não estornados)
    var endsVaziosConf = new Set(contsInv.filter(function (c) { return _isVazio(c) && c.status !== 'ESTORNADA'; }).map(function (c) { return c.endereco; }));
    // União: endereços contados com produto OU confirmados como vazios
    var endsConferidos = new Set(__spreadArray(__spreadArray([], endsContados, true), endsVaziosConf, true));
    // Helper: extrai a rua do endereço (parte [3] de loja.local.area.rua.col.niv.seq)
    function _getRua(e) {
        // Prioridade 1: campo rua explícito no cadastro
        if (e.rua && e.rua !== '')
            return e.rua;
        // Prioridade 2: decompor pelo ponto
        if (e.endereco) {
            var parts = String(e.endereco).split('.');
            if (parts.length >= 4 && parts[3])
                return parts[3];
            if (parts.length >= 1 && parts[0])
                return parts[0]; // fallback p/ endereços curtos
        }
        return 'SEM RUA';
    }
    // Helper: extrai o local de estoque do cadastro
    function _getLocal(e) {
        return e.nome_local || e.local_area || e.local || e.setor || 'SEM LOCAL';
    }
    // Separar endereços ativos dos inativos (usa state().enderecosLista como base)
    var endsAtivos = state().enderecosLista.filter(function (e) { return e.ativo !== false; });
    var endsInativos = state().enderecosLista.filter(function (e) { return e.ativo === false; });
    // Conferidos = endereços ativos contados com produto OU confirmados como vazios
    var contadosAtivos = endsAtivos.filter(function (e) { return endsContados.has(e.endereco); });
    var vaziosConfAtivos = endsAtivos.filter(function (e) { return endsVaziosConf.has(e.endereco) && !endsContados.has(e.endereco); });
    var conferidosAtivos = endsAtivos.filter(function (e) { return endsConferidos.has(e.endereco); });
    var totalBase = endsAtivos.length;
    var totalCont = contadosAtivos.length;
    var totalVazios = vaziosConfAtivos.length;
    var totalConf = conferidosAtivos.length; // contados + vazios_confirmados
    var pendentes = totalBase - totalConf;
    var divs = state().divergencias.filter(function (d) { return d.inventario_id === inv.id && d.status === 'ABERTA'; }).length;
    var recs = state().recontagens.filter(function (r) { return r.inventario_id === inv.id && r.status === 'PENDENTE'; }).length;
    var pct = totalBase > 0 ? Math.round((totalConf / totalBase) * 100) : 0;
    document.getElementById('ak-total').textContent = totalBase.toLocaleString('pt-BR');
    document.getElementById('ak-contados').textContent = "".concat(totalConf.toLocaleString('pt-BR')).concat(totalVazios > 0 ? " (".concat(totalVazios, " vaz.)") : '');
    document.getElementById('ak-pendentes').textContent = pendentes.toLocaleString('pt-BR');
    document.getElementById('ak-diverg').textContent = divs.toLocaleString('pt-BR');
    document.getElementById('ak-recount').textContent = recs.toLocaleString('pt-BR');
    document.getElementById('ak-pct').textContent = pct + '%';
    // Alertas
    var alertaAcomp = '';
    if (endsInativos.length > 0)
        alertaAcomp += "<div class=\"alert info\" style=\"margin-bottom:8px\">\uD83D\uDEAB <strong>".concat(endsInativos.length, " endere\u00E7o(s) inativo(s)</strong> \u2014 exclu\u00EDdos do c\u00E1lculo de progresso.</div>");
    if (!state().enderecosLista.length)
        alertaAcomp += "<div class=\"alert warn\" style=\"margin-bottom:8px\">\u26A0\uFE0F <strong>Nenhum endere\u00E7o cadastrado no sistema.</strong> Cadastre endere\u00E7os na aba Endere\u00E7os para ver o progresso correto.</div>";
    var alertEl = document.getElementById('acomp-alertas');
    if (alertEl)
        alertEl.innerHTML = alertaAcomp;
    // ── PROGRESSO POR RUA (baseado em state().enderecosLista) ─────────────────────
    // conferidos = contados com produto + vazios confirmados
    var porRua = {};
    endsAtivos.forEach(function (e) {
        var rua = _getRua(e);
        if (!porRua[rua])
            porRua[rua] = { total: 0, contados: 0, vazios: 0 };
        porRua[rua].total++;
        if (endsContados.has(e.endereco))
            porRua[rua].contados++;
        else if (endsVaziosConf.has(e.endereco))
            porRua[rua].vazios++;
    });
    // Popular filtro de ruas
    var filtroRua = document.getElementById('acomp-filtro-rua');
    var ruaSelecionada = filtroRua ? filtroRua.value : '';
    if (filtroRua) {
        filtroRua.innerHTML = '<option value="">Todas as ruas</option>' +
            Object.keys(porRua).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); })
                .map(function (r) { return "<option value=\"".concat(r, "\" ").concat(r === ruaSelecionada ? 'selected' : '', ">").concat(r, "</option>"); }).join('');
    }
    var ruasFiltradas = ruaSelecionada
        ? Object.entries(porRua).filter(function (_a) {
            var r = _a[0];
            return r === ruaSelecionada;
        })
        : Object.entries(porRua);
    var ruasGrid = document.getElementById('acomp-ruas-grid');
    if (ruasGrid) {
        if (!ruasFiltradas.length) {
            ruasGrid.innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDEE3\uFE0F</div><div class=\"empty-title\">Nenhuma rua encontrada nos endere\u00E7os cadastrados</div></div>";
        }
        else {
            ruasGrid.innerHTML = ruasFiltradas
                .sort(function (a, b) { return a[0].localeCompare(b[0], 'pt-BR', { numeric: true }); })
                .map(function (_a) {
                var rua = _a[0], d = _a[1];
                var conferidos = d.contados + d.vazios;
                var p = d.total > 0 ? Math.round((conferidos / d.total) * 100) : 0;
                var finalizado = p === 100;
                var color = finalizado ? 'green' : p >= 70 ? 'blue' : p >= 30 ? 'yellow' : 'red';
                var faltam = d.total - conferidos;
                // Recontagens nesta rua
                var endsRua = endsAtivos.filter(function (e) { return _getRua(e) === rua; }).map(function (e) { return e.endereco; });
                var recsRua = state().recontagens.filter(function (r) { return r.inventario_id === inv.id && endsRua.includes(r.endereco); }).length;
                return "<div onclick=\"abrirDetalheRua('".concat(inv.id, "','").concat(rua.replace(/'/g, "\\'"), "','").concat(encodeURIComponent(rua), "')\"\n            style=\"background:").concat(finalizado ? '#f0fdf4' : 'var(--surface)', ";border:1.5px solid ").concat(finalizado ? '#86efac' : 'var(--border)', ";border-radius:10px;padding:14px 18px;cursor:pointer;transition:all .18s;user-select:none\"\n            onmouseover=\"this.style.borderColor='var(--accent)';this.style.transform='translateX(3px)'\"\n            onmouseout=\"this.style.borderColor='").concat(finalizado ? '#86efac' : 'var(--border)', "';this.style.transform='translateX(0)'\">\n            <div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:8px\">\n              <div style=\"display:flex;align-items:center;gap:8px\">\n                <span style=\"font-size:.95rem\">\uD83D\uDEE3\uFE0F</span>\n                <span style=\"font-weight:700;font-size:.9rem\">Rua ").concat(rua, "</span>\n                ").concat(finalizado ? '<span class="badge b-green" style="font-size:.6rem">✓ FINALIZADA</span>' : '', "\n                ").concat(d.vazios > 0 ? "<span class=\"badge b-gray\" style=\"font-size:.6rem\">\uD83D\uDD32 ".concat(d.vazios, " vaz.</span>") : '', "\n                ").concat(recsRua > 0 ? "<span class=\"badge b-orange\" style=\"font-size:.6rem\">\uD83D\uDD04 ".concat(recsRua, " rec.</span>") : '', "\n              </div>\n              <div style=\"display:flex;align-items:center;gap:8px\">\n                <span style=\"font-family:var(--mono);font-weight:800;font-size:1rem;color:").concat(finalizado ? '#059669' : 'var(--text)', "\">").concat(p, "%</span>\n                <span style=\"font-size:.7rem;color:var(--muted)\">\u25B6 detalhe</span>\n              </div>\n            </div>\n            <div class=\"prog\"><div class=\"prog-fill ").concat(color, "\" style=\"width:").concat(p, "%\"></div></div>\n            <div style=\"display:flex;justify-content:space-between;margin-top:7px;font-size:.72rem;color:var(--muted)\">\n              <span>\u2705 ").concat(d.contados, " contados").concat(d.vazios > 0 ? " \u00B7 \uD83D\uDD32 ".concat(d.vazios, " vazios") : '', "</span>\n              <span>").concat(d.total, " endere\u00E7os</span>\n              <span style=\"color:").concat(faltam > 0 ? 'var(--danger)' : 'var(--success)', "\">\u23F3 ").concat(faltam, " faltam</span>\n            </div>\n          </div>");
            }).join('');
        }
    }
    // ── PROGRESSO POR LOCAL DE ESTOQUE (baseado em state().enderecosLista) ────────
    var porLocal = {};
    endsAtivos.forEach(function (e) {
        var local = _getLocal(e);
        if (!porLocal[local])
            porLocal[local] = { total: 0, contados: 0, vazios: 0 };
        porLocal[local].total++;
        if (endsContados.has(e.endereco))
            porLocal[local].contados++;
        else if (endsVaziosConf.has(e.endereco))
            porLocal[local].vazios++;
    });
    var progHtml = Object.entries(porLocal)
        .sort(function (a, b) { return a[0].localeCompare(b[0]); })
        .map(function (_a) {
        var local = _a[0], d = _a[1];
        var conferidos = d.contados + d.vazios;
        var p = d.total > 0 ? Math.round((conferidos / d.total) * 100) : 0;
        var finalizado = p === 100;
        var color = finalizado ? 'green' : p >= 80 ? 'green' : p >= 50 ? 'blue' : 'yellow';
        return "<div style=\"margin-bottom:14px\">\n        <div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:5px\">\n          <span style=\"font-size:.82rem;font-weight:700\">\uD83C\uDFED ".concat(local, "</span>\n          <div style=\"display:flex;align-items:center;gap:8px\">\n            <span style=\"font-size:.72rem;color:var(--muted)\">").concat(conferidos, "/").concat(d.total, " end.").concat(d.vazios > 0 ? " (".concat(d.vazios, " vaz.)") : '', "</span>\n            ").concat(finalizado ? '<span class="badge b-green" style="font-size:.6rem">✓ OK</span>' : '', "\n          </div>\n        </div>\n        <div class=\"prog-wrap\">\n          <div class=\"prog\"><div class=\"prog-fill ").concat(color, "\" style=\"width:").concat(p, "%\"></div></div>\n          <span class=\"prog-label\" style=\"font-weight:700\">").concat(p, "%</span>\n        </div>\n      </div>");
    }).join('');
    document.getElementById('acomp-progress-detail').innerHTML = progHtml
        || "<div style=\"text-align:center;color:var(--muted);padding:20px;font-size:.83rem\">Nenhum endere\u00E7o cadastrado no sistema. Cadastre endere\u00E7os na aba <strong>Endere\u00E7os</strong>.</div>";
    // ── PRODUTIVIDADE POR OPERADOR ──────────────────────────────────────
    var porOp = {};
    contsInv.forEach(function (c) {
        var op = c.operador || 'Desconhecido';
        if (!porOp[op])
            porOp[op] = { total: 0, divergencias: 0, recontagens: 0, primeira: null, ultima: null };
        porOp[op].total++;
        if (!porOp[op].primeira || c.timestamp < porOp[op].primeira)
            porOp[op].primeira = c.timestamp;
        if (!porOp[op].ultima || c.timestamp > porOp[op].ultima)
            porOp[op].ultima = c.timestamp;
    });
    state().divergencias.filter(function (d) { return d.inventario_id === inv.id; }).forEach(function (d) {
        var cont = contsInv.find(function (c) { return c.endereco === d.endereco; });
        if (cont && cont.operador && porOp[cont.operador])
            porOp[cont.operador].divergencias++;
    });
    state().recontagens.filter(function (r) { return r.inventario_id === inv.id && r.operador; }).forEach(function (r) {
        if (porOp[r.operador])
            porOp[r.operador].recontagens++;
    });
    var colHtml = Object.entries(porOp).sort(function (a, b) { return b[1].total - a[1].total; }).map(function (_a) {
        var op = _a[0], d = _a[1];
        // Calcular tempo médio entre primeira e última contagem
        var tempoMedio = '—';
        if (d.primeira && d.ultima && d.total > 1) {
            var diffMs = new Date(d.ultima) - new Date(d.primeira);
            var mins = Math.round(diffMs / 60000);
            if (mins > 0) {
                var porH = Math.round((d.total / (diffMs / 3600000)) * 10) / 10;
                tempoMedio = "".concat(porH, "/h");
            }
        }
        return "<tr>\n      <td>\n        <div style=\"display:flex;align-items:center;gap:8px\">\n          <div class=\"u-avatar\" style=\"width:28px;height:28px;font-size:.7rem;flex-shrink:0\">".concat((op || '?')[0].toUpperCase(), "</div>\n          <span style=\"font-weight:600\">").concat(op || 'Desconhecido', "</span>\n        </div>\n      </td>\n      <td class=\"mono\" style=\"font-weight:700\">").concat(d.total.toLocaleString('pt-BR'), "</td>\n      <td class=\"mono\" style=\"color:").concat(d.divergencias > 0 ? 'var(--danger)' : 'var(--muted)', "\">").concat(d.divergencias, "</td>\n      <td class=\"mono\" style=\"color:").concat(d.recontagens > 0 ? 'var(--warn)' : 'var(--muted)', "\">").concat(d.recontagens, "</td>\n      <td class=\"mono\" style=\"color:var(--muted)\">").concat(tempoMedio, "</td>\n      <td style=\"font-size:.75rem;color:var(--muted)\">").concat(fmtTs(d.ultima), "</td>\n    </tr>");
    }).join('');
    document.getElementById('acomp-coletores-wrap').innerHTML = colHtml ? "\n    <div class=\"tbl-wrap\"><table>\n      <thead><tr><th>Operador</th><th>Contagens</th><th>Conflitos</th><th>Rodadas</th><th>Produtividade</th><th>\u00DAltima Atividade</th></tr></thead>\n      <tbody>".concat(colHtml, "</tbody>\n    </table></div>") :
        "<div class=\"empty\"><div class=\"empty-icon\">\uD83D\uDC64</div><div class=\"empty-title\">Nenhum operador com contagens neste invent\u00E1rio</div></div>";
}
