function state() { return window.AnalistaStore.getState(); }
// ───────────────────────────────────────────────────────────────────
//  7-A. CAMADA DE VALIDAÇÃO OPERACIONAL
//  Centraliza todas as regras de bloqueio de contagem.
//  !! PREPARADA PARA FIREBASE: basta substituir state().enderecosLista / state().contagens
//     por leituras do Firestore e a lógica permanece idêntica. !!
// ───────────────────────────────────────────────────────────────────
/**
 * Busca o objeto de endereço cadastrado pelo código.
 * @param {string} endCod — ex: "01.02.03.04.05.01"
 * @returns {object|null}
 */
function getEnderecoInfo(endCod) {
    return state().enderecosLista.find(function (e) { return e.endereco === endCod; }) || null;
}
/**
 * Retorna as contagens ativas (não excluídas) de um endereço em um inventário.
 * Exclui recontagens (elas não contam para o bloqueio "já contado").
 * @param {string} inventarioId
 * @param {string} endCod
 * @param {boolean} incluirRecontagem — se true, inclui também contagens tipo RECONTAGEM
 * @returns {Array}
 */
function getContagensAtivas(inventarioId, endCod, incluirRecontagem) {
    if (incluirRecontagem === void 0) { incluirRecontagem = false; }
    return state().contagens.filter(function (c) {
        return c.inventario_id === inventarioId &&
            c.endereco === endCod &&
            !c._excluida &&
            (incluirRecontagem || c.tipo_contagem !== 'RECONTAGEM');
    });
}
/**
 * Conta quantos paletes já foram registrados para um endereço em um inventário.
 * Cada contagem de tipo PRIMEIRA = 1 palete (independente da quantidade de itens).
 */
function getPaletesUsados(inventarioId, endCod) {
    return state().contagens.filter(function (c) {
        return c.inventario_id === inventarioId &&
            c.endereco === endCod &&
            !c._excluida &&
            c.tipo_contagem !== 'RECONTAGEM';
    }).length;
}
/**
 * VALIDAÇÃO PRINCIPAL — chamada antes de aceitar qualquer contagem.
 *
 * Retorna um objeto:
 *   { ok: true }  → contagem permitida
 *   { ok: false, motivo: 'INATIVO'|'JA_CONTADO'|'LIMITE_PALETES', msg: string }
 *
 * @param {string} inventarioId
 * @param {string} endCod
 * @param {string} tipoContagem — 'PRIMEIRA' | 'RECONTAGEM'
 * @param {boolean} recontagemAutorizada — true se o analista autorizou explicitamente
 */
function validarContagem(inventarioId, endCod, tipoContagem, recontagemAutorizada) {
    if (tipoContagem === void 0) { tipoContagem = 'PRIMEIRA'; }
    if (recontagemAutorizada === void 0) { recontagemAutorizada = false; }
    var end = getEnderecoInfo(endCod);
    // ── 1. ENDEREÇO INATIVO ────────────────────────────────────────────
    // Endereço inativo (ativo=false) não pode receber NENHUMA contagem,
    // nem mesmo recontagem autorizada — precisa ser reativado primeiro.
    if (end && end.ativo === false) {
        return {
            ok: false,
            motivo: 'INATIVO',
            msg: 'Endereço inativo, contagem não permitida.',
        };
    }
    // ── 2. JÁ CONTADO (apenas para PRIMEIRA contagem) ─────────────────
    // Se o endereço já tem pelo menos 1 contagem ativa do tipo PRIMEIRA,
    // bloquear nova contagem — salvo se for uma RECONTAGEM autorizada
    // (gerada pelo fluxo de divergências) ou se a anterior foi excluída.
    if (tipoContagem !== 'RECONTAGEM') {
        var contagensAtuais = getContagensAtivas(inventarioId, endCod, false);
        if (contagensAtuais.length > 0 && !recontagemAutorizada) {
            return {
                ok: false,
                motivo: 'JA_CONTADO',
                msg: 'Endereço já contado. Exclua a contagem anterior ou solicite uma recontagem.',
            };
        }
    }
    // ── 3. LIMITE DE PALETES ───────────────────────────────────────────
    // Só aplica quando capacidade_paletes está definida (≥ 1).
    // Recontagem não consome vaga de palete (é uma conferência, não nova entrada).
    if (end && end.capacidade_paletes !== null && end.capacidade_paletes > 0 && tipoContagem !== 'RECONTAGEM') {
        var usados = getPaletesUsados(inventarioId, endCod);
        if (usados >= end.capacidade_paletes) {
            return {
                ok: false,
                motivo: 'LIMITE_PALETES',
                msg: "Limite de paletes atingido para este endere\u00E7o (cap: ".concat(end.capacidade_paletes, ", usados: ").concat(usados, ")."),
            };
        }
    }
    return { ok: true };
}
// Esta validação não deve rejeitar documentos recebidos do coletor: o coletor é quem
// executa a validação operacional ao vivo e também suporta modo offline. Mantemos esta
// camada como contrato reutilizável para futuros lançamentos manuais no Analista e para
// diagnósticos, sem apagar código nem criar uma segunda fonte de bloqueio.
window.DTValidacaoOperacional = Object.assign(window.DTValidacaoOperacional || {}, {
    getEnderecoInfo: getEnderecoInfo,
    getContagensAtivas: getContagensAtivas,
    getPaletesUsados: getPaletesUsados,
    validarContagem: validarContagem,
});
/**
 * Exclui uma contagem (marca como _excluida=true para preservar histórico).
 * Libera a vaga de palete correspondente.
 * Registra no log de auditoria.
 * @param {string} contId
 */
