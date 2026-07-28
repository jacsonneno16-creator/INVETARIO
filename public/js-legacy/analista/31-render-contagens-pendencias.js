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
function _produtoContagemExibicao(c) {
    var _a, _b;
    var codigo = (c === null || c === void 0 ? void 0 : c.codigo_produto) || (c === null || c === void 0 ? void 0 : c.codigoProduto) || (c === null || c === void 0 ? void 0 : c.gtin) || (c === null || c === void 0 ? void 0 : c.ean) || (c === null || c === void 0 ? void 0 : c.dun) || (c === null || c === void 0 ? void 0 : c.codigo_lido) || (c === null || c === void 0 ? void 0 : c.codigoLido) || '';
    var atual = String((c === null || c === void 0 ? void 0 : c.descricao_produto) || (c === null || c === void 0 ? void 0 : c.descricaoProduto) || (c === null || c === void 0 ? void 0 : c.descricao) || '').trim();
    var placeholder = !atual || /^(PRODUTO NAO IDENTIFICADO|PRODUTO NÃO IDENTIFICADO|PRODUTO NAO CADASTRADO|PRODUTO NÃO CADASTRADO|CODIGO SEM CADASTRO|CÓDIGO SEM CADASTRO)$/i.test(atual);
    var ach = (_b = (_a = window.DTProdutos) === null || _a === void 0 ? void 0 : _a.buscarSync) === null || _b === void 0 ? void 0 : _b.call(_a, codigo);
    return { codigo: codigo || (ach === null || ach === void 0 ? void 0 : ach.codigoInterno) || (ach === null || ach === void 0 ? void 0 : ach.gtin) || (ach === null || ach === void 0 ? void 0 : ach.dun) || '', descricao: (!placeholder ? atual : '') || ((ach === null || ach === void 0 ? void 0 : ach.encontrado) ? ach.nomeProduto : 'Código sem cadastro') };
}
function contStatusBadge(status) {
    var st = String(status || 'PENDENTE').toUpperCase();
    if (st === 'PROCESSADO' || st === 'OK' || st === 'CONCLUIDA')
        return 'b-green';
    if (st === 'DIVERGENTE' || st === 'CONFLITO' || st === 'PERSISTENTE')
        return 'b-red';
    if (st === 'ESTORNADA' || st === 'EXCLUIDA')
        return 'b-gray';
    if (st === 'EM_RECONTAGEM' || st === 'RECONTAGEM')
        return 'b-purple';
    return 'b-orange';
}
window.contStatusBadge = window.contStatusBadge || contStatusBadge;
// Resume o resultado final das rodadas (1ª/2ª/3ª contagem) de um endereço em
// um único badge, em vez de o endereço aparecer uma vez por rodada na lista
// de Contagens. Usa a mesma regra de avaliação da aba Recontagem, então os
// dois lugares sempre concordam sobre qual rodada "bateu".
function _resultadoRodadaEndereco(c) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    var st = state();
    var invRegistro = (st.inventarios || []).find(function (i) {
        var aliases = [i.id, i.codigo, i.nome, i.inventario_id, i.inventarioId]
            .filter(Boolean).map(String);
        return aliases.includes(String(c.inventario_id || c.inventarioId || ''));
    });
    var invIds = new Set([
        invRegistro === null || invRegistro === void 0 ? void 0 : invRegistro.id,
        invRegistro === null || invRegistro === void 0 ? void 0 : invRegistro.codigo,
        invRegistro === null || invRegistro === void 0 ? void 0 : invRegistro.nome,
        invRegistro === null || invRegistro === void 0 ? void 0 : invRegistro.inventario_id,
        invRegistro === null || invRegistro === void 0 ? void 0 : invRegistro.inventarioId,
        c.inventario_id, c.inventarioId
    ].filter(Boolean).map(function (v) { return String(v); }));
    var end = String(c.endereco || '').trim().toUpperCase();
    var produto = String(c.codigo_produto || c.codigoProduto || c.produto || c.gtin || c.ean || c.dun || '').trim().toUpperCase();
    var normalizaProduto = function (obj) { return String((obj === null || obj === void 0 ? void 0 : obj.produto) || (obj === null || obj === void 0 ? void 0 : obj.produto_contado) || (obj === null || obj === void 0 ? void 0 : obj.codigo_produto) || (obj === null || obj === void 0 ? void 0 : obj.codigoProduto) ||
        (obj === null || obj === void 0 ? void 0 : obj.produto_recontagem) || (obj === null || obj === void 0 ? void 0 : obj.produto_segunda) || (obj === null || obj === void 0 ? void 0 : obj.produto_terceira) ||
        (obj === null || obj === void 0 ? void 0 : obj.gtin) || (obj === null || obj === void 0 ? void 0 : obj.ean) || (obj === null || obj === void 0 ? void 0 : obj.dun) || '').trim().toUpperCase(); };
    // A divergência precisa pertencer ao mesmo inventário, endereço E produto.
    // Não usa mais fallback por "única divergência do endereço", pois isso ligava
    // uma contagem a outro produto e podia exibir OK 3ª indevidamente.
    var inventarioCanonicoContagem = FK.inventario(c, st.inventarios);
    var divsMesmoEndereco = (st.divergencias || []).filter(function (d) {
        var mesmoEndereco = FK.endereco(d.endereco) === end;
        if (!mesmoEndereco)
            return false;
        var inventarioCanonicoDiv = FK.inventario(d, st.inventarios);
        if (inventarioCanonicoContagem && inventarioCanonicoDiv)
            return inventarioCanonicoContagem === inventarioCanonicoDiv;
        var invBruto = String(d.inventario_id || d.inventarioId || d.inventario || d.inventario_nome || '');
        return invIds.has(invBruto);
    });
    // Primeiro tenta o vínculo explícito da contagem. Depois usa produto normalizado.
    // Como último recurso, aceita a única divergência aberta do endereço. Isso evita
    // exibir "OK 1ª" quando o registro da contagem traz GTIN e a divergência ficou
    // gravada com código interno do mesmo produto.
    var idContagem = String(c.uuid || c.id || '');
    var div = divsMesmoEndereco.find(function (d) {
        return idContagem && String(d.contagem_uuid || d.contagem_id || d.origem_contagem_id || '') === idContagem;
    }) || divsMesmoEndereco.find(function (d) { return produto && normalizaProduto(d) === produto; }) || (function () {
        var abertas = divsMesmoEndereco.filter(function (d) {
            return !['RESOLVIDA', 'PERSISTENTE', 'CANCELADA'].includes(String(d.status || '').toUpperCase());
        });
        return abertas.length === 1 ? abertas[0] : null;
    })();
    if (!div) {
        if (c.divergente === true || String(c.status || '').toUpperCase() === 'DIVERGENTE' || divsMesmoEndereco.length > 0) {
            return { texto: '❌ Divergente — aguardando decisão', cls: 'b-red' };
        }
        // Só mostra OK 1ª quando não existe qualquer divergência aberta para o endereço.
        if (String(c.tipo_contagem || 'PRIMEIRA').toUpperCase() !== 'RECONTAGEM') {
            return { texto: '✅ OK 1ª', cls: 'b-green' };
        }
        return null;
    }
    var statusConcluido = function (r) {
        var status = String(r.status_recontagem || r.status || '').trim().toUpperCase();
        var dataConclusao = r.recontagem_concluida_em || r.concluida_em ||
            r.data_conclusao || r.finalizada_em || r.processada_em || null;
        var statusOk = ['CONCLUIDA', 'CONCLUÍDA', 'FINALIZADA', 'PROCESSADA', 'RESOLVIDA'].includes(status);
        var statusBloqueado = ['PENDENTE', 'ATRIBUIDA', 'ATRIBUÍDA', 'EM_ANDAMENTO', 'ABERTA', 'CANCELADA', 'EXCLUIDA'].includes(status);
        return r.qtd_recontagem != null && !statusBloqueado && (statusOk || Boolean(dataConclusao));
    };
    // Só considera recontagens realmente concluídas e vinculadas à divergência exata.
    var recs = (st.recontagens || [])
        .filter(function (r) { return String(r.divergencia_id || '') === String(div.id || '') && statusConcluido(r); })
        .sort(function (a, b) {
        var na = Number(a.numero_recontagem || 0), nb = Number(b.numero_recontagem || 0);
        if (na !== nb)
            return na - nb;
        return String(a.recontagem_concluida_em || a.concluida_em || a.finalizada_em || '')
            .localeCompare(String(b.recontagem_concluida_em || b.concluida_em || b.finalizada_em || ''));
    });
    var base = {
        qtd_esperada: div.qtd_esperada,
        produto: div.produto || div.produto_contado || produto,
        qtd_primeira: (_b = (_a = div.qtd_primeira) !== null && _a !== void 0 ? _a : div.qtd_contada) !== null && _b !== void 0 ? _b : c.quantidade,
        produto_primeira: div.produto_primeira || div.produto_contado || produto,
        qtd_segunda: (_d = (_c = recs[0]) === null || _c === void 0 ? void 0 : _c.qtd_recontagem) !== null && _d !== void 0 ? _d : null,
        produto_segunda: ((_e = recs[0]) === null || _e === void 0 ? void 0 : _e.produto_recontagem) || ((_f = recs[0]) === null || _f === void 0 ? void 0 : _f.produto) || produto,
        qtd_terceira: (_h = (_g = recs[1]) === null || _g === void 0 ? void 0 : _g.qtd_recontagem) !== null && _h !== void 0 ? _h : null,
        produto_terceira: ((_j = recs[1]) === null || _j === void 0 ? void 0 : _j.produto_recontagem) || ((_k = recs[1]) === null || _k === void 0 ? void 0 : _k.produto) || produto
    };
    var avaliacao = (_m = (_l = window.AnalistaDivergenciasRuntime) === null || _l === void 0 ? void 0 : _l.avaliarHistorico) === null || _m === void 0 ? void 0 : _m.call(_l, base);
    if (!avaliacao)
        return { texto: '❌ Divergente — aguardando decisão', cls: 'b-red' };
    // Trava de segurança: a rodada exibida nunca pode ser maior que a quantidade
    // de recontagens realmente concluídas (1ª + até duas recontagens).
    var rodadaMaximaReal = 1 + Math.min(recs.length, 2);
    var rodadaReal = Math.min(Number(avaliacao.rodada || 1), rodadaMaximaReal);
    if (avaliacao.estado === 'RESOLVIDA') {
        return { texto: "\u2705 OK ".concat(rodadaReal, "\u00AA"), cls: 'b-green' };
    }
    if (recs.length >= 2 && avaliacao.estado === 'PERSISTENTE') {
        return { texto: '🔴 Persistente (3 rodadas)', cls: 'b-red' };
    }
    if (recs.length === 1)
        return { texto: '⏳ Aguardando 3ª contagem', cls: 'b-orange' };
    return { texto: '❌ Divergente — aguardando decisão', cls: 'b-red' };
}
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
    var dados = state().contagens || [];
    // Cada rodada de recontagem gerava sua própria linha aqui, então um endereço
    // recontado 2x aparecia 3x na lista (1ª + 2ª + 3ª) — confuso e redundante,
    // já que essas rodadas já são exibidas com detalhe na aba Recontagem. Por
    // padrão mostramos só a 1ª contagem de cada endereço, com um badge dizendo
    // em qual rodada ele finalmente bateu. Quem quiser ver as rodadas de
    // recontagem em si pode filtrar explicitamente por Tipo = Recontagem.
    if (!fTipo) {
        dados = dados.filter(function (c) { return c.tipo_contagem !== 'RECONTAGEM'; });
        var grupos_1 = new Map();
        var chaveContagem_1 = function (c) {
            var id = String(c.inventario_id || c.inventarioId || '');
            var inv = (state().inventarios || []).find(function (i) {
                return [i.id, i.codigo, i.nome, i.inventario_id, i.inventarioId]
                    .filter(Boolean).map(String).includes(id);
            });
            var produto = String(c.codigo_produto || c.codigoProduto || c.produto || c.gtin || c.ean || c.dun || '').trim().toUpperCase();
            return "".concat(String((inv === null || inv === void 0 ? void 0 : inv.id) || id), "|").concat(String(c.endereco || '').trim().toUpperCase(), "|").concat(produto);
        };
        dados.forEach(function (c) {
            var chave = chaveContagem_1(c);
            var atual = grupos_1.get(chave);
            var data = function (x) { return String(x.timestamp || x.criado_em || x.dataHora || ''); };
            if (!atual || data(c).localeCompare(data(atual)) < 0)
                grupos_1.set(chave, c);
        });
        dados = __spreadArray([], grupos_1.values(), true);
    }
    if (fInv)
        dados = dados.filter(function (c) { return String(c.inventario_id || c.inventarioId || '') === String(fInv); });
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
    _setCK('ck-divergentes', _allConts.filter(function (c) { return c.divergente === true; }).length);
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
        var prodExib = _produtoContagemExibicao(c);
        return "<tr style=\"".concat(rowStyle, "\">\n            <td class=\"mono\" style=\"white-space:nowrap;font-size:.75rem\">").concat(fmtTs(c.timestamp), "</td>\n            <td>\n              <div style=\"display:flex;align-items:center;gap:6px\">\n                <div class=\"u-avatar\" style=\"width:24px;height:24px;font-size:.65rem;flex-shrink:0\">").concat((c.operador || '?')[0].toUpperCase(), "</div>\n                <span style=\"font-weight:600;font-size:.82rem\">").concat(c.operador || '—', "</span>\n              </div>\n            </td>\n            <td style=\"font-size:.75rem;color:var(--muted)\">").concat((inv === null || inv === void 0 ? void 0 : inv.codigo) || c.inventario_id, "</td>\n            <td class=\"mono\">").concat(c.endereco || '—').concat(capInfo).concat(ruaInfo, "</td>\n            <td>\n              <div style=\"font-weight:600;font-size:.82rem\">").concat(prodExib.codigo || '—', "</div>\n              <div style=\"font-size:.72rem;color:var(--muted)\">").concat(prodExib.descricao || '', "</div>\n            </td>\n            <td class=\"mono\" style=\"font-weight:700;font-size:.9rem\">").concat((c.qtd_caixas != null && c.fator_caixa > 1)
            ? "".concat(c.qtd_caixas, " CX")
            : ((_a = c.quantidade) !== null && _a !== void 0 ? _a : '—'), "</td>\n            <td><span class=\"badge ").concat(c.tipo_contagem === 'RECONTAGEM' ? 'b-purple' : 'b-blue', "\">").concat(c.tipo_contagem || 'PRIMEIRA', "</span></td>\n            <td>\n              ").concat(excluida
            ? "<span class=\"badge b-gray\">\uD83D\uDDD1 Exclu\u00EDda</span>"
            : (function () {
                var rodada = _resultadoRodadaEndereco(c);
                return rodada
                    ? "<span class=\"badge ".concat(rodada.cls, "\" title=\"Resultado final considerando as rodadas de recontagem\">").concat(rodada.texto, "</span>")
                    : "<span class=\"badge ".concat(contStatusBadge(c.status), "\">").concat(c.status || 'PENDENTE', "</span>");
            })(), "\n            </td>\n            <td>\n              ").concat(excluida
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
        selInv.innerHTML = '<option value="">Selecione um inventário...</option>' +
            state().inventarios.filter(function (i) { var _a; return ['ATIVO', 'ABERTO', 'PUBLICADO', 'LIBERADO', 'EM_ANDAMENTO', 'PAUSADO'].includes(String(i.status || '').toUpperCase()) || ((_a = i.enderecos_selecionados) === null || _a === void 0 ? void 0 : _a.length); }).map(function (i) {
                return "<option value=\"".concat(i.id, "\" ").concat(i.id === cur_2 ? 'selected' : '', ">").concat(i.codigo, " \u2014 ").concat(i.nome, "</option>");
            }).join('');
        if (cur_2)
            selInv.value = cur_2;
    }
    if (!invId) {
        document.getElementById('pend-table-wrap').innerHTML = "<div class=\"empty\"><div class=\"empty-icon\">\u23F3</div><div class=\"empty-title\">Selecione um invent\u00E1rio</div></div>";
        ['pk-total', 'pk-contados', 'pk-pendentes', 'pk-pct'].forEach(function (id) { return document.getElementById(id).textContent = '—'; });
        return;
    }
    var inv = getInventarioPorId(invId);
    if (!inv)
        return;
    // Usar state().enderecosLista como base oficial de endereços
    var conts = (state().contagens || []).filter(function (c) { return String(c.inventario_id || c.inventarioId || '') === String(invId) && !c._excluida && c.status !== 'ESTORNADA'; });
    var endsContadosSet = new Set(conts.filter(function (c) { return !_isVazio(c); }).map(function (c) { return c.endereco; }));
    var endsVaziosConfSet = new Set(conts.filter(function (c) { return _isVazio(c) && c.status !== 'ESTORNADA'; }).map(function (c) { return c.endereco; }));
    // Usar somente os endereços pertencentes ao inventário selecionado.
    var selecionados = Array.isArray(inv.enderecos_selecionados) ? inv.enderecos_selecionados : [];
    var selecionadosSet = new Set(selecionados.map(function (x) { return String(typeof x === 'string' ? x : (x.endereco || x.id || '')); }).filter(Boolean));
    var baseInventario = selecionadosSet.size
        ? (state().enderecosLista || []).filter(function (e) { return selecionadosSet.has(String(e.endereco || e.id || '')); })
        : (Array.isArray(inv.base) && inv.base.length ? inv.base : (state().enderecosLista || []));
    // Enriquecer a base do inventário com status de contagem
    var lista = baseInventario.map(function (e) {
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
    var recPend = (state().recontagens || []).filter(function (r) { return String(r.inventario_id || r.inventarioId || '') === String(invId) && String(r.status || '').toUpperCase() === 'PENDENTE'; });
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
            }).join(''), "\n          </tbody>\n        </table></div>\n        ").concat(recPend.length > 10 ? "<div style=\"padding:8px 16px;font-size:.75rem;color:var(--muted)\">... e mais ".concat(recPend.length - 10, ". Veja a aba Recontagem.</div>") : '');
        }
        else {
            recSec.style.display = 'none';
        }
    }
    // ── SEÇÃO: Divergências abertas ──────────────────────────────────
    var divAbertas = (state().divergencias || []).filter(function (d) { return String(d.inventario_id || d.inventarioId || '') === String(invId) && ['ABERTA', 'DIVERGENTE', 'PENDENTE', 'PERSISTENTE', 'EM_RECONTAGEM'].includes(String(d.status || '').toUpperCase()); });
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
                return "<tr>\n                <td class=\"mono\">".concat(escHTML(d.endereco), "</td>\n                <td style=\"font-size:.82rem\">").concat(escHTML(d.produto), "</td>\n                <td class=\"mono\">").concat(d.qtd_esperada, "</td>\n                <td class=\"mono\" style=\"font-weight:700;color:").concat(d.qtd_contada < d.qtd_esperada ? 'var(--danger)' : 'var(--warn)', "\">").concat(d.qtd_contada, "</td>\n                <td class=\"mono\" style=\"font-weight:800;color:").concat(difColor, "\">").concat(d.diferenca > 0 ? '+' : '').concat(d.diferenca, "</td>\n                <td><span class=\"badge ").concat(d.status === 'EM_RECONTAGEM' ? 'b-orange' : 'b-red', "\">").concat(d.status === 'EM_RECONTAGEM' ? 'Em Recontagem' : 'Aberta', "</span></td>\n              </tr>");
            }).join(''), "\n          </tbody>\n        </table></div>\n        ").concat(divAbertas.length > 10 ? "<div style=\"padding:8px 16px;font-size:.75rem;color:var(--muted)\">... e mais ".concat(divAbertas.length - 10, ". Veja a aba Recontagem.</div>") : '');
        }
        else {
            divSec.style.display = 'none';
        }
    }
}
