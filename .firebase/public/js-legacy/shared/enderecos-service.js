'use strict';
// Regras compartilhadas de endereços para evitar duplicação no analista.
function dtSalvarCapacidadeEndereco(endCod, novaCap, opts) {
    var options = Object.assign({ allowNull: false, refresh: null }, opts || {});
    if (!window.ENDDB || !Array.isArray(ENDDB.lista))
        return { ok: false, reason: 'enddb' };
    var end = ENDDB.lista.find(function (e) { return e.endereco === endCod; });
    if (!end)
        return { ok: false, reason: 'not_found' };
    var cap = null;
    if (novaCap !== null && novaCap !== '') {
        cap = parseInt(novaCap, 10);
        if (Number.isNaN(cap) || cap < 0)
            return { ok: false, reason: 'invalid' };
    }
    else if (!options.allowNull) {
        cap = parseInt(novaCap, 10);
        if (Number.isNaN(cap) || cap < 0)
            return { ok: false, reason: 'invalid' };
    }
    end.capacidade_paletes = cap;
    if (cap === 0)
        end.ativo = false;
    var setor = end.setor || end.local_area || 'SEM LOCAL';
    if (ENDDB.porSetor && ENDDB.porSetor[setor]) {
        var e2 = ENDDB.porSetor[setor].find(function (x) { return x.endereco === endCod; });
        if (e2) {
            e2.capacidade_paletes = cap;
            if (cap === 0)
                e2.ativo = false;
        }
    }
    if (window.storageSave && window.KEYS)
        storageSave(KEYS.enderecos, ENDDB.lista);
    if (typeof options.refresh === 'function')
        options.refresh(cap);
    return { ok: true, cap: cap };
}
window.dtSalvarCapacidadeEndereco = window.dtSalvarCapacidadeEndereco || dtSalvarCapacidadeEndereco;