function excluirContagem(contId) {
    var cont = state().contagens.find(function (c) { return c.id === contId; });
    if (!cont)
        return;
    showConfirm("Excluir a contagem do endere\u00E7o ".concat(escHTML(cont.endereco), "? Isso liberar\u00E1 a vaga de palete e permitir\u00E1 nova contagem."), function () { return _excluirContagemConfirmado(cont); }, { title: 'Excluir contagem', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    return;
}
function _excluirContagemConfirmado(cont) {
    var agora = new Date().toISOString();
    var emailAnalista = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || '';
    var nomeAnalista = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.displayName) || emailAnalista;
    cont._excluida = true;
    cont._excluida_em = agora;
    cont._excluida_por = nomeAnalista;
    cont._excluida_por_email = emailAnalista;
    cont._motivo_estorno = 'EXCLUSAO_ANALISTA';
    cont.status = 'EXCLUIDA';
    cont.estorno_origem = 'ANALISTA';
    saveAll();
    // ✅ Persistir no Firestore — rotear para dt_vazios se for VAZIO
    var docId = cont.uuid || String(cont.id);
    var _colExcluir = cont.tipo_contagem === 'VAZIO' ? 'dt_vazios' : 'dt_contagens';
    if (navigator.onLine) {
        FS_AN.collection(_colExcluir).doc(docId).update({
            _excluida: true,
            status: 'EXCLUIDA',
            _excluida_em: agora,
            _excluida_por: nomeAnalista,
            _excluida_por_email: emailAnalista,
            _motivo_estorno: 'EXCLUSAO_ANALISTA',
            estorno_origem: 'ANALISTA',
        }).catch(function (e) { return console.warn('[FS] Erro ao persistir exclusão:', e.message); });
    }
    renderContagens();
    atualizarBadgesNav();
    logSistema('EXCLUSAO', "Contagem ".concat(contId, " exclu\u00EDda \u2014 endere\u00E7o ").concat(cont.endereco, " liberado"), {
        contId: contId,
        uuid: cont.uuid,
        endereco: cont.endereco,
        produto: cont.codigo_produto,
        quantidade: cont.quantidade,
        tipo_contagem: cont.tipo_contagem || 'PRIMEIRA',
        inventario_id: cont.inventario_id,
        excluida_por: nomeAnalista,
        excluida_por_email: emailAnalista,
    });
    showToast("\uD83D\uDDD1 Contagem exclu\u00EDda. Endere\u00E7o ".concat(cont.endereco, " liberado para nova contagem."), 'w');
}
/**
 * Restaura uma contagem excluída (desfaz a exclusão).
 * @param {string} contId
 */
function restaurarContagem(contId) {
    var cont = state().contagens.find(function (c) { return c.id === contId; });
    if (!cont || !cont._excluida)
        return;
    // Validar se restaurar seria possível (pode ter outra contagem agora)
    var val = validarContagem(cont.inventario_id, cont.endereco, cont.tipo_contagem, false);
    if (!val.ok) {
        showToast("\u26A0\uFE0F N\u00E3o \u00E9 poss\u00EDvel restaurar: ".concat(val.msg), 'e');
        return;
    }
    var emailAnalista = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.email) || '';
    var nomeAnalista = (_currentAnalistaUser === null || _currentAnalistaUser === void 0 ? void 0 : _currentAnalistaUser.displayName) || emailAnalista;
    var agora = new Date().toISOString();
    // Limpar flags de exclusão
    delete cont._excluida;
    delete cont._excluida_em;
    delete cont._excluida_por;
    delete cont._excluida_por_email;
    delete cont._motivo_estorno;
    delete cont.estorno_origem;
    cont.status = 'PROCESSADO';
    cont.restaurada_em = agora;
    cont.restaurada_por = nomeAnalista;
    cont.restaurada_por_email = emailAnalista;
    saveAll();
    // ✅ Persistir restauração no Firestore — rotear para dt_vazios se for VAZIO
    var docId = cont.uuid || String(cont.id);
    var _colRest = cont.tipo_contagem === 'VAZIO' ? 'dt_vazios' : 'dt_contagens';
    if (navigator.onLine) {
        FS_AN.collection(_colRest).doc(docId).update({
            _excluida: firebase.firestore.FieldValue.delete(),
            _excluida_em: firebase.firestore.FieldValue.delete(),
            _excluida_por: firebase.firestore.FieldValue.delete(),
            _excluida_por_email: firebase.firestore.FieldValue.delete(),
            _motivo_estorno: firebase.firestore.FieldValue.delete(),
            estorno_origem: firebase.firestore.FieldValue.delete(),
            status: 'PROCESSADO',
            restaurada_em: agora,
            restaurada_por: nomeAnalista,
            restaurada_por_email: emailAnalista,
        }).catch(function (e) { return console.warn('[FS] Erro ao persistir restauração:', e.message); });
    }
    renderContagens();
    atualizarBadgesNav();
    logSistema('RESTAURACAO', "Contagem ".concat(contId, " restaurada \u2014 endere\u00E7o ").concat(cont.endereco), {
        contId: contId,
        uuid: cont.uuid,
        endereco: cont.endereco,
        produto: cont.codigo_produto,
        inventario_id: cont.inventario_id,
        restaurada_por: nomeAnalista,
        restaurada_por_email: emailAnalista,
    });
    showToast("\u2705 Contagem ".concat(contId, " restaurada!"), 's');
}
/**
 * Toggle ativo/inativo de um endereço pelo analista.
 * Endereço com capacidade_paletes = 0 pode ser manualmente reativado aqui,
 * mas o sistema emitirá um aviso pois a capacidade ainda é 0.
 * @param {string} endCod
 */
