// ═══════════════════════════════════════════════════
//  🔄  RECONTAGENS — CONTROLE E RENDERIZAÇÃO
// ═══════════════════════════════════════════════════
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
function recarregarRecontagens() {
    var _a;
    if (!((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.id)) {
        renderRecontagensAtribuidas();
        return;
    }
    if (_recListener) {
        try {
            _recListener();
        }
        catch (e) { }
        _recListener = null;
    }
    iniciarListenerRecontagens(APP.inventario.id);
    toast('🔄 Sincronizando…', 's');
}
function setRecFilter(f, el) {
    _recFiltroAtivo = f;
    document.querySelectorAll('.rec-filter-btn').forEach(function (b) {
        b.style.borderColor = 'var(--border)';
        b.style.background = 'transparent';
        b.style.color = 'var(--muted)';
    });
    if (el) {
        el.style.borderColor = 'var(--accent)';
        el.style.background = 'rgba(232,117,26,.12)';
        el.style.color = 'var(--accent)';
    }
    renderRecontagensAtribuidas();
}
function _atualizarBadgeRecontagens() {
    var _a;
    var opAtual = ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || '';
    var statusEncerrados = ['concluida', 'sem_divergencia', 'resolvida', 'aguardando_analista', 'cancelada'];
    var recs = (APP.recontagens || []).filter(function (r) {
        var st = (r.status || '').toUpperCase();
        var stRec = (r.status_recontagem || 'pendente').toLowerCase();
        if (st === 'CANCELADA' || stRec === 'cancelada')
            return false;
        if (stRec === 'persistente')
            return false;
        if (st === 'PERSISTENTE' || (r.status_bloqueio || '') === 'PERSISTENTE_BLOQUEADO')
            return false;
        if (opAtual && r.operador && r.operador !== opAtual)
            return false;
        return true;
    });
    var pendentes = recs.filter(function (r) { return !statusEncerrados.includes((r.status_recontagem || 'pendente').toLowerCase()); }).length;
    var total = recs.length;
    var tab = document.getElementById('tab-recontagens');
    if (!tab)
        return;
    var old = tab.querySelector('.rec-badge');
    if (old)
        old.remove();
    if (total > 0) {
        var badge = document.createElement('span');
        badge.className = 'rec-badge';
        badge.textContent = pendentes > 0 ? pendentes : '✓';
        badge.style.background = pendentes > 0 ? 'var(--warn)' : 'var(--success)';
        tab.appendChild(badge);
    }
}
function iniciarListenerRecontagens(invId) {
    var _a;
    if (_recListener) {
        try {
            _recListener();
        }
        catch (e) { }
        _recListener = null;
    }
    if (!invId)
        return;
    var _unsubRec = null, _unsubDiv = null;
    if (!((_a = APP.recontagens) === null || _a === void 0 ? void 0 : _a.length))
        _recCarregando = true;
    try {
        _unsubRec = FS.collection('dt_recontagens')
            .where('inventario_id', '==', invId)
            .onSnapshot(function (snap) {
            APP.recontagens = snap.docs.map(function (d) {
                var data = d.data();
                delete data.id;
                var rec = __assign({ id: d.id }, data);
                rec.status_recontagem = (rec.status_recontagem || 'pendente').toLowerCase();
                return rec;
            }).filter(function (r) {
                var stRec = (r.status_recontagem || 'pendente').toLowerCase();
                var st = (r.status || '').toUpperCase();
                // Excluir canceladas, encerradas e bloqueadas definitivamente
                if (stRec === 'cancelada' || st === 'CANCELADA')
                    return false;
                if (stRec === 'persistente')
                    return false;
                if (st === 'PERSISTENTE')
                    return false;
                if ((r.status_bloqueio || '') === 'PERSISTENTE_BLOQUEADO')
                    return false;
                return true;
            });
            _recCarregando = false;
            _atualizarBadgeRecontagens();
            if (!_recJaAtivouAba) {
                _recJaAtivouAba = true;
                _ativarAbaSeNecessario();
            }
            renderRecontagensAtribuidas();
        }, function (err) {
            console.error('[REC] dt_recontagens erro:', err.code, err.message);
            if (err.code === 'permission-denied')
                toast('⚠️ Permissão negada em dt_recontagens. Corrija as Firestore Rules.', 'e');
            _recCarregando = false;
            renderRecontagensAtribuidas();
        });
        _unsubDiv = FS.collection('dt_divergencias')
            .where('inventario_id', '==', invId)
            .onSnapshot(function (snap) {
            var _a;
            var opAtual = ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || '';
            APP.divergenciasAtribuidas = snap.docs.map(function (d) {
                var data = d.data();
                delete data.id;
                var div = __assign({ id: d.id }, data);
                // Preservar status_recontagem do Firestore sem sobrescrever com padrão
                // 'pendente' — o analista é quem define o status correto.
                if (div.status_recontagem) {
                    div.status_recontagem = div.status_recontagem.toLowerCase();
                }
                else {
                    div.status_recontagem = 'pendente';
                }
                return div;
            }).filter(function (d) {
                if (_itemEncerradoColetor(d))
                    return false;
                // Só mostrar divergências atribuídas ao operador atual
                if (opAtual && d.operador_responsavel && d.operador_responsavel !== opAtual)
                    return false;
                return true;
            });
            _atualizarBadgeRecontagens();
            renderRecontagensAtribuidas();
        }, function (err) { console.error('[REC] dt_divergencias erro:', err.code, err.message); });
        _recListener = function () {
            try {
                if (_unsubRec)
                    _unsubRec();
            }
            catch (e) { }
            try {
                if (_unsubDiv)
                    _unsubDiv();
            }
            catch (e) { }
            _recListener = null;
        };
    }
    catch (e) {
        console.error('[REC] Falha ao iniciar listener:', e.message);
        _recCarregando = false;
    }
}
function _ativarAbaSeNecessario() {
    var _a;
    if (APP.modoRecontagem)
        return;
    if (APP.atual.step !== 1)
        return;
    if ((_a = document.getElementById('view-recontagens')) === null || _a === void 0 ? void 0 : _a.classList.contains('on')) {
        renderRecontagensAtribuidas();
        return;
    }
    var statusEncerrados = ['concluida', 'sem_divergencia', 'resolvida', 'aguardando_analista', 'cancelada'];
    var temPendente = (APP.recontagens || [])
        .some(function (r) { return !statusEncerrados.includes((r.status_recontagem || 'pendente').toLowerCase()); });
    if (temPendente)
        showView('recontagens', document.getElementById('tab-recontagens'));
}
/**
 * Retorna true se o item (recontagem ou divergência) está encerrado no coletor.
 * Usado tanto nos filtros de lista quanto na abertura manual.
 */
function _itemEncerradoColetor(item) {
    if (!item)
        return true;
    var status = String(item.status || '').toUpperCase();
    var bloqueio = String(item.status_bloqueio || '').toUpperCase();
    var stRec = String(item.status_recontagem || '').toLowerCase();
    if (status === 'RESOLVIDA')
        return true;
    if (status === 'PERSISTENTE')
        return true;
    if (status === 'CANCELADA')
        return true;
    if (bloqueio === 'PERSISTENTE_BLOQUEADO')
        return true;
    if (stRec === 'concluida')
        return true;
    if (stRec === 'cancelada')
        return true;
    if (stRec === 'sem_divergencia')
        return true;
    if (stRec === 'aguardando_analista')
        return true;
    if (item.divergencia_resolvida === true)
        return true;
    if (item.encerrada_definitivamente === true)
        return true;
    return false;
}
/**
 * Retorna true se o item está aguardando decisão do analista
 * (recontagem concluída porém divergência ainda em aberto, sem novo operador atribuído).
 */
function _itemAguardandoAnalista(item) {
    if (!item)
        return false;
    var stRec = String(item.status_recontagem || '').toLowerCase();
    // Divergência com status_recontagem 'pendente' mas sem operador atribuído
    // indica que o analista ainda não criou a próxima rodada.
    if (item.divergencia_id && stRec === 'pendente' && !item.operador)
        return true;
    // Recontagem já CONCLUÍDA pertencente a uma divergência ainda EM_RECONTAGEM
    if (String(item.status || '').toUpperCase() === 'CONCLUIDA') {
        var div = (APP.divergenciasAtribuidas || []).find(function (d) { return d.id === item.divergencia_id; });
        if (div && String(div.status || '').toUpperCase() === 'EM_RECONTAGEM' && !div.operador_responsavel)
            return true;
    }
    return false;
}
function selecionarEnderecoRecontagem(itemId) {
    var item = (APP.divergenciasAtribuidas || []).find(function (d) { return d.id === itemId; }) ||
        (APP.recontagens || []).find(function (r) { return r.id === itemId; }) ||
        { id: itemId, endereco: itemId, tipo: 'recontagem' };
    // Verificação unificada via _itemEncerradoColetor
    if (_itemEncerradoColetor(item)) {
        toast('🔒 Este endereço já está encerrado. Não é possível iniciar nova rodada.', 'e');
        return;
    }
    // Bloqueio: aguardando decisão do analista após recontagem concluída
    var stRec = String(item.status_recontagem || '').toLowerCase();
    if (stRec === 'aguardando_analista') {
        toast('🔒 Aguardando decisão do analista. Uma nova rodada será atribuída quando necessário.', 'w');
        return;
    }
    // Bloqueio: limite de 3 contagens atingido
    var numRec = item.numero_recontagem || 1;
    if (numRec >= 3) {
        toast('🔒 Limite de rodadas atingido (3). Sem consenso — endereço marcado como persistente.', 'e');
        return;
    }
    _ativarModoRecontagem(item);
}
function _ativarModoRecontagem(item) {
    // ── Normalizar ids: garantir que recontagem_id e divergencia_id estejam corretos ──
    // Se o item vier de APP.divergenciasAtribuidas, é uma divergência (não tem divergencia_id).
    // Precisamos buscar a recontagem PENDENTE vinculada para gravar o recontagem_id correto.
    var itemNorm = __assign({}, item);
    if (!itemNorm.divergencia_id) {
        // item é uma divergência — seu .id é o divergencia_id
        itemNorm.divergencia_id = item.id;
        // Buscar recontagem pendente vinculada para obter o id correto
        var recVinculada = (APP.recontagens || []).find(function (r) {
            return r.divergencia_id === item.id &&
                (r.status === 'PENDENTE' || (r.status_recontagem || '').toLowerCase() === 'pendente');
        });
        if (recVinculada) {
            itemNorm.id = recVinculada.id; // recontagem_id que será gravado na contagem
            itemNorm.numero_recontagem = recVinculada.numero_recontagem || 1;
        }
        // Se não há recontagem vinculada ainda, manter item.id como divergencia_id
        // e recontagem_id ficará null — o analista cria a recontagem antes de atribuir
    }
    APP.modoRecontagem = itemNorm;
    _endVerif = null; // limpar cache Firebase — recontagem é sessão nova e independente
    resetContagem();
    showView('contar', document.querySelector('.nav-tab'));
    setTimeout(function () { return _aplicarUIRecontagem(itemNorm); }, 80);
}
function _aplicarUIRecontagem(item) {
    var viewContar = document.getElementById('view-contar');
    if (!viewContar)
        return;
    APP.recPalletAtual = 1;
    var banner = document.getElementById('banner-modo-recontagem');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'banner-modo-recontagem';
        viewContar.insertBefore(banner, viewContar.firstChild);
    }
    _atualizarBannerRecontagem(item);
    var fEnd = document.getElementById('f-endereco');
    if (fEnd) {
        fEnd.value = '';
        fEnd.disabled = false;
        fEnd.style.opacity = '';
        fEnd.placeholder = 'Bipe o endereço para confirmar';
        setTimeout(function () { return fEnd.focus(); }, 120);
    }
    var fb = document.getElementById('fb-endereco');
    if (fb)
        fb.innerHTML = "<div class=\"fb warn\" style=\"flex-direction:column;align-items:flex-start;gap:2px\"><b>\uD83D\uDD04 Nova rodada \u2014 bipe o endere\u00E7o para confirmar</b><span style=\"font-size:.7rem;opacity:.9\">Esperado: <b style=\"color:var(--accent)\">".concat(item.endereco, "</b></span></div>");
}
function _atualizarBannerRecontagem(item) {
    var banner = document.getElementById('banner-modo-recontagem');
    if (!banner)
        return;
    // Intencionalmente NÃO exibir quantidade anterior nem quantidade esperada
    // para evitar influência na nova contagem (req. independência da recontagem)
    banner.innerHTML = "\n    <div style=\"background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(251,191,36,.07));border:2px solid rgba(251,191,36,.7);border-radius:12px;padding:12px 14px;margin-bottom:12px\">\n      <div style=\"display:flex;align-items:flex-start;justify-content:space-between;gap:8px\">\n        <div style=\"flex:1;min-width:0\">\n          <div style=\"font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#fbbf24;margin-bottom:5px\">\uD83D\uDD04 NOVA RODADA</div>\n          <div style=\"font-family:var(--mono);font-weight:800;font-size:1.1rem;color:var(--warn);padding-bottom:5px;margin-bottom:5px;border-bottom:1px dashed rgba(251,191,36,.3)\">\uD83D\uDCCD ".concat(item.endereco, "</div>\n          ").concat(item.descricao ? "<div style=\"font-size:.7rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">".concat(item.descricao, "</div>") : '', "\n          ").concat(item.observacao_atribuicao || item.observacao
        ? "<div style=\"margin-top:5px;padding:5px 8px;background:rgba(251,191,36,.08);border-radius:6px;font-size:.68rem;color:#fbbf24;font-style:italic\">\uD83D\uDCAC ".concat(item.observacao_atribuicao || item.observacao, "</div>")
        : '', "\n        </div>\n        <button onclick=\"cancelarModoRecontagem()\" style=\"flex-shrink:0;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.4);color:#f87171;border-radius:8px;padding:6px 10px;font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap\">\u2715 Sair</button>\n      </div>\n    </div>");
}
function cancelarModoRecontagem() {
    APP.modoRecontagem = null;
    resetContagem();
    var banner = document.getElementById('banner-modo-recontagem');
    if (banner)
        banner.remove();
    var fEnd = document.getElementById('f-endereco');
    if (fEnd) {
        fEnd.disabled = false;
        fEnd.style.opacity = '';
        fEnd.value = '';
    }
    showView('recontagens', document.getElementById('tab-recontagens'));
}
function _concluirRecontagem() {
    var _a;
    var item = APP.modoRecontagem;
    if (!item)
        return;
    if (navigator.onLine && item.id) {
        // Coletor APENAS atualiza a recontagem — não escreve na divergência.
        // O analista é o dono da divergência. sincronizarRecontagensComContagens
        // gravará aguardando_analista quando processar a contagem recém-enviada.
        var upd = { status_recontagem: 'concluida', recontagem_concluida_em: new Date().toISOString(), operador_recontagem: ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || '' };
        // Só atualizar dt_recontagens se item.id for de fato uma recontagem (não uma divergência).
        // item._col === 'recontagem' → id é recontagem.
        // item._col === 'divergencia' com divergencia_id definido → _ativarModoRecontagem encontrou a rec e sobrescreveu item.id.
        // item._col === 'divergencia' sem divergencia_id → item.id é a divergência; NÃO gravar no lugar errado.
        var idEhRecontagem = item._col === 'recontagem' || (item._col === 'divergencia' && item.divergencia_id && item.id !== item.divergencia_id);
        if (idEhRecontagem) {
            FS.collection('dt_recontagens').doc(item.id).update(upd).catch(function (e) { return console.warn('[Rec]', e.message); });
        }
        else if (item.divergencia_id || item._col === 'divergencia') {
            // Sem rec criada pelo analista: atualizar a divergência diretamente
            var divFsId = item.divergencia_id || item.id;
            FS.collection('dt_divergencias').doc(divFsId).update({ status_recontagem: 'aguardando_analista', operador_responsavel: null }).catch(function (e) { return console.warn('[Div]', e.message); });
        }
    }
    // Marcar recontagem como concluída e encerrada na lista local
    // encerrada_definitivamente=true garante que o listener do Firebase não desfaça o estado
    var setConcluida = function (list) { return list.forEach(function (i) {
        if (i.id === item.id) {
            i.status_recontagem = 'concluida';
            i.encerrada_definitivamente = true;
        }
    }); };
    setConcluida(APP.recontagens || []);
    // Atualizar divergência local para aguardando analista (só no estado em memória,
    // sem escrever no Firestore — o analista sobrescreve ao processar a contagem)
    var divId = item.divergencia_id || (item._col === 'divergencia' ? item.id : null);
    if (divId) {
        (APP.divergenciasAtribuidas || []).forEach(function (d) {
            if (d.id === divId) {
                d.status_recontagem = 'aguardando_analista';
                d.operador_responsavel = null;
            }
        });
    }
    // Limpar completamente o modo recontagem — não deixar estado residual
    APP.modoRecontagem = null;
    APP.recPalletAtual = 1;
    _endVerif = null;
    var banner = document.getElementById('banner-modo-recontagem');
    if (banner)
        banner.remove();
    var fEnd = document.getElementById('f-endereco');
    if (fEnd) {
        fEnd.disabled = false;
        fEnd.style.opacity = '';
        fEnd.value = '';
    }
    _atualizarBadgeRecontagens();
    setTimeout(function () {
        showView('recontagens', document.getElementById('tab-recontagens'));
        renderRecontagensAtribuidas();
        toast('✅ Rodada enviada — aguardando decisão do analista.', 's');
    }, 900);
}
function renderRecontagensAtribuidas() {
    var el = document.getElementById('rec-list');
    if (!el)
        return;
    if (_recCarregando) {
        el.innerHTML = "<div style=\"padding:30px;text-align:center;color:var(--muted)\"><div style=\"font-size:2rem;margin-bottom:8px\">\u23F3</div><div style=\"font-weight:700;color:var(--text)\">Buscando rodadas\u2026</div></div>";
        return;
    }
    var recs = (APP.recontagens || [])
        .filter(function (r) {
        var _a;
        if (_itemEncerradoColetor(r))
            return false;
        // Só mostrar recontagens atribuídas ao operador atual
        var opAtual = ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || '';
        if (opAtual && r.operador && r.operador !== opAtual)
            return false;
        return true;
    })
        .map(function (r) { var _a, _b, _c; return ({ _id: r.id, _col: 'recontagem', endereco: r.endereco || '—', descricao: r.descricao || '', barcode: r.produto || '', qtd1: (_a = r.qtd_primeira) !== null && _a !== void 0 ? _a : '—', qtdEsp: (_b = r.qtd_esperada) !== null && _b !== void 0 ? _b : '—', diferenca: (_c = r.diferenca) !== null && _c !== void 0 ? _c : null, operador: r.operador || '', statusRec: (r.status_recontagem || 'pendente'), obs: r.observacao_atribuicao || r.observacao || '', data: r.atribuido_em || '', tag: '' }); });
    var endComRec = new Set(recs.map(function (r) { return r.endereco; }));
    var divs = (APP.divergenciasAtribuidas || []).filter(function (d) {
        if (endComRec.has(d.endereco))
            return false;
        if (_itemEncerradoColetor(d))
            return false;
        return true;
    }).map(function (d) { var _a, _b, _c; return ({ _id: d.id, _col: 'divergencia', endereco: d.endereco || '—', descricao: d.descricao || '', barcode: d.gtin_bipado || d.produto || '', qtd1: (_a = d.qtd_contada) !== null && _a !== void 0 ? _a : '—', qtdEsp: (_b = d.qtd_esperada) !== null && _b !== void 0 ? _b : '—', diferenca: (_c = d.diferenca) !== null && _c !== void 0 ? _c : null, operador: d.operador_responsavel || d.operador || '', statusRec: (d.status_recontagem || 'pendente'), obs: d.observacao_atribuicao || d.observacao || '', data: d.atribuido_em || '', tag: d.tipo_divergencia || '' }); });
    var fonte = __spreadArray(__spreadArray([], recs, true), divs, true);
    var lista = _recFiltroAtivo === 'todos' ? __spreadArray([], fonte, true) : fonte.filter(function (i) { return i.statusRec === _recFiltroAtivo; });
    _atualizarBadgeRecontagens();
    if (!lista.length) {
        el.innerHTML = "<div style=\"text-align:center;padding:40px 20px;color:var(--muted)\"><div style=\"font-size:2.5rem;opacity:.4;margin-bottom:10px\">\uD83D\uDD04</div><div style=\"font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:6px\">".concat(fonte.length > 0 ? "Filtro \"".concat(_recFiltroAtivo, "\" \u2014 ").concat(fonte.length, " no banco") : 'Nenhuma rodada atribuída', "</div>").concat(fonte.length > 0 ? "<button onclick=\"setRecFilter('todos',null)\" style=\"margin-top:8px;padding:7px 18px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--accent);font-size:.78rem;font-weight:700;cursor:pointer\">Ver todos (".concat(fonte.length, ")</button>") : '', "</div>");
        return;
    }
    // Status que significam "encerrado" para o operador — não aparecem como ação pendente
    var _stEnc = ['concluida', 'sem_divergencia', 'resolvida', 'aguardando_analista', 'cancelada'];
    lista.sort(function (a, b) {
        var _a, _b;
        var ord = { pendente: 0, em_andamento: 1, aguardando_analista: 3, concluida: 4, sem_divergencia: 4, resolvida: 4, cancelada: 5 };
        var oa = (_a = ord[a.statusRec]) !== null && _a !== void 0 ? _a : 2, ob = (_b = ord[b.statusRec]) !== null && _b !== void 0 ? _b : 2;
        return oa !== ob ? oa - ob : a.endereco.localeCompare(b.endereco);
    });
    var tagMap = { PRODUTO_NAO_IDENTIFICADO: '🔍 Produto não identificado', PRODUTO_FORA_ENDERECO: '📍 Produto fora do endereço', QUANTIDADE_DIFERENTE: '🔢 Quantidade divergente' };
    // ── Agrupar por endereço — cada endereço aparece 1 vez mesmo com vários produtos ──
    var gruposMap = {};
    for (var _i = 0, lista_1 = lista; _i < lista_1.length; _i++) {
        var item = lista_1[_i];
        var end = item.endereco;
        if (!gruposMap[end]) {
            gruposMap[end] = { endereco: end, itens: [], _id: item._id, _col: item._col,
                operador: item.operador, data: item.data, obs: item.obs };
        }
        gruposMap[end].itens.push(item);
        // Representante do botão = item acionável (não encerrado para o operador)
        if (!_stEnc.includes(item.statusRec))
            gruposMap[end]._id = item._id;
    }
    var grupos = Object.values(gruposMap);
    // Para os contadores do topo, contar por endereço único
    // "pendente" = endereços que o operador ainda precisa agir (excluí aguardando_analista)
    var endUnicas = grupos.length;
    var pendEndN = grupos.filter(function (g) { return g.itens.some(function (i) { return !_stEnc.includes(i.statusRec); }); }).length;
    var aguardN = grupos.filter(function (g) { return !g.itens.some(function (i) { return !_stEnc.includes(i.statusRec); }) && g.itens.some(function (i) { return i.statusRec === 'aguardando_analista'; }); }).length;
    var html = "<div style=\"font-size:.72rem;color:var(--muted);padding:0 2px 10px;display:flex;gap:12px;flex-wrap:wrap\">\n    <span>\uD83D\uDCCB <b style=\"color:var(--text)\">".concat(endUnicas, " endere\u00E7o(s)</b></span>\n    ").concat(pendEndN > 0 ? "<span>\u23F3 <b style=\"color:var(--warn)\">".concat(pendEndN, " para re-contar</b></span>") : '', "\n    ").concat(aguardN > 0 ? "<span>\uD83D\uDD12 <b style=\"color:#818cf8\">".concat(aguardN, " aguard. analista</b></span>") : '', "\n    <span>\u2705 <b style=\"color:var(--success)\">").concat(endUnicas - pendEndN - aguardN, "</b></span>\n  </div>");
    // Ordenar grupos: acionáveis primeiro, aguardando segundo, encerrados por último
    grupos.sort(function (a, b) {
        var aPend = a.itens.some(function (i) { return !_stEnc.includes(i.statusRec); });
        var bPend = b.itens.some(function (i) { return !_stEnc.includes(i.statusRec); });
        var aAguard = !aPend && a.itens.some(function (i) { return i.statusRec === 'aguardando_analista'; });
        var bAguard = !bPend && b.itens.some(function (i) { return i.statusRec === 'aguardando_analista'; });
        if (aPend !== bPend)
            return aPend ? -1 : 1;
        if (aAguard !== bAguard)
            return aAguard ? -1 : 1;
        return a.endereco.localeCompare(b.endereco);
    });
    for (var _a = 0, grupos_1 = grupos; _a < grupos_1.length; _a++) {
        var grupo = grupos_1[_a];
        var concluida = grupo.itens.every(function (i) { return ['concluida', 'sem_divergencia', 'resolvida'].includes(i.statusRec); });
        var aguardando = !concluida && grupo.itens.every(function (i) { return i.statusRec === 'aguardando_analista'; });
        var isDiv = grupo._col === 'divergencia';
        var nProdutos = grupo.itens.length;
        var dataStr = '';
        try {
            if (grupo.data)
                dataStr = new Date(grupo.data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        }
        catch (e) { }
        // Listar produtos distintos do grupo
        var produtosUnicos = __spreadArray([], new Map(grupo.itens.map(function (i) { return [i.barcode || i.descricao, i]; })).values(), true);
        var produtosHtml = produtosUnicos.map(function (i) {
            return "<div style=\"display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)\">\n        ".concat(i.descricao ? "<span style=\"font-size:.78rem;font-weight:600;color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">".concat(i.descricao, "</span>") : '', "\n        ").concat(i.barcode ? "<span style=\"font-size:.65rem;color:var(--muted);font-family:var(--mono)\">\uD83D\uDCE6 ".concat(i.barcode, "</span>") : '', "\n        ").concat(i.diferenca != null ? "<span style=\"font-size:.78rem;font-weight:800;color:".concat(i.diferenca < 0 ? 'var(--danger)' : 'var(--warn)', ";\">").concat(i.diferenca > 0 ? '+' : '').concat(i.diferenca, "</span>") : '', "\n      </div>");
        }).join('');
        // Definir estilo do card conforme estado
        var borderColor = concluida ? 'rgba(0,255,160,.2)' : aguardando ? 'rgba(99,102,241,.35)' : isDiv ? 'rgba(255,179,0,.35)' : 'rgba(232,117,26,.3)';
        var accentColor = concluida ? 'var(--success)' : aguardando ? '#818cf8' : isDiv ? 'var(--warn)' : 'var(--accent)';
        var cardOpacity = (concluida || aguardando) ? '.65' : '1';
        html += "<div style=\"background:var(--card);margin-bottom:8px;border-radius:12px;padding:13px 14px;border:1.5px solid ".concat(borderColor, ";border-left:4px solid ").concat(accentColor, ";opacity:").concat(cardOpacity, "\">\n      <div style=\"display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px\">\n        <div style=\"font-family:var(--mono);font-weight:800;font-size:1rem;color:").concat(accentColor, "\">").concat(grupo.endereco, "</div>\n        ").concat(nProdutos > 1 ? "<span style=\"font-size:.65rem;font-weight:700;background:rgba(232,117,26,.15);color:var(--accent);border-radius:99px;padding:2px 8px\">".concat(nProdutos, " produtos</span>") : '', "\n      </div>\n      <div style=\"margin-bottom:6px\">").concat(produtosHtml, "</div>\n      ").concat(grupo.obs ? "<div style=\"padding:5px 8px;background:rgba(255,179,0,.08);border:1px solid rgba(255,179,0,.2);border-radius:6px;font-size:.68rem;color:var(--text);margin-bottom:5px\">\uD83D\uDCAC ".concat(grupo.obs, "</div>") : '', "\n      <div style=\"font-size:.62rem;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;margin-bottom:").concat((concluida || aguardando) ? '0' : '8px', "\">").concat(grupo.operador ? "<span>\uD83D\uDC64 ".concat(grupo.operador, "</span>") : '', " ").concat(dataStr ? "<span>\uD83D\uDCC5 ".concat(dataStr, "</span>") : '', "</div>\n      ").concat(concluida
            ? "<div style=\"text-align:center;font-size:.75rem;color:var(--success);font-weight:700;padding:8px;background:rgba(0,214,143,.08);border-radius:8px\">".concat(grupo.itens.some(function (i) { return i.statusRec === 'sem_divergencia' || i.statusRec === 'resolvida'; }) ? '✅ SEM DIFERENÇA' : '✅ CONCLUÍDA', "</div>")
            : aguardando
                ? "<div style=\"text-align:center;font-size:.75rem;color:#818cf8;font-weight:700;padding:8px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.25);border-radius:8px\">\uD83D\uDD12 Aguardando decis\u00E3o do analista</div>"
                : "<button onclick=\"selecionarEnderecoRecontagem('".concat(grupo._id, "')\" style=\"width:100%;padding:12px;background:linear-gradient(135deg,").concat(isDiv ? '#f59e0b,#d97706' : '#E8751A,#C45E0E', ");color:#fff;font-weight:800;border:none;border-radius:10px;font-size:.88rem;cursor:pointer\">\uD83D\uDCCD Iniciar rodada \u2014 ").concat(grupo.endereco, "</button>"), "\n    </div>");
    }
    el.innerHTML = html;
}
