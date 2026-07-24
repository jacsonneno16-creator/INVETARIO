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

(function(global){
  'use strict';
  function texto(v){ return String(v == null ? '' : v).trim(); }
  function partes(endereco){
    var bruto=texto(endereco);
    var p=bruto.split('.').map(function(x){return x.trim();}).filter(Boolean);
    return {bruto:bruto,loja:p[0]||'',local:p[1]||'',area:p[2]||'',rua:p[3]||p[0]||'',coluna:p[4]||'',nivel:p[5]||'',sequencia:p[6]||'',lista:p};
  }
  function chave(endereco){ return texto(endereco).toUpperCase().split('.').map(function(x){return x.trim();}).filter(Boolean).join('.'); }
  global.DTEnderecos=global.DTEnderecos||{};
  global.DTEnderecos.partes=partes;
  global.DTEnderecos.chave=chave;
})(window);