function toggleAtivacaoEndereco(endCod) {
    var end = state().enderecosLista.find(function (e) { return e.endereco === endCod; });
    if (!end)
        return;
    var novoEstado = !end.ativo;
    // Aviso adicional se estiver reativando endereço de capacidade 0
    if (novoEstado && end.capacidade_paletes === 0) {
        showConfirm("O endere\u00E7o \"".concat(escHTML(endCod), "\" tem capacidade_paletes = 0. Reativ\u00E1-lo sem ajustar a capacidade pode causar inconsist\u00EAncias. Deseja continuar assim mesmo?"), function () { return _toggleEnderecoCapZero(endCod, novoEstado); }, { title: "⚠️ Capacidade zero", icon: "⚠️", okLabel: "Continuar mesmo assim", okClass: "btn-danger" });
        return;
    }
    var acao = novoEstado ? 'ativado' : 'desativado';
    showConfirm("".concat(novoEstado ? 'Ativar' : 'Desativar', " o endere\u00E7o \"").concat(escHTML(endCod), "\"?"), function () { return _toggleEnderecoConfirmado(endCod, novoEstado); }, { title: novoEstado ? '✅ Ativar endereço' : '⛔ Desativar endereço', icon: novoEstado ? '✅' : '⛔', okLabel: novoEstado ? 'Ativar' : 'Desativar', okClass: novoEstado ? 'btn-success' : 'btn-danger' });
    return;
}
// ── Alias: prosseguir toggle mesmo com capacidade zero ──
function _toggleEnderecoCapZero(endCod, novoEstado) {
    _toggleEnderecoConfirmado(endCod, novoEstado);
}
function _toggleEnderecoConfirmado(endCod, novoEstado) {
    // Atualizar na lista flat
    end.ativo = novoEstado;
    // Atualizar no porSetor
    var setor = end.setor || end.local_area || 'SEM LOCAL';
    if (state().enderecosPorSetor[setor]) {
        var e2 = state().enderecosPorSetor[setor].find(function (x) { return x.endereco === endCod; });
        if (e2)
            e2.ativo = novoEstado;
    }
    storageSave(KEYS.enderecos, state().enderecosLista);
    atualizarEnderecos();
    atualizarBadgesNav();
    logSistema('ENDERECO', "Endere\u00E7o ".concat(endCod, " ").concat(acao, " manualmente"), { endCod: endCod, ativo: novoEstado });
    showToast("".concat(novoEstado ? '✅ Endereço ativado' : '⛔ Endereço desativado', ": ").concat(endCod), novoEstado ? 's' : 'w');
}
/**
 * Atualiza manualmente a capacidade de paletes de um endereço.
 * Chamada do inline edit na tabela de endereços.
 * @param {string} endCod
 * @param {number} novaCap
 */
function salvarCapacidade(endCod, novaCap) {
    var result = dtSalvarCapacidadeEndereco(endCod, novaCap, {
        allowNull: false,
        refresh: function (cap) {
            atualizarEnderecos();
            logSistema('ENDERECO', "Capacidade de paletes de ".concat(endCod, " alterada para ").concat(cap), { endCod: endCod, cap: cap });
            showToast("\u2705 Capacidade de ".concat(endCod, " atualizada para ").concat(cap, " palete(s)"), 's');
        }
    });
    if (!result.ok) {
        showToast('Capacidade inválida', 'e');
        return;
    }
}
